/**
 * spaceCanvasRegistry.ts —— 天基三域交互式节点画布拓扑、28枚正典构件库与开放式扩展注册表（PKG-A · FD-25）
 *
 * 职责：
 * 1. 定义空间站（station）、轨道星座（constellation）、月球基地（lunar）三大天基画布域的拓扑插槽模型；
 * 2. 内置 28 枚源自《工程·通用》与《通用·航天工业》的正典可拼装 SVG 构件资产；
 * 3. 内置轨道星座 4 大组网羁绊与空间站/月球基地组合协同羁绊；
 * 4. 暴露开放式注册表 API（registerSpaceCanvasDomain / registerSpaceCanvasSlots / registerSpaceCanvasAssets / registerSpaceCanvasSynergies），
 *    供未来阵营专属超武、深空画布或世界书条目动态注入新插槽与新舱段。
 */

/** 画布域标识：内置支持 station(空间站) / constellation(星座) / lunar(月球基地) / launch_center(发射中心与航天城)，同时支持 string 扩展 */
export type SpaceCanvasDomainId =
  | 'station'
  | 'constellation'
  | 'lunar'
  | 'launch_center'
  | (string & {});

/** SpaceCanvasDomain 类型别名（与 SpaceCanvasDomainId 保持一致，供外部组件与单测直接引用） */
export type SpaceCanvasDomain = SpaceCanvasDomainId;

/** 插槽接口类型：内置 25 类标准工程接口（含地面与母港发射中心 12 类接口），同时支持 string 扩展 */
export type SpaceSlotInterfaceType =
  | 'station_core'
  | 'station_hub_port'
  | 'station_pressurized'
  | 'station_truss_power'
  | 'station_truss_payload'
  | 'orbit_leo'
  | 'orbit_sso'
  | 'orbit_geo'
  | 'lunar_core'
  | 'lunar_hub_tunnel'
  | 'lunar_pad'
  | 'lunar_inner'
  | 'lunar_rim_isru'
  | 'launch_pad_std'
  | 'launch_assembly'
  | 'launch_propellant'
  | 'launch_telemetry'
  | 'launch_pad_heavy'
  | 'launch_hub_heavy'
  | 'launch_recovery'
  | 'launch_weather'
  | 'launch_pad_super'
  | 'launch_mega_fab'
  | 'launch_mega_payload_line'
  | 'launch_mega_cryo'
  | (string & {});

/** 插槽节点状态枚举：已完工在轨/已建成实体态 / 在建施工态 / 蓝图构思态 / 空闲待选配态 / 未解锁锁定态 */
export type SpaceSlotNodeState =
  | 'completed'
  | 'built'
  | 'building'
  | 'planned'
  | 'empty'
  | 'locked';

/** 画布域几何与视口元数据定义 */
export interface SpaceCanvasDomainDef {
  id: SpaceCanvasDomainId;
  title: string;
  subtitle: string;
  viewBoxWidth: number;
  viewBoxHeight: number;
  centerX: number;
  centerY: number;
}

/** 画布域顶部切换标签定义 */
export interface SpaceCanvasDomainTabDef {
  id: SpaceCanvasDomainId;
  key: SpaceCanvasDomainId;
  domain: SpaceCanvasDomainId;
  title: string;
  label: string;
  subtitle: string;
}

/** 单个拓扑插槽节点定义 */
export interface SpaceCanvasSlotDef {
  id: string;
  domain: SpaceCanvasDomainId;
  label: string;
  interfaceType: SpaceSlotInterfaceType;
  tier: 1 | 2 | 3;
  x: number;
  y: number;
  rotation?: number;
  scale?: number;
  parentSlotId?: string;
  /** 拓扑连线目标插槽 ID 列表（支持多对多走廊连线，如 lc_crawler_way 同时连接 lc_hif 与 lc_pad_2） */
  connectedTo?: string[];
  /** 触发该外圈插槽生长展开的枢纽插槽 ID（如 Tier-2 由 lc_hif 解锁，Tier-3 由 lc_crawler_way 解锁） */
  unlockedBySlotId?: string;
  requiresExpansionHub?: boolean;
  requiresRoverSurvey?: boolean;
  defaultAssetId?: string;
  /** 是否为根核心槽位（兼容 isRootCore 与 lockedCore 双字段） */
  isRootCore?: boolean;
  lockedCore?: boolean;
  meta?: Record<string, unknown>;
}

/** 可挂载 SVG 构件/设施/卫星资产定义 */
export interface SpaceCanvasAssetDef {
  id: string;
  name: string;
  domain: SpaceCanvasDomainId;
  allowedInterfaces: SpaceSlotInterfaceType[];
  worldbookRef?: string;
  costCredits: number;
  nanitesCost: number;
  massTons: number;
  workloadDays: number;
  requiredResearch?: string;
  powerDeltaKw: number;
  lifeSupportDelta: number;
  isExpansionHub?: boolean;
  isRoverSurveyor?: boolean;
  effectSummary: string;
  svgSymbolId: string;
  orbitTarget?: 'LEO' | 'SSO' | 'GEO' | 'TLI';
  ext?: Record<string, unknown>;
}

/** 组网/拼装羁绊定义 */
export interface SpaceCanvasSynergyDef {
  id: string;
  domain: SpaceCanvasDomainId;
  name: string;
  description: string;
  bonusSummary: string;
  ringTone: 'cyan' | 'amber' | 'emerald' | 'violet';
  checkActive: (mountedAssets: SpaceCanvasAssetDef[], slotAssetMap: Record<string, string>) => boolean;
}

/** 接口类型中文标签字典 */
export const SPACE_INTERFACE_TYPE_LABELS: Record<string, string> = {
  station_core: '空间站中央核心枢钮',
  station_hub_port: '轴向对接/扩展枢纽口',
  station_pressurized: '标准加压舱段口',
  station_truss_power: '主桁架能源与散热口',
  station_truss_payload: '主桁架对地/深空载荷口',
  orbit_leo: '近地低轨相位槽 (LEO)',
  orbit_sso: '太阳同步极轨槽 (SSO)',
  orbit_geo: '地球静止高轨槽 (GEO)',
  lunar_core: '月球基地中央防辐射核心槽',
  lunar_hub_tunnel: '环山加压管廊延伸枢纽槽',
  lunar_pad: '月面起降与电磁弹射坪槽',
  lunar_inner: '环形山内圈能源/维生/科研槽',
  lunar_rim_isru: '外环极地暗坑/月海原位矿脉槽',
  launch_pad_std: '1# 标准常温发射工位口',
  launch_assembly: '火箭总装与测试厂房口',
  launch_propellant: '推进剂储罐与加注区口',
  launch_telemetry: '近场遥测与卫星制造中心口',
  launch_pad_heavy: '2# 低温重型发射工位口',
  launch_hub_heavy: '重型双轨转运与导流枢纽口',
  launch_recovery: '助推器垂直回收坪/船坞口',
  launch_weather: '全天候防雷与深空测控阵口',
  launch_pad_super: '3# 百米级机械臂捕获塔架口',
  launch_mega_fab: '火箭制造厂·地下洞库旋压总厂口',
  launch_mega_payload_line: '大型航天器与空间站舱段总装中心口',
  launch_mega_cryo: '深冷液氧甲烷原位合成化工厂口',
};

/** 默认内置四域画布视口定义（统一基于 viewBox="0 0 800 460"，中心 (400, 230)） */
export const DEFAULT_SPACE_CANVAS_DOMAINS: readonly SpaceCanvasDomainDef[] = [
  {
    id: 'station',
    title: '轨道空间站模块化总成',
    subtitle: '十字主桁架 · 9槽基准骨架 + 3槽深空外延生长节点',
    viewBoxWidth: 800,
    viewBoxHeight: 460,
    centerX: 400,
    centerY: 230,
  },
  {
    id: 'constellation',
    title: '全球轨道星座组网',
    subtitle: 'LEO / SSO / GEO 三层同心轨道环 · 12相位槽与四大天基组网羁绊',
    viewBoxWidth: 800,
    viewBoxHeight: 460,
    centerX: 400,
    centerY: 230,
  },
  {
    id: 'lunar',
    title: '沙克尔顿极地月球基地',
    subtitle: '8槽环形山内圈加压管廊 + 4槽外延水冰/氦-3矿脉与电磁质量投射器',
    viewBoxWidth: 800,
    viewBoxHeight: 460,
    centerX: 400,
    centerY: 230,
  },
  {
    id: 'launch_center',
    title: '地面与母港发射中心拓扑',
    subtitle: '4槽小型发射场 ➔ 8槽中型发射中心 ➔ 12槽「国家航天城」小巨构三阶同图生长',
    viewBoxWidth: 800,
    viewBoxHeight: 460,
    centerX: 400,
    centerY: 230,
  },
] as const;

/** 四域拓扑切换标签（含 launch_center 地面与母港发射中心拓扑） */
export const SPACE_CANVAS_DOMAIN_TABS: readonly SpaceCanvasDomainTabDef[] = [
  {
    id: 'launch_center',
    key: 'launch_center',
    domain: 'launch_center',
    title: '地面与母港发射中心拓扑',
    label: '地面与母港发射中心拓扑',
    subtitle: '4槽小型发射场 ➔ 8槽中型发射中心 ➔ 12槽「国家航天城」小巨构',
  },
  {
    id: 'constellation',
    key: 'constellation',
    domain: 'constellation',
    title: '全球轨道星座组网',
    label: '全球轨道星座组网',
    subtitle: 'LEO / SSO / GEO 三层同心轨道环 · 12相位槽',
  },
  {
    id: 'station',
    key: 'station',
    domain: 'station',
    title: '轨道空间站模块化总成',
    label: '轨道空间站模块化总成',
    subtitle: '十字主桁架 · 9槽基准骨架 + 3槽深空外延节点',
  },
  {
    id: 'lunar',
    key: 'lunar',
    domain: 'lunar',
    title: '沙克尔顿极地月球基地',
    label: '沙克尔顿极地月球基地',
    subtitle: '8槽环形山内圈 + 4槽外环原位矿脉与质量投射器',
  },
] as const;

/**
 * 地面与母港发射中心 12 个拓扑插槽定义（FD-27：4 槽小型发射场 ➔ 8 槽中型发射中心 ➔ 12 槽「国家航天城」小巨构）
 */
export const LAUNCH_CENTER_SLOTS: readonly SpaceCanvasSlotDef[] = [
  // ── Tier-1 小型发射场基准骨架（4 槽，初始可见） ──
  {
    id: 'lc_pad_1',
    domain: 'launch_center',
    label: '1# 标准常温发射工位',
    interfaceType: 'launch_pad_std',
    tier: 1,
    x: 400,
    y: 230,
    defaultAssetId: 'asset.lc.pad_std',
    isRootCore: true,
    lockedCore: true,
    connectedTo: [],
  },
  {
    id: 'lc_hif',
    domain: 'launch_center',
    label: '总装测试厂房槽',
    interfaceType: 'launch_assembly',
    tier: 1,
    x: 250,
    y: 230,
    parentSlotId: 'lc_pad_1',
    connectedTo: ['lc_pad_1'],
  },
  {
    id: 'lc_prop_yard',
    domain: 'launch_center',
    label: '推进剂储罐与加注区',
    interfaceType: 'launch_propellant',
    tier: 1,
    x: 400,
    y: 345,
    parentSlotId: 'lc_pad_1',
    connectedTo: ['lc_pad_1'],
  },
  {
    id: 'lc_telemetry_1',
    domain: 'launch_center',
    label: '近场遥测与卫星制造中心槽',
    interfaceType: 'launch_telemetry',
    tier: 1,
    x: 550,
    y: 230,
    parentSlotId: 'lc_pad_1',
    connectedTo: ['lc_pad_1'],
  },
  // ── Tier-2 中型发射中心外圈（+4 槽 = 8 槽，unlockedBySlotId: 'lc_hif'） ──
  {
    id: 'lc_pad_2',
    domain: 'launch_center',
    label: '2# 低温重型发射工位',
    interfaceType: 'launch_pad_heavy',
    tier: 2,
    x: 400,
    y: 120,
    parentSlotId: 'lc_pad_1',
    connectedTo: ['lc_pad_1'],
    unlockedBySlotId: 'lc_hif',
    requiresExpansionHub: true,
  },
  {
    id: 'lc_crawler_way',
    domain: 'launch_center',
    label: '重型双轨转运与导流枢纽',
    interfaceType: 'launch_hub_heavy',
    tier: 2,
    x: 250,
    y: 120,
    parentSlotId: 'lc_hif',
    connectedTo: ['lc_hif', 'lc_pad_2'],
    unlockedBySlotId: 'lc_hif',
    requiresExpansionHub: true,
  },
  {
    id: 'lc_recovery_zone',
    domain: 'launch_center',
    label: '助推器垂直回收坪 / 海上船坞',
    interfaceType: 'launch_recovery',
    tier: 2,
    x: 550,
    y: 120,
    parentSlotId: 'lc_pad_2',
    connectedTo: ['lc_pad_2'],
    unlockedBySlotId: 'lc_hif',
    requiresExpansionHub: true,
  },
  {
    id: 'lc_weather_tower',
    domain: 'launch_center',
    label: '全天候防雷与深空测控阵槽',
    interfaceType: 'launch_weather',
    tier: 2,
    x: 550,
    y: 345,
    parentSlotId: 'lc_telemetry_1',
    connectedTo: ['lc_telemetry_1'],
    unlockedBySlotId: 'lc_hif',
    requiresExpansionHub: true,
  },
  // ── Tier-3 大型「航天城」小巨构外延圈（+4 槽 = 12 槽，unlockedBySlotId: 'lc_crawler_way'） ──
  {
    id: 'lc_pad_super',
    domain: 'launch_center',
    label: '3# 百米级机械臂捕获塔架',
    interfaceType: 'launch_pad_super',
    tier: 3,
    x: 400,
    y: 38,
    parentSlotId: 'lc_pad_2',
    connectedTo: ['lc_pad_2'],
    unlockedBySlotId: 'lc_crawler_way',
    requiresExpansionHub: true,
  },
  {
    id: 'lc_underground_fab',
    domain: 'launch_center',
    label: '火箭制造厂·地下洞库旋压总厂',
    interfaceType: 'launch_mega_fab',
    tier: 3,
    x: 115,
    y: 175,
    parentSlotId: 'lc_crawler_way',
    connectedTo: ['lc_crawler_way'],
    unlockedBySlotId: 'lc_crawler_way',
    requiresExpansionHub: true,
  },
  {
    id: 'lc_spacecraft_hall',
    domain: 'launch_center',
    label: '大型航天器与空间站舱段总装中心',
    interfaceType: 'launch_mega_payload_line',
    tier: 3,
    x: 685,
    y: 175,
    parentSlotId: 'lc_recovery_zone',
    connectedTo: ['lc_recovery_zone'],
    unlockedBySlotId: 'lc_crawler_way',
    requiresExpansionHub: true,
  },
  {
    id: 'lc_cryo_plant',
    domain: 'launch_center',
    label: '深冷液氧甲烷原位合成化工厂',
    interfaceType: 'launch_mega_cryo',
    tier: 3,
    x: 115,
    y: 315,
    parentSlotId: 'lc_hif',
    connectedTo: ['lc_hif'],
    unlockedBySlotId: 'lc_crawler_way',
    requiresExpansionHub: true,
  },
] as const;

/** 默认内置三域共 36 个拓扑插槽（空间站 12 槽 + 轨道星座 12 槽 + 月球基地 12 槽） */
export const DEFAULT_SPACE_CANVAS_SLOTS: readonly SpaceCanvasSlotDef[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // 🛰️ 1. 轨道空间站组装画布（station · 9 槽 Tier-1 + 3 槽 Tier-2 外延 = 12 槽）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'st_core',
    domain: 'station',
    label: '中央核心枢钮',
    interfaceType: 'station_core',
    tier: 1,
    x: 400,
    y: 230,
    defaultAssetId: 'asset.st.core',
    lockedCore: true,
  },
  {
    id: 'st_fwd_hub',
    domain: 'station',
    label: '前轴向对接/枢纽口',
    interfaceType: 'station_hub_port',
    tier: 1,
    x: 400,
    y: 130,
    parentSlotId: 'st_core',
  },
  {
    id: 'st_aft_hub',
    domain: 'station',
    label: '后轴向工程推进口',
    interfaceType: 'station_pressurized',
    tier: 1,
    x: 400,
    y: 330,
    parentSlotId: 'st_core',
  },
  {
    id: 'st_port_hab',
    domain: 'station',
    label: '左舷加压舱段口',
    interfaceType: 'station_pressurized',
    tier: 1,
    x: 270,
    y: 230,
    parentSlotId: 'st_core',
  },
  {
    id: 'st_stbd_lab',
    domain: 'station',
    label: '右舷加压舱段口',
    interfaceType: 'station_pressurized',
    tier: 1,
    x: 530,
    y: 230,
    parentSlotId: 'st_core',
  },
  {
    id: 'st_truss_up_L',
    domain: 'station',
    label: '左翼上桁架能源口',
    interfaceType: 'station_truss_power',
    tier: 1,
    x: 250,
    y: 135,
    parentSlotId: 'st_core',
  },
  {
    id: 'st_truss_up_R',
    domain: 'station',
    label: '右翼上桁架能源口',
    interfaceType: 'station_truss_power',
    tier: 1,
    x: 550,
    y: 135,
    parentSlotId: 'st_core',
  },
  {
    id: 'st_truss_dn_L',
    domain: 'station',
    label: '左翼下桁架对地载荷口',
    interfaceType: 'station_truss_payload',
    tier: 1,
    x: 250,
    y: 325,
    parentSlotId: 'st_core',
  },
  {
    id: 'st_truss_dn_R',
    domain: 'station',
    label: '右翼下桁架对地载荷口',
    interfaceType: 'station_truss_payload',
    tier: 1,
    x: 550,
    y: 325,
    parentSlotId: 'st_core',
  },
  // Tier-2 外延生长槽（3个）
  {
    id: 'st_ext_dock',
    domain: 'station',
    label: '前向深空船坞外延口',
    interfaceType: 'station_pressurized',
    tier: 2,
    x: 400,
    y: 52,
    parentSlotId: 'st_fwd_hub',
    requiresExpansionHub: true,
  },
  {
    id: 'st_ext_wing_L',
    domain: 'station',
    label: '左翼远端重型扩展口',
    interfaceType: 'station_truss_power',
    tier: 2,
    x: 118,
    y: 230,
    parentSlotId: 'st_truss_up_L',
    requiresExpansionHub: true,
  },
  {
    id: 'st_ext_wing_R',
    domain: 'station',
    label: '右翼远端重型扩展口',
    interfaceType: 'station_truss_power',
    tier: 2,
    x: 682,
    y: 230,
    parentSlotId: 'st_truss_up_R',
    requiresExpansionHub: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 🌐 2. 轨道星座组网（constellation · LEO 4槽 + SSO 4槽 + GEO 4槽 = 12 槽）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'orb_leo_1',
    domain: 'constellation',
    label: 'LEO 近地1号相位(北)',
    interfaceType: 'orbit_leo',
    tier: 1,
    x: 400,
    y: 132,
  },
  {
    id: 'orb_leo_2',
    domain: 'constellation',
    label: 'LEO 近地2号相位(东)',
    interfaceType: 'orbit_leo',
    tier: 1,
    x: 525,
    y: 222,
  },
  {
    id: 'orb_leo_3',
    domain: 'constellation',
    label: 'LEO 近地3号相位(南)',
    interfaceType: 'orbit_leo',
    tier: 1,
    x: 400,
    y: 312,
  },
  {
    id: 'orb_leo_4',
    domain: 'constellation',
    label: 'LEO 近地4号相位(西)',
    interfaceType: 'orbit_leo',
    tier: 1,
    x: 275,
    y: 222,
  },
  {
    id: 'orb_sso_1',
    domain: 'constellation',
    label: 'SSO 晨昏极轨1号槽(西北)',
    interfaceType: 'orbit_sso',
    tier: 1,
    x: 265,
    y: 112,
  },
  {
    id: 'orb_sso_2',
    domain: 'constellation',
    label: 'SSO 晨昏极轨2号槽(东北)',
    interfaceType: 'orbit_sso',
    tier: 1,
    x: 535,
    y: 112,
  },
  {
    id: 'orb_sso_3',
    domain: 'constellation',
    label: 'SSO 正午极轨3号槽(东南)',
    interfaceType: 'orbit_sso',
    tier: 1,
    x: 535,
    y: 332,
  },
  {
    id: 'orb_sso_4',
    domain: 'constellation',
    label: 'SSO 正午极轨4号槽(西南)',
    interfaceType: 'orbit_sso',
    tier: 1,
    x: 265,
    y: 332,
  },
  {
    id: 'orb_geo_1',
    domain: 'constellation',
    label: 'GEO 静止高轨1号定点(北)',
    interfaceType: 'orbit_geo',
    tier: 1,
    x: 400,
    y: 42,
  },
  {
    id: 'orb_geo_2',
    domain: 'constellation',
    label: 'GEO 静止高轨2号定点(东)',
    interfaceType: 'orbit_geo',
    tier: 1,
    x: 685,
    y: 222,
  },
  {
    id: 'orb_geo_3',
    domain: 'constellation',
    label: 'GEO 静止高轨3号定点(南)',
    interfaceType: 'orbit_geo',
    tier: 1,
    x: 400,
    y: 396,
  },
  {
    id: 'orb_geo_4',
    domain: 'constellation',
    label: 'GEO 静止高轨4号定点(西)',
    interfaceType: 'orbit_geo',
    tier: 1,
    x: 115,
    y: 222,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 🌕 3. 月球基地节点画布（lunar · 8 槽环形山内圈 + 4 槽 Tier-2 外延 = 12 槽）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'ln_core',
    domain: 'lunar',
    label: '坑底中央防辐射核心',
    interfaceType: 'lunar_core',
    tier: 1,
    x: 400,
    y: 230,
    defaultAssetId: 'asset.ln.core',
    lockedCore: true,
  },
  {
    id: 'ln_pad_1',
    domain: 'lunar',
    label: '一号月面软着陆坪',
    interfaceType: 'lunar_pad',
    tier: 1,
    x: 330,
    y: 120,
    parentSlotId: 'ln_core',
  },
  {
    id: 'ln_pad_2',
    domain: 'lunar',
    label: '二号地月货运起降坪',
    interfaceType: 'lunar_pad',
    tier: 1,
    x: 470,
    y: 120,
    parentSlotId: 'ln_core',
  },
  {
    id: 'ln_inner_1',
    domain: 'lunar',
    label: '南壁永昼峰能源区',
    interfaceType: 'lunar_inner',
    tier: 1,
    x: 320,
    y: 320,
    parentSlotId: 'ln_core',
  },
  {
    id: 'ln_inner_2',
    domain: 'lunar',
    label: '坑底闭环生态维生区',
    interfaceType: 'lunar_inner',
    tier: 1,
    x: 400,
    y: 350,
    parentSlotId: 'ln_core',
  },
  {
    id: 'ln_inner_3',
    domain: 'lunar',
    label: '东南勘探车整备区',
    interfaceType: 'lunar_inner',
    tier: 1,
    x: 480,
    y: 320,
    parentSlotId: 'ln_core',
  },
  {
    id: 'ln_hub_west',
    domain: 'lunar',
    label: '西侧环山管廊延伸枢纽',
    interfaceType: 'lunar_hub_tunnel',
    tier: 1,
    x: 245,
    y: 230,
    parentSlotId: 'ln_core',
  },
  {
    id: 'ln_hub_east',
    domain: 'lunar',
    label: '东侧环山管廊延伸枢纽',
    interfaceType: 'lunar_hub_tunnel',
    tier: 1,
    x: 555,
    y: 230,
    parentSlotId: 'ln_core',
  },
  // Tier-2 外延槽（4个）
  {
    id: 'ln_rim_ice',
    domain: 'lunar',
    label: '极地永久阴影坑水冰矿槽',
    interfaceType: 'lunar_rim_isru',
    tier: 2,
    x: 120,
    y: 155,
    parentSlotId: 'ln_hub_west',
    requiresExpansionHub: true,
    requiresRoverSurvey: true,
  },
  {
    id: 'ln_rim_he3',
    domain: 'lunar',
    label: '月海玄武岩氦-3富矿槽',
    interfaceType: 'lunar_rim_isru',
    tier: 2,
    x: 120,
    y: 305,
    parentSlotId: 'ln_hub_west',
    requiresExpansionHub: true,
    requiresRoverSurvey: true,
  },
  {
    id: 'ln_rim_mass_driver',
    domain: 'lunar',
    label: '东山脊电磁质量投射器槽',
    interfaceType: 'lunar_pad',
    tier: 2,
    x: 680,
    y: 155,
    parentSlotId: 'ln_hub_east',
    requiresExpansionHub: true,
  },
  {
    id: 'ln_rim_deep_array',
    domain: 'lunar',
    label: '月背超长波深空射电阵槽',
    interfaceType: 'lunar_inner',
    tier: 2,
    x: 680,
    y: 305,
    parentSlotId: 'ln_hub_east',
    requiresExpansionHub: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 🚀 4. 地面与母港发射中心拓扑（launch_center · 4槽小型 ➔ 8槽中型 ➔ 12槽航天城小巨构）
  // ═══════════════════════════════════════════════════════════════════════════
  ...LAUNCH_CENTER_SLOTS,
] as const;

/**
 * 地面与母港发射中心及航天城小巨构构件资产库（FD-27：共 14 枚构件，覆盖 12 槽及双阶扩展枢纽升级）
 */
export const LAUNCH_CENTER_ASSETS: readonly SpaceCanvasAssetDef[] = [
  {
    id: 'asset.lc.pad_std',
    name: '1# 标准常温起竖发射工位',
    domain: 'launch_center',
    allowedInterfaces: ['launch_pad_std'],
    worldbookRef: 'UID-4 · 航天发射中心·标准常温工位',
    costCredits: 2200,
    nanitesCost: 100,
    massTons: 8.0,
    workloadDays: 5,
    powerDeltaKw: 160,
    lifeSupportDelta: 100,
    effectSummary: '配备脐带勤务塔、导流槽与场区主变电供水母站，解锁中型常温运载火箭发射（基准运力 8t）',
    svgSymbolId: 'lc_pad_std',
    orbitTarget: 'LEO',
    ext: { mappedBuildingNames: ['航天发射中心', '商业航天发射工位'], maxPayloadTons: 8 },
  },
  {
    id: 'asset.lc.hif_horiz',
    name: '水平分段总装测试厂房',
    domain: 'launch_center',
    allowedInterfaces: ['launch_assembly'],
    worldbookRef: 'UID-4 · 水平总装测试厂房',
    costCredits: 1500,
    nanitesCost: 70,
    massTons: 8.0,
    workloadDays: 4,
    powerDeltaKw: -15,
    lifeSupportDelta: 15,
    effectSummary: '卧式箭体对接与气密检测厂房，满足中小型常温运载火箭快速整备',
    svgSymbolId: 'lc_hif_horiz',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.lc.vab_vertical',
    name: '垂直总装测试厂房 (VAB)',
    domain: 'launch_center',
    allowedInterfaces: ['launch_assembly'],
    worldbookRef: 'UID-4 · 垂直总装测试厂房 (VAB)',
    costCredits: 3400,
    nanitesCost: 160,
    massTons: 22.0,
    workloadDays: 7,
    powerDeltaKw: 20,
    lifeSupportDelta: 25,
    isExpansionHub: true,
    effectSummary: '百米级高层垂直总装大厅与桥式吊车，挂载后自动触发 Tier-2 中型发射中心外圈 4 槽展开',
    svgSymbolId: 'lc_vab_vertical',
    orbitTarget: 'LEO',
    ext: { mappedBuildingNames: ['重型航天发射场'], maxPayloadTons: 22 },
  },
  {
    id: 'asset.lc.prop_depot',
    name: '推进剂储罐与高压加注区',
    domain: 'launch_center',
    allowedInterfaces: ['launch_propellant'],
    worldbookRef: 'UID-4 · 推进剂储罐与加注区',
    costCredits: 1800,
    nanitesCost: 80,
    massTons: 10.0,
    workloadDays: 4,
    powerDeltaKw: 30,
    lifeSupportDelta: 20,
    effectSummary: '防爆地下储罐群与高纯液氧煤油闭路自动加注系统，缩短发射前推进剂加注流程',
    svgSymbolId: 'lc_prop_depot',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.lc.sat_mfg_center',
    name: '卫星制造中心',
    domain: 'launch_center',
    allowedInterfaces: ['launch_telemetry', 'launch_mega_payload_line'],
    worldbookRef: 'UID-47 · 卫星制造中心',
    costCredits: 3200,
    nanitesCost: 150,
    massTons: 14.0,
    workloadDays: 6,
    requiredResearch: '轨道侦察工学',
    powerDeltaKw: -20,
    lifeSupportDelta: 20,
    effectSummary: '双向映射独立建筑【卫星制造中心】：配备超净光学大厅与微波暗室，专司侦察/预警通信/勘探星与月面探测车制造',
    svgSymbolId: 'lc_sat_mfg_center',
    orbitTarget: 'LEO',
    ext: { mappedBuildingNames: ['卫星制造中心', '卫星测控站'] },
  },
  {
    id: 'asset.lc.pad_cryo',
    name: '2# 低温重型脐带发射塔架',
    domain: 'launch_center',
    allowedInterfaces: ['launch_pad_heavy'],
    worldbookRef: 'UID-4 · 2# 低温重型发射工位',
    costCredits: 3800,
    nanitesCost: 180,
    massTons: 35.0,
    workloadDays: 8,
    powerDeltaKw: -25,
    lifeSupportDelta: -10,
    effectSummary: '配备液氢液氧摆杆脐带臂与深水降温导流槽，解锁重型低温火箭(22t)与能源号重型火箭(35t)',
    svgSymbolId: 'lc_pad_cryo',
    orbitTarget: 'GEO',
    ext: { mappedBuildingNames: ['重型航天发射场'], maxPayloadTons: 35 },
  },
  {
    id: 'asset.lc.crawler_std',
    name: '重型双轨履带转运车与导流枢纽',
    domain: 'launch_center',
    allowedInterfaces: ['launch_hub_heavy'],
    worldbookRef: 'UID-4 · 重型双轨履带转运系统',
    costCredits: 2600,
    nanitesCost: 120,
    massTons: 22.0,
    workloadDays: 5,
    powerDeltaKw: -10,
    lifeSupportDelta: 10,
    effectSummary: '承载千吨级活动发射平台垂直转运，连通 VAB 总装大厅与 2# 低温重型发射工位',
    svgSymbolId: 'lc_crawler_std',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.lc.crawler_super_base',
    name: '超重型双轨转运与航天城流水线基座',
    domain: 'launch_center',
    allowedInterfaces: ['launch_hub_heavy'],
    worldbookRef: 'UID-4 · 超重型双轨转运与航天城基座',
    costCredits: 4600,
    nanitesCost: 220,
    massTons: 45.0,
    workloadDays: 9,
    powerDeltaKw: 30,
    lifeSupportDelta: 25,
    isExpansionHub: true,
    effectSummary: '万吨级电磁调平双轨路基与地下脉动总装管廊，挂载后自动触发 Tier-3「国家航天城」小巨构 4 槽展开',
    svgSymbolId: 'lc_crawler_super_base',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.lc.lz_recovery',
    name: '助推器垂直回收着陆坪 / 海上船坞',
    domain: 'launch_center',
    allowedInterfaces: ['launch_recovery'],
    worldbookRef: 'UID-4 · 助推器垂直回收坪与无人回收驳船',
    costCredits: 3000,
    nanitesCost: 140,
    massTons: 18.0,
    workloadDays: 6,
    requiredResearch: '可回收火箭工学',
    powerDeltaKw: -15,
    lifeSupportDelta: 10,
    effectSummary: '配备毫米波着陆制导雷达与稳姿机械爪，解锁芯一级与捆绑助推器 100% 垂直回收返库复用',
    svgSymbolId: 'lc_lz_recovery',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.lc.weather_laser_tower',
    name: '全天候防雷与深空测控阵',
    domain: 'launch_center',
    allowedInterfaces: ['launch_weather', 'launch_telemetry'],
    worldbookRef: 'UID-10 · 深空测控网络 / 全天候防雷测控塔',
    costCredits: 3600,
    nanitesCost: 170,
    massTons: 15.0,
    workloadDays: 7,
    powerDeltaKw: -25,
    lifeSupportDelta: 15,
    effectSummary: '双向映射独立建筑【深空测控网络】：飞秒激光引雷消雨，使本基地发射中心局部豁免雷暴/台风挂起并提供深空遥测',
    svgSymbolId: 'lc_weather_laser_tower',
    orbitTarget: 'GEO',
    ext: { mappedBuildingNames: ['深空测控网络', '全天候防雷测控塔'], weatherImmune: true },
  },
  {
    id: 'asset.lc.mechazilla_tower',
    name: '3# 百米级超重型机械臂捕获塔架',
    domain: 'launch_center',
    allowedInterfaces: ['launch_pad_super'],
    worldbookRef: '百米级超重型捕获发射塔架',
    costCredits: 7200,
    nanitesCost: 340,
    massTons: 65.0,
    workloadDays: 12,
    requiredResearch: '重型全复用运载工学',
    powerDeltaKw: -40,
    lifeSupportDelta: -15,
    effectSummary: '百米级缓冲捕获机械臂（筷子塔），解锁超级重型两级全复用运载系统（基准运力 65t+）并实现原位捕获复飞',
    svgSymbolId: 'lc_mechazilla_tower',
    orbitTarget: 'TLI',
    ext: { mappedBuildingNames: ['赤星轨道战略投送阵列'], maxPayloadTons: 65 },
  },
  {
    id: 'asset.lc.rocket_mega_fab',
    name: '火箭制造厂',
    domain: 'launch_center',
    allowedInterfaces: ['launch_mega_fab'],
    worldbookRef: 'UID-5 · 火箭制造厂',
    costCredits: 4500,
    nanitesCost: 210,
    massTons: 30.0,
    workloadDays: 8,
    powerDeltaKw: -30,
    lifeSupportDelta: -10,
    effectSummary: '双向映射基地独立建筑【火箭制造厂】（地下洞库旋压总厂）：专司各级发动机、芯一级、捆绑助推器与远征上面级制造',
    svgSymbolId: 'lc_rocket_mega_fab',
    orbitTarget: 'LEO',
    ext: { mappedBuildingNames: ['火箭制造厂'] },
  },
  {
    id: 'asset.lc.spacecraft_ait_hall',
    name: '大型航天器与舱段总装中心',
    domain: 'launch_center',
    allowedInterfaces: ['launch_mega_payload_line'],
    worldbookRef: 'UID-48 · 大型航天器与舱段总装中心',
    costCredits: 6500,
    nanitesCost: 300,
    massTons: 40.0,
    workloadDays: 10,
    requiredResearch: '空间站建造工学',
    powerDeltaKw: -35,
    lifeSupportDelta: 25,
    effectSummary: '双向映射基地独立建筑【大型航天器与舱段总装中心】：配备巨型热真空室，专司载人飞船、登月舱与 20t 级空间站舱段制造',
    svgSymbolId: 'lc_spacecraft_ait_hall',
    orbitTarget: 'LEO',
    ext: { mappedBuildingNames: ['大型航天器与舱段总装中心', '大型航天器与空间站舱段总装中心'] },
  },
  {
    id: 'asset.lc.cryo_methalox_plant',
    name: '深冷液氧甲烷原位合成化工厂',
    domain: 'launch_center',
    allowedInterfaces: ['launch_mega_cryo', 'launch_propellant'],
    worldbookRef: '深冷液氧甲烷原位合成厂',
    costCredits: 4200,
    nanitesCost: 195,
    massTons: 25.0,
    workloadDays: 8,
    powerDeltaKw: 60,
    lifeSupportDelta: 40,
    effectSummary: '萨巴蒂尔甲烷合成与大空分深冷液化基地，经地下真空保温管廊直供 1#/2#/3# 工位，每次发射净回款 +20%',
    svgSymbolId: 'lc_cryo_methalox_plant',
    orbitTarget: 'TLI',
  },
] as const;

/**
 * 内置 28 枚正典 SVG 构件资产库（空间站 12 种 + 星座卫星 6 种 + 月球基地 10 种）
 */
export const DEFAULT_SPACE_CANVAS_ASSETS: readonly SpaceCanvasAssetDef[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // 🛰️ 一、空间站舱段与桁架载荷资产（12 种）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'asset.st.core',
    name: '天枢核心控制舱',
    domain: 'station',
    allowedInterfaces: ['station_core'],
    worldbookRef: '轨道空间站工程·核心舱',
    costCredits: 5000,
    nanitesCost: 240,
    massTons: 20.0,
    workloadDays: 10,
    powerDeltaKw: 30,
    lifeSupportDelta: 20,
    effectSummary: '提供全站姿态控制、生命保障母机与六向主结构锚点（+30kW / +20维生）',
    svgSymbolId: 'st_core',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.st.node_hub',
    name: '六向在轨装配节点舱',
    domain: 'station',
    allowedInterfaces: ['station_hub_port', 'station_pressurized'],
    worldbookRef: 'UID-41 · 六向在轨装配节点舱',
    costCredits: 3200,
    nanitesCost: 150,
    massTons: 12.0,
    workloadDays: 6,
    powerDeltaKw: -5,
    lifeSupportDelta: 10,
    isExpansionHub: true,
    effectSummary: '六向加压机械臂转接枢纽，挂载后自动激活前向深空外延插槽',
    svgSymbolId: 'st_node_hub',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.st.heavy_truss',
    name: '长桁架与重型承力结构件',
    domain: 'station',
    allowedInterfaces: ['station_truss_power', 'station_hub_port'],
    worldbookRef: 'UID-40 · 长桁架与重型承力结构件',
    costCredits: 2800,
    nanitesCost: 160,
    massTons: 15.0,
    workloadDays: 5,
    powerDeltaKw: 20,
    lifeSupportDelta: 0,
    isExpansionHub: true,
    effectSummary: '重型碳纤维主干桁架与高压配电母线，挂载后激活双翼远端扩展插槽（+20kW）',
    svgSymbolId: 'st_heavy_truss',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.st.hab',
    name: '常驻乘员居住生活舱',
    domain: 'station',
    allowedInterfaces: ['station_pressurized', 'station_hub_port'],
    worldbookRef: '轨道空间站工程·居住舱',
    costCredits: 3600,
    nanitesCost: 180,
    massTons: 18.0,
    workloadDays: 7,
    powerDeltaKw: -15,
    lifeSupportDelta: 45,
    effectSummary: '配备再生水气循环与防辐射睡眠区，大幅提升全站维生冗余（+45维生）',
    svgSymbolId: 'st_hab',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.st.lab',
    name: '微重力高精材料实验舱',
    domain: 'station',
    allowedInterfaces: ['station_pressurized', 'station_hub_port'],
    worldbookRef: '轨道空间站工程·实验舱',
    costCredits: 4500,
    nanitesCost: 220,
    massTons: 20.0,
    workloadDays: 9,
    powerDeltaKw: -35,
    lifeSupportDelta: -10,
    effectSummary: '开展零重力单晶材料与高能物理试验，全战区科研推进效率 +12%',
    svgSymbolId: 'st_lab',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.st.solar',
    name: '标准太阳翼与供配电组件',
    domain: 'station',
    allowedInterfaces: ['station_truss_power'],
    worldbookRef: 'UID-39 · 标准太阳翼与供配电组件',
    costCredits: 2400,
    nanitesCost: 110,
    massTons: 8.5,
    workloadDays: 4,
    powerDeltaKw: 65,
    lifeSupportDelta: 0,
    effectSummary: '双轴跟踪柔性砷化镓太阳翼阵列，提供 +65kW 稳定清洁电力',
    svgSymbolId: 'st_solar',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.st.reactor',
    name: '千瓦级轨道核反应堆舱',
    domain: 'station',
    allowedInterfaces: ['station_truss_power'],
    worldbookRef: 'UID-38 · 千瓦级轨道核反应堆舱',
    costCredits: 5800,
    nanitesCost: 280,
    massTons: 16.0,
    workloadDays: 10,
    requiredResearch: '空间核反应堆与同位素热源技术',
    powerDeltaKw: 120,
    lifeSupportDelta: -10,
    effectSummary: '快中子液态金属冷却轨道核堆，输出 +120kW 全天候强劲电力（需消耗10点散热）',
    svgSymbolId: 'st_reactor',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.st.radiator_ep',
    name: '大功率电推进与散热翼',
    domain: 'station',
    allowedInterfaces: ['station_truss_power', 'station_pressurized', 'station_truss_payload'],
    worldbookRef: 'UID-37 · 大功率电推进与散热翼',
    costCredits: 2900,
    nanitesCost: 130,
    massTons: 9.5,
    workloadDays: 5,
    powerDeltaKw: -20,
    lifeSupportDelta: 40,
    effectSummary: '霍尔电推进器与液滴辐射散热翼，提供 +40 热控维生冗余并维持轨道高度免衰减',
    svgSymbolId: 'st_radiator_ep',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.st.fuel_depot',
    name: '在轨低温燃料补给站',
    domain: 'station',
    allowedInterfaces: ['station_truss_payload', 'station_pressurized', 'station_hub_port'],
    worldbookRef: 'UID-9 · 在轨低温燃料补给站',
    costCredits: 4200,
    nanitesCost: 200,
    massTons: 22.0,
    workloadDays: 8,
    powerDeltaKw: -15,
    lifeSupportDelta: -5,
    effectSummary: '零蒸发低温液氢液氧与肼类储罐簇，地月转移与深空发射任务燃料成本 -25%',
    svgSymbolId: 'st_fuel_depot',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.st.recon_array',
    name: '轨道侦察预警平台阵列',
    domain: 'station',
    allowedInterfaces: ['station_truss_payload', 'station_truss_power'],
    worldbookRef: 'UID-8 · 轨道侦察预警平台阵列',
    costCredits: 4600,
    nanitesCost: 210,
    massTons: 14.0,
    workloadDays: 8,
    powerDeltaKw: -30,
    lifeSupportDelta: -5,
    effectSummary: '大口径多光谱望远镜与相控阵电子侦察天线，全天候监控敌方导弹尾焰与集群调动',
    svgSymbolId: 'st_recon_array',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.st.kinetic_rod',
    name: '轨道钨合金动能武器挂架',
    domain: 'station',
    allowedInterfaces: ['station_truss_payload', 'station_truss_power'],
    worldbookRef: 'UID-12 · 轨道钨合金动能武器挂架',
    costCredits: 7500,
    nanitesCost: 360,
    massTons: 25.0,
    workloadDays: 12,
    requiredResearch: '天基动能再入制导技术',
    powerDeltaKw: -50,
    lifeSupportDelta: -15,
    effectSummary: '俗称“上帝之杖”，挂载再入制导钨棒弹舱，提供天基高超音速精确动能打击能力',
    svgSymbolId: 'st_kinetic_rod',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.st.orbital_dock',
    name: '轨道船坞重型总装臂',
    domain: 'station',
    allowedInterfaces: ['station_pressurized', 'station_hub_port', 'station_truss_payload'],
    worldbookRef: 'UID-14 · 轨道船坞重型总装臂',
    costCredits: 6800,
    nanitesCost: 320,
    massTons: 28.0,
    workloadDays: 11,
    powerDeltaKw: -45,
    lifeSupportDelta: -15,
    effectSummary: '深空外延船坞专属桁架龙门与激光焊接机械臂，解锁地月飞船在轨总装与战损修复',
    svgSymbolId: 'st_orbital_dock',
    orbitTarget: 'LEO',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 🌐 二、轨道星座组网卫星资产（6 种）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'asset.sat.opt_recon',
    name: '低轨高分光学侦察星',
    domain: 'constellation',
    allowedInterfaces: ['orbit_leo', 'orbit_sso'],
    worldbookRef: '天基侦察卫星·光学详查型',
    costCredits: 1800,
    nanitesCost: 80,
    massTons: 4.5,
    workloadDays: 4,
    powerDeltaKw: 0,
    lifeSupportDelta: 0,
    effectSummary: '亚米级高分辨率光学成像，提供战区重点目标的实时详查视野',
    svgSymbolId: 'sat_opt_recon',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.sat.sar_radar',
    name: '全天候SAR合成孔径雷达星',
    domain: 'constellation',
    allowedInterfaces: ['orbit_sso', 'orbit_leo'],
    worldbookRef: '天基侦察卫星·合成孔径雷达型',
    costCredits: 2200,
    nanitesCost: 100,
    massTons: 6.0,
    workloadDays: 5,
    powerDeltaKw: 0,
    lifeSupportDelta: 0,
    effectSummary: '穿透云雨、暴风雪与伪装网的全天候雷达扫描，锁定地面装甲与舰队动向',
    svgSymbolId: 'sat_sar_radar',
    orbitTarget: 'SSO',
  },
  {
    id: 'asset.sat.geo_survey',
    name: '天基重磁与地质资源勘探星',
    domain: 'constellation',
    allowedInterfaces: ['orbit_sso', 'orbit_leo'],
    worldbookRef: 'UID-24 · 天基重磁与地质资源勘探星',
    costCredits: 2100,
    nanitesCost: 95,
    massTons: 5.5,
    workloadDays: 5,
    powerDeltaKw: 0,
    lifeSupportDelta: 0,
    effectSummary: '利用高精度重力梯度与高光谱遥感，探明隐藏矿脉与月面极地富矿分布',
    svgSymbolId: 'sat_geo_survey',
    orbitTarget: 'SSO',
  },
  {
    id: 'asset.sat.comm_relay',
    name: '量子宽带通信中继星',
    domain: 'constellation',
    allowedInterfaces: ['orbit_leo', 'orbit_geo', 'orbit_sso'],
    worldbookRef: 'UID-25 · 量子宽带通信中继星',
    costCredits: 1900,
    nanitesCost: 85,
    massTons: 5.0,
    workloadDays: 4,
    powerDeltaKw: 0,
    lifeSupportDelta: 0,
    effectSummary: '构建抗强电磁干扰的跨战区星间激光通信网，提升多基地协同调度带宽',
    svgSymbolId: 'sat_comm_relay',
    orbitTarget: 'LEO',
  },
  {
    id: 'asset.sat.nav_timing',
    name: '全球天基导航授时星',
    domain: 'constellation',
    allowedInterfaces: ['orbit_geo', 'orbit_sso'],
    worldbookRef: 'UID-25 · 全球天基导航授时星',
    costCredits: 2000,
    nanitesCost: 90,
    massTons: 4.8,
    workloadDays: 4,
    powerDeltaKw: 0,
    lifeSupportDelta: 0,
    effectSummary: '搭载星载氢原子钟，为全军远程火炮、巡航导弹与无人机群提供厘米级定位授时',
    svgSymbolId: 'sat_nav_timing',
    orbitTarget: 'GEO',
  },
  {
    id: 'asset.sat.early_warn',
    name: '高轨红外弹道导弹预警与深空中继星',
    domain: 'constellation',
    allowedInterfaces: ['orbit_geo'],
    worldbookRef: 'UID-8/10 · 高轨红外预警与深空中继星',
    costCredits: 3200,
    nanitesCost: 140,
    massTons: 8.5,
    workloadDays: 6,
    powerDeltaKw: 0,
    lifeSupportDelta: 0,
    effectSummary: '定点地球静止高轨，凝视全球洲际导弹红外尾焰并兼任地月深空激光测控中继',
    svgSymbolId: 'sat_early_warn',
    orbitTarget: 'GEO',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 🌕 三、月球基地（沙克尔顿环形山）设施资产（10 种）
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'asset.ln.core',
    name: '月面半埋式防辐射指挥核心舱',
    domain: 'lunar',
    allowedInterfaces: ['lunar_core'],
    worldbookRef: 'UID-16/19 · 月面半埋式防辐射指挥核心舱',
    costCredits: 5500,
    nanitesCost: 260,
    massTons: 24.0,
    workloadDays: 12,
    powerDeltaKw: 25,
    lifeSupportDelta: 30,
    effectSummary: '覆有3米玄武岩月壤防辐射穹顶的基地主控中心，内置应急燃料电池（+25kW / +30维生）',
    svgSymbolId: 'ln_core',
    orbitTarget: 'TLI',
  },
  {
    id: 'asset.ln.tunnel_hub',
    name: '月表加压管廊延伸枢纽',
    domain: 'lunar',
    allowedInterfaces: ['lunar_hub_tunnel', 'lunar_inner'],
    worldbookRef: '月表加压管廊延伸枢纽',
    costCredits: 3000,
    nanitesCost: 140,
    massTons: 14.0,
    workloadDays: 6,
    powerDeltaKw: -10,
    lifeSupportDelta: 15,
    isExpansionHub: true,
    effectSummary: '高气密玄武岩纤维加压管廊节点，挂载后向外解锁极地暗坑水冰、月海氦-3与山脊电磁发射槽',
    svgSymbolId: 'ln_tunnel_hub',
    orbitTarget: 'TLI',
  },
  {
    id: 'asset.ln.landing_pad',
    name: '月面软着陆信标与货运起降坪',
    domain: 'lunar',
    allowedInterfaces: ['lunar_pad'],
    worldbookRef: '月面软着陆信标与货运起降坪',
    costCredits: 2600,
    nanitesCost: 120,
    massTons: 12.0,
    workloadDays: 5,
    powerDeltaKw: -10,
    lifeSupportDelta: 0,
    effectSummary: '微波烧结防尘月壤硬化起降坪与毫米波着陆引导信标，大幅降低地月货运着陆风险',
    svgSymbolId: 'ln_landing_pad',
    orbitTarget: 'TLI',
  },
  {
    id: 'asset.ln.solar_peak',
    name: '环形山永昼峰高耸太阳翼阵',
    domain: 'lunar',
    allowedInterfaces: ['lunar_inner', 'lunar_hub_tunnel'],
    worldbookRef: '环形山永昼峰高耸太阳翼阵',
    costCredits: 2800,
    nanitesCost: 130,
    massTons: 10.0,
    workloadDays: 5,
    powerDeltaKw: 80,
    lifeSupportDelta: 0,
    effectSummary: '竖立于沙克尔顿环形山边缘永昼峰顶的垂直追日光电塔，提供 +80kW 持续日照电力',
    svgSymbolId: 'ln_solar_peak',
    orbitTarget: 'TLI',
  },
  {
    id: 'asset.ln.fission_plant',
    name: '月表千瓦/兆瓦级核裂变电站',
    domain: 'lunar',
    allowedInterfaces: ['lunar_inner', 'lunar_hub_tunnel'],
    worldbookRef: 'UID-36/38 · 月表核裂变电站',
    costCredits: 6200,
    nanitesCost: 300,
    massTons: 18.0,
    workloadDays: 10,
    requiredResearch: '空间核反应堆与同位素热源技术',
    powerDeltaKw: 150,
    lifeSupportDelta: -10,
    effectSummary: '半埋式斯特林闭式循环核裂变矩阵，无惧长达14地球日的极寒月夜，输出 +150kW 主力电力',
    svgSymbolId: 'ln_fission_plant',
    orbitTarget: 'TLI',
  },
  {
    id: 'asset.ln.bio_dome',
    name: '闭环水气循环与生态农业温室',
    domain: 'lunar',
    allowedInterfaces: ['lunar_inner', 'lunar_hub_tunnel'],
    worldbookRef: '闭环水气循环与生态农业温室',
    costCredits: 3900,
    nanitesCost: 180,
    massTons: 16.0,
    workloadDays: 8,
    powerDeltaKw: -25,
    lifeSupportDelta: 65,
    effectSummary: '全光谱人工日照无土栽培与氧气再生穹顶，提供 +65 维生保障，支撑大规模月面驻军',
    svgSymbolId: 'ln_bio_dome',
    orbitTarget: 'TLI',
  },
  {
    id: 'asset.ln.rover_bay',
    name: '月面无人探测车与机娘整备车库',
    domain: 'lunar',
    allowedInterfaces: ['lunar_inner', 'lunar_hub_tunnel', 'lunar_pad'],
    worldbookRef: '月面无人探测车与机娘整备车库',
    costCredits: 3400,
    nanitesCost: 160,
    massTons: 15.0,
    workloadDays: 6,
    powerDeltaKw: -20,
    lifeSupportDelta: 5,
    isRoverSurveyor: true,
    effectSummary: '配备全地形巡视车与机娘月面外骨骼整备台，挂载后自动完成外环水冰与氦-3矿脉勘探解锁',
    svgSymbolId: 'ln_rover_bay',
    orbitTarget: 'TLI',
  },
  {
    id: 'asset.ln.ice_electrolysis',
    name: '极地水冰钻探与氢氧电解站',
    domain: 'lunar',
    allowedInterfaces: ['lunar_rim_isru', 'lunar_inner'],
    worldbookRef: '极地水冰钻探与氢氧电解站',
    costCredits: 4800,
    nanitesCost: 220,
    massTons: 20.0,
    workloadDays: 9,
    powerDeltaKw: -45,
    lifeSupportDelta: 50,
    effectSummary: '深入极地永久阴影坑钻取水冰并电解制取液氢液氧，副产氧气提供 +50 维生并满足返程燃料自给',
    svgSymbolId: 'ln_ice_electrolysis',
    orbitTarget: 'TLI',
  },
  {
    id: 'asset.ln.he3_refinery',
    name: '月面采矿与氦-3同位素分离厂',
    domain: 'lunar',
    allowedInterfaces: ['lunar_rim_isru'],
    worldbookRef: 'UID-13 · 月面采矿与氦-3同位素分离厂',
    costCredits: 6600,
    nanitesCost: 310,
    massTons: 26.0,
    workloadDays: 11,
    powerDeltaKw: -70,
    lifeSupportDelta: -20,
    effectSummary: '高温热解月海钛铁矿富集月壤，持续分离提纯战略级聚变燃料氦-3与特种工业钛合金',
    svgSymbolId: 'ln_he3_refinery',
    orbitTarget: 'TLI',
  },
  {
    id: 'asset.ln.mass_driver',
    name: '月表电磁质量投射器',
    domain: 'lunar',
    allowedInterfaces: ['lunar_pad', 'lunar_rim_isru'],
    worldbookRef: '月表电磁质量投射器',
    costCredits: 8200,
    nanitesCost: 380,
    massTons: 30.0,
    workloadDays: 14,
    powerDeltaKw: -90,
    lifeSupportDelta: -10,
    effectSummary: '沿环形山脊铺设数公里超导直线加速轨道，无需化学火箭即可将氦-3货舱直接弹射回地球轨道',
    svgSymbolId: 'ln_mass_driver',
    orbitTarget: 'TLI',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 🚀 四、地面与母港发射中心及航天城小巨构构件资产（14 种）
  // ═══════════════════════════════════════════════════════════════════════════
  ...LAUNCH_CENTER_ASSETS,
] as const;

/**
 * 地面与母港发射中心核心协同羁绊（FD-27 §4.2）
 */
export const LAUNCH_CENTER_SYNERGIES: readonly SpaceCanvasSynergyDef[] = [
  {
    id: 'syn.lc.spaceport_city',
    domain: 'launch_center',
    name: '【国家航天城 · 产装测发全链路流水线】',
    description:
      '同一基地发射中心同时建成 垂直总装测试厂房(VAB) + 火箭制造厂·地下洞库旋压总厂 + 大型航天器与舱段总装中心 + 深冷液氧甲烷原位合成化工厂',
    bonusSummary:
      '基地升格为「国家航天城」小巨构：解锁独立航天装备产线，本基地航天装备排产效率 ×1.50（工期 -35%），综合造发成本 -25%',
    ringTone: 'amber',
    checkActive: (mountedAssets, slotAssetMap) => {
      const ids = new Set(mountedAssets.map(a => a.id));
      const hasVab = ids.has('asset.lc.vab_vertical') || slotAssetMap.lc_hif === 'asset.lc.vab_vertical';
      const hasFab =
        ids.has('asset.lc.rocket_mega_fab') || Boolean(slotAssetMap.lc_underground_fab);
      const hasPayloadHall =
        ids.has('asset.lc.spacecraft_ait_hall') ||
        Boolean(slotAssetMap.lc_spacecraft_hall);
      const hasCryo =
        ids.has('asset.lc.cryo_methalox_plant') || Boolean(slotAssetMap.lc_cryo_plant);
      return hasVab && hasFab && hasPayloadHall && hasCryo;
    },
  },
  {
    id: 'syn.lc.full_reuse_starbase',
    domain: 'launch_center',
    name: '【两级完全复用 · 星舰极速周转阵列】',
    description:
      '同时建成 3# 百米级超重型机械臂捕获塔架 + 助推器垂直回收着陆坪/海上船坞 + 深冷液氧甲烷原位合成化工厂',
    bonusSummary:
      '发射「超级重型两级全复用运载系统」默认享受全复用加成，单次最大运力提升至 80t，支持单回合多份合同并发点火',
    ringTone: 'cyan',
    checkActive: (mountedAssets, slotAssetMap) => {
      const ids = new Set(mountedAssets.map(a => a.id));
      const hasMechazilla =
        ids.has('asset.lc.mechazilla_tower') || Boolean(slotAssetMap.lc_pad_super);
      const hasRecovery =
        ids.has('asset.lc.lz_recovery') || Boolean(slotAssetMap.lc_recovery_zone);
      const hasCryo =
        ids.has('asset.lc.cryo_methalox_plant') || Boolean(slotAssetMap.lc_cryo_plant);
      return hasMechazilla && hasRecovery && hasCryo;
    },
  },
] as const;

/**
 * 默认内置组网与拼装协同羁绊（含星座 4 大核心羁绊 + 空间站/月球基地组合协同羁绊）
 */
export const DEFAULT_SPACE_CANVAS_SYNERGIES: readonly SpaceCanvasSynergyDef[] = [
  // ── 星座 4 大核心组网羁绊 ──
  {
    id: 'syn.constellation.sky_eye',
    domain: 'constellation',
    name: '【天眼全天候侦察网】',
    description: '在轨同时部署 ≥1 颗低轨高分光学侦察星 + ≥1 颗全天候SAR合成孔径雷达星',
    bonusSummary: '点亮青色极轨扫描环，光学+雷达双模互补，彻底消除全天候战争迷雾',
    ringTone: 'cyan',
    checkActive: mountedAssets => {
      const hasOpt = mountedAssets.some(a => a.id === 'asset.sat.opt_recon');
      const hasSar = mountedAssets.some(a => a.id === 'asset.sat.sar_radar');
      return hasOpt && hasSar;
    },
  },
  {
    id: 'syn.constellation.quantum_link',
    domain: 'constellation',
    name: '【全球量子指挥数据链】',
    description: '在轨同时部署 ≥2 颗量子宽带通信中继星 + ≥1 颗全球天基导航授时星',
    bonusSummary: '点亮琥珀色通联环，多基地跨战区工程调度与远程精确制导效率大幅提升',
    ringTone: 'amber',
    checkActive: mountedAssets => {
      const commCount = mountedAssets.filter(a => a.id === 'asset.sat.comm_relay').length;
      const navCount = mountedAssets.filter(a => a.id === 'asset.sat.nav_timing').length;
      return commCount >= 2 && navCount >= 1;
    },
  },
  {
    id: 'syn.constellation.aegis_dome',
    domain: 'constellation',
    name: '【苍穹反导预警穹顶】',
    description: '在 GEO 地球静止高轨部署 ≥2 颗高轨红外弹道导弹预警星',
    bonusSummary: '点亮紫罗兰高轨警戒环，敌方战略超武与洲际弹道导弹点火瞬间即可捕获预警',
    ringTone: 'violet',
    checkActive: (_mountedAssets, slotAssetMap) => {
      const geoSlots = ['orb_geo_1', 'orb_geo_2', 'orb_geo_3', 'orb_geo_4'];
      const geoEarlyWarnCount = geoSlots.filter(
        slotId => slotAssetMap[slotId] === 'asset.sat.early_warn',
      ).length;
      return geoEarlyWarnCount >= 2;
    },
  },
  {
    id: 'syn.constellation.cislunar_corridor',
    domain: 'constellation',
    name: '【地月深空测控走廊】',
    description: '在轨同时部署 ≥1 颗高轨红外预警/深空中继星 + ≥1 颗天基地质资源勘探星',
    bonusSummary: '点亮翡翠色深空走廊环，打通地月高带宽遥测链路并为月球外环矿脉提供天基导航支撑',
    ringTone: 'emerald',
    checkActive: mountedAssets => {
      const hasEarlyWarn = mountedAssets.some(a => a.id === 'asset.sat.early_warn');
      const hasGeoSurvey = mountedAssets.some(a => a.id === 'asset.sat.geo_survey');
      return hasEarlyWarn && hasGeoSurvey;
    },
  },
  // ── 空间站与月球基地协同羁绊 ──
  {
    id: 'syn.station.deep_space_port',
    domain: 'station',
    name: '【深空母港与在轨加注中心】',
    description: '同时挂载六向在轨装配节点舱 + 在轨低温燃料补给站 + 轨道船坞重型总装臂',
    bonusSummary: '空间站升级为地月转运母港，深空飞船在轨拼装与地月往返燃料消耗降低 35%',
    ringTone: 'cyan',
    checkActive: mountedAssets => {
      const ids = new Set(mountedAssets.map(a => a.id));
      return (
        ids.has('asset.st.node_hub') &&
        ids.has('asset.st.fuel_depot') &&
        ids.has('asset.st.orbital_dock')
      );
    },
  },
  {
    id: 'syn.lunar.he3_express',
    domain: 'lunar',
    name: '【地月氦-3电磁直通快线】',
    description: '同时部署月面采矿与氦-3同位素分离厂 + 月表电磁质量投射器 + 核裂变电站',
    bonusSummary: '形成月面核能开采—氦-3提纯—电磁弹射入轨全自动工业闭环，持续向地球输送聚变能源',
    ringTone: 'emerald',
    checkActive: mountedAssets => {
      const ids = new Set(mountedAssets.map(a => a.id));
      return (
        ids.has('asset.ln.he3_refinery') &&
        ids.has('asset.ln.mass_driver') &&
        ids.has('asset.ln.fission_plant')
      );
    },
  },
  // ── 地面与母港发射中心协同羁绊 ──
  ...LAUNCH_CENTER_SYNERGIES,
] as const;

// ═══════════════════════════════════════════════════════════════════════════
// 开放式动态注册表状态与 API
// ═══════════════════════════════════════════════════════════════════════════

const domainRegistry = new Map<SpaceCanvasDomainId, SpaceCanvasDomainDef>();
const slotRegistry = new Map<SpaceCanvasDomainId, SpaceCanvasSlotDef[]>();
const slotByIdRegistry = new Map<string, SpaceCanvasSlotDef>();
const assetRegistry = new Map<string, SpaceCanvasAssetDef>();
const assetByNameRegistry = new Map<string, SpaceCanvasAssetDef>();
const synergyRegistry = new Map<string, SpaceCanvasSynergyDef>();

/** 只读插槽 ID 索引（O(1) 查找） */
export const SLOT_BY_ID_MAP: ReadonlyMap<string, SpaceCanvasSlotDef> = slotByIdRegistry;
/** 只读构件 ID 索引（O(1) 查找） */
export const ASSET_BY_ID_MAP: ReadonlyMap<string, SpaceCanvasAssetDef> = assetRegistry;
/** 只读构件名称索引（O(1) 查找） */
export const ASSET_BY_NAME_MAP: ReadonlyMap<string, SpaceCanvasAssetDef> = assetByNameRegistry;

function cloneSlotDef(slot: SpaceCanvasSlotDef): SpaceCanvasSlotDef {
  return {
    ...slot,
    connectedTo: slot.connectedTo ? [...slot.connectedTo] : undefined,
    meta: slot.meta ? { ...slot.meta } : undefined,
  };
}

function cloneAssetDef(asset: SpaceCanvasAssetDef): SpaceCanvasAssetDef {
  return {
    ...asset,
    allowedInterfaces: [...asset.allowedInterfaces],
    ext: asset.ext ? { ...asset.ext } : undefined,
  };
}

/**
 * 将注册表重置为内置默认状态（单测隔离与热重载安全基线）
 */
export function resetSpaceCanvasRegistryToDefaults(): void {
  domainRegistry.clear();
  slotRegistry.clear();
  slotByIdRegistry.clear();
  assetRegistry.clear();
  assetByNameRegistry.clear();
  synergyRegistry.clear();

  for (const domain of DEFAULT_SPACE_CANVAS_DOMAINS) {
    domainRegistry.set(domain.id, { ...domain });
    slotRegistry.set(domain.id, []);
  }

  for (const slot of DEFAULT_SPACE_CANVAS_SLOTS) {
    const list = slotRegistry.get(slot.domain) ?? [];
    const cloned = cloneSlotDef(slot);
    list.push(cloned);
    slotRegistry.set(slot.domain, list);
    slotByIdRegistry.set(cloned.id, cloned);
  }

  for (const asset of DEFAULT_SPACE_CANVAS_ASSETS) {
    const cloned = cloneAssetDef(asset);
    assetRegistry.set(cloned.id, cloned);
    assetByNameRegistry.set(cloned.name, cloned);
  }

  for (const synergy of DEFAULT_SPACE_CANVAS_SYNERGIES) {
    synergyRegistry.set(synergy.id, { ...synergy });
  }
}

// 模块加载时初始化默认注册表
resetSpaceCanvasRegistryToDefaults();

/**
 * 注册或覆写一个画布域定义
 */
export function registerSpaceCanvasDomain(domainDef: SpaceCanvasDomainDef): void {
  if (!domainDef || !domainDef.id) return;
  domainRegistry.set(domainDef.id, { ...domainDef });
  if (!slotRegistry.has(domainDef.id)) {
    slotRegistry.set(domainDef.id, []);
  }
}

/**
 * 向指定画布域追加或按 id 覆写拓扑插槽（兼容传入 (domainId, slots) 或直接传入 (slots)）
 */
export function registerSpaceCanvasSlots(
  domainIdOrSlots: SpaceCanvasDomainId | SpaceCanvasSlotDef[],
  maybeSlots?: SpaceCanvasSlotDef[],
): void {
  const slots: SpaceCanvasSlotDef[] = Array.isArray(domainIdOrSlots)
    ? domainIdOrSlots
    : Array.isArray(maybeSlots)
      ? maybeSlots.map(s => ({ ...s, domain: s.domain || domainIdOrSlots }))
      : [];

  for (const rawSlot of slots) {
    if (!rawSlot || !rawSlot.id || !rawSlot.domain) continue;
    const domain = rawSlot.domain;
    if (!domainRegistry.has(domain)) {
      domainRegistry.set(domain, {
        id: domain,
        title: `${domain} 扩展天基画布`,
        subtitle: '自定义扩展拓扑节点画布',
        viewBoxWidth: 800,
        viewBoxHeight: 460,
        centerX: 400,
        centerY: 230,
      });
    }
    const existing = slotRegistry.get(domain) ?? [];
    const idx = existing.findIndex(item => item.id === rawSlot.id);
    const cloned = cloneSlotDef(rawSlot);
    if (idx >= 0) {
      existing[idx] = cloned;
    } else {
      existing.push(cloned);
    }
    slotRegistry.set(domain, existing);
    slotByIdRegistry.set(cloned.id, cloned);
  }
}

/**
 * 批量注册或按 id 覆写可挂载 SVG 构件资产
 */
export function registerSpaceCanvasAssets(assets: SpaceCanvasAssetDef[]): void {
  if (!Array.isArray(assets)) return;
  for (const asset of assets) {
    if (!asset || !asset.id) continue;
    const prev = assetRegistry.get(asset.id);
    if (prev && prev.name !== asset.name) {
      assetByNameRegistry.delete(prev.name);
    }
    const cloned = cloneAssetDef(asset);
    assetRegistry.set(cloned.id, cloned);
    if (cloned.name) {
      assetByNameRegistry.set(cloned.name, cloned);
    }
  }
}

/**
 * 批量注册或按 id 覆写组网/拼装羁绊
 */
export function registerSpaceCanvasSynergies(synergies: SpaceCanvasSynergyDef[]): void {
  if (!Array.isArray(synergies)) return;
  for (const synergy of synergies) {
    if (!synergy || !synergy.id) continue;
    synergyRegistry.set(synergy.id, { ...synergy });
  }
}

/**
 * 获取指定画布域定义（若未知则返回兜底域定义）
 */
export function getSpaceCanvasDomain(domainId: SpaceCanvasDomainId): SpaceCanvasDomainDef {
  const hit = domainRegistry.get(domainId);
  if (hit) return { ...hit };
  return {
    id: domainId,
    title: `${domainId} 天基画布`,
    subtitle: '天基模块化节点拓扑画布',
    viewBoxWidth: 800,
    viewBoxHeight: 460,
    centerX: 400,
    centerY: 230,
  };
}

/**
 * 获取所有已注册的画布域列表
 */
export function getSpaceCanvasDomains(): SpaceCanvasDomainDef[] {
  return Array.from(domainRegistry.values()).map(d => ({ ...d }));
}

/**
 * 获取指定画布域下的全部插槽定义
 */
export function getSpaceCanvasSlots(domainId: SpaceCanvasDomainId): SpaceCanvasSlotDef[] {
  const list = slotRegistry.get(domainId) ?? [];
  return list.map(cloneSlotDef);
}

const SLOT_ID_ALIAS_MAP: Record<string, string> = {
  lc_sat_cleanroom: 'lc_spacecraft_hall',
};

const ASSET_ID_ALIAS_MAP: Record<string, string> = {
  'asset.lc.propellant_std': 'asset.lc.prop_depot',
  'asset.lc.hif_horizontal': 'asset.lc.hif_horiz',
  'asset.lc.telemetry_mobile': 'asset.lc.sat_mfg_center',
  'asset.lc.weather_lightning_tower': 'asset.lc.weather_laser_tower',
  'asset.lc.underground_rocket_fab': 'asset.lc.rocket_mega_fab',
  'asset.lc.cleanroom_sat_line': 'asset.lc.spacecraft_ait_hall',
  'asset.lc.pad_mechazilla': 'asset.lc.mechazilla_tower',
};

/**
 * 按插槽 ID O(1) 精确查询单个插槽定义（返回安全克隆）
 */
export function getSpaceCanvasSlotById(slotId?: string | null): SpaceCanvasSlotDef | undefined {
  if (!slotId) return undefined;
  const key = slotId.trim();
  const hit = slotByIdRegistry.get(key) ?? slotByIdRegistry.get(SLOT_ID_ALIAS_MAP[key] ?? '');
  return hit ? cloneSlotDef(hit) : undefined;
}

/**
 * 内部只读快速查找插槽定义（避免高频查询反复 cloneSlotDef）
 */
export function getReadonlySpaceCanvasSlotById(
  slotId?: string | null,
): Readonly<SpaceCanvasSlotDef> | undefined {
  if (!slotId) return undefined;
  const key = slotId.trim();
  return slotByIdRegistry.get(key) ?? slotByIdRegistry.get(SLOT_ID_ALIAS_MAP[key] ?? '');
}

/**
 * 获取指定画布域（或全部域）的可挂载构件资产列表
 */
export function getSpaceCanvasAssets(domainId?: SpaceCanvasDomainId): SpaceCanvasAssetDef[] {
  const all = Array.from(assetRegistry.values());
  const filtered = domainId ? all.filter(a => a.domain === domainId) : all;
  return filtered.map(cloneAssetDef);
}

/**
 * 内部只读快速查找构件资产定义（支持按 ID、别名或名称 O(1) 查找，避免高频内部查询每次 cloneAssetDef）
 */
export function getReadonlySpaceCanvasAssetById(
  assetId?: string | null,
): Readonly<SpaceCanvasAssetDef> | undefined {
  if (!assetId) return undefined;
  const key = assetId.trim();
  if (!key) return undefined;
  const aliased = ASSET_ID_ALIAS_MAP[key];
  return (
    assetRegistry.get(key) ??
    (aliased ? assetRegistry.get(aliased) : undefined) ??
    assetByNameRegistry.get(key)
  );
}

/**
 * 按构件 ID（或名称）O(1) 精确查询单个资产定义
 */
export function getSpaceCanvasAssetById(assetId?: string | null): SpaceCanvasAssetDef | undefined {
  const hit = getReadonlySpaceCanvasAssetById(assetId);
  return hit ? cloneAssetDef(hit as SpaceCanvasAssetDef) : undefined;
}

/**
 * 获取指定画布域（或全部域）的羁绊定义列表
 */
export function getSpaceCanvasSynergies(domainId?: SpaceCanvasDomainId): SpaceCanvasSynergyDef[] {
  const all = Array.from(synergyRegistry.values());
  return domainId ? all.filter(s => s.domain === domainId) : all;
}
