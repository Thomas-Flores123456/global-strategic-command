/**
 * scheduleRunner 测试（CTRL-RECONCILE-01 标准① · 案A）：事件配对 / 令牌一次性消费 /
 * Helper 假 AFTER_COMMANDS 排除 / 无在编事务零注入 / 注入→清理生命周期（四路）/ start·stop 幂等。
 * 骨架复刻 advisoryRunner.test.ts；宿主 API 全部 mock，不触碰酒馆。
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { SCHEDULE_INJECT_CONFIG, SCHEDULE_INJECT_ID } from '../../红警指挥系统/planning/scheduleText';
import { setCachedDynamicCatalog } from '../../红警指挥系统/composables/useCatalog';
import { createScheduleRunner, type ScheduleDeps, type ScheduleEventNames } from '../host/scheduleRunner';

const EVENTS: ScheduleEventNames = {
  GENERATION_STARTED: 'generation_started',
  GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
  GENERATION_STOPPED: 'generation_stopped',
  GENERATION_ENDED: 'generation_ended',
};

/** 核心 Generate 的 options 形状（含核心字段） */
const coreOptions = (extra: Record<string, unknown> = {}) => ({ automatic_trigger: undefined, depth: 0, ...extra });

type Msg = { role: 'user' | 'assistant' | 'system'; is_hidden: boolean; data?: Record<string, any> };
const ai = (stat_data: unknown): Msg => ({ role: 'assistant', is_hidden: false, data: { stat_data } });
const user = (): Msg => ({ role: 'user', is_hidden: false, data: {} });

/** 含在编事务的合法 stat_data（queue 元素走 schema 默认补齐：status 默认 active） */
const validStat = {
  bases: [{ id: 'b1', name: '北坡主基地', buildings: [] }],
  queues: [{ type: '生产', item: '犀牛主战坦克', base: 'b1' }],
  clock: { day: 3, time: '14:05' },
};
/** 无在编事务：空队列 */
const idleStat = { bases: [{ id: 'b1', name: '北坡主基地', buildings: [] }], queues: [] };
/** 无在编事务：仅终态 */
const doneOnlyStat = {
  bases: [{ id: 'b1', name: '北坡主基地', buildings: [] }],
  queues: [{ type: '生产', item: '旧账', base: 'b1', status: 'done', progress: 100 }],
};

function harness(
  floors: Msg[] = [user(), ai(validStat)],
  chatVars: Record<string, unknown> = {},
  extraDeps: Partial<ScheduleDeps> = {},
) {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const deps: ScheduleDeps = {
    eventOn: vi.fn((event, listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    }),
    eventRemoveListener: vi.fn((event, listener) => {
      listeners.get(event)?.delete(listener);
    }),
    injectPrompts: vi.fn(),
    uninjectPrompts: vi.fn(),
    getLastMessageId: vi.fn(() => floors.length - 1),
    getChatMessages: vi.fn((id: number) => (floors[id] ? [floors[id]] : [])),
    getVariables: vi.fn(() => chatVars),
    ...extraDeps,
    events: EVENTS,
  };
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  const listenerCount = () => [...listeners.values()].reduce((n, set) => n + set.size, 0);
  const runner = createScheduleRunner(deps);
  return { deps, emit, runner, listenerCount };
}

describe('start / stop 幂等', () => {
  it('start 注册四路监听，重复 start 不重复注册', () => {
    const { deps, runner, listenerCount } = harness();
    expect(runner.isStarted()).toBe(false);
    runner.start();
    runner.start();
    expect(runner.isStarted()).toBe(true);
    expect(deps.eventOn).toHaveBeenCalledTimes(4);
    expect(listenerCount()).toBe(4);
    const events = (deps.eventOn as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(events).toEqual([
      EVENTS.GENERATION_STARTED,
      EVENTS.GENERATION_AFTER_COMMANDS,
      EVENTS.GENERATION_STOPPED,
      EVENTS.GENERATION_ENDED,
    ]);
  });

  it('stop 移除全部监听并显式 uninject（pagehide 路）；重复 stop / 未 start 的 stop 无副作用', () => {
    const { deps, runner, listenerCount, emit } = harness();
    runner.stop();
    expect(deps.uninjectPrompts).not.toHaveBeenCalled();
    runner.start();
    runner.stop();
    expect(runner.isStarted()).toBe(false);
    expect(listenerCount()).toBe(0);
    expect(deps.eventRemoveListener).toHaveBeenCalledTimes(4);
    expect(deps.uninjectPrompts).toHaveBeenCalledTimes(1);
    expect(deps.uninjectPrompts).toHaveBeenCalledWith([SCHEDULE_INJECT_ID]);
    runner.stop();
    expect(deps.uninjectPrompts).toHaveBeenCalledTimes(1);
    // 停止后事件不再触发注入
    emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(deps.injectPrompts).not.toHaveBeenCalled();
  });
});

describe('§3.5 令牌配对与注入内容', () => {
  it('STARTED → AFTER_COMMANDS（核心 options）配对成功 → 注入 §3.8 对齐配置', () => {
    const { deps, runner, emit } = harness();
    runner.start();
    emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(deps.injectPrompts).toHaveBeenCalledTimes(1);
    const [prompts] = (deps.injectPrompts as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject(SCHEDULE_INJECT_CONFIG);
    // 两级分组内容：基地名↔id 映射（b1→北坡主基地）、产线、时钟、研究调度一节
    // CTRL-PROD-LANE-01 钉死更新：犀牛主战坦克经 Q2 推导归 lane.vehicle_land（载具线拆海陆空），
    // 夹具基地无战车工厂 → 容量 0 照实呈现（在编 1/0）；旧「生产产线（在编 1/1）」系 v1 base|type 单线语义
    expect(prompts[0].content).toContain('◆ 基地「北坡主基地」');
    expect(prompts[0].content).toContain('▸ 陆地载具生产线（在编 1/0）');
    expect(prompts[0].content).toContain('· 犀牛主战坦克——');
    expect(prompts[0].content).toContain('◆ 战区时：第 3 日 14:05');
    expect(prompts[0].content).toContain('◆ 战区科研调度');
    expect(prompts[0].content).toContain('未建成，序列未开通');
    // 管线词禁令：注入文本不出现 槽位/带宽/token
    expect(prompts[0].content).not.toMatch(/带宽|token/i);
    expect(prompts[0].content).not.toContain('slot.');
  });

  it('无 STARTED 的 AFTER_COMMANDS（Helper generate：options 为 {}）→ 不注入', () => {
    const { deps, runner, emit } = harness();
    runner.start();
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
    expect(deps.injectPrompts).not.toHaveBeenCalled();
  });

  it('有 STARTED 但 options 为 {} → 不注入（options 缺核心字段）', () => {
    const { deps, runner, emit } = harness();
    runner.start();
    emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', {}, false);
    expect(deps.injectPrompts).not.toHaveBeenCalled();
  });

  it('令牌一次性消费：同一 STARTED 后第二次 AFTER_COMMANDS 不注入；新 STARTED 后再次可注入', () => {
    const { deps, runner, emit } = harness();
    runner.start();
    emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(deps.injectPrompts).toHaveBeenCalledTimes(1);
    emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(deps.injectPrompts).toHaveBeenCalledTimes(2);
  });

  it('被拒绝的 AFTER_COMMANDS 也消费令牌（dry_run 后紧跟的 Helper 假事件不能借用令牌）', () => {
    const { deps, runner, emit } = harness();
    runner.start();
    emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), true);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), true);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(deps.injectPrompts).not.toHaveBeenCalled();
  });

  it('fail-closed 类型：quiet / impersonate / automatic_trigger / depth>0 → 不注入', () => {
    const { deps, runner, emit } = harness();
    runner.start();
    for (const [type, options] of [
      ['quiet', coreOptions()],
      ['impersonate', coreOptions()],
      ['normal', coreOptions({ automatic_trigger: true })],
      ['normal', coreOptions({ depth: 2 })],
    ] as const) {
      emit(EVENTS.GENERATION_STARTED, type, options, false);
      emit(EVENTS.GENERATION_AFTER_COMMANDS, type, options, false);
    }
    expect(deps.injectPrompts).not.toHaveBeenCalled();
  });

  it('无有效楼（全部 user / 损坏）→ 不注入', () => {
    const { deps, runner, emit } = harness([user(), ai({ schema_version: 2, exposure: { value: 99 } })]);
    runner.start();
    emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(deps.injectPrompts).not.toHaveBeenCalled();
  });

  it('type 为 undefined（顶部正常发送）按 normal 处理；options 非对象按 {} 处理', () => {
    const { deps, runner, emit } = harness();
    runner.start();
    emit(EVENTS.GENERATION_STARTED, undefined, coreOptions(), false);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, undefined, coreOptions(), false);
    expect(deps.injectPrompts).toHaveBeenCalledTimes(1);
    emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', null, false);
    expect(deps.injectPrompts).toHaveBeenCalledTimes(1);
  });
});

describe('无在编事务 → 零注入', () => {
  it('空队列 → 不注入', () => {
    const { deps, runner, emit } = harness([user(), ai(idleStat)]);
    runner.start();
    emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(deps.injectPrompts).not.toHaveBeenCalled();
  });

  it('仅 done/cancelled 终态 → 不注入', () => {
    const { deps, runner, emit } = harness([user(), ai(doneOnlyStat)]);
    runner.start();
    emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(deps.injectPrompts).not.toHaveBeenCalled();
  });
});

describe('注入 → 清理生命周期（四路）', () => {
  function injectOnce(h: ReturnType<typeof harness>) {
    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(h.deps.injectPrompts).toHaveBeenCalledTimes(1);
  }

  it('GENERATION_ENDED 清理一次；重复 ENDED 不重复 uninject', () => {
    const h = harness();
    h.runner.start();
    injectOnce(h);
    h.emit(EVENTS.GENERATION_ENDED, 1);
    h.emit(EVENTS.GENERATION_ENDED, 1);
    expect(h.deps.uninjectPrompts).toHaveBeenCalledTimes(1);
    expect(h.deps.uninjectPrompts).toHaveBeenCalledWith([SCHEDULE_INJECT_ID]);
  });

  it('GENERATION_STOPPED 清理一次；重复 STOPPED 幂等', () => {
    const h = harness();
    h.runner.start();
    injectOnce(h);
    h.emit(EVENTS.GENERATION_STOPPED);
    h.emit(EVENTS.GENERATION_STOPPED);
    expect(h.deps.uninjectPrompts).toHaveBeenCalledTimes(1);
  });

  it('下次 GENERATION_STARTED 清掉旧注入；无注入时 STARTED 不调用 uninject', () => {
    const h = harness();
    h.runner.start();
    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    expect(h.deps.uninjectPrompts).not.toHaveBeenCalled();
    h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    expect(h.deps.uninjectPrompts).toHaveBeenCalledTimes(1);
  });

  it('stop（pagehide 路）：有注入时清理并移除监听', () => {
    const h = harness();
    h.runner.start();
    injectOnce(h);
    h.runner.stop();
    expect(h.deps.uninjectPrompts).toHaveBeenCalledTimes(1);
    expect(h.listenerCount()).toBe(0);
  });

  it('两轮连续生成（无 ENDED/STOPPED）：第二轮注入前旧注入已被清掉（uninject 先于 inject）', () => {
    const h = harness();
    h.runner.start();
    injectOnce(h);
    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    const order = (h.deps.uninjectPrompts as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const second = (h.deps.injectPrompts as ReturnType<typeof vi.fn>).mock.invocationCallOrder[1];
    expect(order).toBeLessThan(second);
  });
});

describe('宿主异常与 $dlc 读取', () => {
  it('getChatMessages 抛错 → fail-closed 不注入、不抛出', () => {
    const h = harness();
    (h.deps.getChatMessages as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('boom');
    });
    h.runner.start();
    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    expect(() => h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false)).not.toThrow();
    expect(h.deps.injectPrompts).not.toHaveBeenCalled();
  });

  it('getVariables 抛错 / $dlc 缺失 → 按基础目录注入', () => {
    const h = harness([user(), ai(validStat)], {});
    (h.deps.getVariables as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('no chat');
    });
    h.runner.start();
    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(h.deps.injectPrompts).toHaveBeenCalledTimes(1);
    expect(h.deps.getVariables).toHaveBeenCalledWith({ type: 'chat' });
  });
});

/* ═════════ R3：世界书动态目录接线（runner → useCatalog 模块级缓存） ═════════ */

describe('R3 世界书动态目录接线', () => {
  /** 世界书新增研究（line=工业基础 → slot.industry）；静态基线与 $dlc 均无此名 */
  const WB_CATALOG = {
    buildings: [],
    researches: [
      {
        type: 'research' as const,
        id: 'WB-R3-001',
        name: '世界书新增研究',
        cost: 200,
        eta: '约2日',
        line: '工业基础',
        tier: 1 as const,
        prereqs: [],
        need_buildings: [],
        tags: [],
        desc: 'R3 接线测试条目',
      },
    ],
    productions: [],
    retrofits: [],
    projects: [],
    byId: {},
    items: [],
    diagnostics: [],
  };
  /** 矿石精炼厂在场（工业基础序列开通）；在编事务为世界书新增研究 */
  const wbStat = {
    bases: [{ id: 'b1', name: '北坡主基地', buildings: [{ name: '矿石精炼厂', state: '运转' }] }],
    queues: [{ type: '研究', item: '世界书新增研究', base: 'b1' }],
    clock: { day: 3, time: '14:05' },
  };

  afterEach(() => setCachedDynamicCatalog(null));

  it('缓存就绪（catalog.init 后）：世界书研究经 runner 接线命中工业基础研究序列', () => {
    setCachedDynamicCatalog(WB_CATALOG);
    const h = harness([user(), ai(wbStat)]);
    h.runner.start();
    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(h.deps.injectPrompts).toHaveBeenCalledTimes(1);
    const [prompts] = (h.deps.injectPrompts as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prompts[0].content).toContain('▸ 工业基础研究序列（在编 1/1）');
    expect(prompts[0].content).toContain('· 世界书新增研究——');
    expect(prompts[0].content).not.toContain('遗留');
  });

  it('缓存未就绪（init 前 null）：退化静态基线——同名研究兜底主建筑序列（已知预期）', () => {
    setCachedDynamicCatalog(null);
    const h = harness([user(), ai(wbStat)]);
    h.runner.start();
    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(h.deps.injectPrompts).toHaveBeenCalledTimes(1);
    const [prompts] = (h.deps.injectPrompts as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prompts[0].content).toContain('▸ 工业基础研究序列（在编 0/1）');
    expect(prompts[0].content).toContain('遗留 1 项在册');
  });

  it('readDynamicCatalog 覆盖注入且抛错：仅降级为静态基线，本轮仍正常注入', () => {
    const h = harness([user(), ai(wbStat)], {}, {
      readDynamicCatalog: () => {
        throw new Error('宿主动态源异常');
      },
    });
    h.runner.start();
    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    expect(() => h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false)).not.toThrow();
    expect(h.deps.injectPrompts).toHaveBeenCalledTimes(1);
    const [prompts] = (h.deps.injectPrompts as ReturnType<typeof vi.fn>).mock.calls[0];
    // 降级口径：世界书研究未被 line 命中，兜底主建筑序列
    expect(prompts[0].content).toContain('▸ 工业基础研究序列（在编 0/1）');
  });

  it('FD-45：当 queues 为空但存在在建重大工程或跨楼层刚竣工工程时，scheduleRunner 正常注入「◆ 重大工程与改装项目」', () => {
    const prevStatWithActiveProject = {
      bases: [{ id: 'b1', name: '北坡主基地', buildings: [] }],
      queues: [],
      projects: [
        {
          id: 'proj:carrier@b1',
          ref: '小鹰号电弹现代化改装',
          scope: 'base',
          bases: ['b1'],
          lead_base: 'b1',
          grade: '大改',
          status: '在建',
          phases: [
            { idx: 0, name: '反应堆换装', status: '完工', queue_index: null },
            { idx: 1, name: '电磁弹射器安装', status: '进行中', queue_index: 0 },
          ],
        },
      ],
    };
    const currStatWithCompletedProject = {
      bases: [{ id: 'b1', name: '北坡主基地', buildings: [] }],
      queues: [],
      projects: [
        {
          id: 'proj:carrier@b1',
          ref: '小鹰号电弹现代化改装',
          scope: 'base',
          bases: ['b1'],
          lead_base: 'b1',
          grade: '大改',
          status: '完工',
          phases: [
            { idx: 0, name: '反应堆换装', status: '完工', queue_index: null },
            { idx: 1, name: '电磁弹射器安装', status: '完工', queue_index: null },
          ],
        },
      ],
    };

    const h = harness([ai(prevStatWithActiveProject), user(), ai(currStatWithCompletedProject)]);
    h.runner.start();
    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);

    expect(h.deps.injectPrompts).toHaveBeenCalledTimes(1);
    const [prompts] = (h.deps.injectPrompts as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prompts[0].content).toContain('◆ 重大工程与改装项目');
    expect(prompts[0].content).toContain('★ 近期工程里程碑：工程《小鹰号电弹现代化改装》（主责：北坡主基地）全部阶段已正式竣工交付！');
    expect(prompts[0].content).not.toContain('proj:carrier@b1');
    h.runner.stop();
  });
});
