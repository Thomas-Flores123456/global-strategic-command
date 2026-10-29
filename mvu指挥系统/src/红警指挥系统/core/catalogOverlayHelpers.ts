import type { ProtocolCatalogItem, ProtocolDef } from './catalog';
import type { ActiveProtocolsInput } from './catalogEffective';
import {
  buildProtocolCatalogLookup,
  buildProtocolIdIndex,
  isProtocolIdIndex,
  lookupProtocolCatalogEntry,
  normalizeProtocolLookupKey,
  resolveProtocolIdByName,
  resolveProtocolNameById,
  type ProtocolCatalogLookup,
  type ProtocolIdIndex,
  type ProtocolIndexInputItem,
  type ProtocolIndexSource,
} from '../engines/protocolCatalogIndex';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ═══════════════ 名↔ID 索引（《通用·科技》V1 换算层入口） ═══════════════ */

/** 研究名↔ID 索引：tech.done 仍按名存储，ID 只在本索引层存在 */
export interface ResearchIdIndex {
  /** 显示名 → 稳定 ID（v1 旧条目 id 即中文名时，映射为自身） */
  nameToId: Record<string, string>;
  /** 别名 → 显示名（先到先得；与 name 相撞的别名不收录，防撞名污染） */
  aliasToName: Record<string, string>;
}

/**
 * 从研究条目列表构建名↔ID 索引（纯函数，鸭式输入：同时兼容 ResearchDef 与 WorldbookResearchData）。
 * - nameToId 先到先得，同名后者不覆盖（合并语义归 mergeByName 管，索引只做查表）；
 * - aliasToName 先到先得；空串/非字符串别名忽略；与任何 name 相同的别名不收录。
 */
export function buildResearchIdIndex(
  researches: readonly { id?: unknown; name?: unknown; aliases?: unknown }[],
): ResearchIdIndex {
  const nameToId: Record<string, string> = {};
  const aliasToName: Record<string, string> = {};
  const allNames = new Set<string>();
  for (const item of researches) {
    if (typeof item.name === 'string' && item.name.trim()) allNames.add(item.name);
  }
  for (const item of researches) {
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (id && !(name in nameToId)) nameToId[name] = id;
    if (Array.isArray(item.aliases)) {
      for (const raw of item.aliases) {
        if (typeof raw !== 'string') continue;
        const alias = raw.trim();
        if (!alias || allNames.has(alias) || alias in aliasToName) continue;
        aliasToName[alias] = name;
      }
    }
  }
  return { nameToId, aliasToName };
}

/* ═══════════════ 协议名↔ID 双向索引（PRT-PARSE-01 · 任务包 §3.1 / §6 PRT-PARSE-01） ═══════════════ */

export type { ProtocolCatalogItem, ProtocolDef };
export {
  buildProtocolCatalogLookup,
  buildProtocolIdIndex,
  isProtocolIdIndex,
  lookupProtocolCatalogEntry,
  normalizeProtocolLookupKey,
  resolveProtocolIdByName,
  resolveProtocolNameById,
  type ProtocolCatalogLookup,
  type ProtocolIdIndex,
  type ProtocolIndexInputItem,
  type ProtocolIndexSource,
};

/* ═══════════════ reveals 单向隐藏表与科技可见性过滤（PRT-VIS-01 · 任务包 §3.3 / D-P6 / D-P7） ═══════════════ */

export type ProtocolRevealSourceItem = {
  id?: string;
  name?: string;
  reveals?: readonly string[];
  aliases?: readonly string[];
  [key: string]: unknown;
};

export type ProtocolRevealSource =
  | readonly ProtocolRevealSourceItem[]
  | Record<string, ProtocolRevealSourceItem>
  | { protocols?: readonly ProtocolRevealSourceItem[] | Record<string, ProtocolRevealSourceItem> | null }
  | null
  | undefined;

function extractProtocolRevealItems(source: ProtocolRevealSource): ProtocolRevealSourceItem[] {
  if (!source) return [];
  if (Array.isArray(source)) return source;
  if (isPlainRecord(source)) {
    if ('protocols' in source) {
      const inner = source.protocols;
      if (Array.isArray(inner)) return inner;
      if (isPlainRecord(inner)) return Object.values(inner) as ProtocolRevealSourceItem[];
      return [];
    }
    return Object.values(source) as ProtocolRevealSourceItem[];
  }
  return [];
}

function isIterableValue(val: unknown): val is Iterable<unknown> {
  return (
    val !== null &&
    val !== undefined &&
    typeof val !== 'string' &&
    typeof (val as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function'
  );
}

/**
 * 将入参 activeProtocols（支持字符串可迭代集合、ProtocolInstance 数组或包装对象）
 * 归一化为同时包含协议权威 ID 与中文名称的激活集合。
 */
export function normalizeActiveProtocolKeys(
  activeProtocolIdsOrNames?: ActiveProtocolsInput,
  protocolIndex?: ProtocolIdIndex,
): Set<string> {
  const activeSet = new Set<string>();
  if (!activeProtocolIdsOrNames) return activeSet;

  const idx = protocolIndex ?? buildProtocolIdIndex();

  let iterable: Iterable<unknown> | null = null;
  if (isIterableValue(activeProtocolIdsOrNames)) {
    iterable = activeProtocolIdsOrNames;
  } else if (isPlainRecord(activeProtocolIdsOrNames)) {
    if (isIterableValue(activeProtocolIdsOrNames.activeProtocols)) {
      iterable = activeProtocolIdsOrNames.activeProtocols;
    } else if (isIterableValue(activeProtocolIdsOrNames.protocols)) {
      iterable = activeProtocolIdsOrNames.protocols;
    }
  }
  if (!iterable) return activeSet;

  const addKey = (raw: unknown) => {
    if (typeof raw !== 'string') return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    activeSet.add(trimmed);
    const resolvedId = idx.resolveProtocolIdByName(trimmed);
    const resolvedName = idx.resolveProtocolNameById(trimmed);
    if (resolvedId) activeSet.add(resolvedId);
    if (resolvedName) activeSet.add(resolvedName);
  };

  for (const entry of iterable) {
    if (typeof entry === 'string') {
      addKey(entry);
    } else if (isPlainRecord(entry)) {
      // 若对象带 status 字段，仅当 status === 'active' 时计为已激活协议
      if ('status' in entry && entry.status !== undefined && entry.status !== 'active') {
        continue;
      }
      addKey(entry.ref);
      addKey(entry.id);
      addKey(entry.name);
    }
  }

  return activeSet;
}

function isProtocolEntryActive(
  protocol: ProtocolRevealSourceItem,
  activeSet: ReadonlySet<string>,
  protocolIndex: ProtocolIdIndex,
): boolean {
  if (activeSet.size === 0) return false;
  const rawId = typeof protocol.id === 'string' ? protocol.id.trim() : '';
  const rawName = typeof protocol.name === 'string' ? protocol.name.trim() : '';
  if (rawId && activeSet.has(rawId)) return true;
  if (rawName && activeSet.has(rawName)) return true;
  if (rawId) {
    const resolvedName = protocolIndex.resolveProtocolNameById(rawId);
    if (resolvedName && activeSet.has(resolvedName)) return true;
  }
  if (rawName) {
    const resolvedId = protocolIndex.resolveProtocolIdByName(rawName);
    if (resolvedId && activeSet.has(resolvedId)) return true;
  }
  if (Array.isArray(protocol.aliases)) {
    for (const alias of protocol.aliases) {
      if (typeof alias === 'string' && activeSet.has(alias.trim())) return true;
    }
  }
  return false;
}

/**
 * 构建被协议 reveals 挂钩的科技映射表：科技 key（id 或 name）→ 揭示该科技的协议 ID/名称集合。
 */
export function buildRevealedByProtocolMap(
  protocols?: ProtocolRevealSource,
  researches?: readonly { id?: unknown; name?: unknown; aliases?: unknown }[] | null,
): Map<string, Set<string>> {
  const revealedByMap = new Map<string, Set<string>>();
  const protocolList = extractProtocolRevealItems(protocols);
  if (protocolList.length === 0) return revealedByMap;

  const idToResearchName = new Map<string, string>();
  const nameToResearchId = new Map<string, string>();
  if (Array.isArray(researches)) {
    for (const r of researches) {
      if (!r || typeof r !== 'object') continue;
      const rId = typeof r.id === 'string' ? r.id.trim() : '';
      const rName = typeof r.name === 'string' ? r.name.trim() : '';
      if (rId && rName) {
        idToResearchName.set(rId, rName);
        nameToResearchId.set(rName, rId);
      }
    }
  }

  for (const p of protocolList) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.reveals) || p.reveals.length === 0) continue;
    const protocolKey =
      (typeof p.id === 'string' && p.id.trim()) || (typeof p.name === 'string' && p.name.trim()) || '';
    if (!protocolKey) continue;

    for (const rawTarget of p.reveals) {
      if (typeof rawTarget !== 'string') continue;
      const target = rawTarget.trim();
      if (!target) continue;

      const keys = new Set<string>([target]);
      const mappedName = idToResearchName.get(target);
      const mappedId = nameToResearchId.get(target);
      if (mappedName) keys.add(mappedName);
      if (mappedId) keys.add(mappedId);

      for (const k of keys) {
        let set = revealedByMap.get(k);
        if (!set) {
          set = new Set<string>();
          revealedByMap.set(k, set);
        }
        set.add(protocolKey);
      }
    }
  }

  return revealedByMap;
}

/**
 * 计算当前应被隐藏的科技标识集合（PRT-VIS-01 · 任务包 §3.3.1 / D-P6 / D-P7）：
 * - 扫描全部协议定义 `p.reveals`（可为科技 id 或科技 name）；
 * - 若某项科技被列入至少一条协议的 `reveals`，且所有揭示它的协议当前均未处于 `active`，
 *   则该科技进入返回的 `hiddenTechIds` 集合；
 * - 一旦任一关联协议处于 `active`，该科技立即从隐藏集合中移除（解除隐藏）；
 * - 若无任何协议配置非空 `reveals`，返回空集合 `Set {}`。
 */
export function computeHiddenTechIds(
  protocols?: ProtocolRevealSource,
  activeProtocolIdsOrNames?: ActiveProtocolsInput,
  researches?: readonly { id?: unknown; name?: unknown; aliases?: unknown }[] | null,
): Set<string> {
  const hidden = new Set<string>();
  const protocolList = extractProtocolRevealItems(protocols);
  if (protocolList.length === 0) return hidden;

  const hasAnyReveals = protocolList.some(p => p && Array.isArray(p.reveals) && p.reveals.length > 0);
  if (!hasAnyReveals) return hidden;

  const protocolIndex = buildProtocolIdIndex(protocolList as ProtocolIndexSource);
  const activeSet = normalizeActiveProtocolKeys(activeProtocolIdsOrNames, protocolIndex);

  const idToResearchName = new Map<string, string>();
  const nameToResearchId = new Map<string, string>();
  if (Array.isArray(researches)) {
    for (const r of researches) {
      if (!r || typeof r !== 'object') continue;
      const rId = typeof r.id === 'string' ? r.id.trim() : '';
      const rName = typeof r.name === 'string' ? r.name.trim() : '';
      if (rId && rName) {
        idToResearchName.set(rId, rName);
        nameToResearchId.set(rName, rId);
      }
    }
  }

  // key -> 是否已被至少一条 active 协议揭示
  const revealUnlockedMap = new Map<string, boolean>();

  for (const p of protocolList) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.reveals) || p.reveals.length === 0) continue;
    const isActive = isProtocolEntryActive(p, activeSet, protocolIndex);

    for (const rawTarget of p.reveals) {
      if (typeof rawTarget !== 'string') continue;
      const target = rawTarget.trim();
      if (!target) continue;

      const keys = new Set<string>([target]);
      const mappedName = idToResearchName.get(target);
      const mappedId = nameToResearchId.get(target);
      if (mappedName) keys.add(mappedName);
      if (mappedId) keys.add(mappedId);

      for (const k of keys) {
        const prevUnlocked = revealUnlockedMap.get(k) ?? false;
        revealUnlockedMap.set(k, prevUnlocked || isActive);
      }
    }
  }

  for (const [k, unlocked] of revealUnlockedMap.entries()) {
    if (!unlocked) {
      hidden.add(k);
    }
  }

  return hidden;
}

/**
 * 按协议 `reveals` 单向隐藏表过滤可见科技列表（PRT-VIS-01 · 任务包 §3.3.1 / D-P6 / D-P7）：
 * - 黄金对照铁律：当无任何协议配置非空 `reveals` 时，直接原样返回 `researches`，100% 零改动；
 * - 当存在协议配置 `reveals` 时，仅过滤掉所有关联协议均未 `active` 的被隐藏科技。
 */
export function filterVisibleResearches<T extends { id?: unknown; name: string; aliases?: unknown }>(
  researches: readonly T[],
  protocols?: ProtocolRevealSource,
  activeProtocolIdsOrNames?: ActiveProtocolsInput,
): T[] {
  const hiddenIds = computeHiddenTechIds(protocols, activeProtocolIdsOrNames, researches);
  if (hiddenIds.size === 0) {
    return researches as T[];
  }
  return researches.filter(r => {
    const rId = typeof r.id === 'string' ? r.id.trim() : '';
    const rName = typeof r.name === 'string' ? r.name.trim() : '';
    if (rId && hiddenIds.has(rId)) return false;
    if (rName && hiddenIds.has(rName)) return false;
    return true;
  });
}
