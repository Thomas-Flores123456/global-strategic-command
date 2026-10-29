/**
 * modalHost.ts —— 酒馆宿主全视窗战术弹窗挂载管理与渲染管线
 *
 * 核心架构与职责：
 * 1. 模态框独立挂载在酒馆宿主页面（hostDocument.body），全视窗（100vw × 100vh）覆盖；
 * 2. 侧边控制台保持固定停靠尺寸（340px / 36px），绝不因模态弹窗展开而拉伸自身；
 * 3. 模态宿主 iframe 监听 load 事件并实现幂等样式注入，彻底防止浏览器异步 about:blank 重置抹除样式；
 * 4. 完整克隆并动态监听主应用中的所有 <style> 与 adoptedStyleSheets（含 TailwindCSS、Vue Scoped、global.css）；
 * 5. 将当前阵营主题（data-theme）与字体环境变量同步绑定至模态框根容器，确保 CSS 变量（--line-hot、--deep-2、--text 等）100% 正确生效；
 * 6. 治理战术层叠顺序（Tactical Z-Index Hierarchy）：
 *    - 宿主蒙层底座：z-index: 10000
 *    - 主模态卡片（档案/科技/机娘/设置）：z-index: 10010
 *    - 二级详情弹窗（DetailDrawer）：z-index: 10020
 *    - 系统通知 / Toastr 提示：z-index: 10030
 * 7. 统一 Escape 键盘事件监听与传递，遵循先进后出（LIFO）原则。
 */

import { nowPerfMs, recordPerfSample } from '../models/perfMonitor';
import { applyMobileSurface, TT_SURFACE } from './ttHostBridge';

export const OVERLAY_HOST_ID = 'tavernweave-tactical-modal-overlay';
export const HUD_HOST_ID = 'tavernweave-hud-host';

export const Z_INDEX_HOST_BASE = 10000;
export const Z_INDEX_MAIN_MODAL = 10010;
export const Z_INDEX_DETAIL_DRAWER = 10020;
export const Z_INDEX_TOAST = 10030;
export const Z_INDEX_HUD_HOST = 9995;

/** 阵营 CSS 变量字典，确保即便在隔离 iframe 根容器中也可无损继承红警 HUD 主题 */
export const THEME_CSS_VARS: Record<string, Record<string, string>> = {
  allies: {
    '--void': '#070b10',
    '--glass': 'rgba(13, 21, 29, 0.92)',
    '--glass-soft': 'rgba(17, 28, 38, 0.62)',
    '--glass-faint': 'rgba(26, 40, 53, 0.34)',
    '--line': 'rgba(141, 180, 207, 0.12)',
    '--line-hi': 'rgba(155, 196, 224, 0.24)',
    '--line-hot': 'rgba(145, 201, 239, 0.54)',
    '--text': '#d9e5ed',
    '--text-2': '#8fa3b1',
    '--text-3': '#7a8e9a',
    '--text-4': '#354957',
    '--ice': '#8bc3e7',
    '--ice-soft': '#5e91b1',
    '--safe': '#78b69b',
    '--amber': '#d2ad69',
    '--danger': '#cf796f',
    '--tint': '#89b5d4',
    '--tint-bright': '#cae5f7',
    '--deep-1': '#070c11',
    '--deep-2': '#0f1820',
    '--deep-3': '#16242e',
    '--t-hi': 'var(--text)',
    '--t-mid': 'var(--text-2)',
    '--t-low': 'var(--text-3)',
    '--t-faint': 'var(--text-4)',
    '--warn': 'var(--amber)',
    '--ok': 'var(--safe)',
    '--bad': 'var(--danger)',
    '--focus': '#38bdf8',
    '--alert-bright': '#ff5a36',
    '--gap-xs': '4px',
    '--gap-sm': '8px',
    '--gap-md': '12px',
    '--gap-lg': '16px',
    '--blur-full': 'blur(14px)',
    '--blur-fallback': 'none',
    '--rac-bg': '#080a0b',
    '--rac-panel': '#0c1113',
    '--rac-panel-2': '#0f1619',
    '--rac-dim': '#2c3b40',
    '--rac-line': '#5f7c84',
    '--rac-hi': '#d4e3e6',
    '--rac-text': '#cfdde0',
    '--rac-muted': '#8aa1a7',
    '--rac-accent': '#38bdf8',
    '--rac-ok': '#78b69b',
    '--rac-warn': '#d2ad69',
    '--rac-alert': '#ff5a36',
    '--rac-focus': '#38bdf8',
    '--rac-overlay': 'rgba(12,17,19,.96)',
  },
  allied: {
    '--void': '#070b10',
    '--glass': 'rgba(13, 21, 29, 0.92)',
    '--glass-soft': 'rgba(17, 28, 38, 0.62)',
    '--glass-faint': 'rgba(26, 40, 53, 0.34)',
    '--line': 'rgba(141, 180, 207, 0.12)',
    '--line-hi': 'rgba(155, 196, 224, 0.24)',
    '--line-hot': 'rgba(145, 201, 239, 0.54)',
    '--text': '#d9e5ed',
    '--text-2': '#8fa3b1',
    '--text-3': '#7a8e9a',
    '--text-4': '#354957',
    '--ice': '#8bc3e7',
    '--ice-soft': '#5e91b1',
    '--safe': '#78b69b',
    '--amber': '#d2ad69',
    '--danger': '#cf796f',
    '--tint': '#89b5d4',
    '--tint-bright': '#cae5f7',
    '--deep-1': '#070c11',
    '--deep-2': '#0f1820',
    '--deep-3': '#16242e',
    '--t-hi': 'var(--text)',
    '--t-mid': 'var(--text-2)',
    '--t-low': 'var(--text-3)',
    '--t-faint': 'var(--text-4)',
    '--warn': 'var(--amber)',
    '--ok': 'var(--safe)',
    '--bad': 'var(--danger)',
    '--focus': '#38bdf8',
    '--alert-bright': '#ff5a36',
    '--gap-xs': '4px',
    '--gap-sm': '8px',
    '--gap-md': '12px',
    '--gap-lg': '16px',
    '--blur-full': 'blur(14px)',
    '--blur-fallback': 'none',
    '--rac-bg': '#080a0b',
    '--rac-panel': '#0c1113',
    '--rac-panel-2': '#0f1619',
    '--rac-dim': '#2c3b40',
    '--rac-line': '#5f7c84',
    '--rac-hi': '#d4e3e6',
    '--rac-text': '#cfdde0',
    '--rac-muted': '#8aa1a7',
    '--rac-accent': '#38bdf8',
    '--rac-ok': '#78b69b',
    '--rac-warn': '#d2ad69',
    '--rac-alert': '#ff5a36',
    '--rac-focus': '#38bdf8',
    '--rac-overlay': 'rgba(12,17,19,.96)',
  },
  soviet: {
    '--void': '#0f0507',
    '--glass': 'rgba(26, 10, 12, 0.92)',
    '--glass-soft': 'rgba(36, 13, 15, 0.62)',
    '--glass-faint': 'rgba(51, 18, 21, 0.34)',
    '--line': 'rgba(214, 122, 122, 0.14)',
    '--line-hi': 'rgba(228, 132, 132, 0.26)',
    '--line-hot': 'rgba(240, 120, 120, 0.56)',
    '--text': '#eed9da',
    '--text-2': '#b18f92',
    '--text-3': '#9a7074',
    '--text-4': '#553639',
    '--ice': '#e25555',
    '--ice-soft': '#a63c3c',
    '--tint': '#cf5b5b',
    '--tint-bright': '#f5c4c4',
    '--deep-1': '#120607',
    '--deep-2': '#1e0c0e',
    '--deep-3': '#2b1114',
    '--safe': '#78b69b',
    '--amber': '#d2ad69',
    '--danger': '#cf796f',
    '--t-hi': 'var(--text)',
    '--t-mid': 'var(--text-2)',
    '--t-low': 'var(--text-3)',
    '--t-faint': 'var(--text-4)',
    '--warn': 'var(--amber)',
    '--ok': 'var(--safe)',
    '--bad': 'var(--danger)',
    '--focus': '#38bdf8',
    '--alert-bright': '#ff5a36',
    '--gap-xs': '4px',
    '--gap-sm': '8px',
    '--gap-md': '12px',
    '--gap-lg': '16px',
    '--blur-full': 'blur(14px)',
    '--blur-fallback': 'none',
    '--rac-bg': '#0f0507',
    '--rac-panel': '#160b0d',
    '--rac-panel-2': '#1a0e10',
    '--rac-dim': '#4a2428',
    '--rac-line': '#8c4040',
    '--rac-hi': '#f5c4c4',
    '--rac-text': '#eed9da',
    '--rac-muted': '#b18f92',
    '--rac-accent': '#e25555',
    '--rac-ok': '#78b69b',
    '--rac-warn': '#d2ad69',
    '--rac-alert': '#ff5a36',
    '--rac-focus': '#e25555',
    '--rac-overlay': 'rgba(22,11,13,.96)',
  },
  yuri: {
    '--void': '#0c0710',
    '--glass': 'rgba(21, 13, 29, 0.92)',
    '--glass-soft': 'rgba(28, 17, 38, 0.62)',
    '--glass-faint': 'rgba(40, 26, 53, 0.34)',
    '--line': 'rgba(180, 141, 207, 0.12)',
    '--line-hi': 'rgba(196, 155, 224, 0.24)',
    '--line-hot': 'rgba(201, 145, 239, 0.54)',
    '--text': '#e3d9ed',
    '--text-2': '#a08fb1',
    '--text-3': '#8a7499',
    '--text-4': '#453557',
    '--ice': '#b892e5',
    '--ice-soft': '#8a63b5',
    '--tint': '#a989d4',
    '--tint-bright': '#e3caf7',
    '--deep-1': '#0c0711',
    '--deep-2': '#170e20',
    '--deep-3': '#24162e',
    '--safe': '#78b69b',
    '--amber': '#d2ad69',
    '--danger': '#cf796f',
    '--t-hi': 'var(--text)',
    '--t-mid': 'var(--text-2)',
    '--t-low': 'var(--text-3)',
    '--t-faint': 'var(--text-4)',
    '--warn': 'var(--amber)',
    '--ok': 'var(--safe)',
    '--bad': 'var(--danger)',
    '--rac-bg': '#0c0710',
    '--rac-panel': '#120e18',
    '--rac-panel-2': '#17121e',
    '--rac-dim': '#3a2850',
    '--rac-line': '#6e4fa0',
    '--rac-hi': '#e3caf7',
    '--rac-text': '#e3d9ed',
    '--rac-muted': '#a08fb1',
    '--rac-accent': '#b892e5',
    '--rac-ok': '#78b69b',
    '--rac-warn': '#d2ad69',
    '--rac-alert': '#ff5a36',
    '--rac-focus': '#b892e5',
    '--rac-overlay': 'rgba(18,14,24,.96)',
  },
};

export interface ModalHostOptions {
  onMountRootReady?: (root: HTMLElement) => void;
  onEscape?: (e: KeyboardEvent) => void;
}

let globalEscapeCallback: ((e: KeyboardEvent) => void) | null = null;
let styleObserver: MutationObserver | null = null;
let hudStyleObserver: MutationObserver | null = null;
let overlayStylesDirty = true;
let hudStylesDirty = true;

export function setModalEscapeHandler(fn: ((e: KeyboardEvent) => void) | null) {
  globalEscapeCallback = fn;
}

export function getHostDocument(): Document | null {
  if (typeof window === 'undefined') return null;
  const fallback = typeof document !== 'undefined' ? document : null;
  try {
    const frame = window.frameElement as HTMLElement | null;
    return frame?.ownerDocument ?? window.parent?.document ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * 宿主视口宽度（用于响应式窄屏判定）。
 *
 * 背景：本模块所在的角色脚本 iframe 停靠宽度仅 340px，但战术弹窗经 modalHost 被挂载到
 * 宿主全屏 overlay iframe（宿主真实视口，真机可达 2560px）。若直接读脚本 iframe 自身的
 * `window.innerWidth`（=340），窄屏判定（<640）会恒为 true，导致左栏误塌成顶部横条。
 * 因此窄屏判定必须以「弹窗实际挂载的宿主视口宽度」为准，而非脚本 iframe 自身宽度。
 *
 * 取值优先级：
 * 1. 宿主 document 的 defaultView.innerWidth（弹窗实际所在的宿主视口，正确来源）；
 * 2. 兜底：拿不到宿主视口时回退到脚本自身 `window.innerWidth`。
 *
 * 兜底取舍：宁可回退脚本自身宽度也不返回一个恒大值——多数真机场景 getHostDocument()
 * 能拿到宿主视口；仅在纯单文档/测试等极端退化环境才回退，此时脚本 window 即宿主 window，
 * 语义等价、不会误判。返回 0 仅出现在完全无 window 的非浏览器环境（此时 0 < 640 判为窄屏，
 * 但该环境本就不渲染弹窗，无实际影响）。
 */
export function getHostViewportWidth(): number {
  const hostView = getHostDocument()?.defaultView;
  if (hostView && typeof hostView.innerWidth === 'number') return hostView.innerWidth;
  return typeof window !== 'undefined' ? window.innerWidth : 0;
}

/**
 * 弹窗实际挂载的宿主 window（用于挂 resize 监听驱动响应式窄屏判定）。
 * 与 getHostViewportWidth 同源：返回 getHostDocument()?.defaultView；退化环境回退脚本自身 window。
 * 拿不到时返回 null，调用方应安全降级为「不监听 resize」。
 */
export function getHostWindow(): (Window & typeof globalThis) | null {
  const hostView = getHostDocument()?.defaultView as (Window & typeof globalThis) | null | undefined;
  if (hostView) return hostView;
  return typeof window !== 'undefined' ? (window as Window & typeof globalThis) : null;
}

/** 提取 style 元素中的有效规则（支持 CSSOM 与 innerHTML 降级） */
function getStyleContent(styleEl: HTMLStyleElement): string {
  try {
    const sheet = styleEl.sheet;
    if (sheet && sheet.cssRules && sheet.cssRules.length > 0) {
      return Array.from(sheet.cssRules)
        .map(r => r.cssText)
        .join('\n');
    }
  } catch {
    /* 忽略跨域或限制错误 */
  }
  return styleEl.textContent || styleEl.innerHTML || '';
}

/**
 * 完整克隆并幂等同步主应用中的所有样式（<style>、<link> 与 adoptedStyleSheets）
 */
export function syncStylesToOverlay(overlay: HTMLIFrameElement) {
  try {
    applyMobileSurface(overlay, TT_SURFACE.Backdrop);
    const doc = overlay.contentDocument;
    if (!doc) return;

    // 1. 设置根节点与 body 基础布局与字体
    doc.documentElement.style.cssText =
      'height:100%;width:100%;background:transparent;overflow:hidden;margin:0;padding:0;';
    doc.body.style.cssText = [
      'height:100%',
      'width:100%',
      'background:transparent',
      'overflow:hidden',
      'margin:0',
      'padding:0',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      "font-family: Inter, 'Segoe UI', system-ui, 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
      '-webkit-font-smoothing: antialiased',
    ].join(';');

    // 2. 幂等更新 doc.head 中的样式节点
    let styleContainer = doc.getElementById('ra-modal-style-container');
    if (!styleContainer) {
      styleContainer = doc.createElement('div');
      styleContainer.id = 'ra-modal-style-container';
      doc.head.appendChild(styleContainer);
    }

    const stylesParts: string[] = [];
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
    for (const link of links) {
      stylesParts.push(link.outerHTML);
    }

    const styles = Array.from(document.querySelectorAll<HTMLStyleElement>('style'));
    for (const s of styles) {
      const css = getStyleContent(s);
      const attrs = Array.from(s.attributes)
        .map(a => `${a.name}="${a.value}"`)
        .join(' ');
      stylesParts.push(`<style ${attrs}>${css}</style>`);
    }

    // 注入战术 Z-Index 治理规则与全局样式覆盖（含 TauriTavern 安全区与软键盘避让 CSS 变量兼容）
    stylesParts.push(`
      <style id="ra-tactical-z-index-overrides">
        #${OVERLAY_HOST_ID} {
          z-index: ${Z_INDEX_HOST_BASE} !important;
          padding-top: var(--tt-inset-top, 0px);
          padding-bottom: var(--tt-viewport-bottom-inset, var(--tt-inset-bottom, 0px));
          box-sizing: border-box;
        }
        #app.ra-app--modal-open,
        #ra-modal-mount-root {
          padding-top: var(--tt-inset-top, 0px);
          padding-right: var(--tt-inset-right, 0px);
          padding-bottom: var(--tt-viewport-bottom-inset, var(--tt-inset-bottom, 0px));
          padding-left: var(--tt-inset-left, 0px);
          box-sizing: border-box;
        }
        .ra-modal-mask {
          z-index: ${Z_INDEX_MAIN_MODAL} !important;
          padding-top: var(--tt-inset-top, 0px);
          padding-bottom: var(--tt-viewport-bottom-inset, var(--tt-inset-bottom, 0px));
          box-sizing: border-box;
        }
        .detail-mask {
          z-index: ${Z_INDEX_DETAIL_DRAWER} !important;
        }
        #toast-container,
        .toast-top-right,
        .toast-top-left,
        .toast-bottom-right,
        .toast-bottom-left {
          z-index: ${Z_INDEX_TOAST} !important;
        }
      </style>
    `);

    styleContainer.innerHTML = stylesParts.join('\n');

    // 3. 克隆 adoptedStyleSheets（TailwindCSS v4 等构造样式表走 CSSOM 而非 <style> 标签）
    const overlayWindow = overlay.contentWindow;
    if (overlayWindow && 'adoptedStyleSheets' in document && 'adoptedStyleSheets' in doc) {
      try {
        const sheets = document.adoptedStyleSheets;
        if (sheets && sheets.length > 0) {
          const newSheets: CSSStyleSheet[] = [];
          let cloned = 0;
          for (const s of sheets) {
            try {
              // 必须用覆盖层自身 realm 的构造器，跨文档 sheet 直接 adopted 会抛 InvalidStateError
              const SheetCtor = (overlayWindow as Window & typeof globalThis).CSSStyleSheet;
              const newSheet = new SheetCtor();
              const css = Array.from(s.cssRules)
                .map(r => r.cssText)
                .join('\n');
              newSheet.replaceSync(css);
              newSheets.push(newSheet);
              cloned++;
            } catch {
              /* 单张克隆失败跳过，不影响其余样式表 */
            }
          }
          if (cloned > 0) {
            doc.adoptedStyleSheets = newSheets;
          }
        }
      } catch (err) {
        console.warn('[modalHost] adoptedStyleSheets sync warning:', err);
      }
    }

    // 4. 确保宿主容器结构：doc.body -> #app.ra-app--modal-open -> #ra-modal-mount-root
    let appContainer = doc.getElementById('app');
    if (!appContainer) {
      appContainer = doc.createElement('div');
      appContainer.id = 'app';
      doc.body.appendChild(appContainer);
    }
    appContainer.className = 'ra-app--modal-open';
    applyMobileSurface(appContainer, TT_SURFACE.ViewportHost);
    appContainer.style.cssText =
      'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:transparent;border:none;box-shadow:none;padding:0;margin:0;box-sizing:border-box;';

    let root = doc.getElementById('ra-modal-mount-root');
    if (!root) {
      root = doc.createElement('div');
      root.id = 'ra-modal-mount-root';
      root.style.cssText =
        'width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding-top:var(--tt-inset-top, 0px);padding-bottom:var(--tt-viewport-bottom-inset, var(--tt-inset-bottom, 0px));box-sizing:border-box;';
      appContainer.appendChild(root);
    } else if (root.parentElement !== appContainer) {
      appContainer.appendChild(root);
    }
    applyMobileSurface(root, TT_SURFACE.FullscreenWindow);

    // 5. 同步当前阵营主题与字体变量
    syncModalHostTheme();
    overlayStylesDirty = false;
  } catch (err) {
    console.warn('[modalHost] syncStylesToOverlay error:', err);
  }
}

/**
 * 同步宿主文档（hostDoc）自身的 data-ra-theme / --rac-* 变量，并穿透同步宿主内嵌的所有同源楼层 iframe
 */
export function syncHostAndChildFramesTheme(hostDoc: Document, theme: string) {
  const normalizedTheme = theme === 'allies' ? 'allied' : theme;
  const vars = THEME_CSS_VARS[normalizedTheme] || THEME_CSS_VARS.allied;

  try {
    hostDoc.documentElement?.setAttribute('data-ra-theme', normalizedTheme);
    hostDoc.body?.setAttribute('data-ra-theme', normalizedTheme);
    const rootStyle = hostDoc.documentElement?.style;
    if (rootStyle && typeof rootStyle.setProperty === 'function') {
      for (const [key, val] of Object.entries(vars)) {
        if (key.startsWith('--rac-')) {
          rootStyle.setProperty(key, val);
        }
      }
    }
  } catch {
    /* ignore host root style error */
  }

  try {
    if (typeof hostDoc.querySelectorAll !== 'function') return;
    const iframes = hostDoc.querySelectorAll('iframe');
    for (let i = 0; i < iframes.length; i++) {
      const frame = iframes[i] as HTMLIFrameElement;
      if (!frame || frame.id === OVERLAY_HOST_ID || frame.id === HUD_HOST_ID) continue;
      try {
        frame.setAttribute('data-ra-theme', normalizedTheme);
        const cw = frame.contentWindow;
        if (cw && cw !== window && typeof cw.postMessage === 'function') {
          cw.postMessage({ type: 'ra-theme-changed', theme: normalizedTheme }, '*');
        }
        const cdoc = frame.contentDocument;
        if (cdoc) {
          const childApp = cdoc.getElementById('app');
          const childLauncher = cdoc.querySelector('.launcher-shell');
          if (childApp && (childLauncher || childApp.querySelector('.terminal-shell'))) {
            childApp.setAttribute('data-theme', normalizedTheme);
          }
          if (childLauncher) {
            childLauncher.setAttribute('data-theme', normalizedTheme);
          }
        }
      } catch {
        /* 跨域或沙箱隔离 iframe 安全跳过 */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * 将当前阵营主题（data-theme）与字体环境变量同步绑定至模态框根容器及宿主楼层 iframe
 */
export function syncModalHostTheme(themeKey?: string) {
  const hostDoc = getHostDocument();
  if (!hostDoc) return;

  let theme = themeKey;
  if (!theme) {
    theme = document.querySelector('#app')?.getAttribute('data-theme') ?? 'allied';
  }

  syncHostAndChildFramesTheme(hostDoc, theme);

  const overlay = hostDoc.getElementById(OVERLAY_HOST_ID) as HTMLIFrameElement | null;
  if (overlay?.contentDocument) {
    const doc = overlay.contentDocument;
    doc.documentElement.setAttribute('data-theme', theme);
    doc.body.setAttribute('data-theme', theme);

    const appContainer = doc.getElementById('app');
    if (appContainer) {
      appContainer.setAttribute('data-theme', theme);
      appContainer.style.setProperty(
        '--mono',
        "'Cascadia Mono', 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Consolas, monospace",
      );
      appContainer.style.setProperty(
        'font-family',
        "Inter, 'Segoe UI', system-ui, 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
      );
      appContainer.style.setProperty('font-size', '12.5px');
      appContainer.style.setProperty('line-height', '1.55');

      const vars = THEME_CSS_VARS[theme] || THEME_CSS_VARS.allies;
      for (const [key, val] of Object.entries(vars)) {
        appContainer.style.setProperty(key, val);
      }
    }

    const root = doc.getElementById('ra-modal-mount-root');
    if (root) {
      root.setAttribute('data-theme', theme);
    }
  }

  // 单文档/测试环境退化节点
  const local = document.getElementById(OVERLAY_HOST_ID);
  if (local && local.tagName !== 'IFRAME') {
    local.setAttribute('data-theme', theme);
    const vars = THEME_CSS_VARS[theme] || THEME_CSS_VARS.allies;
    for (const [key, val] of Object.entries(vars)) {
      local.style.setProperty(key, val);
    }
  }
}

function handleIframeKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && globalEscapeCallback) {
    globalEscapeCallback(e);
  }
}

function bindIframeEscape(overlay: HTMLIFrameElement) {
  try {
    const win = overlay.contentWindow;
    if (!win) return;
    win.removeEventListener('keydown', handleIframeKeyDown);
    win.addEventListener('keydown', handleIframeKeyDown);
  } catch (err) {
    console.warn('[modalHost] bindIframeEscape error:', err);
  }
}

/** 动态监听主应用中的 <head> 样式变动并增量克隆 */
function observeMainStyles(overlay: HTMLIFrameElement) {
  if (typeof MutationObserver === 'undefined') return;
  if (styleObserver) {
    styleObserver.disconnect();
    styleObserver = null;
  }
  try {
    styleObserver = new MutationObserver(() => {
      overlayStylesDirty = true;
      const displayVal =
        typeof (overlay.style as { get?: (k: string) => string }).get === 'function'
          ? (overlay.style as unknown as { get(k: string): string }).get('display')
          : overlay.style?.display;
      if (displayVal && displayVal !== 'none') {
        syncStylesToOverlay(overlay);
      }
    });
    if (document.head) {
      styleObserver.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  } catch (err) {
    console.warn('[modalHost] observeMainStyles error:', err);
  }
}

/**
 * 初始化宿主全视窗模态覆盖层（挂载在酒馆主文档 body 上）
 */
export function initModalHost(options?: ModalHostOptions): HTMLElement | null {
  if (options?.onEscape) {
    globalEscapeCallback = options.onEscape;
  }

  const hostDoc = getHostDocument();
  if (!hostDoc || typeof hostDoc.createElement !== 'function') return null;

  // 单文档/测试环境且未运行在 frameElement 内时退化为当前 document.body
  if (typeof window !== 'undefined' && !window.frameElement && hostDoc === document) {
    let localHost = document.getElementById(OVERLAY_HOST_ID);
    if (!localHost) {
      localHost = document.createElement('div');
      localHost.id = OVERLAY_HOST_ID;
      localHost.style.display = 'none';
      localHost.style.zIndex = String(Z_INDEX_HOST_BASE);
      localHost.style.paddingTop = 'var(--tt-inset-top, 0px)';
      localHost.style.paddingBottom = 'var(--tt-viewport-bottom-inset, var(--tt-inset-bottom, 0px))';
      document.body.appendChild(localHost);
    }
    applyMobileSurface(localHost, TT_SURFACE.Backdrop);
    syncModalHostTheme();
    return localHost;
  }

  let overlay = hostDoc.getElementById(OVERLAY_HOST_ID) as HTMLIFrameElement | null;
  if (!overlay) {
    overlay = hostDoc.createElement('iframe');
    overlay.id = OVERLAY_HOST_ID;
    applyMobileSurface(overlay, TT_SURFACE.Backdrop);
    overlay.style.cssText = [
      'position: fixed !important',
      'top: 0 !important',
      'left: 0 !important',
      'width: 100vw !important',
      'height: 100vh !important',
      'border: none !important',
      'background: transparent !important',
      `z-index: ${Z_INDEX_HOST_BASE} !important`,
      'pointer-events: none !important',
      'display: none !important',
      'margin: 0 !important',
      'padding-top: var(--tt-inset-top, 0px) !important',
      'padding-bottom: var(--tt-viewport-bottom-inset, var(--tt-inset-bottom, 0px)) !important',
      'box-sizing: border-box !important',
      'overflow: hidden !important',
    ].join(';');
    overlay.setAttribute('allowtransparency', 'true');

    // 核心改造：监听 iframe 的 load 事件，处理异步 about:blank 重置导致的样式丢失
    overlay.addEventListener('load', () => {
      overlayStylesDirty = true;
      syncStylesToOverlay(overlay!);
      bindIframeEscape(overlay!);
      const newRoot = getOverlayMountRoot(overlay);
      if (newRoot && options?.onMountRootReady) {
        options.onMountRootReady(newRoot);
      }
    });

    hostDoc.body.appendChild(overlay);

    overlayStylesDirty = true;
    syncStylesToOverlay(overlay);
    bindIframeEscape(overlay);
    observeMainStyles(overlay);
  } else {
    applyMobileSurface(overlay, TT_SURFACE.Backdrop);
    if (overlayStylesDirty) {
      syncStylesToOverlay(overlay);
    }
    bindIframeEscape(overlay);
  }

  return getOverlayMountRoot(overlay);
}

export function getOverlayMountRoot(overlay?: HTMLIFrameElement | null): HTMLElement | null {
  if (!overlay) {
    const hostDoc = getHostDocument();
    overlay = hostDoc?.getElementById(OVERLAY_HOST_ID) as HTMLIFrameElement | null;
  }
  if (!overlay) return null;
  if (overlay.contentDocument) {
    return overlay.contentDocument.getElementById('ra-modal-mount-root') ?? overlay.contentDocument.body;
  }
  return overlay;
}

/**
 * 按需切换模态宿主覆盖层的显隐与交互响应
 */
export function setModalHostVisible(visible: boolean) {
  const hostDoc = getHostDocument();
  if (!hostDoc) return;
  const overlay = hostDoc.getElementById(OVERLAY_HOST_ID) as HTMLElement | null;
  if (!overlay) return;

  if (visible) {
    if (overlay.tagName === 'IFRAME') {
      const iframeOverlay = overlay as HTMLIFrameElement;
      const syncedContainer =
        iframeOverlay.contentDocument?.getElementById('ra-modal-style-container') ??
        iframeOverlay.contentDocument?.getElementById('ra-modal-synced-styles');
      if (overlayStylesDirty || !syncedContainer || !syncedContainer.innerHTML) {
        const t0 = nowPerfMs();
        syncStylesToOverlay(iframeOverlay);
        recordPerfSample('modal.styleSync', nowPerfMs() - t0, {
          cacheHit: false,
          detail: 'syncStylesToOverlay',
        });
      } else {
        recordPerfSample('modal.styleSync', 0, {
          skipped: true,
          cacheHit: true,
          silentLog: true,
        });
      }
    }
    overlay.style.setProperty('display', 'block', 'important');
    overlay.style.setProperty('pointer-events', 'auto', 'important');
  } else {
    overlay.style.setProperty('display', 'none', 'important');
    overlay.style.setProperty('pointer-events', 'none', 'important');
  }
}

/**
 * 卸载清理宿主覆盖层
 */
export function destroyModalHost() {
  if (styleObserver) {
    styleObserver.disconnect();
    styleObserver = null;
  }
  overlayStylesDirty = true;
  globalEscapeCallback = null;
  const hostDoc = getHostDocument();
  const overlay = hostDoc?.getElementById(OVERLAY_HOST_ID);
  overlay?.remove();
}

/* ═══════════════ 常驻全视窗透明 HUD 伴生宿主（手持板/胶囊穿透挂载） ═══════════════ */

/**
 * 完整克隆并幂等同步样式到常驻透明 HUD 伴生 iframe
 */
export function syncStylesToHud(hudOverlay: HTMLIFrameElement) {
  try {
    applyMobileSurface(hudOverlay, TT_SURFACE.FreeWindow);
    const doc = hudOverlay.contentDocument;
    if (!doc) return;

    // 1. 设置根节点与 body：全视窗透明且默认 pointer-events: auto（窗口化贴合，由宿主 iframe 尺寸包围）
    doc.documentElement.style.cssText =
      'height:100%;width:100%;background:transparent;overflow:visible;margin:0;padding:0;pointer-events:auto;';
    doc.body.style.cssText = [
      'height:100%',
      'width:100%',
      'background:transparent',
      'overflow:visible',
      'margin:0',
      'padding:0',
      'display:block',
      'pointer-events:auto',
      "font-family: Inter, 'Segoe UI', system-ui, 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
      '-webkit-font-smoothing: antialiased',
    ].join(';');

    // 2. 幂等更新 doc.head 中的样式节点
    let styleContainer = doc.getElementById('ra-hud-style-container');
    if (!styleContainer) {
      styleContainer = doc.createElement('div');
      styleContainer.id = 'ra-hud-style-container';
      doc.head.appendChild(styleContainer);
    }

    const stylesParts: string[] = [];
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
    for (const link of links) {
      stylesParts.push(link.outerHTML);
    }

    const styles = Array.from(document.querySelectorAll<HTMLStyleElement>('style'));
    for (const s of styles) {
      const css = getStyleContent(s);
      const attrs = Array.from(s.attributes)
        .map(a => `${a.name}="${a.value}"`)
        .join(' ');
      stylesParts.push(`<style ${attrs}>${css}</style>`);
    }

    // 注入战术 HUD 样式覆盖与 pointer-events 隔离
    stylesParts.push(`
      <style id="ra-tactical-hud-overrides">
        #${HUD_HOST_ID} {
          z-index: ${Z_INDEX_HUD_HOST} !important;
          pointer-events: auto !important;
        }
        #ra-hud-mount-root {
          width: 100%;
          height: 100%;
          pointer-events: auto;
          position: relative;
        }
      </style>
    `);

    styleContainer.innerHTML = stylesParts.join('\n');

    // 3. 克隆 adoptedStyleSheets
    const overlayWindow = hudOverlay.contentWindow;
    if (overlayWindow && 'adoptedStyleSheets' in document && 'adoptedStyleSheets' in doc) {
      try {
        const sheets = document.adoptedStyleSheets;
        if (sheets && sheets.length > 0) {
          const newSheets: CSSStyleSheet[] = [];
          let cloned = 0;
          for (const s of sheets) {
            try {
              const SheetCtor = (overlayWindow as Window & typeof globalThis).CSSStyleSheet;
              const newSheet = new SheetCtor();
              const css = Array.from(s.cssRules)
                .map(r => r.cssText)
                .join('\n');
              newSheet.replaceSync(css);
              newSheets.push(newSheet);
              cloned++;
            } catch {
              /* 忽略单张克隆失败 */
            }
          }
          if (cloned > 0) {
            doc.adoptedStyleSheets = newSheets;
          }
        }
      } catch (err) {
        console.warn('[modalHost:hud] adoptedStyleSheets sync warning:', err);
      }
    }

    // 4. 确保宿主挂载容器结构：doc.body -> #app.ra-app--hud -> #ra-hud-mount-root
    let appContainer = doc.getElementById('app');
    if (!appContainer) {
      appContainer = doc.createElement('div');
      appContainer.id = 'app';
      doc.body.appendChild(appContainer);
    }
    appContainer.className = 'ra-app--hud';
    appContainer.style.cssText =
      'width:100%;height:100%;display:block;background:transparent;border:none;box-shadow:none;padding:0;margin:0;pointer-events:none;';

    let root = doc.getElementById('ra-hud-mount-root');
    if (!root) {
      root = doc.createElement('div');
      root.id = 'ra-hud-mount-root';
      root.style.cssText = 'width:100%;height:100%;pointer-events:none;position:relative;';
      appContainer.appendChild(root);
    } else if (root.parentElement !== appContainer) {
      appContainer.appendChild(root);
    }

    // 5. 同步阵营主题与字体变量
    syncHudHostTheme();
    hudStylesDirty = false;
  } catch (err) {
    console.warn('[modalHost:hud] syncStylesToHud error:', err);
  }
}

/**
 * 将阵营主题（data-theme）与 CSS 变量同步绑定至 HUD 宿主根容器
 */
export function syncHudHostTheme(themeKey?: string) {
  const hostDoc = getHostDocument();
  if (!hostDoc) return;

  let theme = themeKey;
  if (!theme) {
    theme = document.querySelector('#app')?.getAttribute('data-theme') ?? 'allied';
  }

  const hudOverlay = hostDoc.getElementById(HUD_HOST_ID) as HTMLIFrameElement | null;
  if (hudOverlay?.contentDocument) {
    const doc = hudOverlay.contentDocument;
    doc.documentElement.setAttribute('data-theme', theme);
    doc.body.setAttribute('data-theme', theme);

    const appContainer = doc.getElementById('app');
    if (appContainer) {
      appContainer.setAttribute('data-theme', theme);
      appContainer.style.setProperty(
        '--mono',
        "'Cascadia Mono', 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Consolas, monospace",
      );
      appContainer.style.setProperty(
        'font-family',
        "Inter, 'Segoe UI', system-ui, 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
      );
      appContainer.style.setProperty('font-size', '12.5px');
      appContainer.style.setProperty('line-height', '1.55');

      const vars = THEME_CSS_VARS[theme] || THEME_CSS_VARS.allies;
      for (const [key, val] of Object.entries(vars)) {
        appContainer.style.setProperty(key, val);
      }
    }

    const root = doc.getElementById('ra-hud-mount-root');
    if (root) {
      root.setAttribute('data-theme', theme);
    }
  }

  // 单文档/测试环境退化节点
  const local = document.getElementById(HUD_HOST_ID);
  if (local && local.tagName !== 'IFRAME') {
    local.setAttribute('data-theme', theme);
    const vars = THEME_CSS_VARS[theme] || THEME_CSS_VARS.allies;
    for (const [key, val] of Object.entries(vars)) {
      local.style.setProperty(key, val);
    }
  }
}

/** 动态监听主应用中的 <head> 样式变动并增量克隆至 HUD */
function observeMainStylesForHud(hudOverlay: HTMLIFrameElement) {
  if (typeof MutationObserver === 'undefined') return;
  if (hudStyleObserver) {
    hudStyleObserver.disconnect();
    hudStyleObserver = null;
  }
  try {
    hudStyleObserver = new MutationObserver(() => {
      hudStylesDirty = true;
      const displayVal =
        typeof (hudOverlay.style as { get?: (k: string) => string }).get === 'function'
          ? (hudOverlay.style as unknown as { get(k: string): string }).get('display')
          : hudOverlay.style?.display;
      if (displayVal !== 'none') {
        syncStylesToHud(hudOverlay);
      }
    });
    if (document.head) {
      hudStyleObserver.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  } catch (err) {
    console.warn('[modalHost:hud] observeMainStylesForHud error:', err);
  }
}

export interface HudHostOptions {
  onMountRootReady?: (root: HTMLElement) => void;
}

export interface HudGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  hidden?: boolean;
}

/**
 * 动态同步战术 HUD 伴生宿主 iframe 的物理包围盒与交互响应
 * 将 iframe 精确贴合至手持板当前尺寸与坐标（纽扣 44×44，展开 320×440），
 * iframe 自身开启 pointer-events: auto，使其内部 100% 灵敏响应，
 * 同时其外 100% 零遮挡酒馆宿主底层界面。
 */
export function syncHudHostGeometry(geo: HudGeometry) {
  const hostDoc = getHostDocument();
  if (!hostDoc) return;
  const hudOverlay = hostDoc.getElementById(HUD_HOST_ID) as HTMLElement | null;
  if (!hudOverlay) return;

  if (geo.hidden) {
    hudOverlay.style.setProperty('display', 'none', 'important');
    return;
  }

  hudOverlay.style.setProperty('display', 'block', 'important');
  hudOverlay.style.setProperty('position', 'fixed', 'important');
  hudOverlay.style.setProperty('left', `${Math.round(geo.x)}px`, 'important');
  hudOverlay.style.setProperty('top', `${Math.round(geo.y)}px`, 'important');
  hudOverlay.style.setProperty('width', `${Math.round(geo.width)}px`, 'important');
  hudOverlay.style.setProperty('height', `${Math.round(geo.height)}px`, 'important');
  hudOverlay.style.setProperty('pointer-events', 'auto', 'important');
  hudOverlay.style.setProperty('background', 'transparent', 'important');
  hudOverlay.style.setProperty('border', 'none', 'important');
  hudOverlay.style.setProperty('overflow', 'visible', 'important');
}

/**
 * 初始化常驻战术 HUD 伴生宿主（挂载在酒馆主文档 body 上，窗口化物理贴合手持板尺寸）
 */
export function initHudHost(options?: HudHostOptions): HTMLElement | null {
  const hostDoc = getHostDocument();
  if (!hostDoc || typeof hostDoc.createElement !== 'function') return null;

  // 单文档/测试环境且未运行在 frameElement 内时退化为当前 document.body 下挂载 div
  if (typeof window !== 'undefined' && !window.frameElement && hostDoc === document) {
    let localHost = document.getElementById(HUD_HOST_ID);
    if (!localHost) {
      localHost = document.createElement('div');
      localHost.id = HUD_HOST_ID;
      localHost.style.cssText = [
        'position: fixed !important',
        'top: 12px !important',
        'left: 12px !important',
        'width: 44px !important',
        'height: 44px !important',
        'pointer-events: auto !important',
        'background: transparent !important',
        `z-index: ${Z_INDEX_HUD_HOST} !important`,
        'margin: 0 !important',
        'padding: 0 !important',
        'overflow: visible !important',
      ].join(';');
      const root = document.createElement('div');
      root.id = 'ra-hud-mount-root';
      root.style.cssText = 'width:100%;height:100%;pointer-events:auto;position:relative;';
      localHost.appendChild(root);
      document.body.appendChild(localHost);
    }
    applyMobileSurface(localHost, TT_SURFACE.FreeWindow);
    syncHudHostTheme();
    const targetRoot = localHost.querySelector('#ra-hud-mount-root') as HTMLElement | null;
    return targetRoot ?? localHost;
  }

  let hudOverlay = hostDoc.getElementById(HUD_HOST_ID) as HTMLIFrameElement | null;
  if (!hudOverlay) {
    hudOverlay = hostDoc.createElement('iframe');
    hudOverlay.id = HUD_HOST_ID;
    applyMobileSurface(hudOverlay, TT_SURFACE.FreeWindow);
    hudOverlay.style.cssText = [
      'position: fixed !important',
      'top: 12px !important',
      'left: 12px !important',
      'width: 44px !important',
      'height: 44px !important',
      'border: none !important',
      'background: transparent !important',
      `z-index: ${Z_INDEX_HUD_HOST} !important`,
      'pointer-events: auto !important',
      'display: block !important',
      'margin: 0 !important',
      'padding: 0 !important',
      'overflow: visible !important',
    ].join(';');
    hudOverlay.setAttribute('allowtransparency', 'true');

    hudOverlay.addEventListener('load', () => {
      hudStylesDirty = true;
      syncStylesToHud(hudOverlay!);
      const newRoot = getHudMountRoot(hudOverlay!);
      if (newRoot && options?.onMountRootReady) {
        options.onMountRootReady(newRoot);
      }
    });

    hostDoc.body.appendChild(hudOverlay);

    hudStylesDirty = true;
    syncStylesToHud(hudOverlay);
    observeMainStylesForHud(hudOverlay);
  } else {
    applyMobileSurface(hudOverlay, TT_SURFACE.FreeWindow);
    if (hudStylesDirty) {
      syncStylesToHud(hudOverlay);
    }
  }

  return getHudMountRoot(hudOverlay);
}

/**
 * 获取 HUD 挂载根节点（供 Vue Teleport 穿透挂载）
 */
export function getHudMountRoot(hudOverlay?: HTMLIFrameElement | null): HTMLElement | null {
  if (!hudOverlay) {
    const hostDoc = getHostDocument();
    hudOverlay = hostDoc?.getElementById(HUD_HOST_ID) as HTMLIFrameElement | null;
  }
  if (!hudOverlay) return null;
  if (hudOverlay.contentDocument) {
    return hudOverlay.contentDocument.getElementById('ra-hud-mount-root') ?? hudOverlay.contentDocument.body;
  }
  return hudOverlay.querySelector('#ra-hud-mount-root') ?? hudOverlay;
}

/**
 * 卸载清理 HUD 伴生宿主层
 */
export function destroyHudHost() {
  if (hudStyleObserver) {
    hudStyleObserver.disconnect();
    hudStyleObserver = null;
  }
  hudStylesDirty = true;
  const hostDoc = getHostDocument();
  const hud = hostDoc?.getElementById(HUD_HOST_ID);
  hud?.remove();
}
