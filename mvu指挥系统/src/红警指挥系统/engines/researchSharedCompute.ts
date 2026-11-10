/** G3-04：唯一科研供给账本、分轨比例分配与有限事件推进；不依赖宿主或持久化 schema。 */
import type { SettleEvent, SettleOptions, TransactionItem } from './transactionEngine';
import type { ComputeBudget, TwoStageSpec } from './twoStageAssemblyEngine';

export interface ResearchComputeContext {
  byBase: ReadonlyMap<string, ComputeBudget>;
  /** 只解析明确绑定；无法解析返回 undefined，绝不转为战区项目。 */
  baseKeyFor: (reference: string) => string | undefined;
}
interface ResearchAdvanceOptions extends SettleOptions {
  compute: ResearchComputeContext;
  specFor: (txn: TransactionItem) => TwoStageSpec | undefined;
  phaseEndFor: (txn: TransactionItem) => number;
  rateFor: (txn: TransactionItem, budget: ComputeBudget) => number;
  onPromoted?: (txn: TransactionItem, integrates: boolean) => void;
  promoteAfterIntegration?: boolean;
}
const ZERO: ComputeBudget = { tflops: 0, tops: 0 };
const positive = (n: number | undefined) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0;

/** 同时提高满足度；受本基地供给约束的组冻结，其余继续，未引入本地优先。 */
function allocateTrack(
  consumers: readonly TransactionItem[],
  track: keyof ComputeBudget,
  options: ResearchAdvanceOptions,
): number[] {
  const demands = consumers.map(q => positive(options.specFor(q)?.[track]));
  const groups = consumers.map(q => q.base ? (options.compute.baseKeyFor(q.base) ?? '\u0000unresolved') : undefined);
  const localDemand = new Map<string, number>();
  consumers.forEach((_, i) => {
    const key = groups[i];
    if (key !== undefined) localDemand.set(key, (localDemand.get(key) ?? 0) + demands[i]);
  });
  let supply = [...options.compute.byBase.values()].reduce((s, b) => s + positive(b[track]), 0);
  let demand = demands.reduce((s, d) => s + d, 0);
  const frozen = new Map<string, number>();
  let ratio = 1;
  while (demand > 0) {
    ratio = Math.min(1, supply / demand);
    let constrained = false;
    for (const [key, amount] of localDemand) {
      if (frozen.has(key) || amount <= 0) continue;
      const capacity = positive(options.compute.byBase.get(key)?.[track]);
      if (capacity < amount * ratio) {
        frozen.set(key, capacity / amount);
        supply = Math.max(0, supply - capacity);
        demand -= amount;
        constrained = true;
      }
    }
    if (!constrained) break;
  }
  return demands.map((d, i) => d * (groups[i] === undefined ? ratio : (frozen.get(groups[i]!) ?? ratio)));
}

/**
 * 输入已执行调度命令的研究队列。先裁定运行权，再同步推进到下一阶段/完成事件；
 * 仅同 lane、数组后续候列可接棒，普通尾部升格不吃本次墙钟。
 */
export function advanceResearchBatch(
  input: readonly TransactionItem[],
  deltaMinutes: number,
  options: ResearchAdvanceOptions,
): { queues: TransactionItem[]; events: SettleEvent[] } {
  const queues = input.map(q => ({ ...q }));
  const events: SettleEvent[] = [];
  const laneFor = options.laneKeyFor ?? (q => `${q.base}\u0000${q.type}`);
  const limitFor = options.parallelLimitFor ?? (() => 1);
  const globalLimit = options.globalLimitFor?.('研究') ?? Infinity;
  const running = new Set<number>();
  const demoted = new Set<number>();
  const laneCounts = new Map<string, number>();
  const emit = (type: SettleEvent['type'], q: TransactionItem, detail: string) => events.push({ type, item: q.item, base: q.base, detail });
  const hasRoom = (q: TransactionItem) => running.size < globalLimit && (laneCounts.get(laneFor(q)) ?? 0) < Math.max(0, limitFor(q));
  const occupy = (i: number) => {
    running.add(i);
    const q = queues[i];
    laneCounts.set(laneFor(q), (laneCounts.get(laneFor(q)) ?? 0) + 1);
    if (options.now && !q.started_at) q.started_at = options.now;
  };
  const promote = (i: number, integrates = false) => {
    const q = queues[i];
    q.status = 'active';
    occupy(i);
    options.onPromoted?.(q, integrates);
    emit('promoted', q, '科研带宽空位升格 active');
  };
  queues.forEach((q, i) => {
    if (q.status !== 'active') return;
    if (hasRoom(q)) occupy(i);
    else {
      q.status = 'queued';
      demoted.add(i);
      emit('demoted', q, 'active 回检降格 queued（进度保留，gate_recheck）');
    }
  });
  const promoteIdle = () => queues.forEach((q, i) => {
    if (q.status === 'queued' && !q.hold && hasRoom(q)) promote(i);
  });
  let remaining = positive(deltaMinutes);
  for (const i of running) {
    if (queues[i].total_minutes <= 0 && remaining > 0) emit('unknown_duration', queues[i], '未知科研工期，进度不推进');
  }
  // 每轮至少耗尽墙钟或跨过一个阶段/完成；每个队列实例最多经历两个此类事件。
  for (let event = 0; remaining > 0 && event <= queues.length * 2; event++) {
    const active = [...running].filter(i => queues[i].total_minutes > 0);
    if (active.length === 0) break;
    const consumers = active.filter(i => queues[i].spent_minutes >= options.phaseEndFor(queues[i]) && options.rateFor(queues[i], ZERO) > 0);
    const consumerQueues = consumers.map(i => queues[i]);
    const f = allocateTrack(consumerQueues, 'tflops', options);
    const t = allocateTrack(consumerQueues, 'tops', options);
    const budgets = new Map(consumers.map((i, n) => [i, { tflops: f[n], tops: t[n] }]));
    const rates = new Map(active.map(i => [i, positive(options.rateFor(queues[i], budgets.get(i) ?? ZERO))]));
    const boundaries = new Map(active.map(i => {
      const q = queues[i];
      const phaseEnd = options.phaseEndFor(q);
      return [i, q.spent_minutes < phaseEnd ? Math.min(phaseEnd, q.total_minutes) : q.total_minutes];
    }));
    let step = remaining;
    for (const i of active) {
      const rate = rates.get(i)!;
      if (rate > 0) step = Math.min(step, Math.max(0, boundaries.get(i)! - queues[i].spent_minutes) / rate);
    }
    const finished: number[] = [];
    for (const i of active) {
      const q = queues[i];
      const rate = rates.get(i)!;
      const boundary = boundaries.get(i)!;
      const timeToBoundary = rate > 0 ? Math.max(0, boundary - q.spent_minutes) / rate : Infinity;
      q.spent_minutes = timeToBoundary <= step ? Math.max(q.spent_minutes, boundary) : q.spent_minutes + rate * step;
      q.progress = Math.min(100, q.spent_minutes / q.total_minutes * 100);
      if (q.spent_minutes >= q.total_minutes) {
        q.status = 'settling';
        running.delete(i);
        laneCounts.set(laneFor(q), Math.max(0, (laneCounts.get(laneFor(q)) ?? 1) - 1));
        finished.push(i);
        emit('enter_settling', q, '进度满，等待三色对账门裁决（settling→done 归 CTRL-RECONCILE-01）');
      }
    }
    remaining = Math.max(0, remaining - step);
    if (remaining > 0) {
      for (const i of finished) {
        const next = queues.findIndex((q, n) => n > i && q.status === 'queued' && !q.hold && !demoted.has(n) && laneFor(q) === laneFor(queues[i]) && hasRoom(q));
        if (next >= 0) promote(next, true);
      }
    }
  }
  queues.forEach((q, i) => {
    if (q.qty <= 1 || q.total_minutes <= 0 || q.spent_minutes === input[i].spent_minutes) return;
    const done = Math.min(q.qty, Math.floor(q.spent_minutes / (q.total_minutes / q.qty)));
    if (done !== q.qty_done) {
      q.qty_done = done;
      events.push({ type: 'qty_progress', item: q.item, base: q.base, detail: `批次流水 ${done}/${q.qty}`, queueIndex: i });
    }
  });
  if (options.promoteAfterIntegration !== false) promoteIdle();
  return { queues, events };
}
