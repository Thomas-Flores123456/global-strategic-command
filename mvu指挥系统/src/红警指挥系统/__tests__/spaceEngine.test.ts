import { describe, expect, it } from 'vitest';
import { extractSpaceContracts as extractFromPipeline, parseMessageText } from '../parse/parsePipeline';
import { OrbitalAsset, Schema, SpaceContract, SpaceSlice } from '../core/schema';
import {
  hasOperationalLaunchpad as hasPadFromSettle,
  isLaunchWeatherPermitted as isWeatherFromSettle,
  settleFloor,
  settleSpaceOperations as settleFromSettle,
} from '../engines/settleFloor';
import {
  extractSpaceContracts,
  hasOperationalLaunchpad,
  isLaunchWeatherPermitted,
  settleSpaceOperations,
} from '../engines/spaceEngine';

describe('SPACE-CORE-01: 天基航天 Schema 与 spaceEngine 核心结算', () => {
  it('历史存档 Schema.safeParse({}) 100% 兼容并默认生成 space 切片', () => {
    const res = Schema.safeParse({});
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.space).toEqual({
      orbital_assets: [],
      contracts: [],
      reusable_boosters: 0,
    });

    const asset = OrbitalAsset.parse({ id: 'orb:1', name: '天眼一号' });
    expect(asset.kind).toBe('commercial');
    expect(asset.orbit).toBe('LEO');
    expect(asset.status).toBe('active');
    expect(asset.launched_at_day).toBe(1);

    const contract = SpaceContract.parse({ id: 'c-1', title: '首飞合同' });
    expect(contract.kind).toBe('commercial');
    expect(contract.rocket).toBe('通用中型运载火箭');
    expect(contract.payload).toBe('商业通信卫星');
    expect(contract.status).toBe('pending');
    expect(SpaceSlice.parse({})).toEqual({
      orbital_assets: [],
      contracts: [],
      reusable_boosters: 0,
    });
  });

  it('extractSpaceContracts 支持中英文键值与多块/列表解析', () => {
    const raw = `
战报正文：今日签署两份发射合同。
<航天合同>
合同编号: SC-001
合同名称: 极光商业代发任务
类型: 商业代发
运载火箭: 朱雀三号可复用火箭
有效载荷: 极光宽带试验星
发射场: 1号基地
里程碑打款: 12,000
回收助推器: 是
状态: 待命
</航天合同>
<航天合同>
- id: SC-002
  title: 苍穹军用合成孔径侦察星
  kind: 军用侦察
  rocket: 长征九号重型
  payload: 苍穹SAR-01
  base: base-1
  reward_credits: 25000
  recover_booster: false
- id: SC-003
  title: 银河低轨组网一期
  kind: 星座
  payload: 银河组网星群A组
  reward_credits: 18000
  recover_booster: true
</航天合同>
`;
    const contracts = extractSpaceContracts(raw);
    expect(contracts).toHaveLength(3);
    expect(contracts[0]).toMatchObject({
      id: 'SC-001',
      title: '极光商业代发任务',
      kind: 'commercial',
      rocket: '朱雀三号可复用火箭',
      payload: '极光宽带试验星',
      base: '1号基地',
      reward_credits: 12000,
      recover_booster: true,
      status: 'pending',
    });
    expect(contracts[1]).toMatchObject({
      id: 'SC-002',
      kind: 'recon',
      reward_credits: 25000,
      recover_booster: false,
    });
    expect(contracts[2]).toMatchObject({
      id: 'SC-003',
      kind: 'constellation',
      reward_credits: 18000,
      recover_booster: true,
    });
  });

  it('发射场门控与恶劣天气（暴风雪）窗口挂起 vs 晴朗天气/全天候科技放行', () => {
    const state = Schema.parse({
      meta: { weather: '暴风雪', day_count: 5 },
      economy: { credits: 10000 },
      bases: [
        {
          id: 'base-alpha',
          name: '一号基地',
          status: '隐蔽中',
          buildings: [{ name: '建造厂', state: '运转' }],
        },
      ],
    });

    const contract: SpaceContract = SpaceContract.parse({
      id: 'SC-101',
      title: '天基侦察发射',
      kind: 'recon',
      payload: '鹰眼光学卫星',
      base: '一号基地',
      reward_credits: 20000,
      recover_booster: true,
    });

    // 1. 无发射场 -> 挂起，原因为缺少运转态航天发射中心
    expect(hasOperationalLaunchpad(state, '一号基地')).toBe(false);
    const resNoPad = settleSpaceOperations(state, [contract]);
    expect(resNoPad.launchedIds).toEqual([]);
    expect(resNoPad.heldIds).toEqual(['SC-101']);
    expect(state.space.contracts[0].status).toBe('pending');
    expect(state.space.contracts[0].weather_hold_reason).toBe('缺少运转态航天发射中心');

    // 2. 新增运转态航天发射中心，但天气为暴风雪且无全天候科技 -> 气象窗口挂起
    state.bases[0].buildings.push({
      name: '航天发射中心',
      layer: '地表层',
      state: '运转',
    });
    expect(hasOperationalLaunchpad(state, '一号基地')).toBe(true);
    expect(isLaunchWeatherPermitted('暴风雪', false)).toEqual({
      permitted: false,
      reason: '气象窗口关闭（当前天气：暴风雪）',
    });

    const resBadWeather = settleSpaceOperations(state);
    expect(resBadWeather.launchedIds).toEqual([]);
    expect(resBadWeather.heldIds).toEqual(['SC-101']);
    expect(state.space.contracts[0].status).toBe('pending');
    expect(state.space.contracts[0].weather_hold_reason).toBe('气象窗口关闭（当前天气：暴风雪）');

    // 3. 解锁全天候天基发射控制学 -> 即使暴风雪也放行发射！
    state.tech.done.push('全天候天基发射控制学');
    expect(isLaunchWeatherPermitted('暴风雪', true)).toEqual({
      permitted: true,
      reason: null,
    });

    const resTechLaunch = settleSpaceOperations(state);
    expect(resTechLaunch.launchedIds).toEqual(['SC-101']);
    expect(resTechLaunch.heldIds).toEqual([]);
    expect(resTechLaunch.creditsEarned).toBe(20000);
    expect(resTechLaunch.boostersRecovered).toBe(1);
    expect(state.economy.credits).toBe(30000);
    expect(state.space.reusable_boosters).toBe(1);
    expect(state.space.contracts[0].status).toBe('completed');
    expect(state.space.contracts[0].weather_hold_reason).toBeUndefined();
    expect(state.space.orbital_assets).toHaveLength(1);
    expect(state.space.orbital_assets[0]).toMatchObject({
      id: 'orb:SC-101',
      name: '鹰眼光学卫星',
      kind: 'recon',
      orbit: 'LEO',
      status: 'active',
      launched_at_day: 5,
    });
  });

  it('测试一级助推器复用折扣奖励、星座转 comm 载荷及 parsePipeline 端到端接线', () => {
    expect(extractFromPipeline).toBe(extractSpaceContracts);
    expect(settleFromSettle).toBe(settleSpaceOperations);
    expect(isWeatherFromSettle).toBe(isLaunchWeatherPermitted);
    expect(hasPadFromSettle).toBe(hasOperationalLaunchpad);

    const baseline = Schema.parse({
      meta: { weather: '晴朗', day_count: 12 },
      economy: { credits: 5000 },
      bases: [
        {
          id: 'base-1',
          name: '文昌海滨基地',
          status: '隐蔽中',
          buildings: [{ name: '商业航天发射工位', layer: '地表层', state: '运转' }],
        },
      ],
      space: {
        orbital_assets: [],
        contracts: [],
        reusable_boosters: 1,
      },
    });

    const contract = SpaceContract.parse({
      id: 'SC-201',
      title: '赤星低轨通信星座组网',
      kind: 'constellation',
      payload: '赤星链路星座组A',
      base: '文昌海滨基地',
      reward_credits: 10000,
      recover_booster: true,
    });

    // 启用助推器复用折扣（+15% = +1500），先扣 1 枚再因 recover_booster 回收 1 枚
    const res = settleSpaceOperations(baseline, [contract], { consumeBoosterForDiscount: true });
    expect(res.launchedIds).toEqual(['SC-201']);
    expect(res.boostersReused).toBe(1);
    expect(res.boostersRecovered).toBe(1);
    expect(res.creditsEarned).toBe(11500);
    expect(baseline.economy.credits).toBe(16500);
    expect(baseline.space.reusable_boosters).toBe(1);
    expect(baseline.space.orbital_assets[0]).toMatchObject({
      id: 'orb:SC-201',
      name: '赤星链路星座组A',
      kind: 'comm',
      launched_at_day: 12,
    });

    // 测试 parseMessageText 自动识别 <航天合同> 并完成结算
    const parseRes = parseMessageText(
      `
<航天合同>
id: SC-202
名称: 凌霄空间站核心舱发射
类型: 空间站
载荷: 凌霄天和核心舱
基地: 文昌海滨基地
合同款: 40000
回收助推器: 否
</航天合同>
`,
      baseline,
    );
    expect(parseRes.applied).toBe(true);
    expect(parseRes.data.economy.credits).toBe(56500);
    expect(parseRes.data.space.orbital_assets).toHaveLength(2);
    expect(parseRes.data.space.orbital_assets[1]).toMatchObject({
      id: 'orb:SC-202',
      name: '凌霄天和核心舱',
      kind: 'station',
    });
  });

  it('BUG-LIVE-11b: #40楼真实输入（类型: 自产发射/商业发射）正确归一 kind 与 payload_source，且雷暴天气挂起', () => {
    const contracts = extractSpaceContracts(`
<航天合同>
- 编号: sc_geo_01
  名称: 苍穹二号战略中继星发射任务
  类型: 自产发射
  目标轨道: GEO
  运载火箭: 猎鹰9号运载火箭
  载荷: 战略通信卫星
  基地: 恶土前哨主基地
  发射中心: lc_main_01
  状态: 待发射
  备注: 地球同步轨道高轨部署
- 编号: sc_comm_01
  名称: 泛欧商业气象星代发合同
  类型: 商业发射
  目标轨道: SSO
  运载火箭: 猎鹰9号运载火箭
  载荷: 商业遥感卫星
  基地: 恶土前哨主基地
  发射中心: lc_main_01
  报酬: 25000
  状态: 已完成
  备注: 商业载荷顺利入轨交割
</航天合同>
`);

    expect(contracts).toHaveLength(2);
    expect(contracts[0]).toMatchObject({
      id: 'sc_geo_01',
      title: '苍穹二号战略中继星发射任务',
      kind: 'comm',
      payload_source: 'domestic',
      orbit: 'GEO',
      status: 'pending',
    });
    expect(contracts[1]).toMatchObject({
      id: 'sc_comm_01',
      title: '泛欧商业气象星代发合同',
      kind: 'commercial',
      payload_source: 'commercial',
      orbit: 'SSO',
      status: 'completed',
    });

    const state = Schema.parse({
      meta: { weather: '雷暴', day_count: 40 },
      bases: [
        {
          id: 'b_main',
          name: '恶土前哨主基地',
          buildings: [{ name: '航天发射中心', state: '运转' }],
        },
      ],
    });
    const res = settleSpaceOperations(state, [contracts[0]]);
    expect(res.launchedIds).toEqual([]);
    expect(res.heldIds).toEqual(['sc_geo_01']);
    expect(state.space.contracts[0]).toMatchObject({
      id: 'sc_geo_01',
      kind: 'comm',
      payload_source: 'domestic',
      orbit: 'GEO',
      status: 'pending',
      weather_hold_reason: '气象窗口关闭（当前天气：雷暴）',
    });
  });

  it('BUG-LIVE-26b（#76楼实机复现）：支持顶层 <航天> 标签与 商业合同 子键、总天数/已执行天数/状态:执行中，并在下一楼推进天数后自动完结发放报酬与入轨资产', () => {
    const state74 = Schema.parse({
      meta: { weather: '晴', day_count: 30 },
      economy: { credits: 100000 },
      bases: [
        {
          id: '恶土前哨主基地',
          name: '恶土前哨主基地',
          buildings: [{ name: '航天发射中心', state: '运转' }],
        },
      ],
    });

    const raw76 = `
<timePast>1 D 0 H 0 M</timePast>
<航天>
商业合同:
  - id: sc_recon_76
    名称: 荒坂前线合成孔径雷达普查
    类型: 气象遥感
    载荷: 极轨SAR雷达星
    报酬: 18000
    总天数: 2
    已执行天数: 0
    状态: 执行中
</航天>
`;
    const parsed76 = parseMessageText(raw76, state74);
    expect(parsed76.quarantine).toHaveLength(0);
    expect(parsed76.data.space.contracts).toHaveLength(1);
    expect(parsed76.data.space.contracts[0]).toMatchObject({
      id: 'sc_recon_76',
      title: '荒坂前线合成孔径雷达普查',
      kind: 'recon',
      payload: '极轨SAR雷达星',
      reward_credits: 18000,
      duration_days: 2,
      elapsed_days: 0,
      status: 'in_progress',
    });
    // #76 楼刚立项（0/2天），尚未完结回款
    expect(parsed76.data.economy.credits).toBe(100000);

    // 下一楼（#78 楼）推进 2 天 -> S2g_SPACE 自动推进 elapsed_days 至 2/2 天并完结发放 18000 报酬、登记在轨资产
    const settled78 = settleFloor(
      parsed76.data,
      structuredClone(parsed76.data),
      '<timePast>2 D 0 H 0 M</timePast>',
    );
    expect(settled78.data.space.contracts[0]).toMatchObject({
      id: 'sc_recon_76',
      status: 'completed',
      duration_days: 2,
      elapsed_days: 2,
    });
    expect(settled78.data.economy.credits).toBe(118000);
    expect(settled78.data.space.orbital_assets).toContainEqual(
      expect.objectContaining({
        id: 'orb:sc_recon_76',
        name: '极轨SAR雷达星',
        kind: 'recon',
        orbit: 'SSO',
      }),
    );
  });

  it('BUG-R2-18（#34~#38楼实机复现）：识别 大型航天发射综合体(运转)、发射基地/复用助推器/气象挂起原因别名、<航天> 星座子块，以及显式成功/挂起/失败状态结算', () => {
    const floor33State = Schema.parse({
      meta: { weather: '晴', day_count: 18 },
      economy: { credits: 20000 },
      bases: [
        {
          id: '恶土前哨主基地',
          name: '恶土前哨主基地',
          buildings: [{ name: '大型航天发射综合体', state: '运转' }],
        },
      ],
      space: {
        reusable_boosters: 0,
        orbital_assets: [],
        contracts: [],
      },
    });

    expect(hasOperationalLaunchpad(floor33State, '恶土前哨主基地')).toBe(true);

    const rawFloor34 = `<航天>
合同:
  - 编号: SC-01
    名称: 恶土鹰眼一号低轨侦察发射合同
    类型: 侦察卫星
    载荷: 恶土鹰眼一号
    轨道: LEO
    委托方: 恶土前哨联合作战部
    报酬: 5000
    状态: 成功
    回收助推器: 是
    发射基地: 恶土前哨主基地
  - 编号: SC-02
    名称: 赤道信标一号高轨通信发射合同
    类型: 商业载荷
    载荷: 赤道信标一号
    轨道: GEO
    委托方: 泛大陆重工通讯财团
    报酬: 8000
    状态: 挂起
    气象挂起原因: 强雷暴天气与高空切变风超标，发射窗口强制锁死
    回收助推器: 否
    复用助推器: 是
    发射基地: 恶土前哨主基地
星座:
  - 名称: 恶土鹰眼一号
    类型: 侦察卫星
    轨道: LEO
    状态: 在轨运转
    加成: 全图视野侦察半径+15%，敌军集结预警提前12小时
</航天>`;

    const parsed34 = parseMessageText(rawFloor34, floor33State);
    expect(parsed34.quarantine).toEqual([]);
    expect(parsed34.applied).toBe(true);

    const sc01 = parsed34.data.space.contracts.find(c => c.id === 'SC-01')!;
    const sc02 = parsed34.data.space.contracts.find(c => c.id === 'SC-02') as typeof sc01 & {
      use_stored_booster?: boolean;
    };
    expect(sc01).toMatchObject({
      id: 'SC-01',
      base: '恶土前哨主基地',
      status: 'completed',
      reward_credits: 5000,
      recover_booster: true,
    });
    expect(sc01.weather_hold_reason).toBeUndefined();

    expect(sc02).toMatchObject({
      id: 'SC-02',
      base: '恶土前哨主基地',
      status: 'pending',
      reward_credits: 8000,
      recover_booster: false,
      use_stored_booster: true,
      weather_hold_reason: '强雷暴天气与高空切变风超标，发射窗口强制锁死',
    });

    // SC-01 成功交割：+5000 报酬，回收助推器 +1；SC-02 挂起不发射
    expect(parsed34.data.economy.credits).toBe(25000);
    expect(parsed34.data.space.reusable_boosters).toBe(1);

    // 星座子块已合并入 space.orbital_assets 并保留自定义加成描述
    expect(parsed34.data.space.orbital_assets).toHaveLength(1);
    expect(parsed34.data.space.orbital_assets[0]).toMatchObject({
      name: '恶土鹰眼一号',
      kind: 'recon',
      orbit: 'LEO',
      status: 'active',
      bonus_desc: '全图视野侦察半径+15%，敌军集结预警提前12小时',
    });

    // #38 楼 Swipe 0：SC-02 窗口打开并显式声明 状态: 成功 + 复用助推器: 是
    const rawFloor38Swipe0 = `<航天>
合同:
  - 编号: SC-02
    名称: 赤道信标一号高轨通信发射合同
    类型: 商业载荷
    载荷: 赤道信标一号
    轨道: GEO
    报酬: 8000
    状态: 成功
    回收助推器: 否
    复用助推器: 是
    发射基地: 恶土前哨主基地
</航天>`;
    const parsed38Success = parseMessageText(rawFloor38Swipe0, parsed34.data);
    const sc02Success = parsed38Success.data.space.contracts.find(c => c.id === 'SC-02')!;
    expect(sc02Success.status).toBe('completed');
    expect(sc02Success.weather_hold_reason).toBeUndefined();
    // 扣减 1 枚库存助推器（1 -> 0），按 8000 * 1.15 = 9200 结算回款（25000 + 9200 = 34200），且 SC-01 不重复结算
    expect(parsed38Success.data.space.reusable_boosters).toBe(0);
    expect(parsed38Success.data.economy.credits).toBe(34200);
    expect(parsed38Success.data.space.orbital_assets.some(a => a.name === '赤道信标一号')).toBe(true);

    // #38 楼 Swipe 1：SC-02 显式声明 状态: 失败 + 事故原因
    const rawFloor38Swipe1 = `<航天>
合同:
  - 编号: SC-02
    名称: 赤道信标一号高轨通信发射合同
    类型: 商业载荷
    载荷: 赤道信标一号
    轨道: GEO
    报酬: 8000
    状态: 失败
    事故原因: 二级发动机涡轮泵高空解体，遥测信号中断
    回收助推器: 否
    复用助推器: 是
    发射基地: 恶土前哨主基地
</航天>`;
    const parsed38Failed = parseMessageText(rawFloor38Swipe1, parsed34.data);
    const sc02Failed = parsed38Failed.data.space.contracts.find(c => c.id === 'SC-02')!;
    expect(sc02Failed.status).toBe('failed');
    expect(sc02Failed.weather_hold_reason).toBe('二级发动机涡轮泵高空解体，遥测信号中断');
    // 失败不发报酬（保持 25000），不入轨，消耗 1 枚库存助推器（1 -> 0）
    expect(parsed38Failed.data.economy.credits).toBe(25000);
    expect(parsed38Failed.data.space.reusable_boosters).toBe(0);
    expect(parsed38Failed.data.space.orbital_assets.some(a => a.name === '赤道信标一号')).toBe(false);
  });
});

