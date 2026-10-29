import { settleExposureAndMorale } from '../engines/exposureMoraleEngine';
/**
 * parsePipeline.ts —— 纯函数解析管道主入口（批 A 核心）
 *
 * 四层：L0 提取 → L1 语法 → L2 归一 + 按域合并引擎 + 指令联动 → L3 三色裁决。
 * 约束：零 IO / 零酒馆 API / 零 Vue 依赖，可被 node 测试与未来批 B 接线共用。
 * 任何情况下 `data` 都是 Schema.parse 归一产物（合法、可直接落盘）。
 *
 * 依赖的全局：z / _ / YAML（真机由 unplugin-auto-import 注入，node 测试由 setup.ts 注入）。
 */
import {
  buildEntityCredibilityIndex,
  evaluateEntityCredibility,
  extractConceptCanonicalStem,
  extractCoreStem,
  type EntityCredibilityIndex,
} from '../core/entityCredibility';
import { Base, Faction, migrateV1toV2, Quest, Schema } from '../core/schema';
import {
  applyDarknetBlockToState,
  extractDarknetBlocks,
  stripDarknetBlocks,
} from '../engines/darknetEngine';
import {
  extractLaunchCenters,
  extractOrbitalAssets,
  extractSpaceContracts,
  extractSpaceFromParsedValue,
  settleSpaceOperations,
} from '../engines/spaceEngine';
import { normalizeCanonicalWeather } from '../engines/timezoneWeatherEngine';
import { resolveMcvVehicleAliases } from '../engines/deploymentEngine';
import {
  computePlanFingerprint,
  detectLegacyQueueConflict,
  extractPlanningIntent,
  extractWarStatQueueItems,
} from '../planning/planningParser';
import { parseFactionUnlockPayload } from './factionUnlockParser';
import { stripThinking } from './floorSanitize';
import {
  extractFloorSummaries,
  stripSummaryBlocks,
  type ParsedFloorSummaries,
} from './summaryBlockParser';
import { upsertMicroSummary } from '../worldbook/summaryFiler';
import {
  appendIntel,
  applyCasualties,
  applyChainsBlock,
  applyForces,
  applyQuestBlock,
  applyResources,
  applyWallet,
  bridgeExpansionParamsFromQueues,
  bridgeGirlDossierFieldsFromGirlsBlock,
  enforceIntelStorageBounds,
  mapBase,
  mapFaction,
  mapQuest,
  NAME_ALIASES,
  normalizeBaseInputItems,
  syncChristenedGirlsToCodex,
  syncDossierToForcesGirls,
  syncPendingGirls,
  tickWorldEvolutionDecay,
  upsertCodex,
  upsertDossier,
  upsertExpansion,
  upsertGirls,
  worldEvoItemKey,
} from './parseDomainAppliers';
import {
  applyEventGate,
  bookEventEntities,
  extractEvents,
  resolveEventDeployDeclaration,
  upsertDataPatches,
} from './parseEventsAndPatches';
import {
  applyDeployments,
  applyOperations,
  collectEngOrders,
  extractDeployTagBlocks,
  normalizeEngBlockPayload,
  parseDeployTagBody,
  upsertQueues,
} from './parseOrdersAndQueues';
import {
  alignName,
  applyAlign,
  asArray,
  buildAlignIndex,
  BUILTIN_FACTION_BUILDING_NAMES,
  canon,
  ENG_VERBS,
  errText,
  EVENT_QUOTA_PER_FLOOR,
  extractBlocks,
  green,
  isUsable,
  keyIndex,
  newCtx,
  parseBlock,
  quarantineLeftovers,
  setNumField,
  setStr,
  take,
  takeDelta,
  toNum,
  upsertByName,
  yellow,
  type AdjutantEventDecl,
  type AlignHit,
  type AlignIndex,
  type AuthorityInput,
  type ChainEventDecl,
  type Ctx,
  type DeployBlockLike,
  type DeployCatalogIndexLike,
  type DeployEventDecl,
  type DeployOrder,
  type EngOrder,
  type EngOrderVerb,
  type EventDeclaration,
  type EventEntityKind,
  type EventGateResult,
  type EventVerb,
  type FactionEventDecl,
  type IntelEventDecl,
  type OperationCompletion,
  type ParseEvent,
  type ParseResult,
  type ProtocolEventAction,
  type ProtocolEventDecl,
  type ProtocolEventIndexItem,
  type ProtocolIndexSource,
  type ProtocolScheduleVerb,
  type QuarantinedEvent,
  type QuarantineItem,
  type QuestEventDecl,
  type StatData,
  type YellowEventDeclaration,
} from './parseTypesAndCanon';

export {
  applyDarknetBlockToState,
  extractDarknetBlocks,
  extractLaunchCenters,
  extractOrbitalAssets,
  extractSpaceContracts,
  extractFloorSummaries,
  stripSummaryBlocks,
  type ParsedFloorSummaries,
};
export * as parseCommon from './parseCommon';
export * as resourceMerge from './resourceMerge';
export * as engAndDeployOrders from './engAndDeployOrders';
export * as eventDoor from './eventDoor';

export {
  alignName,
  applyChainsBlock,
  applyQuestBlock,
  buildAlignIndex,
  BUILTIN_FACTION_BUILDING_NAMES,
  canon,
  ENG_VERBS,
  EVENT_QUOTA_PER_FLOOR,
  extractEvents,
  type AdjutantEventDecl,
  type AlignHit,
  type AlignIndex,
  type AuthorityInput,
  type ChainEventDecl,
  type DeployBlockLike,
  type DeployCatalogIndexLike,
  type DeployEventDecl,
  type DeployOrder,
  type EngOrder,
  type EngOrderVerb,
  type EventDeclaration,
  type EventEntityKind,
  type EventGateResult,
  type EventVerb,
  type FactionEventDecl,
  type IntelEventDecl,
  type OperationCompletion,
  type ParseEvent,
  type ParseResult,
  type ProtocolEventAction,
  type ProtocolEventDecl,
  type ProtocolEventIndexItem,
  type ProtocolIndexSource,
  type ProtocolScheduleVerb,
  type QuarantinedEvent,
  type QuarantineItem,
  type QuestEventDecl,
  type StatData,
  type YellowEventDeclaration,
};

/** 内置世界书标准通用科技兜底词表（供无外部 authority 注入时对 <排产计划> 科研立项做双擎语义对齐） */
const BUILTIN_SYSTEM_TECH_NAMES = [
  '基础步兵训练学',
  '装甲载具工学',
  '航空工学基础',
  '船舶工学基础',
  '纳米精密合成学',
  '个人装备工程学',
  '军事教育体系学',
  '战地维修工程学',
  '高级作战实验理论',
  '压制火炮工学',
  '全域指挥控制工学',
  '基础化工学',
  '电子对抗工学',
  '电力储能学',
  '核动力潜艇工学',
  '火箭推进基础工学',
  '地下工程学',
  '混合动力装甲工学',
  '可回收火箭工学',
  '轨道侦察工学',
  '无毒推进剂工学',
  '空间站建造工学',
  '卫星组网应用工学',
  '天基资源勘探工学',
  '重型全复用运载工学',
  '在轨组装与发射工学',
  '月面电磁投射工学',
  '全天候天基发射控制学',
  '通用工程与强化工程',
  '通用物流与重载转运理论',
  '通用材料与结构工学',
  '通用导弹制导与再入理论',
  '通用核工程与核安全',
  '机器人维护与人在环自主系统',
  '重型再入与热防护理论',
  '小型模块化核能工学',
  '缴获军械整备与制式化改制工学',
  '异系武备测绘与逆向工程学',
  '跨维异质解构与纳米母本复现学',
  '低可观测技术工学',
] as const;

let _defaultTechCredibilityIndex: EntityCredibilityIndex | null = null;
function getDefaultSystemTechCredibilityIndex(): EntityCredibilityIndex {
  if (!_defaultTechCredibilityIndex) {
    _defaultTechCredibilityIndex = buildEntityCredibilityIndex({
      names: BUILTIN_SYSTEM_TECH_NAMES,
    });
  }
  return _defaultTechCredibilityIndex;
}

/* ═══════════════ 主入口 ═══════════════ */

/**
 * 解析本楼原文→归一后的完整状态 + 三色裁决留痕。
 * @param raw 楼层原文
 * @param baseline 上一有效楼基线（unknown，内部 Schema.parse 归一）
 * @param opts.isFirstFloor 首楼时 <初始状态> 生效
 * @param opts.authority 权威名单 + 别名词典（批 C 实体对齐；缺省时对齐层整体跳过，行为与旧版一致）
 */
export function parseMessageText(
  raw: string,
  baseline: unknown,
  opts: {
    isFirstFloor?: boolean;
    floorId?: number;
    authority?: AuthorityInput;
    credibilityIndex?: EntityCredibilityIndex;
    disallowLegacyWarStatCredits?: boolean;
    deployIndex?: DeployCatalogIndexLike;
    protocolCatalog?: ProtocolIndexSource;
    deferPlanningCommit?: boolean;
  } = {},
): ParseResult {
  const ctx = newCtx();
  if (opts.authority) {
    ctx.align = buildAlignIndex(
      opts.credibilityIndex && !opts.authority.credibilityIndex
        ? { ...opts.authority, credibilityIndex: opts.credibilityIndex }
        : opts.authority,
    );
  } else if (opts.credibilityIndex) {
    ctx.align = buildAlignIndex({
      names: [],
      aliases: {},
      credibilityIndex: opts.credibilityIndex,
    });
  }
  if (opts.deployIndex) ctx.deployIndex = opts.deployIndex;
  // 基线归一：旧档先经唯一迁移入口升级；迁移与 Schema 校验均成功后才进入本轮合并。
  const baselineInput = isUsable(baseline) ? baseline : {};
  const migratedBaseline = migrateV1toV2(baselineInput);
  if (isUsable(migratedBaseline) && Array.isArray((migratedBaseline as Record<string, unknown>).bases)) {
    const rawBases = (migratedBaseline as Record<string, unknown>).bases as unknown[];
    if (rawBases.some(b => isUsable(b) && (b as Record<string, unknown>).status === '运转中')) {
      (migratedBaseline as Record<string, unknown>).bases = rawBases.map(b =>
        isUsable(b) && (b as Record<string, unknown>).status === '运转中' ? { ...b, status: '警戒' } : b,
      );
    }
  }
  const baseData = Schema.parse(migratedBaseline);
  if (migratedBaseline !== baselineInput) {
    yellow(
      ctx,
      { layer: 'L2', path: 'schema_version', message: '旧变量树已从 v1 迁移到 v2', before: 1, after: 2 },
      { rule: 'R18', target: 'schema_version', message: '旧变量树已迁移到 v2' },
    );
  }
  const data: StatData = structuredClone(baseData);
  const preExistingWorldKeys = new Set<string>(
    (data.intel ?? [])
      .filter(it => it && (it as Record<string, unknown>).scope === 'world')
      .map(it => worldEvoItemKey(it as Record<string, unknown>)),
  );
  const touchedWorldKeys = new Set<string>();

  const rawStr = raw ?? '';
  const thinkFreeRaw = stripThinking(rawStr).text;
  const spaceContracts = extractSpaceContracts(thinkFreeRaw);
  const launchCenters = extractLaunchCenters(thinkFreeRaw);
  const orbitalAssets = extractOrbitalAssets(thinkFreeRaw);
  const darknetBlocks = extractDarknetBlocks(thinkFreeRaw);
  const hasSummaryTags =
    /<(?:摘要|summary|中摘要|大摘要)(?=\s|>)/i.test(thinkFreeRaw) ||
    /[\uFF1C](?:摘要|summary|中摘要|大摘要)(?=\s|[\uFF1E])/i.test(thinkFreeRaw);
  const floorSummaries = hasSummaryTags ? extractFloorSummaries(thinkFreeRaw) : { micro: null, delegatedDrafts: [] };

  // E3b / BUG-R2-15：支持顶层独立 <部署>...</部署> 块（位于 <战况>/<态势>/<初始状态> 之外或整层仅含 <部署> 块）
  const hasVocabContainerForDeploy =
    /[<\uFF1C]\s*(?:战况|态势|战区态势|环境态势|环境|situation|初始状态)(?=\s|[>\uFF1E])/i.test(thinkFreeRaw);
  let rawForExtractBlocks = rawStr;
  let topLevelDeployDecls: Record<string, unknown>[] = [];
  if (!hasVocabContainerForDeploy) {
    const topExtracted = extractDeployTagBlocks(rawStr, ctx);
    if (topExtracted.cleaned !== rawStr) {
      rawForExtractBlocks = topExtracted.cleaned;
      topLevelDeployDecls = topExtracted.decls;
    }
  }

  const blocks = !hasVocabContainerForDeploy && topLevelDeployDecls.length > 0 && !/[<\uFF1C]\s*[^\s<>/\uFF1C\uFF1E]+/.test(stripThinking(rawForExtractBlocks).text)
    ? []
    : extractBlocks(rawForExtractBlocks, ctx);

  if (hasVocabContainerForDeploy) {
    let outsideRaw = thinkFreeRaw;
    for (const b of blocks) {
      if (b.inner && b.inner.trim()) outsideRaw = outsideRaw.replace(b.inner, '\n');
    }
    const outsideExtracted = extractDeployTagBlocks(outsideRaw, ctx);
    if (outsideExtracted.decls.length > 0) {
      topLevelDeployDecls.push(...outsideExtracted.decls);
    }
  }

  for (const block of blocks) {
    if (block.tag === '初始状态' && !opts.isFirstFloor) {
      yellow(
        ctx,
        { layer: 'L0', message: '<初始状态> 非首楼出现，已忽略' },
        { rule: 'R18', target: '初始状态', message: '<初始状态> 非首楼已忽略' },
      );
      continue;
    }
    // E3b · <部署> 标签块预提取（设计稿§三）：战况/初始状态原文在 YAML 预处理前先剥离标签块，
    // 声明与 take 认领的 YAML 键形两路汇入同一 deployDecls 流；剥离防标签行被绞成垃圾键误隔离
    let workingBlock = block;
    let deployTagDecls: Record<string, unknown>[] = [];
    if (block.tag === '战况' || block.tag === '态势' || block.tag === '初始状态') {
      const extracted = extractDeployTagBlocks(block.inner, ctx);
      if (extracted.cleaned !== block.inner) workingBlock = { ...block, inner: extracted.cleaned };
      deployTagDecls = extracted.decls;
    }
    // EVT-PARSE-01（CTRL-EVENT-PARSE-01）：<事件> 独立一级标签——块内容整体交 extractEvents
    // 纯函数（自带 YAML 两级容错/数组校验/三色裁决/Q9 配额跨块累计）；链类声明只构造不执行，
    // 结转归 settleFloor 第四齿轮（EVT-SETTLE-01/EVT-PIPE-01）；势力/情报/任务声明在解析层
    // 标准化入账（EVT-PARSE-02：认知账本增量，与 <战况> 同时点；新势力同步进 Q4 暂存门）。
    if (block.tag === '事件') {
      const gate = extractEvents(block.inner, {
        admitted: ctx.eventsAdmitted,
        align: ctx.align,
        catalog: opts.protocolCatalog,
      });
      applyEventGate(gate, ctx);
      bookEventEntities(gate, data, ctx);
      continue;
    }
    if (block.tag === '排产计划') {
      const planRes = extractPlanningIntent(block.inner);
      if (planRes.quarantine.length > 0) {
        ctx.quarantine.push(...(planRes.quarantine as unknown as QuarantineItem[]));
      }
      if (planRes.intent) {
        ctx.planningDecls.push(planRes.intent);
      }
      continue;
    }
    if (block.tag === '阵营解锁') {
      const unlocked = parseFactionUnlockPayload(block.inner);
      if (unlocked) {
        ctx.factionUnlocks.push(unlocked);
      } else {
        ctx.quarantine.push({
          scope: 'block',
          tag: block.tag,
          raw: block.inner.slice(0, 200),
          error: '<阵营解锁> 内容为空或无法识别有效阵营',
          suggestion: '请提供有效阵营标识（如：阵营: 苏联 / 盟军 / 尤里）',
        });
      }
      continue;
    }
    // 剥离后无残余 YAML 内容（标签块独占整块）：跳过 parseBlock，以空树进 applyWarStat，声明照常进段二
    const parsed =
      workingBlock !== block && !workingBlock.inner.trim()
        ? ({} as Record<string, unknown>)
        : parseBlock(workingBlock, ctx);
    if (parsed == null) continue; // 已隔离
    if (block.tag === '图鉴') {
      upsertCodex(
        data.codex as Record<string, unknown>[],
        parsed,
        ctx,
        data.pending_lore as unknown[],
        {
          floorId: opts.floorId,
          currentDay: Number.isFinite(data.meta?.day_count) ? data.meta.day_count : 0,
        },
      );
    } else if (block.tag === '机娘') {
      upsertGirls((data.forces as unknown as Record<string, unknown>).girls as Record<string, unknown>[], parsed, ctx, '机娘');
      bridgeGirlDossierFieldsFromGirlsBlock(
        data.pending_lore as Record<string, unknown>[],
        parsed,
        ctx,
      );
      syncChristenedGirlsToCodex(
        data.codex as Record<string, unknown>[],
        (data.forces as unknown as Record<string, unknown>).girls as Record<string, unknown>[],
        data.pending_lore as Record<string, unknown>[],
      );
    } else if (block.tag === '机娘档案') {
      upsertDossier(data.pending_lore as Record<string, unknown>[], parsed, ctx);
      syncDossierToForcesGirls(
        (data.forces as unknown as Record<string, unknown>).girls as Record<string, unknown>[],
        data.pending_lore as Record<string, unknown>[],
        ctx,
      );
      syncChristenedGirlsToCodex(
        data.codex as Record<string, unknown>[],
        (data.forces as unknown as Record<string, unknown>).girls as Record<string, unknown>[],
        data.pending_lore as Record<string, unknown>[],
      );
    } else if (block.tag === '数据更新') {
      upsertDataPatches(data.pending_data_patches as Record<string, unknown>[], parsed, ctx);
    } else if (block.tag === '扩展档案') {
      upsertExpansion(
        data.pending_expansions as Record<string, unknown>[],
        parsed,
        ctx,
        data.codex as Record<string, unknown>[],
      );
    } else if (block.tag === '工程') {
      // CTRL-ENG-PROTO-01（DIR-9）：<工程> 容器标签 → EngOrder 收集槽（只构造、不执行，结转归 useParse 接缝）
      if (Array.isArray(parsed)) {
        const normalizedEng = normalizeEngBlockPayload(parsed);
        if (!normalizedEng) {
          ctx.quarantine.push({
            scope: 'block',
            tag: block.tag,
            raw: JSON.stringify(parsed).slice(0, 200),
            error: `<${block.tag}> 期望键值映射（动词键: 载荷），得到数组`,
          });
          continue;
        }
        collectEngOrders(normalizedEng, data, ctx);
        continue;
      }
      collectEngOrders(normalizeEngBlockPayload(parsed) ?? (parsed as Record<string, unknown>), data, ctx);
    } else if (block.tag === '选项') {
      applyOptionsBlock(parsed, data, ctx);
    } else if (block.tag === '任务') {
      applyQuestBlock(parsed, data, ctx);
    } else if (block.tag === '资金链') {
      applyChainsBlock(parsed, data, ctx);
    } else if (block.tag === '情报') {
      appendIntel(
        data.intel as Record<string, unknown>[],
        parsed,
        ctx,
        { defaultScope: 'tactical', defaultDate: data.meta?.date || '', touchedWorldKeys },
      );
    } else if (block.tag === '世界演变') {
      appendIntel(
        data.intel as Record<string, unknown>[],
        parsed,
        ctx,
        { defaultScope: 'world', defaultDate: data.meta?.date || '', touchedWorldKeys },
      );
    } else {
      // 态势 / 战况（遗留兼容） / 初始状态（首楼）同用态势状态树按需增量映射
      if (Array.isArray(parsed)) {
        ctx.quarantine.push({
          scope: 'block',
          tag: block.tag,
          raw: JSON.stringify(parsed).slice(0, 200),
          error: `<${block.tag}> 期望键值映射，得到数组`,
        });
        continue;
      }
      ctx.legacyQueueWrites.push(...extractWarStatQueueItems(parsed));
      applyWarStat(parsed as Record<string, unknown>, data, ctx, deployTagDecls, {
        isFirstFloor: opts.isFirstFloor,
        isInitialStateTag: block.tag === '初始状态',
        disallowLegacyWarStatCredits: opts.disallowLegacyWarStatCredits,
      });
    }
  }

  if (topLevelDeployDecls.length > 0) {
    applyDeployments(topLevelDeployDecls, data, ctx);
  }

  if (blocks.length > 0) {
    syncChristenedGirlsToCodex(
      data.codex as Record<string, unknown>[],
      (data.forces as unknown as Record<string, unknown>).girls as Record<string, unknown>[],
      data.pending_lore as Record<string, unknown>[],
    );
    syncPendingGirls(data);
    bridgeExpansionParamsFromQueues(
      data.pending_expansions as Record<string, unknown>[],
      data.queues as Record<string, unknown>[],
    );
    tickWorldEvolutionDecay(data, preExistingWorldKeys, touchedWorldKeys);
    enforceIntelStorageBounds(data);
  }

  // MCV-ENGINE-01：将 <事件> 中解析出的 MCV展开 / MCV收起 (decl.kind === 'deploy') 转化为 DeployOrder 推入 ctx.deployOrders
  for (const decl of ctx.eventDeclarations) {
    if (decl.kind === 'deploy' && decl.deploy) {
      resolveEventDeployDeclaration(decl.deploy, data, ctx);
    }
  }

  // MCV-ZERO-BASE-01：开局零预设基地铁律——若本楼基线尚无任何基地（bases=[]）且车队持有待命 MCV（或已授权首发 MCV 阵营），
  // 但本轮既未下达 MCV 展开指令（deployOrders 为空），<战况> 基地中也无建造厂母体，则拦截并剔除未展开前的空壳预设基地，
  // 确保中控台与账本在 MCV 正式选址展开前严格维持「无在役基地（bases: []）」。
  const hadPreDeployMcvContext =
    baseData.bases.length === 0 &&
    (baseData.forces.vehicles.some(v => resolveMcvVehicleAliases(v).length > 1) ||
      (baseData.command?.mcv_granted_factions?.length ?? 0) > 0);
  if (hadPreDeployMcvContext && ctx.deployOrders.length === 0 && data.bases.length > 0) {
    const conyardNames = new Set(['建造厂', '盟军建造厂', '苏联建造厂', '尤里建造厂', '前沿工地', '作战前哨站']);
    const hasConyardInAnyBase = data.bases.some(b =>
      (b.buildings ?? []).some(bld => conyardNames.has(bld.name.trim())),
    );
    if (!hasConyardInAnyBase) {
      const prematureNames = data.bases.map(b => b.name).join('、');
      const firstLoc = data.bases.find(b => b.location?.trim())?.location?.trim();
      if (firstLoc && !data.meta.location?.trim()) {
        data.meta.location = firstLoc;
      }
      data.bases = [];
      yellow(
        ctx,
        {
          layer: 'L2',
          path: '战况.基地',
          message: `MCV 尚未正式展开，已忽略未展开前的预设基地「${prematureNames}」（待 MCV 展开后正式确立基地）`,
        },
        {
          rule: 'R18',
          target: '战况.基地',
          message: 'MCV 尚未展开，未展开前不预设基地信息',
        },
      );
    }
  }

  if (ctx.planningDecls.length > 0) {
    const hasQueueEvent = ctx.events.some(ev => /queue|队列/i.test(ev.path ?? ''));
    const queueCandidates =
      ctx.legacyQueueWrites.length > 0
        ? ctx.legacyQueueWrites
        : hasQueueEvent
          ? extractWarStatQueueItems(data)
          : [];
    if (queueCandidates.length > 0 || ctx.orders.length > 0) {
      for (const intent of ctx.planningDecls) {
        if (detectLegacyQueueConflict(intent, queueCandidates, ctx.orders)) {
          intent.conflict_with_legacy_queue = true;
        }
      }
    }

    // PKG-D / FD-27：<排产计划> 科研立项（kind === '研究'）名称对齐、防重检测与入队
    for (const intent of ctx.planningDecls) {
      let intentMutated = false;
      for (const action of intent.actions) {
        if (action.base_ref && ctx.align) {
          const alignedBase = applyAlign(action.base_ref, ctx, `排产计划.基地[${action.base_ref}]`, 'entity');
          if (alignedBase !== action.base_ref) {
            action.base_ref = alignedBase;
            intentMutated = true;
          }
        }
        if (action.op !== 'enqueue') continue;
        const isResearchAction = action.kind === '研究';
        const isBuildOrProdCommit =
          (action.kind === '建造' || action.kind === '生产') && intent.mode === 'delegate_once';

        const rawTechName = String(action.catalog_ref ?? action.task_ref ?? '').trim();
        if (!rawTechName) continue;

        const alignMode = isResearchAction ? 'tech' : 'entity';
        const credDomain = isResearchAction
          ? 'research'
          : action.kind === '建造'
            ? 'building'
            : 'production';

        let alignedTechName = ctx.align
          ? applyAlign(rawTechName, ctx, 'queues', alignMode, credDomain)
          : rawTechName;
        if (alignedTechName === rawTechName) {
          const fallbackCred =
            opts.credibilityIndex ??
            ctx.align?.credibilityIndex ??
            getDefaultSystemTechCredibilityIndex();
          const credRes = evaluateEntityCredibility(fallbackCred, rawTechName, {
            domain: credDomain,
            highThreshold: 0.80,
          });
          if (credRes.verdict === 'system_high' && credRes.matchedName) {
            alignedTechName = credRes.matchedName;
            if (alignedTechName !== rawTechName) {
              yellow(
                ctx,
                {
                  layer: 'L2',
                  path: 'queues',
                  message: `实体名模糊对齐 "${rawTechName}" → "${alignedTechName}"`,
                  before: rawTechName,
                  after: alignedTechName,
                  align: { from: rawTechName, to: alignedTechName },
                },
                {
                  rule: 'R19',
                  target: 'queues',
                  message: `模糊对齐 "${rawTechName}" → "${alignedTechName}"`,
                },
              );
            }
          }
        }

        if (alignedTechName !== action.catalog_ref) {
          action.catalog_ref = alignedTechName;
          intentMutated = true;
        }
        if (!isResearchAction && !isBuildOrProdCommit) continue;

        const targetCoreStem = extractCoreStem(alignedTechName);
        const targetConceptStem = extractConceptCanonicalStem(alignedTechName);
        const matchesTechName = (candidate: string): boolean => {
          const candTrimmed = String(candidate ?? '').trim();
          if (!candTrimmed) return false;
          if (canon(candTrimmed) === canon(alignedTechName) || canon(candTrimmed) === canon(rawTechName)) {
            return true;
          }
          if (targetCoreStem.length >= 2 && extractCoreStem(candTrimmed) === targetCoreStem) {
            return true;
          }
          if (
            targetConceptStem.length >= 4 &&
            extractConceptCanonicalStem(candTrimmed) === targetConceptStem
          ) {
            return true;
          }
          return false;
        };

        if (isResearchAction) {
          const doneList = ((data.tech as unknown as Record<string, unknown>)?.done ?? []) as string[];
          if (doneList.some(d => matchesTechName(d))) {
            yellow(
              ctx,
              {
                layer: 'L2',
                path: `queues[${alignedTechName}]`,
                message: `科技「${alignedTechName}」已在已研科技列表中，跳过重复科研立项`,
                before: rawTechName,
                after: alignedTechName,
              },
              {
                rule: 'R18',
                target: `queues[${alignedTechName}]`,
                message: `科技「${alignedTechName}」已研发完成，已跳过重复入队`,
              },
            );
            continue;
          }
        }

        const queuesList = data.queues as Record<string, unknown>[];
        const hasLegacyConflictOnThisTech = queueCandidates.some(qc =>
          matchesTechName(
            String(
              qc.item ??
                qc.name ??
                qc.项目 ??
                qc.条目 ??
                qc.名称 ??
                qc.target ??
                '',
            ),
          ),
        );
        const alreadyInQueue =
          isResearchAction &&
          queuesList.some(q => {
            const qStatus = String(q.status ?? 'active');
            if (qStatus === 'done' || qStatus === 'cancelled') return false;
            return matchesTechName(String(q.item ?? ''));
          });
        if (alreadyInQueue || hasLegacyConflictOnThisTech) {
          if (hasLegacyConflictOnThisTech) {
            intent.conflict_with_legacy_queue = true;
          }
          if (alreadyInQueue) {
            yellow(
              ctx,
              {
                layer: 'L2',
                path: `queues[${alignedTechName}]`,
                message: `科技「${alignedTechName}」已在队列中，跳过重复入队`,
                before: rawTechName,
                after: alignedTechName,
              },
              {
                rule: 'R18',
                target: `queues[${alignedTechName}]`,
                message: `科技「${alignedTechName}」已在队列中，已防重跳过`,
              },
            );
            continue;
          }
        }

        const rawBaseRef = action.base_ref?.trim() || (data.bases[0]?.name ? String(data.bases[0].name) : '');
        const matchedBaseForAction =
          data.bases.find(b => canon(b.name) === canon(rawBaseRef) || canon(b.id) === canon(rawBaseRef)) ??
          (data.bases.length === 1 ? data.bases[0] : undefined);
        const effectiveBase = matchedBaseForAction ? String(matchedBaseForAction.name) : rawBaseRef;
        if (matchedBaseForAction && action.base_ref && action.base_ref !== effectiveBase) {
          action.base_ref = effectiveBase;
          intentMutated = true;
        }
        if (opts.deferPlanningCommit) {
          continue;
        }
        const queueType = action.kind ?? '研究';
        queuesList.push({
          type: queueType,
          item: alignedTechName,
          base: effectiveBase,
          progress: 0,
          eta: '',
          status: 'queued',
          started_at: '',
          total_minutes: 0,
          spent_minutes: 0,
          qty: action.quantity ?? 1,
          qty_done: 0,
          cost_paid: true,
          min_days_lock: 0,
          hold: false,
        });
        // FD-38 · D-BASE-LIFE-01：当 <排产计划> 建造动作入队时，同步在目标基地 buildings 挂载 state: '建造中' 占位项
        if (queueType === '建造' && matchedBaseForAction) {
          const targetBase = matchedBaseForAction;
          if (!Array.isArray(targetBase.buildings)) targetBase.buildings = [];
          const actAny = action as {
            layer?: string;
            coord?: { x: number; y: number };
            bearing?: string;
            quantity?: number;
          };
          const existingUnderConst = targetBase.buildings.find(
            b => canon(b.name) === canon(alignedTechName) && b.state === '建造中',
          );
          if (!existingUnderConst) {
            targetBase.buildings.push({
              name: alignedTechName,
              layer: actAny.layer ?? '',
              state: '建造中',
              ...(actAny.coord ? { coord: actAny.coord } : {}),
              ...(actAny.bearing ? { bearing: actAny.bearing } : {}),
            });
          } else {
            if (actAny.layer && !existingUnderConst.layer) existingUnderConst.layer = actAny.layer;
            if (actAny.coord && !existingUnderConst.coord) existingUnderConst.coord = actAny.coord;
            if (actAny.bearing && !existingUnderConst.bearing) existingUnderConst.bearing = actAny.bearing;
          }
        }
        ctx.appliedCount++;
        green(ctx, {
          layer: 'L2',
          path: `queues[${alignedTechName}]`,
          message: `<排产计划> ${isResearchAction ? '科研' : queueType}立项入队：「${alignedTechName}」`,
          after: alignedTechName,
        });
      }
      if (intentMutated) {
        intent.fingerprint = computePlanFingerprint(intent);
      }
    }
  }

  if (spaceContracts.length > 0 || launchCenters.length > 0 || orbitalAssets.length > 0) {
    settleSpaceOperations(data, spaceContracts, {
      incomingLaunchCenters: launchCenters,
      incomingOrbitalAssets: orbitalAssets,
    });
    ctx.appliedCount += spaceContracts.length + launchCenters.length + orbitalAssets.length;
    for (const c of spaceContracts) {
      const settled = data.space?.contracts?.find(item => item.id === c.id) ?? c;
      green(ctx, {
        layer: 'L2',
        path: `space.contracts[${c.id}]`,
        message:
          settled.status === 'completed'
            ? `<航天> 合同交割完结：「${c.title}」（${c.id}），回款 +${c.reward_credits} 资金`
            : `<航天> 合同入库：「${c.title}」（${c.id}，状态=${settled.status}${settled.duration_days ? `，进度=${settled.elapsed_days ?? 0}/${settled.duration_days}天` : ''}）`,
        after: settled,
      });
    }
  }

  if (darknetBlocks.length > 0) {
    for (const rawDarknetBlock of darknetBlocks) {
      const dnRes = applyDarknetBlockToState(rawDarknetBlock, data, {
        currentDay: data.clock?.day ?? data.meta?.day_count ?? 0,
      });
      ctx.events.push(...dnRes.events);
      ctx.quarantine.push(...dnRes.quarantine);
      ctx.appliedCount += dnRes.appliedCount;
    }
  }

  // 三层剧情摘要入账：
  // 1) 若存在 <摘要> / <summary> 且已知 floorId（或首楼为 0），幂等写入 data.micro_summaries
  if (floorSummaries.micro && (typeof opts.floorId === 'number' || opts.isFirstFloor)) {
    const targetFloor = typeof opts.floorId === 'number' ? opts.floorId : 0;
    data.micro_summaries = upsertMicroSummary(data.micro_summaries, {
      floor: targetFloor,
      date: floorSummaries.micro.date || data.meta?.date || '',
      text: floorSummaries.micro.text,
      keys: floorSummaries.micro.keys,
      updatedAt: new Date().toISOString(),
    });
    ctx.appliedCount++;
  }

  // 2) 若存在 <中摘要> / <大摘要>（方案 C 委托主模型产出），幂等写入 data.pending_summaries 待审
  if (floorSummaries.delegatedDrafts.length > 0) {
    const nowIso = new Date().toISOString();
    const list = Array.isArray(data.pending_summaries) ? [...data.pending_summaries] : [];
    for (const d of floorSummaries.delegatedDrafts) {
      const idx = list.findIndex(
        x => (x.tier ?? 'meso') === d.tier && x.from === d.from && x.to === d.to && x.status === 'pending',
      );
      const nextDraft = {
        from: d.from,
        to: d.to,
        text: d.text,
        keys: d.keys,
        generatedAt: nowIso,
        model: 'main-llm-delegated',
        status: 'pending' as const,
        tier: d.tier,
        ...(d.title ? { title: d.title } : {}),
      };
      if (idx >= 0) {
        list[idx] = nextDraft;
      } else {
        list.push(nextDraft);
      }
      ctx.appliedCount++;
    }
    data.pending_summaries = list;
  }

  // 最终归一（保险网：若因意外毒化导致 parse 抛错，基线照落）
  let finalData: StatData;
  try {
    finalData = Schema.parse(data);
  } catch (e) {
    ctx.quarantine.push({
      scope: 'block',
      raw: '(merged)',
      error: `合并产物未通过最终 Schema 校验：${errText(e)}`,
      suggestion: '已回退到归一基线',
    });
    return {
      data: baseData,
      applied: false,
      events: ctx.events,
      issues: ctx.issues,
      quarantine: ctx.quarantine,
      operationCompletions: ctx.operationCompletions,
      orders: ctx.orders,
      deployOrders: ctx.deployOrders,
      engOrders: ctx.engOrders,
      eventDeclarations: ctx.eventDeclarations,
      planningDecls: ctx.planningDecls,
      factionUnlocks: ctx.factionUnlocks,
      ...(hasSummaryTags ? { floorSummaries } : {}),
    };
  }

  return {
    data: finalData,
    applied: ctx.appliedCount > 0,
    events: ctx.events,
    issues: ctx.issues,
    quarantine: ctx.quarantine,
    operationCompletions: ctx.operationCompletions,
    orders: ctx.orders,
    deployOrders: ctx.deployOrders,
    engOrders: ctx.engOrders,
    eventDeclarations: ctx.eventDeclarations,
    planningDecls: ctx.planningDecls,
    factionUnlocks: ctx.factionUnlocks,
    ...(hasSummaryTags ? { floorSummaries } : {}),
  };
}

/** 应用战况树（也用于 <初始状态> 首楼深合并）；deployTagDecls＝E3b 标签块预提取的部署声明（与 YAML 键形并流） */
function applyWarStat(
  w: Record<string, unknown>,
  data: StatData,
  ctx: Ctx,
  deployTagDecls: Record<string, unknown>[] = [],
  warStatOpts?: {
    isFirstFloor?: boolean;
    isInitialStateTag?: boolean;
    disallowLegacyWarStatCredits?: boolean;
  },
): void {
  const idx = keyIndex(w);
  const consumed = new Set<string>();

  // meta
  const meta = data.meta as unknown as Record<string, unknown>;
  setStr(meta, 'date', w, idx, consumed, ['日期', 'date'], ctx);
  setStr(meta, 'location', w, idx, consumed, ['地点', 'location'], ctx);
  const weatherT = take(w, idx, consumed, ['天气', '气象', '天候', 'weather']);
  if (weatherT && String(weatherT.value ?? '').trim() !== '') {
    const weatherVal = String(weatherT.value ?? '').trim();
    meta.weather = weatherVal;
    const canonicalTopWeather = normalizeCanonicalWeather(weatherVal) || weatherVal;
    for (const b of data.bases ?? []) {
      if (typeof b.weather === 'string' && b.weather.trim() !== '') {
        b.weather = canonicalTopWeather;
      }
    }
    ctx.appliedCount++;
    green(ctx, {
      layer: 'L2',
      path: '战况.天气',
      message: `战况天气已更新为「${weatherVal}」`,
      after: weatherVal,
    });
  }
  setNumField(meta, 'day_count', w, idx, consumed, ['天数', 'day_count'], ctx, 'meta');
  const worldIdT = take(w, idx, consumed, ['world_id', '世界ID']);
  if (worldIdT) {
    yellow(
      ctx,
      {
        layer: 'L2',
        path: 'meta.world_id',
        message: 'world_id 是系统只读字段，模型写入已忽略',
        before: worldIdT.value,
        after: meta.world_id,
      },
      { rule: 'R18', target: 'meta.world_id', message: 'world_id 写入已忽略' },
    );
  }

  // economy
  const eco = data.economy as unknown as Record<string, unknown>;
  if (
    warStatOpts?.disallowLegacyWarStatCredits &&
    !warStatOpts?.isFirstFloor &&
    !warStatOpts?.isInitialStateTag
  ) {
    const rawCreditsT = take(w, idx, consumed, ['资金', '经费', 'credits']);
    const rawDeltaT = take(w, idx, consumed, [
      '资金变化',
      '经费变化',
      'credits_delta',
      'creditsdelta',
      '资金_delta',
      '经费_delta',
    ]);
    if (rawCreditsT || rawDeltaT) {
      const attemptedVal = rawCreditsT ? rawCreditsT.value : rawDeltaT?.value;
      yellow(
        ctx,
        {
          layer: 'L2',
          path: 'economy.credits',
          message: '<战况> 裸改资金旁路已收口拦截（非首楼），请通过 <事件>、<排产计划> 或 <暗网> 结算资金',
          before: attemptedVal,
          after: eco.credits,
        },
        {
          rule: 'R18',
          target: 'economy.credits',
          message: '<战况> 资金旁路写入已拦截',
        },
      );
    }
  } else {
    const prevCredits = eco.credits;
    const appliedBeforeCredits = ctx.appliedCount;
    const hasExplicitDelta =
      idx.has(canon('资金变化')) ||
      idx.has(canon('经费变化')) ||
      idx.has(canon('credits_delta')) ||
      idx.has(canon('creditsdelta')) ||
      idx.has(canon('资金_delta')) ||
      idx.has(canon('经费_delta'));
    setNumField(eco, 'credits', w, idx, consumed, ['资金', '经费', 'credits'], ctx, 'economy');
    if (
      ctx.appliedCount > appliedBeforeCredits &&
      !warStatOpts?.isFirstFloor &&
      !warStatOpts?.isInitialStateTag
    ) {
      const isUnexpandedInitialFooting =
        (data.queues?.length ?? 0) === 0 &&
        (data.bases ?? []).every(b => (b.buildings?.length ?? 0) === 0);
      if (
        typeof prevCredits === 'number' &&
        prevCredits > 0 &&
        eco.credits === 0 &&
        !hasExplicitDelta &&
        isUnexpandedInitialFooting
      ) {
        eco.credits = prevCredits;
        ctx.appliedCount = appliedBeforeCredits;
        yellow(
          ctx,
          {
            layer: 'L2',
            path: 'economy.credits',
            message: '<态势> 在未展开初态下误报「资金: 0」，已保留开局初始资金',
            before: 0,
            after: prevCredits,
          },
          {
            rule: 'R18',
            target: 'economy.credits',
            message: '已拦截未展开初态下将非零开局资金清零的误报',
          },
        );
      } else {
        green(ctx, {
          layer: 'L2',
          path: 'economy.credits',
          message: '<战况> 遗产资金旁路兼容入账（建议改用 <事件> / <排产计划> / <暗网> 管理资金）',
          before: prevCredits,
          after: eco.credits,
        });
      }
    }
  }
  setNumField(eco, 'credits_daily', w, idx, consumed, ['日结', '日均', 'credits_daily'], ctx, 'economy');
  const walletT = take(w, idx, consumed, ['钱袋', 'wallet']);
  if (walletT && isUsable(walletT.value) && !Array.isArray(walletT.value))
    applyWallet(walletT.value as Record<string, unknown>, data, ctx);
  const resourcesT = take(w, idx, consumed, ['资源', 'resources']);
  if (resourcesT && isUsable(resourcesT.value) && !Array.isArray(resourcesT.value))
    applyResources(resourcesT.value as Record<string, unknown>, data, ctx);
  const chainsT = take(w, idx, consumed, ['资金链', '贸易链', '收入链', 'chains']);
  if (chainsT) applyChainsBlock(chainsT.value, data, ctx);

  // exposure & morale (FD-36 · 先提取 <态势> 显式输入与增量，待 bases 解析更新完成后统一执行双驱结算)
  const expAbsT = take(w, idx, consumed, ['暴露度', '暴露', 'exposure']);
  const expDeltaT = takeDelta(w, idx, consumed, ['暴露度', '暴露', 'exposure']);
  const expTrendT = take(w, idx, consumed, ['暴露趋势', 'trend']);
  const expLastChangeT = take(w, idx, consumed, ['暴露事件', 'last_change']);
  take(w, idx, consumed, ['暴露等级', 'exposure_level']);

  const moraleAbsT = take(w, idx, consumed, ['民心', '民心指数', 'morale', 'public_support']);
  const moraleDeltaT = takeDelta(w, idx, consumed, ['民心', '民心指数', 'morale', 'public_support']);
  const moraleTrendT = take(w, idx, consumed, ['民心趋势', 'morale_trend']);
  const moraleLastChangeT = take(w, idx, consumed, ['民心事件', 'morale_event', 'morale_change']);

  // bases
  const basesT = take(w, idx, consumed, ['基地', 'bases']);
  if (basesT) {
    const normalizedBasesInput = normalizeBaseInputItems(basesT.value);
    // FD-38 · BUG-BASE-04：基地原位更名与全树引用级联同步
    // 途径 1（显式原名/ID 锚定）：传入基地项带有 原名称 / 曾用名 / 旧名称 / rename_from / id 命中既有基地；
    // 途径 2（单基地同址演进认亲）：当 data.bases.length === 1 且 incoming 仅申报 1 座基地，
    //   若新名称不同，但满足 a) 0 建筑占位态，或 b) 原名为通用编号名（如 1号主基地/前沿第一基地/主基地）且 location 同源或共享主建造厂。
    const incomingList = asArray(normalizedBasesInput).filter(
      item => isUsable(item) && !Array.isArray(item),
    ) as Record<string, unknown>[];
    if (incomingList.length > 0 && data.bases.length > 0) {
      for (const srcItem of incomingList) {
        const sIdx = keyIndex(srcItem);
        const sConsumed = new Set<string>();
        const locT = take(srcItem, sIdx, sConsumed, NAME_ALIASES);
        const incomingRawName = locT && locT.value != null ? String(locT.value).trim() : '';
        if (!incomingRawName) continue;
        const incomingAligned = applyAlign(incomingRawName, ctx, `基地[${incomingRawName}]`, 'entity');
        const alreadyExists = data.bases.some(
          b => canon(b.name) === canon(incomingAligned) || canon(b.id) === canon(incomingAligned),
        );
        if (alreadyExists) continue;

        let targetBaseToRename: (typeof data.bases)[number] | undefined;

        // 途径 1：显式 原名称 / 曾用名 / 旧名称 / rename_from / id 锚定
        const renameAnchorT = take(srcItem, sIdx, sConsumed, [
          '原名称',
          '曾用名',
          '旧名称',
          '原基地名',
          'rename_from',
          'old_name',
          'id',
          '基地ID',
          'base_id',
        ]);
        const anchorRaw = renameAnchorT?.value != null ? String(renameAnchorT.value).trim() : '';
        if (anchorRaw) {
          targetBaseToRename = data.bases.find(
            b => canon(b.name) === canon(anchorRaw) || canon(b.id) === canon(anchorRaw),
          );
        }

        // 途径 2：单基地同址演进认亲（或空壳待侦知基地认亲）
        if (!targetBaseToRename && incomingList.length === 1) {
          const placeholderBase = data.bases.find(
            b =>
              (b.buildings?.length ?? 0) === 0 &&
              (b.name === '待侦知部署点' ||
                b.id === 'cyber-entry' ||
                String(b.name ?? '').includes('待侦知') ||
                (data.bases.length === 1 && b.status === '隐蔽中')),
          );
          if (placeholderBase) {
            targetBaseToRename = placeholderBase;
          } else if (data.bases.length === 1) {
            const soleBase = data.bases[0];
            if (isEligibleSingleBaseEvolutionRename(soleBase, srcItem, sIdx, incomingAligned)) {
              targetBaseToRename = soleBase;
            }
          }
        }

        if (targetBaseToRename) {
          const oldName = String(targetBaseToRename.name ?? '').trim();
          const oldId = String(targetBaseToRename.id ?? '').trim();
          const oldRefs = [oldName, oldId].filter(Boolean);
          targetBaseToRename.name = incomingAligned;
          targetBaseToRename.id = incomingAligned;
          remapBaseReferencesInStat(data, oldRefs, incomingAligned, ctx);
          green(ctx, {
            layer: 'L2',
            path: `基地[${incomingAligned}]`,
            message: `基地原位更名并同步全树引用：「${oldName}」→「${incomingAligned}」`,
            before: oldName,
            after: incomingAligned,
          });
        }
      }
    }

    upsertByName(
      data.bases as Record<string, unknown>[],
      normalizedBasesInput,
      {
        locate: NAME_ALIASES,
        targetKey: 'name',
        label: '基地',
        mkNew: name => ({
          id: name,
          name,
          location: '',
          status: '隐蔽中',
          power: { gen: 0, use: 0 },
          buildings: [],
          alerts: [],
        }),
        mapFields: (t, s, i, c, isNew, p) => mapBase(t, s, i, c, isNew, p, ctx),
        elemSchema: Base,
        alignMode: 'entity',
      },
      ctx,
    );

    // 若历史楼层已分裂出空壳「待侦知部署点」且已有其它非空/运转基地，自动收拢剔除空壳占位基地
    if (data.bases.length > 1) {
      const hasRealBase = data.bases.some(
        b =>
          b.name !== '待侦知部署点' &&
          b.id !== 'cyber-entry' &&
          ((b.buildings?.length ?? 0) > 0 || b.status === '运转中'),
      );
      if (hasRealBase) {
        data.bases = data.bases.filter(
          b =>
            !(
              (b.name === '待侦知部署点' || b.id === 'cyber-entry') &&
              (b.buildings?.length ?? 0) === 0 &&
              b.status === '隐蔽中'
            ),
        );
      }
    }
  }

  // FD-36：在基地与建筑更新后统一执行暴露度（EL-0~EL-4 / 常驻底线 floor / 自然冷却）与民心（0~10 五阶状态）双驱结算
  {
    const explicitExposure = expAbsT ? toNum(expAbsT.value) : null;
    const deltaExposure = expDeltaT;
    const explicitMorale = moraleAbsT ? toNum(moraleAbsT.value) : null;
    const deltaMorale = moraleDeltaT;

    const hasAnyExpInput =
      explicitExposure !== null ||
      deltaExposure !== null ||
      Boolean(expTrendT?.value) ||
      Boolean(expLastChangeT?.value);
    const hasAnyMoraleInput =
      explicitMorale !== null ||
      deltaMorale !== null ||
      Boolean(moraleTrendT?.value) ||
      Boolean(moraleLastChangeT?.value);

    const settled = settleExposureAndMorale(data, {
      explicitExposure,
      deltaExposure,
      exposureTrend: expTrendT?.value != null ? String(expTrendT.value) : null,
      exposureLastChange: expLastChangeT?.value != null ? String(expLastChangeT.value) : null,
      explicitMorale,
      deltaMorale,
      moraleTrend: moraleTrendT?.value != null ? String(moraleTrendT.value) : null,
      moraleLastChange: moraleLastChangeT?.value != null ? String(moraleLastChangeT.value) : null,
      enableNaturalDrift: hasAnyExpInput || hasAnyMoraleInput,
    });

    if (settled.conflictExposureBothProvided) {
      yellow(
        ctx,
        {
          layer: 'L2',
          path: 'exposure.value',
          message: '同一回复混用暴露度绝对值与增量，按增量优先结算',
          before: explicitExposure,
          after: settled.exposure.value,
        },
        { rule: 'R18', target: 'exposure.value', message: '暴露度绝对值与增量混用，已按增量优先' },
      );
    } else if (explicitExposure !== null && (explicitExposure < 0 || explicitExposure > 10)) {
      yellow(
        ctx,
        {
          layer: 'L2',
          path: 'exposure.value',
          message: `暴露度绝对值越界，已 clamp ${explicitExposure} → ${settled.exposure.value}`,
          before: explicitExposure,
          after: settled.exposure.value,
        },
        { rule: 'R18', target: 'exposure.value', message: `exposure.value clamp ${explicitExposure} → ${settled.exposure.value}` },
      );
    }
    if (settled.conflictMoraleBothProvided) {
      yellow(
        ctx,
        {
          layer: 'L2',
          path: 'morale.value',
          message: '同一回复混用民心绝对值与增量，按增量优先结算',
          before: explicitMorale,
          after: settled.morale.value,
        },
        { rule: 'R18', target: 'morale.value', message: '民心绝对值与增量混用，已按增量优先' },
      );
    } else if (explicitMorale !== null && (explicitMorale < 0 || explicitMorale > 10)) {
      yellow(
        ctx,
        {
          layer: 'L2',
          path: 'morale.value',
          message: `民心绝对值越界，已 clamp ${explicitMorale} → ${settled.morale.value}`,
          before: explicitMorale,
          after: settled.morale.value,
        },
        { rule: 'R18', target: 'morale.value', message: `morale.value clamp ${explicitMorale} → ${settled.morale.value}` },
      );
    }
    if (settled.clampedExposureDelta) {
      yellow(
        ctx,
        {
          layer: 'L2',
          path: 'exposure.value',
          message: '单轮暴露度变化超出安全范围，已钳制于 [-1.5, +2.0]',
          before: deltaExposure,
          after: settled.exposure.value,
        },
        { rule: 'R18', target: 'exposure.value', message: '暴露度单轮增量已安全钳制' },
      );
    }
    if (settled.clampedMoraleDelta) {
      yellow(
        ctx,
        {
          layer: 'L2',
          path: 'morale.value',
          message: '单轮民心变化超出安全范围，已钳制于 [-1.5, +1.5]',
          before: deltaMorale,
          after: settled.morale.value,
        },
        { rule: 'R18', target: 'morale.value', message: '民心单轮增量已安全钳制' },
      );
    }

    if (hasAnyExpInput || settled.exposure.floor > 0 || data.exposure.floor !== undefined) {
      data.exposure.value = settled.exposure.value;
      data.exposure.floor = settled.exposure.floor;
      data.exposure.level = settled.exposure.level;
      data.exposure.trend = settled.exposure.trend;
      data.exposure.last_change = settled.exposure.last_change;
      if (hasAnyExpInput) ctx.appliedCount++;
    }

    if (hasAnyMoraleInput || data.morale) {
      data.morale = {
        value: settled.morale.value,
        level: settled.morale.level,
        ...(settled.morale.engaged ? { engaged: true } : {}),
        trend: settled.morale.trend,
        last_change: settled.morale.last_change,
      };
      if (hasAnyMoraleInput) ctx.appliedCount++;
    }
  }

  // queues
  const queuesT = take(w, idx, consumed, ['队列', 'queues']);
  if (queuesT) upsertQueues(data.queues as Record<string, unknown>[], queuesT.value, data, ctx);

  // 已研科技：append 去重
  const techT = take(w, idx, consumed, ['已研科技', 'tech_done']);
  if (techT) {
    const done = (data.tech as unknown as Record<string, unknown>).done as string[];
    for (const t of asArray(techT.value)) {
      const rawName = String(t).trim();
      if (!rawName) continue;
      const name = applyAlign(rawName, ctx, `已研科技[${rawName}]`, 'tech');
      if (!done.some(d => canon(d) === canon(name))) {
        done.push(name);
        ctx.appliedCount++;
      }
    }
  }

  // 部队 / 兵力 / 驻军
  const forcesT = take(w, idx, consumed, ['部队', '兵力', '驻军', 'forces']);
  if (forcesT && isUsable(forcesT.value) && !Array.isArray(forcesT.value))
    applyForces(forcesT.value as Record<string, unknown>, data, ctx);

  // 战损 / 伤亡 / 损失
  const casualtiesT = take(w, idx, consumed, ['战损', '伤亡', '损失', 'casualties', 'losses']);
  if (casualtiesT) {
    applyCasualties(casualtiesT.value, data, ctx, '战况.战损');
  }

  // 势力
  const facT = take(w, idx, consumed, ['势力', 'factions']);
  if (facT) {
    upsertByName(
      data.factions as Record<string, unknown>[],
      facT.value,
      {
        locate: NAME_ALIASES,
        targetKey: 'name',
        label: '势力',
        mkNew: name => ({ name, attitude: '未接触', intel: '', risk: '未知' }),
        mapFields: (t, s, i, c, isNew, p) => mapFaction(t, s, i, c, isNew, p, ctx),
        elemSchema: Faction,
        alignMode: 'entity',
      },
      ctx,
    );
  }

  // 情报
  const intelT = take(w, idx, consumed, ['情报', 'intel']);
  if (intelT) appendIntel(data.intel as Record<string, unknown>[], intelT.value, ctx);

  // 任务
  const questT = take(w, idx, consumed, ['任务', 'quests']);
  if (questT) {
    upsertByName(
      (data.quests as unknown as Record<string, unknown>).active as Record<string, unknown>[],
      questT.value,
      {
        locate: NAME_ALIASES,
        targetKey: 'name',
        label: '任务',
        mkNew: name => ({ name, progress: '', note: '', detail: '' }),
        mapFields: (t, s, i, c, isNew, p) => mapQuest(t, s, i, c, isNew, p, ctx),
        elemSchema: Quest,
        alignMode: 'entity',
      },
      ctx,
    );
  }
  setNumField(
    data.quests as unknown as Record<string, unknown>,
    'done_count',
    w,
    idx,
    consumed,
    ['完成任务数', 'done_count'],
    ctx,
    'quests',
  );

  // 选项：整体替换
  const optT = take(w, idx, consumed, ['选项', 'options']);
  if (optT) {
    applyOptionsList(optT.value, data, ctx);
  }

  // 操作（最后处理，基于队列增量后状态）
  const opsT = take(w, idx, consumed, ['操作', 'operations']);
  if (opsT) applyOperations(opsT.value, data, ctx);

  // 部署（E3a · CTRL-DEPLOY-PARSE-01 两段式：段一声明收集→段二延迟解析；跳过账本直写）
  // E3b：YAML 键形（take 认领）与 <部署> 标签块预提取两路并存，汇入同一 deployDecls 流
  const deployT = take(w, idx, consumed, ['部署', '展开', 'deploy']);
  const deployInputs: unknown[] = deployT ? asArray(deployT.value) : [];
  deployInputs.push(...deployTagDecls);
  if (deployInputs.length) applyDeployments(deployInputs, data, ctx);

  const spaceT = take(w, idx, consumed, ['航天', '航天合同', '天基', '太空', '商业合同', 'space']);
  if (spaceT) {
    const extractedSpace = extractSpaceFromParsedValue(spaceT.value);
    if (
      extractedSpace.contracts.length > 0 ||
      extractedSpace.launchCenters.length > 0 ||
      extractedSpace.orbitalAssets.length > 0
    ) {
      settleSpaceOperations(data, extractedSpace.contracts, {
        incomingLaunchCenters: extractedSpace.launchCenters,
        incomingOrbitalAssets: extractedSpace.orbitalAssets,
      });
      ctx.appliedCount +=
        extractedSpace.contracts.length +
        extractedSpace.launchCenters.length +
        extractedSpace.orbitalAssets.length;
    }
  }

  take(w, idx, consumed, ['参谋建议', '参谋席建议', 'staff_advice', 'advisor_suggestions']);
  quarantineLeftovers(w, consumed, ctx, '战况');
}

/**
 * 解析并应用选项数组（供顶层 <选项> 标签与旧版 <战况>.选项 共用）
 */
function applyOptionsList(rawItems: unknown, data: StatData, ctx: Ctx): void {
  const opts: Record<string, unknown>[] = [];
  for (const o of asArray(rawItems)) {
    if (typeof o === 'string') {
      const text = o.trim();
      if (text) {
        opts.push({ text, tag: '', cost: '' });
        ctx.appliedCount++;
      }
      continue;
    }
    if (!isUsable(o) || Array.isArray(o)) continue;
    const oi = keyIndex(o as Record<string, unknown>);
    const oc = new Set<string>();
    const elem: Record<string, unknown> = { text: '', tag: '', cost: '' };
    setStr(elem, 'text', o as Record<string, unknown>, oi, oc, ['文本', '内容', '描述', '行动', 'text', 'label'], ctx);
    setStr(elem, 'tag', o as Record<string, unknown>, oi, oc, ['标记', '标签', '类型', 'tag'], ctx);
    setStr(elem, 'cost', o as Record<string, unknown>, oi, oc, ['代价', '消耗', '成本', 'cost'], ctx);
    if (String(elem.text).trim()) opts.push(elem);
  }
  data.options = opts as StatData['options'];
  ctx.appliedCount++;
}

/**
 * 解析顶层 <选项> 标签块（支持直接 YAML 列表或包裹 `选项:` / `options:` 键的对象）
 */
function applyOptionsBlock(
  parsed: Record<string, unknown> | unknown[],
  data: StatData,
  ctx: Ctx,
): void {
  if (Array.isArray(parsed)) {
    applyOptionsList(parsed, data, ctx);
    return;
  }
  const idx = keyIndex(parsed);
  const consumed = new Set<string>();
  const optT = take(parsed, idx, consumed, ['选项', '行动选项', 'options']);
  if (optT) {
    applyOptionsList(optT.value, data, ctx);
    quarantineLeftovers(parsed, consumed, ctx, '选项');
    return;
  }
  // 单条选项直接写成键值对象
  applyOptionsList([parsed], data, ctx);
}

const GENERIC_MAIN_BASE_NAME_RE =
  /^(?:(?:1号|一号|第1|第一|前沿第1|前沿第一|初始|首座|核心|中央|地下|前沿)?(?:主基地|基地|前哨基地|指挥基地|部署点)|base[_-]?1|main[_-]?base)$/i;

const CONYARD_BUILDING_NAMES = new Set(['建造厂', '盟军建造厂', '苏联建造厂', '尤里建造厂']);

function hasLocationOverlap(oldLocRaw: string, newLocRaw: string): boolean {
  const a = canon(oldLocRaw).replace(/[·•\-—_（）()[\]【】\s]+/g, '');
  const b = canon(newLocRaw).replace(/[·•\-—_（）()[\]【】\s]+/g, '');
  if (!a || !b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    if (bg.length === 2 && !/^(基地|区域|地段|地区|方向|外围|内部|地下|地表)$/.test(bg) && b.includes(bg)) {
      return true;
    }
  }
  return false;
}

function isEligibleSingleBaseEvolutionRename(
  soleBase: StatData['bases'][number],
  srcItem: Record<string, unknown>,
  sIdx: Map<string, string>,
  incomingAligned: string,
): boolean {
  // 若新名称显式声明为第 2+ 座基地或分基地，不视为原主基地改名
  if (/(?:[2-9]|[二三四五六七八九十])号|第(?:[2-9]|[二三四五六七八九十])|分基地/.test(incomingAligned)) {
    return false;
  }
  const oldName = String(soleBase.name ?? '').trim();
  if (!oldName) return true;
  if ((soleBase.buildings?.length ?? 0) === 0) return true;
  if (!GENERIC_MAIN_BASE_NAME_RE.test(oldName)) return false;

  const tmpConsumed = new Set<string>();
  const locT = take(srcItem, sIdx, tmpConsumed, ['地点', '位置', 'location']);
  const incomingLoc = locT?.value != null ? String(locT.value).trim() : '';
  if (!incomingLoc || hasLocationOverlap(soleBase.location ?? '', incomingLoc)) {
    return true;
  }

  // 检查是否共享同座主建造厂
  const bldT = take(srcItem, sIdx, tmpConsumed, ['建筑', 'buildings']);
  if (bldT && bldT.value != null) {
    const existingConyards = new Set(
      (soleBase.buildings ?? []).map(b => String(b.name ?? '').trim()).filter(n => CONYARD_BUILDING_NAMES.has(n)),
    );
    if (existingConyards.size > 0) {
      for (const rawB of asArray(bldT.value)) {
        if (typeof rawB === 'string') {
          for (const cy of existingConyards) {
            if (rawB.includes(cy)) return true;
          }
        } else if (isUsable(rawB) && !Array.isArray(rawB)) {
          const bObj = rawB as Record<string, unknown>;
          const bName = String(bObj.名称 ?? bObj.name ?? Object.keys(bObj)[0] ?? '').trim();
          if (existingConyards.has(bName)) return true;
        }
      }
    }
  }

  return false;
}

/**
 * 基地原位更名后，同步级联更新全树（queues / forces.girls / economy.chains / projects / pending_deployments / pending_mode_switches）中的基地引用（FD-38 · BUG-BASE-04）
 */
export function remapBaseReferencesInStat(
  data: StatData,
  oldRefs: readonly string[],
  newName: string,
  ctx?: Ctx,
): void {
  const targetName = newName.trim();
  if (!targetName) return;
  const oldCanonSet = new Set(oldRefs.map(r => canon(r)).filter(Boolean));
  if (oldCanonSet.size === 0) return;

  const matchesOld = (val: unknown): boolean =>
    typeof val === 'string' && val.trim() !== '' && oldCanonSet.has(canon(val));

  if (Array.isArray(data.queues)) {
    for (const q of data.queues) {
      if (matchesOld(q.base)) q.base = targetName;
    }
  }

  if (Array.isArray(data.forces?.girls)) {
    for (const g of data.forces.girls) {
      if (matchesOld(g.base)) g.base = targetName;
    }
  }

  if (Array.isArray(data.economy?.chains)) {
    for (const ch of data.economy.chains) {
      const chAny = ch as unknown as Record<string, unknown>;
      if (matchesOld(chAny.base)) chAny.base = targetName;
      if (matchesOld(chAny.base_id)) chAny.base_id = targetName;
      if (ch.deps && typeof ch.deps === 'object') {
        const depsAny = ch.deps as unknown as Record<string, unknown>;
        if (matchesOld(depsAny.base_id)) depsAny.base_id = targetName;
        if (matchesOld(depsAny.base)) depsAny.base = targetName;
      }
    }
  }

  if (Array.isArray(data.projects)) {
    for (const proj of data.projects) {
      if (matchesOld(proj.lead_base)) proj.lead_base = targetName;
      if (Array.isArray(proj.bases)) {
        proj.bases = proj.bases.map(b => (matchesOld(b) ? targetName : b));
      }
      if ('modules' in proj && Array.isArray(proj.modules)) {
        for (const mod of proj.modules) {
          if (matchesOld(mod.base)) mod.base = targetName;
        }
      }
    }
  }

  if (Array.isArray(data.pending_deployments)) {
    for (const dep of data.pending_deployments) {
      if (matchesOld(dep.base)) dep.base = targetName;
    }
  }

  if (Array.isArray(data.pending_transfers)) {
    for (const tr of data.pending_transfers) {
      if (matchesOld(tr.from_base)) tr.from_base = targetName;
      if (matchesOld(tr.to_base)) tr.to_base = targetName;
    }
  }

  if (Array.isArray(data.pending_mode_switches)) {
    for (const sw of data.pending_mode_switches) {
      if (matchesOld(sw.base)) sw.base = targetName;
    }
  }

  if (ctx) {
    for (const plan of ctx.planningDecls ?? []) {
      if (matchesOld(plan.base_ref)) plan.base_ref = targetName;
      for (const act of plan.actions ?? []) {
        if (matchesOld(act.base_ref)) act.base_ref = targetName;
      }
    }
    for (const ord of ctx.orders ?? []) {
      if (matchesOld(ord.base)) ord.base = targetName;
    }
    for (const depOrd of ctx.deployOrders ?? []) {
      if (matchesOld(depOrd.base)) depOrd.base = targetName;
    }
    for (const comp of ctx.operationCompletions ?? []) {
      if (matchesOld(comp.base)) comp.base = targetName;
    }
    for (const evDecl of ctx.eventDeclarations ?? []) {
      if (evDecl.transfer) {
        if (matchesOld(evDecl.transfer.from_base)) evDecl.transfer.from_base = targetName;
        if (matchesOld(evDecl.transfer.to_base)) evDecl.transfer.to_base = targetName;
      }
    }
  }
}

