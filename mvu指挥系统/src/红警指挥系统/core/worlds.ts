/**
 * 世界适配 manifest（多世界适配·D26）——机器配置真源，与叙事世界书正文彻底分离。
 *
 * 定位：红警指挥系统核心辖区的世界契约表。前端永不解析自然语言世界书；
 *   world_id / 合法货币 / 启用书单 / 观察者 / 位面支线效力等结构化数据一律读本表。
 * 读取方与时机（见《多世界适配总设计.md》E 节）：
 *   - 启动器 Step0（display_name/currencies 展示）、发射管道（worldbook_group/currencies/opening_profile）；
 *   - parsePipeline L2（currencies 白名单校验，按 stat_data.meta.world_id 取，P5 接入）；
 *   - 系统 tab 体检（worldbook_group）。
 * 书单真源：本表 worldbook_group 为唯一书单真源；启动器 worldbookManifest.ts 将于 P6 re-export 本表。
 *
 * ⚠ 现状缺陷备忘：worldbookManifest.ts（阶段 G）xiuzhen 书单漏列「通用·航天工业」（15 本世界书只列 14）。
 *   本表已补全，P6 统一收敛时以本表为准。
 * ⚠ 待建书：「修真·世界适配」P2 建、「赛博朋克2042·世界适配」P4 建——列为目标态 required；
 *   在 P6 接入体检前本表不被引用，故不会提前触发 unavailable 红灯。
 */

/** 位面支线科技在某世界的效力（world_affinities 值枚举） */
export type WorldAffinity = '有效' | '降效' | '无效' | '无法生产';

/** 启用书单条目（book name = 世界书文件名去掉 _世界书.json 后缀） */
export interface WorldbookRef {
  name: string;
  /** true=开局必需（缺失亮红/可修）；false=可选（如运行时归档产物 EVA·动态档案，缺失仅 info） */
  required: boolean;
}

export type WorldCategory = 'concrete' | 'abstract';

export interface WorldManifest {
  /** 唯一键，须与 WORLD_MANIFESTS 的 key 一致 */
  world_id: string;
  /** Step0 世界选择 UI 显示名 */
  display_name: string;
  /** 世界层级分类：concrete=具象世界（完整地理/多纪年/全球战区），abstract=经典/轻量适配世界 */
  category?: WorldCategory;
  /** 是否为开场启动器首选推荐世界 */
  recommended?: boolean;
  /** UI 徽章文案 */
  badge?: string;
  /** 历法格式提示（UI/协议提示；叙事真源在适配书①章） */
  calendar: { label: string; sample: string };
  /** wallet 合法货币白名单（L2 校验 + UI 排序）；中文货币名直接作 wallet record 键（D28） */
  currencies: string[];
  /** 该世界的启用书单（通用组 + 阵营组 + 适配书 + 剧情书 + 协议书） */
  worldbook_group: WorldbookRef[];
  /** 本地科技水位一句话（UI 展示；叙事真源在适配书②章） */
  technology_baseline: string;
  /** 主要观察者简表（开场白/UI；叙事真源在适配书③章） */
  observers: string[];
  /** 位面支线科技在该世界的效力（键=支线名，值=效力枚举） */
  world_affinities: Record<string, WorldAffinity>;
  /** 本地科技引进轨名（后续接 catalog；修真世界暂空） */
  local_import_tracks: string[];
  /** 开局侧写（发射管道用：初始地点 + 开场白基调提示） */
  opening_profile: { location: string; presetHint: string };
}

/** 跨世界共享的通用书组（9 本；含 worldbookManifest.ts 漏列的通用·航天工业） */
const 通用组: WorldbookRef[] = [
  { name: '通用·主建筑', required: true },
  { name: '通用·人员', required: true },
  { name: '通用·工业基础', required: true },
  { name: '通用·装备', required: true },
  { name: '通用·防御辅助', required: true },
  { name: '通用·陆地载具', required: true },
  { name: '通用·空中载具', required: true },
  { name: '通用·水面舰艇', required: true },
  { name: '通用·航天工业', required: true },
];

/** 盟军阵营组（型号本征书，P3 清源后跨世界共享；按参战挂载） */
const 盟军阵营组: WorldbookRef[] = [
  { name: '武备·盟军', required: true },
  { name: '特色科技·盟军', required: true },
];
// ⚠ 机娘·能力档案 技能表现深度世界相关（灵脉监听/神识拟态/灵气检测…），无法像武备侧注简单剥离，
//   首版归 xiuzhen 专属；赛博世界机娘档案属 Growth Tracks（赛博内容首铺）——故不在跨世界阵营组内。

/** MVU 协议书（变量注入 + 战报规约，跨世界共享；含修真专属 uid9，P2 迁出后成纯协议书） */
const 协议书: WorldbookRef = { name: '全域战略指挥系统', required: true };

export const WORLD_MANIFESTS: Record<string, WorldManifest> = {
  cyber2077: {
    world_id: 'cyber2077',
    display_name: '具象世界·赛博朋克2077',
    category: 'concrete',
    recommended: true,
    badge: '具象世界 · 首选推荐',
    calendar: { label: '公历（年-月-日 · 默认2042）', sample: '2042-06-15' },
    currencies: ['欧元', '标准信用币', '加密币'],
    worldbook_group: [
      ...通用组,
      ...盟军阵营组,
      协议书,
      { name: '具象世界·赛博朋克2077', required: true },
      { name: 'EVA·动态档案', required: false },
    ],
    technology_baseline:
      '指挥部拥有完整独立军工母机与跨系科技树，不受企业供应链与黑墙制约；本地在神经义体、旧网AI、轨道天基武器与巨型企业私军领域高度发达。',
    observers: [
      '网络监察（NetWatch）',
      '荒坂情报部与海外舰队',
      '军用科技与NUSA特勤',
      '康陶与苏油勘探兵团',
      '高骑者轨道侦察网',
      '当地收尾人与流浪者哨站',
    ],
    world_affinities: { 灵气共振弹: '无效', 灵沁油: '无法生产', 灵气屏蔽: '降效' },
    local_import_tracks: ['军用级神经义体', '旧网与黑墙攻防套件', 'CHOOH2合成醇工业', '智能武器火控链', '反AI水雷声呐阵列'],
    opening_profile: {
      location: '恶土深处·落基岭与红峰荒原',
      presetHint:
        '血色拓荒与全球暗战基调：依托恶土荒原或海外战略盲区隐蔽展开MCV，规避企业天基与网络侦察，利用战后供应链饥渴打通重工业与军火网络',
    },
  },

  xiuzhen: {
    world_id: 'xiuzhen',
    display_name: '修真正史',
    category: 'abstract',
    badge: '经典战区 · 仙侠潜伏',
    calendar: { label: '修真历（季·月日）', sample: '秋·九月十八' },
    currencies: ['铜钱', '银两', '下品灵石', '中品灵石', '上品灵石'],
    worldbook_group: [
      ...通用组,
      ...盟军阵营组,
      { name: '机娘·能力档案', required: true }, // 世界相关技能表现，首版 xiuzhen 专属
      协议书,
      { name: '修真·世界适配', required: true }, // P2 建
      // 修真×北坡战役剧情/基地层（P3 清源后归本组）
      { name: '剧情·北坡纪事', required: true },
      { name: '北坡采药营地_基地布局', required: true },
      // 运行时 DLC 归档产物：缺失不算开局缺陷
      { name: 'EVA·动态档案', required: false },
    ],
    technology_baseline: '指挥部全面领先，只怕被感知；本地无工业化军备，威胁来自超凡个体。',
    observers: ['修士', '灵觉/神识', '望气者', '宗门', '阵法网络'],
    world_affinities: { 灵气共振弹: '有效', 灵沁油: '有效', 灵气屏蔽: '有效' },
    local_import_tracks: [], // 修真本地引进轨（灵气/阵法/炼器）内容首铺时补
    opening_profile: { location: '青岚山北坡', presetHint: '潜伏发育·藏字诀基调' },
  },

  cyber2042: {
    world_id: 'cyber2042',
    display_name: '赛博朋克2042',
    category: 'abstract',
    badge: '轻量适配 · 自创都市',
    calendar: { label: '公历（年-月-日）', sample: '2042-03-14' },
    // 自创信用货币（不用现成 IP 专名）；首版占位，赛博内容首铺（Growth Tracks）时终定
    currencies: ['标准信用币', '加密币'],
    worldbook_group: [
      ...通用组,
      ...盟军阵营组,
      协议书,
      { name: '赛博朋克2042·世界适配', required: true }, // P4 建
    ],
    technology_baseline: '指挥部军工体系完整且不受本地监管；本地在网络战/义体/AI/城市监控局部领先。',
    observers: ['城市天网', '企业情报机构', 'AI关联分析', '网络安全系统', '金融监管', '物流平台'],
    world_affinities: { 灵气共振弹: '无效', 灵沁油: '无法生产', 灵气屏蔽: '降效' },
    local_import_tracks: ['义体改造', '网络战套件', '本地AI', '城市无人机'],
    opening_profile: { location: '（自创城市·首铺时定）', presetHint: '数据身份+资金流+物流双重隐匿' },
  },
};

/** 全部已注册 world_id（发射管道排他启停用：停"其他世界组书"时枚举） */
export const WORLD_IDS: string[] = Object.keys(WORLD_MANIFESTS);

/** 按 world_id 取 manifest（未注册返回 undefined，供 C 节"world_id 非法"分支判定） */
export function getWorldManifest(worldId: string): WorldManifest | undefined {
  return WORLD_MANIFESTS[worldId];
}

/** 某世界的某货币名是否合法（P5 L2 白名单校验用；world_id 非法时返回 false 不放行） */
export function isLegalCurrency(worldId: string, currency: string): boolean {
  return WORLD_MANIFESTS[worldId]?.currencies.includes(currency) ?? false;
}

/** 全部世界组书的并集（发射管道"停其他世界专属书"时的候选集；通用/阵营共享书不在此列） */
export function allWorldExclusiveBooks(): string[] {
  const shared = new Set([...通用组, ...盟军阵营组, 协议书].map(b => b.name));
  const set = new Set<string>();
  for (const m of Object.values(WORLD_MANIFESTS)) {
    for (const b of m.worldbook_group) if (!shared.has(b.name)) set.add(b.name);
  }
  return [...set];
}
