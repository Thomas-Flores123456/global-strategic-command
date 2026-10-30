/**
 * 聊天剧情摘要压缩操作层（summaryFiler）——CTRL-CHATBOOK-03 设计案落地
 *
 * 1. 区间构造纯函数（nextSummaryRange）：
 *    - 唯一真源＝聊天书内「摘要·」前缀条目 extra.to 最大值；
 *    - 新区间自 maxTo+1 起算，截止至 currentFloor - tailReserve（M=10 尾部保留带）；
 *    - #0 楼（MVU 初始变量锚）与尾部保留带永不入区间；
 *    - 区间左闭右闭、首尾相接、零重叠零漏段由构造保证（设计案 §3 铁律）；
 *    - extra 记 {from, to, generatedAt, model} 为区间唯一真源，不自建独立账本。
 *
 * 2. 纯函数渲染与条目 upsert（upsertSummaryEntry）：
 *    - comment 规范＝「摘要·{from 三位补零}-{to 三位补零}」（如 摘要·001-020）；
 *    - 默认激活策略＝constant 蓝灯常驻＋at_depth（role=system, depth=4）；
 *    - 次要激活策略＝selective 绿灯分层激活（key=SummaryDraft.keys）；
 *    - 递归防范：prevent_incoming: true。
 *
 * 3. 档案入档与弃置副作用层（fileSummary / discardSummary）：
 *    - fileSummary 经 chatBookGateway 三重守卫（首写惰性建书 createIfMissing: true）；
 *    - 守卫失败 fail-closed 抛出 GuardError，绝不清 pending_summaries；
 *    - 按 comment 幂等 upsert；
 *    - discardSummary 删聊天书条目 → extra.to 最大值天然回退 → 区间指针天然回退；
 *    - 可逆性成对铁律（设计案 §5）：弃置摘要条目必须自动取消隐藏对应区间楼层！
 *
 * 4. 隐藏成对操作层与放行门（hideRange / unhideRange / adoptSummary）：
 *    - 豁免带硬编码：#0 楼与尾部保留带永不入隐藏集合；
 *    - 放行门：hidingGateApproved（默认 false，localStorage 持久化）；
 *    - 放行门未过时，采纳强制走「仅注入不隐藏」，且管理页隐藏入口置灰；
 *    - adoptSummary 组合流：入书成功 →（放行门过且开启隐藏）→ hideRange；
 *    - 成对不变量：隐藏集合 ＝ 区间集合；
 *    - 真机放行门探针 probeHiddenFloorEffects（🔴 驾驶员手动触发，绝不自动运行）。
 *
 * 5. 后台独立请求封装（requestSummary）：
 *    - generateRaw＋should_silence: true＋ordered_prompts 自定义摘要提示词；
 *    - 产物进 pending_summaries 暂存，绝不直接入书（自动的只是生成，采纳永远是人）；
 *    - 缺 API 报错不静默。
 *
 * 6. 三组模式设置项（localStorage 持久化，对齐 AUTO_APPLY_KEY 先例）：
 *    - 激活策略：constant（默认）｜ selective；
 *    - 触发模式：manual（默认）｜ auto（每 N=20 楼预生成进暂存，采纳永远是人）；
 *    - 楼层处理：hide（默认，采纳即隐藏，受放行门约束）｜ keep（仅注入不隐藏）。
 */

import type { ChatBookGatewayLike, WriteTxn } from './chatBookBinding';
import { chatBookGateway } from './chatBookBinding';
import { recordFlightLog } from '../debug/dataFlowTracer';
import type { ThEntry } from './girlFiler';
import type { MicroSummaryItem, SummaryDraft, SummaryTier } from '../core/schema';
import { tav } from '../parse/systemCheck';

/* ═══════════════ 常量与类型定义 ═══════════════ */

export const SUMMARY_PREFIX = '摘要·';
export const MACRO_SUMMARY_PREFIX = '摘要·大·';
export const MESO_SUMMARY_ALT_PREFIX = '摘要·中·';
export const DEFAULT_SUMMARY_N = 20; // 提案值：每 N=20 楼触发提醒 / 预生成
export const DEFAULT_MACRO_MESO_COUNT = 4; // 提案值：每 K=4 段中摘要可归并生成 1 条大摘要
export const DEFAULT_TAIL_RESERVE = 10; // 提案值：尾部保留带 M=10 楼保持近场原文精度
export const DEFAULT_DEPTH = 4; // 提案值：at_depth 注入深度
export const DEFAULT_MACRO_DEPTH = 5; // 提案值：大摘要 at_depth 注入深度（略深于近场中摘要，构成远→近因果漏斗）
export const SUMMARY_TOKEN_BUDGET_SINGLE = 500; // 单条摘要目标 ≤500 token
export const SUMMARY_TOKEN_BUDGET_TOTAL = 3000; // 聊天书内摘要段总预算 ≤3000 token

/** localStorage 持久化键名（对齐 AUTO_APPLY_KEY 先例） */
export const SUMMARY_STRATEGY_KEY = 'redalert_summary_strategy';
export const SUMMARY_TRIGGER_KEY = 'redalert_summary_trigger';
export const SUMMARY_FLOOR_HANDLING_KEY = 'redalert_summary_floor_handling';
export const SUMMARY_HIDING_GATE_KEY = 'redalert_summary_hiding_gate';
export const SUMMARY_CHANNEL_KEY = 'redalert_summary_channel';
export const SUMMARY_ENDPOINT_KEY = 'redalert_summary_endpoint_config';
export const SUMMARY_BUDGET_CONFIG_KEY = 'redalert_summary_budget_config';
export const SUMMARY_AUTO_CONFIRM_KEY = 'redalert_summary_auto_confirm';

export type SummaryStrategy = 'constant' | 'selective';
export type SummaryTrigger = 'manual' | 'auto';
export type SummaryFloorHandling = 'hide' | 'keep';
/** 方案 C 双模生成通道：generate_raw = 后台独立请求（支持额外端点） | delegate_main = 委托主模型在下一楼顺带输出 <中摘要>/<大摘要> */
export type SummaryChannel = 'generate_raw' | 'delegate_main';
export type SummaryEndpointMode = 'default' | 'proxy_preset' | 'custom';
export type SummaryEndpointSource = 'openai' | 'claude' | 'makersuite' | 'deepseek';

export interface SummaryBudgetConfig {
  /** 大摘要（战役总纲）总预算上限 (tok)，默认 1200 */
  macroBudgetTokens: number;
  /** 单卷大摘要目标篇幅 (tok)，默认 500 */
  macroSingleTargetTokens: number;
  /** 中摘要（阶段摘要）总预算上限 (tok)，默认 1800 */
  mesoBudgetTokens: number;
  /** 单段中摘要目标篇幅 (tok)，默认 400 */
  mesoSingleTargetTokens: number;
  /** 小摘要（逐楼纪要）总预算上限 (tok)，默认 800 */
  microBudgetTokens: number;
  /** 单条小摘要目标上限 (tok)，默认 80 */
  microSingleTargetTokens: number;
  /** 尾部近场不隐藏的原文保留楼层数，默认 10 */
  tailReserveFloors: number;
}

export const DEFAULT_SUMMARY_BUDGET_CONFIG: SummaryBudgetConfig = {
  macroBudgetTokens: 1200,
  macroSingleTargetTokens: 500,
  mesoBudgetTokens: 1800,
  mesoSingleTargetTokens: 400,
  microBudgetTokens: 800,
  microSingleTargetTokens: 80,
  tailReserveFloors: DEFAULT_TAIL_RESERVE,
};

export type SummaryBudgetPresetKey = 'compact' | 'balanced' | 'detailed';

export const SUMMARY_BUDGET_PRESETS: Record<
  SummaryBudgetPresetKey,
  { label: string; desc: string; config: SummaryBudgetConfig }
> = {
  compact: {
    label: '省流紧凑',
    desc: '严控上下文占用，适合长线百楼以上存档或小窗口模型',
    config: {
      macroBudgetTokens: 800,
      macroSingleTargetTokens: 350,
      mesoBudgetTokens: 1000,
      mesoSingleTargetTokens: 250,
      microBudgetTokens: 400,
      microSingleTargetTokens: 50,
      tailReserveFloors: 6,
    },
  },
  balanced: {
    label: '标准均衡',
    desc: '兼顾远期战史脉络与近期对话细节（推荐默认）',
    config: { ...DEFAULT_SUMMARY_BUDGET_CONFIG },
  },
  detailed: {
    label: '详尽史诗',
    desc: '保留更丰富的战役细节与更长的近期原文楼层',
    config: {
      macroBudgetTokens: 2400,
      macroSingleTargetTokens: 700,
      mesoBudgetTokens: 3200,
      mesoSingleTargetTokens: 600,
      microBudgetTokens: 1400,
      microSingleTargetTokens: 120,
      tailReserveFloors: 15,
    },
  },
};

export interface SummaryContextBreakdown {
  /** 大摘要（战役总纲）Token 总量 */
  macroTokens: number;
  macroCount: number;
  /** 中摘要（阶段摘要）Token 总量 */
  mesoTokens: number;
  /** 常驻蓝灯中摘要 Token */
  mesoConstantTokens: number;
  /** 按需绿灯中摘要 Token */
  mesoSelectiveTokens: number;
  mesoCount: number;
  /** 小摘要（逐楼纪要）Token 总量 */
  microTokens: number;
  /** 尚未被阶段摘要覆盖的活跃小摘要 Token */
  microUncoveredTokens: number;
  microCount: number;
  /** 未被隐藏的聊天正文 Token 总量 */
  unhiddenRawTokens: number;
  /** 未隐藏的聊天楼层数 */
  unhiddenFloorCount: number;
  /** 已隐藏的聊天楼层数 */
  hiddenFloorCount: number;
  /** 三档摘要合计 Token（大 + 中 + 小） */
  summaryTotalTokens: number;
  /** 三档摘要总预算上限（大预算 + 中预算 + 小预算） */
  summaryBudgetTotal: number;
  /** 包含未隐藏正文的剧情上下文总 Token（大 + 中 + 小 + 未隐藏正文） */
  grandTotalTokens: number;
  /** 占总上下文比例 (0~100) */
  macroSharePct: number;
  mesoSharePct: number;
  microSharePct: number;
  unhiddenRawSharePct: number;
  /** 各档自身预算使用率 (0~100+) */
  macroBudgetUsagePct: number;
  mesoBudgetUsagePct: number;
  microBudgetUsagePct: number;
  summaryBudgetUsagePct: number;
}

export interface SummaryEndpointConfig {
  mode: SummaryEndpointMode;
  proxyPreset: string;
  apiurl: string;
  key: string;
  model: string;
  source: SummaryEndpointSource;
}

export const DEFAULT_ENDPOINT_CONFIG: SummaryEndpointConfig = {
  mode: 'default',
  proxyPreset: '',
  apiurl: '',
  key: '',
  model: '',
  source: 'openai',
};

export type SummaryRange = [number, number];

export interface SummaryRangeInfo {
  comment?: string;
  from: number;
  to: number;
  entry: ThEntry;
  tier?: 'meso' | 'macro';
}

export interface SummaryUpsertResult {
  entries: ThEntry[];
  action: 'created' | 'updated';
  entryName: string;
  demotedMesoComments?: string[];
}

export interface FileSummaryReceipt {
  comment: string;
  book: string;
  from: number;
  to: number;
  action: 'created' | 'updated';
  tier?: SummaryTier;
  demotedMesoComments?: string[];
}

export interface DiscardSummaryReceipt {
  from: number;
  to: number;
  deletedEntry: boolean;
  unhiddenFloors: number[];
  restoredMesoComments?: string[];
}

export interface AdoptSummaryReceipt {
  comment: string;
  book: string;
  from: number;
  to: number;
  hidden: boolean;
  hiddenFloors: number[];
  tier?: SummaryTier;
  demotedMesoComments?: string[];
}

export interface ProbeReport {
  probe: 'hidden-floor-effects';
  ok: boolean;
  observed: Record<string, unknown>;
  note: string;
}

type UpdateWorldbookWith = (name: string, updater: (entries: ThEntry[]) => ThEntry[]) => Promise<ThEntry[]>;

/* ═══════════════ 设置项操作（纯逻辑 + localStorage 容错） ═══════════════ */

function resolveStorage(custom?: Storage): Storage | null {
  if (custom) return custom;
  if (typeof localStorage !== 'undefined') return localStorage;
  const g = globalThis as Record<string, unknown>;
  return (g.localStorage as Storage) ?? null;
}

export function getSummaryStrategy(storage?: Storage): SummaryStrategy {
  const s = resolveStorage(storage);
  const val = s?.getItem(SUMMARY_STRATEGY_KEY);
  return val === 'selective' ? 'selective' : 'constant'; // 默认 constant 全常驻
}

export function setSummaryStrategy(val: SummaryStrategy, storage?: Storage): void {
  const s = resolveStorage(storage);
  s?.setItem(SUMMARY_STRATEGY_KEY, val);
}

export function getSummaryTrigger(storage?: Storage): SummaryTrigger {
  const s = resolveStorage(storage);
  const val = s?.getItem(SUMMARY_TRIGGER_KEY);
  return val === 'manual' ? 'manual' : 'auto'; // 默认 auto 每满 20 楼自动触发
}

export function setSummaryTrigger(val: SummaryTrigger, storage?: Storage): void {
  const s = resolveStorage(storage);
  s?.setItem(SUMMARY_TRIGGER_KEY, val);
}

export function getSummaryFloorHandling(storage?: Storage): SummaryFloorHandling {
  const s = resolveStorage(storage);
  const val = s?.getItem(SUMMARY_FLOOR_HANDLING_KEY);
  return val === 'keep' ? 'keep' : 'hide'; // 默认 hide 采纳即隐藏
}

export function setSummaryFloorHandling(val: SummaryFloorHandling, storage?: Storage): void {
  const s = resolveStorage(storage);
  s?.setItem(SUMMARY_FLOOR_HANDLING_KEY, val);
}

export function isHidingGateApproved(storage?: Storage): boolean {
  const s = resolveStorage(storage);
  const val = s?.getItem(SUMMARY_HIDING_GATE_KEY);
  if (val === 'pending') return false;
  return true; // 默认 true（已开启可用）
}

export function setHidingGateApproved(approved: boolean, storage?: Storage): void {
  const s = resolveStorage(storage);
  s?.setItem(SUMMARY_HIDING_GATE_KEY, approved ? 'approved' : 'pending');
}

/** 是否自动确认摘要草稿并直接入档（默认 true 开启） */
export function getSummaryAutoConfirm(storage?: Storage): boolean {
  const s = resolveStorage(storage);
  const val = s?.getItem(SUMMARY_AUTO_CONFIRM_KEY);
  if (val === 'false' || val === 'manual') return false;
  return true; // 默认 true（自动确认入档）
}

export function setSummaryAutoConfirm(val: boolean, storage?: Storage): void {
  const s = resolveStorage(storage);
  s?.setItem(SUMMARY_AUTO_CONFIRM_KEY, val ? 'true' : 'false');
}

export function getSummaryChannel(storage?: Storage): SummaryChannel {
  const s = resolveStorage(storage);
  const val = s?.getItem(SUMMARY_CHANNEL_KEY);
  return val === 'delegate_main' ? 'delegate_main' : 'generate_raw';
}

export function setSummaryChannel(val: SummaryChannel, storage?: Storage): void {
  const s = resolveStorage(storage);
  s?.setItem(SUMMARY_CHANNEL_KEY, val);
}

export function getSummaryEndpointConfig(storage?: Storage): SummaryEndpointConfig {
  const s = resolveStorage(storage);
  const raw = s?.getItem(SUMMARY_ENDPOINT_KEY);
  if (!raw) return { ...DEFAULT_ENDPOINT_CONFIG };
  try {
    const parsed = JSON.parse(raw) as Partial<SummaryEndpointConfig>;
    const mode: SummaryEndpointMode =
      parsed.mode === 'proxy_preset' || parsed.mode === 'custom' ? parsed.mode : 'default';
    const source: SummaryEndpointSource =
      parsed.source === 'claude' || parsed.source === 'makersuite' || parsed.source === 'deepseek'
        ? parsed.source
        : 'openai';
    return {
      mode,
      proxyPreset: typeof parsed.proxyPreset === 'string' ? parsed.proxyPreset : '',
      apiurl: typeof parsed.apiurl === 'string' ? parsed.apiurl : '',
      key: typeof parsed.key === 'string' ? parsed.key : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      source,
    };
  } catch {
    return { ...DEFAULT_ENDPOINT_CONFIG };
  }
}

export function setSummaryEndpointConfig(cfg: Partial<SummaryEndpointConfig>, storage?: Storage): SummaryEndpointConfig {
  const current = getSummaryEndpointConfig(storage);
  const next: SummaryEndpointConfig = {
    ...current,
    ...cfg,
  };
  const s = resolveStorage(storage);
  s?.setItem(SUMMARY_ENDPOINT_KEY, JSON.stringify(next));
  return next;
}

/**
 * 将 SummaryEndpointConfig 转换为 Tavern Helper `generateRaw` 所需的 `custom_api` 字段：
 * - mode === 'default': 若指定了 model 则传 `{ model }`，否则返回 undefined（完全走当前主 API）；
 * - mode === 'proxy_preset': 传 `{ proxy_preset, ...(model ? { model } : {}) }`；
 * - mode === 'custom': 传 `{ apiurl, key, model, source }`。
 */
export function buildCustomApiFromEndpointConfig(
  cfg: SummaryEndpointConfig,
): Record<string, unknown> | undefined {
  if (cfg.mode === 'proxy_preset') {
    const preset = cfg.proxyPreset.trim();
    if (!preset) return undefined;
    const out: Record<string, unknown> = { proxy_preset: preset };
    if (cfg.model.trim()) out.model = cfg.model.trim();
    return out;
  }
  if (cfg.mode === 'custom') {
    const apiurl = cfg.apiurl.trim();
    if (!apiurl) return undefined;
    const out: Record<string, unknown> = {
      apiurl,
      source: cfg.source || 'openai',
    };
    if (cfg.key.trim()) out.key = cfg.key.trim();
    if (cfg.model.trim()) out.model = cfg.model.trim();
    return out;
  }
  if (cfg.model.trim()) {
    return { model: cfg.model.trim() };
  }
  return undefined;
}

function clampInt(val: unknown, fallback: number, min: number, max: number): number {
  const n = typeof val === 'number' && Number.isFinite(val) ? Math.round(val) : fallback;
  return Math.max(min, Math.min(max, n));
}

export function normalizeSummaryBudgetConfig(raw?: Partial<SummaryBudgetConfig> | null): SummaryBudgetConfig {
  const src = raw ?? {};
  return {
    macroBudgetTokens: clampInt(src.macroBudgetTokens, DEFAULT_SUMMARY_BUDGET_CONFIG.macroBudgetTokens, 200, 8000),
    macroSingleTargetTokens: clampInt(
      src.macroSingleTargetTokens,
      DEFAULT_SUMMARY_BUDGET_CONFIG.macroSingleTargetTokens,
      150,
      1500,
    ),
    mesoBudgetTokens: clampInt(src.mesoBudgetTokens, DEFAULT_SUMMARY_BUDGET_CONFIG.mesoBudgetTokens, 300, 10000),
    mesoSingleTargetTokens: clampInt(
      src.mesoSingleTargetTokens,
      DEFAULT_SUMMARY_BUDGET_CONFIG.mesoSingleTargetTokens,
      100,
      1200,
    ),
    microBudgetTokens: clampInt(src.microBudgetTokens, DEFAULT_SUMMARY_BUDGET_CONFIG.microBudgetTokens, 100, 5000),
    microSingleTargetTokens: clampInt(
      src.microSingleTargetTokens,
      DEFAULT_SUMMARY_BUDGET_CONFIG.microSingleTargetTokens,
      20,
      300,
    ),
    tailReserveFloors: clampInt(src.tailReserveFloors, DEFAULT_SUMMARY_BUDGET_CONFIG.tailReserveFloors, 2, 40),
  };
}

export function getSummaryBudgetConfig(storage?: Storage): SummaryBudgetConfig {
  const s = resolveStorage(storage);
  const raw = s?.getItem(SUMMARY_BUDGET_CONFIG_KEY);
  if (!raw) return { ...DEFAULT_SUMMARY_BUDGET_CONFIG };
  try {
    const parsed = JSON.parse(raw) as Partial<SummaryBudgetConfig>;
    return normalizeSummaryBudgetConfig(parsed);
  } catch {
    return { ...DEFAULT_SUMMARY_BUDGET_CONFIG };
  }
}

export function setSummaryBudgetConfig(
  cfg: Partial<SummaryBudgetConfig>,
  storage?: Storage,
): SummaryBudgetConfig {
  const current = getSummaryBudgetConfig(storage);
  const next = normalizeSummaryBudgetConfig({ ...current, ...cfg });
  const s = resolveStorage(storage);
  s?.setItem(SUMMARY_BUDGET_CONFIG_KEY, JSON.stringify(next));
  return next;
}

/**
 * 估算中英混合文本的 Token 数量：
 * - CJK 汉字与全角标点按 ~0.7 token/字估算；
 * - ASCII 连续词段按 ~0.28 token/字符估算。
 */
export function estimateTextTokens(text: string | null | undefined): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  let cjkCount = 0;
  let asciiCount = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code > 0x7f) cjkCount++;
    else asciiCount++;
  }
  return Math.max(1, Math.round(cjkCount * 0.7 + asciiCount * 0.28));
}

/**
 * 实时计算大、中、小三档摘要与未隐藏聊天正文的 Token 总量、各自占比及预算使用率。
 */
export function computeSummaryContextBreakdown(params: {
  savedRanges: SummaryRangeInfo[];
  microSummaries: MicroSummaryItem[];
  rawMessages?: Array<{ message_id: number; message?: string; is_hidden?: boolean }>;
  hiddenRangeKeys?: Set<string> | string[];
  currentFloor?: number;
  budgetConfig?: Partial<SummaryBudgetConfig>;
  fallbackTokensPerFloor?: number;
}): SummaryContextBreakdown {
  const cfg = normalizeSummaryBudgetConfig(params.budgetConfig);
  const hiddenSet =
    params.hiddenRangeKeys instanceof Set
      ? params.hiddenRangeKeys
      : new Set(Array.isArray(params.hiddenRangeKeys) ? params.hiddenRangeKeys : []);

  let macroTokens = 0;
  let macroCount = 0;
  let mesoTokens = 0;
  let mesoConstantTokens = 0;
  let mesoSelectiveTokens = 0;
  let mesoCount = 0;
  let maxSummarizedFloor = 0;

  for (const r of params.savedRanges ?? []) {
    const tok = estimateTextTokens(r.entry?.content ?? '');
    const tier = r.tier ?? parseSummaryCommentWithTier(r.entry?.comment ?? r.entry?.name ?? '')?.tier ?? 'meso';
    if (tier === 'macro') {
      macroTokens += tok;
      macroCount++;
    } else {
      mesoTokens += tok;
      mesoCount++;
      if (r.entry?.strategy?.type === 'selective') {
        mesoSelectiveTokens += tok;
      } else {
        mesoConstantTokens += tok;
      }
      if (r.to > maxSummarizedFloor) maxSummarizedFloor = r.to;
    }
  }

  let microTokens = 0;
  let microUncoveredTokens = 0;
  const microList = params.microSummaries ?? [];
  for (const m of microList) {
    const line = `${m.date ? `[${m.date}] ` : ''}${m.text ?? ''}${m.keys?.length ? ` (${m.keys.join(',')})` : ''}`;
    const tok = estimateTextTokens(line);
    microTokens += tok;
    if (m.floor > maxSummarizedFloor) {
      microUncoveredTokens += tok;
    }
  }
  const microCount = microList.length;

  // 判断某楼层是否处于已标记隐藏的摘要区间内（且不在尾部保留带内）
  const currentFloor = Math.max(0, params.currentFloor ?? 0);
  const tailStart = Math.max(1, currentFloor - cfg.tailReserveFloors + 1);
  const isFloorInHiddenRange = (floor: number): boolean => {
    if (floor <= 0 || floor >= tailStart) return false;
    for (const r of params.savedRanges ?? []) {
      if ((r.tier ?? 'meso') === 'meso' && floor >= r.from && floor <= r.to) {
        if (hiddenSet.has(`${r.from}-${r.to}`)) return true;
      }
    }
    return false;
  };

  let unhiddenRawTokens = 0;
  let unhiddenFloorCount = 0;
  let hiddenFloorCount = 0;

  if (Array.isArray(params.rawMessages) && params.rawMessages.length > 0) {
    for (const msg of params.rawMessages) {
      if (msg.message_id <= 0) continue;
      // 若楼层本身处于尾部保留带内（>= tailStart），视为未隐藏近场原文；否则看 msg.is_hidden 或 hiddenSet
      const hidden = msg.message_id < tailStart && (msg.is_hidden === true || isFloorInHiddenRange(msg.message_id));
      if (hidden) {
        hiddenFloorCount++;
      } else {
        unhiddenFloorCount++;
        unhiddenRawTokens += estimateTextTokens(msg.message ?? '');
      }
    }
  } else if (currentFloor > 0) {
    const perFloor = params.fallbackTokensPerFloor ?? 380;
    for (let f = 1; f <= currentFloor; f++) {
      if (isFloorInHiddenRange(f)) {
        hiddenFloorCount++;
      } else {
        unhiddenFloorCount++;
        unhiddenRawTokens += perFloor;
      }
    }
  }

  const summaryTotalTokens = macroTokens + mesoTokens + microTokens;
  const summaryBudgetTotal = cfg.macroBudgetTokens + cfg.mesoBudgetTokens + cfg.microBudgetTokens;
  const grandTotalTokens = summaryTotalTokens + unhiddenRawTokens;

  const pct = (part: number, total: number): number =>
    total > 0 ? Math.round((part / total) * 1000) / 10 : 0;

  return {
    macroTokens,
    macroCount,
    mesoTokens,
    mesoConstantTokens,
    mesoSelectiveTokens,
    mesoCount,
    microTokens,
    microUncoveredTokens,
    microCount,
    unhiddenRawTokens,
    unhiddenFloorCount,
    hiddenFloorCount,
    summaryTotalTokens,
    summaryBudgetTotal,
    grandTotalTokens,
    macroSharePct: pct(macroTokens, grandTotalTokens),
    mesoSharePct: pct(mesoTokens, grandTotalTokens),
    microSharePct: pct(microTokens, grandTotalTokens),
    unhiddenRawSharePct: pct(unhiddenRawTokens, grandTotalTokens),
    macroBudgetUsagePct: pct(macroTokens, cfg.macroBudgetTokens),
    mesoBudgetUsagePct: pct(mesoTokens, cfg.mesoBudgetTokens),
    microBudgetUsagePct: pct(microTokens, cfg.microBudgetTokens),
    summaryBudgetUsagePct: pct(summaryTotalTokens, summaryBudgetTotal),
  };
}

/* ═══════════════ 小摘要（Micro）纯函数与高密度上下文拼装 ═══════════════ */

/**
 * 按楼层号 floor 幂等更新或插入一条【小摘要】（MicroSummaryItem）：
 * - Swipe 或编辑重解析同一楼层时原地替换；
 * - 按 floor 升序排列；超 maxKeep 时裁剪最旧项（由于早期楼层已合成为中摘要，不滞留无限变量）。
 */
export function upsertMicroSummary(
  list: MicroSummaryItem[] | undefined,
  item: MicroSummaryItem,
  maxKeep = 80,
): MicroSummaryItem[] {
  const next = Array.isArray(list) ? list.map(x => ({ ...x, keys: [...(x.keys ?? [])] })) : [];
  const idx = next.findIndex(x => x.floor === item.floor);
  if (idx >= 0) {
    next[idx] = { ...item, keys: [...(item.keys ?? [])] };
  } else {
    next.push({ ...item, keys: [...(item.keys ?? [])] });
  }
  next.sort((a, b) => a.floor - b.floor);
  if (maxKeep > 0 && next.length > maxKeep) {
    return next.slice(next.length - maxKeep);
  }
  return next;
}

/**
 * 提取指定区间 [from, to] 内的【小摘要】并拼装为高密度中摘要合成上下文。
 */
export function formatMicroSummariesForPrompt(
  microList: MicroSummaryItem[] | undefined,
  from: number,
  to: number,
): string {
  if (!Array.isArray(microList) || microList.length === 0) return '';
  const inRange = microList
    .filter(m => m.floor >= from && m.floor <= to && m.text.trim().length > 0)
    .sort((a, b) => a.floor - b.floor);
  if (inRange.length === 0) return '';
  return inRange
    .map(m => {
      const dateTag = m.date?.trim() ? ` [${m.date.trim()}]` : '';
      const keysTag = m.keys?.length ? ` （关联：${m.keys.join('、')}）` : '';
      return `#${m.floor}${dateTag}: ${m.text.trim()}${keysTag}`;
    })
    .join('\n');
}

/**
 * 从单楼原始消息文本中剥离思考链与系统协议块，提取纯净的剧情正文或玩家行动文本。
 */
export function extractCleanFloorTextForSummary(rawMessage: string, maxChars = 600): string {
  if (!rawMessage || typeof rawMessage !== 'string') return '';
  let text = rawMessage
    .replace(/<(?:thinking|思考|think)>[\s\S]*?<\/(?:thinking|思考|think)>/gi, '')
    .trim();

  // 若包含显式 <正文>...</正文>，优先提取全部 <正文> 段落
  const bodyMatches = [...text.matchAll(/<正文(?:\s[^>]*)?>([\s\S]*?)<\/正文>/gi)];
  if (bodyMatches.length > 0) {
    text = bodyMatches
      .map(m => m[1].trim())
      .filter(Boolean)
      .join('\n');
  } else {
    // 否则剥离战况、摘要、时间与选项等协议容器
    text = text
      .replace(/<(?:战况|摘要|summary|中摘要|大摘要|timePast|选项|rac_cot_supplement)(?:\s[^>]*)?>[\s\S]*?<\/(?:战况|摘要|summary|中摘要|大摘要|timePast|选项|rac_cot_supplement)>/gi, '')
      .trim();
  }

  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return '';
  if (maxChars > 0 && text.length > maxChars) {
    const headLen = Math.floor(maxChars * 0.7);
    const tailLen = Math.max(60, maxChars - headLen);
    return `${text.slice(0, headLen).trim()}……${text.slice(-tailLen).trim()}`;
  }
  return text;
}

export type GetChatMessagesForSummaryFn = (
  range: string | number,
  opts?: { hide_state?: string },
) => Array<{ message_id: number; message?: string; role?: string }>;

/**
 * 读取指定区间 [from, to] 的全部目标楼层纯净内容（不因存在小摘要而跳过任何楼层）。
 */
export function formatTargetFloorsForPrompt(
  from: number,
  to: number,
  getChatMessagesFn?: GetChatMessagesForSummaryFn,
  maxCharsPerFloor = 600,
): string {
  const getMsgs =
    getChatMessagesFn ??
    tav<GetChatMessagesForSummaryFn>('getChatMessages');
  if (!getMsgs || from > to) return '';

  let msgs: Array<{ message_id: number; message?: string; role?: string }> = [];
  try {
    msgs = getMsgs(`${from}-${to}`) ?? [];
    if ((!Array.isArray(msgs) || msgs.length === 0) && getMsgs.length >= 2) {
      msgs = getMsgs(`${from}-${to}`, { hide_state: 'all' }) ?? [];
    }
  } catch {
    msgs = [];
  }
  if (!Array.isArray(msgs) || msgs.length === 0) return '';

  const lines: string[] = [];
  for (const m of msgs) {
    if (typeof m.message_id !== 'number' || m.message_id < from || m.message_id > to) continue;
    const cleaned = extractCleanFloorTextForSummary(m.message ?? '', maxCharsPerFloor);
    if (!cleaned) continue;
    const roleTag = m.role || 'assistant';
    lines.push(`#${m.message_id} [${roleTag}]: ${cleaned}`);
  }
  return lines.join('\n\n');
}

/**
 * 组装【中摘要（阶段摘要）】的完整双层输入源：
 * 同时纳入「逐楼微纪要（小摘要流水）」+「目标楼层原始剧情记录（全楼层覆盖，不跳过已有小摘要的楼层）」。
 */
export function buildMesoSummarySourceDigest(
  from: number,
  to: number,
  opts?: {
    microSummaries?: MicroSummaryItem[];
    getChatMessagesFn?: GetChatMessagesForSummaryFn;
    maxCharsPerFloor?: number;
  },
): string {
  const microText = formatMicroSummariesForPrompt(opts?.microSummaries, from, to);
  const floorText = formatTargetFloorsForPrompt(from, to, opts?.getChatMessagesFn, opts?.maxCharsPerFloor ?? 600);
  const sections: string[] = [];
  if (microText) {
    sections.push(`【逐楼微纪要（小摘要流水）】\n${microText}`);
  }
  if (floorText) {
    sections.push(`【目标楼层原始剧情记录（#${formatFloor(from)}-#${formatFloor(to)}）】\n${floorText}`);
  }
  return sections.join('\n\n');
}

/**
 * 组装【大摘要（战役总纲）】的完整多层输入源：
 * 同时纳入「阶段中摘要主干」+「区间逐楼微纪要（小摘要流水）」+「目标楼层原始剧情节选」。
 */
export function buildMacroSummarySourceDigest(
  mesoSegments: ReadonlyArray<{ from: number; to: number; entry?: ThEntry; text?: string; keys?: string[] }>,
  opts?: {
    microSummaries?: MicroSummaryItem[];
    getChatMessagesFn?: GetChatMessagesForSummaryFn;
    maxCharsPerFloor?: number;
  },
): string {
  if (!Array.isArray(mesoSegments) || mesoSegments.length === 0) return '';
  const sorted = [...mesoSegments].sort((a, b) => a.from - b.from);
  const from = sorted[0].from;
  const to = sorted[sorted.length - 1].to;

  const bodyLines = sorted.map((seg, i) => {
    const content = (seg.text ?? seg.entry?.content ?? '').trim();
    const segKeys = seg.keys ?? (Array.isArray(seg.entry?.strategy?.keys) ? seg.entry?.strategy?.keys : []);
    const keySuffix = segKeys && segKeys.length > 0 ? `\n关联实体：${segKeys.join('、')}` : '';
    return `### 阶段 ${i + 1}（#${formatFloor(seg.from)}-#${formatFloor(seg.to)}）\n${content}${keySuffix}`;
  });

  const sections: string[] = [`【一、待归并阶段摘要（中摘要主干）】\n${bodyLines.join('\n\n')}`];
  const microText = formatMicroSummariesForPrompt(opts?.microSummaries, from, to);
  if (microText) {
    sections.push(`【二、区间逐楼微纪要（小摘要编年流水）】\n${microText}`);
  }
  const floorText = formatTargetFloorsForPrompt(from, to, opts?.getChatMessagesFn, opts?.maxCharsPerFloor ?? 320);
  if (floorText) {
    sections.push(`【三、目标楼层原始剧情记录（#${formatFloor(from)}-#${formatFloor(to)}）】\n${floorText}`);
  }
  return sections.join('\n\n');
}

/* ═══════════════ 区间构造纯函数（设计案 §2 / §3 唯一真源与铁律） ═══════════════ */

/** 楼层号三位补零（如 1 → 001，20 → 020） */
export function formatFloor(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(3, '0');
}

/**
 * 规范 comment：
 * - 中摘要（默认，100% 向后兼容）：`摘要·{from 三位补零}-{to 三位补零}`
 * - 大摘要（tier === 'macro'）：`摘要·大·{from 三位补零}-{to 三位补零}`
 */
export function renderSummaryComment(from: number, to: number, tier: 'meso' | 'macro' = 'meso'): string {
  const prefix = tier === 'macro' ? MACRO_SUMMARY_PREFIX : SUMMARY_PREFIX;
  return `${prefix}${formatFloor(from)}-${formatFloor(to)}`;
}

/** 解析 comment 为楼层区间与层级；非规范前缀返回 null */
export function parseSummaryCommentWithTier(
  comment: string,
): { from: number; to: number; tier: 'meso' | 'macro' } | null {
  const trimmed = comment.trim();
  const macroMatch = /^摘要·大·(\d+)-(\d+)$/.exec(trimmed);
  if (macroMatch) {
    const from = Number(macroMatch[1]);
    const to = Number(macroMatch[2]);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return null;
    return { from, to, tier: 'macro' };
  }
  const mesoMatch = /^摘要·(?:中·)?(\d+)-(\d+)$/.exec(trimmed);
  if (mesoMatch) {
    const from = Number(mesoMatch[1]);
    const to = Number(mesoMatch[2]);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return null;
    return { from, to, tier: 'meso' };
  }
  return null;
}

/** 解析 comment 为楼层区间；非规范前缀返回 null（保持既有签名返回 {from, to}） */
export function parseSummaryComment(comment: string): { from: number; to: number } | null {
  const parsed = parseSummaryCommentWithTier(comment);
  if (!parsed) return null;
  return { from: parsed.from, to: parsed.to };
}

/** 判定单条世界书摘要条目属于中摘要（meso）还是大摘要（macro） */
export function resolveSummaryEntryTier(entry: ThEntry): 'meso' | 'macro' {
  const ex = entry.extra as Record<string, unknown> | undefined;
  if (ex?.tier === 'macro') return 'macro';
  if (ex?.tier === 'meso') return 'meso';
  const name = String(entry.name || '');
  const comment = String(entry.comment || '');
  if (name.startsWith(MACRO_SUMMARY_PREFIX) || comment.startsWith(MACRO_SUMMARY_PREFIX)) {
    return 'macro';
  }
  return 'meso';
}

/**
 * 提取世界书中的全部摘要条目区间信息：
 * 条目 extra 为区间唯一真源（机读 {from, to} 优先；缺失时 fallback 解析 comment）。
 * 可选 filterTier 过滤 'meso' | 'macro' | 'all'（默认 'all'）。
 */
export function extractSummaryRanges(
  entries: ThEntry[],
  filterTier: 'meso' | 'macro' | 'all' = 'all',
): SummaryRangeInfo[] {
  const list: SummaryRangeInfo[] = [];
  for (const e of entries) {
    const name = String(e.name || '');
    const comment = String(e.comment || '');
    const isSummary = name.startsWith(SUMMARY_PREFIX) || comment.startsWith(SUMMARY_PREFIX);
    if (!isSummary) continue;

    const tier = resolveSummaryEntryTier(e);
    if (filterTier !== 'all' && tier !== filterTier) continue;

    const extra = e.extra as Record<string, unknown> | undefined;
    const extraFrom = typeof extra?.from === 'number' ? extra.from : undefined;
    const extraTo = typeof extra?.to === 'number' ? extra.to : undefined;

    if (extraFrom !== undefined && extraTo !== undefined && extraFrom <= extraTo) {
      const resolvedComment = comment || name || renderSummaryComment(extraFrom, extraTo, tier);
      list.push({ comment: resolvedComment, from: extraFrom, to: extraTo, tier, entry: e });
      continue;
    }

    const parsed = parseSummaryCommentWithTier(comment) || parseSummaryCommentWithTier(name);
    if (parsed) {
      const resolvedComment = comment || name || renderSummaryComment(parsed.from, parsed.to, parsed.tier);
      list.push({ comment: resolvedComment, from: parsed.from, to: parsed.to, tier: parsed.tier, entry: e });
    }
  }
  return list.sort((a, b) => a.from - b.from || b.to - a.to);
}

/**
 * 摘要专属频段续号函数（[78001, 78999]）：
 * 带内无 78001~78999 条目时返回 78001，有则 Math.max(...inBand) + 1，
 * 与 70000~75000 的扩展/机娘条目物理隔离。
 */
export function nextSummaryOrder(entries: readonly ThEntry[]): number {
  const inBand = entries
    .map(e => Number(e.position?.order ?? 0))
    .filter(o => o >= 78001 && o <= 78999);
  return inBand.length ? Math.max(...inBand) + 1 : 78001;
}

/**
 * 越界摘要自动裁剪器（纯函数）：
 * 当玩家删楼回退或从历史楼层 maxFloor 开启新聊天分支时，
 * 任何覆盖了未来楼层（to > maxFloor 或 from > maxFloor）的摘要条目（含中摘要与大摘要）均已失真，
 * 将其从返回的 entries 数组中剔除，并返回被剔除的 SummaryRangeInfo 列表。
 */
export function pruneSummariesAboveFloor(
  entries: readonly ThEntry[],
  maxFloor: number,
): { entries: ThEntry[]; removedRanges: SummaryRangeInfo[] } {
  const keptEntries: ThEntry[] = [];
  const removedRanges: SummaryRangeInfo[] = [];

  for (const e of entries) {
    const name = String(e.name || '');
    const comment = String(e.comment || '');
    const parsed = parseSummaryCommentWithTier(name) || parseSummaryCommentWithTier(comment);
    const extra = e.extra as Record<string, unknown> | undefined;
    const extraFrom = typeof extra?.from === 'number' && Number.isFinite(extra.from) ? extra.from : undefined;
    const extraTo = typeof extra?.to === 'number' && Number.isFinite(extra.to) ? extra.to : undefined;
    const isSummaryPrefix = name.startsWith(SUMMARY_PREFIX) || comment.startsWith(SUMMARY_PREFIX);

    if (!parsed && !(isSummaryPrefix && extraFrom !== undefined && extraTo !== undefined)) {
      keptEntries.push(e);
      continue;
    }

    const from = extraFrom ?? parsed!.from;
    const to = extraTo ?? parsed!.to;
    const tier = parsed?.tier ?? resolveSummaryEntryTier(e);
    const resolvedComment = comment || name || renderSummaryComment(from, to, tier);

    if (to > maxFloor || from > maxFloor) {
      removedRanges.push({
        comment: resolvedComment,
        from,
        to,
        tier,
        entry: e,
      });
    } else {
      keptEntries.push(e);
    }
  }

  return {
    entries: keptEntries,
    removedRanges,
  };
}

/**
 * 构造下一个【中摘要】区间（设计案 §3 铁律）：
 * - 唯一真源＝聊天书内既有「摘要·」条目的 extra.to 最大值；
 * - 新区间起始楼层＝maxTo + 1（无既有条目时从 1 起始，#0 楼豁免）；
 * - 结束楼层＝currentFloor - tailReserve（尾部保留带 M 楼永不入摘要区间）；
 * - 若 to < from（无可摘楼层），返回 null；
 * - 首尾相接、零重叠、零漏段由构造保证。
 */
export function nextSummaryRange(
  entries: ThEntry[],
  currentFloor: number,
  tailReserve: number = DEFAULT_TAIL_RESERVE,
  opts?: { maxSpan?: number },
): SummaryRange | null {
  const ranges = extractSummaryRanges(entries);
  const maxTo = ranges.length ? Math.max(...ranges.map(r => r.to)) : 0;
  const from = maxTo > 0 ? maxTo + 1 : 1;
  const rawTo = currentFloor - tailReserve;

  if (rawTo < from) return null;
  const to =
    opts?.maxSpan && opts.maxSpan > 0 ? Math.min(rawTo, from + opts.maxSpan - 1) : rawTo;
  return [from, to];
}

/**
 * 计算下一批可归并为【大摘要（Macro）】的【中摘要（Meso）】候选段：
 * - 查找所有尚未被既有【大摘要】覆盖的已入书【中摘要】（from > maxMacroTo）；
 * - 当未归并的【中摘要】段数 >= minCount（默认 DEFAULT_MACRO_MESO_COUNT=4，手动强制归并可传 minCount=2）时，
 *   取前 batchSize（默认 DEFAULT_MACRO_MESO_COUNT=4）段返回其合并区间 `[first.from, last.to]` 与段落列表。
 */
export function nextMacroSummaryCandidate(
  entries: ThEntry[],
  opts?: { minCount?: number; batchSize?: number },
): { from: number; to: number; mesoSegments: SummaryRangeInfo[] } | null {
  const minCount = opts?.minCount ?? DEFAULT_MACRO_MESO_COUNT;
  const batchSize = opts?.batchSize ?? DEFAULT_MACRO_MESO_COUNT;
  const macroRanges = extractSummaryRanges(entries, 'macro');
  const maxMacroTo = macroRanges.length ? Math.max(...macroRanges.map(r => r.to)) : 0;

  const uncoveredMeso = extractSummaryRanges(entries, 'meso').filter(r => r.from > maxMacroTo);
  if (uncoveredMeso.length < minCount) return null;

  const selected = uncoveredMeso.slice(0, batchSize);
  const from = selected[0].from;
  const to = selected[selected.length - 1].to;
  return { from, to, mesoSegments: selected };
}

/* ═══════════════ 渲染与条目 upsert 纯函数（设计案 §2 条目合同） ═══════════════ */

/**
 * 条目 upsert（纯函数）：
 * - comment / name 定位幂等 upsert；
 * - 默认 strategy: constant 蓝灯全常驻；options.strategyType === 'selective' 时绿灯分层激活；
 * - position: at_depth (role=system, depth=4)；
 * - recursion: prevent_incoming: true；
 * - extra 记机读元数据 {from, to, generatedAt, model}，作为唯一真源。
 */
export function upsertSummaryEntry(
  entries: ThEntry[],
  draft: SummaryDraft,
  options?: { strategyType?: SummaryStrategy; depth?: number; demoteCoveredMeso?: boolean },
): SummaryUpsertResult {
  const tier: 'meso' | 'macro' = draft.tier === 'macro' ? 'macro' : 'meso';
  const comment = renderSummaryComment(draft.from, draft.to, tier);
  // 大摘要（Macro）作为战役总纲，固定为 constant 蓝灯常驻；中摘要按 strategyType
  const strategyType: SummaryStrategy = tier === 'macro' ? 'constant' : (options?.strategyType ?? 'constant');
  const depth = options?.depth ?? (tier === 'macro' ? DEFAULT_MACRO_DEPTH : DEFAULT_DEPTH);

  const existing = entries.find(e => {
    if (e.comment === comment || e.name === comment) return true;
    const ex = e.extra as Record<string, unknown> | undefined;
    const entryTier = resolveSummaryEntryTier(e);
    return entryTier === tier && ex?.from === draft.from && ex?.to === draft.to;
  });

  const keys = draft.keys && draft.keys.length > 0 ? [...new Set(draft.keys.map(k => k.trim()).filter(Boolean))] : [];
  const selectiveKeys = keys.length > 0 ? keys : ['剧情摘要', '历史'];

  const strategy =
    strategyType === 'selective'
      ? { type: 'selective', keys: selectiveKeys, scan_depth: 'same_as_global' }
      : { type: 'constant', keys: [] };

  const extra: Record<string, unknown> = {
    ...(existing?.extra ?? {}),
    from: draft.from,
    to: draft.to,
    generatedAt: draft.generatedAt,
    model: draft.model,
    ...(keys.length > 0 ? { keys } : {}),
    ...(draft.tier ? { tier: draft.tier } : {}),
  };

  // 若当前写入的是【大摘要（Macro）】，自动将其所覆盖区间 [draft.from, draft.to] 内的【中摘要（Meso）】
  // 从 constant（蓝灯常驻）降级为 selective（绿灯关键词触发），实现「大摘要常驻总纲 + 旧中摘要按需唤醒」
  const demotedMesoComments: string[] = [];
  if (tier === 'macro' && options?.demoteCoveredMeso !== false) {
    for (const e of entries) {
      if (resolveSummaryEntryTier(e) !== 'meso') continue;
      const ex = (e.extra ?? {}) as Record<string, unknown>;
      const parsed =
        typeof ex.from === 'number' && typeof ex.to === 'number'
          ? { from: ex.from, to: ex.to }
          : parseSummaryComment(String(e.comment || e.name || ''));
      if (!parsed) continue;
      if (parsed.from >= draft.from && parsed.to <= draft.to) {
        const existingKeys = Array.isArray(e.strategy?.keys)
          ? (e.strategy.keys as string[]).filter(Boolean)
          : Array.isArray(ex.keys)
            ? (ex.keys as string[]).filter(Boolean)
            : [];
        const mesoKeys = existingKeys.length > 0 ? existingKeys : selectiveKeys;
        e.strategy = {
          ...(e.strategy ?? {}),
          type: 'selective',
          keys: mesoKeys,
          scan_depth: 'same_as_global',
        };
        e.extra = {
          ...ex,
          coveredByMacro: comment,
        };
        demotedMesoComments.push(String(e.comment || e.name || renderSummaryComment(parsed.from, parsed.to)));
      }
    }
  }

  if (existing) {
    existing.name = comment;
    existing.comment = comment;
    existing.content = draft.text;
    existing.strategy = { ...existing.strategy, ...strategy };
    existing.position = {
      ...existing.position,
      type: 'at_depth',
      role: 'system',
      depth,
      order: existing.position?.order ?? nextSummaryOrder(entries),
    };
    existing.recursion = { prevent_incoming: true, prevent_outgoing: true, delay_until: null };
    existing.extra = extra;
    return tier === 'macro'
      ? { entries, action: 'updated', entryName: comment, demotedMesoComments }
      : { entries, action: 'updated', entryName: comment };
  }

  entries.push({
    name: comment,
    comment,
    enabled: true,
    strategy,
    position: {
      type: 'at_depth',
      role: 'system',
      depth,
      order: nextSummaryOrder(entries),
    },
    content: draft.text,
    probability: 100,
    recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
    extra,
  });

  return tier === 'macro'
    ? { entries, action: 'created', entryName: comment, demotedMesoComments }
    : { entries, action: 'created', entryName: comment };
}

/* ═══════════════ 档案落地与弃置副作用层（经三重守卫） ═══════════════ */

export interface FileSummaryOptions {
  txn?: WriteTxn;
  strategyType?: SummaryStrategy;
  depth?: number;
  demoteCoveredMeso?: boolean;
  updateWorldbookWithFn?: UpdateWorldbookWith;
}

/**
 * 剧情摘要入当前聊天档案书（设计案 §2 / §4）：
 * 1. 经 chatBookGateway 三重守卫（首写惰性建书 createIfMissing: true）；
 * 2. 守卫失败 fail-closed 抛出 GuardError，绝不清 pending_summaries；
 * 3. updateWorldbookWith 幂等 upsert；
 * 4. extra 记录机读区间元数据。
 */
export async function fileSummary(
  draft: SummaryDraft,
  gateway: ChatBookGatewayLike = chatBookGateway,
  options?: FileSummaryOptions,
): Promise<FileSummaryReceipt> {
  const updateWb = options?.updateWorldbookWithFn ?? tav<UpdateWorldbookWith>('updateWorldbookWith');
  if (!updateWb) {
    throw new Error('酒馆 API updateWorldbookWith 不可用（独立预览环境无法入档）');
  }

  const txn = options?.txn ?? gateway.begin();
  const book = await gateway.guardedBook(txn, { createIfMissing: true });

  // 剥离可能来自 Vue 响应式系统的 Proxy 包装，防止宿主 updateWorldbookWith 内部 structuredClone 抛 DataCloneError
  const plainDraft: SummaryDraft = JSON.parse(JSON.stringify(draft));

  const tier: 'meso' | 'macro' = plainDraft.tier === 'macro' ? 'macro' : 'meso';
  let upsertRes: SummaryUpsertResult | null = null;
  await updateWb(book, entries => {
    upsertRes = upsertSummaryEntry(entries, plainDraft, {
      strategyType: options?.strategyType,
      depth: options?.depth,
      demoteCoveredMeso: options?.demoteCoveredMeso,
    });
    return upsertRes.entries;
  });

  const comment = renderSummaryComment(plainDraft.from, plainDraft.to, tier);
  const resObj = upsertRes as SummaryUpsertResult | null;
  return {
    comment,
    book,
    from: plainDraft.from,
    to: plainDraft.to,
    action: resObj?.action ?? 'created',
    ...(plainDraft.tier ? { tier: plainDraft.tier } : {}),
    ...(resObj?.demotedMesoComments ? { demotedMesoComments: resObj.demotedMesoComments } : {}),
  };
}

export interface DiscardSummaryOptions {
  tier?: 'meso' | 'macro';
  unhide?: boolean;
  deleteWorldbookEntriesFn?: (
    bookName: string,
    predicate: (entry: ThEntry) => boolean,
  ) => Promise<{ worldbook: ThEntry[]; deleted_entries: ThEntry[] }>;
  updateWorldbookWithFn?: UpdateWorldbookWith;
  setChatMessagesFn?: (
    chat_messages: Array<{ message_id: number; is_hidden?: boolean }>,
    opts?: { refresh?: string },
  ) => Promise<void>;
}

/**
 * 弃置/删除某区间摘要条目（设计案 §4 / §5 可逆性成对铁律）：
 * 1. 经守卫（createIfMissing: false）确认聊天身份与绑定书；
 * 2. 🔴 铁律（FIX-SUM-01）：对中摘要（meso），先自动取消隐藏对应区间楼层（unhideRange），若解隐失败则中止删条，不留「无摘要的黑洞段」；
 *    对大摘要（macro），由于底层中摘要仍在书中覆盖原楼层，默认不解隐原楼（除非显式传 unhide: true）；
 * 3. 从聊天书中删除该区间条目 → extra.to 最大值天然回退 → nextSummaryRange 保证区间指针天然回退；
 * 4. 当删除大摘要（tier === 'macro'）时，同步将同书内被该大摘要覆盖的子中摘要清除 extra.coveredByMacro 并恢复 strategy.type = 'constant'。
 */
export async function discardSummary(
  from: number,
  to: number,
  gateway: ChatBookGatewayLike = chatBookGateway,
  options?: DiscardSummaryOptions,
): Promise<DiscardSummaryReceipt> {
  const delFn =
    options?.deleteWorldbookEntriesFn ??
    tav<(b: string, p: (e: ThEntry) => boolean) => Promise<{ worldbook: ThEntry[]; deleted_entries: ThEntry[] }>>(
      'deleteWorldbookEntries',
    );
  const updateWb = options?.updateWorldbookWithFn ?? tav<UpdateWorldbookWith>('updateWorldbookWith');

  const txn = gateway.begin();
  const book = await gateway.guardedBook(txn, { createIfMissing: false });

  const tier: 'meso' | 'macro' = options?.tier === 'macro' ? 'macro' : 'meso';
  // 🔴 可逆性成对铁律（先解隐后删条）：弃置中摘要条目必须先取消隐藏对应区间楼层；大摘要底层仍有中摘要兜底，默认不解隐
  const defaultUnhide = tier !== 'macro';
  const shouldUnhide =
    (options?.unhide ?? defaultUnhide) && Number.isFinite(from) && Number.isFinite(to) && from <= to;
  const unhiddenFloors = shouldUnhide
    ? await unhideRange(from, to, { setChatMessagesFn: options?.setChatMessagesFn })
    : [];

  const comment = renderSummaryComment(from, to, tier);
  let deletedEntry = false;
  const restoredMesoSet = new Set<string>();

  const isTargetEntry = (e: ThEntry): boolean => {
    if (e.comment === comment || e.name === comment) return true;
    const ex = e.extra as Record<string, unknown> | undefined;
    const entryTier = resolveSummaryEntryTier(e);
    return entryTier === tier && ex?.from === from && ex?.to === to;
  };

  const restoreMesoIfCovered = (e: ThEntry): void => {
    if (tier !== 'macro' || resolveSummaryEntryTier(e) !== 'meso') return;
    const ex = (e.extra ?? {}) as Record<string, unknown>;
    const parsed =
      typeof ex.from === 'number' && typeof ex.to === 'number'
        ? { from: ex.from, to: ex.to }
        : parseSummaryComment(String(e.comment || e.name || ''));
    const coveredMatch = ex.coveredByMacro === comment;
    const inRange = Boolean(parsed && parsed.from >= from && parsed.to <= to);
    if (!coveredMatch && !inRange) return;
    if (!coveredMatch && ex.coveredByMacro === undefined && e.strategy?.type !== 'selective') return;

    const nextExtra = { ...ex };
    delete nextExtra.coveredByMacro;
    e.extra = nextExtra;
    e.strategy = {
      ...(e.strategy ?? {}),
      type: 'constant',
    };
    const label = String(e.comment || e.name || (parsed ? renderSummaryComment(parsed.from, parsed.to) : ''));
    if (label) restoredMesoSet.add(label);
  };

  if (delFn) {
    const res = await delFn(book, e => {
      if (isTargetEntry(e)) return true;
      if (tier === 'macro') {
        restoreMesoIfCovered(e);
      }
      return false;
    });
    deletedEntry = (res.deleted_entries?.length ?? 0) > 0;
    if (tier === 'macro' && Array.isArray(res.worldbook)) {
      for (const e of res.worldbook) {
        restoreMesoIfCovered(e);
      }
    }
  }

  if (tier === 'macro' && updateWb) {
    await updateWb(book, entries => {
      const nextEntries: ThEntry[] = [];
      for (const e of entries) {
        if (isTargetEntry(e)) {
          deletedEntry = true;
          continue;
        }
        restoreMesoIfCovered(e);
        nextEntries.push(e);
      }
      return nextEntries;
    });
  }

  return {
    from,
    to,
    deletedEntry,
    unhiddenFloors,
    ...(tier === 'macro' ? { restoredMesoComments: [...restoredMesoSet] } : {}),
  };
}

/* ═══════════════ 隐藏成对操作层与放行门（设计案 §5） ═══════════════ */

type SetChatMessagesLike = (
  chat_messages: Array<{ message_id: number; is_hidden?: boolean }>,
  opts?: { refresh?: string },
) => Promise<void>;

/**
 * 豁免带过滤纯函数（设计案 §5 豁免带硬编码）：
 * - #0 楼（MVU 初始变量锚）永不隐藏（floor <= 0 拦截）；
 * - 尾部保留带 M 楼（currentFloor 往前 M 楼）永不入隐藏集合。
 */
export function filterExemptFloors(
  floors: number[],
  currentFloor?: number,
  tailReserve: number = DEFAULT_TAIL_RESERVE,
): number[] {
  return floors.filter(f => {
    if (f <= 0) return false; // #0 楼永不隐藏
    if (currentFloor !== undefined && f > currentFloor - tailReserve) return false; // 尾部保留带永不隐藏
    return true;
  });
}

/**
 * 批量隐藏楼层（设计案 §5 默认行为）：
 * - 经 filterExemptFloors 硬编码过滤豁免带；
 * - 调 setChatMessages([{message_id, is_hidden: true}])。
 */
export async function hideRange(
  from: number,
  to: number,
  opts?: {
    currentFloor?: number;
    tailReserve?: number;
    setChatMessagesFn?: SetChatMessagesLike;
  },
): Promise<number[]> {
  const rawFloors: number[] = [];
  for (let i = from; i <= to; i++) {
    rawFloors.push(i);
  }
  const validFloors = filterExemptFloors(rawFloors, opts?.currentFloor, opts?.tailReserve);
  if (!validFloors.length) return [];

  const setMsgs = opts?.setChatMessagesFn ?? tav<SetChatMessagesLike>('setChatMessages');
  if (!setMsgs) {
    throw new Error('酒馆 API setChatMessages 不可用');
  }

  await setMsgs(validFloors.map(id => ({ message_id: id, is_hidden: true })));
  return validFloors;
}

/**
 * 批量取消隐藏楼层（设计案 §5 逆操作）：
 * - #0 楼过滤；
 * - 调 setChatMessages([{message_id, is_hidden: false}])。
 */
export async function unhideRange(
  from: number,
  to: number,
  opts?: { setChatMessagesFn?: SetChatMessagesLike; gracefulWhenApiMissing?: boolean },
): Promise<number[]> {
  const rawFloors: number[] = [];
  for (let i = from; i <= to; i++) {
    if (i > 0) rawFloors.push(i);
  }
  if (!rawFloors.length) return [];

  const setMsgs = opts?.setChatMessagesFn ?? tav<SetChatMessagesLike>('setChatMessages');
  if (!setMsgs) {
    if (opts?.gracefulWhenApiMissing) return rawFloors;
    throw new Error('酒馆 API setChatMessages 不可用');
  }

  await setMsgs(rawFloors.map(id => ({ message_id: id, is_hidden: false })));
  return rawFloors;
}

export interface ReconcileSummariesOptions {
  updateWorldbookWithFn?: UpdateWorldbookWith;
  setChatMessagesFn?: SetChatMessagesLike;
}

/**
 * 宿主级越界摘要自动裁剪与残存楼层解隐协同器：
 * 1. 通过 gateway ?? chatBookGateway 获取当前绑定的聊天世界书名称（若无或书不存在则安全返回空结果）；
 * 2. 调用 updateWorldbookWith 执行 pruneSummariesAboveFloor(entries, maxFloor) 剔除所有 to > maxFloor 的越界摘要；
 * 3. 若 removedRanges.length > 0，计算被剔除摘要所覆盖且当前仍存在（且未被保留摘要覆盖）的楼层区间
 *    [r.from, Math.min(r.to, maxFloor)]，自动调用 unhideRange(from, to) 将这些楼层解除隐藏。
 */
export async function reconcileChatSummariesAboveFloor(
  maxFloor: number,
  gateway: ChatBookGatewayLike = chatBookGateway,
  options?: ReconcileSummariesOptions,
): Promise<{ removedRanges: SummaryRangeInfo[]; unhiddenFloors: number[] }> {
  if (!Number.isFinite(maxFloor) || maxFloor < 0) {
    return { removedRanges: [], unhiddenFloors: [] };
  }

  let bookName = '';
  try {
    if (typeof gateway.getChatWorldbookName === 'function') {
      const bound = (gateway.getChatWorldbookName('current') ?? '').trim();
      if (!bound) {
        return { removedRanges: [], unhiddenFloors: [] };
      }
      if (typeof gateway.getWorldbookNames === 'function') {
        const allBooks = gateway.getWorldbookNames() ?? [];
        if (!allBooks.includes(bound)) {
          return { removedRanges: [], unhiddenFloors: [] };
        }
      }
      bookName = bound;
    } else if (typeof gateway.begin === 'function' && typeof gateway.guardedBook === 'function') {
      const txn = gateway.begin();
      bookName = (await gateway.guardedBook(txn, { createIfMissing: false })).trim();
    }
  } catch {
    return { removedRanges: [], unhiddenFloors: [] };
  }

  if (!bookName) {
    return { removedRanges: [], unhiddenFloors: [] };
  }

  const updateWb =
    options?.updateWorldbookWithFn ??
    (typeof gateway.updateWorldbookWith === 'function'
      ? (gateway.updateWorldbookWith.bind(gateway) as UpdateWorldbookWith)
      : undefined) ??
    tav<UpdateWorldbookWith>('updateWorldbookWith');

  if (!updateWb) {
    return { removedRanges: [], unhiddenFloors: [] };
  }

  let removedRanges: SummaryRangeInfo[] = [];
  let keptEntries: ThEntry[] = [];

  await updateWb(bookName, entries => {
    const pruned = pruneSummariesAboveFloor(Array.isArray(entries) ? entries : [], maxFloor);
    removedRanges = pruned.removedRanges;
    keptEntries = pruned.entries;
    return pruned.entries;
  });

  if (removedRanges.length === 0) {
    return { removedRanges: [], unhiddenFloors: [] };
  }

  // 计算仍被保留摘要覆盖的楼层（如 001-010 仍保留在书中时，1~10 楼不解隐）
  const keptCoveredFloors = new Set<number>();
  for (const kr of extractSummaryRanges(keptEntries)) {
    const start = Math.max(1, kr.from);
    const end = Math.min(kr.to, maxFloor);
    for (let f = start; f <= end; f++) {
      keptCoveredFloors.add(f);
    }
  }

  // 收集被剔除摘要在 [r.from, Math.min(r.to, maxFloor)] 内且未被保留摘要覆盖的残存楼层
  const targetFloorsSet = new Set<number>();
  for (const r of removedRanges) {
    const from = Math.max(1, r.from);
    const to = Math.min(r.to, maxFloor);
    if (from <= to) {
      for (let f = from; f <= to; f++) {
        if (!keptCoveredFloors.has(f)) {
          targetFloorsSet.add(f);
        }
      }
    }
  }

  const sortedFloors = [...targetFloorsSet].sort((a, b) => a - b);
  if (sortedFloors.length === 0) {
    return { removedRanges, unhiddenFloors: [] };
  }

  // 归并为连续闭区间 [segFrom, segTo] 并调用 unhideRange
  const segments: Array<[number, number]> = [];
  let segFrom = sortedFloors[0];
  let segTo = sortedFloors[0];
  for (let i = 1; i < sortedFloors.length; i++) {
    const cur = sortedFloors[i];
    if (cur === segTo + 1) {
      segTo = cur;
    } else {
      segments.push([segFrom, segTo]);
      segFrom = cur;
      segTo = cur;
    }
  }
  segments.push([segFrom, segTo]);

  const unhiddenFloors: number[] = [];
  for (const [from, to] of segments) {
    const unhidden = await unhideRange(from, to, {
      setChatMessagesFn: options?.setChatMessagesFn,
      gracefulWhenApiMissing: true,
    });
    unhiddenFloors.push(...unhidden);
  }

  return {
    removedRanges,
    unhiddenFloors,
  };
}

export interface AdoptSummaryOptions {
  gateway?: ChatBookGatewayLike;
  strategyType?: SummaryStrategy;
  floorHandling?: SummaryFloorHandling;
  currentFloor?: number;
  tailReserve?: number;
  storage?: Storage;
  updateWorldbookWithFn?: UpdateWorldbookWith;
  setChatMessagesFn?: SetChatMessagesLike;
  onAdopted?: (draft: SummaryDraft) => void;
}

/**
 * 采纳摘要组合流（设计案 §5 组合流）：
 * 1. fileSummary 写入当前聊天档案书；
 * 2. 检查楼层处理策略与真机放行门：
 *    - 若设置＝采纳即隐藏（hide）且放行门已过（hidingGateApproved） → hideRange；
 *    - 🔴 放行门未过期间：强制走「仅注入不隐藏」；
 * 3. 满足成对不变量：隐藏集合 ＝ 区间集合（排除豁免带）；
 * 4. 执行 onAdopted 回调更新暂存态。
 */
function readHostLastFloorSnapshot(anchorFloor?: number): { floorId: number | null; swipeId: number | null } {
  const glmi = tav<() => number>('getLastMessageId');
  const gcm = tav<(id: number) => Array<{ swipe_id?: number }>>('getChatMessages');
  let floorId: number | null = null;
  if (glmi) {
    try {
      const last = glmi();
      if (typeof last === 'number' && Number.isFinite(last) && last >= 0) floorId = last;
    } catch {
      floorId = null;
    }
  }
  if (floorId === null && typeof anchorFloor === 'number' && Number.isFinite(anchorFloor)) {
    floorId = anchorFloor;
  }
  const targetFloor = typeof anchorFloor === 'number' && Number.isFinite(anchorFloor) ? anchorFloor : floorId;
  let swipeId: number | null = null;
  if (targetFloor !== null && gcm) {
    try {
      const sid = gcm(targetFloor)?.[0]?.swipe_id;
      if (typeof sid === 'number' && Number.isFinite(sid)) swipeId = Math.max(0, Math.trunc(sid));
    } catch {
      swipeId = null;
    }
  }
  return { floorId, swipeId };
}

export async function adoptSummary(draft: SummaryDraft, opts?: AdoptSummaryOptions): Promise<AdoptSummaryReceipt> {
  const gateway = opts?.gateway ?? chatBookGateway;
  const storage = opts?.storage;
  const strategyType = opts?.strategyType ?? getSummaryStrategy(storage);
  const floorHandling = opts?.floorHandling ?? getSummaryFloorHandling(storage);
  const gateApproved = isHidingGateApproved(storage);

  const txn = gateway.begin();
  const startSnap = readHostLastFloorSnapshot(opts?.currentFloor);

  const assertContextUnchanged = async (expectedBook: string): Promise<void> => {
    const verifiedBook = await gateway.guardedBook(txn, { createIfMissing: false });
    if (verifiedBook !== expectedBook) {
      const msg = `[摘要采纳守卫失败] 聊天档案书已漂移（期望「${expectedBook}」，实测「${verifiedBook}」）`;
      recordFlightLog({
        category: 'auto_filer',
        status: 'blocked',
        chatId: txn.chatId,
        floorId: startSnap.floorId,
        swipeId: startSnap.swipeId,
        title: '摘要采纳守卫拦截 (CHAT_DRIFTED)',
        detail: msg,
      });
      throw new Error(msg);
    }
    const nowSnap = readHostLastFloorSnapshot(opts?.currentFloor);
    if (startSnap.floorId !== null && nowSnap.floorId !== startSnap.floorId) {
      const msg = `[摘要采纳守卫失败] 末楼身份已漂移（期望 #${startSnap.floorId}，实测 #${nowSnap.floorId}）`;
      recordFlightLog({
        category: 'auto_filer',
        status: 'blocked',
        chatId: txn.chatId,
        floorId: nowSnap.floorId,
        swipeId: nowSnap.swipeId,
        title: '摘要采纳守卫拦截 (FLOOR_DRIFTED)',
        detail: msg,
      });
      throw new Error(msg);
    }
    if (startSnap.swipeId !== null && nowSnap.swipeId !== startSnap.swipeId) {
      const msg = `[摘要采纳守卫失败] Swipe 已漂移（期望 s_${startSnap.swipeId}，实测 s_${nowSnap.swipeId}）`;
      recordFlightLog({
        category: 'auto_filer',
        status: 'blocked',
        chatId: txn.chatId,
        floorId: nowSnap.floorId,
        swipeId: nowSnap.swipeId,
        title: '摘要采纳守卫拦截 (SWIPE_DRIFTED)',
        detail: msg,
      });
      throw new Error(msg);
    }
  };

  // 1. 入书（守卫失败 fail-closed）
  const receipt = await fileSummary(draft, gateway, {
    txn,
    strategyType,
    depth: draft.tier === 'macro' ? DEFAULT_MACRO_DEPTH : DEFAULT_DEPTH,
    updateWorldbookWithFn: opts?.updateWorldbookWithFn,
  });

  await assertContextUnchanged(receipt.book);

  // 2. 楼层处理（放行门为前置拦截）
  let hidden = false;
  let hiddenFloors: number[] = [];

  if (floorHandling === 'hide' && gateApproved) {
    hiddenFloors = await hideRange(draft.from, draft.to, {
      currentFloor: opts?.currentFloor,
      tailReserve: opts?.tailReserve,
      setChatMessagesFn: opts?.setChatMessagesFn,
    });
    hidden = true;
    await assertContextUnchanged(receipt.book);
  }

  opts?.onAdopted?.(draft);

  recordFlightLog({
    category: 'auto_filer',
    status: 'ok',
    chatId: txn.chatId,
    floorId: startSnap.floorId,
    swipeId: startSnap.swipeId,
    title: `摘要采纳完成 (${receipt.comment})`,
    detail: `book=${receipt.book} · 区间=${draft.from}-${draft.to} · 隐藏=${hidden ? `${hiddenFloors.length}楼` : '未隐藏'}`,
  });

  return {
    comment: receipt.comment,
    book: receipt.book,
    from: draft.from,
    to: draft.to,
    hidden,
    hiddenFloors,
    ...(receipt.tier ? { tier: receipt.tier } : {}),
    ...(receipt.demotedMesoComments ? { demotedMesoComments: receipt.demotedMesoComments } : {}),
  };
}

/* ═══════════════ 后台独立生成封装（设计案 §4 generateRaw + 三层摘要 & 额外端点） ═══════════════ */

export const SUMMARY_SYSTEM_PROMPT = `你是一个兼顾战略叙事与群像刻画的剧情记录官。请结合给定的逐楼微纪要与目标楼层原始记录，生成结构清晰、拒绝人物与事件扁平化的阶段剧情卷宗（中摘要）。
【核心要求】
1. 事实与因果并重：严禁写成干瘪的行政流水账，必须保留事件背后的「困境导火索 → 指挥官的博弈抉择 → 现场关键转折与代价/战果」；
2. 严防人物扁平化：必须点名保留本阶段活跃机娘与核心人物的性格切面、情绪/态度转变、标志性言行及与指挥官之间的关键互动/承诺细节；
3. 四维结构化输出：请严格按以下四个分栏组织正文，控制在 300~500 token 以内：
【事件脉络与关键抉择】按因果链串联本阶段核心事件、破局手段与 1~2 处名场面细节；
【人物弧光与互动锚点】记录在场机娘与重要人物的态度转变、鲜活反应、深层动机及与指挥官的情感/契约锚点；
【战区格局与实力演进】归纳基地建设、科技/军工/部队成型、资源产线与外部势力态势消长；
【暗线伏笔与待决钩子】提取本阶段埋下但尚未收束的悬念、未兑现约定或潜在危机；
4. 实体提取：若摘要中涉及关键实体（角色/势力/重要科技/建筑/装备），请在摘要末尾另起一行标注格式：
【实体：实体1, 实体2】`;

export const MACRO_SUMMARY_SYSTEM_PROMPT = `你是一个兼顾史诗格局与群像厚度的最高统帅部战史编纂官。请将给定的多段阶段剧情摘要（中摘要）、逐楼微纪要与目标楼层记录，归并提炼为一份立体连贯的「战役卷宗总纲（大摘要）」。
【核心要求】
1. 宏观正史与因果张力：提炼跨阶段的战略格局演变、决定战区走向的重大战役胜负手与标志性历史场面，剔除已被后续覆盖的临时过渡琐事；
2. 长期群像弧光保真：完整保留核心机娘与重要人物在长周期内的性格蜕变、核心关系定型、刻骨铭心的共同经历与长期承诺/心结，防止跨阶段角色扁平化；
3. 四维结构化输出：请严格按以下四个分栏组织卷宗正文，总篇幅控制在 400~600 token 以内：
【战役主线与时代转折】跨阶段的核心冲突演进、重大战略抉择与标志性战役节点；
【核心群像与羁绊演进】主要机娘与关键人物的长期性格弧光、关系定型与重要情感/契约锚点；
【势力版图与军工体系】基地群落版图、科技与军工能级跃迁、各方本土势力的友敌格局演变；
【远期暗流与终局伏笔】贯穿全卷尚未揭晓的深层谜团、长线约定向背与战略级潜在威胁；
4. 实体提取：在卷宗末尾另起一行汇总本卷涉及的核心实体（角色/势力/基地/重要科技/协议）：
【实体：实体1, 实体2】`;

export function buildMesoSummarySystemPrompt(targetTokens?: number): string {
  if (!targetTokens || targetTokens === DEFAULT_SUMMARY_BUDGET_CONFIG.mesoSingleTargetTokens) {
    return SUMMARY_SYSTEM_PROMPT;
  }
  const minTok = Math.max(80, Math.round(targetTokens * 0.75));
  return SUMMARY_SYSTEM_PROMPT.replace('控制在 300~500 token 以内', `控制在 ${minTok}~${targetTokens} token 以内`);
}

export function buildMacroSummarySystemPrompt(targetTokens?: number): string {
  if (!targetTokens || targetTokens === DEFAULT_SUMMARY_BUDGET_CONFIG.macroSingleTargetTokens) {
    return MACRO_SUMMARY_SYSTEM_PROMPT;
  }
  const minTok = Math.max(120, Math.round(targetTokens * 0.75));
  return MACRO_SUMMARY_SYSTEM_PROMPT.replace(
    '总篇幅控制在 400~600 token 以内',
    `总篇幅控制在 ${minTok}~${targetTokens} token 以内`,
  );
}

export interface RequestSummaryOptions {
  custom_api?: Record<string, unknown>;
  model?: string;
  microSummaries?: MicroSummaryItem[];
  generateRawFn?: (config: Record<string, unknown>) => Promise<string | { text?: string }>;
  getChatMessagesFn?: (range: string | number) => Array<{ message_id: number; message: string; role: string }>;
  storeSink?: SummaryDraft[];
  storage?: Storage;
}

/** 解析 AI 回复提取正文与可选 keys */
export function parseSummaryResponse(rawText: string): { text: string; keys: string[] } {
  const trimmed = rawText.trim();
  const entityMatch = /【实体[：:]\s*([^】]+)】/.exec(trimmed);
  let keys: string[] = [];
  let text = trimmed;

  if (entityMatch) {
    keys = entityMatch[1]
      .split(/[,，、\s]+/)
      .map(k => k.trim())
      .filter(Boolean);
    text = trimmed.replace(entityMatch[0], '').trim();
  }

  return { text, keys };
}

/**
 * 后台独立生成【中摘要（Meso）】请求（设计案 §4 + 小摘要浓缩喂入 + 额外端点支持）：
 * - 若提供 `opts.microSummaries`，优先使用区间内的逐楼小摘要拼装高密度时间线，仅对缺失小摘要的楼层补读原文；
 * - 支持 `opts.custom_api` 或自动读取 `getSummaryEndpointConfig(opts?.storage)` 配置的额外端点；
 * - 产物进 pending_summaries 暂存，🔴 绝不直接入书（自动的只是生成，采纳永远是人）；
 * - API 缺失报错不静默。
 */
export async function requestSummary(range: SummaryRange, opts?: RequestSummaryOptions): Promise<SummaryDraft> {
  const [from, to] = range;
  const getMsgs =
    opts?.getChatMessagesFn ??
    tav<(r: string | number) => Array<{ message_id: number; message: string; role: string }>>('getChatMessages');
  const genRaw =
    opts?.generateRawFn ?? tav<(c: Record<string, unknown>) => Promise<string | { text?: string }>>('generateRaw');

  if (!genRaw) {
    throw new Error('酒馆 API generateRaw 不可用（独立预览环境无法生成摘要）');
  }

  const combinedSource = buildMesoSummarySourceDigest(from, to, {
    microSummaries: opts?.microSummaries,
    getChatMessagesFn: getMsgs,
  });

  const promptContent = combinedSource
    ? `请结合以下【逐楼微纪要】与【目标楼层原始剧情记录】，为第 ${from} 楼至第 ${to} 楼生成四维立体阶段剧情摘要（包含【事件脉络与关键抉择】【人物弧光与互动锚点】【战区格局与实力演进】【暗线伏笔与待决钩子】四个分栏，严防人物与事件扁平化）：\n\n${combinedSource}`
    : `请为第 ${from} 楼至第 ${to} 楼的剧情生成事实性摘要。`;

  const budgetCfg = getSummaryBudgetConfig(opts?.storage);
  const config: Record<string, unknown> = {
    should_silence: true,
    ordered_prompts: [
      { role: 'system', content: buildMesoSummarySystemPrompt(budgetCfg.mesoSingleTargetTokens) },
      { role: 'user', content: promptContent },
    ],
  };

  const endpointCfg = getSummaryEndpointConfig(opts?.storage);
  const resolvedCustomApi = opts?.custom_api ?? buildCustomApiFromEndpointConfig(endpointCfg);
  if (resolvedCustomApi) config.custom_api = resolvedCustomApi;

  const rawRes = await genRaw(config);
  const rawString = typeof rawRes === 'string' ? rawRes : (rawRes?.text ?? '');
  if (!rawString.trim()) {
    throw new Error('generateRaw 返回内容为空');
  }

  const { text, keys } = parseSummaryResponse(rawString);
  const resolvedModel =
    opts?.model ??
    (typeof resolvedCustomApi?.model === 'string'
      ? resolvedCustomApi.model
      : typeof resolvedCustomApi?.proxy_preset === 'string'
        ? resolvedCustomApi.proxy_preset
        : '');

  const draft: SummaryDraft = {
    from,
    to,
    text,
    keys,
    generatedAt: new Date().toISOString(),
    model: resolvedModel,
    status: 'pending',
  };

  if (opts?.storeSink) {
    opts.storeSink.push(draft);
  }

  return draft;
}

/**
 * 后台独立生成【大摘要（Macro · 战役总纲）】请求：
 * - 将多段已入书的【中摘要】归并压缩为 1 条宏观正史大摘要（tier: 'macro'）；
 * - 产物同样进 pending_summaries 待审；采纳入书时将自动把被归并的中摘要降级为 selective 绿灯触发。
 */
export async function requestMacroSummary(
  mesoSegments: Array<{ from: number; to: number; entry?: ThEntry; text?: string; keys?: string[] }>,
  opts?: RequestSummaryOptions,
): Promise<SummaryDraft> {
  if (!Array.isArray(mesoSegments) || mesoSegments.length === 0) {
    throw new Error('生成大摘要需要至少提供 1 段中摘要');
  }

  const genRaw =
    opts?.generateRawFn ?? tav<(c: Record<string, unknown>) => Promise<string | { text?: string }>>('generateRaw');

  if (!genRaw) {
    throw new Error('酒馆 API generateRaw 不可用（独立预览环境无法生成大摘要）');
  }

  const sorted = [...mesoSegments].sort((a, b) => a.from - b.from);
  const from = sorted[0].from;
  const to = sorted[sorted.length - 1].to;

  const combinedMacroSource = buildMacroSummarySourceDigest(sorted, {
    microSummaries: opts?.microSummaries,
    getChatMessagesFn: opts?.getChatMessagesFn,
  });

  const promptContent = `请结合以下第 ${from} 楼至第 ${to} 楼的 ${sorted.length} 段阶段摘要、逐楼微纪要与目标楼层记录，归并提炼为一份四维立体战役卷宗总纲（大摘要，包含【战役主线与时代转折】【核心群像与羁绊演进】【势力版图与军工体系】【远期暗流与终局伏笔】四个分栏）：\n\n${combinedMacroSource}`;

  const budgetCfg = getSummaryBudgetConfig(opts?.storage);
  const config: Record<string, unknown> = {
    should_silence: true,
    ordered_prompts: [
      { role: 'system', content: buildMacroSummarySystemPrompt(budgetCfg.macroSingleTargetTokens) },
      { role: 'user', content: promptContent },
    ],
  };

  const endpointCfg = getSummaryEndpointConfig(opts?.storage);
  const resolvedCustomApi = opts?.custom_api ?? buildCustomApiFromEndpointConfig(endpointCfg);
  if (resolvedCustomApi) config.custom_api = resolvedCustomApi;

  const rawRes = await genRaw(config);
  const rawString = typeof rawRes === 'string' ? rawRes : (rawRes?.text ?? '');
  if (!rawString.trim()) {
    throw new Error('generateRaw 返回内容为空');
  }

  const { text, keys } = parseSummaryResponse(rawString);
  // 合并子段的高频实体作为补充
  const mergedKeys = [
    ...new Set([
      ...keys,
      ...sorted.flatMap(s => {
        if (s.keys && s.keys.length > 0) return s.keys;
        if (Array.isArray(s.entry?.strategy?.keys) && s.entry.strategy.keys.length > 0) {
          return s.entry.strategy.keys as string[];
        }
        const exKeys = (s.entry?.extra as Record<string, unknown> | undefined)?.keys;
        return Array.isArray(exKeys) ? (exKeys as string[]) : [];
      }),
    ]),
  ]
    .map(k => k.trim())
    .filter(Boolean)
    .slice(0, 16);

  const resolvedModel =
    opts?.model ??
    (typeof resolvedCustomApi?.model === 'string'
      ? resolvedCustomApi.model
      : typeof resolvedCustomApi?.proxy_preset === 'string'
        ? resolvedCustomApi.proxy_preset
        : '');

  const draft: SummaryDraft = {
    from,
    to,
    text,
    keys: mergedKeys,
    generatedAt: new Date().toISOString(),
    model: resolvedModel,
    status: 'pending',
    tier: 'macro',
  };

  if (opts?.storeSink) {
    opts.storeSink.push(draft);
  }

  return draft;
}

/* ═══════════════ 真机放行门探针（🔴 驾驶员手动触发，绝不自动运行） ═══════════════ */

/**
 * §5 放行门探针：观测 is_hidden 对楼层读取与 MVU 变量链的影响。
 * 🔴 驾驶员手动触发，绝不自动运行！测试完毕自动复原（unhide）。
 */
export async function probeHiddenFloorEffects(
  testFloor = 1,
  opts?: {
    getChatMessagesFn?: (
      range: string | number,
      options?: { hide_state?: string },
    ) => Array<{ message_id: number; is_hidden?: boolean; data?: unknown }>;
    setChatMessagesFn?: SetChatMessagesLike;
  },
): Promise<ProbeReport> {
  const getMsgs =
    opts?.getChatMessagesFn ??
    tav<
      (
        r: string | number,
        o?: { hide_state?: string },
      ) => Array<{ message_id: number; is_hidden?: boolean; data?: unknown }>
    >('getChatMessages');
  const setMsgs = opts?.setChatMessagesFn ?? tav<SetChatMessagesLike>('setChatMessages');

  if (!getMsgs || !setMsgs) {
    return {
      probe: 'hidden-floor-effects',
      ok: false,
      observed: { testFloor, apiAvailable: false },
      note: '环境缺少 getChatMessages 或 setChatMessages API，探针未执行',
    };
  }

  // 1. 隐藏前观测
  const beforeAll = getMsgs(testFloor, { hide_state: 'all' });
  const msgBefore = beforeAll.find(m => m.message_id === testFloor);
  const hadDataBefore = !!msgBefore?.data;

  // 2. 执行隐藏
  await setMsgs([{ message_id: testFloor, is_hidden: true }]);

  // 3. 隐藏后观测
  const afterAll = getMsgs(testFloor, { hide_state: 'all' });
  const afterHidden = getMsgs(testFloor, { hide_state: 'hidden' });
  const afterUnhidden = getMsgs(testFloor, { hide_state: 'unhidden' });
  const msgAfter = afterAll.find(m => m.message_id === testFloor);
  const isHiddenReadout = msgAfter?.is_hidden === true;
  const hasDataAfter = !!msgAfter?.data;

  // 4. 自带复原：恢复 unhidden
  await setMsgs([{ message_id: testFloor, is_hidden: false }]);
  const restoredAll = getMsgs(testFloor, { hide_state: 'all' });
  const msgRestored = restoredAll.find(m => m.message_id === testFloor);
  const isRestored = msgRestored?.is_hidden === false;

  const ok = isHiddenReadout && hasDataAfter && isRestored;

  return {
    probe: 'hidden-floor-effects',
    ok,
    observed: {
      testFloor,
      hadDataBefore,
      isHiddenReadout,
      foundInHiddenQuery: afterHidden.some(m => m.message_id === testFloor),
      foundInUnhiddenQuery: afterUnhidden.some(m => m.message_id === testFloor),
      hasDataAfter,
      isRestored,
    },
    note: ok
      ? '隐藏生效且数据完好，复原正常；结论仍归驾驶员 L3 真机审定'
      : '⚠ 隐藏异常或数据受损，请驾驶员根据 observed 读数裁决',
  };
}
