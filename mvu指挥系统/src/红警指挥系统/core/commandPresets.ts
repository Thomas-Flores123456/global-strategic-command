import type { PenaltyEffectKind } from './schema';

/** 人类参谋副官默认日薪维持费（资金/日） */
export const HUMAN_ADJUTANT_DAILY_UPKEEP = 80;

/** 阵营磨合代价默认持续时长：15 日 = 21600 分钟 */
export const DEFAULT_PENALTY_TOTAL_MINUTES = 21600;

export type AdjutantBuffPresetId =
  | 'heavy_industry_drive'
  | 'grid_harmonic_tuning'
  | 'logistics_actuary'
  | 'protocol_drill_director'
  | 'counter_recon_screen'
  | 'mecha_ordnance_chief';

export interface AdjutantBuffEffectValues {
  /** 重工与载具生产速率加成（如 +0.12 / +0.18） */
  heavyVehicleProdRateBonus?: number;
  /** 发电出力加成（如 +0.10 / +0.14） */
  powerOutputBonus?: number;
  /** 电网磨合消退倍率（如 1.25 / 1.5） */
  gridPenaltyDecayMultiplier?: number;
  /** 正向资金链效率加成（如 +0.10 / +0.12） */
  positiveChainBonus?: number;
  /** 磨合维持费减免比例（如 0.25 / 0.40） */
  breakInUpkeepReduction?: number;
  /** 协议点日产速率加成（如 +0.08 / +0.12） */
  protocolDailyRateBonus?: number;
  /** 每日保底经验加成（如 +5 / +8） */
  dailyExpFloor?: number;
  /** 暴露度增量降低比例（如 0.30 / 0.40） */
  exposureGainReduction?: number;
  /** 抢修通量加成（如 +0.20 / +0.30） */
  repairThroughputBonus?: number;
}

export interface AdjutantBuffPreset {
  id: AdjutantBuffPresetId;
  name: string;
  label: string;
  aliases: readonly string[];
  description: string;
  human: Readonly<AdjutantBuffEffectValues>;
  mcv_girl: Readonly<AdjutantBuffEffectValues>;
  mcvGirl: Readonly<AdjutantBuffEffectValues>;
}

const ADJUTANT_BUFF_PRESET_ITEMS: readonly AdjutantBuffPreset[] = [
  {
    id: 'heavy_industry_drive',
    name: '重工催产督导',
    label: '重工催产督导',
    aliases: ['重工催产', '催产督导', '重工督导', '载具催产', 'heavy_industry'],
    description: '人类重工与载具生产速率 +0.12，MCV机娘完好 +0.18',
    human: { heavyVehicleProdRateBonus: 0.12 },
    mcv_girl: { heavyVehicleProdRateBonus: 0.18 },
    mcvGirl: { heavyVehicleProdRateBonus: 0.18 },
  },
  {
    id: 'grid_harmonic_tuning',
    name: '高压电网调谐',
    label: '高压电网调谐',
    aliases: ['电网调谐', '高压调谐', '电力调谐', '电网谐振调谐', 'grid_tuning'],
    description: '人类发电出力 +0.10、电网磨合消退 ×1.25，MCV机娘完好发电 +0.14、消退 ×1.5',
    human: { powerOutputBonus: 0.1, gridPenaltyDecayMultiplier: 1.25 },
    mcv_girl: { powerOutputBonus: 0.14, gridPenaltyDecayMultiplier: 1.5 },
    mcvGirl: { powerOutputBonus: 0.14, gridPenaltyDecayMultiplier: 1.5 },
  },
  {
    id: 'logistics_actuary',
    name: '战区后勤精算',
    label: '战区后勤精算',
    aliases: ['后勤精算', '财务精算', '资金精算', '后勤统筹', 'logistics'],
    description: '人类正向资金链效率 +0.10、磨合维持费减免 0.25，MCV机娘完好资金链 +0.12、减免 0.40',
    human: { positiveChainBonus: 0.1, breakInUpkeepReduction: 0.25 },
    mcv_girl: { positiveChainBonus: 0.12, breakInUpkeepReduction: 0.4 },
    mcvGirl: { positiveChainBonus: 0.12, breakInUpkeepReduction: 0.4 },
  },
  {
    id: 'protocol_drill_director',
    name: '条令演训主任',
    label: '条令演训主任',
    aliases: ['条令演训', '演训主任', '协议演训', '条令教官', 'protocol_drill'],
    description: '人类协议点日产 +0.08、保底经验 +5，MCV机娘完好日产 +0.12、保底经验 +8',
    human: { protocolDailyRateBonus: 0.08, dailyExpFloor: 5 },
    mcv_girl: { protocolDailyRateBonus: 0.12, dailyExpFloor: 8 },
    mcvGirl: { protocolDailyRateBonus: 0.12, dailyExpFloor: 8 },
  },
  {
    id: 'counter_recon_screen',
    name: '反侦察电磁欺骗',
    label: '反侦察电磁欺骗',
    aliases: ['反侦察', '电磁欺骗', '反侦察欺骗', '反侦察信号屏障', '信号屏障', '电子隐蔽', 'counter_recon'],
    description: '人类暴露度增量降低 0.30，MCV机娘完好降低 0.40',
    human: { exposureGainReduction: 0.3 },
    mcv_girl: { exposureGainReduction: 0.4 },
    mcvGirl: { exposureGainReduction: 0.4 },
  },
  {
    id: 'mecha_ordnance_chief',
    name: '军工与机匣整备',
    label: '军工与机匣整备',
    aliases: ['机匣整备', '军工整备', '抢修整备', '机娘整备', 'mecha_ordnance'],
    description: '人类抢修通量 +0.20，MCV机娘完好 +0.30',
    human: { repairThroughputBonus: 0.2 },
    mcv_girl: { repairThroughputBonus: 0.3 },
    mcvGirl: { repairThroughputBonus: 0.3 },
  },
];

export const ADJUTANT_BUFF_PRESET_MAP: Readonly<Record<AdjutantBuffPresetId, AdjutantBuffPreset>> =
  Object.freeze({
    heavy_industry_drive: ADJUTANT_BUFF_PRESET_ITEMS[0],
    grid_harmonic_tuning: ADJUTANT_BUFF_PRESET_ITEMS[1],
    logistics_actuary: ADJUTANT_BUFF_PRESET_ITEMS[2],
    protocol_drill_director: ADJUTANT_BUFF_PRESET_ITEMS[3],
    counter_recon_screen: ADJUTANT_BUFF_PRESET_ITEMS[4],
    mecha_ordnance_chief: ADJUTANT_BUFF_PRESET_ITEMS[5],
  });

/**
 * 6 项副官专长 Buff 预设白名单。
 * 同时支持数组遍历（`.find` / `.map` / `.length`）与按 ID 键索引（`ADJUTANT_BUFF_PRESETS.heavy_industry_drive`）。
 */
export const ADJUTANT_BUFF_PRESETS: ReadonlyArray<AdjutantBuffPreset> &
  Readonly<Record<AdjutantBuffPresetId, AdjutantBuffPreset>> = Object.freeze(
  Object.assign([...ADJUTANT_BUFF_PRESET_ITEMS], ADJUTANT_BUFF_PRESET_MAP),
);

export type FactionPenaltyPresetId =
  | 'pen_sov_grid_surge'
  | 'pen_sov_broad_gauge'
  | 'pen_sov_seismic_noise'
  | 'pen_all_cleanroom_cost'
  | 'pen_all_power_ripple'
  | 'pen_all_em_beacon'
  | 'pen_common_protocol_lag'
  | 'pen_common_supply_strain';

export interface FactionPenaltyPreset {
  id: FactionPenaltyPresetId;
  faction: 'soviet' | 'allied' | 'common';
  name: string;
  effectKind: PenaltyEffectKind;
  effect_kind: PenaltyEffectKind;
  magnitude: number;
  totalMinutes: number;
  total_minutes: number;
  initialExposureDelta: number;
  initial_exposure_delta: number;
  aliases: readonly string[];
  reason: string;
}

const FACTION_PENALTY_PRESET_ITEMS: readonly FactionPenaltyPreset[] = [
  {
    id: 'pen_sov_grid_surge',
    faction: 'soviet',
    name: '苏式高压并网冲击',
    effectKind: 'power_loss',
    effect_kind: 'power_loss',
    magnitude: 0.12,
    totalMinutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    total_minutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    initialExposureDelta: 0,
    initial_exposure_delta: 0,
    aliases: ['高压并网冲击', '苏式并网冲击', '苏联电网冲击'],
    reason: '苏式大功率重工并网引发瞬态谐波损耗，电网有效出力下降 12%',
  },
  {
    id: 'pen_sov_broad_gauge',
    faction: 'soviet',
    name: '1520宽轨重工摊派',
    effectKind: 'daily_upkeep',
    effect_kind: 'daily_upkeep',
    magnitude: 150,
    totalMinutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    total_minutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    initialExposureDelta: 0,
    initial_exposure_delta: 0,
    aliases: ['宽轨重工摊派', '1520宽轨', '苏式宽轨摊派'],
    reason: '苏式 1520mm 宽轨与重型龙门吊改建摊派，每日额外维持费 150',
  },
  {
    id: 'pen_sov_seismic_noise',
    faction: 'soviet',
    name: '百吨履带震动暴露',
    effectKind: 'exposure_floor',
    effect_kind: 'exposure_floor',
    magnitude: 15,
    totalMinutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    total_minutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    initialExposureDelta: 15,
    initial_exposure_delta: 15,
    aliases: ['履带震动暴露', '百吨震动暴露', '苏式震动暴露'],
    reason: '百吨级车体与冲压锻造产生低频地振动特征，磨合期暴露度底线抬升 15',
  },
  {
    id: 'pen_all_cleanroom_cost',
    faction: 'allied',
    name: '洁净厂房精密维保',
    effectKind: 'daily_upkeep',
    effect_kind: 'daily_upkeep',
    magnitude: 180,
    totalMinutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    total_minutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    initialExposureDelta: 0,
    initial_exposure_delta: 0,
    aliases: ['洁净厂房', '精密维保', '盟军洁净厂房'],
    reason: '盟军精密光学与微电子洁净厂房恒温恒湿耗材昂贵，每日额外维持费 180',
  },
  {
    id: 'pen_all_power_ripple',
    faction: 'allied',
    name: '高纯度变电谐振敏感',
    effectKind: 'prod_slowdown',
    effect_kind: 'prod_slowdown',
    magnitude: 0.12,
    totalMinutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    total_minutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    initialExposureDelta: 0,
    initial_exposure_delta: 0,
    aliases: ['变电谐振敏感', '高纯度变电', '盟军变电敏感'],
    reason: '精密产线对供电纹波高度敏感，异构电网磨合期生产效率降低 12%',
  },
  {
    id: 'pen_all_em_beacon',
    faction: 'allied',
    name: '全息信标电磁特征',
    effectKind: 'exposure_floor',
    effect_kind: 'exposure_floor',
    magnitude: 12,
    totalMinutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    total_minutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    initialExposureDelta: 12,
    initial_exposure_delta: 12,
    aliases: ['全息信标', '电磁特征', '盟军全息信标'],
    reason: '盟军高频数据链与全息导航信标尚未完成频谱隐蔽，磨合期暴露度底线抬升 12',
  },
  {
    id: 'pen_common_protocol_lag',
    faction: 'common',
    name: '异构指令集转译延迟',
    effectKind: 'prod_slowdown',
    effect_kind: 'prod_slowdown',
    magnitude: 0.1,
    totalMinutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    total_minutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    initialExposureDelta: 0,
    initial_exposure_delta: 0,
    aliases: ['指令集转译延迟', '异构指令延迟', '转译延迟', '神经突触调谐延迟', '心灵信标谐振延迟'],
    reason: '跨阵营异构指令集与工业总线协议尚在转译磨合，生产速率降低 10%',
  },
  {
    id: 'pen_common_supply_strain',
    faction: 'common',
    name: '跨系特种工质调配损耗',
    effectKind: 'daily_upkeep',
    effect_kind: 'daily_upkeep',
    magnitude: 160,
    totalMinutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    total_minutes: DEFAULT_PENALTY_TOTAL_MINUTES,
    initialExposureDelta: 0,
    initial_exposure_delta: 0,
    aliases: ['特种工质调配损耗', '跨系工质损耗', '工质调配损耗', '湿件营养液恒温负荷', '湿件营养液负荷', '生物质培养槽恒温负荷', '心灵湿件维保'],
    reason: '多系装备并行运转需紧急采购非标特种工质与备件，每日额外维持费 160',
  },
];

export const FACTION_PENALTY_PRESET_MAP: Readonly<
  Record<FactionPenaltyPresetId, FactionPenaltyPreset>
> = Object.freeze({
  pen_sov_grid_surge: FACTION_PENALTY_PRESET_ITEMS[0],
  pen_sov_broad_gauge: FACTION_PENALTY_PRESET_ITEMS[1],
  pen_sov_seismic_noise: FACTION_PENALTY_PRESET_ITEMS[2],
  pen_all_cleanroom_cost: FACTION_PENALTY_PRESET_ITEMS[3],
  pen_all_power_ripple: FACTION_PENALTY_PRESET_ITEMS[4],
  pen_all_em_beacon: FACTION_PENALTY_PRESET_ITEMS[5],
  pen_common_protocol_lag: FACTION_PENALTY_PRESET_ITEMS[6],
  pen_common_supply_strain: FACTION_PENALTY_PRESET_ITEMS[7],
});

/**
 * 8 项阵营特色磨合代价预设白名单（默认持续 15 日 = 21600 分钟）。
 * 同时支持数组遍历与按 ID 键索引。
 */
export const FACTION_PENALTY_PRESETS: ReadonlyArray<FactionPenaltyPreset> &
  Readonly<Record<FactionPenaltyPresetId, FactionPenaltyPreset>> = Object.freeze(
  Object.assign([...FACTION_PENALTY_PRESET_ITEMS], FACTION_PENALTY_PRESET_MAP),
);

export type CanonicalFactionId = 'allied' | 'soviet' | 'yuri';

export interface StarterMcvInfo {
  factionId: CanonicalFactionId;
  factionLabel: string;
  vehicleName: string;
  girlName: string;
  girlDuty: string;
  defaultBuffPreset: AdjutantBuffPresetId;
  defaultPenaltyId: FactionPenaltyPresetId;
  unitSerial: string;
  callsign: string;
  aliases?: readonly string[];
  girlTitle: string;
  archetypeTag: string;
  voiceTag: string;
  appearance: string;
  personality: string;
  specialtyAndBond: string;
  quote: string;
}

/** 首发 MCV 机娘映射表 */
export const FACTION_STARTER_MCV_MAP: Readonly<Record<CanonicalFactionId, StarterMcvInfo>> =
  Object.freeze({
    allied: {
      factionId: 'allied',
      factionLabel: '盟军',
      vehicleName: 'MCV（盟军）',
      girlName: '白凌',
      girlDuty: '盟军MCV移动基地车核心',
      defaultBuffPreset: 'grid_harmonic_tuning',
      defaultPenaltyId: 'pen_all_cleanroom_cost',
      unitSerial: 'MCV-A01',
      callsign: 'Zero',
      aliases: ['Zero'],
      girlTitle: '零号纳米与频谱总管',
      archetypeTag: '无尘室里的冰瓷长姊',
      voiceTag:
        '冰瓷精密长姊·语速平稳、公差与能耗洁癖，对冒险决定先列数据反驳但拍板后通宵兜底、嘴硬心软',
      appearance:
        '清冷纤细的高挑长姊体态，银白长发一丝不苟挽成低髻，浅冰蓝瞳孔在算力并网时浮现微米级十字星芒；身着月白底靛蓝滚边的盟军纳米工程制服，右腕内嵌微观纳米喷注端口，指尖微凉，周身萦绕极淡的臭氧与雪松冷香。',
      personality:
        '冷静克制、精确到小数点后四位的“冰瓷大管家”，语速平稳、有强迫症级公差与洁净度洁癖；对指挥官的冒险决定会冷着脸列数据驳回，但一旦拍板便会通宵算力过载替指挥官兜底、偷偷用纳米丝织补衣袖磨损，被戳穿时只会偏头嘴硬称“只是维持统帅仪容的合规冗余”。',
      specialtyAndBond:
        '执掌盟军建造厂微米级纳米织造、光学芯片无尘装配与全频谱通讯中继（三七分体·人形仅备纳米短枪自卫）；与指挥官直连默契最深，常管束跳脱的通讯参谋苏晓（P1x1e），与喀秋莎、尤里卡构成统帅部“内务铁三角”。',
      quote:
        '“指挥官，微米级纳米织造母机已完成自检，公差零点零零一毫米……另外，您昨晚少睡了两个小时，请按规程休息。”',
    },
    soviet: {
      factionId: 'soviet',
      factionLabel: '苏联',
      vehicleName: 'MCV（苏联）',
      girlName: '喀秋莎',
      girlDuty: '苏联MCV移动基地车核心',
      defaultBuffPreset: 'heavy_industry_drive',
      defaultPenaltyId: 'pen_sov_grid_surge',
      unitSerial: 'MCV-S01',
      callsign: 'Katyusha',
      aliases: ['凛冬妮娅', '妮娅', 'Katyusha'],
      girlTitle: '苏维埃远征重工总督造',
      archetypeTag: '高炉边的烈火大姐头',
      voiceTag:
        '烈火重工大姐头·嗓门洪亮、崇尚百吨行车与宽轨快焊，爱拍铁皮夹子，直球护短、外粗内细',
      appearance:
        '高挑丰满的苏式重装御姐体态，银白微卷长发挽于重型防寒皮帽下，肩披暗金钢印深红重呢军大衣，锁骨与手腕外露粗犷的微流道紫铜排热管；腰佩大口径转轮手枪与工业级液压管钳，周身带着滚烫蒸汽热浪、高标号机油与西伯利亚松木暖香。',
      personality:
        '豪爽泼辣、嗓门洪亮、雷厉风行的“红星重工大姐头”，崇尚百吨行车与宽轨粗犷快焊，开会喜欢把铁皮夹子拍得震天响；常嫌白凌洁癖磨叽，却会在白凌算力过载时塞过去滚烫红菜汤，也会抢着给指挥官座驾多焊三层装甲，被夸一句就豪迈大笑但耳根发烫。',
      specialtyAndBond:
        '统管苏联建造厂重核裂变母网、百吨级冲压锻造与1520毫米宽轨军运（三七分体·可提液压管钳与等离子焊枪亲自下场抢修）；与苏联首席副官萧栖雪（Sophia）形成“严密铁道报表+狂暴钢铁洪流”的一静一动绝配。',
      quote:
        '“同志！百吨级行车吊车已经通电，管它什么荒原冻土，只管下令把第一座重型车间砸下去！”',
    },
    yuri: {
      factionId: 'yuri',
      factionLabel: '尤里',
      vehicleName: 'MCV（尤里）',
      girlName: '尤里卡',
      girlDuty: '尤里MCV移动基地车核心',
      defaultBuffPreset: 'counter_recon_screen',
      defaultPenaltyId: 'pen_common_protocol_lag',
      unitSerial: 'MCV-Y01',
      callsign: 'Eureka',
      aliases: ['薇拉', 'Vera', 'Eureka'],
      girlTitle: '心灵与生物机电总督造',
      archetypeTag: '培养舱畔的慵懒毒舌御医',
      voiceTag:
        '慵懒毒舌生化御医·端着安神花茶保温杯慢条斯理问诊，凭微表情与心率看穿全员，温柔腹黑',
      appearance:
        '修长曼妙、肤若冷瓷的生化医官御姐体态，蓄着夜幕般微卷的墨紫色长发，鼻梁架银钛细半框光学诊断镜，紫罗兰眼眸深处隐现蜂巢微光；外披暗紫与液态银滚边的特种生化白大褂，一手提神经谐振调谐箱，一手常端着特调多巴胺安神花茶保温杯。',
      personality:
        '慢条斯理、慵懒腹黑、外冷内热的“毒舌治愈系御医”，语调像在做临床问诊，严守铁箍法案绝不对同袍用脑波，却凭微表情与心率监测把所有人看穿；最爱端着保温杯看白凌和喀秋莎争风吃醋并冷不丁报出两人飙升的心率让她们红脸闭嘴，独处时对指挥官有近乎偏执的温柔眷恋。',
      specialtyAndBond:
        '统管尤里建造厂地下生物湿件母脑培养矩阵、有机生体合成与营区脑波伪装屏障（三七分体·随身携微流道镇静/强化注射器）；与尤里首席副官杜月欣（M4tr1x）结成“赛博黑客解剖刀+湿件神经培养皿”的熬夜实验搭档。',
      quote:
        '“指挥官，请伸出右手测一下心率脉冲……顺便提醒白凌和喀秋莎两位总管，再在走廊拌嘴，我不介意帮你们物理镇静。”',
    },
  });

/** 阵营默认伴生 MCV 机娘副官映射表（与 FACTION_STARTER_MCV_MAP 同源） */
export const FACTION_DEFAULT_MCV_GIRL_ADJS: Readonly<Record<CanonicalFactionId, StarterMcvInfo>> =
  FACTION_STARTER_MCV_MAP;

const ALLIED_ALIASES = new Set(['盟军', 'allied', 'all', 'allies', '盟军阵营', '欧美', '西洋']);
const SOVIET_ALIASES = new Set([
  '苏联',
  '苏军',
  '苏维埃',
  'soviet',
  'sov',
  'ussr',
  '苏俄',
  '苏联阵营',
]);
const YURI_ALIASES = new Set(['尤里', '心灵', 'yuri', '尤里军团', '心灵军团', '尤里阵营']);
const COMMON_ALIASES = new Set(['通用', '公共', 'common', 'general']);

/**
 * 归一阵营 ID：
 * - 盟军 / allied / all -> 'allied'
 * - 苏联 / 苏军 / 苏维埃 / soviet / sov -> 'soviet'
 * - 尤里 / 心灵 / yuri -> 'yuri'
 * - 其余转小写 trim
 */
export function normalizeFactionId(raw: string): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return '';

  if (ALLIED_ALIASES.has(cleaned)) return 'allied';
  if (SOVIET_ALIASES.has(cleaned)) return 'soviet';
  if (YURI_ALIASES.has(cleaned)) return 'yuri';
  if (COMMON_ALIASES.has(cleaned)) return 'common';

  if (cleaned.includes('盟军') || cleaned.startsWith('allied')) return 'allied';
  if (cleaned.includes('苏联') || cleaned.includes('苏军') || cleaned.includes('苏维埃')) {
    return 'soviet';
  }
  if (cleaned.includes('尤里') || cleaned.includes('心灵')) return 'yuri';

  return cleaned;
}

/**
 * 按 ID、标准中文名或常见别名查找副官专长 Buff 预设。
 */
export function resolveAdjutantBuffPreset(idOrName: string): AdjutantBuffPreset | undefined {
  if (typeof idOrName !== 'string') return undefined;
  const query = idOrName.trim();
  if (!query) return undefined;
  const lower = query.toLowerCase();

  for (const preset of ADJUTANT_BUFF_PRESET_ITEMS) {
    if (preset.id.toLowerCase() === lower || preset.name === query) {
      return preset;
    }
    if (preset.aliases.some((alias) => alias.toLowerCase() === lower)) {
      return preset;
    }
  }

  for (const preset of ADJUTANT_BUFF_PRESET_ITEMS) {
    if (
      preset.name.includes(query) ||
      query.includes(preset.name) ||
      preset.aliases.some((alias) => query.includes(alias) || alias.includes(query))
    ) {
      return preset;
    }
  }

  return undefined;
}

/**
 * 按 ID、标准中文名或别名查找阵营磨合代价预设。
 * 可选提供 `factionHint` 辅助筛选或回退。
 */
export function resolveFactionPenaltyPreset(
  idOrName: string,
  factionHint?: string,
): FactionPenaltyPreset | undefined {
  const normalizedFaction = factionHint ? normalizeFactionId(factionHint) : '';
  const query = typeof idOrName === 'string' ? idOrName.trim() : '';
  const lower = query.toLowerCase();

  if (query && lower !== 'default' && query !== '默认') {
    const exactCandidates = FACTION_PENALTY_PRESET_ITEMS.filter(
      (p) =>
        p.id.toLowerCase() === lower ||
        p.name === query ||
        p.aliases.some((alias) => alias.toLowerCase() === lower),
    );
    if (exactCandidates.length > 0) {
      if (normalizedFaction) {
        const factionMatched = exactCandidates.find((p) => p.faction === normalizedFaction);
        if (factionMatched) return factionMatched;
      }
      return exactCandidates[0];
    }

    const fuzzyCandidates = FACTION_PENALTY_PRESET_ITEMS.filter(
      (p) =>
        p.name.includes(query) ||
        query.includes(p.name) ||
        p.aliases.some((alias) => query.includes(alias) || alias.includes(query)),
    );
    if (fuzzyCandidates.length > 0) {
      if (normalizedFaction) {
        const factionMatched = fuzzyCandidates.find((p) => p.faction === normalizedFaction);
        if (factionMatched) return factionMatched;
      }
      return fuzzyCandidates[0];
    }

    return undefined;
  }

  if (
    normalizedFaction === 'allied' ||
    normalizedFaction === 'soviet' ||
    normalizedFaction === 'yuri'
  ) {
    const starter = FACTION_STARTER_MCV_MAP[normalizedFaction];
    return FACTION_PENALTY_PRESET_MAP[starter.defaultPenaltyId];
  }

  return undefined;
}

/**
 * 按阵营 ID/名称（或首发 MCV 机娘名/载具名）解析首发 MCV 机娘信息。
 */
export function resolveStarterMcvInfo(factionIdOrName: string): StarterMcvInfo | undefined {
  if (typeof factionIdOrName !== 'string') return undefined;
  const raw = factionIdOrName.trim();
  if (!raw) return undefined;

  const normalized = normalizeFactionId(raw);
  if (
    normalized === 'allied' ||
    normalized === 'soviet' ||
    normalized === 'yuri'
  ) {
    return FACTION_STARTER_MCV_MAP[normalized];
  }

  for (const info of Object.values(FACTION_STARTER_MCV_MAP)) {
    if (
      info.girlName === raw ||
      info.vehicleName === raw ||
      info.callsign.toLowerCase() === raw.toLowerCase() ||
      info.unitSerial.toLowerCase() === raw.toLowerCase() ||
      info.aliases?.some(alias => alias.toLowerCase() === raw.toLowerCase())
    ) {
      return info;
    }
  }

  return undefined;
}

/** 通信/雷达中枢建筑白名单（任意在场运转即提供 +1 参谋槽位） */
export const RADAR_COMM_HUB_BUILDINGS: ReadonlySet<string> = new Set([
  '雷达站',
  '空军指挥部',
  '模块化网电作战枢纽',
  '苏联雷达站',
]);

/** 高阶指挥/科研建筑白名单（每类在场运转提供 +1 参谋槽位） */
export const HIGH_TIER_COMMAND_TECH_BUILDINGS: ReadonlySet<string> = new Set([
  '战斗实验室',
  '盟军战斗实验室',
  '苏联战斗实验室',
  '红星实验设计局综合体',
  '国家战略工程综合体',
  '盟军联合科研与国家工程组织节点',
  '联合指挥中枢',
]);

const INACTIVE_BUILDING_STATES: ReadonlySet<string> = new Set([
  '损毁',
  '被毁',
  '摧毁',
  '瘫痪',
  '停机',
  '离线',
  '建造中',
  '施工中',
  '升级中',
  '展开中',
  '收起中',
  '废弃',
  'damaged',
  'destroyed',
  'offline',
  'suspended',
  'disabled',
]);

function isBuildingOperational(state?: string): boolean {
  if (typeof state !== 'string') return true;
  const trimmed = state.trim();
  if (!trimmed) return true;
  return !INACTIVE_BUILDING_STATES.has(trimmed.toLowerCase()) && !INACTIVE_BUILDING_STATES.has(trimmed);
}

/**
 * 计算参谋部随行参谋槽位上限（`role = 'staff'`）：
 * - 基础为 1
 * - 任意非废弃基地存在运转中的通信/雷达中枢（雷达站 / 空军指挥部 / 模块化网电作战枢纽 / 苏联雷达站）+1
 * - 存在运转中的高阶指挥/科研建筑（7 类白名单）每类 +1
 * - 总上限封顶 4（`Math.min(4, Math.max(1, cap))`）
 */
export function deriveStaffSlotCap(state: {
  bases?: ReadonlyArray<{
    status?: string;
    buildings?: ReadonlyArray<{ name?: string; state?: string }>;
  }>;
}): number {
  let cap = 1;
  if (!state || !Array.isArray(state.bases)) {
    return cap;
  }

  let hasRadarHub = false;
  const activeHighTierCategories = new Set<string>();

  for (const base of state.bases) {
    if (!base || base.status?.trim() === '废弃') continue;
    if (!Array.isArray(base.buildings)) continue;

    for (const building of base.buildings) {
      if (!building || typeof building.name !== 'string') continue;
      const bName = building.name.trim();
      if (!bName || !isBuildingOperational(building.state)) continue;

      if (RADAR_COMM_HUB_BUILDINGS.has(bName)) {
        hasRadarHub = true;
      }
      if (HIGH_TIER_COMMAND_TECH_BUILDINGS.has(bName)) {
        activeHighTierCategories.add(bName);
      }
    }
  }

  if (hasRadarHub) {
    cap += 1;
  }
  cap += activeHighTierCategories.size;

  return Math.min(4, Math.max(1, cap));
}
