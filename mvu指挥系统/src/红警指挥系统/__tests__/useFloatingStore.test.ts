/**
 * useFloatingStore 测试（RAC-FLOAT-01）：事件驱动刷新的数据层。
 * 楼层读取全部走注入 reader；真机 getChatMessages / 事件接线属 RAC-ENTRY-01 真机边界。
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FloorCandidate } from '../parse/floorScanner';
import { SCHEMA_VERSION } from '../core/schema';
import { tavernFloorReader, useFloatingStore, type FloorReader } from '../composables/useFloatingStore';

const ai = (stat_data: unknown, is_hidden = false): FloorCandidate => ({ role: 'assistant', stat_data, is_hidden });
const user = (): FloorCandidate => ({ role: 'user', stat_data: undefined, is_hidden: false });
const validV2 = (location: string) => ({ schema_version: 2, meta: { location } });
/** exposure.value 超出 [0,10] → Schema 拒收 */
const broken = { schema_version: 2, exposure: { value: 99 } };

function readerOf(floors: (FloorCandidate | null)[]): FloorReader {
  return {
    lastMessageId: () => floors.length - 1,
    readFloor: id => floors[id] ?? null,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('初始态与暴露面', () => {
  it('未刷新前 snapshot/floorId 为 null，busy=false，schemaVersion 与 Schema 一致', () => {
    const store = useFloatingStore();
    expect(store.snapshot).toBeNull();
    expect(store.floorId).toBeNull();
    expect(store.busy).toBe(false);
    expect(store.lastError).toBeNull();
    expect(store.schemaVersion).toBe(SCHEMA_VERSION);
    expect(typeof store.refresh).toBe('function');
    expect(typeof store.onRefresh).toBe('function');
    expect(typeof store.setReader).toBe('function');
  });
});

describe('refresh 成功', () => {
  it('取最近合法 AI 楼：跳过 user 楼 / 损坏楼，snapshot 为归一数据，floorId 为来源楼号', async () => {
    const store = useFloatingStore();
    const result = await store.refresh(readerOf([ai(validV2('旧基地')), ai(validV2('北坡')), ai(broken), user()]));
    expect(result?.floorId).toBe(1);
    expect(store.floorId).toBe(1);
    expect(store.snapshot?.meta.location).toBe('北坡');
    expect(store.busy).toBe(false);
    expect(store.lastError).toBeNull();
  });

  it('setReader 注入后 refresh() 无参使用该 reader；显式 reader 参数优先', async () => {
    const store = useFloatingStore();
    store.setReader(readerOf([ai(validV2('甲'))]));
    await store.refresh();
    expect(store.snapshot?.meta.location).toBe('甲');
    await store.refresh(readerOf([ai(validV2('乙'))]));
    expect(store.snapshot?.meta.location).toBe('乙');
  });

  it('onRefresh 回调在刷新完成后收到结果，注销后不再触发；回调抛异常不影响刷新', async () => {
    const store = useFloatingStore();
    const cb = vi.fn();
    const off = store.onRefresh(cb);
    store.onRefresh(() => {
      throw new Error('listener boom');
    });
    const reader = readerOf([ai(validV2('北坡'))]);
    await store.refresh(reader);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]?.floorId).toBe(0);
    expect(store.snapshot?.meta.location).toBe('北坡');
    off();
    await store.refresh(reader);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('refresh 失败 / 无有效楼 → snapshot = null', () => {
  it('lastMessageId 抛异常：snapshot/floorId 置空，lastError 记录，busy 回落，回调收到 null', async () => {
    const store = useFloatingStore();
    await store.refresh(readerOf([ai(validV2('北坡'))]));
    expect(store.snapshot).not.toBeNull();
    const cb = vi.fn();
    store.onRefresh(cb);
    const result = await store.refresh({
      lastMessageId: () => {
        throw new Error('reader down');
      },
      readFloor: () => null,
    });
    expect(result).toBeNull();
    expect(store.snapshot).toBeNull();
    expect(store.floorId).toBeNull();
    expect(store.lastError).toBe('reader down');
    expect(store.busy).toBe(false);
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('异步 lastMessageId reject 同样降级为 null', async () => {
    const store = useFloatingStore();
    await store.refresh({ lastMessageId: () => Promise.reject(new Error('async down')), readFloor: () => null });
    expect(store.snapshot).toBeNull();
    expect(store.lastError).toBe('async down');
    expect(store.busy).toBe(false);
  });

  it('全部楼损坏 / 仅 user 楼 / 空聊天 → null 且 lastError 保持 null（非异常）', async () => {
    const store = useFloatingStore();
    await store.refresh(readerOf([ai(broken), user()]));
    expect(store.snapshot).toBeNull();
    expect(store.floorId).toBeNull();
    expect(store.lastError).toBeNull();
    await store.refresh(readerOf([]));
    expect(store.snapshot).toBeNull();
  });

  it('readFloor 逐楼抛异常由扫描器跳过，后续合法楼仍可命中', async () => {
    const store = useFloatingStore();
    const floors = [ai(validV2('后备')), ai(validV2('末楼'))];
    await store.refresh({
      lastMessageId: () => 1,
      readFloor: id => {
        if (id === 1) throw new Error('floor 1 unreadable');
        return floors[id] ?? null;
      },
    });
    expect(store.floorId).toBe(0);
    expect(store.snapshot?.meta.location).toBe('后备');
    expect(store.lastError).toBeNull();
  });

  it('成功后再失败：上一次 snapshot 被清空，不残留旧数据', async () => {
    const store = useFloatingStore();
    await store.refresh(readerOf([ai(validV2('北坡'))]));
    await store.refresh(readerOf([ai(broken)]));
    expect(store.snapshot).toBeNull();
    expect(store.floorId).toBeNull();
  });
});

describe('busy 与并发幂等', () => {
  it('刷新中 busy=true，完成后 false；并发 refresh 复用同一 Promise，reader 只调用一次', async () => {
    const store = useFloatingStore();
    let release!: (id: number) => void;
    const lastMessageId = vi.fn(() => new Promise<number>(resolve => (release = resolve)));
    const readFloor = vi.fn((id: number) => (id === 2 ? ai(validV2('并发')) : null));
    const reader: FloorReader = { lastMessageId, readFloor };
    const cb = vi.fn();
    store.onRefresh(cb);

    const p1 = store.refresh(reader);
    const p2 = store.refresh(reader);
    expect(store.busy).toBe(true);
    // pinia action 包装会对返回的 Promise 再 .then 一层，故不比 Promise 同一性；以 reader 调用次数 + 结果同引用证明复用
    expect(lastMessageId).toHaveBeenCalledTimes(1);

    release(2);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(r1?.floorId).toBe(2);
    expect(store.busy).toBe(false);
    expect(store.snapshot?.meta.location).toBe('并发');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(readFloor).toHaveBeenCalledTimes(1);
  });

  it('前一次完成后再次 refresh 是新一轮（结果可更新）', async () => {
    const store = useFloatingStore();
    await store.refresh(readerOf([ai(validV2('一'))]));
    expect(store.floorId).toBe(0);
    await store.refresh(readerOf([ai(validV2('一')), ai(validV2('二'))]));
    expect(store.floorId).toBe(1);
    expect(store.snapshot?.meta.location).toBe('二');
  });

  it('异常路径 busy 同样回落，且随后可正常刷新', async () => {
    const store = useFloatingStore();
    await store.refresh({
      lastMessageId: () => {
        throw new Error('x');
      },
      readFloor: () => null,
    });
    expect(store.busy).toBe(false);
    await store.refresh(readerOf([ai(validV2('恢复'))]));
    expect(store.snapshot?.meta.location).toBe('恢复');
    expect(store.lastError).toBeNull();
  });
});

describe('tavernFloorReader 适配（全局桩）', () => {
  it('把 getChatMessages 返回形状适配为 FloorCandidate；楼不存在 → null', () => {
    const g = globalThis as Record<string, unknown>;
    const prev = { getChatMessages: g.getChatMessages, getLastMessageId: g.getLastMessageId };
    g.getLastMessageId = () => 3;
    g.getChatMessages = (id: number) =>
      id === 3 ? [{ role: 'assistant', is_hidden: true, data: { stat_data: { schema_version: 2 } } }] : [];
    try {
      expect(tavernFloorReader.lastMessageId()).toBe(3);
      expect(tavernFloorReader.readFloor(3)).toEqual({
        role: 'assistant',
        is_hidden: true,
        stat_data: { schema_version: 2 },
      });
      expect(tavernFloorReader.readFloor(9)).toBeNull();
    } finally {
      g.getChatMessages = prev.getChatMessages;
      g.getLastMessageId = prev.getLastMessageId;
    }
  });
});
