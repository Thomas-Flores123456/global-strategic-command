import { describe, expect, it } from 'vitest';
import { Schema, SpaceContract } from '../core/schema';
import {
  parseProductionDeclarations,
  reconcileProduction,
} from '../engines/productionReconciliation';
import {
  BUILDABLE_AERO_EQUIPMENT_CATALOG,
  deriveLaunchCentersFromState,
  evaluateLaunchSiteModifiers,
  extractLaunchCenters,
  extractSpaceContracts,
  LAUNCH_SITE_MODIFIERS,
  settleSpaceOperations,
  syncAeroEquipmentStock,
} from '../engines/spaceEngine';
import { parseMessageText } from '../parse/parsePipeline';

describe('FD-27 · 天基多发射中心切换、天地月 6 大选址硬数值与航天城流水线引擎', () => {
  it('1. 6 大选址硬数值矩阵 (LAUNCH_SITE_MODIFIERS & evaluateLaunchSiteModifiers)', () => {
    expect(Object.keys(LAUNCH_SITE_MODIFIERS)).toEqual([
      'equatorial_coastal',
      'inland_canyon',
      'sea_platform',
      'high_latitude',
      'orbital_dock',
      'lunar_surface',
    ]);

    // 1) 赤道滨海：回款 +20%，运力 ×1.15，暴露 +0.12，maxTier=3
    const eq = evaluateLaunchSiteModifiers('equatorial_coastal', 'LEO');
    expect(eq).toMatchObject({
      siteType: 'equatorial_coastal',
      payoutMult: 1.2,
      payloadMult: 1.15,
      exposureDelta: 0.12,
      immuneToEarthWeather: false,
      maxTier: 3,
    });

    // 2) 内陆深谷：LEO/SSO 为 1.0/1.0，GEO/TLI 为 0.90/0.90，暴露 +0.05
    const canyonLeo = evaluateLaunchSiteModifiers('inland_canyon', 'LEO');
    expect(canyonLeo.payoutMult).toBe(1.0);
    expect(canyonLeo.payloadMult).toBe(1.0);
    expect(canyonLeo.exposureDelta).toBe(0.05);

    const canyonGeo = evaluateLaunchSiteModifiers('inland_canyon', 'GEO');
    expect(canyonGeo.payoutMult).toBe(0.9);
    expect(canyonGeo.payloadMult).toBe(0.9);

    // 3) 海上半潜平台：回款 +20%，运力 ×1.15，暴露 +0.03，maxTier 锁死为 2
    const sea = evaluateLaunchSiteModifiers('sea_platform', 'LEO');
    expect(sea).toMatchObject({
      siteType: 'sea_platform',
      payoutMult: 1.2,
      payloadMult: 1.15,
      exposureDelta: 0.03,
      immuneToEarthWeather: false,
      maxTier: 2,
    });

    // 4) 高纬极地：SSO/侦察 +25% / ×1.20，GEO -15% / ×0.80，暴露 +0.06
    const polarSso = evaluateLaunchSiteModifiers('high_latitude', 'SSO');
    expect(polarSso.payoutMult).toBe(1.25);
    expect(polarSso.payloadMult).toBe(1.2);
    expect(polarSso.exposureDelta).toBe(0.06);

    const polarGeo = evaluateLaunchSiteModifiers('high_latitude', 'GEO');
    expect(polarGeo.payoutMult).toBe(0.85);
    expect(polarGeo.payloadMult).toBe(0.8);

    // 5) 轨道船坞母港：免疫天气，暴露 0，运力 ×2.0，常规回款 +50%（有月面水冰/质量投射器时 +75% 且免纳米费）
    const dockBase = evaluateLaunchSiteModifiers('orbital_dock', 'TLI', false);
    expect(dockBase).toMatchObject({
      siteType: 'orbital_dock',
      payoutMult: 1.5,
      payloadMult: 2.0,
      exposureDelta: 0,
      immuneToEarthWeather: true,
      maxTier: 3,
      naniteCostPerLaunch: 50,
    });
    const dockBoosted = evaluateLaunchSiteModifiers('orbital_dock', 'TLI', true);
    expect(dockBoosted.payoutMult).toBe(1.75);
    expect(dockBoosted.naniteCostPerLaunch).toBe(0);

    // 6) 月面低重力中心：免疫天气，暴露 0，运力 ×1.5，常规回款 +35%（建成月面质量投射器时 +75%）
    const lunarBase = evaluateLaunchSiteModifiers('lunar_surface', 'TLI', false);
    expect(lunarBase).toMatchObject({
      siteType: 'lunar_surface',
      payoutMult: 1.35,
      payloadMult: 1.5,
      exposureDelta: 0,
      immuneToEarthWeather: true,
      maxTier: 3,
    });
    const lunarMassDriver = evaluateLaunchSiteModifiers('lunar_surface', 'TLI', true);
    expect(lunarMassDriver.payoutMult).toBe(1.75);
  });

  it('2. 多基地发射中心提取 (extractLaunchCenters) 与三大制造建筑自动映射派生及航天城激活 (deriveLaunchCentersFromState)', () => {
    const raw = `
<航天合同>
- 类别: 发射中心
  基地: 东海赤道基地
  名称: 东海赤道一号商业发射场
  选址: equatorial_coastal
  等级: 2
  模块: [lc_pad_1:asset.lc.pad_std, lc_hif:asset.lc.vab_vertical, lc_pad_2:asset.lc.pad_cryo]
  状态: 运转
- 编号: sc_test_01
  名称: 试验星发射
  类型: commercial
  基地: 东海赤道基地
  报酬: 1000
  状态: pending
</航天合同>
<发射中心>
- 基地: 远洋机动平台
  名称: 太平洋半潜发射平台
  选址: sea_platform
  等级: 3
  状态: 运转
</发射中心>
`;
    const centers = extractLaunchCenters(raw);
    expect(centers).toHaveLength(2);
    expect(centers[0]).toMatchObject({
      base: '东海赤道基地',
      name: '东海赤道一号商业发射场',
      site_type: 'equatorial_coastal',
      tier: 2,
      status: '运转',
      mounted_slots: {
        lc_pad_1: 'asset.lc.pad_std',
        lc_hif: 'asset.lc.vab_vertical',
        lc_pad_2: 'asset.lc.pad_cryo',
      },
    });
    // 海上半潜平台规模上限自动钳制为 Tier-2
    expect(centers[1]).toMatchObject({
      base: '远洋机动平台',
      site_type: 'sea_platform',
      tier: 2,
    });

    const contracts = extractSpaceContracts(raw);
    expect(contracts).toHaveLength(1);
    expect(contracts[0].id).toBe('sc_test_01');

    // 测试从基地独立建筑自动映射点亮插槽并激活【国家航天城 · 产装测发流水线】
    const state = Schema.parse({
      meta: { weather: '晴' },
      bases: [
        {
          id: 'base-north',
          name: '北坡主基地',
          site_type: 'inland_canyon',
          weather: '多云',
          tz_offset: 5, // 首基地恒定强制为 0
          buildings: [
            { name: '航天发射中心', state: '运转' },
            { name: '火箭制造厂', state: '运转' },
            { name: '卫星制造中心', state: '运转' },
            { name: '大型航天器与舱段总装中心', state: '运转' },
            { name: '深空测控网络', state: '运转' },
          ],
        },
        {
          id: 'base-east',
          name: '东海赤道基地',
          site_type: 'equatorial_coastal',
          weather: '强台风',
          tz_offset: 2,
          buildings: [{ name: '商业航天发射工位', state: '运转' }],
        },
      ],
    });

    const derived = deriveLaunchCentersFromState(state);
    expect(derived).toHaveLength(2);

    const northCenter = derived.find(c => c.base === '北坡主基地')!;
    expect(northCenter.isSpaceportCity).toBe(true);
    expect(northCenter.tier).toBe(3);
    expect(northCenter.tz_offset).toBe(0); // 首基地标准时区铁律
    expect(northCenter.weather).toBe('多云');
    expect(northCenter.mounted_slots).toMatchObject({
      lc_pad_1: 'asset.lc.pad_std',
      lc_hif: 'asset.lc.vab_vertical',
      lc_underground_fab: 'asset.lc.underground_rocket_fab',
      lc_sat_cleanroom: 'asset.lc.cleanroom_sat_line',
      lc_weather_tower: 'asset.lc.weather_lightning_tower',
    });

    const eastCenter = derived.find(c => c.base === '东海赤道基地')!;
    expect(eastCenter.isSpaceportCity).toBe(false);
    expect(eastCenter.tz_offset).toBe(2);
    expect(eastCenter.weather).toBe('强台风');
  });

  it('3. 多基地局部天气隔离、航天城 +25% 流水线加成、轨道船坞/月面气象豁免与暴露度脉冲', () => {
    const state = Schema.parse({
      meta: { weather: '晴', day_count: 10 },
      economy: { credits: 0 },
      exposure: { value: 1.0 },
      bases: [
        {
          id: 'base-1',
          name: '北坡航天城基地',
          site_type: 'inland_canyon',
          weather: '晴',
          buildings: [
            { name: '航天发射中心', state: '运转' },
            { name: '火箭制造厂', state: '运转' },
            { name: '卫星制造中心', state: '运转' },
            { name: '大型航天器与舱段总装中心', state: '运转' },
          ],
        },
        {
          id: 'base-2',
          name: '南海滨海基地',
          site_type: 'equatorial_coastal',
          weather: '强台风', // 局部恶劣天气
          buildings: [{ name: '航天发射中心', state: '运转' }],
        },
        {
          id: 'base-3',
          name: '广寒月面基地',
          site_type: 'lunar_surface',
          weather: '暴风雪', // 即便写暴风雪，月面选址也 100% 豁免地球天气
          buildings: [
            { name: '月面有人基地', state: '运转' },
            { name: '月面电磁质量投射器', state: '运转' },
          ],
        },
      ],
    });

    const contracts: SpaceContract[] = [
      SpaceContract.parse({
        id: 'c-north',
        title: '北坡空间站居住舱发射',
        kind: 'station',
        base: '北坡航天城基地',
        rocket: '重型低温无毒运载火箭',
        payload: '标准生活居住舱 (18t)',
        mass_t: 18,
        target_slot: 'st_port_hab',
        asset_id: 'asset.st.hab',
        reward_credits: 4000,
        status: 'in_orbit',
      }),
      SpaceContract.parse({
        id: 'c-south-typhoon',
        title: '南海商业卫星发射',
        kind: 'commercial',
        base: '南海滨海基地',
        payload: '南海通信星',
        reward_credits: 2000,
        status: 'pending',
      }),
      SpaceContract.parse({
        id: 'c-lunar',
        title: '月面深空载荷投送',
        kind: 'recon',
        base: '广寒月面基地',
        payload: '地月激光中继信标',
        target_slot: 'lun_comms_1',
        reward_credits: 2000,
        status: 'in_orbit',
      }),
    ];

    const res = settleSpaceOperations(state, contracts);

    // 北坡航天城（晴）与广寒月面基地（免疫天气）成功发射；南海基地因局部强台风被挂起
    expect(res.launchedIds).toEqual(['c-north', 'c-lunar']);
    expect(res.heldIds).toEqual(['c-south-typhoon']);

    const southContract = state.space.contracts.find(c => c.id === 'c-south-typhoon')!;
    expect(southContract.status).toBe('pending');
    expect(southContract.weather_hold_reason).toContain('强台风');

    // 北坡航天城：inland_canyon LEO (1.0) × 航天城 (1.25) × 4000 = 5000
    // 广寒月面基地（含月面电磁质量投射器）：lunar_surface (1.75) × 2000 = 3500
    // 合计回款 = 8500
    expect(res.creditsEarned).toBe(8500);
    expect(state.economy.credits).toBe(8500);

    // 暴露度：北坡内陆深谷 +0.05，月面 +0.00 -> 1.05
    expect(state.exposure.value).toBe(1.05);

    // target_slot 自动点亮
    expect(state.space.completed_slots).toEqual({
      st_port_hab: 'asset.st.hab',
      lun_comms_1: '地月激光中继信标',
    });
  });

  it('4. 运载火箭吨位与发射中心等级硬门控（Tier-1 拦截重型火箭与超重载荷，赤道 ×1.15 运力加成验证）', () => {
    const state = Schema.parse({
      meta: { weather: '晴' },
      economy: { credits: 0 },
      bases: [
        {
          id: 'b-canyon',
          name: '深谷小型发射场',
          site_type: 'inland_canyon',
          buildings: [{ name: '商业航天发射工位', state: '运转' }],
        },
        {
          id: 'b-eq',
          name: '赤道小型发射场',
          site_type: 'equatorial_coastal',
          buildings: [{ name: '商业航天发射工位', state: '运转' }],
        },
      ],
    });

    // 1) 在 Tier-1 小型发射场尝试使用 Tier-2 重型低温火箭 -> 等级不足被拦截
    const heavyRocketContract = SpaceContract.parse({
      id: 'c-heavy-blocked',
      title: '重型舱段发射',
      base: '深谷小型发射场',
      rocket: '重型低温无毒运载火箭',
      payload: '实验舱 (15t)',
      mass_t: 15,
      reward_credits: 3000,
    });
    const res1 = settleSpaceOperations(state, [heavyRocketContract]);
    expect(res1.launchedIds).toEqual([]);
    expect(res1.heldIds).toEqual(['c-heavy-blocked']);
    expect(state.space.contracts[0].weather_hold_reason).toContain('发射中心等级不足');

    // 2) 9t 载荷用中型火箭（基准 8t）：深谷 (8×1.0=8t) 超重拦截，赤道滨海 (8×1.15=9.2t) 顺利升空！
    const canyon9t = SpaceContract.parse({
      id: 'c-canyon-9t',
      title: '深谷 9t 载荷测试',
      base: '深谷小型发射场',
      rocket: '通用中型运载火箭',
      payload: '高通量实验星 (9t)',
      mass_t: 9,
      reward_credits: 2000,
    });
    const eq9t = SpaceContract.parse({
      id: 'c-eq-9t',
      title: '赤道 9t 载荷测试',
      base: '赤道小型发射场',
      rocket: '通用中型运载火箭',
      payload: '高通量实验星 (9t)',
      mass_t: 9,
      reward_credits: 2000,
    });

    const res2 = settleSpaceOperations(state, [canyon9t, eq9t]);
    expect(res2.launchedIds).toEqual(['c-eq-9t']);
    expect(res2.heldIds).toContain('c-canyon-9t');
    const canyonContract = state.space.contracts.find(c => c.id === 'c-canyon-9t')!;
    expect(canyonContract.weather_hold_reason).toContain('有效载荷超重');
    // 赤道回款 2000 × 1.20 = 2400
    expect(res2.creditsEarned).toBe(2400);
  });

  it('5. 可制造航天装备库存同步 (syncAeroEquipmentStock)、三色门入库与发射消耗/回收返库', () => {
    expect(BUILDABLE_AERO_EQUIPMENT_CATALOG).toHaveLength(14);

    // 通过 reconcileProduction 对账可制造航天装备，自动认领入 forces.equipment 与 space.equipment_stock
    const reconState = {
      queues: [
        {
          type: '生产' as const,
          item: '低轨高分光学侦察卫星载荷',
          base: '北坡基地',
          progress: 100,
          eta: '已完成',
          status: 'settling' as const,
          started_at: '',
          total_minutes: 2880,
          spent_minutes: 2880,
          qty: 2,
          qty_done: 2,
          cost_paid: true,
          min_days_lock: 0,
          hold: false,
        },
      ],
      forces: { equipment: { 标准运载火箭芯一级: 1, 通用捆绑式助推器: 2, 高空入轨真空芯二级: 1 } },
      space: { equipment_stock: {} },
    };
    const parsedProd = parseProductionDeclarations('<生产>\n- 低轨高分光学侦察卫星载荷: 2颗\n</生产>');
    const reconciled = reconcileProduction(reconState, parsedProd);
    expect(reconciled.next.forces?.equipment?.['低轨高分光学侦察卫星载荷']).toBe(2);
    expect(reconciled.next.space?.equipment_stock?.['低轨高分光学侦察卫星载荷']).toBe(2);

    // 同步至完整 Schema 状态并执行一次带回收的发射
    const state = Schema.parse({
      meta: { weather: '晴' },
      economy: { credits: 1000 },
      forces: reconciled.next.forces,
      bases: [
        {
          id: 'b1',
          name: '北坡基地',
          buildings: [{ name: '航天发射中心', state: '运转' }],
        },
      ],
    });

    const stockBefore = syncAeroEquipmentStock(state);
    expect(stockBefore).toEqual({
      标准运载火箭芯一级: 1,
      通用捆绑式助推器: 2,
      高空入轨真空芯二级: 1,
      低轨高分光学侦察卫星载荷: 2,
    });

    const launchRes = settleSpaceOperations(state, [
      SpaceContract.parse({
        id: 'sc-stock-01',
        title: '自产低轨光学侦察星发射',
        kind: 'recon',
        payload_source: 'domestic',
        payload: '低轨高分光学侦察卫星载荷',
        base: '北坡基地',
        reward_credits: 1500,
        recover_booster: true,
        status: 'in_orbit',
      }),
    ]);

    expect(launchRes.launchedIds).toEqual(['sc-stock-01']);
    // 自产卫星载荷消耗 1 颗（2 -> 1），真空芯二级消耗 1 枚（1 -> 0），芯一级与捆绑助推器因启用回收自动返库保持原数！
    expect(state.space.equipment_stock).toEqual({
      标准运载火箭芯一级: 1,
      通用捆绑式助推器: 2,
      高空入轨真空芯二级: 0,
      低轨高分光学侦察卫星载荷: 1,
    });
  });

  it('6. LLM 外部商业订单载荷入池 (pending) 与发射履约结算 (in_orbit / completed) 端到端闭环', () => {
    const baseline = Schema.parse({
      meta: { weather: '晴', day_count: 8 },
      economy: { credits: 5000 },
      exposure: { value: 0.5 },
      bases: [
        {
          id: 'base-eq',
          name: '文昌赤道发射基地',
          site_type: 'equatorial_coastal',
          weather: '晴',
          buildings: [{ name: '重型航天发射场', state: '运转' }],
        },
      ],
    });

    // 第 1 步：LLM 在剧情中通过 <航天合同> 下发外部商业委托（状态: pending），进入 commercial_orders 池待命，不自动抢跑发射
    const step1Raw = `
<航天合同>
- 类别: 发射中心
  基地: 文昌赤道发射基地
  名称: 文昌赤道重型发射场
  选址: equatorial_coastal
  等级: 2
  状态: 运转
- 编号: sc_comm_order_01
  名称: 远洋航运财团高通量通信星代发委托
  类型: commercial
  载荷来源: 商业订单
  委托方: 环太平洋航运联合会
  目标轨道: GEO
  载荷: 海事宽带通信卫星 (6.5t)
  报酬: 4000
  状态: pending
</航天合同>
`;
    const step1Res = parseMessageText(step1Raw, baseline);
    expect(step1Res.applied).toBe(true);
    expect(step1Res.data.space.launch_centers).toHaveLength(1);
    expect(step1Res.data.space.commercial_orders).toHaveLength(1);
    expect(step1Res.data.space.commercial_orders?.[0]).toMatchObject({
      id: 'sc_comm_order_01',
      name: '海事宽带通信卫星 (6.5t)',
      client: '环太平洋航运联合会',
      orbit: 'GEO',
      mass_t: 6.5,
      reward_credits: 4000,
      status: 'pending',
    });
    // 尚未发射，资金不变
    expect(step1Res.data.economy.credits).toBe(5000);

    // 第 2 步：玩家指派文昌赤道发射基地发射该商业订单，LLM 输出 状态: in_orbit
    const step2Raw = `
<航天合同>
- 编号: sc_comm_order_01
  名称: 远洋航运财团高通量通信星代发委托
  类型: commercial
  载荷来源: 商业订单
  委托方: 环太平洋航运联合会
  基地: 文昌赤道发射基地
  运载火箭: 重型低温无毒运载火箭
  目标轨道: GEO
  载荷: 海事宽带通信卫星 (6.5t)
  目标插槽: orb_geo_comm_1
  构件编号: asset.orb.geo_comm
  报酬: 4000
  回收助推器: 是
  状态: in_orbit
</航天合同>
`;
    const step2Res = parseMessageText(step2Raw, step1Res.data);
    expect(step2Res.applied).toBe(true);
    // 商业订单标记为 completed
    expect(step2Res.data.space.commercial_orders?.[0].status).toBe('completed');
    // 赤道滨海 payoutMult = 1.20 -> 4000 × 1.20 = 4800，总资金 5000 + 4800 = 9800
    expect(step2Res.data.economy.credits).toBe(9800);
    // 赤道滨海 exposureDelta = +0.12 -> 0.5 + 0.12 = 0.62
    expect(step2Res.data.exposure.value).toBe(0.62);
    // target_slot 自动点亮
    expect(step2Res.data.space.completed_slots?.['orb_geo_comm_1']).toBe('asset.orb.geo_comm');
    // 助推器回收 +1
    expect(step2Res.data.space.reusable_boosters).toBe(1);
    // 在轨资产登记
    expect(step2Res.data.space.orbital_assets).toHaveLength(1);
    expect(step2Res.data.space.orbital_assets[0]).toMatchObject({
      id: 'orb:sc_comm_order_01',
      orbit: 'GEO',
      slot_id: 'orb_geo_comm_1',
    });
  });

  it.each(['in_orbit', 'launching'] as const)(
    'F06-01: A完成后重放%s，再由B触发结算，A终态及副作用保持一次',
    replayStatus => {
      const state = Schema.parse({
        meta: { weather: '晴' },
        economy: { credits: 5000 },
        exposure: { value: 0.5 },
        bases: [{ id: 'b1', name: '北坡基地', buildings: [{ name: '航天发射中心', state: '运转' }] }],
        forces: { equipment: { 标准运载火箭芯一级: 1, 通用捆绑式助推器: 1, 高空入轨真空芯二级: 2 } },
      });
      const contractA = SpaceContract.parse({
        id: 'f06-a', title: '商业载荷A', base: '北坡基地',
        payload_source: 'commercial', reward_credits: 1000,
        recover_booster: true, status: 'in_orbit',
      });
      const first = settleSpaceOperations(state, [contractA]);
      expect(first).toMatchObject({ launchedIds: ['f06-a'], creditsEarned: 1000, boostersRecovered: 1 });
      expect(state.space.contracts[0].status).toBe('completed');
      expect(state.space.commercial_orders?.[0].status).toBe('completed');
      expect(state.economy.credits).toBe(6000);
      expect(state.space.reusable_boosters).toBe(1);
      expect(state.exposure.value).toBe(0.55);
      expect(state.forces.equipment['高空入轨真空芯二级']).toBe(1);
      const contractB = SpaceContract.parse({
        id: 'f06-b', title: '商业载荷B', base: '北坡基地',
        payload_source: 'commercial', status: 'pending',
      });

      // 下一楼重放A，再下一楼B入池；B保持待命，不贡献经济或库存变化。
      for (const incoming of [{ ...contractA, status: replayStatus }, contractB]) {
        const result = settleSpaceOperations(state, [incoming]);
        expect.soft(result).toMatchObject({ launchedIds: [], creditsEarned: 0, boostersRecovered: 0 });
        expect.soft(state.space.contracts[0].status).toBe('completed');
        expect.soft(state.space.commercial_orders?.[0].status).toBe('completed');
        expect.soft(state.economy.credits).toBe(6000);
        expect.soft(state.space.reusable_boosters).toBe(1);
        expect.soft(state.exposure.value).toBe(0.55);
        expect.soft(state.forces.equipment).toMatchObject({
          标准运载火箭芯一级: 1, 通用捆绑式助推器: 1, 高空入轨真空芯二级: 1,
        });
        expect.soft(state.space.equipment_stock).toEqual({
          标准运载火箭芯一级: 1, 通用捆绑式助推器: 1, 高空入轨真空芯二级: 1,
        });
        expect.soft(state.space.orbital_assets).toHaveLength(1);
      }
      expect(state.space.contracts[1].status).toBe('pending');
      expect(state.space.commercial_orders?.[1].status).toBe('pending');
    },
  );

  it.each([
    { baseRef: 'b1', status: '废弃', launched: false },
    { baseRef: '北坡基地', status: '废弃', launched: false },
    { baseRef: 'b1', status: '运转中', launched: true },
    { baseRef: '旧独立中心', status: null, launched: true },
  ])('F06-03: 中心关联$baseRef，基地$status，放行=$launched', ({ baseRef, status, launched }) => {
    const state = Schema.parse({
      meta: { weather: '晴' },
      economy: { credits: 5000 },
      exposure: { value: 0.5 },
      bases: status === null ? [] : [{
        id: 'b1', name: '北坡基地', status,
        buildings: [{ name: '航天发射中心', state: '运转' }],
      }],
      forces: { equipment: { 高空入轨真空芯二级: 2 } },
      space: { launch_centers: [{ id: 'lc1', name: '北坡发射中心', base: baseRef, status: '运转' }] },
    });
    syncAeroEquipmentStock(state);
    const result = settleSpaceOperations(state, [SpaceContract.parse({
      id: 'f06-03', title: '基地准入验证', base: baseRef, launch_center_id: 'lc1',
      reward_credits: 1000, recover_booster: true, status: 'in_orbit',
    })]);
    expect(result).toMatchObject({
      launchedIds: launched ? ['f06-03'] : [],
      heldIds: launched ? [] : ['f06-03'],
      creditsEarned: launched ? 1000 : 0,
      boostersRecovered: launched ? 1 : 0,
    });
    expect(state.space.contracts[0].status).toBe(launched ? 'completed' : 'pending');
    expect(state.space.contracts[0].weather_hold_reason).toBe(launched ? undefined : '缺少运转态航天发射中心');
    expect(state.economy.credits).toBe(launched ? 6000 : 5000);
    expect(state.exposure.value).toBe(launched ? 0.55 : 0.5);
    expect(state.space.reusable_boosters).toBe(launched ? 1 : 0);
    expect(state.forces.equipment['高空入轨真空芯二级']).toBe(launched ? 1 : 2);
    expect(state.space.equipment_stock).toEqual({ 高空入轨真空芯二级: launched ? 1 : 2 });
    expect(state.space.orbital_assets).toHaveLength(launched ? 1 : 0);
  });

  it('F06-02: 自产合同目标轨道持久化到存档、重载与同ID跨存档隔离，旧档无orbit仍兼容推断', () => {
    const stateA = Schema.parse({
      meta: { weather: '暴风雪' },
      bases: [{ id: 'b1', name: '北坡基地', buildings: [{ name: '航天发射中心', state: '运转' }] }],
      forces: { equipment: { 远征上面级: 1 } },
    });
    const parsedGeo = extractSpaceContracts(`
<航天合同>
- 编号: sc-shared-01
  名称: 苍穹专项任务
  载荷来源: 自产需求
  载荷: 特种中继单元
  目标轨道: GEO
  基地: 北坡基地
  状态: in_orbit
</航天合同>`);
    expect(parsedGeo[0].orbit).toBe('GEO');
    expect(settleSpaceOperations(stateA, parsedGeo).heldIds).toEqual(['sc-shared-01']);

    // 另一份存档使用相同合同 ID 但不传轨道字段，验证不会被前次解析的 GEO 污染，且不会反向篡改存档 A
    const stateB = Schema.parse({
      meta: { weather: '晴' },
      bases: [{ id: 'b1', name: '北坡基地', buildings: [{ name: '航天发射中心', state: '运转' }] }],
    });
    const parsedNoOrbit = extractSpaceContracts(`
<航天合同>
- 编号: sc-shared-01
  名称: 苍穹专项任务
  载荷: 普通试验包裹
  基地: 北坡基地
  状态: in_orbit
</航天合同>`);
    settleSpaceOperations(stateB, parsedNoOrbit);
    expect(stateB.space.orbital_assets[0].orbit).toBe('LEO');

    // 存档 A 经 JSON + Schema.parse 模拟重载恢复后转晴发射，仍保持 GEO 并按 GEO 扣减远征上面级
    const reloadedA = Schema.parse(JSON.parse(JSON.stringify(stateA)));
    expect(reloadedA.space.contracts[0].orbit).toBe('GEO');
    reloadedA.meta.weather = '晴';
    expect(settleSpaceOperations(reloadedA).launchedIds).toEqual(['sc-shared-01']);
    expect(reloadedA.space.orbital_assets[0].orbit).toBe('GEO');
    expect(reloadedA.space.equipment_stock?.['远征上面级']).toBe(0);

    // 旧档无 orbit 字段仍按既有 slot/title 规则推断兼容
    const legacyState = Schema.parse({
      meta: { weather: '晴' },
      bases: [{ id: 'b1', name: '北坡基地', buildings: [{ name: '航天发射中心', state: '运转' }] }],
      space: {
        contracts: [
          {
            id: 'legacy-sso',
            title: '晨昏巡天一号',
            kind: 'recon',
            rocket: '通用中型运载火箭',
            payload: '光学遥感载荷',
            base: '北坡基地',
            reward_credits: 500,
            recover_booster: false,
            status: 'in_orbit',
          },
        ],
      },
    });
    settleSpaceOperations(legacyState);
    expect(legacyState.space.orbital_assets[0].orbit).toBe('SSO');
  });
});
