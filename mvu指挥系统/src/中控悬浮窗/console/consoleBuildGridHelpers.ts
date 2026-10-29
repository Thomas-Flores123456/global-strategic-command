import { normalizeFactionId } from '../../红警指挥系统/core/commandPresets';
import { setHasEquivalentBuilding } from '../../红警指挥系统/core/prerequisites';
import type { Base, CodexEntry, QueueItem, Schema } from '../../红警指挥系统/core/schema';
import { canon } from '../../红警指挥系统/parse/parsePipeline';
import { buildCatalogPrerequisiteContext, buildCompletedTechAndProtocolSet } from '../../红警指挥系统/core/catalogRuntimeContext';
import { laneDefFromKey } from '../../红警指挥系统/engines/productionLanes';
import { BUILTIN_BUILDING_UPGRADE_SPECS } from '../../红警指挥系统/engines/productionReconciliation';
import { BUILTIN_RETROFIT_UPGRADE_SPECS } from '../../红警指挥系统/engines/projectEngineHelpers';
import { SCHEDULE_COPY } from '../../红警指挥系统/planning/scheduleCopy';
import {
  BUILD_PANEL_GROUPS,
  SUB_TAB_ICONS,
  PRODUCTION_SUBS,
  domainsOfBuilding,
  isConyardOriginBuilding,
  isSingleInstancePerBaseBuilding,
  stripFactionBuildingPrefix,
} from '../models/tagTaxonomy';
import type { BuildPanelGroupId } from '../models/tagTaxonomy';
import { stripMassProductionSuffix } from '../models/worldbookCatalogParser';
import { QUEUE_DISPLAY_COPY, queueDisplayModel } from '../models/queueDisplayModel';
import type { QueueDisplayModel } from '../models/queueDisplayModel';

export type MainTabId = BuildPanelGroupId;
export type SubTabId = string;
export type BuildQuickStatusFilter = 'all' | 'fav' | 'active_queue' | 'built';

export interface BuildingCardLiveStats {
  builtCount: number;
  runningCount: number;
  underConstructionCount: number;
  damagedCount: number;
  stoppedCount: number;
  accelCount: number;
  mountedAddonCount: number;
  layers: string[];
}

export interface ConsoleBuildItem {
  id: string;
  name: string;
  baseUnitName?: string;
  isModernized?: boolean;
  modernizedRetrofitName?: string;
  category: MainTabId;
  subCategory?: SubTabId;
  faction?: string;
  cost: number;
  power?: number;
  prereq?: string;
  meta?: string;
  desc?: string;
  tags?: string[];
  builtCount: number;
  maxCount?: number;
  isMaxedOut?: boolean;
  queueModel?: QueueDisplayModel;
  liveStats?: BuildingCardLiveStats;
  activeQueueCount?: number;
  unlockTier?: number;
  dynamic?: boolean;
  isFavorite?: boolean;
  title?: string;
}

export const FACTION_LABELS: Readonly<Record<string, string>> = {
  all: '全部',
  allied: '盟军',
  soviet: '苏联',
  yuri: '尤里',
  common: '通用',
};

/** 建造厂核心建筑名称集合（必须存在且处于运转态才可解锁基地建筑建造序列） */
export const CONYARD_BUILDING_NAMES = new Set([
  '建造厂',
  '建造厂核心',
  '盟军建造厂',
  '苏联建造厂',
  '尤里建造厂',
  '尤里建造厂核心',
  '前沿工地',
  '作战前哨站',
]);

export const CONSTRUCTION_YARDS = CONYARD_BUILDING_NAMES;

/** 各阵营生产母体与王牌专库建筑白名单（FD-26 · 支撑阵营母体归属判定） */
export const FACTION_PRODUCTION_BUILDING_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  allied: [
    '盟军建造厂',
    '盟军兵营',
    '盟军战车工厂',
    '盟军空军指挥部',
    '盟军海军造船厂',
    '盟军战斗实验室',
    '盟军联合科研与国家工程组织节点',
  ],
  soviet: [
    '苏联建造厂',
    '苏联兵营',
    '苏联战车工厂',
    '苏联空军指挥部',
    '苏联海军造船厂',
    '红星实验设计局',
    '红星实验设计局综合体',
    '红星科学城',
    '国家战略工程综合体',
    '国家战略工程综合体／红星科学城',
    '基洛夫巨型收纳与保障库',
    '无畏重型船坞与重弹保障段',
    '战略堡垒潜艇保障段',
    '天启超重总装跨',
  ],
  yuri: [
    '尤里建造厂',
    '尤里建造厂核心',
    '尤里兵营',
    '尤里克隆与新兵训导营',
    '尤里战车工厂',
    '尤里生物机电战车总装厂',
    '尤里船厂',
    '尤里半潜与仿生造船厂',
    '神经航空引导盘',
    '尤里心灵研究实验室',
    '尤里作战实验室',
    '基因测序与心灵谐振研究院',
    '双螺旋生命工程与高维意识科学院',
    '双螺旋生命科学院',
    '母脑湿件培育与特装总装跨',
    '环形磁流体飞碟整备与微波充能巢',
    '半潜消磁船坞与龟背重弹装填栈桥',
  ],
};

/** 巨构关键词识别列表（「空间站」已退场：D-C6——本体升格为 V2 仓段化工程「轨道空间站」，建造面板不再单列） */
export const MEGASTRUCTURE_KEYWORDS = [
  '超时空',
  '天气控制',
  '气象',
  '核弹',
  '铁幕',
  '心灵控制',
  '基因突变',
  '法式要塞巨炮',
  '小型模块化核反应堆',
  '航天发射中心',
  '火箭制造厂',
  '卫星测控站',
  '间谍卫星上行站',
];

/** 空中载具关键词 */
export const AIR_KEYWORDS = [
  '战隼',
  '黑鹰',
  '小鸟',
  '飞机',
  '战机',
  '直升机',
  '无人机',
  '死神',
  '女武神',
  '阿帕奇',
  '支奴干',
  'B-52',
  '入侵者',
  '夜鹰',
  'Switchblade',
];

/** 海军舰艇关键词 */
export const NAVY_KEYWORDS = [
  '造船厂',
  '舰',
  '艇',
  '潜艇',
  '驱逐舰',
  '巡洋舰',
  '航空母舰',
  '航母',
  '伯克级',
  '提康德罗加',
  '洛杉矶级',
  '黄蜂级',
  '小鹰级',
  '尼米兹级',
  '海豚',
  '乌贼',
  '登陆艇',
];

/** 各建筑与部队已建数量映射（严格联动当前选定基地） */
export function buildBuiltCountMap(snapshot: Schema | null | undefined, activeBaseIndex: number): Map<string, number> {
  const map = new Map<string, number>();
  const bases = snapshot?.bases ?? [];
  const currentBase = bases[activeBaseIndex] ?? bases[0];
  if (currentBase?.buildings) {
    for (const b of currentBase.buildings) {
      map.set(b.name, (map.get(b.name) ?? 0) + 1);
    }
  }
  if (snapshot?.forces?.troops) {
    for (const [troop, count] of Object.entries(snapshot.forces.troops)) {
      map.set(troop, (map.get(troop) ?? 0) + count);
      const stripped = stripMassProductionSuffix(troop);
      if (stripped && stripped !== troop) {
        map.set(stripped, (map.get(stripped) ?? 0) + count);
      }
    }
  }
  if (snapshot?.forces?.vehicles) {
    for (const v of snapshot.forces.vehicles) {
      map.set(v, (map.get(v) ?? 0) + 1);
      const stripped = stripMassProductionSuffix(v);
      if (stripped && stripped !== v) {
        map.set(stripped, (map.get(stripped) ?? 0) + 1);
      }
    }
  }
  if (snapshot?.forces?.equipment) {
    for (const [eq, count] of Object.entries(snapshot.forces.equipment)) {
      if (typeof count === 'number' && count > 0) {
        map.set(eq, (map.get(eq) ?? 0) + count);
      }
    }
  }
  const rawRootGirls = (snapshot as { girls?: Array<{ name?: string; model?: string; alias?: string }> } | null | undefined)?.girls ?? [];
  const allGirls = [...rawRootGirls, ...(snapshot?.forces?.girls ?? [])];
  if (allGirls.length > 0) {
    const seenGirlNames = new Set<string>();
    const girlKeyCounts = new Map<string, number>();
    for (const g of allGirls) {
      const gName = typeof g?.name === 'string' ? g.name.trim() : '';
      if (!gName || seenGirlNames.has(gName)) continue;
      seenGirlNames.add(gName);
      const candidateKeys = new Set<string>([gName]);
      const gModel = typeof g?.model === 'string' ? g.model.trim() : '';
      const gAlias = typeof g?.alias === 'string' ? g.alias.trim() : '';
      if (gModel) candidateKeys.add(gModel);
      if (gAlias) candidateKeys.add(gAlias);
      for (const k of candidateKeys) {
        girlKeyCounts.set(k, (girlKeyCounts.get(k) ?? 0) + 1);
      }
    }
    for (const [k, cnt] of girlKeyCounts.entries()) {
      map.set(k, Math.max(map.get(k) ?? 0, cnt));
    }
  }
  return map;
}

/** 解析生产项目已拥有数量（兼容主名称、剥离后缀名、现代化改型名与 aliases 别名映射；同族累加） */
export function resolveProductionBuiltCount(
  builtCountMap: ReadonlyMap<string, number>,
  cleanName: string,
  rawName: string,
  aliases?: readonly string[],
  upgradedName?: string,
): number {
  let max = Math.max(builtCountMap.get(cleanName) ?? 0, builtCountMap.get(rawName) ?? 0);
  for (const alias of aliases ?? []) {
    const trimmed = typeof alias === 'string' ? alias.trim() : '';
    if (!trimmed) continue;
    max = Math.max(max, builtCountMap.get(trimmed) ?? 0);
    const stripped = stripMassProductionSuffix(trimmed);
    if (stripped) {
      max = Math.max(max, builtCountMap.get(stripped) ?? 0);
    }
  }
  if (upgradedName && upgradedName !== cleanName && upgradedName !== rawName) {
    const upgradedCount =
      builtCountMap.get(upgradedName) ?? builtCountMap.get(stripMassProductionSuffix(upgradedName)) ?? 0;
    return max + upgradedCount;
  }
  return max;
}

/** 解析生产项目在途队列项（兼容主名称、剥离后缀名、现代化改型名与 aliases 别名映射） */
export function resolveProductionQueueItem(
  queueMap: ReadonlyMap<string, QueueItem>,
  cleanName: string,
  rawName: string,
  aliases?: readonly string[],
  upgradedName?: string,
): QueueItem | undefined {
  if (upgradedName) {
    const upgHit = queueMap.get(upgradedName) ?? queueMap.get(stripMassProductionSuffix(upgradedName));
    if (upgHit) return upgHit;
  }
  const direct = queueMap.get(cleanName) ?? queueMap.get(rawName);
  if (direct) return direct;
  for (const alias of aliases ?? []) {
    const trimmed = typeof alias === 'string' ? alias.trim() : '';
    if (!trimmed) continue;
    const hit = queueMap.get(trimmed) ?? queueMap.get(stripMassProductionSuffix(trimmed));
    if (hit) return hit;
  }
  return undefined;
}

/** 当前队列状态映射（同时兼容去除“（量产体）”前后的新旧名称键；同名多条时优先展示 active > settling > queued） */
function getQueueStatusPriority(status: QueueItem['status'] | undefined): number {
  if (status === 'active') return 4;
  if (status === 'settling') return 3;
  if (status === 'queued') return 2;
  return 1;
}

export function buildQueueMap(snapshot: Schema | null | undefined): Map<string, QueueItem> {
  const map = new Map<string, QueueItem>();
  const setPreferred = (key: string, q: QueueItem) => {
    const existing = map.get(key);
    if (!existing || getQueueStatusPriority(q.status) > getQueueStatusPriority(existing.status)) {
      map.set(key, q);
    }
  };
  for (const q of snapshot?.queues ?? []) {
    setPreferred(q.item, q);
    const stripped = stripMassProductionSuffix(q.item);
    if (stripped && stripped !== q.item) {
      setPreferred(stripped, q);
    }
  }
  return map;
}

function createEmptyBuildingLiveStats(): BuildingCardLiveStats {
  return {
    builtCount: 0,
    runningCount: 0,
    underConstructionCount: 0,
    damagedCount: 0,
    stoppedCount: 0,
    accelCount: 0,
    mountedAddonCount: 0,
    layers: [],
  };
}

/**
 * FD-39 (PKG-C): 本基地建筑实况微状态聚合纯函数
 * 统计当前选定基地内各建筑的已建座数、运转/受损/停机/在建计数、双模加速数、实例级与目录级扩建挂件数及分布层位。
 */
export function buildBaseBuildingLiveStatsMap(
  snapshot: Schema | null | undefined,
  activeBaseIndex: number,
  distinctCatalogBuildingNames?: ReadonlySet<string>,
): Map<string, BuildingCardLiveStats> {
  const map = new Map<string, BuildingCardLiveStats>();
  const bases = snapshot?.bases ?? [];
  const currentBase = bases[activeBaseIndex] ?? bases[0];
  const buildings = currentBase?.buildings ?? [];
  if (buildings.length === 0) return map;

  const getOrCreate = (key: string): BuildingCardLiveStats => {
    let entry = map.get(key);
    if (!entry) {
      entry = createEmptyBuildingLiveStats();
      map.set(key, entry);
    }
    return entry;
  };

  // 1. 遍历每座建筑，按原名与剥离阵营前缀名双向累计实例状态与实例级 addons（若原名与剥离名在目录中同时作为独立卡片存在，则不跨卡污染）
  for (const b of buildings) {
    const rawName = typeof b.name === 'string' ? b.name.trim() : '';
    if (!rawName) continue;
    const strippedName = stripFactionBuildingPrefix(rawName);
    const shouldMirrorToStripped =
      Boolean(strippedName && strippedName !== rawName) &&
      !(distinctCatalogBuildingNames?.has(rawName) && distinctCatalogBuildingNames?.has(strippedName));
    const keys = shouldMirrorToStripped ? [rawName, strippedName] : [rawName];
    const state = b.state ?? '运转';
    const isConstructing = state === '建造中';
    const isAccel = b.mode === '加速';
    const addonLen = Array.isArray(b.addons) ? b.addons.filter(a => typeof a === 'string' && a.trim().length > 0).length : 0;
    const layer = typeof b.layer === 'string' ? b.layer.trim() : '';

    for (const key of keys) {
      const stats = getOrCreate(key);
      if (isConstructing) {
        stats.underConstructionCount += 1;
      } else {
        stats.builtCount += 1;
        if (state === '运转') stats.runningCount += 1;
        else if (state === '受损') stats.damagedCount += 1;
        else if (state === '停机') stats.stoppedCount += 1;
      }
      if (isAccel) {
        stats.accelCount += 1;
      }
      if (addonLen > 0) {
        stats.mountedAddonCount += addonLen;
      }
      if (layer && !stats.layers.includes(layer)) {
        stats.layers.push(layer);
      }
    }
  }

  // 2. 识别基地内已建成的独立 addon 扩建模块（命中 BUILTIN_BUILDING_UPGRADE_SPECS 且 upgrade_mode === 'addon'），为其对应母体建筑累加 mountedAddonCount
  for (const b of buildings) {
    const rawName = typeof b.name === 'string' ? b.name.trim() : '';
    if (!rawName || b.state === '建造中') continue;
    const spec = BUILTIN_BUILDING_UPGRADE_SPECS[rawName];
    if (!spec || spec.upgrade_mode !== 'addon') continue;

    const addonDisplayName = spec.upgraded_name?.trim() || rawName;
    const hostKeySet = new Set<string>();
    for (const h of spec.host_building) {
      const trimmedH = h.trim();
      if (!trimmedH) continue;
      hostKeySet.add(trimmedH);
      const strippedH = stripFactionBuildingPrefix(trimmedH);
      if (strippedH) hostKeySet.add(strippedH);
    }

    // 同时扩展匹配基地中已存在的同族母体建筑原名（如 spec 写 '空军指挥部'，基地中为 '苏联空军指挥部'）
    let alreadyCountedInInstanceAddons = false;
    for (const otherB of buildings) {
      const otherName = typeof otherB.name === 'string' ? otherB.name.trim() : '';
      if (!otherName || otherName === rawName) continue;
      const otherStripped = stripFactionBuildingPrefix(otherName);
      if (hostKeySet.has(otherName) || (otherStripped && hostKeySet.has(otherStripped))) {
        hostKeySet.add(otherName);
        if (otherStripped) hostKeySet.add(otherStripped);
        if (
          Array.isArray(otherB.addons) &&
          otherB.addons.some(a => {
            const trimmedA = typeof a === 'string' ? a.trim() : '';
            return trimmedA === rawName || trimmedA === addonDisplayName;
          })
        ) {
          alreadyCountedInInstanceAddons = true;
        }
      }
    }

    if (!alreadyCountedInInstanceAddons) {
      for (const hk of hostKeySet) {
        getOrCreate(hk).mountedAddonCount += 1;
      }
    }
  }

  return map;
}

/**
 * FD-39 (PKG-C): 统计当前基地在途队列（active / queued / settling）的同名项目总座数/批次数
 * 解决同一建筑同时建造多座时 buildQueueMap 单键覆盖看不出在建总座数的问题。
 */
export function buildActiveQueueCountMap(
  snapshot: Schema | null | undefined,
  activeBaseIndex = 0,
  distinctCatalogBuildingNames?: ReadonlySet<string>,
): Map<string, number> {
  const map = new Map<string, number>();
  const queues = snapshot?.queues ?? [];
  if (queues.length === 0) return map;

  const bases = snapshot?.bases ?? [];
  const currentBase = bases[activeBaseIndex] ?? bases[0];

  for (const q of queues) {
    if (q.status !== 'active' && q.status !== 'queued' && q.status !== 'settling') {
      continue;
    }
    const qBase = typeof q.base === 'string' ? q.base.trim() : '';
    if (qBase && currentBase) {
      const matchesCurrent =
        qBase === currentBase.id ||
        qBase === currentBase.name ||
        canon(qBase) === canon(currentBase.id) ||
        canon(qBase) === canon(currentBase.name);
      if (!matchesCurrent) {
        continue;
      }
    }

    const rawItem = typeof q.item === 'string' ? q.item.trim() : '';
    if (!rawItem) continue;

    const delta =
      q.type === '建造' ? Math.max(1, (q.qty ?? 1) - (q.qty_done ?? 0)) : Math.max(1, (q.qty ?? 1) - (q.qty_done ?? 0));
    const keys = new Set<string>([rawItem]);
    const strippedMass = stripMassProductionSuffix(rawItem);
    if (strippedMass && strippedMass !== rawItem) {
      keys.add(strippedMass);
    }
    if (q.type === '建造') {
      const strippedFaction = stripFactionBuildingPrefix(rawItem);
      const shouldMirrorToStripped =
        Boolean(strippedFaction && strippedFaction !== rawItem) &&
        !(distinctCatalogBuildingNames?.has(rawItem) && distinctCatalogBuildingNames?.has(strippedFaction));
      if (shouldMirrorToStripped) {
        keys.add(strippedFaction);
      }
    }
    for (const k of keys) {
      map.set(k, (map.get(k) ?? 0) + delta);
    }
  }

  return map;
}

export const buildQueueCountMap = buildActiveQueueCountMap;

/** 运行时前置条件求值上下文（联动当前选定基地、已完成科技、兵力与已启封战略协议；兼容阵营前缀建筑名同义映射） */
export function buildPrerequisiteContext(
  snapshot: Schema | null | undefined,
  activeBaseIndex: number,
  catalogProtocols: unknown,
) {
  const rawBases = snapshot?.bases ?? [];
  const bases = rawBases.map(base => {
    const existingNames = new Set((base.buildings ?? []).map(b => b.name.trim()));
    const expandedBuildings = [...(base.buildings ?? [])];
    for (const b of base.buildings ?? []) {
      const m = /^(?:盟军|苏联|苏军|苏维埃|尤里|通用)\s*(.+)$/.exec(b.name.trim());
      const stripped = m?.[1]?.trim();
      if (stripped && stripped.length >= 2 && !existingNames.has(stripped)) {
        existingNames.add(stripped);
        expandedBuildings.push({ ...b, name: stripped });
      }
    }
    return {
      ...base,
      buildings: expandedBuildings,
    };
  });
  const currentBase = bases[activeBaseIndex] ?? bases[0];
  const ctx = buildCatalogPrerequisiteContext({
    bases,
    selectedBaseId: currentBase?.id || currentBase?.name || '',
    techDone: snapshot?.tech?.done ?? [],
    forces: (snapshot?.forces ?? { troops: {}, vehicles: [], girls: [] }) as unknown as import('../../红警指挥系统/core/catalogRuntimeContext').RuntimeForcesLike,
    protocols: snapshot?.protocols,
  });
  if (!ctx) return null;
  return {
    ...ctx,
    catalog: { protocols: catalogProtocols },
  };
}

export function resolveCurrentBase(snapshot: Schema | null | undefined, activeBaseIndex: number): Base | null {
  const bases = snapshot?.bases ?? [];
  return bases[activeBaseIndex] ?? bases[0] ?? null;
}

export function checkHasOperationalConyard(base: Base | null | undefined): boolean {
  const buildings = base?.buildings ?? [];
  return buildings.some(b => b.state === '运转' && CONYARD_BUILDING_NAMES.has(b.name.trim()));
}

export function resolveBaseConyardFactions(
  base: Base | null | undefined,
  fallbackFaction = 'allied',
): Set<string> {
  const factions = new Set<string>();
  for (const b of base?.buildings ?? []) {
    const name = b.name.trim();
    if (b.state !== '运转' || !CONYARD_BUILDING_NAMES.has(name)) continue;
    if (/^(?:苏联|苏军|苏维埃)/.test(name)) factions.add('soviet');
    else if (/^尤里/.test(name)) factions.add('yuri');
    else if (/^盟军/.test(name)) factions.add('allied');
    else factions.add(fallbackFaction);
  }
  return factions;
}

export function inferRunningBuildingFaction(name: string): string {
  const trimmed = name.trim();
  for (const [faction, list] of Object.entries(FACTION_PRODUCTION_BUILDING_ALLOWLIST)) {
    if (list.some(item => trimmed === item || trimmed.includes(item))) {
      return faction;
    }
  }
  if (/盟军/.test(trimmed)) return 'allied';
  if (/苏联|苏军|苏维埃|红星/.test(trimmed)) return 'soviet';
  if (/尤里|心灵|神经航空引导盘|基因测序|双螺旋生命|母脑湿件|飞碟整备|半潜消磁船坞/.test(trimmed)) return 'yuri';
  return 'common';
}

export interface PrecomputedBaseMotherBuildingCache {
  runningBuildings: ReadonlyArray<{
    name: string;
    stripped: string;
    faction: string;
    nameAndStrippedSet: ReadonlySet<string>;
  }>;
  hasAnyExplicitFaction: boolean;
  presentFactions: ReadonlySet<string>;
}

export function buildBaseMotherBuildingCache(
  base: Base | null | undefined,
  conyardFactions: ReadonlySet<string>,
): PrecomputedBaseMotherBuildingCache {
  const rawRunning = (base?.buildings ?? []).filter(b => b.state === '运转');
  const presentFactions = new Set<string>(conyardFactions);
  const runningBuildings = rawRunning.map(b => {
    const bName = b.name.trim();
    const bStripped = stripFactionBuildingPrefix(bName);
    const faction = inferRunningBuildingFaction(bName);
    if (faction !== 'common') {
      presentFactions.add(faction);
    }
    return {
      name: bName,
      stripped: bStripped,
      faction,
      nameAndStrippedSet: new Set([bName, bStripped]),
    };
  });
  return {
    runningBuildings,
    hasAnyExplicitFaction: presentFactions.size > 0,
    presentFactions,
  };
}

export function checkBaseHasFactionMotherBuilding(
  base: Base | null | undefined,
  needBuildings: readonly string[],
  itemFaction: string,
  conyardFactions: ReadonlySet<string>,
  precomputedCache?: PrecomputedBaseMotherBuildingCache,
): boolean {
  if (!itemFaction || itemFaction === 'common') return true;
  const cache = precomputedCache ?? buildBaseMotherBuildingCache(base, conyardFactions);
  if (cache.hasAnyExplicitFaction && !cache.presentFactions.has(itemFaction)) {
    return false;
  }
  for (const reqBld of needBuildings) {
    const req = reqBld?.trim();
    if (!req) continue;
    const reqStripped = stripFactionBuildingPrefix(req);
    const hasCompatibleMother = cache.runningBuildings.some(b => {
      if (b.faction !== itemFaction && b.faction !== 'common') return false;
      return (
        b.name === req ||
        b.stripped === reqStripped ||
        setHasEquivalentBuilding(b.nameAndStrippedSet, req)
      );
    });
    if (!hasCompatibleMother) return false;
  }
  return true;
}

export function isMcvVehicleName(name: string): boolean {
  return /MCV|移动基地车|基地车/i.test(name);
}

export function inferBuildEntryFaction(entry: {
  id?: string;
  name?: string;
  faction?: string;
  scope?: string;
  tags?: readonly string[];
  need_building?: string;
  need_buildings?: readonly string[];
}): string {
  if (entry.scope === 'common') return 'common';
  if (typeof entry.faction === 'string' && entry.faction.trim()) {
    const norm = normalizeFactionId(entry.faction);
    if (norm) return norm;
  }
  if (typeof entry.id === 'string' && entry.id.trim()) {
    const lowerId = entry.id.trim().toLowerCase();
    if (lowerId.startsWith('sov.') || lowerId.startsWith('soviet.') || lowerId.includes('.soviet.')) return 'soviet';
    if (lowerId.startsWith('all.') || lowerId.startsWith('allied.') || lowerId.includes('.allied.')) return 'allied';
    if (lowerId.startsWith('yuri.') || lowerId.includes('.yuri.')) return 'yuri';
    if (lowerId.startsWith('common.') || lowerId.includes('.common.')) return 'common';
  }
  for (const tag of entry.tags ?? []) {
    const tagNorm = normalizeFactionId(tag);
    if (tagNorm === 'allied' || tagNorm === 'soviet' || tagNorm === 'yuri') return tagNorm;
  }
  const textProbe = [entry.name ?? '', entry.need_building ?? '', ...(entry.need_buildings ?? [])].join(' ');
  if (/苏联|苏军|红星|磁暴|铁幕|基洛夫|天启/.test(textProbe)) return 'soviet';
  if (/盟军|超时空|光棱|幻影|裂缝产生器/.test(textProbe)) return 'allied';
  if (/尤里|心灵控制|心灵支配|基因突变|基因崩解|基因测序|双螺旋生命|神经航空引导盘|母脑湿件|飞碟整备|半潜消磁船坞|镭射幽浮|精神控制车|磁电坦克/.test(textProbe)) {
    return 'yuri';
  }
  return 'common';
}

export function resolveAvailableMcvInFleet(params: {
  snapshot: Schema | null | undefined;
  selectedFactionFilter: string;
  unlockedFactions: readonly string[];
}): string | null {
  const { snapshot, selectedFactionFilter, unlockedFactions } = params;
  const cmdRecord = snapshot?.command as Record<string, unknown> | undefined;
  const preferredFaction =
    selectedFactionFilter !== 'all'
      ? selectedFactionFilter
      : normalizeFactionId(typeof cmdRecord?.primary_faction === 'string' ? cmdRecord.primary_faction : '') ||
        unlockedFactions[0] ||
        'allied';

  const vehicles = snapshot?.forces?.vehicles ?? [];
  const mcvList = vehicles
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .filter(v => Boolean(v) && isMcvVehicleName(v));
  if (mcvList.length > 0) {
    const matched = mcvList.find(v => inferBuildEntryFaction({ name: v }) === preferredFaction);
    return matched ?? (selectedFactionFilter === 'all' ? (mcvList[0] ?? null) : null);
  }

  const allBases = snapshot?.bases ?? [];
  const anyBaseHasConyard = allBases.some(base =>
    (base.buildings ?? []).some(b => CONYARD_BUILDING_NAMES.has(b.name.trim())),
  );
  if (allBases.length > 0 && !anyBaseHasConyard) {
    if (preferredFaction === 'soviet') return 'MCV（苏联）';
    if (preferredFaction === 'yuri') return 'MCV（尤里）';
    return 'MCV（盟军）';
  }
  return null;
}

export function buildDeployMcvOrderText(baseName: string, mcv: string): { orderText: string; hintText: string } {
  return {
    orderText: `【指挥官战术指令】【下达部署指令】：在「${baseName}」就地展开 ${mcv}（请推进基地车展开为建造厂核心，并在 <事件> 中输出 类型: MCV展开）`,
    hintText: `◆ 已填入输入框：展开 ${mcv} @ ${baseName}（请确认后发送）`,
  };
}

export function buildResearchTierMap(researches: readonly { id?: string; name: string; tier?: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of researches) {
    const tier = typeof r.tier === 'number' ? r.tier : 1;
    map.set(r.name, tier);
    if (r.id) map.set(r.id, tier);
  }
  return map;
}

export function inferProductionUnlockTierFromMap(
  researchTierMap: ReadonlyMap<string, number>,
  prereqs?: readonly string[],
  hasRequirements?: boolean,
): number {
  const list = prereqs ?? [];
  if (list.length === 0 && !hasRequirements) return 0;
  let maxTier = 1;
  for (const p of list) {
    if (/协议|条令/.test(p)) {
      maxTier = Math.max(maxTier, 3);
      continue;
    }
    const t = researchTierMap.get(p);
    if (t !== undefined) {
      maxTier = Math.max(maxTier, t);
    } else if (/T3|尖端|高超|空天|蜂群|核动力航母/.test(p)) {
      maxTier = Math.max(maxTier, 3);
    } else if (/T2|换代|高级|光棱|超时空|铁幕|天启/.test(p)) {
      maxTier = Math.max(maxTier, 2);
    }
  }
  return maxTier;
}

export function resolveUnlockedFactions(snapshot: Schema | null | undefined): string[] {
  const rawList = snapshot?.command?.unlocked_factions ?? ['allied'];
  const normalized: string[] = [];
  for (const item of rawList) {
    if (typeof item !== 'string') continue;
    const id = normalizeFactionId(item);
    if (id && id !== 'common' && !normalized.includes(id)) {
      normalized.push(id);
    }
  }
  return normalized.length > 0 ? normalized : ['allied'];
}

export function buildFactionFilterPills(unlockedFactions: readonly string[]): { id: string; label: string }[] {
  return [
    { id: 'all', label: '全阵营' },
    ...unlockedFactions.map(id => ({
      id,
      label: FACTION_LABELS[id] ?? id,
    })),
  ];
}

export function buildQueueDisplayModel(
  q: QueueItem,
  laneKeyResolver: (q: QueueItem) => string,
): QueueDisplayModel {
  const laneName =
    q.type === '研究'
      ? SCHEDULE_COPY.fallbackResearchLaneName
      : (laneDefFromKey(laneKeyResolver(q))?.name ?? SCHEDULE_COPY.defaultLaneName(q.type));
  return queueDisplayModel(q, { laneName });
}

export function formatLiveStatsTitleSummary(liveStats: BuildingCardLiveStats | undefined): string {
  if (!liveStats || (liveStats.builtCount <= 0 && liveStats.underConstructionCount <= 0)) {
    return '';
  }
  const parts: string[] = [];
  if (liveStats.builtCount > 0) {
    const stateBreakdown: string[] = [];
    if (liveStats.runningCount > 0) stateBreakdown.push(`运转${liveStats.runningCount}`);
    if (liveStats.damagedCount > 0) stateBreakdown.push(`受损${liveStats.damagedCount}`);
    if (liveStats.stoppedCount > 0) stateBreakdown.push(`停机${liveStats.stoppedCount}`);
    const stateSuffix = stateBreakdown.length > 0 ? ` (${stateBreakdown.join('/')})` : '';
    parts.push(`本基地已建: ${liveStats.builtCount}座${stateSuffix}`);
  }
  if (liveStats.underConstructionCount > 0) {
    parts.push(`在建: ${liveStats.underConstructionCount}座`);
  }
  if (liveStats.accelCount > 0) {
    parts.push(`加速模式: ${liveStats.accelCount}座`);
  }
  if (liveStats.mountedAddonCount > 0) {
    parts.push(`扩建挂件: ${liveStats.mountedAddonCount}项`);
  }
  if (liveStats.layers.length > 0) {
    parts.push(`层位: ${liveStats.layers.join('/')}`);
  }
  return parts.join(' | ');
}

export function formatBuildCardTitle(item: ConsoleBuildItem, tagSummary: string): string {
  const base = `点击查阅【${item.name}】战术详情 · 标签: ${tagSummary}`;
  const liveSummary = formatLiveStatsTitleSummary(item.liveStats);
  const m = item.queueModel;
  if (!m) {
    const extraLines: string[] = [];
    if (liveSummary) extraLines.push(liveSummary);
    if (item.isMaxedOut && item.maxCount !== undefined) {
      extraLines.push(`已达生产数量上限（${item.builtCount}/${item.maxCount}）· 不可再生产`);
    }
    return extraLines.length > 0 ? `${base}\n${extraLines.join('\n')}` : base;
  }
  const lines = [m.predicate];
  if (m.laneName) lines.push(`${QUEUE_DISPLAY_COPY.tipLane}：${m.laneName}`);
  if (m.startedAt) lines.push(`${QUEUE_DISPLAY_COPY.tipStartedAt}：${m.startedAt}`);
  if (m.eta) lines.push(`${QUEUE_DISPLAY_COPY.tipEta}：${m.eta}`);
  if (m.settlingHint) lines.push(m.settlingHint);
  if (liveSummary) lines.push(liveSummary);
  return `${base}\n${lines.join('\n')}`;
}

export function domainsOf(name: string, desc: string | undefined, tags: string[] | undefined): string[] {
  return domainsOfBuilding(name, desc, tags);
}

export function bucketBuilding(
  name: string,
  desc: string | undefined,
  tags: string[] | undefined,
): { cat: MainTabId; sub: string } {
  const domains = domainsOf(name, desc, tags);
  for (const d of domains) {
    for (const g of BUILD_PANEL_GROUPS) {
      if ((g.domains as readonly string[]).includes(d)) return { cat: g.id, sub: d };
    }
  }
  if (domains.includes('人员相关')) return { cat: '基建', sub: '公共设施' };
  return { cat: '基建', sub: '其他' };
}

export function buildCatalogCanonNames(
  buildings: readonly { name: string; aliases?: readonly string[] }[],
  productions: readonly { name: string; aliases?: readonly string[] }[],
): Set<string> {
  const catalogCanonNames = new Set<string>();
  for (const b of buildings) {
    catalogCanonNames.add(canon(b.name));
    catalogCanonNames.add(canon(stripFactionBuildingPrefix(b.name)));
    for (const alias of b.aliases ?? []) {
      catalogCanonNames.add(canon(alias));
      catalogCanonNames.add(canon(stripFactionBuildingPrefix(alias)));
    }
  }
  for (const p of productions) {
    const cleanP = stripMassProductionSuffix(p.name) || p.name;
    catalogCanonNames.add(canon(p.name));
    catalogCanonNames.add(canon(cleanP));
    for (const alias of p.aliases ?? []) {
      catalogCanonNames.add(canon(alias));
      catalogCanonNames.add(canon(stripMassProductionSuffix(alias) || alias));
    }
  }
  return catalogCanonNames;
}

export function isDuplicateCodexEntry(
  rawName: string,
  cleanCodexName: string,
  catalogNames: ReadonlySet<string>,
  catalogCanonNames: ReadonlySet<string>,
): boolean {
  return (
    catalogNames.has(cleanCodexName) ||
    catalogCanonNames.has(canon(rawName)) ||
    catalogCanonNames.has(canon(cleanCodexName)) ||
    catalogCanonNames.has(canon(stripFactionBuildingPrefix(rawName))) ||
    catalogCanonNames.has(canon(stripFactionBuildingPrefix(cleanCodexName)))
  );
}

/** FD-22 纯附着扩建挂件与原位升阶包（standalone: false，共 23 项）集合，不在右侧新建面板裸露 */
export const NON_STANDALONE_UPGRADE_BUILDING_NAMES: ReadonlySet<string> = new Set([
  // 9 个原位升阶包（upgrade_mode: 'replace', standalone: false）
  '全谱电磁与微波隐身屏蔽系统',
  '先进光棱塔',
  '爱国者PAC-3增强防空阵地',
  'THAAD增程机动拦截发射单元',
  'GPI超高空火控引导站',
  '快堆闭式循环核电站',
  '国家连续性深层地下要塞',
  '地下重载军运管道枢纽',
  '铁幕多节点偏折网络',
  // 14 个母体附着扩建模块（upgrade_mode: 'addon', standalone: false）
  '数字孪生与柔性生产车间',
  '智能电网潮流调度中心',
  '预测性健康维护中心',
  '无人立体仓储调度中心',
  '战略铁路编组与动员枢纽',
  '装甲储备与装备再生基地',
  '基洛夫巨型收纳与保障库',
  '无畏重型船坞与重弹保障段',
  '战略堡垒潜艇保障段',
  '天启超重总装跨',
  'Crusher Crane重型拆解回收站',
  '空间核动力无核试验模块',
  '苏联大规模工程扩建模块',
  '红星工控防护与电磁注入终端',
]);

/** 兼容历史动作型旧名的纯挂件/升阶包别名集合 */
const LEGACY_NON_STANDALONE_UPGRADE_ALIASES: ReadonlySet<string> = new Set([
  '先进光棱塔升级',
  '爱国者阵地增强改装',
  '快堆—闭式燃料循环升级',
  '地下国家连续性升级',
  '地下重载军运实现',
  '铁幕多节点网络升级',
  '数字孪生与柔性生产改造',
  '智能电网调度改造',
  '预测维护改造',
  '无人仓储与最优调度改造',
  '战略铁路编组与动员扩建',
  '装甲储备与装备再生扩建',
  'Crusher Crane维修—拆件—报废扩建',
]);

export function shouldSkipBuildingEntry(params: {
  b: { id?: string; name: string; cost: number; standalone?: boolean };
  tags: string[];
  builtCount: number;
  q: QueueItem | undefined;
}): boolean {
  const { b, tags, builtCount, q } = params;
  if (CONYARD_BUILDING_NAMES.has(b.name) || isConyardOriginBuilding({ id: b.id, name: b.name, cost: b.cost })) {
    return true;
  }
  // FD-22（D-BLD-UPG-02）：standalone === false 的纯升级包/扩建挂件归入【建筑】模态框母体卡片内，不在右侧新建网格裸露
  const trimmedName = b.name.trim();
  if (
    !q &&
    (b.standalone === false ||
      NON_STANDALONE_UPGRADE_BUILDING_NAMES.has(trimmedName) ||
      LEGACY_NON_STANDALONE_UPGRADE_ALIASES.has(trimmedName))
  ) {
    return true;
  }
  if (builtCount > 0 && !q && isSingleInstancePerBaseBuilding({ id: b.id, name: b.name, tags })) {
    return true;
  }
  return false;
}

export interface ModernizedProductionResolution {
  isModernized: boolean;
  displayName: string;
  baseUnitName: string;
  retrofitName?: string;
  researchName?: string;
}

/**
 * FD-22（D-UNIT-MOD-01）：当对应现代化改装科技（retrofit.research）已在 tech.done 或激活协议中解锁时，
 * 右侧生产面板直接将该单位卡片切换为 upgraded_name（新出厂即现代化高级型号）。
 */
export function resolveModernizedProductionUnit(params: {
  cleanName: string;
  rawName: string;
  snapshot: Schema | null | undefined;
  catalogRetrofits?: ReadonlyArray<{
    name: string;
    research?: string;
    target_unit?: string | readonly string[];
    upgraded_name?: string | Readonly<Record<string, string>>;
  }>;
  precomputedCompletedSet?: ReadonlySet<string>;
}): ModernizedProductionResolution {
  const { cleanName, rawName, snapshot, catalogRetrofits, precomputedCompletedSet } = params;
  const completedSet =
    precomputedCompletedSet ?? buildCompletedTechAndProtocolSet(snapshot?.tech?.done ?? [], snapshot?.protocols);
  if (completedSet.size === 0) {
    return { isModernized: false, displayName: cleanName, baseUnitName: cleanName };
  }

  const targetCandidates = [cleanName, rawName].map(s => s.trim()).filter(Boolean);
  const matchesTarget = (targets: readonly string[]) =>
    targets.some(t => targetCandidates.some(c => canon(c) === canon(t)));

  // 1. 优先扫描 catalog.retrofits（支持动态世界书覆盖）
  for (const r of catalogRetrofits ?? []) {
    const research = r.research?.trim();
    if (!research || (!completedSet.has(canon(research)) && !completedSet.has(research))) continue;
    const targets =
      typeof r.target_unit === 'string'
        ? [r.target_unit]
        : Array.isArray(r.target_unit)
          ? r.target_unit
          : [];
    if (!targets.length || !matchesTarget(targets)) continue;
    let upgName = '';
    if (typeof r.upgraded_name === 'string') {
      upgName = r.upgraded_name.trim();
    } else if (r.upgraded_name && typeof r.upgraded_name === 'object') {
      const hitKey = Object.keys(r.upgraded_name).find(k => targetCandidates.some(c => canon(c) === canon(k)));
      upgName = (hitKey ? r.upgraded_name[hitKey] : Object.values(r.upgraded_name)[0]) ?? '';
    }
    if (upgName) {
      return {
        isModernized: true,
        displayName: upgName,
        baseUnitName: cleanName,
        retrofitName: r.name,
        researchName: research,
      };
    }
  }

  // 2. 兜底扫描内置 48 条改装规格表（兼容单测未挂载完整 catalog.retrofits 的场景）
  for (const [retrofitName, spec] of Object.entries(BUILTIN_RETROFIT_UPGRADE_SPECS)) {
    if (!spec.target_unit?.length) continue;
    if (!completedSet.has(canon(spec.research)) && !completedSet.has(spec.research)) continue;
    if (!matchesTarget(spec.target_unit)) continue;
    const upgName =
      spec.research === '航母电磁弹射改装工程研发' && canon(cleanName) === canon('CV-63小鹰级常规动力航空母舰')
        ? 'CV-63小鹰级航空母舰(电弹现代改)'
        : spec.upgraded_name;
    return {
      isModernized: true,
      displayName: upgName,
      baseUnitName: cleanName,
      retrofitName,
      researchName: spec.research,
    };
  }

  return { isModernized: false, displayName: cleanName, baseUnitName: cleanName };
}

export { BUILTIN_BUILDING_UPGRADE_SPECS, buildCompletedTechAndProtocolSet };

const INDIVIDUAL_DOSSIER_PARAM_KEYS: ReadonlyArray<string> = [
  '随行渊源',
  '开局职务',
  '席位任命',
  '外貌着装',
  '性格与口吻',
  '履历与绝活',
  '机体序列',
  '核心意象',
  '工业专精与搭档',
  '标志性台词',
  '态度',
  '信任度',
  '信任变化',
  '身份',
  '职务',
  '关系定位',
  '近期交集',
];

/**
 * 判断一条 codex 条目是否为个人角色档案（机娘核心、随行人类副官、参谋或重要独立 NPC），
 * 而非可在兵营/工厂排产量产的通用单位蓝图。
 */
export function isIndividualCharacterCodexEntry(
  c: CodexEntry,
  knownPersonNames?: ReadonlySet<string>,
): boolean {
  const rawName = (c.name ?? '').trim();
  const cleanName = (stripMassProductionSuffix(rawName) || rawName).trim();
  if (!rawName || /^待授名/.test(rawName) || /^待授名/.test(cleanName)) {
    return true;
  }
  if (c.kind === '人物') {
    return true;
  }
  if (knownPersonNames && (knownPersonNames.has(rawName) || knownPersonNames.has(cleanName))) {
    return true;
  }
  const params = c.params ?? {};
  const hasExplicitProductionSpec = Boolean(
    params['造价']?.trim() || params['费用']?.trim() || params['前置']?.trim(),
  );
  if (!hasExplicitProductionSpec && INDIVIDUAL_DOSSIER_PARAM_KEYS.some(k => Boolean(params[k]?.trim()))) {
    return true;
  }
  const tags = params.tags
    ? String(params.tags)
        .split(/[,，\s]+/)
        .filter(Boolean)
    : [];
  if (tags.some(t => /机娘|个体|副官|参谋|待授名|人物/.test(t))) {
    return true;
  }
  if (c.kind === '人员' && !hasExplicitProductionSpec) {
    return true;
  }
  return false;
}

export function parseCodexEntryMeta(c: CodexEntry): {
  cost: number;
  power: number | undefined;
  codexTags: string[] | undefined;
  desc: string;
  codexFaction: string;
  cleanCodexName: string;
} {
  const cleanCodexName = stripMassProductionSuffix(c.name) || c.name;
  const cost = Number(c.params['造价'] || c.params['费用'] || 500);
  const power = c.params['耗电']
    ? Number(c.params['耗电'])
    : c.params['发电']
      ? -Number(c.params['发电'])
      : undefined;
  const codexTags = c.params?.tags
    ? String(c.params.tags)
        .split(/[,，\s]+/)
        .filter(Boolean)
    : undefined;
  const codexRecord = c as Record<string, unknown>;
  const desc =
    c.desc || (typeof codexRecord.content === 'string' ? codexRecord.content : '') || c.params?.['描述'] || '';
  const codexFaction = inferBuildEntryFaction({
    name: cleanCodexName,
    faction: String(c.params?.['阵营'] ?? c.params?.['阵营归属'] ?? c.params?.faction ?? ''),
    tags: codexTags,
    need_building: String(c.params?.['前置'] ?? ''),
  });
  return { cost, power, codexTags, desc, codexFaction, cleanCodexName };
}

export function filterItemsByFaction(
  items: readonly ConsoleBuildItem[],
  unlockedFactions: readonly string[],
  selectedFactionFilter: string,
): ConsoleBuildItem[] {
  const unlockedSet = new Set(unlockedFactions);
  return items.filter(item => {
    const f = item.faction ?? 'common';
    if (f !== 'common' && !unlockedSet.has(f)) return false;
    if (selectedFactionFilter !== 'all' && f !== 'common' && f !== selectedFactionFilter) {
      return false;
    }
    return true;
  });
}

export function buildSubTabsForGroup(
  currentTab: MainTabId,
  allItems: readonly ConsoleBuildItem[],
): { id: SubTabId; label: string; icon: string }[] {
  const group = BUILD_PANEL_GROUPS.find(g => g.id === currentTab);
  if (!group) return [];
  const iconOf = (label: string) => SUB_TAB_ICONS[label] ?? 'dots';
  if (group.id === '生产') {
    return [
      { id: '全部', label: '全部', icon: iconOf('全部') },
      ...PRODUCTION_SUBS.map(s => ({ id: s as string, label: s, icon: iconOf(s) })),
    ];
  }
  if (!group.domains.length) return [];
  const subs = [
    { id: '全部', label: '全部', icon: iconOf('全部') },
    ...group.domains.map(d => ({ id: d as string, label: d, icon: iconOf(d) })),
  ];
  if (allItems.some(i => i.category === group.id && i.subCategory === '其他')) {
    subs.push({ id: '其他', label: '其他', icon: iconOf('其他') });
  }
  return subs;
}

export function computeTraitCounts(scopedItems: readonly ConsoleBuildItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of scopedItems) {
    for (const tag of item.tags ?? []) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

/** 建造面板收藏夹持久化键（localStorage） */
export const BUILD_FAVORITES_STORAGE_KEY = 'ra_console_build_favorites_v1';

/** 生成条目稳定的收藏主键（优先使用原名/基础名，避免现代改换名后丢失星标） */
export function resolveBuildFavoriteKey(item: Pick<ConsoleBuildItem, 'id' | 'name' | 'baseUnitName'>): string {
  const base = item.baseUnitName?.trim() || item.name?.trim() || item.id?.trim() || '';
  return item.id?.startsWith('bld-') ? `bld:${base}` : item.id?.startsWith('prod-') ? `prod:${base}` : item.id || base;
}

export function loadBuildFavoritesFromStorage(storage?: Pick<Storage, 'getItem'> | null): Set<string> {
  const target =
    storage ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);
  if (!target) return new Set();
  try {
    const raw = target.getItem(BUILD_FAVORITES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0));
  } catch {
    return new Set();
  }
}

export function saveBuildFavoritesToStorage(
  favorites: ReadonlySet<string>,
  storage?: Pick<Storage, 'setItem'> | null,
): void {
  const target =
    storage ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);
  if (!target) return;
  try {
    target.setItem(BUILD_FAVORITES_STORAGE_KEY, JSON.stringify([...favorites]));
  } catch {
    /* ignore storage quota errors */
  }
}

export function isBuildItemFavorited(
  item: Pick<ConsoleBuildItem, 'id' | 'name' | 'baseUnitName'>,
  favorites: ReadonlySet<string>,
): boolean {
  if (favorites.size === 0) return false;
  const key = resolveBuildFavoriteKey(item);
  return favorites.has(key) || favorites.has(item.id) || favorites.has(item.name);
}

export function toggleBuildFavoriteInSet(
  favorites: ReadonlySet<string>,
  item: Pick<ConsoleBuildItem, 'id' | 'name' | 'baseUnitName'>,
): Set<string> {
  const next = new Set(favorites);
  const key = resolveBuildFavoriteKey(item);
  if (next.has(key) || next.has(item.id) || next.has(item.name)) {
    next.delete(key);
    next.delete(item.id);
    next.delete(item.name);
  } else {
    next.add(key);
  }
  return next;
}

export function matchBuildQuickStatus(
  item: Pick<ConsoleBuildItem, 'isFavorite' | 'queueModel' | 'builtCount'>,
  statusFilter: BuildQuickStatusFilter,
): boolean {
  if (statusFilter === 'fav') return Boolean(item.isFavorite);
  if (statusFilter === 'active_queue') return Boolean(item.queueModel);
  if (statusFilter === 'built') return (item.builtCount ?? 0) > 0;
  return true;
}

export interface BuildQuickStatusCounts {
  all: number;
  fav: number;
  active_queue: number;
  built: number;
}

export function computeBuildQuickStatusCounts(items: readonly ConsoleBuildItem[]): BuildQuickStatusCounts {
  let fav = 0;
  let activeQueue = 0;
  let built = 0;
  for (const item of items) {
    if (item.isFavorite) fav += 1;
    if (item.queueModel) activeQueue += 1;
    if ((item.builtCount ?? 0) > 0) built += 1;
  }
  return {
    all: items.length,
    fav,
    active_queue: activeQueue,
    built,
  };
}

/**
 * 智能检索范围决议：
 * 当用户输入搜索词、切换至「◆ 仅看收藏」或「在建/排产」时，自动穿透全库（'all'），
 * 免去手动点击【本类/全库】开关的繁琐操作。
 */
export function resolveEffectiveFilterScope(params: {
  explicitScope: 'current' | 'all';
  searchQuery: string;
  statusFilter: BuildQuickStatusFilter;
}): 'current' | 'all' {
  if (params.explicitScope === 'all') return 'all';
  if (params.searchQuery.trim().length > 0) return 'all';
  if (params.statusFilter === 'fav' || params.statusFilter === 'active_queue') return 'all';
  return 'current';
}

/**
 * 支持「◆ 收藏置顶」的建造/生产卡片排序：
 * 在保持原有在建置顶（run/wait）基础上，同分类内已收藏条目优先排列在前。
 */
export function sortBuildGridItemsWithFavorites(
  items: readonly ConsoleBuildItem[],
  baseSorter: (list: readonly ConsoleBuildItem[]) => ConsoleBuildItem[],
): ConsoleBuildItem[] {
  const sorted = baseSorter(items);
  return [...sorted].sort((a, b) => {
    const aRun = a.queueModel?.tone === 'run' || a.queueModel?.tone === 'wait' ? 0 : 1;
    const bRun = b.queueModel?.tone === 'run' || b.queueModel?.tone === 'wait' ? 0 : 1;
    if (aRun !== bRun) return aRun - bRun;
    const aFav = a.isFavorite ? 0 : 1;
    const bFav = b.isFavorite ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return 0;
  });
}

/**
 * 解析零基地待命态下的拟定展开点名称：
 * 优先提取 meta.location 括号前的简称（如「恶土深处前哨（恶土·落基岭与红峰荒原）」→「恶土深处前哨」），
 * 无则回退「一号前哨基地」。
 */
export function resolvePlannedDeploySiteName(snapshot: Schema | null | undefined): string {
  const loc = snapshot?.meta?.location?.trim() ?? '';
  if (!loc) return '一号前哨基地';
  const shortName = loc.split(/[（(]/)[0]?.trim();
  return shortName || loc;
}

/**
 * 判定当前快照是否处于「已开局 · MCV 未展开零基地待命态（MCV STANDBY）」：
 * - bases.length === 0（严格遵守 MCV 展开前零预设基地铁律）；
 * - 且当前快照具备真实战役上下文（存在 meta.world_id / meta.location / 车队 MCV / 在途展开任务之一），
 *   与单测裸 Schema.parse({ command: { unlocked_factions } }) 静态目录预览夹具自然区分。
 */
export function checkIsZeroBaseStandby(
  snapshot: Schema | null | undefined,
  availableMcvInFleet: string | null,
): boolean {
  if (!snapshot) return false;
  if ((snapshot.bases?.length ?? 0) > 0) return false;
  return (
    Boolean(snapshot.meta?.world_id?.trim()) ||
    Boolean(snapshot.meta?.location?.trim()) ||
    Boolean(availableMcvInFleet) ||
    (snapshot.pending_deployments?.length ?? 0) > 0
  );
}

