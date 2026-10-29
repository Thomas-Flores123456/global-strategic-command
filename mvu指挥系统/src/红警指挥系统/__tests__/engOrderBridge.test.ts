/**
 * engOrderBridge.test.ts —— V2-05 · <工程> 接缝仓段化分流测试
 *
 * 真源：docs/project/plans/仓段化V2设计案-草案.md §6（LLM 指令协议扩展）；
 *       docs/project/plans/工程玩法MVP任务包.md §9.1 V2-05 卡＋§9.2 D-TH-1/D-TH-2。
 * 覆盖：
 * ① 立项分流：def 合并池路由（projects 命中→startProjectV2；retrofits 命中→startProject V1 现状；
 *    跨池同名歧义/两池未命中→拒收留痕）；
 * ② 注资 module：id 直通 / name 兜底唯一收窄 / investModule 参数合同 / 拓扑门透明拒收；
 * ③ 模块级暂停/恢复（pauseModule/resumeModule）与工程级（pauseProjectV2/resumeProjectV2）；
 * ④ V1/V2 同聊共存：同楼多令各按实例 schema_version 分流，互不干扰；
 * ⑤ D-TH-1 定位复用：接缝不再自带首匹配（原 L99 悬空点），同 id 多实例「非终态优先」端到端。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { schedulePanelModel } from '../../中控悬浮窗/models/schedulePanelModel';
import type { ProjectDef, RetrofitDef } from '../core/catalog';
import {
  alignEngineeringActionWithDispatchBus,
  applyEngOrders,
  engVerbToUnifiedCommandType,
  findModuleObserverMetrics,
  findPhaseObserverMetrics,
  projectEngineeringObserverView,
  projectTechTreeObserverView,
} from '../engines/engOrderBridge';
import type { EngOrder } from '../parse/parsePipeline';
import { Schema, isProjectV1, isProjectV2, type Project, type ProjectV2 } from '../core/schema';
import type { ProjectQueueItem, ProjectStateView } from '../engines/projectEngine';

/* ═══════════════ 接缝调用记录（vi.mock 包裹穿透，行为与参数双断言） ═══════════════ */

const engineCalls: { fn: string; args: unknown[] }[] = [];

vi.mock('../engines/projectEngine', async importOriginal => {
  const mod = await importOriginal<typeof import('../engines/projectEngine')>();
  const record =
    <A extends unknown[], R>(fn: string, f: (...args: A) => R) =>
    (...args: A): R => {
      engineCalls.push({ fn, args });
      return f(...args);
    };
  return {
    ...mod,
    startProject: record('startProject', mod.startProject),
    startPhase: record('startPhase', mod.startPhase),
    pauseProject: record('pauseProject', mod.pauseProject),
    resumeProject: record('resumeProject', mod.resumeProject),
    cancelProject: record('cancelProject', mod.cancelProject),
    startProjectV2: record('startProjectV2', mod.startProjectV2),
    investModule: record('investModule', mod.investModule),
    pauseModule: record('pauseModule', mod.pauseModule),
    resumeModule: record('resumeModule', mod.resumeModule),
    pauseProjectV2: record('pauseProjectV2', mod.pauseProjectV2),
    resumeProjectV2: record('resumeProjectV2', mod.resumeProjectV2),
    cancelProjectV2: record('cancelProjectV2', mod.cancelProjectV2),
  };
});

beforeEach(() => {
  engineCalls.length = 0;
});

/* ═══════════════ 测试工具 ═══════════════ */

/** V1 对照定义（与 projectEngine.test.ts / engProtoParse.test.ts 同形） */
const V1DEF: RetrofitDef = {
  kind: 'retrofit',
  name: '灰熊坦克现代化改装工程',
  research: '重装机甲理论',
  grade: '中改',
  desc: '测试用定义',
  cost: 1200,
  phases: [
    { name: '方案与备料', workload: { days: 3, min_days: 1 }, cost: 400, resources: { nanites: 20 } },
    { name: '总装与调校', workload: { days: 4, min_days: 2 }, cost: 800, resources: { nanites: 30 } },
  ],
  scope: 'base',
};

/** 仓段化 V2 静态定义（catalog.ProjectDef 形状；数值仅测试用，D12 对账归 V2-11） */
const V2DEF: ProjectDef = {
  kind: 'project',
  id: 'all.project.station',
  name: '空间站',
  desc: '测试用仓段化定义',
  grade: '巨构',
  requirements: { research: '空间站建造工学' },
  modules: [
    {
      id: 'core',
      name: '核心舱',
      cost: 200,
      workload: { days: 3, min_days: 1 },
      resources: { nanites: 20 },
      prereqs: [],
    },
    { id: 'hab', name: '居住舱', cost: 150, workload: { days: 2, min_days: 1 }, prereqs: ['core'] },
  ],
};

const V1_ID = 'proj:灰熊坦克现代化改装工程@beipo';
const V2_ID = 'proj:空间站@beipo';

interface TestState extends ProjectStateView {
  queues: ProjectQueueItem[];
}

/** 双槽基地（盟军建造厂=eng.main + 航天发射中心=eng.orbital）：V1/V2 同聊共存现场 */
function mkState(overrides: Partial<TestState> = {}): TestState {
  return {
    tech: { done: ['重装机甲理论', '空间站建造工学'] },
    economy: { credits: 5000, resources: { nanites: { 标准纳米工料: 100 } } },
    bases: [
      {
        id: 'beipo',
        name: '北坡基地',
        buildings: [
          { name: '盟军建造厂', state: '运转' },
          { name: '航天发射中心', state: '运转' },
        ],
      },
    ],
    queues: [],
    projects: [],
    ...overrides,
  };
}

/** 在建 V1 实例（phase0 进行中；schema_version 1 对齐 Schema 归一形状）——V2 立项前预置的共存伙伴 */
function v1Instance() {
  return {
    id: V1_ID,
    ref: '灰熊坦克现代化改装工程',
    scope: 'base' as const,
    bases: ['beipo'],
    lead_base: 'beipo',
    grade: '中改' as const,
    status: '在建' as const,
    schema_version: 1 as const,
    outcome: { type: 'mark' as const },
    phases: [
      { idx: 0, name: '方案与备料', status: '进行中' as const, queue_index: null },
      { idx: 1, name: '总装与调校', status: '未启动' as const, queue_index: null },
    ],
  };
}

/** core 完工、hab 未启动的在建 V2 现场（hab 注资的拓扑前提） */
function v2CoreDoneState(): TestState {
  return mkState({
    projects: [
      v1Instance(),
      {
        id: V2_ID,
        ref: '空间站',
        scope: 'base' as const,
        bases: ['beipo'],
        lead_base: 'beipo',
        grade: '巨构' as const,
        status: '在建' as const,
        schema_version: 2 as const,
        outcome: { type: 'mark' },
        modules: [
          { id: 'core', name: '核心舱', status: '完工' as const, base: 'beipo', queue_index: null },
          { id: 'hab', name: '居住舱', status: '未启动' as const, base: '', queue_index: null },
        ],
      },
    ],
  });
}

/** 取 V2 工程断言视图（收窄守卫失败即测试失败） */
function asV2(projects: readonly Project[] | undefined): ProjectV2 {
  const proj = (projects ?? []).find(p => p.id === V2_ID);
  if (!proj || !isProjectV2(proj)) throw new Error('fixture 应含 V2 工程');
  return proj;
}

/* ═══════════════ ① 立项分流（def 合并池路由） ═══════════════ */

describe('V2-05 · 立项分流：PROJECTS/retrofits 合并池按 name 命中', () => {
  it('project def 命中 → startProjectV2(state, def, {base})，根模块注资扣账入账', () => {
    const state = mkState();
    const r = applyEngOrders(state, [{ verb: '立项', name: '空间站', base: 'beipo' }], [V1DEF], [V2DEF]);
    const call = engineCalls.find(c => c.fn === 'startProjectV2');
    expect(call).toBeDefined();
    expect(call!.args[0]).toBe(state);
    expect(call!.args[1]).toMatchObject({ kind: 'project', name: '空间站' });
    expect(call!.args[2]).toEqual({ base: 'beipo' });
    expect(engineCalls.filter(c => c.fn === 'startProject')).toHaveLength(0); // 不走 V1 通道
    expect(r.quarantine).toHaveLength(0);
    const proj = asV2(r.next.projects);
    expect(proj.modules[0]).toMatchObject({ id: 'core', status: '进行中' }); // 立项即注资首根（V1 同语义）
    expect(r.next.economy!.credits).toBe(4800); // 首根 core 200 已扣
    // 归一保险网：接缝产物仍过 Schema 校验
    expect(() => Schema.parse(r.next)).not.toThrow();
  });

  it('retrofit def 命中 → startProject（V1 现状零变化；projects 池缺席也不误路由）', () => {
    const state = mkState();
    const r = applyEngOrders(
      state,
      [{ verb: '立项', name: '灰熊坦克现代化改装工程', base: 'beipo' }],
      [V1DEF],
      [V2DEF],
    );
    expect(engineCalls.find(c => c.fn === 'startProject')).toBeDefined();
    expect(engineCalls.filter(c => c.fn === 'startProjectV2')).toHaveLength(0);
    expect(r.next.projects![0]).toMatchObject({ id: V1_ID, schema_version: 1 });
  });

  it('跨池同名（projects 与 retrofits 各有命中）→ fail-closed 拒收留痕，零引擎调用', () => {
    const state = mkState();
    const clash: ProjectDef = { ...V2DEF, name: '灰熊坦克现代化改装工程' };
    const r = applyEngOrders(
      state,
      [{ verb: '立项', name: '灰熊坦克现代化改装工程', base: 'beipo' }],
      [V1DEF],
      [clash],
    );
    expect(r.next).toBe(state);
    expect(engineCalls).toHaveLength(0);
    expect(r.quarantine.some(q => q.tag === '工程' && /跨池同名/.test(q.error))).toBe(true);
  });

  it('两池均未命中 → 拒收留痕（不在工程目录），不虚构资格', () => {
    const state = mkState();
    const r = applyEngOrders(state, [{ verb: '立项', name: '幽灵工程', base: 'beipo' }], [V1DEF], [V2DEF]);
    expect(r.next).toBe(state);
    expect(engineCalls).toHaveLength(0);
    expect(r.quarantine.some(q => q.tag === '工程' && /不在工程目录/.test(q.error))).toBe(true);
  });
});

/* ═══════════════ ② 注资 module 分流 ═══════════════ */

describe('V2-05 · 注资 module：id 直通 / name 兜底收窄 / investModule 参数合同', () => {
  it('module id 直通：investModule(state, id, moduleId, def) 参数逐项正确', () => {
    const state = v2CoreDoneState();
    const r = applyEngOrders(state, [{ verb: '注资', id: V2_ID, module: 'hab' }], [], [V2DEF]);
    const call = engineCalls.find(c => c.fn === 'investModule');
    expect(call).toBeDefined();
    expect(call!.args[0]).toBe(state);
    expect(call!.args[1]).toBe(V2_ID);
    expect(call!.args[2]).toBe('hab');
    expect(call!.args[3]).toMatchObject({ name: '空间站' });
    expect(r.quarantine).toHaveLength(0);
    expect(asV2(r.next.projects).modules.find(m => m.id === 'hab')!.status).toBe('进行中');
    expect(r.next.economy!.credits).toBe(4850);
  });

  it('module name 兜底唯一匹配 → 收窄为模块 id 交引擎', () => {
    const state = v2CoreDoneState();
    const r = applyEngOrders(state, [{ verb: '注资', id: V2_ID, module: '居住舱' }], [], [V2DEF]);
    expect(engineCalls.find(c => c.fn === 'investModule')!.args[2]).toBe('hab');
    expect(asV2(r.next.projects).modules.find(m => m.id === 'hab')!.status).toBe('进行中');
  });

  it('前置模块未完工 → 引擎 module_order 透明拒收（🟡 事件＋🔴 隔离区，账本不动）', () => {
    const state = v2CoreDoneState();
    const coreRunning = {
      ...state,
      projects: state.projects!.map(p =>
        isProjectV2(p) && p.id === V2_ID
          ? { ...p, modules: p.modules.map(m => (m.id === 'core' ? { ...m, status: '未启动' as const } : m)) }
          : p,
      ),
    } as TestState;
    const r = applyEngOrders(coreRunning, [{ verb: '注资', id: V2_ID, module: 'hab' }], [], [V2DEF]);
    expect(r.next).toBe(coreRunning);
    expect(r.events.some(e => e.light === '🟡' && /module_order/.test(e.message))).toBe(true);
    expect(r.quarantine.some(q => q.tag === '工程' && /module_order/.test(q.error))).toBe(true);
  });

  it('V2 def 缺席（projects 空目录）→ 接缝拒收留痕，不虚构定义', () => {
    const state = v2CoreDoneState();
    const r = applyEngOrders(state, [{ verb: '注资', id: V2_ID, module: 'hab' }], [], []);
    expect(r.next).toBe(state);
    expect(engineCalls.filter(c => c.fn === 'investModule')).toHaveLength(0);
    expect(r.quarantine.some(q => q.tag === '工程' && /不在工程目录（catalog.projects）/.test(q.error))).toBe(true);
  });
});

/* ═══════════════ ③ 模块级/工程级 暂停·恢复·取消 ═══════════════ */

describe('V2-05 · 暂停/恢复模块级与工程级分流', () => {
  /** core 在队进行中的 V2 现场（模块级暂停的对象） */
  function v2LiveState(): TestState {
    const started = applyEngOrders(mkState(), [{ verb: '立项', name: '空间站', base: 'beipo' }], [], [V2DEF]).next;
    return started as TestState;
  }

  it('暂停+module → pauseModule(state, id, moduleId)：单模块置暂停，工程保持在建', () => {
    const state = v2LiveState();
    engineCalls.length = 0;
    const r = applyEngOrders(state, [{ verb: '暂停', id: V2_ID, module: '核心舱' }], [], [V2DEF]);
    const call = engineCalls.find(c => c.fn === 'pauseModule');
    expect(call).toBeDefined();
    expect(call!.args[1]).toBe(V2_ID);
    expect(call!.args[2]).toBe('core'); // name 兜底收窄
    expect(engineCalls.filter(c => c.fn === 'pauseProjectV2')).toHaveLength(0);
    const proj = asV2(r.next.projects);
    expect(proj.status).toBe('在建'); // 单模块粒度，工程级状态不动
    expect(proj.modules.find(m => m.id === 'core')!.status).toBe('暂停');
  });

  it('恢复+module → resumeModule：模块回进行中', () => {
    const paused = applyEngOrders(v2LiveState(), [{ verb: '暂停', id: V2_ID, module: 'core' }], [], [V2DEF]).next;
    engineCalls.length = 0;
    const r = applyEngOrders(paused, [{ verb: '恢复', id: V2_ID, module: 'core' }], [], [V2DEF]);
    expect(engineCalls.find(c => c.fn === 'resumeModule')!.args[2]).toBe('core');
    expect(asV2(r.next.projects).modules.find(m => m.id === 'core')!.status).toBe('进行中');
  });

  it('暂停/恢复省略 module → pauseProjectV2/resumeProjectV2 工程级联动', () => {
    const state = v2LiveState();
    engineCalls.length = 0;
    const paused = applyEngOrders(state, [{ verb: '暂停', id: V2_ID }], [], [V2DEF]);
    expect(engineCalls.find(c => c.fn === 'pauseProjectV2')!.args[1]).toBe(V2_ID);
    expect(engineCalls.filter(c => c.fn === 'pauseModule')).toHaveLength(0);
    expect(paused.next.projects!.find(p => p.id === V2_ID)!.status).toBe('暂停');

    engineCalls.length = 0;
    const resumed = applyEngOrders(paused.next, [{ verb: '恢复', id: V2_ID }], [], [V2DEF]);
    expect(engineCalls.find(c => c.fn === 'resumeProjectV2')).toBeDefined();
    expect(resumed.next.projects!.find(p => p.id === V2_ID)!.status).toBe('在建');
  });

  it('取消（工程级）→ cancelProjectV2，模块版固定结算文案随事件留痕', () => {
    const state = v2LiveState();
    engineCalls.length = 0;
    const r = applyEngOrders(state, [{ verb: '取消', id: V2_ID }], [], [V2DEF]);
    const call = engineCalls.find(c => c.fn === 'cancelProjectV2');
    expect(call).toBeDefined();
    expect(call!.args[1]).toBe(V2_ID);
    expect((call!.args[2] as ProjectDef).name).toBe('空间站'); // 结算金额点名用 def 透传
    expect(engineCalls.filter(c => c.fn === 'cancelProject')).toHaveLength(0);
    expect(r.next.projects!.find(p => p.id === V2_ID)!.status).toBe('取消');
    expect(r.events.some(e => /取消结算/.test(e.message) && /不予退还/.test(e.message))).toBe(true);
  });

  it('V1 实例 + module 暂停令 → 维度错配拒收（V1 无仓段模块）', () => {
    const state = mkState({ projects: [v1Instance()] });
    const r = applyEngOrders(state, [{ verb: '暂停', id: V1_ID, module: '核心舱' }], [V1DEF], [V2DEF]);
    expect(r.next).toBe(state);
    expect(engineCalls).toHaveLength(0);
    expect(r.quarantine.some(q => q.tag === '工程' && /V1 线性工程，不认 module/.test(q.error))).toBe(true);
  });

  it('模块级令指向不存在实例 → 直通 pauseModule 由引擎拒 not_found（引擎是裁决点）', () => {
    const state = mkState();
    const r = applyEngOrders(state, [{ verb: '暂停', id: 'proj:幽灵@x', module: 'core' }], [], [V2DEF]);
    expect(engineCalls.find(c => c.fn === 'pauseModule')).toBeDefined();
    expect(r.events.some(e => e.light === '🟡' && /not_found/.test(e.message))).toBe(true);
  });
});

/* ═══════════════ ④ V1/V2 同聊共存 ═══════════════ */

describe('V2-05 · V1/V2 同聊共存：同楼多令按实例版本各走各通道', () => {
  it('暂停 V1 实例 → pauseProject；暂停 V2 实例 → pauseProjectV2（同楼零串扰）', () => {
    const state = mkState({ projects: [v1Instance(), ...v2CoreDoneState().projects!.slice(1)] });
    const orders: EngOrder[] = [
      { verb: '暂停', id: V1_ID },
      { verb: '注资', id: V2_ID, module: 'hab' },
      { verb: '暂停', id: V2_ID },
    ];
    const r = applyEngOrders(state, orders, [V1DEF], [V2DEF]);
    expect(engineCalls.find(c => c.fn === 'pauseProject')!.args[1]).toBe(V1_ID);
    expect(engineCalls.find(c => c.fn === 'investModule')!.args[1]).toBe(V2_ID);
    expect(engineCalls.find(c => c.fn === 'pauseProjectV2')!.args[1]).toBe(V2_ID);
    expect(r.quarantine).toHaveLength(0);
    expect(r.next.projects!.find(p => p.id === V1_ID)!.status).toBe('暂停');
    expect(r.next.projects!.find(p => p.id === V2_ID)!.status).toBe('暂停');
    expect(asV2(r.next.projects).modules.find(m => m.id === 'hab')!.status).toBe('暂停'); // 工程级联动暂停在途模块
  });

  it('注资按实例版本分流：V1 走 startPhase、V2 走 investModule（同楼）', () => {
    const state = v2CoreDoneState();
    // V1 phase0 完工（phase1 注资的顺序门前提）
    const v1Ready = {
      ...state,
      projects: state.projects!.map(p =>
        isProjectV1(p)
          ? {
              ...p,
              phases: p.phases.map(ph => (ph.idx === 0 ? { ...ph, status: '完工' as const, queue_index: null } : ph)),
            }
          : p,
      ),
    } as TestState;
    const orders: EngOrder[] = [
      { verb: '注资', id: V1_ID, phase: 1 },
      { verb: '注资', id: V2_ID, module: 'hab' },
    ];
    const r = applyEngOrders(v1Ready, orders, [V1DEF], [V2DEF]);
    expect(engineCalls.find(c => c.fn === 'startPhase')!.args[1]).toBe(V1_ID);
    expect(engineCalls.find(c => c.fn === 'investModule')!.args[1]).toBe(V2_ID);
    expect(r.quarantine).toHaveLength(0);
    expect(r.next.economy!.credits).toBe(4050); // 5000 − phase1 800 − hab 150
  });
});

/* ═══════════════ ⑤ D-TH-1 定位复用（僵尸陷阱端到端） ═══════════════ */

describe('V2-05 · D-TH-1 定位复用：同 id 多实例「非终态优先」（接缝不再自带首匹配）', () => {
  it('V2 僵尸现场：旧取消实例在前、新在建实例在后，注资 module 命中新实例', () => {
    const zombie = mkState({
      projects: [
        // 旧取消实例（确定性 id 碰撞的元凶位：数组首、同 id、终态）
        {
          id: V2_ID,
          ref: '空间站',
          scope: 'base' as const,
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '巨构' as const,
          status: '取消' as const,
          schema_version: 2 as const,
          outcome: { type: 'mark' },
          modules: [
            { id: 'core', name: '核心舱', status: '取消' as const, base: 'beipo', queue_index: null },
            { id: 'hab', name: '居住舱', status: '未启动' as const, base: '', queue_index: null },
          ],
        },
        // 新在建实例（core 已完工、hab 待注资）
        {
          id: V2_ID,
          ref: '空间站',
          scope: 'base' as const,
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '巨构' as const,
          status: '在建' as const,
          schema_version: 2 as const,
          outcome: { type: 'mark' },
          modules: [
            { id: 'core', name: '核心舱', status: '完工' as const, base: 'beipo', queue_index: null },
            { id: 'hab', name: '居住舱', status: '未启动' as const, base: '', queue_index: null },
          ],
        },
      ],
    });
    const r = applyEngOrders(zombie, [{ verb: '注资', id: V2_ID, module: 'hab' }], [], [V2DEF]);
    expect(r.quarantine).toHaveLength(0);
    const live = r.next.projects![1];
    const dead = r.next.projects![0];
    expect(isProjectV2(live) && live.modules.find(m => m.id === 'hab')!.status).toBe('进行中'); // 新实例被注资
    expect(dead.status).toBe('取消'); // 旧终态实例不被劫持复活
    expect(r.next.economy!.credits).toBe(4850); // 仅 hab 150 一笔扣账
  });

  it('V1 僵尸现场（原 L99 首匹配缺陷路径）：注资命中新在建实例而非旧取消实例', () => {
    const zombie = mkState({
      projects: [
        {
          id: V1_ID,
          ref: '灰熊坦克现代化改装工程',
          scope: 'base' as const,
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '中改' as const,
          status: '取消' as const,
          schema_version: 1 as const,
          outcome: { type: 'mark' },
          phases: [
            { idx: 0, name: '方案与备料', status: '取消' as const, queue_index: null },
            { idx: 1, name: '总装与调校', status: '未启动' as const, queue_index: null },
          ],
        },
        {
          id: V1_ID,
          ref: '灰熊坦克现代化改装工程',
          scope: 'base' as const,
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '中改' as const,
          status: '在建' as const,
          schema_version: 1 as const,
          outcome: { type: 'mark' },
          phases: [
            { idx: 0, name: '方案与备料', status: '完工' as const, queue_index: null },
            { idx: 1, name: '总装与调校', status: '未启动' as const, queue_index: null },
          ],
        },
      ],
    });
    const r = applyEngOrders(zombie, [{ verb: '注资', id: V1_ID, phase: 1 }], [V1DEF], []);
    expect(r.quarantine).toHaveLength(0);
    const live = r.next.projects![1];
    const dead = r.next.projects![0];
    expect(isProjectV1(live) && live.phases[1].status).toBe('进行中'); // 新实例 phase1 被注资
    expect(dead.status).toBe('取消'); // 旧终态实例零扰动
  });
});

/* ═══════════════ ⑥ UTO-UI-DOMAIN-01 · 观察者投影与指令发起对齐 ═══════════════ */

describe('UTO-UI-DOMAIN-01 · projectEngineeringObserverView / projectTechTreeObserverView 与 schedulePanelModel 同源对齐', () => {
  it('工程观察者投影：eng.main / eng.orbital 工位快照 + 在途/暂缓/待收讫/规划态任务与 schedulePanelModel 100% 一致', () => {
    const sharedState = Schema.parse({
      bases: [
        {
          id: 'beipo',
          name: '北坡主基地',
          status: '警戒',
          buildings: [
            { name: '盟军建造厂', state: '运转', mode: '生产' },
            { name: '航天发射中心', state: '运转', mode: '生产' },
          ],
        },
      ],
      queues: [
        {
          type: '工程' as const,
          item: '灰熊坦克现代化改装工程·方案与备料',
          base: 'beipo',
          status: 'active' as const,
          total_minutes: 100,
          spent_minutes: 45,
          eta: '1937-08-15 14:00',
        },
        {
          type: '工程' as const,
          item: '空间站·居住舱',
          base: 'beipo',
          status: 'settling' as const,
          total_minutes: 200,
          spent_minutes: 200,
          eta: '1937-08-15 18:00',
        },
        {
          type: '工程' as const,
          item: '空间站·太阳能翼',
          base: 'beipo',
          status: 'queued' as const,
          hold: true,
          total_minutes: 120,
          spent_minutes: 30,
        },
        {
          type: '研究' as const,
          item: '高能激光导论',
          base: 'beipo',
          status: 'active' as const,
          total_minutes: 180,
          spent_minutes: 90,
          eta: '1937-08-16 08:00',
        },
        {
          type: '研究' as const,
          item: '超导储能',
          base: 'beipo',
          status: 'queued' as const,
          hold: true,
          total_minutes: 150,
          spent_minutes: 60,
        },
      ],
      projects: [
        {
          id: V1_ID,
          ref: '灰熊坦克现代化改装工程',
          scope: 'base' as const,
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '中改' as const,
          status: '在建' as const,
          schema_version: 1 as const,
          outcome: { type: 'mark' as const },
          phases: [
            { idx: 0, name: '方案与备料', status: '进行中' as const, queue_index: 0 },
            { idx: 1, name: '总装与调校', status: '未启动' as const, queue_index: null },
          ],
        },
        {
          id: V2_ID,
          ref: '空间站',
          scope: 'base' as const,
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '巨构' as const,
          status: '在建' as const,
          schema_version: 2 as const,
          outcome: { type: 'mark' as const },
          modules: [
            { id: 'core', name: '核心舱', status: '完工' as const, base: 'beipo', queue_index: null },
            { id: 'hab', name: '居住舱', status: '进行中' as const, base: 'beipo', queue_index: 1 },
            { id: 'solar', name: '太阳能翼', status: '暂停' as const, base: 'beipo', queue_index: 2 },
          ],
        },
      ],
    });

    const catalog = {
      buildings: [],
      productions: [],
      researches: [],
      retrofits: [V1DEF],
      projects: [V2DEF],
      factionDefs: [],
    };

    const engView = projectEngineeringObserverView(sharedState, catalog);
    const scheduleVm = schedulePanelModel(sharedState, catalog);

    // 1. 属地工程工位快照：包含北坡主基地 eng.main 与 eng.orbital
    expect(engView.stations.map(s => s.laneKey)).toEqual(['beipo eng:eng.main', 'beipo eng:eng.orbital']);

    // 2. V1 阶段 0（active）与阶段 1（draft）
    const phase0 = findPhaseObserverMetrics(engView, V1_ID, 0)!;
    const phase1 = findPhaseObserverMetrics(engView, V1_ID, 1)!;
    expect(phase0).toMatchObject({
      status: 'active',
      spentMinutes: 45,
      totalMinutes: 100,
      progressPct: 45,
      held: false,
      settling: false,
      draft: false,
    });
    expect(phase1).toMatchObject({
      status: 'draft',
      held: false,
      settling: false,
      draft: true,
    });

    // 3. V2 模块 hab（spent=200/total=200 → settling）与 solar（paused → held）
    const habMod = findModuleObserverMetrics(engView, V2_ID, 'hab')!;
    const solarMod = findModuleObserverMetrics(engView, V2_ID, 'solar')!;
    expect(habMod).toMatchObject({
      status: 'settling',
      spentMinutes: 200,
      totalMinutes: 200,
      progressPct: 100,
      held: false,
      settling: true,
      draft: false,
    });
    expect(solarMod).toMatchObject({
      status: 'held',
      spentMinutes: 30,
      totalMinutes: 120,
      progressPct: 25,
      held: true,
      settling: false,
      draft: false,
    });

    // 4. 与 schedulePanelModel 逐条比对：scheduledEngineeringTasks 与 draftTasks 100% 一致
    for (const engTask of engView.scheduledEngineeringTasks) {
      const schedTask = scheduleVm.scheduledTasks.find(t => t.id === engTask.id);
      expect(schedTask).toBeDefined();
      expect(engTask.workload).toEqual(schedTask!.workload);
      expect(engTask.status).toBe(schedTask!.status);
    }
    expect(engView.draftEngineeringTasks.map(t => t.id)).toEqual(scheduleVm.draftTasks.map(t => t.id));

    // 5. 科技树观察者投影：11 科研序列工位快照与在研课题与 schedulePanelModel 100% 一致
    const techView = projectTechTreeObserverView(sharedState, catalog);
    expect(techView.slots).toHaveLength(11);
    expect(techView.slots.map(s => s.slotId)).toEqual(scheduleVm.researchSlots.map(s => s.slotId));
    expect(techView.slots.map(s => s.unlocked)).toEqual(scheduleVm.researchSlots.map(s => s.unlocked));

    const laserMetrics = techView.taskByResearchName['高能激光导论'];
    const supercondMetrics = techView.taskByResearchName['超导储能'];
    expect(laserMetrics).toMatchObject({
      status: 'active',
      spentMinutes: 90,
      totalMinutes: 180,
      progressPct: 50,
      held: false,
      settling: false,
    });
    expect(supercondMetrics).toMatchObject({
      status: 'held',
      spentMinutes: 60,
      totalMinutes: 150,
      progressPct: 40,
      held: true,
      settling: false,
    });
  });

  it('alignEngineeringActionWithDispatchBus：严格映射 Hold / Resume / Cancel / Allocate 并拼装标准战术指令', () => {
    expect(engVerbToUnifiedCommandType('暂停')).toBe('Hold');
    expect(engVerbToUnifiedCommandType('恢复')).toBe('Resume');
    expect(engVerbToUnifiedCommandType('取消')).toBe('Cancel');
    expect(engVerbToUnifiedCommandType('注资')).toBe('Allocate');
    expect(engVerbToUnifiedCommandType('指派')).toBe('Allocate');

    const engView = projectEngineeringObserverView(v2CoreDoneState(), {
      retrofits: [V1DEF],
      projects: [V2DEF],
    });
    const tasks = engView.allTasks;

    // 工程级暂停 → Hold
    const holdProj = alignEngineeringActionWithDispatchBus(
      { verb: '暂停', projectId: V2_ID, isV2ProjectLevel: true },
      tasks,
    );
    expect(holdProj.commandType).toBe('Hold');
    expect(holdProj.commands.every(c => c.type === 'Hold')).toBe(true);
    expect(holdProj.commandText).toBe(`【工程指令】暂停「${V2_ID}」`);

    // 工程级恢复 → Resume
    const resumeProj = alignEngineeringActionWithDispatchBus(
      { verb: '恢复', projectId: V2_ID, isV2ProjectLevel: true },
      tasks,
    );
    expect(resumeProj.commandType).toBe('Resume');
    expect(resumeProj.commands.every(c => c.type === 'Resume')).toBe(true);
    expect(resumeProj.commandText).toBe(`【工程指令】恢复「${V2_ID}」`);

    // 工程级取消 → Cancel
    const cancelProj = alignEngineeringActionWithDispatchBus(
      { verb: '取消', projectId: V2_ID, isV2ProjectLevel: true },
      tasks,
    );
    expect(cancelProj.commandType).toBe('Cancel');
    expect(cancelProj.commands.every(c => c.type === 'Cancel')).toBe(true);
    expect(cancelProj.commandText).toBe(`【工程指令】取消「${V2_ID}」`);

    // 模块级暂停/恢复/注资/基地指派（Allocate）
    const holdMod = alignEngineeringActionWithDispatchBus(
      { verb: '暂停', projectId: V2_ID, moduleId: 'hab', moduleName: '居住舱' },
      tasks,
    );
    expect(holdMod.commandType).toBe('Hold');
    expect(holdMod.commandText).toBe(`【工程指令】暂停「${V2_ID}」居住舱`);

    const allocateMod = alignEngineeringActionWithDispatchBus(
      { verb: '指派', projectId: V2_ID, moduleId: 'hab', moduleName: '居住舱', baseId: 'beipo' },
      tasks,
    );
    expect(allocateMod.commandType).toBe('Allocate');
    expect(allocateMod.commands[0]).toEqual({
      type: 'Allocate',
      taskId: `task:proj:${V2_ID}:mod:hab`,
      baseId: 'beipo',
    });
    expect(allocateMod.commandText).toBe(`【工程指令】指派「${V2_ID}」居住舱，承建基地：beipo`);
  });

  it('FD-27 · applyEngOrders 接入通用可信度引擎：工程名称变体（光棱塔现代化改造 vs 光棱塔升级）高可信对齐并立项成功', () => {
    const prismDef: RetrofitDef = {
      kind: 'retrofit',
      name: '光棱塔升级',
      research: '光棱聚焦理论',
      grade: '小改',
      desc: '升级光棱聚焦环阵列',
      cost: 800,
      phases: [
        { name: '聚焦环换装', workload: { days: 2, min_days: 1 }, cost: 800 },
      ],
      scope: 'base',
    };
    const state = Schema.parse({
      economy: { credits: 5000 },
      tech: { done: ['光棱聚焦理论'] },
      bases: [
        {
          id: 'beipo',
          name: '北坡基地',
          status: '警戒',
          buildings: [{ name: '建造厂核心', state: '运转' }],
        },
      ],
      projects: [],
    });

    const res = applyEngOrders(
      state,
      [{ verb: '立项', name: '光棱塔现代化改造', base: 'beipo' }],
      [prismDef],
      [],
    );

    expect(res.quarantine).toEqual([]);
    expect(res.next.projects).toHaveLength(1);
    expect(res.next.projects[0].ref).toBe('光棱塔升级');
    expect(
      res.events.some(
        e =>
          e.light === '🟢' &&
          e.path === 'projects' &&
          e.message === '[工程] 名称对齐：「光棱塔现代化改造」→「光棱塔升级」',
      ),
    ).toBe(true);
  });
});
