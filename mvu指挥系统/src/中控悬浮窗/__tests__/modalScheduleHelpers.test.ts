/**
 * modalScheduleHelpers.test.ts —— PKG-B 六动词指令扩展、指令托盘合成与即时本地编排单元测试
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中做源码静态红线扫描 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it, vi } from 'vitest';
import {
  DISPATCH_ORDER_COPY,
  dispatchOrderText,
  dispatchVerbButtonsFor,
  EXTENDED_SCHEDULE_VERBS,
  extendedDispatchOrderText,
  extendedDispatchVerbButtonsFor,
  formatBatchScheduleOrdersText,
  type QueuedTrayOrderItem,
} from '../models/dispatchOrderText';
import {
  applyQueueScheduleMutationToVars,
  applyScheduleLaneDualModeToVars,
  executeInstantScheduleMutation,
  resolveQueueGroupKey,
  toggleScheduleLaneBuildingMode,
  toggleScheduleLaneBuildingScope,
  type ScheduleMutationContext,
} from '../modals/modalScheduleHelpers';

describe('dispatchOrderText 六动词扩展与参谋指令托盘合成', () => {
  it('保留原有四动词导出与行为 100% 兼容', () => {
    expect(EXTENDED_SCHEDULE_VERBS).toEqual(['置顶', '置底', '暂缓', '恢复', '撤销', '指派']);
    const legacy = dispatchOrderText('置顶', { item: '犀牛坦克', type: '生产', base: '新莫斯科' });
    const ext = extendedDispatchOrderText('置顶', { item: '犀牛坦克', type: '生产', base: '新莫斯科' });
    expect(ext).toBe(legacy);

    const legacyBtns = dispatchVerbButtonsFor({ status: 'active', hold: false });
    expect(legacyBtns).toHaveLength(4);
  });

  it('extendedDispatchOrderText：支持「撤销」与「指派」并对非法输入抛 RangeError', () => {
    const cancelProd = extendedDispatchOrderText('撤销', {
      item: '天启坦克',
      type: '生产',
      base: '新莫斯科',
    });
    expect(cancelProd).toContain('下达工程撤销令');
    expect(cancelProd).toContain('终止生产项目「天启坦克」（基地「新莫斯科」）');
    expect(cancelProd).toContain('cancelled');

    const cancelResearch = extendedDispatchOrderText('撤销', {
      item: '履带工学',
      type: '研究',
      base: '新莫斯科',
    });
    expect(cancelResearch).toContain('终止研究项目「履带工学」，释放占用工位');
    expect(cancelResearch).not.toContain('新莫斯科');

    const allocateText = extendedDispatchOrderText('指派', {
      item: '天穹轨道船坞·机械臂A',
      type: '工程',
      base: '新莫斯科',
      allocateBase: '北极星船坞',
    });
    expect(allocateText).toContain('下达跨基地承建指派令');
    expect(allocateText).toContain('工程项目「天穹轨道船坞·机械臂A」');
    expect(allocateText).toContain('改派由基地「北极星船坞」承建');

    expect(() => extendedDispatchOrderText('撤销', { item: '   ' })).toThrow(RangeError);
    expect(() => extendedDispatchOrderText('非法动词', { item: '犀牛坦克' })).toThrow(RangeError);
  });

  it('extendedDispatchVerbButtonsFor：返回六动词按钮模型（含撤销 danger 与指派开关）', () => {
    const activeBtns = extendedDispatchVerbButtonsFor({
      status: 'active',
      hold: false,
      canAllocate: true,
    });
    expect(activeBtns.map(b => b.verb)).toEqual(['置顶', '置底', '暂缓', '恢复', '撤销', '指派']);
    expect(activeBtns[4]).toMatchObject({
      verb: '撤销',
      enabled: true,
      danger: true,
      armed: false,
    });
    expect(activeBtns[5]).toMatchObject({
      verb: '指派',
      enabled: true,
      armed: false,
    });

    const noAllocBtns = extendedDispatchVerbButtonsFor({
      status: 'queued',
      hold: true,
      canAllocate: false,
    });
    expect(noAllocBtns[2].enabled).toBe(false); // 已暂缓
    expect(noAllocBtns[3]).toMatchObject({ verb: '恢复', enabled: true, armed: true });
    expect(noAllocBtns[5].enabled).toBe(false);

    const immuneBtns = extendedDispatchVerbButtonsFor({ status: 'settling' });
    expect(immuneBtns.every(b => !b.enabled)).toBe(true);
    expect(immuneBtns.every(b => b.hint === DISPATCH_ORDER_COPY.immune)).toBe(true);
  });

  it('formatBatchScheduleOrdersText：0 条空串、1 条直返、多条合成为联席调度令', () => {
    expect(formatBatchScheduleOrdersText([])).toBe('');

    const one: QueuedTrayOrderItem = {
      id: '1',
      verb: '置顶',
      item: '犀牛坦克',
      summary: '新莫斯科 · 犀牛坦克',
      orderText: '（指挥指令：单条置顶测试）',
    };
    expect(formatBatchScheduleOrdersText([one])).toBe('（指挥指令：单条置顶测试）');

    const two: QueuedTrayOrderItem = {
      id: '2',
      verb: '双模切换',
      item: '苏联战车工厂',
      summary: '新莫斯科 · 战车工厂切为加速',
      orderText: '（指挥指令：战车工厂切为加速模式）',
    };
    const batch = formatBatchScheduleOrdersText([one, two]);
    expect(batch).toContain('【战区工务与产能联席调度令】（共 2 项变更）');
    expect(batch).toContain('1. [置顶] 新莫斯科 · 犀牛坦克 —— （指挥指令：单条置顶测试）');
    expect(batch).toContain('2. [双模切换] 新莫斯科 · 战车工厂切为加速 —— （指挥指令：战车工厂切为加速模式）');
    expect(batch).toContain('请参谋部按上述顺位、工位双模与暂缓标记同步更新本楼 <队列> 与建筑状态。');
  });
});

describe('modalScheduleHelpers · 六动词纯函数队列变换与零刷物守卫', () => {
  function createFixtureVars() {
    return {
      stat_data: {
        queues: [
          {
            type: '生产',
            item: '犀牛坦克',
            base: '新莫斯科',
            lane: 'lane.vehicle_land',
            status: 'active',
            progress: 65,
            spent_minutes: 390,
            total_minutes: 600,
            hold: false,
          },
          {
            type: '生产',
            item: '天启坦克',
            base: '新莫斯科',
            lane: 'lane.vehicle_land',
            status: 'queued',
            progress: 20,
            spent_minutes: 120,
            total_minutes: 600,
            hold: false,
          },
          {
            type: '生产',
            item: '防空履带车',
            base: '新莫斯科',
            lane: 'lane.vehicle_land',
            status: 'queued',
            progress: 0,
            spent_minutes: 0,
            total_minutes: 300,
            hold: true,
          },
          {
            type: '工程',
            item: '灰熊改装·火控换装',
            base: '新莫斯科',
            lane: 'eng:eng.main',
            status: 'active',
            progress: 40,
            spent_minutes: 240,
            total_minutes: 600,
            hold: false,
          },
          {
            type: '工程',
            item: '天穹轨道船坞·机械臂A',
            base: '新莫斯科',
            lane: 'eng:eng.orbital',
            status: 'queued',
            progress: 10,
            spent_minutes: 60,
            total_minutes: 600,
            hold: true,
          },
        ],
        projects: [
          {
            id: 'proj:v1_01',
            schema_version: 1,
            ref: '灰熊改装',
            phases: [{ idx: 0, name: '火控换装', status: '进行中', queue_index: 3 }],
          },
          {
            id: 'proj:v2_01',
            schema_version: 2,
            ref: '天穹轨道船坞',
            modules: [{ id: 'arm_a', name: '机械臂A', base: '新莫斯科', status: '暂停', queue_index: 4 }],
          },
        ],
        bases: [
          {
            id: 'base_1',
            name: '新莫斯科',
            buildings: [
              { name: '苏联战车工厂', state: '运转', mode: '生产' },
              { name: '苏联战车工厂', state: '运转', mode: '加速', accel_scope: 'global' },
            ],
          },
        ],
      },
    };
  }

  it('置顶（Promote）：挪至同产线首位并升为 active，满额时末序原 active 降为 queued 且严禁篡改 spent_minutes/progress', () => {
    const vars = createFixtureVars();
    Object.freeze(vars);
    Object.freeze(vars.stat_data);
    Object.freeze(vars.stat_data.queues);
    vars.stat_data.queues.forEach(q => Object.freeze(q));

    const next = applyQueueScheduleMutationToVars(vars, {
      verb: '置顶',
      item: '天启坦克',
      type: '生产',
      base: '新莫斯科',
      capacity: 1,
    });

    const queues = (next.stat_data as { queues: Array<Record<string, unknown>> }).queues;
    expect(queues[0]).toMatchObject({
      item: '天启坦克',
      status: 'active',
      progress: 20,
      spent_minutes: 120,
    });
    expect(queues[1]).toMatchObject({
      item: '犀牛坦克',
      status: 'queued',
      progress: 65,
      spent_minutes: 390,
    });
  });

  it('置底（Demote）：原 active 移至同组末位并降为 queued，同组首个非暂缓 queued 自动递补升为 active', () => {
    const vars = createFixtureVars();
    const next = applyQueueScheduleMutationToVars(vars, {
      verb: '置底',
      item: '犀牛坦克',
      type: '生产',
      base: '新莫斯科',
      capacity: 1,
    });

    const queues = (next.stat_data as { queues: Array<Record<string, unknown>> }).queues;
    expect(queues[0]).toMatchObject({
      item: '天启坦克',
      status: 'active',
      spent_minutes: 120,
      progress: 20,
    });
    expect(queues[2]).toMatchObject({
      item: '犀牛坦克',
      status: 'queued',
      spent_minutes: 390,
      progress: 65,
    });
  });

  it('暂缓（Hold）与恢复（Resume）：同步递补候列并更新关联 projects 阶段/模块状态', () => {
    const vars = createFixtureVars();

    // 1. 暂缓陆线在编「犀牛坦克」→「天启坦克」递补升为 active
    const afterHoldProd = applyQueueScheduleMutationToVars(vars, {
      verb: '暂缓',
      item: '犀牛坦克',
      type: '生产',
      base: '新莫斯科',
      capacity: 1,
    });
    const q1 = (afterHoldProd.stat_data as { queues: Array<Record<string, unknown>> }).queues;
    expect(q1[0]).toMatchObject({ item: '犀牛坦克', status: 'queued', hold: true, spent_minutes: 390 });
    expect(q1[1]).toMatchObject({ item: '天启坦克', status: 'active', hold: false, spent_minutes: 120 });

    // 2. 暂缓工程「灰熊改装·火控换装」→ 关联 phase 状态变为「暂停」
    const afterHoldEng = applyQueueScheduleMutationToVars(vars, {
      verb: '暂缓',
      item: '灰熊改装·火控换装',
      queueIndex: 3,
      capacity: 1,
    });
    const p1 = (afterHoldEng.stat_data as { projects: Array<{ phases?: Array<Record<string, unknown>> }> }).projects;
    expect(p1[0].phases?.[0].status).toBe('暂停');

    // 3. 恢复「天穹轨道船坞·机械臂A」→ hold=false，因工位空余升为 active，关联 module 状态恢复为「进行中」
    const afterResumeMod = applyQueueScheduleMutationToVars(vars, {
      verb: '恢复',
      item: '天穹轨道船坞·机械臂A',
      queueIndex: 4,
      capacity: 1,
    });
    const q3 = (afterResumeMod.stat_data as { queues: Array<Record<string, unknown>> }).queues;
    const p3 = (afterResumeMod.stat_data as { projects: Array<{ modules?: Array<Record<string, unknown>> }> }).projects;
    expect(q3[4]).toMatchObject({
      item: '天穹轨道船坞·机械臂A',
      status: 'active',
      hold: false,
      spent_minutes: 60,
    });
    expect(p3[1].modules?.[0].status).toBe('进行中');
  });

  it('撤销（Cancel）与指派（Allocate）：释放工位递补候列，同步更新 projects 状态与承建基地', () => {
    const vars = createFixtureVars();

    // 撤销「犀牛坦克」→ 标记 cancelled，天启坦克递补升为 active
    const afterCancelProd = applyQueueScheduleMutationToVars(vars, {
      verb: '撤销',
      item: '犀牛坦克',
      queueIndex: 0,
      capacity: 1,
    });
    const qCancel = (afterCancelProd.stat_data as { queues: Array<Record<string, unknown>> }).queues;
    expect(qCancel[0]).toMatchObject({ item: '犀牛坦克', status: 'cancelled', hold: false, spent_minutes: 390 });
    expect(qCancel[1]).toMatchObject({ item: '天启坦克', status: 'active' });

    // 撤销工程阶段「灰熊改装·火控换装」→ phase.status = '已取消' 且 queue_index = null
    const afterCancelEng = applyQueueScheduleMutationToVars(vars, {
      verb: '撤销',
      item: '灰熊改装·火控换装',
      queueIndex: 3,
      capacity: 1,
    });
    const pCancel = (afterCancelEng.stat_data as { projects: Array<{ phases?: Array<Record<string, unknown>> }> })
      .projects;
    expect(pCancel[0].phases?.[0]).toMatchObject({ status: '已取消', queue_index: null });

    // 指派「天穹轨道船坞·机械臂A」至「北极星船坞」
    const afterAlloc = applyQueueScheduleMutationToVars(vars, {
      verb: '指派',
      item: '天穹轨道船坞·机械臂A',
      queueIndex: 4,
      allocateBase: '北极星船坞',
    });
    const qAlloc = (afterAlloc.stat_data as { queues: Array<Record<string, unknown>> }).queues;
    const pAlloc = (afterAlloc.stat_data as { projects: Array<{ modules?: Array<Record<string, unknown>> }> }).projects;
    expect(qAlloc[4].base).toBe('北极星船坞');
    expect(pAlloc[1].modules?.[0].base).toBe('北极星船坞');
  });

  it('免疫态保护：settling / done / cancelled 条目原样返回不修改', () => {
    const vars = {
      stat_data: {
        queues: [
          {
            type: '生产',
            item: '基洛夫空艇',
            base: '新莫斯科',
            status: 'settling',
            progress: 100,
            spent_minutes: 1200,
            total_minutes: 1200,
            hold: false,
          },
        ],
      },
    };
    const next = applyQueueScheduleMutationToVars(vars, {
      verb: '撤销',
      item: '基洛夫空艇',
      queueIndex: 0,
    });
    expect(next).toBe(vars);
  });

  it('executeInstantScheduleMutation：同步更新 snapshot/dataStore，调用 updateFloorVars 与 refresh 并返回指挥官回执', async () => {
    const vars = createFixtureVars();
    const snapshot = structuredClone(vars.stat_data);
    const storeData = structuredClone(vars.stat_data);
    const updateFloorVars = vi.fn(async (_floorId: number, updater: (v: Record<string, unknown>) => unknown) => {
      updater(vars);
    });
    const refresh = vi.fn();
    const onTick = vi.fn();

    const ctx: ScheduleMutationContext = {
      snapshot,
      dataStore: { data: storeData },
      floating: { floorId: 12, refresh },
      updateFloorVars,
      onTick,
    };

    const msg = await executeInstantScheduleMutation(
      {
        verb: '置顶',
        item: '天启坦克',
        type: '生产',
        base: '新莫斯科',
        capacity: 1,
      },
      ctx,
    );

    expect(msg).toContain('已置顶「天启坦克」');
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(updateFloorVars).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((snapshot.queues as Array<Record<string, unknown>>)[0].item).toBe('天启坦克');
    expect((storeData.queues as Array<Record<string, unknown>>)[0].item).toBe('天启坦克');
  });

  it('BUG-R2-05：resolveQueueGroupKey 推断无 lane 生产子车道防跨车间挤占，且撤销未完工队列项自动退还预扣资金', () => {
    expect(resolveQueueGroupKey({ type: '生产', item: '动员兵', base: '新莫斯科' })).toBe(
      '新莫斯科::lane.personnel',
    );
    expect(resolveQueueGroupKey({ type: '生产', item: '灰熊坦克', base: '新莫斯科' })).toBe(
      '新莫斯科::lane.vehicle_land',
    );
    expect(resolveQueueGroupKey({ type: '生产', item: '基洛夫空艇', base: '新莫斯科' })).toBe(
      '新莫斯科::lane.vehicle_air',
    );
    expect(resolveQueueGroupKey({ type: '生产', item: '台风级攻击潜艇', base: '新莫斯科' })).toBe(
      '新莫斯科::lane.vehicle_naval',
    );

    const vars = {
      stat_data: {
        economy: { credits: 3000 },
        queues: [
          {
            type: '生产',
            item: '动员兵',
            base: '新莫斯科',
            status: 'active',
            progress: 50,
            spent_minutes: 150,
            total_minutes: 300,
            hold: false,
            cost_credits: 400,
          },
          {
            type: '生产',
            item: '犀牛坦克',
            base: '新莫斯科',
            status: 'active',
            progress: 30,
            spent_minutes: 180,
            total_minutes: 600,
            hold: false,
            cost_credits: 900,
          },
          {
            type: '生产',
            item: '天启坦克',
            base: '新莫斯科',
            status: 'queued',
            progress: 0,
            spent_minutes: 0,
            total_minutes: 900,
            hold: false,
            cost_credits: 1750,
          },
        ],
      },
    };

    // 1. 置顶无显式 lane 的「天启坦克」：仅抢占同基地「犀牛坦克」所在的战车车道，兵营正在 active 的「动员兵」绝不被挤回 queued
    const afterPromote = applyQueueScheduleMutationToVars(vars, {
      verb: '置顶',
      item: '天启坦克',
      type: '生产',
      base: '新莫斯科',
      capacity: 1,
    });
    const qAfterPromote = (afterPromote.stat_data as { queues: Array<Record<string, unknown>> }).queues;
    expect(qAfterPromote.find(q => q.item === '动员兵')?.status).toBe('active');
    expect(qAfterPromote.find(q => q.item === '天启坦克')?.status).toBe('active');
    expect(qAfterPromote.find(q => q.item === '犀牛坦克')?.status).toBe('queued');

    // 2. 撤销未完工的「天启坦克」（cost_credits: 1750）→ 状态变为 cancelled，犀牛坦克递补回 active，且 1750 资金退还至 economy.credits
    const afterCancel = applyQueueScheduleMutationToVars(afterPromote, {
      verb: '撤销',
      item: '天启坦克',
      type: '生产',
      base: '新莫斯科',
      capacity: 1,
    });
    const sdAfterCancel = afterCancel.stat_data as {
      economy: { credits: number };
      queues: Array<Record<string, unknown>>;
    };
    expect(sdAfterCancel.queues.find(q => q.item === '天启坦克')?.status).toBe('cancelled');
    expect(sdAfterCancel.queues.find(q => q.item === '犀牛坦克')?.status).toBe('active');
    expect(sdAfterCancel.economy.credits).toBe(4750);
  });

  it('BUG-R2-05b：真实宿主 QueueItem 无 cost_credits 字段时，按 cost_credits 比例 -> planning.latest_receipt.actions -> catalog 单价三级回退退费并经 updateFloorVars 落盘 economy.credits', async () => {
    const catalog = {
      productions: [
        { name: '超时空采矿车', cost: 1400 },
        { name: '美国大兵（量产型步兵）', cost: 200 },
      ],
      buildings: [{ name: '盟军发电厂', cost: 800 }],
      researches: [{ name: '基础步兵训练学', cost: 200 }],
    };

    // 场景 1：#8 楼实机复现——无 cost_credits 字段，cost_paid: true，从 catalog 查找「超时空采矿车」单价 1400 退还，economy.credits 从 64350 升至 65750
    const floor8Snapshot: Record<string, unknown> = {
      economy: { credits: 64350 },
      queues: [
        {
          type: '生产',
          item: '超时空采矿车',
          base: '恶土前哨主基地',
          progress: 0,
          status: 'queued',
          total_minutes: 720,
          spent_minutes: 0,
          qty: 1,
          qty_done: 0,
          cost_paid: true,
          hold: false,
        },
      ],
    };
    const floor8Vars: Record<string, unknown> = {
      stat_data: structuredClone(floor8Snapshot),
    };
    const updateFloorVars = vi.fn(
      async (_floorId: number, updater: (v: Record<string, unknown>) => Record<string, unknown>) => {
        const next = updater(floor8Vars);
        floor8Vars.stat_data = next.stat_data;
        return next;
      },
    );
    const refresh = vi.fn();

    await executeInstantScheduleMutation(
      {
        verb: '撤销',
        item: '超时空采矿车',
        type: '生产',
        base: '恶土前哨主基地',
        queueIndex: 0,
        capacity: 1,
      },
      {
        snapshot: floor8Snapshot,
        floating: { floorId: 8, refresh },
        catalog,
        updateFloorVars: updateFloorVars as any,
      },
    );

    expect((floor8Snapshot.economy as { credits: number }).credits).toBe(65750);
    expect((floor8Snapshot.queues as Array<Record<string, unknown>>)[0].status).toBe('cancelled');
    expect(((floor8Vars.stat_data as any).economy as { credits: number }).credits).toBe(65750);
    expect(((floor8Vars.stat_data as any).queues as Array<Record<string, unknown>>)[0].status).toBe('cancelled');
    expect(updateFloorVars).toHaveBeenCalledTimes(1);

    // 场景 2：从 planning.latest_receipt.actions 回退计算按未完成数量 (qty - qty_done) 退费
    const receiptVars = {
      stat_data: {
        economy: { credits: 10000 },
        planning: {
          latest_receipt: {
            actions: [
              {
                op: 'enqueue',
                target: '特种实验装甲车',
                base: '恶土前哨主基地',
                quantity: 4,
                cost_credits: 3600, // 单价 900
              },
            ],
          },
        },
        queues: [
          {
            type: '生产',
            item: '特种实验装甲车',
            base: '恶土前哨主基地',
            status: 'active',
            progress: 50,
            total_minutes: 1200,
            spent_minutes: 600,
            qty: 4,
            qty_done: 1, // 剩余 3 台未完成，应退 900 * 3 = 2700
            cost_paid: true,
            hold: false,
          },
        ],
      },
    };
    const afterReceiptCancel = applyQueueScheduleMutationToVars(
      receiptVars,
      {
        verb: '撤销',
        item: '特种实验装甲车',
        type: '生产',
        base: '恶土前哨主基地',
        queueIndex: 0,
      },
      catalog,
    );
    expect(((afterReceiptCancel.stat_data as any).economy as { credits: number }).credits).toBe(12700);
  });
});

describe('modalScheduleHelpers · 产线内嵌建筑双模与加速范围切换', () => {
  it('applyScheduleLaneDualModeToVars：切换生产/加速（默认补 global）与切换 global/base 范围', () => {
    const vars = {
      stat_data: {
        bases: [
          {
            name: '新莫斯科',
            buildings: [{ name: '苏联战车工厂', state: '运转', mode: '生产' }],
          },
        ],
      },
    };

    const toAccel = applyScheduleLaneDualModeToVars(vars, {
      baseIndex: 0,
      buildingIndex: 0,
      nextMode: '加速',
    });
    const bld1 = (
      toAccel.stat_data as { bases: Array<{ buildings: Array<Record<string, unknown>> }> }
    ).bases[0].buildings[0];
    expect(bld1.mode).toBe('加速');
    expect(bld1.accel_scope).toBe('global');

    const toBaseScope = applyScheduleLaneDualModeToVars(toAccel, {
      baseIndex: 0,
      buildingIndex: 0,
      nextScope: 'base',
    });
    const bld2 = (
      toBaseScope.stat_data as { bases: Array<{ buildings: Array<Record<string, unknown>> }> }
    ).bases[0].buildings[0];
    expect(bld2.accel_scope).toBe('base');
  });

  it('toggleScheduleLaneBuildingMode 与 toggleScheduleLaneBuildingScope：落盘刷新并返回回执文案', async () => {
    const snapshot = {
      bases: [
        {
          name: '新莫斯科',
          buildings: [{ name: '苏联战车工厂', state: '运转', mode: '生产' as const }],
        },
      ],
    };
    const updateFloorVars = vi.fn(async (_id: number, updater: (v: Record<string, unknown>) => unknown) => {
      updater({ stat_data: snapshot });
    });
    const refresh = vi.fn();
    const onTick = vi.fn();

    const ctx: ScheduleMutationContext = {
      snapshot,
      floating: { floorId: 7, refresh },
      updateFloorVars,
      onTick,
    };

    const modeMsg = await toggleScheduleLaneBuildingMode(
      {
        baseIndex: 0,
        buildingIndex: 0,
        name: '苏联战车工厂',
        mode: '生产',
      },
      ctx,
    );
    expect(modeMsg).toBe('「苏联战车工厂」已切换为【加速】模式');
    expect(snapshot.bases[0].buildings[0]).toMatchObject({ mode: '加速', accel_scope: 'global' });

    const scopeMsg = await toggleScheduleLaneBuildingScope(
      {
        baseIndex: 0,
        buildingIndex: 0,
        name: '苏联战车工厂',
        mode: '加速',
        accelScope: 'global',
      },
      ctx,
    );
    expect(scopeMsg).toBe('「苏联战车工厂」加速范围已切换为【仅本基地】');
    expect(snapshot.bases[0].buildings[0]).toMatchObject({ accel_scope: 'base' });
    expect(updateFloorVars).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe('PKG-B 源码静态红线守卫（零宿主直写 API + 零 23 号包禁用词）', () => {
  const pkgBFiles = [
    join(__dirname, '../models/dispatchOrderText.ts'),
    join(__dirname, '../modals/modalScheduleHelpers.ts'),
  ];

  const bannedWriteApis =
    /createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook|createWorldbookEntries|deleteWorldbookEntries|insertOrAssignVariables|replaceVariables|updateVariablesWith|deleteVariable/;

  const forbiddenWords23 = [
    '六柱',
    '战略柱',
    '柱域',
    '协议轨道',
    '未选择轨道',
    '线性轨道',
    '同源面板',
    '同源投影',
    '零注入语义',
    '无实例驱动',
    '未投影',
    '抽象槽',
    '通用底座',
    '暂存门',
    '审核门',
    '待落盘',
    '原子热重算',
    '当前作用域',
  ];

  it('dispatchOrderText.ts 与 modalScheduleHelpers.ts 零命中宿主直写 API 与 23 号包禁用词', () => {
    for (const file of pkgBFiles) {
      const raw = readFileSync(file, 'utf8');
      const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      expect(stripped, file).not.toMatch(bannedWriteApis);
      for (const word of forbiddenWords23) {
        expect(stripped, `${file} -> ${word}`).not.toContain(word);
      }
    }
  });
});
