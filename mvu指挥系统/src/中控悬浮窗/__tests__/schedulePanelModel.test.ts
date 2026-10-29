/**
 * schedulePanelModel.test.ts —— CTRL-UI-SCHEDULE-01 验收测试
 *
 * 覆盖（对照卡面口径）：
 * ① 时钟行同源（SCHEDULE_COPY.clockLine）；② 全空态仍渲染 11 槽板与基地空态；
 * ③ 基地→产线两级：laneBoard capacity/active/queued 直呈＋谓语与 predicateFor 同函数同输入同值；
 * ④ 容量 0 滞留态（基地在场、无生产模式锚建筑）；⑤ 研究槽开通/在研/排队数/未开通理由照实；
 * ⑥ 槽显示名管线词翻译（槽→研究序列）；⑦ 收录口径与注入一致（done/cancelled 不上日程）；
 * ⑧ 孤儿基地兜底不丢事务；⑨ bases/SLOT_REGISTRY 数组序保留。
 */
import { describe, expect, it } from 'vitest';
import type { EffectiveCatalog } from '../../红警指挥系统/core/catalogEffective';
import { SCHEDULE_COPY } from '../../红警指挥系统/planning/scheduleCopy';
import { predicateFor } from '../../红警指挥系统/planning/scheduleText';
import { makeTxnEffFor } from '../../红警指挥系统/engines/settleFloor';
import { toUnifiedTasks } from '../../红警指挥系统/engines/taskProjectionAdapter';
import type { TransactionItem } from '../../红警指挥系统/engines/transactionEngine';
import type { Project, Schema } from '../../红警指挥系统/core/schema';
import { dispatchOrderText, dispatchVerbButtonsFor } from '../models/dispatchOrderText';
import {
  buildSchedulePanelModel,
  defaultLaneRegistryHub,
  schedulePanelModel,
  type SchedulePanelInput,
} from '../models/schedulePanelModel';

type QueueItem = Schema['queues'][number];

/* ═══════════════ 夹具 ═══════════════ */

const CATALOG = {
  researches: [
    { name: '履带工学', line: '陆地载具' },
    { name: '二级履带', line: '陆地载具' },
  ],
  buildings: [{ name: '盟军战车工厂' }, { name: '盟军建造厂核心' }],
  productions: [{ name: '犀牛坦克' }, { name: '灰熊坦克' }],
  retrofits: [],
  factionDefs: [],
} as unknown as EffectiveCatalog;

function q(over: Partial<QueueItem>): QueueItem {
  return {
    type: '生产',
    item: '测试产物',
    base: '基地A',
    status: 'queued',
    progress: 0,
    spent_minutes: 0,
    total_minutes: 600,
    qty: 1,
    qty_done: 0,
    cost_paid: true,
    hold: false,
    eta: '',
    started_at: '',
    ...over,
  } as QueueItem;
}

function stat(over: Partial<SchedulePanelInput> = {}): SchedulePanelInput {
  return {
    bases: [
      {
        id: 'A',
        name: '基地A',
        buildings: [
          { name: '盟军战车工厂', state: '运转', mode: '生产' },
          { name: '盟军建造厂核心', state: '运转' },
        ] as never,
      },
      { id: 'B', name: '基地B', buildings: [] as never },
    ],
    queues: [],
    clock: { day: 2, time: '23:00' },
    ...over,
  };
}

/* ═══════════════ ① 时钟 ═══════════════ */

describe('时钟行（同源 SCHEDULE_COPY.clockLine）', () => {
  it('有 clock → clockText 与 clockLine 字面一致；无 clock → undefined', () => {
    const m = schedulePanelModel(stat(), CATALOG);
    expect(m.clock).toEqual({ day: 2, time: '23:00' });
    expect(m.clockText).toBe(SCHEDULE_COPY.clockLine(2, '23:00'));
    const m2 = schedulePanelModel(stat({ clock: undefined }), CATALOG);
    expect(m2.clockText).toBeUndefined();
  });
});

/* ═══════════════ ② 全空态 ═══════════════ */

describe('全空态（面板常显：仍渲染槽板与基地空态）', () => {
  it('无在编事务 → allEmpty＋11 槽全渲染＋基地 empty 标记', () => {
    const m = schedulePanelModel(stat({ queues: [] }), CATALOG);
    expect(m.allEmpty).toBe(true);
    expect(m.allEmptyText).toBe(SCHEDULE_COPY.allEmpty);
    expect(m.researchSlots.length).toBe(11);
    expect(m.bases.length).toBe(2);
    expect(m.bases.every(b => b.empty)).toBe(true);
  });
});

/* ═══════════════ ③ 基地→产线两级＋谓语同源 ═══════════════ */

describe('基地→产线两级（laneBoard 直呈＋predicateFor 同源）', () => {
  const queues = [
    q({ item: '犀牛坦克', status: 'active', progress: 40, spent_minutes: 240 }),
    q({ item: '灰熊坦克', status: 'queued' }),
  ];
  const st = stat({ queues });
  const m = schedulePanelModel(st, CATALOG);

  it('基地A 陆线行：capacity/active/queued 与 laneBoard 口径一致', () => {
    const baseA = m.bases.find(b => b.name === '基地A')!;
    expect(baseA.empty).toBe(false);
    const land = baseA.lanes.find(l => l.name === '陆地载具生产线')!;
    expect(land.capacity).toBe(1); // 战车工厂一座生产模式
    expect(land.activeCount).toBe(1);
    expect(land.activeItems).toEqual(['犀牛坦克']);
    expect(land.queuedCount).toBe(1);
    expect(land.stranded).toBe(false);
  });

  it('谓语与 predicateFor（同 effFor 实参）逐字同值；queued 带「列于」前序', () => {
    const effFor = makeTxnEffFor(CATALOG, st as never);
    const land = m.bases[0].lanes.find(l => l.name === '陆地载具生产线')!;
    expect(land.txns.length).toBe(2);
    expect(land.txns[0].predicate).toBe(predicateFor(queues[0] as unknown as TransactionItem, undefined, effFor));
    expect(land.txns[1].predicate).toBe(
      predicateFor(queues[1] as unknown as TransactionItem, queues[0] as unknown as TransactionItem, effFor),
    );
    expect(land.txns[1].predicate).toBe('已立项待产，列于「犀牛坦克」之后');
    expect(land.txns[0].tone).toBe('run');
    expect(land.txns[1].tone).toBe('idle');
  });
});

/* ═══════════════ ④ 容量 0 滞留态 ═══════════════ */

describe('容量 0 滞留态（基地在场、无生产模式锚建筑）', () => {
  it('基地B 灰熊 queued 落陆线 → capacity 0 且 stranded', () => {
    const m = schedulePanelModel(stat({ queues: [q({ item: '灰熊坦克', base: '基地B' })] }), CATALOG);
    const baseB = m.bases.find(b => b.name === '基地B')!;
    const land = baseB.lanes.find(l => l.name === '陆地载具生产线')!;
    expect(land.capacity).toBe(0);
    expect(land.queuedCount).toBe(1);
    expect(land.stranded).toBe(true);
  });
});

/* ═══════════════ ⑤⑥ 研究槽板 ═══════════════ */

describe('战区科研调度 11 槽（slotBoard 直呈）', () => {
  const queues = [
    q({ type: '研究', item: '履带工学', status: 'active', progress: 40, spent_minutes: 240 }),
    q({ type: '研究', item: '二级履带', status: 'queued' }),
  ];
  const st = stat({ queues });
  const m = schedulePanelModel(st, CATALOG);

  it('开通槽（战车工厂在场）：unlocked/limit/active/queued 照实', () => {
    const slot = m.researchSlots.find(s => s.slotId === 'slot.vehicle')!;
    expect(slot.unlocked).toBe(true);
    expect(slot.limit).toBe(1);
    expect(slot.activeItems).toEqual(['履带工学']);
    expect(slot.queuedCount).toBe(1);
    expect(slot.lockedReason).toBeUndefined();
    expect(slot.txns.map(t => t.item)).toEqual(['履带工学', '二级履带']);
    expect(slot.txns[1].predicate).toBe('已立项待研，列于「履带工学」之后');
  });

  it('未开通槽：limit 0＋世界内理由（anchor 未建成照实呈现）', () => {
    const agri = m.researchSlots.find(s => s.slotId === 'slot.agri')!;
    expect(agri.unlocked).toBe(false);
    expect(agri.limit).toBe(0);
    expect(agri.lockedReason).toBe(SCHEDULE_COPY.lockedReason('水培站（生态副食与水循环保障站）'));
    expect(agri.txns.length).toBe(0);
  });

  it('槽显示名管线词翻译：「载具槽」→「载具研究序列」（「槽」字不上面板）', () => {
    const slot = m.researchSlots.find(s => s.slotId === 'slot.vehicle')!;
    expect(slot.name).toBe('载具研究序列');
    expect(slot.name).not.toContain('槽');
  });
});

/* ═══════════════ ⑦ 收录口径 ═══════════════ */

describe('收录口径与注入一致（done/cancelled 不上日程）', () => {
  it('done/cancelled 不出现在任何事务行（allEmpty 仅看在编）', () => {
    const m = schedulePanelModel(
      stat({
        queues: [
          q({ item: '犀牛坦克', status: 'done', progress: 100 }),
          q({ item: '灰熊坦克', status: 'cancelled', progress: 37 }),
        ],
      }),
      CATALOG,
    );
    expect(m.allEmpty).toBe(true);
    const allTxns = [...m.bases.flatMap(b => b.lanes), ...m.researchSlots].flatMap(l => l.txns);
    expect(allTxns.length).toBe(0);
  });
});

/* ═══════════════ ⑧⑨ 兜底与顺序 ═══════════════ */

describe('孤儿基地兜底与呈现序', () => {
  it('base 无法解析 → 兜底组（SCHEDULE_COPY.baseUnnamed）列尾，不丢事务', () => {
    const m = schedulePanelModel(
      stat({ queues: [q({ item: '犀牛坦克', base: '幽灵基地', status: 'active' })] }),
      CATALOG,
    );
    const orphan = m.bases[m.bases.length - 1];
    expect(orphan.name).toBe(SCHEDULE_COPY.baseUnnamed);
    expect(orphan.lanes[0].txns[0].item).toBe('犀牛坦克');
  });

  it('bases 数组序与 SLOT_REGISTRY 序保留', () => {
    const m = schedulePanelModel(stat(), CATALOG);
    expect(m.bases.map(b => b.name)).toEqual(['基地A', '基地B']);
    expect(m.researchSlots[0].slotId).toBe('slot.main');
    expect(m.researchSlots[10].slotId).toBe('slot.mecha');
  });
});

/* ═══════════════ O-R1 修复钉住：lane.default 键口径对齐 ═══════════════ */

describe('O-R1 · lane.default（综合线）键口径对齐（2026-10-01 顺手修）', () => {
  // 「补给箱」不命中任何推导关键词 → laneFor 第 4 级兜底 lane.default；
  // prodKeyFor 输出 v1 键「基地A 生产」，laneBoard 来源键为「基地A lane.default」（修复前两键不符）
  const queues = [q({ item: '补给箱', status: 'active', progress: 40, spent_minutes: 240 })];
  const m = schedulePanelModel(stat({ queues }), CATALOG);

  it('综合线单行呈现：capacity 1（与注入侧 limitFor 口径一致）且无 stranded 误标', () => {
    const baseA = m.bases.find(b => b.name === '基地A')!;
    const lane = baseA.lanes.find(l => l.name === '综合线')!;
    expect(lane.key).toBe('基地A lane.default');
    expect(lane.capacity).toBe(1);
    expect(lane.stranded).toBe(false);
    expect(lane.activeItems).toEqual(['补给箱']);
    expect(lane.txns.map(t => t.item)).toEqual(['补给箱']);
  });

  it('无双重呈现：全面板仅一行收录该事务，无滞留兜底行', () => {
    const allLanes = m.bases.flatMap(b => b.lanes);
    expect(allLanes.filter(l => l.txns.some(t => t.item === '补给箱')).length).toBe(1);
    expect(allLanes.every(l => !l.stranded)).toBe(true);
  });

  it('命名产线归并不受对齐影响（回归：陆线仍单行、容量/滞留口径不变）', () => {
    const m2 = schedulePanelModel(stat({ queues: [q({ item: '灰熊坦克', base: '基地B' })] }), CATALOG);
    const baseB = m2.bases.find(b => b.name === '基地B')!;
    const strandedLanes = baseB.lanes.filter(l => l.stranded);
    expect(strandedLanes.length).toBe(1);
    expect(strandedLanes[0].name).toBe('陆地载具生产线');
    expect(strandedLanes[0].txns.map(t => t.item)).toEqual(['灰熊坦克']);
  });
});

/* ═══════════════ E2d 接缝③：deployOf 注入 slotBoard/laneBoard（通道B 直呈） ═══════════════ */

describe('E2d 通道B（批（八十八）：面板模型接缝注入 deployOf）', () => {
  const DEPLOY_CATALOG = {
    researches: [{ name: '履带工学', line: '陆地载具' }],
    buildings: [],
    productions: [
      { name: '灰熊坦克' },
      { name: '前线战车组装车', deploy: { into: '前线战车组装场', capabilities: ['produce.*'] } },
      { name: '机动科研车', deploy: { into: '机动科研前哨', capabilities: ['research'] } },
    ],
    retrofits: [],
    factionDefs: [],
  } as unknown as EffectiveCatalog;

  it('laneBoard：在场 deploy 目标建筑（produce.* 覆盖）→ 陆线 capacity 1 直呈；无 deploy 块对照 capacity 0 滞留', () => {
    const st = stat({
      bases: [
        {
          id: 'A',
          name: '基地A',
          buildings: [{ name: '前线战车组装场', state: '运转', mode: '生产' }] as never,
        },
      ],
      queues: [q({ item: '灰熊坦克', base: '基地A', status: 'queued' })],
    });
    const m = schedulePanelModel(st, DEPLOY_CATALOG);
    const lane = m.bases[0].lanes.find(l => l.name === '陆地载具生产线')!;
    expect(lane.capacity).toBe(1); // 「前线战车组装场」不含「战车工厂」：唯通道B 可达
    expect(lane.stranded).toBe(false);
    expect(lane.queuedCount).toBe(1);

    const m0 = schedulePanelModel(st, CATALOG); // 既有 CATALOG 无 deploy 块 → 通道B 空命中
    const lane0 = m0.bases[0].lanes.find(l => l.name === '陆地载具生产线')!;
    expect(lane0.capacity).toBe(0);
    expect(lane0.stranded).toBe(true);
  });

  it('slotBoard：deploy 授予 research → slot.main 开通；无 deploy 块对照锁定', () => {
    const st = stat({
      bases: [{ id: 'A', name: '基地A', buildings: [{ name: '机动科研前哨', state: '运转' }] as never }],
    });
    const m = schedulePanelModel(st, DEPLOY_CATALOG);
    expect(m.researchSlots.find(s => s.slotId === 'slot.main')!.unlocked).toBe(true);

    const m0 = schedulePanelModel(st, CATALOG);
    expect(m0.researchSlots.find(s => s.slotId === 'slot.main')!.unlocked).toBe(false);
  });
});

/* ═══════════════ ⑨ 废弃基地标记（CTRL-RETIRE-01：模型只透传，呈现策略归组件） ═══════════════ */

describe('废弃基地标记透传（Base.status=「废弃」→ retired）', () => {
  it('status=废弃 → retired true；常规基地 false；孤儿基地恒 false', () => {
    const st = stat({
      bases: [
        { id: 'A', name: '基地A', buildings: [] as never },
        { id: 'B', name: '基地B', status: '废弃', buildings: [] as never },
      ] as never,
      // 事务 base 无法解析到任何在册基地 → 孤儿分组兜底（retired 恒 false）
      queues: [q({ item: '灰熊坦克', base: '未知前哨', status: 'active' })],
    });
    const m = schedulePanelModel(st, CATALOG);
    expect(m.bases.find(b => b.name === '基地A')!.retired).toBe(false);
    expect(m.bases.find(b => b.name === '基地B')!.retired).toBe(true);
    expect(m.bases.find(b => b.key === '__orphan__')!.retired).toBe(false);
  });

  it('废弃基地仍保留在 bases 清册（不丢弃实体，可审计）且 lanes 照常派生', () => {
    const st = stat({
      bases: [
        {
          id: 'A',
          name: '基地A',
          status: '废弃',
          buildings: [{ name: '盟军战车工厂', state: '运转', mode: '生产' }] as never,
        },
      ] as never,
      queues: [q({ item: '犀牛坦克', base: '基地A', status: 'active' })],
    });
    const m = schedulePanelModel(st, CATALOG);
    const sec = m.bases.find(b => b.name === '基地A')!;
    expect(sec.retired).toBe(true);
    expect(sec.lanes.length).toBeGreaterThan(0); // 产能照实派生（呈现与否归组件显隐）
    expect(sec.lanes.flatMap(l => l.txns).some(t => t.item === '犀牛坦克')).toBe(true);
  });

  it('status 缺席（旧档/最小输入）→ retired 恒 false（零迁移兼容）', () => {
    const m = schedulePanelModel(stat(), CATALOG);
    expect(m.bases.every(b => b.retired === false)).toBe(true);
  });
});

/* ═══════════════ ⑩ UTO-UI-SCHED-01 · 全景看板统一工位矩阵与双账本同源归一化 ═══════════════ */

describe('UTO-UI-SCHED-01 · LaneRegistryHub + toUnifiedTasks 全景工位矩阵同源归一化', () => {
  const UTO_CATALOG = {
    researches: [
      { name: '履带工学', line: '陆地载具' },
      { name: '轨道量子导航', line: '战略武器与航天' },
    ],
    buildings: [{ name: '盟军战车工厂' }, { name: '盟军建造厂核心' }, { name: '航天发射中心' }],
    productions: [{ name: '犀牛坦克' }, { name: '灰熊坦克' }],
    retrofits: [
      {
        name: '灰熊坦克现代化改装工程',
        phases: [
          { name: '火控换装', workload: { days: 1, min_days: 0.5, tflops: 10 } },
          { name: '反应装甲披挂', workload: { days: 2, min_days: 1, tflops: 15 } },
        ],
      },
    ],
    projects: [
      {
        name: '天穹轨道船坞',
        modules: [
          { id: 'core', name: '核心舱', prereqs: [], workload: { days: 2, min_days: 1, tflops: 40 } },
          { id: 'arm_a', name: '机械臂A', prereqs: ['core'], workload: { days: 1, min_days: 0.5, tflops: 20 } },
          {
            id: 'dock',
            name: '装配船台',
            prereqs: ['core', 'arm_a'],
            workload: { days: 3, min_days: 1.5, tflops: 60 },
          },
        ],
      },
    ],
    factionDefs: [],
  } as unknown as EffectiveCatalog;

  const projectsFixture: Project[] = [
    {
      id: 'proj:v1_01',
      schema_version: 1,
      ref: '灰熊坦克现代化改装工程',
      grade: '中改',
      scope: 'base',
      lead_base: '基地A',
      bases: ['基地A'],
      status: '在建',
      outcome: { type: 'mark' },
      phases: [
        { idx: 0, name: '火控换装', status: '进行中', queue_index: 2 },
        { idx: 1, name: '反应装甲披挂', status: '未启动', queue_index: null },
      ],
    },
    {
      id: 'proj:v2_01',
      schema_version: 2,
      ref: '天穹轨道船坞',
      grade: '巨构',
      scope: 'theater',
      lead_base: '基地A',
      bases: ['基地A', '基地B'],
      status: '在建',
      outcome: { type: 'mark' },
      modules: [
        { id: 'core', name: '核心舱', base: '基地A', status: '进行中', queue_index: 3 },
        { id: 'arm_a', name: '机械臂A', base: '基地A', status: '暂停', queue_index: 4 },
        { id: 'dock', name: '装配船台', base: '基地A', status: '未启动', queue_index: null },
      ],
    },
  ];

  const mixedStat = (): SchedulePanelInput => ({
    bases: [
      {
        id: 'A',
        name: '基地A',
        buildings: [
          { name: '盟军战车工厂', state: '运转', mode: '生产' },
          { name: '盟军建造厂核心', state: '运转' },
          { name: '航天发射中心', state: '运转' },
        ],
      },
      {
        id: 'B',
        name: '基地B',
        buildings: [],
      },
    ],
    queues: [
      q({
        type: '生产',
        item: '犀牛坦克',
        base: '基地A',
        status: 'active',
        progress: 50,
        spent_minutes: 300,
        total_minutes: 600,
      }),
      q({
        type: '研究',
        item: '履带工学',
        base: '',
        status: 'active',
        progress: 25,
        spent_minutes: 150,
        total_minutes: 600,
      }),
      q({
        type: '工程',
        item: '灰熊坦克现代化改装工程·火控换装',
        base: '基地A',
        lane: 'eng:eng.main',
        status: 'active',
        progress: 50,
        spent_minutes: 720,
        total_minutes: 1440,
      } as Partial<QueueItem>),
      q({
        type: '工程',
        item: '天穹轨道船坞·核心舱',
        base: '基地A',
        lane: 'eng:eng.orbital',
        status: 'active',
        progress: 50,
        spent_minutes: 1440,
        total_minutes: 2880,
      } as Partial<QueueItem>),
      q({
        type: '工程',
        item: '天穹轨道船坞·机械臂A',
        base: '基地A',
        lane: 'eng:eng.orbital',
        status: 'queued',
        hold: true,
        progress: 10,
        spent_minutes: 144,
        total_minutes: 1440,
      } as Partial<QueueItem>),
    ],
    projects: projectsFixture,
    clock: { day: 5, time: '16:30' },
  });

  it('制造 9 线、科研 11 槽与工程双槽（eng.main / eng.orbital）通过 LaneRegistryHub + toUnifiedTasks 同源派生且防双影', () => {
    const input = mixedStat();
    const m = schedulePanelModel(input, UTO_CATALOG);

    // 1. 工位矩阵：2 基地 × (9 制造线 + 2 工程槽) + 11 科研槽 = 33 个 LaneStationView
    const expectedStations = defaultLaneRegistryHub.resolveAllLanes({
      bases: input.bases!.map(b => ({
        id: b.id,
        name: b.name,
        status: b.status,
        buildings: (b.buildings ?? []).map(bd => ({ name: bd.name ?? '', state: bd.state, mode: bd.mode })),
      })),
      queues: input.queues as unknown as readonly TransactionItem[],
      catalog: UTO_CATALOG,
    });
    expect(m.stations).toEqual(expectedStations);
    expect(m.stations.length).toBe(33);

    // 2. 统一任务投影与防双影：queues[2..4] 被工程分段领用后不再生出 "task:queue:2..4"
    const expectedTasks = toUnifiedTasks(
      {
        bases: input.bases as never,
        queues: input.queues as never,
        projects: input.projects,
      },
      UTO_CATALOG,
    );
    expect(m.tasks).toEqual(expectedTasks);
    expect(m.tasks.some(t => t.id === 'task:queue:2')).toBe(false);
    expect(m.tasks.some(t => t.id === 'task:queue:3')).toBe(false);
    expect(m.tasks.some(t => t.id === 'task:queue:4')).toBe(false);

    // 3. 基地A 同时呈现制造产线与两类工程工位（eng.main 通用工程槽 + eng.orbital 轨道组装泊位）
    const baseA = m.bases.find(b => b.name === '基地A')!;
    const landLane = baseA.lanes.find(l => l.name === '陆地载具生产线')!;
    const engMain = baseA.lanes.find(l => l.name === '通用工程槽')!;
    const engOrbital = baseA.lanes.find(l => l.name === '轨道组装泊位')!;

    expect(landLane.domain).toBe('production');
    expect(landLane.activeItems).toEqual(['犀牛坦克']);
    expect(landLane.txns[0].taskId).toBe('task:queue:0');

    expect(engMain.key).toBe('A eng:eng.main');
    expect(engMain.domain).toBe('retrofit');
    expect(engMain.capacity).toBe(1);
    expect(engMain.stranded).toBe(false);
    expect(engMain.activeCount).toBe(1);
    expect(engMain.queuedCount).toBe(0);
    expect(engMain.txns).toHaveLength(1);
    expect(engMain.txns[0]).toMatchObject({
      item: '灰熊坦克现代化改装工程·火控换装',
      type: '工程',
      base: '基地A',
      status: 'active',
      hold: false,
      tone: 'run',
      taskId: 'task:proj:proj:v1_01:phase:0',
      domain: 'retrofit',
      taskStatus: 'active',
      sourceKind: 'project_phase',
    });

    expect(engOrbital.key).toBe('A eng:eng.orbital');
    expect(engOrbital.domain).toBe('retrofit');
    expect(engOrbital.capacity).toBe(1);
    expect(engOrbital.stranded).toBe(false);
    expect(engOrbital.activeCount).toBe(1);
    expect(engOrbital.queuedCount).toBe(1);
    expect(engOrbital.txns).toHaveLength(2);
    expect(engOrbital.txns[0]).toMatchObject({
      item: '天穹轨道船坞·核心舱',
      type: '工程',
      base: '基地A',
      status: 'active',
      hold: false,
      tone: 'run',
      taskId: 'task:proj:proj:v2_01:mod:core',
      domain: 'megastructure',
      taskStatus: 'active',
      sourceKind: 'project_module',
    });
    expect(engOrbital.txns[1]).toMatchObject({
      item: '天穹轨道船坞·机械臂A',
      type: '工程',
      base: '基地A',
      status: 'queued',
      hold: true,
      tone: 'hold',
      predicate: '已立项待办，列于「天穹轨道船坞·核心舱」之后；奉令暂缓',
      taskId: 'task:proj:proj:v2_01:mod:arm_a',
      domain: 'megastructure',
      taskStatus: 'held',
      sourceKind: 'project_module',
    });

    // 4. engineeringLanes 扁平切片与基地内工程工位引用一致
    expect(m.engineeringLanes).toEqual([engMain, engOrbital]);
  });

  it('未启动 draft 拓扑子任务过滤出执行行且保留于 draftTasks（含 dependsOn 依赖链）', () => {
    const m = schedulePanelModel(mixedStat(), UTO_CATALOG);
    const allRenderedItems = [
      ...m.bases.flatMap(b => b.lanes.flatMap(l => l.txns.map(t => t.item))),
      ...m.researchSlots.flatMap(s => s.txns.map(t => t.item)),
    ];
    expect(allRenderedItems).not.toContain('灰熊坦克现代化改装工程·反应装甲披挂');
    expect(allRenderedItems).not.toContain('天穹轨道船坞·装配船台');

    expect(m.draftTasks.map(t => t.id)).toEqual(['task:proj:proj:v1_01:phase:1', 'task:proj:proj:v2_01:mod:dock']);
    const v1Draft = m.draftTasks.find(t => t.id === 'task:proj:proj:v1_01:phase:1')!;
    expect(v1Draft.topology?.dependsOn).toEqual(['task:proj:proj:v1_01:phase:0']);

    const v2Draft = m.draftTasks.find(t => t.id === 'task:proj:proj:v2_01:mod:dock')!;
    expect(v2Draft.topology?.dependsOn).toEqual(['task:proj:proj:v2_01:mod:core', 'task:proj:proj:v2_01:mod:arm_a']);
  });

  it('工程工位容量 0 滞留态：基地无发射中心时 eng.orbital 标 stranded 并附 lockedReason', () => {
    const st = stat({
      bases: [{ id: 'B', name: '基地B', buildings: [] }],
      queues: [
        q({
          type: '工程',
          item: '天穹轨道船坞·核心舱',
          base: '基地B',
          lane: 'eng:eng.orbital',
          status: 'queued',
        } as Partial<QueueItem>),
      ],
    });
    const m = schedulePanelModel(st, UTO_CATALOG);
    const baseB = m.bases.find(b => b.name === '基地B')!;
    const orbital = baseB.lanes.find(l => l.name === '轨道组装泊位')!;
    expect(orbital.capacity).toBe(0);
    expect(orbital.queuedCount).toBe(1);
    expect(orbital.stranded).toBe(true);
    expect(orbital.lockedReason).toBe(SCHEDULE_COPY.lockedReason('航天发射中心/发射场系'));
  });

  it('行内四动词（置顶/置底/暂缓/恢复）判定与 dispatchOrderText 指令拼装 100% 兼容工程/制造/科研', () => {
    const m = schedulePanelModel(mixedStat(), UTO_CATALOG);
    const baseA = m.bases.find(b => b.name === '基地A')!;
    const engOrbital = baseA.lanes.find(l => l.name === '轨道组装泊位')!;
    const [activeEng, heldEng] = engOrbital.txns;

    const activeBtns = dispatchVerbButtonsFor(activeEng);
    expect(activeBtns.map(b => ({ verb: b.verb, enabled: b.enabled, armed: b.armed }))).toEqual([
      { verb: '置顶', enabled: true, armed: false },
      { verb: '置底', enabled: true, armed: false },
      { verb: '暂缓', enabled: true, armed: false },
      { verb: '恢复', enabled: false, armed: false },
    ]);

    const heldBtns = dispatchVerbButtonsFor(heldEng);
    expect(heldBtns.map(b => ({ verb: b.verb, enabled: b.enabled, armed: b.armed }))).toEqual([
      { verb: '置顶', enabled: true, armed: false },
      { verb: '置底', enabled: true, armed: false },
      { verb: '暂缓', enabled: false, armed: false },
      { verb: '恢复', enabled: true, armed: true },
    ]);

    const orderText = dispatchOrderText('恢复', heldEng);
    expect(orderText).toContain('下达队列调度令「恢复」——工程项目「天穹轨道船坞·机械臂A」，基地「基地A」');
    expect(orderText).toContain('调度: 恢复');
  });

  it('只读不突变与 buildSchedulePanelModel 别名兼容：深冻结入参零突变', () => {
    const input = mixedStat();
    Object.freeze(input);
    Object.freeze(input.bases);
    Object.freeze(input.queues);
    Object.freeze(input.projects);
    for (const b of input.bases ?? []) {
      Object.freeze(b);
      Object.freeze(b.buildings);
    }
    for (const item of input.queues ?? []) Object.freeze(item);
    for (const p of input.projects ?? []) Object.freeze(p);

    expect(buildSchedulePanelModel).toBe(schedulePanelModel);
    const m = buildSchedulePanelModel(input, UTO_CATALOG);
    expect(m.scheduledTasks.length).toBe(5);
  });

  it('静态审查：schedulePanelModel 函数体零 MVU 变量直写且接入 defaultLaneRegistryHub 与 toUnifiedTasks', () => {
    const fnSrc = Function.prototype.toString.call(schedulePanelModel);
    expect(fnSrc).toContain('defaultLaneRegistryHub');
    expect(fnSrc).toContain('toUnifiedTasks');
    expect(fnSrc).not.toMatch(/replaceVariables|insertOrAssignVariables|updateVariablesWith|deleteVariable/);
  });

  it('PKG-A · schedulePanelModel 完整填充 dualModeSummary、subTracks、draftPreviews、domainGroups、kpiSummary 与 maxEndOffsetMin', () => {
    const input = mixedStat();
    const m = schedulePanelModel(input, UTO_CATALOG);

    // 1. 顶层 domainGroups (固定 5 大领域) 与 kpiSummary、maxEndOffsetMin
    expect(m.domainGroups.map(g => g.id)).toEqual([
      'construction',
      'production',
      'retrofit_megastructure',
      'research',
      'protocol',
    ]);
    expect(m.kpiSummary.activeStationCount).toBeGreaterThanOrEqual(4);
    expect(m.kpiSummary.totalUnlockedCapacity).toBeGreaterThanOrEqual(4);
    expect(m.maxEndOffsetMin).toBeGreaterThan(0);

    // 2. 基地产线挂载 dualModeSummary、subTracks、draftPreviews 与 txn 甘特排程字段
    const baseA = m.bases.find(b => b.name === '基地A')!;
    const landLane = baseA.lanes.find(l => l.name === '陆地载具生产线')!;
    expect(landLane.dualModeSummary?.dualModeCapable).toBe(true);
    expect(landLane.dualModeSummary?.productionCount).toBe(1);
    expect(landLane.subTracks).toHaveLength(1);
    expect(landLane.txns[0]).toMatchObject({
      queueIndex: 0,
      subTrackIndex: 0,
      startOffsetMin: 0,
      endOffsetMin: 300,
      startEtaText: '第5日 16:30',
      endEtaText: '第5日 21:30',
    });

    // 3. 工程工位 draftPreviews 自动关联 V1 后续阶段
    const engMain = baseA.lanes.find(l => l.name === '通用工程槽')!;
    expect(engMain.draftPreviews).toHaveLength(1);
    expect(engMain.draftPreviews?.[0]).toMatchObject({
      item: '灰熊坦克现代化改装工程·反应装甲披挂',
      isDraftPreview: true,
      startOffsetMin: 720,
    });
  });
});
