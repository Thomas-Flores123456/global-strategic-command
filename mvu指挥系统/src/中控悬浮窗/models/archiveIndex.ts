/**
 * archiveIndex.ts —— 档案页纯函数层（RAC-FLOAT-02，D-RAC-FLOAT-ARCHIVE-01 → A）
 *
 * 1. buildArchiveIndex：把所扫描楼的 `codex[]`（AI 动态创造索引）与 `pending_lore[]`（机娘档案暂存）
 *    整理成按 kind 分组的档案清单，并与"上一有效 AI 楼"比对标记「本楼新增」/「沿用」；
 * 2. matchArchiveEntry：按世界书条目命名规则在只读取回的条目里定位正史正文——
 *    - codex → 《EVA·动态档案》条目名 `${kind}·${name}`（dlcInstaller.ts:1614），归档器自身按「·名字」后缀清旧
 *      （dlcInstaller.ts:1626-1628 / 1667，B2），故此处同样以后缀匹配兜底 kind 被改过的旧条目；
 *    - pending_lore / 人员 → 《机娘·能力档案》条目名 `NN·名·型号`（girlFiler.ts:131），定位规则
 *      `includes('·名·') || endsWith('·名')`（girlFiler.ts:109-111 findByGirl）；
 * 3. toDetail：组装 DetailDrawer 数据——命中正史用世界书正文并标「正史」，否则回退 codex/pending_lore 摘要并标「草稿」。
 *
 * 零 IO、零宿主 API、零 vue/pinia 依赖；世界书读取在 worldbookReader.ts，楼层扫描在 useArchiveIndex.ts。
 */
import type { Schema } from '../../红警指挥系统/core/schema';
import { ARCHIVE_BOOK } from '../../红警指挥系统/parse/systemCheck';
import type { DetailData } from '../../红警指挥系统/composables/useDetail';

/** 与 girlFiler.ts:19 `DOSSIER_BOOK` / `STORY_BOOK` 同值；不直接 import 以免把含世界书写入函数的模块拉进只读 bundle（单测有等值守卫） */
export const DOSSIER_BOOK = '机娘·能力档案';
export const STORY_BOOK = '剧情·北坡纪事';
export const SUPPORT_BOOK = '通用·机娘保障工程';
export { ARCHIVE_BOOK };

/** 与 expansionFiler.ts `BUILTIN_ROSTER_PERSONNEL_NAMES` 同值（3 位首发 MCV 机娘及代号/别名 + 5 位开局随行人类参谋） */
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

/** 分组固定顺序（schema.ts:89 CodexEntry.kind 枚举序）；pending_lore 单列为「机娘」不入此序 */
export const KIND_ORDER = ['人物', '科技', '建筑', '载具', '人员', '装备', '阵营', '其他'] as const;
export const PENDING_KIND = '机娘';

export type ArchiveKind = (typeof KIND_ORDER)[number] | typeof PENDING_KIND;

export const EXPANSION_KIND_SET = new Set<string>(['人物', '科技', '建筑', '载具', '人员', '装备']);

export interface ArchiveCounts {
  人物: number;
  科技: number;
  建筑: number;
  载具: number;
  人员: number;
  装备: number;
  阵营: number;
  其他: number;
  机娘: number;
  total: number;
}

export function emptyCounts(): ArchiveCounts {
  return {
    人物: 0,
    科技: 0,
    建筑: 0,
    载具: 0,
    人员: 0,
    装备: 0,
    阵营: 0,
    其他: 0,
    机娘: 0,
    total: 0,
  };
}

export function countArchiveIndex(index: ArchiveIndex): ArchiveCounts {
  const counts = emptyCounts();
  for (const g of index.groups) {
    const k = g.kind as keyof ArchiveCounts;
    if (k in counts && k !== 'total') {
      counts[k] += g.items.length;
    } else {
      counts.其他 += g.items.length;
    }
    counts.total += g.items.length;
  }
  counts.机娘 = index.pending.length;
  counts.total += index.pending.length;
  return counts;
}

export interface ArchiveItem {
  name: string;
  kind: string;
  desc: string;
  params: Record<string, string>;
  /** new = 上一有效楼不含该名（或无上一楼）；kept = 沿用 */
  status: 'new' | 'kept';
  source: 'codex' | 'pending_lore';
}

export interface ArchiveGroup {
  kind: string;
  items: ArchiveItem[];
}

export interface ArchiveIndex {
  /** 仅含非空分组，按 KIND_ORDER 排序 */
  groups: ArchiveGroup[];
  /** 机娘档案暂存（pending_lore） */
  pending: ArchiveItem[];
}

/** 只读世界书条目最小视图（@types/function/worldbook.d.ts WorldbookEntry 子集） */
export interface ArchiveEntryLike {
  name: string;
  enabled: boolean;
  content: string;
}

type FloorData = Pick<Schema, 'codex' | 'pending_lore'>;

const DESC_MAX = 60;

function clip(s: string, max = DESC_MAX): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function pendingToItem(d: Schema['pending_lore'][number], status: ArchiveItem['status']): ArchiveItem {
  const params: Record<string, string> = {};
  if (d.model) params['型号'] = d.model;
  if (d.alias) params['化名'] = d.alias;
  if (d.exposure) params['暴露分档'] = d.exposure;
  return {
    name: d.name,
    kind: PENDING_KIND,
    desc: clip([d.model, d.shell].filter(Boolean).join(' · ')),
    params,
    status,
    source: 'pending_lore',
  };
}

function isPendingGirlCandidate(raw: unknown): raw is Schema['pending_lore'][number] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.name !== 'string' || !rec.name.trim()) return false;
  if (rec.kind === '势力') return false;
  if (
    typeof rec.id === 'string' &&
    rec.id.trim().length > 0 &&
    !rec.id.trim().startsWith('maiden.') &&
    rec.type !== 'maiden'
  ) {
    return false;
  }
  return true;
}

/**
 * 本楼 codex / pending_lore → 分组索引；previous 为 null（无上一有效楼）时全部记为 new。
 * 同名条目只取首个（codex 以 name 为键）；pending_lore 自动剔除非机娘暂存实体（如新势力）。
 */
export function buildArchiveIndex(current: FloorData | null, previous: FloorData | null): ArchiveIndex {
  if (!current) return { groups: [], pending: [] };
  const prevCodex = new Set((previous?.codex ?? []).map(c => c.name));
  const prevPending = new Set((previous?.pending_lore ?? []).filter(isPendingGirlCandidate).map(d => d.name));

  const byKind = new Map<string, ArchiveItem[]>();
  const seen = new Set<string>();
  for (const c of current.codex ?? []) {
    if (!c.name || seen.has(c.name)) continue;
    seen.add(c.name);
    const kind = (KIND_ORDER as readonly string[]).includes(c.kind) ? c.kind : '其他';
    const item: ArchiveItem = {
      name: c.name,
      kind,
      desc: c.desc ?? '',
      params: { ...(c.params ?? {}) },
      status: prevCodex.has(c.name) ? 'kept' : 'new',
      source: 'codex',
    };
    const list = byKind.get(kind) ?? [];
    list.push(item);
    byKind.set(kind, list);
  }
  const groups: ArchiveGroup[] = [];
  for (const kind of KIND_ORDER) {
    const items = byKind.get(kind);
    if (items?.length) groups.push({ kind, items });
  }

  const pending: ArchiveItem[] = [];
  const seenPending = new Set<string>();
  for (const d of current.pending_lore ?? []) {
    if (!isPendingGirlCandidate(d)) continue;
    if (!d.name || seenPending.has(d.name)) continue;
    seenPending.add(d.name);
    pending.push(pendingToItem(d, prevPending.has(d.name) ? 'kept' : 'new'));
  }
  return { groups, pending };
}

/**
 * 读取当前聊天绑定世界书名称（优先显式参数，其次宿主 getChatWorldbookName('current')，最后兜底聊天变量 $timeline.boundBookName）。
 * 忽略空字符串与异常，保证纯函数测试环境下无副作用返回 null。
 */
export function resolveActiveChatBookName(explicitChatBook?: string | null): string | null {
  if (typeof explicitChatBook === 'string' && explicitChatBook.trim()) {
    return explicitChatBook.trim();
  }
  try {
    const fn = (globalThis as Record<string, unknown>).getChatWorldbookName;
    if (typeof fn === 'function') {
      const res = (fn as (target: string) => unknown)('current');
      if (typeof res === 'string' && res.trim()) return res.trim();
    }
  } catch {
    /* 忽略宿主未就绪异常 */
  }
  try {
    const gv = (globalThis as Record<string, unknown>).getVariables;
    if (typeof gv === 'function') {
      const chatVars = (gv as (opts?: Record<string, unknown>) => Record<string, unknown>)({ type: 'chat' });
      const timeline = chatVars?.$timeline as
        | { boundBookName?: unknown; floors?: Record<string, { activeSwipeId?: number; swipes?: Record<string, { wbJournal?: Array<{ bookName?: unknown }> }> }> }
        | undefined;
      if (typeof timeline?.boundBookName === 'string' && timeline.boundBookName.trim()) {
        return timeline.boundBookName.trim();
      }
      if (timeline?.floors && typeof timeline.floors === 'object') {
        for (const floorRec of Object.values(timeline.floors)) {
          const swipes = floorRec?.swipes;
          if (!swipes || typeof swipes !== 'object') continue;
          for (const slot of Object.values(swipes)) {
            if (!Array.isArray(slot?.wbJournal)) continue;
            for (let i = slot.wbJournal.length - 1; i >= 0; i--) {
              const bName = slot.wbJournal[i]?.bookName;
              if (typeof bName === 'string' && bName.trim()) {
                return bName.trim();
              }
            }
          }
        }
      }
    }
  } catch {
    /* 忽略变量读取异常 */
  }
  return null;
}

function dedupBooks(books: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const b of books) {
    const t = typeof b === 'string' ? b.trim() : '';
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * 该条目可能落在的世界书（按优先级）：
 * - 若当前聊天存在绑定书（如 RA_ChatBook_*），优先检索聊天绑定书（去重并忽略空值）；
 * - 'girl' → [chatBook?, DOSSIER_BOOK, STORY_BOOK, ARCHIVE_BOOK]；
 * - pending_lore → [chatBook?, DOSSIER_BOOK]；
 * - codex 人员 → [chatBook?, ARCHIVE_BOOK, DOSSIER_BOOK]；
 * - 其余 codex → [chatBook?, ARCHIVE_BOOK]。
 */
export function booksFor(
  item: Pick<ArchiveItem, 'kind' | 'source'> | 'girl' | 'codex',
  chatBook?: string | null,
): string[] {
  const bound = resolveActiveChatBookName(chatBook);
  if (item === 'girl') return dedupBooks([bound, DOSSIER_BOOK, STORY_BOOK, ARCHIVE_BOOK]);
  if (item === 'codex') return dedupBooks([bound, ARCHIVE_BOOK]);
  if (item.source === 'pending_lore' || item.kind === PENDING_KIND) return dedupBooks([bound, DOSSIER_BOOK]);
  if (item.kind === '人员' || item.kind === '人物') return dedupBooks([bound, ARCHIVE_BOOK, DOSSIER_BOOK]);
  return dedupBooks([bound, ARCHIVE_BOOK]);
}

/**
 * 在条目列表里定位 item 对应正史条目：
 * 精确 `${kind}·${name}`（archiveCodexEntries 命名）> `档案·${name}·`（girlFiler 聊天书命名）> 包含 `·${name}·`（girlFiler 全局书命名）> 后缀 `·${name}`（B2 兜底）。
 * 同优先级下 enabled 者优先；无命中 → null。
 */
export function matchArchiveEntry<E extends ArchiveEntryLike>(
  entries: readonly E[],
  item: Pick<ArchiveItem, 'name' | 'kind'>,
): E | null {
  if (!item.name) return null;
  const exact = `${item.kind}·${item.name}`;
  const expansionSettingExact = `${item.kind}·${item.name}·设定`;
  const dossierPrefix = `档案·${item.name}·`;
  const dossierExact = `档案·${item.name}`;
  const infix = `·${item.name}·`;
  const suffix = `·${item.name}`;
  const rules: Array<(name: string) => boolean> = [
    n => n === exact || n === expansionSettingExact,
    n => n.startsWith(dossierPrefix) || n === dossierExact,
    n => n.includes(infix),
    n => n.endsWith(suffix),
  ];
  for (const rule of rules) {
    const hits = entries.filter(e => typeof e.name === 'string' && rule(e.name));
    if (!hits.length) continue;
    return hits.find(e => e.enabled) ?? hits[0];
  }
  return null;
}

/** 在条目列表中同时定位机娘的「能力档案」(`档案·{name}·{model}`) 与「剧情人格现状」(`剧情·{name}·人格与现状`)；支持按 model 匹配机魂母板 */
export function matchGirlEntries<E extends ArchiveEntryLike>(
  entries: readonly E[],
  name: string,
  model?: string,
): { dossierEntry: E | null; storyEntry: E | null } {
  if (!name && !model) return { dossierEntry: null, storyEntry: null };
  const pickBest = (hits: E[]): E | null => (hits.length ? (hits.find(e => e.enabled) ?? hits[0]) : null);

  const dossierHits = name
    ? entries.filter(e => {
        if (typeof e.name !== 'string') return false;
        if (e.name.startsWith(`档案·${name}·`) || e.name === `档案·${name}`) return true;
        if (e.name.startsWith(`剧情·${name}`) || e.name.endsWith('·人格与现状')) return false;
        return e.name.includes(`·${name}·`) || e.name.endsWith(`·${name}`);
      })
    : [];

  let fallbackDossierHits: E[] = [];
  if (dossierHits.length === 0 && model) {
    const cleanModel = model
      .replace(/（[^）]*）|\([^)]*\)/g, '')
      .replace(/首台|原型|机魂母板|母板/g, '')
      .trim();
    if (cleanModel) {
      fallbackDossierHits = entries.filter(e => {
        if (typeof e.name !== 'string') return false;
        if (e.name.startsWith('剧情·') || e.name.endsWith('·人格与现状')) return false;
        return (
          e.name.includes(`·${cleanModel}·`) ||
          e.name.includes(`·${model}·`) ||
          e.name.endsWith(`·${cleanModel}`) ||
          (typeof e.content === 'string' && e.content.includes(`"model": "${cleanModel}"`)) ||
          (typeof e.content === 'string' && e.content.includes(`"model": "${model}"`))
        );
      });
    }
  }

  const storyHits = name
    ? entries.filter(e => {
        if (typeof e.name !== 'string') return false;
        if (e.name.startsWith(`剧情·${name}·`) || e.name === `剧情·${name}`) return true;
        return (e.name.includes(`·${name}·`) || e.name.endsWith(`·${name}`)) && e.name.includes('人格与现状');
      })
    : [];

  return {
    dossierEntry: pickBest(dossierHits.length ? dossierHits : fallbackDossierHits),
    storyEntry: pickBest(storyHits),
  };
}

/** 世界书正文预处理：统一换行、去首尾空白（DetailDrawer 以 pre-wrap 呈现由 FloatingApp.vue 样式负责） */
function normalizeContent(s: string): string {
  return s.replace(/\r\n?/g, '\n').trim();
}

export interface GirlSpecialSkill {
  name: string;
  kind: string;
  desc: string;
}

export interface GirlSpecialEquipment {
  name: string;
  slot: string;
  desc: string;
}

export interface ParsedGirlDossierData {
  data: Record<string, string>;
  model: string;
  form_mech: string;
  skills: string;
  flaws: string;
  weapons: string;
  exposure: string;
  balance: string;
  shell: string;
  appearance: string;
  personality: string;
  status: string;
  serial?: string;
  callsign?: string;
  seq?: string;
  faction?: string;
  body?: string;
  special_skills: GirlSpecialSkill[];
  special_equipment: GirlSpecialEquipment[];
  temperament_spectrum?: string;
  incubation_mode?: string;
  preset_name?: string;
}

export type GirlDossierParsedData = ParsedGirlDossierData;

const BRACKET_COLON_REGEX_CACHE = new Map<string, { bracketRe: RegExp; colonRe: RegExp }>();
const PARSED_GIRL_DOSSIER_CACHE = new Map<string, ParsedGirlDossierData>();
const MAX_DOSSIER_CACHE_SIZE = 256;

function sanitizeExtractedField(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^<\/?数据>$/i.test(trimmed) || trimmed.startsWith('</') || trimmed.startsWith('<数据')) {
    return '';
  }
  return trimmed.replace(/<\/?数据>/gi, '').trim();
}

/** 剥离世界书机娘条目中的 `<数据>...</数据>` 机器块与顶部重复的方括号元数据行，供 UI 干净阅读 */
export function stripDossierMachineBlocks(rawText: string | undefined): string {
  if (!rawText || typeof rawText !== 'string') return '';
  const withoutDataBlock = rawText.replace(/<数据>[\s\S]*?<\/数据>/gi, '');
  const lines = withoutDataBlock.split(/\r?\n/);
  const cleanedLines = lines.filter(line => {
    const t = line.trim();
    if (!t) return true;
    if (/^\[(?:机娘·能力档案|剧情·北坡纪事)\s*\|[^\]]*\]$/i.test(t)) return false;
    if (/^\[(?:出厂编号|机体编号|编号|专属代号|战术代号|代号|机体序列|序列|所属阵营|阵营|躯体特征|纳米躯体|身子|体态特征)\]/i.test(t)) {
      return false;
    }
    if (/^<\/?数据>$/i.test(t)) return false;
    return true;
  });
  return cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractBracketOrColonField(text: string, labels: readonly string[]): string {
  if (!text) return '';
  const cacheKey = labels.join('|');
  let regexPair = BRACKET_COLON_REGEX_CACHE.get(cacheKey);
  if (!regexPair) {
    const escaped = labels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    regexPair = {
      bracketRe: new RegExp(`\\[(?:${escaped})\\][：: \\t]*([^\\r\\n]+)`, 'i'),
      colonRe: new RegExp(`(?:^|\\n)[ \\t]*(?:[·\\-*•][ \\t]*)?(?:${escaped})[ \\t]*[：:][ \\t]*([^\\r\\n]+)`, 'i'),
    };
    BRACKET_COLON_REGEX_CACHE.set(cacheKey, regexPair);
  }
  const bracketMatch = text.match(regexPair.bracketRe);
  const bVal = sanitizeExtractedField(bracketMatch?.[1]);
  if (bVal) return bVal;

  const colonMatch = text.match(regexPair.colonRe);
  const cVal = sanitizeExtractedField(colonMatch?.[1]);
  if (cVal) return cVal;

  return '';
}

/** 解析机娘档案正文中的 `<数据>` 块与八段式结构化字段（含剧情人格与现状） */
export function parseGirlDossierData(dossierContent = '', storyContent = ''): ParsedGirlDossierData {
  const dc = normalizeContent(dossierContent);
  const sc = normalizeContent(storyContent);
  const cacheKey = `${dc}\0${sc}`;
  const cached = PARSED_GIRL_DOSSIER_CACHE.get(cacheKey);
  if (cached) {
    return {
      ...cached,
      data: { ...cached.data },
    };
  }
  const fullText = [dc, sc].filter(Boolean).join('\n');
  const data: Record<string, string> = {};
  const special_skills: GirlSpecialSkill[] = [];
  const special_equipment: GirlSpecialEquipment[] = [];

  // 1. 解析可选 <数据>...</数据> 块（支持 JSON 或 key: value 行）
  const dataBlockMatch = dc.match(/<数据>([\s\S]*?)<\/数据>/i) ?? sc.match(/<数据>([\s\S]*?)<\/数据>/i);
  if (dataBlockMatch) {
    const rawBlock = dataBlockMatch[1].trim();
    if (rawBlock.startsWith('{') && rawBlock.endsWith('}')) {
      try {
        const parsed = JSON.parse(rawBlock) as Record<string, unknown>;
        if (Array.isArray(parsed.special_skills)) {
          for (const item of parsed.special_skills) {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              const sk = item as Record<string, unknown>;
              const sName = String(sk.name ?? '').trim();
              const sKind = String(sk.kind ?? '核心权能').trim();
              const sDesc = String(sk.desc ?? '').trim();
              if (sName && sDesc) {
                special_skills.push({ name: sName, kind: sKind || '核心权能', desc: sDesc });
              }
            }
          }
        }
        if (Array.isArray(parsed.special_equipment)) {
          for (const item of parsed.special_equipment) {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              const eq = item as Record<string, unknown>;
              const eName = String(eq.name ?? '').trim();
              const eSlot = String(eq.slot ?? '专属挂载').trim();
              const eDesc = String(eq.desc ?? '').trim();
              if (eName && eDesc) {
                special_equipment.push({ name: eName, slot: eSlot || '专属挂载', desc: eDesc });
              }
            }
          }
        }
        for (const [k, v] of Object.entries(parsed)) {
          if (v !== undefined && v !== null) {
            data[k] = typeof v === 'string' ? v : JSON.stringify(v);
          }
        }
      } catch {
        /* 非标准 JSON 回退行解析 */
      }
    } else {
      for (const line of rawBlock.split('\n')) {
        const cleaned = line.replace(/^[\s·\-*]+/, '').trim();
        if (!cleaned || /^<\/?数据>$/i.test(cleaned)) continue;
        const m = cleaned.match(/^([^:：=]+?)[ \t]*[:：=][ \t]*(.*)$/);
        if (m) {
          const k = m[1].trim();
          const v = sanitizeExtractedField(m[2]);
          if (k && v) {
            data[k] = v;
          }
        }
      }
    }
  }

  // 2. 从 girlFiler.ts 标准八段正文提取结构化字段（冒号后仅匹配水平空白 [ \t]*，防止空值跨行吞入 </数据>）
  const headerModelMatch =
    dc.match(/\[机娘·能力档案\s*\|\s*[^\]—]+?——([^\]]+)\]/) ??
    sc.match(/\[剧情·北坡纪事\s*\|\s*[^\]—]+?——([^\]]+)\]/);
  const formMechMatch = fullText.match(/形态机制[：:][ \t]*([^\r\n]+(?:\n(?!\n|能力[：:]|结构性短板[：:]|【|\[|<\/?数据>)[^\r\n]+)*)/);
  const skillsMatch = fullText.match(/能力[：:][ \t]*\n?([\s\S]*?)(?=\n\n结构性短板[：:]|\n结构性短板[：:]|\n【|\n\[|\n<\/?数据>|$)/);
  const flawsMatch = fullText.match(/结构性短板[：:][ \t]*([^\r\n]+(?:\n(?!\n|【|\[|<\/?数据>)[^\r\n]+)*)/);
  const weaponsMatch = fullText.match(/(?:·[ \t]*)?武器[：:][ \t]*([^\r\n]+)/);
  const exposureMatch = fullText.match(/(?:·[ \t]*)?暴露分档[：:][ \t]*([^\r\n]+)/);
  const balanceMatch = fullText.match(/(?:·[ \t]*)?平衡总纲位置[：:][ \t]*([^\r\n]+)/);

  const shellMatch = fullText.match(/社会外壳[：:][ \t]*([^\r\n]+)/);
  const appearanceMatch = fullText.match(/外观[：:][ \t]*\n?([\s\S]*?)(?=\n\n性格[：:]|\n性格[：:]|\n\[|\n<\/?数据>|$)/);
  const personalityMatch = fullText.match(/性格[：:][ \t]*([^\r\n]+(?:\n(?!\n|当前状态[：:]|\[|<\/?数据>)[^\r\n]+)*)/);
  const statusMatch = (sc || dc).match(/当前状态[：:][ \t]*([\s\S]*?)(?=\n<数据>|\n<\/数据>|$)/);

  const serialFromText = extractBracketOrColonField(fullText, ['出厂编号', '机体编号', '编号']);
  const callsignFromText = extractBracketOrColonField(fullText, ['专属代号', '战术代号', '代号']);
  const seqFromText = extractBracketOrColonField(fullText, ['机体序列', '序列']);
  const factionFromText = extractBracketOrColonField(fullText, ['所属阵营', '阵营']);
  const bodyFromText = extractBracketOrColonField(fullText, ['躯体特征', '纳米躯体', '身子', '体态特征']);

  const synthesizedSkills =
    special_skills.length > 0
      ? special_skills.map(s => `· 【${s.name}（${s.kind}）】${s.desc}`).join('\n')
      : '';
  const synthesizedWeapons =
    special_equipment.length > 0 ? special_equipment.map(e => e.name).join('；') : '';

  const model = sanitizeExtractedField(data['型号'] ?? data.model ?? (headerModelMatch?.[1]?.trim() || ''));
  const form_mech = sanitizeExtractedField(data['形态机制'] ?? data.form_mech ?? (formMechMatch?.[1]?.trim() || ''));
  const skills = sanitizeExtractedField(
    data['能力'] ??
      data['技能'] ??
      (typeof data.skills === 'string' && !data.skills.startsWith('[') ? data.skills : undefined) ??
      (skillsMatch?.[1]?.trim() || synthesizedSkills),
  );
  const flaws = sanitizeExtractedField(data['结构性短板'] ?? data['短板'] ?? data.flaws ?? (flawsMatch?.[1]?.trim() || ''));
  const weapons = sanitizeExtractedField(
    data['武器'] ??
      data['武装'] ??
      (typeof data.weapons === 'string' && !data.weapons.startsWith('[') ? data.weapons : undefined) ??
      (weaponsMatch?.[1]?.trim() || synthesizedWeapons),
  );
  const exposure = sanitizeExtractedField(
    data['暴露分档'] ?? data.exposure_grade ?? data.exposure ?? (exposureMatch?.[1]?.trim() || ''),
  );
  const balance = sanitizeExtractedField(
    data['平衡总纲位置'] ?? data.balance_slot ?? data.balance ?? (balanceMatch?.[1]?.trim() || ''),
  );
  const shell = sanitizeExtractedField(data['社会外壳'] ?? data.shell ?? (shellMatch?.[1]?.trim() || ''));
  const appearance = sanitizeExtractedField(data['外观'] ?? data.appearance ?? (appearanceMatch?.[1]?.trim() || ''));
  const temperament_spectrum = sanitizeExtractedField(data['机魂光谱'] ?? data.temperament_spectrum ?? '');
  const personality = sanitizeExtractedField(
    data['性格'] ?? data.personality ?? (personalityMatch?.[1]?.trim() || temperament_spectrum),
  );
  const status = sanitizeExtractedField(data['当前状态'] ?? data.status ?? (statusMatch?.[1]?.trim() || ''));
  const incubation_mode = sanitizeExtractedField(data.incubation_mode ?? '');
  const preset_name = sanitizeExtractedField(data.preset_name ?? '');

  const serial = (
    data['编号'] ??
    data['出厂编号'] ??
    data['机体编号'] ??
    data.serial ??
    serialFromText
  ).trim();
  const callsign = (
    data['代号'] ??
    data['专属代号'] ??
    data['战术代号'] ??
    data.callsign ??
    callsignFromText
  ).trim();
  const seq = (data['序列'] ?? data['机体序列'] ?? data.seq ?? seqFromText).trim();
  const faction = (data['阵营'] ?? data['所属阵营'] ?? data.faction ?? factionFromText).trim();
  const body = (
    data['躯体特征'] ??
    data['纳米躯体'] ??
    data['身子'] ??
    data['体态特征'] ??
    data.body ??
    bodyFromText
  ).trim();

  if (model && !data['型号']) data['型号'] = model;
  if (weapons && !data['武器']) data['武器'] = weapons;
  if (skills && !data['技能']) data['技能'] = skills;
  if (exposure && !data['暴露分档']) data['暴露分档'] = exposure;
  if (balance && !data['平衡总纲位置']) data['平衡总纲位置'] = balance;
  if (form_mech && !data['形态机制']) data['形态机制'] = form_mech;
  if (flaws && !data['结构性短板']) data['结构性短板'] = flaws;
  if (shell && !data['社会外壳']) data['社会外壳'] = shell;
  if (personality && !data['性格']) data['性格'] = personality;
  if (status && !data['当前状态']) data['当前状态'] = status;
  if (serial && !data['编号']) data['编号'] = serial;
  if (callsign && !data['代号']) data['代号'] = callsign;
  if (seq && !data['序列']) data['序列'] = seq;
  if (faction && !data['阵营']) data['阵营'] = faction;
  if (body && !data['躯体特征']) data['躯体特征'] = body;

  const parsedResult: ParsedGirlDossierData = {
    data,
    model,
    form_mech,
    skills,
    flaws,
    weapons,
    exposure,
    balance,
    shell,
    appearance,
    personality,
    status,
    serial,
    callsign,
    seq,
    faction,
    body,
    special_skills,
    special_equipment,
    temperament_spectrum,
    incubation_mode,
    preset_name,
  };
  if (PARSED_GIRL_DOSSIER_CACHE.size >= MAX_DOSSIER_CACHE_SIZE) {
    const oldestKey = PARSED_GIRL_DOSSIER_CACHE.keys().next().value;
    if (oldestKey !== undefined) PARSED_GIRL_DOSSIER_CACHE.delete(oldestKey);
  }
  PARSED_GIRL_DOSSIER_CACHE.set(cacheKey, {
    ...parsedResult,
    data: { ...data },
    special_skills: [...special_skills],
    special_equipment: [...special_equipment],
  });
  return parsedResult;
}

export interface GirlDossierDetailResult extends ParsedGirlDossierData {
  name: string;
  book: string | null;
  dossierEntry: ArchiveEntryLike | null;
  storyEntry: ArchiveEntryLike | null;
  dossierContent: string;
  storyContent: string;
  combinedContent: string;
  detail: DetailData;
}

export interface GirlWorldbookReaderLike {
  read(bookName: string): Promise<readonly ArchiveEntryLike[]>;
}

export interface LoadGirlDossierOptions {
  reader?: GirlWorldbookReaderLike;
  chatBook?: string | null;
  entries?: readonly ArchiveEntryLike[];
  entriesByBook?: Record<string, readonly ArchiveEntryLike[]>;
  /** 可选机体型号，用于战地盲盒/自定义赐名机娘回退匹配《机娘·能力档案》中的首台机魂母板数据块 */
  model?: string;
}

async function defaultReadWorldbook(bookName: string): Promise<readonly ArchiveEntryLike[]> {
  try {
    const fn = (globalThis as Record<string, unknown>).getWorldbook;
    if (typeof fn !== 'function') return [];
    const list = await (fn as (name: string) => Promise<unknown>)(bookName);
    return Array.isArray(list) ? (list as ArchiveEntryLike[]) : [];
  } catch {
    return [];
  }
}

/**
 * 跨世界书（含当前聊天绑定书 RA_ChatBook_*、《机娘·能力档案》、《剧情·北坡纪事》）回读机娘详情：
 * 同时匹配 `档案·{name}·{model}`（还原 `<数据>` 块与技能/武器/短板）与 `剧情·{name}·人格与现状`（合并人格与近况正文）。
 * 若聊天绑定书条目尚未包含结构化 `<数据>` 特殊技能/特殊装备，自动从《机娘·能力档案》同名或同型号母板条目回填。
 */
export async function loadGirlDossierDetail(
  name: string,
  optionsOrReader?: GirlWorldbookReaderLike | LoadGirlDossierOptions | readonly ArchiveEntryLike[],
): Promise<GirlDossierDetailResult> {
  let opts: LoadGirlDossierOptions = {};
  if (Array.isArray(optionsOrReader)) {
    opts = { entries: optionsOrReader };
  } else if (optionsOrReader && typeof (optionsOrReader as GirlWorldbookReaderLike).read === 'function') {
    opts = { reader: optionsOrReader as GirlWorldbookReaderLike };
  } else if (optionsOrReader) {
    opts = optionsOrReader as LoadGirlDossierOptions;
  }

  let foundDossier: ArchiveEntryLike | null = null;
  let foundStory: ArchiveEntryLike | null = null;
  let templateDossier: ArchiveEntryLike | null = null;
  let hitBook: string | null = null;

  if (opts.entries) {
    const m = matchGirlEntries(opts.entries, name, opts.model);
    foundDossier = m.dossierEntry;
    foundStory = m.storyEntry;
    hitBook = resolveActiveChatBookName(opts.chatBook) ?? DOSSIER_BOOK;
  } else {
    const candidateBooks = booksFor('girl', opts.chatBook);
    for (const book of candidateBooks) {
      const entries = opts.entriesByBook?.[book] ?? (await (opts.reader?.read(book) ?? defaultReadWorldbook(book)));
      if (!entries?.length) continue;
      const m = matchGirlEntries(entries, name, book === DOSSIER_BOOK ? opts.model : undefined);
      if (!foundDossier && m.dossierEntry) {
        foundDossier = m.dossierEntry;
        hitBook = hitBook ?? book;
      } else if (book === DOSSIER_BOOK && m.dossierEntry && m.dossierEntry !== foundDossier) {
        templateDossier = m.dossierEntry;
      }
      if (!foundStory && m.storyEntry) {
        foundStory = m.storyEntry;
        hitBook = hitBook ?? book;
      }
    }
  }

  const dossierContent = foundDossier?.content ? normalizeContent(foundDossier.content) : '';
  const storyContent = foundStory?.content ? normalizeContent(foundStory.content) : '';
  const combinedContent = [dossierContent, storyContent].filter(Boolean).join('\n\n────────────────\n\n');
  const parsed = parseGirlDossierData(dossierContent, storyContent);

  if (
    templateDossier?.content &&
    (parsed.special_skills.length === 0 || parsed.special_equipment.length === 0)
  ) {
    const tplParsed = parseGirlDossierData(normalizeContent(templateDossier.content), '');
    if (parsed.special_skills.length === 0 && tplParsed.special_skills.length > 0) {
      parsed.special_skills = tplParsed.special_skills;
      if (!parsed.skills) parsed.skills = tplParsed.skills;
    }
    if (parsed.special_equipment.length === 0 && tplParsed.special_equipment.length > 0) {
      parsed.special_equipment = tplParsed.special_equipment;
      if (!parsed.weapons) parsed.weapons = tplParsed.weapons;
    }
    if (!parsed.form_mech && tplParsed.form_mech) parsed.form_mech = tplParsed.form_mech;
    if (!parsed.flaws && tplParsed.flaws) parsed.flaws = tplParsed.flaws;
    if (!parsed.exposure && tplParsed.exposure) parsed.exposure = tplParsed.exposure;
    if (!parsed.temperament_spectrum && tplParsed.temperament_spectrum) {
      parsed.temperament_spectrum = tplParsed.temperament_spectrum;
    }
    parsed.data = { ...tplParsed.data, ...parsed.data };
  }

  const params: [string, string][] = [];
  if (parsed.model) params.push(['型号', parsed.model]);
  if (parsed.weapons) params.push(['武器', parsed.weapons]);
  if (parsed.exposure) params.push(['暴露分档', parsed.exposure]);
  if (parsed.shell) params.push(['社会外壳', parsed.shell]);

  const detail: DetailData = combinedContent
    ? {
        title: name,
        kind: PENDING_KIND,
        params,
        desc: combinedContent,
        note: `正史 · 《${hitBook ?? DOSSIER_BOOK}》`,
      }
    : {
        title: name,
        kind: PENDING_KIND,
        params: [],
        desc: '——',
        note: '草稿 · 尚未在世界书中检索到该机娘档案',
      };

  return {
    name,
    book: hitBook,
    dossierEntry: foundDossier,
    storyEntry: foundStory,
    dossierContent,
    storyContent,
    combinedContent,
    ...parsed,
    detail,
  };
}

/** 《通用·机娘保障工程》10 条保障工学的只读目录回退基线（06 [P2-1] [P2-2]，零改动世界书 JSON 基线） */
export const MECHA_SUPPORT_FALLBACK_CATALOG: ReadonlyArray<{
  name: string;
  kind: string;
  params: [string, string][];
  desc: string;
}> = [
  {
    name: '机娘生命周期与战地勤务通则',
    kind: '保障工程',
    params: [
      ['归属', SUPPORT_BOOK],
      ['类别', '战地卫勤与整备总纲'],
    ],
    desc: '规范机娘在高负荷作战、跨代改装、前沿断链与战伤破损时的物理与神经稳态勤务准则。',
  },
  {
    name: '相变微流道散热工学',
    kind: '保障工程',
    params: [
      ['归属', SUPPORT_BOOK],
      ['作用', '瞬态热负荷抑制'],
    ],
    desc: '在机娘人形态纳米表层下蚀刻多级闭环微流道并灌注高潜热相变微胶囊，抑制高烈度交火与能量武器充能热过载。',
  },
  {
    name: '表皮电磁抑制与生物拟真协议',
    kind: '保障工程',
    params: [
      ['归属', SUPPORT_BOOK],
      ['作用', '渗透伪装与电磁降噪'],
    ],
    desc: '升级外层纳米皮下神经丛的生物拟真微电流与电磁屏蔽层，消除敌后渗透时的纳米微震颤与高频电磁底噪。',
  },
  {
    name: '通用神经总线适配协议',
    kind: '保障工程',
    params: [
      ['归属', SUPPORT_BOOK],
      ['作用', '跨代武备快拆与防排异'],
    ],
    desc: '规范机娘纳米心智与跨代火控、雷达或无人僚机套件间的标准化军用快拆总线接口，避免换装停机与神经排异。',
  },
  {
    name: '高活性纳米创伤凝胶工学',
    kind: '保障工程',
    params: [
      ['归属', SUPPORT_BOOK],
      ['作用', '野战创口止血与稳压'],
    ],
    desc: '单兵与随车高压喷注制剂，受创瞬间封堵装甲贯穿口并临时接管局部纳米回路，防止维持液失压危及心智核心。',
  },
  {
    name: '战术态势分流解算工学',
    kind: '保障工程',
    params: [
      ['归属', SUPPORT_BOOK],
      ['作用', '有人-无人协同算力卸载'],
    ],
    desc: '通过背负式协处理模块分流多通道防空与无人僚机弹道解算，防止机娘心智核心超频过热与认知延迟。',
  },
  {
    name: '心智核心休眠自保回路',
    kind: '保障工程',
    params: [
      ['归属', SUPPORT_BOOK],
      ['作用', '致命重创核心熔断保护'],
    ],
    desc: '核心腔体内置物理级超导自保继电器，遭遇毁灭性贯穿或动力瘫痪时强制进入低熵休眠，防止人格数据热崩溃湮灭。',
  },
  {
    name: '纳米意识映射工学',
    kind: '保障工程',
    params: [
      ['归属', SUPPORT_BOOK],
      ['作用', '心智拓扑只读扫描诊断'],
    ],
    desc: '利用量子纠缠探针对机娘与觉醒老兵的纳米网络进行无损微观拓扑扫描，仅提供只读状态诊断，严禁伪造人格。',
  },
  {
    name: '意识快照存储工学',
    kind: '保障工程',
    params: [
      ['归属', SUPPORT_BOOK],
      ['作用', '离线人格快照保险库备份'],
    ],
    desc: '依托地下深层“意识保险库”为首台机娘与登记老兵提供定期离线人格快照备份，支撑极端战损后的躯体再造。',
  },
  {
    name: '纳米躯体再造工学',
    kind: '保障工程',
    params: [
      ['归属', SUPPORT_BOOK],
      ['作用', '战损机娘躯体重铸与复苏'],
    ],
    desc: '依托“纳米躯体再造舱”提取意识保险库快照注入新铸高纯度纳米躯壳，严格遵循独一性铁律完成战损复苏。',
  },
];

/** 按名称查找《通用·机娘保障工程》只读回退条目（兼容带或不带 `NN·` 序号前缀） */
export function findMechaSupportFallback(name: string): DetailData | null {
  if (!name) return null;
  const cleaned = name.replace(/^\d+·/, '').trim();
  const hit = MECHA_SUPPORT_FALLBACK_CATALOG.find(item => item.name === cleaned || item.name === name);
  if (!hit) return null;
  return {
    title: hit.name,
    kind: hit.kind,
    params: [...hit.params],
    desc: hit.desc,
    note: `只读基线 · 《${SUPPORT_BOOK}》`,
  };
}

/** DetailDrawer 数据：正史（世界书正文，支持合并剧情现状条目）或草稿（本楼摘要） */
export function toDetail(
  item: ArchiveItem,
  entry: ArchiveEntryLike | null,
  book?: string,
  storyEntry?: ArchiveEntryLike | null,
): DetailData {
  const dossierText = entry && typeof entry.content === 'string' ? normalizeContent(entry.content) : '';
  const storyText = storyEntry && typeof storyEntry.content === 'string' ? normalizeContent(storyEntry.content) : '';
  const combined = [dossierText, storyText].filter(Boolean).join('\n\n────────────────\n\n');
  if (combined) {
    return {
      title: item.name,
      kind: item.kind,
      params: [],
      desc: combined,
      note: `正史 · 《${book ?? booksFor(item)[0]}》`,
    };
  }
  const supportFallback = findMechaSupportFallback(item.name);
  if (supportFallback) return supportFallback;
  return {
    title: item.name,
    kind: item.kind,
    params: Object.entries(item.params),
    desc: item.desc || '——',
    note: item.source === 'pending_lore' ? '草稿 · 本楼层 pending_lore，尚未入档' : '草稿 · 本楼层 codex，尚未归档',
  };
}
