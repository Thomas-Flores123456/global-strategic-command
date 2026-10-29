/**
 * dispatchBus.test.ts —— UTO-BUS-01 统一调度指令总线与既有指令转译桥单元测试
 *
 * 真源：
 * - docs/project/plans/通用任务编排器MVP任务包.md（§3.5 / §6 UTO-BUS-01）
 * - docs/design/systems/通用任务编排器总设计案.md（§4 轴四 UnifiedDispatchBus）
 *
 * 覆盖：
 * ① 六动词（Promote / Demote / Hold / Resume / Cancel / Allocate）前置状态约束与副作用 100% 覆盖；
 * ② 免疫态（settling / completed / cancelled）、纯容器节点（project_root）、未知任务与非法动词拒收诊断；
 * ③ 调度前后所有任务 workload.spentMinutes 100% 恒等红线断言；
 * ④ <队列> 四动词（置顶/置底/暂缓/恢复）与 <工程> 指令（暂停/恢复/取消/模块基地指派）双向无损转译桥；
 * ⑤ deepFreeze 入参零突变、返回体深拷贝隔离与导出体纯函数审查。
 */

import { describe, expect, it } from 'vitest';
import * as dispatchBusExports from '../engines/dispatchBus';
import {
  UNIFIED_COMMAND_TYPES,
  applyUnifiedCommands,
  commandTypeToLegacyVerb,
  findTaskForLegacyDispatchOrder,
  fromEngineeringOrder,
  fromEngineeringOrders,
  fromLegacyDispatchOrders,
  legacyVerbToCommandType,
  resolveAllocatedTaskLaneKey,
  toEngineeringCommandText,
  toEngineeringOrder,
  toLegacyDispatchOrder,
  translateLegacyDispatchOrders,
  type UnifiedCommand,
  type UnifiedCommandType,
} from '../engines/dispatchBus';
import type { LaneStationView, TaskStatus, UnifiedTask } from '../engines/taskOrchestrator';
import { applyDispatchOrders, type DispatchOrder, type TransactionItem } from '../engines/transactionEngine';

/* ═══════════════ 测试工具与夹具工厂 ═══════════════ */

/** 递归深冻结入参，验证零原地突变 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** 构造标准统一任务测试夹具 */
function makeTask(overrides: Partial<UnifiedTask> = {}): UnifiedTask {
  return {
    id: 'task:queue:0',
    domain: 'production',
    name: '犀牛主战坦克',
    scope: 'base',
    leadBaseId: '1号基地',
    participatingBases: ['1号基地'],
    laneKey: '1号基地 lane.vehicle_land',
    workload: {
      totalMinutes: 1440,
      spentMinutes: 360,
      minDaysLock: 0,
    },
    status: 'queued',
    costPaid: true,
    batch: { totalQty: 3, completedQty: 0 },
    topology: { dependsOn: [], subTaskIds: [] },
    metadata: {
      sourceKind: 'queue',
      queueIndex: 0,
      rawType: '生产',
      startedAt: '',
      eta: '',
      hold: false,
    },
    ...overrides,
  };
}

/** 构造标准流水线工位快照测试夹具 */
function makeLane(overrides: Partial<LaneStationView> = {}): LaneStationView {
  return {
    laneKey: '1号基地 lane.vehicle_land',
    domain: 'production',
    displayName: '陆地载具生产线',
    baseId: '1号基地',
    capacity: 2,
    globalLimit: Infinity,
    accelMultiplier: 1.0,
    locked: false,
    ...overrides,
  };
}

/** 断言调度前后所有任务的 workload.spentMinutes 100% 恒等 */
function expectSpentMinutesIdentical(before: readonly UnifiedTask[], after: readonly UnifiedTask[]): void {
  const beforeMap = new Map(before.map(t => [t.id, t.workload.spentMinutes]));
  expect(after).toHaveLength(before.length);
  for (const task of after) {
    expect(task.workload.spentMinutes).toBe(beforeMap.get(task.id));
  }
}

/* ═══════════════ ① 常量与纯函数导出契约 ═══════════════ */

describe('UTO-BUS-01 · 常量与纯函数导出契约', () => {
  it('UNIFIED_COMMAND_TYPES 六大标准动词全集且运行时冻结', () => {
    expect([...UNIFIED_COMMAND_TYPES]).toEqual(['Promote', 'Demote', 'Hold', 'Resume', 'Cancel', 'Allocate']);
    expect(Object.isFrozen(UNIFIED_COMMAND_TYPES)).toBe(true);
    expect(() => (UNIFIED_COMMAND_TYPES as unknown as string[]).push('Mutate')).toThrow();
  });

  it('dispatchBus.ts 导出面与编译函数体严守纯函数红线（零 Pinia/Vue/宿主 API/DOM）', () => {
    const exportedValues = Object.values(dispatchBusExports);
    for (const val of exportedValues) {
      expect(['function', 'object']).toContain(typeof val);
    }
    const compiledBodies = exportedValues
      .filter(val => typeof val === 'function')
      .map(fn => String(fn))
      .join('\n');
    expect(compiledBodies).not.toMatch(/\b(pinia|defineStore|getActivePinia)\b/);
    expect(compiledBodies).not.toMatch(/\b(getCurrentInstance|getCurrentMessageId|SillyTavern|TavernHelper|toastr)\b/);
    expect(compiledBodies).not.toMatch(/\b(document|window|localStorage)\s*\./);
  });
});

/* ═══════════════ ② Promote（调升首序 / 对应 <队列> 置顶） ═══════════════ */

describe('UTO-BUS-01 · Promote 调升首序语义与前置约束', () => {
  it('流水线有空余带宽时，queued 任务提至首序并直接升格为 active（补记 startedAt）', () => {
    const lanes = [makeLane({ capacity: 2 })];
    const tasks = [
      makeTask({
        id: 't1',
        name: '灰熊坦克',
        status: 'active',
        workload: { totalMinutes: 1000, spentMinutes: 400 },
        metadata: { sourceKind: 'queue', startedAt: '2026-10-01 08:00' },
      }),
      makeTask({
        id: 't2',
        name: '多功能步兵车',
        status: 'queued',
        workload: { totalMinutes: 800, spentMinutes: 150 },
      }),
      makeTask({
        id: 't3',
        name: '光棱坦克',
        status: 'queued',
        workload: { totalMinutes: 1200, spentMinutes: 220 },
      }),
    ];

    const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Promote', taskId: 't3' }], {
      now: '2026-10-14 10:00',
    });

    expect(res.rejected).toHaveLength(0);
    expect(res.preemptedTaskIds).toEqual([]);
    expect(res.demotions).toEqual([]);
    expect(res.promotedTaskIds).toEqual(['t3']);
    expect(res.nextTasks.map(t => [t.id, t.status])).toEqual([
      ['t3', 'active'],
      ['t1', 'active'],
      ['t2', 'queued'],
    ]);
    expect(res.nextTasks[0].metadata?.startedAt).toBe('2026-10-14 10:00');
    expectSpentMinutesIdentical(tasks, res.nextTasks);
  });

  it('流水线工位已满时，Promote 抢占置换末序 active 任务（被置换者退回 queued 且工时 100% 留存）', () => {
    const lanes = [makeLane({ capacity: 2 })];
    const tasks = [
      makeTask({
        id: 't1',
        name: '犀牛一型',
        status: 'active',
        workload: { totalMinutes: 1000, spentMinutes: 500 },
      }),
      makeTask({
        id: 't2',
        name: '天启坦克',
        status: 'active',
        workload: { totalMinutes: 2000, spentMinutes: 750 },
      }),
      makeTask({
        id: 't3',
        name: '防空履带车',
        status: 'queued',
        workload: { totalMinutes: 600, spentMinutes: 100 },
      }),
      makeTask({
        id: 't4',
        name: 'V3火箭发射车',
        status: 'queued',
        workload: { totalMinutes: 900, spentMinutes: 300 },
      }),
    ];

    const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Promote', taskId: 't4' }]);

    expect(res.rejected).toHaveLength(0);
    expect(res.promotedTaskIds).toEqual(['t4']);
    expect(res.preemptedTaskIds).toEqual(['t2']);
    expect(res.demotions).toEqual([
      {
        taskId: 't2',
        item: '天启坦克',
        base: '1号基地',
        type: '生产',
        laneKey: '1号基地 lane.vehicle_land',
        cause: 'preempt',
      },
    ]);
    // t4 升格为 active 并排在流水线首序；t1 保持 active；被抢占的 t2 退回 queued 且排在 t3 之前
    expect(res.nextTasks.map(t => [t.id, t.status, t.workload.spentMinutes])).toEqual([
      ['t4', 'active', 300],
      ['t1', 'active', 500],
      ['t2', 'queued', 750],
      ['t3', 'queued', 100],
    ]);
    expectSpentMinutesIdentical(tasks, res.nextTasks);
  });

  it('流水线 capacity === 0 或 locked === true 时，Promote 仅提至候列第 1 位并保持 queued', () => {
    const lockedLanes = [makeLane({ capacity: 0, locked: true })];
    const tasks = [
      makeTask({ id: 'q1', name: '候列一', status: 'queued', workload: { totalMinutes: 500, spentMinutes: 50 } }),
      makeTask({ id: 'q2', name: '候列二', status: 'queued', workload: { totalMinutes: 500, spentMinutes: 80 } }),
      makeTask({ id: 'q3', name: '候列三', status: 'queued', workload: { totalMinutes: 500, spentMinutes: 120 } }),
    ];

    const res = applyUnifiedCommands(tasks, lockedLanes, [{ type: 'Promote', taskId: 'q3' }]);

    expect(res.rejected).toHaveLength(0);
    expect(res.promotedTaskIds).toEqual([]);
    expect(res.preemptedTaskIds).toEqual([]);
    expect(res.demotions).toEqual([]);
    expect(res.nextTasks.map(t => [t.id, t.status])).toEqual([
      ['q3', 'queued'],
      ['q1', 'queued'],
      ['q2', 'queued'],
    ]);
    expectSpentMinutesIdentical(tasks, res.nextTasks);
  });

  it('同领域 globalLimit 被其他流水线占满且本流水线无 active 时，Promote 仅提至本流水线候列首序不越权升格', () => {
    const lanes: LaneStationView[] = [
      makeLane({ laneKey: 'research:slot.main', domain: 'research', baseId: undefined, capacity: 1, globalLimit: 1 }),
      makeLane({ laneKey: 'research:slot.armor', domain: 'research', baseId: undefined, capacity: 1, globalLimit: 1 }),
    ];
    const tasks = [
      makeTask({
        id: 'r_main',
        domain: 'research',
        scope: 'theater',
        laneKey: 'research:slot.main',
        status: 'active',
        workload: { totalMinutes: 1440, spentMinutes: 200 },
      }),
      makeTask({
        id: 'r_armor_1',
        domain: 'research',
        scope: 'theater',
        laneKey: 'research:slot.armor',
        status: 'queued',
        workload: { totalMinutes: 1440, spentMinutes: 0 },
      }),
      makeTask({
        id: 'r_armor_2',
        domain: 'research',
        scope: 'theater',
        laneKey: 'research:slot.armor',
        status: 'queued',
        workload: { totalMinutes: 1440, spentMinutes: 100 },
      }),
    ];

    const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Promote', taskId: 'r_armor_2' }]);

    expect(res.rejected).toHaveLength(0);
    expect(res.promotedTaskIds).toEqual([]);
    expect(res.nextTasks.map(t => [t.id, t.status])).toEqual([
      ['r_main', 'active'],
      ['r_armor_2', 'queued'],
      ['r_armor_1', 'queued'],
    ]);
  });

  it.each(['active', 'held', 'draft'] as const)(
    'Promote 对非 queued 状态（%s）准确拒收并记入 rejected（invalid_status）',
    status => {
      const lanes = [makeLane({ capacity: 2 })];
      const tasks = [makeTask({ id: 't_invalid', status })];
      const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Promote', taskId: 't_invalid' }]);

      expect(res.rejected).toHaveLength(1);
      expect(res.rejected[0].taskId).toBe('t_invalid');
      expect(res.rejected[0].reason).toBe('invalid_status');
      expect(res.rejected[0].command).toEqual({ type: 'Promote', taskId: 't_invalid' });
      expect(res.nextTasks[0].status).toBe(status);
    },
  );
});

/* ═══════════════ ③ Demote（移送末序 / 对应 <队列> 置底） ═══════════════ */

describe('UTO-BUS-01 · Demote 移送末序语义与前置约束', () => {
  it('active 任务执行 Demote：退回 queued 移至队尾，记录 demotions，并由首序 queued 候列项自动递补升格', () => {
    const lanes = [makeLane({ capacity: 1 })];
    const tasks = [
      makeTask({
        id: 't1',
        name: '在编坦克',
        status: 'active',
        workload: { totalMinutes: 1000, spentMinutes: 640 },
      }),
      makeTask({
        id: 't2',
        name: '候列首车',
        status: 'queued',
        workload: { totalMinutes: 1000, spentMinutes: 120 },
      }),
      makeTask({
        id: 't3',
        name: '候列次车',
        status: 'queued',
        workload: { totalMinutes: 1000, spentMinutes: 0 },
      }),
    ];

    const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Demote', taskId: 't1' }]);

    expect(res.rejected).toHaveLength(0);
    expect(res.promotedTaskIds).toEqual(['t2']);
    expect(res.demotions).toEqual([
      {
        taskId: 't1',
        item: '在编坦克',
        base: '1号基地',
        type: '生产',
        laneKey: '1号基地 lane.vehicle_land',
        cause: 'demote',
      },
    ]);
    expect(res.nextTasks.map(t => [t.id, t.status, t.workload.spentMinutes])).toEqual([
      ['t2', 'active', 120],
      ['t3', 'queued', 0],
      ['t1', 'queued', 640],
    ]);
    expectSpentMinutesIdentical(tasks, res.nextTasks);
  });

  it('流水线仅有唯一 active 任务且无其他候列项时，Demote 退回 queued 不触发自身原地重升格', () => {
    const lanes = [makeLane({ capacity: 1 })];
    const tasks = [
      makeTask({
        id: 't_only',
        name: '独苗在编任务',
        status: 'active',
        workload: { totalMinutes: 1000, spentMinutes: 450 },
      }),
    ];

    const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Demote', taskId: 't_only' }]);

    expect(res.rejected).toHaveLength(0);
    expect(res.promotedTaskIds).toEqual([]);
    expect(res.demotions).toHaveLength(1);
    expect(res.demotions[0].cause).toBe('demote');
    expect(res.nextTasks[0].status).toBe('queued');
    expect(res.nextTasks[0].workload.spentMinutes).toBe(450);
  });

  it('queued 任务执行 Demote：仅移至该流水线队尾，保持 queued，不产出 demotions', () => {
    const lanes = [makeLane({ capacity: 1 })];
    const tasks = [
      makeTask({ id: 't1', status: 'active', workload: { totalMinutes: 1000, spentMinutes: 200 } }),
      makeTask({ id: 't2', status: 'queued', workload: { totalMinutes: 1000, spentMinutes: 90 } }),
      makeTask({ id: 't3', status: 'queued', workload: { totalMinutes: 1000, spentMinutes: 30 } }),
    ];

    const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Demote', taskId: 't2' }]);

    expect(res.rejected).toHaveLength(0);
    expect(res.demotions).toEqual([]);
    expect(res.promotedTaskIds).toEqual([]);
    expect(res.nextTasks.map(t => [t.id, t.status])).toEqual([
      ['t1', 'active'],
      ['t3', 'queued'],
      ['t2', 'queued'],
    ]);
    expectSpentMinutesIdentical(tasks, res.nextTasks);
  });

  it.each(['held', 'draft'] as const)('Demote 对 %s 状态任务准确拒收（invalid_status）', status => {
    const lanes = [makeLane({ capacity: 1 })];
    const tasks = [makeTask({ id: 't_bad', status })];
    const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Demote', taskId: 't_bad' }]);

    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].reason).toBe('invalid_status');
  });
});

/* ═══════════════ ④ Hold（工务暂缓 / 对应 <队列> 暂缓、<工程> 暂停） ═══════════════ */

describe('UTO-BUS-01 · Hold 工务暂缓语义与前置约束', () => {
  it('active 任务执行 Hold：转为 held、保留 spentMinutes、记入 demotions，并由首序 queued 递补升格', () => {
    const lanes = [makeLane({ capacity: 1 })];
    const tasks = [
      makeTask({
        id: 't1',
        name: '在编基洛夫',
        status: 'active',
        workload: { totalMinutes: 2880, spentMinutes: 1200 },
        metadata: { sourceKind: 'queue', hold: false },
      }),
      makeTask({
        id: 't2',
        name: '候列米格',
        status: 'queued',
        workload: { totalMinutes: 1440, spentMinutes: 80 },
        metadata: { sourceKind: 'queue', hold: false },
      }),
    ];

    const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Hold', taskId: 't1' }]);

    expect(res.rejected).toHaveLength(0);
    expect(res.promotedTaskIds).toEqual(['t2']);
    expect(res.demotions).toEqual([
      {
        taskId: 't1',
        item: '在编基洛夫',
        base: '1号基地',
        type: '生产',
        laneKey: '1号基地 lane.vehicle_land',
        cause: 'hold',
      },
    ]);
    expect(res.nextTasks[0].status).toBe('held');
    expect(res.nextTasks[0].metadata?.hold).toBe(true);
    expect(res.nextTasks[0].workload.spentMinutes).toBe(1200);
    expect(res.nextTasks[1].status).toBe('active');
    expectSpentMinutesIdentical(tasks, res.nextTasks);
  });

  it('queued 任务执行 Hold：转为 held，不记入 demotions，不触发额外升格', () => {
    const lanes = [makeLane({ capacity: 1 })];
    const tasks = [
      makeTask({ id: 't1', status: 'active', workload: { totalMinutes: 1000, spentMinutes: 100 } }),
      makeTask({ id: 't2', status: 'queued', workload: { totalMinutes: 1000, spentMinutes: 250 } }),
    ];

    const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Hold', taskId: 't2' }]);

    expect(res.rejected).toHaveLength(0);
    expect(res.demotions).toEqual([]);
    expect(res.promotedTaskIds).toEqual([]);
    expect(res.nextTasks[1].status).toBe('held');
    expect(res.nextTasks[1].workload.spentMinutes).toBe(250);
  });

  it.each(['held', 'draft'] as const)('Hold 对 %s 状态任务准确拒收（invalid_status）', status => {
    const lanes = [makeLane({ capacity: 1 })];
    const tasks = [makeTask({ id: 't_hold_bad', status })];
    const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Hold', taskId: 't_hold_bad' }]);

    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].reason).toBe('invalid_status');
  });
});

/* ═══════════════ ⑤ Resume（解除暂缓 / 对应 <队列> 恢复、<工程> 恢复） ═══════════════ */

describe('UTO-BUS-01 · Resume 解除暂缓语义与前置约束', () => {
  it('held 任务在流水线有空余容量时执行 Resume：恢复并即时升格为 active', () => {
    const lanes = [makeLane({ capacity: 2 })];
    const tasks = [
      makeTask({ id: 't1', status: 'active', workload: { totalMinutes: 1000, spentMinutes: 300 } }),
      makeTask({
        id: 't2',
        status: 'held',
        workload: { totalMinutes: 1000, spentMinutes: 550 },
        metadata: { sourceKind: 'queue', hold: true },
      }),
    ];

    const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Resume', taskId: 't2' }]);

    expect(res.rejected).toHaveLength(0);
    expect(res.promotedTaskIds).toEqual(['t2']);
    expect(res.nextTasks[1].status).toBe('active');
    expect(res.nextTasks[1].metadata?.hold).toBe(false);
    expect(res.nextTasks[1].workload.spentMinutes).toBe(550);
    expectSpentMinutesIdentical(tasks, res.nextTasks);
  });

  it('held 任务在流水线满员或锁定时执行 Resume：恢复为 queued 留在候列等待', () => {
    const lanes = [makeLane({ capacity: 1 })];
    const tasks = [
      makeTask({ id: 't1', status: 'active', workload: { totalMinutes: 1000, spentMinutes: 300 } }),
      makeTask({ id: 't2', status: 'held', workload: { totalMinutes: 1000, spentMinutes: 550 } }),
    ];

    const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Resume', taskId: 't2' }]);

    expect(res.rejected).toHaveLength(0);
    expect(res.promotedTaskIds).toEqual([]);
    expect(res.nextTasks[1].status).toBe('queued');
    expect(res.nextTasks[1].workload.spentMinutes).toBe(550);
  });

  it.each(['queued', 'active', 'draft'] as const)('Resume 对非 held 状态（%s）准确拒收（invalid_status）', status => {
    const lanes = [makeLane({ capacity: 1 })];
    const tasks = [makeTask({ id: 't_resume_bad', status })];
    const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Resume', taskId: 't_resume_bad' }]);

    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].reason).toBe('invalid_status');
  });
});

/* ═══════════════ ⑥ Cancel（工程/任务撤销 / 对应 <工程> 取消） ═══════════════ */

describe('UTO-BUS-01 · Cancel 任务撤销语义与前置约束', () => {
  it.each(['draft', 'queued', 'held'] as const)(
    '非在编非终态（%s）任务执行 Cancel：直接转为 cancelled 且工时恒等',
    status => {
      const lanes = [makeLane({ capacity: 1 })];
      const tasks = [makeTask({ id: 't_cancel', status, workload: { totalMinutes: 1440, spentMinutes: 333 } })];
      const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Cancel', taskId: 't_cancel' }]);

      expect(res.rejected).toHaveLength(0);
      expect(res.promotedTaskIds).toEqual([]);
      expect(res.nextTasks[0].status).toBe('cancelled');
      expect(res.nextTasks[0].workload.spentMinutes).toBe(333);
    },
  );

  it('active 任务执行 Cancel：转为 cancelled 释放工位，由同流水线首序 queued 任务自动递补升格', () => {
    const lanes = [makeLane({ laneKey: '1号基地 eng:eng.orbital', domain: 'retrofit', capacity: 1 })];
    const tasks = [
      makeTask({
        id: 'task:proj:p1:mod:core',
        domain: 'megastructure',
        name: '天基船坞·核心舱',
        laneKey: '1号基地 eng:eng.orbital',
        status: 'active',
        workload: { totalMinutes: 2880, spentMinutes: 960 },
      }),
      makeTask({
        id: 'task:proj:p1:mod:solar',
        domain: 'megastructure',
        name: '天基船坞·光伏翼',
        laneKey: '1号基地 eng:eng.orbital',
        status: 'queued',
        workload: { totalMinutes: 1440, spentMinutes: 120 },
      }),
    ];

    const res = applyUnifiedCommands(tasks, lanes, [{ type: 'Cancel', taskId: 'task:proj:p1:mod:core' }]);

    expect(res.rejected).toHaveLength(0);
    expect(res.promotedTaskIds).toEqual(['task:proj:p1:mod:solar']);
    expect(res.nextTasks[0].status).toBe('cancelled');
    expect(res.nextTasks[0].workload.spentMinutes).toBe(960);
    expect(res.nextTasks[1].status).toBe('active');
    expect(res.nextTasks[1].workload.spentMinutes).toBe(120);
    expectSpentMinutesIdentical(tasks, res.nextTasks);
  });
});

/* ═══════════════ ⑦ Allocate（承建指派 / 对应 <工程> 模块基地指派） ═══════════════ */

describe('UTO-BUS-01 · Allocate 承建指派语义与前置约束', () => {
  it('scope === "theater" 且 status === "draft" 的任务执行 Allocate：更新 leadBaseId、participatingBases 并重算属地工程槽 laneKey', () => {
    const lanes: LaneStationView[] = [
      makeLane({
        laneKey: '1号基地 eng:eng.orbital',
        domain: 'retrofit',
        displayName: '轨道组装泊位',
        baseId: '1号基地',
        capacity: 1,
      }),
      makeLane({
        laneKey: '2号基地 eng:eng.orbital',
        domain: 'retrofit',
        displayName: '轨道组装泊位',
        baseId: '2号基地',
        capacity: 1,
      }),
    ];
    const tasks = [
      makeTask({
        id: 'task:proj:orbital_dock:mod:dock_arm',
        domain: 'megastructure',
        name: '轨道船坞·机械臂舱段',
        scope: 'theater',
        leadBaseId: '1号基地',
        participatingBases: ['1号基地'],
        laneKey: '1号基地 eng:eng.orbital',
        status: 'draft',
        workload: { totalMinutes: 4320, spentMinutes: 0 },
        metadata: {
          sourceKind: 'project_module',
          projectId: 'proj:轨道船坞@1号基地',
          moduleId: 'dock_arm',
          base: '1号基地',
        },
      }),
    ];

    const res = applyUnifiedCommands(tasks, lanes, [
      { type: 'Allocate', taskId: 'task:proj:orbital_dock:mod:dock_arm', baseId: '2号基地' },
    ]);

    expect(res.rejected).toHaveLength(0);
    const updated = res.nextTasks[0];
    expect(updated.leadBaseId).toBe('2号基地');
    expect(updated.laneKey).toBe('2号基地 eng:eng.orbital');
    expect(updated.participatingBases).toEqual(['1号基地', '2号基地']);
    expect(updated.metadata?.base).toBe('2号基地');
    expect(updated.status).toBe('draft');
    expectSpentMinutesIdentical(tasks, res.nextTasks);
  });

  it('Allocate 支持自定义 resolveAllocatedLaneKey 钩子与命名产线前缀替换', () => {
    const task = makeTask({
      id: 'task:proj:coop:phase:1',
      domain: 'retrofit',
      scope: 'theater',
      leadBaseId: '北极基地',
      laneKey: '北极基地:lane.equipment',
      status: 'draft',
    });

    // 默认前缀替换
    const resDefault = applyUnifiedCommands([task], [], [{ type: 'Allocate', taskId: task.id, baseId: '远东基地' }]);
    expect(resDefault.rejected).toHaveLength(0);
    expect(resDefault.nextTasks[0].leadBaseId).toBe('远东基地');
    expect(resDefault.nextTasks[0].laneKey).toBe('远东基地:lane.equipment');

    // 自定义钩子
    const resHook = applyUnifiedCommands([task], [], [{ type: 'Allocate', taskId: task.id, baseId: '远东基地' }], {
      resolveAllocatedLaneKey: (t, baseId) => `custom:${baseId}:${t.domain}`,
    });
    expect(resHook.nextTasks[0].laneKey).toBe('custom:远东基地:retrofit');
    expect(resolveAllocatedTaskLaneKey(task, '远东基地', [])).toBe('远东基地:lane.equipment');
  });

  it('Allocate 对 scope === "base" 任务准确拒收（invalid_scope）', () => {
    const task = makeTask({
      id: 't_base_scope',
      scope: 'base',
      status: 'draft',
    });

    const res = applyUnifiedCommands([task], [], [{ type: 'Allocate', taskId: 't_base_scope', baseId: '2号基地' }]);

    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].reason).toBe('invalid_scope');
    expect(res.nextTasks[0].leadBaseId).toBe('1号基地');
  });

  it.each(['queued', 'active', 'held'] as const)(
    'Allocate 对非 draft 状态（%s）的 theater 任务准确拒收（invalid_status）',
    status => {
      const task = makeTask({
        id: 't_theater_non_draft',
        scope: 'theater',
        status,
      });

      const res = applyUnifiedCommands(
        [task],
        [],
        [{ type: 'Allocate', taskId: 't_theater_non_draft', baseId: '2号基地' }],
      );

      expect(res.rejected).toHaveLength(1);
      expect(res.rejected[0].reason).toBe('invalid_status');
    },
  );

  it('Allocate 对空 baseId 或纯空白 baseId 准确拒收（missing_base_id）', () => {
    const task = makeTask({
      id: 't_theater_draft',
      scope: 'theater',
      status: 'draft',
    });

    const res = applyUnifiedCommands([task], [], [{ type: 'Allocate', taskId: 't_theater_draft', baseId: '   ' }]);

    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].reason).toBe('missing_base_id');
  });
});

/* ═══════════════ ⑧ 免疫态、容器节点、不存在任务与非法指令全面拒收矩阵 ═══════════════ */

describe('UTO-BUS-01 · 免疫态（settling / completed / cancelled）与边界拒收守卫', () => {
  const immuneStatuses: readonly TaskStatus[] = ['settling', 'completed', 'cancelled'];
  const allCommandTypes: readonly UnifiedCommandType[] = ['Promote', 'Demote', 'Hold', 'Resume', 'Cancel', 'Allocate'];

  it.each(immuneStatuses.flatMap(status => allCommandTypes.map(cmdType => ({ status, cmdType }))))(
    '免疫态 $status 下执行 $cmdType 一律拒收并产出 reason="immune_status"',
    ({ status, cmdType }) => {
      const task = makeTask({
        id: 't_immune',
        scope: 'theater',
        status,
        workload: { totalMinutes: 1440, spentMinutes: 1440 },
      });
      const command: UnifiedCommand =
        cmdType === 'Allocate'
          ? { type: 'Allocate', taskId: 't_immune', baseId: '2号基地' }
          : { type: cmdType, taskId: 't_immune' };

      const res = applyUnifiedCommands([task], [makeLane()], [command]);

      expect(res.rejected).toHaveLength(1);
      expect(res.rejected[0].taskId).toBe('t_immune');
      expect(res.rejected[0].reason).toBe('immune_status');
      expect(res.nextTasks[0].status).toBe(status);
      expect(res.nextTasks[0].workload.spentMinutes).toBe(1440);
    },
  );

  it('对不存在的 taskId、project_root 容器节点及非法动词准确拒收', () => {
    const rootContainer = makeTask({
      id: 'task:proj:p1',
      domain: 'megastructure',
      name: '天基轨道船坞',
      scope: 'theater',
      status: 'active',
      topology: { subTaskIds: ['task:proj:p1:mod:core'] },
      metadata: { sourceKind: 'project_root', projectId: 'proj:天基轨道船坞@1号基地' },
    });

    const commands: UnifiedCommand[] = [
      { type: 'Promote', taskId: 'task:not_exist' },
      { type: 'Hold', taskId: 'task:proj:p1' },
      { type: 'UnknownVerb' as unknown as 'Promote', taskId: 'task:proj:p1' },
    ];

    const res = applyUnifiedCommands([rootContainer], [makeLane()], commands);

    expect(res.rejected).toHaveLength(3);
    expect(res.rejected[0].reason).toBe('task_not_found');
    expect(res.rejected[1].reason).toBe('invalid_status');
    expect(res.rejected[2].reason).toBe('invalid_verb');
  });
});

/* ═══════════════ ⑨ 双向无损转译桥（<队列> 四动词 & <工程> 指令） ═══════════════ */

describe('UTO-BUS-01 · <队列> 四动词与 <工程> 指令双向无损转译桥', () => {
  it('fromLegacyDispatchOrders 与 toLegacyDispatchOrder 覆盖四动词双向转译及 canon 宽容消歧', () => {
    const tasks: UnifiedTask[] = [
      makeTask({
        id: 'task:queue:0',
        name: '犀牛主战坦克',
        leadBaseId: '1号基地',
        status: 'active',
        metadata: { sourceKind: 'queue', rawType: '生产' },
      }),
      makeTask({
        id: 'task:queue:1',
        name: '犀牛主战坦克',
        leadBaseId: '2号基地',
        status: 'queued',
        metadata: { sourceKind: 'queue', rawType: '生产' },
      }),
      makeTask({
        id: 'task:queue:2',
        name: '磁暴线圈',
        leadBaseId: '1号基地',
        domain: 'construction',
        status: 'held',
        metadata: { sourceKind: 'queue', rawType: '建造' },
      }),
    ];

    const legacyOrders: DispatchOrder[] = [
      { item: '犀牛主战坦克', base: '2号基地', type: '生产', verb: '置顶' },
      { item: '犀牛主战坦克', base: '1号基地', type: '生产', verb: '置底' },
      { item: '犀牛主战坦克', base: '1号基地', type: '生产', verb: '暂缓' },
      { item: '磁暴线圈', base: '１号基地', type: '建造', verb: '恢复' }, // 全角数字 canon 宽容匹配
    ];

    const unified = fromLegacyDispatchOrders(legacyOrders, tasks);
    expect(unified).toEqual([
      { type: 'Promote', taskId: 'task:queue:1' },
      { type: 'Demote', taskId: 'task:queue:0' },
      { type: 'Hold', taskId: 'task:queue:0' },
      { type: 'Resume', taskId: 'task:queue:2' },
    ]);

    // 反向转译回 DispatchOrder
    expect(toLegacyDispatchOrder(unified[0], tasks)).toEqual({
      item: '犀牛主战坦克',
      base: '2号基地',
      type: '生产',
      verb: '置顶',
    });
    expect(toLegacyDispatchOrder(unified[1], tasks)).toEqual({
      item: '犀牛主战坦克',
      base: '1号基地',
      type: '生产',
      verb: '置底',
    });
    expect(toLegacyDispatchOrder(unified[2], tasks)).toEqual({
      item: '犀牛主战坦克',
      base: '1号基地',
      type: '生产',
      verb: '暂缓',
    });
    expect(toLegacyDispatchOrder(unified[3], tasks)).toEqual({
      item: '磁暴线圈',
      base: '1号基地',
      type: '建造',
      verb: '恢复',
    });
    expect(toLegacyDispatchOrder({ type: 'Cancel', taskId: 'task:queue:0' }, tasks)).toBeNull();
    expect(legacyVerbToCommandType('未知')).toBeUndefined();
    expect(commandTypeToLegacyVerb('Allocate')).toBeUndefined();
    expect(findTaskForLegacyDispatchOrder(tasks, { item: '不存在', verb: '置顶' })).toBeUndefined();
  });

  it('fromLegacyDispatchOrders + applyUnifiedCommands 与 transactionEngine.applyDispatchOrders 黄金对照一致', () => {
    const txns: TransactionItem[] = [
      {
        type: '生产',
        item: '灰熊坦克',
        base: '1号基地',
        progress: 40,
        eta: '',
        status: 'active',
        started_at: '',
        total_minutes: 1000,
        spent_minutes: 400,
        qty: 1,
        qty_done: 0,
        cost_paid: true,
        min_days_lock: 0,
        hold: false,
      },
      {
        type: '生产',
        item: '多功能步兵车',
        base: '1号基地',
        progress: 20,
        eta: '',
        status: 'queued',
        started_at: '',
        total_minutes: 1000,
        spent_minutes: 200,
        qty: 1,
        qty_done: 0,
        cost_paid: true,
        min_days_lock: 0,
        hold: false,
      },
    ];

    const tasks: UnifiedTask[] = [
      makeTask({
        id: 'task:queue:0',
        name: '灰熊坦克',
        leadBaseId: '1号基地',
        laneKey: '1号基地\0生产',
        status: 'active',
        workload: { totalMinutes: 1000, spentMinutes: 400 },
        metadata: { sourceKind: 'queue', rawType: '生产', hold: false },
      }),
      makeTask({
        id: 'task:queue:1',
        name: '多功能步兵车',
        leadBaseId: '1号基地',
        laneKey: '1号基地\0生产',
        status: 'queued',
        workload: { totalMinutes: 1000, spentMinutes: 200 },
        metadata: { sourceKind: 'queue', rawType: '生产', hold: false },
      }),
    ];
    const lanes = [makeLane({ laneKey: '1号基地\0生产', capacity: 1 })];

    const orders: DispatchOrder[] = [
      { item: '多功能步兵车', base: '1号基地', type: '生产', verb: '置顶' },
      { item: '幽灵坦克', base: '1号基地', type: '生产', verb: '置顶' },
      { item: '灰熊坦克', base: '1号基地', type: '生产', verb: '跃迁' },
    ];

    const legacyRes = applyDispatchOrders(txns, orders, { parallelLimitFor: () => 1 });
    const translated = translateLegacyDispatchOrders(orders, tasks);
    expect(translated.unmatchedOrders).toHaveLength(1);
    expect(translated.invalidVerbOrders).toHaveLength(1);

    const busCmds = fromLegacyDispatchOrders(orders, tasks);
    const busRes = applyUnifiedCommands(tasks, lanes, busCmds);

    expect(busRes.demotions.map(d => ({ item: d.item, base: d.base, type: d.type, cause: d.cause }))).toEqual(
      legacyRes.demotions,
    );
    expect(busRes.rejected).toHaveLength(legacyRes.rejected.length);
    expect(busRes.rejected[0].order).toEqual(legacyRes.rejected[0].order);
    expect(busRes.rejected[0].reason).toBe('task_not_found');
    expect(busRes.rejected[1].order).toEqual(legacyRes.rejected[1].order);
    expect(busRes.rejected[1].reason).toBe('invalid_verb');
    expect(busRes.nextTasks.map(t => t.name)).toEqual(legacyRes.next.map(t => t.item));

    // skipUnmatched 模式验证
    const unmatchedBucket: DispatchOrder[] = [];
    const filteredCmds = fromLegacyDispatchOrders(orders, tasks, {
      skipUnmatched: true,
      unmatchedOrders: unmatchedBucket,
    });
    expect(filteredCmds).toEqual([{ type: 'Promote', taskId: 'task:queue:1' }]);
    expect(unmatchedBucket).toHaveLength(2);
  });

  it('fromEngineeringOrder / toEngineeringOrder / toEngineeringCommandText 覆盖工程级与模块级指令转译', () => {
    const projectId = 'proj:天基轨道船坞@1号基地';
    const rootId = `task:proj:${projectId}`;
    const engTasks: UnifiedTask[] = [
      makeTask({
        id: rootId,
        domain: 'megastructure',
        name: '天基轨道船坞',
        scope: 'theater',
        leadBaseId: '1号基地',
        laneKey: '1号基地 eng:eng.orbital',
        status: 'active',
        topology: {
          subTaskIds: [`${rootId}:mod:core`, `${rootId}:mod:hab`, `${rootId}:mod:dock`],
        },
        metadata: { sourceKind: 'project_root', projectId },
      }),
      makeTask({
        id: `${rootId}:mod:core`,
        domain: 'megastructure',
        name: '天基轨道船坞·核心舱段',
        scope: 'theater',
        leadBaseId: '1号基地',
        laneKey: '1号基地 eng:eng.orbital',
        status: 'active',
        workload: { totalMinutes: 2880, spentMinutes: 720 },
        topology: { parentId: rootId, dependsOn: [] },
        metadata: { sourceKind: 'project_module', projectId, moduleId: 'core' },
      }),
      makeTask({
        id: `${rootId}:mod:hab`,
        domain: 'megastructure',
        name: '天基轨道船坞·生活舱段',
        scope: 'theater',
        leadBaseId: '1号基地',
        laneKey: '1号基地 eng:eng.orbital',
        status: 'held',
        workload: { totalMinutes: 1440, spentMinutes: 300 },
        topology: { parentId: rootId, dependsOn: [`${rootId}:mod:core`] },
        metadata: { sourceKind: 'project_module', projectId, moduleId: 'hab' },
      }),
      makeTask({
        id: `${rootId}:mod:dock`,
        domain: 'megastructure',
        name: '天基轨道船坞·船坞臂舱段',
        scope: 'theater',
        leadBaseId: '1号基地',
        laneKey: '1号基地 eng:eng.orbital',
        status: 'draft',
        workload: { totalMinutes: 4320, spentMinutes: 0 },
        topology: { parentId: rootId, dependsOn: [`${rootId}:mod:core`] },
        metadata: { sourceKind: 'project_module', projectId, moduleId: 'dock' },
      }),
    ];

    // 模块级暂停/恢复/基地指派转译
    const pauseModCmds = fromEngineeringOrder({ verb: '暂停', id: projectId, module: '核心舱段' }, engTasks);
    expect(pauseModCmds).toEqual([{ type: 'Hold', taskId: `${rootId}:mod:core` }]);
    expect(toEngineeringOrder(pauseModCmds[0], engTasks)).toEqual({
      verb: '暂停',
      id: projectId,
      module: 'core',
    });
    expect(toEngineeringCommandText(pauseModCmds[0], engTasks)).toBe(`【工程指令】暂停「${projectId}」核心舱段`);

    const resumeModCmds = fromEngineeringOrder({ verb: '恢复', id: projectId, module: 'hab' }, engTasks);
    expect(resumeModCmds).toEqual([{ type: 'Resume', taskId: `${rootId}:mod:hab` }]);
    expect(toEngineeringCommandText(resumeModCmds[0], engTasks)).toBe(`【工程指令】恢复「${projectId}」生活舱段`);

    const allocateModCmds = fromEngineeringOrder(
      { verb: '指派', id: projectId, module: 'dock', base: '2号基地' },
      engTasks,
    );
    expect(allocateModCmds).toEqual([{ type: 'Allocate', taskId: `${rootId}:mod:dock`, baseId: '2号基地' }]);
    expect(toEngineeringOrder(allocateModCmds[0], engTasks)).toEqual({
      verb: '注资',
      id: projectId,
      module: 'dock',
      base: '2号基地',
    });
    expect(toEngineeringCommandText(allocateModCmds[0], engTasks)).toBe(
      `【工程指令】指派「${projectId}」船坞臂舱段，承建基地：2号基地`,
    );

    // 工程级取消转译
    const cancelProjCmds = fromEngineeringOrders([{ verb: '取消', id: projectId }], engTasks);
    expect(cancelProjCmds).toEqual([
      { type: 'Cancel', taskId: `${rootId}:mod:core` },
      { type: 'Cancel', taskId: `${rootId}:mod:hab` },
      { type: 'Cancel', taskId: `${rootId}:mod:dock` },
    ]);
    expect(toEngineeringCommandText(cancelProjCmds[0], engTasks)).toBe(`【工程指令】取消「${projectId}」`);
  });
});

/* ═══════════════ ⑩ deepFreeze 入参零突变与混合指令流水线不变量 ═══════════════ */

describe('UTO-BUS-01 · deepFreeze 入参不可变性与混合批次工时恒等', () => {
  it('深冻结 tasks / lanes / commands 入参执行六动词混合批次零抛错、零突变，且返回体修改不回渗', () => {
    const lanes = deepFreeze([
      makeLane({ laneKey: '1号基地 lane.vehicle_land', capacity: 1 }),
      makeLane({ laneKey: '1号基地 eng:eng.orbital', domain: 'retrofit', baseId: '1号基地', capacity: 1 }),
      makeLane({ laneKey: '2号基地 eng:eng.orbital', domain: 'retrofit', baseId: '2号基地', capacity: 1 }),
    ]);

    const tasks = deepFreeze([
      makeTask({
        id: 'q1',
        name: '灰熊坦克',
        status: 'active',
        workload: { totalMinutes: 1000, spentMinutes: 512 },
      }),
      makeTask({
        id: 'q2',
        name: '光棱坦克',
        status: 'queued',
        workload: { totalMinutes: 1200, spentMinutes: 256 },
      }),
      makeTask({
        id: 'q3',
        name: '幻影坦克',
        status: 'held',
        workload: { totalMinutes: 900, spentMinutes: 128 },
      }),
      makeTask({
        id: 'm1',
        domain: 'megastructure',
        name: '天基船坞·实验舱',
        scope: 'theater',
        leadBaseId: '1号基地',
        participatingBases: ['1号基地'],
        laneKey: '1号基地 eng:eng.orbital',
        status: 'draft',
        workload: { totalMinutes: 2880, spentMinutes: 0 },
      }),
    ]);

    const commands = deepFreeze<UnifiedCommand[]>([
      { type: 'Promote', taskId: 'q2' }, // q2 抢占 q1 升格 active
      { type: 'Hold', taskId: 'q2' }, // q2 暂缓让位，q1 重新递补升格 active
      { type: 'Resume', taskId: 'q3' }, // q3 恢复为 queued
      { type: 'Demote', taskId: 'q1' }, // q1 置底退回 queued，q3 递补升格 active
      { type: 'Allocate', taskId: 'm1', baseId: '2号基地' }, // m1 改派 2号基地
      { type: 'Cancel', taskId: 'q2' }, // q2 撤销为 cancelled
    ]);

    const snapshotBefore = JSON.stringify({ tasks, lanes, commands });
    const res = applyUnifiedCommands(tasks, lanes, commands, { now: '2026-10-14 12:00' });

    // 入参 100% 零突变
    expect(JSON.stringify({ tasks, lanes, commands })).toBe(snapshotBefore);

    // 混合批次后所有任务的 spentMinutes 100% 恒等
    expectSpentMinutesIdentical(tasks, res.nextTasks);

    // 最终状态核对
    const byId = new Map(res.nextTasks.map(t => [t.id, t]));
    expect(byId.get('q3')?.status).toBe('active');
    expect(byId.get('q1')?.status).toBe('queued');
    expect(byId.get('q2')?.status).toBe('cancelled');
    expect(byId.get('m1')?.leadBaseId).toBe('2号基地');
    expect(byId.get('m1')?.laneKey).toBe('2号基地 eng:eng.orbital');

    // 修改返回体绝不回渗入参
    res.nextTasks[0].workload.spentMinutes = 999999;
    expect(tasks[0].workload.spentMinutes).toBe(512);
  });
});
