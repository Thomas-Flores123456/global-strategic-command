/**
 * worldbookReader.ts —— 世界书只读封装（RAC-FLOAT-02）
 *
 * 仅调用 Helper getter `getWorldbook(name)`（@types/function/worldbook.d.ts:155），零写入。
 * 按书名记忆化：同一次刷新周期内多次点击不重复取书；`invalidate()` 由 useArchiveIndex 在
 * `useFloatingStore.onRefresh` 时调用，保证世界书内容不常驻缓存（红线：随 refresh 失效）。
 * fail-closed：API 缺失 / 抛错 / 返回非数组 → null（同样记忆化到下次 invalidate，避免反复触发宿主报错）。
 *
 * 宿主 API 经 deps 注入，默认懒取 `globalThis.getWorldbook`（模块加载不触碰宿主，node 单测可 mock）。
 */
import type { ArchiveEntryLike } from '../models/archiveIndex';
import {
  getTauriTavernBridge,
  ttHostBridge,
  type TauriTavernBridge,
  type WorldInfoActivatedEntry,
  type WorldInfoActivationBatch,
} from './ttHostBridge';

export interface WorldbookReaderDeps {
  /** 缺省 = 调用时读 globalThis.getWorldbook；显式传 undefined 视为 API 不可用 */
  getWorldbook?: (name: string) => unknown;
  /** 可选宿主窗口引用，供 TauriTavern WorldInfo 桥接使用 */
  hostWindow?: unknown;
}

export interface WorldbookReader {
  read(bookName: string): Promise<ArchiveEntryLike[] | null>;
  invalidate(): void;
  getLastActivatedEntries(): Promise<WorldInfoActivatedEntry[]>;
  subscribeActivations(
    handler: (batch: WorldInfoActivationBatch) => void,
  ): Promise<() => void>;
  openWorldbookEntry(ref: {
    world: string;
    uid: string | number;
  }): Promise<{ opened: boolean; mode: 'tauritavern' | 'unsupported' }>;
}

function resolveGetter(deps?: WorldbookReaderDeps): ((name: string) => unknown) | null {
  const fn = deps && 'getWorldbook' in deps ? deps.getWorldbook : (globalThis as Record<string, unknown>).getWorldbook;
  return typeof fn === 'function' ? (fn as (name: string) => unknown) : null;
}

function normalizeEntries(raw: unknown): ArchiveEntryLike[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ArchiveEntryLike[] = [];
  for (const e of raw) {
    if (typeof e !== 'object' || e === null) continue;
    const rec = e as Record<string, unknown>;
    if (typeof rec.name !== 'string') continue;
    out.push({
      name: rec.name,
      enabled: rec.enabled !== false,
      content: typeof rec.content === 'string' ? rec.content : '',
    });
  }
  return out;
}

export function makeWorldbookReader(deps?: WorldbookReaderDeps): WorldbookReader {
  const cache = new Map<string, Promise<ArchiveEntryLike[] | null>>();

  function resolveBridge(): TauriTavernBridge {
    return deps && 'hostWindow' in deps
      ? getTauriTavernBridge(deps.hostWindow)
      : ttHostBridge;
  }

  async function fetchBook(bookName: string): Promise<ArchiveEntryLike[] | null> {
    try {
      const getter = resolveGetter(deps);
      if (!getter) return null;
      return normalizeEntries(await getter(bookName));
    } catch {
      return null;
    }
  }

  return {
    read(bookName) {
      const hit = cache.get(bookName);
      if (hit) return hit;
      const p = fetchBook(bookName);
      cache.set(bookName, p);
      return p;
    },
    invalidate() {
      cache.clear();
    },
    async getLastActivatedEntries() {
      const worldInfo = resolveBridge().worldInfo;
      if (!worldInfo || typeof worldInfo.getLastActivation !== 'function') {
        return [];
      }
      try {
        const batch = await worldInfo.getLastActivation();
        return Array.isArray(batch?.entries) ? batch.entries : [];
      } catch {
        return [];
      }
    },
    async subscribeActivations(handler) {
      const worldInfo = resolveBridge().worldInfo;
      if (!worldInfo || typeof worldInfo.subscribeActivations !== 'function') {
        return () => {};
      }
      try {
        const unsub = await worldInfo.subscribeActivations(handler);
        if (typeof unsub === 'function') {
          return () => {
            try {
              void unsub();
            } catch {
              // Ignore unsubscribe error
            }
          };
        }
        return () => {};
      } catch {
        return () => {};
      }
    },
    async openWorldbookEntry(ref) {
      const worldInfo = resolveBridge().worldInfo;
      if (!worldInfo || typeof worldInfo.openEntry !== 'function') {
        return { opened: false, mode: 'unsupported' };
      }
      try {
        const res = await worldInfo.openEntry(ref);
        if (res && typeof res.opened === 'boolean') {
          return { opened: res.opened, mode: 'tauritavern' };
        }
        return { opened: false, mode: 'unsupported' };
      } catch {
        return { opened: false, mode: 'unsupported' };
      }
    },
  };
}
