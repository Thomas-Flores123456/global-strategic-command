/**
 * parse/parseTypesAndCanon.ts —— 解析管线核心类型契约、上下文、归一/对齐工具、枚举归一与 L0/L1 块提取
 *
 * 约束：零 IO / 零酒馆 API / 零 Vue 依赖。
 */
import { parseString } from '@util/common';
import {
  buildEntityCredibilityIndex,
  evaluateEntityCredibility,
  isSystemCatalogEntity,
  resolveSystemEntityName,
  type CredibilityOptions,
  type CredibilityResult,
  type EntityCredibilityCatalogInput,
  type EntityCredibilityIndex,
  type EntityDomain,
  type SpecificEntityDomain,
} from '../core/entityCredibility';
import { type ChainFlow, Schema } from '../core/schema';
import type { DispatchOrder } from '../engines/transactionEngine';
import type { ParsedPlanningIntent } from '../planning/planningParser';
import { normalizeFlatProtocolBlocks } from '../worldbook/tavernRegexPipeline';
import { stripDarknetBlocks } from '../engines/darknetEngine';
import { stripSpaceBlocks } from '../engines/spaceEngine';
import type { ParsedFactionUnlock } from './factionUnlockParser';
import { atLineStart, endsLine, sanitizeFloorText } from './floorSanitize';
import { indexFloorProtocols } from './floorProtocolIndex';
import { stripSummaryBlocks, type ParsedFloorSummaries } from './summaryBlockParser';
import type { CheckIssue } from './systemCheck';
import { toSimplified } from './t2s';

export {
  buildEntityCredibilityIndex,
  evaluateEntityCredibility,
  isSystemCatalogEntity,
  resolveSystemEntityName,
  type CredibilityOptions,
  type CredibilityResult,
  type EntityCredibilityCatalogInput,
  type EntityCredibilityIndex,
  type EntityDomain,
};

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

export interface ParseResult {
  data: StatData; // Schema.parse 归一后、可直接落盘的完整状态
  applied: boolean; // 是否有任何增量成功应用
  events: ParseEvent[]; // 🟢🟡 修复留痕
  issues: CheckIssue[]; // R17(语法修复) / R18(归一化)
  quarantine: QuarantineItem[]; // 🔴 未入库
  /** F2-乙：本楼收集到的 操作.完成 收讫声明（由 useParse 接缝喂 reconcileProduction） */
  operationCompletions: OperationCompletion[];
  /** CTRL-DISPATCH-PARSE-01：本楼收集到的调度令（<队列>「调度: <动词>」扩展字段，由 useParse 接缝喂 settleFloor） */
  orders: DispatchOrder[];
  /** CTRL-DEPLOY-PARSE-01（E3a）：本楼收集到的部署令（战况「部署/展开/deploy」键，由 useParse 接缝喂 settleFloor；解析层只构造、不执行） */
  deployOrders: DeployOrder[];
  /** CTRL-ENG-PROTO-01（DIR-9）：本楼收集到的工程令（<工程> 容器标签 YAML 内容，由 useParse 接缝喂 projectEngine；解析层只构造、不执行） */
  engOrders: EngOrder[];
  /** EVT-PARSE-01（CTRL-EVENT-PARSE-01）：<事件> 三色门入库前声明（🟢🟡 通道；由 useParse 接缝喂 settleFloor 第四齿轮）；
   *  EVT-PARSE-02：链类声明结转结算，势力/情报/任务声明已在解析层标准化入账（本槽保留全量声明供审计与结转） */
  eventDeclarations: EventDeclaration[];
  /** PLAN-PARSE-01：<排产计划> 意图声明（解析层只构造、不直写生产账本） */
  planningDecls: ParsedPlanningIntent[];
  /** CMD-PARSE-01：<阵营解锁> 结构化卡片载荷收集槽 */
  factionUnlocks: ParsedFactionUnlock[];
  /** 三层剧情摘要收集槽（<摘要>/<summary> 小摘要 + <中摘要>/<大摘要> 委托草稿） */
  floorSummaries?: ParsedFloorSummaries;
}

/** 解析上下文：贯穿各层累积留痕，并计数成功应用次数 */
export interface Ctx {
  events: ParseEvent[];
  issues: CheckIssue[];
  quarantine: QuarantineItem[];
  appliedCount: number;
  /** F2-乙：操作.完成 收讫声明收集槽（不动账本，移交三色门） */
  operationCompletions: OperationCompletion[];
  /** CTRL-DISPATCH-PARSE-01：调度令收集槽（解析层只构造、不执行，执行归引擎调度接口） */
  orders: DispatchOrder[];
  /** CTRL-DEPLOY-PARSE-01（E3a）：部署令收集槽（跳过账本直写，执行归 deploymentEngine） */
  deployOrders: DeployOrder[];
  /** CTRL-ENG-PROTO-01（DIR-9）：工程令收集槽（解析层只构造、不执行，执行归 projectEngine 五函数） */
  engOrders: EngOrder[];
  /** EVT-PARSE-01：事件声明收集槽（链类归 settleFloor 第四齿轮；EVT-PARSE-02：势力/情报/任务已解析层入账）；不动经济账本 */
  eventDeclarations: EventDeclaration[];
  /** PLAN-PARSE-01：<排产计划> 意图声明收集槽 */
  planningDecls: ParsedPlanningIntent[];
  /** CMD-PARSE-01：<阵营解锁> 收集槽 */
  factionUnlocks: ParsedFactionUnlock[];
  /** PLAN-PARSE-01：本楼 <战况> 显式申报的旧队列项（用于与 <排产计划> 冲突检测） */
  legacyQueueWrites: Record<string, unknown>[];
  /** EVT-PARSE-01：Q9 单楼 5 条硬配额跨块累计计数（已进入裁决的条目数） */
  eventsAdmitted: number;
  /** E3a：deploy 目录索引（结构注入；缺席时部署令 fail-closed 拒收，防幻影建筑） */
  deployIndex?: DeployCatalogIndexLike;
  /** 权威名单对齐索引（未注入 authority 时为 undefined，对齐层整体跳过） */
  align?: AlignIndex;
}

export function newCtx(): Ctx {
  return {
    events: [],
    issues: [],
    quarantine: [],
    appliedCount: 0,
    operationCompletions: [],
    orders: [],
    deployOrders: [],
    engOrders: [],
    eventDeclarations: [],
    planningDecls: [],
    factionUnlocks: [],
    legacyQueueWrites: [],
    eventsAdmitted: 0,
  };
}

/** 🟢 确定性修复：静默入库 + event 留痕（可选 R18 info issue） */
export function green(ctx: Ctx, ev: Omit<ParseEvent, 'light'>, issue?: Omit<CheckIssue, 'level'>) {
  ctx.events.push({ light: '🟢', ...ev });
  if (issue) ctx.issues.push({ level: 'info', ...issue });
}

/** 🟡 低置信修复：入库 + event + issue(warn) */
export function yellow(ctx: Ctx, ev: Omit<ParseEvent, 'light'>, issue?: Omit<CheckIssue, 'level'>) {
  ctx.events.push({ light: '🟡', ...ev });
  if (issue) ctx.issues.push({ level: 'warn', ...issue });
}

/* ═══════════════ 基础工具 ═══════════════ */

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

/* ═══════════════ 实体对齐（批 C + FD-27 通用可信度引擎） ═══════════════ */

/** 权威名单注入形状：names=权威名列表；aliases=变体名→权威名（玩家教学记忆）；credibilityIndex=世界书系统目录混合向量索引 */
export interface AuthorityInput {
  names: string[];
  aliases: Record<string, string>;
  credibilityIndex?: EntityCredibilityIndex;
}

/** 预构建的对齐索引（canon 双侧比对 + FD-27 实体语义向量可信度索引） */
export interface AlignIndex {
  /** 原始权威名集（精确层） */
  exact: Set<string>;
  /** canon(权威名) → 权威名（同 canon 取先到） */
  canonToName: Map<string, string>;
  /** canon(变体名) → 权威名（别名词典） */
  aliasToName: Map<string, string>;
  /** 世界书系统目录可信度与双擎向量索引（FD-27） */
  credibilityIndex?: EntityCredibilityIndex;
}

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
  '尤里心灵研究实验室',
  '尤里战斗实验室',
  '苏联战斗实验室',
] as const;

export const DEFAULT_ENTITY_ALIASES: Readonly<Record<string, string>> = {
  战斗工兵: '战斗工程师',
  盟军战斗工兵: '战斗工程师',
  盟军工程师: '战斗工程师',
  盟军作战实验室: '盟军战斗实验室',
  苏联作战实验室: '苏联战斗实验室',
  尤里作战实验室: '尤里战斗实验室',
};

export const SITUATION_KEY_ALIASES: Readonly<Record<string, string>> = {
  兵力: '部队',
  驻军: '部队',
  部队: '部队',
  forces: '部队',
  战损: '战损',
  伤亡: '战损',
  损失: '战损',
  casualties: '战损',
  losses: '战损',
};

export const RESOURCE_PILLAR_ALIASES: Record<string, string[]> = {
  nanites: ['纳米', '纳米机械', '纳米机械储备', '纳米工料', '纳米材料', '纳米原料', '纳米耗材', '纳米储量', '纳米工料储量', 'nanites', 'nanite'],
  minerals: ['矿产', '矿产与原矿', '原矿', '矿物', '矿石', 'minerals', 'mineral'],
  materials: ['建材', '大宗常规建材与化工材料', '工业材料', '材料', '工业品', '工业建材', 'materials', 'material'],
  fuel: ['燃油', '燃油与能源介质', '能源', '燃料', '电力', 'fuel', 'energy'],
  munitions: ['军械', '战术军械弹药', '军械弹药', '弹药', '军火', 'munitions', 'ammo', 'ammunition'],
  logistics: ['后勤', '基地维生与水文后勤', '农产品', '粮食', '食品', '补给', '农产', '食物', '后勤物资', '维生补给', 'logistics', 'food', 'supplies'],
};

export const CHAIN_FIELD_ALIASES: Readonly<Record<string, string>> = {
  日产: '日额',
  日产量: '日额',
  日额: '日额',
  日额度: '日额',
  日收益: '日额',
  每日收益: '日额',
  日产出: '日额',
  每日产出: '日额',
  日净入: '日额',
  日入: '日额',
  额度: '日额',
  金额: '日额',
  收益: '日额',
  产出: '日额',
  每日额度: '日额',
  rate_daily: '日额',
  daily_rate: '日额',
  rate: '日额',
  amount: '日额',
  容量: '容量',
  储量: '容量',
  总容量: '容量',
  总储量: '容量',
  总蕴藏: '容量',
  总额度: '容量',
  剩余容量: '容量',
  剩余储量: '容量',
  剩余蕴藏: '容量',
  capacity: '容量',
  total_yield: '容量',
  remaining_cap: '容量',
};

export const WORLD_EVO_FIELD_ALIASES: Readonly<Record<string, string>> = {
  紧急度: '紧急度',
  优先级: '紧急度',
  紧迫度: '紧急度',
  紧急程度: '紧急度',
  威胁等级: '紧急度',
  威胁度: '紧急度',
  风险: '紧急度',
  风险等级: '紧急度',
  张力: '紧急度',
  紧张度: '紧急度',
  烈度: '紧急度',
  urgency: '紧急度',
  priority: '紧急度',
  tension: '紧急度',
  趋势: '趋势',
  走向: '趋势',
  态势: '趋势',
  态势走向: '趋势',
  演变趋势: '趋势',
  演化趋势: '趋势',
  发展态势: '趋势',
  trend: '趋势',
  tendency: '趋势',
  影响: '详情',
  后果: '详情',
  冲击: '详情',
  波及: '详情',
  潜在影响: '详情',
  影响评估: '详情',
  战略影响: '详情',
  威胁: '详情',
  详情: '详情',
  内容: '详情',
  摘要: '详情',
  描述: '详情',
  impact: '详情',
  effect: '详情',
  consequence: '详情',
  detail: '详情',
  content: '详情',
  summary: '详情',
};

export const INTEL_FIELD_ALIASES: Readonly<Record<string, string>> = {
  ...WORLD_EVO_FIELD_ALIASES,
};

export function buildAlignIndex(a: AuthorityInput): AlignIndex {
  const exact = new Set<string>();
  const canonToName = new Map<string, string>();
  const aliasToName = new Map<string, string>();
  const allNames = [...(a.names ?? []), ...BUILTIN_FACTION_BUILDING_NAMES];
  const MASS_SUFFIXES = ['（量产体）', '(量产体)', '（量产型步兵）', '(量产型步兵)'];
  for (const n of allNames) {
    const rawName = String(n ?? '').trim();
    if (!rawName) continue;
    if (/^(?:00|99)\s*[·.、．-]/.test(rawName) || /总纲|校验回执/.test(rawName)) continue;
    const name = rawName.replace(/^\d+\s*[·.、．-]\s*/, '').trim() || rawName;
    exact.add(name);
    const c = canon(name);
    if (c && !canonToName.has(c)) canonToName.set(c, name);
    for (const suffix of MASS_SUFFIXES) {
      if (name.endsWith(suffix)) {
        const baseName = name.slice(0, -suffix.length).trim();
        if (baseName) {
          exact.add(baseName);
          const bc = canon(baseName);
          if (bc && !canonToName.has(bc)) canonToName.set(bc, baseName);
        }
      }
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
  const credibilityIndex =
    a.credibilityIndex ??
    (Array.isArray(a.names) && a.names.length > 0
      ? buildEntityCredibilityIndex({ names: a.names }, a.aliases)
      : undefined);
  return { exact, canonToName, aliasToName, credibilityIndex };
}

export type AlignHit = 'exact' | 'canon' | 'alias' | 'fuzzy' | 'miss';

/**
 * 实体名对齐梯队（纯函数）：精确 → canon 相等 → 别名词典 → 唯一包含 / 编辑距离≤2 且候选唯一（fuzzy）
 * → FD-27 实体语义向量与可信度引擎 system_high（fuzzy） → 全败（miss）。
 * 全败不是错误：返回原名，由调用方决定注册新实体或留痕。
 * 模糊层仅对 canon 长度≥2 启用（单字名误中风险过高）；包含关系多候选视为歧义直接 miss。
 */
export function alignName(
  input: string,
  ai: AlignIndex,
  domain?: SpecificEntityDomain,
): { name: string; hit: AlignHit } {
  const raw = String(input ?? '').trim();
  if (!raw) return { name: raw, hit: 'miss' };
  const c = canon(raw);

  const hasDomainPool = Boolean(
    domain && ai.credibilityIndex && ai.credibilityIndex.byDomain[domain]?.length > 0,
  );
  let otherDomainOnlyNames: Set<string> | null = null;
  if (hasDomainPool && domain && ai.credibilityIndex) {
    const res = evaluateEntityCredibility(ai.credibilityIndex, raw, {
      domain,
      highThreshold: 0.80,
    });
    if (res.verdict === 'system_high' && res.matchedName) {
      const hit: AlignHit =
        res.stage === 'exact'
          ? 'exact'
          : res.stage === 'canon'
            ? 'canon'
            : res.stage === 'alias'
              ? 'alias'
              : 'fuzzy';
      return { name: res.matchedName, hit };
    }
    const inTargetDomain = new Set(ai.credibilityIndex.byDomain[domain].map(r => r.name));
    otherDomainOnlyNames = new Set<string>();
    for (const r of ai.credibilityIndex.records) {
      if (!inTargetDomain.has(r.name)) {
        otherDomainOnlyNames.add(r.name);
      }
    }
  }

  const isAllowedCandidate = (orig: string): boolean =>
    !otherDomainOnlyNames || !otherDomainOnlyNames.has(orig);

  if (ai.exact.has(raw) && isAllowedCandidate(raw)) return { name: raw, hit: 'exact' };
  const byCanon = ai.canonToName.get(c);
  if (byCanon !== undefined && isAllowedCandidate(byCanon)) return { name: byCanon, hit: 'canon' };
  const byAlias = ai.aliasToName.get(c);
  if (byAlias !== undefined) {
    const resolvedAlias = ai.canonToName.get(canon(byAlias)) ?? byAlias;
    if (isAllowedCandidate(resolvedAlias)) {
      return { name: resolvedAlias, hit: 'alias' };
    }
  }
  if (c.length >= 2) {
    const FACTION_ONLY_TOKENS = new Set(['盟军', '苏联', '尤里', '帝国', '升阳']);
    // 唯一包含关系（双向，禁止将长复合词反向截断为2字阵营词或过短词）
    const contain = new Set<string>();
    for (const [nc, orig] of ai.canonToName) {
      if (nc.length < 2 || FACTION_ONLY_TOKENS.has(nc) || !isAllowedCandidate(orig)) continue;
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
        if (FACTION_ONLY_TOKENS.has(nc) || !isAllowedCandidate(orig)) continue;
        if (editDistance(c, nc) <= 2 && Math.abs(c.length - nc.length) <= 2) near.add(orig);
      }
      if (near.size === 1) return { name: [...near][0], hit: 'fuzzy' };
    }
  }
  if (ai.credibilityIndex) {
    const res = evaluateEntityCredibility(ai.credibilityIndex, raw, {
      domain: domain ?? 'any',
      highThreshold: 0.80,
    });
    if (res.verdict === 'system_high' && res.matchedName) {
      return { name: res.matchedName, hit: 'fuzzy' };
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
export function applyAlign(
  name: string,
  ctx: Ctx,
  path: string,
  mode: 'entity' | 'tech' | 'exact_or_alias',
  domain?: SpecificEntityDomain,
): string {
  if (!ctx.align) return name;
  const r = alignName(name, ctx.align, domain);
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
    if (mode === 'exact_or_alias') return name;
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
    mecha_girl: '机娘',
    mechagirl: '机娘',
    maiden: '机娘',
    机娘状态: '机娘',
    maiden_dossier: '机娘档案',
    maidendossier: '机娘档案',
    战区态势: '态势',
    环境态势: '态势',
    环境: '态势',
    situation: '态势',
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
    战区情报: '情报',
    情报电讯: '情报',
    intel: '情报',
    intelligence: '情报',
    世界暗流: '世界演变',
    宏观演变: '世界演变',
    world_evolution: '世界演变',
    worldevolution: '世界演变',
    调配: '事件',
    单位调配: '事件',
    部队调动: '事件',
    驻地调动: '事件',
    单位迁移: '事件',
    unit_transfer: '事件',
  };
  if (TAG_SYNONYMS[c]) return TAG_SYNONYMS[c];
  const within1 = vocab.filter(v => editDistance(c, v) <= 1);
  return within1.length === 1 ? within1[0] : null;
}

/** 字符串/数字 → number（容 `+120` / `-30` / 带空格）；无法转换返回 null */
export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v ?? '').trim());
  return Number.isNaN(n) ? null : n;
}

/** 建立对象 canon(键) → 原始键 的索引 */
export function keyIndex(obj: Record<string, unknown>): Map<string, string> {
  const m = new Map<string, string>();
  for (const k of Object.keys(obj)) m.set(canon(k), k);
  return m;
}

/** 按别名列表（canon 比对）取值，命中则将同组全部命中别名标记 consumed 并返回首个有效命中 */
export function take(
  obj: Record<string, unknown>,
  idx: Map<string, string>,
  consumed: Set<string>,
  aliases: string[],
): { key: string; value: unknown } | null {
  let picked: { key: string; value: unknown } | null = null;
  for (const a of aliases) {
    const c = canon(a);
    if (idx.has(c)) {
      const k = idx.get(c)!;
      consumed.add(k);
      const val = obj[k];
      if (!picked || ((picked.value == null || picked.value === '') && val != null && val !== '')) {
        picked = { key: k, value: val };
      }
    }
  }
  return picked;
}

/* ═══════════════ 部署令两段式（E3a · CTRL-DEPLOY-PARSE-01，仿 CTRL-DISPATCH-PARSE-01） ═══════════════ */

/** deploy 块机读形（结构视图，与 deploymentEngine DeployBlock 兼容；解析层不 import 引擎保持单向依赖） */
export interface DeployBlockLike {
  into: string;
  capabilities?: readonly string[];
  duration_min?: number;
  reverse?: boolean;
  capacity_ratio?: number;
  deploy_limit?: number;
  /** E3c 案甲：前沿工地可建造建筑实名白名单（capabilities 含 'build.whitelist' 时生效；缺席＝不启用挂载校验） */
  whitelist?: readonly string[];
}

/** deploy 目录索引（纯函数注入；由 deploymentEngine.deployBlockIndexFromCatalog 构建或测试合成） */
export interface DeployCatalogIndexLike {
  byVehicle(vehicleName: string): DeployBlockLike | undefined;
  byInto(buildingName: string): { vehicle: string; block: DeployBlockLike } | undefined;
}

/** E3a：部署令（解析层只构造、不执行；执行归 deploymentEngine.requestDeployment/settleDeployments） */
export interface DeployOrder {
  /** 展开＝车队在账载具名（账本原文）；收起＝反查 deploy.into 回填的载具原名 */
  vehicle: string;
  action: '展开' | '收起';
  /** 目标基地（Base.id；当场建新基地时＝新基地名） */
  base: string;
  /** 展开＝deploy.into 建筑名；收起＝在场建筑名（账本原文） */
  into: string;
  /** 仅「当场建新基地」的展开携带 */
  new_base?: { name: string; location: string };
  /** deploy.duration_min（收起同块对称，D6；缺席为 0＝首次 Δt>0 即翻转） */
  duration_min: number;
}

/** 部署声明（段一收集；段二基于战况增量后状态解析） */
export interface DeployDecl {
  verb: '展开' | '收起';
  /** 展开＝载具名原文；收起＝在场建筑名原文 */
  target: string;
  base?: string;
  newBaseName?: string;
  location?: string;
  hasExplicitActionKey?: boolean;
  raw: string;
  path: string;
}

/* ════ 工程令收集槽（CTRL-ENG-PROTO-01 · DIR-9 D-R9-b/D-R9-c，仿 CTRL-DISPATCH/DEPLOY-PARSE-01） ════ */

/** <工程> 顶层动词键（canon 比对；YAML 对象键序＝声明序，接缝按序结转；UTO-ALLOC-01 扩充「指派」） */
export const ENG_VERBS = ['立项', '注资', '暂停', '恢复', '取消', '驳回', '指派'] as const;

/** 工程令动词键（DIR-9 D-R9-b / UTO-ALLOC-01；<工程> 容器标签 YAML 内容的顶层键） */
export type EngOrderVerb = (typeof ENG_VERBS)[number];

/**
 * 工程令（解析层只构造、不执行；执行归 useParse 接缝 → projectEngine，V2-05 起按实例 schema_version 分流）：
 * - 立项：name+base 必填；base 唯一解析归一 Base.id（歧义→隔离区），不可解析引用原样携带由引擎门拒收；
 *   不认 module 键（工程级操作，出现即整令隔离，V2-05）；
 * - 注资/暂停/恢复/取消：实例标识双通道——proj:* 实例 id 直通；工程名唯一匹配归一为实例 id
 *   （零命中原样携带由引擎拒 not_found；歧义→隔离区，对齐 resolveDispatchOrder 宽进严出消歧哲学）；
 * - 注资：定位维度二选一——phase（V1 线性工程，ProjectPhase.idx 0 起）XOR module（V2 仓段化工程，
 *   模块 id 或模块名，同现即隔离，V2-05）；解析层不知实例版本，维度与实例版本的错配归接缝拒收；
 * - 暂停/恢复：module 键缺席＝工程级；携带＝模块级（V2 专用，模块解析归接缝 id 优先/name 兜底唯一匹配）；
 * - 取消：恒工程级，不认 module 键（出现即整令隔离，V2-05）；
 * - 驳回：reason 必填（DIR-9 D-R9-d：驳回必须给叙事理由）；账本不动，接缝仅登记回执事件；
 * - 指派（UTO-ALLOC-01）：跨基地工程模块承建指派，解析目标工程实例、模块名与目标承建基地。
 */
export interface EngOrder {
  verb: EngOrderVerb;
  /** 立项：工程名（retrofit/project 静态定义名，接缝按 canon 名解析 RetrofitDef/ProjectDef） */
  name?: string;
  /** 立项：牵头基地；指派：目标承建基地（已解析 Base.id 或原样引用，引擎侧 id/name 双通道再匹配） */
  base?: string;
  /** 注资/暂停/恢复/取消/驳回/指派：实例定位（proj:* 直通或唯一匹配归一后的实例 id） */
  id?: string;
  /** 指派（UTO-ALLOC-01）：动作标识 */
  action?: 'allocate';
  /** 指派（UTO-ALLOC-01）：目标工程实例 id（与 id 同源镜像） */
  instanceId?: string;
  /** 指派（UTO-ALLOC-01）：原始工程名/引用文本 */
  rawName?: string;
  /** 注资：阶段序号（ProjectPhase.idx，0 起；V1 线性工程定位维度） */
  phase?: number;
  /** 注资/暂停/恢复/指派：模块定位（V2 仓段化；模块 id 或模块名原样携带，接缝 id 优先/name 兜底唯一解析；与 phase 互斥） */
  module?: string;
  /** 驳回/指派：叙事理由（协议强制非空，缺 → 隔离区） */
  reason?: string;
}

/* ═══════════════ 数组 upsert 引擎 ═══════════════ */

/** 将单个或数组归一为数组 */
export function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

/**
 * 按名 upsert：有则深合并该元素，无则 append。
 * - locate：定位键别名（首个为主名）；targetKey：目标元素上的定位字段（name/item）
 * - mapFields：将 src 字段写入 target（含 consumed 追踪 + 残余键隔离）
 * - mkNew：创建新元素基座（已含必需字段默认）
 * - elemSchema：新元素 safeParse 校验（保证不毒化最终 Schema.parse）
 * - alignMode：批 C 实体对齐（命中→权威名定位，防同实体多名分裂；全败→照常新建/保留）
 */
export function upsertByName(
  arr: Record<string, unknown>[],
  items: unknown,
  opts: {
    locate: string[];
    targetKey: string;
    label: string;
    mkNew: (name: string) => Record<string, unknown>;
    mapFields: (
      target: Record<string, unknown>,
      src: Record<string, unknown>,
      idx: Map<string, string>,
      consumed: Set<string>,
      isNew: boolean,
      elemPath: string,
    ) => void;
    elemSchema: z.ZodType;
    alignMode?: 'entity' | 'tech';
  },
  ctx: Ctx,
): void {
  for (const rawItem of asArray(items)) {
    if (!isUsable(rawItem) || Array.isArray(rawItem)) {
      ctx.quarantine.push({
        scope: 'element',
        tag: opts.label,
        path: opts.label,
        raw: JSON.stringify(rawItem),
        error: '数组元素非对象',
      });
      continue;
    }
    const src = rawItem as Record<string, unknown>;
    const idx = keyIndex(src);
    const consumed = new Set<string>();
    const loc = take(src, idx, consumed, opts.locate);
    const rawName = loc && loc.value != null ? String(loc.value).trim() : '';
    if (!rawName) {
      ctx.quarantine.push({
        scope: 'element',
        tag: opts.label,
        path: opts.label,
        raw: JSON.stringify(src),
        error: `缺少定位键(${opts.locate[0]})`,
        suggestion: `补充 ${opts.locate[0]} 字段`,
      });
      continue;
    }
    const name = opts.alignMode ? applyAlign(rawName, ctx, `${opts.label}[${rawName}]`, opts.alignMode) : rawName;
    const existing = arr.find(e => canon(e[opts.targetKey]) === canon(name));
    if (existing) {
      opts.mapFields(existing, src, idx, consumed, false, `${opts.label}[${name}]`);
      // 对齐命中时 mapFields 会把 src 里的变体名重新写回，这里回填权威名
      if (name !== rawName) existing[opts.targetKey] = name;
      quarantineLeftovers(src, consumed, ctx, `${opts.label}[${name}]`);
      ctx.appliedCount++;
    } else {
      const elem = opts.mkNew(name);
      opts.mapFields(elem, src, idx, consumed, true, `${opts.label}[${name}]`);
      if (name !== rawName) elem[opts.targetKey] = name;
      const parsed = opts.elemSchema.safeParse(elem);
      if (!parsed.success) {
        ctx.quarantine.push({
          scope: 'element',
          tag: opts.label,
          path: `${opts.label}[${name}]`,
          raw: JSON.stringify(src),
          error: '新元素未通过 schema 校验',
          suggestion: parsed.error.issues.map(i => i.message).join('; '),
        });
        continue;
      }
      arr.push(parsed.data as Record<string, unknown>);
      quarantineLeftovers(src, consumed, ctx, `${opts.label}[${name}]`);
      ctx.appliedCount++;
    }
  }
}

/* ═══════════════ 字段设置器 ═══════════════ */

/** 设字符串字段（有値则覆盖） */
export function setStr(
  target: Record<string, unknown>,
  field: string,
  src: Record<string, unknown>,
  idx: Map<string, string>,
  consumed: Set<string>,
  aliases: string[],
  ctx: Ctx,
): void {
  const t = take(src, idx, consumed, aliases);
  if (!t) return;
  target[field] = String(t.value ?? '');
  ctx.appliedCount++;
}

/** 设数字字段：绝对 + delta（同现→绝对优先🟡），可选 clamp 到 schema 边界 */
export function setNumField(
  target: Record<string, unknown>,
  field: string,
  src: Record<string, unknown>,
  idx: Map<string, string>,
  consumed: Set<string>,
  aliases: string[],
  ctx: Ctx,
  path: string,
  bound?: { min: number; max: number },
): void {
  const absT = take(src, idx, consumed, aliases);
  const delta = takeDelta(src, idx, consumed, aliases);
  const cur = typeof target[field] === 'number' ? (target[field] as number) : 0;
  let val: number;
  let mode: 'abs' | 'delta';
  if (absT) {
    const n = toNum(absT.value);
    if (n == null) {
      ctx.quarantine.push({ scope: 'key', path: `${path}.${field}`, raw: String(absT.value), error: '非数字值' });
      return;
    }
    val = n;
    mode = 'abs';
  } else if (delta != null) {
    val = cur + delta;
    mode = 'delta';
  } else {
    return;
  }
  if (mode === 'abs' && delta != null) {
    yellow(
      ctx,
      { layer: 'merge', path: `${path}.${field}`, message: `绝对值与变化同现，取绝对值（delta 忽略）`, after: val },
      { rule: 'R18', target: `${path}.${field}`, message: '绝对值与 delta 同现，已取绝对值' },
    );
  }
  if (bound) {
    const clamped = Math.min(bound.max, Math.max(bound.min, val));
    if (clamped !== val) {
      yellow(
        ctx,
        {
          layer: 'merge',
          path: `${path}.${field}`,
          message: `越界已 clamp 到 [${bound.min},${bound.max}]`,
          before: val,
          after: clamped,
        },
        { rule: 'R18', target: `${path}.${field}`, message: `${field} 越界已 clamp 到 [${bound.min},${bound.max}]` },
      );
      val = clamped;
    }
  }
  target[field] = val;
  ctx.appliedCount++;
}

/** 设枚举字段：非法值→该键🔴丢弃；变体→🟡归一化；精确→静默 */
export function setEnumField(
  target: Record<string, unknown>,
  field: string,
  src: Record<string, unknown>,
  idx: Map<string, string>,
  consumed: Set<string>,
  aliases: string[],
  es: EnumSet,
  ctx: Ctx,
  path: string,
): void {
  const t = take(src, idx, consumed, aliases);
  if (!t) return;
  const r = resolveEnum(t.value, es);
  if (r.value == null) {
    ctx.quarantine.push({
      scope: 'key',
      path: `${path}.${field}`,
      raw: String(t.value),
      error: `枚举值 "${t.value}" 非法`,
      suggestion: `合法值: ${es.canonical.join('|')}`,
    });
    return;
  }
  if (!r.exact) {
    yellow(
      ctx,
      {
        layer: 'L2',
        path: `${path}.${field}`,
        message: `枚举值归一化 "${t.value}" → "${r.value}"`,
        before: t.value,
        after: r.value,
      },
      { rule: 'R18', target: `${path}.${field}`, message: `枚举值漂移已归一化为 "${r.value}"` },
    );
  }
  target[field] = r.value;
  ctx.appliedCount++;
}

/** 未消费键 → 键级🔴隔离（不拖累同块其余键） */
export function quarantineLeftovers(src: Record<string, unknown>, consumed: Set<string>, ctx: Ctx, path: string): void {
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

/* ═══════════════ 枚举归一 ═══════════════ */

export interface EnumSet {
  canonical: string[]; // 合法值列表
  map: Map<string, string>; // canon(变体) → 合法值
}

/** 构造枚举集：合法值自映射 + 额外变体 */
export function mkEnum(canonical: string[], variants: Record<string, string> = {}): EnumSet {
  const map = new Map<string, string>();
  for (const v of canonical) map.set(canon(v), v);
  for (const [k, v] of Object.entries(variants)) map.set(canon(k), v);
  return { canonical, map };
}

/** 解析枚举值：{value|null, exact} */
export function resolveEnum(raw: unknown, es: EnumSet): { value: string | null; exact: boolean } {
  const c = canon(raw);
  const mapped = es.map.get(c);
  if (mapped === undefined) return { value: null, exact: false };
  return { value: mapped, exact: canon(mapped) === c };
}

export const ENUM_BASE_STATUS = mkEnum(['隐蔽中', '警戒', '暴露', '失守', '废弃'], {
  隐蔽: '隐蔽中',
  潜伏: '隐蔽中',
  警戒中: '警戒',
  运转中: '警戒',
  运转: '警戒',
  运行中: '警戒',
  正常: '警戒',
  就绪: '警戒',
  交战中: '暴露',
  交战: '暴露',
  遇袭: '暴露',
  受袭: '暴露',
  战时: '暴露',
  警报: '暴露',
  暴露中: '暴露',
  退役: '废弃', // CTRL-RETIRE-01：退役值认领；重复退役同实体幂等（同值覆盖，不重复记录）
  拆除: '废弃',
  报废: '废弃',
  停用: '废弃',
});
export const ENUM_BASE_STATE = ENUM_BASE_STATUS;
export const ENUM_BUILDING_STATE = mkEnum(['运转', '建造中', '受损', '停机'], {
  运行: '运转',
  运行中: '运转',
  运转中: '运转',
  正常: '运转',
  完好: '运转',
  就绪: '运转',
  建造: '建造中',
  施工中: '建造中',
  在建: '建造中',
  损坏: '受损',
  损毁: '受损',
  被毁: '受损',
  摧毁: '受损',
  战损: '受损',
  瘫痪: '受损',
  废墟: '受损',
  重创: '受损',
  停止: '停机',
  关闭: '停机',
  离线: '停机',
  拆除: '停机',
  变卖: '停机',
  停用: '停机',
  封存: '停机',
});
export const ENUM_HP = mkEnum(['完好', '轻损', '重损', '离线', '轻伤', '重伤', '修复中'], {
  健康: '完好',
  良好: '完好',
  满血: '完好',
  正常: '完好',
  微伤: '轻伤',
  轻度受损: '轻损',
  损坏: '轻损',
  重度受损: '重损',
  损毁: '重伤',
  被毁: '重伤',
  摧毁: '重伤',
  战损: '重伤',
  瘫痪: '重伤',
  重创: '重伤',
  濒死: '重伤',
  维护中: '修复中',
  维修中: '修复中',
  整备中: '修复中',
  抢修中: '修复中',
  医疗舱: '修复中',
  休整: '修复中',
  治疗中: '修复中',
  康复中: '修复中',
  休眠: '离线',
  阵亡: '离线',
  离场: '离线',
});
export const ENUM_GIRL_HP = ENUM_HP;
export const ENUM_ATTITUDE = mkEnum(['敌意', '警觉', '中立', '友善', '未接触'], {
  敌对: '敌意',
  警惕: '警觉',
  友好: '友善',
});
export const ENUM_RISK = mkEnum(['高', '中', '低', '未知'], { 高危: '高', 中危: '中', 低危: '低' });
export const ENUM_CRED = mkEnum(['高', '中', '低'], {});
export const ENUM_QUEUE_TYPE = mkEnum(['建造', '研究', '生产'], {
  建设: '建造',
  建造类: '建造',
  研发: '研究',
  研究类: '研究',
  制造: '生产',
  生产类: '生产',
});
export const ENUM_KIND = mkEnum(['科技', '建筑', '载具', '人员', '人物', '装备', '地点', '阵营', '其他'], {
  科技类: '科技',
  tech: '科技',
  技术: '科技',
  建筑类: '建筑',
  building: '建筑',
  载具类: '载具',
  vehicle: '载具',
  单位: '人员',
  兵种: '人员',
  步兵: '人员',
  人员编制: '人员',
  作战编制: '人员',
  person: '人员',
  NPC: '人物',
  npc: '人物',
  重要人物: '人物',
  角色: '人物',
  人物档案: '人物',
  NPC档案: '人物',
  人物类: '人物',
  character: '人物',
  装备类: '装备',
  equipment: '装备',
  地点类: '地点',
  地区: '地点',
  区域: '地点',
  场所: '地点',
  聚落: '地点',
  据点: '地点',
  地标: '地点',
  location: '地点',
  place: '地点',
  site: '地点',
  阵营类: '阵营',
  势力: '阵营',
  组织: '阵营',
  派系: '阵营',
  集团: '阵营',
  faction: '阵营',
  other: '其他',
});
export const ENUM_AMMO = mkEnum(['充足', '尚可', '告急', '无'], {
  充裕: '充足',
  一般: '尚可',
  紧缺: '告急',
  缺乏: '告急',
  没有: '无',
  无库存: '无',
});
export const ENUM_EXPANSION_KIND = mkEnum(['科技', '建筑', '载具', '人员', '人物', '装备', '地点', '势力'], {
  科技类: '科技',
  tech: '科技',
  技术: '科技',
  建筑类: '建筑',
  building: '建筑',
  载具类: '载具',
  vehicle: '载具',
  单位: '人员',
  兵种: '人员',
  步兵: '人员',
  人员编制: '人员',
  作战编制: '人员',
  person: '人员',
  NPC: '人物',
  npc: '人物',
  重要人物: '人物',
  角色: '人物',
  人物档案: '人物',
  NPC档案: '人物',
  人物类: '人物',
  character: '人物',
  装备类: '装备',
  equipment: '装备',
  地点类: '地点',
  地区: '地点',
  区域: '地点',
  场所: '地点',
  聚落: '地点',
  据点: '地点',
  地标: '地点',
  location: '地点',
  place: '地点',
  site: '地点',
  势力类: '势力',
  组织: '势力',
  财团: '势力',
  派系: '势力',
  企业: '势力',
  集团: '势力',
  公司: '势力',
  军阀: '势力',
  机构: '势力',
  同盟: '势力',
  联合会: '势力',
  organization: '势力',
  corp: '势力',
});

/** 取 delta（键名后缀「变化」或「_delta」）；命中则标记 consumed */
export function takeDelta(
  obj: Record<string, unknown>,
  idx: Map<string, string>,
  consumed: Set<string>,
  aliases: string[],
): number | null {
  for (const a of aliases) {
    for (const suffix of ['变化', '_delta', 'delta']) {
      const c = canon(a + suffix);
      if (idx.has(c)) {
        const k = idx.get(c)!;
        consumed.add(k);
        return toNum(obj[k]);
      }
    }
  }
  return null;
}

/** 是否为可用容器（对象或数组） */
export function isUsable(v: unknown): v is Record<string, unknown> | unknown[] {
  return typeof v === 'object' && v !== null;
}

/* ════ 事件报文三色裁决门（EVT-PARSE-01 · CTRL-EVENT-PARSE-01，真源 §2.2/§2.3；Q8/Q9） ════ */

/** 事件动词（canon 收口：§2.2 六类标准声明；「资金链受挫」为 §3.3 工况联动动词；PRT-EVT-01 扩充「协议发现」「协议实验」「协议排程」；CMD-PARSE-01 扩充「副官指派」） */
export type EventVerb =
  | '资金链建立'
  | '资金链断裂'
  | '资金链受挫'
  | '资金链恢复'
  | '资金链枯竭'
  | '势力发现'
  | '情报获取'
  | '任务接取'
  | '协议发现'
  | '协议实验'
  | '协议排程'
  | '副官指派'
  | 'MCV展开'
  | 'MCV收起'
  | '单位调配';

/** 实体类别（资金链 / 势力 / 情报 / 任务 / 协议 / 副官 / 部署 / 调配） */
export type EventEntityKind =
  | 'chain'
  | 'faction'
  | 'intel'
  | 'quest'
  | 'protocol'
  | 'adjutant'
  | 'deploy'
  | 'transfer';

/** UNIT-TRANSFER-01：单位调配事件载荷 */
export interface TransferEventDecl {
  unit: string;
  category?: string;
  qty: number;
  from_base?: string;
  to_base: string;
  duration_min: number;
  remaining_min?: number;
  method?: string;
  reason?: string;
}

/** MCV-ENGINE-01：MCV展开 / MCV收起 事件载荷 */
export interface DeployEventDecl {
  action: '展开' | '收起';
  vehicle: string;
  base: string;
  newBaseName?: string;
  location?: string;
  building?: string;
  reason?: string;
}

/** CMD-PARSE-01：副官指派事件载荷 */
export interface AdjutantEventDecl {
  role: 'faction' | 'staff';
  faction: string;
  identity: 'human' | 'mcv_girl' | 'commander_self';
  name: string;
  title: string;
  buff_preset: string;
  buff_name: string;
  upkeep_daily: number;
  penalty_preset?: string;
  penalty_name?: string;
  reason: string;
}

/** PRT-EVT-01：协议事件动作类型 */
export type ProtocolEventAction = 'discover' | 'experiment' | 'schedule';

/** PRT-EVT-01 / FIX-P0-04：协议排程标准动作 */
export type ProtocolScheduleVerb = '加入候列' | '移出候列' | '置顶' | '上移' | '下移' | '暂缓' | '恢复';

/** PRT-EVT-01：协议事件载荷（协议发现 / 协议实验 / 协议排程；解析层只构造、不扣费不掷骰，结转 settleFloor 协议结算齿轮） */
export interface ProtocolEventDecl {
  action: ProtocolEventAction;
  protocolAction: ProtocolEventAction;
  id: string;
  protocolId: string;
  name: string;
  protocolName: string;
  base: string;
  reason: string;
  source: string;
  scheduleAction?: ProtocolScheduleVerb;
  auto_queued?: boolean;
  queue_order?: number;
  hold?: boolean;
}

export type ChainKindLiteral =
  | '采矿精炼'
  | '废料回收'
  | '油气化工'
  | '本土商路'
  | '工业转化'
  | '后勤维护';

/** 资金链事件载荷（建立携带全额参数；断裂/受挫仅定位与叙事，额度字段填 0 占位；FD-51 扩展多轨物资与货币及物理三要素依赖） */
export interface ChainEventDecl {
  name: string;
  flow: ChainFlow;
  rate_daily: number;
  base_id: string;
  buildings: string[];
  reason: string;
  chain_kind?: ChainKindLiteral;
  wallet_daily?: Record<string, number>;
  resources_daily?: Record<string, Record<string, number>>;
  vehicles?: string[];
  faction?: string;
  deps?: {
    base_id?: string;
    buildings?: string[];
    vehicles?: string[];
    faction?: string;
    world_resource?: string;
  };
  capacity?: {
    total_yield?: number | null;
    extracted?: number;
  };
}

export type ChainEventDeclaration = ChainEventDecl;

/** 势力发现载荷（对齐 Faction 字段面；枚举非法值已在本门归一；键缺席时不占位——入账侧「有则更新」增量语义） */
export interface FactionEventDecl {
  name: string;
  attitude?: string;
  risk?: string;
  intel?: string;
}

/** 情报获取载荷（来源缺席按「未知来源」归一；三字段恒在——情报为 append 型入账，无更新语义） */
export interface IntelEventDecl {
  src: string;
  content: string;
  cred: string;
}

/** 任务接取载荷（详情/进度缺席不占位；入账侧对在编任务按「有则更新」增量合并） */
export interface QuestEventDecl {
  name: string;
  detail?: string;
  progress?: string;
}

/** 入库前事件声明（三色门产物；解析层只构造、不执行，结转归 EVT-SETTLE-01/EVT-PARSE-02/PRT-EVT-01 接缝） */
export interface EventDeclaration {
  verb: EventVerb;
  kind: EventEntityKind;
  chain?: ChainEventDecl;
  faction?: FactionEventDecl;
  intel?: IntelEventDecl;
  quest?: QuestEventDecl;
  protocol?: ProtocolEventDecl;
  adjutant?: AdjutantEventDecl;
  deploy?: DeployEventDecl;
  transfer?: TransferEventDecl;
  /** PRT-EVT-01：协议声明顶层便捷字段（与 protocol 子对象同源对齐，供 settleFloor 协议结算齿轮消费） */
  protocolAction?: ProtocolEventAction;
  protocolId?: string;
  protocolName?: string;
  base?: string;
  reason?: string;
  source?: string;
  scheduleAction?: ProtocolScheduleVerb;
  auto_queued?: boolean;
  queue_order?: number;
  hold?: boolean;
}

/** 🟡 黄通道条目：声明本体 + 归一化修复说明（每条一注） */
export interface YellowEventDeclaration {
  declaration: EventDeclaration;
  repairs: string[];
  align?: { from: string; to: string };
}

/** 🔴 隔离条目：原始留痕 + 拒收理由 */
export interface QuarantinedEvent {
  source: string;
  error: string;
  suggestion?: string;
}

/** 三色门产物（纯数据，零 ctx 依赖，可独立单测） */
export interface EventGateResult {
  greenEvents: EventDeclaration[];
  yellowEvents: YellowEventDeclaration[];
  quarantineEvents: QuarantinedEvent[];
  /** 本批实际进入裁决的条目数（Q9 配额跨块累计口径；超额截断不计） */
  admitted: number;
}

/** Q9：单楼事件硬配额（声明序前 5 条进入裁决，第 6 条起整项安全截断隔离） */
export const EVENT_QUOTA_PER_FLOOR = 5;

/** PRT-EVT-01：协议索引鸭式输入类型（与 catalogEffective.ts ProtocolIndexSource / ProtocolIdIndex 完全兼容，零循环依赖） */
export interface ProtocolEventIndexItem {
  id?: unknown;
  name?: unknown;
  aliases?: unknown;
  [key: string]: unknown;
}

export type ProtocolIndexSource =
  | {
      protocols?: readonly ProtocolEventIndexItem[] | Record<string, ProtocolEventIndexItem> | null;
      resolveProtocolIdByName?: (nameOrAliasOrId: unknown) => string | undefined;
      resolveProtocolNameById?: (idOrAliasOrName: unknown) => string | undefined;
      idToName?: Record<string, string>;
      nameToId?: Record<string, string>;
      aliasToName?: Record<string, string>;
    }
  | readonly ProtocolEventIndexItem[]
  | Record<string, ProtocolEventIndexItem>
  | null
  | undefined;

/* ═══════════════ L0 提取 ═══════════════ */

/** 词表（canon 形式）：收录已知顶层业务 tag；「事件」为 EVT-PARSE-01 一级标签；「阵营解锁」为 CMD-PARSE-01 一级标签 */
export const VOCAB = [
  '战况',
  '态势',
  '选项',
  '图鉴',
  '初始状态',
  '机娘',
  '机娘档案',
  '数据更新',
  '扩展档案',
  '工程',
  '事件',
  '排产计划',
  '阵营解锁',
  '任务',
  '情报',
  '世界演变',
  '资金链',
];

export const KNOWN_TAGS = VOCAB;

export interface RawBlock {
  tag: string; // canon 形式词表名
  inner: string; // 内容（未剥围栏）
  truncated: boolean; // 未闭合截断
}

export interface Marker {
  index: number; // 开始下标
  end: number; // 结束下标（> 之后）
  isClose: boolean;
  resolved: string | null; // 解析到的词表名
}

/** 剥除代码围栏（块内容级） */
export function stripFences(s: string): string {
  return s
    .replace(/^\s*```[^\n]*\n?/, '') // 首行 ```yaml
    .replace(/\n?```\s*$/, '') // 末行 ```
    .replace(/^\s*```[^\n]*$/gm, ''); // 散落围栏行
}

/** 扫描所有 tag 标记（容忍 <tag|> / < tag > / 全角＜＞ / 属性垃圾 / 大小写） */
export function scanMarkers(raw: string): Marker[] {
  const re = /[<\uFF1C]\s*(\/)?\s*([^<>\uFF1C\uFF1E\r\n]*?)\s*[>\uFF1E]/g;
  const markers: Marker[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const isClose = !!m[1];
    // 名称 = 首个 token（在空格/竖线/等号/斜杠处截断，剥属性垃圾）
    const token = m[2].split(/[\s|=/]+/).filter(Boolean)[0] ?? '';
    markers.push({ index: m.index, end: re.lastIndex, isClose, resolved: resolveVocab(token, VOCAB) });
  }
  return markers;
}

/**
 * L0：从原文提取词表内的 tag 块（CTRL-PARSE-L0-01）。
 * 先剥思考容器、屏蔽 <正文>（floorSanitize），再只认「行首 / 紧跟另一标签」的开标签；
 * 句中提到的业务标签名一律忽略，也不会截断正在读取的块。
 */
export function extractBlocks(original: string, ctx: Ctx): RawBlock[] {
  const san = sanitizeFloorText(original, name => resolveVocab(name, VOCAB) !== null);
  const afterSpace = stripSpaceBlocks(san.business);
  const afterDarknet = afterSpace.includes('暗网') ? stripDarknetBlocks(afterSpace) : afterSpace;
  const afterSummary =
    /<(?:摘要|summary|中摘要|大摘要)(?=\s|>)/i.test(afterDarknet) ||
    /[\uFF1C](?:摘要|summary|中摘要|大摘要)(?=\s|[\uFF1E])/i.test(afterDarknet)
      ? stripSummaryBlocks(afterDarknet)
      : afterDarknet;
  const raw = normalizeFlatProtocolBlocks(afterSummary);
  const stripped = san.notes.filter(n => n.kind !== 'body-masked' && n.kind !== 'body-unclosed');
  if (stripped.length) {
    const removed = stripped.reduce((s, n) => s + n.removed, 0);
    const kinds = [...new Set(stripped.map(n => n.kind))].join(',');
    if (stripped.some(n => n.kind === 'think-unclosed')) {
      yellow(
        ctx,
        { layer: 'L0', message: `思考段未闭合，已截到 <正文> / 文末，共剥离 ${removed} 字（${kinds}）` },
        { rule: 'R17', target: 'think', message: '思考段未闭合，已按截断处理' },
      );
    } else {
      green(ctx, { layer: 'L0', message: `已剥离思考段 ${removed} 字（${kinds}）` });
    }
  }
  const all = scanMarkers(raw);
  // 开标签认领（驾驶员定案）：只认行首（允许前导空白）或紧跟另一标签 > 的开标签
  const markers = all.filter(m => m.isClose || !m.resolved || atLineStart(raw, m.index));
  const ignoredMarks = all.filter(m => !markers.includes(m));
  if (ignoredMarks.length) {
    green(ctx, { layer: 'L0', message: `忽略句中提及的业务标签 ${ignoredMarks.length} 处（非行首，不作块开头）` });
  }
  // 「句末。<战况>⏎」黏连写法不认领，但给 🟡 让玩家可见（可能是真块被漏读）
  for (const m of ignoredMarks) {
    if (!endsLine(raw, m.end)) continue;
    yellow(
      ctx,
      {
        layer: 'L0',
        message: `<${m.resolved}> 出现在行尾但不在行首，未作块开头；若是战报请让其独占一行`,
        snippet: raw.slice(Math.max(0, m.index - 30), m.end).trim(),
      },
      { rule: 'R17', target: m.resolved ?? '', message: `<${m.resolved}> 疑似黏连在句末，未解析` },
    );
  }
  const blocks: RawBlock[] = [];
  const indexed = new Map(indexFloorProtocols(raw, name => resolveVocab(name, VOCAB))
    .map(block => [block.start, block]));
  let i = 0;
  while (i < markers.length) {
    const open = markers[i];
    if (open.isClose || !open.resolved) {
      i++;
      continue;
    }
    if (open.resolved === '态势' || open.resolved === '事件') {
      const block = indexed.get(open.index);
      if (block?.status === 'valid') {
        blocks.push({ tag: open.resolved, inner: block.payload, truncated: false });
      } else {
        yellow(ctx,
          { layer: 'L0', message: `<${open.resolved}> 载荷缺失或跨区损坏，停止应用` },
          { rule: 'R17', target: open.resolved, message: '统一块索引拒绝损坏协议' });
      }
      const end = block?.end ?? open.end;
      i++;
      while (i < markers.length && markers[i].index < end) i++;
      continue;
    }
    let contentEnd = raw.length;
    let truncated = true;
    let next = markers.length; // 从哪里继续
    for (let j = i + 1; j < markers.length; j++) {
      const n = markers[j];
      if (n.isClose && n.resolved === open.resolved) {
        contentEnd = n.index;
        truncated = false;
        next = j + 1;
        break;
      }
      if (!n.isClose && n.resolved) {
        // 遇到下一已知开标签 → 本块未闭合，截至此处（不消费该开标签）
        contentEnd = n.index;
        truncated = true;
        next = j;
        break;
      }
    }
    const inner = raw.slice(open.end, contentEnd);
    if (truncated) {
      yellow(
        ctx,
        {
          layer: 'L0',
          message: `<${open.resolved}> 块未闭合，疑似截断，已截到下一已知标签/文末`,
          snippet: inner.slice(0, 60).trim(),
        },
        { rule: 'R17', target: open.resolved, message: `<${open.resolved}> 块疑似截断（未闭合）` },
      );
    }
    blocks.push({ tag: open.resolved, inner, truncated });
    i = next;
  }
  return blocks;
}

/* ═══════════════ L1 语法 ═══════════════ */

/** 前置预处理：中文标点→ASCII、True/False/None→true/false/null、围栏残留剥离 */
export function preprocess(text: string): string {
  return stripFences(text)
    .replace(/[\u201c\u201d\uFF02]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\uFF1A/g, ': ') // 全角冒号→冒号+空格（保留 YAML 映射语义，偺ckey：value 粘连）
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

/**
 * L1：先原样试 parseString；失败则预处理后重试（记🟡 R17）；仍失败→整块🔴隔离。
 * 返回可用容器或 null（已隔离）。
 */
export function parseBlock(block: RawBlock, ctx: Ctx): Record<string, unknown> | unknown[] | null {
  // 前置预处理为固定步骤（讨论稿 §8）：中文标点的全角版会让 YAML “假成功”产出垃圾结构，必须先归一。
  const stripped = stripFences(block.inner);
  const pre = preprocess(block.inner);
  const repaired = pre !== stripped;
  try {
    const obj = parseString(pre);
    if (isUsable(obj)) {
      if (repaired) {
        yellow(
          ctx,
          {
            layer: 'L1',
            message: `<${block.tag}> 块经语法修复（中文标点/布尔值/围栏）后解析`,
            snippet: stripped.slice(0, 60).trim(),
          },
          { rule: 'R17', target: block.tag, message: `<${block.tag}> 块已自动修复语法` },
        );
      }
      return obj;
    }
    // 解析成功但非容器（如 scalar）
    ctx.quarantine.push({
      scope: 'block',
      tag: block.tag,
      raw: block.inner.trim(),
      error: '解析结果不是对象/数组',
      suggestion: '块内容应为 YAML 键值映射或列表',
    });
    ctx.issues.push({
      rule: 'R17',
      level: 'error',
      target: block.tag,
      message: `<${block.tag}> 解析结果非容器，已隔离`,
    });
    return null;
  } catch (e) {
    ctx.quarantine.push({
      scope: 'block',
      tag: block.tag,
      raw: block.inner.trim(),
      error: errText(e),
      suggestion: '块内容无法解析为 YAML/JSON/JSON5，请检查引号/括号/缩进',
    });
    ctx.issues.push({ rule: 'R17', level: 'error', target: block.tag, message: `<${block.tag}> 整块解析失败，已隔离` });
    return null;
  }
}
