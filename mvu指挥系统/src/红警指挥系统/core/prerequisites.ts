import {
  BUILTIN_PROTOCOL_FALLBACKS,
  buildProtocolCatalogLookup,
  lookupProtocolCatalogEntry,
  normalizeProtocolLookupKey,
  type ProtocolCatalogEntryBase,
  type ProtocolCatalogLookup,
} from '../engines/protocolCatalogIndex';
import {
  isIterableNonString,
  isRecord,
  setHasEquivalentBuilding,
  TECH_EQUIVALENT_GROUPS,
  toTrimmedStringSet,
  UNIT_EQUIVALENT_GROUPS,
} from './prerequisitesHelpers';

export const MAX_PREREQUISITE_DEPTH = 8;

/**
 * 前置条件原子白名单（PRT-VIS-01 · 任务包 §3.3.2 / D-P6 / D-P12）：
 * 严守三原子白名单，严禁新增 fourth atom `protocol`；协议前置统一走 `research` 原子与 `techDone ∪ activeProtocols` 判定集并集。
 */
export const PREREQUISITE_ATOM_KINDS = ['research', 'building', 'unit_present'] as const;
export type PrerequisiteAtomKind = (typeof PREREQUISITE_ATOM_KINDS)[number];

export type PrerequisiteScope = 'current' | 'global';
export type BuildingRequirementState = 'existing' | 'completed' | 'running';

export type PrerequisiteAtom =
  | { kind: 'research'; name: string; id?: string }
  | { kind: 'research'; id: string; name?: string }
  | {
      kind: 'building';
      name: string;
      scope: PrerequisiteScope;
      state: BuildingRequirementState;
    }
  | { kind: 'unit_present'; name: string; min?: number; scope: 'global' };

export type PrerequisiteCondition = { op: 'all' | 'any'; conditions: PrerequisiteCondition[] } | PrerequisiteAtom;

export interface PrerequisiteBaseState {
  existing: ReadonlySet<string>;
  completed: ReadonlySet<string>;
  running: ReadonlySet<string>;
}

export interface PrerequisiteProtocolEntryLike {
  id?: string;
  ref?: string;
  name?: string;
  status?: string;
  aliases?: readonly string[];
}

export type PrerequisiteProtocolSource =
  readonly PrerequisiteProtocolEntryLike[] | Record<string, PrerequisiteProtocolEntryLike>;

export interface PrerequisiteResearchCatalogEntryLike {
  id?: string;
  name?: string;
  aliases?: readonly string[];
}

export interface PrerequisiteContext {
  techDone: ReadonlySet<string>;
  selectedBaseId: string;
  bases: ReadonlyMap<string, PrerequisiteBaseState>;
  unitPresent: ReadonlyMap<string, number>;
  /** 可选：当前选定基地的在场运转建筑集合（支持直接传入 Set/数组，或由 bases.get(selectedBaseId).running 自动提取） */
  selectedBaseBuildings?: Iterable<string>;
  /** 可选：已激活协议集合（可为协议权威 id / 中文 name 字符串集合，或运行时 ProtocolInstance 列表） */
  activeProtocols?: Iterable<string | PrerequisiteProtocolEntryLike>;
  /** 可选：协议目录定义（数组或 Record），用于双向解析协议 id ↔ 中文权威名及判定是否为协议前置 */
  protocols?: PrerequisiteProtocolSource;
  /** 可选：运行时状态切片（若提供 state.protocols，自动提取 status === 'active' 的协议并入判定集） */
  state?: {
    protocols?: readonly PrerequisiteProtocolEntryLike[];
    tech?: { done?: readonly string[] };
  };
  /** 可选：有效目录切片（若提供 catalog.protocols / catalog.researches，自动纳入协议与科技别名定义索引） */
  catalog?: {
    protocols?: PrerequisiteProtocolSource;
    researches?: readonly PrerequisiteResearchCatalogEntryLike[];
  };
}

export interface PrerequisiteDiagnostic {
  path: string;
  code:
    | 'invalid_shape'
    | 'invalid_group'
    | 'empty_any'
    | 'invalid_atom'
    | 'invalid_name'
    | 'invalid_min'
    | 'invalid_legacy'
    | 'max_depth';
  message: string;
}

export interface UnmetPrerequisite {
  path: string;
  message: string;
}

export interface PrerequisiteEvaluation {
  satisfied: boolean;
  unmet: UnmetPrerequisite[];
  diagnostics: PrerequisiteDiagnostic[];
}

export interface LegacyRequirementFields {
  research?: string | null;
  prereqs?: readonly string[];
  need_buildings?: readonly string[];
  need_units?: readonly string[];
  requirements?: unknown;
}

const LUNAR_MASS_DRIVER_HEAD_KEYS: ReadonlySet<string> = new Set(['月面电磁投射工学', '月面原位资源利用工学']);

/**
 * 获取给定科技键对应的同义词/别名候选列表。
 * - 当玩家已完成 `月面电磁投射工学` / `月面原位资源利用工学` 时，可展开全部 5 项；
 * - 当仅完成 T1/T2 的 `化学火箭推进学`/`火箭推进基础工学` 等单项时，仅双向互通各自配对，不反向越级解锁 `月面电磁投射工学`。
 */
export function getTechEquivalentsForKey(
  rawKey: string,
  catalogResearches?: readonly PrerequisiteResearchCatalogEntryLike[] | null,
): string[] {
  const trimmed = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!trimmed) return [];
  const out = new Set<string>([trimmed]);

  for (const group of TECH_EQUIVALENT_GROUPS) {
    if (!(group as readonly string[]).includes(trimmed)) continue;
    if (group[0] === '月面电磁投射工学' && group.length > 2) {
      if (LUNAR_MASS_DRIVER_HEAD_KEYS.has(trimmed)) {
        for (const item of group) out.add(item);
      }
      continue;
    }
    for (const item of group) out.add(item);
  }

  if (Array.isArray(catalogResearches)) {
    for (const entry of catalogResearches) {
      if (!entry || typeof entry !== 'object') continue;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      const aliases = Array.isArray(entry.aliases)
        ? entry.aliases.map(a => (typeof a === 'string' ? a.trim() : '')).filter(Boolean)
        : [];
      const allKeys = [id, name, ...aliases].filter(Boolean);
      if (!allKeys.includes(trimmed)) continue;
      const isLunarMassDriverEntry = id === '月面电磁投射工学' || name === '月面电磁投射工学';
      if (isLunarMassDriverEntry && !LUNAR_MASS_DRIVER_HEAD_KEYS.has(trimmed)) continue;
      for (const k of allKeys) out.add(k);
    }
  }

  for (const key of [...out]) {
    for (const group of TECH_EQUIVALENT_GROUPS) {
      if (group[0] === '月面电磁投射工学' && group.length > 2) continue;
      if ((group as readonly string[]).includes(key)) {
        for (const item of group) out.add(item);
      }
    }
  }

  return [...out];
}

export function expandTechEquivalentSet(
  target: Set<string>,
  catalogResearches?: readonly PrerequisiteResearchCatalogEntryLike[] | null,
): Set<string> {
  for (const key of [...target]) {
    for (const eq of getTechEquivalentsForKey(key, catalogResearches)) {
      target.add(eq);
    }
  }
  return target;
}

const UNIT_STATUS_SUFFIX_REGEX =
  /(?:\s*[（(]\s*(?:正常|受损|完好|待修|战损|轻伤|重伤|维修中|修理中|在役|待命|休整|满编|半编|量产体|量产型|量产型步兵)\s*[)）])+\s*$/g;

const UNIT_COUNT_SUFFIX_REGEX = /^(.*?)(?:(?:\s+|[×*]|(?<=[)）\u4e00-\u9fa5]))[×xX*]\s*(\d+))\s*$/;

export function parseUnitTokenNameAndCount(
  raw: string,
): { rawName: string; strippedName: string; count: number } | null {
  if (typeof raw !== 'string') return null;
  const rawName = raw.trim();
  if (!rawName) return null;

  let basePart = rawName;
  let count = 1;
  const countMatch = UNIT_COUNT_SUFFIX_REGEX.exec(rawName);
  if (countMatch) {
    const candidateBase = countMatch[1]?.trim() ?? '';
    const parsedNum = Number.parseInt(countMatch[2] ?? '1', 10);
    if (candidateBase && Number.isFinite(parsedNum) && parsedNum > 0) {
      basePart = candidateBase;
      count = parsedNum;
    }
  }

  const strippedName = basePart.replace(UNIT_STATUS_SUFFIX_REGEX, '').trim() || basePart;
  return { rawName, strippedName, count };
}

export function resolveUnitPresentCount(unitPresent: ReadonlyMap<string, number>, targetName: string): number {
  const trimmed = typeof targetName === 'string' ? targetName.trim() : '';
  if (!trimmed) return 0;

  const rawDirect = Map.prototype.get.call(unitPresent, trimmed) as number | undefined;
  const parsedTarget = parseUnitTokenNameAndCount(trimmed);
  const strippedTarget = parsedTarget?.strippedName ?? trimmed;

  const candidateSet = new Set<string>([trimmed, strippedTarget]);
  for (const group of UNIT_EQUIVALENT_GROUPS) {
    if ((group as readonly string[]).includes(trimmed) || (group as readonly string[]).includes(strippedTarget)) {
      for (const alias of group) candidateSet.add(alias);
    }
  }

  let total = 0;
  for (const candidate of candidateSet) {
    const val = Map.prototype.get.call(unitPresent, candidate) as number | undefined;
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      total += val;
    }
  }
  if (total > 0) {
    return typeof rawDirect === 'number' && rawDirect > total ? rawDirect : total;
  }

  if (typeof rawDirect === 'number' && Number.isFinite(rawDirect) && rawDirect > 0) {
    return rawDirect;
  }

  let fallbackTotal = 0;
  for (const [k, v] of Map.prototype.entries.call(unitPresent) as IterableIterator<[string, number]>) {
    if (typeof k !== 'string' || typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    const parsedKey = parseUnitTokenNameAndCount(k);
    if (parsedKey && candidateSet.has(parsedKey.strippedName)) {
      fallbackTotal += parsedKey.count > 1 && v === 1 ? parsedKey.count : v;
    }
  }
  return fallbackTotal;
}

export function validatePrerequisiteCondition(
  value: unknown,
  path = 'requirements',
  depth = 0,
): PrerequisiteDiagnostic[] {
  if (depth > MAX_PREREQUISITE_DEPTH) {
    return [{ path, code: 'max_depth', message: `条件嵌套超过 ${MAX_PREREQUISITE_DEPTH} 层` }];
  }
  if (!isRecord(value)) {
    return [{ path, code: 'invalid_shape', message: '条件必须是对象' }];
  }
  const hasOp = Object.hasOwn(value, 'op');
  const hasKind = Object.hasOwn(value, 'kind');
  if (hasOp === hasKind) {
    return [{ path, code: 'invalid_shape', message: '条件必须且只能包含 op 或 kind 判别字段' }];
  }
  if (hasOp) {
    if (value.op !== 'all' && value.op !== 'any') {
      return [{ path: `${path}.op`, code: 'invalid_group', message: `未知条件组：${String(value.op)}` }];
    }
    if (!Array.isArray(value.conditions)) {
      return [{ path: `${path}.conditions`, code: 'invalid_group', message: 'conditions 必须是数组' }];
    }
    const diagnostics: PrerequisiteDiagnostic[] =
      value.op === 'any' && value.conditions.length === 0
        ? [{ path: `${path}.conditions`, code: 'empty_any', message: 'any 条件组不能为空' }]
        : [];
    value.conditions.forEach((condition, index) => {
      diagnostics.push(...validatePrerequisiteCondition(condition, `${path}.conditions[${index}]`, depth + 1));
    });
    return diagnostics;
  }

  if (!(PREREQUISITE_ATOM_KINDS as readonly string[]).includes(String(value.kind))) {
    return [{ path: `${path}.kind`, code: 'invalid_atom', message: `未知条件原子：${String(value.kind)}` }];
  }
  if (value.kind === 'research') {
    const hasNameProp = Object.hasOwn(value, 'name') && value.name !== undefined;
    const hasIdProp = Object.hasOwn(value, 'id') && value.id !== undefined;
    if (!hasNameProp && !hasIdProp) {
      return [{ path: `${path}.name`, code: 'invalid_name', message: '条件名称不能为空' }];
    }
    if (hasNameProp) {
      if (typeof value.name !== 'string' || !value.name.trim()) {
        return [{ path: `${path}.name`, code: 'invalid_name', message: '条件名称不能为空' }];
      }
      if (value.name !== value.name.trim()) {
        return [{ path: `${path}.name`, code: 'invalid_name', message: '条件名称不能含首尾空白' }];
      }
    }
    if (hasIdProp) {
      const idPath = hasNameProp ? `${path}.id` : `${path}.name`;
      if (typeof value.id !== 'string' || !value.id.trim()) {
        return [{ path: idPath, code: 'invalid_name', message: '条件名称不能为空' }];
      }
      if (value.id !== value.id.trim()) {
        return [{ path: idPath, code: 'invalid_name', message: '条件名称不能含首尾空白' }];
      }
    }
    return [];
  }
  if (typeof value.name !== 'string' || !value.name.trim()) {
    return [{ path: `${path}.name`, code: 'invalid_name', message: '条件名称不能为空' }];
  }
  if (value.name !== value.name.trim()) {
    return [{ path: `${path}.name`, code: 'invalid_name', message: '条件名称不能含首尾空白' }];
  }
  if (value.kind === 'building') {
    const diagnostics: PrerequisiteDiagnostic[] = [];
    if (value.scope !== 'current' && value.scope !== 'global') {
      diagnostics.push({ path: `${path}.scope`, code: 'invalid_atom', message: '建筑 scope 必须是 current 或 global' });
    }
    if (!['existing', 'completed', 'running'].includes(String(value.state))) {
      diagnostics.push({
        path: `${path}.state`,
        code: 'invalid_atom',
        message: '建筑 state 必须是 existing、completed 或 running',
      });
    }
    return diagnostics;
  }
  if (value.kind === 'unit_present') {
    const diagnostics: PrerequisiteDiagnostic[] = [];
    if (value.scope !== 'global') {
      diagnostics.push({ path: `${path}.scope`, code: 'invalid_atom', message: 'S1-A 的单位条件只支持 global' });
    }
    const min = value.min;
    if (min !== undefined && (typeof min !== 'number' || !Number.isInteger(min) || min < 1)) {
      diagnostics.push({ path: `${path}.min`, code: 'invalid_min', message: '单位最小数量必须是大于等于 1 的整数' });
    }
    return diagnostics;
  }
  return [];
}

interface ProtocolLookupTable {
  idToName: Map<string, string>;
  nameToId: Map<string, string>;
  knownProtocolKeys: Set<string>;
  catalogLookup: ProtocolCatalogLookup<ProtocolCatalogEntryBase>;
}

function extractProtocolSourceEntries(source?: PrerequisiteProtocolSource): PrerequisiteProtocolEntryLike[] {
  if (!source) return [];
  if (Array.isArray(source)) return source;
  if (isRecord(source)) return Object.values(source) as PrerequisiteProtocolEntryLike[];
  return [];
}

function buildProtocolLookupTable(context: PrerequisiteContext): ProtocolLookupTable {
  const dynamicEntries: ProtocolCatalogEntryBase[] = [];
  const rawSources = [
    ...extractProtocolSourceEntries(context.catalog?.protocols),
    ...extractProtocolSourceEntries(context.protocols),
    ...(Array.isArray(context.state?.protocols) ? context.state.protocols : []),
  ];

  const extraKnownProtocolIds: string[] = [];
  for (let i = rawSources.length - 1; i >= 0; i--) {
    const entry = rawSources[i];
    if (!entry || typeof entry !== 'object') continue;
    const rawId =
      (typeof entry.id === 'string' && entry.id.trim()) || (typeof entry.ref === 'string' && entry.ref.trim()) || '';
    const rawName = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (rawId) extraKnownProtocolIds.push(rawId);
    if (!rawName) continue;
    dynamicEntries.push({
      id: rawId || undefined,
      name: rawName,
      aliases: Array.isArray(entry.aliases) ? entry.aliases : undefined,
    });
  }

  const catalogLookup = buildProtocolCatalogLookup(dynamicEntries, {
    includeLegacyFallbacks: true,
    includeBuiltinFallbacks: true,
    preferLaterEntries: false,
  });

  for (const id of extraKnownProtocolIds) {
    catalogLookup.knownProtocolKeys.add(id);
  }

  for (const def of BUILTIN_PROTOCOL_FALLBACKS) {
    catalogLookup.knownProtocolKeys.add(def.id);
    catalogLookup.knownProtocolKeys.add(def.name);
  }

  return {
    idToName: catalogLookup.idToNameMap,
    nameToId: catalogLookup.nameToIdMap,
    knownProtocolKeys: catalogLookup.knownProtocolKeys,
    catalogLookup,
  };
}

/**
 * 构建判定集并集 `techDone ∪ activeProtocols`（PRT-VIS-01 · 任务包 §3.3.2 / D-P6 / D-P12 / PKG-A）：
 * - 包含 `context.techDone` 及 `context.state?.tech?.done` 中的全部已完成科技标识；
 * - 包含 `context.activeProtocols` 及 `context.state?.protocols` 中 `status === 'active'` 的协议权威 ID 与中文名称；
 * - 通过 `LEGACY_PROTOCOL_DEFINITIONS` 与 `catalog.protocols` / `context.protocols` 双向补齐协议 ID ↔ 中文名称；
 * - 通过 `TECH_EQUIVALENT_GROUPS` 与 `context.catalog?.researches` 双向展开科技别名、旧简称与点分 ID。
 */
export function buildEffectiveTechAndProtocolSet(context: PrerequisiteContext): Set<string> {
  const lookup = buildProtocolLookupTable(context);
  const unionSet = new Set<string>();
  const catalogResearches = context.catalog?.researches;

  const addResolvedKey = (raw: unknown) => {
    if (typeof raw !== 'string') return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    unionSet.add(trimmed);
    const norm = normalizeProtocolLookupKey(trimmed);
    if (norm) unionSet.add(norm);
    const mappedId = lookup.nameToId.get(trimmed) ?? lookup.catalogLookup.resolveProtocolIdByName(trimmed);
    const mappedName = lookup.idToName.get(trimmed) ?? lookup.catalogLookup.resolveProtocolNameById(trimmed);
    const matchedEntry = lookupProtocolCatalogEntry(lookup.catalogLookup, trimmed);
    if (matchedEntry?.id) unionSet.add(matchedEntry.id);
    if (matchedEntry?.name) unionSet.add(matchedEntry.name);
    if (mappedId) {
      unionSet.add(mappedId);
      const canonicalName = lookup.idToName.get(mappedId) ?? lookup.catalogLookup.resolveProtocolNameById(mappedId);
      if (canonicalName) unionSet.add(canonicalName);
    }
    if (mappedName) {
      unionSet.add(mappedName);
      const canonicalId = lookup.nameToId.get(mappedName) ?? lookup.catalogLookup.resolveProtocolIdByName(mappedName);
      if (canonicalId) unionSet.add(canonicalId);
    }
  };

  if (context.techDone) {
    for (const item of context.techDone) {
      addResolvedKey(item);
    }
  }
  if (Array.isArray(context.state?.tech?.done)) {
    for (const item of context.state.tech.done) {
      addResolvedKey(item);
    }
  }

  const consumeProtocolEntry = (entry: unknown) => {
    if (typeof entry === 'string') {
      addResolvedKey(entry);
    } else if (isRecord(entry)) {
      if ('status' in entry && entry.status !== undefined && entry.status !== 'active') {
        return;
      }
      addResolvedKey(entry.ref);
      addResolvedKey(entry.id);
      addResolvedKey(entry.name);
    }
  };

  if (isIterableNonString(context.activeProtocols)) {
    for (const entry of context.activeProtocols) {
      consumeProtocolEntry(entry);
    }
  }
  if (Array.isArray(context.state?.protocols)) {
    for (const entry of context.state.protocols) {
      if (entry && entry.status === 'active') {
        consumeProtocolEntry(entry);
      }
    }
  }

  expandTechEquivalentSet(unionSet, catalogResearches);
  for (const key of [...unionSet]) {
    const norm = normalizeProtocolLookupKey(key);
    if (norm) unionSet.add(norm);
  }

  return unionSet;
}

function resolveResearchConditionTarget(
  condition: Extract<PrerequisiteAtom, { kind: 'research' }>,
  lookup: ProtocolLookupTable,
  catalogResearches?: readonly PrerequisiteResearchCatalogEntryLike[],
): {
  rawTarget: string;
  candidateKeys: string[];
  isProtocol: boolean;
  protocolDisplayName: string;
} {
  const rawName = typeof condition.name === 'string' && condition.name.trim() ? condition.name.trim() : '';
  const rawId = typeof condition.id === 'string' && condition.id.trim() ? condition.id.trim() : '';
  const rawTarget = rawName || rawId;

  const candidateSet = new Set<string>();
  if (rawName) candidateSet.add(rawName);
  if (rawId) candidateSet.add(rawId);

  for (const key of [rawName, rawId]) {
    if (!key) continue;
    for (const eq of getTechEquivalentsForKey(key, catalogResearches)) {
      candidateSet.add(eq);
    }
    const norm = normalizeProtocolLookupKey(key);
    if (norm) candidateSet.add(norm);
    const mappedId = lookup.nameToId.get(key) ?? lookup.catalogLookup.resolveProtocolIdByName(key);
    const mappedName = lookup.idToName.get(key) ?? lookup.catalogLookup.resolveProtocolNameById(key);
    if (mappedId) {
      candidateSet.add(mappedId);
      const canonicalName = lookup.idToName.get(mappedId) ?? lookup.catalogLookup.resolveProtocolNameById(mappedId);
      if (canonicalName) candidateSet.add(canonicalName);
    }
    if (mappedName) {
      candidateSet.add(mappedName);
      const canonicalId = lookup.nameToId.get(mappedName) ?? lookup.catalogLookup.resolveProtocolIdByName(mappedName);
      if (canonicalId) candidateSet.add(canonicalId);
    }
  }

  const isKnownProtocol = [...candidateSet].some(
    k =>
      lookup.knownProtocolKeys.has(k) ||
      lookup.knownProtocolKeys.has(normalizeProtocolLookupKey(k)) ||
      /\.protocol\.|_protocol$/i.test(k),
  );
  const resolvedProtocolName =
    (rawId && (lookup.idToName.get(rawId) ?? lookup.catalogLookup.resolveProtocolNameById(rawId))) ||
    (rawName && (lookup.idToName.get(rawName) ?? lookup.catalogLookup.resolveProtocolNameById(rawName))) ||
    (rawName && lookup.nameToId.has(rawName) ? (lookup.idToName.get(lookup.nameToId.get(rawName)!) ?? rawName) : '') ||
    rawTarget;

  return {
    rawTarget,
    candidateKeys: [...candidateSet],
    isProtocol: isKnownProtocol,
    protocolDisplayName: resolvedProtocolName || rawTarget,
  };
}

function evaluateValidCondition(
  condition: PrerequisiteCondition,
  context: PrerequisiteContext,
  path: string,
  effectiveDoneSet: ReadonlySet<string>,
  protocolLookup: ProtocolLookupTable,
): { satisfied: boolean; unmet: UnmetPrerequisite[] } {
  if ('op' in condition) {
    if (condition.op === 'all') {
      const results = condition.conditions.map((child, index) =>
        evaluateValidCondition(child, context, `${path}.conditions[${index}]`, effectiveDoneSet, protocolLookup),
      );
      return {
        satisfied: results.every(result => result.satisfied),
        unmet: results.flatMap(result => result.unmet),
      };
    }
    const results = condition.conditions.map((child, index) =>
      evaluateValidCondition(child, context, `${path}.conditions[${index}]`, effectiveDoneSet, protocolLookup),
    );
    if (results.some(result => result.satisfied)) return { satisfied: true, unmet: [] };
    return {
      satisfied: false,
      unmet: [{ path, message: '任选条件均未满足' }, ...results.flatMap(result => result.unmet)],
    };
  }
  if (condition.kind === 'research') {
    const { rawTarget, candidateKeys, isProtocol, protocolDisplayName } = resolveResearchConditionTarget(
      condition,
      protocolLookup,
      context.catalog?.researches,
    );
    const satisfied = candidateKeys.some(key => effectiveDoneSet.has(key));
    if (satisfied) {
      return { satisfied: true, unmet: [] };
    }
    if (isProtocol) {
      const label =
        protocolDisplayName && protocolDisplayName !== rawTarget
          ? `${protocolDisplayName}（${rawTarget}）`
          : protocolDisplayName || rawTarget;
      return {
        satisfied: false,
        unmet: [{ path, message: `[协议] 缺少协议：${label}` }],
      };
    }
    return { satisfied: false, unmet: [{ path, message: `缺少研究：${rawTarget}` }] };
  }
  if (condition.kind === 'unit_present') {
    const min = condition.min ?? 1;
    const count = resolveUnitPresentCount(context.unitPresent, condition.name);
    const satisfied = count >= min;
    return {
      satisfied,
      unmet: satisfied ? [] : [{ path, message: `缺少单位：${condition.name}（需要 ${min}，当前 ${count}）` }],
    };
  }
  const bases =
    condition.scope === 'global'
      ? [...context.bases.values()]
      : [context.bases.get(context.selectedBaseId)].filter((base): base is PrerequisiteBaseState => base !== undefined);
  let satisfied = bases.some(base => setHasEquivalentBuilding(base[condition.state], condition.name));
  if (!satisfied && context.selectedBaseBuildings) {
    const directSet = toTrimmedStringSet(context.selectedBaseBuildings);
    satisfied = setHasEquivalentBuilding(directSet, condition.name);
  }
  return {
    satisfied,
    unmet: satisfied
      ? []
      : [
          {
            path,
            message: `缺少${condition.scope === 'current' ? '当前基地' : '全局'}建筑：${condition.name}（${condition.state}）`,
          },
        ],
  };
}

const PREREQ_CONTEXT_CACHE = new WeakMap<
  PrerequisiteContext,
  {
    protocolLookup: ProtocolLookupTable;
    effectiveDoneSet: ReadonlySet<string>;
  }
>();

export function evaluatePrerequisite(condition: unknown, context: PrerequisiteContext): PrerequisiteEvaluation {
  const diagnostics = validatePrerequisiteCondition(condition);
  if (diagnostics.length) return { satisfied: false, unmet: [], diagnostics };
  let cached = PREREQ_CONTEXT_CACHE.get(context);
  if (!cached) {
    cached = {
      protocolLookup: buildProtocolLookupTable(context),
      effectiveDoneSet: buildEffectiveTechAndProtocolSet(context),
    };
    PREREQ_CONTEXT_CACHE.set(context, cached);
  }
  const result = evaluateValidCondition(
    condition as PrerequisiteCondition,
    context,
    'requirements',
    cached.effectiveDoneSet,
    cached.protocolLookup,
  );
  return { ...result, diagnostics: [] };
}

export function validateLegacyRequirementFields(fields: unknown, path = 'legacy'): PrerequisiteDiagnostic[] {
  if (!isRecord(fields)) {
    return [{ path, code: 'invalid_legacy', message: '旧前置字段容器必须是对象' }];
  }
  const legacyArrayFields = ['prereqs', 'need_buildings', 'need_units'] as const;
  const diagnostics: PrerequisiteDiagnostic[] = [];
  for (const field of legacyArrayFields) {
    const value = fields[field];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      diagnostics.push({ path: `${path}.${field}`, code: 'invalid_legacy', message: `${field} 必须是字符串数组` });
      continue;
    }
    value.forEach((name, index) => {
      if (typeof name !== 'string' || !name.trim()) {
        diagnostics.push({
          path: `${path}.${field}[${index}]`,
          code: 'invalid_name',
          message: `${field} 条目必须是非空字符串`,
        });
      } else if (name !== name.trim()) {
        diagnostics.push({
          path: `${path}.${field}[${index}]`,
          code: 'invalid_name',
          message: `${field} 条目不能含首尾空白`,
        });
      }
    });
  }
  return diagnostics;
}

export function combineLegacyPrerequisites(
  fields: LegacyRequirementFields,
  buildingState: BuildingRequirementState,
): unknown {
  if (validateLegacyRequirementFields(fields).length) {
    return { invalidLegacyRequirements: true };
  }
  const isPlaceholderToken = (val: string): boolean => {
    const t = val.trim().toLowerCase();
    return !t || t === '无' || t === '——' || t === 'null' || t === 'none' || t === '无（基础科技）';
  };
  const researchNames: string[] = (fields.prereqs ?? []).filter(r => !isPlaceholderToken(r));
  if (
    researchNames.length === 0 &&
    typeof fields.research === 'string' &&
    !isPlaceholderToken(fields.research)
  ) {
    researchNames.push(fields.research.trim());
  }
  const rawNeedBuildings: string[] = [...(fields.need_buildings ?? [])];
  if (
    rawNeedBuildings.length === 0 &&
    typeof (fields as { need_building?: unknown }).need_building === 'string'
  ) {
    const nb = ((fields as { need_building: string }).need_building || '').trim();
    if (!isPlaceholderToken(nb)) {
      rawNeedBuildings.push(nb);
    }
  }
  const expandedNeedBuildings: string[] = [];
  for (const rawBld of rawNeedBuildings) {
    if (isPlaceholderToken(rawBld)) continue;
    if (rawBld.includes('+') || rawBld.includes('＋')) {
      for (const part of rawBld.split(/[+＋]/)) {
        const trimmedPart = part.trim();
        if (!isPlaceholderToken(trimmedPart) && !expandedNeedBuildings.includes(trimmedPart)) {
          expandedNeedBuildings.push(trimmedPart);
        }
      }
    } else if (!expandedNeedBuildings.includes(rawBld.trim())) {
      expandedNeedBuildings.push(rawBld.trim());
    }
  }
  const conditions: PrerequisiteCondition[] = [
    ...researchNames.map(name => ({ kind: 'research' as const, name })),
    ...expandedNeedBuildings.map(name => ({
      kind: 'building' as const,
      name,
      scope: 'current' as const,
      state: buildingState,
    })),
    ...(fields.need_units ?? []).map(name => ({
      kind: 'unit_present' as const,
      name,
      min: 1,
      scope: 'global' as const,
    })),
  ];
  if (fields.requirements !== undefined) {
    if (
      isRecord(fields.requirements) &&
      !Object.hasOwn(fields.requirements, 'op') &&
      !Object.hasOwn(fields.requirements, 'kind') &&
      (typeof fields.requirements.research === 'string' || typeof fields.requirements.building === 'string')
    ) {
      if (typeof fields.requirements.research === 'string' && fields.requirements.research.trim()) {
        conditions.push({ kind: 'research', name: fields.requirements.research.trim() });
      }
      if (typeof fields.requirements.building === 'string' && fields.requirements.building.trim()) {
        conditions.push({
          kind: 'building',
          name: fields.requirements.building.trim(),
          scope: 'current',
          state: buildingState,
        });
      }
    } else {
      conditions.push(fields.requirements as PrerequisiteCondition);
    }
  }
  return { op: 'all', conditions };
}

export {
  isIterableNonString,
  isRecord,
  TECH_EQUIVALENT_GROUPS,
  SOVIET_T2_LAB_NAMES,
  SOVIET_T3_SCIENCE_CITY_NAMES,
  SOVIET_T3_TICKET_TECHS,
  SOVIET_T3_MANUFACTURING_LOOPS,
  SOVIET_T3_HEAVY_WEAPONS,
  BUILDING_EQUIVALENTS,
  UPGRADE_DESCENDANTS_MAP,
  ROOT_CONYARD_BUILDINGS,
  INACTIVE_SOVIET_BUILDING_STATES,
  toTrimmedStringSet,
  setHasEquivalentBuilding,
  UNIT_EQUIVALENT_GROUPS,
  inferDefaultProductionMotherBuilding,
  evaluateBuildingUnlock,
  evaluateProductionUnlock,
  deriveBuildableWithContext,
  deriveProducibleWithContext,
  evaluateSovietTierGate,
  KIROV_HANGAR_BUILDING_NAMES,
  DREADNOUGHT_DOCK_BUILDING_NAMES,
  evaluateSovietSpecialCapacity,
  type BuildingUnlockTarget,
  type ProductionUnlockTarget,
  type PrerequisiteUnlockContextInput,
  type UnlockEvaluationResult,
  type SovietBuildingInputItem,
  type SovietTierGateInput,
  type SovietTierGateEvaluation,
  type SovietSpecialCapacityEvaluation,
} from './prerequisitesHelpers';
export * from './prerequisitesHelpers';
