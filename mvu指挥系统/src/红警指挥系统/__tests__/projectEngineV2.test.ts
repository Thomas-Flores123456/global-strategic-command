/**
 * V2-03 · 仓段化 V2 引擎验收测试（projectEngine.ts 仓段化扩展）
 *
 * 真源：docs/project/plans/仓段化V2设计案-草案.md §3.3/§4（引擎契约）/§8 冻结决策
 *       （D-C1 模块单阶段 / D-C2 巨构 / D-C3 不强制多基地 / D-C4 eng.orbital / D-C7 每在队模块各占一槽）；
 *       docs/project/plans/工程玩法MVP任务包.md §9.1 V2-03 卡＋§9.2 D-TH-1 僵尸陷阱。
 * 覆盖：
 * ① startProjectV2：三门校验（资格/槽/纳米开工门）＋拓扑校验（重复 id/引用缺失/闭环）＋
 *    根模块开工（首根立即注资入队=V1「立项即注资 phase0」对齐）；
 * ② investModule：前置完工门（拓扑版 phase_order）＋槽位门（D-C7 空余容量）＋注资扣款＋投影合同；
 * ③ syncProjects V2 分支：done→模块里程碑回写、拓扑完工 isProjectV2Complete→工程级结算、
 *    外部 cancelled/身份漂移 fail-open、V1·V2 同数组共存互不干扰、settleFloor 集成；
 * ④ 模块级 pause/resume（hold 单模块）；
 * ⑤ 工程级 pause/resume/cancel（联动全部未完工模块；取消结算对齐 V1 口径）；
 * ⑥ D-TH-1：findProjectIndex 同 id 多实例「非终态优先、最新在前」＋僵尸场景端到端。
 * 红线守门：V1 五函数（startProject/startPhase/pause/resume/cancel）行为零变化——
 * V2 实例进 V1 通道一律 not_found 拒收（V2-01 边界），V1 路径回归由 projectEngine.test.ts 24 测守门。
 */
import { describe, expect, it } from 'vitest';
import type { RetrofitDef } from '../core/catalog';
import { Schema, isProjectV2, type Project, type ProjectV1, type ProjectV2 } from '../core/schema';
import { settleFloor } from '../engines/settleFloor';
import {
  cancelProject,
  cancelProjectV2,
  findProjectIndex,
  investModule,
  isProjectV2Complete,
  moduleBase,
  pauseModule,
  pauseProject,
  pauseProjectV2,
  resumeModule,
  resumeProjectV2,
  startProject,
  startProjectV2,
  syncProjects,
  type ProjectQueueItem,
  type ProjectStateView,
  type ProjectV2Def,
} from '../engines/projectEngine';

/* ═══════════════ 测试工具 ═══════════════ */

/**
 * V2 静态定义（空间站式仓段拓扑；数值仅测试用，D12 对账归 V2-11）：
 * 双根（core/frame）供 D-C7 并行占槽测试；hab 单前置；dock 双前置（拓扑门多边覆盖）。
 */
const V2DEF: ProjectV2Def = {
  id: 'all.project.station',
  name: '空间站',
  grade: '巨构',
  requirements: { research: '空间站建造工学' },
  modules: [
    { id: 'core', name: '核心舱', cost: 200, workload: { days: 3, min_days: 1 }, resources: { nanites: 20 }, prereqs: [] },
    { id: 'frame', name: '桁架龙骨', cost: 100, workload: { days: 2, min_days: 1 }, prereqs: [] },
    { id: 'hab', name: '居住舱段', cost: 150, workload: { days: 2, min_days: 1 }, resources: { nanites: 10 }, prereqs: ['core'] },
    { id: 'dock', name: '对接舱段', cost: 120, workload: { days: 2, min_days: 1 }, prereqs: ['core', 'frame'] },
  ],
};

/** 单链最小拓扑（完工结算端到端） */
const MINI: ProjectV2Def = {
  id: 'all.project.mini',
  name: '轨道船坞',
  modules: [
    { id: 'core', name: '核心舱', cost: 100, workload: { days: 2, min_days: 1 }, prereqs: [] },
    { id: 'dock', name: '对接舱段', cost: 50, workload: { days: 1, min_days: 1 }, prereqs: ['core'] },
  ],
};

/** V1 对照定义（共存/僵尸场景；口径对齐 projectEngine.test.ts DEF） */
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

interface TestState extends ProjectStateView {
  queues: ProjectQueueItem[];
  projects?: Project[];
}

/** 最小状态：单基地（一座可运转航天发射中心=eng.orbital 容量 1）、科技就位、资金 5000、纳米 100 */
function mkState(overrides: Partial<TestState> = {}): TestState {
  return {
    tech: { done: ['空间站建造工学', '重装机甲理论'] },
    economy: { credits: 5000, resources: { nanites: { 标准纳米工料: 100, 高精构造型纳米: null } } },
    bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '航天发射中心', state: '运转' }] }],
    queues: [],
    projects: [],
    ...overrides,
  };
}

/** beipo 容量 2（双锚定发射设施）/ south 单容量——D-C7 并行与跨基地指派用 */
function mkDualState(): TestState {
  return mkState({
    bases: [
      {
        id: 'beipo',
        name: '北坡基地',
        buildings: [
          { name: '航天发射中心', state: '运转' },
          { name: '海上发射平台', state: '运转' },
        ],
      },
      { id: 'south', name: '南岭基地', buildings: [{ name: '航天发射中心', state: '运转' }] },
    ],
  });
}

/** V1 僵尸场景状态（eng.main 锚定建筑） */
function mkV1State(overrides: Partial<TestState> = {}): TestState {
  return mkState({
    bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '盟军建造厂', state: '运转' }] }],
    ...overrides,
  });
}

/** 把指定下标投影项标记为 done（模拟引擎/三色门终态） */
function markQueueDone<S extends TestState>(state: S, index: number): S {
  return {
    ...state,
    queues: state.queues.map((q, i) => (i === index ? { ...q, status: 'done' as const } : q)),
  };
}

/** 取 V2 工程断言视图（收窄守卫失败即测试失败） */
function asV2(p: Project | undefined): ProjectV2 {
  if (!p || !isProjectV2(p)) throw new Error('fixture 应为 V2 工程');
  return p;
}

/* ═══════════════ ① startProjectV2：三门＋拓扑＋根模块开工 ═══════════════ */

describe('① startProjectV2（§3.3：三门校验＋拓扑校验＋首根注资入队）', () => {
  it('缺前置科技 → 拒立项（research_gate），状态零写入', () => {
    const state = mkState({ tech: { done: ['重装机甲理论'] } });
    const r = startProjectV2(state, V2DEF, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('research_gate');
    expect(r.message).toContain('空间站建造工学');
    expect(state.projects).toHaveLength(0);
    expect(state.queues).toHaveLength(0);
  });

  it('属地锚定建筑不在场/建造中 → 拒立项（no_slot，eng.orbital 专属槽）', () => {
    const state = mkState({
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '航天发射中心', state: '建造中' }] }],
    });
    const r = startProjectV2(state, V2DEF, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_slot');
    expect(r.message).toContain('航天发射中心');
  });

  it('拓扑校验：prereqs 引用不存在模块 → bad_topology 拒立项', () => {
    const bad: ProjectV2Def = {
      ...V2DEF,
      modules: [
        { id: 'core', name: '核心舱', cost: 100, prereqs: [] },
        { id: 'hab', name: '居住舱段', cost: 100, prereqs: ['ghost'] },
      ],
    };
    const r = startProjectV2(mkState(), bad, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('bad_topology');
    expect(r.message).toContain('ghost');
  });

  it('拓扑校验：prereqs 闭环 → bad_topology 拒立项（DAG 铁律）', () => {
    const bad: ProjectV2Def = {
      ...V2DEF,
      modules: [
        { id: 'a', name: '甲舱', cost: 100, prereqs: ['b'] },
        { id: 'b', name: '乙舱', cost: 100, prereqs: ['a'] },
      ],
    };
    const r = startProjectV2(mkState(), bad, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('bad_topology');
    expect(r.message).toContain('成环');
  });

  it('拓扑校验：重复模块 id → bad_topology（拓扑边引用键必须唯一）', () => {
    const bad: ProjectV2Def = {
      ...V2DEF,
      modules: [
        { id: 'core', name: '核心舱', cost: 100, prereqs: [] },
        { id: 'core', name: '同名核心舱', cost: 100, prereqs: [] },
      ],
    };
    const r = startProjectV2(mkState(), bad, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('bad_topology');
    expect(r.message).toContain('重复模块 id');
  });

  it('modules 空数组 → 拒立项（no_modules，no_phases 的 V2 对位）', () => {
    const r = startProjectV2(mkState(), { ...V2DEF, modules: [] }, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_modules');
  });

  it('theater 参与基地 <2 → invalid_bases（D21 口径对 V2 生效）', () => {
    const theater: ProjectV2Def = { ...V2DEF, scope: 'theater' };
    const r = startProjectV2(mkDualState(), theater, { base: 'beipo', bases: ['beipo'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_bases');
  });

  it('通过：实例展开（schema_version 2）＋首根注资扣账＋投影合同（lane=eng:eng.orbital）＋事件＋Schema 往返', () => {
    const r = startProjectV2(mkState(), V2DEF, { base: 'beipo' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const project = asV2(r.next.projects![0]);
    expect(project).toMatchObject({
      id: 'proj:空间站@beipo',
      ref: '空间站',
      scope: 'base',
      bases: ['beipo'],
      lead_base: 'beipo',
      grade: '巨构',
      status: '在建',
      schema_version: 2,
    });
    // 模块从静态定义展开：定义序首根（core）进行中并回写 queue_index；其余根/子模块未启动、base 待注资时指派
    expect(project.modules).toEqual([
      { id: 'core', name: '核心舱', status: '进行中', base: 'beipo', queue_index: 0 },
      { id: 'frame', name: '桁架龙骨', status: '未启动', base: '', queue_index: null },
      { id: 'hab', name: '居住舱段', status: '未启动', base: '', queue_index: null },
      { id: 'dock', name: '对接舱段', status: '未启动', base: '', queue_index: null },
    ]);
    // 首根注资扣账（只扣根模块 200，非总造价——分模块注资 D8；V1「立项即注资 phase0」同语义）
    expect(r.next.economy!.credits).toBe(4800);
    expect(r.next.economy!.resources!.nanites!.标准纳米工料).toBe(80);
    // 投影项合同（§3.3/§4）：type 工程 / 命名 `ref·模块名` / 显式专属槽 lane / 工期与锁值投影时刻写入
    expect(r.next.queues[0]).toMatchObject({
      type: '工程',
      item: '空间站·核心舱',
      base: 'beipo',
      status: 'queued',
      lane: 'eng:eng.orbital',
      total_minutes: 3 * 1440,
      min_days_lock: 1,
      cost_paid: true,
      hold: false,
    });
    expect(r.events[0].type).toBe('project_started');
    expect(r.events[0].detail).toContain('纳米已扣减 20');
    expect(r.events[0].detail).not.toContain('门槛不抵扣');
    // 引擎产物经 V2-01 判别联合 schema 往返无损（结构契约钉死）
    expect(Schema.safeParse({ projects: r.next.projects }).success).toBe(true);
  });

  it('同 ref+lead 未完结工程 → 拒重复立项（duplicate，V1 口径）', () => {
    const first = startProjectV2(mkState(), V2DEF, { base: 'beipo' });
    if (!first.ok) throw new Error('setup failed');
    const r = startProjectV2(first.next as TestState, V2DEF, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('duplicate');
  });

  it('立项期资金不足 → 拒立项（funds），不留半成品工程', () => {
    const state = mkState({ economy: { credits: 100, resources: { nanites: { 标准纳米工料: 100 } } } });
    const r = startProjectV2(state, V2DEF, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('funds');
    expect(state.projects).toHaveLength(0);
  });

  it('立项期纳米不足 → 拒立项（nanites_gate），库存零抵扣零半成品', () => {
    const state = mkState({ economy: { credits: 5000, resources: { nanites: { 标准纳米工料: 5 } } } });
    const r = startProjectV2(state, V2DEF, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('nanites_gate');
    expect(r.message).toContain('未发生扣款扣料');
    expect(r.message).not.toContain('门槛不是抵扣');
    expect(state.economy!.resources!.nanites!.标准纳米工料).toBe(5);
    expect(state.projects).toHaveLength(0);
  });

  it('首根 requirements.nanites 回退与零纳米路径：库存与立项回执严格一致', () => {
    const fallbackDef: ProjectV2Def = { ...MINI, requirements: { nanites: 15 } };
    const withFallback = startProjectV2(mkState(), fallbackDef, { base: 'beipo' });
    if (!withFallback.ok) throw new Error(withFallback.message);
    expect(withFallback.next.economy!.resources!.nanites!.标准纳米工料).toBe(85);
    expect(withFallback.events[0].detail).toContain('纳米已扣减 15');

    const zeroNanite = startProjectV2(mkState(), MINI, { base: 'beipo' });
    if (!zeroNanite.ok) throw new Error(zeroNanite.message);
    expect(zeroNanite.next.economy!.resources!.nanites!.标准纳米工料).toBe(100);
    expect(zeroNanite.events[0].detail).toContain('未消耗纳米');
    expect(zeroNanite.events[0].detail).not.toContain('已扣减');
  });
});

/* ═══════════════ ② investModule：前置完工门＋D-C7 槽位门＋注资投影 ═══════════════ */

describe('② investModule（§3.3：startPhase 的拓扑版＋D-C7 并行占槽）', () => {
  it('前置模块未完工 → module_order 拒收（拓扑版阶段顺序门）', () => {
    const started = startProjectV2(mkState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const r = investModule(started.next as TestState, started.projectId, 'hab', V2DEF);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('module_order');
    expect(r.message).toContain('core');
    expect(r.message).toContain('前置');
  });

  it('前置完工后注资通过：扣账＋投影（ref·模块名）＋模块回写（进行中/queue_index/base）＋module_started 事件', () => {
    const started = startProjectV2(mkState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const s1 = syncProjects(markQueueDone(started.next as TestState, 0)).next as TestState;
    expect(asV2(s1.projects![0]).modules[0].status).toBe('完工');

    const r = investModule(s1, started.projectId, 'hab', V2DEF);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const project = asV2(r.next.projects![0]);
    expect(project.modules[2]).toEqual({ id: 'hab', name: '居住舱段', status: '进行中', base: 'beipo', queue_index: 1 });
    expect(r.next.economy!.credits).toBe(4650); // 5000-200(core)-150(hab)
    expect(r.next.economy!.resources!.nanites!.标准纳米工料).toBe(70); // 100-20(core)-10(hab)
    expect(r.next.queues[1]).toMatchObject({
      type: '工程',
      item: '空间站·居住舱段',
      base: 'beipo',
      status: 'queued',
      lane: 'eng:eng.orbital',
      total_minutes: 2 * 1440,
      min_days_lock: 1,
      cost_paid: true,
    });
    expect(r.events[0].type).toBe('module_started');
    expect(r.events[0].detail).toContain('纳米已扣减 10');
    expect(r.events[0].detail).not.toContain('门槛不抵扣');

    const zeroMod = investModule(s1, started.projectId, 'frame', V2DEF);
    if (!zeroMod.ok) throw new Error(zeroMod.message);
    expect(zeroMod.next.economy!.resources!.nanites!.标准纳米工料).toBe(80);
    expect(zeroMod.events[0].detail).toContain('未消耗纳米');
    expect(zeroMod.events[0].detail).not.toContain('已扣减');
  });

  it('D-C7 每在队模块各占一槽：容量 1 被根模块占满 → 第二根注资 no_slot；容量 2 放行双模块并行在队', () => {
    // 容量 1：core 在队占满 → frame 拒收
    const started = startProjectV2(mkState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const r1 = investModule(started.next as TestState, started.projectId, 'frame', V2DEF);
    expect(r1.ok).toBe(false);
    if (r1.ok) return;
    expect(r1.reason).toBe('no_slot');
    expect(r1.message).toContain('D-C7');
    expect(r1.message).toContain('占满');

    // 容量 2：双根并行在队（§4 压力测试点——多模块并行=多项同存）
    const started2 = startProjectV2(mkDualState(), V2DEF, { base: 'beipo' });
    if (!started2.ok) throw new Error('setup failed');
    const r2 = investModule(started2.next as TestState, started2.projectId, 'frame', V2DEF);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.next.queues).toHaveLength(2);
    expect(r2.next.queues.map(q => q.lane)).toEqual(['eng:eng.orbital', 'eng:eng.orbital']);
    expect(r2.next.queues.map(q => q.status)).toEqual(['queued', 'queued']);
  });

  it('状态门：进行中模块再注资 → bad_status；工程暂停 → 模块注资 bad_status', () => {
    const started = startProjectV2(mkDualState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const again = investModule(started.next as TestState, started.projectId, 'core', V2DEF);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe('bad_status');

    const paused = pauseProjectV2(started.next as TestState, started.projectId);
    if (!paused.ok) throw new Error('setup failed');
    const r = investModule(paused.next as TestState, started.projectId, 'frame', V2DEF);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('bad_status');
  });

  it('not_found：缺模块 id / V1 线性工程进 V2 通道（判别拒收）', () => {
    const started = startProjectV2(mkState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const missing = investModule(started.next as TestState, started.projectId, 'ghost', V2DEF);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.reason).toBe('not_found');

    const v1 = startProject(mkV1State(), V1DEF, { base: 'beipo' });
    if (!v1.ok) throw new Error('setup failed');
    const cross = investModule(v1.next as TestState, v1.projectId, 'core', V2DEF);
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.reason).toBe('not_found');
    expect(cross.message).toContain('V1');
  });

  it('模块资金不足 → funds 拒收，工程不暴毙（模块停摆=V2 版 D8）', () => {
    const state = mkState({ economy: { credits: 400, resources: { nanites: { 标准纳米工料: 100 } } } });
    const started = startProjectV2(state, V2DEF, { base: 'beipo' }); // 扣 core 200 → 余 200
    if (!started.ok) throw new Error('setup failed');
    const s1 = syncProjects(markQueueDone(started.next as TestState, 0)).next as TestState;
    const pricey: ProjectV2Def = {
      ...V2DEF,
      modules: V2DEF.modules.map(m => (m.id === 'hab' ? { ...m, cost: 300 } : m)),
    };
    const r = investModule(s1, started.projectId, 'hab', pricey); // 需 300 ＞ 余 200
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('funds');
    expect(r.message).toContain('模块停摆');
    expect(asV2(s1.projects![0]).status).toBe('在建');
    expect(asV2(s1.projects![0]).modules[2].status).toBe('未启动');
    expect(s1.queues).toHaveLength(1);
    expect(s1.economy!.credits).toBe(200);
  });

  it('模块级基地指派：options.base 显式指派 south → 模块跨基地承建（投影 base=south）', () => {
    const started = startProjectV2(mkDualState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const r = investModule(started.next as TestState, started.projectId, 'frame', V2DEF, { base: 'south' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const project = asV2(r.next.projects![0]);
    expect(project.modules[1]).toMatchObject({ id: 'frame', status: '进行中', base: 'south', queue_index: 1 });
    expect(r.next.queues[1]).toMatchObject({ base: 'south', lane: 'eng:eng.orbital' });
    // moduleBase 显式指派优先（exported 助手钉死口径）
    expect(moduleBase(project, project.modules[1], 1)).toBe('south');
  });
});

/* ═══════════════ ③ syncProjects V2 分支：模块里程碑＋拓扑完工 ═══════════════ */

describe('③ syncProjects V2 分支（§3.3：queue→模块里程碑回写＋拓扑完工结算）', () => {
  it('投影项 done → 模块完工＋queue_index 释放＋module_milestone 事件，工程仍在建', () => {
    const started = startProjectV2(mkState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const r = syncProjects(markQueueDone(started.next as TestState, 0));
    const project = asV2((r.next as TestState).projects![0]);
    expect(project.modules[0]).toEqual({ id: 'core', name: '核心舱', status: '完工', base: 'beipo', queue_index: null });
    expect(project.status).toBe('在建');
    expect(r.events.some(e => e.type === 'module_milestone')).toBe(true);
    expect(r.events.some(e => e.type === 'project_completed')).toBe(false);
  });

  it('端到端：全模块拓扑完工 → 工程完工＋outcome={type:mark}＋project_completed 事件', () => {
    const started = startProjectV2(mkState(), MINI, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    // core 完工
    const s1 = syncProjects(markQueueDone(started.next as TestState, 0)).next as TestState;
    // dock 注资＋完工
    const invested = investModule(s1, started.projectId, 'dock', MINI);
    if (!invested.ok) throw new Error('setup failed: ' + invested.message);
    const r = syncProjects(markQueueDone(invested.next as TestState, 1));
    const project = asV2((r.next as TestState).projects![0]);
    expect(project.status).toBe('完工');
    expect(project.modules.every(m => m.status === '完工')).toBe(true);
    expect(project.outcome).toEqual({ type: 'mark' });
    expect(isProjectV2Complete(project)).toBe(true);
    const completed = r.events.find(e => e.type === 'project_completed');
    expect(completed?.detail).toContain('2 模块拓扑完工');
    expect(r.next.economy!.credits).toBe(4850); // 5000-100-50
  });

  it('isProjectV2Complete 判定：部分完工 false / 全部完工 true / V1 工程 false / 空模块 false', () => {
    const started = startProjectV2(mkState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const project = asV2((started.next as TestState).projects![0]);
    expect(isProjectV2Complete(project)).toBe(false);
    const allDone: ProjectV2 = { ...project, modules: project.modules.map(m => ({ ...m, status: '完工' })) };
    expect(isProjectV2Complete(allDone)).toBe(true);
    const v1 = startProject(mkV1State(), V1DEF, { base: 'beipo' });
    if (!v1.ok) throw new Error('setup failed');
    const v1Project = (v1.next as TestState).projects![0];
    if (isProjectV2(v1Project)) throw new Error('V1 工程不应判为 V2');
    expect(isProjectV2Complete(v1Project)).toBe(false);
    expect(isProjectV2Complete({ ...allDone, modules: [] })).toBe(false);
  });

  it('投影项外部 cancelled → 模块置取消＋sync_warn 留痕（工程保持在建，镜像 V1 口径）', () => {
    const started = startProjectV2(mkState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const cancelled: TestState = {
      ...(started.next as TestState),
      queues: (started.next as TestState).queues.map((q, i) =>
        i === 0 ? { ...q, status: 'cancelled' as const } : q,
      ),
    };
    const r = syncProjects(cancelled);
    const project = asV2((r.next as TestState).projects![0]);
    expect(project.modules[0]).toEqual({ id: 'core', name: '核心舱', status: '取消', base: 'beipo', queue_index: null });
    expect(project.status).toBe('在建');
    expect(r.events.some(e => e.type === 'sync_warn' && e.detail?.includes('外部取消'))).toBe(true);
  });

  it('queue_index 身份不符 → sync_warn 跳过、指针保留（fail-open 可自愈）', () => {
    const started = startProjectV2(mkState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const tampered: TestState = {
      ...(started.next as TestState),
      queues: [{ ...(started.next as TestState).queues[0], item: '别的工程·别的模块' }],
    };
    const r = syncProjects(tampered);
    expect(r.events.some(e => e.type === 'sync_warn')).toBe(true);
    const module = asV2((r.next as TestState).projects![0]).modules[0];
    expect(module.queue_index).toBe(0); // 指针保留
    expect(module.status).toBe('进行中');
  });

  it('V1·V2 同数组共存：sync 双分支互不干扰（V1 阶段回写＋V2 模块回写同楼生效）', () => {
    const both = mkState({
      bases: [
        { id: 'beipo', name: '北坡基地', buildings: [{ name: '盟军建造厂', state: '运转' }, { name: '航天发射中心', state: '运转' }] },
      ],
    });
    const v1 = startProject(both, V1DEF, { base: 'beipo' });
    if (!v1.ok) throw new Error('setup failed');
    const v2 = startProjectV2(v1.next as TestState, V2DEF, { base: 'beipo' });
    if (!v2.ok) throw new Error('setup failed');
    const marked = markQueueDone(markQueueDone(v2.next as TestState, 0), 1);
    const r = syncProjects(marked);
    const projects = (r.next as TestState).projects!;
    const v1p = projects[0] as ProjectV1;
    const v2p = asV2(projects[1]);
    expect(v1p.phases[0]).toMatchObject({ status: '完工', queue_index: null }); // V1 分支零变化
    expect(v1p.status).toBe('在建');
    expect(v2p.modules[0]).toMatchObject({ status: '完工', queue_index: null }); // V2 分支工作
    expect(v2p.status).toBe('在建');
  });

  it('settleFloor 集成：每楼结算自动跑 V2 分支（全模块 done → 工程完工，事件入楼流水）', () => {
    const prev = Schema.parse({ meta: { world_id: 't', date: '2042-03-14', day_count: 1 } });
    const next = Schema.parse({
      meta: { world_id: 't', date: '2042-03-14', day_count: 1 },
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '航天发射中心', state: '运转' }] }],
      queues: [
        { type: '工程', item: '轨道船坞·核心舱', base: 'beipo', status: 'done', total_minutes: 2880, spent_minutes: 2880, progress: 100, lane: 'eng:eng.orbital' },
        { type: '工程', item: '轨道船坞·对接舱段', base: 'beipo', status: 'done', total_minutes: 1440, spent_minutes: 1440, progress: 100, lane: 'eng:eng.orbital' },
      ],
      projects: [
        {
          id: 'proj:轨道船坞@beipo',
          ref: '轨道船坞',
          scope: 'base',
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '巨构',
          status: '在建',
          schema_version: 2,
          modules: [
            { id: 'core', name: '核心舱', status: '完工', base: 'beipo', queue_index: null },
            { id: 'dock', name: '对接舱段', status: '进行中', base: 'beipo', queue_index: 1 },
          ],
        },
      ],
    });
    const r = settleFloor(prev, next, '正文无时间标签');
    const project = asV2(r.data.projects![0]);
    expect(project.modules.every(m => m.status === '完工')).toBe(true);
    expect(project.status).toBe('完工');
    expect(project.outcome).toEqual({ type: 'mark' });
    expect(r.events.some(e => e.message.includes('[工程] project_completed'))).toBe(true);
    expect(r.events.some(e => e.message.includes('[工程] module_milestone'))).toBe(true);
  });
});

/* ═══════════════ ④ 模块级 pause/resume（hold 单模块） ═══════════════ */

describe('④ 模块级暂停/恢复（hold 单模块，工程保持在建）', () => {
  it('暂停：active 投影退回 queued＋hold（进度保留）、模块暂停、工程保持在建；恢复清 hold 反向', () => {
    const started = startProjectV2(mkDualState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const invested = investModule(started.next as TestState, started.projectId, 'frame', V2DEF);
    if (!invested.ok) throw new Error('setup failed');
    const active: TestState = {
      ...(invested.next as TestState),
      queues: (invested.next as TestState).queues.map(q => ({ ...q, status: 'active' as const })),
    };

    const paused = pauseModule(active, started.projectId, 'core');
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    let project = asV2((paused.next as TestState).projects![0]);
    expect(project.status).toBe('在建'); // 工程级不动
    expect(project.modules[0].status).toBe('暂停');
    expect(project.modules[1].status).toBe('进行中'); // 其他模块不受牵连
    expect(paused.next.queues[0]).toMatchObject({ status: 'queued', hold: true });
    expect(paused.next.queues[1]).toMatchObject({ status: 'active', hold: false }); // frame 模块独立运转
    expect(paused.events[0].type).toBe('module_paused');

    const resumed = resumeModule(paused.next as TestState, started.projectId, 'core');
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    project = asV2((resumed.next as TestState).projects![0]);
    expect(project.modules[0].status).toBe('进行中');
    expect(resumed.next.queues[0]).toMatchObject({ hold: false });
    expect(resumed.events[0].type).toBe('module_resumed');
  });

  it('状态门：未启动模块不可暂停（bad_status）；V1 工程进模块通道 → not_found（判别拒收）', () => {
    const started = startProjectV2(mkState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const r = pauseModule(started.next as TestState, started.projectId, 'frame'); // 未启动
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('bad_status');

    const v1 = startProject(mkV1State(), V1DEF, { base: 'beipo' });
    if (!v1.ok) throw new Error('setup failed');
    const cross = pauseModule(v1.next as TestState, v1.projectId, 'core');
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.reason).toBe('not_found');
  });
});

/* ═══════════════ ⑤ 工程级 pause/resume/cancel（联动全部未完工模块） ═══════════════ */

describe('⑤ 工程级暂停/恢复/取消（联动整工程；取消结算对齐 V1 口径）', () => {
  it('工程级暂停：全部在途模块联动 hold＋暂停；恢复整体放行；V1 pauseProject 对 V2 实例 → not_found（V2-01 边界守门）', () => {
    const started = startProjectV2(mkDualState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const invested = investModule(started.next as TestState, started.projectId, 'frame', V2DEF);
    if (!invested.ok) throw new Error('setup failed');
    const active: TestState = {
      ...(invested.next as TestState),
      queues: (invested.next as TestState).queues.map(q => ({ ...q, status: 'active' as const, spent_minutes: 300 })),
    };

    const paused = pauseProjectV2(active, started.projectId);
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    let project = asV2((paused.next as TestState).projects![0]);
    expect(project.status).toBe('暂停');
    expect(project.modules[0].status).toBe('暂停');
    expect(project.modules[1].status).toBe('暂停');
    expect(paused.next.queues[0]).toMatchObject({ status: 'queued', hold: true, spent_minutes: 300 }); // 进度保留
    expect(paused.next.queues[1]).toMatchObject({ status: 'queued', hold: true });
    expect(paused.events[0].type).toBe('project_paused');

    const resumed = resumeProjectV2(paused.next as TestState, started.projectId);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    project = asV2((resumed.next as TestState).projects![0]);
    expect(project.status).toBe('在建');
    expect(project.modules[0].status).toBe('进行中');
    expect(resumed.next.queues[0]).toMatchObject({ hold: false, spent_minutes: 300 });

    // V2-01 边界：V1 五函数对 V2 实例拒收（红线守门）
    const v1channel = pauseProject(active, started.projectId);
    expect(v1channel.ok).toBe(false);
    if (v1channel.ok) return;
    expect(v1channel.reason).toBe('not_found');
  });

  it('在建取消：在途模块取消＋完工保留＋未启动保持＋投影 cancelled；结算文案要素齐全（对齐 V1 §3.3）', () => {
    const started = startProjectV2(mkState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const s1 = syncProjects(markQueueDone(started.next as TestState, 0)).next as TestState; // core 完工
    const invested = investModule(s1, started.projectId, 'hab', V2DEF); // hab 在队
    if (!invested.ok) throw new Error('setup failed');

    const r = cancelProjectV2(invested.next as TestState, started.projectId, V2DEF);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const state = r.next as TestState;
    const project = asV2(state.projects![0]);
    expect(project.status).toBe('取消');
    expect(project.modules.map(m => m.status)).toEqual(['完工', '未启动', '取消', '未启动']);
    expect(project.modules.every(m => m.queue_index === null)).toBe(true); // 指针全释放
    expect(state.queues[0].status).toBe('done'); // 已终态不动
    expect(state.queues[1].status).toBe('cancelled'); // 在途作废
    // §3.3 固定文案模块版：点名＋金额＋不退＋作废＋纳米零变动
    expect(r.settlementText).toContain('已注资 2 个模块');
    expect(r.settlementText).toContain('「核心舱」');
    expect(r.settlementText).toContain('「居住舱段」');
    expect(r.settlementText).toContain('350'); // 200+150
    expect(r.settlementText).toContain('不予退还');
    expect(r.settlementText).toContain('折算进度全部作废');
    expect(r.settlementText).toContain('已消耗纳米不予退还');
    expect(r.settlementText).toContain('取消操作不再扣减纳米库存');
    expect(r.settlementText).not.toContain('从未发生抵扣');
    expect(state.economy!.resources!.nanites!.标准纳米工料).toBe(70);
    expect(r.events[0].type).toBe('project_cancelled');
  });

  it('纯未完工取消：只计在途根模块（已注资 1 个模块）；def 缺席金额省略', () => {
    const started = startProjectV2(mkState(), V2DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const withDef = cancelProjectV2(started.next as TestState, started.projectId, V2DEF);
    expect(withDef.ok).toBe(true);
    if (!withDef.ok) return;
    expect(withDef.settlementText).toContain('已注资 1 个模块');
    expect(withDef.settlementText).toContain('200');
    const noDef = cancelProjectV2(started.next as TestState, started.projectId);
    expect(noDef.ok).toBe(true);
    if (!noDef.ok) return;
    expect(noDef.settlementText).toContain('已注资金额');
    expect(noDef.settlementText).not.toContain('注资合计');
  });

  it('判别拒收：cancelProjectV2 对 V1 → not_found；V1 cancelProject 对 V2 → not_found（双向边界）', () => {
    const v1 = startProject(mkV1State(), V1DEF, { base: 'beipo' });
    if (!v1.ok) throw new Error('setup failed');
    const cross1 = cancelProjectV2(v1.next as TestState, v1.projectId, V2DEF);
    expect(cross1.ok).toBe(false);
    if (cross1.ok) return;
    expect(cross1.reason).toBe('not_found');
    expect(cross1.message).toContain('V1');

    const v2 = startProjectV2(mkState(), V2DEF, { base: 'beipo' });
    if (!v2.ok) throw new Error('setup failed');
    const cross2 = cancelProject(v2.next as TestState, v2.projectId);
    expect(cross2.ok).toBe(false);
    if (cross2.ok) return;
    expect(cross2.reason).toBe('not_found');
  });
});

/* ═══════════════ ⑥ D-TH-1 僵尸陷阱修复（§9.2：非终态优先、最新在前） ═══════════════ */

describe('⑥ D-TH-1 findProjectIndex（同 id 多实例不再劫持指令）', () => {
  /** 手造多实例工程数组（经 Schema.parse 补齐默认值，与运行时实例同构） */
  function mkProjects(...statuses: Project['status'][]): Project[] {
    const data = Schema.parse({
      projects: statuses.map(status => ({
        id: 'proj:灰熊坦克现代化改装工程@beipo',
        ref: '灰熊坦克现代化改装工程',
        grade: '中改',
        status,
      })),
    });
    return data.projects!;
  }

  it('同 id 多实例：非终态优先（跳过首尾终态命中 index 1）；全终态→最新在前；ref 回退同口径；未命中 -1', () => {
    // 非终态优先：[取消, 在建, 取消] → 1
    const state = mkV1State({ projects: mkProjects('取消', '在建', '取消') });
    expect(findProjectIndex(state, 'proj:灰熊坦克现代化改装工程@beipo')).toBe(1);
    // ref 回退同样处理
    expect(findProjectIndex(state, '灰熊坦克现代化改装工程')).toBe(1);
    // 非终态多个 → 最新在前（数组尾）
    const twoLive = mkV1State({ projects: mkProjects('在建', '在建') });
    expect(findProjectIndex(twoLive, 'proj:灰熊坦克现代化改装工程@beipo')).toBe(1);
    // 全终态 → 最新终态（尾）
    const allDead = mkV1State({ projects: mkProjects('完工', '取消') });
    expect(findProjectIndex(allDead, 'proj:灰熊坦克现代化改装工程@beipo')).toBe(1);
    // 未命中
    expect(findProjectIndex(allDead, 'proj:none')).toBe(-1);
    // 单实例路径与旧实现逐字节同行为（唯一匹配即返回）
    const single = mkV1State({
      projects: Schema.parse({ projects: [{ id: 'proj:solo', ref: '独一工程', grade: '中改' }] }).projects!,
    });
    expect(findProjectIndex(single, 'proj:solo')).toBe(0);
    expect(findProjectIndex(single, '独一工程')).toBe(0);
  });

  it('僵尸场景端到端（V1 路径）：同 id 重立后 pauseProject 命中新实例，旧取消实例分毫不动', () => {
    const s0 = mkV1State();
    const first = startProject(s0, V1DEF, { base: 'beipo' });
    if (!first.ok) throw new Error('setup failed');
    const cancelled = cancelProject(first.next as TestState, first.projectId);
    if (!cancelled.ok) throw new Error('setup failed');
    // 重立：旧实例已终态，duplicate 门放行 → 确定性 id 碰撞（D-TH-1 触发条件）
    const second = startProject(cancelled.next as TestState, V1DEF, { base: 'beipo' });
    if (!second.ok) throw new Error('setup failed');
    expect((second.next as TestState).projects).toHaveLength(2);
    expect((second.next as TestState).projects![1].id).toBe(`${(second.next as TestState).projects![0].id}#2`);

    // 修复后：指令命中新实例（index 1），旧取消实例不再劫持
    const paused = pauseProject(second.next as TestState, second.projectId);
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    expect((paused.next as TestState).projects![1].status).toBe('暂停');
    expect((paused.next as TestState).projects![0].status).toBe('取消');
    expect((paused.next as TestState).queues!.every(q => q.status === 'queued' || q.status === 'cancelled')).toBe(true);
  });

  it('FIX-P1-02 / FIX-P1-03：V2 工程支持战略协议前置、暂停模块释放单槽 eng.orbital 供其他模块注资、恢复时复验槽位容量', () => {
    const defWithProto: ProjectV2Def = {
      ...V2DEF,
      requirements: { research: '高空无人侦察协定', building: '航天发射中心' },
      modules: [
        { id: 'core', name: '核心舱', cost: 500, workload: { days: 3 }, prereqs: [] },
        { id: 'solar', name: '太阳能翼', cost: 400, workload: { days: 2 }, prereqs: [] },
      ],
    };
    const s0 = mkState({
      tech: { done: [] },
      protocols: [{ ref: 'all.protocol.ra3.high_altitude_uav_pact', status: 'active' }],
    } as Partial<TestState>);
    const started = startProjectV2(s0, defWithProto, { base: 'beipo' });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    // 单槽基地 core 在建时直接注资 solar → no_slot
    const blocked = investModule(started.next as TestState, started.projectId, 'solar', defWithProto);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe('no_slot');

    // 暂停 core 模块 → 释放 eng.orbital 槽位，此时注资 solar 成功！
    const pausedCore = pauseModule(started.next as TestState, started.projectId, 'core');
    expect(pausedCore.ok).toBe(true);
    if (!pausedCore.ok) return;

    const investedSolar = investModule(pausedCore.next as TestState, started.projectId, 'solar', defWithProto);
    expect(investedSolar.ok).toBe(true);
    if (!investedSolar.ok) return;

    // 此时单槽已被 solar 占用，尝试恢复 core 模块 → 复验槽位容量拦截 no_slot
    const resumeBlocked = resumeModule(investedSolar.next as TestState, started.projectId, 'core');
    expect(resumeBlocked.ok).toBe(false);
    if (!resumeBlocked.ok) expect(resumeBlocked.reason).toBe('no_slot');
  });

  it('BUG-R2-11：deductEconomyNanites 按从低阶到高阶优先级顺序扣减分小类纳米工料，未知正数键排在最后', async () => {
    const { deductEconomyNanites } = await import('../engines/projectEngineHelpers');
    // 故意将高阶键放在对象前面、低阶键放在后面，验证不依赖 Object.entries 原始插入顺序
    const economy = {
      credits: 5000,
      resources: {
        nanites: {
          机娘修复凝胶: 50,
          高能纳米工料: 40,
          特种纳米工料: 30,
          军工纳米工料: 20,
          标准纳米工料: 15,
          通用纳米工料: 10,
          自定义未知纳米: 25,
        },
      },
    };
    // 扣减 50：应依次扣完 通用(10) + 标准(15) + 军工(20) + 特种(5/30)，高能与机娘修复凝胶及未知纳米毫发无损
    const after50 = deductEconomyNanites(economy, 50, 4200);
    expect(after50.credits).toBe(4200);
    expect(after50.resources?.nanites).toEqual({
      通用纳米工料: 0,
      标准纳米工料: 0,
      军工纳米工料: 0,
      特种纳米工料: 25,
      高能纳米工料: 40,
      机娘修复凝胶: 50,
      自定义未知纳米: 25,
    });

    // 再扣减 125：扣完 特种(25) + 高能(40) + 机娘修复凝胶(50) + 自定义未知纳米(10/25)
    const after175 = deductEconomyNanites(after50, 125, 3000);
    expect(after175.resources?.nanites).toEqual({
      通用纳米工料: 0,
      标准纳米工料: 0,
      军工纳米工料: 0,
      特种纳米工料: 0,
      高能纳米工料: 0,
      机娘修复凝胶: 0,
      自定义未知纳米: 15,
    });
  });
});
