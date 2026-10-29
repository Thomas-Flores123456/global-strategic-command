/**
 * EVT-STAGE-01 · pendingLoreGate 外部世界书落地暂存门 —— 专项单测
 * 真源：《事件系统与资金链状态机总设计案》§4.1/§4.2＋Q4 /《MVP 任务包》§3.5·§6
 * 覆盖任务验收三条：
 * 1. 新实体解析入暂存，世界书 API 调用次数为 0（spy 全程计数）；
 * 2. 触发确认函数后，原子调用世界书写入并从 pending_lore 移除（fail-closed 保全）；
 * 3. 模拟切页换槽后，暂存列表随新快照初始化，旧实体不发生落地。
 * 外加：canon 去重、kind 归一、时空锚定双途径、入参零突变、残渣容错。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';

const pda = vi.hoisted(() => ({ adopt: undefined as undefined | ((item: { id: string; name: string; kind: string; summary: string }) => Promise<void>) }));
vi.mock('../../中控悬浮窗/pda/PdaTabIntel.vue', () => ({
  default: { setup(_: unknown, { attrs }: { attrs: Record<string, unknown> }) {
    pda.adopt = attrs.onAdoptLore as typeof pda.adopt;
    return () => null;
  } },
}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// 本专项只依赖 canon；使用其真实定义，避免加载整个解析/UI循环依赖图。
vi.mock('../parse/parsePipeline', async () => {
  const { canon } = await import('../parse/parseTypesAndCanon');
  return { canon };
});
import {
  commitPendingLoreOnAdvance,
  commitPendingLoreToWorldbook,
  confirmAndCommitPendingLore,
  dismissPendingLore,
  pendingLoreAfterSwipe,
  pendingLoreIdOf,
  readPendingLore,
  stagePendingLore,
  type PendingLoreEntry,
  type WorldbookWriter,
} from '../worldbook/pendingLoreGate';
import { GirlDossier } from '../core/schema';

/* ═══════════════ 工具 ═══════════════ */

const CTX = { floor: 5, swipe: 0, day: 3 } as const;

function makeSpy(result: 'ok' | 'fail-at' | number = 'ok'): {
  write: WorldbookWriter;
  calls: PendingLoreEntry[];
  fn: ReturnType<typeof vi.fn>;
} {
  const calls: PendingLoreEntry[] = [];
  const failAfter = typeof result === 'number' ? result : result === 'ok' ? Number.POSITIVE_INFINITY : 1;
  const fn = vi.fn(async (entry: PendingLoreEntry) => {
    calls.push(entry);
    if (calls.length > failAfter) throw new Error('世界书接口超时');
  });
  return { write: fn as unknown as WorldbookWriter, calls, fn };
}

/** 深度冻结（不可变性断言用） */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/* ═══════════════ 验收①：暂存隔离（世界书 API 零调用） ═══════════════ */

describe('EVT-STAGE-01 · 验收①：新实体入暂存，世界书 API 调用次数为 0', () => {
  it('解析产出只入 Message 槽 pending_lore，全程零世界书调用（Q4 暂存隔离）', () => {
    const spy = makeSpy();
    const r = stagePendingLore(
      [],
      [
        { name: '钢铁兄弟会', kind: '势力', summary: '废土军贸集团' },
        { name: '微型聚变核心', kind: '科技', summary: 'IV 级能源科技' },
      ],
      CTX,
    );
    expect(r.added).toHaveLength(2);
    expect(r.pendingLore).toHaveLength(2);
    expect(spy.fn).not.toHaveBeenCalled(); // 铁证：暂存阶段零世界书调用
  });

  it('时空锚定：每条记录 source_floor/source_swipe/created_day', () => {
    const r = stagePendingLore([], [{ name: '黑曜石商行', kind: '势力' }], { floor: 9, swipe: 2, day: 17 });
    expect(r.added[0]).toMatchObject({
      source_floor: 9,
      source_swipe: 2,
      created_day: 17,
      id: pendingLoreIdOf('黑曜石商行'),
    });
  });

  it('canon 去重：空白/大小写变体同键拒绝追加，skipped 留痕', () => {
    const first = stagePendingLore([], [{ name: '钢铁兄弟会', kind: '势力' }], CTX);
    const dup = stagePendingLore(first.pendingLore, [{ name: ' 钢铁兄弟会 ', kind: '势力' }], CTX);
    expect(dup.added).toHaveLength(0);
    expect(dup.skipped).toEqual([{ name: '钢铁兄弟会', reason: '重名去重' }]);
    expect(dup.pendingLore).toHaveLength(1);
  });

  it('空名拒绝；非法 kind 降级其他；非字符串 name 防御不炸', () => {
    const r = stagePendingLore(
      [],
      [{ name: '', kind: '势力' }, { name: 'X', kind: '魔法' }, { name: 42 as unknown as string }],
      CTX,
    );
    expect(r.added).toHaveLength(1);
    expect(r.added[0]).toMatchObject({ name: 'X', kind: '其他' });
    expect(r.skipped).toEqual([
      { name: '', reason: '空名拒绝' },
      { name: '42', reason: '空名拒绝' },
    ]);
  });

  it('入参数组零突变；既有条目原序保留', () => {
    const seed: unknown[] = deepFreeze([
      { id: 'lore_a', name: 'A', kind: '势力', source_floor: 1, source_swipe: 0, created_day: 0 },
    ]);
    const snapshot = structuredClone(seed);
    const r = stagePendingLore(seed, [{ name: 'B', kind: '地点' }], CTX);
    expect(seed).toStrictEqual(snapshot);
    expect(r.pendingLore.map(e => e.name)).toEqual(['A', 'B']);
  });

  it('readPendingLore 容错：null/数组/缺名/缺 id 残渣静默剔除', () => {
    const junk: unknown[] = [null, [1, 2], { name: '无id' }, { id: 'lore_x', name: 'X' }, 'string'];
    expect(readPendingLore(junk)).toEqual([expect.objectContaining({ id: 'lore_x', name: 'X' })]);
  });
});

/* ═══════════════ 验收②：确认入册原子落地 ═══════════════ */

describe('EVT-STAGE-01 · 验收②：确认函数原子调用世界书写入并移除', () => {
  const staged = () =>
    stagePendingLore(
      [],
      [
        { name: '钢铁兄弟会', kind: '势力', summary: '废土军贸集团' },
        { name: '微型聚变核心', kind: '科技', summary: 'IV 级能源科技' },
        { name: '雾谷驿站', kind: '地点', summary: '七号公路中继' },
      ],
      CTX,
    ).pendingLore;

  it('全量入册：逐条按序写入、payload 完整、暂存清空、ok=true', async () => {
    const spy = makeSpy();
    const r = await commitPendingLoreToWorldbook(staged(), { write: spy.write });
    expect(r.ok).toBe(true);
    expect(r.committed.map(e => e.name)).toEqual(['钢铁兄弟会', '微型聚变核心', '雾谷驿站']);
    expect(r.pendingLore).toEqual([]);
    expect(spy.calls.map(e => e.id)).toEqual([
      pendingLoreIdOf('钢铁兄弟会'),
      pendingLoreIdOf('微型聚变核心'),
      pendingLoreIdOf('雾谷驿站'),
    ]);
    expect(spy.calls[0]).toMatchObject({
      kind: '势力',
      summary: '废土军贸集团',
      source_floor: 5,
      source_swipe: 0,
      created_day: 3,
    });
    expect(spy.fn).toHaveBeenCalledTimes(3);
  });

  it('部分确认（ids）：只移除选中项，未选条目保留', async () => {
    const spy = makeSpy();
    const r = await commitPendingLoreToWorldbook(staged(), {
      write: spy.write,
      ids: [pendingLoreIdOf('雾谷驿站')],
    });
    expect(r.ok).toBe(true);
    expect(spy.fn).toHaveBeenCalledTimes(1);
    expect(r.pendingLore.map(e => e.name)).toEqual(['钢铁兄弟会', '微型聚变核心']);
  });

  it('未知 id：预检拦截 → 零写入零移除、ok=false、缺失清单报因', async () => {
    const spy = makeSpy();
    const r = await commitPendingLoreToWorldbook(staged(), {
      write: spy.write,
      ids: [pendingLoreIdOf('不存在的实体')],
    });
    expect(r.ok).toBe(false);
    expect(spy.fn).not.toHaveBeenCalled();
    expect(r.pendingLore).toHaveLength(3);
    expect(r.error).toContain(pendingLoreIdOf('不存在的实体'));
  });

  it('写入中途抛错：fail-closed——committed 恒空、暂存整批原样保全', async () => {
    const spy = makeSpy('fail-at'); // 第 2 条起抛错
    const before = staged();
    const r = await commitPendingLoreToWorldbook(before, { write: spy.write });
    expect(r.ok).toBe(false);
    expect(r.committed).toEqual([]);
    expect(r.pendingLore).toHaveLength(3); // 移除门未开：绝不丢数据
    expect(r.error).toContain('fail-closed');
  });

  it('空暂存提交：ok=true 零调用（幂等无害）', async () => {
    const spy = makeSpy();
    const r = await commitPendingLoreToWorldbook([], { write: spy.write });
    expect(r.ok).toBe(true);
    expect(r.committed).toEqual([]);
    expect(spy.fn).not.toHaveBeenCalled();
  });
});

/* ═══════════════ 验收③：切页换槽旧暂存自动失效 ═══════════════ */

describe('EVT-STAGE-01 · 验收③：切页换槽后旧暂存不落地', () => {
  it('模拟 Swipe：基线不变、新槽视图＝基线重算、旧分支条目物理不在新槽、零世界书调用', () => {
    const spy = makeSpy();
    const baseline: unknown[] = []; // Floor5 生成前的分支基线
    const snapshot = structuredClone(baseline);

    // Floor5 Swipe0：LLM 报出新实体 → 只进该槽 Message 变量
    const slotSwipe0 = stagePendingLore(baseline, [{ name: '钢铁兄弟会', kind: '势力' }], {
      floor: 5,
      swipe: 0,
      day: 3,
    });
    expect(slotSwipe0.pendingLore).toHaveLength(1);

    // 用户切到 Swipe1：新分支槽位从同一基线重算（§4.1 铁律：换槽即换真源）
    const slotSwipe1 = pendingLoreAfterSwipe(baseline);
    expect(slotSwipe1).toEqual([]); // 旧分支暂存条目自动作废，绝不渗入
    expect(baseline).toStrictEqual(snapshot); // 门零 Chat 级写入：基线零污染
    expect(spy.fn).not.toHaveBeenCalled(); // 全程零世界书调用＝幽灵条目 100% 杜绝
  });

  it('已消费槽位的旧条目不因换槽落地：新槽基线只含已确认历史', () => {
    const spy = makeSpy();
    const confirmedHistory: unknown[] = []; // 基线中未确认的世界书项恒空
    const stale = stagePendingLore([], [{ name: '废弃分支废案', kind: '科技' }], { floor: 5, swipe: 0, day: 3 });
    // 换槽：新视图从基线重算，而非旧槽
    const after = pendingLoreAfterSwipe(confirmedHistory);
    expect(after.some(e => e.id === stale.added[0].id)).toBe(false);
    expect(spy.fn).not.toHaveBeenCalled();
  });
});

/* ═══════════════ 途径 B：时空锚定批量落盘 ═══════════════ */

describe('EVT-STAGE-01 · 途径 B：时空锚定批量落盘（进入下一楼触发）', () => {
  it('整批原子入档：全写入后清空（与途径 A 全量语义 toStrictEqual 等价）', async () => {
    const inputs: unknown[] = [];
    const staged = stagePendingLore(
      inputs,
      [
        { name: '钢铁兄弟会', kind: '势力' },
        { name: '微型聚变核心', kind: '科技' },
      ],
      { floor: 7, swipe: 1, day: 12 },
    ).pendingLore;

    const spyB = makeSpy();
    const rB = await commitPendingLoreOnAdvance(staged, { write: spyB.write });
    const spyA = makeSpy();
    const rA = await commitPendingLoreToWorldbook(staged, { write: spyA.write });

    expect(rB.ok).toBe(true);
    expect(rB.pendingLore).toEqual([]);
    expect(spyB.fn).toHaveBeenCalledTimes(2);
    expect(rA).toStrictEqual(rB); // 双途径同核：批量＝全量显式确认
  });

  it('roundtrip：stage → advance commit → 暂存清零、payload 逐字段保全', async () => {
    const spy = makeSpy();
    const raw = { verb: '势力发现', note: '世界书原文' };
    const staged = stagePendingLore([], [{ name: '雾谷驿站', kind: '地点', summary: '中继站', raw }], {
      floor: 3,
      swipe: 0,
      day: 8,
    }).pendingLore;
    const r = await commitPendingLoreOnAdvance(staged, { write: spy.write });
    expect(r.committed[0].raw).toEqual(raw);
    expect(r.pendingLore).toEqual([]);
  });
});

/* ═══════════════ 纯函数铁律 ═══════════════ */

describe('EVT-STAGE-01 · 纯函数铁律', () => {
  it('deep-frozen 输入 stage 不抛错；确定性：同输入两次 toStrictEqual 恒等', () => {
    const frozen = deepFreeze([] as unknown[]);
    const inputs = [{ name: '黑曜石商行', kind: '势力' }];
    const r1 = stagePendingLore(frozen, inputs, CTX);
    const r2 = stagePendingLore(frozen, inputs, CTX);
    expect(r1).toStrictEqual(r2);
  });
});

/* ═══════════════ FIX-P0-02 · 机娘与新势力异构混装双向非破坏守卫 ═══════════════ */

describe('FIX-P0-02 · pendingLoreGate 与未入档 GirlDossier 异构混装守卫', () => {
  it('同一楼层 pending_lore 同时含未入档 GirlDossier 与新势力时：readPendingLore 仅提取带 id 的新势力，确认或驳回新势力后未入档 GirlDossier 完好保留', async () => {
    const unfiledGirl = GirlDossier.parse({
      name: '苏离',
      model: 'F-47首台',
      keys: ['静默电行'],
      shell: '绣坊帮工',
    });
    const staged = stagePendingLore([unfiledGirl], [{ name: '铁幕重工', kind: '势力', summary: '北境军工复合体' }], CTX);

    // 1. stagePendingLore 保留原有未入档机娘
    expect(staged.pendingLore).toHaveLength(2);
    expect(staged.pendingLore[0]).toEqual(unfiledGirl);

    // 2. readPendingLore 只返回带 id 的新势力，不混入机娘
    const loreOnly = readPendingLore(staged.pendingLore);
    expect(loreOnly).toHaveLength(1);
    expect(loreOnly[0].name).toBe('铁幕重工');

    // 3. confirmAndCommitPendingLore 确认新势力后，remaining 原样保留未入档机娘
    const spy = makeSpy();
    const confirmed = await confirmAndCommitPendingLore(staged.pendingLore, {
      ids: [loreOnly[0].id],
      write: spy.write,
    });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.committed.map(c => c.name)).toEqual(['铁幕重工']);
    expect(confirmed.remaining).toEqual([unfiledGirl]);
    expect(confirmed.pendingLore).toEqual([unfiledGirl]);

    // 4. dismissPendingLore 驳回新势力后，remaining 同样原样保留未入档机娘
    const dismissed = dismissPendingLore(staged.pendingLore, [loreOnly[0].id]);
    expect(dismissed.dismissed.map(d => d.name)).toEqual(['铁幕重工']);
    expect(dismissed.remaining).toEqual([unfiledGirl]);
  });
});

describe('G08-01 · 真实写入成功才核销', () => {
  const pending = stagePendingLore([], [{ name: '铁幕重工', kind: '势力', summary: '北境军工复合体' }], CTX).pendingLore;

  it('缺失 writer 明确失败，原始暂存保持可重试', async () => {
    const result = await confirmAndCommitPendingLore(pending);
    expect(result).toMatchObject({ ok: false, committed: [] });
    expect(result.error).toContain('写入器');
    expect(result.pendingLore).toBe(pending);
    expect(result.remaining).toBe(pending);
  });

  it.each(['聊天守卫拒写', '世界书接口超时'])('%s 时保留原始暂存', async error => {
    const result = await confirmAndCommitPendingLore(pending, {
      write: async () => { throw new Error(error); },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain(error);
    expect(result.committed).toEqual([]);
    expect(result.pendingLore).toBe(pending);
    expect(result.remaining).toBe(pending);
  });

  it('等待 writer 完成后才返回成功；原暂存重试不丢正文', async () => {
    let finish!: () => void;
    const written = new Map<string, string>();
    const writing = new Promise<void>(resolve => { finish = resolve; });
    const write = vi.fn(async (entry: PendingLoreEntry) => {
      await writing;
      written.set(entry.id, entry.summary);
    });
    let settled = false;
    const resultPromise = confirmAndCommitPendingLore(pending, { write }).then(result => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(written.size).toBe(0);
    expect(write).toHaveBeenCalledWith(pending[0]);
    finish();
    const result = await resultPromise;
    expect(result.ok).toBe(true);
    expect(result.remaining).toEqual([]);
    expect(written.get(pending[0].id)).toBe('北境军工复合体');
    await confirmAndCommitPendingLore(pending, { write });
    expect(written.size).toBe(1);
  });

  it('PDA真实writer：守卫拒写/接口失败不核销，成功重试幂等入书并保留正文', async () => {
    const { default: Frame } = await import('../../中控悬浮窗/pda/PdaWindowFrame.vue');
    const { createPdaShell } = await import('../../中控悬浮窗/pda/pdaState');
    const { chatBookGateway } = await import('../worldbook/chatBookBinding');
    const shell = createPdaShell({ viewport: () => ({ width: 1440, height: 900 }) });
    shell.setActiveTab('intel');
    const snapshot = { pending_lore: pending, factions: [] };
    let vars = { stat_data: snapshot };
    let entries: WorldbookEntry[] = [];
    const updateVars = vi.fn(async (updater: (v: typeof vars) => typeof vars) => { vars = updater(vars); });
    const updateBook = vi.fn(async (_book: string, updater: WorldbookUpdater) => {
      entries = await updater(entries) as WorldbookEntry[];
      return entries;
    });
    vi.stubGlobal('updateVariablesWith', updateVars);
    vi.stubGlobal('updateWorldbookWith', updateBook);
    vi.spyOn(chatBookGateway, 'begin').mockReturnValue({ chatId: 'chat-a' });
    const guard = vi.spyOn(chatBookGateway, 'guardedBook').mockRejectedValueOnce(new Error('守卫拒写'));
    await renderToString(createSSRApp({ render: () => h(Frame, { shell, snapshot, floorId: 5 }) }));
    await pda.adopt!(pending[0]);
    expect(updateBook).not.toHaveBeenCalled();
    expect(updateVars).not.toHaveBeenCalled();
    expect(vars.stat_data.pending_lore).toBe(pending);
    guard.mockResolvedValue('chat-a-book');
    updateBook.mockRejectedValueOnce(new Error('写入失败'));
    await pda.adopt!(pending[0]);
    expect(updateVars).not.toHaveBeenCalled();
    await pda.adopt!(pending[0]);
    expect(updateBook).toHaveBeenLastCalledWith('chat-a-book', expect.any(Function));
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toContain(pending[0].summary);
    expect(entries[0].extra?.pendingLoreId).toBe(pending[0].id);
    expect(vars.stat_data.pending_lore).toEqual([]);
    await pda.adopt!(pending[0]); // 旧快照重试，不得重复造条
    expect(entries).toHaveLength(1);
  });
});

describe('G08-06 · 异步写书等待期间切换 Swipe 或末楼时不核销暂存并停止后续批次项', () => {
  const twoPending = stagePendingLore(
    [],
    [
      { name: '铁幕重工', kind: '势力', summary: '北境军工复合体' },
      { name: '幽灵矿业', kind: '势力', summary: '暗网矿石走私商' },
    ],
    { floor: 5, swipe: 0, day: 3 },
  ).pendingLore;

  it('write 异步等待期间当前楼层 swipe_id 切换 → 不从 pending_lore 核销该条目，跳过后续批次项；Swipe 未变时正常核销', async () => {
    const g = globalThis as Record<string, unknown>;
    const saved = { glmi: g.getLastMessageId, gcm: g.getChatMessages };
    let currentSwipe = 0;
    let currentLastFloor = 5;
    g.getLastMessageId = () => currentLastFloor;
    g.getChatMessages = (id: number) => (id === 5 ? [{ swipe_id: currentSwipe }] : []);
    try {
      // 1. 第一项 write 等待期间 swipe_id 从 0 切换到 1 → 返回 ok=false，暂存列表原样保留，第二项不触发 write
      const written1: string[] = [];
      const resDrifted = await confirmAndCommitPendingLore(twoPending, {
        write: async entry => {
          written1.push(entry.name);
          currentSwipe = 1;
        },
      });
      expect(resDrifted.ok).toBe(false);
      expect(resDrifted.committed).toEqual([]);
      expect(resDrifted.pendingLore).toBe(twoPending);
      expect(resDrifted.remaining).toBe(twoPending);
      expect(written1).toEqual(['铁幕重工']); // 第二项幽灵矿业被及时跳过

      // 2. 切回 swipe_id = 0，write 期间 floorId 与 swipeId 均未漂移 → 整批正常核销
      currentSwipe = 0;
      const written2: string[] = [];
      const resOk = await confirmAndCommitPendingLore(twoPending, {
        write: async entry => {
          written2.push(entry.name);
        },
      });
      expect(resOk.ok).toBe(true);
      expect(resOk.committed).toHaveLength(2);
      expect(resOk.remaining).toEqual([]);
      expect(written2).toEqual(['铁幕重工', '幽灵矿业']);

      // 3. write 异步等待期间末楼 floorId 发生变化（5 → 6）→ 同样拒绝核销并跳过后续项
      const written3: string[] = [];
      const resFloorDrifted = await confirmAndCommitPendingLore(twoPending, {
        write: async entry => {
          written3.push(entry.name);
          currentLastFloor = 6;
        },
      });
      expect(resFloorDrifted.ok).toBe(false);
      expect(resFloorDrifted.pendingLore).toBe(twoPending);
      expect(resFloorDrifted.remaining).toBe(twoPending);
      expect(written3).toEqual(['铁幕重工']);
    } finally {
      g.getLastMessageId = saved.glmi;
      g.getChatMessages = saved.gcm;
    }
  });
});
