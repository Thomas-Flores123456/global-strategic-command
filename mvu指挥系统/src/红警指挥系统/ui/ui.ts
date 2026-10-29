/**
 * 界面级共享状态（不进 MVU 变量树）：
 * - base_index：当前查看的基地下标，PanelBase 切换、ActionBar 下指令时共用
 * - theme：阵营配色（盟军蓝/苏联红/尤里紫），localStorage 持久化 + 跨 iframe 实时广播同步
 */
import { reactive } from 'vue';

export type ThemeKey = 'allied' | 'soviet' | 'yuri';

export const THEME_STORE_KEY = 'rts-theme';
export const RA_THEME_MESSAGE_TYPE = 'ra-theme-changed';

export function normalizeThemeKey(raw: unknown): ThemeKey | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === 'allied' || s === 'allies' || s.includes('盟军') || s.includes('allied')) return 'allied';
  if (s === 'soviet' || s.includes('苏联') || s.includes('苏维埃') || s.includes('soviet')) return 'soviet';
  if (s === 'yuri' || s.includes('尤里') || s.includes('yuri')) return 'yuri';
  return null;
}

export function loadTheme(): ThemeKey {
  try {
    const raw = normalizeThemeKey(localStorage.getItem(THEME_STORE_KEY));
    if (raw) return raw;
  } catch {
    /* storage 不可用时用默认 */
  }
  return 'allied';
}

export const ui = reactive<{
  base_index: number;
  theme: ThemeKey;
}>({
  base_index: 0,
  theme: loadTheme(),
});

const themeListeners = new Set<(theme: ThemeKey) => void>();

export function onThemeChange(listener: (theme: ThemeKey) => void): () => void {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

function notifyThemeListeners(theme: ThemeKey) {
  for (const fn of themeListeners) {
    try {
      fn(theme);
    } catch {
      /* ignore listener errors */
    }
  }
}

/**
 * 向当前窗口、父窗口（酒馆宿主）及所有同级/子级 iframe 广播主题变更事件
 */
export function broadcastThemeAcrossFrames(theme: ThemeKey): void {
  if (typeof window === 'undefined') return;
  const payload = { type: RA_THEME_MESSAGE_TYPE, theme };

  try {
    window.postMessage(payload, '*');
  } catch {
    /* ignore */
  }

  try {
    if (typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent(RA_THEME_MESSAGE_TYPE, { detail: { theme } }));
    }
  } catch {
    /* ignore */
  }

  try {
    const parentWin = window.parent;
    if (parentWin && parentWin !== window) {
      try {
        parentWin.postMessage(payload, '*');
      } catch {
        /* ignore */
      }
      try {
        if (typeof CustomEvent === 'function') {
          parentWin.dispatchEvent(new CustomEvent(RA_THEME_MESSAGE_TYPE, { detail: { theme } }));
        }
      } catch {
        /* ignore */
      }
      try {
        const frames = parentWin.frames;
        for (let i = 0; i < frames.length; i++) {
          const frameWin = frames[i];
          if (frameWin && frameWin !== window) {
            try {
              frameWin.postMessage(payload, '*');
            } catch {
              /* cross-frame guard */
            }
          }
        }
      } catch {
        /* cross-frame guard */
      }
      try {
        const hostDoc = parentWin.document;
        if (hostDoc && typeof hostDoc.querySelectorAll === 'function') {
          const iframes = hostDoc.querySelectorAll('iframe');
          for (let i = 0; i < iframes.length; i++) {
            const cw = (iframes[i] as HTMLIFrameElement).contentWindow;
            if (cw && cw !== window) {
              try {
                cw.postMessage(payload, '*');
              } catch {
                /* cross-frame guard */
              }
            }
          }
        }
      } catch {
        /* cross-frame guard */
      }
    }
  } catch {
    /* cross-frame guard */
  }
}

export interface SetThemeOptions {
  /** 是否向跨帧总线广播（默认 true；收到外部广播回写本地状态时传 false 防回声环路） */
  broadcast?: boolean;
  /** 是否写入 localStorage（默认 true） */
  persist?: boolean;
}

export function setTheme(theme: ThemeKey | string, options?: SetThemeOptions): ThemeKey {
  const normalized = normalizeThemeKey(theme) ?? 'allied';
  const changed = ui.theme !== normalized;
  ui.theme = normalized;

  if (options?.persist !== false) {
    try {
      localStorage.setItem(THEME_STORE_KEY, normalized);
    } catch {
      /* storage 不可用时仅本次生效 */
    }
  }

  if (changed) {
    notifyThemeListeners(normalized);
  }

  if (options?.broadcast !== false) {
    broadcastThemeAcrossFrames(normalized);
  }

  return normalized;
}

let detachGlobalSync: (() => void) | null = null;

/**
 * 安装跨 iframe 主题同步监听（幂等，支持 message / storage / CustomEvent 三通道）
 */
export function installCrossFrameThemeSync(): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  if (detachGlobalSync) {
    return detachGlobalSync;
  }

  const onMessage = (e: MessageEvent) => {
    const data = e?.data as { type?: unknown; theme?: unknown } | null | undefined;
    if (!data || data.type !== RA_THEME_MESSAGE_TYPE) return;
    const next = normalizeThemeKey(data.theme);
    if (!next || next === ui.theme) return;
    setTheme(next, { broadcast: false, persist: false });
  };

  const onStorage = (e: StorageEvent) => {
    if (e?.key !== THEME_STORE_KEY) return;
    const next = normalizeThemeKey(e.newValue);
    if (!next || next === ui.theme) return;
    setTheme(next, { broadcast: false, persist: false });
  };

  const onCustomEvent = (e: Event) => {
    const detail = (e as CustomEvent<{ theme?: unknown }>)?.detail;
    const next = normalizeThemeKey(detail?.theme);
    if (!next || next === ui.theme) return;
    setTheme(next, { broadcast: false, persist: false });
  };

  window.addEventListener('message', onMessage);
  window.addEventListener('storage', onStorage);
  window.addEventListener(RA_THEME_MESSAGE_TYPE, onCustomEvent);

  let parentWinAttached: Window | null = null;
  try {
    if (window.parent && window.parent !== window && typeof window.parent.addEventListener === 'function') {
      window.parent.addEventListener('message', onMessage);
      window.parent.addEventListener(RA_THEME_MESSAGE_TYPE, onCustomEvent);
      parentWinAttached = window.parent;
    }
  } catch {
    /* cross-frame guard */
  }

  detachGlobalSync = () => {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(RA_THEME_MESSAGE_TYPE, onCustomEvent);
    if (parentWinAttached) {
      try {
        parentWinAttached.removeEventListener('message', onMessage);
        parentWinAttached.removeEventListener(RA_THEME_MESSAGE_TYPE, onCustomEvent);
      } catch {
        /* ignore */
      }
      parentWinAttached = null;
    }
    detachGlobalSync = null;
  };

  return detachGlobalSync;
}

/**
 * 从快照推断默认主阵营终端主题色（优先：当前/已建基地的核心建筑阵营 -> command 主帅直辖/首选阵营 -> 旧版 command_hq -> 待命车队兜底）
 * 修复：多阵营开局下当盟军 MCV 展开为「盟军建造厂」退出 forces.vehicles 后，剩余未展开的「MCV（苏联）」排在 vehicles[0] 导致主题误跳苏军红的问题。
 */
export function inferPrimaryThemeFromSnapshot(
  snap: Record<string, unknown> | null | undefined,
  preferredBaseIndex = 0,
): ThemeKey | null {
  if (!snap) return null;

  // 1. 优先读取当前选中基地（或首个已展开基地）的核心建筑阵营（如已展开「盟军建造厂」则跟随当前基地阵营）
  const rawBases = Array.isArray((snap as { bases?: unknown[] }).bases)
    ? ((snap as { bases: Array<{ status?: unknown; buildings?: Array<{ name?: unknown }> }> }).bases)
    : [];
  const orderedBases =
    preferredBaseIndex >= 0 && preferredBaseIndex < rawBases.length
      ? [rawBases[preferredBaseIndex], ...rawBases.filter((_, idx) => idx !== preferredBaseIndex)]
      : rawBases;
  for (const b of orderedBases) {
    if (!b || b.status === '废弃') continue;
    for (const bld of b.buildings ?? []) {
      const mapped = normalizeThemeKey(bld?.name);
      if (mapped) return mapped;
    }
  }

  // 2. 读取 command 主帅直辖阵营 / 显式主阵营 / 首选解锁阵营（修复原误读旧字段 command_hq 导致穿透至未展开 MCV 的问题）
  const cmd = (snap as { command?: Record<string, unknown> }).command as
    | {
        primary_faction?: unknown;
        unlocked_factions?: unknown[];
        mcv_granted_factions?: unknown[];
        adjutants?: Array<{ role?: unknown; identity?: unknown; faction?: unknown; status?: unknown }>;
      }
    | undefined;
  if (cmd) {
    const explicitPrimary = normalizeThemeKey(cmd.primary_faction);
    if (explicitPrimary) return explicitPrimary;

    if (Array.isArray(cmd.adjutants)) {
      const selfAdj = cmd.adjutants.find(
        a => a && a.identity === 'commander_self' && a.status !== 'dismissed' && a.faction,
      );
      const selfMapped = normalizeThemeKey(selfAdj?.faction);
      if (selfMapped) return selfMapped;
    }

    if (Array.isArray(cmd.unlocked_factions) && cmd.unlocked_factions.length > 0) {
      const firstUnlocked = normalizeThemeKey(cmd.unlocked_factions[0]);
      if (firstUnlocked) return firstUnlocked;
    }

    if (Array.isArray(cmd.mcv_granted_factions) && cmd.mcv_granted_factions.length > 0) {
      const firstGranted = normalizeThemeKey(cmd.mcv_granted_factions[0]);
      if (firstGranted) return firstGranted;
    }
  }

  // 3. 兼容旧版 command_hq.factions 结构
  const hqFactions = (snap as { command_hq?: { factions?: unknown[] } }).command_hq?.factions;
  if (Array.isArray(hqFactions) && hqFactions.length > 0) {
    const first = hqFactions[0];
    const rawId =
      typeof first === 'string'
        ? first
        : typeof first === 'object' && first !== null
          ? ((first as { id?: unknown; name?: unknown; faction?: unknown }).id ??
              (first as { name?: unknown }).name ??
              (first as { faction?: unknown }).faction)
          : undefined;
    const mapped = normalizeThemeKey(rawId);
    if (mapped) return mapped;
  }

  // 4. 仅在尚未建立基地且无 command 阵营记录时，才兜底扫描待命车队
  const vehicles = (snap as { forces?: { vehicles?: unknown[] } }).forces?.vehicles ?? [];
  for (const v of vehicles) {
    const mapped = normalizeThemeKey(v);
    if (mapped) return mapped;
  }
  return null;
}

// 模块在浏览器环境加载时自动开启跨帧监听
installCrossFrameThemeSync();
