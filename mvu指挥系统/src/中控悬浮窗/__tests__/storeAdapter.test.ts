/**
 * storeAdapter 测试（D-RAC-ENTRY-STORE-01 → A）：snapshot null → 归零态 / snapshot 变化 → data 跟随 /
 * 面板局部改写不污染 snapshot 且零变量写入 / in_tavern 判定与 store.ts 一致。
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import type { FloorCandidate } from '../../红警指挥系统/parse/floorScanner';
import { Schema } from '../../红警指挥系统/core/schema';
import { useFloatingStore, type FloorReader } from '../../红警指挥系统/composables/useFloatingStore';

// 变量写入 API 桩：任何一次调用都视为红线违反
const writeSpies = {
  updateVariablesWith: vi.fn(),
  replaceVariables: vi.fn(),
  insertVariables: vi.fn(),
  insertOrAssignVariables: vi.fn(),
  deleteVariable: vi.fn(),
};
Object.assign(globalThis, writeSpies);

const { in_tavern, useDataStore, emptyData } = await import('../host/storeAdapter');

const ai = (stat_data: unknown): FloorCandidate => ({ role: 'assistant', is_hidden: false, stat_data });
function readerOf(floors: FloorCandidate[]): FloorReader {
  return { lastMessageId: () => floors.length - 1, readFloor: id => floors[id] ?? null };
}

beforeEach(() => {
  setActivePinia(createPinia());
  for (const spy of Object.values(writeSpies)) spy.mockClear();
});

describe('in_tavern', () => {
  it('与 store.ts 同判定：无 window.TavernHelper → false', () => {
    expect(in_tavern).toBe(false);
  });
});

describe('data 派生', () => {
  it('snapshot 为 null → 归零态（Schema.parse({})），面板可安全读取', () => {
    const store = useDataStore();
    expect(useFloatingStore().snapshot).toBeNull();
    expect(store.data).toEqual(Schema.parse({}));
    expect(store.data).toEqual(emptyData());
    expect(store.data.bases).toEqual([]);
    expect(typeof store.data.economy.credits).toBe('number');
  });

  it('refresh 后 data 跟随 snapshot；再次 refresh 为空 → 回到归零态', async () => {
    const floating = useFloatingStore();
    const store = useDataStore();
    await floating.refresh(readerOf([ai({ schema_version: 2, meta: { location: '北坡' } })]));
    await nextTick();
    expect(store.data.meta.location).toBe('北坡');
    await floating.refresh(readerOf([{ role: 'user', is_hidden: false, stat_data: undefined }]));
    await nextTick();
    expect(floating.snapshot).toBeNull();
    expect(store.data).toEqual(Schema.parse({}));
  });
});

describe('只读红线', () => {
  it('面板局部改写（如标记情报已读）只影响本地 data，不污染 snapshot，零变量写入', async () => {
    const floating = useFloatingStore();
    const store = useDataStore();
    await floating.refresh(
      readerOf([ai({ schema_version: 2, intel: [{ src: '侦察', content: '北坡外围发现敌方侦察车', read: false }] })]),
    );
    await nextTick();
    expect(store.data.intel).toHaveLength(1);
    expect(store.data.intel[0].read).toBe(false);

    store.data.intel[0].read = true;
    store.data.intel_archived.push(store.data.intel[0]);
    expect(store.data.intel[0].read).toBe(true);
    expect(floating.snapshot?.intel[0].read).toBe(false);
    expect(floating.snapshot?.intel_archived).toHaveLength(0);

    await nextTick();
    for (const [name, spy] of Object.entries(writeSpies)) {
      expect(spy, `${name} 不得被调用`).not.toHaveBeenCalled();
    }
  });
});
