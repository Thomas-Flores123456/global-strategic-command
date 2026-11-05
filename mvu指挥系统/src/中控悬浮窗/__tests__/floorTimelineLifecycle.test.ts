/**
 * floorTimelineLifecycle.test.ts —— 全量时间线生命周期与过程量重放闭环测试（17号方案A · SEAM-01 / SEAM-02）
 *
 * 覆盖验收：
 * 1. MESSAGE_DELETED 触发时自动清理高于最新楼层的 $parse.done / quarantine / issues / reports 与 $timeline，
 *    并自动逆向回滚被删楼层写入聊天世界书的机娘/扩展词条；
 * 2. 在某楼执行交互过程量（排产批准 COMMIT_PLANNING、时序裁决 CHRONO_RESOLVE、YAML 修复 SUBMIT_FIX、
 *    数据补丁裁决 PATCH_DECISION）后重跑 runParseFor(mid, true)，过程量 100% 幂等重放保留；
 * 3. cascadeRecomputeDownstream 下游级联重算：修改中间楼后自动向后逐楼重算并保留各楼过程量；
 * 4. CHAT_CHANGED 开分支切换聊天时自动克隆专属档案世界书并裁剪高层残留记录。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveCatalog } from '../../红警指挥系统/core/catalogEffective';
import { computePlanFingerprint, type ParsedPlanningIntent } from '../../红警指挥系统/planning/planningParser';
import { commitPlanningOption } from '../../红警指挥系统/planning/planningReceipt';
import { Schema, type DataPatch, type StatData } from '../../红警指挥系统/core/schema';
import {
  appendFloorProcessOp,
  appendWorldbookMutation,
  getSwipeSlot,
  makeSwipeScopedKey,
  readTimelineLedger,
  resetMemoryTimelineLedgerForTest,
  writeTimelineLedger,
} from '../../红警指挥系统/core/timelineLedger';
import {
  autoAdvanceChrono,
  cascadeRecomputeDownstream,
  forceCommissionChrono,
  hashText,
  parseState,
  reconcileDeletedFloorsAbove,
  runParseFor,
  submitFix,
} from '../../红警指挥系统/composables/useParse';
import { ROSTER_ENTRY_NAME, type WorldbookEntry } from '../../红警指挥系统/worldbook/chatBookBinding';
import { toggleBuildingInstanceState } from '../modals/modalBuildingsHelpers';
import type { BuiltBuildingInstanceRef } from '../models/buildingSystemModel';
import {
  installFloorObservers,
  teardownFloorObservers,
  type FloorObserversDeps,
  type FloorObserversFloating,
} from '../host/floorObservers';

type Globals = Record<string, unknown>;

vi.mock('toastr', () => ({ default: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

interface MockTavernHarness {
  chatVars: Record<string, unknown>;
  msgVars: Record<number, Record<string, unknown>>;
  messages: Record<number, { role: string; is_hidden: boolean; message: string; swipe_id?: number }>;
  worldbooks: Record<string, WorldbookEntry[]>;
  boundChatBook: string;
  currentChatId: string;
  restore: () => void;
}

function createTavernHarness(init?: {
  chatId?: string;
  boundChatBook?: string;
  messages?: Record<number, { role: string; is_hidden: boolean; message: string; swipe_id?: number }>;
  worldbooks?: Record<string, WorldbookEntry[]>;
}): MockTavernHarness {
  const g = globalThis as Globals;
  const saved = {
    gcm: g.getChatMessages,
    gv: g.getVariables,
    uvw: g.updateVariablesWith,
    ia: g.insertOrAssignVariables,
    glmi: g.getLastMessageId,
    gcwn: g.getChatWorldbookName,
    gwn: g.getWorldbookNames,
    gw: g.getWorldbook,
    uww: g.updateWorldbookWith,
    cw: g.createWorldbook,
    rcw: g.rebindChatWorldbook,
    gccn: g.getCurrentCharacterName,
    st: g.SillyTavern,
  };

  const chatVars: Record<string, unknown> = {};
  const msgVars: Record<number, Record<string, unknown>> = {};
  const messages: Record<number, { role: string; is_hidden: boolean; message: string; swipe_id?: number }> =
    init?.messages ?? {
      0: { role: 'assistant', is_hidden: false, message: '<战况>\n资金: 1000\n</战况>', swipe_id: 0 },
    };
  const worldbooks: Record<string, WorldbookEntry[]> = init?.worldbooks ?? {};
  let boundChatBook = init?.boundChatBook ?? '红警档案·测试卡·20261016';
  let currentChatId = init?.chatId ?? 'chat-main-001';

  g.SillyTavern = {
    getCurrentChatId: () => currentChatId,
  };

  g.getLastMessageId = () => {
    const ids = Object.keys(messages)
      .map(Number)
      .filter(n => Number.isFinite(n));
    return ids.length ? Math.max(...ids) : -1;
  };

  g.getChatMessages = (id: number) => {
    const m = messages[id];
    return m ? [{ message_id: id, ...m }] : [];
  };

  g.getVariables = (o: { type: string; message_id?: number }) => {
    if (o.type === 'chat') return chatVars;
    if (o.type === 'message' && typeof o.message_id === 'number') {
      return msgVars[o.message_id] ?? {};
    }
    return {};
  };

  g.updateVariablesWith = async (
    updater: (v: Record<string, unknown>) => Record<string, unknown>,
    o: { type: string; message_id?: number },
  ) => {
    if (o.type === 'chat') {
      const next = updater(chatVars);
      if (next !== chatVars) {
        for (const k of Object.keys(chatVars)) delete chatVars[k];
        Object.assign(chatVars, next);
      }
      return chatVars;
    }
    if (o.type === 'message' && typeof o.message_id === 'number') {
      const cur = msgVars[o.message_id] ?? {};
      const next = updater(cur);
      msgVars[o.message_id] = next;
      return next;
    }
    return updater({});
  };

  g.insertOrAssignVariables = (v: Record<string, unknown>, o: { type: string; message_id?: number }) => {
    if (o.type === 'chat') {
      Object.assign(chatVars, v);
    } else if (o.type === 'message' && typeof o.message_id === 'number') {
      msgVars[o.message_id] = { ...(msgVars[o.message_id] ?? {}), ...v };
    }
  };

  g.getChatWorldbookName = () => boundChatBook;
  g.getWorldbookNames = () => Object.keys(worldbooks);
  g.getWorldbook = async (name: string) => worldbooks[name] ?? [];
  g.updateWorldbookWith = async (name: string, updater: (entries: WorldbookEntry[]) => WorldbookEntry[]) => {
    const current = worldbooks[name] ?? [];
    worldbooks[name] = updater(current);
  };
  g.createWorldbook = async (name: string, entries: WorldbookEntry[]) => {
    worldbooks[name] = entries;
  };
  g.rebindChatWorldbook = async (_target: string, name: string) => {
    boundChatBook = name;
  };
  g.getCurrentCharacterName = () => '测试指挥官';

  return {
    chatVars,
    msgVars,
    messages,
    worldbooks,
    get boundChatBook() {
      return boundChatBook;
    },
    set boundChatBook(v: string) {
      boundChatBook = v;
    },
    get currentChatId() {
      return currentChatId;
    },
    set currentChatId(v: string) {
      currentChatId = v;
    },
    restore() {
      g.getChatMessages = saved.gcm;
      g.getVariables = saved.gv;
      g.updateVariablesWith = saved.uvw;
      g.insertOrAssignVariables = saved.ia;
      g.getLastMessageId = saved.glmi;
      g.getChatWorldbookName = saved.gcwn;
      g.getWorldbookNames = saved.gwn;
      g.getWorldbook = saved.gw;
      g.updateWorldbookWith = saved.uww;
      g.createWorldbook = saved.cw;
      g.rebindChatWorldbook = saved.rcw;
      g.getCurrentCharacterName = saved.gccn;
      g.SillyTavern = saved.st;
    },
  };
}

beforeEach(() => {
  teardownFloorObservers();
  resetMemoryTimelineLedgerForTest();
  parseState.reports.length = 0;
  for (const k of Object.keys(parseState.quarantine)) {
    delete parseState.quarantine[k];
  }
  parseState.chrono = null;
});

describe('SEAM-01 · MESSAGE_DELETED 监听、删楼水位线对账与世界书逆向回滚', () => {
  it('G08-04：解隐失败保留越界摘要，API恢复后再次对账解隐成功才删条', async () => {
    const bookName = '红警档案·摘要恢复';
    const h = createTavernHarness({
      boundChatBook: bookName,
      worldbooks: { [bookName]: [
        { uid: 1, name: '摘要·001-010', content: '保留摘要', enabled: true },
        { uid: 2, name: '摘要·011-020', content: '恢复依据', enabled: true },
        { uid: 3, name: '摘要·021-030', content: '已无残存楼层', enabled: true },
        { uid: 4, name: '档案·基地', content: '非摘要', enabled: true },
      ] },
      messages: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [i + 11,
        { role: 'assistant', message: `原文${i + 11}`, is_hidden: true },
      ])),
    });
    const g = globalThis as Globals;
    const previousSetMessages = g.setChatMessages;
    const setMessages = vi.fn().mockRejectedValueOnce(new Error('解隐接口暂时失败'));
    g.setChatMessages = setMessages;
    try {
      await reconcileDeletedFloorsAbove(15);
      expect(h.worldbooks[bookName].map(e => e.uid)).toEqual([1, 2, 4]);
      expect(Object.values(h.messages).every(m => m.is_hidden)).toBe(true);
      setMessages.mockImplementation(async (updates: Array<{ message_id: number; is_hidden: boolean }>) => {
        // 调用解隐时摘要仍在，禁止先删条后恢复原文。
        expect(h.worldbooks[bookName].some(e => e.uid === 2)).toBe(true);
        for (const update of updates) h.messages[update.message_id].is_hidden = update.is_hidden;
      });
      await reconcileDeletedFloorsAbove(15);
      expect(setMessages).toHaveBeenLastCalledWith(
        [11, 12, 13, 14, 15].map(message_id => ({ message_id, is_hidden: false })),
      );
      expect(Object.values(h.messages).every(m => !m.is_hidden)).toBe(true);
      expect(h.worldbooks[bookName].map(e => e.uid)).toEqual([1, 4]);
      await reconcileDeletedFloorsAbove(15);
      expect(setMessages).toHaveBeenCalledTimes(2);
    } finally {
      g.setChatMessages = previousSetMessages;
      h.restore();
    }
  });

  it('reconcileDeletedFloorsAbove 清理 > maxFloor 的 $parse (done/quarantine/issues/reports) 与 $timeline 并逆向回滚世界书', async () => {
    const bookName = '红警档案·测试卡·20261016';
    const h = createTavernHarness({
      boundChatBook: bookName,
      worldbooks: {
        [bookName]: [
          {
            name: ROSTER_ENTRY_NAME,
            content: '- 白凌：初始机娘\n- 喀秋莎：第4楼新增机娘',
            enabled: true,
          },
          {
            name: '机娘_白凌_核心档案',
            content: '白凌：第3楼更新后的内容',
            enabled: true,
          },
          {
            name: '机娘_喀秋莎_核心档案',
            content: '喀秋莎：第4楼新建词条',
            enabled: true,
          },
        ],
      },
    });

    try {
      // 预置 $parse 含 #1, #2, #3, #4 楼记录（含纯数字键与 f_mid__s_swipe 键）
      h.chatVars.$parse = {
        done: {
          '1': { hash: 'h1', swipe_id: 0 },
          '2': { hash: 'h2', swipe_id: 0 },
          '3': { hash: 'h3', swipe_id: 0 },
          [makeSwipeScopedKey(4, 1)]: { hash: 'h4', swipe_id: 1 },
        },
        quarantine: {
          '2': [{ scope: 'block', tag: '战况', raw: 'bad2', error: 'err2' }],
          '3': [{ scope: 'block', tag: '战况', raw: 'bad3', error: 'err3' }],
          [makeSwipeScopedKey(4, 0)]: [{ scope: 'block', tag: '图鉴', raw: 'bad4', error: 'err4' }],
        },
        issues: {
          '2': [{ rule: 'R26', level: 'warn', target: 't2', message: 'm2' }],
          '4': [{ rule: 'R26', level: 'warn', target: 't4', message: 'm4' }],
        },
        reports: [
          { message_id: 4, time: '2026-10-16T04:00:00.000Z', applied: true, events: [], quarantineCount: 0 },
          { message_id: 2, time: '2026-10-16T02:00:00.000Z', applied: true, events: [], quarantineCount: 0 },
        ],
        log: [
          { message_id: 2, time: 't2', applied: true, green: 1, yellow: 0, quarantine: 0 },
          { message_id: 4, time: 't4', applied: true, green: 1, yellow: 0, quarantine: 0 },
        ],
      };

      // 预置 $timeline：#2 楼保留，#3 楼 update 白凌档案，#4 楼 create 喀秋莎档案 + 花名册行
      appendFloorProcessOp(2, 0, {
        kind: 'PATCH_DECISION',
        ts: 1000,
        patchId: 'p-2',
        decision: 'defer',
      });
      appendWorldbookMutation(3, 0, {
        ts: 2000,
        bookName,
        entryName: '机娘_白凌_核心档案',
        op: 'update',
        beforeEntry: {
          name: '机娘_白凌_核心档案',
          content: '白凌：第2楼原始档案内容',
          enabled: true,
        },
      });
      appendWorldbookMutation(4, 0, {
        ts: 3000,
        bookName,
        entryName: '机娘_喀秋莎_核心档案',
        op: 'create',
        beforeEntry: null,
        rosterLineAdded: '- 喀秋莎：第4楼新增机娘',
      });

      // 模拟删除了 #3、#4 楼，当前最大楼层回退到 #2
      const res = await reconcileDeletedFloorsAbove(2);

      expect(res.prunedFloors).toEqual([3, 4]);
      expect(res.rolledBackWbCount).toBe(2);

      // 1. 断言 $parse 高于 #2 的记录全部清空，#1/#2 保留
      const $parse = h.chatVars.$parse as Record<string, any>;
      expect(Object.keys($parse.done)).toEqual(['1', '2']);
      expect(Object.keys($parse.quarantine)).toEqual(['2']);
      expect(Object.keys($parse.issues)).toEqual(['2']);
      expect($parse.reports.map((r: { message_id: number }) => r.message_id)).toEqual([2]);

      // 2. 断言 $timeline 仅保留 f_2，f_3 与 f_4 已裁剪，水位线回退到 2
      const ledger = readTimelineLedger();
      expect(ledger.maxFloorWatermark).toBe(2);
      expect(Object.keys(ledger.floors)).toEqual(['f_2']);

      // 3. 断言聊天世界书已逆向回滚：#4 新建的喀秋莎被删且花名册行移除，#3 更新的白凌恢复为 #2 原始内容
      const entries = h.worldbooks[bookName];
      expect(entries.find(e => e.name === '机娘_喀秋莎_核心档案')).toBeUndefined();
      expect(entries.find(e => e.name === '机娘_白凌_核心档案')?.content).toBe('白凌：第2楼原始档案内容');
      expect(entries.find(e => e.name === ROSTER_ENTRY_NAME)?.content).toBe('- 白凌：初始机娘');
    } finally {
      h.restore();
    }
  });

  it('floorObservers 监听 MESSAGE_DELETED：删楼后自动触发 reconcileDeletedFloorsAbove + parseAndRefresh 最新 AI 楼', async () => {
    const h = createTavernHarness({
      messages: {
        0: { role: 'assistant', is_hidden: false, message: '<战况>\n资金: 500\n</战况>', swipe_id: 0 },
        1: { role: 'user', is_hidden: false, message: '继续推进' },
        2: { role: 'assistant', is_hidden: false, message: '<战况>\n资金变化: +300\n</战况>', swipe_id: 0 },
      },
    });

    const eventListeners: Record<string, ((...args: unknown[]) => unknown)[]> = {};
    (globalThis as Globals).tavern_events = {
      GENERATION_ENDED: 'generation_ended',
      MESSAGE_SWIPED: 'message_swiped',
      MESSAGE_EDITED: 'message_edited',
      MESSAGE_DELETED: 'message_deleted',
      CHAT_CHANGED: 'chat_changed',
    };

    const calls: string[] = [];
    const deps: FloorObserversDeps = {
      runParse: vi.fn(async (mid: number) => {
        calls.push(`runParse:${mid}`);
        return 'parsed';
      }),
      getLastMessageId: () => {
        const ids = Object.keys(h.messages).map(Number);
        return ids.length ? Math.max(...ids) : -1;
      },
      getChatMessages: (id: number) => {
        const m = h.messages[id];
        return m ? [m] : [];
      },
      readChatId: () => h.currentChatId,
      eventOn: vi.fn((evt: string, cb: (...args: unknown[]) => unknown) => {
        if (!eventListeners[evt]) eventListeners[evt] = [];
        eventListeners[evt].push(cb);
        return { stop: () => {} };
      }),
    };
    const floating: FloorObserversFloating = {
      refresh: vi.fn(async () => {
        calls.push('floating.refresh');
      }),
    };

    try {
      // 预置 #2 楼的 $parse.done 与 $timeline 记录
      h.chatVars.$parse = {
        done: {
          '0': { hash: hashText('<战况>\n资金: 500\n</战况>'), swipe_id: 0 },
          '2': { hash: hashText('<战况>\n资金变化: +300\n</战况>'), swipe_id: 0 },
        },
        quarantine: { '2': [{ scope: 'block', tag: '战况', raw: 'x', error: 'e' }] },
        issues: {},
      };
      appendFloorProcessOp(2, 0, { kind: 'PATCH_DECISION', ts: 100, patchId: 'p2', decision: 'reject' });

      installFloorObservers(floating, deps);
      await vi.waitFor(() => {
        expect(calls).toContain('runParse:2');
      });
      calls.length = 0;

      // 模拟宿主删掉 #2 楼，现在最新 AI 楼变为 #0
      delete h.messages[2];
      const onDeleted = eventListeners['message_deleted']?.[0];
      expect(onDeleted).toBeDefined();
      await onDeleted!();

      // #2 楼在 $parse 与 $timeline 中的残留已被清理，并重刷 #0 楼
      const $parse = h.chatVars.$parse as Record<string, any>;
      expect('2' in $parse.done).toBe(false);
      expect('2' in $parse.quarantine).toBe(false);
      expect(readTimelineLedger().floors['f_2']).toBeUndefined();
      expect(calls).toEqual(['runParse:0', 'floating.refresh']);
    } finally {
      h.restore();
    }
  });
  it('G9-01/G9-03：删中间楼按消息身份检出错位，精确回滚被删楼条目、高楼账本前移并清 $parse 重解析；legacy/非规范摘要不被删', async () => {
    const bookName = '红警档案·测试卡·20261016';
    const m = (t: string) => ({ role: 'assistant', is_hidden: false, message: t, swipe_id: 0 });
    const h = createTavernHarness({
      boundChatBook: bookName,
      // 原 #0 #1 #2；删掉 #1 后原 #2 前移为 #1
      messages: { 0: m('楼0'), 1: m('楼2') },
      worldbooks: {
        [bookName]: [
          { name: '机娘_白凌_核心档案', content: '原#1楼新建', enabled: true },
          { name: '机娘_喟秋莎_核心档案', content: '原#2楼新建', enabled: true },
          { name: '旧摘要', content: 'legacy', enabled: true, extra: { legacy: true, to: 99 } },
          { name: '前情卷宗·大·001-080', content: '旧档', enabled: true, extra: { to: 80 } },
        ] as WorldbookEntry[],
      },
    });
    const listeners: Record<string, ((...a: unknown[]) => unknown)[]> = {};
    (globalThis as Globals).tavern_events = { MESSAGE_DELETED: 'message_deleted' };
    const deps: FloorObserversDeps = {
      runParse: vi.fn(async () => 'parsed' as const),
      getLastMessageId: () => Math.max(...Object.keys(h.messages).map(Number)),
      getChatMessages: (id: number) => (h.messages[id] ? [h.messages[id]] : []),
      readChatId: () => h.currentChatId,
      eventOn: vi.fn((evt: string, cb: (...a: unknown[]) => unknown) => {
        (listeners[evt] ??= []).push(cb);
        return { stop: () => {} };
      }),
    };
    try {
      h.chatVars.$parse = {
        done: {
          '0': { hash: hashText('楼0'), swipe_id: 0 },
          '1': { hash: hashText('楼1'), swipe_id: 0 },
          '2': { hash: hashText('楼2'), swipe_id: 0 },
        },
        quarantine: {},
        issues: {},
      };
      appendWorldbookMutation(1, 0, {
        ts: 2000,
        bookName,
        entryName: '机娘_白凌_核心档案',
        op: 'create',
        beforeEntry: null,
      });
      appendWorldbookMutation(2, 0, {
        ts: 3000,
        bookName,
        entryName: '机娘_喟秋莎_核心档案',
        op: 'create',
        beforeEntry: null,
      });
      installFloorObservers({ refresh: vi.fn(async () => {}) }, deps);
      await listeners['message_deleted']![0]!();

      // 被删 #1 楼条目回滚；仍存活的原 #2 楼条目保留、账本前移为 #1；非规范/legacy 摘要不被误删
      const names = h.worldbooks[bookName].map(e => e.name);
      expect(names).toHaveLength(3);
      expect(names).not.toContain('机娘_白凌_核心档案');
      const ledger = readTimelineLedger();
      expect(Object.keys(ledger.floors)).toEqual(['f_1']);
      expect(ledger.floors['f_1'].swipes['s_0'].wbJournal.map(r => [r.entryName, r.floorId])).toEqual([
        [names[0], 1],
      ]);
      // 错位楼起的解析留痕作废，等待重解析
      expect(Object.keys((h.chatVars.$parse as Record<string, any>).done)).toEqual(['0']);

      // 同一删楼事件重放（身份留痕已清）：不再重映射，也不重复回滚
      const replay = await reconcileDeletedFloorsAbove(1, { midDeletionFrom: 1 });
      expect(replay.rolledBackWbCount).toBe(0);
      expect(h.worldbooks[bookName].map(e => e.name)).toEqual(names);
      expect(Object.keys(readTimelineLedger().floors)).toEqual(['f_1']);

      // G9-03：普通水位线对账时，legacy 摘要与非规范前缀带 extra.to 的条目不被当作越界摘要删除
      await reconcileDeletedFloorsAbove(0);
      expect(h.worldbooks[bookName].map(e => e.name)).toEqual(['旧摘要', '前情卷宗·大·001-080']);
    } finally {
      h.restore();
    }
  });

  it('G9-01b：删中间楼后从错位楼起逐楼按顺序重解析（MESSAGE_DELETED 与只发 CHAT_CHANGED 两条路径）', async () => {
    const m = (t: string) => ({ role: 'assistant', is_hidden: false, message: t, swipe_id: 0 });
    const u = (t: string) => ({ role: 'user', is_hidden: false, message: t, swipe_id: 0 });
    for (const evt of ['message_deleted', 'chat_changed'] as const) {
      teardownFloorObservers();
      // 原 #0..#4；删掉 #1 后原 #2/#3/#4 前移为 #1/#2/#3（#2 为 user 楼应跳过）
      const h = createTavernHarness({ messages: { 0: m('楼0'), 1: m('楼2'), 2: u('楼3'), 3: m('楼4') } });
      const listeners: Record<string, ((...a: unknown[]) => unknown)[]> = {};
      (globalThis as Globals).tavern_events = { MESSAGE_DELETED: 'message_deleted', CHAT_CHANGED: 'chat_changed' };
      const order: number[] = [];
      const deps: FloorObserversDeps = {
        runParse: vi.fn(async (id: number) => {
          order.push(id);
          return 'parsed' as const;
        }),
        getLastMessageId: () => Math.max(...Object.keys(h.messages).map(Number)),
        getChatMessages: (id: number) => (h.messages[id] ? [h.messages[id]] : []),
        readChatId: () => h.currentChatId,
        eventOn: vi.fn((e: string, cb: (...a: unknown[]) => unknown) => {
          (listeners[e] ??= []).push(cb);
          return { stop: () => {} };
        }),
      };
      try {
        h.chatVars.$parse = {
          done: Object.fromEntries(
            ['楼0', '楼1', '楼2', '楼3', '楼4'].map((t, i) => [String(i), { hash: hashText(t), swipe_id: 0 }]),
          ),
          quarantine: {},
          issues: {},
        };
        installFloorObservers({ refresh: vi.fn(async () => {}) }, deps);
        order.length = 0; // 忽略 init 补解析
        await listeners[evt]![0]!();
        expect(order, evt).toEqual([1, 3]);
        expect(Object.keys((h.chatVars.$parse as Record<string, any>).done), evt).toEqual(['0']);
      } finally {
        h.restore();
      }
    }
  });
});

describe('SEAM-02 · 交互过程量落账与 runParseFor(mid, true) 100% 幂等重放', () => {
  it('排产批准(COMMIT_PLANNING)、补丁裁决(PATCH_DECISION)、时序特批(CHRONO_RESOLVE)、YAML修复(SUBMIT_FIX) 在重算后完整恢复', async () => {
    const h = createTavernHarness({
      messages: {
        0: {
          role: 'assistant',
          is_hidden: false,
          message:
            '<战况>\n资金: 3000\n基地:\n  - id: base_1\n    名称: 北坡主基地\n    建筑:\n      - 名称: 苏联建造厂\n      - 名称: 战车工厂\n</战况>',
          swipe_id: 0,
        },
        1: {
          role: 'assistant',
          is_hidden: false,
          message:
            '<战况>\n资金变化: +500\n</战况>\n<数据更新>\n- id: patch_tank_cost\n  target: 犀牛坦克\n  operation: patch\n  reason: 装甲升级\n  patch:\n    cost: 800\n</数据更新>',
          swipe_id: 0,
        },
      },
    });

    const catalog: EffectiveCatalog = {
      buildings: [],
      productions: [
        {
          name: '犀牛坦克',
          cost: 900,
          days: 1,
          category: '装甲',
          lane: '战车工厂',
          need_buildings: ['战车工厂'],
        },
      ],
      researches: [],
      retrofits: [],
      projects: [],
      protocols: [],
      girls: [],
      factionDefs: [{ faction: '苏联', mcv: '苏联建造厂', lab: '作战实验室' }],
    } as unknown as EffectiveCatalog;

    const catalogSpy = vi.spyOn(await import('../../红警指挥系统/composables/useCatalog'), 'effectiveCatalogSnapshot').mockReturnValue(catalog);
    try {
      // 1. 解析 #0 与 #1 楼
      expect(await runParseFor(0, true)).toBe('parsed');
      expect(await runParseFor(1, true)).toBe('parsed');

      const floor1Initial = h.msgVars[1].stat_data as StatData;
      expect(floor1Initial.economy.credits).toBe(3000); // G7-01：非首楼 <战况> 资金变化 +500 被拦截
      expect(floor1Initial.pending_data_patches).toHaveLength(1);

      // 2. 在 #1 楼执行玩家过程量①：手动批准排产方案（耗资 1800 入队 2 辆犀牛坦克）
      const planActions = [{ op: 'enqueue' as const, base_ref: '北坡主基地', catalog_ref: '犀牛坦克', quantity: 2 }];
      const planIntent: ParsedPlanningIntent = {
        version: 1,
        request_ref: 'plan-rhino-2',
        mode: 'delegate_once',
        budget_cap_credits: 1000, // 超预算需人工 forceApprove
        actions: planActions,
        fingerprint: computePlanFingerprint({
          mode: 'delegate_once',
          budget_cap_credits: 1000,
          actions: planActions,
        }),
        raw: '<排产计划></排产计划>',
      };
      const planCommitted = commitPlanningOption(floor1Initial, planIntent, catalog, {
        floor: 1,
        forceApprove: true,
      });
      expect(planCommitted.committed).toBe(true);
      expect(planCommitted.next.economy.credits).toBe(1200); // 3000 - 1800
      expect(planCommitted.next.queues).toHaveLength(1);
      h.msgVars[1].stat_data = planCommitted.next;

      // 3. 在 #1 楼执行玩家过程量②：数据补丁批准生效（PATCH_DECISION = approve）
      const patchItem: DataPatch = floor1Initial.pending_data_patches[0];
      appendFloorProcessOp(1, 0, {
        kind: 'PATCH_DECISION',
        ts: Date.now(),
        patchId: patchItem.id,
        patchTarget: patchItem.target,
        decision: 'approve',
        patchSnapshot: patchItem,
      });

      // 4. 在 #1 楼执行玩家过程量③：CHRONO 强制特批入役（模拟暂存冲突并调用 forceCommissionChrono）
      parseState.chrono = {
        message_id: 1,
        chatId: h.currentChatId,
        at: new Date().toISOString(),
        verdicts: [
          {
            verdict: 'OVERRUN',
            overrunKind: 'time_conflict',
            item: '犀牛坦克',
            base: '北坡主基地',
            declaredQty: 2,
            physicalDoneQty: 0,
            remainingMinutes: 720,
          },
        ],
      };
      const chronoRes = await forceCommissionChrono();
      expect(chronoRes.ok).toBe(true);
      expect(chronoRes.commissioned).toContain('犀牛坦克');

      // 验证 $timeline 已记录 #1 楼的 3 条交互过程量
      const slotBeforeReplay = getSwipeSlot(readTimelineLedger(), 1, 0);
      expect(slotBeforeReplay).toBeDefined();
      expect(slotBeforeReplay!.opLog.map(op => op.kind)).toEqual([
        'COMMIT_PLANNING',
        'PATCH_DECISION',
        'CHRONO_RESOLVE',
      ]);

      // 5. 强制重跑 #1 楼（模拟消息被重新解析，从 Raw 原文重新计算）
      expect(await runParseFor(1, true)).toBe('parsed');

      const floor1Replayed = h.msgVars[1].stat_data as StatData & { applied_data_patches?: DataPatch[] };
      // 排产扣款被恢复（1200 而非 Raw 算出的 3000）
      expect(floor1Replayed.economy.credits).toBe(1200);
      // CHRONO 特批入役结果被恢复（队列项 status === 'done'，且兵力表入账犀牛坦克）
      expect(floor1Replayed.queues.some(q => q.item === '犀牛坦克' && q.status === 'done')).toBe(true);
      // 补丁批准结果被恢复（pending_data_patches 清空，applied_data_patches 含该补丁）
      expect(floor1Replayed.pending_data_patches).toHaveLength(0);
      expect(
        floor1Replayed.applied_data_patches?.some(p => p.id === patchItem.id && p.target === '犀牛坦克'),
      ).toBe(true);

      // 6. 测试 SUBMIT_FIX 过程量落账与重放
      const fixRes = await submitFix(
        1,
        { scope: 'block', tag: '战况', raw: '坏块', error: 'YAML 语法错误' },
        '暴露度: 4',
      );
      expect(fixRes.ok).toBe(true);
      expect((h.msgVars[1].stat_data as StatData).exposure.value).toBe(4);
      expect((h.msgVars[1].stat_data as StatData).economy.credits).toBe(1200);

      // 再次重跑 runParseFor(1, true)，SUBMIT_FIX 快照也被自动重放保留
      expect(await runParseFor(1, true)).toBe('parsed');
      expect((h.msgVars[1].stat_data as StatData).exposure.value).toBe(4);
    } finally {
      catalogSpy.mockRestore();
      h.restore();
    }
  });

  it('G1-05：原文编辑后用户修复意图继续回放，且不覆盖新结算的其他变化', async () => {
    const h = createTavernHarness({
      messages: {
        0: { role: 'assistant', is_hidden: false, message: '<战况>\n资金: 3000\n</战况>', swipe_id: 0 },
        1: { role: 'assistant', is_hidden: false, message: '<战况>\n资金: 3500\n</战况>', swipe_id: 0 },
      },
    });
    try {
      expect(await runParseFor(0, true)).toBe('parsed');
      expect(await runParseFor(1, true)).toBe('parsed');
      const fixed = await submitFix(1, { scope: 'block', tag: '战况', raw: '坏块', error: 'YAML' }, '暴露度: 4');
      expect(fixed.ok).toBe(true);
      expect(await runParseFor(1, true)).toBe('parsed');
      expect((h.msgVars[1].stat_data as StatData).exposure.value).toBe(4);

      h.messages[1].message = '<战况>\n部队:\n  兵力:\n    工程兵变化: +12\n</战况>';
      expect(await runParseFor(1, true)).toBe('parsed');
      expect((h.msgVars[1].stat_data as StatData).forces.troops.工程兵).toBe(12);
      expect((h.msgVars[1].stat_data as StatData).exposure.value).toBe(4);
      expect(parseState.reports[0].events.some(e => e.message.includes('已作废'))).toBe(false);
      const slot = getSwipeSlot(readTimelineLedger(), 1, 0);
      expect(slot?.textHash).toBe(hashText(h.messages[1].message));
      expect(slot?.opLog).toHaveLength(1);
      expect(slot?.opLog[0]).not.toHaveProperty('fixedStatSnapshot');
      // 缺失目标仅跳过该条；后续修复仍应用，记录仍保留。
      appendFloorProcessOp(1, 0, { kind: 'BUILDING_DISPATCH', ts: 2,
        baseId: '已删除基地', buildingName: '战车工厂', instanceOrdinal: 1, patch: { state: '停机' } });
      appendFloorProcessOp(1, 0, { kind: 'SUBMIT_FIX', ts: 3, blockType: '战况', fixedYaml: '暴露度: 5' });
      expect(await runParseFor(1, true)).toBe('parsed');
      expect((h.msgVars[1].stat_data as StatData).exposure.value).toBe(5);
      expect((h.msgVars[1].stat_data as StatData).forces.troops.工程兵).toBe(12);
      expect(parseState.reports[0].events.some(e => e.message.includes('建筑调度基地已不存在'))).toBe(true);
      expect(getSwipeSlot(readTimelineLedger(), 1, 0)?.opLog).toHaveLength(3);
    } finally {
      h.restore();
    }
  });

  it('G6-07：自动顺延分钟数作为结算输入入账，重解析时时钟/队列按同一时长重算', async () => {
    const h = createTavernHarness({
      messages: {
        0: { role: 'assistant', is_hidden: false, message: '<战况>\n资金: 3000\n</战况>', swipe_id: 0 },
        1: { role: 'assistant', is_hidden: false, message: '纯叙述无标签', swipe_id: 0 },
      },
    });
    try {
      expect(await runParseFor(0, true)).toBe('parsed');
      expect(await runParseFor(1, true)).toBe('parsed');
      const clockPlain = JSON.stringify((h.msgVars[1].stat_data as StatData).clock);

      parseState.chrono = {
        message_id: 1,
        chatId: h.currentChatId,
        at: new Date().toISOString(),
        verdicts: [
          {
            verdict: 'OVERRUN',
            overrunKind: 'time_conflict',
            item: '犮牛坦克',
            declaredQty: 1,
            claimedQty: 0,
            remainderQty: 1,
            detail: '时序差距',
            physicalDoneQty: 0,
            remainingMinutes: 720,
          },
        ],
      };
      const adv = await autoAdvanceChrono();
      expect(adv.ok).toBe(true);
      expect(adv.delta).toBe(720);
      const clockAdvanced = JSON.stringify((h.msgVars[1].stat_data as StatData).clock);
      expect(clockAdvanced).not.toBe(clockPlain);

      const ops = getSwipeSlot(readTimelineLedger(), 1, 0)!.opLog;
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ kind: 'CHRONO_RESOLVE', resolution: 'defer', extraDeltaMinutes: 720 });
      expect(ops[0]).not.toHaveProperty('queuesSnapshot');

      // 重解析不带 extraDeltaMinutes：从账本读出顺延分钟数，时钟与顺延后一致
      expect(await runParseFor(1, true)).toBe('parsed');
      expect(JSON.stringify((h.msgVars[1].stat_data as StatData).clock)).toBe(clockAdvanced);
    } finally {
      h.restore();
    }
  });

  it('G2-01：面板建筑调度记入过程记录，重解析本楼后仍在；原文编辑后仍保留调度意图', async () => {
    const baseYaml = (credits: number) =>
      `<战况>\n资金: ${credits}\n基地:\n  - id: base_1\n    名称: 北坡主基地\n    建筑:\n      - 名称: 战车工厂\n      - 名称: 战车工厂\n</战况>`;
    const h = createTavernHarness({
      messages: {
        0: { role: 'assistant', is_hidden: false, message: '<战况>\n资金: 3000\n</战况>', swipe_id: 0 },
        1: { role: 'assistant', is_hidden: false, message: baseYaml(3000), swipe_id: 0 },
      },
    });
    const states = () =>
      ((h.msgVars[1].stat_data as StatData).bases[0]?.buildings ?? []).map(b => b.state ?? '运转');
    try {
      expect(await runParseFor(0, true)).toBe('parsed');
      expect(await runParseFor(1, true)).toBe('parsed');
      expect(states()).toEqual(['运转', '运转']);

      const parsedBase = (h.msgVars[1].stat_data as StatData).bases[0]!;
      const inst = {
        baseIndex: 0,
        baseId: parsedBase.id || parsedBase.name,
        baseName: '北坡主基地',
        buildingIndex: 1,
        name: '战车工厂',
        instanceOrdinal: 2,
        state: '运转',
        mode: '生产',
        accelScope: 'global',
      } as BuiltBuildingInstanceRef;
      await toggleBuildingInstanceState(inst, {
        dataStore: {},
        floating: { floorId: 1, refresh: () => undefined },
        updateFloorVars: (async (id: number, fn: (v: Record<string, unknown>) => Record<string, unknown>) => {
          h.msgVars[id] = fn(h.msgVars[id] ?? {});
        }) as never,
        onTick: () => undefined,
      });
      expect(states()).toEqual(['运转', '停机']);
      expect(getSwipeSlot(readTimelineLedger(), 1, 0)?.opLog).toMatchObject([
        { kind: 'BUILDING_DISPATCH', baseId: inst.baseId, instanceOrdinal: 2, patch: { state: '停机' } },
      ]);

      // 重解析本楼（从上一楼重算）：调度仍在
      expect(await runParseFor(1, true)).toBe('parsed');
      expect(states()).toEqual(['运转', '停机']);

      // 原文编辑不撤销用户调度
      h.messages[1].message = baseYaml(3200);
      expect(await runParseFor(1, true)).toBe('parsed');
      expect(states()).toEqual(['运转', '停机']);
    } finally {
      h.restore();
    }
  });
});

describe('SEAM-01 · cascadeRecomputeDownstream 下游级联重算', () => {
  it('修改中间楼 #1 后，cascadeRecomputeDownstream(1) 依次重算 #2、#3（跳过 user 楼）并保留下游楼层过程量', async () => {
    const h = createTavernHarness({
      messages: {
        0: {
          role: 'assistant',
          is_hidden: false,
          message: '<战况>\n部队:\n  兵力:\n    工程兵: 10\n</战况>',
          swipe_id: 0,
        },
        1: {
          role: 'assistant',
          is_hidden: false,
          message: '<战况>\n部队:\n  兵力:\n    工程兵变化: +2\n</战况>',
          swipe_id: 0,
        },
        2: {
          role: 'user',
          is_hidden: false,
          message: '玩家指令楼（应跳过）',
        },
        3: {
          role: 'assistant',
          is_hidden: false,
          message: '<战况>\n部队:\n  兵力:\n    工程兵变化: +3\n</战况>',
          swipe_id: 0,
        },
        4: {
          role: 'assistant',
          is_hidden: false,
          message:
            '<战况>\n部队:\n  兵力:\n    工程兵变化: +4\n</战况>\n<数据更新>\n- id: p_floor4\n  target: 动员兵\n  operation: patch\n  patch:\n    cost: 80\n</数据更新>',
          swipe_id: 0,
        },
      },
    });

    try {
      expect(await runParseFor(0, true)).toBe('parsed');
      expect(await runParseFor(1, true)).toBe('parsed');
      expect(await runParseFor(3, true)).toBe('parsed');
      expect(await runParseFor(4, true)).toBe('parsed');

      expect((h.msgVars[1].stat_data as StatData).forces.troops.工程兵).toBe(12);
      expect((h.msgVars[3].stat_data as StatData).forces.troops.工程兵).toBe(15);
      expect((h.msgVars[4].stat_data as StatData).forces.troops.工程兵).toBe(19);

      // 在 #4 楼记录一条玩家补丁批准过程量
      appendFloorProcessOp(4, 0, {
        kind: 'PATCH_DECISION',
        ts: Date.now(),
        patchId: 'p_floor4',
        patchTarget: '动员兵',
        decision: 'approve',
        patchSnapshot: {
          id: 'p_floor4',
          target: '动员兵',
          operation: 'patch',
          patch: { cost: 80 },
          status: 'applied',
        },
      });

      // 模拟编辑 #1 楼原文：将 +200 改为 +1200，并重跑 #1 楼
      h.messages[1].message = '<战况>\n部队:\n  兵力:\n    工程兵变化: +12\n</战况>';
      expect(await runParseFor(1, true)).toBe('parsed');
      expect((h.msgVars[1].stat_data as StatData).forces.troops.工程兵).toBe(22);

      // 触发从 #1 楼向下的级联重算
      const recomputedFloors = await cascadeRecomputeDownstream(1);
      expect(recomputedFloors).toEqual([3, 4]); // 跳过 #2 user 楼，依次重算 #3、#4

      // 下游 #3 与 #4 均基于新基线更新，且 #4 楼的玩家补丁批准过程量被保留
      expect((h.msgVars[3].stat_data as StatData).forces.troops.工程兵).toBe(25);
      const floor4After = h.msgVars[4].stat_data as StatData & { applied_data_patches?: DataPatch[] };
      expect(floor4After.forces.troops.工程兵).toBe(29);
      expect(floor4After.pending_data_patches).toHaveLength(0);
      expect(floor4After.applied_data_patches?.some(p => p.id === 'p_floor4')).toBe(true);
    } finally {
      h.restore();
    }
  });
});

describe('SEAM-04 & SEAM-02 · CHAT_CHANGED 分支档案世界书克隆与 PanelDataPatches 静态契约', () => {
  it('CHAT_CHANGED 检测到新分支 chatId 时，自动克隆截至分叉楼层的专属档案书并剥离高层主线词条', async () => {
    const mainBook = '红警档案·测试指挥官·20261016-100000';
    const h = createTavernHarness({
      chatId: 'chat-main-line',
      boundChatBook: mainBook,
      messages: {
        0: { role: 'assistant', is_hidden: false, message: '<战况>\n资金: 1000\n</战况>', swipe_id: 0 },
        1: { role: 'assistant', is_hidden: false, message: '<战况>\n资金变化: +200\n</战况>', swipe_id: 0 },
      },
      worldbooks: {
        [mainBook]: [
          { name: '机娘_白凌_核心档案', content: '第1楼入档的白凌', enabled: true },
          { name: '机娘_娜塔莎_核心档案', content: '主线第5楼入档的娜塔莎（分支不应继承）', enabled: true },
        ],
      },
    });

    const eventListeners: Record<string, ((...args: unknown[]) => unknown)[]> = {};
    (globalThis as Globals).tavern_events = {
      GENERATION_ENDED: 'generation_ended',
      MESSAGE_SWIPED: 'message_swiped',
      MESSAGE_EDITED: 'message_edited',
      MESSAGE_DELETED: 'message_deleted',
      CHAT_CHANGED: 'chat_changed',
    };

    const deps: FloorObserversDeps = {
      runParse: vi.fn(async () => 'parsed'),
      getLastMessageId: () => 1,
      getChatMessages: (id: number) => (h.messages[id] ? [h.messages[id]] : []),
      readChatId: () => h.currentChatId,
      eventOn: vi.fn((evt: string, cb: (...args: unknown[]) => unknown) => {
        if (!eventListeners[evt]) eventListeners[evt] = [];
        eventListeners[evt].push(cb);
        return { stop: () => {} };
      }),
    };
    const floating: FloorObserversFloating = {
      refresh: vi.fn(async () => {}),
    };

    try {
      // 主线账本：originChatId = 'chat-main-line'，#1 入档白凌，#5 入档娜塔莎
      writeTimelineLedger(draft => {
        draft.originChatId = 'chat-main-line';
        draft.boundBookName = mainBook;
      });
      appendWorldbookMutation(1, 0, {
        ts: 1000,
        bookName: mainBook,
        entryName: '机娘_白凌_核心档案',
        op: 'create',
        beforeEntry: null,
      });
      appendWorldbookMutation(5, 0, {
        ts: 5000,
        bookName: mainBook,
        entryName: '机娘_娜塔莎_核心档案',
        op: 'create',
        beforeEntry: null,
      });

      installFloorObservers(floating, deps);

      // 模拟在 #1 楼开分支切换到新聊天 'chat-branch-from-1'
      h.currentChatId = 'chat-branch-from-1';
      const onChatChanged = eventListeners['chat_changed']?.[0];
      expect(onChatChanged).toBeDefined();
      await onChatChanged!();

      const ledgerAfter = readTimelineLedger();
      expect(ledgerAfter.originChatId).toBe('chat-branch-from-1');
      expect(ledgerAfter.boundBookName).not.toBe(mainBook);
      expect(ledgerAfter.floors['f_5']).toBeUndefined();

      // 新克隆的分支世界书保留 #1 白凌，且剥离了 #5 娜塔莎；原主线世界书完好无损
      const clonedEntries = h.worldbooks[ledgerAfter.boundBookName];
      expect(clonedEntries).toBeDefined();
      expect(clonedEntries.some(e => e.name === '机娘_白凌_核心档案')).toBe(true);
      expect(clonedEntries.some(e => e.name === '机娘_娜塔莎_核心档案')).toBe(false);
      expect(h.worldbooks[mainBook].some(e => e.name === '机娘_娜塔莎_核心档案')).toBe(true);
    } finally {
      h.restore();
    }
  });

  it('PanelDataPatches.vue 接入 PATCH_DECISION 落账与 applied_data_patches 内存叠加态持久化', () => {
    const sfc = readFileSync(join(__dirname, '../panels/PanelDataPatches.vue'), 'utf8');
    expect(sfc).toContain('appendFloorProcessOp');
    expect(sfc).toContain("kind: 'PATCH_DECISION'");
    expect(sfc).toContain("decision: 'approve'");
    expect(sfc).toContain("decision: 'defer'");
    expect(sfc).toContain("decision: 'reject'");
    expect(sfc).toContain('applied_data_patches');
  });
});
