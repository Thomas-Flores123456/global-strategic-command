/**
 * 聊天绑定世界书守卫层（chatBookBinding）——CTRL-CHATBOOK-01 设计案 §2/§3 的可执行落地
 *
 * 唯一真源＝酒馆原生 chat worldbook 绑定（getOrCreateChatWorldbook 建、getChatWorldbookName 读）。
 * 🔴 零自建 chatId→书名映射、零真源缓存（B4 缓存腐败教训：多一层缓存就多一个腐败面）。
 *
 * 写前三重守卫（落笔前现场执行，不缓存、不跳步）：
 *   守卫① chatId 未漂移：写入发起时重取 getCurrentChatId()，与事务开始记录一致；
 *   守卫② 绑定存在：getChatWorldbookName('current') 非 null（null 且调用方声明 createIfMissing
 *          时走 §3.1 惰性建书后重跑三重守卫；否则拒写）；
 *   守卫③ 书实体存在：绑定书名 ∈ getWorldbookNames()（不在＝孤儿绑定，拒写）。
 * 任一失败 → fail-closed：抛 GuardError＋结构化留痕（守卫编号/期望值/实测值，内存 ring buffer
 * 20 条＋console.warn，驾驶员裁决：零持久化副作用）。🔴 绝不静默降级写全局书。
 * 守卫编号 0 为环境前置失败（chatId 不可读/酒馆 API 缺失），非三重守卫本体，同样 fail-closed。
 *
 * 分层对齐 girlFiler 先例：纯函数可测层（runTripleGuard/makeCanonicalBookName/pushGuardTrace，
 * 注入读数）＋薄副作用层（makeChatBookGateway 真实调 API）。
 * CHAT_CHANGED 只清 UI 展示态（本层不缓存真源，无真源可清），对齐 util/script.ts
 * reloadOnChatChange 先例；写入事务跨楼层挂起期间切聊天由守卫①天然拦截。
 *
 * ⚠ 真机必测两项（文档未载，不得假定，本文件只交运行时探针，结论归驾驶员 L3）：
 *   probeRenameChatBindingSurvival —— renameChat 后绑定是否随迁；
 *   probeDuplicateNameCreate —— getOrCreateChatWorldbook 传已存在书名的行为（复用 or 报错）。
 */
import { recordFlightLog } from '../debug/dataFlowTracer';
import { tav } from '../parse/systemCheck';

/* ═══════════════ 类型 ═══════════════ */

/** 守卫失败结构化描述（设计案 §2.3：失败守卫编号＋期望值＋实测值） */
export interface GuardFailure {
  /** 0=环境前置（API/chatId 不可读）；1/2/3=三重守卫本体 */
  guard: 0 | 1 | 2 | 3;
  rule:
    'env-unavailable' | 'chat-id-unreadable' | 'chat-id-drift' | 'binding-missing' | 'book-missing' | 'create-failed';
  expected: string;
  actual: string;
}

/** 留痕条目：失败描述＋发生时刻（副作用层补时间戳，纯函数层不产时间） */
export interface GuardTrace extends GuardFailure {
  at: string;
}

/** 三重守卫现场读数（全部注入，纯函数可测；API 可用性由副作用层先行核验） */
export interface GuardReadings {
  /** 写入事务开始时记录的 chatId */
  txnChatId: string;
  /** 写入发起时重取的 chatId；null＝此刻不可读 */
  currentChatId: string | null;
  /** getChatWorldbookName('current') 读数 */
  boundBook: string | null;
  /** getWorldbookNames() 读数 */
  allBooks: string[];
}

export type GuardVerdict = { ok: true; book: string } | { ok: false; failure: GuardFailure };

/** fail-closed 拒写异常；failure 为结构化留痕（UI 层截获展示） */
export class GuardError extends Error {
  readonly failure: GuardFailure;
  constructor(failure: GuardFailure) {
    super(`[聊天书守卫${failure.guard}·${failure.rule}] 拒写：期望 ${failure.expected}，实测 ${failure.actual}`);
    this.name = 'GuardError';
    this.failure = failure;
  }
}

/* ═══════════════ 纯函数守卫层 ═══════════════ */

/** 三重守卫协议（设计案 §2.3）：任一失败即 fail-closed，全过才放行 */
export function runTripleGuard(r: GuardReadings): GuardVerdict {
  if (r.currentChatId === null) {
    return {
      ok: false,
      failure: { guard: 1, rule: 'chat-id-unreadable', expected: `chatId=${r.txnChatId}`, actual: '(此刻不可读)' },
    };
  }
  if (r.currentChatId !== r.txnChatId) {
    return {
      ok: false,
      failure: {
        guard: 1,
        rule: 'chat-id-drift',
        expected: `chatId=${r.txnChatId}`,
        actual: `chatId=${r.currentChatId}`,
      },
    };
  }
  if (r.boundBook === null) {
    return {
      ok: false,
      failure: { guard: 2, rule: 'binding-missing', expected: '本聊天绑定档案书非 null', actual: 'null（尚无档案书）' },
    };
  }
  if (!r.allBooks.includes(r.boundBook)) {
    return {
      ok: false,
      failure: {
        guard: 3,
        rule: 'book-missing',
        expected: `「${r.boundBook}」∈ getWorldbookNames`,
        actual: `不在（共 ${r.allBooks.length} 本）——孤儿绑定`,
      },
    };
  }
  return { ok: true, book: r.boundBook };
}

/** 短时间戳（创建时刻，分钟粒度，对齐设计案 §2.2 示例 20260922T1530） */
export function shortStamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}T${p(now.getHours())}${p(now.getMinutes())}`;
}

/** 规范名（Q3=A：书名与聊天名解耦）：红警档案·{角色名}·{短时间戳} */
export function makeCanonicalBookName(charName: string, now: Date = new Date()): string {
  return `红警档案·${charName.trim() || '未知角色'}·${shortStamp(now)}`;
}

/** 别名导出（供 branchBookCloner.ts 等时间线模块统一引用） */
export const generateArchiveBookName = makeCanonicalBookName;

/** 机娘花名册固定条目名（与 girlFiler.ts 保持一致） */
export const ROSTER_ENTRY_NAME = '01·机娘阵容与社会外壳总览';

/** 世界书条目基础契约（供 branchBookCloner / SavePack V2 共用） */
export interface WorldbookEntry {
  uid?: number;
  name: string;
  content: string;
  enabled: boolean;
  keys?: string[];
  [key: string]: unknown;
}

/** ring buffer 写入（新条目在前，超容截尾）；纯函数：buf 进出 */
export function pushGuardTrace(buf: GuardTrace[], trace: GuardTrace, cap = 20): GuardTrace[] {
  buf.unshift(trace);
  buf.splice(cap);
  return buf;
}

/* ═══════════════ 留痕与展示态（内存态，刷新即失） ═══════════════ */

const guardTraces: GuardTrace[] = [];

/** 守卫失败最近留痕（管理页 §5.5 调试用；只读快照） */
export function getGuardTraces(): readonly GuardTrace[] {
  return guardTraces;
}

/** UI 展示态：最近一次守卫放行的书名（非真源，仅供「当前聊天 ⇆ 档案书」展示） */
export const chatBookDisplay: { book: string | null; updatedAt: string | null } = { book: null, updatedAt: null };

export function clearChatBookDisplay(): void {
  chatBookDisplay.book = null;
  chatBookDisplay.updatedAt = null;
}

type EventOnLike = (event: string, callback: (...args: unknown[]) => void) => unknown;

/**
 * CHAT_CHANGED 展示态清理（设计案 §2.4）：切聊天时丢弃 UI 展示态临时值。
 * 真源不缓存故无真源可清；挂起事务由守卫①拦截。on/eventName 可注入（测试用），
 * 缺省探测酒馆全局 eventOn＋tavern_events.CHAT_CHANGED，独立预览缺 API 时返回 false 不安装。
 */
export function installChatChangedReset(on?: EventOnLike, eventName?: string): boolean {
  const listen = on ?? tav<EventOnLike>('eventOn');
  const events = (globalThis as Record<string, unknown>).tavern_events as { CHAT_CHANGED?: string } | undefined;
  const evt = eventName ?? events?.CHAT_CHANGED;
  if (!listen || !evt) return false;
  listen(evt, () => clearChatBookDisplay());
  return true;
}

/* ═══════════════ 薄副作用层：IO 与网关 ═══════════════ */

/** 酒馆 API 读数接口（注入可测；undefined＝该 API 不可用） */
export interface BindingIO {
  readChatId(): string | null;
  /** undefined＝API 不可用（独立预览）；null＝API 可用但本聊天无绑定 */
  readBoundBook(): string | null | undefined;
  readBookNames(): string[] | null;
  createChatBook(name: string): Promise<string>;
  charName(): string;
  now(): Date;
  warn(message: string): void;
}

export interface WriteTxn {
  chatId: string;
}

/** 聊天书写入网关：begin 记事务身份，guardedBook 每次落笔前现场跑守卫 */
export interface ChatBookGatewayLike {
  begin(): WriteTxn;
  guardedBook(txn: WriteTxn, opts: { createIfMissing: boolean }): Promise<string>;
  getChatWorldbookName?(chat: 'current' | string): string | null;
  getWorldbookNames?(): string[];
  getWorldbook?(name: string): Promise<WorldbookEntry[]>;
  updateWorldbookWith?(name: string, updater: (entries: WorldbookEntry[]) => WorldbookEntry[]): Promise<unknown>;
  createWorldbook?(name: string, entries?: WorldbookEntry[]): Promise<unknown>;
  rebindChatWorldbook?(chat: 'current' | string, bookName: string): Promise<unknown>;
  getCurrentCharacterName?(): string;
}

function recordFailure(io: BindingIO, failure: GuardFailure, chatId: string | null = null): GuardError {
  const trace: GuardTrace = { ...failure, at: io.now().toISOString() };
  pushGuardTrace(guardTraces, trace);
  io.warn(
    `[chatBookBinding] 守卫${failure.guard}失败（${failure.rule}）：期望 ${failure.expected}，实测 ${failure.actual}——fail-closed 拒写`,
  );
  recordFlightLog({
    category: 'wb_gateway',
    status: 'blocked',
    chatId,
    floorId: null,
    swipeId: null,
    title: `世界书守卫拦截 (${failure.rule})`,
    detail: `期望 ${failure.expected}，实测 ${failure.actual}`,
  });
  return new GuardError(failure);
}

let chatChangedInstalled = false;

/** 组装网关（副作用层入口；io 注入可测，缺省用真实酒馆 API） */
export function makeChatBookGateway(io: BindingIO): ChatBookGatewayLike {
  /** 现场读数→纯函数守卫；API 缺失以守卫 0 fail-closed */
  const readAndGuard = (txn: WriteTxn): GuardVerdict => {
    const boundBook = io.readBoundBook();
    const allBooks = io.readBookNames();
    if (boundBook === undefined || allBooks === null) {
      return {
        ok: false,
        failure: {
          guard: 0,
          rule: 'env-unavailable',
          expected: 'getChatWorldbookName/getWorldbookNames 可用',
          actual: '酒馆世界书 API 不可用（独立预览？）',
        },
      };
    }
    return runTripleGuard({ txnChatId: txn.chatId, currentChatId: io.readChatId(), boundBook, allBooks });
  };

  return {
    begin(): WriteTxn {
      const chatId = io.readChatId();
      if (!chatId) {
        throw recordFailure(
          io,
          {
            guard: 0,
            rule: 'chat-id-unreadable',
            expected: 'SillyTavern.getCurrentChatId() 返回非空',
            actual: String(chatId),
          },
          null,
        );
      }
      return { chatId };
    },
    async guardedBook(txn: WriteTxn, opts: { createIfMissing: boolean }): Promise<string> {
      if (!chatChangedInstalled) chatChangedInstalled = installChatChangedReset();
      let verdict = readAndGuard(txn);
      // §3.1 惰性建书：守卫②失败且调用方声明 createIfMissing → 建书绑定后重跑三重守卫再写
      if (!verdict.ok && verdict.failure.guard === 2 && opts.createIfMissing) {
        const canonical = makeCanonicalBookName(io.charName(), io.now());
        try {
          await io.createChatBook(canonical);
        } catch (e) {
          throw recordFailure(
            io,
            {
              guard: 2,
              rule: 'create-failed',
              expected: `getOrCreateChatWorldbook('current', ${canonical}) 成功`,
              actual: e instanceof Error ? e.message : String(e),
            },
            io.readChatId() ?? txn.chatId,
          );
        }
        verdict = readAndGuard(txn);
      }
      if (!verdict.ok) throw recordFailure(io, verdict.failure, io.readChatId() ?? txn.chatId);
      chatBookDisplay.book = verdict.book;
      chatBookDisplay.updatedAt = io.now().toISOString();
      recordFlightLog({
        category: 'wb_gateway',
        status: 'ok',
        chatId: txn.chatId,
        floorId: null,
        swipeId: null,
        title: '世界书守卫放行',
        detail: `book=${verdict.book}`,
      });
      return verdict.book;
    },
    getChatWorldbookName() {
      return io.readBoundBook() ?? null;
    },
    getWorldbookNames() {
      return io.readBookNames() ?? [];
    },
    async getWorldbook(name: string): Promise<WorldbookEntry[]> {
      const fn = tav<(b: string) => Promise<WorldbookEntry[]>>('getWorldbook');
      return fn ? await fn(name) : [];
    },
    async updateWorldbookWith(name: string, updater: (entries: WorldbookEntry[]) => WorldbookEntry[]) {
      const fn = tav<(b: string, u: (e: WorldbookEntry[]) => WorldbookEntry[]) => Promise<unknown>>(
        'updateWorldbookWith',
      );
      if (fn) return fn(name, updater);
      return undefined;
    },
    async createWorldbook(name: string, entries: WorldbookEntry[] = []) {
      const createFn = tav<(b: string, e: WorldbookEntry[]) => Promise<unknown>>('createWorldbook');
      if (createFn) return createFn(name, entries);
      await io.createChatBook(name);
      const updateFn = tav<(b: string, u: (e: WorldbookEntry[]) => WorldbookEntry[]) => Promise<unknown>>(
        'updateWorldbookWith',
      );
      if (updateFn && entries.length > 0) {
        await updateFn(name, () => entries);
      }
      return undefined;
    },
    async rebindChatWorldbook(_chat: 'current' | string, bookName: string) {
      const rebindFn = tav<(c: 'current', b: string) => Promise<unknown>>('rebindChatWorldbook');
      if (rebindFn) return rebindFn('current', bookName);
      return io.createChatBook(bookName);
    },
    getCurrentCharacterName() {
      return io.charName();
    },
  };
}

/* ═══════════════ 真实 IO 与缺省网关 ═══════════════ */

interface StLike {
  getCurrentChatId?: () => string;
  renameChat?: (old_name: string, new_name: string) => Promise<void>;
  name2?: string;
}

function st(): StLike | undefined {
  return (globalThis as Record<string, unknown>).SillyTavern as StLike | undefined;
}

const realIO: BindingIO = {
  readChatId() {
    try {
      const id = st()?.getCurrentChatId?.();
      return typeof id === 'string' && id ? id : null;
    } catch {
      return null;
    }
  },
  readBoundBook() {
    const fn = tav<(chat: 'current') => string | null>('getChatWorldbookName');
    if (!fn) return undefined;
    try {
      return fn('current');
    } catch {
      return undefined;
    }
  },
  readBookNames() {
    const fn = tav<() => string[]>('getWorldbookNames');
    if (!fn) return null;
    try {
      return fn();
    } catch {
      return null;
    }
  },
  async createChatBook(name: string) {
    const fn = tav<(chat: 'current', book?: string) => Promise<string>>('getOrCreateChatWorldbook');
    if (!fn) throw new Error('酒馆 API getOrCreateChatWorldbook 不可用');
    return fn('current', name);
  },
  charName() {
    return st()?.name2 ?? '未知角色';
  },
  now: () => new Date(),
  warn: message => console.warn(message),
};

/** 缺省网关（girlFiler 等写入器使用；测试用 makeChatBookGateway 自注 IO） */
export const chatBookGateway: ChatBookGatewayLike = makeChatBookGateway(realIO);

/* ═══════════════ 真机必测探针（驾驶员 L3 手动触发，绝不自动运行） ═══════════════ */

export interface ProbeReport {
  probe: 'rename-chat-binding' | 'duplicate-name-create';
  ok: boolean;
  observed: Record<string, string | boolean | null>;
  note: string;
}

/**
 * 必测① renameChat 后聊天书绑定是否随迁（官方文档只说 checkpoint 链会断，未提世界书绑定）。
 * ⚠ 执行前须知：checkpoint 链会断（官方明示）；请在测试聊天运行。改名后立即复验绑定（§2.2 兜底）。
 */
export async function probeRenameChatBindingSurvival(newChatName: string): Promise<ProbeReport> {
  const rename = st()?.renameChat;
  const oldName = realIO.readChatId();
  const boundBefore = realIO.readBoundBook();
  if (!rename || !oldName || boundBefore === undefined) {
    return {
      probe: 'rename-chat-binding',
      ok: false,
      observed: { oldName: oldName ?? null, boundBefore: boundBefore ?? null },
      note: '前置不可用（renameChat/chatId/世界书 API 缺失），未执行改名',
    };
  }
  if (boundBefore === null) {
    return {
      probe: 'rename-chat-binding',
      ok: false,
      observed: { oldName, boundBefore: null },
      note: '本聊天尚无绑定书，无从验证存续；先触发一笔入档再跑探针',
    };
  }
  await rename(oldName, newChatName);
  const boundAfter = realIO.readBoundBook() ?? null;
  const survived = boundAfter === boundBefore;
  return {
    probe: 'rename-chat-binding',
    ok: survived,
    observed: { oldName, newChatName, boundBefore, boundAfter, survived },
    note: survived
      ? '绑定随迁存续（本次实测；结论仍归驾驶员 L3 复核）'
      : '⚠ 绑定丢失/漂移——改名操作必须补 rebindChatWorldbook 兜底，请驾驶员裁决',
  };
}

/**
 * 必测② getOrCreateChatWorldbook 传入已存在书名的行为（复用 or 报错 or 建重名副本）。
 * ⚠ 会改动当前聊天绑定：探针自带复原（结束时若绑定被改则 rebind 回原书）；请在测试聊天运行。
 */
export async function probeDuplicateNameCreate(existingBookName: string): Promise<ProbeReport> {
  const namesBefore = realIO.readBookNames();
  const boundBefore = realIO.readBoundBook();
  const rebind = tav<(chat: 'current', book: string) => Promise<void>>('rebindChatWorldbook');
  if (namesBefore === null || boundBefore === undefined) {
    return {
      probe: 'duplicate-name-create',
      ok: false,
      observed: { existingBookName },
      note: '世界书 API 不可用，未执行',
    };
  }
  if (!namesBefore.includes(existingBookName)) {
    return {
      probe: 'duplicate-name-create',
      ok: false,
      observed: { existingBookName },
      note: '给定书名当前不存在，重名行为无从验证；换一个已存在的书名',
    };
  }
  let returned: string | null = null;
  let thrown: string | null = null;
  try {
    returned = await realIO.createChatBook(existingBookName);
  } catch (e) {
    thrown = e instanceof Error ? e.message : String(e);
  }
  const namesAfter = realIO.readBookNames() ?? [];
  const boundAfter = realIO.readBoundBook() ?? null;
  // 复原：绑定被探针改走则归位（boundBefore 为 null 时无原绑定可复原，如实上报）
  let restored: boolean | null = null;
  if (boundAfter !== boundBefore && boundBefore !== null && rebind) {
    try {
      await rebind('current', boundBefore);
      restored = true;
    } catch {
      restored = false;
    }
  }
  return {
    probe: 'duplicate-name-create',
    ok: thrown === null,
    observed: {
      existingBookName,
      returned,
      thrown,
      bookCountDelta: String((namesAfter.length - namesBefore.length) | 0),
      boundBefore,
      boundAfter,
      restored,
    },
    note:
      thrown !== null
        ? `重名调用抛错：「${thrown}」——守卫层建书须避开既有名（规范名短时间戳已降撞名概率）`
        : returned === existingBookName && namesAfter.length === namesBefore.length
          ? '重名调用复用既有书（未新建副本）；结论仍归驾驶员 L3 复核'
          : `⚠ 非平凡行为：返回「${returned}」、书总数变化 ${namesAfter.length - namesBefore.length}——请驾驶员比对观测字段裁决`,
  };
}
