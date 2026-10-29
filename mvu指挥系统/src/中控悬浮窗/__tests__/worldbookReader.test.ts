/**
 * worldbookReader 测试（RAC-FLOAT-02）：按书名记忆化、invalidate 后重取、API 缺失 → null、抛错 → null、
 * 非数组 / 脏条目归一化；默认懒取 globalThis.getWorldbook。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeWorldbookReader } from '../host/worldbookReader';

const G = globalThis as Record<string, unknown>;

afterEach(() => {
  delete G.getWorldbook;
});

describe('makeWorldbookReader', () => {
  it('记忆化：同书多次 read 只调用一次 getWorldbook；不同书分别取；invalidate 后重取', async () => {
    const getWorldbook = vi.fn(async (name: string) => [{ name: `科技·${name}`, enabled: true, content: 'c' }]);
    const reader = makeWorldbookReader({ getWorldbook });
    const a1 = await reader.read('A');
    const a2 = await reader.read('A');
    expect(a1).toEqual([{ name: '科技·A', enabled: true, content: 'c' }]);
    expect(a2).toBe(a1);
    expect(getWorldbook).toHaveBeenCalledTimes(1);
    await reader.read('B');
    expect(getWorldbook).toHaveBeenCalledTimes(2);
    reader.invalidate();
    await reader.read('A');
    expect(getWorldbook).toHaveBeenCalledTimes(3);
  });

  it('并发 read 同书共享同一 inflight Promise', async () => {
    const getWorldbook = vi.fn(() => new Promise(resolve => setTimeout(() => resolve([]), 5)));
    const reader = makeWorldbookReader({ getWorldbook });
    const [x, y] = await Promise.all([reader.read('A'), reader.read('A')]);
    expect(x).toBe(y);
    expect(getWorldbook).toHaveBeenCalledTimes(1);
  });

  it('API 缺失（显式 undefined 或 globalThis 无）→ null，不抛', async () => {
    expect(await makeWorldbookReader({ getWorldbook: undefined }).read('A')).toBeNull();
    expect(await makeWorldbookReader().read('A')).toBeNull();
  });

  it('getWorldbook 抛错 / reject / 返回非数组 → null；失败结果同样记忆化直到 invalidate', async () => {
    const throwing = vi.fn(() => {
      throw new Error('no such book');
    });
    const r1 = makeWorldbookReader({ getWorldbook: throwing });
    expect(await r1.read('A')).toBeNull();
    expect(await r1.read('A')).toBeNull();
    expect(throwing).toHaveBeenCalledTimes(1);
    r1.invalidate();
    await r1.read('A');
    expect(throwing).toHaveBeenCalledTimes(2);

    expect(await makeWorldbookReader({ getWorldbook: () => Promise.reject(new Error('x')) }).read('A')).toBeNull();
    expect(await makeWorldbookReader({ getWorldbook: () => ({ not: 'array' }) }).read('A')).toBeNull();
  });

  it('条目归一化：丢弃无 name 项；enabled 缺省 true；content 非字符串 → 空串', async () => {
    const reader = makeWorldbookReader({
      getWorldbook: () => [
        { name: 'ok' },
        { name: 'off', enabled: false, content: 42 },
        null,
        { content: 'no-name' },
        'str',
      ],
    });
    expect(await reader.read('A')).toEqual([
      { name: 'ok', enabled: true, content: '' },
      { name: 'off', enabled: false, content: '' },
    ]);
  });

  it('默认懒取 globalThis.getWorldbook（模块加载时不触碰宿主）', async () => {
    const reader = makeWorldbookReader();
    expect(await reader.read('A')).toBeNull();
    reader.invalidate();
    G.getWorldbook = vi.fn(async () => [{ name: '科技·A', enabled: true, content: 'late' }]);
    expect(await reader.read('A')).toEqual([{ name: '科技·A', enabled: true, content: 'late' }]);
  });
});
