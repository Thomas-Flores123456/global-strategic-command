/**
 * presetPromptManager.ts —— 战区中控预设提示词托管器与跨角色卡全局守护桥接
 *
 * 核心职责：
 * 1. 自动识别并关闭当前使用预设（'in_use'）中的内置“摘要/总结”冲突条目，并记录原启用快照以支持精确还原；
 * 2. 自适应探测当前预设的正文包裹标签（如 `<正文>...</正文>` vs `<scenario>...</scenario>`）；
 * 3. 在预设“思维链 / 思维链结束”锚点之后插入【增量思维链校准（补充不替代）】条目（`rac_preset_cot_augment_v1`）；
 * 4. 在 TauriTavern 宿主下实时感知 Agent Mode（`agentModeEnabled`），开启时自动启用【TT-Agent 单次整体规划与四阶段生成规约】条目（`rac_tt_agent_four_phase_v1`），关闭或传统酒馆下自动禁用；
 * 5. 通过 `initializeGlobal('RAC_CONSOLE_GUARD', ...)` 与宿主窗口全局句柄声明中控台在线状态，并自动在酒馆助手注册无 UI 的全局守护脚本（`🎖️[战区中控] 预设跨卡自动还原守护`）：当玩家切换到不含中控台的其他角色卡/聊天时，自动关闭中控预设条目并重新开启预设里的摘要条目。
 */

import {
  isTauriTavernAgentModeEnabled,
  isTauriTavernEnvironment,
  resolveTauriTavernWindow,
  subscribeTauriTavernAgentMode,
  type TauriTavernHostUnsubscribe,
} from './ttHostBridge';
import { setFloorTagRepairEnabled } from '../cards/floorCardHydrator';

export const RAC_COT_AUGMENT_PROMPT_ID = 'rac_preset_cot_augment_v1';
export const RAC_COT_AUGMENT_PROMPT_NAME =
  '🎖️[战区中控] 增量思维链校准（补充不替代）';

export const RAC_TT_AGENT_FOUR_PHASE_PROMPT_ID = 'rac_tt_agent_four_phase_v1';
export const RAC_TT_AGENT_FOUR_PHASE_PROMPT_NAME =
  '🤖[TT-Agent专享] 单次整体规划与四阶段生成规约';

export const RAC_CONSOLE_GLOBAL_GUARD_NAME = 'RAC_CONSOLE_GUARD';
export const RAC_GLOBAL_WATCHDOG_SCRIPT_ID = 'rac_global_preset_watchdog_v1';
export const RAC_GLOBAL_WATCHDOG_SCRIPT_NAME =
  '🎖️[战区中控] 预设跨卡自动还原守护';

export const RAC_PRESET_MANAGER_STORAGE_KEY =
  'rac_preset_prompt_manager_state_v1';

const SYSTEM_AND_PLACEHOLDER_IDS = new Set([
  'main',
  'nsfw',
  'jailbreak',
  'enhanceDefinitions',
  'worldInfoBefore',
  'personaDescription',
  'charDescription',
  'charPersonality',
  'scenario',
  'worldInfoAfter',
  'dialogueExamples',
  'chatHistory',
  'agentSystemPrompt',
  'agentResults',
  'agentTask',
]);

const MANAGED_PROMPT_IDS = new Set([
  RAC_COT_AUGMENT_PROMPT_ID,
  RAC_TT_AGENT_FOUR_PHASE_PROMPT_ID,
]);

export interface PresetPromptItem {
  id: string;
  name: string;
  enabled: boolean;
  role: 'system' | 'user' | 'assistant';
  position?:
    | { type: 'relative'; depth?: never; order?: never }
    | { type: 'in_chat'; depth: number; order: number };
  content?: string;
  extra?: Record<string, unknown>;
}

export interface PresetObject {
  settings?: Record<string, unknown>;
  prompts: PresetPromptItem[];
  prompts_unused?: PresetPromptItem[];
  extensions?: Record<string, unknown>;
}

export type PresetProfileKind =
  | 'kemini_dramatron_uau'
  | 'kemini_dramatron'
  | 'kemini_aether'
  | 'generic';

export interface PresetScenarioTagSpec {
  mode: 'zhengwen' | 'scenario' | 'adaptive';
  openTag: string;
  closeTag: string;
  normRef: string;
  requirementsRef: string;
}

export interface PresetManagerPreferences {
  /** 是否启用预设自动托管总开关（默认 true） */
  enabled: boolean;
  /** 是否自动关闭预设内置“摘要/总结”冲突条目（默认 true） */
  autoDisableSummary: boolean;
  /** 是否注入增量思维链补充条目（默认 true） */
  injectCotSupplement: boolean;
  /** 是否在 TauriTavern Agent 模式下自动启用四阶段生成规约条目（默认 true） */
  autoManageTtAgentPrompt: boolean;
  /** 是否自动注册跨角色卡全局还原守护脚本（默认 true） */
  installGlobalWatchdog: boolean;
}

export interface PresetManagerPersistedState {
  preferences: PresetManagerPreferences;
  /** 按预设名称记录被中控台自动关闭的摘要条目 ID 列表，供还原使用 */
  disabledSummaryIdsByPreset: Record<string, string[]>;
  /** 按预设名称记录被中控台自动禁用的冲突预设正则 ID 列表（如【夏瑾】行动选项1/2），供切卡还原 */
  disabledPresetRegexIdsByPreset?: Record<string, string[]>;
  lastSyncedPresetName: string | null;
  lastSyncedAt: number | null;
}

export interface PresetSyncReceipt {
  presetName: string;
  detectedProfile?: PresetProfileKind;
  isTauriTavern: boolean;
  ttAgentModeEnabled: boolean;
  detectedTagSpec: PresetScenarioTagSpec;
  disabledSummaryPrompts: Array<{ id: string; name: string }>;
  restoredSummaryPrompts: Array<{ id: string; name: string }>;
  disabledPresetRegexes?: Array<{ id: string; name: string }>;
  restoredPresetRegexes?: Array<{ id: string; name: string }>;
  cotPromptEnabled: boolean;
  cotInsertIndex: number;
  ttAgentPromptEnabled: boolean;
  ttAgentInsertIndex: number;
  globalWatchdogInstalled: boolean;
  changed: boolean;
}

export interface ConsoleGlobalGuardHandle {
  version: string;
  isActive: () => boolean;
  mountedAt: number;
  getPresetName: () => string;
  deactivateForForeignCard: () => Promise<boolean>;
}

export interface PresetPromptManagerDeps {
  getLoadedPresetName: () => string;
  getPreset: (name: string) => PresetObject;
  updatePresetWith: (
    name: string,
    updater: (preset: PresetObject) => PresetObject | Promise<PresetObject>,
    options?: { render?: 'debounced' | 'immediate' | 'none' },
  ) => Promise<PresetObject>;
  getScriptTrees?: (option: {
    type: 'global' | 'preset' | 'character';
  }) => Array<Record<string, unknown>>;
  updateScriptTreesWith?: (
    updater: (
      trees: Array<Record<string, unknown>>,
    ) => Array<Record<string, unknown>>,
    option: { type: 'global' | 'preset' | 'character' },
  ) => unknown;
  initializeGlobal?: (name: string, value: unknown) => void;
  eventOn?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  eventRemoveListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
  events?: {
    PRESET_CHANGED?: string;
    CHAT_CHANGED?: string;
    MAIN_API_CHANGED?: string;
  };
  isTauriTavern?: () => boolean;
  isTtAgentModeEnabled?: () => Promise<boolean>;
  subscribeTtAgentMode?: (
    handler: (enabled: boolean) => void,
  ) => TauriTavernHostUnsubscribe;
  hostWindow?: Record<string, unknown> | null;
}

export const DEFAULT_PRESET_MANAGER_PREFERENCES: PresetManagerPreferences =
  Object.freeze({
    enabled: true,
    autoDisableSummary: true,
    injectCotSupplement: true,
    autoManageTtAgentPrompt: true,
    installGlobalWatchdog: true,
  });

function resolveTopSameOriginWindow(
  startWin?: unknown,
): (Window & typeof globalThis & Record<string, unknown>) | null {
  const ttWin = resolveTauriTavernWindow(startWin);
  if (ttWin) {
    return ttWin as Window & typeof globalThis & Record<string, unknown>;
  }
  let cur: unknown =
    startWin !== undefined
      ? startWin
      : typeof window !== 'undefined'
        ? window
        : globalThis;
  for (let depth = 0; depth <= 4; depth++) {
    if (!cur || typeof cur !== 'object') break;
    const rec = cur as Record<string, unknown>;
    try {
      const parent = rec.parent;
      if (!parent || parent === cur) {
        return rec as Window & typeof globalThis & Record<string, unknown>;
      }
      // Verify same-origin access on parent.document
      void (parent as Window).document;
      cur = parent;
    } catch {
      return rec as Window & typeof globalThis & Record<string, unknown>;
    }
  }
  return typeof window !== 'undefined'
    ? (window as unknown as Window & typeof globalThis & Record<string, unknown>)
    : null;
}

export function loadPresetManagerState(
  hostWin?: Record<string, unknown> | null,
): PresetManagerPersistedState {
  const defaultState: PresetManagerPersistedState = {
    preferences: { ...DEFAULT_PRESET_MANAGER_PREFERENCES },
    disabledSummaryIdsByPreset: {},
    disabledPresetRegexIdsByPreset: {},
    lastSyncedPresetName: null,
    lastSyncedAt: null,
  };
  try {
    const win = hostWin ?? resolveTopSameOriginWindow();
    const storage =
      (win?.localStorage as Storage | undefined) ??
      (typeof localStorage !== 'undefined' ? localStorage : undefined);
    const raw = storage?.getItem(RAC_PRESET_MANAGER_STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<PresetManagerPersistedState>;
    return {
      preferences: {
        ...DEFAULT_PRESET_MANAGER_PREFERENCES,
        ...(parsed.preferences ?? {}),
      },
      disabledSummaryIdsByPreset:
        parsed.disabledSummaryIdsByPreset &&
        typeof parsed.disabledSummaryIdsByPreset === 'object'
          ? { ...parsed.disabledSummaryIdsByPreset }
          : {},
      disabledPresetRegexIdsByPreset:
        parsed.disabledPresetRegexIdsByPreset &&
        typeof parsed.disabledPresetRegexIdsByPreset === 'object'
          ? { ...parsed.disabledPresetRegexIdsByPreset }
          : {},
      lastSyncedPresetName:
        typeof parsed.lastSyncedPresetName === 'string'
          ? parsed.lastSyncedPresetName
          : null,
      lastSyncedAt:
        typeof parsed.lastSyncedAt === 'number' ? parsed.lastSyncedAt : null,
    };
  } catch {
    return defaultState;
  }
}

export function savePresetManagerState(
  state: PresetManagerPersistedState,
  hostWin?: Record<string, unknown> | null,
): void {
  const json = JSON.stringify(state);
  try {
    const win = hostWin ?? resolveTopSameOriginWindow();
    const topStorage = win?.localStorage as Storage | undefined;
    topStorage?.setItem(RAC_PRESET_MANAGER_STORAGE_KEY, json);
  } catch {
    // ignore top storage errors
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RAC_PRESET_MANAGER_STORAGE_KEY, json);
    }
  } catch {
    // ignore local storage errors
  }
}

/**
 * 判断条目是否为普通可管理预设条目（排除系统提示词、占位提示词及中控自身注入条目）
 */
export function isNormalThirdPartyPrompt(prompt: PresetPromptItem): boolean {
  if (!prompt || typeof prompt !== 'object') return false;
  const id = String(prompt.id ?? '').trim();
  if (!id) return false;
  if (SYSTEM_AND_PLACEHOLDER_IDS.has(id)) return false;
  if (MANAGED_PROMPT_IDS.has(id)) return false;
  return true;
}

/**
 * 识别预设内置的“摘要/总结”条目（包含单轮摘要、大总结放置、总结前文等）
 */
export function isSummaryPromptEntry(prompt: PresetPromptItem): boolean {
  if (!isNormalThirdPartyPrompt(prompt)) return false;
  const name = String(prompt.name ?? '').trim();
  const content = String(prompt.content ?? '');
  if (/摘要|总结|summary/i.test(name)) {
    return true;
  }
  if (
    /<summary_format>|<summary_rules>|<Previoushistory_summary>/i.test(content)
  ) {
    return true;
  }
  return false;
}

/**
 * 识别预设中的“常规随文摘要”条目（如 `📑摘要` / `<summary_format>`），
 * 排除会劫持整轮生成任务的 `总结前文（用完关）` / `[TASK CHANGED]` 与空壳 `大总结放置`。
 * 当玩家切换到其他角色卡且无历史快照时，守护脚本会安全开启此类常规摘要条目。
 */
export function isRegularPerTurnSummaryEntry(
  prompt: PresetPromptItem,
): boolean {
  if (!isSummaryPromptEntry(prompt)) return false;
  const name = String(prompt.name ?? '').trim();
  const content = String(prompt.content ?? '');
  if (/用完关|大总结放置|TASK\s*CHANGED|总结请求/i.test(name + '\n' + content)) {
    return false;
  }
  if (/<Previoushistory_summary>/i.test(content)) {
    return false;
  }
  return (
    /<summary_format>|<summary>/i.test(content) ||
    /^(?:📑|📝|📌|\s)*(?:摘要|单轮摘要|剧情摘要|小总结|summary)$/i.test(name)
  );
}

/**
 * 自适应探测当前预设的正文包裹标签与规范引用名称：
 * - 若预设条目中使用 `<正文>` / `</正文>`（如 Kemini Aether 预设的 `⚙️正文添加标签`），则自适应为 `<正文>`；
 * - 若预设条目中使用 `<scenario>` / `</scenario>` 或 `<scenario_norm>`，则自适应为 `<scenario>`；
 * - 否则返回双兼容自适应描述。
 */
export function detectPresetScenarioTag(
  prompts: PresetPromptItem[],
): PresetScenarioTagSpec {
  const candidates = (prompts ?? []).filter(isNormalThirdPartyPrompt);
  const enabledCandidates = candidates.filter(p => p.enabled);
  const searchList =
    enabledCandidates.length > 0 ? enabledCandidates : candidates;

  for (const p of searchList) {
    const content = String(p.content ?? '');
    if (/<正文>[\s\S]*?<\/正文>/.test(content) || /正文标签/.test(p.name ?? '')) {
      return {
        mode: 'zhengwen',
        openTag: '<正文>',
        closeTag: '</正文>',
        normRef: '<content_format> 与 <Creating_guidance>',
        requirementsRef: '<content_constraints>',
      };
    }
    if (
      /<scenario>[\s\S]*?<\/scenario>/i.test(content) ||
      /<scenario_norm>/i.test(content)
    ) {
      return {
        mode: 'scenario',
        openTag: '<scenario>',
        closeTag: '</scenario>',
        normRef: '<scenario_norm>',
        requirementsRef: '<output_requirements>',
      };
    }
  }

  return {
    mode: 'adaptive',
    openTag: '<正文>（或当前预设要求的 <scenario>）',
    closeTag: '</正文>（或 </scenario>）',
    normRef: '<scenario_norm> / <content_format>',
    requirementsRef: '<output_requirements> / <content_constraints>',
  };
}

/**
 * 定位中控【增量思维链校准】条目的最佳插入下标：
 * 1. 优先找名称含“思维链结束 / 思考结束 / </think>”且非 assistant 预填的条目，插在其正后方；
 * 2. 其次找已启用的名称含“思维链 / ICOT / CoT / 思考”或内容含 `<think_format>` / `<thinking_format>` / `<Interleaved_thinking>` 且非开关类的非 assistant 条目，插在其正后方；
 * 3. 兜底：插在 `chatHistory` 之后或末尾 `assistant` 预填条目之前。
 */
export function findCotInsertIndex(prompts: PresetPromptItem[]): number {
  const list = prompts ?? [];
  let cotEndIdx = -1;
  let enabledCotMainIdx = -1;
  let anyCotMainIdx = -1;
  let chatHistoryIdx = -1;

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || MANAGED_PROMPT_IDS.has(item.id)) continue;
    const name = String(item.name ?? '');
    const content = String(item.content ?? '');
    if (item.id === 'chatHistory') {
      chatHistoryIdx = i;
    }
    if (item.role !== 'assistant') {
      if (/思维链结束|思考结束|<\/think(?:ing)?>|i?cot\s*end/i.test(name)) {
        cotEndIdx = i;
      } else if (
        !/【开关】|EFFORT\s*LEVEL/i.test(name) &&
        (/思维链|\bi?cot\b|思考链|思考过程/i.test(name) ||
          /<think(?:ing)?_format>|<Interleaved_thinking>/i.test(content))
      ) {
        anyCotMainIdx = i;
        if (item.enabled) {
          enabledCotMainIdx = i;
        }
      }
    }
  }

  if (cotEndIdx >= 0) return cotEndIdx + 1;
  if (enabledCotMainIdx >= 0) return enabledCotMainIdx + 1;
  if (anyCotMainIdx >= 0) return anyCotMainIdx + 1;
  if (chatHistoryIdx >= 0) return chatHistoryIdx + 1;

  // 插在末尾 assistant 预填条目之前
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role !== 'assistant') {
      return i + 1;
    }
  }
  return list.length;
}

/**
 * 识别预设特征档案（专门针对 `Kemini_Dramatron_v3.1` 与 `Kemini_UAU_OutputTool_Grep_v3.5` 等 Kemini 家族预设）：
 * 1. `kemini_dramatron_uau`：含 Dramatron 三段式 `📽️ICOT（三段）` / `<Interleaved_thinking>` 且含启用态 UAU `<SUOT>` 闭合引导（如 `Kemini_UAU_OutputTool_Grep_v3.5`）；
 * 2. `kemini_dramatron`：含 Dramatron 三段式 `📽️ICOT（三段）` / `📽️COT（格式友好型）` / `<Interleaved_thinking>`（如 `Kemini_Dramatron_v3.1`）；
 * 3. `kemini_aether`：含 `🌐思维链` + `⚙️正文添加标签`（如 `Kemini Aether-fr-3.17`）；
 * 4. `generic`：其他通用预设。
 */
export function detectPresetProfile(
  presetName: string,
  prompts: PresetPromptItem[],
): PresetProfileKind {
  const list = prompts ?? [];
  const hasDramatronIcotStructure = list.some(p => {
    if (!p) return false;
    const id = String(p.id ?? '');
    const name = String(p.name ?? '');
    const content = String(p.content ?? '');
    return (
      id === 'fd9adcfd-bbbe-447e-8be6-4f1d87e50da7' ||
      id === 'c127ada4-2a95-4cb6-a5dd-ca7eed0b3080' ||
      /📽️\s*ICOT|📽️\s*COT/.test(name) ||
      /<Interleaved_thinking>|tktag::<Interleaving>/i.test(content)
    );
  });

  if (hasDramatronIcotStructure) {
    const hasEnabledUauSuotLock = list.some(p => {
      if (!p || !p.enabled) return false;
      const id = String(p.id ?? '');
      const name = String(p.name ?? '');
      const content = String(p.content ?? '');
      return (
        id.startsWith('ate-uau-guide-') ||
        /【UAU引导/.test(name) ||
        /CLOSE_SUOT_TAG|<SUOT>\.\.\.<\/SUOT>/i.test(content)
      );
    });
    return hasEnabledUauSuotLock ? 'kemini_dramatron_uau' : 'kemini_dramatron';
  }

  const isKeminiNamed = /kemini|aether/i.test(String(presetName ?? ''));
  const hasAetherStructure = list.some(
    p =>
      p &&
      (/🌐思维链|⚙️正文添加标签|⚡️卡思维链/.test(String(p.name ?? '')) ||
        /<think_format>/i.test(String(p.content ?? ''))),
  );
  if (isKeminiNamed && hasAetherStructure) {
    return 'kemini_aether';
  }

  return 'generic';
}

const KEMINI_CONFLICTING_PRESET_REGEX_IDS = new Set([
  'cd7d963f-e7e1-417f-a018-44f8e34a9339', // 【夏瑾】行动选项1（把 <SUOT> 渲染为夏瑾 HTML 代码块）
  'df7c0375-248a-4585-930b-ef30be16a9f6', // 【夏瑾】行动选项2（minDepth:1 删历史 <SUOT>）
]);

export function isConflictingKeminiPresetRegex(
  regex: Record<string, unknown> | null | undefined,
): boolean {
  if (!regex || typeof regex !== 'object') return false;
  const id = String(regex.id ?? '').trim();
  const name = String(regex.scriptName ?? regex.script_name ?? '').trim();
  return (
    KEMINI_CONFLICTING_PRESET_REGEX_IDS.has(id) ||
    /【夏瑾】行动选项/.test(name)
  );
}

/**
 * 专门针对 `Kemini_Dramatron_v3.1` 与 `Kemini_UAU_OutputTool_Grep_v3.5` 的靶向增量思维链提示词：
 * 1. 包裹在 `<thinking_format>` 兼容块内，顺应 `🎬ROLE AND GUIDE` 的 `<thinking_format>` 约束；
 * 2. 直接画出带显式 `<thinking>...</thinking>` 的三段式 `<Interleaving>` 完整结构骨架（补齐原 `📽️ICOT（三段）` 模板未写出 `<thinking>` 的缺陷）；
 * 3. 强制锁定 `<Interleaving>` 位于首行最外层、三段日语思考各自独立闭合 `<thinking>...</thinking>`、正文不加 `<正文>` 标签；
 * 4. 强制将战报协议块（`<摘要>`~`<选项>`）置于 `</Interleaving>` 之后、`<SUOT>` 之前（严禁塞进 `<SUOT>` 内部）。
 */
export function buildKeminiDramatronCotPromptContent(
  profile: 'kemini_dramatron' | 'kemini_dramatron_uau',
): string {
  const suotRule =
    profile === 'kemini_dramatron_uau'
      ? [
          '   - 当前预设启用了 UAU `<SUOT>` 闭合锁（`stop_condition = CLOSE_SUOT_TAG`）：必须在 `</Interleaving>` 闭合之后，**先平铺输出 `<摘要>`、`<timePast>`、`<态势>`、`<世界演变>`、`<排产计划>`、`<选项>` 等全部战报协议块，最后再单独输出 `<SUOT>\\ndone\\n</SUOT>`（及 `<disclaimer>`）**；',
          '   - **绝对红线：严禁将 `<摘要>`~`<选项>` 任何战报协议标签写进 `<SUOT>...</SUOT>` 内部！`<SUOT>` 内部只允许写 `done`！**',
        ].join('\n')
      : '   - 所有战区战报协议块（`<摘要>`、`<timePast>`、`<态势>`、`<世界演变>`、`<排产计划>`、`<选项>` 等）对应上方模板中的 `{{可能要求的附加内容}}`，必须紧跟在 `</Interleaving>` 闭合标签**之后**平铺输出（严禁将战报协议块写进 `<Interleaving>` 内部或 `<SUOT>` 内部）。';

  return [
    '<rac_cot_supplement>',
    '<thinking_format>',
    '【Kemini-Dramatron 三段交错思考（ICOT）与战报协议块专项校准（补充不替代）】',
    '请完整保留上方 `📽️ICOT（三段）` 规定的日语思考清单、文风检视与人设防偏移要求，并强制遵守以下标签骨架与战区自检红线：',
    '',
    '1. 【三段 `<thinking>` 强制独立闭合与首行标签顺序（最高优先级格式锁）】',
    '   - 回复的第 1 行必须是 `<Interleaving>`，第 2 行才是第 1 段的 `<thinking>`（**严禁在最外层先写 `<thinking>` 再写 `<Interleaving>`**！）；',
    '   - 上方三段交错模板中的每一段 `{{日文思考内容}}` **都必须各自独立使用 `<thinking>` 与 `</thinking>` 完整闭合包裹**（**严禁第 2 段、第 3 段漏写 `<thinking>...</thinking>` 标签导致日语思考裸露到中文正文中**！）；',
    '   - 每段 `</thinking>` 闭合后直接写简体中文正文（严禁额外套用未启用的正文包裹标签）。三段完整输出骨架必须严格形如：',
    '<Interleaving>',
    '<thinking>',
    '（第1段日语思考：按上方 <thinking_format> 清单逐条完成，并在本段统筹本轮“起、承、转、合”三幕推进与战区资金/电力/科技/产线硬约束，以及 ★ [待交割收讫] 与 [本轮刚竣工入账] 里程碑、重大工程阶段进度、在途 <任务> 进度推进/完结交割（按承诺悬赏兑现）及前馈 ★ [参谋部候选派发任务提案] 按需发布核对：待收讫项须描写交付并输出收讫声明，已入账竣工项严禁重复输出 <生产> 报账标签；在途 <任务> 推进或达成时输出 <任务> 更新进度或设为「已完成」兑现原定承诺悬赏，任务空窗期或命中 ★ [参谋部候选派发任务提案] 契机时按需输出 <任务> 发布新任务；在途 <情报> 多阶溯源链可通过异源渠道交叉印证升阶更新，终阶水落石出（已证实）时可顺势派生关联 <任务>/<扩展档案>/<协议> 线索；所有预设任务/情报链方向仅作参考、严禁机械照抄标题，须结合现场态势自主发挥）',
    '</thinking>',
    '（第1段简体中文正文）',
    '',
    '<thinking>',
    '（第2段日语思考：按上方 <thinking_format> 清单逐条完成第二段推进思考）',
    '</thinking>',
    '（第2段简体中文正文）',
    '',
    '<thinking>',
    '（第3段日语思考：按上方 <thinking_format> 清单逐条完成第三段收束与禁词/结尾自检；若本轮输出 <机娘档案>（新机娘入列或待授名转正）：核对是否完整写出 special_skills[{name, kind, desc}] 技能数组与 special_equipment[{name, slot: 主武器|副武器|核心挂载|随身武备, desc}] 主副武器数据块；若本轮拟输出 <扩展档案> 或 <图鉴>：核对该实体是否确属世界书目录与在册名单之外的全新原创事物——既有标准科技/建筑/兵种严禁写入 <图鉴>/<扩展档案>，既有装备改装走 <数据更新>，在编机娘日常变动走 <机娘>；凡全新原创 科技/载具/人员/建筑/装备 必须带齐 {造价, 工期, 科技层级, 所属阵营/研究线, 生产建筑/所需建筑, 前置科技, 解锁产物/主副武器与战术特长} 供底层自动合成标准 <数据> 块，扩展档案触发词仅填专名、禁填泛词与裸字母）',
    '</thinking>',
    '（第3段简体中文正文）',
    '</Interleaving>',
    '',
    '2. 【战报协议块与 `</Interleaving>` / `<SUOT>` 边界锁】',
    suotRule,
    '</thinking_format>',
    '</rac_cot_supplement>',
  ].join('\n');
}

/**
 * 生成能力 ②：【增量思维链校准（补充不替代）】提示词正文（自适应 `<正文>` / `<scenario>` 及 `<Interleaving>` 三段式交错思考）
 */
export function buildIncrementalCotPromptContent(
  tagSpec: PresetScenarioTagSpec,
  profile: PresetProfileKind = 'generic',
): string {
  if (
    profile === 'kemini_dramatron' ||
    profile === 'kemini_dramatron_uau'
  ) {
    return buildKeminiDramatronCotPromptContent(profile);
  }
  const wrapRule =
    tagSpec.mode === 'adaptive'
      ? '若上方已启用预设明确要求特定正文包裹标签则按其闭合，若未要求则直接输出纯简体中文正文（严禁自行添加未启用的包裹标签）'
      : `正文必须完整使用 ${tagSpec.openTag} ${tagSpec.closeTag} 标签闭合包裹`;

  return [
    '<rac_cot_supplement>',
    '【重要声明：以下思考要求是对上方预设原有思维链（<think> / <thinking> / <Interleaving> 思考步骤）的“补充增加”，而非替代！】',
    '请完整保留并继续遵守上方预设规定的思考语言（如日语/法语/中文等）、包裹标签层级、分段结构、文风检视与人设防偏移要求；在此基础上增量完成以下三步构思与全局自检：',
    '',
    '1. 【阶段一：一次整体起承转合规划（思考内完成）】',
    '   - 结合当前激活的世界书条令、战区态势、角色档案与最新互动输入，在思考阶段完成本轮剧情的“起、承、转、合”整体推进规划，严禁边写正文边临时拼凑大纲；',
    '   - 若上方预设为 `<Interleaving>` 多段交错思考（如三段式 ICOT），必须在最外层首行先写 `<Interleaving>`（严禁将 `<Interleaving>` 写进 `<thinking>` 内部！），且第 1、2、3 段交错思考都必须各自独立使用 `<thinking>...</thinking>` 完整闭合包裹（严禁第 2、3 段漏写 `<thinking>` 标签导致思考文本裸露到正文中）。',
    '',
    '2. 【阶段二：战区硬约束与叙事边界前置核对】',
    `   - 核对本轮构思是否符合 ${tagSpec.normRef} 与 ${tagSpec.requirementsRef}，是否与世界书设定、时间线、资金/电力/产线/兵力硬约束及上下文完全一致；`,
    '   - 核对 <当前工程日程> 与前馈视图中的 ★ [待交割收讫] 及 [本轮刚竣工入账] 里程碑：待收讫项须在正文描写交付并输出收讫声明；已入账竣工项与新完工工程须自然展现战地实效与下游解锁，严禁重复输出 <生产> 报账标签；',
    '   - 核对前馈视图【五、作战任务与外交势力】：若指挥官本轮行动推进或达成了在途 <任务>，须输出 <任务> 更新进度或设为「已完成」兑现原定承诺悬赏；若当前处于任务空窗期或命中 ★ [参谋部候选派发任务提案] 契机，可结合现场剧情按需输出 <任务> 发布新任务（无任务变动轮次严禁复读在途任务表）；同步核对在途 <情报> 多阶溯源链：可通过异源渠道交叉印证升阶更新（1/3捕风捉影->2/3交叉印证->3/3水落石出），终阶水落石出（已证实）时可顺势派生关联 <任务>（含多环任务链）、<扩展档案>（人物/势力）或战略 <协议> 线索；所有预设任务/情报链方向仅作参考、严禁机械照抄标题，须结合现场态势自主发挥；',
    '   - 若本轮输出 <机娘档案>（新机娘入列或待授名机娘获赐名转正）：核对是否完整输出了与世界书 <数据> 块 1:1 同构的 special_skills（技能数组：[{name, kind, desc}]）与 special_equipment（主副武器与挂载数组：[{name, slot: 主武器|副武器|核心挂载|随身武备, desc}]）；若本轮拟输出 <扩展档案> 或 <图鉴>：核对该实体是否确属世界书目录与在册名单之外的全新原创事物（既有标准科技/建筑/兵种严禁写入 <图鉴>/<扩展档案>，既有装备改装走 <数据更新>，在编机娘日常变动走 <机娘>；凡全新原创 科技/载具/人员/建筑/装备 必须带齐 {造价, 工期, 科技层级, 所属阵营/研究线, 生产建筑/所需建筑, 前置科技, 解锁产物/主副武器与战术特长} 供底层自动合成标准 <数据> 块；扩展档案触发词仅填专名、禁填泛词与裸字母）；',
    '   - 确保不存在剧情跳跃、设定冲突或时间线错乱，且严禁越界揣测或替 <user> 捏造未声明的内心想法。',
    '',
    '3. 【阶段三：正文闭合与结构化收束确认】',
    `   - 每段思考结束（</think> 或 </thinking>）后，紧接着使用简体中文按规划连贯写出对应正文（${wrapRule}）；`,
    '   - 严禁将思维链草稿泄漏至正文中；若启用了 `<Interleaving>`，须在末段正文结束后先闭合 `</Interleaving>`，再按世界书规范准确输出对应的战报协议块。',
    '</rac_cot_supplement>',
  ].join('\n');
}

/**
 * 生成能力 ③：TauriTavern Agent 模式专享【单次整体规划与四阶段生成规约】提示词正文（自适应标签）
 */
export function buildTtAgentFourPhasePromptContent(
  tagSpec: PresetScenarioTagSpec,
): string {
  const openTag = tagSpec.mode === 'zhengwen' ? '<正文>' : '<scenario>';
  const closeTag = tagSpec.mode === 'zhengwen' ? '</正文>' : '</scenario>';
  const normLabel =
    tagSpec.mode === 'zhengwen'
      ? '<content_format>（及 <scenario_norm>）'
      : '<scenario_norm>';
  const reqLabel =
    tagSpec.mode === 'zhengwen'
      ? '<content_constraints>（及 <output_requirements>）'
      : '<output_requirements>';

  return [
    '<tauritavern_agent_four_phase_protocol>',
    '【阶段一：上下文准备与一次性规划】',
    '1. 结合世界书、预设指令、前文上下文以及用户输入，理解本轮剧情目标。',
    '2. 若 `persist/` 中存在与本轮相关的角色档案或持久资料，先读取必要文件。',
    '3. 在开始写作前，一次性完成整章规划，规划必须完整覆盖：',
    '   - 起',
    '   - 承',
    '   - 转',
    '   - 合',
    '4. 将完整四部分规划一次性写入 `scratch/plan.md`。',
    '5. 规划只允许写这一次，后续写作过程中不要反复重写或拆成四次分别规划。',
    '',
    '【阶段二：一次性生成完整内容】',
    '6. 读取 `scratch/plan.md` 与必要的 `persist/` 角色档案。',
    '7. 结合世界书与上下文，严格按照 `scratch/plan.md` 中“起、承、转、合”的顺序，连续完成整篇内容写作，并写入 `scratch/draft.md`。',
    '8. 写作过程中直接把起、承、转、合完整写完，禁止每写完一部分就停下来读取、检查、打补丁或重规划。',
    `9. 草稿内容需直接包含完整正文与所需附加模块，正文使用简体中文，并由 \`${openTag} ${closeTag}\` 闭合包裹。`,
    '',
    '【阶段三：一次全局检查】',
    '10. 当 `scratch/draft.md` 全部写完后，调用一次 `workspace_read_file` 读取 `scratch/draft.md`。',
    '11. 对整篇草稿只进行一次全局检查，统一核对以下全部要求：',
    `    - 是否符合 ${normLabel} 与 ${reqLabel}`,
    '    - 是否与 `scratch/plan.md`、角色档案、世界书设定、前文上下文保持一致',
    '    - 是否存在剧情跳跃、设定冲突、时间线错误',
    '    - 是否删除了对 `<user>` 内心想法的描写',
    '    - 正文是否为简体中文',
    `    - \`${openTag} ${closeTag}\` 标签是否完整闭合`,
    '    - 附加模块格式是否符合要求',
    '12. 若检查无问题，直接进入下一步，不要重复检查。',
    '13. 若发现问题，只调用 `workspace_apply_patch` 对 `scratch/draft.md` 进行一次性集中修正，修正后即可定稿，不要反复循环复查。',
    '14. 将最终定稿写入 `output/main.md`，并调用 `workspace_commit`。',
    '',
    '【阶段四：角色持久化】',
    '15. 若本轮剧情中角色状态、关系、经历、设定或关键记忆发生变化，使用 `workspace_apply_patch` 更新 `persist/characters/角色名称.md`。',
    '16. 全部完成后调用 `workspace_finish`。',
    '',
    '【重要限制】',
    '- 禁止把完整思维链写入任何文件。',
    '- 禁止对“起、承、转、合”分别单独规划四次。',
    '- 禁止每写完一段就执行“写 → 读 → 检查 → 修正 → 提交”的循环。',
    '- 禁止对同一规则做多次重复检查。',
    '- 尽量减少工具调用次数，优先一次性写入、一次性检查、一次性批量修改。',
    '</tauritavern_agent_four_phase_protocol>',
  ].join('\n');
}

/**
 * 纯函数：根据给定配置与宿主状态，对 Preset 对象原地或拷贝应用托管规则，返回最新 Preset 与回执
 */
export function applyPresetPromptManagementToPreset(
  presetInput: PresetObject,
  options: {
    presetName: string;
    preferences: PresetManagerPreferences;
    isTauriTavern: boolean;
    ttAgentModeEnabled: boolean;
    persistedState: PresetManagerPersistedState;
  },
): { preset: PresetObject; receipt: PresetSyncReceipt } {
  const {
    presetName,
    preferences,
    isTauriTavern,
    ttAgentModeEnabled,
    persistedState,
  } = options;
  const prompts: PresetPromptItem[] = Array.isArray(presetInput.prompts)
    ? presetInput.prompts.map(p => ({ ...p }))
    : [];

  const detectedProfile = detectPresetProfile(presetName, prompts);
  const detectedTagSpec = detectPresetScenarioTag(prompts);
  const disabledSummaryPrompts: Array<{ id: string; name: string }> = [];
  const restoredSummaryPrompts: Array<{ id: string; name: string }> = [];
  const disabledPresetRegexes: Array<{ id: string; name: string }> = [];
  const restoredPresetRegexes: Array<{ id: string; name: string }> = [];
  let changed = false;

  const recordedIds = new Set(
    persistedState.disabledSummaryIdsByPreset[presetName] ?? [],
  );

  // 1. 处理摘要/总结条目开关
  if (preferences.enabled && preferences.autoDisableSummary) {
    for (const p of prompts) {
      if (isSummaryPromptEntry(p)) {
        if (p.enabled) {
          recordedIds.add(p.id);
          p.enabled = false;
          changed = true;
        }
        disabledSummaryPrompts.push({ id: p.id, name: p.name });
      }
    }
    persistedState.disabledSummaryIdsByPreset[presetName] =
      Array.from(recordedIds);
  } else if (recordedIds.size > 0) {
    for (const p of prompts) {
      if (recordedIds.has(p.id) && !p.enabled) {
        p.enabled = true;
        changed = true;
        restoredSummaryPrompts.push({ id: p.id, name: p.name });
      }
    }
    delete persistedState.disabledSummaryIdsByPreset[presetName];
  }

  // 1.5 针对 Kemini_Dramatron_v3.1 与 Kemini_UAU_OutputTool_Grep_v3.5 自动托管冲突的预设正则（如【夏瑾】行动选项1/2）
  if (!persistedState.disabledPresetRegexIdsByPreset) {
    persistedState.disabledPresetRegexIdsByPreset = {};
  }
  const recordedRegexIds = new Set(
    persistedState.disabledPresetRegexIdsByPreset[presetName] ?? [],
  );
  let nextExtensions = presetInput.extensions;
  const rawRegexScripts = Array.isArray(presetInput.extensions?.regex_scripts)
    ? (presetInput.extensions!.regex_scripts as Array<Record<string, unknown>>).map(
        r => ({ ...r }),
      )
    : null;

  if (rawRegexScripts) {
    let regexChanged = false;
    if (
      preferences.enabled &&
      (detectedProfile === 'kemini_dramatron' ||
        detectedProfile === 'kemini_dramatron_uau')
    ) {
      for (const r of rawRegexScripts) {
        if (isConflictingKeminiPresetRegex(r)) {
          const rid = String(r.id ?? '').trim();
          const rname = String(r.scriptName ?? r.script_name ?? rid);
          if (!r.disabled) {
            if (rid) recordedRegexIds.add(rid);
            r.disabled = true;
            regexChanged = true;
            changed = true;
          }
          disabledPresetRegexes.push({ id: rid, name: rname });
        }
      }
      persistedState.disabledPresetRegexIdsByPreset[presetName] =
        Array.from(recordedRegexIds);
    } else if (recordedRegexIds.size > 0) {
      for (const r of rawRegexScripts) {
        const rid = String(r.id ?? '').trim();
        const rname = String(r.scriptName ?? r.script_name ?? rid);
        if (rid && recordedRegexIds.has(rid) && r.disabled) {
          r.disabled = false;
          regexChanged = true;
          changed = true;
          restoredPresetRegexes.push({ id: rid, name: rname });
        }
      }
      delete persistedState.disabledPresetRegexIdsByPreset[presetName];
    }

    if (regexChanged) {
      nextExtensions = {
        ...(presetInput.extensions ?? {}),
        regex_scripts: rawRegexScripts,
      };
    }
  }

  // 2. 先抽出已有的中控托管条目，以便精准重算锚点位置
  const existingCot = prompts.find(p => p.id === RAC_COT_AUGMENT_PROMPT_ID);
  const existingAgent = prompts.find(
    p => p.id === RAC_TT_AGENT_FOUR_PHASE_PROMPT_ID,
  );
  const basePrompts = prompts.filter(p => !MANAGED_PROMPT_IDS.has(p.id));

  const cotInsertIndex = findCotInsertIndex(basePrompts);
  const wantCotEnabled = Boolean(
    preferences.enabled && preferences.injectCotSupplement,
  );
  const wantTtAgentEnabled = Boolean(
    preferences.enabled &&
      preferences.autoManageTtAgentPrompt &&
      isTauriTavern &&
      ttAgentModeEnabled,
  );

  const cotContent = buildIncrementalCotPromptContent(
    detectedTagSpec,
    detectedProfile,
  );
  const agentContent = buildTtAgentFourPhasePromptContent(detectedTagSpec);

  const cotEntry: PresetPromptItem = {
    ...(existingCot ?? {}),
    id: RAC_COT_AUGMENT_PROMPT_ID,
    name: RAC_COT_AUGMENT_PROMPT_NAME,
    enabled: wantCotEnabled,
    role: 'system',
    position: { type: 'relative' },
    content: cotContent,
  };

  const agentEntry: PresetPromptItem = {
    ...(existingAgent ?? {}),
    id: RAC_TT_AGENT_FOUR_PHASE_PROMPT_ID,
    name: RAC_TT_AGENT_FOUR_PHASE_PROMPT_NAME,
    enabled: wantTtAgentEnabled,
    role: 'system',
    position: { type: 'relative' },
    content: agentContent,
  };

  const nextPrompts = [
    ...basePrompts.slice(0, cotInsertIndex),
    cotEntry,
    agentEntry,
    ...basePrompts.slice(cotInsertIndex),
  ];

  if (
    !changed &&
    (prompts.length !== nextPrompts.length ||
      prompts.some(
        (p, idx) =>
          p.id !== nextPrompts[idx]?.id ||
          p.enabled !== nextPrompts[idx]?.enabled ||
          p.content !== nextPrompts[idx]?.content ||
          p.name !== nextPrompts[idx]?.name,
      ))
  ) {
    changed = true;
  }

  persistedState.lastSyncedPresetName = presetName;
  persistedState.lastSyncedAt = Date.now();

  return {
    preset: {
      ...presetInput,
      prompts: nextPrompts,
      ...(nextExtensions ? { extensions: nextExtensions } : {}),
    },
    receipt: {
      presetName,
      detectedProfile,
      isTauriTavern,
      ttAgentModeEnabled,
      detectedTagSpec,
      disabledSummaryPrompts,
      restoredSummaryPrompts,
      disabledPresetRegexes,
      restoredPresetRegexes,
      cotPromptEnabled: wantCotEnabled,
      cotInsertIndex,
      ttAgentPromptEnabled: wantTtAgentEnabled,
      ttAgentInsertIndex: cotInsertIndex + 1,
      globalWatchdogInstalled: false,
      changed,
    },
  };
}

/**
 * 纯函数：当玩家切换到非中控台角色卡或手动点击“恢复预设原状”时，
 * 关闭中控注入的预设条目（`rac_preset_cot_augment_v1` / `rac_tt_agent_four_phase_v1`），
 * 并开启预设里的摘要条目与被临时禁用的预设正则（如 `【夏瑾】行动选项1/2`）。
 */
export function deactivateManagedPromptsInPreset(
  presetInput: PresetObject,
  options: {
    presetName: string;
    persistedState: PresetManagerPersistedState;
    mode: 'manual_restore' | 'cross_card_guard';
    removeInjectedEntries?: boolean;
  },
): {
  preset: PresetObject;
  changed: boolean;
  restoredSummaryPrompts: Array<{ id: string; name: string }>;
  restoredPresetRegexes?: Array<{ id: string; name: string }>;
} {
  const { presetName, persistedState, mode, removeInjectedEntries = false } =
    options;
  const prompts: PresetPromptItem[] = Array.isArray(presetInput.prompts)
    ? presetInput.prompts.map(p => ({ ...p }))
    : [];

  let changed = false;
  const restoredSummaryPrompts: Array<{ id: string; name: string }> = [];
  const restoredPresetRegexes: Array<{ id: string; name: string }> = [];
  const recordedIds = new Set(
    persistedState.disabledSummaryIdsByPreset[presetName] ?? [],
  );

  const nextPrompts: PresetPromptItem[] = [];
  for (const p of prompts) {
    if (MANAGED_PROMPT_IDS.has(p.id)) {
      if (removeInjectedEntries) {
        changed = true;
        continue;
      }
      if (p.enabled) {
        p.enabled = false;
        changed = true;
      }
      nextPrompts.push(p);
      continue;
    }

    const shouldRestoreBySnapshot = recordedIds.has(p.id);
    const shouldRestoreByCrossCardRule =
      mode === 'cross_card_guard' && isRegularPerTurnSummaryEntry(p);

    if ((shouldRestoreBySnapshot || shouldRestoreByCrossCardRule) && !p.enabled) {
      p.enabled = true;
      changed = true;
      restoredSummaryPrompts.push({ id: p.id, name: p.name });
    }
    nextPrompts.push(p);
  }

  if (recordedIds.size > 0) {
    delete persistedState.disabledSummaryIdsByPreset[presetName];
  }

  let nextExtensions = presetInput.extensions;
  const recordedRegexIds = new Set(
    persistedState.disabledPresetRegexIdsByPreset?.[presetName] ?? [],
  );
  if (Array.isArray(presetInput.extensions?.regex_scripts)) {
    const rawRegexScripts = (
      presetInput.extensions!.regex_scripts as Array<Record<string, unknown>>
    ).map(r => ({ ...r }));
    let regexChanged = false;
    for (const r of rawRegexScripts) {
      const rid = String(r.id ?? '').trim();
      const rname = String(r.scriptName ?? r.script_name ?? rid);
      const shouldRestoreRegex =
        (rid && recordedRegexIds.has(rid)) ||
        (mode === 'cross_card_guard' && isConflictingKeminiPresetRegex(r));
      if (shouldRestoreRegex && r.disabled) {
        r.disabled = false;
        regexChanged = true;
        changed = true;
        restoredPresetRegexes.push({ id: rid, name: rname });
      }
    }
    if (regexChanged) {
      nextExtensions = {
        ...(presetInput.extensions ?? {}),
        regex_scripts: rawRegexScripts,
      };
    }
  }
  if (
    recordedRegexIds.size > 0 &&
    persistedState.disabledPresetRegexIdsByPreset
  ) {
    delete persistedState.disabledPresetRegexIdsByPreset[presetName];
  }

  return {
    preset: {
      ...presetInput,
      prompts: nextPrompts,
      ...(nextExtensions ? { extensions: nextExtensions } : {}),
    },
    changed,
    restoredSummaryPrompts,
    restoredPresetRegexes,
  };
}

/**
 * 生成无 UI 的酒馆助手全局守护脚本（`🎖️[战区中控] 预设跨卡自动还原守护`）内联源码。
 *
 * 运行机制：
 * - 作为酒馆助手全局脚本（`type: 'global'`）在所有角色卡聊天中静默运行，无按钮、无弹窗 UI；
 * - 监听 `CHAT_CHANGED` / `PRESET_CHANGED` 及启动首次自检（延迟 650ms 等待角色脚本挂载完毕）；
 * - 通过三道特征检测当前聊天是否存在中控台：
 *   ① 中控台通过 `initializeGlobal('RAC_CONSOLE_GUARD', ...)` 或 `window.parent.__RAC_CONSOLE_GUARD__` 注册的全局存活函数 `isActive()`；
 *   ② 顶层窗口 DOM 是否存在中控悬浮窗挂载容器 `#ra-console-shell`；
 *   ③ 当前角色卡脚本列表（`getScriptTrees({ type: 'character' })`）是否存在启用的 `中控悬浮窗` 脚本；
 * - 若三项均无痕迹（说明玩家正在游玩其他角色卡），立即将当前 `'in_use'` 预设中的中控条目设为 `enabled: false`，并重新开启预设里的摘要条目！
 */
export function buildGlobalPresetWatchdogScriptSource(): string {
  return `/**
 * ${RAC_GLOBAL_WATCHDOG_SCRIPT_NAME} (${RAC_GLOBAL_WATCHDOG_SCRIPT_ID})
 * 无 UI 全局静默守护脚本：当检测到当前聊天未挂载战区中控台（玩家切换至其他角色卡）时，
 * 自动关闭中控台专属预设条目（增量思维链 / TT-Agent 四阶段规约），并恢复开启预设中的摘要条目。
 */
(function () {
  const STORAGE_KEY = '${RAC_PRESET_MANAGER_STORAGE_KEY}';
  const GUARD_GLOBAL_NAME = '${RAC_CONSOLE_GLOBAL_GUARD_NAME}';
  const MANAGED_IDS = new Set([
    '${RAC_COT_AUGMENT_PROMPT_ID}',
    '${RAC_TT_AGENT_FOUR_PHASE_PROMPT_ID}',
  ]);

  function getTopWin() {
    let cur = typeof window !== 'undefined' ? window : globalThis;
    for (let i = 0; i < 4; i++) {
      try {
        if (!cur.parent || cur.parent === cur) return cur;
        void cur.parent.document;
        cur = cur.parent;
      } catch (_e) {
        return cur;
      }
    }
    return cur;
  }

  function getTh(topWin) {
    return (
      (typeof TavernHelper !== 'undefined' && TavernHelper) ||
      (topWin && topWin.TavernHelper) ||
      (typeof window !== 'undefined' && window.TavernHelper) ||
      {}
    );
  }

  function isConsoleActiveInCurrentChat() {
    try {
      const topWin = getTopWin();
      const th = getTh(topWin);
      const getTrees =
        typeof getScriptTrees === 'function' ? getScriptTrees : th.getScriptTrees;

      if (typeof getTrees === 'function') {
        const charScripts = getTrees({ type: 'character' }) || [];
        const stack = Array.isArray(charScripts) ? [...charScripts] : [];
        let foundConsoleScript = false;
        let consoleScriptEnabled = false;
        while (stack.length > 0) {
          const item = stack.pop();
          if (!item) continue;
          if (item.type === 'folder' && Array.isArray(item.scripts)) {
            if (item.enabled !== false) stack.push(...item.scripts);
            continue;
          }
          if (/中控悬浮窗|红警指挥系统/.test(String(item.name || ''))) {
            foundConsoleScript = true;
            if (item.enabled) consoleScriptEnabled = true;
          }
        }
        // 若当前角色卡没有中控悬浮窗脚本，或该脚本已禁用，则判定当前聊天未启用中控台
        if (!foundConsoleScript || !consoleScriptEnabled) {
          return false;
        }
      }

      const guard =
        (topWin && topWin.__RAC_CONSOLE_GUARD__) ||
        (topWin && topWin[GUARD_GLOBAL_NAME]) ||
        (typeof window !== 'undefined' && window[GUARD_GLOBAL_NAME]);
      if (guard && typeof guard.isActive === 'function' && guard.isActive()) {
        return true;
      }
      if (topWin && topWin.document && topWin.document.getElementById('ra-console-shell')) {
        return true;
      }
    } catch (_e) {
      // ignore probe errors
    }
    return false;
  }

  function isRegularSummaryEntry(prompt) {
    if (!prompt || typeof prompt !== 'object') return false;
    const id = String(prompt.id || '').trim();
    if (!id || MANAGED_IDS.has(id)) return false;
    const name = String(prompt.name || '').trim();
    const content = String(prompt.content || '');
    if (/用完关|大总结放置|TASK\\s*CHANGED|总结请求/i.test(name + '\\n' + content)) {
      return false;
    }
    if (/<Previoushistory_summary>/i.test(content)) {
      return false;
    }
    return (
      /<summary_format>|<summary>/i.test(content) ||
      /^(?:📑|📝|📌|\\s)*(?:摘要|单轮摘要|剧情摘要|小总结|summary)$/i.test(name)
    );
  }

  async function checkAndRestorePresetIfForeignCard() {
    try {
      const topWin = getTopWin();
      const th = getTh(topWin);
      const readPreset =
        typeof getPreset === 'function' ? getPreset : th.getPreset;
      const writePresetWith =
        typeof updatePresetWith === 'function'
          ? updatePresetWith
          : th.updatePresetWith;
      const readLoadedPresetName =
        typeof getLoadedPresetName === 'function'
          ? getLoadedPresetName
          : th.getLoadedPresetName;

      if (typeof readPreset !== 'function' || typeof writePresetWith !== 'function') {
        return false;
      }
      if (isConsoleActiveInCurrentChat()) {
        return false;
      }

      const presetName =
        typeof readLoadedPresetName === 'function'
          ? String(readLoadedPresetName() || '__default__')
          : '__default__';
      let savedState = null;
      try {
        const raw =
          (topWin && topWin.localStorage && topWin.localStorage.getItem(STORAGE_KEY)) ||
          (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY));
        if (raw) savedState = JSON.parse(raw);
      } catch (_e) {}

      const snapshotIds = new Set(
        (savedState &&
          savedState.disabledSummaryIdsByPreset &&
          savedState.disabledSummaryIdsByPreset[presetName]) ||
          [],
      );
      const regexSnapshotIds = new Set(
        (savedState &&
          savedState.disabledPresetRegexIdsByPreset &&
          savedState.disabledPresetRegexIdsByPreset[presetName]) ||
          [],
      );

      const inUse = readPreset('in_use');
      if (!inUse || !Array.isArray(inUse.prompts)) return false;

      let needsUpdate = false;
      for (const p of inUse.prompts) {
        if (!p) continue;
        if (MANAGED_IDS.has(p.id) && p.enabled) {
          needsUpdate = true;
          break;
        }
        if ((snapshotIds.has(p.id) || isRegularSummaryEntry(p)) && !p.enabled) {
          needsUpdate = true;
          break;
        }
      }

      const rawRegexes =
        inUse.extensions && Array.isArray(inUse.extensions.regex_scripts)
          ? inUse.extensions.regex_scripts
          : [];
      for (const r of rawRegexes) {
        if (!r) continue;
        const rid = String(r.id || '').trim();
        const rname = String(r.scriptName || r.script_name || '').trim();
        if (
          (regexSnapshotIds.has(rid) || /【夏瑾】行动选项/.test(rname)) &&
          r.disabled
        ) {
          needsUpdate = true;
          break;
        }
      }

      if (!needsUpdate) return false;

      await writePresetWith(
        'in_use',
        preset => {
          if (!preset || !Array.isArray(preset.prompts)) return preset;
          for (const p of preset.prompts) {
            if (!p) continue;
            if (MANAGED_IDS.has(p.id)) {
              p.enabled = false;
            } else if (snapshotIds.has(p.id) || isRegularSummaryEntry(p)) {
              p.enabled = true;
            }
          }
          if (
            preset.extensions &&
            Array.isArray(preset.extensions.regex_scripts)
          ) {
            for (const r of preset.extensions.regex_scripts) {
              if (!r) continue;
              const rid = String(r.id || '').trim();
              const rname = String(r.scriptName || r.script_name || '').trim();
              if (regexSnapshotIds.has(rid) || /【夏瑾】行动选项/.test(rname)) {
                r.disabled = false;
              }
            }
          }
          return preset;
        },
        { render: 'debounced' },
      );

      if (savedState) {
        if (savedState.disabledSummaryIdsByPreset) {
          delete savedState.disabledSummaryIdsByPreset[presetName];
        }
        if (savedState.disabledPresetRegexIdsByPreset) {
          delete savedState.disabledPresetRegexIdsByPreset[presetName];
        }
        const nextJson = JSON.stringify(savedState);
        try {
          topWin && topWin.localStorage && topWin.localStorage.setItem(STORAGE_KEY, nextJson);
        } catch (_e) {}
      }

      try {
        const importFn = new Function('p', 'return import(p)');
        const regexEngine = await importFn('/scripts/extensions/regex/engine.js');
        if (
          regexEngine &&
          typeof regexEngine.getScriptsByType === 'function' &&
          typeof regexEngine.saveScriptsByType === 'function' &&
          regexEngine.SCRIPT_TYPES
        ) {
          const presetScripts = regexEngine.getScriptsByType(
            regexEngine.SCRIPT_TYPES.PRESET,
            { allowedOnly: false },
          );
          if (Array.isArray(presetScripts)) {
            let engineChanged = false;
            const restoredScripts = presetScripts.map(r => {
              if (!r) return r;
              const rid = String(r.id || '').trim();
              const rname = String(r.scriptName || r.script_name || '').trim();
              if (
                (regexSnapshotIds.has(rid) || /【夏瑾】行动选项/.test(rname)) &&
                r.disabled
              ) {
                engineChanged = true;
                return Object.assign({}, r, { disabled: false });
              }
              return r;
            });
            if (engineChanged) {
              await regexEngine.saveScriptsByType(
                restoredScripts,
                regexEngine.SCRIPT_TYPES.PRESET,
              );
            }
          }
        }
      } catch (_e) {}

      console.info('[中控预设守护] 检测到当前聊天未挂载战区中控台，已自动关闭中控预设条目并恢复开启预设摘要条目');
      return true;
    } catch (err) {
      console.warn('[中控预设守护] 跨卡预设自检异常', err);
      return false;
    }
  }

  let timer = null;
  function scheduleCheck(delayMs) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void checkAndRestorePresetIfForeignCard();
    }, typeof delayMs === 'number' ? delayMs : 650);
  }

  if (typeof eventOn === 'function' && typeof tavern_events === 'object' && tavern_events) {
    if (tavern_events.CHAT_CHANGED) {
      eventOn(tavern_events.CHAT_CHANGED, () => scheduleCheck(650));
    }
    if (tavern_events.PRESET_CHANGED) {
      eventOn(tavern_events.PRESET_CHANGED, () => scheduleCheck(650));
    }
  }

  scheduleCheck(800);
})();
`;
}

export interface PresetPromptManager {
  start(): Promise<PresetSyncReceipt | null>;
  stop(): void;
  syncNow(): Promise<PresetSyncReceipt | null>;
  restorePresetNow(options?: {
    removeInjectedEntries?: boolean;
  }): Promise<boolean>;
  getPreferences(): PresetManagerPreferences;
  updatePreferences(
    patch: Partial<PresetManagerPreferences>,
  ): Promise<PresetSyncReceipt | null>;
  getLastReceipt(): PresetSyncReceipt | null;
  ensureGlobalWatchdogInstalled(): boolean;
}

export function defaultPresetPromptManagerDeps(): PresetPromptManagerDeps {
  const topWin = resolveTopSameOriginWindow();
  const th =
    ((topWin as Record<string, unknown> | null)?.TavernHelper as
      | Record<string, unknown>
      | undefined) ??
    ((typeof window !== 'undefined'
      ? (window as unknown as Record<string, unknown>).TavernHelper
      : undefined) as Record<string, unknown> | undefined);

  return {
    getLoadedPresetName: () => {
      if (typeof getLoadedPresetName === 'function') {
        return getLoadedPresetName();
      }
      if (typeof th?.getLoadedPresetName === 'function') {
        return (th.getLoadedPresetName as () => string)();
      }
      return 'in_use';
    },
    getPreset: (name: string) => {
      if (typeof getPreset === 'function') {
        return getPreset(name as 'in_use') as unknown as PresetObject;
      }
      if (typeof th?.getPreset === 'function') {
        return (th.getPreset as (n: string) => PresetObject)(name);
      }
      throw new Error('TavernHelper.getPreset 不可用');
    },
    updatePresetWith: async (name, updater, options) => {
      if (typeof updatePresetWith === 'function') {
        return (await updatePresetWith(
          name as 'in_use',
          updater as unknown as Parameters<typeof updatePresetWith>[1],
          options,
        )) as unknown as PresetObject;
      }
      if (typeof th?.updatePresetWith === 'function') {
        return await (
          th.updatePresetWith as (
            n: string,
            u: typeof updater,
            o?: typeof options,
          ) => Promise<PresetObject>
        )(name, updater, options);
      }
      throw new Error('TavernHelper.updatePresetWith 不可用');
    },
    getScriptTrees: option => {
      if (typeof getScriptTrees === 'function') {
        return getScriptTrees(option) as unknown as Array<
          Record<string, unknown>
        >;
      }
      if (typeof th?.getScriptTrees === 'function') {
        return (
          th.getScriptTrees as (
            o: typeof option,
          ) => Array<Record<string, unknown>>
        )(option);
      }
      return [];
    },
    updateScriptTreesWith: (updater, option) => {
      if (typeof updateScriptTreesWith === 'function') {
        return updateScriptTreesWith(
          updater as unknown as Parameters<typeof updateScriptTreesWith>[0],
          option,
        );
      }
      if (typeof th?.updateScriptTreesWith === 'function') {
        return (
          th.updateScriptTreesWith as (
            u: typeof updater,
            o: typeof option,
          ) => unknown
        )(updater, option);
      }
      return [];
    },
    initializeGlobal: (name, value) => {
      if (typeof initializeGlobal === 'function') {
        initializeGlobal(name, value);
        return;
      }
      if (typeof th?.initializeGlobal === 'function') {
        (th.initializeGlobal as (n: string, v: unknown) => void)(name, value);
      }
    },
    eventOn: (event, listener) => {
      if (typeof eventOn === 'function') {
        return eventOn(event as EventType, listener);
      }
      if (typeof th?.eventOn === 'function') {
        return (th.eventOn as (e: string, l: typeof listener) => unknown)(
          event,
          listener,
        );
      }
      return undefined;
    },
    eventRemoveListener: (event, listener) => {
      if (typeof eventRemoveListener === 'function') {
        eventRemoveListener(event as EventType, listener);
        return;
      }
      if (typeof th?.eventRemoveListener === 'function') {
        (th.eventRemoveListener as (e: string, l: typeof listener) => void)(
          event,
          listener,
        );
      }
    },
    events: {
      PRESET_CHANGED:
        typeof tavern_events !== 'undefined'
          ? (tavern_events as Record<string, string>).PRESET_CHANGED
          : 'preset_changed',
      CHAT_CHANGED:
        typeof tavern_events !== 'undefined'
          ? (tavern_events as Record<string, string>).CHAT_CHANGED
          : 'chat_id_changed',
      MAIN_API_CHANGED:
        typeof tavern_events !== 'undefined'
          ? (tavern_events as Record<string, string>).MAIN_API_CHANGED
          : 'main_api_changed',
    },
    isTauriTavern: () => isTauriTavernEnvironment(topWin),
    isTtAgentModeEnabled: () => isTauriTavernAgentModeEnabled(topWin),
    subscribeTtAgentMode: handler => subscribeTauriTavernAgentMode(handler, topWin),
    hostWindow: topWin,
  };
}

let singletonManager: PresetPromptManager | null = null;

export function createPresetPromptManager(
  customDeps?: Partial<PresetPromptManagerDeps>,
): PresetPromptManager {
  const deps: PresetPromptManagerDeps = {
    ...defaultPresetPromptManagerDeps(),
    ...(customDeps ?? {}),
  };

  let active = false;
  let lastReceipt: PresetSyncReceipt | null = null;
  let unsubTtAgent: TauriTavernHostUnsubscribe | null = null;
  const boundListeners: Array<{
    event: string;
    fn: (...args: unknown[]) => void;
  }> = [];

  function registerConsoleGuard(isOnline: boolean): void {
    const topWin = deps.hostWindow ?? resolveTopSameOriginWindow();
    const guardHandle: ConsoleGlobalGuardHandle = {
      version: '1.0.0',
      isActive: () => {
        if (!isOnline || !active) return false;
        // 若运行在角色脚本 iframe 中，同时校验 frameElement 仍连接在文档树上
        if (
          typeof window !== 'undefined' &&
          window.frameElement &&
          window.frameElement.isConnected === false
        ) {
          return false;
        }
        return true;
      },
      mountedAt: Date.now(),
      getPresetName: () => {
        try {
          return deps.getLoadedPresetName() || 'in_use';
        } catch {
          return 'in_use';
        }
      },
      deactivateForForeignCard: async () => {
        return await restorePresetInternal({
          mode: 'cross_card_guard',
          removeInjectedEntries: false,
        });
      },
    };

    try {
      if (topWin) {
        topWin.__RAC_CONSOLE_GUARD__ = isOnline ? guardHandle : null;
      }
    } catch {
      // ignore cross-frame guard assignment error
    }
    try {
      deps.initializeGlobal?.(RAC_CONSOLE_GLOBAL_GUARD_NAME, guardHandle);
    } catch {
      // ignore initializeGlobal error
    }
  }

  function ensureGlobalWatchdogInstalled(): boolean {
    if (typeof deps.updateScriptTreesWith !== 'function') {
      return false;
    }
    try {
      const source = buildGlobalPresetWatchdogScriptSource();
      deps.updateScriptTreesWith(
        trees => {
          const list = Array.isArray(trees) ? [...trees] : [];
          const existingIdx = list.findIndex(
            item =>
              item &&
              item.type === 'script' &&
              (item.id === RAC_GLOBAL_WATCHDOG_SCRIPT_ID ||
                item.name === RAC_GLOBAL_WATCHDOG_SCRIPT_NAME),
          );
          const watchdogScript: Record<string, unknown> = {
            ...(existingIdx >= 0 ? list[existingIdx] : {}),
            type: 'script',
            id: RAC_GLOBAL_WATCHDOG_SCRIPT_ID,
            name: RAC_GLOBAL_WATCHDOG_SCRIPT_NAME,
            enabled: true,
            content: source,
            info: '战区中控台自动注册的无 UI 跨卡预设守护脚本：当切换到不含中控台的其他角色卡时，自动关闭中控预设条目并恢复开启预设内置的摘要条目。',
            button: {
              enabled: false,
              buttons: [],
            },
            data: {},
            export_with: {
              data: false,
              button: false,
            },
          };
          if (existingIdx >= 0) {
            list[existingIdx] = watchdogScript;
          } else {
            list.push(watchdogScript);
          }
          return list;
        },
        { type: 'global' },
      );
      return true;
    } catch (err) {
      console.warn('[中控预设托管] 注册全局跨卡预设守护脚本失败', err);
      return false;
    }
  }

  async function syncHostPresetRegexEngine(disableConflicting: boolean): Promise<void> {
    try {
      const hasBrowserOrigin =
        typeof window !== 'undefined' &&
        typeof window.location?.origin === 'string' &&
        /^https?:/i.test(window.location.origin);
      if (!hasBrowserOrigin) return;
      const importFn = new Function('p', 'return import(p)') as (
        p: string,
      ) => Promise<Record<string, unknown>>;
      const regexEngine = await importFn('/scripts/extensions/regex/engine.js');
      const getByType = regexEngine?.getScriptsByType as
        | ((
            t: unknown,
            o?: { allowedOnly?: boolean },
          ) => Array<Record<string, unknown>>)
        | undefined;
      const saveByType = regexEngine?.saveScriptsByType as
        | ((
            scripts: Array<Record<string, unknown>>,
            t: unknown,
          ) => Promise<void>)
        | undefined;
      const scriptTypes = regexEngine?.SCRIPT_TYPES as
        | { PRESET?: unknown }
        | undefined;
      if (
        typeof getByType !== 'function' ||
        typeof saveByType !== 'function' ||
        scriptTypes?.PRESET === undefined
      ) {
        return;
      }
      const presetScripts = getByType(scriptTypes.PRESET, {
        allowedOnly: false,
      });
      if (!Array.isArray(presetScripts)) return;
      let engineChanged = false;
      const nextScripts = presetScripts.map(r => {
        if (!r || !isConflictingKeminiPresetRegex(r)) return r;
        if (Boolean(r.disabled) !== disableConflicting) {
          engineChanged = true;
          return { ...r, disabled: disableConflicting };
        }
        return r;
      });
      if (engineChanged) {
        await saveByType(nextScripts, scriptTypes.PRESET);
      }
    } catch {
      // ignore non-SillyTavern environment or import errors
    }
  }

  async function syncNow(): Promise<PresetSyncReceipt | null> {
    try {
      const state = loadPresetManagerState(deps.hostWindow);
      const presetName = String(deps.getLoadedPresetName() || 'in_use');
      const isTt = Boolean(deps.isTauriTavern?.());
      const ttAgentEnabled = isTt
        ? Boolean(await deps.isTtAgentModeEnabled?.())
        : false;

      let computedReceipt: PresetSyncReceipt | null = null;
      await deps.updatePresetWith(
        'in_use',
        preset => {
          const { preset: nextPreset, receipt } =
            applyPresetPromptManagementToPreset(preset, {
              presetName,
              preferences: state.preferences,
              isTauriTavern: isTt,
              ttAgentModeEnabled: ttAgentEnabled,
              persistedState: state,
            });
          computedReceipt = receipt;
          return nextPreset;
        },
        { render: 'debounced' },
      );

      let watchdogInstalled = false;
      if (state.preferences.installGlobalWatchdog) {
        watchdogInstalled = ensureGlobalWatchdogInstalled();
      }
      savePresetManagerState(state, deps.hostWindow);

      if (computedReceipt) {
        const activeProfile = (computedReceipt as PresetSyncReceipt)
          .detectedProfile;
        if (
          state.preferences.enabled &&
          (activeProfile === 'kemini_dramatron' ||
            activeProfile === 'kemini_dramatron_uau')
        ) {
          // 命中 Kemini_Dramatron_v3.1 / Kemini_UAU_OutputTool_Grep_v3.5 专属预设方案：自动开启楼层协议与 ICOT 标签修补并同步预设正则引擎
          setFloorTagRepairEnabled(true);
          await syncHostPresetRegexEngine(true);
        } else if (!state.preferences.enabled) {
          await syncHostPresetRegexEngine(false);
        }
        (computedReceipt as PresetSyncReceipt).globalWatchdogInstalled =
          watchdogInstalled;
        lastReceipt = computedReceipt;
      }
      return lastReceipt;
    } catch (err) {
      console.warn('[中控预设托管] 同步预设条目失败', err);
      return null;
    }
  }

  async function restorePresetInternal(options: {
    mode: 'manual_restore' | 'cross_card_guard';
    removeInjectedEntries?: boolean;
  }): Promise<boolean> {
    try {
      const state = loadPresetManagerState(deps.hostWindow);
      const presetName = String(deps.getLoadedPresetName() || 'in_use');
      let didChange = false;

      await deps.updatePresetWith(
        'in_use',
        preset => {
          const result = deactivateManagedPromptsInPreset(preset, {
            presetName,
            persistedState: state,
            mode: options.mode,
            removeInjectedEntries: options.removeInjectedEntries,
          });
          didChange = result.changed;
          return result.preset;
        },
        { render: 'debounced' },
      );

      await syncHostPresetRegexEngine(false);
      savePresetManagerState(state, deps.hostWindow);
      return didChange;
    } catch (err) {
      console.warn('[中控预设托管] 还原预设条目失败', err);
      return false;
    }
  }

  return {
    async start() {
      if (active) return lastReceipt;
      active = true;
      registerConsoleGuard(true);

      const onSyncEvent = () => {
        if (!active) return;
        void syncNow();
      };

      const ev = deps.events ?? {};
      for (const evtName of [
        ev.PRESET_CHANGED,
        ev.CHAT_CHANGED,
        ev.MAIN_API_CHANGED,
      ]) {
        if (evtName && typeof deps.eventOn === 'function') {
          deps.eventOn(evtName, onSyncEvent);
          boundListeners.push({ event: evtName, fn: onSyncEvent });
        }
      }

      if (typeof deps.subscribeTtAgentMode === 'function') {
        unsubTtAgent = deps.subscribeTtAgentMode(() => {
          if (!active) return;
          void syncNow();
        });
      }

      return await syncNow();
    },

    stop() {
      if (!active) return;
      active = false;
      registerConsoleGuard(false);

      for (const item of boundListeners.splice(0, boundListeners.length)) {
        try {
          deps.eventRemoveListener?.(item.event, item.fn);
        } catch {
          // ignore remove listener error
        }
      }

      try {
        void unsubTtAgent?.();
      } catch {
        // ignore unsubscribe error
      }
      unsubTtAgent = null;
    },

    syncNow,

    async restorePresetNow(options) {
      return await restorePresetInternal({
        mode: 'manual_restore',
        removeInjectedEntries: options?.removeInjectedEntries ?? false,
      });
    },

    getPreferences() {
      return loadPresetManagerState(deps.hostWindow).preferences;
    },

    async updatePreferences(patch) {
      const state = loadPresetManagerState(deps.hostWindow);
      state.preferences = {
        ...state.preferences,
        ...(patch ?? {}),
      };
      savePresetManagerState(state, deps.hostWindow);
      if (!state.preferences.enabled) {
        await restorePresetInternal({
          mode: 'manual_restore',
          removeInjectedEntries: false,
        });
      }
      return await syncNow();
    },

    getLastReceipt() {
      return lastReceipt;
    },

    ensureGlobalWatchdogInstalled,
  };
}

export function getSharedPresetPromptManager(): PresetPromptManager {
  if (!singletonManager) {
    singletonManager = createPresetPromptManager();
  }
  return singletonManager;
}
