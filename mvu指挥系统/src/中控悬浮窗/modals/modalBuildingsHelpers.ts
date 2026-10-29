/**
 * modalBuildingsHelpers.ts
 * 基地建筑与五大体系总览弹窗（ModalBuildings.vue）纯计算、Dagre 自动拓扑、动态多阵营与实例写回辅助模块
 */
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre';
import toastr from 'toastr';
import type { StatData } from '../../红警指挥系统/core/schema';
import {
  resolveBuildingRelativeCoord,
  type BuildingRing,
  type ResolvedBuildingSpatial,
} from '../../红警指挥系统/engines/buildingCoordEngine';
import { fillHostSendInput } from '../../红警指挥系统/worldbook/hostSendInput';
import type { updateFloorVars as UpdateFloorVarsFn } from '../host/floorVarWrite';
import {
  isConyardBuildingName,
  type BuildingBlueprintEdge,
  type BuildingBlueprintNode,
  type BuildingNodeState,
  type BuildingSystemView,
  type BuiltBuildingInstanceRef,
  type SystemCatalogEntry,
} from '../models/buildingSystemModel';
import { stripFactionBuildingPrefix } from '../models/tagTaxonomy';

export const NODE_CARD_WIDTH = 172;
export const NODE_CARD_HEIGHT = 58;
export const NODE_HALF_WIDTH = NODE_CARD_WIDTH / 2; // 86
export const NODE_HALF_HEIGHT = NODE_CARD_HEIGHT / 2; // 29

export type BuildingModalSizeMode = 'wide' | 'full' | 'compact';
export type BuildingPrimaryViewMode = 'split' | 'live' | 'blueprint';
export type BuildingTopologyViewMode = 'cluster' | 'expanded';
export type BlueprintHighlightRole = 'focus' | 'upstream' | 'downstream' | 'dimmed' | 'none';

export function cycleBuildingModalSizeMode(mode: BuildingModalSizeMode): BuildingModalSizeMode {
  if (mode === 'wide') return 'full';
  if (mode === 'full') return 'compact';
  return 'wide';
}

export function resolveBuildingModalSizeLabel(mode: BuildingModalSizeMode): string {
  if (mode === 'full') return '全屏 96%';
  if (mode === 'compact') return '标准 1080';
  return '宽屏 90%';
}

export function computeBuildingModalDynamicStyle(
  mode: BuildingModalSizeMode,
  viewportWidth: number,
  viewportHeight: number,
): Record<string, string> {
  const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1280;
  const vh = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 820;
  if (mode === 'compact') {
    return {
      maxWidth: 'min(96vw, 1080px)',
      maxHeight: '90vh',
    };
  }
  const wRatio = mode === 'full' ? 0.96 : 0.9;
  const hRatio = mode === 'full' ? 0.94 : 0.9;
  const maxW = mode === 'full' ? 1720 : 1480;
  const maxH = mode === 'full' ? 1120 : 1040;
  const targetW = Math.max(360, Math.min(maxW, Math.round(vw * wRatio)));
  const targetH = Math.max(480, Math.min(maxH, Math.round(vh * hRatio)));
  return {
    maxWidth: `min(96vw, ${targetW}px)`,
    height: `min(94vh, ${targetH}px)`,
    maxHeight: '94vh',
  };
}

export interface BuildingFactionPillOption {
  id: string;
  label: string;
  shortBadge: string;
  accentColor: string;
  activeClass: string;
  inactiveClass: string;
  badgeClass: string;
  svgTextFill: string;
}

const YURI_BUILDING_NAME_RE =
  /尤里|厄普西隆|生化反应炉|厌氧生化|奴隶矿场|精神控制|心灵支配|心灵感应|心灵控制|心灵信标|心灵前哨|心灵重塑|基因突变|基因崩解|克隆缸|克隆与新兵|生物克隆|部队回收|盖特机炮|坦克碉堡|基因测序|双螺旋|高维意识|飞碟|雷鸣潜艇|生物机电战车|半潜与仿生|神经航空|磁流体飞碟|半潜消磁|苍穹之眼|认知迷雾|磁电谐振|神经-液冷|生化护墙|离体肌束|多倍体速生|异界奇珍|母脑湿件|阿尔法脑波|负压密封|活体神经签名|生物凝胶|嗜热菌|脑波谐振/;

const SOVIET_BUILDING_NAME_RE =
  /^(?:苏联|苏军|苏维埃)|磁能反应炉|磁暴线圈|铁幕装置|核导弹发射井|红星|天启超重|基洛夫|无畏级|动员兵|复制中心/;

const ALLIED_BUILDING_NAME_RE =
  /^盟军|光棱塔|裂缝产生器|超时空传送仪|天气控制机|爱国者防空|间谍卫星/;

export const YURI_NODE_VARIANT_FALLBACK: Readonly<
  Record<string, { name: string; shortLabel: string }>
> = {
  mil_conyard: { name: '尤里建造厂核心', shortLabel: '尤里建造厂' },
  mil_barracks: { name: '尤里克隆与新兵训导营', shortLabel: '尤里训导营' },
  mil_equip: { name: '心灵重塑与认知感化院', shortLabel: '心灵重塑感化院' },
  mil_academy: { name: '生物克隆与素体培育中心', shortLabel: '克隆培育中心' },
  mil_warfactory: { name: '尤里生物机电战车总装厂', shortLabel: '尤里战车总装厂' },
  mil_depot: { name: '尤里深层神经态势与防空指挥中心', shortLabel: '神经态势中心' },
  mil_apoc_bay: { name: '母脑湿件培育与特装总装跨', shortLabel: '母脑特装总装跨' },
  mil_airforce: { name: '神经航空引导盘', shortLabel: '神经航空引导盘' },
  mil_kirov_hangar: { name: '环形磁流体飞碟整备与微波充能巢', shortLabel: '飞碟整备充能巢' },
  mil_shipyard: { name: '尤里半潜与仿生造船厂', shortLabel: '尤里仿生造船厂' },
  mil_dreadnought_dock: { name: '半潜消磁船坞与龟背重弹装填栈桥', shortLabel: '半潜重弹船坞' },
  ind_power: { name: '高能厌氧生化反应炉', shortLabel: '厌氧生化反应炉' },
  ind_tesla_plant: { name: '深层地热-嗜热菌电化学复合反应堆', shortLabel: '地热嗜热菌反应堆' },
  ind_grid: { name: '生物电容与脑波谐振变电枢', shortLabel: '脑波谐振变电枢' },
  ind_heavy: { name: '阿尔法脑波协同广播与多巴胺节律中枢', shortLabel: '脑波协同广播枢' },
  def_far_radar: { name: '心灵感应器', shortLabel: '心灵感应器' },
  def_far_patriot: { name: '苍穹之眼高能微波与神经制导防空反导阵地', shortLabel: '苍穹之眼反导阵' },
  def_far_gap: { name: '认知迷雾与潜意识幻象发生器', shortLabel: '潜意识幻象发生器' },
  def_mid_flak: { name: '盖特机炮塔', shortLabel: '盖特机炮塔' },
  def_mid_prism: { name: '磁电谐振棱镜塔', shortLabel: '磁电谐振棱镜塔' },
  def_mid_tesla: { name: '心灵控制塔', shortLabel: '心灵控制塔' },
  def_near_bunker: { name: '并网式神经-液冷重装碉堡', shortLabel: '神经重装碉堡' },
  def_near_wall: { name: '尤里复合生化护墙', shortLabel: '尤里生化护墙' },
  def_core_decon: { name: '三级生化负压密封与消洗隔离模块', shortLabel: '生化负压隔离舱' },
  agro_seed: { name: '异界奇珍种质基因嵌合与异兽驯化温床', shortLabel: '基因嵌合驯化床' },
  agro_hydro: { name: '多倍体速生巨菌与弱光高能作物垂直塔', shortLabel: '速生巨菌垂直塔' },
  agro_meat: { name: '离体肌束与无神经培养肉矩阵', shortLabel: '离体培养肉矩阵' },
  rs_battlelab: { name: '基因测序与心灵谐振研究院', shortLabel: '基因心灵研究院' },
  rs_supercomp: { name: '基因测序与心灵谐振研究院', shortLabel: '基因心灵研究院' },
  rs_quantum: { name: '双螺旋生命工程与高维意识科学院', shortLabel: '高维意识科学院' },
  rs_chrono: { name: '基因崩解与神经凋亡共振阵列', shortLabel: '基因崩解阵列' },
  rs_weather: { name: '心灵支配仪', shortLabel: '心灵支配仪' },
};

export function normalizeBuildingFactionId(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return 'common';
  const lower = s.toLowerCase();
  if (lower === 'all' || s === '全部' || s === '全部阵营') return 'all';
  if (lower === 'common' || s === '通用') return 'common';
  if (lower === 'allied' || lower === 'allies' || s.includes('盟军')) return 'allied';
  if (lower === 'soviet' || s.includes('苏联') || s.includes('苏军') || s.includes('苏维埃')) return 'soviet';
  if (lower === 'yuri' || lower === 'epsilon' || s.includes('尤里') || s.includes('厄普西隆')) return 'yuri';
  if (lower === 'rising_sun' || lower === 'empire' || s.includes('升阳') || s.includes('旭日')) return 'rising_sun';
  if (lower === 'foehn' || s.includes('焚风')) return 'foehn';
  return lower;
}

export function buildFactionPillOption(
  rawId: string,
  rawLabel?: string,
  rawShortBadge?: string,
): BuildingFactionPillOption {
  const id = normalizeBuildingFactionId(rawId);
  if (id === 'all') {
    return {
      id: 'all',
      label: rawLabel || '全部阵营',
      shortBadge: rawShortBadge || '全',
      accentColor: 'var(--rac-accent)',
      activeClass: 'is-active bg-(--rac-accent)/20 font-bold text-(--rac-hi)',
      inactiveClass: 'text-(--rac-muted) hover:text-(--rac-hi)',
      badgeClass: 'border border-(--rac-accent)/40 bg-(--rac-panel-2) text-(--rac-accent)',
      svgTextFill: 'var(--rac-accent)',
    };
  }
  if (id === 'allied') {
    return {
      id: 'allied',
      label: rawLabel || '盟军体系',
      shortBadge: rawShortBadge || '盟',
      accentColor: 'var(--rac-accent)',
      activeClass: 'is-active bg-(--rac-accent)/20 font-bold text-(--rac-hi)',
      inactiveClass: 'text-(--rac-muted) hover:text-(--rac-accent)',
      badgeClass: 'border border-(--rac-accent)/40 bg-(--rac-panel-2) text-(--rac-accent)',
      svgTextFill: 'var(--rac-accent)',
    };
  }
  if (id === 'soviet') {
    return {
      id: 'soviet',
      label: rawLabel || '苏联体系',
      shortBadge: rawShortBadge || '苏',
      accentColor: 'var(--rac-alert)',
      activeClass: 'is-active bg-(--rac-alert)/20 font-bold text-(--rac-hi)',
      inactiveClass: 'text-(--rac-muted) hover:text-(--rac-alert)',
      badgeClass: 'border border-(--rac-alert)/45 bg-(--rac-panel-2) text-(--rac-alert)',
      svgTextFill: 'var(--rac-alert)',
    };
  }
  if (id === 'yuri') {
    return {
      id: 'yuri',
      label: rawLabel || '尤里体系',
      shortBadge: rawShortBadge || '尤',
      accentColor: 'var(--rac-warn)',
      activeClass: 'is-active bg-(--rac-warn)/20 font-bold text-(--rac-hi)',
      inactiveClass: 'text-(--rac-muted) hover:text-(--rac-warn)',
      badgeClass: 'border border-(--rac-warn)/50 bg-(--rac-panel-2) text-(--rac-warn)',
      svgTextFill: 'var(--rac-warn)',
    };
  }
  const baseName =
    id === 'rising_sun'
      ? '升阳'
      : id === 'foehn'
        ? '焚风'
        : (rawLabel || rawId).replace(/(?:体系|阵营)$/, '').trim() || id;
  const label = rawLabel
    ? /体系|阵营$/.test(rawLabel)
      ? rawLabel
      : `${rawLabel}体系`
    : `${baseName}体系`;
  const shortBadge = rawShortBadge || baseName.slice(0, 1).toUpperCase();
  return {
    id,
    label,
    shortBadge,
    accentColor: 'var(--rac-warn)',
    activeClass: 'is-active bg-(--rac-warn)/20 font-bold text-(--rac-hi)',
    inactiveClass: 'text-(--rac-muted) hover:text-(--rac-warn)',
    badgeClass: 'border border-(--rac-warn)/50 bg-(--rac-panel-2) text-(--rac-warn)',
    svgTextFill: 'var(--rac-warn)',
  };
}

export function resolveAvailableFactionPills(
  overview: unknown,
  snapshot?: StatData | null,
  catalog?: unknown,
): BuildingFactionPillOption[] {
  const map = new Map<string, BuildingFactionPillOption>();
  const register = (id: string, label?: string, shortBadge?: string) => {
    const norm = normalizeBuildingFactionId(id);
    if (!norm || norm === 'common') return;
    if (!map.has(norm)) {
      map.set(norm, buildFactionPillOption(norm, label, shortBadge));
    }
  };

  // 默认四大核心视角：全部阵营 / 盟军体系 / 苏联体系 / 尤里体系
  register('all', '全部阵营', '全');
  register('allied', '盟军体系', '盟');
  register('soviet', '苏联体系', '苏');
  register('yuri', '尤里体系', '尤');

  // 优先合并 overview.availableFactions（当 PKG-BLD-1 提供时）
  const ovFactions = (
    overview as {
      availableFactions?: ReadonlyArray<{ id?: string; label?: string; shortBadge?: string } | string>;
    } | null
  )?.availableFactions;
  if (Array.isArray(ovFactions)) {
    for (const item of ovFactions) {
      if (typeof item === 'string') {
        register(item);
      } else if (item && typeof item.id === 'string') {
        register(item.id, item.label, item.shortBadge);
      }
    }
  }

  // 动态提取 snapshot.command.unlocked_factions
  const unlocked = snapshot?.command?.unlocked_factions;
  if (Array.isArray(unlocked)) {
    for (const f of unlocked) {
      if (typeof f === 'string') register(f);
    }
  }

  // 动态提取 catalog.factionDefs 与 catalog.buildings 中的自定义阵营
  const catObj = catalog as {
    factionDefs?: ReadonlyArray<{ id?: string; name?: string }>;
    buildings?: ReadonlyArray<{ faction?: string }>;
  } | null;
  if (Array.isArray(catObj?.factionDefs)) {
    for (const fd of catObj.factionDefs) {
      if (fd?.id) register(fd.id, fd.name);
    }
  }
  if (Array.isArray(catObj?.buildings)) {
    for (const b of catObj.buildings) {
      if (typeof b?.faction === 'string' && b.faction.trim()) {
        register(b.faction);
      }
    }
  }

  return Array.from(map.values());
}

export interface ResolvedEntryFactionBadge {
  isCommon: boolean;
  factionId: string;
  label: string;
  shortBadge: string;
  badgeClass: string;
  svgTextFill: string;
}

export function resolveBuildingEntryFactionBadge(
  entry: { name?: string; faction?: string } | null | undefined,
  availablePills?: readonly BuildingFactionPillOption[],
): ResolvedEntryFactionBadge {
  const rawFaction = entry?.faction ? normalizeBuildingFactionId(entry.faction) : 'common';
  const rawName = String(entry?.name ?? '').trim();
  let factionId = rawFaction;
  if (factionId === 'common' && rawName) {
    if (YURI_BUILDING_NAME_RE.test(rawName)) factionId = 'yuri';
    else if (SOVIET_BUILDING_NAME_RE.test(rawName)) factionId = 'soviet';
    else if (ALLIED_BUILDING_NAME_RE.test(rawName)) factionId = 'allied';
  }
  if (!factionId || factionId === 'common' || factionId === 'all') {
    return {
      isCommon: true,
      factionId: 'common',
      label: '通用',
      shortBadge: '',
      badgeClass: '',
      svgTextFill: 'var(--rac-muted)',
    };
  }
  const matchedPill = availablePills?.find(p => p.id === factionId) ?? buildFactionPillOption(factionId);
  const cleanLabel = matchedPill.label.replace(/(?:体系|阵营)$/, '') || matchedPill.shortBadge;
  return {
    isCommon: false,
    factionId,
    label: cleanLabel,
    shortBadge: matchedPill.shortBadge,
    badgeClass: matchedPill.badgeClass,
    svgTextFill: matchedPill.svgTextFill,
  };
}

export const SUBGROUP_ORDER: string[] = [
  // 1. 军工生产
  '中枢原点与步兵训练线',
  '地面装甲与重工总装线',
  '航空母港与空天线',
  '远洋舰船与船坞线',
  '机娘整备与心智保障线',
  // 2. 防御纵深（从外圈到内核，与上方 SVG 左向纵深一一对应）
  '外圈·远程预警反导与隐身屏蔽',
  '中圈·中程防空与反甲火力网',
  '内圈·近程点防工事与雷障',
  '内核·地下掩体/医疗后勤/C4ISR',
  // 3. 农畜生态（按阶段Ⅰ→Ⅳ，与上方 SVG 闭环一一对应）
  '阶段Ⅰ · 水土环控与种饲底座',
  '阶段Ⅱ · 初级种养生产舱',
  '阶段Ⅲ · 精深加工与冷链储备',
  '阶段Ⅳ · 环保再生与沼气回灌',
  // 4. 能源与工业基建（与上方 SVG 三行一一对应）
  '发电与储能电网',
  '矿业采掘与重化工',
  '战略仓储与物流铁道',
  // 5. 科研航天与超武（与上方 SVG 三行一一对应）
  '科研中枢与超算阶梯',
  '航天与深空轨道工程',
  '战略超级武器',
];

export interface GroupedSystemCatalogEntries {
  groupName: string;
  items: SystemCatalogEntry[];
}

export function groupSystemCatalogEntries(entries: SystemCatalogEntry[]): GroupedSystemCatalogEntries[] {
  const map = new Map<string, SystemCatalogEntry[]>();
  for (const item of entries) {
    const list = map.get(item.subGroup) ?? [];
    list.push(item);
    map.set(item.subGroup, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => {
      const ia = SUBGROUP_ORDER.indexOf(a[0]);
      const ib = SUBGROUP_ORDER.indexOf(b[0]);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    })
    .map(([groupName, items]) => ({ groupName, items }));
}

export interface RenderedBlueprintEdge extends BuildingBlueprintEdge {
  path: string;
  active: boolean;
  stroke: string;
  marker: string;
  labelX: number;
  labelY: number;
  highlightRole?: BlueprintHighlightRole;
  isSubBranch?: boolean;
}

export interface InteractiveBlueprintNode extends BuildingBlueprintNode {
  width: number;
  height: number;
  isExpandedSubNode?: boolean;
  parentNodeId?: string;
  resolvedFactionId: string;
  resolvedFactionBadge: string;
  resolvedFactionColor: string;
  highlightRole: BlueprintHighlightRole;
}

export interface InteractiveBlueprintLayoutOptions {
  viewMode?: BuildingTopologyViewMode;
  factionFilter?: string;
  hideOtherFactions?: boolean;
  focusNodeId?: string | null;
  availablePills?: readonly BuildingFactionPillOption[];
}

export interface InteractiveBlueprintLayoutResult {
  nodes: InteractiveBlueprintNode[];
  edges: RenderedBlueprintEdge[];
  viewBoxWidth: number;
  viewBoxHeight: number;
  viewBox: string;
  flowNodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: InteractiveBlueprintNode;
  }>;
  flowEdges: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
    animated: boolean;
  }>;
}

function computeHighlightSets(
  edges: readonly BuildingBlueprintEdge[],
  focusNodeId: string | null | undefined,
): {
  upstreamNodeIds: Set<string>;
  downstreamNodeIds: Set<string>;
  upstreamEdgeIds: Set<string>;
  downstreamEdgeIds: Set<string>;
} {
  const upstreamNodeIds = new Set<string>();
  const downstreamNodeIds = new Set<string>();
  const upstreamEdgeIds = new Set<string>();
  const downstreamEdgeIds = new Set<string>();
  if (!focusNodeId) {
    return { upstreamNodeIds, downstreamNodeIds, upstreamEdgeIds, downstreamEdgeIds };
  }

  // BFS 向上游追溯前置输入链
  const upQueue: string[] = [focusNodeId];
  const upVisited = new Set<string>([focusNodeId]);
  while (upQueue.length > 0) {
    const curr = upQueue.shift()!;
    for (const e of edges) {
      if (e.to === curr) {
        upstreamEdgeIds.add(e.id);
        if (!upVisited.has(e.from)) {
          upVisited.add(e.from);
          upstreamNodeIds.add(e.from);
          if (!e.feedback) upQueue.push(e.from);
        }
      }
    }
  }

  // BFS 向下游追溯解锁输出链
  const downQueue: string[] = [focusNodeId];
  const downVisited = new Set<string>([focusNodeId]);
  while (downQueue.length > 0) {
    const curr = downQueue.shift()!;
    for (const e of edges) {
      if (e.from === curr) {
        downstreamEdgeIds.add(e.id);
        if (!downVisited.has(e.to)) {
          downVisited.add(e.to);
          downstreamNodeIds.add(e.to);
          if (!e.feedback) downQueue.push(e.to);
        }
      }
    }
  }

  return { upstreamNodeIds, downstreamNodeIds, upstreamEdgeIds, downstreamEdgeIds };
}

function buildEdgeSvgGeometry(
  edge: BuildingBlueprintEdge & { isSubBranch?: boolean },
  from: { x: number; y: number; state: BuildingNodeState },
  to: { x: number; y: number; state: BuildingNodeState },
  highlightRole: BlueprintHighlightRole,
): RenderedBlueprintEdge {
  const active = from.state === 'built' && (to.state === 'built' || to.state === 'building');
  const halfW = NODE_HALF_WIDTH;
  const halfH = NODE_HALF_HEIGHT;

  let stroke = active ? 'var(--rac-ok)' : 'var(--rac-dim)';
  let marker = active ? 'url(#arrow-active)' : 'url(#arrow-dim)';

  if (edge.feedback) {
    stroke = 'var(--rac-accent)';
    marker = 'url(#arrow-feedback)';
  }
  if (highlightRole === 'upstream') {
    stroke = 'var(--rac-warn)';
    marker = 'url(#arrow-upstream)';
  } else if (highlightRole === 'downstream') {
    stroke = 'var(--rac-accent)';
    marker = 'url(#arrow-downstream)';
  }

  if (edge.feedback) {
    const topY = Math.min(from.y, to.y) - 46;
    const path = `M ${from.x} ${from.y - halfH} C ${from.x} ${topY}, ${to.x} ${topY}, ${to.x} ${to.y - halfH}`;
    return {
      ...edge,
      path,
      active,
      stroke,
      marker,
      labelX: (from.x + to.x) / 2,
      labelY: topY + 10,
      highlightRole,
    };
  }

  const x1 = from.x + halfW;
  const y1 = from.y;
  const x2 = to.x - halfW;
  const y2 = to.y;
  const midX = (x1 + x2) / 2;
  const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  return {
    ...edge,
    path,
    active,
    stroke,
    marker,
    labelX: midX,
    labelY: (y1 + y2) / 2 - 6,
    highlightRole,
  };
}

export function buildRenderedBlueprintEdges(
  sys: { nodes: readonly BuildingBlueprintNode[]; edges: readonly BuildingBlueprintEdge[] },
  focusNodeId?: string | null,
): RenderedBlueprintEdge[] {
  const nodeMap = new Map(sys.nodes.map(n => [n.id, n]));
  const { upstreamEdgeIds, downstreamEdgeIds } = computeHighlightSets(sys.edges, focusNodeId);
  const hasFocus = Boolean(focusNodeId && nodeMap.has(focusNodeId));

  return sys.edges
    .map(edge => {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) return null;
      const highlightRole: BlueprintHighlightRole = !hasFocus
        ? 'none'
        : upstreamEdgeIds.has(edge.id)
          ? 'upstream'
          : downstreamEdgeIds.has(edge.id)
            ? 'downstream'
            : 'dimmed';
      return buildEdgeSvgGeometry(edge, from, to, highlightRole);
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
}

function enrichNodeForFactionAndStyle(
  node: BuildingBlueprintNode,
  factionFilter: string,
  availablePills?: readonly BuildingFactionPillOption[],
): InteractiveBlueprintNode {
  const normFilter = normalizeBuildingFactionId(factionFilter);
  let displayName = node.displayName || node.name;
  let displayShortLabel = node.displayShortLabel || node.shortLabel || node.name;

  // 切换到尤里阵营时优先使用对齐《特色建筑·尤里_世界书.json》真名的 YURI_NODE_VARIANT_FALLBACK
  const variants = (
    node as {
      factionVariants?: Record<string, { name: string; shortLabel?: string } | undefined>;
    }
  ).factionVariants;
  if (normFilter === 'yuri') {
    const yuriVar = YURI_NODE_VARIANT_FALLBACK[node.id] ?? variants?.yuri;
    if (yuriVar) {
      displayName = yuriVar.name;
      displayShortLabel = yuriVar.shortLabel || yuriVar.name;
    }
  } else if (normFilter !== 'all' && normFilter !== 'common' && variants?.[normFilter]) {
    const dynVar = variants[normFilter]!;
    displayName = dynVar.name;
    displayShortLabel = dynVar.shortLabel || dynVar.name;
  }

  // 解析节点阵营标识与色标
  const nodeEntryMeta = resolveBuildingEntryFactionBadge(
    { name: displayName, faction: node.faction },
    availablePills,
  );
  const clusterFactions = new Set<string>();
  for (const item of node.clusterItems ?? []) {
    const meta = resolveBuildingEntryFactionBadge(item, availablePills);
    if (!meta.isCommon) clusterFactions.add(meta.shortBadge);
  }
  if (!nodeEntryMeta.isCommon) {
    clusterFactions.add(nodeEntryMeta.shortBadge);
  }

  let resolvedFactionBadge = (node.factionBadge as string | undefined) || '';
  if (normFilter === 'yuri' && (YURI_NODE_VARIANT_FALLBACK[node.id] || nodeEntryMeta.factionId === 'yuri')) {
    resolvedFactionBadge = '尤';
  } else if (!resolvedFactionBadge && !nodeEntryMeta.isCommon) {
    resolvedFactionBadge = nodeEntryMeta.shortBadge;
  } else if (clusterFactions.has('尤') && resolvedFactionBadge === '盟/苏') {
    resolvedFactionBadge = '盟/苏/尤';
  }

  const resolvedFactionId =
    normFilter === 'yuri' && YURI_NODE_VARIANT_FALLBACK[node.id]
      ? 'yuri'
      : nodeEntryMeta.factionId;

  const resolvedFactionColor =
    resolvedFactionId === 'yuri' || resolvedFactionBadge === '尤'
      ? 'var(--rac-warn)'
      : resolvedFactionId === 'soviet' || resolvedFactionBadge === '苏'
        ? 'var(--rac-alert)'
        : resolvedFactionId === 'allied' || resolvedFactionBadge === '盟'
          ? 'var(--rac-accent)'
          : !nodeEntryMeta.isCommon
            ? nodeEntryMeta.svgTextFill
            : 'var(--rac-muted)';

  const dimmedByFaction =
    normFilter !== 'all' &&
    normFilter !== 'common' &&
    !nodeEntryMeta.isCommon &&
    nodeEntryMeta.factionId !== normFilter &&
    node.builtCount === 0;

  return {
    ...node,
    displayName,
    displayShortLabel,
    dimmedByFaction: node.dimmedByFaction || dimmedByFaction,
    width: NODE_CARD_WIDTH,
    height: NODE_CARD_HEIGHT,
    resolvedFactionId,
    resolvedFactionBadge,
    resolvedFactionColor,
    highlightRole: 'none',
  };
}

function hasNodeCoordinateCollision(nodes: readonly { x: number; y: number }[]): boolean {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (Math.abs(a.x - b.x) < NODE_CARD_WIDTH - 20 && Math.abs(a.y - b.y) < NODE_CARD_HEIGHT - 8) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 基于 @dagrejs/dagre 的交互式蓝图拓扑布局计算（支持 cluster 同类归并 / expanded 全部型号展开 / 阵营聚焦重排 / 上下游高亮）
 */
export function computeInteractiveBlueprintLayout(
  sys: BuildingSystemView,
  options?: InteractiveBlueprintLayoutOptions,
): InteractiveBlueprintLayoutResult {
  const viewMode: BuildingTopologyViewMode = options?.viewMode ?? 'cluster';
  const factionFilter = options?.factionFilter ?? 'all';
  const normFilter = normalizeBuildingFactionId(factionFilter);
  const hideOtherFactions = Boolean(options?.hideOtherFactions);
  const focusNodeId = options?.focusNodeId ?? null;
  const availablePills = options?.availablePills;

  // 1. 预处理骨干节点
  const allBackboneNodes = sys.nodes.map(n =>
    enrichNodeForFactionAndStyle(n, normFilter, availablePills),
  );

  // 2. 若开启「仅显示本阵营与通用节点（紧凑重排）」，过滤异阵营排他节点并桥接断连边
  const hiddenNodeIds = new Set<string>();
  if (hideOtherFactions && normFilter !== 'all' && normFilter !== 'common') {
    for (const n of allBackboneNodes) {
      if (n.dimmedByFaction && n.builtCount === 0 && !n.isOriginConyard) {
        hiddenNodeIds.add(n.id);
      }
    }
  }

  const visibleNodes: InteractiveBlueprintNode[] = allBackboneNodes.filter(
    n => !hiddenNodeIds.has(n.id),
  );
  const workingEdges: Array<BuildingBlueprintEdge & { isSubBranch?: boolean }> = [];
  const edgeKeySet = new Set<string>();

  for (const e of sys.edges) {
    if (!hiddenNodeIds.has(e.from) && !hiddenNodeIds.has(e.to)) {
      const k = `${e.from}->${e.to}`;
      if (!edgeKeySet.has(k)) {
        edgeKeySet.add(k);
        workingEdges.push({ ...e });
      }
    }
  }

  // 桥接被隐藏节点的上下游连线
  if (hiddenNodeIds.size > 0) {
    for (const hid of hiddenNodeIds) {
      const inParents = sys.edges.filter(e => e.to === hid && !e.feedback && !hiddenNodeIds.has(e.from));
      const outChildren = sys.edges.filter(e => e.from === hid && !e.feedback && !hiddenNodeIds.has(e.to));
      for (const p of inParents) {
        for (const c of outChildren) {
          const k = `${p.from}->${c.to}`;
          if (!edgeKeySet.has(k)) {
            edgeKeySet.add(k);
            workingEdges.push({
              id: `bridge_${p.from}_${c.to}`,
              from: p.from,
              to: c.to,
            });
          }
        }
      }
    }
  }

  // 3. 若处于 `'expanded'`（全分支展开视图），将各骨干节点 clusterItems 展开为子级拓扑节点
  if (viewMode === 'expanded') {
    const existingIds = new Set(visibleNodes.map(n => n.id));
    for (const parent of [...visibleNodes]) {
      const cluster = parent.clusterItems ?? [];
      if (cluster.length <= 1) continue;

      const filteredCluster = cluster.filter(sub => {
        if (sub.name === parent.displayName || sub.name === parent.name) return false;
        const subMeta = resolveBuildingEntryFactionBadge(sub, availablePills);
        if (hideOtherFactions && normFilter !== 'all' && normFilter !== 'common') {
          if (!subMeta.isCommon && subMeta.factionId !== normFilter && sub.builtCount === 0) {
            return false;
          }
        }
        return true;
      });

      for (let idx = 0; idx < filteredCluster.length; idx += 1) {
        const sub = filteredCluster[idx]!;
        const rawSubId = `${parent.id}__sub__${sub.id || idx}`;
        const subNodeId = existingIds.has(rawSubId) ? `${rawSubId}_${idx}` : rawSubId;
        existingIds.add(subNodeId);
        const subMeta = resolveBuildingEntryFactionBadge(sub, availablePills);
        const dimmedSub =
          normFilter !== 'all' &&
          normFilter !== 'common' &&
          !subMeta.isCommon &&
          subMeta.factionId !== normFilter &&
          sub.builtCount === 0;

        const childNode: InteractiveBlueprintNode = {
          id: subNodeId,
          name: sub.name,
          shortLabel: truncateText(sub.name, 10),
          displayName: sub.name,
          displayShortLabel: truncateText(sub.name, 10),
          system: parent.system,
          laneLabel: `${parent.laneLabel} · 分支`,
          x: parent.x + 210,
          y: parent.y + idx * 66,
          defenseRing: parent.defenseRing,
          agroStage: parent.agroStage,
          faction: (subMeta.isCommon ? 'common' : subMeta.factionId) as BuildingBlueprintNode['faction'],
          factionBadge: (subMeta.shortBadge || undefined) as BuildingBlueprintNode['factionBadge'],
          dimmedByFaction: dimmedSub,
          state: sub.state,
          builtCount: sub.builtCount,
          runningCount: sub.builtCount,
          offlineCount: 0,
          switchingCount: 0,
          productionModeCount: sub.builtCount,
          accelModeCount: 0,
          statusText: `${sub.statusText} · $${sub.cost}`,
          hint: sub.prereqText || '衍生型号',
          matchedNames: [sub.name],
          instances: [],
          clusterItems: [sub],
          width: NODE_CARD_WIDTH,
          height: NODE_CARD_HEIGHT,
          isExpandedSubNode: true,
          parentNodeId: parent.id,
          resolvedFactionId: subMeta.factionId,
          resolvedFactionBadge: subMeta.shortBadge,
          resolvedFactionColor: subMeta.svgTextFill,
          highlightRole: 'none',
        };
        visibleNodes.push(childNode);
        workingEdges.push({
          id: `edge_sub_${parent.id}_${subNodeId}`,
          from: parent.id,
          to: subNodeId,
          isSubBranch: true,
        });
      }
    }
  }

  // 4. 运行 @dagrejs/dagre 有向无环图自动分层布局
  const g = new graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',
    nodesep: viewMode === 'expanded' ? 18 : 26,
    ranksep: viewMode === 'expanded' ? 54 : 68,
    marginx: 104,
    marginy: 48,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of visibleNodes) {
    g.setNode(node.id, {
      width: NODE_CARD_WIDTH,
      height: NODE_CARD_HEIGHT,
      label: node.displayShortLabel,
    });
  }
  for (const edge of workingEdges) {
    if (!edge.feedback) {
      g.setEdge(edge.from, edge.to, { weight: edge.isSubBranch ? 2 : 1 });
    }
  }

  dagreLayout(g);

  const shouldApplyDagreCoords =
    viewMode === 'expanded' ||
    hiddenNodeIds.size > 0 ||
    hasNodeCoordinateCollision(visibleNodes);

  let maxRight = 960;
  let maxBottom = 460;

  for (const node of visibleNodes) {
    const dagreNode = g.node(node.id) as { x?: number; y?: number } | undefined;
    if (shouldApplyDagreCoords && dagreNode && Number.isFinite(dagreNode.x) && Number.isFinite(dagreNode.y)) {
      node.x = Math.round(dagreNode.x!);
      node.y = Math.round(dagreNode.y!);
    }
    maxRight = Math.max(maxRight, node.x + NODE_HALF_WIDTH + 32);
    maxBottom = Math.max(maxBottom, node.y + NODE_HALF_HEIGHT + 36);
  }

  // 5. 计算焦点节点的上下游依赖链高亮状态
  const nodeMap = new Map(visibleNodes.map(n => [n.id, n]));
  const hasFocus = Boolean(focusNodeId && nodeMap.has(focusNodeId));
  const { upstreamNodeIds, downstreamNodeIds, upstreamEdgeIds, downstreamEdgeIds } =
    computeHighlightSets(workingEdges, hasFocus ? focusNodeId : null);

  for (const node of visibleNodes) {
    if (!hasFocus) {
      node.highlightRole = 'none';
    } else if (node.id === focusNodeId) {
      node.highlightRole = 'focus';
    } else if (upstreamNodeIds.has(node.id)) {
      node.highlightRole = 'upstream';
    } else if (downstreamNodeIds.has(node.id)) {
      node.highlightRole = 'downstream';
    } else {
      node.highlightRole = 'dimmed';
    }
  }

  const renderedEdges: RenderedBlueprintEdge[] = workingEdges
    .map(edge => {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) return null;
      const highlightRole: BlueprintHighlightRole = !hasFocus
        ? 'none'
        : upstreamEdgeIds.has(edge.id)
          ? 'upstream'
          : downstreamEdgeIds.has(edge.id)
            ? 'downstream'
            : 'dimmed';
      return buildEdgeSvgGeometry(edge, from, to, highlightRole);
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const viewBoxWidth = Math.max(960, Math.ceil(maxRight));
  const viewBoxHeight = Math.max(460, Math.ceil(maxBottom));

  const flowNodes = visibleNodes.map(node => ({
    id: node.id,
    type: node.isExpandedSubNode ? 'building-sub' : 'building-backbone',
    position: { x: node.x - NODE_HALF_WIDTH, y: node.y - NODE_HALF_HEIGHT },
    data: node,
  }));

  const flowEdges = renderedEdges.map(edge => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    animated: edge.active || edge.highlightRole === 'upstream' || edge.highlightRole === 'downstream',
  }));

  return {
    nodes: visibleNodes,
    edges: renderedEdges,
    viewBoxWidth,
    viewBoxHeight,
    viewBox: `0 0 ${viewBoxWidth} ${viewBoxHeight}`,
    flowNodes,
    flowEdges,
  };
}

export function nodeFill(state: BuildingNodeState): string {
  if (state === 'built') return 'var(--rac-panel-2)';
  if (state === 'building') return 'var(--rac-panel-2)';
  if (state === 'unlocked') return 'var(--rac-panel)';
  return 'var(--rac-bg)';
}

export function nodeStroke(
  node: Pick<BuildingBlueprintNode, 'state' | 'isOriginConyard' | 'faction'> & {
    resolvedFactionId?: string;
    highlightRole?: BlueprintHighlightRole;
  },
): string {
  if (node.highlightRole === 'upstream') return 'var(--rac-warn)';
  if (node.highlightRole === 'downstream') return 'var(--rac-accent)';
  if (node.state === 'built') return 'var(--rac-ok)';
  if (node.state === 'building') return 'var(--rac-warn)';
  if (node.state === 'unlocked') return 'var(--rac-accent)';
  if (node.isOriginConyard) return 'var(--rac-warn)';
  const fId = node.resolvedFactionId || node.faction;
  if (fId === 'soviet') return 'var(--rac-alert)';
  if (fId === 'yuri') return 'var(--rac-warn)';
  return 'var(--rac-dim)';
}

export function nodeSubTextColor(node: BuildingBlueprintNode): string {
  if (node.state === 'built') return 'var(--rac-ok)';
  if (node.state === 'building') return 'var(--rac-warn)';
  if (node.state === 'unlocked') return 'var(--rac-accent)';
  if (node.isOriginConyard) return 'var(--rac-warn)';
  return 'var(--rac-muted)';
}

export function truncateText(text: string, maxLen: number): string {
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

export type BlueprintNodeClickResolution =
  | { kind: 'deploy_mcv' }
  | { kind: 'toggle_cluster'; nextExpandedNodeId: string | null; lookupName: string | null }
  | { kind: 'lookup'; nextExpandedNodeId: string; lookupName: string };

export function resolveBlueprintNodePrimaryLookupName(node: BuildingBlueprintNode): string {
  const matchedBuilt = node.matchedNames?.[0]?.trim();
  if (matchedBuilt) return matchedBuilt;
  const preferredDisplay = (node.displayName || node.name || '').trim();
  const exactCluster = (node.clusterItems ?? []).find(item => item.name === preferredDisplay);
  if (exactCluster) return exactCluster.name;
  return preferredDisplay || node.clusterItems?.[0]?.name || node.name;
}

export function resolveBlueprintNodeAction(
  node: BuildingBlueprintNode,
  currentExpandedNodeId: string | null,
): BlueprintNodeClickResolution {
  const clusterLen = node.clusterItems?.length ?? 0;
  if (node.isOriginConyard && node.state === 'locked' && clusterLen === 0) {
    return { kind: 'deploy_mcv' };
  }
  const lookupName = resolveBlueprintNodePrimaryLookupName(node);
  if (clusterLen > 1) {
    return {
      kind: 'toggle_cluster',
      nextExpandedNodeId: currentExpandedNodeId === node.id ? null : node.id,
      lookupName,
    };
  }
  return {
    kind: 'lookup',
    nextExpandedNodeId: node.id,
    lookupName,
  };
}

export function deployMcvOrder(baseName: string): void {
  const resolvedBase = baseName || '当前基地';
  const orderText = `【建造指令】在「${resolvedBase}」下令 MCV（移动基地车）就地展开为建造厂核心`;
  const ch = fillHostSendInput(orderText);
  if (ch !== 'failed') {
    toastr?.success?.(`已填入展开指令：${orderText}`, '基地建造中枢');
  }
}

export interface BuildingPowerCatalogItemLike {
  name: string;
  power?: number | { gen?: number; use?: number };
  operation?: {
    conditions?: ReadonlyArray<{
      trigger?: string;
      power?: number;
    }>;
  };
}

export interface BuildingPowerCatalogLike {
  buildings?: readonly BuildingPowerCatalogItemLike[];
}

export function resolveSingleBuildingPowerPair(
  rawName: string,
  catalog?: BuildingPowerCatalogLike | null,
  mode?: string,
): { powerGen: number; powerUse: number } {
  const clean = String(rawName ?? '').trim();
  if (!clean) return { powerGen: 0, powerUse: 0 };

  const strippedClean = stripFactionBuildingPrefix(clean);
  const catList = catalog?.buildings ?? [];
  const matched =
    catList.find(b => b.name === clean) ??
    catList.find(b => stripFactionBuildingPrefix(b.name) === strippedClean);

  const isGeneratorByName =
    /发电厂|电厂|发电机|反应炉|反应堆|太阳能|风力|光能|RTG|同位素电源|聚变|红色太阳/.test(clean);

  if (mode === '加速' && matched?.operation?.conditions) {
    const overclockCond = matched.operation.conditions.find(
      c => c.trigger === 'overclock' && typeof c.power === 'number' && Number.isFinite(c.power),
    );
    if (overclockCond && typeof overclockCond.power === 'number') {
      const p = overclockCond.power;
      if (p < 0) return { powerGen: Math.abs(p), powerUse: 0 };
      if (p > 0) return isGeneratorByName ? { powerGen: p, powerUse: 0 } : { powerGen: 0, powerUse: p };
    }
  }

  if (isConyardBuildingName(clean)) {
    const rawPower = matched?.power;
    if (typeof rawPower === 'number' && Number.isFinite(rawPower)) {
      if (rawPower < 0) return { powerGen: Math.abs(rawPower), powerUse: 0 };
      if (rawPower > 0) return { powerGen: rawPower, powerUse: 0 };
    } else if (rawPower && typeof rawPower === 'object') {
      const gen = typeof rawPower.gen === 'number' && Number.isFinite(rawPower.gen) ? rawPower.gen : 50;
      const use = typeof rawPower.use === 'number' && Number.isFinite(rawPower.use) ? rawPower.use : 0;
      return { powerGen: gen, powerUse: use };
    }
    return { powerGen: 50, powerUse: 0 };
  }

  if (matched && matched.power !== undefined) {
    if (typeof matched.power === 'number' && Number.isFinite(matched.power)) {
      if (matched.power < 0) return { powerGen: Math.abs(matched.power), powerUse: 0 };
      if (matched.power > 0) {
        return isGeneratorByName
          ? { powerGen: matched.power, powerUse: 0 }
          : { powerGen: 0, powerUse: matched.power };
      }
      return { powerGen: 0, powerUse: 0 };
    }
    if (matched.power && typeof matched.power === 'object') {
      return {
        powerGen:
          typeof matched.power.gen === 'number' && Number.isFinite(matched.power.gen)
            ? Math.max(0, matched.power.gen)
            : 0,
        powerUse:
          typeof matched.power.use === 'number' && Number.isFinite(matched.power.use)
            ? Math.max(0, matched.power.use)
            : 0,
      };
    }
  }

  if (/聚变发电阵列/.test(clean)) return { powerGen: 5000, powerUse: 0 };
  if (/聚变发电中枢/.test(clean)) return { powerGen: 1500, powerUse: 0 };
  if (/核子反应炉|裂变反应堆|快堆/.test(clean)) return { powerGen: 1000, powerUse: 0 };
  if (/磁能反应炉/.test(clean)) return { powerGen: 250, powerUse: 0 };
  if (/发电厂|电厂|发电机|反应炉|反应堆|太阳能|风力|光能|RTG|同位素电源/.test(clean)) {
    return { powerGen: 200, powerUse: 0 };
  }
  if (/超级武器|超时空传送仪|天气控制|铁幕装置|核弹发射井|核导弹|心灵支配仪|基因突变器|基因崩解/.test(clean)) {
    return { powerGen: 0, powerUse: 200 };
  }
  if (/战斗实验室|作战实验室|实验设计局|科学城|心灵谐振研究院|高维意识科学院|湍流实验室/.test(clean)) {
    return { powerGen: 0, powerUse: 80 };
  }
  if (/光棱塔|磁暴线圈|爱国者|心灵控制塔/.test(clean)) return { powerGen: 0, powerUse: 75 };
  if (/量子超算/.test(clean)) return { powerGen: 0, powerUse: 60 };
  if (/战车工厂|重工|矿石精炼厂|精炼厂|矿场|超算中心|雷达|空指部|感应器|C4ISR/.test(clean)) {
    return { powerGen: 0, powerUse: 50 };
  }
  if (/造船厂|船坞|空军指挥部|航空引导盘/.test(clean)) return { powerGen: 0, powerUse: 40 };
  if (/军校|克隆|培育中心/.test(clean)) return { powerGen: 0, powerUse: 30 };
  if (/装备制造所|感化院/.test(clean)) return { powerGen: 0, powerUse: 25 };
  if (/兵营|新兵训导营|合成工坊|维修所|碉堡|机炮塔/.test(clean)) return { powerGen: 0, powerUse: 20 };
  return { powerGen: 0, powerUse: 0 };
}

export function recalculateBasePower(
  buildings: ReadonlyArray<Record<string, unknown>>,
  catalog?: BuildingPowerCatalogLike | null,
): { gen: number; use: number } {
  let gen = 0;
  let use = 0;
  for (const b of buildings) {
    if (!b || typeof b !== 'object') continue;
    const rawState =
      typeof b.state === 'string' && b.state.trim()
        ? b.state.trim()
        : typeof b.status === 'string' && b.status.trim()
          ? b.status.trim()
          : '运转';
    if (rawState !== '运转' && rawState !== '正常') continue;

    const rawCount =
      typeof b.count === 'number' && Number.isFinite(b.count) && b.count > 0
        ? b.count
        : typeof b.quantity === 'number' && Number.isFinite(b.quantity) && b.quantity > 0
          ? b.quantity
          : 1;
    const name = typeof b.name === 'string' ? b.name : '';
    const mode = typeof b.mode === 'string' ? b.mode : '生产';
    const { powerGen, powerUse } = resolveSingleBuildingPowerPair(name, catalog, mode);
    gen += powerGen * rawCount;
    use += powerUse * rawCount;
  }
  return { gen, use };
}

export function applyBuildingInstanceMutationToVars(
  vars: Record<string, unknown>,
  inst: BuiltBuildingInstanceRef,
  mutator: (b: Record<string, unknown>) => void,
  catalog?: BuildingPowerCatalogLike | null,
): Record<string, unknown> {
  const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
  const rawBases = Array.isArray(sd.bases) ? [...(sd.bases as Array<Record<string, unknown>>)] : [];
  const targetBase = rawBases[inst.baseIndex];
  if (!targetBase) return vars;
  const rawBuildings = Array.isArray(targetBase.buildings)
    ? [...(targetBase.buildings as Array<Record<string, unknown>>)]
    : [];
  const targetBld = rawBuildings[inst.buildingIndex];
  if (!targetBld) return vars;
  const clonedBld = { ...targetBld };
  mutator(clonedBld);
  rawBuildings[inst.buildingIndex] = clonedBld;
  const nextPower = recalculateBasePower(rawBuildings, catalog);
  rawBases[inst.baseIndex] = {
    ...targetBase,
    buildings: rawBuildings,
    power: nextPower,
  };
  return {
    ...vars,
    stat_data: {
      ...sd,
      bases: rawBases,
    },
  };
}

export interface BuildingInstanceMutationContext {
  snapshot?: StatData | null;
  dataStore: { data?: StatData | null };
  floating: { floorId: number | null | undefined; refresh: () => Promise<unknown> | unknown };
  updateFloorVars: typeof UpdateFloorVarsFn;
  onTick: () => void;
  catalog?: BuildingPowerCatalogLike | null;
}

export async function mutateBuildingInstance(
  inst: BuiltBuildingInstanceRef,
  mutator: (b: Record<string, unknown>) => void,
  toastMsg: string,
  ctx: BuildingInstanceMutationContext,
): Promise<void> {
  const localBase = ctx.snapshot?.bases?.[inst.baseIndex];
  const localBld = localBase?.buildings?.[inst.buildingIndex];
  if (localBld) {
    mutator(localBld as unknown as Record<string, unknown>);
    if (localBase && Array.isArray(localBase.buildings)) {
      localBase.power = recalculateBasePower(
        localBase.buildings as unknown as ReadonlyArray<Record<string, unknown>>,
        ctx.catalog,
      );
    }
  }
  const storeBase = ctx.dataStore.data?.bases?.[inst.baseIndex];
  const storeBld = storeBase?.buildings?.[inst.buildingIndex];
  if (storeBld && storeBld !== localBld) {
    mutator(storeBld as unknown as Record<string, unknown>);
    if (storeBase && storeBase !== localBase && Array.isArray(storeBase.buildings)) {
      storeBase.power = recalculateBasePower(
        storeBase.buildings as unknown as ReadonlyArray<Record<string, unknown>>,
        ctx.catalog,
      );
    }
  }
  ctx.onTick();

  if (ctx.floating.floorId !== null && ctx.floating.floorId !== undefined) {
    await ctx.updateFloorVars(ctx.floating.floorId, vars =>
      applyBuildingInstanceMutationToVars(vars, inst, mutator, ctx.catalog),
    );
    await ctx.floating.refresh();
  }
  toastr?.success?.(toastMsg, '建筑产线调度');
}

export async function toggleBuildingInstanceMode(
  inst: BuiltBuildingInstanceRef,
  ctx: BuildingInstanceMutationContext,
): Promise<void> {
  const nextMode: '生产' | '加速' = inst.mode === '加速' ? '生产' : '加速';
  await mutateBuildingInstance(
    inst,
    b => {
      b.mode = nextMode;
      if (nextMode === '加速' && !b.accel_scope) {
        b.accel_scope = 'global';
      }
    },
    `「${inst.name}」已切换为【${nextMode}】模式`,
    ctx,
  );
}

export async function toggleBuildingInstanceScope(
  inst: BuiltBuildingInstanceRef,
  ctx: BuildingInstanceMutationContext,
): Promise<void> {
  const nextScope: 'global' | 'base' = inst.accelScope === 'base' ? 'global' : 'base';
  await mutateBuildingInstance(
    inst,
    b => {
      b.accel_scope = nextScope;
    },
    `「${inst.name}」加速范围已切换为【${nextScope === 'base' ? '仅本基地' : '战区全局'}】`,
    ctx,
  );
}

export async function toggleBuildingInstanceState(
  inst: BuiltBuildingInstanceRef,
  ctx: BuildingInstanceMutationContext,
): Promise<void> {
  const nextState: '运转' | '停机' = inst.state === '运转' ? '停机' : '运转';
  await mutateBuildingInstance(
    inst,
    b => {
      b.state = nextState;
    },
    `「${inst.name}」状态已切换为【${nextState}】`,
    ctx,
  );
}

export interface FacilityCoordBadgeInfo extends ResolvedBuildingSpatial {
  badgeText: string;
  badgeClass: string;
}

export function coordRingBadgeClass(ring: BuildingRing): string {
  switch (ring) {
    case 'core':
      return 'border-(--rac-warn)/65 bg-(--rac-panel-2) text-(--rac-warn)';
    case 'inner':
      return 'border-(--rac-accent)/55 bg-(--rac-panel-2) text-(--rac-accent)';
    case 'mid':
      return 'border-(--rac-ok)/55 bg-(--rac-panel-2) text-(--rac-ok)';
    case 'outer':
    default:
      return 'border-(--rac-alert)/55 bg-(--rac-panel-2) text-(--rac-alert)';
  }
}

export function resolveFacilityCoordBadge(
  fac: { name: string; instances?: readonly BuiltBuildingInstanceRef[] },
  snapshot?: StatData | null,
): FacilityCoordBadgeInfo {
  const firstInst = fac.instances?.[0];
  const rawBld = firstInst
    ? (snapshot?.bases?.[firstInst.baseIndex]?.buildings?.[firstInst.buildingIndex] as
        | { name?: string; coord?: { x: number; y: number }; bearing?: string }
        | undefined)
    : undefined;
  const spatial = resolveBuildingRelativeCoord(
    {
      name: rawBld?.name || fac.name,
      coord: rawBld ? rawBld.coord : firstInst?.coord,
      bearing: rawBld ? rawBld.bearing : firstInst?.bearingLabel,
    },
    firstInst?.buildingIndex ?? 0,
    firstInst?.baseId || 'base-0',
  );
  const badgeText =
    spatial.ring === 'core'
      ? `◆ ${spatial.bearingLabel}`
      : `◆ ${spatial.ringLabel} · ${spatial.bearingLabel}`;
  return {
    ...spatial,
    badgeText,
    badgeClass: coordRingBadgeClass(spatial.ring),
  };
}

export interface FacilityInstanceCoordBadgeInfo extends FacilityCoordBadgeInfo {
  instanceOrdinal: number;
  state: BuiltBuildingInstanceRef['state'];
  layer: string;
  addons: string[];
  progress?: number;
  eta?: string;
  mode: '生产' | '加速';
  powerGen: number;
  powerUse: number;
}

export function resolveFacilityInstanceCoordBadges(
  fac: {
    name: string;
    instances?: readonly BuiltBuildingInstanceRef[];
    allInstances?: readonly BuiltBuildingInstanceRef[];
  },
  snapshot?: StatData | null,
): FacilityInstanceCoordBadgeInfo[] {
  const sourceList =
    fac.allInstances && fac.allInstances.length > 0 ? fac.allInstances : (fac.instances ?? []);
  return sourceList.map((inst, idx) => {
    const rawBld =
      inst.buildingIndex >= 0
        ? (snapshot?.bases?.[inst.baseIndex]?.buildings?.[inst.buildingIndex] as
            | {
                name?: string;
                coord?: { x: number; y: number };
                bearing?: string;
                addons?: string[];
                progress?: number;
                eta?: string;
                layer?: string;
              }
            | undefined)
        : undefined;
    const spatial = resolveBuildingRelativeCoord(
      {
        name: rawBld?.name || inst.name || fac.name,
        coord: rawBld ? rawBld.coord : inst.coord,
        bearing: rawBld ? rawBld.bearing : inst.bearingLabel,
      },
      inst.buildingIndex >= 0 ? inst.buildingIndex : idx,
      inst.baseId || 'base-0',
    );
    const badgeText =
      spatial.ring === 'core'
        ? `◆ ${spatial.bearingLabel}`
        : `◆ ${spatial.ringLabel} · ${spatial.bearingLabel}`;
    const addons =
      Array.isArray(inst.addons) && inst.addons.length > 0
        ? [...inst.addons]
        : Array.isArray(rawBld?.addons)
          ? rawBld.addons.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          : [];
    return {
      ...spatial,
      badgeText,
      badgeClass: coordRingBadgeClass(spatial.ring),
      instanceOrdinal: inst.instanceOrdinal ?? idx + 1,
      state: inst.state || '运转',
      layer: inst.layer || rawBld?.layer || '地面',
      addons,
      progress: inst.progress ?? rawBld?.progress,
      eta: inst.eta ?? rawBld?.eta,
      mode: inst.mode === '加速' ? '加速' : '生产',
      powerGen: inst.powerGen ?? 0,
      powerUse: inst.powerUse ?? 0,
    };
  });
}

export const resolveAllFacilityInstanceBadges = resolveFacilityInstanceCoordBadges;

export function buildSectorActionOrder(
  baseName: string,
  sector?: { name: string; layer?: string; status?: string },
  action: 'reinforce' | 'repair' | 'create' = 'reinforce',
): string {
  const resolvedBase = (baseName || '当前基地').trim() || '当前基地';
  if (action === 'create' || !sector?.name?.trim()) {
    return `【指挥官战术指令】在「${resolvedBase}」规划开辟新空间防区与环境工程（请参谋部结合当前基地地形提交防区改造方案）`;
  }
  const secName = sector.name.trim();
  const secLayer = sector.layer?.trim() ?? '';
  if (action === 'repair') {
    return `【指挥官战术指令】紧急抢修受损防区工程：${secName} 基地: ${resolvedBase}`;
  }
  return `【指挥官战术指令】加固并扩建基地防区：${secName}${secLayer ? `（层级: ${secLayer}）` : ''} 基地: ${resolvedBase}`;
}

export function triggerSectorActionOrder(
  baseName: string,
  sector?: { name: string; layer?: string; status?: string },
  action: 'reinforce' | 'repair' | 'create' = 'reinforce',
): void {
  const orderText = buildSectorActionOrder(baseName, sector, action);
  const ch = fillHostSendInput(orderText);
  if (ch !== 'failed') {
    toastr?.success?.(`已填入防区战术指令：${orderText}`, '基地防区调度');
  }
}
