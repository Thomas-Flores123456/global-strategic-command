import { describe, expect, it } from 'vitest';
import { FACTION_DEFS } from '../core/catalog';
import type { EffectiveCatalog } from '../core/catalogEffective';
import {
  buildPlanningContext,
  classifyPlanningBlocker,
  formatPlanningContextPrompt,
} from '../planning/planningContext';
import { Base, QueueItem, Schema, type StatData } from '../core/schema';

function createTestCatalog(): EffectiveCatalog {
  return {
    researches: [
      {
        name: '基础步兵训练学',
        cost: 200,
        eta: '约2日',
        line: '主建筑',
        tier: 1,
        unlocks: '兵营',
        prereq: '——',
        prereqs: [],
        desc: '步兵训练基础',
      },
      {
        name: '光棱聚焦基础',
        cost: 600,
        eta: '约5日',
        line: '盟军特色',
        tier: 2,
        unlocks: '光棱塔、光棱坦克',
        prereq: '战斗实验室',
        prereqs: [],
        need_buildings: ['战斗实验室'],
        desc: '光棱定向能武器理论',
      },
    ],
    buildings: [
      {
        name: '发电厂',
        cost: 800,
        power: -200,
        research: null,
        prereqs: [],
        need_buildings: [],
        lane: 'lane.other_building',
        desc: '基础电力设施',
      },
      {
        name: '光棱塔',
        cost: 1500,
        power: 75,
        research: '光棱聚焦基础',
        prereqs: ['光棱聚焦基础'],
        need_buildings: ['发电厂'],
        lane: 'lane.defense',
        desc: '盟军高级激光防御阵地',
      },
      {
        name: '苏联磁暴线圈',
        cost: 1500,
        power: 75,
        research: null,
        prereqs: [],
        need_buildings: ['苏联建造厂'],
        lane: 'lane.defense',
        tags: ['苏联'],
        desc: '苏联高级磁暴防御塔',
      },
    ],
    productions: [
      {
        name: '动员兵',
        cost: 100,
        need_building: '兵营',
        need_buildings: ['兵营'],
        prereqs: [],
        lane: 'lane.personnel',
        desc: '基础步兵单位',
      },
      {
        name: '灰熊主战坦克',
        cost: 700,
        need_building: '战车工厂',
        need_buildings: ['战车工厂'],
        prereqs: [],
        lane: 'lane.vehicle_land',
        desc: '盟军主力中型坦克',
      },
      {
        name: '光棱坦克',
        cost: 1200,
        need_building: '战车工厂',
        need_buildings: ['战车工厂'],
        prereqs: ['光棱聚焦基础'],
        lane: 'lane.vehicle_land',
        desc: '远程能量支援坦克',
      },
      {
        name: '重装防空步兵',
        cost: 400,
        need_building: '兵营',
        need_buildings: ['兵营'],
        prereqs: ['反应装甲协议'],
        lane: 'lane.personnel',
        desc: '受协议加持的反装甲步兵',
      },
      {
        name: '天启原型车',
        cost: 2000,
        need_building: '战车工厂',
        need_buildings: ['战车工厂'],
        prereqs: [],
        lane: 'lane.vehicle_land',
        tags: ['隐藏'],
        desc: '未揭盲机密单位',
      },
    ],
    retrofits: [],
    projects: [],
    protocols: [
      {
        id: 'proto.allied.reactive_armor',
        name: '反应装甲协议',
        faction: 'ALLIED',
        track: 'armor',
        tier: 1,
        desc: '步兵与轻甲防护升级协议',
      } as EffectiveCatalog['protocols'][number],
    ],
    factionDefs: FACTION_DEFS,
  };
}

function createBaseState(overrides?: Partial<StatData>): StatData {
  const base = Schema.parse({
    economy: {
      credits: 5000,
      credits_daily: 300,
      chains: [
        {
          id: 'chain_ore_01',
          name: '北坡矿脉精炼线',
          flow: '收入',
          rate_daily: 800,
          status: 'active',
          eff: 1,
        },
      ],
    },
    bases: [
      {
        id: 'base_north',
        name: '北坡主基地',
        status: '隐蔽中',
        buildings: [
          { name: '建造厂核心', state: '运转' },
          { name: '发电厂', state: '运转' },
          { name: '兵营', state: '运转' },
        ],
      },
    ],
    tech: {
      done: ['基础步兵训练学'],
    },
    planning: {
      protected_task_refs: ['task:queue:0'],
    },
  });
  return { ...base, ...overrides };
}

describe('PLAN-CTX-01 planningContext 排产上下文与阻塞分类纯函数', () => {
  it('1. 正常可造候选提取：正确识别已开通产线的生产/建造项并汇总资金与队列', () => {
    const catalog = createTestCatalog();
    const state = createBaseState({
      queues: [
        QueueItem.parse({
          type: '生产',
          item: '动员兵',
          base: 'base_north',
          status: 'active',
          qty: 2,
          spent_minutes: 360,
          total_minutes: 1440,
        }),
      ],
    });

    const ctx = buildPlanningContext(state, catalog);
    expect(ctx).not.toBeNull();
    expect(ctx!.baseId).toBe('base_north');
    expect(ctx!.baseName).toBe('北坡主基地');
    expect(ctx!.credits).toBe(5000);
    expect(ctx!.dailyNetCredits).toBe(800);
    expect(ctx!.protectedTaskRefs).toContain('task:queue:0');
    expect(ctx!.activeQueueSummary).toHaveLength(1);
    expect(ctx!.activeQueueSummary[0].item).toBe('动员兵');

    const produceableNames = ctx!.produceableItems.map(i => i.name);
    expect(produceableNames).toContain('动员兵');
    expect(produceableNames).toContain('发电厂');

    // 动员兵所在人员训练线容量为 1 且有 1 条在制队列，应附带 lane_occupied 提示但仍保持 canProduceNow: true
    const conscriptItem = ctx!.produceableItems.find(i => i.name === '动员兵');
    expect(conscriptItem?.canProduceNow).toBe(true);
    expect(conscriptItem?.blocked?.code).toBe('lane_occupied');

    // 未揭盲隐藏单位与未解锁苏联阵营建筑不泄露（零剧透铁律）
    const allCandidateNames = [
      ...ctx!.produceableItems.map(i => i.name),
      ...ctx!.nearUnlockItems.map(i => i.name),
    ];
    expect(allCandidateNames).not.toContain('天启原型车');
    expect(allCandidateNames).not.toContain('苏联磁暴线圈');
  });

  it('2. 缺失科技/协议阻塞分类 UX-04：生成原因→影响→下一步三段式详情与 missingItems', () => {
    const catalog = createTestCatalog();
    const state = createBaseState();
    const ctx = buildPlanningContext(state, catalog);
    expect(ctx).not.toBeNull();

    const prismTower = ctx!.nearUnlockItems.find(i => i.name === '光棱塔');
    expect(prismTower).toBeDefined();
    expect(prismTower!.canProduceNow).toBe(false);
    expect(prismTower!.blocked).toBeDefined();
    expect(prismTower!.blocked!.code).toBe('missing_research');
    expect(prismTower!.blocked!.missingItems).toContain('光棱聚焦基础');
    expect(prismTower!.blocked!.reason).toContain('光棱聚焦基础');
    expect(prismTower!.blocked!.impact).toContain('北坡主基地');
    expect(prismTower!.blocked!.nextStep).toContain('光棱聚焦基础');

    // 直接验证 classifyPlanningBlocker 对资金不足与缺失单位的 UX-04 分类
    const creditBlocker = classifyPlanningBlocker({
      itemName: '光棱塔',
      kind: '建造',
      baseName: '北坡主基地',
      unitCost: 1500,
      credits: 400,
    });
    expect(creditBlocker?.code).toBe('insufficient_credits');
    expect(creditBlocker?.reason).toContain('1100');
    expect(creditBlocker?.impact).toContain('北坡主基地');
    expect(creditBlocker?.nextStep).toContain('1100');
  });

  it('3. 缺失产线建筑阻塞：缺少战车工厂或产线锁定时准确归入 nearUnlockItems 并给出建造指引', () => {
    const catalog = createTestCatalog();
    const state = createBaseState();
    const ctx = buildPlanningContext(state, catalog);
    expect(ctx).not.toBeNull();

    // 灰熊主战坦克在北坡主基地仅缺「战车工厂」
    const grizzly = ctx!.nearUnlockItems.find(i => i.name === '灰熊主战坦克');
    expect(grizzly).toBeDefined();
    expect(grizzly!.canProduceNow).toBe(false);
    expect(grizzly!.blocked?.code).toBe('missing_building');
    expect(grizzly!.blocked?.missingItems).toEqual(['战车工厂']);
    expect(grizzly!.blocked?.reason).toContain('战车工厂');
    expect(grizzly!.blocked?.nextStep).toContain('战车工厂');

    // 验证纯产线未开通（lane_locked）分类
    const laneLockedBlocker = classifyPlanningBlocker({
      itemName: '发电厂',
      kind: '建造',
      baseName: '前哨分基地',
      lane: {
        displayName: '其他建筑建造线',
        capacity: 0,
        locked: true,
        lockedReason: '需建造厂核心在场（生产模式）',
      },
    });
    expect(laneLockedBlocker?.code).toBe('lane_locked');
    expect(laneLockedBlocker?.missingItems).toEqual(['建造厂核心']);
    expect(laneLockedBlocker?.reason).toContain('其他建筑建造线');
    expect(laneLockedBlocker?.nextStep).toContain('建造厂核心');
  });

  it('4. 协议并集解锁生效：激活协议自动并入完成集并解锁对应生产候选', () => {
    const catalog = createTestCatalog();

    // 未激活协议前，「重装防空步兵」因缺少「反应装甲协议」处于 nearUnlockItems
    const stateBefore = createBaseState();
    const ctxBefore = buildPlanningContext(stateBefore, catalog)!;
    expect(ctxBefore.produceableItems.some(i => i.name === '重装防空步兵')).toBe(false);
    const blockedBefore = ctxBefore.nearUnlockItems.find(i => i.name === '重装防空步兵');
    expect(blockedBefore?.blocked?.code).toBe('missing_research');

    // 激活「反应装甲协议」后，并集解锁生效，「重装防空步兵」进入 produceableItems
    const stateAfter = createBaseState({
      protocols: [
        {
          id: 'proto.allied.reactive_armor',
          name: '反应装甲协议',
          status: 'active',
        } as NonNullable<StatData['protocols']>[number],
      ],
    });
    const ctxAfter = buildPlanningContext(stateAfter, catalog)!;
    const unlockedUnit = ctxAfter.produceableItems.find(i => i.name === '重装防空步兵');
    expect(unlockedUnit).toBeDefined();
    expect(unlockedUnit!.canProduceNow).toBe(true);
  });

  it('5. 废弃基地拦截与默认在役基地选择：指定废弃基地返回 null，未指定时自动跳过废弃基地', () => {
    const catalog = createTestCatalog();
    const state = createBaseState({
      bases: [
        Base.parse({
          id: 'base_old',
          name: '旧谷地前哨',
          status: '废弃',
          buildings: [{ name: '建造厂核心', state: '运转' }],
        }),
        Base.parse({
          id: 'base_active',
          name: '二号主基地',
          status: '警戒',
          buildings: [
            { name: '建造厂核心', state: '运转' },
            { name: '兵营', state: '运转' },
          ],
        }),
      ],
    });

    // 显式指定已废弃基地应拦截并返回 null
    expect(buildPlanningContext(state, catalog, { targetBaseRef: 'base_old' })).toBeNull();
    expect(buildPlanningContext(state, catalog, { targetBaseRef: '旧谷地前哨' })).toBeNull();

    // 未传 targetBaseRef 时自动跳过废弃基地，选取首个非废弃基地
    const autoCtx = buildPlanningContext(state, catalog);
    expect(autoCtx).not.toBeNull();
    expect(autoCtx!.baseId).toBe('base_active');
    expect(autoCtx!.baseName).toBe('二号主基地');

    // 验证 classifyPlanningBlocker 对废弃基地的直接分类
    const retiredBlocker = classifyPlanningBlocker({
      itemName: '动员兵',
      baseName: '旧谷地前哨',
      baseState: '废弃',
    });
    expect(retiredBlocker?.code).toBe('base_retired');
  });

  it('6. 提示词格式化输出：生成包含基地态势、产线、队列、可造与临近候选的紧凑条令体文本', () => {
    const catalog = createTestCatalog();
    const state = createBaseState({
      queues: [
        QueueItem.parse({
          type: '生产',
          item: '动员兵',
          base: 'base_north',
          status: 'active',
          qty: 3,
          spent_minutes: 720,
          total_minutes: 1440,
        }),
      ],
    });

    const ctx = buildPlanningContext(state, catalog)!;
    const promptText = formatPlanningContextPrompt(ctx);

    expect(promptText).toContain('【排产态势纪要 · 北坡主基地（base_north｜隐蔽中）】');
    expect(promptText).toContain('战区资金：现存 5000｜日均净流 +800/日');
    expect(promptText).toContain('已开通产线');
    expect(promptText).toContain('人员训练线');
    expect(promptText).toContain('在途队列(1)：生产:动员兵×3');
    expect(promptText).toContain('受保护任务锁：task:queue:0');
    expect(promptText).toContain('立即可排产候选');
    expect(promptText).toContain('临近解锁/暂阻候选');
    expect(promptText).toContain('灰熊主战坦克');
    expect(promptText).toContain('光棱塔');
  });

  it('7. BUG-LIVE-01：通用建筑（faction="common"/"通用"/"all"）与中英阵营 ID 归一（unlocked_factions=["allied"]）不误判为未解锁阵营', () => {
    const baseCatalog = createTestCatalog();
    const catalog = {
      ...baseCatalog,
      buildings: [
        ...baseCatalog.buildings,
        {
          name: '矿石精炼厂',
          cost: 2000,
          power: 50,
          faction: 'common',
          prereqs: [],
          need_buildings: ['盟军建造厂'],
          desc: '通用精炼厂',
          workload: { days: 1, min_days: 0.5 },
        },
        {
          name: '战车工厂',
          cost: 2000,
          power: 50,
          faction: '通用',
          prereqs: [],
          need_buildings: ['盟军建造厂'],
          desc: '通用车厂',
          workload: { days: 1, min_days: 0.5 },
        },
      ],
    } as unknown as EffectiveCatalog;

    const state = Schema.parse({
      ...createBaseState(),
      command: {
        unlocked_factions: ['allied'],
      },
    });

    const ctx = buildPlanningContext(state, catalog)!;
    const produceableNames = ctx.produceableItems.map(i => i.name);
    expect(produceableNames).toContain('矿石精炼厂');
    expect(produceableNames).toContain('战车工厂');
    expect(produceableNames).toContain('动员兵');
    expect(produceableNames).not.toContain('苏联磁暴线圈');
  });
});
