import { describe, expect, it } from 'vitest';
import { Schema } from '../../红警指挥系统/core/schema';
import {
  ALL_WEATHER_LAUNCH_TECH,
  extractSpaceContracts,
  settleSpaceOperations,
} from '../../红警指挥系统/engines/spaceEngine';
import {
  AERO_MANUFACTURING_BUILDING_SPECS,
  AEROSPACE_MCC_SCENE_ID,
  DEFAULT_PAYLOAD_PRESETS,
  DEFAULT_ROCKET_OPTIONS,
  SPACE_CONTRACT_KIND_OPTIONS,
  SPACE_SITE_TYPE_META,
  buildAeroBuildingConstructCommand,
  buildAeroEquipmentProduceCommand,
  buildAerospaceMccCatalogDef,
  buildAerospaceMccSyntheticProject,
  buildExistingContractLaunchOrderText,
  buildLaunchContractCommandText,
  buildOrbitalAssetCards,
  buildSpaceContractOrderText,
  computeContractPayoutPreview,
  deriveAeroManufacturingView,
  deriveSpaceLaunchCentersView,
  deriveSpacePayloadSources,
  diagnoseLaunchReadiness,
} from '../models/spacePanelModel';
import {
  SHORT_CATEGORY_FILTERS,
  buildEngineeringGateChecklist,
  filterShortCatalogDefs,
  resolveCatalogItemBadge,
  resolveRetrofitCategory,
  resolveRetrofitTargetPreview,
} from '../modals/modalEngineeringHelpers';

describe('PKG-B · spacePanelModel 天基航天测控与合同拟定纯函数模型', () => {
  it('buildAerospaceMccCatalogDef 与 buildAerospaceMccSyntheticProject 生成 5 热点阶段合成工程', () => {
    const def = buildAerospaceMccCatalogDef();
    expect(def.scene).toBe(AEROSPACE_MCC_SCENE_ID);
    expect(def.grade).toBe('巨构');
    expect(def.scope).toBe('theater');

    const emptyProj = buildAerospaceMccSyntheticProject(null);
    expect(emptyProj.schema_version).toBe(1);
    if (emptyProj.schema_version === 1) {
      expect(emptyProj.phases).toHaveLength(5);
      expect(emptyProj.phases.every(p => p.status === '未启动')).toBe(true);
    }

    const activeSnap = Schema.parse({
      bases: [{ id: 'b1', name: '文昌发射场', buildings: [{ name: '航天发射中心', state: '运转' }] }],
      space: {
        reusable_boosters: 2,
        orbital_assets: [
          { id: 'orb:1', name: '高分侦察一号', kind: 'recon', orbit: 'LEO', status: 'active', launched_at_day: 3 },
          { id: 'orb:2', name: '天宫核心舱', kind: 'station', orbit: 'LEO', status: 'active', launched_at_day: 5 },
        ],
        contracts: [
          {
            id: 'sc-01',
            title: '商业星座组网',
            kind: 'constellation',
            rocket: DEFAULT_ROCKET_OPTIONS[0],
            payload: DEFAULT_PAYLOAD_PRESETS.constellation[0],
            base: '文昌发射场',
            reward_credits: 2400,
            recover_booster: true,
            status: 'completed',
          },
        ],
      },
    });
    const activeProj = buildAerospaceMccSyntheticProject(activeSnap);
    expect(activeProj.status).toBe('在建');
    if (activeProj.schema_version === 1) {
      expect(activeProj.phases[0].status).toBe('完工');
      expect(activeProj.phases[1].status).toBe('完工');
      expect(activeProj.phases[2].status).toBe('完工');
      expect(activeProj.phases[3].status).toBe('完工');
      expect(activeProj.phases[4].status).toBe('完工');
    }
  });

  it('diagnoseLaunchReadiness 准确区分无发射场(blocked)、恶劣天气(warn)与窗口良好(ready)', () => {
    const blocked = diagnoseLaunchReadiness(Schema.parse({ bases: [] }));
    expect(blocked.bannerTone).toBe('blocked');
    expect(blocked.overallReady).toBe(false);
    expect(blocked.bannerText).toContain('尚未建成运转态「航天发射中心」');

    const warnSnap = Schema.parse({
      meta: { weather: '强台风' },
      bases: [{ id: 'b1', name: '海滨发射场', buildings: [{ name: '航天发射中心', state: '运转' }] }],
    });
    const warn = diagnoseLaunchReadiness(warnSnap);
    expect(warn.launchpadReady).toBe(true);
    expect(warn.weatherPermitted).toBe(false);
    expect(warn.bannerTone).toBe('warn');
    expect(warn.bannerText).toContain('气象窗口关闭（当前天气：强台风）');

    const allWeatherSnap = Schema.parse({
      meta: { weather: '雷暴' },
      tech: { done: [ALL_WEATHER_LAUNCH_TECH] },
      bases: [{ id: 'b1', name: '海滨发射场', buildings: [{ name: '重型航天发射场', state: '运转' }] }],
    });
    const ready = diagnoseLaunchReadiness(allWeatherSnap);
    expect(ready.overallReady).toBe(true);
    expect(ready.bannerTone).toBe('ready');
    expect(ready.bannerText).toContain('发射窗口良好 · 发射场运转正常');
  });

  it('buildOrbitalAssetCards 映射中文类型与状态标签', () => {
    const snap = Schema.parse({
      space: {
        orbital_assets: [
          { id: 'orb:r1', name: '鹰眼一号', kind: 'recon', orbit: 'SSO', status: 'active', launched_at_day: 2 },
          { id: 'orb:c1', name: '中继二号', kind: 'comm', orbit: 'GEO', status: 'degraded', launched_at_day: 4 },
          { id: 'orb:w1', name: '天锤载荷', kind: 'weapon', orbit: 'LEO', status: 'deorbited', launched_at_day: 6 },
        ],
      },
    });
    const cards = buildOrbitalAssetCards(snap);
    expect(cards).toHaveLength(3);
    expect(cards[0]).toMatchObject({ kindLabel: '天基侦察', statusLabel: '在轨正常', orbit: 'SSO' });
    expect(cards[1]).toMatchObject({ kindLabel: '通信中继', statusLabel: '受损待修', orbit: 'GEO' });
    expect(cards[2]).toMatchObject({ kindLabel: '天基威慑', statusLabel: '已离轨', orbit: 'LEO' });
  });

  it('computeContractPayoutPreview 与合同指令拼装可被 extractSpaceContracts 往返解析', () => {
    expect(SPACE_CONTRACT_KIND_OPTIONS).toHaveLength(5);
    const previewNoBooster = computeContractPayoutPreview(2000, true, 0);
    expect(previewNoBooster).toEqual({
      baseReward: 2000,
      boosterApplied: false,
      reuseBonus: 0,
      totalPayout: 2000,
    });

    const previewWithBooster = computeContractPayoutPreview(2000, true, 2);
    expect(previewWithBooster).toEqual({
      baseReward: 2000,
      boosterApplied: true,
      reuseBonus: 300,
      totalPayout: 2300,
    });

    const orderText = buildSpaceContractOrderText({
      id: 'sc-recon-01',
      title: '鹰眼侦察星发射合同',
      kind: 'recon',
      rocket: '重型低温无毒运载火箭',
      payload: '高分光学合成孔径侦察卫星',
      base: '北坡主基地',
      rewardCredits: 1800,
      recoverBooster: true,
      useStoredBooster: true,
    });
    expect(orderText).toContain('【天基航天指令】拟定并签发发射合同「鹰眼侦察星发射合同」');
    const parsed = extractSpaceContracts(orderText);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: 'sc-recon-01',
      title: '鹰眼侦察星发射合同',
      kind: 'recon',
      rocket: '重型低温无毒运载火箭',
      payload: '高分光学合成孔径侦察卫星',
      base: '北坡主基地',
      reward_credits: 1800,
      recover_booster: true,
      status: 'pending',
    });

    const launchText = buildExistingContractLaunchOrderText(parsed[0], true);
    expect(launchText).toContain('【天基航天指令】点火执行发射合同「鹰眼侦察星发射合同」');
    expect(extractSpaceContracts(launchText)).toHaveLength(1);
  });

  it('modalEngineeringHelpers 兵种分类、状态尾标、在役计数与三门核验清单工作正常', () => {
    expect(SHORT_CATEGORY_FILTERS.map(c => c.key)).toEqual(['all', 'land', 'air', 'naval', 'facility']);

    const landDef = {
      kind: 'retrofit' as const,
      name: 'M1A2 SEPv3灰熊混动改装工程',
      research: 'M1A2 SEPv3灰熊混动改装包',
      grade: '大改' as const,
      desc: '灰熊主战坦克混动升级。',
    };
    const airDef = {
      kind: 'retrofit' as const,
      name: 'F-16V战隼航电武器升级工程',
      research: 'F-16V战隼航电武器升级包',
      grade: '中改' as const,
      desc: '战隼航电升级。',
    };
    const navalDef = {
      kind: 'retrofit' as const,
      name: 'DDG-51阿利·伯克级SPY-6升级工程',
      research: 'DDG-51阿利·伯克级SPY-6升级包',
      grade: '大改' as const,
      desc: '宙斯盾驱逐舰升级。',
    };
    const facilityDef = {
      kind: 'retrofit' as const,
      name: '爱国者阵地增强改装工程',
      research: '爱国者阵地增强改装',
      grade: '小改' as const,
      desc: '防空阵地升级。',
    };

    expect(resolveRetrofitCategory(landDef)).toBe('land');
    expect(resolveRetrofitCategory(airDef)).toBe('air');
    expect(resolveRetrofitCategory(navalDef)).toBe('naval');
    expect(resolveRetrofitCategory(facilityDef)).toBe('facility');

    const allDefs = [landDef, airDef, navalDef, facilityDef];
    expect(filterShortCatalogDefs(allDefs, 'all', '', 'air')).toEqual([airDef]);
    expect(filterShortCatalogDefs(allDefs, 'all', '', 'naval')).toEqual([navalDef]);
    expect(filterShortCatalogDefs(allDefs, 'all', '', 'facility')).toEqual([facilityDef]);

    const liveSnap = Schema.parse({
      meta: { world_id: 'w1' },
      economy: { credits: 5000 },
      tech: { done: ['M1A2 SEPv3灰熊混动改装包'] },
      forces: {
        troops: { M1A1灰熊主战坦克: 3 },
        vehicles: ['M1A1灰熊主战坦克×2'],
      },
      bases: [
        {
          id: 'beipo',
          name: '北坡主基地',
          buildings: [{ name: '爱国者防空阵地', state: '运转' }],
        },
      ],
    });

    const preview = resolveRetrofitTargetPreview(landDef, liveSnap);
    expect(preview).toMatchObject({
      targetLabel: 'M1A1灰熊主战坦克',
      upgradedLabel: 'M1A2 SEPv3混动灰熊主战坦克',
      isBuildingRetrofit: false,
      inServiceCount: 5,
    });

    expect(resolveCatalogItemBadge(landDef, [], true, liveSnap.tech.done)).toEqual({
      text: '可立项',
      tone: 'ready',
    });
    expect(resolveCatalogItemBadge(airDef, [], true, liveSnap.tech.done)).toEqual({
      text: '缺理论',
      tone: 'locked',
    });
    expect(resolveCatalogItemBadge(landDef, [], false)).toEqual({
      text: '待命',
      tone: 'neutral',
    });

    const checklist = buildEngineeringGateChecklist(
      { ...landDef, cost: 1200 },
      liveSnap,
      true,
      { enabled: true, base: '北坡主基地', hint: '' },
    );
    expect(checklist).toHaveLength(3);
    expect(checklist[0]).toMatchObject({ key: 'research', ok: true, statusText: '✓ 已掌握' });
    expect(checklist[1]).toMatchObject({ key: 'station', ok: true, statusText: '✓ 工位就绪' });
    expect(checklist[2]).toMatchObject({ key: 'budget', ok: true, statusText: '✓ 预算充足' });
  });

  it('FD-27 · deriveSpaceLaunchCentersView 派生天地月 6 大选址回款/运力乘数、基于首基地标准时的本地时间与局部气象窗口', () => {
    expect(Object.keys(SPACE_SITE_TYPE_META)).toHaveLength(6);

    const snap = Schema.parse({
      clock: { day: 3, time: '09:30' },
      meta: { weather: '晴' },
      bases: [
        {
          id: 'beipo',
          name: '北坡主基地',
          site_type: 'inland_canyon',
          tz_offset: 5, // 首基地恒锚定标准时 ±0h
          weather: '晴',
          buildings: [{ name: '重型航天发射场', state: '运转' }],
        },
        {
          id: 'wenchang',
          name: '东海滨海基地',
          site_type: 'equatorial_coastal',
          tz_offset: 2,
          weather: '强台风',
          buildings: [{ name: '航天发射中心', state: '运转' }],
        },
        {
          id: 'sea1',
          name: '远洋半潜平台',
          site_type: 'sea_platform',
          tz_offset: 4,
          weather: '多云',
          buildings: [{ name: '商业航天发射工位', state: '运转' }],
        },
      ],
      space: {
        launch_centers: [
          {
            id: 'lc-orbital',
            base: '天枢轨道船坞母港',
            name: '天枢深空轨道船坞',
            site_type: 'orbital_dock',
            tier: 3,
            status: '运转',
            mounted_slots: { lc_pad_1: 'asset.lc.pad_std' },
          },
          {
            id: 'lc-lunar',
            base: '沙克尔顿月球基地',
            name: '月面低重力发射中心',
            site_type: 'lunar_surface',
            tier: 3,
            status: '运转',
            mounted_slots: { lc_pad_1: 'asset.lc.pad_std' },
          },
        ],
      },
    });

    const centers = deriveSpaceLaunchCentersView(snap, 'LEO');
    expect(centers.length).toBeGreaterThanOrEqual(5);

    const beipo = centers.find(c => c.base === '北坡主基地')!;
    expect(beipo.siteType).toBe('inland_canyon');
    expect(beipo.tzOffset).toBe(0);
    expect(beipo.localTimeText).toBe('09:30');
    expect(beipo.tier).toBe(2);
    expect(beipo.weatherPermitted).toBe(true);
    expect(beipo.availableRockets).toContain('重型低温无毒运载火箭');

    const wenchang = centers.find(c => c.base === '东海滨海基地')!;
    expect(wenchang.siteType).toBe('equatorial_coastal');
    expect(wenchang.payoutMultiplier).toBe(1.2);
    expect(wenchang.payloadMultiplier).toBe(1.15);
    expect(wenchang.localTimeText).toBe('11:30');
    expect(wenchang.weatherPermitted).toBe(false); // 强台风挂起

    const sea = centers.find(c => c.base === '远洋半潜平台')!;
    expect(sea.siteType).toBe('sea_platform');
    expect(sea.maxTier).toBe(2);
    expect(sea.exposurePulse).toBe(0.03);

    const orbital = centers.find(c => c.id === 'lc-orbital')!;
    expect(orbital.siteType).toBe('orbital_dock');
    expect(orbital.payoutMultiplier).toBe(1.5);
    expect(orbital.payloadMultiplier).toBe(2.0);
    expect(orbital.localWeather).toBe('真空无气象');
    expect(orbital.weatherPermitted).toBe(true);
    expect(orbital.availableRockets).toContain('超级重型两级全复用运载系统');

    const lunar = centers.find(c => c.id === 'lc-lunar')!;
    expect(lunar.siteType).toBe('lunar_surface');
    expect(lunar.payoutMultiplier).toBe(1.35);
    expect(lunar.payloadMultiplier).toBe(1.5);
    expect(lunar.weatherPermitted).toBe(true);
  });

  it('FD-27 · deriveAeroManufacturingView 三大航天制造建筑与 4 大类 14 项装备在产/库存联动及一键排产指令', () => {
    expect(AERO_MANUFACTURING_BUILDING_SPECS.map(b => b.name)).toEqual([
      '火箭制造厂',
      '卫星制造中心',
      '大型航天器与舱段总装中心',
    ]);

    const snap = Schema.parse({
      bases: [
        {
          id: 'beipo',
          name: '北坡主基地',
          buildings: [
            { name: '火箭制造厂', state: '运转' },
            { name: '卫星制造中心', state: '运转' },
            { name: '大型航天器与舱段总装中心', state: '建造中' },
          ],
        },
      ],
      forces: {
        equipment: {
          海平面大推力液氧煤油发动机组: 4,
          标准运载火箭芯一级: 2,
        },
      },
      space: {
        equipment_stock: {
          低轨高分光学侦察卫星载荷: 3,
          天枢核心舱与空间站模块化舱段总成: 1,
        },
      },
      queues: [
        {
          type: '生产',
          item: '高轨红外预警与通信卫星载荷',
          qty: 2,
          qty_done: 0,
          base: '北坡主基地',
          progress: 50,
          status: 'active',
        },
      ],
    });

    const mfg = deriveAeroManufacturingView(snap, '北坡主基地');
    expect(mfg.buildings).toHaveLength(3);
    expect(mfg.buildings[0]).toMatchObject({ name: '火箭制造厂', operational: true, stateLabel: '运转中' });
    expect(mfg.buildings[1]).toMatchObject({ name: '卫星制造中心', operational: true, stateLabel: '运转中' });
    expect(mfg.buildings[2]).toMatchObject({
      name: '大型航天器与舱段总装中心',
      built: true,
      operational: false,
      stateLabel: '建造中',
    });

    expect(mfg.items).toHaveLength(14);
    expect(mfg.byGroup.engine).toHaveLength(3);
    expect(mfg.byGroup.stage).toHaveLength(4);
    expect(mfg.byGroup.satellite_payload).toHaveLength(4);
    expect(mfg.byGroup.spacecraft_payload).toHaveLength(3);
    expect(mfg.totalStockCount).toBe(4 + 2 + 3 + 1);
    expect(mfg.totalInProgressCount).toBe(2);

    const geoSat = mfg.items.find(i => i.id === 'common.unit.aero.geo_ew_comm_sat_payload')!;
    expect(geoSat.inProgressCount).toBe(2);
    expect(geoSat.progressPct).toBe(50);

    const prodCmd = buildAeroEquipmentProduceCommand('北坡主基地', '标准运载火箭芯一级', 2);
    expect(prodCmd).toContain('<排产计划>');
    expect(prodCmd).toContain('- 类别: 生产');
    expect(prodCmd).toContain('标的: 标准运载火箭芯一级');
    expect(prodCmd).toContain('承建建筑: 火箭制造厂');

    const bldCmd = buildAeroBuildingConstructCommand('北坡主基地', '卫星制造中心');
    expect(bldCmd).toContain('<排产计划>');
    expect(bldCmd).toContain('- 类别: 建造');
    expect(bldCmd).toContain('标的: 卫星制造中心');
  });

  it('FD-27 · deriveSpacePayloadSources 严守 D7-B 有效载荷双来源硬隔离铁律（无外部订单时 commercialOrders 严格为空数组）', () => {
    const emptySnap = Schema.parse({ bases: [] });
    const emptySources = deriveSpacePayloadSources(emptySnap);
    expect(emptySources.domesticPayloads).toHaveLength(7);
    expect(emptySources.domesticPayloads.every(p => p.source === 'domestic')).toBe(true);
    expect(emptySources.commercialOrders).toEqual([]);
    expect(emptySources.hasCommercialOrders).toBe(false);
    expect(emptySources.commercialEmptyHint).toContain('暂无外部商业委托载荷');

    const snapWithOrder = Schema.parse({
      space: {
        commercial_orders: [
          {
            id: 'comm-ord-01',
            name: '远洋海事宽带通信卫星',
            client: '环太平洋航运联合会',
            orbit: 'GEO',
            mass_t: 6.5,
            reward_credits: 4200,
            status: 'pending',
          },
        ],
      },
    });
    const activeSources = deriveSpacePayloadSources(snapWithOrder);
    expect(activeSources.hasCommercialOrders).toBe(true);
    expect(activeSources.commercialOrders).toHaveLength(1);
    expect(activeSources.commercialOrders[0]).toMatchObject({
      id: 'comm-ord-01',
      name: '远洋海事宽带通信卫星',
      source: 'commercial',
      client: '环太平洋航运联合会',
      orbit: 'GEO',
      massTons: 6.5,
      rewardCredits: 4200,
    });

    const extContractCmd = buildLaunchContractCommandText({
      id: 'sc-station-hab-01',
      title: '天基居住舱发射任务',
      kind: 'station',
      rocket: '重型低温无毒运载火箭',
      payload: '常驻乘员居住生活舱',
      base: '北坡主基地',
      rewardCredits: 3200,
      recoverBooster: true,
      launchCenterId: 'lc:beipo',
      payloadSource: 'domestic',
      massTons: 18,
      orbitTarget: 'LEO',
      targetSlot: 'st_port_hab',
      assetId: 'asset.st.hab',
      scope: 'base',
      targetBase: '北坡主基地',
    });
    expect(extContractCmd).toContain('launch_center_id: lc:beipo');
    expect(extContractCmd).toContain('payload_source: domestic');
    expect(extContractCmd).toContain('target_slot: st_port_hab');
    expect(extContractCmd).toContain('asset_id: asset.st.hab');
    expect(extContractCmd).toContain('target_base: 北坡主基地');
  });

  it('BUG-R2-08：勾选 useStoredBooster 时 <航天合同> 输出 复用助推器: 是，且经 extractSpaceContracts + settleSpaceOperations 自动扣减助推器并享受 +15% 回款加成', () => {
    const orderText = buildSpaceContractOrderText({
      id: 'sc-reuse-booster-01',
      title: '低轨宽带通信星座组网发射',
      kind: 'comm',
      rocket: '中型可回收运载火箭',
      payload: '宽带通信卫星组',
      base: '1号基地',
      rewardCredits: 2000,
      recoverBooster: false,
      useStoredBooster: true,
    });
    expect(orderText).toContain('复用助推器: 是');

    const extracted = extractSpaceContracts(orderText);
    expect(extracted).toHaveLength(1);
    expect((extracted[0] as { use_stored_booster?: boolean }).use_stored_booster).toBe(true);

    const state = Schema.parse({
      economy: { credits: 1000, credits_daily: 0, wallet: {}, chains: [] },
      bases: [
        {
          id: 'b1',
          name: '1号基地',
          status: '运转中',
          buildings: [{ name: '航天发射中心', state: '运转' }],
        },
      ],
      space: {
        launch_pads: 1,
        reusable_boosters: 2,
        contracts: [],
        orbital_assets: [],
        lunar_outpost: { progress: 0, modules: 0, status: '未启动' },
      },
    });

    // 不传 options.consumeBoosterForDiscount，仅靠合同内声明的 复用助推器: 是 即可自动扣减 1 枚助推器并获得 +15% 奖金 (2000 + 300 = 2300)
    const res = settleSpaceOperations(state, extracted);
    expect(res.boostersReused).toBe(1);
    expect(state.space.reusable_boosters).toBe(1);
    expect(res.creditsEarned).toBe(2300);
    expect(state.economy.credits).toBe(3300);
  });
});
