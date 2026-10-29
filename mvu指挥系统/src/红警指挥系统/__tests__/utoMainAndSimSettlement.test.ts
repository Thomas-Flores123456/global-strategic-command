import { describe, expect, it } from 'vitest';
import type { EffectiveCatalog } from '../core/catalogEffective';
import {
  ENGINEERING_SLOT_REGISTRY,
  engSlotCapacityInBase,
  makeEngParallelLimitFor,
} from '../engines/engineeringSlots';
import {
  LANE_REGISTRY,
  effectiveAccelCount,
  laneCapacityInBase,
  makeAccelEffFor,
  makeProdParallelLimitFor,
  type LaneStateView,
} from '../engines/productionLanes';
import {
  availableNanites,
  investModule,
  startProjectV2,
  type ProjectStateView,
  type ProjectV2Def,
} from '../engines/projectEngine';
import { Meta, Schema, type StatData } from '../core/schema';
import {
  makeTxnEffFor,
  orchestrateFloorTasks,
  settleFloor,
  tickTaskOrchestrationEquivalentToSettleFloor,
} from '../engines/settleFloor';
import {
  tickTaskOrchestration,
  type LaneStationView,
  type UnifiedTask,
} from '../engines/taskOrchestrator';
import { toUnifiedTasks } from '../engines/taskProjectionAdapter';
import type { TransactionItem } from '../engines/transactionEngine';
import {
  advanceTwoStageProduction,
  settleWithTwoStage,
  type TwoStageSpec,
} from '../engines/twoStageAssemblyEngine';

function mkTxn(overrides: Partial<TransactionItem> = {}): TransactionItem {
  return {
    type: '生产',
    item: '灰熊坦克',
    base: 'B1',
    progress: 0,
    eta: '',
    status: 'active',
    started_at: '2026-01-01',
    total_minutes: 1000,
    spent_minutes: 0,
    qty: 1,
    qty_done: 0,
    cost_paid: true,
    min_days_lock: 0,
    hold: false,
    lane: '',
    ...overrides,
  };
}

function mkCatalog(partial: Partial<EffectiveCatalog> = {}): EffectiveCatalog {
  return {
    buildings: [],
    productions: [],
    researches: [],
    retrofits: [],
    protocols: [],
    ...partial,
  } as unknown as EffectiveCatalog;
}

describe('UTO-MAIN-01 · UTO 与 settleFloor 主推进循环等价性契约', () => {
  it('相同输入下 tickTaskOrchestrationEquivalentToSettleFloor 与 settleFloor 跨多楼层积分/满额转 settling/空额升格 100% 一致', () => {
    const catalog = mkCatalog({
      buildings: [{ name: '战车工厂', cost: 2000, power: 50 } as never],
      productions: [
        {
          name: '犀牛坦克',
          cost: 900,
          lane: 'lane.vehicle_land',
          assembly: { t_mat: 300, t_asm: 300, req_nanites: 40 },
        } as never,
        {
          name: '防空履带车',
          cost: 600,
          lane: 'lane.vehicle_land',
          assembly: { t_mat: 200, t_asm: 400, req_nanites: 30 },
        } as never,
      ],
    });

    const initialStat: StatData = Schema.parse({
      meta: { date: '2026-05-01', day_count: 1 },
      economy: {
        credits: 10000,
        resources: {
          nanites: { structural: 60, electronic: 0 },
        },
      },
      bases: [
        {
          id: 'B1',
          name: '一号基地',
          power: { gen: 500, use: 200 },
          buildings: [{ name: '战车工厂', state: '运转', mode: '生产' }],
        },
      ],
      queues: [
        mkTxn({
          type: '生产',
          item: '犀牛坦克',
          base: 'B1',
          status: 'active',
          total_minutes: 600,
          spent_minutes: 0,
          lane: 'lane.vehicle_land',
        }),
        mkTxn({
          type: '生产',
          item: '防空履带车',
          base: 'B1',
          status: 'queued',
          total_minutes: 600,
          spent_minutes: 0,
          lane: 'lane.vehicle_land',
        }),
      ],
    });

    // 第 1 楼：推进 300 分钟
    // 犀牛坦克阶段一 300 分钟由 40 纳米全额抵扣跳过（剩余纳米 20），本楼再积分 300 分钟 → 满 600 分钟转入 settling；
    // 槽位腾出后，防空履带车由 queued 升格为 active，并立即消费剩余 20 纳米（抵扣 20/30 * 200 = 133.33 分钟），且不双吃本楼 300 分钟 Δt。
    const floor1Settle = settleFloor(
      structuredClone(initialStat),
      structuredClone(initialStat),
      '<timePast>0 D 5 H 0 M</timePast>',
      { catalog, now: '2026-05-01 05:00', autoSettleCompleted: false } as never,
    );

    const floor1Orchestrated = orchestrateFloorTasks(structuredClone(initialStat), 300, {
      catalog,
      now: '2026-05-01 05:00',
    });

    const lane: LaneStationView = {
      laneKey: 'B1 lane.vehicle_land',
      domain: 'production',
      baseId: 'B1',
      capacity: 1,
      activeCount: 1,
      accelMultiplier: 1,
      locked: false,
    };
    const initialTasks = toUnifiedTasks(
      { bases: initialStat.bases, queues: initialStat.queues, projects: initialStat.projects },
      catalog,
      [lane],
    );
    const floor1DirectUto = tickTaskOrchestrationEquivalentToSettleFloor(initialTasks, [lane], {
      deltaMinutes: 300,
      now: '2026-05-01 05:00',
      nanitesFor: 60,
      assemblyFor: task =>
        task.name === '犀牛坦克'
          ? { t_mat: 300, t_asm: 300, req_nanites: 40 }
          : { t_mat: 200, t_asm: 400, req_nanites: 30 },
    });

    for (let i = 0; i < initialStat.queues.length; i++) {
      expect(floor1DirectUto.nextTasks[i].status).toBe(floor1Settle.data.queues[i].status);
      expect(floor1DirectUto.nextTasks[i].workload.spentMinutes).toBeCloseTo(
        floor1Settle.data.queues[i].spent_minutes,
        5,
      );
      expect(floor1Orchestrated.tickResult.nextTasks[i].status).toBe(floor1Settle.data.queues[i].status);
      expect(floor1Orchestrated.tickResult.nextTasks[i].workload.spentMinutes).toBeCloseTo(
        floor1Settle.data.queues[i].spent_minutes,
        5,
      );
    }

    expect(floor1Settle.data.queues[0].status).toBe('settling');
    expect(floor1Settle.data.queues[1].status).toBe('active');
    expect(floor1Settle.data.queues[1].spent_minutes).toBeCloseTo((20 / 30) * 200, 5);

    // 第 2 楼：再推进 200 分钟，验证跨楼层持续推进结果完全一致
    const floor2Settle = settleFloor(
      structuredClone(floor1Settle.data),
      structuredClone(floor1Settle.data),
      '<timePast>0 D 3 H 20 M</timePast>',
      { catalog, now: '2026-05-01 08:20', autoSettleCompleted: false } as never,
    );
    const floor2DirectUto = tickTaskOrchestrationEquivalentToSettleFloor(floor1DirectUto.nextTasks, [lane], {
      deltaMinutes: 200,
      now: '2026-05-01 08:20',
      nanitesFor: 0,
      assemblyFor: task =>
        task.name === '犀牛坦克'
          ? { t_mat: 300, t_asm: 300, req_nanites: 40 }
          : { t_mat: 200, t_asm: 400, req_nanites: 30 },
    });

    for (let i = 0; i < floor2Settle.data.queues.length; i++) {
      expect(floor2DirectUto.nextTasks[i].status).toBe(floor2Settle.data.queues[i].status);
      expect(floor2DirectUto.nextTasks[i].workload.spentMinutes).toBeCloseTo(
        floor2Settle.data.queues[i].spent_minutes,
        5,
      );
    }
  });
});

describe('SIM-NANITE-01 · 两阶段生产与巨构立项纳米库存真实扣减闭环', () => {
  const SPEC_N80: TwoStageSpec = { t_mat: 400, t_asm: 600, req_nanites: 80 };

  it('advanceTwoStageProduction 维护批内递减游标 remainingNanites：库存 100 排产 2 项各需 80 时，第 1 项扣 80，第 2 项保持 queued 不透支', () => {
    const state = {
      queues: [
        mkTxn({ item: '天启坦克#1', status: 'active', total_minutes: 1000, spent_minutes: 0 }),
        mkTxn({ item: '天启坦克#2', status: 'queued', total_minutes: 1000, spent_minutes: 0 }),
      ],
    };

    // 单槽产线：第 1 项本轮推进 600 分钟完结转入 settling，腾出槽位；
    // 但批内 remainingNanites 仅剩 100 - 80 = 20 < 80，第 2 项在严格纳米门下保持 queued 等待后续补给，绝不透支。
    const res = advanceTwoStageProduction(state, 600, {
      assemblyFor: () => SPEC_N80,
      nanitesFor: () => 100,
    });

    expect(res.nanitesConsumed).toBe(80);
    expect(res.remainingNanites).toBe(20);
    expect(res.next.queues[0].status).toBe('settling');
    expect(res.next.queues[1].status).toBe('queued');
    expect(res.next.queues[1].spent_minutes).toBe(0);
    expect(res.next.queues[1].hold).toBe(false);
  });

  it('settleWithTwoStage 与 UTO 批内多任务并发激活时递减 remainingNanites，绝不重复消费同一份纳米库存', () => {
    const state = {
      queues: [
        mkTxn({ item: '光棱坦克#1', status: 'active', total_minutes: 1000, spent_minutes: 0 }),
        mkTxn({ item: '光棱坦克#2', status: 'active', total_minutes: 1000, spent_minutes: 0 }),
      ],
    };

    const settled = settleWithTwoStage(state, 0, {
      parallelLimitFor: () => 2,
      assemblyFor: () => SPEC_N80,
      nanitesFor: () => 100,
    });

    expect(settled.nanitesConsumed).toBe(100);
    expect(settled.remainingNanites).toBe(0);
    expect(settled.next.queues[0].spent_minutes).toBe(400); // 80/80 全跳阶段一
    expect(settled.next.queues[1].spent_minutes).toBe(100); // 仅剩 20/80 = 25% 份额

    // UTO 侧相同场景验证：批内递减游标同样只扣 80 + 20 = 100
    const lane: LaneStationView = {
      laneKey: 'B1 lane.vehicle_land',
      domain: 'production',
      baseId: 'B1',
      capacity: 2,
      activeCount: 2,
      accelMultiplier: 1,
      locked: false,
    };
    const utoTasks: UnifiedTask[] = [
      {
        id: 't1',
        name: '光棱坦克#1',
        domain: 'production',
        nodeKind: 'leaf',
        status: 'active',
        scope: 'base',
        leadBaseId: 'B1',
        participatingBases: ['B1'],
        laneKey: 'B1 lane.vehicle_land',
        workload: { totalMinutes: 1000, spentMinutes: 0, naniteCost: 80, phase1Ratio: 0.4 },
      },
      {
        id: 't2',
        name: '光棱坦克#2',
        domain: 'production',
        nodeKind: 'leaf',
        status: 'active',
        scope: 'base',
        leadBaseId: 'B1',
        participatingBases: ['B1'],
        laneKey: 'B1 lane.vehicle_land',
        workload: { totalMinutes: 1000, spentMinutes: 0, naniteCost: 80, phase1Ratio: 0.4 },
      },
    ];
    const utoRes = tickTaskOrchestration(utoTasks, [lane], {
      deltaMinutes: 0,
      nanitesFor: 100,
    });
    expect(utoRes.nextTasks[0].workload.spentMinutes).toBe(400);
    expect(utoRes.nextTasks[1].workload.spentMinutes).toBe(100);
  });

  it('settleFloor 真实扣减 next.economy.resources.nanites 并写入结算日志', () => {
    const catalog = mkCatalog({
      buildings: [{ name: '战车工厂', cost: 2000, power: 50 } as never],
      productions: [
        {
          name: '天启坦克',
          cost: 1750,
          lane: 'lane.vehicle_land',
          assembly: { t_mat: 400, t_asm: 600, req_nanites: 80 },
        } as never,
      ],
    });

    const stat: StatData = Schema.parse({
      meta: { date: '2026-06-01', day_count: 1 },
      economy: {
        credits: 5000,
        resources: {
          nanites: { structural: 50, electronic: 50 },
        },
      },
      bases: [
        {
          id: 'B1',
          name: '一号基地',
          power: { gen: 500, use: 100 },
          buildings: [{ name: '战车工厂', state: '运转', mode: '生产' }],
        },
      ],
      queues: [
        mkTxn({
          type: '生产',
          item: '天启坦克',
          base: 'B1',
          status: 'active',
          total_minutes: 1000,
          spent_minutes: 0,
        }),
      ],
    });

    const res = settleFloor(structuredClone(stat), structuredClone(stat), '<timePast>0 D 1 H 0 M</timePast>', {
      catalog,
    });

    // 50 + 50 = 100 库存扣减 80 后剩 20
    const afterNanites = res.data.economy.resources?.nanites;
    const remainingTotal =
      (afterNanites?.structural ?? 0) + (afterNanites?.electronic ?? 0);
    expect(remainingTotal).toBe(20);
    expect(res.events.some(e => e.message.includes('nanites_deducted') && e.message.includes('80'))).toBe(true);
    expect(res.issues.some(i => i.message.includes('已从 economy.resources.nanites 真实扣减'))).toBe(true);
  });

  it('projectEngine V2 startProjectV2 与 investModule 纳米门通过时真实扣减 economy.resources.nanites', () => {
    const v2Def: ProjectV2Def = {
      name: '天基质子撞击炮',
      grade: '重点工程',
      scope: 'base',
      modules: [
        {
          id: 'mod_core',
          name: '核心聚能环',
          cost: 2000,
          prereqs: [],
          workload: { days: 5, min_days: 3 },
          resources: { nanites: 45 },
        },
        {
          id: 'mod_lens',
          name: '轨道偏转透镜',
          cost: 1500,
          prereqs: ['mod_core'],
          workload: { days: 4, min_days: 2 },
          resources: { nanites: 30 },
        },
      ],
    };

    const initialState: ProjectStateView = {
      economy: {
        credits: 10000,
        resources: {
          nanites: { structural: 60, medical: 40 },
        },
      },
      bases: [
        {
          id: 'B1',
          name: '发射基地',
          buildings: [{ name: '航天发射中心', state: '运转' }],
        },
      ],
      queues: [],
      projects: [],
    };

    // 1. 立项：根模块 mod_core 消耗 45 纳米，库存从 100 真实扣减为 55
    const started = startProjectV2(initialState, v2Def, { base: 'B1' });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(availableNanites(started.next)).toBe(55);
    expect(started.next.economy?.credits).toBe(8000);

    // 模拟根模块完工并释放槽位，注资下一模块 mod_lens（消耗 30 纳米）
    const midState: ProjectStateView = {
      ...started.next,
      queues: [],
      projects: started.next.projects?.map(p =>
        'modules' in p
          ? {
              ...p,
              modules: p.modules.map(m => (m.id === 'mod_core' ? { ...m, status: '完工' as const, queue_index: null } : m)),
            }
          : p,
      ),
    };

    const invested = investModule(midState, started.projectId, 'mod_lens', v2Def);
    expect(invested.ok).toBe(true);
    if (!invested.ok) return;
    expect(availableNanites(invested.next)).toBe(25);
    expect(invested.next.economy?.credits).toBe(6500);
  });
});

describe('SIM-WEATHER-01 结算侧 · meta.weather Schema、受损建筑槽位/加速剔除与单建筑受损解连坐', () => {
  it('Schema 与 Meta 支持可选字段 meta.weather，且缺省时与旧档 100% 兼容', () => {
    const parsedWithWeather = Schema.parse({
      meta: { world_id: 'w1', date: '2026-07-01', day_count: 3, location: '北极圈', weather: '暴风雪' },
    });
    expect(parsedWithWeather.meta.weather).toBe('暴风雪');

    const parsedLegacy = Schema.parse({});
    expect(parsedLegacy.meta).toEqual({
      world_id: '',
      date: '',
      day_count: 0,
      location: '',
    });
    expect(Meta.parse({ weather: '辐射风暴' }).weather).toBe('辐射风暴');
  });

  it('productionLanes 与 engineeringSlots 排除 state/status 为停机/受损/离线/被毁的车间与工程建筑', () => {
    const vehicleLane = LANE_REGISTRY.find(l => l.laneId === 'lane.vehicle_land')!;
    const navalLane = LANE_REGISTRY.find(l => l.laneId === 'lane.vehicle_naval')!;
    const mainEngSlot = ENGINEERING_SLOT_REGISTRY[0];

    const state: LaneStateView = {
      bases: [
        {
          id: 'B1',
          name: '一号基地',
          buildings: [
            { name: '战车工厂', state: '运转', mode: '生产' },
            { name: '军工车间', status: '受损', mode: '生产' },
            { name: '二号战车工厂', status: '停机', mode: '加速' },
            { name: '三号战车工厂', state: '离线', mode: '加速' },
            { name: '四号战车工厂', status: '被毁', mode: '生产' },
            { name: '造船厂', status: '受损', mode: '生产' },
            { name: '科学城', status: '停机' },
          ],
        },
      ],
    };

    // 仅 1 座正常运转战车工厂计入容量；受损/停机/离线/被毁均不提供槽位与加速
    expect(laneCapacityInBase(state, 'B1', vehicleLane)).toBe(1);
    expect(effectiveAccelCount(state, { type: '生产', item: '灰熊坦克', base: 'B1' }, vehicleLane)).toBe(0);
    expect(makeAccelEffFor(state)({ type: '生产', item: '灰熊坦克', base: 'B1' })).toBe(1);
    expect(makeProdParallelLimitFor(state)({ type: '生产', item: '灰熊坦克', base: 'B1' })).toBe(1);

    // 受损造船厂容量为 0
    expect(laneCapacityInBase(state, 'B1', navalLane)).toBe(0);

    // 工程槽：受损造船厂、军工车间与停机科学城均不计入工程槽容量
    expect(engSlotCapacityInBase(state, 'B1', mainEngSlot)).toBe(0);
    expect(makeEngParallelLimitFor(state)({ type: '工程', item: '测试工程', base: 'B1' })).toBe(0);
  });

  it('makeTxnEffFor 与 settleFloor 解连坐：单栋科研所受损不连坐同基地正常兵营/车厂队列，僅科研队列降效；电网低电仍全局生效', () => {
    const catalog = mkCatalog({
      buildings: [
        {
          name: '作战实验室',
          cost: 2000,
          power: 100,
          operation: {
            conditions: [
              { trigger: 'damaged', behavior: 'degraded', efficiency: 0.5, desc: '实验室受损降效' },
              { trigger: 'low_power', behavior: 'degraded', efficiency: 0.25, desc: '低电降频' },
            ],
          },
        } as never,
        {
          name: '兵营',
          cost: 500,
          power: 20,
          operation: {
            conditions: [
              { trigger: 'damaged', behavior: 'degraded', efficiency: 0.5, desc: '兵营受损降效' },
              { trigger: 'low_power', behavior: 'degraded', efficiency: 0.25, desc: '低电降频' },
            ],
          },
        } as never,
      ],
    });

    const statNormalPower: StatData = Schema.parse({
      meta: { date: '2026-07-01', day_count: 1, weather: '晴朗' },
      bases: [
        {
          id: 'B1',
          name: '主基地',
          power: { gen: 500, use: 200 },
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '作战实验室', state: '受损' },
            { name: '兵营', state: '运转', mode: '生产' },
          ],
        },
      ],
      queues: [
        mkTxn({
          type: '生产',
          item: '步兵班',
          base: 'B1',
          status: 'active',
          total_minutes: 1000,
          spent_minutes: 0,
        }),
        mkTxn({
          type: '研究',
          item: '高能激光学',
          base: 'B1',
          status: 'active',
          total_minutes: 1000,
          spent_minutes: 0,
        }),
      ],
    });

    const effFor = makeTxnEffFor(catalog, statNormalPower);
    // 兵营正常运转 → 效率 1.0（不受同基地受损作战实验室连坐）
    expect(effFor(statNormalPower.queues[0])).toBe(1);
    // 作战实验室受损 → 研究队列效率 0.5
    expect(effFor(statNormalPower.queues[1])).toBe(0.5);

    const settled = settleFloor(
      structuredClone(statNormalPower),
      structuredClone(statNormalPower),
      '<timePast>0 D 2 H 0 M</timePast>',
      { catalog },
    );
    expect(settled.data.queues[0].spent_minutes).toBe(120); // 120 * 1.0
    expect(settled.data.queues[1].spent_minutes).toBe(60); // 120 * 0.5

    // 当基地电网赤字（gen < use）时，gridEff 仍对兵营队列正常生效
    const statLowPower: StatData = {
      ...statNormalPower,
      bases: [
        {
          ...statNormalPower.bases[0],
          power: { gen: 100, use: 300 },
        },
      ],
    };
    const lowPowerEffFor = makeTxnEffFor(catalog, statLowPower);
    expect(lowPowerEffFor(statLowPower.queues[0])).toBe(0.25);
  });

  it('BUG-R2-02：轻微缺电时雷达/超武等 low_power suspended(0) 设施绝不把全基地建造与兵营/车厂生产连坐归 0；生产锚定建筑全受损/停机时该生产队列效率为 0', () => {
    const catalog = mkCatalog({
      buildings: [
        {
          name: '盟军建造厂',
          cost: 2500,
          power: -50,
        } as never,
        {
          name: '空指部雷达站',
          cost: 1000,
          power: 50,
          operation: {
            conditions: [{ trigger: 'low_power', behavior: 'suspended', efficiency: 0, desc: '断电雷达停摆' }],
          },
        } as never,
        {
          name: '天气控制机',
          cost: 5000,
          power: 200,
          operation: {
            conditions: [{ trigger: 'low_power', behavior: 'suspended', efficiency: 0, desc: '断电超武停摆' }],
          },
        } as never,
        {
          name: '兵营',
          cost: 500,
          power: 20,
          operation: {
            conditions: [{ trigger: 'low_power', behavior: 'degraded', efficiency: 0.5, desc: '低电半速训练' }],
          },
        } as never,
        {
          name: '战车工厂',
          cost: 2000,
          power: 50,
        } as never,
      ],
    });

    const lowPowerState: StatData = Schema.parse({
      meta: { date: '2026-07-02', day_count: 2, weather: '晴' },
      bases: [
        {
          id: 'B1',
          name: '主基地',
          power: { gen: 100, use: 320 },
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '空指部雷达站', state: '运转' },
            { name: '天气控制机', state: '运转' },
            { name: '兵营', state: '运转', mode: '生产' },
            { name: '战车工厂', state: '受损', mode: '生产' },
          ],
        },
      ],
      queues: [
        mkTxn({ type: '建造', item: '盟军发电厂', base: 'B1', status: 'active', total_minutes: 1000 }),
        mkTxn({ type: '生产', item: '美国大兵', base: 'B1', status: 'active', total_minutes: 1000 }),
        mkTxn({ type: '生产', item: '灰熊坦克', base: 'B1', status: 'active', total_minutes: 1000 }),
      ],
    });

    const effFor = makeTxnEffFor(catalog, lowPowerState);
    // 1. 正在抢建的发电厂（建造队列）不被雷达/超武的 suspended(0) 连坐归 0，按非 suspended 降效 0.5 推进
    expect(effFor(lowPowerState.queues[0])).toBe(0.5);
    // 2. 运转中的兵营生产队列按 0.5 推进，不被雷达/超武连坐归 0
    expect(effFor(lowPowerState.queues[1])).toBe(0.5);
    // 3. 基地内唯一战车工厂处于「受损」状态（全部非运转），战车生产队列效率应为 0
    expect(effFor(lowPowerState.queues[2])).toBe(0);
  });

  it('BUG-R2-11：deductNanitesStock 严格按从低阶到高阶优先级顺序扣减，不因对象键序优先扣掉高能纳米工料', () => {
    const catalog = mkCatalog({
      buildings: [{ name: '战车工厂', cost: 2000, power: -100 } as never],
      productions: [
        {
          name: '天启坦克',
          cost: 1750,
          lane: 'lane.vehicle_land',
          assembly: { t_mat: 400, t_asm: 600, req_nanites: 70 },
        } as never,
      ],
    });

    // 故意将高阶纳米排在对象键最前面
    const stat: StatData = Schema.parse({
      meta: { date: '2026-07-03', day_count: 3 },
      economy: {
        credits: 5000,
        resources: {
          nanites: {
            机娘修复凝胶: 50,
            高能纳米工料: 50,
            军工纳米工料: 40,
            通用纳米工料: 30,
            custom_extra: 20,
          },
        },
      },
      bases: [
        {
          id: 'B1',
          name: '一号基地',
          power: { gen: 100, use: 0 },
          buildings: [{ name: '战车工厂', state: '运转', mode: '生产' }],
        },
      ],
      queues: [
        mkTxn({
          type: '生产',
          item: '天启坦克',
          base: 'B1',
          status: 'active',
          total_minutes: 1000,
          spent_minutes: 0,
        }),
      ],
    });

    const settled = settleFloor(structuredClone(stat), structuredClone(stat), '<timePast>0 D 1 H 0 M</timePast>', {
      catalog,
    });
    const afterNanites = settled.data.economy.resources?.nanites as Record<string, number>;
    // 消耗 70：应先扣光 通用纳米工料(30)，再扣 军工纳米工料(40)，高能纳米工料与机娘修复凝胶保持 50 不变
    expect(afterNanites['通用纳米工料']).toBe(0);
    expect(afterNanites['军工纳米工料']).toBe(0);
    expect(afterNanites['高能纳米工料']).toBe(50);
    expect(afterNanites['机娘修复凝胶']).toBe(50);
    expect(afterNanites['custom_extra']).toBe(20);
  });
});
