/**
 * ttHostBridgeAndLayout.test.ts —— TauriTavern 宿主桥接网关与多端 Layout 安全区几何契约专项单测
 *
 * 覆盖：
 * 1. ttHostBridge.ts：跨 parent 最多 4 层穿透寻址、跨域异常防护、waitForTauriTavernReady、
 *    isChatSurfaceManaged、diagnoseTauriTavernHost、applyMobileSurface；
 * 2. shell.ts：接入 safeInsets 钳位/停靠、data-tt-mobile-surface="free-window"、layout.subscribe 响应与清理；
 * 3. modalHost.ts：#tavernweave-tactical-modal-overlay (backdrop / fullscreen-window / viewport-host)、
 *    #tavernweave-hud-host (free-window) 及安全区 CSS 变量兼容；
 * 4. pdaState.ts：safeInsets 留边钳位、贴边磁吸与默认位置计算（无 safeInsets 时 100% 像素一致）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyMobileSurface,
  diagnoseTauriTavernHost,
  getTauriTavernBridge,
  isChatSurfaceManaged,
  resolveTauriTavernWindow,
  TT_SURFACE,
  waitForTauriTavernReady,
  type LayoutSnapshot,
} from '../host/ttHostBridge';
import {
  clampPosition,
  createShell,
  defaultPosition,
   defaultShellDeps,
  EDGE_MARGIN,
  EXPANDED_SIZE,
  frameSize,
  type FrameLike,
  type Viewport as ShellViewport,
} from '../host/shell';
import {
  destroyHudHost,
  destroyModalHost,
  HUD_HOST_ID,
  initHudHost,
  initModalHost,
  OVERLAY_HOST_ID,
} from '../host/modalHost';
import {
  calculateSnap,
  clampPdaPosition,
  createPdaShell,
  defaultPdaPosition,
  PDA_COLLAPSED_SIZE,
  PDA_EDGE_MARGIN,
  PDA_EXPANDED_SIZE,
  type Viewport as PdaViewport,
} from '../pda/pdaState';

function makeSnapshot(overrides?: Partial<LayoutSnapshot>): LayoutSnapshot {
  return {
    timestampMs: 1000,
    viewport: { left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 },
    safeInsets: { top: 44, right: 16, bottom: 34, left: 12 },
    safeFrame: { left: 12, top: 44, width: 1172, height: 722, right: 1184, bottom: 766 },
    ime: {
      activeSurface: null,
      kind: null,
      bottom: 0,
      viewportBottomInset: 34,
      keyboardOffset: 0,
    },
    ...overrides,
  };
}

describe('PKG-B: ttHostBridge 跨帧穿透寻址与能力诊断', () => {
  it('支持向上最多穿透 4 层同源 parent 查找 __TAURITAVERN__，超出 4 层返回 null', () => {
    const rootHost = {
      __TAURITAVERN__: {
        abiVersion: 1,
        api: {},
      },
    };
    const depth1 = { parent: rootHost };
    const depth2 = { parent: depth1 };
    const depth3 = { parent: depth2 };
    const depth4 = { parent: depth3 };
    const depth5 = { parent: depth4 };

    expect(resolveTauriTavernWindow(rootHost)).toBe(rootHost);
    expect(resolveTauriTavernWindow(depth2)).toBe(rootHost);
    expect(resolveTauriTavernWindow(depth4)).toBe(rootHost);
    // 第 5 层超过最大 4 层穿透限制
    expect(resolveTauriTavernWindow(depth5)).toBeNull();
  });

  it('跨域 parent 访问抛出异常时安全拦截并降级为 null', () => {
    const crossOriginChild: Record<string, unknown> = {};
    Object.defineProperty(crossOriginChild, 'parent', {
      get() {
        throw new DOMException('Blocked a frame with origin from accessing a cross-origin frame.');
      },
    });

    expect(() => resolveTauriTavernWindow(crossOriginChild)).not.toThrow();
    expect(resolveTauriTavernWindow(crossOriginChild)).toBeNull();
    expect(isChatSurfaceManaged(crossOriginChild)).toBe(false);
  });

  it('waitForTauriTavernReady 等待 ready Promise 解析；非 TT 环境立即返回 false', async () => {
    expect(await waitForTauriTavernReady({})).toBe(false);

    let resolved = false;
    const hostWin = {
      __TAURITAVERN__: {
        abiVersion: 1,
        ready: new Promise<void>(resolve => {
          setTimeout(() => {
            resolved = true;
            resolve();
          }, 10);
        }),
      },
    };

    const ok = await waitForTauriTavernReady(hostWin);
    expect(ok).toBe(true);
    expect(resolved).toBe(true);
  });

  it('isChatSurfaceManaged 严格核验 protocolVersion === 1 与 isManagedOwnershipRequired() === true', () => {
    expect(isChatSurfaceManaged({})).toBe(false);

    const unmanaged = {
      __TAURITAVERN__: {
        abiVersion: 1,
        api: {
          chatSurface: {
            protocolVersion: 1,
            isManagedOwnershipRequired: () => false,
            registerParticipant: () => () => {},
          },
        },
      },
    };
    expect(isChatSurfaceManaged(unmanaged)).toBe(false);

    const wrongVersion = {
      __TAURITAVERN__: {
        abiVersion: 1,
        api: {
          chatSurface: {
            protocolVersion: 2,
            isManagedOwnershipRequired: () => true,
            registerParticipant: () => () => {},
          },
        },
      },
    };
    expect(isChatSurfaceManaged(wrongVersion)).toBe(false);

    const managed = {
      __TAURITAVERN__: {
        abiVersion: 1,
        api: {
          chatSurface: {
            protocolVersion: 1,
            isManagedOwnershipRequired: () => true,
            registerParticipant: () => () => {},
          },
        },
      },
    };
    expect(isChatSurfaceManaged(managed)).toBe(true);
  });

  it('diagnoseTauriTavernHost 与 getTauriTavernBridge 汇总完整宿主能力快照', () => {
    const snap = makeSnapshot();
    const hostWin = {
      __TAURITAVERN__: {
        abiVersion: 1,
        api: {
          layout: {
            snapshot: () => snap,
            subscribe: () => () => {},
          },
          chatSurface: {
            protocolVersion: 1,
            isManagedOwnershipRequired: () => true,
            registerParticipant: () => () => {},
          },
          extensionStore: {
            setJson: async () => {},
          },
          worldInfo: {
            getLastActivation: async () => null,
          },
          agent: {
            startRunFromLegacyGenerate: async () => ({}),
          },
          skill: {
            installImport: async () => ({}),
          },
        },
      },
    };

    const bridge = getTauriTavernBridge(hostWin);
    expect(bridge.isTauriTavern).toBe(true);
    expect(bridge.abiVersion).toBe(1);
    expect(bridge.isChatSurfaceManaged()).toBe(true);
    expect(bridge.layout).not.toBeNull();
    expect(bridge.extensionStore).not.toBeNull();

    const diag = diagnoseTauriTavernHost(hostWin);
    expect(diag).toEqual({
      isTauriTavern: true,
      abiVersion: 1,
      chatSurfaceManaged: true,
      chatSurfaceProtocolVersion: 1,
      hasLayoutApi: true,
      hasExtensionStoreApi: true,
      hasWorldInfoApi: true,
      hasAgentApi: true,
      hasSkillApi: true,
      safeFrameSummary: '1172×722 (insets: T44/R16/B34/L12, IME: 0px)',
    });
  });

  it('applyMobileSurface 正确设置 data-tt-mobile-surface 属性', () => {
    const datasetObj = { dataset: {} as Record<string, string> };
    applyMobileSurface(datasetObj as unknown as Element, TT_SURFACE.FreeWindow);
    expect(datasetObj.dataset.ttMobileSurface).toBe('free-window');

    const attrs: Record<string, string> = {};
    const attrObj = {
      setAttribute: (k: string, v: string) => {
        attrs[k] = v;
      },
    };
    applyMobileSurface(attrObj as unknown as Element, TT_SURFACE.Backdrop);
    expect(attrs['data-tt-mobile-surface']).toBe('backdrop');

    expect(() => applyMobileSurface(null, TT_SURFACE.None)).not.toThrow();
  });
});

describe('PKG-B: shell.ts 接入 safeInsets、data-tt-mobile-surface 与 layout.subscribe', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURITAVERN__;
  });

  it('clampPosition 与 defaultPosition 在 safeInsets 存在时自动叠加四边安全留边', () => {
    const vpWithInsets: ShellViewport = {
      width: 1200,
      height: 800,
      safeInsets: { top: 44, right: 16, bottom: 34, left: 12 },
    };
    const size = frameSize(vpWithInsets, false);

    // 左上越界钳位到 EDGE_MARGIN + left/top
    expect(clampPosition({ x: -100, y: -100 }, vpWithInsets, size)).toEqual({
      x: EDGE_MARGIN + 12,
      y: EDGE_MARGIN + 44,
    });

    // 右下越界钳位到 width/height - size - (EDGE_MARGIN + right/bottom)
    expect(clampPosition({ x: 9999, y: 9999 }, vpWithInsets, size)).toEqual({
      x: 1200 - EXPANDED_SIZE.width - (EDGE_MARGIN + 16),
      y: 800 - EXPANDED_SIZE.height - (EDGE_MARGIN + 34),
    });

    const defPos = defaultPosition(vpWithInsets, size);
    expect(defPos.x).toBe(1200 - EXPANDED_SIZE.width - (EDGE_MARGIN + 16));
  });

  it('createShell 为宿主 frame 标记 data-tt-mobile-surface="free-window"，且左右停靠叠加 safeInsets', () => {
    const props: Record<string, string> = {};
    const attrs: Record<string, string> = {};
    const frame: FrameLike & { setAttribute(k: string, v: string): void } = {
      style: {
        setProperty: (k, v) => {
          props[k] = v;
        },
        removeProperty: k => {
          const old = props[k] ?? '';
          delete props[k];
          return old;
        },
      },
      setAttribute: (k, v) => {
        attrs[k] = v;
      },
    };

    const vp: ShellViewport = {
      width: 1200,
      height: 800,
      safeInsets: { top: 40, right: 20, bottom: 30, left: 15 },
    };

    const shell = createShell({
      frame,
      storage: null,
      viewport: () => vp,
    });

    expect(attrs['data-tt-mobile-surface']).toBe('free-window');

    shell.dockToRight();
    expect(props.right).toBe(`${EDGE_MARGIN + 20}px`);
    expect(props.top).toBe(`${EDGE_MARGIN + 40}px`);
    expect(props.height).toBe(`${800 - (EDGE_MARGIN + 40) - (EDGE_MARGIN + 30)}px`);

    shell.dockToLeft();
    expect(props.left).toBe(`${EDGE_MARGIN + 15}px`);
    expect(props.top).toBe(`${EDGE_MARGIN + 40}px`);
    shell.destroy();
  });

  it('defaultShellDeps 优先从 ttHostBridge.layout 读取快照并订阅 layout 变更', () => {
    let currentSnap = makeSnapshot({
      viewport: { left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700 },
      safeInsets: { top: 24, right: 10, bottom: 20, left: 10 },
      ime: { activeSurface: null, kind: null, bottom: 0, viewportBottomInset: 180, keyboardOffset: 160 },
    });
    let subscriber: ((s: LayoutSnapshot) => void) | null = null;
    const unsubSpy = vi.fn();

    (window as unknown as Record<string, unknown>).__TAURITAVERN__ = {
      abiVersion: 1,
      api: {
        layout: {
          snapshot: () => currentSnap,
          subscribe: (fn: (s: LayoutSnapshot) => void) => {
            subscriber = fn;
            return unsubSpy;
          },
        },
      },
    };

    const deps = defaultShellDeps();
    const vp = deps.viewport();
    expect(vp).toEqual({
      width: 1000,
      height: 700,
      safeInsets: { top: 24, right: 10, bottom: 20, left: 10 },
      keyboardOffset: 160,
    });

    const onResizeTrigger = vi.fn();
    const off = deps.onResize!(onResizeTrigger);
    expect(subscriber).not.toBeNull();

    subscriber!(currentSnap);
    expect(onResizeTrigger).toHaveBeenCalledTimes(1);

    off();
    expect(unsubSpy).toHaveBeenCalledTimes(1);
  });
});

describe('PKG-B: modalHost.ts 与 pdaState.ts 多端安全区契约', () => {
  afterEach(() => {
    destroyModalHost();
    destroyHudHost();
  });

  it('initModalHost 与 initHudHost 自动标记 data-tt-mobile-surface 与安全区 CSS 变量', () => {
    const hadDoc = typeof document !== 'undefined';
    const elements = new Map<string, Record<string, unknown>>();
    if (!hadDoc) {
      const makeFakeEl = (tag: string) => {
        const attrs = new Map<string, string>();
        const styleObj: Record<string, unknown> = {
          display: '',
          zIndex: '',
          paddingTop: '',
          paddingBottom: '',
          cssText: '',
          setProperty: (k: string, v: string) => {
            styleObj[k] = v;
          },
        };
        const el: Record<string, unknown> = {
          id: '',
          tagName: tag.toUpperCase(),
          style: styleObj,
          dataset: {} as Record<string, string>,
          setAttribute: (k: string, v: string) => attrs.set(k, v),
          getAttribute: (k: string) =>
            k === 'data-tt-mobile-surface'
              ? (el.dataset as Record<string, string>).ttMobileSurface ?? attrs.get(k) ?? null
              : attrs.get(k) ?? null,
          appendChild: (child: Record<string, unknown>) => {
            if (typeof child.id === 'string' && child.id) {
              elements.set(child.id, child);
            }
          },
          querySelector: (sel: string) => {
            if (sel.startsWith('#')) return elements.get(sel.slice(1)) ?? null;
            return null;
          },
          remove: () => {
            if (typeof el.id === 'string') elements.delete(el.id);
          },
        };
        return el;
      };
      (globalThis as Record<string, unknown>).document = {
        getElementById: (id: string) => elements.get(id) ?? null,
        querySelector: () => null,
        createElement: (tag: string) => makeFakeEl(tag),
        body: {
          appendChild: (el: Record<string, unknown>) => {
            if (typeof el.id === 'string' && el.id) {
              elements.set(el.id, el);
            }
          },
        },
      };
    }

    try {
      const modalRoot = initModalHost();
      expect(modalRoot).not.toBeNull();
      const overlayEl = document.getElementById(OVERLAY_HOST_ID);
      expect(overlayEl).not.toBeNull();
      expect(overlayEl?.getAttribute('data-tt-mobile-surface')).toBe('backdrop');
      expect(overlayEl?.style.paddingTop).toContain('--tt-inset-top');
      expect(overlayEl?.style.paddingBottom).toContain('--tt-viewport-bottom-inset');

      initHudHost();
      const hudEl = document.getElementById(HUD_HOST_ID);
      expect(hudEl).not.toBeNull();
      expect(hudEl?.getAttribute('data-tt-mobile-surface')).toBe('free-window');
    } finally {
      destroyModalHost();
      destroyHudHost();
      if (!hadDoc) {
        delete (globalThis as Record<string, unknown>).document;
      }
    }
  });

  it('pdaState.ts 在 safeInsets 下正确叠加四周留边与磁吸贴边', () => {
    const vp: PdaViewport = {
      width: 390,
      height: 844,
      safeInsets: { top: 47, right: 10, bottom: 34, left: 14 },
    };

    const defCollapsed = defaultPdaPosition(vp, true);
    expect(defCollapsed.x).toBe(390 - PDA_COLLAPSED_SIZE.width - (PDA_EDGE_MARGIN + 10));

    const clampedLow = clampPdaPosition({ x: -20, y: -20 }, vp, true);
    expect(clampedLow).toEqual({
      x: PDA_EDGE_MARGIN + 14,
      y: PDA_EDGE_MARGIN + 47,
    });

    const clampedHigh = clampPdaPosition({ x: 9999, y: 9999 }, vp, false);
    expect(clampedHigh).toEqual({
      x: 390 - PDA_EXPANDED_SIZE.width - (PDA_EDGE_MARGIN + 10),
      y: 844 - PDA_EXPANDED_SIZE.height - (PDA_EDGE_MARGIN + 34),
    });

    const snapLeft = calculateSnap({ x: 30, y: 200 }, vp, true);
    expect(snapLeft.dockSide).toBe('left');
    expect(snapLeft.x).toBe(PDA_EDGE_MARGIN + 14);

    const pda = createPdaShell({
      storage: null,
      viewport: () => vp,
    });
    expect(pda.state.x).toBe(390 - PDA_COLLAPSED_SIZE.width - (PDA_EDGE_MARGIN + 10));
    pda.snapToEdge('left');
    expect(pda.state.x).toBe(PDA_EDGE_MARGIN + 14);
    pda.destroy();
  });
});
