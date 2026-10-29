import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROTOCOL_CATALOG,
  buildProtocolCatalogLookup,
  lookupProtocolCatalogEntry,
  mergeDefaultProtocolCatalog,
  normalizeProtocolLookupKey,
} from '../engines/protocolCatalogIndex';
import {
  buildProtocolIdIndex,
  resolveProtocolIdByName,
  resolveProtocolNameById,
} from '../core/catalogEffective';
import {
  buildEffectiveTechAndProtocolSet,
  evaluatePrerequisite,
} from '../core/prerequisites';
import {
  applyGridConstraints,
  computeBaseBuildingHealthFactor,
  isBuildingOperational,
  withWeatherView,
} from '../engines/operationEngine';
import {
  computeBaseBuildingHealthFactor as consoleComputeBaseBuildingHealthFactor,
  isBuildingOperational as consoleIsBuildingOperational,
} from '../../中控悬浮窗/models/operationEngine';
import { calcDailyNet } from '../engines/chainEngine';
import { IncomeChain } from '../core/schema';

describe('DEC-CATALOG-01 · protocolCatalogIndex 协议索引去重收口与同源归一化解析', () => {
  it('normalizeProtocolLookupKey 兼容全半角括号/中点/短横线/斜杠/序号前缀/空格与大小写', () => {
    expect(normalizeProtocolLookupKey('《44·铁幕紧急过载协议》')).toBe(
      normalizeProtocolLookupKey('44・铁幕紧急过载协议'),
    );
    expect(normalizeProtocolLookupKey('战斗工兵—预制战斗碉堡协议（苏联）')).toBe(
      normalizeProtocolLookupKey('战斗工兵 - 预制战斗碉堡协议(苏联)'),
    );
    expect(normalizeProtocolLookupKey('动员兵燃烧瓶／防空兵附着式反机动雷协议')).toBe(
      normalizeProtocolLookupKey('动员兵燃烧瓶 / 防空兵附着式反机动雷协议'),
    );
    expect(normalizeProtocolLookupKey('  SOV.Protocol.RA3.Crusher_Crane_Salvage  ')).toBe(
      'sov.protocol.ra3.crusher_crane_salvage',
    );
  });

  it('buildProtocolCatalogLookup 与 lookupProtocolCatalogEntry 同源解析 ID、名称与全半角别名', () => {
    const customItems = [
      ...DEFAULT_PROTOCOL_CATALOG,
      {
        id: 'all.protocol.custom.chrono_shield_mark2',
        name: '超时空护盾（II型）协议',
        faction: '盟军',
        track: '跨国联合防务条约',
        tier: 2 as const,
        cost_points: 1,
        experiment_cost_credits: 1500,
        desc: '测试自定义带括号协议',
        aliases: ['99·超时空护盾(II型)协议', '超时空护盾二型协议'],
      },
    ];
    const lookup = buildProtocolCatalogLookup(customItems);

    // 1. 按精确 ID、全半角破折号变体名、存量别名查同一条协议
    const byId = lookupProtocolCatalogEntry(lookup, 'sov.protocol.ra3.combat_engineer_prefab_bunker');
    const byVariantDash = lookupProtocolCatalogEntry(lookup, '《战斗工兵 - 预制战斗碉堡协议》');
    const byAlias = lookupProtocolCatalogEntry(lookup, '68·战斗工兵-预制战斗碉堡协议');
    expect(byId).toBeDefined();
    expect(byVariantDash?.id).toBe('sov.protocol.ra3.combat_engineer_prefab_bunker');
    expect(byAlias?.id).toBe('sov.protocol.ra3.combat_engineer_prefab_bunker');

    // 2. 按全半角括号与全半角中点别名查自定义协议
    const byHalfParen = lookupProtocolCatalogEntry(lookup, '超时空护盾(II型)协议');
    const byFullDotAlias = lookupProtocolCatalogEntry(lookup, '99・超时空护盾（II型）协议');
    expect(byHalfParen?.id).toBe('all.protocol.custom.chrono_shield_mark2');
    expect(byFullDotAlias?.id).toBe('all.protocol.custom.chrono_shield_mark2');
  });

  it('catalogEffective 与 prerequisites 与 protocolCatalogIndex 保持双向解析一致', () => {
    const catalogSource = {
      protocols: [
        {
          id: 'sov.protocol.custom.polar_grid',
          name: '极地超导并网（I型）协议',
          aliases: ['108·极地超导并网(I型)协议'],
        },
      ],
    };

    const idx = buildProtocolIdIndex(catalogSource);
    expect(resolveProtocolIdByName('108・极地超导并网（I型）协议', idx)).toBe('sov.protocol.custom.polar_grid');
    expect(resolveProtocolNameById('sov.protocol.custom.polar_grid', idx)).toBe('极地超导并网（I型）协议');
    expect(resolveProtocolIdByName('44·铁幕紧急过载协议', idx)).toBe(
      'sov.research.t2.iron_curtain_emergency_overload',
    );

    // prerequisites 使用全半角变体激活协议时，满足按权威 ID 或权威名声明的 research 前置条件
    const unionSet = buildEffectiveTechAndProtocolSet({
      catalog: catalogSource,
      activeProtocols: ['108・极地超导并网(I型)协议', '68·战斗工兵-预制战斗碉堡协议'],
      bases: new Map(),
      unitPresent: new Map(),
    });
    expect(unionSet.has('sov.protocol.custom.polar_grid')).toBe(true);
    expect(unionSet.has('极地超导并网（I型）协议')).toBe(true);
    expect(unionSet.has('sov.protocol.ra3.combat_engineer_prefab_bunker')).toBe(true);
    expect(unionSet.has('战斗工兵—预制战斗碉堡协议')).toBe(true);

    const checkRes = evaluatePrerequisite(
      {
        op: 'all',
        conditions: [
          { kind: 'research', name: '极地超导并网（I型）协议' },
          { kind: 'research', id: 'sov.protocol.ra3.combat_engineer_prefab_bunker' },
        ],
      },
      {
        catalog: catalogSource,
        activeProtocols: ['108・极地超导并网(I型)协议', '68·战斗工兵-预制战斗碉堡协议'],
        bases: new Map(),
        unitPresent: new Map(),
      },
    );
    expect(checkRes.satisfied).toBe(true);

    // mergeDefaultProtocolCatalog 同源合并验证
    const merged = mergeDefaultProtocolCatalog(DEFAULT_PROTOCOL_CATALOG, [
      {
        id: 'sov.research.t2.iron_curtain_emergency_overload',
        name: '铁幕紧急过载协议',
        faction: '苏联',
        track: '过载工程与战区拒止',
        tier: 2,
        cost_points: 2,
        experiment_cost_credits: 2000,
        desc: '覆盖后的描述',
      },
    ]);
    expect(merged).toHaveLength(18);
    expect(merged.find(p => p.id === 'sov.research.t2.iron_curtain_emergency_overload')?.cost_points).toBe(2);
  });
});

describe('SIM-WEATHER-01 · withWeatherView 正向收入折算与 applyGridConstraints 建筑失能断链', () => {
  it('withWeatherView 在暴风雪（及沙尘暴/强磁暴/冻雨）下仅对正向收入链折半，负数/固定支出链保持原额不减免', () => {
    const incomeChain = IncomeChain.parse({
      id: 'chain_income',
      name: '北境矿脉外运线',
      flow: '收入',
      rate_daily: 1000,
      status: 'active',
      eff: 1,
    });
    const expenseChain = IncomeChain.parse({
      id: 'chain_upkeep',
      name: '防空阵列固定维护费',
      flow: '支出',
      rate_daily: 400,
      status: 'active',
      eff: 1,
    });
    const negativeAmountChain = {
      ...IncomeChain.parse({
        id: 'chain_neg_amount',
        name: '驻军后勤固定开支',
        flow: '收入',
        rate_daily: 300,
        status: 'active',
        eff: 1,
      }),
      amount: -300,
    };
    const positiveAmountChain = {
      ...IncomeChain.parse({
        id: 'chain_pos_amount',
        name: '前线补给贸易分成',
        flow: '收入',
        rate_daily: 600,
        status: 'active',
        eff: 1,
      }),
      amount: 600,
    };

    for (const badWeather of ['暴风雪', '沙尘暴', '强磁暴', '冻雨']) {
      const view = withWeatherView(
        [incomeChain, expenseChain, negativeAmountChain, positiveAmountChain],
        badWeather,
      );
      // 正向收入链 eff 折半为 0.5
      expect(view[0].eff).toBe(0.5);
      // flow === '支出' 链条保持 eff = 1，不减免支出
      expect(view[1].eff).toBe(1);
      // amount < 0 固定支出链保持 eff = 1 且 amount = -300 不减半
      expect(view[2].eff).toBe(1);
      expect(view[2].amount).toBe(-300);
      // amount > 0 正向收入链 eff = 0.5 且 amount = 300
      expect(view[3].eff).toBe(0.5);
      expect(view[3].amount).toBe(300);
    }

    // 验证 calcDailyNet：暴风雪下 1000 收入折半为 500，400 支出不减半仍为 400，净收益 = 500 - 400 = 100
    const dailyView = withWeatherView([incomeChain, expenseChain], '暴风雪');
    expect(calcDailyNet(dailyView)).toBe(100);
  });

  it('withWeatherView 当 view.weather 未显式传入时，支持从 data.meta.weather 回退读取当前天气', () => {
    const incomeChain = IncomeChain.parse({
      id: 'chain_income',
      name: '灵石矿脉专线',
      flow: '收入',
      rate_daily: 800,
      status: 'active',
      eff: 1,
    });
    const expenseChain = IncomeChain.parse({
      id: 'chain_expense',
      name: '固定卫戍军饷',
      flow: '支出',
      rate_daily: 200,
      status: 'active',
      eff: 1,
    });

    // 方式 1：第 2 参数为上下文对象 { weather: undefined, data: { meta: { weather: '暴风雪' } } }
    const viewFromContext = withWeatherView([incomeChain, expenseChain], {
      weather: undefined,
      data: { meta: { weather: '暴风雪' } },
    });
    expect(viewFromContext[0].eff).toBe(0.5);
    expect(viewFromContext[1].eff).toBe(1);

    // 方式 2：第 2 参数为 undefined，第 3 参数传入含 meta.weather 的 data 对象
    const viewFromFallbackArg = withWeatherView([incomeChain, expenseChain], undefined, {
      meta: { weather: '暴风雪' },
    });
    expect(viewFromFallbackArg[0].eff).toBe(0.5);
    expect(viewFromFallbackArg[1].eff).toBe(1);

    // 方式 3：单参视图对象 { chains, data: { meta: { weather: '暴风雪' } } }
    const viewFromSingleObj = withWeatherView({
      chains: [incomeChain, expenseChain],
      data: { meta: { weather: '暴风雪' } },
    });
    expect(viewFromSingleObj[0].eff).toBe(0.5);
    expect(viewFromSingleObj[1].eff).toBe(1);
  });

  it('applyGridConstraints 当依赖建筑处于 受损 / 停机 / 离线 / 被毁（status 或 state）时准确触发受挫停摆并标注原因', () => {
    const chain = IncomeChain.parse({
      id: 'chain_harbor',
      name: '军港重型物资吞吐线',
      flow: '收入',
      rate_daily: 900,
      status: 'active',
      eff: 1,
      reason: '战区海运长协',
      deps: { base_id: 'base_north', buildings: ['重型货运码头'], world_resource: '' },
    });

    for (const badStatus of ['受损', '停机', '离线', '被毁']) {
      const resByStatus = applyGridConstraints({
        chains: [chain],
        bases: [
          {
            id: 'base_north',
            power: { gen: 300, use: 120 },
            buildings: [{ name: '重型货运码头', status: badStatus }],
          },
        ],
        nowDay: 10,
      });
      expect(resByStatus.chains[0].status).toBe('distressed');
      expect(resByStatus.chains[0].eff).toBe(0);
      expect(resByStatus.chains[0].reason).toContain('重型货运码头');
      expect(resByStatus.events).toHaveLength(1);
      expect(resByStatus.events[0].kind).toBe('grid_outage');

      // 当建筑修复为「正常」或「运转」后自动还原
      const restored = applyGridConstraints({
        chains: resByStatus.chains,
        bases: [
          {
            id: 'base_north',
            power: { gen: 300, use: 120 },
            buildings: [{ name: '重型货运码头', status: '运转' }],
          },
        ],
        nowDay: 11,
      });
      expect(restored.chains[0].status).toBe('active');
      expect(restored.chains[0].eff).toBe(1);
      expect(restored.chains[0].reason).toBe('战区海运长协');
    }
  });

  it('双端 operationEngine.ts 同源导出 isBuildingOperational 与 computeBaseBuildingHealthFactor 且行为一致', () => {
    expect(isBuildingOperational).toBe(consoleIsBuildingOperational);
    expect(computeBaseBuildingHealthFactor).toBe(consoleComputeBaseBuildingHealthFactor);

    expect(isBuildingOperational({ status: '运转' })).toBe(true);
    expect(isBuildingOperational({ state: '正常' })).toBe(true);
    expect(isBuildingOperational({})).toBe(true);

    expect(isBuildingOperational({ status: '受损' })).toBe(false);
    expect(isBuildingOperational({ status: '停机' })).toBe(false);
    expect(isBuildingOperational({ state: '离线' })).toBe(false);
    expect(isBuildingOperational({ state: '被毁' })).toBe(false);

    expect(
      computeBaseBuildingHealthFactor([
        { name: '磁暴反应炉', status: '运转' },
        { name: '矿石精炼厂', status: '受损' },
        { name: '战车工厂', state: '停机' },
        { name: '雷达站', state: '正常' },
      ]),
    ).toBe(0.5);
    expect(computeBaseBuildingHealthFactor([])).toBe(1);
  });
});
