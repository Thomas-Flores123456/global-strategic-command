/**
 * settleFloor.ts —— F4 事务引擎结算接线（CTRL-TXN-INTEG-01）
 *
 * 真源：docs/design/systems/系统事务与时间推进总设计案.md §3.3/§4/§4.1；
 *       NEXT.md（十三）F4 集成方案批准全文（驾驶员 2026-09-23 批准）；
 *       docs/project/plans/中控台版本迭代任务包.md §8.2 F4 集成缺口。
 *
 * 职责：挂进 useParse.runParseFor——parseMessageText 之后、写本楼 stat_data 之前，
 * 与解析同属一个事务、同楼落盘，走 $parse.done 幂等，swipe/编辑自然重算。
 * extraDeltaMinutes（CTRL-UI-CHRONO-01 · A′ 顺延补票）：驾驶员显式「自动顺延时间」注入的
 * 差额 Δt，与三来源 Δt 相加后走完全相同的结算/clock 路径——引擎口径零改动，铁律2 不破
 * （顺延本身就是合法燃料，只是来源从 LLM 叙事换成驾驶员一键）。
 *
 * 🔴 红线：纯函数——零 Pinia、零 Vue、零宿主 API；不原地修改入参；
 * transactionEngine / twoStageAssemblyEngine 本体零改动（只经既有回调接缝注入）；
 * 不改 schema 语义（clock 写入走既有 optional 字段，Δt>0 才写）。
 */

import type { EffectiveCatalog } from '../core/catalogEffective';
import { findCatalogBuildingDef } from '../core/prerequisitesHelpers';
import { EconomyResources, type ChainKind, type CommandHQ, type IncomeChain } from '../core/schema';
import {
  canon,
  type AdjutantEventDecl,
  type EventDeclaration,
  type ParseEvent,
  type StatData,
} from '../parse/parsePipeline';
import { checkAssetQueueCross, checkDeploymentVehicleCross, type CheckIssue } from '../parse/systemCheck';
import { advanceCalendar } from '../parse/timePastParser';
import {
  applyChainEvent,
  calcDailyNet,
  normalizeChainResourcePillar,
  settleChainsDeltaT,
  type ChainEventPayload,
} from './chainEngine';
import { tickDarknetAndPassiveEconomy } from './darknetEngine';
import {
  deployBlockIndexFromCatalog,
  requestDeployment,
  settleDeployments,
  type DeploymentRequest,
} from './deploymentEngine';
import {
  requestUnitTransfer,
  settleUnitTransfers,
} from './unitTransferEngine';
import {
  applyUnifiedCommands,
  fromLegacyDispatchOrders,
  type DispatchBusResult,
  type UnifiedCommand,
} from './dispatchBus';
import { createLaneRegistryHub, type LaneRegistryHub } from './laneProviders';
import { reconcileStaleRejectedPlanningReceipt } from '../planning/planningReceipt';
import { applyGridConstraints, withWeatherView, type BasePowerView } from './operationEngine';
import {
  autoSettleCompletedQueues,
  buildItemCategoriesFromCatalog,
  parseProductionDeclarations,
  reconcileEventToIssue,
  reconcileEventToParseEvent,
} from './productionReconciliation';
import { settleModeSwitches } from './productionLanes';
import { engAssemblySpecFor, syncProjects } from './projectEngine';
import {
  assemblySpecOf,
  backfillDurations,
  baseOfIdOrName,
  baseOfTxn,
  canonTxnName,
  chainPayloadOf,
  computeBudgetForBase,
  computeBudgetForTheater,
  deductNanitesStock,
  dedupeNewQueues,
  durationFromEntry,
  entryForTxn,
  evalBaseBuildings,
  eventToIssue,
  eventToParseEvent,
  makeTxnEffFor,
  pruneCompletedQueuesFromPrevFloor,
  readBases,
  readNonNegNum,
  readQueues,
  readRecord,
  readTotalNanites,
  resolveDeltaMinutes,
  resolveEffectiveBasePower,
  TIER_BANDWIDTH_PER_DAY,
  TXN_SUFFIXES,
  type BaseLike,
  type DeltaResolution,
  type DeltaSource,
} from './settleFloorHelpers';
import {
  applyAdjutantEventDeclaration,
  applyFactionUnlockSettlement,
  cloneCommandHQ,
  evaluateCommandHQModifiers,
  settleCommandHQSlice,
  settleFloorProtocols,
  type CommandHQWithCap,
  type ProtocolFloorSettlementReceipt,
  type ProtocolManualExperimentReceipt,
} from './settleFloorPhases';
import {
  tickTaskOrchestration,
  type LaneResolveEnv,
  type LaneStationView,
  type TickResult,
  type UnifiedTask,
} from './taskOrchestrator';
import { toUnifiedTasks } from './taskProjectionAdapter';
import type { DispatchOrder, TransactionItem } from './transactionEngine';
import {
  settleWithTwoStage,
  type TwoStageSettleOptions,
} from './twoStageAssemblyEngine';
import { buildSubstageRecord, type TraceStageRecord } from '../debug/dataFlowTracer';

export {
  applyAdjutantEventDeclaration,
  applyFactionUnlockSettlement,
  canonTxnName,
  computeBudgetForTheater,
  dedupeNewQueues,
  durationFromEntry,
  makeTxnEffFor,
  pruneCompletedQueuesFromPrevFloor,
  resolveDeltaMinutes,
  settleCommandHQSlice,
  TIER_BANDWIDTH_PER_DAY,
  TXN_SUFFIXES,
  type BaseLike,
  type CommandHQWithCap,
  type DeltaResolution,
  type DeltaSource,
  type ProtocolFloorSettlementReceipt,
  type ProtocolManualExperimentReceipt,
};

import {
  hasOperationalLaunchpad,
  isLaunchWeatherPermitted,
  settleSpaceOperations,
} from './spaceEngine';
export {
  hasOperationalLaunchpad,
  isLaunchWeatherPermitted,
  settleSpaceOperations,
};

/* ═══════════════ 主入口 ═══════════════ */

export interface SettleFloorOptions {
  /**
   * 有效目录快照（调用方在解析时读 useCatalog 模块级缓存；null/缺席 = 读不到，
   * 整体退引擎默认值：eff 恒 1、lane=base+type、并行 1、全局∞、无装配/工期回填）。
   */
  catalog?: EffectiveCatalog | null;
  /**
   * 驾驶员顺延补票分钟数（A′）：>0 时与三来源 Δt 相加作为本楼燃料，事件注记「驾驶员顺延」。
   * 仅 CTRL-UI-CHRONO-01 横幅「自动顺延时间」一键动作注入；缺省/≤0/非法 → 0，行为零变化。
   */
  extraDeltaMinutes?: number;
  /**
   * 本楼调度令（CTRL-DISPATCH-PARSE-01，§2.3.1 四动词，解析层构造；
   * 缺省/空数组 → 不注入 settleOptions.orders，行为逐字节零变化）。
   */
  orders?: DispatchOrder[];
  /**
   * 本楼部署令（E3a · CTRL-DEPLOY-PARSE-01，解析层构造；
   * 缺省/空数组 → 不入账，settleDeployments 仍推进既有在途，行为与 ④′ 接缝同型）。
   */
  deployOrders?: DeploymentRequest[];
  /**
   * EVT-SETTLE-01（事件系统总设计案 §3.3）：本楼 <事件> 三色门产物（解析层只构造、不执行）。
   * 资金链声明先于 Δt 时钟结算落账（断裂/受挫即时生效、当期停息；建立即时入池参与本期积分）；
   * 缺省/空数组 → 第四齿轮整体跳过，逐字节零行为变化（旧档零注入护栏）。
   */
  eventDeclarations?: EventDeclaration[];
  /**
   * EVT-OPR-01（事件系统总设计案 §6.3 · Q7）：本楼天候名称（如「辐射风暴」「暴风雪」）。
   * 仅作为第四结算齿轮 settleChainsDeltaT 的瞬态衰减视图输入，绝不覆写持久链条 eff；
   * 未传时尝试读取 next.meta.weather，无则为 undefined（晴天/不衰减）。
   */
  weather?: string;
  /**
   * BUG-R2-20：是否在 settleFloor 内对已满工时（status === 'settling' 且 spent_minutes >= total_minutes）
   * 的队列项自动执行完工交割（status -> 'done' + 建筑/部队/科技/工程资产入库）。默认 true。
   */
  autoSettleCompleted?: boolean;
}

export interface SettleFloorResult {
  /** 结算后的新状态（入参 nextData 不被修改） */
  data: StatData;
  events: ParseEvent[];
  issues: CheckIssue[];
  deltaMinutes: number;
  deltaSource: DeltaSource;
  /** PRT-EVT-01：协议结算齿轮回执 */
  protocolSettlement?: ProtocolFloorSettlementReceipt;
  /** 七阶监控 S2_SETTLE 内部九大玩法子齿轮断面（DBG41-04） */
  substages?: TraceStageRecord[];
}

const CONYARD_DEFAULT_POWER_NAMES = ['建造厂', '盟军建造厂', '苏联建造厂', '尤里建造厂', '升阳建造厂'];

const BUILTIN_FALLBACK_BUILDING_POWER: Readonly<Record<string, { gen?: number; use?: number }>> = {
  建造厂: { gen: 50 },
  盟军建造厂: { gen: 50 },
  苏联建造厂: { gen: 50 },
  尤里建造厂: { gen: 50 },
  盟军发电厂: { gen: 200 },
  发电厂: { gen: 200 },
  苏联磁能反应炉: { gen: 150 },
  磁能反应炉: { gen: 150 },
  尤里生物反应炉: { gen: 150 },
  生物反应炉: { gen: 150 },
  核子反应炉: { gen: 1000 },
  兵营: { use: 20 },
  盟军兵营: { use: 20 },
  苏联兵营: { use: 20 },
  尤里兵营: { use: 20 },
  矿石精炼厂: { use: 50 },
  盟军矿石精炼厂: { use: 50 },
  苏联矿石精炼厂: { use: 50 },
  战车工厂: { use: 50 },
  盟军战车工厂: { use: 50 },
  苏联战车工厂: { use: 50 },
  尤里战车工厂: { use: 50 },
  空指部: { use: 50 },
  空军指挥部: { use: 50 },
  盟军空军指挥部: { use: 50 },
  苏联空军指挥部: { use: 50 },
  盟军雷达站: { use: 50 },
  雷达站: { use: 50 },
  盟军战斗实验室: { use: 100 },
  盟军作战实验室: { use: 100 },
  苏联作战实验室: { use: 100 },
  苏联战斗实验室: { use: 100 },
  尤里心灵研究实验室: { use: 100 },
  尤里作战实验室: { use: 100 },
  尤里战斗实验室: { use: 100 },
};

function readCatalogBuildingPower(powerRaw: unknown): { gen?: number; use?: number } | undefined {
  if (typeof powerRaw === 'number' && Number.isFinite(powerRaw)) {
    if (powerRaw < 0) return { gen: -powerRaw };
    if (powerRaw > 0) return { use: powerRaw };
    return {};
  }
  const powerRec = readRecord(powerRaw);
  if (powerRec) {
    return {
      gen: readNonNegNum(powerRec.gen),
      use: readNonNegNum(powerRec.use),
    };
  }
  return undefined;
}

/**
 * BUG-R2-14 / FD-38 · 基地电网（base.power）动态重算纯函数：
 * 按基地内 state === '运转' 的在场建筑诚实汇总 catalog.buildings 的 power.gen / power.use
 * （四类主建造厂缺省按 50W 计；当 catalog 存在但个别通用建筑未命中时回退 BUILTIN_FALLBACK_BUILDING_POWER）。
 * 供 S2_SETTLE（settleFloor）与 S3_RECONCILE（reconcileProduction 核销完工建筑转运转后）同源调用。
 */
export function recomputeBasePowerFromCatalog<S extends { bases?: StatData['bases'] }>(
  state: S,
  catalog?: EffectiveCatalog | null,
  prevBasesSnapshot: readonly BaseLike[] = [],
  options?: { useBuiltinFallback?: boolean },
): S {
  if (!Array.isArray(state.bases) || state.bases.length === 0) return state;
  let powerMutated = false;
  const hasCatalogBuildings = Boolean(catalog && Array.isArray(catalog.buildings) && catalog.buildings.length > 0);
  const nextBasesWithPower = state.bases.map(b => {
    const blds = Array.isArray(b.buildings) ? b.buildings : [];
    const allowBuiltinFallback =
      Boolean(options?.useBuiltinFallback) ||
      (hasCatalogBuildings && Boolean(b.power && b.power.gen === 50 && b.power.use === 0));
    let catalogGen = 0;
    let catalogUse = 0;
    let hasCatalogPowerDef = false;
    let hasOperationalBld = false;
    let hasAnyGenBuildingInBase = false;
    for (const bd of blds) {
      const isOperational = bd.state === '运转';
      if (isOperational) hasOperationalBld = true;
      let bdGen: number | undefined;
      let bdUse: number | undefined;
      if (catalog) {
        const def = findCatalogBuildingDef(catalog.buildings, bd.name);
        const power = readCatalogBuildingPower((def as unknown as Record<string, unknown> | undefined)?.power);
        if (power) {
          if (power.gen !== undefined) bdGen = power.gen;
          if (power.use !== undefined) bdUse = power.use;
        }
      }
      if (bdGen === undefined && bdUse === undefined && allowBuiltinFallback) {
        const fb = BUILTIN_FALLBACK_BUILDING_POWER[canon(bd.name)] ?? BUILTIN_FALLBACK_BUILDING_POWER[bd.name.trim()];
        if (fb) {
          bdGen = fb.gen;
          bdUse = fb.use;
        }
      }
      if (bdGen === undefined && CONYARD_DEFAULT_POWER_NAMES.some(c => canon(c) === canon(bd.name))) {
        bdGen = 50;
      }
      if (bdGen !== undefined && bdGen > 0) {
        hasAnyGenBuildingInBase = true;
      }
      if (bdGen !== undefined || bdUse !== undefined) {
        hasCatalogPowerDef = true;
        if (isOperational) {
          if (bdGen !== undefined) catalogGen += bdGen;
          if (bdUse !== undefined) catalogUse += bdUse;
        }
      }
    }
    const hadBuildingsBefore = prevBasesSnapshot.some(
      pb =>
        (pb.id === b.id || (pb.name && b.name && canon(pb.name) === canon(b.name))) &&
        Array.isArray(pb.buildings) &&
        pb.buildings.length > blds.length,
    );
    const shouldSyncPower =
      (blds.length > 0 && (hasCatalogPowerDef || !hasOperationalBld)) ||
      (blds.length === 0 && hadBuildingsBefore);
    if (shouldSyncPower) {
      const nextGen =
        !hasAnyGenBuildingInBase && !hadBuildingsBefore && hasOperationalBld && (b.power?.gen ?? 0) > 0
          ? b.power!.gen
          : catalogGen;
      const nextUse = catalogUse;
      if (!b.power || b.power.gen !== nextGen || b.power.use !== nextUse) {
        powerMutated = true;
        return {
          ...b,
          power: {
            gen: nextGen,
            use: nextUse,
          },
        };
      }
    }
    return b;
  });
  if (!powerMutated) return state;
  return {
    ...state,
    bases: nextBasesWithPower,
  };
}

/**
 * settleFloor(prevData, nextData, rawText) —— 每楼一次的事务结算（纯函数）。
 *
 * 流程：Δt 三来源 → canon 后缀去重（仅本楼新建 × 在册 active）→ §3.3 工期回填 →
 * settleWithTwoStage（注入 effFor/computeFor/nanitesFor/assemblyFor/laneKeyFor/
 * parallelLimitFor/globalLimitFor 七回调）→ Δt>0 时经 advanceCalendar 写 clock。
 *
 * 兼容（批准定案⑤）：total_minutes=0 且 catalog 无工期来源的旧事务只发
 * unknown_duration 事件、不推进、不覆盖 LLM 报的 progress；clock 只在 Δt>0 时写入。
 */
export function settleFloor(
  prevData: unknown,
  nextData: StatData,
  rawText: string,
  options: SettleFloorOptions = {},
): SettleFloorResult {
  const catalog = options.catalog ?? null;
  const events: ParseEvent[] = [];
  const issues: CheckIssue[] = [];
  const substages: TraceStageRecord[] = [];
  const tS2cStart = performance.now();

  // ① Δt（三来源 ＋ A′ 驾驶员顺延补票）
  const resolution = resolveDeltaMinutes(rawText, prevData, nextData);
  const extraRaw = options.extraDeltaMinutes ?? 0;
  const extra = Number.isFinite(extraRaw) && extraRaw > 0 ? Math.round(extraRaw) : 0;
  const deltaMinutes = resolution.deltaMinutes + extra;
  const source = resolution.source;
  events.push({
    light: '🟢',
    layer: 'instruction',
    message:
      deltaMinutes > 0
        ? `[结算] 本楼 Δt=${deltaMinutes} 分钟（来源：${source}${extra > 0 ? `＋驾驶员顺延${extra}分` : ''}）`
        : `[结算] 本楼 Δt=0（来源：${source}），事务不推进`,
    path: 'queues',
  });

  // ①′ 归档清理上一楼遗留的 done / cancelled 终态队列项及已收录于 tech.done 的残留研究队列项（D-BLD-05 / BUG-LIVE-24a）
  const pruned = pruneCompletedQueuesFromPrevFloor(
    prevData,
    nextData.queues.map(q => ({ ...q }) as TransactionItem),
    nextData.tech?.done,
  );
  events.push(...pruned.events);

  // ② canon 后缀去重（本楼新建 × 在册 active；存量重复不动）
  const dedup = dedupeNewQueues(prevData, pruned.queues);
  events.push(...dedup.events);
  issues.push(...dedup.issues);

  // ③ §3.3 工期回填（catalog 缺席时无回填来源，total_minutes=0 走 unknown_duration）
  const backfill = backfillDurations(catalog, dedup.queues);
  events.push(...backfill.events);

  // ④ 工位环境提供者（LaneRegistryHub）与两段式结算回调组合注入（UTO-SETTLE-01：零业务类型硬编码分流）
  const slotWarns = new Set<string>();
  const warnSink = (w: { message: string }) => slotWarns.add(w.message);
  const laneHub: LaneRegistryHub = createLaneRegistryHub({ warnSink });

  const settleOptions: TwoStageSettleOptions = {
    nanitesFor: () => readTotalNanites(nextData),
  };
  if (catalog) {
    const laneEnv: LaneResolveEnv = {
      bases: readBases(nextData),
      queues: backfill.queues,
      catalog,
    };
    const txnEffFor = makeTxnEffFor(catalog, nextData);
    // §4.2 加速系数接入积分链：实际推进分钟×系数 ⇒ 实际生产时间＝基础÷系数；
    // twoStageAssemblyEngine 分装减免经 makeTwoStageEffFor 在本 effFor 之上乘法叠加（最终＝基础÷系数×(1−减免)）
    settleOptions.effFor = txn => txnEffFor(txn) * laneHub.resolveAccelEffForTxn(txn, laneEnv);
    settleOptions.computeFor = txn =>
      txn.base
        ? computeBudgetForBase(catalog, baseOfTxn(nextData, txn), nextData)
        : computeBudgetForTheater(catalog, readBases(nextData), nextData);
    // ENG-PROJ-01 workload 映射接缝（任务卡第 7 条）：扁平四类条目走 entryForTxn → assemblySpecOf，
    // 工程投影项按命名合同 `ref·段名` 由 engAssemblySpecFor 解析静态段定义（V1 retrofit phase + V2 project module）；
    // 与研究 workload 走同一 TwoStageSpec{tflops,tops} 通道进冻结引擎（req_nanites 结构性不映射：开工门≠抵扣，§3.5/D8b）
    const engDefs = [...(catalog.retrofits ?? []), ...(catalog.projects ?? [])];
    settleOptions.assemblyFor = txn =>
      assemblySpecOf(entryForTxn(catalog, txn), txn.qty ?? 1) ?? engAssemblySpecFor(engDefs, txn);
    // UTO-SETTLE-01：工位键、局部并行上限与全局并发上限统一委托 LaneRegistryHub 组合派发，彻底清零三路硬编码分支
    settleOptions.laneKeyFor = txn => laneHub.resolveLaneKeyForTxn(txn, laneEnv);
    settleOptions.parallelLimitFor = txn => laneHub.resolveParallelLimitForTxn(txn, laneEnv);
    settleOptions.globalLimitFor = type => laneHub.resolveGlobalLimitForType(type, laneEnv);
  }

  // clock / started_at 用的游戏内日历时刻（Δt>0 才推进；Δt=0 不写 clock、不补开工时刻）
  let now: string | undefined;
  let clock: { day: number; time: string } | undefined;
  if (deltaMinutes > 0) {
    const prev = prevData as { clock?: { day?: unknown; time?: unknown }; meta?: { day_count?: unknown } } | undefined;
    const prevDay =
      readNonNegNum(prev?.clock?.day) ?? readNonNegNum(prev?.meta?.day_count) ?? Math.max(0, nextData.meta.day_count);
    // 续楼累进：prev.clock.time 作为当日起点（真机踩坑：否则每楼从 meta.date 隐含的 08:00 重推，时钟倒退）；
    // prev 无 clock（旧档/首次写入）时退化为 meta.date + 默认 08:00 起点。
    const prevTime =
      typeof prev?.clock?.time === 'string' && /^\d{1,2}:\d{2}$/.test(prev.clock.time) ? prev.clock.time : null;
    const baseDate = prevTime ? `${nextData.meta.date} ${prevTime}` : nextData.meta.date;
    const adv = advanceCalendar(baseDate, deltaMinutes, prevDay, { appendTimeIfMissing: true });
    clock = { day: adv.newDayCount, time: adv.timeStr ?? '' };
    if (adv.newDate) now = adv.newDate;
  }
  settleOptions.now = now;
  // 调度令直通（CTRL-DISPATCH-PARSE-01）：非空才注入，缺省时 settleTransactions 走 ?? [] 空循环
  if (options.orders && options.orders.length > 0) settleOptions.orders = options.orders;

  let workingQueues = backfill.queues;
  let workingNextData = nextData;
  let totalNanitesDeducted = 0;

  // BUG-LIVE-10：识别本楼 S1_PARSE 新增的零进度待命项（不在 prevData.queues 中）。
  // 当本楼 Δt > 0 时，先对这些本楼新建待命项执行一次 0 分钟空闲产线预升格，使其在空闲产线上先升格为 active 并参与本楼 Step ② Δt 积分；
  // 而 prevData.queues 中原有的存量 queued 项保持原样，留待正式 settleWithTwoStage 的 Step ④（积分后）升格。
  const prevQueueIdentities = new Set(
    readQueues(prevData).map(pq => `${pq.type}\u0000${canon(pq.item)}\u0000${pq.base}`),
  );
  const isNewFloorZeroQueued = (q: TransactionItem): boolean =>
    q.status === 'queued' &&
    !q.hold &&
    (q.spent_minutes ?? 0) <= 0 &&
    !prevQueueIdentities.has(`${q.type}\u0000${canon(q.item)}\u0000${q.base}`);

  if (deltaMinutes > 0 && workingQueues.some(isNewFloorZeroQueued)) {
    const originalHoldByIdx = new Map<number, boolean>();
    const preQueues = workingQueues.map((q, idx) => {
      if (q.status === 'queued' && !q.hold && !isNewFloorZeroQueued(q)) {
        originalHoldByIdx.set(idx, q.hold);
        return { ...q, hold: true };
      }
      return q;
    });
    const { orders: _omitOrders, now: _omitNow, ...prePromoteOptions } = settleOptions;
    const preSettled = settleWithTwoStage(
      { ...workingNextData, queues: preQueues },
      0,
      prePromoteOptions,
    );
    let preNanites = 0;
    for (const event of preSettled.events) {
      if (event.type === 'nanites_deducted') {
        preNanites += event.amount;
        totalNanitesDeducted += event.amount;
      }
      events.push(eventToParseEvent(event));
      const issue = eventToIssue(event);
      if (issue) issues.push(issue);
    }
    workingQueues = preSettled.next.queues.map((q, idx) =>
      originalHoldByIdx.has(idx) ? { ...q, hold: originalHoldByIdx.get(idx)! } : q,
    );
    if (preNanites > 0) {
      workingNextData = deductNanitesStock(workingNextData, preNanites);
    }
    if (catalog) {
      const updatedLaneEnv: LaneResolveEnv = {
        bases: readBases(workingNextData),
        queues: workingQueues,
        catalog,
      };
      settleOptions.nanitesFor = () => readTotalNanites(workingNextData);
      settleOptions.laneKeyFor = txn => laneHub.resolveLaneKeyForTxn(txn, updatedLaneEnv);
      settleOptions.parallelLimitFor = txn => laneHub.resolveParallelLimitForTxn(txn, updatedLaneEnv);
      settleOptions.globalLimitFor = type => laneHub.resolveGlobalLimitForType(type, updatedLaneEnv);
    }
  }

  const settled = settleWithTwoStage({ ...workingNextData, queues: workingQueues }, deltaMinutes, settleOptions);
  for (const event of settled.events) {
    if (event.type === 'nanites_deducted') {
      totalNanitesDeducted += event.amount;
    }
    events.push(eventToParseEvent(event));
    const issue = eventToIssue(event);
    if (issue) issues.push(issue);
  }
  const beforeNaniteDeduct = settled.next as StatData;
  const tAfterS2c = performance.now();
  substages.push(
    buildSubstageRecord('S2c_TWO_STAGE', nextData, beforeNaniteDeduct, {
      durationMs: Math.round((tAfterS2c - tS2cStart) * 100) / 100,
    }),
  );

  const afterTwoStageRaw = deductNanitesStock(
    beforeNaniteDeduct,
    settled.events.reduce((sum, ev) => (ev.type === 'nanites_deducted' ? sum + ev.amount : sum), 0),
  );
  const tAfterS2i = performance.now();
  substages.push(
    buildSubstageRecord('S2i_NANITE_STOCK', beforeNaniteDeduct, afterTwoStageRaw, {
      durationMs: Math.round((tAfterS2i - tAfterS2c) * 100) / 100,
      meta: { totalNanitesDeducted },
    }),
  );

  // FD-38 · 建造队列满进度自动转正：当 type === '建造' 推进达 progress >= 100（settling / done）时，
  // 若目标基地 buildings 中有同名 state === '建造中' 的建筑，自动将其翻转为 '运转'
  let afterTwoStage = afterTwoStageRaw;
  let hasNewlyCompletedBuild = false;
  if (Array.isArray(afterTwoStage.bases) && afterTwoStage.bases.length > 0) {
    const completedBuildQueues = (afterTwoStage.queues ?? []).filter(
      q =>
        q.type === '建造' &&
        (q.progress ?? 0) >= 100 &&
        (q.status === 'settling' || q.status === 'done') &&
        (q.building_delivered_qty ?? 0) < Math.max(1, Math.floor(q.qty ?? 1)),
    );
    if (completedBuildQueues.length > 0) {
      hasNewlyCompletedBuild = true;
      let basesMutated = false;
      const deliveredDelta = new Map<unknown, number>();
      const singleBase = afterTwoStage.bases.length === 1 ? afterTwoStage.bases[0] : undefined;
      const nextBases = afterTwoStage.bases.map(b => {
        const matchesBase = (q: (typeof completedBuildQueues)[number]) =>
          q.base ? b.id === q.base || canon(b.name) === canon(q.base) : b === singleBase;
        const blds = b.buildings ?? [];
        const hasUnderConstMatch = completedBuildQueues.some(q => {
          if (!matchesBase(q)) return false;
          return blds.some(bd => canon(bd.name) === canon(q.item) && bd.state === '建造中');
        });
        if (!hasUnderConstMatch) return b;

        const clonedBlds = [...blds];
        for (const q of completedBuildQueues) {
          if (!matchesBase(q)) continue;
          const already = (q.building_delivered_qty ?? 0) + (deliveredDelta.get(q) ?? 0);
          const targetFlip = Math.max(0, Math.max(1, Math.floor(q.qty ?? 1)) - already);
          let flipped = 0;
          for (let i = 0; i < clonedBlds.length && flipped < targetFlip; i++) {
            if (canon(clonedBlds[i].name) === canon(q.item) && clonedBlds[i].state === '建造中') {
              const nextBd = {
                ...clonedBlds[i],
                state: '运转' as const,
              } as Record<string, unknown>;
              delete nextBd.progress;
              delete nextBd.eta;
              clonedBlds[i] = nextBd as (typeof clonedBlds)[number];
              flipped++;
              basesMutated = true;
            }
          }
          if (flipped > 0) deliveredDelta.set(q, (deliveredDelta.get(q) ?? 0) + flipped);
        }
        return {
          ...b,
          buildings: clonedBlds,
        };
      });
      if (basesMutated) {
        afterTwoStage = {
          ...afterTwoStage,
          bases: nextBases,
          queues: afterTwoStage.queues.map(q =>
            deliveredDelta.has(q)
              ? { ...q, building_delivered_qty: (q.building_delivered_qty ?? 0) + deliveredDelta.get(q)! }
              : q,
          ),
        };
      }
    }
  }

  // BUG-R2-20 · 队列满工时系统主权自动完工交割：
  // 只要 <timePast> 推进后（deltaMinutes > 0 或显式开启 autoSettleCompleted）任何队列项达到 spent_minutes >= total_minutes（即进入 'settling'），
  // 即使当楼 LLM 完全没有输出 <生产> 标签，系统也当楼自动完成交割入库（status -> 'done'，建筑/部队/科技/工程自动入库）。
  const shouldAutoSettleInFloor =
    options.autoSettleCompleted === true || (options.autoSettleCompleted !== false && deltaMinutes > 0);
  if (
    shouldAutoSettleInFloor &&
    (afterTwoStage.queues ?? []).some(
      q => q.status === 'settling' && q.total_minutes > 0 && q.spent_minutes >= q.total_minutes,
    )
  ) {
    const inlineProd = parseProductionDeclarations(rawText);
    const skipIndices = new Set<number>();
    if (inlineProd.found) {
      for (const decl of inlineProd.declarations) {
        const cItem = canon(decl.item);
        const matchedIndices: number[] = [];
        (afterTwoStage.queues ?? []).forEach((q, idx) => {
          if (q.status !== 'settling') return;
          if (canon(q.item) !== cItem) return;
          if (decl.type && canon(q.type) !== canon(decl.type)) return;
          if (decl.base) {
            const cDeclBase = canon(decl.base);
            const matchedBaseObj = (afterTwoStage.bases ?? []).find(
              b => b.id === decl.base || canon(b.name) === cDeclBase,
            );
            const okBase =
              q.base === decl.base ||
              canon(q.base) === cDeclBase ||
              (matchedBaseObj !== undefined &&
                (q.base === matchedBaseObj.id || canon(q.base) === canon(matchedBaseObj.name)));
            if (!okBase) return;
          }
          matchedIndices.push(idx);
        });
        if (matchedIndices.length > 1) {
          for (const idx of matchedIndices) skipIndices.add(idx);
        } else if (matchedIndices.length === 1) {
          const q = afterTwoStage.queues[matchedIndices[0]];
          const qty = Math.max(1, Math.floor(q.qty ?? 1));
          if (decl.qty !== qty) {
            skipIndices.add(matchedIndices[0]);
          }
        }
      }
    }
    const derivedCategories = buildItemCategoriesFromCatalog(catalog);
    const stateForAutoSettle =
      Object.keys(derivedCategories).length > 0
        ? {
            ...afterTwoStage,
            itemCategories: {
              ...derivedCategories,
              ...((afterTwoStage as { itemCategories?: Record<string, 'troops' | 'vehicles' | 'equipment'> })
                .itemCategories ?? {}),
            },
          }
        : afterTwoStage;
    const autoSettled = autoSettleCompletedQueues(stateForAutoSettle, {
      requirePositiveTotalMinutes: true,
      skipIndices,
    });
    if (autoSettled.events.length > 0) {
      if (autoSettled.next.queues.some(q => q.type === '建造' && q.status === 'done')) {
        hasNewlyCompletedBuild = true;
      }
      const { itemCategories: _omitCat, ...cleanNext } = autoSettled.next as StatData & {
        itemCategories?: unknown;
      };
      afterTwoStage = cleanNext as StatData;
      for (const ev of autoSettled.events) {
        events.push(reconcileEventToParseEvent(ev));
        const issue = reconcileEventToIssue(ev);
        if (issue) issues.push(issue);
      }
    }
  }

  const tAfterS2d = performance.now();
  substages.push(
    buildSubstageRecord('S2d_BUILD_COMM', afterTwoStageRaw, afterTwoStage, {
      durationMs: Math.round((tAfterS2d - tAfterS2i) * 100) / 100,
    }),
  );

  // ④′ 模式切换结算（产线设计案 §4.4：720 分钟校准入账本链；Δt≤0 或旧档无挂载 → 零行为变化）
  const switched = settleModeSwitches(afterTwoStage, deltaMinutes);
  for (const e of switched.events) {
    events.push({
      light: e.type === 'mode_switch_orphan' ? '🟡' : '🟢',
      layer: 'instruction',
      message: `[结算] ${e.type}「${e.building}」：${e.detail}`,
      path: 'bases',
    });
  }
  for (const message of slotWarns) {
    issues.push({ rule: 'R21', level: 'warn', target: 'queues', message });
  }

  // ④″ 展开/收起结算（E3a · CTRL-DEPLOY-01，仿 ④′ 模式切换接缝形制）：
  // 本楼部署令先入账（requestDeployment：同车在途旧指令被替换/幂等/护栏拒收 🟡 留痕），
  // 再以 Δt 推进在途翻转（settleDeployments）；Δt≤0 或旧档无挂载 → 结算零行为变化。
  const deployIndex = catalog
    ? deployBlockIndexFromCatalog({
        buildings: catalog.buildings,
        productions: catalog.productions,
        retrofits: catalog.retrofits,
      })
    : undefined;
  let deployBooked = switched.next;
  const effectiveDeployOrders: DeploymentRequest[] = [...(options.deployOrders ?? [])];
  if (effectiveDeployOrders.length === 0 && options.eventDeclarations) {
    const fallbackDeployIdx = deployIndex ?? deployBlockIndexFromCatalog({});
    for (const evDecl of options.eventDeclarations) {
      if (evDecl.kind !== 'deploy' || !evDecl.deploy) continue;
      const d = evDecl.deploy;
      const defaultBase =
        d.base?.trim() ||
        d.newBaseName?.trim() ||
        deployBooked.bases[0]?.id ||
        deployBooked.bases[0]?.name ||
        '';
      if (!defaultBase) continue;
      if (d.action === '展开') {
        const vehicle = d.vehicle?.trim() || 'MCV';
        const block = fallbackDeployIdx.byVehicle(vehicle) ?? {
          into: '盟军建造厂',
          duration_min: 0,
          reverse: true,
        };
        const newBaseMeta = {
          ...(d.tz_offset !== undefined ? { tz_offset: d.tz_offset } : {}),
          ...(d.weather ? { weather: d.weather } : {}),
          ...(d.site_type ? { site_type: d.site_type } : {}),
        };
        const hasNewBaseMeta = Object.keys(newBaseMeta).length > 0;
        effectiveDeployOrders.push({
          vehicle,
          action: '展开',
          base: d.newBaseName?.trim() || defaultBase,
          into: d.building?.trim() || block.into,
          ...(d.newBaseName?.trim()
            ? {
                new_base: {
                  name: d.newBaseName.trim(),
                  location: d.location ?? '',
                  ...newBaseMeta,
                },
              }
            : hasNewBaseMeta
              ? {
                  new_base: {
                    name: defaultBase,
                    location: d.location ?? '',
                    ...newBaseMeta,
                  },
                }
              : {}),
          duration_min: block.duration_min ?? 0,
        });
      } else {
        const into = d.building?.trim() || '建造厂';
        const hit = fallbackDeployIdx.byInto(into);
        effectiveDeployOrders.push({
          vehicle: d.vehicle?.trim() || hit?.vehicle || 'MCV（盟军）',
          action: '收起',
          base: defaultBase,
          into,
          duration_min: hit?.block.duration_min ?? 0,
        });
      }
    }
  }
  if (effectiveDeployOrders.length > 0) {
    const reqDeployIndex = deployIndex ?? deployBlockIndexFromCatalog({});
    for (const order of effectiveDeployOrders) {
      deployBooked = requestDeployment(
        deployBooked,
        order,
        w => {
          events.push({
            light: '🟡',
            layer: 'instruction',
            message: `[结算] 部署令拒收「${w.vehicle}」（${w.reason}）：${w.detail}`,
            path: 'pending_deployments',
          });
        },
        { deploy: deployIndex ?? (order.into.includes('建造厂') ? reqDeployIndex : undefined) },
      );
    }
  }
  const deployed = settleDeployments(deployBooked, deltaMinutes, {
    basePowerFor: into => {
      if (catalog) {
        const def = findCatalogBuildingDef(catalog.buildings, into);
        const power = readCatalogBuildingPower((def as unknown as Record<string, unknown> | undefined)?.power);
        if (power && (power.gen !== undefined || power.use !== undefined)) {
          return { gen: power.gen ?? 0, use: power.use ?? 0 };
        }
      }
      if (CONYARD_DEFAULT_POWER_NAMES.some(c => canon(c) === canon(into))) {
        return { gen: 50, use: 0 };
      }
      return undefined;
    },
  });
  for (const e of deployed.events) {
    events.push({
      light: e.light,
      layer: 'instruction',
      message: `[结算] ${e.type}「${e.vehicle}」：${e.detail}`,
      path: 'bases',
    });
  }

  // UNIT-TRANSFER-01：先按本轮 Δt 推进跨楼在途调配（到期自动守恒划转 bases[].forces / girls[].base），
  // 再登记本轮新增的 <事件> 单位调配指令（耗时=0 当楼瞬达；耗时>0 挂入 pending_transfers 供前端展示剩余时间）
  const transferSettled = settleUnitTransfers(deployed.next, deltaMinutes);
  for (const te of transferSettled.events) {
    events.push({
      light: te.light,
      layer: 'instruction',
      message: `[调配] ${te.detail}`,
      path: 'pending_transfers',
    });
  }
  let afterTransfers = transferSettled.next;
  const transferDecls = (options.eventDeclarations ?? []).filter(
    (d): d is EventDeclaration & { kind: 'transfer' } => d.kind === 'transfer' && d.transfer !== undefined,
  );
  for (const td of transferDecls) {
    const tr = td.transfer!;
    const booked = requestUnitTransfer(afterTransfers, {
      unit: tr.unit,
      category: tr.category,
      qty: tr.qty,
      from_base: tr.from_base,
      to_base: tr.to_base,
      duration_min: tr.duration_min,
      remaining_min: tr.remaining_min,
      method: tr.method,
      reason: tr.reason,
      started_at: afterTransfers.meta?.date ?? '',
    });
    afterTransfers = booked.next;
    for (const te of booked.events) {
      events.push({
        light: te.light,
        layer: 'instruction',
        message: `[调配] ${te.detail}`,
        path: 'pending_transfers',
      });
    }
  }

  const tAfterS2e = performance.now();
  substages.push(
    buildSubstageRecord('S2e_DEPLOY_MODE', afterTwoStage, afterTransfers, {
      durationMs: Math.round((tAfterS2e - tAfterS2d) * 100) / 100,
    }),
  );

  let afterSpace = afterTransfers;
  const prevSpaceContractIds = new Set(
    ((prevData as StatData | undefined)?.space?.contracts ?? [])
      .filter(c => c && c.status !== 'completed' && c.status !== 'failed')
      .map(c => c.id),
  );
  const hasTimedSpaceContract =
    deltaMinutes > 0 &&
    prevSpaceContractIds.size > 0 &&
    (afterSpace.space?.contracts?.some(
      c =>
        c &&
        prevSpaceContractIds.has(c.id) &&
        c.status !== 'completed' &&
        c.status !== 'failed' &&
        typeof c.duration_days === 'number' &&
        c.duration_days > 0,
    ) ??
      false);
  if (hasTimedSpaceContract && afterSpace.space?.contracts) {
    afterSpace = {
      ...afterSpace,
      economy: { ...afterSpace.economy },
      space: {
        ...afterSpace.space,
        orbital_assets: [...(afterSpace.space.orbital_assets ?? [])],
        contracts: afterSpace.space.contracts.map(c => ({ ...c })),
      },
    };
    for (const c of afterSpace.space.contracts) {
      if (
        c &&
        prevSpaceContractIds.has(c.id) &&
        c.status !== 'completed' &&
        c.status !== 'failed' &&
        typeof c.duration_days === 'number' &&
        c.duration_days > 0
      ) {
        const prevElapsed = typeof c.elapsed_days === 'number' ? c.elapsed_days : 0;
        c.elapsed_days = Math.round((prevElapsed + deltaMinutes / 1440) * 10000) / 10000;
      }
    }
    const spaceRes = settleSpaceOperations(afterSpace, []);
    for (const launchedId of spaceRes.launchedIds) {
      const completedContract = afterSpace.space.contracts.find(item => item.id === launchedId);
      events.push({
        light: '🟢',
        layer: 'instruction',
        message: `[航天] 商业合同完结「${completedContract?.title ?? launchedId}」（${launchedId}）：载荷「${completedContract?.payload ?? ''}」入轨，回款 +${completedContract?.reward_credits ?? spaceRes.creditsEarned} 资金`,
        path: 'space.contracts',
      });
    }
  }
  substages.push(
    buildSubstageRecord('S2g_SPACE', deployed.next, afterSpace, {
      durationMs: 0,
    }),
  );
  const tBeforeS2f = performance.now();

  // ④‴ 工程里程碑回写（ENG-PROJ-01 §3.3）：投影项 done/cancelled → 阶段状态/指针回写，
  // 全阶段完工 → 工程完工＋outcome{mark}；projects[] 缺席（旧档零注入）时 syncProjects 原样返回，
  // 逐字节零行为变化。位置在 ④″ 部署结算之后、R26/R27 只读校验之前（校验面对最终快照）。
  const projSyncedRaw = syncProjects(afterSpace);
  for (const e of projSyncedRaw.events) {
    events.push({
      light: e.type === 'sync_warn' ? '🟡' : '🟢',
      layer: 'instruction',
      message: `[工程] ${e.type}「${e.item}」${e.detail ? `：${e.detail}` : ''}`,
      path: 'projects',
    });
  }

  // FD-38 / BUG-R2-14 · 基地电网（base.power）动态重算：在部署结算之后、applyGridConstraints 之前，
  // 按在场 state === '运转' 的建筑诚实汇总 catalog.buildings 的 power.gen / power.use（四类主建造厂缺省按 50W 计）
  const prevBasesSnapshot = [
    ...readBases(prevData),
    ...(Array.isArray(afterTwoStage.bases) ? afterTwoStage.bases : []),
  ];
  const projSynced = {
    ...projSyncedRaw,
    next: recomputeBasePowerFromCatalog(projSyncedRaw.next, catalog, prevBasesSnapshot, {
      useBuiltinFallback: hasNewlyCompletedBuild,
    }),
  };

  // ④⁗ 资金链事件、电网/天候工况硬联动与时钟结算（EVT-SETTLE-01 + EVT-OPR-01 · 事件系统总设计案 §3.3/§6.3）：
  const chainDecls = (options.eventDeclarations ?? []).filter(
    (d): d is EventDeclaration & { kind: 'chain' } => d.kind === 'chain' && d.chain !== undefined,
  );
  const chainsBefore: IncomeChain[] = projSynced.next.economy.chains ?? [];
  let afterChains = projSynced.next;
  if (chainsBefore.length > 0 || chainDecls.length > 0) {
    const gameDay = Number.isFinite(projSynced.next.meta.day_count) ? projSynced.next.meta.day_count : 0;
    let chains = chainsBefore;
    for (const decl of chainDecls) {
      const basePayload = chainPayloadOf(decl);
      const declChainAny = decl.chain as (Record<string, unknown> & NonNullable<typeof decl.chain>) | undefined;
      const declDepsAny =
        declChainAny?.deps && typeof declChainAny.deps === 'object'
          ? (declChainAny.deps as Record<string, unknown>)
          : undefined;
      const vehicles = Array.isArray(declChainAny?.vehicles)
        ? (declChainAny.vehicles as string[])
        : Array.isArray(declDepsAny?.vehicles)
          ? (declDepsAny.vehicles as string[])
          : undefined;
      const faction =
        typeof declChainAny?.faction === 'string' && declChainAny.faction.trim()
          ? declChainAny.faction.trim()
          : typeof declDepsAny?.faction === 'string' && declDepsAny.faction.trim()
            ? declDepsAny.faction.trim()
            : undefined;
      const worldResource =
        typeof declChainAny?.world_resource === 'string' && declChainAny.world_resource.trim()
          ? declChainAny.world_resource.trim()
          : typeof declDepsAny?.world_resource === 'string' && declDepsAny.world_resource.trim()
            ? declDepsAny.world_resource.trim()
            : undefined;
      const payload: ChainEventPayload = {
        ...basePayload,
        ...(declChainAny?.chain_kind ? { chain_kind: declChainAny.chain_kind as ChainKind } : {}),
        ...(declChainAny?.wallet_daily && typeof declChainAny.wallet_daily === 'object'
          ? { wallet_daily: declChainAny.wallet_daily as Record<string, number> }
          : {}),
        ...(declChainAny?.resources_daily && typeof declChainAny.resources_daily === 'object'
          ? { resources_daily: declChainAny.resources_daily as Record<string, Record<string, number>> }
          : {}),
        ...(basePayload.deps || vehicles || faction || worldResource
          ? {
              deps: {
                ...basePayload.deps,
                ...(vehicles ? { vehicles } : {}),
                ...(faction ? { faction } : {}),
                ...(worldResource ? { world_resource: worldResource } : {}),
              },
            }
          : {}),
        ...(declChainAny?.capacity && typeof declChainAny.capacity === 'object'
          ? { capacity: declChainAny.capacity as { total_yield?: number | null; extracted?: number } }
          : typeof declChainAny?.total_yield === 'number'
            ? { capacity: { total_yield: declChainAny.total_yield } }
            : {}),
      };
      chains = applyChainEvent(chains, payload, gameDay);
      events.push({
        light: '🟢',
        layer: 'instruction',
        message: `[资金链] ${payload.action}「${decl.chain?.name ?? payload.name ?? payload.id}」${decl.chain?.reason ? `：${decl.chain.reason}` : ''}`,
        path: 'economy.chains',
      });
    }

    const basePowerViews: BasePowerView[] = readBases(projSynced.next).map(b => ({
      id: b.id,
      name: b.name,
      power: resolveEffectiveBasePower(b, projSynced.next),
      buildings: Array.isArray(b.buildings) ? b.buildings : [],
    }));
    const gridRes = applyGridConstraints({ chains, bases: basePowerViews, nowDay: gameDay });
    chains = gridRes.chains;
    for (const ev of gridRes.events) {
      events.push({
        light: ev.kind === 'grid_outage' ? '🟡' : '🟢',
        layer: 'instruction',
        message: `[资金链] ${ev.kind === 'grid_outage' ? '电网断供' : '电网恢复'}「${ev.name}」：${ev.detail}`,
        path: 'economy.chains',
      });
    }

    if (chainDecls.length > 0 || deltaMinutes > 0 || gridRes.events.length > 0) {
      const metaWeather = (projSynced.next.meta as Record<string, unknown> | undefined)?.weather;
      const weather =
        typeof options.weather === 'string'
          ? options.weather
          : typeof metaWeather === 'string'
            ? metaWeather
            : undefined;
      const basesForWeather = readBases(projSynced.next);
      const weatherAdjustedChains =
        deltaMinutes > 0 && chains.length > 0
          ? withWeatherView(chains, weather, basesForWeather)
          : chains;
      const chainsForSettle =
        deltaMinutes > 0 && weatherAdjustedChains.length > 0
          ? weatherAdjustedChains.map(c => {
              if (c.flow === '支出' || !(c.rate_daily > 0)) return c;
              const chainMods = evaluateCommandHQModifiers(
                projSynced.next,
                c.deps?.base_id || undefined,
              );
              if (chainMods.positiveChainBonus <= 0) return c;
              return {
                ...c,
                rate_daily: c.rate_daily * (1 + chainMods.positiveChainBonus),
              };
            })
          : weatherAdjustedChains;
      const settledChains = settleChainsDeltaT(chainsForSettle, deltaMinutes, gameDay, {
        wallet: projSynced.next.economy.wallet,
        resources: projSynced.next.economy.resources,
      });
      const persistedChains = settledChains.nextChains.map((sc, idx) =>
        sc.status === 'exhausted' ||
        (sc.status === 'distressed' && sc.eff === 0 && sc.reason.includes('上游原料/外币不足暂停'))
          ? { ...sc, rate_daily: chains[idx]?.rate_daily ?? sc.rate_daily }
          : {
              ...sc,
              eff: chains[idx]?.eff ?? sc.eff,
              rate_daily: chains[idx]?.rate_daily ?? sc.rate_daily,
            },
      );
      for (const ex of settledChains.exhaustedEvents) {
        events.push({
          light: '🟡',
          layer: 'instruction',
          message: `[资金链] 枯竭「${ex.name}」：资源蕴藏达上限，链条自动闭锁（eff=0，后续停息）`,
          path: 'economy.chains',
        });
      }
      if (deltaMinutes > 0 && chains.length > 0) {
        events.push({
          light: '🟢',
          layer: 'instruction',
          message: `[资金链] 时钟结算 Δt=${deltaMinutes} 分钟：净入 ${settledChains.deltaCredits >= 0 ? '+' : ''}${settledChains.deltaCredits} credits（在册 ${chains.length} 条链条）`,
          path: 'economy.credits',
        });
      }
      const eco = projSynced.next.economy;
      let nextWallet = eco.wallet;
      if (Object.keys(settledChains.deltaWallet).length > 0) {
        nextWallet = { ...(eco.wallet ?? {}) };
        for (const [curr, delta] of Object.entries(settledChains.deltaWallet)) {
          if (!Number.isFinite(delta) || delta === 0) continue;
          const matchKey = Object.keys(nextWallet).find(k => canon(k) === canon(curr)) ?? curr;
          nextWallet[matchKey] = Math.max(0, Math.round((nextWallet[matchKey] ?? 0) + delta));
        }
      }

      let nextResources = eco.resources;
      if (Object.keys(settledChains.deltaResources).length > 0) {
        const clonedResources = eco.resources
          ? {
              nanites: { ...eco.resources.nanites },
              minerals: { ...eco.resources.minerals },
              materials: { ...eco.resources.materials },
              fuel: { ...eco.resources.fuel },
              munitions: { ...eco.resources.munitions },
              logistics: { ...eco.resources.logistics },
            }
          : EconomyResources.parse({});
        for (const [rawPillar, subMap] of Object.entries(settledChains.deltaResources)) {
          const pKey = normalizeChainResourcePillar(rawPillar) as keyof EconomyResources;
          const bucket = (clonedResources as Record<string, Record<string, number | null>>)[pKey];
          if (!bucket || typeof bucket !== 'object') continue;
          for (const [subName, delta] of Object.entries(subMap)) {
            if (!Number.isFinite(delta) || delta === 0) continue;
            const matchKey = Object.keys(bucket).find(k => canon(k) === canon(subName)) ?? subName;
            const prevVal = bucket[matchKey];
            if (prevVal === null || prevVal === undefined) {
              if (delta > 0) {
                bucket[matchKey] = Math.max(0, Math.round(delta));
              }
            } else {
              bucket[matchKey] = Math.max(0, Math.round(prevVal + delta));
            }
          }
        }
        nextResources = clonedResources;
      }

      afterChains = {
        ...projSynced.next,
        economy: {
          ...eco,
          credits: Math.round((Number.isFinite(eco.credits) ? eco.credits : 0) + settledChains.deltaCredits),
          credits_daily: calcDailyNet(persistedChains),
          wallet: nextWallet,
          ...(nextResources !== undefined ? { resources: nextResources } : {}),
          chains: persistedChains,
        },
      } as StatData;
    }
  }

  const tAfterS2f = performance.now();
  substages.push(
    buildSubstageRecord('S2f_CHAINS_GRID', afterSpace, afterChains, {
      durationMs: Math.round((tAfterS2f - tBeforeS2f) * 100) / 100,
    }),
  );

  // ④⁗ 跨维暗网时钟与多元建筑被动现金流结算（DARKNET-CORE-01）
  const afterDarknet = {
    ...afterChains,
    economy: { ...afterChains.economy },
  } as StatData;
  const darknetTicked = tickDarknetAndPassiveEconomy(
    afterDarknet,
    deltaMinutes,
    clock?.day ?? afterDarknet.clock?.day ?? afterDarknet.meta?.day_count ?? 0,
  );
  events.push(...darknetTicked.events);
  const tAfterS2h = performance.now();
  substages.push(
    buildSubstageRecord('S2h_DARKNET_ECON', afterChains, afterDarknet, {
      durationMs: Math.round((tAfterS2h - tAfterS2f) * 100) / 100,
    }),
  );

  // ④⁘ 协议结算齿轮（PRT-EVT-01 · 任务包 §3.5.3 / §3.6.1 / D-P5c / D-P9b / D-P16b / D-P27）
  const protocolSettled = settleFloorProtocols(afterDarknet, deltaMinutes, clock?.day, options);
  events.push(...protocolSettled.events);

  const afterProtocols = (clock ? { ...protocolSettled.next, clock } : { ...protocolSettled.next }) as StatData;
  const tAfterS2b = performance.now();
  substages.push(
    buildSubstageRecord('S2b_PROTOCOLS', afterDarknet, afterProtocols, {
      durationMs: Math.round((tAfterS2b - tAfterS2h) * 100) / 100,
    }),
  );

  // ④⁙ 联席参谋部结算切片（CMD-ENGINE-01：参谋槽同步 + 机娘副官重伤休眠联动 + 人类副官日薪折算 + 15 日磨合代价消解）
  const adjutantDecls = (options.eventDeclarations ?? []).filter(
    (d): d is EventDeclaration & { kind: 'adjutant'; adjutant: AdjutantEventDecl } =>
      d.kind === 'adjutant' && d.adjutant !== undefined,
  );
  const rawCmd = afterProtocols.command as (CommandHQ & { staff_slot_cap?: number }) | undefined;
  const hasCommandWork =
    adjutantDecls.length > 0 ||
    (rawCmd?.adjutants?.length ?? 0) > 0 ||
    (rawCmd?.break_in_penalties?.length ?? 0) > 0 ||
    rawCmd?.staff_slot_cap !== undefined;
  const data = (hasCommandWork ? { ...afterProtocols } : afterProtocols) as StatData;
  if (hasCommandWork) {
    data.command = cloneCommandHQ(data);
    if (data.economy) {
      data.economy = { ...data.economy };
    }
    const rawRes = (data as unknown as { resources?: Record<string, unknown> }).resources;
    if (rawRes && typeof rawRes === 'object') {
      (data as unknown as { resources: Record<string, unknown> }).resources = { ...rawRes };
    }
    for (const decl of adjutantDecls) {
      const declLogs = applyAdjutantEventDeclaration(data, decl.adjutant);
      for (const msg of declLogs) {
        events.push({
          light: '🟢',
          layer: 'instruction',
          message: msg,
          path: 'command.adjutants',
        });
      }
    }
    const cmdSlice = settleCommandHQSlice(data, deltaMinutes);
    for (const msg of cmdSlice.logs) {
      events.push({
        light: '🟢',
        layer: 'instruction',
        message: msg,
        path: 'command',
      });
    }

    // ④⁛ 暴露度反侦察减免与阵营磨合暴露底线硬约束（FD-26 · D-WIRE-1）
    if (data.exposure && typeof data.exposure.value === 'number') {
      const expMods = evaluateCommandHQModifiers(data);
      let maxExposureFloor = expMods.exposureFloor;
      for (const b of readBases(data)) {
        const bMods = evaluateCommandHQModifiers(data, b.id || b.name);
        if (bMods.exposureFloor > maxExposureFloor) {
          maxExposureFloor = bMods.exposureFloor;
        }
      }
      let nextExpVal = data.exposure.value;
      const prevExpVal = (prevData as Partial<StatData> | undefined)?.exposure?.value;
      if (
        typeof prevExpVal === 'number' &&
        Number.isFinite(prevExpVal) &&
        nextExpVal > prevExpVal &&
        expMods.exposureGainReduction > 0
      ) {
        const gain = nextExpVal - prevExpVal;
        const reducedGain = gain * Math.max(0, 1 - expMods.exposureGainReduction);
        nextExpVal = Math.round((prevExpVal + reducedGain) * 10000) / 10000;
      }
      if (maxExposureFloor > 0 && nextExpVal < maxExposureFloor) {
        nextExpVal = maxExposureFloor;
      }
      if (nextExpVal !== data.exposure.value) {
        data.exposure = {
          ...data.exposure,
          value: nextExpVal,
        };
      }
    }
  }
  const tAfterS2a = performance.now();
  substages.push(
    buildSubstageRecord('S2a_COMMAND', afterProtocols, data, {
      durationMs: Math.round((tAfterS2a - tAfterS2b) * 100) / 100,
    }),
  );

  // ⑤ R26 资产在账×队列存活交叉校验（CTRL-FIX-LEDGER-01）：对结算后快照只读检测，
  // 只追加 warn 体检记录——零结算行为变化、不拦截、不改状态机。
  issues.push(
    ...checkAssetQueueCross({
      queues: data.queues,
      techDone: data.tech.done,
      troops: data.forces.troops,
      vehicles: data.forces.vehicles,
      bases: readBases(data),
      prevTroops: (prevData as Partial<StatData> | undefined)?.forces?.troops,
      prevBases: prevData !== undefined ? readBases(prevData) : undefined,
    }),
  );
  // R27（E3a · 仿 R26 热路径，只警不拦）：展开在途×载具在账交叉校验（对结算后快照只读检测）
  issues.push(
    ...checkDeploymentVehicleCross({
      pendingDeployments: data.pending_deployments ?? [],
      vehicles: data.forces.vehicles,
    }),
  );
  reconcileStaleRejectedPlanningReceipt(data);
  return {
    data,
    events,
    issues,
    deltaMinutes,
    deltaSource: source,
    protocolSettlement: protocolSettled.receipt,
    substages,
  };
}

/* ═══════════════ UTO-SETTLE-01 · 统一任务编排管道桥接（LaneRegistryHub + DispatchBus + TickEngine） ═══════════════ */

export interface OrchestrateFloorTasksOptions {
  /** 有效目录快照 */
  catalog?: EffectiveCatalog | null;
  /** 旧版 <队列> 四动词调度令（自动经 fromLegacyDispatchOrders 转译为 UnifiedCommand） */
  orders?: DispatchOrder[];
  /** 标准六动词统一调度指令（Promote / Demote / Hold / Resume / Cancel / Allocate） */
  commands?: UnifiedCommand[];
  /** 游戏内当前日历时刻（为新升格 active 任务补记 startedAt） */
  now?: string;
}

export interface OrchestrateFloorTasksResult {
  /** LaneRegistryHub 解析出的全域与属地工位快照 */
  lanes: LaneStationView[];
  /** 投影适配器生成的初始 UnifiedTask 快照（queues[] + projects[] 指针合一） */
  initialTasks: UnifiedTask[];
  /** UnifiedDispatchBus 指令执行结果 */
  dispatchResult: DispatchBusResult;
  /** tickTaskOrchestration 三阶段步进结果（含两阶段分装减免与 minDaysLock 钳制） */
  tickResult: TickResult;
  /** 本轮满额转入 settling 待过三色对账门的任务 ID 清单 */
  settlingTaskIds: string[];
}

/**
 * orchestrateFloorTasks —— 串联 LaneRegistryHub → toUnifiedTasks → UnifiedDispatchBus → tickTaskOrchestration
 * 的纯函数编排管道入口（供阶段二统一编排核验与跨领域混合并发推进使用，入参零突变）。
 */
export function orchestrateFloorTasks(
  data: StatData,
  deltaMinutes: number,
  options: OrchestrateFloorTasksOptions = {},
): OrchestrateFloorTasksResult {
  const rawCatalog = options.catalog ?? null;
  const catalog: EffectiveCatalog | null = rawCatalog
    ? ({
        researches: rawCatalog.researches ?? [],
        buildings: rawCatalog.buildings ?? [],
        productions: rawCatalog.productions ?? [],
        retrofits: rawCatalog.retrofits ?? [],
        projects: rawCatalog.projects ?? [],
        factionDefs: rawCatalog.factionDefs ?? [],
      } as EffectiveCatalog)
    : null;
  const bases = readBases(data);
  const queues = data.queues.map(q => ({ ...q }) as TransactionItem);
  const laneHub = createLaneRegistryHub();
  const emptyCatalog = {
    researches: [],
    buildings: [],
    productions: [],
    retrofits: [],
    projects: [],
    factionDefs: [],
  } as unknown as EffectiveCatalog;
  const laneEnv: LaneResolveEnv = {
    bases,
    queues,
    catalog: catalog ?? emptyCatalog,
  };
  const lanes = catalog ? laneHub.resolveAllLanes(laneEnv) : [];
  const initialTasks = toUnifiedTasks({ bases, queues, projects: data.projects }, catalog ?? undefined, lanes);
  const legacyCommands =
    options.orders && options.orders.length > 0 ? fromLegacyDispatchOrders(options.orders, initialTasks) : [];
  const allCommands: UnifiedCommand[] = [...legacyCommands, ...(options.commands ?? [])];
  const dispatchResult = applyUnifiedCommands(initialTasks, lanes, allCommands, {
    now: options.now,
    laneEnv: catalog ? laneEnv : undefined,
  });

  const txnEffFor = makeTxnEffFor(catalog, data);
  const tickResult = tickTaskOrchestrationEquivalentToSettleFloor(dispatchResult.nextTasks, lanes, {
    deltaMinutes,
    now: options.now,
    powerEfficiency: task => {
      if (task.metadata?.sourceKind === 'queue' && typeof task.metadata?.queueIndex === 'number') {
        const q = queues[task.metadata.queueIndex];
        if (q) return txnEffFor(q);
      }
      if (!catalog) return 1;
      const base = baseOfIdOrName(data, task.leadBaseId);
      if (!base) return 1;
      const evals = evalBaseBuildings(catalog, base, data);
      return evals.length > 0 ? Math.min(...evals.map(e => e.efficiency)) : 1;
    },
    computeFor: catalog
      ? task =>
          task.leadBaseId
            ? computeBudgetForBase(catalog, baseOfIdOrName(data, task.leadBaseId), data)
            : computeBudgetForTheater(catalog, bases, data)
      : undefined,
    assemblyFor: catalog
      ? task => {
          if (task.metadata?.sourceKind === 'queue' && typeof task.metadata?.queueIndex === 'number') {
            const q = queues[task.metadata.queueIndex];
            if (q) {
              return (
                assemblySpecOf(entryForTxn(catalog, q), q.qty) ??
                engAssemblySpecFor([...catalog.retrofits, ...(catalog.projects ?? [])], q)
              );
            }
          }
          return undefined;
        }
      : undefined,
    nanitesFor: () => readTotalNanites(data),
    globalLimitFor: catalog
      ? task => {
          const rawType = typeof task.metadata?.rawType === 'string' ? task.metadata.rawType : '';
          return laneHub.resolveGlobalLimitForType(rawType || (task.domain === 'research' ? '研究' : ''), laneEnv);
        }
      : undefined,
  });

  return {
    lanes,
    initialTasks,
    dispatchResult,
    tickResult,
    settlingTaskIds: tickResult.settlingTaskIds,
  };
}

/**
 * 与 settleFloor 主推进循环 100% 语义等价的 UTO 步进包装函数（UTO-MAIN-01）：
 * 默认采用 `promotionTiming: 'after_integration'`（先对存量 active 积分推进并转 settling，
 * 再执行带宽回检与 queued → active 升格，新升格任务不双吃同楼层 Δt）与 `evictEventType: 'demoted'`。
 */
export function tickTaskOrchestrationEquivalentToSettleFloor(
  currentTasks: readonly UnifiedTask[],
  lanes: readonly LaneStationView[],
  ctx: Parameters<typeof tickTaskOrchestration>[2],
): TickResult {
  return tickTaskOrchestration(currentTasks, lanes, {
    promotionTiming: 'after_integration',
    evictEventType: 'demoted',
    ...ctx,
  });
}

/**
 * S4_BRIDGES 落盘前 0 分钟空闲产线升格与工期回填纯函数（BUG-LIVE-02a/02b & BUG-LIVE-10）：
 * 仅对 state.queues 执行工期回填、0 分钟产线空闲槽升格（queued -> active）与阶段一纳米抵扣，
 * 不触发上一楼终态清理、日历时钟推进或资金链计息。
 */
export function promoteIdleQueuesAtZeroDelta(
  state: StatData,
  rawCatalog?: EffectiveCatalog | null,
): { data: StatData; events: ParseEvent[]; issues: CheckIssue[] } {
  if (!Array.isArray(state.queues) || state.queues.length === 0) {
    return { data: state, events: [], issues: [] };
  }
  const catalog: EffectiveCatalog | null = rawCatalog
    ? ({
        researches: rawCatalog.researches ?? [],
        buildings: rawCatalog.buildings ?? [],
        productions: rawCatalog.productions ?? [],
        retrofits: rawCatalog.retrofits ?? [],
        projects: rawCatalog.projects ?? [],
        factionDefs: rawCatalog.factionDefs ?? [],
      } as EffectiveCatalog)
    : null;

  const events: ParseEvent[] = [];
  const issues: CheckIssue[] = [];
  const backfill = backfillDurations(catalog, state.queues.map(q => ({ ...q }) as TransactionItem));
  events.push(...backfill.events);

  const laneHub = createLaneRegistryHub();
  const settleOptions: TwoStageSettleOptions = {
    nanitesFor: () => readTotalNanites(state),
  };
  if (catalog) {
    const laneEnv: LaneResolveEnv = {
      bases: readBases(state),
      queues: backfill.queues,
      catalog,
    };
    const txnEffFor = makeTxnEffFor(catalog, state);
    settleOptions.effFor = txn => txnEffFor(txn) * laneHub.resolveAccelEffForTxn(txn, laneEnv);
    settleOptions.computeFor = txn =>
      txn.base
        ? computeBudgetForBase(catalog, baseOfTxn(state, txn), state)
        : computeBudgetForTheater(catalog, readBases(state), state);
    const engDefs = [...(catalog.retrofits ?? []), ...(catalog.projects ?? [])];
    settleOptions.assemblyFor = txn =>
      assemblySpecOf(entryForTxn(catalog, txn), txn.qty ?? 1) ?? engAssemblySpecFor(engDefs, txn);
    settleOptions.laneKeyFor = txn => laneHub.resolveLaneKeyForTxn(txn, laneEnv);
    settleOptions.parallelLimitFor = txn => laneHub.resolveParallelLimitForTxn(txn, laneEnv);
    settleOptions.globalLimitFor = type => laneHub.resolveGlobalLimitForType(type, laneEnv);
  }

  const settled = settleWithTwoStage({ ...state, queues: backfill.queues }, 0, settleOptions);
  let totalNanitesDeducted = 0;
  for (const event of settled.events) {
    if (event.type === 'nanites_deducted') {
      totalNanitesDeducted += event.amount;
    }
    events.push(eventToParseEvent(event));
    const issue = eventToIssue(event);
    if (issue) issues.push(issue);
  }
  const afterNanite = deductNanitesStock(settled.next as StatData, totalNanitesDeducted);
  const afterPower = recomputeBasePowerFromCatalog(afterNanite, catalog);
  reconcileStaleRejectedPlanningReceipt(afterPower);
  return {
    data: afterPower,
    events,
    issues,
  };
}
