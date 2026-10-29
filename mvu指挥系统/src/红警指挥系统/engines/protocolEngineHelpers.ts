/**
 * protocolEngineHelpers.ts —— 协议引擎类型契约、双资源概率阶梯、同源确定性种子与五态守卫辅助
 *
 * 从 protocolEngine.ts 拆出：
 * - 协议实验与结算类型定义
 * - 双资源渐进概率实验表与数学期望计算
 * - 32-bit FNV-1a 同源确定性种子与实验预判纯函数
 * - 五态单向状态机四重守卫与前置准入核查辅助
 */

import { evaluatePrerequisite, type PrerequisiteBaseState, type PrerequisiteContext } from '../core/prerequisites';
import {
  PROTOCOL_SCHEMA_VERSION,
  resolveLegacyProtocolId,
  resolveLegacyProtocolName,
  type ProtocolInstance,
  type ProtocolLastResult,
  type ProtocolStatus,
} from '../core/schema';
import {
  factionLabTier,
  isAnyBuildingOperationalInState,
  isBaseOperationalForProtocol,
  isProtocolBuildingOperational,
  type ProtocolAnchorStateView,
} from './protocolAnchors';

/* ═══════════════ 1. 类型定义 ═══════════════ */

/** 协议阶梯档位 */
export type ProtocolTier = 1 | 2 | 3;

/** 单轮实验阶梯参数规格 */
export interface ProtocolExperimentStepSpec {
  /** 第 k 轮实验（1-based） */
  attempt: number;
  /** 本轮突破概率（0 ~ 1，如 0.55） */
  prob: number;
  /** 本轮突破概率百分比（0 ~ 100，如 55） */
  probPercent: number;
  /** 本轮未突破时定型经验跃迁目标值（0 ~ 100，硬保底轮为 100） */
  failExp: number;
  /** 是否为 100% 必成硬保底轮次 */
  guaranteed: boolean;
}

/** 各 Tier 协议实验规格定义 */
export interface ProtocolTierExperimentSpec {
  tier: ProtocolTier;
  /** 单次实验消耗协议点（恒为 1） */
  costPoints: number;
  /** 单次实验默认消耗资金（T1=500 / T2=1500 / T3=4000） */
  costCredits: number;
  /** 硬保底最多实验次数（T1=3 / T2=4 / T3=5） */
  maxAttempts: number;
  /** 数学期望实验次数 E[N]（T1=1.52 / T2=1.90 / T3=2.62） */
  expectedAttempts: number;
  /** 期望累计消耗协议点 */
  expectedPoints: number;
  /** 期望累计消耗资金 */
  expectedCredits: number;
  /** 逐轮次概率与阶段经验表 */
  steps: readonly ProtocolExperimentStepSpec[];
}

/** 协议发现规则配置（对齐任务包 §3.1） */
export interface ProtocolDiscoverySpec {
  kind: 'experiment' | 'event';
  building_any?: readonly string[];
  research_all?: readonly string[];
}

/** 协议静态目录条目最小契约（兼容 catalogEffective 与《协议_世界书》块） */
export interface ProtocolDefinitionLike {
  id: string;
  name?: string;
  scope?: string;
  faction?: string;
  track?: string;
  tier?: ProtocolTier | number;
  cost_points?: number;
  experiment_cost_credits?: number;
  reveals?: readonly string[];
  discovery?: ProtocolDiscoverySpec;
  exclusive_with?: readonly string[];
  requirements?: unknown;
  prereqs?: readonly string[];
  need_buildings?: readonly string[];
  order?: number;
  desc?: string;
}

/** 引擎消费的最小状态视图（兼容 StatData，零强绑定） */
export interface ProtocolEngineStateView extends ProtocolAnchorStateView {
  meta?: {
    day_count?: number;
    date?: string;
    world_id?: string;
    location?: string;
  };
  clock?: {
    day: number;
    time: string;
  };
  economy?: {
    credits?: number;
    credits_daily?: number;
    wallet?: Record<string, number>;
    [key: string]: unknown;
  };
  tech?: {
    done?: readonly string[];
    [key: string]: unknown;
  };
  forces?: {
    girls?: ReadonlyArray<{ name: string }>;
    troops?: Record<string, number>;
    vehicles?: readonly string[];
    [key: string]: unknown;
  };
  protocols?: ReadonlyArray<ProtocolInstance>;
  protocol_points?: number;
  [key: string]: unknown;
}

/** 同源确定性实验预判结果 */
export interface ExperimentOutcomePrediction {
  protocolId: string;
  tier: ProtocolTier;
  nextAttempt: number;
  gameDay: number;
  /** 确定性哈希归一化值 ∈ [0, 1) */
  roll: number;
  /** 本轮突破概率 ∈ [0, 1] */
  prob: number;
  /** 本轮突破概率百分比 ∈ [0, 100] */
  probPercent: number;
  /** 是否触发硬保底必成 */
  guaranteed: boolean;
  /** 判定结果：'breakthrough'（临界突破定型）| 'accumulated'（阶段经验积累） */
  outcome: 'breakthrough' | 'accumulated';
  willBreakthrough: boolean;
  /** 实验后状态（'active' | 'experimenting'） */
  nextStatus: ProtocolStatus;
  /** 实验前经验 % */
  expBefore: number;
  /** 实验后经验 % */
  expAfter: number;
  /** 下次实验突破概率 ∈ [0, 1]（已突破时为 1） */
  nextProb: number;
  /** 下次实验突破概率百分比 ∈ [0, 100]（已突破时为 100） */
  nextProbPercent: number;
  /** 单次实验消耗协议点 */
  costPoints: number;
  /** 单次实验消耗资金 */
  costCredits: number;
}

/** 实验执行拒绝原因 */
export type ExperimentRejectReason =
  | 'already_active'
  | 'voided'
  | 'undiscovered'
  | 'locked'
  | 'predecessor_inactive'
  | 'requirements_unmet'
  | 'lab_offline'
  | 'insufficient_points'
  | 'insufficient_credits';

/** 兼容结算层回执的实验阻断原因与结果别名 */
export type ProtocolExperimentBlockReason = ExperimentRejectReason;
export type ProtocolExperimentOutcome = 'breakthrough' | 'accumulated';

/** 单次协议实验执行选项 */
export interface ExecuteProtocolExperimentOptions {
  /** 当前游戏日（缺省自动从 state.meta.day_count / state.clock.day 读取） */
  gameDay?: number;
  /** 可选完整协议目录（传入时支持校验同轨前序并在突破后自动刷新同轨下一级协议准入） */
  catalogProtocols?: readonly ProtocolDefinitionLike[];
}

/** 单次协议实验执行结果 */
export interface ExecuteProtocolExperimentResult<T extends ProtocolEngineStateView = ProtocolEngineStateView> {
  executed: boolean;
  reason?: ExperimentRejectReason;
  state: T;
  instance: ProtocolInstance;
  prediction?: ExperimentOutcomePrediction;
  outcome?: 'breakthrough' | 'accumulated';
  lastResult?: ProtocolLastResult;
  unlockedNextIds: string[];
}

/** 自动启封或轨道解锁结果 */
export interface ProtocolDiscoveryResult<T extends ProtocolEngineStateView = ProtocolEngineStateView> {
  state: T;
  discoveredIds: string[];
  instances: ProtocolInstance[];
}

/** 同轨线性拓扑刷新结果 */
export interface ProtocolTrackRefreshResult<T extends ProtocolEngineStateView = ProtocolEngineStateView> {
  state: T;
  unlockedIds: string[];
  instances: ProtocolInstance[];
}

/** settleAutoProtocols 可选参数 */
export interface SettleAutoProtocolsOptions {
  gameDay?: number;
  /** 当楼已由步骤 B 手动实验或新解锁、需在本轮自动推进中跳过的协议 ID/名称集合（FIX-P0-04） */
  skipProtocolIds?: ReadonlySet<string>;
}

/** settleAutoProtocols 结算返回结果 */
export interface SettleAutoProtocolsResult<T extends ProtocolEngineStateView = ProtocolEngineStateView> {
  state: T;
  /** 本轮自动实验突破后解锁的协议 ID 列表 */
  unlockedIds: string[];
  /** 本轮是否执行了自动排程队首实验 */
  experimentExecuted: boolean;
  /** 本轮执行自动实验的协议 ID */
  experimentProtocolId?: string;
  /** 本轮自动实验结果类型 */
  experimentOutcome?: 'breakthrough' | 'accumulated';
  /** 本轮自动实验生成的近期回执 */
  experimentResult?: ProtocolLastResult;
  /** 若队首排程协议未能执行实验，记录具体阻断原因 */
  experimentBlockedReason?: ExperimentRejectReason;
}

/* ═══════════════ 2. 双资源渐进概率实验表（§3.5.2 / D-P9b） ═══════════════ */

/**
 * 双资源渐进概率实验模型权威表（D-P9b）：
 * - Tier 1：1 点 + 500 资金｜55%(exp→50%) → 85%(exp→90%) → 100%(硬保底)｜E[N] = 1.52 次
 * - Tier 2：1 点 + 1500 资金｜35%(exp→35%) → 65%(exp→70%) → 90%(exp→95%) → 100%(硬保底)｜E[N] = 1.90 次
 * - Tier 3：1 点 + 4000 资金｜15%(exp→25%) → 35%(exp→50%) → 65%(exp→75%) → 90%(exp→95%) → 100%(硬保底)｜E[N] = 2.62 次
 */
export const PROTOCOL_TIER_EXPERIMENT_SPEC: Readonly<Record<ProtocolTier, ProtocolTierExperimentSpec>> = Object.freeze({
  1: {
    tier: 1,
    costPoints: 1,
    costCredits: 500,
    maxAttempts: 3,
    expectedAttempts: 1.52,
    expectedPoints: 1.52,
    expectedCredits: 760,
    steps: Object.freeze([
      { attempt: 1, prob: 0.55, probPercent: 55, failExp: 50, guaranteed: false },
      { attempt: 2, prob: 0.85, probPercent: 85, failExp: 90, guaranteed: false },
      { attempt: 3, prob: 1.0, probPercent: 100, failExp: 100, guaranteed: true },
    ]),
  },
  2: {
    tier: 2,
    costPoints: 1,
    costCredits: 1500,
    maxAttempts: 4,
    expectedAttempts: 1.9,
    expectedPoints: 1.9,
    expectedCredits: 2850,
    steps: Object.freeze([
      { attempt: 1, prob: 0.35, probPercent: 35, failExp: 35, guaranteed: false },
      { attempt: 2, prob: 0.65, probPercent: 65, failExp: 70, guaranteed: false },
      { attempt: 3, prob: 0.9, probPercent: 90, failExp: 95, guaranteed: false },
      { attempt: 4, prob: 1.0, probPercent: 100, failExp: 100, guaranteed: true },
    ]),
  },
  3: {
    tier: 3,
    costPoints: 1,
    costCredits: 4000,
    maxAttempts: 5,
    expectedAttempts: 2.62,
    expectedPoints: 2.62,
    expectedCredits: 10480,
    steps: Object.freeze([
      { attempt: 1, prob: 0.15, probPercent: 15, failExp: 25, guaranteed: false },
      { attempt: 2, prob: 0.35, probPercent: 35, failExp: 50, guaranteed: false },
      { attempt: 3, prob: 0.65, probPercent: 65, failExp: 75, guaranteed: false },
      { attempt: 4, prob: 0.9, probPercent: 90, failExp: 95, guaranteed: false },
      { attempt: 5, prob: 1.0, probPercent: 100, failExp: 100, guaranteed: true },
    ]),
  },
});

/** 归一化协议 Tier（非法值兑底为 1） */
export function normalizeProtocolTier(tier: unknown): ProtocolTier {
  if (tier === 3 || tier === '3') return 3;
  if (tier === 2 || tier === '2') return 2;
  return 1;
}

/**
 * 由阶梯概率表精确计算突破所需实验次数的数学期望 E[N]（保留 2 位小数）
 */
export function calculateExpectedExperimentAttempts(tier: ProtocolTier | number): number {
  const spec = PROTOCOL_TIER_EXPERIMENT_SPEC[normalizeProtocolTier(tier)];
  let survivalProb = 1.0;
  let expected = 0;
  for (const step of spec.steps) {
    const reachAndSucceed = survivalProb * step.prob;
    expected += step.attempt * reachAndSucceed;
    survivalProb *= 1 - step.prob;
  }
  return Math.round(expected * 100) / 100;
}

/**
 * 查询指定 Tier 在第 nextAttempt 轮实验（1-based）的突破率与未成经验目标规格；
 * 超出硬保底轮次时恒返回最后一档（100% 必成）。
 */
export function getExperimentStepSpec(tier: ProtocolTier | number, nextAttempt: number): ProtocolExperimentStepSpec {
  const spec = PROTOCOL_TIER_EXPERIMENT_SPEC[normalizeProtocolTier(tier)];
  const safeAttempt = Number.isFinite(nextAttempt) ? Math.max(1, Math.floor(nextAttempt)) : 1;
  const idx = Math.min(spec.steps.length - 1, safeAttempt - 1);
  return spec.steps[idx];
}

/**
 * 查询已尝试 currentAttempts 轮后，下一轮（currentAttempts + 1）实验的突破概率 ∈ [0, 1]
 */
export function getNextBreakthroughProb(tier: ProtocolTier | number, currentAttempts: number): number {
  const safeCurrent = Number.isFinite(currentAttempts) ? Math.max(0, Math.floor(currentAttempts)) : 0;
  return getExperimentStepSpec(tier, safeCurrent + 1).prob;
}

/**
 * 查询已尝试 currentAttempts 轮后，下一轮（currentAttempts + 1）实验的突破概率百分比 ∈ [0, 100]
 */
export function getNextBreakthroughProbPercent(tier: ProtocolTier | number, currentAttempts: number): number {
  const safeCurrent = Number.isFinite(currentAttempts) ? Math.max(0, Math.floor(currentAttempts)) : 0;
  return getExperimentStepSpec(tier, safeCurrent + 1).probPercent;
}

/**
 * 获取协议单次实验消耗（优先读取协议块自定义 cost_points / experiment_cost_credits，缺省按 Tier 表兑底）
 */
export function getProtocolExperimentCost(protocolDef: Partial<ProtocolDefinitionLike> | null | undefined): {
  costPoints: number;
  costCredits: number;
} {
  const tier = normalizeProtocolTier(protocolDef?.tier);
  const spec = PROTOCOL_TIER_EXPERIMENT_SPEC[tier];
  const costPoints =
    typeof protocolDef?.cost_points === 'number' &&
    Number.isFinite(protocolDef.cost_points) &&
    protocolDef.cost_points > 0
      ? protocolDef.cost_points
      : spec.costPoints;
  const costCredits =
    typeof protocolDef?.experiment_cost_credits === 'number' &&
    Number.isFinite(protocolDef.experiment_cost_credits) &&
    protocolDef.experiment_cost_credits >= 0
      ? protocolDef.experiment_cost_credits
      : spec.costCredits;
  return { costPoints, costCredits };
}

/* ═══════════════ 3. 同源确定性种子与实验预判（§3.5.2 / D-P2b 守卫④） ═══════════════ */

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const UINT32_MODULO = 4294967296; // 2^32

/** 标准 32-bit FNV-1a 无符号整数哈希 */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS_32;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0;
  }
  return hash >>> 0;
}

/** 归一化协议引用标识（优先解析为 18 条存量协议权威 ID，否则取 trim 原文） */
export function canonicalizeProtocolRef(rawRef: string): string {
  const trimmed = String(rawRef ?? '').trim();
  if (!trimmed) return '';
  return resolveLegacyProtocolId(trimmed) ?? trimmed;
}

/**
 * 前后端同源确定性种子纯函数（§3.5.2 / D-P2b 守卫④）：
 * - 严禁使用 Math.random()；
 * - 使用 32-bit FNV-1a 对归一化种子字符串 `${protocolId}#${nextAttempt}#${gameDay}` 哈希并映射至 [0, 1)；
 * - 保证前端指令拼装预判、`<当前工程日程>` 下轮态势预判与 `settleFloor` 引擎结算及 Swipe 重跑 100% 幂等。
 */
export function deterministicRoll(protocolId: string, nextAttempt: number, gameDay: number): number {
  const canonicalId = canonicalizeProtocolRef(protocolId);
  const safeAttempt = Number.isFinite(nextAttempt) ? Math.max(1, Math.floor(nextAttempt)) : 1;
  const safeDay = Number.isFinite(gameDay) ? Math.max(0, Math.floor(gameDay)) : 0;
  const seed = `${canonicalId}#${safeAttempt}#${safeDay}`;
  return fnv1a32(seed) / UINT32_MODULO;
}

/**
 * 同源预判下一轮协议实验结果（不产生状态变更，供前端 UI 指令拼装与日程提示词注入直接调用）
 */
export function predictExperimentOutcome(
  protocolDef: ProtocolDefinitionLike,
  instance?: Partial<ProtocolInstance> | null,
  gameDay = 0,
): ExperimentOutcomePrediction {
  const protocolId = canonicalizeProtocolRef(protocolDef.id || protocolDef.name || '');
  const tier = normalizeProtocolTier(protocolDef.tier);
  const prevAttempts =
    typeof instance?.attempts === 'number' && Number.isFinite(instance.attempts)
      ? Math.max(0, Math.floor(instance.attempts))
      : 0;
  const prevExp =
    typeof instance?.exp === 'number' && Number.isFinite(instance.exp) ? Math.min(100, Math.max(0, instance.exp)) : 0;

  const nextAttempt = prevAttempts + 1;
  const safeDay = Number.isFinite(gameDay) ? Math.max(0, Math.floor(gameDay)) : 0;
  const stepSpec = getExperimentStepSpec(tier, nextAttempt);
  const roll = deterministicRoll(protocolId, nextAttempt, safeDay);

  const willBreakthrough = stepSpec.guaranteed || stepSpec.prob >= 1 || roll < stepSpec.prob;
  const outcome: 'breakthrough' | 'accumulated' = willBreakthrough ? 'breakthrough' : 'accumulated';
  const nextStatus: ProtocolStatus = willBreakthrough ? 'active' : 'experimenting';
  const expAfter = willBreakthrough ? 100 : Math.min(99, Math.max(prevExp, stepSpec.failExp));

  const followingStep = getExperimentStepSpec(tier, nextAttempt + 1);
  const nextProb = willBreakthrough ? 1.0 : followingStep.prob;
  const nextProbPercent = willBreakthrough ? 100 : followingStep.probPercent;
  const { costPoints, costCredits } = getProtocolExperimentCost(protocolDef);

  return {
    protocolId,
    tier,
    nextAttempt,
    gameDay: safeDay,
    roll,
    prob: stepSpec.prob,
    probPercent: stepSpec.probPercent,
    guaranteed: stepSpec.guaranteed,
    outcome,
    willBreakthrough,
    nextStatus,
    expBefore: prevExp,
    expAfter,
    nextProb,
    nextProbPercent,
    costPoints,
    costCredits,
  };
}

/* ═══════════════ 4. 五态机四重守卫与辅助判定（D-P2b） ═══════════════ */

const PROTOCOL_STATUS_RANK: Readonly<Record<ProtocolStatus, number>> = Object.freeze({
  undiscovered: 0,
  locked: 1,
  available: 2,
  experimenting: 3,
  active: 4,
  voided: 5,
});

/**
 * 守卫①：五态机单向无环转移守卫（D-P2b）
 */
export function canTransitionProtocolStatus(from: ProtocolStatus, to: ProtocolStatus): boolean {
  if (from === to) return true;
  if (from === 'active' || from === 'voided') return false;
  const fromRank = PROTOCOL_STATUS_RANK[from];
  const toRank = PROTOCOL_STATUS_RANK[to];
  if (fromRank === undefined || toRank === undefined) return false;
  return toRank > fromRank;
}

/**
 * 守卫②：协议对口阵营科研院所是否在线且达到所需 Tier（D-P2b / D-P8b）
 */
export function isProtocolLabOnline(
  state: ProtocolAnchorStateView | null | undefined,
  protocolDef: Pick<ProtocolDefinitionLike, 'faction' | 'tier'>,
): boolean {
  const requiredTier = normalizeProtocolTier(protocolDef.tier);
  const currentTier = factionLabTier(state, protocolDef.faction);
  return currentTier >= requiredTier;
}

const PROTOCOL_POINT_TICKS_PER_DAY = 1440 * 10000;

export function roundPoints4(value: number): number {
  const ticks = Math.round(value * PROTOCOL_POINT_TICKS_PER_DAY);
  return Math.round((ticks / PROTOCOL_POINT_TICKS_PER_DAY) * 1e12) / 1e12;
}

export function resolveCurrentGameDay(state: ProtocolEngineStateView | null | undefined, explicitDay?: number): number {
  if (typeof explicitDay === 'number' && Number.isFinite(explicitDay)) {
    return Math.max(0, Math.floor(explicitDay));
  }
  const metaDay = state?.meta?.day_count;
  if (typeof metaDay === 'number' && Number.isFinite(metaDay)) {
    return Math.max(0, Math.floor(metaDay));
  }
  const clockDay = state?.clock?.day;
  if (typeof clockDay === 'number' && Number.isFinite(clockDay)) {
    return Math.max(0, Math.floor(clockDay));
  }
  return 0;
}

/** 创建缺省协议运行时实例（不修改外部状态） */
export function createDefaultProtocolInstance(
  protocolDef: ProtocolDefinitionLike,
  initialStatus?: ProtocolStatus,
  gameDay = 0,
): ProtocolInstance {
  const ref = canonicalizeProtocolRef(protocolDef.id || protocolDef.name || '');
  const hasDiscovery = protocolDef.discovery !== undefined;
  const defaultStatus: ProtocolStatus = initialStatus ?? (hasDiscovery ? 'undiscovered' : 'locked');
  return {
    ref,
    status: defaultStatus,
    attempts: 0,
    exp: defaultStatus === 'active' ? 100 : 0,
    points_spent: 0,
    credits_spent: 0,
    auto_queued: false,
    hold: false,
    discovered_via: defaultStatus === 'undiscovered' ? undefined : 'init',
    updated_at_day: gameDay,
    schema_version: PROTOCOL_SCHEMA_VERSION,
  };
}

/** 克隆协议实例，并强制兑现终态与实验封存守卫不变量 */
export function normalizeAndSealProtocolInstance(instance: ProtocolInstance): ProtocolInstance {
  // 守卫③：active 终态永久生效，exp 恒为 100，清除排程挂起标记
  if (instance.status === 'active') {
    return {
      ...instance,
      exp: 100,
      auto_queued: false,
      hold: false,
      last_result: instance.last_result ? { ...instance.last_result } : undefined,
    };
  }
  if (instance.status === 'voided') {
    return {
      ...instance,
      auto_queued: false,
      hold: false,
      last_result: instance.last_result ? { ...instance.last_result } : undefined,
    };
  }
  // 守卫②：experimenting 实例的 attempts / exp / points_spent / credits_spent 100% 原样保留
  return {
    ...instance,
    last_result: instance.last_result ? { ...instance.last_result } : undefined,
  };
}

/** 构建研究与已激活协议并集集合（tech.done ∪ activeProtocols 的名与 ID） */
export function buildCompletedResearchAndProtocolSet(
  state: ProtocolEngineStateView | null | undefined,
  catalogProtocols?: readonly ProtocolDefinitionLike[],
): Set<string> {
  const set = new Set<string>();
  for (const name of state?.tech?.done ?? []) {
    if (typeof name === 'string' && name.trim()) {
      set.add(name.trim());
    }
  }
  const catalogById = new Map<string, ProtocolDefinitionLike>();
  for (const p of catalogProtocols ?? []) {
    const cid = canonicalizeProtocolRef(p.id);
    if (cid) catalogById.set(cid, p);
  }
  for (const inst of state?.protocols ?? []) {
    if (inst?.status !== 'active') continue;
    const cid = canonicalizeProtocolRef(inst.ref);
    if (cid) set.add(cid);
    if (inst.ref) set.add(inst.ref.trim());
    const legacyName = resolveLegacyProtocolName(cid);
    if (legacyName) set.add(legacyName);
    const catalogDef = catalogById.get(cid);
    if (catalogDef?.name) set.add(catalogDef.name.trim());
  }
  return set;
}

/** 构造 prerequisites.ts 评估所需的 PrerequisiteContext */
export function buildPrerequisiteContextFromState(
  state: ProtocolEngineStateView | null | undefined,
  catalogProtocols?: readonly ProtocolDefinitionLike[],
): PrerequisiteContext {
  const techDone = buildCompletedResearchAndProtocolSet(state, catalogProtocols);
  const basesMap = new Map<string, PrerequisiteBaseState>();
  let firstBaseId = '';

  for (const base of state?.bases ?? []) {
    if (!isBaseOperationalForProtocol(base)) continue;
    const baseId = (typeof base.id === 'string' && base.id.trim()) || base.name || 'default_base';
    if (!firstBaseId) firstBaseId = baseId;

    const existing = new Set<string>();
    const completed = new Set<string>();
    const running = new Set<string>();

    for (const b of base.buildings ?? []) {
      if (!b || typeof b.name !== 'string' || !b.name.trim()) continue;
      const bName = b.name.trim();
      existing.add(bName);
      if (b.state !== '建造中') {
        completed.add(bName);
      }
      if (isProtocolBuildingOperational(b)) {
        running.add(bName);
      }
    }
    basesMap.set(baseId, { existing, completed, running });
  }

  const unitPresent = new Map<string, number>();
  for (const [uName, count] of Object.entries(state?.forces?.troops ?? {})) {
    if (typeof count === 'number' && count > 0) {
      unitPresent.set(uName, (unitPresent.get(uName) ?? 0) + count);
    }
  }
  for (const vName of state?.forces?.vehicles ?? []) {
    if (typeof vName === 'string' && vName.trim()) {
      unitPresent.set(vName.trim(), (unitPresent.get(vName.trim()) ?? 0) + 1);
    }
  }
  for (const g of state?.forces?.girls ?? []) {
    if (g && typeof g.name === 'string' && g.name.trim()) {
      unitPresent.set(g.name.trim(), (unitPresent.get(g.name.trim()) ?? 0) + 1);
    }
  }

  return {
    techDone,
    selectedBaseId: firstBaseId,
    bases: basesMap,
    unitPresent,
  };
}

/**
 * 判定协议的附加准入条件（requirements / prereqs / need_buildings）是否全部满足
 */
export function areProtocolRequirementsMet(
  state: ProtocolEngineStateView | null | undefined,
  protocolDef: ProtocolDefinitionLike,
  catalogProtocols?: readonly ProtocolDefinitionLike[],
): boolean {
  const techDone = buildCompletedResearchAndProtocolSet(state, catalogProtocols);

  if (Array.isArray(protocolDef.prereqs) && protocolDef.prereqs.length > 0) {
    for (const req of protocolDef.prereqs) {
      if (typeof req === 'string' && req.trim() && !techDone.has(req.trim())) {
        return false;
      }
    }
  }

  if (Array.isArray(protocolDef.need_buildings) && protocolDef.need_buildings.length > 0) {
    for (const bName of protocolDef.need_buildings) {
      if (typeof bName === 'string' && bName.trim()) {
        if (!isAnyBuildingOperationalInState(state, [bName.trim()])) {
          return false;
        }
      }
    }
  }

  const rawReq = protocolDef.requirements;
  if (!rawReq || typeof rawReq !== 'object') {
    return true;
  }

  const reqObj = rawReq as Record<string, unknown>;
  // 兼容简写格式 { research_all?: string[], building_any?: string[] }
  if (!('op' in reqObj) && !('kind' in reqObj)) {
    if (Array.isArray(reqObj.research_all)) {
      for (const r of reqObj.research_all) {
        if (typeof r === 'string' && r.trim() && !techDone.has(r.trim())) {
          return false;
        }
      }
    }
    if (Array.isArray(reqObj.building_any) && reqObj.building_any.length > 0) {
      const buildingList = reqObj.building_any.filter((x): x is string => typeof x === 'string');
      if (buildingList.length > 0 && !isAnyBuildingOperationalInState(state, buildingList)) {
        return false;
      }
    }
    return true;
  }

  // 标准三原子树评估
  const context = buildPrerequisiteContextFromState(state, catalogProtocols);
  const evalResult = evaluatePrerequisite(rawReq, context);
  return evalResult.satisfied;
}

/**
 * 判定协议在同轨道中的前序协议是否已处于 active 状态（首节点无前序恒为 true）
 */
export function isProtocolTrackPredecessorActive(
  state: ProtocolEngineStateView | null | undefined,
  protocolDef: ProtocolDefinitionLike,
  catalogProtocols?: readonly ProtocolDefinitionLike[],
): boolean {
  if (!catalogProtocols || catalogProtocols.length === 0 || !protocolDef.track) {
    return true;
  }
  const targetId = canonicalizeProtocolRef(protocolDef.id || protocolDef.name || '');
  const sameTrack = catalogProtocols.filter(p => p.track === protocolDef.track);
  const idx = sameTrack.findIndex(p => canonicalizeProtocolRef(p.id || p.name || '') === targetId);
  if (idx <= 0) return true;

  const predDef = sameTrack[idx - 1];
  const predId = canonicalizeProtocolRef(predDef.id || predDef.name || '');
  const predInstance = (state?.protocols ?? []).find(inst => canonicalizeProtocolRef(inst.ref) === predId);
  return predInstance?.status === 'active';
}
