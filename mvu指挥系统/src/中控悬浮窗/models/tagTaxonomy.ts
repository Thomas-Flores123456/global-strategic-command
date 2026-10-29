/**
 * tagTaxonomy.ts
 * 中控台多维战术标签规约与检索纯函数模块（对齐任务包 §3.5）
 *
 * 1. 一级主领域（8 大领域）：资源产出、电力设施、人员相关、载具建造、航天工业、科技建筑、防御工事、物流仓储；
 * 2. 二级战术特征（11 大特征）：重型装甲、轻装快速、C4ISR、态势感知、区域拒止、环境依赖、清洁能源、高危设施、应急储能、机娘专属、战略超武；
 * 3. 标签推导纯函数 inferItemTags：优先消费世界书 <数据> 块显式 tags；对未打标条目依据军工关键词与分类语义智能推导保底；
 * 4. 战术过滤判定纯函数 matchItem：支持主领域单选/全选、战术特征交集(AND)/并集(OR)多选过滤、以及名称/描述/前置/Tags 跨字段多词模糊检索。
 */

/** 一级主领域标签（Primary Domains）- 10 大核心领域（建造面板改版：增公共设施/战略超武） */
export const PRIMARY_DOMAINS = [
  '资源产出',
  '电力设施',
  '人员相关',
  '载具建造',
  '航天工业',
  '科技建筑',
  '防御工事',
  '物流仓储',
  '公共设施',
  '战略超武',
] as const;

export type PrimaryDomain = (typeof PRIMARY_DOMAINS)[number];

/** 二级战术特征标签（Secondary Traits）- 11 大核心特征 */
export const SECONDARY_TRAITS = [
  '重型装甲',
  '轻装快速',
  'C4ISR',
  '态势感知',
  '区域拒止',
  '环境依赖',
  '清洁能源',
  '高危设施',
  '应急储能',
  '机娘专属',
  '战略超武',
] as const;

export type SecondaryTrait = (typeof SECONDARY_TRAITS)[number];

/** 建造面板大类 → 子领域映射（建造面板改版：4+1 五大类结构，巨构全权交由工程系统承载，建造面板不再单列）
 * 基建=电力/资源/物流/公共；工业=载具制造建筑；科研=科技/航天；
 * 防御=防御工事/战略超武；生产=人员/装备与载具单位（不走领域标签） */
export const BUILD_PANEL_GROUPS = [
  { id: '基建', label: '基建', icon: 'base', domains: ['电力设施', '资源产出', '物流仓储', '公共设施'] },
  { id: '工业', label: '工业', icon: 'gear', domains: ['载具建造'] },
  { id: '科研', label: '科研', icon: 'flask', domains: ['科技建筑', '航天工业'] },
  { id: '防御', label: '防御', icon: 'shield', domains: ['防御工事', '战略超武'] },
  { id: '生产', label: '生产', icon: 'hammer', domains: [] },
] as const;

export type BuildPanelGroupId = (typeof BUILD_PANEL_GROUPS)[number]['id'];

/** 生产大类的固定子页签（单一事实源；建造控制台生产页二级栏：人员/装备/陆/空/海军）
 * 装备子栏（21 号改造）：人员装备类生产条目独立成栏，不再混入人员或陆军兜底 */
export const PRODUCTION_SUBS = ['人员', '装备', '陆军', '空军', '海军'] as const;

/** 装备识别名称关键词（口径与 productionLanes.ts lane.equipment 推导表同源对齐；改一边必须同步另一边） */
export const EQUIPMENT_KEYWORDS = [
  '装备',
  '武器',
  '枪械',
  '弹药',
  '瞄准',
  '外骨骼',
  '军服',
  '护具',
  '防具',
] as const;

/** 装备锚定建筑关键词（口径与 researchSlots.ts slot.equipment anchorNames 同源对齐，includes 匹配兼收「个人装备制造所」及阵营前缀变体） */
const EQUIPMENT_ANCHOR = '装备制造所';

/**
 * 生产条目装备判定（纯函数）：
 * 1. need_building 锚定装备制造所（静态目录 3 条弹药/装具条目主路径）；
 * 2. 名称命中装备关键词（动态/世界书条目兜底）。
 * 调用方必须先于人员判定调用（「单兵装具一批」名含「兵」，否则会被人员关键词截走）。
 */
export function isEquipmentProduction(name: string, needBuilding?: string): boolean {
  if (needBuilding && needBuilding.includes(EQUIPMENT_ANCHOR)) return true;
  return EQUIPMENT_KEYWORDS.some(k => name.includes(k));
}

/** 子领域页签图标映射（单一事实源；未覆盖的新领域落 'dots' 兼容，见 ConsoleBuildGrid.subTabs） */
export const SUB_TAB_ICONS: Record<string, string> = {
  全部: 'grid',
  其他: 'dots',
  电力设施: 'power',
  资源产出: 'credits',
  物流仓储: 'archive',
  公共设施: 'civic',
  载具建造: 'gear',
  科技建筑: 'tech',
  航天工业: 'rocket',
  防御工事: 'shield',
  战略超武: 'nuke',
  人员: 'factions',
  装备: 'ammo',
  陆军: 'infantry',
  空军: 'plane',
  海军: 'anchor',
};

export interface ItemTagCandidate {
  name: string;
  desc?: string;
  category?: string;
  subCategory?: string;
  tags?: readonly string[] | string[];
}

/**
 * 战术标签智能推导与清洗（纯函数）
 * 1. 显式优先：若输入已有有效 tags 数组，直接去重后返回；
 * 2. 兜底推导：针对旧静态条目或无数据块条目，依据 §3.5 军工实体关键词及类别自动赋予主领域与特征标签。
 */
export function inferItemTags(item: ItemTagCandidate): string[] {
  if (item.tags && item.tags.length > 0) {
    return Array.from(new Set(item.tags.filter(t => typeof t === 'string' && t.trim().length > 0)));
  }

  const name = item.name || '';
  const desc = item.desc || '';
  const text = `${name} ${desc}`;
  const inferred = new Set<string>();

  // 1. 一级主领域推导（§3.5 实体对照表）
  if (/精炼厂|油井|合成工坊|水井|水培|采矿|矿石|精炼|原油|合成燃料|化肥|水产/.test(text)) {
    inferred.add('资源产出');
  }
  if (/发电机|发电厂|光伏|风力|SMR|聚变|核反应堆|核电|电网|蓄电池组|供电|风光/.test(text)) {
    inferred.add('电力设施');
  }
  if (
    /兵营|军校|生活营区|医疗|步兵|大兵|工程兵|间谍|狙击|军官|单兵|防具|干部|学员|战士/.test(text) ||
    item.category === '人员'
  ) {
    inferred.add('人员相关');
  }
  if (
    /战车工厂|船坞|造船|装配线|机动平台|坦克|装甲车|载具|战机|直升机|舰|艇|潜艇|驱逐舰|巡洋舰|航母|车辆|卡车/.test(
      text,
    ) ||
    item.category === '载具'
  ) {
    inferred.add('载具建造');
  }
  if (/发射阵地|空间核动力|环轨|航天|火箭|空间站|卫星|测控|赤环|天锤|轨道|出射段/.test(text)) {
    inferred.add('航天工业');
  }
  if (/战斗实验室|实验室|雷达|情报|科研|超算|实验理论|数据中心|观测站|通信枢纽/.test(text)) {
    inferred.add('科技建筑');
  }
  if (
    /碉堡|防空|炮位|雷区|围墙|爱国者|光棱塔|哨戒|近防|要塞巨炮|地雷|掩体|机枪碉堡|拦截|防御阵地|拟态伪装/.test(text) ||
    item.category === '防辅'
  ) {
    inferred.add('防御工事');
  }
  if (/矿料仓|油罐|周转库|铁路|编组站|物资库|后勤|仓储|货运|仓库|储备库/.test(text)) {
    inferred.add('物流仓储');
  }
  if (/污水|净水|供水|生态修复|生态公园|环卫|绿化|公共设施|民心|环保|环境监测|危废|农畜|食物自给/.test(text)) {
    inferred.add('公共设施');
  }
  if (/超时空|天气控制|铁幕|核弹|基因突变|心灵控制|天基|超武|战略武器/.test(text)) {
    inferred.add('战略超武');
  }

  // 若无任何命中，基于分类做保底映射
  if (inferred.size === 0) {
    if (item.category === '人员') inferred.add('人员相关');
    else if (item.category === '载具') inferred.add('载具建造');
    else if (item.category === '防辅') inferred.add('防御工事');
    else if (item.category === '巨构') inferred.add('科技建筑');
    else inferred.add('科技建筑');
  }

  // 2. 二级战术特征推导（§3.5 特征对照表）
  if (/重型|重装|主战坦克|天启|巡洋舰|战列舰|航母|要塞|重盾|厚装甲/.test(text)) {
    inferred.add('重型装甲');
  }
  if (/轻型|轻装|快速|突击|快艇|战隼|直升机|小鸟|侦察车|摩托|无人机|Switchblade/.test(text)) {
    inferred.add('轻装快速');
  }
  if (/C4ISR|数据链|指挥|情报|电子战|网络战|通讯|中继|控制中心/.test(text)) {
    inferred.add('C4ISR');
  }
  if (/态势感知|空情|雷达|扫描|探针|侦察|声呐|监视|预警|空域/.test(text)) {
    inferred.add('态势感知');
  }
  if (/区域拒止|封锁|地雷|雷区|防空|要塞巨炮|光棱塔|障碍带|拦截网络/.test(text)) {
    inferred.add('区域拒止');
  }
  if (/环境依赖|水域|起降|地质|昼夜|风力|光伏|露天|通航|河道/.test(text)) {
    inferred.add('环境依赖');
  }
  if (/清洁能源|太阳能|光伏|风力|聚变|风光发电/.test(text)) {
    inferred.add('清洁能源');
  }
  if (/高危设施|核反应堆|裂变|SMR|化工厂|核弹|弹药制造|辐射|高压/.test(text)) {
    inferred.add('高危设施');
  }
  if (/应急储能|蓄电池|储能|应急发电机|缓冲储能/.test(text)) {
    inferred.add('应急储能');
  }
  if (/机娘|白凌|意识核心|觉醒|专属/.test(text)) {
    inferred.add('机娘专属');
  }
  if (/超时空|天气控制|铁幕|核弹|基因突变|心灵控制|天基|超武|巨构|赤星天锤/.test(text) || item.category === '巨构') {
    inferred.add('战略超武');
  }

  return Array.from(inferred);
}

export interface TacticalFilterOptions {
  selectedDomain?: string | null;
  selectedTraits?: readonly string[] | string[];
  traitMatchMode?: 'and' | 'or';
  searchQuery?: string;
}

export interface MatchableItem {
  name: string;
  desc?: string;
  tags?: readonly string[] | string[];
  prereq?: string;
  meta?: string;
}

let lastSearchQueryRaw = '';
let lastSearchQueryTokens: string[] = [];

function getSearchQueryTokens(rawQuery: string): string[] {
  if (rawQuery === lastSearchQueryRaw) {
    return lastSearchQueryTokens;
  }
  lastSearchQueryRaw = rawQuery;
  lastSearchQueryTokens = rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return lastSearchQueryTokens;
}

/**
 * 战术条目匹配纯函数
 * 同时检验一级主领域、二级战术特征（AND/OR）、模糊搜索词
 */
export function matchItem(item: MatchableItem, filters: TacticalFilterOptions): boolean {
  const itemTags = item.tags ?? [];

  // 1. 一级主领域过滤
  if (filters.selectedDomain && filters.selectedDomain !== '全部') {
    if (!itemTags.includes(filters.selectedDomain)) {
      return false;
    }
  }

  // 2. 二级战术特征过滤
  if (filters.selectedTraits && filters.selectedTraits.length > 0) {
    const mode = filters.traitMatchMode ?? 'or';
    if (mode === 'and') {
      const allMatched = filters.selectedTraits.every(trait => itemTags.includes(trait));
      if (!allMatched) return false;
    } else {
      const anyMatched = filters.selectedTraits.some(trait => itemTags.includes(trait));
      if (!anyMatched) return false;
    }
  }

  // 3. 关键字模糊搜索（名称、描述、前置、Tags 跨字段支持）
  if (filters.searchQuery) {
    const tokens = getSearchQueryTokens(filters.searchQuery);
    if (tokens.length > 0) {
      const nameLower = (item.name || '').toLowerCase();
      const descLower = (item.desc || '').toLowerCase();
      const prereqLower = (item.prereq || '').toLowerCase();
      const metaLower = (item.meta || '').toLowerCase();
      const tagsLower = itemTags.map(t => t.toLowerCase());

      const allTokensMatch = tokens.every(token => {
        return (
          nameLower.includes(token) ||
          descLower.includes(token) ||
          prereqLower.includes(token) ||
          metaLower.includes(token) ||
          tagsLower.some(t => t.includes(token))
        );
      });

      if (!allTokensMatch) return false;
    }
  }

  return true;
}

/**
 * 生产项目二级子页签智能归类（纯函数）：
 * 优先消费世界书 <数据>.category，回退消费 need_building 与名称关键词，
 * 保证「人员 / 装备 / 陆军 / 空军 / 海军」五栏边界清晰、不串栏。
 */
export function inferProductionSubTab(item: {
  name: string;
  needBuilding?: string;
  rawCategory?: string;
}): (typeof PRODUCTION_SUBS)[number] {
  const name = item.name || '';
  const need = item.needBuilding || '';
  const rawCat = (item.rawCategory || '').toLowerCase();

  // 1. 装备优先（防止「单兵装具一批」「光棱单兵步枪」等含「兵」字装备误入人员栏）
  if (rawCat === 'equipment' || isEquipmentProduction(name, need)) {
    return '装备';
  }

  // 2. 空军（航空器、旋翼机、无人机、空射巡飞/诱饵、空天平台）
  if (
    rawCat === 'air' ||
    rawCat === 'aircraft' ||
    need.includes('空军') ||
    need.includes('机场') ||
    /战隼|黑鹰|小鸟|飞机|战机|战斗机|攻击机|轰炸机|运输机|预警机|中继机|电子攻击机|直升机|旋翼|倾转旋翼|无人机|死神|女武神|全球鹰|阿帕奇|支奴干|鱼鹰|夏延|楔尾|B-52|B-1B|B-21|C-130|C-17|F-15|F-16|F-22|F-35|F-47|A-10|米格|苏-|图-|伊尔|安-|卡-|米-|基洛夫.*母舰|基洛夫.*飞艇|空天/.test(
      name,
    )
  ) {
    return '空军';
  }

  // 3. 海军（水面舰艇、潜艇、两栖登陆舰艇、无人舰/潜航器）
  if (
    rawCat === 'naval' ||
    rawCat === 'ship' ||
    need.includes('海军') ||
    need.includes('造船') ||
    need.includes('船坞') ||
    /造船厂|驱逐舰|巡洋舰|护卫舰|航空母舰|航母|战列舰|两栖攻击舰|船坞运输舰|补给舰|支援舰|潜艇|核潜艇|快艇|巡逻艇|冲锋艇|登陆艇|作业艇|防空艇|无人水面|潜航器|海豚|乌贼|海蝎|无畏级|基洛夫级|伯克级|提康德罗加|洛杉矶级|弗吉尼亚级|哥伦比亚级|黄蜂级|小鹰级|尼米兹级|福特级|自由级|星座级|圣安东尼奥级|母舰/.test(
      name,
    )
  ) {
    return '海军';
  }

  // 4. 人员（兵营训练的步兵、军犬、勤务兵、特战人员；排除步兵战车/装甲车等载具）
  if (
    (rawCat === 'infantry' ||
      need.includes('兵营') ||
      /步兵|大兵|动员兵|工程兵|医疗兵|侦察兵|间谍|军犬|战犬|通信兵|狙击手|炮兵班|操控员|陆战队|宪兵|战斗员|工兵|防空兵|磁暴步兵|铁锤步兵|海豹|谭雅|鲍里斯|军官|政治工作|特工|蛙人/.test(
        name,
      )) &&
    !/战车|装甲车|输送车|突击车|无人战斗车|伴随作战平台|要塞/.test(name)
  ) {
    return '人员';
  }

  // 5. 其余归入陆军（主战坦克、装甲车、火炮、防空车、工程后勤车等）
  return '陆军';
}

export interface SortableBuildGridItem {
  name: string;
  category: string;
  subCategory?: string;
  cost: number;
  faction?: string;
  builtCount?: number;
  queueModel?: { tone?: string };
  /** 解锁层级（0=基础池無科技前置，1=T1科技，2=T2科技，3=T3/协议） */
  unlockTier?: number;
}

const CATEGORY_ORDER: Readonly<Record<string, number>> = {
  基建: 0,
  工业: 1,
  科研: 2,
  防御: 3,
  生产: 4,
};

const SUB_CATEGORY_ORDER: Readonly<Record<string, number>> = {
  // 基建
  电力设施: 0,
  资源产出: 1,
  物流仓储: 2,
  公共设施: 3,
  // 工业 / 科研 / 防御
  载具建造: 10,
  科技建筑: 20,
  航天工业: 21,
  防御工事: 30,
  战略超武: 31,
  // 生产五栏固定作战序列：人员 → 装备 → 陆军 → 空军 → 海军
  人员: 50,
  装备: 51,
  陆军: 52,
  空军: 53,
  海军: 54,
  其他: 90,
};

/**
 * 同子类别、同科技层级内的职能角色微序权重（越小越靠前）：
 * 让基础主战单位排在最前、侦察/勤务居中、特种/重型支援排后，告别杂乱无章。
 */
export function computeRoleRank(item: Pick<SortableBuildGridItem, 'name' | 'category' | 'subCategory'>): number {
  const name = item.name || '';
  const sub = item.subCategory || '';

  if (item.category !== '生产') {
    // 建造面板：基地中枢/电厂/矿场/兵营/装备所/车厂/雷达/空军/船厂/实验室依次排布
    if (/建造厂|基地车|指挥中枢/.test(name)) return 0;
    if (/发电厂|核电|反应堆|电站/.test(name)) return 1;
    if (/矿石精炼厂|采矿|精炼|油井/.test(name)) return 2;
    if (/兵营/.test(name)) return 3;
    if (/个人装备制造所|装备制造/.test(name)) return 4;
    if (/战车工厂/.test(name)) return 5;
    if (/雷达|空指部|空军指挥部/.test(name)) return 6;
    if (/造船厂|船坞/.test(name)) return 7;
    if (/作战实验室|科研|设计局|研究所/.test(name)) return 8;
    if (/维修|机库|仓库|矿料仓/.test(name)) return 9;
    if (/围墙|沙袋|铁丝网/.test(name)) return 10;
    if (/机枪碉堡|哨戒炮|战斗碉堡/.test(name)) return 11;
    if (/防空|爱国者|萨姆/.test(name)) return 12;
    if (/光棱塔|磁暴线圈|巨炮/.test(name)) return 13;
    return 20;
  }

  if (sub === '人员') {
    if (/^(美国大兵|动员兵|合同兵)/.test(name)) return 0; // 主战基干步兵
    if (/防空步兵|反装甲重装步兵|重装大兵|磁暴步兵|近卫突击/.test(name)) return 1; // 战斗骨干步兵
    if (/军犬|战犬|侦察兵/.test(name)) return 2; // 侦察警戒
    if (/工程兵|工兵|医疗兵|通信兵|宪兵/.test(name)) return 3; // 战地勤务与技术保障
    if (/狙击手|炮兵班|无人机.*操控|陆战队|铁锤/.test(name)) return 4; // 专业火力与特种分队
    if (/间谍|海豹|特种|超时空|谭雅|鲍里斯|外骨骼/.test(name)) return 5; // 高阶特战与精英
    return 6;
  }

  if (sub === '装备') {
    if (/步枪|机枪|手枪|霰弹枪|班组武器|冷兵器/.test(name)) return 0; // 制式枪械与近战
    if (/防护装具|护甲|防弹|外骨骼|头盔|护目|视觉增强/.test(name)) return 1; // 个人防护与穿戴
    if (/弹药|步枪弹|手枪弹|穿甲弹/.test(name)) return 2; // 弹药基数
    if (/瞄准|消音|通讯|爆破|伪装网|套件/.test(name)) return 3; // 战术附件与器材
    if (/反装甲|便携防空|毒刺|狙击系统|巡飞弹|导弹/.test(name)) return 4; // 班组重火器与精确打击
    return 5;
  }

  if (sub === '陆军') {
    if (/采矿车|武装采矿车|超时空采矿车/.test(name)) return 0; // 采矿经济核心
    if (/主战坦克|灰熊|犀牛|T-72|T-80|T-90|M1A|天启|光棱坦克|幻影坦克/.test(name)) return 1; // 主力装甲
    if (/步兵战车|布拉德利|BMP|BTR|装甲输送|两栖装甲|要塞/.test(name)) return 2; // 步坦协同与机械化运载
    if (/侦察车|无人|恐怖机器人|摩托|快速突击/.test(name)) return 3; // 机动侦察与无人突击
    if (/防空车|后卫|通古斯卡|铠甲|道尔|山毛榉|S-300|防空/.test(name)) return 4; // 野战机动防空
    if (/火炮|榴弹炮|帕拉丁|火箭炮|导弹|V3|V4|热压|TOS|暗鹰/.test(name)) return 5; // 曲射火炮与战役导弹
    if (/工程|抢修|架桥|排雷|补给|后勤|指挥车|前哨|基地/.test(name)) return 6; // 工程后勤与特种支援车
    return 7;
  }

  if (sub === '空军') {
    if (/小鸟|黑鹰|阿帕奇|支奴干|鱼鹰|夏延|直升机|旋翼/.test(name)) return 0; // 陆航旋翼机
    if (/战隼|攻击鹰|阵风|雷电|猛禽|闪电|米格|苏-|战斗机|攻击机|制空/.test(name)) return 1; // 战术固定翼战机
    if (/无人机|死神|女武神|全球鹰|忠诚僚机/.test(name)) return 2; // 无人作战航空器
    if (/大力神|环球霸王|运输机|预警|中继|电子|吊舱|诱饵/.test(name)) return 3; // 运输、预警与电子支援
    if (/轰炸机|同温层堡垒|枪骑兵|突袭者|基洛夫|空天/.test(name)) return 4; // 战略轰炸与空天母舰
    return 5;
  }

  if (sub === '海军') {
    if (/巡逻艇|冲锋艇|快艇|炮艇|水雷|海蝎|登陆艇|LCAC|LCU/.test(name)) return 0; // 近海轻型舰艇与登陆艇
    if (/护卫舰|近海战斗舰|驱逐舰|伯克|星座|军刀|无畏/.test(name)) return 1; // 主力水面驱护舰
    if (/潜艇|核潜艇|海豚|乌贼|潜航器/.test(name)) return 2; // 水下作战力量
    if (/两栖|船坞|补给舰|支援舰/.test(name)) return 3; // 两栖投送与远洋补给
    if (/巡洋舰|提康德罗加|基洛夫级|航空母舰|航母|母舰/.test(name)) return 4; // 远洋主力巨舰与航母
    return 5;
  }

  return 10;
}

/**
 * 建造/生产网格条目比较器（纯函数）：
 * 1. 大类顺序（基建 → 工业 → 科研 → 防御 → 巨构 → 生产）
 * 2. 子类别/产线顺序（生产内：人员 → 装备 → 陆军 → 空军 → 海军）
 * 3. 同子类别内正在排产/建造中的队列项置顶
 * 4. 解锁科技层级升序（Tier 0 基础池 → Tier 1 改良/专业池 → Tier 2 换代池 → Tier 3 尖端/协议池）
 * 5. 职能角色序列权重（主战基干 → 侦察勤务 → 专业火力/重型支援）
 * 6. 造价由低到高升序 + 中文名稳定字典序兜底
 */
export function compareBuildGridItems(a: SortableBuildGridItem, b: SortableBuildGridItem): number {
  const catDiff = (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99);
  if (catDiff !== 0) return catDiff;

  const subDiff = (SUB_CATEGORY_ORDER[a.subCategory ?? '其他'] ?? 89) - (SUB_CATEGORY_ORDER[b.subCategory ?? '其他'] ?? 89);
  if (subDiff !== 0) return subDiff;

  const aActiveQueue = a.queueModel?.tone === 'run' || a.queueModel?.tone === 'wait' ? 0 : 1;
  const bActiveQueue = b.queueModel?.tone === 'run' || b.queueModel?.tone === 'wait' ? 0 : 1;
  if (aActiveQueue !== bActiveQueue) return aActiveQueue - bActiveQueue;

  const tierDiff = (a.unlockTier ?? 0) - (b.unlockTier ?? 0);
  if (tierDiff !== 0) return tierDiff;

  const roleDiff = computeRoleRank(a) - computeRoleRank(b);
  if (roleDiff !== 0) return roleDiff;

  const costDiff = (a.cost ?? 0) - (b.cost ?? 0);
  if (costDiff !== 0) return costDiff;

  return (a.name || '').localeCompare(b.name || '', 'zh-CN');
}

export function sortBuildGridItems<T extends SortableBuildGridItem>(items: readonly T[]): T[] {
  return [...items].sort(compareBuildGridItems);
}

/** 剥离阵营前缀（盟军/苏联/苏军/苏维埃/尤里/通用），供同位建筑归一化与去重匹配 */
export function stripFactionBuildingPrefix(rawName: string): string {
  const trimmed = (rawName || '').trim();
  const m = /^(?:盟军|苏联|苏军|苏维埃|尤里|通用)\s*(.+)$/.exec(trimmed);
  const stripped = m?.[1]?.trim();
  return stripped && stripped.length >= 2 ? stripped : trimmed;
}

/** 建造厂核心建筑名称集合（MCV 展开原点） */
export const CONYARD_ORIGIN_NAMES: ReadonlySet<string> = new Set([
  '建造厂',
  '建造厂核心',
  '盟军建造厂',
  '苏联建造厂',
  '尤里建造厂',
  '尤里建造厂核心',
  '前沿工地',
  '作战前哨站',
]);

/** 判定是否为 MCV 展开原点建筑（不应在右侧建造蓝图面板作为普通建筑出售） */
export function isConyardOriginBuilding(b: {
  id?: string;
  name: string;
  cost?: number;
}): boolean {
  const name = (b.name || '').trim();
  if (b.id === 'bld.common.construction_yard_core') return true;
  if (CONYARD_ORIGIN_NAMES.has(name)) return true;
  if ((b.cost ?? 0) <= 0 && /建造厂核心/.test(name)) return true;
  return false;
}

/**
 * 判定是否为单基地唯一型中枢/升级/超武建筑（D-BLD-04）：
 * 当当前基地已建成（builtCount > 0）且无在途队列时，不在建造侧栏重复推销。
 */
export function isSingleInstancePerBaseBuilding(b: {
  id?: string;
  name: string;
  tags?: readonly string[];
}): boolean {
  const name = (b.name || '').trim();
  const tags = b.tags ?? [];
  if (
    /战斗实验室|红星.*设计局|战术科研中心|超算中心|量子超算中心|超时空传送仪|天气控制[机仪]|铁幕装置|核弹发射井|核导弹工程|心灵控制器|心灵控制增幅器|基因突变器|复制中心|空指部扩建雷达|战略铁路编组与动员|装甲储备与装备再生|意识保险库/.test(
      name,
    )
  ) {
    return true;
  }
  if (tags.includes('战略超武') || tags.includes('战略超级武器') || tags.includes('T2入口')) {
    return true;
  }
  return false;
}

/**
 * 建筑主领域序列推导（D-BLD-04）：
 * 1. 合并显式 tags 中的 PRIMARY_DOMAINS；
 * 2. 基于名称 + 显式 tags 识别高精度主领域（避免长描述中“供电/耗电”字样干扰分桶优先级）；
 * 3. 调用 inferItemTags({ name, desc })（不传 tags 以始终运行名称+描述关键词识别）并补充兜底规则；
 * 4. 若仅命中 '人员相关'（如兵营、陆军军校、生活营区、野战医疗站），追加 '公共设施' 以确保在基建栏稳定分桶、绝不掉入 '其他'。
 */
const DOMAINS_OF_BUILDING_CACHE = new Map<string, string[]>();
const MAX_DOMAINS_OF_BUILDING_CACHE_SIZE = 512;

export function domainsOfBuilding(
  name: string,
  desc: string | undefined,
  tags: readonly string[] | undefined,
): string[] {
  const cacheKey = `${name || ''}\0${desc ?? ''}\0${(tags ?? []).join(',')}`;
  const cached = DOMAINS_OF_BUILDING_CACHE.get(cacheKey);
  if (cached) {
    return [...cached];
  }

  const result: string[] = [];
  const push = (d: string) => {
    if ((PRIMARY_DOMAINS as readonly string[]).includes(d) && !result.includes(d)) {
      result.push(d);
    }
  };

  for (const t of tags ?? []) {
    push(t);
  }

  const headProbe = `${name || ''} ${(tags ?? []).join(' ')}`;
  if (
    /战略超级武器|超级武器|超时空传送|天气控制|铁幕|核弹发射井|核导弹工程|基因突变|心灵控制器|天基.*光棱/.test(
      headProbe,
    )
  ) {
    push('战略超武');
  }
  if (
    /防御建筑|防御工事|防空|炮台|炮位|碉堡|哨戒炮|高射炮|火焰塔|光棱塔|光棱升级|磁暴线圈|巨炮|近防炮|围墙|雷区|掩体|掩蔽|损管|洗消|抢修塔|裂缝产生器|隐身屏蔽|心灵信标|心灵探测|反导|拦截|要塞|照明塔|感知塔|干扰站|诱饵|伪装网|障碍带|迫击炮巢|榴弹炮阵地|火箭炮阵地|武器站塔/.test(
      headProbe,
    )
  ) {
    push('防御工事');
  }
  if (
    /航天|火箭|发射场|发射中心|发射港|山体发射|卫星|空间站|轨道|月面|月球|深空|地月|天基平台|入轨|空天飞机维护|空间核动力|空间太阳能/.test(
      headProbe,
    )
  ) {
    push('航天工业');
  }
  if (
    /实验室|科研|设计局|超算|量子计算|意识保险库|C4ISR|科学城|感知中枢|情报分析|网络战|电子对抗|工控防护/.test(
      headProbe,
    )
  ) {
    push('科技建筑');
  }
  if (
    /装备制造所|战车工厂|船坞|造船厂|造船|空军指挥|空指|维修所|工业工厂|装甲储备|机娘|外骨骼|躯体再造|军工综合体|联合兵工厂|动员兵工城|柔性生产|预测性健康维护|预测维护|重化工业|天启超重总装|基洛夫.*库|无畏.*船坞|潜艇保障|Crusher Crane|工程扩建|制造与总装|弹药制造厂|微型盾构机/.test(
      headProbe,
    )
  ) {
    push('载具建造');
  }
  if (/兵营|军校|训练|复制中心/.test(headProbe)) {
    push('人员相关');
    push('公共设施');
  }
  if (
    /电力分配|变电|焚烧发电|储能|反应炉|反应堆|电站|发电|电源|电网|核聚变|核裂变|脉冲电网|风光|能源|SMR|RTG|快堆|蓄电池|太阳能板/.test(
      headProbe,
    )
  ) {
    push('电力设施');
  }
  if (
    /精炼|采矿|矿业|地质掘进|油井|抽油机|炼油厂|化工合成|煤制油|合成燃料|农田|种植|温室|水培|菌类培养|土壤培育|畜牧|养殖|家禽|水产|昆虫蛋白|屠宰|口粮|粮食加工|食品加工|育种|种质|饲料|纳米合成/.test(
      headProbe,
    )
  ) {
    push('资源产出');
  }
  if (
    /矿料仓|油罐|仓储|冷链|铁路编组|重载军运|动员扩建|物流|管道枢纽|储仓|储罐|前哨节点|Sputnik|后勤站|周转总库|掩蔽库|特种机库|物资库/.test(
      headProbe,
    )
  ) {
    push('物流仓储');
  }
  if (
    /水文|泵站|废水|污水|净水|供水|水循环|垃圾|废物分拣|回收|裂解厂|危废|大气净化|脱硫|碳捕集|有机循环|医疗|医院|营区|生活营区|看押所|食堂|广播|宣传|生态|环卫|环境监测|地下国家连续性|深层地下综合体/.test(
      headProbe,
    )
  ) {
    push('公共设施');
  }

  // 合并 inferItemTags({ name, desc })（不传 tags，确保名称+描述关键词始终参与补充推导）
  for (const d of inferItemTags({ name, desc })) {
    push(d);
  }

  const fullProbe = `${headProbe} ${desc || ''}`;
  if (/电力分配|变电|焚烧发电|储能|反应炉|反应堆|电站/.test(fullProbe)) push('电力设施');
  if (/精炼|采矿|油井|煤制油|合成燃料|农田|温室|水培|畜牧|家禽|水产|屠宰|口粮|育种|饲料|纳米合成/.test(fullProbe)) {
    push('资源产出');
  }
  if (/矿料仓|油罐|仓储|冷链|铁路编组|动员扩建|物流/.test(fullProbe)) push('物流仓储');
  if (
    /装备制造所|战车工厂|船坞|造船厂|空军指挥|空指|维修所|工业工厂|装甲储备|机娘|外骨骼|躯体再造/.test(
      fullProbe,
    )
  ) {
    push('载具建造');
  }
  if (/兵营|军校|复制中心/.test(fullProbe)) {
    push('人员相关');
    push('公共设施');
  }
  if (/实验室|科研|设计局|超算|意识保险库/.test(fullProbe)) push('科技建筑');
  if (/航天|火箭|发射场|卫星|空间站|轨道/.test(fullProbe)) push('航天工业');
  if (
    /防空|炮台|碉堡|哨戒炮|火焰塔|光棱塔|磁暴线圈|巨炮|近防炮|围墙|雷区|掩体|损管|洗消|裂缝产生器|心灵信标|心灵探测/.test(
      fullProbe,
    )
  ) {
    push('防御工事');
  }
  if (/超时空传送|天气控制|铁幕|核弹发射井|基因突变|心灵控制器|天基光棱/.test(fullProbe)) {
    push('战略超武');
  }
  if (/水文|泵站|废水|垃圾|回收|危废|有机循环|医疗|医院|营区|食堂|广播|宣传/.test(fullProbe)) {
    push('公共设施');
  }

  if (result.includes('人员相关')) {
    push('公共设施');
  }

  if (DOMAINS_OF_BUILDING_CACHE.size >= MAX_DOMAINS_OF_BUILDING_CACHE_SIZE) {
    const oldestKey = DOMAINS_OF_BUILDING_CACHE.keys().next().value;
    if (oldestKey !== undefined) DOMAINS_OF_BUILDING_CACHE.delete(oldestKey);
  }
  DOMAINS_OF_BUILDING_CACHE.set(cacheKey, [...result]);

  return result;
}

