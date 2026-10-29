/**
 * ttExtensionEntry.ts —— TauriTavern 原生 third-party 扩展标准激活入口
 *
 * 架构文档：docs/Architecture/TaruiTavern/README.md (§3.2)
 * 实施任务包：docs/Architecture/Future Developments/30-TauriTavern宿主适配与专属开发脚手架实施任务包.md (PKG-A)
 *
 * 核心职责：
 * 1. 导出符合 TauriTavern 第三方扩展 `hooks.activate` 规范的 `activate()` 与 `deactivate()`；
 * 2. 启动前通过 `ttHostBridge.waitForTauriTavernReady()` 等待宿主内核就绪；
 * 3. 幂等初始化中控悬浮窗（支持单测注入自定义 `mountConsole` 回调），并在 `pagehide` 或重复激活时安全清理。
 */

import {
  diagnoseTauriTavernHost,
  waitForTauriTavernReady,
  type TauriTavernHostDiagnostics,
} from './host/ttHostBridge';

export interface TauriTavernExtensionMountContext {
  isTauriReady: boolean;
  diagnostics: TauriTavernHostDiagnostics;
  win: unknown;
}

export type TauriTavernExtensionDisposer = (() => void) & {
  readonly active: boolean;
  readonly isTauriReady: boolean;
  readonly diagnostics: TauriTavernHostDiagnostics;
  dispose(): void;
};

export interface TauriTavernExtensionActivateOptions {
  /** 目标宿主窗口（默认 globalThis / window） */
  win?: unknown;
  /** 自定义挂载器（用于单测替身或自定义宿主挂载流程） */
  mountConsole?: (
    context: TauriTavernExtensionMountContext,
  ) => void | (() => void) | Promise<void | (() => void)>;
  /** 若已处于激活态，是否先强制卸载再重新挂载 */
  forceReinit?: boolean;
}

interface ActiveExtensionState {
  cleanupMount: (() => void) | null;
  removePageHide: (() => void) | null;
  handle: TauriTavernExtensionDisposer;
}

let activeState: ActiveExtensionState | null = null;

async function defaultMountConsole(): Promise<(() => void) | void> {
  await import('./index');
}

function attachPageHideListener(win: unknown, onPageHide: () => void): (() => void) | null {
  if (!win || typeof win !== 'object') return null;
  const target = win as {
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  };
  if (typeof target.addEventListener !== 'function') return null;
  target.addEventListener('pagehide', onPageHide);
  return () => {
    if (typeof target.removeEventListener === 'function') {
      target.removeEventListener('pagehide', onPageHide);
    }
  };
}

export function isExtensionActive(): boolean {
  return activeState !== null;
}

export function deactivate(): void {
  if (!activeState) return;
  const current = activeState;
  activeState = null;

  try {
    current.removePageHide?.();
  } catch {
    // Ignore listener removal errors
  }

  try {
    current.cleanupMount?.();
  } catch (err) {
    console.warn('[全域作战指挥系统 · TT 扩展] 卸载清理异常:', err);
  }
}

export async function activate(
  options: TauriTavernExtensionActivateOptions = {},
): Promise<TauriTavernExtensionDisposer> {
  if (activeState && !options.forceReinit) {
    return activeState.handle;
  }
  if (activeState && options.forceReinit) {
    deactivate();
  }

  const targetWin =
    options.win !== undefined
      ? options.win
      : typeof window !== 'undefined'
        ? window
        : globalThis;

  const isTauriReady = await waitForTauriTavernReady(targetWin);
  const diagnostics = diagnoseTauriTavernHost(targetWin);

  const mounter = options.mountConsole ?? defaultMountConsole;
  let customCleanup: (() => void) | null = null;

  try {
    const result = await mounter({
      isTauriReady,
      diagnostics,
      win: targetWin,
    });
    if (typeof result === 'function') {
      customCleanup = result;
    }
  } catch (err) {
    console.warn('[全域作战指挥系统 · TT 扩展] 挂载回调执行异常:', err);
  }

  let disposed = false;
  const idempotentDispose = () => {
    if (disposed) return;
    disposed = true;
    deactivate();
  };

  const handle = Object.assign(idempotentDispose, {
    get active() {
      return !disposed && activeState !== null;
    },
    isTauriReady,
    diagnostics,
    dispose: idempotentDispose,
  }) as TauriTavernExtensionDisposer;

  const removePageHide = attachPageHideListener(targetWin, idempotentDispose);

  activeState = {
    cleanupMount: customCleanup,
    removePageHide,
    handle,
  };

  return handle;
}
