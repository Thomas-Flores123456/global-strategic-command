/**
 * taskProjectionAdapter.test.ts —— UTO-PROJ-01 验收测试
 *
 * 真源：docs/project/plans/通用任务编排器MVP任务包.md §2.2 / §3.3 / §6（任务卡 UTO-PROJ-01）
 * 覆盖：
 * ① 阶段一只读铁律：state（bases/queues/projects）、catalog、lanes 深冻结（Object.freeze）
 *    零抛错、零突变；修改返回 UnifiedTask[] 不回渗入参；
 * ② 常规队列项全领域映射：建造（catalog 显式 lane）、生产（多批次 qty/qty_done ＋ assembly
 *    req_nanites 提取）、研究（scope theater ＋ workload tflops/tops 提取）、改装（推导装备线）、
 *    hold=true → held、done → completed 状态归一；
 * ③ V1 多阶段改装工程投影与防双影：完工阶段（静态工期回填）、在队阶段（吸收 queues[k] 进度，
 *    零 "task:queue:k" 双影）、未启动阶段（draft ＋ dependsOn 链 ＋ 静态工期/算力/纳米回填）；
 * ④ V2 轨道船坞多模块并行与 DAG 拓扑：core 完工、hab/dock 并行在队（各自吸收队列项，零双影）、
 *    solar 未启动（draft，dependsOn 指向 core）；
 * ⑤ 指针漂移防御（syncWarn）：queue_index 越界（999）→ queue_index_out_of_bounds；
 *    指向「犀牛坦克」（张冠李戴）→ queue_item_mismatch，且被错误指向的队列项完好保留为独立任务；
 * ⑥ 兜底与基线：空 state、catalog/lanes 缺席、纯函数导出体审查（零 Pinia/Vue/宿主 API/DOM）。
 */

import { describe, expect, it } from 'vitest';
import type { EffectiveCatalog } from '../core/catalogEffective';
import * as adapterExports from '../engines/taskProjectionAdapter';
import { toUnifiedTasks, type ProjectionStateInput } from '../engines/taskProjectionAdapter';
import type { Project, ProjectV1, ProjectV2 } from '../core/schema';
import type { LaneStationView, UnifiedTask } from '../engines/taskOrchestrator';
import type { TransactionItem } from '../engines/transactionEngine';

/* ═══════════════ 测试工具 ═══════════════ */

/** 递归深冻结（含嵌套对象/数组；函数跳过），用于入参不可变性硬核断言 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** 队列账本元素视图（schema.QueueItem v2 输出 ≡ TransactionItem ＋ 可选 lane） */
type QueueView = TransactionItem & { lane?: string };

/** 造一条标准 v2 队列项（支持可选 lane 字段） */
function makeQueue(overrides: Partial<QueueView> = {}): QueueView {
  return {
    type: '生产',
    item: '犀牛主战坦克',
    base: '1号基地',
    progress: 0,
    eta: '',
    status: 'queued',
    started_at: '',
    total_minutes: 1440,
    spent_minutes: 0,
    qty: 1,
    qty_done: 0,
    cost_paid: true,
    min_days_lock: 0,
    hold: false,
    ...overrides,
  };
}

/** 造一个基地快照 */
function makeBase(name: string, buildings: string[]) {
  return { id: name, name, buildings: buildings.map(b => ({ name: b, state: '建成' })) };
}

/**
 * 构造覆盖本测试全部场景的有效目录：
 * - 生产：犀牛（显式 lane.vehicle_land ＋ assembly req_nanites）；
 * - 研究：复合反应装甲工学（line 陆地载具 ＋ workload tflops/tops passthrough）；
 * - 建造：爱国者防空导弹（catalog 显式 lane.defense）；
 * - 改装 V1 工程：灰熊坦克现代化改装工程（3 阶段静态 workload/cost/resources.nanites）；
 * - 仓段 V2 工程：轨道船坞（core/hab/dock/solar 模块拓扑 prereqs）。
 */
function makeCatalog(): EffectiveCatalog {
  return {
    researches: [{ name: '复合反应装甲工学', line: '陆地载具', workload: { tflops: 120, tops: 30 } }],
    buildings: [{ name: '爱国者防空导弹', lane: 'lane.defense' }],
    productions: [
      {
        name: '犀牛主战坦克',
        lane: 'lane.vehicle_land',
        assembly: { t_mat: 100, t_asm: 80, req_nanites: 50 },
      },
      { name: '动员步兵班' },
    ],
    retrofits: [
      {
        kind: 'retrofit',
        name: '灰熊坦克现代化改装工程',
        research: '混合动力装甲工学',
        grade: '大改',
        desc: '混动APU+主动防御系统+车际数据网络。',
        phases: [
          {
            name: '火控换装',
            workload: { days: 2, min_days: 1, tflops: 20, tops: 5 },
            cost: 100,
            resources: { nanites: 10 },
          },
          { name: '动力包换装', workload: { days: 3, min_days: 2 }, cost: 150 },
          {
            name: '装甲强化',
            workload: { days: 4, min_days: 2, tflops: 10 },
            cost: 200,
            resources: { nanites: 20 },
          },
        ],
      } as never,
    ],
    projects: [
      {
        kind: 'project',
        id: 'all.project.orbital_shipyard',
        name: '轨道船坞',
        desc: '轨道船坞仓段化建造工程。',
        modules: [
          { id: 'core', name: '龙骨核心', cost: 500, workload: { days: 10, min_days: 5, tflops: 200 }, prereqs: [] },
          { id: 'hab', name: '居住舱段', cost: 300, workload: { days: 8, min_days: 3 }, prereqs: ['core'] },
          { id: 'dock', name: '舾装船坞', cost: 400, workload: { days: 12, min_days: 6, tops: 40 }, prereqs: ['core'] },
          { id: 'solar', name: '太阳能帆板', cost: 200, workload: { days: 5, min_days: 2 }, prereqs: ['core'] },
        ],
      } as never,
    ],
    factionDefs: [],
  } as unknown as EffectiveCatalog;
}

/** V1 三阶段改装工程实例（阶段 0 完工、阶段 1 在队 queues[1]、阶段 2 未启动） */
function makeProjectV1(queueIndexOfPhase1 = 1): ProjectV1 {
  return {
    id: 'proj:grizzly@1号基地',
    ref: '灰熊坦克现代化改装工程',
    scope: 'base',
    bases: ['1号基地'],
    lead_base: '1号基地',
    grade: '大改',
    status: '在建',
    outcome: { type: 'mark' },
    schema_version: 1,
    phases: [
      { idx: 0, name: '火控换装', status: '完工', queue_index: null },
      { idx: 1, name: '动力包换装', status: '进行中', queue_index: queueIndexOfPhase1 },
      { idx: 2, name: '装甲强化', status: '未启动', queue_index: null },
    ],
  };
}

/** V2 轨道船坞工程实例（core 完工、hab/dock 并行在队 queues[2]/queues[3]、solar 未启动） */
function makeProjectV2(): ProjectV2 {
  return {
    id: 'proj:orbital@1号基地',
    ref: '轨道船坞',
    scope: 'base',
    bases: ['1号基地'],
    lead_base: '1号基地',
    grade: '巨构',
    status: '在建',
    outcome: { type: 'mark' },
    schema_version: 2,
    modules: [
      { id: 'core', name: '龙骨核心', status: '完工', base: '', queue_index: null },
      { id: 'hab', name: '居住舱段', status: '进行中', base: '', queue_index: 2 },
      { id: 'dock', name: '舾装船坞', status: '进行中', base: '', queue_index: 3 },
      { id: 'solar', name: '太阳能帆板', status: '未启动', base: '', queue_index: null },
    ],
  };
}

/** 全景队列账本（0 犀牛生产｜1 V1 阶段1 投影｜2 V2 hab 投影｜3 V2 dock 投影｜4 研究｜5 建造｜6 hold｜7 改装 done） */
function makeFullQueues(): QueueView[] {
  return [
    makeQueue({
      type: '生产',
      item: '犀牛主战坦克',
      status: 'active',
      total_minutes: 1440,
      spent_minutes: 360,
      qty: 4,
      qty_done: 1,
    }),
    makeQueue({
      type: '工程',
      item: '灰熊坦克现代化改装工程·动力包换装',
      status: 'active',
      total_minutes: 4320,
      spent_minutes: 720,
      min_days_lock: 2,
      started_at: '第7日 08:00',
      eta: '第10日 08:00',
      lane: 'eng:eng.main',
    }),
    makeQueue({
      type: '工程',
      item: '轨道船坞·居住舱段',
      status: 'active',
      total_minutes: 11520,
      spent_minutes: 2000,
      min_days_lock: 3,
      started_at: '第7日 08:00',
      lane: 'eng:eng.orbital',
    }),
    makeQueue({
      type: '工程',
      item: '轨道船坞·舾装船坞',
      status: 'queued',
      total_minutes: 17280,
      spent_minutes: 0,
      min_days_lock: 6,
      lane: 'eng:eng.orbital',
    }),
    makeQueue({
      type: '研究',
      item: '复合反应装甲工学',
      base: '',
      status: 'active',
      total_minutes: 2880,
      spent_minutes: 960,
      started_at: '第6日 00:00',
    }),
    makeQueue({ type: '建造', item: '爱国者防空导弹', status: 'queued', total_minutes: 2160 }),
    makeQueue({ type: '生产', item: '动员步兵班', status: 'queued', hold: true, qty: 2, qty_done: 0 }),
    makeQueue({
      type: '改装',
      item: '基洛夫空艇挂架改装',
      status: 'done',
      total_minutes: 5760,
      spent_minutes: 5760,
      qty_done: 1,
    }),
  ];
}

/** 全景基地快照（覆盖生产/建造锚定建筑与 V2 轨道槽锚定建筑） */
function makeFullBases() {
  return [makeBase('1号基地', ['盟军建造厂', '战车工厂', '矿石精炼厂', '航天发射中心', '战地维修所'])];
}

/** 工位快照（lanes 辅助对齐通道用；覆盖三大领域） */
function makeLanes(): LaneStationView[] {
  return [
    {
      laneKey: '1号基地 lane.vehicle_land',
      domain: 'production',
      displayName: '陆地载具生产线',
      baseId: '1号基地',
      capacity: 2,
      accelMultiplier: 1.0,
      locked: false,
    },
    {
      laneKey: 'research:slot.vehicle',
      domain: 'research',
      displayName: '载具槽',
      baseId: undefined,
      capacity: 1,
      accelMultiplier: 1.0,
      locked: false,
    },
    {
      laneKey: '1号基地 eng:eng.main',
      domain: 'retrofit',
      displayName: '通用工程槽',
      baseId: '1号基地',
      capacity: 1,
      accelMultiplier: 1.0,
      locked: false,
    },
    {
      laneKey: '1号基地 eng:eng.orbital',
      domain: 'retrofit',
      displayName: '轨道组装泊位',
      baseId: '1号基地',
      capacity: 1,
      accelMultiplier: 1.0,
      locked: false,
    },
  ];
}

/** 全景投影输入（V1 + V2 双工程 + 8 条队列） */
function makeFullState(opts: { projects?: Project[]; queues?: QueueView[] } = {}): ProjectionStateInput {
  return {
    bases: makeFullBases(),
    queues: opts.queues ?? makeFullQueues(),
    projects: opts.projects ?? [makeProjectV1(), makeProjectV2()],
  };
}

/** 按 id 检索任务（缺考即 undefined，断言失败信息更聚焦） */
function taskById(tasks: UnifiedTask[], id: string): UnifiedTask | undefined {
  return tasks.find(t => t.id === id);
}

/* ═══════════════ ① 阶段一只读铁律 ═══════════════ */

describe('taskProjectionAdapter · 阶段一只读铁律', () => {
  it('state/catalog/lanes 深冻结（Object.freeze）下调用零抛错、零突变', () => {
    const state = deepFreeze(makeFullState());
    const catalog = deepFreeze(makeCatalog());
    const lanes = deepFreeze(makeLanes());
    const snapshot = JSON.stringify({ state, catalog, lanes });

    let tasks: UnifiedTask[] = [];
    expect(() => {
      tasks = toUnifiedTasks(state, catalog, lanes);
    }).not.toThrow();

    // 零突变：调用前后入参逐字节恒等
    expect(JSON.stringify({ state, catalog, lanes })).toBe(snapshot);
    // 投影完整产出（V1 root+3 阶段 ＋ V2 root+4 模块 ＋ 8 队列项 - 3 已被领用 = 14）
    expect(tasks).toHaveLength(14);
  });

  it('修改返回 UnifiedTask[] 不回渗入参（含嵌套 workload/topology/metadata/数组）', () => {
    const queues = makeFullQueues();
    const projects: Project[] = [makeProjectV1(), makeProjectV2()];
    const state = makeFullState({ projects });
    const snapshot = JSON.stringify({ queues, projects });

    const tasks = toUnifiedTasks(state, makeCatalog(), makeLanes());

    // 返回体为全新构造：不与入参共享任何引用
    expect(tasks[0]).not.toBe(projects[0]);
    const root = taskById(tasks, 'task:proj:proj:grizzly@1号基地');
    expect(root?.participatingBases).not.toBe((projects[0] as ProjectV1).bases);
    expect(root?.topology?.subTaskIds?.length).toBe(3);

    // 恶意改写返回体：入参纹丝不动
    tasks[0].name = 'tampered';
    tasks[0].status = 'cancelled';
    tasks[0].workload.totalMinutes = 999999;
    root?.topology?.subTaskIds?.push('task:injected');
    root?.participatingBases?.push('幽灵基地');
    tasks.push({ ...tasks[0], id: 'task:injected' });

    expect(JSON.stringify({ queues, projects })).toBe(snapshot);
  });

  it('无 fromUnifiedTasks 反向写回通道（导出面单向只读红线）', () => {
    // ProjectionStateInput 为纯类型接口（零运行时导出）；唯一运行时导出即 toUnifiedTasks
    expect(Object.keys(adapterExports).sort()).toEqual(['toUnifiedTasks']);
    expect(typeof adapterExports.toUnifiedTasks).toBe('function');
    expect((adapterExports as Record<string, unknown>).fromUnifiedTasks).toBeUndefined();
  });
});

/* ═══════════════ ② 常规队列项全领域映射 ═══════════════ */

describe('taskProjectionAdapter · 常规队列项全领域映射', () => {
  it('生产：多批次 qty/qty_done ＋ catalog assembly req_nanites 提取 ＋ 显式 lane', () => {
    const tasks = toUnifiedTasks({ bases: makeFullBases(), queues: [makeFullQueues()[0]] }, makeCatalog(), makeLanes());
    const rhino = taskById(tasks, 'task:queue:0');
    expect(rhino).toBeDefined();
    expect(rhino?.domain).toBe('production');
    expect(rhino?.scope).toBe('base');
    expect(rhino?.status).toBe('active');
    expect(rhino?.name).toBe('犀牛主战坦克');
    expect(rhino?.leadBaseId).toBe('1号基地');
    expect(rhino?.laneKey).toBe('1号基地 lane.vehicle_land');
    expect(rhino?.workload).toMatchObject({ totalMinutes: 1440, spentMinutes: 360, naniteCost: 50 });
    expect(rhino?.batch).toEqual({ totalQty: 4, completedQty: 1 });
    expect(rhino?.costPaid).toBe(true);
    expect(rhino?.metadata).toMatchObject({ sourceKind: 'queue', queueIndex: 0, rawType: '生产' });
  });

  it('研究：scope theater ＋ workload tflops/tops 提取 ＋ research laneKey', () => {
    const tasks = toUnifiedTasks({ bases: makeFullBases(), queues: [makeFullQueues()[4]] }, makeCatalog(), makeLanes());
    const research = taskById(tasks, 'task:queue:0'); // 单项数组下标 0
    expect(research?.domain).toBe('research');
    expect(research?.scope).toBe('theater');
    expect(research?.status).toBe('active');
    expect(research?.laneKey).toBe('research:slot.vehicle');
    expect(research?.workload).toMatchObject({
      totalMinutes: 2880,
      spentMinutes: 960,
      tflopsRequired: 120,
      topsRequired: 30,
    });
    expect(research?.metadata).toMatchObject({
      sourceKind: 'queue',
      queueIndex: 0,
      rawType: '研究',
      startedAt: '第6日 00:00',
    });
    expect(research?.leadBaseId).toBeUndefined();
  });

  it('建造：catalog 显式 lane.defense → construction 域', () => {
    const tasks = toUnifiedTasks({ bases: makeFullBases(), queues: [makeFullQueues()[5]] }, makeCatalog(), makeLanes());
    const building = taskById(tasks, 'task:queue:0'); // 单项数组下标 0
    expect(building?.domain).toBe('construction');
    expect(building?.scope).toBe('base');
    expect(building?.status).toBe('queued');
    expect(building?.laneKey).toBe('1号基地 lane.defense');
  });

  it('改装：类型推导恒落装备线；done → completed 终态归一', () => {
    const tasks = toUnifiedTasks({ bases: makeFullBases(), queues: [makeFullQueues()[7]] }, makeCatalog(), makeLanes());
    const retrofit = taskById(tasks, 'task:queue:0'); // 单项数组下标 0
    expect(retrofit?.domain).toBe('retrofit');
    expect(retrofit?.status).toBe('completed');
    expect(retrofit?.laneKey).toBe('1号基地 lane.equipment');
    expect(retrofit?.workload).toMatchObject({ totalMinutes: 5760, spentMinutes: 5760 });
  });

  it('hold=true → held 防御归一（queued + hold 不参与升格）', () => {
    const tasks = toUnifiedTasks({ bases: makeFullBases(), queues: [makeFullQueues()[6]] }, makeCatalog(), makeLanes());
    expect(taskById(tasks, 'task:queue:0')?.status).toBe('held'); // 单项数组下标 0
  });
});

/* ═══════════════ ③ V1 多阶段改装工程投影与防双影 ═══════════════ */

describe('taskProjectionAdapter · V1 多阶段改装工程投影与防双影', () => {
  const tasks = toUnifiedTasks(makeFullState(), makeCatalog(), makeLanes());
  const rootId = 'task:proj:proj:grizzly@1号基地';

  it('父级总成容器：retrofit 域 ＋ subTaskIds 收录全部阶段 ＋ workload 汇总', () => {
    const root = taskById(tasks, rootId);
    expect(root).toBeDefined();
    expect(root?.domain).toBe('retrofit');
    expect(root?.name).toBe('灰熊坦克现代化改装工程');
    expect(root?.scope).toBe('base');
    expect(root?.leadBaseId).toBe('1号基地');
    expect(root?.participatingBases).toEqual(['1号基地']);
    expect(root?.status).toBe('active'); // 工程在建
    expect(root?.metadata).toMatchObject({ sourceKind: 'project_root', projectId: 'proj:grizzly@1号基地' });
    expect(root?.topology?.subTaskIds).toEqual([`${rootId}:phase:0`, `${rootId}:phase:1`, `${rootId}:phase:2`]);
    // 汇总：火控 2d + 动力 3d(实况 4320) + 装甲 4d → 2880 + 4320 + 5760 = 12960
    expect(root?.workload.totalMinutes).toBe(12960);
    expect(root?.workload.spentMinutes).toBe(720);
  });

  it('阶段 0（完工、指针已释放）：completed ＋ 静态工期/算力/纳米回填', () => {
    const phase0 = taskById(tasks, `${rootId}:phase:0`);
    expect(phase0).toBeDefined();
    expect(phase0?.domain).toBe('retrofit');
    expect(phase0?.name).toBe('灰熊坦克现代化改装工程·火控换装');
    expect(phase0?.status).toBe('completed');
    expect(phase0?.workload).toMatchObject({
      totalMinutes: 2880,
      spentMinutes: 0,
      minDaysLock: 1,
      tflopsRequired: 20,
      topsRequired: 5,
      naniteCost: 10,
    });
    expect(phase0?.topology).toMatchObject({ parentId: rootId, dependsOn: [] });
    expect(phase0?.metadata).toMatchObject({
      sourceKind: 'project_phase',
      projectId: 'proj:grizzly@1号基地',
      phaseIdx: 0,
    });
    expect(phase0?.metadata?.queueIndex).toBeUndefined();
    expect(phase0?.leadBaseId).toBe('1号基地'); // phaseBase 属地
    expect(phase0?.laneKey).toBe('1号基地 eng:eng.main');
  });

  it('阶段 1（在队）：吸收 queues[1] 进度合一，零 "task:queue:1" 双影', () => {
    const phase1 = taskById(tasks, `${rootId}:phase:1`);
    expect(phase1).toBeDefined();
    expect(phase1?.status).toBe('active'); // 跟随队列项 active
    expect(phase1?.name).toBe('灰熊坦克现代化改装工程·动力包换装');
    expect(phase1?.workload).toMatchObject({ totalMinutes: 4320, spentMinutes: 720, minDaysLock: 2 });
    expect(phase1?.costPaid).toBe(true);
    expect(phase1?.laneKey).toBe('1号基地 eng:eng.main');
    expect(phase1?.topology).toMatchObject({ parentId: rootId, dependsOn: [`${rootId}:phase:0`] });
    expect(phase1?.metadata).toMatchObject({
      sourceKind: 'project_phase',
      projectId: 'proj:grizzly@1号基地',
      phaseIdx: 1,
      queueIndex: 1,
      rawType: '工程',
      startedAt: '第7日 08:00',
      eta: '第10日 08:00',
    });
    // 🔴 防双影铁律：queues[1] 已被阶段 1 领用，绝不重复产出游离节点
    expect(taskById(tasks, 'task:queue:1')).toBeUndefined();
  });

  it('阶段 2（未启动）：draft ＋ dependsOn 指向阶段 1 ＋ 静态工期与算力回填', () => {
    const phase2 = taskById(tasks, `${rootId}:phase:2`);
    expect(phase2).toBeDefined();
    expect(phase2?.status).toBe('draft');
    expect(phase2?.workload).toMatchObject({
      totalMinutes: 5760,
      spentMinutes: 0,
      minDaysLock: 2,
      tflopsRequired: 10,
      naniteCost: 20,
    });
    expect(phase2?.topology).toMatchObject({ parentId: rootId, dependsOn: [`${rootId}:phase:1`] });
    expect(phase2?.metadata?.queueIndex).toBeUndefined();
    expect(phase2?.laneKey).toBe('1号基地 eng:eng.main');
  });
});

/* ═══════════════ ④ V2 轨道船坞多模块并行与 DAG 拓扑 ═══════════════ */

describe('taskProjectionAdapter · V2 轨道船坞多模块并行与 DAG 拓扑投影', () => {
  const tasks = toUnifiedTasks(makeFullState(), makeCatalog(), makeLanes());
  const rootId = 'task:proj:proj:orbital@1号基地';

  it('父级总成容器：megastructure 域 ＋ 四模块 subTaskIds ＋ workload 汇总', () => {
    const root = taskById(tasks, rootId);
    expect(root).toBeDefined();
    expect(root?.domain).toBe('megastructure');
    expect(root?.status).toBe('active');
    expect(root?.topology?.subTaskIds).toEqual([
      `${rootId}:mod:core`,
      `${rootId}:mod:hab`,
      `${rootId}:mod:dock`,
      `${rootId}:mod:solar`,
    ]);
    // 汇总：core 10d + hab 8d(实况) + dock 12d(实况) + solar 5d = 14400+11520+17280+7200 = 50400
    expect(root?.workload.totalMinutes).toBe(50400);
    expect(root?.workload.spentMinutes).toBe(2000);
    expect(root?.laneKey).toBe('1号基地 eng:eng.orbital'); // V2 缺省槽
  });

  it('core 模块（完工）：completed ＋ 静态工期/算力回填 ＋ 根节点空依赖', () => {
    const core = taskById(tasks, `${rootId}:mod:core`);
    expect(core).toBeDefined();
    expect(core?.domain).toBe('megastructure');
    expect(core?.name).toBe('轨道船坞·龙骨核心');
    expect(core?.status).toBe('completed');
    expect(core?.workload).toMatchObject({ totalMinutes: 14400, minDaysLock: 5, tflopsRequired: 200 });
    expect(core?.topology).toMatchObject({ parentId: rootId, dependsOn: [] });
  });

  it('hab/dock 并行在队：各自吸收 queues[2]/queues[3]，零双影，dependsOn 均指向 core', () => {
    const hab = taskById(tasks, `${rootId}:mod:hab`);
    const dock = taskById(tasks, `${rootId}:mod:dock`);
    expect(hab).toBeDefined();
    expect(dock).toBeDefined();
    expect(hab?.status).toBe('active'); // 吸收 queues[2] active
    expect(hab?.workload).toMatchObject({ totalMinutes: 11520, spentMinutes: 2000, minDaysLock: 3 });
    expect(hab?.metadata).toMatchObject({
      sourceKind: 'project_module',
      moduleId: 'hab',
      queueIndex: 2,
      rawType: '工程',
    });
    expect(hab?.laneKey).toBe('1号基地 eng:eng.orbital');
    expect(dock?.status).toBe('queued'); // 吸收 queues[3] queued
    expect(dock?.workload).toMatchObject({ totalMinutes: 17280, spentMinutes: 0, minDaysLock: 6, topsRequired: 40 });
    expect(dock?.metadata).toMatchObject({ moduleId: 'dock', queueIndex: 3 });
    expect(hab?.topology?.dependsOn).toEqual([`${rootId}:mod:core`]);
    expect(dock?.topology?.dependsOn).toEqual([`${rootId}:mod:core`]);
    // 🔴 防双影铁律：queues[2]/queues[3] 均被领用
    expect(taskById(tasks, 'task:queue:2')).toBeUndefined();
    expect(taskById(tasks, 'task:queue:3')).toBeUndefined();
  });

  it('solar 模块（未启动）：draft ＋ dependsOn 指向 core ＋ 静态工期回填', () => {
    const solar = taskById(tasks, `${rootId}:mod:solar`);
    expect(solar).toBeDefined();
    expect(solar?.status).toBe('draft');
    expect(solar?.workload).toMatchObject({ totalMinutes: 7200, spentMinutes: 0, minDaysLock: 2 });
    expect(solar?.topology?.dependsOn).toEqual([`${rootId}:mod:core`]);
    expect(solar?.metadata?.queueIndex).toBeUndefined();
  });
});

/* ═══════════════ ⑤ 指针漂移防御（syncWarn） ═══════════════ */

describe('taskProjectionAdapter · 指针漂移防御（syncWarn）', () => {
  it('queue_index 越界（999）：安全降级不崩溃，标记 queue_index_out_of_bounds', () => {
    const project = makeProjectV1(999);
    const queues = makeFullQueues().slice(0, 1); // 仅保留犀牛， queues 长度 1
    let tasks: UnifiedTask[] = [];
    expect(() => {
      tasks = toUnifiedTasks({ bases: makeFullBases(), queues, projects: [project] }, makeCatalog(), makeLanes());
    }).not.toThrow();

    const phase1 = taskById(tasks, 'task:proj:proj:grizzly@1号基地:phase:1');
    expect(phase1).toBeDefined();
    expect(phase1?.metadata?.syncWarn).toBe(true);
    expect(phase1?.metadata?.syncWarnReason).toBe('queue_index_out_of_bounds');
    expect(phase1?.metadata?.queueIndex).toBeUndefined();
    // 未领用 → 按无队列项兜底映射（进行中无指针 → active），静态工期回填兜底
    expect(phase1?.status).toBe('active');
    expect(phase1?.workload.totalMinutes).toBe(4320); // 静态 days 3 × 1440
  });

  it('queue_index 张冠李戴（指向犀牛坦克）：queue_item_mismatch，被错误指向的队列项完好保留', () => {
    const project = makeProjectV1(0); // 阶段 1 指向 queues[0] = 犀牛主战坦克（生产）
    const queues = makeFullQueues().slice(0, 1);
    let tasks: UnifiedTask[] = [];
    expect(() => {
      tasks = toUnifiedTasks({ bases: makeFullBases(), queues, projects: [project] }, makeCatalog(), makeLanes());
    }).not.toThrow();

    const phase1 = taskById(tasks, 'task:proj:proj:grizzly@1号基地:phase:1');
    expect(phase1?.metadata?.syncWarn).toBe(true);
    expect(phase1?.metadata?.syncWarnReason).toBe('queue_item_mismatch');
    expect(phase1?.metadata?.queueIndex).toBeUndefined();
    expect(phase1?.workload.totalMinutes).toBe(4320); // 静态兜底

    // 🔴 被错误指向的「犀牛坦克」队列项完好保留为独立任务，绝不丢失
    const rhino = taskById(tasks, 'task:queue:0');
    expect(rhino).toBeDefined();
    expect(rhino?.name).toBe('犀牛主战坦克');
    expect(rhino?.domain).toBe('production');
    expect(rhino?.status).toBe('active');
  });

  it('V2 模块指针漂移同样降级（越界 + 失配双场景）', () => {
    const project: ProjectV2 = {
      ...makeProjectV2(),
      modules: [
        { id: 'core', name: '龙骨核心', status: '完工', base: '', queue_index: null },
        { id: 'hab', name: '居住舱段', status: '进行中', base: '', queue_index: 999 },
        { id: 'dock', name: '舾装船坞', status: '进行中', base: '', queue_index: 0 },
      ],
    };
    const queues = [makeFullQueues()[0]]; // 犀牛
    let tasks: UnifiedTask[] = [];
    expect(() => {
      tasks = toUnifiedTasks({ bases: makeFullBases(), queues, projects: [project] }, makeCatalog(), makeLanes());
    }).not.toThrow();

    expect(taskById(tasks, 'task:proj:proj:orbital@1号基地:mod:hab')?.metadata).toMatchObject({
      syncWarn: true,
      syncWarnReason: 'queue_index_out_of_bounds',
    });
    expect(taskById(tasks, 'task:proj:proj:orbital@1号基地:mod:dock')?.metadata).toMatchObject({
      syncWarn: true,
      syncWarnReason: 'queue_item_mismatch',
    });
    // 犀牛保留
    expect(taskById(tasks, 'task:queue:0')?.name).toBe('犀牛主战坦克');
  });

  it('身份核验采用 canon 宽容口径：全半角/空白差异不误伤', () => {
    const queues = [
      makeQueue({ type: '工程', item: '灰熊坦克现代化改装工程 · 动力包换装', lane: 'eng:eng.main', status: 'active' }),
    ];
    const tasks = toUnifiedTasks(
      { bases: makeFullBases(), queues, projects: [makeProjectV1(0)] },
      makeCatalog(),
      makeLanes(),
    );
    const phase1 = taskById(tasks, 'task:proj:proj:grizzly@1号基地:phase:1');
    expect(phase1?.metadata?.syncWarn).toBeUndefined();
    expect(phase1?.metadata?.queueIndex).toBe(0);
    expect(taskById(tasks, 'task:queue:0')).toBeUndefined();
  });
});

/* ═══════════════ ⑥ 兜底与基线（空账本/缺席通道/id 唯一性） ═══════════════ */

describe('taskProjectionAdapter · 兜底与基线', () => {
  it('空 state 基线：返回空数组（零抛错）', () => {
    expect(toUnifiedTasks({})).toEqual([]);
    expect(toUnifiedTasks({}, undefined, undefined)).toEqual([]);
  });

  it('catalog 缺席：全领域照常映射（关键词推导兜底，工程槽不受影响）', () => {
    const tasks = toUnifiedTasks(makeFullState(), undefined, undefined);
    expect(tasks).toHaveLength(14);
    // 工程 laneKey 推导不依赖 catalog（engLaneKeyFor 显式槽位入口）
    expect(taskById(tasks, 'task:proj:proj:grizzly@1号基地:phase:0')?.laneKey).toBe('1号基地 eng:eng.main');
    expect(taskById(tasks, 'task:proj:proj:orbital@1号基地:mod:hab')?.laneKey).toBe('1号基地 eng:eng.orbital');
    // 生产走关键词推导（坦克 → lane.vehicle_land）
    expect(taskById(tasks, 'task:queue:0')?.laneKey).toBe('1号基地 lane.vehicle_land');
    // catalog 缺席时静态规格不回填（tflops/nanites 省略，不臆造）
    expect(taskById(tasks, 'task:queue:0')?.workload.naniteCost).toBeUndefined();
    expect(taskById(tasks, 'task:proj:proj:grizzly@1号基地:phase:0')?.workload.totalMinutes).toBe(0);
  });

  it('lanes 辅助对齐：仅 hub 落 v1 兜底键时替换；命名产线恒保留 hub 键', () => {
    const state = { bases: makeFullBases(), queues: [makeFullQueues()[0]] };
    // hub 命中 catalog 显式 lane.vehicle_land：即使传入不含该工位的 lanes 也绝不被改写
    const onlyResearch = [
      {
        laneKey: 'research:slot.vehicle',
        domain: 'research',
        displayName: '载具槽',
        capacity: 1,
        accelMultiplier: 1.0,
        locked: false,
      },
    ] as LaneStationView[];
    expect(toUnifiedTasks(state, makeCatalog(), onlyResearch)[0]?.laneKey).toBe('1号基地 lane.vehicle_land');
    // hub 落 v1 兜底键（未登记条目无关键词命中）：lanes 提供同基地同领域候选时对齐
    const orphanQueue = makeQueue({ type: '生产', item: '未知型号补给箱' });
    const withProd = [
      {
        laneKey: '1号基地 lane.vehicle_land',
        domain: 'production',
        displayName: '陆地载具生产线',
        baseId: '1号基地',
        capacity: 2,
        accelMultiplier: 1.0,
        locked: false,
      },
    ] as LaneStationView[];
    expect(toUnifiedTasks({ bases: makeFullBases(), queues: [orphanQueue] }, makeCatalog(), withProd)[0]?.laneKey).toBe(
      '1号基地 lane.vehicle_land',
    );
    // 兜底且无候选：保留 hub 兜底键（fail-open）
    expect(
      toUnifiedTasks({ bases: makeFullBases(), queues: [orphanQueue] }, makeCatalog(), onlyResearch)[0]?.laneKey,
    ).toBe('1号基地 生产');
  });

  it('全量输出 id 全局唯一（工程前缀与队列前缀互斥无碰撞）', () => {
    const tasks = toUnifiedTasks(makeFullState(), makeCatalog(), makeLanes());
    const ids = tasks.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('游离「工程」队列项（无工程指向）：retrofit 域兜底 + engAssemblySpecFor 算力提取', () => {
    const tasks = toUnifiedTasks(
      {
        bases: makeFullBases(),
        queues: [
          makeQueue({ type: '工程', item: '灰熊坦克现代化改装工程·火控换装', status: 'queued', lane: 'eng:eng.main' }),
        ],
      },
      makeCatalog(),
      makeLanes(),
    );
    const orphan = taskById(tasks, 'task:queue:0');
    expect(orphan?.domain).toBe('retrofit'); // queueTypeToTaskDomain('工程') V1 口径兜底
    expect(orphan?.laneKey).toBe('1号基地 eng:eng.main');
    expect(orphan?.workload).toMatchObject({ tflopsRequired: 20, topsRequired: 5 });
  });
});

/* ═══════════════ ⑦ 纯函数红线审查（零 Pinia/Vue/宿主 API/DOM） ═══════════════ */

describe('taskProjectionAdapter · 纯函数红线审查', () => {
  it('唯一运行时导出 toUnifiedTasks 零 Pinia / Vue / 宿主 API / DOM 引用', () => {
    const exportedFunctions = Object.values(adapterExports).filter(entry => typeof entry === 'function') as Array<{
      toString(): string;
    }>;
    expect(exportedFunctions).toHaveLength(1);
    const compiledBody = exportedFunctions.map(fn => fn.toString()).join('\n');
    expect(compiledBody).not.toMatch(/\b(pinia|defineStore|getActivePinia)\b/);
    expect(compiledBody).not.toMatch(/\b(getCurrentInstance|getCurrentMessageId|SillyTavern|TavernHelper)\b/);
    expect(compiledBody).not.toMatch(/\b(document|window|globalThis)\s*\./);
  });
});
