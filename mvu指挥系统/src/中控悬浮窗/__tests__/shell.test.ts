/**
 * shell 测试（RAC-ENTRY-01）：iframe 样式应用 / pointer 拖拽几何 / 收起展开 / localStorage round-trip /
 * 初始位置不遮挡（右侧居中）/ 窄屏贴边。frame 与 storage 均为最小假对象，无 DOM 依赖。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  clampPosition,
  COLLAPSED_SIZE,
  CONTENT_MIN_WIDTH,
  createShell,
  defaultPosition,
  EDGE_MARGIN,
  EXPANDED_SIZE,
  frameSize,
  loadShellState,
  parseShellState,
  saveShellState,
  SHELL_STORAGE_KEY,
  type FrameLike,
  type StorageLike,
  type Viewport,
} from '../host/shell';

const DESKTOP: Viewport = { width: 1600, height: 900 };
const PHONE: Viewport = { width: 390, height: 844 };

function fakeFrame() {
  const props: Record<string, { value: string; priority: string }> = {};
  const frame: FrameLike = {
    style: {
      setProperty: vi.fn((name: string, value: string, priority = '') => {
        props[name] = { value, priority };
      }),
      removeProperty: vi.fn((name: string) => {
        const old = props[name]?.value ?? '';
        delete props[name];
        return old;
      }),
    },
  };
  return { frame, props, get: (name: string) => props[name]?.value };
}

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: StorageLike = {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
  return { storage, map };
}

describe('纯几何', () => {
  it('默认位置：右侧垂直居中，留边距（不遮挡顶栏 / 中央聊天流 / 底部输入区）', () => {
    const size = frameSize(DESKTOP, false);
    expect(size).toEqual(EXPANDED_SIZE);
    const pos = defaultPosition(DESKTOP, size);
    expect(pos.x).toBe(DESKTOP.width - size.width - EDGE_MARGIN);
    expect(pos.y).toBe(Math.round((DESKTOP.height - size.height) / 2));
    expect(pos.x + size.width).toBeLessThanOrEqual(DESKTOP.width);
  });

  it('钳位：越界坐标被压回视口内', () => {
    const size = frameSize(DESKTOP, false);
    expect(clampPosition({ x: -500, y: -500 }, DESKTOP, size)).toEqual({ x: EDGE_MARGIN, y: EDGE_MARGIN });
    expect(clampPosition({ x: 99999, y: 99999 }, DESKTOP, size)).toEqual({
      x: DESKTOP.width - size.width - EDGE_MARGIN,
      y: DESKTOP.height - size.height - EDGE_MARGIN,
    });
  });

  it('收起态：iframe 宽度 ≥ 标题栏最小可用宽度（200），「展开」按钮不被裁切（F-QA-02 / D-RAC-FLOAT-MOBILE-01）', () => {
    expect(CONTENT_MIN_WIDTH).toBe(200);
    expect(COLLAPSED_SIZE.width).toBeGreaterThanOrEqual(CONTENT_MIN_WIDTH);
    // 桌面与常见手机视口下收起态不被窄屏钳位压窄到标题栏可用宽度以下
    expect(frameSize(DESKTOP, true).width).toBeGreaterThanOrEqual(CONTENT_MIN_WIDTH);
    expect(frameSize(PHONE, true).width).toBeGreaterThanOrEqual(CONTENT_MIN_WIDTH);
    // 极窄视口仍保持“不超出视口留边”的钳位语义（上限优先于下限）
    const tiny: Viewport = { width: 200, height: 400 };
    expect(frameSize(tiny, true).width).toBe(tiny.width - EDGE_MARGIN * 2);
    expect(frameSize(tiny, false).width).toBe(tiny.width - EDGE_MARGIN * 2);
  });

  it('窄屏宽度 = clamp(200, 视口宽/2, 视口宽-16)：390→200、320→200、480→240；展开与收起同宽', () => {
    const cases: Array<[Viewport, number]> = [
      [{ width: 390, height: 844 }, 200],
      [{ width: 320, height: 568 }, 200],
      [{ width: 480, height: 800 }, 240],
    ];
    for (const [vp, width] of cases) {
      expect(frameSize(vp, false).width, `${vp.width} 展开`).toBe(width);
      expect(frameSize(vp, true).width, `${vp.width} 收起`).toBe(width);
      expect(frameSize(vp, true).height).toBe(COLLAPSED_SIZE.height);
    }
  });

  it('桌面（≥640）：1536×647 展开 400 / 收起 288 不变，高度按留边钳位', () => {
    const laptop: Viewport = { width: 1536, height: 647 };
    expect(frameSize(laptop, false)).toEqual({ width: EXPANDED_SIZE.width, height: laptop.height - EDGE_MARGIN * 2 });
    expect(frameSize(laptop, true)).toEqual(COLLAPSED_SIZE);
    expect(frameSize(DESKTOP, false)).toEqual(EXPANDED_SIZE);
    expect(frameSize({ width: 640, height: 900 }, false).width).toBe(EXPANDED_SIZE.width);
    expect(frameSize({ width: 639, height: 900 }, false).width).toBe(320);
  });

  it('窄屏：展开态宽度减半、高度 ≤ 70% 视口，位置仍贴右边', () => {
    const size = frameSize(PHONE, false);
    expect(size.width).toBe(200);
    expect(size.height).toBeLessThanOrEqual(Math.floor(PHONE.height * 0.7));
    expect(clampPosition({ x: 0, y: 100 }, PHONE, size).x).toBe(PHONE.width - size.width - EDGE_MARGIN);
    const collapsed = frameSize(PHONE, true);
    expect(collapsed).toEqual({ width: 200, height: COLLAPSED_SIZE.height });
    expect(clampPosition({ x: 0, y: 100 }, PHONE, collapsed).x).toBe(PHONE.width - collapsed.width - EDGE_MARGIN);
    expect(defaultPosition(PHONE, size).x + size.width + EDGE_MARGIN).toBe(PHONE.width);
  });
});

describe('持久化 round-trip', () => {
  it('save → load 保真；键名带 tavernweave.floating. 前缀', () => {
    const { storage, map } = fakeStorage();
    saveShellState(storage, { x: 120, y: 240, collapsed: true });
    expect([...map.keys()]).toEqual([SHELL_STORAGE_KEY]);
    expect(SHELL_STORAGE_KEY.startsWith('tavernweave.floating.')).toBe(true);
    expect(loadShellState(storage)).toEqual({ x: 120, y: 240, collapsed: true });
  });

  it('损坏 / 缺失 / 类型错误的存储值安全降级', () => {
    expect(parseShellState(null)).toBeNull();
    expect(parseShellState('{not json')).toBeNull();
    expect(parseShellState('42')).toBeNull();
    expect(parseShellState(JSON.stringify({ x: 'a', y: NaN, collapsed: 'yes' }))).toEqual({});
    expect(loadShellState(null)).toBeNull();
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadShellState(throwing)).toBeNull();
    expect(() => saveShellState(throwing, { x: 0, y: 0, collapsed: false })).not.toThrow();
  });
});

describe('createShell', () => {
  it('iframe 可见化：覆盖 Helper 的内联 display:none（!important）并设 fixed 悬浮样式与初始几何', () => {
    const f = fakeFrame();
    const shell = createShell({ frame: f.frame, storage: null, viewport: () => DESKTOP });
    expect(f.props.display).toEqual({ value: 'block', priority: 'important' });
    expect(f.get('position')).toBe('fixed');
    expect(f.get('left')).toBe(`${DESKTOP.width - EXPANDED_SIZE.width - EDGE_MARGIN}px`);
    expect(f.get('top')).toBe(`${Math.round((DESKTOP.height - EXPANDED_SIZE.height) / 2)}px`);
    expect(f.get('width')).toBe(`${EXPANDED_SIZE.width}px`);
    expect(f.get('height')).toBe(`${EXPANDED_SIZE.height}px`);
    expect(shell.state.collapsed).toBe(false);
  });

  it('frame 为 null（非 iframe）时退化为纯状态机，不抛', () => {
    const shell = createShell({ frame: null, storage: null, viewport: () => DESKTOP });
    expect(() => {
      shell.toggle();
      shell.dragStart(0, 0);
      shell.dragMove(10, 10);
      shell.dragEnd();
      shell.destroy();
    }).not.toThrow();
  });

  it('pointer 拖拽：按 screenX/Y 增量移动，越界钳位，dragEnd 才持久化', () => {
    const f = fakeFrame();
    const { storage, map } = fakeStorage();
    const shell = createShell({ frame: f.frame, storage, viewport: () => DESKTOP });
    const { x: x0, y: y0 } = shell.state;
    shell.dragMove(999, 999); // 未 dragStart → 忽略
    expect(shell.state.x).toBe(x0);
    shell.dragStart(1000, 500);
    shell.dragMove(900, 450);
    expect(shell.state).toMatchObject({ x: x0 - 100, y: y0 - 50 });
    expect(f.get('left')).toBe(`${x0 - 100}px`);
    expect(map.size).toBe(0);
    shell.dragMove(-5000, -5000);
    expect(shell.state).toMatchObject({ x: EDGE_MARGIN, y: EDGE_MARGIN });
    shell.dragEnd();
    expect(JSON.parse(map.get(SHELL_STORAGE_KEY)!)).toEqual({ x: EDGE_MARGIN, y: EDGE_MARGIN, collapsed: false });
    shell.dragEnd(); // 重复 dragEnd 无副作用
    expect(map.size).toBe(1);
  });

  it('收起 / 展开：尺寸切换、持久化、setCollapsed 幂等', () => {
    const f = fakeFrame();
    const { storage, map } = fakeStorage();
    const shell = createShell({ frame: f.frame, storage, viewport: () => DESKTOP });
    shell.toggle();
    expect(shell.state.collapsed).toBe(true);
    expect(f.get('width')).toBe(`${COLLAPSED_SIZE.width}px`);
    expect(f.get('height')).toBe(`${COLLAPSED_SIZE.height}px`);
    expect(JSON.parse(map.get(SHELL_STORAGE_KEY)!).collapsed).toBe(true);
    const calls = (f.frame.style.setProperty as ReturnType<typeof vi.fn>).mock.calls.length;
    shell.setCollapsed(true);
    expect((f.frame.style.setProperty as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    shell.toggle();
    expect(shell.state.collapsed).toBe(false);
    expect(f.get('height')).toBe(`${EXPANDED_SIZE.height}px`);
  });

  it('位置与收起态 round-trip：新壳从存储恢复，且越界值被钳位', () => {
    const { storage } = fakeStorage({ [SHELL_STORAGE_KEY]: JSON.stringify({ x: 300, y: 200, collapsed: true }) });
    const a = createShell({ frame: fakeFrame().frame, storage, viewport: () => DESKTOP });
    expect(a.state).toMatchObject({ x: 300, y: 200, collapsed: true });

    const { storage: s2 } = fakeStorage({
      [SHELL_STORAGE_KEY]: JSON.stringify({ x: 5000, y: 5000, collapsed: false }),
    });
    const b = createShell({ frame: fakeFrame().frame, storage: s2, viewport: () => DESKTOP });
    expect(b.state).toMatchObject({
      x: DESKTOP.width - EXPANDED_SIZE.width - EDGE_MARGIN,
      y: DESKTOP.height - EXPANDED_SIZE.height - EDGE_MARGIN,
    });
  });

  it('旧版收起宽度（168）下保存的靠右位置，在新宽度下恢复时被钳回视口内', () => {
    const legacyWidth = 168;
    const legacyX = DESKTOP.width - legacyWidth - EDGE_MARGIN;
    const { storage } = fakeStorage({
      [SHELL_STORAGE_KEY]: JSON.stringify({ x: legacyX, y: 200, collapsed: true }),
    });
    const f = fakeFrame();
    const shell = createShell({ frame: f.frame, storage, viewport: () => DESKTOP });
    expect(shell.state.collapsed).toBe(true);
    expect(shell.state.x).toBe(DESKTOP.width - COLLAPSED_SIZE.width - EDGE_MARGIN);
    expect(shell.state.x + COLLAPSED_SIZE.width + EDGE_MARGIN).toBeLessThanOrEqual(DESKTOP.width);
    expect(f.get('width')).toBe(`${COLLAPSED_SIZE.width}px`);
    // 展开时同样重新钳位，不会因收起态坐标让展开态越界
    shell.toggle();
    expect(shell.state.x + EXPANDED_SIZE.width + EDGE_MARGIN).toBeLessThanOrEqual(DESKTOP.width);
  });

  it('视口变化：resize 回调触发 relayout 重新钳位；destroy 注销订阅', () => {
    let viewport = DESKTOP;
    let cb: (() => void) | null = null;
    const off = vi.fn();
    const f = fakeFrame();
    const shell = createShell({
      frame: f.frame,
      storage: null,
      viewport: () => viewport,
      onResize: fn => {
        cb = fn;
        return off;
      },
    });
    viewport = PHONE;
    cb!();
    expect(f.get('width')).toBe('200px');
    expect(shell.state.x).toBe(PHONE.width - 200 - EDGE_MARGIN);
    shell.destroy();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('setModalOverlay：记录模态态状态，保持侧栏停靠原貌（340px，不强行扩张父容器）', () => {
    const f = fakeFrame();
    const shell = createShell({ frame: f.frame, storage: null, viewport: () => DESKTOP });
    shell.dockToRight();
    expect(f.get('width')).toBe('340px');
    expect(f.get('z-index')).toBe('9990');

    shell.setModalOverlay(true);
    expect(shell.state.modalOverlay).toBe(true);
    // 侧栏本身依然保持 340px 停靠尺寸，绝不因弹窗而暴胀为 100vw
    expect(f.get('width')).toBe('340px');
    expect(f.get('z-index')).toBe('9990');

    shell.setModalOverlay(false);
    expect(shell.state.modalOverlay).toBe(false);
    expect(f.get('width')).toBe('340px');
  });
});
