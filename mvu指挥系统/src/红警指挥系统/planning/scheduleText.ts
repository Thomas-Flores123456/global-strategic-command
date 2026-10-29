/**
 * scheduleText.ts —— 《当前工程日程》两级分组文本与前馈注入纯逻辑（CTRL-RECONCILE-01 · 标准①）
 *
 * 真源：docs/design/systems/系统事务与时间推进总设计案.md §4.1（前馈闭环）/§4.1.1（格式冻结稿 v2·条令体）；
 *       文案模板全部集中在 scheduleCopy.ts（与渲染逻辑分离）。
 *
 * 职责：
 * 1. `buildScheduleText`：基地（bases 数组序）→ 序列（laneKeyFor 真实输出）→ 事务（lane 内数组序＝优先级）
 *    两级骨架；研究事务单列「战区科研调度」一节（槽位制，含未开通序列的世界内理由）；
 * 2. §3.8 对齐的注入配置常量（position in_chat / depth 0 / role system / should_scan false）；
 * 3. `planScheduleInjection`：一次 AFTER_COMMANDS 的完整纯推导（生成类型判定 → 最近有效楼 →
 *    日程文本 → 注入配置），任一环节 fail-closed → null；无在编事务（active/settling/queued）→ 零注入。
 *
 * 产线同源红线（§4.1.1）：分组键只消费注入的 laneKeyFor 真实输出，文本侧绝不自建分类；
 * 生产/建造/改装默认 `${base} ${type}`（与引擎默认逐字节一致），研究走 researchSlots lane
 * （`research:${slotId}`），由调用方（planScheduleInjection）按 settleFloor 同一口径接线。
 *
 * 🔴 纯函数：零 IO / 零事件 / 零 DOM / 零 vue·pinia / 零酒馆 API；不原地修改入参。
 */
import { mergeEffectiveCatalog, type DlcOverlay, type DynamicWorldbookCatalog } from '../core/catalogEffective';
import type { ProjectDef, RetrofitDef } from '../core/catalog';
import type { ParsedWorldbookCatalog } from '../../中控悬浮窗/models/worldbookCatalogParser';
import {
  resolveScanStart,
  scanLatestFloorPair,
  scanLatestValidFloor,
  type FloorCandidate,
  type FloorSnapshot,
  type GenerationEntry,
} from '../parse/floorScanner';
import { canon } from '../parse/parsePipeline';
import { resolveGenerationEntry, type GenerationDescriptor } from './researchAdvisory';
import { lineIndexFromCatalog, makeLaneKeyFor, makeParallelLimitFor, slotBoard, SLOT_REGISTRY } from '../engines/researchSlots';
import {
  deployIndexFromCatalog,
  laneDefFromKey,
  makeProdLaneKeyFor,
  makeProdParallelLimitFor,
  prodLaneIndexFromCatalog,
} from '../engines/productionLanes';
// ENG-SLOT-01（D5-B）：工程槽分流与研究槽/产线同口径组合（产线同源红线：文本侧消费同一裁决输出）
import { makeEngLaneKeyFor, makeEngParallelLimitFor } from '../engines/engineeringSlots';
import {
  dailyProtocolPointRate,
  isAnyBuildingOperationalInState,
  isBaseOperationalForProtocol,
  isProtocolBuildingOperational,
  matchesProtocolAnchorBuilding,
  PROTOCOL_ANCHOR_BUILDINGS,
  scanActiveProtocolBuildings,
  type ProtocolAnchorStateView,
} from '../engines/protocolAnchors';
import {
  canonicalizeProtocolRef,
  getExperimentStepSpec,
  isProtocolLabOnline,
  normalizeProtocolTier,
  predictExperimentOutcome,
  type ProtocolDefinitionLike,
  type ProtocolEngineStateView,
} from '../engines/protocolEngine';
import { PLANNING_ACTION_OP_VERB, SCHEDULE_COPY, SCHEDULE_QUEUED_VERB } from './scheduleCopy';
import {
  LEGACY_PROTOCOL_DEFINITIONS,
  resolveLegacyProtocolId,
  resolveLegacyProtocolName,
  type PlanningReceipt,
  type Project,
  type ProjectModule,
  type ProjectPhase,
  type ProtocolInstance,
} from '../core/schema';
import { makeTxnEffFor } from '../engines/settleFloor';
import type { TransactionItem } from '../engines/transactionEngine';

/* ═══════════════ 选项与数据形状 ═══════════════ */

/** 基地视图（两级骨架第一级：数组序即呈现序；id↔名 互解用于归属判定；可选附带建筑供协议院所扫描复用） */
export interface ScheduleBaseLike {
  id: string;
  name: string;
  status?: string;
  buildings?: ReadonlyArray<{
    name: string;
    state?: string;
  }>;
}

/** 研究序列表条目（战区科研调度一节；含未开通序列与理由；数组序即呈现序） */
export interface ScheduleResearchLane {
  /** 与 laneKeyFor 对研究事务的输出对齐（`research:${slotId}`） */
  key: string;
  /** 显示名（条令体，如「载具研究序列」） */
  name: string;
  /** 并行上限（开通时为槽容量；未开通为 0） */
  limit: number;
  /** 未开通时挂序列头的世界内理由（「X未建成，序列未开通」）；开通为 undefined */
  lockedReason?: string;
}

/** 前馈日程生成选项（回调全部可注入，缺席时退引擎默认口径） */
export interface ScheduleOptions {
  /** 工况效率回调（default 恒 1）；倒计时按 1/eff 投影为墙钟口径，eff<=0 记停摆 */
  effFor?: (txn: TransactionItem) => number;
  /** 产线分组键回调（🔴 产线同源：default `${base} ${type}` 与引擎默认逐字节一致） */
  laneKeyFor?: (txn: TransactionItem) => string;
  /** 产线并行上限回调（占用/上限照实呈现；default 恒 1） */
  limitFor?: (txn: TransactionItem) => number;
  /** lane 显示名映射（default：research: 前缀→「未登记研究序列」，其余→「{type}产线」） */
  laneNameFor?: (laneKey: string, sample: TransactionItem | undefined) => string;
  /** 基地数组序与 id↔名 映射（两级骨架第一级；缺席时按事务 base 原始值首现序分组） */
  bases?: readonly ScheduleBaseLike[];
  /** 研究序列表（提供后研究事务单列「战区科研调度」一节；缺席时研究按普通 lane 落基地组） */
  researchLanes?: readonly ScheduleResearchLane[];
  /** 战区内时钟（stat_data.clock；缺席不出时钟行） */
  clock?: { day: number; time: string };
  /** 协议五态运行时账本（PRT-SCHED-01 · stat_data.protocols；无演训活动时整节省略，零注入污染） */
  protocols?: ReadonlyArray<Partial<ProtocolInstance>>;
  /** 当前可用协议点储备（PRT-SCHED-01 · stat_data.protocol_points；缺省从 protocolState 读取或兑底 0） */
  protocolPoints?: number;
  /** 协议静态目录（PRT-SCHED-01 · catalog.protocols；缺省回退 18 条存量协议静态表） */
  protocolCatalog?: readonly ProtocolDefinitionLike[];
  /** 协议演训判定与建筑扫描完整状态视图（可选；缺省由 bases / clock / protocols / protocolPoints 合成） */
  protocolState?: ProtocolEngineStateView;
  /** 参谋排产回执（PLN-SCHED-01 · stat_data.planning?.latest_receipt；空或无有效内容时整节省略） */
  planningReceipt?: PlanningReceipt | null;
  /** 重大工程与改装项目运行时账本（FD-45 · stat_data.projects；无在建或本轮新竣工工程时整节省略，零注入污染） */
  projects?: ReadonlyArray<Project>;
  /** 上一有效楼重大工程快照（FD-45 · 用于判定本轮刚竣工的工程及阶段跃迁） */
  prevProjects?: ReadonlyArray<Project>;
  /** 可选：工程与改装静态定义目录（FD-45 · 供查询下一阶段核定经费与 V2 模块前置依赖） */
  projectCatalog?: ReadonlyArray<RetrofitDef | ProjectDef>;
}

/* ═══════════════ 内部工具（全部无副作用） ═══════════════ */

/** 分钟 → 「X天Y小时Z分」（零分量省略；<1 分钟记「不足1分钟」）——沿用 §4.1.1 冻结措辞 */
export function fmtMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m === 0) return '不足1分钟';
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}天`);
  if (h) parts.push(`${h}小时`);
  if (mm) parts.push(`${mm}分`);
  return parts.join('');
}

function safeQty(txn: TransactionItem): number {
  return txn.qty > 0 ? txn.qty : 1;
}

/** 物理已下线台数（批次口径，钳制在 [0, qty]） */
function doneUnitsOf(txn: TransactionItem, qty: number): number {
  return Math.min(qty, Math.max(0, Math.floor(txn.qty_done)));
}

/** 默认 lane 显示名（不泄漏 research:slot.xxx 这类管线标识） */
function defaultLaneName(laneKey: string, sample: TransactionItem | undefined): string {
  if (laneKey.startsWith('research:')) return SCHEDULE_COPY.fallbackResearchLaneName;
  return SCHEDULE_COPY.defaultLaneName(sample?.type ?? '');
}

/** 在编（占用）口径与引擎 countActive 对齐：仅 status==='active' 占产线 */
function isOccupying(txn: TransactionItem): boolean {
  return txn.status === 'active';
}

/** 日程收录范围：在编＝active/settling/queued（done/cancelled 不上日程）；
 *  CTRL-UI-SCHEDULE-01 导出：工程日程面板视图模型复用同一收录口径（禁另立口径） */
export function isScheduled(txn: TransactionItem): boolean {
  return txn.status === 'active' || txn.status === 'settling' || txn.status === 'queued';
}

/**
 * 判定协议账本是否存在需注入《当前工程日程》的演训活动（PRT-SCHED-01 · 零污染铁律）：
 * 当且仅当存在近期演训回执（last_result）、或存在正在实验（status === 'experimenting'）、
 * 或已开启自动实验排程（auto_queued === true && status !== 'active' && status !== 'voided'）时返回 true；
 * 否则恒返回 false（整节完全省略，确保无协议活动时输出与既有基线逐字节一致）。
 */
export function hasProtocolScheduleActivity(
  protocols: ReadonlyArray<Partial<ProtocolInstance>> | null | undefined,
): boolean {
  if (!Array.isArray(protocols) || protocols.length === 0) return false;
  return protocols.some(inst => {
    if (!inst || typeof inst !== 'object') return false;
    if (inst.last_result !== undefined && inst.last_result !== null) return true;
    if (inst.status === 'experimenting') return true;
    if (inst.auto_queued === true && inst.status !== 'active' && inst.status !== 'voided') return true;
    return false;
  });
}

/** 解析协议静态定义与条令体中文显示名（兼容 catalog.protocols 与 18 条存量协议静态表，防管线 ID 泄漏） */
function resolveProtocolDefForSchedule(
  inst: Partial<ProtocolInstance>,
  protocolCatalog?: readonly ProtocolDefinitionLike[],
): ProtocolDefinitionLike & { name: string } {
  const rawRef = String(
    inst.ref ?? (inst as { id?: string; name?: string }).id ?? (inst as { name?: string }).name ?? '',
  ).trim();
  const canonicalRef = resolveLegacyProtocolId(rawRef) ?? canonicalizeProtocolRef(rawRef) ?? rawRef;

  const catalogDef = protocolCatalog?.find(item => {
    const itemRef =
      resolveLegacyProtocolId(item.id || item.name || '') ?? canonicalizeProtocolRef(item.id || item.name || '');
    return itemRef === canonicalRef || item.id === rawRef || item.name === rawRef;
  });
  const legacyDef = LEGACY_PROTOCOL_DEFINITIONS.find(leg => leg.id === canonicalRef || leg.name === rawRef);

  const explicitName =
    typeof (inst as { name?: unknown }).name === 'string' ? (inst as { name: string }).name.trim() : '';
  const name =
    explicitName ||
    catalogDef?.name?.trim() ||
    legacyDef?.name ||
    resolveLegacyProtocolName(canonicalRef) ||
    resolveLegacyProtocolName(rawRef) ||
    rawRef;

  const explicitFaction =
    typeof (inst as { faction?: unknown }).faction === 'string' ? (inst as { faction: string }).faction.trim() : '';
  const faction =
    explicitFaction ||
    catalogDef?.faction ||
    legacyDef?.faction ||
    (canonicalRef.startsWith('sov.') ? '苏联' : canonicalRef.startsWith('all.') ? '盟军' : undefined);

  const tier = normalizeProtocolTier((inst as { tier?: unknown }).tier ?? catalogDef?.tier ?? legacyDef?.tier ?? 1);
  const reveals = catalogDef?.reveals ?? (inst as { reveals?: readonly string[] }).reveals;

  return {
    ...catalogDef,
    id: catalogDef?.id || legacyDef?.id || canonicalRef || rawRef,
    name,
    faction,
    tier,
    reveals,
    discovery: catalogDef?.discovery,
  };
}

/**
 * 判定协议对口科研院所是否处于离线封存态（D-P2b 守卫②）：
 * 1. 对口阵营院所 Tier 未达标（如 T2/T3 实验室被毁、断电、停机或不在场）；
 * 2. 配置了 discovery.building_any 但候选建筑均不在役；
 * 3. T1 协议所在状态中虽配置了科研院所建筑，但全部处于断电/损毁/停机等非运转状态。
 */
function isProtocolCounterpartLabOffline(
  stateView: ProtocolAnchorStateView,
  protocolDef: ProtocolDefinitionLike,
): boolean {
  if (!isProtocolLabOnline(stateView, protocolDef)) return true;
  if (
    protocolDef.discovery?.building_any &&
    protocolDef.discovery.building_any.length > 0 &&
    !isAnyBuildingOperationalInState(stateView, protocolDef.discovery.building_any)
  ) {
    return true;
  }
  const scan = scanActiveProtocolBuildings(stateView);
  const hasOnlineInstitute = scan.buildings.some(b => b.axis === 'institute');
  if (hasOnlineInstitute) return false;

  const instituteDefs = PROTOCOL_ANCHOR_BUILDINGS.filter(b => b.axis === 'institute');
  let hasOfflineInstituteInBases = false;
  for (const base of stateView.bases ?? []) {
    for (const bld of base.buildings ?? []) {
      if (!bld || typeof bld.name !== 'string') continue;
      const isInstitute = instituteDefs.some(def => matchesProtocolAnchorBuilding(bld.name, def));
      if (!isInstitute) continue;
      if (!isBaseOperationalForProtocol(base) || !isProtocolBuildingOperational(bld)) {
        hasOfflineInstituteInBases = true;
      }
    }
  }
  return hasOfflineInstituteInBases;
}

/** 渲染 `◆ 最高统帅部协议与条令演训` 章节行（PRT-SCHED-01 · §3.6.2 / D-P28；无协议活动时返回空数组） */
function renderProtocolSection(options: ScheduleOptions): string[] {
  const protocols = options.protocols ?? options.protocolState?.protocols;
  if (!hasProtocolScheduleActivity(protocols)) return [];

  const stateView: ProtocolEngineStateView = {
    ...options.protocolState,
    bases: options.protocolState?.bases ?? options.bases,
    clock: options.clock ?? options.protocolState?.clock,
  };

  const metaDay = stateView.meta?.day_count;
  const clockDay = stateView.clock?.day;
  const gameDay =
    typeof metaDay === 'number' && Number.isFinite(metaDay) && metaDay > 0
      ? Math.floor(metaDay)
      : typeof clockDay === 'number' && Number.isFinite(clockDay) && clockDay > 0
        ? Math.floor(clockDay)
        : 0;

  const lines: string[] = [SCHEDULE_COPY.protocolSectionHeader];

  // 1. 在役院所与协议点态势行
  const scan = scanActiveProtocolBuildings(stateView);
  const dailyRate = dailyProtocolPointRate(stateView);
  const institutesText =
    scan.buildings.length > 0 ? scan.buildings.map(b => b.name).join('＋') : SCHEDULE_COPY.protocolNoActiveInstitute;
  const rawPoints = options.protocolPoints ?? options.protocolState?.protocol_points ?? 0;
  const currentPoints = typeof rawPoints === 'number' && Number.isFinite(rawPoints) ? Math.max(0, rawPoints) : 0;
  lines.push(SCHEDULE_COPY.protocolInstituteStatusLine(institutesText, currentPoints.toFixed(2), dailyRate.toFixed(2)));

  // 2. 近期演训回执行（带 last_result 的协议）
  for (const inst of protocols ?? []) {
    if (!inst || !inst.last_result) continue;
    const def = resolveProtocolDefForSchedule(inst, options.protocolCatalog);
    const lr = inst.last_result;
    const outcome = lr.outcome;

    if (outcome === 'breakthrough' || inst.status === 'active') {
      const attempt = Math.max(1, Math.round(lr.attempt || inst.attempts || 1));
      const extraReveals = (inst as { reveals?: unknown }).reveals ?? (lr as { reveals?: unknown }).reveals;
      const hasReveals =
        (Array.isArray(def.reveals) && def.reveals.some(r => typeof r === 'string' && r.trim().length > 0)) ||
        (Array.isArray(extraReveals) && extraReveals.some(r => typeof r === 'string' && r.trim().length > 0));
      lines.push(SCHEDULE_COPY.protocolReceiptBreakthrough(def.name, attempt, hasReveals, 100));
    } else if (outcome === 'accumulated') {
      const attempt = Math.max(1, Math.round(lr.attempt || inst.attempts || 1));
      const expAfter = Math.round(
        typeof lr.exp_after === 'number' && Number.isFinite(lr.exp_after) ? lr.exp_after : (inst.exp ?? 0),
      );
      const expBefore = Math.round(
        typeof lr.exp_before === 'number' && Number.isFinite(lr.exp_before) ? lr.exp_before : 0,
      );
      const rawExpGained = (lr as { exp_gained?: unknown }).exp_gained;
      const expGained =
        typeof rawExpGained === 'number' && Number.isFinite(rawExpGained)
          ? Math.max(0, Math.round(rawExpGained))
          : Math.max(0, expAfter - expBefore);
      lines.push(SCHEDULE_COPY.protocolReceiptAccumulated(def.name, attempt, expGained, expAfter));
    } else if (outcome === 'discovered') {
      lines.push(SCHEDULE_COPY.protocolReceiptDiscovered(def.name));
    }
  }

  // 3. 攻关中 / 自动排程协议态势行（未定型的 experimenting 或 auto_queued === true 协议）
  const activeOrQueuedEntries = (protocols ?? [])
    .map((inst, index) => ({ inst, index }))
    .filter(
      ({ inst }) =>
        inst &&
        inst.status !== 'active' &&
        inst.status !== 'voided' &&
        (inst.status === 'experimenting' || inst.auto_queued === true),
    )
    .sort((a, b) => {
      const orderA =
        typeof a.inst.queue_order === 'number' && Number.isFinite(a.inst.queue_order) ? a.inst.queue_order : undefined;
      const orderB =
        typeof b.inst.queue_order === 'number' && Number.isFinite(b.inst.queue_order) ? b.inst.queue_order : undefined;
      if (orderA !== undefined && orderB !== undefined && orderA !== orderB) {
        return orderA - orderB;
      }
      return a.index - b.index;
    });

  for (const { inst } of activeOrQueuedEntries) {
    const def = resolveProtocolDefForSchedule(inst, options.protocolCatalog);
    const attempts =
      typeof inst.attempts === 'number' && Number.isFinite(inst.attempts) ? Math.max(0, Math.floor(inst.attempts)) : 0;
    const exp =
      typeof inst.exp === 'number' && Number.isFinite(inst.exp) ? Math.min(100, Math.max(0, Math.round(inst.exp))) : 0;
    const autoQueued = inst.auto_queued === true;
    const hold = inst.hold === true;

    if (isProtocolCounterpartLabOffline(stateView, def)) {
      const offlinePredicate = SCHEDULE_COPY.protocolActiveProgressOffline(exp, attempts);
      lines.push(SCHEDULE_COPY.protocolStatusLine(def.name, offlinePredicate, autoQueued, hold));
      continue;
    }

    const stepSpec = getExperimentStepSpec(def.tier ?? 1, attempts + 1);
    const prediction = predictExperimentOutcome(def, inst, gameDay);
    const forecastText = prediction.willBreakthrough
      ? SCHEDULE_COPY.protocolForecastBreakthrough(prediction.expAfter)
      : SCHEDULE_COPY.protocolForecastAccumulated(prediction.expAfter);
    const onlinePredicate = SCHEDULE_COPY.protocolActiveProgressOnline(
      attempts,
      exp,
      stepSpec.probPercent,
      forecastText,
    );
    lines.push(SCHEDULE_COPY.protocolStatusLine(def.name, onlinePredicate, autoQueued, hold));
  }

  return lines;
}

/** 渲染 `◆ 参谋部排产方案与执行回执` 章节行（PLN-SCHED-01；无排产回执或无有效内容时严格返回 []） */
export function renderPlanningReceiptSection(options: ScheduleOptions): string[] {
  const receipt = options.planningReceipt;
  if (!receipt || typeof receipt !== 'object') return [];

  const rawActions = Array.isArray(receipt.actions) ? receipt.actions : [];
  const validActions = rawActions.filter(
    a =>
      a &&
      typeof a === 'object' &&
      (String(a.target ?? '').trim().length > 0 || String(a.blocker_reason ?? '').trim().length > 0),
  );
  const summary = typeof receipt.summary === 'string' ? receipt.summary.trim() : '';
  const reason = typeof receipt.reason === 'string' ? receipt.reason.trim() : '';
  const diff = receipt.diff_summary;
  const hasDiff =
    Boolean(diff) &&
    typeof diff === 'object' &&
    ([diff.added, diff.promoted, diff.demoted, diff.held, diff.resumed].some(
      arr => Array.isArray(arr) && arr.some(item => typeof item === 'string' && item.trim().length > 0),
    ));
  const hasExplicitNonDefaultStatus =
    receipt.status === 'committed' ||
    receipt.status === 'awaiting_approval' ||
    receipt.status === 'rejected' ||
    receipt.status === 'stale_snapshot';

  if (validActions.length === 0 && !summary && !reason && !hasDiff && !hasExplicitNonDefaultStatus) {
    return [];
  }

  const lines: string[] = [SCHEDULE_COPY.planningSectionHeader];

  const statusText =
    receipt.status === 'committed'
      ? SCHEDULE_COPY.planningStatusCommitted
      : receipt.status === 'awaiting_approval'
        ? SCHEDULE_COPY.planningStatusAwaitingApproval
        : receipt.status === 'rejected'
          ? SCHEDULE_COPY.planningStatusRejected
          : receipt.status === 'stale_snapshot'
            ? SCHEDULE_COPY.planningStatusStaleSnapshot
            : SCHEDULE_COPY.planningStatusAdvisoryReady;

  lines.push(SCHEDULE_COPY.planningStatusLine(statusText));

  if (summary) {
    lines.push(SCHEDULE_COPY.planningSummaryLine(summary));
  }
  if (reason) {
    lines.push(SCHEDULE_COPY.planningReasonLine(reason));
  }

  const totalCost =
    typeof receipt.total_cost_credits === 'number' && Number.isFinite(receipt.total_cost_credits)
      ? Math.max(0, Math.round(receipt.total_cost_credits))
      : 0;
  const budgetCap =
    typeof receipt.budget_cap_credits === 'number' && Number.isFinite(receipt.budget_cap_credits)
      ? Math.max(0, Math.round(receipt.budget_cap_credits))
      : undefined;
  if (totalCost > 0 || budgetCap !== undefined) {
    lines.push(SCHEDULE_COPY.planningBudgetLine(totalCost, budgetCap));
  }

  const bases = options.bases ?? [];
  const resolveBaseName = (rawBase: string): string => {
    const trimmed = rawBase.trim();
    if (!trimmed) return '';
    const matched = bases.find(b => b.id === trimmed || canon(b.name) === canon(trimmed));
    return matched ? matched.name : trimmed;
  };

  for (const action of validActions) {
    const target = String(action.target ?? '').trim() || '未命名项目';
    const isRejected =
      action.status === 'rejected' ||
      receipt.status === 'rejected' ||
      Boolean(typeof action.blocker_reason === 'string' && action.blocker_reason.trim().length > 0);

    if (isRejected) {
      const rejectReason =
        (typeof action.blocker_reason === 'string' && action.blocker_reason.trim()) ||
        reason ||
        '未通过战备核验';
      const nextStep = typeof action.next_step === 'string' ? action.next_step.trim() : undefined;
      lines.push(SCHEDULE_COPY.planningActionRejectedLine(target, rejectReason, nextStep));
      continue;
    }

    const baseName = resolveBaseName(String(action.base || receipt.base_ref || ''));
    const qty =
      typeof action.quantity === 'number' && Number.isFinite(action.quantity) && action.quantity > 0
        ? Math.round(action.quantity)
        : 1;
    const costCredits =
      typeof action.cost_credits === 'number' && Number.isFinite(action.cost_credits)
        ? Math.max(0, Math.round(action.cost_credits))
        : 0;
    const estMinutes =
      typeof action.est_minutes === 'number' && Number.isFinite(action.est_minutes)
        ? Math.max(0, action.est_minutes)
        : 0;
    const etaNote = typeof action.eta_note === 'string' ? action.eta_note.trim() : '';
    const durationText =
      estMinutes > 0 ? (etaNote ? `${fmtMinutes(estMinutes)}，${etaNote}` : fmtMinutes(estMinutes)) : etaNote || '待核定';
    const opVerb = PLANNING_ACTION_OP_VERB[action.op ?? 'enqueue'] ?? '入队';

    lines.push(SCHEDULE_COPY.planningActionAcceptedLine(baseName, target, qty, costCredits, durationText, opVerb));
  }

  return lines;
}

/* ═══════════════ 重大工程与改装项目（FD-45 · D-FF-COMP-04） ═══════════════ */

function findMatchingPrevProject(
  p: Project,
  prevProjects: ReadonlyArray<Project>,
): Project | undefined {
  if (p.id) {
    const byId = prevProjects.find(prev => prev && prev.id === p.id);
    if (byId) return byId;
  }
  return prevProjects.find(
    prev =>
      prev &&
      canon(prev.ref ?? '') === canon(p.ref ?? '') &&
      canon(prev.lead_base ?? '') === canon(p.lead_base ?? ''),
  );
}

/**
 * 判定工程账本是否存在需注入《当前工程日程》的工程活动（FD-45 · 零污染铁律）：
 * - 若 `!projects || projects.length === 0` 返回 `false`；
 * - 若存在任一工程 `p.status === '在建' || p.status === '暂停'`，返回 `true`；
 * - 若提供了 `prevProjects`，且存在任一工程在 `projects` 中 `p.status === '完工'` 但在 `prevProjects` 中
 *   对应工程（按 `id` 或 `ref + lead_base` 匹配）不存在或 `status !== '完工'`，返回 `true`；
 * - 其余情况（例如全部为历史已完工工程）返回 `false`，确保平时零注入、零字符污染。
 */
export function hasProjectScheduleActivity(
  projects?: ReadonlyArray<Project>,
  prevProjects?: ReadonlyArray<Project>,
): boolean {
  if (!projects || !Array.isArray(projects) || projects.length === 0) return false;
  for (const p of projects) {
    if (!p || typeof p !== 'object') continue;
    if (p.status === '在建' || p.status === '暂停') return true;
    if (p.status === '完工' && Array.isArray(prevProjects)) {
      const prev = findMatchingPrevProject(p, prevProjects);
      if (!prev || prev.status !== '完工') return true;
    }
  }
  return false;
}

function resolveProjectBaseName(p: Project, bases?: readonly ScheduleBaseLike[]): string {
  const rawBase = String(p.lead_base || p.bases?.[0] || '').trim();
  if (!rawBase) return '战区直属';
  if (bases && bases.length > 0) {
    const matched = bases.find(b => b.id === rawBase || canon(b.name) === canon(rawBase));
    if (matched) return matched.name;
  }
  return rawBase;
}

function resolveProjectRefName(
  p: Project,
  projectCatalog?: ReadonlyArray<RetrofitDef | ProjectDef>,
): string {
  const rawRef = String(p.ref ?? '').trim();
  if (projectCatalog && projectCatalog.length > 0) {
    const matched = projectCatalog.find(
      def => ('id' in def && def.id === rawRef) || canon(def.name) === canon(rawRef),
    );
    if (matched?.name) return matched.name;
  }
  return rawRef || '未命名工程';
}

/**
 * 渲染 `◆ 重大工程与改装项目` 章节文本（FD-45 · D-FF-COMP-04）：
 * 当 `!hasProjectScheduleActivity(options?.projects, options?.prevProjects)` 时严格返回 `null`。
 */
export function renderProjectSection(options?: ScheduleOptions): string | null {
  if (!options || !hasProjectScheduleActivity(options.projects, options.prevProjects)) {
    return null;
  }

  const lines: string[] = [SCHEDULE_COPY.projectSectionHeader];
  const projects = options.projects ?? [];
  const prevProjects = options.prevProjects;

  for (const p of projects) {
    if (!p || typeof p !== 'object') continue;
    const refName = resolveProjectRefName(p, options.projectCatalog);
    const baseName = resolveProjectBaseName(p, options.bases);

    if (p.status === '完工') {
      if (Array.isArray(prevProjects)) {
        const prev = findMatchingPrevProject(p, prevProjects);
        if (!prev || prev.status !== '完工') {
          lines.push(SCHEDULE_COPY.projectMilestoneComplete(refName, baseName));
        }
      }
      continue;
    }

    if (p.status !== '在建' && p.status !== '暂停') continue;

    // V2 仓段工程分支
    if ('modules' in p && Array.isArray(p.modules) && p.modules.length > 0) {
      const modules = p.modules as ReadonlyArray<
        ProjectModule & { depends_on?: readonly string[]; prereqs?: readonly string[] }
      >;
      const totalCount = modules.length;
      const doneModules = modules.filter(m => m && m.status === '完工');
      const doneCount = doneModules.length;
      const doneKeys = new Set<string>();
      for (const dm of doneModules) {
        if (dm.id) {
          doneKeys.add(dm.id);
          doneKeys.add(canon(dm.id));
        }
        if (dm.name) {
          doneKeys.add(dm.name);
          doneKeys.add(canon(dm.name));
        }
      }

      const activeNames = modules
        .filter(m => m && (m.status === '进行中' || (m.status as string) === '在建'))
        .map(m => (m.name || m.id).trim())
        .filter(Boolean);

      const catalogProject = options.projectCatalog?.find(
        (def): def is ProjectDef =>
          Boolean(def) &&
          'modules' in def &&
          (('id' in def && def.id === p.ref) || canon(def.name) === canon(p.ref ?? '')),
      );

      const readyNames: string[] = [];
      for (const m of modules) {
        if (!m || m.status !== '未启动') continue;
        const catalogMod = catalogProject?.modules.find(
          cm => cm.id === m.id || (m.name && canon(cm.name) === canon(m.name)),
        );
        const rawDeps = m.depends_on ?? m.prereqs ?? catalogMod?.prereqs ?? [];
        const deps = Array.isArray(rawDeps) ? rawDeps : [];
        const allDepsMet = deps.every(dep => doneKeys.has(dep) || doneKeys.has(canon(dep)));
        if (allDepsMet) {
          const displayName = (m.name || m.id).trim();
          if (displayName) readyNames.push(displayName);
        }
      }

      lines.push(
        SCHEDULE_COPY.projectV2ActiveLine(
          refName,
          baseName,
          p.status,
          doneCount,
          totalCount,
          activeNames,
          readyNames,
        ),
      );
      continue;
    }

    // V1 分阶段工程分支
    if ('phases' in p && Array.isArray(p.phases) && p.phases.length > 0) {
      const phases = p.phases as ReadonlyArray<ProjectPhase & { cost?: number }>;
      const hasActiveOrPausedPhase = phases.some(
        ph => ph && (ph.status === '进行中' || (ph.status as string) === '在建' || ph.status === '暂停'),
      );

      let awaitingPair: { doneIdx: number; nextIdx: number } | null = null;
      if (!hasActiveOrPausedPhase && p.status === '在建') {
        for (let i = phases.length - 2; i >= 0; i--) {
          if (phases[i]?.status === '完工' && phases[i + 1]?.status === '未启动') {
            awaitingPair = { doneIdx: i, nextIdx: i + 1 };
            break;
          }
        }
      }

      if (awaitingPair) {
        const donePhase = phases[awaitingPair.doneIdx];
        const nextPhase = phases[awaitingPair.nextIdx];
        const donePhaseIdx =
          typeof donePhase.idx === 'number' && Number.isFinite(donePhase.idx)
            ? donePhase.idx
            : awaitingPair.doneIdx;
        const nextPhaseIdx =
          typeof nextPhase.idx === 'number' && Number.isFinite(nextPhase.idx)
            ? nextPhase.idx
            : awaitingPair.nextIdx;
        const donePhaseName = (donePhase.name ?? '').trim() || `阶段#${donePhaseIdx + 1}`;
        const nextPhaseName = (nextPhase.name ?? '').trim() || `阶段#${nextPhaseIdx + 1}`;

        const catalogRetrofit = options.projectCatalog?.find(
          (def): def is RetrofitDef =>
            Boolean(def) &&
            'phases' in def &&
            (('id' in def && (def as { id?: string }).id === p.ref) || canon(def.name) === canon(p.ref ?? '')),
        );
        const rawNextCost =
          typeof nextPhase.cost === 'number' && Number.isFinite(nextPhase.cost)
            ? nextPhase.cost
            : catalogRetrofit?.phases?.[awaitingPair.nextIdx]?.cost;

        lines.push(
          SCHEDULE_COPY.projectPhaseAwaitingFunding(
            refName,
            baseName,
            donePhaseIdx,
            donePhaseName,
            nextPhaseIdx,
            nextPhaseName,
            rawNextCost,
          ),
        );
        continue;
      }

      let targetOrderIdx = phases.findIndex(
        ph => ph && (ph.status === '进行中' || (ph.status as string) === '在建'),
      );
      if (targetOrderIdx < 0) {
        targetOrderIdx = phases.findIndex(ph => ph && ph.status === '暂停');
      }
      if (targetOrderIdx < 0) {
        targetOrderIdx = phases.findIndex(ph => ph && ph.status === '未启动');
      }
      if (targetOrderIdx < 0) {
        targetOrderIdx = phases.length - 1;
      }

      const curPhase = phases[targetOrderIdx];
      const phaseIdx =
        typeof curPhase.idx === 'number' && Number.isFinite(curPhase.idx) ? curPhase.idx : targetOrderIdx;
      const phaseName = (curPhase.name ?? '').trim() || `阶段#${phaseIdx + 1}`;
      lines.push(
        SCHEDULE_COPY.projectV1ActiveLine(
          refName,
          baseName,
          p.status,
          phaseIdx,
          phases.length,
          phaseName,
          curPhase.status,
        ),
      );
    }
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

/* ═══════════════ 状态谓语（§4.1.1 对照表，文案全部来自 SCHEDULE_COPY） ═══════════════ */

/** 单条事务 → 状态谓语句（prevInLane＝同 lane 内数组序前一条事务，供排队「列于X之后」）；
 *  CTRL-UI-QUEUE-01 导出：面板五态展示经 queueDisplayModel 复用同一谓语（禁另立文案体系） */
export function predicateFor(
  txn: TransactionItem,
  prevInLane: TransactionItem | undefined,
  effFor: (txn: TransactionItem) => number,
): string {
  const progress = Math.round(txn.progress);
  const qty = safeQty(txn);

  // 待对账（settling）：冻结档力度，不出倒计时数字
  if (txn.status === 'settling') {
    return qty > 1 ? SCHEDULE_COPY.settlingBatch(doneUnitsOf(txn, qty), qty) : SCHEDULE_COPY.settling;
  }

  // 排队：已立项待X，列于前置项之后；暂缓奉令
  if (txn.status === 'queued') {
    const verb = SCHEDULE_QUEUED_VERB[txn.type] ?? '待办';
    const base = prevInLane ? SCHEDULE_COPY.queuedAfter(verb, prevInLane.item) : SCHEDULE_COPY.queued(verb);
    return txn.hold ? `${base}${SCHEDULE_COPY.holdSuffix}` : base;
  }

  // 在产/在研（active）
  if (txn.total_minutes <= 0) return SCHEDULE_COPY.unknownDuration(progress);

  const eff = effFor(txn);
  if (!Number.isFinite(eff) || eff <= 0) {
    return qty > 1 ? SCHEDULE_COPY.stalledBatch(progress, doneUnitsOf(txn, qty), qty) : SCHEDULE_COPY.stalled(progress);
  }

  const unit = txn.total_minutes / qty;
  const remaining = Math.max(0, txn.total_minutes - txn.spent_minutes);
  const supplyPct = Math.round(eff * 100);

  if (qty > 1) {
    const done = doneUnitsOf(txn, qty);
    const intoUnit = Math.min(unit, Math.max(0, txn.spent_minutes - done * unit));
    const nextUnitIn = done >= qty ? 0 : intoUnit > 0 ? unit - intoUnit : unit;
    const beat = fmtMinutes(unit / eff);
    const perUnit = fmtMinutes(nextUnitIn / eff);
    const total = fmtMinutes(remaining / eff);
    return eff !== 1
      ? SCHEDULE_COPY.activeBatchEff(progress, done, qty, supplyPct, beat, perUnit, total)
      : SCHEDULE_COPY.activeBatch(progress, done, qty, beat, perUnit, total);
  }

  const need = fmtMinutes(remaining / eff);
  return eff !== 1
    ? SCHEDULE_COPY.activeSingleEff(progress, need, supplyPct)
    : SCHEDULE_COPY.activeSingle(progress, need);
}

/* ═══════════════ 两级分组渲染（§4.1.1 冻结骨架） ═══════════════ */

interface LaneGroup {
  key: string;
  /** lane 内事务（数组序＝优先级） */
  txns: TransactionItem[];
}

/** 按 laneKeyFor 真实输出分组（🔴 产线同源：文本侧不自建分类），lane 按首现序 */
function groupByLane(txns: TransactionItem[], laneKeyFor: (txn: TransactionItem) => string): LaneGroup[] {
  const lanes: LaneGroup[] = [];
  const index = new Map<string, LaneGroup>();
  for (const txn of txns) {
    const key = laneKeyFor(txn);
    let lane = index.get(key);
    if (!lane) {
      lane = { key, txns: [] };
      index.set(key, lane);
      lanes.push(lane);
    }
    lane.txns.push(txn);
  }
  return lanes;
}

/** 渲染一个 lane 区块（序列头＋条目行）；limit/lockedReason 由调用方按 lane 来源供给 */
function renderLane(
  lane: LaneGroup,
  header: { name: string; limit: number; lockedReason?: string },
  effFor: (txn: TransactionItem) => number,
): string[] {
  const lines: string[] = [];
  const activeCount = lane.txns.filter(isOccupying).length;
  lines.push(
    header.lockedReason
      ? SCHEDULE_COPY.laneLocked(header.name, header.lockedReason, lane.txns.length)
      : SCHEDULE_COPY.laneHeader(header.name, activeCount, header.limit),
  );
  for (let i = 0; i < lane.txns.length; i++) {
    lines.push(SCHEDULE_COPY.itemLine(lane.txns[i].item, predicateFor(lane.txns[i], lane.txns[i - 1], effFor)));
  }
  return lines;
}

/**
 * 生成前馈工程日程 `<当前工程日程>` 文本（§4.1.1 冻结稿）：
 * 两级骨架——基地（bases 数组序）→ 序列（laneKeyFor 输出，在编/上限照实呈现）→ 事务（lane 内数组序）；
 * 研究事务单列「战区科研调度」一节（槽位制，含未开通序列的世界内理由）。
 * - 单台尚需 ＝ 单位工期 −（spent mod 单位工期），节拍 ＝ total_minutes ÷ qty；
 * - effFor 注入时按 1/eff 投影墙钟（供给率 N%，已按实计）；eff<=0 记「因工况中断，进度冻结」；
 * - total_minutes<=0（工期未核定）不出倒计时数字，防误导 LLM；
 * - 全空（无在编事务）→ 一行「当前各基地与科研序列均无在编工程」。
 */
export function buildScheduleText(queues: readonly TransactionItem[], options: ScheduleOptions = {}): string {
  const effFor = options.effFor ?? (() => 1);
  const laneKeyFor = options.laneKeyFor ?? ((txn: TransactionItem) => `${txn.base} ${txn.type}`);
  const limitFor = options.limitFor ?? (() => 1);
  const laneNameFor = options.laneNameFor ?? defaultLaneName;
  const bases = options.bases ?? [];
  const researchLanes = options.researchLanes ?? [];

  const scheduled = queues.filter(isScheduled);
  const protocolLines = renderProtocolSection(options);
  const receiptLines = renderPlanningReceiptSection(options);
  const projectActive = hasProjectScheduleActivity(options.projects, options.prevProjects);
  const projectSection = projectActive ? renderProjectSection(options) : null;
  const isTotallyEmpty =
    scheduled.length === 0 && protocolLines.length === 0 && receiptLines.length === 0 && !projectActive;

  const lines: string[] = [SCHEDULE_COPY.tagOpen];
  if (options.clock) lines.push(SCHEDULE_COPY.clockLine(options.clock.day, options.clock.time));

  // 全空态（§4.1.1）：一行收口，不出骨架（若存在协议演训活动、排产回执或重大工程章节，照常追加对应章节）
  if (scheduled.length === 0) {
    lines.push(SCHEDULE_COPY.allEmpty);
    if (!isTotallyEmpty) {
      if (protocolLines.length > 0) {
        lines.push(...protocolLines);
      }
      if (receiptLines.length > 0) {
        lines.push(...receiptLines);
      }
      if (projectSection) {
        lines.push(projectSection);
      }
    }
    lines.push(SCHEDULE_COPY.tagClose);
    return lines.join('\n');
  }

  // 研究事务分流：提供研究序列表时单列一节；否则按普通 lane 落基地组
  const isResearchRouted = (txn: TransactionItem) => researchLanes.length > 0 && txn.type === '研究';
  const baseTxns = scheduled.filter(txn => !isResearchRouted(txn));
  const researchTxns = scheduled.filter(isResearchRouted);

  /* ── 第一级：基地（bases 数组序；无名/未登记基地按原始 base 值首现序兜底列后） ── */
  interface BaseGroup {
    name: string;
    txns: TransactionItem[];
  }
  const baseGroups: BaseGroup[] = bases.map(b => ({ name: b.name, txns: [] }));
  const resolveBase = (txn: TransactionItem): BaseGroup | undefined =>
    bases
      .map((b, i) => ({ b, group: baseGroups[i] }))
      .find(({ b }) => b.id === txn.base || canon(b.name) === canon(txn.base))?.group;
  const orphanGroups = new Map<string, BaseGroup>();
  for (const txn of baseTxns) {
    const group = resolveBase(txn);
    if (group) {
      group.txns.push(txn);
      continue;
    }
    const rawKey = txn.base;
    let orphan = orphanGroups.get(rawKey);
    if (!orphan) {
      orphan = { name: rawKey || SCHEDULE_COPY.baseUnnamed, txns: [] };
      orphanGroups.set(rawKey, orphan);
    }
    orphan.txns.push(txn);
  }
  const allBaseGroups = [...baseGroups, ...orphanGroups.values()];

  for (const group of allBaseGroups) {
    // 零登记的兜底组只在确有事务时出现；在册基地空也列（§4.1.1 空基地空态）
    lines.push(SCHEDULE_COPY.baseHeader(group.name));
    if (group.txns.length === 0) {
      lines.push(SCHEDULE_COPY.baseEmpty);
      continue;
    }
    for (const lane of groupByLane(group.txns, laneKeyFor)) {
      lines.push(
        ...renderLane(
          lane,
          { name: laneNameFor(lane.key, lane.txns[0]), limit: Math.max(0, limitFor(lane.txns[0])) },
          effFor,
        ),
      );
    }
  }

  /* ── 单列一节：战区科研调度（槽位制；序列表全量呈现，含未开通序列的世界内理由） ── */
  if (researchLanes.length > 0) {
    lines.push(SCHEDULE_COPY.researchSectionHeader);
    const lanesByKey = new Map<string, LaneGroup>();
    for (const lane of groupByLane(researchTxns, laneKeyFor)) lanesByKey.set(lane.key, lane);
    const renderedKeys = new Set<string>();

    for (const def of researchLanes) {
      const lane = lanesByKey.get(def.key) ?? { key: def.key, txns: [] };
      renderedKeys.add(def.key);
      lines.push(...renderLane(lane, { name: def.name, limit: def.limit, lockedReason: def.lockedReason }, effFor));
    }
    // 序列表之外的 research: lane（调用方列表缺漏）兜底列后，不丢事务
    for (const lane of lanesByKey.values()) {
      if (renderedKeys.has(lane.key)) continue;
      lines.push(
        ...renderLane(
          lane,
          { name: laneNameFor(lane.key, lane.txns[0]), limit: Math.max(0, limitFor(lane.txns[0])) },
          effFor,
        ),
      );
    }
  }

  /* ── 单列一节：最高统帅部协议与条令演训（PRT-SCHED-01 · §3.6.2 / D-P28；无协议活动时整节省略） ── */
  if (protocolLines.length > 0) {
    lines.push(...protocolLines);
  }

  /* ── 单列一节：参谋部排产方案与执行回执（PLN-SCHED-01；无排产回执时整节省略） ── */
  if (receiptLines.length > 0) {
    lines.push(...receiptLines);
  }

  /* ── 单列一节：重大工程与改装项目（FD-45 · D-FF-COMP-04；无工程活动时整节省略） ── */
  if (projectSection) {
    lines.push(projectSection);
  }

  lines.push(SCHEDULE_COPY.tagClose);
  return lines.join('\n');
}

/* ═══════════════ §3.8 对齐的注入配置 ═══════════════ */

export const SCHEDULE_INJECT_ID = 'tavernweave.schedule.v1';

export const SCHEDULE_INJECT_CONFIG = {
  id: SCHEDULE_INJECT_ID,
  position: 'in_chat',
  depth: 0,
  role: 'system',
  should_scan: false,
} as const;

export type ScheduleInjection = typeof SCHEDULE_INJECT_CONFIG & { content: string };

/* ═══════════════ 组合入口（供 scheduleRunner · RAC-ENTRY-01 同构） ═══════════════ */

export interface SchedulePlan {
  entry: GenerationEntry;
  scanStart: number;
  snapshot: FloorSnapshot;
  injection: ScheduleInjection;
}

/**
 * 一次 AFTER_COMMANDS 的完整纯推导：生成类型判定 → 扫描起点 → 最近有效楼 →
 * 产线回调接线（与 settleFloor 同一口径：laneKeyFor/limitFor 走 researchSlots，effFor 走 operationEngine）→
 * 日程文本 → 注入配置。任一环节 fail-closed → null；无在编事务 → 零注入（null）。
 * 楼层读取以 reader 注入，$dlc 注册表以 overlays 注入，本函数不触碰酒馆 API。
 *
 * R3 动态目录通道：`dynamicWb` 为世界书动态目录（ParsedWorldbookCatalog 或其子集形状），
 * 参与三级合并（世界书动态 > 静态基线 > DLC overlay），世界书新增研究的 line 由此进入 lineOf 口径；
 * 不传（undefined/null）时行为与改造前逐字节一致（纯增量、向后兼容）。
 */
export function planScheduleInjection(input: {
  generation: GenerationDescriptor;
  lastMessageId: number;
  readFloor: (id: number) => FloorCandidate | null;
  overlays: readonly DlcOverlay[];
  /** R3：世界书动态目录（可选）；缺席时退化为「静态基线 + DLC overlay」两源合并 */
  dynamicWb?: ParsedWorldbookCatalog | DynamicWorldbookCatalog | null;
}): SchedulePlan | null {
  const entry = resolveGenerationEntry(input.generation);
  if (!entry) return null;
  const scanStart = resolveScanStart(entry, input.lastMessageId);
  const pair = scanLatestFloorPair(scanStart, input.readFloor);
  if (!pair) return null;
  const { current: snapshot, previous } = pair;
  const data = snapshot.data;

  const queues = data.queues;
  const activeQueues = queues.filter(isScheduled);
  const protocolActive = hasProtocolScheduleActivity(data.protocols);
  const planningReceipt =
    (data as { planning?: { latest_receipt?: PlanningReceipt | null } }).planning?.latest_receipt ?? null;
  const planningActive =
    renderPlanningReceiptSection({ planningReceipt, bases: data.bases }).length > 0;
  const projectActive = hasProjectScheduleActivity(data.projects, previous?.data.projects);
  // 无在编事务且无协议演训活动且无排产回执且无重大工程活动 → 零注入（空态文本只服务直接调用方，不占提示词）
  if (activeQueues.length === 0 && !protocolActive && !planningActive && !projectActive) return null;

  const catalog = mergeEffectiveCatalog(input.overlays, input.dynamicWb, data.protocols);
  // E2d 接线（批（八十八）授权）：deploy 能力面 resolver 同源三池构建，注入三回调启用通道B；工厂容错缺池/缺块。
  const deployOf = deployIndexFromCatalog({
    buildings: catalog.buildings,
    productions: catalog.productions,
    retrofits: catalog.retrofits,
  });
  const lineOf = lineIndexFromCatalog(catalog.researches);
  const slotView = { bases: snapshot.data.bases, queues };
  const board = slotBoard(slotView, lineOf, undefined, { deployOf });
  const unlockedBySlot = new Map(board.map(entry => [entry.slotId, entry.unlocked] as const));

  // CTRL-PROD-LANE-01：产线分组消费组合裁决器真实输出（与研究槽组合口径同 settleFloor，产线同源红线）
  const prodLaneOf = prodLaneIndexFromCatalog({
    buildings: catalog.buildings,
    productions: catalog.productions,
    retrofits: catalog.retrofits,
  });
  const prodState = { bases: snapshot.data.bases, queues };
  const researchKeyFor = makeLaneKeyFor(lineOf);
  const prodKeyFor = makeProdLaneKeyFor(prodLaneOf);
  const engKeyFor = makeEngLaneKeyFor();
  const researchLimitFor = makeParallelLimitFor(slotView, lineOf, { deployOf });
  const prodLimitFor = makeProdParallelLimitFor(prodState, prodLaneOf, { deployOf });
  const engLimitFor = makeEngParallelLimitFor(prodState, { deployOf });

  const researchLanes: ScheduleResearchLane[] = SLOT_REGISTRY.map(slot => {
    const unlocked = unlockedBySlot.get(slot.slotId) ?? false;
    return {
      key: `research:${slot.slotId}`,
      name: SCHEDULE_COPY.researchLaneName(slot.name),
      limit: unlocked ? slot.capacity : 0,
      lockedReason: unlocked ? undefined : SCHEDULE_COPY.lockedReason(slot.anchor),
    };
  });

  const text = buildScheduleText(queues, {
    effFor: makeTxnEffFor(catalog, snapshot.data),
    // ENG-SLOT-01：'工程' 走 engineeringSlots 分流（与 settleFloor 组合口径一致），不进 laneFor 推导
    laneKeyFor: txn =>
      txn.type === '研究' ? researchKeyFor(txn) : txn.type === '工程' ? engKeyFor(txn) : prodKeyFor(txn),
    limitFor: txn =>
      txn.type === '研究' ? researchLimitFor(txn) : txn.type === '工程' ? engLimitFor(txn) : prodLimitFor(txn),
    laneNameFor: (key, sample) => laneDefFromKey(key)?.name ?? defaultLaneName(key, sample),
    bases: data.bases,
    researchLanes,
    clock: data.clock,
    protocols: data.protocols,
    protocolPoints: data.protocol_points,
    protocolCatalog: catalog.protocols,
    protocolState: data,
    planningReceipt,
    projects: data.projects,
    prevProjects: previous?.data.projects,
    projectCatalog: [...catalog.retrofits, ...catalog.projects],
  });

  return { entry, scanStart, snapshot, injection: { ...SCHEDULE_INJECT_CONFIG, content: text } };
}
