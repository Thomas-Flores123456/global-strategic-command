/**
 * shell.ts —— 悬浮窗壳（RAC-ENTRY-01，任务包 §3.2）
 *
 * Helper 把角色脚本 iframe Teleport 到 body 并 `v-show="false"`（内联 display:none）。
 * 本模块在脚本内通过 `window.frameElement` 拿到自身 iframe，把它改成 `display:block; position:fixed` 悬浮，
 * 并负责：拖拽（pointer 事件，用 screenX/screenY 增量以免 iframe 移动影响坐标系）、收起/展开、
 * 位置与收起态 localStorage 持久化（键名前缀 `tavernweave.floating.`）、初始位置靠右居中不遮挡酒馆核心 UI、
 * 窄屏贴边适配。UI（拖拽手柄 / 收起按钮）由 FloatingApp.vue 渲染，本模块只做几何与样式。
 *
 * 所有宿主对象（frame / storage / 视口）以 deps 注入，纯几何函数可独立单测。
 */
import { reactive, readonly } from 'vue';
import {
  applyMobileSurface,
  getTauriTavernBridge,
  TT_SURFACE,
  type LayoutInsets,
} from './ttHostBridge';
import { createDualHostStorage } from './ttStorageAdapter';

export const SHELL_STORAGE_KEY = 'tavernweave.floating.shell.v1';
export const NARROW_BREAKPOINT = 640;
export const EDGE_MARGIN = 8;
export const EXPANDED_SIZE = { width: 400, height: 640 } as const;
/**
 * 标题栏最小可用宽度（D-RAC-FLOAT-MOBILE-01）：图标 + 标题 + 两个 30px 按钮在此宽度下仍可见可点。
 * 复用的 `红警指挥系统/global.css` 给 `body` 设了 `min-width: 280px`，已在 FloatingApp.vue 以
 * `html body { min-width: 0 }` 覆盖，因此 iframe 可以窄于 280 而不裁切「展开」按钮（F-QA-02 的根因已解除）。
 * 窄屏（<640）展开 / 收起态同宽 = clamp(CONTENT_MIN_WIDTH, round(视口宽/2), 视口宽 - 边距×2)。
 */
export const CONTENT_MIN_WIDTH = 200;
export const COLLAPSED_SIZE = { width: 288, height: 40 } as const;

export interface Viewport {
  width: number;
  height: number;
  safeInsets?: LayoutInsets;
  keyboardOffset?: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Position {
  x: number;
  y: number;
}
export type DockMode = 'right' | 'left' | 'free';

export interface ShellState extends Position {
  collapsed: boolean;
  dock?: DockMode;
  modalOverlay?: boolean;
}

/** 最小 iframe 抽象：真机为 HTMLIFrameElement，测试用 `{ style }` 假对象 */
export interface FrameLike {
  style: {
    setProperty(name: string, value: string, priority?: string): void;
    removeProperty(name: string): string;
  };
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ShellDeps {
  /** 自身 iframe；null = 不在 iframe 内（壳退化为纯状态机） */
  frame: FrameLike | null;
  storage: StorageLike | null;
  viewport: () => Viewport;
  /** 宿主视口尺寸变化订阅；返回注销函数 */
  onResize?: (cb: () => void) => () => void;
}

export interface Shell {
  state: Readonly<ShellState>;
  size: () => Size;
  toggle(): void;
  setCollapsed(collapsed: boolean): void;
  setModalOverlay(active: boolean): void;
  dockToLeft(): void;
  dockToRight(): void;
  dockFree(): void;
  dragStart(screenX: number, screenY: number): void;
  dragMove(screenX: number, screenY: number): void;
  dragEnd(): void;
  /** 视口变化后重新钳位并应用 */
  relayout(): void;
  destroy(): void;
}

// ───────────────────────── 纯几何 ─────────────────────────

export function isNarrow(viewport: Viewport): boolean {
  return viewport.width < NARROW_BREAKPOINT;
}

/** 窄屏宽度：视口一半，下限 CONTENT_MIN_WIDTH，上限仍保持“不超出视口留边”（极窄视口时上限优先） */
export function narrowWidth(viewport: Viewport): number {
  return Math.min(Math.max(CONTENT_MIN_WIDTH, Math.round(viewport.width / 2)), viewport.width - EDGE_MARGIN * 2);
}

/**
 * 当前形态下 iframe 尺寸：
 * - 窄屏（<640）：展开 / 收起同宽 = narrowWidth（避免切换时横向跳动）；展开高度 ≤ 70% 视口，收起高 40；
 * - 桌面：展开 400×640、收起 288×40，按视口留边钳位。
 */
export function frameSize(viewport: Viewport, collapsed: boolean): Size {
  if (isNarrow(viewport)) {
    const width = narrowWidth(viewport);
    if (collapsed) return { width, height: COLLAPSED_SIZE.height };
    return { width, height: Math.min(EXPANDED_SIZE.height, Math.floor(viewport.height * 0.7)) };
  }
  if (collapsed) {
    return { width: Math.min(COLLAPSED_SIZE.width, viewport.width - EDGE_MARGIN * 2), height: COLLAPSED_SIZE.height };
  }
  return {
    width: Math.min(EXPANDED_SIZE.width, viewport.width - EDGE_MARGIN * 2),
    height: Math.min(EXPANDED_SIZE.height, viewport.height - EDGE_MARGIN * 2),
  };
}

function resolveSafeInsets(viewport: Viewport): LayoutInsets {
  const s = viewport.safeInsets;
  if (!s) return { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    top: typeof s.top === 'number' && Number.isFinite(s.top) && s.top > 0 ? s.top : 0,
    right: typeof s.right === 'number' && Number.isFinite(s.right) && s.right > 0 ? s.right : 0,
    bottom: typeof s.bottom === 'number' && Number.isFinite(s.bottom) && s.bottom > 0 ? s.bottom : 0,
    left: typeof s.left === 'number' && Number.isFinite(s.left) && s.left > 0 ? s.left : 0,
  };
}

/** 初始位置：右侧垂直居中，避开酒馆顶栏 / 中央聊天流 / 底部输入区 */
export function defaultPosition(viewport: Viewport, size: Size): Position {
  const insets = resolveSafeInsets(viewport);
  const rightMargin = EDGE_MARGIN + insets.right;
  return clampPosition(
    { x: viewport.width - size.width - rightMargin, y: Math.round((viewport.height - size.height) / 2) },
    viewport,
    size,
  );
}

/** 钳位到视口内（留边距，若存在 safeInsets 则自动叠加）；窄屏贴右边 */
export function clampPosition(pos: Position, viewport: Viewport, size: Size): Position {
  const insets = resolveSafeInsets(viewport);
  const minX = EDGE_MARGIN + insets.left;
  const minY = EDGE_MARGIN + insets.top;
  const rightMargin = EDGE_MARGIN + insets.right;
  const bottomMargin = EDGE_MARGIN + insets.bottom;
  const maxX = Math.max(minX, viewport.width - size.width - rightMargin);
  const maxY = Math.max(minY, viewport.height - size.height - bottomMargin);
  const x = isNarrow(viewport) ? maxX : Math.min(Math.max(minX, pos.x), maxX);
  const y = Math.min(Math.max(minY, pos.y), maxY);
  return { x: Math.round(x), y: Math.round(y) };
}

// ───────────────────────── 持久化 ─────────────────────────

export function parseShellState(raw: string | null): Partial<ShellState> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    const out: Partial<ShellState> = {};
    if (typeof rec.x === 'number' && Number.isFinite(rec.x)) out.x = rec.x;
    if (typeof rec.y === 'number' && Number.isFinite(rec.y)) out.y = rec.y;
    if (typeof rec.collapsed === 'boolean') out.collapsed = rec.collapsed;
    if (rec.dock === 'right' || rec.dock === 'left' || rec.dock === 'free') out.dock = rec.dock;
    return out;
  } catch {
    return null;
  }
}

export function loadShellState(storage: StorageLike | null): Partial<ShellState> | null {
  if (!storage) return null;
  try {
    return parseShellState(storage.getItem(SHELL_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveShellState(storage: StorageLike | null, state: ShellState): void {
  if (!storage) return;
  try {
    const payload: Record<string, unknown> = { x: state.x, y: state.y, collapsed: state.collapsed };
    if (state.dock && state.dock !== 'free') payload.dock = state.dock;
    storage.setItem(SHELL_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* storage 不可用（隐私模式 / 配额）时仅本次生效 */
  }
}

// ───────────────────────── 壳 ─────────────────────────

const FRAME_BASE_STYLE: Record<string, string> = {
  position: 'fixed',
  'z-index': '9990',
  margin: '0',
  padding: '0',
  border: '0',
  background: 'transparent',
  'box-sizing': 'border-box',
  'border-radius': '6px',
  'box-shadow': '0 12px 36px rgba(0, 0, 0, 0.55)',
  overflow: 'hidden',
  'pointer-events': 'auto',
  'max-width': '100vw',
  'max-height': '100vh',
};

/** 真机默认依赖：仅在调用时触碰 window（模块加载不依赖宿主） */
export function defaultShellDeps(): ShellDeps {
  const frame = (window.frameElement as HTMLIFrameElement | null) ?? null;
  const host = frame?.ownerDocument.defaultView ?? window;
  const bridge = getTauriTavernBridge(host);
  let rawLocalStorage: StorageLike | null;
  try {
    rawLocalStorage = window.localStorage;
  } catch {
    rawLocalStorage = null;
  }
  const storage = createDualHostStorage({
    table: 'shell',
    localStorage: rawLocalStorage,
    hostWindow: host,
  });
  void storage.hydrateFromExtensionStore([SHELL_STORAGE_KEY]);

  return {
    frame,
    storage,
    viewport: () => {
      const layoutApi = bridge.layout;
      if (layoutApi) {
        try {
          const snap = layoutApi.snapshot();
          const vpWidth =
            snap?.viewport && Number.isFinite(snap.viewport.width) && snap.viewport.width > 0
              ? snap.viewport.width
              : host.innerWidth;
          const vpHeight =
            snap?.viewport && Number.isFinite(snap.viewport.height) && snap.viewport.height > 0
              ? snap.viewport.height
              : host.innerHeight;
          return {
            width: vpWidth,
            height: vpHeight,
            safeInsets: snap?.safeInsets
              ? {
                  top: snap.safeInsets.top ?? 0,
                  right: snap.safeInsets.right ?? 0,
                  bottom: snap.safeInsets.bottom ?? 0,
                  left: snap.safeInsets.left ?? 0,
                }
              : undefined,
            keyboardOffset: snap?.ime?.keyboardOffset ?? 0,
          };
        } catch {
          /* 回退至宿主窗口 innerWidth/innerHeight */
        }
      }
      return { width: host.innerWidth, height: host.innerHeight };
    },
    onResize: cb => {
      if (typeof host.addEventListener === 'function') {
        host.addEventListener('resize', cb);
      }
      let disposed = false;
      let layoutUnsub: (() => void | Promise<void>) | null = null;
      const layoutApi = bridge.layout;
      if (layoutApi && typeof layoutApi.subscribe === 'function') {
        try {
          const subRes = layoutApi.subscribe(() => {
            if (!disposed) cb();
          });
          if (typeof subRes === 'function') {
            layoutUnsub = subRes;
          } else if (subRes && typeof (subRes as Promise<unknown>).then === 'function') {
            void (subRes as Promise<() => void | Promise<void>>)
              .then(unsub => {
                if (typeof unsub === 'function') {
                  if (disposed) {
                    void unsub();
                  } else {
                    layoutUnsub = unsub;
                  }
                }
              })
              .catch(() => {});
          }
        } catch {
          /* 忽略 layout.subscribe 异常 */
        }
      }
      return () => {
        disposed = true;
        if (typeof host.removeEventListener === 'function') {
          host.removeEventListener('resize', cb);
        }
        if (layoutUnsub) {
          try {
            void layoutUnsub();
          } catch {
            /* 忽略 unsubscribe 异常 */
          }
          layoutUnsub = null;
        }
      };
    },
  };
}

export function createShell(deps: ShellDeps): Shell {
  if (deps.frame && ('dataset' in deps.frame || 'setAttribute' in deps.frame)) {
    applyMobileSurface(deps.frame as unknown as Element, TT_SURFACE.FreeWindow);
  }
  const viewport0 = deps.viewport();
  const saved = loadShellState(deps.storage);
  const collapsed0 = saved?.collapsed ?? false;
  const dock0 = saved?.dock ?? 'free';
  const size0 = frameSize(viewport0, collapsed0);
  const pos0 =
    saved?.x !== undefined && saved?.y !== undefined
      ? clampPosition({ x: saved.x, y: saved.y }, viewport0, size0)
      : defaultPosition(viewport0, size0);

  const state = reactive<ShellState>({
    x: pos0.x,
    y: pos0.y,
    collapsed: collapsed0,
    dock: dock0,
    modalOverlay: false,
  });
  let drag: { screenX: number; screenY: number; originX: number; originY: number } | null = null;

  function size(): Size {
    return frameSize(deps.viewport(), state.collapsed);
  }

  function apply() {
    const frame = deps.frame;
    if (!frame) return;
    if ('dataset' in frame || 'setAttribute' in frame) {
      applyMobileSurface(frame as unknown as Element, TT_SURFACE.FreeWindow);
    }
    const vp = deps.viewport();
    const insets = resolveSafeInsets(vp);
    const topMargin = EDGE_MARGIN + insets.top;
    const rightMargin = EDGE_MARGIN + insets.right;
    const bottomMargin = EDGE_MARGIN + insets.bottom;
    const leftMargin = EDGE_MARGIN + insets.left;

    if ('setAttribute' in frame && state.modalOverlay) {
      (frame as HTMLElement).setAttribute('data-modal-overlay', 'true');
    } else if ('removeAttribute' in frame) {
      (frame as HTMLElement).removeAttribute('data-modal-overlay');
    }

    if (state.dock === 'right') {
      const width = state.collapsed ? 36 : 340;
      frame.style.setProperty('display', 'block', 'important');
      frame.style.setProperty('position', 'fixed');
      frame.style.setProperty('right', `${rightMargin}px`);
      frame.style.setProperty('top', `${topMargin}px`);
      frame.style.setProperty('left', 'auto');
      frame.style.setProperty('width', `${width}px`);
      frame.style.setProperty('height', `${Math.max(200, vp.height - topMargin - bottomMargin)}px`);
      frame.style.setProperty('box-shadow', 'none');
      frame.style.setProperty('border', '1px solid rgba(71, 85, 105, 0.35)');
      frame.style.setProperty('border-radius', '4px');
      frame.style.setProperty('z-index', '9990');
      frame.style.setProperty('overflow', 'hidden');
      if ('setAttribute' in frame) {
        (frame as HTMLElement).setAttribute('data-dock', 'right');
        (frame as HTMLElement).setAttribute('data-collapsed', String(state.collapsed));
      }
      return;
    }

    if (state.dock === 'left') {
      const width = state.collapsed ? 36 : 340;
      frame.style.setProperty('display', 'block', 'important');
      frame.style.setProperty('position', 'fixed');
      frame.style.setProperty('left', `${leftMargin}px`);
      frame.style.setProperty('top', `${topMargin}px`);
      frame.style.setProperty('right', 'auto');
      frame.style.setProperty('width', `${width}px`);
      frame.style.setProperty('height', `${Math.max(200, vp.height - topMargin - bottomMargin)}px`);
      frame.style.setProperty('box-shadow', 'none');
      frame.style.setProperty('border', '1px solid rgba(71, 85, 105, 0.35)');
      frame.style.setProperty('border-radius', '4px');
      frame.style.setProperty('z-index', '9990');
      frame.style.setProperty('overflow', 'hidden');
      if ('setAttribute' in frame) {
        (frame as HTMLElement).setAttribute('data-dock', 'left');
        (frame as HTMLElement).setAttribute('data-collapsed', String(state.collapsed));
      }
      return;
    }

    const s = size();
    for (const [name, value] of Object.entries(FRAME_BASE_STYLE)) frame.style.setProperty(name, value);
    // Helper v-show="false" 写的是内联 display:none，必须以 !important 覆盖同一内联属性
    frame.style.setProperty('display', 'block', 'important');
    frame.style.setProperty('left', `${state.x}px`);
    frame.style.setProperty('right', 'auto');
    frame.style.setProperty('top', `${state.y}px`);
    frame.style.setProperty('width', `${s.width}px`);
    frame.style.setProperty('height', `${s.height}px`);
    if ('setAttribute' in frame) {
      (frame as HTMLElement).setAttribute('data-dock', 'free');
      (frame as HTMLElement).setAttribute('data-collapsed', String(state.collapsed));
    }
  }

  function persist() {
    saveShellState(deps.storage, { x: state.x, y: state.y, collapsed: state.collapsed, dock: state.dock });
  }

  function relayout() {
    if (state.dock === 'right' || state.dock === 'left') {
      apply();
      return;
    }
    const clamped = clampPosition(state, deps.viewport(), size());
    state.x = clamped.x;
    state.y = clamped.y;
    apply();
  }

  function setCollapsed(collapsed: boolean) {
    if (state.collapsed === collapsed) return;
    state.collapsed = collapsed;
    if (state.dock === 'right' || state.dock === 'left') {
      apply();
    } else {
      relayout();
    }
    persist();
  }

  function setModalOverlay(active: boolean) {
    if (state.modalOverlay === active) return;
    state.modalOverlay = active;
    apply();
  }

  function dockToRight() {
    state.dock = 'right';
    apply();
    persist();
  }

  function dockToLeft() {
    state.dock = 'left';
    apply();
    persist();
  }

  function dockFree() {
    state.dock = 'free';
    relayout();
    persist();
  }

  function dragStart(screenX: number, screenY: number) {
    if (state.dock && state.dock !== 'free') {
      state.dock = 'free';
    }
    drag = { screenX, screenY, originX: state.x, originY: state.y };
  }

  function dragMove(screenX: number, screenY: number) {
    if (!drag) return;
    const next = clampPosition(
      { x: drag.originX + (screenX - drag.screenX), y: drag.originY + (screenY - drag.screenY) },
      deps.viewport(),
      size(),
    );
    state.x = next.x;
    state.y = next.y;
    apply();
  }

  function dragEnd() {
    if (!drag) return;
    drag = null;
    persist();
  }

  const offResize = deps.onResize?.(relayout);
  apply();

  return {
    state: readonly(state),
    size,
    toggle: () => setCollapsed(!state.collapsed),
    setCollapsed,
    setModalOverlay,
    dockToLeft,
    dockToRight,
    dockFree,
    dragStart,
    dragMove,
    dragEnd,
    relayout,
    destroy: () => {
      drag = null;
      offResize?.();
    },
  };
}
