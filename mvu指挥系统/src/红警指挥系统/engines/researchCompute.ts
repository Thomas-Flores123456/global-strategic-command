/*
 * researchCompute：科研算力聚合（纯函数，零 store / 零解析协议）
 *
 * 口径（20 号裁决·静态口径）：
 * 1. 供给＝所有可用（非废弃/失守）基地中、运转建筑的
 *    outputs.virtual.compute（tflops/tops）逐建筑汇总；建造中/停机/受损/被毁等非运转建筑不计入
 *    （状态集合与 researchSlots.INACTIVE_RESEARCH_BUILDING_STATES 同源）；
 * 2. 消耗＝在研（type==='研究' && status!=='queued'）队列项在 catalog 中的 workload；
 * 3. 建筑/研究名匹配：先精确，再收窄 includes（唯一命中才认，防止「超算中心」误中「量子超算中心」）；
 * 4. 缺口仅展示，不拦截；无算力建筑时 sources 为空，由 UI 降级提示。
 *
 * 裁决基线：不含 C1–C5 ×1.7 加速折算（那是运行引擎的事，面板只报静态名义值）。
 */

import { INACTIVE_RESEARCH_BUILDING_STATES } from './researchSlots';
import { inferDefaultResearchComputeWorkload } from '../../中控悬浮窗/models/worldbookCatalogHelpers';

export interface ComputeBuildingLike {
  name: string;
  /** 在场口径与 researchSlots.anchorPresent 对齐：建造中不计入 */
  state?: string;
  compute?: { tflops?: number; tops?: number };
  research_accel?: number;
  research_lines?: readonly string[];
}

export interface ComputeBaseLike {
  id?: string;
  name?: string;
  status?: string;
  buildings?: ReadonlyArray<ComputeBuildingLike>;
}

export interface ComputeCatalogBuilding {
  id: string;
  name?: string;
  research_accel?: number;
  research_lines?: readonly string[];
  outputs?: { virtual?: { compute?: { tflops?: number; tops?: number } } };
}

export interface WorkloadLike {
  tflops?: number;
  tops?: number;
  days?: number;
  min_days?: number;
}

export interface ComputeCatalogResearch {
  name: string;
  cost?: number;
  tier?: number;
  line?: string;
  workload?: WorkloadLike;
}

export interface ComputeQueueItem {
  type: string;
  item: string;
  status?: string;
}

export interface ComputeSource {
  baseId: string;
  baseName: string;
  building: string;
  tflops: number;
  tops: number;
  researchAccel?: number;
  researchLines?: readonly string[];
}

export interface ComputeUsageRow {
  item: string;
  tflops: number;
  tops: number;
  /** 在研但 catalog 无 workload 声明（动态/EVA 研究等），数量单列不静默 */
  declared: boolean;
}

export interface ComputeOverview {
  /** 名义总算力 */
  tflops: number;
  tops: number;
  /** 在研名义占用合计 */
  usedTflops: number;
  usedTops: number;
  /** 名义富余＝总额−占用（可为负＝缺口） */
  freeTflops: number;
  freeTops: number;
  deficit: boolean;
  sources: ComputeSource[];
  usage: ComputeUsageRow[];
  /** 未声明 workload 的在研项数（供 UI 提示「估算不全」） */
  undeclaredCount: number;
}

/** catalog 建筑名匹配：精确命中优先；否则双向 includes 且唯一命中才认（对齐 anchor 先例但收敛误命中） */
function matchCatalogBuilding(name: string, catalog: ReadonlyArray<ComputeCatalogBuilding>): ComputeCatalogBuilding | undefined {
  const exact = catalog.find(c => (c.name ?? c.id) === name || c.id === name);
  if (exact) return exact;
  const hits = catalog.filter(c => {
    const cn = c.name ?? c.id;
    return name.includes(cn) || cn.includes(name);
  });
  return hits.length === 1 ? hits[0] : undefined;
}

/** 非运转建筑状态与研究槽/协议锚点同源（G3-10） */
const INACTIVE_COMPUTE_BUILDING_STATES = INACTIVE_RESEARCH_BUILDING_STATES;

/** 供给侧：在役基地已建成建筑的 compute（及非标科研加速设施）汇总 */
export function aggregateCompute(
  bases: ReadonlyArray<ComputeBaseLike>,
  catalogBuildings: ReadonlyArray<ComputeCatalogBuilding>,
): ComputeSource[] {
  const sources: ComputeSource[] = [];
  for (const base of bases) {
    if (base.status === '废弃' || base.status === '失守') continue;
    for (const b of base.buildings ?? []) {
      const st = (b.state ?? '运转').trim();
      if (st !== '运转' && INACTIVE_COMPUTE_BUILDING_STATES.has(st)) continue;
      const entry = matchCatalogBuilding(b.name, catalogBuildings);
      const directCompute = b.compute;
      const catCompute = entry?.outputs?.virtual?.compute;
      const rawTflops =
        typeof directCompute?.tflops === 'number' && Number.isFinite(directCompute.tflops) && directCompute.tflops > 0
          ? directCompute.tflops
          : (catCompute?.tflops ?? 0);
      const rawTops =
        typeof directCompute?.tops === 'number' && Number.isFinite(directCompute.tops) && directCompute.tops > 0
          ? directCompute.tops
          : (catCompute?.tops ?? 0);
      const tflops = Math.max(0, rawTflops);
      const tops = Math.max(0, rawTops);
      const rawAccel =
        typeof b.research_accel === 'number' && Number.isFinite(b.research_accel) && b.research_accel > 0
          ? b.research_accel
          : typeof entry?.research_accel === 'number' && Number.isFinite(entry.research_accel) && entry.research_accel > 0
            ? entry.research_accel
            : 0;
      const researchLines =
        Array.isArray(b.research_lines) && b.research_lines.length > 0
          ? b.research_lines
          : entry?.research_lines;
      if (tflops === 0 && tops === 0 && rawAccel <= 0) continue;
      sources.push({
        baseId: base.id ?? '',
        baseName: base.name ?? '',
        building: b.name,
        tflops,
        tops,
        ...(rawAccel > 0 ? { researchAccel: Math.min(0.35, rawAccel) } : {}),
        ...(researchLines && researchLines.length > 0 ? { researchLines } : {}),
      });
    }
  }
  return sources;
}

function inferFallbackResearchCompute(r: ComputeCatalogResearch | undefined): { tflops: number; tops: number } | null {
  if (!r) return null;
  const wl = r.workload;
  if ((wl?.tflops ?? 0) > 0 || (wl?.tops ?? 0) > 0) {
    return { tflops: wl?.tflops ?? 0, tops: wl?.tops ?? 0 };
  }
  const hasCatalogMeta =
    (typeof r.cost === 'number' && r.cost > 0) ||
    (typeof r.tier === 'number' && r.tier > 0) ||
    (typeof r.line === 'string' && r.line.trim().length > 0) ||
    (typeof wl?.days === 'number' && wl.days > 0);
  if (!hasCatalogMeta) return null;
  return inferDefaultResearchComputeWorkload(r.cost, r.tier, r.line, r.name);
}

/** 消耗侧：在研研究项的 workload 汇总；未声明 workload 者计 0 但计入 undeclared */
export function computeUsage(
  queues: ReadonlyArray<ComputeQueueItem>,
  catalogResearches: ReadonlyArray<ComputeCatalogResearch>,
): ComputeUsageRow[] {
  const byName = new Map(catalogResearches.map(r => [r.name, r]));
  const rows: ComputeUsageRow[] = [];
  for (const q of queues) {
    if (q.type !== '研究') continue;
    if (q.status === 'queued') continue;
    const r = byName.get(q.item);
    const comp = inferFallbackResearchCompute(r);
    rows.push({
      item: q.item,
      tflops: comp?.tflops ?? 0,
      tops: comp?.tops ?? 0,
      declared: comp !== null && (comp.tflops > 0 || comp.tops > 0),
    });
  }
  return rows;
}

/** 总览组装：供给 + 消耗 + 缺口派生 */
export function computeOverview(
  bases: ReadonlyArray<ComputeBaseLike>,
  queues: ReadonlyArray<ComputeQueueItem>,
  catalogBuildings: ReadonlyArray<ComputeCatalogBuilding>,
  catalogResearches: ReadonlyArray<ComputeCatalogResearch>,
): ComputeOverview {
  const sources = aggregateCompute(bases, catalogBuildings);
  const usage = computeUsage(queues, catalogResearches);
  const tflops = sources.reduce((s, x) => s + x.tflops, 0);
  const tops = sources.reduce((s, x) => s + x.tops, 0);
  const usedTflops = usage.reduce((s, x) => s + x.tflops, 0);
  const usedTops = usage.reduce((s, x) => s + x.tops, 0);
  const freeTflops = tflops - usedTflops;
  const freeTops = tops - usedTops;
  return {
    tflops,
    tops,
    usedTflops,
    usedTops,
    freeTflops,
    freeTops,
    deficit: freeTflops < 0 || freeTops < 0,
    sources,
    usage,
    undeclaredCount: usage.filter(u => !u.declared).length,
  };
}
