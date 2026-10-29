/**
 * hostSendInput.ts —— 指令文本写入宿主酒馆输入框的唯一通道（ENG-UI-03 提取自 DetailDrawer.vue L106-138）
 *
 * 口径说明（回执引用）：
 * - 这是 DOM 操作 + TavernHelper /setinput 斜杠令，不是 MVU 写 API——指令文本填入输入框后
 *   由驾驶员确认发送、AI 下一轮结转调引擎；UI 层全程不触 stat_data（中控台只读红线）。
 * - 提取动机：DetailDrawer 战术指令与 ENG-UI-03 工程四令共用同一写路径，单一真源防漂移。
 *   行为与 DetailDrawer 原实现逐行等价（textarea 优先、triggerSlash /setinput 兜底、异常吞警）。
 */
export type HostSendChannel = 'textarea' | 'setinput' | 'failed';

/**
 * 将指令文本填入宿主 #send_textarea 并聚焦；失败回退 TavernHelper triggerSlash('/setinput …')。
 * 返回实际走通的通道（'failed'=两路均不通，调用方照实提示）。
 */
export function fillHostSendInput(orderText: string): HostSendChannel {
  // 1. 优先直接向宿主酒馆主文档的 #send_textarea 注入文本并触发事件
  try {
    const hostDoc =
      (window.frameElement as HTMLElement | null)?.ownerDocument ??
      window.parent?.document ??
      document;
    const textarea = hostDoc?.querySelector<HTMLTextAreaElement>('#send_textarea');
    if (textarea) {
      textarea.value = orderText;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.focus();
      return 'textarea';
    }
  } catch (err) {
    console.warn('[hostSendInput] 访问宿主 #send_textarea 异常:', err);
  }

  // 2. 兜底：TavernHelper / STScript /setinput 接口
  try {
    const th =
      (window as unknown as { TavernHelper?: { triggerSlash?: (cmd: string) => Promise<void> } }).TavernHelper ||
      (window.parent as unknown as { TavernHelper?: { triggerSlash?: (cmd: string) => Promise<void> } })?.TavernHelper;
    if (th && typeof th.triggerSlash === 'function') {
      void th.triggerSlash(`/setinput ${orderText}`);
      return 'setinput';
    }
  } catch (err) {
    console.warn('[hostSendInput] triggerSlash 异常:', err);
  }
  return 'failed';
}
