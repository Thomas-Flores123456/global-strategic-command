/**
 * parse/parseCommon.ts —— 解析管线通用行级工具、键值切分、括号剥离、数量后缀提取与实体对齐纯函数（DEC-PARSE-01）
 *
 * 约束：零 IO / 零酒馆 API / 零 Vue 依赖 / 零入参突变。
 */
import { Schema } from '../core/schema';
import type { CheckIssue } from './systemCheck';
import { toSimplified } from './t2s';

/** Schema.parse 归一后的完整状态树 */
export type StatData = z.output<typeof Schema>;

/** 修复留痕（🟢确定性 / 🟡低置信） */
export interface ParseEvent {
  light: '🟢' | '🟡';
  layer: 'L0' | 'L1' | 'L2' | 'merge' | 'instruction';
  message: string;
  path?: string;
  snippet?: string;
  before?: unknown;
  after?: unknown;
  /** 🟡低置信对齐（R19）携带：UI「记为别名」快捷按钮的数据源 */
  align?: { from: string; to: string };
}

/** 🔴 未入库的块 / 键（隔离区） */
export interface QuarantineItem {
  scope: 'block' | 'key' | 'element';
  tag?: string;
  path?: string;
  raw: string;
  error: string;
  suggestion?: string;
}

/** F2-乙：战况.操作.完成 收讫声明（解析层只收集、不动账本；入账归三色对账门统一裁决） */
export interface OperationCompletion {
  /** 对齐后的目标名 */
  item: string;
  /** 操作提供的合法类型枚举（未提供为 undefined） */
  type?: string;
  /** 显式消歧基地（已解析为 Base.id；未提供为 undefined） */
  base?: string;
  /** 原始指令 JSON（留痕） */
  raw: string;
}

/** 权威名单注入形状：names=权威名列表；aliases=变体名→权威名（玩家教学记忆） */
export interface AuthorityInput {
  names: string[];
  aliases: Record<string, string>;
}

/** 预构建的对齐索引（canon 双侧比对） */
export interface AlignIndex {
  /** 原始权威名集（精确层） */
  exact: Set<string>;
  /** canon(权威名) → 权威名（同 canon 取先到） */
  canonToName: Map<string, string>;
  /** canon(变体名) → 权威名（别名词典） */
  aliasToName: Map<string, string>;
}

export type AlignHit = 'exact' | 'canon' | 'alias' | 'fuzzy' | 'miss';

/** 子模块共享的最小解析上下文结构接口 */
export interface ParseCtxLike {
  events: ParseEvent[];
  issues: CheckIssue[];
  quarantine: QuarantineItem[];
  appliedCount: number;
  align?: AlignIndex;
}

/** 🟢 确定性修复：静默入库 + event 留痕（可选 R18 info issue） */
export function green(ctx: ParseCtxLike, ev: Omit<ParseEvent, 'light'>, issue?: Omit<CheckIssue, 'level'>): void {
  ctx.events.push({ light: '🟢', ...ev });
  if (issue) ctx.issues.push({ level: 'info', ...issue });
}

/** 🟡 低置信修复：入库 + event + issue(warn) */
export function yellow(ctx: ParseCtxLike, ev: Omit<ParseEvent, 'light'>, issue?: Omit<CheckIssue, 'level'>): void {
  ctx.events.push({ light: '🟡', ...ev });
  if (issue) ctx.issues.push({ level: 'warn', ...issue });
}

/* ═══════════════ 基础工具与行级纯函数 ═══════════════ */

/** 全角 ASCII / 全角空格 → 半角 */
export function toHalfWidth(s: string): string {
  return s.replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
}

/** 归一化比对键：trim → 全半角 → 小写 → 去内部空格 → 繁→简（批 C）；所有比对两侧都过它 */
export function canon(s: unknown): string {
  return toSimplified(
    toHalfWidth(String(s ?? ''))
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ''),
  );
}

/** Levenshtein 编辑距离（标准 DP，词表短） */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_v, i) => i);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** 剥离首尾中英引号、书名号、方括号包裹并 trim */
export function stripQuotes(raw: unknown): string {
  let s = String(raw ?? '').trim();
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['\u201c', '\u201d'],
    ['\u2018', '\u2019'],
    ['\uFF02', '\uFF02'],
    ['「', '」'],
    ['『', '』'],
    ['《', '》'],
    ['【', '】'],
  ];
  let changed = true;
  while (changed && s.length >= 2) {
    changed = false;
    for (const [open, close] of pairs) {
      if (s.startsWith(open) && s.endsWith(close)) {
        s = s.slice(open.length, s.length - close.length).trim();
        changed = true;
        break;
      }
    }
  }
  return s.replace(/^["'\u201c\u201d\u2018\u2019]+|["'\u201c\u201d\u2018\u2019]+$/g, '').trim();
}

/** 「键: 值」切分（首个半/全角冒号；值可含冒号）；无冒号或空键返回 null */
export function splitTagField(seg: string): { key: string; value: string } | null {
  const m = /^([^:：]+)[:：](.*)$/.exec(seg);
  if (!m || !m[1].trim()) return null;
  return { key: m[1].trim(), value: m[2].trim() };
}

/**
 * 通用键值行切分：支持 `:` / `：` / `=` / `＝`（自动剥离前导列表符 `- ` / `* ` / `• ` 与外层引号）。
 * 无分隔符或键名为空返回 null。
 */
export function splitKeyVal(line: string): { key: string; value: string } | null {
  const cleaned = String(line ?? '')
    .trim()
    .replace(/^(?:[-*•]+|\d+[.、])\s*/, '');
  if (!cleaned) return null;
  const m = /^([^:：=＝]+?)\s*[:：=＝]\s*(.*)$/.exec(cleaned);
  if (!m) return null;
  const key = stripQuotes(m[1]);
  if (!key) return null;
  const value = stripQuotes(m[2]);
  return { key, value };
}

/** 字符串/数字 → number（容 `+120` / `-30` / 带空格）；无法转换返回 null */
export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 宽容数字解析：在 `toNum` 基础上容忍千分位逗号、括号附注与常见量词/单位后缀（如 `500点`、`+1,200`、`3辆`、`600/日`）。
 */
export function parseNum(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw === null || raw === undefined || typeof raw === 'boolean') return null;
  const s = toHalfWidth(String(raw))
    .trim()
    .replace(/,/g, '')
    .replace(/\([^)]*\)|（[^）]*）/g, '')
    .trim();
  if (!s) return null;
  const direct = toNum(s);
  if (direct !== null) return direct;
  const m = /^([+-]?\d+(?:\.\d+)?)\s*(?:[%％]|点|人|名|个|座|处|辆|台|架|艘|门|部|挺|具|发|枚|吨|单位|credits?|(?:\s*[/／]\s*(?:日|天|d|day))*)?$/i.exec(
    s,
  );
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * 提取名称尾部的括号数量或乘号数量后缀（如 `犀牛坦克(3)`、`犀牛坦克（3辆）`、`动员兵 x5`、`灰熊坦克*2`）。
 * 若括号内非纯数量（如 `MCV（盟军）`），则保持原名、qty 返回 null。
 */
export function extractParenQty(raw: string): { name: string; qty: number | null; note?: string } {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { name: '', qty: null };

  // 1. 匹配末尾括号数量：名称(3) / 名称（3辆） / 名称(x3)
  const parenMatch = /^(.+?)\s*[(\uFF08]\s*(?:[xX×*]\s*)?([+-]?\d+(?:\.\d+)?)\s*(?:辆|台|架|艘|门|部|挺|具|人|名|个|座)?\s*[)\uFF09]\s*$/.exec(
    trimmed,
  );
  if (parenMatch) {
    const qty = Number(parenMatch[2]);
    if (Number.isFinite(qty)) {
      return { name: stripQuotes(parenMatch[1]), qty };
    }
  }

  // 2. 匹配末尾 x3 / ×3 / *3 数量后缀
  const multMatch = /^(.+?)\s*[xX×*]\s*([+-]?\d+(?:\.\d+)?)\s*(?:辆|台|架|艘|门|部|挺|具|人|名|个|座)?\s*$/.exec(
    trimmed,
  );
  if (multMatch) {
    const qty = Number(multMatch[2]);
    if (Number.isFinite(qty)) {
      return { name: stripQuotes(multMatch[1]), qty };
    }
  }

  // 3. 匹配非数量括号注记（保留原名，同时提供 note）
  const noteMatch = /^(.+?)\s*[(\uFF08]([^)\uFF09]+)[)\uFF09]\s*$/.exec(trimmed);
  if (noteMatch) {
    return { name: trimmed, qty: null, note: noteMatch[2].trim() };
  }

  return { name: stripQuotes(trimmed), qty: null };
}

/**
 * 归一化标签块内单行文本：去首尾空白、全角空格转半角、剥离列表前缀、统一全角管道与分号。
 */
export function normalizeTagLine(line: string): string {
  return String(line ?? '')
    .replace(/\u3000/g, ' ')
    .trim()
    .replace(/^(?:[-*•]+|\d+[.、])\s*/, '')
    .replace(/\uFF5C/g, ' | ')
    .replace(/\uFF1B/g, '; ')
    .replace(/\uFF1A/g, ': ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ═══════════════ 实体对齐（批 C） ═══════════════ */

export const BUILTIN_FACTION_BUILDING_NAMES = [
  '建造厂',
  '盟军建造厂',
  '苏联建造厂',
  '尤里建造厂',
  '盟军发电厂',
  '苏联磁能反应炉',
  '尤里生物反应炉',
  '盟军兵营',
  '苏联兵营',
  '尤里兵营',
  '盟军矿石精炼厂',
  '苏联矿石精炼厂',
  '盟军战车工厂',
  '苏联战车工厂',
  '尤里战车工厂',
  '盟军空军指挥部',
  '苏联空军指挥部',
  '盟军海军造船厂',
  '苏联海军造船厂',
  '潜艇船坞',
  '盟军战斗实验室',
  '苏联作战实验室',
  '苏联战斗实验室',
  '尤里心灵研究实验室',
  '尤里战斗实验室',
] as const;

export const DEFAULT_ENTITY_ALIASES: Readonly<Record<string, string>> = {
  战斗工兵: '战斗工程师',
  盟军战斗工兵: '战斗工程师',
  盟军工程师: '战斗工程师',
  盟军作战实验室: '盟军战斗实验室',
  苏联作战实验室: '苏联战斗实验室',
  尤里作战实验室: '尤里战斗实验室',
};

export function buildAlignIndex(a: AuthorityInput): AlignIndex {
  const exact = new Set<string>();
  const canonToName = new Map<string, string>();
  const aliasToName = new Map<string, string>();
  const allNames = [...(a.names ?? []), ...BUILTIN_FACTION_BUILDING_NAMES];
  for (const n of allNames) {
    const name = String(n ?? '').trim();
    if (!name) continue;
    exact.add(name);
    const c = canon(name);
    if (c && !canonToName.has(c)) canonToName.set(c, name);
    for (const suffix of ['（量产体）', '(量产体)', '（量产型步兵）', '(量产型步兵)']) {
      const legacyVariant = canon(`${name}${suffix}`);
      if (legacyVariant && !aliasToName.has(legacyVariant)) {
        aliasToName.set(legacyVariant, name);
      }
    }
  }
  for (const [variant, target] of Object.entries(DEFAULT_ENTITY_ALIASES)) {
    const c = canon(variant);
    const tc = canon(target);
    if (c && !aliasToName.has(c)) {
      if (canonToName.has(tc)) {
        aliasToName.set(c, canonToName.get(tc)!);
      } else if (canonToName.has(c) && !aliasToName.has(tc)) {
        aliasToName.set(tc, canonToName.get(c)!);
      } else {
        aliasToName.set(c, target);
      }
    }
    if (tc && !aliasToName.has(tc) && canonToName.has(c) && !canonToName.has(tc)) {
      aliasToName.set(tc, canonToName.get(c)!);
    }
  }
  for (const [variant, target] of Object.entries(a.aliases ?? {})) {
    const t = String(target ?? '').trim();
    const c = canon(variant);
    if (c && t) aliasToName.set(c, t);
  }
  return { exact, canonToName, aliasToName };
}

/**
 * 实体名对齐梯队（纯函数）：精确 → canon 相等 → 别名词典 → 唯一包含 / 编辑距离≤2 且候选唯一（fuzzy） → 全败（miss）。
 * 全败不是错误：返回原名，由调用方决定注册新实体或留痕。
 * 模糊层仅对 canon 长度≥2 启用（单字名误中风险过高）；包含关系多候选视为歧义直接 miss。
 */
export function alignName(input: string, ai: AlignIndex): { name: string; hit: AlignHit } {
  const raw = String(input ?? '').trim();
  if (!raw) return { name: raw, hit: 'miss' };
  if (ai.exact.has(raw)) return { name: raw, hit: 'exact' };
  const c = canon(raw);
  const byCanon = ai.canonToName.get(c);
  if (byCanon !== undefined) return { name: byCanon, hit: 'canon' };
  const byAlias = ai.aliasToName.get(c);
  if (byAlias !== undefined) {
    // 别名目标再过一次 canon 归一（目标本身可能是变体写法）
    return { name: ai.canonToName.get(canon(byAlias)) ?? byAlias, hit: 'alias' };
  }
  if (c.length >= 2) {
    const FACTION_ONLY_TOKENS = new Set(['盟军', '苏联', '尤里', '帝国', '升阳']);
    // 唯一包含关系（双向，但禁止将长复合词反向截断为2字阵营前缀词或过短词）
    const contain = new Set<string>();
    for (const [nc, orig] of ai.canonToName) {
      if (nc.length < 2 || FACTION_ONLY_TOKENS.has(nc)) continue;
      if (nc.includes(c)) {
        contain.add(orig);
      } else if (c.includes(nc) && nc.length >= 3 && c.length - nc.length <= 2) {
        contain.add(orig);
      }
    }
    if (contain.size === 1) return { name: [...contain][0], hit: 'fuzzy' };
    if (contain.size === 0) {
      // 编辑距离≤2 且候选唯一（禁止匹配纯阵营2字词）
      const near = new Set<string>();
      for (const [nc, orig] of ai.canonToName) {
        if (FACTION_ONLY_TOKENS.has(nc)) continue;
        if (editDistance(c, nc) <= 2 && Math.abs(c.length - nc.length) <= 2) near.add(orig);
      }
      if (near.size === 1) return { name: [...near][0], hit: 'fuzzy' };
    }
  }
  return { name: raw, hit: 'miss' };
}

/**
 * 对齐并留痕：
 * - entity 模式（图鉴/基地/机娘/势力/任务定位名）：全败静默保留原名（注册新实体是本职）
 * - tech 模式（queues.item / tech.done / 操作目标）：全败保留原名 + R19 info 留痕（可能是 AI 自创，不拦）
 * canon/别名命中→🟢替换权威名；fuzzy→🟡 R19 替换（事件携带 align 供 UI「记为别名」）。
 */
export function applyAlign(name: string, ctx: ParseCtxLike, path: string, mode: 'entity' | 'tech'): string {
  if (!ctx.align) return name;
  const r = alignName(name, ctx.align);
  if (r.hit === 'exact') return name;
  if (r.hit === 'canon' || r.hit === 'alias') {
    if (r.name !== name) {
      green(ctx, {
        layer: 'L2',
        path,
        message: `实体名对齐（${r.hit === 'alias' ? '别名词典' : '归一相等'}）"${name}" → "${r.name}"`,
        before: name,
        after: r.name,
      });
    }
    return r.name;
  }
  if (r.hit === 'fuzzy') {
    yellow(
      ctx,
      {
        layer: 'L2',
        path,
        message: `低置信对齐 "${name}" → "${r.name}"（包含/编辑距离）`,
        before: name,
        after: r.name,
        align: { from: name, to: r.name },
      },
      { rule: 'R19', target: path, message: `低置信对齐 "${name}" → "${r.name}"——可在报告明细「记为别名」固化` },
    );
    return r.name;
  }
  if (mode === 'tech') {
    green(
      ctx,
      { layer: 'L2', path, message: `"${name}" 不在权威名单，按原名保留（可能是新自创内容）` },
      { rule: 'R19', target: path, message: `"${name}" 未对齐权威名单，已按原名保留` },
    );
  }
  return name;
}

/** 将名称解析到词表（精确 / canon 相等 / 编辑距离≤1 且唯一）；否则 null */
export function resolveVocab(name: string, vocab: string[]): string | null {
  const c = canon(name);
  if (vocab.includes(c)) return c;
  const TAG_SYNONYMS: Record<string, string> = {
    event: '事件',
    events: '事件',
    数据补丁: '数据更新',
    数据修改: '数据更新',
    datapatch: '数据更新',
    data_patch: '数据更新',
    datapatches: '数据更新',
    扩展: '扩展档案',
    新扩展: '扩展档案',
    expansion: '扩展档案',
    expansions: '扩展档案',
    排产: '排产计划',
    生产计划: '排产计划',
    planning: '排产计划',
    阵营启封: '阵营解锁',
    faction_unlock: '阵营解锁',
    战区态势: '态势',
    环境态势: '态势',
    环境: '态势',
    situation: '态势',
    展开: '部署',
    收起: '部署',
    deploy: '部署',
    deployment: '部署',
    deployments: '部署',
    行动选项: '选项',
    决策选项: '选项',
    options: '选项',
    作战任务: '任务',
    任务指令: '任务',
    悬赏任务: '任务',
    quest: '任务',
    quests: '任务',
    mission: '任务',
    missions: '任务',
  };
  if (TAG_SYNONYMS[c]) return TAG_SYNONYMS[c];
  const within1 = vocab.filter(v => editDistance(c, v) <= 1);
  return within1.length === 1 ? within1[0] : null;
}

/** 建立对象 canon(键) → 原始键 的索引 */
export function keyIndex(obj: Record<string, unknown>): Map<string, string> {
  const m = new Map<string, string>();
  for (const k of Object.keys(obj)) m.set(canon(k), k);
  return m;
}

/** 按别名列表（canon 比对）取值，命中则标记 consumed */
export function take(
  obj: Record<string, unknown>,
  idx: Map<string, string>,
  consumed: Set<string>,
  aliases: string[],
): { key: string; value: unknown } | null {
  for (const a of aliases) {
    const c = canon(a);
    if (idx.has(c)) {
      const k = idx.get(c)!;
      consumed.add(k);
      return { key: k, value: obj[k] };
    }
  }
  return null;
}

/** 取 delta（键名后缀「变化」）；命中则标记 consumed */
export function takeDelta(
  obj: Record<string, unknown>,
  idx: Map<string, string>,
  consumed: Set<string>,
  aliases: string[],
): number | null {
  for (const a of aliases) {
    const c = canon(a + '变化');
    if (idx.has(c)) {
      const k = idx.get(c)!;
      consumed.add(k);
      return toNum(obj[k]);
    }
  }
  return null;
}

/** 按别名表只读取值（不修改 consumed） */
export function readAliasValue(
  source: Record<string, unknown>,
  index: Map<string, string>,
  aliases: readonly string[],
): unknown {
  for (const alias of aliases) {
    const key = index.get(canon(alias));
    if (key !== undefined) return source[key];
  }
  return undefined;
}

/** 标量/数组 → 数组（null/undefined → []） */
export function asArray(v: unknown): unknown[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** 是否为可用容器（对象或数组） */
export function isUsable(v: unknown): v is Record<string, unknown> | unknown[] {
  return typeof v === 'object' && v !== null;
}

/** 未消费键 → 键级🔴隔离（不拖累同块其余键） */
export function quarantineLeftovers(
  src: Record<string, unknown>,
  consumed: Set<string>,
  ctx: ParseCtxLike,
  path: string,
): void {
  for (const k of Object.keys(src)) {
    if (consumed.has(k)) continue;
    ctx.quarantine.push({
      scope: 'key',
      path: `${path}.${k}`,
      raw: `${k}: ${JSON.stringify(src[k])}`,
      error: '无法映射的键',
      suggestion: '检查键名是否在协议映射表/别名表内',
    });
  }
}

/** 剥除代码围栏（块内容级） */
export function stripFences(s: string): string {
  return s
    .replace(/^\s*```[^\n]*\n?/, '') // 首行 ```yaml
    .replace(/\n?```\s*$/, '') // 末行 ```
    .replace(/^\s*```[^\n]*$/gm, ''); // 散落围栏行
}

/** 前置预处理：中文标点→ASCII、True/False/None→true/false/null、围栏残留剥离 */
export function preprocess(text: string): string {
  return stripFences(text)
    .replace(/[\u201c\u201d\uFF02]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\uFF1A/g, ': ') // 全角冒号→冒号+空格（保留 YAML 映射语义，防 key：value 粘连）
    .replace(/\uFF0C/g, ', ')
    .replace(/\u3000/g, ' ')
    .replace(/\b(?:True|TRUE)\b/g, 'true')
    .replace(/\b(?:False|FALSE)\b/g, 'false')
    .replace(/\b(?:None|NULL|Null)\b/g, 'null');
}

/** 三级错误信息提取（parseString 抛出的 literalYamlify 包裹信息或普通 Error） */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
