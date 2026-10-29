/**
 * pdaState.ts —— 战地手持板（PDA）与通知胶囊独立状态机与存储契约
 *
 * 实施任务包：PDA-SHELL-01（《战地手持板与通知胶囊MVP任务包》§3.1, §6）
 * 设计真源：《战地手持板PDA与通知胶囊前端设计案.md》（§2.1, §4.3）
 * 参考实现：`mvu指挥系统/src/中控悬浮窗/shell.ts`
 *
 * 核心职责：
 * 1. 定义 PdaState 接口与尺寸、边距、磁吸阈值、存储键名等基础常量；
 * 2. 提供纯函数几何与磁吸工具（尺寸获取、视口四周 12px 留边钳位、<60px 贴边吸附）；
 * 3. 提供 localStorage 幂等与容错存取函数（脏数据隔离、解析失败安全降级）；
 * 4. 提供 createPdaShell 响应式状态管理工厂，支持折叠、标签、拖拽、事件已读、直达高亮聚焦。
 */

import { reactive, readonly, type DeepReadonly } from 'vue';
import { getTauriTavernBridge } from '../host/ttHostBridge';
import { createDualHostStorage } from '../host/ttStorageAdapter';

// ───────────────────────── 基础常量 ─────────────────────────

export const PDA_EXPANDED_SIZE = { width: 320, height: 440 } as const;
export const PDA_COLLAPSED_SIZE = { width: 44, height: 44 } as const;
export const PDA_VIEWPORT_RATIO = { widthRatio: 0.4, heightRatio: 0.6 } as const;
export const PDA_LARGE_VIEWPORT_RATIO = { widthRatio: 0.52, heightRatio: 0.74 } as const;
export const PDA_EDGE_MARGIN = 12;
export const PDA_SNAP_THRESHOLD = 60;
export const PDA_STORAGE_KEY = 'tavernweave.pda.state';

// ───────────────────────── 类型契约 ─────────────────────────

export type PdaDockSide = 'left' | 'right' | 'free';
export type PdaTabId = 'events' | 'chains' | 'cash' | 'intel' | 'quests';
export type PdaSizeMode = 'proportional' | 'large' | 'compact';

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
  safeInsets?: { top: number; right: number; bottom: number; left: number };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PdaState {
  x: number;
  y: number;
  collapsed: boolean; // 默认 true (收纳纽扣态)
  mode?: 'collapsed' | 'expanded'; // 与 collapsed 同步的显示模式契约
  sizeMode?: PdaSizeMode; // 尺寸模式：默认 'proportional' (40%宽 × 60%高动态比例)
  pinned: boolean; // 默认 false (锁定禁止拖拽)
  dockSide: PdaDockSide; // 屏幕贴边倾向: 'left' | 'right' | 'free'
  activeTab: PdaTabId; // 默认 'events'
  hidden: boolean; // 默认 false (被中控顶栏彻底收回)
  readEventIds: string[]; // 已读事件 ID 集合
  highlightEventId: string | null; // 直达高亮聚焦事件 ID
}

export interface PdaShellDeps {
  storage?: StorageLike | null;
  viewport: () => Viewport;
  onResize?: (cb: () => void) => () => void;
  scopeId?: string | null;
  defaultSizeMode?: PdaSizeMode;
}

export interface PdaShell {
  state: DeepReadonly<PdaState>;
  size: () => Size;
  dynamicSize?: () => Size;
  cycleSizeMode?: () => PdaSizeMode;
  setSizeMode?: (mode: PdaSizeMode) => void;
  toggleCollapse(): void;
  setCollapsed(collapsed: boolean): void;
  setPinned(pinned: boolean): void;
  togglePin(): void;
  setActiveTab(tab: PdaTabId): void;
  setHidden(hidden: boolean): void;
  markEventRead(eventId: string): void;
  markAllEventsRead(eventIds: string[]): void;
  focusEvent(eventId: string, tab?: PdaTabId): void;
  clearHighlight(): void;
  dragStart(screenX: number, screenY: number): void;
  dragMove(screenX: number, screenY: number): void;
  dragEnd(): void;
  setPosition(pos: Position): void;
  snapToEdge(side?: 'left' | 'right'): void;
  relayout(): void;
  resetPosition(): void;
  recallPdaToCenter(): Position;
  setPdaSessionScope(scopeId: string | null): void;
  getSessionScope(): string | null;
  destroy(): void;
}

// ───────────────────────── 纯函数几何 ─────────────────────────

/**
 * 根据折叠状态获取当前物理尺寸
 */
export function pdaFrameSize(collapsed: boolean): Size {
  return collapsed ? { ...PDA_COLLAPSED_SIZE } : { ...PDA_EXPANDED_SIZE };
}

/**
 * 根据当前浏览器窗口（Viewport）与尺寸档位动态计算 PDA 展开态宽高：
 * - 'proportional'（默认）：宽度占窗口 40%、高度占窗口 60%（带最小可读尺寸与窄屏留边防溢出钳位）
 * - 'large'（宽屏平板档）：宽度占窗口 52%、高度占窗口 74%
 * - 'compact'（紧凑掌机档）：固定 380 × 520（窄屏自动留边）
 */
export function resolveDynamicPdaSize(
  viewport: Viewport,
  collapsed = false,
  sizeMode: PdaSizeMode = 'proportional',
): Size {
  if (collapsed) return { ...PDA_COLLAPSED_SIZE };
  const insets = resolvePdaSafeInsets(viewport);
  const availW = Math.max(280, viewport.width - insets.left - insets.right - PDA_EDGE_MARGIN * 2);
  const availH = Math.max(320, viewport.height - insets.top - insets.bottom - PDA_EDGE_MARGIN * 2);

  if (sizeMode === 'compact') {
    return {
      width: Math.min(availW, 380),
      height: Math.min(availH, 520),
    };
  }

  const ratio = sizeMode === 'large' ? PDA_LARGE_VIEWPORT_RATIO : PDA_VIEWPORT_RATIO;
  const minW = sizeMode === 'large' ? 460 : 380;
  const minH = sizeMode === 'large' ? 560 : 480;
  const rawW = Math.round(viewport.width * ratio.widthRatio);
  const rawH = Math.round(viewport.height * ratio.heightRatio);

  return {
    width: Math.min(availW, Math.max(minW, rawW)),
    height: Math.min(availH, Math.max(minH, rawH)),
  };
}

function resolvePdaSafeInsets(viewport: Viewport): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const s = viewport.safeInsets;
  if (!s) return { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    top: typeof s.top === 'number' && Number.isFinite(s.top) && s.top > 0 ? s.top : 0,
    right: typeof s.right === 'number' && Number.isFinite(s.right) && s.right > 0 ? s.right : 0,
    bottom: typeof s.bottom === 'number' && Number.isFinite(s.bottom) && s.bottom > 0 ? s.bottom : 0,
    left: typeof s.left === 'number' && Number.isFinite(s.left) && s.left > 0 ? s.left : 0,
  };
}

/**
 * 默认初始坐标：右侧居中，四周保留 12px 间隙（若存在 safeInsets 则叠加安全区留边）
 */
export function defaultPdaPosition(
  viewport: Viewport,
  collapsed = true,
  customSize?: Size,
): Position {
  const size = customSize ?? pdaFrameSize(collapsed);
  const insets = resolvePdaSafeInsets(viewport);
  const rightMargin = PDA_EDGE_MARGIN + insets.right;
  const x = viewport.width - size.width - rightMargin;
  const y = Math.round((viewport.height - size.height) / 2);
  return clampPdaPosition({ x, y }, viewport, collapsed, size);
}

/**
 * 安全视口中心坐标：展开态居中并保留 12px 边界钳位
 */
export function centerPdaPosition(
  viewport: Viewport,
  collapsed = false,
  customSize?: Size,
): Position {
  const size = customSize ?? pdaFrameSize(collapsed);
  const x = Math.round((viewport.width - size.width) / 2);
  const y = Math.round((viewport.height - size.height) / 2);
  return clampPdaPosition({ x, y }, viewport, collapsed, size);
}

/**
 * 视口边界防御钳位（四周保留 PDA_EDGE_MARGIN 12px 间隙，若存在 safeInsets 则自动叠加）
 */
export function clampPdaPosition(
  pos: Position,
  viewport: Viewport,
  collapsed: boolean,
  customSize?: Size,
): Position {
  const size = customSize ?? pdaFrameSize(collapsed);
  const insets = resolvePdaSafeInsets(viewport);
  const minX = PDA_EDGE_MARGIN + insets.left;
  const minY = PDA_EDGE_MARGIN + insets.top;
  const rightMargin = PDA_EDGE_MARGIN + insets.right;
  const bottomMargin = PDA_EDGE_MARGIN + insets.bottom;
  const safeX = Number.isFinite(pos.x) ? pos.x : minX;
  const safeY = Number.isFinite(pos.y) ? pos.y : minY;

  const maxX = Math.max(minX, viewport.width - size.width - rightMargin);
  const maxY = Math.max(minY, viewport.height - size.height - bottomMargin);

  const x = Math.min(Math.max(minX, safeX), maxX);
  const y = Math.min(Math.max(minY, safeY), maxY);

  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * 智能边缘磁吸算法：
 * 距离视口左/右边缘 < 60px 时吸附贴边；否则保持自由浮动。
 */
export function calculateSnap(
  pos: Position,
  viewport: Viewport,
  collapsed: boolean,
  customSize?: Size,
): { x: number; y: number; dockSide: PdaDockSide } {
  const size = customSize ?? pdaFrameSize(collapsed);
  const insets = resolvePdaSafeInsets(viewport);
  const minX = PDA_EDGE_MARGIN + insets.left;
  const rightMargin = PDA_EDGE_MARGIN + insets.right;
  const clamped = clampPdaPosition(pos, viewport, collapsed, size);

  // 到视口左安全边缘的距离
  const distanceLeft = Math.max(0, clamped.x - insets.left);
  // 到视口右安全边缘的距离
  const distanceRight = Math.max(0, viewport.width - insets.right - (clamped.x + size.width));

  const maxX = Math.max(minX, viewport.width - size.width - rightMargin);

  let snapX = clamped.x;
  let dockSide: PdaDockSide = 'free';

  const nearLeft = distanceLeft < PDA_SNAP_THRESHOLD;
  const nearRight = distanceRight < PDA_SNAP_THRESHOLD;

  if (nearLeft && nearRight) {
    if (distanceLeft <= distanceRight) {
      snapX = minX;
      dockSide = 'left';
    } else {
      snapX = maxX;
      dockSide = 'right';
    }
  } else if (nearLeft) {
    snapX = minX;
    dockSide = 'left';
  } else if (nearRight) {
    snapX = maxX;
    dockSide = 'right';
  }

  return {
    x: Math.round(snapX),
    y: clamped.y,
    dockSide,
  };
}

// ───────────────────────── 持久化工具与会话分桶隔离 ─────────────────────────

/**
 * 根据会话 scopeId 生成隔离的 LocalStorage 键名（修复 09 [P3-1] 跨角色卡/跨聊天串桶）
 */
export function getScopedPdaStorageKey(scopeId?: string | null): string {
  const trimmed = typeof scopeId === 'string' ? scopeId.trim() : '';
  return trimmed.length > 0 ? `${PDA_STORAGE_KEY}.${trimmed}` : PDA_STORAGE_KEY;
}

let activeSessionScope: string | null = null;
const activeShells = new Set<PdaShell>();
const shellInternals = new WeakMap<
  PdaShell,
  { storage?: StorageLike | null; setReadIds: (ids: string[]) => void }
>();

/**
 * 从事件 ID 中提取楼层号（支持 `floor:12:...`、`_f12_`、`f_12:...` 等格式）
 */
export function extractFloorFromPdaEventId(eventId: string): number | null {
  if (typeof eventId !== 'string' || !eventId) return null;
  const m1 = eventId.match(/(?:^|[:_-])floor[:_-](\d+)(?:$|[:_-])/i);
  if (m1) return Number.parseInt(m1[1], 10);
  const m2 = eventId.match(/(?:^|[_:-])f_?(\d+)(?:$|[_:-])/i);
  if (m2) return Number.parseInt(m2[1], 10);
  return null;
}

function filterReadIdsByMaxFloor(ids: readonly string[], maxFloor: number): string[] {
  return ids.filter(id => {
    const fl = extractFloorFromPdaEventId(id);
    return fl === null || fl <= maxFloor;
  });
}

function collectCandidateStorages(explicitStorage?: StorageLike | null): StorageLike[] {
  const set = new Set<StorageLike>();
  if (explicitStorage) {
    set.add(explicitStorage);
  } else {
    const def = defaultPdaDeps().storage;
    if (def) set.add(def);
    for (const sh of activeShells) {
      const st = shellInternals.get(sh)?.storage;
      if (st) set.add(st);
    }
  }
  return [...set];
}

/**
 * 裁剪高于 maxFloor 的已读事件 ID（移除 `floor:${N}:...` 或 `_f${N}_` 且 `N > maxFloor` 的记录）
 */
export function prunePdaStateAboveFloor(
  maxFloor: number,
  scopeId?: string,
  storage?: StorageLike | null,
): void {
  const normalizedScope =
    scopeId !== undefined
      ? typeof scopeId === 'string' && scopeId.trim().length > 0
        ? scopeId.trim()
        : null
      : activeSessionScope;
  const key = getScopedPdaStorageKey(normalizedScope);

  for (const st of collectCandidateStorages(storage)) {
    try {
      const raw = st.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.readEventIds)) {
        const currentIds = parsed.readEventIds.filter((id): id is string => typeof id === 'string');
        parsed.readEventIds = filterReadIdsByMaxFloor(currentIds, maxFloor);
        st.setItem(key, JSON.stringify(parsed));
      }
    } catch {
      /* ignore storage parse error */
    }
  }

  for (const sh of activeShells) {
    const shScope = sh.getSessionScope();
    if (scopeId === undefined || shScope === normalizedScope) {
      const internal = shellInternals.get(sh);
      if (internal) {
        internal.setReadIds(filterReadIdsByMaxFloor(sh.state.readEventIds, maxFloor));
      }
    }
  }
}

export const prunePdaByFloorWatermark = prunePdaStateAboveFloor;

/**
 * 为新分支克隆源会话分桶的 PDA 状态，并按分叉楼层 maxFloor 裁剪高层 readEventIds
 */
export function clonePdaStateForBranch(
  fromScopeId: string,
  toScopeId: string,
  maxFloor: number,
  storage?: StorageLike | null,
): void {
  const fromNorm = typeof fromScopeId === 'string' ? fromScopeId.trim() : '';
  const toNorm = typeof toScopeId === 'string' ? toScopeId.trim() : '';
  if (!fromNorm || !toNorm || fromNorm === toNorm) return;

  const fromKey = getScopedPdaStorageKey(fromNorm);
  const toKey = getScopedPdaStorageKey(toNorm);

  for (const st of collectCandidateStorages(storage)) {
    try {
      const raw = st.getItem(fromKey);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const currentIds = Array.isArray(parsed.readEventIds)
        ? parsed.readEventIds.filter((id): id is string => typeof id === 'string')
        : [];
      const clonedPayload = {
        ...parsed,
        readEventIds: filterReadIdsByMaxFloor(currentIds, maxFloor),
      };
      st.setItem(toKey, JSON.stringify(clonedPayload));
    } catch {
      /* ignore storage error */
    }
  }

  for (const sh of activeShells) {
    if (sh.getSessionScope() === toNorm) {
      sh.setPdaSessionScope(toNorm);
    }
  }
}

export const clonePdaScopeForBranch = clonePdaStateForBranch;

/**
 * 获取当前全局会话分桶标识
 */
export function getPdaSessionScope(): string | null {
  return activeSessionScope;
}

/**
 * 切换当前会话分桶并重新加载对应桶的 readEventIds
 */
export function setPdaSessionScope(scopeId: string | null, targetShell?: PdaShell): void {
  const normalized = typeof scopeId === 'string' && scopeId.trim().length > 0 ? scopeId.trim() : null;
  activeSessionScope = normalized;
  if (targetShell) {
    targetShell.setPdaSessionScope(normalized);
    return;
  }
  for (const shell of activeShells) {
    shell.setPdaSessionScope(normalized);
  }
}

/**
 * 顶栏一键召回 PDA 到视口安全中心并展开
 */
export function recallPdaToCenter(targetShell?: PdaShell): Position | null {
  if (targetShell) {
    return targetShell.recallPdaToCenter();
  }
  let lastPos: Position | null = null;
  for (const shell of activeShells) {
    lastPos = shell.recallPdaToCenter();
  }
  return lastPos;
}

/**
 * 校验并提取合法的 Partial<PdaState>，屏蔽脏字段与异常类型
 */
export function parsePdaState(raw: string | null): Partial<PdaState> | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

    const rec = parsed as Record<string, unknown>;
    const out: Partial<PdaState> = {};

    if (typeof rec.x === 'number' && Number.isFinite(rec.x)) out.x = rec.x;
    if (typeof rec.y === 'number' && Number.isFinite(rec.y)) out.y = rec.y;
    if (typeof rec.collapsed === 'boolean') out.collapsed = rec.collapsed;
    if (typeof rec.pinned === 'boolean') out.pinned = rec.pinned;

    if (rec.dockSide === 'left' || rec.dockSide === 'right' || rec.dockSide === 'free') {
      out.dockSide = rec.dockSide;
    }

    if (
      rec.activeTab === 'events' ||
      rec.activeTab === 'chains' ||
      rec.activeTab === 'cash' ||
      rec.activeTab === 'intel' ||
      rec.activeTab === 'quests'
    ) {
      out.activeTab = rec.activeTab;
    }

    if (typeof rec.hidden === 'boolean') out.hidden = rec.hidden;
    if (rec.sizeMode === 'proportional' || rec.sizeMode === 'large' || rec.sizeMode === 'compact') {
      out.sizeMode = rec.sizeMode;
    }

    if (Array.isArray(rec.readEventIds)) {
      out.readEventIds = rec.readEventIds.filter(id => typeof id === 'string');
    }

    return out;
  } catch {
    return null;
  }
}

/**
 * 从存储中安全加载持久化状态（支持按 scopeId 分桶读取）
 */
export function loadPdaState(
  storage: StorageLike | null | undefined,
  scopeId?: string | null,
): Partial<PdaState> | null {
  if (!storage) return null;
  try {
    const key = getScopedPdaStorageKey(scopeId);
    return parsePdaState(storage.getItem(key));
  } catch {
    return null;
  }
}

/**
 * 安全保存持久化状态到存储（拦截异常，屏蔽瞬态高亮，支持按 scopeId 分桶写入）
 */
export function savePdaState(
  storage: StorageLike | null | undefined,
  state: PdaState,
  scopeId?: string | null,
): void {
  if (!storage) return;
  try {
    const payload: Omit<PdaState, 'highlightEventId' | 'mode'> = {
      x: state.x,
      y: state.y,
      collapsed: state.collapsed,
       ...(state.sizeMode ? { sizeMode: state.sizeMode } : {}),
      pinned: state.pinned,
      dockSide: state.dockSide,
      activeTab: state.activeTab,
      hidden: state.hidden,
      readEventIds: state.readEventIds,
    };
    const key = getScopedPdaStorageKey(scopeId);
    storage.setItem(key, JSON.stringify(payload));
  } catch {
    // 降级保护：在隐身模式或配额耗尽时不抛出未捕获异常
  }
}

// ───────────────────────── 响应式管理工厂 ─────────────────────────

/**
 * 穿透获取宿主顶级/真实大屏幕视口所在的 Window 对象
 * 避免在停靠中控台自身 iframe (宽 340px) 内部测量视口时发生尺寸塌陷
 */
export function getHostWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  try {
    if (window.frameElement && window.frameElement.ownerDocument) {
      const topWin = window.frameElement.ownerDocument.defaultView;
      if (topWin) return topWin;
    }
  } catch {
    // 跨域沙箱降级
  }
  return window;
}

/**
 * 创建默认宿主依赖注入对象
 */
export function defaultPdaDeps(): PdaShellDeps {
  const hostWin = getHostWindow();
  const bridge = getTauriTavernBridge(hostWin ?? undefined);
  const hasWindow = typeof window !== 'undefined';
  let rawStorage: StorageLike | null = null;
  if (hasWindow) {
    try {
      rawStorage = (hostWin && hostWin.localStorage) || window.localStorage;
    } catch {
      rawStorage = null;
    }
  }
  const storage: StorageLike | null =
    hasWindow || bridge.extensionStore
      ? createDualHostStorage({
          table: 'pda',
          localStorage: rawStorage,
          hostWindow: hostWin ?? undefined,
        })
      : null;

  const getViewport = (): Viewport => {
    const win = getHostWindow();
    const layoutApi = bridge.layout;
    let safeInsets: Viewport['safeInsets'];
    let layoutWidth = 0;
    let layoutHeight = 0;
    if (layoutApi) {
      try {
        const snap = layoutApi.snapshot();
        if (snap?.viewport && Number.isFinite(snap.viewport.width) && snap.viewport.width > 0) {
          layoutWidth = snap.viewport.width;
        }
        if (snap?.viewport && Number.isFinite(snap.viewport.height) && snap.viewport.height > 0) {
          layoutHeight = snap.viewport.height;
        }
        if (snap?.safeInsets) {
          safeInsets = {
            top: snap.safeInsets.top ?? 0,
            right: snap.safeInsets.right ?? 0,
            bottom: snap.safeInsets.bottom ?? 0,
            left: snap.safeInsets.left ?? 0,
          };
        }
      } catch {
        /* 忽略 layout.snapshot 异常 */
      }
    }

    if (layoutWidth > 0 && layoutHeight > 0) {
      return safeInsets
        ? { width: layoutWidth, height: layoutHeight, safeInsets }
        : { width: layoutWidth, height: layoutHeight };
    }

    if (
      win &&
      typeof win.innerWidth === 'number' &&
      Number.isFinite(win.innerWidth) &&
      typeof win.innerHeight === 'number' &&
      Number.isFinite(win.innerHeight) &&
      win.innerWidth > 0 &&
      win.innerHeight > 0
    ) {
      return safeInsets
        ? { width: win.innerWidth, height: win.innerHeight, safeInsets }
        : { width: win.innerWidth, height: win.innerHeight };
    }
    return safeInsets ? { width: 1280, height: 720, safeInsets } : { width: 1280, height: 720 };
  };

  return {
    storage,
    viewport: getViewport,
    onResize: cb => {
      const win = getHostWindow();
      let disposed = false;
      let layoutUnsub: (() => void | Promise<void>) | null = null;
      if (win && typeof win.addEventListener === 'function') {
        win.addEventListener('resize', cb);
      }
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
        if (win && typeof win.removeEventListener === 'function') {
          win.removeEventListener('resize', cb);
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

/**
 * 创建 PDA 响应式状态机外壳
 */
export function createPdaShell(deps: PdaShellDeps): PdaShell {
  let currentScopeId: string | null =
    deps.scopeId !== undefined
      ? typeof deps.scopeId === 'string' && deps.scopeId.trim().length > 0
        ? deps.scopeId.trim()
        : null
      : activeSessionScope;

  const vp = deps.viewport();
  const saved = loadPdaState(deps.storage, currentScopeId);

  const initialCollapsed = saved?.collapsed ?? true;
  const initialSizeMode = saved?.sizeMode ?? deps.defaultSizeMode;
  const initialEffectiveSize = initialSizeMode
    ? resolveDynamicPdaSize(vp, initialCollapsed, initialSizeMode)
    : pdaFrameSize(initialCollapsed);
  const initialDefaultPos = defaultPdaPosition(vp, initialCollapsed, initialEffectiveSize);

  let initialX = saved?.x ?? initialDefaultPos.x;
  let initialY = saved?.y ?? initialDefaultPos.y;
  const initialDockSide: PdaDockSide = saved?.dockSide ?? 'right';

  // 若从存储恢复有坐标，执行边界钳位
  const clamped = clampPdaPosition({ x: initialX, y: initialY }, vp, initialCollapsed, initialEffectiveSize);
  initialX = clamped.x;
  initialY = clamped.y;

  // 若明确标记了左右贴边，自适应保持贴边
  const initInsets = resolvePdaSafeInsets(vp);
  const initMinX = PDA_EDGE_MARGIN + initInsets.left;
  const initRightMargin = PDA_EDGE_MARGIN + initInsets.right;
  if (initialDockSide === 'right') {
    initialX = Math.max(initMinX, vp.width - initialEffectiveSize.width - initRightMargin);
  } else if (initialDockSide === 'left') {
    initialX = initMinX;
  }

  const state = reactive<PdaState>({
    x: initialX,
    y: initialY,
    collapsed: initialCollapsed,
    mode: initialCollapsed ? 'collapsed' : 'expanded',
    ...(initialSizeMode ? { sizeMode: initialSizeMode } : {}),
    pinned: saved?.pinned ?? false,
    dockSide: initialDockSide,
    activeTab: saved?.activeTab ?? 'events',
    hidden: saved?.hidden ?? false,
    readEventIds: saved?.readEventIds ? [...saved.readEventIds] : [],
    highlightEventId: null,
  });

  const viewportTick = reactive({ width: vp.width, height: vp.height });

  let drag: { screenX: number; screenY: number; originX: number; originY: number } | null = null;

  function persist() {
    savePdaState(deps.storage, state, currentScopeId);
  }

  function size(): Size {
    return pdaFrameSize(state.collapsed);
  }

  function dynamicSize(): Size {
    // 读取 viewportTick 以在窗口 resize 时触发 Vue 响应式重算
    void viewportTick.width;
    void viewportTick.height;
    const curVp = deps.viewport();
    return resolveDynamicPdaSize(curVp, state.collapsed, state.sizeMode ?? 'proportional');
  }

  function activeGeometrySize(curVp: Viewport): Size {
    if (state.collapsed) return { ...PDA_COLLAPSED_SIZE };
    if (state.sizeMode) {
      return resolveDynamicPdaSize(curVp, false, state.sizeMode);
    }
    return pdaFrameSize(false);
  }

  function setSizeMode(mode: PdaSizeMode) {
    state.sizeMode = mode;
    relayout();
    persist();
  }

  function cycleSizeMode(): PdaSizeMode {
    const cur = state.sizeMode ?? 'proportional';
    const next: PdaSizeMode =
      cur === 'proportional' ? 'large' : cur === 'large' ? 'compact' : 'proportional';
    setSizeMode(next);
    return next;
  }

  function relayout() {
    const curVp = deps.viewport();
    viewportTick.width = curVp.width;
    viewportTick.height = curVp.height;
    const curSize = activeGeometrySize(curVp);
    const insets = resolvePdaSafeInsets(curVp);
    const minX = PDA_EDGE_MARGIN + insets.left;
    const rightMargin = PDA_EDGE_MARGIN + insets.right;

    if (state.dockSide === 'right') {
      state.x = Math.max(minX, curVp.width - curSize.width - rightMargin);
    } else if (state.dockSide === 'left') {
      state.x = minX;
    }

    const c = clampPdaPosition({ x: state.x, y: state.y }, curVp, state.collapsed, curSize);
    state.x = c.x;
    state.y = c.y;
  }

  function setCollapsed(collapsed: boolean) {
    if (state.collapsed === collapsed && state.mode === (collapsed ? 'collapsed' : 'expanded')) return;
    state.collapsed = collapsed;
    state.mode = collapsed ? 'collapsed' : 'expanded';
    relayout();
    persist();
  }

  function toggleCollapse() {
    setCollapsed(!state.collapsed);
  }

  function setPinned(pinned: boolean) {
    if (state.pinned === pinned) return;
    state.pinned = pinned;
    persist();
  }

  function togglePin() {
    setPinned(!state.pinned);
  }

  function setActiveTab(tab: PdaTabId) {
    if (state.activeTab === tab) return;
    state.activeTab = tab;
    persist();
  }

  function setHidden(hidden: boolean) {
    if (state.hidden === hidden) return;
    state.hidden = hidden;
    persist();
  }

  function markEventRead(eventId: string) {
    if (!eventId || state.readEventIds.includes(eventId)) return;
    state.readEventIds.push(eventId);
    persist();
  }

  function markAllEventsRead(eventIds: string[]) {
    let changed = false;
    for (const id of eventIds) {
      if (id && !state.readEventIds.includes(id)) {
        state.readEventIds.push(id);
        changed = true;
      }
    }
    if (changed) {
      persist();
    }
  }

  function focusEvent(eventId: string, tab: PdaTabId = 'events') {
    state.collapsed = false;
    state.mode = 'expanded';
    state.hidden = false;
    state.activeTab = tab;
    state.highlightEventId = eventId;
    relayout();
    persist();
  }

  function clearHighlight() {
    state.highlightEventId = null;
  }

  function dragStart(screenX: number, screenY: number) {
    if (state.pinned) return;
    drag = {
      screenX,
      screenY,
      originX: state.x,
      originY: state.y,
    };
  }

  function dragMove(screenX: number, screenY: number) {
    if (!drag || state.pinned) return;
    const curVp = deps.viewport();
    const curSize = activeGeometrySize(curVp);
    const candidate = {
      x: drag.originX + (screenX - drag.screenX),
      y: drag.originY + (screenY - drag.screenY),
    };
    const c = clampPdaPosition(candidate, curVp, state.collapsed, curSize);
    state.x = c.x;
    state.y = c.y;
  }

  function dragEnd() {
    if (!drag) return;
    drag = null;
    if (state.pinned) return;

    const curVp = deps.viewport();
    const curSize = activeGeometrySize(curVp);
    const snapped = calculateSnap({ x: state.x, y: state.y }, curVp, state.collapsed, curSize);
    state.x = snapped.x;
    state.y = snapped.y;
    state.dockSide = snapped.dockSide;
    persist();
  }

  function setPosition(pos: Position) {
    const curVp = deps.viewport();
    const curSize = activeGeometrySize(curVp);
    const snapped = calculateSnap(pos, curVp, state.collapsed, curSize);
    state.x = snapped.x;
    state.y = snapped.y;
    state.dockSide = snapped.dockSide;
    persist();
  }

  function snapToEdge(side?: 'left' | 'right') {
    const curVp = deps.viewport();
    const curSize = activeGeometrySize(curVp);
    const insets = resolvePdaSafeInsets(curVp);
    const minX = PDA_EDGE_MARGIN + insets.left;
    const rightMargin = PDA_EDGE_MARGIN + insets.right;
    if (side === 'left') {
      state.x = minX;
      state.dockSide = 'left';
    } else if (side === 'right') {
      state.x = Math.max(minX, curVp.width - curSize.width - rightMargin);
      state.dockSide = 'right';
    } else {
      const snapped = calculateSnap({ x: state.x, y: state.y }, curVp, state.collapsed, curSize);
      state.x = snapped.x;
      state.y = snapped.y;
      state.dockSide = snapped.dockSide;
    }
    persist();
  }

  function resetPosition() {
    const curVp = deps.viewport();
    const curSize = activeGeometrySize(curVp);
    const def = defaultPdaPosition(curVp, state.collapsed, curSize);
    state.x = def.x;
    state.y = def.y;
    state.dockSide = 'right';
    state.hidden = false;
    persist();
  }

  function recallPdaToCenterInstance(): Position {
    const curVp = deps.viewport();
    state.collapsed = false;
    state.mode = 'expanded';
    state.hidden = false;
    state.dockSide = 'free';
    const curSize = activeGeometrySize(curVp);
    const center = centerPdaPosition(curVp, false, curSize);
    state.x = center.x;
    state.y = center.y;
    persist();
    return { x: state.x, y: state.y };
  }

  function setSessionScopeInstance(scopeId: string | null) {
    const normalized = typeof scopeId === 'string' && scopeId.trim().length > 0 ? scopeId.trim() : null;
    currentScopeId = normalized;
    const scopedSaved = loadPdaState(deps.storage, currentScopeId);
    state.readEventIds = scopedSaved?.readEventIds ? [...scopedSaved.readEventIds] : [];
  }

  function getSessionScopeInstance(): string | null {
    return currentScopeId;
  }

  const offResize = deps.onResize?.(relayout);

  const shellInstance: PdaShell = {
    state: readonly(state),
    size,
    dynamicSize,
    cycleSizeMode,
    setSizeMode,
    toggleCollapse,
    setCollapsed,
    setPinned,
    togglePin,
    setActiveTab,
    setHidden,
    markEventRead,
    markAllEventsRead,
    focusEvent,
    clearHighlight,
    dragStart,
    dragMove,
    dragEnd,
    setPosition,
    snapToEdge,
    relayout,
    resetPosition,
    recallPdaToCenter: recallPdaToCenterInstance,
    setPdaSessionScope: setSessionScopeInstance,
    getSessionScope: getSessionScopeInstance,
    destroy: () => {
      activeShells.delete(shellInstance);
      shellInternals.delete(shellInstance);
      offResize?.();
    },
  };

  shellInternals.set(shellInstance, {
    storage: deps.storage,
    setReadIds: (ids: string[]) => {
      state.readEventIds = [...ids];
      persist();
    },
  });
  activeShells.add(shellInstance);
  return shellInstance;
}
