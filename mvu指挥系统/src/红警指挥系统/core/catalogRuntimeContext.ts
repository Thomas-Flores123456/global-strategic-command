import { canon } from '../parse/parsePipeline';
import {
  expandTechEquivalentSet,
  parseUnitTokenNameAndCount,
  resolveUnitPresentCount,
  UNIT_EQUIVALENT_GROUPS,
  type PrerequisiteBaseState,
  type PrerequisiteContext,
  type PrerequisiteResearchCatalogEntryLike,
} from './prerequisites';
import { resolveLegacyProtocolId, resolveLegacyProtocolName } from './schema';

export { UNIT_EQUIVALENT_GROUPS };

export interface RuntimeBuildingLike {
  name: string;
  state: string;
}

export interface RuntimeProtocolInstanceLike {
  ref?: string;
  id?: string;
  title?: string;
  name?: string;
  status?: string;
}

export type RuntimeProtocolsInput =
  | Readonly<Record<string, RuntimeProtocolInstanceLike | null | undefined>>
  | ReadonlyArray<RuntimeProtocolInstanceLike | null | undefined>
  | null
  | undefined;

export interface RuntimeForcesSliceLike {
  troops?: Readonly<Record<string, number>> | null;
  infantry?: Readonly<Record<string, number>> | null;
  vehicles?: readonly unknown[] | null;
  aircraft?: readonly unknown[] | null;
}

export interface RuntimeBaseLike {
  id: string;
  name: string;
  buildings: readonly RuntimeBuildingLike[];
  forces?: RuntimeForcesSliceLike | null;
}

export interface RuntimeQueueLike {
  type: string;
  item: string;
  base: string;
}

export interface RuntimeForcesLike {
  troops?: Readonly<Record<string, number>>;
  infantry?: Readonly<Record<string, number>>;
  vehicles?: readonly unknown[];
  aircraft?: readonly unknown[];
}

export type BaseResolution =
  { status: 'resolved'; baseId: string } | { status: 'missing' | 'ambiguous'; reference: string };

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Base.id 是存储主键；仅在没有 ID 命中时兼容唯一基地名称。 */
export function resolveBaseReference(bases: readonly RuntimeBaseLike[], reference: unknown): BaseResolution {
  const value = clean(reference);
  if (!value) return { status: 'missing', reference: value };

  const byId = bases.filter(base => clean(base.id) === value);
  if (byId.length === 1) return { status: 'resolved', baseId: clean(byId[0].id) };
  if (byId.length > 1) return { status: 'ambiguous', reference: value };

  const byName = bases.filter(base => clean(base.name) === value);
  if (byName.length === 1) return { status: 'resolved', baseId: clean(byName[0].id) };
  return { status: byName.length > 1 ? 'ambiguous' : 'missing', reference: value };
}

class UnitPresentMap extends Map<string, number> {
  override get(key: string): number | undefined {
    const direct = super.get(key);
    if (direct !== undefined) return direct;
    const eqCount = resolveUnitPresentCount(this, key);
    return eqCount > 0 ? eqCount : undefined;
  }

  override has(key: string): boolean {
    if (super.has(key)) return true;
    return resolveUnitPresentCount(this, key) > 0;
  }
}

function accumulateUnitRecord(
  units: Map<string, number>,
  record?: Readonly<Record<string, number>> | null,
): void {
  if (!record || typeof record !== 'object') return;
  for (const [rawKey, rawCount] of Object.entries(record)) {
    const count = typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 0;
    if (count <= 0) continue;
    const parsed = parseUnitTokenNameAndCount(rawKey);
    if (!parsed) continue;
    const effectiveCount = parsed.count > 1 && count === 1 ? parsed.count : count;
    Map.prototype.set.call(
      units,
      parsed.rawName,
      ((Map.prototype.get.call(units, parsed.rawName) as number | undefined) ?? 0) + effectiveCount,
    );
    if (parsed.strippedName && parsed.strippedName !== parsed.rawName) {
      Map.prototype.set.call(
        units,
        parsed.strippedName,
        ((Map.prototype.get.call(units, parsed.strippedName) as number | undefined) ?? 0) + effectiveCount,
      );
    }
  }
}

function accumulateUnitList(units: Map<string, number>, list?: readonly unknown[] | null): void {
  if (!Array.isArray(list)) return;
  for (const entry of list) {
    if (typeof entry === 'string') {
      const parsed = parseUnitTokenNameAndCount(entry);
      if (!parsed) continue;
      Map.prototype.set.call(
        units,
        parsed.rawName,
        ((Map.prototype.get.call(units, parsed.rawName) as number | undefined) ?? 0) + parsed.count,
      );
      if (parsed.strippedName && parsed.strippedName !== parsed.rawName) {
        Map.prototype.set.call(
          units,
          parsed.strippedName,
          ((Map.prototype.get.call(units, parsed.strippedName) as number | undefined) ?? 0) + parsed.count,
        );
      }
    } else if (entry && typeof entry === 'object') {
      const obj = entry as { name?: unknown; model?: unknown; type?: unknown; count?: unknown };
      const rawLabel = clean(obj.name) || clean(obj.model) || clean(obj.type);
      if (!rawLabel) continue;
      const parsed = parseUnitTokenNameAndCount(rawLabel);
      if (!parsed) continue;
      const explicitCount =
        typeof obj.count === 'number' && Number.isFinite(obj.count) && obj.count > 0 ? obj.count : parsed.count;
      Map.prototype.set.call(
        units,
        parsed.rawName,
        ((Map.prototype.get.call(units, parsed.rawName) as number | undefined) ?? 0) + explicitCount,
      );
      if (parsed.strippedName && parsed.strippedName !== parsed.rawName) {
        Map.prototype.set.call(
          units,
          parsed.strippedName,
          ((Map.prototype.get.call(units, parsed.strippedName) as number | undefined) ?? 0) + explicitCount,
        );
      }
    }
  }
}

function consumeForcesSlice(units: Map<string, number>, slice?: RuntimeForcesSliceLike | null): void {
  if (!slice || typeof slice !== 'object') return;
  accumulateUnitRecord(units, slice.troops);
  if (slice.infantry && slice.infantry !== slice.troops) {
    accumulateUnitRecord(units, slice.infantry);
  }
  accumulateUnitList(units, slice.vehicles);
  if (slice.aircraft && slice.aircraft !== slice.vehicles) {
    accumulateUnitList(units, slice.aircraft);
  }
}

export function buildUnitPresent(
  forces?: RuntimeForcesLike | null,
  bases?: ReadonlyArray<{ forces?: RuntimeForcesSliceLike | null }> | null,
): ReadonlyMap<string, number> {
  const units = new UnitPresentMap();
  consumeForcesSlice(units, forces);
  if (Array.isArray(bases)) {
    for (const base of bases) {
      if (!base || !base.forces || base.forces === forces) continue;
      consumeForcesSlice(units, base.forces);
    }
  }
  return units;
}

export interface DefaultProtocolCatalogItem {
  id: string;
  name: string;
  faction: 'SOVIET' | 'ALLIED';
  track: string;
  desc?: string;
}

/**
 * 18 条内置战略协议基础目录（07 [P1-3]）：
 * 供 PanelProtocol.vue 与 ModalTechTree.vue 在动态目录非空时按 id/name 合并，防止存量协议迁出后丢失。
 */
export const DEFAULT_PROTOCOL_CATALOG_BASE: readonly DefaultProtocolCatalogItem[] = [
  // ── 18 条主线战略协议正式 ID 与中文名（与 PanelProtocol.vue / schema.ts LEGACY_PROTOCOLS 严格同源） ──
  {
    id: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
    name: '战斗工兵—预制战斗碉堡协议',
    faction: 'SOVIET',
    track: '钢铁基干与国家动员',
  },
  {
    id: 'sov.protocol.ra3.sputnik_one_way_deployment',
    name: 'Sputnik一次展开前沿节点协议',
    faction: 'SOVIET',
    track: '钢铁基干与国家动员',
  },
  {
    id: 'sov.protocol.ra3.crusher_crane_salvage',
    name: 'Crusher Crane维修—拆件—报废协议',
    faction: 'SOVIET',
    track: '钢铁基干与国家动员',
  },
  {
    id: 'sov.protocol.ra3.urban_molotov_magnetic_mine',
    name: '动员兵燃烧瓶／防空兵附着式反机动雷协议',
    faction: 'SOVIET',
    track: '钢铁基干与国家动员',
  },
  {
    id: 'sov.protocol.ra3.motorized_mortar_reserve',
    name: '摩托化迫击炮后备分队协议',
    faction: 'SOVIET',
    track: '钢铁基干与国家动员',
  },
  {
    id: 'sov.protocol.ra3.terror_drone_dual_mode',
    name: '恐怖机器人拆解／短时电磁锁止双任务包协议',
    faction: 'SOVIET',
    track: '过载工程与战区拒止',
  },
  {
    id: 'sov.protocol.ra3.tesla_mobile_parallel_charge',
    name: '磁暴步兵移动储能并联充能协议',
    faction: 'SOVIET',
    track: '过载工程与战区拒止',
  },
  {
    id: 'sov.research.t2.iron_curtain_emergency_overload',
    name: '铁幕紧急过载协议',
    faction: 'SOVIET',
    track: '过载工程与战区拒止',
  },
  {
    id: 'sov.protocol.ra3.v4_precision_payload_package',
    name: 'V3体系V4精确弹／多载荷任务包协议',
    faction: 'SOVIET',
    track: '过载工程与战区拒止',
  },
  {
    id: 'sov.protocol.ra3.kirov_dreadnought_overlimit',
    name: '基洛夫—无畏越限运行协议',
    faction: 'SOVIET',
    track: '过载工程与战区拒止',
  },
  {
    id: 'sov.protocol.ra3.anchored_magnetic_lock',
    name: '地锚式磁锁／局部奇点压制区协议',
    faction: 'SOVIET',
    track: '过载工程与战区拒止',
  },
  {
    id: 'sov.protocol.ra3.mass_production_fold_in',
    name: 'Mass Production工业调度折叠协议',
    faction: 'SOVIET',
    track: '国家战略工程与工业外延',
  },
  {
    id: 'sov.protocol.ra3.hammer_inventory_reentry',
    name: '受库存与授权约束的轨道常规载荷再入协议',
    faction: 'SOVIET',
    track: '国家战略工程与工业外延',
  },
  {
    id: 'sov.research.t3.conventional_strategic_authorization_isolation',
    name: '常规战略打击授权隔离协议',
    faction: 'SOVIET',
    track: '战略授权与核管控',
  },
  {
    id: 'sov.research.t2.nuclear_exercise_isolation_notification',
    name: '核演习隔离与通报规程',
    faction: 'SOVIET',
    track: '战略授权与核管控',
  },
  {
    id: 'sov.research.t3.nuclear_command_succession_rebuild',
    name: '核指挥接替与态势重建规程',
    faction: 'SOVIET',
    track: '战略授权与核管控',
  },
  {
    id: 'all.research.t1.european_defense_agreement',
    name: '欧洲联合防务协议',
    faction: 'ALLIED',
    track: '跨国联合防务条约',
  },
  {
    id: 'all.research.t1.pacific_rim_defense_agreement',
    name: '环太平洋防务合作协议',
    faction: 'ALLIED',
    track: '跨国联合防务条约',
  },
  {
    id: 'all.protocol.ra3.high_altitude_uav_pact',
    name: '高空无人侦察协定',
    faction: 'ALLIED',
    track: '空天优势与战术投送',
  },
  {
    id: 'all.protocol.ra3.precision_strike_upgrade',
    name: '精确打击权限升级协议',
    faction: 'ALLIED',
    track: '空天优势与战术投送',
  },
  // ── 兼容旧短名别名 ──
  { id: 'sov.protocol.ra3.OrbitalDump', name: '轨道倾泻协议', faction: 'SOVIET', track: 'orbital_drop' },
  { id: 'sov.protocol.ra3.MassProduction', name: '模组化量产协议', faction: 'SOVIET', track: 'mass_production' },
  {
    id: 'sov.protocol.ra3.ToxinCleanse',
    name: '高炉毒素净化协议',
    faction: 'SOVIET',
    track: 'furnace_overdrive',
  },
  {
    id: 'sov.protocol.ra3.HeavyDrop',
    name: '重装空投协议',
    faction: 'SOVIET',
    track: 'soviet_heavy_airlift',
  },
  {
    id: 'sov.protocol.ra3.ForcedLabor',
    name: '战时全负荷动员协议',
    faction: 'SOVIET',
    track: 'mass_production',
  },
  {
    id: 'sov.protocol.ra3.MagneticSingularity',
    name: '磁力奇点协议',
    faction: 'SOVIET',
    track: 'magnetic_axis',
  },
  {
    id: 'sov.protocol.ra3.PointDefense',
    name: '铁幕点防御协议',
    faction: 'SOVIET',
    track: 'furnace_overdrive',
  },
  {
    id: 'sov.protocol.ra3.TeslaOverload',
    name: '磁暴超载协议',
    faction: 'SOVIET',
    track: 'magnetic_axis',
  },
  {
    id: 'sov.protocol.ra3.Desolator',
    name: '辐射尘饱和协议',
    faction: 'SOVIET',
    track: 'furnace_overdrive',
  },
  {
    id: 'all.protocol.ra3.Airborne',
    name: '精确空降协议',
    faction: 'ALLIED',
    track: 'surgical_insertion',
  },
  {
    id: 'all.protocol.ra3.SatSweep',
    name: '高轨侦察扫描协议',
    faction: 'ALLIED',
    track: 'high_altitude_Load',
  },
  {
    id: 'all.protocol.ra3.CryoShot',
    name: '定点冷冻协议',
    faction: 'ALLIED',
    track: 'cryo_intervention',
  },
  {
    id: 'all.protocol.ra3.ChronoRift',
    name: '超时空裂缝协议',
    faction: 'ALLIED',
    track: 'chrono_anchor',
  },
  {
    id: 'all.protocol.ra3.FreeTrade',
    name: '战时自由贸易协议',
    faction: 'ALLIED',
    track: 'joint_logistics',
  },
  {
    id: 'all.protocol.ra3.SurgicalStrike',
    name: '外科手术打击协议',
    faction: 'ALLIED',
    track: 'surgical_insertion',
  },
  {
    id: 'all.protocol.ra3.TimeBomb',
    name: '超时空炸弹协议',
    faction: 'ALLIED',
    track: 'chrono_anchor',
  },
  {
    id: 'all.protocol.ra3.HighTech',
    name: '尖端科技超频协议',
    faction: 'ALLIED',
    track: 'cryo_intervention',
  },
  {
    id: 'all.protocol.ra3.ChronoSwap',
    name: '超时空置换协议',
    faction: 'ALLIED',
    track: 'chrono_anchor',
  },
];

export function mergeDefaultProtocolCatalog<
  T extends { id: string; name: string; faction?: string; track?: string; desc?: string },
>(defaults: readonly T[], fromCatalog?: readonly T[] | null): readonly T[] {
  if (!Array.isArray(fromCatalog) || fromCatalog.length === 0) {
    return defaults;
  }
  const shouldMergeDefaults = fromCatalog.some(
    item =>
      item &&
      typeof item.id === 'string' &&
      (item.id.includes('.') || defaults.some(d => d.id === item.id || d.name === item.name)),
  );
  if (!shouldMergeDefaults) {
    return fromCatalog;
  }
  const result: T[] = defaults.map(d => ({ ...d }));
  const indexById = new Map<string, number>();
  const indexByName = new Map<string, number>();
  result.forEach((item, idx) => {
    indexById.set(item.id, idx);
    indexByName.set(item.name, idx);
  });

  for (const item of fromCatalog) {
    if (!item || typeof item.id !== 'string') continue;
    const existingIdx = indexById.get(item.id) ?? (item.name ? indexByName.get(item.name) : undefined);
    if (existingIdx !== undefined) {
      const base = result[existingIdx];
      result[existingIdx] = {
        ...base,
        ...item,
        faction: item.faction || base.faction,
        track: item.track || base.track,
        desc: item.desc || base.desc,
      };
      indexById.set(item.id, existingIdx);
      indexByName.set(item.name, existingIdx);
    } else {
      const idx = result.length;
      result.push(item);
      indexById.set(item.id, idx);
      indexByName.set(item.name, idx);
    }
  }
  return result;
}

function addTokenWithProtocolAliases(target: Set<string>, raw: unknown): void {
  const trimmed = clean(raw);
  if (!trimmed) return;
  target.add(trimmed);
  const canonical = canon(trimmed);
  if (canonical) target.add(canonical);
  const legacyId = resolveLegacyProtocolId(trimmed);
  if (legacyId) {
    target.add(legacyId);
    target.add(canon(legacyId));
    const legacyNameFromId = resolveLegacyProtocolName(legacyId);
    if (legacyNameFromId) {
      target.add(legacyNameFromId);
      target.add(canon(legacyNameFromId));
    }
  }
  const legacyName = resolveLegacyProtocolName(trimmed);
  if (legacyName) {
    target.add(legacyName);
    target.add(canon(legacyName));
  }
  for (const def of DEFAULT_PROTOCOL_CATALOG_BASE) {
    if (
      def.id === trimmed ||
      def.name === trimmed ||
      canon(def.id) === canonical ||
      canon(def.name) === canonical
    ) {
      target.add(def.id);
      target.add(def.name);
      target.add(canon(def.id));
      target.add(canon(def.name));
    }
  }
}

/**
 * 提取当前处于 active 状态的战略协议 ID 与标题并集（含 canon 归一化与 18 条存量协议双向映射）。
 */
export function extractActiveProtocolSet(
  protocols?: RuntimeProtocolsInput,
  activeProtocols?: Iterable<string> | null,
): Set<string> {
  const result = new Set<string>();
  if (Array.isArray(protocols)) {
    for (const inst of protocols) {
      if (!inst || inst.status !== 'active') continue;
      addTokenWithProtocolAliases(result, inst.ref);
      addTokenWithProtocolAliases(result, inst.id);
      addTokenWithProtocolAliases(result, inst.title);
      addTokenWithProtocolAliases(result, inst.name);
    }
  } else if (protocols && typeof protocols === 'object') {
    for (const [key, inst] of Object.entries(protocols)) {
      if (!inst || inst.status !== 'active') continue;
      addTokenWithProtocolAliases(result, key);
      addTokenWithProtocolAliases(result, inst.ref);
      addTokenWithProtocolAliases(result, inst.id);
      addTokenWithProtocolAliases(result, inst.title);
      addTokenWithProtocolAliases(result, inst.name);
    }
  }
  if (activeProtocols) {
    for (const item of activeProtocols) {
      addTokenWithProtocolAliases(result, item);
    }
  }
  return result;
}

/**
 * 合并已研发科技（tech.done）与已激活战略协议（protocols 中 status === 'active' 或 activeProtocols），
 * 并按 TECH_EQUIVALENT_GROUPS 与可选 catalogResearches 展开科技同义词/别名/点分 ID，
 * 供工程立项门、目录前置求值、研究顾问与日程注入统一消费。
 */
export function buildCompletedTechAndProtocolSet(
  techDone?: Iterable<string> | null,
  protocols?: RuntimeProtocolsInput,
  activeProtocols?: Iterable<string> | null,
  catalogResearches?: readonly PrerequisiteResearchCatalogEntryLike[] | null,
): Set<string> {
  const result = extractActiveProtocolSet(protocols, activeProtocols);
  if (techDone) {
    for (const item of techDone) {
      addTokenWithProtocolAliases(result, item);
    }
  }
  expandTechEquivalentSet(result, catalogResearches);
  for (const token of [...result]) {
    const canonical = canon(token);
    if (canonical) result.add(canonical);
  }
  return result;
}

/**
 * 从 MVU 当前状态构造只读前置上下文。
 * 旧 need_buildings 的 scope 已由驾驶员冻结为 current；本函数只负责提供真实逐基地三态。
 */
export function buildCatalogPrerequisiteContext(input: {
  bases: readonly RuntimeBaseLike[];
  selectedBaseId: string;
  techDone: readonly string[];
  forces: RuntimeForcesLike;
  protocols?: RuntimeProtocolsInput;
  activeProtocols?: Iterable<string> | null;
  catalogResearches?: readonly PrerequisiteResearchCatalogEntryLike[] | null;
}): PrerequisiteContext | null {
  const selected = resolveBaseReference(input.bases, input.selectedBaseId);
  if (selected.status !== 'resolved') return null;

  const states = new Map<string, PrerequisiteBaseState>();
  for (const base of input.bases) {
    const id = clean(base.id);
    if (!id || states.has(id)) return null;
    const existing = new Set<string>();
    const completed = new Set<string>();
    const running = new Set<string>();
    for (const building of base.buildings) {
      const name = clean(building.name);
      if (!name) continue;
      existing.add(name);
      if (building.state !== '建造中') completed.add(name);
      if (building.state === '运转') running.add(name);
    }
    states.set(id, { existing, completed, running });
  }

  const activeProtocolSet = extractActiveProtocolSet(input.protocols, input.activeProtocols);
  const completedSet = buildCompletedTechAndProtocolSet(
    input.techDone,
    input.protocols,
    input.activeProtocols,
    input.catalogResearches,
  );

  return {
    techDone: completedSet,
    activeProtocols: activeProtocolSet,
    selectedBaseId: selected.baseId,
    bases: states,
    unitPresent: buildUnitPresent(input.forces, input.bases),
    catalog: input.catalogResearches ? { researches: input.catalogResearches } : undefined,
  };
}

/** 研究全局显示；物理队列只在解析到当前 Base.id 时显示，单基地旧空 base 兼容。 */
export function isQueueVisibleForBase(
  queue: RuntimeQueueLike,
  selectedBaseId: string,
  bases: readonly RuntimeBaseLike[],
): boolean {
  if (queue.type === '研究') return true;
  if (!clean(queue.base)) return bases.length === 1 && clean(bases[0].id) === selectedBaseId;
  const resolved = resolveBaseReference(bases, queue.base);
  return resolved.status === 'resolved' && resolved.baseId === selectedBaseId;
}

/** 研究全局去重；建造/生产只与解析到当前 Base.id 的队列比较。 */
export function queueItemsForAction(
  queues: readonly RuntimeQueueLike[],
  type: '研究' | '建造' | '生产',
  selectedBaseId: string,
  bases: readonly RuntimeBaseLike[],
): string[] {
  if (type === '研究') {
    return queues.filter(queue => queue.type === type).map(queue => queue.item);
  }
  return queues
    .filter(queue => queue.type === type)
    .filter(queue => isQueueVisibleForBase(queue, selectedBaseId, bases))
    .map(queue => queue.item);
}
