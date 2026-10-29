/**
 * dataFlowTracer.ts —— 纯内存七阶数据流转追踪与异步飞行记录环形缓冲区（RingBuffer）
 *
 * 职责边界：
 * 1. 常驻内存维护最近 MAX_FLOOR_TRACES (5) 次单楼结算七阶断面（含 S2a..S2i 九大玩法子齿轮）与阶段级 Diff。
 * 2. 常驻内存维护最近 MAX_FLIGHT_LOGS (100) 条跨 await 宿主事件、单飞锁、世界书三重守卫及自动入档回执。
 * 3. 死守 REJ-DBG-PERSIST 红线：严禁向 localStorage、sessionStorage 或酒馆 stat_data / chat.$parse 写入任何追踪数据。
 */
import { reactive } from 'vue';
import { diffStatData, type FieldDiffEntry } from './stateDiffEngine';

export const MAX_FLOOR_TRACES = 5;
export const MAX_FLIGHT_LOGS = 100;
const MAX_PREVIEW_ITEMS = 50;

export type FloorStageId =
  | 'S0_BASELINE'
  | 'S1_PARSE'
  | 'S2_SETTLE'
  | 'S2a_COMMAND'
  | 'S2b_PROTOCOLS'
  | 'S2c_TWO_STAGE'
  | 'S2d_BUILD_COMM'
  | 'S2e_DEPLOY_MODE'
  | 'S2f_CHAINS_GRID'
  | 'S2g_SPACE'
  | 'S2h_DARKNET_ECON'
  | 'S2i_NANITE_STOCK'
  | 'S3_RECONCILE'
  | 'S4_BRIDGES'
  | 'S5_GUARD_RECHECK'
  | 'S6_COMMIT_FEED';

export const STAGE_LABELS: Record<FloorStageId, string> = {
  S0_BASELINE: 'S0 · 基线与身份门',
  S1_PARSE: 'S1 · 标签提取与预解析',
  S2_SETTLE: 'S2 · 九大玩法结算引擎',
  S2a_COMMAND: 'S2a · 联席指挥部与副官结算',
  S2b_PROTOCOLS: 'S2b · 战略协议与实验结算',
  S2c_TWO_STAGE: 'S2c · 调度令与两阶段纳米装配',
  S2d_BUILD_COMM: 'S2d · 建造队列转正与电网并网',
  S2e_DEPLOY_MODE: 'S2e · 产线模式切换与单位展开',
  S2f_CHAINS_GRID: 'S2f · 资金链电网钳制与日收益',
  S2g_SPACE: 'S2g · 天基航天发射与在轨结算',
  S2h_DARKNET_ECON: 'S2h · 被动三渠道并网与暗网拍卖',
  S2i_NANITE_STOCK: 'S2i · 纳米库存实扣与世界演变/民心',
  S3_RECONCILE: 'S3 · 生产对账三色门',
  S4_BRIDGES: 'S4 · 工程与排产后置桥接',
  S5_GUARD_RECHECK: 'S5 · 落盘前双重守卫复核',
  S6_COMMIT_FEED: 'S6 · 变量落盘与参谋前馈',
};

export interface TraceStageRecord {
  stageId: FloorStageId;
  stageLabel: string;
  durationMs: number;
  status: 'ok' | 'warn' | 'blocked' | 'skipped';
  summary: string;
  diffs: FieldDiffEntry[];
  meta?: Record<string, unknown>;
  substages?: TraceStageRecord[];
}

export interface FloorTraceMeta {
  chatId: string | null;
  floorId: number | null;
  swipeId: number | null;
  hash?: string;
  baselineFloorId?: number | null;
  source: 'live' | 'fix' | 'dry_run' | 'chrono';
  rawTagsPreview?: string[];
}

export interface FloorTraceRecord {
  traceId: string;
  startedAt: string;
  totalDurationMs: number;
  outcome: 'ok' | 'skipped' | 'blocked' | 'error';
  meta: FloorTraceMeta;
  stages: TraceStageRecord[];
  totalDiffs: FieldDiffEntry[];
  eventsCount: number;
  issuesCount: number;
  quarantineCount: number;
  eventsPreview: Array<{ level?: string; domain?: string; code?: string; msg: string }>;
  issuesPreview: Array<{ level: string; code: string; message: string }>;
  quarantinePreview: Array<{ blockType: string; reason: string; headerLine?: string }>;
}

export type FlightLogCategory =
  | 'host_event'
  | 'inflight_guard'
  | 'wb_gateway'
  | 'auto_filer'
  | 'faction_wb_sync'
  | 'chrono_action';

export interface AsyncFlightLogEntry {
  id: string;
  ts: string;
  category: FlightLogCategory;
  status: 'ok' | 'blocked' | 'warn' | 'error';
  chatId: string | null;
  floorId: number | null;
  swipeId: number | null;
  title: string;
  detail: string;
  durationMs?: number;
}

export const dataFlowDebugState = reactive<{
  traces: FloorTraceRecord[];
  flightLogs: AsyncFlightLogEntry[];
}>({
  traces: [],
  flightLogs: [],
});

interface ActiveTraceSession {
  startedPerf: number;
  initialBaseline: unknown;
}

const activeTraceSessions = new Map<string, ActiveTraceSession>();
let traceSeq = 0;
let flightSeq = 0;

export function beginFloorTrace(meta: FloorTraceMeta, initialBaseline?: unknown): string {
  traceSeq += 1;
  const traceId = `trace_${Date.now()}_${traceSeq}`;
  activeTraceSessions.set(traceId, {
    startedPerf: performance.now(),
    initialBaseline,
  });

  const record: FloorTraceRecord = {
    traceId,
    startedAt: new Date().toISOString(),
    totalDurationMs: 0,
    outcome: 'ok',
    meta,
    stages: [],
    totalDiffs: [],
    eventsCount: 0,
    issuesCount: 0,
    quarantineCount: 0,
    eventsPreview: [],
    issuesPreview: [],
    quarantinePreview: [],
  };

  dataFlowDebugState.traces.unshift(record);
  while (dataFlowDebugState.traces.length > MAX_FLOOR_TRACES) {
    const evicted = dataFlowDebugState.traces.pop();
    if (evicted) {
      activeTraceSessions.delete(evicted.traceId);
    }
  }

  return traceId;
}

export function buildSubstageRecord(
  stageId: FloorStageId,
  beforeSnap: unknown,
  afterSnap: unknown,
  options?: {
    durationMs?: number;
    status?: 'ok' | 'warn' | 'blocked' | 'skipped';
    summary?: string;
    meta?: Record<string, unknown>;
  },
): TraceStageRecord {
  const diffs =
    beforeSnap !== undefined && afterSnap !== undefined
      ? diffStatData(beforeSnap, afterSnap)
      : [];
  const summary =
    options?.summary ?? (diffs.length > 0 ? `变更 ${diffs.length} 项` : '无状态变更');

  const record: TraceStageRecord = {
    stageId,
    stageLabel: STAGE_LABELS[stageId],
    durationMs: activeTraceSessions.size > 0 ? (options?.durationMs ?? 0) : 0,
    status: options?.status ?? 'ok',
    summary,
    diffs,
  };
  if (options?.meta !== undefined) {
    record.meta = options.meta;
  }
  return record;
}

export function recordTraceStage(
  traceId: string,
  stageId: FloorStageId,
  options?: {
    beforeSnap?: unknown;
    afterSnap?: unknown;
    durationMs?: number;
    status?: 'ok' | 'warn' | 'blocked' | 'skipped';
    summary?: string;
    meta?: Record<string, unknown>;
    substages?: TraceStageRecord[];
  },
): TraceStageRecord | null {
  const trace = dataFlowDebugState.traces.find(item => item.traceId === traceId);
  if (!trace) {
    return null;
  }

  if (stageId === 'S0_BASELINE' && options?.afterSnap !== undefined) {
    const session = activeTraceSessions.get(traceId);
    if (session && session.initialBaseline === undefined) {
      session.initialBaseline = options.afterSnap;
    }
  }

  const stageRecord = buildSubstageRecord(
    stageId,
    options?.beforeSnap,
    options?.afterSnap,
    options,
  );
  if (options?.substages !== undefined) {
    stageRecord.substages = options.substages;
  }

  const existingIndex = trace.stages.findIndex(item => item.stageId === stageId);
  if (existingIndex >= 0) {
    trace.stages[existingIndex] = stageRecord;
  } else {
    trace.stages.push(stageRecord);
  }

  return stageRecord;
}

export function finishFloorTrace(
  traceId: string,
  options?: {
    outcome?: 'ok' | 'skipped' | 'blocked' | 'error';
    finalSnap?: unknown;
    totalDurationMs?: number;
    events?: ReadonlyArray<{ level?: string; domain?: string; code?: string; msg: string }>;
    issues?: ReadonlyArray<{ level: string; code: string; message: string }>;
    quarantine?: ReadonlyArray<{ blockType: string; reason: string; headerLine?: string }>;
  },
): FloorTraceRecord | null {
  const session = activeTraceSessions.get(traceId);
  activeTraceSessions.delete(traceId);

  const trace = dataFlowDebugState.traces.find(item => item.traceId === traceId);
  if (!trace) {
    return null;
  }

  trace.outcome = options?.outcome ?? 'ok';
  if (options?.totalDurationMs !== undefined) {
    trace.totalDurationMs = options.totalDurationMs;
  } else if (session) {
    trace.totalDurationMs = Math.max(
      0,
      Math.round((performance.now() - session.startedPerf) * 100) / 100,
    );
  } else {
    trace.totalDurationMs = trace.stages.reduce((sum, stage) => sum + stage.durationMs, 0);
  }

  if (session?.initialBaseline !== undefined && options?.finalSnap !== undefined) {
    trace.totalDiffs = diffStatData(session.initialBaseline, options.finalSnap);
  } else {
    trace.totalDiffs = trace.stages.flatMap(stage => stage.diffs);
  }

  if (options?.events !== undefined) {
    trace.eventsCount = options.events.length;
    trace.eventsPreview = options.events.slice(0, MAX_PREVIEW_ITEMS);
  }
  if (options?.issues !== undefined) {
    trace.issuesCount = options.issues.length;
    trace.issuesPreview = options.issues.slice(0, MAX_PREVIEW_ITEMS);
  }
  if (options?.quarantine !== undefined) {
    trace.quarantineCount = options.quarantine.length;
    trace.quarantinePreview = options.quarantine.slice(0, MAX_PREVIEW_ITEMS);
  }

  return trace;
}

export function recordFlightLog(
  entry: Omit<AsyncFlightLogEntry, 'id' | 'ts'> & { ts?: string },
): AsyncFlightLogEntry {
  flightSeq += 1;
  const record: AsyncFlightLogEntry = {
    ...entry,
    id: `flight_${Date.now()}_${flightSeq}`,
    ts: entry.ts ?? new Date().toISOString(),
  };

  dataFlowDebugState.flightLogs.unshift(record);
  if (dataFlowDebugState.flightLogs.length > MAX_FLIGHT_LOGS) {
    dataFlowDebugState.flightLogs.length = MAX_FLIGHT_LOGS;
  }

  return record;
}

export function clearDataFlowTraces(): void {
  dataFlowDebugState.traces.splice(0, dataFlowDebugState.traces.length);
  activeTraceSessions.clear();
}

export function clearFlightLogs(): void {
  dataFlowDebugState.flightLogs.splice(0, dataFlowDebugState.flightLogs.length);
}
