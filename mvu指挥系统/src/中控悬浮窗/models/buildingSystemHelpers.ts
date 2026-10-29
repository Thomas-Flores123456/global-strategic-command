/**
 * buildingSystemHelpers.ts —— 基地建筑五大体系类型定义、蓝图节点/连线常量、分类与指标计算辅助
 */
import { CONYARD_ORIGIN_NAMES } from './tagTaxonomy';

export type BuildingSystemId = 'military' | 'defense' | 'agro' | 'industry' | 'research_space';
export type BuildingScopeMode = 'base' | 'global';
export type BuildingFactionFilter = 'all' | 'allied' | 'soviet' | 'yuri' | (string & {});
export type BuildingNodeState = 'built' | 'building' | 'unlocked' | 'locked';
export type DefenseRing = 'far' | 'mid' | 'near' | 'core';
export type AgroStage = 'base' | 'primary' | 'process' | 'recycle';

export interface BuildingFactionOption {
  id: string;
  label: string;
  shortBadge: string;
  accentColor: string;
  bgWeak: string;
  borderColor: string;
}

const BUILTIN_FACTION_OPTIONS: readonly BuildingFactionOption[] = [
  {
    id: 'all',
    label: '全部阵营',
    shortBadge: '全',
    accentColor: '#38bdf8',
    bgWeak: 'rgba(56,189,248,0.18)',
    borderColor: '#38bdf8',
  },
  {
    id: 'allied',
    label: '盟军体系',
    shortBadge: '盟',
    accentColor: '#38bdf8',
    bgWeak: 'rgba(12,74,110,0.45)',
    borderColor: '#38bdf8',
  },
  {
    id: 'soviet',
    label: '苏联体系',
    shortBadge: '苏',
    accentColor: '#ef4444',
    bgWeak: 'rgba(127,29,29,0.5)',
    borderColor: '#ef4444',
  },
  {
    id: 'yuri',
    label: '尤里体系',
    shortBadge: '尤',
    accentColor: '#a855f7',
    bgWeak: 'rgba(88,28,135,0.5)',
    borderColor: '#a855f7',
  },
];

/**
 * 归一化建筑阵营筛选或阵营标识：
 * - 'all' / '全部' / '全部阵营' -> 'all'
 * - 'common' / '通用' / '公共' -> 'common'
 * - 'allied' / '盟军' -> 'allied'
 * - 'soviet' / '苏联' / '苏军' / '苏维埃' -> 'soviet'
 * - 'yuri' / '尤里' / '心灵' / '厄普西隆' -> 'yuri'
 * - 'rising_sun' / '升阳' / '旭日' / 'empire' -> 'rising_sun'
 * - 'foehn' / '焚风' -> 'foehn'
 */
export function normalizeBuildingFactionFilter(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return 'common';
  const lower = s.toLowerCase();
  if (lower === 'all' || s === '全部' || s === '全部阵营') return 'all';
  if (lower === 'common' || lower === 'general' || s === '通用' || s === '公共') return 'common';
  if (lower === 'allied' || lower === 'allies' || s.includes('盟军')) return 'allied';
  if (lower === 'soviet' || lower === 'sov' || lower === 'ussr' || /苏联|苏军|苏维埃/.test(s)) return 'soviet';
  if (lower === 'yuri' || lower === 'epsilon' || /尤里|心灵|厄普西隆/.test(s)) return 'yuri';
  if (lower === 'rising_sun' || lower === 'empire' || /升阳|旭日/.test(s)) return 'rising_sun';
  if (lower === 'foehn' || s.includes('焚风')) return 'foehn';
  return lower;
}

function buildDynamicFactionOption(
  id: string,
  rawLabel: string | undefined,
  dynamicIndex: number,
): BuildingFactionOption {
  if (id === 'rising_sun') {
    return {
      id: 'rising_sun',
      label: rawLabel && /体系|阵营$/.test(rawLabel) ? rawLabel : '升阳体系',
      shortBadge: '升',
      accentColor: '#f59e0b',
      bgWeak: 'rgba(120,53,15,0.5)',
      borderColor: '#f59e0b',
    };
  }
  if (id === 'foehn') {
    return {
      id: 'foehn',
      label: rawLabel && /体系|阵营$/.test(rawLabel) ? rawLabel : '焚风体系',
      shortBadge: '焚',
      accentColor: '#14b8a6',
      bgWeak: 'rgba(19,78,74,0.5)',
      borderColor: '#14b8a6',
    };
  }
  const cleanName = (rawLabel || id).replace(/(?:体系|阵营)$/, '').trim() || id;
  const label = /体系|阵营$/.test(rawLabel || '') ? rawLabel! : `${cleanName}体系`;
  const shortBadge = cleanName.slice(0, 1).toUpperCase();
  const useTeal = dynamicIndex % 2 === 1;
  return {
    id,
    label,
    shortBadge,
    accentColor: useTeal ? '#14b8a6' : '#f59e0b',
    bgWeak: useTeal ? 'rgba(19,78,74,0.5)' : 'rgba(120,53,15,0.5)',
    borderColor: useTeal ? '#14b8a6' : '#f59e0b',
  };
}

/**
 * 动态解析当前可用的阵营筛选项列表：
 * - 始终内置 `all` / `allied` / `soviet` / `yuri`
 * - 自动扫描 `snapshot?.command?.unlocked_factions`、`catalog?.factionDefs`、`catalog?.buildings` 及基地建筑中的新阵营
 */
export function resolveAvailableBuildingFactions(
  snapshot?: {
    command?: { primary_faction?: string; unlocked_factions?: readonly string[] };
    bases?: readonly { buildings?: readonly { name?: string; faction?: string }[] }[];
  } | null,
  catalog?: {
    factionDefs?: readonly { id?: string; name?: string; faction?: string }[];
    buildings?: readonly { faction?: string; name?: string }[];
  } | null,
): BuildingFactionOption[] {
  const map = new Map<string, BuildingFactionOption>();
  for (const opt of BUILTIN_FACTION_OPTIONS) {
    map.set(opt.id, { ...opt });
  }
  let dynamicIndex = 0;
  const register = (rawId: string | undefined, rawLabel?: string) => {
    if (!rawId || typeof rawId !== 'string') return;
    const norm = normalizeBuildingFactionFilter(rawId);
    if (!norm || norm === 'all' || norm === 'common') return;
    if (map.has(norm)) return;
    const labelHint = rawLabel || (/[^\x00-\x7f]/.test(rawId) ? rawId.trim() : undefined);
    map.set(norm, buildDynamicFactionOption(norm, labelHint, dynamicIndex));
    dynamicIndex += 1;
  };

  if (snapshot?.command?.primary_faction) {
    register(snapshot.command.primary_faction);
  }
  if (Array.isArray(snapshot?.command?.unlocked_factions)) {
    for (const f of snapshot.command.unlocked_factions) {
      register(f);
    }
  }
  if (Array.isArray(catalog?.factionDefs)) {
    for (const fd of catalog.factionDefs) {
      const fId = fd?.id || fd?.faction || fd?.name;
      const fLabel = fd?.name || fd?.faction;
      register(fId, fLabel);
    }
  }
  if (Array.isArray(catalog?.buildings)) {
    for (const b of catalog.buildings) {
      if (b?.faction) register(b.faction);
    }
  }
  if (Array.isArray(snapshot?.bases)) {
    for (const base of snapshot.bases) {
      for (const b of base?.buildings ?? []) {
        if (b?.faction) register(b.faction);
      }
    }
  }

  return Array.from(map.values());
}

/** 五大双模适用品类判定（对齐 productionLanes.ts §4.1：建造厂/MCV、兵营、战车工厂、空军指挥部、造船厂） */
export function isDualModeBuildingName(rawName: string): boolean {
  const n = (rawName || '').trim();
  if (CONYARD_ORIGIN_NAMES.has(n)) return true;
  return /建造厂|兵营|训导营|战车工厂|战车总装厂|重工车间|空军指挥部|战地机场|神经航空引导盘|造船厂|船坞/.test(n);
}

/** 判定建筑名称是否为建造厂核心/MCV展开中枢 */
export function isConyardBuildingName(rawName: string): boolean {
  const n = (rawName || '').trim();
  return CONYARD_ORIGIN_NAMES.has(n) || /建造厂|尤里机动建设车|心灵前哨站/.test(n);
}

/** 判定单座基地是否已展开运转中的建造厂核心（MCV） */
export function baseHasOperationalConyard(
  base: { buildings?: readonly { name: string; state?: string }[] } | undefined,
): boolean {
  if (!base?.buildings) return false;
  return base.buildings.some(
    b => (b.state ?? '运转') === '运转' && isConyardBuildingName(b.name),
  );
}

/**
 * 推导单座建造厂核心（MCV）名称所属阵营：
 * - 含“苏联/苏军/苏维埃” → 'soviet'
 * - 含“尤里/心灵/厄普西隆” → 'yuri'
 * - 含“盟军” → 'allied'
 * - 含“升阳/旭日/帝国” → 'rising_sun'
 * - 含“焚风” → 'foehn'
 * - 通用旧名（如“建造厂核心”“建造厂”“前沿工地”“作战前哨站”）→ fallbackFaction（默认 'allied'）
 */
export function inferConyardFaction(
  rawName: string,
  fallbackFaction: 'allied' | 'soviet' | 'yuri' | (string & {}) = 'allied',
): 'allied' | 'soviet' | 'yuri' | (string & {}) {
  const n = (rawName || '').trim();
  if (/^(?:苏联|苏军|苏维埃)|苏联建造厂|苏军建造厂/.test(n)) return 'soviet';
  if (/^(?:尤里|心灵|厄普西隆)|尤里建造厂|尤里机动建设车|心灵前哨站/.test(n)) return 'yuri';
  if (/^盟军|盟军建造厂/.test(n)) return 'allied';
  if (/^(?:升阳|旭日)|升阳建造厂|旭日建造厂|帝国建造厂/.test(n)) return 'rising_sun';
  if (/^焚风|焚风建造厂/.test(n)) return 'foehn';
  return fallbackFaction;
}

/**
 * 提取单座基地当前在场运转（state === '运转'）的建造厂核心所属阵营集合
 */
export function resolveBaseOperationalConyardFactions(
  base: { buildings?: readonly { name: string; state?: string; faction?: string }[] } | undefined,
  fallbackFaction: 'allied' | 'soviet' | 'yuri' | (string & {}) = 'allied',
): Set<'allied' | 'soviet' | 'yuri' | (string & {})> {
  const factions = new Set<'allied' | 'soviet' | 'yuri' | (string & {})>();
  if (!base?.buildings) return factions;
  for (const b of base.buildings) {
    if ((b.state ?? '运转') === '运转' && isConyardBuildingName(b.name)) {
      if (b.faction) {
        const explicit = normalizeBuildingFactionFilter(b.faction);
        if (explicit && explicit !== 'all' && explicit !== 'common') {
          factions.add(explicit);
          continue;
        }
      }
      factions.add(inferConyardFaction(b.name, fallbackFaction));
    }
  }
  return factions;
}

export interface BuiltBuildingInstanceRef {
  baseIndex: number;
  baseId: string;
  baseName: string;
  buildingIndex: number;
  name: string;
  /** 同名建筑在本基地内的 1-based 实例序号（如第 1 座 = 1，第 2 座 = 2） */
  instanceOrdinal?: number;
  state: '运转' | '建造中' | '受损' | '停机';
  mode: '生产' | '加速';
  accelScope: 'global' | 'base';
  layer: string;
  dualModeCapable: boolean;
  /** FD-34/39：显式或确定性推导的相对 MCV 坐标与三环空间信息 */
  coord?: { x: number; y: number };
  bearing?: string;
  ring?: 'core' | 'inner' | 'mid' | 'outer';
  ringLabel?: '核心' | '内环' | '中环' | '外环';
  bearingLabel?: string;
  /** FD-38/39：在建建筑进度（0~100）与剩余工期描述 */
  progress?: number;
  eta?: string;
  /** FD-37/39：本座实例已挂载的原位扩建模块列表 */
  addons?: string[];
  /** FD-39：本座实例理论发电量（W）与耗电量（W） */
  powerGen?: number;
  powerUse?: number;
}

export interface BuildingSystemTabMeta {
  id: BuildingSystemId;
  label: string;
  shortLabel: string;
  icon: string;
  subtitle: string;
}

export const BUILDING_SYSTEM_TABS: readonly BuildingSystemTabMeta[] = [
  { id: 'military', label: '① 军工生产', shortLabel: '军工生产', icon: 'hammer', subtitle: '兵营 · 战车 · 空军 · 船坞 · 机娘整备' },
  { id: 'defense', label: '② 防御纵深', shortLabel: '防御纵深', icon: 'shield', subtitle: '预警防空 · 纵深火网 · 掩体与损管' },
  { id: 'agro', label: '③ 农畜生态', shortLabel: '农畜生态', icon: 'civic', subtitle: '水源育种 · 农牧生产 · 军粮冷链 · 循环再生' },
  { id: 'industry', label: '④ 能源与工业基建', shortLabel: '能源工业', icon: 'power', subtitle: '发电供电 · 采矿炼化 · 仓储物流' },
  { id: 'research_space', label: '⑤ 科研航天与超武', shortLabel: '科研超武', icon: 'rocket', subtitle: '作战实验室 · 航天发射 · 战略超级武器' },
] as const;

export interface BuildingBlueprintNodeSpec {
  id: string;
  name: string;
  shortLabel?: string;
  system: BuildingSystemId;
  laneLabel: string;
  x: number;
  y: number;
  aliases?: readonly string[];
  defenseRing?: DefenseRing;
  agroStage?: AgroStage;
  defaultPrereqHint?: string;
  isOriginConyard?: boolean;
  dualModeCapable?: boolean;
  faction?: 'common' | 'allied' | 'soviet' | 'yuri' | (string & {});
  factionVariants?: {
    allied?: { name: string; shortLabel?: string };
    soviet?: { name: string; shortLabel?: string };
    yuri?: { name: string; shortLabel?: string };
    [factionId: string]: { name: string; shortLabel?: string } | undefined;
  };
}

export interface BuildingBlueprintEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  feedback?: boolean;
}

export interface BuildingBlueprintNode extends BuildingBlueprintNodeSpec {
  displayName: string;
  displayShortLabel: string;
  factionBadge?: '盟' | '苏' | '尤' | '盟/苏' | '盟/苏/尤' | (string & {});
  dimmedByFaction: boolean;
  state: BuildingNodeState;
  builtCount: number;
  runningCount: number;
  offlineCount: number;
  switchingCount: number;
  productionModeCount: number;
  accelModeCount: number;
  buildingProgress?: number;
  statusText: string;
  hint: string;
  matchedNames: string[];
  instances: BuiltBuildingInstanceRef[];
  /** 挂载在该 SVG 蓝图节点下的同簇/同族世界书建筑列表（点击 SVG 节点可交互展开查看全部子建筑） */
  clusterItems: SystemCatalogEntry[];
}

export interface BuildingSystemMetric {
  label: string;
  value: string;
  subText?: string;
  tone?: 'ok' | 'warn' | 'accent' | 'muted';
}

export interface FacilityUpgradeOption {
  name: string;
  displayName: string;
  mode: 'replace' | 'addon';
  standalone: boolean;
  cost: number;
  deltaCost: number;
  isUnlocked: boolean;
  inQueue: boolean;
  isMounted: boolean;
  research?: string;
}

export interface BuiltFacilitySummary {
  name: string;
  system: BuildingSystemId;
  dualModeCapable: boolean;
  count: number;
  runningCount: number;
  offlineCount: number;
  productionModeCount: number;
  accelModeCount: number;
  layers: string[];
  baseNames: string[];
  instances: BuiltBuildingInstanceRef[];
  buildingCount?: number;
  damagedCount?: number;
  stoppedCount?: number;
  totalPowerGen?: number;
  totalPowerUse?: number;
  allInstances?: BuiltBuildingInstanceRef[];
  mountedAddons?: string[];
  upgradeOptions?: FacilityUpgradeOption[];
  addonOptions?: FacilityUpgradeOption[];
}

export interface LiveSandboxBlip {
  key: string;
  instance: BuiltBuildingInstanceRef;
  system: BuildingSystemId;
  leftPct: number;
  topPct: number;
  color: string;
  ring: 'core' | 'inner' | 'mid' | 'outer';
  ringLabel: '核心' | '内环' | '中环' | '外环';
  bearingLabel: string;
  titleText: string;
}

export interface LiveSectorCardModel {
  name: string;
  layer: string;
  status: string;
  statusTone: 'ok' | 'warn' | 'danger' | 'accent';
  desc: string;
  coLocatedBuildings: string[];
}

export interface LiveLayerGroupModel {
  layerName: string;
  sectors: LiveSectorCardModel[];
  instances: BuiltBuildingInstanceRef[];
  runningCount: number;
  buildingCount: number;
}

export interface PowerLedgerItem {
  key: string;
  name: string;
  instanceLabel: string;
  baseName: string;
  layer: string;
  state: BuiltBuildingInstanceRef['state'];
  gen: number;
  use: number;
  addons: string[];
}

export interface LiveBaseSandboxModel {
  conyardHubs: Array<{
    name: string;
    faction: string;
    factionLabel: string;
    state: string;
    mode: '生产' | '加速';
    layer: string;
    powerGen: number;
  }>;
  blips: LiveSandboxBlip[];
  ringCounts: { core: number; inner: number; mid: number; outer: number };
  layerGroups: LiveLayerGroupModel[];
  availableLayers: string[];
  sectors: LiveSectorCardModel[];
  powerLedger: {
    generators: PowerLedgerItem[];
    consumers: PowerLedgerItem[];
    totalCatalogGen: number;
    totalCatalogUse: number;
    reportedGen: number;
    reportedUse: number;
    net: number;
  };
  allInstances: BuiltBuildingInstanceRef[];
  underConstructionInstances: BuiltBuildingInstanceRef[];
}

export interface SystemCatalogEntry {
  id: string;
  name: string;
  system: BuildingSystemId;
  faction: 'common' | 'allied' | 'soviet' | 'yuri' | (string & {});
  subGroup: string;
  state: BuildingNodeState;
  builtCount: number;
  statusText: string;
  cost: number;
  power: number;
  prereqText: string;
}

export interface BuildingSystemView {
  id: BuildingSystemId;
  meta: BuildingSystemTabMeta;
  nodes: BuildingBlueprintNode[];
  edges: BuildingBlueprintEdge[];
  metrics: BuildingSystemMetric[];
  builtList: BuiltFacilitySummary[];
  catalogEntries: SystemCatalogEntry[];
  builtNodeCount: number;
  totalNodeCount: number;
}

export interface BuildingOverviewModel {
  scope: BuildingScopeMode;
  factionFilter: BuildingFactionFilter;
  availableFactions: BuildingFactionOption[];
  hasOperationalConyard: boolean;
  activeBaseIndex: number;
  activeBaseName: string;
  totalBuiltCount: number;
  totalRunningCount: number;
  totalBuildingQueueCount: number;
  powerSummary: { gen: number; use: number; net: number };
  systems: Record<BuildingSystemId, BuildingSystemView>;
  allBuiltFacilities: BuiltFacilitySummary[];
  liveSandbox: LiveBaseSandboxModel;
}

export const BLUEPRINT_NODES: readonly BuildingBlueprintNodeSpec[] = [
  // 1. military (军工生产)
  {
    id: 'mil_conyard',
    name: '建造厂核心',
    shortLabel: '建造厂核心',
    system: 'military',
    laneLabel: '中枢原点',
    x: 85,
    y: 230,
    isOriginConyard: true,
    dualModeCapable: true,
    faction: 'common',
    factionVariants: {
      allied: { name: '盟军建造厂', shortLabel: '盟军建造厂' },
      soviet: { name: '苏联建造厂', shortLabel: '苏联建造厂' },
      yuri: { name: '尤里建造厂核心', shortLabel: '尤里建造厂' },
    },
    aliases: ['建造厂', '盟军建造厂', '苏联建造厂', '尤里建造厂', '尤里建造厂核心', '尤里机动建设车', '心灵前哨站', '前沿工地', '作战前哨站'],
  },
  {
    id: 'mil_barracks',
    name: '兵营',
    system: 'military',
    laneLabel: '步兵装具线',
    x: 275,
    y: 65,
    dualModeCapable: true,
    faction: 'common',
    factionVariants: {
      allied: { name: '盟军兵营', shortLabel: '盟军兵营' },
      soviet: { name: '苏联兵营', shortLabel: '苏联兵营' },
      yuri: { name: '尤里克隆与新兵训导营', shortLabel: '尤里训导营' },
    },
    aliases: ['盟军兵营', '苏联兵营', '尤里兵营', '尤里克隆与新兵训导营', '尤里新兵训导营'],
  },
  {
    id: 'mil_equip',
    name: '个人装备制造所',
    shortLabel: '装备制造所',
    system: 'military',
    laneLabel: '步兵装具线',
    x: 510,
    y: 65,
    faction: 'common',
    factionVariants: {
      allied: { name: '盟军个人装备制造所', shortLabel: '盟军装备所' },
      soviet: { name: '苏联个人装备制造所', shortLabel: '苏联装备所' },
      yuri: { name: '心灵重塑与认知感化院', shortLabel: '心灵重塑感化院' },
    },
    aliases: ['盟军个人装备制造所', '苏联个人装备制造所', '尤里个人装备制造所', '心灵重塑与认知感化院', '心灵装具与基因调谐所'],
    defaultPrereqHint: '需建筑：兵营',
  },
  {
    id: 'mil_academy',
    name: '陆军军校',
    shortLabel: '军校 / 复制中心',
    system: 'military',
    laneLabel: '步兵装具线',
    x: 755,
    y: 65,
    faction: 'common',
    factionVariants: {
      allied: { name: '陆军军校', shortLabel: '陆军军校' },
      soviet: { name: '复制中心', shortLabel: '复制中心' },
      yuri: { name: '生物克隆与素体培育中心', shortLabel: '克隆培育中心' },
    },
    aliases: ['军事学院', '复制中心', '动员兵工城', '克隆缸', '生物克隆与素体培育中心', '基因克隆中心'],
    defaultPrereqHint: '需建筑：兵营 + 战术科研中心',
  },
  {
    id: 'mil_warfactory',
    name: '战车工厂',
    system: 'military',
    laneLabel: '地面装甲线',
    x: 275,
    y: 150,
    dualModeCapable: true,
    faction: 'common',
    factionVariants: {
      allied: { name: '盟军战车工厂', shortLabel: '盟军战车工厂' },
      soviet: { name: '苏联战车工厂', shortLabel: '苏联战车工厂' },
      yuri: { name: '尤里生物机电战车总装厂', shortLabel: '尤里战车总装厂' },
    },
    aliases: ['盟军战车工厂', '苏联战车工厂', '尤里战车工厂', '尤里生物机电战车总装厂', '重工车间'],
    defaultPrereqHint: '需建筑：矿石精炼厂',
  },
  {
    id: 'mil_depot',
    name: '战地维修所',
    shortLabel: '战地维修所',
    system: 'military',
    laneLabel: '地面装甲线',
    x: 470,
    y: 150,
    faction: 'common',
    factionVariants: {
      allied: { name: '盟军维修工厂', shortLabel: '盟军维修厂' },
      soviet: { name: '苏联维修工厂', shortLabel: '苏联维修厂' },
      yuri: { name: '部队回收厂', shortLabel: '部队回收厂' },
    },
    aliases: ['维修工厂', '盟军维修工厂', '苏联维修工厂', '部队回收厂', '尤里部队回收厂'],
    defaultPrereqHint: '需建筑：战车工厂',
  },
  {
    id: 'mil_indplant',
    name: '苏维埃工业工厂',
    shortLabel: '苏维埃工业工厂',
    system: 'military',
    laneLabel: '地面装甲线',
    x: 660,
    y: 150,
    faction: 'soviet',
    aliases: ['工业工厂', '扩大版自动化战车工厂', '全自动军工综合体', '巨型联合兵工厂'],
    defaultPrereqHint: '需建筑：战车工厂 + 红星实验设计局',
  },
  {
    id: 'mil_apoc_bay',
    name: '天启超重总装跨',
    shortLabel: '天启超重总装跨',
    system: 'military',
    laneLabel: '地面装甲线',
    x: 845,
    y: 150,
    faction: 'soviet',
    factionVariants: {
      yuri: { name: '母脑湿件培育与特装总装跨', shortLabel: '母脑特装总装跨' },
    },
    aliases: [
      '天启超重型总装车间',
      '装甲储备与装备再生基地',
      '装甲储备与装备再生扩建',
      'Crusher Crane重型拆解回收站',
      'Crusher Crane维修—拆件—报废扩建',
      '母脑湿件培育与特装总装跨',
    ],
    defaultPrereqHint: '需建筑：战车工厂 + 红星实验设计局',
  },
  {
    id: 'mil_airforce',
    name: '空军指挥部',
    shortLabel: '空军指挥部',
    system: 'military',
    laneLabel: '航空母港线',
    x: 275,
    y: 235,
    dualModeCapable: true,
    faction: 'common',
    factionVariants: {
      allied: { name: '盟军空军指挥部', shortLabel: '盟军空指部' },
      soviet: { name: '苏联空军指挥部', shortLabel: '苏联空指部' },
      yuri: { name: '神经航空引导盘', shortLabel: '神经航空引导盘' },
    },
    aliases: ['盟军空军指挥部', '苏联空军指挥部', '战地机场', '神经航空引导盘'],
    defaultPrereqHint: '需建筑：矿石精炼厂 + 航空工学基础',
  },
  {
    id: 'mil_airradar',
    name: '空天飞机维护综合体',
    shortLabel: '空天维护综合体',
    system: 'military',
    laneLabel: '航空母港线',
    x: 510,
    y: 235,
    faction: 'common',
    aliases: ['空指部扩建雷达', '伞兵协同站', '特种机库'],
    defaultPrereqHint: '需建筑：空军指挥部 + 战斗实验室',
  },
  {
    id: 'mil_kirov_hangar',
    name: '基洛夫巨型收纳与保障库',
    shortLabel: '基洛夫保障库',
    system: 'military',
    laneLabel: '航空母港线',
    x: 755,
    y: 235,
    faction: 'soviet',
    factionVariants: {
      yuri: { name: '环形磁流体飞碟整备与微波充能巢', shortLabel: '飞碟整备充能巢' },
    },
    aliases: ['基洛夫飞艇整备锚泊库', '飞艇整备锚泊库', '基洛夫艇库', '重型飞艇母港', '环形磁流体飞碟整备与微波充能巢'],
    defaultPrereqHint: '需建筑：空军指挥部 + 红星实验设计局',
  },
  {
    id: 'mil_dock',
    name: '简易船坞',
    system: 'military',
    laneLabel: '远洋舰船线',
    x: 275,
    y: 320,
    faction: 'common',
    aliases: ['河道船坞', '内河船坞'],
    defaultPrereqHint: '需水域环境 + 发电厂',
  },
  {
    id: 'mil_shipyard',
    name: '海军造船厂',
    shortLabel: '海军造船厂',
    system: 'military',
    laneLabel: '远洋舰船线',
    x: 510,
    y: 320,
    dualModeCapable: true,
    faction: 'common',
    factionVariants: {
      allied: { name: '盟军造船厂', shortLabel: '盟军造船厂' },
      soviet: { name: '苏联造船厂', shortLabel: '苏联造船厂' },
      yuri: { name: '尤里半潜与仿生造船厂', shortLabel: '尤里仿生造船厂' },
    },
    aliases: ['盟军造船厂', '苏联造船厂', '尤里半潜与仿生造船厂', '尤里潜艇船坞', '尤里造船厂', '造船厂', '扩大版造船厂', '超级造船综合体'],
    defaultPrereqHint: '需建筑：矿石精炼厂 + 船舶工学基础',
  },
  {
    id: 'mil_dreadnought_dock',
    name: '无畏重型船坞与重弹保障段',
    shortLabel: '无畏重型船坞',
    system: 'military',
    laneLabel: '远洋舰船线',
    x: 755,
    y: 320,
    faction: 'soviet',
    factionVariants: {
      yuri: { name: '半潜消磁船坞与龟背重弹装填栈桥', shortLabel: '半潜重弹船坞' },
    },
    aliases: ['无畏级深水干船坞', '战略堡垒潜艇保障段', '战略导弹舰干船坞', '半潜消磁船坞与龟背重弹装填栈桥'],
    defaultPrereqHint: '需建筑：海军造船厂 + 红星实验设计局',
  },
  { id: 'mil_mecha_shop', name: '机娘兵装整备工坊', shortLabel: '机娘整备工坊', system: 'military', laneLabel: '机娘保障线', x: 275, y: 405, faction: 'common', aliases: ['外骨骼神经调校室', '机娘工坊'], defaultPrereqHint: '需建筑：战车工厂 / 战术科研中心' },
  { id: 'mil_mecha_pod', name: '纳米躯体再造舱', shortLabel: '纳米躯体再造舱', system: 'military', laneLabel: '机娘保障线', x: 510, y: 405, faction: 'common', aliases: ['机娘维护舱', '心灵突触与基因容器调律舱'], defaultPrereqHint: '需建筑：机娘兵装整备工坊' },
  { id: 'mil_mecha_vault', name: '意识保险库', shortLabel: '意识保险库', system: 'military', laneLabel: '机娘保障线', x: 755, y: 405, faction: 'common', aliases: ['心智云端备份中枢'], defaultPrereqHint: '需科技：心智云端映射' },

  // 2. defense (防御纵深：左向三距扇区 far -> mid -> near -> core，精确对齐世界书 <数据> name)
  { id: 'def_far_radar', name: '综合感知塔', shortLabel: '综合感知塔/探针', system: 'defense', laneLabel: '外圈·远程预警防空', defenseRing: 'far', x: 120, y: 80, faction: 'common', factionVariants: { yuri: { name: '心灵感应器', shortLabel: '心灵感应器' } }, aliases: ['远程预警雷达站', '哨戒探针阵列', '超视距相控阵雷达', '心灵感应器', '心灵探测仪'] },
  { id: 'def_far_patriot', name: '爱国者防空阵地', shortLabel: '爱国者防空阵地', system: 'defense', laneLabel: '外圈·远程预警防空', defenseRing: 'far', x: 120, y: 180, faction: 'allied', factionVariants: { yuri: { name: '苍穹之眼高能微波与神经制导防空反导阵地', shortLabel: '苍穹之眼反导阵' } }, aliases: ['爱国者防空导弹阵地', '爱国者PAC-3增强防空阵地', '爱国者阵地增强改装', '区域防空导弹阵地', '苍穹之眼高能微波与神经制导防空反导阵地'] },
  { id: 'def_far_s300', name: 'THAAD 末段高空拦截阵地', shortLabel: '萨德/S-300反导', system: 'defense', laneLabel: '外圈·远程预警防空', defenseRing: 'far', x: 120, y: 280, faction: 'common', factionVariants: { allied: { name: 'THAAD 末段高空拦截阵地', shortLabel: 'THAAD高空拦截' }, soviet: { name: '苏联先进态势与防空指挥中心', shortLabel: '苏联防空指挥网' }, yuri: { name: '尤里深层神经态势与防空指挥中心', shortLabel: '尤里神经防空指挥' } }, aliases: ['S-300地空导弹阵地', 'THAAD增程机动拦截发射单元', 'THAAD-ER增程高空拦截阵地', 'GPI 滑翔段拦截系统', 'GPI超高空火控引导站', 'GPI超高空火控拦截系统', '苏联先进态势与防空指挥中心', '苏联先进态势与防空指挥实现', '尤里深层神经态势与防空指挥中心'] },
  { id: 'def_far_gap', name: '裂缝产生器', shortLabel: '裂缝/全谱隐身屏障', system: 'defense', laneLabel: '外圈·远程预警防空', defenseRing: 'far', x: 120, y: 380, faction: 'allied', factionVariants: { yuri: { name: '认知迷雾与潜意识幻象发生器', shortLabel: '潜意识幻象发生器' } }, aliases: ['全谱电磁与微波隐身屏蔽系统', '全谱电磁隐身裂缝产生器', '广谱特征屏蔽系统', '电子战干扰站', '认知迷雾与潜意识幻象发生器'], defaultPrereqHint: '需建筑：盟军战斗实验室' },
  { id: 'def_mid_flak', name: '中程防空阵地', shortLabel: '中程防空/高射炮', system: 'defense', laneLabel: '中圈·中程防空反甲', defenseRing: 'mid', x: 365, y: 80, faction: 'common', factionVariants: { allied: { name: '中程防空阵地', shortLabel: '中程防空阵地' }, soviet: { name: '苏联高射炮', shortLabel: '苏联高射炮' }, yuri: { name: '盖特机炮塔', shortLabel: '盖特机炮塔' } }, aliases: ['高射炮防空阵地', '苏联高射炮', '盖特机炮塔', '盖特机炮', '近程防空阵地', '防空炮'] },
  { id: 'def_mid_prism', name: '光棱塔', shortLabel: '光棱塔', system: 'defense', laneLabel: '中圈·中程防空反甲', defenseRing: 'mid', x: 365, y: 180, faction: 'allied', factionVariants: { yuri: { name: '磁电谐振棱镜塔', shortLabel: '磁电谐振棱镜塔' } }, aliases: ['先进光棱塔', '先进光棱塔升级', '光棱防御塔', '磁电谐振棱镜塔'], defaultPrereqHint: '需建筑：盟军战斗实验室' },
  { id: 'def_mid_tesla', name: '磁暴线圈', shortLabel: '磁暴线圈', system: 'defense', laneLabel: '中圈·中程防空反甲', defenseRing: 'mid', x: 365, y: 280, faction: 'soviet', factionVariants: { yuri: { name: '心灵控制塔', shortLabel: '心灵控制塔' } }, aliases: ['特斯拉线圈', '精神控制塔', '心灵控制塔'], defaultPrereqHint: '需建筑：红星实验设计局综合体' },
  { id: 'def_mid_at', name: '反装甲炮位', shortLabel: '反装甲炮/巨炮/火箭', system: 'defense', laneLabel: '中圈·中程防空反甲', defenseRing: 'mid', x: 365, y: 380, faction: 'common', factionVariants: { allied: { name: '法式要塞巨炮', shortLabel: '法式要塞巨炮' }, soviet: { name: '多管火箭炮阵地', shortLabel: '多管火箭/榴弹炮' } }, aliases: ['重型反坦克炮台', '法式要塞巨炮', '多管火箭炮阵地', '半固定榴弹炮阵地', '迫击炮巢', '区域防御要塞'] },
  { id: 'def_near_pillbox', name: '哨戒炮位', shortLabel: '哨戒炮/遥控武器塔', system: 'defense', laneLabel: '内圈·近程点防屏障', defenseRing: 'near', x: 610, y: 80, faction: 'common', factionVariants: { allied: { name: '遥控武器站塔', shortLabel: '遥控武器站塔' }, soviet: { name: '苏联哨戒炮', shortLabel: '苏联哨戒炮' }, yuri: { name: '盖特机炮塔', shortLabel: '盖特机炮阵位' } }, aliases: ['哨戒炮', '苏联哨戒炮', '遥控武器站塔', '自动近防炮(CIWS)', '盖特机炮阵位'] },
  {
    id: 'def_near_bunker',
    name: '驻军碉堡',
    shortLabel: '驻军/战斗碉堡',
    system: 'defense',
    laneLabel: '内圈·近程点防屏障',
    defenseRing: 'near',
    x: 610,
    y: 180,
    faction: 'common',
    factionVariants: {
      allied: { name: '盟军碉堡', shortLabel: '盟军碉堡' },
      soviet: { name: '苏联战斗碉堡', shortLabel: '苏联战斗碉堡' },
      yuri: { name: '并网式神经-液冷重装碉堡', shortLabel: '神经重装碉堡' },
    },
    aliases: ['机枪碉堡', '战斗碉堡', '盟军碉堡', '苏联战斗碉堡', '坦克碉堡', '强化掩体', '并网式神经-液冷重装碉堡', '活性生物凝胶自愈合装甲外皮'],
  },
  { id: 'def_near_flame', name: '激光近防系统', shortLabel: '激光近防/反小目标', system: 'defense', laneLabel: '内圈·近程点防屏障', defenseRing: 'near', x: 610, y: 280, faction: 'common', aliases: ['火焰塔', '反小型目标近防系统', '纳米诱饵设施', '拟态伪装网', '照明塔'] },
  { id: 'def_near_wall', name: '反载具障碍带', shortLabel: '障碍围墙/纳米雷区', system: 'defense', laneLabel: '内圈·近程点防屏障', defenseRing: 'near', x: 610, y: 380, faction: 'common', factionVariants: { allied: { name: '盟军围墙', shortLabel: '盟军围墙/雷区' }, soviet: { name: '纳米雷区部署器', shortLabel: '纳米雷区/障碍带' }, yuri: { name: '尤里复合生化护墙', shortLabel: '尤里生化护墙' } }, aliases: ['高强度复合围墙', '盟军围墙', '纳米雷区部署器', '反装甲雷区', '围墙', '尤里复合生化护墙', '尤里护城墙'] },
  { id: 'def_core_bunker', name: '强化地下掩蔽所', shortLabel: '强化地下掩蔽所', system: 'defense', laneLabel: '核心·掩体与损管', defenseRing: 'core', x: 840, y: 80, faction: 'common', aliases: ['地下掩体工事', '深层地下综合体', '国家连续性深层地下要塞', '地下国家连续性升级', '活体神经签名与防夺舍认证门禁'] },
  { id: 'def_core_fire', name: '前线综合后勤站', shortLabel: '前线后勤与物资库', system: 'defense', laneLabel: '核心·掩体与损管', defenseRing: 'core', x: 840, y: 180, faction: 'common', aliases: ['消防损管站', '野战物资库', '模块化战勤生活营区', '综合战备与重装周转总库'] },
  { id: 'def_core_repair', name: '野战医疗站', shortLabel: '野战医疗与机堡库', system: 'defense', laneLabel: '核心·掩体与损管', defenseRing: 'core', x: 840, y: 280, faction: 'common', aliases: ['战地抢修塔', '重型装甲掩蔽库与封存车库', '战备硬化机堡与恒温特种机库', '临时羁押与特种看押所'] },
  { id: 'def_core_decon', name: '先进态势指挥中心', shortLabel: '态势指挥与电战防护', system: 'defense', laneLabel: '核心·掩体与损管', defenseRing: 'core', x: 840, y: 380, faction: 'common', factionVariants: { allied: { name: '盟军先进态势与C4ISR指挥中心', shortLabel: '盟军C4ISR指挥' }, soviet: { name: '红星工控防护与电磁注入终端', shortLabel: '红星工控防护终端' }, yuri: { name: '三级生化负压密封与消洗隔离模块', shortLabel: '生化负压隔离舱' } }, aliases: ['防化洗消站', '红星工控防护与电磁注入终端', '盟军先进态势与C4ISR指挥中心', '盟军先进态势与 C4ISR 指挥实现', '电子战干扰站', '网络战中心', '通讯中继桩', '全域战场感知中枢', '三级生化负压密封与消洗隔离模块', '心灵网络转译信标'] },

  // 3. agro (农畜生态 12 建筑 + 环保水务闭环，精确对齐世界书 <数据> name)
  { id: 'agro_farmland', name: '土壤培育与改良站', shortLabel: '土壤培育改良站', system: 'agro', laneLabel: '水源与育种基础', agroStage: 'base', x: 115, y: 85, aliases: ['基础农田与水利改造', '高标准农田', '生态修复站', '生态公园与绿化设施'] },
  { id: 'agro_water', name: '深井泵站与水文净化设施', shortLabel: '深井泵站与供水', system: 'agro', laneLabel: '水源与育种基础', agroStage: 'base', x: 115, y: 185, aliases: ['净水与供水站', '净水厂', '供水泵站'] },
  { id: 'agro_seed', name: '种质资源库与育种实验室', shortLabel: '种质库与育种室', system: 'agro', laneLabel: '水源与育种基础', agroStage: 'base', x: 115, y: 285, factionVariants: { yuri: { name: '异界奇珍种质基因嵌合与异兽驯化温床', shortLabel: '基因嵌合驯化床' } }, aliases: ['育种中心与种质库', '农业育种中心', '异界奇珍种质基因嵌合与异兽驯化温床'] },
  { id: 'agro_feed', name: '自动化饲料加工站', shortLabel: '自动化饲料加工', system: 'agro', laneLabel: '水源与育种基础', agroStage: 'base', x: 115, y: 385, aliases: ['合成饲料与营养调配厂', '饲料加工厂', '合成生物蛋白与狂暴激素营养槽'] },
  { id: 'agro_greenhouse', name: '地下规模化种植场', shortLabel: '规模化种植场', system: 'agro', laneLabel: '农牧种养区', agroStage: 'primary', x: 365, y: 65, aliases: ['智能温室大棚', '恒温温室大棚'] },
  { id: 'agro_hydro', name: '地下菌类培养室', shortLabel: '地下菌类培养室', system: 'agro', laneLabel: '农牧种养区', agroStage: 'primary', x: 365, y: 145, factionVariants: { yuri: { name: '多倍体速生巨菌与弱光高能作物垂直塔', shortLabel: '速生巨菌垂直塔' } }, aliases: ['立体水培农场', '垂直水培农场', '菌类培养室', '多倍体速生巨菌与弱光高能作物垂直塔'] },
  { id: 'agro_livestock', name: '综合智能养殖场', shortLabel: '综合智能养殖场', system: 'agro', laneLabel: '农牧种养区', agroStage: 'primary', x: 365, y: 225, aliases: ['标准化畜牧养殖场', '畜牧养殖场'] },
  { id: 'agro_poultry', name: '昆虫蛋白养殖舱', shortLabel: '昆虫蛋白养殖舱', system: 'agro', laneLabel: '农牧种养区', agroStage: 'primary', x: 365, y: 305, aliases: ['规模化家禽孵化与蛋品场', '家禽养殖场'] },
  { id: 'agro_aqua', name: '封闭式水产养殖池', shortLabel: '封闭水产养殖池', system: 'agro', laneLabel: '农牧种养区', agroStage: 'primary', x: 365, y: 385, aliases: ['高密度循环水产养殖场', '水产养殖场'] },
  { id: 'agro_grain', name: '粮食加工坊', shortLabel: '粮食加工坊', system: 'agro', laneLabel: '精深加工与冷链', agroStage: 'process', x: 615, y: 120, aliases: ['粮食精加工与战备口粮厂', '战备口粮厂'] },
  { id: 'agro_meat', name: '生态副食与水循环保障站', shortLabel: '生态副食保障站', system: 'agro', laneLabel: '精深加工与冷链', agroStage: 'process', x: 615, y: 235, factionVariants: { yuri: { name: '离体肌束与无神经培养肉矩阵', shortLabel: '离体培养肉矩阵' } }, aliases: ['自动化屠宰与肉类联合加工厂', '屠宰加工厂', '离体肌束与无神经培养肉矩阵'] },
  { id: 'agro_cold', name: '食品加工与冷链中心', shortLabel: '食品加工冷链中心', system: 'agro', laneLabel: '精深加工与冷链', agroStage: 'process', x: 615, y: 350, aliases: ['战略冷链与气调储备库', '冷链储备库'] },
  { id: 'agro_biogas', name: '有机循环处理站', shortLabel: '有机循环/沼气站', system: 'agro', laneLabel: '厌氧沼气与回灌', agroStage: 'recycle', x: 840, y: 150, aliases: ['厌氧沼气发电站', '有机肥回灌站', '社区环卫服务站'] },
  { id: 'agro_wastewater', name: '工业废水处理厂', shortLabel: '废水与污水再生', system: 'agro', laneLabel: '厌氧沼气与回灌', agroStage: 'recycle', x: 840, y: 265, aliases: ['生活污水处理站', '污水处理厂', '环境监测站'] },
  { id: 'agro_incinerator', name: '垃圾焚烧发电站', shortLabel: '固废焚烧与回收', system: 'agro', laneLabel: '厌氧沼气与回灌', agroStage: 'recycle', x: 840, y: 375, aliases: ['基础废物分拣站', '废弃电子产品回收处理厂', '塑料回收裂解厂', '危废最终处置中心', '大气净化与脱硫脱硝站', '碳捕集与利用设施'] },

  // 4. industry (能源与工业基建，精确对齐世界书 <数据> name)
  { id: 'ind_power', name: '发电厂', shortLabel: '基础发电厂', system: 'industry', laneLabel: '发电与储能网', x: 110, y: 95, faction: 'common', factionVariants: { allied: { name: '盟军发电厂', shortLabel: '盟军发电厂' }, soviet: { name: '燃煤电厂', shortLabel: '燃煤/基础电厂' }, yuri: { name: '高能厌氧生化反应炉', shortLabel: '厌氧生化反应炉' } }, aliases: ['盟军发电厂', '燃煤电厂', '生化反应炉', '高能厌氧生化反应炉', '燃气/燃油发电机组', '应急柴油发电机'] },
  { id: 'ind_solar', name: '太阳能板阵列', shortLabel: '风光清洁发电', system: 'industry', laneLabel: '发电与储能网', x: 295, y: 95, faction: 'common', aliases: ['光伏发电机组', '风力发电阵列', '大型光能发电场', '同位素电源 RTG 设施'] },
  { id: 'ind_tesla_plant', name: '苏联磁能反应炉', shortLabel: '苏联磁能反应炉', system: 'industry', laneLabel: '发电与储能网', x: 480, y: 95, faction: 'soviet', factionVariants: { yuri: { name: '深层地热-嗜热菌电化学复合反应堆', shortLabel: '地热嗜热菌反应堆' } }, aliases: ['磁能反应炉', '深层地热-嗜热菌电化学复合反应堆'] },
  { id: 'ind_smr', name: '小型模块化核反应堆', shortLabel: '模块化核堆/裂变', system: 'industry', laneLabel: '发电与储能网', x: 665, y: 95, faction: 'common', factionVariants: { allied: { name: 'SMR 小型模块化核反应堆', shortLabel: '盟军SMR核堆' }, soviet: { name: '大型裂变发电站', shortLabel: '大型裂变发电站' } }, aliases: ['小型模块化核反应堆(SMR)', 'SMR 小型模块化核反应堆', '大型裂变发电站', '大型核裂变电站', '快堆闭式循环核电站', '快堆—闭式燃料循环升级'], defaultPrereqHint: '需科技：模块化核能' },
  { id: 'ind_fusion', name: '聚变发电中枢', shortLabel: '受控核聚变中枢', system: 'industry', laneLabel: '发电与储能网', x: 845, y: 95, faction: 'common', factionVariants: { allied: { name: '聚变军工供能站', shortLabel: '聚变军工供能站' }, soviet: { name: '红色太阳大型稳态可控聚变实验堆', shortLabel: '红色太阳聚变堆' } }, aliases: ['受控核聚变示范堆', '聚变发电阵列', '聚变军工供能站', '红色太阳大型稳态可控聚变实验堆'], defaultPrereqHint: '需科技：聚变军工供能工学' },
  {
    id: 'ind_refinery',
    name: '矿石精炼厂',
    shortLabel: '矿石精炼厂',
    system: 'industry',
    laneLabel: '采掘与重化工',
    x: 110,
    y: 235,
    faction: 'common',
    factionVariants: {
      allied: { name: '盟军矿石精炼厂', shortLabel: '盟军精炼厂' },
      soviet: { name: '苏联矿石精炼厂', shortLabel: '苏联精炼厂' },
      yuri: { name: '奴隶矿场', shortLabel: '奴隶矿场' },
    },
    aliases: ['盟军矿石精炼厂', '苏联矿石精炼厂', '奴隶矿场', '尤里奴隶矿场', '矿石精炼器'],
  },
  { id: 'ind_oil', name: '抽油机', shortLabel: '抽油机与炼油厂', system: 'industry', laneLabel: '采掘与重化工', x: 295, y: 235, faction: 'common', aliases: ['油井抽油机', '炼油厂', '科技钻油井'] },
  { id: 'ind_synfuel', name: '合成燃料工坊', shortLabel: '合成燃料/化工厂', system: 'industry', laneLabel: '采掘与重化工', x: 480, y: 235, faction: 'common', aliases: ['煤制油与合成燃料厂', '化工合成厂', '炼油厂'] },
  { id: 'ind_nanite', name: '小型纳米合成工坊', shortLabel: '纳米合成工坊', system: 'industry', laneLabel: '采掘与重化工', x: 665, y: 235, faction: 'common', aliases: ['纳米催化工坊'], defaultPrereqHint: '需科技：纳米精密合成学' },
  { id: 'ind_heavy', name: '巨型自动化矿业综合体', shortLabel: '弹药与重矿综合体', system: 'industry', laneLabel: '采掘与重化工', x: 845, y: 235, faction: 'common', factionVariants: { yuri: { name: '阿尔法脑波协同广播与多巴胺节律中枢', shortLabel: '脑波协同广播枢' } }, aliases: ['重化工业联合体', '弹药制造厂', '微型盾构机', '阿尔法脑波协同广播与多巴胺节律中枢'], defaultPrereqHint: '需建筑：矿石精炼厂 + 战斗实验室' },
  { id: 'ind_grid', name: '电力分配节点', shortLabel: '电网分配/储能', system: 'industry', laneLabel: '电网与战略物流', x: 195, y: 375, faction: 'common', factionVariants: { allied: { name: '智能电网潮流调度中心', shortLabel: '智能电网调度' }, soviet: { name: '超导磁储能与脉冲调度站', shortLabel: '超导磁储能站' }, yuri: { name: '生物电容与脑波谐振变电枢', shortLabel: '脑波谐振变电枢' } }, aliases: ['电网级储能阵列', '蓄电池组', '智能电网潮流调度中心', '智能电网调度改造', '超导磁储能与脉冲调度站', '战区超导脉冲电网中枢', '生物电容与脑波谐振变电枢'] },
  { id: 'ind_silo', name: '大宗资源与矿石储仓', shortLabel: '大宗矿石储仓', system: 'industry', laneLabel: '电网与战略物流', x: 430, y: 375, faction: 'common', aliases: ['大宗矿料仓', '矿石储仓', '综合战备与重装周转总库'] },
  { id: 'ind_oiltank', name: '战备燃料与分散储罐区', shortLabel: '战备燃料储罐区', system: 'industry', laneLabel: '电网与战略物流', x: 640, y: 375, faction: 'common', aliases: ['战备油罐区', '燃料储备罐区'] },
  { id: 'ind_rail', name: '区域物流枢纽', shortLabel: '物流与铁路枢纽', system: 'industry', laneLabel: '电网与战略物流', x: 845, y: 375, faction: 'common', factionVariants: { allied: { name: '无人立体仓储调度中心', shortLabel: '无人智能仓储' }, soviet: { name: '战略铁路编组与动员枢纽', shortLabel: '战略铁路编组站' } }, aliases: ['战略铁路编组与动员枢纽', '战略铁路编组与动员扩建', '地下高速管道枢纽', '地下重载军运管道枢纽', '地下重载军运实现', '无人立体仓储调度中心', '无人仓储与最优调度改造'] },

  // 5. research_space (科研航天与超武，精确对齐世界书 <数据> name)
  { id: 'rs_taclab', name: '情报分析中心', shortLabel: '情报与战术科研', system: 'research_space', laneLabel: '科研与超算阶梯', x: 120, y: 95, faction: 'common', aliases: ['战术科研中心', '基础科研所'] },
  {
    id: 'rs_battlelab',
    name: '战斗实验室',
    shortLabel: '战斗实验室',
    system: 'research_space',
    laneLabel: '科研与超算阶梯',
    x: 335,
    y: 95,
    faction: 'common',
    factionVariants: {
      allied: { name: '盟军战斗实验室', shortLabel: '盟军作战实验室' },
      soviet: { name: '红星实验设计局综合体', shortLabel: '红星实验设计局' },
      yuri: { name: '基因测序与心灵谐振研究院', shortLabel: '基因心灵研究院' },
    },
    aliases: ['盟军战斗实验室', '苏联战斗实验室', '尤里战斗实验室', '尤里作战实验室', '基因测序与心灵谐振研究院', '作战实验室'],
    defaultPrereqHint: '需科技：高级作战实验理论',
  },
  { id: 'rs_redstar', name: '红星实验设计局综合体', shortLabel: '红星实验设计局', system: 'research_space', laneLabel: '科研与超算阶梯', x: 545, y: 95, faction: 'soviet', aliases: ['红星设计局', '红星实验设计局'], defaultPrereqHint: '需建筑：空军指挥部 + 高级作战实验理论' },
  { id: 'rs_supercomp', name: '超算中心', shortLabel: '超算中心', system: 'research_space', laneLabel: '科研与超算阶梯', x: 715, y: 95, faction: 'common', aliases: ['大型超算中心'], defaultPrereqHint: '需建筑：战斗实验室' },
  {
    id: 'rs_quantum',
    name: '量子超算中心',
    shortLabel: '量子超算/红星科学城',
    system: 'research_space',
    laneLabel: '科研与超算阶梯',
    x: 865,
    y: 95,
    faction: 'common',
    factionVariants: {
      allied: { name: '量子超算中心', shortLabel: '量子超算中心' },
      soviet: { name: '国家战略工程综合体／红星科学城', shortLabel: '红星科学城' },
      yuri: { name: '双螺旋生命工程与高维意识科学院', shortLabel: '高维意识科学院' },
    },
    aliases: ['高能物理实验室', '红星科学城', '国家战略工程综合体／红星科学城', '双螺旋生命工程与高维意识科学院'],
    defaultPrereqHint: '需建筑：超算中心',
  },
  { id: 'rs_sat', name: '卫星测控站', shortLabel: '卫星测控/上行站', system: 'research_space', laneLabel: '航天工程链', x: 155, y: 235, faction: 'common', aliases: ['卫星测控与数据链中心', '间谍卫星上行站', '深空测控网络'], defaultPrereqHint: '需科技：轨道侦察工学' },
  { id: 'rs_launchpad', name: '航天发射中心', shortLabel: '航天发射中心', system: 'research_space', laneLabel: '航天工程链', x: 390, y: 235, faction: 'common', factionVariants: { allied: { name: '盟军稳定入轨发射场', shortLabel: '盟军稳定入轨场' }, soviet: { name: '国家重型航天发射中心', shortLabel: '重型航天发射中心' } }, aliases: ['航天发射场', '山体发射场', '大型航天发射综合体', '巨型航天发射港', '盟军稳定入轨发射场', '盟军稳定入轨实现', '国家重型航天发射中心'], defaultPrereqHint: '需建筑：战斗实验室' },
  { id: 'rs_rocket', name: '火箭制造厂', shortLabel: '火箭制造与轨道坞', system: 'research_space', laneLabel: '航天工程链', x: 625, y: 235, faction: 'common', aliases: ['重型运载火箭总装厂', '轨道船坞', '地月转运站', '在轨燃料补给站', '轨道侦察预警平台'], defaultPrereqHint: '需建筑：化工合成厂 + 火箭推进基础工学' },
  { id: 'rs_station', name: '月球空间站', shortLabel: '轨道与月球空间站', system: 'research_space', laneLabel: '航天工程链', x: 845, y: 235, faction: 'common', factionVariants: { allied: { name: '盟军持续轨道空间站', shortLabel: '盟军轨道空间站' }, soviet: { name: '轨道重型工程站', shortLabel: '轨道重型工程站' } }, aliases: ['轨道空间站工程舱', '轨道空间站', '盟军持续轨道空间站', '盟军持续轨道节点实现', '轨道重型工程站', '月面有人前哨站', '月面有人基地', '月面采矿加工站', '空间太阳能试验站', '八百公里同步环轨重载投射与工业综合体'], defaultPrereqHint: '需建筑：航天发射中心' },
  { id: 'rs_chrono', name: '超时空传送仪（初级）', shortLabel: '超时空传送仪', system: 'research_space', laneLabel: '战略超级武器', x: 180, y: 380, faction: 'allied', factionVariants: { yuri: { name: '基因崩解与神经凋亡共振阵列', shortLabel: '基因突变共振阵列' } }, aliases: ['超时空传送仪', '超时空传送器', '超时空传送阵列', '轨道超时空中继器', '基因突变器', '尤里基因突变器', '基因崩解与神经凋亡共振阵列'], defaultPrereqHint: '需建筑：盟军战斗实验室' },
  { id: 'rs_weather', name: '天气控制仪（初级）', shortLabel: '天气控制仪', system: 'research_space', laneLabel: '战略超级武器', x: 395, y: 380, faction: 'allied', factionVariants: { yuri: { name: '心灵支配仪', shortLabel: '心灵支配仪' } }, aliases: ['天气控制机', '天气控制仪', '气象控制仪', '天气控制仪增强设施', '天基超级光棱炮地面端', '天基超级光棱炮', '心灵支配仪', '心灵控制器'], defaultPrereqHint: '需建筑：盟军战斗实验室' },
  { id: 'rs_iron', name: '铁幕装置', shortLabel: '铁幕装置', system: 'research_space', laneLabel: '战略超级武器', x: 610, y: 380, faction: 'soviet', aliases: ['铁幕发生器', '铁幕多节点偏折网络', '铁幕多节点网络升级'], defaultPrereqHint: '需建筑：红星实验设计局综合体' },
  { id: 'rs_nuke', name: '核导弹工程与地下发射群', shortLabel: '核弹发射井/赤星', system: 'research_space', laneLabel: '战略超级武器', x: 825, y: 380, faction: 'soviet', aliases: ['核弹发射井', '战术核导弹发射井', '苏联核弹发射井', '赤星轨道战略投送阵列', '轨道武器平台'], defaultPrereqHint: '需建筑：红星实验设计局综合体' },
];

export const BLUEPRINT_EDGES: readonly (BuildingBlueprintEdge & { system: BuildingSystemId })[] = [
  // 1. military edges
  { id: 'e_mil_1', system: 'military', from: 'mil_conyard', to: 'mil_barracks' },
  { id: 'e_mil_2', system: 'military', from: 'mil_barracks', to: 'mil_equip' },
  { id: 'e_mil_3', system: 'military', from: 'mil_equip', to: 'mil_academy' },
  { id: 'e_mil_4', system: 'military', from: 'mil_conyard', to: 'mil_warfactory' },
  { id: 'e_mil_5', system: 'military', from: 'mil_warfactory', to: 'mil_depot' },
  { id: 'e_mil_6', system: 'military', from: 'mil_depot', to: 'mil_indplant' },
  { id: 'e_mil_6b', system: 'military', from: 'mil_indplant', to: 'mil_apoc_bay' },
  { id: 'e_mil_7', system: 'military', from: 'mil_conyard', to: 'mil_airforce' },
  { id: 'e_mil_8', system: 'military', from: 'mil_airforce', to: 'mil_airradar' },
  { id: 'e_mil_8b', system: 'military', from: 'mil_airradar', to: 'mil_kirov_hangar' },
  { id: 'e_mil_9', system: 'military', from: 'mil_conyard', to: 'mil_dock' },
  { id: 'e_mil_10', system: 'military', from: 'mil_dock', to: 'mil_shipyard' },
  { id: 'e_mil_10b', system: 'military', from: 'mil_shipyard', to: 'mil_dreadnought_dock' },
  { id: 'e_mil_11', system: 'military', from: 'mil_conyard', to: 'mil_mecha_shop' },
  { id: 'e_mil_12', system: 'military', from: 'mil_mecha_shop', to: 'mil_mecha_pod' },
  { id: 'e_mil_13', system: 'military', from: 'mil_mecha_pod', to: 'mil_mecha_vault' },

  // 2. defense edges (far -> mid -> near -> core)
  { id: 'e_def_1', system: 'defense', from: 'def_far_radar', to: 'def_mid_flak' },
  { id: 'e_def_2', system: 'defense', from: 'def_far_patriot', to: 'def_mid_prism' },
  { id: 'e_def_3', system: 'defense', from: 'def_far_s300', to: 'def_mid_tesla' },
  { id: 'e_def_4', system: 'defense', from: 'def_far_gap', to: 'def_mid_at' },
  { id: 'e_def_5', system: 'defense', from: 'def_mid_flak', to: 'def_near_pillbox' },
  { id: 'e_def_6', system: 'defense', from: 'def_mid_prism', to: 'def_near_bunker' },
  { id: 'e_def_7', system: 'defense', from: 'def_mid_tesla', to: 'def_near_flame' },
  { id: 'e_def_8', system: 'defense', from: 'def_mid_at', to: 'def_near_wall' },
  { id: 'e_def_9', system: 'defense', from: 'def_near_pillbox', to: 'def_core_bunker' },
  { id: 'e_def_10', system: 'defense', from: 'def_near_bunker', to: 'def_core_fire' },
  { id: 'e_def_11', system: 'defense', from: 'def_near_flame', to: 'def_core_repair' },
  { id: 'e_def_12', system: 'defense', from: 'def_near_wall', to: 'def_core_decon' },

  // 3. agro edges (base -> primary -> process -> recycle + feedback loop)
  { id: 'e_agro_1', system: 'agro', from: 'agro_farmland', to: 'agro_greenhouse' },
  { id: 'e_agro_2', system: 'agro', from: 'agro_water', to: 'agro_hydro' },
  { id: 'e_agro_3', system: 'agro', from: 'agro_seed', to: 'agro_greenhouse' },
  { id: 'e_agro_4', system: 'agro', from: 'agro_feed', to: 'agro_livestock' },
  { id: 'e_agro_5', system: 'agro', from: 'agro_feed', to: 'agro_poultry' },
  { id: 'e_agro_6', system: 'agro', from: 'agro_water', to: 'agro_aqua' },
  { id: 'e_agro_7', system: 'agro', from: 'agro_greenhouse', to: 'agro_grain' },
  { id: 'e_agro_8', system: 'agro', from: 'agro_hydro', to: 'agro_grain' },
  { id: 'e_agro_9', system: 'agro', from: 'agro_livestock', to: 'agro_meat' },
  { id: 'e_agro_10', system: 'agro', from: 'agro_poultry', to: 'agro_meat' },
  { id: 'e_agro_11', system: 'agro', from: 'agro_aqua', to: 'agro_cold' },
  { id: 'e_agro_12', system: 'agro', from: 'agro_grain', to: 'agro_cold' },
  { id: 'e_agro_13', system: 'agro', from: 'agro_meat', to: 'agro_cold' },
  { id: 'e_agro_14', system: 'agro', from: 'agro_livestock', to: 'agro_biogas' },
  { id: 'e_agro_15', system: 'agro', from: 'agro_meat', to: 'agro_biogas' },
  { id: 'e_agro_16', system: 'agro', from: 'agro_grain', to: 'agro_wastewater' },
  { id: 'e_agro_17', system: 'agro', from: 'agro_cold', to: 'agro_incinerator' },
  { id: 'e_agro_fb_1', system: 'agro', from: 'agro_biogas', to: 'agro_farmland', label: '沼液有机肥与热电回灌', feedback: true },
  { id: 'e_agro_fb_2', system: 'agro', from: 'agro_wastewater', to: 'agro_water', label: '再生水循环回补', feedback: true },

  // 4. industry edges
  { id: 'e_ind_1', system: 'industry', from: 'ind_power', to: 'ind_solar' },
  { id: 'e_ind_2', system: 'industry', from: 'ind_solar', to: 'ind_tesla_plant' },
  { id: 'e_ind_3', system: 'industry', from: 'ind_tesla_plant', to: 'ind_smr' },
  { id: 'e_ind_4', system: 'industry', from: 'ind_smr', to: 'ind_fusion' },
  { id: 'e_ind_5', system: 'industry', from: 'ind_refinery', to: 'ind_oil' },
  { id: 'e_ind_6', system: 'industry', from: 'ind_oil', to: 'ind_synfuel' },
  { id: 'e_ind_7', system: 'industry', from: 'ind_synfuel', to: 'ind_nanite' },
  { id: 'e_ind_8', system: 'industry', from: 'ind_nanite', to: 'ind_heavy' },
  { id: 'e_ind_9', system: 'industry', from: 'ind_power', to: 'ind_grid' },
  { id: 'e_ind_10', system: 'industry', from: 'ind_refinery', to: 'ind_silo' },
  { id: 'e_ind_11', system: 'industry', from: 'ind_synfuel', to: 'ind_oiltank' },
  { id: 'e_ind_12', system: 'industry', from: 'ind_oiltank', to: 'ind_rail' },

  // 5. research_space edges
  { id: 'e_rs_1', system: 'research_space', from: 'rs_taclab', to: 'rs_battlelab' },
  { id: 'e_rs_2', system: 'research_space', from: 'rs_battlelab', to: 'rs_redstar' },
  { id: 'e_rs_3', system: 'research_space', from: 'rs_redstar', to: 'rs_supercomp' },
  { id: 'e_rs_4', system: 'research_space', from: 'rs_supercomp', to: 'rs_quantum' },
  { id: 'e_rs_5', system: 'research_space', from: 'rs_taclab', to: 'rs_sat' },
  { id: 'e_rs_6', system: 'research_space', from: 'rs_sat', to: 'rs_launchpad' },
  { id: 'e_rs_7', system: 'research_space', from: 'rs_launchpad', to: 'rs_rocket' },
  { id: 'e_rs_8', system: 'research_space', from: 'rs_rocket', to: 'rs_station' },
  { id: 'e_rs_9', system: 'research_space', from: 'rs_battlelab', to: 'rs_chrono' },
  { id: 'e_rs_10', system: 'research_space', from: 'rs_battlelab', to: 'rs_weather' },
  { id: 'e_rs_11', system: 'research_space', from: 'rs_battlelab', to: 'rs_iron' },
  { id: 'e_rs_12', system: 'research_space', from: 'rs_battlelab', to: 'rs_nuke' },
];

/**
 * 依据建筑名称与标签精确归类所属五大建筑体系（纯函数，覆盖世界书全部 195 座建筑）
 * 注意：绝不将长文本 `desc` 拼入正则探测，避免建筑背景描述中提及“防空/掩体/生态/精炼/能源”导致跨体系串台误判！
 */
export function classifyBuildingSystem(item: {
  name: string;
  desc?: string;
  tags?: readonly string[];
  category?: string;
  system?: BuildingSystemId | (string & {});
}): BuildingSystemId {
  // 第一优先级：直接消费世界书 <数据> 块显式声明的 system 字段（SSOT 单一事实源，兼容 agriculture -> agro）
  const rawSys = typeof item.system === 'string' ? item.system.trim() : '';
  if (rawSys === 'agriculture') {
    return 'agro';
  }
  if (
    rawSys === 'military' ||
    rawSys === 'defense' ||
    rawSys === 'agro' ||
    rawSys === 'industry' ||
    rawSys === 'research_space'
  ) {
    return rawSys;
  }

  const n = (item.name || '').trim();
  const t = (item.tags ?? []).join(' ');

  // 1. 农畜生态与环保水务闭环（30 座：通用·农畜业 12 + 通用·环保与公共设施 14 + 深井泵站与水文净化设施 1 + 尤里农畜 3）
  if (
    /农田|水利|土壤培育|规模化种植|菌类培养|多倍体速生巨菌|温室|水培|畜牧|智能养殖|家禽|昆虫蛋白|水产养殖|育种|种质|异界奇珍种质|饲料|合成生物蛋白|狂暴激素营养槽|屠宰|离体肌束与无神经培养肉|口粮|粮食加工|食品加工|冷链|气调|生态副食|有机循环|沼气|废水|污水|深井泵站|净水与供水|垃圾焚烧|废物分拣|电子产品回收|塑料回收|大气净化|生态修复|危废|碳捕集|社区环卫|生态公园|环境监测站/.test(
      n,
    )
  ) {
    return 'agro';
  }

  // 2. 能源与工业基建（46 座：发电/核能/电网储能/嗜热菌反应堆/脑波谐振变电枢 + 矿业采掘/炼油/化工/弹药/纳米合成/盾构/脑波协同广播 + 矿仓/油罐/重装总库/物流/管道/铁路）
  if (
    /发电厂|电厂|生化反应炉|高能厌氧生化反应炉|高密度生物质热解发电|奴隶矿场|自动化神经劳工采掘|光伏|太阳能板|风力发电|光能发电|同位素电源|RTG|磁能反应炉|深层地热-嗜热菌电化学复合反应堆|核反应堆|SMR|裂变|快堆|聚变|红色太阳|深层脑波谐振与灵能电容|燃气\/燃油发电机|应急柴油发电机|蓄电池组|电力分配节点|生物电容与脑波谐振变电枢|智能电网|超导磁储能|超导脉冲电网|矿石精炼|抽油机|油井|炼油厂|化工合成厂|煤制油|合成燃料|弹药制造厂|小型纳米合成工坊|纳米催化|重化工业|微型盾构机|巨型自动化矿业综合体|阿尔法脑波协同广播与多巴胺节律中枢|大宗资源与矿石储仓|矿料仓|战备燃料与分散储罐区|油罐区|综合战备与重装周转总库|区域物流枢纽|无人立体仓储|无人仓储与最优调度|地下高速管道枢纽|战略铁路编组|地下重载军运|潜意识诱导黑市|暗网物资枢纽/.test(
      n,
    )
  ) {
    return 'industry';
  }

  // 3. 科研航天与战略超级武器（50 座：实验室/设计局/科学城/基因心灵研究院/高维意识科学院/情报分析/超算/量子 + 卫星/测控/发射场/火箭/空间站/轨道/月球 + 盟苏尤超武）
  if (
    /战斗实验室|作战实验室|战术科研|红星实验设计局|红星设计局|科学城|基因测序与心灵谐振|认知神经科学与心灵工程院|双螺旋生命工程|高维意识科学院|基因突变与合成生物学圣殿|联合科研|情报分析中心|超算中心|量子超算|阿卡夏集体潜意识超算|卫星测控|间谍卫星上行|深空测控|航天发射|山体发射场|稳定入轨|反重力飞碟工程与亚轨道弹射井|火箭制造厂|运载火箭|轨道侦察|轨道脑波折射卫星网|在轨燃料|地月转运|轨道船坞|轨道空间站|轨道重型工程|持续轨道|月面|月球空间站|空间太阳能|空间核动力|同步环轨|超时空传送|超时空中继|天气控制|气象控制|铁幕|核弹发射井|核导弹工程|心灵控制器|心灵支配仪|行星级心灵共振放大器|基因突变器|基因崩解与神经凋亡共振阵列|天基基因突变散播阵列|天基超级光棱|天基光棱|赤星轨道|轨道武器平台/.test(
      n,
    )
  ) {
    return 'research_space';
  }

  // 4. 军工生产（42 座：建造厂/工程扩建/前沿节点 + 兵营/训导营/感化院/军校/克隆缸/素体培育/个人装备 + 战车/生物机电战车/工业工厂/维修/部队回收/天启/母脑湿件/装甲再生/军工综合体/兵工城/柔性生产 + 空军/神经航空引导盘/空天/基洛夫/飞碟整备 + 船坞/造船/半潜仿生造船/潜艇/半潜消磁船坞 + 机娘再造舱/意识保险库）
  if (
    /建造厂|Sputnik|大规模工程扩建|兵营|新兵训导营|克隆缸|生物克隆与素体培育|基因克隆|个人装备制造所|心灵重塑与认知感化院|心灵装具|陆军军校|复制中心|战车工厂|生物机电战车总装厂|苏维埃工业工厂|战地维修所|部队回收厂|Crusher|天启超重总装|母脑湿件培育与特装总装跨|装甲储备与装备再生|全自动军工综合体|国家总动员兵工城|巨型联合兵工厂|数字孪生与柔性生产|预测性健康维护|预测维护改造|空军指挥部|神经航空引导盘|空天飞机维护|基洛夫巨型收纳|环形磁流体飞碟整备|简易船坞|海军造船厂|半潜与仿生造船厂|尤里潜艇船坞|扩大版造船厂|无畏重型船坞|半潜消磁船坞与龟背重弹装填栈桥|战略堡垒潜艇|超级造船综合体|机娘整备|纳米躯体再造舱|意识保险库/.test(
      n,
    )
  ) {
    return 'military';
  }

  // 5. 防御纵深（71 座：远/中/近程防空与反导/苍穹之眼/深层神经态势与防空指挥/要塞巨炮/火炮/光棱/磁电谐振棱镜塔/磁暴/精神控制/心灵控制塔/盖特/哨戒/碉堡/神经-液冷重装碉堡/自愈合装甲外皮/围墙/复合生化护墙/雷区/隐身屏障/认知迷雾/感知探针/心灵感应器/电战网战/心灵网络转译信标/C4ISR/地下掩体/防夺舍认证门禁/生化负压消洗/后勤医疗/装甲机堡库）
  if (
    /防空|爱国者|苍穹之眼|S-300|THAAD|GPI|高射炮|盖特机炮|光棱塔|磁电谐振棱镜塔|磁暴线圈|精神控制塔|心灵控制塔|心灵感应器|心灵探测仪|反坦克|反装甲炮|法式要塞巨炮|迫击炮巢|榴弹炮阵地|多管火箭炮|区域防御要塞|哨戒炮|遥控武器站|碉堡|坦克碉堡|神经-液冷重装碉堡|活性生物凝胶自愈合装甲外皮|火焰塔|近防系统|围墙|复合生化护墙|护城墙|反载具障碍带|纳米雷区|路障|裂缝产生器|认知迷雾与潜意识幻象发生器|全谱电磁|广谱特征屏蔽|纳米诱饵|拟态伪装|照明塔|远程预警雷达|综合感知塔|哨戒探针|通讯中继桩|心灵网络转译信标|电子战干扰站|网络战中心|先进态势|深层神经态势与防空指挥|全域战场感知中枢|红星工控防护|地下掩体|强化掩体|强化地下掩蔽所|活体神经签名与防夺舍认证门禁|深层地下综合体|国家连续性深层地下要塞|地下国家连续性|消防损管|战地抢修塔|防化洗消|三级生化负压密封与消洗隔离模块|野战医疗站|前线综合后勤站|野战物资库|模块化战勤生活营区|临时羁押与特种看押所|重型装甲掩蔽库|战备硬化机堡/.test(
      n,
    )
  ) {
    return 'defense';
  }

  // 兜底：若遇到自定义新建筑，仅按 tags 判定（不读 desc）
  if (/农畜|农业|环保|水务/.test(t)) return 'agro';
  if (/防御工事|防御建筑|区域拒止/.test(t)) return 'defense';
  if (/战略超级武器|航天工业|航天工程|空间工程|科技核心|前沿科研/.test(t)) return 'research_space';
  if (/能源|资源产出|物流仓储|油料储存/.test(t)) return 'industry';
  return 'military';
}

export function inferBuildingFaction(item: {
  id?: string;
  name: string;
  faction?: string;
  tags?: readonly string[];
}): 'common' | 'allied' | 'soviet' | 'yuri' | (string & {}) {
  // 第一优先级：世界书 <数据> 块显式 faction 字段
  const f = (item.faction || '').trim();
  const fLower = f.toLowerCase();
  if (fLower === 'allied' || f === '盟军') return 'allied';
  if (fLower === 'soviet' || f === '苏联' || f === '苏军' || f === '苏维埃') return 'soviet';
  if (fLower === 'yuri' || fLower === 'epsilon' || /尤里|心灵|厄普西隆/.test(f)) return 'yuri';
  if (fLower && fLower !== 'common' && f !== '通用' && f !== '公共') {
    return normalizeBuildingFactionFilter(f);
  }
  if (fLower === 'common' || f === '通用' || f === '公共') {
    // 仍对名字明显带阵营前缀的条目做精化识别
    if (/^(?:尤里|厄普西隆|生化反应炉|奴隶矿场|精神控制塔|心灵控制塔|心灵支配仪|心灵控制器|心灵感应器|心灵探测仪|基因突变器|克隆缸|部队回收厂|盖特机炮|坦克碉堡|基因测序|双螺旋|神经航空引导盘|基因突变与合成生物学圣殿|认知神经科学与心灵工程院)/.test(item.name)) {
      return 'yuri';
    }
    if (/^(?:苏联|苏军|苏维埃|红星|磁暴|铁幕|基洛夫|无畏|天启|赤星|红色太阳|复制中心|Sputnik|Crusher)/.test(item.name)) {
      return 'soviet';
    }
    if (/^(?:盟军|爱国者|光棱|裂缝产生器|超时空|天气控制|法式要塞巨炮|THAAD|GPI)/.test(item.name)) {
      return 'allied';
    }
    return 'common';
  }
  const idAndName = `${item.id || ''} ${item.name}`;
  const tagsText = (item.tags ?? []).join(' ');
  if (
    /bld\.yuri|尤里特色|心灵军团/.test(`${idAndName} ${tagsText}`) ||
    /尤里|厄普西隆|生化反应炉|高密度生物质热解|奴隶矿场|自动化神经劳工|精神控制塔|心灵控制塔|心灵控制增幅|心灵支配仪|心灵控制器|行星级心灵共振|心灵感应器|心灵探测仪|广域脑波侦测|神经迷雾与感官屏蔽|神经毒素喷射塔|基因狂暴抑止|基因突变器|天基基因突变|克隆缸|胚胎复制与记忆灌注|部队回收厂|生物质与金属解构|盖特机炮|双联盖特|坦克碉堡|神经接驳坦克掩体|神经航空引导盘|神经制空引导盘|脑波共鸣空域|深海幽灵潜艇母港|心灵突触与基因容器|合成生物蛋白与狂暴激素|深层脑波谐振与灵能电容|潜意识诱导黑市|基因测序与心灵谐振|认知神经科学与心灵工程院|双螺旋生命工程|基因突变与合成生物学圣殿|阿卡夏集体潜意识|反重力飞碟工程|轨道脑波折射|月面心灵共鸣/i.test(idAndName)
  ) {
    return 'yuri';
  }
  if (/bld\.soviet|苏联特色/.test(`${idAndName} ${tagsText}`) || /苏联|苏军|苏维埃|红星|磁暴|铁幕|基洛夫|无畏|天启|赤星|红色太阳|复制中心|Sputnik|Crusher/i.test(idAndName)) {
    return 'soviet';
  }
  if (/bld\.allied|盟军特色/.test(`${idAndName} ${tagsText}`) || /盟军|爱国者|光棱|裂缝产生器|超时空|天气控制|法式要塞巨炮|THAAD|GPI|RTG/i.test(idAndName)) {
    return 'allied';
  }
  return 'common';
}

export const STANDARD_SYSTEM_SUBGROUPS: ReadonlySet<string> = new Set([
  '中枢原点与步兵训练线',
  '地面装甲与重工总装线',
  '航空母港与空天线',
  '远洋舰船与船坞线',
  '机娘整备与心智保障线',
  '外圈·远程预警反导与隐身屏蔽',
  '中圈·中程防空与反甲火力网',
  '内圈·近程点防工事与雷障',
  '内核·地下掩体/医疗后勤/C4ISR',
  '阶段Ⅰ · 水土环控与种饲底座',
  '阶段Ⅱ · 初级种养生产舱',
  '阶段Ⅲ · 精深加工与冷链储备',
  '阶段Ⅳ · 环保再生与沼气回灌',
  '发电与储能电网',
  '矿业采掘与重化工',
  '战略仓储与物流铁道',
  '科研中枢与超算阶梯',
  '航天与深空轨道工程',
  '战略超级武器',
]);

export function inferSystemSubGroup(sys: BuildingSystemId, name: string, explicitSubGroup?: string): string {
  // 第一优先级：世界书 <数据> 块显式 system_group 字段（但必须属于 18 个标准子分组，防止某阵营自创非标组名脱离苏盟同组对比）
  const trimmedExplicit = explicitSubGroup?.trim() ?? '';
  if (trimmedExplicit && STANDARD_SYSTEM_SUBGROUPS.has(trimmedExplicit)) {
    return trimmedExplicit;
  }
  const n = name.trim();
  if (sys === 'defense') {
    if (/THAAD|GPI|爱国者|苍穹之眼|综合感知塔|哨戒探针|远程预警雷达|心灵感应器|心灵探测仪|广域脑波侦测|裂缝产生器|认知迷雾与潜意识幻象发生器|神经迷雾与感官屏蔽|全谱电磁|广谱特征屏蔽|防空指挥|深层神经态势与防空指挥/.test(n)) {
      return '外圈·远程预警反导与隐身屏蔽';
    }
    if (/高射炮|中程防空|盖特机炮|双联盖特|光棱塔|磁电谐振棱镜塔|磁暴线圈|精神控制塔|心灵控制塔|反装甲炮|反坦克|法式要塞巨炮|榴弹炮阵地|多管火箭炮|迫击炮巢|区域防御要塞/.test(n)) {
      return '中圈·中程防空与反甲火力网';
    }
    if (/哨戒炮|遥控武器站|神经毒素喷射塔|基因狂暴抑止|碉堡|坦克碉堡|神经-液冷重装碉堡|活性生物凝胶自愈合装甲外皮|神经接驳坦克掩体|近程防空|近防系统|火焰塔|围墙|复合生化护墙|护城墙|反载具障碍带|纳米雷区|纳米诱饵|拟态伪装|照明塔|强化掩体/.test(n)) {
      return '内圈·近程点防工事与雷障';
    }
    return '内核·地下掩体/医疗后勤/C4ISR';
  }
  if (sys === 'agro') {
    if (/有机循环|废水处理|污水处理|垃圾焚烧|废物分拣|电子产品回收|塑料回收|大气净化|危废|碳捕集|社区环卫|环境监测站/.test(n)) {
      return '阶段Ⅳ · 环保再生与沼气回灌';
    }
    if (/粮食加工|口粮|食品加工|冷链|生态副食|屠宰|离体肌束与无神经培养肉/.test(n)) {
      return '阶段Ⅲ · 精深加工与冷链储备';
    }
    if (/规模化种植|温室|水培|菌类培养|多倍体速生巨菌|智能养殖|畜牧|家禽|昆虫蛋白|水产养殖/.test(n)) {
      return '阶段Ⅱ · 初级种养生产舱';
    }
    return '阶段Ⅰ · 水土环控与种饲底座';
  }
  if (sys === 'industry') {
    if (/发电|电厂|生化反应炉|高能厌氧生化反应炉|高密度生物质热解发电|太阳能板|光伏|风力发电|光能发电|同位素电源|RTG|磁能反应炉|深层地热-嗜热菌电化学复合反应堆|核反应堆|SMR|裂变发电|快堆|聚变|红色太阳|深层脑波谐振与灵能电容|电力分配|生物电容与脑波谐振变电枢|智能电网|超导磁储能|超导脉冲电网|蓄电池组/.test(n)) {
      return '发电与储能电网';
    }
    if (/储仓|矿料仓|储罐区|油罐区|周转总库|物流枢纽|无人仓储|高速管道|战略铁路|重载军运|潜意识诱导黑市|暗网物资枢纽/.test(n)) {
      return '战略仓储与物流铁道';
    }
    return '矿业采掘与重化工';
  }
  if (sys === 'research_space') {
    if (/超时空|天气控制|气象控制|铁幕|核导弹|核弹发射井|天基超级光棱|赤星轨道|轨道武器平台|心灵控制器|心灵支配仪|行星级心灵共振放大器|基因突变器|基因崩解与神经凋亡共振阵列|天基基因突变散播阵列/.test(n)) {
      return '战略超级武器';
    }
    if (/卫星|深空测控|航天发射|山体发射场|稳定入轨|反重力飞碟工程与亚轨道弹射井|火箭制造厂|运载火箭|空间站|轨道|地月|月面|空间太阳能|空间核动力|同步环轨/.test(n)) {
      return '航天与深空轨道工程';
    }
    return '科研中枢与超算阶梯';
  }
  if (/意识保险库|纳米躯体再造舱|心灵突触与基因容器调律舱|机娘/.test(n)) return '机娘整备与心智保障线';
  if (/船坞|造船|潜艇/.test(n)) return '远洋舰船与船坞线';
  if (/空军|神经航空引导盘|神经制空引导盘|脑波共鸣空域指挥塔|空天|基洛夫|环形磁流体飞碟整备/.test(n)) return '航空母港与空天线';
  if (/战车|生物机电战车总装厂|心灵军工与合成战车|脑波机械与悬浮底盘|苏维埃工业工厂|维修|部队回收厂|生物质与金属解构回收|Crusher|天启|母脑湿件培育与特装总装跨|装甲储备|军工综合体|兵工城|联合兵工厂|数字孪生|预测维护/.test(n)) {
    return '地面装甲与重工总装线';
  }
  return '中枢原点与步兵训练线';
}

export function buildMetricsForSystem(
  sysId: BuildingSystemId,
  nodes: BuildingBlueprintNode[],
  builtList: BuiltFacilitySummary[],
  ctx: { powerGen: number; powerUse: number; techDoneCount: number },
): BuildingSystemMetric[] {
  const totalBuilt = builtList.reduce((s, f) => s + f.count, 0);
  const totalRunning = builtList.reduce((s, f) => s + f.runningCount, 0);
  const totalAccel = builtList.reduce((s, f) => s + f.accelModeCount, 0);

  if (sysId === 'military') {
    const accelMult = (1 + 0.5 * totalAccel).toFixed(1);
    const mechaNodes = nodes.filter(n => n.laneLabel === '机娘保障线' && n.state === 'built').length;
    return [
      { label: '军工设施总数', value: `${totalBuilt} 座`, subText: `运转中 ${totalRunning} 座`, tone: totalRunning > 0 ? 'ok' : 'muted' },
      { label: '并联加速倍率', value: `×${accelMult}`, subText: `加速态 ${totalAccel} 座 / 生产态 ${Math.max(0, totalBuilt - totalAccel)} 座`, tone: totalAccel > 0 ? 'accent' : 'muted' },
      { label: '已建产线种类', value: `${nodes.filter(n => n.state === 'built').length}/${nodes.length}`, subText: '步兵/装甲/航空/舰船/机娘', tone: 'accent' },
      { label: '机娘保障设施', value: `${mechaNodes}/3 阶`, subText: mechaNodes >= 3 ? '心智保险库已就绪' : '整备工坊→再造舱→保险库', tone: mechaNodes > 0 ? 'ok' : 'warn' },
    ];
  }
  if (sysId === 'defense') {
    const ringCount = (r: DefenseRing) => nodes.filter(n => n.defenseRing === r && n.state === 'built').length;
    const far = ringCount('far');
    const mid = ringCount('mid');
    const near = ringCount('near');
    const core = ringCount('core');
    return [
      { label: '外圈·远程预警防空', value: `${far}/4 席`, subText: '雷达预警 / 区域防空 / 裂缝屏蔽', tone: far > 0 ? 'ok' : 'warn' },
      { label: '中圈·防空与反装甲', value: `${mid}/4 席`, subText: '高射炮 / 光棱 / 磁暴 / 反坦巨炮', tone: mid > 0 ? 'ok' : 'warn' },
      { label: '内圈·近程点防屏障', value: `${near}/4 席`, subText: '哨戒炮 / 碉堡 / 火焰塔 / 围墙', tone: near > 0 ? 'ok' : 'warn' },
      { label: '核心 · 掩体与损管', value: `${core}/4 席`, subText: '地下掩体 / 消防损管 / 抢修 / 洗消', tone: core > 0 ? 'accent' : 'muted' },
    ];
  }
  if (sysId === 'agro') {
    const stageCount = (s: AgroStage) => nodes.filter(n => n.agroStage === s && n.state === 'built').length;
    const biogasBuilt = nodes.find(n => n.id === 'agro_biogas')?.state === 'built';
    return [
      { label: '水源与育种基础', value: `${stageCount('base')}/4 席`, subText: '农田水利 / 净水 / 育种 / 饲料', tone: stageCount('base') > 0 ? 'ok' : 'muted' },
      { label: '农牧种养设施', value: `${stageCount('primary')}/5 席`, subText: '温室 / 水培 / 畜牧 / 家禽 / 水产', tone: stageCount('primary') > 0 ? 'ok' : 'muted' },
      { label: '精深加工与冷链', value: `${stageCount('process')}/3 席`, subText: '口粮精加工 / 肉联厂 / 气调冷链', tone: stageCount('process') > 0 ? 'accent' : 'muted' },
      { label: '沼气发电与循环', value: biogasBuilt ? '已并网运转' : `${stageCount('recycle')}/3 席`, subText: biogasBuilt ? '沼气并网发电 + 沼液肥田已生效' : '需建成有机循环处理站', tone: biogasBuilt ? 'ok' : 'warn' },
    ];
  }
  if (sysId === 'industry') {
    const net = ctx.powerGen - ctx.powerUse;
    return [
      { label: '电网总发电 / 耗电', value: `+${ctx.powerGen} / -${ctx.powerUse}`, subText: `净余电力 ${net >= 0 ? `+${net}` : net}`, tone: net >= 0 ? 'ok' : 'warn' },
      { label: '工业基建总座数', value: `${totalBuilt} 座`, subText: `运转中 ${totalRunning} 座`, tone: totalRunning > 0 ? 'ok' : 'muted' },
      { label: '采矿与燃料合成', value: `${nodes.filter(n => n.laneLabel === '采掘与重化工' && n.state === 'built').length}/5 阶`, subText: '矿石精炼 → 原油 → 合成燃料 → 纳米', tone: 'accent' },
      { label: '战略仓储与铁道', value: `${nodes.filter(n => n.laneLabel === '电网与战略物流' && n.state === 'built').length}/4 席`, subText: '电网节点 / 矿料仓 / 油罐 / 铁路编组', tone: 'accent' },
    ];
  }
  const superweapons = nodes.filter(n => n.laneLabel === '战略超级武器' && n.state === 'built').length;
  const spaceNodes = nodes.filter(n => n.laneLabel === '航天工程链' && n.state === 'built').length;
  return [
    { label: '科研与超算设施', value: `${nodes.filter(n => n.laneLabel === '科研与超算阶梯' && n.state === 'built').length}/5 阶`, subText: `已研发科技 ${ctx.techDoneCount} 项`, tone: 'accent' },
    { label: '航天发射设施', value: `${spaceNodes}/4 阶`, subText: '卫星测控 → 发射场 → 火箭厂 → 空间站', tone: spaceNodes > 0 ? 'ok' : 'muted' },
    { label: '已部署战略超武', value: `${superweapons} 座`, subText: '超时空 / 天气控制 / 铁幕 / 核弹井', tone: superweapons > 0 ? 'ok' : 'muted' },
    { label: '已建蓝图设施', value: `${nodes.filter(n => n.state === 'built').length}/${nodes.length}`, subText: `总建成 ${totalBuilt} 座`, tone: 'accent' },
  ];
}

