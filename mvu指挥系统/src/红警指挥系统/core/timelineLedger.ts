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
import { canon } from '../parse/parseCommon';
import { parseMessageText } from '../parse/parsePipeline';
import { forceCommission, reconcileProduction, operationCompletionsToDeclarations } from '../engines/productionReconciliation';
import { applyEngOrders } from '../engines/engOrderBridge';
import { tav } from '../parse/systemCheck';

export type FloorProcessOp =
  | {
      kind: 'COMMIT_PLANNING';
      ts: number;
      planId: string;
      optionKey?: 'A' | 'B' | string;
      approvedAtTurn?: number;
      intentSnapshot?: ParsedPlanningIntent;
      /** 历史结果快照仅保留存档形状，不覆盖重算状态；缺意图时跳过并说明 */
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
      targets?: { item: string; base?: string }[];
      /**
       * G6-07：顺延补票分钟数（resolution='defer'）。这是本楼本 swipe 的结算输入而非结果快照：
       * 重解析时累加后传给 settleFloor，经济/时钟/资金链/队列按同一时长重算。每次顺延各记一条、不去重。
       */
      extraDeltaMinutes?: number;
      /** 历史裁决结果快照仅保留存档形状；重放按目标意图重新裁决，不覆盖重算状态 */
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
    }
  | {
      /** G2-01：面板即时调度（建筑启停/生产↔加速/加速范围），重解析时按实例身份重新应用 */
      kind: 'BUILDING_DISPATCH';
      ts: number;
      /** 基地 id（缺省为基地名） */
      baseId: string;
      buildingName: string;
      /** 同名建筑在本基地内的 1-based 序号（canon 名计数） */
      instanceOrdinal: number;
      patch: BuildingDispatchPatch;
    };

export interface BuildingDispatchPatch {
  state?: '运转' | '停机';
  mode?: '生产' | '加速';
  accel_scope?: 'global' | 'base';
}

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
  // G1-01：内存兜底只属于写入它的聊天；切换聊天后不得把上一聊天的 originChatId/楼层账本带入新聊天
  const fallbackChatId = memoryLedgerFallback.originChatId;
  if (fallbackChatId) {
    const currentChatId = readCurrentHostChatId();
    if (currentChatId && currentChatId !== fallbackChatId) {
      memoryLedgerFallback = createEmptyTimelineLedger();
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
    const slot = floorRec.swipes[sKey];
    // 原文编辑不撤销用户选择；仅更新过程记录所属原文指纹。
    slot.textHash = textHash;
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

/** 原文编辑不撤销用户选择；hash 只记录当前来源，回放按意图应用。 */
export function getReplayableFloorOps(
  ledger: TimelineLedgerState,
  floorId: number,
  swipeId: number,
  _textHash: string,
): FloorProcessOp[] {
  const slot = getSwipeSlot(ledger, floorId, swipeId);
  if (!slot || !Array.isArray(slot.opLog)) return [];
  return slot.opLog;
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
    let entry: FloorProcessOp = op;
    // 同类同标识操作幂等去重更新（例如同一补丁重复点击推迟/生效，以最新裁决为准）
    if (op.kind === 'PATCH_DECISION') {
      slot.opLog = slot.opLog.filter(
        existing => !(existing.kind === 'PATCH_DECISION' && existing.patchId === op.patchId),
      );
    } else if (op.kind === 'CHRONO_RESOLVE' && op.extraDeltaMinutes === undefined) {
      // 顺延补票记录（带 extraDeltaMinutes）是累加的结算输入，不参与同 conflictId 去重
      slot.opLog = slot.opLog.filter(
        existing =>
          !(
            existing.kind === 'CHRONO_RESOLVE' &&
            existing.conflictId === op.conflictId &&
            existing.extraDeltaMinutes === undefined
          ),
      );
    } else if (op.kind === 'COMMIT_PLANNING') {
      slot.opLog = slot.opLog.filter(
        existing => !(existing.kind === 'COMMIT_PLANNING' && existing.planId === op.planId),
      );
    } else if (op.kind === 'BUILDING_DISPATCH') {
      // 同一建筑实例的调度合并为一条（后写字段胜出），反复开关不膨胀 opLog
      const sameInstance = (existing: FloorProcessOp) =>
        existing.kind === 'BUILDING_DISPATCH' &&
        existing.baseId === op.baseId &&
        canon(existing.buildingName) === canon(op.buildingName) &&
        existing.instanceOrdinal === op.instanceOrdinal;
      const prev = slot.opLog.find(sameInstance);
      if (prev?.kind === 'BUILDING_DISPATCH') {
        entry = { ...op, patch: { ...prev.patch, ...op.patch } };
      }
      slot.opLog = slot.opLog.filter(existing => !sameInstance(existing));
    }
    slot.opLog.push(klona(entry));
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

/**
 * G9-01：删中间楼后的账本重映射。移除 deletedFloor 楼（返回其全部 swipe 的 wbJournal 供逆向回滚），
 * 更高楼层的键与 floorId（含槽位与 wbJournal 记录）整体减 1，低楼保持不变。
 */
export function remapTimelineAfterMidDeletion(
  ledger: TimelineLedgerState,
  deletedFloor: number,
): { nextLedger: TimelineLedgerState; removedWbMutations: WorldbookMutationRecord[] } {
  const nextLedger = klona(ledger);
  const removed: WorldbookMutationRecord[] = [];
  const floors: Record<string, TimelineFloorRecord> = {};

  for (const [fKey, floorRec] of Object.entries(nextLedger.floors)) {
    if (floorRec.floorId < deletedFloor) {
      floors[fKey] = floorRec;
      continue;
    }
    if (floorRec.floorId === deletedFloor) {
      for (const slot of Object.values(floorRec.swipes)) {
        for (const wbRec of slot.wbJournal) {
          removed.push(wbRec);
        }
      }
      continue;
    }
    const floorId = floorRec.floorId - 1;
    floorRec.floorId = floorId;
    for (const slot of Object.values(floorRec.swipes)) {
      slot.floorId = floorId;
      for (const wbRec of slot.wbJournal) {
        wbRec.floorId = floorId;
      }
    }
    floors[makeFloorKey(floorId)] = floorRec;
  }
  nextLedger.floors = floors;

  removed.sort((a, b) => b.ts - a.ts || b.floorId - a.floorId);

  let nextMax = -1;
  for (const floorRec of Object.values(floors)) {
    if (floorRec.floorId > nextMax) nextMax = floorRec.floorId;
  }
  nextLedger.maxFloorWatermark = nextMax;

  return { nextLedger, removedWbMutations: removed };
}

/* ═══════════════ 楼层交互过程量幂等重放引擎 (`replayFloorProcessOps`) ═══════════════ */

export interface ReplayFloorOpsOptions {
  catalog?: EffectiveCatalog | null;
  floorId?: number;
  onSkip?: (op: FloorProcessOp, reason: string) => void;
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
        if (!op.intentSnapshot) {
          options?.onSkip?.(op, '旧排产记录缺少意图，不能用旧快照覆盖新结算');
          break;
        }
        const committed = commitPlanningIntent(state as unknown as StatData, op.intentSnapshot,
          options?.catalog ?? null, { forceApprove: true, floor: options?.floorId, recordProcessOp: false });
        state = committed.next as unknown as Record<string, unknown>;
        if (!committed.committed && committed.receipt.status !== 'committed') {
          options?.onSkip?.(op, committed.receipt.summary);
        }
        break;
      }

      case 'CHRONO_RESOLVE': {
        if (op.resolution !== 'force') break; // 顺延是 settleFloor 的输入，不在此重复推进。
        const targets = op.targets ?? (op.itemName ? [{ item: op.itemName }] : []);
        if (!targets.length) options?.onSkip?.(op, '旧特批记录缺少目标，保留记录但不恢复整份快照');
        for (const target of targets) {
          const applied = forceCommission(state as unknown as StatData, target);
          if (applied) state = applied.next as unknown as Record<string, unknown>;
          else options?.onSkip?.(op, `特批目标已不存在或已完成：${target.item}`);
        }
        break;
      }

      case 'SUBMIT_FIX': {
        const raw = /[<＜]\s*\/?\s*(战况|态势|选项|图鉴|初始状态|工程)/.test(op.fixedYaml)
          ? op.fixedYaml : `<${op.blockType}>\n${op.fixedYaml}\n</${op.blockType}>`;
        const fixed = parseMessageText(raw, state as unknown as StatData, {
          floorId: options?.floorId, isFirstFloor: options?.floorId === 0,
        });
        if (fixed.operationCompletions.length) {
          fixed.data = reconcileProduction(fixed.data, { found: true,
            declarations: operationCompletionsToDeclarations(fixed.data, fixed.operationCompletions), rejected: [],
          }).next;
        }
        if (fixed.engOrders.length) {
          fixed.data = applyEngOrders(fixed.data, fixed.engOrders,
            options?.catalog?.retrofits ?? [], options?.catalog?.projects ?? []).next;
        }
        state = fixed.data as unknown as Record<string, unknown>;
        break;
      }

      case 'BUILDING_DISPATCH': {
        const bases = Array.isArray(state.bases) ? (state.bases as Record<string, unknown>[]) : [];
        const baseIndex = bases.findIndex(b => isRecord(b) && (b.id || b.name) === op.baseId);
        const base = bases[baseIndex];
        if (!base || !Array.isArray(base.buildings)) {
          options?.onSkip?.(op, `建筑调度基地已不存在：${op.baseId}`);
          break;
        }
        const nameKey = canon(op.buildingName);
        let seen = 0;
        const buildings = (base.buildings as Record<string, unknown>[]).map(b => {
          if (!isRecord(b) || canon(b.name) !== nameKey) return b;
          seen += 1;
          return seen === op.instanceOrdinal ? { ...b, ...op.patch } : b;
        });
        if (seen < op.instanceOrdinal) {
          options?.onSkip?.(op, `建筑调度目标已不存在：${op.buildingName} #${op.instanceOrdinal}`);
          break;
        }
        const nextBases = [...bases];
        nextBases[baseIndex] = { ...base, buildings };
        state.bases = nextBases;
        break;
      }

      case 'PATCH_DECISION': {
        const rawPending = Array.isArray(state.pending_data_patches)
          ? (klona(state.pending_data_patches) as Record<string, unknown>[])
          : [];
        const rawApplied = Array.isArray(state.applied_data_patches)
          ? (klona(state.applied_data_patches) as Record<string, unknown>[])
          : [];

        // 精确身份跨 pending/applied 优先；仅在 ID 消失后接受唯一同目标候选。
        const exactPending = rawPending.filter(p => p && p.id === op.patchId);
        const exactApplied = rawApplied.filter(p => p && p.id === op.patchId);
        const hasExact = exactPending.length + exactApplied.length > 0;
        const pending = hasExact ? exactPending : rawPending.filter(p => op.patchTarget && p?.target === op.patchTarget);
        const completed = hasExact ? exactApplied : rawApplied.filter(p => op.patchTarget && p?.target === op.patchTarget);
        if (pending.length + completed.length > 1) {
          options?.onSkip?.(op, `补丁身份有歧义：${op.patchTarget ?? op.patchId}`);
          break;
        }
        const matched = pending[0];
        const applied = completed[0];
        if (!matched) {
          if (!applied) options?.onSkip?.(op, `补丁目标已不存在：${op.patchTarget ?? op.patchId}`);
          break;
        }
        if (op.decision === 'approve') {
          state.pending_data_patches = rawPending.filter(p => p !== matched);
          state.applied_data_patches = [...rawApplied.filter(p => p.id !== op.patchId),
            { ...matched, id: op.patchId, status: 'applied' }];
        } else if (op.decision === 'defer') {
          state.pending_data_patches = rawPending.map(p => p === matched ? { ...p, status: 'deferred' } : p);
        } else if (op.decision === 'reject') {
          state.pending_data_patches = rawPending.filter(p => p !== matched);
        }
        break;
      }
    }
  }

  return state as T;
}
