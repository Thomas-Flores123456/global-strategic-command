/**
 * detailDrawerBuildingHelpers.ts —— 建筑详情抽屉在场实例提取、空间选址预设与双轨立项指令拼装纯函数（FD-39 · PKG-D）
 *
 * 核心职责：
 * 1. `resolveDrawerBuildingInstances`：从当前基地 `base.buildings` 提取与当前详情建筑同名（兼容阵营前缀剥离与括号后缀）
 *    的全部在场/在建实例，结合 `resolveBuildingRelativeCoord` 计算三环坐标（`#1`、`#2`…）、层位、状态、进度与已挂 `addons`；
 * 2. `resolveAvailableLayerOptions` & `BUILDING_BEARING_PRESETS`：提供垂直空间层位与三环八方位战术预设选项；
 * 3. `buildSpatialBuildingDispatchOrder`：拼装平地新建（含多座序号、目标基地、层位、三环方位）、原位升阶（补差价）、母体挂载扩建战术指令；
 * 4. `buildDrawerInstanceQuickOrder`：为单座在场受损/双模实例生成紧急抢修或模式切换指令。
 *
 * 🔴 纯函数铁律：零 DOM / 零 Vue 组件导入 / 零酒馆 API，保障 `DetailDrawer.vue` 单文件 `compileScript` 测试 100% 兼容。
 */

import type { Base } from '../core/schema';
import {
  classifyBuildingRing,
  resolveBuildingRelativeCoord,
  ringToCnLabel,
  type BuildingRing,
  type RelativeCoord,
} from '../engines/buildingCoordEngine';

export interface DrawerBuildingInstanceItem {
  ordinal: number; // 1, 2, ...
  buildingIndex: number;
  name: string;
  state: '运转' | '建造中' | '受损' | '停机';
  layer: string;
  ring: BuildingRing;
  ringLabel: '核心' | '内环' | '中环' | '外环';
  bearingLabel: string;
  coord: RelativeCoord;
  mode: '生产' | '加速';
  dualModeCapable: boolean;
  progress?: number;
  eta?: string;
  addons: string[];
}

export type BuildingConstructStrategy = 'new' | 'upgrade' | 'addon';

export interface DrawerBuildingUpgradeInfo {
  mode: 'replace' | 'addon';
  standalone: boolean;
  upgradedName: string;
  hostLabel: string;
  cost: number;
  deltaCost: number;
  hasHostInCurrentBase: boolean;
  matchedHostInBase: string | null;
}

export interface SpatialBuildingDispatchParams {
  buildingTitle: string;
  baseName?: string;
  strategy?: BuildingConstructStrategy;
  layer?: string; // 'auto' 或具体层位名
  bearing?: string; // 'auto' 或具体方位/坐标描述
  customBearing?: string; // 用户手填的自定义方位/坐标（如 "东侧排风井旁 (2, 1)"）
  existingInstanceCount?: number; // 当前基地已有的同名实例数（含在建）
  upgradeInfo?: DrawerBuildingUpgradeInfo | null;
  targetHostOrdinal?: number; // 多座母体时指定挂载/升阶第几座母体
}

export const BUILDING_LAYER_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'auto', label: '自动/随基地默认层' },
  { value: '地表层', label: '地表层' },
  { value: '地下层', label: '地下层' },
  { value: '掩体入口', label: '掩体入口' },
  { value: '山体空腔', label: '山体空腔' },
];

export const BUILDING_BEARING_PRESETS: ReadonlyArray<{ value: string; label: string; ring: string }> = [
  { value: 'auto', label: '自动按职能三环布防', ring: 'auto' },
  { value: '正北内环 200m (0,+2)', label: '正北内环 200m (0,+2)', ring: 'inner' },
  { value: '正东内环 200m (+2,0)', label: '正东内环 200m (+2,0)', ring: 'inner' },
  { value: '正南内环 200m (0,-2)', label: '正南内环 200m (0,-2)', ring: 'inner' },
  { value: '正西内环 200m (-2,0)', label: '正西内环 200m (-2,0)', ring: 'inner' },
  { value: '东北中环 450m (+3,+3)', label: '东北中环 450m (+3,+3)', ring: 'mid' },
  { value: '东南中环 450m (+3,-3)', label: '东南中环 450m (+3,-3)', ring: 'mid' },
  { value: '西北中环 450m (-3,+3)', label: '西北中环 450m (-3,+3)', ring: 'mid' },
  { value: '西南中环 450m (-3,-3)', label: '西南中环 450m (-3,-3)', ring: 'mid' },
  { value: '正北外环 750m (0,+7.5)', label: '正北外环 750m (0,+7.5)', ring: 'outer' },
  { value: '正东外环 750m (+7.5,0)', label: '正东外环 750m (+7.5,0)', ring: 'outer' },
  { value: '正南外环 750m (0,-7.5)', label: '正南外环 750m (0,-7.5)', ring: 'outer' },
  { value: '正西外环 750m (-7.5,0)', label: '正西外环 750m (-7.5,0)', ring: 'outer' },
];

const DUAL_MODE_BUILDING_RE =
  /建造厂|基地车|MCV|前沿工地|作战前哨站|兵营|训导营|战车工厂|战车总装厂|重工车间|空军指挥部|战地机场|神经航空引导盘|造船厂|船坞/i;

/** 判定建筑是否支持生产/加速双模切换 */
export function isDrawerBuildingDualModeCapable(rawName: string): boolean {
  const s = String(rawName ?? '').trim();
  if (!s) return false;
  return DUAL_MODE_BUILDING_RE.test(s);
}

/** 提取显式阵营前缀（用于防止跨阵营同名建筑如「盟军建造厂」与「苏联建造厂」互相误匹配） */
function extractExplicitFactionPrefix(rawName: string): string | null {
  const s = String(rawName ?? '').trim();
  if (/^盟军/.test(s)) return 'allied';
  if (/^(?:苏联|苏军|苏维埃)/.test(s)) return 'soviet';
  if (/^尤里/.test(s)) return 'yuri';
  if (/^(?:升阳|旭日)/.test(s)) return 'rising_sun';
  if (/^焚风/.test(s)) return 'foehn';
  return null;
}

/** 剥离阵营前缀与括号后缀，提取标准建筑核心名 */
export function stripBuildingNameKey(rawName: string): string {
  return String(rawName ?? '')
    .trim()
    .replace(/\s*[（(][^（）()]*[）)]\s*$/g, '')
    .replace(/^(?:盟军|苏联|苏军|苏维埃|尤里|升阳|旭日|焚风)(?=.{2,})/u, '')
    .replace(/^建造厂核心$/, '建造厂')
    .trim();
}

/** 构建建筑标题可匹配的标准名候选集 */
function buildBuildingMatchKeys(
  buildingTitle: string,
  catalogBuildings?: readonly { name: string; aliases?: readonly string[] }[],
): { keys: Set<string>; explicitFaction: string | null } {
  const raw = String(buildingTitle ?? '').trim();
  const keys = new Set<string>();
  if (!raw) return { keys, explicitFaction: null };

  const withoutParens = raw.replace(/\s*[（(][^（）()]*[）)]\s*$/g, '').trim();
  const explicitFaction = extractExplicitFactionPrefix(withoutParens);

  const addCandidate = (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    keys.add(clean);
    const stripped = stripBuildingNameKey(clean);
    if (stripped) keys.add(stripped);
  };

  addCandidate(raw);
  addCandidate(withoutParens);

  // 若标题形如「盟军发电厂（发电厂）」，同时提取括号内的标准目录名
  const parenMatch = /[（(]([^（）()]+)[）)]\s*$/.exec(raw);
  if (parenMatch?.[1]) {
    addCandidate(parenMatch[1]);
  }

  if (Array.isArray(catalogBuildings)) {
    for (const cb of catalogBuildings) {
      if (!cb?.name) continue;
      const cbClean = stripBuildingNameKey(cb.name);
      if (keys.has(cb.name) || (cbClean && keys.has(cbClean))) {
        addCandidate(cb.name);
        for (const alias of cb.aliases ?? []) {
          if (typeof alias === 'string') addCandidate(alias);
        }
      }
    }
  }

  return { keys, explicitFaction };
}

/**
 * 提取当前基地内与 `buildingTitle` 同名的全部在场/在建建筑实例
 */
export function resolveDrawerBuildingInstances(
  buildingTitle: string,
  base: Base | null | undefined,
  catalogBuildings?: readonly { name: string; aliases?: readonly string[] }[],
): DrawerBuildingInstanceItem[] {
  const buildings = base?.buildings ?? [];
  if (!buildingTitle || !buildings.length) return [];

  const { keys, explicitFaction } = buildBuildingMatchKeys(buildingTitle, catalogBuildings);
  if (keys.size === 0) return [];

  const baseId = base?.id || base?.name || 'base-0';
  const result: DrawerBuildingInstanceItem[] = [];

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (!b || !b.name) continue;
    const rawState = String(b.state ?? '运转').trim();
    if (rawState === '被毁') continue;

    const bName = b.name.trim();
    const bExplicitFaction = extractExplicitFactionPrefix(bName);
    // 若查询标题与实例均带显式阵营前缀且阵营不同（如查询「盟军建造厂」vs 实例「苏联建造厂」），不视为同名实例
    if (explicitFaction && bExplicitFaction && explicitFaction !== bExplicitFaction) {
      continue;
    }

    const bKey = stripBuildingNameKey(bName);
    if (!keys.has(bName) && !(bKey && keys.has(bKey))) {
      continue;
    }

    const ordinal = result.length + 1;
    const spatial = resolveBuildingRelativeCoord(b, i, baseId);
    const state: DrawerBuildingInstanceItem['state'] =
      rawState === '建造中' || rawState === '受损' || rawState === '停机' ? rawState : '运转';
    const layer = typeof b.layer === 'string' && b.layer.trim() ? b.layer.trim() : '默认层';
    const mode: '生产' | '加速' = b.mode === '加速' ? '加速' : '生产';
    const addons = Array.isArray(b.addons)
      ? b.addons.map(a => String(a ?? '').trim()).filter(Boolean)
      : [];

    const item: DrawerBuildingInstanceItem = {
      ordinal,
      buildingIndex: i,
      name: bName,
      state,
      layer,
      ring: spatial.ring,
      ringLabel: spatial.ringLabel,
      bearingLabel: spatial.bearingLabel,
      coord: spatial.coord,
      mode,
      dualModeCapable: isDrawerBuildingDualModeCapable(bName),
      addons,
    };

    if (typeof b.progress === 'number' && Number.isFinite(b.progress)) {
      item.progress = b.progress;
    }
    if (typeof b.eta === 'string' && b.eta.trim()) {
      item.eta = b.eta.trim();
    }

    result.push(item);
  }

  return result;
}

/**
 * 解析当前基地可用的空间层位选项（默认层 + 四大标准预设层 + 本基地建筑/防区已出现的自定义层位）
 */
export function resolveAvailableLayerOptions(
  base: Base | null | undefined,
): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = BUILDING_LAYER_PRESETS.map(p => ({ ...p }));
  const seen = new Set<string>(options.map(o => o.value));
  seen.add('默认层');

  const addLayer = (raw: string | undefined) => {
    const clean = String(raw ?? '').trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    options.push({ value: clean, label: clean });
  };

  for (const b of base?.buildings ?? []) {
    addLayer(b?.layer);
  }
  for (const s of base?.sectors ?? []) {
    addLayer(s?.layer);
  }

  return options;
}

/**
 * 拼装建筑可视化空间选址与双轨立项战术指令（100% 兼容存量默认无参格式与 FD-38 排产空间规范）
 */
export function buildSpatialBuildingDispatchOrder(params: SpatialBuildingDispatchParams): string {
  const rawTitle = String(params.buildingTitle ?? '').trim();
  const cleanTitle = rawTitle.replace(/\s*（[^（）]+）\s*$/, '').trim() || rawTitle;
  const baseName = String(params.baseName ?? '').trim();
  const effectiveLayer =
    params.layer && params.layer.trim() && params.layer.trim() !== 'auto' ? params.layer.trim() : '';
  const customBearing = String(params.customBearing ?? '').trim();
  const presetBearing =
    params.bearing && params.bearing.trim() && params.bearing.trim() !== 'auto' ? params.bearing.trim() : '';
  const effectiveBearing = customBearing || presetBearing;

  const upgradeInfo = params.upgradeInfo ?? null;
  let strategy: BuildingConstructStrategy = params.strategy ?? 'new';
  if (!params.strategy && upgradeInfo) {
    if (upgradeInfo.mode === 'addon') {
      strategy = 'addon';
    } else if (upgradeInfo.mode === 'replace' && !upgradeInfo.standalone) {
      strategy = 'upgrade';
    }
  }

  const baseSuffix = baseName ? ` 基地: ${baseName}` : '';
  const layerSuffix = effectiveLayer ? ` 层级: ${effectiveLayer}` : '';
  const bearingSuffix = effectiveBearing ? ` 方位: ${effectiveBearing}` : '';

  if (strategy === 'upgrade' && upgradeInfo) {
    const baseHost = upgradeInfo.matchedHostInBase || upgradeInfo.hostLabel;
    const hostTarget =
      params.targetHostOrdinal && params.targetHostOrdinal > 0
        ? `${baseHost} #${params.targetHostOrdinal}`
        : baseHost;
    return `【指挥官战术指令】批准原位升级：将「${hostTarget}」升阶为 ${upgradeInfo.upgradedName}（补差价 $${upgradeInfo.deltaCost}）${baseSuffix}${layerSuffix}${bearingSuffix}`;
  }

  if (strategy === 'addon' && upgradeInfo) {
    const baseHost = upgradeInfo.matchedHostInBase || upgradeInfo.hostLabel;
    const hostTarget =
      params.targetHostOrdinal && params.targetHostOrdinal > 0
        ? `${baseHost} #${params.targetHostOrdinal}`
        : baseHost;
    return `【指挥官战术指令】批准扩建挂载：在「${hostTarget}」挂载 ${cleanTitle}（费用 $${upgradeInfo.cost}）${baseSuffix}${layerSuffix}${bearingSuffix}`;
  }

  const existingCount =
    typeof params.existingInstanceCount === 'number' && params.existingInstanceCount > 0
      ? Math.floor(params.existingInstanceCount)
      : 0;
  const ordinalSuffix = existingCount >= 1 ? `（第${existingCount + 1}座）` : '';

  return `【指挥官战术指令】批准建造：${ rawTitle }${ordinalSuffix}${baseSuffix}${layerSuffix}${bearingSuffix}`;
}

/**
 * 为单座在场建筑实例生成快捷战术指令（受损紧急抢修 / 生产⇄加速模式切换）
 */
export function buildDrawerInstanceQuickOrder(
  inst: Pick<DrawerBuildingInstanceItem, 'name' | 'ordinal' | 'bearingLabel' | 'mode'>,
  baseName?: string,
  action: 'repair' | 'switch_accel' | 'switch_prod' | 'toggle_mode' = 'repair',
): string {
  const cleanBase = String(baseName ?? '').trim();
  const baseSuffix = cleanBase ? ` 基地: ${cleanBase}` : '';

  if (action === 'repair') {
    return `【指挥官战术指令】紧急抢修受损建筑：${inst.name} #${inst.ordinal}（${inst.bearingLabel}）${baseSuffix}`;
  }

  const nextMode =
    action === 'switch_accel'
      ? '加速'
      : action === 'switch_prod'
        ? '生产'
        : inst.mode === '加速'
          ? '生产'
          : '加速';

  return `【指挥官战术指令】切换建筑产线模式：将「${inst.name} #${inst.ordinal}」切换为【${nextMode}】模式${baseSuffix}`;
}

export const buildInstanceQuickOrder = buildDrawerInstanceQuickOrder;

/**
 * 推导建筑详情面板展示的「防务圈层」描述文本
 */
export function formatBuildingDefenseRingParam(buildingName: string): string {
  const ring = classifyBuildingRing(buildingName);
  const ringLabel = ringToCnLabel(ring);
  const ringDesc =
    ring === 'core'
      ? 'MCV原点'
      : ring === 'inner'
        ? '能源科研中枢'
        : ring === 'outer'
          ? '防线超武工事'
          : '产线后勤母体';
  return `${ringLabel}（${ringDesc}）`;
}
