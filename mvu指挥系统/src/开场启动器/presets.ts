/**
 * 阶段 F + CMD-LAUNCH-01 · 向导纯数据层（零宿主依赖，可 vitest 直测）
 *
 * 所有可调参数收敛于此：难度参数包 / 部署地点 / 1~3 阵营多选 / 副官配置 / 叙事基调 / 默认选择。
 * UI 与组装线（pipeline.ts）只消费，不自带魔法数字。
 */
import {
  ADJUTANT_BUFF_PRESETS,
  FACTION_PENALTY_PRESETS,
  FACTION_STARTER_MCV_MAP,
  HUMAN_ADJUTANT_DAILY_UPKEEP,
  normalizeFactionId,
  resolveAdjutantBuffPreset,
  resolveFactionPenaltyPreset,
  resolveStarterMcvInfo,
} from '../红警指挥系统/core/commandPresets';
import type { FactionBreakInPenalty, Schema } from '../红警指挥系统/core/schema';
import { getWorldManifest } from './worlds';

export {
  ADJUTANT_BUFF_PRESETS,
  FACTION_PENALTY_PRESETS,
  FACTION_STARTER_MCV_MAP,
  HUMAN_ADJUTANT_DAILY_UPKEEP,
  normalizeFactionId,
  resolveAdjutantBuffPreset,
  resolveFactionPenaltyPreset,
  resolveStarterMcvInfo,
};

/**
 * 默认赠送科技单点常量（catalog.ts 真名：化石燃料发电学）。
 * 备选：风光发电学 / 电力储能学——驾驶员验收时可能改档，保持单点替换。
 */
export const POWER_TECH = '化石燃料发电学';

/**
 * 静态兜底 T1 科技名录（当宿主世界书尚未挂载或离线预览时，供 Step2 轻松档自选与自定义档多选回退使用）
 */
export const FALLBACK_T1_TECH_NAMES: readonly string[] = [
  '化石燃料发电学',
  '风光发电学',
  '电力储能学',
  '基础工业工程学',
  '矿石精炼学',
  '基础环境工程学',
  '生活污水处理工学',
  '饮用水净化工学',
  '公共环卫工程学',
  '生态绿化工程学',
  '基础步兵训练学',
  '轻武器制造学',
  '装甲载具工学',
  '航空工学基础',
  '船舶工学基础',
  '纳米精密合成学',
  '战地医疗保障学',
  '基础雷达通信学',
];

/** 默认世界与既有修真开局日期（保持阶段 F 单测默认签名兼容） */
export const DEFAULT_WORLD_ID = 'xiuzhen';
export const DEFAULT_DATE = '秋·九月初一';

/** 启动器 UI 首选推荐具象世界与默认纪年（2042 血色拓荒期） */
export const RECOMMENDED_WORLD_ID = 'cyber2077';
export const DEFAULT_CYBER2077_DATE = '2042-06-15';
export const DEFAULT_CYBER2077_ERA_ID = '2042';

/** 开局载具（单选盟军基线；MCV 是展开叙事的锚点） */
export const STARTING_VEHICLES = ['MCV（盟军）'];

// ─────────────────────────────── 难度 ───────────────────────────────

export type PresetId = 'easy' | 'normal' | 'hard' | 'custom';

export interface DifficultyPreset {
  id: PresetId;
  label: string;
  credits: number;
  techDone: string[];
  exposure: number;
  /** 给 AI 的难度叙事种子（custom 默认空，全量可调） */
  narrativeSeed: string;
}

export const DIFFICULTY_PRESETS: DifficultyPreset[] = [
  {
    id: 'easy',
    label: '轻松',
    credits: 3000,
    techDone: [POWER_TECH], // UI 另给一项自选 T1（easyBonusTech）
    exposure: 0,
    narrativeSeed: '资源充裕，威胁保守',
  },
  {
    id: 'normal',
    label: '标准',
    credits: 2000,
    techDone: [POWER_TECH],
    exposure: 0,
    narrativeSeed: '标准态势',
  },
  {
    id: 'hard',
    label: '困难',
    credits: 1200,
    techDone: [],
    exposure: 0,
    narrativeSeed: '资源紧张，敌情主动，AI 不应放水',
  },
  {
    id: 'custom',
    label: '自定义',
    credits: 2000,
    techDone: [],
    exposure: 0,
    narrativeSeed: '',
  },
];

export function findPreset(id: string): DifficultyPreset {
  return DIFFICULTY_PRESETS.find(p => p.id === id) ?? DIFFICULTY_PRESETS[1];
}

// ─────────────────────────────── 地点与纪年预设 ───────────────────────────────

export interface LocationDef {
  id: string;
  name: string;
  location: string;
  flavor: string;
  /** 全球战区分类标签（供 UI 分组筛选） */
  region?: string;
  /** 空间密度/战术特征短标签 */
  densityTag?: string;
  /** 是否为该世界推荐首选落点 */
  recommended?: boolean;
  /** 是否为玩家自由输入自定义地点槽位 */
  isCustom?: boolean;
}

export interface EraPresetDef {
  id: string;
  year: number;
  label: string;
  shortTag: string;
  defaultDate: string;
  recommended?: boolean;
  summary: string;
  /** 拼入首楼发射报文的时代态势锚点指令 */
  directive: string;
}

export const CYBER2077_ERA_PRESETS: EraPresetDef[] = [
  {
    id: '2042',
    year: 2042,
    label: '2042 · 血色拓荒与静默渗透',
    shortTag: '默认推荐 · 黄金窗口',
    defaultDate: '2042-06-15',
    recommended: true,
    summary:
      '第四次企业战争停火第17年。大谎言尚未揭穿（2045），网络监察黑墙尚未上线（2044），荒坂被逐回日本本土且在北美无合法据点，西澳与中东正值权力真空，是重工基地隐蔽扎根的黄金窗口期。',
    directive:
      '【时代态势锚点·2042血色拓荒期】当前历史锚定于2042年：第四次企业战争停火已17年，夜之城核爆真凶的“大谎言”尚未被揭穿（将于2045年曝光），网络监察（NetWatch）的“黑墙（Blackwall）”工程仍在秘密筹建而未上线（将于2044年筑起）。此时荒坂已被逐回日本本土、在北美无合法据点，新美利坚（NUSA）2069年统一战争与2077年荒坂重临均属尚未发生的遥远未来；全球正处于供应链断代、地方势力割据与重工力量隐蔽拓荒的黄金窗口期。',
  },
  {
    id: '2045',
    year: 2045,
    label: '2045 · 血色纪元基准（Time of the Red）',
    shortTag: 'RED 正史基准',
    defaultDate: '2045-03-20',
    summary:
      'Cyberpunk RED 正史基准年。竹村揭穿核爆大谎言引爆舆论，黑墙初步筑起，夜之城核坑清理与沃森开发区全面动工，多国与巨型企业处于冷战对峙与代理人暗战。',
    directive:
      '【时代态势锚点·2045血色纪元基准】当前历史锚定于2045年（Time of the Red）：核爆“大谎言”刚刚曝光引爆全球舆论，网络监察“黑墙”初成，夜之城核坑清理与沃森开发区全面动工；各大巨型企业与主权国家正处于冷战对峙与代理人暗战阶段，2069年统一战争与2077年寡头终局尚未发生。',
  },
  {
    id: '2069',
    year: 2069,
    label: '2069 · 统一战争前夜（金属风暴）',
    shortTag: '正规军大战',
    defaultDate: '2069-09-01',
    summary:
      '新美利坚（NUSA）总统迈尔斯向自由州下达最后通牒，军用科技装甲集群南下，北加州与夜之城进入全面战备，荒坂海外舰队伺机重返北美，全球代理人战争一触即发。',
    directive:
      '【时代态势锚点·2069统一战争前夜】当前历史锚定于2069年（金属风暴前夕）：新美利坚（NUSA）总统迈尔斯已向自由州下达最后通牒，军用科技重装集群大举南下，荒坂正借北加州防务空虚伺机重返北美，全球各大战区与航道全面进入高强度战备与情报戒严状态。',
  },
  {
    id: '2077',
    year: 2077,
    label: '2077 · 暗黑未来（荒坂重临）',
    shortTag: '2077 终局高压',
    defaultDate: '2077-04-01',
    summary:
      '荒坂超级航母停泊科罗纳多湾，企业广场巨塔耸立，太平洲彻底沦为法外战区，巨型企业寡头垄断与天网监控达到顶峰，第五次企业战争阴云密布。',
    directive:
      '【时代态势锚点·2077暗黑未来】当前历史锚定于2077年：统一战争早已落幕，荒坂超级航母已停泊科罗纳多湾并重掌夜之城霸权，企业广场巨塔耸立、太平洲彻底沦为法外战区；巨型企业寡头垄断、黑墙高压封锁与轨道天网监控已达顶峰，第五次企业战争一触即发。',
  },
];

const WORLD_ERA_PRESETS: Record<string, EraPresetDef[]> = {
  cyber2077: CYBER2077_ERA_PRESETS,
};

export function eraPresetsForWorld(worldId: string): EraPresetDef[] {
  return WORLD_ERA_PRESETS[worldId] ?? [];
}

export function findEraPreset(eraId: string, worldId = RECOMMENDED_WORLD_ID): EraPresetDef | undefined {
  const list = eraPresetsForWorld(worldId);
  if (list.length === 0) return undefined;
  return list.find(item => item.id === eraId) ?? list[0];
}

export function resolveEraDirectiveForChoices(
  choices: Pick<LaunchChoices, 'worldId' | 'date' | 'eraPresetId'>,
): string {
  if (choices.worldId !== 'cyber2077') return '';
  const dateStr = (choices.date ?? '').trim();
  const yearMatch = /^(\d{4})\b/.exec(dateStr);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    if (year <= 2043) return CYBER2077_ERA_PRESETS[0].directive;
    if (year <= 2059) return CYBER2077_ERA_PRESETS[1].directive;
    if (year <= 2072) return CYBER2077_ERA_PRESETS[2].directive;
    return CYBER2077_ERA_PRESETS[3].directive;
  }
  const preset = findEraPreset(choices.eraPresetId || DEFAULT_CYBER2077_ERA_ID, 'cyber2077');
  return preset?.directive ?? '';
}

export const LOCATIONS: LocationDef[] = [
  {
    id: 'beipo',
    name: '北坡主基地',
    location: '青岚山北坡',
    region: '东域·青岚山脉',
    densityTag: '深山隐蔽',
    recommended: true,
    flavor: '三面环山，天然屏障，工程兵的最爱',
  },
  {
    id: 'yunxi',
    name: '云溪基地',
    location: '云溪谷地',
    region: '东域·水网谷地',
    densityTag: '水网潜伏',
    flavor: '水网密布，隐蔽性佳，补给线脆弱',
  },
];

export const CYBER2077_LOCATIONS: LocationDef[] = [
  {
    id: 'badlands_deep',
    name: '恶土深处前哨',
    location: '恶土·落基岭与红峰荒原',
    region: '北美·夜之城圈',
    densityTag: 'D4–D5 极疏废土',
    recommended: true,
    flavor: '远离城市天网与企业卫队，废弃矿道、地热裂缝与走私公路交错，阿德卡多与乱刀会游弋其间，最宜重型 MCV 隐蔽展开与初期工业爬坡',
  },
  {
    id: 'west_australia',
    name: '西澳皮尔巴拉基地',
    location: '西澳大利亚·珀斯外围与皮尔巴拉矿带',
    region: '大洋洲·西澳前线',
    densityTag: '荒坂海外命脉',
    flavor: '荒坂与印尼扶持的分离主义矿业共和国腹地，坐拥巨型露天铁矿、稀土矿脉与大陆架油田；在此扎根即正面截断荒坂重返全球的南半球输血管',
  },
  {
    id: 'mideast_meltdown',
    name: '海湾辐射油田基地',
    location: '中东·核熔毁废土与波斯湾油田',
    region: '中东·核熔毁区',
    densityTag: '法外核废土',
    flavor: '1997 大熔毁留下的放射性玻璃化荒漠，旧政权与市政天网彻底蒸发；地下封存巨量未枯竭黑金与战前军火掩体，苏油与军用科技武装勘探团在此混战',
  },
  {
    id: 'nc_combat_zone',
    name: '圣多明哥重工掩体',
    location: '夜之城·老战区与圣多明哥工业带',
    region: '北美·夜之城圈',
    densityTag: 'D2–D3 工业废墟',
    flavor: '紧邻破产制造厂、排污暗渠与高压变电站，供应链与黑市收尾人触手可及，但随时面临六街帮、旋涡帮与企业无人机的近距离窥探',
  },
  {
    id: 'pacifica_coast',
    name: '科罗纳多南岸船坞',
    location: '太平洲·德尔科罗纳多湾废弃船坞',
    region: '北美·夜之城圈',
    densityTag: 'D2–D3 海陆双栖',
    flavor: '烂尾度假巨构与废弃深水干船坞构成天然钢筋掩体，便于秘密建造潜艇、气垫船与反AI水雷声呐阵，与海地难民社群及巫毒帮隔街相望',
  },
  {
    id: 'siberia_frontier',
    name: '远东宽轨冻土基地',
    location: '新苏维埃·西伯利亚与远东重工冻土带',
    region: '欧亚·新苏维埃与欧洲',
    densityTag: '极寒重工腹地',
    flavor: '1520毫米宽轨装甲铁路穿越漫长极夜，深井重金属矿场、冷战废弃导弹发射井与苏油（SovOil）能源管线密布，天然契合重工业集群扩建',
  },
  {
    id: 'east_asia_ghost_sea',
    name: '香港封锁线外缘哨站',
    location: '东亚·香港隔离鬼城外围与环西太航道',
    region: '东亚·企业与死城带',
    densityTag: '生化隔离/高算力',
    flavor: '毗邻四战生化袭击后彻底封锁的香港无人鬼城（奥特AI鬼域所在地）与南海航道，背靠中国工业复兴带与康陶、荒坂的东亚情报暗战前线',
  },
  {
    id: 'south_asia_monsoon',
    name: '新孟买与马六甲前哨',
    location: '南亚与东南亚·新孟买外海与马六甲群岛',
    region: '南亚与东南亚',
    densityTag: '生物代工/私掠海峡',
    flavor: '一面是印度次大陆高密度生物工程、廉价神经芯片代工走廊与季风洪泛区，一面是菲律宾与马六甲群岛破碎的油田航道与私掠海盗船团',
  },
  {
    id: 'africa_kilimanjaro',
    name: '东非裂谷空天外围基地',
    location: '非洲·乞力马扎罗天梯外围与东非大裂谷',
    region: '非洲·赤道空天门户',
    densityTag: '轨道电梯外围/稀土',
    flavor: '位于泛非联盟与内罗毕轨道航空（Orbital Air）赤道发射场外围的裂谷稀土矿带，头顶高骑者天基动能防御网，是介入地表至近地轨道太空经济的战略跳板',
  },
  {
    id: 'latam_panama_amazon',
    name: '巴拿马与亚马逊雨林掩体',
    location: '中美洲与南美·巴拿马运河交火带与亚马逊林区',
    region: '中美洲与南美洲',
    densityTag: '丛林游击/基因林区',
    flavor: '北接美军死守的巴拿马运河游击战区与中美洲联邦，南连美洲国家组织（OAS）腹地及生化技术（Biotechnica）在亚马逊深处封闭的基因再造林试验区',
  },
  {
    id: 'polar_antarctica_arctic',
    name: '极地解冻矿谷与冰海平台',
    location: '南极洲与北极圈·南极解冻工业谷地与北冰洋航道',
    region: '南北两极·极地边疆',
    densityTag: '法外极地/深海可燃冰',
    flavor: '温室效应消融冰盖后裸露的南极无冰矿谷与北极高纬航道，遍布深层稀土钻井、可燃冰平台与跨国企业规避监管的极地黑科技实验室',
  },
  {
    id: 'custom',
    name: '自定义部署点',
    location: '（指挥官自主勘定战区）',
    region: '自定义战区',
    densityTag: '自由定义',
    isCustom: true,
    flavor: '自由输入基地代号、所在的全球城市/荒原坐标与周边环境特征，直接写入初始基地档案与首楼发射指令',
  },
];

const WORLD_LOCATIONS: Record<string, LocationDef[]> = {
  cyber2077: CYBER2077_LOCATIONS,
  xiuzhen: LOCATIONS,
  cyber2042: [
    {
      id: 'cyber-entry',
      name: '待侦知部署点',
      location: '（自创城市·首铺时定）',
      region: '自创赛博都市',
      densityTag: '待侦察',
      recommended: true,
      flavor: '城市、行政区与企业归属尚未侦知，首轮侦察后再落名',
    },
  ],
};

export function locationsForWorld(worldId: string): LocationDef[] {
  return WORLD_LOCATIONS[worldId] ?? [];
}

export function defaultDateForWorld(worldId: string): string {
  if (worldId === DEFAULT_WORLD_ID) return DEFAULT_DATE;
  return getWorldManifest(worldId)?.calendar.sample ?? '';
}

export function findLocation(id: string, worldId = DEFAULT_WORLD_ID): LocationDef {
  const locations = locationsForWorld(worldId);
  const location = locations.find(item => item.id === id) ?? locations[0];
  if (!location) throw new Error(`世界「${worldId || '空'}」没有可用部署地点`);
  return location;
}

export function formatLocationLabel(location: LocationDef): string {
  const detail = location.location.trim();
  return detail.startsWith('（') && detail.endsWith('）') ? `${location.name}${detail}` : `${location.name}（${detail}）`;
}

// ─────────────────────────────── 阵营 ───────────────────────────────

export interface FactionOption {
  id: string;
  name: string;
  available: boolean;
  /** 不可用或补充说明文案 */
  note: string;
  flavor: string;
}

export const FACTION_OPTIONS: FactionOption[] = [
  { id: 'allied', name: '盟军', available: true, note: '', flavor: '纳米核心与联合科技树，本次穿越的既定载体' },
  { id: 'soviet', name: '苏联', available: true, note: '', flavor: '1520宽轨重工、磁暴电网与钢铁洪流' },
  { id: 'yuri', name: '尤里', available: true, note: '扩展阵营', flavor: '心灵科技与基因工程实验体系（第三阵营扩展）' },
];

export function findFaction(id: string): FactionOption {
  const normalized = id === 'third' ? 'yuri' : normalizeFactionId(id);
  return FACTION_OPTIONS.find(f => f.id === normalized || f.id === id) ?? FACTION_OPTIONS[0];
}

// ─────────────────────────────── 副官与多阵营开局代价 ───────────────────────────────

export interface FactionAdjutantConfig {
  identity: 'mcv_girl' | 'human' | 'commander_self';
  name?: string;
  title?: string;
  buffPreset?: string;
  penaltyPreset?: string;
}

export interface StaffAdjutantConfig {
  enabled: boolean;
  name: string;
  title: string;
  buffPreset: string;
}

export type FactionAdjutantChoice = FactionAdjutantConfig;

/**
 * 随行己方人类渊源类型（决定该角色因何与指挥官一同出现在开局现场）：
 * - 'veteran_retinue'   : 跨界旧部（原世界便追随指挥官的心腹参谋/军官，随 MCV 一同跨界）
 * - 'co_transmigrator'  : 意外同穿（穿越裂变时一并被卷入车舱的原世界同伴/熟人/搭档）
 * - 'hq_special_envoy'  : 统帅部特派（最高统帅部随首发基地车编制配属的前线专家）
 * - 'local_operative'   : 本土接应（目标世界本土潜伏的线人、向导、佣兵或地方合作者）
 */
export type HumanOriginKind =
  | 'veteran_retinue'
  | 'co_transmigrator'
  | 'hq_special_envoy'
  | 'local_operative';

export interface HumanOriginOption {
  id: HumanOriginKind;
  label: string;
  shortTag: string;
  desc: string;
}

export const HUMAN_ORIGIN_OPTIONS: HumanOriginOption[] = [
  {
    id: 'veteran_retinue',
    label: '跨界心腹旧部',
    shortTag: '旧部随行',
    desc: '原世界便追随指挥官左右的心腹参谋或卫队军官，与指挥官默契深厚，随 MCV 一同跨界降临。',
  },
  {
    id: 'hq_special_envoy',
    label: '统帅部特派专员',
    shortTag: '总部配属',
    desc: '最高统帅部随首发移动基地车编制特批配属的前线工程、情报或重工专家。',
  },
  {
    id: 'co_transmigrator',
    label: '意外同穿同伴',
    shortTag: '同穿搭档',
    desc: '位面帷幕裂变时恰好在指挥官身边、被一并卷入跨界投射的原世界同伴或故交。',
  },
  {
    id: 'local_operative',
    label: '异世本土接应人',
    shortTag: '本土向导',
    desc: '目标世界本土出身的潜伏线人、自由佣兵、落魄学者或地方接应者，熟悉当地势力与生存法则。',
  },
];

export function findHumanOrigin(id?: string): HumanOriginOption {
  return HUMAN_ORIGIN_OPTIONS.find(o => o.id === id) ?? HUMAN_ORIGIN_OPTIONS[0];
}

/**
 * 开场随行己方人类立体人物档案（先确认开场有哪些己方人类登场，再从中点将任命副官/参谋）：
 * - assignment === ''            -> 仅作为随行己方核心同伴登场（写入 codex 人员档案与开场报文，不占副官槽、0 日薪）
 * - assignment === 'staff'       -> 委任为联席参谋部专职参谋（80/日）
 * - assignment === 'faction:xxx' -> 委任为对应阵营（allied/soviet/yuri）主责副官（80/日）
 */
export interface HumanRosterMember {
  id: string;
  name: string;
  /** 代号 / 雅号（可选，如“冷面算盘”“钢铁老爹”） */
  callsign?: string;
  title: string;
  faction: string;
  /** 随行渊源（旧部 / 总部特派 / 意外同穿 / 本土接应） */
  origin?: HumanOriginKind;
  /** 外貌与着装特征（眉眼神态、制服/便装、义体或随身标志物） */
  appearance?: string;
  /** 性格脾气、行事作风与对指挥官的说话口吻 */
  personality?: string;
  buffPreset: string;
  /** 过往履历、专业绝活与个人执念 */
  bio: string;
  assignment: string;
}

export interface HumanCompanionPreset {
  id: string;
  name: string;
  callsign: string;
  title: string;
  faction: string;
  origin: HumanOriginKind;
  appearance: string;
  personality: string;
  buffPreset: string;
  bio: string;
  tag: string;
}

export const HUMAN_COMPANION_PRESETS: HumanCompanionPreset[] = [
  {
    id: 'comp_lin_logistics',
    name: '顾清弦（林参谋）',
    callsign: '冷面算盘',
    title: '战区后勤精算主任',
    faction: 'common',
    origin: 'veteran_retinue',
    appearance:
      '鼻梁上架着银丝半框眼镜，深灰色贴身参谋制服永远熨烫得没有一丝褶皱；袖口别着一支旧式钢笔，怀里常年抱着加密电子账本与便携终端。',
    personality:
      '外表冷静克制、言辞犀利毒舌，对任何铺张浪费与盲目冒进零容忍；汇报时习惯先报精确到小数点的战损比与能耗账单，私下却极度护短，总会默默替指挥官备好热茶与兜底退路。',
    buffPreset: 'logistics_actuary',
    bio: '原总参后勤精算处王牌参谋，擅长在极端匮乏条件下完成物资调配、产线排期与供应链成本压缩，是指挥官最信赖的“大管家”。',
    tag: '冷面后勤精算',
  },
  {
    id: 'comp_valery_heavy',
    name: '瓦列里·科尔萨科夫',
    callsign: '钢铁老爹',
    title: '重工总督造',
    faction: 'soviet',
    origin: 'hq_special_envoy',
    appearance:
      '满脸浓密络腮胡与旧火药灼痕的魁梧老军工，常年披着沾满机油味的防寒皮大衣，左臂改装了大扭矩重型液压辅助义肢，腰间挂着沉甸甸的合金扳手与军用水壶。',
    personality:
      '嗓门洪亮、豪爽护犊子，把每一台下线的重型坦克与履带底盘都当亲闺女疼；说话带着浓重的工场糙劲与冷幽默，最痛恨花里胡哨的纸面推演，最爱听高炉与柴油机满负荷轰鸣。',
    buffPreset: 'heavy_industry_drive',
    bio: '第47重型机械设计局出身的功勋总督造，精通1520宽轨重工、大口径火炮锻造与战地装甲抢修，主动请缨随首发基地车前出拓荒。',
    tag: '豪爽重工老将',
  },
  {
    id: 'comp_eileen_intel',
    name: '艾琳·温特斯',
    callsign: '夜枭',
    title: '战地战术情报官',
    faction: 'allied',
    origin: 'hq_special_envoy',
    appearance:
      '利落的浅金短发下戴着单侧战术降噪耳机，颈侧嵌有军规级高频神经接口，身穿深色轻便潜行夹克，修长指尖总在漫不经心地翻转一枚改装加密芯片。',
    personality:
      '敏锐机警又带着几分玩世不恭的黑色幽默，越是险象环生的潜入局面越显得游刃有余；喜欢用截获的敌方高层八卦调侃紧绷的会议气氛，但在频谱静默与反侦察红线上寸步不让。',
    buffPreset: 'counter_intel_veil',
    bio: '前特种电子战大队首席情报分析官，精通全频段监听、光学伪装网调校与假情报诱饵布设，负责为初抵异界的基地车织就第一层隐形帷幕。',
    tag: '毒舌电战特工',
  },
  {
    id: 'comp_chen_grid',
    name: '陆景行',
    callsign: '反应堆牧羊人',
    title: '首席高压电网总工',
    faction: 'allied',
    origin: 'co_transmigrator',
    appearance:
      '身形清瘦、眼下挂着淡淡黑眼圈的青年总工程师，宽松的工装防电弧马甲口袋里永远塞满万用探针、绝缘胶带与咖啡因能量棒，发梢偶尔会因静电微微翘起。',
    personality:
      '平时性子温和散漫、说话慢条斯理，像个没睡醒的理工科师兄；可一旦聊起地下掩体选址、反应堆超频并网与极端地形供电，整个人就会瞬间两眼放光、滔滔不绝。',
    buffPreset: 'grid_harmonic_tuning',
    bio: '特种能源与地下防护工程双料专家，在位面裂变时正于主控舱调试高能电容而一同跨界，能在废土断壁或极寒冻土中徒手拉起整套高冗余电网。',
    tag: '散漫电网狂人',
  },
  {
    id: 'comp_molotov_lab',
    name: '叶琳娜·莫洛托娃',
    callsign: '深渊学者',
    title: '特种实验物理主任',
    faction: 'yuri',
    origin: 'hq_special_envoy',
    appearance:
      '苍白冷艳的黑长发女学者，一袭特制防辐射白大褂下衬着贴身黑色高领作战服，无框镜片后是一双总是微微眯起、仿佛能看穿高维能量波纹的异色瞳。',
    personality:
      '优雅、礼貌却透着一丝令人脊背发凉的狂热求知欲；说话轻柔似耳语，面对异界未知的超凡灵气或赛博义体黑科技时，第一反应永远是微笑着申请“抓个活体样本回来拆解”。',
    buffPreset: 'psionic_resonance_lab',
    bio: '前沿高能物理与神经突触接口领域的天才学者，因实验理念过于激进被调往跨界拓荒前线，致力于将异界本土技术解析并逆向并入红警科研树。',
    tag: '狂热黑科技学者',
  },
];

/**
 * 将「随行己方人类名册（humanRoster）」中的职务任命同步至 factionAdjutants 与 staffAdjutant，
 * 保证「先加人 → 后任命副官/参谋」与底层发射管线 100% 同步。
 */
export function syncAdjutantsFromHumanRoster(choices: LaunchChoices): void {
  const roster = choices.humanRoster ?? [];
  const selected = resolveSelectedFactions(choices);
  if (!choices.factionAdjutants) {
    choices.factionAdjutants = {};
  }

  for (const fid of selected) {
    if (!choices.factionAdjutants[fid]) {
      choices.factionAdjutants[fid] = defaultFactionAdjutantFor(fid);
    }
    const assignedHuman = roster.find(m => m.assignment === `faction:${fid}` && m.name.trim());
    if (assignedHuman) {
      choices.factionAdjutants[fid].identity = 'human';
      choices.factionAdjutants[fid].name = assignedHuman.name.trim();
      choices.factionAdjutants[fid].title = assignedHuman.title.trim() || `${findFaction(fid).name}首席副官`;
      choices.factionAdjutants[fid].buffPreset = assignedHuman.buffPreset || 'logistics_actuary';
    } else if (choices.factionAdjutants[fid].identity === 'human') {
      // 若此前是人类副官但名册中已取消指派或移除，回退为首发 MCV 机娘兼任
      const starter = resolveStarterMcvInfo(fid);
      choices.factionAdjutants[fid].identity = 'mcv_girl';
      choices.factionAdjutants[fid].name = starter?.girlName ?? '白凌';
      choices.factionAdjutants[fid].title = starter?.girlDuty ?? 'MCV移动基地车核心';
      choices.factionAdjutants[fid].buffPreset = starter?.defaultBuffPreset ?? 'grid_harmonic_tuning';
    }
  }

  const assignedStaff = roster.find(m => m.assignment === 'staff' && m.name.trim());
  if (assignedStaff) {
    choices.staffAdjutant = {
      enabled: true,
      name: assignedStaff.name.trim(),
      title: assignedStaff.title.trim() || '战区联席参谋官',
      buffPreset: assignedStaff.buffPreset || 'logistics_actuary',
    };
  } else if (choices.staffAdjutant?.enabled) {
    choices.staffAdjutant.enabled = false;
  }
}

export interface MultiFactionLaunchImpact {
  factionCount: number;
  normalizedFactions: string[];
  creditsMultiplier: number;
  creditMultiplier: number;
  credits: number;
  effectiveCredits: number;
  exposureDelta: number;
  exposure: number;
  effectiveExposure: number;
  breakInPenalties: FactionBreakInPenalty[];
  penalties: FactionBreakInPenalty[];
}

export function defaultFactionAdjutantFor(factionId: string): FactionAdjutantConfig {
  const normalized = normalizeFactionId(factionId) || 'allied';
  const starter = resolveStarterMcvInfo(normalized);
  return {
    identity: 'mcv_girl',
    name: starter?.girlName ?? '白凌',
    title: starter?.girlDuty ?? 'MCV移动基地车核心',
    buffPreset: starter?.defaultBuffPreset ?? 'grid_harmonic_tuning',
    penaltyPreset: starter?.defaultPenaltyId ?? 'pen_common_protocol_lag',
  };
}

/**
 * 归一化向导已选阵营列表（1~3 项，去重保序，主阵营保底 'allied'）。
 * 同时兼容仅改 `choices.factionId` 的旧调用方式。
 */
export function resolveSelectedFactions(
  choicesOrList: Pick<LaunchChoices, 'factionId' | 'selectedFactions'> | readonly string[],
): string[] {
  let rawList: readonly string[];
  if (Array.isArray(choicesOrList)) {
    rawList = choicesOrList;
  } else {
    const ch = choicesOrList as Pick<LaunchChoices, 'factionId' | 'selectedFactions'>;
    const sel = ch.selectedFactions;
    const primaryFromId = normalizeFactionId(ch.factionId || 'allied') || 'allied';
    if (!Array.isArray(sel) || sel.length === 0) {
      rawList = [primaryFromId];
    } else if (sel.length === 1 && sel[0] === 'allied' && primaryFromId !== 'allied') {
      rawList = [primaryFromId];
    } else {
      rawList = sel;
    }
  }

  const deduped: string[] = [];
  for (const item of rawList) {
    const norm = item === 'third' ? 'yuri' : normalizeFactionId(item);
    if (norm && !deduped.includes(norm)) {
      deduped.push(norm);
    }
    if (deduped.length >= 3) break;
  }

  return deduped.length > 0 ? deduped : ['allied'];
}

/**
 * 计算 1~3 阵营并线开局的资金摊薄、暴露度增量与 15 日跨系磨合代价（CMD-LAUNCH-01）：
 * - 1 阵营：资金倍率 1.0、暴露增量 +0、磨合代价 []；
 * - 2 阵营：资金倍率 0.85（Math.round(baseCredits * 0.85)）、暴露增量 +15、第 2 阵营自动附带默认 15 日磨合期代价；
 * - 3 阵营：资金倍率 0.75（Math.round(baseCredits * 0.75)）、暴露增量 +30、第 2/3 阵营各附带 1 项 15 日磨合期代价。
 */
export function computeMultiFactionLaunchImpact(
  selectedFactions: readonly string[],
  baseCredits: number,
  baseExposure: number,
  factionAdjutants?: Record<string, FactionAdjutantConfig>,
): MultiFactionLaunchImpact {
  const normalizedFactions = resolveSelectedFactions(selectedFactions);
  const count = normalizedFactions.length;

  const creditsMultiplier = count >= 3 ? 0.75 : count === 2 ? 0.85 : 1.0;
  const exposureDelta = count >= 3 ? 30 : count === 2 ? 15 : 0;
  const credits = Math.round(baseCredits * creditsMultiplier);
  const exposure = baseExposure + exposureDelta;

  const breakInPenalties: FactionBreakInPenalty[] = [];
  for (let i = 1; i < normalizedFactions.length; i++) {
    const factionId = normalizedFactions[i];
    const customPresetId = factionAdjutants?.[factionId]?.penaltyPreset;
    const preset =
      (customPresetId ? resolveFactionPenaltyPreset(customPresetId, factionId) : undefined) ??
      resolveFactionPenaltyPreset('default', factionId) ??
      FACTION_PENALTY_PRESETS.pen_common_protocol_lag;

    breakInPenalties.push({
      id: preset.id,
      faction: factionId,
      name: preset.name,
      effect_kind: preset.effect_kind,
      magnitude: preset.magnitude,
      total_minutes: preset.total_minutes,
      remaining_minutes: preset.total_minutes,
      reason: preset.reason,
    });
  }

  return {
    factionCount: count,
    normalizedFactions,
    creditsMultiplier,
    creditMultiplier: creditsMultiplier,
    credits,
    effectiveCredits: credits,
    exposureDelta,
    exposure,
    effectiveExposure: exposure,
    breakInPenalties,
    penalties: breakInPenalties,
  };
}

// ─────────────────────────────── 开场切入模式与叙事基调 ───────────────────────────────

export type OpeningEntryMode = 'field_drop' | 'pre_transmigration' | 'dormant_infiltration';

export interface OpeningEntryModeDef {
  id: OpeningEntryMode;
  label: string;
  shortTag: string;
  recommended?: boolean;
  summary: string;
  /** 拼入首楼发射报文的切入模式核心叙事与零预设基地指令 */
  directive: string;
}

export const OPENING_ENTRY_MODES: OpeningEntryModeDef[] = [
  {
    id: 'field_drop',
    label: '战地直降·初抵待命（默认）',
    shortTag: '★ 默认推荐 · 车载待命',
    recommended: true,
    summary:
      '指挥官与移动基地车（MCV）已隐蔽驻泊于拟定战区边缘的临时掩体，目前维持低功耗电磁静默（初始在役基地为 0）。受被动传感器功率与地形遮蔽所限，外围深层矿脉、水源走向与暗哨分布仍处于未勘明的战术迷雾中；首幕完全交由指挥官把控节奏：可先车内整备、派员近距踏勘摸底、机动换址或筹备场地平整。',
    directive:
      '【开场切入模式：战地直降·初抵待命】当前状态：指挥官已携移动基地车（MCV）隐蔽抵近拟定战区边缘的临时掩体，全车维持低功耗电磁与热信号静默，尚未选定最终落桩坐标展开建造厂，战区当前在役基地数为 0（MCV 未展开前，<战况> 中严禁输出 基地: 字段）。受限于车载静默功率，除掩体周遭近距表层地貌外，深层矿脉品位、地基承重极限、冷却水源与外围势力盲区均处于待踏勘的半迷雾状态；首幕严禁替指挥官自动扫清全图或强行拉响战斗警报，须将勘探、整备或选址落桩的节奏决定权完全交予指挥官。',
  },
  {
    id: 'pre_transmigration',
    label: '原世界序章·穿越前夕',
    shortTag: '慢热序章 · 原世界待发',
    summary:
      '严格从指挥官在原世界（穿越尚未发生前的日常或行动筹备现场）切入！默认在正式完成穿越之后才绑定觉醒红警统帅系统与核心机娘（初始在役基地为 0）。首幕绝不快进穿越过程与落地结果，完全由指挥官自主掌控原世界现场行动与正式触发穿越的时机。',
    directive:
      '【开场切入模式：原世界序章·穿越前夕】当前状态：本局严格从指挥官在原世界（穿越真正发生前的最后日常或行动筹备现场）切入！远端目标世界坐标仅处于预设状态，跨界投射尚未启动（MCV 未展开前，<战况> 中严禁输出 基地: 字段）。【阶段硬锁铁律】首幕舞台必须 100% 停留在原世界穿越前夕的现场，只描写原世界当下处境与身边同行人员的真实互动；严禁在首幕一口气进入穿越通道穿梭过程，更严禁直接写出已经降临目标世界后的结果！何时启动穿越、在原世界先做什么准备，完全由指挥官按自身节奏下令推进。',
  },
  {
    id: 'dormant_infiltration',
    label: '异世潜行·待机觉醒',
    shortTag: '本土潜伏 · 待命静默',
    summary:
      '指挥官此前已以本土伪装身份在目标世界底层蛰伏谋生，远端预选掩体内的 MCV 处于隐蔽封存状态（初始在役基地为 0）。首幕停留在指挥官当下的本土潜伏现场，默认须由指挥官亲自发起联系后才唤醒统帅链路与核心机娘，不替玩家强行转场。',
    directive:
      '【开场切入模式：异世潜行·待机觉醒】当前状态：指挥官此前已以本土伪装身份潜伏于目标世界，移动基地车（MCV）隐蔽封存于远端预选掩体，尚未展开为固定基地（MCV 未展开前，<战况> 中严禁输出 基地: 字段）。首幕必须停留在指挥官当前的本土潜伏处境与身边生计环境，严禁在首幕替指挥官擅自转场瞬移至基地车旁，须将后续行程、何时联系基地车与节奏控制权完全交给指挥官。',
  },
];

export function findEntryMode(id?: string): OpeningEntryModeDef {
  return OPENING_ENTRY_MODES.find(m => m.id === id) ?? OPENING_ENTRY_MODES[0];
}

// ─────────────────────────────── 系统觉醒与机娘通联时机 ───────────────────────────────

export type OpeningSystemLinkMode =
  | 'commander_initiate'
  | 'post_transmigration_bind'
  | 'immediate_active';

export interface OpeningSystemLinkModeDef {
  id: OpeningSystemLinkMode;
  label: string;
  shortTag: string;
  recommended?: boolean;
  summary: string;
  /** 拼入首楼发射报文的系统绑定与机娘通联边界硬锁指令 */
  directive: string;
}

export const OPENING_SYSTEM_LINK_MODES: OpeningSystemLinkModeDef[] = [
  {
    id: 'commander_initiate',
    label: '由指挥官亲自联系（默认）',
    shortTag: '★ 默认推荐 · 主动权在手',
    recommended: true,
    summary:
      '系统与基地车虽已在底层静默就绪，但白凌等核心机娘绝不会在开场第一时间主动弹窗或越权向指挥官搭话汇报；必须等指挥官按自身节奏亲自在终端/意识中呼叫或推门踏入主控舱，才首次建立通联。',
    directive:
      '【系统觉醒与机娘通联时机：由指挥官亲自联系】当前状态：最高统帅系统与基地车核心机娘（如白凌等）处于底层被动静默待机态，绝不会在开场第一时间主动弹窗、主动在脑海中叩击或抢先开口向指挥官汇报！何时首次唤醒终端、何时联系核心机娘，100% 由指挥官亲自发起。【被动静默硬锁】在指挥官主动发起呼叫或亲自接入主控台前：1. 正文中严禁核心机娘主动发声或强行弹窗打断指挥官当前的现场节奏；2. 本轮 <态势> 的「参谋建议」优先由身边在场的随行人类同伴以现场视角给出（若无随行人类，则仅作终端静默待机或客观环境记录），严禁尚未被指挥官联系的机娘越权长篇汇报；3. <选项> 中可提供一项“由指挥官亲自接通/呼叫核心机娘建立首次通联”的备选行动，将通联时机完全交由指挥官把控。',
  },
  {
    id: 'post_transmigration_bind',
    label: '穿越/契机后才绑定系统（序章默认）',
    shortTag: '未穿越前默认 · 零系统开局',
    summary:
      '开场时指挥官尚未觉醒、尚未绑定《全域战略指挥系统》，脑海中无任何系统提示，完全不知道基地车与白凌等核心机娘的存在（机娘也无法提前联系主角）；必须等正式完成穿越（或后续触发觉醒契机）之后，系统与机娘才正式绑定激活。',
    directive:
      '【系统觉醒与机娘通联时机：穿越/契机触发后才绑定系统】当前状态：指挥官在开场时尚未绑定、尚未觉醒《全域战略指挥系统》！此时指挥官脑海中没有任何系统提示音、神经视界微光或跨界缓冲舱感知，完全不知道移动基地车（MCV）与白凌等核心机娘的存在，白凌她们也绝对无法跨越位面或提前联系到指挥官。【零系统硬锁】在指挥官后续正式完成跨界穿越（或亲自触发觉醒契机）之前：1. 正文中严禁出现任何脑海系统微光、底层信道涟漪、系统提示音或机娘声音，首幕必须 100% 是纯粹的现场环境与身边人物互动；2. 本轮 <态势> 的「参谋建议」严禁出现白凌、喀秋莎、尤里卡等尚未绑定的核心机娘或系统AI，仅允许由身边在场的随行人类同伴（如有）以当下现场视角提出建议；3. 本轮 <选项> 严禁出现“在意识链路中呼唤白凌/查看系统跨界缓冲舱”等超前选项，所有选项必须 100% 立足于当前现实场景与身边小队的下一步行动！',
  },
  {
    id: 'immediate_active',
    label: '开场即已觉醒并主动通联',
    shortTag: '即刻并网 · 机娘就位',
    summary:
      '开局时最高统帅系统已完成神经绑定，白凌等核心机娘与参谋已在神经链路或主控台前就位，在首幕直接向指挥官呈报初期自检与近距半迷雾态势。',
    directive:
      '【系统觉醒与机娘通联时机：开场即已觉醒并主动通联】当前状态：最高统帅系统已完成神经链路并网，基地车核心机娘与在场参谋已在主控台/加密信道内就位，可在首幕向指挥官呈报初期自检与近距半迷雾态势，静候指挥官下达首道指令。',
  },
];

export function defaultSystemLinkModeForEntry(entryMode?: OpeningEntryMode): OpeningSystemLinkMode {
  return entryMode === 'pre_transmigration' ? 'post_transmigration_bind' : 'commander_initiate';
}

export function resolveSystemLinkMode(
  choices: Pick<LaunchChoices, 'entryMode' | 'systemLinkMode'>,
): OpeningSystemLinkMode {
  if (
    choices.systemLinkMode === 'commander_initiate' ||
    choices.systemLinkMode === 'post_transmigration_bind' ||
    choices.systemLinkMode === 'immediate_active'
  ) {
    return choices.systemLinkMode;
  }
  return defaultSystemLinkModeForEntry(choices.entryMode);
}

export function findSystemLinkMode(
  id?: string,
  entryMode?: OpeningSystemLinkMode | OpeningEntryMode,
): OpeningSystemLinkModeDef {
  const targetId =
    id === 'commander_initiate' || id === 'post_transmigration_bind' || id === 'immediate_active'
      ? id
      : defaultSystemLinkModeForEntry(entryMode as OpeningEntryMode | undefined);
  return OPENING_SYSTEM_LINK_MODES.find(m => m.id === targetId) ?? OPENING_SYSTEM_LINK_MODES[0];
}

// ─────────────────────────────── 机娘孵化与命名模式（方案 B 三档切换） ───────────────────────────────

export type OpeningMaidenIncubationMode =
  | 'iconic_plus_blindbox'
  | 'full_blindbox'
  | 'preset_roster';

export interface OpeningMaidenIncubationModeDef {
  id: OpeningMaidenIncubationMode;
  label: string;
  shortTag: string;
  recommended?: boolean;
  summary: string;
  /** 拼入首楼发射报文的机娘孵化与赐名协议指令 */
  directive: string;
}

export const OPENING_MAIDEN_INCUBATION_MODES: OpeningMaidenIncubationModeDef[] = [
  {
    id: 'iconic_plus_blindbox',
    label: '经典MCV＋战地盲盒赐名（默认）',
    shortTag: '★ 方案 B 推荐 · 经典镇场＋盲盒惊喜',
    recommended: true,
    summary:
      '三大首发 MCV（白凌/喀秋莎/尤里卡）与传奇英雄（谭雅/娜塔莎/尤里X）沿用精修固定真名镇场；其余常规兵种首台机娘解绑固定姓名，严格锁死世界书机械基因、特殊技能与特殊装备，外貌与性格随当场战局自由孵化，出厂先以机体编号/代号报到，由指挥官亲自赐名并原地转正。',
    directive:
      '【机娘孵化与赐名协议：经典MCV＋战地盲盒赐名（方案 B）】1. 首发 MCV（白凌 MCV-A01 / 喀秋莎 MCV-S01 / 尤里卡 MCV-Y01）与传奇特种机娘（谭雅 / 娜塔莎 / 尤里X）保持经典固定真名与精修人设；2. 其余常规兵种首台机娘孵化时，必须严格继承《机娘·能力档案》对应母板 `<数据>` 块中的 `form_mech`、`special_skills`、`special_equipment`、`flaws` 与 `exposure_grade`，但解绑固定姓名，结合当场战局自由生成鲜活外貌与性格细节，初诞先以 `待授名·{出厂编号}` 或战术代号向指挥官报到，待指挥官亲自赐名后通过 `<机娘档案>`（附 `rename_from` 与 `serial`）原地转正覆写！',
  },
  {
    id: 'full_blindbox',
    label: '全员自由盲盒（含MCV）',
    shortTag: '纯粹盲盒 · 全员待授名',
    summary:
      '包括首发 MCV 在内的全部机娘均解绑预设真名，仅保留《机娘·能力档案》中的底层机械基因、特殊技能与特殊装备数据块；初诞一律以出厂编号（如 MCV-A01）报到，真名与人设细节完全交由指挥官在战局中亲自赐名塑造。',
    directive:
      '【机娘孵化与赐名协议：全员自由盲盒（含MCV）】本局所有首台机娘（含首发 MCV）均解绑预设真名，仅锁死《机娘·能力档案》母板 `<数据>` 块中的机械基因、特殊技能与特殊装备；初登场时一律以 `待授名·{出厂编号}`（如 `待授名·MCV-A01`）向指挥官报到，待指挥官亲自赐予真名与代号后再通过 `<机娘档案>` 原地转正！',
  },
  {
    id: 'preset_roster',
    label: '省心预设名册（自动定名）',
    shortTag: '省心直出 · 预设真名入列',
    summary:
      '所有兵种首台机娘直接采用《机娘·能力档案》数据块中的 `preset_name`（如白凌、喀秋莎、尤里卡、柳翠、乔念、秦筑、沈幼宜、顾棠、方宁等预设名册），出厂即以正式姓名与完整档案直接入列，无需手动赐名。',
    directive:
      '【机娘孵化与赐名协议：省心预设名册（自动定名）】本局所有兵种首台机娘在诞生时直接采用《机娘·能力档案》`<数据>` 块中的 `preset_name` 预设真名与完整设定入列，直接输出正式真名的 `<机娘档案>`，无需经历“待授名”等待阶段。',
  },
];

export function resolveMaidenIncubationMode(
  choices?: Pick<LaunchChoices, 'maidenIncubationMode'> | null,
): OpeningMaidenIncubationMode {
  const m = choices?.maidenIncubationMode;
  if (m === 'iconic_plus_blindbox' || m === 'full_blindbox' || m === 'preset_roster') {
    return m;
  }
  return 'iconic_plus_blindbox';
}

export function findMaidenIncubationMode(id?: string): OpeningMaidenIncubationModeDef {
  return (
    OPENING_MAIDEN_INCUBATION_MODES.find(m => m.id === id) ?? OPENING_MAIDEN_INCUBATION_MODES[0]
  );
}

export interface ToneDef {
  id: string;
  label: string;
  /** 直接拼入首条消息的风格指令 */
  instruction: string;
}

export const TONES: ToneDef[] = [
  {
    id: 'military',
    label: '军事简报风（默认）',
    instruction:
      '叙事风格：军事简报风。以硬核冷峻的战地工程与参谋纪实笔触展开，注重岩土承重、气候能见度、柴油辅机怠速、散热红外抑制与初期后勤账本的真实物理质感；对话干脆克制，将重心放在脚下掩体的踏勘、第一度电与第一铲地基的精打细算上，在慢节奏的审慎筹备中呈现重工火种白手起家的厚重发育感。',
  },
  {
    id: 'cozy',
    label: '日常温馨风',
    instruction:
      '叙事风格：日常温馨风。放缓初抵异世的紧绷节奏，着墨于车舱内昏黄温暖的应急灯光、热饮的雾气、机娘或副官清点初期紧巴物资时的生动神态与家常交谈；窗外尚未开发的荒芜冻土/废墟与车舱内的安稳一隅形成鲜明对照，像经营一处秘密新家般，从容铺陈从零开荒、一砖一瓦攒家底的慢热日常温度。',
  },
  {
    id: 'stealth',
    label: '紧张潜入风',
    instruction:
      '叙事风格：紧张潜入风。强化异界拓荒初期“弱小而隐秘”的生存张力，细致描摹伪装网外的风声雨影、车载被动雷达对未知盲区的微弱监听、红外废热的压制死角与车舱内压低声音的工程核算；在尚未摸清周边底细的战争迷雾中，每一步出舱踏勘、每一处地基选址都充满如履薄冰的策略博弈感。',
  },
  {
    id: 'epic',
    label: '史诗序章风',
    instruction:
      '叙事风格：史诗序章风。以沉雄缓推的纵深镜头切入，从苍茫天象与荒芜大地缓缓收束至伪装网下孤零零蛰伏的一台移动基地车；不写一蹴而就的宏大决战，而是聚焦“旧世界荒原上的第一粒工业火种如何扎根泥土”，在荒凉、拮据却笃定的拓荒前奏中，写透从零孕育钢铁基业的漫长史诗序章。',
  },
];

export function findTone(id: string): ToneDef {
  return TONES.find(t => t.id === id) ?? TONES[0];
}

// ─────────────────────────────── 向导选择聚合 ───────────────────────────────

export type PersonaMode = 'skip' | 'existing' | 'create';

/** 四步向导贯穿始终的单一 reactive 对象结构 */
export interface LaunchChoices {
  /** 开局世界；确认后写入 meta.world_id，中途不可切换 */
  worldId: string;
  /** 主阵营 ID（始终等于 selectedFactions[0] || 'allied'，兼容旧调用方） */
  factionId: string;
  /** 1~3 个已选阵营列表（默认 ['allied']） */
  selectedFactions?: string[];
  /** 各已选阵营主责副官配置 */
  factionAdjutants?: Record<string, FactionAdjutantConfig>;
  /** 可选初始参谋增益席副官槽（默认 null / disabled） */
  staffAdjutant?: StaffAdjutantConfig | null;
  /** 开场随行己方人类名册（先确认有哪些己方人类登场，再从中点将指派副官/参谋） */
  humanRoster?: HumanRosterMember[];
  locationId: string;
  /** 具象世界纪年预设档位（如 cyber2077 的 '2042' | '2045' | '2069' | '2077'） */
  eraPresetId?: string;
  /** 当 locationId === 'custom' 时，玩家自定义的基地名称 */
  customLocationName?: string;
  /** 当 locationId === 'custom' 时，玩家自定义的所在区域/地理坐标 */
  customLocationRegion?: string;
  /** 当 locationId === 'custom' 时，玩家自定义的周边环境与态势描述 */
  customLocationFlavor?: string;
  date: string;
  preset: PresetId;
  /** easy 档自选的一项 T1 研究（可空 = 未选） */
  easyBonusTech: string;
  /** 以下 custom* 仅 preset==='custom' 时生效 */
  customCredits: number;
  customTech: string[];
  customExposure: number;
  customSeed: string;
  personaMode: PersonaMode;
  personaName: string;
  personaDescription: string;
  /** 开场切入模式（默认 'field_drop'：战地直降·初抵待命） */
  entryMode?: OpeningEntryMode;
  /** 系统觉醒与机娘通联时机（未指定时随 entryMode 自动联动：pre_transmigration 默认 'post_transmigration_bind'，其余默认 'commander_initiate'） */
  systemLinkMode?: OpeningSystemLinkMode;
  /** 机娘孵化与命名模式（默认 'iconic_plus_blindbox'：经典MCV＋战地盲盒赐名） */
  maidenIncubationMode?: OpeningMaidenIncubationMode;
  toneId: string;
  customPrompt: string;
  /** 导入存档来源（导出包 source.chat；空=非导入开局），经 snapshotChoices 透传 $boot */
  importedFrom: string;
  /**
   * G2 修正：导入开局的全量变量树（parseSavePack 已 Schema 归一）。
   * 非空时 buildStatData 以它为基线（机娘/建筑/图鉴/队列等进度无缝继承），
   * 表单可调字段（资金/科技/暴露/日期/地点）以向导终值覆写。
   * 不进 $boot 快照（snapshotChoices 剔除，防膨胀）。
   */
  importedStat: Schema | null;
}

export function defaultChoices(worldId: string = DEFAULT_WORLD_ID): LaunchChoices {
  const targetWorld = getWorldManifest(worldId) ? worldId : DEFAULT_WORLD_ID;
  const eraPreset = eraPresetsForWorld(targetWorld)[0];
  return {
    worldId: targetWorld,
    factionId: 'allied',
    selectedFactions: ['allied'],
    factionAdjutants: {
      allied: defaultFactionAdjutantFor('allied'),
    },
    staffAdjutant: null,
    humanRoster: [],
    locationId: findLocation('', targetWorld).id,
    eraPresetId: eraPreset?.id ?? '',
    customLocationName: '',
    customLocationRegion: '',
    customLocationFlavor: '',
    date: eraPreset?.defaultDate ?? defaultDateForWorld(targetWorld),
    preset: 'normal',
    easyBonusTech: '',
    customCredits: 2000,
    customTech: [],
    customExposure: 0,
    customSeed: '',
    personaMode: 'skip',
    personaName: '',
    personaDescription: '',
    entryMode: 'field_drop',
    toneId: 'military',
    customPrompt: '',
    importedFrom: '',
    importedStat: null,
  };
}

/** 启动器 UI 首屏默认初始化（以首选推荐具象世界 cyber2077 · 2042 恶土深处开局） */
export function defaultRecommendedChoices(): LaunchChoices {
  return defaultChoices(RECOMMENDED_WORLD_ID);
}
