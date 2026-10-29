/**
 * settleFloorHelpers.ts —— settleFloor 纯辅助计算与数据源回调模块
 *
 * 从 settleFloor.ts 拆出：
 * - Δt 三来源解析（resolveDeltaMinutes）
 * - canon 后缀去重与上一楼终态清理（canonTxnName / pruneCompletedQueuesFromPrevFloor / dedupeNewQueues）
 * - §3.3 工期回填（durationFromEntry / entryForTxn / backfillDurations）
 * - 数据源回调（算力池预算、纳米库存扣减、建筑工况效率 makeTxnEffFor、装配数据块 assemblySpecOf）
 * - 结算事件转解析留痕（eventToParseEvent / eventToIssue）与资金链事件载荷映射（chainPayloadOf）
 */

import type { EffectiveCatalog } from '../core/catalogEffective';
import { findCatalogBuildingDef } from '../core/prerequisitesHelpers';
import {
  canon,
  type EventDeclaration,
  type ParseEvent,
  type StatData,
} from '../parse/parsePipeline';
import { checkAssetQueueCross, checkDeploymentVehicleCross, type CheckIssue } from '../parse/systemCheck';
import { parseTimePast } from '../parse/timePastParser';
import { calculateBuildingOperation } from '../../中控悬浮窗/models/operationEngine';
import {
  inferCategoryEntityDuration,
  parseEtaStringToWorkload,
} from '../../中控悬浮窗/models/worldbookCatalogHelpers';
import type { ChainEventPayload } from './chainEngine';
import {
  buildingMatchesLaneAnchor,
  LANE_REGISTRY,
  laneFor,
  prodLaneIndexFromCatalog,
  type ProdTxnView,
} from './productionLanes';
import { evaluateCommandHQModifiers } from './settleFloorPhases';
import { resolveEffectiveBaseWeather } from './timezoneWeatherEngine';
import type { TransactionItem } from './transactionEngine';
import type { ComputeBudget, TwoStageEvent, TwoStageSpec } from './twoStageAssemblyEngine';

export { checkAssetQueueCross, checkDeploymentVehicleCross };

/* ═══════════════ Δt 三来源（已登记偏差：无 60 分钟兜底） ═══════════════ */

export type DeltaSource = 'timePast' | 'meta.date' | 'none';

export interface DeltaResolution {
  deltaMinutes: number;
  source: DeltaSource;
}

/** 标准公历日期（YYYY-MM-DD / YYYY/MM/DD，可带时间后缀）→ 日序数；不可解析返回 null */
function daySerial(date: unknown): number | null {
  if (typeof date !== 'string') return null;
  const m = date.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.round(t / 86400000) : null;
}

/**
 * Δt 取值顺序（批准定案）：
 * ① parseTimePast(raw) 成功才算（失败/缺标签**不走 60 分钟兜底**，直接下一源）；
 * ② prev.meta.date → next.meta.date 标准日期差 ×1440（差 ≤0 视为无推进）；
 * ③ 都没有记 0、不推进。
 */
export function resolveDeltaMinutes(rawText: string, prevData: unknown, nextData: StatData): DeltaResolution {
  const tp = parseTimePast(rawText);
  if (tp.success) return { deltaMinutes: tp.deltaMinutes, source: 'timePast' };

  const prev = daySerial((prevData as { meta?: { date?: unknown } } | undefined)?.meta?.date);
  const next = daySerial(nextData.meta.date);
  if (prev !== null && next !== null && next > prev) {
    return { deltaMinutes: (next - prev) * 1440, source: 'meta.date' };
  }
  return { deltaMinutes: 0, source: 'none' };
}

/* ═══════════════ canon 后缀去重（R22） ═══════════════ */

/**
 * 试制/研制/改装型 后缀词表（canon 形式，长的在前优先剥离）。
 * 词表变更必须同步 __tests__/settleFloor.test.ts 的词表钉死测试。
 */
export const TXN_SUFFIXES: readonly string[] = ['试制型', '研制型', '改装型', '试制', '研制'];

/** canon 归一后剥一次事务后缀（无后缀原样返回） */
export function canonTxnName(item: unknown): string {
  const c = canon(item);
  for (const suffix of TXN_SUFFIXES) {
    if (c.length > suffix.length && c.endsWith(suffix)) return c.slice(0, -suffix.length);
  }
  return c;
}

export interface QueueLike {
  type: string;
  item: string;
  base: string;
  status: string;
}

function identityOf(q: QueueLike): string {
  return `${q.type}\u0000${canon(q.item)}\u0000${q.base}`;
}

/**
 * 单楼层暂态完成态归档清理（D-BLD-05）：
 * 仅当某队列项在上一楼（prevData.queues）中就已经处于终态（status === 'done' || status === 'cancelled'），
 * 且在本楼（queues）中仍处于终态（status === 'done' || status === 'cancelled'）时，
 * 将其作为上一楼遗留终态项从本楼队列中剔除，使 N 楼显示 100%「已完成」暂态反馈、N+1 楼自动归零。
 * 若某项在 prevData.queues 中非终态而在本楼刚转为 done/cancelled（如工程阶段验收 afterEngClaim），
 * 则本楼保留以走完 syncProjects 并留存本楼快照。
 */
export function pruneCompletedQueuesFromPrevFloor(
  prevData: unknown,
  queues: TransactionItem[],
  nextTechDone?: readonly string[],
): { queues: TransactionItem[]; events: ParseEvent[] } {
  const prevQueues = readQueues(prevData);
  const prevTerminalIdentities = new Set<string>();
  for (const pq of prevQueues) {
    if (pq.status === 'done' || pq.status === 'cancelled') {
      prevTerminalIdentities.add(identityOf(pq));
    }
  }
  const prevTechArr = Array.isArray((prevData as { tech?: { done?: unknown[] } } | undefined)?.tech?.done)
    ? ((prevData as { tech?: { done?: unknown[] } }).tech!.done!.filter((x): x is string => typeof x === 'string'))
    : [];
  const prevTechCanonSet = new Set(prevTechArr.map(t => canon(t)));
  const nextTechCanonSet = new Set((nextTechDone ?? []).map(t => canon(t)));

  if (prevTerminalIdentities.size === 0 && prevTechCanonSet.size === 0 && nextTechCanonSet.size === 0) {
    return { queues, events: [] };
  }

  const events: ParseEvent[] = [];
  const nextQueues: TransactionItem[] = [];
  for (const q of queues) {
    if ((q.status === 'done' || q.status === 'cancelled') && prevTerminalIdentities.has(identityOf(q))) {
      events.push({
        light: '🟢',
        layer: 'instruction',
        message: `[结算] 归档清理上一楼终态队列项「${q.item}」（status=${q.status}）`,
        path: 'queues',
        before: q.item,
      });
      continue;
    }
    if (q.type === '研究' && q.status !== 'cancelled') {
      const cItem = canon(q.item);
      if (prevTechCanonSet.has(cItem) || nextTechCanonSet.has(cItem)) {
        events.push({
          light: '🟢',
          layer: 'instruction',
          message: `[结算] 科技「${q.item}」已收录于 tech.done，自动清理残留研究队列项（原 status=${q.status}）`,
          path: 'queues',
          before: q.item,
        });
        continue;
      }
    }
    nextQueues.push(q);
  }
  return { queues: nextQueues, events };
}

/**
 * 去重：本楼新建事务（prev 中无同身份者）按 canonTxnName 与同 base、同 type 的在册
 * active 事务比对，命中则移除新事务（在册事务字段原样保留），记 R22 info。
 * 存量重复（prev 里已共存）不自动合并。
 */
export function dedupeNewQueues(
  prevData: unknown,
  queues: TransactionItem[],
): { queues: TransactionItem[]; events: ParseEvent[]; issues: CheckIssue[] } {
  const prevQueues = readQueues(prevData);
  const prevIdentities = new Set(prevQueues.map(identityOf));
  const events: ParseEvent[] = [];
  const issues: CheckIssue[] = [];
  const removed = new Set<TransactionItem>();

  for (const txn of queues) {
    if (prevIdentities.has(identityOf(txn))) continue; // 非本楼新建
    const target = queues.find(
      q =>
        q !== txn &&
        !removed.has(q) &&
        q.status === 'active' &&
        q.type === txn.type &&
        q.base === txn.base &&
        canon(q.item) !== canon(txn.item) &&
        canonTxnName(q.item) === canonTxnName(txn.item),
    );
    if (!target) continue;
    removed.add(txn);
    events.push({
      light: '🟢',
      layer: 'instruction',
      message: `[结算] 队列去重合并「${txn.item}」→「${target.item}」（同 base 同 type 在册 active，canon 后缀归并）`,
      path: 'queues',
      before: txn.item,
      after: target.item,
    });
    issues.push({
      rule: 'R22',
      level: 'info',
      target: `队列[${txn.item}]`,
      message: `已合并到在册 active 事务「${target.item}」（后缀归并）；存量重复不自动合并，如需处理请走体检`,
    });
  }
  return { queues: queues.filter(q => !removed.has(q)), events, issues };
}

/* ═══════════════ §3.3 工期回填 ═══════════════ */

/** ECON-02 §4.1 梯级建造带宽（credits/日；Q-Flow 收入三档基线） */
export const TIER_BANDWIDTH_PER_DAY: Readonly<Record<1 | 2 | 3, number>> = { 1: 5000, 2: 8000, 3: 20000 };

export function readPosNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** 非负数字（0 合法，供 clock.day / day_count 读取） */
export function readNonNegNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

export function readRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/**
 * 从 catalog 条目取工期：① <数据> 显式工期（workload.days / assembly.min_days /
 * 透传 days|min_days，或 eta 文本如 "约3日"，单位天）；② 当条目带有分类/建筑特征字段时按六大类别推导写实工期；
 * ③ 纯裸 `{ cost, tier }` 输入保留 ECON-02 §4.1 梯级带宽反算向后兼容。
 * minDaysLock 取 workload.min_days ?? assembly.min_days ?? 透传 min_days ?? eta/分类推导下限。
 */
export function durationFromEntry(
  entry: unknown,
): { totalMinutes: number; minDaysLock: number; source: string } | null {
  const e = readRecord(entry);
  if (!e) return null;
  const workload = readRecord(e.workload);
  const assembly = readRecord(e.assembly);
  const minDaysLock = readPosNum(workload?.min_days) ?? readPosNum(assembly?.min_days) ?? readPosNum(e.min_days) ?? 0;

  const explicitDays = readPosNum(workload?.days) ?? readPosNum(assembly?.min_days) ?? readPosNum(e.days);
  if (explicitDays !== undefined) {
    return { totalMinutes: explicitDays * 1440, minDaysLock, source: '显式工期' };
  }
  const parsedEta = parseEtaStringToWorkload(e.eta, minDaysLock > 0 ? minDaysLock : undefined);
  if (parsedEta && parsedEta.days > 0) {
    return {
      totalMinutes: parsedEta.days * 1440,
      minDaysLock: minDaysLock > 0 ? minDaysLock : parsedEta.min_days,
      source: '显式工期',
    };
  }
  const cost = readPosNum(e.cost);
  if (cost !== undefined) {
    const hasCategorySignal =
      e.type === 'building' ||
      e.type === 'production' ||
      typeof e.category === 'string' ||
      typeof e.system === 'string' ||
      typeof e.need_building === 'string' ||
      (Array.isArray(e.need_buildings) && e.need_buildings.length > 0) ||
      typeof e.power === 'number';
    if (hasCategorySignal) {
      const inferred = inferCategoryEntityDuration(e);
      return {
        totalMinutes: inferred.days * 1440,
        minDaysLock: minDaysLock > 0 ? minDaysLock : inferred.min_days,
        source: `分类工期（${inferred.categoryLabel}）`,
      };
    }
    const tierRaw = readPosNum(e.tier);
    const tier = (tierRaw === 2 || tierRaw === 3 ? tierRaw : 1) as 1 | 2 | 3;
    const days = cost / TIER_BANDWIDTH_PER_DAY[tier];
    return { totalMinutes: days * 1440, minDaysLock, source: `ECON-02 反算（T${tier} 带宽）` };
  }
  return null;
}

/** 按事务类型取 catalog 条目（canon 名匹配；建造类复用 findCatalogBuildingDef 支持阵营前缀；catalog 缺席返回 undefined） */
export function entryForTxn(catalog: EffectiveCatalog | null, txn: TransactionItem): unknown {
  if (!catalog) return undefined;
  if (txn.type === '建造') {
    return findCatalogBuildingDef(catalog.buildings, txn.item);
  }
  const pools: Record<string, readonly { name: string; aliases?: readonly string[] }[]> = {
    研究: catalog.researches,
    生产: catalog.productions,
    改装: catalog.retrofits,
  };
  const pool = pools[txn.type];
  if (!pool) return undefined;
  const c = canon(txn.item);
  return (
    pool.find(e => canon(e.name) === c) ??
    pool.find(e => Array.isArray(e.aliases) && e.aliases.some(a => canon(a) === c))
  );
}

/** total_minutes≤0 的事务按 §3.3 回填工期（含 min_days_lock）；每楼幂等（回填后 >0 不再触发） */
export function backfillDurations(
  catalog: EffectiveCatalog | null,
  queues: TransactionItem[],
): { queues: TransactionItem[]; events: ParseEvent[] } {
  const events: ParseEvent[] = [];
  const next = queues.map(txn => {
    if (txn.total_minutes > 0) return txn;
    const d = durationFromEntry(entryForTxn(catalog, txn));
    if (!d) return txn;
    const qty = Math.max(1, Math.floor(txn.qty ?? 1));
    const batchTotalMinutes = d.totalMinutes * qty;
    const out: TransactionItem = {
      ...txn,
      total_minutes: batchTotalMinutes,
      min_days_lock: txn.min_days_lock > 0 ? txn.min_days_lock : d.minDaysLock,
    };
    events.push({
      light: '🟢',
      layer: 'instruction',
      message: `[结算] 回填工期「${txn.item}」total_minutes=${Math.round(batchTotalMinutes)}（${d.source}${qty > 1 ? ` ×${qty}` : ''}）`,
      path: 'queues',
      after: { total_minutes: batchTotalMinutes, min_days_lock: out.min_days_lock },
    });
    return out;
  });
  return { queues: next, events };
}

/* ═══════════════ 数据源回调（catalog / operationEngine / economy） ═══════════════ */

export interface BaseLike {
  id: string;
  name: string;
  location?: string;
  status?: string;
  tz_offset?: number;
  weather?: string;
  site_type?: string;
  power?: { gen?: number; use?: number };
  buildings?: { name: string; state?: string }[];
}

export function readBases(data: unknown): BaseLike[] {
  const bases = (data as { bases?: unknown } | undefined)?.bases;
  return Array.isArray(bases) ? (bases as BaseLike[]) : [];
}

export function readQueues(data: unknown): QueueLike[] {
  const queues = (data as { queues?: unknown } | undefined)?.queues;
  return Array.isArray(queues) ? (queues as QueueLike[]) : [];
}

export function baseOfIdOrName(data: StatData, baseRef: string | undefined): BaseLike | undefined {
  if (!baseRef) return undefined;
  const bases = readBases(data);
  return bases.find(b => b.id === baseRef) ?? bases.find(b => canon(b.name) === canon(baseRef));
}

export function baseOfTxn(data: StatData, txn: TransactionItem): BaseLike | undefined {
  return baseOfIdOrName(data, txn.base);
}

/** 汇总战区可用纳米总库存（全小类有限数值求和；兼容数值型 nanites；未探明 null 按 0 计） */
export function readTotalNanites(data: StatData): number {
  const rawNanites = (data.economy?.resources as Record<string, unknown> | undefined)?.nanites;
  if (typeof rawNanites === 'number') {
    return Number.isFinite(rawNanites) ? Math.max(0, rawNanites) : 0;
  }
  const nanites = readRecord(rawNanites);
  if (!nanites) return 0;
  return Object.values(nanites).reduce<number>(
    (sum, v) => sum + (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0),
    0,
  );
}

export const NANITE_DEDUCTION_PRIORITY: readonly string[] = [
  '通用纳米工料',
  '标准纳米工料',
  '军工纳米工料',
  '特种纳米工料',
  '高精构造型纳米',
  '高能纳米工料',
  '机娘修复凝胶',
];

/** 从 stat_data.economy.resources.nanites 真实扣减本楼消耗的纳米库存（兜底 Math.max(0, ...)，FIX-P1-01 / SIM-NANITE-01 / BUG-R2-11） */
export function deductNanitesStock(data: StatData, totalDeducted: number): StatData {
  if (!Number.isFinite(totalDeducted) || totalDeducted <= 0) return data;
  const rawNanites = (data.economy?.resources as Record<string, unknown> | undefined)?.nanites;
  if (typeof rawNanites === 'number' && Number.isFinite(rawNanites)) {
    return {
      ...data,
      economy: {
        ...data.economy,
        resources: {
          ...(data.economy.resources as NonNullable<StatData['economy']['resources']>),
          nanites: Math.max(0, rawNanites - totalDeducted) as unknown as NonNullable<
            StatData['economy']['resources']
          >['nanites'],
        },
      },
    };
  }
  const nanites = readRecord(rawNanites);
  if (!nanites) return data;
  const nextNanites: Record<string, unknown> = { ...nanites };
  const prioritySet = new Set<string>(NANITE_DEDUCTION_PRIORITY);
  const orderedKeys = [
    ...NANITE_DEDUCTION_PRIORITY.filter(k => Object.prototype.hasOwnProperty.call(nextNanites, k)),
    ...Object.keys(nextNanites).filter(k => !prioritySet.has(k)),
  ];
  let remaining = totalDeducted;
  for (const k of orderedKeys) {
    if (remaining <= 0) break;
    const v = nextNanites[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      const take = Math.min(v, remaining);
      nextNanites[k] = Math.max(0, v - take);
      remaining -= take;
    }
  }
  return {
    ...data,
    economy: {
      ...data.economy,
      resources: {
        ...(data.economy.resources as NonNullable<StatData['economy']['resources']>),
        nanites: nextNanites as NonNullable<StatData['economy']['resources']>['nanites'],
      },
    },
  };
}

/** 汇总单基地可用算力池预算（tflops / tops） */
export function computeBudgetForBase(
  catalog: EffectiveCatalog,
  base: BaseLike | undefined,
  data?: Partial<StatData> | null,
): ComputeBudget {
  if (!base || base.status === '失守' || base.status === '废弃') return { tflops: 0, tops: 0 };
  const evals = evalBaseBuildings(catalog, base, data);
  return {
    tflops: evals.reduce((s, e) => s + e.compute.tflops, 0),
    tops: evals.reduce((s, e) => s + e.compute.tops, 0),
  };
}

/** 汇总全战区非陷落基地可用算力池预算（供战区全局无基地绑定事务使用，FIX-P0-04） */
export function computeBudgetForTheater(
  catalog: EffectiveCatalog,
  bases: readonly BaseLike[],
  data?: Partial<StatData> | null,
): ComputeBudget {
  let tflops = 0;
  let tops = 0;
  for (const base of bases) {
    if (!base || base.status === '失守' || base.status === '废弃') continue;
    const budget = computeBudgetForBase(catalog, base, data);
    tflops += budget.tflops;
    tops += budget.tops;
  }
  return { tflops, tops };
}

const INACTIVE_BUILDING_STATES_FOR_EFF = new Set([
  '建造中',
  '停机',
  '受损',
  '离线',
  '被毁',
  '战损',
  '摧毁',
  '瘫痪',
  '废墟',
  '重创',
  '拆除',
  '变卖',
  '停用',
  '封存',
]);

const DESTROYED_OR_STOPPED_STATES_FOR_EFF = new Set([
  '停机',
  '离线',
  '被毁',
  '摧毁',
  '废墟',
  '拆除',
  '变卖',
  '停用',
  '封存',
]);

const DAMAGED_STATES_FOR_EFF = new Set(['受损', '战损', '瘫痪', '重创']);

function effectiveBuildingState(building: { state?: string; status?: string }): string {
  const rawState = typeof building.state === 'string' ? building.state.trim() : '';
  const rawStatus =
    typeof (building as { status?: string }).status === 'string' ? (building as { status?: string }).status!.trim() : '';
  if (rawState && INACTIVE_BUILDING_STATES_FOR_EFF.has(rawState)) return rawState;
  if (rawStatus && INACTIVE_BUILDING_STATES_FOR_EFF.has(rawStatus)) return rawStatus;
  return rawState || rawStatus || '运转';
}

function isBuildingOperationalState(bState: string): boolean {
  return bState === '运转' || bState === '正常' || bState === '';
}

/**
 * 计算基地经参谋副官「高压电网调谐」与阵营磨合「并网冲击掉电」修正后的有效电力（FD-26 · D-WIRE-1 / D-SCOPE-1）：
 * `effectiveGen = rawGen * Math.max(0, 1 + powerOutputBonus - powerLossRatio)`
 */
export function resolveEffectiveBasePower(
  base: BaseLike | undefined,
  data?: Partial<StatData> | null,
): { gen: number; use: number } {
  const rawGen = base?.power?.gen ?? 0;
  const rawUse = base?.power?.use ?? 0;
  const effectiveData =
    data ??
    ((base as unknown as Partial<StatData> | undefined)?.command
      ? (base as unknown as Partial<StatData>)
      : undefined);
  if (!base || !effectiveData) {
    return { gen: rawGen, use: rawUse };
  }
  const mods = evaluateCommandHQModifiers(effectiveData, base.id || base.name);
  if (mods.powerOutputBonus === 0 && mods.powerLossRatio === 0) {
    return { gen: rawGen, use: rawUse };
  }
  const factor = Math.max(0, 1 + mods.powerOutputBonus - mods.powerLossRatio);
  return {
    gen: Math.round(rawGen * factor * 10000) / 10000,
    use: rawUse,
  };
}

/** 基地内「有 catalog 工况条目」且处于运转状态的建筑逐一求值（建筑 state 与副官/磨合修正后电力融合进环境事实） */
export function evalBaseBuildings(
  catalog: EffectiveCatalog,
  base: BaseLike,
  data?: Partial<StatData> | null,
) {
  const results: {
    name: string;
    primaryBehavior: string;
    efficiency: number;
    compute: { tflops: number; tops: number };
  }[] = [];
  const effPower = resolveEffectiveBasePower(base, data);
  const env = { power: effPower };
  for (const building of base.buildings ?? []) {
    const bState = effectiveBuildingState(building);
    if (!isBuildingOperationalState(bState)) continue;
    const def = findCatalogBuildingDef(catalog.buildings, building.name);
    if (!def) continue;
    const evalResult = calculateBuildingOperation(
      { ...(def as unknown as Record<string, unknown>), state: bState },
      env,
    );
    results.push({
      name: building.name,
      primaryBehavior: evalResult.primaryBehavior,
      efficiency: evalResult.efficiency,
      compute: {
        tflops: evalResult.effectiveVirtual?.compute?.tflops ?? 0,
        tops: evalResult.effectiveVirtual?.compute?.tops ?? 0,
      },
    });
  }
  return results;
}

const CATEGORY_FALLBACK_ANCHORS: Readonly<Record<string, readonly string[]>> = {
  ['生' + '产']: ['兵营', '战车工厂', '军工车间', '车厂', '空军指挥部', '造船厂', '船坞', '工坊'],
  ['建' + '造']: ['建造厂', 'MCV'],
  ['改' + '装']: ['工坊', '维修所', '战车工厂', '军工车间', '建造厂', 'MCV'],
  ['工' + '程']: [
    '建造厂',
    'MCV',
    '维修所',
    '军工车间',
    '造船厂',
    '科学城',
    '航天发射中心',
    '海上发射平台',
    '大型航天发射综合体',
    '山体发射场',
    '巨型航天发射港',
  ],
  ['研' + '究']: ['科研', '研究', '实验室', '科学城', '超算中心', '学院', '控制中心', '作战实验室'],
};

const PROD_LIKE_CATEGORIES: ReadonlySet<string> = new Set(['生' + '产', '建' + '造', '改' + '装']);

const FALLBACK_PRODUCTION_LANE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/战机|飞机|飞艇|空艇|基洛夫|直升机|无人机|侦察机|轰炸机|运输机|飞行器|入侵者|黑鹰|夜鹰|米格|苏霍伊|幽浮|飞碟/, 'lane.vehicle_air'],
  [/潜艇|航母|驱逐舰|巡洋舰|护卫舰|战列舰|无畏|神盾|海豚|乌贼|海蝎|气垫船|登陆艇|快艇|舰|船|艇/, 'lane.vehicle_naval'],
  [
    /坦克|装甲|机甲|战车|履带|基地车|MCV|采矿车|矿车|天启|犀牛|灰熊|光棱|幻影|磁能|V3|火箭发射车|防空车|步兵车|IFV|蜘蛛|恐怖机器人|自爆卡车|卡车|吉普|摩托|火炮|机动平台|突击车|控制车|磁电|盖特/i,
    'lane.vehicle_land',
  ],
  [
    /步兵|动员兵|大兵|工程兵|工程师|间谍|狙击|军犬|警犬|尤里新兵|新兵|复制人|士兵|军官|机娘|突击队|医疗|兵种|飞行兵|火箭飞行兵|海豹|谭雅|鲍里斯|伊文|恐怖分子|辐射工兵|防空步兵|磁暴步兵|心灵突击|精神突击|尤里X/,
    'lane.personnel',
  ],
  [/装备|武器|枪械|弹药|瞄准|外骨骼|军服|护具|防具|动力甲/, 'lane.equipment'],
];

function inferProdLaneIdForTxn(catalog: EffectiveCatalog | null, txn: TransactionItem): string {
  const prodLaneOf = catalog ? prodLaneIndexFromCatalog(catalog) : undefined;
  const { laneId } = laneFor(txn as unknown as ProdTxnView, prodLaneOf);
  if (laneId && laneId !== 'lane.default') return laneId;
  if (txn.type === '生产') {
    const item = String(txn.item ?? '');
    for (const [pattern, inferredLane] of FALLBACK_PRODUCTION_LANE_PATTERNS) {
      if (pattern.test(item)) return inferredLane;
    }
  }
  return laneId;
}

/** 按事务类别/产线定位基地内关联的锚定建筑列表（SIM-WEATHER-01：解除单建筑受损连坐全基地队列） */
function matchingAnchorBuildingsForTxn(
  catalog: EffectiveCatalog | null,
  base: BaseLike,
  txn: TransactionItem,
): NonNullable<BaseLike['buildings']> {
  const buildings = base.buildings ?? [];
  if (buildings.length === 0) return [];
  const matchesAnyKeyword = (bName: string, keywords: readonly string[]) =>
    keywords.some(kw => bName.includes(kw));

  const category = txn.type;
  if (PROD_LIKE_CATEGORIES.has(category)) {
    const laneId = inferProdLaneIdForTxn(catalog, txn);
    const laneDef = LANE_REGISTRY.find(l => l.laneId === laneId);
    if (laneDef && laneDef.anchorNames.length > 0) {
      return buildings.filter(b => buildingMatchesLaneAnchor(b.name, laneDef));
    }
  }
  const fallbackKeywords = CATEGORY_FALLBACK_ANCHORS[category];
  if (fallbackKeywords) {
    return buildings.filter(b => matchesAnyKeyword(b.name, fallbackKeywords));
  }
  return [];
}

/** 定位生产事务在基地中匹配的运转态生产锚定建筑（BUG-R2-02） */
export function matchProducerBuildingForTxn(
  catalog: EffectiveCatalog | null,
  base: BaseLike,
  txn: TransactionItem,
): NonNullable<BaseLike['buildings']>[number] | undefined {
  const anchors = matchingAnchorBuildingsForTxn(catalog, base, txn);
  if (anchors.length === 0) return undefined;
  const operational = anchors.filter(b => isBuildingOperationalState(effectiveBuildingState(b)));
  if (operational.length === 0) return undefined;
  const prodMode = operational.find(b => (b as { mode?: string }).mode !== '加速');
  return prodMode ?? operational[0];
}

/**
 * 事务工况效率回调工厂（SIM-WEATHER-01 & BUG-R2-02 解连坐修正）：
 * 1. 电网效率 gridEff：低电赤字（power.gen < power.use）时基于非 suspended 建筑降效系数（或默认缺电 0.5 倍率）折算，
 *    绝不因雷达/超武等独立建筑 low_power suspended(0) 把全基地建造与兵营/车厂队列连坐归 0；
 * 2. 建筑效率 buildingFactor：
 *    - 对于 txn.type === '生产'：若基地内存在该生产类型的锚定建筑但全部处于非 '运转' 状态（如兵营全部受损/停机），效率为 0；
 *      若匹配到运转态生产建筑 prodBld，则乘上/取小 prodBld 自身的工况效率；
 *    - 对于其它队列：仅按事务所属类别/产线对应的锚定建筑评估。
 */
export function makeTxnEffFor(catalog: EffectiveCatalog | null, data: unknown): (txn: TransactionItem) => number {
  return txn => {
    const statData = data as Partial<StatData> | undefined;
    const base = baseOfTxn(data as StatData, txn);

    // 3. 参谋副官催产/抢修加成与阵营磨合产线迟滞（FD-26 · D-WIRE-1 / D-SCOPE-1）
    let commandFactor = 1;
    if (txn.type === '生产' || txn.type === '改装' || txn.type === '工程') {
      const targetBaseRef = txn.base || base?.id || base?.name;
      const mods = evaluateCommandHQModifiers(statData, targetBaseRef);
      const prodBonus =
        txn.type === '生产'
          ? mods.heavyVehicleProdRateBonus
          : mods.heavyVehicleProdRateBonus + mods.repairThroughputBonus;
      const prodSlowdown = Math.min(0.9, Math.max(0, mods.prodSlowdownRatio));
      if (prodBonus !== 0 || prodSlowdown !== 0) {
        commandFactor = Math.max(0.05, (1 + prodBonus) * (1 - prodSlowdown));
      }
    }

    if (!base) return commandFactor;

    const globalWeather =
      typeof statData?.meta?.weather === 'string' ? statData.meta.weather : undefined;
    const hasBaseLocalWeatherOrSite =
      (typeof base.weather === 'string' && base.weather.trim() !== '') ||
      (typeof base.site_type === 'string' && base.site_type.trim() !== '');
    const weather = hasBaseLocalWeatherOrSite
      ? resolveEffectiveBaseWeather(base, globalWeather).effectiveWeather
      : globalWeather;
    const effWeather = typeof weather === 'string' ? weather.trim() : '';

    // 1. 电网效率 gridEff（接入副官电网调谐与磨合掉电修正后的有效发电量，排除其它独立建筑 suspended(0) 连坐）
    const explicitGridEff = (base as unknown as Record<string, unknown>).gridEff;
    let gridEff =
      typeof explicitGridEff === 'number' && Number.isFinite(explicitGridEff) ? Math.max(0, explicitGridEff) : 1;
    const effPower = resolveEffectiveBasePower(base, statData);
    const isLowPower = effPower.gen < effPower.use;
    if (catalog && isLowPower) {
      const evals = evalBaseBuildings(catalog, base, statData);
      const nonSuspendedEvals = evals.filter(e => e.efficiency > 0 && e.primaryBehavior !== 'suspended');
      const degradedEvals = nonSuspendedEvals.filter(e => e.efficiency < 1);
      if (degradedEvals.length > 0) {
        gridEff = Math.min(gridEff, ...degradedEvals.map(e => e.efficiency));
      } else {
        gridEff = Math.min(gridEff, 0.5);
      }
    } else if (isLowPower) {
      gridEff = Math.min(gridEff, 0.5);
    }

    // 基地级非 suspended 天气折减系数（供建造队列或未匹配特定生产建筑的队列使用）
    const computeBaseWeatherFactor = (): number => {
      if (!catalog || !effWeather) return 1;
      let wFactor = 1;
      for (const building of base.buildings ?? []) {
        const bState = effectiveBuildingState(building);
        if (!isBuildingOperationalState(bState)) continue;
        const def = findCatalogBuildingDef(catalog.buildings, building.name);
        if (!def || !(def as { operation?: unknown }).operation) continue;
        const wRes = calculateBuildingOperation(
          { ...(def as unknown as Record<string, unknown>), state: bState },
          { power: { gen: 100, use: 0 }, weather: effWeather, building_state: bState },
        );
        if (wRes.efficiency > 0 && wRes.primaryBehavior !== 'suspended') {
          wFactor = Math.min(wFactor, wRes.efficiency);
        }
      }
      return wFactor;
    };

    // 2. 事务专属锚定建筑系数 buildingFactor（解连坐）
    const anchors = matchingAnchorBuildingsForTxn(catalog, base, txn);

    if (txn.type === '生产') {
      if (anchors.length === 0) {
        return gridEff * computeBaseWeatherFactor() * commandFactor;
      }
      const operationalProdAnchors = anchors.filter(b => isBuildingOperationalState(effectiveBuildingState(b)));
      if (operationalProdAnchors.length === 0) {
        // 基地内原本存在该生产类型的锚定建筑但全部处于非 '运转' 状态（如兵营全部受损/停机）→ 生产队列效率为 0
        return 0;
      }
      const prodBuildingEvals: Array<{ efficiency: number; isSuspended: boolean }> = [];
      for (const prodBld of operationalProdAnchors) {
        const bState = effectiveBuildingState(prodBld);
        const def = findCatalogBuildingDef(catalog?.buildings, prodBld.name);
        if (def && (def as { operation?: unknown }).operation) {
          const prodEvalFull = calculateBuildingOperation(
            { ...(def as unknown as Record<string, unknown>), state: bState },
            {
              power: effPower,
              ...(effWeather ? { weather: effWeather } : {}),
              building_state: bState,
            },
          );
          if (prodEvalFull.primaryBehavior === 'suspended' || prodEvalFull.efficiency <= 0) {
            prodBuildingEvals.push({ efficiency: 0, isSuspended: true });
            continue;
          }
          const prodEvalWeatherOnly = calculateBuildingOperation(
            { ...(def as unknown as Record<string, unknown>), state: bState },
            {
              power: { gen: 100, use: 0 },
              ...(effWeather ? { weather: effWeather } : {}),
              building_state: bState,
            },
          );
          const bEff = Math.min(gridEff * prodEvalWeatherOnly.efficiency, prodEvalFull.efficiency);
          prodBuildingEvals.push({ efficiency: bEff, isSuspended: false });
        } else {
          prodBuildingEvals.push({ efficiency: gridEff, isSuspended: false });
        }
      }
      const activeProdEvals = prodBuildingEvals.filter(e => !e.isSuspended && e.efficiency > 0);
      if (activeProdEvals.length === 0) {
        return 0;
      }
      const avgProdEff =
        activeProdEvals.reduce((sum, e) => sum + e.efficiency, 0) / activeProdEvals.length;
      const eff = Math.min(gridEff, avgProdEff);
      return eff * commandFactor;
    }

    if (anchors.length === 0) {
      return gridEff * computeBaseWeatherFactor() * commandFactor;
    }

    const evalSingleAnchor = (building: { name: string; state?: string; status?: string }): number => {
      const bState = effectiveBuildingState(building);
      if (bState === '建造中') return 1;
      const def = findCatalogBuildingDef(catalog?.buildings, building.name);
      if (def && (def as { operation?: unknown }).operation) {
        const res = calculateBuildingOperation(
          { ...(def as unknown as Record<string, unknown>), state: bState },
          {
            power: { gen: 100, use: 0 }, // 电网赤字已在 gridEff 单独计入，避免重复折算
            ...(effWeather ? { weather: effWeather } : {}),
            building_state: bState,
          },
        );
        if (DAMAGED_STATES_FOR_EFF.has(bState) && res.efficiency >= 1) return 0.5;
        if (DESTROYED_OR_STOPPED_STATES_FOR_EFF.has(bState) && res.efficiency > 0) return 0;
        return res.efficiency;
      }
      if (isBuildingOperationalState(bState)) return 1;
      if (DAMAGED_STATES_FOR_EFF.has(bState)) return 0.5;
      if (DESTROYED_OR_STOPPED_STATES_FOR_EFF.has(bState)) return 0;
      return 1;
    };

    const operationalAnchors = anchors.filter(b => isBuildingOperationalState(effectiveBuildingState(b)));

    const targetAnchors = operationalAnchors.length > 0 ? operationalAnchors : anchors;
    const buildingFactor = Math.max(...targetAnchors.map(evalSingleAnchor));
    return gridEff * buildingFactor * commandFactor;
  };
}

/** 装配数据块回调：production/building 透传 assembly（req_nanites 按单件×qty 计算）；research workload → TwoStageSpec(tflops/tops) */
export function assemblySpecOf(entry: unknown, qtyRaw = 1): TwoStageSpec | undefined {
  const e = readRecord(entry);
  if (!e) return undefined;
  const assembly = readRecord(e.assembly);
  if (assembly) {
    const qty = Math.max(1, Math.floor(qtyRaw));
    const spec: TwoStageSpec = {};
    if (readPosNum(assembly.t_mat) !== undefined) spec.t_mat = assembly.t_mat as number;
    if (readPosNum(assembly.t_asm) !== undefined) spec.t_asm = assembly.t_asm as number;
    if (readPosNum(assembly.req_nanites) !== undefined) {
      spec.req_nanites = (assembly.req_nanites as number) * qty;
    }
    return spec;
  }
  const workload = readRecord(e.workload);
  if (workload && (readPosNum(workload.tflops) !== undefined || readPosNum(workload.tops) !== undefined)) {
    return { tflops: workload.tflops as number | undefined, tops: workload.tops as number | undefined };
  }
  return undefined;
}

/* ═══════════════ 结算事件 → 解析留痕 ═══════════════ */

export function eventToParseEvent(event: TwoStageEvent): ParseEvent {
  const yellowTypes = new Set(['unknown_duration', 'preempted', 'demoted', 'dispatch_rejected']);
  return {
    light: yellowTypes.has(event.type) ? '🟡' : '🟢',
    layer: 'instruction',
    message: `[结算] ${event.type}「${event.item}」${event.detail ? `：${event.detail}` : ''}`,
    path: 'queues',
  };
}

export function eventToIssue(event: TwoStageEvent): CheckIssue | null {
  if (event.type === 'unknown_duration') {
    return {
      rule: 'R21',
      level: 'info',
      target: `队列[${event.item}]`,
      message: `未知工期事务不推进（v1 过渡期：不覆盖 LLM 报的 progress）；catalog 无工期来源`,
    };
  }
  if (event.type === 'dispatch_rejected') {
    return { rule: 'R21', level: 'warn', target: `队列[${event.item}]`, message: event.detail ?? '调度令被拒' };
  }
  if (event.type === 'nanites_deducted') {
    return {
      rule: 'R21',
      level: 'info',
      target: `队列[${event.item}]`,
      message: `${event.detail ?? '纳米抵扣'}（已从 economy.resources.nanites 真实扣减，SIM-NANITE-01）`,
    };
  }
  return null;
}

/* ═══════════════ EVT-SETTLE-01 · 资金链事件接缝 ═══════════════ */

/**
 * EventDeclaration（资金链）→ ChainEventPayload（chainEngine 契约）：
 * id 由 canon(链名) 派生，建立与后续断裂/受挫声明跨楼幂等定位同一条链。
 */
export function chainPayloadOf(decl: EventDeclaration & { kind: 'chain' }): ChainEventPayload {
  const info = decl.chain;
  if (!info) return { action: '断裂', id: 'chain_unknown' }; // 类型收窄保险（过滤器已拦）
  const id = `chain_${canon(info.name)}`;
  switch (decl.verb) {
    case '资金链建立':
      return {
        action: '建立',
        id,
        name: info.name,
        flow: info.flow,
        rate_daily: info.rate_daily,
        reason: info.reason || '新开辟资金链',
        deps: { base_id: info.base_id, buildings: info.buildings },
      };
    case '资金链断裂':
      return { action: '断裂', id, reason: info.reason || '因外力打击或突发变故彻底停摆' };
    case '资金链恢复':
      return { action: '恢复', id, reason: info.reason || '干扰排除，管网抢修完毕恢复全额履约' };
    case '资金链枯竭':
      return { action: '枯竭', id, reason: info.reason || '开采枯竭或协议终止' };
    default:
      return { action: '受挫', id, reason: info.reason || '受到局部干扰或前置设施受损，效率下降' };
  }
}
