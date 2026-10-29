/**
 * protocolCommands.ts —— 协议科研指令同源预判拼装、四重守卫判定、自动排程指令与宿主输入栏回填（PRT-UI-03）
 *
 * 真源与纪律：
 * - docs/project/plans/协议玩法MVP任务包.md（§3.5.2 / §3.5.3 / §3.6.3 / §3.7 / §6 PRT-UI-03）
 * - docs/project/plans/协议玩法-脑暴决策记录-2026-10-10.md（D-P2b / D-P9b / D-P16b / D-P27）
 * - 同源确定性种子：严格复用 protocolEngine.ts 的 deterministicRoll / predictExperimentOutcome，严禁非确定性随机函数；
 * - 中控台只读红线：仅向宿主 #send_textarea 回填指令文本（支持多行追加并派发 input/change 事件），
 *   严禁自动发送，严禁调用任何 MVU / 世界书写入接口。
 */

import {
  factionLabTier,
  scanActiveProtocolBuildings,
  type ActiveProtocolBuildingScan,
  type ProtocolAnchorStateView,
} from '../../红警指挥系统/engines/protocolAnchors';
import {
  areProtocolRequirementsMet,
  canonicalizeProtocolRef,
  deterministicRoll,
  getProtocolExperimentCost,
  isProtocolLabOnline,
  isProtocolTrackPredecessorActive,
  normalizeProtocolTier,
  predictExperimentOutcome,
  type ExperimentOutcomePrediction,
  type ProtocolDefinitionLike,
  type ProtocolEngineStateView,
  type ProtocolTier,
} from '../../红警指挥系统/engines/protocolEngine';
import { resolveLegacyProtocolName, type ProtocolInstance, type ProtocolStatus } from '../../红警指挥系统/core/schema';
import { DEFAULT_PROTOCOL_CATALOG } from '../../红警指挥系统/engines/protocolCatalogIndex';

export { deterministicRoll, predictExperimentOutcome };

/* ═══════════════ 1. 类型定义 ═══════════════ */

export type ProtocolExperimentGuardReasonCode =
  | 'already_active'
  | 'voided'
  | 'undiscovered'
  | 'locked'
  | 'predecessor_inactive'
  | 'requirements_unmet'
  | 'lab_offline'
  | 'insufficient_points'
  | 'insufficient_credits';

export interface ProtocolCommandStateView extends ProtocolEngineStateView, ProtocolAnchorStateView {
  credits?: number;
}

export interface ProtocolExperimentGuardResult {
  enabled: boolean;
  reasonCode: ProtocolExperimentGuardReasonCode | null;
  reasonText: string;
  nextAttempt: number;
  costPoints: number;
  costCredits: number;
  currentPoints: number;
  currentCredits: number;
  labOnline: boolean;
  prediction: ExperimentOutcomePrediction;
}

export interface ProtocolExperimentCommandPayload {
  commandText: string;
  protocolId: string;
  protocolName: string;
  outcome: 'breakthrough' | 'accumulated';
  nextAttempt: number;
  nextExp: number;
  costPoints: number;
  costCredits: number;
  roll: number;
  probPercent: number;
  guaranteed: boolean;
  gameDay: number;
  prediction: ExperimentOutcomePrediction;
}

export interface ProtocolCommandStagedEvent {
  commandText: string;
  protocolId: string;
  outcome: 'breakthrough' | 'accumulated';
  nextAttempt: number;
  nextExp: number;
}

export type ProtocolScheduleAction = 'enable' | 'disable' | 'move_up' | 'move_down' | 'move_top' | 'hold' | 'resume';

export interface ProtocolAutoQueueItemView {
  id: string;
  name: string;
  faction: string;
  track: string;
  tier: ProtocolTier;
  status: ProtocolStatus | string;
  exp: number;
  attempts: number;
  nextProb: number;
  costPoints: number;
  costCredits: number;
  autoQueued: boolean;
  queueOrder: number;
  hold: boolean;
}

export interface ProtocolScheduleDispatchEvent {
  action: ProtocolScheduleAction;
  protocolId: string;
  protocolName: string;
  autoQueued: boolean;
  queueOrder: number;
  hold: boolean;
  commandText: string;
  queue: ProtocolAutoQueueItemView[];
}

export interface StageProtocolCommandOptions {
  /** 是否在已有文本后换行追加（默认 true） */
  append?: boolean;
  /** 可选注入的目标 Document（供单测或跨 iframe 指定） */
  doc?: Document | null;
}

export interface StageProtocolCommandResult {
  staged: boolean;
  channel: 'textarea' | 'memory';
  value: string;
}

/* ═══════════════ 2. 状态读取与辅助纯函数 ═══════════════ */

/** 读取当前协议点余额（非法值兑底 0） */
export function resolveStateProtocolPoints(state: ProtocolCommandStateView | null | undefined): number {
  const raw = state?.protocol_points;
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

/** 读取当前可用资金（优先读 economy.credits，兼容顶层 credits 简写，非法值兑底 0） */
export function resolveStateCredits(state: ProtocolCommandStateView | null | undefined): number {
  const econCredits = state?.economy?.credits;
  if (typeof econCredits === 'number' && Number.isFinite(econCredits)) {
    return econCredits;
  }
  const topCredits = state?.credits;
  if (typeof topCredits === 'number' && Number.isFinite(topCredits)) {
    return topCredits;
  }
  return 0;
}

/** 读取当前游戏日（优先 explicitDay → meta.day_count → clock.day → 0） */
export function resolveStateGameDay(state: ProtocolCommandStateView | null | undefined, explicitDay?: number): number {
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

export function formatProtocolPointsText(points: number): string {
  if (!Number.isFinite(points)) return '0';
  return Number.isInteger(points) ? String(points) : points.toFixed(2).replace(/\.?0+$/, '');
}

export function requiredInstituteLabName(faction: string | undefined, tier: ProtocolTier): string {
  const norm = String(faction ?? '').trim().toLowerCase();
  const isAllied = faction === '盟军' || norm === 'allied';
  const isYuri = faction === '尤里' || norm === 'yuri';
  if (tier === 3) {
    if (isYuri) return '双螺旋生命工程与高维意识科学院';
    return isAllied ? '盟军联合科研与国家工程组织节点' : '红星科学城（国家战略工程综合体）';
  }
  if (tier === 2) {
    if (isYuri) return '基因测序与心灵谐振研究院（或通用战斗实验室）';
    return isAllied ? '盟军战斗实验室（或通用战斗实验室）' : '红星实验设计局综合体（或通用战斗实验室）';
  }
  if (isYuri) return '尤里认知督导哨';
  return isAllied ? '盟军战区联络处' : '苏联前线参谋部';
}

/* ═══════════════ 3. 四重守卫判定纯函数（§3.5.2 / D-P2b） ═══════════════ */

/**
 * 评估协议节点的【🧪 开展第 k 轮实验】按钮可用性与四重守卫禁用原因：
 * 1. 状态机守卫：仅 `available` 或 `experimenting` 可点击；`active` / `voided` / `undiscovered` / `locked` 禁用；
 * 2. 实验室在线守卫：`isProtocolLabOnline(state, protocolDef)` 必须为 true；
 * 3. 协议点守卫：`protocol_points >= costPoints`；
 * 4. 资金守卫：`credits >= costCredits`。
 */
export function evaluateProtocolExperimentGuard(
  state: ProtocolCommandStateView | null | undefined,
  protocolDef: ProtocolDefinitionLike & { status?: ProtocolStatus | string; attempts?: number; exp?: number },
  instance?: Partial<ProtocolInstance> | null,
  options: {
    gameDay?: number;
    catalogProtocols?: readonly ProtocolDefinitionLike[];
    labScan?: ActiveProtocolBuildingScan;
    labOnline?: boolean;
  } = {},
): ProtocolExperimentGuardResult {
  const tier = normalizeProtocolTier(protocolDef.tier);
  const effectiveStatus = (instance?.status ?? protocolDef.status ?? 'locked') as ProtocolStatus;
  const attempts =
    typeof instance?.attempts === 'number' && Number.isFinite(instance.attempts)
      ? Math.max(0, Math.floor(instance.attempts))
      : typeof protocolDef.attempts === 'number' && Number.isFinite(protocolDef.attempts)
        ? Math.max(0, Math.floor(protocolDef.attempts))
        : 0;
  const exp =
    typeof instance?.exp === 'number' && Number.isFinite(instance.exp)
      ? Math.min(100, Math.max(0, instance.exp))
      : typeof protocolDef.exp === 'number' && Number.isFinite(protocolDef.exp)
        ? Math.min(100, Math.max(0, protocolDef.exp))
        : 0;

  const gameDay = resolveStateGameDay(state, options.gameDay);
  const prediction = predictExperimentOutcome(protocolDef, { attempts, exp, status: effectiveStatus }, gameDay);
  const { costPoints, costCredits } = getProtocolExperimentCost(protocolDef);
  const currentPoints = resolveStateProtocolPoints(state);
  const currentCredits = resolveStateCredits(state);
  const labOnline =
    typeof options.labOnline === 'boolean'
      ? options.labOnline
      : options.labScan
        ? factionLabTier(options.labScan, protocolDef.faction) >= tier
        : isProtocolLabOnline(state, protocolDef);
  const nextAttempt = attempts + 1;

  if (effectiveStatus === 'active') {
    return {
      enabled: false,
      reasonCode: 'already_active',
      reasonText: '该协议已突破定型并正式颁布生效（终态 100%），无需重复开展实验',
      nextAttempt,
      costPoints,
      costCredits,
      currentPoints,
      currentCredits,
      labOnline,
      prediction,
    };
  }

  if (effectiveStatus === 'voided') {
    return {
      enabled: false,
      reasonCode: 'voided',
      reasonText: '该协议已互斥封存，不可开展实验',
      nextAttempt,
      costPoints,
      costCredits,
      currentPoints,
      currentCredits,
      labOnline,
      prediction,
    };
  }

  if (effectiveStatus === 'undiscovered') {
    return {
      enabled: false,
      reasonCode: 'undiscovered',
      reasonText: '机密协议尚未启封（需满足实验室在场自动启封或战地奇遇事件发现后方可立项实验）',
      nextAttempt,
      costPoints,
      costCredits,
      currentPoints,
      currentCredits,
      labOnline,
      prediction,
    };
  }

  if (effectiveStatus === 'locked') {
    const reasons: string[] = [];
    if (options.catalogProtocols && !isProtocolTrackPredecessorActive(state, protocolDef, options.catalogProtocols)) {
      reasons.push('同轨前序协议尚未定型颁布');
    }
    if (!labOnline) {
      reasons.push(`需在役 T${tier} ${requiredInstituteLabName(protocolDef.faction, tier)}`);
    }
    if (options.catalogProtocols && !areProtocolRequirementsMet(state, protocolDef, options.catalogProtocols)) {
      reasons.push('前置科技或建筑条件未满足');
    }
    const detail = reasons.length > 0 ? reasons.join(' · ') : '同轨前序或对口院所准入条件未齐';
    return {
      enabled: false,
      reasonCode: 'locked',
      reasonText: `协议准入未齐（${detail}）`,
      nextAttempt,
      costPoints,
      costCredits,
      currentPoints,
      currentCredits,
      labOnline,
      prediction,
    };
  }

  if (!labOnline) {
    const labName = requiredInstituteLabName(protocolDef.faction, tier);
    const sealedSuffix = effectiveStatus === 'experimenting' ? ` · 已攒经验 ${exp}% 封存保留` : '';
    return {
      enabled: false,
      reasonCode: 'lab_offline',
      reasonText: `对口实验室离线（需在役 T${tier} ${labName}）${sealedSuffix}`,
      nextAttempt,
      costPoints,
      costCredits,
      currentPoints,
      currentCredits,
      labOnline,
      prediction,
    };
  }

  if (currentPoints + 1e-9 < costPoints) {
    const creditNote =
      currentCredits < costCredits
        ? `；且实验资金不足（需 ${costCredits} 资金，当前 ${Math.floor(currentCredits)} 资金）`
        : '';
    return {
      enabled: false,
      reasonCode: 'insufficient_points',
      reasonText: `协议点不足（需 ${costPoints} 点，当前储备 ${formatProtocolPointsText(currentPoints)} 点${creditNote}）`,
      nextAttempt,
      costPoints,
      costCredits,
      currentPoints,
      currentCredits,
      labOnline,
      prediction,
    };
  }

  if (currentCredits < costCredits) {
    return {
      enabled: false,
      reasonCode: 'insufficient_credits',
      reasonText: `实验资金不足（需 ${costCredits} 资金，当前可用 ${Math.floor(currentCredits)} 资金）`,
      nextAttempt,
      costPoints,
      costCredits,
      currentPoints,
      currentCredits,
      labOnline,
      prediction,
    };
  }

  return {
    enabled: true,
    reasonCode: null,
    reasonText: '',
    nextAttempt,
    costPoints,
    costCredits,
    currentPoints,
    currentCredits,
    labOnline,
    prediction,
  };
}

/**
 * 30 条规范协议默认目录（对齐 protocolCatalogIndex.ts 18 条 + 尤里 12 条），供未注入 catalogStore 时准确解析 tier / faction / 消耗
 */
export const DEFAULT_PROTOCOL_CATALOG_LITE: readonly ProtocolDefinitionLike[] = [
  ...DEFAULT_PROTOCOL_CATALOG,
  {
    id: 'yuri.protocol.t1.clone_tower_neuro_link',
    name: '复制人—心灵控制塔神经并联增幅协议',
    faction: '尤里',
    track: '神经过载与心控协同',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
  },
  {
    id: 'yuri.protocol.t1.puppet_adrenaline_override',
    name: '受控傀儡痛觉屏蔽与肾上腺素榨取协议',
    faction: '尤里',
    track: '神经过载与心控协同',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
  },
  {
    id: 'yuri.protocol.t2.mastermind_coolant_overclock',
    name: '精神控制车冷媒过载与牧羊人并机分流协议',
    faction: '尤里',
    track: '神经过载与心控协同',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
  },
  {
    id: 'yuri.protocol.t3.dominator_biphase_overload',
    name: '心灵支配仪·双相极限过载与死士殉爆协议',
    faction: '尤里',
    track: '神经过载与心控协同',
    tier: 3,
    cost_points: 1,
    experiment_cost_credits: 4000,
  },
  {
    id: 'yuri.protocol.t1.scarab_dual_mission_pack',
    name: '采掘机械虫—野战抢修与破履带双任务包协议',
    faction: '尤里',
    track: '生物机电与夺舍工程',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
  },
  {
    id: 'yuri.protocol.t1.virus_hallucinogen_ammo',
    name: '生化狙击手—致幻气溶胶微囊弹换装协议',
    faction: '尤里',
    track: '生物机电与夺舍工程',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
  },
  {
    id: 'yuri.protocol.t2.brute_myofiber_unleash',
    name: '巨像级重装破城兵—肌束极限解限与打桩机超压协议',
    faction: '尤里',
    track: '生物机电与夺舍工程',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
  },
  {
    id: 'yuri.protocol.t2.hotwire_field_requisition',
    name: '战地火线夺车与异制式火控快速接管协议',
    faction: '尤里',
    track: '生物机电与夺舍工程',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
  },
  {
    id: 'yuri.protocol.t1.gatling_phased_grid_sync',
    name: '盖特伺服电机—防空火控相控并网协议',
    faction: '尤里',
    track: '磁流谐振与特种攻城',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
  },
  {
    id: 'yuri.protocol.t2.boomer_turtleback_payloads',
    name: '雷鸣潜艇—龟背多载荷特种攻城弹头换装协议',
    faction: '尤里',
    track: '磁流谐振与特种攻城',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
  },
  {
    id: 'yuri.protocol.t2.magnetron_disk_flux_relay',
    name: '磁电坦克—飞碟强磁耦合与超视距隔山牵引协议',
    faction: '尤里',
    track: '磁流谐振与特种攻城',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
  },
  {
    id: 'yuri.protocol.t3.eclipse_orbital_reentry',
    name: '受库存与轨道电容约束的「月蚀」天基脑波再入协议',
    faction: '尤里',
    track: '磁流谐振与特种攻城',
    tier: 3,
    cost_points: 1,
    experiment_cost_credits: 4000,
  },
];

const DEFAULT_PROTOCOL_CATALOG_BY_ID: ReadonlyMap<string, ProtocolDefinitionLike> = (() => {
  const map = new Map<string, ProtocolDefinitionLike>();
  for (const def of DEFAULT_PROTOCOL_CATALOG_LITE) {
    const cid = canonicalizeProtocolRef(def.id || def.name || '');
    if (cid) map.set(cid, def);
    if (def.name) map.set(def.name.trim(), def);
  }
  return map;
})();

/**
 * 统计当前快照中可立即开展实验的协议数量（供 ConsoleQuickActions 左键【科技 TECH】与主厅徽标使用）：
 * 过滤条件：处于 `available` 或 `experimenting`、对口阵营 Tier 实验室在线、`protocol_points >= costPoints` 且 `credits >= costCredits`。
 */
export function countExperimentableProtocols(
  state: ProtocolCommandStateView | null | undefined,
  catalogProtocols: readonly ProtocolDefinitionLike[] = [],
): number {
  const protocols = state?.protocols ?? [];
  if (protocols.length === 0) return 0;

  const candidates = protocols.filter(
    inst => inst && (inst.status === 'available' || inst.status === 'experimenting'),
  );
  if (candidates.length === 0) return 0;

  let customCatalogById: Map<string, ProtocolDefinitionLike> | null = null;
  if (catalogProtocols.length > 0) {
    customCatalogById = new Map<string, ProtocolDefinitionLike>();
    for (const def of catalogProtocols) {
      const cid = canonicalizeProtocolRef(def.id || def.name || '');
      if (cid) customCatalogById.set(cid, def);
      if (def.name) customCatalogById.set(def.name.trim(), def);
    }
  }

  const labScan = scanActiveProtocolBuildings(state);

  let count = 0;
  for (const inst of candidates) {
    const cid = canonicalizeProtocolRef(inst.ref);
    const matchedDef =
      customCatalogById?.get(cid) ??
      customCatalogById?.get(inst.ref) ??
      DEFAULT_PROTOCOL_CATALOG_BY_ID.get(cid) ??
      DEFAULT_PROTOCOL_CATALOG_BY_ID.get(inst.ref);
    const rawInst = inst as Partial<ProtocolInstance> & {
      faction?: string;
      tier?: number;
      cost_points?: number;
      experiment_cost_credits?: number;
      name?: string;
    };
    const inferredFaction =
      matchedDef?.faction ??
      rawInst.faction ??
      (cid.startsWith('all.') ? '盟军' : cid.startsWith('yuri.') ? '尤里' : '苏联');
    const inferredTier = normalizeProtocolTier(matchedDef?.tier ?? rawInst.tier ?? 1);

    const defLike: ProtocolDefinitionLike = matchedDef ?? {
      id: cid || inst.ref,
      name: rawInst.name ?? resolveLegacyProtocolName(cid) ?? inst.ref,
      faction: inferredFaction,
      tier: inferredTier,
      cost_points: rawInst.cost_points,
      experiment_cost_credits: rawInst.experiment_cost_credits,
    };

    const guard = evaluateProtocolExperimentGuard(state, defLike, inst, { labScan });
    if (guard.enabled) {
      count += 1;
    }
  }
  return count;
}

/**
 * 统计当前快照中已加入自动实验排程（`auto_queued === true` 且未终态）的协议数量
 */
export function countAutoQueuedProtocols(state: ProtocolCommandStateView | null | undefined): number {
  const protocols = state?.protocols ?? [];
  return protocols.filter(
    p => p && p.auto_queued === true && p.status !== 'active' && p.status !== 'voided' && p.status !== 'undiscovered',
  ).length;
}

/* ═══════════════ 4. 同源确定性预判指令拼装纯函数（§3.6.3） ═══════════════ */

/**
 * 基于 `protocolEngine.ts` 的 `predictExperimentOutcome` / `deterministicRoll(protocolId, nextAttempt, gameDay)`
 * 同源确定性预判拼装标准协议科研指令（§3.6.3）：
 * - 阶段经验积累（`accumulated`）：
 *   `【最高统帅部·协议科研指令】授权调用在役科研院所算力，就《<协议名称>》开展第 <k> 轮专项攻关实验（消耗 <costPoints> 点协议点与 <costCredits> 资金；当前定型经验预计推进至 <nextExp>%，请叙事呈现实验进展、技术难点与阶段性数据积累，并在 <事件> 中输出 协议实验 声明）。`
 * - 临界突破定型（`breakthrough`）：
 *   `【最高统帅部·协议科研指令】授权调用在役科研院所算力，就《<协议名称>》开展第 <k> 轮终试定型攻关（消耗 <costPoints> 点协议点与 <costCredits> 资金；定型经验已达临界突破条件 100%，请叙事呈现协议正式突破定型与条令颁布，并在 <事件> 中输出 协议实验 声明）。`
 */
export function buildProtocolExperimentCommand(
  protocolDef: ProtocolDefinitionLike,
  instance?: Partial<ProtocolInstance> | null,
  gameDay = 0,
): ProtocolExperimentCommandPayload {
  const rawName = (protocolDef.name ?? resolveLegacyProtocolName(protocolDef.id) ?? protocolDef.id ?? '').trim();
  if (!rawName) {
    throw new RangeError('协议名称不能为空，无法拼装协议科研指令');
  }
  const prediction = predictExperimentOutcome(protocolDef, instance, gameDay);
  const k = prediction.nextAttempt;
  const costPoints = prediction.costPoints;
  const costCredits = prediction.costCredits;
  const nextExp = prediction.expAfter;

  const commandText =
    prediction.outcome === 'breakthrough'
      ? `【最高统帅部·协议科研指令】授权调用在役科研院所算力，就《${rawName}》开展第 ${k} 轮终试定型攻关（消耗 ${costPoints} 点协议点与 ${costCredits} 资金；定型经验已达临界突破条件 100%，请叙事呈现协议正式突破定型与条令颁布，并在 <事件> 中输出 协议实验 声明）。`
      : `【最高统帅部·协议科研指令】授权调用在役科研院所算力，就《${rawName}》开展第 ${k} 轮专项攻关实验（消耗 ${costPoints} 点协议点与 ${costCredits} 资金；当前定型经验预计推进至 ${nextExp}%，请叙事呈现实验进展、技术难点与阶段性数据积累，并在 <事件> 中输出 协议实验 声明）。`;

  return {
    commandText,
    protocolId: prediction.protocolId,
    protocolName: rawName,
    outcome: prediction.outcome,
    nextAttempt: k,
    nextExp,
    costPoints,
    costCredits,
    roll: prediction.roll,
    probPercent: prediction.probPercent,
    guaranteed: prediction.guaranteed,
    gameDay: prediction.gameDay,
    prediction,
  };
}

/* ═══════════════ 5. 自动排程开关与候列优先级调序纯函数（§3.5.3 / D-P27） ═══════════════ */

/** 判定协议状态是否允许开启或取消自动实验排程（支持 locked / available / experimenting） */
export function canToggleProtocolAutoQueue(status: ProtocolStatus | string | undefined): boolean {
  return status === 'locked' || status === 'available' || status === 'experimenting';
}

/** 按 queueOrder 升序排列已加入自动排程的协议候列（过滤 active / voided 终态） */
export function sortProtocolAutoQueue<
  T extends { id: string; status: string; autoQueued: boolean; queueOrder?: number },
>(nodes: readonly T[]): T[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.autoQueued && node.status !== 'active' && node.status !== 'voided')
    .sort((a, b) => {
      const orderA =
        typeof a.node.queueOrder === 'number' && Number.isFinite(a.node.queueOrder)
          ? a.node.queueOrder
          : Number.MAX_SAFE_INTEGER;
      const orderB =
        typeof b.node.queueOrder === 'number' && Number.isFinite(b.node.queueOrder)
          ? b.node.queueOrder
          : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.index - b.index;
    })
    .map(({ node }, idx) => ({
      ...node,
      queueOrder: idx + 1,
    }));
}

/** 对自动实验排程候列执行上移 / 下移 / 置顶调序，返回重排并重编 queueOrder (1..N) 后的新数组 */
export function reorderProtocolAutoQueue<T extends { id: string; queueOrder?: number }>(
  queue: readonly T[],
  protocolId: string,
  direction: 'up' | 'down' | 'top',
): T[] {
  const list = queue.map(item => ({ ...item }));
  const idx = list.findIndex(item => item.id === protocolId);
  if (idx < 0) {
    return list.map((item, i) => ({ ...item, queueOrder: i + 1 }));
  }

  if (direction === 'up' && idx > 0) {
    const temp = list[idx - 1];
    list[idx - 1] = list[idx];
    list[idx] = temp;
  } else if (direction === 'down' && idx < list.length - 1) {
    const temp = list[idx + 1];
    list[idx + 1] = list[idx];
    list[idx] = temp;
  } else if (direction === 'top' && idx > 0) {
    const [picked] = list.splice(idx, 1);
    list.unshift(picked);
  }

  return list.map((item, i) => ({
    ...item,
    queueOrder: i + 1,
  }));
}

/** 拼装自动排程与候列调序指令文本 */
export function buildProtocolScheduleCommand(params: {
  action: ProtocolScheduleAction;
  protocolName: string;
  queueOrder?: number;
  hold?: boolean;
  queueNames?: readonly string[];
}): string {
  const name = params.protocolName.trim();
  if (!name) {
    throw new RangeError('协议名称不能为空，无法拼装自动排程指令');
  }
  const order = typeof params.queueOrder === 'number' && Number.isFinite(params.queueOrder) ? params.queueOrder : 1;
  const queueText =
    params.queueNames && params.queueNames.length > 0
      ? `；当前自动实验候列：${params.queueNames.map((n, i) => `#${i + 1}《${n}》`).join(' → ')}`
      : '';

  const eventDeclarationSuffix = '并在 <事件> 中输出 协议排程 声明（标的与排程动作）。';
  switch (params.action) {
    case 'enable':
      return `【最高统帅部·协议排程指令】将《${name}》纳入自动实验排程候列（位次 #${order}${queueText}；当协议点与资金足额且对口实验室在线时自动按序开展实验）。${eventDeclarationSuffix}`;
    case 'disable':
      return `【最高统帅部·协议排程指令】取消《${name}》的自动实验排程（移出自动实验候列，已攒定型经验与轮次完整保留${queueText}）。${eventDeclarationSuffix}`;
    case 'move_up':
      return `【最高统帅部·协议排程指令】调整自动实验排程优先级：将《${name}》上移至候列第 #${order} 位（按新位次优先排程实验${queueText}）。${eventDeclarationSuffix}`;
    case 'move_down':
      return `【最高统帅部·协议排程指令】调整自动实验排程优先级：将《${name}》下移至候列第 #${order} 位（按新位次排程实验${queueText}）。${eventDeclarationSuffix}`;
    case 'move_top':
      return `【最高统帅部·协议排程指令】调整自动实验排程优先级：将《${name}》置顶为自动实验候列首序 #1（优先开展下一轮实验${queueText}）。${eventDeclarationSuffix}`;
    case 'hold':
      return `【最高统帅部·协议排程指令】暂缓《${name}》的自动实验排程（标记 hold 挂起，结算期跳过本项并顺延后续候列${queueText}）。${eventDeclarationSuffix}`;
    case 'resume':
      return `【最高统帅部·协议排程指令】恢复《${name}》的自动实验排程（解除 hold 挂起，恢复候列第 #${order} 位自动实验${queueText}）。${eventDeclarationSuffix}`;
  }
}

/* ═══════════════ 6. 宿主 #send_textarea 指令回填桥接（只读红线，零自动发送） ═══════════════ */

function resolveTextareaFromDoc(doc?: Document | null): HTMLTextAreaElement | null {
  try {
    if (doc) {
      const found = doc.querySelector<HTMLTextAreaElement>('#send_textarea');
      if (found) return found;
    }
    if (typeof window !== 'undefined') {
      const hostDoc =
        (window.frameElement as HTMLElement | null)?.ownerDocument ?? window.parent?.document ?? window.document;
      const fromHost = hostDoc?.querySelector<HTMLTextAreaElement>('#send_textarea');
      if (fromHost) return fromHost;
    }
    if (typeof document !== 'undefined') {
      return document.querySelector<HTMLTextAreaElement>('#send_textarea');
    }
  } catch {
    // 跨域或受限环境静默降级
  }
  return null;
}

/**
 * 将协议指令文本写入宿主 `#send_textarea`：
 * - 支持多行追加（当输入栏已有非空内容且未包含本条指令时换行追加，幂等防重复）；
 * - 派发冒泡 `input` 与 `change` 事件并聚焦；
 * - 严禁触发发送按钮，零 MVU 直写。
 */
export function stageProtocolCommandToTextarea(
  commandText: string,
  options: StageProtocolCommandOptions = {},
): StageProtocolCommandResult {
  const normalized = commandText.trim();
  if (!normalized) {
    return { staged: false, channel: 'memory', value: '' };
  }

  const textarea = resolveTextareaFromDoc(options.doc);
  if (!textarea) {
    return { staged: false, channel: 'memory', value: normalized };
  }

  const append = options.append !== false;
  const existing = typeof textarea.value === 'string' ? textarea.value.trim() : '';
  let nextValue = normalized;

  if (append && existing.length > 0) {
    const existingLines = existing.split('\n').map(line => line.trim());
    nextValue = existingLines.includes(normalized) ? existing : `${existing}\n${normalized}`;
  }

  textarea.value = nextValue;

  const EventCtor = textarea.ownerDocument?.defaultView?.Event ?? Event;
  textarea.dispatchEvent(new EventCtor('input', { bubbles: true }));
  textarea.dispatchEvent(new EventCtor('change', { bubbles: true }));
  if (typeof textarea.focus === 'function') {
    textarea.focus();
  }

  return {
    staged: true,
    channel: 'textarea',
    value: textarea.value,
  };
}
