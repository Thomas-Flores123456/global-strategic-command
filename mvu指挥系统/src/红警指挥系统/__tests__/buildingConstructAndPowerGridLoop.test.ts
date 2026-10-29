import { describe, expect, it } from 'vitest';
import type { EffectiveCatalog } from '../core/catalogEffective';
import { Schema, type StatData } from '../core/schema';
import {
  parseProductionDeclarations,
  reconcileProduction,
} from '../engines/productionReconciliation';
import { settleFloor } from '../engines/settleFloor';
import { computePlanFingerprint, extractPlanningIntent } from '../planning/planningParser';
import { runPlanningSandbox } from '../planning/planningSandbox';

function createTestCatalog(): EffectiveCatalog {
  return {
    buildings: [
      {
        name: '盟军发电厂',
        cost: 800,
        days: 1,
        power: { gen: 200, use: 0 } as unknown as number,
        category: '电力',
        need_buildings: ['盟军建造厂'],
        prereqs: [],
        research: null,
        desc: '盟军基础涡轮发电设施，单座提供 200W 电力。',
      },
      {
        name: '盟军兵营',
        cost: 500,
        days: 1,
        power: { gen: 0, use: 20 } as unknown as number,
        category: '生产',
        need_buildings: ['盟军建造厂'],
        prereqs: [],
        research: null,
        desc: '盟军步兵训练营地。',
      },
    ],
    productions: [],
    researches: [],
    retrofits: [],
    projects: [],
    protocols: [],
    factionDefs: [
      {
        faction: '盟军',
        mcv: '盟军建造厂',
        lab: '盟军战斗实验室',
      },
    ],
  } as unknown as EffectiveCatalog;
}

function createInitialBaseState(): StatData {
  return Schema.parse({
    meta: {
      world_id: 'ra2_test',
      date: '2042-05-01',
      day_count: 1,
      location: '恶土·东侧裂隙',
    },
    economy: {
      credits: 5000,
      credits_daily: 500,
    },
    command: {
      unlocked_factions: ['盟军'],
    },
    bases: [
      {
        id: 'base_1',
        name: '1号主基地',
        status: '警戒',
        power: { gen: 50, use: 0 },
        buildings: [{ name: '盟军建造厂', layer: '地下层', state: '运转' }],
      },
    ],
    queues: [],
    tech: {
      done: [],
    },
  });
}

function createCompletedBuildState(qty = 1): StatData {
  const state = createInitialBaseState();
  return Schema.parse({
    ...state,
    bases: [{ ...state.bases[0], buildings: Array.from({ length: qty + 1 }, () => ({
      name: '盟军发电厂', state: '建造中',
    })) }],
    queues: [{ type: '建造', item: '盟军发电厂', base: 'base_1', status: 'settling',
      qty, qty_done: qty, total_minutes: 1440 * qty, spent_minutes: 1440 * qty, progress: 100 }],
  });
}

describe('G01-02 · 建筑交付凭证', () => {
  it('同楼自动转正后收讫不重复交付，Schema归一后跨楼也不重复；第二任务仍可交付', () => {
    const initial = createCompletedBuildState();
    const auto = settleFloor(initial, initial, '').data;
    expect(auto.bases[0].buildings.map(b => b.state)).toEqual(['运转', '建造中']);
    expect(auto.queues[0].building_delivered_qty).toBe(1);
    const saved = Schema.parse(auto);
    const repeated = settleFloor(saved, saved, '').data;
    expect(repeated.bases[0].buildings.map(b => b.state)).toEqual(['运转', '建造中']);
    const claimed = reconcileProduction(repeated, parseProductionDeclarations('<生产>\n- 盟军发电厂: 1座\n</生产>')).next;
    expect(claimed.queues[0].status).toBe('done');
    expect(claimed.bases[0].buildings.map(b => b.state)).toEqual(['运转', '建造中']);
    const archived = settleFloor(claimed, Schema.parse(claimed), '').data;
    const second = Schema.parse({ ...archived, queues: initial.queues });
    const next = settleFloor(archived, second, '').data;
    expect(next.bases[0].buildings.map(b => b.state)).toEqual(['运转', '运转']);
    expect(next.queues[0].building_delivered_qty).toBe(1);
  });

  it.each([1, 2])('空base在%i个基地时只允许唯一基地默认匹配', baseCount => {
    const initial = createCompletedBuildState();
    initial.queues[0].base = '';
    initial.bases = Array.from({ length: baseCount }, (_, i) => ({
      ...initial.bases[0], id: `base_${i + 1}`, name: `${i + 1}号基地`,
    }));
    const auto = settleFloor(initial, initial, '').data;
    expect(auto.bases.map(b => b.buildings.filter(v => v.state === '运转').length))
      .toEqual(baseCount === 1 ? [1] : [0, 0]);
    const saved = Schema.parse(auto);
    const claimed = reconcileProduction(saved, parseProductionDeclarations('<生产>\n- 盟军发电厂: 1座\n</生产>')).next;
    expect(claimed.bases.map(b => b.buildings.filter(v => v.state === '运转').length))
      .toEqual(baseCount === 1 ? [1] : [0, 0]);
  });

  it('整批已投运后少报收讫，余量保留自己的交付计数，跨楼再完成不认领下一座', () => {
    const initial = createCompletedBuildState(3);
    const auto = settleFloor(initial, initial, '').data;
    const partial = reconcileProduction(auto, parseProductionDeclarations('<生产>\n- 盟军发电厂: 1座\n</生产>')).next;
    expect(partial.queues[0]).toMatchObject({ qty: 2, building_delivered_qty: 2 });
    const saved = Schema.parse(partial);
    const completed = settleFloor(saved, saved, '<timePast>1 D 0 H 0 M</timePast>').data;
    const final = reconcileProduction(completed, parseProductionDeclarations('<生产>\n- 盟军发电厂: 2座\n</生产>')).next;
    expect(final.queues[0].status).toBe('done');
    expect(final.bases[0].buildings.map(b => b.state)).toEqual(['运转', '运转', '运转', '建造中']);
  });
});

describe('FD-38 PKG-B · <排产计划> 建造空间锚点、在建自动挂载、完工自动转正与电网重算闭环', () => {
  it('① planningParser 提取 坐标 / 方位 / 层级，且 computePlanFingerprint 保持幂等签名不变', () => {
    const yamlText = [
      '模式: 委托',
      '动作:',
      '  - 操作: 建造',
      '    基地: 1号主基地',
      '    项目: 盟军发电厂',
      '    数量: 1',
      '    坐标: [2, 1]',
      '    方位: 东侧排风井旁',
      '    层级: 地下层',
    ].join('\n');

    const res = extractPlanningIntent(yamlText);
    expect(res.quarantine).toEqual([]);
    expect(res.intent).not.toBeNull();
    expect(res.intent!.actions[0]).toMatchObject({
      op: 'enqueue',
      base_ref: '1号主基地',
      catalog_ref: '盟军发电厂',
      kind: '建造',
      quantity: 1,
      coord: { x: 2, y: 1 },
      bearing: '东侧排风井旁',
      layer: '地下层',
    });

    // 仅给带括号坐标的方位文本时自动推导 coord
    const bearingOnly = extractPlanningIntent(
      [
        '模式: 委托',
        '动作:',
        '  - 操作: 建造',
        '    基地: 1号主基地',
        '    项目: 盟军发电厂',
        '    方位: 东侧排风井旁 (2, 1)',
      ].join('\n'),
    );
    expect(bearingOnly.intent?.actions[0].coord).toEqual({ x: 2, y: 1 });
    expect(bearingOnly.intent?.actions[0].bearing).toBe('东侧排风井旁 (2, 1)');

    // 幂等指纹不受空间锚点微调影响
    const fpWithCoord = res.intent!.fingerprint;
    const fpWithoutCoord = computePlanFingerprint({
      mode: 'delegate_once',
      actions: [
        {
          op: 'enqueue',
          base_ref: '1号主基地',
          catalog_ref: '盟军发电厂',
          kind: '建造',
          quantity: 1,
        },
      ],
    });
    expect(fpWithCoord).toBe(fpWithoutCoord);
  });

  it('② 立项盟军发电厂 → 自动挂载 state="建造中" 条目 → 工期结算/收讫完工自动转正且 base.power.gen 累加 +200W', () => {
    const catalog = createTestCatalog();
    const state0 = createInitialBaseState();

    // 1. 解析并执行沙盒立项（带 坐标: [2, 1]、层级: 地下层）
    const parsed = extractPlanningIntent(
      [
        '模式: 委托',
        '动作:',
        '  - 操作: 建造',
        '    基地: 1号主基地',
        '    项目: 盟军发电厂',
        '    数量: 1',
        '    坐标: [2, 1]',
        '    方位: 东侧排风井旁',
        '    层级: 地下层',
      ].join('\n'),
    );
    expect(parsed.intent).not.toBeNull();

    const sandboxRes = runPlanningSandbox(state0, parsed.intent!, catalog);
    expect(sandboxRes.canCommit).toBe(true);

    // 原 state0 零污染，sandboxState.bases[0].buildings 自动出现 state: '建造中' 条目
    expect(state0.bases[0].buildings).toHaveLength(1);
    const stateAfterCommit = sandboxRes.sandboxState;
    expect(stateAfterCommit.bases[0].buildings).toHaveLength(2);
    expect(stateAfterCommit.bases[0].buildings[1]).toMatchObject({
      name: '盟军发电厂',
      layer: '地下层',
      state: '建造中',
      coord: { x: 2, y: 1 },
      bearing: '东侧排风井旁',
    });

    // 2. 立项楼结算升格为 active，随后下一楼推进 2 天（2880 分钟，足以完成 1 天工期的发电厂）
    const floor1Settled = settleFloor(state0, stateAfterCommit, '<timePast>0 D 0 H 0 M</timePast>', {
      catalog,
    });
    expect(floor1Settled.data.queues[0].status).toBe('active');

    const settled1 = settleFloor(
      floor1Settled.data,
      structuredClone(floor1Settled.data),
      '<timePast>2 D 0 H 0 M</timePast>',
      { catalog },
    );

    // 队列满进度由系统自动交割为 done（BUG-R2-20），且基地中在建的盟军发电厂自动转正为 '运转'，电网从 50W 升至 250W（+200W）
    expect(settled1.data.queues[0].status).toBe('done');
    expect(settled1.data.queues[0].progress).toBe(100);
    const powerPlantInBase = settled1.data.bases[0].buildings.find(b => b.name === '盟军发电厂');
    expect(powerPlantInBase).toMatchObject({
      name: '盟军发电厂',
      layer: '地下层',
      state: '运转',
      coord: { x: 2, y: 1 },
      bearing: '东侧排风井旁',
    });
    expect(settled1.data.bases[0].power).toEqual({ gen: 250, use: 0 });

    // 3. 再经 reconcileProduction 收讫确认 → 队列转为 done，幂等不报错
    const rec1 = reconcileProduction(
      settled1.data,
      parseProductionDeclarations('<生产>\n- 盟军发电厂: 1座\n</生产>'),
    );
    expect(rec1.verdicts[0].verdict).toBe('MATCH');
    expect(rec1.next.queues[0].status).toBe('done');
    expect(rec1.events[0].level).toBe('info');
  });

  it('③ 建造第 2 座同名建筑（盟军发电厂）时精准转正第 2 座在建实例，不报“不唯一”，电网累加至 450W', () => {
    const catalog = createTestCatalog();
    // 基地已有一座运转中的盟军发电厂，现立项建造第 2 座盟军发电厂
    const stateWithFirstPlant = Schema.parse({
      ...createInitialBaseState(),
      bases: [
        {
          id: 'base_1',
          name: '1号主基地',
          status: '警戒',
          power: { gen: 250, use: 0 },
          buildings: [
            { name: '盟军建造厂', layer: '地下层', state: '运转' },
            { name: '盟军发电厂', layer: '地下层', state: '运转', coord: { x: 2, y: 1 } },
          ],
        },
      ],
    });

    const parsed2 = extractPlanningIntent(
      [
        '模式: 委托',
        '动作:',
        '  - 操作: 建造',
        '    基地: 1号主基地',
        '    项目: 盟军发电厂',
        '    数量: 1',
        '    坐标: [-2, 1]',
        '    层级: 地下层',
      ].join('\n'),
    );
    const sandbox2 = runPlanningSandbox(stateWithFirstPlant, parsed2.intent!, catalog);
    expect(sandbox2.canCommit).toBe(true);
    expect(sandbox2.sandboxState.bases[0].buildings).toHaveLength(3);
    expect(sandbox2.sandboxState.bases[0].buildings[2]).toMatchObject({
      name: '盟军发电厂',
      layer: '地下层',
      state: '建造中',
      coord: { x: -2, y: 1 },
    });

    // 测试直接通过 reconcileProduction 对 settling 的第 2 座发电厂做完工落账
    const stateReadyForReconcile = structuredClone(sandbox2.sandboxState);
    stateReadyForReconcile.queues[0].status = 'settling';
    stateReadyForReconcile.queues[0].progress = 100;
    stateReadyForReconcile.queues[0].spent_minutes = 1440;

    const rec2 = reconcileProduction(
      stateReadyForReconcile,
      parseProductionDeclarations('<生产>\n- 盟军发电厂: 1座\n</生产>'),
    );
    expect(rec2.verdicts[0].verdict).toBe('MATCH');
    expect(rec2.events[0].level).toBe('info');
    expect(rec2.events[0].detail).toContain('目标基地建筑运转');
    expect(rec2.events[0].detail).not.toContain('不唯一');
    expect(
      rec2.next.bases[0].buildings.filter(b => b.name === '盟军发电厂' && b.state === '运转'),
    ).toHaveLength(2);
    expect(rec2.next.bases[0].buildings[2]).toMatchObject({
      name: '盟军发电厂',
      layer: '地下层',
      state: '运转',
      coord: { x: -2, y: 1 },
    });

    // 经 settleFloor 重算基地电网 → 50W (建造厂) + 200W * 2 (两座发电厂) = 450W
    const settledPower = settleFloor(stateWithFirstPlant, rec2.next, '无时间标签', { catalog });
    expect(settledPower.data.bases[0].power).toEqual({ gen: 450, use: 0 });
  });

  it('④ 无预插在建条目（matches.length === 0）时收讫完工自动补建运转建筑，不报“目标基地建筑不存在”', () => {
    const stateNoUnderConst = Schema.parse({
      ...createInitialBaseState(),
      queues: [
        {
          type: '建造',
          item: '盟军发电厂',
          base: 'base_1',
          progress: 100,
          eta: '',
          status: 'settling',
          started_at: 'D1 08:00',
          total_minutes: 1440,
          spent_minutes: 1440,
          qty: 1,
          qty_done: 1,
          cost_paid: true,
          min_days_lock: 0,
          hold: false,
        },
      ],
    });

    const rec = reconcileProduction(
      stateNoUnderConst,
      parseProductionDeclarations('<生产>\n- 盟军发电厂: 1座\n</生产>'),
    );
    expect(rec.verdicts[0].verdict).toBe('MATCH');
    expect(rec.events[0].level).toBe('info');
    expect(rec.events[0].detail).toContain('目标基地建筑运转');
    expect(rec.next.bases[0].buildings).toHaveLength(2);
    expect(rec.next.bases[0].buildings[1]).toMatchObject({
      name: '盟军发电厂',
      layer: '',
      state: '运转',
    });
  });

  it('⑤ 同楼层 parsePipeline 预插队列经 settleFloor 回填 total_minutes 后，runPlanningSandbox 不重复入列第 2 条建造队列', () => {
    const catalog = createTestCatalog();
    const statePreQueuedAndSettled = Schema.parse({
      ...createInitialBaseState(),
      bases: [
        {
          id: 'base_1',
          name: '1号主基地',
          status: '警戒',
          power: { gen: 50, use: 0 },
          buildings: [
            { name: '盟军建造厂', layer: '地下层', state: '运转' },
            { name: '盟军发电厂', layer: '地下层', state: '建造中', coord: { x: 1, y: 0 } },
          ],
        },
      ],
      queues: [
        {
          type: '建造',
          item: '盟军发电厂',
          base: '1号主基地',
          progress: 0,
          eta: '',
          status: 'active',
          started_at: '2042-06-15 15:45',
          total_minutes: 230.4,
          spent_minutes: 0,
          qty: 1,
          qty_done: 0,
          cost_paid: true,
          min_days_lock: 0,
          hold: false,
        },
      ],
    });

    const parsed = extractPlanningIntent(
      [
        '模式: 委托',
        '动作:',
        '  - 操作: 建造',
        '    基地: 1号主基地',
        '    项目: 盟军发电厂',
        '    数量: 1',
        '    坐标: [1, 0]',
        '    层级: 地下层',
      ].join('\n'),
    );
    const res = runPlanningSandbox(statePreQueuedAndSettled, parsed.intent!, catalog);
    expect(res.canCommit).toBe(true);
    // 严格只保留 1 条盟军发电厂队列项，且保留 settleFloor 精算的 total_minutes: 230.4
    const ppQueues = res.sandboxState.queues.filter(q => q.item === '盟军发电厂');
    expect(ppQueues).toHaveLength(1);
    expect(ppQueues[0].total_minutes).toBe(230.4);
  });

  it('⑥ BUG-R2-01：发电厂受损/停机、耗电建筑停机、全基地停机或 MCV 收起时 base.power 诚实下降与归零，不锁死历史峰值', () => {
    const catalog = createTestCatalog();
    // 初始：1座建造厂(50W) + 2座发电厂(200W*2) = 450W 发电，2座兵营(20W*2) = 40W 耗电
    const peakState = Schema.parse({
      ...createInitialBaseState(),
      bases: [
        {
          id: 'base_1',
          name: '1号主基地',
          status: '警戒',
          power: { gen: 450, use: 40 },
          buildings: [
            { name: '盟军建造厂', layer: '地下层', state: '运转' },
            { name: '盟军发电厂', layer: '地下层', state: '受损' },
            { name: '盟军发电厂', layer: '地下层', state: '停机' },
            { name: '盟军兵营', layer: '地面层', state: '运转' },
            { name: '盟军兵营', layer: '地面层', state: '停机' },
          ],
        },
      ],
    });

    // 1. 2座发电厂分别受损与停机、1座兵营停机 → gen 降至 50W（仅建造厂），use 降至 20W（仅1座运转兵营）
    const afterDamage = settleFloor(peakState, peakState, '', { catalog });
    expect(afterDamage.data.bases[0].power).toEqual({ gen: 50, use: 20 });

    // 2. 全基地建筑全部停机/受损 → catalogGen === 0 && catalogUse === 0 时直接归零为 { gen: 0, use: 0 }
    const allStoppedState = Schema.parse({
      ...afterDamage.data,
      bases: [
        {
          ...afterDamage.data.bases[0],
          buildings: afterDamage.data.bases[0].buildings.map(b => ({ ...b, state: '停机' as const })),
        },
      ],
    });
    const afterAllStopped = settleFloor(afterDamage.data, allStoppedState, '', { catalog });
    expect(afterAllStopped.data.bases[0].power).toEqual({ gen: 0, use: 0 });

    // 3. MCV 收起唯一建造厂后，发电量从 50W 诚实归零
    const mcvBaseState = createInitialBaseState();
    const afterMcvPack = settleFloor(mcvBaseState, mcvBaseState, '<timePast>0 D 1 H 0 M</timePast>', {
      catalog,
      deployOrders: [{ vehicle: 'MCV（盟军）', action: '收起', base: 'base_1', into: '盟军建造厂', duration_min: 0 }],
    });
    expect(afterMcvPack.data.bases[0].buildings).toHaveLength(0);
    expect(afterMcvPack.data.bases[0].power).toEqual({ gen: 0, use: 0 });

    // 4. 纯自定义未知建筑基地（全处于运转态且未命中图鉴功率定义）保留原 b.power 兜底
    const customBaseState = Schema.parse({
      ...createInitialBaseState(),
      bases: [
        {
          id: 'base_custom',
          name: '远古遗迹前哨',
          status: '警戒',
          power: { gen: 180, use: 60 },
          buildings: [{ name: '未知外星能量核心', layer: '地下层', state: '运转' }],
        },
      ],
    });
    const afterCustom = settleFloor(customBaseState, customBaseState, '', { catalog });
    expect(afterCustom.data.bases[0].power).toEqual({ gen: 180, use: 60 });
  });
});
