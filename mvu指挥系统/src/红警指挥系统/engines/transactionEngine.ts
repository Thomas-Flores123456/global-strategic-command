/**
 * transactionEngine.ts —— 系统事务结算骨架（CTRL-TXN-SCHEMA-01）
 *
 * 真源：docs/design/systems/系统事务与时间推进总设计案.md（confirmed，八章＋§2.3 调度令）
 *
 * 设计红线（§2.2 状态机四条铁律 / §2.3.2 调度令安全约束 / §4.2 纯函数边界）：
 * 1. 只有引擎能动 progress——LLM 与前端 UI 均不得直接写进度；
 * 2. 时间是唯一燃料——progress 推进只发生在 Δt 结算时刻；
 * 3. done 必过对账门——settling→done 由三色门（CTRL-RECONCILE-01）裁决，本引擎只提供
 *    canTransition 守卫供其调用，绝不在 settleTransactions 内自动 done；
 * 4. 终态不可逆——done/cancelled 不得复活；
 * 5. 调度令永不触碰 progress/spent_minutes；settling/done/cancelled 不参与调度（违令进 rejected）；
 * 6. 纯函数：零 Pinia、零 Vue、零宿主 API；不原地修改入参，返回新对象。
 *
 * 解耦合同：本引擎不直接 import operationEngine——工况效率经 options.effFor 回调注入
 * （default 恒 1），真实工况回环在集成层/回环测试中接线。
 */

/* ═══════════════ 类型定义 ═══════════════ */

/** 五态事务状态机（设计案 §2） */
export type TransactionStatus = 'queued' | 'active' | 'settling' | 'done' | 'cancelled';

/** QueueItem v2 结构视图（与 schema.ts QueueItem 输出对齐；本引擎不 import schema 保持零依赖） */
export interface TransactionItem {
  type: string;
  item: string;
  base: string;
  progress: number;
  eta: string;
  status: TransactionStatus;
  started_at: string;
  total_minutes: number;
  spent_minutes: number;
  qty: number;
  qty_done: number;
  /** 建筑已转正数量；旧引擎调用可缺省，Schema 落盘时归一为 0 */
  building_delivered_qty?: number;
  /** BUG-R2-20：本楼是否已由系统满工时主权自动交割（供同楼 <生产> 声明幂等防重确认） */
  auto_settled?: boolean;
  cost_paid: boolean;
  min_days_lock: number;
  hold: boolean;
}

/** 调度令四动词（§2.3.1，枚举收口，其余值进 rejected） */
export const DISPATCH_VERBS = ['置顶', '置底', '暂缓', '恢复'] as const;
export type DispatchVerb = (typeof DISPATCH_VERBS)[number];

/** 调度令报文（随楼层 <队列> 标签进入解析管线后的结构化形态） */
export interface DispatchOrder {
  /** 目标项目名 */
  item: string;
  /** 可选：目标基地（多基地同名项目消歧） */
  base?: string;
  /** 可选：目标类型（同名跨类型消歧） */
  type?: string;
  /** 调度动词；string 宽进（LLM 报文），非法值进 rejected */
  verb: DispatchVerb | string;
}

/** 被拒调度令（含原因，供隔离区 R 系列 warn 留痕） */
export interface RejectedDispatchOrder {
  order: DispatchOrder;
  reason: 'invalid_verb' | 'target_not_found' | 'invalid_target_status';
  detail: string;
}

/** 调度执行中发生的 active→queued 降格记录（供结算事件留痕） */
export interface DispatchDemotion {
  item: string;
  base: string;
  type: string;
  cause: 'preempt' | 'demote' | 'hold';
}

export interface ApplyDispatchResult {
  /** 新队列数组（入参不被修改） */
  next: TransactionItem[];
  /** 被拒调度令（含原因） */
  rejected: RejectedDispatchOrder[];
  /** active→queued 降格记录（置顶抢占/置底/暂缓） */
  demotions: DispatchDemotion[];
}

/** 结算事件（结构化留痕，供上层落 issues/隔离区） */
export interface SettleEvent {
  type:
    | 'unknown_duration' // total_minutes<=0 的 active 事务：进度不推进但不报错
    | 'enter_settling' // progress≥100，active→settling
    | 'promoted' // queued→active（带宽空位升格）
    | 'preempted' // 置顶抢占：最后升格的 active 退回 queued（进度保留）
    | 'demoted' // 置底/暂缓：active 退回 queued（进度保留）
    | 'dispatch_rejected' // 调度令被拒（原因见 detail）
    | 'qty_progress'; // 批次流水 qty_done 增长
  item: string;
  base: string;
  detail?: string;
}

export interface SettleOptions {
  /** 工况效率回调（default 恒 1）；引擎不直接 import operationEngine，保持解耦 */
  effFor?: (txn: TransactionItem) => number;
  /** 同 base 同 type 并行上限回调（default 恒 1） */
  parallelLimitFor?: (txn: TransactionItem) => number;
  /**
   * 产线分组键回调（研究槽设计案 §5.2 接缝，default＝现行 `${base}\u0000${type}`——
   * 不注入时行为逐字节零变化）。countActive/升格门/调度令抢占均经同一 laneKey 通道。
   */
  laneKeyFor?: (txn: TransactionItem) => string;
  /**
   * 同 type 全局并行上限回调（研究槽设计案 §5.2 接缝，default＝Infinity——现行无全局限
   * 语义零变化）。升格门在「lane 内 active < parallelLimitFor」之上叠加此双重检查。
   */
  globalLimitFor?: (type: string) => number;
  /** 本楼调度令（§4 结算顺序第①步执行） */
  orders?: DispatchOrder[];
  /** 游戏内当前日历时刻；提供时为新升格/started_at 为空的 active 事务补记开工时刻 */
  now?: string;
}

export interface SettleResult<S extends { queues: TransactionItem[] }> {
  /** 新状态对象（入参 state 不被修改） */
  next: S;
  /** 结算事件流水 */
  events: SettleEvent[];
}

/* ═══════════════ 状态机守卫 ═══════════════ */

/**
 * 合法迁移白名单（设计案 §2 状态机 + §2.3 调度令语义）：
 * - queued→active（带宽升格）
 * - active→settling（进度满）
 * - active→queued（置顶抢占 / 置底 / 暂缓退回，进度保留）
 * - settling→done（三色门 MATCH/UNDERRUN 认领——本引擎不自动触发，仅供 RECONCILE 调用）
 * - settling→active（UNDERRUN 余量退回）
 * - queued→cancelled / active→cancelled（驾驶员取消 / 三色门驳回 / 前置坍塌）
 * 其余全拒（含 done/cancelled 出发的一切迁移与自迁移）。
 */
const LEGAL_TRANSITIONS: ReadonlyArray<readonly [TransactionStatus, TransactionStatus]> = [
  ['queued', 'active'],
  ['active', 'settling'],
  ['active', 'queued'],
  ['settling', 'done'],
  ['settling', 'active'],
  ['queued', 'cancelled'],
  ['active', 'cancelled'],
];

/** 状态机迁移守卫：仅白名单迁移返回 true */
export function canTransition(from: TransactionStatus, to: TransactionStatus): boolean {
  return LEGAL_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/* ═══════════════ 内部工具（全部无副作用） ═══════════════ */

/** 产线分组键回调类型（§5.2 接缝：laneKey 通道统一经回调，默认恒等于现行 base+type） */
type LaneKeyFor = (txn: TransactionItem) => string;

/** 同 base 同 type 产线分组键（现行默认，laneKeyFor 缺席时的恒等行为） */
function defaultLaneKey(txn: Pick<TransactionItem, 'base' | 'type'>): string {
  return `${txn.base}\u0000${txn.type}`;
}

/** 浅拷贝一条事务（写时复制） */
function cloneTxn(txn: TransactionItem): TransactionItem {
  return { ...txn };
}

/** 终态与待对账状态（调度令免疫区，§2.3.2 约束 2） */
function isDispatchImmune(status: TransactionStatus): boolean {
  return status === 'settling' || status === 'done' || status === 'cancelled';
}

/**
 * 定位调度令目标：按 item（＋可选 base/type）匹配。
 * 命中多条时取数组序第一条非免疫态；若仅命中免疫态条目，返回该条以便按状态拒绝。
 */
function findOrderTarget(queues: TransactionItem[], order: DispatchOrder): number {
  let immuneHit = -1;
  for (let i = 0; i < queues.length; i++) {
    const txn = queues[i];
    if (txn.item !== order.item) continue;
    if (order.base !== undefined && txn.base !== order.base) continue;
    if (order.type !== undefined && txn.type !== order.type) continue;
    if (!isDispatchImmune(txn.status)) return i;
    if (immuneHit === -1) immuneHit = i;
  }
  return immuneHit;
}

/** 统计某产线当前 active 数（laneKey 经回调通道，§5.2） */
function countActive(queues: TransactionItem[], key: string, laneKeyFor: LaneKeyFor): number {
  return queues.filter(txn => txn.status === 'active' && laneKeyFor(txn) === key).length;
}

/** 将 index 处元素移动到同产线首位（数组序即优先级，§2.3.3） */
function moveToLaneFront(queues: TransactionItem[], index: number, laneKeyFor: LaneKeyFor): TransactionItem[] {
  const target = queues[index];
  const key = laneKeyFor(target);
  const rest = queues.filter((_, i) => i !== index);
  const firstLaneIdx = rest.findIndex(txn => laneKeyFor(txn) === key);
  const insertAt = firstLaneIdx === -1 ? index : firstLaneIdx;
  return [...rest.slice(0, insertAt), target, ...rest.slice(insertAt)];
}

/** 将 index 处元素移动到同产线末位 */
function moveToLaneBack(queues: TransactionItem[], index: number, laneKeyFor: LaneKeyFor): TransactionItem[] {
  const target = queues[index];
  const key = laneKeyFor(target);
  const rest = queues.filter((_, i) => i !== index);
  let lastLaneIdx = -1;
  for (let i = 0; i < rest.length; i++) {
    if (laneKeyFor(rest[i]) === key) lastLaneIdx = i;
  }
  const insertAt = lastLaneIdx === -1 ? index : lastLaneIdx + 1;
  return [...rest.slice(0, insertAt), target, ...rest.slice(insertAt)];
}

/**
 * 找到某产线「最后升格的 active」下标。
 * started_at 可能为 ''（旧档），无法按时刻排序，按数组序最后一条 active 近似
 * （数组序即优先级，越靠后越晚升格）。
 */
function findLastActiveInLane(queues: TransactionItem[], key: string, laneKeyFor: LaneKeyFor): number {
  for (let i = queues.length - 1; i >= 0; i--) {
    if (queues[i].status === 'active' && laneKeyFor(queues[i]) === key) return i;
  }
  return -1;
}

/** active 退回 queued（🔴 进度保留：progress/spent_minutes 原样不动） */
function demoteToQueued(txn: TransactionItem, hold?: boolean): TransactionItem {
  const next = cloneTxn(txn);
  next.status = 'queued';
  if (hold !== undefined) next.hold = hold;
  return next;
}

/* ═══════════════ 调度令执行器（§2.3） ═══════════════ */

/**
 * 执行一批调度令：四动词「置顶/置底/暂缓/恢复」。
 * - 🔴 永不修改 progress/spent_minutes（挪顺序≠重造）；
 * - 🔴 作用于 settling/done/cancelled 的调度令进 rejected（含原因）；
 * - 置顶抢占：目标为 queued 且产线满时，最后升格的 active 退回 queued（进度保留），
 *   目标顶到产线首位——升格本身统一走 settleTransactions 第④步带宽门（单一升格通道）；
 * - 置底：目标若为 active 则退回 queued（进度保留）并挪到产线末位，空位由带宽门队首递补；
 * - 暂缓：hold=true；已 active 则退回 queued＋hold；
 * - 恢复：清 hold，按当前位置正常竞争带宽。
 *
 * 纯函数：不修改入参 queues/orders，返回新数组。
 */
export function applyDispatchOrders(
  queues: TransactionItem[],
  orders: DispatchOrder[],
  options: { parallelLimitFor?: (txn: TransactionItem) => number; laneKeyFor?: LaneKeyFor } = {},
): ApplyDispatchResult {
  const limitFor = options.parallelLimitFor ?? (() => 1);
  const laneKeyFor = options.laneKeyFor ?? defaultLaneKey;
  let next = queues.map(cloneTxn);
  const rejected: RejectedDispatchOrder[] = [];
  const demotions: DispatchDemotion[] = [];

  for (const order of orders) {
    if (!DISPATCH_VERBS.includes(order.verb as DispatchVerb)) {
      rejected.push({
        order,
        reason: 'invalid_verb',
        detail: `非法调度动词「${order.verb}」，仅支持 置顶/置底/暂缓/恢复`,
      });
      continue;
    }
    const idx = findOrderTarget(next, order);
    if (idx === -1) {
      rejected.push({ order, reason: 'target_not_found', detail: `调度目标「${order.item}」不存在于队列` });
      continue;
    }
    const target = next[idx];
    if (isDispatchImmune(target.status)) {
      rejected.push({
        order,
        reason: 'invalid_target_status',
        detail: `调度令不能作用于 ${target.status} 态事务「${target.item}」（settling/done/cancelled 免疫，§2.3.2）`,
      });
      continue;
    }

    const key = laneKeyFor(target);
    switch (order.verb as DispatchVerb) {
      case '置顶': {
        if (target.status === 'queued') {
          const limit = Math.max(0, limitFor(target));
          if (countActive(next, key, laneKeyFor) >= limit) {
            const lastActiveIdx = findLastActiveInLane(next, key, laneKeyFor);
            if (lastActiveIdx !== -1) {
              const victim = next[lastActiveIdx];
              next[lastActiveIdx] = demoteToQueued(victim);
              demotions.push({ item: victim.item, base: victim.base, type: victim.type, cause: 'preempt' });
            }
          }
        }
        next = moveToLaneFront(next, idx, laneKeyFor);
        break;
      }
      case '置底': {
        if (target.status === 'active') {
          next[idx] = demoteToQueued(target);
          demotions.push({ item: target.item, base: target.base, type: target.type, cause: 'demote' });
        }
        next = moveToLaneBack(next, idx, laneKeyFor);
        break;
      }
      case '暂缓': {
        if (target.status === 'active') {
          next[idx] = demoteToQueued(target, true);
          demotions.push({ item: target.item, base: target.base, type: target.type, cause: 'hold' });
        } else {
          next[idx] = { ...cloneTxn(target), hold: true };
        }
        break;
      }
      case '恢复': {
        next[idx] = { ...cloneTxn(target), hold: false };
        break;
      }
    }
  }

  return { next, rejected, demotions };
}

/* ═══════════════ 结算主函数（§4 每楼一次） ═══════════════ */

/**
 * settleTransactions —— 时间推进结算流水线（纯函数）。
 *
 * 结算顺序严格按设计案 §4：
 * ① 先执行本楼调度令（只挪顺序与 hold，不碰进度）；
 * ② active 事务按 Δt×eff 积分进度：spent_minutes += Δt×eff，
 *    progress = min(100, spent/total×100)；total_minutes<=0（未知工期）不推进、
 *    不报错，产出 unknown_duration 事件；批次流水 qty>1 时
 *    qty_done = min(qty, floor(spent_minutes / (total_minutes/qty)))；
 * ③ progress≥100 → settling（settling→done 归三色门 CTRL-RECONCILE-01，本引擎不越权）；
 * ③′（F7 修复）active 带宽回检：既成 active 也逐一过 lane 并行上限＋同 type 全局上限，
 *    超编/未开通者降格回 queued（进度保留，demoted 留痕）——堵「出生即 active」穿越升格门
 *    （出生端由 parsePipeline 对新事务显式落 queued 配合收口，schema 默认值保旧档不变）；
 * ④ queued 且 !hold 按数组序升格：同 base 同 type 的 active 数 < 并行上限（options 注入，
 *    default 1）即升 active，补记 started_at（options.now 提供时）。
 *
 * 🔴 不原地修改入参 state，返回新对象。
 */
export function settleTransactions<S extends { queues: TransactionItem[] }>(
  state: S,
  deltaMinutes: number,
  options: SettleOptions = {},
): SettleResult<S> {
  const effFor = options.effFor ?? (() => 1);
  const limitFor = options.parallelLimitFor ?? (() => 1);
  const laneKeyFor = options.laneKeyFor ?? defaultLaneKey;
  const globalLimitFor = options.globalLimitFor ?? (() => Infinity);
  const safeDelta = Number.isFinite(deltaMinutes) ? Math.max(0, deltaMinutes) : 0;
  const events: SettleEvent[] = [];

  // ① 调度令（进 rejected 的以 dispatch_rejected 事件留痕）
  const dispatch = applyDispatchOrders(state.queues, options.orders ?? [], {
    parallelLimitFor: limitFor,
    laneKeyFor,
  });
  for (const rej of dispatch.rejected) {
    events.push({
      type: 'dispatch_rejected',
      item: rej.order.item,
      base: rej.order.base ?? '',
      detail: rej.detail,
    });
  }
  // 抢占/置底/暂缓降格留痕
  for (const demotion of dispatch.demotions) {
    events.push({
      type: demotion.cause === 'preempt' ? 'preempted' : 'demoted',
      item: demotion.item,
      base: demotion.base,
      detail: `active 退回 queued（进度保留，cause=${demotion.cause}）`,
    });
  }

  let queues = dispatch.next.map(txn => cloneTxn(txn));

  // ② & ③′ & ③：既成 active 先过 lane/全局带宽回检（超编或 limit<=0 者降格回 queued 且不吃本轮 Δt），
  // 通过回检的 active 项执行 Δt×eff 积分进度；
  // BUG-R2-14：当某车道上的 active 项在本楼 Δt 内达到 total_minutes 转入 settling 且仍有溢出墙钟时间
  // remWallDelta > 0（对应 remMinutes = rawMinutes - neededMinutes > 0）时，若本楼存在同车道的 queued（且非 hold）候列项，
  // 将剩余时间顺延赋给同车道紧随其后的候列项（升格为 active 并积分剩余时间，若也跑满则同样转 settling）。
  const laneCap = new Map<string, number>();
  const typeCap = new Map<string, number>();
  const laneOverflowWall = new Map<string, number>();
  const spilloverSettledIndices = new Set<number>();

  const integrateTxnWithDelta = (txn: TransactionItem, wallDelta: number, idx: number): { remWall: number } => {
    if (txn.total_minutes <= 0) {
      if (wallDelta > 0) {
        events.push({
          type: 'unknown_duration',
          item: txn.item,
          base: txn.base,
          detail: `total_minutes=${txn.total_minutes}（未知工期），进度不推进`,
        });
      }
      return { remWall: 0 };
    }
    if (wallDelta <= 0) return { remWall: 0 };

    const eff = Math.max(0, effFor(txn));
    const rawMinutes = wallDelta * eff;
    const prevSpent = txn.spent_minutes;
    const neededMinutes = Math.max(0, txn.total_minutes - prevSpent);
    const key = laneKeyFor(txn);
    const hasSubsequentQueuedInSameLane = queues.some(
      (cand, cIdx) => cIdx > idx && cand.status === 'queued' && !cand.hold && laneKeyFor(cand) === key,
    );

    if (rawMinutes > neededMinutes && hasSubsequentQueuedInSameLane) {
      txn.spent_minutes = txn.total_minutes;
    } else {
      txn.spent_minutes = prevSpent + rawMinutes;
    }
    txn.progress = Math.min(100, (txn.spent_minutes / txn.total_minutes) * 100);

    if (txn.qty > 1) {
      const unitMinutes = txn.total_minutes / txn.qty;
      const doneNow = Math.min(txn.qty, Math.floor(txn.spent_minutes / unitMinutes));
      if (doneNow !== txn.qty_done) {
        txn.qty_done = doneNow;
        events.push({
          type: 'qty_progress',
          item: txn.item,
          base: txn.base,
          detail: `批次流水 ${doneNow}/${txn.qty}`,
        });
      }
    }

    const remMinutes = Math.max(0, rawMinutes - neededMinutes);
    const remWall = eff > 0 && remMinutes > 0 ? remMinutes / eff : 0;
    return { remWall };
  };

  for (let i = 0; i < queues.length; i++) {
    const txn = queues[i];
    if (txn.status === 'active') {
      const key = laneKeyFor(txn);
      const laneLimit = Math.max(0, limitFor(txn));
      const typeLimit = globalLimitFor(txn.type);
      const laneUsed = laneCap.get(key) ?? 0;
      const typeUsed = typeCap.get(txn.type) ?? 0;
      if (laneUsed < laneLimit && typeUsed < typeLimit) {
        laneCap.set(key, laneUsed + 1);
        typeCap.set(txn.type, typeUsed + 1);
        const { remWall } = integrateTxnWithDelta(txn, safeDelta, i);
        if (txn.total_minutes > 0 && txn.progress >= 100 && canTransition(txn.status, 'settling')) {
          txn.status = 'settling';
          events.push({
            type: 'enter_settling',
            item: txn.item,
            base: txn.base,
            detail: '进度满，等待三色对账门裁决（settling→done 归 CTRL-RECONCILE-01）',
          });
          if (remWall > 0) {
            laneCap.set(key, Math.max(0, (laneCap.get(key) ?? 1) - 1));
            typeCap.set(txn.type, Math.max(0, (typeCap.get(txn.type) ?? 1) - 1));
            laneOverflowWall.set(key, (laneOverflowWall.get(key) ?? 0) + remWall);
          }
        } else if (options.now && txn.started_at === '') {
          txn.started_at = options.now;
        }
      } else {
        const demoted = demoteToQueued(txn);
        queues[i] = demoted;
        events.push({
          type: 'demoted',
          item: demoted.item,
          base: demoted.base,
          detail: `active 回检降格 queued（进度保留，gate_recheck：产线已占 ${laneUsed}/${laneLimit}，同类型全局 ${typeUsed}/${typeLimit}）`,
        });
      }
      continue;
    }

    if (txn.status === 'queued' && !txn.hold) {
      const key = laneKeyFor(txn);
      const overflowWall = laneOverflowWall.get(key) ?? 0;
      if (overflowWall <= 0) continue;
      const laneLimit = Math.max(0, limitFor(txn));
      const typeLimit = globalLimitFor(txn.type);
      const laneUsed = laneCap.get(key) ?? 0;
      const typeUsed = typeCap.get(txn.type) ?? 0;
      if (laneUsed >= laneLimit || typeUsed >= typeLimit || !canTransition(txn.status, 'active')) continue;

      laneOverflowWall.delete(key);
      laneCap.set(key, laneUsed + 1);
      typeCap.set(txn.type, typeUsed + 1);
      txn.status = 'active';
      if (txn.started_at === '' && options.now) txn.started_at = options.now;
      events.push({
        type: 'promoted',
        item: txn.item,
        base: txn.base,
        detail: `带宽空位升格 active（产线 ${laneUsed + 1}/${laneLimit}）`,
      });
      spilloverSettledIndices.add(i);

      const { remWall } = integrateTxnWithDelta(txn, overflowWall, i);
      if (txn.total_minutes > 0 && txn.progress >= 100 && canTransition(txn.status, 'settling')) {
        txn.status = 'settling';
        events.push({
          type: 'enter_settling',
          item: txn.item,
          base: txn.base,
          detail: '进度满，等待三色对账门裁决（settling→done 归 CTRL-RECONCILE-01）',
        });
        if (remWall > 0) {
          laneCap.set(key, Math.max(0, (laneCap.get(key) ?? 1) - 1));
          typeCap.set(txn.type, Math.max(0, (typeCap.get(txn.type) ?? 1) - 1));
          laneOverflowWall.set(key, remWall);
        }
      }
    }
  }
  void spilloverSettledIndices;

  // ④ queued 且 !hold 按数组序升格（带宽门：lane 内 active < 并行上限，
  //    §5.2 叠加双重检查：同 type 全局 active < globalLimitFor）
  const activeCount = new Map<string, number>();
  const activeByType = new Map<string, number>();
  for (const txn of queues) {
    if (txn.status === 'active') {
      const key = laneKeyFor(txn);
      activeCount.set(key, (activeCount.get(key) ?? 0) + 1);
      activeByType.set(txn.type, (activeByType.get(txn.type) ?? 0) + 1);
    }
  }
  queues = queues.map(txn => {
    if (txn.status !== 'queued' || txn.hold) return txn;
    const key = laneKeyFor(txn);
    const limit = Math.max(0, limitFor(txn));
    const current = activeCount.get(key) ?? 0;
    if (current >= limit || !canTransition(txn.status, 'active')) return txn;
    const globalLimit = globalLimitFor(txn.type);
    const globalCurrent = activeByType.get(txn.type) ?? 0;
    if (globalCurrent >= globalLimit) return txn;
    activeCount.set(key, current + 1);
    activeByType.set(txn.type, globalCurrent + 1);
    const next = cloneTxn(txn);
    next.status = 'active';
    if (next.started_at === '' && options.now) next.started_at = options.now;
    events.push({
      type: 'promoted',
      item: next.item,
      base: next.base,
      detail: `带宽空位升格 active（产线 ${current + 1}/${limit}）`,
    });
    return next;
  });

  return { next: { ...state, queues }, events };
}
