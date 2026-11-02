/**
 * buildAuthority.ts —— 基地三级建筑建造权限与 FCV 机娘核心权能动态扩权引擎
 *
 * 权限分级（Three-Tier Construction Authority）：
 * - Tier 3 ('full' / build.full)：主基地建造厂核心（盟军/苏联/尤里建造厂、MCV 核心机娘如白凌/喀秋莎/尤里卡），
 *   按科技树与前置建筑全量开放生产母体、科研院所、防务与超级武器。
 * - Tier 2 ('outpost_node' / build.outpost_node)：一次展开前沿节点（前哨基地展开车 / Sputnik 不可逆锚定），
 *   开放外围资源采掘（矿石精炼厂/储仓）、本阵营与通用防御点位、通信感知与战勤休整，不开放兵营/战车工厂/实验室/超武。
 * - Tier 1 ('fcv_whitelist' / build.whitelist)：前沿工地 / 前沿基地建设车（FCV）现地筑城（含驻地或专责 FCV 机娘赋能），
 *   开放基础发电与微网、T1 防御工事、资源与燃料储仓、民生水文战勤设施，
 *   并动态解析驻地/赋能 FCV 机娘的「核心权能」（如独立现地筑城：维修所、营舍、旅馆、水培站、防御碉堡、水电并网）给予特许扩权。
 * - Tier 0 ('none')：无任何建造核心或现地筑城赋能。
 *
 * 纯函数铁律：零 IO、零宿主 API、零 Vue/Pinia 副作用。
 */

function stripFactionBuildingPrefix(rawName: string): string {
  const trimmed = (rawName || '').trim();
  const m = /^(?:盟军|苏联|苏军|苏维埃|尤里|通用)\s*(.+)$/.exec(trimmed);
  const stripped = m?.[1]?.trim();
  return stripped && stripped.length >= 2 ? stripped : trimmed;
}

export type BaseBuildAuthorityTier = 'full' | 'outpost_node' | 'fcv_whitelist' | 'none';

/** 主基地正规建造厂核心名称集合（授予 Tier 3 'full' 全量建造权限） */
export const MAIN_CONYARD_BUILDING_NAMES: ReadonlySet<string> = new Set([
  '建造厂',
  '建造厂核心',
  '盟军建造厂',
  '苏联建造厂',
  '苏军建造厂',
  '尤里建造厂',
  '尤里建造厂核心',
]);

/** FCV 展开产物建筑名称集合（授予 Tier 1 'fcv_whitelist' 现地筑城权限） */
export const FCV_SITE_BUILDING_NAMES: ReadonlySet<string> = new Set([
  '前沿工地',
  '临时前沿工地',
  '前沿基地建设车',
  '现地筑城工地',
]);

/** 前哨基地展开车产物建筑名称集合（授予 Tier 2 'outpost_node' 前哨节点权限） */
export const OUTPOST_NODE_BUILDING_NAMES: ReadonlySet<string> = new Set([
  '一次展开前沿节点',
  'Sputnik一次展开前沿节点',
  '前哨基地节点',
  '前哨展开前沿节点',
  '作战前哨站',
  '心灵前哨站',
  'bld.common.outpost_forward_node',
  'bld.soviet.sputnik_outpost_node',
]);

/** FCV 标准类别白名单建筑名称集合（对齐《通用·陆地载具》10·前沿基地建设车设定正文） */
export const FCV_STANDARD_WHITELIST_NAMES: ReadonlySet<string> = new Set([
  // 1. 基础发电与野外微网设施（Tier 0 / Tier 1）
  '发电厂',
  '盟军发电厂',
  '苏联磁能反应炉',
  '磁能反应炉',
  '尤里生化反应炉',
  '生化反应炉',
  '燃煤电厂',
  '风力发电阵列',
  '蓄电池组',
  '燃气/燃油发电机组',
  '太阳能板阵列',
  '应急柴油发电机',
  '电力分配节点',
  // 2. 《通用·防御辅助》T1 防御工事、感知与掩体
  '照明塔',
  '反装甲炮位',
  '纳米雷区部署器',
  '纳米雷区',
  '强化掩体',
  '综合感知塔',
  '通讯中继桩',
  '强化地下掩蔽所',
  '哨戒炮位',
  '哨戒炮',
  '岗哨炮塔',
  '驻军碉堡',
  '盟军机枪碉堡',
  '机枪碉堡',
  '苏联战斗碉堡',
  '战斗碉堡',
  '尤里坦克碉堡',
  '坦克碉堡',
  '近程防空阵地',
  '哨戒探针阵列',
  '反载具障碍带',
  '防御栅栏',
  '防爆围墙',
  '迫击炮巢',
  '遥控武器站塔',
  '拟态伪装网',
  '纳米诱饵设施',
  // 3. 大宗仓储、油料周转與基础战勤民生
  '大宗资源与矿石储仓',
  '战备燃料与分散储罐区',
  '综合战备与重装周转总库',
  '重型装甲掩蔽库与封存车库',
  '野战物资库',
  '前线综合后勤站',
  '野战医疗站',
  '深井泵站与水文净化设施',
  '模块化战勤生活营区',
  '临时羁押与特种看押所',
  '环境监测站',
  '基础废物分拣站',
  '生活污水处理站',
  '净水与供水站',
  '水处理厂',
  '净水厂',
  '社区环卫服务站',
]);

/** 前哨节点（一次展开前沿节点）额外允许的资源采掘与阵营外围防卫点位 */
export const OUTPOST_NODE_EXTRA_ALLOWED_NAMES: ReadonlySet<string> = new Set([
  '矿石精炼厂',
  '盟军矿石精炼厂',
  '苏联矿石精炼厂',
  '尤里矿石精炼厂',
  '奴隶矿场',
  '矿石精炼器',
  '抽油机',
  '炼油厂',
  '爱国者防空阵地',
  '爱国者导弹',
  '光棱塔',
  '磁暴线圈',
  '特斯拉线圈',
  '心灵控制塔',
  '心灵信标',
  '高射炮',
  '苏联防空炮',
  '盖特机炮',
  '尤里盖特机炮',
  '半固定榴弹炮阵地',
  '多管火箭炮阵地',
  '中程防空阵地',
  '反小型目标近防系统',
  '激光近防系统',
  '电子战干扰站',
  '生态副食与水循环保障站',
]);

/**
 * 严禁在 FCV 前沿工地或前哨节点越权建造的「主基地专属军工生产母体 / 科研中枢 / 战略超武 / 巨构」
 * （除非特定建筑被驻地机娘核心权能显式点名特许，如「战地维修所」）
 */
export const MAIN_BASE_EXCLUSIVE_BUILDING_NAMES: ReadonlySet<string> = new Set([
  // 军工生产母体
  '兵营',
  '盟军兵营',
  '苏联兵营',
  '尤里兵营',
  '尤里克隆与新兵训导营',
  '战车工厂',
  '盟军战车工厂',
  '苏联战车工厂',
  '尤里战车工厂',
  '尤里生物机电战车总装厂',
  '扩大版自动化战车工厂',
  '全自动军工综合体',
  '巨型联合兵工厂',
  '空军指挥部',
  '盟军空军指挥部',
  '苏联空军指挥部',
  '神经航空引导盘',
  '空天飞机维护综合体',
  '海军造船厂',
  '盟军海军造船厂',
  '苏联海军造船厂',
  '尤里船厂',
  '尤里半潜与仿生造船厂',
  '简易船坞',
  '扩大版造船厂',
  '超级造船综合体',
  '个人装备制造所',
  '弹药制造厂',
  '化工合成厂',
  '小型纳米合成工坊',
  '陆军军校',
  // 科研院所与高阶算力/C4ISR 中枢
  '战斗实验室',
  '作战实验室',
  '盟军战斗实验室',
  '盟军作战实验室',
  '苏联战斗实验室',
  '苏联作战实验室',
  '红星实验设计局',
  '红星实验设计局综合体',
  '红星科学城',
  '国家战略工程综合体',
  '国家战略工程综合体／红星科学城',
  '尤里心灵研究实验室',
  '尤里作战实验室',
  '基因测序与心灵谐振研究院',
  '双螺旋生命工程与高维意识科学院',
  '双螺旋生命科学院',
  '盟军联合科研与国家工程组织节点',
  '超算中心',
  '量子超算中心',
  '情报分析中心',
  '网络战中心',
  '先进态势指挥中心',
  '盟军先进态势与C4ISR指挥中心',
  '全域战场感知中枢',
  '特种技术改装与逆向工程院',
  '跨维结构解构与纳米母本复现中心',
  '种质资源库与育种实验室',
  '意识保险库',
  '纳米躯体再造舱',
  // 战略能源、航天发射与超级武器
  '聚变发电中枢',
  '聚变发电阵列',
  '大型光能发电场',
  '小型模块化核反应堆',
  '大型航天发射综合体',
  '巨型航天发射港',
  '山体发射场',
  '超时空传送仪',
  '超时空传送阵列',
  '天气控制仪',
  '天气控制机',
  '天气控制仪增强设施',
  '铁幕装置',
  '核弹发射井',
  '核导弹工程',
  '心灵控制器',
  '心灵控制增幅器',
  '基因突变器',
  '复制中心',
  '法式要塞巨炮',
  '区域防御要塞',
  // 王牌专库
  '基洛夫巨型收纳与保障库',
  '无畏重型船坞与重弹保障段',
  '战略堡垒潜艇保障段',
  '天启超重总装跨',
  '母脑湿件培育与特装总装跨',
  '环形磁流体飞碟整备与微波充能巢',
  '半潜消磁船坞与龟背重弹装填栈桥',
]);

/** 判定载具名称是否为「前沿基地建设车（FCV）」 */
export function isFcvVehicleName(name: string | undefined | null): boolean {
  const n = String(name ?? '').trim();
  if (!n) return false;
  return /前沿基地建设车|\bFCV\b|前沿建设车|现地筑城车/i.test(n);
}

/** 判定载具名称是否为「前哨基地展开车（Sputnik / 外勤前哨勘探车 / 前沿工程节点车）」 */
export function isOutpostNodeVehicleName(name: string | undefined | null): boolean {
  const n = String(name ?? '').trim();
  if (!n) return false;
  return /前哨基地展开车|前哨展开车|Sputnik|外勤前哨勘探车|前沿工程节点车|基地展开车/i.test(n);
}

/**
 * 判定载具名称是否为主基地「机动建设车（MCV）」
 * 严格排除前沿基地建设车（FCV）与前哨基地展开车，杜绝展开指令混淆！
 */
export function isMainMcvVehicleName(name: string | undefined | null): boolean {
  const n = String(name ?? '').trim();
  if (!n) return false;
  if (isFcvVehicleName(n) || isOutpostNodeVehicleName(n)) return false;
  return /\bMCV\b|移动基地车|机动建设车|基地车/i.test(n);
}

/** 判定建筑名称是否为主基地正规建造厂核心（Tier 3） */
export function isMainConyardBuildingName(rawName: string | undefined | null): boolean {
  const n = String(rawName ?? '').trim();
  if (!n) return false;
  if (FCV_SITE_BUILDING_NAMES.has(n) || OUTPOST_NODE_BUILDING_NAMES.has(n)) return false;
  if (MAIN_CONYARD_BUILDING_NAMES.has(n)) return true;
  const stripped = stripFactionBuildingPrefix(n);
  if (MAIN_CONYARD_BUILDING_NAMES.has(stripped)) return true;
  return /建造厂|尤里机动建设车/.test(n) && !/前沿|前哨/.test(n);
}

/** 判定建筑名称是否为 FCV 展开工地（Tier 1） */
export function isFcvSiteBuildingName(rawName: string | undefined | null): boolean {
  const n = String(rawName ?? '').trim();
  if (!n) return false;
  const stripped = stripFactionBuildingPrefix(n);
  return FCV_SITE_BUILDING_NAMES.has(n) || FCV_SITE_BUILDING_NAMES.has(stripped) || /前沿工地|现地筑城工地/.test(n);
}

/** 判定建筑名称是否为前哨展开节点（Tier 2） */
export function isOutpostNodeBuildingName(rawName: string | undefined | null): boolean {
  const n = String(rawName ?? '').trim();
  if (!n) return false;
  const stripped = stripFactionBuildingPrefix(n);
  return (
    OUTPOST_NODE_BUILDING_NAMES.has(n) ||
    OUTPOST_NODE_BUILDING_NAMES.has(stripped) ||
    /一次展开前沿节点|前哨基地节点|前哨展开前沿节点|作战前哨站|心灵前哨站/.test(n)
  );
}

export interface GirlSkillInputLike {
  name?: string;
  kind?: string;
  desc?: string;
}

export interface GirlEquipmentInputLike {
  name?: string;
  slot?: string;
  desc?: string;
}

export interface GirlAuthorityCandidateLike {
  name?: string;
  callsign?: string;
  serial?: string;
  model?: string;
  faction?: string;
  base?: string;
  duty?: string;
  status?: string;
  hp?: string;
  weapons?: string;
  skills?: string;
  form_mech?: string;
  flaws?: string;
  traits?: readonly string[];
  special_skills?: readonly GirlSkillInputLike[];
  specialSkills?: readonly GirlSkillInputLike[];
  special_equipment?: readonly GirlEquipmentInputLike[];
  specialEquipment?: readonly GirlEquipmentInputLike[];
  [key: string]: unknown;
}

export interface FcvGirlEmpowerment {
  /** 赋能机娘显示名 */
  girlName: string;
  /** 机娘代号 */
  callsign: string;
  /** 机体/专属载具名称（如「8.5吨前沿基地建设车（FCV）本体」） */
  vehicleBodyLabel: string;
  /** 匹配方式：stationed=驻扎本据点 | assigned=技能/职责点名本据点 | mobile=战区机动外围筑城赋能 */
  assignMode: 'stationed' | 'assigned' | 'mobile';
  /** 是否具备「不占主基地队列的独立并行筑城」权能 */
  independentParallelQueue: boolean;
  /** 激活的核心权能名称列表 */
  skillNames: string[];
  /** 从核心权能中提取的特许建造项简短标签（供 UI 铭牌展示，如 ["维修所", "营舍", "旅馆", "水培站", "防御碉堡", "水电并网"]） */
  grantedLabels: string[];
  /** 特许解锁的标准目录建筑名集合 */
  grantedBuildingNames: Set<string>;
  /** 特许解锁的关键词列表（供动态 codex 建筑与模糊匹配） */
  grantedKeywords: string[];
}

export interface BaseBuildAuthorityEvaluation {
  /** 权限等级：full(主基地) | outpost_node(前哨节点) | fcv_whitelist(FCV现地筑城) | none(无核心) */
  tier: BaseBuildAuthorityTier;
  /** 权限等级中文标题 */
  tierLabel: string;
  /** 权限来源说明（如「盟军建造厂」或「前沿工地 + 机娘[xxx]独立现地筑城」） */
  sourceSummary: string;
  /** 是否具备任何合法的基地建造权限（tier !== 'none'） */
  canBuild: boolean;
  /** 是否拥有不占主基地队列的独立现地筑城队列（FCV 机娘赋能或前沿工地） */
  independentQueue: boolean;
  /** 驻地/赋能 FCV 机娘详情（若存在） */
  fcvGirl: FcvGirlEmpowerment | null;
  /** 当前据点车队中待展开的 FCV 载具名（若尚未展开前沿工地） */
  availableFcvVehicle: string | null;
  /** 当前据点车队中待展开的前哨展开车载具名 */
  availableOutpostVehicle: string | null;
  /** 当前据点车队中待展开的主基地 MCV 载具名 */
  availableMcvVehicle: string | null;
  /** 供 UI 展示的权限范围摘要文案 */
  scopeHint: string;
}

/** 机娘核心权能特许关键词映射表：识别技能描述或核心权能标题中的筑城词条并展开为目录标准建筑名 */
const FCV_SKILL_GRANT_RULES: ReadonlyArray<{
  label: string;
  probe: RegExp;
  buildings: readonly string[];
  keywords: readonly string[];
}> = [
  {
    label: '维修所',
    probe: /维修所|战地维修|抢修所|车辆维修|装甲整备|独立现地筑城|不占主基地队列/,
    buildings: ['战地维修所', '缴获军械整备与制式化改制车间', '重型装甲掩蔽库与封存车库'],
    keywords: ['维修所', '战地维修', '抢修', '整备车间'],
  },
  {
    label: '营舍',
    probe: /营舍|生活营区|营房|宿舍|兵舍|人员休整|独立现地筑城|不占主基地队列/,
    buildings: ['模块化战勤生活营区', '前线综合后勤站', '野战医疗站', '强化地下掩蔽所'],
    keywords: ['营舍', '生活营区', '营房', '宿舍', '休整'],
  },
  {
    label: '旅馆与商业驿站',
    probe: /旅馆|商业驿站|驿站|招待所|客栈|商贸|独立现地筑城|废墟快速翻新/,
    buildings: ['模块化战勤生活营区', '前线综合后勤站', '社区环卫服务站', '生态公园与绿化设施'],
    keywords: ['旅馆', '驿站', '商业驿站', '招待所', '客栈'],
  },
  {
    label: '水培站',
    probe: /水培站|水培|温室|副食|水循环|种植|生态副食|独立现地筑城|不占主基地队列/,
    buildings: [
      '生态副食与水循环保障站',
      '封闭式水产养殖池',
      '地下菌类培养室',
      '土壤培育与改良站',
      '地下规模化种植场',
      '有机循环处理站',
      '食品加工与冷链中心',
    ],
    keywords: ['水培站', '水培', '温室', '副食', '种植场'],
  },
  {
    label: '防御碉堡',
    probe: /防御碉堡|碉堡|掩体|哨戒炮|炮位|防空|工事|独立现地筑城|不占主基地队列/,
    buildings: [
      '驻军碉堡',
      '盟军机枪碉堡',
      '机枪碉堡',
      '苏联战斗碉堡',
      '战斗碉堡',
      '尤里坦克碉堡',
      '坦克碉堡',
      '强化掩体',
      '哨戒炮位',
      '哨戒炮',
      '岗哨炮塔',
      '反装甲炮位',
      '近程防空阵地',
      '纳米雷区部署器',
      '迫击炮巢',
      '遥控武器站塔',
      '反载具障碍带',
    ],
    keywords: ['碉堡', '掩体', '炮位', '哨戒炮', '防空阵地'],
  },
  {
    label: '水电并网与供暖',
    probe: /水电并网|通水通电|恒温供暖|柴油微网|废墟快速翻新|供水|电网|独立现地筑城/,
    buildings: [
      '发电厂',
      '盟军发电厂',
      '苏联磁能反应炉',
      '尤里生化反应炉',
      '燃煤电厂',
      '燃气/燃油发电机组',
      '应急柴油发电机',
      '风力发电阵列',
      '太阳能板阵列',
      '蓄电池组',
      '电力分配节点',
      '深井泵站与水文净化设施',
      '净水与供水站',
      '水处理厂',
      '净水厂',
      '生活污水处理站',
    ],
    keywords: ['水电', '供暖', '供水', '净水', '水处理', '微网', '电站', '发电机', '发电厂'],
  },
];

function norm(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase();
}

function collectGirlSkills(g: GirlAuthorityCandidateLike): GirlSkillInputLike[] {
  const list: GirlSkillInputLike[] = [];
  for (const s of g.special_skills ?? g.specialSkills ?? []) {
    if (s && typeof s === 'object') list.push(s);
  }
  return list;
}

function collectGirlEquipment(g: GirlAuthorityCandidateLike): GirlEquipmentInputLike[] {
  const list: GirlEquipmentInputLike[] = [];
  for (const e of g.special_equipment ?? g.specialEquipment ?? []) {
    if (e && typeof e === 'object') list.push(e);
  }
  return list;
}

function buildGirlFullProbeText(g: GirlAuthorityCandidateLike): string {
  const skills = collectGirlSkills(g)
    .map(s => `${s.name ?? ''} ${s.kind ?? ''} ${s.desc ?? ''}`)
    .join(' ');
  const equips = collectGirlEquipment(g)
    .map(e => `${e.name ?? ''} ${e.slot ?? ''} ${e.desc ?? ''}`)
    .join(' ');
  const traits = Array.isArray(g.traits) ? g.traits.join(' ') : '';
  return [
    g.name ?? '',
    g.callsign ?? '',
    g.serial ?? '',
    g.model ?? '',
    g.duty ?? '',
    g.status ?? '',
    g.weapons ?? '',
    g.skills ?? '',
    g.form_mech ?? '',
    traits,
    skills,
    equips,
  ].join(' ');
}

/** 判定一名机娘是否为 FCV（前沿基地建设车）机娘 */
export function isFcvGirlCandidate(g: GirlAuthorityCandidateLike | null | undefined): boolean {
  if (!g || typeof g !== 'object') return false;
  const probe = buildGirlFullProbeText(g);
  if (!probe.trim()) return false;
  // 排除三大主基地 MCV 首台（白凌 / 喀秋莎 / 尤里卡）
  const name = String(g.name ?? '').trim();
  const model = String(g.model ?? '').trim();
  if (/^(?:白凌|喀秋莎|尤里卡)$/.test(name)) return false;
  if (/移动基地车|机动建设车|\bMCV\b/i.test(model) && !/前沿基地建设车|\bFCV\b/i.test(probe)) {
    return false;
  }
  return /前沿基地建设车|\bFCV\b|独立现地筑城|前沿建设车|前沿工地/i.test(probe);
}

/** 判定一名机娘是否为主基地 MCV 核心机娘 */
export function isMainMcvGirlCandidate(g: GirlAuthorityCandidateLike | null | undefined): boolean {
  if (!g || typeof g !== 'object') return false;
  if (isFcvGirlCandidate(g)) return false;
  const name = String(g.name ?? '').trim();
  const model = String(g.model ?? '').trim();
  const serial = String(g.serial ?? '').trim();
  if (/^(?:白凌|喀秋莎|尤里卡)$/.test(name)) return true;
  if (/^MCV-[A-Z0-9]+/i.test(serial)) return true;
  return /盟军移动基地车|苏联移动基地车|尤里移动基地车|机动建设车|\bMCV\b/i.test(model);
}

/** 提取据点的简称候选词（如 "矿坑B（北郊废弃矿区）" -> ["矿坑B（北郊废弃矿区）", "矿坑B"]） */
function extractBaseMatchTokens(base: { id?: string; name?: string; location?: string } | null | undefined): string[] {
  if (!base) return [];
  const rawTokens = [base.id, base.name, base.location]
    .map(x => String(x ?? '').trim())
    .filter(Boolean);
  const out = new Set<string>();
  for (const t of rawTokens) {
    out.add(t);
    const short = t.split(/[（(·\s]/)[0]?.trim();
    if (short && short.length >= 2) out.add(short);
  }
  return [...out];
}

/**
 * 解析单名 FCV 机娘对目标据点的赋能详情
 */
export function parseFcvGirlEmpowerment(
  g: GirlAuthorityCandidateLike,
  assignMode: 'stationed' | 'assigned' | 'mobile',
): FcvGirlEmpowerment {
  const skills = collectGirlSkills(g);
  const equips = collectGirlEquipment(g);
  const probe = buildGirlFullProbeText(g);

  const girlName = String(g.name || g.callsign || g.model || 'FCV机娘').trim();
  const callsign = String(g.callsign ?? '').trim();
  const fcvEquip = equips.find(e => /前沿基地建设车|\bFCV\b/i.test(`${e.name ?? ''} ${e.desc ?? ''}`)) ?? equips[0];
  const vehicleBodyLabel = String(fcvEquip?.name || g.model || '前沿基地建设车（FCV）本体').trim();

  const skillNames = skills
    .map(s => String(s.name ?? '').trim())
    .filter(Boolean);

  const independentParallelQueue =
    /不占主基地队列|独立并行建造|独立现地筑城|解放.*主队列/i.test(probe) || skillNames.length > 0;

  const grantedLabels: string[] = [];
  const grantedBuildingNames = new Set<string>();
  const grantedKeywords = new Set<string>();

  for (const rule of FCV_SKILL_GRANT_RULES) {
    if (rule.probe.test(probe)) {
      grantedLabels.push(rule.label);
      for (const b of rule.buildings) grantedBuildingNames.add(b);
      for (const kw of rule.keywords) grantedKeywords.add(kw);
    }
  }

  // 若机娘属于 FCV 机体但当前快照尚未加载详细 special_skills 描述，回退赋予 FCV 母板标准六类现地筑城权能
  if (grantedLabels.length === 0) {
    for (const rule of FCV_SKILL_GRANT_RULES) {
      grantedLabels.push(rule.label);
      for (const b of rule.buildings) grantedBuildingNames.add(b);
      for (const kw of rule.keywords) grantedKeywords.add(kw);
    }
  }

  // 额外从「独立并行建造 A、B、C 与 D」句式中提取词条，确保自定义名称（如「旅馆」「水培站」）100% 进特许词表
  const buildListMatch = /(?:独立并行建造|现地建造|独立建造|允许建造|可建造)\s*([^，。；\n]+)/.exec(probe);
  if (buildListMatch?.[1]) {
    const rawItems = buildListMatch[1]
      .split(/[、/，,与及和\s]+/)
      .map(s => s.trim())
      .filter(s => s.length >= 2 && s.length <= 10 && !/彻底|解放|队列|白凌|主基地/.test(s));
    for (const token of rawItems) {
      grantedKeywords.add(token);
      if (!grantedLabels.some(l => l.includes(token) || token.includes(l))) {
        grantedLabels.push(token);
      }
    }
  }

  return {
    girlName,
    callsign,
    vehicleBodyLabel,
    assignMode,
    independentParallelQueue,
    skillNames,
    grantedLabels,
    grantedBuildingNames,
    grantedKeywords: [...grantedKeywords],
  };
}

/**
 * 合并快照中的机娘列表与可选世界书/档案缓存中的机娘扩展数据
 */
export function collectMergedGirlCandidates(params: {
  snapshot?: {
    girls?: readonly unknown[];
    forces?: { girls?: readonly unknown[] };
    pending_lore?: readonly unknown[];
  } | null;
  catalogMaidenItems?: readonly Record<string, unknown>[];
  dossierMap?: Readonly<Record<string, unknown>>;
}): GirlAuthorityCandidateLike[] {
  const { snapshot, catalogMaidenItems = [], dossierMap = {} } = params;
  const rawGirls: GirlAuthorityCandidateLike[] = [];
  const seenNames = new Set<string>();

  const pushGirl = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const rec = raw as GirlAuthorityCandidateLike;
    const name = String(rec.name ?? '').trim();
    if (!name || seenNames.has(name)) return;
    seenNames.add(name);
    rawGirls.push({ ...rec });
  };

  for (const g of snapshot?.girls ?? []) pushGirl(g);
  for (const g of snapshot?.forces?.girls ?? []) pushGirl(g);
  for (const p of snapshot?.pending_lore ?? []) {
    if (p && typeof p === 'object') {
      const rec = p as Record<string, unknown>;
      if (rec.kind === '机娘' || rec.type === 'maiden' || rec.model || rec['型号'] || rec.special_skills) {
        pushGirl(rec);
      }
    }
  }

  // 将 catalogMaidenItems（来自世界书 <数据> type:"maiden"）与 dossierMap 合并注入同名/同型号机娘
  return rawGirls.map(g => {
    const name = String(g.name ?? '').trim();
    const model = String(g.model ?? '').trim();
    const serial = String(g.serial ?? '').trim();
    const callsign = String(g.callsign ?? '').trim();

    const matchedMaiden = catalogMaidenItems.find(m => {
      const mName = String(m.name ?? m.preset_name ?? '').trim();
      const mModel = String(m.model ?? '').trim();
      const mSerial = String(m.serial ?? '').trim();
      const mCallsign = String(m.callsign ?? '').trim();
      if (name && mName && norm(name) === norm(mName)) return true;
      if (serial && mSerial && norm(serial) === norm(mSerial)) return true;
      if (callsign && mCallsign && norm(callsign) === norm(mCallsign)) return true;
      if (model && mModel && norm(model) === norm(mModel)) return true;
      return false;
    });

    const dossier = (dossierMap[name] ?? (serial ? dossierMap[serial] : undefined)) as
      | GirlAuthorityCandidateLike
      | undefined;

    return {
      ...(matchedMaiden ?? {}),
      ...g,
      ...(dossier ?? {}),
      name: name || String(matchedMaiden?.name ?? ''),
      base: String(g.base ?? ''),
      duty: String(g.duty ?? dossier?.duty ?? ''),
      status: String(g.status ?? g.hp ?? dossier?.status ?? '完好'),
      special_skills:
        (Array.isArray(dossier?.special_skills) && dossier.special_skills.length > 0
          ? dossier.special_skills
          : Array.isArray(dossier?.specialSkills) && dossier.specialSkills.length > 0
            ? dossier.specialSkills
            : Array.isArray(g.special_skills) && g.special_skills.length > 0
              ? g.special_skills
              : Array.isArray(g.specialSkills) && g.specialSkills.length > 0
                ? g.specialSkills
                : (matchedMaiden?.special_skills as GirlSkillInputLike[] | undefined)) ?? [],
      special_equipment:
        (Array.isArray(dossier?.special_equipment) && dossier.special_equipment.length > 0
          ? dossier.special_equipment
          : Array.isArray(dossier?.specialEquipment) && dossier.specialEquipment.length > 0
            ? dossier.specialEquipment
            : Array.isArray(g.special_equipment) && g.special_equipment.length > 0
              ? g.special_equipment
              : Array.isArray(g.specialEquipment) && g.specialEquipment.length > 0
                ? g.specialEquipment
                : (matchedMaiden?.special_equipment as GirlEquipmentInputLike[] | undefined)) ?? [],
    };
  });
}

/**
 * 查找对目标据点生效的 FCV 机娘赋能
 */
export function resolveFcvGirlForBase(params: {
  base: { id?: string; name?: string; location?: string } | null | undefined;
  girls: readonly GirlAuthorityCandidateLike[];
  isOutpostWithoutMainConyard: boolean;
}): FcvGirlEmpowerment | null {
  const { base, girls, isOutpostWithoutMainConyard } = params;
  const fcvGirls = girls.filter(g => {
    if (!isFcvGirlCandidate(g)) return false;
    const hp = String(g.hp ?? g.status ?? '').trim();
    return hp !== '离线';
  });
  if (fcvGirls.length === 0) return null;

  const baseTokens = extractBaseMatchTokens(base);

  // 1. 优先匹配直接驻扎在该据点（girl.base 命中 base.id / base.name / base.location）
  for (const g of fcvGirls) {
    const gBase = String(g.base ?? '').trim();
    if (
      gBase &&
      baseTokens.some(t => norm(gBase) === norm(t) || norm(gBase).includes(norm(t)) || norm(t).includes(norm(gBase)))
    ) {
      return parseFcvGirlEmpowerment(g, 'stationed');
    }
  }

  // 2. 匹配在 duty / status / special_skills 描述中点名该据点（如「在外围据点（矿坑B、水泥厂C）独立并行建造...」）
  for (const g of fcvGirls) {
    const probe = buildGirlFullProbeText(g);
    if (baseTokens.some(t => t.length >= 2 && probe.includes(t))) {
      return parseFcvGirlEmpowerment(g, 'assigned');
    }
  }

  // 3. 若当前据点是无主基地建造厂的外围据点，且战区内存在具备「外围据点/独立现地筑城」能力的 FCV 机娘，提供机动筑城赋能
  if (isOutpostWithoutMainConyard) {
    return parseFcvGirlEmpowerment(fcvGirls[0]!, 'mobile');
  }

  // 4. 即便在主基地，若该 FCV 机娘未绑定其他外围据点，也返回其副队列赋能信息供顶部铭牌参考
  return parseFcvGirlEmpowerment(fcvGirls[0]!, 'mobile');
}

/**
 * 综合评估单座据点的建筑建造权限（Tier 3 主基地 / Tier 2 前哨节点 / Tier 1 FCV 现地筑城 / Tier 0 无核心）
 */
export function evaluateBaseBuildAuthority(params: {
  base: {
    id?: string;
    name?: string;
    location?: string;
    buildings?: ReadonlyArray<{ name: string; state?: string }>;
    forces?: { vehicles?: ReadonlyArray<string | Record<string, unknown>> };
  } | null | undefined;
  snapshot?: {
    bases?: ReadonlyArray<{ id?: string; name?: string; buildings?: ReadonlyArray<{ name: string; state?: string }> }>;
    forces?: {
      vehicles?: ReadonlyArray<string | Record<string, unknown>>;
      girls?: readonly unknown[];
    };
    girls?: readonly unknown[];
    pending_lore?: readonly unknown[];
  } | null;
  catalogMaidenItems?: readonly Record<string, unknown>[];
  dossierMap?: Readonly<Record<string, unknown>>;
}): BaseBuildAuthorityEvaluation {
  const { base, snapshot, catalogMaidenItems, dossierMap } = params;
  const runningBuildings = (base?.buildings ?? []).filter(b => (b.state ?? '运转') === '运转');

  // 收集当前基地与战区车队中的工程载具
  const extractVehicleNames = (list: ReadonlyArray<string | Record<string, unknown>> | undefined): string[] => {
    if (!Array.isArray(list)) return [];
    return list
      .map(v => (typeof v === 'string' ? v.trim() : String((v as Record<string, unknown>)?.name ?? '').trim()))
      .filter(Boolean);
  };
  const baseVehicles = extractVehicleNames(base?.forces?.vehicles);
  const globalVehicles = extractVehicleNames(snapshot?.forces?.vehicles);
  const allCandidateVehicles = [...new Set([...baseVehicles, ...globalVehicles])];

  const availableFcvVehicle = allCandidateVehicles.find(v => isFcvVehicleName(v)) ?? null;
  const availableOutpostVehicle = allCandidateVehicles.find(v => isOutpostNodeVehicleName(v)) ?? null;
  const availableMcvVehicle = allCandidateVehicles.find(v => isMainMcvVehicleName(v)) ?? null;

  const mergedGirls = collectMergedGirlCandidates({ snapshot, catalogMaidenItems, dossierMap });

  // 检查是否有主基地建造厂核心（Tier 3）
  const mainConyardBld = runningBuildings.find(b => isMainConyardBuildingName(b.name));
  const fcvSiteBld = runningBuildings.find(b => isFcvSiteBuildingName(b.name));
  const outpostNodeBld = runningBuildings.find(b => isOutpostNodeBuildingName(b.name));

  const isOutpostWithoutMainConyard = !mainConyardBld && Boolean(base);
  const fcvGirl = resolveFcvGirlForBase({
    base,
    girls: mergedGirls,
    isOutpostWithoutMainConyard,
  });

  if (mainConyardBld) {
    const subQueueNote = fcvGirl?.independentParallelQueue
      ? ` · 另有 ${fcvGirl.girlName} 独立现地筑城副队列`
      : '';
    return {
      tier: 'full',
      tierLabel: 'Tier 3 · 主基地全权建造',
      sourceSummary: `${mainConyardBld.name}${subQueueNote}`,
      canBuild: true,
      independentQueue: Boolean(fcvGirl?.independentParallelQueue),
      fcvGirl,
      availableFcvVehicle,
      availableOutpostVehicle,
      availableMcvVehicle,
      scopeHint: '已解锁主基地完整纳米织造母机权限：可按科技树营建生产主厂、科研中枢、重型防务与战略超武。',
    };
  }

  // 检查是否具备 FCV 现地筑城权限（前沿工地建筑 / 驻地或专责 FCV 机娘 / 本据点驻防 FCV 载具）
  const baseHasLocalFcvVehicle = baseVehicles.some(v => isFcvVehicleName(v));
  if (fcvSiteBld || fcvGirl || baseHasLocalFcvVehicle) {
    const sources: string[] = [];
    if (fcvSiteBld) sources.push(fcvSiteBld.name);
    if (fcvGirl) {
      const modeTag =
        fcvGirl.assignMode === 'stationed'
          ? '驻地赋能'
          : fcvGirl.assignMode === 'assigned'
            ? '核心权能专责据点'
            : '外围机动筑城赋能';
      sources.push(`${fcvGirl.girlName}（${modeTag}）`);
    } else if (baseHasLocalFcvVehicle && availableFcvVehicle) {
      sources.push(`${availableFcvVehicle}（现地驻防）`);
    }

    // 若同时存在一次展开前沿节点，合并节点外围权限
    if (outpostNodeBld) {
      sources.unshift(outpostNodeBld.name);
    }

    const grantText =
      fcvGirl && fcvGirl.grantedLabels.length > 0
        ? ` + 机娘特许 [${fcvGirl.grantedLabels.join(' · ')}]`
        : '';
    const queueNote = fcvGirl?.independentParallelQueue
      ? '（独立并行筑城队列，不占主基地白凌队列）'
      : '';

    return {
      tier: outpostNodeBld ? 'outpost_node' : 'fcv_whitelist',
      tierLabel: outpostNodeBld ? 'Tier 2 · 前哨节点 + FCV 现地筑城' : 'Tier 1 · FCV 独立现地筑城权限',
      sourceSummary: sources.join(' + '),
      canBuild: true,
      independentQueue: Boolean(fcvGirl?.independentParallelQueue || fcvSiteBld),
      fcvGirl,
      availableFcvVehicle,
      availableOutpostVehicle,
      availableMcvVehicle,
      scopeHint: `允许营建：基础电力微网 / T1 防御工事 / 仓储后勤民生${grantText}${queueNote}；兵营、战车工厂、实验室与超武需主基地建造厂核心。`,
    };
  }

  // 检查是否为纯前哨展开节点（Tier 2）
  if (outpostNodeBld) {
    return {
      tier: 'outpost_node',
      tierLabel: 'Tier 2 · 一次展开前沿节点权限',
      sourceSummary: outpostNodeBld.name,
      canBuild: true,
      independentQueue: true,
      fcvGirl: null,
      availableFcvVehicle,
      availableOutpostVehicle,
      availableMcvVehicle,
      scopeHint:
        '允许营建：矿石精炼与储仓、外围防卫点位（碉堡/哨戒炮/防空/光棱/磁暴）、通信感知与人员休整；不含兵营/战车工厂/科研中枢。',
    };
  }

  return {
    tier: 'none',
    tierLabel: 'Tier 0 · 无建造核心',
    sourceSummary: '缺少建造厂核心或 FCV 现地筑城赋能',
    canBuild: false,
    independentQueue: false,
    fcvGirl: null,
    availableFcvVehicle,
    availableOutpostVehicle,
    availableMcvVehicle,
    scopeHint: '请在此据点展开移动基地车（MCV）、前沿基地建设车（FCV）或调遣 FCV 机娘进驻赋能。',
  };
}

/**
 * 判定单个建筑条目在指定基地建造权限下是否获准建造，以及是否属于「机娘核心权能特许解锁」
 */
export function checkBuildingAllowedByAuthority(params: {
  building: {
    id?: string;
    name: string;
    tier?: number;
    cost?: number;
    power?: number;
    desc?: string;
    tags?: readonly string[];
  };
  authority: BaseBuildAuthorityEvaluation;
}): {
  allowed: boolean;
  grantedByGirlSkill: boolean;
  grantLabel?: string;
  lockReason?: string;
} {
  const { building, authority } = params;
  const rawName = String(building.name ?? '').trim();
  const stripped = stripFactionBuildingPrefix(rawName);

  if (authority.tier === 'full') {
    const grantedByGirlSkill = Boolean(
      authority.fcvGirl &&
        (authority.fcvGirl.grantedBuildingNames.has(rawName) ||
          authority.fcvGirl.grantedBuildingNames.has(stripped) ||
          authority.fcvGirl.grantedKeywords.some(kw => rawName.includes(kw))),
    );
    return {
      allowed: true,
      grantedByGirlSkill,
      grantLabel: grantedByGirlSkill && authority.fcvGirl ? `${authority.fcvGirl.girlName} · 现地筑城特许` : undefined,
    };
  }

  if (authority.tier === 'none') {
    return {
      allowed: false,
      grantedByGirlSkill: false,
      lockReason: '当前据点缺少建造厂核心或 FCV 现地筑城权限',
    };
  }

  // 1. 优先检查驻地/赋能 FCV 机娘的核心权能特许名单（如「战地维修所」「模块化战勤生活营区」「生态副食与水循环保障站」「旅馆」等）
  const fcvGirl = authority.fcvGirl;
  if (fcvGirl) {
    const hitDirect =
      fcvGirl.grantedBuildingNames.has(rawName) ||
      fcvGirl.grantedBuildingNames.has(stripped) ||
      fcvGirl.grantedKeywords.some(kw => kw.length >= 2 && (rawName.includes(kw) || stripped.includes(kw)));
    if (hitDirect) {
      return {
        allowed: true,
        grantedByGirlSkill: true,
        grantLabel: `${fcvGirl.girlName} · 核心权能特许`,
      };
    }
  }

  // 2. 若命中主基地专属黑名单（兵营/战车工厂/空指部/造船厂/实验室/超武等），严格拦截
  if (MAIN_BASE_EXCLUSIVE_BUILDING_NAMES.has(rawName) || MAIN_BASE_EXCLUSIVE_BUILDING_NAMES.has(stripped)) {
    return {
      allowed: false,
      grantedByGirlSkill: false,
      lockReason:
        authority.tier === 'outpost_node'
          ? '超出前哨节点权限（军工主厂/实验室/超武需主基地建造厂核心）'
          : '超出 FCV 现地筑城权限（军工主厂/实验室/超武需主基地建造厂核心）',
    };
  }

  // 3. 标准白名单精确命中
  if (FCV_STANDARD_WHITELIST_NAMES.has(rawName) || FCV_STANDARD_WHITELIST_NAMES.has(stripped)) {
    return { allowed: true, grantedByGirlSkill: false };
  }

  if (
    authority.tier === 'outpost_node' &&
    (OUTPOST_NODE_EXTRA_ALLOWED_NAMES.has(rawName) || OUTPOST_NODE_EXTRA_ALLOWED_NAMES.has(stripped))
  ) {
    return { allowed: true, grantedByGirlSkill: false };
  }

  // 4. 类别与层级启发式匹配（兼容 DLC 与动态 codex 前哨设施）
  const tier = building.tier ?? 1;
  const tags = building.tags ?? [];
  const probe = `${rawName} ${building.desc ?? ''} ${tags.join(' ')}`;

  // 严禁高阶科研、航天发射、战略超武、军工总装母厂
  if (/建造厂|兵营|战车工厂|空军指挥|造船厂|船坞|战斗实验室|科学城|设计局|超算|发射场|发射港|超时空|天气控制|铁幕|核弹|心灵控制|基因突变|要塞巨炮|纳米合成工坊|弹药制造厂|装备制造所/.test(rawName)) {
    return {
      allowed: false,
      grantedByGirlSkill: false,
      lockReason: '超出 FCV 现地筑城权限（需主基地建造厂核心）',
    };
  }

  // 允许 T0/T1 基础电力、防御工事、物流仓储、公共民生与农畜水培设施
  if (tier <= 1) {
    if (
      tags.some(t => /电力设施|防御工事|物流仓储|公共设施/.test(t)) ||
      /发电|电站|电池|微网|碉堡|掩体|炮位|哨戒|雷区|围墙|栅栏|探针|照明|伪装|储仓|储罐|仓库|物资库|后勤|医疗|水文|泵站|净水|污水|营区|营舍|旅馆|驿站|水培|温室|环卫/.test(
        probe,
      )
    ) {
      return { allowed: true, grantedByGirlSkill: false };
    }
  }

  if (authority.tier === 'outpost_node' && tier <= 2) {
    if (/精炼|采矿|抽油|防空|光棱塔|磁暴线圈|特斯拉线圈|炮台|碉堡|阵地/.test(probe)) {
      return { allowed: true, grantedByGirlSkill: false };
    }
  }

  return {
    allowed: false,
    grantedByGirlSkill: false,
    lockReason:
      authority.tier === 'outpost_node'
        ? '超出前哨节点建造权限（需主基地建造厂核心）'
        : '超出 FCV 现地筑城白名单（需主基地建造厂核心）',
  };
}

/** 生成展开 FCV（前沿基地建设车）的标准战术指令文本 */
export function buildDeployFcvOrderText(
  baseName: string,
  fcvName = '前沿基地建设车',
): { orderText: string; hintText: string } {
  return {
    orderText: `【指挥官战术指令】【下达部署指令】：在「${baseName}」就地展开 ${fcvName}（请推进前沿基地建设车展开为「前沿工地」，激活 build.whitelist 现地筑城权限，并在 <部署> 中输出 展开: ${fcvName} | 基地: ${baseName}）`,
    hintText: `◆ 已填入输入框：展开 ${fcvName} → 前沿工地 @ ${baseName}（请确认后发送）`,
  };
}

/** 生成展开前哨基地展开车（一次展开前沿节点）的标准战术指令文本 */
export function buildDeployOutpostNodeOrderText(
  baseName: string,
  vehicleName = '前哨基地展开车',
): { orderText: string; hintText: string } {
  return {
    orderText: `【指挥官战术指令】【下达部署指令】：在「${baseName}」执行不可逆锚定展开 ${vehicleName}（请将其转化为「一次展开前沿节点」，激活外围前哨建造权限，并在 <部署> 中输出 展开: ${vehicleName} | 基地: ${baseName}）`,
    hintText: `◆ 已填入输入框：展开 ${vehicleName} → 一次展开前沿节点 @ ${baseName}（请确认后发送）`,
  };
}
