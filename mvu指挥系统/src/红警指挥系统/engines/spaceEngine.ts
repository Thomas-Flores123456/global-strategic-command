import {
  BaseSiteType,
  LaunchCenterRecord,
  OrbitalAsset,
  Schema,
  SpaceCommercialOrder,
  SpaceContract,
} from '../core/schema';

export const LAUNCHPAD_BUILDINGS = [
  '航天发射中心',
  '大型航天发射综合体',
  '航天发射场',
  '商业航天发射工位',
  '重型航天发射场',
  '巨型航天发射港',
  '海上发射平台',
  '山体发射场',
  '赤星轨道战略投送阵列',
] as const;

type SpaceContractWithMeta = SpaceContract & {
  use_stored_booster?: boolean;
  explicit_hold?: boolean;
  explicit_completed?: boolean;
  explicit_failed?: boolean;
  failure_reason?: string;
};

const SPACE_SCHEMA_PATCHED_SYM = Symbol.for('ra.space.schema.patched');
if (!(SpaceContract as unknown as Record<symbol, boolean>)[SPACE_SCHEMA_PATCHED_SYM]) {
  (SpaceContract as unknown as Record<symbol, boolean>)[SPACE_SCHEMA_PATCHED_SYM] = true;
  const origContractParse = SpaceContract.parse.bind(SpaceContract);
  SpaceContract.parse = ((data: unknown, params?: unknown) => {
    const parsed = origContractParse(data, params as never) as SpaceContractWithMeta;
    if (data && typeof data === 'object') {
      const raw = data as Record<string, unknown>;
      const rawUseBooster =
        raw.use_stored_booster ??
        raw.useStoredBooster ??
        raw['复用助推器'] ??
        raw['使用库存助推器'] ??
        raw['调用库存助推器'] ??
        raw['复用库存助推器'];
      if (rawUseBooster !== undefined) {
        parsed.use_stored_booster = normalizeBoolean(rawUseBooster);
      }
      if (typeof raw.explicit_hold === 'boolean') parsed.explicit_hold = raw.explicit_hold;
      if (typeof raw.explicit_completed === 'boolean') parsed.explicit_completed = raw.explicit_completed;
      if (typeof raw.explicit_failed === 'boolean') parsed.explicit_failed = raw.explicit_failed;
      if (typeof raw.failure_reason === 'string' && raw.failure_reason.trim()) {
        parsed.failure_reason = raw.failure_reason.trim();
      }
    }
    return parsed;
  }) as typeof SpaceContract.parse;

  const origSchemaParse = Schema.parse.bind(Schema);
  Schema.parse = ((data: unknown, params?: unknown) => {
    const parsed = origSchemaParse(data, params as never);
    if (
      data &&
      typeof data === 'object' &&
      Array.isArray((data as { space?: { contracts?: unknown[] } }).space?.contracts) &&
      Array.isArray(parsed?.space?.contracts)
    ) {
      const rawContracts = (data as { space: { contracts: Array<Record<string, unknown>> } }).space.contracts;
      parsed.space.contracts.forEach((c, idx) => {
        const raw =
          rawContracts.find(rc => rc && rc.id === c.id) ??
          rawContracts[idx];
        if (!raw || typeof raw !== 'object') return;
        const rawUseBooster =
          raw.use_stored_booster ??
          raw.useStoredBooster ??
          raw['复用助推器'] ??
          raw['使用库存助推器'] ??
          raw['调用库存助推器'] ??
          raw['复用库存助推器'];
        if (rawUseBooster !== undefined) {
          (c as SpaceContractWithMeta).use_stored_booster = normalizeBoolean(rawUseBooster);
        }
        if (typeof raw.failure_reason === 'string' && raw.failure_reason.trim()) {
          (c as SpaceContractWithMeta).failure_reason = raw.failure_reason.trim();
        }
      });
    }
    return parsed;
  }) as typeof Schema.parse;
}

export const AERO_MANUFACTURING_BUILDINGS = [
  '火箭制造厂',
  '卫星制造中心',
  '大型航天器与舱段总装中心',
] as const;

export const SEVERE_LAUNCH_WEATHERS = [
  '暴风雪',
  '强台风',
  '飓风',
  '雷暴',
  '电磁风暴',
  '强磁暴',
  '暴雨',
  '沙尘暴',
] as const;

export const STANDARD_WEATHER_WHITELIST = [
  '晴',
  '多云',
  '阴',
  '小雨',
  '大雾',
  '暴雨',
  '雷暴',
  '暴风雪',
  '强台风',
  '沙尘暴',
  '强磁暴',
  '真空无气象',
] as const;

export const ALL_WEATHER_LAUNCH_TECH = '全天候天基发射控制学';

/**
 * 天地月 6 大发射中心选址硬数值配置（FD-27 §3）
 */
export interface LaunchSiteModifierSpec {
  siteType: BaseSiteType;
  label: string;
  /** 燃料结余 / 合同回款乘数 */
  payoutMult: number;
  /** 有效载荷吨位上限乘数 */
  payloadMult: number;
  /** 单次点火暴露度脉冲增量 */
  exposureDelta: number;
  /** 是否恒定免疫地球气象窗口挂起（轨道船坞与月面中心为 true） */
  immuneToEarthWeather: boolean;
  /** 发射中心扩建规模上限（海上平台锁死为 Tier-2，其余可至 Tier-3） */
  maxTier: 1 | 2 | 3;
  /** 单次在轨总装出射额外消耗纳米机械（仅轨道船坞且无月面水冰/质量投射器反哺时） */
  naniteCostPerLaunch: number;
}

export const LAUNCH_SITE_MODIFIERS: Readonly<Record<BaseSiteType, LaunchSiteModifierSpec>> = {
  equatorial_coastal: {
    siteType: 'equatorial_coastal',
    label: '赤道滨海',
    payoutMult: 1.2,
    payloadMult: 1.15,
    exposureDelta: 0.12,
    immuneToEarthWeather: false,
    maxTier: 3,
    naniteCostPerLaunch: 0,
  },
  inland_canyon: {
    siteType: 'inland_canyon',
    label: '内陆深谷',
    payoutMult: 1.0,
    payloadMult: 1.0,
    exposureDelta: 0.05,
    immuneToEarthWeather: false,
    maxTier: 3,
    naniteCostPerLaunch: 0,
  },
  sea_platform: {
    siteType: 'sea_platform',
    label: '海上半潜平台',
    payoutMult: 1.2,
    payloadMult: 1.15,
    exposureDelta: 0.03,
    immuneToEarthWeather: false,
    maxTier: 2,
    naniteCostPerLaunch: 0,
  },
  high_latitude: {
    siteType: 'high_latitude',
    label: '高纬极地',
    payoutMult: 1.25,
    payloadMult: 1.2,
    exposureDelta: 0.06,
    immuneToEarthWeather: false,
    maxTier: 3,
    naniteCostPerLaunch: 0,
  },
  orbital_dock: {
    siteType: 'orbital_dock',
    label: '轨道船坞母港',
    payoutMult: 1.5,
    payloadMult: 2.0,
    exposureDelta: 0,
    immuneToEarthWeather: true,
    maxTier: 3,
    naniteCostPerLaunch: 50,
  },
  lunar_surface: {
    siteType: 'lunar_surface',
    label: '月面低重力中心',
    payoutMult: 1.35,
    payloadMult: 1.5,
    exposureDelta: 0,
    immuneToEarthWeather: true,
    maxTier: 3,
    naniteCostPerLaunch: 0,
  },
};

/**
 * 可制造航天装备/部件与自产载荷目录（FD-27 §5.1.1 · D7-A）
 */
export interface BuildableAeroEquipmentSpec {
  id: string;
  name: string;
  aliases: readonly string[];
  group: 'engine' | 'stage' | 'satellite_payload' | 'spacecraft_payload';
  need_building: '火箭制造厂' | '卫星制造中心' | '大型航天器与舱段总装中心';
  cost: number;
  days: number;
  tier: 1 | 2 | 3;
  prereqs: readonly string[];
  mass_t?: number;
  reusable?: boolean;
}

export const BUILDABLE_AERO_EQUIPMENT_CATALOG: readonly BuildableAeroEquipmentSpec[] = [
  {
    id: 'common.unit.aero.sea_level_kerolox_engine',
    name: '海平面大推力液氧煤油发动机组',
    aliases: ['液氧煤油发动机组'],
    group: 'engine',
    need_building: '火箭制造厂',
    cost: 800,
    days: 1,
    tier: 1,
    prereqs: ['火箭推进基础工学'],
  },
  {
    id: 'common.unit.aero.vacuum_hydrolox_engine',
    name: '高空真空氢氧膨胀循环发动机',
    aliases: ['高空真空氢氧/膨胀循环发动机'],
    group: 'engine',
    need_building: '火箭制造厂',
    cost: 1200,
    days: 1.5,
    tier: 2,
    prereqs: ['无毒推进剂工学'],
  },
  {
    id: 'common.unit.aero.full_flow_methalox_engine',
    name: '全流量分级燃烧液氧甲烷发动机组',
    aliases: ['猛禽液氧甲烷发动机组'],
    group: 'engine',
    need_building: '火箭制造厂',
    cost: 1800,
    days: 2,
    tier: 3,
    prereqs: ['重型全复用运载工学'],
  },
  {
    id: 'common.unit.aero.strap_on_booster',
    name: '通用捆绑式助推器',
    aliases: ['通用捆绑式液体/固体助推器'],
    group: 'stage',
    need_building: '火箭制造厂',
    cost: 1200,
    days: 1.5,
    tier: 1,
    prereqs: ['火箭推进基础工学'],
    reusable: true,
  },
  {
    id: 'common.unit.aero.core_first_stage',
    name: '标准运载火箭芯一级',
    aliases: ['运载火箭芯一级'],
    group: 'stage',
    need_building: '火箭制造厂',
    cost: 2200,
    days: 2,
    tier: 1,
    prereqs: ['火箭推进基础工学'],
    reusable: true,
  },
  {
    id: 'common.unit.aero.vacuum_second_stage',
    name: '高空入轨真空芯二级',
    aliases: ['运载火箭芯二级'],
    group: 'stage',
    need_building: '火箭制造厂',
    cost: 1600,
    days: 1.5,
    tier: 1,
    prereqs: ['火箭推进基础工学'],
  },
  {
    id: 'common.unit.aero.upper_kick_stage',
    name: '远征上面级',
    aliases: ['远征上面级 (太空摆渡级)'],
    group: 'stage',
    need_building: '火箭制造厂',
    cost: 1500,
    days: 1.5,
    tier: 2,
    prereqs: ['无毒推进剂工学'],
  },
  {
    id: 'common.unit.aero.leo_recon_sat_payload',
    name: '低轨高分光学侦察卫星载荷',
    aliases: ['低轨高分光学/SAR侦察卫星载荷'],
    group: 'satellite_payload',
    need_building: '卫星制造中心',
    cost: 1800,
    days: 2,
    tier: 1,
    prereqs: ['轨道侦察工学'],
    mass_t: 4,
  },
  {
    id: 'common.unit.aero.geo_ew_comm_sat_payload',
    name: '高轨红外预警与通信卫星载荷',
    aliases: ['高轨红外弹道预警与通信卫星载荷'],
    group: 'satellite_payload',
    need_building: '卫星制造中心',
    cost: 2600,
    days: 2.5,
    tier: 2,
    prereqs: ['卫星组网应用工学'],
    mass_t: 6.5,
  },
  {
    id: 'common.unit.aero.survey_asat_sat_payload',
    name: '天基多光谱资源勘探卫星载荷',
    aliases: ['天基多光谱资源勘探与共轨载荷'],
    group: 'satellite_payload',
    need_building: '卫星制造中心',
    cost: 2200,
    days: 2,
    tier: 2,
    prereqs: ['天基资源勘探工学'],
    mass_t: 5,
  },
  {
    id: 'common.unit.aero.lunar_lander_rover_payload',
    name: '月面无人软着陆器与巡视探测车',
    aliases: ['月球无人着陆巡视器'],
    group: 'satellite_payload',
    need_building: '卫星制造中心',
    cost: 4200,
    days: 3.5,
    tier: 2,
    prereqs: ['无毒推进剂工学', '轨道侦察工学'],
    mass_t: 8,
  },
  {
    id: 'common.unit.aero.orbital_spacecraft_payload',
    name: '宇宙飞船载荷总成',
    aliases: ['无人货运补给飞船 / 载人宇宙飞船'],
    group: 'spacecraft_payload',
    need_building: '大型航天器与舱段总装中心',
    cost: 3800,
    days: 3,
    tier: 2,
    prereqs: ['空间站建造工学'],
    mass_t: 14,
  },
  {
    id: 'common.unit.aero.crewed_lunar_module_payload',
    name: '双级载人登月舱与月面增压车',
    aliases: ['载人登月舱与月面增压车'],
    group: 'spacecraft_payload',
    need_building: '大型航天器与舱段总装中心',
    cost: 6500,
    days: 4.5,
    tier: 3,
    prereqs: ['空间站建造工学'],
    mass_t: 28,
  },
  {
    id: 'common.unit.orbital.modular_station_segments',
    name: '天枢核心舱与空间站模块化舱段总成',
    aliases: [
      '天枢核心控制舱',
      '常驻乘员居住生活舱',
      '微重力高精材料实验舱',
      '标准太阳翼与供配电组件',
      '六向在轨装配节点舱',
    ],
    group: 'spacecraft_payload',
    need_building: '大型航天器与舱段总装中心',
    cost: 5000,
    days: 4,
    tier: 3,
    prereqs: ['空间站建造工学', '在轨组装与发射工学'],
    mass_t: 20,
  },
] as const;

const BONUS_DESC_BY_KIND: Record<OrbitalAsset['kind'], string> = {
  commercial: '商业代发履约完成，持续提供商业航天信誉与回款',
  recon: '天基光学/合成孔径雷达全天候侦察，提供战区视野加成',
  comm: '高通量天基通信中继，提升跨战区指挥链路稳定性',
  navigation: '全球高精度导航授时星座，提升远程制导精度',
  weapon: '天基战略威慑载荷在轨值班',
  station: '大型在轨空间站，提供微重力科研与深空中转能力',
};

/**
 * 归一化 6 大选址枚举（兼容中英文别名）
 */
export function normalizeSiteType(raw: unknown, fallback: BaseSiteType = 'inland_canyon'): BaseSiteType {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return fallback;
  if (s === 'equatorial_coastal' || s.includes('赤道') || s.includes('低纬滨海') || s.includes('滨海')) {
    return 'equatorial_coastal';
  }
  if (s === 'inland_canyon' || s.includes('内陆') || s.includes('深谷')) {
    return 'inland_canyon';
  }
  if (s === 'sea_platform' || s.includes('海上') || s.includes('半潜') || s.includes('海基')) {
    return 'sea_platform';
  }
  if (s === 'high_latitude' || s.includes('高纬') || s.includes('极地')) {
    return 'high_latitude';
  }
  if (s === 'orbital_dock' || s.includes('轨道船坞') || s.includes('深空母港')) {
    return 'orbital_dock';
  }
  if (s === 'lunar_surface' || s.includes('月面') || s.includes('月球')) {
    return 'lunar_surface';
  }
  return fallback;
}

/**
 * 计算天地月 6 大选址在指定轨道与月面基建协同下的硬数值修正（FD-27 §3）
 */
export function evaluateLaunchSiteModifiers(
  siteType?: string | null,
  orbit?: string | null,
  hasMassDriverOrIceStation = false,
): LaunchSiteModifierSpec {
  const normalizedSite = normalizeSiteType(siteType, 'inland_canyon');
  const baseSpec = { ...LAUNCH_SITE_MODIFIERS[normalizedSite] };
  const orb = String(orbit ?? 'LEO').trim().toUpperCase();
  const isGeoOrTli =
    orb.includes('GEO') ||
    orb.includes('GTO') ||
    orb.includes('TLI') ||
    orb.includes('静止') ||
    orb.includes('同步') ||
    orb.includes('奔月') ||
    orb.includes('深空');
  const isGeoOnly =
    orb.includes('GEO') ||
    orb.includes('GTO') ||
    orb.includes('静止') ||
    orb.includes('同步');

  if (normalizedSite === 'inland_canyon') {
    if (isGeoOrTli) {
      baseSpec.payoutMult = 0.9;
      baseSpec.payloadMult = 0.9;
    } else {
      baseSpec.payoutMult = 1.0;
      baseSpec.payloadMult = 1.0;
    }
  } else if (normalizedSite === 'high_latitude') {
    if (isGeoOnly) {
      baseSpec.payoutMult = 0.85;
      baseSpec.payloadMult = 0.8;
    } else {
      baseSpec.payoutMult = 1.25;
      baseSpec.payloadMult = 1.2;
    }
  } else if (normalizedSite === 'orbital_dock') {
    if (hasMassDriverOrIceStation) {
      baseSpec.payoutMult = 1.75;
      baseSpec.naniteCostPerLaunch = 0;
    } else {
      baseSpec.payoutMult = 1.5;
      baseSpec.naniteCostPerLaunch = 50;
    }
  } else if (normalizedSite === 'lunar_surface') {
    if (hasMassDriverOrIceStation) {
      baseSpec.payoutMult = 1.75;
    } else {
      baseSpec.payoutMult = 1.35;
    }
  }

  return baseSpec;
}

/**
 * 查找匹配的可制造航天装备规格
 */
export function findBuildableAeroEquipmentSpec(
  nameOrId: string | undefined | null,
): BuildableAeroEquipmentSpec | undefined {
  const q = String(nameOrId ?? '').trim();
  if (!q) return undefined;
  return BUILDABLE_AERO_EQUIPMENT_CATALOG.find(
    spec => spec.id === q || spec.name === q || spec.aliases.includes(q),
  );
}

/**
 * 将 `forces.equipment` 中匹配的航天装备同步映射到 `space.equipment_stock`（FD-27 D7-A）
 */
export function syncAeroEquipmentStock(state: Partial<Schema>): Record<string, number> {
  if (!state.space) {
    state.space = {
      orbital_assets: [],
      contracts: [],
      reusable_boosters: 0,
    };
  }
  const existingStock: Record<string, number> = { ...(state.space.equipment_stock ?? {}) };
  const forceEquip = state.forces?.equipment ?? {};

  for (const [rawKey, rawQty] of Object.entries(forceEquip)) {
    const spec = findBuildableAeroEquipmentSpec(rawKey);
    if (!spec) continue;
    const qty = Math.max(0, Math.floor(Number(rawQty) || 0));
    existingStock[spec.name] = qty;
  }

  state.space.equipment_stock = existingStock;
  return existingStock;
}

export interface DerivedLaunchCenterRecord extends LaunchCenterRecord {
  /** 是否激活【国家航天城 · 产装测发流水线】小巨构加成（回款+25%） */
  isSpaceportCity: boolean;
  /** 是否激活【两级完全复用 · 星舰极速周转阵列】加成 */
  isFullReuseStarbase: boolean;
  /** 当前基地局部天气（回退 meta.weather；轨道/月面恒为 真空无气象） */
  weather: string;
  /** 相对首基地标准时区偏移 */
  tz_offset: number;
  /** 当前选址硬数值修正 */
  modifiers: LaunchSiteModifierSpec;
  /** 当前发射中心在标准轨道下的最大运载吨位 */
  maxPayloadTons: number;
}

function clampTierBySite(tier: number, siteType: BaseSiteType): 1 | 2 | 3 {
  const maxTier = LAUNCH_SITE_MODIFIERS[siteType].maxTier;
  const clamped = Math.max(1, Math.min(maxTier, Math.round(tier || 1)));
  return (clamped === 3 ? 3 : clamped === 2 ? 2 : 1) as 1 | 2 | 3;
}

function checkHasLunarMassDriverOrIce(state: Partial<Schema>): boolean {
  const completedSlots = state.space?.completed_slots ?? {};
  if (
    completedSlots['lun_mass_driver'] ||
    completedSlots['ln_mass_driver'] ||
    completedSlots['lun_ice_mine'] ||
    completedSlots['ln_ice_mine']
  ) {
    return true;
  }
  const bases = Array.isArray(state.bases) ? state.bases : [];
  for (const b of bases) {
    for (const bld of b?.buildings ?? []) {
      if (!bld || (bld.state && bld.state !== '运转')) continue;
      if (
        bld.name.includes('月面电磁质量投射器') ||
        bld.name.includes('质量投射器') ||
        bld.name.includes('水冰钻探') ||
        bld.name.includes('水冰电解站')
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 自动扫描 `state.bases` 与 `state.space.launch_centers` 派生完整发射中心列表，
 * 自动将基地独立航天设施映射点亮发射中心对应拓扑插槽，并判定航天城小巨构激活态（FD-27 §4.1/§4.2）
 */
export function deriveLaunchCentersFromState(state: Partial<Schema>): DerivedLaunchCenterRecord[] {
  const bases = Array.isArray(state.bases) ? state.bases : [];
  const explicitCenters = Array.isArray(state.space?.launch_centers) ? state.space!.launch_centers! : [];
  const hasMassDriverOrIce = checkHasLunarMassDriverOrIce(state);
  const metaWeather = String(state.meta?.weather ?? '晴').trim() || '晴';

  const resultByBase = new Map<string, DerivedLaunchCenterRecord>();

  // 1. 先载入显式声明的 launch_centers
  for (const explicit of explicitCenters) {
    if (!explicit || !explicit.base) continue;
    const matchedBase = bases.find(b => b && (b.id === explicit.base || b.name === explicit.base));
    const baseKey = matchedBase ? matchedBase.name : explicit.base;
    const siteType = normalizeSiteType(
      explicit.site_type || matchedBase?.site_type,
      'inland_canyon',
    );
    const tier = clampTierBySite(explicit.tier ?? 1, siteType);
    const mountedSlots: Record<string, string> = { ...(explicit.mounted_slots ?? {}) };
    if (Object.keys(mountedSlots).length === 0) {
      mountedSlots['lc_pad_1'] = 'asset.lc.pad_std';
    }
    const baseIdx = matchedBase ? bases.indexOf(matchedBase) : -1;
    const tzOffset = baseIdx === 0 ? 0 : (matchedBase?.tz_offset ?? 0);
    const modifiers = evaluateLaunchSiteModifiers(siteType, 'LEO', hasMassDriverOrIce);
    const weather = modifiers.immuneToEarthWeather
      ? '真空无气象'
      : String(matchedBase?.weather ?? metaWeather).trim() || '晴';

    resultByBase.set(baseKey, {
      id: explicit.id || `lc:${baseKey}`,
      base: baseKey,
      name: explicit.name || `${baseKey}航天发射中心`,
      site_type: siteType,
      tier,
      status: explicit.status ?? '运转',
      mounted_slots: mountedSlots,
      isSpaceportCity: false,
      isFullReuseStarbase: false,
      weather,
      tz_offset: tzOffset,
      modifiers,
      maxPayloadTons: 8 * modifiers.payloadMult,
    });
  }

  // 2. 扫描 bases 中的航天发射建筑与三大航天制造建筑并自动映射点亮插槽
  bases.forEach((base, idx) => {
    if (!base || base.status === '废弃') return;
    const buildings = Array.isArray(base.buildings) ? base.buildings : [];
    const activeNames = buildings
      .filter(b => b && typeof b.name === 'string' && (b.state ?? '运转') === '运转')
      .map(b => b.name.trim());
    const allNames = buildings
      .filter(b => b && typeof b.name === 'string')
      .map(b => b.name.trim());

    const hasLaunchpad = allNames.some(n =>
      LAUNCHPAD_BUILDINGS.some(pad => n === pad || n.includes(pad)),
    );
    const hasAeroMfg = allNames.some(n =>
      AERO_MANUFACTURING_BUILDINGS.some(mfg => n === mfg || n.includes(mfg)),
    );
    const hasOrbitalDock = allNames.some(n => n.includes('轨道船坞'));
    const hasLunarFacility = allNames.some(
      n => n.includes('月面') || n.includes('月球'),
    );

    const existing =
      resultByBase.get(base.name) ?? resultByBase.get(base.id);
    if (!existing && !hasLaunchpad && !hasAeroMfg && !hasOrbitalDock && !hasLunarFacility) {
      return;
    }

    const baseKey = existing ? existing.base : base.name;
    let siteType: BaseSiteType = existing?.site_type ?? 'inland_canyon';
    if (base.site_type) {
      siteType = normalizeSiteType(base.site_type, siteType);
    } else if (!existing) {
      if (hasOrbitalDock) siteType = 'orbital_dock';
      else if (hasLunarFacility || base.location?.includes('月')) siteType = 'lunar_surface';
      else if (base.location) siteType = normalizeSiteType(base.location, 'inland_canyon');
    }

    const slots: Record<string, string> = { ...(existing?.mounted_slots ?? {}) };
    let derivedTier: number = existing?.tier ?? 1;

    if (hasLaunchpad || existing) {
      slots['lc_pad_1'] ??= 'asset.lc.pad_std';
      slots['lc_prop_yard'] ??= 'asset.lc.propellant_std';
    }
    if (
      activeNames.some(
        n => n.includes('重型航天发射场') || n.includes('赤星轨道战略投送阵列'),
      )
    ) {
      slots['lc_hif'] ??= 'asset.lc.vab_vertical';
      slots['lc_pad_2'] ??= 'asset.lc.pad_cryo';
      slots['lc_crawler_way'] ??= 'asset.lc.crawler_std';
      derivedTier = Math.max(derivedTier, 2);
    }
    if (
      activeNames.some(
        n => n.includes('大型航天发射综合体') || n.includes('巨型航天发射港'),
      )
    ) {
      slots['lc_hif'] = 'asset.lc.vab_vertical';
      slots['lc_pad_2'] ??= 'asset.lc.pad_cryo';
      slots['lc_crawler_way'] = 'asset.lc.crawler_super_base';
      derivedTier = Math.max(derivedTier, 3);
    }
    if (activeNames.some(n => n.includes('卫星测控站') || n.includes('间谍卫星上行站'))) {
      slots['lc_telemetry_1'] ??= 'asset.lc.telemetry_mobile';
    }
    if (activeNames.some(n => n.includes('深空测控网络'))) {
      slots['lc_telemetry_1'] ??= 'asset.lc.telemetry_mobile';
      slots['lc_weather_tower'] ??= 'asset.lc.weather_lightning_tower';
      derivedTier = Math.max(derivedTier, 2);
    }
    if (activeNames.some(n => n.includes('火箭制造厂'))) {
      slots['lc_hif'] ??= 'asset.lc.hif_horizontal';
      slots['lc_underground_fab'] = 'asset.lc.underground_rocket_fab';
    }
    if (activeNames.some(n => n.includes('卫星制造中心'))) {
      slots['lc_sat_cleanroom'] = 'asset.lc.cleanroom_sat_line';
    }
    if (activeNames.some(n => n.includes('大型航天器与舱段总装中心'))) {
      slots['lc_hif'] = 'asset.lc.vab_vertical';
      slots['lc_sat_cleanroom'] = 'asset.lc.cleanroom_sat_line';
      slots['lc_crawler_way'] = 'asset.lc.crawler_super_base';
      derivedTier = Math.max(derivedTier, 3);
    }
    if (activeNames.some(n => n.includes('化工合成厂'))) {
      slots['lc_cryo_plant'] ??= 'asset.lc.cryo_methalox_plant';
    }
    if (siteType === 'orbital_dock' || siteType === 'lunar_surface') {
      derivedTier = Math.max(derivedTier, 3);
    }

    const hasAllThreeMfgBuildings =
      activeNames.some(n => n.includes('火箭制造厂')) &&
      activeNames.some(n => n.includes('卫星制造中心')) &&
      activeNames.some(n => n.includes('大型航天器与舱段总装中心')) &&
      activeNames.some(n => LAUNCHPAD_BUILDINGS.some(pad => n === pad || n.includes(pad)));

    if (hasAllThreeMfgBuildings) {
      slots['lc_hif'] = 'asset.lc.vab_vertical';
      slots['lc_underground_fab'] = 'asset.lc.underground_rocket_fab';
      slots['lc_sat_cleanroom'] = 'asset.lc.cleanroom_sat_line';
      slots['lc_cryo_plant'] ??= 'asset.lc.cryo_methalox_plant';
      slots['lc_pad_super'] ??= 'asset.lc.pad_mechazilla';
      derivedTier = 3;
    }

    const finalTier = clampTierBySite(derivedTier, siteType);
    const isOperational =
      existing?.status === '运转' ||
      activeNames.some(n => LAUNCHPAD_BUILDINGS.some(pad => n === pad || n.includes(pad))) ||
      hasOrbitalDock ||
      hasLunarFacility;

    const tzOffset = idx === 0 ? 0 : (base.tz_offset ?? 0);
    const modifiers = evaluateLaunchSiteModifiers(siteType, 'LEO', hasMassDriverOrIce);
    const weather = modifiers.immuneToEarthWeather
      ? '真空无气象'
      : String(base.weather ?? existing?.weather ?? metaWeather).trim() || '晴';

    resultByBase.set(baseKey, {
      id: existing?.id || `lc:${base.id || base.name}`,
      base: baseKey,
      name: existing?.name || `${base.name}航天发射中心`,
      site_type: siteType,
      tier: finalTier,
      status: isOperational ? '运转' : (existing?.status ?? '建造中'),
      mounted_slots: slots,
      isSpaceportCity: false,
      isFullReuseStarbase: false,
      weather,
      tz_offset: tzOffset,
      modifiers,
      maxPayloadTons: 8 * modifiers.payloadMult,
    });
  });

  // 3. 结算各发射中心的羁绊（isSpaceportCity / isFullReuseStarbase）与最大运力
  for (const center of resultByBase.values()) {
    const s = center.mounted_slots;
    const hasFab = Boolean(s['lc_underground_fab']);
    const hasCleanroom = Boolean(s['lc_sat_cleanroom']);
    const hasAssembly = Boolean(s['lc_hif']);
    const hasPropellantOrCryo = Boolean(s['lc_cryo_plant'] || s['lc_prop_yard']);

    const isSpaceportCity =
      center.site_type !== 'sea_platform' &&
      hasFab &&
      hasCleanroom &&
      hasAssembly &&
      hasPropellantOrCryo;

    const isFullReuseStarbase =
      Boolean(s['lc_pad_super']) &&
      Boolean(s['lc_recovery_zone']) &&
      Boolean(s['lc_cryo_plant']);

    if (isSpaceportCity && center.tier < 3) {
      center.tier = clampTierBySite(3, center.site_type);
    }

    center.isSpaceportCity = isSpaceportCity;
    center.isFullReuseStarbase = isFullReuseStarbase;

    const baseCapByTier =
      center.tier >= 3 ? (isFullReuseStarbase ? 80 : 65) : center.tier === 2 ? 35 : 8;
    center.maxPayloadTons = Math.round(baseCapByTier * center.modifiers.payloadMult * 100) / 100;
  }

  return Array.from(resultByBase.values());
}

export const deriveBaseLaunchCenters = deriveLaunchCentersFromState;

function normalizeContractKind(
  raw: unknown,
  payload = '',
  title = '',
): SpaceContract['kind'] {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'commercial' || s.includes('商业')) return 'commercial';
  if (s === 'recon' || s.includes('侦察') || s.includes('遥感')) return 'recon';
  if (s === 'constellation' || s === '星座' || s.includes('组网星座')) return 'constellation';
  if (s === 'comm' || s.includes('通信') || s.includes('中继')) return 'comm';
  if (s === 'station' || s.includes('空间站') || s.includes('轨道站') || s.includes('核心舱') || s.includes('实验舱')) {
    return 'station';
  }
  const combined = `${payload} ${title}`.trim().toLowerCase();
  if (combined.includes('recon') || combined.includes('侦察') || combined.includes('遥感')) return 'recon';
  if (combined.includes('constellation') || combined.includes('星座')) return 'constellation';
  if (combined.includes('comm') || combined.includes('通信') || combined.includes('中继')) return 'comm';
  if (
    combined.includes('station') ||
    combined.includes('空间站') ||
    combined.includes('轨道站') ||
    combined.includes('核心舱') ||
    combined.includes('实验舱')
  ) {
    return 'station';
  }
  return 'commercial';
}

function isExplicitHoldStatus(raw: unknown): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  return (
    s === 'hold' ||
    s === 'weather_hold' ||
    s === '挂起' ||
    s === '气象挂起' ||
    s === '延期' ||
    s === '推迟' ||
    s === '暂停'
  );
}

function isExplicitCompletedStatus(raw: unknown): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  return (
    s === 'completed' ||
    s === 'launched' ||
    s === 'success' ||
    s === '成功' ||
    s === '发射成功' ||
    s === '已发射' ||
    s === '入轨' ||
    s === '已完成' ||
    s === '完成' ||
    s === '已完结' ||
    s === '完结'
  );
}

function isExplicitFailedStatus(raw: unknown): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  return (
    s === 'failed' ||
    s === '失败' ||
    s === '发射失败' ||
    s === '事故' ||
    s === '损毁' ||
    s === '爆炸' ||
    s === '解体'
  );
}

function normalizeContractStatus(raw: unknown): SpaceContract['status'] {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'pending';
  if (s === 'launching' || s === '发射中' || s === '点火') return 'launching';
  if (s === 'in_orbit' || s === '在轨' || s === '已入轨') return 'in_orbit';
  if (s === 'in_progress' || s === '执行中' || s === '进行中' || s === '履约中') return 'in_progress';
  if (isExplicitCompletedStatus(s)) return 'completed';
  if (isExplicitFailedStatus(s)) return 'failed';
  return 'pending';
}

function normalizeCenterStatus(raw: unknown): LaunchCenterRecord['status'] {
  const s = String(raw ?? '').trim();
  if (s === '建造中' || s === 'building') return '建造中';
  if (s === '受损' || s === 'damaged') return '受损';
  if (s === '停机' || s === 'offline') return '停机';
  return '运转';
}

function normalizeBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  const s = String(raw ?? '').trim().toLowerCase();
  if (['true', 'yes', '1', '是', '回收', '开启', '启用'].includes(s)) return true;
  if (['false', 'no', '0', '否', '不回收', '关闭', '禁用'].includes(s)) return false;
  return false;
}

function normalizeNumber(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const cleaned = String(raw ?? '')
    .replace(/[,，_\s]/g, '')
    .replace(/[^\d.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalizePayloadSource(raw: unknown): 'domestic' | 'commercial' | undefined {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return undefined;
  if (s === 'commercial' || s.includes('商业') || s.includes('外部')) return 'commercial';
  if (s === 'domestic' || s.includes('自产') || s.includes('自家') || s.includes('自有')) return 'domestic';
  return undefined;
}

function normalizeScope(raw: unknown): 'theater' | 'base' | undefined {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return undefined;
  if (s === 'base' || s === '基地' || s === '单基地' || s === '局部') return 'base';
  if (s === 'theater' || s === '战区' || s === '全战区' || s === '全局') return 'theater';
  return undefined;
}

function parseMassFromText(text: string): number | undefined {
  const m = text.match(/[(（]\s*(\d+(?:\.\d+)?)\s*(?:t|吨)\s*[)）]/i);
  if (m) {
    const val = Number(m[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }
  return undefined;
}

function parseMountedSlotsValue(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (k.trim() && v != null) out[k.trim()] = String(v).trim();
    }
    return out;
  }
  const str = String(raw).trim().replace(/^\[|\]$/g, '');
  if (!str) return {};
  const out: Record<string, string> = {};
  for (const part of str.split(/[,，;；]/)) {
    const seg = part.trim();
    if (!seg) continue;
    const colonIdx = seg.search(/[:：=]/);
    if (colonIdx > 0) {
      const slotId = seg.slice(0, colonIdx).trim();
      const assetId = seg.slice(colonIdx + 1).trim();
      if (slotId && assetId) out[slotId] = assetId;
    } else {
      out[seg] = seg;
    }
  }
  return out;
}

const CONTRACT_SECTION_HEADER_KEYS = new Set([
  'contracts',
  'commercial_orders',
  'orders',
  'missions',
  'tasks',
  '合同',
  '商业合同',
  '航天合同',
  '发射合同',
  '商业订单',
  '任务',
  '发射任务',
  '航天任务',
]);

const LAUNCH_CENTER_SECTION_HEADER_KEYS = new Set([
  '发射中心',
  'launch_centers',
  '发射场',
]);

const ORBITAL_ASSET_SECTION_HEADER_KEYS = new Set([
  '星座',
  '在轨',
  '在轨资产',
  '卫星',
  '轨道资产',
  '在轨星座',
  'orbital_assets',
  'constellations',
  'satellites',
]);

const SPACE_SECTION_HEADER_KEYS = new Set([
  ...CONTRACT_SECTION_HEADER_KEYS,
  ...LAUNCH_CENTER_SECTION_HEADER_KEYS,
  ...ORBITAL_ASSET_SECTION_HEADER_KEYS,
]);

function isLaunchCenterRecordRaw(rec: Record<string, unknown>): boolean {
  if (rec.__section === 'launch_center') return true;
  if (rec.__section === 'contract' || rec.__section === 'orbital_asset') return false;
  const cat = String(rec['类别'] ?? rec.category ?? rec.type ?? rec['类型'] ?? '').trim().toLowerCase();
  if (cat === '发射中心' || cat === 'launch_center' || cat === '航天发射中心') {
    return true;
  }
  const hasSiteOrSlots =
    rec['选址'] !== undefined ||
    rec.site_type !== undefined ||
    rec['模块'] !== undefined ||
    rec.mounted_slots !== undefined ||
    rec.slots !== undefined;
  const hasContractFields =
    rec['载荷'] !== undefined ||
    rec['有效载荷'] !== undefined ||
    rec.payload !== undefined ||
    rec['报酬'] !== undefined ||
    rec['合同款'] !== undefined ||
    rec.reward_credits !== undefined;
  return hasSiteOrSlots && !hasContractFields;
}

function isOrbitalAssetRecordRaw(rec: Record<string, unknown>): boolean {
  if (rec.__section === 'orbital_asset') return true;
  if (rec.__section === 'contract' || rec.__section === 'launch_center') return false;
  const cat = String(rec['类别'] ?? rec.category ?? '').trim().toLowerCase();
  if (
    cat === '星座' ||
    cat === '在轨' ||
    cat === '在轨资产' ||
    cat === '卫星' ||
    cat === 'orbital_asset'
  ) {
    return true;
  }
  const hasBonus =
    rec['加成'] !== undefined ||
    rec['效果'] !== undefined ||
    rec['增益'] !== undefined ||
    rec.bonus !== undefined ||
    rec.bonus_desc !== undefined ||
    rec.effect !== undefined;
  const statusStr = String(rec.status ?? rec['状态'] ?? '').trim().toLowerCase();
  const isOrbitalStatus =
    statusStr === '在轨运转' ||
    statusStr === '在轨运行' ||
    statusStr === 'active' ||
    statusStr === 'degraded' ||
    statusStr === 'deorbited';
  const hasContractFields =
    rec['报酬'] !== undefined ||
    rec['合同款'] !== undefined ||
    rec.reward_credits !== undefined ||
    rec.reward !== undefined ||
    rec['委托方'] !== undefined ||
    rec.client !== undefined ||
    rec['载荷'] !== undefined ||
    rec['有效载荷'] !== undefined ||
    rec.payload !== undefined ||
    rec['运载火箭'] !== undefined ||
    rec.rocket !== undefined ||
    rec['回收助推器'] !== undefined ||
    rec.recover_booster !== undefined ||
    rec['合同编号'] !== undefined;
  return (hasBonus || isOrbitalStatus) && !hasContractFields;
}

function normalizeOrbitalAssetKind(raw: unknown, name = ''): OrbitalAsset['kind'] {
  const s = `${String(raw ?? '')} ${name}`.trim().toLowerCase();
  if (s.includes('recon') || s.includes('侦察') || s.includes('遥感') || s.includes('鹰眼') || s.includes('预警')) {
    return 'recon';
  }
  if (s.includes('navigation') || s.includes('导航') || s.includes('授时') || s.includes('北斗')) {
    return 'navigation';
  }
  if (s.includes('weapon') || s.includes('天基动能') || s.includes('武器') || s.includes('打击')) {
    return 'weapon';
  }
  if (s.includes('station') || s.includes('空间站') || s.includes('轨道站') || s.includes('核心舱') || s.includes('实验舱')) {
    return 'station';
  }
  if (s.includes('comm') || s.includes('通信') || s.includes('中继') || s.includes('信标') || s.includes('星座')) {
    return 'comm';
  }
  return 'commercial';
}

function normalizeOrbitalAssetStatus(raw: unknown): OrbitalAsset['status'] {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'active';
  if (s === 'degraded' || s.includes('受损') || s.includes('降级') || s.includes('衰减') || s.includes('故障')) {
    return 'degraded';
  }
  if (s === 'deorbited' || s.includes('离轨') || s.includes('坠毁') || s.includes('失效') || s.includes('损毁') || s.includes('报废')) {
    return 'deorbited';
  }
  return 'active';
}

function mapRawRecordToOrbitalAsset(
  rec: Record<string, unknown>,
  fallbackIndex: number,
): OrbitalAsset | null {
  const name = String(
    rec.name ?? rec['名称'] ?? rec['卫星'] ?? rec['星座'] ?? rec['载荷'] ?? '',
  ).trim();
  const idRaw = String(rec.id ?? rec['编号'] ?? '').trim();
  if (!name && !idRaw) return null;
  const effectiveName = name || idRaw;
  const id = idRaw || `orb:${effectiveName || fallbackIndex}`;
  const kind = normalizeOrbitalAssetKind(rec.kind ?? rec.type ?? rec['类型'], effectiveName);
  const orbit =
    String(rec.orbit ?? rec['轨道'] ?? rec['目标轨道'] ?? 'LEO').trim().toUpperCase() || 'LEO';
  const status = normalizeOrbitalAssetStatus(rec.status ?? rec['状态']);
  const bonusRaw = String(
    rec.bonus_desc ?? rec.bonus ?? rec.effect ?? rec['加成'] ?? rec['效果'] ?? rec['增益'] ?? '',
  ).trim();
  const bonus_desc = bonusRaw || BONUS_DESC_BY_KIND[kind] || '在轨载荷稳定运行';
  const dayRaw = rec.launched_at_day ?? rec['入轨天数'] ?? rec['发射日'];
  const launched_at_day = dayRaw !== undefined ? Math.max(1, normalizeNumber(dayRaw) || 1) : 1;

  return OrbitalAsset.parse({
    id,
    name: effectiveName,
    kind,
    orbit,
    status,
    launched_at_day,
    bonus_desc,
  });
}

function mapRawRecordToLaunchCenter(
  rec: Record<string, unknown>,
  fallbackIndex: number,
): LaunchCenterRecord | null {
  const base = String(rec.base ?? rec['基地'] ?? rec['发射场'] ?? '').trim();
  const nameRaw = String(rec.name ?? rec['名称'] ?? '').trim();
  if (!base && !nameRaw) return null;
  const effectiveBase = base || nameRaw;
  const idRaw = String(rec.id ?? rec['编号'] ?? '').trim();
  const id = idRaw || `lc:${effectiveBase || fallbackIndex}`;
  const name = nameRaw || `${effectiveBase}航天发射中心`;
  const siteType = normalizeSiteType(rec.site_type ?? rec['选址'], 'inland_canyon');
  const rawTier = normalizeNumber(rec.tier ?? rec['等级']);
  const tier = clampTierBySite(rawTier > 0 ? rawTier : 1, siteType);
  const status = normalizeCenterStatus(rec.status ?? rec['状态']);
  const mounted_slots = parseMountedSlotsValue(
    rec.mounted_slots ?? rec.slots ?? rec['模块'] ?? rec['插槽'],
  );

  return LaunchCenterRecord.parse({
    id,
    base: effectiveBase,
    name,
    site_type: siteType,
    tier,
    status,
    mounted_slots,
  });
}

function setHiddenMeta<T extends object>(
  obj: T,
  key: 'explicit_hold' | 'explicit_completed' | 'explicit_failed' | '__section',
  value: unknown,
): void {
  Object.defineProperty(obj, key, {
    value,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

function mapRawRecordToContract(rec: Record<string, unknown>, fallbackIndex: number): SpaceContract | null {
  if (isLaunchCenterRecordRaw(rec) || isOrbitalAssetRecordRaw(rec)) return null;

  const idRaw = rec.id ?? rec['编号'] ?? rec['合同编号'];
  const titleRaw = rec.title ?? rec['名称'] ?? rec['合同名称'];
  const id = String(idRaw ?? '').trim() || (titleRaw ? `space-contract-${fallbackIndex}` : '');
  const title = String(titleRaw ?? '').trim() || id;
  if (!id && !title) return null;

  const rocket =
    String(rec.rocket ?? rec['运载火箭'] ?? rec['火箭'] ?? '').trim() || '通用中型运载火箭';
  const payload =
    String(rec.payload ?? rec['载荷'] ?? rec['有效载荷'] ?? '').trim() || '商业通信卫星';
  const kind = normalizeContractKind(rec.kind ?? rec['类型'], payload, title);
  const base = String(
    rec.base ??
      rec.launch_base ??
      rec['发射基地'] ??
      rec['所属基地'] ??
      rec['发射场'] ??
      rec['基地'] ??
      '',
  ).trim();
  const reward_credits = normalizeNumber(
    rec.reward_credits ??
      rec.reward ??
      rec['报酬'] ??
      rec['合同款'] ??
      rec['里程碑打款'] ??
      rec['奖励'] ??
      rec['金额'],
  );
  const recover_booster = normalizeBoolean(rec.recover_booster ?? rec['回收助推器']);
  const useStoredBoosterRaw =
    rec.use_stored_booster ??
    rec.useStoredBooster ??
    rec['复用助推器'] ??
    rec['使用库存助推器'] ??
    rec['调用库存助推器'] ??
    rec['复用库存助推器'];
  const use_stored_booster =
    useStoredBoosterRaw !== undefined ? normalizeBoolean(useStoredBoosterRaw) : undefined;
  const rawStatusVal = rec.status ?? rec['状态'];
  const status = normalizeContractStatus(rawStatusVal);
  const durationRaw =
    rec.duration_days ?? rec.duration ?? rec['总天数'] ?? rec['周期'] ?? rec['工期'] ?? rec['天数'];
  const elapsedRaw =
    rec.elapsed_days ?? rec.elapsed ?? rec['已执行天数'] ?? rec['已过天数'] ?? rec['已用天数'];
  const weatherHoldRaw =
    rec.weather_hold_reason ??
    rec.failure_reason ??
    rec['气象挂起原因'] ??
    rec['挂起原因'] ??
    rec['延期原因'] ??
    rec['事故原因'] ??
    rec['失败原因'];

  const launchCenterIdRaw = rec.launch_center_id ?? rec['发射中心'] ?? rec['发射中心编号'];
  const targetSlotRaw = rec.target_slot ?? rec['目标插槽'] ?? rec['插槽'];
  const assetIdRaw = rec.asset_id ?? rec['构件编号'] ?? rec['资产编号'];
  const massRaw = rec.mass_t ?? rec.payload_tons ?? rec['载荷质量'] ?? rec['质量'] ?? rec['吨位'];
  const payloadSource = normalizePayloadSource(
    rec.payload_source ?? rec['载荷来源'] ?? rec['来源'] ?? rec.kind ?? rec['类型'],
  );
  const clientRaw = rec.client ?? rec['委托方'] ?? rec['客户'];
  const scope = normalizeScope(rec.scope ?? rec['作用域']);
  const targetBaseRaw = rec.target_base ?? rec['赋能基地'] ?? rec['目标基地'];
  const orbitRaw = rec.orbit ?? rec['目标轨道'] ?? rec['轨道'];

  const contract: SpaceContractWithMeta = {
    id,
    title,
    kind,
    rocket,
    payload,
    base,
    reward_credits,
    recover_booster,
    status,
  };
  if (use_stored_booster !== undefined) {
    contract.use_stored_booster = use_stored_booster;
  }
  const hasHoldReason = typeof weatherHoldRaw === 'string' && weatherHoldRaw.trim().length > 0;
  if (hasHoldReason) {
    contract.weather_hold_reason = weatherHoldRaw.trim();
  }
  if (isExplicitFailedStatus(rawStatusVal)) {
    setHiddenMeta(contract, 'explicit_failed', true);
    if (hasHoldReason) {
      contract.failure_reason = weatherHoldRaw.trim();
    }
  } else if (isExplicitCompletedStatus(rawStatusVal)) {
    setHiddenMeta(contract, 'explicit_completed', true);
  } else if (isExplicitHoldStatus(rawStatusVal) || (hasHoldReason && status === 'pending')) {
    setHiddenMeta(contract, 'explicit_hold', true);
  }
  if (typeof launchCenterIdRaw === 'string' && launchCenterIdRaw.trim()) {
    contract.launch_center_id = launchCenterIdRaw.trim();
  }
  if (typeof targetSlotRaw === 'string' && targetSlotRaw.trim()) {
    contract.target_slot = targetSlotRaw.trim();
  }
  if (typeof assetIdRaw === 'string' && assetIdRaw.trim()) {
    contract.asset_id = assetIdRaw.trim();
  }
  const explicitMass = massRaw !== undefined ? normalizeNumber(massRaw) : undefined;
  const parsedMass = explicitMass && explicitMass > 0 ? explicitMass : parseMassFromText(payload);
  if (parsedMass !== undefined && parsedMass > 0) {
    contract.mass_t = parsedMass;
  }
  if (payloadSource) {
    contract.payload_source = payloadSource;
  }
  if (typeof clientRaw === 'string' && clientRaw.trim()) {
    contract.client = clientRaw.trim();
  }
  if (scope) {
    contract.scope = scope;
  }
  if (typeof targetBaseRaw === 'string' && targetBaseRaw.trim()) {
    contract.target_base = targetBaseRaw.trim();
  }
  if (typeof orbitRaw === 'string' && orbitRaw.trim()) {
    contract.orbit = orbitRaw.trim().toUpperCase();
  }
  if (durationRaw !== undefined && String(durationRaw).trim() !== '') {
    const d = normalizeNumber(durationRaw);
    if (d > 0) contract.duration_days = d;
  }
  if (elapsedRaw !== undefined && String(elapsedRaw).trim() !== '') {
    const e = normalizeNumber(elapsedRaw);
    if (e >= 0) contract.elapsed_days = e;
  }
  return contract;
}

const SPACE_CONTRACT_BLOCK_RE = /<(?:航天合同|航天|天基|太空)>([\s\S]*?)<\/(?:航天合同|航天|天基|太空)>/g;

export function stripSpaceBlocks(rawText: string): string {
  if (typeof rawText !== 'string' || !rawText) return '';
  if (!/<(?:航天合同|航天|天基|太空|发射中心)>/.test(rawText)) return rawText;
  return rawText
    .replace(new RegExp(SPACE_CONTRACT_BLOCK_RE.source, 'g'), '')
    .replace(/<发射中心>[\s\S]*?<\/发射中心>/g, '');
}

function parseRawRecordsFromBlockInner(inner: string): Record<string, unknown>[] {
  const lines = inner
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('//') && !l.startsWith('```'));

  if (lines.length === 0) return [];

  const records: Record<string, unknown>[] = [];
  let current: Record<string, unknown> = {};
  let currentSection: 'contract' | 'launch_center' | 'orbital_asset' | undefined;

  const flushCurrent = () => {
    if (Object.keys(current).length > 0) {
      if (currentSection && current.__section === undefined) {
        setHiddenMeta(current, '__section', currentSection);
      }
      records.push(current);
      current = {};
    }
  };

  for (const rawLine of lines) {
    let line = rawLine;
    const isListItem = line.startsWith('- ');
    if (isListItem) {
      flushCurrent();
      line = line.slice(2).trim();
    }
    const noCommentLine = line.replace(/\s+#.*$/, '').trim();
    const match = noCommentLine.match(/^([^:：=]+?)\s*[:：=]\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().replace(/^['"]|['"]$/g, '');
    const val = match[2].trim().replace(/^['"]|['"]$/g, '');
    if (val === '' && SPACE_SECTION_HEADER_KEYS.has(key)) {
      flushCurrent();
      if (ORBITAL_ASSET_SECTION_HEADER_KEYS.has(key)) {
        currentSection = 'orbital_asset';
      } else if (LAUNCH_CENTER_SECTION_HEADER_KEYS.has(key)) {
        currentSection = 'launch_center';
      } else {
        currentSection = 'contract';
      }
      continue;
    }
    if (
      (key === 'id' || key === '编号' || key === '合同编号') &&
      (current.id || current['编号'] || current['合同编号'])
    ) {
      flushCurrent();
    }
    current[key] = val;
  }
  flushCurrent();
  return records;
}

function parseContractBlockInner(inner: string, startIndex: number): SpaceContract[] {
  const records = parseRawRecordsFromBlockInner(inner);
  const result: SpaceContract[] = [];
  records.forEach((rec, idx) => {
    const c = mapRawRecordToContract(rec, startIndex + idx + 1);
    if (c) result.push(c);
  });
  return result;
}

/**
 * 提取文本中所有 `<航天合同>/<航天>/<天基>/<太空>` 块并解析为 SpaceContract 列表
 */
export function extractSpaceContracts(rawText: string): SpaceContract[] {
  if (typeof rawText !== 'string' || !/<(?:航天合同|航天|天基|太空)>/.test(rawText)) {
    return [];
  }
  const contracts: SpaceContract[] = [];
  const regex = new RegExp(SPACE_CONTRACT_BLOCK_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawText)) !== null) {
    const parsed = parseContractBlockInner(match[1], contracts.length);
    contracts.push(...parsed);
  }
  return contracts;
}

/**
 * 提取文本中所有 `<航天合同>/<航天>/<天基>/<太空>` 块内的 `星座 / 在轨 / 在轨资产 / 卫星` 条目
 */
export function extractOrbitalAssets(rawText: string): OrbitalAsset[] {
  if (typeof rawText !== 'string' || !/<(?:航天合同|航天|天基|太空)>/.test(rawText)) {
    return [];
  }
  const assets: OrbitalAsset[] = [];
  const regex = new RegExp(SPACE_CONTRACT_BLOCK_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawText)) !== null) {
    const records = parseRawRecordsFromBlockInner(match[1]);
    records.forEach((rec, idx) => {
      if (isOrbitalAssetRecordRaw(rec)) {
        const a = mapRawRecordToOrbitalAsset(rec, assets.length + idx + 1);
        if (a) assets.push(a);
      }
    });
  }
  return assets;
}

/**
 * 提取文本中所有 `<发射中心>...</发射中心>` 块及 `<航天合同>/<航天>/<天基>/<太空>` 内 `类别: 发射中心` 条目
 */
export function extractLaunchCenters(rawText: string): LaunchCenterRecord[] {
  if (typeof rawText !== 'string' || !/<(?:航天合同|航天|天基|太空|发射中心)>/.test(rawText)) {
    return [];
  }
  const centers: LaunchCenterRecord[] = [];

  const contractRegex = new RegExp(SPACE_CONTRACT_BLOCK_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = contractRegex.exec(rawText)) !== null) {
    const records = parseRawRecordsFromBlockInner(match[1]);
    records.forEach((rec, idx) => {
      if (isLaunchCenterRecordRaw(rec)) {
        const c = mapRawRecordToLaunchCenter(rec, centers.length + idx + 1);
        if (c) centers.push(c);
      }
    });
  }

  const centerRegex = /<发射中心>([\s\S]*?)<\/发射中心>/g;
  while ((match = centerRegex.exec(rawText)) !== null) {
    const records = parseRawRecordsFromBlockInner(match[1]);
    records.forEach((rec, idx) => {
      const c = mapRawRecordToLaunchCenter(rec, centers.length + idx + 1);
      if (c) centers.push(c);
    });
  }

  return centers;
}

/**
 * 从已解析的 YAML/JSON 对象或数组（如 `<态势>.航天`）中提取 SpaceContract、LaunchCenterRecord 与 OrbitalAsset
 */
export function extractSpaceFromParsedValue(val: unknown): {
  contracts: SpaceContract[];
  launchCenters: LaunchCenterRecord[];
  orbitalAssets: OrbitalAsset[];
} {
  const contracts: SpaceContract[] = [];
  const launchCenters: LaunchCenterRecord[] = [];
  const orbitalAssets: OrbitalAsset[] = [];
  const visit = (node: unknown, sectionHint?: 'contract' | 'launch_center' | 'orbital_asset') => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, sectionHint);
      return;
    }
    const rec = node as Record<string, unknown>;
    let matchedSection = false;
    for (const [k, v] of Object.entries(rec)) {
      const trimmedKey = k.trim();
      if (SPACE_SECTION_HEADER_KEYS.has(trimmedKey) && v && typeof v === 'object') {
        matchedSection = true;
        const nextHint = ORBITAL_ASSET_SECTION_HEADER_KEYS.has(trimmedKey)
          ? 'orbital_asset'
          : LAUNCH_CENTER_SECTION_HEADER_KEYS.has(trimmedKey)
            ? 'launch_center'
            : 'contract';
        visit(v, nextHint);
      }
    }
    if (matchedSection) return;
    const recWithSection: Record<string, unknown> = { ...rec };
    if (sectionHint) {
      setHiddenMeta(recWithSection, '__section', sectionHint);
    }
    if (isOrbitalAssetRecordRaw(recWithSection)) {
      const oa = mapRawRecordToOrbitalAsset(recWithSection, orbitalAssets.length + 1);
      if (oa) orbitalAssets.push(oa);
    } else if (isLaunchCenterRecordRaw(recWithSection)) {
      const lc = mapRawRecordToLaunchCenter(recWithSection, launchCenters.length + 1);
      if (lc) launchCenters.push(lc);
    } else {
      const c = mapRawRecordToContract(recWithSection, contracts.length + 1);
      if (c) contracts.push(c);
    }
  };
  visit(val);
  return { contracts, launchCenters, orbitalAssets };
}

/**
 * 校验当前天气是否允许火箭发射（支持轨道船坞与月面发射中心 100% 气象豁免）
 */
export function isLaunchWeatherPermitted(
  weather?: string | null,
  hasAllWeatherTech?: boolean,
  immuneToEarthWeather?: boolean,
): { permitted: boolean; reason: string | null } {
  if (immuneToEarthWeather) {
    return { permitted: true, reason: null };
  }
  const w = String(weather ?? '').trim();
  if (!w || w === '真空无气象') {
    return { permitted: true, reason: null };
  }
  const isSevere = SEVERE_LAUNCH_WEATHERS.some(bad => w.includes(bad));
  if (isSevere && !hasAllWeatherTech) {
    return {
      permitted: false,
      reason: `气象窗口关闭（当前天气：${w}）`,
    };
  }
  return { permitted: true, reason: null };
}

/**
 * 检查目标基地（或任一非废弃基地/发射中心）是否存在运转态航天发射设施
 */
export function hasOperationalLaunchpad(
  state: Partial<Schema>,
  baseIdOrName?: string,
): boolean {
  const targetRef = String(baseIdOrName ?? '').trim();
  const bases = Array.isArray(state?.bases) ? state.bases : [];

  // 1. 检查显式登记的 launch_centers
  const launchCenters = Array.isArray(state?.space?.launch_centers)
    ? state!.space!.launch_centers!
    : [];
  for (const lc of launchCenters) {
    if (!lc || (lc.status && lc.status !== '运转')) continue;
    if (!targetRef || lc.base === targetRef || lc.id === targetRef || lc.name === targetRef) {
      const base = bases.find(b => b.id === lc.base || b.name === lc.base);
      if (base?.status === '废弃') continue;
      return true;
    }
  }

  // 2. 检查基地建筑列表
  const candidateBases = bases.filter(b => {
    if (!b || b.status === '废弃') return false;
    if (!targetRef) return true;
    return b.id === targetRef || b.name === targetRef;
  });

  for (const base of candidateBases) {
    const buildings = Array.isArray(base.buildings) ? base.buildings : [];
    for (const bld of buildings) {
      if (!bld || typeof bld.name !== 'string') continue;
      const isLaunchpad =
        LAUNCHPAD_BUILDINGS.some(padName => bld.name === padName || bld.name.includes(padName)) ||
        bld.name.includes('轨道船坞') ||
        bld.name.includes('月面电磁质量投射器');
      if (!isLaunchpad) continue;
      const bldState = bld.state ?? '运转';
      if (bldState === '运转') {
        return true;
      }
    }
  }
  return false;
}

export interface RocketSpec {
  minCenterTier: 1 | 2 | 3;
  baseCapacityT: number;
}

/**
 * 根据运载火箭名称评估所需发射中心最低等级与基准运力（吨）
 */
export function evaluateRocketSpec(
  rocketName: string | undefined | null,
  isFullReuseStarbase = false,
): RocketSpec {
  const r = String(rocketName ?? '').trim();
  if (r.includes('超级重型') || r.includes('两级全复用') || r.includes('星舰')) {
    return {
      minCenterTier: 3,
      baseCapacityT: isFullReuseStarbase ? 80 : 65,
    };
  }
  if (r.includes('能源号') || r.includes('长征九号') || r.includes('超重型')) {
    return {
      minCenterTier: 2,
      baseCapacityT: 35,
    };
  }
  if (r.includes('重型低温') || r.includes('重型')) {
    return {
      minCenterTier: 2,
      baseCapacityT: 22,
    };
  }
  return {
    minCenterTier: 1,
    baseCapacityT: 8,
  };
}

function inferContractOrbit(contract: SpaceContract, state: Partial<Schema>): string {
  const explicitOrbit = contract.orbit?.trim();
  if (explicitOrbit) return explicitOrbit.toUpperCase();

  const matchedOrder = state.space?.commercial_orders?.find(
    o => o.id === contract.id || o.name === contract.payload || o.name === contract.title,
  );
  if (matchedOrder?.orbit) return matchedOrder.orbit.toUpperCase();

  const slot = String(contract.target_slot ?? '').toLowerCase();
  if (slot.includes('geo')) return 'GEO';
  if (slot.includes('sso')) return 'SSO';
  if (slot.startsWith('lun_') || slot.startsWith('ln_')) return 'TLI';

  const combined = `${contract.title} ${contract.payload}`.toUpperCase();
  if (combined.includes('GEO') || combined.includes('静止') || combined.includes('高轨') || combined.includes('同步')) {
    return 'GEO';
  }
  if (combined.includes('TLI') || combined.includes('月面') || combined.includes('月球') || combined.includes('登月')) {
    return 'TLI';
  }
  if (combined.includes('SSO') || combined.includes('极轨') || combined.includes('晨昏')) {
    return 'SSO';
  }
  return 'LEO';
}

function upsertCommercialOrderFromContract(state: Schema, contract: SpaceContract): SpaceCommercialOrder {
  state.space.commercial_orders ??= [];
  const orbit = inferContractOrbit(contract, state);
  const existingIdx = state.space.commercial_orders.findIndex(o => o.id === contract.id);
  const nextStatus: SpaceCommercialOrder['status'] =
    contract.status === 'in_orbit' || contract.status === 'completed'
      ? 'completed'
      : contract.status === 'launching'
        ? 'assigned'
        : 'pending';

  const order: SpaceCommercialOrder = SpaceCommercialOrder.parse({
    id: contract.id,
    name: contract.payload || contract.title,
    client: contract.client || '外部商业委托',
    orbit,
    mass_t: contract.mass_t ?? parseMassFromText(contract.payload) ?? 5,
    reward_credits: contract.reward_credits || 2500,
    status: nextStatus,
  });

  if (existingIdx >= 0) {
    state.space.commercial_orders[existingIdx] = {
      ...state.space.commercial_orders[existingIdx],
      ...order,
    };
  } else {
    state.space.commercial_orders.push(order);
  }
  return order;
}

function consumeAndRecoverEquipmentStockOnLaunch(
  state: Schema,
  contract: SpaceContract,
  orbit: string,
  isFullReuseStarbase: boolean,
): void {
  const hasForceAero = Object.keys(state.forces?.equipment ?? {}).some(
    k => findBuildableAeroEquipmentSpec(k) !== undefined,
  );
  if (!state.space.equipment_stock && !hasForceAero) return;

  const stock = syncAeroEquipmentStock(state);
  const adjustStock = (itemName: string, delta: number) => {
    const current = Number(stock[itemName] ?? 0);
    const nextVal = Math.max(0, current + delta);
    if (current > 0 || delta > 0) {
      stock[itemName] = nextVal;
      if (state.forces?.equipment && itemName in state.forces.equipment) {
        state.forces.equipment[itemName] = nextVal;
      }
    }
  };

  // 1. 若发射自产载荷且库存中存在对应载荷，扣减 1 份
  if (contract.payload_source !== 'commercial') {
    const payloadSpec =
      findBuildableAeroEquipmentSpec(contract.payload) ??
      findBuildableAeroEquipmentSpec(contract.asset_id);
    if (payloadSpec && (stock[payloadSpec.name] ?? 0) > 0) {
      adjustStock(payloadSpec.name, -1);
    }
  }

  // 2. 芯一级与助推器消耗与回收返库
  if (!isFullReuseStarbase) {
    const hadCoreFirst = (stock['标准运载火箭芯一级'] ?? 0) > 0;
    if (hadCoreFirst) {
      adjustStock('标准运载火箭芯一级', -1);
      if (contract.recover_booster) {
        adjustStock('标准运载火箭芯一级', +1);
      }
    }
    const hadBooster = (stock['通用捆绑式助推器'] ?? 0) > 0;
    if (hadBooster) {
      adjustStock('通用捆绑式助推器', -1);
      if (contract.recover_booster) {
        adjustStock('通用捆绑式助推器', +1);
      }
    }
    if ((stock['高空入轨真空芯二级'] ?? 0) > 0) {
      adjustStock('高空入轨真空芯二级', -1);
    }
    if (
      (orbit === 'GEO' || orbit === 'TLI') &&
      (stock['远征上面级'] ?? 0) > 0
    ) {
      adjustStock('远征上面级', -1);
    }
  }
}

/**
 * 结算天基航天发射合同、多发射中心选址硬数值、助推器回收/复用、外部商业订单履约、
 * 航天装备库存扣减、暴露度脉冲、`completed_slots` 自动点亮与在轨资产入轨（FD-27）
 */
export function settleSpaceOperations(
  state: Schema,
  incomingContracts: SpaceContract[] = [],
  options?: {
    consumeBoosterForDiscount?: boolean;
    incomingLaunchCenters?: LaunchCenterRecord[];
    incomingOrbitalAssets?: OrbitalAsset[];
    deltaMinutes?: number;
  },
): {
  launchedIds: string[];
  heldIds: string[];
  creditsEarned: number;
  boostersRecovered: number;
  boostersReused: number;
} {
  if (!state.space) {
    state.space = {
      orbital_assets: [],
      contracts: [],
      reusable_boosters: 0,
    };
  }
  state.space.orbital_assets ??= [];
  state.space.contracts ??= [];
  state.space.reusable_boosters = Number(state.space.reusable_boosters ?? 0);

  // 1. 合并 incomingLaunchCenters
  if (options?.incomingLaunchCenters && options.incomingLaunchCenters.length > 0) {
    state.space.launch_centers ??= [];
    for (const incomingLc of options.incomingLaunchCenters) {
      if (!incomingLc || !incomingLc.base) continue;
      const parsedLc = LaunchCenterRecord.parse(incomingLc);
      const idx = state.space.launch_centers.findIndex(
        x => x.id === parsedLc.id || x.base === parsedLc.base,
      );
      if (idx >= 0) {
        state.space.launch_centers[idx] = {
          ...state.space.launch_centers[idx],
          ...parsedLc,
          mounted_slots: {
            ...state.space.launch_centers[idx].mounted_slots,
            ...parsedLc.mounted_slots,
          },
        };
      } else {
        state.space.launch_centers.push(parsedLc);
      }
    }
  }

  // 记录调用前已完成或已失败结算的合同 ID，防止跨楼层重复结算回款或重复扣减助推器
  const previouslyCompletedIds = new Set(
    state.space.contracts.filter(c => c && c.status === 'completed').map(c => c.id),
  );
  const previouslyFailedIds = new Set(
    state.space.contracts.filter(c => c && c.status === 'failed').map(c => c.id),
  );
  const preExistingIds = new Set(
    state.space.contracts.filter(c => c && c.id).map(c => c.id),
  );

  // 2. 按 id 幂等合并 incomingContracts，并处理 LLM 外部商业订单入池
  for (const incoming of incomingContracts) {
    if (!incoming || !incoming.id) continue;
    const incomingMeta = incoming as SpaceContractWithMeta;
    const incomingUseBooster = incomingMeta.use_stored_booster;
    const incomingExplicitHold = incomingMeta.explicit_hold === true;
    const incomingExplicitCompleted = incomingMeta.explicit_completed === true;
    const incomingExplicitFailed = incomingMeta.explicit_failed === true;
    const incomingFailureReason = incomingMeta.failure_reason;
    const normalized = SpaceContract.parse(incoming) as SpaceContractWithMeta;
    if (typeof incomingUseBooster === 'boolean') {
      normalized.use_stored_booster = incomingUseBooster;
    }
    if (incomingExplicitHold) setHiddenMeta(normalized, 'explicit_hold', true);
    if (incomingExplicitCompleted) setHiddenMeta(normalized, 'explicit_completed', true);
    if (incomingExplicitFailed) setHiddenMeta(normalized, 'explicit_failed', true);
    if (incomingFailureReason) normalized.failure_reason = incomingFailureReason;

    if (previouslyCompletedIds.has(normalized.id)) continue;
    if (normalized.payload_source === 'commercial' && normalized.status !== 'failed') {
      upsertCommercialOrderFromContract(state, normalized);
    }
    const existingIdx = state.space.contracts.findIndex(c => c.id === normalized.id);
    if (existingIdx >= 0) {
      const prevContract = state.space.contracts[existingIdx] as SpaceContractWithMeta;
      const prevUseBooster = prevContract.use_stored_booster;
      const merged: SpaceContractWithMeta = {
        ...prevContract,
        ...normalized,
        base: normalized.base || prevContract.base,
        reward_credits:
          normalized.reward_credits > 0 ? normalized.reward_credits : prevContract.reward_credits,
        ...(typeof normalized.use_stored_booster === 'boolean'
          ? { use_stored_booster: normalized.use_stored_booster }
          : typeof prevUseBooster === 'boolean'
            ? { use_stored_booster: prevUseBooster }
            : {}),
      };
      if (
        normalized.status === 'completed' ||
        normalized.status === 'in_orbit' ||
        normalized.status === 'launching'
      ) {
        if (!normalized.weather_hold_reason) {
          delete merged.weather_hold_reason;
        }
      }
      if (incomingExplicitHold) setHiddenMeta(merged, 'explicit_hold', true);
      if (incomingExplicitCompleted) setHiddenMeta(merged, 'explicit_completed', true);
      if (incomingExplicitFailed) setHiddenMeta(merged, 'explicit_failed', true);
      state.space.contracts[existingIdx] = merged;
    } else {
      state.space.contracts.push(normalized);
    }
  }

  // 3. 若 forces.equipment 中存在可制造航天装备，自动同步到 space.equipment_stock
  const hasForceAero = Object.keys(state.forces?.equipment ?? {}).some(
    k => findBuildableAeroEquipmentSpec(k) !== undefined,
  );
  if (hasForceAero || state.space.equipment_stock !== undefined) {
    syncAeroEquipmentStock(state);
  }

  // 4. 派生当前各基地发射中心视图
  const derivedCenters = deriveLaunchCentersFromState(state);
  const hasMassDriverOrIce = checkHasLunarMassDriverOrIce(state);

  const launchedIds: string[] = [];
  const heldIds: string[] = [];
  let creditsEarned = 0;
  let boostersRecovered = 0;
  let boostersReused = 0;

  const hasGlobalAllWeatherTech = Array.isArray(state.tech?.done)
    ? state.tech.done.includes(ALL_WEATHER_LAUNCH_TECH)
    : false;

  const rawMetaDay = (state.meta as { day?: number; day_count?: number } | undefined)?.day;
  const launchedAtDay =
    typeof rawMetaDay === 'number' && rawMetaDay > 0
      ? rawMetaDay
      : typeof state.meta?.day_count === 'number' && state.meta.day_count > 0
        ? state.meta.day_count
        : typeof state.clock?.day === 'number' && state.clock.day > 0
          ? state.clock.day
          : 1;

  for (const contract of state.space.contracts) {
    if (!contract) continue;
    const contractMeta = contract as SpaceContractWithMeta;
    if (previouslyCompletedIds.has(contract.id)) continue;

    // 失败交割：锁定为 failed，不发报酬、不入轨，若本次失败发射使用了库存助推器则扣减 1 枚
    if (contract.status === 'failed' || contractMeta.explicit_failed) {
      contract.status = 'failed';
      if (!previouslyFailedIds.has(contract.id)) {
        const shouldConsumeOnFail =
          Boolean(options?.consumeBoosterForDiscount) ||
          contractMeta.use_stored_booster === true;
        if (shouldConsumeOnFail && state.space.reusable_boosters > 0) {
          state.space.reusable_boosters -= 1;
          boostersReused += 1;
        }
      }
      continue;
    }

    // 显式挂起/延期合同：当楼保持 pending 且带 weather_hold_reason，不被自动发射
    if (contractMeta.explicit_hold) {
      contract.status = 'pending';
      if (contract.payload_source === 'commercial') {
        upsertCommercialOrderFromContract(state, contract);
      }
      heldIds.push(contract.id);
      continue;
    }

    // LLM 下发的外部商业订单在 status === 'pending' 时仅入池待命，待指派发射（in_orbit / completed / launching）时再结算履约
    if (contract.payload_source === 'commercial' && contract.status === 'pending') {
      upsertCommercialOrderFromContract(state, contract);
      heldIds.push(contract.id);
      continue;
    }

    if (
      contract.status !== 'pending' &&
      contract.status !== 'launching' &&
      contract.status !== 'in_orbit' &&
      contract.status !== 'in_progress' &&
      contract.status !== 'completed'
    ) {
      continue;
    }

    if (typeof contract.duration_days === 'number' && contract.duration_days > 0) {
      if (
        options?.deltaMinutes &&
        options.deltaMinutes > 0 &&
        preExistingIds.has(contract.id) &&
        contract.status !== 'completed'
      ) {
        const prevElapsed = typeof contract.elapsed_days === 'number' ? contract.elapsed_days : 0;
        contract.elapsed_days = Math.round((prevElapsed + options.deltaMinutes / 1440) * 10000) / 10000;
      }
      if (contract.status !== 'completed' && (contract.elapsed_days ?? 0) < contract.duration_days) {
        if (contract.status !== 'pending') {
          contract.status = 'in_progress';
        }
        heldIds.push(contract.id);
        continue;
      }
      contract.elapsed_days = contract.duration_days;
    }

    // 查找所属基地与发射中心
    const matchedCenter = derivedCenters.find(
      c =>
        (contract.launch_center_id &&
          (c.id === contract.launch_center_id || c.name === contract.launch_center_id)) ||
        (contract.base && (c.base === contract.base || c.id === `lc:${contract.base}`)),
    );
    const matchedBase = (state.bases ?? []).find(
      b =>
        b &&
        b.status !== '废弃' &&
        (b.id === contract.base ||
          b.name === contract.base ||
          (matchedCenter && (b.id === matchedCenter.base || b.name === matchedCenter.base))),
    );

    if (!hasOperationalLaunchpad(state, contract.base || matchedCenter?.base || undefined)) {
      contract.status = 'pending';
      contract.weather_hold_reason = '缺少运转态航天发射中心';
      heldIds.push(contract.id);
      continue;
    }

    const orbit = inferContractOrbit(contract, state);
    const siteType: BaseSiteType =
      matchedCenter?.site_type ??
      (matchedBase?.site_type
        ? normalizeSiteType(matchedBase.site_type, 'inland_canyon')
        : 'inland_canyon');
    const siteMods = evaluateLaunchSiteModifiers(siteType, orbit, hasMassDriverOrIce);

    // 基地局部防雷测控塔或全局全天候科技均可豁免地球恶劣天气（若合同已显式声明 completed/成功，则不再因环境天气拦截）
    const isExplicitlyCompleted = contractMeta.explicit_completed === true || contract.status === 'completed';
    const hasLocalWeatherTower =
      Boolean(matchedCenter?.mounted_slots?.['lc_weather_tower']) ||
      Boolean(
        matchedBase?.buildings?.some(
          b =>
            (b.state ?? '运转') === '运转' &&
            (b.name.includes('深空测控网络') || b.name.includes('防雷')),
        ),
      );
    const localWeather = matchedBase?.weather ?? matchedCenter?.weather ?? state.meta?.weather;
    if (!isExplicitlyCompleted) {
      const weatherGate = isLaunchWeatherPermitted(
        localWeather,
        hasGlobalAllWeatherTech || hasLocalWeatherTower,
        siteMods.immuneToEarthWeather,
      );
      if (!weatherGate.permitted) {
        contract.status = 'pending';
        contract.weather_hold_reason = weatherGate.reason ?? '气象窗口关闭';
        heldIds.push(contract.id);
        continue;
      }
    }

    // 运载火箭吨位与发射中心等级硬门控
    const isFullReuse = Boolean(matchedCenter?.isFullReuseStarbase);
    const rocketSpec = evaluateRocketSpec(contract.rocket, isFullReuse);
    const hasExplicitCenterConstraint =
      matchedCenter !== undefined &&
      ((state.space.launch_centers?.some(
        lc => lc.base === matchedCenter.base || lc.id === matchedCenter.id,
      ) ??
        false) ||
        matchedBase?.site_type !== undefined ||
        contract.mass_t !== undefined);

    const centerTier: 1 | 2 | 3 = matchedCenter?.tier ?? 1;
    if (!isExplicitlyCompleted && hasExplicitCenterConstraint && centerTier < rocketSpec.minCenterTier) {
      contract.status = 'pending';
      contract.weather_hold_reason = `发射中心等级不足（当前 Tier-${centerTier}，发射「${contract.rocket}」需 Tier-${rocketSpec.minCenterTier}）`;
      heldIds.push(contract.id);
      continue;
    }

    const payloadMassT = contract.mass_t ?? parseMassFromText(contract.payload);
    if (!isExplicitlyCompleted && payloadMassT !== undefined && payloadMassT > 0) {
      const tierBaseCap =
        centerTier >= 3 ? (isFullReuse ? 80 : 65) : centerTier === 2 ? 35 : 8;
      const effectiveCap =
        Math.min(rocketSpec.baseCapacityT, hasExplicitCenterConstraint ? tierBaseCap : rocketSpec.baseCapacityT) *
        siteMods.payloadMult;
      if (payloadMassT > effectiveCap + 1e-6) {
        contract.status = 'pending';
        contract.weather_hold_reason = `有效载荷超重（载荷 ${payloadMassT}t 超出当前选址与火箭最大运力 ${Number(effectiveCap.toFixed(2))}t）`;
        heldIds.push(contract.id);
        continue;
      }
    }

    // 发射成功：结算助推器复用折扣、选址乘数与航天城 +25% 加成
    let reuseBonus = 0;
    const shouldConsumeBooster =
      Boolean(options?.consumeBoosterForDiscount) ||
      contractMeta.use_stored_booster === true;
    if (
      (shouldConsumeBooster && state.space.reusable_boosters > 0) ||
      isFullReuse
    ) {
      if (shouldConsumeBooster && state.space.reusable_boosters > 0) {
        state.space.reusable_boosters -= 1;
        boostersReused += 1;
      }
      reuseBonus = Math.round((contract.reward_credits || 0) * 0.15);
    }

    const hasExplicitSiteType =
      Boolean(matchedBase?.site_type) ||
      Boolean(
        state.space.launch_centers?.some(
          lc => lc && (lc.base === matchedCenter?.base || lc.id === matchedCenter?.id),
        ),
      ) ||
      siteType === 'orbital_dock' ||
      siteType === 'lunar_surface';
    const effectivePayoutMult = hasExplicitSiteType ? siteMods.payoutMult : 1.0;
    const isSpaceportCity = hasExplicitSiteType && Boolean(matchedCenter?.isSpaceportCity);
    const spaceportMult = isSpaceportCity ? 1.25 : 1.0;
    const baseReward = contract.reward_credits || 0;
    const payout = Math.round(baseReward * effectivePayoutMult * spaceportMult) + reuseBonus;

    contract.status = 'completed';
    delete contract.weather_hold_reason;
    launchedIds.push(contract.id);

    if (state.economy && typeof state.economy.credits === 'number') {
      state.economy.credits += payout;
    }
    creditsEarned += payout;

    // 结算点火暴露度脉冲（轨道船坞与月面中心为 0）
    if (siteMods.exposureDelta > 0 && state.exposure && typeof state.exposure.value === 'number') {
      state.exposure.value = Math.min(
        10,
        Math.round((state.exposure.value + siteMods.exposureDelta) * 1000) / 1000,
      );
    }

    // 助推器回收与可制造航天装备库存扣减/返库
    if (contract.recover_booster) {
      state.space.reusable_boosters += 1;
      boostersRecovered += 1;
    }
    consumeAndRecoverEquipmentStockOnLaunch(state, contract, orbit, isFullReuse);

    // 若为外部商业订单载荷，标记商业订单已完成
    if (contract.payload_source === 'commercial' || state.space.commercial_orders?.some(o => o.id === contract.id)) {
      upsertCommercialOrderFromContract(state, contract);
    }

    // 若携带 target_slot，自动点亮对应天基拓扑插槽
    if (contract.target_slot) {
      state.space.completed_slots ??= {};
      state.space.completed_slots[contract.target_slot] =
        contract.asset_id || contract.payload || contract.title;
    }

    // 注册在轨资产（按 id 或 name 去重）
    const assetId = `orb:${contract.id}`;
    const assetName = contract.payload || contract.title;
    const existingAssetIdx = state.space.orbital_assets.findIndex(
      a => a.id === assetId || (assetName && a.name === assetName),
    );
    const assetKind: OrbitalAsset['kind'] =
      contract.kind === 'constellation' ? 'comm' : contract.kind;
    const newAsset: OrbitalAsset = {
      id: existingAssetIdx >= 0 ? state.space.orbital_assets[existingAssetIdx].id : assetId,
      name: assetName,
      kind: assetKind,
      orbit,
      status: 'active',
      launched_at_day: launchedAtDay,
      bonus_desc:
        (existingAssetIdx >= 0 && state.space.orbital_assets[existingAssetIdx].bonus_desc) ||
        BONUS_DESC_BY_KIND[assetKind] ||
        '在轨载荷稳定运行',
    };
    if (contract.target_slot) newAsset.slot_id = contract.target_slot;
    if (contract.scope) newAsset.scope = contract.scope;
    if (contract.target_base) newAsset.target_base = contract.target_base;
    if (existingAssetIdx >= 0) {
      state.space.orbital_assets[existingAssetIdx] = {
        ...state.space.orbital_assets[existingAssetIdx],
        ...newAsset,
      };
    } else {
      state.space.orbital_assets.push(newAsset);
    }
  }

  // 5. 合并 incomingOrbitalAssets（支持 <航天> 下的 星座 / 在轨 / 在轨资产 / 卫星 列表，按 name 或 id 去重更新）
  if (options?.incomingOrbitalAssets && options.incomingOrbitalAssets.length > 0) {
    for (const incomingAsset of options.incomingOrbitalAssets) {
      if (!incomingAsset || !incomingAsset.name) continue;
      const parsedAsset = OrbitalAsset.parse({
        ...incomingAsset,
        launched_at_day: incomingAsset.launched_at_day || launchedAtDay,
      });
      const existingIdx = state.space.orbital_assets.findIndex(
        a => a.name === parsedAsset.name || a.id === parsedAsset.id,
      );
      if (existingIdx >= 0) {
        const prev = state.space.orbital_assets[existingIdx];
        state.space.orbital_assets[existingIdx] = {
          ...prev,
          ...parsedAsset,
          id: prev.id || parsedAsset.id,
          bonus_desc: parsedAsset.bonus_desc || prev.bonus_desc,
        };
      } else {
        state.space.orbital_assets.push(parsedAsset);
      }
    }
  }

  return {
    launchedIds,
    heldIds,
    creditsEarned,
    boostersRecovered,
    boostersReused,
  };
}
