/**
 * branchBookCloner.ts —— 聊天档案世界书逆向回滚与分支自动克隆器（17号方案A · SEAM-04）
 *
 * 核心职责：
 * 1. 入档前快照辅助：在机娘（`girlAutoFiler`）或扩展（`expansionAutoFiler`）写聊天绑定世界书前，
 *    采集目标词条的 `beforeEntry` 快照并记入 `$timeline` 的 `wbJournal`；
 * 2. 删楼 / 切 Swipe 逆向回滚（`rollbackWorldbookMutations`）：
 *    按逆序遍历 `wbJournal`，对 `op === 'create'` 的新建词条予以删除（并从花名册移除追加行），
 *    对 `op === 'update'` 的词条恢复 `beforeEntry`；
 * 3. 分支（Branch / Checkpoint）检测与专属档案书自动克隆（`ensureBranchWorldbookIsolation`）：
 *    当 `CHAT_CHANGED` 触发且检测到 `currentChatId !== $timeline.originChatId` 时，
 *    自动读取原主线档案书词条、剔除高于分叉楼层 `#B` 的词条变更、创建并绑定新分支专属世界书，
 *    彻底解决酒馆开分支后“变成空白失忆书”或“主支线共用一本书互相污染”的顽疾。
 */

import { klona } from 'klona';
import {
  chatBookGateway,
  generateArchiveBookName,
  ROSTER_ENTRY_NAME,
  type ChatBookGatewayLike,
  type WorldbookEntry,
} from './chatBookBinding';
import {
  appendWorldbookMutation,
  collectActiveWorldbookMutationsFromFloor,
  ensureSwipeSlot,
  getSwipeWorldbookMutations,
  makeFloorKey,
  pruneTimelineAboveFloor,
  readCurrentHostChatId,
  readTimelineLedger,
  writeTimelineLedger,
  type TimelineLedgerState,
  type WorldbookEntrySnapshot,
  type WorldbookMutationRecord,
} from '../core/timelineLedger';

export interface RollbackWorldbookResult {
  rolledBackCount: number;
  booksTouched: string[];
  errors: string[];
}

export interface ReapplyWorldbookResult {
  reappliedCount: number;
  booksTouched: string[];
  errors: string[];
}

export interface SwipeTransitionResult {
  switched: boolean;
  prevSwipeId: number | null;
  rolledBackCount: number;
  reappliedCount: number;
}

export function toWorldbookEntrySnapshot(entry: WorldbookEntry | WorldbookEntrySnapshot): WorldbookEntrySnapshot {
  const snap: WorldbookEntrySnapshot = {
    name: entry.name,
    content: typeof entry.content === 'string' ? entry.content : '',
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
  };
  if (typeof (entry as { comment?: unknown }).comment === 'string') {
    snap.comment = (entry as { comment: string }).comment;
  }
  if (Array.isArray(entry.keys)) {
    snap.keys = [...entry.keys];
  }
  if (entry.position && typeof entry.position === 'object' && !Array.isArray(entry.position)) {
    snap.position = klona(entry.position as NonNullable<WorldbookEntrySnapshot['position']>);
  }
  if (entry.strategy && typeof entry.strategy === 'object' && !Array.isArray(entry.strategy)) {
    snap.strategy = klona(entry.strategy as NonNullable<WorldbookEntrySnapshot['strategy']>);
  }
  if (entry.recursion && typeof entry.recursion === 'object' && !Array.isArray(entry.recursion)) {
    snap.recursion = klona(entry.recursion as NonNullable<WorldbookEntrySnapshot['recursion']>);
  }
  if (entry.extra && typeof entry.extra === 'object' && !Array.isArray(entry.extra)) {
    snap.extra = klona(entry.extra as Record<string, unknown>);
  }
  return snap;
}

function applySnapshotToEntry(base: WorldbookEntry | undefined, snap: WorldbookEntrySnapshot): WorldbookEntry {
  const next: WorldbookEntry = {
    ...(base ? klona(base) : {}),
    name: snap.name,
    content: snap.content,
    enabled: snap.enabled,
  };
  if (snap.comment !== undefined) {
    next.comment = snap.comment;
  }
  if (snap.keys !== undefined) {
    next.keys = [...snap.keys];
  }
  if (snap.position !== undefined) {
    next.position = klona(snap.position);
  }
  if (snap.strategy !== undefined) {
    next.strategy = klona(snap.strategy);
  }
  if (snap.recursion !== undefined) {
    next.recursion = klona(snap.recursion);
  }
  if (snap.extra !== undefined) {
    next.extra = klona(snap.extra);
  }
  return next;
}

function findEntryIndexWithPrefixFallback(
  entries: readonly WorldbookEntry[],
  targetName: string,
  extraExactName?: string,
): number {
  const exactIdx = entries.findIndex(
    e => e?.name === targetName || (extraExactName ? e?.name === extraExactName : false),
  );
  if (exactIdx >= 0) return exactIdx;
  if (!targetName) return -1;
  return entries.findIndex(e => typeof e?.name === 'string' && e.name.startsWith(`${targetName}·`));
}

function removeCreatedEntryWithPrefixFallback(
  entries: WorldbookEntry[],
  targetName: string,
  afterEntryName?: string,
): WorldbookEntry[] {
  const hasExact = entries.some(
    e => e?.name === targetName || (afterEntryName ? e?.name === afterEntryName : false),
  );
  if (hasExact) {
    return entries.filter(
      e => e?.name !== targetName && (!afterEntryName || e?.name !== afterEntryName),
    );
  }
  if (!targetName) return entries;
  return entries.filter(e => !(typeof e?.name === 'string' && e.name.startsWith(`${targetName}·`)));
}

function isOutOfBoundsSummaryEntry(entry: WorldbookEntry, branchMaxFloor: number): boolean {
  const label =
    typeof entry?.name === 'string' && entry.name.trim()
      ? entry.name.trim()
      : typeof (entry as { comment?: unknown })?.comment === 'string'
        ? (entry as { comment: string }).comment.trim()
        : '';
  if (!label.startsWith('摘要·')) return false;

  if (entry.extra && typeof entry.extra === 'object' && !Array.isArray(entry.extra)) {
    const extraTo = (entry.extra as Record<string, unknown>).to;
    if (typeof extraTo === 'number' && Number.isFinite(extraTo) && extraTo > branchMaxFloor) {
      return true;
    }
  }

  const rangeMatch = label.match(/^摘要·(?:大·|中·)?(\d+)-(\d+)/);
  if (rangeMatch) {
    const toFloor = Number.parseInt(rangeMatch[2], 10);
    if (Number.isFinite(toFloor) && toFloor > branchMaxFloor) {
      return true;
    }
  }

  return false;
}

/**
 * 逆向回滚一组世界书变更记录（调用方传入需回滚的记录列表，函数内部自动按时间戳从新到旧逆序执行）。
 */
export async function rollbackWorldbookMutations(
  mutations: readonly WorldbookMutationRecord[],
  gateway: ChatBookGatewayLike = chatBookGateway,
): Promise<RollbackWorldbookResult> {
  if (!Array.isArray(mutations) || mutations.length === 0) {
    return { rolledBackCount: 0, booksTouched: [], errors: [] };
  }

  // 按时间从新到旧排序，确保同一词条先更新后创建时先回退更新再回退创建
  const ordered = [...mutations].sort((a, b) => b.ts - a.ts || b.floorId - a.floorId);

  // 按书名分组批处理，减少 updateWorldbookWith I/O 次数
  const byBook = new Map<string, WorldbookMutationRecord[]>();
  for (const m of ordered) {
    const book = (m.bookName || gateway.getChatWorldbookName?.('current') || '').trim();
    if (!book) continue;
    const list = byBook.get(book) ?? [];
    list.push(m);
    byBook.set(book, list);
  }

  let rolledBackCount = 0;
  const booksTouched: string[] = [];
  const errors: string[] = [];

  for (const [bookName, records] of byBook.entries()) {
    try {
      const existingBookNames = gateway.getWorldbookNames?.() ?? [];
      if (!existingBookNames.includes(bookName)) continue;

      await gateway.updateWorldbookWith?.(bookName, entries => {
        let next = Array.isArray(entries) ? klona(entries) : [];

        for (const rec of records) {
          if (rec.op === 'create') {
            next = removeCreatedEntryWithPrefixFallback(next, rec.entryName, rec.afterEntry?.name);
          } else if (rec.op === 'update' && rec.beforeEntry) {
            const idx = findEntryIndexWithPrefixFallback(next, rec.entryName, rec.beforeEntry.name);
            if (idx >= 0) {
              next[idx] = applySnapshotToEntry(next[idx], rec.beforeEntry);
            } else {
              next.push(applySnapshotToEntry(undefined, rec.beforeEntry));
            }
          }

          if (rec.rosterLineAdded) {
            const rosterIdx = next.findIndex(e => e?.name === ROSTER_ENTRY_NAME);
            if (rosterIdx >= 0 && typeof next[rosterIdx].content === 'string') {
              const lines = next[rosterIdx].content.split(/\r?\n/);
              const filtered = lines.filter(line => line.trim() !== rec.rosterLineAdded!.trim());
              next[rosterIdx] = {
                ...next[rosterIdx],
                content: filtered.join('\n'),
              };
            }
          }

          rolledBackCount++;
        }

        return next;
      });

      booksTouched.push(bookName);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return { rolledBackCount, booksTouched, errors };
}

/**
 * 正向 Redo 重放一组世界书变更记录（按时间戳从旧到新升序执行，用于切回旧 Swipe 时恢复该 Swipe 的专属词条）。
 */
export async function reapplyWorldbookMutations(
  mutations: readonly WorldbookMutationRecord[],
  gateway: ChatBookGatewayLike = chatBookGateway,
): Promise<ReapplyWorldbookResult> {
  if (!Array.isArray(mutations) || mutations.length === 0) {
    return { reappliedCount: 0, booksTouched: [], errors: [] };
  }

  // 按时间戳从旧到新（升序）遍历
  const ordered = [...mutations].sort((a, b) => a.ts - b.ts || a.floorId - b.floorId);

  const byBook = new Map<string, WorldbookMutationRecord[]>();
  for (const m of ordered) {
    const book = (m.bookName || gateway.getChatWorldbookName?.('current') || '').trim();
    if (!book) continue;
    const list = byBook.get(book) ?? [];
    list.push(m);
    byBook.set(book, list);
  }

  let reappliedCount = 0;
  const booksTouched: string[] = [];
  const errors: string[] = [];

  for (const [bookName, records] of byBook.entries()) {
    try {
      const existingBookNames = gateway.getWorldbookNames?.() ?? [];
      if (!existingBookNames.includes(bookName)) continue;

      let touchedThisBook = false;
      await gateway.updateWorldbookWith?.(bookName, entries => {
        const next = Array.isArray(entries) ? klona(entries) : [];

        for (const rec of records) {
          let applied = false;
          if (rec.afterEntry) {
            const idx = findEntryIndexWithPrefixFallback(next, rec.entryName, rec.afterEntry.name);
            if (idx >= 0) {
              next[idx] = applySnapshotToEntry(next[idx], rec.afterEntry);
            } else {
              next.push(klona(rec.afterEntry) as WorldbookEntry);
            }
            applied = true;
          }

          if (rec.rosterLineAdded) {
            const targetLine = rec.rosterLineAdded.trim();
            if (targetLine) {
              const rosterIdx = next.findIndex(e => e?.name === ROSTER_ENTRY_NAME);
              if (rosterIdx >= 0 && typeof next[rosterIdx].content === 'string') {
                const lines = next[rosterIdx].content.split(/\r?\n/);
                const hasLine = lines.some(line => line.trim() === targetLine);
                if (!hasLine) {
                  const baseContent = next[rosterIdx].content.replace(/\s+$/, '');
                  next[rosterIdx] = {
                    ...next[rosterIdx],
                    content: baseContent ? `${baseContent}\n${rec.rosterLineAdded}` : rec.rosterLineAdded,
                  };
                }
                applied = true;
              }
            }
          }

          if (applied) {
            reappliedCount++;
            touchedThisBook = true;
          }
        }

        return next;
      });

      if (touchedThisBook) {
        booksTouched.push(bookName);
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return { reappliedCount, booksTouched, errors };
}

/**
 * Swipe 切页双向同步引擎：
 * 当检测到某楼层 activeSwipeId 切换到 newSwipeId 时：
 * 1. 自动逆向卸载旧 Swipe（及下游楼层）的世界书变更；
 * 2. 若目标新 Swipe 存有历史 afterEntry 记录，自动正向 Redo 重放回聊天世界书；
 * 3. 更新 $timeline 中该楼层的 activeSwipeId（保留所有 swipes 槽位历史不丢失）。
 */
export async function reconcileSwipeWorldbookTransition(params: {
  floorId: number;
  newSwipeId: number;
  gateway?: ChatBookGatewayLike;
}): Promise<SwipeTransitionResult> {
  const gateway = params.gateway ?? chatBookGateway;
  const ledger = readTimelineLedger();
  const fKey = makeFloorKey(params.floorId);
  const floorRec = ledger.floors[fKey];
  const prevSwipeId = floorRec ? floorRec.activeSwipeId : null;

  if (!floorRec || prevSwipeId === params.newSwipeId) {
    writeTimelineLedger(draft => {
      ensureSwipeSlot(draft, params.floorId, params.newSwipeId);
    });
    return {
      switched: false,
      prevSwipeId: prevSwipeId ?? null,
      rolledBackCount: 0,
      reappliedCount: 0,
    };
  }

  // 1. 逆向卸载旧 Swipe（及下游楼层）的世界书变更
  const mutationsToUnload = collectActiveWorldbookMutationsFromFloor(ledger, params.floorId, prevSwipeId);
  let rolledBackCount = 0;
  if (mutationsToUnload.length > 0) {
    const rbRes = await rollbackWorldbookMutations(mutationsToUnload, gateway);
    rolledBackCount = rbRes.rolledBackCount;
  }

  // 2. 读取目标新页历史变更，若存在带 afterEntry 的记录则正向 Redo 重放
  const targetSwipeMutations = getSwipeWorldbookMutations(ledger, params.floorId, params.newSwipeId);
  const mutationsToRedo = targetSwipeMutations.filter(m => Boolean(m.afterEntry));
  let reappliedCount = 0;
  if (mutationsToRedo.length > 0) {
    const reRes = await reapplyWorldbookMutations(mutationsToRedo, gateway);
    reappliedCount = reRes.reappliedCount;
  }

  // 3. 更新 $timeline 中 f_${floorId}.activeSwipeId = newSwipeId（保留各 swipes 槽位历史）
  writeTimelineLedger(draft => {
    ensureSwipeSlot(draft, params.floorId, params.newSwipeId);
    if (draft.floors[fKey]) {
      draft.floors[fKey].activeSwipeId = params.newSwipeId;
    }
  });

  return {
    switched: true,
    prevSwipeId,
    rolledBackCount,
    reappliedCount,
  };
}

/**
 * 在写入世界书前采集词条的快照，供入档成功后调用 `recordWorldbookMutationsFromDiff` 或 `captureAndRecordWorldbookMutations` 落账。
 */
export async function snapshotWorldbookEntriesBeforeWrite(
  entryNames: readonly string[],
  gateway: ChatBookGatewayLike = chatBookGateway,
): Promise<{
  bookName: string;
  snapshots: Map<string, WorldbookEntrySnapshot | null>;
  rosterContentBefore: string | null;
}> {
  const snapshots = new Map<string, WorldbookEntrySnapshot | null>();
  for (const n of entryNames) snapshots.set(n, null);

  let bookName = '';
  let rosterContentBefore: string | null = null;
  try {
    bookName = (gateway.getChatWorldbookName?.('current') ?? '').trim();
    if (bookName && (gateway.getWorldbookNames?.() ?? []).includes(bookName)) {
      const entries = (await gateway.getWorldbook?.(bookName)) ?? [];
      for (const name of entryNames) {
        const idx = findEntryIndexWithPrefixFallback(entries, name);
        const found = idx >= 0 ? entries[idx] : undefined;
        if (found) {
          snapshots.set(name, toWorldbookEntrySnapshot(found));
        }
      }
      const roster = entries.find(e => e?.name === ROSTER_ENTRY_NAME);
      if (roster && typeof roster.content === 'string') {
        rosterContentBefore = roster.content;
      }
    }
  } catch {
    /* ignore snapshot failure */
  }

  return { bookName, snapshots, rosterContentBefore };
}

/**
 * 入档成功后，对比入档前快照并将新增/更新词条记录到 `$timeline` 当前 `(floorId, swipeId)` 的 `wbJournal`。
 */
export function recordWorldbookMutationsFromDiff(params: {
  floorId: number;
  swipeId: number;
  bookName: string;
  entryNames: readonly string[];
  beforeSnapshots: Map<string, WorldbookEntrySnapshot | null>;
  afterSnapshots?: Map<string, WorldbookEntrySnapshot | null>;
  afterEntries?: readonly WorldbookEntry[];
  rosterLineAdded?: string;
}): TimelineLedgerState {
  let latest = readTimelineLedger();
  for (let i = 0; i < params.entryNames.length; i++) {
    const entryName = params.entryNames[i];
    const before = params.beforeSnapshots.get(entryName) ?? null;
    let after: WorldbookEntrySnapshot | null | undefined = undefined;
    if (params.afterSnapshots) {
      after = params.afterSnapshots.get(entryName) ?? null;
    } else if (Array.isArray(params.afterEntries)) {
      const idx = findEntryIndexWithPrefixFallback(params.afterEntries, entryName);
      after = idx >= 0 ? toWorldbookEntrySnapshot(params.afterEntries[idx]) : null;
    }
    latest = appendWorldbookMutation(params.floorId, params.swipeId, {
      bookName: params.bookName,
      entryName,
      op: before ? 'update' : 'create',
      beforeEntry: before,
      ...(after !== undefined ? { afterEntry: after } : {}),
      ...(i === 0 && params.rosterLineAdded ? { rosterLineAdded: params.rosterLineAdded } : {}),
    });
  }
  return latest;
}

/**
 * 便捷异步函数：在写入世界书成功后，自动从 `gateway.getWorldbook(bookName)` 回读 `entryNames` 的最新词条状态填入 `afterEntry`，
 * 再调用 `recordWorldbookMutationsFromDiff` 落账。
 */
export async function captureAndRecordWorldbookMutations(params: {
  floorId: number;
  swipeId: number;
  bookName: string;
  entryNames: readonly string[];
  beforeSnapshots: Map<string, WorldbookEntrySnapshot | null>;
  rosterLineAdded?: string;
  gateway?: ChatBookGatewayLike;
}): Promise<TimelineLedgerState> {
  const gateway = params.gateway ?? chatBookGateway;
  const afterSnapshots = new Map<string, WorldbookEntrySnapshot | null>();
  for (const name of params.entryNames) {
    afterSnapshots.set(name, null);
  }

  try {
    const bookName = (params.bookName || gateway.getChatWorldbookName?.('current') || '').trim();
    if (bookName) {
      const knownBooks = gateway.getWorldbookNames?.();
      if (!Array.isArray(knownBooks) || knownBooks.includes(bookName)) {
        const entries = (await gateway.getWorldbook?.(bookName)) ?? [];
        for (const name of params.entryNames) {
          const idx = findEntryIndexWithPrefixFallback(entries, name);
          if (idx >= 0 && entries[idx]) {
            afterSnapshots.set(name, toWorldbookEntrySnapshot(entries[idx]));
          }
        }
      }
    }
  } catch {
    /* ignore post-write read failure */
  }

  return recordWorldbookMutationsFromDiff({
    floorId: params.floorId,
    swipeId: params.swipeId,
    bookName: params.bookName,
    entryNames: params.entryNames,
    beforeSnapshots: params.beforeSnapshots,
    afterSnapshots,
    rosterLineAdded: params.rosterLineAdded,
  });
}

export interface BranchIsolationResult {
  branched: boolean;
  previousChatId: string;
  currentChatId: string;
  sourceBookName: string;
  clonedBookName: string;
  branchFloorWatermark: number;
  reboundExistingBook?: boolean;
}

/**
 * 从 $timeline 账本中提取当前聊天关联的档案世界书名：
 * 1. 优先取 `ledger.boundBookName`；
 * 2. 若为空，逆序扫描 `ledger.floors` 当前激活 swipe 的 `wbJournal` 中的 `bookName`；
 * 3. 若传入非空 `availableBooks`，仅返回实际存在于 `availableBooks` 中的世界书名。
 */
export function resolveChatArchiveBookFromLedger(
  ledger: TimelineLedgerState | Record<string, unknown> | null | undefined,
  availableBooks?: readonly string[],
): string {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return '';
  const hasAvailableFilter = Array.isArray(availableBooks) && availableBooks.length > 0;
  const isAvailable = (name: string) => !hasAvailableFilter || availableBooks!.includes(name);

  const direct = typeof ledger.boundBookName === 'string' ? ledger.boundBookName.trim() : '';
  if (direct && isAvailable(direct)) return direct;

  const floors = ledger.floors;
  if (floors && typeof floors === 'object' && !Array.isArray(floors)) {
    const floorList = Object.values(floors as Record<string, TimelineFloorRecord>).sort(
      (a, b) => (b?.floorId ?? 0) - (a?.floorId ?? 0),
    );
    for (const floorRec of floorList) {
      if (!floorRec || typeof floorRec !== 'object') continue;
      const activeSwipeKey = `s_${floorRec.activeSwipeId ?? 0}`;
      const swipes = floorRec.swipes ?? {};
      const activeSlot = swipes[activeSwipeKey];
      const slots = activeSlot ? [activeSlot, ...Object.values(swipes)] : Object.values(swipes);
      for (const slot of slots) {
        if (!slot || !Array.isArray(slot.wbJournal)) continue;
        for (let i = slot.wbJournal.length - 1; i >= 0; i--) {
          const bName = typeof slot.wbJournal[i]?.bookName === 'string' ? slot.wbJournal[i].bookName.trim() : '';
          if (bName && isAvailable(bName)) return bName;
        }
      }
    }
  }

  return '';
}

/**
 * 纯函数：根据原世界书词条与高于分叉楼层 `branchFloor` 的变更日志，计算克隆到新分支的词条列表。
 */
export function computeBranchClonedEntries(
  sourceEntries: readonly WorldbookEntry[],
  removedMutationsAboveBranch: readonly WorldbookMutationRecord[],
  branchMaxFloor?: number,
): WorldbookEntry[] {
  let next = klona(sourceEntries) as WorldbookEntry[];
  const ordered = [...removedMutationsAboveBranch].sort((a, b) => b.ts - a.ts || b.floorId - a.floorId);

  for (const rec of ordered) {
    if (rec.op === 'create') {
      next = removeCreatedEntryWithPrefixFallback(next, rec.entryName, rec.afterEntry?.name);
    } else if (rec.op === 'update' && rec.beforeEntry) {
      const idx = findEntryIndexWithPrefixFallback(next, rec.entryName, rec.beforeEntry.name);
      if (idx >= 0) {
        next[idx] = applySnapshotToEntry(next[idx], rec.beforeEntry);
      }
    }
    if (rec.rosterLineAdded) {
      const rosterIdx = next.findIndex(e => e?.name === ROSTER_ENTRY_NAME);
      if (rosterIdx >= 0 && typeof next[rosterIdx].content === 'string') {
        const lines = next[rosterIdx].content.split(/\r?\n/);
        next[rosterIdx] = {
          ...next[rosterIdx],
          content: lines.filter(l => l.trim() !== rec.rosterLineAdded!.trim()).join('\n'),
        };
      }
    }
  }

  if (typeof branchMaxFloor === 'number' && Number.isFinite(branchMaxFloor) && branchMaxFloor >= 0) {
    next = next.filter(e => !isOutOfBoundsSummaryEntry(e, branchMaxFloor));
  }

  return next;
}

/**
 * 分支（Branch / Checkpoint）检测与专属聊天世界书自动克隆。
 * 当检测到 `currentChatId` 与 `$timeline.originChatId` 不同（且 `$timeline.originChatId` 非空）时：
 * 1. 自动裁剪 `$timeline` 中高于当前分支最大楼层 `branchMaxFloor` 的主线记录；
 * 2. 若原主线绑定有专属档案世界书，读取其词条并逆向剥离高于 `branchMaxFloor` 的词条变更，
 *    克隆创建一本属于当前分支的独立档案世界书并完成绑定；
 * 3. 更新 `$timeline.originChatId = currentChatId` 与 `$timeline.boundBookName = clonedBookName`。
 */
export async function ensureBranchWorldbookIsolation(options: {
  currentChatId?: string;
  branchMaxFloor: number;
  gateway?: ChatBookGatewayLike;
  now?: Date;
  onBranchDetected?: (info: { fromChatId: string; toChatId: string; branchMaxFloor: number }) => void;
}): Promise<BranchIsolationResult> {
  const gateway = options.gateway ?? chatBookGateway;
  const currentChatId = (options.currentChatId ?? readCurrentHostChatId()).trim();
  const ledger = readTimelineLedger();
  const previousChatId = ledger.originChatId.trim();

  // 首次初始化：尚无 originChatId 时直接登记当前 chatId 与当前绑定书名；
  // 若宿主 getChatWorldbookName('current') 丢失但 $timeline 记有合法档案书，自动重绑恢复
  if (!previousChatId) {
    const allBooks = gateway.getWorldbookNames?.() ?? [];
    let currentBound = (gateway.getChatWorldbookName?.('current') ?? '').trim();
    const ledgerBook = resolveChatArchiveBookFromLedger(ledger, allBooks);
    let reboundExistingBook = false;
    if (!currentBound && ledgerBook) {
      try {
        await gateway.rebindChatWorldbook?.('current', ledgerBook);
        currentBound = ledgerBook;
        reboundExistingBook = true;
      } catch (e) {
        console.warn('[branchBookCloner] 首次加载恢复绑定聊天档案世界书异常:', e);
      }
    }
    if (currentChatId || currentBound) {
      writeTimelineLedger(draft => {
        if (currentChatId) draft.originChatId = currentChatId;
        if (currentBound && !draft.boundBookName) draft.boundBookName = currentBound;
        if (options.branchMaxFloor > draft.maxFloorWatermark) {
          draft.maxFloorWatermark = options.branchMaxFloor;
        }
      });
    }
    return {
      branched: false,
      previousChatId: '',
      currentChatId,
      sourceBookName: currentBound || ledgerBook,
      clonedBookName: currentBound || ledgerBook,
      branchFloorWatermark: options.branchMaxFloor,
      ...(reboundExistingBook ? { reboundExistingBook: true } : {}),
    };
  }

  // 未发生分支切换：若宿主当前未绑定聊天世界书但账本中有该聊天的档案书，自动调用 rebindChatWorldbook 恢复绑定
  if (!currentChatId || currentChatId === previousChatId) {
    const allBooks = gateway.getWorldbookNames?.() ?? [];
    let currentBound = (gateway.getChatWorldbookName?.('current') ?? '').trim();
    const ledgerBook = resolveChatArchiveBookFromLedger(ledger, allBooks);
    let reboundExistingBook = false;
    if (!currentBound && ledgerBook) {
      try {
        await gateway.rebindChatWorldbook?.('current', ledgerBook);
        currentBound = ledgerBook;
        reboundExistingBook = true;
      } catch (e) {
        console.warn('[branchBookCloner] 同聊天恢复绑定档案世界书异常:', e);
      }
    }
    const effectiveBook = currentBound || ledgerBook || ledger.boundBookName;
    if (effectiveBook && effectiveBook !== ledger.boundBookName) {
      writeTimelineLedger(draft => {
        draft.boundBookName = effectiveBook;
      });
    }
    return {
      branched: false,
      previousChatId,
      currentChatId,
      sourceBookName: effectiveBook,
      clonedBookName: effectiveBook,
      branchFloorWatermark: options.branchMaxFloor,
      ...(reboundExistingBook ? { reboundExistingBook: true } : {}),
    };
  }

  // 检测到聊天 ID 变化（说明当前聊天是从 previousChatId 分叉出的新分支聊天！）
  const { nextLedger, removedWbMutations } = pruneTimelineAboveFloor(ledger, options.branchMaxFloor);
  const sourceBookName = (ledger.boundBookName || gateway.getChatWorldbookName?.('current') || '').trim();
  let clonedBookName = '';

  try {
    const allBooks = gateway.getWorldbookNames?.() ?? [];
    if (sourceBookName && allBooks.includes(sourceBookName)) {
      const sourceEntries = (await gateway.getWorldbook?.(sourceBookName)) ?? [];
      const clonedEntries = computeBranchClonedEntries(
        sourceEntries,
        removedWbMutations,
        options.branchMaxFloor,
      );
      const charName = gateway.getCurrentCharacterName?.() || '未命名角色';
      const baseCandidate = generateArchiveBookName(charName, options.now ?? new Date());
      clonedBookName = allBooks.includes(baseCandidate) ? `${baseCandidate}_branch` : baseCandidate;
      await gateway.createWorldbook?.(clonedBookName, clonedEntries);
      await gateway.rebindChatWorldbook?.('current', clonedBookName);
    }
  } catch (e) {
    console.warn('[branchBookCloner] 分支世界书自动克隆异常:', e);
  }

  writeTimelineLedger(() => ({
    ...nextLedger,
    originChatId: currentChatId,
    boundBookName: clonedBookName || sourceBookName,
    maxFloorWatermark: options.branchMaxFloor,
  }));

  options.onBranchDetected?.({
    fromChatId: previousChatId,
    toChatId: currentChatId,
    branchMaxFloor: options.branchMaxFloor,
  });

  return {
    branched: true,
    previousChatId,
    currentChatId,
    sourceBookName,
    clonedBookName: clonedBookName || sourceBookName,
    branchFloorWatermark: options.branchMaxFloor,
  };
}
