import toastr from 'toastr';
import { in_tavern } from '../composables/store';

let sending = false;

/**
 * 把玩家动作发回酒馆：
 * 1. 用结构化 API 创建真实用户消息（不把玩家文本拼入 STScript，避免管道/斜杠注入）；
 * 2. 用 /trigger 触发正常生成。
 */
export async function sendAction(text: string) {
  const normalized = text.trim();
  if (!normalized || sending) return;

  if (!in_tavern) {
    toastr.info(normalized, '预览模式·已拦截发送');
    return;
  }

  sending = true;
  try {
    await createChatMessages([{ role: 'user', message: normalized }]);
    await triggerSlash('/trigger');
  } catch (error) {
    console.error('[红警指挥系统] 发送动作失败', error);
    toastr.error('动作发送失败，已保留当前界面状态');
  } finally {
    sending = false;
  }
}
