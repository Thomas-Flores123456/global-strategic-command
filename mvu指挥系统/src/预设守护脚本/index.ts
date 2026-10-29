/**
 * 预设守护脚本 —— 无 UI 全局酒馆脚本独立构建入口（`dist/预设守护脚本/index.js`）
 *
 * 职责：
 * - 挂在酒馆助手“全局脚本（Global Scripts）”中静默运行（无任何 UI / 按钮）；
 * - 当玩家切换到不含《战区中控台》的其他角色卡或聊天时：
 *   1. 检测中控台注册的全局存活函数 `RAC_CONSOLE_GUARD.isActive()` / `window.parent.__RAC_CONSOLE_GUARD__`、
 *      顶层 `#ra-console-shell` 容器与当前角色卡脚本树；
 *   2. 若当前聊天不存在中控台痕迹，自动将 `'in_use'` 预设中的中控专属条目
 *      （`rac_preset_cot_augment_v1`、`rac_tt_agent_four_phase_v1`）设为 `enabled: false`；
 *   3. 自动恢复开启预设中的摘要条目（优先恢复历史快照记录的条目 ID，并开启常规随文摘要如 `📑摘要`）。
 */

import {
  RAC_CONSOLE_GLOBAL_GUARD_NAME,
  RAC_COT_AUGMENT_PROMPT_ID,
  RAC_PRESET_MANAGER_STORAGE_KEY,
  RAC_TT_AGENT_FOUR_PHASE_PROMPT_ID,
  isRegularPerTurnSummaryEntry,
  type ConsoleGlobalGuardHandle,
  type PresetManagerPersistedState,
  type PresetObject,
  type PresetPromptItem,
} from '../中控悬浮窗/host/presetPromptManager';

const MANAGED_IDS = new Set<string>([
  RAC_COT_AUGMENT_PROMPT_ID,
  RAC_TT_AGENT_FOUR_PHASE_PROMPT_ID,
]);

function getTopSameOriginWindow(): (Window &
  typeof globalThis &
  Record<string, unknown>) | null {
  let cur: unknown = typeof window !== 'undefined' ? window : globalThis;
  for (let i = 0; i < 4; i++) {
    if (!cur || typeof cur !== 'object') break;
    const rec = cur as Record<string, unknown>;
    try {
      const parent = rec.parent;
      if (!parent || parent === cur) {
        return rec as Window & typeof globalThis & Record<string, unknown>;
      }
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

export function isCommandConsoleActiveInChat(
  topWin = getTopSameOriginWindow(),
): boolean {
  try {
    const th =
      (topWin?.TavernHelper as Record<string, unknown> | undefined) ??
      ((typeof window !== 'undefined'
        ? (window as unknown as Record<string, unknown>).TavernHelper
        : undefined) as Record<string, unknown> | undefined);
    const getTrees =
      typeof getScriptTrees === 'function'
        ? getScriptTrees
        : (th?.getScriptTrees as typeof getScriptTrees | undefined);

    if (typeof getTrees === 'function') {
      const charTrees = getTrees({ type: 'character' }) ?? [];
      const stack: Array<Record<string, unknown>> = Array.isArray(charTrees)
        ? [...(charTrees as unknown as Array<Record<string, unknown>>)]
        : [];
      let foundConsoleScript = false;
      let consoleScriptEnabled = false;
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;
        if (node.type === 'folder' && Array.isArray(node.scripts)) {
          if (node.enabled !== false) {
            stack.push(...(node.scripts as Array<Record<string, unknown>>));
          }
          continue;
        }
        if (/中控悬浮窗|红警指挥系统/.test(String(node.name ?? ''))) {
          foundConsoleScript = true;
          if (node.enabled) consoleScriptEnabled = true;
        }
      }
      if (!foundConsoleScript || !consoleScriptEnabled) {
        return false;
      }
    }

    const guard =
      (topWin?.__RAC_CONSOLE_GUARD__ as ConsoleGlobalGuardHandle | undefined) ??
      (topWin?.[RAC_CONSOLE_GLOBAL_GUARD_NAME] as
        | ConsoleGlobalGuardHandle
        | undefined) ??
      ((typeof window !== 'undefined'
        ? (window as unknown as Record<string, unknown>)[
            RAC_CONSOLE_GLOBAL_GUARD_NAME
          ]
        : undefined) as ConsoleGlobalGuardHandle | undefined);

    if (guard && typeof guard.isActive === 'function' && guard.isActive()) {
      return true;
    }

    if (topWin?.document?.getElementById('ra-console-shell')) {
      return true;
    }
  } catch {
    // ignore probe errors
  }
  return false;
}

export async function checkAndRestorePresetOnForeignChat(): Promise<boolean> {
  try {
    const topWin = getTopSameOriginWindow();
    if (isCommandConsoleActiveInChat(topWin)) {
      return false;
    }

    const th =
      (topWin?.TavernHelper as Record<string, unknown> | undefined) ??
      ((typeof window !== 'undefined'
        ? (window as unknown as Record<string, unknown>).TavernHelper
        : undefined) as Record<string, unknown> | undefined);

    const readPreset =
      typeof getPreset === 'function'
        ? (name: string) => getPreset(name as 'in_use') as unknown as PresetObject
        : (th?.getPreset as ((name: string) => PresetObject) | undefined);

    const writePresetWith =
      typeof updatePresetWith === 'function'
        ? (
            name: string,
            updater: (p: PresetObject) => PresetObject,
            opts?: { render?: 'debounced' | 'immediate' | 'none' },
          ) =>
            updatePresetWith(
              name as 'in_use',
              updater as unknown as Parameters<typeof updatePresetWith>[1],
              opts,
            )
        : (th?.updatePresetWith as
            | ((
                name: string,
                updater: (p: PresetObject) => PresetObject,
                opts?: { render?: 'debounced' | 'immediate' | 'none' },
              ) => Promise<PresetObject>)
            | undefined);

    const readLoadedPresetName =
      typeof getLoadedPresetName === 'function'
        ? getLoadedPresetName
        : (th?.getLoadedPresetName as (() => string) | undefined);

    if (typeof readPreset !== 'function' || typeof writePresetWith !== 'function') {
      return false;
    }

    const presetName =
      typeof readLoadedPresetName === 'function'
        ? String(readLoadedPresetName() || 'in_use')
        : 'in_use';

    let savedState: PresetManagerPersistedState | null = null;
    try {
      const raw =
        (topWin?.localStorage as Storage | undefined)?.getItem(
          RAC_PRESET_MANAGER_STORAGE_KEY,
        ) ??
        (typeof localStorage !== 'undefined'
          ? localStorage.getItem(RAC_PRESET_MANAGER_STORAGE_KEY)
          : null);
      if (raw) {
        savedState = JSON.parse(raw) as PresetManagerPersistedState;
      }
    } catch {
      // ignore storage read errors
    }

    const snapshotIds = new Set<string>(
      savedState?.disabledSummaryIdsByPreset?.[presetName] ?? [],
    );

    const currentPreset = readPreset('in_use');
    if (!currentPreset || !Array.isArray(currentPreset.prompts)) {
      return false;
    }

    let needsUpdate = false;
    for (const p of currentPreset.prompts) {
      if (!p) continue;
      if (MANAGED_IDS.has(p.id) && p.enabled) {
        needsUpdate = true;
        break;
      }
      if (
        (snapshotIds.has(p.id) ||
          isRegularPerTurnSummaryEntry(p as PresetPromptItem)) &&
        !p.enabled
      ) {
        needsUpdate = true;
        break;
      }
    }

    if (!needsUpdate) {
      return false;
    }

    await writePresetWith(
      'in_use',
      preset => {
        if (!preset || !Array.isArray(preset.prompts)) return preset;
        for (const p of preset.prompts) {
          if (!p) continue;
          if (MANAGED_IDS.has(p.id)) {
            p.enabled = false;
          } else if (
            snapshotIds.has(p.id) ||
            isRegularPerTurnSummaryEntry(p as PresetPromptItem)
          ) {
            p.enabled = true;
          }
        }
        return preset;
      },
      { render: 'debounced' },
    );

    if (savedState?.disabledSummaryIdsByPreset?.[presetName]) {
      delete savedState.disabledSummaryIdsByPreset[presetName];
      const nextRaw = JSON.stringify(savedState);
      try {
        (topWin?.localStorage as Storage | undefined)?.setItem(
          RAC_PRESET_MANAGER_STORAGE_KEY,
          nextRaw,
        );
      } catch {
        // ignore storage write errors
      }
    }

    console.info(
      '[中控预设守护] 检测到当前聊天未挂载战区中控台，已自动关闭中控预设条目并恢复开启预设摘要条目',
    );
    return true;
  } catch (err) {
    console.warn('[中控预设守护] 跨卡预设自检异常', err);
    return false;
  }
}

let checkTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleWatchdogCheck(delayMs = 650): void {
  if (checkTimer) {
    clearTimeout(checkTimer);
  }
  checkTimer = setTimeout(() => {
    checkTimer = null;
    void checkAndRestorePresetOnForeignChat();
  }, delayMs);
}

function initWatchdog(): void {
  if (
    typeof eventOn === 'function' &&
    typeof tavern_events === 'object' &&
    tavern_events
  ) {
    const ev = tavern_events as Record<string, string>;
    if (ev.CHAT_CHANGED) {
      eventOn(ev.CHAT_CHANGED as EventType, () => scheduleWatchdogCheck(650));
    }
    if (ev.PRESET_CHANGED) {
      eventOn(ev.PRESET_CHANGED as EventType, () => scheduleWatchdogCheck(650));
    }
  }
  scheduleWatchdogCheck(800);
}

if (typeof $ === 'function') {
  $(() => initWatchdog());
} else {
  initWatchdog();
}
