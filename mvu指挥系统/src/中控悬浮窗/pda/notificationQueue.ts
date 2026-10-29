/**
 * notificationQueue.ts —— 战地手持板（PDA）严重度通知队列与溢出截断算法
 *
 * 实施任务包：PDA-CAPSULE-01（修复 UX-06 多事件并发刷屏，单楼层最多弹出 5 条 + +N 溢出提示）
 */

import { isGirlDossierEntry } from '../../红警指挥系统/worldbook/girlFiler';
import type { Schema } from '../../红警指挥系统/core/schema';
import type { PdaTabId } from './pdaState';

export type PdaEventLevel = 'critical' | 'warn' | 'info';
export type PdaEventFilter = 'all' | PdaEventLevel;

export interface PdaEventItem {
  id: string;
  level?: PdaEventLevel | 'alert' | 'warning';
  severity?: PdaEventLevel | 'alert' | 'warning';
  verb?: string;
  type?: string;
  category?: string;
  title?: string;
  summary?: string;
  message?: string;
  desc?: string;
  content?: string;
  floor?: number | string;
  floorId?: number | string;
  time?: string;
  timestamp?: string;
  date?: string;
  targetTab?: PdaTabId;
  read?: boolean;
}

export const MAX_FLOOR_NOTIFICATIONS = 5;

export type PdaNotificationSeverity = 'critical' | 'warning' | 'info';

export interface NotificationEvent extends Partial<PdaEventItem> {
  id: string;
  sourceFloor?: number;
  floor?: number;
  [k: string]: unknown;
}

export interface NotificationQueueResult<T extends PdaEventItem = PdaEventItem> {
  visible: T[];
  overflowCount: number;
  totalUnread: number;
  highestSeverity: PdaNotificationSeverity | null;
}

const SEVERITY_WEIGHT: Record<PdaNotificationSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

/**
 * 归一化事件严重度为 'critical' | 'warning' | 'info'
 */
export function normalizeNotificationSeverity(raw?: string | null): PdaNotificationSeverity {
  if (!raw || typeof raw !== 'string') return 'info';
  const lower = raw.trim().toLowerCase();
  if (lower === 'critical' || lower === 'alert' || lower === 'danger' || lower === 'error') {
    return 'critical';
  }
  if (lower === 'warning' || lower === 'warn') {
    return 'warning';
  }
  return 'info';
}

/**
 * 构建战地通知队列：
 * 1. 过滤未读事件（!readIds.has(e.id)）；
 * 2. 按严重度 critical > warning > info 稳定排序；
 * 3. 截断前 cap 条（默认 MAX_FLOOR_NOTIFICATIONS = 5），计算溢出数量与最高严重度。
 */
export function buildNotificationQueue<T extends PdaEventItem = PdaEventItem>(
  events: readonly T[],
  readIds: ReadonlySet<string> | Iterable<string> = new Set<string>(),
  cap: number = MAX_FLOOR_NOTIFICATIONS,
): NotificationQueueResult<T> {
  if (!Array.isArray(events) || events.length === 0) {
    return {
      visible: [],
      overflowCount: 0,
      totalUnread: 0,
      highestSeverity: null,
    };
  }

  const readSet: ReadonlySet<string> =
    readIds instanceof Set ? readIds : new Set<string>(readIds ? Array.from(readIds) : []);

  const unreadWithIndex = events
    .filter(e => Boolean(e && typeof e.id === 'string' && e.id.length > 0 && !readSet.has(e.id) && e.read !== true))
    .map((item, index) => ({
      item,
      index,
      severity: normalizeNotificationSeverity(item.level ?? item.severity),
    }));

  unreadWithIndex.sort((a, b) => {
    const weightDiff = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
    if (weightDiff !== 0) return weightDiff;
    return a.index - b.index;
  });

  const safeCap = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : MAX_FLOOR_NOTIFICATIONS;
  const sortedItems = unreadWithIndex.map(entry => entry.item);
  const visible = sortedItems.slice(0, safeCap);
  const totalUnread = sortedItems.length;
  const overflowCount = Math.max(0, totalUnread - visible.length);
  const highestSeverity: PdaNotificationSeverity | null =
    unreadWithIndex.length > 0 ? unreadWithIndex[0].severity : null;

  return {
    visible,
    overflowCount,
    totalUnread,
    highestSeverity,
  };
}

/**
 * 过滤掉高于 maxFloor 的高楼层通知（`sourceFloor !== undefined && sourceFloor > maxFloor`）
 */
export function pruneNotificationsAboveFloor<T extends NotificationEvent = NotificationEvent>(
  queue: readonly T[],
  maxFloor: number,
): T[] {
  if (!Array.isArray(queue)) return [];
  return queue.filter(item => {
    if (!item || typeof item !== 'object') return false;
    if (typeof item.sourceFloor === 'number' && Number.isFinite(item.sourceFloor)) {
      return item.sourceFloor <= maxFloor;
    }
    if (typeof item.floor === 'number' && Number.isFinite(item.floor)) {
      return item.floor <= maxFloor;
    }
    return true;
  });
}

/**
 * 从真实 stat_data 快照（资金链异动、暂存新势力、战区情报）派生战地动态事件列表（唯一真源）
 */
export function derivePdaEventsFromSnapshot(
  snap?: (Partial<Schema> & { events?: PdaEventItem[] }) | null,
): PdaEventItem[] {
  if (!snap) return [];
  if (Array.isArray(snap.events)) {
    return snap.events;
  }
  const out: PdaEventItem[] = [];
  const chains = snap.economy?.chains ?? [];
  for (const chain of chains) {
    if (!chain || typeof chain !== 'object') continue;
    const reason = (chain.reason ?? '').trim();
    const isOutage = reason.includes('断供') || reason.includes('停产');
    if (chain.status === 'active' && !isOutage && !reason) continue;
    const level: PdaEventLevel =
      chain.status === 'broken' || chain.status === 'exhausted' || chain.eff === 0 || isOutage
        ? 'critical'
        : chain.status === 'distressed'
          ? 'warn'
          : 'info';
    const verb = isOutage ? '工况异常' : '资金链变动';
    const effPct = Math.round((chain.eff ?? 1) * 100);
    out.push({
      id: `evt-chain-${chain.id || chain.name}-${chain.status}-${effPct}-${chain.updated_at_day ?? 0}-${reason}`,
      level,
      verb,
      title: chain.name,
      summary:
        reason ||
        `${chain.flow}链条状态：${chain.status}（${chain.rate_daily} CR/天，效率 ${effPct}%）`,
      time: chain.updated_at_day ? `第${chain.updated_at_day}天` : undefined,
      targetTab: 'chains',
    });
  }

  const pending = snap.pending_lore ?? [];
  for (const raw of pending) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    if (isGirlDossierEntry(raw)) continue;
    const rec = raw as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    if (!name) continue;
    const kind = typeof rec.kind === 'string' && rec.kind.trim() ? rec.kind.trim() : '实体';
    const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : `evt-lore-${name}`;
    out.push({
      id,
      level: 'info',
      verb: kind === '势力' ? '势力接触' : '情报暂存',
      title: `新探明${kind}：${name}`,
      summary: (typeof rec.summary === 'string' && rec.summary) || '新实体情报已进入待收录列表。',
      floor: typeof rec.source_floor === 'number' && rec.source_floor >= 0 ? rec.source_floor : undefined,
      targetTab: 'intel',
    });
  }

  const intelList = snap.intel ?? [];
  for (const item of intelList) {
    if (!item || typeof item.content !== 'string') continue;
    const content = item.content.trim();
    if (!content) continue;
    out.push({
      id: `evt-intel-${item.src || 'intel'}-${item.title || ''}-${content}`,
      level: 'info',
      verb: '情报获取',
      title: `${item.src || '前线侦察'}情报`,
      summary: item.content,
      time: item.date || undefined,
      targetTab: 'intel',
      read: Boolean(item.read),
    });
  }

  return out;
}


