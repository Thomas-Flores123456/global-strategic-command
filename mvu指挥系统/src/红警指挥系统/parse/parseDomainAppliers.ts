/**
 * parse/parseDomainAppliers.ts —— 战况子域合并引擎（部队/钱包/资源/情报/图鉴/机娘档案/扩展档案）与实体字段映射
 *
 * 约束：零 IO / 零酒馆 API / 零 Vue 依赖。
 */
import {
  BaseSector,
  Building,
  type ChainFlow,
  type ChainStatus,
  CodexEntry,
  CommandHQ,
  EconomyChannelDaily,
  ExpansionDossier,
  Girl,
  GirlDossier,
  IncomeChain,
  IntelItem,
  type IntelSrcKind,
  type IntelStatus,
  PendingGirlSchema,
  Quest,
  type QuestChainReward,
  type QuestFactionReward,
  type QuestGirlReward,
  type QuestReward,
  type QuestUnlockUnit,
  type WorldEvoDomain,
  type WorldEvoStage,
} from '../core/schema';
import { calcDailyNet } from '../engines/chainEngine';
import { computeBuildingPassiveDailyCredits } from '../engines/darknetEngine';
import {
  buildEntityCredibilityIndex,
  evaluateEntityCredibility,
  isSystemCatalogEntity,
  type EntityCredibilityIndex,
  type EntityDomain,
} from '../core/entityCredibility';
import { effectiveCatalogSnapshot } from '../composables/useCatalog';
import { getWorldManifest } from '../core/worlds';
import {
  normalizeBaseSiteType,
  normalizeCanonicalWeather,
  parseTimezoneOffset,
} from '../engines/timezoneWeatherEngine';
import { parseRelativeBuildingCoord } from '../engines/buildingCoordEngine';
import { applyFactionUnlockSettlement } from '../engines/settleFloorPhases';
import {
  alignName,
  applyAlign,
  asArray,
  BUILTIN_FACTION_BUILDING_NAMES,
  canon,
  CHAIN_FIELD_ALIASES,
  ENUM_AMMO,
  ENUM_ATTITUDE,
  ENUM_BASE_STATUS,
  ENUM_BUILDING_STATE,
  ENUM_CRED,
  ENUM_EXPANSION_KIND,
  ENUM_GIRL_HP,
  ENUM_KIND,
  ENUM_QUEUE_TYPE,
  ENUM_RISK,
  green,
  INTEL_FIELD_ALIASES,
  isUsable,
  keyIndex,
  quarantineLeftovers,
  resolveEnum,
  RESOURCE_PILLAR_ALIASES as CANON_RESOURCE_PILLAR_ALIASES,
  setEnumField,
  setNumField,
  setStr,
  take,
  takeDelta,
  toNum,
  upsertByName,
  WORLD_EVO_FIELD_ALIASES,
  yellow,
  type AlignIndex,
  type Ctx,
  type ParseEvent,
  type StatData,
} from './parseTypesAndCanon';

export { CHAIN_FIELD_ALIASES, INTEL_FIELD_ALIASES, WORLD_EVO_FIELD_ALIASES };

function getCredIndexDomainCount(index: EntityCredibilityIndex | null | undefined, domain: EntityDomain): number {
  if (!index || domain === 'any') return 0;
  const byDomain = index.byDomain as unknown;
  if (!byDomain) return 0;
  if (byDomain instanceof Map) {
    return (byDomain.get(domain) as unknown[] | undefined)?.length ?? 0;
  }
  const arr = (byDomain as Record<string, readonly unknown[] | undefined>)[domain];
  return Array.isArray(arr) ? arr.length : 0;
}

function getCredIndexTotalCount(index: EntityCredibilityIndex | null | undefined): number {
  if (!index) return 0;
  const idxAny = index as unknown as { records?: readonly unknown[]; entries?: readonly unknown[] };
  if (Array.isArray(idxAny.records)) return idxAny.records.length;
  if (Array.isArray(idxAny.entries)) return idxAny.entries.length;
  return 0;
}

const BUILTIN_BUILDING_NAME_SET = new Set<string>(BUILTIN_FACTION_BUILDING_NAMES);

function resolveSystemCatalogCredibility(ctx: Ctx): {
  index: EntityCredibilityIndex | null;
  hasWorldbookSnapshot: boolean;
  snapBuildingNames: ReadonlySet<string>;
} {
  let snap: ReturnType<typeof effectiveCatalogSnapshot> | null = null;
  try {
    snap = effectiveCatalogSnapshot();
  } catch {
    snap = null;
  }

  const hasWorldbookSnapshot =
    Boolean(snap) &&
    ((snap!.researches?.length ?? 0) > 0 ||
      (snap!.buildings?.length ?? 0) > 0 ||
      (snap!.productions?.length ?? 0) > 0 ||
      (snap!.retrofits?.length ?? 0) > 0 ||
      (snap!.projects?.length ?? 0) > 0 ||
      (snap!.protocols?.length ?? 0) > 0);

  const snapBuildingNames = new Set<string>((snap?.buildings ?? []).map(b => canon(b.name)));

  const alignAny = ctx.align as (AlignIndex & { credibilityIndex?: EntityCredibilityIndex }) | undefined;
  const customAliases: Record<string, string> = {};
  if (alignAny?.aliasToName) {
    for (const [k, v] of alignAny.aliasToName.entries()) {
      customAliases[k] = v;
    }
  }
  if (hasWorldbookSnapshot && snap) {
    return {
      index: buildEntityCredibilityIndex(snap, customAliases),
      hasWorldbookSnapshot: true,
      snapBuildingNames,
    };
  }

  if (alignAny?.credibilityIndex && getCredIndexTotalCount(alignAny.credibilityIndex) > 0) {
    return {
      index: alignAny.credibilityIndex,
      hasWorldbookSnapshot,
      snapBuildingNames,
    };
  }

  if (alignAny?.exact && alignAny.exact.size > 0) {
    const names = [...alignAny.exact].filter(n => !BUILTIN_BUILDING_NAME_SET.has(n));
    if (names.length > 0) {
      return {
        index: buildEntityCredibilityIndex({ names }, customAliases),
        hasWorldbookSnapshot: false,
        snapBuildingNames,
      };
    }
  }

  return { index: null, hasWorldbookSnapshot: false, snapBuildingNames };
}

/* ═══════════════ 战况总驱动 ═══════════════ */

const FACTION_UNIT_PREFIX_RE = /^(?:盟军|苏军|苏联|尤里|厄普西隆|焚风|帝国|昇阳|旭日)[·•・\-—_/\s]*/;

function stripUnitFactionPrefix(name: string): string {
  const stripped = name.replace(FACTION_UNIT_PREFIX_RE, '').trim();
  return stripped.length >= 2 ? stripped : name.trim();
}

function resolveTargetRecordKey(
  target: Record<string, unknown>,
  alignedName: string,
  rawName: string,
): string {
  if (Object.prototype.hasOwnProperty.call(target, alignedName)) return alignedName;
  if (Object.prototype.hasOwnProperty.call(target, rawName)) return rawName;
  const cAligned = canon(alignedName);
  const cRaw = canon(rawName);
  const exactHit = Object.keys(target).find(k => canon(k) === cAligned || canon(k) === cRaw);
  if (exactHit !== undefined) return exactHit;
  const cStrippedAligned = canon(stripUnitFactionPrefix(alignedName));
  const cStrippedRaw = canon(stripUnitFactionPrefix(rawName));
  const prefixHit = Object.keys(target).find(k => {
    const ck = canon(stripUnitFactionPrefix(k));
    return Boolean(ck && (ck === cStrippedAligned || ck === cStrippedRaw));
  });
  if (prefixHit !== undefined) return prefixHit;
  return alignedName || rawName;
}

function parseQtyNumber(val: unknown): number | null {
  const direct = toNum(val);
  if (direct != null) return direct;
  if (typeof val === 'string') {
    const m = val
      .trim()
      .match(/^([+-]?\d+(?:\.\d+)?)\s*(?:名|人|个|位|员|支|队|班|排|连|件|套|具|部|挺|门|枚|发|箱|辆|台|架|艘)$/);
    if (m) {
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function mergeSingleNumEntry(
  target: Record<string, unknown>,
  rawKeyInput: string,
  val: unknown,
  ctx: Ctx,
): boolean {
  const rawKey = rawKeyInput.trim();
  if (!rawKey) return false;
  const deltaMatch = rawKey.match(/^(.+?)(?:(_?delta)|变化|增减|(损耗|战损|减少))$/i);
  if (deltaMatch) {
    const baseRaw = deltaMatch[1].trim();
    const isLossSuffix = Boolean(deltaMatch[3]);
    const d = parseQtyNumber(val);
    if (!baseRaw || d == null) return false;
    const aligned = applyAlign(baseRaw, ctx, `部队.兵力[${baseRaw}]`, 'entity');
    const targetKey = resolveTargetRecordKey(target, aligned, baseRaw);
    const cur =
      typeof target[targetKey] === 'number' && Number.isFinite(target[targetKey] as number)
        ? (target[targetKey] as number)
        : 0;
    const deltaVal = isLossSuffix ? -Math.abs(d) : d;
    target[targetKey] = Math.max(0, cur + deltaVal);
    ctx.appliedCount++;
    return true;
  }
  const n = parseQtyNumber(val);
  if (n == null) return false;
  const aligned = applyAlign(rawKey, ctx, `部队.兵力[${rawKey}]`, 'entity');
  const targetKey = resolveTargetRecordKey(target, aligned, rawKey);
  target[targetKey] = Math.max(0, n);
  ctx.appliedCount++;
  return true;
}

/** record 按键合并（值支持 delta：键名后缀变化），用于兵力 troops；兼容 LLM 输出对象数组 `[{名称, 数量}]` */
export function mergeNumRecord(target: Record<string, unknown>, src: unknown, ctx: Ctx): void {
  if (Array.isArray(src)) {
    for (const elem of src) {
      if (!isUsable(elem) || Array.isArray(elem)) continue;
      const obj = elem as Record<string, unknown>;
      const idx = keyIndex(obj);
      const consumed = new Set<string>();
      const nameT = take(obj, idx, consumed, NAME_ALIASES);
      const qtyT = take(obj, idx, consumed, ['数量', '人数', '兵力', '台数', '件数', 'qty', 'count', 'num']);
      if (nameT && nameT.value != null && qtyT && qtyT.value != null) {
        mergeSingleNumEntry(target, String(nameT.value), qtyT.value, ctx);
        continue;
      }
      const keys = Object.keys(obj);
      if (keys.length === 1) {
        const k = keys[0];
        mergeSingleNumEntry(target, k, obj[k], ctx);
      }
    }
    return;
  }
  if (!isUsable(src)) return;
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    mergeSingleNumEntry(target, k, v, ctx);
  }
}

/** 弹药 ammo record 合并（值为枚举） */
export function mergeAmmoRecord(target: Record<string, unknown>, src: unknown, ctx: Ctx): void {
  if (!isUsable(src) || Array.isArray(src)) return;
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    const r = resolveEnum(v, ENUM_AMMO);
    if (r.value == null) {
      ctx.quarantine.push({
        scope: 'key',
        path: `部队.弹药.${k}`,
        raw: String(v),
        error: `弹药状态 "${v}" 非法`,
        suggestion: `合法值: ${ENUM_AMMO.canonical.join('|')}`,
      });
      continue;
    }
    if (!r.exact) {
      yellow(
        ctx,
        { layer: 'L2', path: `部队.弹药.${k}`, message: `弹药状态归一化 "${v}" → "${r.value}"` },
        { rule: 'R18', target: `部队.弹药.${k}`, message: '弹药枚举已归一化' },
      );
    }
    target[k] = r.value;
    ctx.appliedCount++;
  }
}

function getVehicleTypeStr(entry: unknown): string {
  if (typeof entry === 'string') return entry.trim();
  if (entry && typeof entry === 'object') {
    const obj = entry as { type?: unknown; name?: unknown; model?: unknown };
    return String(obj.type ?? obj.name ?? obj.model ?? '').trim();
  }
  return '';
}

function vehicleHasFixedId(entry: unknown): boolean {
  if (entry && typeof entry === 'object') {
    const id = (entry as { id?: unknown }).id;
    return typeof id === 'string' && id.trim().length > 0;
  }
  if (typeof entry === 'string') {
    return /#\S+|\[id[:：]/i.test(entry);
  }
  return false;
}

function removeVehiclesUpTo(cur: unknown[], matchFn: (entry: unknown) => boolean, maxRemove: number): number {
  if (maxRemove <= 0) return 0;
  let removed = 0;
  for (let i = cur.length - 1; i >= 0 && removed < maxRemove; i--) {
    if (matchFn(cur[i]) && !vehicleHasFixedId(cur[i])) {
      cur.splice(i, 1);
      removed++;
    }
  }
  for (let i = cur.length - 1; i >= 0 && removed < maxRemove; i--) {
    if (matchFn(cur[i])) {
      cur.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

/**
 * 载具 vehicles（批 E3b·F1 账目腐化修复 + BUG-R2-03 增量扣减与存量对齐）双语义：
 * - 映射形（键＝载具名，值＝数量，与兵力/弹药同构的 LLM 自然写法）：
 *   · 键名带 `变化/增减/损耗/战损/减少/delta` 或值 `n < 0`：按增量扣减至多 `k` 台匹配载具（优先移除无固定 id 量产车）；
 *   · 显式写 `型号: 0`：清空全部同名载具；
 *   · 值为正数 `count`（数字或带量词后缀 `"3辆"`，且非增量后缀键）：按目标存量对齐（少则补齐、多则移除多余台数）；
 *   · 值非数值/非有限（含 "1（已展开）" 带注记——对齐 toNum 惯例：纯数字串才解析）→ 键级隔离留痕，不静默。
 * - 数组形：字符串元素 → 全量覆盖（现状语义，花名册整体重写）；非字符串元素 → 元素级隔离，不静默入账。
 * - 其他形（裸字符串/数字/null）→ 键级隔离留痕（旧版会腐化为 ["[object Object]"]，改为不静默）。
 */
export function mergeVehicles(f: Record<string, unknown>, vehT: { key: string; value: unknown }, ctx: Ctx): void {
  const path = `部队.${vehT.key}`;
  if (!Array.isArray(f.vehicles)) f.vehicles = [];
  const cur = f.vehicles as string[];
  if (Array.isArray(vehT.value)) {
    const next: string[] = [];
    for (const el of vehT.value) {
      if (typeof el === 'string') {
        next.push(el);
      } else {
        ctx.quarantine.push({
          scope: 'element',
          tag: '载具',
          path,
          raw: JSON.stringify(el),
          error: '载具数组元素非字符串',
          suggestion: '数组形为全量覆盖，元素应为载具名字符串',
        });
      }
    }
    f.vehicles = next;
    ctx.appliedCount++;
    return;
  }
  if (isUsable(vehT.value)) {
    for (const [k, v] of Object.entries(vehT.value as Record<string, unknown>)) {
      const rawKey = k.trim();
      const deltaKeyMatch = rawKey.match(/^(.+?)(?:(_?delta)|变化|增减|(损耗|战损|减少)|(新增|增加))$/i);
      const baseName = (deltaKeyMatch ? deltaKeyMatch[1] : rawKey).trim();
      const isDeltaKey = Boolean(deltaKeyMatch);
      const isLossKey = Boolean(deltaKeyMatch?.[3]);
      const isAddKey = Boolean(deltaKeyMatch?.[4]);

      const unitMatch =
        typeof v === 'string' ? v.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*(?:辆|台|架|艘|门|部|挺|具)$/) : null;
      const n = unitMatch ? Number(unitMatch[1]) : toNum(v);
      if (!baseName || n == null || !Number.isFinite(n)) {
        ctx.quarantine.push({
          scope: 'key',
          path: `${path}.${k}`,
          raw: `${k}: ${JSON.stringify(v)}`,
          error: !baseName ? '载具名为空' : `载具数量值 "${v}" 非数值（含注记值请先剥离注记）`,
          suggestion: '映射形值应为纯数字：>0 入队 / 0 或负数离队',
        });
        continue;
      }

      const alignedName = applyAlign(baseName, ctx, `${path}.${baseName}`, 'entity');
      const cAligned = canon(alignedName);
      const cRaw = canon(baseName);
      const directMatch = (x: unknown) => {
        const cx = canon(getVehicleTypeStr(x));
        return Boolean(cx && (cx === cAligned || cx === cRaw));
      };
      const strippedAligned = canon(stripUnitFactionPrefix(alignedName));
      const strippedRaw = canon(stripUnitFactionPrefix(baseName));
      const strippedMatch = (x: unknown) => {
        const cx = canon(stripUnitFactionPrefix(getVehicleTypeStr(x)));
        return Boolean(cx && (cx === strippedAligned || cx === strippedRaw));
      };
      const hasDirectHit = cur.some(directMatch);
      const matchFn = hasDirectHit ? directMatch : cur.some(strippedMatch) ? strippedMatch : directMatch;
      const existingMatches = cur.filter(matchFn);
      const existingCount = existingMatches.length;
      const canonicalName =
        (typeof existingMatches[0] === 'string' && existingMatches[0].trim() ? existingMatches[0].trim() : '') ||
        alignedName ||
        baseName;

      if (isLossKey) {
        const kRemove = Math.abs(Math.trunc(n));
        if (kRemove > 0 && existingCount > 0) {
          removeVehiclesUpTo(cur, matchFn, kRemove);
        }
        ctx.appliedCount++;
        continue;
      }

      if (isAddKey) {
        const kAdd = Math.min(50, Math.max(0, Math.trunc(n)));
        for (let i = 0; i < kAdd; i++) cur.push(canonicalName);
        ctx.appliedCount++;
        continue;
      }

      if (isDeltaKey) {
        if (n < 0) {
          const kRemove = Math.abs(Math.trunc(n));
          if (kRemove > 0 && existingCount > 0) {
            removeVehiclesUpTo(cur, matchFn, kRemove);
          }
          ctx.appliedCount++;
        } else if (n > 0) {
          const kAdd = Math.min(50, Math.max(1, Math.trunc(n)));
          for (let i = 0; i < kAdd; i++) cur.push(canonicalName);
          ctx.appliedCount++;
        } else {
          ctx.appliedCount++;
        }
        continue;
      }

      // 非增量后缀键：n < 0 表示增量扣减 -k；n === 0 表示绝对清空；n > 0 表示目标存量对齐
      if (n < 0) {
        const kRemove = Math.abs(Math.trunc(n));
        if (kRemove > 0 && existingCount > 0) {
          removeVehiclesUpTo(cur, matchFn, kRemove);
        }
        ctx.appliedCount++;
      } else if (n === 0) {
        if (existingCount > 0) {
          removeVehiclesUpTo(cur, matchFn, existingCount);
          ctx.appliedCount++;
        }
      } else {
        const count = Number.isInteger(n) && n > 1 && n <= 50 ? n : n > 50 ? 50 : 1;
        if (existingCount < count) {
          const diff = count - existingCount;
          for (let i = 0; i < diff; i++) cur.push(canonicalName);
          ctx.appliedCount++;
        } else if (existingCount > count) {
          const diff = existingCount - count;
          removeVehiclesUpTo(cur, matchFn, diff);
          ctx.appliedCount++;
        }
      }
    }
    return;
  }
  ctx.quarantine.push({
    scope: 'key',
    path,
    raw: JSON.stringify(vehT.value),
    error: '载具值应为映射（车名: 数量）或字符串数组',
    suggestion: '增量写法「载具: {车名: 1}」或花名册重写「载具: [车名A, 车名B]」',
  });
}

function unitCanonKey(rawName: string): string {
  return canon(stripUnitFactionPrefix(rawName)) || canon(rawName);
}

function snapshotNumRecordByCanon(rec: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!isUsable(rec) || Array.isArray(rec)) return map;
  for (const [k, v] of Object.entries(rec as Record<string, unknown>)) {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    const ck = unitCanonKey(k);
    if (!ck) continue;
    map.set(ck, (map.get(ck) ?? 0) + Math.max(0, n));
  }
  return map;
}

function extractTouchedRecordCanons(src: unknown, ctx: Ctx): Set<string> {
  const out = new Set<string>();
  const addKey = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const deltaMatch = trimmed.match(/^(.+?)(?:(_?delta)|变化|增减|(损耗|战损|减少))$/i);
    const base = (deltaMatch ? deltaMatch[1] : trimmed).trim();
    if (!base) return;
    const aligned = ctx.align ? alignName(base, ctx.align).name : base;
    out.add(unitCanonKey(aligned));
    out.add(unitCanonKey(base));
  };
  if (Array.isArray(src)) {
    for (const elem of src) {
      if (!isUsable(elem) || Array.isArray(elem)) continue;
      const obj = elem as Record<string, unknown>;
      const idx = keyIndex(obj);
      const consumed = new Set<string>();
      const nameT = take(obj, idx, consumed, NAME_ALIASES);
      if (nameT && nameT.value != null) {
        addKey(String(nameT.value));
        continue;
      }
      const keys = Object.keys(obj);
      if (keys.length === 1) addKey(keys[0]);
    }
    return out;
  }
  if (isUsable(src)) {
    for (const k of Object.keys(src as Record<string, unknown>)) {
      addKey(k);
    }
  }
  return out;
}

function syncBasesNumRecordAfterGlobalForces(
  data: StatData,
  globalRec: Record<string, unknown>,
  prevCounts: Map<string, number>,
  touchedCanons: Set<string>,
  field: 'troops' | 'equipment',
): void {
  if (!Array.isArray(data.bases) || data.bases.length === 0) return;
  const afterCounts = snapshotNumRecordByCanon(globalRec);
  const candidateCanons = new Set<string>([...prevCounts.keys(), ...touchedCanons]);

  for (const ck of candidateCanons) {
    if (!ck) continue;
    const prevGlobal = prevCounts.get(ck) ?? 0;
    const afterGlobal = afterCounts.get(ck) ?? 0;
    if (afterGlobal >= prevGlobal && !touchedCanons.has(ck)) continue;

    let baseSum = 0;
    for (const b of data.bases) {
      const bfRec = b?.forces?.[field] as Record<string, unknown> | undefined;
      if (!isUsable(bfRec) || Array.isArray(bfRec)) continue;
      for (const [k, v] of Object.entries(bfRec)) {
        if (unitCanonKey(k) === ck && typeof v === 'number' && Number.isFinite(v) && v > 0) {
          baseSum += v;
        }
      }
    }
    if (baseSum <= 0) continue;

    const delta = Math.max(0, prevGlobal - afterGlobal);
    const toDeduct = Math.min(baseSum, Math.max(delta, baseSum - afterGlobal));
    if (toDeduct <= 0) continue;

    let remaining = toDeduct;
    for (const b of data.bases) {
      if (remaining <= 0) break;
      const bfRec = b?.forces?.[field] as Record<string, number> | undefined;
      if (!isUsable(bfRec) || Array.isArray(bfRec)) continue;
      for (const k of Object.keys(bfRec)) {
        if (remaining <= 0) break;
        if (unitCanonKey(k) !== ck) continue;
        const curVal = typeof bfRec[k] === 'number' && Number.isFinite(bfRec[k]) ? bfRec[k] : 0;
        if (curVal <= 0) continue;
        const deductHere = Math.min(curVal, remaining);
        bfRec[k] = Math.max(0, curVal - deductHere);
        remaining -= deductHere;
      }
    }
  }
}

function snapshotVehicleCountsByCanon(vehicles: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(vehicles)) return map;
  for (const v of vehicles) {
    const ck = unitCanonKey(getVehicleTypeStr(v));
    if (!ck) continue;
    map.set(ck, (map.get(ck) ?? 0) + 1);
  }
  return map;
}

function syncBasesVehiclesAfterGlobalForces(
  data: StatData,
  globalVehicles: unknown,
  prevCounts: Map<string, number>,
  vehInput: unknown,
  ctx: Ctx,
): void {
  if (!Array.isArray(data.bases) || data.bases.length === 0) return;
  const afterCounts = snapshotVehicleCountsByCanon(globalVehicles);
  const touchedCanons = new Set<string>();

  if (Array.isArray(vehInput)) {
    for (const ck of prevCounts.keys()) touchedCanons.add(ck);
    for (const b of data.bases) {
      const bVehs = b?.forces?.vehicles;
      if (!Array.isArray(bVehs)) continue;
      for (const v of bVehs) {
        const ck = unitCanonKey(getVehicleTypeStr(v));
        if (ck) touchedCanons.add(ck);
      }
    }
  } else if (isUsable(vehInput)) {
    for (const k of Object.keys(vehInput as Record<string, unknown>)) {
      const rawKey = k.trim();
      const deltaKeyMatch = rawKey.match(/^(.+?)(?:(_?delta)|变化|增减|(损耗|战损|减少)|(新增|增加))$/i);
      const baseName = (deltaKeyMatch ? deltaKeyMatch[1] : rawKey).trim();
      if (!baseName) continue;
      const aligned = ctx.align ? alignName(baseName, ctx.align).name : baseName;
      touchedCanons.add(unitCanonKey(aligned));
      touchedCanons.add(unitCanonKey(baseName));
    }
  }

  const candidateCanons = new Set<string>([...prevCounts.keys(), ...touchedCanons]);
  for (const ck of candidateCanons) {
    if (!ck) continue;
    const prevGlobal = prevCounts.get(ck) ?? 0;
    const afterGlobal = afterCounts.get(ck) ?? 0;
    if (afterGlobal >= prevGlobal && !touchedCanons.has(ck)) continue;

    let baseSum = 0;
    for (const b of data.bases) {
      const bVehs = b?.forces?.vehicles;
      if (!Array.isArray(bVehs)) continue;
      for (const v of bVehs) {
        if (unitCanonKey(getVehicleTypeStr(v)) === ck) baseSum++;
      }
    }
    if (baseSum <= 0) continue;

    const delta = Math.max(0, prevGlobal - afterGlobal);
    const toDeduct = Math.min(baseSum, Math.max(delta, baseSum - afterGlobal));
    if (toDeduct <= 0) continue;

    let remaining = toDeduct;
    for (const b of data.bases) {
      if (remaining <= 0) break;
      const bVehs = b?.forces?.vehicles;
      if (!Array.isArray(bVehs) || bVehs.length === 0) continue;
      const removed = removeVehiclesUpTo(
        bVehs,
        entry => unitCanonKey(getVehicleTypeStr(entry)) === ck,
        remaining,
      );
      remaining -= removed;
    }
  }
}

export function syncGlobalForceReductionsToBases(
  data: StatData,
  prevTroops: Map<string, number>,
  prevVehicles: Map<string, number>,
  prevEquip: Map<string, number>,
  touchedTroops: Set<string>,
  touchedEquip: Set<string>,
  vehInput: unknown,
  ctx: Ctx,
): void {
  const f = data.forces as unknown as Record<string, unknown>;
  if (!isUsable(f)) return;
  if (touchedTroops.size > 0 || prevTroops.size > 0) {
    syncBasesNumRecordAfterGlobalForces(
      data,
      (f.troops ?? {}) as Record<string, unknown>,
      prevTroops,
      touchedTroops,
      'troops',
    );
  }
  if (vehInput !== undefined || prevVehicles.size > 0) {
    syncBasesVehiclesAfterGlobalForces(data, f.vehicles, prevVehicles, vehInput ?? {}, ctx);
  }
  if (touchedEquip.size > 0 || prevEquip.size > 0) {
    syncBasesNumRecordAfterGlobalForces(
      data,
      (f.equipment ?? {}) as Record<string, unknown>,
      prevEquip,
      touchedEquip,
      'equipment',
    );
  }
}

function extractParenQty(raw: string): { name: string; qty?: number } {
  const trimmed = raw.trim();
  if (!trimmed) return { name: '' };
  const m = trimmed.match(/^(.+?)\s*(?:[（(]\s*([+-]?\d+)\s*(?:名|人|辆|台|架|艘|门|部|挺|具)?\s*[)）]|[xX×*]\s*(\d+))$/);
  if (m) {
    return {
      name: m[1].trim(),
      qty: Number(m[2] ?? m[3]),
    };
  }
  return { name: trimmed };
}

function applyCasualtyNumEntries(
  target: Record<string, unknown>,
  src: unknown,
  ctx: Ctx,
  touchedCanons: Set<string>,
  labelPath: string,
): void {
  const applyOne = (rawKeyInput: string, rawVal: unknown) => {
    const rawKey = rawKeyInput.trim();
    if (!rawKey) return;
    const deltaMatch = rawKey.match(/^(.+?)(?:(_?delta)|变化|增减|(损耗|战损|减少|伤亡|阵亡|损失))$/i);
    const baseRaw = (deltaMatch ? deltaMatch[1] : rawKey).trim();
    const n = parseQtyNumber(rawVal);
    if (!baseRaw || n == null || !Number.isFinite(n)) {
      ctx.quarantine.push({
        scope: 'key',
        path: `${labelPath}.${rawKeyInput}`,
        raw: `${rawKeyInput}: ${JSON.stringify(rawVal)}`,
        error: !baseRaw ? '战损单位名为空' : `战损数量值 "${rawVal}" 非数值`,
        suggestion: '战损数量应为数字（正数或负数均按战损扣减处理）',
      });
      return;
    }
    const aligned = applyAlign(baseRaw, ctx, `${labelPath}[${baseRaw}]`, 'entity');
    const targetKey = resolveTargetRecordKey(target, aligned, baseRaw);
    touchedCanons.add(unitCanonKey(aligned));
    touchedCanons.add(unitCanonKey(baseRaw));
    touchedCanons.add(unitCanonKey(targetKey));
    const cur =
      typeof target[targetKey] === 'number' && Number.isFinite(target[targetKey] as number)
        ? (target[targetKey] as number)
        : 0;
    const loss = Math.abs(Math.trunc(n));
    if (loss > 0) {
      target[targetKey] = Math.max(0, cur - loss);
    }
    ctx.appliedCount++;
  };

  if (Array.isArray(src)) {
    for (const elem of src) {
      if (typeof elem === 'string') {
        const parsed = extractParenQty(elem);
        if (parsed.name) applyOne(parsed.name, parsed.qty ?? 1);
        continue;
      }
      if (!isUsable(elem) || Array.isArray(elem)) continue;
      const obj = elem as Record<string, unknown>;
      const idx = keyIndex(obj);
      const consumed = new Set<string>();
      const nameT = take(obj, idx, consumed, NAME_ALIASES);
      const qtyT = take(obj, idx, consumed, ['数量', '人数', '兵力', '战损', '伤亡', '损失', '台数', '件数', 'qty', 'count', 'num']);
      if (nameT && nameT.value != null && qtyT && qtyT.value != null) {
        applyOne(String(nameT.value), qtyT.value);
        continue;
      }
      const keys = Object.keys(obj);
      if (keys.length === 1) {
        applyOne(keys[0], obj[keys[0]]);
      }
    }
    return;
  }
  if (!isUsable(src)) return;
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    applyOne(k, v);
  }
}

function applyCasualtyVehicleEntries(
  f: Record<string, unknown>,
  src: unknown,
  ctx: Ctx,
  touchedVehMap: Record<string, number>,
  labelPath: string,
): void {
  if (!Array.isArray(f.vehicles)) f.vehicles = [];
  const cur = f.vehicles as string[];

  const applyOneVehicleLoss = (rawKeyInput: string, rawVal: unknown) => {
    const rawKey = rawKeyInput.trim();
    if (!rawKey) return;
    const deltaKeyMatch = rawKey.match(/^(.+?)(?:(_?delta)|变化|增减|(损耗|战损|减少|伤亡|损失|击毁|损毁))$/i);
    const baseName = (deltaKeyMatch ? deltaKeyMatch[1] : rawKey).trim();
    const n = parseQtyNumber(rawVal);
    if (!baseName || n == null || !Number.isFinite(n)) {
      ctx.quarantine.push({
        scope: 'key',
        path: `${labelPath}.${rawKeyInput}`,
        raw: `${rawKeyInput}: ${JSON.stringify(rawVal)}`,
        error: !baseName ? '载具名为空' : `载具战损数量值 "${rawVal}" 非数值`,
        suggestion: '战损载具映射值应为数字（正数或负数均按扣减台数处理）',
      });
      return;
    }
    const alignedName = applyAlign(baseName, ctx, `${labelPath}.${baseName}`, 'entity');
    touchedVehMap[alignedName] = -Math.abs(Math.trunc(n));
    const cAligned = canon(alignedName);
    const cRaw = canon(baseName);
    const directMatch = (x: unknown) => {
      const cx = canon(getVehicleTypeStr(x));
      return Boolean(cx && (cx === cAligned || cx === cRaw));
    };
    const strippedAligned = canon(stripUnitFactionPrefix(alignedName));
    const strippedRaw = canon(stripUnitFactionPrefix(baseName));
    const strippedMatch = (x: unknown) => {
      const cx = canon(stripUnitFactionPrefix(getVehicleTypeStr(x)));
      return Boolean(cx && (cx === strippedAligned || cx === strippedRaw));
    };
    const hasDirectHit = cur.some(directMatch);
    const matchFn = hasDirectHit ? directMatch : cur.some(strippedMatch) ? strippedMatch : directMatch;
    const kRemove = Math.abs(Math.trunc(n));
    if (kRemove > 0) {
      removeVehiclesUpTo(cur, matchFn, kRemove);
    }
    ctx.appliedCount++;
  };

  if (Array.isArray(src)) {
    for (const el of src) {
      if (typeof el === 'string') {
        const parsed = extractParenQty(el);
        if (parsed.name) {
          applyOneVehicleLoss(parsed.name, parsed.qty ?? 1);
        }
      } else if (isUsable(el) && !Array.isArray(el)) {
        for (const [k, v] of Object.entries(el as Record<string, unknown>)) {
          applyOneVehicleLoss(k, v);
        }
      }
    }
    return;
  }
  if (isUsable(src)) {
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      applyOneVehicleLoss(k, v);
    }
    return;
  }
  ctx.quarantine.push({
    scope: 'key',
    path: labelPath,
    raw: JSON.stringify(src),
    error: '载具战损值应为映射（车名: 数量）或数组',
    suggestion: '示例：载具: { M1A1灰熊主战坦克: -1 }',
  });
}

/**
 * BUG-R2-03b：消费 <态势> 内的「战损/伤亡/损失」子块或顶层独立 <战损> 块。
 * 无论 AI 将步兵或载具损失写成正数（如 2 / "1辆"）还是负数（如 -3 / -1），
 * 一律作为战损扣减量 -Math.abs(n) 从 data.forces.troops / data.forces.vehicles / data.forces.equipment 中扣减，
 * 并同步调用 syncGlobalForceReductionsToBases 核减各基地 base.forces 驻军，防止被 syncGlobalForcesFloorFromBases 复活。
 */
export function applyCasualties(
  casualties: unknown,
  data: StatData,
  ctx: Ctx,
  pathPrefix = '战损',
): void {
  if (!isUsable(casualties) || Array.isArray(casualties)) return;
  syncGlobalForcesFloorFromBases(data);

  const f = data.forces as unknown as Record<string, unknown>;
  f.troops ??= {};
  if (!Array.isArray(f.vehicles)) f.vehicles = [];
  f.equipment ??= {};

  const prevTroops = snapshotNumRecordByCanon(f.troops);
  const prevVehicles = snapshotVehicleCountsByCanon(f.vehicles);
  const prevEquip = snapshotNumRecordByCanon(f.equipment);
  const touchedTroops = new Set<string>();
  const touchedEquip = new Set<string>();
  const touchedVehMap: Record<string, number> = {};

  const cObj = casualties as Record<string, unknown>;
  const idx = keyIndex(cObj);
  const consumed = new Set<string>();

  const innerSelfT = take(cObj, idx, consumed, ['战损', '伤亡', '损失', 'casualties', 'losses']);
  if (innerSelfT && isUsable(innerSelfT.value) && !Array.isArray(innerSelfT.value)) {
    applyCasualties(innerSelfT.value, data, ctx, pathPrefix);
  }

  const troopsT = take(cObj, idx, consumed, ['步兵', '兵力', '人员', '部队', 'troops', 'infantry']);
  const vehT = take(cObj, idx, consumed, ['载具', '车辆', '装甲', '战车', 'vehicles']);
  const equipT = take(cObj, idx, consumed, ['装备', '军备', 'equipment']);
  // 忽略可能附带的建筑/设施/说明字段以防误报隔离
  take(cObj, idx, consumed, ['建筑', '设施', '基地', 'buildings', '备注', '说明', '原因', 'note', 'reason']);

  if (troopsT) {
    applyCasualtyNumEntries(f.troops as Record<string, unknown>, troopsT.value, ctx, touchedTroops, `${pathPrefix}.步兵`);
  }
  if (vehT) {
    applyCasualtyVehicleEntries(f, vehT.value, ctx, touchedVehMap, `${pathPrefix}.载具`);
  }
  if (equipT) {
    applyCasualtyNumEntries(f.equipment as Record<string, unknown>, equipT.value, ctx, touchedEquip, `${pathPrefix}.装备`);
  }

  // 若存在直接平铺在 <战损> 顶层的单位键值对（如 `美国大兵: -3` 或 `M1A1灰熊主战坦克: -1`）
  for (const k of Object.keys(cObj)) {
    if (consumed.has(k)) continue;
    const v = cObj[k];
    const n = parseQtyNumber(v);
    if (n == null) continue;
    consumed.add(k);
    const ck = unitCanonKey(k);
    const curVehs = f.vehicles as unknown[];
    const inVehicles =
      curVehs.some(x => unitCanonKey(getVehicleTypeStr(x)) === ck) ||
      /(?:坦克|战车|装甲车|履带车|防空车|采矿车|基地车|MCV|火炮|火箭炮|发射车|直升机|战机|轰炸机|潜艇|驱逐舰|航母|无畏舰|飞艇)/i.test(k);
    if (inVehicles && !(ck in (f.troops as Record<string, unknown>))) {
      applyCasualtyVehicleEntries(f, { [k]: v }, ctx, touchedVehMap, pathPrefix);
    } else {
      applyCasualtyNumEntries(f.troops as Record<string, unknown>, { [k]: v }, ctx, touchedTroops, pathPrefix);
    }
  }

  syncGlobalForceReductionsToBases(
    data,
    prevTroops,
    prevVehicles,
    prevEquip,
    touchedTroops,
    touchedEquip,
    Object.keys(touchedVehMap).length > 0 ? touchedVehMap : undefined,
    ctx,
  );

  quarantineLeftovers(cObj, consumed, ctx, pathPrefix);
}

/** 部队域：机娘/兵力/弹药/载具/指挥上限/战损 */
export function applyForces(forces: Record<string, unknown>, data: StatData, ctx: Ctx): void {
  const idx = keyIndex(forces);
  const consumed = new Set<string>();
  const f = data.forces as unknown as Record<string, unknown>;
  const girlsT = take(forces, idx, consumed, ['机娘', '伴生机娘', '战术机娘', 'girls', 'mecha_girls']);
  if (girlsT) {
    upsertGirls(f.girls as Record<string, unknown>[], girlsT.value, ctx, '部队.机娘');
  }
  const troopsT = take(forces, idx, consumed, ['兵力', '人员', '步兵', 'troops']);
  const ammoT = take(forces, idx, consumed, ['弹药', 'ammo']);
  const vehT = take(forces, idx, consumed, ['载具', 'vehicles']);
  const equipT = take(forces, idx, consumed, ['装备', '军备', 'equipment']);
  const casualtiesT = take(forces, idx, consumed, ['战损', '伤亡', '损失', 'casualties', 'losses']);

  if (troopsT || vehT || equipT) {
    syncGlobalForcesFloorFromBases(data);
  }

  if (troopsT) {
    const prevTroops = snapshotNumRecordByCanon(f.troops);
    const touchedTroops = extractTouchedRecordCanons(troopsT.value, ctx);
    mergeNumRecord(f.troops as Record<string, unknown>, troopsT.value, ctx);
    syncBasesNumRecordAfterGlobalForces(
      data,
      f.troops as Record<string, unknown>,
      prevTroops,
      touchedTroops,
      'troops',
    );
  }
  if (ammoT) mergeAmmoRecord(f.ammo as Record<string, unknown>, ammoT.value, ctx);
  if (vehT) {
    const prevVehicles = snapshotVehicleCountsByCanon(f.vehicles);
    mergeVehicles(f, vehT, ctx);
    syncBasesVehiclesAfterGlobalForces(data, f.vehicles, prevVehicles, vehT.value, ctx);
  }
  if (equipT) {
    f.equipment ??= {};
    const prevEquip = snapshotNumRecordByCanon(f.equipment);
    const touchedEquip = extractTouchedRecordCanons(equipT.value, ctx);
    mergeNumRecord(f.equipment as Record<string, unknown>, equipT.value, ctx);
    syncBasesNumRecordAfterGlobalForces(
      data,
      f.equipment as Record<string, unknown>,
      prevEquip,
      touchedEquip,
      'equipment',
    );
  }
  if (casualtiesT) {
    applyCasualties(casualtiesT.value, data, ctx, '部队.战损');
  }
  setStr(f, 'command_cap', forces, idx, consumed, ['指挥上限', 'command_cap'], ctx);

  // BUG-R2-03b：当 <态势> 顶层直接写 `兵力: { 美国大兵: 4, 工程兵: 2 }`（映射为 部队 域后内部直接是兵种键值对）时，
  // 识别剩余数值型键并作为 troops 字典消费合并，同时同步核减各基地 base.forces.troops
  const unconsumedKeys = Object.keys(forces).filter(k => !consumed.has(k));
  if (unconsumedKeys.length > 0 && unconsumedKeys.every(k => parseQtyNumber(forces[k]) != null)) {
    syncGlobalForcesFloorFromBases(data);
    const directTroopPatch: Record<string, unknown> = {};
    for (const k of unconsumedKeys) {
      directTroopPatch[k] = forces[k];
      consumed.add(k);
    }
    const prevTroops = snapshotNumRecordByCanon(f.troops);
    const touchedTroops = extractTouchedRecordCanons(directTroopPatch, ctx);
    mergeNumRecord(f.troops as Record<string, unknown>, directTroopPatch, ctx);
    syncBasesNumRecordAfterGlobalForces(
      data,
      f.troops as Record<string, unknown>,
      prevTroops,
      touchedTroops,
      'troops',
    );
  }

  quarantineLeftovers(forces, consumed, ctx, '部队');
}

/** 钱袋：按当前 world_id 的 manifest 白名单合并；旧修真键保留一版双读。 */
export function applyWallet(wallet: Record<string, unknown>, data: StatData, ctx: Ctx): void {
  const idx = keyIndex(wallet);
  const consumed = new Set<string>();
  const target = (data.economy as unknown as Record<string, unknown>).wallet as Record<string, unknown>;
  const worldId = data.meta.world_id;
  const currencies = getWorldManifest(worldId)?.currencies ?? [];

  // v1 战报兼容：灵石: {下品,中品,上品}；随后处理顶层 v2 键，若同现则 v2 明确值胜出。
  const stonesT = take(wallet, idx, consumed, ['灵石', 'spirit_stone']);
  if (stonesT && isUsable(stonesT.value) && !Array.isArray(stonesT.value)) {
    const stones = stonesT.value as Record<string, unknown>;
    const stoneIdx = keyIndex(stones);
    const stoneConsumed = new Set<string>();
    const stoneAliases: Array<[string, string[]]> = [
      ['下品灵石', ['下品', 'low']],
      ['中品灵石', ['中品', 'mid']],
      ['上品灵石', ['上品', 'high']],
    ];
    for (const [currency, aliases] of stoneAliases) {
      if (currencies.includes(currency))
        setNumField(target, currency, stones, stoneIdx, stoneConsumed, aliases, ctx, '钱袋');
    }
    quarantineLeftovers(stones, stoneConsumed, ctx, '钱袋.灵石');
  }

  const legacyAliases: Record<string, string[]> = {
    铜钱: ['铜币', '铜', 'copper'],
    银两: ['银', 'silver'],
    下品灵石: ['下品', 'low'],
    中品灵石: ['中品', 'mid'],
    上品灵石: ['上品', 'high'],
  };
  for (const currency of currencies) {
    setNumField(target, currency, wallet, idx, consumed, [currency, ...(legacyAliases[currency] ?? [])], ctx, '钱袋');
  }
  quarantineLeftovers(wallet, consumed, ctx, '钱袋');
}

import { RESOURCE_PILLAR_ALIASES, applyResources, mergeResourceRecord } from './resourceMerge';
for (const [pillar, aliases] of Object.entries(CANON_RESOURCE_PILLAR_ALIASES)) {
  const targetArr = (RESOURCE_PILLAR_ALIASES[pillar] ??= []);
  for (const alias of aliases) {
    if (!targetArr.includes(alias)) {
      targetArr.push(alias);
    }
  }
}
export { RESOURCE_PILLAR_ALIASES, applyResources, mergeResourceRecord };

export function normalizeIntelSrcKind(raw: unknown, fallbackSrc?: string): IntelSrcKind {
  const s = `${String(raw ?? '')} ${fallbackSrc ?? ''}`.trim();
  if (/雷达|卫星|天基|预警机|航拍|遥感|侦察机|radar|satellite/i.test(s)) return '雷达侦察';
  if (/渗透|内线|间谍|密报|线人|潜伏|特工|内应|spy|agent/i.test(s)) return '渗透内线';
  if (/暗网|黑市|流言|传闻|商团|灰区|悬赏板|darknet|rumor/i.test(s)) return '暗网流言';
  if (/电讯|截获|破译|监听|密码|电报|心灵|频段|signal|intercept/i.test(s)) return '电讯截获';
  if (/宏观|广播|公报|国际|全球|位面|世界|远方|新闻|world|broadcast/i.test(s)) return '宏观广播';
  return '前线目视';
}

export function normalizeIntelStatus(
  raw: unknown,
  cred?: string,
  hasEvolvesFrom?: boolean,
  chainStep?: string,
): IntelStatus {
  const s = String(raw ?? '').trim();
  if (/证伪|虚假|假情报|烟雾弹|排除|false|debunk/i.test(s)) return '已证伪';
  if (/证实|确凿|实锤|确认|核实无误|verified|confirmed/i.test(s)) return '已证实';
  if (/演进|发酵|升级|追踪|持续|evolving/i.test(s)) return '演进中';
  if (/待核|未证实|存疑|待查|pending/i.test(s)) return '待核实';
  if (cred === '高') return '已证实';
  const isAdvancedStep =
    typeof chainStep === 'string' && /(?:^|第)\s*([2-9]|\d{2,})\s*[/／阶环幕]/.test(chainStep.trim());
  if (hasEvolvesFrom || isAdvancedStep) return '演进中';
  return '待核实';
}

export const INTEL_CHAIN_ALIASES = [
  '情报链',
  '侦察链',
  '溯源链',
  '线索链',
  '案卷',
  '系列',
  '所属情报链',
  'chain',
  'intel_chain',
  'series',
] as const;

export const INTEL_CHAIN_STEP_ALIASES = [
  '阶数',
  '侦察阶数',
  '溯源进度',
  '调查阶段',
  '环数',
  '阶段环',
  '阶',
  'chain_step',
  'intel_step',
  'step',
] as const;

export const INTEL_NEXT_LEAD_ALIASES = [
  '下一阶线索',
  '下一步核查',
  '后续线索',
  '核查方向',
  '派生任务线索',
  '任务钩子',
  '任务线索',
  '行动线索',
  'next_lead',
  'next_hook',
  'quest_hint',
  'lead',
] as const;

export function normalizeWorldEvoDomain(raw: unknown, textHint?: string): WorldEvoDomain {
  const s = `${String(raw ?? '')} ${textHint ?? ''}`.trim();
  if (/异象|潮汐|裂隙|磁暴|天象|极光|矿脉|生态|灾害|环境|anomaly/i.test(s)) return '位面异象';
  if (/科技|奇物|实验室|蓝图|逆向|超导|纳米|基因|武器|tech/i.test(s)) return '暗流科技';
  if (/社会|民生|黑市|物价|难民|商路|教派|财阀|经济|market|society/i.test(s)) return '社会黑市';
  return '远方地缘';
}

export function normalizeWorldEvoStage(raw: unknown): WorldEvoStage {
  const s = String(raw ?? '').trim();
  if (/平息|消退|结束|归档|落幕|subside/i.test(s)) return '平息';
  if (/显化|全面显化|公开|manifest/i.test(s)) return '显化';
  if (/高潮|爆发|临界|波及|climax|peak/i.test(s)) return '高潮';
  if (/发酵|酝酿|升温|扩散|升级|蔓延|恶化|developing|ferment/i.test(s)) return '发酵';
  return '萌芽';
}

export function worldEvoItemKey(item: Record<string, unknown>): string {
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '';
  if (id) return `id:${canon(id)}`;
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '';
  if (title) return `title:${canon(title)}`;
  return `content:${canon(String(item.content ?? '').slice(0, 40))}`;
}

export interface AppendIntelOptions {
  defaultScope?: 'tactical' | 'world';
  defaultDate?: string;
  touchedWorldKeys?: Set<string>;
}

function unwrapIntelPayloadList(items: unknown): unknown[] {
  if (Array.isArray(items)) return items;
  if (isUsable(items)) {
    const obj = items as Record<string, unknown>;
    for (const k of ['列表', '情报', '战区情报', '世界演变', '动向', 'items', 'list']) {
      if (Array.isArray(obj[k])) return obj[k] as unknown[];
    }
    const fieldKeys = [
      '标题',
      '名称',
      '主题',
      '动向',
      '事件',
      '内容',
      '详情',
      '摘要',
      '描述',
      '来源',
      '渠道',
      '象限',
      '阶段',
      '影响',
      '后果',
      '冲击',
      '趋势',
      '走向',
      '态势',
      '紧急度',
      '优先级',
      '情报链',
      '侦察链',
      '溯源链',
      '案卷',
      '阶数',
      '下一阶线索',
      '下一步核查',
      'title',
      'name',
      'content',
      'detail',
      'summary',
      'desc',
      'src',
      'impact',
      'trend',
      'urgency',
      'priority',
      'chain',
      'chain_step',
      'next_lead',
    ];
    const objCanonKeys = new Set(Object.keys(obj).map(k => canon(k)));
    if (fieldKeys.some(k => objCanonKeys.has(canon(k)))) return [obj];
    const entries = Object.entries(obj);
    if (entries.length > 0 && entries.every(([, v]) => isUsable(v) && !Array.isArray(v))) {
      return entries.map(([k, v]) => ({ 标题: k, ...(v as Record<string, unknown>) }));
    }
  }
  return asArray(items);
}

/** 情报与世界演变：支持六大来源归一、可信度跨轮证实/证伪演进（evolves_from）及世界演变五维字段入库 */
export function appendIntel(
  arr: Record<string, unknown>[],
  items: unknown,
  ctx: Ctx,
  opts?: AppendIntelOptions,
): void {
  const rawList = unwrapIntelPayloadList(items);
  for (const rawItem of rawList) {
    if (!isUsable(rawItem) || Array.isArray(rawItem)) {
      ctx.quarantine.push({
        scope: 'element',
        tag: opts?.defaultScope === 'world' ? '世界演变' : '情报',
        path: opts?.defaultScope === 'world' ? '世界演变' : '情报',
        raw: JSON.stringify(rawItem),
        error: '情报元素非对象',
      });
      continue;
    }
    const src = rawItem as Record<string, unknown>;
    const idx = keyIndex(src);
    const consumed = new Set<string>();
    const elem: Record<string, unknown> = {
      src: '',
      content: '',
      date: opts?.defaultDate ?? '',
      cred: '中',
      read: false,
      pinned: false,
    };

    const idT = take(src, idx, consumed, ['编号', 'id']);
    if (idT && idT.value != null && String(idT.value).trim()) {
      elem.id = String(idT.value).trim();
    }

    const titleT = take(src, idx, consumed, ['标题', '名称', '主题', '动向', '事件', '动态', 'title', 'name']);
    if (titleT && titleT.value != null && String(titleT.value).trim()) {
      elem.title = String(titleT.value).trim();
      ctx.appliedCount++;
    }

    setStr(elem, 'src', src, idx, consumed, ['来源', 'src', '源', '信源', '情报来源', 'source'], ctx);
    setStr(
      elem,
      'content',
      src,
      idx,
      consumed,
      [
        '内容',
        '详情',
        '摘要',
        '描述',
        '动向详情',
        '说明',
        '情报内容',
        '正文',
        '概述',
        'content',
        'detail',
        'details',
        'desc',
        'description',
        'summary',
      ],
      ctx,
    );
    setStr(elem, 'date', src, idx, consumed, ['日期', '时间', 'date', 'time'], ctx);

    const scopeT = take(src, idx, consumed, ['范畴', '轨道', '视野', 'scope', '类型', '类别']);
    const chanT = take(src, idx, consumed, ['渠道', '来源类型', '情报源', 'src_kind', 'channel']);
    const statusT = take(src, idx, consumed, ['状态', '核实状态', 'status']);
    const evoFromT = take(src, idx, consumed, ['演进自', '关联情报', '证实自', '证伪自', '续写自', 'evolves_from']);
    const domainT = take(src, idx, consumed, ['象限', '领域', '方向', 'evo_domain', 'domain']);
    const stageT = take(src, idx, consumed, ['阶段', '演化阶段', 'stage']);
    const ttlT = take(src, idx, consumed, ['热度', '剩余轮数', '衰减轮数', 'ttl', 'ttl_floors']);
    const hookT = take(src, idx, consumed, [
      '伏笔',
      '切入点',
      '潜在影响',
      '影响评估',
      '影响',
      '后果',
      '冲击',
      '波及',
      '战略影响',
      '威胁',
      '风险评估',
      'hook',
      'impact',
      'effect',
      'consequence',
    ]);
    const trendT = take(src, idx, consumed, [
      '趋势',
      '走向',
      '态势',
      '态势走向',
      '演变趋势',
      '演化趋势',
      '发展态势',
      '动向趋势',
      'trend',
      'tendency',
    ]);
    const urgencyT = take(src, idx, consumed, [
      '紧急度',
      '优先级',
      '紧迫度',
      '紧急程度',
      '威胁等级',
      '威胁度',
      '危险度',
      '风险',
      '风险等级',
      '张力',
      '紧张度',
      '烈度',
      'urgency',
      'priority',
      'risk',
      'tension',
      'severity',
      'level',
    ]);
    const chainT = take(src, idx, consumed, [...INTEL_CHAIN_ALIASES]);
    const chainStepT = take(src, idx, consumed, [...INTEL_CHAIN_STEP_ALIASES]);
    const nextLeadT = take(src, idx, consumed, [...INTEL_NEXT_LEAD_ALIASES, '线索']);
    const relatedPartyT = take(src, idx, consumed, ['关联方', '关联势力', '关联对象', '所属势力', 'related_party', 'faction']);
    const locationT = take(src, idx, consumed, ['地点', '位置', '坐标', '影响区域', '区域', '波及区域', 'location', 'region', 'area']);
    const extraMetaT = take(src, idx, consumed, ['备注', '注记', '建议', '对策', '应对建议', 'note', 'notes', 'suggestion', 'advice']);
    void relatedPartyT;
    void locationT;
    void urgencyT;
    void extraMetaT;

    const hookStr = hookT && hookT.value != null ? String(hookT.value).trim() : '';
    const trendStr = trendT && trendT.value != null ? String(trendT.value).trim() : '';
    if (!String(elem.content).trim()) {
      if (hookStr) {
        elem.content = hookStr;
        ctx.appliedCount++;
      } else if (trendStr) {
        elem.content = trendStr;
        ctx.appliedCount++;
      } else if (typeof elem.title === 'string' && elem.title.trim()) {
        elem.content = elem.title;
      }
    }

    const credRawT = take(src, idx, consumed, ['可信度', 'cred']);
    let isFalsifiedByCred = false;
    if (credRawT && credRawT.value != null) {
      const credStr = String(credRawT.value).trim();
      if (/证伪|虚假|假|烟雾弹|false/i.test(credStr)) {
        elem.cred = '低';
        isFalsifiedByCred = true;
        ctx.appliedCount++;
      } else if (/确认|证实|确凿|实锤|极高|高|high|confirmed|verified/i.test(credStr)) {
        elem.cred = '高';
        ctx.appliedCount++;
      } else {
        const r = resolveEnum(credRawT.value, ENUM_CRED);
        if (r.value != null) {
          elem.cred = r.value;
          ctx.appliedCount++;
        } else {
          elem.cred = '中';
        }
      }
    }

    if (!String(elem.content).trim()) {
      ctx.quarantine.push({
        scope: 'element',
        tag: opts?.defaultScope === 'world' ? '世界演变' : '情报',
        path: opts?.defaultScope === 'world' ? '世界演变' : '情报',
        raw: JSON.stringify(src),
        error: '缺少内容',
        suggestion: '补充 内容 字段',
      });
      continue;
    }

    const rawScopeStr = scopeT && scopeT.value != null ? String(scopeT.value).trim() : '';
    const isExplicitWorldScope = /世界|宏观|world|暗流|演变/i.test(rawScopeStr);
    const isWorld =
      opts?.defaultScope === 'world' ||
      isExplicitWorldScope ||
      (opts?.defaultScope !== 'tactical' && (domainT != null || stageT != null));

    elem.scope = isWorld ? 'world' : 'tactical';

    if (evoFromT && evoFromT.value != null && String(evoFromT.value).trim()) {
      elem.evolves_from = String(evoFromT.value).trim();
    }
    if (chainT && chainT.value != null && String(chainT.value).trim()) {
      elem.chain = String(chainT.value).trim();
    }
    if (chainStepT && chainStepT.value != null && String(chainStepT.value).trim()) {
      elem.chain_step = String(chainStepT.value).trim();
    }
    if (nextLeadT && nextLeadT.value != null && String(nextLeadT.value).trim()) {
      elem.next_lead = String(nextLeadT.value).trim();
    }
    if (hookStr) {
      elem.hook = hookStr;
    } else if (typeof elem.next_lead === 'string' && elem.next_lead) {
      elem.hook = elem.next_lead;
    } else if (trendStr) {
      elem.hook = trendStr;
    }
    if (!isWorld && hookStr && !elem.next_lead) {
      elem.next_lead = hookStr;
    }

    const resolvedSrcKind = normalizeIntelSrcKind(
      chanT?.value ?? (rawScopeStr && !isWorld ? rawScopeStr : undefined),
      String(elem.src || (isWorld ? '宏观广播' : '')),
    );
    elem.src_kind = resolvedSrcKind;
    if (!String(elem.src).trim()) {
      elem.src = isWorld ? '宏观世界公报' : resolvedSrcKind;
    }

    elem.status = isFalsifiedByCred
      ? '已证伪'
      : normalizeIntelStatus(
          statusT?.value,
          String(elem.cred),
          Boolean(elem.evolves_from),
          typeof elem.chain_step === 'string' ? elem.chain_step : undefined,
        );

    if (isWorld) {
      elem.evo_domain = normalizeWorldEvoDomain(
        domainT?.value ?? rawScopeStr,
        `${String(elem.title ?? '')} ${String(elem.content ?? '')}`,
      );
      const rawStageCandidate =
        stageT && stageT.value != null && String(stageT.value).trim() !== ''
          ? stageT.value
          : trendT?.value;
      elem.stage = normalizeWorldEvoStage(rawStageCandidate);
      const parsedTtl = ttlT && ttlT.value != null ? toNum(ttlT.value) : null;
      elem.ttl_floors =
        elem.stage === '平息'
          ? 0
          : parsedTtl != null && Number.isFinite(parsedTtl)
            ? Math.max(0, Math.min(20, Math.round(parsedTtl)))
            : 5;
      if (hookStr) {
        elem.hook = hookStr;
      }
      if (!elem.title) {
        elem.title = String(elem.content).slice(0, 20).trim();
      }
    } else if (ttlT && ttlT.value != null) {
      const parsedTtl = toNum(ttlT.value);
      if (parsedTtl != null && Number.isFinite(parsedTtl)) {
        elem.ttl_floors = Math.max(0, Math.min(20, Math.round(parsedTtl)));
      }
    }

    quarantineLeftovers(src, consumed, ctx, isWorld ? '世界演变' : '情报');

    // 跨轮次演进匹配（按 evolves_from、同链 chain 或同名 title 原地升级既有情报/世界演变）
    const evoTargetRef = typeof elem.evolves_from === 'string' ? canon(elem.evolves_from) : '';
    const chainRef = !isWorld && typeof elem.chain === 'string' ? canon(elem.chain) : '';
    const titleRef = typeof elem.title === 'string' ? canon(elem.title) : '';
    const existingTarget = arr.find(e => {
      const eTitle = typeof e.title === 'string' ? canon(e.title) : '';
      const eContent = canon(e.content);
      if (evoTargetRef && evoTargetRef.length >= 2) {
        if (eTitle && (eTitle === evoTargetRef || eTitle.includes(evoTargetRef) || evoTargetRef.includes(eTitle))) {
          return true;
        }
        if (eContent.includes(evoTargetRef)) return true;
      }
      if (chainRef && chainRef.length >= 2 && e.scope !== 'world') {
        const eChain = typeof e.chain === 'string' ? canon(e.chain) : '';
        if (eChain && eChain === chainRef) {
          return true;
        }
      }
      if (titleRef && titleRef.length >= 2 && eTitle === titleRef) {
        return true;
      }
      return false;
    });

    if (existingTarget) {
      const prevTitle = typeof existingTarget.title === 'string' ? existingTarget.title.trim() : '';
      const nextTitle = typeof elem.title === 'string' ? elem.title.trim() : '';
      if (elem.evolves_from) {
        existingTarget.evolves_from = elem.evolves_from;
      } else if (prevTitle && nextTitle && canon(prevTitle) !== canon(nextTitle)) {
        existingTarget.evolves_from = prevTitle;
      }
      if (elem.title) existingTarget.title = elem.title;
      if (elem.src) existingTarget.src = elem.src;
      if (elem.src_kind) existingTarget.src_kind = elem.src_kind;
      existingTarget.content = elem.content;
      if (elem.date) existingTarget.date = elem.date;
      existingTarget.cred = elem.cred;
      if (elem.chain) existingTarget.chain = elem.chain;
      if (elem.chain_step) existingTarget.chain_step = elem.chain_step;
      if (elem.next_lead) {
        existingTarget.next_lead = elem.next_lead;
        existingTarget.hook = elem.hook ?? elem.next_lead;
      } else if (elem.hook) {
        existingTarget.hook = elem.hook;
      }
      existingTarget.status = isFalsifiedByCred
        ? '已证伪'
        : normalizeIntelStatus(
            statusT?.value,
            String(elem.cred),
            Boolean(existingTarget.evolves_from),
            typeof existingTarget.chain_step === 'string' ? existingTarget.chain_step : undefined,
          );
      if (isWorld || existingTarget.scope === 'world') {
        existingTarget.scope = 'world';
        if (elem.evo_domain) existingTarget.evo_domain = elem.evo_domain;
        if (elem.stage) existingTarget.stage = elem.stage;
        existingTarget.ttl_floors = elem.stage === '平息' ? 0 : (elem.ttl_floors ?? 5);
        if (elem.hook) existingTarget.hook = elem.hook;
        opts?.touchedWorldKeys?.add(worldEvoItemKey(existingTarget));
      }
      existingTarget.read = false;
      ctx.appliedCount++;
      continue;
    }

    if (arr.some(e => canon(e.content) === canon(elem.content))) continue; // 去重
    const parsed = IntelItem.safeParse(elem);
    if (!parsed.success) {
      ctx.quarantine.push({
        scope: 'element',
        tag: isWorld ? '世界演变' : '情报',
        path: isWorld ? '世界演变' : '情报',
        raw: JSON.stringify(src),
        error: '新情报未通过校验',
        suggestion: parsed.error.issues.map(i => i.message).join('; '),
      });
      continue;
    }
    const validItem = parsed.data as Record<string, unknown>;
    arr.push(validItem);
    if (validItem.scope === 'world') {
      opts?.touchedWorldKeys?.add(worldEvoItemKey(validItem));
    }
    ctx.appliedCount++;
  }
}

export const MAX_ACTIVE_TACTICAL_INTEL = 12;
export const MAX_ACTIVE_WORLD_EVO = 6;
export const MAX_ARCHIVED_INTEL = 30;

/**
 * FD-33 D-INTEL-EVO-04：世界演变 5 轮 TTL 自然衰减曲线
 * - 对本轮解析前已存在、本轮未被续写更新且未 pinned 的 `scope === 'world'` 条目，每过 1 轮 `ttl_floors - 1`；
 * - 当 `ttl_floors <= 0` 或 `stage === '平息'` 时，自动置为 `stage: '平息'` 并移入 `data.intel_archived` 冷存池。
 */
export function tickWorldEvolutionDecay(
  data: StatData,
  preExistingWorldKeys: ReadonlySet<string>,
  touchedWorldKeys: ReadonlySet<string>,
): void {
  const active = data.intel as Record<string, unknown>[];
  const archived = data.intel_archived as Record<string, unknown>[];
  if (!Array.isArray(active) || !Array.isArray(archived)) return;

  for (let i = active.length - 1; i >= 0; i--) {
    const item = active[i];
    if (!item || item.scope !== 'world') continue;
    if (item.pinned === true) continue;

    const key = worldEvoItemKey(item);
    if (preExistingWorldKeys.has(key) && !touchedWorldKeys.has(key)) {
      const curTtl = typeof item.ttl_floors === 'number' && Number.isFinite(item.ttl_floors) ? item.ttl_floors : 5;
      item.ttl_floors = Math.max(0, curTtl - 1);
    }

    const afterTtl = typeof item.ttl_floors === 'number' ? item.ttl_floors : 5;
    if (afterTtl <= 0 || item.stage === '平息') {
      item.stage = '平息';
      item.ttl_floors = 0;
      active.splice(i, 1);
      archived.push(item);
    }
  }
}

/**
 * FD-37 · D-SAVE-GARRISON-03：确保全局 data.forces 总账不少于各基地 base.forces 分驻之和
 * （仅在存在分基地 forces 时向上兜底同步，旧档零 base.forces 时完全无副作用）
 */
export function syncGlobalForcesFloorFromBases(data: StatData): void {
  if (!Array.isArray(data.bases) || data.bases.length === 0) return;
  const basesWithForces = data.bases.filter(b => b && isUsable(b.forces) && !Array.isArray(b.forces));
  if (basesWithForces.length === 0) return;

  const globalForces = data.forces as unknown as Record<string, unknown>;
  if (!isUsable(globalForces)) return;

  const troopSums = new Map<string, { displayKey: string; total: number }>();
  for (const b of basesWithForces) {
    const troops = b.forces?.troops;
    if (!isUsable(troops) || Array.isArray(troops)) continue;
    for (const [k, v] of Object.entries(troops)) {
      const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
      if (n <= 0) continue;
      const ck = canon(k);
      const prev = troopSums.get(ck);
      if (prev) {
        prev.total += n;
      } else {
        troopSums.set(ck, { displayKey: k, total: n });
      }
    }
  }
  if (troopSums.size > 0) {
    const gTroops = (globalForces.troops ??= {}) as Record<string, number>;
    for (const [ck, { displayKey, total }] of troopSums.entries()) {
      const existingKey = Object.keys(gTroops).find(k => canon(k) === ck) ?? displayKey;
      const curVal = typeof gTroops[existingKey] === 'number' ? gTroops[existingKey] : 0;
      if (curVal < total) {
        gTroops[existingKey] = total;
      }
    }
  }

  const parseVehCountToken = (raw: string): { model: string; count: number } => {
    const text = raw.trim();
    const m = text.match(/^(.+?)\s*[×xX*]\s*(\d+)\s*$/);
    if (m) {
      return { model: m[1].trim(), count: Math.max(1, Number.parseInt(m[2], 10) || 1) };
    }
    return { model: text, count: 1 };
  };

  const vehSums = new Map<string, { displayName: string; total: number }>();
  for (const b of basesWithForces) {
    const vehicles = b.forces?.vehicles;
    if (!Array.isArray(vehicles)) continue;
    for (const v of vehicles) {
      if (typeof v !== 'string' || !v.trim()) continue;
      const { model, count } = parseVehCountToken(v);
      if (!model) continue;
      const ck = canon(model);
      const prev = vehSums.get(ck);
      if (prev) {
        prev.total += count;
      } else {
        vehSums.set(ck, { displayName: model, total: count });
      }
    }
  }
  if (vehSums.size > 0) {
    if (!Array.isArray(globalForces.vehicles)) globalForces.vehicles = [];
    const gVehicles = globalForces.vehicles as string[];
    for (const [ck, { displayName, total }] of vehSums.entries()) {
      let existingCount = 0;
      let matchedModelName: string | undefined;
      for (const x of gVehicles) {
        if (typeof x !== 'string') continue;
        const parsed = parseVehCountToken(x);
        if (canon(parsed.model) === ck) {
          existingCount += parsed.count;
          if (!matchedModelName) matchedModelName = parsed.model;
        }
      }
      if (existingCount < total) {
        const canonicalName = matchedModelName ?? displayName;
        for (let i = 0; i < total - existingCount; i++) {
          gVehicles.push(canonicalName);
        }
      }
    }
  }

  const equipSums = new Map<string, { displayKey: string; total: number }>();
  for (const b of basesWithForces) {
    const equip = b.forces?.equipment;
    if (!isUsable(equip) || Array.isArray(equip)) continue;
    for (const [k, v] of Object.entries(equip)) {
      const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
      if (n <= 0) continue;
      const ck = canon(k);
      const prev = equipSums.get(ck);
      if (prev) {
        prev.total += n;
      } else {
        equipSums.set(ck, { displayKey: k, total: n });
      }
    }
  }
  if (equipSums.size > 0) {
    const gEquip = (globalForces.equipment ??= {}) as Record<string, number>;
    for (const [ck, { displayKey, total }] of equipSums.entries()) {
      const existingKey = Object.keys(gEquip).find(k => canon(k) === ck) ?? displayKey;
      const curVal = typeof gEquip[existingKey] === 'number' ? gEquip[existingKey] : 0;
      if (curVal < total) {
        gEquip[existingKey] = total;
      }
    }
  }
}

/**
 * FD-33 D-INTEL-EVO-04：L1 热流层与 L2 冷存层三级存储容量守卫
 */
export function enforceIntelStorageBounds(data: StatData): void {
  syncGlobalForcesFloorFromBases(data);
  const active = data.intel as Record<string, unknown>[];
  const archived = data.intel_archived as Record<string, unknown>[];
  if (!Array.isArray(active) || !Array.isArray(archived)) return;

  // 1. L1 战区常规情报非置顶上限 12 条
  let unpinnedTactical = active.filter(it => it.scope !== 'world' && !it.pinned);
  while (unpinnedTactical.length > MAX_ACTIVE_TACTICAL_INTEL) {
    const oldest = unpinnedTactical.shift()!;
    const idx = active.indexOf(oldest);
    if (idx >= 0) {
      active.splice(idx, 1);
      archived.push(oldest);
    }
  }

  // 2. L1 世界演变非置顶上限 6 条
  let unpinnedWorld = active.filter(it => it.scope === 'world' && !it.pinned);
  while (unpinnedWorld.length > MAX_ACTIVE_WORLD_EVO) {
    const oldest = unpinnedWorld.shift()!;
    const idx = active.indexOf(oldest);
    if (idx >= 0) {
      active.splice(idx, 1);
      archived.push(oldest);
    }
  }

  // 3. L2 冷存上限 30 条（FIFO 淘汰最旧）
  while (archived.length > MAX_ARCHIVED_INTEL) {
    archived.shift();
  }
}

export const STARTER_MAIDEN_NAMES: ReadonlySet<string> = new Set([
  '白凌',
  '喀秋莎',
  '尤里卡',
  '凛冬妮娅',
  '妮娅',
  '薇拉',
]);

export const STARTER_HUMAN_ROSTER_NAMES: ReadonlySet<string> = new Set([
  '萧栖雪',
  '杜月欣',
  '陆玉凝',
  '林晚',
  '苏晓',
]);

const DYNAMIC_RELATION_INCREMENT_KEYS = [
  '信任变化',
  '好感变化',
  '信任增量',
  '好感增量',
  'trust_delta',
  'affection_delta',
  '态度',
  '立场',
  '关系',
  '倾向',
  'attitude',
  '近期交集',
  '事迹',
  '近期动向',
  'recent_note',
];

function hasDynamicRelationIncrementFields(
  src: Record<string, unknown>,
  idx: Map<string, string>,
): boolean {
  for (const key of DYNAMIC_RELATION_INCREMENT_KEYS) {
    const matchedKey = idx.get(canon(key));
    if (matchedKey !== undefined) {
      const val = src[matchedKey];
      if (val != null && String(val).trim() !== '') return true;
    }
  }
  for (const baseKey of ['信任', '信任度', '好感', '好感度', 'trust', 'affection']) {
    for (const suffix of ['变化', '增量', '变动', '_delta', 'delta']) {
      const matchedKey = idx.get(canon(`${baseKey}${suffix}`));
      if (matchedKey !== undefined && src[matchedKey] != null && String(src[matchedKey]).trim() !== '') {
        return true;
      }
    }
  }
  for (const paramKey of ['参数', 'params']) {
    const matchedParamKey = idx.get(canon(paramKey));
    if (matchedParamKey === undefined) continue;
    const pObj = src[matchedParamKey];
    if (isUsable(pObj) && !Array.isArray(pObj)) {
      const pIdx = keyIndex(pObj as Record<string, unknown>);
      for (const key of DYNAMIC_RELATION_INCREMENT_KEYS) {
        const mk = pIdx.get(canon(key));
        if (mk !== undefined) {
          const val = (pObj as Record<string, unknown>)[mk];
          if (val != null && String(val).trim() !== '') return true;
        }
      }
    }
  }
  return false;
}

const RETROFIT_SUFFIX_KEYWORD_RE =
  /改|版|型|加挂|改装|强化|升级|战地|特制|防寒|雪地|极地|荒原|复合|重装|增程|披挂|外挂/;

function extractRetrofitBaseEntityName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 3) return null;

  const parenMatch = trimmed.match(
    /^(.+?)\s*(?:（([^（）]+)）|\(([^()]+)\)|\[([^\[\]]+)\]|【([^【】]+)】)$/,
  );
  if (parenMatch) {
    const baseName = parenMatch[1].trim();
    const suffix = (parenMatch[2] ?? parenMatch[3] ?? parenMatch[4] ?? parenMatch[5] ?? '').trim();
    if (baseName.length >= 2 && RETROFIT_SUFFIX_KEYWORD_RE.test(suffix)) {
      return baseName;
    }
  }

  const sepMatch = trimmed.match(/^(.+?)\s*[·•\-—/／]\s*([^·•\-—/／]+)$/);
  if (sepMatch) {
    const baseName = sepMatch[1].trim();
    const suffix = sepMatch[2].trim();
    if (baseName.length >= 2 && RETROFIT_SUFFIX_KEYWORD_RE.test(suffix)) {
      return baseName;
    }
  }

  return null;
}

/** 图鉴 codex：按名+类别 upsert；params 值 String() 强转；kind 漂移🟡显式修复；新图鉴条目同步进入 pending_lore 待核准 */
export function upsertCodex(
  arr: Record<string, unknown>[],
  items: unknown,
  ctx: Ctx,
  pendingLoreArr?: unknown[],
  stageMeta?: { floorId?: number; currentDay?: number },
): void {
  for (const rawItem of asArray(items)) {
    if (!isUsable(rawItem) || Array.isArray(rawItem)) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '图鉴',
        path: '图鉴',
        raw: JSON.stringify(rawItem),
        error: '图鉴元素非对象',
      });
      continue;
    }
    const src = rawItem as Record<string, unknown>;
    const idx = keyIndex(src);
    const consumed = new Set<string>();
    const loc = take(src, idx, consumed, NAME_ALIASES);
    const rawName = loc && loc.value != null ? String(loc.value).trim() : '';
    if (!rawName) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '图鉴',
        path: '图鉴',
        raw: JSON.stringify(src),
        error: '缺少名称',
        suggestion: '补充 名称 字段',
      });
      continue;
    }
    // 实体对齐：仅在命中精确/canon/显式别名时归一（防变体重复注册）；严禁低置信模糊改名吞并新图鉴专名
    const name = applyAlign(rawName, ctx, `图鉴[${rawName}]`, 'exact_or_alias');
    if (STARTER_MAIDEN_NAMES.has(name) || STARTER_MAIDEN_NAMES.has(rawName)) {
      green(ctx, {
        layer: 'L3' as unknown as ParseEvent['layer'],
        path: `codex.${name}`,
        message: `[扩展档案/图鉴] 「${name}」属于已在册核心机娘，日常状态变动请走 <机娘> 标签，跳过重复建档`,
        before: rawName,
        after: name,
      });
      ctx.appliedCount++;
      continue;
    }
    // kind（未知 → 其他 + 🟡）
    const kindT = take(src, idx, consumed, ['类别', '类型', '种类', '分类', '归类', 'kind', 'type', 'category']);
    let resolvedKind: string | null = null;
    if (kindT) {
      const r = resolveEnum(kindT.value, ENUM_KIND);
      if (r.value == null) {
        resolvedKind = '其他';
        yellow(
          ctx,
          {
            layer: 'L2',
            path: `图鉴[${name}].kind`,
            message: `kind "${kindT.value}" 无法归一，降级为其他`,
            before: kindT.value,
            after: '其他',
          },
          { rule: 'R18', target: `图鉴[${name}].kind`, message: `kind 非法值已显式修复为其他` },
        );
      } else {
        if (!r.exact) {
          yellow(
            ctx,
            {
              layer: 'L2',
              path: `图鉴[${name}].kind`,
              message: `kind 归一化 "${kindT.value}" → "${r.value}"`,
              before: kindT.value,
              after: r.value,
            },
            { rule: 'R18', target: `图鉴[${name}].kind`, message: `kind 漂移已归一化为 "${r.value}"` },
          );
        }
        resolvedKind = r.value;
      }
    }
    const canonName = canon(name);
    const isGenericKind = (k: unknown) => {
      const s = typeof k === 'string' ? k.trim() : '';
      return !s || s === '其他';
    };
    const existing =
      (resolvedKind
        ? arr.find(e => canon(e.name) === canonName && String(e.kind ?? '').trim() === resolvedKind)
        : undefined) ??
      arr.find(
        e => canon(e.name) === canonName && (!resolvedKind || isGenericKind(e.kind) || isGenericKind(resolvedKind)),
      );
    const target = existing ?? { name, kind: '其他', desc: '', params: {} };
    if (!existing) target.name = name;
    if (resolvedKind != null) {
      target.kind = resolvedKind;
    }
    const kindStr = String(target.kind ?? '其他');
    if (
      kindStr === '科技' ||
      kindStr === '建筑' ||
      kindStr === '单位' ||
      kindStr === '人员' ||
      kindStr === '载具' ||
      kindStr === '装备'
    ) {
      const domain: EntityDomain =
        kindStr === '科技' ? 'research' : kindStr === '建筑' ? 'building' : 'production';
      const { index: credIndex, hasWorldbookSnapshot, snapBuildingNames } = resolveSystemCatalogCredibility(ctx);
      const isBuiltinBuildingOnly =
        kindStr === '建筑' &&
        BUILTIN_BUILDING_NAME_SET.has(name) &&
        !snapBuildingNames.has(canon(name)) &&
        !ctx.deployIndex?.byInto(name);
      const isLegacyCodexDescOnlyUpdate =
        !hasWorldbookSnapshot &&
        existing !== undefined &&
        kindT == null;

      if (!isBuiltinBuildingOnly && !isLegacyCodexDescOnlyUpdate) {
        const queryDomain: EntityDomain =
          credIndex && getCredIndexDomainCount(credIndex, domain) > 0
            ? domain
            : 'any';
        const hitByCredibility =
          credIndex != null && isSystemCatalogEntity(credIndex, name, queryDomain, 0.80);
        const hitByDeployIndex =
          (kindStr === '建筑' && Boolean(ctx.deployIndex?.byInto(name))) ||
          ((kindStr === '单位' || kindStr === '载具') && Boolean(ctx.deployIndex?.byVehicle(name)));

        if (hitByCredibility || hitByDeployIndex) {
          const credEval = credIndex
            ? evaluateEntityCredibility(credIndex, name, { domain: queryDomain, highThreshold: 0.80 })
            : null;
          const matchedStdName = credEval?.matchedName ?? name;
          for (let i = arr.length - 1; i >= 0; i--) {
            const existingName = String(arr[i]?.name ?? '');
            if (
              canon(existingName) === canon(name) ||
              canon(existingName) === canon(rawName) ||
              canon(existingName) === canon(matchedStdName)
            ) {
              arr.splice(i, 1);
            }
          }
          green(ctx, {
            layer: 'L3' as unknown as ParseEvent['layer'],
            path: `codex.${name}`,
            message: `[图鉴] 「${name}」属于世界书既有${kindStr}目录，跳过动态重复建档`,
            before: rawName,
            after: matchedStdName,
          });
          ctx.appliedCount++;
          continue;
        }
      }
    }
    setStr(target, 'desc', src, idx, consumed, ['简介', '描述', 'desc', '摘要'], ctx);
    const pT = take(src, idx, consumed, ['参数', 'params']);
    if (pT && isUsable(pT.value) && !Array.isArray(pT.value)) {
      const params: Record<string, string> = isUsable(target.params) ? (target.params as Record<string, string>) : {};
      for (const [k, v] of Object.entries(pT.value as Record<string, unknown>)) params[k] = String(v);
      target.params = params;
      ctx.appliedCount++;
    }
    quarantineLeftovers(src, consumed, ctx, `图鉴[${name}]`);
    if (existing) {
      ctx.appliedCount++;
    } else {
      const parsed = CodexEntry.safeParse(target);
      if (!parsed.success) {
        ctx.quarantine.push({
          scope: 'element',
          tag: '图鉴',
          path: `图鉴[${name}]`,
          raw: JSON.stringify(src),
          error: '新 codex 未通过校验',
          suggestion: parsed.error.issues.map(i => i.message).join('; '),
        });
        continue;
      }
      arr.push(parsed.data as Record<string, unknown>);
      ctx.appliedCount++;
      if (Array.isArray(pendingLoreArr)) {
        const loreId = `lore_${canonName}`;
        const alreadyStaged = pendingLoreArr.some(item => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
          const rec = item as Record<string, unknown>;
          return rec.id === loreId || canon(String(rec.name ?? '')) === canonName;
        });
        if (!alreadyStaged) {
          pendingLoreArr.push({
            id: loreId,
            kind: parsed.data.kind,
            name: parsed.data.name,
            summary: parsed.data.desc || `新发现${parsed.data.kind}「${parsed.data.name}」`,
            is_new: true,
            source_floor: typeof stageMeta?.floorId === 'number' && Number.isFinite(stageMeta.floorId) ? stageMeta.floorId : -1,
            source_swipe: -1,
            created_day: typeof stageMeta?.currentDay === 'number' && Number.isFinite(stageMeta.currentDay) ? stageMeta.currentDay : 0,
            raw: { tag: '图鉴', codex: parsed.data },
          });
        }
      }
    }
  }
}

/** <机娘档案> → pending_lore：按名/编号/原名认亲 upsert；散文字段 setStr 归一；keys 兼容数组/逗号分隔串；
 * 新条目 GirlDossier.safeParse 把关；入档清除由落地器（girlFiler）负责，管道保持纯函数 */
export function upsertDossier(arr: Record<string, unknown>[], items: unknown, ctx: Ctx): void {
  for (const rawItem of asArray(items)) {
    if (!isUsable(rawItem) || Array.isArray(rawItem)) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '机娘档案',
        path: '机娘档案',
        raw: JSON.stringify(rawItem),
        error: '机娘档案元素非对象',
      });
      continue;
    }
    const src = rawItem as Record<string, unknown>;
    const idx = keyIndex(src);
    const consumed = new Set<string>();
    const loc = take(src, idx, consumed, NAME_ALIASES);
    const rawCallsign = peekFieldStr(src, idx, GIRL_CALLSIGN_ALIASES);
    const rawSerial = peekFieldStr(src, idx, GIRL_SERIAL_ALIASES);
    const rawRenameFrom = peekFieldStr(src, idx, GIRL_RENAME_FROM_ALIASES);
    const rawModel = peekFieldStr(src, idx, GIRL_MODEL_ALIASES);
    const rawName =
      (loc && loc.value != null ? String(loc.value).trim() : '') ||
      rawCallsign ||
      (rawSerial ? `待授名·${rawSerial}` : '');
    if (!rawName) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '机娘档案',
        path: '机娘档案',
        raw: JSON.stringify(src).slice(0, 200),
        error: '缺少名称',
        suggestion: '补充 名称 字段',
      });
      continue;
    }
    // 新机娘本就是新实体；但变体名命中权威名时归一（防同一机娘重复建档）
    const name = isUnchristenedGirlName(rawName)
      ? rawName
      : applyAlign(rawName, ctx, `机娘档案[${rawName}]`, 'entity');

    // 支持按 rename_from、serial、callsign 或 name 匹配既有 pending_lore 机娘条目并原地更新名称
    let existing: Record<string, unknown> | undefined;
    const isDossierElem = (e: Record<string, unknown>) =>
      e.kind !== '势力' &&
      !(
        typeof e.id === 'string' &&
        e.id.length > 0 &&
        !e.id.startsWith('maiden.') &&
        e.type !== 'maiden'
      );
    if (rawRenameFrom) {
      const cFrom = canon(rawRenameFrom);
      existing = arr.find(
        e =>
          isDossierElem(e) &&
          (canon(String(e.name ?? '')) === cFrom || (Boolean(e.serial) && canon(String(e.serial)) === cFrom)),
      );
    }
    if (!existing && rawSerial) {
      const cSer = canon(rawSerial);
      const cPendingSer = canon(`待授名·${rawSerial}`);
      existing = arr.find(
        e =>
          isDossierElem(e) &&
          ((Boolean(e.serial) && canon(String(e.serial)) === cSer) ||
            canon(String(e.name ?? '')) === cSer ||
            canon(String(e.name ?? '')) === cPendingSer),
      );
    }
    if (!existing && rawCallsign) {
      const cCall = canon(rawCallsign);
      existing = arr.find(
        e =>
          isDossierElem(e) &&
          ((Boolean(e.callsign) && canon(String(e.callsign)) === cCall) || canon(String(e.name ?? '')) === cCall),
      );
    }
    if (!existing) {
      existing = arr.find(e => isDossierElem(e) && canon(String(e.name ?? '')) === canon(name));
      if (!existing && rawModel && !isUnchristenedGirlName(name)) {
        const cModel = canon(rawModel);
        const pendingSameModel = arr.filter(
          e => isDossierElem(e) && Boolean(e.model) && canon(String(e.model)) === cModel && isUnchristenedGirlName(e.name),
        );
        if (pendingSameModel.length === 1) {
          existing = pendingSameModel[0];
        }
      }
    }

    const target: Record<string, unknown> = existing ?? { name };
    if (existing) {
      if (!isUnchristenedGirlName(name)) {
        target.name = name;
      } else if (!isUnchristenedGirlName(rawCallsign)) {
        target.name = rawCallsign;
      }
    } else {
      target.name = name;
    }

    setStr(target, 'id', src, idx, consumed, ['id', '档案ID', '数据ID', 'maiden_id'], ctx);
    setStr(target, 'type', src, idx, consumed, ['type', '数据类型'], ctx);
    take(src, idx, consumed, ['schema_version', '版本']);
    setNumField(target, 'tier', src, idx, consumed, ['tier', '科技层级', '阶位', '等级'], ctx, `机娘档案[${name}]`);
    setStr(target, 'incubation_mode', src, idx, consumed, ['incubation_mode', '孵化模式'], ctx);
    setStr(target, 'preset_name', src, idx, consumed, ['preset_name', '预设名', '母板预设名'], ctx);
    setStr(target, 'model', src, idx, consumed, GIRL_MODEL_ALIASES, ctx);
    setStr(target, 'serial', src, idx, consumed, GIRL_SERIAL_ALIASES, ctx);
    setStr(target, 'callsign', src, idx, consumed, GIRL_CALLSIGN_ALIASES, ctx);
    setStr(target, 'rename_from', src, idx, consumed, GIRL_RENAME_FROM_ALIASES, ctx);
    setStr(target, 'seq', src, idx, consumed, GIRL_SEQ_ALIASES, ctx);
    setStr(target, 'faction', src, idx, consumed, GIRL_FACTION_ALIASES, ctx);
    setStr(target, 'body', src, idx, consumed, GIRL_BODY_ALIASES, ctx);
    setStr(target, 'form_mech', src, idx, consumed, ['形态机制', 'form_mech'], ctx);
    setStr(target, 'temperament_spectrum', src, idx, consumed, ['temperament_spectrum', '机魂光谱', '性格光谱'], ctx);
    setStr(target, 'skills', src, idx, consumed, ['能力', '专属能力', '核心能力', 'skills'], ctx);
    setStr(target, 'flaws', src, idx, consumed, ['结构短板', '结构性短板', '短板', 'flaws'], ctx);
    setStr(target, 'weapons', src, idx, consumed, ['武器', '武装', 'weapons'], ctx);
    setStr(target, 'exposure', src, idx, consumed, ['暴露分档', '暴露代价', 'exposure', 'exposure_grade'], ctx);
    setStr(target, 'exposure_grade', src, idx, consumed, ['exposure_grade', '暴露分档', '暴露代价', 'exposure'], ctx);
    setStr(target, 'balance', src, idx, consumed, ['平衡位置', '平衡总纲位置', 'balance', 'balance_slot'], ctx);
    setStr(target, 'balance_slot', src, idx, consumed, ['balance_slot', '平衡总纲位置', '平衡位置', 'balance'], ctx);
    setStr(target, 'prose', src, idx, consumed, ['prose', '档案正文', '三段式正文', '正文'], ctx);
    setStr(target, 'alias', src, idx, consumed, GIRL_ALIAS_ALIASES, ctx);
    setStr(target, 'shell', src, idx, consumed, GIRL_SHELL_ALIASES, ctx);
    setStr(target, 'appearance', src, idx, consumed, GIRL_APPEARANCE_ALIASES, ctx);
    setStr(target, 'personality', src, idx, consumed, GIRL_PERSONALITY_ALIASES, ctx);
    const hadExplicitStatus = [...GIRL_STATUS_ALIASES, '状态'].some(a => idx.has(canon(a)));
    setStr(target, 'status', src, idx, consumed, [...GIRL_STATUS_ALIASES, '状态'], ctx);
    const stageT = take(src, idx, consumed, GIRL_STAGE_ALIASES);
    if (stageT && stageT.value != null && String(stageT.value).trim()) {
      if (!hadExplicitStatus || !target.status) {
        target.status = String(stageT.value).trim();
      }
      ctx.appliedCount++;
    } else if (!hadExplicitStatus && !isUnchristenedGirlName(name) && isUnchristenedGirlName(target.status)) {
      target.status = '';
    }

    // 解析结构化特殊技能数组 special_skills（与世界书 <数据> 块 1:1 同构）
    const skT = take(src, idx, consumed, ['special_skills', '特殊技能', '专属技能']);
    if (skT && skT.value != null) {
      const normalizedSkills: Array<{ name: string; kind: string; desc: string }> = [];
      for (const rawSk of asArray(skT.value)) {
        if (!isUsable(rawSk) || Array.isArray(rawSk)) continue;
        const skObj = rawSk as Record<string, unknown>;
        const skIdx = keyIndex(skObj);
        const skConsumed = new Set<string>();
        const nT = take(skObj, skIdx, skConsumed, ['name', '名称', '技能名', '专名']);
        const kT2 = take(skObj, skIdx, skConsumed, ['kind', '类别', '类型', '定位']);
        const dT = take(skObj, skIdx, skConsumed, ['desc', '描述', '效果', '说明']);
        const sName = nT && nT.value != null ? String(nT.value).trim() : '';
        const sKind = kT2 && kT2.value != null ? String(kT2.value).trim() : '核心权能';
        const sDesc = dT && dT.value != null ? String(dT.value).trim() : '';
        if (sName) {
          normalizedSkills.push({ name: sName, kind: sKind || '核心权能', desc: sDesc });
        }
      }
      if (normalizedSkills.length > 0) {
        target.special_skills = normalizedSkills;
        if (!target.skills) {
          target.skills = normalizedSkills.map(s => `· 【${s.name}（${s.kind}）】${s.desc}`).join('\n');
        }
        ctx.appliedCount++;
      }
    }

    // 解析结构化特殊装备数组 special_equipment（与世界书 <数据> 块 1:1 同构）
    const eqT = take(src, idx, consumed, ['special_equipment', '特殊装备', '专属装备', '挂载装备']);
    if (eqT && eqT.value != null) {
      const normalizedEq: Array<{ name: string; slot: string; desc: string }> = [];
      for (const rawEq of asArray(eqT.value)) {
        if (!isUsable(rawEq) || Array.isArray(rawEq)) continue;
        const eqObj = rawEq as Record<string, unknown>;
        const eqIdx = keyIndex(eqObj);
        const eqConsumed = new Set<string>();
        const nT = take(eqObj, eqIdx, eqConsumed, ['name', '名称', '装备名', '武器名']);
        const slT = take(eqObj, eqIdx, eqConsumed, ['slot', '槽位', '部位', '挂载位', '类型']);
        const dT = take(eqObj, eqIdx, eqConsumed, ['desc', '描述', '效果', '说明']);
        const eName = nT && nT.value != null ? String(nT.value).trim() : '';
        const eSlot = slT && slT.value != null ? String(slT.value).trim() : '专属挂载';
        const eDesc = dT && dT.value != null ? String(dT.value).trim() : '';
        if (eName) {
          normalizedEq.push({ name: eName, slot: eSlot || '专属挂载', desc: eDesc });
        }
      }
      if (normalizedEq.length > 0) {
        target.special_equipment = normalizedEq;
        if (!target.weapons) {
          target.weapons = normalizedEq.map(e => e.name).join('；');
        }
        ctx.appliedCount++;
      }
    }

    if (target.exposure && !target.exposure_grade) target.exposure_grade = target.exposure;
    if (target.exposure_grade && !target.exposure) target.exposure = target.exposure_grade;
    if (target.balance && !target.balance_slot) target.balance_slot = target.balance;
    if (target.balance_slot && !target.balance) target.balance = target.balance_slot;
    if (target.temperament_spectrum && !target.personality) target.personality = target.temperament_spectrum;
    if (target.personality && !target.temperament_spectrum) target.temperament_spectrum = target.personality;
    // 兼容 LLM 在 <机娘档案> 中一并输出的机娘运行态字段（驻地/职务/好感/服从/特征标签），消费并透传至 syncDossierToForcesGirls
    setStr(target, 'base', src, idx, consumed, GIRL_BASE_ALIASES, ctx);
    setStr(target, 'duty', src, idx, consumed, GIRL_DUTY_ALIASES, ctx);
    take(src, idx, consumed, [...GIRL_AFFECTION_ALIASES, ...GIRL_AFFECTION_DELTA_ALIASES]);
    take(src, idx, consumed, [...GIRL_OBEDIENCE_ALIASES, ...GIRL_OBEDIENCE_DELTA_ALIASES]);
    const traitsT = take(src, idx, consumed, GIRL_TRAITS_ALIASES);
    if (traitsT && traitsT.value != null) {
      const parsedTraits = parseGirlTraits(traitsT.value);
      if (parsedTraits.length > 0) {
        target.traits = parsedTraits;
        if (!target.skills) {
          target.skills = parsedTraits.join('；');
        }
        ctx.appliedCount++;
      }
    }

    // keys：数组逐项 String 强转；字符串按 逗号/顿号/、 分割
    const kT = take(src, idx, consumed, ['触发词', '关键词', 'keys']);
    if (kT && kT.value != null) {
      const ks = Array.isArray(kT.value)
        ? kT.value.map(v => String(v).trim()).filter(Boolean)
        : String(kT.value)
            .split(/[,，、;；]/)
            .map(s => s.trim())
            .filter(Boolean);
      if (ks.length) {
        target.keys = [...new Set(ks)];
        ctx.appliedCount++;
      }
    }

    quarantineLeftovers(src, consumed, ctx, `机娘档案[${String(target.name ?? name)}]`);
    if (existing) {
      ctx.appliedCount++;
    } else {
      const parsed = GirlDossier.safeParse(target);
      if (!parsed.success) {
        ctx.quarantine.push({
          scope: 'element',
          tag: '机娘档案',
          path: `机娘档案[${name}]`,
          raw: JSON.stringify(src).slice(0, 200),
          error: '新机娘档案未通过校验',
          suggestion: parsed.error.issues.map(i => i.message).join('; '),
        });
        continue;
      }
      arr.push(parsed.data as Record<string, unknown>);
      ctx.appliedCount++;
    }
  }
}

/**
 * 将 pending_lore 中的机娘档案自动同步/认亲合并到 forces.girls（MAIDEN-CORE-01）：
 * 确保指挥官赐名仅输出 <机娘档案> 时，部队编制表内的待授名记录也能立即原地升级为正式代号！
 */
/**
 * 当 LLM 在一级 `<机娘>` 标签中附带了 `special_skills` / `special_equipment` / `武器` / `能力` / `形态机制` / `结构性短板` 等能力档案字段时，
 * 自动将这些字段兜底桥接同步至 `pending_lore`（调用 `upsertDossier`），确保主副武器与技能数据块绝不因标签混写而丢失。
 */
export function bridgeGirlDossierFieldsFromGirlsBlock(
  pendingLore: Record<string, unknown>[],
  items: unknown,
  ctx: Ctx,
): void {
  const DOSSIER_PAYLOAD_KEYS = [
    'special_skills',
    '特殊技能',
    '专属技能',
    'special_equipment',
    '特殊装备',
    '专属装备',
    '挂载装备',
    'weapons',
    '武器',
    '武装',
    'skills',
    '能力',
    '专属能力',
    '核心能力',
    'form_mech',
    '形态机制',
    'flaws',
    '结构短板',
    '结构性短板',
    '短板',
  ];
  const dossierCandidates: Record<string, unknown>[] = [];
  for (const rawItem of normalizeGirlInputItems(items)) {
    if (!isUsable(rawItem) || Array.isArray(rawItem)) continue;
    const src = rawItem as Record<string, unknown>;
    const idx = keyIndex(src);
    const hasDossierField = DOSSIER_PAYLOAD_KEYS.some(k => {
      const realKey = idx.get(canon(k));
      if (!realKey) return false;
      const val = src[realKey];
      if (Array.isArray(val)) return val.length > 0;
      if (typeof val === 'string') return val.trim().length > 0;
      return val != null;
    });
    if (!hasDossierField) continue;
    const loc = peekFieldStr(src, idx, NAME_ALIASES) || peekFieldStr(src, idx, GIRL_CALLSIGN_ALIASES);
    if (!loc || isUnchristenedGirlName(loc)) continue;
    dossierCandidates.push({ ...src });
  }
  if (dossierCandidates.length > 0) {
    upsertDossier(pendingLore, dossierCandidates, ctx);
  }
}

export function syncDossierToForcesGirls(
  girls: Record<string, unknown>[],
  pendingLore: Record<string, unknown>[],
  ctx: Ctx,
): void {
  const syncItems: Record<string, unknown>[] = [];
  for (const item of pendingLore) {
    if (!isUsable(item) || Array.isArray(item)) continue;
    const d = item as Record<string, unknown>;
    if (typeof d.name !== 'string' || !d.name.trim()) continue;
    if (d.kind === '势力' || (typeof d.kind === 'string' && d.kind !== '机娘')) continue;
    if (
      typeof d.id === 'string' &&
      d.id.length > 0 &&
      !d.id.startsWith('maiden.') &&
      d.type !== 'maiden'
    ) {
      continue;
    }
    if (
      typeof d.model !== 'string' &&
      typeof d.serial !== 'string' &&
      typeof d.callsign !== 'string' &&
      typeof d.shell !== 'string' &&
      !Array.isArray(d.keys)
    ) {
      continue;
    }

    const payload: Record<string, unknown> = { 名称: d.name };
    const copyIfNonEmpty = (key: string, val: unknown) => {
      if (typeof val === 'string' && val.trim()) {
        payload[key] = val.trim();
      }
    };
    copyIfNonEmpty('callsign', d.callsign);
    copyIfNonEmpty('serial', d.serial);
    copyIfNonEmpty('rename_from', d.rename_from);
    copyIfNonEmpty('model', d.model);
    copyIfNonEmpty('seq', d.seq);
    copyIfNonEmpty('faction', d.faction);
    copyIfNonEmpty('body', d.body);
    copyIfNonEmpty('personality', d.personality);
    copyIfNonEmpty('appearance', d.appearance);
    copyIfNonEmpty('shell', d.shell);
    copyIfNonEmpty('alias', d.alias);
    copyIfNonEmpty('status', d.status);
    copyIfNonEmpty('base', d.base);
    copyIfNonEmpty('duty', d.duty);
    if (Array.isArray(d.traits) && d.traits.length > 0) {
      payload.traits = d.traits;
    }
    syncItems.push(payload);
  }
  if (syncItems.length > 0) {
    upsertGirls(girls, syncItems, ctx, '机娘档案同步');
  }
}

/**
 * 当机娘完成赐名转正后，同步清理/原地升级 codex 中可能残留的「待授名·编号」或旧代号词条，避免赐名前后双词条重复。
 */
export function syncChristenedGirlsToCodex(
  codex: Record<string, unknown>[],
  girls: Record<string, unknown>[],
  pendingLore: Record<string, unknown>[],
): void {
  if (!Array.isArray(codex) || codex.length === 0) return;
  const sources = [...(Array.isArray(pendingLore) ? pendingLore : []), ...(Array.isArray(girls) ? girls : [])];
  for (const item of sources) {
    if (!isUsable(item) || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const formalName = String(rec.name ?? '').trim();
    if (!formalName || isUnchristenedGirlName(formalName)) continue;
    const renameFrom = String(rec.rename_from ?? '').trim();
    const serial = String(rec.serial ?? '').trim();
    const model = String(rec.model ?? '').trim();

    for (const cEntry of codex) {
      if (!isUsable(cEntry)) continue;
      const cName = String(cEntry.name ?? '').trim();
      if (!cName || canon(cName) === canon(formalName)) continue;
      const cParams = isUsable(cEntry.params) ? (cEntry.params as Record<string, unknown>) : {};
      const cSerial = String(cParams['编号'] ?? cParams['出厂编号'] ?? cParams.serial ?? '').trim();
      const cModel = String(cParams['型号'] ?? cParams.model ?? '').trim();

      const hitByRename = Boolean(renameFrom && canon(cName) === canon(renameFrom));
      const hitBySerial = Boolean(
        serial &&
          (canon(cName) === canon(serial) ||
            canon(cName) === canon(`待授名·${serial}`) ||
            (cSerial && canon(cSerial) === canon(serial))),
      );
      const hitByUnchristenedModel = Boolean(
        model &&
          isUnchristenedGirlName(cName) &&
          ((cModel && canon(cModel) === canon(model)) || String(cEntry.desc ?? '').includes(model)),
      );

      if (hitByRename || hitBySerial || hitByUnchristenedModel) {
        cEntry.name = formalName;
      }
    }
  }

  // 去重：若原地改名后与新增正式名 codex 条目同名，合并非空 desc 与 params
  for (let i = 0; i < codex.length; i++) {
    const primary = codex[i];
    const cName = canon(primary?.name);
    if (!cName) continue;
    for (let j = codex.length - 1; j > i; j--) {
      const dup = codex[j];
      if (canon(dup?.name) !== cName) continue;
      if (typeof dup.desc === 'string' && dup.desc.trim() && dup.desc.length > String(primary.desc ?? '').length) {
        primary.desc = dup.desc;
      }
      if (isUsable(dup.params)) {
        primary.params = { ...(isUsable(primary.params) ? (primary.params as Record<string, string>) : {}), ...(dup.params as Record<string, string>) };
      }
      codex.splice(j, 1);
    }
  }
}

const NPC_TOP_LEVEL_HINT_KEYS = [
  '代号',
  '头衔',
  '称号',
  '所属势力',
  '态度',
  '立场',
  '信任度',
  '好感',
  '好感度',
  '信任变化',
  '好感变化',
  '外貌特征',
  '性格与口吻',
  '近期交集',
];

function normalizeNpcAttitude(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (/效忠|死忠|归顺|追随/.test(s)) return '效忠';
  if (/友善|友好|亲近|敬重|信赖/.test(s)) return '友善';
  if (/合作|盟友|协防|互利|交易/.test(s)) return '合作';
  if (/中立|观望|中立偏|持平/.test(s)) return '中立';
  if (/警觉|戒备|怀疑|提防|忌惮/.test(s)) return '警觉';
  if (/敌对|敌意|仇视|死敌|交战/.test(s)) return '敌对';
  return s;
}

/**
 * <扩展档案> → pending_expansions（CTRL-CHATBOOK-02 §2.2 + FD-32 人物分支升级）：
 * - 按名 upsert；
 * - 实体对齐 applyAlign 归一实体名；
 * - kind 对齐 ['科技', '建筑', '载具', '人员', '人物', '装备']，'阵营'/'其他'不进本通道；
 * - 当 kind === '人物'（剧情重要独立 NPC）时：豁免量产兵种目录拦截，支持顶层或 params 内的立体设定与动态关系追踪（态度、信任度 0~100 及增量 ±25 钳制累加、状态/驻地、近期交集），并同步 upsert 至 codex；
 * - 散文字段 setStr 归一；keys 兼容数组/分隔串；可选 data 结构化载荷对象；
 * - 非法整包隔离入 quarantine；Zod safeParse 校验失败留痕。
 */
export function upsertExpansion(
  arr: Record<string, unknown>[],
  items: unknown,
  ctx: Ctx,
  codexArr?: Record<string, unknown>[],
): void {
  for (const rawItem of asArray(items)) {
    if (!isUsable(rawItem) || Array.isArray(rawItem)) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '扩展档案',
        path: '扩展档案',
        raw: JSON.stringify(rawItem),
        error: '扩展档案元素非对象',
      });
      continue;
    }
    const src = rawItem as Record<string, unknown>;
    const idx = keyIndex(src);
    const consumed = new Set<string>();
    const loc = take(src, idx, consumed, NAME_ALIASES);
    const rawName = loc && loc.value != null ? String(loc.value).trim() : '';
    if (!rawName) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '扩展档案',
        path: '扩展档案',
        raw: JSON.stringify(src).slice(0, 200),
        error: '缺少名称',
        suggestion: '补充 名称 字段',
      });
      continue;
    }
    // 实体对齐：仅在命中精确/canon/显式别名时归一，严禁低置信模糊改名吞并新扩展专名（如「铁砧矿坑」→「铁砧」）
    const name = applyAlign(rawName, ctx, `扩展档案[${rawName}]`, 'exact_or_alias');
    if (STARTER_MAIDEN_NAMES.has(name) || STARTER_MAIDEN_NAMES.has(rawName)) {
      green(ctx, {
        layer: 'L3' as unknown as ParseEvent['layer'],
        path: `扩展档案.${name}`,
        message: `[扩展档案/图鉴] 「${name}」属于已在册核心机娘，日常状态变动请走 <机娘> 标签，跳过重复建档`,
        before: rawName,
        after: name,
      });
      ctx.appliedCount++;
      continue;
    }

    // kind（科技|建筑|载具|人员|人物|装备|地点）：先确定本次输入类别，按「类别 + 名称」匹配既有条目并兼容旧无分类项
    const kindT = take(src, idx, consumed, ['类别', '类型', '种类', '分类', '归类', 'kind', 'type', 'category']);
    let incomingKind = '';
    if (kindT && kindT.value != null) {
      const r = resolveEnum(kindT.value, ENUM_EXPANSION_KIND);
      if (r.value != null) {
        if (!r.exact) {
          yellow(
            ctx,
            {
              layer: 'L2',
              path: `扩展档案[${name}].kind`,
              message: `kind 归一化 "${kindT.value}" → "${r.value}"`,
              before: kindT.value,
              after: r.value,
            },
            { rule: 'R18', target: `扩展档案[${name}].kind`, message: `kind 漂移已归一化为 "${r.value}"` },
          );
        }
        incomingKind = r.value;
      } else {
        incomingKind = String(kindT.value).trim();
      }
    } else if (NPC_TOP_LEVEL_HINT_KEYS.some(k => idx.has(canon(k)))) {
      incomingKind = '人物';
    }

    const canonName = canon(name);
    const matchesKindOrLegacy = (entryKindRaw: unknown): boolean => {
      if (!incomingKind) return true;
      const ek = typeof entryKindRaw === 'string' ? entryKindRaw.trim() : '';
      return !ek || ek === '其他' || ek === incomingKind;
    };

    const existing =
      arr.find(e => canon(String(e.name)) === canonName && String(e.kind ?? '').trim() === incomingKind) ??
      arr.find(e => canon(String(e.name)) === canonName && matchesKindOrLegacy(e.kind));
    const isPersonOrStaffKind = (k: unknown): boolean => {
      const s = typeof k === 'string' ? k.trim() : '';
      return s === '人物' || s === '人员';
    };
    const existingCodex = Array.isArray(codexArr)
      ? (codexArr.find(e => canon(String(e.name)) === canonName && String(e.kind ?? '').trim() === incomingKind) ??
        codexArr.find(
          e =>
            canon(String(e.name)) === canonName &&
            (matchesKindOrLegacy(e.kind) || (isPersonOrStaffKind(incomingKind) && isPersonOrStaffKind(e.kind))),
        ))
      : undefined;
    const target: Record<string, unknown> = existing ?? { name };
    if (!existing) target.name = name;
    if (incomingKind) {
      target.kind = incomingKind;
    } else if (!target.kind && existingCodex && typeof existingCodex.kind === 'string' && existingCodex.kind === '人物') {
      target.kind = '人物';
    }

    const expKindStr = String(target.kind ?? '');
    const isStarterHumanRoster =
      STARTER_HUMAN_ROSTER_NAMES.has(name) || STARTER_HUMAN_ROSTER_NAMES.has(rawName);
    let isStarterHumanDynamicPersonnelUpdate = false;
    if (isStarterHumanRoster && expKindStr === '人员') {
      if (!hasDynamicRelationIncrementFields(src, idx)) {
        green(ctx, {
          layer: 'L3' as unknown as ParseEvent['layer'],
          path: `扩展档案.${name}`,
          message: `[扩展档案] 「${name}」属于已在册随行人员，无实质动态关系增量，跳过按硬件兵种重复初建档案`,
          before: rawName,
          after: name,
        });
        ctx.appliedCount++;
        continue;
      }
      isStarterHumanDynamicPersonnelUpdate = true;
    }

    const expDomain: EntityDomain | null =
      isStarterHumanDynamicPersonnelUpdate
        ? null
        : expKindStr === '科技'
          ? 'research'
          : expKindStr === '建筑'
            ? 'building'
            : expKindStr === '单位' || expKindStr === '载具' || expKindStr === '人员' || expKindStr === '装备'
              ? 'production'
              : null;
    if (expDomain) {
      const { index: credIndex, snapBuildingNames } = resolveSystemCatalogCredibility(ctx);
      const isBuiltinBuildingOnly =
        expKindStr === '建筑' &&
        BUILTIN_BUILDING_NAME_SET.has(name) &&
        !snapBuildingNames.has(canon(name)) &&
        !ctx.deployIndex?.byInto(name);
      if (!isBuiltinBuildingOnly && credIndex) {
        const queryDomain: EntityDomain =
          getCredIndexDomainCount(credIndex, expDomain) > 0 ? expDomain : 'any';
        const retrofitBaseName =
          extractRetrofitBaseEntityName(name) ?? extractRetrofitBaseEntityName(rawName);
        const isExactCatalogName =
          credIndex.exactMap.has(name.trim()) || credIndex.canonMap.has(canonName);
        if (
          retrofitBaseName &&
          !isExactCatalogName &&
          isSystemCatalogEntity(credIndex, retrofitBaseName, queryDomain, 0.90)
        ) {
          const credEval = evaluateEntityCredibility(credIndex, retrofitBaseName, {
            domain: queryDomain,
            highThreshold: 0.90,
          });
          const matchedStdName = credEval.matchedName ?? retrofitBaseName;
          for (let i = arr.length - 1; i >= 0; i--) {
            const existingName = String(arr[i]?.name ?? '');
            const existingKind = String(arr[i]?.kind ?? '').trim();
            if (
              (!existingKind || existingKind === expKindStr) &&
              (canon(existingName) === canonName ||
                canon(existingName) === canon(rawName) ||
                canon(existingName) === canon(matchedStdName))
            ) {
              arr.splice(i, 1);
            }
          }
          green(ctx, {
            layer: 'L3' as unknown as ParseEvent['layer'],
            path: `扩展档案.${name}`,
            message: `[扩展档案] 「${name}」基底属于世界书既有${expKindStr}「${matchedStdName}」，局部改装请走 <数据更新>，跳过重复建档`,
            before: rawName,
            after: matchedStdName,
          });
          ctx.appliedCount++;
          continue;
        }
        if (isSystemCatalogEntity(credIndex, name, queryDomain, 0.85)) {
          const credEval = evaluateEntityCredibility(credIndex, name, {
            domain: queryDomain,
            highThreshold: 0.85,
          });
          const matchedStdName = credEval.matchedName ?? name;
          for (let i = arr.length - 1; i >= 0; i--) {
            const existingName = String(arr[i]?.name ?? '');
            const existingKind = String(arr[i]?.kind ?? '').trim();
            if (
              (!existingKind || existingKind === expKindStr) &&
              (canon(existingName) === canonName ||
                canon(existingName) === canon(rawName) ||
                canon(existingName) === canon(matchedStdName))
            ) {
              arr.splice(i, 1);
            }
          }
          green(ctx, {
            layer: 'L3' as unknown as ParseEvent['layer'],
            path: `扩展档案.${name}`,
            message: `[扩展档案] 「${name}」属于世界书既有${expKindStr}词条，跳过动态重复入档`,
            before: rawName,
            after: matchedStdName,
          });
          ctx.appliedCount++;
          continue;
        }
      }
    }

    setStr(target, 'desc', src, idx, consumed, ['简介', '描述', 'desc', '摘要'], ctx);
    setStr(target, 'detail', src, idx, consumed, ['详情', '设定', '散文', '正文', 'detail', '说明', '详细设定'], ctx);

    // params
    const mergedParams: Record<string, string> = {};
    if (existingCodex && isUsable(existingCodex.params) && !Array.isArray(existingCodex.params)) {
      for (const [k, v] of Object.entries(existingCodex.params as Record<string, unknown>)) {
        if (v != null && String(v).trim() !== '') mergedParams[k] = String(v);
      }
    }
    if (isUsable(target.params) && !Array.isArray(target.params)) {
      for (const [k, v] of Object.entries(target.params as Record<string, unknown>)) {
        if (v != null && String(v).trim() !== '') mergedParams[k] = String(v);
      }
    }
    const pT = take(src, idx, consumed, ['参数', 'params']);
    if (pT && isUsable(pT.value) && !Array.isArray(pT.value)) {
      for (const [k, v] of Object.entries(pT.value as Record<string, unknown>)) {
        if (v != null) mergedParams[k] = String(v);
      }
      ctx.appliedCount++;
    }

    // FD-32：人物分支（类别: 人物）或开局随行人员动态关系更新支持顶层或 params 内的立体设定与动态关系追踪
    if (expKindStr === '人物' || isStarterHumanDynamicPersonnelUpdate) {
      const prevTrustRaw =
        (isUsable(target.params) && !Array.isArray(target.params)
          ? (target.params as Record<string, unknown>)['信任度']
          : undefined) ??
        (existingCodex && isUsable(existingCodex.params) && !Array.isArray(existingCodex.params)
          ? (existingCodex.params as Record<string, unknown>)['信任度']
          : undefined);
      const prevTrustNum = toNum(prevTrustRaw);
      const baseTrust = prevTrustNum != null && Number.isFinite(prevTrustNum) ? prevTrustNum : 50;

      const takeNpcStr = (targetKey: string, aliases: string[]) => {
        const t = take(src, idx, consumed, aliases);
        if (t && t.value != null && String(t.value).trim() !== '') {
          mergedParams[targetKey] = String(t.value).trim();
          ctx.appliedCount++;
        } else {
          for (const alias of aliases) {
            if (alias !== targetKey && mergedParams[alias] !== undefined) {
              if (!mergedParams[targetKey]) mergedParams[targetKey] = mergedParams[alias];
              delete mergedParams[alias];
            }
          }
        }
      };

      takeNpcStr('代号', ['代号', '头衔', '称号', '绰号', 'callsign', 'title']);
      takeNpcStr('所属势力', ['所属势力', '势力', '阵营', '所属阵营', 'faction']);
      takeNpcStr('身份', ['身份', '职务', '职位', '开局职务', '席位任命', 'role', 'duty']);
      takeNpcStr('外貌特征', ['外貌特征', '外貌', '外观', '着装', '外貌着装', 'appearance']);
      takeNpcStr('性格与口吻', ['性格与口吻', '性格', '口吻', '言行特征', 'personality']);
      takeNpcStr('能力', ['能力', '专长', '技能', '特长', 'skills']);
      takeNpcStr('背景', ['背景', '履历', '渊源', '随行渊源', '背景履历', 'background']);
      takeNpcStr('状态', ['状态', '当前状态', '驻地', '所在地', '动向', 'status', 'location']);
      takeNpcStr('近期交集', ['近期交集', '事迹', '备注', '近期动向', 'recent_note']);

      const attT = take(src, idx, consumed, ['态度', '立场', '关系', '倾向', 'attitude']);
      const rawAtt =
        attT && attT.value != null
          ? String(attT.value).trim()
          : (mergedParams['态度'] ?? mergedParams['立场'] ?? mergedParams['关系'] ?? '');
      if (rawAtt) {
        mergedParams['态度'] = normalizeNpcAttitude(rawAtt);
        delete mergedParams['立场'];
        delete mergedParams['关系'];
        if (attT) ctx.appliedCount++;
      }

      const trustT = take(src, idx, consumed, ['信任度', '好感', '好感度', '信任', 'trust']);
      const deltaFromTake = takeDelta(src, idx, consumed, ['信任', '信任度', '好感', '好感度', 'trust', 'affection']);
      const explicitDeltaT =
        deltaFromTake == null
          ? take(src, idx, consumed, ['信任变化', '好感变化', '信任增量', '好感增量', 'trust_delta', 'affection_delta'])
          : null;
      const rawDeltaVal =
        deltaFromTake != null
          ? deltaFromTake
          : explicitDeltaT && explicitDeltaT.value != null
            ? toNum(explicitDeltaT.value)
            : mergedParams['信任变化'] !== undefined
              ? toNum(mergedParams['信任变化'])
              : null;

      let clampedDelta: number | null = null;
      if (rawDeltaVal != null && Number.isFinite(rawDeltaVal)) {
        clampedDelta = Math.max(-25, Math.min(25, Math.round(rawDeltaVal)));
        if (clampedDelta !== Math.round(rawDeltaVal)) {
          yellow(
            ctx,
            {
              layer: 'L2',
              path: `扩展档案[${name}].信任变化`,
              message: `人物「${name}」单次信任变化 ${rawDeltaVal} 超出 [-25, +25]，已钳制为 ${clampedDelta}`,
              before: rawDeltaVal,
              after: clampedDelta,
            },
            { rule: 'R18', target: `扩展档案[${name}].信任变化`, message: `信任变化超限已钳制为 ${clampedDelta}` },
          );
        }
        mergedParams['信任变化'] = clampedDelta >= 0 ? `+${clampedDelta}` : `${clampedDelta}`;
        ctx.appliedCount++;
      }

      const explicitTrustNum = trustT && trustT.value != null ? toNum(trustT.value) : null;
      if (explicitTrustNum != null && Number.isFinite(explicitTrustNum)) {
        const finalTrust = Math.max(0, Math.min(100, Math.round(explicitTrustNum)));
        mergedParams['信任度'] = String(finalTrust);
        ctx.appliedCount++;
      } else if (clampedDelta != null) {
        const finalTrust = Math.max(0, Math.min(100, Math.round(baseTrust + clampedDelta)));
        mergedParams['信任度'] = String(finalTrust);
      } else if (mergedParams['信任度'] !== undefined) {
        const parsedParamTrust = toNum(mergedParams['信任度']);
        if (parsedParamTrust != null && Number.isFinite(parsedParamTrust)) {
          mergedParams['信任度'] = String(Math.max(0, Math.min(100, Math.round(parsedParamTrust))));
        }
      }
    } else if (expKindStr === '势力') {
      // BUG-R2-25：势力/组织/财团/派系/企业 分类支持顶层补充属性自动收拢进 params 零隔离
      const takeFactionStr = (targetKey: string, aliases: string[]) => {
        const t = take(src, idx, consumed, aliases);
        if (t && t.value != null && String(t.value).trim() !== '') {
          mergedParams[targetKey] = String(t.value).trim();
          ctx.appliedCount++;
        } else {
          for (const alias of aliases) {
            if (alias !== targetKey && mergedParams[alias] !== undefined) {
              if (!mergedParams[targetKey]) mergedParams[targetKey] = mergedParams[alias];
              delete mergedParams[alias];
            }
          }
        }
      };

      takeFactionStr('所属阵营', ['所属阵营', '阵营', '派系', '上属势力', '所属势力', 'faction']);
      takeFactionStr('首领', ['首领', '领袖', '负责人', '掌权者', '代表人物', '统帅', '会长', 'leader', 'head']);
      takeFactionStr('总部', ['总部', '驻地', '据点', '活动区域', '地盘', '所在地', '位置', 'location', 'base', 'hq']);
      takeFactionStr('规模', ['规模', '实力', '兵力', '体量', '编制', 'scale', 'strength']);
      takeFactionStr('情报', ['情报', '认知', '动向', '近期动向', '背景', '备注', 'intel', 'background', 'note']);
      takeFactionStr('风险', ['风险', '威胁', '危险度', '威胁等级', 'risk', 'threat']);
      takeFactionStr('状态', ['状态', '当前状态', 'status']);
      takeFactionStr('代号', ['代号', '简称', '缩写', 'callsign', 'code']);

      const attT = take(src, idx, consumed, ['态度', '立场', '关系', '倾向', 'attitude']);
      const rawAtt =
        attT && attT.value != null
          ? String(attT.value).trim()
          : (mergedParams['态度'] ?? mergedParams['立场'] ?? mergedParams['关系'] ?? '');
      if (rawAtt) {
        mergedParams['态度'] = normalizeNpcAttitude(rawAtt);
        delete mergedParams['立场'];
        delete mergedParams['关系'];
        if (attT) ctx.appliedCount++;
      }
    } else if (
      expKindStr === '科技' ||
      expKindStr === '建筑' ||
      expKindStr === '载具' ||
      expKindStr === '人员' ||
      expKindStr === '装备'
    ) {
      // 科技 / 建筑 / 载具 / 人员 / 装备：支持顶层直接平铺结构化机制参数并自动收拢进 params 零隔离，供 expansionFiler 自动合成标准 <数据> 块
      const takeHwParam = (targetKey: string, aliases: string[]) => {
        const t = take(src, idx, consumed, aliases);
        if (t && t.value != null) {
          const valStr = Array.isArray(t.value)
            ? t.value
                .map(v => (isUsable(v) ? String((v as Record<string, unknown>).name ?? (v as Record<string, unknown>).名称 ?? '') : String(v ?? '')))
                .map(s => s.trim())
                .filter(Boolean)
                .join('、')
            : String(t.value).trim();
          if (valStr !== '') {
            mergedParams[targetKey] = valStr;
            ctx.appliedCount++;
          }
        }
      };

      takeHwParam('造价', ['造价', '研发费用', '建造费用', '生产费用', '列装费用', '费用', '经费', 'cost', 'price']);
      takeHwParam('工期', ['工期', '研发周期', '建造周期', '生产周期', '训练周期', '周期', '耗时', '预计', 'eta', 'duration']);
      takeHwParam('耗电', ['耗电', '电力', '电网负载', '负载', '发电', 'power']);
      takeHwParam('科技层级', ['科技层级', '层级', '阶级', '代数', 'tier', 'tech_level']);
      takeHwParam('所属阵营', ['所属阵营', '阵营', '派系', '阵营归属', 'faction']);
      takeHwParam('研究线', ['研究线', '分支', '路线', '学科', 'line']);
      takeHwParam('职能分类', ['职能分类', '体系', '系统分类', 'system']);
      takeHwParam('子类别', ['子类别', '载具类型', '底盘类型', '兵种分类']);
      takeHwParam(expKindStr === '科技' || expKindStr === '建筑' ? '所需建筑' : '生产建筑', [
        '生产建筑',
        '产出建筑',
        '制造厂',
        '母厂',
        '所需建筑',
        '前置建筑',
        '研发建筑',
        '实验设施',
        '依赖建筑',
        'need_building',
        'need_buildings',
        'producer',
        'building_prereq',
      ]);
      takeHwParam('前置科技', [
        '前置科技',
        '依赖科技',
        '科技前置',
        '研发前置',
        'prereqs',
        'prerequisites',
        'tech_prereq',
        'research',
      ]);
      takeHwParam('前置', ['前置', '前置条件', '解锁条件', 'prereq']);
      takeHwParam('解锁产物', ['解锁产物', '解锁', '研发成果', '衍生解锁', '产物', '解锁单位', '解锁建筑', 'unlocks']);
      takeHwParam('数量上限', ['数量上限', '限编', '编制上限', 'max_count']);
      takeHwParam('主武器', ['主武器', '主武装', '主要武器', 'main_weapon']);
      takeHwParam('副武器', ['副武器', '副武装', '辅助武器', '随身武备', 'sub_weapon']);
      takeHwParam('武器配置', ['武器配置', '武器', '武装', '武备', 'weapons']);
      takeHwParam('战术特长', ['战术特长', '技能', '特长', '能力', '被动技能', '主动技能', '专长', 'skills']);
    }

    if (Object.keys(mergedParams).length > 0) {
      target.params = mergedParams;
    }

    // keys
    const kT = take(src, idx, consumed, ['触发词', '关键词', 'keys']);
    if (kT && kT.value != null) {
      const ks = Array.isArray(kT.value)
        ? kT.value.map(v => String(v).trim()).filter(Boolean)
        : String(kT.value)
            .split(/[,，、;；]/)
            .map(s => s.trim())
            .filter(Boolean);
      if (ks.length) {
        target.keys = [...new Set(ks)];
        ctx.appliedCount++;
      }
    }
    if (expKindStr === '人物' && mergedParams['代号']) {
      const curKeys = Array.isArray(target.keys) ? (target.keys as string[]) : [];
      if (!curKeys.includes(mergedParams['代号'])) {
        target.keys = [...new Set([...curKeys, mergedParams['代号']])];
      }
    }

    // data (可选结构化 <数据> 块载荷)
    const dataT = take(src, idx, consumed, ['数据', 'data', '载荷', 'payload']);
    if (dataT && isUsable(dataT.value) && !Array.isArray(dataT.value)) {
      target.data = dataT.value as Record<string, unknown>;
      ctx.appliedCount++;
    }

    quarantineLeftovers(src, consumed, ctx, `扩展档案[${name}]`);

    if (isStarterHumanDynamicPersonnelUpdate) {
      ctx.appliedCount++;
    } else if (existing) {
      ctx.appliedCount++;
    } else {
      const parsed = ExpansionDossier.safeParse(target);
      if (!parsed.success) {
        ctx.quarantine.push({
          scope: 'element',
          tag: '扩展档案',
          path: `扩展档案[${name}]`,
          raw: JSON.stringify(src).slice(0, 200),
          error: '新扩展档案未通过校验',
          suggestion: parsed.error.issues.map(i => i.message).join('; '),
        });
        continue;
      }
      arr.push(parsed.data as Record<string, unknown>);
      ctx.appliedCount++;
    }

    // FD-32：当为 类别: 人物（或开局随行人员动态关系增量更新）时，同步 upsert 至 stat_data.codex，确保 PDA 与中控台即时读取最新人物状态与信任度
    if ((expKindStr === '人物' || isStarterHumanDynamicPersonnelUpdate) && Array.isArray(codexArr)) {
      const descStr =
        typeof target.desc === 'string' && target.desc.trim()
          ? target.desc.trim()
          : typeof target.detail === 'string' && target.detail.trim()
            ? target.detail.trim().split('\n')[0].slice(0, 100)
            : `人物·${name}`;
      if (existingCodex) {
        if (expKindStr === '人物') {
          existingCodex.kind = '人物';
        }
        if (typeof target.desc === 'string' && target.desc.trim()) {
          existingCodex.desc = target.desc.trim();
        } else if (!existingCodex.desc) {
          existingCodex.desc = descStr;
        }
        existingCodex.params = { ...(isUsable(existingCodex.params) ? (existingCodex.params as Record<string, string>) : {}), ...mergedParams };
      } else {
        codexArr.push({
          name,
          kind: expKindStr === '人物' ? '人物' : '人员',
          desc: descStr,
          params: { ...mergedParams },
        });
      }
    }
  }
}

/**
 * 跨标签兜底桥接：当本轮 `pending_expansions` 中有新入列的科技/建筑/载具/人员/装备，
 * 若 LLM 在 `<扩展档案>` 中漏填了 `工期`（eta），但同轮 `queues` 队列中已有同名在研/在建/在产项目的 `eta`，
 * 自动将 `eta` 兜底补齐至 `exp.params['工期']`，确保落盘 `<数据>` 块字段完备。
 */
export function bridgeExpansionParamsFromQueues(
  pendingExpansions: Record<string, unknown>[],
  queues: Record<string, unknown>[],
): void {
  if (!Array.isArray(pendingExpansions) || pendingExpansions.length === 0) return;
  if (!Array.isArray(queues) || queues.length === 0) return;

  for (const exp of pendingExpansions) {
    if (!isUsable(exp) || Array.isArray(exp)) continue;
    const kindStr = String(exp.kind ?? '').trim();
    if (
      kindStr !== '科技' &&
      kindStr !== '建筑' &&
      kindStr !== '载具' &&
      kindStr !== '人员' &&
      kindStr !== '装备'
    ) {
      continue;
    }
    const expName = String(exp.name ?? '').trim();
    if (!expName) continue;

    const params: Record<string, string> =
      isUsable(exp.params) && !Array.isArray(exp.params)
        ? { ...(exp.params as Record<string, string>) }
        : {};
    const hasEta = Boolean(
      params['工期'] || params['研发周期'] || params['建造周期'] || params['生产周期'] || params['周期'] || params['耗时'] || params['预计'] || params['eta'],
    );
    if (!hasEta) {
      const matchedQueue = queues.find(q => isUsable(q) && canon(String(q.item ?? '')) === canon(expName));
      const queueEta = matchedQueue && typeof matchedQueue.eta === 'string' ? matchedQueue.eta.trim() : '';
      if (queueEta) {
        params['工期'] = queueEta;
        exp.params = params;
      }
    }
  }
}

/** 队列元素映射（定位键：项目 item） */
export function mapQueue(
  target: Record<string, unknown>,
  src: Record<string, unknown>,
  idx: Map<string, string>,
  consumed: Set<string>,
  _isNew: boolean,
  path: string,
  ctx: Ctx,
): void {
  setStr(target, 'item', src, idx, consumed, ['项目', 'item', '名称'], ctx);
  setEnumField(target, 'type', src, idx, consumed, ['类型', 'type'], ENUM_QUEUE_TYPE, ctx, path);
  setStr(target, 'base', src, idx, consumed, ['基地', 'base'], ctx);
  setNumField(target, 'progress', src, idx, consumed, ['进度', 'progress'], ctx, path, { min: 0, max: 100 });
  setStr(target, 'eta', src, idx, consumed, ['预计', 'eta'], ctx);
  const qtyT = take(src, idx, consumed, ['数量', '批量', '件数', '台数', '人数', 'qty']);
  if (qtyT !== null) {
    const rawVal = qtyT.value;
    const unitMatch =
      typeof rawVal === 'string'
        ? rawVal.trim().match(/^(-?\d+(?:\.\d+)?)\s*(?:人|名|员|台|辆|架|艘|门|座|挺|具|发|枚|套|件|批|个|项)?$/)
        : null;
    const parsedNum = unitMatch ? Number(unitMatch[1]) : toNum(rawVal);
    if (parsedNum != null && Number.isFinite(parsedNum) && parsedNum >= 1 && Number.isInteger(parsedNum)) {
      target.qty = parsedNum;
      ctx.appliedCount++;
    } else {
      const fallback =
        parsedNum != null && Number.isFinite(parsedNum) && parsedNum >= 1 ? Math.max(1, Math.floor(parsedNum)) : 1;
      target.qty = fallback;
      yellow(
        ctx,
        { layer: 'merge', path: `${path}.qty`, message: `队列数量 "${rawVal}" 非正整数，已回退为 ${fallback}` },
        { rule: 'R18', target: `${path}.qty`, message: `队列数量回退为 ${fallback}` },
      );
      ctx.appliedCount++;
    }
  }
}

export const NAME_ALIASES = ['名称', '名字', '姓名', 'name', '名'];
const GIRL_DUTY_ALIASES = ['职责', '职务', '任务', '兵种', '定位', '职阶', '专精', 'duty', 'role'];
const GIRL_HP_ALIASES = ['状态', '伤势', '机体状态', '生命', '生命值', '损伤', '血量', 'hp'];
const GIRL_BASE_ALIASES = ['驻地', '基地', '所属基地', '所在基地', '阵位', '岗位', 'base', 'location'];
const GIRL_SERIAL_ALIASES = ['编号', '出厂编号', '工程编号', '机体编号', '出厂钢印', 'serial', 'unit_no'];
const GIRL_CALLSIGN_ALIASES = [
  '代号',
  '专属代号',
  '真名',
  '赐名',
  '战术代号',
  '呼号',
  '正式代号',
  'callsign',
  'code_name',
  'codename',
];
const GIRL_RENAME_FROM_ALIASES = ['原名', '旧名', '赐名前', '前称', '原编号', '旧标识', 'rename_from', 'old_name'];
const GIRL_MODEL_ALIASES = ['型号', '机体型号', '原型', '本体型号', '首台身份', '原型型号', 'model', 'prototype'];
const GIRL_SEQ_ALIASES = ['序列', '代次', '批次', '机体序列', '台次', 'seq', 'unit_seq', 'generation'];
const GIRL_FACTION_ALIASES = ['阵营', '所属阵营', '派系', 'faction'];
const GIRL_BODY_ALIASES = [
  '躯体特征',
  '躯体',
  '身子',
  '体态',
  '体态特征',
  '生理特征',
  '纳米躯体',
  '身高体态',
  'body',
  'physique',
];
const GIRL_PERSONALITY_ALIASES = [
  '性格',
  '基础性格',
  '初生性格',
  '心智',
  '心智特征',
  '心智性格',
  '性格特征',
  '性格描述',
  '性格侧写',
  '性格作风',
  'personality',
];
const GIRL_APPEARANCE_ALIASES = [
  '外观',
  '外貌',
  '外在着装',
  '着装',
  '服饰',
  '衣装',
  '装束',
  '形象',
  '外貌特征',
  '外观着装',
  '外表',
  'appearance',
];
const GIRL_SHELL_ALIASES = ['社会外壳', '身份外壳', '对外身份', '外壳', '身份', '掩护身份', '伪装身份', 'shell'];
const GIRL_ALIAS_ALIASES = ['化名', '对外化名', '对外代号', '假名', '人间名', '伪名', 'alias'];
const GIRL_STATUS_ALIASES = [
  '当前状态',
  '现状',
  '现状备注',
  '状态备注',
  '备注',
  '心境',
  '近况',
  '背景',
  '来历',
  '履历',
  '工况',
  'status',
  'background',
];
const GIRL_STAGE_ALIASES = ['阶段', '档案阶段', '归档状态', '授名阶段', '命名阶段', '授名状态', '命名状态', 'stage'];
const GIRL_AFFECTION_ALIASES = ['好感', '好感度', 'affection'];
const GIRL_AFFECTION_DELTA_ALIASES = ['好感变化', '好感度变化', 'affection_delta', 'affectiondelta'];
const GIRL_OBEDIENCE_ALIASES = ['服从', '服从度', 'obedience'];
const GIRL_OBEDIENCE_DELTA_ALIASES = ['服从变化', '服从度变化', 'obedience_delta', 'obediencedelta'];
const GIRL_EXPOSURE_ALIASES = ['暴露状态', '暴露度', '暴露分档', '暴露等级', '暴露代价', '暴露', 'exposure', 'exposure_grade'];
const GIRL_TRAITS_ALIASES = [
  '特征标签',
  '能力特征',
  '核心特征',
  '战术特质',
  '标签',
  '特质',
  '技能',
  '技能列表',
  '能力',
  '专长',
  '专属能力',
  '核心能力',
  '特殊技能',
  '专属技能',
  '词条',
  'traits',
  'tags',
  'skills',
  'special_skills',
];
const GIRL_EXTRA_DOSSIER_PASSTHROUGH_ALIASES = [
  '武器',
  '武装',
  'weapons',
  'special_equipment',
  '特殊装备',
  '专属装备',
  '挂载装备',
  '结构短板',
  '结构性短板',
  '短板',
  'flaws',
  '形态机制',
  'form_mech',
  '机魂光谱',
  '性格光谱',
  'temperament_spectrum',
  '阶位',
  '科技层级',
  '等级',
  'tier',
  '触发词',
  '关键词',
  'keys',
  '平衡位置',
  '平衡总纲位置',
  'balance',
  'balance_slot',
  '档案正文',
  '三段式正文',
  '正文',
  'prose',
];

function parseGirlTraits(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const items: string[] = [];
    for (const elem of raw) {
      if (elem && typeof elem === 'object' && !Array.isArray(elem)) {
        const obj = elem as Record<string, unknown>;
        const sName = String(obj.name ?? obj.名称 ?? obj.技能名 ?? obj.专名 ?? '').trim();
        if (sName) items.push(sName);
      } else {
        const s = String(elem ?? '').trim();
        if (s) items.push(s);
      }
    }
    return [...new Set(items)];
  }
  const parsed = String(raw ?? '')
    .replace(/^\[|\]$/g, '')
    .split(/[,，、;；\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
  return [...new Set(parsed)];
}

const ALL_KNOWN_GIRL_FIELD_CANONS = new Set(
  [
    ...NAME_ALIASES,
    ...GIRL_DUTY_ALIASES,
    ...GIRL_HP_ALIASES,
    ...GIRL_BASE_ALIASES,
    ...GIRL_SERIAL_ALIASES,
    ...GIRL_CALLSIGN_ALIASES,
    ...GIRL_RENAME_FROM_ALIASES,
    ...GIRL_MODEL_ALIASES,
    ...GIRL_SEQ_ALIASES,
    ...GIRL_FACTION_ALIASES,
    ...GIRL_BODY_ALIASES,
    ...GIRL_PERSONALITY_ALIASES,
    ...GIRL_APPEARANCE_ALIASES,
    ...GIRL_SHELL_ALIASES,
    ...GIRL_ALIAS_ALIASES,
    ...GIRL_STATUS_ALIASES,
    ...GIRL_STAGE_ALIASES,
    ...GIRL_AFFECTION_ALIASES,
    ...GIRL_AFFECTION_DELTA_ALIASES,
    ...GIRL_OBEDIENCE_ALIASES,
    ...GIRL_OBEDIENCE_DELTA_ALIASES,
    ...GIRL_EXPOSURE_ALIASES,
    ...GIRL_TRAITS_ALIASES,
    ...GIRL_EXTRA_DOSSIER_PASSTHROUGH_ALIASES,
  ].map(a => canon(a)),
);

function isUnchristenedGirlName(raw: unknown): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return true;
  return (
    s.includes('待授名') ||
    s.includes('未授名') ||
    s.includes('待命名') ||
    s.includes('未命名') ||
    s.includes('待赐名') ||
    s.includes('候选') ||
    s.toLowerCase() === 'pending' ||
    s.toLowerCase() === 'unchristened'
  );
}

export function isPendingUnchristenedGirl(g: Record<string, unknown>): boolean {
  const name = String(g.name ?? '').trim();
  const callsign = String(g.callsign ?? '').trim();
  const serial = String(g.serial ?? '').trim();
  const model = String(g.model ?? '').trim();
  const status = String(g.status ?? '').trim();
  if (status && isUnchristenedGirlName(status)) {
    if (!callsign || isUnchristenedGirlName(callsign)) return true;
  }
  if (callsign && !isUnchristenedGirlName(callsign)) return false;
  if (isUnchristenedGirlName(name)) return true;
  if (serial && canon(name) === canon(serial)) return true;
  if (model && canon(name) === canon(model)) return true;
  return false;
}

/**
 * 幂等同步待授名机娘至 data.pending_girls（BUG-LIVE-18b）：
 * 当 <机娘档案> / <机娘> / <态势>.部队.机娘 声明了阶段=待命名或名称含待授名/仅有编号的初诞机娘时，
 * 按 PendingGirlSchema 同步推入 data.pending_girls；当后续赐名转正（callsign/name 非空且不含待授名）时自动核销移除。
 */
export function syncPendingGirls(data: StatData): void {
  const girls = (data.forces as unknown as Record<string, unknown>)?.girls;
  if (!Array.isArray(girls)) return;
  const nextPending = girls
    .filter(g => isUsable(g) && !Array.isArray(g) && isPendingUnchristenedGirl(g as Record<string, unknown>))
    .map(g => {
      const rec = g as Record<string, unknown>;
      const statusStr = String(rec.status ?? '').trim();
      return PendingGirlSchema.parse({
        ...rec,
        stage: isUnchristenedGirlName(statusStr) && statusStr ? statusStr : '待命名',
      });
    });
  if (nextPending.length > 0 || Array.isArray(data.pending_girls)) {
    data.pending_girls = nextPending;
  }
}

function peekFieldStr(obj: Record<string, unknown>, idx: Map<string, string>, aliases: string[]): string {
  for (const a of aliases) {
    const c = canon(a);
    if (idx.has(c)) {
      const k = idx.get(c)!;
      const val = obj[k];
      if (val != null) {
        const s = String(val).trim();
        if (s) return s;
      }
    }
  }
  return '';
}

function normalizeGirlInputItems(items: unknown): unknown[] {
  if (Array.isArray(items)) return items;
  if (items == null) return [];
  if (!isUsable(items)) return [items];
  const obj = items as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return [];
  const hasKnownGirlKey = keys.some(k => ALL_KNOWN_GIRL_FIELD_CANONS.has(canon(k)));
  if (!hasKnownGirlKey && keys.every(k => isUsable(obj[k]) && !Array.isArray(obj[k]))) {
    return keys.map(k => ({
      名称: k,
      ...(obj[k] as Record<string, unknown>),
    }));
  }
  return [obj];
}

/**
 * 机娘编制与心智状态 upsert（MAIDEN-CORE-01）：
 * 统一承载 <机娘> 顶层块、<战况> 部队.机娘 与 <机娘档案> 自动同步，
 * 支持单对象 / 数组 / 键值字典，以及按 rename_from -> serial -> callsign -> name/model 四级认亲原地更名。
 */
export function upsertGirls(arr: Record<string, unknown>[], items: unknown, ctx: Ctx, label = '机娘'): void {
  for (const rawItem of normalizeGirlInputItems(items)) {
    if (!isUsable(rawItem) || Array.isArray(rawItem)) {
      ctx.quarantine.push({
        scope: 'element',
        tag: label,
        path: label,
        raw: JSON.stringify(rawItem),
        error: '数组元素非对象',
      });
      continue;
    }
    const src = rawItem as Record<string, unknown>;
    const idx = keyIndex(src);
    const consumed = new Set<string>();

    const loc = take(src, idx, consumed, NAME_ALIASES);
    const rawLocStr = loc && loc.value != null ? String(loc.value).trim() : '';
    const rawCallsign = peekFieldStr(src, idx, GIRL_CALLSIGN_ALIASES);
    const rawSerial = peekFieldStr(src, idx, GIRL_SERIAL_ALIASES);
    const rawRenameFrom = peekFieldStr(src, idx, GIRL_RENAME_FROM_ALIASES);
    const rawModel = peekFieldStr(src, idx, GIRL_MODEL_ALIASES);

    const rawName = rawLocStr || rawCallsign || (rawSerial ? `待授名·${rawSerial}` : '');
    if (!rawName) {
      ctx.quarantine.push({
        scope: 'element',
        tag: label,
        path: label,
        raw: JSON.stringify(src),
        error: `缺少定位键(${NAME_ALIASES[0]})`,
        suggestion: `补充 ${NAME_ALIASES[0]} 字段`,
      });
      continue;
    }

    const name = isUnchristenedGirlName(rawName)
      ? rawName
      : applyAlign(rawName, ctx, `${label}[${rawName}]`, 'entity');

    // 四级原地认亲匹配优先级（防待授名幽灵记录）
    let existing: Record<string, unknown> | undefined;

    // ① rename_from 匹配既有 girl.name 或 girl.serial
    if (rawRenameFrom) {
      const cFrom = canon(rawRenameFrom);
      const cSer = canon(rawSerial);
      const candidates = arr.filter(
        g => canon(g.name) === cFrom || (Boolean(g.serial) && canon(g.serial) === cFrom),
      );
      if (candidates.length > 1 && cSer) {
        existing = candidates.find(g => canon(g.serial) === cSer) ?? candidates[0];
      } else {
        existing = candidates[0];
      }
    }

    // ② 非空 serial 匹配既有 girl.serial 或 girl.name 或 '待授名·' + serial
    if (!existing && rawSerial) {
      const cSer = canon(rawSerial);
      const cPendingSer = canon(`待授名·${rawSerial}`);
      existing = arr.find(
        g =>
          (Boolean(g.serial) && canon(g.serial) === cSer) ||
          canon(g.name) === cSer ||
          canon(g.name) === cPendingSer,
      );
    }

    // ③ 非空 callsign 匹配既有 girl.callsign 或 girl.name
    if (!existing && rawCallsign) {
      const cCall = canon(rawCallsign);
      existing = arr.find(
        g => (Boolean(g.callsign) && canon(g.callsign) === cCall) || canon(g.name) === cCall,
      );
    }

    // ④ canon(name) 匹配；若未命中且新输入带明确 model 与正式名字，而库中恰好只有 1 条同 model 待授名记录，则认亲该记录
    if (!existing) {
      const cName = canon(name);
      existing = arr.find(g => canon(g.name) === cName);
      if (!existing && rawModel && !isUnchristenedGirlName(name)) {
        const cModel = canon(rawModel);
        const pendingSameModel = arr.filter(
          g => Boolean(g.model) && canon(g.model) === cModel && isUnchristenedGirlName(g.name),
        );
        if (pendingSameModel.length === 1) {
          existing = pendingSameModel[0];
        }
      }
    }

    const formalName = !isUnchristenedGirlName(name)
      ? name
      : !isUnchristenedGirlName(rawCallsign)
        ? applyAlign(rawCallsign, ctx, `${label}[${rawCallsign}]`, 'entity')
        : '';

    const hadExplicitTraits = GIRL_TRAITS_ALIASES.some(a => idx.has(canon(a)));

    if (existing) {
      const wasUnchristened = isUnchristenedGirlName(existing.name);
      const prevName = String(existing.name ?? '');
      const elemLabel = `${label}[${formalName || name}]`;
      mapGirl(existing, src, idx, consumed, false, elemLabel, ctx);
      if (formalName) {
        existing.name = formalName;
        if (rawCallsign && !isUnchristenedGirlName(rawCallsign)) {
          existing.callsign = rawCallsign;
        } else if (wasUnchristened && (!existing.callsign || isUnchristenedGirlName(existing.callsign))) {
          existing.callsign = formalName;
        }
        const hadExplicitStatus = [...GIRL_STATUS_ALIASES, ...GIRL_STAGE_ALIASES, ...GIRL_HP_ALIASES].some(a =>
          idx.has(canon(a)),
        );
        if (wasUnchristened && !hadExplicitStatus && isUnchristenedGirlName(existing.status)) {
          existing.status = '';
        }
        if (wasUnchristened && !hadExplicitTraits && Array.isArray(existing.traits)) {
          existing.traits = (existing.traits as unknown[]).filter(t => !isUnchristenedGirlName(t));
        }
      } else if (!wasUnchristened && isUnchristenedGirlName(name)) {
        existing.name = prevName;
      } else {
        existing.name = name;
      }
      quarantineLeftovers(src, consumed, ctx, `${label}[${String(existing.name)}]`);
      ctx.appliedCount++;
    } else {
      const initName = formalName || name;
      const elem: Record<string, unknown> = {
        name: initName,
        duty: '',
        hp: '完好',
        base: '',
        serial: '',
        callsign: '',
        model: '',
        seq: '',
        faction: '',
        body: '',
        personality: '',
        appearance: '',
        shell: '',
        alias: '',
        status: '',
        affection: 50,
        obedience: 50,
        traits: [],
      };
      mapGirl(elem, src, idx, consumed, true, `${label}[${initName}]`, ctx);
      elem.name = formalName || name;
      const parsed = Girl.safeParse(elem);
      if (!parsed.success) {
        ctx.quarantine.push({
          scope: 'element',
          tag: label,
          path: `${label}[${initName}]`,
          raw: JSON.stringify(src),
          error: '新元素未通过 schema 校验',
          suggestion: parsed.error.issues.map(i => i.message).join('; '),
        });
        continue;
      }
      arr.push(parsed.data as Record<string, unknown>);
      quarantineLeftovers(src, consumed, ctx, `${label}[${initName}]`);
      ctx.appliedCount++;
    }
  }

  // 同名/同编号机娘防分身归并：若因早期未授名壳记录与正式建档记录先后改名导致出现多条同名机娘，自动合并非空字段
  for (let i = 0; i < arr.length; i++) {
    const primary = arr[i];
    const cName = canon(primary.name);
    if (!cName || isUnchristenedGirlName(primary.name)) continue;
    for (let j = arr.length - 1; j > i; j--) {
      const dup = arr[j];
      if (canon(dup.name) !== cName) continue;
      for (const [k, v] of Object.entries(dup)) {
        if (k === 'traits' && Array.isArray(v)) {
          const curTraits = Array.isArray(primary.traits) ? (primary.traits as string[]) : [];
          primary.traits = [...new Set([...curTraits, ...v.map(x => String(x))])];
        } else if (typeof v === 'string' && v.trim()) {
          primary[k] = v;
        } else if (typeof v === 'number' && (k === 'affection' || k === 'obedience') && v !== 50) {
          primary[k] = v;
        }
      }
      arr.splice(j, 1);
    }
  }
}

export const mergeGirls = upsertGirls;

const GIRL_TRANSIENT_INJURY_STATUS_RE =
  /^(?:重伤|重损|损毁|被毁|摧毁|瘫痪|离线|修复中|维修中|维护中|整备中|抢修中|医疗舱|休整|治疗中|康复中|完好|健康|良好|满血|正常|轻伤|微伤|轻损|轻度受损)$/i;

/** 机娘元素映射 */
export function mapGirl(
  target: Record<string, unknown>,
  src: Record<string, unknown>,
  idx: Map<string, string>,
  consumed: Set<string>,
  _isNew: boolean,
  path: string,
  ctx: Ctx,
): void {
  setStr(target, 'name', src, idx, consumed, NAME_ALIASES, ctx);
  // 消费 rename_from 别名，避免进 quarantineLeftovers
  take(src, idx, consumed, GIRL_RENAME_FROM_ALIASES);
  setStr(target, 'duty', src, idx, consumed, GIRL_DUTY_ALIASES, ctx);

  // hp 与 status 智能分流：若「状态」写的是非 HP 枚举（如 "待授名" 或长句剧情描述），不报错丢弃，转存为 status 并保持 hp
  let fallbackStatusFromHp = '';
  let explicitHpUpdated = false;
  for (const a of GIRL_HP_ALIASES) {
    const c = canon(a);
    if (idx.has(c)) {
      const k = idx.get(c)!;
      if (consumed.has(k)) continue;
      consumed.add(k);
      const rawVal = src[k];
      const r = resolveEnum(rawVal, ENUM_GIRL_HP);
      if (r.value != null) {
        if (!r.exact) {
          yellow(
            ctx,
            {
              layer: 'L2',
              path: `${path}.hp`,
              message: `枚举值归一化 "${rawVal}" → "${r.value}"`,
              before: rawVal,
              after: r.value,
            },
            { rule: 'R18', target: `${path}.hp`, message: `枚举值漂移已归一化为 "${r.value}"` },
          );
        }
        target.hp = r.value;
        explicitHpUpdated = true;
        ctx.appliedCount++;
      } else {
        const text = String(rawVal ?? '').trim();
        if (text) fallbackStatusFromHp = text;
        if (!target.hp) target.hp = '完好';
        ctx.appliedCount++;
      }
    }
  }

  setStr(target, 'base', src, idx, consumed, GIRL_BASE_ALIASES, ctx);
  setStr(target, 'serial', src, idx, consumed, GIRL_SERIAL_ALIASES, ctx);
  setStr(target, 'callsign', src, idx, consumed, GIRL_CALLSIGN_ALIASES, ctx);
  setStr(target, 'model', src, idx, consumed, GIRL_MODEL_ALIASES, ctx);
  setStr(target, 'seq', src, idx, consumed, GIRL_SEQ_ALIASES, ctx);
  setStr(target, 'faction', src, idx, consumed, GIRL_FACTION_ALIASES, ctx);
  setStr(target, 'body', src, idx, consumed, GIRL_BODY_ALIASES, ctx);
  setStr(target, 'personality', src, idx, consumed, GIRL_PERSONALITY_ALIASES, ctx);
  setStr(target, 'appearance', src, idx, consumed, GIRL_APPEARANCE_ALIASES, ctx);
  setStr(target, 'shell', src, idx, consumed, GIRL_SHELL_ALIASES, ctx);
  setStr(target, 'alias', src, idx, consumed, GIRL_ALIAS_ALIASES, ctx);
  if (!target.shell && typeof target.alias === 'string' && target.alias.trim()) {
    target.shell = target.alias.trim();
  }

  const exposureT = take(src, idx, consumed, GIRL_EXPOSURE_ALIASES);
  if (exposureT && exposureT.value != null && String(exposureT.value).trim()) {
    target.exposure = String(exposureT.value).trim();
    ctx.appliedCount++;
  }

  const statusT = take(src, idx, consumed, GIRL_STATUS_ALIASES);
  const stageT = take(src, idx, consumed, GIRL_STAGE_ALIASES);
  if (statusT && statusT.value != null && String(statusT.value).trim()) {
    target.status = String(statusT.value).trim();
    ctx.appliedCount++;
  } else if (stageT && stageT.value != null && String(stageT.value).trim()) {
    target.status = String(stageT.value).trim();
    ctx.appliedCount++;
  } else if (fallbackStatusFromHp && !target.status) {
    target.status = fallbackStatusFromHp;
  } else if (
    explicitHpUpdated &&
    typeof target.status === 'string' &&
    GIRL_TRANSIENT_INJURY_STATUS_RE.test(target.status.trim())
  ) {
    // 若上一楼曾将伤病/修复词（如「修复中」「重伤」）写入 status，而本楼仅通过「状态: 完好」更新了 hp，清理过期的伤病 status 以免阻塞副官恢复
    target.status = '';
  }

  if (typeof target.affection !== 'number') target.affection = 50;
  setNumField(target, 'affection', src, idx, consumed, GIRL_AFFECTION_ALIASES, ctx, path, { min: 0, max: 100 });

  if (typeof target.obedience !== 'number') target.obedience = 50;
  setNumField(target, 'obedience', src, idx, consumed, GIRL_OBEDIENCE_ALIASES, ctx, path, { min: 0, max: 100 });

  const traitsT = take(src, idx, consumed, GIRL_TRAITS_ALIASES);
  if (traitsT && traitsT.value != null) {
    target.traits = parseGirlTraits(traitsT.value);
    ctx.appliedCount++;
  }

  take(src, idx, consumed, GIRL_EXTRA_DOSSIER_PASSTHROUGH_ALIASES);
}

/** 势力元素映射 */
export function mapFaction(
  target: Record<string, unknown>,
  src: Record<string, unknown>,
  idx: Map<string, string>,
  consumed: Set<string>,
  _isNew: boolean,
  path: string,
  ctx: Ctx,
): void {
  setStr(target, 'name', src, idx, consumed, NAME_ALIASES, ctx);
  setEnumField(target, 'attitude', src, idx, consumed, ['态度', 'attitude'], ENUM_ATTITUDE, ctx, path);
  setStr(target, 'intel', src, idx, consumed, ['情报', 'intel', '认知'], ctx);
  setEnumField(target, 'risk', src, idx, consumed, ['风险', 'risk'], ENUM_RISK, ctx, path);
}

/** 任务元素映射（进度为字符串） */
export function mapQuest(
  target: Record<string, unknown>,
  src: Record<string, unknown>,
  idx: Map<string, string>,
  consumed: Set<string>,
  _isNew: boolean,
  _path: string,
  ctx: Ctx,
): void {
  setStr(target, 'name', src, idx, consumed, NAME_ALIASES, ctx);
  setStr(target, 'progress', src, idx, consumed, ['进度', 'progress'], ctx);
  setStr(target, 'note', src, idx, consumed, ['要点', 'note'], ctx);
  setStr(target, 'detail', src, idx, consumed, ['详情', 'detail'], ctx);
}

/* ═══════════════ FD-29 作战任务块解析与悬赏自动交割引擎 ═══════════════ */

export type QuestCategoryLiteral = '主线' | '支线' | '紧急' | '日常' | '指令';
export type QuestStatusLiteral = '进行中' | '已完成' | '已失败' | '已取消';

const QUEST_NAME_ALIASES = ['名称', '任务名', '标题', '任务', 'name', 'title'];
const QUEST_CATEGORY_ALIASES = ['类别', '分类', '类型', '等级', 'category', 'type', 'kind'];
const QUEST_STATUS_ALIASES = ['状态', '阶段', '动作', 'status', 'state', 'op'];
const QUEST_ISSUER_ALIASES = ['发包方', '发布方', '委托方', '委托人', '来源', '发布人', 'issuer', 'from', 'source'];
const QUEST_SERIES_ALIASES = [
  '系列',
  '任务链',
  '系列任务',
  '所属系列',
  '战役',
  '篇章',
  'series',
  'chain',
  'quest_chain',
  'arc',
];
const QUEST_CHAIN_STEP_ALIASES = [
  '环数',
  '阶段环',
  '系列进度',
  '幕次',
  '环',
  '章节',
  'chain_step',
  'step_index',
  'chain_progress',
];
const QUEST_NEXT_ALIASES = [
  '后续任务',
  '下一环',
  '后续线索',
  '下一阶段任务',
  '演进任务',
  'next_quest',
  'next_step',
  'followup_quest',
];
const QUEST_PROGRESS_ALIASES = ['进度', '进展', '当前进度', 'progress'];
const QUEST_NOTE_ALIASES = ['要点', '备注', '摘要', '目标', 'note', 'summary', 'objective'];
const QUEST_DETAIL_ALIASES = ['详情', '描述', '背景', '说明', 'detail', 'desc', 'description'];
const QUEST_REWARD_ALIASES = ['奖励', '悬赏', '报酬', '战利品', 'reward', 'rewards'];

const QUEST_HARD_CAP_CREDITS = 10000;
const QUEST_HARD_CAP_INTEL = 100;
const QUEST_HARD_CAP_RESOURCE = 5000;
const QUEST_HARD_CAP_TROOPS_PER_TYPE = 5;
const QUEST_HARD_CAP_VEHICLES = 2;
const QUEST_HARD_CAP_CHAIN_DAILY = 2000;
const QUEST_HARD_CAP_WALLET = 50000;
const QUEST_HARD_CAP_GIRL_DELTA = 15;
const QUEST_HARD_CAP_TECH_BOOST = 50;
const QUEST_HISTORY_LIMIT = 30;

const T3_VEHICLE_RE =
  /天启坦克|基洛夫|光棱坦克|幻影坦克|磁暴坦克|V3火箭|无畏级|航空母舰|世纪轰炸机|心灵控制车|脑车|镭射幽浮|飞碟/i;
const MCV_VEHICLE_RE = /机动建设车|基地车|\bMCV\b/i;

function normalizeFactionUnlockId(raw: string): { id: string; label: string; mcvName: string } | null {
  const s = raw.trim();
  if (!s) return null;
  if (/苏|soviet/i.test(s)) return { id: 'soviet', label: '苏联', mcvName: '机动建设车（苏联）' };
  if (/尤里|yuri/i.test(s)) return { id: 'yuri', label: '尤里', mcvName: '机动建设车（尤里）' };
  if (/盟|allied|ally/i.test(s)) return { id: 'allied', label: '盟军', mcvName: '机动建设车（盟军）' };
  return { id: canon(s), label: s, mcvName: `机动建设车（${s}）` };
}

function inferUnitKindAndProducer(
  name: string,
  rawKind?: unknown,
  rawProducer?: unknown,
): { kind: '人员' | '载具' | '装备'; producer: string; defaultCost: number } {
  const kStr = String(rawKind ?? '').trim();
  const pStr = String(rawProducer ?? '').trim();
  let kind: '人员' | '载具' | '装备' = '载具';
  if (kStr === '人员' || kStr === '步兵' || kStr === '士兵' || /infantry|troop|person/i.test(kStr)) {
    kind = '人员';
  } else if (kStr === '装备' || kStr === '武器' || /equip|gear/i.test(kStr)) {
    kind = '装备';
  } else if (kStr === '载具' || kStr === '装甲' || kStr === '车辆' || /vehicle|tank|air|ship/i.test(kStr)) {
    kind = '载具';
  } else if (/兵|员|士|师|卫|手|狙|特工|犬|新兵|班|队/.test(name) && !/车|坦|机|艇|舰|炮/.test(name)) {
    kind = '人员';
  } else if (/枪|甲|服|骨骼|模块|弹|装置|终端/.test(name) && !/车|坦|机|艇|舰/.test(name)) {
    kind = '装备';
  }

  let producer = pStr;
  if (!producer) {
    if (kind === '人员') producer = '兵营';
    else if (kind === '装备') producer = '个人装备制造所';
    else if (/战机|直升机|飞艇|空艇|轰炸机|飞行/.test(name)) producer = '空军指挥部';
    else if (/潜艇|驱逐舰|战舰|航母|快艇|船/.test(name)) producer = '海军造船厂';
    else producer = '战车工厂';
  }
  const defaultCost = kind === '人员' ? 250 : kind === '装备' ? 300 : 700;
  return { kind, producer, defaultCost };
}

const DEFAULT_PILLAR_SUBKEYS: Record<string, readonly string[]> = {
  nanites: ['标准纳米工料', '高精构造型纳米', '机娘修复凝胶'],
  minerals: ['铁矿石', '铜矿砂', '煤炭', '铝土矿', '稀土矿', '金银原矿', '灵石原矿'],
  materials: ['高强工程钢材', '特种防爆水泥', '再生塑料颗粒', '化工装药原料'],
  fuel: ['粗原油', '精炼柴油', '航空煤油', '灵沁原油'],
  munitions: ['步兵制式弹药', '大口径炮弹', '战术制导导弹'],
  logistics: ['工业与生活净水', '战备副食与口粮', '战地急救医药', '机械通用备件'],
};

function resolvePillarByAlias(rawKey: string): string | null {
  const c = canon(rawKey);
  if (!c) return null;
  for (const [pillar, aliases] of Object.entries(RESOURCE_PILLAR_ALIASES)) {
    if (canon(pillar) === c || aliases.some(a => canon(a) === c)) {
      return pillar;
    }
  }
  return null;
}

export function resolveResourcePillarForSubKey(subName: string, data: StatData): string {
  const c = canon(subName);
  const existingRes = (data.economy as unknown as { resources?: Record<string, Record<string, unknown>> }).resources;
  if (existingRes && typeof existingRes === 'object') {
    for (const [pillar, subMap] of Object.entries(existingRes)) {
      if (subMap && typeof subMap === 'object') {
        if (Object.keys(subMap).some(k => canon(k) === c)) {
          return pillar;
        }
      }
    }
  }
  for (const [pillar, keys] of Object.entries(DEFAULT_PILLAR_SUBKEYS)) {
    if (keys.some(k => canon(k) === c)) {
      return pillar;
    }
  }
  if (/纳米|凝胶/.test(subName)) return 'nanites';
  if (/矿|煤|稀土|灵石|原石|微晶/.test(subName)) return 'minerals';
  if (/油|燃料|燃气|煤油|柴油|汽油|能源/.test(subName)) return 'fuel';
  if (/弹|炮|导弹|火药|炸药|军械|雷/.test(subName)) return 'munitions';
  if (/水|口粮|副食|粮|医|药|备件|零件|后勤/.test(subName)) return 'logistics';
  return 'materials';
}

export function normalizeQuestCategory(raw: unknown, ctx?: Ctx, questName?: string): QuestCategoryLiteral {
  const s = String(raw ?? '').trim();
  const c = canon(s);
  if (!c) return '支线';
  if (['主线', '主线任务', '核心', '核心主线', 'main', 'primary', 'story'].some(a => canon(a) === c)) return '主线';
  if (['支线', '支线任务', '委托', '支线委托', '悬赏', 'side', 'sub', 'bounty'].some(a => canon(a) === c)) return '支线';
  if (['紧急', '紧急任务', '紧急军情', '限时', '突发', 'urgent', 'emergency', 'critical'].some(a => canon(a) === c))
    return '紧急';
  if (['日常', '日常任务', '周期', '例行', 'daily', 'routine'].some(a => canon(a) === c)) return '日常';
  if (['指令', '作战指令', '参谋指令', '专项指令', 'directive', 'order', 'command'].some(a => canon(a) === c))
    return '指令';
  if (ctx) {
    yellow(
      ctx,
      {
        layer: 'L2',
        path: questName ? `quests[${questName}].category` : 'quests.category',
        message: `[任务] 未知任务类别「${s}」，已归一为「支线」`,
        before: s,
        after: '支线',
      },
      { rule: 'R18', target: '任务', message: `任务类别「${s}」已归一为「支线」` },
    );
  }
  return '支线';
}

export function normalizeQuestStatus(raw: unknown, ctx?: Ctx, questName?: string): QuestStatusLiteral {
  const s = String(raw ?? '').trim();
  const c = canon(s);
  if (!c) return '进行中';
  if (
    [
      '发布',
      '接取',
      '新增',
      '推进',
      '更新',
      '进行中',
      '在途',
      '已接取',
      '执行中',
      'active',
      'in_progress',
      'inprogress',
      'issue',
      'update',
      'open',
      'ongoing',
    ].some(a => canon(a) === c)
  ) {
    return '进行中';
  }
  if (
    [
      '已完成',
      '完成',
      '达成',
      '完结',
      '交割',
      '成功',
      '已交割',
      '已达成',
      'completed',
      'complete',
      'done',
      'success',
      'finish',
      'finished',
    ].some(a => canon(a) === c)
  ) {
    return '已完成';
  }
  if (['已失败', '失败', '超时', '溃败', '已超时', 'failed', 'fail', 'expired', 'failure'].some(a => canon(a) === c)) {
    return '已失败';
  }
  if (
    [
      '已取消',
      '取消',
      '终止',
      '放弃',
      '已终止',
      '已放弃',
      'cancelled',
      'canceled',
      'cancel',
      'aborted',
      'abort',
    ].some(a => canon(a) === c)
  ) {
    return '已取消';
  }
  if (ctx) {
    yellow(
      ctx,
      {
        layer: 'L2',
        path: questName ? `quests[${questName}].status` : 'quests.status',
        message: `[任务] 未知任务状态「${s}」，已归一为「进行中」`,
        before: s,
        after: '进行中',
      },
      { rule: 'R18', target: '任务', message: `任务状态「${s}」已归一为「进行中」` },
    );
  }
  return '进行中';
}

function parseRewardNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v ?? '')
    .trim()
    .replace(/,/g, '')
    .replace(/^\+\s*/, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function addClampedResourceReward(
  resourcesOut: Record<string, Record<string, number>>,
  pillar: string,
  subName: string,
  rawVal: unknown,
  ctx: Ctx,
  questName: string,
): void {
  if (!subName) return;
  const n = parseRewardNum(rawVal);
  if (n == null) {
    ctx.quarantine.push({
      scope: 'key',
      tag: '任务',
      path: `quests[${questName}].rewards.resources.${pillar}.${subName}`,
      raw: String(rawVal),
      error: '任务资源奖励非数字值',
    });
    return;
  }
  if (n < 0) {
    ctx.quarantine.push({
      scope: 'key',
      tag: '任务',
      path: `quests[${questName}].rewards.resources.${pillar}.${subName}`,
      raw: String(rawVal),
      error: '任务资源奖励不能为负数',
    });
    return;
  }
  let val = n;
  if (val > QUEST_HARD_CAP_RESOURCE) {
    yellow(
      ctx,
      {
        layer: 'L2',
        path: `quests[${questName}].rewards.resources.${pillar}.${subName}`,
        message: `[任务] 任务「${questName}」资源「${subName}」奖励超单任务上限（${val} > ${QUEST_HARD_CAP_RESOURCE}），已钳制为 ${QUEST_HARD_CAP_RESOURCE}`,
        before: val,
        after: QUEST_HARD_CAP_RESOURCE,
      },
      {
        rule: 'R18',
        target: '任务',
        message: `任务「${questName}」资源「${subName}」奖励超上限，已钳制为 ${QUEST_HARD_CAP_RESOURCE}`,
      },
    );
    val = QUEST_HARD_CAP_RESOURCE;
  }
  const bucket = (resourcesOut[pillar] ??= {});
  bucket[subName] = val;
}

export function parseQuestReward(
  rawReward: unknown,
  data: StatData,
  ctx: Ctx,
  questName: string,
): QuestReward | undefined {
  if (rawReward == null) return undefined;

  const out: QuestReward = {
    credits: 0,
    intel_points: 0,
    resources: {},
    items: [],
    text: '',
  };

  if (typeof rawReward === 'number') {
    if (rawReward < 0) {
      ctx.quarantine.push({
        scope: 'key',
        tag: '任务',
        path: `quests[${questName}].rewards.credits`,
        raw: String(rawReward),
        error: '任务资金奖励不能为负数',
      });
      return out;
    }
    if (rawReward > QUEST_HARD_CAP_CREDITS) {
      yellow(
        ctx,
        {
          layer: 'L2',
          path: `quests[${questName}].rewards.credits`,
          message: `[任务] 任务「${questName}」资金奖励超单任务上限（${rawReward} > ${QUEST_HARD_CAP_CREDITS}），已钳制为 ${QUEST_HARD_CAP_CREDITS}`,
          before: rawReward,
          after: QUEST_HARD_CAP_CREDITS,
        },
        { rule: 'R18', target: '任务', message: `任务「${questName}」资金奖励超上限，已钳制为 ${QUEST_HARD_CAP_CREDITS}` },
      );
      out.credits = QUEST_HARD_CAP_CREDITS;
    } else {
      out.credits = rawReward;
    }
    return out;
  }

  if (typeof rawReward === 'string') {
    const text = rawReward.trim();
    if (!text) return undefined;
    out.text = text;
    const credMatch = text.match(/(?:资金|经费|赏金|系统资金|credits|money)\s*[:：]?\s*([+-]?\s*\d+(?:\.\d+)?)/i);
    if (credMatch) {
      const n = Number(credMatch[1].replace(/\s+/g, ''));
      if (Number.isFinite(n)) {
        if (n < 0) {
          ctx.quarantine.push({
            scope: 'key',
            tag: '任务',
            path: `quests[${questName}].rewards.credits`,
            raw: credMatch[0],
            error: '任务资金奖励不能为负数',
          });
        } else if (n > QUEST_HARD_CAP_CREDITS) {
          yellow(
            ctx,
            {
              layer: 'L2',
              path: `quests[${questName}].rewards.credits`,
              message: `[任务] 任务「${questName}」资金奖励超单任务上限（${n} > ${QUEST_HARD_CAP_CREDITS}），已钳制为 ${QUEST_HARD_CAP_CREDITS}`,
              before: n,
              after: QUEST_HARD_CAP_CREDITS,
            },
            { rule: 'R18', target: '任务', message: `任务「${questName}」资金奖励超上限，已钳制为 ${QUEST_HARD_CAP_CREDITS}` },
          );
          out.credits = QUEST_HARD_CAP_CREDITS;
        } else {
          out.credits = n;
        }
      }
    }
    const intelMatch = text.match(/(?:战略机密点|机密点|情报点|intel_points|intel)\s*[:：]?\s*([+-]?\s*\d+(?:\.\d+)?)/i);
    if (intelMatch) {
      const n = Number(intelMatch[1].replace(/\s+/g, ''));
      if (Number.isFinite(n)) {
        if (n < 0) {
          ctx.quarantine.push({
            scope: 'key',
            tag: '任务',
            path: `quests[${questName}].rewards.intel_points`,
            raw: intelMatch[0],
            error: '任务机密点奖励不能为负数',
          });
        } else if (n > QUEST_HARD_CAP_INTEL) {
          yellow(
            ctx,
            {
              layer: 'L2',
              path: `quests[${questName}].rewards.intel_points`,
              message: `[任务] 任务「${questName}」机密点奖励超单任务上限（${n} > ${QUEST_HARD_CAP_INTEL}），已钳制为 ${QUEST_HARD_CAP_INTEL}`,
              before: n,
              after: QUEST_HARD_CAP_INTEL,
            },
            { rule: 'R18', target: '任务', message: `任务「${questName}」机密点奖励超上限，已钳制为 ${QUEST_HARD_CAP_INTEL}` },
          );
          out.intel_points = QUEST_HARD_CAP_INTEL;
        } else {
          out.intel_points = n;
        }
      }
    }
    return out;
  }

  if (Array.isArray(rawReward)) {
    out.items = rawReward.map(x => String(x ?? '').trim()).filter(Boolean);
    return out;
  }

  if (!isUsable(rawReward)) return undefined;

  const rObj = rawReward as Record<string, unknown>;
  const rIdx = keyIndex(rObj);
  const rConsumed = new Set<string>();

  const credT = take(rObj, rIdx, rConsumed, ['资金', '经费', '赏金', '系统资金', 'credits', 'money']);
  if (credT && credT.value != null && String(credT.value).trim() !== '') {
    const n = parseRewardNum(credT.value);
    if (n == null) {
      ctx.quarantine.push({
        scope: 'key',
        tag: '任务',
        path: `quests[${questName}].rewards.credits`,
        raw: String(credT.value),
        error: '任务资金奖励非数字值',
      });
    } else if (n < 0) {
      ctx.quarantine.push({
        scope: 'key',
        tag: '任务',
        path: `quests[${questName}].rewards.credits`,
        raw: String(credT.value),
        error: '任务资金奖励不能为负数',
      });
    } else if (n > QUEST_HARD_CAP_CREDITS) {
      yellow(
        ctx,
        {
          layer: 'L2',
          path: `quests[${questName}].rewards.credits`,
          message: `[任务] 任务「${questName}」资金奖励超单任务上限（${n} > ${QUEST_HARD_CAP_CREDITS}），已钳制为 ${QUEST_HARD_CAP_CREDITS}`,
          before: n,
          after: QUEST_HARD_CAP_CREDITS,
        },
        { rule: 'R18', target: '任务', message: `任务「${questName}」资金奖励超上限，已钳制为 ${QUEST_HARD_CAP_CREDITS}` },
      );
      out.credits = QUEST_HARD_CAP_CREDITS;
    } else {
      out.credits = n;
    }
  }

  const intelT = take(rObj, rIdx, rConsumed, ['机密点', '情报点', '战略机密点', '机密', 'intel_points', 'intel']);
  if (intelT && intelT.value != null && String(intelT.value).trim() !== '') {
    const n = parseRewardNum(intelT.value);
    if (n == null) {
      ctx.quarantine.push({
        scope: 'key',
        tag: '任务',
        path: `quests[${questName}].rewards.intel_points`,
        raw: String(intelT.value),
        error: '任务机密点奖励非数字值',
      });
    } else if (n < 0) {
      ctx.quarantine.push({
        scope: 'key',
        tag: '任务',
        path: `quests[${questName}].rewards.intel_points`,
        raw: String(intelT.value),
        error: '任务机密点奖励不能为负数',
      });
    } else if (n > QUEST_HARD_CAP_INTEL) {
      yellow(
        ctx,
        {
          layer: 'L2',
          path: `quests[${questName}].rewards.intel_points`,
          message: `[任务] 任务「${questName}」机密点奖励超单任务上限（${n} > ${QUEST_HARD_CAP_INTEL}），已钳制为 ${QUEST_HARD_CAP_INTEL}`,
          before: n,
          after: QUEST_HARD_CAP_INTEL,
        },
        { rule: 'R18', target: '任务', message: `任务「${questName}」机密点奖励超上限，已钳制为 ${QUEST_HARD_CAP_INTEL}` },
      );
      out.intel_points = QUEST_HARD_CAP_INTEL;
    } else {
      out.intel_points = n;
    }
  }

  const parseResourcesContainer = (resContainer: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(resContainer)) {
      const keyName = k.trim();
      if (!keyName) continue;
      const matchedPillar = resolvePillarByAlias(keyName);
      if (matchedPillar && isUsable(v) && !Array.isArray(v)) {
        for (const [subK, subV] of Object.entries(v as Record<string, unknown>)) {
          addClampedResourceReward(out.resources, matchedPillar, subK.trim(), subV, ctx, questName);
        }
      } else if (!isUsable(v)) {
        const pillar = matchedPillar ?? resolveResourcePillarForSubKey(keyName, data);
        addClampedResourceReward(out.resources, pillar, keyName, v, ctx, questName);
      } else if (isUsable(v) && !Array.isArray(v)) {
        for (const [subK, subV] of Object.entries(v as Record<string, unknown>)) {
          const subTrim = subK.trim();
          const pillar = resolveResourcePillarForSubKey(subTrim, data);
          addClampedResourceReward(out.resources, pillar, subTrim, subV, ctx, questName);
        }
      }
    }
  };

  const resT = take(rObj, rIdx, rConsumed, ['资源', '战略资源', '物资', 'resources', 'resource']);
  if (resT && isUsable(resT.value) && !Array.isArray(resT.value)) {
    parseResourcesContainer(resT.value as Record<string, unknown>);
  }

  // 兼容直接在奖励下写六柱名（如 奖励: { 建材: { 钢材: 300 } }）
  for (const [pillar, aliases] of Object.entries(RESOURCE_PILLAR_ALIASES)) {
    const pT = take(rObj, rIdx, rConsumed, [pillar, ...aliases]);
    if (pT && isUsable(pT.value) && !Array.isArray(pT.value)) {
      for (const [subK, subV] of Object.entries(pT.value as Record<string, unknown>)) {
        addClampedResourceReward(out.resources, pillar, subK.trim(), subV, ctx, questName);
      }
    }
  }

  const itemsT = take(rObj, rIdx, rConsumed, ['战利品', '物品', '道具', '权限', '解锁', 'items', 'item', 'loot']);
  if (itemsT && itemsT.value != null) {
    out.items = asArray(itemsT.value).map(x => String(x ?? '').trim()).filter(Boolean);
  }

  const textT = take(rObj, rIdx, rConsumed, ['简述', '说明', '描述', '备注', 'text', 'desc', 'note']);
  if (textT && textT.value != null) {
    out.text = String(textT.value).trim();
  }

  // FD-30 扩展奖励解析
  // 1) Tier S: 解锁阵营
  const unlockFacT = take(rObj, rIdx, rConsumed, [
    '解锁阵营',
    '启封阵营',
    '新阵营',
    '阵营解锁',
    'unlock_factions',
    'unlock_faction',
  ]);
  if (unlockFacT && unlockFacT.value != null) {
    const facs = asArray(unlockFacT.value)
      .map(x => String(x ?? '').trim())
      .filter(Boolean);
    if (facs.length > 0) out.unlock_factions = facs;
  }

  // 2) Tier A: 解锁蓝图（挂载至主基地兵营/战车工厂）
  const unlockUnitT = take(rObj, rIdx, rConsumed, [
    '解锁蓝图',
    '解锁单位',
    '新单位',
    '蓝图奖励',
    '生产授权',
    'unlock_units',
    'blueprints',
  ]);
  if (unlockUnitT && unlockUnitT.value != null) {
    const unitsOut: QuestUnlockUnit[] = [];
    for (const rawU of asArray(unlockUnitT.value)) {
      if (typeof rawU === 'string' && rawU.trim()) {
        const uName = rawU.trim();
        const inferred = inferUnitKindAndProducer(uName);
        unitsOut.push({
          name: uName,
          kind: inferred.kind,
          producer: inferred.producer,
          cost: inferred.defaultCost,
          desc: '任务授权列装单位，可在主基地对应生产建筑直接排产量产。',
        });
      } else if (isUsable(rawU) && !Array.isArray(rawU)) {
        const uObj = rawU as Record<string, unknown>;
        const uIdx = keyIndex(uObj);
        const uConsumed = new Set<string>();
        const uNameT = take(uObj, uIdx, uConsumed, ['名称', '单位', '项目', '型号', 'name', 'unit']);
        const uName = String(uNameT?.value ?? '').trim();
        if (!uName) continue;
        const uKindT = take(uObj, uIdx, uConsumed, ['类别', '类型', '种类', 'kind', 'type']);
        const uProdT = take(uObj, uIdx, uConsumed, ['生产建筑', '母体', '前置', '建筑', 'producer', 'building']);
        const uCostT = take(uObj, uIdx, uConsumed, ['造价', '消耗', '价格', '费用', 'cost', 'price']);
        const uDescT = take(uObj, uIdx, uConsumed, ['简介', '描述', '说明', 'desc', 'description']);
        const uFacT = take(uObj, uIdx, uConsumed, ['阵营', '所属阵营', 'faction']);
        const inferred = inferUnitKindAndProducer(uName, uKindT?.value, uProdT?.value);
        const parsedCost = uCostT ? parseRewardNum(uCostT.value) : null;
        unitsOut.push({
          name: uName,
          kind: inferred.kind,
          producer: inferred.producer,
          cost: parsedCost && parsedCost > 0 ? parsedCost : inferred.defaultCost,
          desc:
            uDescT && uDescT.value != null && String(uDescT.value).trim()
              ? String(uDescT.value).trim()
              : '任务授权列装单位，可在主基地对应生产建筑直接排产量产。',
          ...(uFacT && uFacT.value != null && String(uFacT.value).trim()
            ? { faction: String(uFacT.value).trim() }
            : {}),
        });
      }
    }
    if (unitsOut.length > 0) out.unlock_units = unitsOut;
  }

  // 3) Tier B: 收编兵力（单兵种 <= 5）
  const troopsT = take(rObj, rIdx, rConsumed, ['收编兵力', '奖励兵力', '支援步兵', '人员', '步兵', 'troops']);
  if (troopsT && troopsT.value != null) {
    const troopsMap: Record<string, number> = {};
    const addTroopEntry = (uNameRaw: string, cntRaw: unknown) => {
      const uName = uNameRaw.trim();
      if (!uName) return;
      const n = parseRewardNum(cntRaw);
      if (n == null || n <= 0) return;
      let amt = Math.floor(n);
      if (amt > QUEST_HARD_CAP_TROOPS_PER_TYPE) {
        yellow(
          ctx,
          {
            layer: 'L2',
            path: `quests[${questName}].rewards.troops.${uName}`,
            message: `[任务] 任务「${questName}」收编步兵「${uName}」数量超单任务上限（${amt} > ${QUEST_HARD_CAP_TROOPS_PER_TYPE}），已钳制为 ${QUEST_HARD_CAP_TROOPS_PER_TYPE}`,
            before: amt,
            after: QUEST_HARD_CAP_TROOPS_PER_TYPE,
          },
          {
            rule: 'R18',
            target: '任务',
            message: `任务「${questName}」收编步兵「${uName}」超上限，已钳制为 ${QUEST_HARD_CAP_TROOPS_PER_TYPE}`,
          },
        );
        amt = QUEST_HARD_CAP_TROOPS_PER_TYPE;
      }
      troopsMap[uName] = amt;
    };
    if (Array.isArray(troopsT.value)) {
      for (const item of troopsT.value) {
        if (typeof item === 'string' && item.trim()) {
          const m = item.trim().match(/^(.+?)\s*[×xX*+:：]?\s*(\d+)\s*(?:人|名|员)?$/);
          if (m) addTroopEntry(m[1], Number(m[2]));
          else addTroopEntry(item.trim(), 1);
        } else if (isUsable(item) && !Array.isArray(item)) {
          const o = item as Record<string, unknown>;
          const oi = keyIndex(o);
          const oc = new Set<string>();
          const nT = take(o, oi, oc, ['名称', '兵种', '单位', 'name', 'unit']);
          const qT = take(o, oi, oc, ['数量', '人数', 'count', 'qty']);
          if (nT?.value) addTroopEntry(String(nT.value), qT?.value ?? 1);
        }
      }
    } else if (isUsable(troopsT.value)) {
      for (const [k, v] of Object.entries(troopsT.value as Record<string, unknown>)) {
        addTroopEntry(k, v);
      }
    }
    if (Object.keys(troopsMap).length > 0) out.troops = troopsMap;
  }

  // 4) Tier B: 缴获载具
  const vehiclesT = take(rObj, rIdx, rConsumed, [
    '缴获载具',
    '奖励载具',
    '支援载具',
    '整备载具',
    '载具',
    'vehicles',
  ]);
  if (vehiclesT && vehiclesT.value != null) {
    const vList: string[] = [];
    if (Array.isArray(vehiclesT.value)) {
      for (const item of vehiclesT.value) {
        if (typeof item === 'string' && item.trim()) {
          vList.push(item.trim());
        } else if (isUsable(item) && !Array.isArray(item)) {
          const o = item as Record<string, unknown>;
          const oi = keyIndex(o);
          const oc = new Set<string>();
          const nT = take(o, oi, oc, ['名称', '型号', '载具', 'name', 'vehicle']);
          const qT = take(o, oi, oc, ['数量', '台数', '辆数', 'count', 'qty']);
          const vName = String(nT?.value ?? '').trim();
          const cnt = Math.max(1, Math.min(5, Math.floor(parseRewardNum(qT?.value) ?? 1)));
          if (vName) {
            for (let i = 0; i < cnt; i++) vList.push(vName);
          }
        }
      }
    } else if (typeof vehiclesT.value === 'string' && vehiclesT.value.trim()) {
      vList.push(vehiclesT.value.trim());
    } else if (isUsable(vehiclesT.value)) {
      for (const [k, v] of Object.entries(vehiclesT.value as Record<string, unknown>)) {
        const vName = k.trim();
        const cnt = Math.max(1, Math.min(5, Math.floor(parseRewardNum(v) ?? 1)));
        if (vName) {
          for (let i = 0; i < cnt; i++) vList.push(vName);
        }
      }
    }
    if (vList.length > 0) out.vehicles = vList;
  }

  // 5) 持续性资金链（FD-30 / FD-51：支持多轨外币/货物日收支、物理三要素依赖与商路软修正守卫）
  const chainsT = take(rObj, rIdx, rConsumed, ['资金链', '贸易链', '收入链', 'chains', 'chain']);
  if (chainsT && chainsT.value != null) {
    const chainsOut: QuestChainReward[] = [];
    for (const rawC of asArray(chainsT.value)) {
      if (!isUsable(rawC) || Array.isArray(rawC)) continue;
      const cObj = rawC as Record<string, unknown>;
      const cIdx = keyIndex(cObj);
      const cConsumed = new Set<string>();
      const cNameT = take(cObj, cIdx, cConsumed, ['名称', '项目', '链名', 'name', 'title']);
      const cRateT = take(cObj, cIdx, cConsumed, [
        '日收益',
        '日产',
        '每日收益',
        '速率',
        '额度',
        '日额度',
        '日额',
        'rate_daily',
        'rate',
      ]);
      const cCapT = take(cObj, cIdx, cConsumed, ['总额度', '容量', '上限', '总储量', 'capacity', 'total']);
      const cIdT = take(cObj, cIdx, cConsumed, ['编号', 'id']);
      const cKindT = take(cObj, cIdx, cConsumed, [
        '链条类型',
        '类别',
        '物理分类',
        '分类',
        'chain_kind',
        'chainKind',
        'kind',
      ]);
      const cWalletT = take(cObj, cIdx, cConsumed, [
        '外币日收支',
        '外币',
        '钱袋日收支',
        '外币收益',
        '本地外币',
        '钱袋',
        'wallet_daily',
        'walletDaily',
        'wallet',
      ]);
      const cResT = take(cObj, cIdx, cConsumed, [
        '货物日收支',
        '资源日收支',
        '物资日收支',
        '实物日收支',
        '六柱日收支',
        'resources_daily',
        'resourcesDaily',
        'resources',
      ]);
      const cVehiclesT = take(cObj, cIdx, cConsumed, [
        '依赖载具',
        '矿车',
        '依托载具',
        '载具',
        '车辆',
        'vehicles',
      ]);
      const cFactionT = take(cObj, cIdx, cConsumed, [
        '依赖势力',
        '贸易对象',
        '关联势力',
        '合作势力',
        '所属势力',
        'faction',
      ]);
      const cBldsT = take(cObj, cIdx, cConsumed, [
        '依赖建筑',
        '依托建筑',
        '建筑',
        '设施',
        'buildings',
      ]);

      const cName = String(cNameT?.value ?? '').trim();
      if (!cName) continue;

      let walletDaily: Record<string, number> | undefined;
      if (cWalletT?.value != null && isUsable(cWalletT.value) && !Array.isArray(cWalletT.value)) {
        const wMap: Record<string, number> = {};
        for (const [k, v] of Object.entries(cWalletT.value as Record<string, unknown>)) {
          const curr = k.trim();
          const n = parseRewardNum(v);
          if (curr && n != null && n !== 0) wMap[curr] = n;
        }
        if (Object.keys(wMap).length > 0) walletDaily = wMap;
      }

      let resourcesDaily: Record<string, Record<string, number>> | undefined;
      if (cResT?.value != null && isUsable(cResT.value) && !Array.isArray(cResT.value)) {
        const rMap: Record<string, Record<string, number>> = {};
        for (const [outerKey, outerVal] of Object.entries(cResT.value as Record<string, unknown>)) {
          const pKey = outerKey.trim();
          if (!pKey) continue;
          if (isUsable(outerVal) && !Array.isArray(outerVal)) {
            for (const [subKey, subVal] of Object.entries(outerVal as Record<string, unknown>)) {
              const sKey = subKey.trim();
              const n = parseRewardNum(subVal);
              if (sKey && n != null && n !== 0) {
                (rMap[pKey] ??= {})[sKey] = n;
              }
            }
          } else {
            const n = parseRewardNum(outerVal);
            if (n != null && n !== 0) {
              (rMap['矿产'] ??= {})[pKey] = n;
            }
          }
        }
        if (Object.keys(rMap).length > 0) resourcesDaily = rMap;
      }

      const vehicles =
        cVehiclesT?.value != null
          ? asArray(cVehiclesT.value)
              .map(x => String(x ?? '').trim())
              .filter(Boolean)
          : undefined;
      const faction =
        cFactionT?.value != null && String(cFactionT.value).trim()
          ? String(cFactionT.value).trim()
          : undefined;
      const buildings =
        cBldsT?.value != null
          ? asArray(cBldsT.value)
              .map(x => String(x ?? '').trim())
              .filter(Boolean)
          : [];

      const VALID_CHAIN_KINDS = [
        '采矿精炼',
        '废料回收',
        '油气化工',
        '本土商路',
        '工业转化',
        '后勤维护',
      ] as const;
      type ValidChainKind = (typeof VALID_CHAIN_KINDS)[number];
      let chainKind: ValidChainKind | undefined;
      if (cKindT?.value != null) {
        const kStr = String(cKindT.value).trim();
        chainKind = VALID_CHAIN_KINDS.find(k => canon(k) === canon(kStr));
        if (!chainKind) {
          if (/商路|贸易|走私|互市|商队/.test(kStr)) chainKind = '本土商路';
          else if (/采矿|精炼|原矿/.test(kStr)) chainKind = '采矿精炼';
          else if (/废料|回收/.test(kStr)) chainKind = '废料回收';
          else if (/油气|化工|油田|钻井/.test(kStr)) chainKind = '油气化工';
          else if (/工业|转化/.test(kStr)) chainKind = '工业转化';
          else if (/后勤|维护/.test(kStr)) chainKind = '后勤维护';
        }
      }
      const hasMintingBuilding = buildings.some(b =>
        /矿石精炼厂|精炼厂|回收处理厂|回收厂|超维暗网中继站|暗网中继站|科技钻井油田|钻井油田/.test(b),
      );
      if (!chainKind) {
        if (/商路|贸易|走私|互市|商队/.test(cName) && !hasMintingBuilding) {
          chainKind = '本土商路';
        } else if (
          /采矿|精炼厂|矿脉|原矿/.test([cName, ...buildings, ...(vehicles ?? [])].join(' ')) &&
          !/商路|贸易|走私|互市|商队/.test(cName)
        ) {
          chainKind = '采矿精炼';
        }
      }

      const rawRate = parseRewardNum(cRateT?.value) ?? 0;
      const hasMultiTrack = Boolean(walletDaily || resourcesDaily);
      if (rawRate <= 0 && !hasMultiTrack) continue;
      let rate = Math.max(0, rawRate);
      if (rate > QUEST_HARD_CAP_CHAIN_DAILY) {
        yellow(
          ctx,
          {
            layer: 'L2',
            path: `quests[${questName}].rewards.chains.${cName}`,
            message: `[任务] 任务「${questName}」资金链「${cName}」日收益超上限（${rate} > ${QUEST_HARD_CAP_CHAIN_DAILY}），已钳制为 ${QUEST_HARD_CAP_CHAIN_DAILY}`,
            before: rate,
            after: QUEST_HARD_CAP_CHAIN_DAILY,
          },
          {
            rule: 'R18',
            target: '任务',
            message: `任务「${questName}」资金链日收益超上限，已钳制为 ${QUEST_HARD_CAP_CHAIN_DAILY}`,
          },
        );
        rate = QUEST_HARD_CAP_CHAIN_DAILY;
      }

      // D-CHAIN-NET-02：本土商路不可直接产出系统资金 Credits，自动软修正转为本地外币钱袋收入
      const isTradeRoute =
        chainKind === '本土商路' ||
        (!chainKind && /商路|贸易|走私|互市|商队/.test(cName) && !hasMintingBuilding);
      if (isTradeRoute && !hasMintingBuilding && rate > 0 && !walletDaily && !resourcesDaily) {
        walletDaily = { 本地通用货币: rate };
        rate = 0;
        if (!chainKind) chainKind = '本土商路';
        yellow(
          ctx,
          {
            layer: 'L2',
            path: `quests[${questName}].rewards.chains.${cName}`,
            message: `[任务] 本土商路「${cName}」不可直接产出系统资金 Credits，已自动转为本地外币钱袋收入`,
            before: walletDaily.本地通用货币,
            after: 0,
          },
          {
            rule: 'R18',
            target: '任务',
            message: `本土商路「${cName}」不可直接产出系统资金 Credits，已自动转为本地外币钱袋收入`,
          },
        );
      }

      const cap = parseRewardNum(cCapT?.value);
      const rewardItem: QuestChainReward & Record<string, unknown> = {
        ...(cIdT?.value ? { id: String(cIdT.value).trim() } : {}),
        name: cName,
        rate_daily: rate,
        ...(cap != null && cap > 0 ? { capacity: cap } : {}),
        ...(chainKind ? { chain_kind: chainKind } : {}),
        ...(walletDaily ? { wallet_daily: walletDaily } : {}),
        ...(resourcesDaily ? { resources_daily: resourcesDaily } : {}),
        ...(vehicles && vehicles.length > 0 ? { vehicles } : {}),
        ...(faction ? { faction } : {}),
      };
      chainsOut.push(rewardItem);
    }
    if (chainsOut.length > 0) out.chains = chainsOut;
  }

  // 6) 战略协议线索/启封
  const protoT = take(rObj, rIdx, rConsumed, [
    '协议线索',
    '解锁协议',
    '启封协议',
    '战略协议',
    '协议',
    'protocols',
    'protocol',
  ]);
  if (protoT && protoT.value != null) {
    const pList = asArray(protoT.value)
      .map(x => String(x ?? '').trim())
      .filter(Boolean);
    if (pList.length > 0) out.protocols = pList;
  }

  // 7) 地方势力关系
  const facT = take(rObj, rIdx, rConsumed, ['势力', '势力关系', '地方势力', 'factions', 'faction']);
  if (facT && facT.value != null) {
    const facsOut: QuestFactionReward[] = [];
    for (const rawF of asArray(facT.value)) {
      if (!isUsable(rawF) || Array.isArray(rawF)) continue;
      const fObj = rawF as Record<string, unknown>;
      const fIdx = keyIndex(fObj);
      const fConsumed = new Set<string>();
      const fNameT = take(fObj, fIdx, fConsumed, ['名称', '势力', '势力名', 'name', 'faction']);
      const fAttT = take(fObj, fIdx, fConsumed, ['态度', '关系', 'attitude']);
      const fIntelT = take(fObj, fIdx, fConsumed, ['情报', '备注', '说明', 'intel', 'note']);
      const fName = String(fNameT?.value ?? '').trim();
      if (!fName) continue;
      const attResolved = fAttT?.value != null ? resolveEnum(fAttT.value, ENUM_ATTITUDE).value : null;
      facsOut.push({
        name: fName,
        ...(attResolved ? { attitude: attResolved as QuestFactionReward['attitude'] } : {}),
        ...(fIntelT?.value != null && String(fIntelT.value).trim() ? { intel: String(fIntelT.value).trim() } : {}),
      });
    }
    if (facsOut.length > 0) out.factions = facsOut;
  }

  // 8) 本地外币钱袋
  const walletT = take(rObj, rIdx, rConsumed, ['钱袋', '外币', '本地货币', '世界货币', 'wallet']);
  if (walletT && isUsable(walletT.value) && !Array.isArray(walletT.value)) {
    const wMap: Record<string, number> = {};
    for (const [k, v] of Object.entries(walletT.value as Record<string, unknown>)) {
      const curr = k.trim();
      const n = parseRewardNum(v);
      if (!curr || n == null || n <= 0) continue;
      let amt = n;
      if (amt > QUEST_HARD_CAP_WALLET) {
        yellow(
          ctx,
          {
            layer: 'L2',
            path: `quests[${questName}].rewards.wallet.${curr}`,
            message: `[任务] 任务「${questName}」外币「${curr}」超上限（${amt} > ${QUEST_HARD_CAP_WALLET}），已钳制为 ${QUEST_HARD_CAP_WALLET}`,
            before: amt,
            after: QUEST_HARD_CAP_WALLET,
          },
          { rule: 'R18', target: '任务', message: `任务「${questName}」外币「${curr}」超上限` },
        );
        amt = QUEST_HARD_CAP_WALLET;
      }
      wMap[curr] = amt;
    }
    if (Object.keys(wMap).length > 0) out.wallet = wMap;
  }

  // 9) 参战机娘好感/服从/特质
  const girlT = take(rObj, rIdx, rConsumed, ['机娘奖励', '机娘', '副官奖励', 'girl_rewards', 'girl']);
  if (girlT && girlT.value != null) {
    const girlsOut: QuestGirlReward[] = [];
    for (const rawG of asArray(girlT.value)) {
      if (!isUsable(rawG) || Array.isArray(rawG)) continue;
      const gObj = rawG as Record<string, unknown>;
      const gIdx = keyIndex(gObj);
      const gConsumed = new Set<string>();
      const gNameT = take(gObj, gIdx, gConsumed, ['名称', '姓名', '代号', '机娘', 'name', 'callsign']);
      const gAffT = take(gObj, gIdx, gConsumed, ['好感变化', '好感', '好感度变化', 'affection_delta', 'affection']);
      const gObeT = take(gObj, gIdx, gConsumed, ['服从变化', '服从', '服从度变化', 'obedience_delta', 'obedience']);
      const gTraitsT = take(gObj, gIdx, gConsumed, ['特质', '特征标签', '标签', 'traits', 'tags']);
      const gName = String(gNameT?.value ?? '').trim();
      if (!gName) continue;
      const clampDelta = (rawD: unknown): number | undefined => {
        const n = parseRewardNum(rawD);
        if (n == null || n === 0) return undefined;
        return Math.max(-QUEST_HARD_CAP_GIRL_DELTA, Math.min(QUEST_HARD_CAP_GIRL_DELTA, n));
      };
      const affDelta = clampDelta(gAffT?.value);
      const obeDelta = clampDelta(gObeT?.value);
      const traits =
        gTraitsT?.value != null
          ? asArray(gTraitsT.value)
              .map(x => String(x ?? '').trim())
              .filter(Boolean)
          : undefined;
      girlsOut.push({
        name: gName,
        ...(affDelta !== undefined ? { affection_delta: affDelta } : {}),
        ...(obeDelta !== undefined ? { obedience_delta: obeDelta } : {}),
        ...(traits && traits.length > 0 ? { traits } : {}),
      });
    }
    if (girlsOut.length > 0) out.girl_rewards = girlsOut;
  }

  // 10) 在研科技进度助力
  const tbT = take(rObj, rIdx, rConsumed, ['科研助力', '科技助力', '研发加速', '科研加速', 'tech_boost']);
  if (tbT && isUsable(tbT.value) && !Array.isArray(tbT.value)) {
    const tbObj = tbT.value as Record<string, unknown>;
    const tbIdx = keyIndex(tbObj);
    const tbConsumed = new Set<string>();
    const tbNameT = take(tbObj, tbIdx, tbConsumed, ['项目', '名称', '科技', 'name', 'item', 'tech']);
    const tbDeltaT = take(tbObj, tbIdx, tbConsumed, [
      '进度变化',
      '进度',
      '加速',
      'progress_delta',
      'delta',
      'progress',
    ]);
    const tbName = String(tbNameT?.value ?? '').trim();
    const rawDelta = parseRewardNum(tbDeltaT?.value);
    if (tbName && rawDelta != null && rawDelta > 0) {
      out.tech_boost = {
        name: tbName,
        progress_delta: Math.min(QUEST_HARD_CAP_TECH_BOOST, rawDelta),
      };
    }
  }

  return out;
}

export function mergeQuestRewards(
  baseReward: QuestReward | undefined,
  incomingReward: QuestReward | undefined,
): QuestReward | undefined {
  if (!baseReward && !incomingReward) return undefined;
  if (!baseReward) return incomingReward ? structuredClone(incomingReward) : undefined;
  if (!incomingReward) return structuredClone(baseReward);

  const mergedResources: Record<string, Record<string, number>> = {};
  for (const [p, sub] of Object.entries(baseReward.resources ?? {})) {
    mergedResources[p] = { ...sub };
  }
  for (const [p, sub] of Object.entries(incomingReward.resources ?? {})) {
    const normPillar = resolvePillarByAlias(p) ?? p;
    mergedResources[normPillar] = { ...(mergedResources[normPillar] ?? {}), ...sub };
  }

  const mergedItems = Array.from(new Set([...(baseReward.items ?? []), ...(incomingReward.items ?? [])]));

  const result: QuestReward = {
    credits: incomingReward.credits > 0 ? incomingReward.credits : (baseReward.credits ?? 0),
    intel_points: incomingReward.intel_points > 0 ? incomingReward.intel_points : (baseReward.intel_points ?? 0),
    resources: mergedResources,
    items: mergedItems,
    text: incomingReward.text || baseReward.text || '',
  };

  const unlockFactions = Array.from(
    new Set([...(baseReward.unlock_factions ?? []), ...(incomingReward.unlock_factions ?? [])]),
  );
  if (unlockFactions.length > 0) result.unlock_factions = unlockFactions;

  const unlockUnits = [...(baseReward.unlock_units ?? []), ...(incomingReward.unlock_units ?? [])];
  if (unlockUnits.length > 0) {
    const dedupUnits = new Map<string, QuestUnlockUnit>();
    for (const u of unlockUnits) dedupUnits.set(canon(u.name), u);
    result.unlock_units = Array.from(dedupUnits.values());
  }

  if (baseReward.troops || incomingReward.troops) {
    result.troops = { ...(baseReward.troops ?? {}), ...(incomingReward.troops ?? {}) };
  }
  const mergedVehicles = [...(incomingReward.vehicles ?? baseReward.vehicles ?? [])];
  if (mergedVehicles.length > 0) result.vehicles = mergedVehicles;

  const mergedChains = [...(baseReward.chains ?? []), ...(incomingReward.chains ?? [])];
  if (mergedChains.length > 0) {
    const dedupChains = new Map<string, QuestChainReward>();
    for (const c of mergedChains) dedupChains.set(canon(c.name), c);
    result.chains = Array.from(dedupChains.values());
  }

  const mergedProtos = Array.from(new Set([...(baseReward.protocols ?? []), ...(incomingReward.protocols ?? [])]));
  if (mergedProtos.length > 0) result.protocols = mergedProtos;

  const mergedFactions = [...(baseReward.factions ?? []), ...(incomingReward.factions ?? [])];
  if (mergedFactions.length > 0) {
    const dedupFacs = new Map<string, QuestFactionReward>();
    for (const f of mergedFactions) dedupFacs.set(canon(f.name), f);
    result.factions = Array.from(dedupFacs.values());
  }

  if (baseReward.wallet || incomingReward.wallet) {
    result.wallet = { ...(baseReward.wallet ?? {}), ...(incomingReward.wallet ?? {}) };
  }

  const mergedGirls = [...(baseReward.girl_rewards ?? []), ...(incomingReward.girl_rewards ?? [])];
  if (mergedGirls.length > 0) {
    const dedupGirls = new Map<string, QuestGirlReward>();
    for (const g of mergedGirls) dedupGirls.set(canon(g.name), g);
    result.girl_rewards = Array.from(dedupGirls.values());
  }

  if (incomingReward.tech_boost || baseReward.tech_boost) {
    result.tech_boost = incomingReward.tech_boost ?? baseReward.tech_boost;
  }

  return result;
}

function registerBlueprintIntoCodex(
  u: QuestUnlockUnit,
  questName: string,
  data: StatData,
  ctx: Ctx,
): void {
  const codexArr = (data.codex ??= []) as unknown as Record<string, unknown>[];
  const producer = u.producer || (u.kind === '人员' ? '兵营' : u.kind === '装备' ? '个人装备制造所' : '战车工厂');
  const existing = codexArr.find(e => canon(String(e.name ?? '')) === canon(u.name));
  const params: Record<string, string> = {
    ...(existing && isUsable(existing.params) ? (existing.params as Record<string, string>) : {}),
    前置: producer,
    造价: String(u.cost || 600),
    来源: `任务交割·${questName}`,
    ...(u.faction ? { 阵营: u.faction } : {}),
  };
  if (existing) {
    existing.kind = u.kind;
    if (u.desc) existing.desc = u.desc;
    existing.params = params;
  } else {
    codexArr.push(
      CodexEntry.parse({
        name: u.name,
        kind: u.kind,
        desc: u.desc || '任务授权列装单位，可在主基地对应生产建筑直接排产量产。',
        params,
      }) as unknown as Record<string, unknown>,
    );
  }
  green(
    ctx,
    {
      layer: 'L2',
      path: `codex[${u.name}]`,
      message: `[任务] 新单位蓝图「${u.name}」已授权挂载至主基地【${producer}】生产序列`,
    },
    { rule: 'R18', target: '任务', message: `新单位「${u.name}」已挂载至【${producer}】` },
  );
}

export function settleQuestRewards(
  questName: string,
  rewards: QuestReward | undefined,
  data: StatData,
  ctx: Ctx,
  questCategory: QuestCategoryLiteral = '支线',
): void {
  if (!rewards) return;

  // 1. 资金入账（单任务封顶 10000，负数隔离）
  if (typeof rewards.credits === 'number') {
    if (rewards.credits < 0) {
      ctx.quarantine.push({
        scope: 'key',
        tag: '任务',
        path: `quests[${questName}].rewards.credits`,
        raw: String(rewards.credits),
        error: '任务资金奖励不能为负数',
      });
      rewards.credits = 0;
    } else if (rewards.credits > 0) {
      let amt = rewards.credits;
      if (amt > QUEST_HARD_CAP_CREDITS) {
        yellow(
          ctx,
          {
            layer: 'L2',
            path: `quests[${questName}].rewards.credits`,
            message: `[任务] 任务「${questName}」资金奖励超单任务上限（${amt} > ${QUEST_HARD_CAP_CREDITS}），已钳制为 ${QUEST_HARD_CAP_CREDITS}`,
            before: amt,
            after: QUEST_HARD_CAP_CREDITS,
          },
          { rule: 'R18', target: '任务', message: `任务「${questName}」资金奖励超上限，已钳制为 ${QUEST_HARD_CAP_CREDITS}` },
        );
        amt = QUEST_HARD_CAP_CREDITS;
        rewards.credits = QUEST_HARD_CAP_CREDITS;
      }
      data.economy.credits = (data.economy.credits ?? 0) + amt;
    }
  }

  // 2. 机密点入账（单任务封顶 100，负数隔离）
  if (typeof rewards.intel_points === 'number') {
    if (rewards.intel_points < 0) {
      ctx.quarantine.push({
        scope: 'key',
        tag: '任务',
        path: `quests[${questName}].rewards.intel_points`,
        raw: String(rewards.intel_points),
        error: '任务机密点奖励不能为负数',
      });
      rewards.intel_points = 0;
    } else if (rewards.intel_points > 0) {
      let amt = rewards.intel_points;
      if (amt > QUEST_HARD_CAP_INTEL) {
        yellow(
          ctx,
          {
            layer: 'L2',
            path: `quests[${questName}].rewards.intel_points`,
            message: `[任务] 任务「${questName}」机密点奖励超单任务上限（${amt} > ${QUEST_HARD_CAP_INTEL}），已钳制为 ${QUEST_HARD_CAP_INTEL}`,
            before: amt,
            after: QUEST_HARD_CAP_INTEL,
          },
          { rule: 'R18', target: '任务', message: `任务「${questName}」机密点奖励超上限，已钳制为 ${QUEST_HARD_CAP_INTEL}` },
        );
        amt = QUEST_HARD_CAP_INTEL;
        rewards.intel_points = QUEST_HARD_CAP_INTEL;
      }
      const cmd = (data.command ??= CommandHQ.parse({})) as unknown as Record<string, unknown>;
      const prevIntel = typeof cmd.intel_points === 'number' && Number.isFinite(cmd.intel_points) ? cmd.intel_points : 0;
      cmd.intel_points = prevIntel + amt;
    }
  }

  // 3. 六柱战略资源入账（单小类单任务封顶 5000，null 自动解锁并累加）
  if (rewards.resources && typeof rewards.resources === 'object') {
    const eco = data.economy as unknown as Record<string, unknown>;
    for (const [rawPillar, subMap] of Object.entries(rewards.resources)) {
      if (!subMap || typeof subMap !== 'object') continue;
      const pillar = resolvePillarByAlias(rawPillar) ?? rawPillar;
      for (const [subKey, rawVal] of Object.entries(subMap)) {
        const subName = subKey.trim();
        if (!subName) continue;
        const n = parseRewardNum(rawVal);
        if (n == null) continue;
        if (n < 0) {
          ctx.quarantine.push({
            scope: 'key',
            tag: '任务',
            path: `quests[${questName}].rewards.resources.${pillar}.${subName}`,
            raw: String(rawVal),
            error: '任务资源奖励不能为负数',
          });
          subMap[subKey] = 0;
          continue;
        }
        if (n === 0) continue;
        let amt = n;
        if (amt > QUEST_HARD_CAP_RESOURCE) {
          yellow(
            ctx,
            {
              layer: 'L2',
              path: `quests[${questName}].rewards.resources.${pillar}.${subName}`,
              message: `[任务] 任务「${questName}」资源「${subName}」奖励超单任务上限（${amt} > ${QUEST_HARD_CAP_RESOURCE}），已钳制为 ${QUEST_HARD_CAP_RESOURCE}`,
              before: amt,
              after: QUEST_HARD_CAP_RESOURCE,
            },
            {
              rule: 'R18',
              target: '任务',
              message: `任务「${questName}」资源「${subName}」奖励超上限，已钳制为 ${QUEST_HARD_CAP_RESOURCE}`,
            },
          );
          amt = QUEST_HARD_CAP_RESOURCE;
          subMap[subKey] = QUEST_HARD_CAP_RESOURCE;
        }
        const resRoot = (eco.resources ??= {}) as Record<string, Record<string, number | null>>;
        const targetPillar = (resRoot[pillar] ??= {});
        const existingKey = Object.keys(targetPillar).find(k => canon(k) === canon(subName)) ?? subName;
        const prevVal = targetPillar[existingKey];
        const baseVal = typeof prevVal === 'number' && Number.isFinite(prevVal) ? prevVal : 0;
        targetPillar[existingKey] = baseVal + amt;
      }
    }
  }

  // 4. FD-30 Tier S：跨阵营 MCV 与新阵营启封（仅限主线/紧急/指令任务）
  const isStrategicQuest = questCategory === '主线' || questCategory === '紧急' || questCategory === '指令';
  const rawFactionsToUnlock = [...(rewards.unlock_factions ?? [])];
  const nonMcvVehicles: string[] = [];
  for (const vName of rewards.vehicles ?? []) {
    if (MCV_VEHICLE_RE.test(vName)) {
      rawFactionsToUnlock.push(vName);
    } else {
      nonMcvVehicles.push(vName);
    }
  }

  if (rawFactionsToUnlock.length > 0) {
    if (!isStrategicQuest) {
      yellow(
        ctx,
        {
          layer: 'L2',
          path: `quests[${questName}].rewards.unlock_factions`,
          message: `[任务] 跨阵营 MCV 与新阵营启封仅限主线/战略指令任务交割（当前任务「${questName}」类别为「${questCategory}」），已转为情报线索留痕`,
        },
        { rule: 'R18', target: '任务', message: `非主线任务「${questName}」越权解锁阵营/MCV 已拦截转为情报线索` },
      );
      const intelArr = (data.intel ??= []);
      intelArr.push(
        IntelItem.parse({
          src: `任务线索·${questName}`,
          cred: '中',
          content: `发现高阶战略阵营/MCV 线索（${rawFactionsToUnlock.join('、')}），需通过主线战略行动方可正式接管启封。`,
        }),
      );
    } else {
      for (const rawFac of rawFactionsToUnlock) {
        const info = normalizeFactionUnlockId(rawFac);
        if (!info) continue;
        const logs = applyFactionUnlockSettlement(data, [{
          factionId: info.id,
          factionLabel: info.label,
          title: questName,
          subtitle: '',
          theme: { primary: '', accent: '', bg: '' },
          badge: '',
          starterGirlName: '',
          starterGirlModel: '',
          starterGirlQuote: '',
          details: {},
          initialGrants: [info.mcvName],
          raw: rawFac,
        }]);
        for (const message of logs) {
          green(
            ctx,
            {
              layer: 'L2',
              path: `command.unlocked_factions[${info.id}]`,
              message: `[任务] 战略主线「${questName}」达成：已启封【${info.label}】阵营权限；${message}`,
            },
            { rule: 'R18', target: '任务', message },
          );
        }
      }
    }
  }

  // 5. FD-30 Tier A：全新兵种/载具蓝图 → 挂载至主基地【兵营 / 战车工厂】可造列表
  if (rewards.unlock_units && rewards.unlock_units.length > 0) {
    for (const u of rewards.unlock_units) {
      registerBlueprintIntoCodex(u, questName, data, ctx);
    }
  }

  // 6. FD-30 Tier B：常规步兵限量收编（<=5）与 T1/T2 载具整备（<=2，T3 自动拦截转蓝图）
  if (rewards.troops && typeof rewards.troops === 'object') {
    const troopsPool = (data.forces.troops ??= {});
    for (const [uName, rawCnt] of Object.entries(rewards.troops)) {
      const cnt = Math.min(QUEST_HARD_CAP_TROOPS_PER_TYPE, Math.max(0, Math.floor(Number(rawCnt) || 0)));
      if (cnt <= 0) continue;
      const existingKey = Object.keys(troopsPool).find(k => canon(k) === canon(uName)) ?? uName;
      troopsPool[existingKey] = (troopsPool[existingKey] ?? 0) + cnt;
      green(
        ctx,
        {
          layer: 'L2',
          path: `forces.troops[${existingKey}]`,
          message: `[任务] 主基地【兵营】已完成任务收编人员整备：${existingKey} +${cnt}`,
        },
        { rule: 'R18', target: '任务', message: `任务收编人员「${existingKey}」+${cnt}` },
      );
    }
  }

  if (nonMcvVehicles.length > 0) {
    const vehiclesList = (data.forces.vehicles ??= []);
    let acceptedVehicles = 0;
    for (const vName of nonMcvVehicles) {
      if (T3_VEHICLE_RE.test(vName)) {
        yellow(
          ctx,
          {
            layer: 'L2',
            path: `quests[${questName}].rewards.vehicles`,
            message: `[任务] T3 高阶载具「${vName}」禁止直接白送现成车，已自动转为【战车工厂】生产蓝图归档`,
          },
          { rule: 'R18', target: '任务', message: `T3 载具「${vName}」已自动转为战车工厂蓝图` },
        );
        registerBlueprintIntoCodex(
          {
            name: vName,
            kind: '载具',
            producer: /飞艇|空艇|轰炸机|幽浮|飞碟/.test(vName)
              ? '空军指挥部'
              : /战舰|航母/.test(vName)
                ? '海军造船厂'
                : '战车工厂',
            cost: 1800,
            desc: `高阶战利品逆向蓝图（源自任务「${questName}」），可在主基地对应生产建筑排产量产。`,
          },
          questName,
          data,
          ctx,
        );
        continue;
      }
      if (acceptedVehicles >= QUEST_HARD_CAP_VEHICLES) {
        yellow(
          ctx,
          {
            layer: 'L2',
            path: `quests[${questName}].rewards.vehicles`,
            message: `[任务] 任务「${questName}」单次整备载具数量超过上限 ${QUEST_HARD_CAP_VEHICLES} 辆，多余载具「${vName}」已略过`,
          },
          { rule: 'R18', target: '任务', message: `任务「${questName}」整备载具超上限已截断` },
        );
        continue;
      }
      vehiclesList.push(vName);
      acceptedVehicles++;
      green(
        ctx,
        {
          layer: 'L2',
          path: `forces.vehicles`,
          message: `[任务] 主基地【战车工厂】已完成任务载具整备交付：${vName}`,
        },
        { rule: 'R18', target: '任务', message: `任务整备载具「${vName}」已入列` },
      );
    }
  }

  // 7. FD-30 五大跨系统联动奖励结算
  // 7.1 持续性资金链 -> data.economy.chains（FD-30 / FD-51：支持多轨字段与物理三要素依赖透传）
  if (rewards.chains && rewards.chains.length > 0) {
    const chainsArr = (data.economy.chains ??= []);
    const primaryBaseId = data.bases?.[0]?.id ?? '前沿第一基地';
    for (const rawChainReward of rewards.chains) {
      const c = rawChainReward as QuestChainReward & {
        chain_kind?: IncomeChain['chain_kind'];
        wallet_daily?: Record<string, number>;
        resources_daily?: Record<string, Record<string, number>>;
        vehicles?: string[];
        faction?: string;
      };
      let rate = Math.min(QUEST_HARD_CAP_CHAIN_DAILY, Math.max(0, c.rate_daily ?? 0));
      let walletDaily = c.wallet_daily ? { ...c.wallet_daily } : undefined;
      const resourcesDaily = c.resources_daily ? { ...c.resources_daily } : undefined;
      let chainKind = c.chain_kind;
      const isTradeRoute =
        chainKind === '本土商路' ||
        (!chainKind && /商路|贸易|走私|互市|商队/.test(c.name));
      if (isTradeRoute && rate > 0 && !walletDaily && !resourcesDaily) {
        walletDaily = { 本地通用货币: rate };
        rate = 0;
        if (!chainKind) chainKind = '本土商路';
        yellow(
          ctx,
          {
            layer: 'L2',
            path: `quests[${questName}].rewards.chains.${c.name}`,
            message: `[任务] 本土商路「${c.name}」不可直接产出系统资金 Credits，已自动转为本地外币钱袋收入`,
          },
          {
            rule: 'R18',
            target: '任务',
            message: `本土商路「${c.name}」不可直接产出系统资金 Credits，已自动转为本地外币钱袋收入`,
          },
        );
      }
      const hasMultiTrack = Boolean(
        (walletDaily && Object.keys(walletDaily).length > 0) ||
          (resourcesDaily && Object.keys(resourcesDaily).length > 0),
      );
      if (rate <= 0 && !hasMultiTrack) continue;
      const chainId = c.id || `chain_quest_${canon(c.name)}`;
      const existingChain = chainsArr.find(
        item => canon(item.id) === canon(chainId) || canon(item.name) === canon(c.name),
      );
      const defaultTotalCap = c.capacity ?? (rate > 0 ? rate * 30 : null);
      if (existingChain) {
        const extExisting = existingChain as IncomeChain & Record<string, unknown>;
        existingChain.rate_daily = rate;
        existingChain.status = 'active';
        existingChain.eff = 1;
        if (chainKind) extExisting.chain_kind = chainKind;
        if (walletDaily) extExisting.wallet_daily = walletDaily;
        if (resourcesDaily) extExisting.resources_daily = resourcesDaily;
        if (c.vehicles && c.vehicles.length > 0) {
          existingChain.deps.vehicles = [...c.vehicles];
        }
        if (c.faction) {
          existingChain.deps.faction = c.faction;
        }
        if (c.capacity != null && c.capacity > 0) {
          existingChain.capacity.total = c.capacity;
        }
      } else {
        const newChainEntry: IncomeChain = {
          id: chainId,
          name: c.name,
          flow: '收入',
          rate_daily: rate,
          ...(chainKind ? { chain_kind: chainKind } : {}),
          ...(walletDaily ? { wallet_daily: walletDaily } : {}),
          ...(resourcesDaily ? { resources_daily: resourcesDaily } : {}),
          status: 'active',
          eff: 1,
          deps: {
            base_id: primaryBaseId,
            base: primaryBaseId,
            buildings: [],
            ...(c.vehicles && c.vehicles.length > 0 ? { vehicles: [...c.vehicles] } : {}),
            ...(c.faction ? { faction: c.faction } : {}),
            world_resource: '',
          },
          capacity: {
            total_yield: defaultTotalCap,
            ...(defaultTotalCap != null ? { total: defaultTotalCap } : {}),
            extracted: 0,
          },
          reason: `任务「${questName}」达成开通`,
          updated_at_day: data.clock?.day ?? 0,
        };
        chainsArr.push(newChainEntry);
      }
    }
    syncEconomyChainDailySummary(data);
  }

  // 7.2 战略协议线索/启封 -> data.protocols
  if (rewards.protocols && rewards.protocols.length > 0) {
    const protoArr = (data.protocols ??= []);
    for (const pName of rewards.protocols) {
      const existingProto = (protoArr as Array<Record<string, unknown>>).find(
        p => canon(String(p.name ?? p.ref ?? '')) === canon(pName) || canon(String(p.id ?? p.ref ?? '')) === canon(pName),
      ) as Record<string, unknown> | undefined;
      if (existingProto) {
        if (existingProto.status === 'unrevealed') {
          existingProto.status = 'revealed';
        }
      } else {
        protoArr.push({
          id: pName,
          name: pName,
          tier: 1,
          status: 'revealed',
          progress: 0,
          locked_points: 0,
        });
      }
    }
  }

  // 7.3 地方势力态度升级 -> data.factions
  if (rewards.factions && rewards.factions.length > 0) {
    const facArr = (data.factions ??= []);
    for (const f of rewards.factions) {
      const existingFac = facArr.find(item => canon(item.name) === canon(f.name));
      if (existingFac) {
        if (f.attitude) existingFac.attitude = f.attitude;
        if (f.intel) existingFac.intel = f.intel;
      } else {
        facArr.push({
          name: f.name,
          attitude: f.attitude ?? '友善',
          intel: f.intel ?? `经由任务「${questName}」建立联系`,
          risk: '低',
        });
      }
    }
  }

  // 7.4 本地外币钱袋 -> data.economy.wallet
  if (rewards.wallet && typeof rewards.wallet === 'object') {
    const walletMap = (data.economy.wallet ??= {});
    for (const [curr, rawAmt] of Object.entries(rewards.wallet)) {
      const amt = Math.min(QUEST_HARD_CAP_WALLET, Math.max(0, Number(rawAmt) || 0));
      if (amt <= 0) continue;
      const existingCurr = Object.keys(walletMap).find(k => canon(k) === canon(curr)) ?? curr;
      walletMap[existingCurr] = (walletMap[existingCurr] ?? 0) + amt;
    }
  }

  // 7.5 参战机娘好感/服从/特质 -> data.forces.girls
  if (rewards.girl_rewards && rewards.girl_rewards.length > 0) {
    const girlsArr = (data.forces.girls ??= []);
    for (const gr of rewards.girl_rewards) {
      const targetGirl = girlsArr.find(
        g => canon(g.name) === canon(gr.name) || (g.callsign && canon(g.callsign) === canon(gr.name)),
      );
      if (targetGirl) {
        if (typeof gr.affection_delta === 'number' && gr.affection_delta !== 0) {
          const clamped = Math.max(
            -QUEST_HARD_CAP_GIRL_DELTA,
            Math.min(QUEST_HARD_CAP_GIRL_DELTA, gr.affection_delta),
          );
          targetGirl.affection = Math.max(0, Math.min(100, (targetGirl.affection ?? 50) + clamped));
        }
        if (typeof gr.obedience_delta === 'number' && gr.obedience_delta !== 0) {
          const clamped = Math.max(
            -QUEST_HARD_CAP_GIRL_DELTA,
            Math.min(QUEST_HARD_CAP_GIRL_DELTA, gr.obedience_delta),
          );
          targetGirl.obedience = Math.max(0, Math.min(100, (targetGirl.obedience ?? 50) + clamped));
        }
        if (gr.traits && gr.traits.length > 0) {
          const prevTraits = targetGirl.traits ?? [];
          targetGirl.traits = Array.from(new Set([...prevTraits, ...gr.traits]));
        }
      }
    }
  }

  // 7.6 在研科技进度助力 -> data.queues
  if (rewards.tech_boost && rewards.tech_boost.name && rewards.tech_boost.progress_delta > 0) {
    const delta = Math.min(QUEST_HARD_CAP_TECH_BOOST, rewards.tech_boost.progress_delta);
    const qItem = (data.queues ?? []).find(
      q => q.type === '研究' && canon(q.item) === canon(rewards.tech_boost!.name),
    );
    if (qItem) {
      qItem.progress = Math.min(100, (qItem.progress ?? 0) + delta);
      if (typeof qItem.total_minutes === 'number' && qItem.total_minutes > 0) {
        const extraMin = Math.round((qItem.total_minutes * delta) / 100);
        qItem.spent_minutes = Math.min(qItem.total_minutes, (qItem.spent_minutes ?? 0) + extraMin);
      }
    }
  }
}

function extractQuestItemsFromBlock(rawBlock: unknown): unknown[] {
  if (rawBlock == null) return [];
  if (Array.isArray(rawBlock)) return rawBlock;
  if (!isUsable(rawBlock)) return [];

  const obj = rawBlock as Record<string, unknown>;
  const idx = keyIndex(obj);

  // 检查是否为包装对象（如 { 任务: [...] } / { quests: [...] }）
  const wrapperAliases = ['任务', '作战任务', '任务列表', 'quests', 'missions', 'items', '列表'];
  const hasExplicitNameKey = ['名称', '任务名', '标题', 'name', 'title'].some(k => idx.has(canon(k)));
  for (const wa of wrapperAliases) {
    const k = idx.get(canon(wa));
    if (k !== undefined) {
      const val = obj[k];
      if (Array.isArray(val)) return val;
      if (isUsable(val) && !hasExplicitNameKey) {
        return extractQuestItemsFromBlock(val);
      }
    }
  }

  // 检查是否为单任务对象
  const allQuestFieldAliases = [
    ...QUEST_NAME_ALIASES,
    ...QUEST_CATEGORY_ALIASES,
    ...QUEST_STATUS_ALIASES,
    ...QUEST_ISSUER_ALIASES,
    ...QUEST_SERIES_ALIASES,
    ...QUEST_CHAIN_STEP_ALIASES,
    ...QUEST_NEXT_ALIASES,
    ...QUEST_PROGRESS_ALIASES,
    ...QUEST_NOTE_ALIASES,
    ...QUEST_DETAIL_ALIASES,
    ...QUEST_REWARD_ALIASES,
  ];
  if (allQuestFieldAliases.some(a => idx.has(canon(a)))) {
    return [obj];
  }

  // 兼容字典写法 { 任务A: { 进度: '...' }, 任务B: { 进度: '...' } }
  const mapped: unknown[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (isUsable(v) && !Array.isArray(v)) {
      mapped.push({ 名称: k, ...(v as Record<string, unknown>) });
    }
  }
  return mapped.length > 0 ? mapped : [obj];
}

/**
 * FD-29 <任务> 块解析与四态流转 + 悬赏自动交割入口
 */
export function applyQuestBlock(
  rawBlock: unknown,
  data: StatData,
  ctx: Ctx,
  opts?: { fromEvent?: boolean; fromWarStat?: boolean },
): void {
  const items = extractQuestItemsFromBlock(rawBlock);
  if (items.length === 0) return;

  const questsState = data.quests as unknown as {
    active: Quest[];
    history?: Quest[];
    done_count: number;
  };

  for (const rawItem of items) {
    const itemObj: Record<string, unknown> | null =
      typeof rawItem === 'string' && rawItem.trim()
        ? { 名称: rawItem.trim() }
        : isUsable(rawItem) && !Array.isArray(rawItem)
          ? (rawItem as Record<string, unknown>)
          : null;

    if (!itemObj) {
      ctx.quarantine.push({
        scope: 'element',
        tag: opts?.fromEvent ? '事件' : '任务',
        path: 'quests',
        raw: JSON.stringify(rawItem).slice(0, 200),
        error: '任务项不是有效对象',
      });
      continue;
    }

    const idx = keyIndex(itemObj);
    const consumed = new Set<string>();

    const nameT = take(itemObj, idx, consumed, QUEST_NAME_ALIASES);
    const rawName = String(nameT?.value ?? '').trim();
    if (!rawName) {
      ctx.quarantine.push({
        scope: 'element',
        tag: opts?.fromEvent ? '事件' : '任务',
        path: 'quests',
        raw: JSON.stringify(itemObj).slice(0, 200),
        error: '任务缺少「名称」',
        suggestion: '示例：- 名称: 铁幕前哨·废弃货场清剿',
      });
      continue;
    }

    const alignPath = opts?.fromEvent ? `事件[任务接取·${rawName}]` : `任务[${rawName}]`;
    const name = applyAlign(rawName, ctx, alignPath, 'entity');

    const catT = take(itemObj, idx, consumed, QUEST_CATEGORY_ALIASES);
    let category: QuestCategoryLiteral | undefined;
    if (catT && catT.value != null && String(catT.value).trim() !== '') {
      const rawCat = String(catT.value).trim();
      if (canon(rawCat) !== canon('任务接取')) {
        category = normalizeQuestCategory(rawCat, ctx, name);
      }
    }

    const statusT = take(itemObj, idx, consumed, QUEST_STATUS_ALIASES);
    const status: QuestStatusLiteral =
      statusT && statusT.value != null && String(statusT.value).trim() !== ''
        ? normalizeQuestStatus(statusT.value, ctx, name)
        : '进行中';

    const issuerT = take(itemObj, idx, consumed, QUEST_ISSUER_ALIASES);
    const issuer = issuerT && issuerT.value != null ? String(issuerT.value).trim() : undefined;

    const seriesT = take(itemObj, idx, consumed, QUEST_SERIES_ALIASES);
    const series =
      seriesT && seriesT.value != null && String(seriesT.value).trim() !== ''
        ? String(seriesT.value).trim()
        : undefined;

    const chainStepT = take(itemObj, idx, consumed, QUEST_CHAIN_STEP_ALIASES);
    const chainStep =
      chainStepT && chainStepT.value != null && String(chainStepT.value).trim() !== ''
        ? String(chainStepT.value).trim()
        : undefined;

    const nextQuestT = take(itemObj, idx, consumed, QUEST_NEXT_ALIASES);
    const nextQuest =
      nextQuestT && nextQuestT.value != null && String(nextQuestT.value).trim() !== ''
        ? String(nextQuestT.value).trim()
        : undefined;

    const progT = take(itemObj, idx, consumed, QUEST_PROGRESS_ALIASES);
    const progress = progT && progT.value != null ? String(progT.value).trim() : undefined;

    const noteT = take(itemObj, idx, consumed, QUEST_NOTE_ALIASES);
    const note = noteT && noteT.value != null ? String(noteT.value).trim() : undefined;

    const detailT = take(itemObj, idx, consumed, QUEST_DETAIL_ALIASES);
    const detail = detailT && detailT.value != null ? String(detailT.value).trim() : undefined;

    const rewardT = take(itemObj, idx, consumed, ['奖励', '悬赏', '报酬', 'reward', 'rewards']);
    const lootT = take(itemObj, idx, consumed, ['战利品', '物品', 'items', 'loot']);
    let parsedReward = rewardT ? parseQuestReward(rewardT.value, data, ctx, name) : undefined;
    if (lootT && lootT.value != null) {
      const extraItems = asArray(lootT.value).map(x => String(x ?? '').trim()).filter(Boolean);
      if (extraItems.length > 0) {
        parsedReward = mergeQuestRewards(parsedReward, {
          credits: 0,
          intel_points: 0,
          resources: {},
          items: extraItems,
          text: '',
        });
      }
    }

    const floorT = take(itemObj, idx, consumed, ['楼层', '更新楼层', 'updated_floor', 'floor']);
    const updatedFloor = floorT && floorT.value != null ? toNum(floorT.value) ?? undefined : undefined;

    const activeIdx = questsState.active.findIndex(q => canon(q.name) === canon(name));
    const existingActive = activeIdx >= 0 ? questsState.active[activeIdx] : undefined;

    if (status === '进行中') {
      if (existingActive) {
        if (category !== undefined) existingActive.category = category;
        else if (!opts?.fromEvent && !opts?.fromWarStat && !existingActive.category) existingActive.category = '支线';
        if (!opts?.fromEvent && !opts?.fromWarStat) existingActive.status = '进行中';
        if (issuer !== undefined && issuer !== '') existingActive.issuer = issuer;
        if (series !== undefined) existingActive.series = series;
        if (chainStep !== undefined) existingActive.chain_step = chainStep;
        if (nextQuest !== undefined) existingActive.next_quest = nextQuest;
        if (progress !== undefined && progress !== '') existingActive.progress = progress;
        if (note !== undefined && note !== '') existingActive.note = note;
        if (detail !== undefined && detail !== '') existingActive.detail = detail;
        if (parsedReward !== undefined) {
          existingActive.rewards = mergeQuestRewards(existingActive.rewards, parsedReward);
        }
        if (updatedFloor !== undefined) existingActive.updated_floor = updatedFloor;
        ctx.appliedCount++;
        if (opts?.fromEvent) {
          green(
            ctx,
            {
              layer: 'L2',
              path: `quests.active[${name}]`,
              message: `[事件] 在编任务「${name}」已更新（${progress ? `进度:${progress}` : '详情'}）`,
            },
            { rule: 'R18', target: '事件', message: `事件任务「${name}」已入账（在编更新）` },
          );
        } else if (!opts?.fromWarStat) {
          green(
            ctx,
            {
              layer: 'L2',
              path: `quests.active[${name}]`,
              message: `[任务] 在途任务「${name}」进度已更新`,
            },
            { rule: 'R18', target: '任务', message: `任务「${name}」进度已更新` },
          );
        }
        continue;
      }

      // 新建在途任务
      const isLegacyMinimal = Boolean(opts?.fromEvent || opts?.fromWarStat);
      const existingHistForActive = questsState.history?.find(h => canon(h.name) === canon(name));
      const candidate: Record<string, unknown> = {
        name,
        progress: progress ?? '',
        note: note ?? '',
        detail: detail ?? '',
      };
      if (!isLegacyMinimal) {
        candidate.category = category ?? '支线';
        candidate.status = '进行中';
        candidate.issuer = issuer ?? '';
        candidate.reward_claimed = false;
      } else {
        if (category !== undefined) candidate.category = category;
        if (issuer !== undefined && issuer !== '') candidate.issuer = issuer;
      }
      const resolvedActiveSeries = series ?? existingHistForActive?.series;
      const resolvedActiveChainStep = chainStep ?? existingHistForActive?.chain_step;
      const resolvedActiveNextQuest = nextQuest ?? existingHistForActive?.next_quest;
      if (resolvedActiveSeries !== undefined) candidate.series = resolvedActiveSeries;
      if (resolvedActiveChainStep !== undefined) candidate.chain_step = resolvedActiveChainStep;
      if (resolvedActiveNextQuest !== undefined) candidate.next_quest = resolvedActiveNextQuest;
      if (parsedReward !== undefined) candidate.rewards = parsedReward;
      if (updatedFloor !== undefined) candidate.updated_floor = updatedFloor;

      const checked = Quest.safeParse(candidate);
      if (!checked.success) {
        ctx.quarantine.push({
          scope: 'element',
          tag: opts?.fromEvent ? '事件' : '任务',
          path: `quests.active[${name}]`,
          raw: JSON.stringify(itemObj).slice(0, 200),
          error: `任务声明「${name}」未通过实体校验`,
          suggestion: checked.error.issues.map(i => i.message).join('; '),
        });
        continue;
      }
      questsState.active.push(checked.data);
      ctx.appliedCount++;
      if (opts?.fromEvent) {
        green(
          ctx,
          {
            layer: 'L2',
            path: `quests.active[${name}]`,
            message: `[事件] 新任务「${name}」已接取入编（active）`,
          },
          { rule: 'R18', target: '事件', message: `新任务「${name}」已入编 quests.active` },
        );
      } else if (!opts?.fromWarStat) {
        green(
          ctx,
          {
            layer: 'L2',
            path: `quests.active[${name}]`,
            message: `[任务] 新作战任务「${name}」已发布入列`,
          },
          { rule: 'R18', target: '任务', message: `新任务「${name}」已入列 quests.active` },
        );
      }
      continue;
    }

    if (status === '已完成') {
      if (activeIdx >= 0) {
        questsState.active.splice(activeIdx, 1);
      }
      const historyList = (questsState.history ??= []);
      const claimedIdx = historyList.findIndex(h => canon(h.name) === canon(name) && h.reward_claimed === true);
      const existingHistory = historyList.find(h => canon(h.name) === canon(name));
      const baseQuest = existingActive ?? (claimedIdx >= 0 ? historyList[claimedIdx] : existingHistory);
      const mergedRewards = mergeQuestRewards(baseQuest?.rewards, parsedReward);

      if (claimedIdx >= 0) {
        const prevClaimed = historyList[claimedIdx];
        if (category !== undefined) prevClaimed.category = category;
        if (issuer !== undefined && issuer !== '') prevClaimed.issuer = issuer;
        const nextSeries = series ?? existingActive?.series;
        const nextChainStep = chainStep ?? existingActive?.chain_step;
        const nextNextQuest = nextQuest ?? existingActive?.next_quest;
        if (nextSeries !== undefined) prevClaimed.series = nextSeries;
        if (nextChainStep !== undefined) prevClaimed.chain_step = nextChainStep;
        if (nextNextQuest !== undefined) prevClaimed.next_quest = nextNextQuest;
        if (progress !== undefined && progress !== '') prevClaimed.progress = progress;
        if (note !== undefined && note !== '') prevClaimed.note = note;
        if (detail !== undefined && detail !== '') prevClaimed.detail = detail;
        if (updatedFloor !== undefined) prevClaimed.updated_floor = updatedFloor;
        ctx.appliedCount++;
        yellow(
          ctx,
          {
            layer: 'L2',
            path: `quests.history[${name}]`,
            message: `[任务] 任务「${name}」此前已完成悬赏交割，幂等跳过重复奖励发放与计数`,
          },
          { rule: 'R18', target: '任务', message: `任务「${name}」重复完成交割已幂等拦截` },
        );
        continue;
      }

      const resolvedCategory: QuestCategoryLiteral = category ?? baseQuest?.category ?? '支线';
      settleQuestRewards(name, mergedRewards, data, ctx, resolvedCategory);

      const resolvedSeries = series ?? existingActive?.series ?? existingHistory?.series;
      const resolvedChainStep = chainStep ?? existingActive?.chain_step ?? existingHistory?.chain_step;
      const resolvedNextQuest = nextQuest ?? existingActive?.next_quest ?? existingHistory?.next_quest;

      const completedQuest: Quest = {
        name,
        category: resolvedCategory,
        status: '已完成',
        issuer: issuer ?? baseQuest?.issuer ?? '',
        ...(resolvedSeries !== undefined ? { series: resolvedSeries } : {}),
        ...(resolvedChainStep !== undefined ? { chain_step: resolvedChainStep } : {}),
        ...(resolvedNextQuest !== undefined ? { next_quest: resolvedNextQuest } : {}),
        progress: progress ?? baseQuest?.progress ?? '',
        note: note ?? baseQuest?.note ?? '',
        detail: detail ?? baseQuest?.detail ?? '',
        ...(mergedRewards ? { rewards: mergedRewards } : {}),
        reward_claimed: true,
        ...(updatedFloor !== undefined
          ? { updated_floor: updatedFloor }
          : baseQuest?.updated_floor !== undefined
            ? { updated_floor: baseQuest.updated_floor }
            : {}),
      };

      const existingHistoryIdx = historyList.findIndex(h => canon(h.name) === canon(name));
      if (existingHistoryIdx >= 0) {
        historyList.splice(existingHistoryIdx, 1);
      }
      historyList.unshift(completedQuest);
      if (historyList.length > QUEST_HISTORY_LIMIT) {
        historyList.length = QUEST_HISTORY_LIMIT;
      }
      questsState.done_count = (questsState.done_count ?? 0) + 1;
      ctx.appliedCount++;
      green(
        ctx,
        {
          layer: 'L2',
          path: `quests.history[${name}]`,
          message: `[任务] 作战任务「${name}」已达成并完成悬赏交割`,
        },
        { rule: 'R18', target: '任务', message: `任务「${name}」已完成并交割悬赏` },
      );
      continue;
    }

    // status === '已失败' || status === '已取消'
    if (activeIdx >= 0) {
      questsState.active.splice(activeIdx, 1);
    }
    const historyList = (questsState.history ??= []);
    const existingHistoryIdx = historyList.findIndex(
      h => canon(h.name) === canon(name) && h.reward_claimed !== true,
    );
    const existingHistory = existingHistoryIdx >= 0 ? historyList[existingHistoryIdx] : undefined;
    const baseArchived = existingActive ?? existingHistory;
    const mergedRewards = mergeQuestRewards(baseArchived?.rewards, parsedReward);
    const resolvedSeries = series ?? existingActive?.series ?? existingHistory?.series;
    const resolvedChainStep = chainStep ?? existingActive?.chain_step ?? existingHistory?.chain_step;
    const resolvedNextQuest = nextQuest ?? existingActive?.next_quest ?? existingHistory?.next_quest;
    const archivedQuest: Quest = {
      name,
      category: category ?? baseArchived?.category ?? '支线',
      status,
      issuer: issuer ?? baseArchived?.issuer ?? '',
      ...(resolvedSeries !== undefined ? { series: resolvedSeries } : {}),
      ...(resolvedChainStep !== undefined ? { chain_step: resolvedChainStep } : {}),
      ...(resolvedNextQuest !== undefined ? { next_quest: resolvedNextQuest } : {}),
      progress: progress ?? baseArchived?.progress ?? '',
      note: note ?? baseArchived?.note ?? '',
      detail: detail ?? baseArchived?.detail ?? '',
      ...(mergedRewards ? { rewards: mergedRewards } : {}),
      reward_claimed: false,
      ...(updatedFloor !== undefined
        ? { updated_floor: updatedFloor }
        : baseArchived?.updated_floor !== undefined
          ? { updated_floor: baseArchived.updated_floor }
          : {}),
    };

    if (existingHistoryIdx >= 0) {
      historyList[existingHistoryIdx] = archivedQuest;
    } else {
      historyList.unshift(archivedQuest);
      if (historyList.length > QUEST_HISTORY_LIMIT) {
        historyList.length = QUEST_HISTORY_LIMIT;
      }
    }
    ctx.appliedCount++;
    green(
      ctx,
      {
        layer: 'L2',
        path: `quests.history[${name}]`,
        message: `[任务] 作战任务「${name}」已归档为「${status}」`,
      },
      { rule: 'R18', target: '任务', message: `任务「${name}」已归档为「${status}」` },
    );
  }
}

/* ═══════════════ 域字段映射 ═══════════════ */

const BUILDING_COORD_ALIASES = ['坐标', '相对坐标', '相对位置', '方位', '位置', 'coord', 'bearing', 'position'];
const BUILDING_ADDON_ALIASES = ['扩建', '扩建模块', '挂件', '附属模块', 'addons'];
const BUILDING_QTY_ALIASES = ['数量', '座数', '批量', '台数', '件数', 'qty', 'count', 'num'];

/** 建筑元素字段映射 */
export function mapBuilding(
  target: Record<string, unknown>,
  src: Record<string, unknown>,
  idx: Map<string, string>,
  consumed: Set<string>,
  _isNew: boolean,
  path: string,
  ctx: Ctx,
): void {
  setStr(target, 'name', src, idx, consumed, NAME_ALIASES, ctx);
  take(src, idx, consumed, BUILDING_QTY_ALIASES);
  setStr(target, 'layer', src, idx, consumed, ['层级', '层位', 'layer', '所在层'], ctx);
  setEnumField(target, 'state', src, idx, consumed, ['状态', 'state'], ENUM_BUILDING_STATE, ctx, path);
  setNumField(target, 'progress', src, idx, consumed, ['进度', 'progress'], ctx, path, { min: 0, max: 100 });
  setStr(target, 'eta', src, idx, consumed, ['预计', 'eta', '余'], ctx);

  // FD-34：相对于本基地 MCV 原点 (0, 0) 的平面坐标与战术方位双模折算
  const coordT = take(src, idx, consumed, BUILDING_COORD_ALIASES);
  if (coordT && coordT.value != null) {
    const bldName = typeof target.name === 'string' ? target.name : '';
    const parsedCoord = parseRelativeBuildingCoord(coordT.value, bldName);
    if (parsedCoord) {
      target.coord = parsedCoord.coord;
      target.bearing = parsedCoord.bearing;
      ctx.appliedCount++;
    } else if (typeof coordT.value === 'string' && coordT.value.trim()) {
      target.bearing = coordT.value.trim();
      ctx.appliedCount++;
    }
  }

  // FD-22 / FD-37：已挂载于本母体建筑上的原位扩建模块名称列表（可选惰性缺省，旧档零新增键）
  const addonsT = take(src, idx, consumed, BUILDING_ADDON_ALIASES);
  if (addonsT && addonsT.value != null) {
    if (typeof addonsT.value === 'string') {
      const trimmed = addonsT.value.trim();
      if (trimmed) {
        const prev = Array.isArray(target.addons) ? (target.addons as string[]) : [];
        target.addons = Array.from(new Set([...prev, trimmed]));
        ctx.appliedCount++;
      }
    } else if (Array.isArray(addonsT.value)) {
      const next = Array.from(
        new Set(
          addonsT.value
            .filter((x): x is string => typeof x === 'string')
            .map(x => x.trim())
            .filter(Boolean),
        ),
      );
      target.addons = next;
      ctx.appliedCount++;
    }
  }
}

const BUILDING_KNOWN_FIELD_CANONS = new Set(
  [
    ...NAME_ALIASES,
    '层级',
    '层位',
    'layer',
    '所在层',
    '状态',
    'state',
    '进度',
    'progress',
    '预计',
    'eta',
    '余',
    ...BUILDING_COORD_ALIASES,
    ...BUILDING_ADDON_ALIASES,
    ...BUILDING_QTY_ALIASES,
  ].map(k => canon(k)),
);

function normalizeBuildingInputItems(items: unknown): unknown {
  if (isUsable(items) && !Array.isArray(items)) {
    const obj = items as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length > 0 && !keys.some(k => BUILDING_KNOWN_FIELD_CANONS.has(canon(k)))) {
      return keys.map(k => {
        const v = obj[k];
        if (typeof v === 'number') return { 名称: k, 数量: v };
        if (typeof v === 'string') {
          if (/^\d+\s*(?:座|台|个|处)?$/.test(v.trim())) return { 名称: k, 数量: v.trim() };
          return { 名称: k, 状态: v };
        }
        if (isUsable(v) && !Array.isArray(v)) return { 名称: k, ...(v as Record<string, unknown>) };
        return { 名称: k };
      });
    }
  }
  if (!Array.isArray(items)) return items;
  return items.map(rawItem => {
    if (typeof rawItem === 'string') {
      const m = rawItem.trim().match(/^(.+?)[（(](运转|建造中|受损|停机|运行|运转中|运行中|正常|完好)[)）]$/);
      if (m) return { 名称: m[1].trim(), 状态: m[2].trim() };
      return rawItem.trim() ? { 名称: rawItem.trim(), 状态: '运转' } : rawItem;
    }
    if (isUsable(rawItem) && !Array.isArray(rawItem)) {
      const obj = rawItem as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (keys.length === 1 && !BUILDING_KNOWN_FIELD_CANONS.has(canon(keys[0]))) {
        const k = keys[0];
        const v = obj[k];
        if (typeof v === 'number') return { 名称: k, 数量: v };
        if (typeof v === 'string') {
          if (/^\d+\s*(?:座|台|个|处)?$/.test(v.trim())) return { 名称: k, 数量: v.trim() };
          return { 名称: k, 状态: v };
        }
        if (isUsable(v) && !Array.isArray(v)) return { 名称: k, ...(v as Record<string, unknown>) };
      }
    }
    return rawItem;
  });
}

const CHINESE_ORDINAL_MAP: Record<string, number> = {
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function parseBuildingMultiOrdinal(rawName: string): { cleanName: string; ordinal: number | null } {
  const trimmed = rawName.trim();
  const hashMatch = trimmed.match(/^(.*?)\s*#\s*([2-9]|\d{2,})$/);
  if (hashMatch && hashMatch[1].trim()) {
    return { cleanName: hashMatch[1].trim(), ordinal: Number(hashMatch[2]) };
  }
  const parenMatch = trimmed.match(
    /^(.*?)\s*[（(]\s*(?:第\s*)?([二三四五六七八九十]|[2-9]|\d{2,})\s*(?:号|座)\s*[)）]$/,
  );
  if (parenMatch && parenMatch[1].trim()) {
    const rawOrd = parenMatch[2];
    const ord = CHINESE_ORDINAL_MAP[rawOrd] ?? Number(rawOrd);
    if (Number.isFinite(ord) && ord >= 2) {
      return { cleanName: parenMatch[1].trim(), ordinal: ord };
    }
  }
  return { cleanName: trimmed, ordinal: null };
}

/** 基地内建筑数组 upsert（FD-38 · BUG-BASE-02：支持同一基地内多座同名建筑按坐标/方位或显式序号并存） */
export function upsertBuildings(baseTarget: Record<string, unknown>, items: unknown, ctx: Ctx, basePath: string): void {
  if (!Array.isArray(baseTarget.buildings)) baseTarget.buildings = [];
  const arr = baseTarget.buildings as Record<string, unknown>[];
  const normalizedItems = normalizeBuildingInputItems(items);
  const label = `${basePath}.建筑`;
  const claimedInBatch = new Set<Record<string, unknown>>();

  for (const rawItem of asArray(normalizedItems)) {
    if (!isUsable(rawItem) || Array.isArray(rawItem)) {
      ctx.quarantine.push({
        scope: 'element',
        tag: label,
        path: label,
        raw: JSON.stringify(rawItem),
        error: '数组元素非对象',
      });
      continue;
    }
    const src = rawItem as Record<string, unknown>;
    const idx = keyIndex(src);
    const consumed = new Set<string>();
    const loc = take(src, idx, consumed, NAME_ALIASES);
    const rawName = loc && loc.value != null ? String(loc.value).trim() : '';
    if (!rawName) {
      ctx.quarantine.push({
        scope: 'element',
        tag: label,
        path: label,
        raw: JSON.stringify(src),
        error: `缺少定位键(${NAME_ALIASES[0]})`,
        suggestion: `补充 ${NAME_ALIASES[0]} 字段`,
      });
      continue;
    }

    const { cleanName, ordinal } = parseBuildingMultiOrdinal(rawName);
    const alignedName = applyAlign(cleanName, ctx, `${label}[${cleanName}]`, 'entity');

    // 解析可选建筑数量（如 数量: 2），按声明座数幂等展开补齐同名建筑实例
    let requestedCount = 1;
    const qtyT = take(src, idx, consumed, BUILDING_QTY_ALIASES);
    if (qtyT && qtyT.value != null) {
      const rawQtyStr = typeof qtyT.value === 'string' ? qtyT.value.trim().replace(/(?:座|台|个|处)$/, '') : qtyT.value;
      const parsedQty = toNum(rawQtyStr);
      if (parsedQty != null && Number.isFinite(parsedQty) && parsedQty >= 1) {
        requestedCount = Math.min(20, Math.floor(parsedQty));
      }
    }

    // 探测传入项是否带有显式坐标或方位
    let incomingCoord: { x: number; y: number } | undefined;
    let incomingBearing: string | undefined;
    for (const alias of BUILDING_COORD_ALIASES) {
      const k = idx.get(canon(alias));
      if (k !== undefined && src[k] != null) {
        const parsedCoord = parseRelativeBuildingCoord(src[k], alignedName);
        if (parsedCoord) {
          incomingCoord = parsedCoord.coord;
          incomingBearing = parsedCoord.bearing;
        } else if (typeof src[k] === 'string' && src[k].trim()) {
          incomingBearing = src[k].trim();
        }
        break;
      }
    }

    // 探测传入项状态是否为建造中
    let incomingState: string | undefined;
    for (const alias of ['状态', 'state']) {
      const k = idx.get(canon(alias));
      if (k !== undefined && src[k] != null) {
        const resolved = resolveEnum(src[k], ENUM_BUILDING_STATE);
        incomingState = resolved.value ?? String(src[k]).trim();
        break;
      }
    }

    for (let rep = 0; rep < requestedCount; rep++) {
      const repConsumed = rep === 0 ? consumed : new Set<string>(consumed);
      const sameNameList = arr.filter(
        e => !claimedInBatch.has(e) && canon(String(e.name ?? '')) === canon(alignedName),
      );
      let matchedExisting: Record<string, unknown> | undefined;

      if (sameNameList.length > 0) {
        if (rep > 0) {
          // 数量展开的第 2..N 座：若基地内已有未认领的同名建筑则直接复用更新，避免重复展开膨胀
          matchedExisting = sameNameList[0];
        } else {
          // 1. 坐标精确命中既有实例
          if (incomingCoord) {
            matchedExisting = sameNameList.find(b => {
              const c = b.coord as { x?: number; y?: number } | undefined;
              return c && typeof c.x === 'number' && typeof c.y === 'number' && c.x === incomingCoord!.x && c.y === incomingCoord!.y;
            });
          }
          if (!matchedExisting && incomingBearing && !incomingCoord) {
            matchedExisting = sameNameList.find(
              b => typeof b.bearing === 'string' && b.bearing.trim() && canon(b.bearing) === canon(incomingBearing!),
            );
          }

          // 2. 显式多座序号（如 #2 / （二号））
          if (!matchedExisting && ordinal !== null && ordinal >= 2) {
            if (sameNameList.length >= ordinal) {
              matchedExisting = sameNameList[ordinal - 1];
            } else {
              matchedExisting = undefined; // 作为新增的第 N 座追加
            }
          } else if (!matchedExisting) {
            // 3. 基地内存在 state === '建造中' 的同名建筑
            const underConstCandidate = sameNameList.find(b => {
              if (b.state !== '建造中') return false;
              if (!incomingCoord) return true;
              const c = b.coord as { x?: number; y?: number } | undefined;
              if (!c || typeof c.x !== 'number' || typeof c.y !== 'number') return true;
              if (c.x === incomingCoord.x && c.y === incomingCoord.y) return true;
              return incomingState !== '建造中';
            });
            if (underConstCandidate) {
              matchedExisting = underConstCandidate;
            } else if (incomingCoord || incomingBearing) {
              // 4. 传入了明确新坐标/方位
              const uncoordinated = sameNameList.find(b => !b.coord && !(typeof b.bearing === 'string' && b.bearing.trim()));
              if (uncoordinated) {
                matchedExisting = uncoordinated;
              } else {
                matchedExisting = undefined;
              }
            } else {
              // 5. 未传新坐标且无显式序号：原地更新第一座同名建筑
              matchedExisting = sameNameList[0];
            }
          }
        }
      }

      if (matchedExisting) {
        claimedInBatch.add(matchedExisting);
        mapBuilding(matchedExisting, src, idx, repConsumed, false, `${label}[${alignedName}]`, ctx);
        matchedExisting.name = alignedName;
        if (rep === 0) {
          quarantineLeftovers(src, repConsumed, ctx, `${label}[${alignedName}]`);
        }
        ctx.appliedCount++;
      } else {
        const elem: Record<string, unknown> = { name: alignedName, layer: '', state: '运转' };
        mapBuilding(elem, src, idx, repConsumed, true, `${label}[${alignedName}]`, ctx);
        elem.name = alignedName;
        const parsed = Building.safeParse(elem);
        if (!parsed.success) {
          if (rep === 0) {
            ctx.quarantine.push({
              scope: 'element',
              tag: label,
              path: `${label}[${alignedName}]`,
              raw: JSON.stringify(src),
              error: '新元素未通过 schema 校验',
              suggestion: parsed.error.issues.map(i => i.message).join('; '),
            });
          }
          break;
        }
        const nextElem = parsed.data as Record<string, unknown>;
        arr.push(nextElem);
        claimedInBatch.add(nextElem);
        if (rep === 0) {
          quarantineLeftovers(src, repConsumed, ctx, `${label}[${alignedName}]`);
        }
        ctx.appliedCount++;
      }
    }
  }
}

const BASE_SECTOR_FIELD_ALIASES = ['防区', '子区域', '环境工程', '配套设施', '基础设施', '辖区', 'sectors'];
const BASE_RENAME_META_ALIASES = [
  'id',
  '基地ID',
  'base_id',
  '原名称',
  '曾用名',
  '旧名称',
  '原基地名',
  'rename_from',
  'old_name',
];
const BASE_KNOWN_FIELD_CANONS = new Set(
  [
    ...NAME_ALIASES,
    ...BASE_RENAME_META_ALIASES,
    '地点',
    '位置',
    'location',
    '状态',
    'status',
    '天气',
    '局部天气',
    '气象',
    '天候',
    'weather',
    '时区',
    '标准时差',
    '时差',
    'tz_offset',
    'timezone',
    '选址',
    '地形',
    '环境',
    'site_type',
    'terrain',
    '电力',
    'power',
    '警报',
    'alerts',
    '建筑',
    'buildings',
    '驻军',
    '部队',
    '兵力',
    'forces',
    ...BASE_SECTOR_FIELD_ALIASES,
  ].map(k => canon(k)),
);

/**
 * 归一 `<态势>` 中 `基地` 字段输入：兼容以基地名为 Key 的字典对象形态（如 `{ 恶土前哨主基地: { 状态: '警戒', 建筑: ... } }`）
 */
export function normalizeBaseInputItems(items: unknown): unknown {
  if (isUsable(items) && !Array.isArray(items)) {
    const obj = items as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (
      keys.length > 0 &&
      !keys.some(k => BASE_KNOWN_FIELD_CANONS.has(canon(k))) &&
      keys.every(k => isUsable(obj[k]) && !Array.isArray(obj[k]))
    ) {
      return keys.map(k => ({ 名称: k, ...(obj[k] as Record<string, unknown>) }));
    }
  }
  if (!Array.isArray(items)) return items;
  return items.map(rawItem => {
    if (isUsable(rawItem) && !Array.isArray(rawItem)) {
      const obj = rawItem as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (
        keys.length === 1 &&
        !BASE_KNOWN_FIELD_CANONS.has(canon(keys[0])) &&
        isUsable(obj[keys[0]]) &&
        !Array.isArray(obj[keys[0]])
      ) {
        const k = keys[0];
        return { 名称: k, ...(obj[k] as Record<string, unknown>) };
      }
    }
    return rawItem;
  });
}
const SECTOR_STATUS_KEYWORDS = new Set(['正常', '运转', '运转中', '完好', '警戒', '施工中', '建造中', '改造中', '受损', '停机', '废弃']);
const SECTOR_LAYER_HINT_RE = /(?:地表|地下|山体|空腔|半山腰|山崖|洞口|洞内|外围|外部|深层|顶层|中层|底层|层)/;

function parseSectorShorthandString(rawStr: string): {
  name: string;
  layer: string;
  status: string;
  desc: string;
} | null {
  const trimmed = rawStr.trim();
  if (!trimmed) return null;

  const parenMatch = trimmed.match(/^(.+?)\s*[（(]([^）)]+)[)）]$/);
  if (parenMatch) {
    const baseName = parenMatch[1].trim();
    const inner = parenMatch[2].trim();
    const parts = inner
      .split(/[·•/｜|,，;；\s]+/)
      .map(s => s.trim())
      .filter(Boolean);

    let layer = '';
    let status = '';
    const extraDesc: string[] = [];
    for (const part of parts) {
      if (!status && SECTOR_STATUS_KEYWORDS.has(part)) {
        status = part === '运转' || part === '运转中' || part === '完好' ? '正常' : part === '建造中' || part === '改造中' ? '施工中' : part;
      } else if (!layer && SECTOR_LAYER_HINT_RE.test(part)) {
        layer = part;
      } else {
        extraDesc.push(part);
      }
    }

    if (layer || status) {
      return {
        name: baseName,
        layer,
        status: status || '正常',
        desc: extraDesc.join('·'),
      };
    }
  }

  return {
    name: trimmed,
    layer: '',
    status: '正常',
    desc: '',
  };
}

function upsertBaseSectors(
  target: Record<string, unknown>,
  rawSectorInputs: unknown[],
  ctx: Ctx,
  basePath: string,
): void {
  const existingList: Array<{ name: string; layer: string; status: string; desc: string }> = Array.isArray(
    target.sectors,
  )
    ? (target.sectors as Array<Record<string, unknown>>).map(s => ({
        name: String(s.name ?? '').trim(),
        layer: String(s.layer ?? '').trim(),
        status: String(s.status ?? '正常').trim() || '正常',
        desc: String(s.desc ?? '').trim(),
      }))
    : [];

  let mutated = false;

  const mergeOneSector = (item: { name: string; layer?: string; status?: string; desc?: string }) => {
    const name = item.name.trim();
    if (!name) return;
    const cName = canon(name);
    const found = existingList.find(s => canon(s.name) === cName);
    if (found) {
      if (item.layer && item.layer.trim()) found.layer = item.layer.trim();
      if (item.status && item.status.trim()) found.status = item.status.trim();
      if (item.desc && item.desc.trim()) found.desc = item.desc.trim();
      mutated = true;
    } else {
      const candidate = {
        name,
        layer: item.layer?.trim() ?? '',
        status: item.status?.trim() || '正常',
        desc: item.desc?.trim() ?? '',
      };
      const parsed = BaseSector.safeParse(candidate);
      if (parsed.success) {
        existingList.push(parsed.data);
        mutated = true;
      }
    }
  };

  const SECTOR_KNOWN_KEYS = new Set(
    [...NAME_ALIASES, '层级', '层位', '所在层', 'layer', '状态', 'status', '描述', '简介', '说明', '效能', 'desc'].map(
      k => canon(k),
    ),
  );

  for (const inputVal of rawSectorInputs) {
    if (typeof inputVal === 'string') {
      const parsed = parseSectorShorthandString(inputVal);
      if (parsed) mergeOneSector(parsed);
      continue;
    }
    if (isUsable(inputVal) && !Array.isArray(inputVal)) {
      const obj = inputVal as Record<string, unknown>;
      const keys = Object.keys(obj);
      const hasKnownField = keys.some(k => SECTOR_KNOWN_KEYS.has(canon(k)));
      if (!hasKnownField) {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string') {
            const sub = parseSectorShorthandString(`${k}（${v}）`) ?? {
              name: k,
              layer: '',
              status: '正常',
              desc: v,
            };
            mergeOneSector(sub);
          } else if (isUsable(v) && !Array.isArray(v)) {
            const vObj = v as Record<string, unknown>;
            const vIdx = keyIndex(vObj);
            const vConsumed = new Set<string>();
            const lT = take(vObj, vIdx, vConsumed, ['层级', '层位', '所在层', 'layer']);
            const sT = take(vObj, vIdx, vConsumed, ['状态', 'status']);
            const dT = take(vObj, vIdx, vConsumed, ['描述', '简介', '说明', '效能', 'desc']);
            mergeOneSector({
              name: k,
              layer: lT?.value != null ? String(lT.value) : undefined,
              status: sT?.value != null ? String(sT.value) : undefined,
              desc: dT?.value != null ? String(dT.value) : undefined,
            });
          }
        }
        continue;
      }
    }
    for (const elem of asArray(inputVal)) {
      if (typeof elem === 'string') {
        const parsed = parseSectorShorthandString(elem);
        if (parsed) mergeOneSector(parsed);
      } else if (isUsable(elem) && !Array.isArray(elem)) {
        const sObj = elem as Record<string, unknown>;
        const sIdx = keyIndex(sObj);
        const sConsumed = new Set<string>();
        const nT = take(sObj, sIdx, sConsumed, NAME_ALIASES);
        const rawSecName = nT?.value != null ? String(nT.value).trim() : '';
        if (!rawSecName) {
          const singleKeys = Object.keys(sObj);
          if (singleKeys.length === 1 && typeof sObj[singleKeys[0]] === 'string') {
            const k = singleKeys[0];
            const v = String(sObj[k]);
            const sub = parseSectorShorthandString(`${k}（${v}）`) ?? {
              name: k,
              layer: '',
              status: '正常',
              desc: v,
            };
            mergeOneSector(sub);
            continue;
          }
          ctx.quarantine.push({
            scope: 'element',
            tag: `${basePath}.防区`,
            path: `${basePath}.防区`,
            raw: JSON.stringify(sObj),
            error: '防区条目缺少名称',
          });
          continue;
        }
        const lT = take(sObj, sIdx, sConsumed, ['层级', '层位', '所在层', 'layer']);
        const stT = take(sObj, sIdx, sConsumed, ['状态', 'status']);
        const dT = take(sObj, sIdx, sConsumed, ['描述', '简介', '说明', '效能', 'desc']);
        mergeOneSector({
          name: rawSecName,
          layer: lT?.value != null ? String(lT.value) : undefined,
          status: stT?.value != null ? String(stT.value) : undefined,
          desc: dT?.value != null ? String(dT.value) : undefined,
        });
        quarantineLeftovers(sObj, sConsumed, ctx, `${basePath}.防区[${rawSecName}]`);
      }
    }
  }

  if (mutated && existingList.length > 0) {
    target.sectors = existingList;
    ctx.appliedCount++;
  }
}

/** 基地元素字段映射 */
export function mapBase(
  target: Record<string, unknown>,
  src: Record<string, unknown>,
  idx: Map<string, string>,
  consumed: Set<string>,
  isNew: boolean,
  path: string,
  ctx: Ctx,
): void {
  setStr(target, 'name', src, idx, consumed, NAME_ALIASES, ctx);
  // FD-38：消费显式基地 ID 与重命名锚点键（原名称 / 曾用名 / rename_from），防止被 quarantineLeftovers 误隔离
  for (const metaAlias of BASE_RENAME_META_ALIASES) {
    const k = idx.get(canon(metaAlias));
    if (k !== undefined) consumed.add(k);
  }
  if (isNew && !target.id) target.id = String(target.name ?? '');
  setStr(target, 'location', src, idx, consumed, ['地点', '位置', 'location'], ctx);
  setEnumField(target, 'status', src, idx, consumed, ['状态', 'status'], ENUM_BASE_STATUS, ctx, path);
  // 基地局部天气（FD-26 · D-WTH-1：按需增量更新，未传则保持原 weather 不变，旧档零新增键）
  const weatherT = take(src, idx, consumed, ['天气', '局部天气', '气象', '天候', 'weather']);
  if (weatherT && weatherT.value != null && String(weatherT.value).trim() !== '') {
    const normalizedWeather = normalizeCanonicalWeather(weatherT.value);
    if (normalizedWeather) {
      target.weather = normalizedWeather;
      ctx.appliedCount++;
    }
  }
  // 基地相对首基地标准时区偏移（FD-26 · D-TZ-1：仅声明非空时写入，旧档零新增键）
  const tzT = take(src, idx, consumed, ['时区', '标准时差', '时差', 'tz_offset', 'timezone']);
  if (tzT && tzT.value != null && String(tzT.value).trim() !== '') {
    target.tz_offset = parseTimezoneOffset(tzT.value, false);
    ctx.appliedCount++;
  }
  // 基地选址类型（FD-26 / FD-27：仅声明非空时写入，旧档零新增键）
  const siteT = take(src, idx, consumed, ['选址', '地形', '环境', 'site_type', 'terrain']);
  if (siteT && siteT.value != null && String(siteT.value).trim() !== '') {
    const rawSite = String(siteT.value).trim();
    target.site_type = normalizeBaseSiteType(rawSite) || rawSite;
    ctx.appliedCount++;
  }
  // 电力：发电/用电
  const powT = take(src, idx, consumed, ['电力', 'power']);
  if (powT && isUsable(powT.value) && !Array.isArray(powT.value)) {
    const pw = powT.value as Record<string, unknown>;
    const pidx = keyIndex(pw);
    const pcons = new Set<string>();
    if (!isUsable(target.power)) target.power = { gen: 0, use: 0 };
    setNumField(target.power as Record<string, unknown>, 'gen', pw, pidx, pcons, ['发电', 'gen'], ctx, `${path}.电力`);
    setNumField(target.power as Record<string, unknown>, 'use', pw, pidx, pcons, ['用电', 'use'], ctx, `${path}.电力`);
    quarantineLeftovers(pw, pcons, ctx, `${path}.电力`);
  }
  // 警报：整体替换
  const alT = take(src, idx, consumed, ['警报', 'alerts']);
  if (alT) {
    target.alerts = asArray(alT.value).map(x => String(x));
    ctx.appliedCount++;
  }
  // 建筑：upsert
  const bT = take(src, idx, consumed, ['建筑', 'buildings']);
  if (bT) upsertBuildings(target, bT.value, ctx, path);
  // 分基地驻防军备明细（FD-37 · D-SAVE-GARRISON-03：按需初始化 target.forces 子字段，避免空对象污染）
  const baseForcesT = take(src, idx, consumed, ['驻军', '部队', '兵力', 'forces']);
  if (baseForcesT && isUsable(baseForcesT.value) && !Array.isArray(baseForcesT.value)) {
    const bfSrc = baseForcesT.value as Record<string, unknown>;
    const bfIdx = keyIndex(bfSrc);
    const bfConsumed = new Set<string>();
    const existingBf: Record<string, unknown> =
      isUsable(target.forces) && !Array.isArray(target.forces)
        ? { ...(target.forces as Record<string, unknown>) }
        : {};
    let hasValidSubfield = false;

    const troopsT = take(bfSrc, bfIdx, bfConsumed, ['人员', '兵力', '步兵', 'troops']);
    if (troopsT && troopsT.value != null) {
      const troopsTarget: Record<string, unknown> =
        isUsable(existingBf.troops) && !Array.isArray(existingBf.troops)
          ? { ...(existingBf.troops as Record<string, unknown>) }
          : {};
      mergeNumRecord(troopsTarget, troopsT.value, ctx);
      if (Object.keys(troopsTarget).length > 0 || existingBf.troops !== undefined) {
        existingBf.troops = troopsTarget;
        hasValidSubfield = true;
      }
    }

    const vehT = take(bfSrc, bfIdx, bfConsumed, ['载具', 'vehicles']);
    if (vehT && vehT.value != null) {
      const vehHolder: Record<string, unknown> = {
        vehicles: Array.isArray(existingBf.vehicles) ? [...(existingBf.vehicles as string[])] : [],
      };
      mergeVehicles(vehHolder, vehT, ctx);
      const nextVehicles = vehHolder.vehicles as string[];
      if (nextVehicles.length > 0 || existingBf.vehicles !== undefined || Array.isArray(vehT.value)) {
        existingBf.vehicles = nextVehicles;
        hasValidSubfield = true;
      }
    }

    const equipT = take(bfSrc, bfIdx, bfConsumed, ['装备', '军备', 'equipment']);
    if (equipT && equipT.value != null) {
      const equipTarget: Record<string, unknown> =
        isUsable(existingBf.equipment) && !Array.isArray(existingBf.equipment)
          ? { ...(existingBf.equipment as Record<string, unknown>) }
          : {};
      mergeNumRecord(equipTarget, equipT.value, ctx);
      if (Object.keys(equipTarget).length > 0 || existingBf.equipment !== undefined) {
        existingBf.equipment = equipTarget;
        hasValidSubfield = true;
      }
    }

    if (hasValidSubfield && Object.keys(existingBf).length > 0) {
      target.forces = existingBf;
      ctx.appliedCount++;
    }
  }

  // 基地空间防区与环境工程词条（FD-38 · D-BASE-LIFE-04：支持 防区/子区域/环境工程/配套设施/基础设施/辖区/sectors，仅非空时挂载，旧档零新增键）
  const sectorInputs: unknown[] = [];
  for (const secAlias of BASE_SECTOR_FIELD_ALIASES) {
    const k = idx.get(canon(secAlias));
    if (k !== undefined && !consumed.has(k)) {
      consumed.add(k);
      if (src[k] != null) sectorInputs.push(src[k]);
    }
  }
  if (sectorInputs.length > 0) {
    upsertBaseSectors(target, sectorInputs, ctx, path);
  }
}

const CHAIN_NAME_ALIASES = ['名称', '链名', '项目', '对象', '目标', 'name', 'title'];
const CHAIN_ID_ALIASES = ['id', '编号', '链条ID', 'chain_id'];
const CHAIN_TYPE_ALIASES = ['类型', '分类', '类别', '渠道', 'type', 'category', 'kind'];
const CHAIN_FLOW_ALIASES = ['流向', '收支', '方向', 'flow'];
const CHAIN_RATE_ALIASES = [
  '日产',
  '日产量',
  '日额',
  '日收益',
  '日净入',
  '每日收益',
  '每日产出',
  '日入',
  '日产出',
  '日额度',
  '额度',
  '金额',
  '收益',
  '产出',
  '每日额度',
  'rate_daily',
  'daily_rate',
  'rate',
  'amount',
];
const CHAIN_STATUS_ALIASES = ['状态', '运行状态', 'status', 'state'];
const CHAIN_EFF_ALIASES = ['效率', '履约率', 'eff', 'efficiency'];
const CHAIN_RISK_ALIASES = ['风险', '风险等级', '安全风险', '暴露风险', 'risk'];
const CHAIN_CYCLE_ALIASES = ['周期', '结算周期', 'cycle'];
const CHAIN_REASON_ALIASES = ['描述', '备注', '原因', '说明', '详情', '摘要', 'reason', 'desc', 'description', 'note'];
const CHAIN_DEPS_ALIASES = ['依赖', '物理依赖', 'deps'];
const CHAIN_BASE_ALIASES = ['基地', '依赖基地', '依托基地', '所属基地', 'base_id', 'base'];
const CHAIN_BUILDINGS_ALIASES = ['依赖建筑', '依托建筑', '建筑', '设施', 'buildings', 'building'];
const CHAIN_RESOURCE_ALIASES = ['依赖资源', '矿脉', '资源点', 'world_resource'];
const CHAIN_CAPACITY_ALIASES = ['容量', '储量', 'capacity'];
const CHAIN_TOTAL_YIELD_ALIASES = ['总储量', '总容量', '总蕴藏', '总额度', '最大容量', 'total_yield', 'total_capacity', 'total'];
const CHAIN_EXTRACTED_ALIASES = ['已开采', '已提取', 'extracted'];

function normalizeChainStatus(raw: unknown): ChainStatus | undefined {
  if (raw == null) return undefined;
  const c = canon(String(raw));
  if (!c) return undefined;
  if (
    [
      'active',
      '活跃',
      '正常',
      '运转',
      '稳定',
      '运行中',
      '运转中',
      '履约',
      '正常履约',
      '开通',
      '已开通',
      '生效',
    ].includes(c)
  ) {
    return 'active';
  }
  if (['distressed', '受创', '受损', '减半', '受阻', '受挫', '降效', '告警', '异常'].includes(c)) {
    return 'distressed';
  }
  if (['broken', '断链', '中断', '瘫痪', '停摆', '断裂', '损毁', '停运'].includes(c)) {
    return 'broken';
  }
  if (['exhausted', 'depleted', '枯竭', '耗尽', '采空', '终止', '完结'].includes(c)) {
    return 'exhausted';
  }
  if (
    [
      'establishing',
      '筹建',
      '筹备',
      '筹备中',
      '筹建中',
      '铺设',
      '铺设中',
      '建设',
      '建设中',
      '建立中',
      '准备中',
      '待开通',
      '未开通',
    ].includes(c)
  ) {
    return 'establishing';
  }
  return undefined;
}

function parseChainNumeric(raw: unknown): number | null {
  const direct = toNum(raw);
  if (direct !== null) return direct;
  if (typeof raw === 'string') {
    const m = raw.trim().match(/([+-]?\d+(?:\.\d+)?)/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function parseChainDeps(
  depsRaw: unknown,
  baseRaw: unknown,
  bldsRaw: unknown,
  resRaw: unknown,
): { base_id: string; buildings: string[]; world_resource: string } {
  let base_id = baseRaw != null ? String(baseRaw).trim() : '';
  const buildings: string[] = [];
  let world_resource = resRaw != null ? String(resRaw).trim() : '';

  const pushBlds = (val: unknown) => {
    if (val == null) return;
    if (Array.isArray(val)) {
      for (const x of val) {
        const s = String(x ?? '').trim();
        if (s && !buildings.includes(s)) buildings.push(s);
      }
    } else if (typeof val === 'string') {
      for (const s of val.split(/[,，、;；]+/).map(x => x.trim()).filter(Boolean)) {
        if (!buildings.includes(s)) buildings.push(s);
      }
    }
  };
  pushBlds(bldsRaw);

  if (isUsable(depsRaw) && !Array.isArray(depsRaw)) {
    const dObj = depsRaw as Record<string, unknown>;
    const dIdx = keyIndex(dObj);
    const dConsumed = new Set<string>();
    const dbT = take(dObj, dIdx, dConsumed, CHAIN_BASE_ALIASES);
    const dBldsT = take(dObj, dIdx, dConsumed, CHAIN_BUILDINGS_ALIASES);
    const dResT = take(dObj, dIdx, dConsumed, CHAIN_RESOURCE_ALIASES);
    if (!base_id && dbT?.value != null) base_id = String(dbT.value).trim();
    pushBlds(dBldsT?.value);
    if (!world_resource && dResT?.value != null) world_resource = String(dResT.value).trim();
  } else if (Array.isArray(depsRaw)) {
    for (const item of depsRaw) {
      if (typeof item === 'string' && item.trim()) {
        pushBlds(item);
      } else if (isUsable(item) && !Array.isArray(item)) {
        const sub = parseChainDeps(item, undefined, undefined, undefined);
        if (!base_id && sub.base_id) base_id = sub.base_id;
        pushBlds(sub.buildings);
        if (!world_resource && sub.world_resource) world_resource = sub.world_resource;
      }
    }
  }

  return { base_id, buildings, world_resource };
}

export function syncEconomyChainDailySummary(data: StatData): void {
  const computed = computeBuildingPassiveDailyCredits(data).channelDaily;
  const prev = data.economy.channel_daily;
  const refining = computed.refining || (prev?.refining ?? 0);
  const recycling = computed.recycling || (prev?.recycling ?? 0);
  const petrochemical = computed.petrochemical || (prev?.petrochemical ?? 0);
  const chains = calcDailyNet(data.economy.chains ?? []);
  const total = refining + recycling + petrochemical + chains;
  data.economy.channel_daily = EconomyChannelDaily.parse({
    refining,
    recycling,
    petrochemical,
    chains,
    total,
  });
  data.economy.credits_daily = total;
}

function extractChainItemsFromBlock(rawBlock: unknown, ctx: Ctx): unknown[] {
  if (!isUsable(rawBlock)) return [];
  if (Array.isArray(rawBlock)) return rawBlock;

  const obj = rawBlock as Record<string, unknown>;
  const idx = keyIndex(obj);
  const consumed = new Set<string>();
  const wrapped = take(obj, idx, consumed, ['资金链', '贸易链', '收入链', 'chains', 'chain']);
  if (wrapped) {
    quarantineLeftovers(obj, consumed, ctx, '资金链');
    return asArray(wrapped.value);
  }

  const allFieldAliases = [
    ...CHAIN_NAME_ALIASES,
    ...CHAIN_ID_ALIASES,
    ...CHAIN_TYPE_ALIASES,
    ...CHAIN_FLOW_ALIASES,
    ...CHAIN_RATE_ALIASES,
    ...CHAIN_STATUS_ALIASES,
  ];
  if (allFieldAliases.some(a => idx.has(canon(a)))) {
    return [obj];
  }

  const mapped: unknown[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (isUsable(v) && !Array.isArray(v)) {
      mapped.push({ 名称: k, ...(v as Record<string, unknown>) });
    }
  }
  return mapped.length > 0 ? mapped : [obj];
}

/**
 * BUG-LIVE-21：顶层 <资金链> 标签块及 <态势>.资金链 解析入口
 * 兼容列表/单对象/字典结构，写入 data.economy.chains 并即时同步刷新 channel_daily.chains / total 与 credits_daily
 */
export function applyChainsBlock(rawBlock: unknown, data: StatData, ctx: Ctx): void {
  const items = extractChainItemsFromBlock(rawBlock, ctx);
  if (items.length === 0) return;

  const chainsArr = (data.economy.chains ??= []);
  const currentDay = data.clock?.day ?? data.meta?.day_count ?? 0;
  let mutated = false;

  for (const rawItem of items) {
    if (!isUsable(rawItem) || Array.isArray(rawItem)) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '资金链',
        path: 'economy.chains',
        raw: JSON.stringify(rawItem).slice(0, 200),
        error: '资金链条目必须为对象',
      });
      continue;
    }

    const itemObj = rawItem as Record<string, unknown>;
    const idx = keyIndex(itemObj);
    const consumed = new Set<string>();

    const idT = take(itemObj, idx, consumed, CHAIN_ID_ALIASES);
    const nameT = take(itemObj, idx, consumed, CHAIN_NAME_ALIASES);
    const rawName = String(nameT?.value ?? '').trim();
    const rawId = String(idT?.value ?? '').trim();
    if (!rawName && !rawId) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '资金链',
        path: 'economy.chains',
        raw: JSON.stringify(itemObj).slice(0, 200),
        error: '资金链缺少「名称」',
        suggestion: '示例：- 名称: 铁砧矿坑重矿暗渠',
      });
      continue;
    }

    const name = rawName || rawId;
    const chainId = rawId || `chain_${canon(name)}`;

    const typeT = take(itemObj, idx, consumed, CHAIN_TYPE_ALIASES);
    const kindT = take(itemObj, idx, consumed, [
      '链条类型',
      '物理分类',
      'chain_kind',
      'chainKind',
    ]);
    const walletDailyT = take(itemObj, idx, consumed, [
      '外币日收支',
      '外币',
      '钱袋日收支',
      '外币收益',
      '本地外币',
      '钱袋',
      'wallet_daily',
      'walletDaily',
      'wallet',
    ]);
    const resDailyT = take(itemObj, idx, consumed, [
      '货物日收支',
      '资源日收支',
      '物资日收支',
      '实物日收支',
      '六柱日收支',
      'resources_daily',
      'resourcesDaily',
      'resources',
    ]);
    const vehiclesT = take(itemObj, idx, consumed, [
      '依赖载具',
      '矿车',
      '依托载具',
      '载具',
      '车辆',
      'vehicles',
    ]);
    const factionT = take(itemObj, idx, consumed, [
      '依赖势力',
      '贸易对象',
      '关联势力',
      '合作势力',
      '所属势力',
      'faction',
    ]);
    const flowT = take(itemObj, idx, consumed, CHAIN_FLOW_ALIASES);
    const rateT = take(itemObj, idx, consumed, CHAIN_RATE_ALIASES);
    const statusT = take(itemObj, idx, consumed, CHAIN_STATUS_ALIASES);
    const effT = take(itemObj, idx, consumed, CHAIN_EFF_ALIASES);
    const riskT = take(itemObj, idx, consumed, CHAIN_RISK_ALIASES);
    const cycleT = take(itemObj, idx, consumed, CHAIN_CYCLE_ALIASES);
    const reasonT = take(itemObj, idx, consumed, CHAIN_REASON_ALIASES);
    const depsT = take(itemObj, idx, consumed, CHAIN_DEPS_ALIASES);
    const baseT = take(itemObj, idx, consumed, CHAIN_BASE_ALIASES);
    const bldsT = take(itemObj, idx, consumed, CHAIN_BUILDINGS_ALIASES);
    const resT = take(itemObj, idx, consumed, CHAIN_RESOURCE_ALIASES);
    const capT = take(itemObj, idx, consumed, CHAIN_CAPACITY_ALIASES);
    const totalYieldT = take(itemObj, idx, consumed, CHAIN_TOTAL_YIELD_ALIASES);
    const extractedT = take(itemObj, idx, consumed, CHAIN_EXTRACTED_ALIASES);
    const remCapT = take(itemObj, idx, consumed, [
      '剩余储量',
      '剩余容量',
      '剩余蕴藏',
      'remaining_cap',
      'remaining_yield',
      'remaining',
    ]);
    void riskT;
    void cycleT;

    quarantineLeftovers(itemObj, consumed, ctx, `资金链[${name}]`);

    const existing = chainsArr.find(
      c => canon(c.id) === canon(chainId) || canon(c.name) === canon(name),
    );

    const parsedRate = rateT ? parseChainNumeric(rateT.value) : null;
    let flow: ChainFlow = existing?.flow ?? '收入';
    if (flowT?.value != null && String(flowT.value).trim() !== '') {
      flow = /支出|开销|维护|损耗|outflow|expense/i.test(String(flowT.value)) ? '支出' : '收入';
    } else if (typeT?.value != null && /支出|维护|开销|耗费|成本/.test(String(typeT.value))) {
      flow = '支出';
    } else if (parsedRate !== null && parsedRate < 0) {
      flow = '支出';
    }

    let rateDaily =
      parsedRate !== null ? Math.max(0, Math.abs(parsedRate)) : (existing?.rate_daily ?? 0);

    const mappedStatus = normalizeChainStatus(statusT?.value);
    let status: ChainStatus = mappedStatus ?? existing?.status ?? 'active';

    const parsedEff = effT ? parseChainNumeric(effT.value) : null;
    let eff: number;
    if (parsedEff !== null) {
      const isPercentStr = typeof effT?.value === 'string' && effT.value.includes('%');
      const normEff = isPercentStr || (parsedEff > 2 && parsedEff <= 200) ? parsedEff / 100 : parsedEff;
      eff = Math.min(2, Math.max(0, normEff));
    } else if (mappedStatus) {
      eff = status === 'active' ? (existing?.status === 'active' && existing.eff > 1 ? existing.eff : 1) : status === 'distressed' ? 0.5 : 0;
    } else {
      eff = existing?.eff ?? (status === 'active' ? 1 : status === 'distressed' ? 0.5 : 0);
    }

    const parsedDeps = parseChainDeps(depsT?.value, baseT?.value, bldsT?.value, resT?.value);
    const vehiclesFromTop =
      vehiclesT?.value != null
        ? asArray(vehiclesT.value)
            .map(x => String(x ?? '').trim())
            .filter(Boolean)
        : undefined;
    const factionFromTop =
      factionT?.value != null && String(factionT.value).trim()
        ? String(factionT.value).trim()
        : undefined;
    const nextVehicles =
      vehiclesFromTop && vehiclesFromTop.length > 0
        ? vehiclesFromTop
        : existing?.deps?.vehicles
          ? [...existing.deps.vehicles]
          : undefined;
    const nextFaction = factionFromTop || existing?.deps?.faction || undefined;
    const nextDeps = {
      base_id: parsedDeps.base_id || existing?.deps?.base_id || '',
      buildings:
        parsedDeps.buildings.length > 0 ? parsedDeps.buildings : [...(existing?.deps?.buildings ?? [])],
      ...(nextVehicles && nextVehicles.length > 0 ? { vehicles: nextVehicles } : {}),
      ...(nextFaction ? { faction: nextFaction } : {}),
      world_resource: parsedDeps.world_resource || existing?.deps?.world_resource || '',
    };

    let walletDaily: Record<string, number> | undefined = existing?.wallet_daily
      ? { ...existing.wallet_daily }
      : undefined;
    if (walletDailyT?.value != null && isUsable(walletDailyT.value) && !Array.isArray(walletDailyT.value)) {
      const wMap: Record<string, number> = {};
      for (const [k, v] of Object.entries(walletDailyT.value as Record<string, unknown>)) {
        const curr = k.trim();
        const n = parseChainNumeric(v);
        if (curr && n != null && n !== 0) wMap[curr] = n;
      }
      if (Object.keys(wMap).length > 0) walletDaily = wMap;
    }

    let resourcesDaily: Record<string, Record<string, number>> | undefined = existing?.resources_daily
      ? { ...existing.resources_daily }
      : undefined;
    if (resDailyT?.value != null && isUsable(resDailyT.value) && !Array.isArray(resDailyT.value)) {
      const rMap: Record<string, Record<string, number>> = {};
      for (const [outerKey, outerVal] of Object.entries(resDailyT.value as Record<string, unknown>)) {
        const pKey = outerKey.trim();
        if (!pKey) continue;
        if (isUsable(outerVal) && !Array.isArray(outerVal)) {
          for (const [subKey, subVal] of Object.entries(outerVal as Record<string, unknown>)) {
            const sKey = subKey.trim();
            const n = parseChainNumeric(subVal);
            if (sKey && n != null && n !== 0) {
              (rMap[pKey] ??= {})[sKey] = n;
            }
          }
        } else {
          const n = parseChainNumeric(outerVal);
          if (n != null && n !== 0) {
            (rMap['矿产'] ??= {})[pKey] = n;
          }
        }
      }
      if (Object.keys(rMap).length > 0) resourcesDaily = rMap;
    }

    const VALID_CHAIN_KINDS = [
      '采矿精炼',
      '废料回收',
      '油气化工',
      '本土商路',
      '工业转化',
      '后勤维护',
    ] as const;
    const rawKindText = String(kindT?.value ?? typeT?.value ?? '').trim();
    let chainKind: IncomeChain['chain_kind'] =
      VALID_CHAIN_KINDS.find(k => canon(k) === canon(rawKindText)) ?? existing?.chain_kind;
    const hasMintingBuilding = nextDeps.buildings.some(b =>
      /矿石精炼厂|精炼厂|回收处理厂|回收厂|超维暗网中继站|暗网中继站|科技钻井油田|钻井油田/.test(b),
    );
    if (!chainKind) {
      if (/商路|贸易|走私|互市|商队/.test(name) && !hasMintingBuilding) {
        chainKind = '本土商路';
      } else if (
        /采矿|精炼厂|矿脉|原矿/.test([name, ...nextDeps.buildings, ...(nextVehicles ?? [])].join(' ')) &&
        !/商路|贸易|走私|互市|商队/.test(name)
      ) {
        chainKind = '采矿精炼';
      }
    }
    const isTradeRoute =
      chainKind === '本土商路' ||
      (!chainKind && /商路|贸易|走私|互市|商队/.test(name) && !hasMintingBuilding);
    if (isTradeRoute && !hasMintingBuilding && rateDaily > 0 && !walletDaily && !resourcesDaily) {
      walletDaily = { 本地通用货币: rateDaily };
      rateDaily = 0;
      if (!chainKind) chainKind = '本土商路';
      yellow(
        ctx,
        {
          layer: 'L2',
          path: `economy.chains[${name}]`,
          message: `[资金链] 本土商路「${name}」不可直接产出系统资金 Credits，已自动转为本地外币钱袋收入`,
        },
        {
          rule: 'R18',
          target: '资金链',
          message: `本土商路「${name}」不可直接产出系统资金 Credits，已自动转为本地外币钱袋收入`,
        },
      );
    }

    let totalYield: number | null = existing?.capacity?.total_yield ?? null;
    let extracted: number = existing?.capacity?.extracted ?? 0;
    let explicitRemainingCap: number | null = null;
    let hasExplicitCapacityInput = false;
    if (capT?.value != null) {
      const capNum = parseChainNumeric(capT.value);
      if (capNum !== null && capNum >= 0) {
        totalYield = capNum;
        hasExplicitCapacityInput = true;
      } else if (isUsable(capT.value) && !Array.isArray(capT.value)) {
        const cObj = capT.value as Record<string, unknown>;
        const cIdx = keyIndex(cObj);
        const cConsumed = new Set<string>();
        const tyT = take(cObj, cIdx, cConsumed, CHAIN_TOTAL_YIELD_ALIASES);
        const exT = take(cObj, cIdx, cConsumed, CHAIN_EXTRACTED_ALIASES);
        const rcT = take(cObj, cIdx, cConsumed, [
          '剩余储量',
          '剩余容量',
          '剩余蕴藏',
          'remaining_cap',
          'remaining_yield',
          'remaining',
        ]);
        const tyNum = tyT ? parseChainNumeric(tyT.value) : null;
        const exNum = exT ? parseChainNumeric(exT.value) : null;
        const rcNum = rcT ? parseChainNumeric(rcT.value) : null;
        if (tyNum !== null && tyNum >= 0) {
          totalYield = tyNum;
          hasExplicitCapacityInput = true;
        }
        if (exNum !== null && exNum >= 0) {
          extracted = exNum;
          hasExplicitCapacityInput = true;
        }
        if (rcNum !== null && rcNum >= 0) {
          explicitRemainingCap = rcNum;
          hasExplicitCapacityInput = true;
        }
      }
    }
    if (totalYieldT?.value != null) {
      const tyNum = parseChainNumeric(totalYieldT.value);
      if (tyNum !== null && tyNum >= 0) {
        totalYield = tyNum;
        hasExplicitCapacityInput = true;
      }
    }
    if (extractedT?.value != null) {
      const exNum = parseChainNumeric(extractedT.value);
      if (exNum !== null && exNum >= 0) {
        extracted = exNum;
        hasExplicitCapacityInput = true;
      }
    }
    if (remCapT?.value != null) {
      const rcNum = parseChainNumeric(remCapT.value);
      if (rcNum !== null && rcNum >= 0) {
        explicitRemainingCap = rcNum;
        hasExplicitCapacityInput = true;
      }
    }
    if (explicitRemainingCap !== null && explicitRemainingCap > 0) {
      if (totalYield === null || totalYield - extracted < explicitRemainingCap) {
        totalYield = extracted + explicitRemainingCap;
      }
    }

    // BUG-R2-09：当 existing.status === 'exhausted'（不可逆枯竭终态）时，
    // 除非新块显式扩容（remaining_cap > 0），否则禁止从 'exhausted' 覆写回 'active' 或 'distressed'
    if (existing?.status === 'exhausted') {
      const nextRemainingCap =
        explicitRemainingCap !== null
          ? explicitRemainingCap
          : hasExplicitCapacityInput && totalYield !== null
            ? Math.max(0, totalYield - extracted)
            : 0;
      if (!(nextRemainingCap > 0)) {
        status = 'exhausted';
        eff = 0;
      }
    }

    const reasonStr = String(reasonT?.value ?? '').trim() || existing?.reason || '';

    const nextChain = IncomeChain.parse({
      id: existing?.id || chainId,
      name,
      flow,
      rate_daily: rateDaily,
      ...(chainKind ? { chain_kind: chainKind } : {}),
      ...(walletDaily ? { wallet_daily: walletDaily } : {}),
      ...(resourcesDaily ? { resources_daily: resourcesDaily } : {}),
      status,
      eff,
      deps: nextDeps,
      capacity: {
        total_yield: totalYield,
        extracted,
      },
      reason: reasonStr,
      updated_at_day: currentDay,
    });

    if (existing) {
      Object.assign(existing, nextChain);
    } else {
      chainsArr.push(nextChain);
    }
    mutated = true;
    ctx.appliedCount++;
    green(ctx, {
      layer: 'L2',
      path: 'economy.chains',
      message: `[资金链] 已同步「${name}」（${status}，${flow === '支出' ? '-' : '+'}${rateDaily}/日）`,
      after: name,
    });
  }

  if (mutated) {
    syncEconomyChainDailySummary(data);
  }
}