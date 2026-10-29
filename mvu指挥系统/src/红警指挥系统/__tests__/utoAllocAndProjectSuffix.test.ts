import { describe, expect, it } from 'vitest';
import type { ProjectDef, RetrofitDef } from '../core/catalog';
import {
  applyUnifiedCommands,
  fromEngineeringOrder,
  toEngineeringCommandText,
} from '../engines/dispatchBus';
import {
  alignEngineeringActionWithDispatchBus,
  applyEngOrders,
} from '../engines/engOrderBridge';
import {
  allocateProjectInstanceId,
  assignModuleBase,
  cancelProject,
  cancelProjectV2,
  investModule,
  projectionItemName,
  startPhase,
  startProject,
  startProjectV2,
  syncProjects,
  type ProjectQueueItem,
  type ProjectStateView,
  type ProjectV2Def,
} from '../engines/projectEngine';
import { isProjectV2 } from '../core/schema';
import { toUnifiedTasks } from '../engines/taskProjectionAdapter';
import { buildAllocateModuleOrder } from '../../中控悬浮窗/models/engCommands';

/* ═══════════════ 测试夹具 ═══════════════ */

const V1_DEF: RetrofitDef = {
  id: 'all.retrofit.grizzly_mod',
  kind: 'retrofit',
  name: '灰熊坦克现代化改装工程',
  faction: '盟军',
  tier: 'T2',
  category: '装甲改装',
  target: '灰熊主战坦克',
  grade: '中改',
  scope: 'base',
  research: '复合装甲冶金',
  phases: [
    {
      name: '方案与备料',
      cost: 400,
      workload: { days: 3, min_days: 2, tflops: 10, tops: 20 },
      resources: { nanites: 20 },
    },
    {
      name: '总装与调校',
      cost: 600,
      workload: { days: 5, min_days: 3, tflops: 15, tops: 30 },
      resources: { nanites: 30 },
    },
  ],
};

const V2_THEATER_DEF: ProjectV2Def & ProjectDef = {
  id: 'all.project.orbital_shipyard',
  kind: 'project',
  name: '轨道船坞仓段化工程',
  faction: '盟军',
  tier: 'T3',
  category: '巨构工程',
  grade: '巨构',
  scope: 'theater',
  requirements: {
    research: '轨道力学',
  },
  modules: [
    {
      id: 'core',
      name: '核心船坞桁架',
      cost: 1000,
      workload: { days: 5, min_days: 3, tflops: 50, tops: 50 },
      resources: { nanites: 30 },
      prereqs: [],
    },
    {
      id: 'arm_east',
      name: '东翼装配机械臂',
      cost: 800,
      workload: { days: 4, min_days: 2, tflops: 30, tops: 40 },
      resources: { nanites: 20 },
      prereqs: ['core'],
    },
    {
      id: 'dock_bay',
      name: '重型泊位舱段',
      cost: 900,
      workload: { days: 6, min_days: 3, tflops: 40, tops: 40 },
      resources: { nanites: 25 },
      prereqs: ['core'],
    },
  ],
};

const V2_BASE_DEF: ProjectV2Def = {
  ...V2_THEATER_DEF,
  id: 'all.project.local_reactor',
  name: '基地聚变堆扩建工程',
  scope: 'base',
};

function makeState(overrides: Partial<ProjectStateView> = {}): ProjectStateView {
  return {
    tech: { done: ['复合装甲冶金', '轨道力学'] },
    economy: {
      credits: 20000,
      resources: { nanites: { 标准纳米工料: 200 } },
    },
    bases: [
      {
        id: 'beipo',
        name: '北坡基地',
        buildings: [
          { name: '盟军建造厂', state: '运转' },
          { name: '航天发射中心', state: '运转' },
        ],
      },
      {
        id: 'nandao',
        name: '南岛基地',
        buildings: [
          { name: '盟军建造厂', state: '运转' },
          { name: '航天发射中心', state: '运转' },
        ],
      },
      {
        id: 'xigu',
        name: '西谷基地',
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

function markQueueDone(state: ProjectStateView, idx: number): ProjectStateView {
  const queues = (state.queues ?? []).map((q, i) =>
    i === idx ? ({ ...q, progress: 100, status: 'done' } as ProjectQueueItem) : q,
  );
  return { ...state, queues };
}

/* ═══════════════ 1. UX-SCHED-01 · 同名工程重立 ID 期次后缀（D-TH-1 / P2-⑧） ═══════════════ */

describe('UX-SCHED-01 · 同名工程重立 ID 期次后缀（allocateProjectInstanceId）', () => {
  it('allocateProjectInstanceId：首次返回基础 ID，已存在时依次分配 #2、#3', () => {
    const defName = '灰熊坦克现代化改装工程';
    const leadBase = 'beipo';
    expect(allocateProjectInstanceId([], defName, leadBase)).toBe('proj:灰熊坦克现代化改装工程@beipo');

    const projects1 = [{ id: 'proj:灰熊坦克现代化改装工程@beipo', ref: defName, lead_base: leadBase }];
    expect(allocateProjectInstanceId(projects1, defName, leadBase)).toBe('proj:灰熊坦克现代化改装工程@beipo#2');

    const projects2 = [
      ...projects1,
      { id: 'proj:灰熊坦克现代化改装工程@beipo#2', ref: defName, lead_base: leadBase },
    ];
    expect(allocateProjectInstanceId(projects2, defName, leadBase)).toBe('proj:灰熊坦克现代化改装工程@beipo#3');
  });

  it('V1 工程同基地取消/完工后再次立项：自动生成 #2、#3 实例 ID，且新实例可正常注资推进', () => {
    // 第 1 期：立项 → 取消
    const r1 = startProject(makeState(), V1_DEF, { base: 'beipo' });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.projectId).toBe('proj:灰熊坦克现代化改装工程@beipo');

    const c1 = cancelProject(r1.next, r1.projectId);
    expect(c1.ok).toBe(true);
    if (!c1.ok) return;

    // 第 2 期：重立同名工程 → 生成 #2，且完成第 0 阶段后可正常注资第 1 阶段直至完工
    const r2 = startProject(c1.next, V1_DEF, { base: 'beipo' });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.projectId).toBe('proj:灰熊坦克现代化改装工程@beipo#2');

    // 首期投影项完工回写
    const afterPhase0 = syncProjects(markQueueDone(r2.next, 1)).next;
    const p2Phase1 = startPhase(afterPhase0, r2.projectId, 1, V1_DEF);
    expect(p2Phase1.ok).toBe(true);
    if (!p2Phase1.ok) return;

    // 次期完工回写 → 第 2 期工程整体完工
    const afterPhase1 = syncProjects(markQueueDone(p2Phase1.next, 2)).next;
    const proj2 = afterPhase1.projects?.find(p => p.id === r2.projectId);
    expect(proj2?.status).toBe('完工');

    // 第 3 期：再次重立同名工程 → 生成 #3 且首期正常入队
    const r3 = startProject(afterPhase1, V1_DEF, { base: 'beipo' });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.projectId).toBe('proj:灰熊坦克现代化改装工程@beipo#3');
    expect(r3.next.projects).toHaveLength(3);
  });

  it('V2 仓段化工程同基地取消后重立：自动生成 #2、#3 且新实例可正常模块注资推进', () => {
    const r1 = startProjectV2(makeState(), V2_THEATER_DEF, {
      base: 'beipo',
      bases: ['beipo', 'nandao'],
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.projectId).toBe('proj:轨道船坞仓段化工程@beipo');

    const c1 = cancelProjectV2(r1.next, r1.projectId, V2_THEATER_DEF);
    expect(c1.ok).toBe(true);
    if (!c1.ok) return;

    // 第二次立项 → #2
    const r2 = startProjectV2(c1.next, V2_THEATER_DEF, {
      base: 'beipo',
      bases: ['beipo', 'nandao'],
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.projectId).toBe('proj:轨道船坞仓段化工程@beipo#2');

    // 根模块完工后注资子模块 arm_east
    const afterRoot = syncProjects(markQueueDone(r2.next, 1)).next;
    const inv2 = investModule(afterRoot, r2.projectId, 'arm_east', V2_THEATER_DEF);
    expect(inv2.ok).toBe(true);
    if (!inv2.ok) return;

    // 取消 #2 后第三次立项 → #3
    const c2 = cancelProjectV2(inv2.next, r2.projectId, V2_THEATER_DEF);
    expect(c2.ok).toBe(true);
    if (!c2.ok) return;

    const r3 = startProjectV2(c2.next, V2_THEATER_DEF, {
      base: 'beipo',
      bases: ['beipo', 'nandao'],
    });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.projectId).toBe('proj:轨道船坞仓段化工程@beipo#3');
  });
});

/* ═══════════════ 2. UTO-ALLOC-01 · V2 巨构跨基地模块指派闭环 ═══════════════ */

describe('UTO-ALLOC-01 · V2 巨构跨基地模块指派（assignModuleBase / taskProjectionAdapter / dispatchBus）', () => {
  it('assignModuleBase：对 scope === "theater" 且 bases.length >= 2 的未启动模块成功指派承建基地，并联动后续注资', () => {
    const started = startProjectV2(makeState(), V2_THEATER_DEF, {
      base: 'beipo',
      bases: ['beipo', 'nandao'],
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    // 指派未启动模块 arm_east 到联建基地 nandao
    const assigned = assignModuleBase(started.next, {
      projectRef: started.projectId,
      moduleId: 'arm_east',
      targetBase: 'nandao',
      reason: '南岛轨道泊位空闲',
    });
    expect(assigned.ok).toBe(true);
    expect(assigned.module?.base).toBe('nandao');
    expect(assigned.module?.assigned_base).toBe('nandao');

    // 支持按模块中文名指派 dock_bay 到 beipo
    const assigned2 = assignModuleBase(assigned.next!, {
      projectRef: started.projectId,
      moduleId: '重型泊位舱段',
      targetBase: 'beipo',
    });
    expect(assigned2.ok).toBe(true);
    expect(assigned2.module?.base).toBe('beipo');

    // 根模块完工后，对 arm_east 注资（不额外传 options.base），自动按已指派基地 nandao 投影入队
    const afterRootDone = syncProjects(markQueueDone(assigned2.next!, 0)).next;
    const invested = investModule(afterRootDone, started.projectId, 'arm_east', V2_THEATER_DEF);
    expect(invested.ok).toBe(true);
    if (!invested.ok) return;

    const armQueue = invested.next.queues?.find(
      q => q.item === projectionItemName(V2_THEATER_DEF.name, '东翼装配机械臂'),
    );
    expect(armQueue?.base).toBe('nandao');
  });

  it('assignModuleBase：对非联建基地、scope === "base" 工程、已启动模块准确拒绝', () => {
    const theaterStarted = startProjectV2(makeState(), V2_THEATER_DEF, {
      base: 'beipo',
      bases: ['beipo', 'nandao'],
    });
    expect(theaterStarted.ok).toBe(true);
    if (!theaterStarted.ok) return;

    // 1. xigu 不在联建基地列表 ['beipo', 'nandao'] 中 → 拒收
    const nonMemberRes = assignModuleBase(theaterStarted.next, {
      projectRef: theaterStarted.projectId,
      moduleId: 'arm_east',
      targetBase: 'xigu',
    });
    expect(nonMemberRes.ok).toBe(false);
    expect(nonMemberRes.error).toContain('联建基地列表');

    // 2. 已在进行中的根模块 core → 拒收
    const activeModRes = assignModuleBase(theaterStarted.next, {
      projectRef: theaterStarted.projectId,
      moduleId: 'core',
      targetBase: 'nandao',
    });
    expect(activeModRes.ok).toBe(false);
    expect(activeModRes.error).toContain('未启动');

    // 3. scope === 'base' 的单基地 V2 工程 → 拒收
    const baseStarted = startProjectV2(makeState(), V2_BASE_DEF, {
      base: 'beipo',
    });
    expect(baseStarted.ok).toBe(true);
    if (!baseStarted.ok) return;

    const baseScopeRes = assignModuleBase(baseStarted.next, {
      projectRef: baseStarted.projectId,
      moduleId: 'arm_east',
      targetBase: 'beipo',
    });
    expect(baseScopeRes.ok).toBe(false);
    expect(baseScopeRes.error).toContain('theater');
  });

  it('taskProjectionAdapter + dispatchBus + engOrderBridge 执行 Allocate 跨基地指派完整闭环', () => {
    const started = startProjectV2(makeState(), V2_THEATER_DEF, {
      base: 'beipo',
      bases: ['beipo', 'nandao'],
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    // 1. 投影 UnifiedTask：未启动模块 arm_east 标记 canAllocate: true 且携带 allocatableBases
    const tasks = toUnifiedTasks(started.next, {
      buildings: [],
      productions: [],
      researches: [],
      retrofits: [V1_DEF],
      projects: [V2_THEATER_DEF],
      factionDefs: [],
    });
    const armTask = tasks.find(t => t.metadata?.moduleId === 'arm_east');
    const coreTask = tasks.find(t => t.metadata?.moduleId === 'core');
    expect(armTask).toBeDefined();
    expect(armTask?.status).toBe('draft');
    expect(armTask?.metadata?.canAllocate).toBe(true);
    expect(armTask?.metadata?.allocatableBases).toEqual(['beipo', 'nandao']);
    // 已在进行中的 core 模块不可 Allocate
    expect(coreTask?.metadata?.canAllocate).toBeUndefined();

    // 2. 经 engCommands 与 engOrderBridge 对齐生成指派指令并转译为 Allocate 命令
    const cmdText = buildAllocateModuleOrder(started.projectId, '东翼装配机械臂', 'nandao');
    expect(cmdText).toBe(`【工程指令】指派「${started.projectId}」东翼装配机械臂，承建基地：nandao`);

    const aligned = alignEngineeringActionWithDispatchBus(
      {
        verb: '指派',
        projectId: started.projectId,
        moduleId: 'arm_east',
        moduleName: '东翼装配机械臂',
        baseId: 'nandao',
      },
      tasks,
    );
    expect(aligned.commandType).toBe('Allocate');
    expect(aligned.commandText).toBe(cmdText);
    expect(toEngineeringCommandText(aligned.commands[0], tasks)).toBe(cmdText);

    // 3. 在 dispatchBus 中执行 Allocate：合法联建基地 nandao 通过，非联建基地 xigu 被拒收
    const busOk = applyUnifiedCommands(tasks, [], aligned.commands);
    expect(busOk.rejected).toHaveLength(0);
    const updatedArmTask = busOk.nextTasks.find(t => t.id === armTask!.id);
    expect(updatedArmTask?.leadBaseId).toBe('nandao');
    expect(updatedArmTask?.metadata?.base).toBe('nandao');
    expect(updatedArmTask?.laneKey).toBe('nandao eng:eng.orbital');

    const invalidCmds = fromEngineeringOrder(
      { verb: '指派', id: started.projectId, module: 'arm_east', base: 'xigu' },
      tasks,
    );
    const busRej = applyUnifiedCommands(tasks, [], invalidCmds);
    expect(busRej.rejected).toHaveLength(1);
    expect(busRej.rejected[0].reason).toBe('invalid_scope');

    // 4. 在 engOrderBridge.applyEngOrders 中执行 verb='指派' 与 action='allocate' 写回工程模块账本
    const bridgeRes = applyEngOrders(
      started.next,
      [
        { verb: '指派', id: started.projectId, module: 'arm_east', base: 'nandao' },
        { action: 'allocate', id: started.projectId, module: 'dock_bay', targetBase: 'beipo' },
      ],
      [V1_DEF],
      [V2_THEATER_DEF],
    );
    expect(bridgeRes.quarantine).toHaveLength(0);
    const updatedProj = bridgeRes.next.projects?.[0];
    expect(updatedProj && isProjectV2(updatedProj)).toBe(true);
    if (updatedProj && isProjectV2(updatedProj)) {
      const armMod = updatedProj.modules.find(m => m.id === 'arm_east');
      const dockMod = updatedProj.modules.find(m => m.id === 'dock_bay');
      expect(armMod?.base).toBe('nandao');
      expect(dockMod?.base).toBe('beipo');
    }
  });
});

describe.each(['direct', 'bridge'] as const)('ENG03-03 模块定位（%s）', route => {
  function allocate(state: ProjectStateView, moduleId: string) {
    const projectRef = state.projects![0].id;
    if (route === 'direct') {
      return assignModuleBase(state, { projectRef, moduleId, targetBase: 'nandao' });
    }
    const result = applyEngOrders(state, [
      { verb: '指派', id: projectRef, module: moduleId, base: 'nandao' },
    ], [], []);
    return { ok: result.quarantine.length === 0, next: result.next };
  }

  it.each([
    { reverse: false, activeA: false },
    { reverse: true, activeA: false },
    { reverse: false, activeA: true },
    { reverse: true, activeA: true },
  ])('ID优先：reverse=$reverse，A已启动=$activeA 时仍选B', ({ reverse, activeA }) => {
    const root = V2_THEATER_DEF.modules[0];
    const a = { ...root, id: 'alpha', name: 'beta', prereqs: [] };
    const b = { ...root, id: 'beta', name: '居住舱', prereqs: ['alpha'] };
    const pair = reverse ? [b, a] : [a, b];
    const def = { ...V2_THEATER_DEF, modules: activeA ? pair : [root, ...pair] };
    const started = startProjectV2(makeState(), def, { base: 'beipo', bases: ['beipo', 'nandao'] });
    if (!started.ok) throw new Error(started.message);
    const project = started.next.projects![0];
    if (!isProjectV2(project)) throw new Error('应为V2');
    const aBefore = { ...project.modules.find(m => m.id === 'alpha')! };
    const result = allocate(started.next, 'beta');
    expect(result.ok).toBe(true);
    const assigned = result.next!.projects![0];
    if (!isProjectV2(assigned)) throw new Error('应为V2');
    expect(assigned.modules.find(m => m.id === 'beta')).toMatchObject({ base: 'nandao', status: '未启动' });
    expect(assigned.modules.find(m => m.id === 'alpha')).toEqual(aBefore);
  });

  it('名称多义拒绝不改账，明确ID成功', () => {
    const root = V2_THEATER_DEF.modules[0];
    const def = {
      ...V2_THEATER_DEF,
      modules: [root, ...['alpha', 'beta'].map(id => ({
        ...root, id, name: '居住舱', prereqs: ['core'],
      }))],
    };
    const started = startProjectV2(makeState(), def, { base: 'beipo', bases: ['beipo', 'nandao'] });
    if (!started.ok) throw new Error(started.message);
    const rejected = allocate(started.next, '居住舱');
    expect(rejected.ok).toBe(false);
    const project = started.next.projects![0];
    if (!isProjectV2(project)) throw new Error('应为V2');
    expect(project.modules.slice(1).map(m => m.base)).toEqual(['', '']);
    const accepted = allocate(started.next, 'beta');
    expect(accepted.ok).toBe(true);
    const assigned = accepted.next!.projects![0];
    if (!isProjectV2(assigned)) throw new Error('应为V2');
    expect(assigned.modules.find(m => m.id === 'beta')!.base).toBe('nandao');
    expect(assigned.modules.find(m => m.id === 'alpha')!.base).toBe('');
  });
});
