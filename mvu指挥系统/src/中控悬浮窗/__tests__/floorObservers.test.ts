/**
 * floorObservers.test.ts —— 悬浮窗楼层观察者测试（CTRL-FLOOR-SLIM-01）
 *
 * 验收要求：
 * 1. floorObservers 事件串行顺序（先解析后 refresh）；
 * 2. 按 message_id 单飞（inFlight 并发去重）；
 * 3. wired 标志防重复安装 + teardown 拆除；
 * 4. MESSAGE_EDITED 走 hash 判定、不 force；
 * 5. expectChatId 随解析选项传递，写前复核聊天未切换；
 * 6. findLatestAiFloor 忽略 user 楼与隐藏楼，正确定位最新 AI 楼。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findLatestAiFloor,
  installFloorObservers,
  isFloorObserversWired,
  parseAndRefresh,
  syncMultiFactionWorldbooksOnFloorEvent,
  teardownFloorObservers,
  type FloorObserversDeps,
  type FloorObserversFloating,
} from '../host/floorObservers';

vi.mock('../../红警指挥系统/composables/store', () => ({
  in_tavern: false,
  useDataStore: () => ({ data: null }),
}));
vi.mock('../../红警指挥系统/composables/useCatalog', () => ({
  useCatalogStore: () => ({ refresh: vi.fn() }),
}));

it('G07-05：同快照世界切换与阵营回退同步书组，保留用户书', async () => {
  const xiuzhenBooks = ['修真·世界适配', '剧情·北坡纪事', '北坡采药营地_基地布局'];
  const cyberBook = '具象世界·赛博朋克2077';
  const customBook = '用户自定义战术书';
  const alliedBook = '武备·盟军';
  const sovietBook = '武备·苏联';
  const available = [...xiuzhenBooks, cyberBook, customBook, alliedBook, sovietBook, '协议'];
  let activeGlobal = [...xiuzhenBooks, customBook, alliedBook];
  let statData = { meta: { world_id: ' CYBER2077 ' }, command: { unlocked_factions: ['allied', 'soviet'] } };
  const getStatData = vi.fn(() => statData);
  const deps = {
    getStatData,
    getGlobalWorldbookNames: () => activeGlobal,
    getWorldbookNames: () => available,
    rebindGlobalWorldbooks: vi.fn((names: string[]) => { activeGlobal = names; }),
  };

  await syncMultiFactionWorldbooksOnFloorEvent(deps);
  expect(getStatData).toHaveBeenCalledTimes(1);
  expect(activeGlobal).toEqual(expect.arrayContaining([cyberBook, customBook, alliedBook, sovietBook]));
  for (const book of xiuzhenBooks) expect(activeGlobal).not.toContain(book);

  statData = { meta: { world_id: 'xiuzhen' }, command: { unlocked_factions: ['allied'] } };
  await syncMultiFactionWorldbooksOnFloorEvent(deps);
  expect(getStatData).toHaveBeenCalledTimes(2);
  expect(activeGlobal).toEqual(expect.arrayContaining([...xiuzhenBooks, customBook, alliedBook]));
  expect(activeGlobal).not.toContain(cyberBook);
  expect(activeGlobal).not.toContain(sovietBook);
});

function makeMockDeps(opts?: {
  lastId?: number;
  messages?: Record<number, { role?: string; is_hidden?: boolean }>;
  chatId?: string | null;
}): {
  deps: FloorObserversDeps;
  calls: string[];
  eventListeners: Record<string, ((...args: unknown[]) => void)[]>;
} {
  const calls: string[] = [];
  const eventListeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const messages = opts?.messages ?? {
    0: { role: 'assistant', is_hidden: false },
    1: { role: 'user', is_hidden: false },
    2: { role: 'assistant', is_hidden: false },
  };
  const lastId = opts?.lastId ?? 2;
  const chatId = opts?.chatId ?? 'chat-test-01';

  const deps: FloorObserversDeps = {
    runParse: vi.fn(async (mid: number, parseOpts) => {
      calls.push(`runParse:${mid}`);
      return 'parsed';
    }),
    getLastMessageId: vi.fn(() => lastId),
    getChatMessages: vi.fn((id: number) => {
      const m = messages[id];
      return m ? [m] : [];
    }),
    readChatId: vi.fn(() => chatId),
    eventOn: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      if (!eventListeners[event]) eventListeners[event] = [];
      eventListeners[event].push(callback);
      return {
        stop: () => {
          const idx = eventListeners[event].indexOf(callback);
          if (idx >= 0) eventListeners[event].splice(idx, 1);
        },
      };
    }),
  };

  return { deps, calls, eventListeners };
}

function makeMockFloating(calls: string[]): FloorObserversFloating {
  return {
    refresh: vi.fn(async () => {
      calls.push('floating.refresh');
    }),
  };
}

beforeEach(() => {
  teardownFloorObservers();
  (globalThis as Record<string, unknown>).tavern_events = {
    GENERATION_ENDED: 'tavern_generation_ended',
    MESSAGE_SWIPED: 'tavern_message_swiped',
    MESSAGE_EDITED: 'tavern_message_edited',
    CHAT_CHANGED: 'tavern_chat_changed',
  };
});

describe('floorObservers 核心机制（CTRL-FLOOR-SLIM-01）', () => {
  it('事件串行顺序：必须先执行 runParseFor，解析完成后才执行 floating.refresh', async () => {
    const { deps, calls } = makeMockDeps();
    const floating = makeMockFloating(calls);

    await parseAndRefresh(2, floating, { force: false }, deps);

    expect(calls).toEqual(['runParse:2', 'floating.refresh']);
  });

  it('按 message_id 单飞：同一楼层并发解析请求去重，仅执行一次', async () => {
    const calls: string[] = [];
    let resolveParse!: () => void;
    const slowParse = new Promise<void>(r => {
      resolveParse = r;
    });

    const deps: FloorObserversDeps = {
      runParse: vi.fn(async mid => {
        calls.push(`runParse:${mid}`);
        await slowParse;
        return 'parsed';
      }),
      getLastMessageId: vi.fn(() => 5),
      getChatMessages: vi.fn(() => [{ role: 'assistant', is_hidden: false }]),
      readChatId: vi.fn(() => 'chat-01'),
      eventOn: vi.fn(() => ({ stop: () => {} })),
    };
    const floating = makeMockFloating(calls);

    // 并发启动两次解析同一楼
    const p1 = parseAndRefresh(5, floating, {}, deps);
    const p2 = parseAndRefresh(5, floating, {}, deps);

    resolveParse();
    await Promise.all([p1, p2]);

    // runParse:5 仅被调用 1 次
    const parseCalls = calls.filter(c => c.startsWith('runParse:'));
    expect(parseCalls).toHaveLength(1);
  });

  it('SH40-01：跨聊天同楼号不误吞，同聊天并发仍去重，且旧聊天结束不误删新聊天 inFlight 锁', async () => {
    const calls: string[] = [];
    let currentChat = 'chat-A';
    let resolveChatA!: () => void;
    let resolveChatB!: () => void;
    const gateA = new Promise<void>(r => {
      resolveChatA = r;
    });
    const gateB = new Promise<void>(r => {
      resolveChatB = r;
    });

    const deps: FloorObserversDeps = {
      runParse: vi.fn(async (mid, parseOpts) => {
        calls.push(`runParse:${parseOpts?.expectChatId}:${mid}`);
        await (parseOpts?.expectChatId === 'chat-A' ? gateA : gateB);
        return 'parsed';
      }),
      getLastMessageId: vi.fn(() => 5),
      getChatMessages: vi.fn(() => [{ role: 'assistant', is_hidden: false }]),
      readChatId: vi.fn(() => currentChat),
      eventOn: vi.fn(() => ({ stop: () => {} })),
    };
    const floating = makeMockFloating(calls);

    // 聊天 A 的 #5 尚在飞行中，同聊天重复请求仍被拦截
    const pA1 = parseAndRefresh(5, floating, {}, deps);
    const pA2 = parseAndRefresh(5, floating, {}, deps);

    // 切换到聊天 B 后收到 #5 事件，正常触发解析不被吞
    currentChat = 'chat-B';
    const pB1 = parseAndRefresh(5, floating, {}, deps);

    expect(calls.filter(c => c.startsWith('runParse:'))).toEqual([
      'runParse:chat-A:5',
      'runParse:chat-B:5',
    ]);

    // 聊天 A 先返回时仅释放 chat-A#5，不得误删聊天 B 仍在飞行中的 chat-B#5 锁
    resolveChatA();
    await Promise.all([pA1, pA2]);
    const pB2 = parseAndRefresh(5, floating, {}, deps);
    expect(calls.filter(c => c.startsWith('runParse:'))).toEqual([
      'runParse:chat-A:5',
      'runParse:chat-B:5',
    ]);

    resolveChatB();
    await Promise.all([pB1, pB2]);
  });

  it('wired 标志防重复安装 + teardown 彻底拆除', () => {
    const { deps, eventListeners } = makeMockDeps();
    const floating = makeMockFloating([]);

    expect(isFloorObserversWired()).toBe(false);

    // 第一次安装
    const teardown = installFloorObservers(floating, deps);
    expect(isFloorObserversWired()).toBe(true);
    expect(deps.eventOn).toHaveBeenCalledTimes(4);

    // 重复安装应当被守卫拦截，不重复注册事件
    installFloorObservers(floating, deps);
    expect(deps.eventOn).toHaveBeenCalledTimes(4);

    // 拆除
    teardown();
    expect(isFloorObserversWired()).toBe(false);
  });

  it('MESSAGE_EDITED 走 hash 判定、不传 force: true', async () => {
    const { deps, eventListeners } = makeMockDeps({ lastId: 10 });
    const floating = makeMockFloating([]);

    installFloorObservers(floating, deps);

    const editedHandler = eventListeners['tavern_message_edited']?.[0];
    expect(editedHandler).toBeDefined();

    // 触发编辑 8 号楼（旧楼）
    editedHandler!(8);

    // 等待微任务完成
    await vi.waitFor(() => {
      expect(deps.runParse).toHaveBeenCalledWith(
        8,
        expect.objectContaining({
          force: false,
          downstreamWarning: true,
        }),
      );
    });
  });

  it('expectChatId 随解析选项传递，支持写前聊天复核', async () => {
    const { deps } = makeMockDeps({ chatId: 'chat-alpha' });
    const floating = makeMockFloating([]);

    await parseAndRefresh(2, floating, {}, deps);

    expect(deps.runParse).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        expectChatId: 'chat-alpha',
      }),
    );
  });

  it('findLatestAiFloor 忽略 user 楼与隐藏楼，从 getLastMessageId 逆序正确定位', () => {
    const deps = {
      getLastMessageId: () => 4,
      getChatMessages: (id: number) => {
        const map: Record<number, { role: string; is_hidden: boolean }> = {
          4: { role: 'user', is_hidden: false },
          3: { role: 'assistant', is_hidden: true },
          2: { role: 'assistant', is_hidden: false },
          1: { role: 'user', is_hidden: false },
          0: { role: 'assistant', is_hidden: false },
        };
        return map[id] ? [map[id]] : [];
      },
    };

    expect(findLatestAiFloor(deps)).toBe(2);
  });

  it('GENERATION_ENDED 事件：传入 chat.length（如 21，最后楼号为 20）时，runParse 被调用时的楼号是 20 而非 21', async () => {
    const { deps, calls, eventListeners } = makeMockDeps({
      lastId: 20,
      messages: {
        20: { role: 'assistant', is_hidden: false },
        19: { role: 'user', is_hidden: false },
      },
    });
    const floating = makeMockFloating(calls);

    installFloorObservers(floating, deps);
    // 等待 installFloorObservers 触发的初始补解析执行完毕，释放 inFlight
    await vi.waitFor(() => {
      expect(deps.runParse).toHaveBeenCalledWith(20, expect.anything());
    });
    calls.length = 0;
    (deps.runParse as unknown as { mockClear(): void }).mockClear();

    const genEndedHandler = eventListeners['tavern_generation_ended']?.[0];
    expect(genEndedHandler).toBeDefined();

    // SillyTavern 传入 chat.length (21)，而有效楼号是 0..20
    genEndedHandler!(21);

    await vi.waitFor(() => {
      expect(deps.runParse).toHaveBeenCalledWith(20, expect.objectContaining({ force: false }));
    });
    expect(deps.runParse).not.toHaveBeenCalledWith(21, expect.anything());
  });

  it('GENERATION_ENDED 事件：最后一楼是 user 时往前取最近的 AI 楼', async () => {
    const { deps, calls, eventListeners } = makeMockDeps({
      lastId: 21,
      messages: {
        21: { role: 'user', is_hidden: false },
        20: { role: 'assistant', is_hidden: false },
        19: { role: 'user', is_hidden: false },
      },
    });
    const floating = makeMockFloating(calls);

    installFloorObservers(floating, deps);
    // 等待 installFloorObservers 触发的初始补解析执行完毕，释放 inFlight
    await vi.waitFor(() => {
      expect(deps.runParse).toHaveBeenCalledWith(20, expect.anything());
    });
    calls.length = 0;
    (deps.runParse as unknown as { mockClear(): void }).mockClear();

    const genEndedHandler = eventListeners['tavern_generation_ended']?.[0];
    expect(genEndedHandler).toBeDefined();

    // 触发 GENERATION_ENDED，无论传参是什么（如 22 或 undefined），都应正确定位到最近的 AI 楼 #20
    genEndedHandler!(22);

    await vi.waitFor(() => {
      expect(deps.runParse).toHaveBeenCalledWith(20, expect.objectContaining({ force: false }));
    });
    expect(deps.runParse).not.toHaveBeenCalledWith(21, expect.anything());
    expect(deps.runParse).not.toHaveBeenCalledWith(22, expect.anything());
  });

  it('回归保护：MESSAGE_SWIPED 与 MESSAGE_EDITED 仍然使用事件参数给定的真实楼号', async () => {
    const { deps, calls, eventListeners } = makeMockDeps({
      lastId: 20,
      messages: {
        20: { role: 'assistant', is_hidden: false },
        15: { role: 'assistant', is_hidden: false },
        10: { role: 'assistant', is_hidden: false },
      },
    });
    const floating = makeMockFloating(calls);

    installFloorObservers(floating, deps);
    calls.length = 0;
    (deps.runParse as unknown as { mockClear(): void }).mockClear();

    const swipedHandler = eventListeners['tavern_message_swiped']?.[0];
    const editedHandler = eventListeners['tavern_message_edited']?.[0];
    expect(swipedHandler).toBeDefined();
    expect(editedHandler).toBeDefined();

    // SWIPED 传入 15，应当解析 #15（而非最新楼 #20）
    swipedHandler!(15);
    await vi.waitFor(() => {
      expect(deps.runParse).toHaveBeenCalledWith(15, expect.objectContaining({ force: false }));
    });

    (deps.runParse as unknown as { mockClear(): void }).mockClear();

    // EDITED 传入 10，应当解析 #10（而非最新楼 #20），且 downstreamWarning 为 true
    editedHandler!(10);
    await vi.waitFor(() => {
      expect(deps.runParse).toHaveBeenCalledWith(
        10,
        expect.objectContaining({
          force: false,
          downstreamWarning: true,
        }),
      );
    });
  });

  it('parseAndRefresh 阶段多阵营世界书同步优先复用 floating.snapshot，避免重复逆序扫楼', async () => {
    const { deps, calls } = makeMockDeps({ lastId: 5 });
    const floating = {
      ...makeMockFloating(calls),
      snapshot: { faction: { active: 'allied' } },
    };
    const getVarsSpy = vi.fn(() => ({ stat_data: { faction: { active: 'soviet' } } }));
    (globalThis as Record<string, unknown>).getVariables = getVarsSpy;
    (globalThis as Record<string, unknown>).getCharWorldbookNames = vi.fn(() => ({
      primary: '主世界书',
      additional: ['[盟军]科技树'],
    }));

    await parseAndRefresh(5, floating, {}, deps);
    expect(getVarsSpy).not.toHaveBeenCalled();

    delete (globalThis as Record<string, unknown>).getVariables;
    delete (globalThis as Record<string, unknown>).getCharWorldbookNames;
  });

  it('加载/切换聊天时：自动恢复绑定当前聊天的专属档案世界书（红警档案·*）并同步加载 $promoted/$dlc/$archive 档案书，同时排他卸载其他聊天的残留档案书', async () => {
    const { resolveActiveChatBookName } = await import('../models/archiveIndex');
    const { ensureBranchWorldbookIsolation } = await import('../../红警指挥系统/worldbook/branchBookCloner');

    const currentChatArchiveBook = '红警档案·指挥官·20261025T1200';
    const staleOtherChatArchiveBook = '红警档案·旧分支·20261001T0800';
    const promotedBook = '红警扩展·超时空重工专卷';
    const dlcBook = '特色科技·焚风';
    const customUserBook = '用户自定义世界书';
    const available = [
      '武备·盟军',
      '特色建筑·盟军',
      '特色科技·盟军',
      '工程·盟军',
      '协议',
      currentChatArchiveBook,
      staleOtherChatArchiveBook,
      promotedBook,
      dlcBook,
      'EVA·动态档案',
      customUserBook,
    ];

    // 初始全局激活列表中残留了上一场聊天的档案书 staleOtherChatArchiveBook，但缺少当前聊天的档案书
    let activeGlobal = ['武备·盟军', '协议', staleOtherChatArchiveBook, customUserBook];
    let currentBoundChatBook: string | null = null; // 模拟切换/重新加载聊天时原生绑定丢失

    const chatVars = {
      $timeline: {
        version: 1,
        originChatId: 'chat-main-01',
        boundBookName: currentChatArchiveBook,
        maxFloorWatermark: 12,
        floors: {},
      },
      $promoted: {
        超时空传送阵列: {
          targetBook: promotedBook,
          promotedAt: '2026-10-25T12:00:00.000Z',
        },
      },
      $dlc: {
        foehn_pack: {
          books: [dlcBook],
        },
      },
      $archive: {
        白凌: { kind: '人员', desc: '盟军MCV核心' },
      },
    };

    const rebindChatSpy = vi.fn(async (_target: string, bookName: string) => {
      currentBoundChatBook = bookName;
    });
    const rebindGlobalSpy = vi.fn(async (names: string[]) => {
      activeGlobal = [...names];
    });

    const syncRes = await syncMultiFactionWorldbooksOnFloorEvent({
      getStatData: () => ({ command: { unlocked_factions: ['allied'] } }),
      getGlobalWorldbookNames: () => activeGlobal,
      getWorldbookNames: () => available,
      rebindGlobalWorldbooks: rebindGlobalSpy,
      getChatWorldbookName: () => currentBoundChatBook,
      rebindChatWorldbook: rebindChatSpy,
      getChatVars: () => chatVars,
    });

    expect(syncRes.synced).toBe(true);
    expect(syncRes.reboundChatBook).toBe(true);
    expect(syncRes.boundChatBook).toBe(currentChatArchiveBook);
    expect(rebindChatSpy).toHaveBeenCalledWith('current', currentChatArchiveBook);
    expect(currentBoundChatBook).toBe(currentChatArchiveBook);

    // 验证当前聊天的档案世界书、提升档案书、DLC 书、动态正史书均已自动加载进 activeGlobal
    expect(activeGlobal).toContain(currentChatArchiveBook);
    expect(activeGlobal).toContain(promotedBook);
    expect(activeGlobal).toContain(dlcBook);
    expect(activeGlobal).toContain('EVA·动态档案');
    // 验证上一场聊天的残留档案书已被排他卸载，而用户自定义书完好保留
    expect(activeGlobal).not.toContain(staleOtherChatArchiveBook);
    expect(activeGlobal).toContain(customUserBook);

    // 验证 resolveActiveChatBookName 在宿主 getChatWorldbookName 为空时能从 $timeline.boundBookName 兜底恢复
    (globalThis as Record<string, unknown>).getChatWorldbookName = () => null;
    (globalThis as Record<string, unknown>).getVariables = () => chatVars;
    expect(resolveActiveChatBookName()).toBe(currentChatArchiveBook);

    // 验证 ensureBranchWorldbookIsolation 在同聊天重新加载且绑定丢失时自动重绑
    let gatewayBound: string | null = null;
    const isoRes = await ensureBranchWorldbookIsolation({
      currentChatId: 'chat-main-01',
      branchMaxFloor: 12,
      gateway: {
        begin: () => ({ chatId: 'chat-main-01' }),
        guardedBook: async () => currentChatArchiveBook,
        getChatWorldbookName: () => gatewayBound,
        getWorldbookNames: () => available,
        rebindChatWorldbook: async (_t, name) => {
          gatewayBound = name;
        },
      },
    });
    expect(isoRes.branched).toBe(false);
    expect(isoRes.reboundExistingBook).toBe(true);
    expect(gatewayBound).toBe(currentChatArchiveBook);

    delete (globalThis as Record<string, unknown>).getChatWorldbookName;
    delete (globalThis as Record<string, unknown>).getVariables;
  });
});
