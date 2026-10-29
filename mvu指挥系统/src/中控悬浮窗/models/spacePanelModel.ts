/**
 * spacePanelModel.ts —— 天基航天测控与发射大厅面板纯函数模型（PKG-B · D1-A / D2-A / D3-A）
 *
 * 职责：
 * 1. 提供天基测控与发射大厅默认场景目录项（buildAerospaceMccCatalogDef）与五阶段热点合成工程（buildAerospaceMccSyntheticProject）；
 * 2. 提供发射场与气象窗口三态门控诊断（diagnoseLaunchReadiness）；
 * 3. 提供在轨星座展示卡片派生（buildOrbitalAssetCards）；
 * 4. 提供发射合同拟定选项、助推器复用报酬预览与 `<航天合同>` 指令拼装纯函数。
 */

import type { ProjectDef } from '../../红警指挥系统/core/catalog';
import type {
  BaseSiteType,
  LaunchCenterRecord,
  OrbitalAsset,
  ProductionTask,
  Project,
  ProjectPhase,
  Schema,
  SpaceCommercialOrder,
  SpaceContract,
} from '../../红警指挥系统/core/schema';
import {
  ALL_WEATHER_LAUNCH_TECH,
  BUILDABLE_AERO_EQUIPMENT_CATALOG,
  LAUNCH_SITE_MODIFIERS,
  LAUNCHPAD_BUILDINGS,
  deriveLaunchCentersFromState,
  evaluateLaunchSiteModifiers,
  findBuildableAeroEquipmentSpec,
  hasOperationalLaunchpad,
  isLaunchWeatherPermitted,
  normalizeSiteType,
  type BuildableAeroEquipmentSpec,
} from '../../红警指挥系统/engines/spaceEngine';

export const AEROSPACE_MCC_SCENE_ID = 'scene.aerospace.mcc';

export const SPACE_CONTRACT_KIND_OPTIONS = [
  {
    key: 'recon' as const,
    label: '天基侦察',
    defaultPayload: '高分光学合成孔径侦察卫星',
    defaultReward: 1800,
  },
  {
    key: 'comm' as const,
    label: '通信中继',
    defaultPayload: '高通量宽带通信中继卫星',
    defaultReward: 1600,
  },
  {
    key: 'constellation' as const,
    label: '组网星座',
    defaultPayload: '低轨战术数据链组网卫星簇',
    defaultReward: 2400,
  },
  {
    key: 'station' as const,
    label: '空间站补给',
    defaultPayload: '天基轨道实验舱与推进剂补给货运飞船',
    defaultReward: 3000,
  },
  {
    key: 'commercial' as const,
    label: '商业代发',
    defaultPayload: '商业地球同步轨道通信卫星',
    defaultReward: 2000,
  },
] as const;

export const DEFAULT_ROCKET_OPTIONS = [
  '中型常温多级运载火箭',
  '重型低温无毒运载火箭',
  '能源号重型运载火箭',
  '超级重型两级全复用运载系统',
] as const;

export const DEFAULT_PAYLOAD_PRESETS: Record<SpaceContract['kind'], readonly string[]> = {
  recon: ['高分光学合成孔径侦察卫星', '全天候雷达海洋监视卫星'],
  comm: ['高通量宽带通信中继卫星', '地球同步轨道战略通信星'],
  constellation: ['低轨战术数据链组网卫星簇', '全球高精度导航授时星座组批'],
  station: ['天基轨道实验舱与推进剂补给货运飞船', '轨道空间站扩展桁架与太阳翼舱段'],
  commercial: ['商业地球同步轨道通信卫星', '跨国商业遥感实验载荷'],
};

const ORBITAL_KIND_LABELS: Record<OrbitalAsset['kind'], string> = {
  recon: '天基侦察',
  comm: '通信中继',
  navigation: '导航授时',
  weapon: '天基威慑',
  station: '轨道空间站',
  commercial: '商业载荷',
};

const DEFAULT_ORBITAL_BONUS_BY_KIND: Record<OrbitalAsset['kind'], string> = {
  commercial: '商业代发履约完成，持续提供商业航天信誉与回款',
  recon: '天基光学/合成孔径雷达全天候侦察，提供战区视野加成',
  comm: '高通量天基通信中继，提升跨战区指挥链路稳定性',
  navigation: '全球高精度导航授时星座，提升远程制导精度',
  weapon: '天基战略威慑载荷在轨值班',
  station: '大型在轨空间站，提供微重力科研与深空中转能力',
};

export interface LaunchReadinessDiagnosis {
  launchpadReady: boolean;
  launchpadBaseNames: string[];
  weatherPermitted: boolean;
  currentWeather: string;
  hasAllWeatherTech: boolean;
  overallReady: boolean;
  bannerTone: 'ready' | 'warn' | 'blocked';
  bannerText: string;
}

export interface OrbitalAssetCard {
  id: string;
  name: string;
  kind: OrbitalAsset['kind'];
  kindLabel: string;
  orbit: string;
  status: string;
  statusLabel: string;
  launchedAtDay: number;
  bonusDesc: string;
}

export interface ContractPayoutPreview {
  baseReward: number;
  boosterApplied: boolean;
  reuseBonus: number;
  totalPayout: number;
}

export interface SpaceContractDraftInput {
  id?: string;
  title: string;
  kind: SpaceContract['kind'];
  rocket: string;
  payload: string;
  base: string;
  rewardCredits: number;
  recoverBooster: boolean;
  useStoredBooster?: boolean;
  /** FD-27 扩展：关联发射中心 ID */
  launchCenterId?: string;
  /** FD-27 扩展：入轨后自动点亮的目标拓扑插槽 ID */
  targetSlot?: string;
  /** FD-27 扩展：关联的正典构件资产 ID */
  assetId?: string;
  /** FD-27 扩展：有效载荷质量（吨） */
  massTons?: number;
  /** FD-27 扩展：有效载荷来源（domestic 自家载荷 | commercial 外部商业订单） */
  payloadSource?: 'domestic' | 'commercial';
  /** FD-27 扩展：外部商业委托方名称 */
  client?: string;
  /** FD-27 扩展：入轨后加成覆盖范围（theater 全战区 | base 单基地定向赋能） */
  scope?: 'theater' | 'base';
  /** FD-27 扩展：当 scope === 'base' 时定向赋能的目标基地 */
  targetBase?: string;
  /** FD-27 扩展：目标轨道（LEO / SSO / GEO / TLI） */
  orbitTarget?: string;
}

/** 天地月 6 大选址展示元数据 */
export interface SpaceSiteTypeMeta {
  siteType: BaseSiteType;
  label: string;
  badgeText: string;
  payoutMultiplier: number;
  payloadMultiplier: number;
  exposurePulse: number;
  maxTier: 1 | 2 | 3;
  immuneToEarthWeather: boolean;
  weatherRuleText: string;
}

export const SPACE_SITE_TYPE_META: Readonly<Record<BaseSiteType, SpaceSiteTypeMeta>> = {
  equatorial_coastal: {
    siteType: 'equatorial_coastal',
    label: '赤道/低纬滨海',
    badgeText: '🌊 赤道滨海 · 回款+20% · 运力×1.15',
    payoutMultiplier: 1.2,
    payloadMultiplier: 1.15,
    exposurePulse: 0.12,
    maxTier: 3,
    immuneToEarthWeather: false,
    weatherRuleText: '读取基地局部天气（雷暴/台风挂起，防雷塔或全天候科技可豁免）',
  },
  inland_canyon: {
    siteType: 'inland_canyon',
    label: '内陆深谷加固',
    badgeText: '⛰️ 内陆深谷 · 隐蔽暴露+0.05 · 高轨×0.90',
    payoutMultiplier: 1.0,
    payloadMultiplier: 1.0,
    exposurePulse: 0.05,
    maxTier: 3,
    immuneToEarthWeather: false,
    weatherRuleText: '读取基地局部天气（深谷山体遮蔽红外与声爆）',
  },
  sea_platform: {
    siteType: 'sea_platform',
    label: '海上半潜平台',
    badgeText: '🚢 海上平台 · 回款+20% · 运力×1.15 · 上限T2',
    payoutMultiplier: 1.2,
    payloadMultiplier: 1.15,
    exposurePulse: 0.03,
    maxTier: 2,
    immuneToEarthWeather: false,
    weatherRuleText: '读取基地局部天气（大洋机动阵位低暴露，规模上限 Tier-2）',
  },
  high_latitude: {
    siteType: 'high_latitude',
    label: '高纬/极地试验场',
    badgeText: '❄️ 高纬极地 · 极轨回款+25% · 极轨运力×1.20',
    payoutMultiplier: 1.25,
    payloadMultiplier: 1.2,
    exposurePulse: 0.06,
    maxTier: 3,
    immuneToEarthWeather: false,
    weatherRuleText: '读取基地局部天气（极轨/太阳同步轨道天然优势）',
  },
  orbital_dock: {
    siteType: 'orbital_dock',
    label: '轨道船坞母港',
    badgeText: '🛰️ 轨道船坞 · 回款+50% · 运力×2.00 · 全天候真空',
    payoutMultiplier: 1.5,
    payloadMultiplier: 2.0,
    exposurePulse: 0,
    maxTier: 3,
    immuneToEarthWeather: true,
    weatherRuleText: '100% 恒定免疫地球气象窗口挂起',
  },
  lunar_surface: {
    siteType: 'lunar_surface',
    label: '月面低重力中心',
    badgeText: '🌕 月面低重力 · 回款+35% · 运力×1.50 · 全天候真空',
    payoutMultiplier: 1.35,
    payloadMultiplier: 1.5,
    exposurePulse: 0,
    maxTier: 3,
    immuneToEarthWeather: true,
    weatherRuleText: '100% 恒定免疫地球气象窗口挂起（1/6 低重力深空出射）',
  },
};

/** 单个基地/天体发射中心的派生视图模型（FD-27） */
export interface SpaceLaunchCenterView {
  id: string;
  base: string;
  baseName: string;
  name: string;
  siteType: BaseSiteType;
  site_type: BaseSiteType;
  siteLabel: string;
  siteBadge: string;
  tier: 1 | 2 | 3;
  tierLabel: string;
  maxTier: 1 | 2 | 3;
  status: LaunchCenterRecord['status'];
  tzOffset: number;
  tzLabel: string;
  localTimeText: string;
  localWeather: string;
  weatherPermitted: boolean;
  weatherHoldReason?: string;
  payoutMultiplier: number;
  payloadMultiplier: number;
  maxPayloadTons: number;
  maxCapacityTons: number;
  exposurePulse: number;
  isSpaceportCity: boolean;
  isFullReuseStarbase: boolean;
  mountedSlots: Record<string, string>;
  availableRockets: string[];
}

/** 三大专业航天制造建筑静态规格 */
export interface AeroManufacturingBuildingSpec {
  id: string;
  name: '火箭制造厂' | '卫星制造中心' | '大型航天器与舱段总装中心';
  icon: string;
  tier: 2 | 3;
  costCredits: number;
  powerLoad: number;
  prereqTech: string;
  mappedCanvasSlotId: string;
  roleSummary: string;
}

export const AERO_MANUFACTURING_BUILDING_SPECS: readonly AeroManufacturingBuildingSpec[] = [
  {
    id: 'bld.common.rocket_manufacturing_plant',
    name: '火箭制造厂',
    icon: '🔥',
    tier: 2,
    costCredits: 2500,
    powerLoad: 60,
    prereqTech: '火箭推进基础工学',
    mappedCanvasSlotId: 'lc_underground_fab',
    roleSummary: '专司各级火箭发动机、芯一级、捆绑助推器、真空芯二级、远征上面级制造',
  },
  {
    id: 'bld.common.satellite_manufacturing_center',
    name: '卫星制造中心',
    icon: '🛰️',
    tier: 2,
    costCredits: 3200,
    powerLoad: 75,
    prereqTech: '轨道侦察工学',
    mappedCanvasSlotId: 'lc_telemetry_1',
    roleSummary: '专司低轨侦察卫星、高轨预警通信卫星、多光谱勘探星、月面无人着陆器与探测车制造',
  },
  {
    id: 'bld.common.spacecraft_integration_complex',
    name: '大型航天器与舱段总装中心',
    icon: '🛸',
    tier: 3,
    costCredits: 6500,
    powerLoad: 140,
    prereqTech: '空间站建造工学',
    mappedCanvasSlotId: 'lc_spacecraft_hall',
    roleSummary: '专司宇宙飞船载荷总成、双级载人登月舱与月面增压车、空间站模块化加压舱段制造',
  },
] as const;

/** 三大航天制造建筑实时状态视图 */
export interface AeroManufacturingBuildingStatusView extends AeroManufacturingBuildingSpec {
  built: boolean;
  operational: boolean;
  buildingBases: string[];
  operationalBases: string[];
  stateLabel: string;
}

/** 单个可制造航天装备/载荷的在产与库存视图 */
export interface AeroEquipmentStockItemView {
  id: string;
  name: string;
  aliases: readonly string[];
  group: BuildableAeroEquipmentSpec['group'];
  groupLabel: string;
  needBuilding: BuildableAeroEquipmentSpec['need_building'];
  buildingReady: boolean;
  cost: number;
  days: number;
  tier: 1 | 2 | 3;
  prereqs: readonly string[];
  massTons?: number;
  reusable: boolean;
  stockCount: number;
  inProgressCount: number;
  progressPct: number;
  etaDays: number | null;
  activeBaseName?: string;
}

/** 航天制造与库存总览视图 */
export interface SpaceAeroManufacturingView {
  buildings: AeroManufacturingBuildingStatusView[];
  items: AeroEquipmentStockItemView[];
  byGroup: {
    engine: AeroEquipmentStockItemView[];
    stage: AeroEquipmentStockItemView[];
    satellite_payload: AeroEquipmentStockItemView[];
    spacecraft_payload: AeroEquipmentStockItemView[];
  };
  totalStockCount: number;
  totalInProgressCount: number;
}

/** 自家有效载荷候选项（D7-B：自家自产库存载荷 + 自有天基蓝图节点） */
export interface SpaceDomesticPayloadItem {
  id: string;
  name: string;
  source: 'domestic';
  category: 'satellite_payload' | 'spacecraft_payload' | 'blueprint_slot';
  needBuilding?: string;
  stockCount: number;
  inProgressCount: number;
  massTons: number;
  defaultOrbit: 'LEO' | 'SSO' | 'GEO' | 'TLI';
  defaultKind: SpaceContract['kind'];
  defaultRewardCredits: number;
  targetSlot?: string;
  assetId?: string;
}

/** 外部商业委托订单视图（D7-B：100% 仅读取 state.space.commercial_orders） */
export interface SpaceCommercialOrderView {
  id: string;
  name: string;
  source: 'commercial';
  client: string;
  orbit: string;
  massTons: number;
  rewardCredits: number;
  status: SpaceCommercialOrder['status'];
}

/** 有效载荷双来源硬隔离汇总视图（D7-B） */
export interface SpacePayloadSourcesView {
  domesticPayloads: SpaceDomesticPayloadItem[];
  commercialOrders: SpaceCommercialOrderView[];
  hasCommercialOrders: boolean;
  commercialEmptyHint: string;
}

/**
 * 返回用于驱动 EngSceneView 的天基测控大厅合成 ProjectDef
 */
export function buildAerospaceMccCatalogDef(): ProjectDef {
  return {
    kind: 'project',
    id: 'all.project.aerospace_mcc',
    name: '天基测控与发射大厅',
    grade: '巨构',
    scope: 'theater',
    scene: AEROSPACE_MCC_SCENE_ID,
    desc: '全战区发射工位、近地轨道星座与地月深空测控总览。',
    modules: [{ id: 'core', name: '测控中枢', cost: 0, prereqs: [] }],
  };
}

/**
 * 提取当前拥有运转态航天发射设施的基地名称列表
 */
export function listOperationalLaunchpadBases(snapshot: Schema | null | undefined): string[] {
  const bases = Array.isArray(snapshot?.bases) ? snapshot.bases : [];
  const names: string[] = [];
  for (const base of bases) {
    if (!base || base.status === '废弃') continue;
    const buildings = Array.isArray(base.buildings) ? base.buildings : [];
    const hasPad = buildings.some(bld => {
      if (!bld || typeof bld.name !== 'string') return false;
      const matched = LAUNCHPAD_BUILDINGS.some(pad => bld.name === pad || bld.name.includes(pad));
      return matched && (bld.state ?? '运转') === '运转';
    });
    if (hasPad) {
      names.push(base.name?.trim() || base.id?.trim() || '未知基地');
    }
  }
  return names;
}

/**
 * 发射场与气象窗口三态诊断
 */
export function diagnoseLaunchReadiness(
  snapshot: Schema | null | undefined,
  baseIdOrName?: string,
): LaunchReadinessDiagnosis {
  const state = snapshot ?? {};
  const launchpadBaseNames = listOperationalLaunchpadBases(snapshot);
  const launchpadReady = hasOperationalLaunchpad(state, baseIdOrName);
  const hasAllWeatherTech = Array.isArray(snapshot?.tech?.done)
    ? snapshot.tech.done.includes(ALL_WEATHER_LAUNCH_TECH)
    : false;
  const currentWeather = String(snapshot?.meta?.weather ?? '').trim();
  const weatherCheck = isLaunchWeatherPermitted(currentWeather || undefined, hasAllWeatherTech);
  const weatherPermitted = weatherCheck.permitted;
  const overallReady = launchpadReady && weatherPermitted;

  if (!launchpadReady) {
    return {
      launchpadReady,
      launchpadBaseNames,
      weatherPermitted,
      currentWeather,
      hasAllWeatherTech,
      overallReady: false,
      bannerTone: 'blocked',
      bannerText: '尚未建成运转态「航天发射中心」· 请先在基地建造发射设施后点火',
    };
  }

  if (!weatherPermitted) {
    return {
      launchpadReady,
      launchpadBaseNames,
      weatherPermitted,
      currentWeather,
      hasAllWeatherTech,
      overallReady: false,
      bannerTone: 'warn',
      bannerText:
        '气象窗口关闭（当前天气：' +
        currentWeather +
        '）· 待天气转好或研发「全天候天基发射控制学」后点火',
    };
  }

  return {
    launchpadReady,
    launchpadBaseNames,
    weatherPermitted,
    currentWeather,
    hasAllWeatherTech,
    overallReady: true,
    bannerTone: 'ready',
    bannerText:
      '发射窗口良好 · 发射场运转正常（天气：' + (currentWeather || '晴') + '，允许准时点火）',
  };
}

/**
 * 根据 snapshot 的发射场、活跃合同、可复用助推器、在轨载荷状态，
 * 生成驱动 scene.aerospace.mcc 5 个阶段热点（idx: 0..4）的合成 Project
 */
export function buildAerospaceMccSyntheticProject(snapshot: Schema | null | undefined): Project {
  const readiness = diagnoseLaunchReadiness(snapshot);
  const contracts = snapshot?.space?.contracts ?? [];
  const orbitalAssets = snapshot?.space?.orbital_assets ?? [];
  const boosters = Number(snapshot?.space?.reusable_boosters ?? 0);

  const hasActiveOrPendingContract = contracts.some(
    c => c.status === 'pending' || c.status === 'launching',
  );
  const hasCompletedContract = contracts.some(
    c => c.status === 'completed' || c.status === 'in_orbit',
  );
  const hasActiveOrbital = orbitalAssets.some(a => a.status === 'active');

  // idx 0: 垂直总装厂房
  let p0Status: ProjectPhase['status'] = '未启动';
  if (readiness.launchpadReady && (hasCompletedContract || orbitalAssets.length > 0)) {
    p0Status = '完工';
  } else if (readiness.launchpadReady) {
    p0Status = '进行中';
  } else if (contracts.length > 0) {
    p0Status = '暂停';
  }

  // idx 1: 1号发射工位
  let p1Status: ProjectPhase['status'] = '未启动';
  if (hasActiveOrPendingContract && !readiness.overallReady) {
    p1Status = '暂停';
  } else if (hasActiveOrPendingContract && readiness.overallReady) {
    p1Status = '进行中';
  } else if (readiness.launchpadReady && (hasCompletedContract || hasActiveOrbital)) {
    p1Status = '完工';
  } else if (readiness.launchpadReady) {
    p1Status = '进行中';
  }

  // idx 2: 助推回收坪
  let p2Status: ProjectPhase['status'] = '未启动';
  if (boosters > 0) {
    p2Status = '完工';
  } else if (
    contracts.some(c => c.recover_booster && (c.status === 'pending' || c.status === 'launching'))
  ) {
    p2Status = '进行中';
  }

  // idx 3: 近地轨道星座
  let p3Status: ProjectPhase['status'] = '未启动';
  if (hasActiveOrbital) {
    p3Status = '完工';
  } else if (
    orbitalAssets.length > 0 ||
    contracts.some(c => c.status === 'launching' || c.status === 'in_orbit')
  ) {
    p3Status = '进行中';
  }

  // idx 4: 地月转移与月表前哨
  let p4Status: ProjectPhase['status'] = '未启动';
  const hasDeepSpaceAsset = orbitalAssets.some(
    a =>
      a.kind === 'station' ||
      a.orbit.toUpperCase().includes('HEO') ||
      a.orbit.toUpperCase().includes('TLI') ||
      a.orbit.toUpperCase().includes('GEO'),
  );
  const hasStationProjectDone = (snapshot?.projects ?? []).some(
    p => (p.ref.includes('空间站') || p.ref.includes('月')) && p.status === '完工',
  );
  const hasStationProjectActive = (snapshot?.projects ?? []).some(
    p => (p.ref.includes('空间站') || p.ref.includes('月')) && p.status === '在建',
  );
  if (hasDeepSpaceAsset || hasStationProjectDone) {
    p4Status = '完工';
  } else if (
    hasStationProjectActive ||
    contracts.some(c => c.kind === 'station' && (c.status === 'pending' || c.status === 'launching'))
  ) {
    p4Status = '进行中';
  }

  const phases: ProjectPhase[] = [
    { idx: 0, name: '垂直总装厂房', status: p0Status, queue_index: null },
    { idx: 1, name: '1号发射工位', status: p1Status, queue_index: null },
    { idx: 2, name: '助推回收坪', status: p2Status, queue_index: null },
    { idx: 3, name: '近地轨道星座', status: p3Status, queue_index: null },
    { idx: 4, name: '地月转移与月表前哨', status: p4Status, queue_index: null },
  ];

  const anyDoneOrActive = phases.some(ph => ph.status === '完工' || ph.status === '进行中');
  const anyPaused = phases.some(ph => ph.status === '暂停');

  return {
    id: 'proj:aerospace-mcc@theater',
    ref: '天基测控与发射大厅',
    scope: 'theater',
    bases:
      readiness.launchpadBaseNames.length >= 2
        ? readiness.launchpadBaseNames
        : ['主发射场', '轨道测控站'],
    lead_base: readiness.launchpadBaseNames[0] ?? '主发射场',
    grade: '巨构',
    status: anyDoneOrActive ? '在建' : anyPaused ? '暂停' : '规划中',
    phases,
    outcome: { type: 'mark' },
    schema_version: 1,
  };
}

/**
 * 将 snapshot?.space?.orbital_assets 映射为前端展示卡片数组
 */
export function buildOrbitalAssetCards(snapshot: Schema | null | undefined): OrbitalAssetCard[] {
  const assets = snapshot?.space?.orbital_assets ?? [];
  return assets.map(asset => {
    const rawStatus = String(asset.status ?? 'active');
    const statusLabel =
      rawStatus === 'active'
        ? '在轨正常'
        : rawStatus === 'damaged' || rawStatus === 'degraded'
          ? '受损待修'
          : rawStatus === 'deorbited'
            ? '已离轨'
            : rawStatus;

    return {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      kindLabel: ORBITAL_KIND_LABELS[asset.kind] ?? '商业载荷',
      orbit: asset.orbit || 'LEO',
      status: rawStatus,
      statusLabel,
      launchedAtDay: asset.launched_at_day ?? 1,
      bonusDesc:
        asset.bonus_desc?.trim() ||
        DEFAULT_ORBITAL_BONUS_BY_KIND[asset.kind] ||
        '在轨载荷稳定运行',
    };
  });
}

/**
 * 计算基础报酬与可复用助推器 +15% 奖金预览
 */
export function computeContractPayoutPreview(
  rewardCredits: number,
  useStoredBooster: boolean,
  availableBoosters: number,
): ContractPayoutPreview {
  const baseReward = Math.max(0, Math.round(Number(rewardCredits) || 0));
  const boosterApplied = Boolean(useStoredBooster && Number(availableBoosters) > 0);
  const reuseBonus = boosterApplied ? Math.round(baseReward * 0.15) : 0;
  return {
    baseReward,
    boosterApplied,
    reuseBonus,
    totalPayout: baseReward + reuseBonus,
  };
}

/**
 * 生成新拟定发射合同的指挥官签发指令 + `<航天合同>...</航天合同>` 块
 */
export function buildSpaceContractOrderText(draft: SpaceContractDraftInput): string {
  const title = draft.title.trim() || `${draft.payload.trim() || '天基载荷'}发射任务`;
  const kind = draft.kind || 'commercial';
  const rocket = draft.rocket.trim() || DEFAULT_ROCKET_OPTIONS[0];
  const payload = draft.payload.trim() || '商业通信卫星';
  const base = draft.base.trim() || '主发射场';
  const rewardCredits = Math.max(0, Math.round(Number(draft.rewardCredits) || 0));
  const id = (draft.id ?? '').trim() || `sc-${kind}-${rewardCredits || 1000}`;

  const notes: string[] = [];
  if (draft.recoverBooster) notes.push('启用一级助推器回收');
  if (draft.useStoredBooster) notes.push('调用库存助推器复用(+15%奖金)');
  if (draft.payloadSource === 'commercial' && draft.client) {
    notes.push(`商业委托方：${draft.client}`);
  } else if (draft.payloadSource === 'domestic') {
    notes.push('载荷来源：自家自产载荷');
  }
  if (draft.targetSlot) {
    notes.push(`目标插槽：${draft.targetSlot}`);
  }
  const noteSuffix = notes.length > 0 ? `（${notes.join('，')}）` : '';

  const lines: string[] = [
    `【天基航天指令】拟定并签发发射合同「${title}」，发射基地：${base}，运载火箭：${rocket}，有效载荷：${payload}，里程碑报酬：$${rewardCredits}${noteSuffix}`,
    '<航天合同>',
    `id: ${id}`,
    `title: ${title}`,
    `kind: ${kind}`,
    `rocket: ${rocket}`,
    `payload: ${payload}`,
    `base: ${base}`,
  ];

  if (draft.launchCenterId?.trim()) {
    lines.push(`launch_center_id: ${draft.launchCenterId.trim()}`);
  }
  if (draft.payloadSource) {
    lines.push(`payload_source: ${draft.payloadSource}`);
  }
  if (draft.client?.trim()) {
    lines.push(`client: ${draft.client.trim()}`);
  }
  if (typeof draft.massTons === 'number' && Number.isFinite(draft.massTons) && draft.massTons > 0) {
    lines.push(`mass_t: ${draft.massTons}`);
  }
  if (draft.orbitTarget?.trim()) {
    lines.push(`orbit: ${draft.orbitTarget.trim()}`);
  }
  if (draft.targetSlot?.trim()) {
    lines.push(`target_slot: ${draft.targetSlot.trim()}`);
  }
  if (draft.assetId?.trim()) {
    lines.push(`asset_id: ${draft.assetId.trim()}`);
  }
  if (draft.scope) {
    lines.push(`scope: ${draft.scope}`);
  }
  if (draft.targetBase?.trim()) {
    lines.push(`target_base: ${draft.targetBase.trim()}`);
  }

  lines.push(
    `reward_credits: ${rewardCredits}`,
    `recover_booster: ${draft.recoverBooster ? 'true' : 'false'}`,
  );
  if (draft.useStoredBooster) {
    lines.push('复用助推器: 是');
  }
  lines.push(
    'status: pending',
    '</航天合同>',
  );

  return lines.join('\n');
}

export const buildLaunchContractCommandText = buildSpaceContractOrderText;

/**
 * 针对列表中已有 pending 合同生成点火发射指令文本
 */
export function buildExistingContractLaunchOrderText(
  contract: SpaceContract & { use_stored_booster?: boolean },
  useStoredBooster?: boolean,
): string {
  const base = contract.base?.trim() || '主发射场';
  const shouldReuse = Boolean(useStoredBooster ?? contract.use_stored_booster);
  const reuseNote = shouldReuse ? '，调用库存可复用助推器（+15%里程碑奖金）' : '';
  const lines = [
    `【天基航天指令】点火执行发射合同「${contract.title}」（编号：${contract.id}），发射基地：${base}，运载火箭：${contract.rocket}，有效载荷：${contract.payload}${reuseNote}`,
    '<航天合同>',
    `id: ${contract.id}`,
    `title: ${contract.title}`,
    `kind: ${contract.kind}`,
    `rocket: ${contract.rocket}`,
    `payload: ${contract.payload}`,
    `base: ${base}`,
    `reward_credits: ${contract.reward_credits}`,
    `recover_booster: ${contract.recover_booster ? 'true' : 'false'}`,
  ];
  if (shouldReuse) {
    lines.push('复用助推器: 是');
  }
  lines.push('status: pending', '</航天合同>');
  return lines.join('\n');
}

export const buildContractLaunchOrderText = buildExistingContractLaunchOrderText;

// ═══════════════════════════════════════════════════════════════════════════
// FD-27：多基地发射中心视图、航天装备制造与库存视图、有效载荷双来源硬隔离模型
// ═══════════════════════════════════════════════════════════════════════════

const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Tier-1 小型发射场(4槽)',
  2: 'Tier-2 中型发射中心(8槽)',
  3: 'Tier-3 国家航天城小巨构(12槽)',
};

const AERO_EQUIPMENT_GROUP_LABELS: Record<BuildableAeroEquipmentSpec['group'], string> = {
  engine: '🔥 各级火箭发动机',
  stage: '🚀 助推与箭体芯级',
  satellite_payload: '🛰️ 自产应用卫星与探测载荷',
  spacecraft_payload: '🛸 大型飞船与空间站舱段载荷',
};

/**
 * 根据首基地标准时间（meta.time）与目标基地相对时区偏移（tzOffset）计算基地本地时间文本
 */
export function formatLaunchCenterLocalTime(
  metaTime: string | undefined | null,
  tzOffset = 0,
): { localTimeText: string; tzLabel: string } {
  const offset = Math.max(-12, Math.min(14, Math.round(Number(tzOffset) || 0)));
  const tzLabel = offset === 0 ? '标准时±0h' : offset > 0 ? `标准时+${offset}h` : `标准时${offset}h`;
  const raw = String(metaTime ?? '08:00').trim();
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    return { localTimeText: `${raw || '08:00'} (${tzLabel})`, tzLabel };
  }
  const baseHour = Number(match[1]) || 0;
  const minute = match[2];
  const localHour = ((baseHour + offset) % 24 + 24) % 24;
  const hh = String(localHour).padStart(2, '0');
  return {
    localTimeText: `${hh}:${minute}`,
    tzLabel,
  };
}

/**
 * 根据发射中心规模等级（Tier 1/2/3）返回允许挂载发射的运载火箭列表
 */
export function resolveAvailableRocketsForTier(tier: 1 | 2 | 3): string[] {
  if (tier >= 3) {
    return [...DEFAULT_ROCKET_OPTIONS];
  }
  if (tier === 2) {
    return [
      DEFAULT_ROCKET_OPTIONS[0],
      DEFAULT_ROCKET_OPTIONS[1],
      DEFAULT_ROCKET_OPTIONS[2],
    ];
  }
  return [DEFAULT_ROCKET_OPTIONS[0]];
}

/**
 * 派生多基地与天地月发射中心切换视图列表（FD-27 §3 / §4）
 * - 自动融合 state.space.launch_centers 与 state.bases 中拥有航天设施的基地；
 * - 实时推导选址 Buff/Debuff 乘数、本地时区时间、局部天气门控与可用火箭列表。
 */
export function deriveSpaceLaunchCentersView(
  snapshot: Partial<Schema> | Schema | null | undefined,
  orbitTarget = 'LEO',
): SpaceLaunchCenterView[] {
  const state = (snapshot ?? {}) as Partial<Schema>;
  const derivedList = deriveLaunchCentersFromState(state);
  const hasAllWeatherTech = Array.isArray(state.tech?.done)
    ? state.tech!.done.includes(ALL_WEATHER_LAUNCH_TECH)
    : false;
  const metaTime =
    state.clock?.time ??
    (state.meta as { time?: string } | undefined)?.time ??
    state.meta?.date ??
    '08:00';

  return derivedList.map(rec => {
    const siteType = normalizeSiteType(rec.site_type, 'inland_canyon');
    const siteMeta = SPACE_SITE_TYPE_META[siteType] ?? SPACE_SITE_TYPE_META.inland_canyon;
    const orbitMod = evaluateLaunchSiteModifiers(siteType, orbitTarget);
    const hasLocalWeatherTower = Boolean(rec.mounted_slots?.['lc_weather_tower']);
    const weatherCheck = siteMeta.immuneToEarthWeather
      ? { permitted: true as const }
      : isLaunchWeatherPermitted(
          rec.weather,
          hasAllWeatherTech || hasLocalWeatherTower,
        );
    const { localTimeText, tzLabel } = formatLaunchCenterLocalTime(metaTime, rec.tz_offset);
    const baseCapByTier =
      rec.tier >= 3 ? (rec.isFullReuseStarbase ? 80 : 65) : rec.tier === 2 ? 35 : 8;
    const maxPayloadTons = Math.round(baseCapByTier * orbitMod.payloadMult * 100) / 100;

    return {
      id: rec.id,
      base: rec.base,
      baseName: rec.base,
      name: rec.name,
      siteType,
      site_type: siteType,
      siteLabel: siteMeta.label,
      siteBadge: siteMeta.badgeText,
      tier: rec.tier,
      tierLabel: TIER_LABELS[rec.tier] ?? TIER_LABELS[1],
      maxTier: siteMeta.maxTier,
      status: rec.status,
      tzOffset: rec.tz_offset,
      tzLabel,
      localTimeText,
      localWeather: rec.weather,
      weatherPermitted: weatherCheck.permitted,
      weatherHoldReason: weatherCheck.reason,
      payoutMultiplier: orbitMod.payoutMult,
      payloadMultiplier: orbitMod.payloadMult,
      maxPayloadTons,
      maxCapacityTons: maxPayloadTons,
      exposurePulse: orbitMod.exposureDelta,
      isSpaceportCity: rec.isSpaceportCity,
      isFullReuseStarbase: rec.isFullReuseStarbase,
      mountedSlots: { ...(rec.mounted_slots ?? {}) },
      availableRockets: resolveAvailableRocketsForTier(rec.tier),
    };
  });
}

export const buildSpaceLaunchCenterViews = deriveSpaceLaunchCentersView;

/**
 * 扫描生产切片与 UTO 队列中匹配指定航天装备的在产任务
 */
function inspectInProgressAeroEquipment(
  spec: BuildableAeroEquipmentSpec,
  snapshot: Partial<Schema> | Schema | null | undefined,
): {
  inProgressCount: number;
  progressPct: number;
  etaDays: number | null;
  activeBaseName?: string;
} {
  const activeProd: ProductionTask[] = Array.isArray(
    (snapshot as { production_Slice?: { active?: ProductionTask[] } } | null | undefined)
      ?.production_Slice?.active,
  )
    ? (snapshot as { production_Slice?: { active?: ProductionTask[] } }).production_Slice!.active!
    : [];
  const queues = Array.isArray(snapshot?.queues) ? snapshot!.queues : [];
  const candidateNames = new Set<string>([spec.id, spec.name, ...spec.aliases]);

  let inProgressCount = 0;
  let bestPct = 0;
  let bestEta: number | null = null;
  let activeBaseName: string | undefined;

  for (const qItem of queues) {
    if (!qItem || qItem.type !== '生产') continue;
    if (qItem.status === 'done' || qItem.status === 'cancelled') continue;
    const ref = String(qItem.item ?? '').trim();
    if (!ref) continue;
    const matched =
      candidateNames.has(ref) ||
      Array.from(candidateNames).some(c => c.length >= 3 && (ref.includes(c) || c.includes(ref)));
    if (!matched) continue;

    const qtyTotal = Math.max(1, Math.round(Number(qItem.qty) || 1));
    const qtyDone = Math.max(0, Math.round(Number(qItem.qty_done) || 0));
    const remainingCount = Math.max(1, qtyTotal - qtyDone);
    inProgressCount += remainingCount;

    const pct = Math.max(0, Math.min(100, Math.round(Number(qItem.progress) || 0)));
    const reqDays = spec.days || 1;
    const eta = Math.max(0, Math.round(reqDays * (1 - pct / 100) * 10) / 10);
    if (pct >= bestPct) {
      bestPct = pct;
      bestEta = eta;
      activeBaseName = qItem.base;
    }
  }

  for (const task of activeProd) {
    if (!task || task.status === 'paused') continue;
    const ref = String(task.unit_ref ?? '').trim();
    if (!ref) continue;
    const matched =
      candidateNames.has(ref) ||
      Array.from(candidateNames).some(c => c.length >= 3 && (ref.includes(c) || c.includes(ref)));
    if (!matched) continue;

    const count = Math.max(1, Math.round(Number(task.count) || 1));
    inProgressCount += count;
    const req = Math.max(0.1, Number(task.days_required) || spec.days || 1);
    const prog = Math.max(0, Number(task.days_progress) || 0);
    const pct = Math.max(0, Math.min(100, Math.round((prog / req) * 100)));
    const eta = Math.max(0, Math.round((req - prog) * 10) / 10);
    if (pct >= bestPct) {
      bestPct = pct;
      bestEta = eta;
      activeBaseName = task.base;
    }
  }

  return {
    inProgressCount,
    progressPct: bestPct,
    etaDays: bestEta,
    activeBaseName,
  };
}

/**
 * 读取指定航天装备在 space.equipment_stock 与 forces.equipment 中的库存数量
 */
export function resolveAeroEquipmentStockCount(
  specOrName: BuildableAeroEquipmentSpec | string,
  snapshot: Partial<Schema> | Schema | null | undefined,
): number {
  const spec =
    typeof specOrName === 'string'
      ? findBuildableAeroEquipmentSpec(specOrName)
      : specOrName;
  const keys = spec
    ? Array.from(new Set([spec.id, spec.name, ...spec.aliases]))
    : [String(specOrName ?? '').trim()];

  const spaceStock = snapshot?.space?.equipment_stock ?? {};
  const forceEquip = snapshot?.forces?.equipment ?? {};

  let fromSpace = 0;
  for (const key of keys) {
    const val = Number(spaceStock[key]);
    if (Number.isFinite(val) && val > 0) {
      fromSpace += Math.floor(val);
    }
  }

  let fromForces = 0;
  for (const key of keys) {
    const val = Number(forceEquip[key]);
    if (Number.isFinite(val) && val > 0) {
      fromForces += Math.floor(val);
    }
  }

  return Math.max(fromSpace, fromForces);
}

/**
 * 派生三大专业航天制造建筑状态 + 4 大类 14 项可制造航天装备「在产进度 + 现役库存」视图（FD-27 D7-A）
 */
export function deriveAeroManufacturingView(
  snapshot: Partial<Schema> | Schema | null | undefined,
  selectedBaseName?: string,
): SpaceAeroManufacturingView {
  const allBases = Array.isArray(snapshot?.bases)
    ? snapshot!.bases.filter(b => b && b.status !== '废弃')
    : [];
  const targetBase = (selectedBaseName ?? '').trim();
  const scopedBases = targetBase
    ? allBases.filter(b => b.name === targetBase || b.id === targetBase)
    : allBases;
  const basesToInspect = scopedBases.length > 0 ? scopedBases : allBases;

  const buildings: AeroManufacturingBuildingStatusView[] = AERO_MANUFACTURING_BUILDING_SPECS.map(
    spec => {
      const operationalBases: string[] = [];
      const buildingBases: string[] = [];

      for (const base of basesToInspect) {
        const blds = Array.isArray(base.buildings) ? base.buildings : [];
        for (const bld of blds) {
          if (!bld || typeof bld.name !== 'string') continue;
          if (bld.name === spec.name || bld.name.includes(spec.name)) {
            const state = bld.state ?? '运转';
            if (state === '运转') {
              operationalBases.push(base.name);
            } else if (state === '建造中') {
              buildingBases.push(base.name);
            }
          }
        }
      }

      // 同时检查发射中心已建成拓扑插槽映射
      const completedSlots = snapshot?.space?.completed_slots ?? {};
      const slotBuilt = Boolean(completedSlots[spec.mappedCanvasSlotId]);
      const operational = operationalBases.length > 0 || slotBuilt;
      const built = operational || buildingBases.length > 0;
      const stateLabel = operational
        ? '运转中'
        : buildingBases.length > 0
          ? '建造中'
          : '未建造';

      return {
        ...spec,
        built,
        operational,
        buildingBases,
        operationalBases,
        stateLabel,
      };
    },
  );

  const operationalBuildingSet = new Set(
    buildings.filter(b => b.operational).map(b => b.name),
  );

  const items: AeroEquipmentStockItemView[] = BUILDABLE_AERO_EQUIPMENT_CATALOG.map(spec => {
    const stockCount = resolveAeroEquipmentStockCount(spec, snapshot);
    const inProg = inspectInProgressAeroEquipment(spec, snapshot);
    const buildingReady = operationalBuildingSet.has(spec.need_building);

    return {
      id: spec.id,
      name: spec.name,
      aliases: spec.aliases,
      group: spec.group,
      groupLabel: AERO_EQUIPMENT_GROUP_LABELS[spec.group],
      needBuilding: spec.need_building,
      buildingReady,
      cost: spec.cost,
      days: spec.days,
      tier: spec.tier,
      prereqs: spec.prereqs,
      massTons: spec.mass_t,
      reusable: Boolean(spec.reusable),
      stockCount,
      inProgressCount: inProg.inProgressCount,
      progressPct: inProg.progressPct,
      etaDays: inProg.etaDays,
      activeBaseName: inProg.activeBaseName,
    };
  });

  const byGroup = {
    engine: items.filter(i => i.group === 'engine'),
    stage: items.filter(i => i.group === 'stage'),
    satellite_payload: items.filter(i => i.group === 'satellite_payload'),
    spacecraft_payload: items.filter(i => i.group === 'spacecraft_payload'),
  };

  const totalStockCount = items.reduce((acc, item) => acc + item.stockCount, 0);
  const totalInProgressCount = items.reduce((acc, item) => acc + item.inProgressCount, 0);

  return {
    buildings,
    items,
    byGroup,
    totalStockCount,
    totalInProgressCount,
  };
}

export const buildAeroManufacturingView = deriveAeroManufacturingView;

/**
 * 生成可制造航天装备/部件或自产载荷的一键排产指令（走五层因果漏斗第 ⑧ 槽位 `<排产计划>`，类别: 生产）
 */
export function buildAeroEquipmentProduceCommand(
  baseName: string,
  itemNameOrId: string,
  qty = 1,
): string {
  const base = (baseName ?? '').trim() || '主发射场';
  const spec = findBuildableAeroEquipmentSpec(itemNameOrId);
  const itemName = spec?.name ?? (String(itemNameOrId ?? '').trim() || '标准运载火箭芯一级');
  const needBuilding = spec?.need_building ?? '火箭制造厂';
  const safeQty = Math.max(1, Math.min(20, Math.round(Number(qty) || 1)));
  const costNote = spec ? `，预计单价 $${spec.cost}，单件工期 ${spec.days}d` : '';

  return [
    `【航天装备排产令】指派「${base}」的「${needBuilding}」排产「${itemName}」×${safeQty}${costNote}`,
    '<排产计划>',
    '- 类别: 生产',
    `  标的: ${itemName}`,
    `  数量: ${safeQty}`,
    `  基地: ${base}`,
    `  承建建筑: ${needBuilding}`,
    '</排产计划>',
  ].join('\n');
}

export const buildAeroEquipmentProductionOrderText = buildAeroEquipmentProduceCommand;

/**
 * 生成三大专业航天制造建筑的立项建造指令（走五层因果漏斗第 ⑧ 槽位 `<排产计划>`，类别: 建造）
 */
export function buildAeroBuildingConstructCommand(
  baseName: string,
  buildingName: string,
): string {
  const base = (baseName ?? '').trim() || '主发射场';
  const bldSpec = AERO_MANUFACTURING_BUILDING_SPECS.find(
    b => b.name === buildingName || b.id === buildingName,
  );
  const finalName = bldSpec?.name ?? (String(buildingName ?? '').trim() || '火箭制造厂');
  const costNote = bldSpec ? `（造价 $${bldSpec.costCredits}，耗电 ${bldSpec.powerLoad}）` : '';

  return [
    `【航天基建营建令】在「${base}」立项建造专业航天制造设施「${finalName}」${costNote}`,
    '<排产计划>',
    '- 类别: 建造',
    `  标的: ${finalName}`,
    '  数量: 1',
    `  基地: ${base}`,
    '</排产计划>',
  ].join('\n');
}

/**
 * 派生有效载荷双来源硬隔离视图（FD-27 D7-B）
 * - 🏠 domesticPayloads：仅来自我方三大制造建筑可生产的 7 种自产卫星/飞船/舱段载荷与自有天基蓝图；
 * - 💼 commercialOrders：100% 仅读取 state.space.commercial_orders（由 LLM 通过 `<航天合同>` 下发），
 *   若为空则严格返回空数组 `[]`，严禁前端伪造或随机生成任何外部商业订单！
 */
export function deriveSpacePayloadSources(
  snapshot: Partial<Schema> | Schema | null | undefined,
): SpacePayloadSourcesView {
  const mfgView = deriveAeroManufacturingView(snapshot);
  const payloadItems = [
    ...mfgView.byGroup.satellite_payload,
    ...mfgView.byGroup.spacecraft_payload,
  ];

  const domesticPayloads: SpaceDomesticPayloadItem[] = payloadItems.map(item => {
    let defaultOrbit: 'LEO' | 'SSO' | 'GEO' | 'TLI' = 'LEO';
    let defaultKind: SpaceContract['kind'] = 'recon';

    if (item.id.includes('geo_ew_comm')) {
      defaultOrbit = 'GEO';
      defaultKind = 'comm';
    } else if (item.id.includes('survey_asat')) {
      defaultOrbit = 'SSO';
      defaultKind = 'constellation';
    } else if (item.id.includes('lunar')) {
      defaultOrbit = 'TLI';
      defaultKind = 'station';
    } else if (item.group === 'spacecraft_payload') {
      defaultOrbit = 'LEO';
      defaultKind = 'station';
    }

    return {
      id: item.id,
      name: item.name,
      source: 'domestic',
      category: item.group === 'satellite_payload' ? 'satellite_payload' : 'spacecraft_payload',
      needBuilding: item.needBuilding,
      stockCount: item.stockCount,
      inProgressCount: item.inProgressCount,
      massTons: item.massTons ?? 6,
      defaultOrbit,
      defaultKind,
      defaultRewardCredits: item.cost,
    };
  });

  // 严守 D7-B：100% 仅读取 state.space.commercial_orders，严禁前端伪造任何商业订单
  const rawCommercial = Array.isArray(snapshot?.space?.commercial_orders)
    ? snapshot!.space!.commercial_orders!
    : [];

  const commercialOrders: SpaceCommercialOrderView[] = rawCommercial
    .filter(order => Boolean(order && order.id && order.name))
    .map(order => ({
      id: order.id,
      name: order.name,
      source: 'commercial' as const,
      client: order.client || '外部商业委托',
      orbit: order.orbit || 'LEO',
      massTons: Number(order.mass_t) || 5,
      rewardCredits: Number(order.reward_credits) || 2000,
      status: order.status ?? 'pending',
    }));

  return {
    domesticPayloads,
    commercialOrders,
    hasCommercialOrders: commercialOrders.length > 0,
    commercialEmptyHint: '暂无外部商业委托载荷（仅接收 LLM 剧情下发的商业发射合同）',
  };
}

export const buildSpacePayloadCatalogView = deriveSpacePayloadSources;

