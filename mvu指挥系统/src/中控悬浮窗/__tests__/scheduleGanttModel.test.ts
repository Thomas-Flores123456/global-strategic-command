/**
 * scheduleGanttModel.test.ts —— PKG-A 多轨时间轴甘特排程、五大领域汇总与产线双模统计纯函数单元测试
 */
import { describe, expect, it } from 'vitest';
import type { UnifiedTask } from '../../红警指挥系统/engines/taskOrchestrator';
import {
  buildDomainScheduleGroups,
  buildGanttTimeAxis,
  computeGanttBarPosition,
  formatClockOffsetLabel,
  scheduleLaneSubTracks,
  summarizeLaneDualModeBuildings,
  type ScheduleBaseSection,
  type ScheduleProtocolLaneModel,
  type ScheduleSlotRow,
  type ScheduleTxnRow,
} from '../models/schedulePanelModel';

function makeTxn(over: Partial<ScheduleTxnRow> = {}): ScheduleTxnRow {
  return {
    item: '犀牛坦克',
    type: '生产',
    base: '新莫斯科',
    hold: false,
    status: 'active',
    tone: 'run',
    predicate: '在建（50%）',
    ganttPct: 50,
    ganttState: 'active',
    remainingMinutes: 180,
    ...over,
  };
}

describe('PKG-A · formatClockOffsetLabel & buildGanttTimeAxis 时间标尺与偏移换算', () => {
  it('formatClockOffsetLabel：支持有 clock 跨日换算与无 clock 相对时长标签', () => {
    const clock = { day: 6, time: '09:30' };
    expect(formatClockOffsetLabel(clock, 0)).toBe('第6日 09:30');
    expect(formatClockOffsetLabel(clock, -10)).toBe('第6日 09:30');
    expect(formatClockOffsetLabel(clock, 360)).toBe('第6日 15:30');
    expect(formatClockOffsetLabel(clock, 1080)).toBe('第7日 03:30');
    expect(formatClockOffsetLabel(clock, 1440)).toBe('第7日 09:30');

    expect(formatClockOffsetLabel(undefined, 0)).toBe('当前时刻');
    expect(formatClockOffsetLabel(undefined, 360)).toBe('+6h');
    expect(formatClockOffsetLabel(undefined, 1440)).toBe('+24h');
    expect(formatClockOffsetLabel(undefined, 2160)).toBe('+1d 12h');
  });

  it('buildGanttTimeAxis：支持 24h / 72h / 7d / auto 四档刻度生成', () => {
    const clock = { day: 6, time: '09:30' };

    const axis24 = buildGanttTimeAxis(clock, '24h');
    expect(axis24.horizonMinutes).toBe(1440);
    expect(axis24.originLabel).toBe('第6日 09:30');
    expect(axis24.ticks.map(t => t.offsetMin)).toEqual([0, 360, 720, 1080, 1440]);
    expect(axis24.ticks.map(t => t.label)).toEqual(['0h', '+6h', '+12h', '+18h', '+24h']);
    expect(axis24.ticks[1].subLabel).toBe('第6日 15:30');

    const axis72 = buildGanttTimeAxis(clock, '72h');
    expect(axis72.horizonMinutes).toBe(4320);
    expect(axis72.ticks).toHaveLength(7);
    expect(axis72.ticks[1].offsetMin).toBe(720);

    const axis7d = buildGanttTimeAxis(clock, '7d');
    expect(axis7d.horizonMinutes).toBe(10080);
    expect(axis7d.ticks).toHaveLength(8);
    expect(axis7d.ticks[1].label).toBe('+1d');
    expect(axis7d.ticks[7].label).toBe('+7d');

    const axisAutoShort = buildGanttTimeAxis(clock, 'auto', 600);
    expect(axisAutoShort.horizonMinutes).toBe(1440);
    expect(axisAutoShort.ticks).toHaveLength(5);

    const axisAutoLong = buildGanttTimeAxis(clock, 'auto', 2500);
    expect(axisAutoLong.horizonMinutes).toBe(2880);
    expect(axisAutoLong.ticks.map(t => t.offsetMin)).toEqual([0, 720, 1440, 2160, 2880]);
  });

  it('computeGanttBarPosition：映射百分比区间并保证 settling/瞬时任务最小可见宽度且不溢出 100%', () => {
    expect(computeGanttBarPosition(0, 720, 1440)).toEqual({ leftPct: 0, widthPct: 50 });
    expect(computeGanttBarPosition(360, 1080, 1440)).toEqual({ leftPct: 25, widthPct: 50 });

    const settlingPos = computeGanttBarPosition(0, 0, 1440);
    expect(settlingPos.leftPct).toBe(0);
    expect(settlingPos.widthPct).toBeGreaterThanOrEqual(3);
    expect(settlingPos.leftPct + settlingPos.widthPct).toBeLessThanOrEqual(100);

    const overflowPos = computeGanttBarPosition(720, 2880, 1440);
    expect(overflowPos).toEqual({ leftPct: 50, widthPct: 50 });

    const farFuturePos = computeGanttBarPosition(1800, 2400, 1440);
    expect(farFuturePos.widthPct).toBeGreaterThanOrEqual(3);
    expect(farFuturePos.leftPct + farFuturePos.widthPct).toBeLessThanOrEqual(100);
  });
});

describe('PKG-A · summarizeLaneDualModeBuildings 产线双模建筑统计与加速系数计算', () => {
  const basesFixture = [
    {
      id: 'B1',
      name: '新莫斯科',
      buildings: [
        { name: '苏联战车工厂', state: '运转', mode: '生产' },
        { name: '苏联战车工厂', state: '运转', mode: '生产' },
        { name: '苏联战车工厂', state: '运转', mode: '加速', accel_scope: 'base' },
        { name: '苏联战车工厂', state: '停机', mode: '加速', accel_scope: 'global' },
        { name: '装备工坊', state: '运转', mode: '生产' },
      ],
    },
    {
      id: 'B2',
      name: '列宁格勒',
      buildings: [
        { name: '扩大版自动化战车工厂', state: '运转', mode: '加速', accel_scope: 'global' },
        { name: '苏联战车工厂', state: '运转', mode: '加速', accel_scope: 'base' },
      ],
    },
  ];

  it('双模适用品类（lane.vehicle_land）：精确统计本基地生产/加速实例、全局与属地加速数及递减加速比', () => {
    const summaryB1 = summarizeLaneDualModeBuildings(basesFixture, 'B1', 'B1 lane.vehicle_land');
    expect(summaryB1.laneId).toBe('lane.vehicle_land');
    expect(summaryB1.dualModeCapable).toBe(true);
    expect(summaryB1.productionCount).toBe(2);
    expect(summaryB1.accelCount).toBe(1);
    expect(summaryB1.globalAccelCount).toBe(1); // B2 的 global 加速计入，B1 停机不计入
    expect(summaryB1.baseAccelCount).toBe(1); // B1 自身 base 加速计入，B2 的 base 加速不计入 B1
    expect(summaryB1.accelMultiplier).toBe(1.8); // 2 座生效加速 -> 1 + 0.5 + 0.3 = 1.8
    expect(summaryB1.instances).toHaveLength(3);
    expect(summaryB1.instances.map(i => i.mode)).toEqual(['生产', '生产', '加速']);
    expect(summaryB1.instances[2].accelScope).toBe('base');
  });

  it('非双模适用品类（lane.equipment / eng:eng.main）：dualModeCapable 为 false 且倍率为 1', () => {
    const eqSummary = summarizeLaneDualModeBuildings(basesFixture, 'B1', 'lane.equipment');
    expect(eqSummary.dualModeCapable).toBe(false);
    expect(eqSummary.accelMultiplier).toBe(1);
    expect(eqSummary.instances).toHaveLength(0);

    const engSummary = summarizeLaneDualModeBuildings(basesFixture, 'B1', 'eng:eng.main');
    expect(engSummary.dualModeCapable).toBe(false);
    expect(engSummary.accelMultiplier).toBe(1);
  });
});

describe('PKG-A · scheduleLaneSubTracks 多工位最早空闲子轨贪心接力排程', () => {
  const clock = { day: 6, time: '09:30' };

  it('双工位（capacity=2）并行 + 排队自动吸附最早释放工位 + 双模加速倍率折算', () => {
    const txns: readonly ScheduleTxnRow[] = Object.freeze([
      Object.freeze(makeTxn({ item: '犀牛坦克#1', status: 'active', remainingMinutes: 180, taskId: 't1' })),
      Object.freeze(makeTxn({ item: '猛犸坦克#2', status: 'active', remainingMinutes: 360, taskId: 't2' })),
      Object.freeze(makeTxn({ item: '天启坦克#3', status: 'queued', remainingMinutes: 480, taskId: 't3' })),
      Object.freeze(makeTxn({ item: '防空履带车#4', status: 'queued', remainingMinutes: 180, taskId: 't4' })),
    ]);

    // accelEff = 1.5 -> 实际耗时: t1=120m, t2=240m, t3=320m, t4=120m
    const res = scheduleLaneSubTracks(txns, 2, 1.5, clock);
    expect(res.subTracks).toHaveLength(2);

    // t1 -> 工位 #1 [0, 120]
    expect(res.enrichedTxns[0]).toMatchObject({
      item: '犀牛坦克#1',
      subTrackIndex: 0,
      startOffsetMin: 0,
      endOffsetMin: 120,
      startEtaText: '第6日 09:30',
      endEtaText: '第6日 11:30',
    });

    // t2 -> 工位 #2 [0, 240]
    expect(res.enrichedTxns[1]).toMatchObject({
      item: '猛犸坦克#2',
      subTrackIndex: 1,
      startOffsetMin: 0,
      endOffsetMin: 240,
      startEtaText: '第6日 09:30',
      endEtaText: '第6日 13:30',
    });

    // t3 -> 吸附最早空闲工位 #1 (freeAt=120) -> [120, 440]
    expect(res.enrichedTxns[2]).toMatchObject({
      item: '天启坦克#3',
      subTrackIndex: 0,
      startOffsetMin: 120,
      endOffsetMin: 440,
      startEtaText: '第6日 11:30',
      endEtaText: '第6日 16:50',
    });

    // t4 -> 此时工位 #1 freeAt=440, 工位 #2 freeAt=240 -> 吸附工位 #2 [240, 360]
    expect(res.enrichedTxns[3]).toMatchObject({
      item: '防空履带车#4',
      subTrackIndex: 1,
      startOffsetMin: 240,
      endOffsetMin: 360,
      startEtaText: '第6日 13:30',
      endEtaText: '第6日 15:30',
    });

    expect(res.maxEndOffsetMin).toBe(440);
    expect(res.subTracks[0].freeAtMin).toBe(440);
    expect(res.subTracks[1].freeAtMin).toBe(360);
  });

  it('settling 待确认、hold 暂缓与 capacity=0 滞留态各自走精确语义且不污染正常时间游标', () => {
    const txns: ScheduleTxnRow[] = [
      makeTxn({ item: '已完工待确认项', status: 'settling', remainingMinutes: 0 }),
      makeTxn({ item: '暂缓冻结项', status: 'queued', hold: true, remainingMinutes: 300 }),
      makeTxn({ item: '正常排队项', status: 'queued', hold: false, remainingMinutes: 180 }),
    ];

    const resNormal = scheduleLaneSubTracks(txns, 1, 1, clock);
    expect(resNormal.enrichedTxns[0]).toMatchObject({
      subTrackIndex: 0,
      startOffsetMin: 0,
      endOffsetMin: 0,
      startEtaText: '待确认完工',
      endEtaText: '立即交付',
    });
    expect(resNormal.enrichedTxns[1]).toMatchObject({
      subTrackIndex: 0,
      startOffsetMin: 0,
      endOffsetMin: 300,
      startEtaText: '已暂缓',
      endEtaText: '待恢复',
    });
    // 暂缓项不占用游标，正常排队项从 0 开始
    expect(resNormal.enrichedTxns[2]).toMatchObject({
      subTrackIndex: 0,
      startOffsetMin: 0,
      endOffsetMin: 180,
      startEtaText: '第6日 09:30',
      endEtaText: '第6日 12:30',
    });

    // capacity = 0 产线停摆
    const resStranded = scheduleLaneSubTracks([txns[2]], 0, 1, clock);
    expect(resStranded.enrichedTxns[0]).toMatchObject({
      subTrackIndex: 0,
      startOffsetMin: 0,
      endOffsetMin: 180,
      startEtaText: '产线暂停',
      endEtaText: '待建筑就绪',
    });
  });

  it('draftTasks 后续工程阶段拓扑预览块自动接续在依赖前序任务的 endOffsetMin 之后', () => {
    const activePhase = makeTxn({
      item: '灰熊改装·火控换装',
      type: '工程',
      status: 'active',
      remainingMinutes: 360,
      taskId: 'task:proj:p1:phase:0',
    });
    const draftTasks: UnifiedTask[] = [
      {
        id: 'task:proj:p1:phase:1',
        name: '灰熊改装·反应装甲披挂',
        domain: 'retrofit',
        status: 'draft',
        laneKey: 'A eng:eng.main',
        leadBaseId: '新莫斯科',
        CollaboratingBaseIds: ['新莫斯科'],
        workload: { totalMinutes: 720, spentMinutes: 0, minDaysLock: 1 },
        costPaid: false,
        topology: { projectId: 'p1', phaseIndex: 1, dependsOn: ['task:proj:p1:phase:0'] },
        metadata: { sourceKind: 'project_phase' },
      },
    ];

    const res = scheduleLaneSubTracks([activePhase], 1, 1, clock, draftTasks);
    expect(res.draftPreviews).toHaveLength(1);
    expect(res.draftPreviews[0]).toMatchObject({
      item: '灰熊改装·反应装甲披挂',
      isDraftPreview: true,
      startOffsetMin: 360,
      endOffsetMin: 1080,
      startEtaText: '第6日 15:30',
      endEtaText: '第7日 03:30',
      minDaysLock: 1,
    });
    expect(res.maxEndOffsetMin).toBe(1080);
  });
});

describe('PKG-A · buildDomainScheduleGroups 五大业务领域跨基地汇总', () => {
  it('按固定五领域顺序聚合基建、军备生产、改装与巨构、战区科研、统帅部条令推演', () => {
    const bases: ScheduleBaseSection[] = [
      {
        key: 'B1',
        name: '新莫斯科',
        empty: false,
        retired: false,
        lanes: [
          {
            key: 'B1 lane.main',
            name: '主建筑建造线',
            capacity: 1,
            activeCount: 1,
            queuedCount: 0,
            activeItems: ['苏联发电厂'],
            stranded: false,
            txns: [makeTxn({ item: '苏联发电厂', type: '建造', status: 'active' })],
          },
          {
            key: 'B1 lane.vehicle_land',
            name: '陆地载具生产线',
            capacity: 1,
            activeCount: 1,
            queuedCount: 1,
            activeItems: ['犀牛坦克'],
            stranded: false,
            txns: [
              makeTxn({ item: '犀牛坦克', type: '生产', status: 'active' }),
              makeTxn({ item: '天启坦克', type: '生产', status: 'queued' }),
            ],
          },
          {
            key: 'B1 eng:eng.main',
            name: '通用工程槽',
            capacity: 1,
            activeCount: 1,
            queuedCount: 0,
            activeItems: ['灰熊改装·火控换装'],
            stranded: false,
            domain: 'retrofit',
            txns: [makeTxn({ item: '灰熊改装·火控换装', type: '工程', domain: 'retrofit', status: 'active' })],
          },
        ],
      },
    ];

    const researchSlots: ScheduleSlotRow[] = [
      {
        key: 'research:slot.vehicle',
        slotId: 'slot.vehicle',
        name: '载具研究序列',
        unlocked: true,
        limit: 1,
        activeItems: ['履带工学'],
        queuedCount: 0,
        txns: [makeTxn({ item: '履带工学', type: '研究', domain: 'research', status: 'active' })],
      },
    ];

    const protocolLane: ScheduleProtocolLaneModel = {
      laneKey: 'theater:lane.protocol',
      displayName: '统帅部条令攻关队列',
      enabled: true,
      hasActivity: true,
      protocolPoints: 2,
      dailyRate: 1,
      institutesText: '最高统帅部',
      items: [
        {
          ref: 'proto.1',
          name: '战斗工兵与预制碉堡协议',
          track: '工程防御',
          tier: 1,
          status: 'experimenting',
          attempts: 1,
          exp: 50,
          next_prob_pct: 85,
          auto_queued: true,
          queue_order: 1,
          hold: false,
          laneKey: 'theater:lane.protocol',
        },
      ],
      station: {
        laneKey: 'theater:lane.protocol',
        domain: 'research',
        displayName: '统帅部条令攻关队列',
        capacity: 1,
        activeCount: 1,
        queuedCount: 0,
        locked: false,
      },
    };

    const groups = buildDomainScheduleGroups(bases, researchSlots, protocolLane);
    expect(groups.map(g => g.id)).toEqual([
      'construction',
      'production',
      'retrofit_megastructure',
      'research',
      'protocol',
    ]);
    expect(groups[0]).toMatchObject({
      id: 'construction',
      label: '基地基建与防御工事',
      shortLabel: '基建建造',
      activeCount: 1,
      queuedCount: 0,
    });
    expect(groups[1]).toMatchObject({
      id: 'production',
      label: '军备列装与人员训练',
      shortLabel: '军备生产',
      activeCount: 1,
      queuedCount: 1,
    });
    expect(groups[2]).toMatchObject({
      id: 'retrofit_megastructure',
      label: '装备改装与战略巨构',
      shortLabel: '改装与巨构',
      activeCount: 1,
      queuedCount: 0,
    });
    expect(groups[3]).toMatchObject({
      id: 'research',
      label: '战区科研攻关序列',
      shortLabel: '战区科研',
      activeCount: 1,
      queuedCount: 0,
    });
    expect(groups[4]).toMatchObject({
      id: 'protocol',
      label: '统帅部条令推演',
      shortLabel: '条令攻关',
      activeCount: 1,
      queuedCount: 0,
    });
    expect(groups[4].rows[0].item).toBe('战斗工兵与预制碉堡协议');
  });
});
