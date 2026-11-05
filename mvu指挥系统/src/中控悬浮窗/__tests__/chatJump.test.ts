import { afterEach, describe, expect, it, vi } from 'vitest';
import { jumpToChatFloor, toFloorIndex } from '../host/chatJump';

/** vitest 环境为 node：手工桩出宿主 window/document（getHostDocument → document，getHostWindow → document.defaultView） */
function stubHost(opts: { exec?: (t: string) => Promise<unknown>; mes?: Record<string, { scrollIntoView: () => void }> }) {
  const win: Record<string, unknown> = { frameElement: null, parent: undefined };
  if (opts.exec) win.SillyTavern = { getContext: () => ({ executeSlashCommandsWithOptions: opts.exec }) };
  const doc = {
    defaultView: win,
    querySelector: (sel: string) => {
      const m = /mesid="(\d+)"/.exec(sel);
      return (m && opts.mes?.[m[1]]) || null;
    },
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
}

describe('G6-10 · PDA 一键跳楼', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('楼号归一：12 / "12" / "#12" → 12；非法值 → undefined', () => {
    expect(toFloorIndex(12)).toBe(12);
    expect(toFloorIndex('12')).toBe(12);
    expect(toFloorIndex('#12')).toBe(12);
    expect(toFloorIndex('#--')).toBeUndefined();
    expect(toFloorIndex(-1)).toBeUndefined();
    expect(toFloorIndex(undefined)).toBeUndefined();
  });

  it('宿主可用时走 /chat-jump', async () => {
    const exec = vi.fn().mockResolvedValue(undefined);
    stubHost({ exec });
    await expect(jumpToChatFloor('#7')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('/chat-jump 7');
  });

  it('宿主不可用时退回滚动到 .mes[mesid]；无楼号不跳', async () => {
    const mes = { scrollIntoView: vi.fn() };
    stubHost({ mes: { '3': mes } });
    await expect(jumpToChatFloor(3)).resolves.toBe(true);
    expect(mes.scrollIntoView).toHaveBeenCalled();
    await expect(jumpToChatFloor('#--')).resolves.toBe(false);
    await expect(jumpToChatFloor(9)).resolves.toBe(false);
  });
});
