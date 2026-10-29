import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMessageText } from '../parse/parsePipeline';
import type { ChatBookGatewayLike, WriteTxn } from '../worldbook/chatBookBinding';
import { GuardError } from '../worldbook/chatBookBinding';
import type { ThEntry } from '../worldbook/girlFiler';
import type { SummaryDraft } from '../core/schema';
import {
  DEFAULT_DEPTH,
  DEFAULT_MACRO_DEPTH,
  DEFAULT_SUMMARY_BUDGET_CONFIG,
  DEFAULT_SUMMARY_N,
  DEFAULT_TAIL_RESERVE,
  SUMMARY_BUDGET_PRESETS,
  SUMMARY_PREFIX,
  SUMMARY_TOKEN_BUDGET_SINGLE,
  SUMMARY_TOKEN_BUDGET_TOTAL,
  adoptSummary,
  buildCustomApiFromEndpointConfig,
  computeSummaryContextBreakdown,
  discardSummary,
  estimateTextTokens,
  extractSummaryRanges,
  fileSummary,
  filterExemptFloors,
  formatFloor,
  formatMicroSummariesForPrompt,
  getSummaryAutoConfirm,
  getSummaryBudgetConfig,
  getSummaryChannel,
  getSummaryEndpointConfig,
  getSummaryFloorHandling,
  getSummaryStrategy,
  getSummaryTrigger,
  hideRange,
  isHidingGateApproved,
  nextMacroSummaryCandidate,
  nextSummaryOrder,
  nextSummaryRange,
  parseSummaryComment,
  parseSummaryCommentWithTier,
  parseSummaryResponse,
  probeHiddenFloorEffects,
  pruneSummariesAboveFloor,
  reconcileChatSummariesAboveFloor,
  renderSummaryComment,
  requestMacroSummary,
  requestSummary,
  setHidingGateApproved,
  setSummaryAutoConfirm,
  setSummaryBudgetConfig,
  setSummaryChannel,
  setSummaryEndpointConfig,
  setSummaryFloorHandling,
  setSummaryStrategy,
  setSummaryTrigger,
  unhideRange,
  upsertMicroSummary,
  upsertSummaryEntry,
} from '../worldbook/summaryFiler';
import {
  SUMMARY_DELEGATION_PROMPT_ID,
  buildSummaryDelegationFeedText,
  clearSummaryDelegationTask,
  createSummaryRunner,
  getQueuedSummaryDelegationTask,
  queueSummaryDelegationTask,
  syncSummaryDelegationPrompt,
} from '../../中控悬浮窗/host/summaryRunner';
import { parseStorySummaryPayload } from '../../中控悬浮窗/cards/floorCardSummary';

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function makeMockDraft(overrides?: Partial<SummaryDraft>): SummaryDraft {
  return {
    from: 1,
    to: 20,
    text: '指挥官率领盟军基地车在北坡完成展开，抵御了敌方首次侦察并建立矿石精炼厂。',
    keys: ['北坡', '盟军基地车', '矿石精炼厂'],
    generatedAt: '2026-09-23T12:00:00.000Z',
    model: 'claude-3-5-sonnet',
    status: 'pending',
    ...overrides,
  };
}

describe('summaryFiler · 1. 区间构造与解析纯函数（设计案 §3 铁律：零重叠零漏段与指针回退）', () => {
  it('formatFloor 与 renderSummaryComment 三位补零与前缀格式', () => {
    expect(formatFloor(1)).toBe('001');
    expect(formatFloor(20)).toBe('020');
    expect(formatFloor(105)).toBe('105');
    expect(renderSummaryComment(1, 20)).toBe('摘要·001-020');
    expect(renderSummaryComment(21, 40)).toBe('摘要·021-040');
  });

  it('parseSummaryComment 正确解析合法 comment，非法格式返回 null', () => {
    expect(parseSummaryComment('摘要·001-020')).toEqual({ from: 1, to: 20 });
    expect(parseSummaryComment('摘要·021-040')).toEqual({ from: 21, to: 40 });
    expect(parseSummaryComment('科技·脉冲炮·设定')).toBeNull();
    expect(parseSummaryComment('摘要·abc-020')).toBeNull();
    expect(parseSummaryComment('摘要·050-020')).toBeNull();
  });

  it('无既有摘要时，新区间自 1 楼起始（#0 楼豁免带不入），右边界为 currentFloor - tailReserve', () => {
    const entries: ThEntry[] = [];
    const currentFloor = 30; // tailReserve 默认 10，则 30 - 10 = 20
    const range = nextSummaryRange(entries, currentFloor, DEFAULT_TAIL_RESERVE);
    expect(range).toEqual([1, 20]);
  });

  it('当前楼层不足 tailReserve（无可摘楼层）时返回 null', () => {
    const entries: ThEntry[] = [];
    expect(nextSummaryRange(entries, 10, 10)).toBeNull(); // 10 - 10 = 0 < 1
    expect(nextSummaryRange(entries, 5, 10)).toBeNull();
  });

  it('既有摘要时，下一区间起始为 maxTo + 1，保证首尾相接、零漏段、零重叠', () => {
    const entries: ThEntry[] = [
      {
        name: '摘要·001-020',
        comment: '摘要·001-020',
        extra: { from: 1, to: 20, generatedAt: '2026-09-23T10:00:00Z' },
      },
      {
        name: '摘要·021-040',
        comment: '摘要·021-040',
        extra: { from: 21, to: 40, generatedAt: '2026-09-23T11:00:00Z' },
      },
    ];

    const currentFloor = 60; // 60 - 10 = 50
    const range = nextSummaryRange(entries, currentFloor, 10);
    expect(range).toEqual([41, 50]);
  });

  it('当既有最大 to 达到或超过 currentFloor - tailReserve 时，返回 null', () => {
    const entries: ThEntry[] = [
      {
        name: '摘要·001-030',
        comment: '摘要·001-030',
        extra: { from: 1, to: 30 },
      },
    ];
    // currentFloor = 35, 35 - 10 = 25 < 31 -> null
    expect(nextSummaryRange(entries, 35, 10)).toBeNull();
    // currentFloor = 40, 40 - 10 = 30 < 31 -> null
    expect(nextSummaryRange(entries, 40, 10)).toBeNull();
    // currentFloor = 45, 45 - 10 = 35 >= 31 -> [31, 35]
    expect(nextSummaryRange(entries, 45, 10)).toEqual([31, 35]);
  });

  it('discard 后条目移除，maxTo 天然降低，nextSummaryRange 区间指针天然回退（§3 构造保证）', () => {
    const entries: ThEntry[] = [
      { name: '摘要·001-020', comment: '摘要·001-020', extra: { from: 1, to: 20 } },
      { name: '摘要·021-040', comment: '摘要·021-040', extra: { from: 21, to: 40 } },
    ];
    expect(nextSummaryRange(entries, 60, 10)).toEqual([41, 50]);

    // 模拟 discard 第 2 段：从 entries 中删除该条目
    const afterDiscard = entries.filter(e => e.comment !== '摘要·021-040');
    // 指针回退到以 020 为基准
    expect(nextSummaryRange(afterDiscard, 60, 10)).toEqual([21, 50]);
  });
});

describe('summaryFiler · 2. 条目 upsert 与 extra 元数据 round-trip（设计案 §2 条目合同）', () => {
  it('默认 constant 蓝灯常驻、at_depth、role=system、depth=4、prevent_incoming', () => {
    const entries: ThEntry[] = [];
    const draft = makeMockDraft();
    const res = upsertSummaryEntry(entries, draft);

    expect(res.action).toBe('created');
    expect(res.entryName).toBe('摘要·001-020');
    expect(entries).toHaveLength(1);

    const entry = entries[0];
    expect(entry.name).toBe('摘要·001-020');
    expect(entry.comment).toBe('摘要·001-020');
    expect(entry.enabled).toBe(true);
    expect(entry.strategy?.type).toBe('constant');
    expect(entry.position?.type).toBe('at_depth');
    expect(entry.position?.role).toBe('system');
    expect(entry.position?.depth).toBe(DEFAULT_DEPTH);
    expect(entry.position?.order).toBe(78001);
    expect(entry.recursion).toEqual({
      prevent_incoming: true,
      prevent_outgoing: true,
      delay_until: null,
    });
    expect(entry.content).toBe(draft.text);
  });

  it('次要选项：selective 绿灯分层激活模式，带 draft.keys', () => {
    const entries: ThEntry[] = [];
    const draft = makeMockDraft({ keys: ['超时空传送', '北坡基站'] });
    const res = upsertSummaryEntry(entries, draft, { strategyType: 'selective' });

    expect(res.action).toBe('created');
    const entry = entries[0];
    expect(entry.strategy?.type).toBe('selective');
    expect(entry.strategy?.keys).toEqual(['超时空传送', '北坡基站']);
  });

  it('extra 元数据完整 round-trip（唯一真源）：from, to, generatedAt, model', () => {
    const entries: ThEntry[] = [];
    const draft = makeMockDraft({
      from: 10,
      to: 25,
      generatedAt: '2026-09-23T14:30:00Z',
      model: 'deepseek-v3',
    });
    upsertSummaryEntry(entries, draft);

    const ranges = extractSummaryRanges(entries);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].from).toBe(10);
    expect(ranges[0].to).toBe(25);
    expect(ranges[0].entry.extra?.generatedAt).toBe('2026-09-23T14:30:00Z');
    expect(ranges[0].entry.extra?.model).toBe('deepseek-v3');
  });

  it('同区间幂等更新：内容与激活策略更新，不增加新条目', () => {
    const entries: ThEntry[] = [];
    const draft1 = makeMockDraft({ text: '初版正文' });
    upsertSummaryEntry(entries, draft1);
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('初版正文');

    const draft2 = makeMockDraft({ text: '修正版正文', keys: ['新实体'] });
    const res2 = upsertSummaryEntry(entries, draft2, { strategyType: 'selective' });
    expect(res2.action).toBe('updated');
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('修正版正文');
    expect(entries[0].strategy?.type).toBe('selective');
    expect(entries[0].strategy?.keys).toEqual(['新实体']);
  });
});

describe('summaryFiler · 3. 守卫失败与 fail-closed（设计案 §4 不清暂存）', () => {
  it('三重守卫失败时抛出 GuardError，外部 pending_summaries 数组元素完整保留', async () => {
    const pending: SummaryDraft[] = [makeMockDraft({ from: 1, to: 20 })];
    const failingGateway: ChatBookGatewayLike = {
      begin(): WriteTxn {
        return { chatId: 'chat_alpha' };
      },
      guardedBook(): Promise<string> {
        throw new GuardError({
          guard: 1,
          rule: 'chat-id-drift',
          expected: 'chatId=chat_alpha',
          actual: 'chatId=chat_beta',
        });
      },
    };

    let errorThrown: unknown = null;
    try {
      await fileSummary(pending[0], failingGateway, {
        updateWorldbookWithFn: vi.fn(),
      });
    } catch (e) {
      errorThrown = e;
    }

    expect(errorThrown).toBeInstanceOf(GuardError);
    // pending 暂存区绝不清空
    expect(pending).toHaveLength(1);
    expect(pending[0].from).toBe(1);
    expect(pending[0].to).toBe(20);
  });
});

describe('summaryFiler · 4. 成对可逆性铁律与豁免带（设计案 §5）', () => {
  it('filterExemptFloors 硬编码：#0 楼与尾部保留带永不隐藏', () => {
    // 包含 0 楼、负数、正数，currentFloor=30, tailReserve=10 (保留 21-30)
    const rawFloors = [-1, 0, 1, 2, 19, 20, 21, 25, 30];
    const filtered = filterExemptFloors(rawFloors, 30, 10);
    // 0 及以下必须被剔除；> 20 (即 21, 25, 30) 必须被剔除
    expect(filtered).toEqual([1, 2, 19, 20]);
    expect(filtered).not.toContain(0);
    expect(filtered).not.toContain(21);
    expect(filtered).not.toContain(30);
  });

  it('hideRange 批量调用 setChatMessages，且豁免带楼层被严格剔除', async () => {
    const setMsgs = vi.fn().mockResolvedValue(undefined);
    // 试图隐藏 0 到 15 楼，currentFloor=20, tailReserve=10 (保留 11-20)
    const hidden = await hideRange(0, 15, {
      currentFloor: 20,
      tailReserve: 10,
      setChatMessagesFn: setMsgs,
    });

    expect(hidden).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(setMsgs).toHaveBeenCalledTimes(1);
    const calledArgs = setMsgs.mock.calls[0][0];
    expect(calledArgs).toHaveLength(10);
    expect(calledArgs[0]).toEqual({ message_id: 1, is_hidden: true });
    expect(calledArgs[9]).toEqual({ message_id: 10, is_hidden: true });
    // 绝对不含 0 楼与 11 楼及以上
    expect(calledArgs.some((c: { message_id: number }) => c.message_id === 0)).toBe(false);
    expect(calledArgs.some((c: { message_id: number }) => c.message_id > 10)).toBe(false);
  });

  it('unhideRange 批量恢复 is_hidden: false，且排除 <= 0 楼', async () => {
    const setMsgs = vi.fn().mockResolvedValue(undefined);
    const unhidden = await unhideRange(0, 5, { setChatMessagesFn: setMsgs });

    expect(unhidden).toEqual([1, 2, 3, 4, 5]);
    expect(setMsgs).toHaveBeenCalledWith([
      { message_id: 1, is_hidden: false },
      { message_id: 2, is_hidden: false },
      { message_id: 3, is_hidden: false },
      { message_id: 4, is_hidden: false },
      { message_id: 5, is_hidden: false },
    ]);
  });

  it('成对铁律：discardSummary 弃置摘要条目时，必须自动取消隐藏对应区间楼层', async () => {
    const gateway: ChatBookGatewayLike = {
      begin: () => ({ chatId: 'chat_test' }),
      guardedBook: vi.fn().mockResolvedValue('红警档案·指挥系统·20260923'),
    };
    const deleteWb = vi.fn().mockResolvedValue({
      worldbook: [],
      deleted_entries: [{ name: '摘要·001-020' }],
    });
    const setMsgs = vi.fn().mockResolvedValue(undefined);

    const receipt = await discardSummary(1, 20, gateway, {
      deleteWorldbookEntriesFn: deleteWb,
      setChatMessagesFn: setMsgs,
    });

    expect(receipt.from).toBe(1);
    expect(receipt.to).toBe(20);
    expect(receipt.deletedEntry).toBe(true);
    expect(receipt.unhiddenFloors).toHaveLength(20);
    expect(setMsgs).toHaveBeenCalledTimes(1);
    const calls = setMsgs.mock.calls[0][0];
    expect(calls[0]).toEqual({ message_id: 1, is_hidden: false });
    expect(calls[19]).toEqual({ message_id: 20, is_hidden: false });
  });

  it('FIX-SUM-01 先解隐后删条：当 unhideRange 失败时中止 deleteWorldbookEntries，保留世界书摘要条目防止双向失忆', async () => {
    const order: string[] = [];
    const gateway: ChatBookGatewayLike = {
      begin: () => ({ chatId: 'chat_test' }),
      guardedBook: vi.fn().mockResolvedValue('红警档案·指挥系统·20260923'),
    };
    const deleteWb = vi.fn().mockImplementation(async () => {
      order.push('delete');
      return {
        worldbook: [],
        deleted_entries: [{ name: '摘要·001-020' }],
      };
    });
    const setMsgsFail = vi.fn().mockImplementation(async () => {
      order.push('unhide');
      throw new Error('setChatMessages 写入失败');
    });

    await expect(
      discardSummary(1, 20, gateway, {
        deleteWorldbookEntriesFn: deleteWb,
        setChatMessagesFn: setMsgsFail,
      }),
    ).rejects.toThrow('setChatMessages 写入失败');

    // 先执行 unhide，失败时绝不调用 deleteWorldbookEntries
    expect(order).toEqual(['unhide']);
    expect(deleteWb).not.toHaveBeenCalled();

    // 正常成功时，执行顺序为 unhide 先于 delete
    order.length = 0;
    const setMsgsOk = vi.fn().mockImplementation(async () => {
      order.push('unhide');
    });
    const receipt = await discardSummary(1, 20, gateway, {
      deleteWorldbookEntriesFn: deleteWb,
      setChatMessagesFn: setMsgsOk,
    });
    expect(receipt.deletedEntry).toBe(true);
    expect(order).toEqual(['unhide', 'delete']);
  });
});

describe('summaryFiler · 5. 放行门与 adoptSummary 组合流（设计案 §5）', () => {
  it('放行门未过时，即使设置项为 hide，adoptSummary 也强制走「仅注入不隐藏」', async () => {
    const storage = createMockStorage();
    setSummaryFloorHandling('hide', storage);
    setHidingGateApproved(false, storage); // 放行门未过

    const gateway: ChatBookGatewayLike = {
      begin: () => ({ chatId: 'chat_test' }),
      guardedBook: vi.fn().mockResolvedValue('红警档案·指挥系统·20260923'),
    };
    const updateWb = vi.fn().mockImplementation((book, updater) => {
      return Promise.resolve(updater([]));
    });
    const setMsgs = vi.fn().mockResolvedValue(undefined);

    const draft = makeMockDraft({ from: 1, to: 20 });
    const receipt = await adoptSummary(draft, {
      gateway,
      storage,
      updateWorldbookWithFn: updateWb,
      setChatMessagesFn: setMsgs,
    });

    expect(receipt.comment).toBe('摘要·001-020');
    expect(receipt.hidden).toBe(false); // 未隐藏
    expect(receipt.hiddenFloors).toEqual([]);
    expect(setMsgs).not.toHaveBeenCalled(); // 隐藏接口未被调用
  });

  it('放行门通过且设置为 hide 时，adoptSummary 满足成对不变量（隐藏集合＝区间集合）', async () => {
    const storage = createMockStorage();
    setSummaryFloorHandling('hide', storage);
    setHidingGateApproved(true, storage); // 放行门已过

    const gateway: ChatBookGatewayLike = {
      begin: () => ({ chatId: 'chat_test' }),
      guardedBook: vi.fn().mockResolvedValue('红警档案·指挥系统·20260923'),
    };
    const updateWb = vi.fn().mockImplementation((book, updater) => {
      return Promise.resolve(updater([]));
    });
    const setMsgs = vi.fn().mockResolvedValue(undefined);
    const onAdopted = vi.fn();

    const draft = makeMockDraft({ from: 1, to: 20 });
    const receipt = await adoptSummary(draft, {
      gateway,
      storage,
      updateWorldbookWithFn: updateWb,
      setChatMessagesFn: setMsgs,
      onAdopted,
    });

    expect(receipt.comment).toBe('摘要·001-020');
    expect(receipt.hidden).toBe(true);
    expect(receipt.hiddenFloors).toHaveLength(20);
    expect(receipt.hiddenFloors[0]).toBe(1);
    expect(receipt.hiddenFloors[19]).toBe(20);
    expect(setMsgs).toHaveBeenCalledTimes(1);
    expect(onAdopted).toHaveBeenCalledWith(draft);
  });

  it('G08-02：写书等待期间切换聊天或切换 Swipe 时，中止后续隐藏楼层与 onAdopted 核销；同一聊天同一 Swipe 正常完成', async () => {
    const storage = createMockStorage();
    setSummaryFloorHandling('hide', storage);
    setHidingGateApproved(true, storage);

    const g = globalThis as Record<string, unknown>;
    const savedGlmi = g.getLastMessageId;
    const savedGcm = g.getChatMessages;
    let currentChatId = 'chat_A';
    let boundBook = '红警档案·A';
    let lastFloor = 30;
    let currentSwipe = 0;

    g.getLastMessageId = () => lastFloor;
    g.getChatMessages = (id: number) => [{ message_id: id, swipe_id: currentSwipe }];

    const gateway: ChatBookGatewayLike = {
      begin: () => ({ chatId: currentChatId }),
      guardedBook: vi.fn(async (txn: WriteTxn) => {
        if (txn.chatId !== currentChatId) {
          throw new GuardError({
            guard: 1,
            rule: 'chat-id-drift',
            expected: txn.chatId,
            actual: currentChatId,
          });
        }
        return boundBook;
      }),
    };

    try {
      const draft = makeMockDraft({ from: 1, to: 15 });
      const pendingSummaries = [draft];
      const setMsgs = vi.fn().mockResolvedValue(undefined);
      const onAdopted = vi.fn(() => {
        pendingSummaries.splice(0, 1);
      });

      // 场景 1：写书期间切换聊天
      await expect(
        adoptSummary(draft, {
          gateway,
          storage,
          currentFloor: 30,
          updateWorldbookWithFn: async (_book, updater) => {
            const res = updater([]);
            currentChatId = 'chat_B';
            boundBook = '红警档案·B';
            return res;
          },
          setChatMessagesFn: setMsgs,
          onAdopted,
        }),
      ).rejects.toThrow();
      expect(setMsgs).not.toHaveBeenCalled();
      expect(onAdopted).not.toHaveBeenCalled();
      expect(pendingSummaries).toHaveLength(1);

      // 场景 2：写书期间同一聊天切换 Swipe
      currentChatId = 'chat_A';
      boundBook = '红警档案·A';
      currentSwipe = 1;
      await expect(
        adoptSummary(draft, {
          gateway,
          storage,
          currentFloor: 30,
          updateWorldbookWithFn: async (_book, updater) => {
            const res = updater([]);
            currentSwipe = 2;
            return res;
          },
          setChatMessagesFn: setMsgs,
          onAdopted,
        }),
      ).rejects.toThrow('Swipe');
      expect(setMsgs).not.toHaveBeenCalled();
      expect(onAdopted).not.toHaveBeenCalled();
      expect(pendingSummaries).toHaveLength(1);

      // 场景 3：同一聊天同一 Swipe 正常归档、隐藏并核销
      currentSwipe = 2;
      const receipt = await adoptSummary(draft, {
        gateway,
        storage,
        currentFloor: 30,
        updateWorldbookWithFn: async (_book, updater) => updater([]),
        setChatMessagesFn: setMsgs,
        onAdopted,
      });
      expect(receipt.hidden).toBe(true);
      expect(setMsgs).toHaveBeenCalledTimes(1);
      expect(onAdopted).toHaveBeenCalledTimes(1);
      expect(pendingSummaries).toEqual([]);
    } finally {
      g.getLastMessageId = savedGlmi;
      g.getChatMessages = savedGcm;
    }
  });
});

describe('summaryFiler · 6. 三组设置项默认值与模式断言（设计案 §2/§3/§5）', () => {
  it('全部设置项默认值断言：策略 constant、触发 manual、楼层 hide、放行门默认 true（开启可用）', () => {
    const storage = createMockStorage();
    expect(getSummaryStrategy(storage)).toBe('constant');
    expect(getSummaryTrigger(storage)).toBe('manual');
    expect(getSummaryFloorHandling(storage)).toBe('hide');
    expect(isHidingGateApproved(storage)).toBe(true);
    expect(DEFAULT_SUMMARY_N).toBe(20);
    expect(DEFAULT_TAIL_RESERVE).toBe(10);
    expect(DEFAULT_DEPTH).toBe(4);
    expect(SUMMARY_TOKEN_BUDGET_SINGLE).toBe(500);
    expect(SUMMARY_TOKEN_BUDGET_TOTAL).toBe(3000);
  });

  it('设置项切换与持久化断言', () => {
    const storage = createMockStorage();
    setSummaryStrategy('selective', storage);
    expect(getSummaryStrategy(storage)).toBe('selective');

    setSummaryTrigger('auto', storage);
    expect(getSummaryTrigger(storage)).toBe('auto');

    setSummaryFloorHandling('keep', storage);
    expect(getSummaryFloorHandling(storage)).toBe('keep');

    setHidingGateApproved(true, storage);
    expect(isHidingGateApproved(storage)).toBe(true);
  });

  it('分层激活与全常驻模式切换：条目 strategy 字段更新，共用 comment/extra，零迁移', () => {
    const entries: ThEntry[] = [];
    const draft = makeMockDraft({ from: 1, to: 20, keys: ['基地车'] });

    // 1. 先用 constant 写入
    upsertSummaryEntry(entries, draft, { strategyType: 'constant' });
    expect(entries[0].strategy?.type).toBe('constant');
    expect(entries[0].comment).toBe('摘要·001-020');
    expect(entries[0].extra?.from).toBe(1);

    // 2. 切到 selective
    upsertSummaryEntry(entries, draft, { strategyType: 'selective' });
    expect(entries).toHaveLength(1); // 零重复条目
    expect(entries[0].strategy?.type).toBe('selective');
    expect(entries[0].strategy?.keys).toEqual(['基地车']);
    expect(entries[0].comment).toBe('摘要·001-020'); // comment 不变
    expect(entries[0].extra?.from).toBe(1); // extra 账本不变
  });
});

describe('summaryFiler · 7. requestSummary 后台请求与质量门（设计案 §4）', () => {
  it('parseSummaryResponse 正确提取正文与【实体：...】列表', () => {
    const raw = `战事在北坡平息，盟军成功守住了采矿车通道。
【实体：北坡, 采矿车, 盟军】`;
    const res = parseSummaryResponse(raw);
    expect(res.text).toBe('战事在北坡平息，盟军成功守住了采矿车通道。');
    expect(res.keys).toEqual(['北坡', '采矿车', '盟军']);
  });

  it('requestSummary 生成结果进入 pending_summaries 暂存，绝不直接入书（自动的只是生成，采纳永远是人）', async () => {
    const pendingSink: SummaryDraft[] = [];
    const mockGenRaw = vi.fn().mockResolvedValue(`北坡基地初具规模。\n【实体：北坡基地】`);
    const mockGetMsgs = vi.fn().mockReturnValue([
      { message_id: 1, role: 'user', message: '前进' },
      { message_id: 2, role: 'assistant', message: '收到' },
    ]);

    const draft = await requestSummary([1, 20], {
      generateRawFn: mockGenRaw,
      getChatMessagesFn: mockGetMsgs,
      storeSink: pendingSink,
      model: 'test-model',
    });

    expect(draft.from).toBe(1);
    expect(draft.to).toBe(20);
    expect(draft.text).toBe('北坡基地初具规模。');
    expect(draft.keys).toEqual(['北坡基地']);
    expect(draft.status).toBe('pending');
    expect(pendingSink).toHaveLength(1);
    expect(pendingSink[0]).toBe(draft);

    expect(mockGenRaw).toHaveBeenCalledTimes(1);
    const genConfig = mockGenRaw.mock.calls[0][0];
    expect(genConfig.should_silence).toBe(true);
    expect(genConfig.ordered_prompts).toHaveLength(2);
  });

  it('缺少 generateRaw API 时抛错不静默', async () => {
    await expect(
      requestSummary([1, 20], {
        generateRawFn: undefined,
      }),
    ).rejects.toThrow('酒馆 API generateRaw 不可用');
  });
});

describe('summaryFiler · 8. 真机放行门探针（设计案 §1.2 / §5 探针体例）', () => {
  it('probeHiddenFloorEffects 观测 hide_state、变量读数并在结束后自动复原', async () => {
    let floor1Hidden = false;
    const mockMessages = [
      { message_id: 1, is_hidden: false, data: { credits: 100 } },
      { message_id: 2, is_hidden: false, data: { credits: 200 } },
    ];

    const getChatMessagesFn = vi.fn((range: string | number, opts?: { hide_state?: string }) => {
      const msg = mockMessages.find(m => m.message_id === Number(range));
      if (!msg) return [];
      const currentHidden = msg.message_id === 1 ? floor1Hidden : msg.is_hidden;
      const effective = { ...msg, is_hidden: currentHidden };
      if (opts?.hide_state === 'hidden' && !currentHidden) return [];
      if (opts?.hide_state === 'unhidden' && currentHidden) return [];
      return [effective];
    });

    const setChatMessagesFn = vi.fn(async (msgs: Array<{ message_id: number; is_hidden?: boolean }>) => {
      for (const m of msgs) {
        if (m.message_id === 1 && m.is_hidden !== undefined) {
          floor1Hidden = m.is_hidden;
        }
      }
    });

    const report = await probeHiddenFloorEffects(1, {
      getChatMessagesFn,
      setChatMessagesFn,
    });

    expect(report.probe).toBe('hidden-floor-effects');
    expect(report.ok).toBe(true);
    expect(report.observed.hadDataBefore).toBe(true);
    expect(report.observed.isHiddenReadout).toBe(true);
    expect(report.observed.hasDataAfter).toBe(true);
    expect(report.observed.isRestored).toBe(true);
    // 验证探针结束时已复原
    expect(floor1Hidden).toBe(false);
  });
});

describe('summaryFiler · 9. 大·中·小三层摘要体系与额外 LLM 端点及方案 C 联调', () => {
  it('小摘要（Micro）：upsertMicroSummary 按楼层幂等更新并升序排列，formatMicroSummariesForPrompt 拼装高密度时间线', () => {
    let list = upsertMicroSummary(undefined, {
      floor: 2,
      date: '秋·九月二十',
      text: '建成首座矿石精炼厂并派出采矿车。',
      keys: ['矿石精炼厂', '采矿车'],
      updatedAt: '2026-10-18T00:00:00.000Z',
    });
    list = upsertMicroSummary(list, {
      floor: 1,
      date: '秋·九月十九',
      text: '基地车在青岚山北坡展开。',
      keys: ['青岚山北坡', '基地车'],
      updatedAt: '2026-10-18T00:00:00.000Z',
    });
    // 同一楼重解析原地覆盖
    list = upsertMicroSummary(list, {
      floor: 1,
      date: '秋·九月十九',
      text: '盟军基地车在青岚山北坡完成展开。',
      keys: ['青岚山北坡', '盟军基地车'],
      updatedAt: '2026-10-18T01:00:00.000Z',
    });

    expect(list).toHaveLength(2);
    expect(list[0].floor).toBe(1);
    expect(list[0].text).toBe('盟军基地车在青岚山北坡完成展开。');
    expect(list[1].floor).toBe(2);

    const promptText = formatMicroSummariesForPrompt(list, 1, 5);
    expect(promptText).toContain('#1 [秋·九月十九]: 盟军基地车在青岚山北坡完成展开。 （关联：青岚山北坡、盟军基地车）');
    expect(promptText).toContain('#2 [秋·九月二十]: 建成首座矿石精炼厂并派出采矿车。 （关联：矿石精炼厂、采矿车）');
  });

  it('中摘要（Meso）合成优先喂入区间内已有的小摘要，且仅对缺失小摘要的楼层补读原文', async () => {
    const mockGenRaw = vi.fn().mockResolvedValue('北坡基地完成展开并建成矿场。\n【实体：北坡基地, 矿石精炼厂】');
    const mockGetMsgs = vi.fn().mockReturnValue([
      { message_id: 1, role: 'assistant', message: '第一楼长篇原文（已有小摘要，不应重复喂入）' },
      { message_id: 2, role: 'assistant', message: '第二楼未提取小摘要的补充原文' },
    ]);

    const draft = await requestSummary([1, 2], {
      generateRawFn: mockGenRaw,
      getChatMessagesFn: mockGetMsgs,
      microSummaries: [
        {
          floor: 1,
          date: '秋·九月十九',
          text: '基地车在北坡展开。',
          keys: ['北坡'],
          updatedAt: '2026-10-18T00:00:00.000Z',
        },
      ],
    });

    expect(draft.from).toBe(1);
    expect(draft.to).toBe(2);
    const userPrompt = (mockGenRaw.mock.calls[0][0].ordered_prompts as Array<{ content: string }>)[1].content;
    expect(userPrompt).toContain('【逐楼微纪要（小摘要流水）】');
    expect(userPrompt).toContain('#1 [秋·九月十九]: 基地车在北坡展开。');
    expect(userPrompt).toContain('【补充原始楼层记录】');
    expect(userPrompt).toContain('第二楼未提取小摘要的补充原文');
    expect(userPrompt).not.toContain('第一楼长篇原文（已有小摘要，不应重复喂入）');
  });

  it('大摘要（Macro）：nextMacroSummaryCandidate 识别未归并中摘要，采纳大摘要时自动将覆盖区间内的中摘要降级为 selective 绿灯', async () => {
    const entries: ThEntry[] = [];
    upsertSummaryEntry(entries, makeMockDraft({ from: 1, to: 20, text: '阶段一：北坡建基', keys: ['北坡', '建造厂'] }));
    upsertSummaryEntry(entries, makeMockDraft({ from: 21, to: 40, text: '阶段二：矿区防卫', keys: ['矿区', '灰熊坦克'] }));
    upsertSummaryEntry(entries, makeMockDraft({ from: 41, to: 60, text: '阶段三：雷达并网', keys: ['空指部', '白凌'] }));
    upsertSummaryEntry(entries, makeMockDraft({ from: 61, to: 80, text: '阶段四：荒坂反扑', keys: ['荒坂', '铁幕'] }));

    // 初始 4 段中摘要均为 constant 蓝灯常驻
    expect(entries.every(e => e.strategy?.type === 'constant')).toBe(true);

    const cand = nextMacroSummaryCandidate(entries);
    expect(cand).not.toBeNull();
    expect(cand?.from).toBe(1);
    expect(cand?.to).toBe(80);
    expect(cand?.mesoSegments).toHaveLength(4);

    // 调用 requestMacroSummary 合成大摘要草稿
    const mockGenRaw = vi.fn().mockResolvedValue('第一卷总纲：北坡崛起与荒坂初战告捷。\n【实体：北坡, 白凌, 荒坂】');
    const macroDraft = await requestMacroSummary(cand!.mesoSegments, {
      generateRawFn: mockGenRaw,
    });

    expect(macroDraft.tier).toBe('macro');
    expect(macroDraft.from).toBe(1);
    expect(macroDraft.to).toBe(80);
    expect(macroDraft.keys).toContain('白凌');
    expect(macroDraft.keys).toContain('灰熊坦克');

    // 将大摘要写入世界书条目列表：大摘要自身为 constant 蓝灯（depth=DEFAULT_MACRO_DEPTH），且 4 段中摘要自动降级为 selective 绿灯
    const upsertRes = upsertSummaryEntry(entries, macroDraft);
    expect(upsertRes.entryName).toBe('摘要·大·001-080');
    expect(upsertRes.demotedMesoComments).toEqual([
      '摘要·001-020',
      '摘要·021-040',
      '摘要·041-060',
      '摘要·061-080',
    ]);

    const macroEntry = entries.find(e => e.comment === '摘要·大·001-080')!;
    expect(macroEntry).toBeDefined();
    expect(macroEntry.strategy?.type).toBe('constant');
    expect(macroEntry.position?.depth).toBe(DEFAULT_MACRO_DEPTH);
    expect(parseSummaryCommentWithTier(macroEntry.comment!)).toEqual({ from: 1, to: 80, tier: 'macro' });

    const mesoEntries = extractSummaryRanges(entries, 'meso');
    expect(mesoEntries).toHaveLength(4);
    for (const m of mesoEntries) {
      expect(m.entry.strategy?.type).toBe('selective');
      expect((m.entry.extra as Record<string, unknown>).coveredByMacro).toBe('摘要·大·001-080');
    }

    // 归并完成后，未覆盖中摘要为 0，nextMacroSummaryCandidate 返回 null
    expect(nextMacroSummaryCandidate(entries)).toBeNull();

    // BUG-R2-13：当删除该大摘要（tier === 'macro'）时，被其覆盖的 4 段中摘要自动清除 coveredByMacro 并恢复 constant 蓝灯
    const gateway: ChatBookGatewayLike = {
      begin: () => ({ chatId: 'chat_macro_restore' }),
      guardedBook: vi.fn().mockResolvedValue('红警档案·指挥系统·20260923'),
    };
    const discardRes = await discardSummary(1, 80, gateway, {
      tier: 'macro',
      updateWorldbookWithFn: async (_book, updater) => {
        const next = updater(entries);
        entries.splice(0, entries.length, ...next);
        return entries;
      },
    });
    expect(discardRes.deletedEntry).toBe(true);
    expect(discardRes.restoredMesoComments).toEqual([
      '摘要·001-020',
      '摘要·021-040',
      '摘要·041-060',
      '摘要·061-080',
    ]);
    expect(entries.find(e => e.comment === '摘要·大·001-080')).toBeUndefined();
    for (const m of extractSummaryRanges(entries, 'meso')) {
      expect(m.entry.strategy?.type).toBe('constant');
      expect((m.entry.extra as Record<string, unknown> | undefined)?.coveredByMacro).toBeUndefined();
    }
    expect(nextMacroSummaryCandidate(entries)?.mesoSegments).toHaveLength(4);
  });

  it('额外 LLM 端点配置（SummaryEndpointConfig）：支持 proxy_preset 与 custom 直连并自动透传至 requestSummary', async () => {
    const storage = createMockStorage();
    setSummaryEndpointConfig(
      {
        mode: 'custom',
        apiurl: 'https://api.deepseek.com/v1',
        key: 'sk-test-123',
        model: 'deepseek-chat',
        source: 'deepseek',
      },
      storage,
    );

    const cfg = getSummaryEndpointConfig(storage);
    expect(buildCustomApiFromEndpointConfig(cfg)).toEqual({
      apiurl: 'https://api.deepseek.com/v1',
      key: 'sk-test-123',
      model: 'deepseek-chat',
      source: 'deepseek',
    });

    const mockGenRaw = vi.fn().mockResolvedValue('由独立端点生成的摘要正文\n【实体：独立端点】');
    const draft = await requestSummary([1, 20], {
      storage,
      generateRawFn: mockGenRaw,
      getChatMessagesFn: () => [],
    });

    expect(draft.model).toBe('deepseek-chat');
    expect(mockGenRaw.mock.calls[0][0].custom_api).toEqual({
      apiurl: 'https://api.deepseek.com/v1',
      key: 'sk-test-123',
      model: 'deepseek-chat',
      source: 'deepseek',
    });
  });

  it('parseMessageText 解析 <摘要> 与方案 C <中摘要>/<大摘要> 标签，分别入账 micro_summaries 与 pending_summaries', () => {
    const rawFloor = [
      '<正文>',
      '指挥官在北坡下令展开基地车。',
      '</正文>',
      '',
      '<摘要>',
      '时间: 秋·九月十九',
      '纪要: 指挥官率领盟军基地车在北坡完成展开，建立首座发电厂。',
      '关键词: [北坡, 盟军基地车, 发电厂]',
      '</摘要>',
      '',
      '<timePast>0 D 2 H 0 M</timePast>',
      '',
      '<战况>',
      '日期: 秋·九月十九',
      '天气: 晴朗',
      '</战况>',
      '',
      '<中摘要 区间="001-020">',
      '区间: 001-020',
      '纪要: 第一阶段北坡基地从勘址到初步建成防线。',
      '关键词: [北坡基地, 防线]',
      '</中摘要>',
    ].join('\n');

    const res = parseMessageText(rawFloor, {}, { floorId: 20 });
    expect(res.applied).toBe(true);
    expect(res.quarantine).toHaveLength(0);
    expect(res.data.micro_summaries).toHaveLength(1);
    expect(res.data.micro_summaries?.[0]).toMatchObject({
      floor: 20,
      date: '秋·九月十九',
      text: '指挥官率领盟军基地车在北坡完成展开，建立首座发电厂。',
      keys: ['北坡', '盟军基地车', '发电厂'],
    });

    expect(res.data.pending_summaries).toHaveLength(1);
    expect(res.data.pending_summaries[0]).toMatchObject({
      from: 1,
      to: 20,
      tier: 'meso',
      text: '第一阶段北坡基地从勘址到初步建成防线。',
      keys: ['北坡基地', '防线'],
      model: 'main-llm-delegated',
      status: 'pending',
    });
  });

  it('BUG-LIVE-14：#44 楼真机 <中摘要 范围="1-40" 标题="..."> 与 <大摘要 范围="1-80" 标题="..."> 经 parseMessageText 完整保留 from/to 与 title', () => {
    const rawFloor44 = [
      '<正文>',
      '指挥官在恶土前哨检视双阵营并网后的地热电站与防空阵位。',
      '</正文>',
      '',
      '<中摘要 范围="1-40" 标题="恶土扎根与双阵营并网阶段纪要">',
      '2042年6月15日，指挥官白默笙携盟军移动基地车（MCV）降临《赛博朋克2077》世界恶土落基岭与红峰荒原交界带的废弃地热栈桥掩体……',
      '关键词: 恶土前哨主基地, 白凌, 乔念, 喀秋莎, 艾琳',
      '</中摘要>',
      '',
      '<大摘要 范围="1-80" 标题="恶土崛起与荒原制空权总纲">',
      '自2042年6月降临恶土以来，北坡与红峰双基地完成盟苏并网与早期防空网建设。',
      '关键词: 恶土前哨主基地, 双阵营并网, 制空权',
      '</大摘要>',
    ].join('\n');

    const res = parseMessageText(rawFloor44, {}, { floorId: 44 });
    expect(res.applied).toBe(true);
    expect(res.quarantine).toHaveLength(0);
    expect(res.data.pending_summaries).toHaveLength(2);
    expect(res.data.pending_summaries[0]).toMatchObject({
      from: 1,
      to: 40,
      tier: 'meso',
      title: '恶土扎根与双阵营并网阶段纪要',
      text: '2042年6月15日，指挥官白默笙携盟军移动基地车（MCV）降临《赛博朋克2077》世界恶土落基岭与红峰荒原交界带的废弃地热栈桥掩体……',
      keys: ['恶土前哨主基地', '白凌', '乔念', '喀秋莎', '艾琳'],
      status: 'pending',
    });
    expect(res.data.pending_summaries[1]).toMatchObject({
      from: 1,
      to: 80,
      tier: 'macro',
      title: '恶土崛起与荒原制空权总纲',
      text: '自2042年6月降临恶土以来，北坡与红峰双基地完成盟苏并网与早期防空网建设。',
      keys: ['恶土前哨主基地', '双阵营并网', '制空权'],
      status: 'pending',
    });
  });

  it('方案 C 前馈运行器（summaryRunner）与战地纪要折叠胶囊卡片解析（parseStorySummaryPayload）闭环', () => {
    const storage = createMockStorage();
    setSummaryChannel('delegate_main', storage);
    expect(getSummaryChannel(storage)).toBe('delegate_main');

    queueSummaryDelegationTask(
      {
        tier: 'meso',
        from: 1,
        to: 20,
        sourceDigest: '#1 [秋·九月十九]: 基地车展开',
        createdAt: '2026-10-18T00:00:00.000Z',
      },
      storage,
    );

    const queued = getQueuedSummaryDelegationTask(storage);
    expect(queued).not.toBeNull();
    const feedText = buildSummaryDelegationFeedText(queued!);
    expect(feedText).toContain('<中摘要 区间="001-020">');
    expect(feedText).toContain('#1 [秋·九月十九]: 基地车展开');

    // 当 pending_summaries 已有该区间草稿时，syncSummaryDelegationPrompt 自动核销队列
    const afterSync = syncSummaryDelegationPrompt(
      {
        pending_summaries: [
          {
            from: 1,
            to: 20,
            text: '已完成阶段中摘要',
            keys: ['北坡'],
            generatedAt: '2026-10-18T01:00:00.000Z',
            model: 'main-llm-delegated',
            status: 'pending',
            tier: 'meso',
          },
        ],
      } as any,
      { storage },
    );
    expect(afterSync).toBeNull();
    expect(getQueuedSummaryDelegationTask(storage)).toBeNull();

    // 验证楼层战地纪要胶囊卡解析
    const cardData = parseStorySummaryPayload(
      '时间: 秋·九月十九\n纪要: 指挥官率领盟军基地车在北坡展开\n关键词: [北坡, 盟军基地车]',
    );
    expect(cardData).not.toBeNull();
    expect(cardData?.tier).toBe('micro');
    expect(cardData?.dateOrRange).toBe('秋·九月十九');
    expect(cardData?.keys).toEqual(['北坡', '盟军基地车']);
  });

  it('createSummaryRunner 自动加载聊天世界书并在满 20 楼（delegate_main + auto）时自动注入委托摘要提示词', async () => {
    const g = globalThis as Record<string, unknown>;
    const prevLocalStorage = g.localStorage;
    const prevGetLastMessageId = g.getLastMessageId;
    const prevGetChatWorldbookName = g.getChatWorldbookName;
    const prevGetWorldbook = g.getWorldbook;
    const prevInjectPrompts = g.injectPrompts;
    const prevUninjectPrompts = g.uninjectPrompts;

    try {
      const storage = createMockStorage();
      g.localStorage = storage;
      setSummaryChannel('delegate_main', storage);
      setSummaryTrigger('auto', storage);
      clearSummaryDelegationTask(storage);

      const injectPromptsMock = vi.fn();
      const uninjectPromptsMock = vi.fn();
      const getChatWorldbookNameMock = vi.fn().mockResolvedValue('红警档案·指挥系统·20261021');
      const getWorldbookMock = vi.fn().mockResolvedValue([] as ThEntry[]);

      // 当前楼层 = 20 + DEFAULT_TAIL_RESERVE -> 可归档区间 [1, 20]，满 20 楼
      g.getLastMessageId = () => 20 + DEFAULT_TAIL_RESERVE;
      g.getChatWorldbookName = getChatWorldbookNameMock;
      g.getWorldbook = getWorldbookMock;
      g.injectPrompts = injectPromptsMock;
      g.uninjectPrompts = uninjectPromptsMock;

      const statWithMicro = {
        pending_summaries: [],
        micro_summaries: [
          {
            floor: 1,
            date: '秋·九月十九',
            text: '指挥官抵达北坡掩体完成初期踏勘。',
            keys: ['北坡'],
            updatedAt: '2026-10-21T00:00:00.000Z',
          },
          {
            floor: 20,
            date: '秋·九月廿五',
            text: '北坡基地完成首座兵营与精炼厂建设。',
            keys: ['兵营', '精炼厂'],
            updatedAt: '2026-10-21T01:00:00.000Z',
          },
        ],
      };

      const runner = createSummaryRunner(() => statWithMicro, { storage });
      runner.start();
      expect(runner.isStarted()).toBe(true);

      // 等待异步世界书加载与二次 syncSummaryDelegationPrompt 完成
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(getChatWorldbookNameMock).toHaveBeenCalledWith('current');
      expect(getWorldbookMock).toHaveBeenCalledWith('红警档案·指挥系统·20261021');

      const autoQueued = getQueuedSummaryDelegationTask(storage);
      expect(autoQueued).not.toBeNull();
      expect(autoQueued).toMatchObject({
        tier: 'meso',
        from: 1,
        to: 20,
      });
      expect(injectPromptsMock).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            id: SUMMARY_DELEGATION_PROMPT_ID,
            position: 'in_chat',
            depth: 0,
            role: 'system',
            content: expect.stringContaining('<中摘要 区间="001-020">'),
          }),
        ],
        { once: false },
      );

      runner.stop();
      expect(runner.isStarted()).toBe(false);
    } finally {
      g.localStorage = prevLocalStorage;
      g.getLastMessageId = prevGetLastMessageId;
      g.getChatWorldbookName = prevGetChatWorldbookName;
      g.getWorldbook = prevGetWorldbook;
      g.injectPrompts = prevInjectPrompts;
      g.uninjectPrompts = prevUninjectPrompts;
    }
  });

  it('三档摘要预算动态调节（getSummaryBudgetConfig / setSummaryBudgetConfig）与含未隐藏正文的四维 Token 占比计算（computeSummaryContextBreakdown）', async () => {
    const storage = createMockStorage();
    expect(getSummaryBudgetConfig(storage)).toEqual(DEFAULT_SUMMARY_BUDGET_CONFIG);

    // 1. 持久化修改预算配置与边界钳制
    const updated = setSummaryBudgetConfig(
      {
        macroBudgetTokens: 2000,
        macroSingleTargetTokens: 650,
        mesoBudgetTokens: 2500,
        mesoSingleTargetTokens: 450,
        microBudgetTokens: 1000,
        microSingleTargetTokens: 90,
        tailReserveFloors: 8,
      },
      storage,
    );
    expect(updated.macroBudgetTokens).toBe(2000);
    expect(updated.mesoSingleTargetTokens).toBe(450);
    expect(updated.tailReserveFloors).toBe(8);
    expect(getSummaryBudgetConfig(storage)).toEqual(updated);

    // 2. 构造大摘要、中摘要、小摘要与聊天楼层（含已隐藏与未隐藏正文）
    const entries: ThEntry[] = [];
    upsertSummaryEntry(
      entries,
      makeMockDraft({
        from: 1,
        to: 20,
        tier: 'macro',
        text: '第一卷总纲：盟军北坡基地建立并击退首轮进犯。'.repeat(5),
      }),
    );
    upsertSummaryEntry(
      entries,
      makeMockDraft({
        from: 21,
        to: 30,
        tier: 'meso',
        text: '第二阶段：矿区防空网合拢并列装多功能步兵车。'.repeat(4),
      }),
    );
    const savedRanges = extractSummaryRanges(entries);
    const microList = [
      {
        floor: 31,
        date: '秋·九月廿五',
        text: '白凌率队巡逻北坡前沿哨站。',
        keys: ['白凌', '北坡'],
        updatedAt: '2026-10-18T00:00:00.000Z',
      },
      {
        floor: 32,
        date: '秋·九月廿六',
        text: '空指部雷达捕捉到不明信号。',
        keys: ['空指部'],
        updatedAt: '2026-10-18T01:00:00.000Z',
      },
    ];

    // 构造 1~35 楼原始消息：1~20 已隐藏，21~35 未隐藏
    const rawMessages = Array.from({ length: 35 }, (_, idx) => {
      const floor = idx + 1;
      return {
        message_id: floor,
        is_hidden: floor <= 20,
        message: `第 ${floor} 楼战地实况记录：指挥官下达防务部署指令，部队按计划推进。`.repeat(3),
      };
    });

    const bd = computeSummaryContextBreakdown({
      savedRanges,
      microSummaries: microList,
      rawMessages,
      hiddenRangeKeys: new Set(['1-20']),
      currentFloor: 35,
      budgetConfig: updated,
    });

    expect(bd.macroCount).toBe(1);
    expect(bd.mesoCount).toBe(1);
    expect(bd.microCount).toBe(2);
    expect(bd.macroTokens).toBeGreaterThan(0);
    expect(bd.mesoTokens).toBeGreaterThan(0);
    expect(bd.microTokens).toBeGreaterThan(0);
    expect(bd.hiddenFloorCount).toBe(20);
    expect(bd.unhiddenFloorCount).toBe(15);
    expect(bd.unhiddenRawTokens).toBeGreaterThan(bd.summaryTotalTokens);
    expect(bd.grandTotalTokens).toBe(bd.summaryTotalTokens + bd.unhiddenRawTokens);
    expect(bd.summaryBudgetTotal).toBe(2000 + 2500 + 1000);

    // 四项占比之和约为 100%
    const totalShare = bd.macroSharePct + bd.mesoSharePct + bd.microSharePct + bd.unhiddenRawSharePct;
    expect(totalShare).toBeGreaterThanOrEqual(99.5);
    expect(totalShare).toBeLessThanOrEqual(100.5);

    // 3. 验证调整预算后，生成提示词与委托提示词动态携带最新单段目标预算
    const mockGenRaw = vi.fn().mockResolvedValue('阶段摘要正文\n【实体：北坡】');
    await requestSummary([21, 30], {
      storage,
      generateRawFn: mockGenRaw,
      getChatMessagesFn: () => [],
    });
    const sysPrompt = (mockGenRaw.mock.calls[0][0].ordered_prompts as Array<{ content: string }>)[0].content;
    expect(sysPrompt).toContain('450 token 以内');

    const delegatedFeed = buildSummaryDelegationFeedText(
      {
        tier: 'macro',
        from: 1,
        to: 40,
        sourceDigest: '阶段1',
        createdAt: '2026-10-18T00:00:00.000Z',
      },
      storage,
    );
    expect(delegatedFeed).toContain('约 650 token 预算');
    expect(SUMMARY_BUDGET_PRESETS.compact.config.tailReserveFloors).toBeLessThan(
      SUMMARY_BUDGET_PRESETS.detailed.config.tailReserveFloors,
    );
    expect(estimateTextTokens('测试中文Token估算123')).toBeGreaterThan(0);
  });
});

describe('summaryFiler · 10. 78000 摘要专属频段与越界摘要自动裁剪解隐（CHATBOOK-SUMMARY-GIRL-01）', () => {
  it('nextSummaryOrder 在 [78001, 78999] 专属频段续号，与 70000~75000 扩展/机娘条目物理隔离', () => {
    const entriesWithoutSummary: ThEntry[] = [
      { name: '总览·机娘阵容与社会外壳总览', position: { order: 70000 } },
      { name: '档案·苏离·F-47首台', position: { order: 75001 } },
      { name: '科技·阳电子炮·设定', position: { order: 70015 } },
    ];
    expect(nextSummaryOrder(entriesWithoutSummary)).toBe(78001);

    const entriesWithSummary: ThEntry[] = [
      ...entriesWithoutSummary,
      { name: '摘要·001-010', position: { order: 78001 } },
      { name: '摘要·011-020', position: { order: 78005 } },
    ];
    expect(nextSummaryOrder(entriesWithSummary)).toBe(78006);
  });

  it('pruneSummariesAboveFloor：当 maxFloor = 15 时保留 001-010 与非摘要条目，精准剔除 011-020 与 大·001-040', () => {
    const entries: ThEntry[] = [
      { name: '档案·苏离·F-47首台', comment: '档案·苏离·F-47首台', position: { order: 75001 }, content: '机娘档案' },
      {
        name: '摘要·001-010',
        comment: '摘要·001-010',
        position: { order: 78001 },
        extra: { from: 1, to: 10, tier: 'meso' },
        content: '1-10楼阶段摘要',
      },
      {
        name: '摘要·011-020',
        comment: '摘要·011-020',
        position: { order: 78002 },
        extra: { from: 11, to: 20, tier: 'meso' },
        content: '11-20楼阶段摘要（含16-20楼已删未来剧透）',
      },
      {
        name: '摘要·大·001-040',
        comment: '摘要·大·001-040',
        position: { order: 78003 },
        extra: { from: 1, to: 40, tier: 'macro' },
        content: '1-40楼战役总纲（含未来剧透）',
      },
    ];

    const res = pruneSummariesAboveFloor(entries, 15);

    expect(res.entries.map(e => e.name)).toEqual(['档案·苏离·F-47首台', '摘要·001-010']);
    expect(res.removedRanges).toHaveLength(2);
    expect(res.removedRanges.map(r => ({ comment: r.comment, from: r.from, to: r.to, tier: r.tier }))).toEqual([
      { comment: '摘要·011-020', from: 11, to: 20, tier: 'meso' },
      { comment: '摘要·大·001-040', from: 1, to: 40, tier: 'macro' },
    ]);
  });

  it('reconcileChatSummariesAboveFloor：自动从世界书剔除越界摘要并自动解隐 [11, 15] 残存楼层', async () => {
    let bookEntries: ThEntry[] = [
      { name: '档案·苏离·F-47首台', comment: '档案·苏离·F-47首台', position: { order: 75001 } },
      {
        name: '摘要·001-010',
        comment: '摘要·001-010',
        position: { order: 78001 },
        extra: { from: 1, to: 10, tier: 'meso' },
      },
      {
        name: '摘要·011-020',
        comment: '摘要·011-020',
        position: { order: 78002 },
        extra: { from: 11, to: 20, tier: 'meso' },
      },
      {
        name: '摘要·大·001-040',
        comment: '摘要·大·001-040',
        position: { order: 78003 },
        extra: { from: 1, to: 40, tier: 'macro' },
      },
    ];

    const setMsgs = vi.fn().mockResolvedValue(undefined);
    const gateway: ChatBookGatewayLike = {
      begin: () => ({ chatId: 'chat_branch' }),
      guardedBook: vi.fn().mockResolvedValue('红警档案·指挥系统·20261019'),
      getChatWorldbookName: () => '红警档案·指挥系统·20261019',
      getWorldbookNames: () => ['红警档案·指挥系统·20261019'],
      updateWorldbookWith: vi.fn(async (_name, updater) => {
        bookEntries = updater(bookEntries as any) as ThEntry[];
        return bookEntries;
      }),
    };

    const res = await reconcileChatSummariesAboveFloor(15, gateway, {
      setChatMessagesFn: setMsgs,
    });

    expect(res.removedRanges.map(r => r.comment)).toEqual(['摘要·011-020', '摘要·大·001-040']);
    expect(bookEntries.map(e => e.name)).toEqual(['档案·苏离·F-47首台', '摘要·001-010']);
    expect(res.unhiddenFloors).toEqual([11, 12, 13, 14, 15]);
    expect(setMsgs).toHaveBeenCalledTimes(1);
    expect(setMsgs).toHaveBeenCalledWith([
      { message_id: 11, is_hidden: false },
      { message_id: 12, is_hidden: false },
      { message_id: 13, is_hidden: false },
      { message_id: 14, is_hidden: false },
      { message_id: 15, is_hidden: false },
    ]);

    // 无绑定书时安全返回空结果
    const emptyGateway: ChatBookGatewayLike = {
      begin: () => ({ chatId: 'chat_none' }),
      guardedBook: vi.fn().mockRejectedValue(new Error('no binding')),
      getChatWorldbookName: () => null,
      getWorldbookNames: () => [],
    };
    const emptyRes = await reconcileChatSummariesAboveFloor(15, emptyGateway);
    expect(emptyRes).toEqual({ removedRanges: [], unhiddenFloors: [] });
  });

  it('getSummaryAutoConfirm 默认开启 true，且 adoptSummary 在传入 Proxy 包装草稿并触发 structuredClone 校验时安全落盘', async () => {
    const storage = createMockStorage();
    expect(getSummaryAutoConfirm(storage)).toBe(true);
    setSummaryAutoConfirm(false, storage);
    expect(getSummaryAutoConfirm(storage)).toBe(false);
    setSummaryAutoConfirm(true, storage);
    expect(getSummaryAutoConfirm(storage)).toBe(true);

    let bookEntries: ThEntry[] = [];
    const gateway: ChatBookGatewayLike = {
      begin: () => ({ chatId: 'chat_proxy_test' }),
      guardedBook: vi.fn().mockResolvedValue('红警档案·测试'),
      getChatWorldbookName: () => '红警档案·测试',
      getWorldbookNames: () => ['红警档案·测试'],
      updateWorldbookWith: vi.fn(async (_name, updater) => {
        const next = updater(bookEntries as any) as ThEntry[];
        // 模拟真机 TavernHelper 内部对 entries 执行 structuredClone（若含 Proxy 会抛 DataCloneError）
        bookEntries = structuredClone(next);
        return bookEntries;
      }),
    };

    const rawDraft = makeMockDraft({
      from: 1,
      to: 21,
      text: '英国某私人机场雨夜，白默笙率月神小队升空后穿越至2042年恶土。',
      keys: new Proxy(['白默笙', '月神小队'], {}),
    });
    const proxyDraft = new Proxy(rawDraft, {});

    const receipt = await adoptSummary(proxyDraft, {
      gateway,
      floorHandling: 'keep',
      updateWorldbookWithFn: gateway.updateWorldbookWith as any,
    });

    expect(receipt.comment).toBe('摘要·001-021');
    expect(bookEntries).toHaveLength(1);
    expect(extractSummaryRanges(bookEntries)).toHaveLength(1);
    expect(extractSummaryRanges(bookEntries)[0].from).toBe(1);
    expect(extractSummaryRanges(bookEntries)[0].to).toBe(21);
  });
});

