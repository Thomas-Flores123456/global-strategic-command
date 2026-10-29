/**
 * useParse.ts —— 解析运行时 store（批 B）
 *
 * 职责：楼层传承编排（基线扫描→parseMessageText→写本楼 stat_data）+ 幂等（$parse.done 原文 hash）
 * + 留痕（$parse.log/quarantine/issues/reports）+ 隔离区两条出路（retryFloor / submitFix）+ 🟡撤销 + R20 对账。
 *
 * 状态放模块级 reactive（useDetail.ts 先例）：切 tab 会销毁面板组件实例，局部 ref 会丢。
 * 所有酒馆 API 经 tav() 探测降级——独立预览环境不炸，只显示"仅真机可用"。
 * 红线：楼层原文永不改写；写变量只写 stat_data 与 $parse；写入必须 await；
 * 写入物永远是 parseMessageText 返回的 Schema.parse 归一产物（不绕过校验）。
 */
import {
  canon,
  parseMessageText,
  type AuthorityInput,
  type DeployCatalogIndexLike,
  type ParseEvent,
  type ParseResult,
  type QuarantineItem,
  type StatData,
} from '../parse/parsePipeline';
import { stripThinking } from '../parse/floorSanitize';
import type { ProjectDef, RetrofitDef } from '../core/catalog';
import { tav, type CheckIssue } from '../parse/systemCheck';
import {
  appendFloorProcessOp,
  ensureSwipeSlot,
  getSwipeSlot,
  makeSwipeScopedKey,
  parseSwipeScopedKey,
  readTimelineLedger,
  replayFloorProcessOps,
  writeTimelineLedger,
} from '../core/timelineLedger';
import {
  apis,
  buildAuthority,
  codexNamesOf,
  hashText,
  hydrateZeroFloorFromBoot,
  normalizeParseRoot,
  readFloorLive,
  scanBaseline,
  wrapFixText,
  type GetChatMessages,
} from './useParseAuthority';
import {
  parseState,
  persistParse,
  pushReport,
  toPersistedReport,
  type ChronoStash,
  type ParseReport,
} from './useParseReports';
import { cloneCommandHQ } from '../engines/settleFloorPhases';
import {
  beginFloorTrace,
  finishFloorTrace,
  recordTraceStage,
} from '../debug/dataFlowTracer';

declare module './useParseReports' {
  interface ChronoStash {
    swipe_id?: number;
    swipeKey?: string;
    hash?: string;
  }
}

export { makeSwipeScopedKey, parseSwipeScopedKey };
export * from './useParseAuthority';
export * from './useParseReports';

/* ═══════════════ 核心编排 ═══════════════ */

export type RunOutcome = 'parsed' | 'skipped' | 'not-ai' | 'unavailable' | 'missing' | 'chat-changed' | 'swipe-drifted';

export interface RunOptions {
  /** 跳过幂等 hash 检查（手动重解析 / 编辑后重跑） */
  force?: boolean;
  /** 被编辑楼不是最新楼：报告流水标记"下游楼层可能失真" */
  downstreamWarning?: boolean;
  /** 期望聊天 ID：写前复核聊天未漂移，切了就 fail-closed 放弃写入 */
  expectChatId?: string;
  /** 驾驶员顺延补票分钟数（CTRL-UI-CHRONO-01 · A′）：透传 settleFloor 与三来源 Δt 相加 */
  extraDeltaMinutes?: number;
  /** 内部：swipe 漂移 fail-closed 后的自动重排计数（上限 3 防链式活锁；CTRL-FLOOR-HEAL-01 方案甲②） */
  _swipeRetry?: number;
}

function readCurrentChatId(): string | null {
  try {
    const id = (globalThis as { SillyTavern?: { getCurrentChatId?: () => string } }).SillyTavern?.getCurrentChatId?.();
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * 解析编排：幂等 → 基线扫描 → parseMessageText → 写本楼 stat_data → $parse 留痕 → 报告入流水。
 * 楼层原文永不改写；user/隐藏楼不产生快照（跳过）。
 */
export async function runParseFor(
  message_id: number,
  optsOrForce: RunOptions | boolean = {},
): Promise<RunOutcome> {
  const opts: RunOptions = typeof optsOrForce === 'boolean' ? { force: optsOrForce } : optsOrForce;
  const api = apis();
  if (!api) return 'unavailable';
  const { gcm, gv, uvw } = api;
  parseState.busy = true;
  try {
    const s0Start = performance.now();
    if (opts.expectChatId !== undefined) {
      const currentChat = readCurrentChatId();
      if (currentChat !== null && currentChat !== opts.expectChatId) {
        console.warn(
          `[useParse] 启动前复核聊天切换：期望 ${opts.expectChatId}，实测 ${currentChat}，fail-closed 放弃写入`,
        );
        return 'chat-changed';
      }
    }

    const msg = gcm(message_id)[0];
    if (!msg) return 'missing';
    if (msg.role === 'user' || msg.is_hidden) return 'not-ai'; // 只有 AI 楼产生变量快照
    const raw = String(msg.message ?? '');
    const hash = hashText(raw);
    // 方案甲①：入口即锁定 swipe 页号，写前复核据此判漂移
    const swipeAtRead = typeof msg.swipe_id === 'number' && Number.isInteger(msg.swipe_id) ? msg.swipe_id : 0;
    const swipeKey = makeSwipeScopedKey(message_id, swipeAtRead);
    const traceChatId = opts.expectChatId ?? readCurrentChatId();
    const traceSource = (opts.extraDeltaMinutes ?? 0) > 0 ? 'chrono' : 'live';
    const thinkFreeRaw = stripThinking(raw).text;
    const rawTagsPreview = Array.from(
      new Set(Array.from(thinkFreeRaw.matchAll(/<([a-zA-Z\u4e00-\u9fa5]+)>/g), m => `<${m[1]}>`)),
    );

    // 幂等：原文 hash + swipe_id 双因子未变则跳过（方案甲③：TH 变量按 swipe 分槽，同文不同页是不同账；
    // 旧格式 done 无 swipe_id → 视为不匹配，重解析一次顺带升级格式、修复存量错位）
    if (!opts.force) {
      try {
        const chat = await gv({ type: 'chat' });
        const done = _.get(chat, ['$parse', 'done', String(message_id)]) as
          { hash?: unknown; swipe_id?: unknown } | undefined;
        if (done && done.hash === hash && done.swipe_id === swipeAtRead) {
          const c = parseState.chrono;
          const activeChat = opts.expectChatId ?? readCurrentChatId();
          if (
            c &&
            (c.message_id !== message_id ||
              c.chatId !== activeChat ||
              (c.swipeKey !== undefined && c.swipeKey !== swipeKey) ||
              (c.hash !== undefined && c.hash !== hash))
          ) {
            parseState.chrono = null;
          }
          const skippedTraceId = beginFloorTrace({
            chatId: traceChatId,
            floorId: message_id,
            swipeId: swipeAtRead,
            hash,
            source: traceSource,
            rawTagsPreview,
          });
          recordTraceStage(skippedTraceId, 'S0_BASELINE', {
            durationMs: Math.round((performance.now() - s0Start) * 100) / 100,
            status: 'skipped',
            summary: '命中 $parse.done 幂等跳过',
            meta: {
              chatId: traceChatId,
              floorId: message_id,
              swipeId: swipeAtRead,
              hash,
              outcome: 'skipped_done',
            },
          });
          finishFloorTrace(skippedTraceId, { outcome: 'skipped' });
          return 'skipped';
        }
      } catch {
        /* 读失败按未解析处理 */
      }
    }

    // 基线：message_id-1 向下扫第一个 AI 楼 stat_data；全无 → undefined（落归零基线）
    const baseline = scanBaseline(message_id - 1, readFloorLive(gcm, gv));

    // 撤销基线：入库前的本楼 stat_data（🟡入库时展示撤销按钮用）
    let prevOwn: unknown;
    let prevHad = false;
    try {
      const own = gv({ type: 'message', message_id });
      prevHad = _.has(own, 'stat_data');
      prevOwn = _.get(own, 'stat_data');
    } catch {
      /* 无法读则不可撤销 */
    }

    // #0 楼（开场启动器宿主楼层）防归零洗白保护：
    // 当 message_id === 0 时，scanBaseline(-1) 必为 undefined；若 #0 楼已写入开局 stat_data（或 chat.$boot 已确认开局），
    // 则以 #0 楼自身 stat_data（含 $boot 自愈回填）作为本楼解析基线，严禁用全 0 空树洗白开局资金与初始科技。
    let effectiveBaselineStatData: unknown = baseline?.stat_data;
    if (message_id === 0) {
      let chatVarsForZero: Record<string, unknown> | null = null;
      try {
        chatVarsForZero = await gv({ type: 'chat' });
      } catch {
        chatVarsForZero = null;
      }
      const hydratedZero = hydrateZeroFloorFromBoot(prevOwn, chatVarsForZero);
      if (hydratedZero.has_stat_data) {
        effectiveBaselineStatData = hydratedZero.stat_data;
      }
    }

    const traceBaselineSnap = effectiveBaselineStatData ?? {};
    const traceId = beginFloorTrace(
      {
        chatId: traceChatId,
        floorId: message_id,
        swipeId: swipeAtRead,
        hash,
        baselineFloorId: baseline?.floor ?? null,
        source: traceSource,
        rawTagsPreview,
      },
      traceBaselineSnap,
    );
    recordTraceStage(traceId, 'S0_BASELINE', {
      beforeSnap: traceBaselineSnap,
      afterSnap: traceBaselineSnap,
      durationMs: Math.round((performance.now() - s0Start) * 100) / 100,
      status: 'ok',
      summary: '基线与身份门通过',
      meta: {
        chatId: traceChatId,
        floorId: message_id,
        swipeId: swipeAtRead,
        hash,
        baselineFloorId: baseline?.floor ?? null,
        outcome: 'proceed',
      },
    });

    // 单次解析周期内统一预热并获取 1 次有效目录快照，向下游 6 个阶段贯穿复用
    const s1Start = performance.now();
    let catalogSnap: import('../core/catalogEffective').EffectiveCatalog | null = null;
    try {
      const { ensureWorldbookCatalogLoaded, effectiveCatalogSnapshot } = await import('./useCatalog');
      await ensureWorldbookCatalogLoaded();
      catalogSnap = effectiveCatalogSnapshot();
    } catch {
      catalogSnap = null;
    }

    // 权威名单（批 C 实体对齐）：baseline codex 名显式传入（不依赖 pinia 时序）；
    // 组装失败降级 undefined，对齐层整体跳过不阻断解析
    let authority: AuthorityInput | undefined;
    try {
      authority = await buildAuthority(codexNamesOf(effectiveBaselineStatData), catalogSnap);
    } catch {
      authority = undefined;
    }

    // CTRL-DEPLOY-PARSE-01（E3b 指令面批接线）：deploy 目录索引与 settleFloor ④″ 同源构建
    // （effectiveCatalogSnapshot 三池 → deployBlockIndexFromCatalog，仿 E2d deployOf 纯注入先例）；
    // catalog 缺席/异常 → undefined 护栏：部署令 fail-closed 拒收留痕（防幻影建筑），绝不阻断解析落盘。
    let deployIndex: DeployCatalogIndexLike | undefined;
    let protocolCatalog: import('../core/catalogEffective').ProtocolIndexSource | undefined;
    try {
      const deployCatalog = catalogSnap;
      if (deployCatalog) {
        const { deployBlockIndexFromCatalog } = await import('../engines/deploymentEngine');
        deployIndex = deployBlockIndexFromCatalog({
          buildings: deployCatalog.buildings,
          productions: deployCatalog.productions,
          retrofits: deployCatalog.retrofits,
        });
        protocolCatalog = deployCatalog.protocols as unknown as import('../core/catalogEffective').ProtocolIndexSource;
      }
    } catch {
      deployIndex = undefined;
      protocolCatalog = undefined;
    }

    const result = parseMessageText(raw, effectiveBaselineStatData, {
      isFirstFloor: message_id === 0,
      floorId: message_id,
      authority,
      deployIndex,
      protocolCatalog,
      deferPlanningCommit: true,
    });
    const parsedSnap = result.data;
    recordTraceStage(traceId, 'S1_PARSE', {
      beforeSnap: traceBaselineSnap,
      afterSnap: parsedSnap,
      durationMs: Math.round((performance.now() - s1Start) * 100) / 100,
      status: result.quarantine.length > 0 ? 'warn' : 'ok',
      summary: `解析完成 · 事件 ${result.events.length} 条 · 隔离 ${result.quarantine.length} 项`,
      meta: {
        rawTagsPreview,
        applied: result.applied,
        eventsCount: result.events.length,
        quarantineCount: result.quarantine.length,
      },
    });

    // F4 结算接线（CTRL-TXN-INTEG-01）：parse 之后、写本楼 stat_data 之前插入 settleFloor，
    // 与解析同属一个事务、同楼落盘，走 $parse.done 幂等，swipe/编辑自然重算。
    // catalog 读 useCatalog 模块级缓存快照；读不到/结算异常退默认值，绝不阻断解析落盘。
    // CHRONO 暂存候选（CTRL-UI-CHRONO-01）：本楼 OVERRUN 裁决记录，落盘成功后写入 parseState.chrono
    let chronoVerdicts: import('../engines/productionReconciliation').VerdictRecord[] | null = null;
    try {
      const s2Start = performance.now();
      const catalog: import('../core/catalogEffective').EffectiveCatalog | null = catalogSnap;
      const {
        settleFloor,
        applyAdjutantEventDeclaration,
        applyFactionUnlockSettlement,
        recomputeBasePowerFromCatalog,
      } = await import('../engines/settleFloor');
      const hasAdjutantDecls =
        Array.isArray(result.eventDeclarations) &&
        result.eventDeclarations.some(d => d.kind === 'adjutant' && Boolean(d.adjutant));
      const stat_data: StatData =
        hasAdjutantDecls || result.factionUnlocks.length > 0
          ? {
              ...parsedSnap,
              command: cloneCommandHQ(parsedSnap),
              ...(result.factionUnlocks.length > 0
                ? {
                    forces: {
                      ...parsedSnap.forces,
                      vehicles: Array.isArray(parsedSnap.forces?.vehicles) ? [...parsedSnap.forces.vehicles] : [],
                    },
                  }
                : {}),
            }
          : parsedSnap;
      if (hasAdjutantDecls) {
        for (const decl of result.eventDeclarations) {
          if (decl.kind === 'adjutant' && decl.adjutant) {
            const adjLogs = applyAdjutantEventDeclaration(stat_data, decl.adjutant);
            for (const msg of adjLogs) {
              result.events.push({
                light: '🟢',
                layer: 'instruction',
                message: msg,
                path: 'command.adjutants',
              });
            }
          }
        }
      }
      if (result.factionUnlocks.length > 0) {
        const unlockLogs = applyFactionUnlockSettlement(stat_data, result.factionUnlocks);
        for (const msg of unlockLogs) {
          result.events.push({
            light: msg.includes('防刷拦截') ? '🟡' : '🟢',
            layer: 'instruction',
            message: msg,
            path: 'command.unlocked_factions',
          });
        }
      }
      const settled = settleFloor(baseline?.stat_data, stat_data, raw, {
        catalog,
        extraDeltaMinutes: opts.extraDeltaMinutes,
        // CTRL-DISPATCH-PARSE-01：解析出的本楼调度令直通结算（缺省/空数组时 settleFloor 不注入，行为零变化）
        orders: result.orders,
        // CTRL-DEPLOY-PARSE-01（E3b 接线）：解析出的本楼部署令直通结算 ④″（缺省/空数组 settleFloor 不入账，行为零变化）
        deployOrders: result.deployOrders,
        // EVT-PIPE-01 + PRT-EVT-01（事件系统总设计案 §6.2/§3.3 · 协议玩法 MVP 任务包 §3.6.1）：
        // <事件> 三色门产物直通结算齿轮——资金链声明先于 Δt 时钟落账（建立即时入池计息、
        // 断裂/受挫当期停息），协议声明（协议发现/协议实验）随协议结算齿轮执行启封、
        // 同源确定性实验掷骰与扣点扣款；势力/情报/任务声明已在解析层入账（EVT-PARSE-02）；
        // 缺省/空数组 → 齿轮零副作用跳过（旧档零行为变化）。
        eventDeclarations: result.eventDeclarations.filter(d => d.kind !== 'adjutant'),
      });
      result.data = settled.data;
      result.events.push(...settled.events);
      result.issues.push(...settled.issues);
      const s2Snap = settled.data;
      recordTraceStage(traceId, 'S2_SETTLE', {
        beforeSnap: parsedSnap,
        afterSnap: s2Snap,
        durationMs: Math.round((performance.now() - s2Start) * 100) / 100,
        status: settled.issues.some(i => i.level === 'error' || i.level === 'warn') ? 'warn' : 'ok',
        summary: `结算完成 · Δt=${settled.deltaMinutes}m (${settled.deltaSource})`,
        meta: {
          deltaMinutes: settled.deltaMinutes,
          deltaSource: settled.deltaSource,
        },
        substages: settled.substages,
      });

      // 三色对账门（CTRL-RECONCILE-01）：settleFloor 之后、落盘之前；无声明零成本跳过。
      // settling→done 唯一通道（设计案 §2.2 铁律3）；事件经 R23 映射入报告流水供 CHRONO 横幅消费。
      // F2-乙 收讫通道归一：战况.操作.完成 收讫声明经适配器映射，与 <生产> 块声明喂同一个 reconcileProduction。
      const s3Start = performance.now();
      const {
        buildItemCategoriesFromCatalog,
        parseProductionDeclarations,
        reconcileProduction,
        reconcileEventToParseEvent,
        reconcileEventToIssue,
        operationCompletionsToDeclarations,
      } = await import('../engines/productionReconciliation');
      const productionParsed = parseProductionDeclarations(thinkFreeRaw);
      // 过滤同楼已通过 <战况> 直接落账（且无在册队列）的完成声明，以及同楼无队列直完的科研项目，避免误报 no_txn OVERRUN
      const researchNamesCanon = new Set<string>();
      for (const r of catalog?.researches ?? []) {
        researchNamesCanon.add(canon(r.name));
        for (const a of (r as { aliases?: string[] }).aliases ?? []) {
          if (a) researchNamesCanon.add(canon(a));
        }
      }
      for (const c of result.data.codex ?? []) {
        if (c.kind === '科技' && c.name) researchNamesCanon.add(canon(c.name));
      }
      const filteredOpCompletions = result.operationCompletions.filter(op => {
        const cItem = canon(op.item);
        const hasQueueCandidate = (result.data.queues ?? []).some(q => canon(q.item) === cItem);
        if (hasQueueCandidate) return true;
        if (researchNamesCanon.has(cItem)) {
          if (!result.data.tech.done.some(d => canon(d) === cItem)) {
            result.data = {
              ...result.data,
              tech: {
                ...result.data.tech,
                done: [...result.data.tech.done, op.item],
              },
            };
          }
          return false;
        }
        const inBuildings = (result.data.bases ?? []).some(b =>
          (b.buildings ?? []).some(bld => canon(bld.name) === cItem && bld.state === '运转'),
        );
        const inTroops = Object.keys(result.data.forces?.troops ?? {}).some(k => canon(k) === cItem);
        const inVehicles = (result.data.forces?.vehicles ?? []).some(v => canon(v) === cItem);
        if (inBuildings || inTroops || inVehicles) return false;
        return true;
      });
      const completionDecls = operationCompletionsToDeclarations(result.data, filteredOpCompletions);
      const reconcileInput = {
        found: productionParsed.found || completionDecls.length > 0,
        declarations: [...productionParsed.declarations, ...completionDecls],
        rejected: productionParsed.rejected,
      };
      const hasRemainingSettling = (result.data.queues ?? []).some(q => q.status === 'settling');
      if (reconcileInput.found || hasRemainingSettling) {
        const derivedItemCategories = buildItemCategoriesFromCatalog(catalog);
        const reconcileState =
          Object.keys(derivedItemCategories).length > 0
            ? {
                ...result.data,
                itemCategories: {
                  ...derivedItemCategories,
                  ...((result.data as { itemCategories?: Record<string, 'troops' | 'vehicles' | 'equipment'> })
                    .itemCategories ?? {}),
                },
              }
            : result.data;
        const reconciled = reconcileProduction(reconcileState, reconcileInput, {
          autoSettleRemaining: true,
        });
        const { itemCategories: _omitItemCategories, ...nextWithoutItemCategories } = reconciled.next as StatData & {
          itemCategories?: unknown;
        };
        result.data = nextWithoutItemCategories as StatData;
        chronoVerdicts = reconciled.verdicts.filter(v => v.verdict === 'OVERRUN');
        for (const event of reconciled.events) {
          result.events.push(reconcileEventToParseEvent(event));
          const issue = reconcileEventToIssue(event);
          if (issue) result.issues.push(issue);
        }
        // FIX-P1-03（08 [P1-1]）：当 reconcileProduction 将工程队列项置为 done 后、调用 applyEngOrders 之前，
        // 补跑一次 syncProjects 回写当楼竣工的阶段/模块，使同楼后续 <工程> 注资/推进令可立即生效。
        const { syncProjects } = await import('../engines/projectEngine');
        const syncedAfterReconcile = syncProjects(result.data);
        result.data = recomputeBasePowerFromCatalog(syncedAfterReconcile.next, catalog, [], {
          useBuiltinFallback: true,
        });
        for (const ev of syncedAfterReconcile.events) {
          result.events.push({
            type: ev.type,
            level: ev.type === 'sync_warn' ? 'warning' : 'info',
            item: ev.item,
            message: `[工程] ${ev.type}: ${ev.item}${ev.detail ? ` (${ev.detail})` : ''}`,
          } as unknown as ParseEvent);
        }
      }
      const overrunCount = chronoVerdicts?.length ?? 0;
      recordTraceStage(traceId, 'S3_RECONCILE', {
        beforeSnap: s2Snap,
        afterSnap: result.data,
        durationMs: Math.round((performance.now() - s3Start) * 100) / 100,
        status: overrunCount > 0 || reconcileInput.rejected.length > 0 ? 'warn' : 'ok',
        summary: reconcileInput.found
          ? `生产对账 ${reconcileInput.declarations.length} 项 · OVERRUN ${overrunCount} 项`
          : '无生产对账声明',
        meta: {
          found: reconcileInput.found,
          declarationsCount: reconcileInput.declarations.length,
          rejectedCount: reconcileInput.rejected.length,
          overrunCount,
        },
      });
    } catch (err) {
      console.warn('[useParse] settleFloor 结算异常，本楼按未结算落盘：', err);
    }

    // CTRL-ENG-PROTO-01（DIR-9）：<工程> 工程令接缝——解析产物 EngOrder 逐条结转 projectEngine，
    // 在 settleFloor（含工程里程碑回写 ④‴）之后、落盘之前；接线对齐 orders/deployOrders 直通先例。
    // retrofit 目录读 useCatalog 模块级缓存快照；缺席/异常 → 空目录（立项/注资因 def 缺失拒收留痕），
    // 绝不阻断解析落盘。驳回令账本不动（只登记回执事件）；引擎拒收 → 🟡 事件 + 🔴 隔离区，不静默吞。
    const s3AfterSnap = result.data;
    const s4Start = performance.now();
    if (result.engOrders.length > 0) {
      try {
        const engRetrofits: RetrofitDef[] = catalogSnap?.retrofits ?? [];
        const engProjects: ProjectDef[] = catalogSnap?.projects ?? [];
        const { applyEngOrders } = await import('../engines/engOrderBridge');
        const bridged = applyEngOrders(result.data, result.engOrders, engRetrofits, engProjects);
        result.data = bridged.next;
        result.events.push(...bridged.events);
        result.quarantine.push(...bridged.quarantine);
      } catch (err) {
        console.warn('[useParse] 工程令接缝异常，本楼按未结转落盘：', err);
      }
    }

    // PLAN-COMMIT-01：<排产计划> 排产意图接缝——在 settleFloor 之后、落盘之前结转 commitPlanningIntent，
    // 天然保证本楼新增入队项以 status='queued', spent_minutes=0 零时间落盘，绝不吃本楼 Δt 推进。
    if (result.planningDecls && result.planningDecls.length > 0) {
      try {
        const snap = catalogSnap;
        const { commitPlanningIntent } = await import('../planning/planningReceipt');
        for (const decl of result.planningDecls) {
          const committed = commitPlanningIntent(result.data, decl, snap, { floor: message_id });
          result.data = committed.next;
          result.events.push(...committed.events);
        }
      } catch (err) {
        console.warn('[useParse] 排产计划接缝异常，本楼按未结转落盘：', err);
      }
    }
    const s4Snap = result.data;
    recordTraceStage(traceId, 'S4_BRIDGES', {
      beforeSnap: s3AfterSnap,
      afterSnap: s4Snap,
      durationMs: Math.round((performance.now() - s4Start) * 100) / 100,
      status: 'ok',
      summary:
        result.engOrders.length > 0 || (result.planningDecls?.length ?? 0) > 0
          ? `工程令 ${result.engOrders.length} 条 · 排产计划 ${result.planningDecls?.length ?? 0} 份`
          : '无工程令与排产计划',
      meta: {
        engOrdersCount: result.engOrders.length,
        planningDeclsCount: result.planningDecls?.length ?? 0,
      },
    });

    // 写前复核：聊天未切换（切了就 fail-closed 拒写）
    const s5Start = performance.now();
    if (opts.expectChatId !== undefined) {
      const currentChat = readCurrentChatId();
      if (currentChat !== null && currentChat !== opts.expectChatId) {
        console.warn(
          `[useParse] 写前复核聊天切换：期望 ${opts.expectChatId}，实测 ${currentChat}，fail-closed 放弃写入`,
        );
        recordTraceStage(traceId, 'S5_GUARD_RECHECK', {
          beforeSnap: s4Snap,
          afterSnap: s4Snap,
          durationMs: Math.round((performance.now() - s5Start) * 100) / 100,
          status: 'blocked',
          summary: `写前复核聊天已切换（期望 ${opts.expectChatId}，实测 ${currentChat}）`,
          meta: { outcome: 'chat-changed', expectChatId: opts.expectChatId, currentChat },
        });
        finishFloorTrace(traceId, { outcome: 'blocked', finalSnap: s4Snap });
        return 'chat-changed';
      }
    }

    // 写前复核：swipe 未漂移（方案甲②）——TH replaceVariables 以写入时刻 swipe_id 落槽，
    // 读写到落盘间用户切页会把 stat_data 错位写进别的 swipe 槽（F3 根因 R1）。
    // 漂移则 fail-closed 弃写，并按新上下文自动重排一次（上限 3 次防链式活锁）。
    let swipeAtWrite = swipeAtRead;
    try {
      const msgNow = gcm(message_id)[0];
      if (msgNow && typeof msgNow.swipe_id === 'number' && Number.isInteger(msgNow.swipe_id)) {
        swipeAtWrite = msgNow.swipe_id;
      }
    } catch {
      /* 读失败按未漂移处理（不放大故障面） */
    }
    if (swipeAtWrite !== swipeAtRead) {
      console.warn(
        `[useParse] 写前复核 swipe 漂移：读时 swipe ${swipeAtRead}、写时 swipe ${swipeAtWrite}，fail-closed 弃写并重排`,
      );
      recordTraceStage(traceId, 'S5_GUARD_RECHECK', {
        beforeSnap: s4Snap,
        afterSnap: s4Snap,
        durationMs: Math.round((performance.now() - s5Start) * 100) / 100,
        status: 'blocked',
        summary: `写前复核 Swipe 漂移（读时 ${swipeAtRead}，写时 ${swipeAtWrite}）`,
        meta: { outcome: 'swipe-drifted', swipeAtRead, swipeAtWrite },
      });
      finishFloorTrace(traceId, { outcome: 'blocked', finalSnap: s4Snap });
      const retry = (opts._swipeRetry ?? 0) + 1;
      if (retry <= 3) {
        setTimeout(() => {
          void runParseFor(message_id, { ...opts, _swipeRetry: retry });
        }, 0);
      }
      return 'swipe-drifted';
    }
    recordTraceStage(traceId, 'S5_GUARD_RECHECK', {
      beforeSnap: s4Snap,
      afterSnap: s4Snap,
      durationMs: Math.round((performance.now() - s5Start) * 100) / 100,
      status: 'ok',
      summary: '双重守卫复核通过',
      meta: { outcome: 'ok', swipeAtRead, swipeAtWrite },
    });

    // SEAM-02：过程量幂等重放——从 $timeline 读取当前 (message_id, swipeAtRead) 槽位的玩家交互过程量 opLog，
    // 在写回本楼 stat_data 前按序重放（排产批准、时序裁决、YAML 修复、数据补丁裁决 100% 自动恢复）
    const s6Start = performance.now();
    try {
      const slot = getSwipeSlot(readTimelineLedger(), message_id, swipeAtRead);
      if (slot && slot.opLog.length > 0) {
        const opsForReplay = slot.opLog.map(op =>
          op.kind === 'COMMIT_PLANNING' &&
          (Array.isArray(op.queuesSnapshot) || typeof op.creditsAfter === 'number')
            ? { ...op, intentSnapshot: undefined }
            : op,
        );
        result.data = replayFloorProcessOps(
          result.data as unknown as Record<string, unknown>,
          opsForReplay,
          { catalog: catalogSnap, floorId: message_id },
        ) as unknown as StatData;
        // parseMessageText 重跑 <数据更新> 时会重新生成随机 patch_id，按 patchTarget 二次对齐收敛 pending_data_patches
        for (const op of slot.opLog) {
          if (op.kind !== 'PATCH_DECISION' || !Array.isArray(result.data.pending_data_patches)) continue;
          if (op.decision === 'approve' || op.decision === 'reject') {
            result.data = {
              ...result.data,
              pending_data_patches: result.data.pending_data_patches.filter(
                p => p.id !== op.patchId && (!op.patchTarget || p.target !== op.patchTarget),
              ),
            };
          } else if (op.decision === 'defer') {
            result.data = {
              ...result.data,
              pending_data_patches: result.data.pending_data_patches.map(p =>
                p.id === op.patchId || (op.patchTarget && p.target === op.patchTarget)
                  ? { ...p, status: 'deferred' as const }
                  : p,
              ),
            };
          }
        }
      }
    } catch (err) {
      console.warn('[useParse] 过程量重放异常，按基础解析结果落盘：', err);
    }

    // BUG-LIVE-02a/02b & BUG-LIVE-10：S4_BRIDGES（<工程>/<排产计划>）与 S6_PROCESS_REPLAY（交互特批重放）之后、
    // 落盘之前，对本楼接缝新入队或调序的队列执行一次 0 分钟工期回填与空闲产线升格门（spent_minutes=0）。
    if (
      result.engOrders.length > 0 ||
      (result.planningDecls && result.planningDecls.length > 0) ||
      (getSwipeSlot(readTimelineLedger(), message_id, swipeAtRead)?.opLog.some(
        op => op.kind === 'COMMIT_PLANNING',
      ) ??
        false)
    ) {
      try {
        const { promoteIdleQueuesAtZeroDelta } = await import('../engines/settleFloor');
        const promotedAfterBridges = promoteIdleQueuesAtZeroDelta(result.data, catalogSnap);
        result.data = promotedAfterBridges.data;
        result.events.push(...promotedAfterBridges.events);
        result.issues.push(...promotedAfterBridges.issues);
      } catch (err) {
        console.warn('[useParse] 落盘前0分钟升格门异常：', err);
      }
    }

    // 落盘本楼（必落快照：无 tag / 全隔离也把归一基线写入，杜绝"渲染开局态"）
    await uvw(v => _.set(v, 'stat_data', result.data), { type: 'message', message_id });

    const green = result.events.filter(e => e.light === '🟢').length;
    const yellow = result.events.filter(e => e.light === '🟡').length;
    // CTRL-UI-AUDIT-01：ISO 时间单次取定——log 时间戳 / $parse.reports 瘦身档 / 内存档 persistedAt 三处同指纹
    const nowIso = new Date().toISOString();
    const report: ParseReport = {
      message_id,
      time: new Date().toLocaleTimeString(),
      applied: result.applied,
      events: result.events,
      issues: result.issues,
      quarantineCount: result.quarantine.length,
      undoable: yellow > 0 && prevHad,
      undoBaseline: yellow > 0 && prevHad ? prevOwn : undefined,
      downstreamWarning: opts.downstreamWarning,
      persistedAt: nowIso,
    };
    await persistParse(
      uvw,
      message_id,
      hash,
      swipeAtRead,
      {
        message_id,
        time: nowIso,
        applied: result.applied,
        green,
        yellow,
        quarantine: result.quarantine.length,
        note: opts.downstreamWarning ? '编辑旧楼重解析' : undefined,
      },
      result.quarantine,
      result.issues,
      toPersistedReport(report, nowIso),
    );
    writeTimelineLedger(l => {
      ensureSwipeSlot(l, message_id, swipeAtRead, hash);
    });

    // 内存态：隔离区覆盖 + 报告流水
    if (result.quarantine.length) parseState.quarantine[String(message_id)] = result.quarantine;
    else delete parseState.quarantine[String(message_id)];
    pushReport(report);
    // CHRONO 暂存落笔：本楼有 OVERRUN 裁决 → 供悬浮窗横幅消费；无则清空（陈旧横幅不跨楼残留）
    parseState.chrono = chronoVerdicts?.length
      ? {
          message_id,
          chatId: opts.expectChatId ?? readCurrentChatId(),
          swipe_id: swipeAtRead,
          swipeKey,
          hash,
          verdicts: chronoVerdicts,
          at: new Date().toISOString(),
        }
      : null;
    recordTraceStage(traceId, 'S6_COMMIT_FEED', {
      beforeSnap: s4Snap,
      afterSnap: result.data,
      durationMs: Math.round((performance.now() - s6Start) * 100) / 100,
      status: 'ok',
      summary: `落盘完成 · 🟢${green} 🟡${yellow} 🔴${result.quarantine.length}`,
      meta: {
        green,
        yellow,
        quarantine: result.quarantine.length,
      },
    });
    finishFloorTrace(traceId, {
      outcome: 'ok',
      finalSnap: result.data,
      events: result.events.map(ev => ({
        level: ev.light,
        domain: ev.layer,
        code: ev.path,
        msg: ev.message,
      })),
      issues: result.issues.map(iss => ({
        level: iss.level,
        code: iss.rule,
        message: iss.target ? `[${iss.target}] ${iss.message}` : iss.message,
      })),
      quarantine: result.quarantine.map(q => ({
        blockType: q.tag ?? q.path ?? q.scope,
        reason: q.error,
        headerLine: q.raw.slice(0, 120),
      })),
    });
    return 'parsed';
  } finally {
    parseState.busy = false;
  }
}

/** 隔离区出路①：重跑本楼（force，天然吃到玩家改过的原文） */
export function retryFloor(message_id: number): Promise<RunOutcome> {
  return runParseFor(message_id, { force: true });
}

/**
 * 当前 swipe 槽缺 stat_data？（CTRL-FLOOR-HEAL-01 方案甲④/乙共享检测）
 * TH 消息变量按 swipe 分槽：竞态错位写入 / 事件吞没可致某页槽位留空，而 done 幂等键已命中 →
 * hash 幂等会永久跳过（F3 死锁态）。此函数只做检测；parseRunner 据此 force 自愈，面板据此亮修复入口。
 * 非 AI 楼 / 隐藏楼 / 环境异常一律 false（不误报、不放大故障面）。
 */
export async function swipeSlotMissing(message_id: number): Promise<boolean> {
  const api = apis();
  if (!api) return false;
  try {
    const msg = api.gcm(message_id)[0];
    if (!msg || msg.role === 'user' || msg.is_hidden) return false;
    const own = api.gv({ type: 'message', message_id });
    return !_.has(own, 'stat_data');
  } catch {
    return false;
  }
}

/**
 * 隔离区出路②：玩家在 UI 改好的 YAML 走 parseMessageText 同管道重解析入库（不绕过校验）。
 * 基线 = 本楼当前 stat_data（其余块的增量已在其中）；成功后从隔离区摘除该项，新产生的隔离项并入。
 */
export async function submitFix(
  message_id: number,
  item: QuarantineItem,
  fixedText: string,
): Promise<{ ok: true; result: ParseResult } | { ok: false; error: string }> {
  const api = apis();
  if (!api) return { ok: false, error: '仅真机可用' };
  const { gv, uvw } = api;
  parseState.busy = true;
  try {
    let base: unknown;
    try {
      base = _.get(gv({ type: 'message', message_id }), 'stat_data');
    } catch {
      base = undefined;
    }
    let currentSwipe = 0;
    try {
      const msgNow = api.gcm(message_id)?.[0];
      if (msgNow && typeof msgNow.swipe_id === 'number' && Number.isInteger(msgNow.swipe_id)) {
        currentSwipe = msgNow.swipe_id;
      }
    } catch {
      currentSwipe = 0;
    }
    const raw = wrapFixText(fixedText, item.tag);
    const fixBaselineSnap = base ?? {};
    const fixTraceId = beginFloorTrace(
      {
        chatId: readCurrentChatId(),
        floorId: message_id,
        swipeId: currentSwipe,
        source: 'fix',
        rawTagsPreview: item.tag ? [`<${item.tag}>`] : [],
      },
      fixBaselineSnap,
    );
    const fixS1Start = performance.now();
    let authority: AuthorityInput | undefined;
    try {
      authority = await buildAuthority(codexNamesOf(base));
    } catch {
      authority = undefined;
    }
    const result = parseMessageText(raw, base, {
      isFirstFloor: message_id === 0,
      floorId: message_id,
      authority,
    });
    // F2-乙：修复 YAML 里的 操作.完成 收讫声明同样归一喂门（不推进时间，只裁决入账）
    if (result.operationCompletions.length) {
      const {
        reconcileProduction,
        reconcileEventToParseEvent,
        reconcileEventToIssue,
        operationCompletionsToDeclarations,
      } = await import('../engines/productionReconciliation');
      const reconciled = reconcileProduction(result.data, {
        found: true,
        declarations: operationCompletionsToDeclarations(result.data, result.operationCompletions),
        rejected: [],
      });
      result.data = reconciled.next;
      for (const event of reconciled.events) {
        result.events.push(reconcileEventToParseEvent(event));
        const issue = reconcileEventToIssue(event);
        if (issue) result.issues.push(issue);
      }
    }
    const fixAfterS1 = result.data;
    recordTraceStage(fixTraceId, 'S1_PARSE', {
      beforeSnap: fixBaselineSnap,
      afterSnap: fixAfterS1,
      durationMs: Math.round((performance.now() - fixS1Start) * 100) / 100,
      status: result.quarantine.length > 0 ? 'warn' : 'ok',
      summary: `隔离区修复解析 · 事件 ${result.events.length} 条 · 隔离 ${result.quarantine.length} 项`,
    });

    const fixS4Start = performance.now();
    if (result.engOrders.length > 0) {
      const { effectiveCatalogSnapshot } = await import('./useCatalog');
      const catalogSnap = effectiveCatalogSnapshot();
      const { applyEngOrders } = await import('../engines/engOrderBridge');
      const bridged = applyEngOrders(
        result.data,
        result.engOrders,
        catalogSnap?.retrofits ?? [],
        catalogSnap?.projects ?? [],
      );
      result.data = bridged.next;
      result.events.push(...bridged.events);
      result.quarantine.push(...bridged.quarantine);
    }
    const fixAfterS4 = result.data;
    recordTraceStage(fixTraceId, 'S4_BRIDGES', {
      beforeSnap: fixAfterS1,
      afterSnap: fixAfterS4,
      durationMs: Math.round((performance.now() - fixS4Start) * 100) / 100,
      status: 'ok',
      summary:
        result.engOrders.length > 0 ? `工程令 ${result.engOrders.length} 条` : '无工程令与排产计划',
    });

    const fixS6Start = performance.now();
    await uvw(v => _.set(v, 'stat_data', result.data), { type: 'message', message_id });

    appendFloorProcessOp(message_id, currentSwipe, {
      kind: 'SUBMIT_FIX',
      ts: Date.now(),
      blockType: item.tag ?? '战况',
      fixedYaml: fixedText,
      fixedStatSnapshot: result.data as unknown as Record<string, unknown>,
    });

    // 隔离区收敛：摘除已修复项 + 并入本次新隔离项
    const key = String(message_id);
    const rest = (parseState.quarantine[key] ?? []).filter(
      q => q !== item && !(q.raw === item.raw && q.error === item.error && q.path === item.path),
    );
    const next = [...rest, ...result.quarantine];
    if (next.length) parseState.quarantine[key] = next;
    else delete parseState.quarantine[key];

    const green = result.events.filter(e => e.light === '🟢').length;
    const yellow = result.events.filter(e => e.light === '🟡').length;
    // CTRL-UI-AUDIT-01：ISO 时间单次取定（同 runParseFor 三处同指纹口径）。
    // 顺带修复存量缺陷：本调用原位缺 swipe_id 实参（tsc TS2554: Expected 7 arguments, but got 6）——
    // 实参错位致 logEntry/quarantine/issues 全部落错槽、updater 必抛，$parse 留痕从未生效；
    // hash=null 时 done 不落笔，swipe_id 不参与，补 0 占位并注释。
    const nowIso = new Date().toISOString();
    const report: ParseReport = {
      message_id,
      time: new Date().toLocaleTimeString(),
      applied: result.applied,
      events: result.events,
      issues: result.issues,
      quarantineCount: result.quarantine.length,
      undoable: false,
      note: '编辑后提交',
      persistedAt: nowIso,
    };
    await persistParse(
      uvw,
      message_id,
      null, // 原文没变，hash 保持既有登记
      0, // hash=null 时 done 不落笔，swipe_id 不参与（补位实参，见上修复注记）
      {
        message_id,
        time: nowIso,
        applied: result.applied,
        green,
        yellow,
        quarantine: next.length,
        note: '隔离区编辑后提交',
      },
      next,
      result.issues,
      toPersistedReport(report, nowIso),
    );
    pushReport(report);
    recordTraceStage(fixTraceId, 'S6_COMMIT_FEED', {
      beforeSnap: fixAfterS4,
      afterSnap: result.data,
      durationMs: Math.round((performance.now() - fixS6Start) * 100) / 100,
      status: 'ok',
      summary: `隔离区修复落盘 · 🟢${green} 🟡${yellow} 🔴${next.length}`,
    });
    finishFloorTrace(fixTraceId, {
      outcome: 'ok',
      finalSnap: result.data,
      events: result.events.map(ev => ({
        level: ev.light,
        domain: ev.layer,
        code: ev.path,
        msg: ev.message,
      })),
      issues: result.issues.map(iss => ({
        level: iss.level,
        code: iss.rule,
        message: iss.target ? `[${iss.target}] ${iss.message}` : iss.message,
      })),
      quarantine: next.map(q => ({
        blockType: q.tag ?? q.path ?? q.scope,
        reason: q.error,
        headerLine: q.raw.slice(0, 120),
      })),
    });
    return { ok: true, result };
  } finally {
    parseState.busy = false;
  }
}

/* ═══════════════ CHRONO 横幅纠偏动作（CTRL-UI-CHRONO-01 · A′ 增补） ═══════════════
 * 悬浮窗战术横幅的三键宿主逻辑。红线：横幅组件不自建 eventOn、不改原文；
 * 顺延走 runParseFor(force+extraDeltaMinutes) 重结算（引擎零改动）；特批直写 stat_data
 * （undoFloor 先例），审计事件经 persistParse 入 $parse.log + 报告流水（R23 留痕）。 */

/** 横幅「忽略」：仅清内存暂存（账本/原文零触碰），下一楼解析自然刷新 */
export function dismissChrono(): void {
  parseState.chrono = null;
}

/** 核验暂存裁决的 chat / floor / swipe / hash 完整身份；漂移或不可确认时清暂存并返回拒因 */
function verifyChronoStashIdentity(stash: ChronoStash): string | null {
  const currentChat = readCurrentChatId();
  if (!stash.chatId || currentChat === null || currentChat !== stash.chatId) {
    dismissChrono();
    return '聊天已切换或会话身份不可确认，时序裁决已失效';
  }
  const gcm = tav<GetChatMessages>('getChatMessages');
  if (!gcm) return '仅真机可用';
  let msg: ReturnType<GetChatMessages>[number] | undefined;
  try {
    msg = gcm(stash.message_id)?.[0];
  } catch {
    msg = undefined;
  }
  if (!msg || msg.role === 'user' || msg.is_hidden) {
    dismissChrono();
    return '冲突楼层不存在或不可确认，时序裁决已失效';
  }
  const currentSwipe = typeof msg.swipe_id === 'number' && Number.isInteger(msg.swipe_id) ? msg.swipe_id : 0;
  const currentSwipeKey = makeSwipeScopedKey(stash.message_id, currentSwipe);
  if (
    (stash.swipeKey !== undefined && stash.swipeKey !== currentSwipeKey) ||
    (stash.swipe_id !== undefined && stash.swipe_id !== currentSwipe)
  ) {
    dismissChrono();
    return '楼层 Swipe 已切换，时序裁决已失效';
  }
  if (stash.hash !== undefined && hashText(String(msg.message ?? '')) !== stash.hash) {
    dismissChrono();
    return '楼层原文已变更，时序裁决已失效';
  }
  return null;
}

export interface ChronoActionResult {
  ok: boolean;
  error?: string;
  outcome?: RunOutcome;
  /** 实际注入的顺延分钟数 */
  delta?: number;
}

/**
 * A′ 一键顺延：取暂存中「时序冲突」裁决的 max remainingMinutes 作差额 Δt，
 * 强制重解析本楼（settleFloor 正常结算→物理完工→同楼 <生产> 声明重对账自然 MATCH）。
 * 超产/无在册/未开工/已作废类冲突顺延修不好——顺延后经原仲裁门仍 OVERRUN，横幅继续呈现（诚实）。
 */
export async function autoAdvanceChrono(): Promise<ChronoActionResult> {
  const stash = parseState.chrono;
  if (!stash) return { ok: false, error: '无待纠偏的时序冲突' };
  const identityErr = verifyChronoStashIdentity(stash);
  if (identityErr) return { ok: false, error: identityErr };
  const { autoAdvanceDeltaFor } = await import('../engines/productionReconciliation');
  const delta = autoAdvanceDeltaFor(stash.verdicts);
  if (delta <= 0) return { ok: false, error: '当前冲突不含时序差距，顺延无意义（请用特批或重新生成）' };
  const outcome = await runParseFor(stash.message_id, {
    force: true,
    extraDeltaMinutes: delta,
    expectChatId: stash.chatId ?? undefined,
  });
  if (outcome === 'parsed') {
    const api = apis();
    if (api) {
      try {
        const msgNow = api.gcm(stash.message_id)?.[0];
        const currentSwipe =
          msgNow && typeof msgNow.swipe_id === 'number' && Number.isInteger(msgNow.swipe_id) ? msgNow.swipe_id : 0;
        const nextData = _.get(api.gv({ type: 'message', message_id: stash.message_id }), 'stat_data') as
          | StatData
          | undefined;
        if (nextData && typeof nextData === 'object') {
          const conflictId =
            stash.verdicts
              .map(v => v.item)
              .filter(Boolean)
              .join(',') || `chrono_${stash.message_id}`;
          appendFloorProcessOp(stash.message_id, currentSwipe, {
            kind: 'CHRONO_RESOLVE',
            ts: Date.now(),
            conflictId,
            resolution: 'defer',
            queuesSnapshot: nextData.queues,
            basesSnapshot: nextData.bases,
            forcesSnapshot: nextData.forces as unknown as Record<string, unknown>,
          });
        }
      } catch {
        /* ignore ledger write error */
      }
    }
  }
  return outcome === 'parsed'
    ? { ok: true, outcome, delta }
    : { ok: false, outcome, delta, error: `顺延重解析未落盘：${outcome}` };
}

export const deferChronoConflict = autoAdvanceChrono;

/**
 * [重新生成] 宿主逻辑（CTRL-UI-CHRONO-01）：撤回冲突楼 → /trigger 重生成。
 * 写 API 收口在本层（中控悬浮窗只读红线：源码 0 命中 triggerSlash/createChatMessages 等）。
 * 仅当冲突楼为最新楼才放行；撤回将移除该楼全部 swipe 与楼内变量（confirm 在 UI 层完成）。
 * 成功后 GENERATION_ENDED 观察者自动重解析新楼，chrono 暂存随解析自然刷新。
 */
export async function regenerateChronoFloor(): Promise<ChronoActionResult> {
  const stash = parseState.chrono;
  if (!stash) return { ok: false, error: '无待纠偏的时序冲突' };
  const glmi = tav<() => number>('getLastMessageId');
  const del =
    tav<(ids: number[], o?: { refresh?: 'none' | 'affected' | 'all' }) => Promise<void>>('deleteChatMessages');
  const trig = tav<(cmd: string) => Promise<string>>('triggerSlash');
  if (!glmi || !del || !trig) return { ok: false, error: '仅真机可用' };
  const identityErr = verifyChronoStashIdentity(stash);
  if (identityErr) return { ok: false, error: identityErr };
  let last: number;
  try {
    last = glmi();
  } catch {
    return { ok: false, error: '楼号读取失败' };
  }
  if (stash.message_id !== last) {
    return {
      ok: false,
      error: `冲突楼 #${stash.message_id} 不是最新楼 #${last}，无法重新生成（请用顺延/特批）`,
    };
  }
  await del([stash.message_id], { refresh: 'all' });
  dismissChrono(); // 楼已撤，横幅即刻收起；新楼解析后若有冲突会重新入暂存
  await trig('/trigger');
  return { ok: true };
}

export interface ForceCommissionOutcome {
  ok: boolean;
  /** 成功特批入役的项目名 */
  commissioned: string[];
  /** 不可特批/特批失败的原因清单（no_txn/cancelled/候选不唯一等） */
  failures: string[];
  error?: string;
}

/**
 * 🔴 驾驶员逃生舱入口：对暂存中全部可特批目标（time_conflict/over_qty/not_started）逐一直接入役。
 * 写前复核聊天未漂移；全部失败或无目标不落盘。特批后修剪暂存（已批目标摘除，其余冲突保留）。
 */
export async function forceCommissionChrono(): Promise<ForceCommissionOutcome> {
  const stash = parseState.chrono;
  if (!stash) return { ok: false, commissioned: [], failures: [], error: '无待纠偏的时序冲突' };
  const api = apis();
  if (!api) return { ok: false, commissioned: [], failures: [], error: '仅真机可用' };
  const identityErr = verifyChronoStashIdentity(stash);
  if (identityErr) return { ok: false, commissioned: [], failures: [], error: identityErr };
  const { gv, uvw } = api;

  // 可特批目标去重（canon(item)+canon(base) 键）；no_txn/cancelled 无在册事务可批，直接进 failures
  const targets = new Map<string, { item: string; base?: string }>();
  const failures: string[] = [];
  for (const v of stash.verdicts) {
    if (v.verdict !== 'OVERRUN') continue;
    if (v.overrunKind === 'no_txn' || v.overrunKind === 'cancelled') {
      failures.push(`「${v.item}」${v.overrunKind === 'no_txn' ? '无在册事务' : '目标已作废'}，不可特批`);
      continue;
    }
    targets.set(`${canon(v.item)} ${canon(v.base ?? '')}`, { item: v.item, base: v.base });
  }
  if (!targets.size) {
    return { ok: false, commissioned: [], failures, error: '没有可特批的在册目标' };
  }

  parseState.busy = true;
  try {
    const { forceCommission, reconcileEventToParseEvent, reconcileEventToIssue } =
      await import('../engines/productionReconciliation');
    let working: StatData;
    try {
      working = _.get(gv({ type: 'message', message_id: stash.message_id }), 'stat_data') as StatData;
    } catch {
      return { ok: false, commissioned: [], failures, error: '本楼 stat_data 读取失败' };
    }
    if (!working || typeof working !== 'object' || !Array.isArray((working as StatData).queues)) {
      return { ok: false, commissioned: [], failures, error: '本楼无有效 stat_data.queues' };
    }

    const commissioned: string[] = [];
    const events: ParseEvent[] = [];
    const issues: CheckIssue[] = [];
    for (const t of targets.values()) {
      const res = forceCommission(working, t);
      if (!res) {
        failures.push(`「${t.item}」在册候选不唯一或不存在，特批失败（请先补消歧或走重试）`);
        continue;
      }
      working = res.next;
      commissioned.push(res.commissioned.item);
      for (const e of res.events) {
        events.push(reconcileEventToParseEvent(e));
        const issue = reconcileEventToIssue(e);
        if (issue) issues.push(issue);
      }
    }
    if (!commissioned.length) {
      return { ok: false, commissioned, failures, error: '全部目标特批失败，账本未动' };
    }

    // 写前复核：聊天/Swipe/原文未漂移（沿用 runParseFor 同款 fail-closed）
    const preWriteErr = verifyChronoStashIdentity(stash);
    if (preWriteErr) {
      return { ok: false, commissioned: [], failures, error: preWriteErr };
    }

    await uvw(v => _.set(v, 'stat_data', working), { type: 'message', message_id: stash.message_id });

    let currentSwipe = 0;
    try {
      const msgNow = api.gcm(stash.message_id)?.[0];
      if (msgNow && typeof msgNow.swipe_id === 'number' && Number.isInteger(msgNow.swipe_id)) {
        currentSwipe = msgNow.swipe_id;
      }
    } catch {
      currentSwipe = 0;
    }
    appendFloorProcessOp(stash.message_id, currentSwipe, {
      kind: 'CHRONO_RESOLVE',
      ts: Date.now(),
      conflictId: commissioned.join(',') || `chrono_${stash.message_id}`,
      resolution: 'force',
      queuesSnapshot: working.queues,
      basesSnapshot: working.bases,
      forcesSnapshot: working.forces as unknown as Record<string, unknown>,
    });

    // $parse 留痕（hash 保持既有登记）；隔离区条目原样保留（先读出现值防误清）
    let quarantine: QuarantineItem[] = [];
    try {
      const chat = await gv({ type: 'chat' });
      quarantine = normalizeParseRoot(_.get(chat, '$parse')).quarantine[String(stash.message_id)] ?? [];
    } catch {
      quarantine = parseState.quarantine[String(stash.message_id)] ?? [];
    }
    // CTRL-UI-AUDIT-01：ISO 时间单次取定（同 runParseFor 口径）。
    // 顺带修复存量缺陷：本调用原位缺 swipe_id 实参（tsc TS2554）——实参错位致 updater 必抛，
    // 特批留痕从未生效；hash=null 时 done 不落笔，swipe_id 不参与，补 0 占位并注释。
    const nowIso = new Date().toISOString();
    const report: ParseReport = {
      message_id: stash.message_id,
      time: new Date().toLocaleTimeString(),
      applied: true,
      events,
      issues,
      quarantineCount: quarantine.length,
      undoable: false,
      note: '驾驶员强制特批入役',
      persistedAt: nowIso,
    };
    await persistParse(
      uvw,
      stash.message_id,
      null,
      0, // hash=null 时 done 不落笔，swipe_id 不参与（补位实参，见上修复注记）
      {
        message_id: stash.message_id,
        time: nowIso,
        applied: true,
        green: events.filter(e => e.light === '🟢').length,
        yellow: events.filter(e => e.light === '🟡').length,
        quarantine: quarantine.length,
        note: '驾驶员强制特批入役',
      },
      quarantine,
      issues,
      toPersistedReport(report, nowIso),
    );
    pushReport(report);

    // 修剪暂存：已特批目标摘除；仍有 OVERRUN 残留则横幅继续呈现
    let remaining = stash.verdicts;
    for (const [key, t] of targets) {
      if (!commissioned.includes(t.item)) continue;
      remaining = remaining.filter(v => `${canon(v.item)} ${canon(v.base ?? '')}` !== key);
    }
    parseState.chrono = remaining.some(v => v.verdict === 'OVERRUN') ? { ...stash, verdicts: remaining } : null;
    return { ok: true, commissioned, failures };
  } finally {
    parseState.busy = false;
  }
}

/**
 * 下游级联重算：
 * 从 `fromMid + 1` 遍历到 `toMid ?? lastMessageId`，对每个存在的 AI 楼层依次调用 `await runParseFor(m, true)` 并返回重算的楼层号列表。
 */
export async function cascadeRecomputeDownstream(fromMid: number, toMid?: number): Promise<number[]> {
  let endMid: number;
  if (typeof toMid === 'number' && Number.isFinite(toMid)) {
    endMid = Math.trunc(toMid);
  } else {
    const glmi = tav<() => number>('getLastMessageId');
    if (!glmi) return [];
    try {
      endMid = glmi();
    } catch {
      return [];
    }
    if (!Number.isFinite(endMid)) return [];
  }

  const gcm = tav<GetChatMessages>('getChatMessages');
  const recomputed: number[] = [];
  const startMid = Math.max(0, Math.trunc(fromMid) + 1);

  for (let m = startMid; m <= endMid; m++) {
    if (gcm) {
      try {
        const msg = gcm(m)?.[0];
        if (!msg || msg.role === 'user' || msg.is_hidden) continue;
      } catch {
        continue;
      }
    }
    const outcome = await runParseFor(m, true);
    if (outcome === 'parsed') {
      recomputed.push(m);
    }
  }

  return recomputed;
}

