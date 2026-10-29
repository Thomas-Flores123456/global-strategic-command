import { describe, expect, it } from 'vitest';
import type { EffectiveCatalog } from '../core/catalogEffective';
import { computePlanFingerprint, type ParsedPlanningIntent } from '../planning/planningParser';
import { buildApprovalCommandText, commitPlanningIntent } from '../planning/planningReceipt';
import { Schema, type StatData } from '../core/schema';
import { settleTransactions, type TransactionItem } from '../engines/transactionEngine';

function createTestCatalog(): EffectiveCatalog {
  return {
    buildings: [
      {
        name: '磁能反应炉',
        cost: 600,
        days: 1,
        power: 150,
        category: '电力',
        need_buildings: ['苏联建造厂'],
      },
    ],
    productions: [
      {
        name: '犀牛坦克',
        cost: 900,
        days: 1,
        category: '装甲',
        lane: '战车工厂',
        need_buildings: ['战车工厂'],
      },
      {
        name: '动员兵',
        cost: 100,
        days: 0.5,
        category: '步兵',
        lane: '兵营',
        need_buildings: ['兵营'],
      },
    ],
    researches: [],
    retrofits: [],
    projects: [],
    protocols: [],
    girls: [],
    factionDefs: [
      {
        faction: '苏联',
        mcv: '苏联建造厂',
        lab: '作战实验室',
      },
    ],
  } as unknown as EffectiveCatalog;
}

function createBaseState(): StatData {
  return Schema.parse({
    command: {
      unlocked_factions: ['allied', 'soviet', '苏联'],
    },
    economy: {
      credits: 2500,
      credits_daily: 400,
    },
    bases: [
      {
        id: 'base_north',
        name: '北坡主基地',
        status: '隐蔽中',
        buildings: [
          { name: '苏联建造厂', state: '运转' },
          { name: '兵营', state: '运转' },
          { name: '战车工厂', state: '运转' },
        ],
      },
    ],
    queues: [
      {
        type: '生产',
        item: '动员兵',
        base: 'base_north',
        progress: 25,
        eta: '余9时',
        status: 'active',
        started_at: 'D1 06:00',
        total_minutes: 720,
        spent_minutes: 180,
        qty: 1,
        qty_done: 0,
        cost_paid: true,
        min_days_lock: 0,
        hold: false,
      },
    ],
  });
}

function makeIntent(partial: Partial<ParsedPlanningIntent>): ParsedPlanningIntent {
  const actions = partial.actions ?? [
    { op: 'enqueue', base_ref: 'base_north', catalog_ref: '犀牛坦克', quantity: 2 },
  ];
  const mode = partial.mode ?? 'advisory';
  return {
    version: 1,
    request_ref: partial.request_ref ?? 'plan-101',
    mode,
    actions,
    fingerprint:
      partial.fingerprint ??
      computePlanFingerprint({
        mode,
        budget_cap_credits: partial.budget_cap_credits,
        actions,
      }),
    raw: '<排产计划></排产计划>',
    ...partial,
  };
}

describe('PLAN-COMMIT-01 · commitPlanningIntent 排产回执与零时间边界提交', () => {
  it('advisory 模式只写 latest_receipt 与 pending_plan，绝不修改 queues 与 credits', () => {
    const state = createBaseState();
    const catalog = createTestCatalog();
    const intent = makeIntent({ mode: 'advisory', request_ref: 'adv-01' });

    const res = commitPlanningIntent(state, intent, catalog, { floor: 12 });

    expect(res.committed).toBe(false);
    expect(res.receipt.status).toBe('advisory_ready');
    expect(res.receipt.created_at_floor).toBe(12);
    expect(res.next.economy.credits).toBe(2500);
    expect(res.next.queues).toHaveLength(1);
    expect(res.next.planning.latest_receipt?.request_ref).toBe('adv-01');
    expect(res.next.planning.pending_plan?.request_ref).toBe('adv-01');
    expect(res.events).toHaveLength(1);
    expect(res.events[0].level).toBe('info');
    expect(res.events[0].light).toBe('🟢');
  });

  it('delegate_once 在预算内真实扣款、新队列项以 status=queued & spent_minutes=0 入列并记录幂等指纹', () => {
    const state = createBaseState();
    const catalog = createTestCatalog();
    const intent = makeIntent({
      mode: 'delegate_once',
      request_ref: 'del-01',
      budget_cap_credits: 2000,
      actions: [{ op: 'enqueue', base_ref: 'base_north', catalog_ref: '犀牛坦克', quantity: 2 }],
    });

    const res = commitPlanningIntent(state, intent, catalog, { floor: 15 });

    expect(res.committed).toBe(true);
    expect(res.receipt.status).toBe('committed');
    expect(res.receipt.created_at_floor).toBe(15);
    expect(res.next.economy.credits).toBe(700); // 2500 - 1800
    expect(res.next.queues).toHaveLength(2);
    expect(res.next.queues[1]).toMatchObject({
      type: '生产',
      item: '犀牛坦克',
      base: 'base_north',
      status: 'queued',
      spent_minutes: 0,
      progress: 0,
      qty: 2,
      cost_paid: true,
    });
    expect(res.next.planning.committed_fingerprints).toContain(intent.fingerprint);
    expect(res.next.planning.pending_plan).toBeNull();
    expect(res.next.planning.latest_receipt?.status).toBe('committed');

    // 同一方案二次重放：幂等防重跳过，绝不二次扣款或重复入队
    const dupRes = commitPlanningIntent(res.next, intent, catalog, { floor: 16 });
    expect(dupRes.committed).toBe(false);
    expect(dupRes.next.economy.credits).toBe(700);
    expect(dupRes.next.queues).toHaveLength(2);
    expect(dupRes.events[0].type).toBe('planning_idempotent_skip');
  });

  describe.each(['新入列', '占位回填'])('G01-03 · %s', route => {
    it.each([1, 2, 10])('qty=%i 的总工时、首件/整批节拍与一次扣款一致', qty => {
      const state = createBaseState();
      state.economy.credits = 10000;
      state.queues = [];
      if (route === '占位回填') {
        state.queues = Schema.parse({
          queues: [{ type: '生产', item: '犀牛坦克', base: 'base_north', status: 'queued', qty }],
        }).queues;
      }
      const catalog = createTestCatalog();
      const intent = makeIntent({
        mode: 'delegate_once',
        budget_cap_credits: 10000,
        actions: [{ op: 'enqueue', base_ref: 'base_north', catalog_ref: '犀牛坦克', quantity: qty }],
      });
      const committed = commitPlanningIntent(state, intent, catalog);
      expect(committed.committed).toBe(true);
      expect(committed.next.queues).toHaveLength(1);
      expect(committed.next.queues[0]).toMatchObject({
        qty, total_minutes: 1440 * qty, spent_minutes: 0, status: 'queued', cost_paid: true,
      });
      expect(committed.receipt.actions[0].est_minutes).toBe(1440 * qty);
      expect(committed.next.economy.credits).toBe(10000 - 900 * qty);
      const replay = commitPlanningIntent(committed.next, intent, catalog);
      expect(replay.committed).toBe(false);
      expect(replay.next.economy.credits).toBe(10000 - 900 * qty);
      expect(replay.next.queues).toEqual(committed.next.queues);

      const active = settleTransactions(committed.next, 0).next;
      const beforeFirst = settleTransactions(active, 1439).next;
      expect(beforeFirst.queues[0].status).toBe('active');
      expect(beforeFirst.queues[0].qty_done).toBe(0);
      const first = settleTransactions(beforeFirst, 1).next;
      expect(first.queues[0].progress).toBeCloseTo(100 / qty);
      if (qty > 1) {
        expect(first.queues[0].qty_done).toBe(1);
        expect(first.queues[0].status).toBe('active');
      }
      const beforeBatch = settleTransactions(active, 1440 * qty - 1).next;
      expect(beforeBatch.queues[0].status).toBe('active');
      expect(beforeBatch.queues[0].qty_done).toBe(qty - 1);
      const batch = settleTransactions(beforeBatch, 1).next;
      expect(batch.queues[0].status).toBe('settling');
      expect(batch.queues[0].progress).toBe(100);
      expect(batch.economy.credits).toBe(10000 - 900 * qty);
    });
  });

  it('超预算 delegate_once 进入 awaiting_approval，且支持 forceApprove 强制批准与指令文本生成', () => {
    const state = createBaseState();
    const catalog = createTestCatalog();
    const intent = makeIntent({
      mode: 'delegate_once',
      request_ref: 'del-over-budget',
      budget_cap_credits: 1000,
      actions: [{ op: 'enqueue', base_ref: 'base_north', catalog_ref: '犀牛坦克', quantity: 2 }],
    });

    const pendingRes = commitPlanningIntent(state, intent, catalog, { floor: 20 });
    expect(pendingRes.committed).toBe(false);
    expect(pendingRes.receipt.status).toBe('awaiting_approval');
    expect(pendingRes.next.economy.credits).toBe(2500);
    expect(pendingRes.next.queues).toHaveLength(1);
    expect(pendingRes.next.planning.pending_plan?.request_ref).toBe('del-over-budget');
    expect(pendingRes.events[0].level).toBe('warning');

    const cmdText = buildApprovalCommandText(pendingRes.receipt);
    expect(cmdText).toContain('del-over-budget');
    expect(cmdText).toContain('base_north');
    expect(cmdText).toContain('犀牛坦克×2');

    // 指挥官显式 forceApprove 核准入列
    const approvedRes = commitPlanningIntent(pendingRes.next, intent, catalog, {
      floor: 21,
      forceApprove: true,
    });
    expect(approvedRes.committed).toBe(true);
    expect(approvedRes.receipt.status).toBe('committed');
    expect(approvedRes.next.economy.credits).toBe(700);
    expect(approvedRes.next.queues).toHaveLength(2);
    expect(approvedRes.next.planning.pending_plan).toBeNull();
  });

  it('零时间边界铁律：settleTransactions 先结算本楼 Δt，随后 commitPlanningIntent 新增项保持 spent_minutes=0', () => {
    const initial = createBaseState();
    const catalog = createTestCatalog();

    // 1. 模拟 useParse L794：本楼既有队列先经过 Δt=180 分钟推进
    const settled = settleTransactions(
      initial as unknown as { queues: TransactionItem[] },
      180,
    ).next as unknown as StatData;
    expect(settled.queues[0].spent_minutes).toBe(360); // 180 + 180

    // 2. 模拟 useParse L881：在 settleFloor 之后结转本楼 <排产计划>
    const intent = makeIntent({
      mode: 'delegate_once',
      request_ref: 'zero-time-boundary',
      budget_cap_credits: 2000,
      actions: [{ op: 'enqueue', base_ref: 'base_north', catalog_ref: '磁能反应炉', quantity: 1 }],
    });
    const finalRes = commitPlanningIntent(settled, intent, catalog, { floor: 30 });

    expect(finalRes.committed).toBe(true);
    // 既有动员兵保持本楼结算后的 360 分钟
    expect(finalRes.next.queues[0].spent_minutes).toBe(360);
    // 本楼新入队的磁能反应炉严格保持 status='queued', spent_minutes=0, progress=0，绝不偷吃本楼 180 分钟 Δt
    expect(finalRes.next.queues[1]).toMatchObject({
      type: '建造',
      item: '磁能反应炉',
      status: 'queued',
      spent_minutes: 0,
      progress: 0,
    });
  });

  describe('G01-01 · 串联 parse -> settle -> commit：批准前不真实入列/不造建筑占位/不耗纳米，拒绝或待批时状态零污染', () => {
    it.each([
      {
        label: '未解锁建筑（拒绝）',
        credits: 2500,
        budgetCap: 2000,
        item: '超时空传送仪',
        kind: '建造',
        qty: 1,
        expectedStatus: 'rejected',
      },
      {
        label: '余额不足建造（拒绝）',
        credits: 200,
        budgetCap: 2000,
        item: '磁能反应炉',
        kind: '建造',
        qty: 1,
        expectedStatus: 'rejected',
      },
      {
        label: '超预算生产（待批）',
        credits: 2500,
        budgetCap: 1000,
        item: '犀牛坦克',
        kind: '生产',
        qty: 2,
        expectedStatus: 'awaiting_approval',
      },
    ])('$label：串联 parse -> settleFloor -> commitPlanningIntent 后 queues、buildings、credits、nanites 保持原样', async ({
      credits,
      budgetCap,
      item,
      kind,
      qty,
      expectedStatus,
    }) => {
      const { parseMessageText } = await import('../parse/parsePipeline');
      const { settleFloor } = await import('../engines/settleFloor');
      const catalog = createTestCatalog();
      const baseline = createBaseState();
      baseline.economy.credits = credits;
      baseline.economy.credits_daily = 0;
      baseline.economy.resources = Schema.parse({ economy: { resources: { nanites: { 标准纳米工料: 50 } } } }).economy.resources;
      const initialQueues = structuredClone(baseline.queues);
      const initialBuildings = structuredClone(baseline.bases[0].buildings);

      const raw = `<排产计划>
模式: 委托
请求号: g01-01-${expectedStatus}
预算上限: ${budgetCap}
动作:
  - 操作: 入队
    类型: ${kind}
    项目: ${item}
    基地: 北坡主基地
    数量: ${qty}
</排产计划>`;

      // 1. 解析（开启 deferPlanningCommit，不在批准前提前塞入队列与在建占位）
      const parsed = parseMessageText(raw, baseline, { deferPlanningCommit: true });
      expect(parsed.planningDecls).toHaveLength(1);
      expect(parsed.data.queues).toEqual(initialQueues);
      expect(parsed.data.bases[0].buildings).toEqual(initialBuildings);

      // 2. 结算（0 分钟 Δt，不应把未批准的新任务升格为 active 或消耗纳米）
      const settled = settleFloor(baseline, parsed.data, raw, { catalog });
      expect(settled.data.queues).toHaveLength(1);
      expect(settled.data.bases[0].buildings).toEqual(initialBuildings);
      expect(settled.data.economy.resources.nanites).toEqual({ 标准纳米工料: 50 });

      // 3. 提交裁决：被拒或待批时 queues、buildings、credits、nanites 严禁变化
      const committed = commitPlanningIntent(settled.data, parsed.planningDecls[0], catalog, { floor: 10 });
      expect(committed.committed).toBe(false);
      expect(committed.receipt.status).toBe(expectedStatus);
      expect(committed.next.queues).toHaveLength(1);
      expect(committed.next.queues[0].item).toBe('动员兵');
      expect(committed.next.bases[0].buildings).toEqual(initialBuildings);
      expect(committed.next.economy.credits).toBe(credits);
      expect(committed.next.economy.resources.nanites).toEqual({ 标准纳米工料: 50 });
    });

    it('正常批准建造计划：串联 parse -> settleFloor -> commitPlanningIntent 只扣费一次、创建在建占位且新任务 status=queued & spent_minutes=0', async () => {
      const { parseMessageText } = await import('../parse/parsePipeline');
      const { settleFloor } = await import('../engines/settleFloor');
      const catalog = createTestCatalog();
      const baseline = createBaseState();
      baseline.economy.credits = 2000;
      baseline.economy.credits_daily = 0;

      const raw = `< timePast >0 D 2 H 0 M</timePast>
<排产计划>
模式: 委托
请求号: g01-01-approve
预算上限: 1000
动作:
  - 操作: 入队
    类型: 建造
    项目: 磁能反应炉
    基地: 北坡主基地
    数量: 1
    坐标: [3, 2]
    层级: 地面层
</排产计划>`.replace('< timePast >', '<timePast>');

      const parsed = parseMessageText(raw, baseline, { deferPlanningCommit: true });
      const settled = settleFloor(baseline, parsed.data, raw, { catalog });
      const committed = commitPlanningIntent(settled.data, parsed.planningDecls[0], catalog, { floor: 11 });

      expect(committed.committed).toBe(true);
      expect(committed.receipt.status).toBe('committed');
      // 仅扣一次 600（2000 - 600 = 1400）
      expect(committed.next.economy.credits).toBe(1400);
      // 既有动员兵推进了 120 分钟（180 + 120 = 300），新批准的磁能反应炉保持 queued 且 spent_minutes = 0
      expect(committed.next.queues).toHaveLength(2);
      expect(committed.next.queues[0].spent_minutes).toBe(300);
      expect(committed.next.queues[1]).toMatchObject({
        type: '建造',
        item: '磁能反应炉',
        status: 'queued',
        spent_minutes: 0,
        progress: 0,
        qty: 1,
        total_minutes: 1440,
        cost_paid: true,
      });
      expect(
        committed.next.bases[0].buildings.find(b => b.name === '磁能反应炉' && b.state === '建造中'),
      ).toMatchObject({
        name: '磁能反应炉',
        state: '建造中',
        layer: '地面层',
        coord: { x: 3, y: 2 },
      });
    });

    it('8. BUG-LIVE-22a/22b（#68楼实机复现）：第二基地含带阵营前缀建筑（苏联建造厂/苏联磁能反应炉/苏联矿石精炼厂/苏联战车工厂/苏联兵营）时，正确核算电网 power.gen/use 并通过 <排产计划> 分域子队列入列', async () => {
      const { parseMessageText } = await import('../parse/parsePipeline');
      const { settleFloor } = await import('../engines/settleFloor');
      const catalog68 = createTestCatalog();
      (catalog68.buildings as unknown as Array<Record<string, unknown>>) = [
        {
          name: '建造厂核心',
          cost: 2500,
          power: -50,
          research: null,
          prereqs: [],
          need_buildings: [],
          eta: '1天',
          desc: '主建造厂',
        },
        {
          name: '磁能反应炉',
          cost: 600,
          power: -200,
          research: null,
          prereqs: [],
          need_buildings: ['建造厂核心'],
          eta: '1天',
          desc: '发电厂',
        },
        {
          name: '矿石精炼厂',
          cost: 2000,
          power: 50,
          research: null,
          prereqs: [],
          need_buildings: ['建造厂核心'],
          eta: '1天',
          desc: '精炼厂',
        },
        {
          name: '战车工厂',
          cost: 2000,
          power: 25,
          research: null,
          prereqs: [],
          need_buildings: ['建造厂核心'],
          eta: '1天',
          desc: '重装产线',
        },
        {
          name: '兵营',
          cost: 500,
          power: 10,
          research: null,
          prereqs: [],
          need_buildings: ['建造厂核心'],
          eta: '1天',
          desc: '步兵产线',
        },
      ];
      (catalog68.productions as unknown as Array<Record<string, unknown>>).push({
        name: '犀牛主战坦克族',
        kind: '载具',
        cost: 900,
        research: null,
        prereqs: [],
        need_buildings: ['战车工厂'],
        eta: '1天',
        desc: '苏联主力坦克',
        lane: 'lane.vehicle_land',
      });

      const baseline68 = Schema.parse({
        command: { unlocked_factions: ['allied', 'soviet'] },
        economy: { credits: 50000, credits_daily: 0 },
        bases: [
          {
            id: '恶土前哨主基地',
            name: '恶土前哨主基地',
            status: '警戒',
            power: { gen: 500, use: 100 },
            buildings: [{ name: '盟军建造厂', state: '运转' }],
          },
          {
            id: '铁砧重矿前哨分基地',
            name: '铁砧重矿前哨分基地',
            status: '警戒',
            power: { gen: 250, use: 0 },
            buildings: [
              { name: '苏联建造厂', state: '运转' },
              { name: '苏联磁能反应炉', state: '运转' },
              { name: '苏联矿石精炼厂', state: '运转' },
              { name: '苏联战车工厂', state: '运转' },
              { name: '苏联兵营', state: '运转' },
            ],
          },
        ],
      });

      const raw68 = `<排产计划>
批准状态: 已批准
建筑队列: []
作战单位队列:
  - 单位: 犀牛主战坦克族
    数量: 2
    基地: 铁砧重矿前哨分基地
  - 单位: 动员兵
    数量: 10
    基地: 铁砧重矿前哨分基地
研究队列: []
</排产计划>`;

      const parsed68 = parseMessageText(raw68, baseline68, { deferPlanningCommit: true });
      expect(parsed68.quarantine).toEqual([]);
      expect(parsed68.planningDecls).toHaveLength(1);

      const settled68 = settleFloor(baseline68, parsed68.data, raw68, { catalog: catalog68 });
      // 铁砧重矿前哨分基地：gen = 50(建造厂核心) + 150(磁能反应炉) -> max(250, 200) = 250；
      // use = 50(矿石精炼厂) + 25(战车工厂) + 10(兵营) = 85
      expect(settled68.data.bases[1].power).toEqual({ gen: 250, use: 85 });

      const committed68 = commitPlanningIntent(settled68.data, parsed68.planningDecls[0], catalog68, { floor: 68 });
      expect(committed68.committed).toBe(true);
      expect(committed68.receipt.status).toBe('committed');
      expect(committed68.next.queues.filter(q => q.base === '铁砧重矿前哨分基地')).toMatchObject([
        {
          type: '生产',
          item: '犀牛主战坦克族',
          base: '铁砧重矿前哨分基地',
          qty: 2,
          status: 'queued',
        },
        {
          type: '生产',
          item: '动员兵',
          base: '铁砧重矿前哨分基地',
          qty: 10,
          status: 'queued',
        },
      ]);
    });

    it('BUG-LIVE-28a（#72楼 -> #86楼实机复现）：同楼层在途重复提交保持幂等防重，但前一批次完工归档后跨楼层同配比复产正常核准入列', async () => {
      const { parseMessageText } = await import('../parse/parsePipeline');
      const catalog86 = createTestCatalog();
      catalog86.buildings = [
        {
          name: '建造厂核心',
          cost: 2500,
          power: -50,
          research: null,
          prereqs: [],
          need_buildings: [],
          eta: '1天',
          desc: '主基地核心',
        },
        {
          name: '战车工厂',
          cost: 2000,
          power: 25,
          research: null,
          prereqs: [],
          need_buildings: ['建造厂核心'],
          eta: '1天',
          desc: '重装产线',
        },
        {
          name: '兵营',
          cost: 500,
          power: 10,
          research: null,
          prereqs: [],
          need_buildings: ['建造厂核心'],
          eta: '1天',
          desc: '步兵产线',
        },
        {
          name: '磁暴线圈',
          cost: 1500,
          power: 75,
          research: null,
          prereqs: [],
          need_buildings: ['建造厂核心'],
          eta: '1天',
          desc: '磁暴防御塔',
        },
      ] as unknown as EffectiveCatalog['buildings'];
      catalog86.productions = [
        {
          name: '通用履带底盘与空降轻装族',
          aliases: ['防空履带车'],
          kind: '载具',
          cost: 1300,
          research: null,
          prereqs: [],
          need_buildings: ['战车工厂'],
          eta: '1天',
          desc: '苏联履带防空车',
          lane: 'lane.vehicle_land',
        },
        {
          name: '磁暴步兵',
          kind: '人员',
          cost: 500,
          research: null,
          prereqs: [],
          need_buildings: ['兵营', '磁暴线圈'],
          eta: '12小时',
          desc: '苏联磁暴装甲步兵',
          lane: 'lane.personnel',
        },
      ] as unknown as EffectiveCatalog['productions'];

      const rawPlan = `<排产计划>
批准状态: 已批准
建筑队列: []
作战单位队列:
  - 单位: 防空履带车
    数量: 2
    基地: 铁砧重矿前哨分基地
  - 单位: 磁暴步兵
    数量: 5
    基地: 恶土前哨主基地
研究队列: []
</排产计划>`;

      const state72 = Schema.parse({
        command: { unlocked_factions: ['allied', 'soviet'] },
        economy: { credits: 20000, credits_daily: 1000 },
        bases: [
          {
            id: '恶土前哨主基地',
            name: '恶土前哨主基地',
            status: '警戒',
            buildings: [
              { name: '苏联建造厂', state: '运转' },
              { name: '苏联兵营', state: '运转' },
              { name: '磁暴线圈', state: '运转' },
            ],
          },
          {
            id: '铁砧重矿前哨分基地',
            name: '铁砧重矿前哨分基地',
            status: '警戒',
            buildings: [
              { name: '苏联建造厂', state: '运转' },
              { name: '苏联战车工厂', state: '运转' },
            ],
          },
        ],
        queues: [],
      });

      const parsed72 = parseMessageText(rawPlan, state72, { deferPlanningCommit: true });
      const committed72 = commitPlanningIntent(state72, parsed72.planningDecls[0], catalog86, { floor: 72 });
      expect(committed72.committed).toBe(true);
      expect(committed72.next.queues).toHaveLength(2);
      expect(committed72.next.economy.credits).toBe(20000 - (1300 * 2 + 500 * 5));

      // 同批次仍在队列中时重复调用：严格幂等防重跳过
      const dupInFlight = commitPlanningIntent(committed72.next, parsed72.planningDecls[0], catalog86, { floor: 72 });
      expect(dupInFlight.committed).toBe(false);
      expect(dupInFlight.receipt.summary).toContain('幂等防重');
      expect(dupInFlight.next.queues).toHaveLength(2);

      // 模拟 #74 楼完工下线、#76 楼归档清空 queues 后推进到 #86 楼再次下达相同配比排产计划
      const state86 = Schema.parse({
        ...committed72.next,
        queues: [],
      });
      const parsed86 = parseMessageText(rawPlan, state86, { deferPlanningCommit: true });
      const committed86 = commitPlanningIntent(state86, parsed86.planningDecls[0], catalog86, { floor: 86 });
      expect(committed86.committed).toBe(true);
      expect(committed86.receipt.status).toBe('committed');
      expect(committed86.next.economy.credits).toBe(committed72.next.economy.credits - (1300 * 2 + 500 * 5));
      expect(committed86.next.queues).toMatchObject([
        {
          type: '生产',
          item: '通用履带底盘与空降轻装族',
          base: '铁砧重矿前哨分基地',
          qty: 2,
          status: 'queued',
        },
        {
          type: '生产',
          item: '磁暴步兵',
          base: '恶土前哨主基地',
          qty: 5,
          status: 'queued',
        },
      ]);
    });
  });
});

