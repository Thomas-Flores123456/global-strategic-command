import {
  combineLegacyPrerequisites,
  evaluatePrerequisite,
  expandTechEquivalentSet,
  validateLegacyRequirementFields,
  type PrerequisiteBaseState,
  type PrerequisiteContext,
  type PrerequisiteDiagnostic,
  type PrerequisiteProtocolEntryLike,
  type PrerequisiteProtocolSource,
  type PrerequisiteResearchCatalogEntryLike,
  type UnmetPrerequisite,
} from './prerequisites';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isIterableNonString(val: unknown): val is Iterable<unknown> {
  return (
    val !== null &&
    val !== undefined &&
    typeof val !== 'string' &&
    typeof (val as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function'
  );
}

/* ═══════════════ 世界书 V2 科技别名与历史简称同义词等价组（PKG-A · §3.1 A-2） ═══════════════ */

export const TECH_EQUIVALENT_GROUPS: readonly (readonly string[])[] = [
  ['化学火箭推进学', '火箭推进基础工学'],
  ['可复用运载火箭工学', '可回收火箭工学'],
  ['天基侦察与遥感学', '轨道侦察工学'],
  ['重型全复用运载工学', '地月转移轨道工学'],
  ['空间核动力工学', '空间太阳能发电工学'],
  ['在轨组装与发射工学', '在轨组装工学'],
  ['月面电磁投射工学', '月面原位资源利用工学', '火箭推进基础工学', '可回收火箭工学', '轨道侦察工学'],
  ['特种原油催化裂解学', '特种重油处理学', '灵沁油处理学', 'ind.research.t1.heavy_oil_processing'],
  ['特种高能原油加氢精制学', '特种高能原油完全精炼工学', '灵沁油完全精炼工学', 'ind.research.t2.advanced_fuel_fractionation'],
  ['战术气象干预工学', '战术气象武器工学', 'ind.research.t2.tactical_weather_engineering'],
  ['电子对抗工学', '全频谱电子对抗工学', 'ext.tech.common.electronic_warfare'],
  ['无人地面平台学', '无人地面平台工学'],
  ['通用导弹制导与再入理论', '精确制导武器学', 'ext.tech.common.missile_guidance'],
  ['重装甲突击学', '复合装甲材料学', '装甲载具工学', 'ext.tech.common.armored_vehicle'],
  ['高超声速打击工学', '高超声速滑翔武器理论'],
  ['空天飞行器工学', '空天往返载具工程学'],
  [
    '天基预警融合与轨道战略载荷工学',
    'ext.tech.aerospace.orbital_strategic_warning_payload',
    '天基战略预警融合工学',
    'sov.research.t3.space_based_strategic_warning_fusion',
    '轨道常规战略载荷工学',
    'sov.research.t3.orbital_conventional_strategic_payload',
    '轨道载荷身份与认证工学',
    'sov.research.t3.orbital_payload_identity_cert',
    '赤星天锤常规战略载荷',
    'sov.unit.orbital.red_star_hammer_conventional_payload',
  ],
  [
    '空间核电推进与轨道验证堆工学',
    'ext.tech.aerospace.space_nuclear_electric_tug',
    '空间核电源燃料认证学',
    'sov.research.t3.space_nuclear_fuel_cert',
    '空间核动力无核综合试验工学',
    'sov.research.t3.space_nuclear_nonnuclear_integrated_test',
    '千瓦级轨道验证堆工学',
    'sov.research.t3.kilowatt_orbital_test_reactor',
    '百千瓦级核电推进验证工学',
    'sov.research.t3.hundred_kw_nuclear_electric_propulsion_test',
    '兆瓦级核电推进拖船工学',
    'sov.research.t3.megawatt_nuclear_electric_tug',
  ],
  [
    '标准轨道货仓与可回收上面级工学',
    'ext.tech.aerospace.orbital_cargo_ejection_reusable',
    '标准轨道货仓与舱段编组工学',
    'sov.research.t3.standard_orbital_cargo_segment',
    '高速无机械转轨与倾斜出射工学',
    'sov.research.t3.high_speed_contactless_switch_ejection',
    '并联可回收二级与圆化工学',
    'sov.research.t3.parallel_reusable_stage_circularization',
  ],
  [
    '自主在轨装配与月壤原位冶金工学',
    'ext.tech.aerospace.lunar_isru_autonomous_assembly',
    '自主在轨装配工学·苏联实现',
    'sov.research.t3.autonomous_on_orbit_assembly_soviet',
    '月壤氧金属联产工学',
    'sov.research.t3.lunar_oxygen_metal_coproduction',
  ],
  [
    '重型机械标准化与分散储备动员学',
    'ext.tech.common.heavy_machinery_reserve_mobilization',
    '分散储备动员学',
    'sov.research.t1.dispersed_reserve_mobilization',
    '重型机械标准化学',
    'sov.research.t1.heavy_machinery_standardization',
  ],
  [
    '储备装备再生与梯次拆件维修工学',
    'ext.tech.common.equipment_regeneration_echelon_salvage',
    '储备装备再生学',
    'sov.research.t1.reserve_equipment_regeneration',
    '梯次维修与拆件工学',
    'sov.research.t1.echelon_maintenance_salvage',
  ],
  [
    '战时产线冗余与大规模工程扩建学',
    'ext.tech.common.wartime_production_redundancy_expansion',
    '战时产线冗余工学',
    'sov.research.t2.wartime_production_redundancy',
    '大规模工程扩建学',
    'sov.research.t2.large_scale_engineering_expansion',
  ],
  [
    '大口径火箭齐射与热压攻坚工学',
    'ext.tech.common.heavy_rocket_thermobaric_assault',
    '大口径火箭齐射学',
    'sov.research.t1.heavy_rocket_salvo',
    '热压攻坚工学',
    'sov.research.t1.thermobaric_assault',
  ],
  [
    '战役战术导弹营与高速突防工学',
    'ext.tech.common.operational_missile_battalion_penetration',
    '战役导弹营工学',
    'sov.research.t1.operational_missile_battalion',
    '高速战役突防工学',
    'sov.research.t2.high_speed_operational_penetration',
  ],
  [
    '数字炮兵火力网与远程制导火箭工学',
    'ext.tech.common.digital_artillery_guided_rocket',
    '数字炮兵火力网工学·苏联实现',
    'sov.research.t2.digital_artillery_network',
    '远程制导火箭工学',
    'sov.research.t2.long_range_guided_rocket',
  ],
  [
    '分层综合防空与火力单元自主交战学',
    'ext.tech.common.layered_iads_autonomous_engagement',
    '分层国土防空学说',
    'sov.research.t1.layered_homeland_air_defense',
    '火力单元自主交战规程',
    'sov.research.t1.autonomous_fire_unit_engagement',
  ],
  [
    '抗毁硬线备份通信与被动侦收伏击学',
    'ext.tech.common.hardline_comms_passive_ambush',
    '短波硬线备份通信学',
    'sov.research.t1.shortwave_hardline_backup_comms',
    '被动侦收伏击学',
    'sov.research.t1.passive_emission_ambush',
  ],
  [
    '野战机动防空指挥与单元自治工学',
    'ext.tech.common.mobile_iads_command_autonomy',
    '地面机动防空指挥工学',
    'sov.research.t2.mobile_air_defense_command',
    '防空火力单元自治工学',
    'sov.research.t2.air_defense_fire_unit_autonomy',
  ],
  [
    '多频无源预警与战区电子战编排学',
    'ext.tech.common.multiband_ew_passive_orchestration',
    '多频预警与被动侦收工学',
    'sov.research.t2.multiband_early_warning_passive',
    '战区电子战任务编排学',
    'sov.research.t2.theater_ew_orchestration',
  ],
  [
    '潜艇声学隐蔽与核潜艇现代化工学',
    'ext.tech.common.submarine_stealth_ssn_modernization',
    '潜艇隐蔽与静音保障学',
    'sov.research.t1.submarine_stealth_acoustic_support',
    '多用途攻击核潜艇现代化工学',
    'sov.research.t2.multipurpose_ssn_modernization',
    '海基战略核威慑现代化工学',
    'sov.research.t2.sea_based_nuclear_deterrence',
  ],
  [
    '舰载通用垂直发射与分布式海战指示学',
    'ext.tech.common.universal_vls_maritime_targeting',
    '分布式海上目标指示工学·苏联实现',
    'sov.research.t2.distributed_maritime_target_designation_soviet',
    '舰首巨型通用发射区工学',
    'sov.research.t2.bow_heavy_universal_launch',
    '开放式重型武器总线工学',
    'sov.research.t2.open_heavy_weapon_bus',
    '重弹齐射与热管理工学',
    'sov.research.t2.heavy_salvo_thermal_management',
  ],
  [
    '大型压水堆工程与非能动余热安全学',
    'ext.tech.common.large_pwr_decay_heat_safety',
    '大型压水堆工程学·苏联实现',
    'sov.research.t2.large_pwr_soviet_implementation',
    '核安全与余热排出工学',
    'sov.research.t2.nuclear_safety_decay_heat',
  ],
  [
    '快谱核能与同址闭式燃料循环工学',
    'ext.tech.common.fast_reactor_closed_fuel_cycle',
    'MOX燃料与快谱核能基础',
    'sov.research.t2.mox_fast_spectrum_foundations',
    '两组分快谱核能工学',
    'sov.research.t3.two_component_fast_spectrum',
    '放射化工热室与遥操作工学',
    'sov.research.t3.radiochemical_hot_cell_remote',
    '同址闭式燃料循环工学',
    'sov.research.t3.colocated_closed_fuel_cycle',
  ],
  [
    '大型磁约束聚变与氚自持控制工学',
    'ext.tech.common.magnetic_fusion_tritium_control',
    '大型聚变材料与氚循环工学',
    'sov.research.t3.large_fusion_material_tritium_cycle',
    '稳态燃烧等离子体控制工学',
    'sov.research.t3.steady_state_burning_plasma_control',
    '聚变堆远程维护与活化隔离工学',
    'sov.research.t3.fusion_remote_maintenance_activation_isolation',
  ],
  [
    '核指挥控制通信与战略连续性工程学',
    'ext.tech.common.nc3_thermonuclear_triad_continuity',
    '核材料衡算与战斗部寿命工学',
    'sov.research.t2.nuclear_material_accounting_life',
    '基础核指挥控制与通信学',
    'sov.research.t2.basic_nc3',
    '核力量正面与负控制工学',
    'sov.research.t2.nuclear_positive_negative_control',
    '现代三相热核战斗部工学',
    'sov.research.t2.modern_ternary_thermonuclear_warhead',
    '三位一体战备管理学',
    'sov.research.t2.triad_readiness_management',
    '地下国家连续性工程学',
    'sov.research.t3.underground_state_continuity',
    '异构核通信冗余工学',
    'sov.research.t3.heterogeneous_nuclear_comms_redundancy',
  ],
  [
    '天启系统集成与量产认证',
    'sov.research.t2.apocalypse_integration_cert',
    '双炮序列火控工学',
    'sov.research.t2.dual_gun_sequential_fcs',
    '重装甲正面防护极限工学',
    'sov.research.t2.heavy_frontal_protection',
  ],
  [
    '强磁场动态塑形工学',
    'sov.research.t2.dynamic_high_magnetic_field_shaping',
    '目标磁通耦合工学',
    'sov.research.t2.target_flux_coupling',
  ],
  [
    '重型电磁投射工学',
    'sov.research.t2.heavy_electromagnetic_projection',
    '约束电弧工学',
    'sov.research.t2.constrained_arc',
  ],
  [
    '铁幕区域赋盾工学',
    'sov.research.t2.iron_curtain_area_shield',
    '多目标等效质量测绘学',
    'sov.research.t2.multi_target_effective_mass_mapping',
  ],
  [
    '基洛夫系统集成认证',
    'sov.research.t2.kirov_integration_cert',
    '大型硬式飞艇结构工学',
    'sov.research.t2.large_rigid_airship_structure',
    '重型飞艇损管与气象保障学',
    'sov.research.t2.heavy_airship_damage_weather_support',
  ],
  [
    '磁暴网络协同工学',
    'sov.research.t3.tesla_network_coordination',
    '动态场拓扑工学',
    'sov.research.t3.dynamic_field_topology',
    '重装甲电磁毁伤试验',
    'sov.research.t3.heavy_armor_em_damage_test',
  ],
  [
    '战略设施广域幕工学',
    'sov.research.t3.strategic_facility_wide_area_curtain',
    '铁幕多节点相干投射工学',
    'sov.research.t3.iron_curtain_multinode_coherent',
    '铁幕编组随动控制工学',
    'sov.research.t3.iron_curtain_formation_following',
  ],
  [
    '赤环工业城系统工程',
    'sov.research.t3.red_ring_systems_engineering',
    '低真空超长环轨工程学',
    'sov.research.t3.ultralong_low_vacuum_ring',
    '多编组同步相位调度工学',
    'sov.research.t3.multiconsist_synchronous_phase_scheduling',
  ],
  [
    '相干定向能学派总论',
    'all.research.t1.coherent_directed_energy_doctrine',
    '高能激光与脉冲功率学',
    '紧凑固态激光与脉冲电容工学',
  ],
  [
    '光棱聚焦基础',
    'all.research.t1.prism_focusing_basics',
    '光谱折跃与光棱聚束学',
    '光棱聚焦与多级折射理论',
  ],
  [
    '超时空位移工学',
    'all.research.t1.chrono_displacement_eng',
    '超时空传送学',
  ],
  [
    '超时空场域放大工学',
    'all.research.t2.chrono_field_amplification',
    '超时空曲率场稳定学',
  ],
  [
    '进阶拟态集成工学',
    'all.research.t2.advanced_mirage_integration',
    '光学迷彩与热能武器学',
  ],
  [
    '拟态伪装与欺骗学派总论',
    'all.research.t1.mirage_camouflage_doctrine',
    '地面机动隐身学',
  ],
  [
    '气象战工学',
    'all.research.t2.weather_warfare_eng',
    '气象控制终端工程',
  ],
  [
    '多任务隐身航空体系总论',
    'all.research.t1.multirole_stealth_aviation_doctrine',
    '航空隐身与先进气动学',
    '涡扇推进工学',
  ],
  [
    '多任务隐身平台工学',
    'all.research.t2.multirole_stealth_platform_eng',
    '航空电子与机载火控学',
  ],
  [
    '欧洲联合防务军工标准学',
    'ext.tech.allied.euro_defense_pact',
    '欧洲防务一体化军工工学',
    '欧洲联合防务协议',
  ],
  [
    '环太平洋防务协议',
    'ext.tech.allied.pacific_rim_pact',
    '环太平洋防务合作协议',
    '环太平洋联合防务工学',
  ],
] as const;

/* ═══════════════ 苏联 T1→T2→T3 跨代门槛与建筑等价组（SOV-CODE-TIER-01 / PKG-A §3.1 A-3） ═══════════════ */

export const SOVIET_T2_LAB_NAMES = [
  '红星实验设计局综合体',
  '红星实验设计局',
  '苏联战斗实验室',
  '苏联作战实验室',
] as const;

export const SOVIET_T3_SCIENCE_CITY_NAMES = [
  '红星科学城',
  '国家战略工程综合体／红星科学城',
  '国家战略工程综合体/红星科学城',
  '国家战略工程综合体',
] as const;

export const SOVIET_T3_TICKET_TECHS = [
  '高能电容脉冲',
  '磁能反应堆',
  '纳米机器人控制芯片',
  '作战实验室联合数据链',
] as const;

export const SOVIET_T3_MANUFACTURING_LOOPS = ['重核聚变闭环', '超导磁流体闭环', '高能合成材料闭环'] as const;

export const SOVIET_T3_HEAVY_WEAPONS = [
  '天启坦克',
  '基洛夫空艇',
  'V4战术导弹发射车',
  '无畏级导弹舰',
  '米格重型截击机',
] as const;

export const YURI_T2_LAB_NAMES = [
  '基因测序与心灵谐振研究院',
  '尤里心灵研究实验室',
  '尤里作战实验室',
] as const;

export const YURI_T3_ACADEMY_NAMES = [
  '双螺旋生命工程与高维意识科学院',
  '双螺旋生命科学院',
] as const;

const LAB_EQUIVALENT_LIST = [
  '作战实验室',
  '战斗实验室',
  '战术科研实验室',
  '盟军战斗实验室',
  '盟军作战实验室',
  '苏联战斗实验室',
  '苏联作战实验室',
  '红星实验设计局综合体',
  '红星实验设计局',
  '红星科学城',
  '国家战略工程综合体',
  '国家战略工程综合体／红星科学城',
  '国家战略工程综合体/红星科学城',
  '尤里心灵研究实验室',
  '尤里作战实验室',
  '基因测序与心灵谐振研究院',
  '双螺旋生命工程与高维意识科学院',
  '双螺旋生命科学院',
] as const;

const RADAR_EQUIVALENT_LIST = [
  '雷达站',
  '作战情报中心',
  '区域防空与预警雷达站',
  '战略预警雷达站',
  '远程预警雷达站',
  '防空预警雷达站',
  '苏联先进态势与防空指挥中心',
  '苏联先进态势与防空指挥实现',
  '盟军先进态势与C4ISR指挥中心',
  '盟军先进态势与 C4ISR 指挥实现',
  '先进态势指挥中心',
  '综合感知塔',
  '空军指挥部',
  '盟军空军指挥部',
  '苏联空军指挥部',
  '苏联雷达站',
  '心灵感应器',
  '尤里深层神经态势与防空指挥中心',
] as const;

export const BUILDING_EQUIVALENTS: Readonly<Record<string, readonly string[]>> = {
  建造厂: [
    '建造厂',
    '建造厂核心',
    '盟军建造厂',
    '苏联建造厂',
    '尤里建造厂',
    '尤里建造厂核心',
  ],
  建造厂核心: [
    '建造厂核心',
    '建造厂',
    '盟军建造厂',
    '苏联建造厂',
    '尤里建造厂',
    '尤里建造厂核心',
  ],
  盟军建造厂: ['盟军建造厂', '建造厂', '建造厂核心'],
  苏联建造厂: ['苏联建造厂', '建造厂', '建造厂核心'],
  尤里建造厂: ['尤里建造厂', '尤里建造厂核心', '建造厂', '建造厂核心'],
  尤里建造厂核心: ['尤里建造厂核心', '尤里建造厂', '建造厂', '建造厂核心'],
  发电厂: [
    '发电厂',
    '盟军发电厂',
    '磁能反应堆',
    '磁能反应炉',
    '苏联磁能反应堆',
    '苏联磁能反应炉',
    '核子反应堆',
    '生化反应炉',
    '高能厌氧生化反应炉',
    '深层地热-嗜热菌电化学复合反应堆',
  ],
  盟军发电厂: ['盟军发电厂', '发电厂'],
  磁能反应炉: ['磁能反应炉', '苏联磁能反应炉', '磁能反应堆', '苏联磁能反应堆'],
  苏联磁能反应炉: ['苏联磁能反应炉', '磁能反应炉', '磁能反应堆', '苏联磁能反应堆'],
  磁能反应堆: ['磁能反应堆', '苏联磁能反应堆', '磁能反应炉', '苏联磁能反应炉'],
  苏联磁能反应堆: ['苏联磁能反应堆', '磁能反应堆', '磁能反应炉', '苏联磁能反应炉'],
  生化反应炉: ['生化反应炉', '高能厌氧生化反应炉', '深层地热-嗜热菌电化学复合反应堆', '发电厂', '尤里生化反应炉', '厌氧生化反应炉'],
  尤里生化反应炉: ['尤里生化反应炉', '高能厌氧生化反应炉', '生化反应炉', '发电厂'],
  厌氧生化反应炉: ['厌氧生化反应炉', '高能厌氧生化反应炉', '生化反应炉', '发电厂'],
  高能厌氧生化反应炉: ['高能厌氧生化反应炉', '生化反应炉', '尤里生化反应炉', '厌氧生化反应炉', '深层地热-嗜热菌电化学复合反应堆', '发电厂'],
  '深层地热-嗜热菌电化学复合反应堆': ['深层地热-嗜热菌电化学复合反应堆', '高能厌氧生化反应炉', '生化反应炉', '发电厂'],
  矿石精炼厂: ['矿石精炼厂', '盟军矿石精炼厂', '苏联矿石精炼厂', '奴隶矿场', '尤里奴隶矿场', '精炼厂', '矿场', '采矿场'],
  盟军矿石精炼厂: ['盟军矿石精炼厂', '矿石精炼厂', '精炼厂'],
  苏联矿石精炼厂: ['苏联矿石精炼厂', '矿石精炼厂', '精炼厂'],
  奴隶矿场: ['奴隶矿场', '尤里奴隶矿场', '矿石精炼厂', '精炼厂', '矿场'],
  尤里奴隶矿场: ['尤里奴隶矿场', '奴隶矿场', '矿石精炼厂', '精炼厂', '矿场'],
  精炼厂: ['精炼厂', '矿石精炼厂', '盟军矿石精炼厂', '苏联矿石精炼厂', '奴隶矿场', '尤里奴隶矿场'],
  矿场: ['矿场', '矿石精炼厂', '盟军矿石精炼厂', '苏联矿石精炼厂', '奴隶矿场', '尤里奴隶矿场'],
  采矿场: ['采矿场', '矿石精炼厂', '盟军矿石精炼厂', '苏联矿石精炼厂', '奴隶矿场', '尤里奴隶矿场'],
  兵营: ['兵营', '盟军兵营', '苏联兵营', '尤里兵营', '尤里克隆与新兵训导营', '尤里训导营', '尤里新兵训导营'],
  盟军兵营: ['盟军兵营', '兵营'],
  苏联兵营: ['苏联兵营', '兵营'],
  尤里兵营: ['尤里兵营', '尤里克隆与新兵训导营', '尤里训导营', '兵营'],
  尤里训导营: ['尤里训导营', '尤里克隆与新兵训导营', '尤里兵营', '兵营'],
  尤里新兵训导营: ['尤里新兵训导营', '尤里克隆与新兵训导营', '尤里兵营', '兵营'],
  尤里克隆与新兵训导营: ['尤里克隆与新兵训导营', '尤里兵营', '尤里训导营', '兵营'],
  个人装备制造所: ['个人装备制造所', '装备制造所', '盟军个人装备制造所', '苏联个人装备制造所'],
  装备制造所: ['装备制造所', '个人装备制造所'],
  战车工厂: ['战车工厂', '盟军战车工厂', '苏联战车工厂', '尤里战车工厂', '尤里战车厂', '尤里战车总装厂', '尤里生物机电战车总装厂'],
  盟军战车工厂: ['盟军战车工厂', '战车工厂'],
  苏联战车工厂: ['苏联战车工厂', '战车工厂'],
  尤里战车工厂: ['尤里战车工厂', '尤里生物机电战车总装厂', '尤里战车厂', '战车工厂'],
  尤里战车厂: ['尤里战车厂', '尤里生物机电战车总装厂', '尤里战车工厂', '战车工厂'],
  尤里战车总装厂: ['尤里战车总装厂', '尤里生物机电战车总装厂', '尤里战车工厂', '战车工厂'],
  尤里生物机电战车总装厂: ['尤里生物机电战车总装厂', '尤里战车工厂', '尤里战车厂', '战车工厂'],
  空军指挥部: ['空军指挥部', '空指部', '机场', '盟军空军指挥部', '苏联空军指挥部', '尤里空军指挥部', '神经航空引导盘', '尤里航空引导盘', '雷达站'],
  空指部: ['空指部', '空军指挥部', '机场', '盟军空军指挥部', '苏联空军指挥部', '神经航空引导盘', '雷达站'],
  机场: ['机场', '空军指挥部', '空指部', '盟军空军指挥部', '苏联空军指挥部', '神经航空引导盘'],
  盟军空军指挥部: ['盟军空军指挥部', '空军指挥部', '空指部', '机场'],
  苏联空军指挥部: ['苏联空军指挥部', '空军指挥部', '空指部', '机场'],
  尤里空军指挥部: ['尤里空军指挥部', '神经航空引导盘', '空军指挥部', '空指部'],
  尤里航空引导盘: ['尤里航空引导盘', '神经航空引导盘', '空军指挥部'],
  环形垂直起降母巢: ['环形垂直起降母巢', '神经航空引导盘', '空军指挥部'],
  神经航空引导盘: ['神经航空引导盘', '尤里航空引导盘', '空军指挥部', '空指部', '机场'],
  海军造船厂: ['海军造船厂', '造船厂', '船厂', '盟军海军造船厂', '苏联海军造船厂', '盟军造船厂', '苏联造船厂', '尤里船厂', '尤里造船厂', '尤里半潜与仿生造船厂', '潜艇船坞'],
  造船厂: ['造船厂', '海军造船厂', '船厂', '盟军海军造船厂', '苏联海军造船厂', '尤里半潜与仿生造船厂'],
  船厂: ['船厂', '海军造船厂', '盟军海军造船厂', '苏联海军造船厂', '尤里船厂', '尤里半潜与仿生造船厂', '潜艇船坞'],
  盟军海军造船厂: ['盟军海军造船厂', '盟军造船厂', '海军造船厂', '船厂'],
  盟军造船厂: ['盟军造船厂', '盟军海军造船厂', '海军造船厂', '船厂'],
  苏联海军造船厂: ['苏联海军造船厂', '苏联造船厂', '海军造船厂', '船厂'],
  苏联造船厂: ['苏联造船厂', '苏联海军造船厂', '海军造船厂', '船厂'],
  尤里船厂: ['尤里船厂', '尤里造船厂', '尤里半潜与仿生造船厂', '海军造船厂', '船厂'],
  尤里造船厂: ['尤里造船厂', '尤里半潜与仿生造船厂', '尤里船厂', '海军造船厂'],
  尤里仿生造船厂: ['尤里仿生造船厂', '尤里半潜与仿生造船厂', '海军造船厂'],
  尤里半潜与仿生造船厂: ['尤里半潜与仿生造船厂', '尤里船厂', '尤里造船厂', '海军造船厂', '船厂', '潜艇船坞'],
  作战实验室: LAB_EQUIVALENT_LIST,
  战斗实验室: LAB_EQUIVALENT_LIST,
  战术科研实验室: LAB_EQUIVALENT_LIST,
  盟军作战实验室: ['盟军作战实验室', '盟军战斗实验室', '战斗实验室', '作战实验室'],
  盟军战斗实验室: ['盟军战斗实验室', '盟军作战实验室', '战斗实验室', '作战实验室'],
  苏联作战实验室: ['苏联作战实验室', '苏联战斗实验室', '红星实验设计局综合体', '红星实验设计局', '战斗实验室', '作战实验室'],
  苏联战斗实验室: ['苏联战斗实验室', '苏联作战实验室', '红星实验设计局综合体', '红星实验设计局', '战斗实验室', '作战实验室'],
  红星实验设计局: ['红星实验设计局', '红星实验设计局综合体', '苏联战斗实验室', '苏联作战实验室', '战斗实验室'],
  红星设计局: ['红星设计局', '红星实验设计局综合体', '红星实验设计局', '苏联战斗实验室'],
  红星实验设计局综合体: ['红星实验设计局综合体', '红星实验设计局', '苏联战斗实验室', '苏联作战实验室', '战斗实验室', '作战实验室'],
  尤里心灵研究实验室: ['尤里心灵研究实验室', '尤里作战实验室', '基因测序与心灵谐振研究院', '双螺旋生命工程与高维意识科学院', '双螺旋生命科学院', '战斗实验室', '作战实验室'],
  尤里作战实验室: ['尤里作战实验室', '尤里心灵研究实验室', '基因测序与心灵谐振研究院', '双螺旋生命工程与高维意识科学院', '双螺旋生命科学院', '战斗实验室', '作战实验室'],
  尤里战斗实验室: ['尤里战斗实验室', '基因测序与心灵谐振研究院', '尤里作战实验室', '战斗实验室'],
  基因心灵研究院: ['基因心灵研究院', '基因测序与心灵谐振研究院'],
  基因测序与心灵谐振研究院: ['基因测序与心灵谐振研究院', '尤里心灵研究实验室', '尤里作战实验室', '双螺旋生命工程与高维意识科学院', '双螺旋生命科学院', '战斗实验室', '作战实验室'],
  双螺旋生命工程与高维意识科学院: ['双螺旋生命工程与高维意识科学院', '双螺旋生命科学院'],
  双螺旋生命科学院: ['双螺旋生命科学院', '双螺旋生命工程与高维意识科学院'],
  高维意识科学院: ['高维意识科学院', '双螺旋生命工程与高维意识科学院'],
  雷达站: RADAR_EQUIVALENT_LIST,
  作战情报中心: RADAR_EQUIVALENT_LIST,
  区域防空与预警雷达站: RADAR_EQUIVALENT_LIST,
  心灵感应器: ['心灵感应器', '尤里心灵感应器', '尤里深层神经态势与防空指挥中心', '雷达站', '作战情报中心'],
  尤里心灵感应器: ['尤里心灵感应器', '心灵感应器', '雷达站'],
  尤里深层神经态势与防空指挥中心: ['尤里深层神经态势与防空指挥中心', '心灵感应器', '雷达站', '作战情报中心'],
  核弹发射井: ['核弹发射井', '核导弹工程与地下发射群', '战术核导弹发射井'],
  战术核导弹发射井: ['战术核导弹发射井', '核导弹工程与地下发射群', '核弹发射井'],
  核导弹工程与地下发射群: ['核导弹工程与地下发射群', '核弹发射井', '战术核导弹发射井'],
  工业工厂: ['工业工厂', '苏维埃工业工厂'],
  苏维埃工业工厂: ['苏维埃工业工厂', '工业工厂'],
  维修工厂: ['维修工厂', '战地维修所', '盟军维修工厂', '苏联维修工厂'],
  盟军维修工厂: ['盟军维修工厂', '战地维修所', '维修工厂'],
  苏联维修工厂: ['苏联维修工厂', '战地维修所', '维修工厂'],
  战地维修所: ['战地维修所', '维修工厂', '盟军维修工厂', '苏联维修工厂'],
  克隆缸: ['克隆缸', '生物克隆与素体培育中心', '尤里克隆缸'],
  尤里克隆缸: ['尤里克隆缸', '生物克隆与素体培育中心', '克隆缸'],
  生物克隆与素体培育中心: ['生物克隆与素体培育中心', '克隆缸', '尤里克隆缸'],
  部队回收厂: ['部队回收厂', '心灵重塑与认知感化院', '阿尔法脑波协同广播与多巴胺节律中枢'],
  复制中心: ['复制中心', '国家总动员兵工城', '国家总动员兵工城实现'],
  围墙: ['围墙', '盟军围墙', '尤里复合生化护墙', '反载具障碍带'],
  苏联围墙: ['苏联围墙', '反载具障碍带', '盟军围墙'],
  尤里围墙: ['尤里围墙', '尤里复合生化护墙', '生化护墙'],
  尤里生化护墙: ['尤里生化护墙', '尤里复合生化护墙', '尤里围墙'],
  生化护墙: ['生化护墙', '尤里复合生化护墙', '尤里围墙'],
  机枪碉堡: ['机枪碉堡', '盟军碉堡', '驻军碉堡', '苏联战斗碉堡'],
  碉堡: ['碉堡', '盟军碉堡', '驻军碉堡', '苏联战斗碉堡', '并网式神经-液冷重装碉堡'],
  战斗碉堡: ['战斗碉堡', '苏联战斗碉堡', '驻军碉堡'],
  坦克碉堡: ['坦克碉堡', '并网式神经-液冷重装碉堡', '驻军碉堡'],
  神经重装碉堡: ['神经重装碉堡', '并网式神经-液冷重装碉堡'],
  哨戒炮: ['哨戒炮', '苏联哨戒炮', '哨戒炮位', '遥控武器站塔'],
  高射炮: ['高射炮', '苏联高射炮', '近程防空阵地', '中程防空阵地'],
  高射炮防空阵地: ['高射炮防空阵地', '苏联高射炮', '近程防空阵地', '中程防空阵地'],
  爱国者防空导弹阵地: ['爱国者防空导弹阵地', '爱国者防空阵地'],
  爱国者导弹: ['爱国者导弹', '爱国者防空阵地'],
  盖特机炮: ['盖特机炮', '盖特机炮塔'],
  尤里盖特炮: ['尤里盖特炮', '盖特机炮塔'],
  精神控制塔: ['精神控制塔', '心灵控制塔', '尤里心控塔'],
  尤里心控塔: ['尤里心控塔', '心灵控制塔', '精神控制塔'],
  超时空传送仪: ['超时空传送仪', '超时空传送仪（初级）', '超时空传送阵列'],
  天气控制仪: ['天气控制仪', '天气控制仪（初级）', '天气控制仪增强设施', '天气控制机'],
  天气控制机: ['天气控制机', '天气控制仪（初级）', '天气控制仪增强设施', '天气控制仪'],
  基因突变器: ['基因突变器', '基因崩解与神经凋亡共振阵列', '尤里基因突变器'],
  心灵控制器: ['心灵控制器', '心灵支配仪'],
  母脑湿件培育与特装总装跨: ['母脑湿件培育与特装总装跨', '母脑特装总装跨', '母脑总装跨', '尤里脑车专库', '特装总装跨'],
  母脑特装总装跨: ['母脑特装总装跨', '母脑湿件培育与特装总装跨', '母脑总装跨', '尤里脑车专库', '特装总装跨'],
  母脑总装跨: ['母脑总装跨', '母脑湿件培育与特装总装跨', '母脑特装总装跨'],
  环形磁流体飞碟整备与微波充能巢: ['环形磁流体飞碟整备与微波充能巢', '飞碟整备充能巢', '飞碟整备巢', '镭射幽浮机库', '飞碟机巢'],
  飞碟整备充能巢: ['飞碟整备充能巢', '环形磁流体飞碟整备与微波充能巢', '飞碟整备巢', '镭射幽浮机库', '飞碟机巢'],
  飞碟整备巢: ['飞碟整备巢', '环形磁流体飞碟整备与微波充能巢', '飞碟整备充能巢'],
  半潜消磁船坞与龟背重弹装填栈桥: ['半潜消磁船坞与龟背重弹装填栈桥', '龟背重弹装填栈桥', '龟背重弹栈桥', '雷鸣潜艇专库', '尤里消磁船坞'],
  龟背重弹装填栈桥: ['龟背重弹装填栈桥', '半潜消磁船坞与龟背重弹装填栈桥', '龟背重弹栈桥', '雷鸣潜艇专库'],
  龟背重弹栈桥: ['龟背重弹栈桥', '半潜消磁船坞与龟背重弹装填栈桥', '龟背重弹装填栈桥'],
  战区超导脉冲储能场: ['战区超导脉冲储能场', '战区超导脉冲电网中枢'],
  战区超导脉冲电网中枢: ['战区超导脉冲电网中枢', '战区超导脉冲储能场'],
  月壤原位能源开采设施: ['月壤原位能源开采设施', '月面采矿加工站'],
  月面采矿加工站: ['月面采矿加工站', '月壤原位能源开采设施'],
  月面基地基础设施: ['月面基地基础设施', '月面有人前哨站'],
  月面有人前哨站: ['月面有人前哨站', '月面基地基础设施'],
  深井泵站: ['深井泵站', '深井泵站与水文净化设施'],
  深井泵站与水文净化设施: ['深井泵站与水文净化设施', '深井泵站'],
  高净空飞艇总装厂房: ['高净空飞艇总装厂房', '基洛夫巨型收纳与保障库'],
  基洛夫巨型收纳与保障库: ['基洛夫巨型收纳与保障库', '高净空飞艇总装厂房'],
};

export const ROOT_CONYARD_BUILDINGS: ReadonlySet<string> = new Set([
  '建造厂',
  '建造厂核心',
  '盟军建造厂',
  '苏联建造厂',
  '尤里建造厂',
  '尤里建造厂核心',
  '前沿工地',
  '作战前哨站',
]);

const EQUIVALENT_BUILDING_GROUPS: readonly (readonly string[])[] = [
  SOVIET_T2_LAB_NAMES,
  SOVIET_T3_SCIENCE_CITY_NAMES,
  YURI_T2_LAB_NAMES,
  YURI_T3_ACADEMY_NAMES,
  ['核弹发射井', '核导弹工程与地下发射群'],
  ['战区超导脉冲储能场', '战区超导脉冲电网中枢'],
  ['月壤原位能源开采设施', '月面采矿加工站'],
  ['月面基地基础设施', '月面有人前哨站'],
  ['深井泵站', '深井泵站与水文净化设施'],
  ['高净空飞艇总装厂房', '基洛夫巨型收纳与保障库'],
];

/**
 * FD-22 高阶建筑与原位升级后正式建筑名对前代母体的【单向向下兼容表】
 * 铁律：只允许 key（低阶/前代母体）被 value（高阶/升级后建筑）满足，严禁反向满足！
 */
export const UPGRADE_DESCENDANTS_MAP: Readonly<Record<string, readonly string[]>> = {
  简易船坞: ['海军造船厂', '盟军海军造船厂', '苏联海军造船厂', '盟军海军船坞', '苏联海军船坞', '扩大版造船厂', '超级造船综合体'],
  海军造船厂: ['扩大版造船厂', '超级造船综合体'],
  盟军海军造船厂: ['扩大版造船厂', '超级造船综合体'],
  苏联海军造船厂: ['扩大版造船厂', '超级造船综合体'],
  盟军海军船坞: ['扩大版造船厂', '超级造船综合体'],
  苏联海军船坞: ['扩大版造船厂', '超级造船综合体'],
  扩大版造船厂: ['超级造船综合体'],
  战车工厂: ['扩大版自动化战车工厂', '全自动军工综合体', '巨型联合兵工厂', '苏维埃工业工厂', '国家总动员兵工城', '国家总动员兵工城实现'],
  盟军战车工厂: ['扩大版自动化战车工厂', '全自动军工综合体', '巨型联合兵工厂'],
  苏联战车工厂: ['扩大版自动化战车工厂', '全自动军工综合体', '巨型联合兵工厂', '苏维埃工业工厂', '国家总动员兵工城', '国家总动员兵工城实现'],
  扩大版自动化战车工厂: ['全自动军工综合体', '巨型联合兵工厂', '国家总动员兵工城', '国家总动员兵工城实现'],
  苏维埃工业工厂: ['全自动军工综合体', '巨型联合兵工厂', '国家总动员兵工城', '国家总动员兵工城实现'],
  全自动军工综合体: ['巨型联合兵工厂'],
  空军指挥部: ['空天飞机维护综合体'],
  盟军空军指挥部: ['空天飞机维护综合体'],
  苏联空军指挥部: ['空天飞机维护综合体'],
  苏联空军基地: ['空天飞机维护综合体'],
  超算中心: ['量子超算中心'],
  高阶医疗中心: ['纳米躯体再造舱'],
  矿石精炼厂: ['巨型自动化矿业综合体'],
  盟军矿石精炼厂: ['巨型自动化矿业综合体'],
  苏联矿石精炼厂: ['巨型自动化矿业综合体'],
  航天发射中心: ['巨型航天发射港', '八百公里同步环轨重载投射与工业综合体'],
  拜科努尔式重型航天发射综合体: ['巨型航天发射港', '八百公里同步环轨重载投射与工业综合体'],
  盟军天基轨道上行中心: ['巨型航天发射港', '八百公里同步环轨重载投射与工业综合体'],
  巨型航天发射港: ['八百公里同步环轨重载投射与工业综合体'],
  受控核聚变实验堆: ['聚变发电阵列'],
  强化地下掩蔽所: ['深层地下综合体', '国家连续性深层地下要塞', '地下国家连续性升级'],
  深层地下综合体: ['国家连续性深层地下要塞', '地下国家连续性升级'],
  地月转运站: ['月球空间站'],
  月面有人前哨站: ['月面有人基地'],
  月面基地基础设施: ['月面有人基地'],
  光棱塔: ['先进光棱塔', '先进光棱塔升级'],
  爱国者防空阵地: ['爱国者PAC-3增强防空阵地', '爱国者阵地增强改装'],
  爱国者导弹阵地: ['爱国者PAC-3增强防空阵地', '爱国者阵地增强改装'],
  裂缝产生器: ['全谱电磁隐身裂缝产生器', '全谱电磁与微波隐身屏蔽系统'],
  'THAAD 末段高空拦截阵地': ['THAAD-ER增程高空拦截阵地', 'THAAD增程机动拦截发射单元'],
  'GPI 滑翔段拦截系统': ['GPI超高空火控拦截系统', 'GPI超高空火控引导站'],
  大型裂变发电站: ['快堆闭式循环核电站', '快堆—闭式燃料循环升级', '战区超导脉冲电网中枢'],
  超级磁能反应炉: ['战区超导脉冲电网中枢'],
  铁幕装置: ['铁幕多节点偏折网络', '铁幕多节点网络升级'],
  地下高速管道枢纽: ['地下重载军运管道枢纽', '地下重载军运实现'],
  超时空传送仪: ['超时空传送阵列'],
  天气控制仪: ['天气控制仪增强设施'],
  轨道武器平台: ['天基超级光棱炮'],
  电子战干扰站: ['全频谱电子战干扰站'],
};

export const INACTIVE_SOVIET_BUILDING_STATES: ReadonlySet<string> = new Set([
  '建造中',
  '损毁',
  '受损',
  '停机',
  '离线',
  '断电',
  '瘫痪',
  '摧毁',
]);

export function toTrimmedStringSet(source?: Iterable<unknown>): Set<string> {
  const result = new Set<string>();
  if (!source) return result;
  for (const item of source) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed) result.add(trimmed);
    } else if (isRecord(item) && typeof item.name === 'string') {
      const trimmed = item.name.trim();
      const rawState = typeof item.state === 'string' ? item.state.trim() : '';
      if (trimmed && (!rawState || !INACTIVE_SOVIET_BUILDING_STATES.has(rawState))) {
        result.add(trimmed);
      }
    }
  }
  return result;
}

export function stripFactionBuildingPrefix(name: string): string {
  const trimmed = (name || '').trim();
  const m = /^(?:盟军|苏联|苏军|苏维埃|尤里|通用)\s*(.+)$/.exec(trimmed);
  const stripped = m?.[1]?.trim();
  return stripped && stripped.length >= 2 ? stripped : trimmed;
}

function normBuildingKey(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase();
}

/**
 * BUG-LIVE-22b 单一事实源：在 catalog.buildings 中按精确名称、别名、BUILDING_EQUIVALENTS 及剥离阵营前缀匹配建筑定义
 */
export function findCatalogBuildingDef<T extends { name: string; aliases?: readonly string[] }>(
  buildings: readonly T[] | undefined | null,
  rawName: string,
): T | undefined {
  if (!buildings || buildings.length === 0) return undefined;
  const trimmed = rawName.trim();
  if (!trimmed) return undefined;
  const targetNorm = normBuildingKey(trimmed);

  // 1. 精确名称或 aliases 命中
  const exact = buildings.find(
    b =>
      b.name.trim() === trimmed ||
      normBuildingKey(b.name) === targetNorm ||
      (Array.isArray(b.aliases) && b.aliases.some(a => normBuildingKey(String(a)) === targetNorm)),
  );
  if (exact) return exact;

  // 2. BUILDING_EQUIVALENTS 命中（如 苏联建造厂 -> 建造厂 -> 建造厂核心，苏联矿石精炼厂 -> 矿石精炼厂）
  const stripped = stripFactionBuildingPrefix(trimmed);
  const eqCandidates = [
    ...(BUILDING_EQUIVALENTS[trimmed] ?? []),
    ...(stripped && stripped !== trimmed ? [stripped, ...(BUILDING_EQUIVALENTS[stripped] ?? [])] : []),
  ];
  for (const cand of eqCandidates) {
    const candNorm = normBuildingKey(cand);
    const hit = buildings.find(
      b =>
        b.name.trim() === cand ||
        normBuildingKey(b.name) === candNorm ||
        (Array.isArray(b.aliases) && b.aliases.some(a => normBuildingKey(String(a)) === candNorm)),
    );
    if (hit) return hit;
  }

  // 3. 剥离阵营前缀后双向比对（如 catalog 中为 苏联磁能反应炉 而输入为 磁能反应炉，或反之）
  if (stripped.length >= 2) {
    const strippedNorm = normBuildingKey(stripped);
    const prefixHit = buildings.find(b => {
      const bStripped = stripFactionBuildingPrefix(b.name);
      return bStripped.length >= 2 && normBuildingKey(bStripped) === strippedNorm;
    });
    if (prefixHit) return prefixHit;
  }

  return undefined;
}

export function setHasEquivalentBuilding(buildingSet: ReadonlySet<string>, targetName: string): boolean {
  if (buildingSet.has(targetName)) return true;
  const trimmed = targetName.trim();
  if (!trimmed) return false;
  if (buildingSet.has(trimmed)) return true;
  if (trimmed.includes('+') || trimmed.includes('＋')) {
    const parts = trimmed
      .split(/[+＋]/)
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      return parts.every(part => setHasEquivalentBuilding(buildingSet, part));
    }
  }
  const stripped = stripFactionBuildingPrefix(trimmed);
  if (stripped && stripped !== trimmed && buildingSet.has(stripped)) {
    return true;
  }
  const equivalents = BUILDING_EQUIVALENTS[trimmed] ?? (stripped ? BUILDING_EQUIVALENTS[stripped] : undefined);
  if (equivalents && equivalents.some(alias => buildingSet.has(alias))) {
    return true;
  }
  const descendants = UPGRADE_DESCENDANTS_MAP[trimmed] ?? (stripped ? UPGRADE_DESCENDANTS_MAP[stripped] : undefined);
  if (descendants && descendants.some(desc => buildingSet.has(desc))) {
    return true;
  }
  if (equivalents) {
    for (const alias of equivalents) {
      const aliasDesc = UPGRADE_DESCENDANTS_MAP[alias];
      if (aliasDesc && aliasDesc.some(desc => buildingSet.has(desc))) return true;
    }
  }
  for (const group of EQUIVALENT_BUILDING_GROUPS) {
    if ((group as readonly string[]).includes(trimmed) || (stripped && (group as readonly string[]).includes(stripped))) {
      if (group.some(alias => buildingSet.has(alias))) return true;
    }
  }
  if (stripped.length >= 2) {
    for (const b of buildingSet) {
      if (stripFactionBuildingPrefix(b) === stripped) return true;
    }
  }
  return false;
}

/* ═══════════════ 单位状态剥离与同义词等价组（PKG-A · §3.1 A-4 & FD-22 现代化型号同族等价） ═══════════════ */

export const UNIT_EQUIVALENT_GROUPS: readonly (readonly string[])[] = [
  ['F-16C战隼', 'F-16C战隼多用途战斗机', 'F-16V战隼多用途战斗机', '战隼战斗机', '战隼战机', 'ally.unit.air.f16c_fighting_falcon'],
  ['轻型近海战斗舰', 'LCS-1自由级近海战斗舰', '哨兵级近海巡逻护卫舰', '20380型轻型护卫舰', '20385型轻型护卫舰', '星座级隐身导弹护卫舰', '北约新一代隐身导弹护卫舰（军刀/朱姆沃尔特谱系）', '军刀级隐身导弹护卫舰', '20380型“守护级”轻型护卫舰', '20385型“轰鸣级”隐身轻型护卫舰'],
  ['赤星天锤常规战略载荷', 'sov.unit.orbital.red_star_hammer_conventional_payload'],
  // ── FD-22 盟军现代化改型及经典简称同族双向等价 ──
  ['M1A1灰熊主战坦克', 'M1A2 SEPv3混动灰熊主战坦克', '灰熊坦克', '灰熊主战坦克', '盟军灰熊坦克'],
  ['M2A3布拉德利步兵战车', 'M2A4布拉德利步兵战车', '布拉德利步兵战车', '多功能步兵车', 'IFV'],
  ['M3布拉德利CFV装甲侦察车', 'M3A4布拉德利CFV装甲侦察车', '布拉德利侦察车'],
  ['M109A6帕拉丁自行榴弹炮', 'M109A6帕拉丁自行火炮', 'M109A7帕拉丁自行榴弹炮', '帕拉丁自行榴弹炮'],
  ['M1130斯特赖克指挥车', 'M1130A1斯特赖克数字指挥车', '斯特赖克指挥车'],
  ['M142海马斯多管火箭车', 'M142海马斯增程多管火箭车', '海马斯多管火箭车', '海马斯火箭炮'],
  ['机动雷达车', '有源相控阵机动雷达车', '全频段机动裂缝遮蔽车', '机动裂缝产生车', '移动裂缝产生器', '机动裂缝遮蔽车', 'ally.unit.support.mobile_gap_generator', '战术人工气象调控车', '战术气象车', 'ally.unit.support.tactical_weather_vehicle', '野战移动式核能供电保障车', '核能供能车', 'ally.unit.support.mobile_nuclear_power_vehicle', '超时空轻型战术突击坦克', '超时空轻型坦克', 'ally.unit.armor.chrono_light_tank'],
  ['UH-60M黑鹰通用直升机', 'UH-60V黑鹰数字化通用直升机', '黑鹰通用直升机', '黑鹰直升机'],
  ['MH-6M小鸟轻型直升机', '小鸟轻型直升机', '小鸟直升机'],
  ['F-15E攻击鹰制空战斗轰炸机', 'F-15EX先进攻击鹰战斗轰炸机', '攻击鹰战斗轰炸机'],
  ['阵风多用途战斗机', '阵风F4多用途战斗机', '阵风战斗机'],
  ['AH-64D阿帕奇长弓武装直升机', 'AH-64E阿帕奇卫士武装直升机', '阿帕奇武装直升机', '阿帕奇直升机', '夜鹰直升机'],
  ['MQ-9B死神战略侦察打击无人机', 'MQ-9B死神协同蜂群指挥无人机', '死神无人机'],
  ['XQ-58A女武神无人协同战斗飞行器', 'XQ-58B女武神忠诚僚机', '女武神无人机'],
  ['CH-47F支奴干重型战术运输直升机', 'CH-47F Block II支奴干重型运输直升机', '支奴干运输直升机'],
  ['B-52H同温层堡垒战略轰炸机', 'B-52J同温层堡垒战略轰炸机', '同温层堡垒战略轰炸机'],
  ['DDG-51阿利·伯克级宙斯盾驱逐舰', 'DDG-51阿利·伯克级驱逐舰(SPY-6现代改)', '阿利·伯克级驱逐舰', '盟军驱逐舰'],
  ['CG-47提康德罗加级导弹巡洋舰', 'CG-47提康德罗加级巡洋舰(宙斯盾基线9)', '提康德罗加级巡洋舰', '神盾巡洋舰'],
  ['SSN-688洛杉矶级核动力攻击潜艇', 'SSN-688I改进型洛杉矶级攻击核潜艇', '洛杉矶级攻击核潜艇'],
  ['LHD-1黄蜂级两栖攻击舰', 'LHD-1黄蜂级闪电航母(F-35B适配型)', '黄蜂级两栖攻击舰'],
  ['CV-63小鹰级常规动力航空母舰', 'CV-63小鹰级航空母舰(电弹现代改)', '小鹰级航空母舰', '航空母舰'],
  ['CVN-68尼米兹级核动力航空母舰', 'CVN-68尼米兹级核动力航母(电弹现代改)', '尼米兹级核动力航空母舰'],
  ['Black Eagle黑鹰高机动重装前掠翼突击机', '黑鹰战机', '黑鹰攻击机'],
  ['超声速战略轰炸机（世纪轰炸机）', '世纪轰炸机'],
  ['光棱主战坦克', '光棱坦克', '盟军光棱坦克'],
  ['幻影主战坦克', '幻影坦克', '盟军幻影坦克'],
  ['超时空采矿车', '盟军采矿车', '武装采矿车', '苏联采矿车', '重装武装采矿车', '采矿车', '矿车'],
  ['盟军反装甲重装步兵', '重装大兵', '标枪重装步兵'],
  ['盟军战术军犬', '盟军军犬', '警犬', '苏联军犬', '战犬'],
  ['盟军精锐狙击手', '盟军狙击手'],
  // ── FD-22 苏联现代化改型及经典简称同族双向等价 ──
  ['犀牛主战坦克族', '犀牛主战坦克·接触-5现代改', '犀牛坦克', '犀牛主战坦克', '苏联犀牛坦克'],
  ['天启重型坦克', '天启决战型重型坦克', '天启坦克', '苏联天启坦克'],
  ['基洛夫空中无人机武库母舰', '基洛夫重装蜂群武库母舰', '基洛夫空艇', '基洛夫飞艇'],
  ['无畏级重型导弹支援舰', '无畏级重型通用垂发支援舰', '无畏级导弹舰'],
  ['基洛夫级核动力导弹巡洋舰', '11442M基洛夫级核动力导弹巡洋舰', '基洛夫级巡洋舰'],
  ['2S3／2S19 Msta自行榴弹炮族', '2S19M2「姆斯塔-SM2」数字化自行榴弹炮', '姆斯塔自行榴弹炮'],
  ['T-72B3M主战坦克', 'T-72B3M重装反应装甲型主战坦克'],
  ['T-90M主战坦克', 'T-90M2「突破-3」决战主战坦克'],
  ['T-80BVM主战坦克', 'T-80BVM改进型寒区突击主战坦克'],
  ['寒区突击坦克族', '寒区突击坦克族(T-80BVM现代改)'],
  ['履带步兵战车族', 'BMP-3M「德拉贡」数字化步兵战车族', 'BMP步兵战车'],
  ['BTR-EW战术网电装甲车', 'BTR-EW「火花-M」全谱网电装甲车', '野战超导磁能脉冲供能车', '超导脉冲供能车', '苏军超导脉冲供能车', '野战磁能脉冲充电车', 'sov.unit.support.superconducting_pulse_power_vehicle', '机动铁幕伴随投射车', '机动铁幕车', '车载铁幕投射车', 'sov.unit.support.mobile_iron_curtain_emitter', '地锚式磁锁与电磁奇点压制车', '磁锁奇点压制车', '电磁奇点压制车', '地锚式磁锁车', 'sov.unit.support.magnetic_singularity_suppressor'],
  ['TOS热压攻坚族（TOS-1A／TOS-2）', 'TOS-1AM重装甲热压攻坚族', 'TOS喷火坦克'],
  ['Su-30SM多任务战斗机', 'Su-30SM2多任务战斗机'],
  ['Su-34防区外打击战斗轰炸机', 'Su-34M防区外打击战斗轰炸机'],
  ['MiG-31BM高速截击机', 'MiG-31BSM数字化高速截击机', '米格重型截击机', '米格战机'],
  ['旋翼机族', 'Ka-52M／Mi-28NM光电增强旋翼机族', '武装直升机'],
  ['1155M型反潜驱逐舰', '1155M「沙波什尼科夫元帅」级多用途驱逐舰'],
  ['971型攻击核潜艇', '971M「猎豹」级静音多用途攻击核潜艇', '台风级攻击潜艇'],
  ['战区机动与末端伴随防空族', '铠甲-SM／道尔-M2U自主伴随防空族', '履带防空车', '防空履带车'],
  ['轮式装甲输送车族', 'BTR-82AT数字化轮式步兵战车族', 'BTR装甲车'],
  ['Tornado-G火箭炮', 'Tornado-G自动火控模块化火箭炮'],
  ['恐怖机器人·拆解爆破型', '恐怖机器人·拆解/磁锁双模战备型', '恐怖机器人'],
  ['877型常规潜艇', '636.3「华沙女人」级改进型静音潜艇'],
  ['无人航空体系族', '海雕-30M数字火控校射无人机体系族'],
  ['动员兵', '苏联动员兵', '征召兵'],
  ['磁暴步兵', '苏联磁暴步兵'],
  ['重装武装采矿车', '武装采矿车', '苏联采矿车'],
  ['V4战术导弹发射车', 'V3火箭发射车', 'V4火箭发射车'],
  // ── 尤里及通用常见简称同族双向等价 ──
  ['尤里新兵', '新兵', '电浆护腕新兵', '尤里步兵'],
  ['电浆磁轨防空兵', '尤里防空兵', '电浆防空兵', '磁轨防空兵'],
  ['冥蝠滑翔工兵', '冥蝠工兵', '吸波滑翔工兵', '尤里工兵'],
  ['生化特种狙击手', '二元神经毒气狙击手', '病毒狙击手', '神经毒气狙击手', '尤里狙击手'],
  ['尤里复制人', '复制人', '心灵突击队员'],
  ['基因狂兽人', '狂兽人', '尤里狂兽人'],
  ['机动熔炼采矿母车', '尤里采矿车', '采矿母车', '奴隶矿车'],
  ['狂风坦克', '狂风主战坦克', '尤里中型坦克'],
  ['盖特坦克', '尤里盖特坦克', '三档调速盖特'],
  ['冥河甲虫生化密封两栖步兵战车', '冥河甲虫运兵车', '冥河甲虫步兵战车'],
  ['神经突击车', '混沌无人机车', '神经毒气车'],
  ['磁电坦克', '尤里磁电坦克'],
  ['精神控制车', '心灵控制车', '脑车', '机动基因谐振突变车', '基因突变共振车', '车载基因突变器', '机动基因突变车', 'yuri.unit.support.mobile_genetic_mutator_vehicle', '牧羊人脑波中继与湿件抢修工程车', '牧羊人工程车'],
  ['镭射幽浮', '飞碟', '尤里飞碟'],
  ['雷鸣攻城潜艇', '雷鸣级攻城潜艇', '雷鸣潜艇', '尤里潜艇'],
  ['海妖级穿浪半潜式盖特防空护卫舰', '海妖级防空护卫舰', '海妖护卫舰'],
  ['工程兵', '盟军工程兵', '苏联工程兵', '战斗工兵'],
  ['医疗兵', '战地医疗兵', '盟军医疗兵', '苏联医疗兵'],
  ['侦察兵', '战地侦察兵', '盟军侦察兵', '苏联侦察兵'],
  ['间谍', '盟军间谍', '特工'],
] as const;

export function resolveUnitEquivalentCandidates(rawName: string): string[] {
  const trimmed = (rawName || '').trim();
  if (!trimmed) return [];
  const strippedFaction = trimmed
    .replace(/^\s*[\[【(（]\s*(?:盟军|苏联|苏军|苏维埃|尤里|通用)\s*[\]】)）]\s*/u, '')
    .replace(/^(?:盟军|苏联|苏军|苏维埃|尤里|通用)\s*(?=.{2,})/u, '')
    .trim();
  const candidates = new Set<string>([trimmed]);
  if (strippedFaction) candidates.add(strippedFaction);
  for (const group of UNIT_EQUIVALENT_GROUPS) {
    if (group.includes(trimmed) || (strippedFaction && group.includes(strippedFaction))) {
      for (const alias of group) {
        candidates.add(alias);
      }
    }
  }
  return [...candidates];
}

/* ═══════════════ 建筑与生产解锁辅助（evaluateBuildingUnlock / evaluateProductionUnlock） ═══════════════ */

export interface BuildingUnlockTarget {
  name: string;
  research?: string | null;
  need_building?: string | null;
  prereqs?: readonly string[];
  need_buildings?: readonly string[];
  need_units?: readonly string[];
  requirements?: unknown;
}

export interface ProductionUnlockTarget extends BuildingUnlockTarget {
  category?: string;
}

export interface PrerequisiteUnlockContextInput {
  techDone?: Iterable<string>;
  selectedBaseId?: string;
  bases?: ReadonlyMap<string, PrerequisiteBaseState>;
  selectedBaseBuildings?: Iterable<unknown>;
  unitPresent?: ReadonlyMap<string, number> | Record<string, number>;
  activeProtocols?: Iterable<string | PrerequisiteProtocolEntryLike>;
  protocols?: PrerequisiteProtocolSource;
  state?: {
    protocols?: readonly PrerequisiteProtocolEntryLike[];
    tech?: { done?: readonly string[] };
  };
  catalog?: {
    protocols?: PrerequisiteProtocolSource;
    researches?: readonly PrerequisiteResearchCatalogEntryLike[];
  };
}

export interface UnlockEvaluationResult {
  unlocked: boolean;
  satisfied: boolean;
  missingBuildings: string[];
  missingResearch: string[];
  missingUnits: string[];
  unmet: UnmetPrerequisite[];
  diagnostics: PrerequisiteDiagnostic[];
}

function normalizeUnlockContext(input: PrerequisiteUnlockContextInput = {}): {
  fullCtx: PrerequisiteContext;
  selectedBaseBuildings: Set<string>;
} {
  const selectedBaseId =
    typeof input.selectedBaseId === 'string' && input.selectedBaseId.trim()
      ? input.selectedBaseId.trim()
      : input.bases && input.bases.size > 0
        ? ([...input.bases.keys()][0] ?? '$default')
        : '$default';

  const baseFromMap = input.bases?.get(selectedBaseId);
  const directBuildings =
    input.selectedBaseBuildings !== undefined ? toTrimmedStringSet(input.selectedBaseBuildings) : null;

  const selectedBaseBuildings = new Set<string>(
    directBuildings ?? baseFromMap?.running ?? baseFromMap?.existing ?? [],
  );
  if (directBuildings && baseFromMap?.running) {
    for (const b of baseFromMap.running) selectedBaseBuildings.add(b);
  }

  const bases = new Map<string, PrerequisiteBaseState>();
  if (input.bases) {
    for (const [k, v] of input.bases.entries()) {
      bases.set(k, v);
    }
  }
  const existingSelected = bases.get(selectedBaseId);
  if (existingSelected) {
    if (directBuildings) {
      bases.set(selectedBaseId, {
        existing: new Set([...existingSelected.existing, ...directBuildings]),
        completed: new Set([...existingSelected.completed, ...directBuildings]),
        running: new Set([...existingSelected.running, ...directBuildings]),
      });
    }
  } else {
    bases.set(selectedBaseId, {
      existing: selectedBaseBuildings,
      completed: selectedBaseBuildings,
      running: selectedBaseBuildings,
    });
  }

  const techDone = new Set<string>();
  if (input.techDone) {
    for (const t of input.techDone) {
      if (typeof t === 'string' && t.trim()) techDone.add(t.trim());
    }
  }

  const unitPresent = new Map<string, number>();
  if (input.unitPresent instanceof Map) {
    for (const [k, v] of input.unitPresent.entries()) {
      if (typeof k === 'string' && typeof v === 'number') unitPresent.set(k, v);
    }
  } else if (isRecord(input.unitPresent)) {
    for (const [k, v] of Object.entries(input.unitPresent)) {
      if (typeof v === 'number' && Number.isFinite(v)) unitPresent.set(k, v);
    }
  }

  return {
    fullCtx: {
      techDone,
      selectedBaseId,
      bases,
      unitPresent,
      selectedBaseBuildings,
      activeProtocols: input.activeProtocols,
      protocols: input.protocols,
      state: input.state,
      catalog: input.catalog,
    },
    selectedBaseBuildings,
  };
}

function extractUnmetBucketsFromEval(unmet: readonly UnmetPrerequisite[]): {
  missingBuildings: string[];
  missingResearch: string[];
  missingUnits: string[];
} {
  const missingBuildings: string[] = [];
  const missingResearch: string[] = [];
  const missingUnits: string[] = [];
  const pushUnique = (arr: string[], val: string) => {
    const trimmed = val.trim();
    if (trimmed && !arr.includes(trimmed)) arr.push(trimmed);
  };
  for (const item of unmet) {
    const msg = item.message.trim();
    const bMatch = /^缺少(?:当前基地|全局)建筑：(.+?)(?:（(?:existing|completed|running)）)?$/.exec(msg);
    if (bMatch) {
      pushUnique(missingBuildings, bMatch[1]);
      continue;
    }
    if (msg.startsWith('[协议] 缺少协议：')) {
      pushUnique(missingResearch, msg.slice('[协议] 缺少协议：'.length).trim());
      continue;
    }
    if (msg.startsWith('缺少研究：')) {
      pushUnique(missingResearch, msg.slice('缺少研究：'.length));
      continue;
    }
    const uMatch = /^缺少单位：(.+?)(?:（.+）)?$/.exec(msg);
    if (uMatch) {
      pushUnique(missingUnits, uMatch[1]);
    }
  }
  return { missingBuildings, missingResearch, missingUnits };
}

export function inferDefaultProductionMotherBuilding(category?: string): string {
  const norm = (category ?? '').trim().toLowerCase();
  if (norm === 'infantry' || norm === '人员' || norm === '步兵') return '兵营';
  if (norm === 'equipment' || norm === '装备') return '个人装备制造所';
  if (norm === 'aircraft' || norm === 'air' || norm === '空军' || norm === '飞机' || norm === '航空') {
    return '空军指挥部';
  }
  if (norm === 'naval' || norm === 'ship' || norm === '海军' || norm === '舰艇' || norm === '舰船') {
    return '海军造船厂';
  }
  return '战车工厂';
}

export function evaluateBuildingUnlock(
  building: BuildingUnlockTarget,
  context: PrerequisiteUnlockContextInput = {},
): UnlockEvaluationResult {
  if (!isRecord(building) || typeof building.name !== 'string' || !building.name.trim()) {
    return {
      unlocked: false,
      satisfied: false,
      missingBuildings: [],
      missingResearch: [],
      missingUnits: [],
      unmet: [],
      diagnostics: [{ path: 'building.name', code: 'invalid_name', message: '建筑名称不能为空' }],
    };
  }
  const legacyDiag = validateLegacyRequirementFields(building);
  if (legacyDiag.length > 0) {
    return {
      unlocked: false,
      satisfied: false,
      missingBuildings: [],
      missingResearch: [],
      missingUnits: [],
      unmet: [],
      diagnostics: legacyDiag,
    };
  }

  const { fullCtx, selectedBaseBuildings } = normalizeUnlockContext(context);
  const trimmedName = building.name.trim();
  const isRootConyard = ROOT_CONYARD_BUILDINGS.has(trimmedName);

  const explicitNeedBuildings: string[] = [...(building.need_buildings ?? [])];
  if (
    explicitNeedBuildings.length === 0 &&
    typeof building.need_building === 'string' &&
    building.need_building.trim() &&
    building.need_building.trim() !== '无' &&
    building.need_building.trim() !== '——'
  ) {
    explicitNeedBuildings.push(building.need_building.trim());
  }

  const combined = combineLegacyPrerequisites(
    {
      research: typeof building.research === 'string' ? building.research : undefined,
      prereqs: building.prereqs,
      need_buildings: explicitNeedBuildings,
      need_units: building.need_units,
      requirements: building.requirements,
    },
    'running',
  );
  const evalResult = evaluatePrerequisite(combined, fullCtx);
  const { missingBuildings, missingResearch, missingUnits } = extractUnmetBucketsFromEval(evalResult.unmet);
  const unmet = [...evalResult.unmet];

  for (const reqBld of explicitNeedBuildings) {
    if (!setHasEquivalentBuilding(selectedBaseBuildings, reqBld) && !missingBuildings.includes(reqBld)) {
      missingBuildings.push(reqBld);
    }
  }

  if (!isRootConyard) {
    const hasOperationalConyard = [...ROOT_CONYARD_BUILDINGS].some(rootName =>
      setHasEquivalentBuilding(selectedBaseBuildings, rootName),
    );
    if (!hasOperationalConyard) {
      const alreadyHasConyardMissing = missingBuildings.some(b => ROOT_CONYARD_BUILDINGS.has(b.trim()));
      if (!alreadyHasConyardMissing) {
        missingBuildings.unshift('建造厂');
      }
      if (!unmet.some(u => u.message.includes('建造厂'))) {
        unmet.unshift({
          path: 'requirements.conyard',
          message: '缺少当前基地建筑：建造厂（running）',
        });
      }
    }
  }

  const unlocked =
    evalResult.diagnostics.length === 0 &&
    evalResult.satisfied &&
    missingBuildings.length === 0 &&
    missingResearch.length === 0 &&
    missingUnits.length === 0;

  return {
    unlocked,
    satisfied: unlocked,
    missingBuildings,
    missingResearch,
    missingUnits,
    unmet,
    diagnostics: evalResult.diagnostics,
  };
}

export function evaluateProductionUnlock(
  production: ProductionUnlockTarget,
  context: PrerequisiteUnlockContextInput = {},
): UnlockEvaluationResult {
  if (!isRecord(production) || typeof production.name !== 'string' || !production.name.trim()) {
    return {
      unlocked: false,
      satisfied: false,
      missingBuildings: [],
      missingResearch: [],
      missingUnits: [],
      unmet: [],
      diagnostics: [{ path: 'production.name', code: 'invalid_name', message: '生产条目名称不能为空' }],
    };
  }
  const legacyDiag = validateLegacyRequirementFields(production);
  if (legacyDiag.length > 0) {
    return {
      unlocked: false,
      satisfied: false,
      missingBuildings: [],
      missingResearch: [],
      missingUnits: [],
      unmet: [],
      diagnostics: legacyDiag,
    };
  }

  const { fullCtx, selectedBaseBuildings } = normalizeUnlockContext(context);

  const explicitNeedBuildings: string[] = [...(production.need_buildings ?? [])];
  if (
    explicitNeedBuildings.length === 0 &&
    typeof production.need_building === 'string' &&
    production.need_building.trim() &&
    production.need_building.trim() !== '无' &&
    production.need_building.trim() !== '——'
  ) {
    explicitNeedBuildings.push(production.need_building.trim());
  }

  const effectiveNeedBuildings =
    explicitNeedBuildings.length > 0
      ? explicitNeedBuildings
      : [inferDefaultProductionMotherBuilding((production as { category?: string }).category)];

  const combined = combineLegacyPrerequisites(
    {
      research: typeof production.research === 'string' ? production.research : undefined,
      prereqs: production.prereqs,
      need_buildings: effectiveNeedBuildings,
      need_units: production.need_units,
      requirements: production.requirements,
    },
    'running',
  );
  const evalResult = evaluatePrerequisite(combined, fullCtx);
  const { missingBuildings, missingResearch, missingUnits } = extractUnmetBucketsFromEval(evalResult.unmet);
  const unmet = [...evalResult.unmet];

  for (const reqBld of effectiveNeedBuildings) {
    if (!setHasEquivalentBuilding(selectedBaseBuildings, reqBld) && !missingBuildings.includes(reqBld)) {
      missingBuildings.push(reqBld);
      if (!unmet.some(u => u.message.includes(reqBld))) {
        unmet.push({
          path: 'requirements.mother_building',
          message: `缺少当前基地建筑：${reqBld}（running）`,
        });
      }
    }
  }

  const unlocked =
    evalResult.diagnostics.length === 0 &&
    evalResult.satisfied &&
    missingBuildings.length === 0 &&
    missingResearch.length === 0 &&
    missingUnits.length === 0;

  return {
    unlocked,
    satisfied: unlocked,
    missingBuildings,
    missingResearch,
    missingUnits,
    unmet,
    diagnostics: evalResult.diagnostics,
  };
}

export function deriveBuildableWithContext<T extends BuildingUnlockTarget>(
  catalog: readonly T[],
  context: PrerequisiteUnlockContextInput,
  queued: readonly string[] = [],
): T[] {
  return catalog.filter(item => !queued.includes(item.name) && evaluateBuildingUnlock(item, context).unlocked);
}

export function deriveProducibleWithContext<T extends ProductionUnlockTarget>(
  catalog: readonly T[],
  context: PrerequisiteUnlockContextInput,
): T[] {
  return catalog.filter(item => evaluateProductionUnlock(item, context).unlocked);
}

export type SovietBuildingInputItem = string | { name: string; state?: string; status?: string };

export interface SovietTierGateInput {
  buildings?: Iterable<SovietBuildingInputItem>;
  bases?: ReadonlyArray<{ status?: string; buildings?: ReadonlyArray<SovietBuildingInputItem> }>;
  techDone?: Iterable<string>;
  activeProtocols?: Iterable<string | PrerequisiteProtocolEntryLike>;
  manufacturingLoops?: Iterable<string>;
  heavyWeapons?: Iterable<string> | ReadonlyMap<string, number> | Record<string, number>;
  unitPresent?: ReadonlyMap<string, number> | Record<string, number>;
  strictScienceCityCert?: boolean;
}

export interface SovietTierGateEvaluation {
  tier: 1 | 2 | 3;
  t2Met: boolean;
  t3Met: boolean;
  missingForT2: string[];
  missingForT3: string[];
}

function collectOperationalBuildingNames(
  buildings?: Iterable<SovietBuildingInputItem>,
  bases?: ReadonlyArray<{ status?: string; buildings?: ReadonlyArray<SovietBuildingInputItem> }>,
): string[] {
  const result: string[] = [];
  const pushItem = (item: SovietBuildingInputItem) => {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed) result.push(trimmed);
      return;
    }
    if (item && typeof item.name === 'string') {
      const trimmedName = item.name.trim();
      if (!trimmedName) return;
      const rawState = (item.state ?? item.status ?? '').trim();
      if (rawState && INACTIVE_SOVIET_BUILDING_STATES.has(rawState)) return;
      result.push(trimmedName);
    }
  };
  if (buildings) {
    for (const b of buildings) pushItem(b);
  }
  if (bases) {
    for (const base of bases) {
      if (base.status && INACTIVE_SOVIET_BUILDING_STATES.has(base.status.trim())) continue;
      for (const b of base.buildings ?? []) pushItem(b);
    }
  }
  return result;
}

export function evaluateSovietTierGate(input: SovietTierGateInput = {}): SovietTierGateEvaluation {
  const activeBuildings = collectOperationalBuildingNames(input.buildings, input.bases);

  const hasT2Lab = activeBuildings.some(name =>
    SOVIET_T2_LAB_NAMES.some(alias => name === alias || name.includes(alias)),
  );
  const missingForT2: string[] = hasT2Lab ? [] : ['缺少T2核心科研建筑：红星实验设计局综合体（或苏联战斗实验室）'];

  const hasScienceCity = activeBuildings.some(name =>
    SOVIET_T3_SCIENCE_CITY_NAMES.some(alias => name === alias || name.includes(alias)),
  );
  const missingForT3: string[] = [];
  if (!hasT2Lab) {
    missingForT3.push('未达成T2前置：红星实验设计局综合体（或苏联战斗实验室）');
  }
  if (!hasScienceCity) {
    missingForT3.push('缺少T3战略科研圣地：红星科学城（国家战略工程综合体／红星科学城）');
  }

  if (input.strictScienceCityCert) {
    const unlockedSet = new Set<string>();
    const addKey = (val: unknown) => {
      if (typeof val === 'string' && val.trim()) unlockedSet.add(val.trim());
    };
    if (input.techDone) {
      for (const t of input.techDone) addKey(t);
    }
    if (input.manufacturingLoops) {
      for (const loop of input.manufacturingLoops) addKey(loop);
    }
    if (input.activeProtocols) {
      for (const entry of input.activeProtocols) {
        if (typeof entry === 'string') {
          addKey(entry);
        } else if (entry && typeof entry === 'object') {
          if (entry.status !== undefined && entry.status !== 'active') continue;
          addKey(entry.id);
          addKey(entry.ref);
          addKey(entry.name);
        }
      }
    }
    expandTechEquivalentSet(unlockedSet);

    for (const ticket of SOVIET_T3_TICKET_TECHS) {
      if (!unlockedSet.has(ticket)) {
        missingForT3.push(`缺少科学城门票卡科技：${ticket}`);
      }
    }

    for (const loop of SOVIET_T3_MANUFACTURING_LOOPS) {
      if (!unlockedSet.has(loop)) {
        missingForT3.push(`缺少科学城制造闭环：${loop}`);
      }
    }

    const heavySet = new Set<string>();
    const consumeHeavySource = (
      src?: Iterable<string> | ReadonlyMap<string, number> | Record<string, number>,
    ) => {
      if (!src) return;
      if (src instanceof Map) {
        for (const [k, v] of src.entries()) {
          if (typeof v === 'number' && v > 0 && k.trim()) heavySet.add(k.trim());
        }
        return;
      }
      if (isIterableNonString(src)) {
        for (const item of src) addKeyToSet(heavySet, item);
        return;
      }
      if (isRecord(src)) {
        for (const [k, v] of Object.entries(src)) {
          if (typeof v === 'number' && v > 0 && k.trim()) heavySet.add(k.trim());
        }
      }
    };
    consumeHeavySource(input.heavyWeapons);
    consumeHeavySource(input.unitPresent);
    for (const w of SOVIET_T3_HEAVY_WEAPONS) {
      if (unlockedSet.has(w)) heavySet.add(w);
    }

    const matchedHeavyCount = SOVIET_T3_HEAVY_WEAPONS.filter(w => heavySet.has(w)).length;
    if (matchedHeavyCount < 2) {
      missingForT3.push(`五大T2重器列装/解锁不足2项（当前 ${matchedHeavyCount}/2）`);
    }
  }

  const t2Met = missingForT2.length === 0;
  const t3Met = t2Met && missingForT3.length === 0;
  const tier: 1 | 2 | 3 = t3Met ? 3 : t2Met ? 2 : 1;

  return { tier, t2Met, t3Met, missingForT2, missingForT3 };
}

function addKeyToSet(target: Set<string>, val: unknown): void {
  if (typeof val === 'string' && val.trim()) target.add(val.trim());
}

export const KIROV_HANGAR_BUILDING_NAMES = ['基洛夫飞艇制造厂', '基洛夫专库', '重型飞艇船坞'] as const;
export const DREADNOUGHT_DOCK_BUILDING_NAMES = ['苏联造船厂', '重型船坞', '海军造船厂'] as const;
export const YURI_MASTERMIND_BAY_BUILDING_NAMES = ['母脑湿件培育与特装总装跨'] as const;
export const YURI_FLOATING_DISK_HANGAR_BUILDING_NAMES = ['环形磁流体飞碟整备与微波充能巢'] as const;
export const YURI_SUBMARINE_DOCK_BUILDING_NAMES = ['半潜消磁船坞与龟背重弹装填栈桥', '尤里半潜与仿生造船厂'] as const;
export const YURI_ACE_CAPACITY_BUILDINGS = [
  '母脑湿件培育与特装总装跨',
  '环形磁流体飞碟整备与微波充能巢',
  '半潜消磁船坞与龟背重弹装填栈桥',
] as const;

export interface SovietSpecialCapacityEvaluation {
  allowed: boolean;
  cap: number | null;
  used: number;
  reason: string | null;
}

export function evaluateSovietSpecialCapacity(
  unitName: string,
  baseBuildings: Iterable<SovietBuildingInputItem>,
  currentCount = 0,
  queuedCount = 0,
): SovietSpecialCapacityEvaluation {
  const used = Math.max(0, currentCount) + Math.max(0, queuedCount);
  const trimmedUnit = unitName.trim();
  const activeBuildings = collectOperationalBuildingNames(baseBuildings);

  if (trimmedUnit === '基洛夫空艇') {
    const berths = activeBuildings.filter(name =>
      KIROV_HANGAR_BUILDING_NAMES.some(anchor => name === anchor || name.includes(anchor)),
    ).length;
    const allowed = used < berths;
    return {
      allowed,
      cap: berths,
      used,
      reason: allowed ? null : '基洛夫专库泊位已满（需 1:1 专属飞艇库支撑）',
    };
  }

  if (trimmedUnit === '无畏级导弹舰') {
    const berths = activeBuildings.filter(name =>
      DREADNOUGHT_DOCK_BUILDING_NAMES.some(anchor => name === anchor || name.includes(anchor)),
    ).length;
    const allowed = used < berths;
    return {
      allowed,
      cap: berths,
      used,
      reason: allowed ? null : '重型船坞泊位已满（需增建造船厂/重型船坞）',
    };
  }

  if (trimmedUnit === '精神控制车') {
    const berths = activeBuildings.filter(name =>
      YURI_MASTERMIND_BAY_BUILDING_NAMES.some(anchor => name === anchor || name.includes(anchor)),
    ).length;
    const allowed = used < berths;
    return {
      allowed,
      cap: berths,
      used,
      reason: allowed ? null : '母脑湿件培育与特装总装跨泊位已满',
    };
  }

  if (trimmedUnit === '镭射幽浮') {
    const berths = activeBuildings.filter(name =>
      YURI_FLOATING_DISK_HANGAR_BUILDING_NAMES.some(anchor => name === anchor || name.includes(anchor)),
    ).length;
    const allowed = used < berths;
    return {
      allowed,
      cap: berths,
      used,
      reason: allowed ? null : '环形磁流体飞碟整备与微波充能巢泊位已满（一舰一巢位）',
    };
  }

  if (trimmedUnit === '深渊母巢双壳体巨型潜水母舰') {
    const berths = activeBuildings.filter(name =>
      YURI_SUBMARINE_DOCK_BUILDING_NAMES.some(anchor => name === anchor || name.includes(anchor)),
    ).length;
    const allowed = used < berths;
    return {
      allowed,
      cap: berths,
      used,
      reason: allowed ? null : '半潜消磁船坞与龟背重弹装填栈桥泊位已满',
    };
  }

  return { allowed: true, cap: null, used, reason: null };
}

export const evaluateYuriSpecialCapacity = evaluateSovietSpecialCapacity;
