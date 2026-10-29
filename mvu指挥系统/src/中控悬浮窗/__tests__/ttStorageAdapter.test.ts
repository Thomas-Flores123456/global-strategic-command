/**
 * ttStorageAdapter.test.ts —— 双宿主存储适配器（ExtensionStore + LocalStorage）专项单元测试
 *
 * 覆盖：
 * 1. sanitizeExtensionStoreKey：将任意键名消毒映射为 `[A-Za-z0-9_.-]` 且不以 `.` 开头；
 * 2. 传统 SillyTavern（无 extensionStore）下 100% 退化为纯 localStorage + 内存热缓存；
 * 3. TauriTavern 宿主下同步读写内存/localStorage + 异步双写 extensionStore.setJson / deleteJson；
 * 4. hydrateFromExtensionStore(keys) 异步水合回填内存与 localStorage（支持 tryGetJson 与 listKeys）；
 * 5. getJsonAsync / setJsonAsync / flush 与异常容错降级（不崩主线程，记录错误状态）。
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createDualHostStorage,
  DEFAULT_EXTENSION_STORE_NAMESPACE,
  DEFAULT_EXTENSION_STORE_TABLE,
  sanitizeExtensionStoreKey,
  type StorageLike,
} from '../host/ttStorageAdapter';
import type { TauriTavernExtensionStoreApi } from '../host/ttHostBridge';

function createFakeLocalStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  const storage: StorageLike = {
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      map.delete(key);
    }),
  };
  return { storage, map };
}

function createFakeExtensionStore(initial: Record<string, unknown> = {}) {
  const storeMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(initial)) {
    storeMap.set(k, v);
  }

  const makeKey = (ns: string, table: string | undefined, key: string) =>
    `${ns}::${table ?? DEFAULT_EXTENSION_STORE_TABLE}::${key}`;

  const api: TauriTavernExtensionStoreApi = {
    getJson: vi.fn(async ({ namespace, table, key }) => {
      return storeMap.get(makeKey(namespace, table, key)) as never;
    }),
    tryGetJson: vi.fn(async ({ namespace, table, key }) => {
      const composite = makeKey(namespace, table, key);
      if (!storeMap.has(composite)) {
        return { found: false };
      }
      return { found: true, value: storeMap.get(composite) as never };
    }),
    setJson: vi.fn(async ({ namespace, table, key, value }) => {
      storeMap.set(makeKey(namespace, table, key), value);
    }),
    updateJson: vi.fn(async ({ namespace, table, key, value }) => {
      storeMap.set(makeKey(namespace, table, key), value);
    }),
    deleteJson: vi.fn(async ({ namespace, table, key }) => {
      storeMap.delete(makeKey(namespace, table, key));
    }),
    listKeys: vi.fn(async ({ namespace, table }) => {
      const prefix = `${namespace}::${table ?? DEFAULT_EXTENSION_STORE_TABLE}::`;
      const out: string[] = [];
      for (const k of storeMap.keys()) {
        if (k.startsWith(prefix)) {
          out.push(k.slice(prefix.length));
        }
      }
      return out;
    }),
    listTables: vi.fn(async () => [DEFAULT_EXTENSION_STORE_TABLE]),
    deleteTable: vi.fn(async () => {}),
  };

  return {
    api,
    storeMap,
    hostWindow: {
      __TAURITAVERN__: {
        abiVersion: 1,
        api: {
          extensionStore: api,
        },
      },
    },
  };
}

describe('PKG-B: sanitizeExtensionStoreKey 键名消毒契约', () => {
  it('保持合法键名原样不变，并将非法字符与前导点号映射为下划线', () => {
    expect(sanitizeExtensionStoreKey('tavernweave.floating.shell.v1')).toBe(
      'tavernweave.floating.shell.v1',
    );
    expect(sanitizeExtensionStoreKey('tavernweave.pda.state.char:01/branch#2')).toBe(
      'tavernweave.pda.state.char_01_branch_2',
    );
    expect(sanitizeExtensionStoreKey('.hidden.key')).toBe('_hidden.key');
    expect(sanitizeExtensionStoreKey('...triple.dot')).toBe('___triple.dot');
    expect(sanitizeExtensionStoreKey('中文 键名!@#')).toBe('________');
    expect(sanitizeExtensionStoreKey('')).toBe('_');
    expect(sanitizeExtensionStoreKey('   ')).toBe('_');

    const samples = [
      'tavernweave.floating.shell.v1',
      '.leading.dot',
      'scope:char/01?foo=bar',
      '...',
      '',
    ];
    for (const raw of samples) {
      const clean = sanitizeExtensionStoreKey(raw);
      expect(clean).toMatch(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/);
    }
  });
});

describe('PKG-B: createDualHostStorage 传统 SillyTavern 降级模式', () => {
  it('无 extensionStore 时 100% 退化为 localStorage + 内存热缓存', async () => {
    const { storage: local, map } = createFakeLocalStorage({
      'tavernweave.floating.shell.v1': JSON.stringify({ x: 100, y: 200, collapsed: false }),
    });

    const dual = createDualHostStorage({
      table: 'shell',
      localStorage: local,
      hostWindow: {},
    });

    expect(dual.namespace).toBe(DEFAULT_EXTENSION_STORE_NAMESPACE);
    expect(dual.table).toBe('shell');
    expect(dual.isExtensionStoreAvailable).toBe(false);

    // 首次读取从 localStorage 加载并写入热缓存
    const first = dual.getItem('tavernweave.floating.shell.v1');
    expect(first).toBe(JSON.stringify({ x: 100, y: 200, collapsed: false }));
    expect(local.getItem).toHaveBeenCalledTimes(1);

    // 二次读取直接命中内存热缓存，不再访问底层 localStorage
    const second = dual.getItem('tavernweave.floating.shell.v1');
    expect(second).toBe(first);
    expect(local.getItem).toHaveBeenCalledTimes(1);

    // 同步写入同时更新内存与 localStorage
    dual.setItem('tavernweave.floating.shell.v1', JSON.stringify({ x: 300, y: 400, collapsed: true }));
    expect(map.get('tavernweave.floating.shell.v1')).toBe(
      JSON.stringify({ x: 300, y: 400, collapsed: true }),
    );

    // 无 extensionStore 时水合返回 0
    const hydrated = await dual.hydrateFromExtensionStore(['tavernweave.floating.shell.v1']);
    expect(hydrated).toBe(0);

    // 删除同步清理内存与 localStorage
    dual.removeItem('tavernweave.floating.shell.v1');
    expect(dual.getItem('tavernweave.floating.shell.v1')).toBeNull();
    expect(map.has('tavernweave.floating.shell.v1')).toBe(false);
  });
});

describe('PKG-B: createDualHostStorage TauriTavern 双写与异步水合', () => {
  it('setItem 同步更新热缓存与 localStorage，并异步写入 extensionStore.setJson', async () => {
    const { storage: local, map } = createFakeLocalStorage();
    const { api, storeMap, hostWindow } = createFakeFakeExtEnv();

    const dual = createDualHostStorage({
      namespace: 'tavernweave-command',
      table: 'shell',
      localStorage: local,
      hostWindow,
    });

    expect(dual.isExtensionStoreAvailable).toBe(true);

    const payload = { x: 240, y: 180, collapsed: true, dock: 'right' };
    dual.setItem('tavernweave.floating.shell.v1', JSON.stringify(payload));

    // 同步立即可读
    expect(dual.getItem('tavernweave.floating.shell.v1')).toBe(JSON.stringify(payload));
    expect(map.get('tavernweave.floating.shell.v1')).toBe(JSON.stringify(payload));

    await dual.flush();

    expect(api.setJson).toHaveBeenCalledWith({
      namespace: 'tavernweave-command',
      table: 'shell',
      key: 'tavernweave.floating.shell.v1',
      value: payload,
    });
    expect(storeMap.get('tavernweave-command::shell::tavernweave.floating.shell.v1')).toEqual(
      payload,
    );

    // removeItem 同步删除并触发 extensionStore.deleteJson
    dual.removeItem('tavernweave.floating.shell.v1');
    await dual.flush();
    expect(api.deleteJson).toHaveBeenCalledWith({
      namespace: 'tavernweave-command',
      table: 'shell',
      key: 'tavernweave.floating.shell.v1',
    });
    expect(storeMap.has('tavernweave-command::shell::tavernweave.floating.shell.v1')).toBe(false);
  });

  it('hydrateFromExtensionStore 从 extensionStore 水合回填热缓存与 localStorage（含键名消毒映射）', async () => {
    const { storage: local, map } = createFakeLocalStorage();
    const { hostWindow } = createFakeExtensionStore({
      'tavernweave-command::pda::tavernweave.pda.state': {
        x: 88,
        y: 166,
        collapsed: false,
        dockSide: 'left',
      },
      'tavernweave-command::pda::tavernweave.pda.state.char_01': {
        x: 120,
        y: 220,
        collapsed: true,
        readEventIds: ['floor:1:ev1'],
      },
    });

    const dual = createDualHostStorage({
      table: 'pda',
      localStorage: local,
      hostWindow,
    });

    const count = await dual.hydrateFromExtensionStore([
      'tavernweave.pda.state',
      'tavernweave.pda.state.char:01',
      'non.existent.key',
    ]);

    expect(count).toBe(2);
    expect(JSON.parse(dual.getItem('tavernweave.pda.state')!)).toEqual({
      x: 88,
      y: 166,
      collapsed: false,
      dockSide: 'left',
    });
    expect(JSON.parse(dual.getItem('tavernweave.pda.state.char:01')!)).toEqual({
      x: 120,
      y: 220,
      collapsed: true,
      readEventIds: ['floor:1:ev1'],
    });
    // 同时已回填到底层 localStorage
    expect(map.has('tavernweave.pda.state')).toBe(true);
    expect(map.has('tavernweave.pda.state.char:01')).toBe(true);
  });

  it('getJsonAsync 与 setJsonAsync 支持结构化对象读写及默认值回退', async () => {
    const { storage: local } = createFakeLocalStorage();
    const { hostWindow } = createFakeExtensionStore();

    const dual = createDualHostStorage({
      table: 'ui-state',
      localStorage: local,
      hostWindow,
    });

    await dual.setJsonAsync('panel.filter', { tab: 'tech', onlyActive: true });
    const loaded = await dual.getJsonAsync<{ tab: string; onlyActive: boolean }>('panel.filter');
    expect(loaded).toEqual({ tab: 'tech', onlyActive: true });

    const missing = await dual.getJsonAsync('panel.missing', { fallback: true });
    expect(missing).toEqual({ fallback: true });
  });

  it('异常容错：localStorage 配额溢出或 extensionStore 异步拒绝时不崩主线程并记录状态', async () => {
    const throwingLocal: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError: localStorage disabled');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };

    const { api, hostWindow } = createFakeExtensionStore();
    api.setJson = vi.fn(async () => {
      throw new Error('IPC write failed');
    });

    const dual = createDualHostStorage({
      table: 'shell',
      localStorage: throwingLocal,
      hostWindow,
    });

    expect(() => {
      dual.setItem('k1', JSON.stringify({ ok: 1 }));
    }).not.toThrow();

    // 即使 localStorage 与 extensionStore 报错，内存热缓存依然可用
    expect(dual.getItem('k1')).toBe(JSON.stringify({ ok: 1 }));

    await dual.flush();
    const diag = dual.getDiagnostics();
    expect(diag.errorCount).toBeGreaterThan(0);
    expect(diag.lastError).toBeInstanceOf(Error);
    expect((dual.lastError as Error).message).toContain('IPC write failed');
  });
});

function createFakeFakeExtEnv() {
  return createFakeExtensionStore();
}
