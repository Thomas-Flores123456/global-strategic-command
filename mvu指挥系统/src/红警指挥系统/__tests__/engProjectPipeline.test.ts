/**
 * engProjectPipeline.test.ts —— V2-04 · 世界书 project 块端到端贯通测试
 *
 * 真源：docs/project/plans/工程玩法MVP任务包.md §9.1 V2-04 卡；
 *       docs/project/plans/仓段化V2设计案-草案.md §3.1（世界书块结构）/§3.3（投影命名合同 ref·模块名）。
 * 覆盖：
 * 1. worldbookProjectToDef：grade 枚举收敛（合法保留/非法丢弃→引擎缺省补「巨构」D-C2）、字段逐项透传；
 * 2. mergeEffectiveCatalog：projects 桶经 wb 动态通道合并（mergeByName）；无 wb 工程退回静态 PROJECTS；
 * 3. engAssemblySpecFor 接缝（V2-03 悬空点 1）：V2 投影项 ref·模块名 解析模块 workload tflops/tops；
 *    V1 phases 与 V2 modules 同池共存分流；未声明算力/未知工程/非工程类型 → undefined；
 * 4. startProjectV2 直喂：世界书 def（ProjectDef 形状）三门全过→根模块注资扣账+投影入队
 *    （D-C4 eng.orbital 专属槽 / D12 min_days_lock / 注资记账 cost_paid）；
 * 5. investModule 拓扑门：前置模块未完工 → module_order 拒收（phase_order 的拓扑版）；
 * 6. settleWithTwoStage：V2 投影项经接缝吃算力加速＋D12 钳制（阶段二 1.5x、阶段一不吃，口径同 V1）。
 *
 * 测试数据：内联世界书条目（与 fixtures/engProjectWorldbook.json 同源；该 fixture 的
 * round-trip 逐字节基线归 engRetrofitFields.test.ts describe 4——本文件不读文件系统，
 * 避免新增 node:fs 导入破坏 tsc 基线）。
 */
import { describe, expect, it } from 'vitest';
import { parseWorldbookEntries } from '../../中控悬浮窗/models/worldbookCatalogParser';
import { PROJECTS } from '../core/catalog';
import { mergeEffectiveCatalog, worldbookProjectToDef } from '../core/catalogEffective';
import {
  cancelProjectV2,
  engAssemblySpecFor,
  investModule,
  resolveEngineeringQueueIndex,
  startProjectV2,
  syncProjects,
  type ProjectQueueItem,
  type ProjectStateView,
} from '../engines/projectEngine';
import { QueueItem, type Project, type ProjectV2 } from '../core/schema';
import { pruneCompletedQueuesFromPrevFloor } from '../engines/settleFloorHelpers';
import { settleWithTwoStage } from '../engines/twoStageAssemblyEngine';

/* ═══════════════ 测试数据：内联世界书条目（fixtures/engProjectWorldbook.json 同源） ═══════════════ */

const WB_ENTRIES = [
  {
    name: '轨道船坞',
    content:
      '<数据>{"schema_version":2,"type":"project","id":"all.project.orbital_shipyard","name":"轨道船坞","grade":"巨构","scope":"theater","cost":600000,"tags":["工程","太空"],"desc":"近地轨道组装船坞。","requirements":{"research":"轨道工程学","building":"盟军建造厂","credits":600000,"nanites":80},"modules":[{"id":"m.core","cost":200000,"workload":{"days":10,"min_days":5,"tflops":4,"tops":2},"resources":{"nanites":20}},{"id":"m.dock","name":"船坞桁架","cost":200000,"workload":{"days":12,"min_days":6},"prereqs":["m.core"]},{"id":"m.gantry","name":"龙门吊臂","cost":200000,"workload":{"days":15,"min_days":7},"prereqs":["m.core","m.dock"]}]}</数据>\n',
  },
  {
    name: '测试工程',
    content:
      '<数据>{"type":"project","schema_version":2,"id":"测试工程","modules":[{"id":"m1","workload":{"days":2,"min_days":1}}]}</数据>\n',
  },
];

const parsed = parseWorldbookEntries(WB_ENTRIES, { silent: true });
const defs = parsed.projects.map(worldbookProjectToDef);
const orbital = defs.find(d => d.name === '轨道船坞');
const mini = defs.find(d => d.name === '测试工程');

interface TestState extends ProjectStateView {
  queues: ProjectQueueItem[];
  projects?: Project[];
}

/** 单基地（一座运转航天发射中心=eng.orbital 容量 1）、科技就位、资金 100 万、纳米 100 */
function mkState(overrides: Partial<TestState> = {}): TestState {
  return {
    tech: { done: ['轨道工程学'] },
    economy: { credits: 1000000, resources: { nanites: { 标准纳米工料: 100, 高精构型纳米: null } } },
    bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '航天发射中心', state: '运转' }] }],
    queues: [],
    projects: [],
    ...overrides,
  };
}

describe('ENG03-01 工程投影归档漂移隔离', () => {
  function driftedState(bStatus: 'active' | 'done'): TestState {
    if (!mini) throw new Error('测试工程 def 缺席');
    const initial = mkState({
      bases: ['beipo', 'south'].map(id => ({
        id, name: id, buildings: [{ name: '航天发射中心', state: '运转' }],
      })),
      queues: [QueueItem.parse({ type: '研究', item: '已归档研究', status: 'done' })],
    });
    const a = startProjectV2(initial, mini, { base: 'beipo' });
    if (!a.ok) throw new Error(a.message);
    const b = startProjectV2(a.next, mini, { base: 'south' });
    if (!b.ok) throw new Error(b.message);
    const current = b.next.queues.map((q, idx) => ({
      ...q,
      ...(idx === 1 ? { status: 'active' as const } : {}),
      ...(idx === 2 ? {
        status: bStatus,
        progress: bStatus === 'done' ? 100 : 0,
        spent_minutes: bStatus === 'done' ? q.total_minutes : 0,
        qty_done: bStatus === 'done' ? 1 : 0,
      } : {}),
    }));
    return { ...b.next, queues: pruneCompletedQueuesFromPrevFloor(b.next, current).queues };
  }

  it('两基地同名工程：前项归档后A仍进行中，只有B回写完工', () => {
    const state = driftedState('done');
    expect(state.queues.map(q => q.base)).toEqual(['beipo', 'south']);
    const result = syncProjects(state);
    expect(result.next.projects![0]).toMatchObject({
      status: '在建', modules: [{ status: '进行中', queue_index: 0 }],
    });
    expect(result.next.projects![1]).toMatchObject({
      status: '完工', modules: [{ status: '完工', queue_index: null }],
    });
  });

  it('漂移后取消A只取消A投影，不伤B', () => {
    const state = driftedState('active');
    const result = cancelProjectV2(state, state.projects![0].id);
    if (!result.ok) throw new Error(result.message);
    expect(result.next.queues[0].status).toBe('cancelled');
    expect(result.next.queues[1]).toEqual(state.queues[1]);
    expect(result.next.projects![1]).toEqual(state.projects![1]);
  });

  it('A投影缺失不跨基地回读B，保留指针并报告sync_warn', () => {
    const state = driftedState('done');
    state.queues = state.queues.filter(q => q.base !== 'beipo');
    const result = syncProjects(state);
    expect(result.next.projects![0]).toEqual(state.projects![0]);
    expect(result.events.some(e => e.type === 'sync_warn')).toBe(true);
  });

  it('同基地单候选漂移正常恢复', () => {
    const state = driftedState('active');
    state.queues = state.queues.filter(q => q.base === 'beipo');
    state.projects = [state.projects![0]];
    const result = syncProjects(state);
    expect(result.next.projects![0]).toMatchObject({
      status: '在建', modules: [{ status: '进行中', queue_index: 0 }],
    });
    expect(result.events).toEqual([]);
  });

  it('漂移后同基地同名多候选不能靠数组顺序猜测', () => {
    const state = driftedState('active');
    const a = state.queues[0];
    state.queues.push({ ...a }); // 联建工程可在同一承建基地拥有同名模块投影
    expect(resolveEngineeringQueueIndex(state.queues, 1, a.item, a.base)).toBeNull();
    const result = syncProjects(state);
    expect(result.next.projects![0]).toEqual(state.projects![0]);
    expect(result.events.some(e => e.type === 'sync_warn')).toBe(true);
  });
});

/* ═══════════════ ① catalog 侧：worldbookProjectToDef 形状收敛 ═══════════════ */

describe('V2-04 ① worldbookProjectToDef：世界书 project 块 → ProjectDef', () => {
  it('合法 grade 保留、requirements/modules 逐字段透传（kind=project）', () => {
    expect(parsed.diagnostics).toHaveLength(0);
    expect(parsed.projects).toHaveLength(2);
    expect(orbital).toBeDefined();
    if (!orbital) throw new Error('轨道船坞 def 缺席');
    expect(orbital.kind).toBe('project');
    expect(orbital.id).toBe('all.project.orbital_shipyard');
    expect(orbital.name).toBe('轨道船坞');
    expect(orbital.grade).toBe('巨构');
    expect(orbital.scope).toBe('theater');
    expect(orbital.requirements).toEqual({
      research: '轨道工程学',
      building: '盟军建造厂',
      credits: 600000,
      nanites: 80,
    });
    expect(orbital.modules).toHaveLength(3);
    // 模块缺省兑底随形：m.core 无 name → 回填 id；无 prereqs → []
    expect(orbital.modules[0]).toMatchObject({ id: 'm.core', name: 'm.core', cost: 200000, prereqs: [] });
    expect(orbital.modules[2]).toMatchObject({ id: 'm.gantry', name: '龙门吊臂', prereqs: ['m.core', 'm.dock'] });
  });

  it('非法 grade 收敛 undefined（引擎侧缺省补「巨构」，D-C2）', () => {
    const raw = { ...parsed.projects[0], grade: '超大改' } as typeof parsed.projects[0];
    expect(worldbookProjectToDef(raw).grade).toBeUndefined();
  });

  it('最小形状工程：grade/scope/requirements undefined、cost 声明位 0', () => {
    expect(mini).toBeDefined();
    if (!mini) throw new Error('测试工程 def 缺席');
    expect(mini.kind).toBe('project');
    expect(mini.grade).toBeUndefined();
    expect(mini.scope).toBeUndefined();
    expect(mini.requirements).toBeUndefined();
    expect(mini.cost).toBe(0);
    expect(mini.modules).toHaveLength(1);
    expect(mini.modules[0]).toMatchObject({ id: 'm1', name: 'm1', prereqs: [] });
  });
});

/* ═══════════════ ② mergeEffectiveCatalog：projects 桶动态通道 ═══════════════ */

describe('V2-04 ② mergeEffectiveCatalog：projects 桶贯通（与 retrofit 同生命周期）', () => {
  it('wb 工程并入 projects 桶（静态 PROJECTS 空基线，mergeByName 按 name）', () => {
    const eff = mergeEffectiveCatalog([], { projects: parsed.projects });
    expect(eff.projects).toHaveLength(2);
    expect(eff.projects.map(p => p.name)).toEqual(expect.arrayContaining(['轨道船坞', '测试工程']));
    const merged = eff.projects.find(p => p.name === '轨道船坞');
    expect(merged?.modules).toHaveLength(3);
  });

  it('无 wb 工程时 projects 桶退回静态 PROJECTS 引用（降级链）', () => {
    const eff = mergeEffectiveCatalog([], {});
    expect(eff.projects).toBe(PROJECTS);
    expect(PROJECTS).toHaveLength(0); // 冻结宣告：静态基线不落仓段化工程条目（V2-08 落书）
  });
});

/* ═══════════════ ③ engAssemblySpecFor 接缝：V2 投影项算力映射 ═══════════════ */

describe('V2-04 ③ engAssemblySpecFor 接缝扩展（V2-03 悬空点 1）', () => {
  it('V2 投影项 ref·模块名 → 模块 workload tflops/tops（§3.3 命名合同）', () => {
    expect(engAssemblySpecFor(defs, { type: '工程', item: '轨道船坞·m.core' })).toEqual({ tflops: 4, tops: 2 });
  });

  it('模块 workload 未声明算力 → undefined（无杠杆非错误）', () => {
    expect(engAssemblySpecFor(defs, { type: '工程', item: '轨道船坞·船坞桁架' })).toBeUndefined();
  });

  it('V1 phases 与 V2 modules 同池共存（合并数组同函数分流）', () => {
    const v1 = {
      name: '灰熊坦克现代化改装工程',
      phases: [{ name: '总装与调校', workload: { days: 4, min_days: 2, tflops: 10, tops: 4 } }],
    };
    const pool = [...defs, v1];
    expect(engAssemblySpecFor(pool, { type: '工程', item: '轨道船坞·m.core' })).toEqual({ tflops: 4, tops: 2 });
    expect(engAssemblySpecFor(pool, { type: '工程', item: '灰熊坦克现代化改装工程·总装与调校' })).toEqual({
      tflops: 10,
      tops: 4,
    });
  });

  it('非工程类型 / 无命名分隔 / 未知工程 → undefined', () => {
    expect(engAssemblySpecFor(defs, { type: '研究', item: '轨道船坞·m.core' })).toBeUndefined();
    expect(engAssemblySpecFor(defs, { type: '工程', item: '轨道船坞' })).toBeUndefined();
    expect(engAssemblySpecFor(defs, { type: '工程', item: '未知工程·m.core' })).toBeUndefined();
  });
});

/* ═══════════════ ④ 引擎直喂端到端 ═══════════════ */

describe('V2-04 ④ 世界书 def 直喂 projectEngine 端到端', () => {
  it('startProjectV2：三门全过 → 根模块注资扣账+投影入队（D-C4 专属槽）', () => {
    if (!orbital) throw new Error('setup failed');
    // 轨道船坞 scope=theater（D21）：参与基地 ≥2，lead=beipo、根模块按模块序轮转落 bases[0]=beipo
    const r = startProjectV2(mkState(), orbital, { base: 'beipo', bases: ['beipo', 'south'] });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.message);
    expect(r.projectId).toBe('proj:轨道船坞@beipo');

    const next = r.next as TestState;
    // 首根注资扣账：100 万 − 20 万（m.core 模块注资额）
    expect(next.economy?.credits).toBe(800000);
    const proj = next.projects![0] as ProjectV2; // V2 实例（schema_version 2），收窄联合类型
    expect(proj.modules).toHaveLength(3);
    expect(proj.modules[0]).toMatchObject({ id: 'm.core', name: 'm.core', status: '进行中', base: 'beipo' });
    expect(proj.modules[1].status).toBe('未启动');

    // 投影入队：命名合同 ref·模块名 + D-C4 专属槽 + D12 min_days_lock + 注资记账
    expect(next.queues).toHaveLength(1);
    expect(next.queues[0]).toMatchObject({
      type: '工程',
      item: '轨道船坞·m.core',
      status: 'queued',
      cost_paid: true,
      min_days_lock: 5, // workload.min_days=5 日物理地板
      hold: false,
      lane: 'eng:eng.orbital',
    });
    expect(next.queues[0].total_minutes).toBe(10 * 1440); // workload.days=10 × 1440
  });

  it('investModule：前置模块未完工 → module_order 拒收（拓扑版 phase_order）', () => {
    if (!orbital) throw new Error('setup failed');
    const started = startProjectV2(mkState(), orbital, { base: 'beipo', bases: ['beipo', 'south'] });
    if (!started.ok) throw new Error(started.message);
    // m.gantry 双前置（m.core/m.dock）：m.core 进行中未完工 → 拒收
    const r = investModule(started.next as TestState, started.projectId, 'm.gantry', orbital);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('应拒收');
    expect(r.reason).toBe('module_order');
    expect(r.message).toContain('m.core');
  });

  it('settleWithTwoStage：V2 投影项经接缝吃算力加速＋D12 钳制（阶段二 1.5x、阶段一不吃）', () => {
    const base: ProjectQueueItem = {
      type: '工程',
      item: '轨道船坞·m.core', // 投影命名合同 ref·模块名（§3.3 裁量 j）
      base: 'beipo',
      progress: 0,
      eta: '',
      status: 'active',
      started_at: '2042-03-14 08:00',
      total_minutes: 4320, // 3 日标称（settleWithTwoStage 只读队列项自身值，不回查 def）
      spent_minutes: 0,
      qty: 1,
      qty_done: 0,
      cost_paid: true,
      min_days_lock: 1, // 1 日物理地板
      hold: false,
      lane: 'eng:eng.orbital',
    };
    const options = {
      assemblyFor: (t: { type: string; item: string }) => engAssemblySpecFor(defs, t),
      computeFor: () => ({ tflops: 1000, tops: 1000 }),
    };
    // 阶段一（spent=1000 < 2160 分界）：Δt=100 → 只吃基础 eff=1，不吃算力
    const p1 = settleWithTwoStage({ queues: [{ ...base, spent_minutes: 1000 }] }, 100, options);
    expect(p1.next.queues[0].spent_minutes).toBe(1100);
    // 阶段二：模块 workload 双轨需求（tflops=4/tops=2）满配 raw=2，lock=1 日钳 2160/1440=1.5 → +150
    const p2 = settleWithTwoStage({ queues: [{ ...base, spent_minutes: 2160 }] }, 100, options);
    expect(p2.next.queues[0].spent_minutes).toBe(2310);
    // 对照：算力缺席 → 恒 +100（算力永不作前置的镜像：无算力不停工）
    const noCompute = { ...options, computeFor: () => ({ tflops: 0, tops: 0 }) };
    const p3 = settleWithTwoStage({ queues: [{ ...base, spent_minutes: 2160 }] }, 100, noCompute);
    expect(p3.next.queues[0].spent_minutes).toBe(2260);
  });
});
