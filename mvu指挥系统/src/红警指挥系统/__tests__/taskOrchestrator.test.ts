/**
 * taskOrchestrator.test.ts —— UTO-CORE-01 验收测试
 *
 * 真源：docs/project/plans/通用任务编排器MVP任务包.md §3.1/§3.2/§3.4（任务卡 UTO-CORE-01）
 * 覆盖：
 * ① 七态转换真值表 100% 覆盖（§3.1.2 双账本映射表逐行对照，含 active+hold=true → held 防御归一）；
 * ② taskStatusToQueueState 全七态回写口径＋可表征六态往返恒等；
 * ③ 工程分段状态映射（指针合一优先跟随 linkedQueue / 无指针兜底 / 未知安全兜底）；
 * ④ 领域映射（含 工程→V2 巨构 / V1 改装分流与 protocol 预留）；
 * ⑤ 终态不可逆与调度免疫守卫（7×7 全矩阵断言）；
 * ⑥ 纯函数红线：零 Pinia/Vue/宿主 API import、入参深冻结零突变、克隆返回不回渗；
 * ⑦ tickTaskOrchestration 骨架契约（空清单基线，三阶段裁决归 UTO-TICK-01）。
 */
import { describe, expect, it } from 'vitest';
import * as orchestratorExports from '../engines/taskOrchestrator';
import {
  TASK_DOMAINS,
  TASK_STATUSES,
  canTransitionTaskStatus,
  isDispatchImmuneTaskStatus,
  isTerminalTaskStatus,
  projectSegmentStatusToTaskStatus,
  queueStatusToTaskStatus,
  queueTypeToTaskDomain,
  taskStatusToQueueState,
  tickTaskOrchestration,
  type LaneStationView,
  type TaskStatus,
  type TickContext,
  type UnifiedTask,
} from '../engines/taskOrchestrator';

/* ═══════════════ 测试工具 ═══════════════ */

/** 深冻结（含嵌套对象/数组；函数跳过），用于入参不可变性断言 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** 造一条完整结构的统一任务（默认候列中的量产任务，覆盖全部嵌套字段） */
function makeTask(overrides: Partial<UnifiedTask> = {}): UnifiedTask {
  return {
    id: 'task:queue:0',
    domain: 'production',
    name: '犀牛主战坦克',
    scope: 'base',
    leadBaseId: '基地A',
    participatingBases: ['基地A'],
    laneKey: '基地A\0lane.vehicle_land',
    workload: { totalMinutes: 600, spentMinutes: 120, minDaysLock: 0 },
    status: 'queued',
    costPaid: true,
    batch: { totalQty: 4, completedQty: 1 },
    topology: { dependsOn: ['task:queue:1'], subTaskIds: [] },
    metadata: { sourceKind: 'queue', queueIndex: 0, rawType: '生产', startedAt: '', eta: '' },
    ...overrides,
  };
}

/** 造一条工位快照 */
function makeLane(overrides: Partial<LaneStationView> = {}): LaneStationView {
  return {
    laneKey: '基地A\0lane.vehicle_land',
    domain: 'production',
    displayName: '陆地载具生产线',
    baseId: '基地A',
    capacity: 2,
    accelMultiplier: 1.0,
    locked: false,
    ...overrides,
  };
}

/** 造一份推进上下文（标量与回调两种形态混用，钉死签名兼容性） */
function makeCtx(overrides: Partial<TickContext> = {}): TickContext {
  return {
    deltaMinutes: 480,
    powerEfficiency: task => (task.domain === 'research' ? 0.8 : 1),
    computeRatio: 0.5,
    now: '第2年4月1日 08:00',
    ...overrides,
  };
}

/* ═══════════════ ① 常量与类型契约 ═══════════════ */

describe('UTO-CORE-01 · 常量契约', () => {
  it('TASK_STATUSES 七态全集且顺序钉死', () => {
    expect([...TASK_STATUSES]).toEqual(['draft', 'queued', 'active', 'held', 'settling', 'completed', 'cancelled']);
  });

  it('TASK_DOMAINS 六域全集（含 protocol 预留）且顺序钉死', () => {
    expect([...TASK_DOMAINS]).toEqual([
      'construction',
      'production',
      'research',
      'retrofit',
      'megastructure',
      'protocol',
    ]);
  });

  it('领域/状态注册表运行时冻结（防枚举漂移）', () => {
    expect(Object.isFrozen(TASK_DOMAINS)).toBe(true);
    expect(Object.isFrozen(TASK_STATUSES)).toBe(true);
    expect(() => (TASK_STATUSES as unknown as string[]).push('frozen-probe')).toThrow();
    expect(() => (TASK_DOMAINS as unknown as string[]).pop()).toThrow();
  });
});

/* ═══════════════ ② queueStatusToTaskStatus 七态真值表（§3.1.2） ═══════════════ */

describe('queueStatusToTaskStatus · 队列账本 → 统一七态真值表', () => {
  it.each([
    ['queued', false, 'queued'],
    ['queued', undefined, 'queued'],
    ['queued', true, 'held'],
    ['active', false, 'active'],
    ['active', undefined, 'active'],
    ['active', true, 'held'],
    ['settling', false, 'settling'],
    ['settling', undefined, 'settling'],
    ['settling', true, 'settling'],
    ['done', false, 'completed'],
    ['done', undefined, 'completed'],
    ['completed', undefined, 'completed'],
    ['cancelled', false, 'cancelled'],
    ['cancelled', undefined, 'cancelled'],
    ['cancelled', true, 'cancelled'],
    ['draft', undefined, 'draft'],
    ['held', undefined, 'held'],
    ['held', true, 'held'],
  ] as Array<[string, boolean | undefined, string]>)(
    '%s + hold=%s -> %s',
    (status: string, hold: boolean | undefined, expected: string) => {
      expect(queueStatusToTaskStatus(status, hold)).toBe(expected);
    },
  );

  it('🔴 防御归一：active + hold=true 一律 held（暂缓优先让出工位）', () => {
    expect(queueStatusToTaskStatus('active', true)).toBe('held');
    expect(queueStatusToTaskStatus('active', true)).not.toBe('active');
  });

  it.each([
    ['', undefined, 'queued'],
    ['', true, 'held'],
    ['paused', undefined, 'queued'],
    ['paused', true, 'held'],
    ['DONE', undefined, 'queued'],
    ['任意非法值', true, 'held'],
  ] as Array<[string, boolean | undefined, string]>)(
    '未知非法值 %j + hold=%s 安全兜底 -> %s',
    (status: string, hold: boolean | undefined, expected: string) => {
      expect(queueStatusToTaskStatus(status, hold)).toBe(expected);
    },
  );
});

/* ═══════════════ ③ taskStatusToQueueState 回写口径与往返恒等 ═══════════════ */

describe('taskStatusToQueueState · 统一七态 → 队列账本回写口径', () => {
  it.each([
    ['draft', { status: 'queued', hold: false }],
    ['queued', { status: 'queued', hold: false }],
    ['active', { status: 'active', hold: false }],
    ['held', { status: 'queued', hold: true }],
    ['settling', { status: 'settling', hold: false }],
    ['completed', { status: 'done', hold: false }],
    ['cancelled', { status: 'cancelled', hold: false }],
  ] as Array<[TaskStatus, { status: string; hold: boolean }]>)(
    '%s -> %j',
    (taskStatus: TaskStatus, expected: { status: string; hold: boolean }) => {
      expect(taskStatusToQueueState(taskStatus)).toEqual(expected);
    },
  );

  it.each([['queued'], ['active'], ['held'], ['settling'], ['completed'], ['cancelled']] as Array<[TaskStatus]>)(
    '队列账本可表征态 %s ⇄ 往返恒等',
    (taskStatus: TaskStatus) => {
      const queueState = taskStatusToQueueState(taskStatus);
      expect(queueStatusToTaskStatus(queueState.status, queueState.hold)).toBe(taskStatus);
    },
  );

  it('每次调用返回全新对象（无共享可变状态）', () => {
    expect(taskStatusToQueueState('queued')).not.toBe(taskStatusToQueueState('queued'));
  });
});

/* ═══════════════ ④ projectSegmentStatusToTaskStatus 工程分段映射 ═══════════════ */

describe('projectSegmentStatusToTaskStatus · 工程分段 → 统一七态', () => {
  it('分段五态中文枚举基线（无 linkedQueue）', () => {
    expect(projectSegmentStatusToTaskStatus('未启动')).toBe('draft');
    expect(projectSegmentStatusToTaskStatus('进行中')).toBe('active');
    expect(projectSegmentStatusToTaskStatus('暂停')).toBe('held');
    expect(projectSegmentStatusToTaskStatus('完工')).toBe('completed');
    expect(projectSegmentStatusToTaskStatus('取消')).toBe('cancelled');
  });

  it('linkedQueue 缺席形态：undefined 与 null 均走无指针兜底', () => {
    expect(projectSegmentStatusToTaskStatus('进行中', undefined)).toBe('active');
    expect(projectSegmentStatusToTaskStatus('暂停', null)).toBe('held');
  });

  it.each([
    ['进行中', { status: 'active', hold: false }, 'active'],
    ['进行中', { status: 'active' }, 'active'],
    ['进行中', { status: 'queued', hold: false }, 'queued'],
    ['进行中', { status: 'active', hold: true }, 'held'],
    ['进行中', { status: 'settling', hold: false }, 'settling'],
    ['进行中', { status: 'done', hold: false }, 'completed'],
    ['暂停', { status: 'queued', hold: true }, 'held'],
    ['暂停', { status: 'active', hold: false }, 'active'],
    ['暂停', { status: 'active', hold: true }, 'held'],
  ] as Array<[string, { status: string; hold?: boolean }, string]>)(
    '「%s」＋有效 linkedQueue %j -> %s（指针合一，优先跟随队列账本）',
    (segStatus: string, linkedQueue: { status: string; hold?: boolean }, expected: string) => {
      expect(projectSegmentStatusToTaskStatus(segStatus, linkedQueue)).toBe(expected);
    },
  );

  it('非「进行中/暂停」分段无视 linkedQueue，直取分段终态（防双影）', () => {
    expect(projectSegmentStatusToTaskStatus('完工', { status: 'queued', hold: false })).toBe('completed');
    expect(projectSegmentStatusToTaskStatus('取消', { status: 'active', hold: false })).toBe('cancelled');
    expect(projectSegmentStatusToTaskStatus('未启动', { status: 'active', hold: false })).toBe('draft');
  });

  it('未知分段状态（如工程级枚举「规划中/在建」串道）安全兜底 draft', () => {
    expect(projectSegmentStatusToTaskStatus('规划中')).toBe('draft');
    expect(projectSegmentStatusToTaskStatus('在建')).toBe('draft');
    expect(projectSegmentStatusToTaskStatus('')).toBe('draft');
  });

  it('入参对象深冻结零突变（指针合一只读）', () => {
    const linkedQueue = deepFreeze({ status: 'active', hold: true });
    expect(projectSegmentStatusToTaskStatus('进行中', linkedQueue)).toBe('held');
    expect(linkedQueue).toEqual({ status: 'active', hold: true });
  });
});

/* ═══════════════ ⑤ queueTypeToTaskDomain 领域映射 ═══════════════ */

describe('queueTypeToTaskDomain · 事务类型 → 任务领域', () => {
  it.each([
    ['建造', 'construction'],
    ['生产', 'production'],
    ['研究', 'research'],
    ['改装', 'retrofit'],
    ['协议', 'protocol'],
  ] as Array<[string, string]>)('%s -> %s', (type: string, expected: string) => {
    expect(queueTypeToTaskDomain(type)).toBe(expected);
  });

  it.each([
    [undefined, 'retrofit'],
    [{}, 'retrofit'],
    [{ isV2Project: false }, 'retrofit'],
    [{ isV2Project: true }, 'megastructure'],
  ] as Array<[{ isV2Project?: boolean } | undefined, string]>)(
    '工程 + opts %j -> %s（V1 改装 / V2 巨构分账）',
    (opts: { isV2Project?: boolean } | undefined, expected: string) => {
      expect(queueTypeToTaskDomain('工程', opts)).toBe(expected);
    },
  );

  it.each([
    ['', 'production'],
    ['训练', 'production'],
    ['种田', 'production'],
  ] as Array<[string, string]>)('未知类型 %j 安全兜底 -> %s', (type: string, expected: string) => {
    expect(queueTypeToTaskDomain(type)).toBe(expected);
  });
});

/* ═══════════════ ⑥ 状态守卫：终态不可逆 / 调度免疫 / 全矩阵迁移 ═══════════════ */

describe('isTerminalTaskStatus / isDispatchImmuneTaskStatus · 守卫真值', () => {
  it.each([
    ['draft', false, false],
    ['queued', false, false],
    ['active', false, false],
    ['held', false, false],
    ['settling', false, true],
    ['completed', true, true],
    ['cancelled', true, true],
  ] as Array<[TaskStatus, boolean, boolean]>)(
    '%s：终态=%s 调度免疫=%s',
    (status: TaskStatus, terminal: boolean, immune: boolean) => {
      expect(isTerminalTaskStatus(status)).toBe(terminal);
      expect(isDispatchImmuneTaskStatus(status)).toBe(immune);
    },
  );
});

describe('canTransitionTaskStatus · 七态全矩阵迁移白名单', () => {
  /** 合法迁移全集（对齐 transactionEngine 五态白名单＋draft/held 七态扩展） */
  const LEGAL_PAIRS: ReadonlyArray<readonly [string, string]> = [
    ['queued', 'active'],
    ['active', 'settling'],
    ['active', 'queued'],
    ['settling', 'completed'],
    ['settling', 'active'],
    ['queued', 'cancelled'],
    ['active', 'cancelled'],
    ['draft', 'queued'],
    ['draft', 'cancelled'],
    ['queued', 'held'],
    ['active', 'held'],
    ['held', 'queued'],
    ['held', 'cancelled'],
  ];

  const isLegalPair = (from: string, to: string) => LEGAL_PAIRS.some(([f, t]) => f === from && t === to);

  it.each([...TASK_STATUSES])('from %s：7×7 全目标态逐一对照白名单', (from: TaskStatus) => {
    for (const to of TASK_STATUSES) {
      expect(canTransitionTaskStatus(from, to)).toBe(isLegalPair(from, to));
    }
  });

  it.each([['completed'], ['cancelled']] as Array<[TaskStatus]>)(
    '🔴 终态 %s 不可逆：一切迁移（含自迁移）拒绝',
    (terminal: TaskStatus) => {
      for (const to of TASK_STATUSES) {
        expect(canTransitionTaskStatus(terminal, to)).toBe(false);
      }
    },
  );

  it.each([...TASK_STATUSES])('自迁移 %s → %s 一律拒绝', (status: TaskStatus) => {
    expect(canTransitionTaskStatus(status, status)).toBe(false);
  });
});

/* ═══════════════ ⑦ tickTaskOrchestration 骨架契约与纯函数铁律 ═══════════════ */

describe('tickTaskOrchestration · UTO-CORE-01 骨架契约', () => {
  it('锁定工位基线：工位锁定且无前置完成时，全部结果清单与事件流恒为空，任务内容逐项保真', () => {
    const tasks = [
      makeTask(),
      makeTask({ id: 'task:proj:proj_2:mod:core', domain: 'megastructure', status: 'draft', scope: 'theater' }),
      makeTask({ id: 'task:queue:7', status: 'settling', domain: 'construction' }),
    ];
    const result = tickTaskOrchestration(
      deepFreeze(tasks),
      deepFreeze([makeLane({ capacity: 0, locked: true })]),
      deepFreeze(makeCtx()),
    );

    expect(result.completedTaskIds).toEqual([]);
    expect(result.settlingTaskIds).toEqual([]);
    expect(result.promotedTaskIds).toEqual([]);
    expect(result.preemptedTaskIds).toEqual([]);
    expect(result.unlockedTaskIds).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.nextTasks.map(t => t.id)).toEqual(tasks.map(t => t.id));
    expect(result.nextTasks.map(t => t.status)).toEqual(['queued', 'draft', 'settling']);
    expect(result.nextTasks[0]).toEqual(tasks[0]);
  });

  it('空任务集：返回空数组与全空清单', () => {
    const result = tickTaskOrchestration([], [], { deltaMinutes: 0 });
    expect(result.nextTasks).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it('TickContext 标量与回调两种形态均可接入（签名兼容）', () => {
    const scalarCtx = deepFreeze(makeCtx({ powerEfficiency: 0.75, computeRatio: 1 }));
    const result = tickTaskOrchestration([makeTask()], [], scalarCtx);
    expect(result.nextTasks).toHaveLength(1);
  });

  it('🔴 纯函数铁律：深冻结入参零突变（冻结对象上任何写入都会抛错，调用全程无异常即零突变）', () => {
    const tasks = [makeTask(), makeTask({ id: 'task:queue:1', status: 'active' })];
    const lanes = [makeLane(), makeLane({ laneKey: 'slot.main', domain: 'research', baseId: undefined })];
    const ctx = makeCtx();
    expect(() => tickTaskOrchestration(deepFreeze(tasks), deepFreeze(lanes), deepFreeze(ctx))).not.toThrow();
  });

  it('🔴 克隆返回不回渗：修改结果体任意嵌套字段均不影响入参', () => {
    const original = makeTask();
    const input = [original];
    const snapshot = JSON.parse(JSON.stringify(original)) as UnifiedTask;
    const result = tickTaskOrchestration(input, [makeLane()], makeCtx());

    expect(result.nextTasks).not.toBe(input);
    expect(result.nextTasks[0]).not.toBe(original);
    expect(result.nextTasks[0].workload).not.toBe(original.workload);
    expect(result.nextTasks[0].topology).not.toBe(original.topology);
    expect(result.nextTasks[0].batch).not.toBe(original.batch);
    expect(result.nextTasks[0].metadata).not.toBe(original.metadata);
    expect(result.nextTasks[0].participatingBases).not.toBe(original.participatingBases);

    result.nextTasks[0].workload.spentMinutes = 999;
    result.nextTasks[0].topology?.dependsOn?.push('task:fake');
    result.nextTasks[0].batch!.completedQty = 4;
    result.nextTasks[0].status = 'cancelled';
    result.nextTasks.push(makeTask({ id: 'task:injected' }));

    expect(original).toEqual(snapshot);
    expect(original.workload.spentMinutes).toBe(120);
    expect(original.topology?.dependsOn).toEqual(['task:queue:1']);
    expect(original.batch?.completedQty).toBe(1);
    expect(original.status).toBe('queued');
    expect(input).toHaveLength(1);
  });

  it('🔴 步进机不产任何 completed：满额必先停靠 settling，绝不过三色对账门自置 completed', () => {
    const finishing = makeTask({
      id: 'task:queue:9',
      status: 'active',
      workload: { totalMinutes: 600, spentMinutes: 600 },
    });
    const result = tickTaskOrchestration([finishing], [], makeCtx({ deltaMinutes: 480 }));
    expect(result.completedTaskIds).toEqual([]);
    expect(result.settlingTaskIds).toEqual(['task:queue:9']);
    expect(result.nextTasks[0].status).toBe('settling');
  });
});

/* ═══════════════ ⑧ 纯函数红线审查（零 Pinia/Vue/宿主 API） ═══════════════ */

describe('纯函数红线 · 运行时导出体与函数源码审查', () => {
  const exportedEntries = Object.values(orchestratorExports) as unknown[];
  const exportedFunctions = exportedEntries.filter(entry => typeof entry === 'function') as Array<{
    toString(): string;
  }>;
  const compiledBodies = exportedFunctions.map(fn => fn.toString()).join('\n');

  it('模块导出全集完备（2 常量 + 8 纯函数，零多余副作用挂载）', () => {
    expect(Object.keys(orchestratorExports).sort()).toEqual([
      'TASK_DOMAINS',
      'TASK_STATUSES',
      'canTransitionTaskStatus',
      'isDispatchImmuneTaskStatus',
      'isTerminalTaskStatus',
      'projectSegmentStatusToTaskStatus',
      'queueStatusToTaskStatus',
      'queueTypeToTaskDomain',
      'taskStatusToQueueState',
      'tickTaskOrchestration',
    ]);
    expect(exportedFunctions).toHaveLength(8);
  });

  it('全部导出函数零 Pinia / Vue / 宿主 API / DOM 引用', () => {
    expect(compiledBodies).not.toMatch(/\b(pinia|defineStore|getActivePinia)\b/);
    expect(compiledBodies).not.toMatch(/\b(getCurrentInstance|getCurrentMessageId|SillyTavern|TavernHelper)\b/);
    expect(compiledBodies).not.toMatch(/\b(document|window|globalThis)\s*\./);
  });
});

/* ═══════════════ ⑨ UTO-TICK-01 · 第一阶段：工位带宽抢占与超额挤退裁决 ═══════════════ */

describe('UTO-TICK-01 · 第一阶段：工位带宽抢占、空额升格与容量缩水末序挤退', () => {
  it('空额带宽升格：按数组序将 queued 升格为 active 至 capacity 上限，补记 startedAt 并产出 promoted 事件', () => {
    const lane = makeLane({ laneKey: '基地A lane.vehicle_land', capacity: 2 });
    const tasks = [
      makeTask({
        id: 'task:queue:0',
        name: '犀牛主战坦克-1',
        laneKey: '基地A lane.vehicle_land',
        status: 'queued',
        metadata: { sourceKind: 'queue', queueIndex: 0, rawType: '生产', startedAt: '' },
      }),
      makeTask({
        id: 'task:queue:1',
        name: '犀牛主战坦克-2',
        laneKey: '基地A lane.vehicle_land',
        status: 'queued',
        metadata: { sourceKind: 'queue', queueIndex: 1, rawType: '生产', startedAt: '第2年3月30日 12:00' },
      }),
      makeTask({
        id: 'task:queue:2',
        name: '天启坦克',
        laneKey: '基地A lane.vehicle_land',
        status: 'queued',
        metadata: { sourceKind: 'queue', queueIndex: 2, rawType: '生产', startedAt: '' },
      }),
    ];

    const result = tickTaskOrchestration(
      deepFreeze(tasks),
      deepFreeze([lane]),
      deepFreeze({ deltaMinutes: 0, now: '第2年4月1日 09:00' }),
    );

    expect(result.promotedTaskIds).toEqual(['task:queue:0', 'task:queue:1']);
    expect(result.preemptedTaskIds).toEqual([]);
    expect(result.nextTasks.map(t => t.status)).toEqual(['active', 'active', 'queued']);
    // 空 startedAt 补记 ctx.now，已有 startedAt 保留不覆盖
    expect(result.nextTasks[0].metadata?.startedAt).toBe('第2年4月1日 09:00');
    expect(result.nextTasks[1].metadata?.startedAt).toBe('第2年3月30日 12:00');
    expect(result.nextTasks[2].metadata?.startedAt).toBe('');
    expect(result.events.filter(e => e.type === 'promoted')).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      type: 'promoted',
      item: '犀牛主战坦克-1',
      base: '基地A',
    });
  });

  it('容量缩水末序挤退：当 capacity 降低（如建筑切加速模式 2→1）时，末序 active 退回 queued 且进度 100% 留存', () => {
    const lane = makeLane({ laneKey: '基地A lane.vehicle_land', capacity: 1, accelMultiplier: 1.5 });
    const tasks = [
      makeTask({
        id: 'task:queue:0',
        name: '灰熊坦克批次A',
        laneKey: '基地A lane.vehicle_land',
        status: 'active',
        workload: { totalMinutes: 1000, spentMinutes: 400 },
      }),
      makeTask({
        id: 'task:queue:1',
        name: '多功能步兵车批次B',
        laneKey: '基地A lane.vehicle_land',
        status: 'active',
        workload: { totalMinutes: 1000, spentMinutes: 350 },
      }),
      makeTask({
        id: 'task:queue:2',
        name: '光棱坦克批次C',
        laneKey: '基地A lane.vehicle_land',
        status: 'queued',
        workload: { totalMinutes: 1000, spentMinutes: 0 },
      }),
    ];

    const result = tickTaskOrchestration(
      deepFreeze(tasks),
      deepFreeze([lane]),
      deepFreeze({ deltaMinutes: 100, powerEfficiency: 1, computeRatio: 1 }),
    );

    // 首序 active 保留并继续积分（400 + 100 * 1.5 = 550），末序 active 被挤退回 queued 且 spentMinutes=350 原样留存
    expect(result.preemptedTaskIds).toEqual(['task:queue:1']);
    expect(result.promotedTaskIds).toEqual([]);
    expect(result.nextTasks[0].status).toBe('active');
    expect(result.nextTasks[0].workload.spentMinutes).toBe(550);
    expect(result.nextTasks[1].status).toBe('queued');
    expect(result.nextTasks[1].workload.spentMinutes).toBe(350);
    expect(result.nextTasks[2].status).toBe('queued');
    expect(result.events.some(e => e.type === 'preempted' && e.item === '多功能步兵车批次B')).toBe(true);
  });

  it('产线 locked=true 时有效容量视为 0：存量 active 全部安全挤退回 queued，候列任务绝不升格', () => {
    const lockedLane = makeLane({
      laneKey: '基地A lane.air',
      capacity: 2,
      locked: true,
      lockedReason: '需要空指部',
    });
    const tasks = [
      makeTask({
        id: 'task:air:0',
        name: '入侵者战机',
        laneKey: '基地A lane.air',
        status: 'active',
        workload: { totalMinutes: 800, spentMinutes: 260 },
      }),
      makeTask({
        id: 'task:air:1',
        name: '黑鹰战机',
        laneKey: '基地A lane.air',
        status: 'queued',
        workload: { totalMinutes: 800, spentMinutes: 0 },
      }),
    ];

    const result = tickTaskOrchestration(
      deepFreeze(tasks),
      deepFreeze([lockedLane]),
      deepFreeze({ deltaMinutes: 200 }),
    );

    expect(result.preemptedTaskIds).toEqual(['task:air:0']);
    expect(result.promotedTaskIds).toEqual([]);
    expect(result.nextTasks[0].status).toBe('queued');
    expect(result.nextTasks[0].workload.spentMinutes).toBe(260);
    expect(result.nextTasks[1].status).toBe('queued');
  });

  it('globalLimit 跨槽统管：科研 3 序列均解锁（各 capacity=1），T1 globalLimit=2 时仅前 2 条升格，超额 active 末序挤退', () => {
    const lanes = [
      makeLane({ laneKey: 'research:slot.main', domain: 'research', capacity: 1, globalLimit: 2 }),
      makeLane({ laneKey: 'research:slot.ra_radar', domain: 'research', capacity: 1, globalLimit: 2 }),
      makeLane({ laneKey: 'research:slot.Allied_Chrono', domain: 'research', capacity: 1, globalLimit: 2 }),
    ];

    // 场景 A：3 条 queued 竞争 T1(globalLimit=2)
    const queuedTasks = [
      makeTask({ id: 'task:r:0', domain: 'research', name: '课题A', laneKey: 'research:slot.main', status: 'queued' }),
      makeTask({
        id: 'task:r:1',
        domain: 'research',
        name: '课题B',
        laneKey: 'research:slot.ra_radar',
        status: 'queued',
      }),
      makeTask({
        id: 'task:r:2',
        domain: 'research',
        name: '课题C',
        laneKey: 'research:slot.Allied_Chrono',
        status: 'queued',
      }),
    ];
    const resPromote = tickTaskOrchestration(deepFreeze(queuedTasks), deepFreeze(lanes), { deltaMinutes: 0 });
    expect(resPromote.promotedTaskIds).toEqual(['task:r:0', 'task:r:1']);
    expect(resPromote.nextTasks.map(t => t.status)).toEqual(['active', 'active', 'queued']);

    // 场景 B：3 条已 active 遭遇 techTier 降级（T2=4 → T1=2），第 3 条跨槽末序挤退
    const activeTasks = queuedTasks.map((t, i) => ({
      ...t,
      status: 'active' as const,
      workload: { totalMinutes: 1000, spentMinutes: (i + 1) * 100 },
    }));
    const resEvict = tickTaskOrchestration(deepFreeze(activeTasks), deepFreeze(lanes), { deltaMinutes: 0 });
    expect(resEvict.preemptedTaskIds).toEqual(['task:r:2']);
    expect(resEvict.nextTasks.map(t => t.status)).toEqual(['active', 'active', 'queued']);
    expect(resEvict.nextTasks[2].workload.spentMinutes).toBe(300);
  });

  it('held 与 draft 任务不占工位且不升格，后续 queued 任务跨过它们正常递补升格', () => {
    const lane = makeLane({ laneKey: '基地A eng:eng.main', domain: 'retrofit', capacity: 1 });
    const tasks = [
      makeTask({
        id: 'task:held:0',
        domain: 'retrofit',
        name: '暂缓改装项',
        laneKey: '基地A eng:eng.main',
        status: 'held',
        workload: { totalMinutes: 1000, spentMinutes: 500 },
      }),
      makeTask({
        id: 'task:draft:1',
        domain: 'retrofit',
        name: '规划中二期阶段',
        laneKey: '基地A eng:eng.main',
        status: 'draft',
        workload: { totalMinutes: 1000, spentMinutes: 0 },
        topology: { parentId: 'task:proj:p1', dependsOn: ['task:proj:p1:phase:0'] },
      }),
      makeTask({
        id: 'task:queued:2',
        domain: 'retrofit',
        name: '候列改装项',
        laneKey: '基地A eng:eng.main',
        status: 'queued',
        workload: { totalMinutes: 1000, spentMinutes: 0 },
      }),
    ];

    const result = tickTaskOrchestration(deepFreeze(tasks), deepFreeze([lane]), {
      deltaMinutes: 200,
      powerEfficiency: 1,
      computeRatio: 1,
    });

    expect(result.promotedTaskIds).toEqual(['task:queued:2']);
    expect(result.nextTasks.map(t => t.status)).toEqual(['held', 'draft', 'active']);
    expect(result.nextTasks[0].workload.spentMinutes).toBe(500);
    expect(result.nextTasks[1].workload.spentMinutes).toBe(0);
    expect(result.nextTasks[2].workload.spentMinutes).toBe(200);
  });

  it('纯容器父节点（project_root 或顶层含 subTaskIds 节点）完全跳过：不占工位带宽、不挤退、不积分', () => {
    const lane = makeLane({ laneKey: '基地A eng:eng.orbital', domain: 'megastructure', capacity: 1 });
    const tasks = [
      makeTask({
        id: 'task:proj:orbital_1',
        domain: 'megastructure',
        name: '天基轨道船坞总成',
        laneKey: '基地A eng:eng.orbital',
        status: 'active',
        workload: { totalMinutes: 50400, spentMinutes: 2000 },
        topology: { subTaskIds: ['task:proj:orbital_1:mod:core'] },
        metadata: { sourceKind: 'project_root', projectId: 'orbital_1' },
      }),
      makeTask({
        id: 'task:proj:orbital_1:mod:core',
        domain: 'megastructure',
        name: '天基轨道船坞·核心桁架',
        laneKey: '基地A eng:eng.orbital',
        status: 'queued',
        workload: { totalMinutes: 14400, spentMinutes: 0 },
        topology: { parentId: 'task:proj:orbital_1', dependsOn: [] },
        metadata: { sourceKind: 'project_module', projectId: 'orbital_1', moduleId: 'core' },
      }),
    ];

    const result = tickTaskOrchestration(deepFreeze(tasks), deepFreeze([lane]), {
      deltaMinutes: 300,
      powerEfficiency: 1,
      computeRatio: 1,
    });

    // 父容器虽为 active 但不占容量（不被挤退，也不消耗容量），子模块 core 成功升格为 active 并积分 300 分钟
    expect(result.preemptedTaskIds).toEqual([]);
    expect(result.promotedTaskIds).toEqual(['task:proj:orbital_1:mod:core']);
    expect(result.nextTasks[0].status).toBe('active');
    expect(result.nextTasks[0].workload.spentMinutes).toBe(2000);
    expect(result.nextTasks[1].status).toBe('active');
    expect(result.nextTasks[1].workload.spentMinutes).toBe(300);
  });

  it('未在 lanes 快照中出现的未知 laneKey 自动按默认容量兜底（capacity=1, accelMultiplier=1, locked=false）', () => {
    const tasks = [
      makeTask({
        id: 'task:unlisted:0',
        laneKey: '基地Z lane.unknown',
        status: 'queued',
        workload: { totalMinutes: 1000, spentMinutes: 0 },
      }),
      makeTask({
        id: 'task:unlisted:1',
        laneKey: '基地Z lane.unknown',
        status: 'queued',
        workload: { totalMinutes: 1000, spentMinutes: 0 },
      }),
    ];

    const result = tickTaskOrchestration(deepFreeze(tasks), [], { deltaMinutes: 150 });
    expect(result.promotedTaskIds).toEqual(['task:unlisted:0']);
    expect(result.nextTasks[0].status).toBe('active');
    expect(result.nextTasks[0].workload.spentMinutes).toBe(150);
    expect(result.nextTasks[1].status).toBe('queued');
  });
});

/* ═══════════════ ⑩ UTO-TICK-01 · 第二阶段：有效工时积分、两阶段装配与 minDaysLock 钳制 ═══════════════ */

describe('UTO-TICK-01 · 第二阶段：有效工时积分、两阶段减免与 minDaysLock 物理硬下限钳制', () => {
  it('电网低电折算 × 双模加速比 × 算力供需比 乘法叠加积分', () => {
    const lane = makeLane({
      laneKey: '基地A lane.vehicle_land',
      capacity: 1,
      accelMultiplier: 1.5, // 双模加速 1.5x
    });
    const task = makeTask({
      id: 'task:queue:0',
      laneKey: '基地A lane.vehicle_land',
      status: 'active',
      workload: { totalMinutes: 2000, spentMinutes: 100, minDaysLock: 0 },
      batch: { totalQty: 1, completedQty: 0 },
    });

    // Δspent = 400 * 1.5(accel) * 0.5(power) * 1.2(compute) = 360
    const result = tickTaskOrchestration([task], [lane], {
      deltaMinutes: 400,
      powerEfficiency: 0.5,
      computeRatio: 1.2,
    });

    expect(result.nextTasks[0].workload.spentMinutes).toBeCloseTo(460, 5);
    expect(result.nextTasks[0].status).toBe('active');
  });

  it('直接模式 minDaysLock 物理硬下限钳制：高加速与高算力下总实耗工期绝不低于 minDaysLock * 1440 分钟', () => {
    const lane = makeLane({
      laneKey: '基地A lane.vehicle_land',
      capacity: 1,
      accelMultiplier: 2.5,
    });
    const task = makeTask({
      id: 'task:lock:0',
      laneKey: '基地A lane.vehicle_land',
      status: 'active',
      // 标称 2 天（2880 分钟），物理硬锁 1 天（1440 分钟）→ 最大有效倍率被钳制为 2880 / 1440 = 2.0x
      workload: { totalMinutes: 2880, spentMinutes: 0, minDaysLock: 1 },
      batch: { totalQty: 1, completedQty: 0 },
    });

    // 未钳制倍率 = 2.5 * 1.0 * 2.0 = 5.0x；受 minDaysLock=1 天钳制后倍率上限为 2.0x
    // 推进 720 分钟（0.5 天）后仅完成 720 * 2.0 = 1440 分钟（50%），绝不提前进入 settling
    const step1 = tickTaskOrchestration([task], [lane], {
      deltaMinutes: 720,
      powerEfficiency: 1.0,
      computeRatio: 2.0,
    });
    expect(step1.nextTasks[0].workload.spentMinutes).toBe(1440);
    expect(step1.nextTasks[0].status).toBe('active');
    expect(step1.settlingTaskIds).toEqual([]);

    // 再推进 720 分钟（累计真实耗时满 1440 分钟 = 1 天 minDaysLock），方达 2880 分钟转入 settling
    const step2 = tickTaskOrchestration(step1.nextTasks, [lane], {
      deltaMinutes: 720,
      powerEfficiency: 1.0,
      computeRatio: 2.0,
    });
    expect(step2.nextTasks[0].workload.spentMinutes).toBe(2880);
    expect(step2.nextTasks[0].status).toBe('settling');
    expect(step2.settlingTaskIds).toEqual(['task:lock:0']);
  });

  it('桥接 twoStageAssemblyEngine：阶段一纳米抵扣（足额全跳阶段一）＋ 阶段二双算力加速与双轨 minDaysLock 钳制', () => {
    const prodLane = makeLane({ laneKey: '基地A lane.vehicle_land', domain: 'production', capacity: 1 });
    const prodTask = makeTask({
      id: 'task:prod:2stage',
      domain: 'production',
      name: '天启重型坦克',
      laneKey: '基地A lane.vehicle_land',
      status: 'queued',
      // 标称 2880 分钟（阶段一 1440 + 阶段二 1440），阶段二物理锁 0.8 天（1152 分钟），纳米需求 100
      workload: {
        totalMinutes: 2880,
        spentMinutes: 0,
        minDaysLock: 0.8,
        tflopsRequired: 10,
        topsRequired: 20,
        naniteCost: 100,
      },
      batch: { totalQty: 1, completedQty: 0 },
      metadata: { sourceKind: 'queue', rawType: '生产', startedAt: '' },
    });

    // 足额纳米 100 → 升格后直接抵扣跳过阶段一（注入 1440 分钟，处于阶段二起点）；
    // 阶段二算力满配（rawSpeedup = 1 + 0.3*1 + 0.7*1 = 2.0x），但受制造轨阶段二地板钳制：
    // phase2Multiplier = min(2.0, 1440 / (0.8 * 1440)) = min(2.0, 1.25) = 1.25x
    const result = tickTaskOrchestration([prodTask], [prodLane], {
      deltaMinutes: 400,
      nanitesFor: 100,
      computeFor: { tflops: 20, tops: 40 },
    });

    expect(result.promotedTaskIds).toEqual(['task:prod:2stage']);
    expect(result.events.some(e => e.type === 'nanites_deducted')).toBe(true);
    // spentMinutes = 1440（纳米跳过阶段一）+ 400 * 1.25（阶段二钳制后倍率）= 1940
    expect(result.nextTasks[0].workload.spentMinutes).toBeCloseTo(1940, 5);
    expect(result.nextTasks[0].status).toBe('active');

    // 研究轨对比：研究 minDaysLock 为「总工期地板」而非阶段二地板
    const resLane = makeLane({ laneKey: 'research:slot.main', domain: 'research', capacity: 1 });
    const resTask = makeTask({
      id: 'task:res:2stage',
      domain: 'research',
      name: '超时空传送理论',
      laneKey: 'research:slot.main',
      status: 'active',
      // 总工期 2880（阶段一 1440 + 阶段二 1440），已处阶段二起点 spentMinutes=1440，总工期锁 1.5 天（2160 分钟）
      // 研究轨允许阶段二压缩至 2160 - 1440 = 720 分钟 → 上限倍率 1440 / 720 = 2.0x（不额外截断满算力 2.0x）
      workload: {
        totalMinutes: 2880,
        spentMinutes: 1440,
        minDaysLock: 1.5,
        tflopsRequired: 10,
        topsRequired: 10,
      },
      batch: { totalQty: 1, completedQty: 0 },
      metadata: { sourceKind: 'queue', rawType: '研究', startedAt: '第2年4月1日 08:00' },
    });

    const resTick = tickTaskOrchestration([resTask], [resLane], {
      deltaMinutes: 400,
      computeFor: { tflops: 10, tops: 10 },
    });
    // 1440 + 400 * 2.0 = 2240
    expect(resTick.nextTasks[0].workload.spentMinutes).toBeCloseTo(2240, 5);
  });

  it('两阶段阶段一（配料期）不吃算力加速、半额纳米抵扣按比例跳过阶段一、工程巨构 naniteCost 开工门不作配料抵扣', () => {
    const prodLane = makeLane({ laneKey: '基地A lane.vehicle_land', domain: 'production', capacity: 1 });
    const partialNaniteTask = makeTask({
      id: 'task:prod:half_nanite',
      domain: 'production',
      name: '幻影坦克',
      laneKey: '基地A lane.vehicle_land',
      status: 'active',
      workload: {
        totalMinutes: 2000, // 50/50 分界：阶段一 1000 分钟，阶段二 1000 分钟
        spentMinutes: 0,
        tflopsRequired: 10,
        topsRequired: 10,
        naniteCost: 100,
      },
      batch: { totalQty: 1, completedQty: 0 },
      metadata: { sourceKind: 'queue', rawType: '生产', startedAt: '第2年4月1日 08:00' },
    });

    // 纳米库存仅 50（需求 100）→ skippedRatio=0.5，注入 1000 * 0.5 = 500 分钟；
    // 此时 spentMinutes=500 < phase1End(1000)，仍处于阶段一（配料阶段），即便算力满配也不吃算力加速（倍率恒 1.0x）
    const tickPhase1 = tickTaskOrchestration([partialNaniteTask], [prodLane], {
      deltaMinutes: 300,
      nanitesFor: 50,
      computeFor: { tflops: 100, tops: 100 },
    });
    expect(tickPhase1.events).toContainEqual(
      expect.objectContaining({
        type: 'nanites_deducted',
        item: '幻影坦克',
        amount: 50,
        skippedRatio: 0.5,
      }),
    );
    // 500（纳米注入）+ 300 * 1.0（阶段一不吃算力）= 800
    expect(tickPhase1.nextTasks[0].workload.spentMinutes).toBe(800);

    // 巨构工程模块的 naniteCost 为开工门，不触发阶段一配料纳米抵扣
    const megaLane = makeLane({ laneKey: '基地A eng:eng.orbital', domain: 'megastructure', capacity: 1 });
    const megaTask = makeTask({
      id: 'task:proj:v2:mod:core',
      domain: 'megastructure',
      name: '轨道站·核心舱',
      laneKey: '基地A eng:eng.orbital',
      status: 'active',
      workload: { totalMinutes: 2000, spentMinutes: 0, naniteCost: 500 },
      metadata: { sourceKind: 'project_module', rawType: '工程', startedAt: '第2年4月1日 08:00' },
    });
    const megaTick = tickTaskOrchestration([megaTask], [megaLane], {
      deltaMinutes: 100,
      nanitesFor: 1000,
    });
    expect(megaTick.events.some(e => e.type === 'nanites_deducted')).toBe(false);
    expect(megaTick.nextTasks[0].workload.spentMinutes).toBe(100);
  });

  it('promotionTiming="after_integration" 兼容模式：存量 active 先积分转入 settling，腾出工位供同楼 queued 递补升格（新升格本楼不吃 Δt）', () => {
    const lane = makeLane({ laneKey: '基地A lane.vehicle_land', capacity: 1 });
    const tasks = [
      makeTask({
        id: 'task:legacy:0',
        name: '在造犀牛',
        laneKey: '基地A lane.vehicle_land',
        status: 'active',
        workload: { totalMinutes: 500, spentMinutes: 400 },
      }),
      makeTask({
        id: 'task:legacy:1',
        name: '候列灰熊',
        laneKey: '基地A lane.vehicle_land',
        status: 'queued',
        workload: { totalMinutes: 500, spentMinutes: 0 },
      }),
    ];

    const result = tickTaskOrchestration(deepFreeze(tasks), deepFreeze([lane]), {
      deltaMinutes: 200,
      promotionTiming: 'after_integration',
      now: '第2年4月3日 10:00',
    });

    expect(result.settlingTaskIds).toEqual(['task:legacy:0']);
    expect(result.promotedTaskIds).toEqual(['task:legacy:1']);
    expect(result.nextTasks[0].status).toBe('settling');
    expect(result.nextTasks[1].status).toBe('active');
    expect(result.nextTasks[1].workload.spentMinutes).toBe(0);
    expect(result.nextTasks[1].metadata?.startedAt).toBe('第2年4月3日 10:00');
  });

  it('批量流水作业（batch.totalQty > 1）单件累进与 qty_progress 事件，满额进入 settling 且绝不自置 completed', () => {
    const lane = makeLane({ laneKey: '基地A lane.infantry', capacity: 1 });
    const batchTask = makeTask({
      id: 'task:batch:0',
      name: '动员兵班组',
      laneKey: '基地A lane.infantry',
      status: 'active',
      workload: { totalMinutes: 400, spentMinutes: 50 }, // 单件 100 分钟，共 4 件
      batch: { totalQty: 4, completedQty: 0 },
    });

    // 推进 200 分钟 → spentMinutes=250 → completedQty 达 2，产出 qty_progress
    const step1 = tickTaskOrchestration([batchTask], [lane], { deltaMinutes: 200 });
    expect(step1.nextTasks[0].batch?.completedQty).toBe(2);
    expect(step1.nextTasks[0].status).toBe('active');
    expect(step1.events).toContainEqual({
      type: 'qty_progress',
      item: '动员兵班组',
      base: '基地A',
      detail: '批次流水 2/4',
    });

    // 再推进 200 分钟 → spentMinutes=450 >= 400 → completedQty=4，状态转入 settling，completedTaskIds 恒空
    const step2 = tickTaskOrchestration(step1.nextTasks, [lane], { deltaMinutes: 200 });
    expect(step2.nextTasks[0].batch?.completedQty).toBe(4);
    expect(step2.nextTasks[0].status).toBe('settling');
    expect(step2.settlingTaskIds).toEqual(['task:batch:0']);
    expect(step2.completedTaskIds).toEqual([]);
    expect(step2.events.some(e => e.type === 'enter_settling' && e.item === '动员兵班组')).toBe(true);
  });

  it('totalMinutes <= 0 的 active 任务在 deltaMinutes > 0 时保持 active 不推进，并产出 unknown_duration 事件', () => {
    const unknownTask = makeTask({
      id: 'task:unknown:0',
      name: '未知工期特遣项目',
      status: 'active',
      workload: { totalMinutes: 0, spentMinutes: 0 },
    });

    const result = tickTaskOrchestration([unknownTask], [makeLane()], { deltaMinutes: 120 });
    expect(result.nextTasks[0].status).toBe('active');
    expect(result.nextTasks[0].workload.spentMinutes).toBe(0);
    expect(result.settlingTaskIds).toEqual([]);
    expect(result.events).toEqual([
      {
        type: 'unknown_duration',
        item: '未知工期特遣项目',
        base: '基地A',
        detail: 'total_minutes=0（未知工期），进度不推进',
      },
    ]);
  });
});

/* ═══════════════ ⑪ UTO-TICK-01 · 第三阶段：DAG 拓扑依赖触发与零单步跨任务穿透铁律 ═══════════════ */

describe('UTO-TICK-01 · 第三阶段：DAG 拓扑依赖触发与离散步长边界（零单步跨任务穿透）', () => {
  it('🔴 零单步跨任务穿透铁律：前置已 completed 的 draft 节点在本轮解锁为 queued，但绝不在本轮升格 active 或消耗 Δt', () => {
    const engLane = makeLane({
      laneKey: '基地A eng:eng.main',
      domain: 'retrofit',
      capacity: 2, // 工位完全空闲
      locked: false,
    });
    const tasks: UnifiedTask[] = [
      makeTask({
        id: 'task:proj:p1',
        domain: 'retrofit',
        name: '灰熊现代化改装总成',
        laneKey: '基地A eng:eng.main',
        status: 'active',
        workload: { totalMinutes: 2880, spentMinutes: 1440 },
        topology: { subTaskIds: ['task:proj:p1:phase:0', 'task:proj:p1:phase:1'] },
        metadata: { sourceKind: 'project_root', projectId: 'p1' },
      }),
      makeTask({
        id: 'task:proj:p1:phase:0',
        domain: 'retrofit',
        name: '灰熊改装·一期底盘定型',
        laneKey: '基地A eng:eng.main',
        status: 'completed',
        workload: { totalMinutes: 1440, spentMinutes: 1440 },
        topology: { parentId: 'task:proj:p1', dependsOn: [] },
        metadata: { sourceKind: 'project_phase', projectId: 'p1', phaseIdx: 0 },
      }),
      makeTask({
        id: 'task:proj:p1:phase:1',
        domain: 'retrofit',
        name: '灰熊改装·二期火控换装',
        laneKey: '基地A eng:eng.main',
        status: 'draft',
        workload: { totalMinutes: 1440, spentMinutes: 0 },
        topology: { parentId: 'task:proj:p1', dependsOn: ['task:proj:p1:phase:0'] },
        metadata: { sourceKind: 'project_phase', projectId: 'p1', phaseIdx: 1, startedAt: '' },
      }),
    ];

    // 第 1 轮 Tick（Δt = 600）：二期由 draft 解锁为 queued，但本轮不升格为 active，spentMinutes 严格保持 0
    const tick1 = tickTaskOrchestration(deepFreeze(tasks), deepFreeze([engLane]), {
      deltaMinutes: 600,
      now: '第2年4月2日 08:00',
    });

    expect(tick1.unlockedTaskIds).toEqual(['task:proj:p1:phase:1']);
    expect(tick1.promotedTaskIds).toEqual([]);
    const phase1AfterTick1 = tick1.nextTasks.find(t => t.id === 'task:proj:p1:phase:1')!;
    expect(phase1AfterTick1.status).toBe('queued');
    expect(phase1AfterTick1.workload.spentMinutes).toBe(0);

    // 第 2 轮 Tick（Δt = 600）：上一轮已就绪为 queued 的二期在本轮第一阶段升格为 active，并在第二阶段推进 600 分钟
    const tick2 = tickTaskOrchestration(deepFreeze(tick1.nextTasks), deepFreeze([engLane]), {
      deltaMinutes: 600,
      now: '第2年4月2日 18:00',
    });

    expect(tick2.unlockedTaskIds).toEqual([]);
    expect(tick2.promotedTaskIds).toEqual(['task:proj:p1:phase:1']);
    const phase1AfterTick2 = tick2.nextTasks.find(t => t.id === 'task:proj:p1:phase:1')!;
    expect(phase1AfterTick2.status).toBe('active');
    expect(phase1AfterTick2.workload.spentMinutes).toBe(600);
    expect(phase1AfterTick2.metadata?.startedAt).toBe('第2年4月2日 18:00');
  });

  it('V2 多前置汇聚 DAG 拓扑（dependsOn 全部 completed 方解锁）与本轮新进 settling 不提前触发后置解锁', () => {
    const orbitalLane = makeLane({
      laneKey: '基地A eng:eng.orbital',
      domain: 'megastructure',
      capacity: 2,
    });
    const tasks: UnifiedTask[] = [
      makeTask({
        id: 'task:proj:v2:mod:core',
        domain: 'megastructure',
        name: '轨道站·核心舱',
        laneKey: '基地A eng:eng.orbital',
        status: 'completed',
        workload: { totalMinutes: 1000, spentMinutes: 1000 },
        topology: { parentId: 'task:proj:v2', dependsOn: [] },
      }),
      makeTask({
        id: 'task:proj:v2:mod:power',
        domain: 'megastructure',
        name: '轨道站·太阳能翼',
        laneKey: '基地A eng:eng.orbital',
        status: 'active',
        workload: { totalMinutes: 1000, spentMinutes: 900 },
        topology: { parentId: 'task:proj:v2', dependsOn: ['task:proj:v2:mod:core'] },
      }),
      makeTask({
        id: 'task:proj:v2:mod:dock',
        domain: 'megastructure',
        name: '轨道站·总装船坞（依赖 core + power）',
        laneKey: '基地A eng:eng.orbital',
        status: 'draft',
        workload: { totalMinutes: 2000, spentMinutes: 0 },
        topology: { parentId: 'task:proj:v2', dependsOn: ['task:proj:v2:mod:core', 'task:proj:v2:mod:power'] },
      }),
    ];

    // 本轮推进 200 分钟：power 满额转入 settling（尚未经三色门变为 completed），dock 仍不得解锁
    const tickSettling = tickTaskOrchestration(deepFreeze(tasks), deepFreeze([orbitalLane]), {
      deltaMinutes: 200,
    });
    expect(tickSettling.settlingTaskIds).toEqual(['task:proj:v2:mod:power']);
    expect(tickSettling.unlockedTaskIds).toEqual([]);
    expect(tickSettling.nextTasks.find(t => t.id === 'task:proj:v2:mod:dock')?.status).toBe('draft');

    // 模拟外部三色对账门确认 power → completed 后再执行下一轮步进：dock 两个前置全部 completed，成功解锁为 queued
    const afterReconcile = tickSettling.nextTasks.map(t =>
      t.id === 'task:proj:v2:mod:power' ? { ...t, status: 'completed' as const } : t,
    );
    const tickUnlock = tickTaskOrchestration(deepFreeze(afterReconcile), deepFreeze([orbitalLane]), {
      deltaMinutes: 200,
    });
    expect(tickUnlock.unlockedTaskIds).toEqual(['task:proj:v2:mod:dock']);
    const dockTask = tickUnlock.nextTasks.find(t => t.id === 'task:proj:v2:mod:dock')!;
    expect(dockTask.status).toBe('queued');
    expect(dockTask.workload.spentMinutes).toBe(0);
  });

  it('注资/准入守卫（metadata.funded === false 或 ctx.canUnlockDraft）可拦截前置已齐但未注资的 draft 模块', () => {
    const lane = makeLane({ laneKey: '基地A eng:eng.orbital', domain: 'megastructure', capacity: 1 });
    const tasks: UnifiedTask[] = [
      makeTask({
        id: 'task:proj:v2:mod:core',
        domain: 'megastructure',
        status: 'completed',
        topology: { parentId: 'task:proj:v2', dependsOn: [] },
      }),
      makeTask({
        id: 'task:proj:v2:mod:unfunded',
        domain: 'megastructure',
        status: 'draft',
        topology: { parentId: 'task:proj:v2', dependsOn: ['task:proj:v2:mod:core'] },
        metadata: { sourceKind: 'project_module', funded: false },
      }),
      makeTask({
        id: 'task:proj:v2:mod:guarded',
        domain: 'megastructure',
        status: 'draft',
        topology: { parentId: 'task:proj:v2', dependsOn: ['task:proj:v2:mod:core'] },
        metadata: { sourceKind: 'project_module', funded: true },
      }),
    ];

    const blockedRes = tickTaskOrchestration(deepFreeze(tasks), deepFreeze([lane]), {
      deltaMinutes: 100,
      canUnlockDraft: task => task.id !== 'task:proj:v2:mod:guarded',
    });
    expect(blockedRes.unlockedTaskIds).toEqual([]);

    const allowedRes = tickTaskOrchestration(deepFreeze(tasks), deepFreeze([lane]), {
      deltaMinutes: 100,
    });
    expect(allowedRes.unlockedTaskIds).toEqual(['task:proj:v2:mod:guarded']);
  });
});
