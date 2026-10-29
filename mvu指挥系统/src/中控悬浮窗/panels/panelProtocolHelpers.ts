import { factionLabTier, resolveProtocolPointBreakdown } from '../../红警指挥系统/engines/protocolAnchors';
import { isDebugBypassPrerequisitesActive } from '../../红警指挥系统/composables/useDebugMode';
import {
  getNextBreakthroughProbPercent,
  getProtocolExperimentCost,
  isProtocolLabOnline,
  normalizeProtocolTier,
} from '../../红警指挥系统/engines/protocolEngine';
import type { ProtocolDiscoverySpec } from '../../红警指挥系统/engines/protocolEngine';
import {
  ALLIED_TRACK_NAMES,
  COMMON_TRACK_NAMES,
  DEFAULT_PROTOCOL_CATALOG,
  lookupProtocolCatalogEntry,
  mergeDefaultProtocolCatalog,
  normalizeProtocolLookupKey,
  SOVIET_TRACK_NAMES,
} from '../../红警指挥系统/engines/protocolCatalogIndex';
import type { ProtocolCatalogLookup } from '../../红警指挥系统/engines/protocolCatalogIndex';
import {
  buildProtocolExperimentCommand, buildProtocolScheduleCommand, canToggleProtocolAutoQueue,
  evaluateProtocolExperimentGuard, reorderProtocolAutoQueue, resolveStateGameDay,
  sortProtocolAutoQueue, stageProtocolCommandToTextarea,
} from '../models/protocolCommands';
import type {
  ProtocolAutoQueueItemView, ProtocolCommandStagedEvent, ProtocolCommandStateView,
  ProtocolExperimentGuardResult, ProtocolScheduleAction, ProtocolScheduleDispatchEvent,
} from '../models/protocolCommands';

export { COMMON_TRACK_NAMES };
export type InstituteTheme = 'common' | 'soviet' | 'allied' | 'yuri';
export type ProtocolStatusType = 'undiscovered' | 'locked' | 'available' | 'experimenting' | 'active' | 'voided';

export const COMMON_INSTITUTE_DISPLAY_TITLE = '◆ 通用联合条令总署' as const;
export const YURI_INSTITUTE_DISPLAY_TITLE = '◆ 尤里认知与生物工程督导院' as const;

export const YURI_TRACK_NAMES: readonly string[] = Object.freeze([
  '神经过载与心控协同',
  '生物机电与夺舍工程',
  '磁流谐振与特种攻城',
]);

export const DEFAULT_YURI_PROTOCOL_CATALOG: readonly ProtocolCatalogEntry[] = Object.freeze([
  // 轨道一：神经过载与心控协同
  {
    id: 'yuri.protocol.t1.clone_tower_neuro_link',
    name: '复制人—心灵控制塔神经并联增幅协议',
    faction: '尤里',
    track: '神经过载与心控协同',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '授权尤里复制人驻入心灵控制塔基座插槽充当湿件协处理器，提升心控容量与射程。',
  },
  {
    id: 'yuri.protocol.t1.puppet_adrenaline_override',
    name: '受控傀儡痛觉屏蔽与肾上腺素榨取协议',
    faction: '尤里',
    track: '神经过载与心控协同',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '刺激第1阶受控敌军肾上腺素分泌，抹平生理抗拒降效并短时提升冲刺移速。',
  },
  {
    id: 'yuri.protocol.t2.mastermind_coolant_overclock',
    name: '精神控制车冷媒过载与牧羊人并机分流协议',
    faction: '尤里',
    track: '神经过载与心控协同',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '授权牧羊人湿件工程车与精神控制车液氮并机，将安全受控阈值从 3 临时推高至 5。',
  },
  {
    id: 'yuri.protocol.t3.dominator_biphase_overload',
    name: '心灵支配仪·双相极限过载与死士殉爆协议',
    faction: '尤里',
    track: '神经过载与心控协同',
    tier: 3,
    cost_points: 1,
    experiment_cost_credits: 4000,
    desc: '授权心灵支配仪在次声波震荡扩域与终焉神经元殉爆两项排他极限工况中切换。',
  },
  // 轨道二：生物机电与夺舍工程
  {
    id: 'yuri.protocol.t1.scarab_dual_mission_pack',
    name: '采掘机械虫—野战抢修与破履带双任务包协议',
    faction: '尤里',
    track: '生物机电与夺舍工程',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '赋予机动熔炼采矿母车释放的六足采掘机械虫野战焊补与破甲铰断履带双模能力。',
  },
  {
    id: 'yuri.protocol.t1.virus_hallucinogen_ammo',
    name: '生化狙击手—致幻气溶胶微囊弹换装协议',
    faction: '尤里',
    track: '生物机电与夺舍工程',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '授权生化特种狙击手换装浓缩致幻狂乱微囊弹，超视距诱发敌方班组惊恐溃乱。',
  },
  {
    id: 'yuri.protocol.t2.brute_myofiber_unleash',
    name: '巨像级重装破城兵—肌束极限解限与打桩机超压协议',
    faction: '尤里',
    track: '生物机电与夺舍工程',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '授权巨像级重装破城兵解开安全神经锁并超压驱动液压破拆剪与聚能打桩机。',
  },
  {
    id: 'yuri.protocol.t2.hotwire_field_requisition',
    name: '战地火线夺车与异制式火控快速接管协议',
    faction: '尤里',
    track: '生物机电与夺舍工程',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '授权冥蝠滑翔工兵携便携式 IFF 破译匣滑翔夺取无主完好敌方装甲载具并火线刷机。',
  },
  {
    id: 'yuri.protocol.t2.mobile_mutator_shepherd_berserk_storm',
    name: '机动基因谐振突变车—牧羊人恒温并机与狂兽化风暴协议',
    faction: '尤里',
    track: '生物机电与夺舍工程',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '专职联动机动基因谐振突变车与牧羊人脑波中继工程车恒温并机，释放满功率双螺旋崩解—狂兽化诱导风暴。',
  },
  // 轨道三：磁流谐振与特种攻城
  {
    id: 'yuri.protocol.t1.gatling_phased_grid_sync',
    name: '盖特伺服电机—防空火控相控并网协议',
    faction: '尤里',
    track: '磁流谐振与特种攻城',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '将盖特机炮塔、盖特坦克与海妖护卫舰伺服电机并入心灵感应器预警网协同拦截。',
  },
  {
    id: 'yuri.protocol.t2.boomer_turtleback_payloads',
    name: '雷鸣潜艇—龟背多载荷特种攻城弹头换装协议',
    faction: '尤里',
    track: '磁流谐振与特种攻城',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '为雷鸣攻城潜艇龟背 8 坑大型发射井开放二元神经腐蚀弹头与强磁脉冲弹头换装。',
  },
  {
    id: 'yuri.protocol.t2.magnetron_disk_flux_relay',
    name: '磁电坦克—飞碟强磁耦合与超视距隔山牵引协议',
    faction: '尤里',
    track: '磁流谐振与特种攻城',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '授权地面磁电坦克与高空镭射幽浮建立强磁通天地中继，实现跨掩体超视距牵引。',
  },
  {
    id: 'yuri.protocol.t3.eclipse_orbital_reentry',
    name: '受库存与轨道电容约束的「月蚀」天基脑波再入协议',
    faction: '尤里',
    track: '磁流谐振与特种攻城',
    tier: 3,
    cost_points: 1,
    experiment_cost_credits: 4000,
    desc: '在轨道电容与战略库存约束下调用「月蚀」近地轨道脑波折射环与母型飞碟再入投送。',
  },
]);

export interface ProtocolRuntimeEntry {
  ref: string;
  status?: ProtocolStatusType | string;
  attempts?: number;
  exp?: number;
  points_spent?: number;
  credits_spent?: number;
  auto_queued?: boolean;
  queue_order?: number;
  hold?: boolean;
  track?: string;
  faction?: string;
  name?: string;
  tier?: 1 | 2 | 3;
  reveals?: readonly string[];
}

export interface ProtocolCatalogEntry {
  id: string;
  name: string;
  faction: '苏联' | '盟军' | '尤里' | string;
  track: string;
  tier: 1 | 2 | 3;
  cost_points?: number;
  experiment_cost_credits?: number;
  reveals?: readonly string[];
  desc?: string;
  discovery?: ProtocolDiscoverySpec;
}

export interface ProtocolCompatibleState {
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
  credits?: number;
  bases?: ReadonlyArray<{
    id?: string;
    name?: string;
    status?: string;
    buildings?: ReadonlyArray<{ name: string; state?: string }>;
  }>;
  tech?: {
    done?: readonly string[];
  };
  protocols?: ReadonlyArray<ProtocolRuntimeEntry>;
  protocol_points?: number;
}

export interface ProtocolGridStatus {
  commonBattleLab: boolean;
  sovietT2Lab: boolean;
  sovietT3Sanctuary: boolean;
  alliedT2Lab: boolean;
  alliedT3Sanctuary: boolean;
  yuriT2Lab?: boolean;
  yuriT3Sanctuary?: boolean;
  supercomputer: boolean;
  quantumSupercomputer: boolean;
  crossFactionSynergy: boolean;
}

export interface InstituteStageInfo {
  stage: 0 | 1 | 2;
  tier: 1 | 2 | 3;
  title: string;
  subtitle: string;
}

export interface ProtocolNodeView {
  id: string;
  name: string;
  faction: string;
  track: string;
  tier: 1 | 2 | 3;
  status: ProtocolStatusType;
  exp: number;
  attempts: number;
  costPoints: number;
  costCredits: number;
  reveals: readonly string[];
  desc: string;
  nextProb: number;
  pointsSpent: number;
  creditsSpent: number;
  autoQueued: boolean;
  queueOrder?: number;
  hold: boolean;
  discovery?: ProtocolDiscoverySpec;
}

export interface ProtocolTrackView {
  name: string;
  faction: '苏联' | '盟军' | '尤里';
  nodes: ProtocolNodeView[];
  activeCount: number;
  totalCount: number;
}

export interface LocalQueueOverride {
  autoQueued: boolean;
  queueOrder?: number;
  hold: boolean;
}

export interface ProtocolStagedReceiptView {
  kind: 'experiment' | 'schedule';
  protocolId: string;
  protocolName: string;
  outcome?: 'breakthrough' | 'accumulated';
  nextAttempt?: number;
  nextExp?: number;
  channel: 'textarea' | 'memory';
  title: string;
  commandText: string;
}

/* ═══════════════ 院所头衔映射与产点空态计算 ═══════════════ */

export function resolveSovietInstituteInfo(g: ProtocolGridStatus): InstituteStageInfo {
  if (g.sovietT3Sanctuary) {
    return {
      stage: 2,
      tier: 3,
      title: '◆ 国家战略工程综合体 · 红星科学城 [T3]',
      subtitle: '红星科学城运转中 · 开放 T1~T3 全部机密条令与核战略条令',
    };
  }
  if (g.sovietT2Lab || g.commonBattleLab) {
    return {
      stage: 1,
      tier: 2,
      title: '◆ 红星实验设计局综合体 [T2]',
      subtitle: '实验设计局运转中 · 开放 T1~T2 机密条令（升至 T3 需建红星科学城）',
    };
  }
  return {
    stage: 0,
    tier: 1,
    title: '◆ 苏联前线参谋部 [T1]',
    subtitle: '战地参谋部编制 · 仅开放 T1 基础条令（升至 T2 需建红星实验设计局或战斗实验室）',
  };
}

export function resolveAlliedInstituteInfo(g: ProtocolGridStatus): InstituteStageInfo {
  if (g.alliedT3Sanctuary) {
    return {
      stage: 2,
      tier: 3,
      title: '◆ 盟军联合科研与国家工程组织节点 [T3]',
      subtitle: '联合科研总署运转中 · 开放盟军 T1~T3 全部防务条约与尖端条令',
    };
  }
  if (g.alliedT2Lab || g.commonBattleLab) {
    return {
      stage: 1,
      tier: 2,
      title: '◆ 盟军战斗实验室 [T2]',
      subtitle: '战斗实验室运转中 · 开放盟军 T1~T2 跨国联合防务条约攻关',
    };
  }
  return {
    stage: 0,
    tier: 1,
    title: '◆ 盟军战区联络处 [T1]',
    subtitle: '战区联络处编制 · 仅开放 T1 基础条令（升至 T2 需建盟军战斗实验室或通用战斗实验室）',
  };
}

export function resolveYuriInstituteInfo(g: ProtocolGridStatus): InstituteStageInfo {
  if (g.yuriT3Sanctuary) {
    return {
      stage: 2,
      tier: 3,
      title: '◆ 双螺旋生命工程与高维意识科学院 [T3]',
      subtitle: '◆ 尤里认知与生物工程督导院 · 双螺旋科学院运转中 · 开放 T1~T3 全部认知与生物工程条令',
    };
  }
  if (g.yuriT2Lab || g.commonBattleLab) {
    return {
      stage: 1,
      tier: 2,
      title: '◆ 基因测序与心灵谐振研究院 [T2]',
      subtitle: '◆ 尤里认知与生物工程督导院 · 基因与心灵研究院运转中 · 开放 T1~T2 条令（升至 T3 需建双螺旋生命工程与高维意识科学院）',
    };
  }
  return {
    stage: 0,
    tier: 1,
    title: '◆ 尤里认知与生物工程督导院 [T1]',
    subtitle: '认知与生物工程督导院编制 · 仅开放 T1 基础条令（升至 T2 需建基因测序与心灵谐振研究院或通用战斗实验室）',
  };
}

export function resolveCommonInstituteInfo(g: ProtocolGridStatus): InstituteStageInfo {
  if (g.sovietT3Sanctuary || g.alliedT3Sanctuary || g.yuriT3Sanctuary || g.quantumSupercomputer) {
    return {
      stage: 2,
      tier: 3,
      title: '◆ 最高统帅部战略管控总署 [T3]',
      subtitle: '战略科研中枢运转中 · 开放 T1~T3 全部通用工程与核常战略管控规程',
    };
  }
  if (g.commonBattleLab || g.sovietT2Lab || g.alliedT2Lab || g.yuriT2Lab) {
    return {
      stage: 1,
      tier: 2,
      title: '◆ 战区联合实验与条令中心 [T2]',
      subtitle: '战斗实验室运转中 · 开放 T1~T2 通用动员与核常管控条令（升至 T3 需建任一 T3 科学中枢或量子超算中心）',
    };
  }
  return {
    stage: 0,
    tier: 1,
    title: '◆ 战区联合作战参谋部 [T1]',
    subtitle: '联合作战参谋部编制 · 仅开放 T1 通用前沿工程与后勤条令（升至 T2 需建任一战斗实验室）',
  };
}

export function resolveInstituteInfoByFaction(
  factionOrTheme: InstituteTheme | '通用' | '苏联' | '盟军' | '尤里',
  g: ProtocolGridStatus,
): InstituteStageInfo {
  if (factionOrTheme === 'common' || factionOrTheme === '通用') return resolveCommonInstituteInfo(g);
  if (factionOrTheme === 'soviet' || factionOrTheme === '苏联') return resolveSovietInstituteInfo(g);
  if (factionOrTheme === 'yuri' || factionOrTheme === '尤里') return resolveYuriInstituteInfo(g);
  return resolveAlliedInstituteInfo(g);
}

export function formatProtocolPoints(val: number): string {
  return Number.isInteger(val) ? String(val) : val.toFixed(2).replace(/\.?0+$/, '');
}

export function formatPreciseDailyRateText(r: number): string {
  const hasMilli = Math.round(r * 1000) % 10 !== 0;
  return `+${hasMilli ? r.toFixed(3) : r.toFixed(2)} 点/日`;
}

export function shouldShowProtocolNoLabEmptyState(
  state: ProtocolCompatibleState | null | undefined,
  opts?: { totalDailyPoints?: number; hasCustomCatalogOnly?: boolean },
): boolean {
  if (isDebugBypassPrerequisitesActive()) return false;
  if (opts?.hasCustomCatalogOnly) return false;
  const breakdown = resolveProtocolPointBreakdown(state);
  const scan = breakdown.scan;
  const hasLabBuilding =
    scan.buildings.length > 0 || scan.rawBuildingNames.some(n => /实验室|设计局|科学城|科研|超算|研究院|科学院/.test(n));
  if (hasLabBuilding) return false;

  const facilityDailyPoints = breakdown.instituteAxisRate + breakdown.computeAxisRate;
  const stateRate = (state as { totalDailyPoints?: unknown } | null | undefined)?.totalDailyPoints;
  const effectiveDailyPoints =
    typeof opts?.totalDailyPoints === 'number' && Number.isFinite(opts.totalDailyPoints)
      ? opts.totalDailyPoints
      : typeof stateRate === 'number' && Number.isFinite(stateRate)
        ? stateRate
        : facilityDailyPoints;
  if (effectiveDailyPoints > 0) return false;

  const protocols = state?.protocols ?? [];
  const hasRevealedOrActiveProtocol = protocols.some(
    p =>
      p &&
      (p.status === 'available' ||
        p.status === 'experimenting' ||
        p.status === 'active' ||
        (typeof p.exp === 'number' && Number.isFinite(p.exp) && p.exp > 0) ||
        (typeof p.attempts === 'number' && Number.isFinite(p.attempts) && p.attempts > 0) ||
        Boolean(p.auto_queued)),
  );
  if (hasRevealedOrActiveProtocol) return false;

  return true;
}

export function resolveTotalDailyPoints(
  state: ProtocolCompatibleState | null | undefined,
  propTotalDailyPoints?: number,
): number {
  if (typeof propTotalDailyPoints === 'number' && Number.isFinite(propTotalDailyPoints)) {
    return propTotalDailyPoints;
  }
  const stateRate = (state as { totalDailyPoints?: unknown } | null)?.totalDailyPoints;
  if (typeof stateRate === 'number' && Number.isFinite(stateRate)) {
    return stateRate;
  }
  const breakdown = resolveProtocolPointBreakdown(state);
  return breakdown.instituteAxisRate + breakdown.computeAxisRate;
}

export function detectHasCustomCatalogOnly(catalog: unknown): boolean {
  const source = catalog as {
    protocols?: readonly ProtocolCatalogEntry[];
    effectiveCatalog?: { protocols?: readonly ProtocolCatalogEntry[] };
  };
  const fromCatalog = source?.effectiveCatalog?.protocols ?? source?.protocols;
  return Boolean(
    fromCatalog &&
      fromCatalog.length > 0 &&
      !fromCatalog.some(item => item && typeof item.id === 'string' && item.id.includes('.')),
  );
}

/* ═══════════════ 轨道目录与协议节点归并辅助 ═══════════════ */

export function normalizeReveals(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim()))]
    : [];
}

export function safeNumber(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
}

export function resolveRevealTarget(catalog: unknown, raw: string): { techId: string; techName: string } {
  const cat = catalog as {
    researches?: readonly { id?: string; name: string }[];
    dynamicCatalog?: { researches?: readonly { id?: string; name: string }[] };
  };
  const rawResearches = cat?.dynamicCatalog?.researches ?? [];
  const research = [...rawResearches, ...(cat?.researches ?? [])].find(r => r.id === raw || r.name === raw);
  return { techId: research?.id ?? raw, techName: research?.name ?? raw };
}

function checkLabOnlineWithOptionalScan(
  state: ProtocolCompatibleState | null | undefined,
  node: Pick<ProtocolNodeView, 'faction' | 'tier'>,
  gridScan?: ProtocolGridStatus,
): boolean {
  if (gridScan) {
    return factionLabTier(gridScan, node.faction) >= normalizeProtocolTier(node.tier);
  }
  return isProtocolLabOnline(state, node);
}

export function computeIsLabSealed(
  state: ProtocolCompatibleState | null | undefined,
  node: ProtocolNodeView,
  gridScan?: ProtocolGridStatus,
): boolean {
  if (isDebugBypassPrerequisitesActive()) return false;
  return node.status === 'experimenting' && !checkLabOnlineWithOptionalScan(state, node, gridScan);
}

export function computeNodeHint(
  state: ProtocolCompatibleState | null | undefined,
  activeTrackNodesOrNode: readonly ProtocolNodeView[] | ProtocolNodeView,
  maybeNode?: ProtocolNodeView,
  gridScan?: ProtocolGridStatus,
): string {
  const activeTrackNodes = Array.isArray(activeTrackNodesOrNode)
    ? activeTrackNodesOrNode
    : [activeTrackNodesOrNode as ProtocolNodeView];
  const node = (Array.isArray(activeTrackNodesOrNode) ? maybeNode : activeTrackNodesOrNode) as ProtocolNodeView;
  if (node.status === 'undiscovered') {
    if (node.discovery?.kind === 'experiment')
      return (
        '建成对应实验室后自动解锁' +
        (node.discovery.research_all?.length ? ' · 理论：' + node.discovery.research_all.join('、') : '')
      );
    return '通过战地特殊事件解锁';
  }
  if (node.status === 'active') return '◆ 已颁布生效';
  if (node.status === 'locked') {
    const previous = activeTrackNodes[activeTrackNodes.findIndex(n => n.id === node.id) - 1];
    const hints: string[] = [];
    if (previous && previous.status !== 'active') hints.push('前置协议未颁布：' + previous.name);
    if (!checkLabOnlineWithOptionalScan(state, node, gridScan))
      hints.push(
        '需 T' +
          node.tier +
          ' ' +
          (node.faction === '通用' || node.faction === 'common'
            ? node.tier === 3
              ? '任一 T3 科学中枢或量子超算中心'
              : '任一战斗实验室'
            : node.faction === '苏联'
              ? node.tier === 3
                ? '红星科学城'
                : '红星实验设计局'
              : node.faction === '尤里' || node.faction === 'yuri'
                ? node.tier === 3
                  ? '双螺旋生命工程与高维意识科学院'
                  : '基因测序与心灵谐振研究院'
                : node.tier === 3
                  ? '盟军联合科研与国家工程组织节点'
                  : '盟军战斗实验室'),
      );
    return hints.join(' · ') || '已立卷 · 附加准入条件未齐';
  }
  return node.status === 'experimenting' ? '已开展第 ' + node.attempts + ' 轮' : '就绪待实验 · 首次实验';
}

export function referencesProtocol(value: unknown, refs: ReadonlySet<string>, depth = 0): boolean {
  if (depth > 16 || !value || typeof value !== 'object') return false;
  const condition = value as { kind?: string; name?: string; conditions?: readonly unknown[] };
  if (condition.kind === 'research' && typeof condition.name === 'string') return refs.has(condition.name);
  return Array.isArray(condition.conditions) && condition.conditions.some(c => referencesProtocol(c, refs, depth + 1));
}

export function computeSelectedUnlocks(catalog: unknown, node: ProtocolNodeView | undefined) {
  if (!node) return [];
  const cat = catalog as {
    productions?: readonly unknown[];
    buildings?: readonly unknown[];
    retrofits?: readonly unknown[];
    projects?: readonly unknown[];
  };
  const refs = new Set([node.id, node.name]);
  const pools = [cat?.productions, cat?.buildings, cat?.retrofits, cat?.projects];
  return pools
    .flatMap(pool => (pool ?? []) as readonly unknown[])
    .filter(
      (
        entry,
      ): entry is {
        name: string;
        research?: string | readonly string[];
        prereqs?: readonly string[];
        requirements?: unknown;
      } => {
        if (!entry || typeof entry !== 'object') return false;
        const e = entry as {
          name?: string;
          research?: string | readonly string[];
          prereqs?: readonly string[];
          requirements?: unknown;
        };
        return (
          typeof e.name === 'string' &&
          ((typeof e.research === 'string' && refs.has(e.research)) ||
            (Array.isArray(e.research) && e.research.some(r => refs.has(r))) ||
            (Array.isArray(e.prereqs) && e.prereqs.some(r => refs.has(r))) ||
            referencesProtocol(e.requirements, refs))
        );
      },
    );
}

export function defaultCreditsByTier(tier: 1 | 2 | 3): number {
  if (tier === 3) return 4000;
  if (tier === 2) return 1500;
  return 500;
}

export interface ProtocolAttemptStepView {
  attempt: number;
  probPercent: number;
  isCurrentNext: boolean;
  isPassed: boolean;
  isGuaranteed: boolean;
}

export function buildAttemptLadderSteps(
  tier: 1 | 2 | 3,
  currentAttempts: number,
  status: ProtocolStatusType,
): ProtocolAttemptStepView[] {
  const maxAttempts = tier === 1 ? 3 : tier === 2 ? 4 : 5;
  const steps: ProtocolAttemptStepView[] = [];
  for (let i = 1; i <= maxAttempts; i++) {
    const probPercent = getNextBreakthroughProbPercent(tier, i - 1);
    steps.push({
      attempt: i,
      probPercent,
      isCurrentNext: status !== 'active' && currentAttempts + 1 === i,
      isPassed: status === 'active' || i <= currentAttempts,
      isGuaranteed: i === maxAttempts,
    });
  }
  return steps;
}

export function resolveInitialInstituteFromProps(params: {
  explicitInitial?: InstituteTheme;
  factionFilter?: string;
  unlockedFactions?: readonly string[];
}): InstituteTheme {
  const { explicitInitial, factionFilter, unlockedFactions } = params;
  if (
    factionFilter === 'common' ||
    factionFilter === 'allied' ||
    factionFilter === 'soviet' ||
    factionFilter === 'yuri'
  ) {
    return factionFilter;
  }
  if (explicitInitial === 'common') {
    return 'common';
  }
  if (explicitInitial === 'allied' || explicitInitial === 'soviet' || explicitInitial === 'yuri') {
    if (!unlockedFactions || unlockedFactions.length === 0 || unlockedFactions.includes(explicitInitial)) {
      return explicitInitial;
    }
  }
  if (unlockedFactions && unlockedFactions.length > 0) {
    const first = unlockedFactions[0];
    if (first === 'allied' || first === 'soviet' || first === 'yuri') {
      return first;
    }
  }
  return explicitInitial ?? 'soviet';
}

export function resolveMergedCatalogProtocols(catalog: unknown): readonly ProtocolCatalogEntry[] {
  const source = catalog as {
    protocols?: readonly ProtocolCatalogEntry[];
    effectiveCatalog?: { protocols?: readonly ProtocolCatalogEntry[] };
  };
  const fromCatalog = source?.effectiveCatalog?.protocols ?? source?.protocols;
  return mergeDefaultProtocolCatalog<ProtocolCatalogEntry>(
    [...DEFAULT_PROTOCOL_CATALOG, ...DEFAULT_YURI_PROTOCOL_CATALOG],
    fromCatalog,
  );
}

export function buildRuntimeProtocolMap(
  state: ProtocolCompatibleState | null | undefined,
  lookup: ProtocolCatalogLookup<ProtocolCatalogEntry>,
): Map<string, ProtocolRuntimeEntry> {
  const map = new Map<string, ProtocolRuntimeEntry>();
  for (const inst of state?.protocols ?? []) {
    if (inst && typeof inst.ref === 'string') {
      map.set(inst.ref, inst);
      const normRef = normalizeProtocolLookupKey(inst.ref);
      if (normRef) map.set(normRef, inst);
      const matched = lookupProtocolCatalogEntry(lookup, inst.ref);
      if (matched) {
        map.set(matched.id, inst);
        map.set(matched.name, inst);
      }
    }
    if (inst && typeof inst.name === 'string') {
      map.set(inst.name, inst);
      const normName = normalizeProtocolLookupKey(inst.name);
      if (normName) map.set(normName, inst);
      const matched = lookupProtocolCatalogEntry(lookup, inst.name);
      if (matched) {
        map.set(matched.id, inst);
        map.set(matched.name, inst);
      }
    }
  }
  return map;
}

export function buildLegacyTechDoneSet(
  state: ProtocolCompatibleState | null | undefined,
  lookup: ProtocolCatalogLookup<ProtocolCatalogEntry>,
): Set<string> {
  const set = new Set<string>();
  for (const raw of state?.tech?.done ?? []) {
    if (typeof raw !== 'string') continue;
    set.add(raw);
    const norm = normalizeProtocolLookupKey(raw);
    if (norm) set.add(norm);
    const matched = lookupProtocolCatalogEntry(lookup, raw);
    if (matched) {
      set.add(matched.id);
      set.add(matched.name);
    }
  }
  return set;
}

export function buildExternalQueueSignature(state: ProtocolCompatibleState | null | undefined): string {
  return (state?.protocols ?? [])
    .map(
      p =>
        `${p.ref}:${p.status ?? ''}:${p.auto_queued ? '1' : '0'}:${p.queue_order ?? ''}:${p.hold ? '1' : '0'}:${p.attempts ?? 0}:${p.exp ?? 0}`,
    )
    .join('|');
}

export function resolveNodeQueueStateFromMap(
  overrides: Readonly<Record<string, LocalQueueOverride>>,
  nodeId: string,
  status: ProtocolStatusType,
  inst?: ProtocolRuntimeEntry,
): LocalQueueOverride {
  if (status === 'active' || status === 'voided' || status === 'undiscovered') {
    return { autoQueued: false, queueOrder: undefined, hold: false };
  }
  const override = overrides[nodeId];
  if (override) {
    return override;
  }
  return {
    autoQueued: inst?.auto_queued === true,
    queueOrder:
      typeof inst?.queue_order === 'number' && Number.isFinite(inst.queue_order)
        ? Math.max(1, Math.floor(inst.queue_order))
        : undefined,
    hold: inst?.hold === true,
  };
}

export function buildRawTrackViewsForFaction(params: {
  faction: '通用' | '苏联' | '盟军' | '尤里';
  trackNames?: readonly string[];
  mergedCatalogProtocols?: readonly ProtocolCatalogEntry[];
  runtimeProtocolMap?: ReadonlyMap<string, ProtocolRuntimeEntry>;
  legacyTechDoneSet?: ReadonlySet<string>;
  activeState?: ProtocolCompatibleState | null | undefined;
  resolveQueueState?: (nodeId: string, status: ProtocolStatusType, inst?: ProtocolRuntimeEntry) => LocalQueueOverride;
}): ProtocolTrackView[] {
  const {
    faction,
    trackNames = faction === '通用'
      ? COMMON_TRACK_NAMES
      : faction === '苏联'
        ? SOVIET_TRACK_NAMES
        : faction === '尤里'
          ? YURI_TRACK_NAMES
          : ALLIED_TRACK_NAMES,
    mergedCatalogProtocols = [...DEFAULT_PROTOCOL_CATALOG, ...DEFAULT_YURI_PROTOCOL_CATALOG],
    runtimeProtocolMap = new Map(),
    legacyTechDoneSet = new Set(),
    activeState,
    resolveQueueState = (_nodeId, _status, inst) => ({
      autoQueued: inst?.auto_queued === true,
      queueOrder: inst?.queue_order,
      hold: inst?.hold === true,
    }),
  } = params;
  const defs = mergedCatalogProtocols.filter(d =>
    faction === '通用'
      ? d.faction === '通用' || d.faction === 'common' || (d as { scope?: string }).scope === 'common'
      : faction === '尤里'
        ? d.faction === '尤里' || d.faction === 'yuri'
        : d.faction === faction,
  );

  return trackNames.map(trackName => {
    const trackDefs = defs.filter(d => d.track === trackName);
    const nodes: ProtocolNodeView[] = trackDefs.map(d => {
      const inst = runtimeProtocolMap.get(d.id) ?? runtimeProtocolMap.get(d.name);
      const isLegacyDone = legacyTechDoneSet.has(d.name) || legacyTechDoneSet.has(d.id);
      let status: ProtocolStatusType = d.discovery ? 'undiscovered' : 'locked';
      if (inst?.status) {
        status = ['undiscovered', 'locked', 'available', 'experimenting', 'active', 'voided'].includes(inst.status)
          ? (inst.status as ProtocolStatusType)
          : 'locked';
      } else if (isLegacyDone) {
        status = 'active';
      }
      if (isDebugBypassPrerequisitesActive() && (status === 'undiscovered' || status === 'locked')) {
        status = 'available';
      }
      const exp = status === 'active' ? 100 : safeNumber(inst?.exp, 100);
      const attempts = Math.floor(safeNumber(inst?.attempts));
      const cost = getProtocolExperimentCost(d);
      const qState = resolveQueueState(d.id, status, inst);

      return {
        id: d.id,
        name: d.name,
        faction: d.faction,
        track: d.track,
        tier: d.tier,
        status,
        exp,
        attempts,
        costPoints: cost.costPoints,
        costCredits: cost.costCredits,
        reveals: normalizeReveals(d.reveals ?? inst?.reveals),
        desc: d.desc ?? '战区最高统帅部专向作战协议与工程条令。',
        nextProb: status === 'active' ? 100 : getNextBreakthroughProbPercent(d.tier, attempts),
        pointsSpent: safeNumber(inst?.points_spent),
        creditsSpent: safeNumber(inst?.credits_spent),
        autoQueued: qState.autoQueued,
        queueOrder: qState.queueOrder,
        hold: qState.hold,
        discovery: d.discovery,
      };
    });

    for (const inst of activeState?.protocols ?? []) {
      if (inst.track === trackName && !nodes.some(n => n.id === inst.ref || n.name === inst.ref)) {
        const tier = inst.tier ?? 1;
        const status = (inst.status as ProtocolStatusType) ?? 'locked';
        const qState = resolveQueueState(inst.ref, status, inst);
        nodes.push({
          id: inst.ref,
          name: inst.name ?? inst.ref,
          faction,
          track: trackName,
          tier,
          status,
          exp: status === 'active' ? 100 : safeNumber(inst.exp, 100),
          attempts: Math.floor(safeNumber(inst.attempts)),
          costPoints: 1,
          costCredits: defaultCreditsByTier(tier),
          reveals: normalizeReveals(inst.reveals),
          desc: '动态立卷协议条目。',
          nextProb: status === 'active' ? 100 : getNextBreakthroughProbPercent(tier, inst.attempts ?? 0),
          pointsSpent: safeNumber(inst.points_spent),
          creditsSpent: safeNumber(inst.credits_spent),
          autoQueued: qState.autoQueued,
          queueOrder: qState.queueOrder,
          hold: qState.hold,
        });
      }
    }

    const activeCount = nodes.filter(n => n.status === 'active').length;
    return {
      name: trackName,
      faction,
      nodes,
      activeCount,
      totalCount: nodes.length,
    };
  });
}

export function buildAutoQueueList(
  rawSovietTracks: readonly ProtocolTrackView[],
  rawAlliedTracks: readonly ProtocolTrackView[],
  rawYuriTracks: readonly ProtocolTrackView[] = [],
  rawCommonTracks: readonly ProtocolTrackView[] = [],
): ProtocolAutoQueueItemView[] {
  const allNodes = [
    ...rawCommonTracks.flatMap(t => t.nodes),
    ...rawSovietTracks.flatMap(t => t.nodes),
    ...rawAlliedTracks.flatMap(t => t.nodes),
    ...rawYuriTracks.flatMap(t => t.nodes),
  ];
  const sorted = sortProtocolAutoQueue(allNodes);
  return sorted.map((n, idx) => ({
    id: n.id,
    name: n.name,
    faction: n.faction,
    track: n.track,
    tier: n.tier,
    status: n.status,
    exp: n.exp,
    attempts: n.attempts,
    nextProb: n.nextProb,
    costPoints: n.costPoints,
    costCredits: n.costCredits,
    autoQueued: true,
    queueOrder: idx + 1,
    hold: n.hold,
  }));
}

export function buildNormalizedQueueOrderMap(autoQueueList: readonly ProtocolAutoQueueItemView[]): Map<string, number> {
  const map = new Map<string, number>();
  autoQueueList.forEach((item, idx) => {
    map.set(item.id, idx + 1);
  });
  return map;
}

export function attachNormalizedQueueOrdersToTracks(
  tracks: readonly ProtocolTrackView[],
  orderMap: ReadonlyMap<string, number>,
): ProtocolTrackView[] {
  return tracks.map(track => ({
    ...track,
    nodes: track.nodes.map(node => ({
      ...node,
      queueOrder: node.autoQueued ? (orderMap.get(node.id) ?? node.queueOrder ?? 1) : undefined,
    })),
  }));
}

/* ═══════════════ 实验守卫与排程动作计算 ═══════════════ */

export function evaluateNodeExperimentGuard(
  state: ProtocolCompatibleState | null | undefined,
  node: ProtocolNodeView | undefined,
  catalogProtocols: readonly ProtocolCatalogEntry[],
): ProtocolExperimentGuardResult {
  if (!node) {
    return evaluateProtocolExperimentGuard(state as unknown as ProtocolCommandStateView | null | undefined, {
      id: '',
      name: '',
      faction: '苏联',
      tier: 1,
      status: 'locked',
    });
  }
  return evaluateProtocolExperimentGuard(
    state as unknown as ProtocolCommandStateView | null | undefined,
    {
      id: node.id,
      name: node.name,
      faction: node.faction,
      track: node.track,
      tier: node.tier,
      cost_points: node.costPoints,
      experiment_cost_credits: node.costCredits,
      status: node.status,
      attempts: node.attempts,
      exp: node.exp,
    },
    {
      ref: node.id,
      status: node.status,
      attempts: node.attempts,
      exp: node.exp,
    },
    { catalogProtocols },
  );
}

export function findProtocolNodeById(
  sovietTracks: readonly ProtocolTrackView[],
  alliedTracks: readonly ProtocolTrackView[],
  protocolId: string,
  yuriTracks: readonly ProtocolTrackView[] = [],
  commonTracks: readonly ProtocolTrackView[] = [],
 ): ProtocolNodeView | undefined {
  for (const track of [...commonTracks, ...sovietTracks, ...alliedTracks, ...yuriTracks]) {
    const found = track.nodes.find(n => n.id === protocolId || n.name === protocolId);
    if (found) return found;
  }
  return undefined;
}

export function executeProtocolExperimentClick(params: {
  state: ProtocolCompatibleState | null | undefined;
  node: ProtocolNodeView | undefined;
  catalogProtocols: readonly ProtocolCatalogEntry[];
}): { eventPayload: ProtocolCommandStagedEvent; receipt: ProtocolStagedReceiptView } | null {
  const { state, node, catalogProtocols } = params;
  if (!node) return null;
  const guard = evaluateNodeExperimentGuard(state, node, catalogProtocols);
  if (!guard.enabled) return null;

  const gameDay = resolveStateGameDay(state as unknown as ProtocolCommandStateView | null | undefined);
  const built = buildProtocolExperimentCommand(
    {
      id: node.id,
      name: node.name,
      faction: node.faction,
      track: node.track,
      tier: node.tier,
      cost_points: node.costPoints,
      experiment_cost_credits: node.costCredits,
    },
    {
      ref: node.id,
      status: node.status,
      attempts: node.attempts,
      exp: node.exp,
    },
    gameDay,
  );

  const stageRes = stageProtocolCommandToTextarea(built.commandText);
  const eventPayload: ProtocolCommandStagedEvent = {
    commandText: built.commandText,
    protocolId: built.protocolId,
    outcome: built.outcome,
    nextAttempt: built.nextAttempt,
    nextExp: built.nextExp,
  };
  const receipt: ProtocolStagedReceiptView = {
    kind: 'experiment',
    protocolId: built.protocolId,
    protocolName: built.protocolName,
    outcome: built.outcome,
    nextAttempt: built.nextAttempt,
    nextExp: built.nextExp,
    channel: stageRes.channel,
    title:
      built.outcome === 'breakthrough'
        ? `◆ 已填入 #send_textarea（预判：第 ${built.nextAttempt} 轮临界突破定型 100%）`
        : `◆ 已填入 #send_textarea（预判：第 ${built.nextAttempt} 轮阶段经验积累 → ${built.nextExp}%）`,
    commandText: built.commandText,
  };
  return { eventPayload, receipt };
}

export function buildScheduleChangeDispatch(params: {
  action: ProtocolScheduleAction;
  targetNode: ProtocolNodeView;
  nextAutoQueued: boolean;
  nextOrder: number;
  nextHold: boolean;
  queueSnapshot: ProtocolAutoQueueItemView[];
}): { payload: ProtocolScheduleDispatchEvent; receipt: ProtocolStagedReceiptView } {
  const { action, targetNode, nextAutoQueued, nextOrder, nextHold, queueSnapshot } = params;
  const commandText = buildProtocolScheduleCommand({
    action,
    protocolName: targetNode.name,
    queueOrder: nextOrder,
    hold: nextHold,
    queueNames: queueSnapshot.map(item => item.name),
  });
  const stageRes = stageProtocolCommandToTextarea(commandText);
  const receipt: ProtocolStagedReceiptView = {
    kind: 'schedule',
    protocolId: targetNode.id,
    protocolName: targetNode.name,
    channel: stageRes.channel,
    title: `◆ 排程指令已填入 #send_textarea（当前候列 ${queueSnapshot.length} 项）`,
    commandText,
  };
  const payload: ProtocolScheduleDispatchEvent = {
    action,
    protocolId: targetNode.id,
    protocolName: targetNode.name,
    autoQueued: nextAutoQueued,
    queueOrder: nextOrder,
    hold: nextHold,
    commandText,
    queue: queueSnapshot,
  };
  return { payload, receipt };
}

export function computeToggleAutoQueueNext(params: {
  target: ProtocolNodeView | undefined;
  currentList: readonly ProtocolAutoQueueItemView[];
  currentOverrides: Readonly<Record<string, LocalQueueOverride>>;
}): {
  nextOverrides: Record<string, LocalQueueOverride>;
  action: 'enable' | 'disable';
  nextAutoQueued: boolean;
  nextOrder: number;
} | null {
  const { target, currentList, currentOverrides } = params;
  if (!target || !canToggleProtocolAutoQueue(target.status)) return null;
  const nextOverrides: Record<string, LocalQueueOverride> = { ...currentOverrides };

  if (target.autoQueued) {
    const remaining = currentList.filter(item => item.id !== target.id);
    nextOverrides[target.id] = { autoQueued: false, queueOrder: undefined, hold: false };
    remaining.forEach((item, idx) => {
      nextOverrides[item.id] = { autoQueued: true, queueOrder: idx + 1, hold: item.hold };
    });
    return { nextOverrides, action: 'disable', nextAutoQueued: false, nextOrder: 0 };
  }

  const nextOrder = currentList.length + 1;
  currentList.forEach((item, idx) => {
    nextOverrides[item.id] = { autoQueued: true, queueOrder: idx + 1, hold: item.hold };
  });
  nextOverrides[target.id] = { autoQueued: true, queueOrder: nextOrder, hold: false };
  return { nextOverrides, action: 'enable', nextAutoQueued: true, nextOrder };
}

export function computeMoveAutoQueueNext(params: {
  protocolId: string;
  direction: 'up' | 'down' | 'top';
  currentList: readonly ProtocolAutoQueueItemView[];
  currentOverrides: Readonly<Record<string, LocalQueueOverride>>;
}): {
  nextOverrides: Record<string, LocalQueueOverride>;
  action: ProtocolScheduleAction;
  nextOrder: number;
  nextHold: boolean;
} | null {
  const { protocolId, direction, currentList, currentOverrides } = params;
  const currentIdx = currentList.findIndex(item => item.id === protocolId);
  if (currentIdx < 0) return null;
  if ((direction === 'up' || direction === 'top') && currentIdx === 0) return null;
  if (direction === 'down' && currentIdx === currentList.length - 1) return null;

  const reordered = reorderProtocolAutoQueue(currentList, protocolId, direction);
  const nextOverrides: Record<string, LocalQueueOverride> = { ...currentOverrides };
  reordered.forEach((item, idx) => {
    nextOverrides[item.id] = { autoQueued: true, queueOrder: idx + 1, hold: item.hold };
  });
  const updatedEntry = reordered.find(item => item.id === protocolId);
  const actionMap: Record<'up' | 'down' | 'top', ProtocolScheduleAction> = {
    up: 'move_up',
    down: 'move_down',
    top: 'move_top',
  };
  return {
    nextOverrides,
    action: actionMap[direction],
    nextOrder: updatedEntry?.queueOrder ?? 1,
    nextHold: updatedEntry?.hold ?? false,
  };
}

export function computeToggleAutoQueueHoldNext(params: {
  protocolId: string;
  target: ProtocolNodeView | undefined;
  currentList: readonly ProtocolAutoQueueItemView[];
  currentOverrides: Readonly<Record<string, LocalQueueOverride>>;
}): {
  nextOverrides: Record<string, LocalQueueOverride>;
  action: 'hold' | 'resume';
  nextOrder: number;
  nextHold: boolean;
} | null {
  const { protocolId, target, currentList, currentOverrides } = params;
  if (!target || !target.autoQueued) return null;
  const entry = currentList.find(item => item.id === protocolId);
  if (!entry) return null;

  const nextHold = !entry.hold;
  const nextOverrides: Record<string, LocalQueueOverride> = { ...currentOverrides };
  currentList.forEach((item, idx) => {
    nextOverrides[item.id] = {
      autoQueued: true,
      queueOrder: idx + 1,
      hold: item.id === protocolId ? nextHold : item.hold,
    };
  });
  return {
    nextOverrides,
    action: nextHold ? 'hold' : 'resume',
    nextOrder: entry.queueOrder,
    nextHold,
  };
}

export function statusLabel(status: ProtocolStatusType): string {
  switch (status) {
    case 'undiscovered':
      return '机密未启封';
    case 'locked':
      return '准入未齐';
    case 'available':
      return '待立项实验';
    case 'experimenting':
      return '实验攻关中';
    case 'active':
      return '已定型颁布';
    case 'voided':
      return '互斥封存';
    default:
      return status;
  }
}
