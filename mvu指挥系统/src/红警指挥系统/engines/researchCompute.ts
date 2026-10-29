/*
 * researchCompute：科研算力聚合（纯函数，零 store / 零解析协议）
 *
 * 口径（20 号裁决·静态口径）：
 * 1. 供给＝所有在役（status!=='废弃'）基地中、已建成（state!=='建造中'）建筑的
 *    outputs.virtual.compute（tflops/tops）逐建筑汇总；停机/受损建筑仍计入供给
 *    （供给面按名义容量口径，工况惩罚属实时引擎心事，不在此模块推算）；
 * 2. 消耗＝在研（type==='研究' && status!=='queued'）队列项在 catalog 中的 workload；
 * 3. 建筑/研究名匹配：先精确，再收窄 includes（唯一命中才认，防止「超算中心」误中「量子超算中心」）；
 * 4. 缺口仅展示，不拦截；无算力建筑时 sources 为空，由 UI 降级提示。
 *
 * 裁决基线：不含 C1–C5 ×1.7 加速折算（那是运行引擎的事，面板只报静态名义值）。
 */

export interface ComputeBuildingLike {
  name: string;
  /** 在场口径与 researchSlots.anchorPresent 对齐：建造中不计入 */
  state?: string;
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
  outputs?: { virtual?: { compute?: { tflops?: number; tops?: number } } };
}

export interface WorkloadLike {
  tflops?: number;
  tops?: number;
}

export interface ComputeCatalogResearch {
  name: string;
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

/** 供给侧：在役基地已建成建筑的 compute 汇总 */
export function aggregateCompute(
  bases: ReadonlyArray<ComputeBaseLike>,
  catalogBuildings: ReadonlyArray<ComputeCatalogBuilding>,
): ComputeSource[] {
  const sources: ComputeSource[] = [];
  for (const base of bases) {
    if (base.status === '废弃' || base.status === '失守') continue;
    for (const b of base.buildings ?? []) {
      if ((b.state ?? '运转') !== '运转') continue;
      const entry = matchCatalogBuilding(b.name, catalogBuildings);
      const compute = entry?.outputs?.virtual?.compute;
      if (!compute) continue;
      const tflops = compute.tflops ?? 0;
      const tops = compute.tops ?? 0;
      if (tflops === 0 && tops === 0) continue;
      sources.push({
        baseId: base.id ?? '',
        baseName: base.name ?? '',
        building: b.name,
        tflops,
        tops,
      });
    }
  }
  return sources;
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
    const wl = r?.workload;
    rows.push({
      item: q.item,
      tflops: wl?.tflops ?? 0,
      tops: wl?.tops ?? 0,
      declared: wl !== undefined && ((wl.tflops ?? 0) > 0 || (wl.tops ?? 0) > 0),
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
