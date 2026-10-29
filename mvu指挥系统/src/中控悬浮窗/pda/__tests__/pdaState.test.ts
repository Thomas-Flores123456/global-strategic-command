/**
 * pdaState.test.ts —— 战地手持板（PDA）状态机与存储契约单元测试
 *
 * 覆盖：
 * 1. 纯函数几何计算与常量定义；
 * 2. 视口越界拦截（clampPdaPosition）边界条件；
 * 3. 贴边磁吸算法（calculateSnap）边缘判定；
 * 4. LocalStorage 持久化、反序列化与脏数据容错；
 * 5. 响应式管理状态机（createPdaShell）操作、拖拽与直达高亮。
 */

import { describe, expect, it, vi } from 'vitest';
import {
  calculateSnap,
  clampPdaPosition,
  createPdaShell,
  defaultPdaDeps,
  defaultPdaPosition,
  loadPdaState,
  parsePdaState,
  pdaFrameSize,
  PDA_COLLAPSED_SIZE,
  PDA_EDGE_MARGIN,
  PDA_EXPANDED_SIZE,
  PDA_SNAP_THRESHOLD,
  PDA_STORAGE_KEY,
  savePdaState,
  type PdaShellDeps,
  type PdaState,
  type Position,
  type StorageLike,
  type Viewport,
} from '../pdaState';

const VIEWPORT_DESKTOP: Viewport = { width: 1440, height: 900 };
const VIEWPORT_MOBILE: Viewport = { width: 390, height: 844 };

function createFakeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  const storage: StorageLike = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
  return { storage, map };
}

describe('PDA-SHELL-01: 常量契约与纯函数几何', () => {
  it('基础常量满足设计案契约', () => {
    expect(PDA_EXPANDED_SIZE).toEqual({ width: 320, height: 440 });
    expect(PDA_COLLAPSED_SIZE).toEqual({ width: 44, height: 44 });
    expect(PDA_EDGE_MARGIN).toBe(12);
    expect(PDA_SNAP_THRESHOLD).toBe(60);
    expect(PDA_STORAGE_KEY).toBe('tavernweave.pda.state');
  });

  it('pdaFrameSize 按收纳/展开形态返回正确物理尺寸', () => {
    expect(pdaFrameSize(true)).toEqual({ width: 44, height: 44 });
    expect(pdaFrameSize(false)).toEqual({ width: 320, height: 440 });
  });

  it('defaultPdaPosition 生成右侧居中、保留 12px 边缘间隙的初始坐标', () => {
    const collapsedPos = defaultPdaPosition(VIEWPORT_DESKTOP, true);
    expect(collapsedPos.x).toBe(VIEWPORT_DESKTOP.width - PDA_COLLAPSED_SIZE.width - PDA_EDGE_MARGIN);
    expect(collapsedPos.y).toBe(Math.round((VIEWPORT_DESKTOP.height - PDA_COLLAPSED_SIZE.height) / 2));

    const expandedPos = defaultPdaPosition(VIEWPORT_DESKTOP, false);
    expect(expandedPos.x).toBe(VIEWPORT_DESKTOP.width - PDA_EXPANDED_SIZE.width - PDA_EDGE_MARGIN);
    expect(expandedPos.y).toBe(Math.round((VIEWPORT_DESKTOP.height - PDA_EXPANDED_SIZE.height) / 2));
  });

  it('clampPdaPosition 视口边界防御截断：超出四周全部压回 12px 边界内', () => {
    const size = pdaFrameSize(true);
    // 负坐标截断到左上间隙 (12, 12)
    expect(clampPdaPosition({ x: -100, y: -200 }, VIEWPORT_DESKTOP, true)).toEqual({
      x: PDA_EDGE_MARGIN,
      y: PDA_EDGE_MARGIN,
    });

    // 超大坐标截断到右下留边位置
    expect(clampPdaPosition({ x: 99999, y: 88888 }, VIEWPORT_DESKTOP, true)).toEqual({
      x: VIEWPORT_DESKTOP.width - size.width - PDA_EDGE_MARGIN,
      y: VIEWPORT_DESKTOP.height - size.height - PDA_EDGE_MARGIN,
    });

    // 展开态边界截断同样准确
    const expSize = pdaFrameSize(false);
    expect(clampPdaPosition({ x: 99999, y: 88888 }, VIEWPORT_DESKTOP, false)).toEqual({
      x: VIEWPORT_DESKTOP.width - expSize.width - PDA_EDGE_MARGIN,
      y: VIEWPORT_DESKTOP.height - expSize.height - PDA_EDGE_MARGIN,
    });
  });

  it('clampPdaPosition 容错处理：NaN / Infinity 坐标安全降级为边距', () => {
    const clamped = clampPdaPosition({ x: NaN, y: Infinity }, VIEWPORT_DESKTOP, true);
    expect(clamped.x).toBe(PDA_EDGE_MARGIN);
    expect(clamped.y).toBe(PDA_EDGE_MARGIN);
  });
});

describe('PDA-SHELL-01: 边缘磁吸算法 (calculateSnap)', () => {
  it('距离左边缘 < 60px 时触发左贴边吸附 (dockSide: left)', () => {
    // x = 40 距离左边缘 40px (< 60px)
    const snap = calculateSnap({ x: 40, y: 200 }, VIEWPORT_DESKTOP, true);
    expect(snap.x).toBe(PDA_EDGE_MARGIN);
    expect(snap.y).toBe(200);
    expect(snap.dockSide).toBe('left');
  });

  it('距离右边缘 < 60px 时触发右贴边吸附 (dockSide: right)', () => {
    const size = pdaFrameSize(true);
    // 右边距为 30px (< 60px)
    const xNearRight = VIEWPORT_DESKTOP.width - size.width - 30;
    const snap = calculateSnap({ x: xNearRight, y: 350 }, VIEWPORT_DESKTOP, true);
    expect(snap.x).toBe(VIEWPORT_DESKTOP.width - size.width - PDA_EDGE_MARGIN);
    expect(snap.y).toBe(350);
    expect(snap.dockSide).toBe('right');
  });

  it('中间自由区 (>= 60px) 保持自由位置 (dockSide: free)', () => {
    const snap = calculateSnap({ x: 500, y: 300 }, VIEWPORT_DESKTOP, true);
    expect(snap.x).toBe(500);
    expect(snap.y).toBe(300);
    expect(snap.dockSide).toBe('free');
  });

  it('展开态下磁吸阈值与贴边坐标计算正确', () => {
    const expSize = pdaFrameSize(false);
    // 展开态靠近左边
    const leftSnap = calculateSnap({ x: 30, y: 100 }, VIEWPORT_DESKTOP, false);
    expect(leftSnap.x).toBe(PDA_EDGE_MARGIN);
    expect(leftSnap.dockSide).toBe('left');

    // 展开态靠近右边
    const rightNearX = VIEWPORT_DESKTOP.width - expSize.width - 25;
    const rightSnap = calculateSnap({ x: rightNearX, y: 100 }, VIEWPORT_DESKTOP, false);
    expect(rightSnap.x).toBe(VIEWPORT_DESKTOP.width - expSize.width - PDA_EDGE_MARGIN);
    expect(rightSnap.dockSide).toBe('right');
  });

  it('狭窄视口同时靠近双边时由更近的一侧吸附', () => {
    const tinyVp: Viewport = { width: 100, height: 300 };
    // size 44, max x = 100 - 44 - 12 = 44. pos.x = 15, leftDist = 15, rightDist = 100 - (15 + 44) = 41
    const snap = calculateSnap({ x: 15, y: 50 }, tinyVp, true);
    expect(snap.dockSide).toBe('left');
    expect(snap.x).toBe(PDA_EDGE_MARGIN);
  });
});

describe('PDA-SHELL-01: 本地存储与反序列化容错', () => {
  it('savePdaState 与 loadPdaState 完整保真 round-trip', () => {
    const { storage, map } = createFakeStorage();
    const testState: PdaState = {
      x: 350,
      y: 180,
      collapsed: false,
      pinned: true,
      dockSide: 'left',
      activeTab: 'cash',
      hidden: false,
      readEventIds: ['evt-001', 'evt-002'],
      highlightEventId: 'evt-001',
    };

    savePdaState(storage, testState);
    expect([...map.keys()]).toEqual([PDA_STORAGE_KEY]);

    const loaded = loadPdaState(storage);
    expect(loaded).toEqual({
      x: 350,
      y: 180,
      collapsed: false,
      pinned: true,
      dockSide: 'left',
      activeTab: 'cash',
      hidden: false,
      readEventIds: ['evt-001', 'evt-002'],
    });

    // 校验 highlightEventId 作为瞬态不被持久化
    const rawSaved = JSON.parse(map.get(PDA_STORAGE_KEY)!);
    expect(rawSaved.highlightEventId).toBeUndefined();
  });

  it('损坏 JSON、null、非法数据类型优雅拦截与降级', () => {
    expect(parsePdaState(null)).toBeNull();
    expect(parsePdaState('')).toBeNull();
    expect(parsePdaState('{ corrupt json')).toBeNull();
    expect(parsePdaState('12345')).toBeNull();
    expect(parsePdaState('[]')).toBeNull();

    // 脏字段过滤：只保留合法字段
    const dirty = JSON.stringify({
      x: 'not-a-number',
      y: 200,
      collapsed: 'true', // 不是 boolean
      pinned: false,
      dockSide: 'invalid-dock',
      activeTab: 'unknown-tab',
      hidden: true,
      readEventIds: ['valid-id', 42, null, 'second-valid'],
      maliciousExtraField: 'bad',
    });
    const parsed = parsePdaState(dirty);
    expect(parsed).toEqual({
      y: 200,
      pinned: false,
      hidden: true,
      readEventIds: ['valid-id', 'second-valid'],
    });

    expect(loadPdaState(null)).toBeNull();
    expect(loadPdaState(undefined)).toBeNull();
  });

  it('Storage 抛出异常时不向外扩散（隐私模式防御）', () => {
    const throwingStorage: StorageLike = {
      getItem: () => {
        throw new Error('QuotaExceeded / AccessDenied');
      },
      setItem: () => {
        throw new Error('QuotaExceeded / AccessDenied');
      },
    };

    expect(loadPdaState(throwingStorage)).toBeNull();
    expect(() =>
      savePdaState(throwingStorage, {
        x: 0,
        y: 0,
        collapsed: true,
        pinned: false,
        dockSide: 'free',
        activeTab: 'events',
        hidden: false,
        readEventIds: [],
        highlightEventId: null,
      }),
    ).not.toThrow();
  });
});

describe('PDA-SHELL-01: createPdaShell 响应式状态管理', () => {
  it('默认构造初始化为收纳态、靠右贴边、无已读、默认 events 页签', () => {
    const deps: PdaShellDeps = {
      storage: null,
      viewport: () => VIEWPORT_DESKTOP,
    };
    const pda = createPdaShell(deps);

    expect(pda.state.collapsed).toBe(true);
    expect(pda.state.pinned).toBe(false);
    expect(pda.state.dockSide).toBe('right');
    expect(pda.state.activeTab).toBe('events');
    expect(pda.state.hidden).toBe(false);
    expect(pda.state.readEventIds).toEqual([]);
    expect(pda.state.highlightEventId).toBeNull();
    expect(pda.size()).toEqual(PDA_COLLAPSED_SIZE);
  });

  it('从 LocalStorage 恢复状态并对越界坐标进行钳位', () => {
    const { storage } = createFakeStorage({
      [PDA_STORAGE_KEY]: JSON.stringify({
        x: 99999,
        y: 99999,
        collapsed: false,
        pinned: true,
        dockSide: 'left',
        activeTab: 'cash',
        readEventIds: ['evt-old'],
      }),
    });

    const pda = createPdaShell({
      storage,
      viewport: () => VIEWPORT_DESKTOP,
    });

    expect(pda.state.collapsed).toBe(false);
    expect(pda.state.pinned).toBe(true);
    expect(pda.state.activeTab).toBe('cash');
    expect(pda.state.readEventIds).toEqual(['evt-old']);
    // dockSide 为 left，初始化对齐到左侧边缘
    expect(pda.state.x).toBe(PDA_EDGE_MARGIN);
    expect(pda.state.y).toBe(VIEWPORT_DESKTOP.height - PDA_EXPANDED_SIZE.height - PDA_EDGE_MARGIN);
  });

  it('折叠与展开状态切换、自动重新计算尺寸并持久化', () => {
    const { storage, map } = createFakeStorage();
    const pda = createPdaShell({
      storage,
      viewport: () => VIEWPORT_DESKTOP,
    });

    expect(pda.state.collapsed).toBe(true);
    pda.toggleCollapse();
    expect(pda.state.collapsed).toBe(false);
    expect(pda.size()).toEqual(PDA_EXPANDED_SIZE);

    const saved1 = JSON.parse(map.get(PDA_STORAGE_KEY)!);
    expect(saved1.collapsed).toBe(false);

    pda.setCollapsed(false); // 幂等调用
    pda.setCollapsed(true);
    expect(pda.state.collapsed).toBe(true);
    expect(pda.size()).toEqual(PDA_COLLAPSED_SIZE);
  });

  it('页签切换与固定（pinned）状态变更', () => {
    const { storage, map } = createFakeStorage();
    const pda = createPdaShell({
      storage,
      viewport: () => VIEWPORT_DESKTOP,
    });

    pda.setActiveTab('intel');
    expect(pda.state.activeTab).toBe('intel');
    pda.setPinned(true);
    expect(pda.state.pinned).toBe(true);

    const saved = JSON.parse(map.get(PDA_STORAGE_KEY)!);
    expect(saved.activeTab).toBe('intel');
    expect(saved.pinned).toBe(true);
  });

  it('事件已读记录管理 (markEventRead / markAllEventsRead) 幂等去重', () => {
    const { storage, map } = createFakeStorage();
    const pda = createPdaShell({
      storage,
      viewport: () => VIEWPORT_DESKTOP,
    });

    pda.markEventRead('e-1');
    pda.markEventRead('e-1'); // 重复添加无副作用
    expect(pda.state.readEventIds).toEqual(['e-1']);

    pda.markAllEventsRead(['e-1', 'e-2', 'e-3']);
    expect(pda.state.readEventIds).toEqual(['e-1', 'e-2', 'e-3']);

    const saved = JSON.parse(map.get(PDA_STORAGE_KEY)!);
    expect(saved.readEventIds).toEqual(['e-1', 'e-2', 'e-3']);
  });

  it('直达高亮聚焦 (focusEvent) 自动展开、取消隐藏、切换页签并设置高亮', () => {
    const pda = createPdaShell({
      storage: null,
      viewport: () => VIEWPORT_DESKTOP,
    });

    pda.setCollapsed(true);
    pda.setHidden(true);
    pda.focusEvent('evt-alert-99', 'quests');

    expect(pda.state.collapsed).toBe(false);
    expect(pda.state.hidden).toBe(false);
    expect(pda.state.activeTab).toBe('quests');
    expect(pda.state.highlightEventId).toBe('evt-alert-99');

    pda.clearHighlight();
    expect(pda.state.highlightEventId).toBeNull();
  });

  it('拖拽位移与贴边吸附：非固定状态下更新坐标并在 dragEnd 时磁吸', () => {
    const { storage, map } = createFakeStorage();
    const pda = createPdaShell({
      storage,
      viewport: () => VIEWPORT_DESKTOP,
    });

    const initX = pda.state.x;
    const initY = pda.state.y;

    // 未 dragStart 前直接 dragMove 被忽略
    pda.dragMove(100, 100);
    expect(pda.state.x).toBe(initX);

    // 正常拖拽
    pda.dragStart(500, 300);
    pda.dragMove(450, 250); // delta: -50, -50
    expect(pda.state.x).toBe(initX - 50);
    expect(pda.state.y).toBe(initY - 50);

    // 拖拽过程中不持久化
    expect(map.size).toBe(0);

    // 拖拽到靠近左边 (< 60px)
    pda.dragMove(500 - (initX - 30), 300);
    expect(pda.state.x).toBe(30);

    // dragEnd 触发吸附到左边缘
    pda.dragEnd();
    expect(pda.state.x).toBe(PDA_EDGE_MARGIN);
    expect(pda.state.dockSide).toBe('left');
    expect(map.size).toBe(1);
  });

  it('固定锁 (pinned) 激活时拖拽被安全拦截', () => {
    const pda = createPdaShell({
      storage: null,
      viewport: () => VIEWPORT_DESKTOP,
    });

    pda.setPinned(true);
    const originX = pda.state.x;
    const originY = pda.state.y;

    pda.dragStart(100, 100);
    pda.dragMove(200, 200);
    pda.dragEnd();

    expect(pda.state.x).toBe(originX);
    expect(pda.state.y).toBe(originY);
  });

  it('setPosition、snapToEdge 与 resetPosition 行为符合预期', () => {
    const pda = createPdaShell({
      storage: null,
      viewport: () => VIEWPORT_DESKTOP,
    });

    pda.setPosition({ x: 500, y: 300 });
    expect(pda.state.x).toBe(500);
    expect(pda.state.dockSide).toBe('free');

    pda.snapToEdge('left');
    expect(pda.state.x).toBe(PDA_EDGE_MARGIN);
    expect(pda.state.dockSide).toBe('left');

    pda.snapToEdge('right');
    const size = pda.size();
    expect(pda.state.x).toBe(VIEWPORT_DESKTOP.width - size.width - PDA_EDGE_MARGIN);
    expect(pda.state.dockSide).toBe('right');

    pda.setHidden(true);
    pda.resetPosition();
    expect(pda.state.hidden).toBe(false);
    expect(pda.state.dockSide).toBe('right');
    expect(pda.state.x).toBe(VIEWPORT_DESKTOP.width - size.width - PDA_EDGE_MARGIN);
  });

  it('onResize 订阅能在视口变化时触发 relayout，destroy 正常注销', () => {
    let curVp = VIEWPORT_DESKTOP;
    let resizeCallback: (() => void) | null = null;
    const off = vi.fn();

    const pda = createPdaShell({
      storage: null,
      viewport: () => curVp,
      onResize: cb => {
        resizeCallback = cb;
        return off;
      },
    });

    expect(pda.state.dockSide).toBe('right');
    const oldX = pda.state.x;

    // 缩放到移动端尺寸
    curVp = VIEWPORT_MOBILE;
    if (resizeCallback) {
      (resizeCallback as () => void)();
    }

    // 贴右边保持自动适应新视口
    const size = pda.size();
    expect(pda.state.x).toBe(VIEWPORT_MOBILE.width - size.width - PDA_EDGE_MARGIN);
    expect(pda.state.x).not.toBe(oldX);

    pda.destroy();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('defaultPdaDeps 在无 DOM 或存储异常环境下安全降级', () => {
    const deps = defaultPdaDeps();
    expect(typeof deps.viewport).toBe('function');
    const vp = deps.viewport();
    expect(vp.width).toBeGreaterThan(0);
    expect(vp.height).toBeGreaterThan(0);
    expect(typeof deps.onResize).toBe('function');
  });

  it('穿透获取宿主顶级大屏视口，手持板展开态在大屏下可自由向右拖拽至边界', () => {
    // 模拟运行在大屏 (1920×1080) 视口
    const VIEWPORT_FULLHD: Viewport = { width: 1920, height: 1080 };
    const pda = createPdaShell({
      viewport: () => VIEWPORT_FULLHD,
    });

    pda.setCollapsed(false); // 展开 320×440
    pda.dragStart(100, 100);
    // 模拟向右拖拽 1500px
    pda.dragMove(1600, 100);

    // 最大 X 坐标应能到达 1920 - 320 - 12 = 1588，而不再被旧中控台 340px 卡在 8px~12px
    expect(pda.state.x).toBe(1920 - PDA_EXPANDED_SIZE.width - PDA_EDGE_MARGIN);
    expect(pda.state.x).toBe(1588);
  });
});
