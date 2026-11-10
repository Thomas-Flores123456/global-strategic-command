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
import { FULL_DEFAULT_PROTOCOL_CATALOG } from '../engines/protocolCatalogIndex';

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
  /** 结算后的 done/cancelled 项会在队列里多留一楼供归档，不再占用槽位。 */
  status?: string;
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
  for (const def of FULL_DEFAULT_PROTOCOL_CATALOG) {
    const keys = [def.id, def.name, ...(def.aliases ?? [])];
    if (keys.some(key => key === trimmed || canon(key) === canonical)) {
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
 * 建筑/生产的 need_buildings scope 为 current（母体必须在本基地）；研究的 need_buildings scope 为 global（见 combineResearchPrerequisites）。
 * 本函数只负责提供真实逐基地三态。
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

/** 终态队列项（已完工/已取消）不再占用槽位，与 parse/engine 层同口径。 */
export function isQueueOccupying(queue: RuntimeQueueLike): boolean {
  return queue.status !== 'done' && queue.status !== 'cancelled';
}

/** 研究全局去重；建造/生产只与解析到当前 Base.id 的队列比较。终态项一律不计。 */
export function queueItemsForAction(
  queues: readonly RuntimeQueueLike[],
  type: '研究' | '建造' | '生产',
  selectedBaseId: string,
  bases: readonly RuntimeBaseLike[],
): string[] {
  const live = queues.filter(queue => queue.type === type && isQueueOccupying(queue));
  if (type === '研究') {
    return live.map(queue => queue.item);
  }
  return live
    .filter(queue => isQueueVisibleForBase(queue, selectedBaseId, bases))
    .map(queue => queue.item);
}
