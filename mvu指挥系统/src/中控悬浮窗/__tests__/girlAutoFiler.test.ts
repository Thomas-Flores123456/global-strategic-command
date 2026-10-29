/**
 * girlAutoFiler.test.ts —— 机娘自动入档观察者测试（CTRL-FLOOR-SLIM-01）
 *
 * 验收要求：
 * 1. applyFiledGirlsToStatData（限定写）：只移除已入档条目、只 upsert codex，其余字段不变，入参不被修改；
 * 2. fileAllPendingGirls（编排）：成功者清暂存 + codex，失败者留存；写入目标为 floorId 楼；
 * 3. 聊天 ID 漂移 fail-closed：写前复核聊天发生变化，中止写入；
 * 4. installGirlAutoFiler 观察者生命周期：开关关 / 无暂存不触发；开且有暂存触发入档并写后刷新。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileDeletedFloorsAbove } from '../../红警指挥系统/composables/useParse';
import { renderRosterLine, type Dossier } from '../../红警指挥系统/worldbook/girlFiler';
import { ROSTER_ENTRY_NAME, type WorldbookEntry } from '../../红警指挥系统/worldbook/chatBookBinding';
import type { CodexEntry } from '../../红警指挥系统/core/schema';
import {
  getSwipeSlot,
  readTimelineLedger,
  resetMemoryTimelineLedgerForTest,
} from '../../红警指挥系统/core/timelineLedger';
import {
  applyFiledGirlsToStatData,
  fileAllPendingGirls,
  filerState,
  girlFilerState,
  installGirlAutoFiler,
  realGirlAutoFilerDeps,
  runGirlAutoFilerFromFloating,
  setGirlAutoFile,
  type GirlAutoFilerDeps,
  type FloatingLike,
} from '../host/girlAutoFiler';
import { confirmAndCommitPendingLore, stagePendingLore } from '../../红警指挥系统/worldbook/pendingLoreGate';

function makeDossier(name: string, model: string = '原型机'): Dossier {
  return {
    name,
    model,
    quote: `${name}的座右铭`,
    tags: ['战术', '支援'],
    abilities: [{ name: '技能A', type: '主动', effect: '效果A' }],
  };
}

function makeDeps(opts: { fail?: string[]; chatIds?: (string | null)[] } = {}) {
  const chatIds = [...(opts.chatIds ?? ['chatA', 'chatA'])];
  let vars: Record<string, unknown> = {};
  const deps: GirlAutoFilerDeps & {
    vars: () => Record<string, unknown>;
    setVars: (v: Record<string, unknown>) => void;
  } = {
    fileOne: vi.fn(async (d: Dossier) => {
      if (opts.fail?.includes(d.name)) throw new Error(`入档失败:${d.name}`);
      return {
        dossier: { action: 'created', entryName: d.name },
        story: { action: 'created', entryName: d.name, rosterAction: 'appended' as const },
      };
    }),
    updateFloorVars: vi.fn(async (_id: number, updater) => {
      vars = updater(vars);
    }),
    readChatId: vi.fn(() => (chatIds.length > 1 ? chatIds.shift()! : chatIds[0])),
    now: () => new Date('2026-09-24T03:30:00Z'),
    vars: () => vars,
    setVars: v => {
      vars = v;
    },
  };
  return deps;
}

beforeEach(() => {
  filerState.busy = false;
  filerState.auto = true;
  filerState.receipts.splice(0);
  resetMemoryTimelineLedgerForTest();
});

describe('girlAutoFiler · applyFiledGirlsToStatData（限定写纯函数）', () => {
  it('只移除已入档条目、只 upsert codex，其余字段不变，入参不被修改', () => {
    const d1 = makeDossier('白凌');
    const d2 = makeDossier('红珊');
    const sd = {
      meta: { date: '2042-03-14' },
      pending_lore: [d1, d2],
      codex: [{ name: '原有条目', kind: '人员', desc: '旧条目描述', params: {} }],
      economy: { credits: 1000 },
    };
    const snapshot = structuredClone(sd);
    const next = applyFiledGirlsToStatData(sd, ['白凌'], [d1]);

    expect(sd).toStrictEqual(snapshot);
    expect((next.pending_lore as Dossier[]).map(p => p.name)).toEqual(['红珊']);
    expect((next.codex as CodexEntry[]).map(c => c.name)).toEqual(['原有条目', '白凌']);
    expect(next.meta).toBe(sd.meta);
    expect(next.economy).toBe(sd.economy);
  });

  it('codex 幂等：同名已存在则不重复追加', () => {
    const d = makeDossier('白凌');
    const next = applyFiledGirlsToStatData(
      { codex: [{ name: '白凌', kind: '人员', desc: '既有描述', params: {} }] },
      ['白凌'],
      [d],
    );
    expect(next.codex).toHaveLength(1);
  });
});

describe('girlAutoFiler · fileAllPendingGirls（编排与限定写）', () => {
  it('成功者清暂存 + 派生 codex，失败者留存；写入目标为 floorId 楼', async () => {
    const dGood = makeDossier('好机娘');
    const dBad = makeDossier('坏机娘');
    const deps = makeDeps({ fail: ['坏机娘'] });
    deps.setVars({ stat_data: { pending_lore: [dGood, dBad], codex: [] } });

    const out = await fileAllPendingGirls({ floorId: 9, pending: [dGood, dBad] }, deps);

    expect(out.filed).toEqual(['好机娘']);
    expect(out.failed).toEqual(['坏机娘']);
    expect(out.wroteVars).toBe(true);

    const saved = deps.vars().stat_data as { pending_lore: Dossier[]; codex: CodexEntry[] };
    expect(saved.pending_lore.map(p => p.name)).toEqual(['坏机娘']);
    expect(saved.codex.map(c => c.name)).toEqual(['好机娘']);
  });

  it('聊天 ID 漂移时 fail-closed：中止变量写入，保留暂存', async () => {
    const d = makeDossier('白凌');
    // 开始时 chatA，入档完成后查变为 chatB
    const deps = makeDeps({ chatIds: ['chatA', 'chatB'] });
    deps.setVars({ stat_data: { pending_lore: [d], codex: [] } });

    const out = await fileAllPendingGirls({ floorId: 5, pending: [d] }, deps);

    expect(out.filed).toEqual(['白凌']);
    expect(out.wroteVars).toBe(false);
    expect(deps.updateFloorVars).not.toHaveBeenCalled();
    expect(filerState.receipts[0]?.note).toContain('聊天已切换');
  });

  it('全部失败时不调用 updateFloorVars', async () => {
    const d = makeDossier('失败机娘');
    const deps = makeDeps({ fail: ['失败机娘'] });

    const out = await fileAllPendingGirls({ floorId: 5, pending: [d] }, deps);

    expect(out.filed).toHaveLength(0);
    expect(out.wroteVars).toBe(false);
    expect(deps.updateFloorVars).not.toHaveBeenCalled();
  });
});

describe('girlAutoFiler · installGirlAutoFiler（观察者与刷新联动）', () => {
  it('自动开关为 false 时不触发入档', () => {
    filerState.auto = false;
    let refreshCb!: () => void;
    const floating: FloatingLike = {
      snapshot: { pending_lore: [makeDossier('白凌')] },
      floorId: 3,
      refresh: vi.fn(),
      onRefresh: vi.fn(cb => {
        refreshCb = cb;
        return () => {};
      }),
    };
    const deps = makeDeps();

    installGirlAutoFiler(floating, deps);
    refreshCb();

    expect(deps.fileOne).not.toHaveBeenCalled();
  });

  it('开关开启且有 pending_lore 时自动触发入档并在写入后调用 floating.refresh', async () => {
    filerState.auto = true;
    let refreshCb!: () => void;
    const floating: FloatingLike = {
      snapshot: { pending_lore: [makeDossier('白凌')] },
      floorId: 7,
      refresh: vi.fn(async () => {}),
      onRefresh: vi.fn(cb => {
        refreshCb = cb;
        return () => {};
      }),
    };
    const deps = makeDeps();
    deps.setVars({ stat_data: { pending_lore: [makeDossier('白凌')], codex: [] } });

    installGirlAutoFiler(floating, deps);
    refreshCb();

    await vi.waitFor(() => {
      expect(deps.fileOne).toHaveBeenCalledTimes(1);
      expect(deps.updateFloorVars).toHaveBeenCalledTimes(1);
      expect(floating.refresh).toHaveBeenCalled();
    });
  });

  it('FIX-P0-02 交叉回归：同一楼层 pending_lore 同时含 1 条 GirlDossier 与 1 条新势力对象时，先跑 girlAutoFiler 不抛错且保留新势力，或先跑 pendingLoreGate 确认新势力后未入档 GirlDossier 完好保留', async () => {
    const girl = {
      ...makeDossier('苏离', 'F-47首台'),
      keys: ['静默电行'],
      shell: '绣坊帮工',
    } as Dossier;
    const stagedFaction = stagePendingLore(
      [],
      [{ name: '铁幕重工', kind: '势力', summary: '北境军工残部' }],
      { floor: 6, swipe: 0, day: 10 },
    ).added[0];

    // 路径 A：先跑 girlAutoFiler → 不因新势力缺 keys/shell 崩溃，且写回 pending_lore 完好保留新势力
    const deps = makeDeps();
    deps.setVars({
      stat_data: {
        pending_lore: [girl, stagedFaction],
        codex: [],
      },
    });
    const outA = await fileAllPendingGirls({ floorId: 6, pending: [girl, stagedFaction] }, deps);
    expect(outA.filed).toEqual(['苏离']);
    expect(outA.failed).toEqual([]);
    expect(outA.wroteVars).toBe(true);
    expect(deps.fileOne).toHaveBeenCalledTimes(1);
    const savedAfterGirl = (deps.vars().stat_data as { pending_lore: unknown[] }).pending_lore;
    expect(savedAfterGirl).toEqual([stagedFaction]);

    // 路径 B：先跑 pendingLoreGate 确认新势力 → 未入档 GirlDossier 完好保留在 remaining 中
    const confirmOut = await confirmAndCommitPendingLore([girl, stagedFaction], {
      ids: [stagedFaction.id],
      write: async () => {},
    });
    expect(confirmOut.ok).toBe(true);
    expect(confirmOut.committed.map(c => c.name)).toEqual(['铁幕重工']);
    expect(confirmOut.remaining).toEqual([girl]);
  });

  it('FIX-P0-02 回执映射：roster-entry-created 显示为「已建花名册并登记」，且兼容导出别名完备', async () => {
    expect(girlFilerState).toBe(filerState);
    expect(typeof setGirlAutoFile).toBe('function');
    expect(typeof runGirlAutoFilerFromFloating).toBe('function');

    const girl = makeDossier('岚翎', '侦察机');
    const deps = makeDeps();
    deps.fileOne = vi.fn(async (d: Dossier) => ({
      girl: d.name,
      dossier: { book: 'RA_ChatBook_1', action: 'created', entryName: `档案·${d.name}·${d.model}` },
      story: {
        book: 'RA_ChatBook_1',
        action: 'created',
        entryName: `剧情·${d.name}·人格与现状`,
        rosterAction: 'roster-entry-created',
      },
    }));
    deps.setVars({ stat_data: { pending_lore: [girl], codex: [] } });

    await fileAllPendingGirls({ floorId: 2, pending: [girl] }, deps);
    expect(filerState.receipts[0]?.note).toContain('总览已建花名册并登记');
  });

  it('CHATBOOK-HOST-WIRE-01：swipe_id = 2 时 wbJournal 记入 s_2 而非 s_0，entryNames 对齐完整前缀且 rosterLineAdded 与 renderRosterLine 一致，删楼回滚 100% 清除新建条目与花名册行', async () => {
    const g = globalThis as Record<string, unknown>;
    const saved = {
      gcwn: g.getChatWorldbookName,
      gwn: g.getWorldbookNames,
      gw: g.getWorldbook,
      uww: g.updateWorldbookWith,
      gcm: g.getChatMessages,
    };

    const bookName = '红警档案·测试卡·20261020';
    const initialRosterLine = '· 白凌——盟军MCV首台。对外：沈家掌柜。';
    const worldbooks: Record<string, WorldbookEntry[]> = {
      [bookName]: [
        {
          name: ROSTER_ENTRY_NAME,
          content: `[本聊天机娘阵容总览]\n${initialRosterLine}`,
          enabled: true,
        },
      ],
    };

    g.getChatWorldbookName = () => bookName;
    g.getWorldbookNames = () => [bookName];
    g.getWorldbook = async (name: string) => worldbooks[name] ?? [];
    g.updateWorldbookWith = async (name: string, updater: (entries: WorldbookEntry[]) => WorldbookEntry[]) => {
      worldbooks[name] = updater(worldbooks[name] ?? []);
    };
    g.getChatMessages = (id: number) => (id === 4 ? [{ swipe_id: 2 }] : [{ swipe_id: 0 }]);

    try {
      const girl: Dossier = {
        ...makeDossier('喀秋莎', 'BM-30重火箭炮'),
        alias: '柳叶卡',
        shell: '车队机械师',
      };
      const expectedDossierName = `档案·${girl.name}·${girl.model}`;
      const expectedStoryName = `剧情·${girl.name}·人格与现状`;
      const expectedRosterLine = renderRosterLine(girl);

      const deps = makeDeps();
      deps.readSwipeId = floorId => realGirlAutoFilerDeps.readSwipeId!(floorId);
      deps.fileOne = vi.fn(async (d: Dossier) => {
        const line = renderRosterLine(d);
        worldbooks[bookName] = [
          {
            name: ROSTER_ENTRY_NAME,
            content: `[本聊天机娘阵容总览]\n${initialRosterLine}\n${line}`,
            enabled: true,
          },
          {
            name: expectedDossierName,
            content: `[机娘·能力档案 | ${d.name}——${d.model}]`,
            enabled: true,
            keys: [d.name],
          },
          {
            name: expectedStoryName,
            content: `[剧情·北坡纪事 | ${d.name}——${d.model}]`,
            enabled: true,
            keys: [d.name],
          },
        ];
        return {
          girl: d.name,
          dossier: { book: bookName, action: 'created' as const, entryName: expectedDossierName },
          story: {
            book: bookName,
            action: 'created' as const,
            entryName: expectedStoryName,
            rosterAction: 'appended' as const,
          },
        };
      });
      deps.setVars({ stat_data: { pending_lore: [girl], codex: [] } });

      const out = await fileAllPendingGirls({ floorId: 4, pending: [girl] }, deps);
      expect(out.filed).toEqual(['喀秋莎']);

      // 1. 验证 wbJournal 准确记录到 s_2 而非 s_0
      const ledger = readTimelineLedger();
      expect(getSwipeSlot(ledger, 4, 0)).toBeUndefined();
      const slot2 = getSwipeSlot(ledger, 4, 2);
      expect(slot2).toBeDefined();
      expect(slot2!.wbJournal).toHaveLength(2);

      // 2. 验证 entryNames 为完整的 档案·{名}·{型号} 与 剧情·{名}·人格与现状，且 rosterLineAdded === renderRosterLine(d)
      expect(slot2!.wbJournal.map(r => r.entryName)).toEqual([expectedDossierName, expectedStoryName]);
      expect(slot2!.wbJournal[0].rosterLineAdded).toBe(expectedRosterLine);
      expect(slot2!.wbJournal[0].afterEntry?.name).toBe(expectedDossierName);
      expect(slot2!.wbJournal[1].afterEntry?.name).toBe(expectedStoryName);

      // 3. 验证删楼回滚时能 100% 删掉新建的机娘条目与花名册追加行
      const rollbackOut = await reconcileDeletedFloorsAbove(3);
      expect(rollbackOut.prunedFloors).toContain(4);
      expect(rollbackOut.rolledBackWbCount).toBe(2);

      const entriesAfterRollback = worldbooks[bookName];
      expect(entriesAfterRollback.find(e => e.name === expectedDossierName)).toBeUndefined();
      expect(entriesAfterRollback.find(e => e.name === expectedStoryName)).toBeUndefined();
      const rosterEntryAfter = entriesAfterRollback.find(e => e.name === ROSTER_ENTRY_NAME);
      expect(rosterEntryAfter?.content).toBe(`[本聊天机娘阵容总览]\n${initialRosterLine}`);
      expect(rosterEntryAfter?.content).not.toContain('喀秋莎');
    } finally {
      g.getChatWorldbookName = saved.gcwn;
      g.getWorldbookNames = saved.gwn;
      g.getWorldbook = saved.gw;
      g.updateWorldbookWith = saved.uww;
      g.getChatMessages = saved.gcm;
    }
  });

  it('CHATBOOK-HOST-WIRE-01：reconcileDeletedFloorsAbove 越界摘要清理+解隐 & onMessageSwiped 切页世界书双向联动', async () => {
    const g = globalThis as Record<string, unknown>;
    const saved = {
      gcwn: g.getChatWorldbookName,
      gwn: g.getWorldbookNames,
      gw: g.getWorldbook,
      uww: g.updateWorldbookWith,
      scm: g.setChatMessages,
      te: g.tavern_events,
    };

    const bookName = '红警档案·测试卡·20261020';
    const worldbooks: Record<string, WorldbookEntry[]> = {
      [bookName]: [
        { name: '摘要·001-010', content: '1到10楼摘要', enabled: true, extra: { from: 1, to: 10 } } as WorldbookEntry,
        { name: '摘要·011-020', content: '11到20楼摘要', enabled: true, extra: { from: 11, to: 20 } } as WorldbookEntry,
      ],
    };
    const unhiddenPayloads: Array<Array<{ message_id: number; is_hidden?: boolean }>> = [];

    g.getChatWorldbookName = () => bookName;
    g.getWorldbookNames = () => [bookName];
    g.getWorldbook = async (name: string) => worldbooks[name] ?? [];
    g.updateWorldbookWith = async (name: string, updater: (entries: WorldbookEntry[]) => WorldbookEntry[]) => {
      worldbooks[name] = updater(worldbooks[name] ?? []);
    };
    g.setChatMessages = async (msgs: Array<{ message_id: number; is_hidden?: boolean }>) => {
      unhiddenPayloads.push(msgs);
    };

    try {
      // A. 删楼至 #15，摘要·011-020 (to=20 > 15) 越界应被剔除，且 [11, 15] 被解隐，摘要·001-010 保留
      await reconcileDeletedFloorsAbove(15);
      expect(worldbooks[bookName].map(e => e.name)).toEqual(['摘要·001-010']);
      expect(unhiddenPayloads).toHaveLength(1);
      expect(unhiddenPayloads[0]).toEqual([
        { message_id: 11, is_hidden: false },
        { message_id: 12, is_hidden: false },
        { message_id: 13, is_hidden: false },
        { message_id: 14, is_hidden: false },
        { message_id: 15, is_hidden: false },
      ]);

      // B. onMessageSwiped 触发 Swipe 切页世界书同步（从 s_0 切到 s_1 卸载 s_0 词条，再切回 s_0 重放 afterEntry）
      const { installFloorObservers, teardownFloorObservers } = await import('../host/floorObservers');
      const dSwipe0 = makeDossier('白凌', 'MCV');
      const depsFile = makeDeps();
      depsFile.readSwipeId = () => 0;
      depsFile.fileOne = vi.fn(async (d: Dossier) => {
        const entryName = `档案·${d.name}·${d.model}`;
        worldbooks[bookName].push({ name: entryName, content: '白凌s0档案', enabled: true });
        return {
          girl: d.name,
          dossier: { book: bookName, action: 'created' as const, entryName },
          story: {
            book: bookName,
            action: 'created' as const,
            entryName: `剧情·${d.name}·人格与现状`,
            rosterAction: 'already-present' as const,
          },
        };
      });
      await fileAllPendingGirls({ floorId: 5, pending: [dSwipe0] }, depsFile);
      expect(worldbooks[bookName].some(e => e.name === '档案·白凌·MCV')).toBe(true);

      let currentSwipe = 1;
      const listeners: Record<string, ((...args: unknown[]) => unknown)[]> = {};
      g.tavern_events = { MESSAGE_SWIPED: 'tavern_message_swiped' };
      teardownFloorObservers();
      installFloorObservers(
        { refresh: vi.fn(async () => {}) },
        {
          runParse: vi.fn(async () => 'parsed'),
          getLastMessageId: () => 5,
          getChatMessages: () => [{ role: 'assistant', is_hidden: false, swipe_id: currentSwipe }],
          readChatId: () => 'chatA',
          eventOn: (evt, cb) => {
            (listeners[evt] ??= []).push(cb);
            return { stop: () => {} };
          },
        },
      );

      // 切到 swipe 1：卸载 swipe 0 入档的 档案·白凌·MCV
      await listeners['tavern_message_swiped'][0](5);
      expect(worldbooks[bookName].some(e => e.name === '档案·白凌·MCV')).toBe(false);

      // 切回 swipe 0：通过 afterEntry 自动重放恢复 档案·白凌·MCV
      currentSwipe = 0;
      await listeners['tavern_message_swiped'][0](5);
      expect(worldbooks[bookName].some(e => e.name === '档案·白凌·MCV')).toBe(true);
      teardownFloorObservers();
    } finally {
      g.getChatWorldbookName = saved.gcwn;
      g.getWorldbookNames = saved.gwn;
      g.getWorldbook = saved.gw;
      g.updateWorldbookWith = saved.uww;
      g.setChatMessages = saved.scm;
      g.tavern_events = saved.te;
    }
  });

  it('G08-03：读取来源快照后、进入 fileDossier 之前发生切聊天或切绑定书时，事务守卫拒绝写入会话 B 的聊天书且不核销', async () => {
    const g = globalThis as Record<string, unknown>;
    const savedUww = g.updateWorldbookWith;
    let currentChatId = 'chatA';
    let boundBook = '红警档案·A';
    const books: Record<string, WorldbookEntry[]> = { '红警档案·A': [], '红警档案·B': [] };

    g.updateWorldbookWith = vi.fn(async (bookName: string, updater: (entries: WorldbookEntry[]) => WorldbookEntry[]) => {
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
        // 模拟写前快照采集后、进入 fileDossier.begin() 前切换了聊天/绑定书
        const prev = boundBook;
        currentChatId = 'chatB';
        boundBook = '红警档案·B';
        return prev;
      },
      getWorldbookNames: () => Object.keys(books),
      getWorldbook: async name => books[name] ?? [],
    };
    deps.fileOne = (d, gateway) => realGirlAutoFilerDeps.fileOne(d, gateway);

    try {
      const out = await fileAllPendingGirls({ floorId: 5, pending: [makeDossier('白凌', 'MCV')] }, deps);
      expect(out.filed).toEqual([]);
      expect(out.failed).toEqual(['白凌']);
      expect(out.wroteVars).toBe(false);
      expect(books['红警档案·B']).toHaveLength(0);
      expect(deps.updateFloorVars).not.toHaveBeenCalled();
    } finally {
      g.updateWorldbookWith = savedUww;
    }
  });
});

