/**
 * timelineLedger.ts —— 全量时间线账本与楼层交互过程量重放引擎（17号方案A · SEAM-01 / SEAM-02）
 *
 * 核心职责：
 * 1. 维护聊天变量 `$timeline`（所有楼层/Swipe 键强制使用 `f_${mid}` / `s_${swipe}` 字符串前缀，严防 Lodash 稀疏数组陷阱）；
 * 2. 持久记录玩家在每层生成后的 4 类非 Raw 交互过程量（排产批准、时序冲突裁决、YAML 修复、数据补丁裁决）；
 * 3. 在 `runParseFor` 重跑（编辑、切回旧 Swipe、下游级联重算）时，通过 `replayFloorProcessOps` 按序幂等重放玩家交互过程量；
 * 4. 维护每层 `(floorId, swipeId)` 的聊天档案世界书变更逆向日志 `wbJournal`，支撑删楼/切 Swipe 回滚与分支克隆裁剪。
 */

import { klona } from 'klona';
import type { EffectiveCatalog } from './catalogEffective';
import type { ParsedPlanningIntent } from '../planning/planningParser';
import { commitPlanningIntent } from '../planning/planningReceipt';
import type { DataPatch, StatData } from './schema';
import { tav } from '../parse/systemCheck';

export type FloorProcessOp =
  | {
      kind: 'COMMIT_PLANNING';
      ts: number;
      planId: string;
      optionKey?: 'A' | 'B' | string;
      approvedAtTurn?: number;
      intentSnapshot?: ParsedPlanningIntent;
      /** 兜底快照：当无完整 intentSnapshot 时按字段幂等恢复 */
      queuesSnapshot?: unknown[];
      creditsAfter?: number;
      planningSnapshot?: Record<string, unknown>;
    }
  | {
      kind: 'CHRONO_RESOLVE';
      ts: number;
      conflictId: string;
      resolution: 'defer' | 'force';
      itemName?: string;
      /** 裁决后的队列与基地/兵力局部快照，确保重算后 100% 幂等还原 */
      queuesSnapshot?: unknown[];
      basesSnapshot?: unknown[];
      forcesSnapshot?: Record<string, unknown>;
    }
  | {
      kind: 'SUBMIT_FIX';
      ts: number;
      blockType: string;
      fixedYaml: string;
      fixedStatSnapshot?: Record<string, unknown>;
    }
  | {
      kind: 'PATCH_DECISION';
      ts: number;
      patchId: string;
      patchTarget?: string;
      decision: 'approve' | 'defer' | 'reject';
      patchSnapshot?: DataPatch | Record<string, unknown>;
    };

export interface WorldbookEntrySnapshot {
  name: string;
  comment?: string;
  content: string;
  enabled: boolean;
  keys?: string[];
  position?: { type?: string; order?: number; depth?: number; role?: string | number; [k: string]: unknown };
  strategy?: { type?: string; keys?: (string | RegExp)[]; [k: string]: unknown };
  recursion?: { prevent_incoming?: boolean; prevent_outgoing?: boolean; delay_until?: number | null; [k: string]: unknown };
  extra?: Record<string, unknown>;
}

export interface WorldbookMutationRecord {
  ts: number;
  floorId: number;
  swipeId: number;
  bookName: string;
  entryName: string;
  op: 'create' | 'update';
  beforeEntry: WorldbookEntrySnapshot | null;
  afterEntry?: WorldbookEntrySnapshot | null;
  rosterLineAdded?: string;
}

export interface TimelineSwipeSlot {
  floorId: number;
  swipeId: number;
  textHash: string;
  opLog: FloorProcessOp[];
  wbJournal: WorldbookMutationRecord[];
  updatedAt: number;
}

export interface TimelineFloorRecord {
  floorId: number;
  activeSwipeId: number;
  swipes: Record<string, TimelineSwipeSlot>; // key: `s_${swipeId}`
}

export interface TimelineLedgerState {
  version: 1;
  originChatId: string;
  boundBookName: string;
  maxFloorWatermark: number;
  floors: Record<string, TimelineFloorRecord>; // key: `f_${floorId}`
}

/* ═══════════════ 键名编码与双因子隔离工具（防 Lodash 数字键数组化） ═══════════════ */

export function makeFloorKey(floorId: number): string {
  const safe = Number.isFinite(floorId) ? Math.max(0, Math.trunc(floorId)) : 0;
  return `f_${safe}`;
}

export function makeSwipeKey(swipeId: number): string {
  const safe = Number.isFinite(swipeId) ? Math.max(0, Math.trunc(swipeId)) : 0;
  return `s_${safe}`;
}

export function makeSwipeScopedKey(floorId: number, swipeId: number): string {
  return `${makeFloorKey(floorId)}__${makeSwipeKey(swipeId)}`;
}

export function parseSwipeScopedKey(key: string): { floorId: number; swipeId: number | null } | null {
  if (typeof key !== 'string' || !key.trim()) return null;
  const scopedMatch = key.match(/^f_(\d+)__s_(\d+)$/);
  if (scopedMatch) {
    return {
      floorId: Number.parseInt(scopedMatch[1], 10),
      swipeId: Number.parseInt(scopedMatch[2], 10),
    };
  }
  const floorPrefixMatch = key.match(/^f_(\d+)$/);
  if (floorPrefixMatch) {
    return {
      floorId: Number.parseInt(floorPrefixMatch[1], 10),
      swipeId: null,
    };
  }
  if (/^\d+$/.test(key)) {
    return {
      floorId: Number.parseInt(key, 10),
      swipeId: null,
    };
  }
  return null;
}

/* ═══════════════ 账本初始化、归一化与宿主读写 ═══════════════ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function readCurrentHostChatId(): string {
  try {
    const st = (globalThis as { SillyTavern?: { getCurrentChatId?: () => string } }).SillyTavern;
    const id = st?.getCurrentChatId?.();
    if (typeof id === 'string' && id.trim()) return id.trim();
  } catch {
    /* ignore */
  }
  const getChatName = tav<() => string>('getCurrentChatName');
  if (getChatName) {
    try {
      const name = getChatName();
      if (typeof name === 'string' && name.trim()) return name.trim();
    } catch {
      /* ignore */
    }
  }
  return '';
}

export function createEmptyTimelineLedger(originChatId = '', boundBookName = ''): TimelineLedgerState {
  return {
    version: 1,
    originChatId,
    boundBookName,
    maxFloorWatermark: -1,
    floors: {},
  };
}

export function sanitizeWorldbookEntrySnapshot(raw: unknown): WorldbookEntrySnapshot | null {
  if (!isRecord(raw) || typeof raw.name !== 'string') return null;
  const snap: WorldbookEntrySnapshot = {
    name: raw.name,
    content: typeof raw.content === 'string' ? raw.content : '',
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
  };
  if (typeof raw.comment === 'string') {
    snap.comment = raw.comment;
  }
  if (Array.isArray(raw.keys)) {
    snap.keys = raw.keys.map(k => String(k));
  }
  if (isRecord(raw.position)) {
    snap.position = klona(raw.position);
  }
  if (isRecord(raw.strategy)) {
    snap.strategy = klona(raw.strategy);
  }
  if (isRecord(raw.recursion)) {
    snap.recursion = klona(raw.recursion);
  }
  if (isRecord(raw.extra)) {
    snap.extra = klona(raw.extra);
  }
  return snap;
}

export function sanitizeWbJournal(
  raw: unknown,
  defaultFloorId = 0,
  defaultSwipeId = 0,
): WorldbookMutationRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: WorldbookMutationRecord[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const entryName = typeof item.entryName === 'string' ? item.entryName : '';
    if (!entryName) continue;
    const op = item.op === 'update' ? 'update' : 'create';
    const rec: WorldbookMutationRecord = {
      ts: typeof item.ts === 'number' && Number.isFinite(item.ts) ? item.ts : Date.now(),
      floorId:
        typeof item.floorId === 'number' && Number.isFinite(item.floorId)
          ? Math.trunc(item.floorId)
          : defaultFloorId,
      swipeId:
        typeof item.swipeId === 'number' && Number.isFinite(item.swipeId)
          ? Math.max(0, Math.trunc(item.swipeId))
          : defaultSwipeId,
      bookName: typeof item.bookName === 'string' ? item.bookName : '',
      entryName,
      op,
      beforeEntry: sanitizeWorldbookEntrySnapshot(item.beforeEntry),
    };
    if (item.afterEntry !== undefined) {
      rec.afterEntry = sanitizeWorldbookEntrySnapshot(item.afterEntry);
    }
    if (typeof item.rosterLineAdded === 'string' && item.rosterLineAdded) {
      rec.rosterLineAdded = item.rosterLineAdded;
    }
    out.push(rec);
  }
  return out;
}

export function normalizeTimelineLedger(raw: unknown): TimelineLedgerState {
  if (!isRecord(raw)) {
    return createEmptyTimelineLedger(readCurrentHostChatId(), '');
  }
  const originChatId = typeof raw.originChatId === 'string' ? raw.originChatId : '';
  const boundBookName = typeof raw.boundBookName === 'string' ? raw.boundBookName : '';
  const maxFloorWatermark =
    typeof raw.maxFloorWatermark === 'number' && Number.isFinite(raw.maxFloorWatermark)
      ? Math.trunc(raw.maxFloorWatermark)
      : -1;

  const floors: Record<string, TimelineFloorRecord> = {};
  if (isRecord(raw.floors)) {
    for (const [fKey, fVal] of Object.entries(raw.floors)) {
      if (!isRecord(fVal)) continue;
      const parsedFloor = parseSwipeScopedKey(fKey);
      const floorId =
        typeof fVal.floorId === 'number' && Number.isFinite(fVal.floorId)
          ? Math.trunc(fVal.floorId)
          : parsedFloor?.floorId ?? 0;
      const canonicalFKey = makeFloorKey(floorId);
      const activeSwipeId =
        typeof fVal.activeSwipeId === 'number' && Number.isFinite(fVal.activeSwipeId)
          ? Math.max(0, Math.trunc(fVal.activeSwipeId))
          : 0;

      const swipes: Record<string, TimelineSwipeSlot> = {};
      if (isRecord(fVal.swipes)) {
        for (const [sKey, sVal] of Object.entries(fVal.swipes)) {
          if (!isRecord(sVal)) continue;
          const sMatch = sKey.match(/^s_(\d+)$/) ?? sKey.match(/^(\d+)$/);
          const swipeId =
            typeof sVal.swipeId === 'number' && Number.isFinite(sVal.swipeId)
              ? Math.max(0, Math.trunc(sVal.swipeId))
              : sMatch
                ? Number.parseInt(sMatch[1], 10)
                : 0;
          const canonicalSKey = makeSwipeKey(swipeId);
          swipes[canonicalSKey] = {
            floorId,
            swipeId,
            textHash: typeof sVal.textHash === 'string' ? sVal.textHash : '',
            opLog: Array.isArray(sVal.opLog) ? (klona(sVal.opLog) as FloorProcessOp[]) : [],
            wbJournal: sanitizeWbJournal(sVal.wbJournal, floorId, swipeId),
            updatedAt: typeof sVal.updatedAt === 'number' ? sVal.updatedAt : Date.now(),
          };
        }
      }

      floors[canonicalFKey] = {
        floorId,
        activeSwipeId,
        swipes,
      };
    }
  }

  return {
    version: 1,
    originChatId,
    boundBookName,
    maxFloorWatermark,
    floors,
  };
}

let memoryLedgerFallback: TimelineLedgerState = createEmptyTimelineLedger();

export function resetMemoryTimelineLedgerForTest(): void {
  memoryLedgerFallback = createEmptyTimelineLedger();
}

export function readTimelineLedger(): TimelineLedgerState {
  const gv = tav<(o: { type: string }) => Record<string, unknown>>('getVariables');
  if (gv) {
    try {
      const chatVars = gv({ type: 'chat' }) ?? {};
      if (chatVars.$timeline !== undefined) {
        const normalized = normalizeTimelineLedger(chatVars.$timeline);
        memoryLedgerFallback = normalized;
        return klona(normalized);
      }
    } catch {
      /* fallback to memory */
    }
  }
  return klona(memoryLedgerFallback);
}

export function writeTimelineLedger(
  updater: (draft: TimelineLedgerState) => TimelineLedgerState | void,
): TimelineLedgerState {
  const current = readTimelineLedger();
  const draft = klona(current);
  const maybeNext = updater(draft);
  const next = normalizeTimelineLedger(maybeNext ?? draft);
  memoryLedgerFallback = klona(next);

  const uv = tav<(fn: (v: Record<string, unknown>) => Record<string, unknown>, o: { type: string }) => void>(
    'updateVariablesWith',
  );
  if (uv) {
    try {
      uv(
        vars => {
          vars.$timeline = klona(next);
          return vars;
        },
        { type: 'chat' },
      );
      return klona(next);
    } catch {
      /* fallback to insertOrAssignVariables */
    }
  }

  const ia = tav<(v: Record<string, unknown>, o: { type: string }) => void>('insertOrAssignVariables');
  if (ia) {
    try {
      ia({ $timeline: klona(next) }, { type: 'chat' });
    } catch {
      /* ignore */
    }
  }

  return klona(next);
}

/* ═══════════════ 槽位确保、过程量追加与世界书日志记录 ═══════════════ */

export function ensureSwipeSlot(
  ledger: TimelineLedgerState,
  floorId: number,
  swipeId: number,
  textHash = '',
): TimelineSwipeSlot {
  const fKey = makeFloorKey(floorId);
  const sKey = makeSwipeKey(swipeId);
  if (!ledger.floors[fKey]) {
    ledger.floors[fKey] = {
      floorId,
      activeSwipeId: swipeId,
      swipes: {},
    };
  }
  const floorRec = ledger.floors[fKey];
  floorRec.activeSwipeId = swipeId;
  if (floorId > ledger.maxFloorWatermark) {
    ledger.maxFloorWatermark = floorId;
  }
  if (!floorRec.swipes[sKey]) {
    floorRec.swipes[sKey] = {
      floorId,
      swipeId,
      textHash,
      opLog: [],
      wbJournal: [],
      updatedAt: Date.now(),
    };
  } else if (textHash) {
    floorRec.swipes[sKey].textHash = textHash;
  }
  return floorRec.swipes[sKey];
}

export function getSwipeSlot(
  ledger: TimelineLedgerState,
  floorId: number,
  swipeId: number,
): TimelineSwipeSlot | undefined {
  return ledger.floors[makeFloorKey(floorId)]?.swipes[makeSwipeKey(swipeId)];
}

export function getSwipeWorldbookMutations(
  ledger: TimelineLedgerState,
  floorId: number,
  swipeId: number,
): WorldbookMutationRecord[] {
  const slot = getSwipeSlot(ledger, floorId, swipeId);
  if (!slot || !Array.isArray(slot.wbJournal)) return [];
  return klona(slot.wbJournal);
}

/**
 * 收集 floorId === fromFloorId 的指定 (fromSwipeId ?? floor.activeSwipeId) 的 wbJournal，
 * 以及所有 floorId > fromFloorId 的楼层当前 activeSwipeId 的 wbJournal。
 * 用于在 fromFloorId 发生 Swipe 切换时，一并逆向卸载旧 Swipe 及其下游派生的世界书变更，但不从 ledger 中删除历史记录。
 */
export function collectActiveWorldbookMutationsFromFloor(
  ledger: TimelineLedgerState,
  fromFloorId: number,
  fromSwipeId?: number,
): WorldbookMutationRecord[] {
  const collected: WorldbookMutationRecord[] = [];
  for (const floorRec of Object.values(ledger.floors)) {
    if (!floorRec || floorRec.floorId < fromFloorId) continue;
    const targetSwipeId =
      floorRec.floorId === fromFloorId && typeof fromSwipeId === 'number' && Number.isFinite(fromSwipeId)
        ? Math.max(0, Math.trunc(fromSwipeId))
        : floorRec.activeSwipeId;
    const slot = floorRec.swipes[makeSwipeKey(targetSwipeId)];
    if (slot && Array.isArray(slot.wbJournal)) {
      for (const wbRec of slot.wbJournal) {
        collected.push(klona(wbRec));
      }
    }
  }
  collected.sort((a, b) => b.ts - a.ts || b.floorId - a.floorId);
  return collected;
}

export function appendFloorProcessOp(
  floorId: number,
  swipeId: number,
  op: FloorProcessOp,
  textHash = '',
): TimelineLedgerState {
  return writeTimelineLedger(ledger => {
    if (!ledger.originChatId) {
      ledger.originChatId = readCurrentHostChatId();
    }
    const slot = ensureSwipeSlot(ledger, floorId, swipeId, textHash);
    // 同类同标识操作幂等去重更新（例如同一补丁重复点击推迟/生效，以最新裁决为准）
    if (op.kind === 'PATCH_DECISION') {
      slot.opLog = slot.opLog.filter(
        existing => !(existing.kind === 'PATCH_DECISION' && existing.patchId === op.patchId),
      );
    } else if (op.kind === 'CHRONO_RESOLVE') {
      slot.opLog = slot.opLog.filter(
        existing => !(existing.kind === 'CHRONO_RESOLVE' && existing.conflictId === op.conflictId),
      );
    } else if (op.kind === 'COMMIT_PLANNING') {
      slot.opLog = slot.opLog.filter(
        existing => !(existing.kind === 'COMMIT_PLANNING' && existing.planId === op.planId),
      );
    }
    slot.opLog.push(klona(op));
    slot.updatedAt = Date.now();
  });
}

export function appendWorldbookMutation(
  floorId: number,
  swipeId: number,
  record: Omit<WorldbookMutationRecord, 'ts' | 'floorId' | 'swipeId'> & { ts?: number },
): TimelineLedgerState {
  return writeTimelineLedger(ledger => {
    if (!ledger.originChatId) {
      ledger.originChatId = readCurrentHostChatId();
    }
    if (record.bookName && !ledger.boundBookName) {
      ledger.boundBookName = record.bookName;
    }
    const slot = ensureSwipeSlot(ledger, floorId, swipeId);
    slot.wbJournal.push({
      ts: record.ts ?? Date.now(),
      floorId,
      swipeId,
      bookName: record.bookName,
      entryName: record.entryName,
      op: record.op,
      beforeEntry: record.beforeEntry ? klona(record.beforeEntry) : null,
      ...(record.afterEntry !== undefined
        ? { afterEntry: record.afterEntry ? klona(record.afterEntry) : null }
        : {}),
      ...(record.rosterLineAdded ? { rosterLineAdded: record.rosterLineAdded } : {}),
    });
    slot.updatedAt = Date.now();
  });
}

/**
 * 裁剪高于 maxFloor 的所有楼层记录，并按时间逆序返回被裁剪楼层的世界书变更记录（供逆向回滚世界书使用）。
 */
export function pruneTimelineAboveFloor(
  ledger: TimelineLedgerState,
  maxFloor: number,
): { nextLedger: TimelineLedgerState; removedWbMutations: WorldbookMutationRecord[] } {
  const nextLedger = klona(ledger);
  const removed: WorldbookMutationRecord[] = [];

  for (const [fKey, floorRec] of Object.entries(nextLedger.floors)) {
    if (floorRec.floorId > maxFloor) {
      for (const slot of Object.values(floorRec.swipes)) {
        for (const wbRec of slot.wbJournal) {
          removed.push(klona(wbRec));
        }
      }
      delete nextLedger.floors[fKey];
    }
  }

  removed.sort((a, b) => b.ts - a.ts || b.floorId - a.floorId);

  let nextMax = -1;
  for (const floorRec of Object.values(nextLedger.floors)) {
    if (floorRec.floorId > nextMax) nextMax = floorRec.floorId;
  }
  nextLedger.maxFloorWatermark = nextMax;

  return { nextLedger, removedWbMutations: removed };
}

/* ═══════════════ 楼层交互过程量幂等重放引擎 (`replayFloorProcessOps`) ═══════════════ */

export interface ReplayFloorOpsOptions {
  catalog?: EffectiveCatalog | null;
  floorId?: number;
}

/**
 * 在 `parseMessageText` 从 Raw 原文算出基础状态 `baseStatData` 后，
 * 按序幂等重放本楼 `(floorId, swipeId)` 槽位记录的玩家交互过程量（排产批准、时序裁决、YAML修复、数据补丁裁决）。
 */
export function replayFloorProcessOps<T extends Record<string, unknown>>(
  baseStatData: T,
  opLog: readonly FloorProcessOp[],
  options?: ReplayFloorOpsOptions,
): T {
  if (!Array.isArray(opLog) || opLog.length === 0) {
    return baseStatData;
  }
  let state = klona(baseStatData) as Record<string, unknown>;

  for (const op of opLog) {
    if (!op || typeof op !== 'object') continue;

    switch (op.kind) {
      case 'COMMIT_PLANNING': {
        if (op.intentSnapshot) {
          try {
            const committed = commitPlanningIntent(
              state as unknown as StatData,
              op.intentSnapshot,
              options?.catalog ?? null,
              {
                forceApprove: true,
                floor: options?.floorId,
              },
            );
            state = committed.next as unknown as Record<string, unknown>;
            break;
          } catch {
            /* fallback to snapshot fields below */
          }
        }
        if (Array.isArray(op.queuesSnapshot)) {
          state.queues = klona(op.queuesSnapshot);
        }
        if (typeof op.creditsAfter === 'number' && isRecord(state.economy)) {
          state.economy = { ...state.economy, credits: op.creditsAfter };
        }
        if (isRecord(op.planningSnapshot)) {
          state.planning = klona(op.planningSnapshot);
        }
        break;
      }

      case 'CHRONO_RESOLVE': {
        if (Array.isArray(op.queuesSnapshot)) {
          state.queues = klona(op.queuesSnapshot);
        }
        if (Array.isArray(op.basesSnapshot)) {
          state.bases = klona(op.basesSnapshot);
        }
        if (isRecord(op.forcesSnapshot)) {
          state.forces = klona(op.forcesSnapshot);
        }
        break;
      }

      case 'SUBMIT_FIX': {
        if (isRecord(op.fixedStatSnapshot)) {
          state = klona(op.fixedStatSnapshot);
        }
        break;
      }

      case 'PATCH_DECISION': {
        const rawPending = Array.isArray(state.pending_data_patches)
          ? (klona(state.pending_data_patches) as Record<string, unknown>[])
          : [];
        const rawApplied = Array.isArray(state.applied_data_patches)
          ? (klona(state.applied_data_patches) as Record<string, unknown>[])
          : [];

        if (op.decision === 'approve') {
          const matched = rawPending.find(p => p && p.id === op.patchId);
          state.pending_data_patches = rawPending.filter(p => !p || p.id !== op.patchId);
          const patchToApply = op.patchSnapshot
            ? (klona(op.patchSnapshot) as Record<string, unknown>)
            : matched
              ? { ...matched, status: 'applied' }
              : null;
          if (patchToApply) {
            const patchId = String(patchToApply.id ?? op.patchId);
            const filteredApplied = rawApplied.filter(p => !p || String(p.id ?? '') !== patchId);
            filteredApplied.push({ ...patchToApply, id: patchId, status: 'applied' });
            state.applied_data_patches = filteredApplied;
          }
        } else if (op.decision === 'defer') {
          state.pending_data_patches = rawPending.map(p =>
            p && p.id === op.patchId ? { ...p, status: 'deferred' } : p,
          );
        } else if (op.decision === 'reject') {
          state.pending_data_patches = rawPending.filter(p => !p || p.id !== op.patchId);
        }
        break;
      }
    }
  }

  return state as T;
}
