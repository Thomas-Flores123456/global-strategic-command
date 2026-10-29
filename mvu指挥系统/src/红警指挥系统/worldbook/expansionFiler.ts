/**
 * 扩展档案落地与提升操作层（expansionFiler）——CTRL-CHATBOOK-02 设计案落地
 *
 * 1. 纯函数渲染层（renderExpansionContent/upsertExpansionEntry）：
 *    - 按 kind 选 comment 前缀段：科技·/建筑·/载具·/人员·/装备·；
 *    - findInSegment 段位定位防串段；
 *    - 70000 带内续号（nextOrder 先例）；
 *    - 绿灯 selective＋精确 key；
 *    - E7e 纪律：prevent_incoming: true；
 *    - 可选 data 块渲染：经 FORBIDDEN_PATCH_KEYS 红线校验后以 `<数据>\n{JSON}\n</数据>` 附条目正文末。
 *
 * 2. 档案落地副作用层（fileExpansion）：
 *    - 经 chatBookGateway 三重守卫（首写惰性建书 createIfMissing: true）；
 *    - 守卫失败 fail-closed 抛出 GuardError，不清暂存；
 *    - updateWorldbookWith 幂等 upsert；
 *    - 自动派生 codex 索引并幂等写入；
 *    - 查 $promoted 注册表：已提升同名实体打分叉警示（forkWarning）。
 *
 * 3. 提升操作层（promoteEntry 五步流）：
 *    - 步① 预检：目标书名 ∉ getWorldbookNames()（撞名 fail-closed 拒写，createWorldbook 撞名即替换）；
 *    - 步② 搬迁建书：正文逐字节搬迁、comment 换用户所取名、extra 记 provenance{sourceChatId, sourceBook, sourceComment, promotedAt}；
 *      步②′ 立即落盘（F8 修复）：createWorldbook 的条目写入走 ST 全局单例防抖 saveWorldDebounced（last-args-wins），
 *      后续任何他书写入都会顶掉它 → 建书后立刻以 saveWorldInfo(name, data, true) 强制落盘；
 *    - 步③ 追加全局：默认 rebindGlobalWorldbooks 追加新书（可选跳过）；
 *    - 步④ 复验：新书 ∈ getWorldbookNames() 且条目正文在（缓存）＋ 服务端落盘回读条目正文在（F8 补强）；
 *    - 步⑤ 删原条目：经守卫确认聊天身份后 deleteWorldbookEntries 删除聊天书原条目（随后立即落盘），并记 $promoted 注册表；
 *    - 半程态检出（detectHalfStates）与重试删除（retryDeleteOriginalEntry）。
 */

import type { ChatBookGatewayLike } from './chatBookBinding';
import { chatBookGateway } from './chatBookBinding';
import type { ThEntry } from './girlFiler';
import { findInSegment } from './girlFiler';
import type { CodexEntry, ExpansionDossier } from '../core/schema';
import {
  buildEntityCredibilityIndex,
  isSystemCatalogEntity,
  type EntityCredibilityIndex,
  type EntityDomain,
} from '../core/entityCredibility';
import { effectiveCatalogSnapshot } from '../composables/useCatalog';
import { tav } from '../parse/systemCheck';
import { useDataStore } from '../composables/store';
import { DATA_BLOCK_REGEX, renderDataBlock, validatePatchPayload } from './worldbookDataFiler';

/* ═══════════════ 类型定义 ═══════════════ */

export type ExpansionKind = '科技' | '建筑' | '载具' | '人员' | '人物' | '装备' | '地点' | '势力';

export interface ExpansionUpsertResult {
  entries: ThEntry[];
  action: 'created' | 'updated';
  entryName: string;
  linkedParents?: string[];
  linkedChildren?: string[];
}

export interface FileExpansionReceipt {
  name: string;
  kind: string;
  book: string;
  action: 'created' | 'updated';
  entryName: string;
  codexAction?: 'created' | 'updated';
  forkWarning?: boolean;
  forkPromotedBook?: string;
  /**
   * $promoted 悬挂记录（目标书已删）降级标记：此时不再打 forkWarning（分叉对象已不存在），
   * 改记 forkStale: true 供 UI 以提示级展示；注册表本身仍是 advisory，不被改写。
   */
  forkStale?: boolean;
  linkedParents?: string[];
  linkedChildren?: string[];
}

export interface PromotedRecord {
  targetBook: string;
  promotedAt: string;
  sourceComment?: string;
}

export type PromotedRegistry = Record<string, PromotedRecord>;

export interface PromoteParams {
  sourceChatBook: string;
  entryIdentifier: string | number;
  targetBookName: string;
  newEntryComment?: string;
  skipGlobalRebind?: boolean;
  gateway?: ChatBookGatewayLike;
}

export interface PromoteReceipt {
  success: boolean;
  targetBook: string;
  entryName: string;
  sourceBook: string;
  deletedFromSource: boolean;
  halfState?: boolean;
  error?: string;
}

export interface HalfStateRecord {
  entryName: string;
  sourceBook: string;
  targetBook: string;
  promotedAt?: string;
}

export interface PromotionIO {
  getWorldbookNames(): string[];
  getWorldbook(name: string): Promise<ThEntry[]>;
  createWorldbook(name: string, entries?: ThEntry[]): Promise<boolean>;
  getGlobalWorldbookNames(): string[];
  rebindGlobalWorldbooks(names: string[]): Promise<void>;
  deleteWorldbookEntries(
    bookName: string,
    predicate: (entry: ThEntry) => boolean,
  ): Promise<{ worldbook: ThEntry[]; deleted_entries: ThEntry[] }>;
  readChatId(): string | null;
  now(): Date;
  recordPromoted?(name: string, record: PromotedRecord): Promise<boolean>;
  /**
   * F8：把世界书当前缓存立即落盘（绕开 ST 全局单例防抖 saveWorldDebounced）。
   * 缺省（独立预览/旧注入）时跳过；真机实现失败须抛错（fail-closed）。
   */
  flushWorldbook?(name: string): Promise<void>;
  /**
   * F8：自服务端回读世界书（不经 worldInfoCache），用于复验「条目已落盘」。
   * 返回 null 表示环境不支持回读（跳过该项复验）；HTTP 失败须抛错。
   */
  readPersistedWorldbook?(name: string): Promise<ThEntry[] | null>;
}

type UpdateWorldbookWith = (name: string, updater: (entries: ThEntry[]) => ThEntry[]) => Promise<ThEntry[]>;

/* ═══════════════ 渲染与纯函数层 ═══════════════ */

const INVALID_CALLSIGN_PLACEHOLDERS = new Set(['无', '暂无', '未知', '-']);

/**
 * 严禁单独作为世界书触发 key 的高频功能泛词与类别壳词黑名单（防子串误触引发递归瀑布）
 */
export const FORBIDDEN_GENERIC_TRIGGER_KEYS: ReadonlySet<string> = new Set([
  // 类别与系统壳词
  '科技', '建筑', '载具', '人员', '人物', '装备', '地点', '势力', '阵营', '单位', '机娘', '档案', '设定', '图鉴', '其他',
  // 阵营与通用前缀
  '盟军', '苏联', '苏军', '苏维埃', '尤里', '通用', '帝国', '焚风', '红警', '基地', '主基地', '分基地', '前哨', '统帅部', '参谋部',
  // 战术与功能泛词（《优化技巧》技巧 4 点名重灾区）
  '防御', '防空', '侦察', '压制', '态势', '口径', '两栖', '装甲', '重装', '轻型', '重型', '中型', '步兵', '战车', '坦克',
  '战机', '舰艇', '支援', '后勤', '补给', '维修', '抢修', '医疗', '工程', '科研', '研究', '生产', '建造', '改装', '升级',
  '火力', '突击', '狙击', '隐身', '光学', '雷达', '电磁', '纳米', '核能', '电力', '发电', '电站', '矿场', '兵营', '船厂',
  '实验室', '指挥官', '副官', '参谋', '首领', '队长', '士兵', '动员', '精锐', '老兵', '新兵', '原型', '首台', '量产',
  // 占位符与无效词
  '无', '暂无', '未知', '待定', '未明', '-', 'null', 'undefined', 'none',
]);

function isValidTriggerKeyToken(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return false;

  // 已包裹的正则字面量（如 "/\\bM3\\b/i"）且内部非空
  if (/^\/.+\/[gimsuy]*$/.test(trimmed)) {
    return true;
  }

  // 命中泛词与占位词黑名单（不区分大小写）
  if (
    FORBIDDEN_GENERIC_TRIGGER_KEYS.has(trimmed) ||
    FORBIDDEN_GENERIC_TRIGGER_KEYS.has(trimmed.toLowerCase())
  ) {
    return false;
  }

  // 过滤长度 < 2 的单字中文泛词与裸单字母 ASCII（如 "R", "A", "X", "电", "炮"）
  if (trimmed.length < 2) {
    return false;
  }

  // 过滤纯数字（如 "01", "100"）
  if (/^\d+$/.test(trimmed)) {
    return false;
  }

  // 过滤纯档位编号（如 "T1", "T2", "T3", "V1", "V2"）
  if (/^([tTvV]\d+)$/.test(trimmed)) {
    return false;
  }

  return true;
}

/**
 * 净化 LLM 或用户输入的世界书触发词列表：
 * 1. 保底主 Key：若传入 primaryName（去空白后非空），作为保底主 Key 排在首位；
 * 2. 拦截泛词：剔除命中 FORBIDDEN_GENERIC_TRIGGER_KEYS（不区分大小写）的泛词，以及长度 < 2 的单字中文泛词；
 * 3. 拦截裸单字母与无效编号：剔除裸单字母 ASCII（如 "R", "A", "X"）、纯数字（如 "01", "100"）与纯档位词（"T1", "T2", "V1"）；
 * 4. 数量封顶：单条目最多保留 maxKeys（默认 8）个高区分度专名 Key。
 */
export function sanitizeWorldbookKeys(
  rawKeys: readonly string[],
  primaryName?: string,
  maxKeys = 8,
): string[] {
  const limit = Number.isFinite(maxKeys) && maxKeys > 0 ? Math.floor(maxKeys) : 8;
  const out: string[] = [];
  const seen = new Set<string>();

  const pushIfValid = (raw: unknown) => {
    if (out.length >= limit) return;
    const s = String(raw ?? '').trim();
    if (!isValidTriggerKeyToken(s)) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  if (typeof primaryName === 'string' && primaryName.trim()) {
    pushIfValid(primaryName.trim());
  }

  if (Array.isArray(rawKeys)) {
    for (const k of rawKeys) {
      if (out.length >= limit) break;
      pushIfValid(k);
    }
  }

  return out;
}

/**
 * 触发词：实体名 + AI 建议触发词 + data 块别名/升级名 + 人物有效代号（经 sanitizeWorldbookKeys 净化去重）
 */
export function expansionKeys(d: ExpansionDossier): string[] {
  const raw: string[] = [d.name, ...(d.keys ?? [])];

  if (d.data && typeof d.data === 'object' && !Array.isArray(d.data)) {
    if (typeof d.data.name === 'string') {
      raw.push(d.data.name);
    }
    if (typeof d.data.upgraded_name === 'string') {
      raw.push(d.data.upgraded_name);
    }
    if (Array.isArray(d.data.aliases)) {
      for (const alias of d.data.aliases) {
        if (typeof alias === 'string') {
          raw.push(alias);
        }
      }
    }
  }

  if (d.kind === '人物' && typeof d.params?.['代号'] === 'string') {
    const callsign = d.params['代号'].trim();
    if (callsign && !INVALID_CALLSIGN_PLACEHOLDERS.has(callsign)) {
      raw.push(callsign);
    }
  }

  return sanitizeWorldbookKeys(raw, d.name);
}

/**
 * 因果分带续号函数（CHATBOOK-GRAPH-01）：
 * 将聊天世界书内的 `<扩展档案>` 按类别分配到符合“先母体科技/建筑 → 后派生产物 → 最后人物”因果序的专属 `order` 子带：
 * - `kind === '科技' || kind === '建筑'`：频段 `[71001, 71999]`
 * - `kind === '载具' || kind === '人员' || kind === '装备'`：频段 `[72001, 72999]`
 * - `kind === '人物'`：频段 `[75001, 75999]`
 * - 其他未知类别兜底频段：`[70001, 70999]`
 */
export function nextExpansionOrder(entries: ThEntry[], kind?: ExpansionKind | string): number {
  let min = 70001;
  let max = 70999;

  if (kind === '科技' || kind === '建筑') {
    min = 71001;
    max = 71999;
  } else if (kind === '载具' || kind === '人员' || kind === '装备') {
    min = 72001;
    max = 72999;
  } else if (kind === '人物') {
    min = 75001;
    max = 75999;
  }

  const inBand = entries
    .map(e => Number(e.position?.order ?? e.order ?? 0))
    .filter(o => o >= min && o <= max);
  return inBand.length ? Math.max(...inBand) + 1 : min;
}

/** 规范 comment 前缀：{kind}·{name}·设定 */
export function makeExpansionComment(d: ExpansionDossier): string {
  return `${d.kind}·${d.name}·设定`;
}

/** 剥离 comment 前缀提取基础名（用于建议书名与建议条目名） */
export function stripExpansionCommentPrefix(commentOrName: string): string {
  return commentOrName.replace(/^(科技|建筑|载具|人员|人物|装备|地点|势力)·/, '').replace(/·设定$/, '');
}

const NPC_SUMMARY_PARAM_ORDER = [
  '代号',
  '所属势力',
  '身份',
  '态度',
  '信任度',
  '状态',
  '外貌特征',
  '性格与口吻',
  '能力',
  '背景',
  '近期交集',
] as const;

const STRUCTURED_DATA_EXPANSION_KINDS: ReadonlySet<string> = new Set([
  '科技',
  '建筑',
  '载具',
  '人员',
  '装备',
]);

const BUILDING_NAME_HINT_RE =
  /(?:厂|营|部|所|室|院|站|场|坞|塔|井|炉|库|中心|核心|平台|车间|阵列|基地|要塞|船厂|机坪|雷达|反应堆|电站|实验室|指挥所)$/;
const TECH_NAME_HINT_RE = /(?:学|理论|工程|协议|技术|算法|机制|研究|大纲|操典|体系|工艺|方程)$/;

function pickExpansionParam(params: Record<string, string> | undefined, keys: readonly string[]): string {
  if (!params) return '';
  for (const k of keys) {
    const raw = params[k];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed && !INVALID_CALLSIGN_PLACEHOLDERS.has(trimmed) && trimmed.toLowerCase() !== 'none') {
        return trimmed;
      }
    }
  }
  return '';
}

function parseNumericExpansionParam(raw: string, fallback: number): number {
  if (!raw) return fallback;
  const cleaned = raw.replace(/[,，]/g, '');
  const m = cleaned.match(/([+-]?\d+(?:\.\d+)?)/);
  if (!m) return fallback;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function parseExpansionTier(raw: string, fallback: 1 | 2 | 3 = 1): 1 | 2 | 3 {
  if (!raw) return fallback;
  const s = raw.trim().toUpperCase();
  if (s.includes('3') || s.includes('三') || s.includes('高阶') || s.includes('终极')) return 3;
  if (s.includes('2') || s.includes('二') || s.includes('中阶') || s.includes('进阶')) return 2;
  if (s.includes('1') || s.includes('一') || s.includes('初阶') || s.includes('基础')) return 1;
  return fallback;
}

function splitExpansionListParam(raw: string): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,，、;；/＋+|]+/)
        .map(s => s.trim())
        .filter(s => Boolean(s) && !INVALID_CALLSIGN_PLACEHOLDERS.has(s) && !/^无(?:（.*）|\(.*\))?$/.test(s)),
    ),
  ];
}

function normalizeExpansionFaction(raw: string): { label?: string; code?: string; scope: 'faction' | 'common' } {
  const s = raw.trim();
  if (!s || s === '通用' || s === '全阵营' || s.toLowerCase() === 'common') {
    return { scope: 'common' };
  }
  if (/盟军|同盟|allied|ally/i.test(s)) {
    return { label: '盟军', code: 'allied', scope: 'faction' };
  }
  if (/苏联|苏军|苏维埃|soviet/i.test(s)) {
    return { label: '苏联', code: 'soviet', scope: 'faction' };
  }
  if (/尤里|心灵|yuri/i.test(s)) {
    return { label: '尤里', code: 'yuri', scope: 'faction' };
  }
  return { label: s, code: s, scope: 'faction' };
}

function parseEtaDays(rawEta: string, fallbackDays: number): { eta: string; days: number } {
  const s = rawEta.trim();
  if (!s) {
    return { eta: `约${fallbackDays}日`, days: fallbackDays };
  }
  const hourMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:小时|时|h|hr)/i);
  if (hourMatch) {
    const hrs = Number(hourMatch[1]);
    const days = Number.isFinite(hrs) && hrs > 0 ? Math.max(1, Math.ceil(hrs / 24)) : fallbackDays;
    return { eta: s, days };
  }
  const dayMatch = s.match(/(\d+(?:\.\d+)?)/);
  if (dayMatch) {
    const d = Number(dayMatch[1]);
    const days = Number.isFinite(d) && d > 0 ? Math.max(1, Math.round(d)) : fallbackDays;
    const etaText = /(?:日|天)/.test(s) ? s : `约${days}日`;
    return { eta: etaText, days };
  }
  return { eta: s, days: fallbackDays };
}

function inferBuildingSystem(
  rawSystem: string,
  name: string,
  desc: string,
): 'military' | 'defense' | 'agro' | 'industry' | 'research_space' {
  const combined = `${rawSystem} ${name} ${desc}`;
  if (/科研|实验|超算|学术|研究|雷达|卫星|天网|research/i.test(combined)) return 'research_space';
  if (/防御|炮塔|地堡|碉堡|防空|棱镜塔|磁暴线圈|围墙|护盾|defense/i.test(combined)) return 'defense';
  if (/农业|生态|种植|养殖|合成粮|净水|医疗|医院|agro/i.test(combined)) return 'agro';
  if (/兵营|战车工厂|机坪|空指部|船厂|船坞|军工|装配|制造所|military/i.test(combined)) return 'military';
  return 'industry';
}

function inferProductionCategory(
  kind: string,
  rawCat: string,
  name: string,
  desc: string,
): 'infantry' | 'vehicle' | 'aircraft' | 'naval' | 'equipment' {
  if (kind === '人员') return 'infantry';
  if (kind === '装备') return 'equipment';
  const catHint = `${rawCat} ${name} ${desc}`;
  if (/aircraft|air|战机|轰炸机|直升机|旋翼|飞艇|浮空|空天|无人机|攻击机|运输机/i.test(catHint)) {
    return 'aircraft';
  }
  if (/naval|ship|潜艇|驱逐舰|巡洋舰|航母|战列舰|护卫舰|快艇|气垫船|两栖舰|船|艇|舰/i.test(catHint)) {
    return 'naval';
  }
  return 'vehicle';
}

/**
 * 为全新「科技 / 建筑 / 载具 / 人员 / 装备」扩展档案自动合成符合 WorldbookDataBlockSchema 的标准 `<数据>` JSON 对象：
 * - 独立剧情 NPC（`kind === '人物'`）、`地点`、`势力` 严禁生成产线/研发数据块（返回 undefined），杜绝 NPC 混入兵营生产列表；
 * - 若调用方已显式提供 `d.data`，原样返回 `d.data`；
 * - 若未提供 `d.data`，自动从 `d.name`、`d.kind`、`d.desc`、`d.detail` 与 `d.params` 推导生成 `research` / `building` / `production` 标准结构。
 */
export function buildStructuredExpansionDataObject(
  d: ExpansionDossier,
): Record<string, unknown> | undefined {
  if (d.data && typeof d.data === 'object' && !Array.isArray(d.data)) {
    return d.data;
  }
  const kindStr = String(d.kind ?? '').trim();
  if (!STRUCTURED_DATA_EXPANSION_KINDS.has(kindStr)) {
    return undefined;
  }
  const name = String(d.name ?? '').trim();
  if (!name) return undefined;

  const params = d.params ?? {};
  const descTrimmed = stripMetaJargonLines(d.desc || '');
  const detailTrimmed = stripMetaJargonLines(d.detail || '');
  const firstDetailLine = detailTrimmed
    ? detailTrimmed
        .split(/\r?\n/)
        .map(l => l.replace(/^\[.*?\]\s*/, '').trim())
        .find(Boolean) ?? ''
    : '';
  const summaryDesc = descTrimmed || firstDetailLine.slice(0, 120) || `${kindStr}·${name}`;

  const tier = parseExpansionTier(
    pickExpansionParam(params, ['科技层级', '层级', '阶级', '等级', '代数', 'tier', 'tech_level']),
    1,
  );
  const factionInfo = normalizeExpansionFaction(
    pickExpansionParam(params, ['所属阵营', '阵营', '派系', '阵营归属', '所属势力', 'faction']),
  );

  // 拆分科技前置（prereqs）与建筑前置/母厂（need_buildings）
  const explicitTechPrereqs = splitExpansionListParam(
    pickExpansionParam(params, [
      '前置科技',
      '依赖科技',
      '科技前置',
      '研发前置',
      'prereqs',
      'prerequisites',
      'tech_prereq',
      'research',
    ]),
  );
  const explicitBldPrereqs = splitExpansionListParam(
    pickExpansionParam(params, [
      '生产建筑',
      '产出建筑',
      '制造厂',
      '母厂',
      '所需建筑',
      '前置建筑',
      '研发建筑',
      '实验设施',
      '依赖建筑',
      'need_building',
      'need_buildings',
      'producer',
      'building_prereq',
    ]),
  );
  const mixedPrereqs = splitExpansionListParam(
    pickExpansionParam(params, ['前置', '前置条件', '解锁条件', 'prereq']),
  );

  const prereqSet = new Set<string>(explicitTechPrereqs);
  const needBldSet = new Set<string>(explicitBldPrereqs);
  for (const token of mixedPrereqs) {
    if (BUILDING_NAME_HINT_RE.test(token) && !TECH_NAME_HINT_RE.test(token)) {
      needBldSet.add(token);
    } else {
      prereqSet.add(token);
    }
  }
  const prereqs = [...prereqSet];
  const needBuildings = [...needBldSet];

  const baseTags: string[] = [
    `${kindStr}扩展`,
    ...(factionInfo.label ? [`${factionInfo.label}特色`] : []),
    `T${tier}`,
  ];

  if (kindStr === '科技') {
    const defaultCost = tier === 3 ? 2400 : tier === 2 ? 1200 : 600;
    const cost = Math.max(
      0,
      parseNumericExpansionParam(
        pickExpansionParam(params, ['造价', '研发费用', '费用', '经费', '资金', 'cost', 'price']),
        defaultCost,
      ),
    );
    const rawLine = pickExpansionParam(params, ['研究线', '分支', '路线', '领域', '学科', 'line']);
    const line = rawLine || (factionInfo.label ? `${factionInfo.label}特色` : '通用');
    const { eta, days } = parseEtaDays(
      pickExpansionParam(params, ['工期', '研发周期', '周期', '耗时', '预计', '时间', 'eta', 'duration']),
      tier * 2,
    );
    const unlocks = pickExpansionParam(params, [
      '解锁产物',
      '解锁',
      '研发成果',
      '衍生解锁',
      '产物',
      '解锁单位',
      '解锁建筑',
      'unlocks',
    ]);
    const prereqDisplay =
      [...needBuildings, ...prereqs].join(' + ') || '无（基础科技）';

    return {
      schema_version: 2,
      type: 'research',
      id: name,
      name,
      cost,
      line,
      tier,
      scope: factionInfo.scope,
      ...(factionInfo.label ? { faction: factionInfo.label } : {}),
      ...(needBuildings[0] ? { need_building: needBuildings[0] } : {}),
      need_buildings: needBuildings,
      prereqs,
      prereq: prereqDisplay,
      unlocks: unlocks || '战区专项战术能力与后续衍生造物',
      eta,
      workload: {
        days,
        min_days: Math.max(1, Math.ceil(days * 0.5)),
      },
      tags: baseTags,
      desc: summaryDesc,
    };
  }

  if (kindStr === '建筑') {
    const defaultCost = tier === 3 ? 3000 : tier === 2 ? 1500 : 800;
    const cost = Math.max(
      0,
      parseNumericExpansionParam(
        pickExpansionParam(params, ['造价', '建造费用', '费用', '经费', '资金', 'cost', 'price']),
        defaultCost,
      ),
    );
    const rawPowerText = pickExpansionParam(params, [
      '耗电',
      '电力',
      '功率',
      '发电',
      '负载',
      '电网负载',
      'power',
    ]);
    let power = parseNumericExpansionParam(rawPowerText, 50);
    if (!params['耗电'] && !params['负载'] && !params['电网负载'] && params['发电'] && power > 0) {
      power = -power;
    }
    const system = inferBuildingSystem(
      pickExpansionParam(params, ['职能分类', '体系', '分类', '系统', 'system']),
      name,
      summaryDesc,
    );
    const etaRaw = pickExpansionParam(params, ['工期', '建造周期', '周期', '耗时', '预计', 'eta']);

    return {
      schema_version: 1,
      type: 'building',
      id: name,
      name,
      cost,
      power,
      tier,
      research: prereqs.length > 0 ? prereqs.join('＋') : null,
      prereqs,
      ...(prereqs.length > 0 ? { need_tech: prereqs } : {}),
      ...(needBuildings[0] ? { need_building: needBuildings[0] } : {}),
      need_buildings: needBuildings,
      system,
      ...(factionInfo.code ? { faction: factionInfo.code } : {}),
      scope: factionInfo.scope,
      ...(etaRaw ? { eta: etaRaw } : {}),
      tags: baseTags,
      desc: summaryDesc,
    };
  }

  // kindStr === '载具' | '人员' | '装备' → type: 'production'
  const category = inferProductionCategory(
    kindStr,
    pickExpansionParam(params, ['子类别', '载具类型', '底盘', '兵种分类', 'category']),
    name,
    summaryDesc,
  );
  const defaultProdCost =
    kindStr === '人员'
      ? tier === 3
        ? 1000
        : tier === 2
          ? 500
          : 250
      : kindStr === '装备'
        ? tier === 3
          ? 800
          : tier === 2
            ? 400
            : 150
        : tier === 3
          ? 2400
          : tier === 2
            ? 1400
            : 800;
  const cost = Math.max(
    0,
    parseNumericExpansionParam(
      pickExpansionParam(params, ['造价', '生产费用', '列装费用', '费用', '经费', 'cost', 'price']),
      defaultProdCost,
    ),
  );

  const effectiveNeedBuildings =
    needBuildings.length > 0
      ? needBuildings
      : category === 'infantry'
        ? ['兵营']
        : category === 'equipment'
          ? ['兵营']
          : category === 'aircraft'
            ? ['空指部']
            : category === 'naval'
              ? ['船厂']
              : ['战车工厂'];

  const maxCountRaw = pickExpansionParam(params, ['数量上限', '限编', '编制上限', 'max_count']);
  const maxCountNum = maxCountRaw ? parseNumericExpansionParam(maxCountRaw, 0) : 0;
  const etaRaw = pickExpansionParam(params, ['工期', '生产周期', '训练周期', '周期', '耗时', '预计', 'eta']);

  const mainWeapon = pickExpansionParam(params, ['主武器', '主武装', '主要武器', 'main_weapon']);
  const subWeapon = pickExpansionParam(params, ['副武器', '副武装', '辅助武器', '随身武备', 'sub_weapon']);
  const weaponSuite = pickExpansionParam(params, ['武器配置', '武器', '武装', '武备', 'weapons']);
  const weapons: Array<{ slot: string; name: string }> = [];
  if (mainWeapon) weapons.push({ slot: '主武器', name: mainWeapon });
  if (subWeapon) weapons.push({ slot: '副武器', name: subWeapon });
  if (weaponSuite && !mainWeapon && !subWeapon) {
    weapons.push({ slot: '主武器', name: weaponSuite });
  }

  const skillText = pickExpansionParam(params, [
    '战术特长',
    '技能',
    '特长',
    '能力',
    '被动技能',
    '主动技能',
    '专长',
    'skills',
  ]);
  const skills = splitExpansionListParam(skillText);

  return {
    schema_version: 1,
    type: 'production',
    id: name,
    name,
    category,
    cost,
    tier,
    need_building: effectiveNeedBuildings[0] ?? '',
    need_buildings: effectiveNeedBuildings,
    prereqs,
    ...(prereqs.length > 0 ? { need_tech: prereqs } : {}),
    ...(factionInfo.code ? { faction: factionInfo.code } : {}),
    scope: factionInfo.scope,
    ...(maxCountNum > 0 ? { max_count: maxCountNum } : {}),
    ...(etaRaw ? { eta: etaRaw } : {}),
    ...(weapons.length > 0 ? { weapons } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    tags: baseTags,
    desc: summaryDesc,
  };
}

const META_JARGON_LINE_PATTERNS: readonly RegExp[] = [
  /^(?:[·\-*•]+\s*)?(?:【|\[)\s*(?:key说明|keys说明|触发词说明|触发词设置|平衡性说明|平衡说明|生态位说明|生态位定位|设计定位|设计说明|策划说明|系统映射|管线说明|写书说明|注入说明)\s*(?:】|\])/i,
  /^\*(?:系统映射|触发词说明|key说明|平衡性说明|生态位|设计定位)[：:\s]/i,
  /^(?:[·\-*•]+\s*)?(?:key说明|keys说明|触发词说明|触发词设计|平衡性说明|平衡说明|平衡性定位|生态位|生态位定位|生态位补齐|设计定位|策划定位|系统映射|T[123]电力语言)\s*[：:]/i,
];

/**
 * 自动剔除正文中以【key说明】、【触发词说明】、【平衡性说明】、生态位：、设计定位：等策划工作台元语言开头的脏行，
 * 保持世界内冷峻军工档案语域（对齐《世界书文风规范》§一.2 & §一.4）。
 */
export function stripMetaJargonLines(text: string): string {
  if (!text || typeof text !== 'string') return '';
  const lines = text.split(/\r?\n/);
  const cleaned = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    return !META_JARGON_LINE_PATTERNS.some(re => re.test(trimmed));
  });
  return cleaned
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 渲染条目正文（纯函数）：
 * - detail 为散文主体（经 stripMetaJargonLines 剥离策划元语言脏行）；
 * - 当 kind === '人物' 且附带立体 params 时，自动拼装结构化人物速览头，供世界书触发词召回时精准还原人设与关系；
 * - 若附带 data 块，经 FORBIDDEN_PATCH_KEYS 红线校验后以 `<数据>\n{JSON}\n</数据>` 附于正文末；
 * - 保持独立成书体例（提升时逐字节搬迁）。
 */
export function renderExpansionContent(d: ExpansionDossier, bookName?: string): string {
  if (d.data) {
    const valRes = validatePatchPayload(d.data);
    if (!valRes.valid) {
      throw new Error(`安全红线拦截：data 包含禁止字段 [${valRes.violations.join(', ')}]`);
    }
  }

  const detailTrimmed = stripMetaJargonLines(d.detail || '');
  const descTrimmed = stripMetaJargonLines(d.desc || '');
  let body: string;

  if (detailTrimmed.startsWith('[') || detailTrimmed.startsWith('【')) {
    body = detailTrimmed;
  } else {
    const header = `[${bookName ?? `红警扩展·${d.kind}`} | ${d.name}]`;
    const segments: string[] = [header];

    if (d.kind === '人物' && d.params && Object.keys(d.params).length > 0) {
      const paramLines: string[] = [];
      if (descTrimmed && !detailTrimmed.includes(descTrimmed)) {
        paramLines.push(`· 简介：${descTrimmed}`);
      }
      const printedKeys = new Set<string>();
      for (const key of NPC_SUMMARY_PARAM_ORDER) {
        const val = d.params[key]?.trim();
        if (val) {
          paramLines.push(`· ${key}：${val}`);
          printedKeys.add(key);
        }
      }
      for (const [k, v] of Object.entries(d.params)) {
        if (printedKeys.has(k) || k === '信任变化') continue;
        const val = String(v ?? '').trim();
        if (val) {
          paramLines.push(`· ${k}：${val}`);
        }
      }
      if (paramLines.length > 0) {
        segments.push(paramLines.join('\n'));
      }
    }

    if (detailTrimmed) {
      segments.push(detailTrimmed);
    } else if (descTrimmed && d.kind !== '人物') {
      segments.push(descTrimmed);
    }
    body = segments.join('\n\n');
  }

  const effectiveData = d.data ?? buildStructuredExpansionDataObject(d);
  if (effectiveData && !DATA_BLOCK_REGEX.test(body)) {
    body = `${body}\n\n${renderDataBlock(effectiveData)}`;
  }

  return body.trim();
}

/**
 * 从条目 content 中解析 `<数据>...</数据>` JSON 对象（若存在且合法）
 */
function parseEntryDataJson(entry: ThEntry): Record<string, unknown> | undefined {
  if (!entry.content) return undefined;
  const m = entry.content.match(DATA_BLOCK_REGEX);
  if (!m) return undefined;
  try {
    const parsed = JSON.parse(m[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore malformed json */
  }
  return undefined;
}

/**
 * 提取 `<数据>` 对象中的前置依赖名称列表（去空去重）：
 * 支持 `prerequisites`（数组或字符串）、`tech_prereq`、`producer`（数组或字符串）、`building_prereq`
 */
export function extractDependencies(data?: Record<string, unknown>): string[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const fields = [
    data.prerequisites,
    data.prereqs,
    data.tech_prereq,
    data.research,
    data.producer,
    data.building_prereq,
    data.need_buildings,
    data.need_building,
  ];
  const deps: string[] = [];

  for (const val of fields) {
    if (typeof val === 'string') {
      const tokens = val.includes('＋') || val.includes('+') ? val.split(/[＋+]/) : [val];
      for (const rawTok of tokens) {
        const trimmed = rawTok.trim();
        if (trimmed && !INVALID_CALLSIGN_PLACEHOLDERS.has(trimmed) && !/^无(?:（.*）|\(.*\))?$/.test(trimmed)) {
          deps.push(trimmed);
        }
      }
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') {
          const trimmed = item.trim();
          if (trimmed && !INVALID_CALLSIGN_PLACEHOLDERS.has(trimmed) && !/^无(?:（.*）|\(.*\))?$/.test(trimmed)) {
            deps.push(trimmed);
          }
        }
      }
    }
  }

  return [...new Set(deps)];
}

/**
 * 幂等将触发词同步进条目的 `strategy.keys`（以及 `key` / `keys` 若存在）
 */
function appendTriggerKeyIdempotent(entry: ThEntry, newKey: string): void {
  const trimmed = newKey.trim();
  if (!trimmed) return;

  const existingStrategyKeys = Array.isArray(entry.strategy?.keys) ? [...entry.strategy.keys] : [];
  if (!existingStrategyKeys.includes(trimmed)) {
    existingStrategyKeys.push(trimmed);
  }
  entry.strategy = {
    ...(entry.strategy ?? { type: 'selective' }),
    keys: existingStrategyKeys,
  };

  if (Array.isArray(entry.key)) {
    if (!entry.key.includes(trimmed)) {
      entry.key = [...entry.key, trimmed];
    }
  }
  if (Array.isArray(entry.keys)) {
    if (!entry.keys.includes(trimmed)) {
      entry.keys = [...entry.keys, trimmed];
    }
  }
}

/**
 * 在父条目 `parentEntry.content` 中幂等维护衍生列装行：
 * 如尚未包含 `「${childName}」`，则在 `<数据>` 块之前或正文末尾追加/更新 `· 衍生解锁实体：${childKind}「${childName}」`
 */
function appendDerivedEntityLine(parentEntry: ThEntry, childKind: string, childName: string): void {
  const trimmedName = childName.trim();
  if (!trimmedName) return;

  const content = parentEntry.content ?? '';
  const nameToken = `「${trimmedName}」`;
  const kindAndName = `${childKind}「${trimmedName}」`;

  const derivedLineRegex = /^(· 衍生解锁实体：[^\r\n]*)$/m;
  const existingMatch = content.match(derivedLineRegex);
  if (existingMatch) {
    if (existingMatch[1].includes(nameToken)) {
      return;
    }
    const updatedLine = `${existingMatch[1]}、${kindAndName}`;
    parentEntry.content = content.replace(derivedLineRegex, updatedLine);
    return;
  }

  if (content.includes(nameToken) && content.includes('· 衍生解锁实体：')) {
    return;
  }

  const newLine = `· 衍生解锁实体：${kindAndName}`;
  const dataMatch = content.match(DATA_BLOCK_REGEX);
  if (dataMatch && dataMatch.index !== undefined) {
    const beforeData = content.slice(0, dataMatch.index).trimEnd();
    const dataBlock = content.slice(dataMatch.index);
    parentEntry.content = beforeData ? `${beforeData}\n\n${newLine}\n\n${dataBlock}` : `${newLine}\n\n${dataBlock}`;
  } else {
    const trimmedContent = content.trimEnd();
    parentEntry.content = trimmedContent ? `${trimmedContent}\n\n${newLine}` : newLine;
  }
}

/**
 * 推断条目的扩展类别（用于逆向扫描子条目时拼装 `· 衍生解锁实体：${childKind}「${childName}」`）
 */
function inferEntryExpansionKind(entry: ThEntry, dataJson?: Record<string, unknown>): string {
  const rawTitle = String(entry.name || entry.comment || '').trim();
  const prefixMatch = /^(科技|建筑|载具|人员|人物|装备|地点)·/.exec(rawTitle);
  if (prefixMatch) return prefixMatch[1];

  const headerMatch = /\[(?:红警扩展·)?(科技|建筑|载具|人员|人物|装备|地点)\s*\|/.exec(entry.content || '');
  if (headerMatch) return headerMatch[1];

  if (dataJson && typeof dataJson.kind === 'string' && dataJson.kind.trim()) {
    return dataJson.kind.trim();
  }
  const typeStr = typeof dataJson?.type === 'string' ? dataJson.type.trim().toLowerCase() : '';
  if (typeStr === 'research' || typeStr === 'technology' || typeStr === 'tech') return '科技';
  if (typeStr === 'building') return '建筑';
  if (typeStr === 'infantry' || typeStr === 'personnel') return '人员';
  if (typeStr === 'equipment' || typeStr === 'weapon') return '装备';
  if (typeStr === 'npc' || typeStr === 'character') return '人物';
  return '载具';
}

/**
 * 「聊天书内新科技/新建筑 ⇄ 解锁新载具/新装备」双向图谱缝合纯函数（CHATBOOK-GRAPH-01）：
 * - 情况 1（当前入档的 `currentDossier` 是下游子实体，其 `data` 声明了依赖项 `depName`）：
 *   查找匹配 `depName` 的既有扩展父条目 `parentEntry`：
 *   1. 正向伴随唤醒：将 `currentDossier.name` 幂等追加进 `parentEntry.strategy.keys`（及 `parentEntry.key`）；
 *   2. 逆向派生索引：在 `parentEntry.content` 中幂等维护 `· 衍生解锁实体：${currentDossier.kind}「${currentDossier.name}」`。
 * - 情况 2（当前入档的 `currentDossier` 是上游父科技/父建筑）：
 *   反向扫描 `entries` 中所有其他条目 `childEntry`，若其 `<数据>` 依赖列表包含 `currentDossier.name`，
 *   将 `childName` 幂等追加进当前父条目的 `strategy.keys` 并在正文中登记 `· 衍生解锁实体：...`。
 */
export function linkExpansionGraph(
  entries: ThEntry[],
  currentDossier: ExpansionDossier,
): { linkedParents: string[]; linkedChildren: string[] } {
  const linkedParents: string[] = [];
  const linkedChildren: string[] = [];

  const selfName = currentDossier.name.trim();
  if (!selfName) {
    return { linkedParents, linkedChildren };
  }

  const selfEntry =
    findInSegment(entries, currentDossier.kind, selfName) ??
    entries.find(e => stripExpansionCommentPrefix(String(e.name || e.comment || '')).trim() === selfName);

  const selfData =
    currentDossier.data ??
    buildStructuredExpansionDataObject(currentDossier) ??
    (selfEntry ? parseEntryDataJson(selfEntry) : undefined);
  const selfDataName = typeof selfData?.name === 'string' ? selfData.name.trim() : '';

  // 情况 1：当前入档的 d 是下游子实体，查找既有父条目并缝合
  const deps = extractDependencies(selfData);
  for (const depName of deps) {
    for (const candidate of entries) {
      if (candidate === selfEntry) continue;
      const candCoreName = stripExpansionCommentPrefix(String(candidate.name || candidate.comment || '')).trim();
      const candData = parseEntryDataJson(candidate);
      const candDataName = typeof candData?.name === 'string' ? candData.name.trim() : '';

      if (candCoreName === depName || (candDataName && candDataName === depName)) {
        appendTriggerKeyIdempotent(candidate, selfName);
        appendDerivedEntityLine(candidate, currentDossier.kind, selfName);
        const parentLabel = candCoreName || candDataName || depName;
        if (!linkedParents.includes(parentLabel)) {
          linkedParents.push(parentLabel);
        }
      }
    }
  }

  // 情况 2：当前入档的 d 是上游父科技/父建筑，反向扫描既有子条目并缝合到自身
  if (selfEntry) {
    for (const childEntry of entries) {
      if (childEntry === selfEntry) continue;
      const childData = parseEntryDataJson(childEntry);
      if (!childData) continue;
      const childDeps = extractDependencies(childData);
      const dependsOnSelf =
        childDeps.includes(selfName) || (Boolean(selfDataName) && childDeps.includes(selfDataName));
      if (!dependsOnSelf) continue;

      const childCoreName =
        stripExpansionCommentPrefix(String(childEntry.name || childEntry.comment || '')).trim() ||
        (typeof childData.name === 'string' ? childData.name.trim() : '');
      if (!childCoreName) continue;

      const childKind = inferEntryExpansionKind(childEntry, childData);
      appendTriggerKeyIdempotent(selfEntry, childCoreName);
      appendDerivedEntityLine(selfEntry, childKind, childCoreName);
      if (!linkedChildren.includes(childCoreName)) {
        linkedChildren.push(childCoreName);
      }
    }
  }

  return { linkedParents, linkedChildren };
}

/**
 * 条目 upsert（纯函数）：
 * - findInSegment 语义防串段；
 * - nextExpansionOrder 按因果分带续号（科技/建筑 71001+，载具/人员/装备 72001+，人物 75001+，兜底 70001+）；
 * - 绿灯 selective＋精确 key；
 * - 零外溢递归锁：prevent_incoming: true, prevent_outgoing: true；
 * - 自动执行 linkExpansionGraph 双向图谱缝合。
 */
export function upsertExpansionEntry(entries: ThEntry[], d: ExpansionDossier): ExpansionUpsertResult {
  const existing = findInSegment(entries, d.kind, d.name);
  const content = renderExpansionContent(d);
  const keys = expansionKeys(d);

  if (existing) {
    existing.content = content;
    existing.key = keys;
    existing.keys = keys;
    existing.strategy = { ...existing.strategy, type: 'selective', keys };
    existing.recursion = { prevent_incoming: true, prevent_outgoing: true, delay_until: null };
    existing.matchWholeWords = false;
    existing.caseSensitive = false;
    existing.excludeRecursion = true;
    existing.preventRecursion = true;
    const { linkedParents, linkedChildren } = linkExpansionGraph(entries, d);
    return {
      entries,
      action: 'updated',
      entryName: existing.name || String(existing.comment || ''),
      linkedParents,
      linkedChildren,
    };
  }

  const entryName = makeExpansionComment(d);
  entries.push({
    name: entryName,
    comment: entryName,
    key: keys,
    keys,
    enabled: true,
    strategy: { type: 'selective', keys },
    position: { type: 'before_character_definition', order: nextExpansionOrder(entries, d.kind) },
    content,
    probability: 100,
    recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
    matchWholeWords: false,
    caseSensitive: false,
    excludeRecursion: true,
    preventRecursion: true,
  });

  const { linkedParents, linkedChildren } = linkExpansionGraph(entries, d);
  return { entries, action: 'created', entryName, linkedParents, linkedChildren };
}

/** 从扩展档案自动派生 codex 索引 */
export function deriveCodexFromExpansion(d: ExpansionDossier): CodexEntry {
  const firstLine = d.detail
    ? d.detail
        .split('\n')[0]
        .replace(/^\[.*?\]\s*/, '')
        .trim()
    : '';
  const fallbackDesc = firstLine ? firstLine.slice(0, 100) : `${d.kind}·${d.name}`;
  return {
    name: d.name,
    kind: d.kind,
    desc: d.desc || fallbackDesc,
    params: { ...(d.params ?? {}) },
  };
}

/** 将扩展档案类别映射为可信度引擎域 */
export function mapExpansionKindToDomain(kind: string): EntityDomain {
  if (kind === '科技') return 'research';
  if (kind === '建筑') return 'building';
  if (kind === '载具' || kind === '人员' || kind === '装备' || kind === '单位') return 'production';
  return 'any';
}

/**
 * 开局已入册核心人员名录（3 位首发 MCV 机娘及代号/别名 + 5 位开局随行人类参谋）：
 * 严禁作为新量产兵种（kind === '人员'）重复建档。
 */
export const BUILTIN_ROSTER_PERSONNEL_NAMES: ReadonlySet<string> = new Set([
  '白凌',
  '喀秋莎',
  '尤里卡',
  '凛冬妮娅',
  '妮娅',
  '薇拉',
  '萧栖雪',
  '杜月欣',
  '陆玉凝',
  '林晚',
  '苏晓',
]);

const HARDWARE_EXPANSION_KINDS: ReadonlySet<string> = new Set([
  '科技',
  '建筑',
  '载具',
  '人员',
  '装备',
  '单位',
]);

/**
 * 剥离硬件/兵种名称尾随的简单括号或分隔符改装修饰后缀（如「灰熊坦克（战地加挂版）」→「灰熊坦克」、「动员兵·雪地型」→「动员兵」）
 */
export function extractHardwareBaseName(name: string): string {
  let base = name.trim();
  if (!base) return '';

  // 1. 剥离尾随括号修饰（支持全角/半角圆括号、方括号、书名号括号）
  base = base.replace(/\s*(?:（[^）]+）|\([^)]+\)|【[^】]+】|\[[^\]]+\])\s*$/g, '').trim();

  // 2. 剥离以分隔符（· / - / — / /）连接的常见战地改装/环境特化/批次型号后缀
  base = base
    .replace(
      /[·\-—/]\s*[^·\-—/]*(?:改|型|版|加挂|增压|迷彩|特化|强化|升级|套件|挂载|试作|实验|量产|改装)\s*$/i,
      '',
    )
    .trim();

  return base;
}

/**
 * 校验扩展档案条目是否已存在于世界书系统既有目录中（默认高可信阈值 >= 0.85）：
 * 1. 当 d.kind === '人员' 且命中 BUILTIN_ROSTER_PERSONNEL_NAMES 时，直接返回 true（禁止把开局核心机娘与随行参谋当成新量产兵种重复入档；d.kind === '人物' 时不拦截）；
 * 2. 查询 6 大硬件域可信度索引；
 * 3. 当 d.kind 为硬件/兵种且原名带有简单括号/分隔符改装后缀时，提取基底名 baseName，若在 credibilityIndex 中高可信命中（>= 0.92），同样判定为重复（应走 <数据更新>）。
 */
export function isDuplicateOfSystemCatalog(
  d: Pick<ExpansionDossier, 'name' | 'kind'>,
  credibilityIndex?: EntityCredibilityIndex | null,
  threshold = 0.85,
): boolean {
  const name = typeof d?.name === 'string' ? d.name.trim() : '';
  if (!name) return false;
  const kindStr = String(d.kind ?? '').trim();

  if (kindStr === '人员') {
    if (BUILTIN_ROSTER_PERSONNEL_NAMES.has(name)) {
      return true;
    }
    const basePersonnelName = extractHardwareBaseName(name);
    if (basePersonnelName && BUILTIN_ROSTER_PERSONNEL_NAMES.has(basePersonnelName)) {
      return true;
    }
  }

  const domain = mapExpansionKindToDomain(kindStr);

  let idx = credibilityIndex ?? null;
  if (!idx) {
    try {
      const snap = effectiveCatalogSnapshot();
      const hasEntries =
        (snap.researches?.length ?? 0) +
          (snap.buildings?.length ?? 0) +
          (snap.productions?.length ?? 0) +
          (snap.retrofits?.length ?? 0) +
          (snap.projects?.length ?? 0) +
          (snap.protocols?.length ?? 0) >
        0;
      if (hasEntries) {
        idx = buildEntityCredibilityIndex(snap);
      }
    } catch {
      idx = null;
    }
  }

  if (!idx || idx.records.length === 0) return false;
  const queryDomain: EntityDomain =
    domain !== 'any' && idx.byDomain[domain]?.length > 0 ? domain : 'any';
  if (isSystemCatalogEntity(idx, name, queryDomain, threshold)) {
    return true;
  }

  if (HARDWARE_EXPANSION_KINDS.has(kindStr)) {
    const baseName = extractHardwareBaseName(name);
    if (baseName && baseName !== name && baseName.length >= 2) {
      const baseThreshold = Math.max(threshold, 0.92);
      if (isSystemCatalogEntity(idx, baseName, queryDomain, baseThreshold)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 过滤掉已存在于世界书系统既有目录中的扩展档案条目
 */
export function filterSystemCatalogExpansions<T extends Pick<ExpansionDossier, 'name' | 'kind'>>(
  items: readonly T[],
  credibilityIndex?: EntityCredibilityIndex | null,
  threshold = 0.85,
): T[] {
  return items.filter(item => !isDuplicateOfSystemCatalog(item, credibilityIndex, threshold));
}

/** 幂等 upsert codex 列表（纯函数：按「名称 + 类别」匹配，旧无分类/「其他」索引向后兼容） */
export function upsertCodexList(
  codex: CodexEntry[],
  entry: CodexEntry,
): { codex: CodexEntry[]; action: 'created' | 'updated' } {
  const incomingKind = typeof entry.kind === 'string' ? entry.kind.trim() : '';
  const isGenericKind = (k: unknown) => {
    const s = typeof k === 'string' ? k.trim() : '';
    return !s || s === '其他';
  };
  let idx = codex.findIndex(c => c.name === entry.name && String(c.kind ?? '').trim() === incomingKind);
  if (idx < 0) {
    idx = codex.findIndex(
      c => c.name === entry.name && (isGenericKind(c.kind) || isGenericKind(incomingKind)),
    );
  }
  if (idx >= 0) {
    codex[idx] = {
      ...codex[idx],
      kind: incomingKind && !isGenericKind(incomingKind) ? entry.kind : (codex[idx].kind || entry.kind),
      desc: entry.desc || codex[idx].desc,
      params: { ...codex[idx].params, ...entry.params },
    };
    return { codex, action: 'updated' };
  }
  codex.push({ ...entry });
  return { codex, action: 'created' };
}

/* ═══════════════ $promoted 注册表（advisory 元数据） ═══════════════ */

/** 读 $promoted 注册表；预览/异常返回 null（降级容错） */
export async function readPromoted(): Promise<PromotedRegistry | null> {
  const gv = tav<(o: { type: string }) => Record<string, unknown> | Promise<Record<string, unknown>>>('getVariables');
  if (!gv) return null;
  try {
    const v = await gv({ type: 'chat' });
    return ((v as Record<string, unknown>)?.$promoted ?? {}) as PromotedRegistry;
  } catch {
    return null;
  }
}

/** 写 $promoted 注册表条目（advisory 降级容错，不抛错） */
export async function recordPromoted(name: string, record: PromotedRecord): Promise<boolean> {
  const uv =
    tav<(u: (v: Record<string, unknown>) => Record<string, unknown>, o: { type: string }) => unknown>(
      'updateVariablesWith',
    );
  if (uv) {
    try {
      await uv(
        v => {
          const reg = (((v as Record<string, unknown>).$promoted ?? {}) as PromotedRegistry) || {};
          reg[name] = record;
          (v as Record<string, unknown>).$promoted = reg;
          return v;
        },
        { type: 'chat' },
      );
      return true;
    } catch {
      return false;
    }
  }

  const gv = tav<(o: { type: string }) => Record<string, unknown> | Promise<Record<string, unknown>>>('getVariables');
  const rv = tav<(v: Record<string, unknown>, o: { type: string }) => Promise<void>>('replaceVariables');
  if (gv && rv) {
    try {
      const v = (await gv({ type: 'chat' })) ?? {};
      const reg = ((v.$promoted ?? {}) as PromotedRegistry) || {};
      reg[name] = record;
      v.$promoted = reg;
      await rv(v, { type: 'chat' });
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/* ═══════════════ 档案入档副作用层 ═══════════════ */

export interface FileExpansionOptions {
  codexSink?: { read(): CodexEntry[]; write(next: CodexEntry[]): void } | CodexEntry[];
  readPromotedFn?: () => Promise<PromotedRegistry | null>;
  /** 世界书名单来源（测试注入）；缺省 tav('getWorldbookNames')，不可用时不做悬挂降级（保持原语义） */
  worldbookNamesFn?: () => string[];
  /** 可选外部注入的可信度索引（用于校验是否属于世界书既有系统目录） */
  credibilityIndex?: EntityCredibilityIndex | null;
}

/**
 * $promoted 记录健康度（纯函数）：
 * - live：目标书在册；
 * - dangling：目标书已不在世界书名单（被删/改名）——分叉警示降级为提示；
 * - unknown：名单不可用（预览环境），按原 advisory 语义处理。
 */
export function promotedRecordStatus(
  record: PromotedRecord | undefined,
  worldbookNames: string[] | null,
): 'live' | 'dangling' | 'unknown' {
  if (!record) return 'unknown';
  if (!worldbookNames) return 'unknown';
  return worldbookNames.includes(record.targetBook) ? 'live' : 'dangling';
}

/**
 * 单个扩展档案入当前聊天档案书（CTRL-CHATBOOK-02 §2）：
 * 1. 经 chatBookGateway 三重守卫（首写惰性建书 createIfMissing: true）；
 * 2. 守卫失败 fail-closed 抛出 GuardError，不清暂存；
 * 3. updateWorldbookWith 幂等 upsert；
 * 4. 自动派生 codex 索引并幂等写入；
 * 5. 查 $promoted 注册表，若同名实体已提升，打分叉警示（forkWarning）。
 */
export async function fileExpansion(
  d: ExpansionDossier,
  gateway: ChatBookGatewayLike = chatBookGateway,
  options?: FileExpansionOptions,
): Promise<FileExpansionReceipt> {
  const updateWb = tav<UpdateWorldbookWith>('updateWorldbookWith');
  if (!updateWb) {
    throw new Error('酒馆 API updateWorldbookWith 不可用（独立预览环境无法入档）');
  }

  // 1. 检查 $promoted 注册表（分叉警示）
  let forkWarning = false;
  let forkStale = false;
  let forkPromotedBook: string | undefined;
  try {
    const readFn = options?.readPromotedFn ?? readPromoted;
    const promoted = await readFn();
    if (promoted && promoted[d.name]) {
      forkPromotedBook = promoted[d.name].targetBook;
      let names: string[] | null = null;
      try {
        const namesFn = options?.worldbookNamesFn ?? tav<() => string[]>('getWorldbookNames');
        names = namesFn ? namesFn() : null;
      } catch {
        names = null;
      }
      // 目标书已删 → 悬挂记录：分叉警示降级（forkStale）；其余情形保持既有 forkWarning 语义
      if (promotedRecordStatus(promoted[d.name], names) === 'dangling') forkStale = true;
      else forkWarning = true;
    }
  } catch {
    /* advisory 降级 */
  }

  // 2. 经守卫（首写允许建书，失败抛 GuardError fail-closed）
  const txn = gateway.begin();
  const book = await gateway.guardedBook(txn, { createIfMissing: true });

  // 3. 幂等 upsert 写入聊天书
  let upsertRes: ExpansionUpsertResult | null = null;
  await updateWb(book, entries => {
    upsertRes = upsertExpansionEntry(entries, d);
    return upsertRes.entries;
  });

  // 4. 自动派生并 upsert codex 索引（若属于世界书既有系统目录则跳过动态 codex 写入防污染）
  let codexAction: 'created' | 'updated' | undefined;
  const isSystemDup = isDuplicateOfSystemCatalog(d, options?.credibilityIndex, 0.85);
  if (!isSystemDup) {
    const codexEntry = deriveCodexFromExpansion(d);
    if (Array.isArray(options?.codexSink)) {
      const res = upsertCodexList(options.codexSink, codexEntry);
      codexAction = res.action;
    } else if (options?.codexSink && typeof options.codexSink.read === 'function') {
      const list = options.codexSink.read();
      const res = upsertCodexList(list, codexEntry);
      options.codexSink.write(res.codex);
      codexAction = res.action;
    } else {
      try {
        const store = useDataStore();
        if (store?.data?.codex) {
          const res = upsertCodexList(store.data.codex, codexEntry);
          codexAction = res.action;
        }
      } catch {
        /* store unavailable */
      }
    }
  }

  const ur = upsertRes as ExpansionUpsertResult | null;
  return {
    name: d.name,
    kind: d.kind,
    book,
    action: ur?.action ?? 'created',
    entryName: ur?.entryName ?? makeExpansionComment(d),
    codexAction,
    forkWarning,
    forkPromotedBook,
    ...(forkStale ? { forkStale } : {}),
  };
}

/* ═══════════════ 提升操作层（五步流） ═══════════════ */

interface StWorldInfoData {
  entries?: Record<string, { uid?: number; comment?: string; content?: string }>;
}

interface StContextLike {
  loadWorldInfo?: (name: string) => Promise<StWorldInfoData | null | undefined>;
  saveWorldInfo?: (name: string, data: StWorldInfoData, immediately?: boolean) => Promise<void>;
  getRequestHeaders?: () => Record<string, string>;
}

interface StLike {
  getCurrentChatId?: () => string;
  getContext?: () => StContextLike;
}

function stCtx(): StContextLike | undefined {
  try {
    return st()?.getContext?.();
  } catch {
    return undefined;
  }
}

/** ST 原生世界书数据（entries 以 uid 为键的 map）→ 复验用最小条目视图 */
export function persistedEntriesOf(data: StWorldInfoData | null | undefined): ThEntry[] {
  return Object.values(data?.entries ?? {}).map(e => ({
    uid: e.uid,
    name: e.comment ?? '',
    comment: e.comment ?? '',
    content: e.content ?? '',
  }));
}

function st(): StLike | undefined {
  return (globalThis as Record<string, unknown>).SillyTavern as StLike | undefined;
}

export const realPromotionIO: PromotionIO = {
  getWorldbookNames() {
    const fn = tav<() => string[]>('getWorldbookNames');
    return fn ? fn() : [];
  },
  async getWorldbook(name: string) {
    const fn = tav<(n: string) => Promise<ThEntry[]>>('getWorldbook');
    if (!fn) throw new Error('酒馆 API getWorldbook 不可用');
    return fn(name);
  },
  async createWorldbook(name: string, entries?: ThEntry[]) {
    const fn = tav<(n: string, es?: ThEntry[]) => Promise<boolean>>('createWorldbook');
    if (!fn) throw new Error('酒馆 API createWorldbook 不可用');
    return fn(name, entries);
  },
  getGlobalWorldbookNames() {
    const fn = tav<() => string[]>('getGlobalWorldbookNames');
    return fn ? fn() : [];
  },
  async rebindGlobalWorldbooks(names: string[]) {
    const fn = tav<(ns: string[]) => Promise<void>>('rebindGlobalWorldbooks');
    if (!fn) throw new Error('酒馆 API rebindGlobalWorldbooks 不可用');
    return fn(names);
  },
  async deleteWorldbookEntries(bookName: string, predicate: (entry: ThEntry) => boolean) {
    const fn =
      tav<(b: string, p: (e: ThEntry) => boolean) => Promise<{ worldbook: ThEntry[]; deleted_entries: ThEntry[] }>>(
        'deleteWorldbookEntries',
      );
    if (!fn) throw new Error('酒馆 API deleteWorldbookEntries 不可用');
    return fn(bookName, predicate);
  },
  readChatId() {
    try {
      const id = st()?.getCurrentChatId?.();
      return typeof id === 'string' && id ? id : null;
    } catch {
      return null;
    }
  },
  now: () => new Date(),
  recordPromoted,
  async flushWorldbook(name: string) {
    const ctx = stCtx();
    if (!ctx?.loadWorldInfo || !ctx.saveWorldInfo) {
      throw new Error('ST 上下文 loadWorldInfo/saveWorldInfo 不可用，无法立即落盘世界书');
    }
    // loadWorldInfo 命中 worldInfoCache（TH 写入时已同步更新缓存），即待落盘的最新全文
    const data = await ctx.loadWorldInfo(name);
    if (!data) throw new Error(`世界书「${name}」缓存读取失败，无法立即落盘`);
    await ctx.saveWorldInfo(name, data, true);
  },
  async readPersistedWorldbook(name: string) {
    const ctx = stCtx();
    if (!ctx?.getRequestHeaders || typeof fetch !== 'function') return null;
    const resp = await fetch('/api/worldinfo/get', {
      method: 'POST',
      headers: ctx.getRequestHeaders(),
      body: JSON.stringify({ name }),
      cache: 'no-cache',
    });
    if (!resp.ok) throw new Error(`世界书「${name}」服务端回读失败（HTTP ${resp.status}）`);
    return persistedEntriesOf((await resp.json()) as StWorldInfoData);
  },
};

/**
 * 提升条目为独立私产世界书（CTRL-CHATBOOK-02 §4.2 五步流，先建后删，fail-closed）：
 * 步① 预检：目标书名 ∉ getWorldbookNames()（撞名拒绝换名，§1.3 红线）；
 * 步② createWorldbook(新书名, [条目])——条目正文逐字节搬迁，comment 换用户所取名，extra 记 provenance；
 *   步②′（F8）立即落盘新书：TH createWorldbook 仅「空书」立即存，条目走 ST 全局单例防抖，会被步⑤聊天书写入顶掉；
 * 步③ 默认 rebindGlobalWorldbooks 追加新书（可选跳过）；
 * 步④ 复验新书 ∈ getWorldbookNames() 且条目在（缓存＋服务端回读双验）——全过才走 ⑤；
 * 步⑤ deleteWorldbookEntries(聊天书, 原条目)（经守卫确认聊天身份后执行，随后立即落盘）；记 $promoted 注册表。
 */
export async function promoteEntry(params: PromoteParams, io: PromotionIO = realPromotionIO): Promise<PromoteReceipt> {
  const gateway = params.gateway ?? chatBookGateway;

  // 步① 预检：目标书名 ∉ getWorldbookNames()（🔴 撞名 fail-closed 拒绝，createWorldbook 撞名即替换）
  const allBooks = io.getWorldbookNames();
  if (allBooks.includes(params.targetBookName)) {
    throw new Error(`[提升预检失败] 目标世界书名「${params.targetBookName}」已存在，禁止覆盖既有书，请换名`);
  }

  // 查找原聊天书内的条目
  const sourceEntries = await io.getWorldbook(params.sourceChatBook);
  const sourceEntry = sourceEntries.find(e => {
    if (typeof params.entryIdentifier === 'number') {
      return e.uid === params.entryIdentifier;
    }
    const id = params.entryIdentifier;
    return (
      e.name === id ||
      e.comment === id ||
      (typeof e.name === 'string' && (e.name.includes(`·${id}·`) || e.name.endsWith(`·${id}`))) ||
      (typeof e.comment === 'string' && (e.comment.includes(`·${id}·`) || e.comment.endsWith(`·${id}`)))
    );
  });

  if (!sourceEntry) {
    throw new Error(`[提升预检失败] 在聊天档案书「${params.sourceChatBook}」中未找到条目「${params.entryIdentifier}」`);
  }

  // 步② createWorldbook(新书名, [条目])——条目正文逐字节搬迁，comment 换用户所取名，extra 记 provenance
  const newComment = params.newEntryComment || stripExpansionCommentPrefix(sourceEntry.comment || sourceEntry.name);
  const promotedEntry: ThEntry = {
    ...sourceEntry,
    name: newComment,
    comment: newComment,
    extra: {
      ...(sourceEntry.extra ?? {}),
      provenance: {
        sourceChatId: io.readChatId() ?? '',
        sourceBook: params.sourceChatBook,
        sourceComment: sourceEntry.comment || sourceEntry.name,
        promotedAt: io.now().toISOString(),
      },
    },
  };

  const created = await io.createWorldbook(params.targetBookName, [promotedEntry]);
  if (!created) {
    throw new Error(`[提升失败] createWorldbook「${params.targetBookName}」返回失败（已存在或被替换）`);
  }

  // 步②′（F8）立即落盘新书——必须紧随建书、先于任何他书写入（ST _save 会 cancel 全局防抖）
  if (io.flushWorldbook) {
    try {
      await io.flushWorldbook(params.targetBookName);
    } catch (err) {
      throw new Error(
        `[提升落盘失败] 新世界书「${params.targetBookName}」条目未能立即落盘（${(err as Error)?.message ?? err}），中止删除原条目（处于已建未删半程态）`,
        { cause: err },
      );
    }
  }

  // 步③ 默认 rebindGlobalWorldbooks 追加新书（可选跳过）
  if (!params.skipGlobalRebind) {
    const currentGlobals = io.getGlobalWorldbookNames();
    if (!currentGlobals.includes(params.targetBookName)) {
      await io.rebindGlobalWorldbooks([...currentGlobals, params.targetBookName]);
    }
  }

  // 步④ 复验新书 ∈ getWorldbookNames() 且条目在——全过才走 ⑤
  const booksAfter = io.getWorldbookNames();
  if (!booksAfter.includes(params.targetBookName)) {
    throw new Error(
      `[提升复验失败] 新世界书「${params.targetBookName}」未在世界书列表中查得，中止删除原条目（处于已建未删半程态）`,
    );
  }

  const newEntries = await io.getWorldbook(params.targetBookName);
  const verifiedEntry = newEntries.find(
    e => (e.name === newComment || e.comment === newComment) && e.content === sourceEntry.content,
  );
  if (!verifiedEntry) {
    throw new Error(
      `[提升复验失败] 新世界书「${params.targetBookName}」中未验得搬迁条目正文，中止删除原条目（处于已建未删半程态）`,
    );
  }

  // 步④ 补强（F8）：服务端落盘回读——缓存命中≠已落盘，整页刷新后只认磁盘
  if (io.readPersistedWorldbook) {
    let persisted: ThEntry[] | null;
    try {
      persisted = await io.readPersistedWorldbook(params.targetBookName);
    } catch (err) {
      throw new Error(
        `[提升复验失败] 新世界书「${params.targetBookName}」落盘回读失败（${(err as Error)?.message ?? err}），中止删除原条目（处于已建未删半程态）`,
        { cause: err },
      );
    }
    if (persisted !== null) {
      const onDisk = persisted.some(
        e => (e.name === newComment || e.comment === newComment) && e.content === sourceEntry.content,
      );
      if (!onDisk) {
        throw new Error(
          `[提升复验失败] 新世界书「${params.targetBookName}」条目未落盘（服务端回读 ${persisted.length} 条，缺搬迁条目），中止删除原条目（处于已建未删半程态）`,
        );
      }
    }
  }

  // 步④′ 提前登记 $promoted 注册表（在步⑤删除聊天绑定书源条目之前，确保步⑤中断时 detectHalfStates 可检出半程态）
  const recordFn = io.recordPromoted ?? recordPromoted;
  const promotedAt = io.now().toISOString();
  const sourceComment = sourceEntry.comment || sourceEntry.name;
  await recordFn(newComment, {
    targetBook: params.targetBookName,
    promotedAt,
    sourceComment,
  });

  // 步⑤ deleteWorldbookEntries(聊天书, 原条目)（经守卫确认聊天身份后执行）
  const delTxn = gateway.begin();
  const verifiedChatBook = await gateway.guardedBook(delTxn, { createIfMissing: false });
  if (verifiedChatBook !== params.sourceChatBook) {
    throw new Error(
      `[提升守卫失败] 聊天档案书已漂移（期望「${params.sourceChatBook}」，实测「${verifiedChatBook}」），中止删除原条目（处于已建未删半程态）`,
    );
  }

  const delRes = await io.deleteWorldbookEntries(params.sourceChatBook, e => {
    if (e.content !== sourceEntry.content) return false;
    if (sourceEntry.uid !== undefined && e.uid !== undefined) {
      return e.uid === sourceEntry.uid;
    }
    return e.name === sourceEntry.name || e.comment === sourceEntry.comment;
  });
  const deletedFromSource = delRes.deleted_entries.length > 0;
  // 步⑤ 删除即刻落盘（F8 同源：防抖窗口内他书写入会顶掉删除保存，导致原条目复活成半程态）
  if (deletedFromSource && io.flushWorldbook) {
    try {
      await io.flushWorldbook(params.sourceChatBook);
    } catch {
      /* 删除已进缓存并排入防抖保存；落盘失败留给半程态检出兜底，不回滚新书 */
    }
  }

  return {
    success: true,
    targetBook: params.targetBookName,
    entryName: newComment,
    sourceBook: params.sourceChatBook,
    deletedFromSource,
  };
}

/**
 * 检出「已建未删」半程态（管理页 §6.7）：
 * 提升书已在世界书列表中，且原聊天书内同名条目依然存在。
 */
export async function detectHalfStates(
  chatBookName: string,
  promotedRegistry?: PromotedRegistry | null,
  io: PromotionIO = realPromotionIO,
): Promise<HalfStateRecord[]> {
  const reg = promotedRegistry !== undefined ? promotedRegistry : await readPromoted();
  if (!reg || Object.keys(reg).length === 0) return [];

  const allBooks = io.getWorldbookNames();
  let chatEntries: ThEntry[];
  try {
    chatEntries = await io.getWorldbook(chatBookName);
  } catch {
    return [];
  }

  const halfStates: HalfStateRecord[] = [];
  for (const [entryName, record] of Object.entries(reg)) {
    if (allBooks.includes(record.targetBook)) {
      const stillInChat = chatEntries.some(e => {
        const id = record.sourceComment || entryName;
        return (
          e.name === id ||
          e.comment === id ||
          (typeof e.name === 'string' && (e.name.includes(`·${entryName}·`) || e.name.endsWith(`·${entryName}`))) ||
          (typeof e.comment === 'string' &&
            (e.comment.includes(`·${entryName}·`) || e.comment.endsWith(`·${entryName}`)))
        );
      });
      if (stillInChat) {
        halfStates.push({
          entryName,
          sourceBook: chatBookName,
          targetBook: record.targetBook,
          promotedAt: record.promotedAt,
        });
      }
    }
  }

  return halfStates;
}

/** 重试删除聊天书残留条目（半程态修复操作） */
export async function retryDeleteOriginalEntry(
  chatBookName: string,
  entryIdentifier: string | number,
  gateway: ChatBookGatewayLike = chatBookGateway,
  io: PromotionIO = realPromotionIO,
): Promise<boolean> {
  const txn = gateway.begin();
  const verifiedChatBook = await gateway.guardedBook(txn, { createIfMissing: false });
  if (verifiedChatBook !== chatBookName) {
    throw new Error(`[重试删除守卫失败] 聊天档案书已漂移（期望「${chatBookName}」，实测「${verifiedChatBook}」）`);
  }

  await io.deleteWorldbookEntries(chatBookName, e => {
    if (typeof entryIdentifier === 'number') {
      return e.uid === entryIdentifier;
    }
    return (
      e.name === entryIdentifier ||
      e.comment === entryIdentifier ||
      (typeof e.name === 'string' &&
        (e.name.includes(`·${entryIdentifier}·`) || e.name.endsWith(`·${entryIdentifier}`))) ||
      (typeof e.comment === 'string' &&
        (e.comment.includes(`·${entryIdentifier}·`) || e.comment.endsWith(`·${entryIdentifier}`)))
    );
  });

  if (io.flushWorldbook) {
    await io.flushWorldbook(chatBookName);
  }

  return true;
}
