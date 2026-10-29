import { describe, expect, it } from 'vitest';
import type { EffectiveCatalog } from '../core/catalogEffective';
import { computePlanFingerprint, type ParsedPlanningIntent } from '../planning/planningParser';
import { runPlanningSandbox } from '../planning/planningSandbox';
import { Schema, type StatData } from '../core/schema';

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
      {
        name: '天启坦克',
        cost: 1750,
        days: 2,
        category: '重装',
        lane: '战车工厂',
        need_buildings: ['战车工厂'],
        prereqs: ['重装合成装甲'],
      },
    ],
    researches: [
      {
        name: '重装合成装甲',
        cost: 1000,
        days: 2,
        line: '苏联装甲线',
        prereq: {},
      },
    ],
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

function createBaseState(overrides?: Partial<StatData>): StatData {
  const base = Schema.parse({
    economy: {
      credits: 3000,
      credits_daily: 500,
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
      {
        id: 'base_old',
        name: '废弃前哨',
        status: '废弃',
        buildings: [],
      },
    ],
    queues: [
      {
        type: '生产',
        item: '动员兵',
        base: 'base_north',
        progress: 40,
        eta: '余12时',
        status: 'active',
        started_at: 'D1 08:00',
        total_minutes: 720,
        spent_minutes: 288,
        qty: 1,
        qty_done: 0,
        cost_paid: true,
        min_days_lock: 0,
        hold: false,
      },
      {
        type: '生产',
        item: '犀牛坦克',
        base: 'base_north',
        progress: 0,
        eta: '1日',
        status: 'queued',
        started_at: '',
        total_minutes: 1440,
        spent_minutes: 0,
        qty: 1,
        qty_done: 0,
        cost_paid: true,
        min_days_lock: 0,
        hold: false,
      },
    ],
    tech: {
      done: [],
    },
  });
  return { ...base, ...overrides };
}

function makeIntent(partial: Partial<ParsedPlanningIntent>): ParsedPlanningIntent {
  const actions = partial.actions ?? [
    { op: 'enqueue', base_ref: 'base_north', catalog_ref: '犀牛坦克', quantity: 2 },
  ];
  const mode = partial.mode ?? 'advisory';
  const request_ref = partial.request_ref ?? 'req-001';
  return {
    version: 1,
    request_ref,
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

describe('PLAN-SANDBOX-01 · runPlanningSandbox 排产沙盒试排纯函数', () => {
  it('100% 零副作用：advisory 试排生成 preview 回执且绝不修改入参 state', () => {
    const state = createBaseState();
    const snapshotBefore = JSON.stringify(state);
    const catalog = createTestCatalog();
    const intent = makeIntent({
      mode: 'advisory',
      actions: [{ op: 'enqueue', base_ref: 'base_north', catalog_ref: '犀牛坦克', quantity: 2 }],
    });

    const res = runPlanningSandbox(state, intent, catalog);

    expect(JSON.stringify(state)).toBe(snapshotBefore);
    expect(res.canCommit).toBe(false);
    expect(res.alreadyCommitted).toBe(false);
    expect(res.receipt.status).toBe('advisory_ready');
    expect(res.receipt.total_cost_credits).toBe(1800);
    expect(res.receipt.actions[0].status).toBe('preview');
    expect(res.receipt.diff_summary.added).toEqual(['犀牛坦克×2']);
    // 沙盒内已预扣并推入队列，原 state 纹丝不动
    expect(res.sandboxState.economy.credits).toBe(1200);
    expect(state.economy.credits).toBe(3000);
    expect(res.sandboxState.queues).toHaveLength(3);
    expect(res.sandboxState.queues[2]).toMatchObject({
      item: '犀牛坦克',
      status: 'queued',
      spent_minutes: 0,
      qty: 2,
      cost_paid: true,
    });
  });

  it('delegate_once 全部通过且未超预算时返回 committed 与 canCommit=true', () => {
    const state = createBaseState();
    const catalog = createTestCatalog();
    const intent = makeIntent({
      mode: 'delegate_once',
      budget_cap_credits: 2000,
      actions: [
        { op: 'enqueue', base_ref: 'base_north', catalog_ref: '犀牛坦克', quantity: 2 },
        { op: 'promote', base_ref: 'base_north', task_ref: '犀牛坦克', quantity: 1 },
      ],
    });

    const res = runPlanningSandbox(state, intent, catalog);

    expect(res.canCommit).toBe(true);
    expect(res.receipt.status).toBe('committed');
    expect(res.receipt.total_cost_credits).toBe(1800);
    expect(res.receipt.actions.every(a => a.status === 'accepted')).toBe(true);
    expect(res.receipt.diff_summary.added).toEqual(['犀牛坦克×2']);
    expect(res.receipt.diff_summary.promoted).toEqual(['犀牛坦克']);
  });

  it('delegate_once 超出 budget_cap_credits 时强制降级为 awaiting_approval 且 canCommit=false', () => {
    const state = createBaseState();
    const catalog = createTestCatalog();
    const intent = makeIntent({
      mode: 'delegate_once',
      budget_cap_credits: 1500,
      actions: [{ op: 'enqueue', base_ref: 'base_north', catalog_ref: '犀牛坦克', quantity: 2 }],
    });

    const res = runPlanningSandbox(state, intent, catalog);

    expect(res.canCommit).toBe(false);
    expect(res.receipt.status).toBe('awaiting_approval');
    expect(res.receipt.total_cost_credits).toBe(1800);
    expect(res.receipt.summary).toContain('超出授权预算上限');
  });

  it('准确识别基地不存在、基地已废弃、差前置科技（nearUnlock）、完全未知条目与资金不足', () => {
    const state = createBaseState();
    const catalog = createTestCatalog();

    // 1) 基地不存在 + 2) 基地已废弃 + 3) 差 1 个前置科技（天启坦克差重装合成装甲）+ 4) 未知条目 + 5) 批次资金不足
    const intent = makeIntent({
      mode: 'delegate_once',
      actions: [
        { op: 'enqueue', base_ref: 'base_ghost', catalog_ref: '动员兵', quantity: 1 },
        { op: 'enqueue', base_ref: 'base_old', catalog_ref: '动员兵', quantity: 1 },
        { op: 'enqueue', base_ref: 'base_north', catalog_ref: '天启坦克', quantity: 1 },
        { op: 'enqueue', base_ref: 'base_north', catalog_ref: '超时空传送仪', quantity: 1 },
        { op: 'enqueue', base_ref: 'base_north', catalog_ref: '犀牛坦克', quantity: 5 },
      ],
    });

    const res = runPlanningSandbox(state, intent, catalog);

    expect(res.canCommit).toBe(false);
    expect(res.receipt.status).toBe('rejected');
    expect(res.receipt.actions[0].blocker_code).toBe('base_not_found');
    expect(res.receipt.actions[1].blocker_code).toBe('base_retired');
    expect(res.receipt.actions[2].blocker_code).toBe('missing_research');
    expect(res.receipt.actions[2].blocker_reason).toContain('重装合成装甲');
    expect(res.receipt.actions[3].blocker_code).toBe('missing_research');
    expect(res.receipt.actions[4].blocker_code).toBe('insufficient_credits');
  });

  it('指挥官保护锁：禁止对受保护任务执行 demote 或 hold，但允许 promote', () => {
    const state = createBaseState({
      planning: {
        latest_receipt: null,
        pending_plan: null,
        committed_fingerprints: [],
        protected_task_refs: ['动员兵'],
      },
    });
    const catalog = createTestCatalog();
    const intent = makeIntent({
      mode: 'delegate_once',
      protected_task_refs: ['犀牛坦克'],
      actions: [
        { op: 'demote', base_ref: 'base_north', task_ref: '动员兵', quantity: 1 },
        { op: 'hold', base_ref: 'base_north', task_ref: '犀牛坦克', quantity: 1 },
        { op: 'promote', base_ref: 'base_north', task_ref: '犀牛坦克', quantity: 1 },
      ],
    });

    const res = runPlanningSandbox(state, intent, catalog);

    expect(res.receipt.actions[0]).toMatchObject({
      op: 'demote',
      status: 'rejected',
      blocker_code: 'protected_task',
    });
    expect(res.receipt.actions[1]).toMatchObject({
      op: 'hold',
      status: 'rejected',
      blocker_code: 'protected_task',
    });
    expect(res.receipt.actions[2]).toMatchObject({
      op: 'promote',
      status: 'accepted',
    });
    // 2 项被拒 + 1 项通过 → awaiting_approval
    expect(res.receipt.status).toBe('awaiting_approval');
    expect(res.canCommit).toBe(false);
  });

  it('冲突检查、幂等指纹与快照过期门禁严格生效', () => {
    const state = createBaseState({
      planning: {
        latest_receipt: null,
        pending_plan: null,
        committed_fingerprints: ['fp-already-done'],
        protected_task_refs: [],
      },
    });
    const catalog = createTestCatalog();

    // 1. 同楼旧队列冲突
    const conflictRes = runPlanningSandbox(
      state,
      makeIntent({ conflict_with_legacy_queue: true }),
      catalog,
    );
    expect(conflictRes.receipt.status).toBe('rejected');
    expect(conflictRes.canCommit).toBe(false);
    expect(conflictRes.receipt.summary).toContain('同楼已通过旧队列或调度令申报相同项目');

    // 2. 幂等指纹命中
    const dupRes = runPlanningSandbox(
      state,
      makeIntent({ fingerprint: 'fp-already-done' }),
      catalog,
    );
    expect(dupRes.receipt.status).toBe('committed');
    expect(dupRes.alreadyCommitted).toBe(true);
    expect(dupRes.canCommit).toBe(false);

    // 3. 快照不一致
    const staleRes = runPlanningSandbox(
      state,
      makeIntent({ snapshot_ref: 'snap_floor_3' }),
      catalog,
      { currentSnapshotRef: 'snap_floor_4' },
    );
    expect(staleRes.receipt.status).toBe('stale_snapshot');
    expect(staleRes.canCommit).toBe(false);
  });

  it('FD-27 · 支持通用可信度引擎变体对齐与 kind="研究" 科研立项试排校验', () => {
    const state = createBaseState({
      economy: {
        credits: 5000,
        credits_daily: 500,
        wallet: {},
        chains: [],
        resources: {
          nanites: {},
          minerals: {},
          materials: {},
          fuel: {},
          munitions: {},
          logistics: {},
        },
      },
    });
    const catalog = createTestCatalog();
    catalog.researches.push({
      name: '小型模块化核能工学',
      cost: 1200,
      days: 3,
      line: '能源线',
      prereq: '——',
      prereqs: [],
      eta: '3日',
      tier: 1,
      unlocks: '磁能反应炉',
      desc: '模块化核能技术',
    });

    const intent = makeIntent({
      mode: 'delegate_once',
      budget_cap_credits: 4000,
      actions: [
        {
          op: 'enqueue',
          base_ref: 'base_north',
          catalog_ref: '模块化小型核能技术',
          kind: '研究' as unknown as '生产',
          quantity: 1,
        },
        {
          op: 'enqueue',
          base_ref: 'base_north',
          catalog_ref: '[苏联] 犀牛坦克',
          kind: '生产',
          quantity: 1,
        },
      ],
    });

    const res = runPlanningSandbox(state, intent, catalog);

    expect(res.canCommit).toBe(true);
    expect(res.receipt.status).toBe('committed');
    expect(res.receipt.total_cost_credits).toBe(2100);
    expect(res.receipt.diff_summary.added).toEqual(['小型模块化核能工学×1', '犀牛坦克×1']);
    expect(res.sandboxState.queues).toContainEqual(
      expect.objectContaining({
        type: '研究',
        item: '小型模块化核能工学',
        base: 'base_north',
        status: 'queued',
      }),
    );
  });

  it('BUG-LIVE-16 (#48楼) · kind=生产 的「犀牛坦克」同域对齐「犀牛主战坦克族」绝不误撞改装工程，且「磁暴步兵」精确校验多前置或入队', async () => {
    const { parseMessageText } = await import('../parse/parsePipeline');
    const { buildEntityCredibilityIndex } = await import('../core/entityCredibility');
    const { commitPlanningIntent } = await import('../planning/planningReceipt');

    const sovietCatalog: EffectiveCatalog = {
      buildings: [
        { name: '苏联建造厂', cost: 2000, power: -100, need_buildings: [], prereqs: [] },
        { name: '苏联兵营', cost: 500, power: 20, need_buildings: ['苏联建造厂'], prereqs: [] },
        { name: '苏联战车工厂', cost: 2000, power: 50, need_buildings: ['苏联建造厂'], prereqs: [] },
        { name: '苏联磁能反应炉', cost: 600, power: -150, need_buildings: ['苏联建造厂'], prereqs: [] },
        { name: '磁暴线圈', cost: 1500, power: 75, need_buildings: ['苏联建造厂'], prereqs: ['强电绝缘与脉冲工学'] },
      ],
      productions: [
        {
          id: '犀牛主战坦克族',
          name: '犀牛主战坦克族',
          cost: 900,
          need_building: '战车工厂',
          need_buildings: ['战车工厂'],
          prereqs: ['重型机械标准化学'],
          category: 'vehicle',
          build_time_min: 60,
          faction: 'soviet',
        } as unknown as EffectiveCatalog['productions'][number],
        {
          id: '磁暴步兵',
          name: '磁暴步兵',
          cost: 500,
          need_building: '兵营',
          need_buildings: ['兵营', '磁暴线圈'],
          prereqs: ['国家动员体系学', '强电绝缘与脉冲工学'],
          category: 'infantry',
          build_time_min: 45,
          faction: 'soviet',
        } as unknown as EffectiveCatalog['productions'][number],
      ],
      researches: [
        { name: '重型机械标准化学', cost: 600, line: '通用', prereq: '——', prereqs: [] },
        { name: '国家动员体系学', cost: 500, line: '苏联', prereq: '——', prereqs: [] },
        { name: '强电绝缘与脉冲工学', cost: 800, line: '苏联', prereq: '——', prereqs: [] },
      ],
      retrofits: [
        {
          id: '犀牛坦克现代化改装工程',
          name: '犀牛坦克现代化改装工程',
          research: '装甲平台深度现代化工学·苏联实现',
          target_unit: '犀牛主战坦克族',
          cost_per_unit: 350,
          time_minutes_per_unit: 30,
        } as unknown as EffectiveCatalog['retrofits'][number],
      ],
      projects: [],
      protocols: [],
      girls: [],
      factionDefs: [
        { faction: '盟军', mcv: '盟军建造厂', lab: '盟军作战实验室' },
        { faction: '苏联', mcv: '苏联建造厂', lab: '苏联作战实验室' },
      ],
    } as unknown as EffectiveCatalog;

    const credibilityIndex = buildEntityCredibilityIndex(sovietCatalog);
    const authority = {
      names: [
        '犀牛主战坦克族',
        '磁暴步兵',
        '犀牛坦克现代化改装工程',
        '重型机械标准化学',
        '国家动员体系学',
        '强电绝缘与脉冲工学',
      ],
      credibilityIndex,
    };

    const floor48Raw = `
<排产计划>
mode: delegate_once
actions:
  - op: enqueue
    kind: 生产
    catalog_ref: 犀牛坦克
    quantity: 2
    base_ref: 恶土前哨主基地
  - op: enqueue
    kind: 生产
    catalog_ref: 磁暴步兵
    quantity: 5
    base_ref: 恶土前哨主基地
</排产计划>
`;

    // 场景 A：#48楼实机建筑在场但磁暴步兵缺 3 项前置（国家动员体系学、强电绝缘与脉冲工学、磁暴线圈），犀牛主战坦克族前置已满足
    const statePartial = createBaseState({
      command: { unlocked_factions: ['allied', 'soviet'] } as unknown as StatData['command'],
      economy: { credits: 6000, credits_daily: 500 } as unknown as StatData['economy'],
      bases: [
        {
          id: 'base_badlands',
          name: '恶土前哨主基地',
          status: '运转中',
          buildings: [
            { name: '苏联建造厂', state: '运转' },
            { name: '苏联兵营', state: '运转' },
            { name: '苏联战车工厂', state: '运转' },
            { name: '苏联磁能反应炉', state: '运转' },
          ],
        } as unknown as StatData['bases'][number],
      ],
      queues: [],
      tech: { done: ['重型机械标准化学'] } as unknown as StatData['tech'],
    });

    const parsedPartial = parseMessageText(floor48Raw, statePartial, {
      authority,
      credibilityIndex,
      deferPlanningCommit: true,
    });
    expect(parsedPartial.planningDecls).toHaveLength(1);
    expect(parsedPartial.planningDecls[0].actions[0].catalog_ref).toBe('犀牛主战坦克族');
    expect(parsedPartial.planningDecls[0].actions[0].catalog_ref).not.toBe('犀牛坦克现代化改装工程');
    expect(parsedPartial.planningDecls[0].actions[1].catalog_ref).toBe('磁暴步兵');

    const committedPartial = commitPlanningIntent(
      parsedPartial.data,
      parsedPartial.planningDecls[0],
      sovietCatalog,
      { floor: 48 },
    );
    expect(committedPartial.receipt.actions[0]).toMatchObject({
      target: '犀牛主战坦克族',
      status: 'accepted',
    });
    expect(committedPartial.receipt.actions[1]).toMatchObject({
      target: '磁暴步兵',
      status: 'rejected',
      blocker_code: 'missing_research',
    });
    expect(committedPartial.receipt.actions[1].blocker_reason).toContain('国家动员体系学');
    expect(committedPartial.receipt.actions[1].blocker_reason).not.toContain('未在当前战区图鉴登记');

    // 场景 B：当磁暴步兵前置科技与磁暴线圈均齐备时，两项均直接核准入队
    const stateReady = createBaseState({
      ...statePartial,
      bases: [
        {
          ...statePartial.bases[0],
          buildings: [
            ...statePartial.bases[0].buildings,
            { name: '磁暴线圈', state: '运转' },
          ],
        } as unknown as StatData['bases'][number],
      ],
      tech: {
        done: ['重型机械标准化学', '国家动员体系学', '强电绝缘与脉冲工学'],
      } as unknown as StatData['tech'],
    });
    const committedReady = commitPlanningIntent(
      stateReady,
      parsedPartial.planningDecls[0],
      sovietCatalog,
      { floor: 48 },
    );
    expect(committedReady.committed).toBe(true);
    expect(committedReady.receipt.status).toBe('committed');
    expect(committedReady.receipt.diff_summary.added).toEqual(['犀牛主战坦克族×2', '磁暴步兵×5']);
  });

  it('BUG-LIVE-17a/17b/17c (#50楼) · 基地/建筑字典映射+数量展开、<生产>行尾括号元数据解析、新扩展档案「铁砧矿坑」不被「铁砧」吞并', async () => {
    const { parseMessageText } = await import('../parse/parsePipeline');
    const { buildEntityCredibilityIndex } = await import('../core/entityCredibility');
    const { commitPlanningIntent } = await import('../planning/planningReceipt');
    const { parseProductionDeclarations, reconcileProduction } = await import(
      '../engines/productionReconciliation'
    );

    const sovietCatalog: EffectiveCatalog = {
      buildings: [
        { name: '苏联建造厂', cost: 2000, power: -100, need_buildings: [], prereqs: [] },
        { name: '苏联兵营', cost: 500, power: 20, need_buildings: ['苏联建造厂'], prereqs: [] },
        { name: '苏联战车工厂', cost: 2000, power: 50, need_buildings: ['苏联建造厂'], prereqs: [] },
        { name: '磁暴线圈', cost: 1500, power: 75, need_buildings: ['苏联建造厂'], prereqs: [] },
      ],
      productions: [
        {
          id: '犀牛主战坦克族',
          name: '犀牛主战坦克族',
          cost: 900,
          need_building: '战车工厂',
          need_buildings: ['战车工厂'],
          prereqs: ['重型机械标准化学'],
          category: 'vehicle',
          build_time_min: 60,
          faction: 'soviet',
        } as unknown as EffectiveCatalog['productions'][number],
        {
          id: '磁暴步兵',
          name: '磁暴步兵',
          cost: 500,
          need_building: '兵营',
          need_buildings: ['兵营', '磁暴线圈'],
          prereqs: ['国家动员体系学', '强电绝缘与脉冲工学'],
          category: 'infantry',
          build_time_min: 45,
          faction: 'soviet',
        } as unknown as EffectiveCatalog['productions'][number],
      ],
      researches: [],
      retrofits: [],
      projects: [],
      protocols: [],
      girls: [],
      factionDefs: [{ faction: '苏联', mcv: '苏联建造厂', lab: '苏联作战实验室' }],
    } as unknown as EffectiveCatalog;

    const credibilityIndex = buildEntityCredibilityIndex(sovietCatalog);
    const authority = {
      names: ['铁砧', '犀牛主战坦克族', '磁暴步兵', '磁暴线圈'],
      credibilityIndex,
    };

    const floor50Raw = `
<态势>
基地:
  恶土前哨主基地:
    状态: 警戒
    建筑:
      磁暴线圈:
        数量: 2
        状态: 完好
        坐标: [3.8, -0.8]
        层级: 地面
</态势>
<生产>
轨道空间站·居住舱: 1项 (基地: 恶土前哨主基地, 类型: 工程)
</生产>
<扩展档案>
- 名称: 铁砧矿坑
  类别: 地点
  简介: 恶土北麓新探明的废弃露天矿坑。
</扩展档案>
<排产计划>
mode: delegate_once
actions:
  - op: enqueue
    kind: 生产
    catalog_ref: 犀牛坦克
    quantity: 2
    base_ref: 恶土前哨主基地
  - op: enqueue
    kind: 生产
    catalog_ref: 磁暴步兵
    quantity: 5
    base_ref: 恶土前哨主基地
</排产计划>
`;

    const baseline50 = createBaseState({
      command: { unlocked_factions: ['allied', 'soviet'] } as unknown as StatData['command'],
      economy: { credits: 6000, credits_daily: 500 } as unknown as StatData['economy'],
      bases: [
        {
          id: '恶土前哨主基地',
          name: '恶土前哨主基地',
          status: '运转中',
          buildings: [
            { name: '苏联建造厂', state: '运转' },
            { name: '苏联兵营', state: '运转' },
            { name: '苏联战车工厂', state: '运转' },
          ],
        } as unknown as StatData['bases'][number],
      ],
      queues: [
        {
          type: '工程',
          item: '轨道空间站·居住舱',
          base: '恶土前哨主基地',
          progress: 100,
          eta: '0m',
          status: 'settling',
          started_at: 'D1',
          total_minutes: 1440,
          spent_minutes: 1440,
          qty: 1,
          qty_done: 1,
          cost_paid: true,
          min_days_lock: 0,
          hold: false,
        } as unknown as StatData['queues'][number],
      ],
      tech: {
        done: ['重型机械标准化学', '国家动员体系学', '强电绝缘与脉冲工学'],
      } as unknown as StatData['tech'],
      pending_expansions: [
        {
          name: '铁砧',
          kind: '地点',
          desc: '旧铁砧据点',
          detail: '',
          params: {},
          keys: [],
        },
      ] as unknown as StatData['pending_expansions'],
    });

    // 1. 验证 BUG-LIVE-17a & 17c
    const parsed50 = parseMessageText(floor50Raw, baseline50, {
      authority,
      credibilityIndex,
      deferPlanningCommit: true,
    });
    expect(parsed50.quarantine).toEqual([]);
    const coilList = parsed50.data.bases[0].buildings.filter(b => b.name === '磁暴线圈');
    expect(coilList).toHaveLength(2);
    expect(coilList.every(b => b.state === '运转' && b.layer === '地面')).toBe(true);

    // 验证「铁砧矿坑」未被「铁砧」吞并
    const expNames = parsed50.data.pending_expansions.map(e => e.name);
    expect(expNames).toContain('铁砧');
    expect(expNames).toContain('铁砧矿坑');

    // 2. 验证 BUG-LIVE-17b：<生产> 行尾括号元数据解析与对账核销
    const prodParsed = parseProductionDeclarations(floor50Raw);
    expect(prodParsed.rejected).toEqual([]);
    expect(prodParsed.declarations).toEqual([
      {
        item: '轨道空间站·居住舱',
        qty: 1,
        base: '恶土前哨主基地',
        type: '工程',
        raw: '轨道空间站·居住舱: 1项 (基地: 恶土前哨主基地, 类型: 工程)',
      },
    ]);
    const reconciled = reconcileProduction(parsed50.data, prodParsed);
    expect(reconciled.next.queues[0].status).toBe('done');

    // 3. 验证磁暴线圈入账后，<排产计划> 的犀牛主战坦克族与磁暴步兵双双核准入队
    const committed50 = commitPlanningIntent(
      reconciled.next,
      parsed50.planningDecls[0],
      sovietCatalog,
      { floor: 50 },
    );
    expect(committed50.committed).toBe(true);
    expect(committed50.receipt.status).toBe('committed');
    expect(committed50.receipt.diff_summary.added).toEqual(['犀牛主战坦克族×2', '磁暴步兵×5']);
  });

  it('BUG-LIVE-52 (#52楼) · 已拥有建造厂与发电厂（含在建/队列中）、未研究额外精炼科技时，排产「矿石精炼厂×1」（及阵营前缀别名/图鉴未就绪兜底）在 latest_receipt 与 queues 中均正常通过，绝不误报 missing_research，且支持陈旧 rejected 回执自愈', async () => {
    const { parseMessageText } = await import('../parse/parsePipeline');
    const { buildEntityCredibilityIndex } = await import('../core/entityCredibility');
    const { commitPlanningIntent, reconcileStaleRejectedPlanningReceipt } = await import(
      '../planning/planningReceipt'
    );
    const { settleFloor } = await import('../engines/settleFloor');

    // 复刻 #50 -> #52 楼真机世界书图鉴（通用·主建筑：矿石精炼厂 research=null, prereqs=[], need_buildings=['发电厂']）
    const alliedCatalog: EffectiveCatalog = {
      buildings: [
        {
          id: 'bld.allied.conyard',
          name: '盟军建造厂',
          cost: 0,
          power: -50,
          tier: 1,
          faction: 'allied',
          research: null,
          prereqs: [],
          need_buildings: [],
          workload: { days: 1, min_days: 0.5 },
        },
        {
          id: 'bld.allied.power_plant',
          name: '盟军发电厂',
          cost: 800,
          power: -200,
          tier: 1,
          faction: 'allied',
          research: null,
          prereqs: [],
          need_buildings: [],
          workload: { days: 0.16, min_days: 0.08 },
        },
        {
          id: 'bld.common.ore_refinery',
          name: '矿石精炼厂',
          cost: 2000,
          power: 50,
          tier: 1,
          faction: 'common',
          research: null,
          prereqs: [],
          need_buildings: ['发电厂'],
          workload: { days: 0.4, min_days: 0.2 },
        },
      ],
      productions: [],
      researches: [
        {
          id: 'ind.research.t1.fossil_fuel_power',
          name: '化石燃料发电学',
          cost: 300,
          line: '能源线',
          prereq: '——',
          prereqs: [],
        },
      ],
      retrofits: [],
      projects: [],
      protocols: [],
      girls: [],
      factionDefs: [{ faction: '盟军', mcv: '盟军建造厂', lab: '盟军作战实验室' }],
    } as unknown as EffectiveCatalog;

    const credibilityIndex = buildEntityCredibilityIndex(alliedCatalog);
    const authority = {
      names: ['盟军建造厂', '盟军发电厂', '矿石精炼厂', '化石燃料发电学'],
      credibilityIndex,
    };

    const floor52Raw = `
<timePast>0 D 0 H 30 M</timePast>
<排产计划>
版本: 1
模式: 进行中
请求编号: req_1f4acab3
目标基地: 1号主基地
动作列表:
  - 动作: 入队
    类别: 建造
    项目: 矿石精炼厂
    基地: 1号主基地
    数量: 1
    层级: 地下层
    坐标: [-1, 0]
    方位: 大厅中段偏西通道旁100米
</排产计划>
`;

    // 场景 1：#50 楼真机基线（盟军建造厂运转，盟军发电厂在建中，仅完成化石燃料发电学，未研究任何精炼科技）
    const baseline50 = createBaseState({
      command: { unlocked_factions: ['allied', 'soviet', 'yuri'] } as unknown as StatData['command'],
      economy: { credits: 6485, credits_daily: 0 } as unknown as StatData['economy'],
      bases: [
        {
          id: '1号主基地',
          name: '1号主基地',
          status: '隐蔽中',
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军发电厂', state: '建造中' },
          ],
        } as unknown as StatData['bases'][number],
      ],
      queues: [
        {
          type: '建造',
          item: '盟军发电厂',
          base: '1号主基地',
          progress: 26,
          eta: '余3时',
          status: 'active',
          started_at: 'D1',
          total_minutes: 230.4,
          spent_minutes: 60,
          qty: 1,
          qty_done: 0,
          cost_paid: true,
          min_days_lock: 0,
          hold: false,
        } as unknown as StatData['queues'][number],
      ],
      tech: { done: ['化石燃料发电学'] } as unknown as StatData['tech'],
    });

    // 无论 deferPlanningCommit=true 还是 false（模拟先经过 parse + settleFloor 回填 total_minutes=576 再走 commitPlanningIntent），均不报错、不重复入队
    const parsed52 = parseMessageText(floor52Raw, baseline50, {
      authority,
      credibilityIndex,
      deferPlanningCommit: false,
    });
    const settled52 = settleFloor(baseline50, parsed52.data, floor52Raw, {
      catalog: alliedCatalog,
    });
    const committed52 = commitPlanningIntent(
      settled52.data,
      parsed52.planningDecls[0],
      alliedCatalog,
      { floor: 52 },
    );

    expect(committed52.committed).toBe(true);
    expect(committed52.receipt.status).toBe('committed');
    expect(committed52.receipt.actions[0]).toMatchObject({
      op: 'enqueue',
      target: '矿石精炼厂',
      base: '1号主基地',
      quantity: 1,
      cost_credits: 2000,
      status: 'accepted',
    });
    expect(committed52.receipt.actions[0].blocker_code).toBeUndefined();
    const refineryInQueue = committed52.next.queues.filter(q => q.item === '矿石精炼厂');
    expect(refineryInQueue).toHaveLength(1);
    expect(refineryInQueue[0].total_minutes).toBe(576);
    expect(committed52.next.economy.credits).toBe(4485);

    // 场景 2：当传入阵营前缀别名「盟军矿石精炼厂」或 catalog.buildings 尚未加载通用主建筑时，内置基石兜底仍正常放行
    const fallbackCommitted = commitPlanningIntent(
      baseline50,
      {
        ...parsed52.planningDecls[0],
        fingerprint: 'plan_fallback_test',
        actions: [
          {
            ...parsed52.planningDecls[0].actions[0],
            catalog_ref: '盟军矿石精炼厂',
          },
        ],
      },
      { ...alliedCatalog, buildings: [] } as unknown as EffectiveCatalog,
      { floor: 52 },
    );
    expect(fallbackCommitted.committed).toBe(true);
    expect(fallbackCommitted.receipt.status).toBe('committed');
    expect(fallbackCommitted.receipt.actions[0].status).toBe('accepted');
    expect(fallbackCommitted.receipt.actions[0].blocker_code).toBeUndefined();

    // 场景 3：验证历史双轨分裂残留的 rejected 回执在队列已入列时可被 reconcileStaleRejectedPlanningReceipt 自愈
    const staleRejectedState = createBaseState({
      ...settled52.data,
      planning: {
        latest_receipt: {
          request_ref: 'req_1f4acab3',
          fingerprint: 'plan_1f4acab3',
          mode: 'delegate_once',
          base_ref: '1号主基地',
          status: 'rejected',
          total_cost_credits: 0,
          summary: '排产方案被驳回：目标条目未解锁或未在当前战区图鉴登记',
          actions: [
            {
              op: 'enqueue',
              target: '矿石精炼厂',
              base: '1号主基地',
              quantity: 1,
              cost_credits: 0,
              est_minutes: 0,
              status: 'rejected',
              blocker_code: 'missing_research',
              blocker_reason: '目标条目未解锁或未在当前战区图鉴登记',
              next_step: '请先核查前置科技与产线建筑',
            },
          ],
          diff_summary: { added: [], promoted: [], demoted: [], held: [], resumed: [] },
          created_at_floor: 52,
        },
        pending_plan: null,
        committed_fingerprints: [],
        protected_task_refs: [],
      },
    });
    const healed = reconcileStaleRejectedPlanningReceipt(staleRejectedState);
    expect(healed).toBe(true);
    expect(staleRejectedState.planning.latest_receipt?.status).toBe('committed');
    expect(staleRejectedState.planning.latest_receipt?.actions[0]).toMatchObject({
      target: '矿石精炼厂',
      status: 'accepted',
      cost_credits: 2000,
      est_minutes: 576,
    });
  });

  it('BUG-CROSS-AUDIT-01 · 三大阵营（盟军/苏联/尤里）全量真实世界书基础建筑、防御塔与核心单位无死锁/无断链批量回归校验', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { parseWorldbookEntries } = await import('../../中控悬浮窗/models/worldbookCatalogParser');
    const { FACTION_DEFS } = await import('../core/catalog');
    const { commitPlanningIntent } = await import('../planning/planningReceipt');

    const wbDir = path.resolve(process.cwd(), '../worldbooks');
    const wbFiles = fs.readdirSync(wbDir).filter(f => f.endsWith('_世界书.json'));
    const allEntries: Array<{ key?: string[]; comment?: string; content?: string }> = [];
    for (const file of wbFiles) {
      const rawJson = JSON.parse(fs.readFileSync(path.join(wbDir, file), 'utf8'));
      const entriesObj = rawJson.entries ?? {};
      for (const entry of Object.values(entriesObj) as Array<{ key?: string[]; comment?: string; content?: string }>) {
        if (entry?.content && entry.content.includes('<数据>')) {
          allEntries.push(entry);
        }
      }
    }

    const parsedWb = parseWorldbookEntries(allEntries, { silent: true });
    const fullCatalog: EffectiveCatalog = {
      buildings: parsedWb.buildings as unknown as EffectiveCatalog['buildings'],
      productions: parsedWb.productions as unknown as EffectiveCatalog['productions'],
      researches: parsedWb.researches as unknown as EffectiveCatalog['researches'],
      retrofits: parsedWb.retrofits as unknown as EffectiveCatalog['retrofits'],
      projects: parsedWb.projects as unknown as EffectiveCatalog['projects'],
      protocols: parsedWb.protocols as unknown as EffectiveCatalog['protocols'],
      girls: [],
      factionDefs: FACTION_DEFS,
    };

    expect(fullCatalog.buildings.length).toBeGreaterThanOrEqual(230);
    expect(fullCatalog.productions.length).toBeGreaterThanOrEqual(300);
    expect(fullCatalog.researches.length).toBeGreaterThanOrEqual(315);

    // 1. 验证尤里 T1 基础建筑链（尤里建造厂核心 -> 高能厌氧生化反应炉 -> 奴隶矿场 / 尤里克隆与新兵训导营 -> 盖特机炮塔 / 心灵感应器 / 尤里复合生化护墙）零科技前置死锁
    // 特别验证：当 state.command.unlocked_factions 仍为 Schema 默认值 ['allied'] 时，只要基地内有尤里建造厂核心，自动推导解锁 yuri 阵营！
    const yuriT1State = createBaseState({
      command: { unlocked_factions: ['allied'] } as unknown as StatData['command'],
      economy: { credits: 20000, credits_daily: 1000 } as unknown as StatData['economy'],
      bases: [
        {
          id: 'base_yuri_main',
          name: '尤里一号主基地',
          status: '隐蔽中',
          buildings: [
            { name: '尤里建造厂核心', state: '运转' },
            { name: '高能厌氧生化反应炉', state: '运转' },
            { name: '尤里克隆与新兵训导营', state: '运转' },
          ],
        } as unknown as StatData['bases'][number],
      ],
      queues: [],
      tech: { done: [] } as unknown as StatData['tech'],
    });

    const yuriFoundationBatch = [
      { ref: '高能厌氧生化反应炉', kind: '建造' as const },
      { ref: '尤里克隆与新兵训导营', kind: '建造' as const },
      { ref: '奴隶矿场', kind: '建造' as const },
      { ref: '尤里复合生化护墙', kind: '建造' as const },
      { ref: '心灵感应器', kind: '建造' as const },
      { ref: '盖特机炮塔', kind: '建造' as const },
    ];

    const yuriRes = commitPlanningIntent(
      yuriT1State,
      makeIntent({
        mode: 'delegate_once',
        fingerprint: 'plan_yuri_fnd_batch',
        budget_cap_credits: 50000,
        actions: yuriFoundationBatch.map(item => ({
          op: 'enqueue' as const,
          base_ref: '尤里一号主基地',
          catalog_ref: item.ref,
          kind: item.kind,
          quantity: 1,
        })),
      }),
      fullCatalog,
      { floor: 60 },
    );
    expect(yuriRes.committed, `尤里基础建筑批量排产不应被驳回: ${JSON.stringify(yuriRes.receipt.actions)}`).toBe(true);
    for (const act of yuriRes.receipt.actions) {
      expect(act.status, `尤里基础建筑「${act.target}」应通过`).toBe('accepted');
      expect(act.blocker_code).toBeUndefined();
    }

    // 2. 验证三大阵营全套主干产线建筑与经典别名/核心单位排产（含简称映射与 + 号复合建筑前置）
    const triFactionFullBaseState = createBaseState({
      command: { unlocked_factions: ['allied'] } as unknown as StatData['command'],
      economy: { credits: 999999, credits_daily: 5000 } as unknown as StatData['economy'],
      bases: [
        {
          id: 'base_tri',
          name: '联合试验主基地',
          status: '警戒',
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '苏联建造厂', state: '运转' },
            { name: '尤里建造厂核心', state: '运转' },
            { name: '盟军发电厂', state: '运转' },
            { name: '苏联磁能反应炉', state: '运转' },
            { name: '高能厌氧生化反应炉', state: '运转' },
            { name: '矿石精炼厂', state: '运转' },
            { name: '奴隶矿场', state: '运转' },
            { name: '盟军兵营', state: '运转' },
            { name: '苏联兵营', state: '运转' },
            { name: '尤里克隆与新兵训导营', state: '运转' },
            { name: '个人装备制造所', state: '运转' },
            { name: '盟军战车工厂', state: '运转' },
            { name: '苏联战车工厂', state: '运转' },
            { name: '尤里生物机电战车总装厂', state: '运转' },
            { name: '盟军空军指挥部', state: '运转' },
            { name: '苏联空军指挥部', state: '运转' },
            { name: '神经航空引导盘', state: '运转' },
            { name: '盟军海军造船厂', state: '运转' },
            { name: '苏联海军造船厂', state: '运转' },
            { name: '尤里半潜与仿生造船厂', state: '运转' },
            { name: '雷达站', state: '运转' },
            { name: '心灵感应器', state: '运转' },
            { name: '哨戒探针阵列', state: '运转' },
            { name: '通讯中继桩', state: '运转' },
            { name: '野战物资库', state: '运转' },
            { name: '盟军战斗实验室', state: '运转' },
            { name: '红星实验设计局综合体', state: '运转' },
            { name: '基因测序与心灵谐振研究院', state: '运转' },
            { name: '盟军联合科研与国家工程组织节点', state: '运转' },
            { name: '国家战略工程综合体', state: '运转' },
            { name: '双螺旋生命工程与高维意识科学院', state: '运转' },
            { name: '磁暴线圈', state: '运转' },
            { name: '心灵控制塔', state: '运转' },
            { name: '生物克隆与素体培育中心', state: '运转' },
            { name: '高净空飞艇总装厂房', state: '运转' },
            { name: '飞碟整备充能巢', state: '运转' },
            { name: '母脑特装总装跨', state: '运转' },
          ],
        } as unknown as StatData['bases'][number],
      ],
      queues: [],
      protocols: fullCatalog.protocols.map(p => ({
        id: p.id,
        name: p.name,
        status: 'active',
      })) as unknown as StatData['protocols'],
      tech: {
        done: fullCatalog.researches.map(r => r.name),
      } as unknown as StatData['tech'],
    });

    const crossCheckTargets: Array<{ ref: string; kind: '建造' | '生产' }> = [
      // 盟军建筑与单位（含简称）
      { ref: '盟军矿石精炼厂', kind: '建造' },
      { ref: '盟军围墙', kind: '建造' },
      { ref: '盟军碉堡', kind: '建造' },
      { ref: '爱国者防空阵地', kind: '建造' },
      { ref: '光棱塔', kind: '建造' },
      { ref: '灰熊坦克', kind: '生产' },
      { ref: '多功能步兵车', kind: '生产' },
      { ref: '超时空采矿车', kind: '生产' },
      { ref: '光棱坦克', kind: '生产' },
      { ref: '幻影坦克', kind: '生产' },
      { ref: '战隼战斗机', kind: '生产' },
      { ref: '黑鹰战机', kind: '生产' },
      { ref: '阿帕奇武装直升机', kind: '生产' },
      // 苏联建筑与单位（含简称）
      { ref: '苏联矿石精炼厂', kind: '建造' },
      { ref: '苏联磁能反应炉', kind: '建造' },
      { ref: '苏联战斗碉堡', kind: '建造' },
      { ref: '苏联哨戒炮', kind: '建造' },
      { ref: '苏联高射炮', kind: '建造' },
      { ref: '磁暴线圈', kind: '建造' },
      { ref: '犀牛坦克', kind: '生产' },
      { ref: '武装采矿车', kind: '生产' },
      { ref: '防空履带车', kind: '生产' },
      { ref: '恐怖机器人', kind: '生产' },
      { ref: '基洛夫空艇', kind: '生产' },
      // 尤里建筑与单位（含简称）
      { ref: '尤里生物机电战车总装厂', kind: '建造' },
      { ref: '尤里半潜与仿生造船厂', kind: '建造' },
      { ref: '神经航空引导盘', kind: '建造' },
      { ref: '并网式神经-液冷重装碉堡', kind: '建造' },
      { ref: '心灵控制塔', kind: '建造' },
      { ref: '尤里新兵', kind: '生产' },
      { ref: '尤里防空兵', kind: '生产' },
      { ref: '尤里工兵', kind: '生产' },
      { ref: '病毒狙击手', kind: '生产' },
      { ref: '尤里采矿车', kind: '生产' },
      { ref: '狂风坦克', kind: '生产' },
      { ref: '盖特坦克', kind: '生产' },
      { ref: '磁电坦克', kind: '生产' },
      { ref: '脑车', kind: '生产' },
      { ref: '飞碟', kind: '生产' },
      // 通用复合前置防御辅助建筑（原 need_building 含 + 拼接串）
      { ref: '纳米雷区部署器', kind: '建造' },
      { ref: '综合感知塔', kind: '建造' },
      { ref: '情报分析中心', kind: '建造' },
      { ref: '电子战干扰站', kind: '建造' },
      { ref: '前线综合后勤站', kind: '建造' },
    ];

    const batchRes = commitPlanningIntent(
      triFactionFullBaseState,
      makeIntent({
        mode: 'delegate_once',
        fingerprint: 'plan_cross_all_factions_batch',
        budget_cap_credits: 999999,
        actions: crossCheckTargets.map(target => ({
          op: 'enqueue' as const,
          base_ref: '联合试验主基地',
          catalog_ref: target.ref,
          kind: target.kind,
          quantity: 1,
        })),
      }),
      fullCatalog,
      { floor: 62 },
    );
    const failedActions = batchRes.receipt.actions.filter(a => a.status !== 'accepted');
    expect(
      failedActions,
      `存在排产被驳回条目: ${JSON.stringify(failedActions)}`,
    ).toEqual([]);
    expect(batchRes.committed).toBe(true);
  }, 30000);
});

