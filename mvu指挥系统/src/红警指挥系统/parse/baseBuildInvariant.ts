/**
 * FD-38 · D-BASE-LIFE-01 反向不变量（BASE-INV-01）：建造中建筑 → 建造事务。
 *
 * 前向通道（parsePipeline D-BASE-LIFE-01 / planningSandbox FD-38）只保证：
 * 「建造事务入队 → 基地 buildings 挂 state:'建造中' 占位」。
 * 反向通道缺失，导致 AI 在 <态势> 里直接申报 state:'建造中'（未经 <排产计划>）时，
 * buildings 有占位、queues 里没有任何建造事务 —— 该项目永远不会推进、也永远不会转正，
 * 中控日程面板/甘特图因「只渲染 queues」而整段空白。
 *
 * 本模块只补反向不变量：当且仅当本楼**新出现**（基线无、或基线少于本楼）的
 * state:'建造中' 建筑在该基地没有非终态建造事务覆盖时，补登一条 'queued' 建造事务。
 *
 * 设计边界（刻意保守，避免自激循环）：
 * 1. 仅处理「本楼新观察到的建造中」。基线已是建造中的存量占位不改写 —— 存量缺口属数据修复，
 *    不属运行时猜测；否则一旦转正失败会每楼重建一条事务，形成永不结束的建造队列。
 * 2. 仅处理非首楼。首楼 <初始状态> 里的建造中属开局剧本布景，不应被换算成待办事务。
 * 3. 已存在非终态建造事务（queued/active/settling）时按 qty − building_delivered_qty 计算
 *    剩余覆盖量，只补差额，不重复立项。
 * 4. total_minutes / min_days_lock 一律留 0：工期由 settleFloor 步骤③ backfillDurations
 *    按 catalog 回填（§3.3），解析层不重复实现工期推导，也不引入 parse → engines 的反向依赖。
 * 5. status='queued' + started_at=''，由事务引擎 Step ④ 升格时补记开工时刻，
 *    解析层绝不用上一楼时钟冒充开工时刻。
 * 6. cost_paid 记 true：该建筑是模型叙述出的既成在建事实，账务按已立项处理，
 *    避免反向不变量私自触发经济扣款。
 */
import { canon } from './parseCommon';
import type { ParseEvent, StatData } from './parseTypesAndCanon';

const TERMINAL_STATUS = new Set(['done', 'cancelled']);

interface BuildingLike {
  name?: unknown;
  state?: unknown;
}

function keyOfBase(base: { id?: unknown; name?: unknown }): string {
  return canon(base.name) || canon(base.id);
}

function buildingsOf(base: { buildings?: unknown }): BuildingLike[] {
  return Array.isArray(base.buildings) ? (base.buildings as BuildingLike[]) : [];
}

/** 基线各基地「基地键 → (建筑 canon 名 → 建造中数量)」 */
function readBaselineUnderConstruction(prevData: unknown): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  if (!prevData || typeof prevData !== 'object') return out;
  const bases = (prevData as { bases?: unknown }).bases;
  if (!Array.isArray(bases)) return out;
  for (const raw of bases) {
    if (!raw || typeof raw !== 'object') continue;
    const base = raw as Record<string, unknown>;
    const baseKey = keyOfBase(base);
    if (!baseKey) continue;
    const counts = new Map<string, number>();
    for (const b of buildingsOf(base)) {
      if (String(b.state ?? '').trim() !== '建造中') continue;
      const nameKey = canon(b.name);
      if (!nameKey) continue;
      counts.set(nameKey, (counts.get(nameKey) ?? 0) + 1);
    }
    out.set(baseKey, counts);
  }
  return out;
}

/** 队列项的 base 可能存基地 id 或名称；单基地时允许空 base 兜底命中 */
function queueBelongsToBase(queueBase: unknown, base: Record<string, unknown>, isSingleBase: boolean): boolean {
  const qb = canon(queueBase);
  if (!qb) return isSingleBase;
  return qb === canon(base.name) || qb === canon(base.id);
}

export interface BuildReverseInvariantOptions {
  /** 上一有效楼 stat_data，用于识别「本楼新观察到的建造中」 */
  prevData?: unknown;
  /** 首楼 <初始状态> 的建造中属开局布景，不换算为事务 */
  isFirstFloor?: boolean;
  /**
   * 本楼 <排产计划> 已申报的建造名（canon 名）：同楼同名的正式立项由 planningReceipt 结转，
   * 反向不变量必须让位，否则会与其形成两条并行事务。
   */
  skipNames?: ReadonlySet<string>;
}

export interface BuildReverseInvariantResult {
  data: StatData;
  events: ParseEvent[];
  /** 本楼补登的建造事务条数（0 = 零改动，data 原样返回） */
  registeredCount: number;
}

/**
 * 反向不变量主入口：为「本楼新观察到、且无事务覆盖」的建造中建筑补登建造事务。
 * 无缺口时原样返回传入 data（零拷贝，调用方可安全比较引用）。
 */
export function registerOrphanBuildingTransactions(
  data: StatData,
  opts: BuildReverseInvariantOptions = {},
): BuildReverseInvariantResult {
  const events: ParseEvent[] = [];
  const bases = Array.isArray(data.bases) ? (data.bases as unknown as Record<string, unknown>[]) : [];
  if (opts.isFirstFloor || bases.length === 0) {
    return { data, events, registeredCount: 0 };
  }

  const baseline = readBaselineUnderConstruction(opts.prevData);
  const isSingleBase = bases.length === 1;
  const queues = Array.isArray(data.queues) ? [...data.queues] : [];
  let registeredCount = 0;

  for (const base of bases) {
    const baseKey = keyOfBase(base);
    if (!baseKey) continue;
    const prevCounts = baseline.get(baseKey) ?? new Map<string, number>();

    const currentCounts = new Map<string, { name: string; count: number }>();
    for (const b of buildingsOf(base)) {
      if (String(b.state ?? '').trim() !== '建造中') continue;
      const rawName = String(b.name ?? '').trim();
      const nameKey = canon(rawName);
      if (!nameKey) continue;
      const slot = currentCounts.get(nameKey);
      if (slot) slot.count += 1;
      else currentCounts.set(nameKey, { name: rawName, count: 1 });
    }
    if (currentCounts.size === 0) continue;

    for (const [nameKey, group] of currentCounts) {
      const fresh = group.count - (prevCounts.get(nameKey) ?? 0);
      if (fresh <= 0) continue;
      if (opts.skipNames?.has(nameKey)) continue;

      // 既有非终态建造事务的剩余覆盖量（qty − 已转正数）
      const capacity = queues.reduce((sum, q) => {
        if (q.type !== '建造') return sum;
        if (TERMINAL_STATUS.has(String(q.status ?? 'active'))) return sum;
        if (!queueBelongsToBase(q.base, base, isSingleBase)) return sum;
        if (canon(q.item) !== nameKey) return sum;
        const qty = Math.max(1, Math.floor(Number(q.qty ?? 1)));
        const delivered = Math.max(0, Math.floor(Number(q.building_delivered_qty ?? 0)));
        return sum + Math.max(0, qty - delivered);
      }, 0);

      const missing = fresh - capacity;
      if (missing <= 0) continue;

      const baseLabel = String(base.name ?? base.id ?? '');
      queues.push({
        type: '建造',
        item: group.name,
        base: baseLabel,
        progress: 0,
        eta: '',
        status: 'queued',
        started_at: '',
        total_minutes: 0,
        spent_minutes: 0,
        qty: missing,
        qty_done: 0,
        cost_paid: true,
        min_days_lock: 0,
        hold: false,
      } as unknown as StatData['queues'][number]);

      registeredCount += 1;
      events.push({
        light: '🟢',
        layer: 'L2',
        path: `bases[${baseLabel}].buildings[${group.name}]`,
        message: `<态势> 申报「${group.name}」×${missing} 为建造中但无建造事务在册，已按反向不变量补登建造事务（${baseLabel}；工期待结算回填）`,
        after: { base: baseLabel, item: group.name, qty: missing },
      });
    }
  }

  if (registeredCount === 0) {
    return { data, events, registeredCount: 0 };
  }
  return {
    data: { ...(data as unknown as Record<string, unknown>), queues } as unknown as StatData,
    events,
    registeredCount,
  };
}
