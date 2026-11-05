/**
 * G6-10：PDA 事件/通知一键跳转到来源楼层。
 *
 * 楼层号即宿主 chat 下标（0 起，与 `.mes[mesid]` 一致）。优先走宿主 `/chat-jump`（会补载被懒加载折叠的旧楼），
 * 宿主不可用时退回在宿主文档里直接滚动到 `.mes[mesid]`。
 */
import { getHostDocument, getHostWindow } from './modalHost';

type SlashExec = (text: string, options?: Record<string, unknown>) => Promise<unknown>;

/** 把事件里的各种楼层写法（12 / '12' / '#12'）归一为非负整数楼号；无法识别返回 undefined。 */
export function toFloorIndex(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const text = String(raw).trim().replace(/^#/, '');
  if (!/^\d+$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

export async function jumpToChatFloor(raw: unknown): Promise<boolean> {
  const floor = toFloorIndex(raw);
  if (floor === undefined) return false;

  const hostWin = getHostWindow() as (Window & { SillyTavern?: { getContext?: () => Record<string, unknown> } }) | null;
  const ctx = hostWin?.SillyTavern?.getContext?.();
  const exec = (ctx?.executeSlashCommandsWithOptions ?? ctx?.executeSlashCommands) as SlashExec | undefined;
  if (typeof exec === 'function') {
    try {
      await exec(`/chat-jump ${floor}`);
      return true;
    } catch {
      /* 落到 DOM 滚动 */
    }
  }

  const el = getHostDocument()?.querySelector(`#chat .mes[mesid="${floor}"]`) as HTMLElement | null;
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}
