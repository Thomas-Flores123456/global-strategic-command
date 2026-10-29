/**
 * advisoryRunner 测试（RAC-ENTRY-01）：事件配对 / 令牌一次性消费 / Helper 假 AFTER_COMMANDS 排除 /
 * 注入→清理生命周期（四路）/ 重复事件幂等 / start·stop 幂等。宿主 API 全部 mock，不触碰酒馆。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RESEARCH_ADVISORY_INJECT_CONFIG, RESEARCH_ADVISORY_INJECT_ID } from '../../红警指挥系统/planning/researchAdvisory';
import {
  DEFAULT_FEEDFORWARD_PREFERENCES,
  setFeedforwardPreferences,
  STRATEGIC_FEEDFORWARD_INJECT_CONFIG,
  STRATEGIC_FEEDFORWARD_INJECT_ID,
} from '../../红警指挥系统/planning/strategicFeedforward';
import { setCachedDynamicCatalog } from '../../红警指挥系统/composables/useCatalog';
import {
  createAdvisoryRunner,
  createStrategicFeedforwardRunner,
  type AdvisoryDeps,
  type AdvisoryEventNames,
} from '../host/advisoryRunner';

const EVENTS: AdvisoryEventNames = {
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
const validStat = { bases: [{ id: 'b1', name: '北坡主基地', buildings: [] }] };

function harness(
  floors: Msg[] = [user(), ai(validStat)],
  chatVars: Record<string, unknown> = {},
  extraDeps: Partial<AdvisoryDeps> = {},
) {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const deps: AdvisoryDeps = {
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
  const runner = createAdvisoryRunner(deps);
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
    expect(deps.uninjectPrompts).toHaveBeenCalledWith([RESEARCH_ADVISORY_INJECT_ID]);
    runner.stop();
    expect(deps.uninjectPrompts).toHaveBeenCalledTimes(1);
    // 停止后事件不再触发注入
    emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(deps.injectPrompts).not.toHaveBeenCalled();
  });
});

describe('§3.5 令牌配对', () => {
  it('STARTED → AFTER_COMMANDS（核心 options）配对成功 → 注入 §3.8 配置', () => {
    const { deps, runner, emit } = harness();
    runner.start();
    emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(deps.injectPrompts).toHaveBeenCalledTimes(1);
    const [prompts] = (deps.injectPrompts as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject(RESEARCH_ADVISORY_INJECT_CONFIG);
    expect(prompts[0].content).toContain('北坡主基地');
    expect(prompts[0].content).toContain('第 1 楼');
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
    expect(h.deps.uninjectPrompts).toHaveBeenCalledWith([RESEARCH_ADVISORY_INJECT_ID]);
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

  it('getVariables 抛错 / $dlc 缺失 → 按纯 base 目录注入', () => {
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
  /** 世界书新增研究（静态基线与 $dlc 均无此名）；经 runner 接线进入研究建议候选 */
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

  afterEach(() => setCachedDynamicCatalog(null));

  it('缓存就绪（catalog.init 后）：世界书新增研究出现在注入的研究建议文本', () => {
    setCachedDynamicCatalog(WB_CATALOG);
    const h = harness([user(), ai({ economy: { credits: 1000 }, ...validStat })]);
    h.runner.start();
    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(h.deps.injectPrompts).toHaveBeenCalledTimes(1);
    const [prompts] = (h.deps.injectPrompts as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prompts[0].content).toContain('世界书新增研究');
    expect(prompts[0].content).toContain('费用 200');
  });

  it('缓存未就绪（init 前 null）：退化静态基线——建议文本不含世界书新增研究（已知预期）', () => {
    setCachedDynamicCatalog(null);
    const h = harness([user(), ai(validStat)]);
    h.runner.start();
    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);
    expect(h.deps.injectPrompts).toHaveBeenCalledTimes(1);
    const [prompts] = (h.deps.injectPrompts as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prompts[0].content).not.toContain('世界书新增研究');
  });

  it('readDynamicCatalog 覆盖注入且抛错：仅降级为静态基线，本轮仍正常注入', () => {
    const h = harness([user(), ai(validStat)], {}, {
      readDynamicCatalog: () => {
        throw new Error('宿主动态源异常');
      },
    });
    h.runner.start();
    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    expect(() => h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false)).not.toThrow();
    expect(h.deps.injectPrompts).toHaveBeenCalledTimes(1);
  });
});

describe('FD-31 PKG-B · createStrategicFeedforwardRunner 战区全局态势与八维组合诊断接线', () => {
  const storeMap = new Map<string, string>();
  const fakeLocalStorage = {
    getItem: (k: string) => storeMap.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storeMap.set(k, v);
    },
    removeItem: (k: string) => {
      storeMap.delete(k);
    },
    clear: () => {
      storeMap.clear();
    },
  };

  beforeEach(() => {
    storeMap.clear();
    vi.stubGlobal('localStorage', fakeLocalStorage);
    setFeedforwardPreferences(DEFAULT_FEEDFORWARD_PREFERENCES);
  });

  afterEach(() => {
    setFeedforwardPreferences(DEFAULT_FEEDFORWARD_PREFERENCES);
    vi.unstubAllGlobals();
  });

  it('STARTED → AFTER_COMMANDS 注入 STRATEGIC_FEEDFORWARD_INJECT_ID 并支持四路清理', () => {
    const h = harness([
      user(),
      ai({
        economy: { credits: 1500 },
        bases: [
          {
            id: 'b1',
            name: '北坡主基地',
            status: '运转中',
            buildings: [
              { name: '盟军建造厂', state: '运转' },
              { name: '盟军发电厂', state: '运转' },
            ],
          },
        ],
        forces: {
          girls: [{ name: '白凌', duty: '首席副官', hp: '完好', base: 'b1', affection: 65, traits: ['精准装配'] }],
        },
      }),
    ]);
    const ffRunner = createStrategicFeedforwardRunner(h.deps as any);
    ffRunner.start();

    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);

    expect(h.deps.injectPrompts).toHaveBeenCalledTimes(1);
    const [prompts] = (h.deps.injectPrompts as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject(STRATEGIC_FEEDFORWARD_INJECT_CONFIG);
    expect(prompts[0].content).toContain('[战区全局态势与参谋部八维组合诊断 · 只读前馈视图]');
    expect(prompts[0].content).toContain('北坡主基地');
    expect(prompts[0].content).toContain('白凌');

    h.emit(EVENTS.GENERATION_ENDED, 1);
    expect(h.deps.uninjectPrompts).toHaveBeenCalledWith([STRATEGIC_FEEDFORWARD_INJECT_ID]);
    ffRunner.stop();
  });

  it('未传自定义 injectPrompts override 时，默认复用全局 injectPrompts（修复 getHost 未定义静默吞错 Bug）', () => {
    const globalInjectSpy = vi.fn();
    vi.stubGlobal('injectPrompts', globalInjectSpy);

    const h = harness([user(), ai(validStat)]);
    const { injectPrompts: _omit, ...depsWithoutInject } = h.deps;
    const ffRunner = createStrategicFeedforwardRunner(depsWithoutInject as any);
    ffRunner.start();

    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);

    expect(globalInjectSpy).toHaveBeenCalledTimes(1);
    const [prompts] = globalInjectSpy.mock.calls[0];
    expect(prompts[0]).toMatchObject(STRATEGIC_FEEDFORWARD_INJECT_CONFIG);
    expect(prompts[0].content).toContain('北坡主基地');
    ffRunner.stop();
  });

  it('当 $boot.choices 为 pre_transmigration（未绑定系统）时，注入的前馈提示词包含原世界序章零系统门禁', () => {
    const h = harness(
      [
        ai({ bases: [], forces: { girls: [], vehicles: [] } }),
        { role: 'user', is_hidden: false, message: '先在原世界采购物资准备出发', data: {} } as any,
      ],
      {
        $boot: {
          confirmed: true,
          choices: {
            entryMode: 'pre_transmigration',
            systemLinkMode: 'post_transmigration_bind',
          },
        },
      },
    );
    const ffRunner = createStrategicFeedforwardRunner(h.deps as any);
    ffRunner.start();

    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);

    expect(h.deps.injectPrompts).toHaveBeenCalledTimes(1);
    const [prompts] = (h.deps.injectPrompts as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(prompts[0].content).toContain('阶段0 · 原世界序章（系统尚未绑定）');
    expect(prompts[0].content).toContain('零系统未绑定阶段');
    expect(prompts[0].content).not.toContain('白凌（盟军');
    ffRunner.stop();
  });

  it('当 setFeedforwardPreferences({ enabled: false }) 时，不执行注入并清理已有注入', () => {
    setFeedforwardPreferences({ enabled: false });
    const h = harness([user(), ai(validStat)]);
    const ffRunner = createStrategicFeedforwardRunner(h.deps as any);
    ffRunner.start();

    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);

    expect(h.deps.injectPrompts).not.toHaveBeenCalled();
    ffRunner.stop();
  });

  it('ModalSettings 挂载 PanelFeedforwardSettings（「参谋前馈」分组及 policy/preview 双子页）', () => {
    const dir = join(__dirname, '..');
    const modalSfc = readFileSync(join(dir, 'modals/ModalSettings.vue'), 'utf8');
    const panelSfc = readFileSync(join(dir, 'panels/PanelFeedforwardSettings.vue'), 'utf8');

    expect(modalSfc).toMatch(/import\s+PanelFeedforwardSettings\s+from\s+['"]\.\.\/panels\/PanelFeedforwardSettings\.vue['"]/);
    expect(modalSfc).toMatch(/key:\s*'feedforward',\s*\n?\s*label:\s*'参谋前馈'/);
    expect(modalSfc).toMatch(/#panel-feedforward-policy[\s\S]*?<PanelFeedforwardSettings\s+page="policy"\s*\/>/);
    expect(modalSfc).toMatch(/#panel-feedforward-preview[\s\S]*?<PanelFeedforwardSettings\s+page="preview"\s*\/>/);

    expect(panelSfc).toContain('resolveCampaignPhase');
    expect(panelSfc).toContain('setFeedforwardPreferences');
    expect(panelSfc).toContain('deriveStrategicFeedforward');
    expect(panelSfc).toContain('formatStrategicFeedforwardPrompt');
  });

  it('FD-45：createStrategicFeedforwardRunner 跨两层有效楼（#N-1 vs #N）自动注入最新竣工里程碑与下游解锁提示', () => {
    const prevFloorStat = {
      bases: [
        {
          id: 'b1',
          name: '北坡主基地',
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军战车工厂', state: '建造中', progress: 80 },
          ],
        },
      ],
      forces: { girls: [{ name: '白凌', duty: '副官', hp: '完好', base: '北坡主基地' }], troops: {}, vehicles: [] },
      queues: [],
    };
    const currFloorStat = {
      bases: [
        {
          id: 'b1',
          name: '北坡主基地',
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军战车工厂', state: '运转', progress: 100 },
          ],
        },
      ],
      forces: {
        girls: [{ name: '白凌', duty: '副官', hp: '完好', base: '北坡主基地' }],
        troops: {},
        vehicles: ['多功能步兵车'],
      },
      queues: [{ type: '生产', item: '灰熊主战坦克', base: 'b1', status: 'settling', progress: 100, qty: 1, qty_done: 1 }],
    };

    const h = harness([ai(prevFloorStat), user(), ai(currFloorStat)]);
    const ffRunner = createStrategicFeedforwardRunner(h.deps as any);
    ffRunner.start();

    h.emit(EVENTS.GENERATION_STARTED, 'normal', coreOptions(), false);
    h.emit(EVENTS.GENERATION_AFTER_COMMANDS, 'normal', coreOptions(), false);

    expect(h.deps.injectPrompts).toHaveBeenCalledTimes(1);
    const [prompts] = (h.deps.injectPrompts as ReturnType<typeof vi.fn>).mock.calls[0];
    const content = prompts[0].content as string;
    expect(content).toContain('【本轮最新竣工与待收讫里程碑（参谋部重点督办）】');
    expect(content).toContain('★ [待交割收讫·settling]');
    expect(content).toContain('灰熊主战坦克');
    expect(content).toContain('本轮刚竣工入账·勿重复报账');
    expect(content).toContain('盟军战车工厂');
    expect(content).toContain('多功能步兵车');
    expect(content).toContain('机魂初诞契机');
    ffRunner.stop();
  });
});

