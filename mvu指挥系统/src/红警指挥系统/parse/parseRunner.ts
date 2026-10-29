/**
 * parseRunner.ts —— 事件接线薄层（批 B）
 *
 * 全代码库首个 eventOn 接线点。仅 in_tavern 注册；守卫
 * `getCurrentMessageId() === getLastMessageId()`（仅最新楼 iframe 执行，
 * 历史楼 iframe 静默旁观，避免多 iframe 重复解析）。
 * 事件名一律 tavern_events.XXX 常量；回调 errorCatched 包裹 + toastr 静默降级。
 */
import { in_tavern } from '../composables/store';
import { runParseFor, swipeSlotMissing, type RunOptions } from '../composables/useParse';

let wired = false;

/** 仅最新楼 iframe 放行的回调包装：守卫 + errorCatched + toastr 降级（handler 支持异步给 RunOptions） */
function onLatestFloor(
  handler: (message_id: number) => RunOptions | undefined | Promise<RunOptions | undefined>,
): (message_id: number) => void {
  return errorCatched((message_id: number) => {
    try {
      if (getCurrentMessageId() !== getLastMessageId()) return; // 仅最新楼 iframe 执行
    } catch {
      return; // 环境异常直接静默
    }
    void Promise.resolve(handler(message_id))
      .then(opts => runParseFor(message_id, opts))
      .catch(e => {
        try {
          toastr.warning(e instanceof Error ? e.message : String(e), '红警指挥系统 · 解析失败');
        } catch {
          /* toastr 缺失也不炸 */
        }
      });
  });
}

/** 事件接线入口：mount 后调用一次（幂等） */
export function initParseRunner(): void {
  if (!in_tavern || wired) return;
  wired = true;
  // 新楼生成完毕 → 解析最新楼
  eventOn(tavern_events.GENERATION_ENDED, onLatestFloor(() => undefined));
  // swipe 换页 → 重解析当前页（原文变了 → hash+swipe_id 幂等天然放行；同页重触发则跳过）
  // CTRL-FLOOR-HEAL-01 方案甲④：当前 swipe 槽缺 stat_data（竞态错位/事件吞没残留）→ 跳过幂等直接 force 自愈
  eventOn(
    tavern_events.MESSAGE_SWIPED,
    onLatestFloor(async message_id => ((await swipeSlotMissing(message_id)) ? { force: true } : undefined)),
  );
  // 编辑楼层 → 强制重解析该楼自身；若非最新楼，报告流水标记"下游楼层可能失真"（不级联重算）
  eventOn(
    tavern_events.MESSAGE_EDITED,
    onLatestFloor(message_id => ({ force: true, downstreamWarning: message_id < getLastMessageId() })),
  );
}
