/**
 * strategicFeedforward.ts —— 战区全局七大板块态势前馈 + 前端八维组合战术诊断 + MCV 机娘/人类参谋席路由纯引擎（FD-31 · PKG-A 慢热五阶升级版）
 *
 * 核心职责：
 * 1. `resolveCampaignPhase`：五阶战役状态机（原世界序章 / 被动静默待机 / 初抵踏勘 / 首基T1爬坡 / 多产线战区博弈）；
 * 2. `resolveStaffAdvisors`：扫描 `forces.girls`、`command.unlocked_factions`、`command.adjutants` 与 `bootChoices.humanRoster`，结合通联门禁动态决议参谋席；
 * 3. `analyzeTacticalCombos` & `analyzeUserTurnIntent`：执行慢热感知的「八维组合战术诊断」与玩家当轮意图对齐；
 * 4. `deriveStrategicFeedforward` / `formatStrategicFeedforwardPrompt` / `planStrategicFeedforward`：生成只读前馈视图与注入载荷。
 *
 * 🔴 纯函数铁律：零 IO / 零事件 / 零 DOM / 零 Vue·Pinia / 零酒馆 API；不原地修改任何入参。
 */

import { mergeEffectiveCatalog, type DlcOverlay, type DynamicWorldbookCatalog, type EffectiveCatalog } from '../core/catalogEffective';
import type { ParsedWorldbookCatalog } from '../../中控悬浮窗/models/worldbookCatalogParser';
import {
  resolveScanStart,
  scanLatestFloorPair,
  scanLatestValidFloor,
  type FloorCandidate,
  type FloorSnapshot,
  type FloorSnapshotPair,
  type GenerationEntry,
} from '../parse/floorScanner';
import { canon } from '../parse/parseCommon';
import { calcDailyNet } from '../engines/chainEngine';
import { resolveBuildingRelativeCoord } from '../engines/buildingCoordEngine';
import {
  computeExposureFloor,
  isMoraleEngaged,
  resolveExposureLevel,
  resolveMoraleStage,
} from '../engines/exposureMoraleEngine';
import { FACTION_STARTER_MCV_MAP, resolveStarterMcvInfo } from '../core/commandPresets';
import { resolveLegacyProtocolName, type SCHEMA_VERSION, type StatData } from '../core/schema';
import { buildPlanningContext, type PlanningBaseContext } from './planningContext';
import {
  deriveResearchAdvisory,
  resolveGenerationEntry,
  type GenerationDescriptor,
  type ResearchAdvisory,
} from './researchAdvisory';
import {
  detectPendingChainContinuations,
  detectPendingIntelChains,
  detectUserQuestIntent,
  formatQuestRewardCompact,
  parseIntelChainStep,
  parseQuestChainStep,
  PRESET_INTEL_CHAIN_TEMPLATES,
  PRESET_QUEST_ARCHETYPES,
  PRESET_QUEST_CHAIN_TEMPLATES,
  recommendPresetQuestArchetypes,
  resolveDynamicQuestIssuer,
  type ChainAwareIntelItem,
  type ChainAwareQuest,
  type IntelChainContinuationHint,
  type PresetIntelChainStageTemplate,
  type PresetIntelChainTemplate,
  type PresetQuestArchetype,
  type PresetQuestChainStageTemplate,
  type PresetQuestChainTemplate,
  type PresetQuestIssuerDomain,
  type PresetQuestRecommendation,
  type PresetQuestSeriesId,
  type QuestCategory,
  type QuestChainContinuationHint,
  type RecommendPresetQuestsOptions,
  type UserQuestIntent,
} from './questArchetypes';

export {
  detectPendingChainContinuations,
  detectPendingIntelChains,
  detectUserQuestIntent,
  formatQuestRewardCompact,
  parseIntelChainStep,
  parseQuestChainStep,
  PRESET_INTEL_CHAIN_TEMPLATES,
  PRESET_QUEST_ARCHETYPES,
  PRESET_QUEST_CHAIN_TEMPLATES,
  recommendPresetQuestArchetypes,
  resolveDynamicQuestIssuer,
  type ChainAwareIntelItem,
  type ChainAwareQuest,
  type IntelChainContinuationHint,
  type PresetIntelChainStageTemplate,
  type PresetIntelChainTemplate,
  type PresetQuestArchetype,
  type PresetQuestChainStageTemplate,
  type PresetQuestChainTemplate,
  type PresetQuestIssuerDomain,
  type PresetQuestRecommendation,
  type PresetQuestSeriesId,
  type QuestCategory,
  type QuestChainContinuationHint,
  type RecommendPresetQuestsOptions,
  type UserQuestIntent,
};

/* ═══════════════ 1. 结构化类型定义与偏好持久化契约 ═══════════════ */

export type CampaignPhase =
  | 'prologue_unbound'
  | 'silent_standby'
  | 'field_recon'
  | 'early_industrial_climb'
  | 'mid_late_theater';

export type FeedforwardPacingMode = 'slow_sim' | 'balanced' | 'story_first';

export type FeedforwardSystemLinkOverride =
  | 'auto'
  | 'post_transmigration_bind'
  | 'commander_initiate'
  | 'immediate_active';

export type FeedforwardMaidenIncubationOverride =
  | 'auto'
  | 'iconic_plus_blindbox'
  | 'full_blindbox'
  | 'preset_roster'
  | 'off';

export interface FeedforwardPreferences {
  enabled: boolean;
  pacingMode: FeedforwardPacingMode;
  systemLinkOverride: FeedforwardSystemLinkOverride;
  maidenIncubationOverride?: FeedforwardMaidenIncubationOverride;
  /** FD-45：兼容机娘初诞提示开关（设为 'off' 时抑制 [机魂初诞契机] 尾缀） */
  girlHatchingMode?: FeedforwardMaidenIncubationOverride | string;
  suppressDuplicateResearchAdvisory: boolean;
}

export const FEEDFORWARD_PREFS_STORAGE_KEY = 'ra_strategic_feedforward_prefs_v1';

export const DEFAULT_FEEDFORWARD_PREFERENCES: FeedforwardPreferences = {
  enabled: true,
  pacingMode: 'slow_sim',
  systemLinkOverride: 'auto',
  maidenIncubationOverride: 'auto',
  suppressDuplicateResearchAdvisory: true,
};

function resolveDefaultStorage(
  explicitStorage?: Pick<Storage, 'getItem'> | null,
): Pick<Storage, 'getItem'> | null {
  if (explicitStorage !== undefined) return explicitStorage;
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // 隐私模式或受限沙箱下安全降级
  }
  return null;
}

function isValidPacingMode(val: unknown): val is FeedforwardPacingMode {
  return val === 'slow_sim' || val === 'balanced' || val === 'story_first';
}

function isValidSystemLinkOverride(val: unknown): val is FeedforwardSystemLinkOverride {
  return (
    val === 'auto' ||
    val === 'post_transmigration_bind' ||
    val === 'commander_initiate' ||
    val === 'immediate_active'
  );
}

function isValidMaidenIncubationOverride(val: unknown): val is FeedforwardMaidenIncubationOverride {
  return (
    val === 'auto' ||
    val === 'iconic_plus_blindbox' ||
    val === 'full_blindbox' ||
    val === 'preset_roster' ||
    val === 'off'
  );
}

function normalizePreferences(raw: Partial<FeedforwardPreferences> | null | undefined): FeedforwardPreferences {
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : DEFAULT_FEEDFORWARD_PREFERENCES.enabled,
    pacingMode: isValidPacingMode(raw?.pacingMode)
      ? raw.pacingMode
      : DEFAULT_FEEDFORWARD_PREFERENCES.pacingMode,
    systemLinkOverride: isValidSystemLinkOverride(raw?.systemLinkOverride)
      ? raw.systemLinkOverride
      : DEFAULT_FEEDFORWARD_PREFERENCES.systemLinkOverride,
    maidenIncubationOverride: isValidMaidenIncubationOverride(raw?.maidenIncubationOverride)
      ? raw.maidenIncubationOverride
      : DEFAULT_FEEDFORWARD_PREFERENCES.maidenIncubationOverride,
    ...(typeof raw?.girlHatchingMode === 'string' ? { girlHatchingMode: raw.girlHatchingMode } : {}),
    suppressDuplicateResearchAdvisory:
      typeof raw?.suppressDuplicateResearchAdvisory === 'boolean'
        ? raw.suppressDuplicateResearchAdvisory
        : DEFAULT_FEEDFORWARD_PREFERENCES.suppressDuplicateResearchAdvisory,
  };
}

export function getFeedforwardPreferences(
  storage?: Pick<Storage, 'getItem'> | null,
): FeedforwardPreferences {
  const target = resolveDefaultStorage(storage);
  if (!target) return { ...DEFAULT_FEEDFORWARD_PREFERENCES };
  try {
    const rawText = target.getItem(FEEDFORWARD_PREFS_STORAGE_KEY);
    if (!rawText) return { ...DEFAULT_FEEDFORWARD_PREFERENCES };
    const parsed = JSON.parse(rawText) as Partial<FeedforwardPreferences>;
    return normalizePreferences(parsed);
  } catch {
    return { ...DEFAULT_FEEDFORWARD_PREFERENCES };
  }
}

export function setFeedforwardPreferences(
  patch: Partial<FeedforwardPreferences>,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
): FeedforwardPreferences {
  const current = getFeedforwardPreferences(storage);
  const next = normalizePreferences({ ...current, ...(patch ?? {}) });
  const target =
    storage !== undefined
      ? storage
      : (() => {
          try {
            return typeof globalThis !== 'undefined' && 'localStorage' in globalThis
              ? globalThis.localStorage
              : null;
          } catch {
            return null;
          }
        })();
  if (target && typeof target.setItem === 'function') {
    try {
      target.setItem(FEEDFORWARD_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 配额满或只读环境安全忽略
    }
  }
  return next;
}

export interface BootChoicesHint {
  entryMode?: string;
  entryTiming?: string;
  systemLinkMode?: string;
  maidenIncubationMode?: string;
  humanRoster?: Array<{
    name?: string;
    callsign?: string;
    title?: string;
    assignment?: string;
    personality?: string;
    bio?: string;
  }>;
  factionAdjutants?: Record<string, { identity?: string; name?: string; title?: string }>;
  staffAdjutant?: { enabled?: boolean; name?: string; title?: string } | null;
  customPrompt?: string;
}

function coerceObject(val: unknown): Record<string, unknown> | null {
  if (!val) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof val === 'object' && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return null;
}

export function readBootChoicesHintFromVars(
  chatVars: Record<string, unknown> | undefined | null,
): BootChoicesHint | null {
  if (!chatVars || typeof chatVars !== 'object') return null;

  const candidateRaw =
    chatVars['$boot'] ??
    chatVars['bootChoices'] ??
    chatVars['boot_choices'] ??
    chatVars['ra_boot_choices'] ??
    (chatVars['stat_data'] && typeof chatVars['stat_data'] === 'object'
      ? (chatVars['stat_data'] as Record<string, unknown>)['$boot']
      : undefined);

  const bootObj =
    coerceObject(candidateRaw) ??
    ('entryMode' in chatVars ||
    'entry_mode' in chatVars ||
    'systemLinkMode' in chatVars ||
    'system_link_mode' in chatVars ||
    'humanRoster' in chatVars ||
    'human_roster' in chatVars
      ? chatVars
      : null);

  if (!bootObj) return null;

  const hint: BootChoicesHint = {};
  const entryMode = bootObj['entryMode'] ?? bootObj['entry_mode'];
  if (typeof entryMode === 'string' && entryMode.trim()) {
    hint.entryMode = entryMode.trim();
  }

  const systemLinkMode = bootObj['systemLinkMode'] ?? bootObj['system_link_mode'];
  if (typeof systemLinkMode === 'string' && systemLinkMode.trim()) {
    hint.systemLinkMode = systemLinkMode.trim();
  }

  const maidenIncubationMode =
    bootObj['maidenIncubationMode'] ?? bootObj['maiden_incubation_mode'];
  if (typeof maidenIncubationMode === 'string' && maidenIncubationMode.trim()) {
    hint.maidenIncubationMode = maidenIncubationMode.trim();
  }

  const rawRoster = bootObj['humanRoster'] ?? bootObj['human_roster'] ?? bootObj['companions'];
  if (Array.isArray(rawRoster)) {
    hint.humanRoster = rawRoster
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map(item => ({
        name: typeof item['name'] === 'string' ? item['name'] : undefined,
        callsign: typeof item['callsign'] === 'string' ? item['callsign'] : undefined,
        title: typeof item['title'] === 'string' ? item['title'] : undefined,
        assignment: typeof item['assignment'] === 'string' ? item['assignment'] : undefined,
        personality: typeof item['personality'] === 'string' ? item['personality'] : undefined,
        bio: typeof item['bio'] === 'string' ? item['bio'] : undefined,
      }));
  }

  const rawFactionAdj = coerceObject(bootObj['factionAdjutants'] ?? bootObj['faction_adjutants']);
  if (rawFactionAdj) {
    const mapped: Record<string, { identity?: string; name?: string; title?: string }> = {};
    for (const [k, v] of Object.entries(rawFactionAdj)) {
      const obj = coerceObject(v);
      if (obj) {
        mapped[k] = {
          identity: typeof obj['identity'] === 'string' ? obj['identity'] : undefined,
          name: typeof obj['name'] === 'string' ? obj['name'] : undefined,
          title: typeof obj['title'] === 'string' ? obj['title'] : undefined,
        };
      }
    }
    hint.factionAdjutants = mapped;
  }

  const rawStaffAdj = coerceObject(bootObj['staffAdjutant'] ?? bootObj['staff_adjutant']);
  if (rawStaffAdj) {
    hint.staffAdjutant = {
      enabled: typeof rawStaffAdj['enabled'] === 'boolean' ? rawStaffAdj['enabled'] : undefined,
      name: typeof rawStaffAdj['name'] === 'string' ? rawStaffAdj['name'] : undefined,
      title: typeof rawStaffAdj['title'] === 'string' ? rawStaffAdj['title'] : undefined,
    };
  } else if (bootObj['staffAdjutant'] === null || bootObj['staff_adjutant'] === null) {
    hint.staffAdjutant = null;
  }

  const customPrompt = bootObj['customPrompt'] ?? bootObj['custom_prompt'];
  if (typeof customPrompt === 'string' && customPrompt.trim()) {
    hint.customPrompt = customPrompt.trim();
  }

  return hint;
}

export interface CompletionMilestoneEntry {
  state: 'settling' | 'just_completed';
  domain: 'building' | 'unit' | 'tech' | 'protocol' | 'project' | 'space' | 'quest' | 'intel';
  title: string;
  baseName?: string;
  detail: string;
  /** 完工即解锁（Cascade Unlock）：该项竣工/突破后新激活的下游可造/可产/可研代表项（最多 4 项） */
  unlockedHighlights: string[];
  /** 首台新单位下线/待收讫且 forces.girls 尚无同型号机娘时为 true */
  girlBirthEligible: boolean;
}

export interface CompletionMilestonesSummary {
  settlingItems: CompletionMilestoneEntry[];
  completedItems: CompletionMilestoneEntry[];
}

export interface StrategicFeedforwardOptions {
  bootChoices?: BootChoicesHint | null;
  latestUserMessage?: string;
  preferences?: Partial<FeedforwardPreferences>;
  /** FD-45：上一有效楼 stat_data 快照（用于 #N-1 vs #N 双楼差值推导完工里程碑） */
  prevData?: StatData | null;
  /** DEV 调试沙盒开关：生产环境默认 false，开启时解除长期工程与商业航天前馈门禁 */
  debugEnabled?: boolean;
}

export type DeriveStrategicFeedforwardOptions = StrategicFeedforwardOptions;

export interface AnalyzeTacticalCombosOptions {
  baseContexts?: PlanningBaseContext[];
  researchAdvisory?: ResearchAdvisory | null;
  maxFindings?: number;
  bootChoices?: BootChoicesHint | null;
  latestUserMessage?: string;
  preferences?: Partial<FeedforwardPreferences>;
  campaignPhase?: CampaignPhase;
  /** FD-45：上一有效楼 stat_data 快照 */
  prevData?: StatData | null;
  /** DEV 调试沙盒开关：生产环境默认 false */
  debugEnabled?: boolean;
}

export interface CampaignPhaseResolution {
  phase: CampaignPhase;
  phaseLabel: string;
  effectiveSystemLinkMode: 'post_transmigration_bind' | 'commander_initiate' | 'immediate_active';
  systemBound: boolean;
  maidensCanProactivelySpeak: boolean;
}

export type TacticalComboCategory =
  | 'power_grid'
  | 'mother_buildings'
  | 'blueprint_adoption'
  | 'idle_capacity'
  | 'standby_mcv_and_factions'
  | 'economy_and_resources'
  | 'force_balance'
  | 'active_quest_bottleneck';

export type TacticalComboPriority = 'P0' | 'P1' | 'P2';

export interface TacticalComboFinding {
  category: TacticalComboCategory;
  priority: TacticalComboPriority;
  /** 建议对应的焦点标签（供 <态势> 参谋建议 的 焦点 字段参考，如「产线扩建」「新兵种列装」「任务推进」） */
  focusTag: string;
  /** 简短标题 */
  title: string;
  /** 组合诊断详情（现状 + 影响） */
  diagnosis: string;
  /** 建议下一步可执行动作 */
  recommendedAction: string;
  /** 推荐由哪个阵营/领域的参谋优先关注 */
  preferredDomain: 'allied' | 'soviet' | 'yuri' | 'general';
}

export interface StaffAdvisorProfile {
  /** 参谋显示名（如「白凌」「喀秋莎」「尤里卡」或随行人类「萧栖雪」） */
  name: string;
  /** 所属阵营标识 */
  faction: 'allied' | 'soviet' | 'yuri' | 'other';
  /** 职务/身份说明 */
  roleTitle: string;
  /** 参谋专长领域描述 */
  specialty: string;
  /** 当前好感度 */
  affection: number;
  /** 性格与特质简述 */
  personaHint: string;
  /** 首发 MCV 机娘专属口吻锚点（供 <态势> 参谋建议与正文互动参考） */
  voiceTag?: string;
}

export interface StaffAdvisorRoster {
  /** 单席独奏 vs 多席联席 */
  mode: 'solo' | 'ensemble';
  advisors: StaffAdvisorProfile[];
}

export interface StrategicFeedforward {
  floorId: number;
  schemaVersion: typeof SCHEMA_VERSION;
  data: StatData;
  catalog: EffectiveCatalog;
  baseContexts: PlanningBaseContext[];
  researchAdvisory: ResearchAdvisory | null;
  dailyNetCredits: number;
  advisorRoster: StaffAdvisorRoster;
  comboFindings: TacticalComboFinding[];
  /** FD-45：本轮待收讫与最新竣工里程碑汇总 */
  completionMilestones: CompletionMilestonesSummary;
  campaignPhase: CampaignPhase;
  campaignPhaseLabel: string;
  effectiveSystemLinkMode: 'post_transmigration_bind' | 'commander_initiate' | 'immediate_active';
  effectiveMaidenIncubationMode?: 'iconic_plus_blindbox' | 'full_blindbox' | 'preset_roster' | 'off';
  pacingMode: FeedforwardPacingMode;
  preferences: FeedforwardPreferences;
  userIntentSummary?: string;
  /** FD-47：本轮参谋部候选派发任务提案（1~2 项） */
  questRecommendations?: PresetQuestRecommendation[];
  /** FD-48：本轮已完成系列任务待续杯下一环提示列表 */
  chainContinuations?: QuestChainContinuationHint[];
  /** FD-50：本轮在途情报链交叉印证续杯与终局水落石出转化提示列表 */
  intelChainHints?: IntelChainContinuationHint[];
  /** FD-47：玩家本轮作战任务意图（点名督办 / 主动求任务） */
  userQuestIntent?: UserQuestIntent;
  /** FD-45+：玩家本轮战区情报与世界暗流意图（点名核查线报 / 点名介入暗流） */
  userIntelIntent?: UserIntelIntent;
  /** 长期工程与商业航天前馈门禁是否开启（DEV 调试态、或存档已有工程/航天资产、或玩家显式下达工程/航天指令时为 true） */
  engineeringAndSpaceEnabled?: boolean;
}

export interface UserIntelIntent {
  /** 玩家通过 PDA/楼层卡片或输入点名核查的战术/地方线报标题或内容摘要 */
  targetedIntelTitle?: string;
  /** 玩家通过 PDA/世界演变面板或输入点名介入/侦察的宏观世界演变标题 */
  targetedWorldEvoTitle?: string;
  /** 玩家是否主动下达了情报核查或暗流介入指令 */
  wantsIntelAction: boolean;
}

type IncomeChainItem = NonNullable<StatData['economy']>['chains'][number];

/** FD-51：兼容三轨收支与扩展物理依赖的资金/物资链条类型 */
export type MultiTrackChainLike = IncomeChainItem & {
  chain_kind?: string;
  wallet_daily?: Record<string, number>;
  resources_daily?: Record<string, Record<string, number>>;
  deps?: IncomeChainItem['deps'] & {
    vehicles?: string[];
    faction?: string;
  };
};

export type StrategicFeedforwardView = StrategicFeedforward;

/* ═══════════════ 2. 模块 B：五阶战役状态机 ═══════════════ */

function isExplicitLinkMode(
  val: unknown,
): val is 'post_transmigration_bind' | 'commander_initiate' | 'immediate_active' {
  return (
    val === 'post_transmigration_bind' ||
    val === 'commander_initiate' ||
    val === 'immediate_active'
  );
}

export function resolveCampaignPhase(
  data: StatData,
  bootChoices?: BootChoicesHint | null,
  prefs?: Partial<FeedforwardPreferences>,
): CampaignPhaseResolution {
  const bases = data.bases ?? [];
  const girls = data.forces?.girls ?? [];
  const rawEntryStr = `${bootChoices?.entryMode ?? ''} ${bootChoices?.entryTiming ?? ''}`;
  const isPreTransmigrationEntry =
    bootChoices?.entryMode === 'pre_transmigration' || /穿越前夕|原世界/.test(rawEntryStr);
  const rawLinkStr = String(bootChoices?.systemLinkMode ?? '').trim();

  let effectiveSystemLinkMode: 'post_transmigration_bind' | 'commander_initiate' | 'immediate_active';
  if (isExplicitLinkMode(prefs?.systemLinkOverride)) {
    effectiveSystemLinkMode = prefs.systemLinkOverride;
  } else if (isExplicitLinkMode(bootChoices?.systemLinkMode)) {
    effectiveSystemLinkMode = bootChoices.systemLinkMode;
  } else if (isPreTransmigrationEntry || /穿越后/.test(rawLinkStr)) {
    effectiveSystemLinkMode = 'post_transmigration_bind';
  } else if (/立即/.test(rawLinkStr)) {
    effectiveSystemLinkMode = 'immediate_active';
  } else if (bootChoices != null) {
    effectiveSystemLinkMode = 'commander_initiate';
  } else {
    effectiveSystemLinkMode =
      bases.length > 0 || girls.length > 0 ? 'immediate_active' : 'commander_initiate';
  }

  if (bases.length === 0) {
    const isUnboundPreTransmigration =
      effectiveSystemLinkMode === 'post_transmigration_bind' ||
      (isPreTransmigrationEntry &&
        !isExplicitLinkMode(prefs?.systemLinkOverride) &&
        !isExplicitLinkMode(bootChoices?.systemLinkMode));

    if (isUnboundPreTransmigration) {
      return {
        phase: 'prologue_unbound',
        phaseLabel: '阶段0 · 原世界序章（系统尚未绑定）',
        effectiveSystemLinkMode: 'post_transmigration_bind',
        systemBound: false,
        maidensCanProactivelySpeak: false,
      };
    }

    if (effectiveSystemLinkMode === 'commander_initiate') {
      return {
        phase: 'silent_standby',
        phaseLabel: '阶段1 · 被动静默待机（待指挥官亲自联系）',
        effectiveSystemLinkMode,
        systemBound: true,
        maidensCanProactivelySpeak: false,
      };
    }

    return {
      phase: 'field_recon',
      phaseLabel: '阶段2 · 初抵掩体与半迷雾踏勘期',
      effectiveSystemLinkMode,
      systemBound: true,
      maidensCanProactivelySpeak: true,
    };
  }

  const runningCount =
    bases[0]?.buildings?.filter(b => b.state === '运转').length ?? 0;
  if (bases.length === 1 && runningCount < 4) {
    return {
      phase: 'early_industrial_climb',
      phaseLabel: '阶段3 · 首基初建与T1工业爬坡期',
      effectiveSystemLinkMode,
      systemBound: true,
      maidensCanProactivelySpeak: true,
    };
  }

  return {
    phase: 'mid_late_theater',
    phaseLabel: '阶段4 · 多产线协同与战区博弈期',
    effectiveSystemLinkMode,
    systemBound: true,
    maidensCanProactivelySpeak: true,
  };
}

/* ═══════════════ 3. 模块 C：MCV 机娘与人类参谋席动态路由 ═══════════════ */

const FACTION_DEFAULT_ADVISORS: Record<
  'allied' | 'soviet' | 'yuri',
  { defaultName: string; roleTitle: string; specialty: string; personaHint: string }
> = {
  allied: {
    defaultName: '白凌',
    roleTitle: '盟军 MCV 首席战术副官',
    specialty: '基建扩建 · 产线调度 · 精密科研 · 后勤统筹',
    personaHint: '冷静理性、条理分明、温和可靠',
  },
  soviet: {
    defaultName: '喀秋莎',
    roleTitle: '苏联 MCV 重工参谋副官',
    specialty: '重装装甲 · 钢铁防线 · 工业产能 · 攻坚火力',
    personaHint: '果断豪迈、崇尚重火力与坚固工事',
  },
  yuri: {
    defaultName: '尤里卡',
    roleTitle: '尤里 MCV 心灵电子参谋',
    specialty: '电子情报 · 隐蔽渗透 · 战略协议 · 特种作战',
    personaHint: '敏锐幽邃、擅长心理博弈与奇袭破局',
  },
};

const MCV_MAIDEN_NAME_RE = /^(白凌|喀秋莎|凛冬妮娅|妮娅|尤里卡|薇拉)$/;

function inferGirlFactionKey(girl: {
  name?: string;
  callsign?: string;
  faction?: string;
  model?: string;
  duty?: string;
}): 'allied' | 'soviet' | 'yuri' | 'other' {
  const joined = `${girl.name ?? ''} ${girl.callsign ?? ''} ${girl.faction ?? ''} ${girl.model ?? ''} ${girl.duty ?? ''}`;
  if (/白凌|盟军|allied|ally/i.test(joined)) return 'allied';
  if (/喀秋莎|妮娅|凛冬|苏联|苏军|soviet/i.test(joined)) return 'soviet';
  if (/尤里卡|薇拉|尤里|心灵|yuri/i.test(joined)) return 'yuri';
  return 'other';
}

function resolveGirlDisplayName(
  girl: { name?: string; callsign?: string },
  fallbackName: string,
): string {
  const rawName = String(girl.name ?? '').trim();
  const rawCallsign = String(girl.callsign ?? '').trim();
  if (rawName && !/待授名|未授名|未命名/.test(rawName)) return rawName;
  if (rawCallsign && !/待授名|未授名|未命名/.test(rawCallsign)) return rawCallsign;
  return fallbackName;
}

interface LegacyCommandAdjutantsShape {
  faction_adjutants?: Record<string, { identity?: string; name?: string; title?: string }>;
  staff_adjutant?: { enabled?: boolean; identity?: string; name?: string; title?: string } | null;
}

/**
 * 提取人类副官与随行名册（兼容 `data.command.adjutants` 数组或 `{ faction_adjutants, staff_adjutant }` 对象，以及 `bootChoices`）
 */
function collectHumanAdvisors(
  data: StatData,
  bootChoices?: BootChoicesHint | null,
): StaffAdvisorProfile[] {
  const humans: StaffAdvisorProfile[] = [];
  const used = new Set<string>();

  const pushHuman = (profile: StaffAdvisorProfile) => {
    const cleanName = profile.name.trim();
    if (!cleanName || MCV_MAIDEN_NAME_RE.test(cleanName)) return;
    const key = canon(cleanName);
    if (!key || used.has(key)) return;
    used.add(key);
    humans.push({ ...profile, name: cleanName });
  };

  // 1. 扫描 bootChoices.humanRoster
  for (const h of bootChoices?.humanRoster ?? []) {
    const name = String(h.name || h.callsign || '').trim();
    if (!name) continue;
    const rawAssign = String(h.assignment || '').trim();
    const assignLabel =
      rawAssign === 'staff'
        ? '联席参谋协理'
        : rawAssign === 'faction:soviet'
          ? '重工与火力协理'
          : rawAssign === 'faction:yuri'
            ? '战资与特勤协理'
            : rawAssign === 'faction:allied'
              ? '战术与精确协理'
              : '现场协同 · 环境观察';
    pushHuman({
      name,
      faction: 'other',
      roleTitle: h.title || '随行同伴',
      specialty: assignLabel,
      affection: 65,
      personaHint: h.personality || h.bio || '沉着可靠、贴身随行',
    });
  }

  // 2. 扫描 data.command.adjutants（支持数组与对象两种结构）
  const rawAdjutants = data.command?.adjutants as unknown;
  if (Array.isArray(rawAdjutants)) {
    for (const adj of rawAdjutants) {
      if (!adj || typeof adj !== 'object') continue;
      if (adj.status === 'suspended') continue;
      const isHuman =
        adj.identity === 'human' ||
        (adj.role === 'staff' && adj.identity !== 'mcv_girl' && adj.identity !== 'commander_self');
      if (!isHuman) continue;
      const name = String(adj.name ?? '').trim();
      if (!name) continue;
      pushHuman({
        name,
        faction: 'other',
        roleTitle: adj.title || '随行参谋副官',
        specialty: adj.note || '战术协理 · 现场统筹',
        affection: 60,
        personaHint: '干练敏锐、贴身协理',
      });
    }
  } else if (rawAdjutants && typeof rawAdjutants === 'object') {
    const legacy = rawAdjutants as LegacyCommandAdjutantsShape;
    if (legacy.faction_adjutants && typeof legacy.faction_adjutants === 'object') {
      for (const [, fAdj] of Object.entries(legacy.faction_adjutants)) {
        if (!fAdj || fAdj.identity !== 'human') continue;
        const name = String(fAdj.name ?? '').trim();
        if (!name) continue;
        pushHuman({
          name,
          faction: 'other',
          roleTitle: fAdj.title || '阵营人类副官',
          specialty: '现场统筹 · 后勤协调',
          affection: 60,
          personaHint: '干练敏锐、贴身协理',
        });
      }
    }
    if (legacy.staff_adjutant && legacy.staff_adjutant.enabled !== false) {
      const name = String(legacy.staff_adjutant.name ?? '').trim();
      if (name && legacy.staff_adjutant.identity !== 'mcv_girl') {
        pushHuman({
          name,
          faction: 'other',
          roleTitle: legacy.staff_adjutant.title || '参谋部首席人类副官',
          specialty: '全局参谋协理 · 现场调度',
          affection: 65,
          personaHint: '条理清晰、审慎务实',
        });
      }
    }
  }

  // 3. 扫描 bootChoices.factionAdjutants 与 bootChoices.staffAdjutant
  if (bootChoices?.factionAdjutants) {
    for (const [, fAdj] of Object.entries(bootChoices.factionAdjutants)) {
      if (!fAdj || fAdj.identity !== 'human') continue;
      const name = String(fAdj.name ?? '').trim();
      if (!name) continue;
      pushHuman({
        name,
        faction: 'other',
        roleTitle: fAdj.title || '随行人类副官',
        specialty: '现场统筹 · 战地协调',
        affection: 60,
        personaHint: '干练敏锐、贴身协理',
      });
    }
  }
  if (bootChoices?.staffAdjutant && bootChoices.staffAdjutant.enabled !== false) {
    const name = String(bootChoices.staffAdjutant.name ?? '').trim();
    if (name) {
      pushHuman({
        name,
        faction: 'other',
        roleTitle: bootChoices.staffAdjutant.title || '随行参谋副官',
        specialty: '现场参谋协理 · 行动规划',
        affection: 65,
        personaHint: '沉着干练、思虑周密',
      });
    }
  }

  return humans;
}

/**
 * 动态扫描 `forces.girls`、`command.unlocked_factions`、`command.adjutants` 与 `bootChoices.humanRoster`，
 * 并结合五阶战役状态机的通联门禁决议本轮参谋席阵容：
 * - 当处于 `prologue_unbound` 或 `silent_standby`（`!maidensCanProactivelySpeak`）时：
 *   严禁白凌、喀秋莎、尤里卡等 MCV 核心机娘列席，仅提取在场人类同伴或回退至「现场直觉」；
 * - 常规阶段：单阵营/1人 -> `mode: 'solo'`；多阵营/多人 -> `mode: 'ensemble'`。
 */
export function resolveStaffAdvisors(
  data: StatData,
  options?: StrategicFeedforwardOptions,
): StaffAdvisorRoster {
  const phaseRes = resolveCampaignPhase(data, options?.bootChoices, options?.preferences);
  const humanAdvisors = collectHumanAdvisors(data, options?.bootChoices);

  // 通联门禁：阶段0（原世界序章）与阶段1（被动静默待机）严禁 MCV 核心机娘主动列席
  if (!phaseRes.maidensCanProactivelySpeak) {
    if (humanAdvisors.length > 0) {
      const selectedHumans = humanAdvisors.slice(0, 3);
      return {
        mode: selectedHumans.length >= 2 ? 'ensemble' : 'solo',
        advisors: selectedHumans,
      };
    }
    return {
      mode: 'solo',
      advisors: [
        {
          name: '现场直觉',
          faction: 'other',
          roleTitle: '指挥官自身现场判断',
          specialty: '环境观察 · 现场决策',
          affection: 100,
          personaHint: '沉着审慎',
        },
      ],
    };
  }

  const girls = data.forces?.girls ?? [];
  const unlockedRaw = data.command?.unlocked_factions ?? ['allied'];
  const unlockedSet = new Set<'allied' | 'soviet' | 'yuri'>(['allied']);
  for (const f of unlockedRaw) {
    if (/苏|soviet/i.test(f)) unlockedSet.add('soviet');
    else if (/尤里|yuri/i.test(f)) unlockedSet.add('yuri');
    else if (/盟|allied/i.test(f)) unlockedSet.add('allied');
  }

  const advisors: StaffAdvisorProfile[] = [];
  const usedNames = new Set<string>();

  for (const fac of ['allied', 'soviet', 'yuri'] as const) {
    const def = FACTION_DEFAULT_ADVISORS[fac];
    const starter = FACTION_STARTER_MCV_MAP[fac];
    const matchedGirl = girls.find(g => inferGirlFactionKey(g) === fac);

    // 检查是否配置了 commander_self（主指挥官直辖，由阵营首发机娘协理）
    const rawAdjList = Array.isArray(data.command?.adjutants) ? data.command.adjutants : [];
    const isCommanderSelf =
      rawAdjList.some(a => a.faction === fac && a.identity === 'commander_self') ||
      options?.bootChoices?.factionAdjutants?.[fac]?.identity === 'commander_self';

    // 盟军默认始终有参谋席；苏联/尤里需已解锁阵营或已有对应机娘在编
    if (fac !== 'allied' && !unlockedSet.has(fac) && !matchedGirl && !isCommanderSelf) continue;
    const displayName = matchedGirl
      ? resolveGirlDisplayName(matchedGirl, def.defaultName)
      : def.defaultName;
    if (usedNames.has(canon(displayName))) continue;
    usedNames.add(canon(displayName));

    const traitsText =
      matchedGirl?.traits && matchedGirl.traits.length > 0
        ? matchedGirl.traits.slice(0, 3).join('、')
        : def.personaHint;

    const baseRoleTitle = matchedGirl?.duty ? `${def.roleTitle}（${matchedGirl.duty}）` : def.roleTitle;
    const roleTitle = isCommanderSelf ? `${baseRoleTitle}·统帅直辖协理` : baseRoleTitle;

    advisors.push({
      name: displayName,
      faction: fac,
      roleTitle,
      specialty: def.specialty,
      affection: typeof matchedGirl?.affection === 'number' ? matchedGirl.affection : 50,
      personaHint: matchedGirl?.personality ? `${matchedGirl.personality}｜${traitsText}` : traitsText,
      voiceTag: starter.voiceTag,
    });
  }

  // 若 forces.girls 中还有其他非三阵营模板的已授名机娘，且当前不足 2 人，可补充 1 名在岗机娘
  if (advisors.length < 2) {
    for (const g of girls) {
      const gName = resolveGirlDisplayName(g, '');
      if (!gName || usedNames.has(canon(gName))) continue;
      usedNames.add(canon(gName));
      advisors.push({
        name: gName,
        faction: inferGirlFactionKey(g),
        roleTitle: g.duty || '战地协理副官',
        specialty: '前线战术协同 · 机动支援',
        affection: typeof g.affection === 'number' ? g.affection : 50,
        personaHint: g.traits?.slice(0, 3).join('、') || g.personality || '干练敏锐',
      });
      if (advisors.length >= 3) break;
    }
  }

  // 若存在明确在岗的人类参谋副官/随行人员且总席位未满 4 人，允许补充列席
  for (const h of humanAdvisors) {
    if (advisors.length >= 4) break;
    if (usedNames.has(canon(h.name))) continue;
    usedNames.add(canon(h.name));
    advisors.push(h);
  }

  return {
    mode: advisors.length >= 2 ? 'ensemble' : 'solo',
    advisors,
  };
}

/* ═══════════════ 4. 模块 D：玩家意图对齐与慢热八维组合战术诊断引擎 ═══════════════ */

/**
 * 检查存档中是否已存在在建/暂停工程或航天资产（含发射设施、合同、在轨卫星、复用助推器）
 */
export function hasActiveEngineeringOrSpaceAssets(data: StatData | null | undefined): boolean {
  if (!data || typeof data !== 'object') return false;
  if ((data.projects ?? []).some(p => p && (p.status === '在建' || p.status === '暂停' || p.status === '完工'))) {
    return true;
  }
  if ((data.queues ?? []).some(q => q && (q.type === '改装' || (q.type as string) === '工程'))) {
    return true;
  }
  if (
    (data.space?.contracts?.length ?? 0) > 0 ||
    (data.space?.orbital_assets?.length ?? 0) > 0 ||
    (data.space?.reusable_boosters ?? 0) > 0
  ) {
    return true;
  }
  if (
    (data.bases ?? []).some(b =>
      (b.buildings ?? []).some(
        bd => bd.state !== '受损' && /航天发射|发射中心|发射场|发射港|发射平台/i.test(bd.name),
      ),
    )
  ) {
    return true;
  }
  return false;
}

/**
 * 判定参谋前馈是否放行长期工程（<工程>）与商业航天（<航天合同>）诊断与引导：
 * - 生产环境默认关闭（返回 false）；
 * - 当开启 DEV 调试模式（`debugEnabled === true`）、或存档中已有工程/航天资产、或玩家本轮输入明确下达【工程】/【航天】指令时放行（返回 true）。
 */
export function isEngineeringAndSpaceFeedforwardOpen(
  data: StatData | null | undefined,
  options?: {
    debugEnabled?: boolean;
    latestUserMessage?: string;
    prevData?: StatData | null;
  },
): boolean {
  if (options?.debugEnabled === true) return true;
  if (hasActiveEngineeringOrSpaceAssets(data)) return true;
  if (options?.prevData && hasActiveEngineeringOrSpaceAssets(options.prevData)) return true;
  const userMsg = String(options?.latestUserMessage ?? '').trim();
  if (
    userMsg &&
    /【工程】|【航天】|<工程>|<航天|巨构工程|立项工程|改装工程|航天合同|商业航天|发射合同|卫星发射|火箭发射/i.test(
      userMsg,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * 轻量识别玩家本轮输入消息中的行动意图倾向，返回一句话对齐提示。
 */
export function analyzeUserTurnIntent(latestUserMessage?: string): string {
  const text = String(latestUserMessage ?? '').trim();
  if (!text) return '';

  const tags: string[] = [];
  if (/穿越|跨界|传送|裂隙|通道|门扉|异界|转场|唤醒系统|绑定系统|激活系统|接入终端|呼叫白凌|呼叫喀秋莎|呼叫尤里卡/i.test(text)) {
    tags.push('跨界/转场推进');
  }
  if (/踏勘|勘探|侦察|侦查|探索|观察|地形|地质|岩土|水源|矿脉|周边|巡视|哨卡|迷雾|掩体|摸排/i.test(text)) {
    tags.push('环境踏勘/侦察');
  }
  if (/建造|扩建|展开|基地|发电|电厂|矿场|精炼|兵营|车厂|战车工厂|生产|排产|列装|科研|研究|立项|科技|协议|工程/i.test(text)) {
    tags.push('基建/排产/科研');
  }
  if (/日常|休息|整备|交谈|聊天|对话|询问|安慰|互动|用餐|散步|休整|商议|讨论|清点物资/i.test(text)) {
    tags.push('日常/整备互动');
  }

  if (tags.length === 0) {
    return '玩家本轮倾向「日常/整备互动与现场剧情推进」，参谋建议应顺应玩家当前节奏提供轻量辅助。';
  }
  return `玩家本轮倾向「${tags.join('、')}」，参谋建议应紧密对齐该方向，避免偏离玩家当前关注焦点。`;
}

/**
 * 识别玩家本轮输入中的「点名核查战术线报」或「点名介入/侦察宏观世界演变」意图（对齐 PdaTabIntel / PanelWorldEvolution / 楼层卡片按钮指令与自然语言点名）。
 */
export function detectUserIntelIntent(
  latestUserMessage?: string,
  intelPool?: ReadonlyArray<{
    title?: string;
    content?: string;
    chain?: string;
    scope?: string;
    status?: string;
    stage?: string;
  }>,
): UserIntelIntent {
  const text = String(latestUserMessage ?? '').trim();
  if (!text) {
    return { wantsIntelAction: false };
  }

  let targetedIntelTitle: string | undefined;
  let targetedWorldEvoTitle: string | undefined;

  // 1. 显式模板匹配：PdaTabIntel / 楼层卡片「核查【...】线报：「XXX」」或「【深挖情报链/深挖情报线索：XXX】」
  const explicitIntelMatch =
    text.match(/线报[：:]\s*[「『"“]([^」』"”]+)[」』"”]/) ??
    text.match(/【(?:深挖情报链|深挖情报线索|核查情报|情报核查)[：:]\s*([^】]+)】/);
  if (explicitIntelMatch?.[1]?.trim()) {
    targetedIntelTitle = explicitIntelMatch[1].trim();
  }

  // 2. 显式模板匹配：PanelWorldEvolution「【暗流侦察】针对宏观暗流「XXX」」或 PdaTabIntel「介入远方动向【XXX】」或「【顺应演进/强行干预：XXX】」
  const explicitEvoMatch =
    text.match(/宏观暗流\s*[「『"“]([^」』"”]+)[」』"”]/) ??
    text.match(/介入远方动向\s*【([^】]+)】/) ??
    text.match(/【(?:顺应演进|强行干预|暗流侦察|介入暗流)[：:]\s*([^】]+)】/);
  if (explicitEvoMatch?.[1]?.trim()) {
    targetedWorldEvoTitle = explicitEvoMatch[1].trim();
  }

  const hasIntelActionVerb =
    /核查|查明|深挖|核实|追查|线报|情报|侦察|介入|暗流|远方动向|顺应演进|强行干预/i.test(text);
  const msgCanon = canon(text);

  if (intelPool && intelPool.length > 0 && (hasIntelActionVerb || targetedIntelTitle || targetedWorldEvoTitle)) {
    for (const item of intelPool) {
      const itemChain = String((item as ChainAwareIntelItem).chain ?? '').trim();
      const label = String(item.title || item.content?.slice(0, 24) || itemChain || '').trim();
      const lCanon = canon(label);
      const cCanon = canon(itemChain);
      if ((!lCanon || lCanon.length < 2) && (!cCanon || cCanon.length < 2)) continue;

      if (item.scope === 'world') {
        if (
          !targetedWorldEvoTitle &&
          item.stage !== '平息' &&
          ((lCanon.length >= 2 && msgCanon.includes(lCanon)) ||
            (item.title && text.includes(item.title.trim())))
        ) {
          targetedWorldEvoTitle = label;
        }
      } else {
        if (
          !targetedIntelTitle &&
          item.status !== '已证伪' &&
          ((lCanon.length >= 2 && msgCanon.includes(lCanon)) ||
            (item.title && text.includes(item.title.trim())) ||
            (cCanon.length >= 2 && (msgCanon.includes(cCanon) || text.includes(itemChain))) ||
            (item.content && item.content.trim().length >= 4 && text.includes(item.content.trim().slice(0, 12))))
        ) {
          targetedIntelTitle = label;
        }
      }
    }
  }

  return {
    ...(targetedIntelTitle ? { targetedIntelTitle } : {}),
    ...(targetedWorldEvoTitle ? { targetedWorldEvoTitle } : {}),
    wantsIntelAction: Boolean(targetedIntelTitle || targetedWorldEvoTitle || hasIntelActionVerb),
  };
}

const PRIORITY_WEIGHT: Record<TacticalComboPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
};

function resolveBaseDisplayName(data: StatData, baseRef?: string): string | undefined {
  const trimmed = String(baseRef ?? '').trim();
  if (trimmed) {
    const matched = (data.bases ?? []).find(b => b.id === trimmed || b.name === trimmed);
    return matched?.name || trimmed;
  }
  return data.bases?.[0]?.name;
}

function isGirlBirthEligibleForUnit(
  unitName: string,
  data: StatData,
  catalog?: EffectiveCatalog | null,
): boolean {
  const cleanUnit = String(unitName ?? '').trim();
  if (!cleanUnit) return false;
  if (/弹药|炮弹|导弹|备件|口粮|组件|模块|部件|芯级|助推器/.test(cleanUnit)) {
    return false;
  }
  const prodDef = (catalog?.productions ?? []).find(p => canon(p.name) === canon(cleanUnit));
  const prodCat = (prodDef as { category?: string } | undefined)?.category;
  if (prodCat === 'component' || prodCat === 'equipment' || prodCat === 'doctrine') {
    return false;
  }

  const candidateKeys = new Set<string>([canon(cleanUnit)]);
  for (const alias of prodDef?.aliases ?? []) {
    const k = canon(alias);
    if (k) candidateKeys.add(k);
  }
  const isMcvUnit = /机动建设车|基地车|\bMCV\b/i.test(cleanUnit);

  for (const g of data.forces?.girls ?? []) {
    if (isMcvUnit && (MCV_MAIDEN_NAME_RE.test(g.name ?? '') || /机动建设车|基地车|\bMCV\b/i.test(g.model ?? ''))) {
      return false;
    }
    const gFields = [g.model, g.name, g.callsign, g.serial]
      .map(s => canon(String(s ?? '')))
      .filter(Boolean);
    for (const key of candidateKeys) {
      if (!key) continue;
      for (const gf of gFields) {
        if (gf === key || gf.includes(key) || (gf.length >= 2 && key.includes(gf))) {
          return false;
        }
      }
    }
  }
  return true;
}

function deriveUnlockedHighlightsForBuilding(
  buildingName: string,
  data: StatData,
  catalog?: EffectiveCatalog | null,
): string[] {
  const highlights: string[] = [];
  const seen = new Set<string>();
  const bCanon = canon(buildingName);

  const pushHighlight = (label: string) => {
    const clean = String(label ?? '').trim();
    if (!clean) return;
    const k = canon(clean);
    if (!k || k === bCanon || seen.has(k)) return;
    seen.add(k);
    highlights.push(clean);
  };

  const genericTags: string[] = [];
  if (/兵营/i.test(buildingName)) genericTags.push('兵营');
  if (/战车工厂|车厂/i.test(buildingName)) genericTags.push('战车工厂', '车厂');
  if (/精炼厂|矿场|采矿/i.test(buildingName)) genericTags.push('矿石精炼厂', '精炼厂', '矿场');
  if (/发电厂|反应炉|电站/i.test(buildingName)) genericTags.push('发电厂', '反应炉');
  if (/空军指挥部|空指部|雷达/i.test(buildingName)) genericTags.push('空军指挥部', '空指部', '雷达');
  if (/建造厂|基地车|\bMCV\b/i.test(buildingName)) genericTags.push('建造厂');
  if (/船厂|造船厂|船坞/i.test(buildingName)) genericTags.push('造船厂', '船厂');
  if (/实验室|科技中心/i.test(buildingName)) genericTags.push('作战实验室', '实验室');
  if (/维修|修理厂|机库/i.test(buildingName)) genericTags.push('维修厂', '修理厂');

  const matchesBuildingReq = (reqRaw: string): boolean => {
    const rCanon = canon(reqRaw);
    if (!rCanon) return false;
    if (rCanon === bCanon || bCanon.includes(rCanon) || rCanon.includes(bCanon)) return true;
    return genericTags.some(tag => {
      const tCanon = canon(tag);
      return rCanon === tCanon || rCanon.includes(tCanon) || tCanon.includes(rCanon);
    });
  };

  for (const prod of catalog?.productions ?? []) {
    const reqs = [...(prod.need_buildings ?? []), ...(prod.need_building ? [prod.need_building] : [])];
    if (reqs.some(matchesBuildingReq)) {
      pushHighlight(prod.name);
    }
  }

  for (const bld of catalog?.buildings ?? []) {
    const reqs = [...(bld.need_buildings ?? []), ...(bld.need_building ? [bld.need_building] : [])];
    if (reqs.some(matchesBuildingReq)) {
      pushHighlight(bld.name);
    }
  }

  for (const res of catalog?.researches ?? []) {
    const reqs = res.need_buildings ?? [];
    if (reqs.some(matchesBuildingReq)) {
      pushHighlight(res.name);
    }
  }

  for (const bp of data.codex ?? []) {
    if ((bp.kind === '人员' || bp.kind === '载具') && bp.params?.['前置']) {
      if (matchesBuildingReq(bp.params['前置'])) {
        pushHighlight(bp.name);
      }
    }
  }

  // 母体建筑静态回退规则（保证静态目录为空时依然输出高价值下游解锁）
  if (/兵营/i.test(buildingName)) {
    ['步兵产线', '动员兵/美国大兵', '战斗工程师', '防空/重装步兵'].forEach(pushHighlight);
  } else if (/战车工厂|车厂/i.test(buildingName)) {
    ['装甲载具产线', '多功能步兵车', '灰熊/犀牛主战坦克', '武装采矿车'].forEach(pushHighlight);
  } else if (/精炼厂|矿场|采矿/i.test(buildingName)) {
    ['矿石精炼日息产线', '战车工厂', '雷达/空指部'].forEach(pushHighlight);
  } else if (/空军指挥部|空指部|雷达|通信|通讯/i.test(buildingName)) {
    ['航空产线与雷达侦察', '入侵者战机/夜鹰直升机', '高阶战术科研'].forEach(pushHighlight);
  } else if (/发电厂|反应炉|电站/i.test(buildingName)) {
    ['矿石精炼厂', '兵营', '基地并网供电冗余'].forEach(pushHighlight);
  } else if (/建造厂|基地车|\bMCV\b/i.test(buildingName)) {
    ['发电厂', '矿石精炼厂', '兵营', '战车工厂'].forEach(pushHighlight);
  } else if (/船厂|造船厂|船坞/i.test(buildingName)) {
    ['海军舰艇产线', '驱逐舰/神盾巡洋舰', '两栖运输艇'].forEach(pushHighlight);
  } else if (/维修|修理厂|机库/i.test(buildingName)) {
    ['载具战地抢修', '现代化改装产线'].forEach(pushHighlight);
  } else if (/实验室|科技中心/i.test(buildingName)) {
    ['T2/T3高阶科技研发', '特种战略协议攻关', '王牌决战兵器产线'].forEach(pushHighlight);
  }

  return highlights.slice(0, 4);
}

function deriveUnlockedHighlightsForTech(
  techDisplayName: string,
  rawTechKey: string,
  catalog?: EffectiveCatalog | null,
): string[] {
  const highlights: string[] = [];
  const seen = new Set<string>();
  const tCanon = canon(techDisplayName);
  const rawCanon = canon(rawTechKey);

  const pushHighlight = (label: string) => {
    const clean = String(label ?? '').trim();
    if (!clean) return;
    const k = canon(clean);
    if (!k || k === tCanon || k === rawCanon || seen.has(k)) return;
    seen.add(k);
    highlights.push(clean);
  };

  const resDef = (catalog?.researches ?? []).find(
    r =>
      canon(r.name) === tCanon ||
      canon(r.name) === rawCanon ||
      canon(String((r as { id?: string }).id ?? '')) === rawCanon,
  );
  if (resDef?.unlocks) {
    for (const part of resDef.unlocks.split(/[,，、/；;|｜+]+/)) {
      pushHighlight(part);
    }
  }

  const matchesTech = (req: string) => {
    const rc = canon(req);
    return Boolean(rc && (rc === tCanon || rc === rawCanon));
  };

  for (const prod of catalog?.productions ?? []) {
    if ((prod.prereqs ?? []).some(matchesTech)) pushHighlight(prod.name);
  }
  for (const bld of catalog?.buildings ?? []) {
    if ((bld.prereqs ?? []).some(matchesTech) || (bld.research && matchesTech(bld.research))) {
      pushHighlight(bld.name);
    }
  }
  for (const nextRes of catalog?.researches ?? []) {
    if ((nextRes.prereqs ?? []).some(matchesTech)) pushHighlight(nextRes.name);
  }
  for (const retro of catalog?.retrofits ?? []) {
    if (retro.research && matchesTech(retro.research)) pushHighlight(retro.name);
  }

  return highlights.slice(0, 4);
}

function deriveUnlockedHighlightsForProtocol(
  protoRef: string,
  protoName: string,
  catalog?: EffectiveCatalog | null,
): string[] {
  const highlights: string[] = [];
  const seen = new Set<string>();
  const refCanon = canon(protoRef);
  const nameCanon = canon(protoName);

  const pushHighlight = (label: string) => {
    const clean = String(label ?? '').trim();
    if (!clean) return;
    const k = canon(clean);
    if (!k || k === refCanon || k === nameCanon || seen.has(k)) return;
    seen.add(k);
    highlights.push(clean);
  };

  const pDef = (catalog?.protocols ?? []).find(
    p => canon(p.id) === refCanon || canon(p.name) === nameCanon || canon(p.name) === refCanon,
  );
  for (const rev of pDef?.reveals ?? []) {
    const matchedRes = (catalog?.researches ?? []).find(
      r => canon(r.name) === canon(rev) || canon(String((r as { id?: string }).id ?? '')) === canon(rev),
    );
    pushHighlight(matchedRes?.name || rev);
  }

  const matchesProto = (req: string) => {
    const rc = canon(req);
    return Boolean(rc && (rc === refCanon || rc === nameCanon));
  };

  for (const res of catalog?.researches ?? []) {
    if ((res.prereqs ?? []).some(matchesProto)) pushHighlight(res.name);
  }
  for (const prod of catalog?.productions ?? []) {
    if ((prod.prereqs ?? []).some(matchesProto)) pushHighlight(prod.name);
  }
  for (const bld of catalog?.buildings ?? []) {
    if ((bld.prereqs ?? []).some(matchesProto)) pushHighlight(bld.name);
  }

  return highlights.slice(0, 4);
}

/**
 * FD-45：全链路完工与待收讫里程碑纯函数推导（#N-1 vs #N Diff + 同楼队列兜底 + 下游解锁推演 + 机魂初诞判定）
 */
export function deriveCompletionMilestones(
  data: StatData,
  catalog: EffectiveCatalog,
  prevData?: StatData | null,
): CompletionMilestonesSummary {
  const settlingItems: CompletionMilestoneEntry[] = [];
  const completedItems: CompletionMilestoneEntry[] = [];

  if (!data || typeof data !== 'object') {
    return { settlingItems, completedItems };
  }

  // ── A. 待交割收讫项 (settlingItems) ──
  for (const q of data.queues ?? []) {
    if (q.status !== 'settling') continue;
    // 若 type === '建造' 且已由 FD-38 自动转正完毕，则归入 completedItems 而非 settlingItems
    if (q.type === '建造' && (q.building_delivered_qty ?? 0) >= (q.qty || 1)) {
      continue;
    }
    const baseName = resolveBaseDisplayName(data, q.base);
    const domain: CompletionMilestoneEntry['domain'] =
      q.type === '建造'
        ? 'building'
        : q.type === '生产'
          ? 'unit'
          : q.type === '研究'
            ? 'tech'
            : 'project';
    const qty = q.qty || 1;
    const title =
      q.type === '建造'
        ? `${baseName ? `基地「${baseName}」：` : ''}建造「${q.item}」${qty > 1 ? `×${qty}` : ''}`
        : q.type === '生产'
          ? `${baseName ? `基地「${baseName}」：` : ''}生产「${q.item}」×${qty}`
          : q.type === '研究'
            ? `科研攻关「${q.item}」`
            : `${baseName ? `基地「${baseName}」：` : ''}工程「${q.item}」`;
    const detail =
      qty > 1 && (q.qty_done ?? 0) > 0
        ? `已下线 ${q.qty_done}/${qty}，进度 ${Math.round(q.progress ?? 100)}% 装配就绪`
        : `进度 ${Math.round(q.progress ?? 100)}% 已达标就绪`;
    const girlBirthEligible =
      q.type === '生产' ? isGirlBirthEligibleForUnit(q.item, data, catalog) : false;

    settlingItems.push({
      state: 'settling',
      domain,
      title,
      ...(baseName ? { baseName } : {}),
      detail,
      unlockedHighlights: [],
      girlBirthEligible,
    });
  }

  // ── B. 本轮刚竣工/突破/入账项 (completedItems) ──

  // B1. 建筑与新基地 (domain: 'building')
  const seenBuildings = new Set<string>();
  if (prevData) {
    const prevBases = prevData.bases ?? [];
    for (const base of data.bases ?? []) {
      if (base.status === '废弃') continue;
      const prevBase = prevBases.find(
        pb => (pb.id && pb.id === base.id) || (pb.name && canon(pb.name) === canon(base.name)),
      );
      if (!prevBase) {
        const firstBld = base.buildings?.[0]?.name || '建造厂';
        completedItems.push({
          state: 'just_completed',
          domain: 'building',
          baseName: base.name,
          title: `新基地「${base.name}」展开落成`,
          detail: `${base.location ? `选址：${base.location}｜` : ''}基地已并网运转`,
          unlockedHighlights: deriveUnlockedHighlightsForBuilding(firstBld, data, catalog),
          girlBirthEligible: false,
        });
        for (const bld of base.buildings ?? []) {
          if (bld.state === '运转') {
            seenBuildings.add(`${canon(base.id || base.name)}::${canon(bld.name)}`);
            seenBuildings.add(`${canon(base.name)}::${canon(bld.name)}`);
          }
        }
        continue;
      }

      // 对比同一基地内运转建筑增量或从建造中转正的建筑
      const prevRunningCounts = new Map<string, number>();
      for (const pbld of prevBase.buildings ?? []) {
        if (pbld.state === '运转') {
          const k = canon(pbld.name);
          prevRunningCounts.set(k, (prevRunningCounts.get(k) ?? 0) + 1);
        }
      }
      const currRunningCounts = new Map<string, { displayName: string; count: number }>();
      for (const cbld of base.buildings ?? []) {
        if (cbld.state === '运转') {
          const k = canon(cbld.name);
          const existing = currRunningCounts.get(k);
          currRunningCounts.set(k, {
            displayName: cbld.name,
            count: (existing?.count ?? 0) + 1,
          });
        }
      }

      for (const [k, info] of currRunningCounts.entries()) {
        const prevCount = prevRunningCounts.get(k) ?? 0;
        if (info.count > prevCount) {
          const delta = info.count - prevCount;
          seenBuildings.add(`${canon(base.id || base.name)}::${k}`);
          seenBuildings.add(`${canon(base.name)}::${k}`);
          completedItems.push({
            state: 'just_completed',
            domain: 'building',
            baseName: base.name,
            title: `基地「${base.name}」新落成建筑【${info.displayName}】${delta > 1 ? `×${delta}` : ''}`,
            detail: '已并网运转',
            unlockedHighlights: deriveUnlockedHighlightsForBuilding(info.displayName, data, catalog),
            girlBirthEligible: false,
          });
        }
      }
    }
  }

  // B1 同楼内队列兜底：type === '建造' 且 (status === 'done' || (status === 'settling' && building_delivered_qty > 0))
  for (const q of data.queues ?? []) {
    if (q.type !== '建造') continue;
    const deliveredQty = q.building_delivered_qty ?? 0;
    const isCompletedBuild = q.status === 'done' || (q.status === 'settling' && deliveredQty > 0);
    if (!isCompletedBuild) continue;

    const baseName = resolveBaseDisplayName(data, q.base) || '主基地';
    const dedupKey = `${canon(baseName)}::${canon(q.item)}`;
    const rawKey = `${canon(q.base || baseName)}::${canon(q.item)}`;
    if (seenBuildings.has(dedupKey) || seenBuildings.has(rawKey)) continue;
    seenBuildings.add(dedupKey);
    seenBuildings.add(rawKey);

    const qtyCount = q.status === 'done' ? q.qty || 1 : deliveredQty;
    completedItems.push({
      state: 'just_completed',
      domain: 'building',
      baseName,
      title: `基地「${baseName}」新落成建筑【${q.item}】${qtyCount > 1 ? `×${qtyCount}` : ''}`,
      detail: '已并网运转',
      unlockedHighlights: deriveUnlockedHighlightsForBuilding(q.item, data, catalog),
      girlBirthEligible: false,
    });
  }

  // B2. 单位下线与改装升格 (domain: 'unit')
  const seenUnits = new Set<string>();
  if (prevData) {
    const prevTroops = prevData.forces?.troops ?? {};
    const currTroops = data.forces?.troops ?? {};
    for (const [uName, count] of Object.entries(currTroops)) {
      const currN = typeof count === 'number' ? count : 0;
      const prevN = typeof prevTroops[uName] === 'number' ? prevTroops[uName] : 0;
      if (currN > prevN) {
        const delta = currN - prevN;
        const uKey = canon(uName);
        seenUnits.add(uKey);
        completedItems.push({
          state: 'just_completed',
          domain: 'unit',
          title: `新下线兵种「${uName}」×${delta}`,
          detail: `现役共计 ${currN} 人，已编入战区序列`,
          unlockedHighlights: [],
          girlBirthEligible: isGirlBirthEligibleForUnit(uName, data, catalog),
        });
      }
    }

    const extractUnitArray = (state: StatData): string[] => {
      const vehs = state.forces?.vehicles ?? [];
      const extraAir = (state.forces as unknown as { aircraft?: string[] } | undefined)?.aircraft;
      return Array.isArray(extraAir) ? [...vehs, ...extraAir] : [...vehs];
    };

    const prevUnitList = extractUnitArray(prevData);
    const currUnitList = extractUnitArray(data);
    const prevUnitCounts = new Map<string, number>();
    for (const v of prevUnitList) {
      const k = canon(v);
      if (k) prevUnitCounts.set(k, (prevUnitCounts.get(k) ?? 0) + 1);
    }
    const currUnitCounts = new Map<string, { displayName: string; count: number }>();
    for (const v of currUnitList) {
      const k = canon(v);
      if (!k) continue;
      const existing = currUnitCounts.get(k);
      currUnitCounts.set(k, {
        displayName: v,
        count: (existing?.count ?? 0) + 1,
      });
    }

    for (const [k, info] of currUnitCounts.entries()) {
      const prevN = prevUnitCounts.get(k) ?? 0;
      if (info.count > prevN && !seenUnits.has(k)) {
        const delta = info.count - prevN;
        seenUnits.add(k);
        completedItems.push({
          state: 'just_completed',
          domain: 'unit',
          title: `新列装单位「${info.displayName}」×${delta}`,
          detail: `现役在编 ${info.count} 台，已完成实机入账`,
          unlockedHighlights: [],
          girlBirthEligible: isGirlBirthEligibleForUnit(info.displayName, data, catalog),
        });
      }
    }
  }

  // B2 同楼内队列兜底：type === '生产' && status === 'done'
  for (const q of data.queues ?? []) {
    if (q.type !== '生产' || q.status !== 'done') continue;
    const uKey = canon(q.item);
    if (!uKey || seenUnits.has(uKey)) continue;
    seenUnits.add(uKey);
    const baseName = resolveBaseDisplayName(data, q.base);
    completedItems.push({
      state: 'just_completed',
      domain: 'unit',
      ...(baseName ? { baseName } : {}),
      title: `${baseName ? `基地「${baseName}」` : ''}新列装单位「${q.item}」×${q.qty || 1}`,
      detail: '已完成生产入账',
      unlockedHighlights: [],
      girlBirthEligible: isGirlBirthEligibleForUnit(q.item, data, catalog),
    });
  }

  // B3. 科技完成 (domain: 'tech')
  const seenTechs = new Set<string>();
  const resolveTechName = (idOrName: string): string => {
    const matched = (catalog?.researches ?? []).find(
      r =>
        canon(r.name) === canon(idOrName) ||
        canon(String((r as { id?: string }).id ?? '')) === canon(idOrName),
    );
    return matched?.name || idOrName;
  };

  if (prevData) {
    const prevTechSet = new Set((prevData.tech?.done ?? []).map(t => canon(t)));
    for (const rawTech of data.tech?.done ?? []) {
      const k = canon(rawTech);
      if (!k || prevTechSet.has(k) || seenTechs.has(k)) continue;
      const displayName = resolveTechName(rawTech);
      seenTechs.add(k);
      seenTechs.add(canon(displayName));
      completedItems.push({
        state: 'just_completed',
        domain: 'tech',
        title: `新突破科技《${displayName}》`,
        detail: '已完成研发定型并入技术档案',
        unlockedHighlights: deriveUnlockedHighlightsForTech(displayName, rawTech, catalog),
        girlBirthEligible: false,
      });
    }
  }

  for (const q of data.queues ?? []) {
    if (q.type !== '研究' || q.status !== 'done') continue;
    const displayName = resolveTechName(q.item);
    if (seenTechs.has(canon(q.item)) || seenTechs.has(canon(displayName))) continue;
    seenTechs.add(canon(q.item));
    seenTechs.add(canon(displayName));
    completedItems.push({
      state: 'just_completed',
      domain: 'tech',
      title: `新突破科技《${displayName}》`,
      detail: '已完成研发定型并入技术档案',
      unlockedHighlights: deriveUnlockedHighlightsForTech(displayName, q.item, catalog),
      girlBirthEligible: false,
    });
  }

  // B4. 协议突破定型 (domain: 'protocol')
  const seenProtocols = new Set<string>();
  const currentDay = data.clock?.day ?? data.meta?.day_count;
  for (const p of data.protocols ?? []) {
    if (p.status !== 'active') continue;
    const rawRef = ('ref' in p && p.ref ? p.ref : 'id' in p ? p.id : '') || '';
    const rawName = ('name' in p && p.name ? p.name : '') || '';
    const protoKey = canon(rawRef || rawName);
    if (!protoKey || seenProtocols.has(protoKey)) continue;

    const lastResult = 'last_result' in p ? p.last_result : undefined;
    const isBreakthroughToday =
      lastResult?.outcome === 'breakthrough' &&
      (currentDay === undefined || lastResult.day === currentDay);

    let wasInactiveInPrev = false;
    if (prevData) {
      const prevProto = (prevData.protocols ?? []).find(pp => {
        const ppRef = ('ref' in pp && pp.ref ? pp.ref : 'id' in pp ? pp.id : '') || '';
        const ppName = ('name' in pp && pp.name ? pp.name : '') || '';
        return canon(ppRef || ppName) === protoKey;
      });
      if (prevProto && prevProto.status !== 'active') {
        wasInactiveInPrev = true;
      }
    }

    if (!isBreakthroughToday && !wasInactiveInPrev) continue;
    seenProtocols.add(protoKey);

    const catProto = (catalog?.protocols ?? []).find(
      cp => canon(cp.id) === canon(rawRef) || canon(cp.name) === canon(rawName || rawRef),
    );
    const displayName =
      rawName || catProto?.name || resolveLegacyProtocolName(rawRef) || rawRef;

    completedItems.push({
      state: 'just_completed',
      domain: 'protocol',
      title: `新定型战略协议《${displayName}》`,
      detail: '实验攻关突破（经验 100%），正式定型生效',
      unlockedHighlights: deriveUnlockedHighlightsForProtocol(rawRef, displayName, catalog),
      girlBirthEligible: false,
    });
  }

  // B5. 重大工程阶段/整项完工 (domain: 'project')
  for (const proj of data.projects ?? []) {
    const baseName = resolveBaseDisplayName(data, proj.lead_base);
    const prevProj = (prevData?.projects ?? []).find(
      pp => pp.id === proj.id || canon(pp.ref) === canon(proj.ref),
    );
    const retroDef = (catalog?.retrofits ?? []).find(
      r =>
        canon(r.name) === canon(proj.ref) ||
        canon(String((r as { id?: string }).id ?? '')) === canon(proj.ref),
    );
    const projDef = (catalog?.projects ?? []).find(
      p => canon(p.name) === canon(proj.ref) || canon(p.id) === canon(proj.ref),
    );

    if (proj.status === '完工') {
      if (prevData && (!prevProj || prevProj.status !== '完工')) {
        const highlights: string[] = [];
        if (typeof retroDef?.upgraded_name === 'string' && retroDef.upgraded_name.trim()) {
          highlights.push(retroDef.upgraded_name.trim());
        }
        completedItems.push({
          state: 'just_completed',
          domain: 'project',
          ...(baseName ? { baseName } : {}),
          title: `${baseName ? `基地「${baseName}」：` : ''}重大工程「${proj.ref}」全面竣工`,
          detail: `工程（${proj.id}）全部阶段已正式竣工交付`,
          unlockedHighlights: highlights.slice(0, 4),
          girlBirthEligible: false,
        });
      }
      continue;
    }

    if (proj.status === '在建') {
      if ('phases' in proj && Array.isArray(proj.phases)) {
        const phases = proj.phases;
        const prevPhases =
          prevProj && 'phases' in prevProj && Array.isArray(prevProj.phases)
            ? prevProj.phases
            : [];
        const newlyDonePhases = prevData
          ? phases.filter(ph => {
              if (ph.status !== '完工') return false;
              const prevPh = prevPhases.find(p => p.idx === ph.idx || p.name === ph.name);
              return !prevPh || prevPh.status !== '完工';
            })
          : [];
        const donePhases = phases.filter(ph => ph.status === '完工');
        const hasRunningPhase = phases.some(
          ph => ph.status === '进行中' || (ph.status as string) === '在建',
        );
        const nextPendingPhase = phases.find(ph => ph.status === '未启动');

        if (
          newlyDonePhases.length > 0 ||
          (donePhases.length > 0 && !hasRunningPhase && Boolean(nextPendingPhase))
        ) {
          const donePh =
            newlyDonePhases[newlyDonePhases.length - 1] ?? donePhases[donePhases.length - 1];
          const donePhName = donePh.name || `阶段 #${donePh.idx}`;
          const nextPhName = nextPendingPhase
            ? nextPendingPhase.name || `阶段 #${nextPendingPhase.idx}`
            : '';
          const nextCost = nextPendingPhase
            ? (retroDef?.phases?.[nextPendingPhase.idx]?.cost ??
              (nextPendingPhase as unknown as { cost?: number }).cost)
            : undefined;
          const costClause =
            typeof nextCost === 'number' && nextCost > 0 ? `（需经费 ${nextCost} 点）` : '';

          completedItems.push({
            state: 'just_completed',
            domain: 'project',
            ...(baseName ? { baseName } : {}),
            title: `${baseName ? `基地「${baseName}」：` : ''}工程「${proj.ref}」阶段「${donePhName}」已完工`,
            detail: nextPendingPhase
              ? `下一阶段「${nextPhName}」待注资启动${costClause}`
              : `工程阶段节点已达成`,
            unlockedHighlights: nextPhName ? [nextPhName] : [],
            girlBirthEligible: false,
          });
        }
      } else if ('modules' in proj && Array.isArray(proj.modules)) {
        const modules = proj.modules;
        const prevModules =
          prevProj && 'modules' in prevProj && Array.isArray(prevProj.modules)
            ? prevProj.modules
            : [];
        const newlyDoneMods = prevData
          ? modules.filter(m => {
              if (m.status !== '完工') return false;
              const prevM = prevModules.find(pm => pm.id === m.id || pm.name === m.name);
              return !prevM || prevM.status !== '完工';
            })
          : [];
        const doneMods = modules.filter(m => m.status === '完工');
        const hasRunningMod = modules.some(
          m => m.status === '进行中' || (m.status as string) === '在建',
        );
        const nextPendingMod = modules.find(m => m.status === '未启动');

        if (
          newlyDoneMods.length > 0 ||
          (doneMods.length > 0 && !hasRunningMod && Boolean(nextPendingMod))
        ) {
          const doneMod =
            newlyDoneMods[newlyDoneMods.length - 1] ?? doneMods[doneMods.length - 1];
          const doneModName = doneMod.name || doneMod.id;
          const nextModName = nextPendingMod ? nextPendingMod.name || nextPendingMod.id : '';
          const nextCost = nextPendingMod
            ? (projDef?.modules?.find(
                m => m.id === nextPendingMod.id || m.name === nextPendingMod.name,
              )?.cost ?? (nextPendingMod as unknown as { cost?: number }).cost)
            : undefined;
          const costClause =
            typeof nextCost === 'number' && nextCost > 0 ? `（需经费 ${nextCost} 点）` : '';

          completedItems.push({
            state: 'just_completed',
            domain: 'project',
            ...(baseName ? { baseName } : {}),
            title: `${baseName ? `基地「${baseName}」：` : ''}工程「${proj.ref}」舱段「${doneModName}」已完工`,
            detail: nextPendingMod
              ? `下一舱段「${nextModName}」待注资启动${costClause}`
              : `已完工 ${doneMods.length}/${modules.length} 舱段`,
            unlockedHighlights: nextModName ? [nextModName] : [],
            girlBirthEligible: false,
          });
        }
      }
    }
  }

  // B6. 航天发射入轨 (domain: 'space')
  if (prevData) {
    const prevContracts = prevData.space?.contracts ?? [];
    for (const c of data.space?.contracts ?? []) {
      if (c.status !== 'completed') continue;
      const prevC = prevContracts.find(
        pc => pc.id === c.id || canon(pc.title) === canon(c.title),
      );
      if (!prevC || prevC.status !== 'completed') {
        const baseName = resolveBaseDisplayName(data, c.base);
        completedItems.push({
          state: 'just_completed',
          domain: 'space',
          ...(baseName ? { baseName } : {}),
          title: `航天发射合同「${c.title}」圆满入轨`,
          detail: `载荷「${c.payload}」（轨道：${c.orbit || 'LEO'}）已完成入轨交割`,
          unlockedHighlights: [],
          girlBirthEligible: false,
        });
      }
    }
  }

  // B7. 作战任务完结交割 (domain: 'quest')
  if (prevData) {
    const prevActiveSet = new Set((prevData.quests?.active ?? []).map(q => canon(q.name)));
    const prevDoneHistorySet = new Set(
      (prevData.quests?.history ?? [])
        .filter(q => q.status === '已完成')
        .map(q => canon(q.name)),
    );
    const seenQuests = new Set<string>();
    for (const q of data.quests?.history ?? []) {
      if (q.status !== '已完成') continue;
      const qKey = canon(q.name);
      if (!qKey || seenQuests.has(qKey)) continue;
      const wasActiveInPrev = prevActiveSet.has(qKey);
      const wasNotDoneInPrevHistory = !prevDoneHistorySet.has(qKey);
      if (!wasActiveInPrev && !wasNotDoneInPrevHistory) continue;
      seenQuests.add(qKey);

      const questHighlights: string[] = [];
      for (const fac of q.rewards?.unlock_factions ?? []) {
        const clean = String(fac ?? '').trim();
        if (clean && !questHighlights.includes(clean)) questHighlights.push(clean);
      }
      for (const u of q.rewards?.unlock_units ?? []) {
        const clean = String(u?.name ?? '').trim();
        if (clean && !questHighlights.includes(clean)) questHighlights.push(clean);
      }

      const cq = q as ChainAwareQuest;
      const seriesLabel = cq.series ? `《${cq.series}》` : '';
      const stepLabel = cq.chain_step ? `(${cq.chain_step})` : cq.series ? '(阶段完结)' : '';
      const nextLabel = cq.next_quest ? ` -> 下一环线索：${cq.next_quest}` : '';
      const chainSuffix =
        seriesLabel || stepLabel || nextLabel
          ? `｜系列：${seriesLabel}${stepLabel}${nextLabel}`
          : '';

      completedItems.push({
        state: 'just_completed',
        domain: 'quest',
        title: `作战任务「${q.name}」达成完结`,
        detail: `悬赏已交割：${formatQuestRewardCompact(q.rewards) || '战区悬赏已并入主库'}${chainSuffix}`,
        unlockedHighlights: questHighlights.slice(0, 4),
        girlBirthEligible: false,
      });
    }
  }

  // B8. 战区情报核实水落石出 (domain: 'intel' · FD-50)
  if (prevData) {
    const prevTacticalIntel = ((prevData.intel ?? []) as ChainAwareIntelItem[]).filter(
      it => it && it.scope !== 'world',
    );
    const seenIntelKeys = new Set<string>();

    for (const rawIt of (data.intel ?? []) as ChainAwareIntelItem[]) {
      if (!rawIt || rawIt.scope === 'world' || rawIt.status === '已证伪') continue;
      const isVerified = rawIt.status === '已证实' || rawIt.cred === '高';
      if (!isVerified) continue;

      const titleLabel = String(rawIt.title || rawIt.content.slice(0, 20) || '').trim();
      const chainLabel = String(rawIt.chain ?? '').trim();
      const stepLabel = String(rawIt.chain_step ?? '').trim();
      const evoLabel = String(rawIt.evolves_from ?? '').trim();
      const leadLabel = String(rawIt.next_lead ?? rawIt.hook ?? '').trim();

      const dedupKey = canon(chainLabel || titleLabel);
      if (!dedupKey || seenIntelKeys.has(dedupKey)) continue;

      const matchedPrev = prevTacticalIntel.find(prev => {
        if (rawIt.id && prev.id && rawIt.id === prev.id) return true;
        if (chainLabel && prev.chain && canon(prev.chain) === canon(chainLabel)) return true;
        if (evoLabel && prev.title && canon(prev.title) === canon(evoLabel)) return true;
        if (titleLabel && prev.title && canon(prev.title) === canon(titleLabel)) return true;
        return false;
      });

      const wasUnverifiedInPrev = matchedPrev
        ? matchedPrev.status !== '已证实' && matchedPrev.cred !== '高'
        : Boolean(chainLabel || stepLabel || evoLabel);

      if (!wasUnverifiedInPrev) continue;
      seenIntelKeys.add(dedupKey);

      const srcLabel = String(rawIt.src_kind || rawIt.src || '战区侦察').trim();
      const chainPart = chainLabel
        ? `｜情报链：《${chainLabel}》${stepLabel ? `(${stepLabel})` : ''}`
        : stepLabel
          ? `｜阶数：(${stepLabel})`
          : '';
      const leadPart = leadLabel ? `｜战略转化线索：${leadLabel}` : '';

      completedItems.push({
        state: 'just_completed',
        domain: 'intel',
        title: `战区情报「${titleLabel}」核实水落石出`,
        detail: `渠道：${srcLabel}（高·已证实）${chainPart}${leadPart}`,
        unlockedHighlights: [],
        girlBirthEligible: false,
      });
    }
  }

  return {
    settlingItems: settlingItems.slice(0, 4),
    completedItems: completedItems.slice(0, 6),
  };
}

/**
 * 对当前 `stat_data` 与 `EffectiveCatalog` 进行确定性八维交叉组合分析，
 * 支持五阶战役阶段感知、慢热踏勘措辞、15日跨系磨合代价检查及 `story_first` 免打扰过滤。
 */
export function analyzeTacticalCombos(
  data: StatData,
  catalog: EffectiveCatalog,
  options?: AnalyzeTacticalCombosOptions,
): TacticalComboFinding[] {
  const phaseRes = resolveCampaignPhase(data, options?.bootChoices, options?.preferences);
  const phase = options?.campaignPhase ?? phaseRes.phase;
  const pacingMode: FeedforwardPacingMode =
    options?.preferences?.pacingMode ??
    (options?.bootChoices != null ? DEFAULT_FEEDFORWARD_PREFERENCES.pacingMode : 'balanced');

  // ── 阶段0（原世界未穿越零系统）：不生成任何 MCV/基建/科研催促诊断，仅生成 1 条节奏锁诊断 ──
  if (phase === 'prologue_unbound') {
    return [
      {
        category: 'standby_mcv_and_factions',
        priority: 'P0',
        focusTag: '原世界序章',
        title: '停留在原世界穿越前夕现场（系统尚未绑定）',
        diagnosis:
          '当前处于原世界穿越前夕·零系统未绑定阶段，主角尚未跨界且未绑定红警指挥系统，现场无任何 MCV、基地产线或机娘意识链路。',
        recommendedAction:
          '请完全围绕原世界穿越前夕的现场环境、物资筹备与随行人类同伴互动自然推进，严禁催促展开 MCV 或提前唤醒系统。',
        preferredDomain: 'general',
      },
    ];
  }

  const findings: TacticalComboFinding[] = [];
  const credits = data.economy?.credits ?? 0;
  const bases = data.bases ?? [];
  const queues = data.queues ?? [];
  const vehicles = data.forces?.vehicles ?? [];
  const troops = data.forces?.troops ?? {};

  const baseContexts =
    options?.baseContexts ??
    bases
      .map(b => buildPlanningContext(data, catalog, { targetBaseRef: b.id, maxCandidates: 8 }))
      .filter((c): c is PlanningBaseContext => c !== null);

  // ── 维度 1：待命 MCV 与新基地展开诊断（standby_mcv_and_factions） ──
  const mcvInFleet = vehicles.filter(v => /机动建设车|基地车|\bMCV\b/i.test(v));
  const useSlowReconWording =
    (phase === 'silent_standby' || phase === 'field_recon') &&
    (Boolean(options?.bootChoices) || options?.preferences?.pacingMode === 'slow_sim');

  if (bases.length === 0 && (mcvInFleet.length > 0 || useSlowReconWording)) {
    const mcvLabel = mcvInFleet.length > 0 ? mcvInFleet.join('、') : '机动建设车(MCV)';
    if (useSlowReconWording) {
      findings.push({
        category: 'standby_mcv_and_factions',
        priority: 'P0',
        focusTag: '基地展开',
        title: '车队持有待命 MCV 且外围处于半迷雾踏勘期',
        diagnosis: `车队持有待命 MCV（${mcvLabel}）且外围处于未勘明的半迷雾态，周边水文、岩土承重与隐蔽掩体条件尚待现场核实。`,
        recommendedAction:
          '建议由指挥官自主决定是先派员近距踏勘岩土承重/水源/矿脉回波，还是择地平整掩体展开 MCV；绝不强行催促立即展开。',
        preferredDomain: 'allied',
      });
    } else {
      findings.push({
        category: 'standby_mcv_and_factions',
        priority: 'P0',
        focusTag: '基地展开',
        title: '车队持有待命 MCV 且尚未展开主基地',
        diagnosis: `当前车队编有「${mcvInFleet.join('、')}」，但战区尚未展开任何基地，所有建造、生产与科研产线均处于锁定状态。`,
        recommendedAction: `建议立即择地展开「${mcvInFleet[0]}」建立主建造厂，激活战区基建与产线序列。`,
        preferredDomain: 'allied',
      });
    }
  } else if (bases.length > 0 && mcvInFleet.length > 0) {
    // 检查是否有跨阵营 MCV 在车队里待命
    const hasSovietBase = bases.some(b => b.buildings?.some(bd => /苏联|苏军|磁能/i.test(bd.name)));
    const hasYuriBase = bases.some(b => b.buildings?.some(bd => /尤里|心灵|生物反应炉/i.test(bd.name)));
    const standbyCrossMcv = mcvInFleet.find(
      v => (/苏联|苏军/i.test(v) && !hasSovietBase) || (/尤里/i.test(v) && !hasYuriBase),
    );
    if (standbyCrossMcv) {
      findings.push({
        category: 'standby_mcv_and_factions',
        priority: 'P1',
        focusTag: '跨阵营基地展开',
        title: `车队持有未展开的跨阵营基地车「${standbyCrossMcv}」`,
        diagnosis: `车队中已有「${standbyCrossMcv}」处于待命状态，尚未展开建立对应阵营建造厂，跨阵营专属建筑与重装产线暂未激活。`,
        recommendedAction: `建议在稳固防线内下令展开「${standbyCrossMcv}」，开启双阵营联合基建与重工产线。`,
        preferredDomain: /苏联|苏军/i.test(standbyCrossMcv) ? 'soviet' : 'yuri',
      });
    }
  }

  // ── 15 日多阵营工程磨合期检查（faction_penalties / break_in_penalties） ──
  if (bases.length > 0) {
    const cmdAny = data.command as unknown as {
      faction_penalties?: Array<{
        id?: string;
        faction?: string;
        name?: string;
        remaining_minutes?: number;
        reason?: string;
      }>;
    };
    const rawPenalties = [
      ...(cmdAny?.faction_penalties ?? []),
      ...(data.command?.break_in_penalties ?? []),
    ];
    const activePenalties = rawPenalties.filter(p => (p?.remaining_minutes ?? 0) > 0);
    if (activePenalties.length > 0) {
      const penaltySummary = activePenalties
        .map(p => {
          const daysLeft = Math.max(1, Math.ceil((p.remaining_minutes ?? 0) / 1440));
          return `${p.name || p.faction || '跨系协议'}(余${daysLeft}日/${p.remaining_minutes}min)`;
        })
        .join('、');
      findings.push({
        category: 'standby_mcv_and_factions',
        priority: 'P2',
        focusTag: '跨系磨合',
        title: `多阵营工程磨合期进行中（${activePenalties.length} 项跨系磨合代价生效）`,
        diagnosis: `当前处于 15 日多阵营工程磨合期：${penaltySummary}，跨阵营混建期间存在电网损耗、维护成本或公差磨合负担。`,
        recommendedAction:
          '建议注意电网余量与跨系公差磨合，预留充足发电冗余与日常维护资金直至磨合期顺利结束。',
        preferredDomain: 'allied',
      });
    }
  }

  // ── 维度 2：电力底座与受损/停摆建筑诊断（power_grid） ──
  for (const base of bases) {
    const blds = base.buildings ?? [];
    const hasPowerPlant = blds.some(
      b => /发电厂|反应炉|电站|power/i.test(b.name) && b.state !== '受损' && b.state !== '停摆',
    );
    const powerQueued = queues.some(
      q => q.type === '建造' && /发电厂|反应炉|电站/i.test(q.item),
    );
    const offlineBlds = blds.filter(b => b.state === '受损' || b.state === '停摆');

    if (!hasPowerPlant && !powerQueued && blds.length > 0) {
      findings.push({
        category: 'power_grid',
        priority: 'P0',
        focusTag: '电力保障',
        title: `基地「${base.name}」缺乏运转中的发电设施`,
        diagnosis: `「${base.name}」当前已有 ${blds.length} 座建筑，但尚无运转中或在建的发电厂/反应炉，产线与雷达效率面临停摆风险。`,
        recommendedAction: `建议优先在「${base.name}」立项建造发电厂（如盟军发电厂/磁能反应炉），夯实电力底座。`,
        preferredDomain: 'allied',
      });
    } else if (offlineBlds.length > 0) {
      findings.push({
        category: 'power_grid',
        priority: 'P1',
        focusTag: '抢修供电',
        title: `基地「${base.name}」存在 ${offlineBlds.length} 座受损/停摆设施`,
        diagnosis: `建筑「${offlineBlds.map(b => `${b.name}(${b.state})`).join('、')}」当前非正常运转，影响对应产线与防御效能。`,
        recommendedAction: `建议派遣战斗工程师或下达工程抢修指令恢复受损设施运转，并核查基地供电余量。`,
        preferredDomain: 'allied',
      });
    }
  }

  // ── 维度 3：主基地核心母体建筑链完备度诊断（mother_buildings） ──
  const primaryBase = bases[0];
  if (primaryBase) {
    const blds = primaryBase.buildings ?? [];
    const activeAndQueuedNames = [
      ...blds.filter(b => b.state === '运转' || b.state === '建造中').map(b => b.name),
      ...queues.filter(q => q.type === '建造').map(q => q.item),
    ];

    const hasRefinery = activeAndQueuedNames.some(n => /精炼厂|矿场|采矿/i.test(n));
    const hasBarracks = activeAndQueuedNames.some(n => /兵营/i.test(n));
    const hasWarFactory = activeAndQueuedNames.some(n => /战车工厂|车厂/i.test(n));
    const hasAirOrRadar = activeAndQueuedNames.some(n => /空军指挥部|空指部|雷达/i.test(n));

    const missingMothers: string[] = [];
    if (!hasRefinery) missingMothers.push('矿石精炼厂（稳定资金来源）');
    if (!hasBarracks) missingMothers.push('兵营（步兵生产母体）');
    if (!hasWarFactory) missingMothers.push('战车工厂（装甲载具母体）');
    if (hasRefinery && hasBarracks && hasWarFactory && !hasAirOrRadar) {
      missingMothers.push('空军指挥部/雷达（情报视野与空军母体）');
    }

    if (missingMothers.length > 0) {
      const nextMother = !hasBarracks
        ? '兵营'
        : !hasRefinery
          ? '矿石精炼厂'
          : !hasWarFactory
            ? '战车工厂'
            : '空军指挥部';
      findings.push({
        category: 'mother_buildings',
        priority: 'P1',
        focusTag: '产线扩建',
        title: `主基地「${primaryBase.name}」核心母体建筑尚缺：${missingMothers.map(s => s.split('（')[0]).join('、')}`,
        diagnosis: `主基地当前已建有 ${blds.map(b => b.name).join('、') || '无'}，但尚未建成或排产「${missingMothers.join('；')}」，制约后续兵种/装甲产能。`,
        recommendedAction: `当前资金 ${credits}，建议优先在「${primaryBase.name}」立项建造【${nextMother}】以打通核心产线阶梯。`,
        preferredDomain: nextMother === '战车工厂' ? 'soviet' : 'allied',
      });
    }
  }

  // ── 维度 4：新解锁蓝图列装转化诊断（blueprint_adoption） ──
  const blueprintCodex = (data.codex ?? []).filter(
    c =>
      (c.kind === '人员' || c.kind === '载具') &&
      c.params &&
      (c.params['前置'] || c.params['来源']?.includes('任务')),
  );
  if (blueprintCodex.length > 0 && primaryBase) {
    const bldNames = (primaryBase.buildings ?? [])
      .filter(b => b.state === '运转')
      .map(b => b.name);
    for (const bp of blueprintCodex) {
      const reqBuilding = bp.params?.['前置'] || (bp.kind === '人员' ? '兵营' : '战车工厂');
      const bpCost = Number(bp.params?.['造价'] ?? 600) || 600;
      const alreadyOwned =
        bp.kind === '人员'
          ? (troops[bp.name] ?? 0) > 0
          : vehicles.some(v => canon(v) === canon(bp.name));
      const alreadyQueued = queues.some(q => canon(q.item) === canon(bp.name));
      if (alreadyOwned || alreadyQueued) continue;

      const motherReady = bldNames.some(bName => bName.includes(reqBuilding));
      if (motherReady) {
        findings.push({
          category: 'blueprint_adoption',
          priority: 'P1',
          focusTag: bp.kind === '人员' ? '新兵种列装' : '新载具列装',
          title: `已解锁新蓝图「${bp.name}」且母体建筑【${reqBuilding}】已就绪，尚未排产列装`,
          diagnosis: `战区已获得「${bp.name}」（${bp.kind}，造价 ${bpCost}）生产授权，主基地【${reqBuilding}】正处于运转状态，但现役部队与队列中尚无该单位。`,
          recommendedAction:
            credits >= bpCost
              ? `当前资金充裕（${credits} >= ${bpCost}），建议立即在主基地【${reqBuilding}】下达「${bp.name}」排产指令以转化为实机战力。`
              : `建议在筹措资金至 ${bpCost} 后，于主基地【${reqBuilding}】优先排产「${bp.name}」。`,
          preferredDomain: bp.kind === '载具' ? 'soviet' : 'allied',
        });
      } else {
        findings.push({
          category: 'blueprint_adoption',
          priority: 'P1',
          focusTag: '蓝图母体补齐',
          title: `已解锁「${bp.name}」蓝图，但主基地尚缺母体建筑【${reqBuilding}】`,
          diagnosis: `战区已解锁「${bp.name}」（造价 ${bpCost}）生产蓝图，但主基地尚未建成【${reqBuilding}】，导致该蓝图暂时无法投产。`,
          recommendedAction: `建议先在主基地立项建造【${reqBuilding}】，竣工后即可批量列装「${bp.name}」。`,
          preferredDomain: 'allied',
        });
      }
    }
  }

  // ── 维度 5：在途作战任务推进、玩家点名情报/暗流核查与暴露度诊断（active_quest_bottleneck） ──
  const activeQuests = data.quests?.active ?? [];
  const userQuestIntent = detectUserQuestIntent(options?.latestUserMessage, activeQuests);
  const userIntelIntent = detectUserIntelIntent(options?.latestUserMessage, data.intel);

  if (userIntelIntent.targetedIntelTitle) {
    const matchedIntel = (data.intel ?? []).find(it => {
      if (it.scope === 'world') return false;
      const ci = it as ChainAwareIntelItem;
      const label = String(it.title || it.content || '').trim();
      const chainStr = String(ci.chain ?? '').trim();
      const targetCanon = canon(userIntelIntent.targetedIntelTitle!);
      return (
        canon(label) === targetCanon ||
        canon(label).includes(targetCanon) ||
        targetCanon.includes(canon(it.title || label.slice(0, 12))) ||
        (chainStr.length > 0 &&
          (canon(chainStr) === targetCanon ||
            canon(chainStr).includes(targetCanon) ||
            targetCanon.includes(canon(chainStr))))
      );
    });
    const intelLabel = matchedIntel?.title || userIntelIntent.targetedIntelTitle;
    const intelSrc = matchedIntel?.src_kind || matchedIntel?.src || '战区线报';
    findings.push({
      category: 'active_quest_bottleneck',
      priority: 'P0',
      focusTag: '情报核查',
      title: `指挥官下令专项核查【${intelSrc}】线报「${intelLabel}」`,
      diagnosis: `★ 指挥官本轮点名核查线报「${intelLabel}」（当前状态：${matchedIntel?.status ?? '待核实'}，可信度：${matchedIntel?.cred ?? '中'}）。`,
      recommendedAction: `建议配合侦察/情报力量查明「${intelLabel}」真伪与具体坐标，并在战报中输出 <情报> 将其升级为「已证实」（或「已证伪」）及派生战术行动。`,
      preferredDomain: 'yuri',
    });
  } else if (userIntelIntent.targetedWorldEvoTitle) {
    const matchedEvo = (data.intel ?? []).find(it => {
      if (it.scope !== 'world') return false;
      const label = String(it.title || it.content || '').trim();
      return (
        canon(label) === canon(userIntelIntent.targetedWorldEvoTitle!) ||
        canon(label).includes(canon(userIntelIntent.targetedWorldEvoTitle!)) ||
        canon(userIntelIntent.targetedWorldEvoTitle!).includes(canon(it.title || label.slice(0, 12)))
      );
    });
    const evoLabel = matchedEvo?.title || userIntelIntent.targetedWorldEvoTitle;
    const evoDomain = matchedEvo?.evo_domain ?? '远方地缘';
    const evoStage = matchedEvo?.stage ?? '萌芽';
    findings.push({
      category: 'active_quest_bottleneck',
      priority: 'P0',
      focusTag: '暗流介入',
      title: `指挥官下令侦察/介入宏观暗流「${evoLabel}」（${evoDomain}·${evoStage}）`,
      diagnosis: `★ 指挥官本轮点名介入远方世界暗流「${evoLabel}」（${evoDomain}，当前处于「${evoStage}」阶段）。`,
      recommendedAction: `建议评估该暗流对我方战区的波及与切入窗口，并在本轮输出 <世界演变> 或转化派生前线 <情报>/<任务>。`,
      preferredDomain: 'yuri',
    });
  }

  if (activeQuests.length > 0) {
    const priorityOrder: Record<string, number> = { 主线: 0, 紧急: 1, 指令: 2, 支线: 3, 日常: 4 };
    const sortedQuests = [...activeQuests].sort(
      (a, b) => (priorityOrder[a.category ?? '支线'] ?? 3) - (priorityOrder[b.category ?? '支线'] ?? 3),
    );
    const targetedQuest = userQuestIntent.targetedActiveQuestName
      ? activeQuests.find(q => canon(q.name) === canon(userQuestIntent.targetedActiveQuestName!)) ??
        activeQuests.find(q => canon(q.name).includes(canon(userQuestIntent.targetedActiveQuestName!)))
      : undefined;
    const topQuest = targetedQuest ?? sortedQuests[0];
    const rewardCompact = formatQuestRewardCompact(topQuest.rewards);
    const rewardClause = rewardCompact ? `｜承诺悬赏：${rewardCompact}` : '';
    const targetedPrefix = targetedQuest ? `★ 指挥官本轮点名督办「${topQuest.name}」——` : '';
    findings.push({
      category: 'active_quest_bottleneck',
      priority:
        targetedQuest || topQuest.category === '主线' || topQuest.category === '紧急' ? 'P0' : 'P1',
      focusTag: '任务推进',
      title: `在途${topQuest.category ?? '作战'}任务「${topQuest.name}」待推进（当前进度：${topQuest.progress || '进行中'}）`,
      diagnosis: `${targetedPrefix}目前有 ${activeQuests.length} 项在途任务，首优任务「${topQuest.name}」目标要点：${topQuest.note || topQuest.detail || '推进战区态势目标'}${rewardClause}。`,
      recommendedAction: `建议围绕「${topQuest.name}」调配工程/机动部队推进下一阶段目标，达成后可获任务悬赏交割${rewardCompact ? `（${rewardCompact}）` : ''}。`,
      preferredDomain: 'yuri',
    });
  } else if (phase !== 'silent_standby' && pacingMode !== 'story_first') {
    const hasActionableIntelHook = (data.intel ?? []).some(it => {
      const hookRaw = (it as { quest_hook?: string }).quest_hook ?? it.hook ?? '';
      return it.scope !== 'world' && it.status === '待核实' && Boolean(String(hookRaw).trim());
    });
    if (hasActionableIntelHook || userQuestIntent.wantsNewQuest) {
      const advisorRoster = resolveStaffAdvisors(data, {
        bootChoices: options?.bootChoices,
        preferences: options?.preferences,
      });
      const recs = recommendPresetQuestArchetypes(data, {
        campaignPhase: phase,
        advisorRoster,
        bootChoices: options?.bootChoices,
        latestUserMessage: options?.latestUserMessage,
        maxRecommendations: 1,
      });
      if (recs.length > 0) {
        const topRec = recs[0];
        findings.push({
          category: 'active_quest_bottleneck',
          priority: 'P1',
          focusTag: '任务派发',
          title: `战区当前无在途任务，具备派发[${topRec.archetype.category}·${topRec.archetype.id}]「${topRec.archetype.archetypeName}」契机`,
          diagnosis: `${topRec.triggerReason}（推荐发包方：${topRec.recommendedIssuer}）。`,
          recommendedAction: `建议围绕「${topRec.tailoredObjectiveHint}」向指挥官发布新 <任务>，推荐承诺悬赏：${topRec.tailoredRewardHint}。`,
          preferredDomain:
            topRec.archetype.issuerDomain === 'soviet'
              ? 'soviet'
              : topRec.archetype.issuerDomain === 'yuri'
                ? 'yuri'
                : 'allied',
        });
      }
    }
  }

  // ── 维度 6：待收讫交割、重大工程续建与闲置产线/科研槽诊断（idle_capacity） ──
  const settlingQueues = queues.filter(
    q =>
      q.status === 'settling' &&
      !(q.type === '建造' && (q.building_delivered_qty ?? 0) >= (q.qty || 1)),
  );
  if (settlingQueues.length > 0) {
    const itemLabels = settlingQueues
      .map(q => `${q.item}${(q.qty || 1) > 1 ? `×${q.qty}` : ''}`)
      .join('、');
    findings.push({
      category: 'idle_capacity',
      priority: 'P0',
      focusTag: '竣工交割',
      title: `产线存在 ${settlingQueues.length} 项已达 100% 待收讫资产（${itemLabels}）`,
      diagnosis: `队列中「${itemLabels}」已完成全部工期进入待交割收讫态（settling），若本轮不声明收讫将持续占用产线槽位。`,
      recommendedAction: `建议在本轮正文中描写「${itemLabels}」完工交付就位，并在战报协议块输出收讫确认使其正式入列。`,
      preferredDomain: 'allied',
    });
  }

  const engAndSpaceOpen = isEngineeringAndSpaceFeedforwardOpen(data, {
    debugEnabled: options?.debugEnabled,
    latestUserMessage: options?.latestUserMessage,
    prevData: options?.prevData,
  });

  for (const proj of engAndSpaceOpen ? (data.projects ?? []) : []) {
    if (proj.status !== '在建') continue;
    const retroDef = (catalog?.retrofits ?? []).find(
      r =>
        canon(r.name) === canon(proj.ref) ||
        canon(String((r as { id?: string }).id ?? '')) === canon(proj.ref),
    );
    const projDef = (catalog?.projects ?? []).find(
      p => canon(p.name) === canon(proj.ref) || canon(p.id) === canon(proj.ref),
    );

    if ('phases' in proj && Array.isArray(proj.phases)) {
      const donePhases = proj.phases.filter(ph => ph.status === '完工');
      const hasRunning = proj.phases.some(
        ph => ph.status === '进行中' || (ph.status as string) === '在建',
      );
      const nextPhase = proj.phases.find(ph => ph.status === '未启动');
      if (donePhases.length > 0 && !hasRunning && nextPhase) {
        const lastDone = donePhases[donePhases.length - 1];
        const doneName = lastDone.name || `阶段 #${lastDone.idx}`;
        const nextName = nextPhase.name || `阶段 #${nextPhase.idx}`;
        const nextCost =
          retroDef?.phases?.[nextPhase.idx]?.cost ??
          (nextPhase as unknown as { cost?: number }).cost;
        const costClause =
          typeof nextCost === 'number' && nextCost > 0 ? `（需经费 ${nextCost} 点）` : '';
        findings.push({
          category: 'idle_capacity',
          priority: 'P1',
          focusTag: '工程续建',
          title: `在建工程「${proj.ref}」已完成阶段「${doneName}」，待注资启动下一阶段「${nextName}」`,
          diagnosis: `工程「${proj.ref}」（${proj.id}）前序阶段「${doneName}」已完工结算，当前无进行中阶段，下一阶段「${nextName}」${costClause}处于未启动断档态。`,
          recommendedAction: `建议参谋机娘向指挥官汇报阶段完工，并请示下达工程指令拨款启动下一阶段「${nextName}」${costClause}。`,
          preferredDomain: 'allied',
        });
      }
    } else if ('modules' in proj && Array.isArray(proj.modules)) {
      const doneMods = proj.modules.filter(m => m.status === '完工');
      const hasRunning = proj.modules.some(
        m => m.status === '进行中' || (m.status as string) === '在建',
      );
      const nextMod = proj.modules.find(m => m.status === '未启动');
      if (doneMods.length > 0 && !hasRunning && nextMod) {
        const lastDone = doneMods[doneMods.length - 1];
        const doneName = lastDone.name || lastDone.id;
        const nextName = nextMod.name || nextMod.id;
        const nextCost =
          projDef?.modules?.find(m => m.id === nextMod.id || m.name === nextMod.name)?.cost ??
          (nextMod as unknown as { cost?: number }).cost;
        const costClause =
          typeof nextCost === 'number' && nextCost > 0 ? `（需经费 ${nextCost} 点）` : '';
        findings.push({
          category: 'idle_capacity',
          priority: 'P1',
          focusTag: '工程续建',
          title: `在建仓段工程「${proj.ref}」已完成舱段「${doneName}」，待注资启动下一舱段「${nextName}」`,
          diagnosis: `仓段工程「${proj.ref}」（${proj.id}）前序舱段「${doneName}」已完工结算，当前无进行中舱段，下一舱段「${nextName}」${costClause}处于未启动待续态。`,
          recommendedAction: `建议参谋机娘向指挥官汇报舱段完工，并请示下达工程指令拨款启动下一舱段「${nextName}」${costClause}。`,
          preferredDomain: 'allied',
        });
      }
    }
  }

  const primaryCtx = baseContexts[0];
  const researchAdv = options?.researchAdvisory;
  const AERO_ITEM_RE = /液氧煤油发动机|捆绑式助推器|运载火箭芯|真空芯二级|光学侦察卫星载荷|通信卫星载荷|航天发射/i;
  if (pacingMode !== 'story_first' && credits >= 400 && primaryCtx) {
    const activeBuildOrProd = queues.filter(q => q.type === '建造' || q.type === '生产').length;
    const affordableProd = primaryCtx.produceableItems.filter(
      i => i.canProduceNow && i.unitCost <= credits && (engAndSpaceOpen || !AERO_ITEM_RE.test(i.name)),
    );
    const affordableResearch =
      researchAdv?.groups.flatMap(g => g.candidates).filter(c => c.affordable) ?? [];
    const activeResearch = queues.filter(q => q.type === '研究').length;

    if (activeBuildOrProd === 0 && affordableProd.length > 0) {
      const sampleNames = affordableProd
        .slice(0, 3)
        .map(i => `${i.name}(${i.kind}·${i.unitCost})`)
        .join('、');
      findings.push({
        category: 'idle_capacity',
        priority: 'P2',
        focusTag: '闲置产线调度',
        title: `主基地建造/生产序列空闲且资金充裕（${credits}）`,
        diagnosis: `当前无在途建造或生产任务，主基地已开通产线处于闲置状态，立即可排产候选有 ${affordableProd.length} 项。`,
        recommendedAction: `建议利用空闲产线排产：${sampleNames}。`,
        preferredDomain: 'allied',
      });
    }
    if (activeResearch === 0 && affordableResearch.length > 0) {
      const sampleRes = affordableResearch
        .slice(0, 3)
        .map(r => `${r.name}(${r.cost}·${r.eta})`)
        .join('、');
      findings.push({
        category: 'idle_capacity',
        priority: 'P2',
        focusTag: '科研立项',
        title: `战区科研序列当前空闲，可立项 ${affordableResearch.length} 项科技`,
        diagnosis: `当前全局研究槽空闲且现存资金（${credits}）足以支撑新科研立项。`,
        recommendedAction: `建议在科研序列立项研究：${sampleRes}。`,
        preferredDomain: 'allied',
      });
    }
  }

  // ── 维度 7：资金流、链网物理三要素成熟度与六柱战略资源短板诊断（economy_and_resources · FD-51 升级） ──
  const chains = ((data.economy?.chains ?? []) as MultiTrackChainLike[]);
  const dailyNet = calcDailyNet(data.economy?.chains ?? []);
  const res = data.economy?.resources;
  const lowResources: string[] = [];
  if (res && typeof res === 'object') {
    for (const [, subMap] of Object.entries(res as unknown as Record<string, Record<string, number | null>>)) {
      if (!subMap || typeof subMap !== 'object') continue;
      for (const [subName, val] of Object.entries(subMap)) {
        if (typeof val === 'number' && val <= 50) {
          lowResources.push(`${subName}(${val})`);
        }
      }
    }
  }

  const allRunningBlds = bases.flatMap(b =>
    (b.buildings ?? []).filter(bd => bd.state === '运转').map(bd => bd.name),
  );
  const hasRunningRefinery = allRunningBlds.some(n => /矿石精炼厂|精炼厂|矿场|采矿场/i.test(n));
  const hasRunningWarFactory = allRunningBlds.some(n => /战车工厂|车厂/i.test(n));
  const hasHarvesterInFleet = vehicles.some(v => /采矿车|矿车|harvester|miner/i.test(v));
  const hasHarvesterQueued = queues.some(
    q => q.type === '生产' && /采矿车|矿车|harvester|miner/i.test(q.item),
  );
  const hasActiveMiningChain = chains.some(
    c =>
      c.status !== 'exhausted' &&
      (c.chain_kind === '采矿精炼' ||
        /采矿|矿脉|矿场|精炼|矿石/i.test(
          `${c.name} ${c.deps?.world_resource ?? ''} ${(c.deps?.buildings ?? []).join(' ')}`,
        )),
  );
  const friendlyOrNeutralFactions = (data.factions ?? []).filter(
    f => f.name && (f.attitude === '中立' || f.attitude === '友善'),
  );
  const hasActiveTradeChain = chains.some(
    c =>
      c.status !== 'exhausted' &&
      (c.chain_kind === '本土商路' ||
        Boolean(c.deps?.faction) ||
        /商路|贸易|走私|互市|商队|通商/i.test(c.name)),
  );
  const tradeOpportunityClause =
    friendlyOrNeutralFactions.length > 0 && !hasActiveTradeChain
      ? `；此外已接触非敌意地方势力（${friendlyOrNeutralFactions.map(f => `${f.name}[${f.attitude}]`).join('、')}），可结合现场态势自主发挥建立「本土外币/易货商路链（产出本地外币 wallet 或采购原矿/建材/柴油/口粮实物，不可直接产出系统 Credits）」`
      : '';

  let hasEmittedChainMaturityFinding = false;

  // 情形 A：主基地已有运转中的矿石精炼厂/矿场，但现役与生产队列均无采矿车
  if (hasRunningRefinery && !hasHarvesterInFleet && !hasHarvesterQueued) {
    hasEmittedChainMaturityFinding = true;
    findings.push({
      category: 'economy_and_resources',
      priority: 'P1',
      focusTag: '采矿车补齐',
      title: `主基地【矿石精炼厂】已运转，但尚缺现役【采矿车】无法激活采矿精炼资金链`,
      diagnosis:
        `主基地虽已建成运转中的【矿石精炼厂】，但现役载具与生产队列中均缺乏【采矿车/矿车】，采矿精炼链物理三要素（矿石精炼厂+采矿车+已探明矿区）缺一不可，当前无法激活持续采矿收益（日均净流 ${dailyNet}/日）` +
        (lowResources.length > 0 ? `；低储量战略资源：${lowResources.slice(0, 4).join('、')}。` : '。'),
      recommendedAction:
        (hasRunningWarFactory
          ? `建议优先在【战车工厂】排产或通过战地任务收编【采矿车】，配齐物理三要素后即可建立【采矿精炼链】`
          : `建议尽快建成【战车工厂】排产或收编【采矿车】，配齐物理三要素后即可建立【采矿精炼链】`) +
        `${tradeOpportunityClause}。`,
      preferredDomain: 'allied',
    });
  } else if (hasRunningRefinery && (hasHarvesterInFleet || hasHarvesterQueued) && !hasActiveMiningChain) {
    // 情形 B：精炼厂 + 采矿车已齐备，但尚未建立采矿精炼链
    hasEmittedChainMaturityFinding = true;
    findings.push({
      category: 'economy_and_resources',
      priority: 'P1',
      focusTag: '资金链开拓',
      title: `主基地【矿石精炼厂】与现役【采矿车】物理前置已齐备，尚未建立【采矿精炼链】`,
      diagnosis:
        `主基地【矿石精炼厂】与现役【采矿车】物理前置已齐备，但当前账本中尚无活跃的采矿精炼资金链（当前资金 ${credits}，日均净流 ${dailyNet}/日）` +
        (lowResources.length > 0 ? `；低储量战略资源：${lowResources.slice(0, 4).join('、')}。` : '。'),
      recommendedAction:
        `主基地【矿石精炼厂】与现役【采矿车】物理前置已齐备，建议结合周边探明矿脉通过 <事件> 建立【采矿精炼链】（产出 Credits + 原矿）${tradeOpportunityClause}。`,
      preferredDomain: 'allied',
    });
  }

  // 情形 C 或常规资金/资源短板兜底
  if (!hasEmittedChainMaturityFinding) {
    if (friendlyOrNeutralFactions.length > 0 && !hasActiveTradeChain) {
      const facNames = friendlyOrNeutralFactions.map(f => `${f.name}[${f.attitude}]`).join('、');
      findings.push({
        category: 'economy_and_resources',
        priority: credits < 400 ? 'P1' : 'P2',
        focusTag: '后勤与资源',
        title: `战区已接触非敌意势力（${facNames}）且尚无本土商路链（日净流 ${dailyNet >= 0 ? `+${dailyNet}` : dailyNet}/日）`,
        diagnosis:
          `当前资金 ${credits}，日均净流 ${dailyNet}/日；战区已与「${facNames}」建立非敌意关系，但尚未开辟关联商路` +
          (lowResources.length > 0 ? `；低储量战略资源：${lowResources.slice(0, 4).join('、')}。` : '。'),
        recommendedAction:
          `建议结合现场态势自主发挥建立「本土外币/易货商路链（产出本地外币 wallet 或采购原矿/建材/柴油/口粮实物，不可直接产出系统 Credits）」，商路购入的原矿/废钢可运回基地精炼厂建立【工业转化链】熔炼为系统资金 Credits。`,
        preferredDomain: 'allied',
      });
    } else if ((dailyNet <= 0 && credits < 800) || lowResources.length > 0) {
      findings.push({
        category: 'economy_and_resources',
        priority: credits < 400 ? 'P1' : 'P2',
        focusTag: '后勤与资源',
        title: `战区资金流（日净流 ${dailyNet >= 0 ? `+${dailyNet}` : dailyNet}/日）或战略资源储备偏紧`,
        diagnosis:
          `当前资金 ${credits}，日均净流 ${dailyNet}/日` +
          (lowResources.length > 0 ? `；低储量战略资源：${lowResources.slice(0, 5).join('、')}。` : '。'),
        recommendedAction:
          dailyNet <= 0
            ? `建议尽快建造矿石精炼厂并配齐采矿车建立【采矿精炼链】、或打通外部物资商路及完成悬赏任务补充库存。`
            : `建议通过战地回收、贸易商路链或专项任务补充紧缺战略物资（${lowResources.slice(0, 3).join('、')}）。`,
        preferredDomain: 'allied',
      });
    }
  }

  // ── 维度 8：兵种配比与暴露度诊断（force_balance / exposure） ──
  const totalInfantry = Object.values(troops).reduce((s, n) => s + (typeof n === 'number' ? n : 0), 0);
  const combatVehicles = vehicles.filter(v => !/机动建设车|基地车|采矿车|矿车/i.test(v));
  const exposureVal = data.exposure?.value ?? 0;

  if (exposureVal >= 5) {
    findings.push({
      category: 'force_balance',
      priority: 'P0',
      focusTag: '隐蔽与防务',
      title: `战区暴露度偏高（${exposureVal}/10），面临敌方侦察或突袭风险`,
      diagnosis: `当前战区暴露度已达 ${exposureVal}/10（趋势：${data.exposure?.trend || '上升'}），继续高调扩建可能招致地方敌对势力围剿。`,
      recommendedAction: `建议构筑伪装网/防空哨卡降低暴露度，并整备机动防御兵力应对突发袭扰。`,
      preferredDomain: 'yuri',
    });
  } else if (bases.length > 0 && (totalInfantry < 3 || combatVehicles.length === 0)) {
    findings.push({
      category: 'force_balance',
      priority: 'P2',
      focusTag: '部队整备',
      title: `现役机动兵力单薄（步兵 ${totalInfantry} 人，作战载具 ${combatVehicles.length} 辆）`,
      diagnosis: `当前步兵与装甲机动力量较少，在执行外出勘探或保卫基地周界时火力冗余不足。`,
      recommendedAction:
        combatVehicles.length === 0
          ? `建议补充多功能步兵车/灰熊坦克等机动载具，与步兵班组构建步坦协同编队。`
          : `建议在兵营适当补充基干步兵与战斗工程师，提升战地占领与抢修能力。`,
      preferredDomain: 'soviet',
    });
  }

  // story_first（剧情沉浸免打扰）模式下过滤掉 P2 级别的闲置产线催促，仅保留 P0/P1 关键事项
  const filteredFindings =
    pacingMode === 'story_first'
      ? findings.filter(f => f.priority !== 'P2')
      : findings;

  filteredFindings.sort((a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]);
  const maxFindings = options?.maxFindings ?? 5;
  return filteredFindings.slice(0, maxFindings);
}

/* ═══════════════ 5. 全局七大板块前馈提示词组装（预算 1.2k ~ 2.8k tokens） ═══════════════ */

export const STRATEGIC_FEEDFORWARD_READONLY_NOTICE =
  '本段为中控台根据最新有效楼 stat_data、世界书目录与排产引擎自动计算的【战区全局态势与八维组合诊断】只读前馈视图：' +
  '仅供主 LLM 构思本轮剧情、核对硬约束以及在 <态势> 内生成「参谋建议」使用，严禁将本段原样复读进正文。';

function summarizeUnlockedResources(data: StatData): string {
  const res = data.economy?.resources as unknown as Record<string, Record<string, number | null>> | undefined;
  if (!res || typeof res !== 'object') return '暂无已解锁战略资源';
  const pillarLabels: Record<string, string> = {
    nanites: '纳米',
    minerals: '矿石',
    materials: '建材',
    fuel: '燃油',
    munitions: '军械',
    logistics: '后勤',
  };
  const parts: string[] = [];
  for (const [pillar, subMap] of Object.entries(res)) {
    if (!subMap || typeof subMap !== 'object') continue;
    const unlockedEntries = Object.entries(subMap)
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
      .map(([k, v]) => `${k}:${v}`);
    if (unlockedEntries.length > 0) {
      parts.push(`${pillarLabels[pillar] ?? pillar}[${unlockedEntries.join(', ')}]`);
    }
  }
  return parts.length > 0 ? parts.join(' ｜ ') : '六柱资源均未解锁或为0';
}

export function deriveStrategicFeedforward(
  snapshot: FloorSnapshot | null,
  overlays: readonly DlcOverlay[],
  dynamicWb?: ParsedWorldbookCatalog | DynamicWorldbookCatalog | null,
  options?: StrategicFeedforwardOptions,
): StrategicFeedforward | null {
  if (!snapshot) return null;
  const { data } = snapshot;
  const catalog = mergeEffectiveCatalog(overlays, dynamicWb, data.protocols);

  const baseContexts: PlanningBaseContext[] = [];
  for (const base of data.bases ?? []) {
    const baseId = String(base.id ?? '').trim();
    if (!baseId) continue;
    const ctx = buildPlanningContext(data, catalog, { targetBaseRef: baseId, maxCandidates: 8 });
    if (ctx) baseContexts.push(ctx);
  }

  const phaseRes = resolveCampaignPhase(data, options?.bootChoices, options?.preferences);
  const effectivePrefs = normalizePreferences(options?.preferences);
  const effectiveMaidenIncubationMode:
    | 'iconic_plus_blindbox'
    | 'full_blindbox'
    | 'preset_roster'
    | 'off' =
    effectivePrefs.girlHatchingMode === 'off' || effectivePrefs.maidenIncubationOverride === 'off'
      ? 'off'
      : effectivePrefs.maidenIncubationOverride && effectivePrefs.maidenIncubationOverride !== 'auto'
        ? effectivePrefs.maidenIncubationOverride
        : options?.bootChoices?.maidenIncubationMode === 'full_blindbox' ||
            options?.bootChoices?.maidenIncubationMode === 'preset_roster'
          ? options.bootChoices.maidenIncubationMode
          : 'iconic_plus_blindbox';
  const userIntentSummary = analyzeUserTurnIntent(options?.latestUserMessage);

  const researchAdvisory =
    phaseRes.phase === 'prologue_unbound'
      ? null
      : deriveResearchAdvisory(snapshot, overlays, dynamicWb);
  const dailyNetCredits = calcDailyNet(data.economy?.chains ?? []);
  const advisorRoster = resolveStaffAdvisors(data, options);
  const userQuestIntent = detectUserQuestIntent(options?.latestUserMessage, data.quests?.active);
  const userIntelIntent = detectUserIntelIntent(options?.latestUserMessage, data.intel);
  const questRecommendations = recommendPresetQuestArchetypes(data, {
    campaignPhase: phaseRes.phase,
    advisorRoster,
    bootChoices: options?.bootChoices,
    latestUserMessage: options?.latestUserMessage,
    dailyNetCredits,
  });
  const chainContinuations =
    phaseRes.phase === 'prologue_unbound' || phaseRes.phase === 'silent_standby'
      ? []
      : detectPendingChainContinuations(data, {
          prevData: options?.prevData,
          advisorRoster,
          bootChoices: options?.bootChoices,
        });
  const allBldNamesForChannels = (data.bases ?? [])
    .flatMap(b => (b.buildings ?? []).map(x => x.name))
    .join(' ');
  const availableIntelChannels: string[] = ['前线目视', '宏观广播'];
  if (/雷达|空指|空军指挥部|卫星|预警|实验室/.test(allBldNamesForChannels)) availableIntelChannels.push('雷达侦察');
  if (/通讯|雷达|空指|空军指挥部|心灵|感应/.test(allBldNamesForChannels)) availableIntelChannels.push('电讯截获');
  if (/暗网|中继/.test(allBldNamesForChannels)) availableIntelChannels.push('暗网流言');
  if (
    (data.factions ?? []).some(f => f.attitude === '友善') ||
    /间谍|特工/.test(Object.keys(data.forces?.troops ?? {}).join(' '))
  ) {
    availableIntelChannels.push('渗透内线');
  }
  const intelChainHints =
    phaseRes.phase === 'prologue_unbound' || phaseRes.phase === 'silent_standby'
      ? []
      : detectPendingIntelChains(data, {
          availableChannels: availableIntelChannels,
          prevData: options?.prevData,
        });
  const engAndSpaceOpen = isEngineeringAndSpaceFeedforwardOpen(data, {
    debugEnabled: options?.debugEnabled,
    latestUserMessage: options?.latestUserMessage,
    prevData: options?.prevData,
  });
  const rawMilestones = deriveCompletionMilestones(data, catalog, options?.prevData);
  const completionMilestones: CompletionMilestonesSummary = engAndSpaceOpen
    ? rawMilestones
    : {
        settlingItems: rawMilestones.settlingItems.filter(
          item => item.domain !== 'project' && item.domain !== 'space',
        ),
        completedItems: rawMilestones.completedItems.filter(
          item => item.domain !== 'project' && item.domain !== 'space',
        ),
      };
  const comboFindings = analyzeTacticalCombos(data, catalog, {
    baseContexts,
    researchAdvisory,
    maxFindings: 5,
    bootChoices: options?.bootChoices,
    latestUserMessage: options?.latestUserMessage,
    preferences: options?.preferences,
    campaignPhase: phaseRes.phase,
    prevData: options?.prevData,
    debugEnabled: options?.debugEnabled,
  });

  return {
    floorId: snapshot.floorId,
    schemaVersion: snapshot.schemaVersion,
    data,
    catalog,
    baseContexts,
    researchAdvisory,
    dailyNetCredits,
    advisorRoster,
    comboFindings,
    completionMilestones,
    campaignPhase: phaseRes.phase,
    campaignPhaseLabel: phaseRes.phaseLabel,
    effectiveSystemLinkMode: phaseRes.effectiveSystemLinkMode,
    effectiveMaidenIncubationMode,
    pacingMode: effectivePrefs.pacingMode,
    preferences: effectivePrefs,
    questRecommendations,
    chainContinuations,
    intelChainHints,
    userQuestIntent,
    userIntelIntent,
    engineeringAndSpaceEnabled: engAndSpaceOpen,
    ...(userIntentSummary ? { userIntentSummary } : {}),
  };
}

export function formatActiveSeatsSection(
  advisorRoster: StaffAdvisorRoster,
  campaignPhase?: CampaignPhase,
): string[] {
  const isPrologueUnbound = campaignPhase === 'prologue_unbound';
  const isSilentStandby = campaignPhase === 'silent_standby';
  const allowMaidenVoice = !isPrologueUnbound && !isSilentStandby;

  const rosterNames = advisorRoster.advisors
    .map(a => {
      const starter =
        allowMaidenVoice && a.name !== '现场直觉'
          ? (resolveStarterMcvInfo(a.name) ??
            (a.faction !== 'other' ? FACTION_STARTER_MCV_MAP[a.faction] : undefined))
          : undefined;
      const voiceTag = allowMaidenVoice ? (a.voiceTag || starter?.voiceTag) : undefined;
      const voiceClause = voiceTag ? `｜口吻锚点：${voiceTag}` : '';
      return `${a.name}（${a.roleTitle}，专长：${a.specialty}${voiceClause}）`;
    })
    .join('；');

  const sectionLines: string[] = [];
  sectionLines.push(
    `【七、本轮 <态势>「参谋建议」输出指引（${advisorRoster.mode === 'ensemble' ? '多席联席模式' : '单席独奏模式'}）】`,
  );
  sectionLines.push(`· 当前在岗参谋席：${rosterNames}`);
  if (isPrologueUnbound) {
    sectionLines.push(
      '· 【零系统参谋铁律】本轮 <态势> 的『参谋建议』严禁出现白凌、喀秋莎、尤里卡等尚未绑定的机娘！仅允许由在场随行人类同伴（如萧栖雪、杜月欣、苏晓等）以原世界现场行动视角提出建议；<选项> 严禁出现意识链路呼叫机娘等超前选项！',
    );
  } else if (isSilentStandby) {
    sectionLines.push(
      '· 【待指挥官亲自联系铁律】核心机娘当前处于被动静默待机态，在指挥官主动开口呼叫或亲自接入终端前，正文中严禁机娘主动弹窗或抢先搭话，<态势> 参谋建议仅由在场随行人类同伴（或现场直觉）给出！',
    );
  }
  if (advisorRoster.mode === 'ensemble') {
    const roleNoun = isPrologueUnbound || isSilentStandby ? '在场随行同伴' : '参谋机娘';
    sectionLines.push(
      `· 联席献策要求：请在本轮文末 <态势> 标签内输出 \`参谋建议:\` 列表（2~3 条），由在岗的多位${roleNoun}按各自专长领域与口吻锚点分别署名献策（每人 1 条，结合上方【八维组合战术诊断】与本轮剧情进展，包含 \`参谋\`、\`焦点\`、\`建议\`、\`指令\` 四字段，严禁写成千篇一律的同质化电子播报）。`,
    );
  } else {
    const primaryAdvisor =
      advisorRoster.advisors[0]?.name ?? (isPrologueUnbound || isSilentStandby ? '现场直觉' : '白凌');
    sectionLines.push(
      `· 单席献策要求：请在本轮文末 <态势> 标签内输出 \`参谋建议:\` 列表（1~2 条），由首席参谋「${primaryAdvisor}」结合上方【八维组合战术诊断】与本轮剧情进展，以贴合人设与口吻锚点的鲜明语气指导指挥官下一步最关键的${isPrologueUnbound ? '原世界现场行动或跨界筹备动作' : '基建/排产/新单位列装或任务推进动作'}（包含 \`参谋\`、\`焦点\`、\`建议\`、\`指令\` 四字段）。`,
    );
  }
  return sectionLines;
}

/* ═══════════════ FD-50 三阵营车载战术小超武 + 伴随供能/热沉保障车组识别 ═══════════════ */

interface MobileSuperweaponSpec {
  canonicalName: string;
  pattern: RegExp;
  synergyEffect: string;
}

interface FactionMobileSuperweaponGroup {
  factionLabel: string;
  companionName: string;
  companionPattern: RegExp;
  superweapons: readonly MobileSuperweaponSpec[];
}

const FACTION_MOBILE_SUPERWEAPON_GROUPS: readonly FactionMobileSuperweaponGroup[] = [
  {
    factionLabel: '盟军',
    companionName: '野战移动式核能供电保障车',
    companionPattern: /野战移动式核能供电保障车|核能供能车|移动核能车|mobile_nuclear_power_vehicle/i,
    superweapons: [
      {
        canonicalName: '战术人工气象调控车',
        pattern: /战术人工气象调控车|战术气象车|tactical_weather_vehicle/i,
        synergyEffect: '局部雷暴/强风切变/浓雾遮蔽',
      },
      {
        canonicalName: '全频段机动裂缝遮蔽车',
        pattern: /全频段机动裂缝遮蔽车|机动裂缝产生车|移动裂缝产生器|机动裂缝遮蔽车|mobile_gap_generator/i,
        synergyEffect: '2.5–3km战区全频段电磁与光学黑障穹顶',
      },
      {
        canonicalName: '超时空轻型战术突击坦克',
        pattern: /超时空轻型战术突击坦克|超时空轻型坦克|chrono_light_tank/i,
        synergyEffect: '快速电容充能与短距战术相位跃迁',
      },
    ],
  },
  {
    factionLabel: '苏联',
    companionName: '野战超导磁能脉冲供能车',
    companionPattern: /野战超导磁能脉冲供能车|超导脉冲供能车|野战磁能脉冲充电车|superconducting_pulse_power_vehicle/i,
    superweapons: [
      {
        canonicalName: '机动铁幕伴随投射车',
        pattern: /机动铁幕伴随投射车|机动铁幕车|车载铁幕投射车|mobile_iron_curtain_emitter/i,
        synergyEffect: '半径150m内4–6台重型装甲集群贴体铁幕赋盾（严禁裸露普通步兵进入强磁区）',
      },
      {
        canonicalName: '地锚式磁锁与电磁奇点压制车',
        pattern: /地锚式磁锁与电磁奇点压制车|磁锁奇点压制车|电磁奇点压制车|地锚式磁锁车|magnetic_singularity_suppressor/i,
        synergyEffect: '半径200m高梯度洛伦兹强磁奇点拖拽压制与球状闪电链式击穿（需90秒深地液压打桩硬直）',
      },
    ],
  },
  {
    factionLabel: '尤里',
    companionName: '牧羊人脑波中继与湿件抢修工程车',
    companionPattern: /牧羊人脑波中继与湿件抢修工程车|牧羊人工程车|牧羊人脑波中继车/i,
    superweapons: [
      {
        canonicalName: '精神控制车',
        pattern: /精神控制车|心灵控制车|脑车/i,
        synergyEffect: '高压液氮—脑脊液并机分流，支持超额强控4个以上目标防湿件烧蚀',
      },
      {
        canonicalName: '机动基因谐振突变车',
        pattern: /机动基因谐振突变车|基因突变共振车|车载基因突变器|机动基因突变车|mobile_genetic_mutator_vehicle/i,
        synergyEffect: '半径180m双螺旋崩解—狂兽化诱导风暴（防逆转录噬菌体母株热失活反噬）',
      },
    ],
  },
];

/**
 * FD-50：扫描现役 `forces.vehicles`，识别三阵营「车载小超武 + 伴随供能/热沉保障车」配对状态并输出战术底账提示。
 */
export function buildMobileSuperweaponSynergyHints(vehicles: readonly string[] | undefined | null): string[] {
  if (!vehicles || vehicles.length === 0) return [];
  const hints: string[] = [];
  for (const group of FACTION_MOBILE_SUPERWEAPON_GROUPS) {
    const activeSuperweapons = group.superweapons.filter(sw => vehicles.some(v => sw.pattern.test(String(v))));
    if (activeSuperweapons.length === 0) continue;
    const hasCompanion = vehicles.some(v => group.companionPattern.test(String(v)));
    const swNames = activeSuperweapons.map(sw => `「${sw.canonicalName}」`).join('、');
    if (hasCompanion) {
      const effects = activeSuperweapons.map(sw => `${sw.canonicalName}：${sw.synergyEffect}`).join('；');
      hints.push(
        `· ★ [战术小超武车组并网就绪]：检测到${group.factionLabel}${swNames}已配齐伴随保障车「${group.companionName}」，可展开释放驻锄并网态满功率战术小超武（${effects}；须严守展开硬直、冷却周期与物理副作用约束）。`,
      );
    } else {
      hints.push(
        `· ☆ [战术小超武单车受限]：检测到${group.factionLabel}${swNames}在列，但当前未配属伴随保障车「${group.companionName}」，仅限行军自持态低功率运行（补齐「${group.companionName}」后可解锁驻锄并网态满功率模式）。`,
      );
    }
  }
  return hints;
}

export function formatStrategicFeedforwardPrompt(feed: StrategicFeedforward): string {
  const { data, baseContexts, dailyNetCredits, advisorRoster, comboFindings } = feed;
  const isPrologueUnbound = feed.campaignPhase === 'prologue_unbound';
  const lines: string[] = [];

  lines.push('[战区全局态势与参谋部八维组合诊断 · 只读前馈视图]');
  lines.push(
    `来源：第 ${feed.floorId} 楼 stat_data（schema_version ${feed.schemaVersion}）｜${STRATEGIC_FEEDFORWARD_READONLY_NOTICE}`,
  );
  lines.push(
    `· 当前战役阶段：${feed.campaignPhaseLabel}｜前馈模式：${feed.pacingMode}${feed.userIntentSummary ? `｜本轮玩家意图：${feed.userIntentSummary}` : ''}`,
  );

  // ── 板块一：时空、环境与战略安全大盘 ──
  const meta = data.meta;
  const clock = data.clock;
  const unlockedFacs = (data.command?.unlocked_factions ?? ['allied']).join('、');
  const intelPts = data.command?.intel_points ?? 0;
  const expVal = data.exposure?.value ?? 0;
  const expLv = resolveExposureLevel(expVal);
  const expFloor = data.exposure?.floor ?? computeExposureFloor(data);
  const moraleVal = data.morale?.value ?? 5;
  const moraleEngaged = isMoraleEngaged(data.morale, expVal);
  const moraleSt = resolveMoraleStage(moraleVal, { engaged: moraleEngaged, exposureValue: expVal });
  const moraleSummaryPart = moraleSt.engaged
    ? `${moraleVal}/10（${moraleSt.stage}｜${moraleSt.effectSummary}）`
    : `无人在意（${moraleSt.effectSummary}）`;
  lines.push(
    `【一、战区宏观态势】日期：${meta?.date || '未详'}（第 ${clock?.day ?? 0} 日 ${clock?.time || '08:00'}）｜地点：${meta?.location || '未勘定'}｜天气：${meta?.weather || '晴'}｜暴露度：${expVal}/10（${expLv.canonicalLabel}｜常驻底线 ${expFloor}｜趋势：${data.exposure?.trend || '平稳'}）｜民心指数：${moraleSummaryPart}｜已启封阵营：${unlockedFacs}｜战略机密点：${intelPts}`,
  );
  if (isPrologueUnbound) {
    lines.push(
      '· ⚠️ 当前处于原世界穿越前夕·零系统未绑定阶段：主角脑海中无任何系统提示音，不知道 MCV 与白凌/喀秋莎/尤里卡等机娘的存在，严禁在正文中提前觉醒系统或让机娘跨界联系主角。',
    );
  }

  // ── 板块二：经济、资金链与六柱战略资源（FD-51 三轨收支与物理前置升级） ──
  const credits = data.economy?.credits ?? 0;
  const netSign = dailyNetCredits >= 0 ? `+${dailyNetCredits}` : `${dailyNetCredits}`;
  const visibleChains = ((data.economy?.chains ?? []) as MultiTrackChainLike[]).filter(
    c => c.status === 'active' || c.status === 'distressed',
  );
  const formatChainItemSummary = (c: MultiTrackChainLike): string => {
    const walletPairs = Object.entries(c.wallet_daily ?? {})
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v !== 0)
      .map(([k, v]) => `${k}${v > 0 ? `+${v}` : v}/日`);
    const resPairs: string[] = [];
    for (const [, subMap] of Object.entries(c.resources_daily ?? {})) {
      if (!subMap || typeof subMap !== 'object') continue;
      for (const [subName, val] of Object.entries(subMap)) {
        if (typeof val === 'number' && Number.isFinite(val) && val !== 0) {
          resPairs.push(`${subName}${val > 0 ? `+${val}` : val}/日`);
        }
      }
    }
    const trackParts: string[] = [];
    if (c.rate_daily > 0 || (walletPairs.length === 0 && resPairs.length === 0)) {
      trackParts.push(`${c.flow === '支出' ? '-' : '+'}${c.rate_daily}/日`);
    }
    if (walletPairs.length > 0) {
      trackParts.push(`外币:${walletPairs.join('、')}`);
    }
    if (resPairs.length > 0) {
      trackParts.push(`货物:${resPairs.join('、')}`);
    }
    if (c.status === 'distressed') {
      trackParts.push(`受挫停摆${c.reason ? `:${c.reason}` : ''}`);
    }
    const kindSuffix = c.chain_kind ? `[${c.chain_kind}]` : '';
    return `${c.name}(${trackParts.join('｜')})${kindSuffix}`;
  };
  const chainsSummary =
    visibleChains.length > 0
      ? visibleChains.map(formatChainItemSummary).join('、')
      : '暂无活跃资金链';
  const walletEntries = Object.entries(data.economy?.wallet ?? {})
    .filter(([, v]) => typeof v === 'number' && v > 0)
    .map(([k, v]) => `${k}:${v}`);
  const walletText = walletEntries.length > 0 ? walletEntries.join('、') : '无外币储备';
  if (isPrologueUnbound) {
    lines.push(
      `【二、经济与六柱资源】当前处于原世界穿越前夕·零系统未绑定阶段（系统资金与六柱资源库尚未向主角开放，主角脑海中无任何系统提示音）｜本地钱袋：${walletText}`,
    );
  } else {
    lines.push(
      `【二、经济与六柱资源】系统资金：${credits}（日均净流 ${netSign}/日｜活跃资金链：${chainsSummary}）｜本地钱袋：${walletText}`,
    );
    lines.push(`· 六柱战略资源库存：${summarizeUnlockedResources(data)}`);
    lines.push(
      '· 链网物理前置与三轨法则提醒：矿业精炼链须同时具备【矿石精炼厂+采矿车+已探明矿区】方可产出系统资金 Credits；本土商路仅可收支【本地外币 wallet】或【六柱实物货物 resources】（严禁直接印系统币 Credits）；商路购入的原矿/废钢可经基地精炼厂/回收厂建立【工业转化链】熔炼为 Credits。',
    );
  }

  // ── FD-45：本轮最新竣工与待收讫里程碑（非序章/非静默且有里程碑时输出，空态零污染） ──
  const isSilentStandby = feed.campaignPhase === 'silent_standby';
  const milestones = feed.completionMilestones ?? { settlingItems: [], completedItems: [] };
  const girlHatchingEnabled =
    feed.preferences?.girlHatchingMode !== 'off' &&
    feed.preferences?.maidenIncubationOverride !== 'off' &&
    feed.effectiveMaidenIncubationMode !== 'off';

  if (
    !isPrologueUnbound &&
    !isSilentStandby &&
    (milestones.settlingItems.length > 0 || milestones.completedItems.length > 0)
  ) {
    lines.push('【本轮最新竣工与待收讫里程碑（参谋部重点督办）】');
    for (const sItem of milestones.settlingItems) {
      const birthSuffix =
        sItem.girlBirthEligible && girlHatchingEnabled
          ? '｜✨[机魂初诞契机] 该型号为战区首批次下线，可安排对应机娘随实机报到并输出 <机娘档案>（盲盒模式先以 待授名·编号 输出 <机娘>，若直接入档则必填 special_skills 技能数组与 special_equipment 主副武器/挂载数组）！'
          : '';
      lines.push(
        `· ★ [待交割收讫·settling] ${sItem.title}（${sItem.detail}） 👉 请在本轮正文描写交付就位，并在战报协议块中输出收讫声明以完成三色门入役！${birthSuffix}`,
      );
    }
    for (const cItem of milestones.completedItems) {
      const unlockSuffix =
        cItem.unlockedHighlights.length > 0
          ? ` 👉 现已解锁：${cItem.unlockedHighlights.join('、')}！`
          : '';
      const birthSuffix =
        cItem.girlBirthEligible && girlHatchingEnabled
          ? '｜✨[机魂初诞契机] 该型号为战区首批次列装，可安排对应机娘随实机报到并输出 <机娘档案>（盲盒模式先以 待授名·编号 输出 <机娘>，若直接入档则必填 special_skills 技能数组与 special_equipment 主副武器/挂载数组）！'
          : '';
      const intelConversionSuffix =
        cItem.domain === 'intel'
          ? ' 👉 请在正文中展现情报核实成果，并可按需顺势派生关联 <任务>（含多环任务链）、新增/更新 <扩展档案>（人物/势力）或解锁战略 <协议> 线索！'
          : '';
      lines.push(
        `· 🎉 [本轮刚竣工入账·勿重复报账] ${cItem.title}（${cItem.detail}）${unlockSuffix}${birthSuffix}${intelConversionSuffix}`,
      );
    }
    if (milestones.completedItems.length > 0) {
      lines.push(
        '  ※ 防错铁律：标有「已入账·勿重复报账」的资产已由引擎并入账本，请直接在正文展现投产/列装后的现场实效与下游解锁，严禁为其重复输出 <生产> 收讫标签（以防触发 OVERRUN 越权警报）！',
      );
    }
  }

  // ── 板块三：基地群、建筑状态与可建造/可生产/临近解锁上下文（正式接线 planningContext.ts） ──
  lines.push(`【三、基地群与排产上下文（共 ${data.bases.length} 座基地）】`);
  if (isPrologueUnbound) {
    lines.push(
      '· 当前处于原世界穿越前夕·零系统未绑定阶段：主角不知道 MCV 与基地产线的存在，严禁在正文中提前觉醒系统或描述 MCV 展开。',
    );
  } else if (data.bases.length === 0) {
    lines.push('· 当前尚未展开任何基地（车队持有待命 MCV，可由指挥官自主决定先踏勘周边环境或择地展开主基地）。');
  } else {
    for (let i = 0; i < data.bases.length; i++) {
      const base = data.bases[i];
      const bCtx = baseContexts.find(c => c.baseId === base.id);
      const blds =
        (base.buildings ?? [])
          .map((b, bIdx) => {
            const sp = resolveBuildingRelativeCoord(b, bIdx, base.id || `base-${i}`);
            const coordShort =
              sp.ring === 'core'
                ? 'MCV原点(0,0)'
                : `${sp.ringLabel}·${sp.compassCn}${sp.distanceMeters}m(${sp.coord.x >= 0 ? '+' : ''}${sp.coord.x},${sp.coord.y >= 0 ? '+' : ''}${sp.coord.y})`;
            return `${b.name}[${b.state}｜${coordShort}]`;
          })
          .join('、') || '无建筑';
      lines.push(`· 基地「${base.name}」（ID:${base.id}｜状态:${base.status}）：已建建筑(${base.buildings?.length ?? 0}) = ${blds}`);
      const sectorSummary = formatBaseSectorsSummary(base as { sectors?: unknown[] });
      if (sectorSummary) {
        lines.push(`  - ${sectorSummary}`);
      }
      if (bCtx) {
        const openLanes = bCtx.lanes.filter(l => !l.locked);
        const openText =
          openLanes.length > 0
            ? openLanes.map(l => `${l.displayName}(容量${l.capacity})`).join('、')
            : '无';
        lines.push(`  - 已开通产线(${openLanes.length})：${openText}`);
        if (bCtx.produceableItems.length > 0) {
          const prodSample = bCtx.produceableItems
            .slice(0, 8)
            .map(item => `${item.name}[${item.kind}｜造价${item.unitCost}]`)
            .join('、');
          lines.push(`  - 立即可排产/建造候选(${bCtx.produceableItems.length})：${prodSample}`);
        }
        if (bCtx.nearUnlockItems.length > 0) {
          const nearSample = bCtx.nearUnlockItems
            .slice(0, 5)
            .map(item => `${item.name}[${item.kind}｜造价${item.unitCost}｜${item.blocked?.reason ?? '待解锁'}]`)
            .join('；');
          lines.push(`  - 临近解锁/暂阻候选(${bCtx.nearUnlockItems.length})：${nearSample}`);
        }
      }
    }
  }

  if (!isPrologueUnbound) {
    const activeProjects = (data.projects ?? []).filter(
      p => p.status === '在建' || p.status === '暂停',
    );
    if (activeProjects.length > 0) {
      const projSummaries = activeProjects.slice(0, 3).map(proj => {
        const bName = resolveBaseDisplayName(data, proj.lead_base);
        const locTag = bName ? `@${bName}` : '';
        if ('phases' in proj && Array.isArray(proj.phases)) {
          const doneCount = proj.phases.filter(ph => ph.status === '完工').length;
          const totalCount = proj.phases.length;
          const runningPh = proj.phases.find(
            ph => ph.status === '进行中' || (ph.status as string) === '在建',
          );
          const nextPh = proj.phases.find(ph => ph.status === '未启动');
          const phaseDesc = runningPh
            ? `进行中：${runningPh.name || `#${runningPh.idx}`}`
            : nextPh
              ? `待注资下一阶段：${nextPh.name || `#${nextPh.idx}`}`
              : '阶段推进中';
          return `「${proj.ref}」(${proj.status}${locTag}｜已完成 ${doneCount}/${totalCount} 阶段｜${phaseDesc})`;
        }
        if ('modules' in proj && Array.isArray(proj.modules)) {
          const doneCount = proj.modules.filter(m => m.status === '完工').length;
          const totalCount = proj.modules.length;
          const runningMod = proj.modules.find(
            m => m.status === '进行中' || (m.status as string) === '在建',
          );
          const nextMod = proj.modules.find(m => m.status === '未启动');
          const modDesc = runningMod
            ? `进行中：${runningMod.name || runningMod.id}`
            : nextMod
              ? `待注资下一舱段：${nextMod.name || nextMod.id}`
              : '舱段推进中';
          return `「${proj.ref}」(${proj.status}${locTag}｜已完成 ${doneCount}/${totalCount} 舱段｜${modDesc})`;
        }
        return `「${proj.ref}」(${proj.status}${locTag})`;
      });
      lines.push(`· 重大工程进度：${projSummaries.join('；')}`);
    }
  }

  // ── 板块四：现役部队编制、新解锁生产蓝图与参战机娘 ──
  const troopEntries = Object.entries(data.forces?.troops ?? {})
    .filter(([, n]) => typeof n === 'number' && n > 0)
    .map(([k, n]) => `${k}×${n}`);
  const vehicleList = data.forces?.vehicles ?? [];
  const unlockedBlueprints = (data.codex ?? [])
    .filter(c => (c.kind === '人员' || c.kind === '载具') && c.params?.['前置'])
    .map(c => `${c.name}(${c.kind}·母体:${c.params?.['前置']}·造价:${c.params?.['造价'] ?? '?'})`);
  const girlsSummary =
    (data.forces?.girls ?? [])
      .map(
        g =>
          `${g.name}${g.callsign ? `(${g.callsign})` : ''}[职务:${g.duty || '副官'}｜状态:${g.hp}｜好感:${g.affection ?? 50}｜特质:${(g.traits ?? []).slice(0, 3).join('/') || '无'}]`,
      )
      .join('；') || '暂无在编机娘';

  const ammoSummary =
    Object.entries(data.forces?.ammo ?? {})
      .map(([k, v]) => `${k}:${v}`)
      .join('、') || '充足';

  if (isPrologueUnbound) {
    lines.push(
      '【四、部队编制与机娘阵容】当前处于原世界穿越前夕·零系统未绑定阶段：主角脑海中无任何系统提示音，不知道 MCV 与白凌/喀秋莎/尤里卡等机娘的存在，严禁在正文中提前觉醒系统或让机娘跨界联系主角。',
    );
  } else {
    lines.push(
      `【四、部队编制与机娘阵容】步兵：${troopEntries.join('、') || '无'}｜载具：${vehicleList.join('、') || '无'}｜弹药状态：${ammoSummary}`,
    );
    if (unlockedBlueprints.length > 0) {
      lines.push(`· 已授权挂载主基地生产蓝图：${unlockedBlueprints.join('、')}`);
    }
    if (!isSilentStandby) {
      const mobileSwHints = buildMobileSuperweaponSynergyHints(vehicleList);
      for (const hint of mobileSwHints) {
        lines.push(hint);
      }
    }
    lines.push(`· 在编机娘：${girlsSummary}`);
    const incMode = feed.effectiveMaidenIncubationMode ?? 'iconic_plus_blindbox';
    const incLabel =
      incMode === 'full_blindbox'
        ? '全员自由盲盒（含MCV，初诞一律以 待授名·编号 报到，待指挥官赐名转正）'
        : incMode === 'preset_roster'
          ? '省心预设名册（首台机娘直接采用世界书 <数据> 的 preset_name 入列）'
          : '经典MCV与传奇英雄镇场＋常规兵种首台战地盲盒孵化（出厂先以 待授名·编号 报到，由指挥官亲自赐名后通过 <机娘档案> 附 rename_from 与 serial 原地转正覆写）';
    lines.push(
      `· 机娘孵化与 <机娘档案> 同构数据块契约：当前模式为【${incLabel}】。凡主动输出 <机娘档案>（新机娘孵化或赐名转正），字段必须与世界书 <数据> 块 1:1 严格同构——必填 \`name\`(名称)、\`rename_from\`(赐名前旧称，转正必填)、\`model\`(型号)、\`faction\`(阵营)、\`tier\`(1|2|3)、\`incubation_mode\`(iconic_fixed|blindbox_christen)、\`callsign\`(代号)、\`serial\`(编号)、\`form_mech\`(形态机制)、\`temperament_spectrum\`(机魂光谱)、\`special_skills\`(对象数组：\`[{ name, kind: 核心权能|战术专精|被动特性|协同力场, desc }]\`)、\`special_equipment\`(主副武器与挂载对象数组：\`[{ name, slot: 主武器|副武器|核心挂载|战术套件|随身武备, desc }]\`)、\`flaws\`(结构性短板)、\`exposure_grade\`(暴露分档)、\`balance_slot\`(平衡总纲位置) 及 \`appearance\`/\`personality\`/\`shell\`/\`status\`/\`keys\`！`,
    );
    const pendingChristenGirls = (data.forces?.girls ?? [])
      .map(g => String(g.name ?? '').trim())
      .filter(n => n.startsWith('待授名'));
    if (!isSilentStandby && pendingChristenGirls.length > 0) {
      lines.push(
        `· ★ [待授名机娘赐名转正督办] 当前在编存在待授名机娘（${pendingChristenGirls.join('、')}）：若指挥官在本轮输入中为其赐予真名/代号，当轮必须输出完整 <机娘档案>（必填 \`rename_from\`、\`serial\`，以及 \`special_skills: [{ name, kind: 核心权能|战术专精|被动特性, desc }]\` 技能数组与 \`special_equipment: [{ name, slot: 主武器|副武器|核心挂载|随身武备, desc }]\` 主副武器数据块），完成原地转正并写入世界书！`,
      );
    }
    if (!isSilentStandby) {
      const registeredGirlNames = Array.from(
        new Set((data.forces?.girls ?? []).map(g => String(g.name ?? '').trim()).filter(Boolean)),
      ).slice(0, 12);
      const registeredPersonNames = Array.from(
        new Set(
          (data.codex ?? [])
            .filter(c => c.kind === '人员' || c.kind === '人物')
            .map(c => String(c.name ?? '').trim())
            .filter(Boolean),
        ),
      ).slice(0, 12);
      const girlNames = registeredGirlNames.length > 0 ? registeredGirlNames.join('、') : '暂无';
      const personNames = registeredPersonNames.length > 0 ? registeredPersonNames.join('、') : '暂无';
      lines.push(
        `· [档案写入边界锁] 已在册机娘（${girlNames}）日常状态/好感变动仅输出 <机娘>，严禁混入 <扩展档案>/<图鉴>；已在册人员/人物（${personNames}）仅在态度/信任度/驻地发生实质跃迁时输出 <扩展档案>(类别:人物) 增量更新；世界书既有标准科技/建筑/兵种严禁写入 <图鉴>/<扩展档案>（既有装备改造一律走 <数据更新>）。凡战局原创首创的全新 科技/载具/人员/建筑/装备 写入 <扩展档案> 时，必须附带完整结构化参数（科技必填 {造价, 工期, 科技层级, 研究线, 所需建筑, 前置科技, 解锁产物}，载具/人员/装备必填 {造价, 工期, 科技层级, 所属阵营, 生产建筑, 前置科技, 主武器, 副武器, 战术特长}，建筑必填 {造价, 耗电, 工期, 科技层级, 所属阵营, 职能分类, 前置科技, 所需建筑}），供底层自动合成为标准世界书 <数据> 块接入科技树与生产列表！`,
      );
    }
  }

  // ── 板块五：在途作战任务、情报渠道与宏观世界暗流（FD-33 / FD-47 / FD-48 扩展） ──
  const activeQuests = data.quests?.active ?? [];
  const questSummary =
    activeQuests.length > 0
      ? activeQuests
          .map(q => {
            const cq = q as ChainAwareQuest;
            const chainPart =
              cq.series || cq.chain_step
                ? `系列:${cq.series || '任务链'}${cq.chain_step ? `·${cq.chain_step}` : ''}｜`
                : '';
            const rewardCompact = formatQuestRewardCompact(q.rewards);
            const issuerPart = q.issuer ? `发包方:${q.issuer}｜` : '';
            const rewardPart = rewardCompact ? `｜承诺悬赏:${rewardCompact}` : '';
            const nextPart = cq.next_quest ? `｜下一环线索:${cq.next_quest}` : '';
            return `[${q.category ?? '支线'}]${q.name}(${chainPart}${issuerPart}进度:${q.progress || '进行中'}｜要点:${q.note || '推进中'}${rewardPart}${nextPart})`;
          })
          .join('；')
      : '当前无在途任务（可根据战局发布新作战任务）';
  const factionSummary =
    (data.factions ?? []).map(f => `${f.name}[${f.attitude}]`).join('、') || '暂未接触周边势力';
  lines.push(
    `【五、作战任务与外交势力】在途任务(${activeQuests.length}｜累计完成:${data.quests?.done_count ?? 0})：${questSummary}｜周边势力：${factionSummary}`,
  );

  const userQuestIntent = feed.userQuestIntent ?? detectUserQuestIntent(undefined, activeQuests);
  if (userQuestIntent?.targetedActiveQuestName) {
    const targetQuest =
      activeQuests.find(q => canon(q.name) === canon(userQuestIntent.targetedActiveQuestName!)) ??
      activeQuests.find(q => canon(q.name).includes(canon(userQuestIntent.targetedActiveQuestName!)));
    if (targetQuest) {
      lines.push(
        `· ★ [本轮玩家点名督办任务] 指挥官本轮明确推进「${targetQuest.name}」——请根据本轮正文战果更新其 <任务> 进度，若目标已全部达成请将状态设为「已完成」并完整兑现承诺悬赏（${formatQuestRewardCompact(targetQuest.rewards) || '原定悬赏'}）！`,
      );
    }
  }

  const chainContinuations =
    feed.chainContinuations ??
    (!isPrologueUnbound && !isSilentStandby
      ? detectPendingChainContinuations(data, { advisorRoster })
      : []);
  if (!isPrologueUnbound && !isSilentStandby && chainContinuations.length > 0) {
    const contText = chainContinuations
      .slice(0, 2)
      .map(
        c =>
          `★ [系列任务下一环续接契机] 系列《${c.seriesName}》已完成第 ${c.completedStepLabel} 环「${c.completedQuestName}」——建议顺延前文线索（${c.nextQuestHook}）并结合当前现场态势自主发挥开启第 ${c.nextStepLabel} 环（推荐发包方：${c.recommendedIssuer}｜建议奖励梯度参考：${c.rewardHint}；预设方向仅作参考，严禁机械照抄参考标题）`,
      )
      .join('；');
    lines.push(
      `· ★ [系列任务下一环续接契机（请顺延前文线索与现场态势自主发挥下一环命名与剧情）]：${contText}`,
    );
  }

  const questRecommendations =
    feed.questRecommendations ??
    recommendPresetQuestArchetypes(data, {
      campaignPhase: feed.campaignPhase,
      advisorRoster,
      dailyNetCredits,
    });
  const hasIntelHookRec = questRecommendations.some(r => r.archetype.id === 'Q-INTEL-01');
  const shouldShowQuestRecs =
    !isPrologueUnbound &&
    !isSilentStandby &&
    questRecommendations.length > 0 &&
    (activeQuests.length === 0 ||
      (activeQuests.length === 1 && activeQuests.every(q => q.category === '主线')) ||
      Boolean(userQuestIntent?.wantsNewQuest) ||
      hasIntelHookRec);

  if (shouldShowQuestRecs) {
    const recItemsText = questRecommendations
      .slice(0, 2)
      .map((rec, idx) => {
        const numTag = idx === 0 ? '①' : '②';
        return `${numTag} [${rec.archetype.category}·${rec.archetype.id}] 参考方向：「${rec.archetype.archetypeName}」（推荐发包方：${rec.recommendedIssuer}｜触发缘由：${rec.triggerReason}｜阶段目标参考：${rec.tailoredObjectiveHint}｜推荐奖励配方：${rec.tailoredRewardHint}）`;
      })
      .join('；');
    lines.push(
      `· ★ [参谋部候选派发任务提案（可结合剧情地名在本轮按需输出 <任务> 发布）]：（仅作战术方向与奖励结构参考，严禁机械照抄参考标题，请务必结合现场态势、地貌与剧情自主发挥任务名称、系列归属与具体情节）${recItemsText}`,
    );
  }

  if (activeQuests.length >= 3 && !userQuestIntent?.wantsNewQuest) {
    lines.push(
      `· [任务节奏护栏] 当前已有 ${activeQuests.length} 项在途任务，请优先围绕既有任务推进或完结交割，本轮暂缓盲目派发新支线。`,
    );
  }

  const allBldNames = (data.bases ?? []).flatMap(b => (b.buildings ?? []).map(x => x.name)).join(' ');
  const availableChannels: string[] = ['前线目视', '宏观广播'];
  if (/雷达|空指|空军指挥部|卫星|预警|实验室/.test(allBldNames)) availableChannels.push('雷达侦察');
  if (/通讯|雷达|空指|空军指挥部|心灵|感应/.test(allBldNames)) availableChannels.push('电讯截获');
  if (/暗网|中继/.test(allBldNames)) availableChannels.push('暗网流言');
  if ((data.factions ?? []).some(f => f.attitude === '友善') || /间谍|特工/.test(Object.keys(data.forces?.troops ?? {}).join(' '))) {
    availableChannels.push('渗透内线');
  }
  const intelPool = data.intel ?? [];
  const formatTacticalIntelChainBadge = (it: (typeof intelPool)[number]): string => {
    const ci = it as ChainAwareIntelItem;
    const chainStr = String(ci.chain ?? '').trim();
    const stepStr = String(ci.chain_step ?? '').trim();
    const leadStr = String(ci.next_lead ?? ci.hook ?? '').trim();
    const chainBadge =
      chainStr || stepStr ? `{链:${chainStr || '情报链'}${stepStr ? `·${stepStr}` : ''}}` : '';
    const leadBadge = leadStr ? `(线索:${leadStr.slice(0, 20)})` : '';
    return `${chainBadge}${leadBadge}`;
  };
  const pinnedOrVerifiedIntels = [...intelPool]
    .filter(
      it =>
        it.scope !== 'world' &&
        it.status !== '已证伪' &&
        (it.pinned === true || (it.status === '已证实' && it.cred === '高')),
    )
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    .slice(0, 3)
    .map(
      it =>
        `${it.pinned ? '📌[置顶·' : '['}${it.src_kind || it.src || '线报'}·${it.status === '已证实' ? '已证实' : it.cred}]${it.title || it.content.slice(0, 24)}${formatTacticalIntelChainBadge(it)}`,
    );
  const pendingTacticalIntels = intelPool
    .filter(it => it.scope !== 'world' && it.status !== '已证伪' && (it.status === '待核实' || it.cred !== '高'))
    .slice(0, 3)
    .map(
      it =>
        `${it.pinned ? '📌' : ''}[${it.src_kind || it.src || '线报'}·${it.cred}]${it.title || it.content.slice(0, 24)}${formatTacticalIntelChainBadge(it)}`,
    );
  const activeWorldEvos = intelPool
    .filter(it => it.scope === 'world' && it.stage !== '平息')
    .slice(0, 3)
    .map(
      it =>
        `${it.pinned ? '📌' : ''}[${it.evo_domain ?? '远方地缘'}·${it.stage ?? '萌芽'}·余${it.ttl_floors ?? 5}轮]${it.title || it.content.slice(0, 24)}${it.hook ? `(伏笔:${it.hook.slice(0, 20)})` : ''}`,
    );
  const pulseHint = isPrologueUnbound
    ? '当前处于原世界穿越前夕：尚未进入目标战区，本轮严禁输出异界 <世界演变> 或跨时空 <情报>'
    : activeWorldEvos.length === 0 || feed.floorId % 2 === 0
      ? '本轮已达脉冲窗口：可按需输出 1 条 <世界演变>（四象限选一）或推进在途演变阶段'
      : '本轮处于脉冲冷却期：除非剧情直接触发，否则无需新增 <世界演变>';
  const keyIntelClause =
    pinnedOrVerifiedIntels.length > 0
      ? `｜置顶/已证实关键情报(${pinnedOrVerifiedIntels.length})：${pinnedOrVerifiedIntels.join('；')}`
      : '';
  lines.push(
    `· 【情报渠道与世界暗流】可用渠道：${availableChannels.join('、')}${keyIntelClause}｜待印证线报(${pendingTacticalIntels.length})：${pendingTacticalIntels.join('；') || '无'}｜在途世界演变(${activeWorldEvos.length})：${activeWorldEvos.join('；') || '暂无'}｜脉冲节律：${pulseHint}`,
  );

  const intelChainHints =
    feed.intelChainHints ??
    (!isPrologueUnbound && !isSilentStandby
      ? detectPendingIntelChains(data, { availableChannels })
      : []);
  if (!isPrologueUnbound && !isSilentStandby) {
    const stepContinuations = intelChainHints.filter(h => h.kind === 'step_continuation');
    const verifiedConversions = intelChainHints.filter(h => h.kind === 'verified_conversion');

    if (stepContinuations.length > 0) {
      const stepText = stepContinuations
        .slice(0, 2)
        .map(h => {
          const chText =
            h.recommendedNextChannels.length > 0
              ? h.recommendedNextChannels.join('/')
              : '异源侦察渠道';
          return `情报链《${h.chainName}》当前处于第 ${h.currentStepLabel} 阶「${h.intelTitle}」（原渠道：${h.currentChannel}）——建议通过异源渠道【${chText}】交叉印证升阶至第 ${h.nextStepLabel} 阶（下一阶核查线索：${h.nextLeadHook}；终局转化潜力：${h.conversionTargetHint}）`;
        })
        .join('；');
      lines.push(
        `· ★ [在途情报链交叉印证契机（请顺延前文线索与现场态势自主发挥下一阶内容，预设方向仅作参考，严禁机械照抄）]：${stepText}`,
      );
    }

    if (verifiedConversions.length > 0) {
      const convText = verifiedConversions
        .slice(0, 2)
        .map(
          h =>
            `情报链《${h.chainName}》（「${h.intelTitle}」·第 ${h.currentStepLabel} 阶·${h.currentChannel}）已核实水落石出——建议结合实锤线索（${h.nextLeadHook}）水到渠成转化：${h.conversionTargetHint}！`,
        )
        .join('；');
      lines.push(`· ★ [情报水落石出·战略转化契机]：${convText}`);
    }

    if (stepContinuations.length === 0) {
      lines.push(
        '· [开放式多阶情报链方向参考（仅作「1/3捕风捉影[低]->2/3交叉印证[中]->3/3水落石出[高]」节奏与渠道搭配参考，严禁机械照抄参考标题，请结合当前现场态势、地貌与敌情自主发挥）]：可结合已解锁渠道围绕休眠重工/信标溯源、敌方集结侦察、暗网反渗透甄别或特种矿脉勘测埋设或推进多阶 <情报> 溯源链。',
      );
    }
  }

  const userIntelIntent = feed.userIntelIntent;
  if (userIntelIntent?.targetedIntelTitle) {
    const targetIntel = intelPool.find(it => {
      if (it.scope === 'world') return false;
      const ci = it as ChainAwareIntelItem;
      const label = String(it.title || it.content || '').trim();
      const chainStr = String(ci.chain ?? '').trim();
      const targetCanon = canon(userIntelIntent.targetedIntelTitle!);
      return (
        canon(label) === targetCanon ||
        canon(label).includes(targetCanon) ||
        targetCanon.includes(canon(it.title || label.slice(0, 12))) ||
        (chainStr.length > 0 &&
          (canon(chainStr) === targetCanon ||
            canon(chainStr).includes(targetCanon) ||
            targetCanon.includes(canon(chainStr))))
      );
    });
    const intelTitle = targetIntel?.title || targetIntel?.content?.slice(0, 24) || userIntelIntent.targetedIntelTitle;
    const intelSrc = targetIntel?.src_kind || targetIntel?.src || '战区线报';
    const intelStatus = targetIntel?.status ?? '待核实';
    const intelCred = targetIntel?.cred ?? '中';
    lines.push(
      `· ★ [本轮玩家点名核查情报] 指挥官本轮明确下令核查【${intelSrc}】线报「${intelTitle}」（当前状态：${intelStatus}·可信度${intelCred}）——请根据本轮正文侦察/核实结果输出 <情报> 更新其状态（核实无误则设为「已证实」并将可信度升至「高」，可同步派生或推进相关 <任务>；若系假情报则设为「已证伪」）！`,
    );
  }
  if (userIntelIntent?.targetedWorldEvoTitle) {
    const targetEvo = intelPool.find(it => {
      if (it.scope !== 'world') return false;
      const label = String(it.title || it.content || '').trim();
      return (
        canon(label) === canon(userIntelIntent.targetedWorldEvoTitle!) ||
        canon(label).includes(canon(userIntelIntent.targetedWorldEvoTitle!)) ||
        canon(userIntelIntent.targetedWorldEvoTitle!).includes(canon(it.title || label.slice(0, 12)))
      );
    });
    const evoTitle = targetEvo?.title || targetEvo?.content?.slice(0, 24) || userIntelIntent.targetedWorldEvoTitle;
    const evoDomain = targetEvo?.evo_domain ?? '远方地缘';
    const evoStage = targetEvo?.stage ?? '萌芽';
    lines.push(
      `· ★ [本轮玩家点名介入世界暗流] 指挥官本轮明确针对宏观暗流「${evoTitle}」（${evoDomain}·当前阶段：${evoStage}）展开先遣侦察或切入干预——请在本轮正文中描写侦察/介入反馈，并在文末输出 <世界演变>（或转化派生前线 <情报>/<任务>）推进其演进阶段！`,
    );
  }

  // ── 板块六：前端确定性「八维组合战术诊断结论」 ──
  lines.push(`【六、前端八维组合战术诊断（供参谋席分析短板与下一步行动）】`);
  if (comboFindings.length === 0) {
    lines.push('· 当前战区产线、电力与部队运转平稳，可围绕主线探索或科技升级继续推进。');
  } else {
    comboFindings.forEach((f, idx) => {
      lines.push(
        `${idx + 1}. [${f.priority}·${f.focusTag}] ${f.title} —— 诊断：${f.diagnosis} 👉 建议动作：${f.recommendedAction}`,
      );
    });
  }

  // ── 板块七：MCV 机娘/人类参谋席路由与 <态势>「参谋建议」输出指令 ──
  lines.push(...formatActiveSeatsSection(advisorRoster, feed.campaignPhase));
  if (!isPrologueUnbound && !feed.engineeringAndSpaceEnabled) {
    lines.push(
      '· 【工程与商业航天生产态门禁】长期工程（<工程>）与商业航天（<航天合同>）当前处于生产环境默认关闭态（存档无在建工程或航天资产）：除非指挥官在本轮输入中明确下达【工程】或【航天】指令，否则本轮「参谋建议」与正文严禁主动催促立项 <工程> 或签署 <航天合同>！',
    );
  }

  return lines.join('\n');
}

/** FD-38：格式化单个基地的防区与环境工程摘要行（若无防区则返回空串） */
export function formatBaseSectorsSummary(base: { sectors?: unknown[] } | null | undefined): string {
  const rawSectors = base?.sectors;
  if (!Array.isArray(rawSectors) || rawSectors.length === 0) return '';
  const names = rawSectors
    .map(s => {
      if (typeof s === 'string') return s.trim();
      if (s && typeof s === 'object') return String((s as Record<string, unknown>).name ?? '').trim();
      return '';
    })
    .filter(Boolean);
  if (names.length === 0) return '';
  return `防区工程：${names.join('、')}`;
}

/** FD-38：兼容 buildStrategicFeedforwardText 调用签名（支持传入 StrategicFeedforward 或 StatData） */
export function buildStrategicFeedforwardText(
  input: StrategicFeedforward | StatData,
  overlays: readonly DlcOverlay[] = [],
): string {
  if (input && typeof input === 'object' && 'floorId' in input && 'data' in input) {
    return formatStrategicFeedforwardPrompt(input as StrategicFeedforward);
  }
  const derived = deriveStrategicFeedforward(
    {
      floorId: 0,
      schemaVersion: 2 as typeof SCHEMA_VERSION,
      data: input as StatData,
    },
    overlays,
  );
  return derived ? formatStrategicFeedforwardPrompt(derived) : '';
}

/* ═══════════════ 6. 注入配置常量与 AFTER_COMMANDS 组合入口 ═══════════════ */

export const STRATEGIC_FEEDFORWARD_INJECT_ID = 'tavernweave.strategic-feedforward.v1';

export const STRATEGIC_FEEDFORWARD_INJECT_CONFIG = {
  id: STRATEGIC_FEEDFORWARD_INJECT_ID,
  position: 'in_chat',
  depth: 0,
  role: 'system',
  should_scan: false,
} as const;

export type StrategicFeedforwardInjection = typeof STRATEGIC_FEEDFORWARD_INJECT_CONFIG & {
  content: string;
};

export function buildStrategicFeedforwardInjection(
  feed: StrategicFeedforward,
): StrategicFeedforwardInjection {
  return {
    ...STRATEGIC_FEEDFORWARD_INJECT_CONFIG,
    content: formatStrategicFeedforwardPrompt(feed),
  };
}

export interface StrategicFeedforwardPlan {
  entry: GenerationEntry;
  scanStart: number;
  snapshot: FloorSnapshot;
  feedforward: StrategicFeedforward;
  injection: StrategicFeedforwardInjection;
}

/**
 * 一次 `GENERATION_AFTER_COMMANDS` 的完整纯推导：
 * 生成类型判定 → 扫描起点 → 最近有效楼 → 全局七大板块与八维组合诊断 → 注入配置。
 */
export function planStrategicFeedforward(input: {
  generation: GenerationDescriptor;
  lastMessageId: number;
  readFloor: (id: number) => FloorCandidate | null;
  overlays: readonly DlcOverlay[];
  dynamicWb?: ParsedWorldbookCatalog | DynamicWorldbookCatalog | null;
  options?: StrategicFeedforwardOptions;
  bootChoices?: BootChoicesHint | null;
  latestUserMessage?: string;
  preferences?: Partial<FeedforwardPreferences>;
  debugEnabled?: boolean;
}): StrategicFeedforwardPlan | null {
  const mergedOptions: StrategicFeedforwardOptions | undefined =
    input.options ||
    input.bootChoices !== undefined ||
    input.latestUserMessage !== undefined ||
    input.preferences !== undefined ||
    input.debugEnabled !== undefined
      ? {
          bootChoices: input.options?.bootChoices ?? input.bootChoices,
          latestUserMessage: input.options?.latestUserMessage ?? input.latestUserMessage,
          preferences: input.options?.preferences ?? input.preferences,
          debugEnabled: input.options?.debugEnabled ?? input.debugEnabled,
        }
      : undefined;

  if (mergedOptions?.preferences?.enabled === false) return null;

  const entry = resolveGenerationEntry(input.generation);
  if (!entry) return null;
  const scanStart = resolveScanStart(entry, input.lastMessageId);
  const pair: FloorSnapshotPair | null = scanLatestFloorPair(scanStart, input.readFloor);
  if (!pair) return null;
  const snapshot = pair.current;
  const prevData =
    input.options?.prevData !== undefined ? input.options.prevData : (pair.previous?.data ?? null);
  const feedforward = deriveStrategicFeedforward(snapshot, input.overlays, input.dynamicWb, {
    ...mergedOptions,
    prevData,
  });
  if (!feedforward) return null;
  return {
    entry,
    scanStart,
    snapshot,
    feedforward,
    injection: buildStrategicFeedforwardInjection(feedforward),
  };
}
