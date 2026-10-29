/**
 * protocolEngine.ts —— 协议五态单向状态机、双资源渐进概率实验引擎、同源确定性种子与 UTO 自动排程（PRT-SLOT-01）
 *
 * 真源：
 * - docs/project/plans/协议玩法MVP任务包.md（§3.2 / §3.5.2 / §3.5.3 / §6 PRT-SLOT-01）
 * - docs/project/plans/协议玩法-脑暴决策记录-2026-10-10.md（D-P2b / D-P5c / D-P8b/8c / D-P9b / D-P27 / D-P28）
 *
 * 类型定义、阶梯概率表、同源确定性种子与五态守卫辅助已拆至 ./protocolEngineHelpers，本入口保持完整 Re-export。
 */

import {
  PROTOCOL_SCHEMA_VERSION,
  resolveLegacyProtocolName,
  type ProtocolInstance,
  type ProtocolLastResult,
  type ProtocolStatus,
} from '../core/schema';
import {
  PROTOCOL_LANE_DISPLAY_NAME,
  PROTOCOL_LANE_KEY,
  ProtocolLaneProvider,
  type ProtocolLaneProviderOptions,
} from './laneProviders';
import {
  factionLabTier,
  isAnyBuildingOperationalInState,
  scanActiveProtocolBuildings,
  type ProtocolAnchorStateView,
} from './protocolAnchors';
import {
  areProtocolRequirementsMet,
  buildCompletedResearchAndProtocolSet,
  canonicalizeProtocolRef,
  createDefaultProtocolInstance,
  getNextBreakthroughProbPercent,
  getProtocolExperimentCost,
  isProtocolLabOnline,
  isProtocolTrackPredecessorActive,
  normalizeAndSealProtocolInstance,
  normalizeProtocolTier,
  predictExperimentOutcome,
  resolveCurrentGameDay,
  roundPoints4,
  type ExecuteProtocolExperimentOptions,
  type ExecuteProtocolExperimentResult,
  type ProtocolDefinitionLike,
  type ProtocolDiscoveryResult,
  type ProtocolEngineStateView,
  type ProtocolTier,
  type ProtocolTrackRefreshResult,
  type SettleAutoProtocolsOptions,
  type SettleAutoProtocolsResult,
} from './protocolEngineHelpers';

export { PROTOCOL_LANE_DISPLAY_NAME, PROTOCOL_LANE_KEY, ProtocolLaneProvider };
export * from './protocolEngineHelpers';

/* ═══════════════ 实验启封、事件启封与同轨线性拓扑解锁（D-P5c / D-P3） ═══════════════ */

/**
 * 实验院所自动启封纯函数（§3.5.3 / D-P5c 通道①）：
 * - 扫描 catalogProtocols 中 `discovery.kind === 'experiment'` 的协议；
 * - 当 `discovery.building_any` 任一建筑在场运转（若未指定则要求对口实验室 Tier 达标）且 `discovery.research_all` 全部完成时，
 *   将处于 `undiscovered`（或尚未入表）的协议自动启封为 `available`，
 *   记录 `discovered_via: 'experiment'` 与 `last_result: { day, outcome: 'discovered', ... }`。
 */
export function discoverProtocolsByExperiment<T extends ProtocolEngineStateView>(
  state: T,
  catalogProtocols: readonly ProtocolDefinitionLike[],
  gameDay?: number,
): ProtocolDiscoveryResult<T> {
  const currentDay = resolveCurrentGameDay(state, gameDay);
  const techDone = buildCompletedResearchAndProtocolSet(state, catalogProtocols);
  const existingList = (state.protocols ?? []).map(normalizeAndSealProtocolInstance);
  const byRef = new Map<string, number>();
  existingList.forEach((inst, idx) => {
    byRef.set(canonicalizeProtocolRef(inst.ref), idx);
  });

  const discoveredIds: string[] = [];

  for (const def of catalogProtocols) {
    if (def.discovery?.kind !== 'experiment') continue;
    const ref = canonicalizeProtocolRef(def.id || def.name || '');
    if (!ref) continue;

    const existingIdx = byRef.get(ref);
    const currentInst = existingIdx !== undefined ? existingList[existingIdx] : undefined;
    if (currentInst && currentInst.status !== 'undiscovered') {
      continue;
    }

    // 1. 核查 building_any 在场运转（缺省核查对口实验室 Tier）
    const buildingAny = def.discovery.building_any ?? [];
    const buildingOk =
      buildingAny.length > 0 ? isAnyBuildingOperationalInState(state, buildingAny) : isProtocolLabOnline(state, def);
    if (!buildingOk) continue;

    // 2. 核查 research_all 已完成
    const researchAll = def.discovery.research_all ?? [];
    const researchOk = researchAll.every(r => typeof r === 'string' && techDone.has(r.trim()));
    if (!researchOk) continue;

    const tier = normalizeProtocolTier(def.tier);
    const nextProb = getNextBreakthroughProbPercent(tier, 0);
    const discoveredInst: ProtocolInstance = {
      ...(currentInst ?? createDefaultProtocolInstance(def, 'undiscovered', currentDay)),
      ref,
      status: 'available',
      attempts: 0,
      exp: 0,
      discovered_via: 'experiment',
      updated_at_day: currentDay,
      last_result: {
        day: currentDay,
        outcome: 'discovered',
        attempt: 0,
        exp_before: 0,
        exp_after: 0,
        next_prob: nextProb,
      },
      schema_version: PROTOCOL_SCHEMA_VERSION,
    };

    if (existingIdx !== undefined) {
      existingList[existingIdx] = discoveredInst;
    } else {
      byRef.set(ref, existingList.length);
      existingList.push(discoveredInst);
    }
    discoveredIds.push(ref);
  }

  if (discoveredIds.length === 0) {
    return {
      state,
      discoveredIds: [],
      instances: existingList,
    };
  }

  const nextState: T = {
    ...state,
    protocols: existingList,
  };
  return {
    state: nextState,
    discoveredIds,
    instances: existingList,
  };
}

/**
 * 奇遇/战损复盘事件启封纯函数（D-P5c 通道②）：
 * - 将处于 `undiscovered` 或 `locked`（或未入表）的目标协议启封为 `available`，
 *   记录 `discovered_via: 'event'` 与 `last_result: { day, outcome: 'discovered', ... }`；
 * - 遵守单向不退化守卫：若协议已处于 `available / experimenting / active / voided`，原样保持不退化。
 */
export function discoverProtocolByEvent<T extends ProtocolEngineStateView>(
  state: T,
  protocolDef: ProtocolDefinitionLike,
  gameDay?: number,
): { state: T; discovered: boolean; instance: ProtocolInstance } {
  const currentDay = resolveCurrentGameDay(state, gameDay);
  const ref = canonicalizeProtocolRef(protocolDef.id || protocolDef.name || '');
  const existingList = (state.protocols ?? []).map(normalizeAndSealProtocolInstance);
  const existingIdx = existingList.findIndex(inst => canonicalizeProtocolRef(inst.ref) === ref);
  const currentInst = existingIdx >= 0 ? existingList[existingIdx] : undefined;

  if (
    currentInst &&
    (currentInst.status === 'available' ||
      currentInst.status === 'experimenting' ||
      currentInst.status === 'active' ||
      currentInst.status === 'voided')
  ) {
    return {
      state,
      discovered: false,
      instance: currentInst,
    };
  }

  const tier = normalizeProtocolTier(protocolDef.tier);
  const nextProb = getNextBreakthroughProbPercent(tier, 0);
  const discoveredInst: ProtocolInstance = {
    ...(currentInst ?? createDefaultProtocolInstance(protocolDef, 'undiscovered', currentDay)),
    ref,
    status: 'available',
    attempts: 0,
    exp: 0,
    discovered_via: 'event',
    updated_at_day: currentDay,
    last_result: {
      day: currentDay,
      outcome: 'discovered',
      attempt: 0,
      exp_before: 0,
      exp_after: 0,
      next_prob: nextProb,
    },
    schema_version: PROTOCOL_SCHEMA_VERSION,
  };

  if (existingIdx >= 0) {
    existingList[existingIdx] = discoveredInst;
  } else {
    existingList.push(discoveredInst);
  }

  return {
    state: {
      ...state,
      protocols: existingList,
    },
    discovered: true,
    instance: discoveredInst,
  };
}

/**
 * 同轨线性拓扑准入刷新纯函数（§3.5.3 / D-P3）：
 * - 当同轨前序协议已 `active`（或为轨首）、对口阵营实验室 Tier 达标且 `requirements` 满足时，
 *   将处于 `locked`（或无 discovery 配置尚未入表）的协议解锁为 `available`；
 * - 严守单向状态机守卫：已处于 `available / experimenting / active / voided` 的协议绝不因实验室离线或任何原因倒退回 `locked`。
 */
export function refreshProtocolTrackAvailability<T extends ProtocolEngineStateView>(
  state: T,
  catalogProtocols: readonly ProtocolDefinitionLike[],
  gameDay?: number,
): ProtocolTrackRefreshResult<T> {
  const currentDay = resolveCurrentGameDay(state, gameDay);
  const existingList = (state.protocols ?? []).map(normalizeAndSealProtocolInstance);
  const byRef = new Map<string, number>();
  existingList.forEach((inst, idx) => {
    byRef.set(canonicalizeProtocolRef(inst.ref), idx);
  });

  const unlockedIds: string[] = [];

  for (const def of catalogProtocols) {
    const ref = canonicalizeProtocolRef(def.id || def.name || '');
    if (!ref) continue;

    const existingIdx = byRef.get(ref);
    const currentInst = existingIdx !== undefined ? existingList[existingIdx] : undefined;

    // 若尚未入表且带有 discovery 配置，必须先走启封通道，不可由 locked 直接跳过 discovery
    if (!currentInst && def.discovery !== undefined) {
      continue;
    }

    const effectiveStatus: ProtocolStatus = currentInst?.status ?? 'locked';
    if (effectiveStatus !== 'locked') {
      continue;
    }

    // 1. 核查同轨前序是否已 active（由奇遇/战损事件显式启封的协议免除同轨前序与常规前置门控，仅需对口实验室在线）
    const isEventDiscovered = currentInst?.discovered_via === 'event';
    const workingState: ProtocolEngineStateView = { ...state, protocols: existingList };
    if (!isEventDiscovered && !isProtocolTrackPredecessorActive(workingState, def, catalogProtocols)) {
      continue;
    }

    // 2. 核查阵营对口实验室 Tier 门控
    if (!isProtocolLabOnline(workingState, def)) {
      continue;
    }

    // 3. 核查附加准入条件 requirements / prereqs / need_buildings
    if (!isEventDiscovered && !areProtocolRequirementsMet(workingState, def, catalogProtocols)) {
      continue;
    }

    const unlockedInst: ProtocolInstance = {
      ...(currentInst ?? createDefaultProtocolInstance(def, 'locked', currentDay)),
      ref,
      status: 'available',
      discovered_via: currentInst?.discovered_via ?? 'init',
      updated_at_day: currentDay,
      schema_version: PROTOCOL_SCHEMA_VERSION,
    };

    if (existingIdx !== undefined) {
      existingList[existingIdx] = unlockedInst;
    } else {
      byRef.set(ref, existingList.length);
      existingList.push(unlockedInst);
    }
    unlockedIds.push(ref);
  }

  if (unlockedIds.length === 0) {
    return {
      state,
      unlockedIds: [],
      instances: existingList,
    };
  }

  return {
    state: {
      ...state,
      protocols: existingList,
    },
    unlockedIds,
    instances: existingList,
  };
}

/* ═══════════════ 协议实验执行纯函数（§3.5.2 / D-P2b / D-P9b） ═══════════════ */

/**
 * 执行一轮协议实验纯函数：
 * - 四重守卫核查：
 *   1. 状态合法性（仅 `available` 或 `experimenting` 可开展实验；`active` 永久保持、`undiscovered/locked/voided` 拒止）；
 *   2. 实验室在线守卫（`factionLabTier(state, faction) >= tier`；若实验室损毁/断电离线，拒止实验并 100% 封存保留已攒 `exp/attempts/points_spent/credits_spent`）；
 *   3. 双资源足额核查（`protocol_points >= costPoints` 且 `economy.credits >= costCredits`）；
 *   4. 同源确定性种子判定（调用 `predictExperimentOutcome` 计算突破或阶段经验积累）；
 * - 若本轮突破至 `active`：自动将 `exp` 置 100、清除 `auto_queued` 与 `hold`，并在提供 `catalogProtocols` 时刷新同轨后继协议准入。
 */
export function executeProtocolExperiment<T extends ProtocolEngineStateView>(
  state: T,
  protocolDef: ProtocolDefinitionLike,
  options: ExecuteProtocolExperimentOptions = {},
): ExecuteProtocolExperimentResult<T> {
  const currentDay = resolveCurrentGameDay(state, options.gameDay);
  const ref = canonicalizeProtocolRef(protocolDef.id || protocolDef.name || '');
  const existingList = (state.protocols ?? []).map(normalizeAndSealProtocolInstance);
  const existingIdx = existingList.findIndex(inst => canonicalizeProtocolRef(inst.ref) === ref);

  // 若未入表，按是否存在 discovery 决定初始态（无 discovery 且满足同轨/实验室/前置时视为 available）
  let currentInst: ProtocolInstance;
  if (existingIdx >= 0) {
    currentInst = existingList[existingIdx];
  } else {
    const canInitAvailable =
      protocolDef.discovery === undefined &&
      isProtocolTrackPredecessorActive(state, protocolDef, options.catalogProtocols) &&
      isProtocolLabOnline(state, protocolDef) &&
      areProtocolRequirementsMet(state, protocolDef, options.catalogProtocols);
    currentInst = createDefaultProtocolInstance(protocolDef, canInitAvailable ? 'available' : undefined, currentDay);
  }

  // 1. 状态机守卫
  if (currentInst.status === 'active') {
    const sealed = normalizeAndSealProtocolInstance(currentInst);
    return {
      executed: false,
      reason: 'already_active',
      state,
      instance: sealed,
      unlockedNextIds: [],
    };
  }
  if (currentInst.status === 'voided') {
    return {
      executed: false,
      reason: 'voided',
      state,
      instance: currentInst,
      unlockedNextIds: [],
    };
  }
  if (currentInst.status === 'undiscovered') {
    return {
      executed: false,
      reason: 'undiscovered',
      state,
      instance: currentInst,
      unlockedNextIds: [],
    };
  }
  if (currentInst.status === 'locked') {
    return {
      executed: false,
      reason: 'locked',
      state,
      instance: currentInst,
      unlockedNextIds: [],
    };
  }

  // 2. 同轨前序与附加准入核查（仅针对尚未开始实验且非事件启封的 available 项；已进入 experimenting 或由事件显式启封的项只受实验室在线与双资源约束）
  if (currentInst.status === 'available' && currentInst.discovered_via !== 'event') {
    if (!isProtocolTrackPredecessorActive(state, protocolDef, options.catalogProtocols)) {
      return {
        executed: false,
        reason: 'predecessor_inactive',
        state,
        instance: currentInst,
        unlockedNextIds: [],
      };
    }
    if (!areProtocolRequirementsMet(state, protocolDef, options.catalogProtocols)) {
      return {
        executed: false,
        reason: 'requirements_unmet',
        state,
        instance: currentInst,
        unlockedNextIds: [],
      };
    }
  }

  // 3. 实验室离线封存守卫（守卫②：离线时 100% 保留 exp / attempts / points_spent / credits_spent，仅阻断继续实验）
  if (!isProtocolLabOnline(state, protocolDef)) {
    return {
      executed: false,
      reason: 'lab_offline',
      state,
      instance: normalizeAndSealProtocolInstance(currentInst),
      unlockedNextIds: [],
    };
  }

  // 4. 双资源足额守卫
  const { costPoints, costCredits } = getProtocolExperimentCost(protocolDef);
  const currentPoints =
    typeof state.protocol_points === 'number' && Number.isFinite(state.protocol_points) ? state.protocol_points : 0;
  const currentCredits =
    typeof state.economy?.credits === 'number' && Number.isFinite(state.economy.credits) ? state.economy.credits : 0;

  if (currentPoints + 1e-9 < costPoints) {
    return {
      executed: false,
      reason: 'insufficient_points',
      state,
      instance: currentInst,
      unlockedNextIds: [],
    };
  }
  if (currentCredits < costCredits) {
    return {
      executed: false,
      reason: 'insufficient_credits',
      state,
      instance: currentInst,
      unlockedNextIds: [],
    };
  }

  // 5. 同源确定性种子判定与账本更新
  const prediction = predictExperimentOutcome(protocolDef, currentInst, currentDay);
  const lastResult: ProtocolLastResult = {
    day: currentDay,
    outcome: prediction.outcome,
    attempt: prediction.nextAttempt,
    exp_before: prediction.expBefore,
    exp_after: prediction.expAfter,
    next_prob: prediction.nextProbPercent,
  };

  const nextInst: ProtocolInstance = {
    ...currentInst,
    ref,
    status: prediction.nextStatus,
    attempts: prediction.nextAttempt,
    exp: prediction.expAfter,
    points_spent: roundPoints4((currentInst.points_spent ?? 0) + costPoints),
    credits_spent: Math.round((currentInst.credits_spent ?? 0) + costCredits),
    auto_queued: prediction.willBreakthrough ? false : (currentInst.auto_queued ?? false),
    hold: prediction.willBreakthrough ? false : (currentInst.hold ?? false),
    discovered_via: currentInst.discovered_via ?? 'init',
    updated_at_day: currentDay,
    last_result: lastResult,
    schema_version: PROTOCOL_SCHEMA_VERSION,
  };

  if (existingIdx >= 0) {
    existingList[existingIdx] = nextInst;
  } else {
    existingList.push(nextInst);
  }

  const nextPoints = Math.max(0, roundPoints4(currentPoints - costPoints));
  const nextCredits = Math.max(0, Math.round(currentCredits - costCredits));

  let nextState: T = {
    ...state,
    protocol_points: nextPoints,
    economy: state.economy
      ? {
          ...state.economy,
          credits: nextCredits,
        }
      : { credits: nextCredits },
    protocols: existingList,
  };

  let unlockedNextIds: string[] = [];
  if (prediction.willBreakthrough && options.catalogProtocols && options.catalogProtocols.length > 0) {
    const refreshRes = refreshProtocolTrackAvailability(nextState, options.catalogProtocols, currentDay);
    nextState = refreshRes.state;
    unlockedNextIds = refreshRes.unlockedIds;
  }

  return {
    executed: true,
    state: nextState,
    instance: nextInst,
    prediction,
    outcome: prediction.outcome,
    lastResult,
    unlockedNextIds,
  };
}

/* ═══════════════ 对接 UTO 的自动安排实验排程（§3.5.3 / D-P27） ═══════════════ */

/**
 * UTO 自动实验排程纯函数（§3.5.3 / D-P27）：
 * 调用方负责正 Δt 门、产点、启封及准入刷新；此处只消费已结算余额。
 * 1. 扫描 `auto_queued === true && !hold` 的排程协议（按 `queue_order` 升序，未设 `queue_order` 按原数组序排后）：
 *    若队首协议处于 `available / experimenting`、对口实验室在线且双资源足额，自动扣费并执行 1 轮实验判定；
 * 2. 若该协议本轮突破至 `active`，清除其 `auto_queued: false`，并按同轨线性拓扑将下一级已达标后继协议解锁为 `available`
 *    ——严格遵循 UTO 轴三“零单步跨任务穿透”铁律（本轮最多执行排程队首 1 轮实验，新解锁后继协议或次位候列协议留待下一轮结算）。
 */
export function settleAutoProtocols<T extends ProtocolEngineStateView>(
  state: T,
  catalogProtocols: readonly ProtocolDefinitionLike[],
  options: SettleAutoProtocolsOptions = {},
): SettleAutoProtocolsResult<T> {
  // 扫描 auto_queued === true && !hold 的排程协议（按 queue_order 升序）
  const catalogById = new Map<string, ProtocolDefinitionLike>();
  for (const def of catalogProtocols) {
    const cid = canonicalizeProtocolRef(def.id || def.name || '');
    if (cid) catalogById.set(cid, def);
  }

  const skipCanonicalRefs = new Set<string>();
  for (const rawSkip of options.skipProtocolIds ?? []) {
    const cref = canonicalizeProtocolRef(rawSkip);
    if (cref) skipCanonicalRefs.add(cref);
  }

  const candidateEntries = (state.protocols ?? [])
    .map((inst, index) => ({ inst, index }))
    .filter(
      ({ inst }) =>
        inst.auto_queued === true &&
        inst.hold !== true &&
        (inst.status === 'available' || inst.status === 'experimenting') &&
        !skipCanonicalRefs.has(canonicalizeProtocolRef(inst.ref)),
    )
    .sort((a, b) => {
      const orderA =
        typeof a.inst.queue_order === 'number' && Number.isFinite(a.inst.queue_order)
          ? a.inst.queue_order
          : Number.MAX_SAFE_INTEGER;
      const orderB =
        typeof b.inst.queue_order === 'number' && Number.isFinite(b.inst.queue_order)
          ? b.inst.queue_order
          : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.index - b.index;
    });

  if (candidateEntries.length === 0) {
    return {
      state,
      unlockedIds: [],
      experimentExecuted: false,
    };
  }

  // 严格针对排程队首执行单轮实验裁决（零单步跨任务穿透）
  const headInst = candidateEntries[0].inst;
  const headRef = canonicalizeProtocolRef(headInst.ref);
  const headDef: ProtocolDefinitionLike = catalogById.get(headRef) ?? {
    id: headRef,
    name: resolveLegacyProtocolName(headRef) ?? headRef,
    tier: 1,
  };

  const expRes = executeProtocolExperiment(state, headDef, {
    gameDay: options.gameDay,
    catalogProtocols,
  });

  if (!expRes.executed) {
    return {
      state,
      unlockedIds: [],
      experimentExecuted: false,
      experimentProtocolId: headRef,
      experimentBlockedReason: expRes.reason,
    };
  }

  return {
    state: expRes.state,
    unlockedIds: expRes.unlockedNextIds,
    experimentExecuted: true,
    experimentProtocolId: headRef,
    experimentOutcome: expRes.outcome,
    experimentResult: expRes.lastResult,
  };
}

/* ═══════════════ UTO ProtocolLaneProvider 工厂与动态院所接线（D-P27） ═══════════════ */

export interface CreateProtocolLaneProviderOptions extends ProtocolLaneProviderOptions {
  /**
   * 若指定阵营与最低 Tier（如 { faction: '苏联', minTier: 2 }），
   * 当对口实验室未达标时自动将流水线标记为 locked=true
   */
  requiredFaction?: string;
  requiredTier?: ProtocolTier;
}

/**
 * 创建接入 7 建筑阶梯状态的 ProtocolLaneProvider 实例（domain: 'protocol', laneKey: 'theater:lane.protocol'）
 */
export function createProtocolLaneProvider(options: CreateProtocolLaneProviderOptions = {}): ProtocolLaneProvider {
  const { requiredFaction, requiredTier, resolveState, ...restOptions } = options;

  return new ProtocolLaneProvider({
    ...restOptions,
    resolveState: env => {
      if (resolveState) {
        return resolveState(env);
      }
      const stateView: ProtocolAnchorStateView = { bases: env.bases };
      const scan = scanActiveProtocolBuildings(stateView);
      const minTier = requiredTier ?? 1;
      const currentTier = factionLabTier(stateView, requiredFaction);
      const locked = restOptions.locked ?? currentTier < minTier;
      const capacity = locked ? 0 : (restOptions.capacity ?? 1);
      // 将超算/量子超算状态映射为可选加速倍率视图（不影响离散实验次数，仅供 UTO 工位看板展示）
      const accelMultiplier =
        restOptions.accelMultiplier ?? (scan.quantumSupercomputer ? 1.25 : scan.supercomputer ? 1.1 : 1.0);

      return {
        capacity,
        locked,
        lockedReason: locked ? (restOptions.lockedReason ?? `缺少运转中的 T${minTier} 对口科研实验设计局`) : undefined,
        accelMultiplier,
      };
    },
  });
}
