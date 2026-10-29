/**
 * perfMonitor.ts —— 中控悬浮窗运行时性能监测与遥测探针（CTRL-PERF-MONITOR-01）
 *
 * 职责：
 * 1. 管线阶段耗时采集（Pipeline Spans）：记录楼层解析、快照刷新、目录合并、卡片水合、样式同步等关键路径的
 *    最新耗时（lastMs）、均值（avgMs）、峰值（maxMs）、调用次数（count）及缓存命中率（hits / misses / skipped）。
 * 2. 帧率（FPS）与主线程长任务（Long Tasks > 50ms，对齐 ST-D2 / motion:m4-longtask）采样：
 *    仅在监测面板激活或显式开启持续采样时挂载 requestAnimationFrame / PerformanceObserver，面板关闭时自动休眠实现后台 0 开销。
 * 3. 跨帧 DOM 拓扑与 JS 堆内存盘点：统计主控 iframe、全屏弹窗伴生 iframe、战术 HUD 伴生 iframe 及宿主楼层卡片的 DOM 节点规模。
 * 4. 一键管线基准自检（Benchmark）：对目录合并缓存、建筑系统模型、甘特排程模型、标签分类正则缓存执行即时微基准测试并给出健康度评级。
 *
 * 铁律：纯只读遥测与内存态统计，严禁触碰任何 MVU 楼层变量写入或世界书写入 API。
 */

import { reactive } from 'vue';
import { getHostDocument, getHostWindow } from '../host/modalHost';
import { effectiveCatalogSnapshot } from '../../红警指挥系统/composables/useCatalog';
import { buildBuildingOverviewModel } from './buildingSystemModel';
import { schedulePanelModel } from './schedulePanelModel';
import { domainsOfBuilding } from './tagTaxonomy';

export type PerfMetricId =
  | 'floor.parseAndRefresh'
  | 'catalog.merge'
  | 'card.hydrate'
  | 'modal.styleSync'
  | 'model.buildingSystem'
  | 'model.schedulePanel'
  | 'model.tagDomains';

export interface PerfMetricStat {
  id: PerfMetricId;
  label: string;
  budgetMs: number;
  count: number;
  totalMs: number;
  lastMs: number;
  avgMs: number;
  maxMs: number;
  minMs: number;
  cacheHits: number;
  cacheMisses: number;
  skippedCount: number;
  lastUpdatedAt: number | null;
  recentSamples: number[];
}

export interface PerfEventLogItem {
  seq: number;
  timestamp: number;
  metricId: PerfMetricId | 'longtask' | 'benchmark';
  label: string;
  durationMs: number;
  detail?: string;
  overBudget: boolean;
}

export interface DomTopologySnapshot {
  sampledAt: number;
  consoleIframeNodes: number;
  modalOverlayNodes: number;
  modalOverlayVisible: boolean;
  hudHostNodes: number;
  hostFloorCardMounts: number;
  hostFloorCardIframes: number;
  hostHydratedCards: number;
  totalTrackedNodes: number;
}

export interface MemorySnapshot {
  supported: boolean;
  usedMB: number;
  totalMB: number;
  limitMB: number;
  usagePct: number;
}

export interface BenchmarkStepResult {
  id: string;
  label: string;
  coldMs: number;
  warmMs: number;
  speedupRatio: number;
  budgetMs: number;
  passed: boolean;
  note: string;
}

export interface BenchmarkReport {
  ranAt: number;
  totalMs: number;
  grade: 'S' | 'A' | 'B' | 'C';
  steps: BenchmarkStepResult[];
}

export interface PerfMonitorState {
  enabled: boolean;
  fpsSampling: boolean;
  currentFps: number;
  avgFrameTimeMs: number;
  droppedFrames: number;
  longTaskCount: number;
  maxLongTaskMs: number;
  metrics: Record<PerfMetricId, PerfMetricStat>;
  recentEvents: PerfEventLogItem[];
  domTopology: DomTopologySnapshot;
  memory: MemorySnapshot;
  lastBenchmark: BenchmarkReport | null;
}

const MAX_RECENT_SAMPLES = 30;
const MAX_RECENT_EVENTS = 40;
const LONGTASK_THRESHOLD_MS = 50;

const METRIC_DEFS: ReadonlyArray<{ id: PerfMetricId; label: string; budgetMs: number }> = [
  { id: 'floor.parseAndRefresh', label: '楼层解析与快照刷新 (parseAndRefresh)', budgetMs: 35 },
  { id: 'catalog.merge', label: '动态目录与 DLC 合并 (effectiveCatalog)', budgetMs: 8 },
  { id: 'card.hydrate', label: '楼层内嵌卡片水合挂载 (hydrateFloorCards)', budgetMs: 16 },
  { id: 'modal.styleSync', label: '跨帧弹窗样式表同步 (syncStylesToOverlay)', budgetMs: 12 },
  { id: 'model.buildingSystem', label: '建筑体系四层模型计算 (buildingSystemModel)', budgetMs: 10 },
  { id: 'model.schedulePanel', label: '甘特排程与工位产能模型 (schedulePanelModel)', budgetMs: 10 },
  { id: 'model.tagDomains', label: '建筑领域正则分类 (domainsOfBuilding)', budgetMs: 4 },
];

function createInitialMetricStat(def: { id: PerfMetricId; label: string; budgetMs: number }): PerfMetricStat {
  return {
    id: def.id,
    label: def.label,
    budgetMs: def.budgetMs,
    count: 0,
    totalMs: 0,
    lastMs: 0,
    avgMs: 0,
    maxMs: 0,
    minMs: 0,
    cacheHits: 0,
    cacheMisses: 0,
    skippedCount: 0,
    lastUpdatedAt: null,
    recentSamples: [],
  };
}

function createInitialMetricsMap(): Record<PerfMetricId, PerfMetricStat> {
  const out = {} as Record<PerfMetricId, PerfMetricStat>;
  for (const def of METRIC_DEFS) {
    out[def.id] = createInitialMetricStat(def);
  }
  return out;
}

function createInitialDomTopology(): DomTopologySnapshot {
  return {
    sampledAt: 0,
    consoleIframeNodes: 0,
    modalOverlayNodes: 0,
    modalOverlayVisible: false,
    hudHostNodes: 0,
    hostFloorCardMounts: 0,
    hostFloorCardIframes: 0,
    hostHydratedCards: 0,
    totalTrackedNodes: 0,
  };
}

function createInitialMemory(): MemorySnapshot {
  return {
    supported: false,
    usedMB: 0,
    totalMB: 0,
    limitMB: 0,
    usagePct: 0,
  };
}

export function nowPerfMs(): number {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch {
    // ignore
  }
  return Date.now();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const perfMonitorState: PerfMonitorState = reactive({
  enabled: true,
  fpsSampling: false,
  currentFps: 60,
  avgFrameTimeMs: 16.67,
  droppedFrames: 0,
  longTaskCount: 0,
  maxLongTaskMs: 0,
  metrics: createInitialMetricsMap(),
  recentEvents: [],
  domTopology: createInitialDomTopology(),
  memory: createInitialMemory(),
  lastBenchmark: null,
});

let eventSeq = 0;

function pushEventLog(item: Omit<PerfEventLogItem, 'seq' | 'timestamp'>): void {
  eventSeq += 1;
  perfMonitorState.recentEvents.unshift({
    seq: eventSeq,
    timestamp: Date.now(),
    ...item,
  });
  if (perfMonitorState.recentEvents.length > MAX_RECENT_EVENTS) {
    perfMonitorState.recentEvents.length = MAX_RECENT_EVENTS;
  }
}

/**
 * 记录一次管线指标耗时样本
 */
export function recordPerfSample(
  id: PerfMetricId,
  durationMs: number,
  options?: {
    cacheHit?: boolean;
    skipped?: boolean;
    detail?: string;
    silentLog?: boolean;
  },
): void {
  if (!perfMonitorState.enabled) return;
  const stat = perfMonitorState.metrics[id];
  if (!stat) return;

  const safeMs = Math.max(0, round2(durationMs));
  if (options?.skipped) {
    stat.skippedCount += 1;
    stat.lastUpdatedAt = Date.now();
    return;
  }
  if (options?.cacheHit === true) {
    stat.cacheHits += 1;
  } else if (options?.cacheHit === false) {
    stat.cacheMisses += 1;
  }

  stat.count += 1;
  stat.totalMs = round2(stat.totalMs + safeMs);
  stat.lastMs = safeMs;
  stat.avgMs = round2(stat.totalMs / stat.count);
  stat.maxMs = stat.count === 1 ? safeMs : Math.max(stat.maxMs, safeMs);
  stat.minMs = stat.count === 1 ? safeMs : Math.min(stat.minMs, safeMs);
  stat.lastUpdatedAt = Date.now();

  stat.recentSamples.push(safeMs);
  if (stat.recentSamples.length > MAX_RECENT_SAMPLES) {
    stat.recentSamples.shift();
  }

  const overBudget = safeMs > stat.budgetMs;
  if (!options?.silentLog && (overBudget || options?.cacheHit !== true)) {
    pushEventLog({
      metricId: id,
      label: stat.label,
      durationMs: safeMs,
      detail: options?.detail,
      overBudget,
    });
  }
}

/**
 * 同步函数包装计时器
 */
export function measurePerfSync<T>(
  id: PerfMetricId,
  fn: () => T,
  options?: { detail?: string; silentLog?: boolean },
): T {
  if (!perfMonitorState.enabled) return fn();
  const t0 = nowPerfMs();
  try {
    return fn();
  } finally {
    const dt = nowPerfMs() - t0;
    recordPerfSample(id, dt, options);
  }
}

/**
 * 异步函数包装计时器
 */
export async function measurePerfAsync<T>(
  id: PerfMetricId,
  fn: () => Promise<T>,
  options?: { detail?: string; silentLog?: boolean },
): Promise<T> {
  if (!perfMonitorState.enabled) return fn();
  const t0 = nowPerfMs();
  try {
    return await fn();
  } finally {
    const dt = nowPerfMs() - t0;
    recordPerfSample(id, dt, options);
  }
}

/**
 * 记录一次长任务（> 50ms）
 */
export function recordLongTaskSample(durationMs: number, detail = '主线程长任务阻塞'): void {
  if (!perfMonitorState.enabled) return;
  const safeMs = round2(Math.max(0, durationMs));
  if (safeMs < LONGTASK_THRESHOLD_MS) return;
  perfMonitorState.longTaskCount += 1;
  perfMonitorState.maxLongTaskMs = Math.max(perfMonitorState.maxLongTaskMs, safeMs);
  pushEventLog({
    metricId: 'longtask',
    label: '主线程 LongTask (>50ms)',
    durationMs: safeMs,
    detail,
    overBudget: true,
  });
}

function countDomNodesSafe(root: Document | Element | null | undefined): number {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  try {
    return root.querySelectorAll('*').length;
  } catch {
    return 0;
  }
}

/**
 * 采集跨帧 DOM 拓扑与楼层卡片水合实况
 */
export function sampleDomTopology(customHostDoc?: Document | null): DomTopologySnapshot {
  const localDoc = typeof document !== 'undefined' ? document : null;
  const hostDoc = customHostDoc !== undefined ? customHostDoc : getHostDocument();

  const consoleIframeNodes = countDomNodesSafe(localDoc);

  let modalOverlayNodes = 0;
  let modalOverlayVisible = false;
  let hudHostNodes = 0;
  let hostFloorCardMounts = 0;
  let hostFloorCardIframes = 0;
  let hostHydratedCards = 0;

  if (hostDoc && typeof hostDoc.getElementById === 'function') {
    try {
      const overlayIframe = hostDoc.getElementById('tavernweave-tactical-modal-overlay') as HTMLIFrameElement | null;
      if (overlayIframe) {
        modalOverlayVisible = overlayIframe.style?.display !== 'none';
        modalOverlayNodes = countDomNodesSafe(overlayIframe.contentDocument);
      }
      const hudIframe = hostDoc.getElementById('tavernweave-hud-host') as HTMLIFrameElement | null;
      if (hudIframe) {
        hudHostNodes = countDomNodesSafe(hudIframe.contentDocument);
      }
      if (typeof hostDoc.querySelectorAll === 'function') {
        hostFloorCardMounts = hostDoc.querySelectorAll('.tw-floor-card-mount').length;
        hostFloorCardIframes = hostDoc.querySelectorAll('iframe.tw-floor-card').length;
        hostHydratedCards = hostDoc.querySelectorAll('[data-tw-hydrated="true"]').length;
      }
    } catch {
      // 忽略跨域或轻量桩异常
    }
  }

  const totalTrackedNodes = consoleIframeNodes + modalOverlayNodes + hudHostNodes + hostFloorCardMounts;
  const snap: DomTopologySnapshot = {
    sampledAt: Date.now(),
    consoleIframeNodes,
    modalOverlayNodes,
    modalOverlayVisible,
    hudHostNodes,
    hostFloorCardMounts,
    hostFloorCardIframes,
    hostHydratedCards,
    totalTrackedNodes,
  };
  perfMonitorState.domTopology = snap;
  return snap;
}

/**
 * 采集 JS 堆内存占用快照（Chromium performance.memory，不支持时安全降级）
 */
export function sampleMemoryUsage(customPerf?: unknown): MemorySnapshot {
  const perfObj = (customPerf ?? (typeof performance !== 'undefined' ? performance : null)) as {
    memory?: {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
      jsHeapSizeLimit?: number;
    };
  } | null;

  const mem = perfObj?.memory;
  if (!mem || typeof mem.usedJSHeapSize !== 'number') {
    const fallback: MemorySnapshot = {
      supported: false,
      usedMB: 0,
      totalMB: 0,
      limitMB: 0,
      usagePct: 0,
    };
    perfMonitorState.memory = fallback;
    return fallback;
  }

  const usedMB = round2(mem.usedJSHeapSize / (1024 * 1024));
  const totalMB = round2((mem.totalJSHeapSize ?? mem.usedJSHeapSize) / (1024 * 1024));
  const limitMB = round2((mem.jsHeapSizeLimit ?? mem.totalJSHeapSize ?? mem.usedJSHeapSize) / (1024 * 1024));
  const usagePct = limitMB > 0 ? round2((usedMB / limitMB) * 100) : 0;

  const snap: MemorySnapshot = {
    supported: true,
    usedMB,
    totalMB,
    limitMB,
    usagePct,
  };
  perfMonitorState.memory = snap;
  return snap;
}

/* ═══════════════ 实时 FPS 与 LongTask 探针生命周期（面板打开时激活，关闭时零开销休眠） ═══════════════ */

let rafHandle: number | null = null;
let lastFrameTs = 0;
let frameCountInWindow = 0;
let windowStartTs = 0;
let longTaskObserver: { disconnect: () => void } | null = null;

export function startRealtimePerfSampling(): void {
  if (perfMonitorState.fpsSampling) return;
  perfMonitorState.fpsSampling = true;

  const win = getHostWindow() ?? (typeof window !== 'undefined' ? window : null);
  if (win && typeof win.requestAnimationFrame === 'function') {
    lastFrameTs = nowPerfMs();
    windowStartTs = lastFrameTs;
    frameCountInWindow = 0;

    const tick = (ts: number) => {
      if (!perfMonitorState.fpsSampling) return;
      const dt = ts - lastFrameTs;
      lastFrameTs = ts;
      frameCountInWindow += 1;

      if (dt > 33.4) {
        perfMonitorState.droppedFrames += 1;
      }

      const elapsed = ts - windowStartTs;
      if (elapsed >= 500) {
        const fps = Math.min(120, Math.max(1, Math.round((frameCountInWindow * 1000) / elapsed)));
        perfMonitorState.currentFps = fps;
        perfMonitorState.avgFrameTimeMs = round2(elapsed / Math.max(1, frameCountInWindow));
        frameCountInWindow = 0;
        windowStartTs = ts;
      }

      rafHandle = win.requestAnimationFrame(tick);
    };

    rafHandle = win.requestAnimationFrame(tick);
  }

  // 挂载 PerformanceObserver('longtask')
  try {
    const PerfObs = (win as unknown as { PerformanceObserver?: typeof PerformanceObserver })?.PerformanceObserver ??
      (typeof PerformanceObserver !== 'undefined' ? PerformanceObserver : undefined);
    if (PerfObs) {
      const obs = new PerfObs(list => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= LONGTASK_THRESHOLD_MS) {
            recordLongTaskSample(entry.duration, entry.name || 'longtask');
          }
        }
      });
      obs.observe({ entryTypes: ['longtask'] });
      longTaskObserver = obs;
    }
  } catch {
    // 浏览器或测试环境不支持 longtask 时安全忽略
  }
}

export function stopRealtimePerfSampling(): void {
  perfMonitorState.fpsSampling = false;
  const win = getHostWindow() ?? (typeof window !== 'undefined' ? window : null);
  if (rafHandle !== null && win && typeof win.cancelAnimationFrame === 'function') {
    try {
      win.cancelAnimationFrame(rafHandle);
    } catch {
      // ignore
    }
  }
  rafHandle = null;
  if (longTaskObserver) {
    try {
      longTaskObserver.disconnect();
    } catch {
      // ignore
    }
    longTaskObserver = null;
  }
}

/**
 * 计算当前整体性能健康度评级（S / A / B / C）
 */
export function evaluatePerfHealthGrade(): {
  grade: 'S' | 'A' | 'B' | 'C';
  label: string;
  summary: string;
} {
  const m = perfMonitorState.metrics;
  const overBudgetCount = Object.values(m).filter(s => s.count > 0 && s.avgMs > s.budgetMs).length;
  const fps = perfMonitorState.currentFps;
  const longTasks = perfMonitorState.longTaskCount;

  if (overBudgetCount === 0 && fps >= 50 && longTasks <= 1) {
    return {
      grade: 'S',
      label: '战备级流畅 (OPTIMAL)',
      summary: '全链路阶段耗时均在预算阈值内，缓存命中良好，无明显主线程长任务阻塞。',
    };
  }
  if (overBudgetCount <= 1 && fps >= 40 && longTasks <= 5) {
    return {
      grade: 'A',
      label: '运行良好 (NOMINAL)',
      summary: '核心解析与渲染管线稳定，偶发轻微峰值，整体交互响应顺畅。',
    };
  }
  if (overBudgetCount <= 2 && fps >= 25) {
    return {
      grade: 'B',
      label: '负载偏高 (ELEVATED)',
      summary: '部分重型模型或 DOM 水合阶段接近帧预算上限，建议关注长任务与节点数量。',
    };
  }
  return {
    grade: 'C',
    label: '阻塞告警 (CONGESTED)',
    summary: '检测到多项管线超出预算或存在主线程长任务阻塞，请导出遥测报告排查热点。',
  };
}

/**
 * 重置全部性能遥测计数与历史事件
 */
export function resetPerfMonitorStats(): void {
  perfMonitorState.droppedFrames = 0;
  perfMonitorState.longTaskCount = 0;
  perfMonitorState.maxLongTaskMs = 0;
  perfMonitorState.recentEvents.splice(0, perfMonitorState.recentEvents.length);
  for (const def of METRIC_DEFS) {
    perfMonitorState.metrics[def.id] = createInitialMetricStat(def);
  }
  perfMonitorState.lastBenchmark = null;
}

/**
 * 导出结构化 JSON 诊断报告（用于一键复制）
 */
export function exportPerfDiagnosticReport(): string {
  sampleDomTopology();
  sampleMemoryUsage();
  const health = evaluatePerfHealthGrade();
  const payload = {
    exportedAt: new Date().toISOString(),
    health,
    fps: {
      currentFps: perfMonitorState.currentFps,
      avgFrameTimeMs: perfMonitorState.avgFrameTimeMs,
      droppedFrames: perfMonitorState.droppedFrames,
      longTaskCount: perfMonitorState.longTaskCount,
      maxLongTaskMs: perfMonitorState.maxLongTaskMs,
    },
    domTopology: perfMonitorState.domTopology,
    memory: perfMonitorState.memory,
    metrics: Object.values(perfMonitorState.metrics).map(m => ({
      id: m.id,
      label: m.label,
      budgetMs: m.budgetMs,
      count: m.count,
      lastMs: m.lastMs,
      avgMs: m.avgMs,
      maxMs: m.maxMs,
      cacheHits: m.cacheHits,
      cacheMisses: m.cacheMisses,
      skippedCount: m.skippedCount,
    })),
    lastBenchmark: perfMonitorState.lastBenchmark,
    recentEvents: perfMonitorState.recentEvents.slice(0, 15),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * 一键执行中控悬浮窗全链路微基准自检（Benchmark）
 *
 * 实测：
 * 1. 动态目录与 DLC 合并（冷路径 vs 记忆化热路径）
 * 2. 建筑体系四层模型（buildingSystemModel）
 * 3. 甘特排程与工位产能模型（schedulePanelModel）
 * 4. 建筑领域正则分类缓存（domainsOfBuilding 冷路径 vs 热路径）
 */
export async function runPerfPipelineBenchmark(snapshot?: Record<string, unknown> | null): Promise<BenchmarkReport> {
  const startAll = nowPerfMs();
  const steps: BenchmarkStepResult[] = [];

  // Step 1: effectiveCatalogSnapshot
  const tCat0 = nowPerfMs();
  const catalog = effectiveCatalogSnapshot();
  const catColdMs = Math.max(0.01, round2(nowPerfMs() - tCat0));

  const tCat1 = nowPerfMs();
  for (let i = 0; i < 10; i++) {
    effectiveCatalogSnapshot();
  }
  const catWarmMs = Math.max(0.01, round2((nowPerfMs() - tCat1) / 10));
  recordPerfSample('catalog.merge', catWarmMs, { cacheHit: true, detail: '基准自检热命中' });

  steps.push({
    id: 'catalog.merge',
    label: '动态目录与 DLC 合并 (effectiveCatalog)',
    coldMs: catColdMs,
    warmMs: catWarmMs,
    speedupRatio: round2(catColdMs / Math.max(0.01, catWarmMs)),
    budgetMs: 8,
    passed: catWarmMs <= 8,
    note: `共 ${catalog.buildings.length} 建筑 / ${catalog.productions.length} 单位 / ${catalog.researches.length} 科技`,
  });

  // Step 2: buildBuildingOverviewModel
  const snapInput = (snapshot ?? {}) as never;
  const tBld0 = nowPerfMs();
  const bldVm = buildBuildingOverviewModel(snapInput, catalog);
  const bldColdMs = Math.max(0.01, round2(nowPerfMs() - tBld0));

  const tBld1 = nowPerfMs();
  buildBuildingOverviewModel(snapInput, catalog);
  const bldWarmMs = Math.max(0.01, round2(nowPerfMs() - tBld1));
  recordPerfSample('model.buildingSystem', bldWarmMs, { detail: '基准自检建筑模型' });

  steps.push({
    id: 'model.buildingSystem',
    label: '建筑体系四层模型 (buildingSystemModel)',
    coldMs: bldColdMs,
    warmMs: bldWarmMs,
    speedupRatio: round2(bldColdMs / Math.max(0.01, bldWarmMs)),
    budgetMs: 10,
    passed: bldWarmMs <= 10,
    note: `${bldVm.systems.length} 大系统分组 · 在建/现役设施实时聚合`,
  });

  // Step 3: schedulePanelModel
  const tSch0 = nowPerfMs();
  const schVm = schedulePanelModel(snapInput, catalog);
  const schColdMs = Math.max(0.01, round2(nowPerfMs() - tSch0));

  const tSch1 = nowPerfMs();
  schedulePanelModel(snapInput, catalog);
  const schWarmMs = Math.max(0.01, round2(nowPerfMs() - tSch1));
  recordPerfSample('model.schedulePanel', schWarmMs, { detail: '基准自检甘特排程模型' });

  steps.push({
    id: 'model.schedulePanel',
    label: '甘特排程与工位产能 (schedulePanelModel)',
    coldMs: schColdMs,
    warmMs: schWarmMs,
    speedupRatio: round2(schColdMs / Math.max(0.01, schWarmMs)),
    budgetMs: 10,
    passed: schWarmMs <= 10,
    note: `${schVm.bases.length} 基地 · ${schVm.researchSlots.length} 科研槽`,
  });

  // Step 4: domainsOfBuilding
  const sampleBuildings = catalog.buildings.slice(0, 40);
  const tDom0 = nowPerfMs();
  for (const b of sampleBuildings) {
    domainsOfBuilding({ name: b.name, desc: b.desc, tags: b.tags });
  }
  const domColdMs = Math.max(0.01, round2(nowPerfMs() - tDom0));

  const tDom1 = nowPerfMs();
  for (const b of sampleBuildings) {
    domainsOfBuilding({ name: b.name, desc: b.desc, tags: b.tags });
  }
  const domWarmMs = Math.max(0.01, round2(nowPerfMs() - tDom1));
  recordPerfSample('model.tagDomains', domWarmMs, { cacheHit: true, detail: '基准自检领域分类缓存' });

  steps.push({
    id: 'model.tagDomains',
    label: '建筑领域正则分类缓存 (40 项连测)',
    coldMs: domColdMs,
    warmMs: domWarmMs,
    speedupRatio: round2(domColdMs / Math.max(0.01, domWarmMs)),
    budgetMs: 4,
    passed: domWarmMs <= 4,
    note: `40 项建筑 25+ 正则匹配与 Map 缓存命中`,
  });

  const totalMs = round2(nowPerfMs() - startAll);
  const failedSteps = steps.filter(s => !s.passed).length;
  const grade: 'S' | 'A' | 'B' | 'C' =
    failedSteps === 0 && totalMs <= 25 ? 'S' : failedSteps === 0 ? 'A' : failedSteps === 1 ? 'B' : 'C';

  const report: BenchmarkReport = {
    ranAt: Date.now(),
    totalMs,
    grade,
    steps,
  };
  perfMonitorState.lastBenchmark = report;

  pushEventLog({
    metricId: 'benchmark',
    label: `全链路基准自检完成 (评级 ${grade})`,
    durationMs: totalMs,
    detail: steps.map(s => `${s.id}:${s.warmMs}ms`).join(' | '),
    overBudget: failedSteps > 0,
  });

  sampleDomTopology();
  sampleMemoryUsage();
  return report;
}
