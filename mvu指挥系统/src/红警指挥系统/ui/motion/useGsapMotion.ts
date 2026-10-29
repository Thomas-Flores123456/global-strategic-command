/**
 * useGsapMotion.ts —— 红警指挥系统 & 中控悬浮窗统一 GSAP 战术动效底座
 *
 * 设计铁律（SillyTavern 跨 iframe / Teleport 宿主环境专用）：
 * 1. 绝不向 gsap 传入全局字符串选择器（因为全屏 Modal 通过 Teleport 挂载在 window.parent.document.body，
 *    而脚本运行在 Helper iframe 内）；一律操作真实 HTMLElement 引用或基于 rootEl.querySelectorAll 的节点数组。
 * 2. 单测（Vitest / Node / JSDOM）与系统级 prefers-reduced-motion 自动零延时旁路，保证全部同步 DOM 断言零退化。
 * 3. 兼容直接调用 setup() 的无实例单元测试（先检查 getCurrentInstance() 再注册生命周期钩子，用 scheduleNextFrame 替代裸 requestAnimationFrame）。
 * 4. 动画落位后自动 clearProps: 'transform'，避免在弹窗内部遗留 transform 导致 fixed 子节点定位偏移。
 */
import gsap from 'gsap';
import { getCurrentInstance, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

export const UI_MOTION_STORAGE_KEY = 'redalert_ui_motion_enabled';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function resolveDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    /* ignore sandboxed storage error */
  }
  return null;
}

/** 安全帧调度：在 Node/SSR 单测环境无 requestAnimationFrame 时自动降级为 queueMicrotask */
export function scheduleNextFrame(cb: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(cb);
  } else {
    queueMicrotask(cb);
  }
}

/** 读取用户在「控制台环境选项」中的战术动效开关（默认开启 true） */
export function getUiMotionEnabled(storage?: StorageLike | null): boolean {
  const s = storage === undefined ? resolveDefaultStorage() : storage;
  if (!s) return true;
  try {
    const raw = s.getItem(UI_MOTION_STORAGE_KEY);
    if (raw === 'false' || raw === '0' || raw === 'off') return false;
    return true;
  } catch {
    return true;
  }
}

/** 写入战术动效开关状态 */
export function setUiMotionEnabled(enabled: boolean, storage?: StorageLike | null): boolean {
  const s = storage === undefined ? resolveDefaultStorage() : storage;
  if (s) {
    try {
      s.setItem(UI_MOTION_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }
  return enabled;
}

/** 检测是否处于 Vitest / Node / JSDOM 测试环境 */
export function isTestOrJsdomEnv(): boolean {
  try {
    const metaEnv = (import.meta as unknown as { env?: { MODE?: string; VITEST?: boolean | string } })?.env;
    if (metaEnv && (metaEnv.MODE === 'test' || Boolean(metaEnv.VITEST))) {
      return true;
    }
  } catch {
    /* ignore */
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return true;
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  return /jsdom|happy-dom|node\.js/i.test(ua);
}

/** 检测系统级 prefers-reduced-motion: reduce */
export function prefersReducedMotion(): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * 判断当前是否应当执行真实时长 GSAP 补间动画：
 * - 若 forceRun === true（仅供动效自身单元测试显式校验补间调用），强制放行；
 * - 若在单测环境、或系统开启减少动态效果、或玩家关闭了界面动效开关，则返回 false（零延时旁路）。
 */
export function shouldRunGsapMotion(opts?: { storage?: StorageLike | null; forceRun?: boolean }): boolean {
  if (opts?.forceRun) return true;
  if (!getUiMotionEnabled(opts?.storage)) return false;
  if (prefersReducedMotion()) return false;
  if (isTestOrJsdomEnv()) return false;
  return true;
}

export interface TacticalModalMotionOptions {
  /** 内部需要交错点亮（Stagger）的子卡片/区块选择器，默认自动探测常见战术卡片容器 */
  staggerSelector?: string;
  /** 最多交错点亮前 N 个元素，避免大网格掉帧，默认 18 */
  maxStaggerItems?: number;
  /** 主窗口入场时长（秒），默认 0.22 */
  duration?: number;
  /** 仅供测试强制运行 */
  forceRun?: boolean;
  storage?: StorageLike | null;
}

const DEFAULT_STAGGER_SELECTOR =
  '[data-gsap-stagger], .stat-card, .pillar-card, .kpi-card, .tech-card, .girl-card, .bldg-card, .sum-card';

/**
 * 播放全屏战术弹窗（Modal）机械展开 + 首屏子区块交错通电点亮动效
 */
export function playTacticalModalEnter(
  panelEl: HTMLElement | null | undefined,
  backdropEl?: HTMLElement | null,
  opts?: TacticalModalMotionOptions,
): void {
  if (!panelEl) return;
  if (!shouldRunGsapMotion({ storage: opts?.storage, forceRun: opts?.forceRun })) {
    return;
  }

  const duration = opts?.duration ?? 0.22;
  gsap.killTweensOf(panelEl);

  if (backdropEl && backdropEl !== panelEl) {
    gsap.killTweensOf(backdropEl);
    gsap.fromTo(
      backdropEl,
      { opacity: 0 },
      { opacity: 1, duration: 0.16, ease: 'power2.out', overwrite: 'auto' },
    );
  }

  gsap.fromTo(
    panelEl,
    { opacity: 0, y: 10, scale: 0.97 },
    {
      opacity: 1,
      y: 0,
      scale: 1,
      duration,
      ease: 'power3.out',
      overwrite: 'auto',
      clearProps: 'transform',
    },
  );

  const selector = opts?.staggerSelector ?? DEFAULT_STAGGER_SELECTOR;
  const maxItems = opts?.maxStaggerItems ?? 18;
  try {
    if (typeof panelEl.querySelectorAll === 'function') {
      const nodes = Array.from(panelEl.querySelectorAll<HTMLElement>(selector)).slice(0, maxItems);
      if (nodes.length > 0) {
        gsap.killTweensOf(nodes);
        gsap.fromTo(
          nodes,
          { opacity: 0, y: 6 },
          {
            opacity: 1,
            y: 0,
            duration: 0.2,
            stagger: 0.02,
            delay: 0.04,
            ease: 'power2.out',
            overwrite: 'auto',
            clearProps: 'transform',
          },
        );
      }
    }
  } catch {
    /* ignore selector errors */
  }
}

/**
 * 播放右侧战术详情抽屉（DetailDrawer）高速滑入动效
 */
export function playTacticalDrawerEnter(
  drawerEl: HTMLElement | null | undefined,
  backdropEl?: HTMLElement | null,
  opts?: { forceRun?: boolean; storage?: StorageLike | null },
): void {
  if (!drawerEl) return;
  if (!shouldRunGsapMotion({ storage: opts?.storage, forceRun: opts?.forceRun })) {
    return;
  }

  gsap.killTweensOf(drawerEl);
  if (backdropEl && backdropEl !== drawerEl) {
    gsap.killTweensOf(backdropEl);
    gsap.fromTo(
      backdropEl,
      { opacity: 0 },
      { opacity: 1, duration: 0.15, ease: 'power2.out', overwrite: 'auto' },
    );
  }

  gsap.fromTo(
    drawerEl,
    { opacity: 0, x: 28 },
    {
      opacity: 1,
      x: 0,
      duration: 0.22,
      ease: 'power3.out',
      overwrite: 'auto',
      clearProps: 'transform',
    },
  );
}

/**
 * 播放容器内部卡片/行项目的交错点亮动效（用于 Tab 切换、展开面板）
 */
export function playTacticalStagger(
  containerEl: HTMLElement | null | undefined,
  itemSelector: string,
  opts?: {
    maxItems?: number;
    stagger?: number;
    duration?: number;
    y?: number;
    forceRun?: boolean;
    storage?: StorageLike | null;
  },
): void {
  if (!containerEl || !itemSelector) return;
  if (!shouldRunGsapMotion({ storage: opts?.storage, forceRun: opts?.forceRun })) {
    return;
  }

  const maxItems = opts?.maxItems ?? 20;
  try {
    if (typeof containerEl.querySelectorAll !== 'function') return;
    const items = Array.from(containerEl.querySelectorAll<HTMLElement>(itemSelector)).slice(0, maxItems);
    if (!items.length) return;
    gsap.killTweensOf(items);
    gsap.fromTo(
      items,
      { opacity: 0, y: opts?.y ?? 6 },
      {
        opacity: 1,
        y: 0,
        duration: opts?.duration ?? 0.18,
        stagger: opts?.stagger ?? 0.02,
        ease: 'power2.out',
        overwrite: 'auto',
        clearProps: 'transform',
      },
    );
  } catch {
    /* ignore */
  }
}

/**
 * 播放时序冲突/紧急告警横幅滑入与脉冲动效
 */
export function playTacticalAlertPulse(
  bannerEl: HTMLElement | null | undefined,
  opts?: { forceRun?: boolean; storage?: StorageLike | null },
): void {
  if (!bannerEl) return;
  if (!shouldRunGsapMotion({ storage: opts?.storage, forceRun: opts?.forceRun })) {
    return;
  }

  gsap.killTweensOf(bannerEl);
  gsap.fromTo(
    bannerEl,
    { opacity: 0, y: -8 },
    {
      opacity: 1,
      y: 0,
      duration: 0.22,
      ease: 'power3.out',
      overwrite: 'auto',
      clearProps: 'transform',
    },
  );
}

/**
 * 弹窗/面板通用 Vue 生命周期动效挂钩：
 * - 当组件首次挂载或 open getter 变为 true 时，自动对 panelRef 执行战术展开与子卡交错点亮；
 * - 兼容无活跃组件实例的纯函数 setup() 单测调用（通过 getCurrentInstance() 守卫）。
 */
export function useTacticalModalMotion(
  panelRef: Ref<HTMLElement | null>,
  backdropRef?: Ref<HTMLElement | null>,
  opts?: TacticalModalMotionOptions & { open?: () => boolean },
): { triggerEnter: () => void } {
  const triggerEnter = () => {
    playTacticalModalEnter(panelRef.value, backdropRef?.value, opts);
  };

  if (getCurrentInstance()) {
    onMounted(() => {
      if (!opts?.open || opts.open()) {
        triggerEnter();
      }
    });

    onBeforeUnmount(() => {
      if (panelRef.value) gsap.killTweensOf(panelRef.value);
      if (backdropRef?.value) gsap.killTweensOf(backdropRef.value);
    });
  }

  if (opts?.open) {
    watch(
      opts.open,
      isOpen => {
        if (isOpen) {
          scheduleNextFrame(() => triggerEnter());
        }
      },
      { flush: 'post' },
    );
  }

  return { triggerEnter };
}

/**
 * 响应式数值平滑跳字器（Number Ticker）
 * - 在真实浏览器且动效开启时，当目标数值变化，使用 GSAP 在 duration 秒内平滑过渡；
 * - 在 Vitest 单测或关闭动效时，立即同步返回目标数值，绝不影响单测断言。
 */
export function useGsapNumber(
  source: () => number,
  opts?: {
    duration?: number;
    decimals?: number;
    forceRun?: boolean;
    storage?: StorageLike | null;
  },
): Ref<number> {
  const decimals = opts?.decimals ?? 0;
  const roundVal = (n: number) => {
    if (!Number.isFinite(n)) return 0;
    if (decimals <= 0) return Math.round(n);
    const factor = 10 ** decimals;
    return Math.round(n * factor) / factor;
  };

  const initial = roundVal(source());
  const display = ref<number>(initial);
  const proxy = { value: initial };

  watch(
    source,
    nextRaw => {
      const target = roundVal(nextRaw);
      if (!shouldRunGsapMotion({ storage: opts?.storage, forceRun: opts?.forceRun })) {
        gsap.killTweensOf(proxy);
        proxy.value = target;
        display.value = target;
        return;
      }

      gsap.killTweensOf(proxy);
      gsap.to(proxy, {
        value: target,
        duration: opts?.duration ?? 0.42,
        ease: 'power2.out',
        onUpdate: () => {
          display.value = roundVal(proxy.value);
        },
        onComplete: () => {
          proxy.value = target;
          display.value = target;
        },
      });
    },
    { flush: 'sync' },
  );

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      gsap.killTweensOf(proxy);
    });
  }

  return display;
}
