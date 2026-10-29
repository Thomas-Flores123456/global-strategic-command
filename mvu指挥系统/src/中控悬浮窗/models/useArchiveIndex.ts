/**
 * useArchiveIndex.ts —— 档案页组合式函数（RAC-FLOAT-02）
 *
 * - 本楼数据来自 useFloatingStore().snapshot / floorId（只读）；
 * - "上一有效 AI 楼"用共享扫描器 `scanLatestValidFloor(floorId - 1, readFloor)` 取得（reader 可注入，
 *   默认 tavernFloorReader）；floorId 为 null 或 ≤ 0 → previous = null（本楼全部记为新增）；
 * - index = buildArchiveIndex(本楼, 上一楼) 响应式派生；
 * - 注册 floating.onRefresh：重扫上一楼 + 使世界书读取缓存失效（红线：世界书内容不常驻缓存）。
 *
 * 所有异步 / 宿主读取 fail-closed：异常 → previous null，不抛。零变量写入、零世界书写入。
 */
import { computed, getCurrentScope, onScopeDispose, shallowRef } from 'vue';
import { scanLatestValidFloor, type FloorSnapshot } from '../../红警指挥系统/parse/floorScanner';
import type { DetailData } from '../../红警指挥系统/composables/useDetail';
import { tavernFloorReader, useFloatingStore, type FloorReader } from '../../红警指挥系统/composables/useFloatingStore';
import {
  booksFor,
  buildArchiveIndex,
  loadGirlDossierDetail,
  matchArchiveEntry,
  PENDING_KIND,
  resolveActiveChatBookName,
  toDetail,
  type ArchiveIndex,
  type ArchiveItem,
  type GirlDossierDetailResult,
} from './archiveIndex';
import { makeWorldbookReader, type WorldbookReader } from '../host/worldbookReader';

export interface UseArchiveIndexOptions {
  /** 楼层读取器（测试注入）；缺省真机 tavernFloorReader */
  reader?: FloorReader;
  /** 世界书读取器（测试注入）；缺省 makeWorldbookReader() */
  worldbook?: WorldbookReader;
  /** 当前聊天绑定世界书名获取器（测试注入）；缺省读取 getChatWorldbookName('current') */
  chatBook?: () => string | null;
}

export function useArchiveIndex(options: UseArchiveIndexOptions = {}) {
  const floating = useFloatingStore();
  const reader = options.reader ?? tavernFloorReader;
  const worldbook = options.worldbook ?? makeWorldbookReader();
  const previous = shallowRef<FloorSnapshot | null>(null);

  function getChatBook(): string | null {
    return resolveActiveChatBookName(options.chatBook ? options.chatBook() : undefined);
  }

  function scanPrevious() {
    const id = floating.floorId;
    if (id === null || !Number.isInteger(id) || id <= 0) {
      previous.value = null;
      return;
    }
    try {
      previous.value = scanLatestValidFloor(id - 1, i => reader.readFloor(i));
    } catch {
      previous.value = null;
    }
  }

  const index = computed<ArchiveIndex>(() =>
    buildArchiveIndex(floating.snapshot ?? null, previous.value?.data ?? null),
  );

  /** 按条目（含聊天绑定世界书）返回世界书查询序列 */
  function booksForItem(item: Pick<ArchiveItem, 'kind' | 'source'> | 'girl' | 'codex'): string[] {
    return booksFor(item, getChatBook());
  }

  /** 读取机娘跨世界书（含聊天绑定书）完整双段详情 */
  async function loadGirlDetail(name: string): Promise<GirlDossierDetailResult> {
    return loadGirlDossierDetail(name, {
      reader: { read: async book => (await worldbook.read(book)) ?? [] },
      chatBook: getChatBook(),
    });
  }

  /** 解析任意 ArchiveItem 的抽屉详情（机娘/人员自动合并 档案· 与 剧情· 双条目） */
  async function resolveItemDetail(item: ArchiveItem): Promise<DetailData> {
    if (item.source === 'pending_lore' || item.kind === PENDING_KIND || item.kind === '人员') {
      const girlRes = await loadGirlDetail(item.name);
      if (girlRes.dossierEntry || girlRes.storyEntry) {
        return toDetail(item, girlRes.dossierEntry, girlRes.book ?? undefined, girlRes.storyEntry);
      }
    }
    for (const book of booksForItem(item)) {
      const entries = await worldbook.read(book);
      const hit = matchArchiveEntry(entries ?? [], item);
      if (hit) return toDetail(item, hit, book);
    }
    return toDetail(item, null);
  }

  scanPrevious();
  const off = floating.onRefresh(() => {
    scanPrevious();
    worldbook.invalidate();
  });
  if (getCurrentScope()) onScopeDispose(off);

  return {
    floating,
    previous,
    index,
    worldbook,
    booksForItem,
    loadGirlDetail,
    resolveItemDetail,
    stop: off,
  };
}
