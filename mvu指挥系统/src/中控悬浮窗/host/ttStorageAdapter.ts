/**
 * ttStorageAdapter.ts —— TauriTavern `ExtensionStore` + 传统 `localStorage` 双宿主持久化网关
 *
 * 架构文档：docs/Architecture/TaruiTavern/README.md
 * 实施任务包：docs/Architecture/Future Developments/30-TauriTavern宿主适配与专属开发脚手架实施任务包.md (PKG-B §3.2)
 *
 * 核心职责：
 * 1. 保持完整同步 `StorageLike` 接口（`getItem` / `setItem` / `removeItem`），零侵入兼容 `shell.ts` 与 `pdaState.ts`；
 * 2. 同步读优先走内存热缓存，未命中时回退至 `localStorage`；
 * 3. 在 TauriTavern 宿主下（存在 `api.extensionStore`），写入时同步更新热缓存与 `localStorage`，
 *    并后台异步调用 `extensionStore.setJson({ namespace, table, key })` 落盘，天然接入 TT-Sync 多端同步；
 * 4. 启动时支持 `hydrateFromExtensionStore(keys)` 从 `extensionStore.tryGetJson` 异步水合回填；
 * 5. 提供 `sanitizeExtensionStoreKey` 将任意 localStorage 键名合规映射为 `[A-Za-z0-9_.-]` 且不以 `.` 开头。
 */

import { getTauriTavernBridge, type TauriTavernExtensionStoreApi } from './ttHostBridge';

export const DEFAULT_EXTENSION_STORE_NAMESPACE = 'tavernweave-command';
export const DEFAULT_EXTENSION_STORE_TABLE = 'ui-state';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface DualHostStorageOptions {
  namespace?: string;
  table?: string;
  localStorage?: StorageLike | null;
  hostWindow?: unknown;
}

export interface DualHostStorageDiagnostics {
  namespace: string;
  table: string;
  hasExtensionStore: boolean;
  cachedKeyCount: number;
  pendingWriteCount: number;
  writeCount: number;
  errorCount: number;
  lastError: unknown;
}

export interface DualHostStorage extends StorageLike {
  readonly namespace: string;
  readonly table: string;
  readonly isExtensionStoreAvailable: boolean;
  readonly lastError: unknown;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  hydrateFromExtensionStore(keys?: string[]): Promise<number>;
  getJsonAsync<T = unknown>(key: string, fallback?: T): Promise<T | undefined>;
  setJsonAsync<T = unknown>(key: string, value: T): Promise<void>;
  flush(): Promise<void>;
  getDiagnostics(): DualHostStorageDiagnostics;
}

/**
 * TauriTavern `extensionStore` 的 key 仅允许 `[A-Za-z0-9_.-]` 且不能以 `.` 开头。
 * 将任意 localStorage key 消毒映射为合规的 extensionStore key。
 */
export function sanitizeExtensionStoreKey(rawKey: string): string {
  if (typeof rawKey !== 'string') return '_';
  const trimmed = rawKey.trim();
  if (!trimmed) return '_';
  const sanitized = trimmed
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .replace(/^\.+/, match => '_'.repeat(match.length));
  return sanitized.length > 0 ? sanitized : '_';
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function resolveDefaultLocalStorage(hostWindow?: unknown): StorageLike | null {
  try {
    if (hostWindow && typeof hostWindow === 'object' && 'localStorage' in hostWindow) {
      const candidate = (hostWindow as { localStorage?: StorageLike | null }).localStorage;
      if (candidate && typeof candidate.getItem === 'function') {
        return candidate;
      }
    }
  } catch {
    // 忽略跨域或隐私沙箱限制
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // 忽略隐私模式限制
  }

  return null;
}

function normalizeOptions(
  optionsOrNamespace?: DualHostStorageOptions | string,
  tableArg?: string,
  localStorageArg?: StorageLike | null,
): Required<Pick<DualHostStorageOptions, 'namespace' | 'table'>> & {
  localStorage: StorageLike | null;
  hostWindow: unknown;
} {
  if (typeof optionsOrNamespace === 'string') {
    return {
      namespace: optionsOrNamespace.trim() || DEFAULT_EXTENSION_STORE_NAMESPACE,
      table: (tableArg && tableArg.trim()) || DEFAULT_EXTENSION_STORE_TABLE,
      localStorage:
        localStorageArg !== undefined ? localStorageArg : resolveDefaultLocalStorage(undefined),
      hostWindow: undefined,
    };
  }

  const opts = optionsOrNamespace ?? {};
  const hasExplicitLocalStorage = Object.prototype.hasOwnProperty.call(opts, 'localStorage');
  return {
    namespace: (opts.namespace && opts.namespace.trim()) || DEFAULT_EXTENSION_STORE_NAMESPACE,
    table: (opts.table && opts.table.trim()) || DEFAULT_EXTENSION_STORE_TABLE,
    localStorage: hasExplicitLocalStorage
      ? (opts.localStorage ?? null)
      : resolveDefaultLocalStorage(opts.hostWindow),
    hostWindow: opts.hostWindow,
  };
}

/**
 * 创建双宿主存储适配器：
 * - 在 TauriTavern 下：内存缓存 + `localStorage` + `api.extensionStore` 异步持久化与水合；
 * - 在传统 SillyTavern 下：100% 退化为内存缓存 + `localStorage`，零异常、零额外开销。
 */
export function createDualHostStorage(
  optionsOrNamespace?: DualHostStorageOptions | string,
  tableArg?: string,
  localStorageArg?: StorageLike | null,
): DualHostStorage {
  const { namespace, table, localStorage: backingStorage, hostWindow } = normalizeOptions(
    optionsOrNamespace,
    tableArg,
    localStorageArg,
  );

  const memoryCache = new Map<string, string>();
  const pendingTasks = new Set<Promise<unknown>>();
  let writeCount = 0;
  let errorCount = 0;
  let lastError: unknown = null;

  function getExtensionStore(): TauriTavernExtensionStoreApi | null {
    try {
      return getTauriTavernBridge(hostWindow).extensionStore;
    } catch (err) {
      lastError = err;
      errorCount += 1;
      return null;
    }
  }

  function trackTask<T>(promise: Promise<T>): Promise<T> {
    const tracked = promise
      .catch(err => {
        lastError = err;
        errorCount += 1;
        return undefined as unknown as T;
      })
      .finally(() => {
        pendingTasks.delete(tracked);
      });
    pendingTasks.add(tracked);
    return tracked;
  }

  function getItem(key: string): string | null {
    if (memoryCache.has(key)) {
      return memoryCache.get(key) ?? null;
    }
    if (!backingStorage) return null;
    try {
      const val = backingStorage.getItem(key);
      if (typeof val === 'string') {
        memoryCache.set(key, val);
        return val;
      }
      return null;
    } catch (err) {
      lastError = err;
      errorCount += 1;
      return null;
    }
  }

  function setItem(key: string, value: string): void {
    const strValue = String(value);
    memoryCache.set(key, strValue);

    if (backingStorage) {
      try {
        backingStorage.setItem(key, strValue);
      } catch (err) {
        lastError = err;
        errorCount += 1;
      }
    }

    const extStore = getExtensionStore();
    if (extStore && typeof extStore.setJson === 'function') {
      const storeKey = sanitizeExtensionStoreKey(key);
      const jsonPayload = tryParseJson(strValue);
      writeCount += 1;
      try {
        const p = Promise.resolve(
          extStore.setJson({
            namespace,
            table,
            key: storeKey,
            value: jsonPayload,
          }),
        );
        void trackTask(p);
      } catch (err) {
        lastError = err;
        errorCount += 1;
      }
    }
  }

  function removeItem(key: string): void {
    memoryCache.delete(key);

    if (backingStorage && typeof backingStorage.removeItem === 'function') {
      try {
        backingStorage.removeItem(key);
      } catch (err) {
        lastError = err;
        errorCount += 1;
      }
    }

    const extStore = getExtensionStore();
    if (extStore && typeof extStore.deleteJson === 'function') {
      const storeKey = sanitizeExtensionStoreKey(key);
      try {
        const p = Promise.resolve(
          extStore.deleteJson({
            namespace,
            table,
            key: storeKey,
          }),
        );
        void trackTask(p);
      } catch (err) {
        lastError = err;
        errorCount += 1;
      }
    }
  }

  async function hydrateFromExtensionStore(keys?: string[]): Promise<number> {
    const extStore = getExtensionStore();
    if (!extStore) return 0;

    const task = (async () => {
      let targetKeys: string[] = [];
      if (Array.isArray(keys) && keys.length > 0) {
        targetKeys = keys.filter(k => typeof k === 'string' && k.trim().length > 0);
      } else if (typeof extStore.listKeys === 'function') {
        try {
          const listed = await extStore.listKeys({ namespace, table });
          if (Array.isArray(listed)) {
            targetKeys = listed.filter(k => typeof k === 'string' && k.trim().length > 0);
          }
        } catch (err) {
          lastError = err;
          errorCount += 1;
          return 0;
        }
      }

      let hydrated = 0;
      for (const rawKey of targetKeys) {
        const storeKey = sanitizeExtensionStoreKey(rawKey);
        try {
          let found = false;
          let value: unknown;

          if (typeof extStore.tryGetJson === 'function') {
            const res = await extStore.tryGetJson({
              namespace,
              table,
              key: storeKey,
            });
            if (res && res.found && res.value !== undefined) {
              found = true;
              value = res.value;
            }
          } else if (typeof extStore.getJson === 'function') {
            const val = await extStore.getJson({
              namespace,
              table,
              key: storeKey,
            });
            if (val !== undefined && val !== null) {
              found = true;
              value = val;
            }
          }

          if (found && value !== undefined) {
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);
            memoryCache.set(rawKey, serialized);
            if (backingStorage) {
              try {
                backingStorage.setItem(rawKey, serialized);
              } catch (err) {
                lastError = err;
                errorCount += 1;
              }
            }
            hydrated += 1;
          }
        } catch (err) {
          lastError = err;
          errorCount += 1;
        }
      }

      return hydrated;
    })();

    const result = await trackTask(task);
    return typeof result === 'number' ? result : 0;
  }

  async function getJsonAsync<T = unknown>(key: string, fallback?: T): Promise<T | undefined> {
    const extStore = getExtensionStore();
    if (extStore) {
      const storeKey = sanitizeExtensionStoreKey(key);
      try {
        if (typeof extStore.tryGetJson === 'function') {
          const res = await extStore.tryGetJson<T>({ namespace, table, key: storeKey });
          if (res && res.found && res.value !== undefined) {
            const serialized =
              typeof res.value === 'string' ? res.value : JSON.stringify(res.value);
            memoryCache.set(key, serialized);
            if (backingStorage) {
              try {
                backingStorage.setItem(key, serialized);
              } catch {
                /* ignore backing storage error */
              }
            }
            return res.value;
          }
        } else if (typeof extStore.getJson === 'function') {
          const val = await extStore.getJson<T>({ namespace, table, key: storeKey });
          if (val !== undefined && val !== null) {
            const serialized = typeof val === 'string' ? val : JSON.stringify(val);
            memoryCache.set(key, serialized);
            return val;
          }
        }
      } catch (err) {
        lastError = err;
        errorCount += 1;
      }
    }

    const raw = getItem(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return (raw as unknown as T) ?? fallback;
    }
  }

  async function setJsonAsync<T = unknown>(key: string, value: T): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    memoryCache.set(key, serialized);

    if (backingStorage) {
      try {
        backingStorage.setItem(key, serialized);
      } catch (err) {
        lastError = err;
        errorCount += 1;
      }
    }

    const extStore = getExtensionStore();
    if (extStore && typeof extStore.setJson === 'function') {
      const storeKey = sanitizeExtensionStoreKey(key);
      writeCount += 1;
      try {
        await trackTask(
          Promise.resolve(
            extStore.setJson({
              namespace,
              table,
              key: storeKey,
              value,
            }),
          ),
        );
      } catch (err) {
        lastError = err;
        errorCount += 1;
      }
    }
  }

  async function flush(): Promise<void> {
    while (pendingTasks.size > 0) {
      const snapshot = Array.from(pendingTasks);
      await Promise.allSettled(snapshot);
    }
  }

  function getDiagnostics(): DualHostStorageDiagnostics {
    return {
      namespace,
      table,
      hasExtensionStore: getExtensionStore() !== null,
      cachedKeyCount: memoryCache.size,
      pendingWriteCount: pendingTasks.size,
      writeCount,
      errorCount,
      lastError,
    };
  }

  return {
    namespace,
    table,
    get isExtensionStoreAvailable() {
      return getExtensionStore() !== null;
    },
    get lastError() {
      return lastError;
    },
    getItem,
    setItem,
    removeItem,
    hydrateFromExtensionStore,
    getJsonAsync,
    setJsonAsync,
    flush,
    getDiagnostics,
  };
}
