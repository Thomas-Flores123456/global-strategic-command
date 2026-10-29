/**
 * unitTransferEngine.ts —— 跨基地单位调配在途倒计时与守恒交割引擎（UNIT-TRANSFER-01）
 *
 * 职责边界：
 * 1. LLM 负责在剧情中裁决能否调配、运输方式（铁路/空运/管道/超时空/行军）与预计耗时，并输出 <事件> 单位调配（或 <调配>）；
 * 2. 本引擎以纯函数管理在途账本 `pending_transfers`：
 *    - `requestUnitTransfer`：校验目标基地与源驻地可用存量（支持数量自动钳制与幂等去重），
 *      耗时 <= 0 时当楼立即完成守恒划转，耗时 > 0 时登记入 `pending_transfers`；
 *    - `settleUnitTransfers`：随每轮 <timePast> 的 Δt 推进 `remaining_minutes`，
 *      归零时自动执行 `applyUnitTransferArrival` 守恒划转 `bases[].forces` / `girls[].base` 并销号；
 * 3. 严守战区总账守恒：调配只改变各基地 `bases[].forces` 与「战区机动直属」之间的分布，不凭空增减 `state.forces` 总数；
 * 4. 零 IO、零宿主依赖、不原地修改入参（copy-on-write）。
 */

export type TransferUnitCategory = 'girls' | 'troops' | 'vehicles' | 'equipment';

export const UNASSIGNED_POOL_LABEL = '战区机动直属';

export interface PendingUnitTransfer {
  id: string;
  unit: string;
  category: TransferUnitCategory;
  qty: number;
  from_base: string;
  to_base: string;
  total_minutes: number;
  remaining_minutes: number;
  method: string;
  reason: string;
  started_at: string;
}

export interface UnitTransferRequest {
  unit: string;
  category?: TransferUnitCategory | string;
  qty?: number;
  from_base?: string;
  to_base: string;
  duration_min?: number;
  remaining_min?: number;
  method?: string;
  reason?: string;
  started_at?: string;
}

export interface UnitTransferEvent {
  type:
    | 'transfer_started'
    | 'transfer_arrived'
    | 'transfer_clamped'
    | 'transfer_rejected'
    | 'transfer_orphan';
  light: '🟢' | '🟡';
  unit: string;
  category: TransferUnitCategory;
  qty: number;
  from_base: string;
  to_base: string;
  detail: string;
}

interface TransferGirlLike {
  name: string;
  base?: string;
  callsign?: string;
  serial?: string;
  model?: string;
  [key: string]: unknown;
}

interface TransferBaseForcesLike {
  troops?: Record<string, number>;
  infantry?: Record<string, number>;
  vehicles?: string[];
  equipment?: Record<string, number>;
  [key: string]: unknown;
}

interface TransferBaseLike {
  id?: string;
  name: string;
  location?: string;
  status?: string;
  forces?: TransferBaseForcesLike;
  [key: string]: unknown;
}

interface TransferForcesLike {
  girls?: TransferGirlLike[];
  troops?: Record<string, number>;
  infantry?: Record<string, number>;
  vehicles?: string[];
  equipment?: Record<string, number>;
  [key: string]: unknown;
}

export interface UnitTransferState {
  meta?: { date?: string };
  bases?: ReadonlyArray<TransferBaseLike>;
  girls?: ReadonlyArray<TransferGirlLike>;
  forces?: TransferForcesLike;
  pending_transfers?: ReadonlyArray<PendingUnitTransfer>;
  [key: string]: unknown;
}

function normKey(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

function normalizeVehicleCore(raw: unknown): string {
  return normKey(raw)
    .replace(/(?:\([^()]*\)|（[^（）]*）)/g, '')
    .replace(/[\s·•\-_]/g, '')
    .replace(/主战(?=(?:坦克|战车|机甲))/g, '')
    .trim();
}

const UNASSIGNED_ALIASES = new Set([
  '',
  'all',
  '全局',
  '战区全局',
  '战区机动直属',
  '机动直属',
  '战区直属',
  '统帅部直属',
  '未分配',
  '机动池',
]);

export function isUnassignedBaseRef(ref: unknown): boolean {
  return UNASSIGNED_ALIASES.has(normKey(ref));
}

function findBaseInList<B extends TransferBaseLike>(
  bases: ReadonlyArray<B>,
  ref: string | undefined,
): B | undefined {
  const trimmed = String(ref ?? '').trim();
  if (!trimmed || isUnassignedBaseRef(trimmed)) return undefined;
  const k = normKey(trimmed);
  return (
    bases.find(b => normKey(b.id) === k || normKey(b.name) === k) ??
    bases.find(b => {
      const bName = normKey(b.name);
      const bId = normKey(b.id);
      return (bName && (bName.includes(k) || k.includes(bName))) || (bId && (bId.includes(k) || k.includes(bId)));
    })
  );
}

/** 解析单条载具字符串（如 "灰熊坦克×3" / "犀牛坦克(受损)"） */
export function parseTransferVehicleToken(raw: string): {
  model: string;
  count: number;
  statusSuffix: string;
  isDamaged: boolean;
} | null {
  let text = String(raw ?? '').trim();
  if (!text) return null;

  let count = 1;
  const countMatch = text.match(/\s*[×xX*]\s*(\d+)\s*$/);
  if (countMatch) {
    count = Math.max(1, Number.parseInt(countMatch[1], 10) || 1);
    text = text.slice(0, countMatch.index).trim();
  }

  let statusSuffix = '';
  const parenMatch = text.match(/(?:\(([^()]+)\)|（([^（）]+)）)\s*$/);
  if (parenMatch) {
    const inner = (parenMatch[1] || parenMatch[2] || '').trim();
    const countInParen = inner.match(/^(\d+)\s*[台架辆艘]?$/);
    if (countInParen) {
      count = Math.max(1, Number.parseInt(countInParen[1], 10) || 1);
    } else if (inner) {
      statusSuffix = `(${inner})`;
    }
    text = text.slice(0, parenMatch.index).trim();
  }

  const model = text.trim();
  if (!model) return null;
  const isDamaged = /受损|轻损|重损|战损|待修|故障|停机|瘫痪|大修|破损|damaged|broken/i.test(statusSuffix);
  return { model, count, statusSuffix, isDamaged };
}

function vehicleModelMatches(candidateModel: string, queryModel: string): boolean {
  const cKey = normKey(candidateModel);
  const qKey = normKey(queryModel);
  if (!cKey || !qKey) return false;
  if (cKey === qKey) return true;
  const cCore = normalizeVehicleCore(candidateModel);
  const qCore = normalizeVehicleCore(queryModel);
  return Boolean(cCore && qCore && cCore === qCore);
}

function countVehiclesInList(list: readonly string[] | undefined, queryModel: string): number {
  if (!Array.isArray(list)) return 0;
  let total = 0;
  for (const raw of list) {
    const parsed = parseTransferVehicleToken(raw);
    if (parsed && vehicleModelMatches(parsed.model, queryModel)) {
      total += parsed.count;
    }
  }
  return total;
}

function removeVehiclesFromList(
  list: readonly string[] | undefined,
  queryModel: string,
  qty: number,
): { nextList: string[]; removedTokens: string[]; removedCount: number; matchedModel: string } {
  const src = Array.isArray(list) ? [...list] : [];
  if (qty <= 0 || src.length === 0) {
    return { nextList: src, removedTokens: [], removedCount: 0, matchedModel: queryModel };
  }

  let remainingToRemove = qty;
  let matchedModel = queryModel;
  const removedTokens: string[] = [];

  // 两遍扫描：优先调拨完好载具，再调拨受损载具
  for (const passDamaged of [false, true]) {
    for (let i = 0; i < src.length && remainingToRemove > 0; i++) {
      const parsed = parseTransferVehicleToken(src[i]);
      if (!parsed || !vehicleModelMatches(parsed.model, queryModel)) continue;
      if (parsed.isDamaged !== passDamaged) continue;

      matchedModel = parsed.model;
      const takeCount = Math.min(remainingToRemove, parsed.count);
      remainingToRemove -= takeCount;
      for (let k = 0; k < takeCount; k++) {
        removedTokens.push(`${parsed.model}${parsed.statusSuffix}`);
      }

      const leftCount = parsed.count - takeCount;
      if (leftCount <= 0) {
        src.splice(i, 1);
        i--;
      } else if (leftCount === 1) {
        src[i] = `${parsed.model}${parsed.statusSuffix}`;
      } else {
        src[i] = `${parsed.model}${parsed.statusSuffix}×${leftCount}`;
      }
    }
  }

  return {
    nextList: src,
    removedTokens,
    removedCount: qty - remainingToRemove,
    matchedModel,
  };
}

function findGirlInState(
  state: UnitTransferState,
  unitQuery: string,
): TransferGirlLike | undefined {
  const q = normKey(unitQuery);
  if (!q) return undefined;
  const allGirls = [...(state.girls ?? []), ...(state.forces?.girls ?? [])];
  return allGirls.find(g => {
    if (!g || typeof g.name !== 'string') return false;
    return (
      normKey(g.name) === q ||
      (g.callsign && normKey(g.callsign) === q) ||
      (g.serial && normKey(g.serial) === q)
    );
  });
}

function findRecordKey(rec: Record<string, number> | undefined, query: string): string | undefined {
  if (!rec || typeof rec !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(rec, query)) return query;
  const q = normKey(query);
  return Object.keys(rec).find(k => normKey(k) === q);
}

const INFANTRY_RE = /兵|步兵|动员|工程师|警犬|狙击|特工|谭雅|鲍里斯|军医|卫队|小队|蛙人|尤里/i;
const EQUIPMENT_RE = /弹|外骨骼|挂载|套件|装甲|护盾|凝胶|芯片|模块|插件|武器|火控|装备|补给/i;

/**
 * 归一化或自动推断调配单位所属四维分类
 */
export function resolveTransferCategory(
  state: UnitTransferState,
  unitName: string,
  explicitCategory?: string,
): TransferUnitCategory {
  const c = normKey(explicitCategory);
  if (c === 'girls' || c === 'girl' || c === '机娘' || c === '舰娘' || c === '英雄') {
    return 'girls';
  }
  if (c === 'troops' || c === 'personnel' || c === 'infantry' || c === '人员' || c === '步兵' || c === '兵力') {
    return 'troops';
  }
  if (
    c === 'vehicles' ||
    c === 'vehicle' ||
    c === 'aircraft' ||
    c === '载具' ||
    c === '装甲' ||
    c === '战车' ||
    c === '空军' ||
    c === '战机' ||
    c === '舰艇' ||
    c === '海军'
  ) {
    return 'vehicles';
  }
  if (c === 'equipment' || c === '装备' || c === '军械' || c === '武备' || c === '制式装备') {
    return 'equipment';
  }

  // 未显式指定时按在账实体精确匹配
  if (findGirlInState(state, unitName)) return 'girls';

  if (findRecordKey(state.forces?.troops, unitName)) return 'troops';
  for (const b of state.bases ?? []) {
    if (findRecordKey(b.forces?.troops ?? b.forces?.infantry, unitName)) return 'troops';
  }

  if (countVehiclesInList(state.forces?.vehicles, unitName) > 0) return 'vehicles';
  for (const b of state.bases ?? []) {
    if (countVehiclesInList(b.forces?.vehicles, unitName) > 0) return 'vehicles';
  }

  if (findRecordKey(state.forces?.equipment, unitName)) return 'equipment';
  for (const b of state.bases ?? []) {
    if (findRecordKey(b.forces?.equipment, unitName)) return 'equipment';
  }

  if (EQUIPMENT_RE.test(unitName)) return 'equipment';
  if (INFANTRY_RE.test(unitName)) return 'troops';
  return 'vehicles';
}

/**
 * 解析耗时文本或数值为分钟数（支持 "2 D 4 H 30 M"、"3小时30分"、"2.5h"、纯数字分钟）
 */
export function parseTransferDurationMinutes(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.round(raw));
  }
  const text = String(raw ?? '').trim();
  if (!text) return 0;
  if (/^(?:0|瞬达|即时|立即|超时空瞬达)$/i.test(text)) return 0;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return Math.max(0, Math.round(Number(text)));
  }

  let total = 0;
  let matched = false;
  const dayMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:d|day|days|天|日)/i);
  if (dayMatch) {
    total += Number(dayMatch[1]) * 1440;
    matched = true;
  }
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|小时|时)/i);
  if (hourMatch) {
    total += Number(hourMatch[1]) * 60;
    matched = true;
  }
  const minMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes|分钟|分)/i);
  if (minMatch) {
    total += Number(minMatch[1]);
    matched = true;
  }
  if (matched) return Math.max(0, Math.round(total));
  return 0;
}

/**
 * 格式化剩余分钟数为人类可读文本（如 "2天4小时" / "3小时30分" / "45分钟"）
 */
export function formatTransferMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m <= 0) return '即将抵达';
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (mins > 0) parts.push(`${mins}分`);
  return parts.join('');
}

/**
 * 计算某驻地当前可调出的单位数量（已扣除已在途调出的数量）
 */
function getAvailableCountAtSource(
  state: UnitTransferState,
  category: TransferUnitCategory,
  unitName: string,
  fromBaseCanonical: string,
): number {
  const bases = state.bases ?? [];
  const pendingFromSameSource = (state.pending_transfers ?? [])
    .filter(
      p =>
        p.category === category &&
        normKey(p.unit) === normKey(unitName) &&
        normKey(p.from_base || UNASSIGNED_POOL_LABEL) === normKey(fromBaseCanonical || UNASSIGNED_POOL_LABEL),
    )
    .reduce((sum, p) => sum + Math.max(0, p.qty || 0), 0);

  if (category === 'girls') {
    const girl = findGirlInState(state, unitName);
    if (!girl) return 0;
    return 1;
  }

  if (category === 'troops') {
    if (isUnassignedBaseRef(fromBaseCanonical)) {
      const gKey = findRecordKey(state.forces?.troops, unitName);
      const globalTotal = gKey ? Number(state.forces?.troops?.[gKey] ?? 0) : 0;
      let allocated = 0;
      for (const b of bases) {
        const bRec = b.forces?.troops ?? b.forces?.infantry;
        const bKey = findRecordKey(bRec, unitName);
        if (bKey) allocated += Number(bRec?.[bKey] ?? 0);
      }
      return Math.max(0, globalTotal - allocated - pendingFromSameSource);
    }
    const base = findBaseInList(bases, fromBaseCanonical);
    const bRec = base?.forces?.troops ?? base?.forces?.infantry;
    const bKey = findRecordKey(bRec, unitName);
    const baseCount = bKey ? Number(bRec?.[bKey] ?? 0) : 0;
    return Math.max(0, baseCount - pendingFromSameSource);
  }

  if (category === 'equipment') {
    if (isUnassignedBaseRef(fromBaseCanonical)) {
      const gKey = findRecordKey(state.forces?.equipment, unitName);
      const globalTotal = gKey ? Number(state.forces?.equipment?.[gKey] ?? 0) : 0;
      let allocated = 0;
      for (const b of bases) {
        const bRec = b.forces?.equipment;
        const bKey = findRecordKey(bRec, unitName);
        if (bKey) allocated += Number(bRec?.[bKey] ?? 0);
      }
      return Math.max(0, globalTotal - allocated - pendingFromSameSource);
    }
    const base = findBaseInList(bases, fromBaseCanonical);
    const bRec = base?.forces?.equipment;
    const bKey = findRecordKey(bRec, unitName);
    const baseCount = bKey ? Number(bRec?.[bKey] ?? 0) : 0;
    return Math.max(0, baseCount - pendingFromSameSource);
  }

  // vehicles
  if (isUnassignedBaseRef(fromBaseCanonical)) {
    const globalTotal = countVehiclesInList(state.forces?.vehicles, unitName);
    let allocated = 0;
    for (const b of bases) {
      allocated += countVehiclesInList(b.forces?.vehicles, unitName);
    }
    return Math.max(0, globalTotal - allocated - pendingFromSameSource);
  }
  const base = findBaseInList(bases, fromBaseCanonical);
  const baseCount = countVehiclesInList(base?.forces?.vehicles, unitName);
  return Math.max(0, baseCount - pendingFromSameSource);
}

/**
 * 当未显式提供出发地时，自动探测持有该单位存量的源驻地
 */
function inferSourceBase(
  state: UnitTransferState,
  category: TransferUnitCategory,
  unitName: string,
  toBaseCanonical: string,
): string {
  if (category === 'girls') {
    const girl = findGirlInState(state, unitName);
    const rawBase = String(girl?.base ?? '').trim();
    if (!rawBase || isUnassignedBaseRef(rawBase)) return UNASSIGNED_POOL_LABEL;
    const matched = findBaseInList(state.bases ?? [], rawBase);
    return matched ? matched.name : rawBase;
  }

  // 先查战区机动直属池
  if (
    !isUnassignedBaseRef(toBaseCanonical) &&
    getAvailableCountAtSource(state, category, unitName, UNASSIGNED_POOL_LABEL) > 0
  ) {
    return UNASSIGNED_POOL_LABEL;
  }

  // 再查除目标基地外拥有存量的基地
  for (const b of state.bases ?? []) {
    if (normKey(b.name) === normKey(toBaseCanonical) || normKey(b.id) === normKey(toBaseCanonical)) {
      continue;
    }
    if (getAvailableCountAtSource(state, category, unitName, b.name) > 0) {
      return b.name;
    }
  }

  return UNASSIGNED_POOL_LABEL;
}

/**
 * 执行单条调配到站交割（守恒修改 bases[].forces / girls[].base）
 */
export function applyUnitTransferArrival<S extends UnitTransferState>(
  state: S,
  transfer: PendingUnitTransfer,
): { next: S; actualQty: number; detail: string } {
  const bases = state.bases ?? [];
  const fromIsUnassigned = isUnassignedBaseRef(transfer.from_base);
  const toIsUnassigned = isUnassignedBaseRef(transfer.to_base);
  const sourceBase = fromIsUnassigned ? undefined : findBaseInList(bases, transfer.from_base);
  const targetBase = toIsUnassigned ? undefined : findBaseInList(bases, transfer.to_base);

  const fromLabel = sourceBase?.name ?? (fromIsUnassigned ? UNASSIGNED_POOL_LABEL : transfer.from_base);
  const toLabel = targetBase?.name ?? (toIsUnassigned ? UNASSIGNED_POOL_LABEL : transfer.to_base);

  if (!toIsUnassigned && !targetBase) {
    return {
      next: state,
      actualQty: 0,
      detail: `目标基地「${transfer.to_base}」不存在，调配出账跳过`,
    };
  }

  // 1. 机娘驻地迁移
  if (transfer.category === 'girls') {
    const newBaseValue = toIsUnassigned ? '' : targetBase!.name;
    let matchedName = transfer.unit;
    let touched = false;

    const updateGirlArray = (arr: ReadonlyArray<TransferGirlLike> | undefined) => {
      if (!Array.isArray(arr)) return undefined;
      return arr.map(g => {
        if (!g || typeof g.name !== 'string') return g;
        const isHit =
          normKey(g.name) === normKey(transfer.unit) ||
          (g.callsign && normKey(g.callsign) === normKey(transfer.unit)) ||
          (g.serial && normKey(g.serial) === normKey(transfer.unit));
        if (!isHit) return g;
        matchedName = g.name;
        touched = true;
        return { ...g, base: newBaseValue };
      });
    };

    const nextGirls = updateGirlArray(state.girls);
    const nextForcesGirls = updateGirlArray(state.forces?.girls);
    if (!touched) {
      return {
        next: state,
        actualQty: 0,
        detail: `机娘「${transfer.unit}」不在编，调配出账跳过`,
      };
    }

    const nextState: Record<string, unknown> = { ...state };
    if (nextGirls) nextState.girls = nextGirls;
    if (state.forces && nextForcesGirls) {
      nextState.forces = { ...state.forces, girls: nextForcesGirls };
    }
    return {
      next: nextState as S,
      actualQty: 1,
      detail: `机娘「${matchedName}」已完成跨防区调动（${fromLabel} → ${toLabel}）`,
    };
  }

  // 2. 人员（troops）或 制式装备（equipment）守恒划转
  if (transfer.category === 'troops' || transfer.category === 'equipment') {
    const field = transfer.category;
    const globalRec = { ...(state.forces?.[field] ?? {}) };
    const canonicalUnitKey = findRecordKey(globalRec, transfer.unit) ?? transfer.unit;

    let actualQty = Math.max(1, Math.floor(transfer.qty || 1));
    const nextBases = bases.map(b => ({
      ...b,
      forces: b.forces ? { ...b.forces } : {},
    }));

    if (!fromIsUnassigned) {
      const srcIdx = nextBases.findIndex(b => b.id === sourceBase?.id && b.name === sourceBase?.name);
      if (srcIdx < 0) {
        return {
          next: state,
          actualQty: 0,
          detail: `源基地「${transfer.from_base}」不存在，调配出账跳过`,
        };
      }
      const srcRec = { ...(nextBases[srcIdx].forces?.[field] ?? {}) };
      const srcKey = findRecordKey(srcRec, transfer.unit) ?? canonicalUnitKey;
      const avail = Math.max(0, Number(srcRec[srcKey] ?? 0));
      actualQty = Math.min(actualQty, avail);
      if (actualQty <= 0) {
        return {
          next: state,
          actualQty: 0,
          detail: `源基地「${fromLabel}」无可用「${transfer.unit}」库存，调配出账跳过`,
        };
      }
      const left = avail - actualQty;
      if (left <= 0) delete srcRec[srcKey];
      else srcRec[srcKey] = left;
      nextBases[srcIdx].forces = { ...nextBases[srcIdx].forces, [field]: srcRec };
    } else {
      // 从战区机动直属调出：核验未分配余量
      const globalTotal = Number(globalRec[canonicalUnitKey] ?? 0);
      let allocated = 0;
      for (const b of nextBases) {
        const bRec = b.forces?.[field];
        const bKey = findRecordKey(bRec, transfer.unit);
        if (bKey) allocated += Number(bRec?.[bKey] ?? 0);
      }
      const unassignedAvail = Math.max(0, globalTotal - allocated);
      actualQty = Math.min(actualQty, unassignedAvail);
      if (actualQty <= 0) {
        return {
          next: state,
          actualQty: 0,
          detail: `「${UNASSIGNED_POOL_LABEL}」无可用「${transfer.unit}」余量，调配出账跳过`,
        };
      }
    }

    if (!toIsUnassigned && targetBase) {
      const dstIdx = nextBases.findIndex(b => b.id === targetBase.id && b.name === targetBase.name);
      if (dstIdx >= 0) {
        const dstRec = { ...(nextBases[dstIdx].forces?.[field] ?? {}) };
        const dstKey = findRecordKey(dstRec, transfer.unit) ?? canonicalUnitKey;
        dstRec[dstKey] = Number(dstRec[dstKey] ?? 0) + actualQty;
        nextBases[dstIdx].forces = { ...nextBases[dstIdx].forces, [field]: dstRec };
      }
    }

    // 守恒护栏：确保全局总账 >= 各基地驻防之和
    let totalAllocatedAfter = 0;
    for (const b of nextBases) {
      const bRec = b.forces?.[field];
      const bKey = findRecordKey(bRec, transfer.unit);
      if (bKey) totalAllocatedAfter += Number(bRec?.[bKey] ?? 0);
    }
    if (Number(globalRec[canonicalUnitKey] ?? 0) < totalAllocatedAfter) {
      globalRec[canonicalUnitKey] = totalAllocatedAfter;
    }

    const nextState: Record<string, unknown> = {
      ...state,
      bases: nextBases,
      forces: {
        ...(state.forces ?? {}),
        [field]: globalRec,
      },
    };
    return {
      next: nextState as S,
      actualQty,
      detail: `「${canonicalUnitKey}」×${actualQty} 已调配入驻「${toLabel}」（源自「${fromLabel}」）`,
    };
  }

  // 3. 载具与空军（vehicles）守恒划转
  const nextBases = bases.map(b => ({
    ...b,
    forces: b.forces ? { ...b.forces, vehicles: [...(b.forces.vehicles ?? [])] } : { vehicles: [] },
  }));

  let actualQty = Math.max(1, Math.floor(transfer.qty || 1));
  let tokensToMove: string[] = [];
  let canonicalModel = transfer.unit;

  if (!fromIsUnassigned) {
    const srcIdx = nextBases.findIndex(b => b.id === sourceBase?.id && b.name === sourceBase?.name);
    if (srcIdx < 0) {
      return {
        next: state,
        actualQty: 0,
        detail: `源基地「${transfer.from_base}」不存在，调配出账跳过`,
      };
    }
    const removed = removeVehiclesFromList(
      nextBases[srcIdx].forces?.vehicles,
      transfer.unit,
      actualQty,
    );
    if (removed.removedCount <= 0) {
      return {
        next: state,
        actualQty: 0,
        detail: `源基地「${fromLabel}」无可用「${transfer.unit}」，调配出账跳过`,
      };
    }
    nextBases[srcIdx].forces = {
      ...nextBases[srcIdx].forces,
      vehicles: removed.nextList,
    };
    actualQty = removed.removedCount;
    tokensToMove = removed.removedTokens;
    canonicalModel = removed.matchedModel;
  } else {
    // 从战区机动直属调出
    const globalTotal = countVehiclesInList(state.forces?.vehicles, transfer.unit);
    let allocated = 0;
    for (const b of nextBases) {
      allocated += countVehiclesInList(b.forces?.vehicles, transfer.unit);
    }
    const unassignedAvail = Math.max(0, globalTotal - allocated);
    actualQty = Math.min(actualQty, unassignedAvail);
    if (actualQty <= 0) {
      return {
        next: state,
        actualQty: 0,
        detail: `「${UNASSIGNED_POOL_LABEL}」无可用「${transfer.unit}」余量，调配出账跳过`,
      };
    }
    // 匹配全局中的规范型号名
    for (const raw of state.forces?.vehicles ?? []) {
      const parsed = parseTransferVehicleToken(raw);
      if (parsed && vehicleModelMatches(parsed.model, transfer.unit)) {
        canonicalModel = parsed.model;
        break;
      }
    }
    tokensToMove = Array.from({ length: actualQty }, () => canonicalModel);
  }

  if (!toIsUnassigned && targetBase) {
    const dstIdx = nextBases.findIndex(b => b.id === targetBase.id && b.name === targetBase.name);
    if (dstIdx >= 0) {
      const dstVehicles = [...(nextBases[dstIdx].forces?.vehicles ?? []), ...tokensToMove];
      nextBases[dstIdx].forces = {
        ...nextBases[dstIdx].forces,
        vehicles: dstVehicles,
      };
    }
  }

  // 守恒护栏：将全局 forces.vehicles 中同型号的 ×N 简写展开为标准单车元素，并在总驻防超出全局时补齐
  let totalAllocatedAfter = 0;
  for (const b of nextBases) {
    totalAllocatedAfter += countVehiclesInList(b.forces?.vehicles, canonicalModel);
  }
  let nextGlobalVehicles: string[] = [];
  for (const raw of state.forces?.vehicles ?? []) {
    const parsed = parseTransferVehicleToken(raw);
    if (parsed && vehicleModelMatches(parsed.model, canonicalModel) && parsed.count > 1) {
      for (let i = 0; i < parsed.count; i++) {
        nextGlobalVehicles.push(`${parsed.model}${parsed.statusSuffix}`);
      }
    } else {
      nextGlobalVehicles.push(raw);
    }
  }
  const globalCountNow = countVehiclesInList(nextGlobalVehicles, canonicalModel);
  if (globalCountNow < totalAllocatedAfter) {
    const diff = totalAllocatedAfter - globalCountNow;
    nextGlobalVehicles = [...nextGlobalVehicles, ...Array.from({ length: diff }, () => canonicalModel)];
  }

  const nextState: Record<string, unknown> = {
    ...state,
    bases: nextBases,
    forces: {
      ...(state.forces ?? {}),
      vehicles: nextGlobalVehicles,
    },
  };

  return {
    next: nextState as S,
    actualQty,
    detail: `「${canonicalModel}」×${actualQty} 已调配入驻「${toLabel}」（源自「${fromLabel}」）`,
  };
}

/**
 * 申请单位跨基地调配：
 * - 校验目标基地与源驻地可用存量（超额自动钳制并留痕）；
 * - 若 duration_min <= 0（如超时空传送/管道瞬达），当即执行 `applyUnitTransferArrival` 落账；
 * - 若 duration_min > 0，写入 `state.pending_transfers` 等待后续 Δt 结算。
 */
export function requestUnitTransfer<S extends UnitTransferState>(
  state: S,
  req: UnitTransferRequest,
): { next: S; events: UnitTransferEvent[] } {
  const events: UnitTransferEvent[] = [];
  const unitRaw = String(req.unit ?? '').trim();
  const toRaw = String(req.to_base ?? '').trim();
  const category = resolveTransferCategory(state, unitRaw, req.category);

  if (!unitRaw || !toRaw) {
    events.push({
      type: 'transfer_rejected',
      light: '🟡',
      unit: unitRaw || '（未署名单位）',
      category,
      qty: 0,
      from_base: String(req.from_base ?? ''),
      to_base: toRaw,
      detail: '调配令缺少单位名称或目的地，已拒收',
    });
    return { next: state, events };
  }

  const bases = state.bases ?? [];
  const toIsUnassigned = isUnassignedBaseRef(toRaw);
  const targetBase = toIsUnassigned ? undefined : findBaseInList(bases, toRaw);
  if (!toIsUnassigned && !targetBase) {
    events.push({
      type: 'transfer_rejected',
      light: '🟡',
      unit: unitRaw,
      category,
      qty: 0,
      from_base: String(req.from_base ?? ''),
      to_base: toRaw,
      detail: `目标基地「${toRaw}」不存在，调配令拒收`,
    });
    return { next: state, events };
  }
  const toCanonical = toIsUnassigned ? UNASSIGNED_POOL_LABEL : targetBase!.name;

  // 解析源驻地
  const fromRaw = String(req.from_base ?? '').trim();
  let fromCanonical: string;
  if (!fromRaw) {
    fromCanonical = inferSourceBase(state, category, unitRaw, toCanonical);
  } else if (isUnassignedBaseRef(fromRaw)) {
    fromCanonical = UNASSIGNED_POOL_LABEL;
  } else {
    const srcBase = findBaseInList(bases, fromRaw);
    if (!srcBase) {
      events.push({
        type: 'transfer_rejected',
        light: '🟡',
        unit: unitRaw,
        category,
        qty: 0,
        from_base: fromRaw,
        to_base: toCanonical,
        detail: `出发基地「${fromRaw}」不存在，调配令拒收`,
      });
      return { next: state, events };
    }
    fromCanonical = srcBase.name;
  }

  if (normKey(fromCanonical) === normKey(toCanonical)) {
    events.push({
      type: 'transfer_rejected',
      light: '🟡',
      unit: unitRaw,
      category,
      qty: 0,
      from_base: fromCanonical,
      to_base: toCanonical,
      detail: `出发地与目的地均为「${toCanonical}」，无需调配`,
    });
    return { next: state, events };
  }

  const requestedQty = category === 'girls' ? 1 : Math.max(1, Math.floor(Number(req.qty) || 1));
  const avail = getAvailableCountAtSource(state, category, unitRaw, fromCanonical);
  if (avail <= 0) {
    events.push({
      type: 'transfer_rejected',
      light: '🟡',
      unit: unitRaw,
      category,
      qty: 0,
      from_base: fromCanonical,
      to_base: toCanonical,
      detail: `源驻地「${fromCanonical}」无可用「${unitRaw}」（或已全部在途调配中），调配令拒收`,
    });
    return { next: state, events };
  }

  const effectiveQty = Math.min(requestedQty, avail);
  if (effectiveQty < requestedQty) {
    events.push({
      type: 'transfer_clamped',
      light: '🟡',
      unit: unitRaw,
      category,
      qty: effectiveQty,
      from_base: fromCanonical,
      to_base: toCanonical,
      detail: `源驻地「${fromCanonical}」可用「${unitRaw}」为 ${avail}，调配数量由 ${requestedQty} 自动钳制为 ${effectiveQty}`,
    });
  }

  const totalMinutes = Math.max(0, Math.round(Number(req.duration_min) || 0));
  const remainingMinutes =
    req.remaining_min !== undefined
      ? Math.max(0, Math.round(Number(req.remaining_min) || 0))
      : totalMinutes;
  const method = String(req.method ?? '').trim();
  const reason = String(req.reason ?? '').trim();
  const startedAt = String(req.started_at ?? state.meta?.date ?? '').trim();

  const transferRecord: PendingUnitTransfer = {
    id: `xfer:${unitRaw}@${fromCanonical}->${toCanonical}#${(state.pending_transfers?.length ?? 0) + 1}`,
    unit: unitRaw,
    category,
    qty: effectiveQty,
    from_base: fromCanonical,
    to_base: toCanonical,
    total_minutes: totalMinutes,
    remaining_minutes: remainingMinutes,
    method,
    reason,
    started_at: startedAt,
  };

  // 耗时为 0（如超时空传送 / 瞬达）：当楼直接交割
  if (remainingMinutes <= 0) {
    const arrived = applyUnitTransferArrival(state, transferRecord);
    events.push({
      type: arrived.actualQty > 0 ? 'transfer_arrived' : 'transfer_orphan',
      light: arrived.actualQty > 0 ? '🟢' : '🟡',
      unit: unitRaw,
      category,
      qty: arrived.actualQty,
      from_base: fromCanonical,
      to_base: toCanonical,
      detail: arrived.detail + (method ? `（方式：${method}）` : ''),
    });
    return { next: arrived.next, events };
  }

  const existingPending = [...(state.pending_transfers ?? [])];
  // 幂等与机娘唯一在途替换
  if (category === 'girls') {
    const existingGirlIdx = existingPending.findIndex(
      p => p.category === 'girls' && normKey(p.unit) === normKey(unitRaw),
    );
    if (existingGirlIdx >= 0) {
      existingPending[existingGirlIdx] = {
        ...transferRecord,
        id: existingPending[existingGirlIdx].id,
      };
    } else {
      existingPending.push(transferRecord);
    }
  } else {
    const duplicate = existingPending.find(
      p =>
        p.category === category &&
        normKey(p.unit) === normKey(unitRaw) &&
        normKey(p.from_base) === normKey(fromCanonical) &&
        normKey(p.to_base) === normKey(toCanonical) &&
        p.total_minutes === totalMinutes &&
        p.remaining_minutes === remainingMinutes &&
        p.qty === effectiveQty,
    );
    if (duplicate) {
      return { next: state, events };
    }
    existingPending.push(transferRecord);
  }

  const nextState: Record<string, unknown> = {
    ...state,
    pending_transfers: existingPending,
  };
  events.push({
    type: 'transfer_started',
    light: '🟢',
    unit: unitRaw,
    category,
    qty: effectiveQty,
    from_base: fromCanonical,
    to_base: toCanonical,
    detail:
      `单位调配启动：「${unitRaw}」×${effectiveQty}（${fromCanonical} → ${toCanonical}，` +
      `${method ? `方式：${method}，` : ''}预计耗时 ${formatTransferMinutes(remainingMinutes)}）`,
  });

  return { next: nextState as S, events };
}

/**
 * 结算在途单位调配（随每轮 Δt 递减 remaining_minutes，归零时执行守恒交割并从 pending_transfers 销号）
 */
export function settleUnitTransfers<S extends UnitTransferState>(
  state: S,
  deltaMinutes: number,
): { next: S; events: UnitTransferEvent[] } {
  const pending = state.pending_transfers ?? [];
  if (pending.length === 0) return { next: state, events: [] };

  const hasImmediate = pending.some(p => (p.remaining_minutes ?? 0) <= 0);
  if (deltaMinutes <= 0 && !hasImmediate) {
    return { next: state, events: [] };
  }

  let current: S = { ...state };
  const events: UnitTransferEvent[] = [];
  const remainingList: PendingUnitTransfer[] = [];
  const effectiveDelta = Math.max(0, Number(deltaMinutes) || 0);

  for (const item of pending) {
    const prevRem = Math.max(0, Number(item.remaining_minutes) || 0);
    const left = prevRem - effectiveDelta;
    if (left > 0) {
      remainingList.push({
        ...item,
        remaining_minutes: left,
      });
      continue;
    }

    const arrived = applyUnitTransferArrival(current, {
      ...item,
      remaining_minutes: 0,
    });
    current = arrived.next;
    events.push({
      type: arrived.actualQty > 0 ? 'transfer_arrived' : 'transfer_orphan',
      light: arrived.actualQty > 0 ? '🟢' : '🟡',
      unit: item.unit,
      category: item.category,
      qty: arrived.actualQty,
      from_base: item.from_base || UNASSIGNED_POOL_LABEL,
      to_base: item.to_base,
      detail: arrived.detail + (item.method ? `（方式：${item.method}）` : ''),
    });
  }

  const nextObj: Record<string, unknown> = { ...(current as Record<string, unknown>) };
  if (remainingList.length > 0) {
    nextObj.pending_transfers = remainingList;
  } else {
    delete nextObj.pending_transfers;
  }

  return { next: nextObj as S, events };
}
