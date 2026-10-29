/**
 * protocolAnchors.ts —— 7 座核心科研/算力建筑阶梯锚定与双轴产点纯函数模块（PRT-SLOT-01）
 *
 * 真源：
 * - docs/project/plans/协议玩法MVP任务包.md（§3.5.1 / §6 PRT-SLOT-01）
 * - docs/project/plans/协议玩法-脑暴决策记录-2026-10-10.md（§1.6 7 座科研/算力建筑底账 / D-P8b/8c / D-P26）
 *
 * 设计红线：
 * 1. 纯函数与零外部副作用：零 Pinia、零 Vue、零 DOM、零宿主 API，绝不原地修改入参；
 * 2. 7 建筑注册表纯数据驱动（P0 原则 3）：与 researchSlots.ts TECH_TIER_T2_ANCHORS / TECH_TIER_T3_ANCHORS 同源对齐；
 * 3. 阵营对口 Tier 门控（D-P8b）：苏联协议 T3 必须红星科学城在场运转，盟军协议 T3 必须盟军联合科研节点在场运转，
 *    严禁跨阵营或靠超算中心越俎代庖代解锁 T2/T3 协议；通用战斗实验室仅可兜底双方 T2。
 */

import { resolveMaxTechTier, TECH_TIER_T2_ANCHORS, TECH_TIER_T3_ANCHORS } from './researchSlots';

/* ═══════════════ 类型定义 ═══════════════ */

/** 核心科研/算力建筑权威 ID（对齐世界书底账 §1.6 & FD-26 尤里双螺旋科研院所） */
export type ProtocolAnchorBuildingId =
  | 'bld.common.battle_lab'
  | 'bld.soviet.red_star_design_bureau'
  | 'bld.soviet.red_star_science_city'
  | 'bld.allied.battle_lab'
  | 'bld.allied.joint_research_organization_node'
  | 'bld.yuri.gene_psychic_institute'
  | 'bld.yuri.double_helix_academy'
  | 'bld.common.supercomputing_center'
  | 'bld.common.quantum_supercomputing_center';

/** 建筑所属阵营分类 */
export type ProtocolAnchorFaction = '通用' | '苏联' | '盟军' | '尤里';

/** 双轴分类：institute=科研院所主轴，compute=算力辅助副轴 */
export type ProtocolAnchorAxis = 'institute' | 'compute';

/** 7 座建筑注册表项定义 */
export interface ProtocolAnchorBuildingDef {
  id: ProtocolAnchorBuildingId;
  name: string;
  comment: string;
  faction: ProtocolAnchorFaction;
  axis: ProtocolAnchorAxis;
  /** 对应解锁或代表的阶梯档位（T2 / T3） */
  tier: 2 | 3;
  /** 单建筑标称协议点日产贡献（点/日） */
  dailyRate: number;
  /** 机器判定包含词表（建筑名包含任一词且不命中 excludeNames 即视为匹配） */
  anchorNames: readonly string[];
  /** 机器判定排除词表（防止「盟军战斗实验室」误命中通用「战斗实验室」、或「量子超算中心」误命中普通「超算中心」） */
  excludeNames?: readonly string[];
}

/** 本模块消费的最小状态视图（与 schema.ts StatData 及 researchSlots.ts SlotStateView 兼容） */
export interface ProtocolAnchorStateView {
  bases?: ReadonlyArray<{
    id?: string;
    name?: string;
    status?: string;
    buildings?: ReadonlyArray<{
      name: string;
      state?: string;
    }>;
  }>;
}

/** 在役科研/算力建筑扫描快照 */
export interface ActiveProtocolBuildingScan {
  /** 命中的注册表建筑定义列表（按 PROTOCOL_ANCHOR_BUILDINGS 注册序去重） */
  buildings: ProtocolAnchorBuildingDef[];
  /** 命中的注册表建筑权威 ID 集合 */
  buildingIds: ReadonlySet<ProtocolAnchorBuildingId>;
  /** 所有在役（非废弃基地、非停机/损毁/断电/建造中）建筑原始名称列表 */
  rawBuildingNames: string[];
  /** 07·战斗实验室（通用 T2 院所）在役 */
  commonBattleLab: boolean;
  /** 07·红星实验设计局综合体（苏联 T2 院所）在役 */
  sovietT2Lab: boolean;
  /** 26·国家战略工程综合体／红星科学城（苏联 T3 圣地）在役 */
  sovietT3Sanctuary: boolean;
  /** 13·盟军战斗实验室（盟军 T2 院所）在役 */
  alliedT2Lab: boolean;
  /** 37·盟军联合科研与国家工程组织节点（盟军 T3 圣地）在役 */
  alliedT3Sanctuary: boolean;
  /** 08·基因测序与心灵谐振研究院（尤里 T2 院所）在役 */
  yuriT2Lab: boolean;
  /** 11·双螺旋生命工程与高维意识科学院（尤里 T3 圣地）在役 */
  yuriT3Sanctuary: boolean;
  /** 25·超算中心（算力副轴 T2）在役 */
  supercomputer: boolean;
  /** 26·量子超算中心（算力副轴 T3）在役 */
  quantumSupercomputer: boolean;
  /** 是否触发跨阵营院所并网协同（多阵营专属院所同时在役，副院所按 50% 折算） */
  crossFactionSynergy: boolean;
}

/** 协议点双轴日产速率拆解明细 */
export interface ProtocolPointRateBreakdown {
  /** 战地基础流（恒为 0.10 点/日） */
  baseRate: number;
  /** 苏联系院所原始档位速率（0 | 0.15 | 0.30，同系 T3 替代 T2） */
  sovietAxisRate: number;
  /** 盟军系院所原始档位速率（0 | 0.15 | 0.30，同系 T3 替代 T2） */
  alliedAxisRate: number;
  /** 尤里系院所原始档位速率（0 | 0.15 | 0.30，同系 T3 替代 T2） */
  yuriAxisRate: number;
  /** 通用战斗实验室独立兜底速率（当苏/盟/尤专属院所均不在场且通用战斗实验室在场时为 0.15，否则为 0） */
  commonLabFallbackRate: number;
  /** 主院所 100% 计入速率 */
  primaryInstituteRate: number;
  /** 跨阵营副院所 50% 协同并网速率 */
  secondaryInstituteRate: number;
  /** 科研院所主轴合计速率 */
  instituteAxisRate: number;
  /** 算力辅助副轴速率（0 | 0.10 | 0.25，量子超算替代普通超算） */
  computeAxisRate: number;
  /** 最终协议点日产总速率（精确到小数点后 4 位） */
  totalDailyRate: number;
  /** 是否激活跨阵营 50% 协同并网 */
  crossFactionSynergy: boolean;
  /** 底层在役建筑扫描结果 */
  scan: ActiveProtocolBuildingScan;
}

/* ═══════════════ 常量与 7 建筑数据驱动注册表（§1.6 / §3.5.1） ═══════════════ */

/** 战地基础协议点日产流速（0.10 点/日） */
export const PROTOCOL_BASE_DAILY_RATE = 0.1 as const;

/** 跨阵营第二院所并网折算系数（50%） */
export const PROTOCOL_CROSS_FACTION_SYNERGY_FACTOR = 0.5 as const;

/** 非运转基地状态集合（已废弃或失守基地的建筑不计入在役） */
export const INACTIVE_PROTOCOL_BASE_STATUSES: ReadonlySet<string> = new Set([
  '废弃',
  '失守',
  '断电',
  '瘫痪',
  '损毁',
  '离线',
]);

/** 非运转建筑状态集合（过滤损毁/受损/停机/离线/断电/瘫痪/建造中/摧毁等非运转状态） */
export const INACTIVE_PROTOCOL_BUILDING_STATES: ReadonlySet<string> = new Set([
  '建造中',
  '损毁',
  '受损',
  '停机',
  '离线',
  '断电',
  '瘫痪',
  '摧毁',
]);

/**
 * 全库 7 座核心科研/算力建筑精确底账注册表（§1.6 / D-P8b/8c / D-P26）
 */
export const PROTOCOL_ANCHOR_BUILDINGS: readonly ProtocolAnchorBuildingDef[] = Object.freeze([
  {
    id: 'bld.common.battle_lab',
    name: '战斗实验室',
    comment: '07·战斗实验室',
    faction: '通用',
    axis: 'institute',
    tier: 2,
    dailyRate: 0.15,
    anchorNames: ['战斗实验室'],
    excludeNames: ['盟军战斗实验室', '苏联战斗实验室'],
  },
  {
    id: 'bld.soviet.red_star_design_bureau',
    name: '红星实验设计局综合体',
    comment: '07·红星实验设计局综合体',
    faction: '苏联',
    axis: 'institute',
    tier: 2,
    dailyRate: 0.15,
    anchorNames: ['红星实验设计局综合体', '红星实验设计局', '苏联战斗实验室', '苏联作战实验室'],
  },
  {
    id: 'bld.soviet.red_star_science_city',
    name: '国家战略工程综合体／红星科学城',
    comment: '26·国家战略工程综合体／红星科学城',
    faction: '苏联',
    axis: 'institute',
    tier: 3,
    dailyRate: 0.3,
    anchorNames: [
      '国家战略工程综合体／红星科学城',
      '国家战略工程综合体/红星科学城',
      '国家战略工程综合体',
      '红星科学城',
    ],
  },
  {
    id: 'bld.allied.battle_lab',
    name: '盟军战斗实验室',
    comment: '13·盟军战斗实验室',
    faction: '盟军',
    axis: 'institute',
    tier: 2,
    dailyRate: 0.15,
    anchorNames: ['盟军战斗实验室'],
  },
  {
    id: 'bld.allied.joint_research_organization_node',
    name: '盟军联合科研与国家工程组织节点',
    comment: '37·盟军联合科研与国家工程组织节点',
    faction: '盟军',
    axis: 'institute',
    tier: 3,
    dailyRate: 0.3,
    anchorNames: ['盟军联合科研与国家工程组织节点', '联合科研与国家工程组织节点'],
  },
  {
    id: 'bld.yuri.gene_psychic_institute',
    name: '基因测序与心灵谐振研究院',
    comment: '08·基因测序与心灵谐振研究院',
    faction: '尤里',
    axis: 'institute',
    tier: 2,
    dailyRate: 0.15,
    anchorNames: ['基因测序与心灵谐振研究院', '尤里心灵研究实验室', '尤里作战实验室'],
  },
  {
    id: 'bld.yuri.double_helix_academy',
    name: '双螺旋生命工程与高维意识科学院',
    comment: '11·双螺旋生命工程与高维意识科学院',
    faction: '尤里',
    axis: 'institute',
    tier: 3,
    dailyRate: 0.3,
    anchorNames: ['双螺旋生命工程与高维意识科学院', '双螺旋生命科学院'],
  },
  {
    id: 'bld.common.supercomputing_center',
    name: '超算中心',
    comment: '25·超算中心',
    faction: '通用',
    axis: 'compute',
    tier: 2,
    dailyRate: 0.1,
    anchorNames: ['超算中心'],
    excludeNames: ['量子超算中心'],
  },
  {
    id: 'bld.common.quantum_supercomputing_center',
    name: '量子超算中心',
    comment: '26·量子超算中心',
    faction: '通用',
    axis: 'compute',
    tier: 3,
    dailyRate: 0.25,
    anchorNames: ['量子超算中心'],
  },
]);

/** 与 researchSlots.ts 同源对齐的锚点词表导出（供交叉核验） */
export { resolveMaxTechTier, TECH_TIER_T2_ANCHORS, TECH_TIER_T3_ANCHORS };

/* ═══════════════ 扫描与匹配辅助函数 ═══════════════ */

function roundRate4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** 判定基地是否处于可运转状态（过滤已废弃/失守等状态） */
export function isBaseOperationalForProtocol(base: { status?: string } | null | undefined): boolean {
  if (!base) return false;
  if (typeof base.status === 'string' && INACTIVE_PROTOCOL_BASE_STATUSES.has(base.status.trim())) {
    return false;
  }
  return true;
}

/** 判定单座建筑是否处于在场且运转状态（过滤建造中/损毁/停机/离线/断电/瘫痪等非运转状态） */
export function isProtocolBuildingOperational(building: { name?: string; state?: string } | null | undefined): boolean {
  if (!building || typeof building.name !== 'string') return false;
  const trimmedName = building.name.trim();
  if (!trimmedName) return false;
  if (typeof building.state === 'string') {
    const trimmedState = building.state.trim();
    if (trimmedState && INACTIVE_PROTOCOL_BUILDING_STATES.has(trimmedState)) {
      return false;
    }
  }
  return true;
}

/** 判定建筑名是否匹配指定注册表建筑定义 */
export function matchesProtocolAnchorBuilding(buildingName: string, def: ProtocolAnchorBuildingDef): boolean {
  if (!buildingName) return false;
  if (def.excludeNames?.some(ex => buildingName.includes(ex))) {
    return false;
  }
  return def.anchorNames.some(anchor => buildingName.includes(anchor));
}

/**
 * 扫描当前状态中所有在场且正常运转的协议锚定建筑与原始在役建筑名
 */
export function scanActiveProtocolBuildings(
  state: ProtocolAnchorStateView | null | undefined,
): ActiveProtocolBuildingScan {
  const rawBuildingNames: string[] = [];
  const matchedIds = new Set<ProtocolAnchorBuildingId>();

  for (const base of state?.bases ?? []) {
    if (!isBaseOperationalForProtocol(base)) continue;
    for (const building of base.buildings ?? []) {
      if (!isProtocolBuildingOperational(building)) continue;
      rawBuildingNames.push(building.name);
      for (const def of PROTOCOL_ANCHOR_BUILDINGS) {
        if (matchesProtocolAnchorBuilding(building.name, def)) {
          matchedIds.add(def.id);
        }
      }
    }
  }

  const buildings = PROTOCOL_ANCHOR_BUILDINGS.filter(def => matchedIds.has(def.id));
  const commonBattleLab = matchedIds.has('bld.common.battle_lab');
  const sovietT2Lab = matchedIds.has('bld.soviet.red_star_design_bureau');
  const sovietT3Sanctuary = matchedIds.has('bld.soviet.red_star_science_city');
  const alliedT2Lab = matchedIds.has('bld.allied.battle_lab');
  const alliedT3Sanctuary = matchedIds.has('bld.allied.joint_research_organization_node');
  const yuriT2Lab = matchedIds.has('bld.yuri.gene_psychic_institute');
  const yuriT3Sanctuary = matchedIds.has('bld.yuri.double_helix_academy');
  const supercomputer = matchedIds.has('bld.common.supercomputing_center');
  const quantumSupercomputer = matchedIds.has('bld.common.quantum_supercomputing_center');

  const hasSovietExclusive = sovietT2Lab || sovietT3Sanctuary;
  const hasAlliedExclusive = alliedT2Lab || alliedT3Sanctuary;
  const hasYuriExclusive = yuriT2Lab || yuriT3Sanctuary;
  const exclusiveFactionCount =
    (hasSovietExclusive ? 1 : 0) + (hasAlliedExclusive ? 1 : 0) + (hasYuriExclusive ? 1 : 0);
  const crossFactionSynergy = exclusiveFactionCount >= 2;

  return {
    buildings,
    buildingIds: matchedIds,
    rawBuildingNames,
    commonBattleLab,
    sovietT2Lab,
    sovietT3Sanctuary,
    alliedT2Lab,
    alliedT3Sanctuary,
    yuriT2Lab,
    yuriT3Sanctuary,
    supercomputer,
    quantumSupercomputer,
    crossFactionSynergy,
  };
}

/**
 * 判定给定候选建筑名列表（如 protocol.discovery.building_any）中是否有任一建筑在场且运转
 */
export function isAnyBuildingOperationalInState(
  state: ProtocolAnchorStateView | null | undefined,
  candidateNames: readonly string[],
): boolean {
  if (!candidateNames || candidateNames.length === 0) return true;
  const scan = scanActiveProtocolBuildings(state);
  if (scan.rawBuildingNames.length === 0) return false;

  return candidateNames.some(candidate => {
    const trimmed = candidate.trim();
    if (!trimmed) return false;
    // 若候选名对应 7 座核心建筑之一，按精确注册表规则匹配（防止「战斗实验室」误判或漏判）
    const anchorDef = PROTOCOL_ANCHOR_BUILDINGS.find(
      def => def.id === trimmed || def.name === trimmed || def.anchorNames.includes(trimmed),
    );
    if (anchorDef) {
      if (anchorDef.id === 'bld.common.battle_lab') {
        // 通用「战斗实验室」在 discovery.building_any 中也可由在役通用战斗实验室满足
        return scan.commonBattleLab || scan.rawBuildingNames.some(n => n.includes('战斗实验室'));
      }
      return scan.buildingIds.has(anchorDef.id);
    }
    return scan.rawBuildingNames.some(activeName => activeName.includes(trimmed));
  });
}

/* ═══════════════ 阵营对口 Tier 准入纯函数（D-P8b） ═══════════════ */

function normalizeFactionKind(faction: string | undefined | null): 'soviet' | 'allied' | 'yuri' | 'common' {
  if (typeof faction !== 'string') return 'common';
  const normalized = faction.trim().toLowerCase();
  if (normalized === '苏联' || normalized === '苏军' || normalized === 'soviet' || normalized === 'sov') {
    return 'soviet';
  }
  if (normalized === '盟军' || normalized === 'allied' || normalized === 'all') {
    return 'allied';
  }
  if (normalized === '尤里' || normalized === 'yuri' || normalized === 'yur') {
    return 'yuri';
  }
  return 'common';
}

/**
 * 阵营对口科研院所 Tier 准入纯函数（§3.5.1 / D-P8b / FD-26）：
 * - Stage 0（无对口实验室）：返回 1（仅开放 Tier 1 协议）；
 * - 苏联协议（'苏联' | 'soviet'）：
 *   · 国家战略工程综合体／红星科学城 在场运转 → 3
 *   · 红星实验设计局综合体 或 通用战斗实验室 在场运转 → 2
 *   · 否则 → 1（盟军/尤里院所、超算/量子超算绝不可代解锁苏联 T2/T3！）
 * - 盟军协议（'盟军' | 'allied'）：
 *   · 盟军联合科研与国家工程组织节点 在场运转 → 3
 *   · 盟军战斗实验室 或 通用战斗实验室 在场运转 → 2
 *   · 否则 → 1（苏联/尤里院所、超算/量子超算绝不可代解锁盟军 T2/T3！）
 * - 尤里协议（'尤里' | 'yuri'）：
 *   · 双螺旋生命工程与高维意识科学院 在场运转 → 3
 *   · 基因测序与心灵谐振研究院 或 通用战斗实验室 在场运转 → 2
 *   · 否则 → 1（苏联/盟军院所、超算/量子超算绝不可代解锁尤里 T2/T3！）
 * - 通用/未指定阵营：返回苏/盟/尤三系最高院所 Tier。
 */
function isActiveProtocolBuildingScan(value: unknown): value is ActiveProtocolBuildingScan {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'commonBattleLab' in value &&
      'sovietT2Lab' in value &&
      'alliedT2Lab' in value,
  );
}

export function factionLabTier(
  stateOrScan: ProtocolAnchorStateView | ActiveProtocolBuildingScan | null | undefined,
  faction?: string | null,
): 1 | 2 | 3 {
  const scan = isActiveProtocolBuildingScan(stateOrScan) ? stateOrScan : scanActiveProtocolBuildings(stateOrScan);
  const sovietTier: 1 | 2 | 3 = scan.sovietT3Sanctuary ? 3 : scan.sovietT2Lab || scan.commonBattleLab ? 2 : 1;
  const alliedTier: 1 | 2 | 3 = scan.alliedT3Sanctuary ? 3 : scan.alliedT2Lab || scan.commonBattleLab ? 2 : 1;
  const yuriTier: 1 | 2 | 3 = scan.yuriT3Sanctuary ? 3 : scan.yuriT2Lab || scan.commonBattleLab ? 2 : 1;

  const kind = normalizeFactionKind(faction);
  if (kind === 'soviet') return sovietTier;
  if (kind === 'allied') return alliedTier;
  if (kind === 'yuri') return yuriTier;
  const maxTier = Math.max(sovietTier, alliedTier, yuriTier) as 1 | 2 | 3;
  if (
    scan.quantumSupercomputer &&
    typeof faction === 'string' &&
    (faction.trim() === '通用' || faction.trim().toLowerCase() === 'common')
  ) {
    return 3;
  }
  return maxTier;
}

/**
 * 判定给定阵营与协议目标 Tier 是否已在当前建筑状态下解锁对口科研院所准入
 */
export function isProtocolTierUnlockedByBuildings(
  stateOrScan: ProtocolAnchorStateView | ActiveProtocolBuildingScan | null | undefined,
  faction: string | undefined | null,
  requiredTier: number,
): boolean {
  if (requiredTier <= 1) return true;
  return factionLabTier(stateOrScan, faction) >= requiredTier;
}

/* ═══════════════ 双轴协议点日产速率纯函数（D-P8c） ═══════════════ */

/**
 * 计算协议点双轴日产速率拆解明细（§3.5.1 / D-P8c / FD-26）：
 * 1. 战地基础流：恒为 0.10 点/日；
 * 2. 科研院所主轴：
 *    - 同阵营内部 T3 圣地替代 T2 院所（苏：红星科学城 0.30 > 红星实验设计局 0.15；盟：盟军联合科研节点 0.30 > 盟军战斗实验室 0.15；尤：双螺旋科学院 0.30 > 基因与心灵研究院 0.15）；
 *    - 跨阵营并存时：主院所（贡献最高的一系）100% 计入，其余非零阵营院所按 50% 跨系协同并网；
 *    - 若无专属院所，但通用「战斗实验室」在场运转，则单独计入 0.15 点/日（不重复多计入各系）；
 * 3. 算力辅助副轴（全局共享，与主轴直接叠加，量子超算替代普通超算）：
 *    - 量子超算中心在场运转：+0.25 点/日；
 *    - 否则若超算中心在场运转：+0.10 点/日。
 */
export function resolveProtocolPointBreakdown(
  state: ProtocolAnchorStateView | null | undefined,
): ProtocolPointRateBreakdown {
  const scan = scanActiveProtocolBuildings(state);
  const baseRate = PROTOCOL_BASE_DAILY_RATE;

  const sovietAxisRate = scan.sovietT3Sanctuary ? 0.3 : scan.sovietT2Lab ? 0.15 : 0;
  const alliedAxisRate = scan.alliedT3Sanctuary ? 0.3 : scan.alliedT2Lab ? 0.15 : 0;
  const yuriAxisRate = scan.yuriT3Sanctuary ? 0.3 : scan.yuriT2Lab ? 0.15 : 0;

  let commonLabFallbackRate = 0;
  let primaryInstituteRate = 0;
  let secondaryInstituteRate = 0;

  const activeFactionRates = [sovietAxisRate, alliedAxisRate, yuriAxisRate]
    .filter(rate => rate > 0)
    .sort((a, b) => b - a);

  if (activeFactionRates.length >= 2) {
    primaryInstituteRate = activeFactionRates[0];
    const restSum = activeFactionRates.slice(1).reduce((sum, rate) => sum + rate, 0);
    secondaryInstituteRate = roundRate4(restSum * PROTOCOL_CROSS_FACTION_SYNERGY_FACTOR);
  } else if (activeFactionRates.length === 1) {
    primaryInstituteRate = activeFactionRates[0];
  } else if (scan.commonBattleLab) {
    commonLabFallbackRate = 0.15;
    primaryInstituteRate = 0.15;
  }

  const instituteAxisRate = roundRate4(primaryInstituteRate + secondaryInstituteRate);
  const computeAxisRate = scan.quantumSupercomputer ? 0.25 : scan.supercomputer ? 0.1 : 0;
  const totalDailyRate = roundRate4(baseRate + instituteAxisRate + computeAxisRate);

  return {
    baseRate,
    sovietAxisRate,
    alliedAxisRate,
    yuriAxisRate,
    commonLabFallbackRate,
    primaryInstituteRate,
    secondaryInstituteRate,
    instituteAxisRate,
    computeAxisRate,
    totalDailyRate,
    crossFactionSynergy: scan.crossFactionSynergy,
    scan,
  };
}

/**
 * 计算当前状态下协议点日产速率（点/日，精确到小数点后 4 位）
 */
export function dailyProtocolPointRate(state: ProtocolAnchorStateView | null | undefined): number {
  return resolveProtocolPointBreakdown(state).totalDailyRate;
}

export const resolveDailyProtocolPointRate = dailyProtocolPointRate;
