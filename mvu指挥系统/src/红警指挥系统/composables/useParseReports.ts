import { reactive } from 'vue';
import {
  makeSwipeScopedKey,
  parseSwipeScopedKey,
  pruneTimelineAboveFloor,
  readTimelineLedger,
  writeTimelineLedger,
  type TimelineLedgerState,
} from '../core/timelineLedger';
import type { VerdictRecord } from '../engines/productionReconciliation';
import type { ParseEvent, QuarantineItem } from '../parse/parsePipeline';
import { tav, type CheckIssue } from '../parse/systemCheck';
import { computeBranchClonedEntries, rollbackWorldbookMutations } from '../worldbook/branchBookCloner';
import { chatBookGateway, makeCanonicalBookName } from '../worldbook/chatBookBinding';
import {
  apis,
  ensureChatBookGatewayMethods,
  FALLBACK_ROSTER_MARK,
  normalizeParseRoot,
  type GetVariables,
  type UpdateVariablesWith,
} from './useParseAuthority';

/* ═══════════════ 状态 ═══════════════ */

/**
 * 报告流水条目（内存态为会话权威；CTRL-UI-AUDIT-01 起瘦身档经 $parse.reports 跨会话持久，
 * 恢复档为纯审计视图：undoable=false、事件无 before/after/align——撤销与「记为别名」仅会话内可用）
 */
export interface ParseReport {
  message_id: number;
  time: string;
  applied: boolean;
  events: ParseEvent[];
  issues: CheckIssue[];
  quarantineCount: number;
  /** 有🟡入库时记录入库前的本楼 stat_data（undefined = 入库前本楼无 stat_data） */
  undoable: boolean;
  undoBaseline?: unknown;
  undone?: boolean;
  /** MESSAGE_EDITED 非最新楼重解析：下游楼层可能失真 */
  downstreamWarning?: boolean;
  note?: string;
  /** CTRL-UI-AUDIT-01：本条对应 $parse.reports 持久化档的 ISO 时间指纹（恢复去重；未落档的纯内存条目无此字段） */
  persistedAt?: string;
}

/** CHRONO 冲突暂存（内存态，本会话有效）：最近一次完成解析楼的 OVERRUN 裁决记录（CTRL-UI-CHRONO-01） */
export interface ChronoStash {
  message_id: number;
  /** 暂存时聊天 ID（动作写前复核防漂移；null = 读不到，跳过复核） */
  chatId: string | null;
  verdicts: VerdictRecord[];
  at: string;
}

export const parseState = reactive({
  reports: [] as ParseReport[],
  /** 隔离区：楼号(字符串键) → 未决项列表（$parse.quarantine 读入 + 内存合并） */
  quarantine: {} as Record<string, QuarantineItem[]>,
  busy: false,
  /** $parse.quarantine 是否已从真机读入过 */
  loaded: false,
  /** 最新解析楼的 OVERRUN 冲突暂存；无冲突/未解析 → null（横幅据此显隐） */
  chrono: null as ChronoStash | null,
});

export const MAX_REPORTS = 50;
export const MAX_LOG = 30;
/** 批 C：$parse.issues 楼号键数上限（对齐 MAX_LOG=30／MAX_PERSISTED_REPORTS=30 截最近口径，按楼号数值裁最旧） */
export const MAX_ISSUES_FLOORS = 30;
/** loadIssues 追加「历史告警」占位行时的 note 标记（loadReports 竞态升级识别用；CTRL-UI-AUDIT-01） */
export const ISSUES_STUB_NOTE = '历史告警（$parse 恢复）';

export function pushReport(r: ParseReport): void {
  parseState.reports.unshift(r);
  if (parseState.reports.length > MAX_REPORTS) parseState.reports.length = MAX_REPORTS;
}

export interface ParseLogEntry {
  message_id: number;
  time: string;
  applied: boolean;
  green: number;
  yellow: number;
  quarantine: number;
  note?: string;
}

/* ═══════════════ CTRL-UI-AUDIT-01：报告流水跨会话持久化（$parse.reports 瘦身档） ═══════════════
 * 容量自律（实现裁量，收工报告登记）：
 * - 条数上限 MAX_PERSISTED_REPORTS=30：对齐 log 的 MAX_LOG=30 截最近口径，滚动入账；
 * - 单条事件上限 MAX_PERSISTED_REPORT_EVENTS=20：slice(-20) 截最近——对账/结算事件在事件序尾部，优先保住；
 * - 单条消息上限 MAX_PERSISTED_EVENT_MESSAGE=300 字符：防御性截长，防异常长报文灌爆聊天变量；
 * - 字段瘦身：事件仅留 light/layer/message/path（before/after/snippet/align 一律不落档）；
 *   issues 不重复落档（已由 $parse.issues 按楼留档，恢复时经 loadIssues 补挂）；
 *   undoBaseline 永不落档（撤销仅会话内有效，恢复档 undoable=false）。 */
export const MAX_PERSISTED_REPORTS = 30;
export const MAX_PERSISTED_REPORT_EVENTS = 20;
export const MAX_PERSISTED_EVENT_MESSAGE = 300;

/** 持久化档事件（瘦身口径见上；恢复档为纯审计视图） */
export interface PersistedReportEvent {
  light: '🟢' | '🟡';
  layer: ParseEvent['layer'];
  message: string;
  path?: string;
}
/** $parse.reports 条目；time（ISO）兼作恢复去重指纹（内存档 persistedAt 同源） */
export interface PersistedReport {
  message_id: number;
  time: string;
  applied: boolean;
  events: PersistedReportEvent[];
  quarantineCount: number;
  note?: string;
  downstreamWarning?: boolean;
}

const PERSISTED_LAYERS: ReadonlySet<string> = new Set(['L0', 'L1', 'L2', 'merge', 'instruction']);

/** 事件瘦身（纯函数）：字段裁剪 + 消息截长 */
function toPersistedEvent(e: ParseEvent): PersistedReportEvent {
  const out: PersistedReportEvent = {
    light: e.light === '🟡' ? '🟡' : '🟢',
    layer: e.layer,
    message: String(e.message ?? '').slice(0, MAX_PERSISTED_EVENT_MESSAGE),
  };
  if (typeof e.path === 'string' && e.path) out.path = e.path;
  return out;
}

/** 内存报告 + ISO 时间 → 持久化瘦身档（纯函数，可独立测试） */
export function toPersistedReport(r: ParseReport, isoTime: string): PersistedReport {
  const out: PersistedReport = {
    message_id: r.message_id,
    time: isoTime,
    applied: r.applied === true,
    events: r.events.slice(-MAX_PERSISTED_REPORT_EVENTS).map(toPersistedEvent),
    quarantineCount:
      typeof r.quarantineCount === 'number' && Number.isFinite(r.quarantineCount)
        ? Math.max(0, Math.floor(r.quarantineCount))
        : 0,
  };
  if (typeof r.note === 'string' && r.note) out.note = r.note;
  if (r.downstreamWarning === true) out.downstreamWarning = true;
  return out;
}

/**
 * $parse.reports 读侧归一（仿 normalizeParseRoot 对 issues 的项级校验先例）：
 * 脏项丢弃（非对象/楼号非负整数/time 缺失）、事件逐项形状校验后再瘦身、条数截 MAX_PERSISTED_REPORTS。
 */
export function normalizePersistedReports(src: unknown): PersistedReport[] {
  if (!Array.isArray(src)) return [];
  const out: PersistedReport[] = [];
  for (const it of src) {
    if (!_.isPlainObject(it)) continue;
    const r = it as Record<string, unknown>;
    const mid = r.message_id;
    if (typeof mid !== 'number' || !Number.isInteger(mid) || mid < 0) continue;
    if (typeof r.time !== 'string' || !r.time) continue;
    const events: PersistedReportEvent[] = [];
    if (Array.isArray(r.events)) {
      for (const e of r.events as unknown[]) {
        if (!_.isPlainObject(e)) continue;
        const ev = e as ParseEvent;
        if (ev.light !== '🟢' && ev.light !== '🟡') continue;
        if (typeof ev.layer !== 'string' || !PERSISTED_LAYERS.has(ev.layer)) continue;
        if (typeof ev.message !== 'string') continue;
        events.push(toPersistedEvent(ev));
      }
    }
    const item: PersistedReport = {
      message_id: mid,
      time: r.time,
      applied: r.applied === true,
      events: events.slice(-MAX_PERSISTED_REPORT_EVENTS),
      quarantineCount:
        typeof r.quarantineCount === 'number' && Number.isFinite(r.quarantineCount)
          ? Math.max(0, Math.floor(r.quarantineCount))
          : 0,
    };
    if (typeof r.note === 'string' && r.note) item.note = r.note;
    if (r.downstreamWarning === true) item.downstreamWarning = true;
    out.push(item);
  }
  return out.slice(0, MAX_PERSISTED_REPORTS);
}

/**
 * 批 C：$parse.issues 楼号键裁汰（纯函数，可独立测试）。
 * 键按楼号数值截最近 MAX_ISSUES_FLOORS 个；无法归一为非负整数的脏键视为最旧、优先裁汰。
 * 读侧（normalizeParseRoot/loadIssues）不裁，仅写侧 persistParse 留档后调用（滚动收敛口径）。
 */
export function capIssuesFloors(issues: Record<string, CheckIssue[]>): Record<string, CheckIssue[]> {
  const keys = Object.keys(issues);
  if (keys.length <= MAX_ISSUES_FLOORS) return issues;
  const floorOf = (k: string): number => {
    const parsed = parseSwipeScopedKey(k);
    return parsed ? parsed.floorId : -Infinity;
  };
  const keep = new Set([...keys].sort((a, b) => floorOf(b) - floorOf(a)).slice(0, MAX_ISSUES_FLOORS));
  const out: Record<string, CheckIssue[]> = {};
  for (const k of keys) if (keep.has(k)) out[k] = issues[k];
  return out;
}

/** 写 $parse：done hash + log 追加（截最近 30 条）+ 本楼隔离覆盖（先清旧再写新）+ 本楼告警覆盖（空则删键＋楼号键超帽裁最旧）+ 报告瘦身档滚动入账（可选） */
export async function persistParse(
  uvw: UpdateVariablesWith,
  message_id: number,
  hash: string | null,
  swipe_id: number,
  logEntry: ParseLogEntry,
  quarantine: QuarantineItem[],
  issues: CheckIssue[],
  /** CTRL-UI-AUDIT-01：本次解析的报告瘦身档；提供则滚动入 $parse.reports（截最近 MAX_PERSISTED_REPORTS 条） */
  report?: PersistedReport,
): Promise<void> {
  await uvw(
    v => {
      const p = normalizeParseRoot(_.get(v, '$parse'));
      const prevSwipe = p.done[String(message_id)]?.swipe_id;
      if (hash !== null && typeof prevSwipe === 'number' && prevSwipe !== swipe_id) {
        const prevQuarantine = p.quarantine[String(message_id)];
        if (prevQuarantine?.length) {
          p.quarantine[makeSwipeScopedKey(message_id, prevSwipe)] = prevQuarantine;
        }
      }
      // CTRL-FLOOR-HEAL-01 方案甲③：done 记 hash + swipe_id 双因子（TH 消息变量按 swipe 分槽）
      if (hash !== null) p.done[String(message_id)] = { hash, swipe_id };
      p.log = [...(p.log as ParseLogEntry[]), logEntry].slice(-MAX_LOG);
      const scopedKey = makeSwipeScopedKey(message_id, swipe_id);
      if (quarantine.length) {
        p.quarantine[String(message_id)] = quarantine;
        if (swipe_id > 0 || scopedKey in p.quarantine) {
          p.quarantine[scopedKey] = quarantine;
        }
      } else {
        delete p.quarantine[String(message_id)];
        delete p.quarantine[scopedKey];
      }
      // CTRL-F1-OBS-01：告警与隔离同构留档——$parse.issues[message_id]，空则删键（刷新后可恢复观测）
      if (issues.length) p.issues[String(message_id)] = issues;
      else delete p.issues[String(message_id)];
      // 批 C：楼号键容量自律——留档/删键后按楼号数值截最近 MAX_ISSUES_FLOORS 个，裁汰最旧键
      p.issues = capIssuesFloors(p.issues);
      // CTRL-UI-AUDIT-01：报告瘦身档滚动入账；读侧归一顺带自愈存量损坏形态
      if (report) p.reports = [report, ...normalizePersistedReports(p.reports)].slice(0, MAX_PERSISTED_REPORTS);
      _.set(v, '$parse', p); // '$parse' 非数字键，整棵 set 安全；存量损坏形态顺带自愈
      return v;
    },
    { type: 'chat' },
  );
}

/** 从 $parse.quarantine 读入隔离区（预览/异常静默降级） */
export async function loadQuarantine(): Promise<void> {
  const gv = tav<GetVariables>('getVariables');
  if (!gv) return;
  try {
    const chat = await gv({ type: 'chat' });
    parseState.quarantine = normalizeParseRoot(_.get(chat, '$parse')).quarantine;
    parseState.loaded = true;
  } catch {
    /* 降级：保持内存态 */
  }
}

/**
 * 从 $parse.issues 恢复历史告警（CTRL-F1-OBS-01，仿 loadQuarantine 先例）。
 * 刷新/重建组件后，本会话流水（内存态）已空，历史告警经此重新可见：
 * - 楼号已在本会话流水 → 仅当其 issues 为空时补齐（会话态更新鲜，不覆盖）；
 * - 楼号不在流水 → 追加一条「历史告警」报告（无 events，仅告警面），按楼号倒序并入并截断。
 */
export async function loadIssues(): Promise<void> {
  const gv = tav<GetVariables>('getVariables');
  if (!gv) return;
  try {
    const chat = await gv({ type: 'chat' });
    const saved = normalizeParseRoot(_.get(chat, '$parse')).issues;
    for (const [mid, issues] of Object.entries(saved)) {
      const id = Number(mid);
      if (!Number.isInteger(id) || id < 0 || !issues.length) continue;
      const existing = parseState.reports.find(r => r.message_id === id);
      if (existing) {
        if (!existing.issues.length) existing.issues = issues;
        continue;
      }
      parseState.reports.push({
        message_id: id,
        time: '历史',
        applied: false,
        events: [],
        issues,
        quarantineCount: 0,
        undoable: false,
        note: ISSUES_STUB_NOTE,
      });
    }
    parseState.reports.sort((a, b) => b.message_id - a.message_id);
    if (parseState.reports.length > MAX_REPORTS) parseState.reports.length = MAX_REPORTS;
  } catch {
    /* 降级：保持内存态 */
  }
}

/**
 * 从 $parse.reports 恢复历史报告流水（CTRL-UI-AUDIT-01，仿 loadIssues 先例）。
 * 合并口径：
 * - 会话内已持同 persistedAt 指纹（= 持久化档 ISO time）的报告 → 跳过（会话态更新鲜，不覆盖）；
 * - 同楼「历史告警」占位行（loadIssues 先到的竞态）→ 原地升级为恢复档，已挂 issues 保留、不重复加行；
 * - 恢复档 undoable=false / issues=[]（告警由 loadIssues 按楼补挂）；并入后按楼号倒序截断 MAX_REPORTS。
 */
export async function loadReports(): Promise<void> {
  const gv = tav<GetVariables>('getVariables');
  if (!gv) return;
  try {
    const chat = await gv({ type: 'chat' });
    const saved = normalizePersistedReports(_.get(chat, ['$parse', 'reports']));
    for (const r of saved) {
      if (parseState.reports.some(x => x.persistedAt === r.time)) continue;
      const stub = parseState.reports.find(
        x => x.message_id === r.message_id && x.persistedAt === undefined && x.note === ISSUES_STUB_NOTE,
      );
      if (stub) {
        // 竞态升级：loadIssues 先到的占位行原地换恢复档（issues 保留，不重复加行）
        stub.time = r.time;
        stub.applied = r.applied;
        stub.events = r.events;
        stub.quarantineCount = r.quarantineCount;
        stub.downstreamWarning = r.downstreamWarning;
        stub.note = r.note;
        stub.persistedAt = r.time;
        continue;
      }
      parseState.reports.push({
        message_id: r.message_id,
        time: r.time,
        applied: r.applied,
        events: r.events,
        issues: [],
        quarantineCount: r.quarantineCount,
        undoable: false,
        downstreamWarning: r.downstreamWarning,
        note: r.note,
        persistedAt: r.time,
      });
    }
    parseState.reports.sort((a, b) => b.message_id - a.message_id);
    if (parseState.reports.length > MAX_REPORTS) parseState.reports.length = MAX_REPORTS;
  } catch {
    /* 降级：保持内存态 */
  }
}

/* ═══════════════ R20 对账（仿 checkArchiveSync 模式） ═══════════════ */

/** R20：$parse.quarantine 未决项 → warn；指向已删楼的残留 → info 提示可清理 */
export async function checkParseQuarantine(): Promise<CheckIssue[]> {
  const gv = tav<GetVariables>('getVariables');
  if (!gv) return [];
  try {
    const chat = await gv({ type: 'chat' });
    const q = normalizeParseRoot(_.get(chat, '$parse')).quarantine;
    const glmi = tav<() => number>('getLastMessageId');
    const last = glmi ? glmi() : Number.POSITIVE_INFINITY;
    const issues: CheckIssue[] = [];
    for (const [mid, items] of Object.entries(q)) {
      if (!Array.isArray(items) || !items.length) continue;
      const n = Number(mid);
      if (Number.isFinite(n) && n > last) {
        issues.push({
          rule: 'R20',
          level: 'info',
          target: `#${mid}`,
          message: `隔离残留指向已删楼层（${items.length} 项）——解析区可清理`,
        });
      } else {
        issues.push({
          rule: 'R20',
          level: 'warn',
          target: `#${mid}`,
          message: `${items.length} 项隔离未决——改原文后重试，或在解析区编辑后提交`,
        });
      }
    }
    return issues;
  } catch {
    return [];
  }
}

/* ═══════════════ SEAM-01：删楼水位线对账 ═══════════════ */

/**
 * 删楼水位线对账：
 * 1) 清理聊天变量 `$parse.done`、`$parse.quarantine`、`$parse.issues`、`$parse.reports`（及内存态）中楼层号 `> maxFloor` 的残留项；
 * 2) 调用 `pruneTimelineAboveFloor(readTimelineLedger(), maxFloor)` 裁剪 `$timeline` 高于 `maxFloor` 的楼层；
 * 3) 若有 `removedWbMutations` 则调用 `await rollbackWorldbookMutations(removedWbMutations)` 自动逆向回滚聊天世界书词条。
 */
export async function reconcileDeletedFloorsAbove(
  maxFloor: number,
): Promise<{ prunedFloors: number[]; rolledBackWbCount: number }> {
  const safeMax = Number.isFinite(maxFloor) ? Math.trunc(maxFloor) : -1;
  const prunedSet = new Set<number>();

  // 1. 清理内存态 parseState
  for (const k of Object.keys(parseState.quarantine)) {
    const parsed = parseSwipeScopedKey(k);
    if (parsed && parsed.floorId > safeMax) {
      prunedSet.add(parsed.floorId);
      delete parseState.quarantine[k];
    }
  }
  for (let i = parseState.reports.length - 1; i >= 0; i--) {
    const mid = parseState.reports[i].message_id;
    if (typeof mid === 'number' && mid > safeMax) {
      prunedSet.add(mid);
      parseState.reports.splice(i, 1);
    }
  }
  if (parseState.chrono && parseState.chrono.message_id > safeMax) {
    prunedSet.add(parseState.chrono.message_id);
    parseState.chrono = null;
  }

  // 2. 清理聊天变量 $parse (done / quarantine / issues / reports / log)
  const uvw = tav<UpdateVariablesWith>('updateVariablesWith');
  if (uvw) {
    try {
      await uvw(
        v => {
          const p = normalizeParseRoot(_.get(v, '$parse'));
          for (const k of Object.keys(p.done)) {
            const parsed = parseSwipeScopedKey(k);
            if (parsed && parsed.floorId > safeMax) {
              prunedSet.add(parsed.floorId);
              delete p.done[k];
            }
          }
          for (const k of Object.keys(p.quarantine)) {
            const parsed = parseSwipeScopedKey(k);
            if (parsed && parsed.floorId > safeMax) {
              prunedSet.add(parsed.floorId);
              delete p.quarantine[k];
            }
          }
          for (const k of Object.keys(p.issues)) {
            const parsed = parseSwipeScopedKey(k);
            if (parsed && parsed.floorId > safeMax) {
              prunedSet.add(parsed.floorId);
              delete p.issues[k];
            }
          }
          if (Array.isArray(p.reports)) {
            p.reports = p.reports.filter(item => {
              const mid = (item as { message_id?: unknown } | null)?.message_id;
              if (typeof mid === 'number' && mid > safeMax) {
                prunedSet.add(mid);
                return false;
              }
              return true;
            });
          }
          if (Array.isArray(p.log)) {
            p.log = p.log.filter(item => {
              const mid = (item as { message_id?: unknown } | null)?.message_id;
              if (typeof mid === 'number' && mid > safeMax) {
                prunedSet.add(mid);
                return false;
              }
              return true;
            });
          }
          _.set(v, '$parse', p);
          return v;
        },
        { type: 'chat' },
      );
    } catch (err) {
      console.warn('[useParse] reconcileDeletedFloorsAbove 清理 $parse 异常：', err);
    }
  }

  // 3. 裁剪 $timeline 高于 maxFloor 的楼层并逆向回滚世界书
  const currentLedger = readTimelineLedger();
  for (const floorRec of Object.values(currentLedger.floors)) {
    if (floorRec.floorId > safeMax) {
      prunedSet.add(floorRec.floorId);
    }
  }
  const { nextLedger, removedWbMutations } = pruneTimelineAboveFloor(currentLedger, safeMax);
  writeTimelineLedger(() => nextLedger);

  let rolledBackWbCount = 0;
  if (removedWbMutations.length > 0) {
    ensureChatBookGatewayMethods();
    const wbRes = await rollbackWorldbookMutations(removedWbMutations);
    rolledBackWbCount = wbRes.rolledBackCount;
    // 兜底清理花名册追加行（当 chatBookBinding 尚未导出 ROSTER_ENTRY_NAME 常量时）
    const gw = chatBookGateway as unknown as {
      getChatWorldbookName: (t: string) => string | null;
      getWorldbookNames: () => string[];
      updateWorldbookWith: (
        name: string,
        fn: (entries: { name?: string; content?: string }[]) => { name?: string; content?: string }[],
      ) => Promise<void>;
    };
    const rosterMutations = removedWbMutations.filter(m => Boolean(m.rosterLineAdded));
    if (rosterMutations.length > 0) {
      const allBooks = gw.getWorldbookNames();
      const byBook = new Map<string, string[]>();
      for (const m of rosterMutations) {
        const book = (m.bookName || gw.getChatWorldbookName('current') || '').trim();
        if (!book || !allBooks.includes(book) || !m.rosterLineAdded) continue;
        const lines = byBook.get(book) ?? [];
        lines.push(m.rosterLineAdded.trim());
        byBook.set(book, lines);
      }
      for (const [book, linesToRemove] of byBook.entries()) {
        await gw.updateWorldbookWith(book, entries =>
          entries.map(e => {
            if (typeof e?.name === 'string' && e.name.includes(FALLBACK_ROSTER_MARK) && typeof e.content === 'string') {
              return {
                ...e,
                content: e.content
                  .split(/\r?\n/)
                  .filter(l => !linesToRemove.includes(l.trim()))
                  .join('\n'),
              };
            }
            return e;
          }),
        );
      }
    }
  }

  // 4. 删楼越界摘要自动清理（safeMax >= 0 时，剔除 to > safeMax 的越界未来摘要条目并解隐残存区间）
  if (safeMax >= 0) {
    try {
      ensureChatBookGatewayMethods();
      const gw = chatBookGateway as unknown as {
        getChatWorldbookName?: (t: string) => string | null;
        getWorldbookNames?: () => string[];
        getWorldbook?: (
          name: string,
        ) => Promise<Array<{ name?: string; comment?: string; extra?: Record<string, unknown>; [k: string]: unknown }>>;
        updateWorldbookWith?: (
          name: string,
          fn: (
            entries: Array<{ name?: string; comment?: string; extra?: Record<string, unknown>; [k: string]: unknown }>,
          ) => Array<{ name?: string; comment?: string; extra?: Record<string, unknown>; [k: string]: unknown }>,
        ) => Promise<void>;
      };
      const ledgerBefore = currentLedger;
      const boundBook = (ledgerBefore.boundBookName || gw.getChatWorldbookName?.('current') || '').trim();
      const allBooks = gw.getWorldbookNames?.() ?? [];
      if (boundBook && (allBooks.length === 0 || allBooks.includes(boundBook))) {
        const parseSummaryBounds = (e: {
          name?: string;
          comment?: string;
          extra?: Record<string, unknown>;
        }): { from: number; to: number } | null => {
          const title = String(e?.name || e?.comment || '').trim();
          const m = /^摘要·(?:大·|中·)?(\d+)-(\d+)/.exec(title);
          const ex = e?.extra && typeof e.extra === 'object' ? e.extra : undefined;
          const exFrom = typeof ex?.from === 'number' && Number.isFinite(ex.from) ? Math.trunc(ex.from) : null;
          const exTo = typeof ex?.to === 'number' && Number.isFinite(ex.to) ? Math.trunc(ex.to) : null;
          if (!title.startsWith('摘要·') && !m && exTo === null) return null;
          const from = exFrom ?? (m ? Number.parseInt(m[1], 10) : 1);
          const to = exTo ?? (m ? Number.parseInt(m[2], 10) : -1);
          if (!Number.isFinite(to) || to < 0) return null;
          return { from: Number.isFinite(from) && from >= 0 ? from : 1, to };
        };

        const entryKey = (e: { uid?: number; name?: string; comment?: string }, bounds: { from: number; to: number }) =>
          e.uid !== undefined ? `uid:${e.uid}` : `title:${String(e.name || e.comment || '')}:${bounds.from}-${bounds.to}`;
        const existingEntries = (await gw.getWorldbook?.(boundBook)) ?? [];
        const outOfBounds: Array<{ key: string; from: number; to: number }> = [];
        for (const entry of existingEntries) {
          const bounds = parseSummaryBounds(entry);
          if (bounds && bounds.to > safeMax) {
            outOfBounds.push({ key: entryKey(entry, bounds), from: bounds.from, to: bounds.to });
          }
        }

        if (outOfBounds.length > 0) {
          const { unhideRange } = await import('../../红警指挥系统/worldbook/summaryFiler');
          const deletableKeys = new Set<string>();
          for (const item of outOfBounds) {
            const unhideTo = Math.min(item.to, safeMax);
            if (item.from > unhideTo) {
              deletableKeys.add(item.key);
              continue;
            }
            try {
              await unhideRange(item.from, unhideTo);
              deletableKeys.add(item.key);
            } catch {
              /* 解隐失败保留该摘要条目，供下次删楼对账重试 */
            }
          }
          if (deletableKeys.size > 0) {
            await gw.updateWorldbookWith?.(boundBook, entries =>
              entries.filter(entry => {
                const bounds = parseSummaryBounds(entry);
                return !(bounds && bounds.to > safeMax && deletableKeys.has(entryKey(entry, bounds)));
              }),
            );
          }
        }
      }
    } catch {
      /* 越界摘要清理异常不阻断主流程 */
    }
  }

  return {
    prunedFloors: [...prunedSet].sort((a, b) => a - b),
    rolledBackWbCount,
  };
}

export async function finalizeBranchWorldbookCloneIfNeeded(
  ledgerBefore: TimelineLedgerState,
  branchMaxFloor: number,
  branchedResult: { branched: boolean; currentChatId: string; sourceBookName: string; clonedBookName: string },
): Promise<void> {
  if (!branchedResult.branched || !branchedResult.sourceBookName) return;
  if (branchedResult.clonedBookName && branchedResult.clonedBookName !== branchedResult.sourceBookName) return;
  ensureChatBookGatewayMethods();
  const gw = chatBookGateway as unknown as {
    getWorldbookNames: () => string[];
    getWorldbook: (name: string) => Promise<{ name: string; content: string; enabled: boolean; keys?: string[] }[]>;
    getCurrentCharacterName: () => string;
    createWorldbook: (name: string, entries: unknown[]) => Promise<void>;
    rebindChatWorldbook: (target: string, name: string) => Promise<void>;
  };
  const allBooks = gw.getWorldbookNames();
  if (!allBooks.includes(branchedResult.sourceBookName)) return;
  const { removedWbMutations } = pruneTimelineAboveFloor(ledgerBefore, branchMaxFloor);
  const sourceEntries = await gw.getWorldbook(branchedResult.sourceBookName);
  const clonedEntries = computeBranchClonedEntries(sourceEntries, removedWbMutations);
  const charName = gw.getCurrentCharacterName() || '未命名角色';
  const baseCandidate = makeCanonicalBookName(charName, new Date());
  const clonedBookName =
    allBooks.includes(baseCandidate) || baseCandidate === branchedResult.sourceBookName
      ? `${baseCandidate}_branch`
      : baseCandidate;
  await gw.createWorldbook(clonedBookName, clonedEntries);
  await gw.rebindChatWorldbook('current', clonedBookName);
  writeTimelineLedger(draft => {
    draft.boundBookName = clonedBookName;
  });
}

export const reconcileFloorWatermark = reconcileDeletedFloorsAbove;

/** 🟡撤销：写回入库前的本楼 stat_data，删除 $parse.done hash（允许重新解析），并连带清该楼历史告警（批 C：内存＋$parse.issues 双清） */
export async function undoFloor(report: ParseReport): Promise<boolean> {
  const api = apis();
  if (!api || !report.undoable || report.undone) return false;
  const { uvw } = api;
  parseState.busy = true;
  try {
    const baseline = report.undoBaseline;
    await uvw(
      v => {
        if (baseline === undefined) _.unset(v, 'stat_data');
        else _.set(v, 'stat_data', baseline);
        return v;
      },
      { type: 'message', message_id: report.message_id },
    );
    await uvw(
      v => {
        const p = normalizeParseRoot(_.get(v, '$parse'));
        delete p.done[String(report.message_id)];
        // 批 C：连带删该楼 issues 键——撤销语义＝该楼解析作废，历史告警残留经 loadIssues 复挂属语义陈旧
        delete p.issues[String(report.message_id)];
        _.set(v, '$parse', p);
        return v;
      },
      { type: 'chat' },
    );
    // 批 C：内存报告该楼 issues 清空（clearQuarantine 内存＋$parse 双清先例）；两笔 uvw 均成后落，异常路径内存不动
    report.issues = [];
    report.undone = true;
    return true;
  } finally {
    parseState.busy = false;
  }
}

/** 清理指向已删楼层的隔离残留（内存 + $parse 双清） */
export async function clearQuarantine(message_id: number): Promise<void> {
  delete parseState.quarantine[String(message_id)];
  const uvw = tav<UpdateVariablesWith>('updateVariablesWith');
  if (!uvw) return;
  await uvw(
    v => {
      const p = normalizeParseRoot(_.get(v, '$parse'));
      delete p.quarantine[String(message_id)];
      _.set(v, '$parse', p);
      return v;
    },
    { type: 'chat' },
  );
}

