/**
 * chatBookBinding 单测（CTRL-CHATBOOK-IMPL-01 · 验收合同 §7 自动化五条中 1~4）
 * mock API 注入：三重守卫各失败分支 fail-closed＋结构化留痕；全过放行；
 * 写入中途 chatId 变化被拦截；惰性建书＋规范名格式；建书失败不清 pending_lore（由抛错保证）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BindingIO, GuardTrace } from '../worldbook/chatBookBinding';
import {
  GuardError,
  chatBookDisplay,
  clearChatBookDisplay,
  installChatChangedReset,
  makeCanonicalBookName,
  makeChatBookGateway,
  pushGuardTrace,
  runTripleGuard,
  shortStamp,
} from '../worldbook/chatBookBinding';
import type { Dossier, ThEntry } from '../worldbook/girlFiler';
import { fileDossier } from '../worldbook/girlFiler';
import { GirlDossier } from '../core/schema';

afterEach(() => {
  vi.unstubAllGlobals();
  clearChatBookDisplay();
});

/* ═══════════════ 纯函数守卫层 ═══════════════ */

describe('runTripleGuard · 三重守卫协议（§2.3）', () => {
  const base = {
    txnChatId: 'chat-A',
    currentChatId: 'chat-A',
    boundBook: '红警档案·测试·20260922T1500',
    allBooks: ['红警档案·测试·20260922T1500', '机娘·能力档案'],
  };

  it('全过放行，返回绑定书名', () => {
    const v = runTripleGuard(base);
    expect(v).toEqual({ ok: true, book: '红警档案·测试·20260922T1500' });
  });
  it('守卫①：chatId 漂移 → fail-closed，留痕含期望/实测', () => {
    const v = runTripleGuard({ ...base, currentChatId: 'chat-B' });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.failure).toMatchObject({
        guard: 1,
        rule: 'chat-id-drift',
        expected: 'chatId=chat-A',
        actual: 'chatId=chat-B',
      });
    }
  });
  it('守卫①：chatId 此刻不可读 → fail-closed', () => {
    const v = runTripleGuard({ ...base, currentChatId: null });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.failure).toMatchObject({ guard: 1, rule: 'chat-id-unreadable' });
  });
  it('守卫②：绑定为 null → fail-closed', () => {
    const v = runTripleGuard({ ...base, boundBook: null });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.failure).toMatchObject({ guard: 2, rule: 'binding-missing' });
  });
  it('守卫③：绑定书不在 getWorldbookNames → 孤儿绑定 fail-closed', () => {
    const v = runTripleGuard({ ...base, allBooks: ['机娘·能力档案'] });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.failure).toMatchObject({ guard: 3, rule: 'book-missing' });
      expect(v.failure.actual).toContain('孤儿绑定');
    }
  });
});

describe('规范名与留痕纯函数', () => {
  it('规范名格式：红警档案·{角色名}·{短时间戳}（§2.2，书名与聊天名解耦）', () => {
    const now = new Date(2026, 8, 22, 15, 30);
    expect(shortStamp(now)).toBe('20260922T1530');
    expect(makeCanonicalBookName('红警指挥系统', now)).toBe('红警档案·红警指挥系统·20260922T1530');
    expect(makeCanonicalBookName('  ', now)).toBe('红警档案·未知角色·20260922T1530');
  });
  it('pushGuardTrace：新条目在前，超容截尾（ring buffer 20 条）', () => {
    const mk = (i: number): GuardTrace => ({
      guard: 1,
      rule: 'chat-id-drift',
      expected: `e${i}`,
      actual: `a${i}`,
      at: 't',
    });
    const buf: GuardTrace[] = [];
    for (let i = 0; i < 25; i++) pushGuardTrace(buf, mk(i));
    expect(buf).toHaveLength(20);
    expect(buf[0].expected).toBe('e24');
    expect(buf[19].expected).toBe('e5');
  });
});

/* ═══════════════ 副作用层网关（IO 注入） ═══════════════ */

interface MockIOState {
  chatId: string | null;
  bound: string | null | undefined;
  books: string[] | null;
  createBehavior?: 'ok' | 'throw';
}

function makeIO(s: MockIOState) {
  const created: string[] = [];
  const warns: string[] = [];
  const io: BindingIO = {
    readChatId: () => s.chatId,
    readBoundBook: () => s.bound,
    readBookNames: () => (s.books ? [...s.books] : null),
    async createChatBook(name: string) {
      if (s.createBehavior === 'throw') throw new Error('宿主拒绝建书');
      created.push(name);
      s.bound = name; // 建书即绑定（酒馆原生语义）
      s.books = [...(s.books ?? []), name];
      return name;
    },
    charName: () => '红警指挥系统',
    now: () => new Date(2026, 8, 22, 15, 30),
    warn: m => warns.push(m),
  };
  return { io, created, warns, state: s };
}

describe('makeChatBookGateway · 副作用层', () => {
  it('begin：chatId 不可读 → GuardError（守卫 0）＋留痕', () => {
    const { io, warns } = makeIO({ chatId: null, bound: null, books: [] });
    const gw = makeChatBookGateway(io);
    expect(() => gw.begin()).toThrowError(GuardError);
    expect(warns.some(w => w.includes('守卫0'))).toBe(true);
  });
  it('全过放行：guardedBook 返回绑定书并刷新展示态', async () => {
    const { io } = makeIO({ chatId: 'chat-A', bound: '红警档案·X·20260101T0000', books: ['红警档案·X·20260101T0000'] });
    const gw = makeChatBookGateway(io);
    const txn = gw.begin();
    await expect(gw.guardedBook(txn, { createIfMissing: false })).resolves.toBe('红警档案·X·20260101T0000');
    expect(chatBookDisplay.book).toBe('红警档案·X·20260101T0000');
  });
  it('写入中途 chatId 变化被拦截（守卫①）', async () => {
    const { io, state } = makeIO({
      chatId: 'chat-A',
      bound: '红警档案·X·20260101T0000',
      books: ['红警档案·X·20260101T0000'],
    });
    const gw = makeChatBookGateway(io);
    const txn = gw.begin();
    state.chatId = 'chat-B'; // 事务挂起期间切聊天
    await expect(gw.guardedBook(txn, { createIfMissing: true })).rejects.toMatchObject({
      failure: { guard: 1, rule: 'chat-id-drift' },
    });
  });
  it('惰性建书（§3.1）：守卫②失败＋createIfMissing → 规范名建书后重跑守卫放行', async () => {
    const { io, created } = makeIO({ chatId: 'chat-A', bound: null, books: ['机娘·能力档案'] });
    const gw = makeChatBookGateway(io);
    const book = await gw.guardedBook(gw.begin(), { createIfMissing: true });
    expect(created).toEqual(['红警档案·红警指挥系统·20260922T1530']);
    expect(book).toBe('红警档案·红警指挥系统·20260922T1530');
  });
  it('守卫②失败且未声明建书意图 → fail-closed 不建书', async () => {
    const { io, created } = makeIO({ chatId: 'chat-A', bound: null, books: [] });
    const gw = makeChatBookGateway(io);
    await expect(gw.guardedBook(gw.begin(), { createIfMissing: false })).rejects.toMatchObject({
      failure: { guard: 2, rule: 'binding-missing' },
    });
    expect(created).toEqual([]);
  });
  it('建书失败 → GuardError（create-failed）fail-closed', async () => {
    const { io } = makeIO({ chatId: 'chat-A', bound: null, books: [], createBehavior: 'throw' });
    const gw = makeChatBookGateway(io);
    await expect(gw.guardedBook(gw.begin(), { createIfMissing: true })).rejects.toMatchObject({
      failure: { guard: 2, rule: 'create-failed', actual: '宿主拒绝建书' },
    });
  });
  it('世界书 API 不可用 → 守卫 0 fail-closed（绝不静默降级）', async () => {
    const { io } = makeIO({ chatId: 'chat-A', bound: undefined, books: null });
    const gw = makeChatBookGateway(io);
    await expect(gw.guardedBook(gw.begin(), { createIfMissing: true })).rejects.toMatchObject({
      failure: { guard: 0, rule: 'env-unavailable' },
    });
  });
});

describe('CHAT_CHANGED 展示态清理（§2.4）', () => {
  it('注入 on：事件触发即清展示态；真源本就不缓存', () => {
    chatBookDisplay.book = '红警档案·X·20260101T0000';
    chatBookDisplay.updatedAt = 'now';
    let handler: (() => void) | null = null;
    const ok = installChatChangedReset((_evt, cb) => {
      handler = cb;
    }, 'CHAT_CHANGED');
    expect(ok).toBe(true);
    handler!();
    expect(chatBookDisplay.book).toBeNull();
    expect(chatBookDisplay.updatedAt).toBeNull();
  });
  it('宿主事件 API 缺失（独立预览）→ 不安装返回 false', () => {
    expect(installChatChangedReset(undefined, undefined)).toBe(false);
  });
});

/* ═══════════════ girlFiler 改挂集成（验收 3/4：落点经守卫、pending 语义） ═══════════════ */

const dossier = (): Dossier => GirlDossier.parse({ name: '岚翎', model: 'F-47次机', alias: '岚家养女' });

function stubWorldbookStore(store: Map<string, ThEntry[]>): void {
  vi.stubGlobal('updateWorldbookWith', async (name: string, updater: (e: ThEntry[]) => ThEntry[]) => {
    const entries = store.get(name) ?? [];
    const next = updater(entries);
    store.set(name, next);
    return next;
  });
}

describe('girlFiler · fileDossier 改挂当前聊天档案书', () => {
  it('入档落入守卫放行的聊天书；档案/剧情/总览三条同书，comment 前缀分段', async () => {
    const store = new Map<string, ThEntry[]>();
    stubWorldbookStore(store);
    const { io } = makeIO({ chatId: 'chat-A', bound: null, books: [] });
    const gw = makeChatBookGateway(io);
    const receipt = await fileDossier(dossier(), gw);
    const book = '红警档案·红警指挥系统·20260922T1530';
    expect(receipt.dossier.book).toBe(book);
    expect(receipt.story.book).toBe(book);
    expect(receipt.story.rosterAction).toBe('roster-entry-created');
    const entries = store.get(book)!;
    expect(entries.map(e => e.name).sort()).toEqual(
      ['剧情·岚翎·人格与现状', '总览·机娘阵容与社会外壳总览', '档案·岚翎·F-47次机'].sort(),
    );
    // 渲染产物零改动：正文头仍为既有体例（只换落点不换内容）
    expect(entries.find(e => e.name.startsWith('档案·'))!.content).toContain('[机娘·能力档案 | 岚翎——F-47次机]');
    expect(entries.find(e => e.name.startsWith('剧情·'))!.content).toContain('[剧情·北坡纪事 | 岚翎——F-47次机]');
  });
  it('守卫失败 → 抛错，全局书零写入（pending_lore 留存语义由调用方 catch 承接）', async () => {
    const store = new Map<string, ThEntry[]>([['机娘·能力档案', []]]);
    stubWorldbookStore(store);
    const { io, state } = makeIO({
      chatId: 'chat-A',
      bound: '红警档案·X·20260101T0000',
      books: ['红警档案·X·20260101T0000', '机娘·能力档案'],
    });
    const gw = makeChatBookGateway(io);
    const txnBreaker = {
      begin: gw.begin.bind(gw),
      guardedBook: async (txn: { chatId: string }, opts: { createIfMissing: boolean }) => {
        state.chatId = 'chat-B'; // 首笔落笔前聊天已切换
        return gw.guardedBook(txn, opts);
      },
    };
    await expect(fileDossier(dossier(), txnBreaker)).rejects.toThrowError(GuardError);
    expect(store.get('机娘·能力档案')).toEqual([]); // 绝不静默降级写全局书
    expect(store.size).toBe(1);
  });
  it('建书失败 → 抛错（GuardError create-failed），调用方不清暂存', async () => {
    const store = new Map<string, ThEntry[]>();
    stubWorldbookStore(store);
    const { io } = makeIO({ chatId: 'chat-A', bound: null, books: [], createBehavior: 'throw' });
    await expect(fileDossier(dossier(), makeChatBookGateway(io))).rejects.toMatchObject({
      failure: { rule: 'create-failed' },
    });
    expect(store.size).toBe(0);
  });
  it('幂等重试：同一机娘二次提交 → 双段 updated、总览不重复', async () => {
    const store = new Map<string, ThEntry[]>();
    stubWorldbookStore(store);
    const { io } = makeIO({ chatId: 'chat-A', bound: null, books: [] });
    const gw = makeChatBookGateway(io);
    await fileDossier(dossier(), gw);
    const r2 = await fileDossier(dossier(), gw);
    expect(r2.dossier.action).toBe('updated');
    expect(r2.story.action).toBe('updated');
    expect(r2.story.rosterAction).toBe('already-present');
    const entries = store.get('红警档案·红警指挥系统·20260922T1530')!;
    expect(entries).toHaveLength(3);
  });
});
