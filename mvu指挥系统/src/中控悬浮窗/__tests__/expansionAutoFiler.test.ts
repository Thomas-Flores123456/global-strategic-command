/**
 * expansionAutoFiler.test.ts —— F1 扩展档案自动入档接线（中控台侧）
 *
 * ① 限定写纯函数：只移除已入档条目、只 upsert codex，其余字段逐字节不变；入参不被修改；
 * ② 编排：成功者清暂存、失败者留存；全失败不写变量；聊天漂移 fail-closed 不写变量；busy 重入跳过；
 * ③ 观察者：开关关 / 无暂存不触发；开且有暂存 → 入档并写后刷新；
 * ④ 视图纯函数：§2.4 前缀分组、扩展段可提升、建议名；
 * ⑤ 静态契约：ModalSettings「扩展」组、index.ts 唯一安装点、面板不自建观察者、提升默认勾选全局启用。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexEntry, ExpansionDossier } from '../../红警指挥系统/core/schema';
import {
  getSwipeSlot,
  readTimelineLedger,
  resetMemoryTimelineLedgerForTest,
} from '../../红警指挥系统/core/timelineLedger';
import {
  applyFiledToStatData,
  collectPendingExpansionsFromSnapshot,
  EXPANSION_AUTO_KEY,
  expansionFilerState,
  fileAllPendingExpansions,
  installExpansionAutoFiler,
  realAutoFilerDeps,
  runFromFloating,
  type AutoFilerDeps,
  type FloatingLike,
} from '../host/expansionAutoFiler';
import { groupChatBookEntries, prefixOf, suggestPromotion } from '../models/expansionView';

const DIR = join(__dirname, '..');
const MODAL_SETTINGS_SFC = readFileSync(join(DIR, 'modals/ModalSettings.vue'), 'utf8');
const PANEL_SFC = readFileSync(join(DIR, 'panels/PanelExpansionFiling.vue'), 'utf8');
const INDEX_TS = readFileSync(join(DIR, 'index.ts'), 'utf8');

function dossier(name: string, kind: ExpansionDossier['kind'] = '装备'): ExpansionDossier {
  return { name, kind, desc: `${name}摘要`, params: {}, detail: `${name}设定`, keys: [] };
}

function makeDeps(opts: { fail?: string[]; chatIds?: (string | null)[] } = {}) {
  const chatIds = [...(opts.chatIds ?? ['chatA', 'chatA'])];
  let vars: Record<string, unknown> = {};
  const deps: AutoFilerDeps & { vars: () => Record<string, unknown>; setVars: (v: Record<string, unknown>) => void } = {
    fileOne: vi.fn(async (d: ExpansionDossier, _g, sink: CodexEntry[]) => {
      if (opts.fail?.includes(d.name)) throw new Error(`守卫失败:${d.name}`);
      sink.push({ name: d.name, kind: d.kind, desc: d.desc, params: {} });
      return { name: d.name, kind: d.kind, book: '聊天书', action: 'created', entryName: `${d.kind}·${d.name}·设定` };
    }),
    updateFloorVars: vi.fn(async (_id: number, updater) => {
      vars = updater(vars);
    }),
    readChatId: vi.fn(() => (chatIds.length > 1 ? chatIds.shift()! : chatIds[0])),
    gateway: { begin: () => ({ chatId: 'chatA' }) as never, guardedBook: async () => '聊天书' },
    now: () => new Date('2026-09-23T12:00:00Z'),
    vars: () => vars,
    setVars: v => {
      vars = v;
    },
  };
  return deps;
}

beforeEach(() => {
  expansionFilerState.busy = false;
  expansionFilerState.auto = true;
  expansionFilerState.receipts.splice(0);
  resetMemoryTimelineLedgerForTest();
});

describe('F1 · applyFiledToStatData（限定写）', () => {
  it('只移除已入档条目、只 upsert codex，其余字段不变，入参不被修改', () => {
    const sd = {
      meta: { date: '2042-03-14' },
      pending_expansions: [dossier('静默折光伪装网'), dossier('未入档件')],
      codex: [{ name: '旧条', kind: '其他', desc: 'x', params: {} }],
      queues: [{ item: 'q' }],
    };
    const snapshot = structuredClone(sd);
    const next = applyFiledToStatData(
      sd,
      ['静默折光伪装网'],
      [{ name: '静默折光伪装网', kind: '装备', desc: 'd', params: {} }],
    );
    expect(sd).toStrictEqual(snapshot);
    expect((next.pending_expansions as ExpansionDossier[]).map(p => p.name)).toEqual(['未入档件']);
    expect((next.codex as CodexEntry[]).map(c => c.name)).toEqual(['旧条', '静默折光伪装网']);
    expect(next.meta).toBe(sd.meta);
    expect(next.queues).toBe(sd.queues);
  });

  it('codex 幂等：同名已存在则更新不重复', () => {
    const next = applyFiledToStatData(
      { codex: [{ name: 'A', kind: '装备', desc: '', params: {} }] },
      ['A'],
      [{ name: 'A', kind: '装备', desc: '新', params: {} }],
    );
    expect(next.codex).toHaveLength(1);
  });
});

describe('F1 · fileAllPendingExpansions（编排）', () => {
  it('成功者清暂存 + codex，失败者留存；写入目标为 floorId 楼', async () => {
    const deps = makeDeps({ fail: ['坏件'] });
    deps.setVars({ stat_data: { pending_expansions: [dossier('好件'), dossier('坏件')], codex: [] } });
    const out = await fileAllPendingExpansions({ floorId: 8, pending: [dossier('好件'), dossier('坏件')] }, deps);
    expect(out).toMatchObject({ filed: ['好件'], failed: ['坏件'], wroteVars: true });
    expect(deps.updateFloorVars).toHaveBeenCalledWith(8, expect.any(Function));
    const sd = deps.vars().stat_data as Record<string, unknown>;
    expect((sd.pending_expansions as ExpansionDossier[]).map(p => p.name)).toEqual(['坏件']);
    expect((sd.codex as CodexEntry[]).map(c => c.name)).toEqual(['好件']);
    expect(expansionFilerState.receipts.map(r => r.ok)).toEqual([false, true]);
  });

  it('全失败：不写变量（暂存保留，下轮重试）', async () => {
    const deps = makeDeps({ fail: ['坏件'] });
    const out = await fileAllPendingExpansions({ floorId: 8, pending: [dossier('坏件')] }, deps);
    expect(out.wroteVars).toBe(false);
    expect(deps.updateFloorVars).not.toHaveBeenCalled();
  });

  it('聊天漂移：条目已入书但 fail-closed 不写变量', async () => {
    const deps = makeDeps({ chatIds: ['chatA', 'chatB'] });
    const out = await fileAllPendingExpansions({ floorId: 8, pending: [dossier('好件')] }, deps);
    expect(out).toMatchObject({ filed: ['好件'], wroteVars: false });
    expect(deps.updateFloorVars).not.toHaveBeenCalled();
  });

  it('busy 重入跳过；floorId 为空或无暂存跳过', async () => {
    const deps = makeDeps();
    expansionFilerState.busy = true;
    expect((await fileAllPendingExpansions({ floorId: 1, pending: [dossier('a')] }, deps)).skipped).toBe('busy');
    expansionFilerState.busy = false;
    expect((await fileAllPendingExpansions({ floorId: null, pending: [dossier('a')] }, deps)).skipped).toBe('empty');
    expect((await fileAllPendingExpansions({ floorId: 1, pending: [] }, deps)).skipped).toBe('empty');
    expect(deps.fileOne).not.toHaveBeenCalled();
    expect(expansionFilerState.busy).toBe(false);
  });
});

describe('F1 · installExpansionAutoFiler（观察者）', () => {
  function fakeFloating(pending: ExpansionDossier[]) {
    let cb: (() => void) | null = null;
    const f: FloatingLike & { fire: () => void } = {
      snapshot: { pending_expansions: pending },
      floorId: 8,
      refresh: vi.fn(async () => null),
      onRefresh: c => {
        cb = c;
        return () => {
          cb = null;
        };
      },
      fire: () => cb?.(),
    };
    return f;
  }

  it('开关开且有暂存：入档 → 限定写 → 写后刷新', async () => {
    const deps = makeDeps();
    const f = fakeFloating([dossier('静默折光伪装网')]);
    installExpansionAutoFiler(f, deps);
    f.fire();
    await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(1));
    expect(deps.fileOne).toHaveBeenCalledTimes(1);
  });

  it('开关关 / 无暂存：不触发；卸载后不再响应', async () => {
    const deps = makeDeps();
    expansionFilerState.auto = false;
    const f = fakeFloating([dossier('x')]);
    const stop = installExpansionAutoFiler(f, deps);
    f.fire();
    expansionFilerState.auto = true;
    const empty = fakeFloating([]);
    installExpansionAutoFiler(empty, deps);
    empty.fire();
    stop();
    f.fire();
    await Promise.resolve();
    expect(deps.fileOne).not.toHaveBeenCalled();
  });

  it('开关键为独立 localStorage 键，默认开', () => {
    expect(EXPANSION_AUTO_KEY).toBe('rts-expansion-autofile');
    expect(readFileSync(join(DIR, 'host/expansionAutoFiler.ts'), 'utf8')).toMatch(/!== 'off'/);
  });
});

describe('F1 · expansionView（§2.4 / §4.1）', () => {
  it('前缀分组：扩展段可提升，机娘/摘要段只列', () => {
    const groups = groupChatBookEntries([
      { name: '档案·宁渺·x' },
      { name: '装备·静默折光伪装网·设定' },
      { name: '摘要·001-004' },
      { name: '随手条目' },
    ]);
    expect(groups.map(g => [g.prefix, g.promotable])).toEqual([
      ['装备', true],
      ['档案', false],
      ['摘要', false],
      ['其他', false],
    ]);
    expect(prefixOf('科技·A·设定')).toBe('科技');
  });

  it('建议名：书名 红警扩展·{条目名}，条目名去前缀', () => {
    expect(suggestPromotion('装备·静默折光伪装网·设定')).toEqual({
      bookName: '红警扩展·静默折光伪装网',
      entryName: '静默折光伪装网',
    });
  });
});

describe('F1 · 静态契约（中控台落点）', () => {
  it('ModalSettings 追加「扩展」组并以 #panel-expansion 挂载 PanelExpansionFiling', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'expansion',\s*label:\s*'扩展(?:入档)?'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-expansion[\s\S]*?<PanelExpansionFiling\s*\/>/);
  });

  it('index.ts 为唯一安装点，卸载时停止；面板不自建观察者', () => {
    expect(INDEX_TS).toMatch(/installExpansionAutoFiler\(store\)/);
    expect(INDEX_TS).toMatch(/stopExpansionFiler\?\.\(\)/);
    const code = PANEL_SFC.replace(/<!--[\s\S]*?-->/g, '');
    expect(code).not.toMatch(/installExpansionAutoFiler/);
    expect(code).not.toMatch(/\bwatch\(/);
  });

  it('提升对话框：默认勾选全局启用、撞名即时校验、走 promoteEntry 五步流，且手动草稿 stageManualDraft 调 updateFloorVars 落盘（BUG-R2-13）', () => {
    expect(PANEL_SFC).toMatch(/enableGlobal: true/);
    expect(PANEL_SFC).toMatch(/bookNameConflict/);
    expect(PANEL_SFC).toMatch(/skipGlobalRebind: !d\.enableGlobal/);
    expect(PANEL_SFC).toMatch(/promoteEntry\(/);
    expect(PANEL_SFC).toMatch(/retryDeleteOriginalEntry\(/);
    expect(PANEL_SFC).toMatch(/import\s*\{\s*updateFloorVars\s*\}\s*from '\.\.\/host\/floorVarWrite'/);
    expect(PANEL_SFC).toMatch(/async function stageManualDraft\(\)[\s\S]*?updateFloorVars\(/);
  });
});

describe('CHATBOOK-HOST-WIRE-01 · expansionAutoFiler 非零 swipeId 与 afterEntry 快照采集', () => {
  it('swipe_id = 2 时，wbJournal 准确记录到 s_2 而非 s_0，且写入后采集 afterEntry 快照', async () => {
    const bookName = '红警档案·测试卡·20261020';
    const worldbookEntries: Array<{ name: string; content: string; enabled: boolean; keys?: string[] }> = [];
    const d = dossier('光棱折光塔', '建筑');
    const targetEntryName = '建筑·光棱折光塔·设定';

    const deps = makeDeps();
    deps.readSwipeId = vi.fn((floorId: number) => (floorId === 6 ? 2 : 0));
    deps.gateway = {
      begin: () => ({ chatId: 'chatA' }) as never,
      guardedBook: async () => bookName,
      getChatWorldbookName: () => bookName,
      getWorldbookNames: () => [bookName],
      getWorldbook: async () => worldbookEntries,
    };
    deps.fileOne = vi.fn(async (item: ExpansionDossier, _g, sink: CodexEntry[]) => {
      worldbookEntries.push({
        name: targetEntryName,
        content: `[建筑] ${item.name}：${item.detail}`,
        enabled: true,
        keys: [item.name],
      });
      sink.push({ name: item.name, kind: item.kind, desc: item.desc, params: {} });
      return {
        name: item.name,
        kind: item.kind,
        book: bookName,
        action: 'created' as const,
        entryName: targetEntryName,
      };
    });

    const out = await fileAllPendingExpansions({ floorId: 6, pending: [d] }, deps);
    expect(out.filed).toEqual(['光棱折光塔']);
    expect(deps.readSwipeId).toHaveBeenCalledWith(6);

    const ledger = readTimelineLedger();
    expect(getSwipeSlot(ledger, 6, 0)).toBeUndefined();
    const slot2 = getSwipeSlot(ledger, 6, 2);
    expect(slot2).toBeDefined();
    expect(slot2!.wbJournal).toHaveLength(1);
    expect(slot2!.wbJournal[0]).toMatchObject({
      floorId: 6,
      swipeId: 2,
      bookName,
      entryName: targetEntryName,
      op: 'create',
      beforeEntry: null,
    });
    expect(slot2!.wbJournal[0].afterEntry).toMatchObject({
      name: targetEntryName,
      content: '[建筑] 光棱折光塔：光棱折光塔设定',
      enabled: true,
    });
  });

  it('realAutoFilerDeps.readSwipeId 从宿主 getChatMessages 读取真实 swipe_id，非有限整数回退 0', () => {
    const g = globalThis as Record<string, unknown>;
    const prev = g.getChatMessages;
    try {
      g.getChatMessages = (id: number) => (id === 4 ? [{ swipe_id: 2 }] : [{ swipe_id: Number.NaN }]);
      expect(realAutoFilerDeps.readSwipeId?.(4)).toBe(2);
      expect(realAutoFilerDeps.readSwipeId?.(5)).toBe(0);
    } finally {
      g.getChatMessages = prev;
    }
  });

  it('G08-03：读取来源快照后、进入 fileExpansion 之前发生切聊天或切绑定书时，事务守卫拒绝写入会话 B 的聊天书且不核销', async () => {
    const g = globalThis as Record<string, unknown>;
    const savedUww = g.updateWorldbookWith;
    let currentChatId = 'chatA';
    let boundBook = '红警档案·A';
    const books: Record<string, unknown[]> = { '红警档案·A': [], '红警档案·B': [] };

    g.updateWorldbookWith = vi.fn(async (bookName: string, updater: (entries: unknown[]) => unknown[]) => {
      books[bookName] = updater(books[bookName] ?? []);
      return books[bookName];
    });

    const deps = makeDeps();
    deps.readChatId = () => currentChatId;
    deps.gateway = {
      begin: () => ({ chatId: currentChatId }),
      guardedBook: async txn => {
        if (txn.chatId !== currentChatId) throw new Error(`chat drift: ${txn.chatId} vs ${currentChatId}`);
        return boundBook;
      },
      getChatWorldbookName: () => {
        // 模拟写前快照采集后、进入 fileExpansion.begin() 前切换了聊天/绑定书
        const prev = boundBook;
        currentChatId = 'chatB';
        boundBook = '红警档案·B';
        return prev;
      },
      getWorldbookNames: () => Object.keys(books),
      getWorldbook: async name => (books[name] as never[]) ?? [],
    };
    deps.fileOne = (d, gateway, sink) => realAutoFilerDeps.fileOne(d, gateway, sink);

    try {
      const out = await fileAllPendingExpansions({ floorId: 6, pending: [dossier('超时空矿车', '载具')] }, deps);
      expect(out.filed).toEqual([]);
      expect(out.failed).toEqual(['超时空矿车']);
      expect(out.wroteVars).toBe(false);
      expect(books['红警档案·B']).toHaveLength(0);
      expect(deps.updateFloorVars).not.toHaveBeenCalled();
    } finally {
      g.updateWorldbookWith = savedUww;
    }
  });

  it('BUG-LIVE-28c（#86楼实机复现）：<图鉴> 推入 pending_lore 的新地点/新人物由 expansionAutoFiler 自动入档至聊天世界书并从 pending_lore 核销，保留同槽未入档机娘与新势力', async () => {
    const deps = makeDeps();
    const codexLorePlace = {
      id: 'lore_荒坂恶土深层核掩体中枢',
      kind: '地点',
      name: '荒坂恶土深层核掩体中枢',
      summary: '荒坂集团依托红峰荒原旧洲际导弹发射井改建的地下三层战略指挥中枢。',
      is_new: true,
      source_floor: 86,
      source_swipe: 0,
      created_day: 25,
      raw: {
        tag: '图鉴',
        codex: {
          name: '荒坂恶土深层核掩体中枢',
          kind: '地点',
          desc: '荒坂集团依托红峰荒原旧洲际导弹发射井改建的地下三层战略指挥中枢。',
          params: {},
        },
      },
    };
    const preservedFaction = {
      id: 'lore_荒坂远东清剿军',
      kind: '势力',
      name: '荒坂远东清剿军',
      summary: '荒坂直属特种清剿武装',
      source_floor: 86,
      source_swipe: 0,
      created_day: 25,
    };
    const preservedGirl = {
      name: '苏离',
      model: 'F-47首台',
      keys: ['静默电行'],
      shell: '绣坊帮工',
    };

    deps.setVars({
      stat_data: {
        pending_expansions: [],
        pending_lore: [codexLorePlace, preservedFaction, preservedGirl],
        codex: [],
      },
    });

    const collected = collectPendingExpansionsFromSnapshot({
      pending_expansions: [],
      pending_lore: [codexLorePlace, preservedFaction, preservedGirl],
    });
    expect(collected).toEqual([
      {
        name: '荒坂恶土深层核掩体中枢',
        kind: '地点',
        desc: '荒坂集团依托红峰荒原旧洲际导弹发射井改建的地下三层战略指挥中枢。',
        params: {},
        detail: '荒坂集团依托红峰荒原旧洲际导弹发射井改建的地下三层战略指挥中枢。',
        keys: ['荒坂恶土深层核掩体中枢'],
      },
    ]);

    const f: FloatingLike = {
      snapshot: {
        pending_expansions: [],
        pending_lore: [codexLorePlace, preservedFaction, preservedGirl],
      },
      floorId: 86,
      refresh: vi.fn(async () => {}),
      onRefresh: () => () => {},
    };
    const out = await runFromFloating(f, deps);
    expect(out.filed).toEqual(['荒坂恶土深层核掩体中枢']);
    expect(out.wroteVars).toBe(true);

    const sd = deps.vars().stat_data as Record<string, unknown>;
    expect(sd.pending_lore).toEqual([preservedFaction, preservedGirl]);
    expect((sd.codex as CodexEntry[]).map(c => `${c.kind}·${c.name}`)).toContain(
      '地点·荒坂恶土深层核掩体中枢',
    );
  });
});

