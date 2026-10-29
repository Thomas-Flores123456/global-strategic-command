/**
 * dispatchOrderText.ts —— 队列调度令指令文本生成器（CTRL-UI-DISPATCH-01 · 调度令 UI 入口）
 *
 * 真源与纪律：
 * - 通道裁决（卡面二选一）：默认走 sendAction 指令文本通道——引擎写入纪律为
 *   「一切状态变更走战报解析环，UI 不直写变量」。全 src 勘察确认引擎调度令接口
 *   （transactionEngine.applyDispatchOrders / settleTransactions options.orders）
 *   无任何运行时直连调用先例（仅引擎测试夹具引用），故不援引直连通道；
 * - 文本口径：调度令报文语法逐字对齐《系统事务与时间推进总设计案》§2.3.1（confirmed）——
 *   LLM 以 <队列> 标签扩展字段「调度: 置顶/置底/暂缓/恢复」声明调度意图；
 *   动词枚举真源 transactionEngine.DISPATCH_VERBS（只读引用，引擎零改动）；
 * - 勘察登记：parsePipeline 现行版尚无「调度:」字段解析段（useParse 的 settleFloor
 *   调用未喂 orders），文本→DispatchOrder 的引擎接线属后续引擎侧任务；本模块文本
 *   与该接线落地后的消费口径保持一致，落地后无需改 UI；
 * - 文案集中：面板短文案收 DISPATCH_ORDER_COPY（对齐 QUEUE_DISPLAY_COPY 前端就地
 *   集中管理先例），组件零自建文案；
 * - 🔴 纯函数：零 IO / 零 DOM / 零 vue·pinia / 零酒馆 API；不原地修改入参。
 */
import type { QueueItem } from '../../红警指挥系统/core/schema';
import { DISPATCH_VERBS, type DispatchVerb } from '../../红警指挥系统/engines/transactionEngine';

export { DISPATCH_VERBS, type DispatchVerb };

export type ExtendedScheduleVerb = DispatchVerb | '撤销' | '指派';

export const EXTENDED_SCHEDULE_VERBS: readonly ExtendedScheduleVerb[] = [
  '置顶',
  '置底',
  '暂缓',
  '恢复',
  '撤销',
  '指派',
] as const;

export interface ExtendedDispatchVerbButton {
  verb: ExtendedScheduleVerb;
  enabled: boolean;
  hint: string;
  armed: boolean;
  danger?: boolean;
}

export interface QueuedTrayOrderItem {
  id: string;
  verb: ExtendedScheduleVerb | '双模切换';
  item: string;
  base?: string;
  type?: string;
  summary: string;
  orderText: string;
}

/** 调度令面板文案集（条令体：动词提示语义对齐作战条令与工务调度备忘录） */
export const DISPATCH_ORDER_COPY = {
  /** 按钮组 aria-label */
  groupLabel: (item: string) => `调度令：${item}`,
  /** 四动词语义提示（按钮可用时作 title 悬停提示） */
  verbHint: {
    置顶: '调升至产线首序；工位满员时置换末序在编工程（既有工时进度留存）',
    置底: '移送至候列末序；在编项目退回工位挂起（既有工时进度留存），空额由首序递补',
    暂缓: '标记工务暂缓：工位空额跳过不予升格；在编项目退回候列挂起（工时进度留存）',
    恢复: '解除工务暂缓令：清除暂缓标记，按当前候列位次正常参与工位分配',
  } as Readonly<Record<DispatchVerb, string>>,
  /** 禁用理由（title 照实呈现不可操作原因） */
  holdAlready: '工程已奉令暂缓，待下达恢复调度令',
  notHeld: '工程未处于暂缓状态，无需下达恢复调度令',
  /** 免疫态禁用理由（待收讫确认与结项终态受条令保护，禁止现场调度） */
  immune: '工程处于交付待核实或已结项终态，战区参谋部条令禁止调度变动',
} as const;

/** 调度令目标（队列条目行最小身份；研究按 type+item 全局唯一，免基地消歧） */
export interface DispatchTarget {
  item: string;
  type?: QueueItem['type'] | string;
  base?: string;
}

/** 行内四动词按钮视图模型（组件纯映射，零自建判定） */
export interface DispatchVerbButton {
  verb: DispatchVerb;
  enabled: boolean;
  /** title 提示：enabled＝动词语义，disabled＝禁用理由 */
  hint: string;
  /** hold 态高亮「恢复」（当前条目的正向动作） */
  armed: boolean;
}

/**
 * 调度令指令文本（sendAction 通道，发 user 楼 + /trigger）。
 * 语法对齐 §2.3.1 报文（<队列> 标签「调度: <动词>」扩展字段）；物理队列带基地消歧，
 * 研究队列全局唯一免基地。非法动词/空项目名 fail-closed 抛错（不产出半条指令）。
 */
export function dispatchOrderText(verb: DispatchVerb | string, target: DispatchTarget): string {
  if (!DISPATCH_VERBS.includes(verb as DispatchVerb)) {
    throw new RangeError(`非法调度动词「${verb}」，仅支持 ${DISPATCH_VERBS.join('/')}`);
  }
  const item = target.item.trim();
  if (!item) throw new RangeError('调度令目标项目名不能为空');
  const type = target.type?.trim() ?? '';
  // parsePipeline 队列复合身份口径：研究按 type+item 全局唯一；建造/生产/改装按 type+item+base
  const base = type && type !== '研究' ? (target.base?.trim() ?? '') : '';
  const head = `（指挥指令：下达队列调度令「${verb}」——${type ? `${type}项目` : '项目'}「${item}」`;
  const basePart = base ? `，基地「${base}」` : '';
  return (
    `${head}${basePart}。请在 <队列> 报文中以「调度: ${verb}」声明该调度令；` +
    `调度只挪队列顺序与暂缓标记，不改写进度与工期，执行结果或被拒留痕随本楼结算呈现。）`
  );
}

/**
 * 队列条目行 → 四动词按钮视图模型（纯函数）。
 * 判定口径：
 * - settling/done/cancelled 免疫（§2.3.2 约束 2）：四键全禁，理由照实呈现；
 * - 暂缓：已 hold 禁用（幂等无意义）；恢复：仅 hold 时可用并高亮；
 * - 置顶/置底：active/queued 均可作用（§2.3.1 表）。
 */
export function dispatchVerbButtonsFor(target: {
  status: QueueItem['status'] | string;
  hold?: boolean;
}): DispatchVerbButton[] {
  const immune = target.status === 'settling' || target.status === 'done' || target.status === 'cancelled';
  const hold = target.hold === true;
  return DISPATCH_VERBS.map(verb => {
    let enabled = !immune;
    let hint: string = DISPATCH_ORDER_COPY.verbHint[verb];
    let armed = false;
    if (immune) {
      hint = DISPATCH_ORDER_COPY.immune;
    } else if (verb === '暂缓' && hold) {
      enabled = false;
      hint = DISPATCH_ORDER_COPY.holdAlready;
    } else if (verb === '恢复') {
      enabled = hold;
      if (hold) armed = true;
      else hint = DISPATCH_ORDER_COPY.notHeld;
    }
    return { verb, enabled, hint, armed };
  });
}

/**
 * 六动词扩展调度令指令文本（兼容置顶/置底/暂缓/恢复 + 撤销/指派）。
 * 纯函数：非法动词或空项目名抛 RangeError。
 */
export function extendedDispatchOrderText(
  verb: ExtendedScheduleVerb | string,
  target: DispatchTarget & { allocateBase?: string },
): string {
  if (DISPATCH_VERBS.includes(verb as DispatchVerb)) {
    return dispatchOrderText(verb, target);
  }
  if (verb !== '撤销' && verb !== '指派') {
    throw new RangeError(`非法调度动词「${verb}」，仅支持 ${EXTENDED_SCHEDULE_VERBS.join('/')}`);
  }
  const item = target.item.trim();
  if (!item) throw new RangeError('调度令目标项目名不能为空');
  const type = target.type?.trim() ?? '';

  if (verb === '撤销') {
    const base = type === '研究' ? '' : (target.base?.trim() ?? '');
    const basePart = base ? `（基地「${base}」）` : '';
    return (
      `（指挥指令：下达工程撤销令——终止${type ? `${type}项目` : '项目'}「${item}」${basePart}，` +
      `释放占用工位并按条令退回未耗物资。请在 <队列> 报文中将该项标记为 cancelled。）`
    );
  }

  const allocateBase = (target.allocateBase ?? target.base ?? '').trim() || '主基地';
  return (
    `（指挥指令：下达跨基地承建指派令——将${type ? `${type}项目` : '工程项目'}「${item}」` +
    `改派由基地「${allocateBase}」承建并排入对应工位。）`
  );
}

/**
 * 队列条目行 → 六动词按钮视图模型（纯函数）。
 * 前 4 项复用 dispatchVerbButtonsFor；追加「撤销」（danger 二次确认）与「指派」。
 */
export function extendedDispatchVerbButtonsFor(target: {
  status: QueueItem['status'] | string;
  hold?: boolean;
  canAllocate?: boolean;
}): ExtendedDispatchVerbButton[] {
  const baseButtons: ExtendedDispatchVerbButton[] = dispatchVerbButtonsFor(target).map(btn => ({
    ...btn,
  }));
  const immune = target.status === 'settling' || target.status === 'done' || target.status === 'cancelled';

  const cancelButton: ExtendedDispatchVerbButton = {
    verb: '撤销',
    enabled: !immune,
    hint: immune ? DISPATCH_ORDER_COPY.immune : '终止当前项目并释放工位（需二次点击确认）',
    armed: false,
    danger: true,
  };

  const canAllocate = target.canAllocate !== false;
  const allocateButton: ExtendedDispatchVerbButton = {
    verb: '指派',
    enabled: !immune && canAllocate,
    hint: immune
      ? DISPATCH_ORDER_COPY.immune
      : canAllocate
        ? '改派该项目由指定基地承建并排入对应工位'
        : '当前项目不支持跨基地改派',
    armed: false,
  };

  return [...baseButtons, cancelButton, allocateButton];
}

/**
 * 参谋指令托盘批量合成器（纯函数）。
 * - 0 条返回空串；
 * - 1 条直接返回该条 orderText；
 * - 多条合成为结构化联席调度令。
 */
export function formatBatchScheduleOrdersText(
  orders: ReadonlyArray<Pick<QueuedTrayOrderItem, 'verb' | 'summary' | 'orderText'>>,
): string {
  if (orders.length === 0) return '';
  if (orders.length === 1) return orders[0].orderText;
  const lines = orders.map((order, idx) => {
    const summaryPart = order.summary.trim();
    return summaryPart
      ? `${idx + 1}. [${order.verb}] ${summaryPart} —— ${order.orderText}`
      : `${idx + 1}. [${order.verb}] ${order.orderText}`;
  });
  return [
    `【战区工务与产能联席调度令】（共 ${orders.length} 项变更）`,
    ...lines,
    '请参谋部按上述顺位、工位双模与暂缓标记同步更新本楼 <队列> 与建筑状态。',
  ].join('\n');
}
