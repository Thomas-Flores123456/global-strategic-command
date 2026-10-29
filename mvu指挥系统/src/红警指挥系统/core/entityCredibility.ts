/**
 * entityCredibility.ts —— 全系统通用「实体语义向量与可信度对齐引擎」
 *
 * 设计契约与红线（FD-27）：
 * 1. 世界书唯一事实源（SSOT）：直接以世界书 `<数据>` 块解析出的目录（EffectiveCatalog / ParsedWorldbookCatalog）为权威索引源；
 * 2. 100% 同步纯函数：零 Pinia、零 Vue、零宿主 API、零异步网络 IO，单次查询耗时 < 0.5 ms；
 * 3. 六大业务域统一：同时服务 research（科技）、building（建筑）、production（生产）、retrofit（改装）、project（巨构/天基工程）、protocol（条令）；
 * 4. 三层混合评估：
 *    - L1 确定性层（score = 1.00）：exact / canon / alias / upgrade_chain
 *    - L2 双擎混合向量层（score = 0.00 ~ 0.99）：IDF 逆文档频率加权子词软余弦 + 领域语义同义概念簇投影 + 可选 Model2Vec 64d Int8 静态向量查表槽 + 上下文印证加分
 *    - L3 三档可信度裁决门：system_high (>= 0.80) | system_suspect (0.52 ~ 0.80) | novel_eva (< 0.52)
 */

import { toSimplified } from '../parse/t2s';

export type EntityDomain =
  | 'research'
  | 'building'
  | 'production'
  | 'retrofit'
  | 'project'
  | 'protocol'
  | 'any';

export type SpecificEntityDomain = Exclude<EntityDomain, 'any'>;

export type CredibilityVerdict = 'system_high' | 'system_suspect' | 'novel_eva';

export type CredibilityStage =
  | 'exact'
  | 'canon'
  | 'alias'
  | 'upgrade_chain'
  | 'hybrid_vector'
  | 'miss';

export interface CredibilityCandidate {
  name: string;
  domain: SpecificEntityDomain;
  score: number;
  reason: string;
}

export interface CredibilityContext {
  line?: string;
  category?: string;
  faction?: string;
  prerequisites?: readonly string[];
}

export interface CredibilityOptions {
  domain?: EntityDomain;
  /** 高可信阈值（默认 0.80） */
  highThreshold?: number;
  /** 疑似阈值（默认 0.52） */
  suspectThreshold?: number;
  /** 返回候选数量上限（默认 3） */
  topK?: number;
  /** 同楼上下文辅助加分信号 */
  context?: CredibilityContext;
}

export interface CredibilityResult {
  query: string;
  domain: EntityDomain;
  verdict: CredibilityVerdict;
  /** 0.00 ~ 1.00 综合可信度评分 */
  score: number;
  stage: CredibilityStage;
  /** 最佳命中世界书标准名（novel_eva 时为 null） */
  matchedName: string | null;
  matchedDomain: SpecificEntityDomain | null;
  /** Top-K 候选列表 */
  candidates: CredibilityCandidate[];
}

/**
 * Model2Vec / StaticEmbedding 64d~128d Int8 静态向量查表扩展槽接口
 * 支持构建期离线裁剪注入，运行时纯同步查表 + L2 归一化点积
 */
export interface StaticInt8EmbeddingTable {
  dims: number;
  vocab: Readonly<Record<string, number>>;
  int8Data: Int8Array;
  scales: Float32Array;
}

export interface CatalogEntityLike {
  id?: string;
  name: string;
  aliases?: readonly string[];
  line?: string;
  category?: string;
  faction?: string;
  prereqs?: readonly string[];
  research?: string | null;
  upgraded_name?: string | Record<string, string>;
  host_building?: string | readonly string[];
  target_unit?: string | readonly string[];
}

export interface EntityCredibilityCatalogInput {
  researches?: readonly CatalogEntityLike[];
  buildings?: readonly CatalogEntityLike[];
  productions?: readonly CatalogEntityLike[];
  retrofits?: readonly CatalogEntityLike[];
  projects?: readonly CatalogEntityLike[];
  protocols?: readonly CatalogEntityLike[];
  /** 兼容扁平权威名列表（缺省归入 'research' 通用池或跨池匹配） */
  names?: readonly string[];
}

interface IndexedEntityRecord {
  name: string;
  id?: string;
  domain: SpecificEntityDomain;
  canonName: string;
  strippedCanonName: string;
  coreCanonName: string;
  conceptCanonName: string;
  alphaNumTokens: string[];
  explicitFaction: string | null;
  line?: string;
  category?: string;
  faction?: string;
  prereqs: string[];
  /** 特征 Token -> 原始权重（未乘 IDF） */
  rawFeatures: Map<string, number>;
  /** 去除壳词后的核心实词集合 */
  coreTokens: Set<string>;
  /** 乘以 IDF 并做 L2 归一化后的稀疏向量 */
  tfidfVector: Map<string, number>;
  /** 可选静态 Int8 嵌入池化后的单位向量 */
  staticVector: Float32Array | null;
}

export interface EntityCredibilityIndex {
  readonly records: readonly IndexedEntityRecord[];
  readonly byDomain: Readonly<Record<SpecificEntityDomain, readonly IndexedEntityRecord[]>>;
  readonly exactMap: ReadonlyMap<string, IndexedEntityRecord[]>;
  readonly canonMap: ReadonlyMap<string, IndexedEntityRecord[]>;
  readonly strippedCanonMap: ReadonlyMap<string, IndexedEntityRecord[]>;
  readonly aliasMap: ReadonlyMap<string, { targetName: string; domain?: SpecificEntityDomain }>;
  readonly upgradeChainMap: ReadonlyMap<string, IndexedEntityRecord>;
  readonly idfMap: ReadonlyMap<string, number>;
  readonly totalDocs: number;
}

/* ═══════════════ 可选静态向量表注册槽 ═══════════════ */

let registeredStaticEmbeddingTable: StaticInt8EmbeddingTable | null = null;

export function registerStaticEmbeddingTable(table: StaticInt8EmbeddingTable | null): void {
  registeredStaticEmbeddingTable = table;
}

export function getRegisteredStaticEmbeddingTable(): StaticInt8EmbeddingTable | null {
  return registeredStaticEmbeddingTable;
}

/* ═══════════════ 规范化与领域词典 ═══════════════ */

const TRAD_TO_SIMP: Readonly<Record<string, string>> = {
  戰: '战', 況: '况', 隊: '队', 軍: '军', 車: '车', 艦: '舰', 機: '机', 場: '场',
  廠: '厂', 電: '电', 網: '网', 礦: '矿', 煉: '炼', 彈: '弹', 藥: '药', 醫: '医',
  療: '疗', 護: '护', 衛: '卫', 導: '导', 砲: '炮', 銃: '铳', 裝: '装', 備: '备',
  載: '载', 輸: '输', 運: '运', 動: '动', 氣: '气', 輪: '轮', 潛: '潜', 艇: '艇',
  學: '学', 術: '术', 研: '研', 究: '究', 實: '实', 驗: '验', 構: '构',
  築: '筑', 設: '设', 施: '施', 陣: '阵', 營: '营', 聯: '联', 蘇: '苏', 維: '维',
  亞: '亚', 歐: '欧', 門: '门', 閥: '阀', 鎖: '锁', 鏈: '链', 錢: '钱', 幣: '币',
  資: '资', 源: '源', 儲: '储', 倉: '仓', 庫: '库', 協: '协', 議: '议', 條: '条',
  約: '约', 統: '统', 帥: '帅', 樞: '枢', 紐: '纽', 節: '节', 點: '点', 軌: '轨',
  道: '道', 艙: '舱', 測: '测', 控: '控', 發: '发', 射: '射',
  核: '核', 輻: '辐', 磁: '磁', 稜: '棱', 鏡: '镜', 納: '纳', 米: '米', 纖: '纤',
  剛: '刚', 鋼: '钢', 鐵: '铁', 鋁: '铝', 鈦: '钛', 鈾: '铀', 鈽: '钚', 氫: '氢',
};

const ROMAN_MAP: Readonly<Record<string, string>> = {
  'Ⅰ': '1', 'Ⅱ': '2', 'Ⅲ': '3', 'Ⅳ': '4', 'Ⅴ': '5',
  'Ⅵ': '6', 'Ⅶ': '7', 'Ⅷ': '8', 'Ⅸ': '9', 'Ⅹ': '10',
  'ⅰ': '1', 'ⅱ': '2', 'ⅲ': '3', 'ⅳ': '4', 'ⅴ': '5',
};

/**
 * 实体名基础归一（繁转简、全角转半角、罗马数字归一、去首尾空白与无意义符号）
 */
export function canonEntityKey(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const s = toSimplified(raw.trim());
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ROMAN_MAP[ch]) {
      out += ROMAN_MAP[ch];
      continue;
    }
    if (TRAD_TO_SIMP[ch]) {
      out += TRAD_TO_SIMP[ch];
      continue;
    }
    const code = ch.charCodeAt(0);
    // 全角 ASCII 转半角
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
    } else if (code === 0x3000) {
      out += ' ';
    } else {
      out += ch;
    }
  }
  return out
    .toLowerCase()
    .replace(/[\s·•・_—–\-/\\:：,，.。()（）[\]【】「」『』<>《》"'“”‘’]+/g, '');
}

/**
 * 剥离显式阵营前缀标记后的归一键（如 "[盟军] 低可观测技术工学" -> "低可观测技术工学"）
 * 注意：仅剥离带括号/分隔符的前缀，避免将 "盟军建造厂" 剥成 "建造厂" 造成跨阵营误撞。
 */
export function stripFactionPrefix(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(
      /^(?:\[(?:盟军|苏联|苏军|苏维埃|尤里|通用|焚风|帝国)\]|\((?:盟军|苏联|苏军|苏维埃|尤里|通用|焚风|帝国)\)|（(?:盟军|苏联|苏军|苏维埃|尤里|通用|焚风|帝国)）|(?:盟军|苏联|苏军|苏维埃|尤里|通用|焚风|帝国)\s*[·•・\-—:：/]\s*)/u,
      '',
    )
    .trim();
}

/**
 * 领域高频壳词（Shell / Stop Suffixes & Prefixes）
 * 在向量化时大幅降低这些词的权重，防止“XX工学”与“YY工学”仅因后缀相同而获得虚高相似度。
 */
const SHELL_TOKEN_WEIGHTS: Readonly<Record<string, number>> = {
  工学: 0.15,
  技术: 0.15,
  工程学: 0.15,
  技术学: 0.15,
  理论: 0.18,
  研究: 0.15,
  学说: 0.18,
  基础: 0.22,
  先进: 0.22,
  高级: 0.22,
  现代: 0.22,
  现代化: 0.25,
  系统: 0.20,
  工程: 0.20,
  实现: 0.18,
  方案: 0.18,
  计划: 0.18,
  项目: 0.18,
  专案: 0.18,
  协议: 0.18,
  条令: 0.18,
  条约: 0.18,
  升级: 0.25,
  改造: 0.25,
  改装: 0.25,
  延寿: 0.30,
  阵地: 0.25,
  设施: 0.22,
  装置: 0.22,
  中心: 0.22,
  节点: 0.22,
  综合体: 0.25,
  车间: 0.28,
  工厂: 0.28,
  平台: 0.25,
  阵列: 0.28,
  模块: 0.35,
  战术: 0.25,
  战略: 0.25,
  战地: 0.25,
  野战: 0.28,
  制式: 0.22,
  通用: 0.20,
  标准: 0.22,
  训练: 0.30,
  制造: 0.25,
  合成: 0.30,
  处理: 0.25,
  应用: 0.20,
};

const SHELL_STRIP_REGEX =
  /(?:现代化改造工程|现代化改装工程|现代化升级工程|现代化改造|现代化改装|现代化升级|延寿改造|延寿升级|工程实现|技术实现|工程学|技术工学|技术学|工学|技术|理论|研究|学说|升级包|升级|改造|改装|延寿|实现|工程|系统|计划|方案|项目|专案|协议|条令|基础|先进|高级|现代|制式|标准|体系族|族|学)$/g;

/**
 * 剥离尾部常见壳词后的核心干词（用于快速检测“核心词根完全一致、仅壳词/语序变化”）
 */
export function extractCoreStem(raw: string): string {
  let s = stripFactionPrefix(raw);
  // 连续剥离 1~3 层尾部壳词（例如 "低可观测技术工学" -> "低可观测"，"逆向工程实现" -> "逆向"）
  for (let i = 0; i < 3; i++) {
    const next = s.replace(SHELL_STRIP_REGEX, '').trim();
    if (!next || next === s || next.length < 2) break;
    s = next;
  }
  // 剥离头部修饰壳词（如 "先进"、"基础"、"现代"）
  const headStripped = s.replace(/^(?:基础|先进|高级|现代化|现代|标准|制式|战术|战略)/, '').trim();
  if (headStripped.length >= 2) {
    s = headStripped;
  }
  return canonEntityKey(s);
}

const STEM_CONCEPT_NORMALIZERS: ReadonlyArray<{ pattern: RegExp; token: string }> = [
  { pattern: /(?:隐身低可观测|低可观测隐身|雷达隐身|低可观测|隐身|隐形)/g, token: '<stealth>' },
  { pattern: /(?:小型模块化|模块化小型|微型模块化|模块化微堆|smr)/g, token: '<smr>' },
  { pattern: /(?:核反应堆|核裂变堆|反应堆|核能|核电|核动力|核裂变|原子能)/g, token: '<nuclear>' },
  { pattern: /(?:逆向工程|战利品逆向|科技逆向|逆向拆解)/g, token: '<reverse>' },
  { pattern: /(?:心灵控制|精神控制|脑波控制|心灵支配|精神支配|心控)/g, token: '<mind>' },
  { pattern: /(?:主战|重型|轻型|中型)?坦克(?:族)?/g, token: '<tank>' },
];

/**
 * 将核心干词中的强等价领域同义词规约为统一概念槽位（解决如“小型模块化核反应堆研究”<->“小型模块化核能工学”、“隐身低可观测技术”<->“低可观测技术工学”）
 */
export function extractConceptCanonicalStem(raw: string): string {
  let stem = extractCoreStem(raw);
  if (!stem) return '';
  for (const { pattern, token } of STEM_CONCEPT_NORMALIZERS) {
    stem = stem.replace(pattern, token);
  }
  // 合并相邻重复的概念标签（如“隐身低可观测” -> "<stealth><stealth>" -> "<stealth>"）
  stem = stem.replace(/(<[a-z_]+>)\1+/g, '$1');
  return stem;
}

function extractAlphaNumTokens(raw: string): string[] {
  const cleaned = stripFactionPrefix(raw).toLowerCase();
  const matches = cleaned.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g);
  if (!matches) return [];
  const out: string[] = [];
  for (const m of matches) {
    const norm = m.replace(/-/g, '');
    if (norm.length >= 2 || /\d/.test(norm)) {
      if (!out.includes(norm)) out.push(norm);
    }
  }
  return out;
}

function detectExplicitFaction(raw: string, itemFaction?: string): string | null {
  const src = `${raw} ${itemFaction ?? ''}`;
  if (/盟军|allied/i.test(src)) return '盟军';
  if (/苏联|苏军|苏维埃|soviet/i.test(src)) return '苏联';
  if (/尤里|yuri/i.test(src)) return '尤里';
  if (/焚风|foehn/i.test(src)) return '焚风';
  if (/帝国|升阳|empire/i.test(src)) return '帝国';
  return null;
}

/**
 * 领域同义概念簇（Concept Synsets）
 * 将红警/科幻/军工中常见的同义异形表述投射到统一的概念维度 `#concept:<id>`
 */
const DOMAIN_CONCEPT_SYNSETS: ReadonlyArray<{ id: string; terms: readonly string[]; weight: number }> = [
  { id: 'stealth', terms: ['低可观测', '隐身', '隐形', '吸波', '雷达隐身', '反雷达', '光学迷彩'], weight: 1.6 },
  { id: 'smr', terms: ['小型模块化', '模块化小型', '模块化微堆', '微型模块化', 'smr'], weight: 1.7 },
  { id: 'nuclear', terms: ['核能', '核电', '核反应堆', '核裂变', '核动力', '反应堆', '原子能'], weight: 1.5 },
  { id: 'fast_breeder', terms: ['快堆', '快中子', '增殖堆', '钠冷快堆'], weight: 1.7 },
  { id: 'fusion', terms: ['核聚变', '聚变堆', '受控聚变', '托卡马克', '冷聚变'], weight: 1.7 },
  { id: 'prism', terms: ['光棱', '棱镜', '光谱聚焦', '光束折射', '高能激光聚焦'], weight: 1.7 },
  { id: 'tesla', terms: ['磁暴', '特斯拉', '高压电弧', '电弧放电', '磁能'], weight: 1.7 },
  { id: 'chrono', terms: ['超时空', '时空折跃', '相位传输', '次元传送', '空间折跃'], weight: 1.7 },
  { id: 'iron_curtain', terms: ['铁幕', '纳米力场', '绝对防御力场', '不可侵犯力场'], weight: 1.7 },
  { id: 'weather_ctrl', terms: ['天气控制', '气象控制', '闪电风暴', '人工气象'], weight: 1.7 },
  { id: 'mind_ctrl', terms: ['心灵控制', '心控', '精神控制', '脑波控制', '心灵支配', '精神支配', '心灵突击'], weight: 1.7 },
  { id: 'genetic', terms: ['基因突变', '基因工程', '基因调制', '狂兽人基因', '生物基因'], weight: 1.6 },
  { id: 'cloning', terms: ['克隆', '复制中心', '基因克隆', '生物复制'], weight: 1.6 },
  { id: 'reverse_eng', terms: ['逆向工程', '逆向拆解', '战利品逆向', '科技逆向', '测绘仿制'], weight: 1.6 },
  { id: 'anti_air', terms: ['防空', '高射', '对空拦截', '防空导弹', '防空拦截', '野战防空', '近程防空'], weight: 1.4 },
  { id: 'anti_armor', terms: ['反装甲', '反坦克', '破甲', '穿甲'], weight: 1.4 },
  { id: 'hydroponics', terms: ['水培', '无土栽培', '垂直农业', '水培种植'], weight: 1.6 },
  { id: 'nanite', terms: ['纳米', '纳米机械', '纳米合成', '分子组装'], weight: 1.4 },
  { id: 'computing', terms: ['超算', '超级计算', '算力', '量子计算', '大型机'], weight: 1.5 },
  { id: 'orbital', terms: ['天基', '轨道', '近地轨道', '卫星', '空间站', '航天'], weight: 1.4 },
  { id: 'power_gen', terms: ['发电', '电站', '发电厂', '电力供应', '供能'], weight: 1.3 },
  { id: 'refinery', terms: ['精炼', '矿石精炼', '采矿', '选矿', '提纯'], weight: 1.4 },
  { id: 'barracks', terms: ['兵营', '步兵训练', '募兵'], weight: 1.4 },
  { id: 'war_factory', terms: ['战车工厂', '装甲工厂', '载具总装', '重工'], weight: 1.4 },
  { id: 'airfield', terms: ['空指部', '空军指挥部', '机场', '航空基地', '停机坪'], weight: 1.4 },
  { id: 'shipyard', terms: ['船厂', '造船厂', '海军船坞', '舰艇船坞'], weight: 1.4 },
  { id: 'battle_lab', terms: ['战斗实验室', '作战实验室', '心灵研究实验室', '心灵实验室'], weight: 1.5 },
];

/**
 * 提取文本的子词特征（2-gram 词根 + 核心 1-gram + 英文/数字块 + 领域同义簇投影）
 */
export function tokenizeEntityFeatures(raw: string): {
  features: Map<string, number>;
  coreTokens: Set<string>;
} {
  const features = new Map<string, number>();
  const coreTokens = new Set<string>();

  const cleaned = stripFactionPrefix(raw).trim();
  if (!cleaned) return { features, coreTokens };

  const addFeature = (token: string, weight: number, isCore = false) => {
    if (!token) return;
    features.set(token, (features.get(token) ?? 0) + weight);
    if (isCore) coreTokens.add(token);
  };

  // 1. 领域同义概念簇投影（Concept Synsets）
  const normFull = canonEntityKey(cleaned);
  for (const synset of DOMAIN_CONCEPT_SYNSETS) {
    for (const term of synset.terms) {
      const termCanon = canonEntityKey(term);
      if (termCanon && normFull.includes(termCanon)) {
        addFeature(`#concept:${synset.id}`, synset.weight, true);
        break;
      }
    }
  }

  // 2. 提取英文/数字代号块（如 c4isr, pac3, f16c, smr, m1a2, t80）
  const alphaNumMatches = cleaned.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g);
  if (alphaNumMatches) {
    for (const rawBlock of alphaNumMatches) {
      const block = rawBlock.replace(/-/g, '');
      if (block.length >= 2 || /\d/.test(block)) {
        addFeature(`#en:${block}`, 1.6, true);
      }
    }
  }

  // 3. 提取核心干词（剥离常见壳词后的部分）
  const coreStem = extractCoreStem(cleaned);
  const cjkCore = coreStem.replace(/[a-z0-9]/g, '');

  // 对核心干词提取 2-gram 与 1-gram（高权重）
  if (cjkCore.length >= 2) {
    for (let i = 0; i < cjkCore.length - 1; i++) {
      const bg = cjkCore.slice(i, i + 2);
      const w = SHELL_TOKEN_WEIGHTS[bg] ?? 1.25;
      addFeature(`#bg:${bg}`, w, w >= 0.8);
    }
    if (cjkCore.length >= 3) {
      for (let i = 0; i < cjkCore.length - 2; i++) {
        const tg = cjkCore.slice(i, i + 3);
        if (!(tg in SHELL_TOKEN_WEIGHTS)) {
          addFeature(`#tg:${tg}`, 1.1, true);
        }
      }
    }
  }
  for (let i = 0; i < cjkCore.length; i++) {
    const ug = cjkCore[i];
    if (ug === '学' || ug === '术' || ug === '型' || ug === '式') continue;
    addFeature(`#ug:${ug}`, 0.55, true);
  }

  // 4. 对完整文本补充壳词特征（低权重，仅用于同词根下区分不同壳词）
  const fullCjk = normFull.replace(/[a-z0-9]/g, '');
  if (fullCjk.length >= 2) {
    for (let i = 0; i < fullCjk.length - 1; i++) {
      const bg = fullCjk.slice(i, i + 2);
      if (!features.has(`#bg:${bg}`)) {
        const shellWeight = SHELL_TOKEN_WEIGHTS[bg] ?? 0.35;
        addFeature(`#bg:${bg}`, shellWeight, false);
      }
    }
  }

  return { features, coreTokens };
}

/* ═══════════════ Static Int8 Embedding 查表与池化 ═══════════════ */

function computeStaticInt8Vector(text: string, table: StaticInt8EmbeddingTable | null): Float32Array | null {
  if (!table || table.dims <= 0) return null;
  const norm = canonEntityKey(text);
  if (!norm) return null;

  const matchedIds: number[] = [];
  const directId = table.vocab[text.trim()] ?? table.vocab[norm];
  if (directId !== undefined) {
    matchedIds.push(directId);
  }
  // 检查词表中长度 >= 3 的多字子词
  for (const [vocabToken, tokenId] of Object.entries(table.vocab)) {
    if (vocabToken.length >= 3) {
      const vtCanon = canonEntityKey(vocabToken);
      if (vtCanon.length >= 3 && norm.includes(vtCanon)) {
        matchedIds.push(tokenId);
      }
    }
  }
  // 2-gram / 1-gram 子词查表
  for (let i = 0; i < norm.length; i++) {
    if (i + 2 <= norm.length) {
      const bg = norm.slice(i, i + 2);
      const bgId = table.vocab[bg];
      if (bgId !== undefined) matchedIds.push(bgId);
    }
    const ug = norm[i];
    const ugId = table.vocab[ug];
    if (ugId !== undefined) matchedIds.push(ugId);
  }
  if (matchedIds.length === 0) return null;

  const dims = table.dims;
  const out = new Float32Array(dims);
  for (const id of matchedIds) {
    const scale = table.scales[id] ?? 1;
    const offset = id * dims;
    for (let d = 0; d < dims; d++) {
      out[d] += (table.int8Data[offset + d] ?? 0) * scale;
    }
  }

  let normSq = 0;
  for (let d = 0; d < dims; d++) {
    out[d] /= matchedIds.length;
    normSq += out[d] * out[d];
  }
  if (normSq <= 1e-12) return null;
  const invNorm = 1 / Math.sqrt(normSq);
  for (let d = 0; d < dims; d++) {
    out[d] *= invNorm;
  }
  return out;
}

function dotFloat32(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
}

/* ═══════════════ 索引构建 ═══════════════ */

const ALL_SPECIFIC_DOMAINS: readonly SpecificEntityDomain[] = [
  'research',
  'building',
  'production',
  'retrofit',
  'project',
  'protocol',
];

/**
 * 从世界书 EffectiveCatalog 构建全品类实体可信度与双擎向量索引
 */
export function buildEntityCredibilityIndex(
  catalog?: EntityCredibilityCatalogInput | null,
  customAliases?: Readonly<Record<string, string>> | null,
): EntityCredibilityIndex {
  const records: IndexedEntityRecord[] = [];
  const byDomain: Record<SpecificEntityDomain, IndexedEntityRecord[]> = {
    research: [],
    building: [],
    production: [],
    retrofit: [],
    project: [],
    protocol: [],
  };
  const exactMap = new Map<string, IndexedEntityRecord[]>();
  const canonMap = new Map<string, IndexedEntityRecord[]>();
  const strippedCanonMap = new Map<string, IndexedEntityRecord[]>();
  const aliasMap = new Map<string, { targetName: string; domain?: SpecificEntityDomain }>();
  const upgradeChainMap = new Map<string, IndexedEntityRecord>();

  const pushMapList = (map: Map<string, IndexedEntityRecord[]>, key: string, rec: IndexedEntityRecord) => {
    if (!key) return;
    const list = map.get(key);
    if (list) {
      if (!list.some(r => r.name === rec.name && r.domain === rec.domain)) list.push(rec);
    } else {
      map.set(key, [rec]);
    }
  };

  const registerAlias = (
    aliasRaw: string,
    targetName: string,
    domain?: SpecificEntityDomain,
    onlyIfAbsent = false,
  ) => {
    const aTrim = aliasRaw.trim();
    const tTrim = targetName.trim();
    if (!aTrim || !tTrim || aTrim === tTrim) return;
    const aCanon = canonEntityKey(aTrim);
    if (!onlyIfAbsent || !aliasMap.has(aTrim)) {
      aliasMap.set(aTrim, { targetName: tTrim, domain });
    }
    if (aCanon && (!onlyIfAbsent || !aliasMap.has(aCanon))) {
      aliasMap.set(aCanon, { targetName: tTrim, domain });
    }
  };

  const staticTable = registeredStaticEmbeddingTable;
  const seenKey = new Set<string>();

  const addDomainItems = (domain: SpecificEntityDomain, items?: readonly CatalogEntityLike[]) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      if (!name) continue;
      const dedupKey = `${domain}::${name}`;
      if (seenKey.has(dedupKey)) continue;
      seenKey.add(dedupKey);

      const canonName = canonEntityKey(name);
      const strippedCanonName = canonEntityKey(stripFactionPrefix(name));
      const coreCanonName = extractCoreStem(name);
      const conceptCanonName = extractConceptCanonicalStem(name);
      const alphaNumTokens = extractAlphaNumTokens(name);
      const explicitFaction = detectExplicitFaction(name, item.faction);
      const { features, coreTokens } = tokenizeEntityFeatures(name);

      const prereqs: string[] = [];
      if (Array.isArray(item.prereqs)) {
        for (const p of item.prereqs) if (typeof p === 'string' && p.trim()) prereqs.push(p.trim());
      }
      if (typeof item.research === 'string' && item.research.trim()) {
        prereqs.push(item.research.trim());
      }

      const rec: IndexedEntityRecord = {
        name,
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : undefined,
        domain,
        canonName,
        strippedCanonName,
        coreCanonName,
        conceptCanonName,
        alphaNumTokens,
        explicitFaction,
        line: typeof item.line === 'string' ? item.line : undefined,
        category: typeof item.category === 'string' ? item.category : undefined,
        faction: typeof item.faction === 'string' ? item.faction : undefined,
        prereqs,
        rawFeatures: features,
        coreTokens,
        tfidfVector: new Map(),
        staticVector: computeStaticInt8Vector(name, staticTable),
      };

      records.push(rec);
      byDomain[domain].push(rec);

      pushMapList(exactMap, name, rec);
      if (rec.id) {
        pushMapList(exactMap, rec.id, rec);
        pushMapList(canonMap, canonEntityKey(rec.id), rec);
      }
      pushMapList(canonMap, canonName, rec);
      pushMapList(strippedCanonMap, strippedCanonName, rec);

      // 注册世界书条目自带 aliases
      if (Array.isArray(item.aliases)) {
        for (const a of item.aliases) {
          if (typeof a === 'string' && a.trim()) {
            registerAlias(a, name, domain);
          }
        }
      }

      // 生产单位族名/带修饰词标准名内生同域简称衍生（如「犀牛主战坦克族」→「犀牛主战坦克」/「犀牛坦克」）
      if (domain === 'production') {
        const noFamilySuffix = name.replace(/(?:体系族|族)$/u, '').trim();
        if (noFamilySuffix.length >= 2 && noFamilySuffix !== name) {
          registerAlias(noFamilySuffix, name, domain, true);
        }
        const tankMatch = noFamilySuffix.match(/^(?:[A-Za-z0-9+-]+\s*)?([\u4e00-\u9fa5]{2,})(?:主战|重型|轻型|中型)坦克$/u);
        if (tankMatch) {
          const cjkPrefix = tankMatch[1];
          registerAlias(`${cjkPrefix}主战坦克`, name, domain, true);
          registerAlias(`${cjkPrefix}坦克`, name, domain, true);
        }
        const dotIdx = name.indexOf('·');
        if (dotIdx >= 3) {
          const baseTitle = name.slice(0, dotIdx).trim();
          if (baseTitle.length >= 3) {
            registerAlias(baseTitle, name, domain, true);
          }
        }
        if (name === '通用履带底盘与空降轻装族') {
          registerAlias('防空履带车', name, domain, true);
          registerAlias('苏联防空履带车', name, domain, true);
          registerAlias('履带防空车', name, domain, true);
        }
      }

      if (domain === 'building') {
        if (name.includes('战斗实验室')) {
          registerAlias(name.replace('战斗实验室', '作战实验室'), name, domain, true);
        }
        if (name.includes('作战实验室')) {
          registerAlias(name.replace('作战实验室', '战斗实验室'), name, domain, true);
        }
        if (name === '尤里心灵研究实验室') {
          registerAlias('尤里作战实验室', name, domain, true);
          registerAlias('尤里战斗实验室', name, domain, true);
          registerAlias('尤里心灵实验室', name, domain, true);
        }
      }

      // 注册升级链名称（upgraded_name）
      if (typeof item.upgraded_name === 'string' && item.upgraded_name.trim()) {
        const upg = item.upgraded_name.trim();
        upgradeChainMap.set(upg, rec);
        upgradeChainMap.set(canonEntityKey(upg), rec);
      } else if (item.upgraded_name && typeof item.upgraded_name === 'object') {
        for (const upg of Object.values(item.upgraded_name)) {
          if (typeof upg === 'string' && upg.trim()) {
            upgradeChainMap.set(upg.trim(), rec);
            upgradeChainMap.set(canonEntityKey(upg.trim()), rec);
          }
        }
      }
    }
  };

  if (catalog) {
    addDomainItems('research', catalog.researches);
    addDomainItems('building', catalog.buildings);
    addDomainItems('production', catalog.productions);
    addDomainItems('retrofit', catalog.retrofits);
    addDomainItems('project', catalog.projects);
    addDomainItems('protocol', catalog.protocols);

    // 兼容扁平 names 输入（仅补入尚未在六大域出现的条目）
    if (Array.isArray(catalog.names)) {
      const existingNames = new Set(records.map(r => r.name));
      const extraResearches: CatalogEntityLike[] = [];
      for (const rawName of catalog.names) {
        const n = typeof rawName === 'string' ? rawName.trim() : '';
        if (n && !existingNames.has(n)) {
          existingNames.add(n);
          extraResearches.push({ name: n });
        }
      }
      if (extraResearches.length > 0) {
        addDomainItems('research', extraResearches);
      }
    }
  }

  // 注册用户/运行时自定义别名（优先级高于世界书内置别名）
  if (customAliases) {
    for (const [k, v] of Object.entries(customAliases)) {
      if (typeof k === 'string' && typeof v === 'string') {
        registerAlias(k, v);
      }
    }
  }

  // 计算全局 Token IDF 并归一化每个条目的 TF-IDF 向量
  const dfMap = new Map<string, number>();
  for (const rec of records) {
    for (const token of rec.rawFeatures.keys()) {
      dfMap.set(token, (dfMap.get(token) ?? 0) + 1);
    }
  }

  const totalDocs = Math.max(1, records.length);
  const idfMap = new Map<string, number>();
  for (const [token, df] of dfMap.entries()) {
    // 平滑 IDF：越稀有的核心词根权重越高，满大街的壳词权重进一步被压低
    const idf = Math.log(1 + (totalDocs + 1) / (df + 0.5));
    idfMap.set(token, idf);
  }

  for (const rec of records) {
    let normSq = 0;
    for (const [token, rawWeight] of rec.rawFeatures.entries()) {
      const idf = idfMap.get(token) ?? 1.0;
      const w = rawWeight * idf;
      rec.tfidfVector.set(token, w);
      normSq += w * w;
    }
    if (normSq > 1e-12) {
      const invNorm = 1 / Math.sqrt(normSq);
      for (const [token, w] of rec.tfidfVector.entries()) {
        rec.tfidfVector.set(token, w * invNorm);
      }
    }
  }

  return {
    records,
    byDomain,
    exactMap,
    canonMap,
    strippedCanonMap,
    aliasMap,
    upgradeChainMap,
    idfMap,
    totalDocs,
  };
}

/* ═══════════════ 双擎混合评分与裁决 ═══════════════ */

function filterRecordsByDomain(
  records: readonly IndexedEntityRecord[],
  domain: EntityDomain,
): readonly IndexedEntityRecord[] {
  if (domain === 'any') return records;
  const domainMatches = records.filter(r => r.domain === domain);
  return domainMatches.length > 0 ? domainMatches : [];
}

function computeHybridSimilarity(
  queryCoreStem: string,
  queryConceptStem: string,
  queryAlphaNums: readonly string[],
  queryExplicitFaction: string | null,
  queryTfidf: Map<string, number>,
  queryCoreTokens: Set<string>,
  queryStaticVec: Float32Array | null,
  candidate: IndexedEntityRecord,
  index: EntityCredibilityIndex,
  context?: CredibilityContext,
): { score: number; reason: string } {
  // 0. 显式阵营或型号代号互斥护栏（防止跨阵营建筑或 T-72 vs T-80 误撞）
  if (
    queryExplicitFaction &&
    candidate.explicitFaction &&
    queryExplicitFaction !== candidate.explicitFaction
  ) {
    return { score: 0.25, reason: '显式阵营互斥' };
  }
  if (queryAlphaNums.length > 0 && candidate.alphaNumTokens.length > 0) {
    const hasCommonCode = queryAlphaNums.some(q => candidate.alphaNumTokens.includes(q));
    // 注意 smr 可能对应中文“小型模块化”，不视为冲突代号
    const isSmrBridge =
      (queryAlphaNums.includes('smr') && candidate.conceptCanonName.includes('<smr>')) ||
      (candidate.alphaNumTokens.includes('smr') && queryConceptStem.includes('<smr>'));
    if (!hasCommonCode && !isSmrBridge) {
      return { score: 0.30, reason: '型号代号不匹配' };
    }
  }

  // 1. 核心干词完全相等（例如“低可观测技术” vs “低可观测技术工学”，“M1A2升级” vs “M1A2现代化改造”）
  if (queryCoreStem.length >= 2 && queryCoreStem === candidate.coreCanonName) {
    return { score: 0.94, reason: '核心词根完全一致（壳词变体）' };
  }

  // 2. 同义概念规约干词完全相等（例如“小型模块化核反应堆研究” vs “小型模块化核能工学”，“隐身低可观测技术” vs “低可观测技术工学”）
  if (queryConceptStem.length >= 4 && queryConceptStem === candidate.conceptCanonName) {
    return { score: 0.91, reason: '核心领域概念完全等价（同义/壳词变体）' };
  }

  // 3. 核心干词字符集合重排相等（例如“模块化小型核能” vs “小型模块化核能”）
  if (
    queryCoreStem.length >= 4 &&
    candidate.coreCanonName.length >= 4 &&
    Math.abs(queryCoreStem.length - candidate.coreCanonName.length) <= 1
  ) {
    const sortedQ = queryCoreStem.split('').sort().join('');
    const sortedC = candidate.coreCanonName.split('').sort().join('');
    if (sortedQ === sortedC) {
      return { score: 0.92, reason: '核心词根同素异序（语序调换）' };
    }
  }

  // 4. 计算 IDF 加权子词与概念簇向量余弦（Lexical + Concept Synset Cosine）
  let tfidfCosine = 0;
  for (const [token, qVal] of queryTfidf.entries()) {
    const cVal = candidate.tfidfVector.get(token);
    if (cVal !== undefined) {
      tfidfCosine += qVal * cVal;
    }
  }

  // 5. 计算核心实词双向覆盖率（Core Token Recall / F1）
  let matchedCoreWeight = 0;
  let totalQueryCoreWeight = 0;
  for (const token of queryCoreTokens) {
    const idf = index.idfMap.get(token) ?? 1.5;
    totalQueryCoreWeight += idf;
    if (candidate.coreTokens.has(token)) {
      matchedCoreWeight += idf;
    }
  }
  const queryCoreRecall = totalQueryCoreWeight > 0 ? matchedCoreWeight / totalQueryCoreWeight : 0;

  let matchedCandCoreWeight = 0;
  let totalCandCoreWeight = 0;
  for (const token of candidate.coreTokens) {
    const idf = index.idfMap.get(token) ?? 1.5;
    totalCandCoreWeight += idf;
    if (queryCoreTokens.has(token)) {
      matchedCandCoreWeight += idf;
    }
  }
  const candCoreRecall = totalCandCoreWeight > 0 ? matchedCandCoreWeight / totalCandCoreWeight : 0;

  const coreF1 =
    queryCoreRecall + candCoreRecall > 0
      ? (2 * queryCoreRecall * candCoreRecall) / (queryCoreRecall + candCoreRecall)
      : 0;

  // 6. 包含关系或编辑距离微调加分
  let containmentBoost = 0;
  if (
    queryCoreStem.length >= 3 &&
    candidate.coreCanonName.length >= 3 &&
    (queryCoreStem.includes(candidate.coreCanonName) || candidate.coreCanonName.includes(queryCoreStem))
  ) {
    const lenRatio =
      Math.min(queryCoreStem.length, candidate.coreCanonName.length) /
      Math.max(queryCoreStem.length, candidate.coreCanonName.length);
    if (lenRatio >= 0.6) {
      containmentBoost = 0.14 * lenRatio;
    }
  }

  // 7. 融合可选静态 Int8 向量余弦（支持索引构建后动态注册静态表）
  let baseScore = 0.55 * tfidfCosine + 0.45 * coreF1 + containmentBoost;
  const candStaticVec =
    candidate.staticVector ??
    (registeredStaticEmbeddingTable
      ? computeStaticInt8Vector(candidate.name, registeredStaticEmbeddingTable)
      : null);
  if (queryStaticVec && candStaticVec) {
    const staticCos = Math.max(0, dotFloat32(queryStaticVec, candStaticVec));
    const blended = 0.68 * baseScore + 0.32 * staticCos;
    baseScore = staticCos >= baseScore ? Math.max(baseScore, blended + 0.12 * (staticCos - baseScore)) : blended;
  }

  // 7. 上下文交叉印证加分
  let contextBoost = 0;
  if (context) {
    if (context.line && candidate.line && canonEntityKey(context.line) === canonEntityKey(candidate.line)) {
      contextBoost += 0.05;
    }
    if (context.faction && candidate.faction && canonEntityKey(context.faction) === canonEntityKey(candidate.faction)) {
      contextBoost += 0.04;
    }
    if (
      context.prerequisites &&
      context.prerequisites.length > 0 &&
      candidate.prereqs.length > 0 &&
      context.prerequisites.some(p => candidate.prereqs.some(cp => canonEntityKey(p) === canonEntityKey(cp)))
    ) {
      contextBoost += 0.05;
    }
  }

  const finalScore = Math.min(0.98, Math.max(0, baseScore + contextBoost));
  const reason =
    coreF1 >= 0.75
      ? `核心词根/语义簇高重合 (${Math.round(finalScore * 100)}%)`
      : `混合向量相似度 (${Math.round(finalScore * 100)}%)`;

  return { score: Number(finalScore.toFixed(4)), reason };
}

/**
 * 评估实体名称相对于世界书目录的可信度与最佳对齐目标
 */
export function evaluateEntityCredibility(
  index: EntityCredibilityIndex | null | undefined,
  rawQuery: string,
  options: CredibilityOptions = {},
): CredibilityResult {
  const domain: EntityDomain = options.domain ?? 'any';
  const highThreshold = options.highThreshold ?? 0.80;
  const suspectThreshold = options.suspectThreshold ?? 0.52;
  const topK = options.topK ?? 3;
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';

  if (!query || !index || index.records.length === 0) {
    return {
      query,
      domain,
      verdict: 'novel_eva',
      score: 0,
      stage: 'miss',
      matchedName: null,
      matchedDomain: null,
      candidates: [],
    };
  }

  // ── L1-1: Exact 精确匹配 ──
  const exactHits = filterRecordsByDomain(index.exactMap.get(query) ?? [], domain);
  if (exactHits.length > 0) {
    const best = exactHits[0];
    return {
      query,
      domain,
      verdict: 'system_high',
      score: 1.0,
      stage: 'exact',
      matchedName: best.name,
      matchedDomain: best.domain,
      candidates: [{ name: best.name, domain: best.domain, score: 1.0, reason: '世界书精确命中' }],
    };
  }

  const queryCanon = canonEntityKey(query);
  const queryStrippedCanon = canonEntityKey(stripFactionPrefix(query));

  // ── L1-2: Alias 别名表命中（优先于 canon 以支持显式重定向） ──
  const aliasEntry = index.aliasMap.get(query) ?? (queryCanon ? index.aliasMap.get(queryCanon) : undefined);
  if (aliasEntry) {
    const targetRecords = filterRecordsByDomain(
      index.exactMap.get(aliasEntry.targetName) ??
        index.canonMap.get(canonEntityKey(aliasEntry.targetName)) ??
        [],
      domain,
    );
    if (targetRecords.length > 0) {
      const best = targetRecords[0];
      return {
        query,
        domain,
        verdict: 'system_high',
        score: 1.0,
        stage: 'alias',
        matchedName: best.name,
        matchedDomain: best.domain,
        candidates: [{ name: best.name, domain: best.domain, score: 1.0, reason: '世界书/自定义别名命中' }],
      };
    }
    if (domain === 'any' || !aliasEntry.domain || aliasEntry.domain === domain) {
      const matchedDom = aliasEntry.domain ?? (domain === 'any' ? 'research' : domain);
      return {
        query,
        domain,
        verdict: 'system_high',
        score: 1.0,
        stage: 'alias',
        matchedName: aliasEntry.targetName,
        matchedDomain: matchedDom,
        candidates: [{ name: aliasEntry.targetName, domain: matchedDom, score: 1.0, reason: '别名映射命中' }],
      };
    }
  }

  // ── L1-3: Canon 规范化或阵营前缀剥离命中 ──
  const canonHits = filterRecordsByDomain(
    (queryCanon ? index.canonMap.get(queryCanon) : undefined) ??
      (queryStrippedCanon ? index.strippedCanonMap.get(queryStrippedCanon) : undefined) ??
      [],
    domain,
  );
  if (canonHits.length > 0) {
    const best = canonHits[0];
    return {
      query,
      domain,
      verdict: 'system_high',
      score: 1.0,
      stage: 'canon',
      matchedName: best.name,
      matchedDomain: best.domain,
      candidates: [{ name: best.name, domain: best.domain, score: 1.0, reason: '规范化名称命中' }],
    };
  }

  // ── L1-4: Upgrade Chain 升级后正式名反查 ──
  const upgHit = index.upgradeChainMap.get(query) ?? (queryCanon ? index.upgradeChainMap.get(queryCanon) : undefined);
  if (upgHit && (domain === 'any' || upgHit.domain === domain)) {
    return {
      query,
      domain,
      verdict: 'system_high',
      score: 0.98,
      stage: 'upgrade_chain',
      matchedName: upgHit.name,
      matchedDomain: upgHit.domain,
      candidates: [{ name: upgHit.name, domain: upgHit.domain, score: 0.98, reason: '世界书升级链型号命中' }],
    };
  }

  // ── L2: 双擎混合语义向量评分 (IDF Subword + Concept Synsets + Static Int8 Embedding) ──
  const pool = domain === 'any' ? index.records : index.byDomain[domain];
  if (!pool || pool.length === 0) {
    return {
      query,
      domain,
      verdict: 'novel_eva',
      score: 0,
      stage: 'miss',
      matchedName: null,
      matchedDomain: null,
      candidates: [],
    };
  }

  const queryCoreStem = extractCoreStem(query);
  const queryConceptStem = extractConceptCanonicalStem(query);
  const queryAlphaNums = extractAlphaNumTokens(query);
  const queryExplicitFaction = detectExplicitFaction(query, options.context?.faction);
  const { features: queryRawFeatures, coreTokens: queryCoreTokens } = tokenizeEntityFeatures(query);
  const queryTfidf = new Map<string, number>();
  let normSq = 0;
  for (const [token, rawWeight] of queryRawFeatures.entries()) {
    const idf = index.idfMap.get(token) ?? Math.log(1 + (index.totalDocs + 1) / 1.5);
    const w = rawWeight * idf;
    queryTfidf.set(token, w);
    normSq += w * w;
  }
  if (normSq > 1e-12) {
    const invNorm = 1 / Math.sqrt(normSq);
    for (const [token, w] of queryTfidf.entries()) {
      queryTfidf.set(token, w * invNorm);
    }
  }

  const queryStaticVec = computeStaticInt8Vector(query, registeredStaticEmbeddingTable);

  const scored: CredibilityCandidate[] = [];
  for (const cand of pool) {
    const { score, reason } = computeHybridSimilarity(
      queryCoreStem,
      queryConceptStem,
      queryAlphaNums,
      queryExplicitFaction,
      queryTfidf,
      queryCoreTokens,
      queryStaticVec,
      cand,
      index,
      options.context,
    );
    if (score >= 0.20) {
      scored.push({
        name: cand.name,
        domain: cand.domain,
        score,
        reason,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-CN'));
  const topCandidates = scored.slice(0, topK);
  const best = topCandidates[0];

  if (!best) {
    return {
      query,
      domain,
      verdict: 'novel_eva',
      score: 0,
      stage: 'miss',
      matchedName: null,
      matchedDomain: null,
      candidates: [],
    };
  }

  if (best.score >= highThreshold) {
    return {
      query,
      domain,
      verdict: 'system_high',
      score: best.score,
      stage: 'hybrid_vector',
      matchedName: best.name,
      matchedDomain: best.domain,
      candidates: topCandidates,
    };
  }

  if (best.score >= suspectThreshold) {
    return {
      query,
      domain,
      verdict: 'system_suspect',
      score: best.score,
      stage: 'hybrid_vector',
      matchedName: best.name,
      matchedDomain: best.domain,
      candidates: topCandidates,
    };
  }

  return {
    query,
    domain,
    verdict: 'novel_eva',
    score: best.score,
    stage: 'miss',
    matchedName: null,
    matchedDomain: null,
    candidates: topCandidates,
  };
}

/**
 * 便捷判定：某名称是否属于世界书自有目录条目（默认高可信阈值 >= 0.80）
 */
export function isSystemCatalogEntity(
  index: EntityCredibilityIndex | null | undefined,
  name: string,
  domain: EntityDomain = 'any',
  threshold = 0.80,
): boolean {
  const res = evaluateEntityCredibility(index, name, { domain, highThreshold: threshold });
  return res.verdict === 'system_high' && res.score >= threshold;
}

/**
 * 便捷解析：将可能带变体/改写的名称解析为世界书权威标准名；若非世界书自有条目则返回 null
 */
export function resolveSystemEntityName(
  index: EntityCredibilityIndex | null | undefined,
  name: string,
  domain: EntityDomain = 'any',
  threshold = 0.80,
): string | null {
  const res = evaluateEntityCredibility(index, name, { domain, highThreshold: threshold });
  return res.verdict === 'system_high' && res.score >= threshold ? res.matchedName : null;
}

export { ALL_SPECIFIC_DOMAINS };
