/**
 * patchFailFingerprint.ts —— 数据补丁「失败指纹」（CTRL-PATCH-UX-01 ②）
 *
 * 问题：Auto-Apply 开着时，中控每次挂载或刷新都会对已隔离的补丁重试并打断操作。
 * 补丁的 id / timestamp 在每次重解析时都会重新生成（真机：patch_1790161718230_tdykl → patch_1790177223412_xql62，
 * 内容完全相同），所以指纹必须按内容计算：target + operation + 规范化后的 patch + reason。
 *
 * 存储：localStorage 键 rts-data-patch-fail-fp，按聊天 ID 分桶，每桶最多 FP_BUCKET_CAP 条，超出淘汰最旧。
 * 不写楼层变量，不改 schema，不新增 status 取值。
 *
 * 语义：
 * - 自动重试遇到已记录的指纹 → 跳过；
 * - 手动「应用」不查指纹；手动成功后清除该指纹，失败则刷新记录。
 */
import type { DataPatch } from '../../红警指挥系统/core/schema';
import type { StorageLike } from '../../红警指挥系统/worldbook/worldbookDataFiler';

export const FAIL_FP_KEY = 'rts-data-patch-fail-fp';
export const FP_BUCKET_CAP = 200;

export interface FailRecord {
  fp: string;
  /** 隔离时的提示文案（刷新后面板仍可展示原因） */
  msg: string;
  at: number;
}

type FailStore = Record<string, FailRecord[]>;

/** 对象键稳定排序后序列化（数组保持顺序） */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter(k => obj[k] !== undefined)
    .sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** FNV-1a 32 位，输出 8 位十六进制 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 纯函数：按内容计算补丁指纹，与 id / timestamp / status 无关 */
export function patchFingerprint(p: Pick<DataPatch, 'target' | 'operation' | 'patch' | 'reason'>): string {
  const canonical = stableStringify({
    target: String(p.target ?? '').trim(),
    operation: p.operation,
    patch: p.patch ?? null,
    reason: String(p.reason ?? '').trim(),
  });
  // 两路不同种子拼接，降低 32 位碰撞概率
  return `${fnv1a(canonical)}${fnv1a(`#${canonical.length}#${canonical}`)}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

let lastCachedStorage: StorageLike | null = null;
let lastCachedRaw: string | null | undefined = undefined;
let lastCachedStore: FailStore = {};

function load(s: StorageLike): FailStore {
  try {
    const raw = s.getItem(FAIL_FP_KEY);
    if (s === lastCachedStorage && raw === lastCachedRaw) {
      return lastCachedStore;
    }
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    const store =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as FailStore) : {};
    lastCachedStorage = s;
    lastCachedRaw = raw;
    lastCachedStore = store;
    return store;
  } catch {
    return {};
  }
}

function save(s: StorageLike, data: FailStore): void {
  try {
    const raw = JSON.stringify(data);
    s.setItem(FAIL_FP_KEY, raw);
    lastCachedStorage = s;
    lastCachedRaw = raw;
    lastCachedStore = data;
  } catch {
    /* storage full / unavailable */
  }
}

function bucketKey(chatId: string | null | undefined): string {
  return chatId ? String(chatId) : '_';
}

export function findFailRecord(
  chatId: string | null | undefined,
  fp: string,
  storage: StorageLike | null = defaultStorage(),
): FailRecord | null {
  if (!storage) return null;
  return load(storage)[bucketKey(chatId)]?.find(r => r.fp === fp) ?? null;
}

export function recordFailure(
  chatId: string | null | undefined,
  fp: string,
  msg: string,
  storage: StorageLike | null = defaultStorage(),
  now: number = Date.now(),
): void {
  if (!storage) return;
  const data = load(storage);
  const key = bucketKey(chatId);
  const list = (data[key] ?? []).filter(r => r.fp !== fp);
  list.push({ fp, msg, at: now });
  data[key] = list.slice(-FP_BUCKET_CAP);
  save(storage, data);
}

export function clearFailure(
  chatId: string | null | undefined,
  fp: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  const data = load(storage);
  const key = bucketKey(chatId);
  if (!data[key]) return;
  data[key] = data[key].filter(r => r.fp !== fp);
  if (data[key].length === 0) delete data[key];
  save(storage, data);
}

/** 自动重试判定：命中失败指纹即跳过（手动应用不调用本函数） */
export function shouldAutoRetry(
  chatId: string | null | undefined,
  p: Pick<DataPatch, 'target' | 'operation' | 'patch' | 'reason' | 'status'>,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (p.status === 'deferred') return false;
  return findFailRecord(chatId, patchFingerprint(p), storage) === null;
}

/** 读取当前聊天 ID（全局脚本 iframe 可用；失败返回 null） */
export function readCurrentChatId(): string | null {
  try {
    const id = (globalThis as { SillyTavern?: { getCurrentChatId?: () => string } }).SillyTavern?.getCurrentChatId?.();
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * 为新分支克隆源聊天的失败指纹桶（SEAM-05），确保分叉后已屏蔽的坏补丁不会重复弹窗。
 */
export function clonePatchFailFingerprints(
  fromChatId: string,
  toChatId: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  const fromKey = bucketKey(fromChatId);
  const toKey = bucketKey(toChatId);
  if (!fromChatId || !toChatId || fromKey === toKey) return;
  const data = load(storage);
  const sourceList = data[fromKey];
  if (!Array.isArray(sourceList) || sourceList.length === 0) return;

  const existing = Array.isArray(data[toKey]) ? data[toKey] : [];
  const merged = new Map<string, FailRecord>();
  for (const item of sourceList) {
    if (item && typeof item.fp === 'string') {
      merged.set(item.fp, { ...item });
    }
  }
  for (const item of existing) {
    if (item && typeof item.fp === 'string') {
      merged.set(item.fp, { ...item });
    }
  }
  data[toKey] = Array.from(merged.values()).slice(-FP_BUCKET_CAP);
  save(storage, data);
}

export const recordPatchFailure = recordFailure;
export const clearPatchFailure = clearFailure;
export const clonePatchFingerprintsForBranch = clonePatchFailFingerprints;

