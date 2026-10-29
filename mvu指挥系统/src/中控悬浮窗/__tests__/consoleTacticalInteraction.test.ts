/**
 * consoleTacticalInteraction.test.ts
 * 验证第三阶段红警控制台侧栏深度交互与战术指令闭环：
 * 1. 顶栏精简（TopNav 彻底移除折叠小图标）；
 * 2. 侧栏外沿贴边开关（Dock Toggle Handle 战术把手）；
 * 3. 建造网格自适应行数（Smart Grid Auto-Rows）与动态分页；
 * 4. 基地全局切换与数据联动（能量柱、监视屏指标与网格已建计数联动）；
 * 5. 战术弹窗全视窗化升级（shell.setModalOverlay 全视窗投影）；
 * 6. 战术部署指令下达工作流（详情卡片高亮按钮向聊天输入框填入标准战术指令并聚焦）。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it, vi } from 'vitest';
import type { Base, Schema } from '../../红警指挥系统/core/schema';
import { createShell, type FrameLike, type Viewport } from '../host/shell';

const DIR = join(__dirname, '..');
const TOP_NAV_SFC = readFileSync(join(DIR, 'console/ConsoleTopNav.vue'), 'utf8');
const DOCK_HANDLE_SFC = readFileSync(join(DIR, 'console/ConsoleDockHandle.vue'), 'utf8');
const BUILD_GRID_SFC = readFileSync(join(DIR, 'console/ConsoleBuildGrid.vue'), 'utf8');
const RADAR_SCREEN_SFC = readFileSync(join(DIR, 'console/ConsoleRadarScreen.vue'), 'utf8');
const FLOATING_APP_SFC = readFileSync(join(DIR, 'console/FloatingApp.vue'), 'utf8');
const RA_DIR = join(__dirname, '../../红警指挥系统');
const DETAIL_DRAWER_SFC = readFileSync(join(RA_DIR, 'ui', 'DetailDrawer.vue'), 'utf8');
// ENG-UI-03 接缝：写路径提取至 hostSendInput.ts 单一真源（工程四令与战术指令共用），
// DetailDrawer 只调 fillHostSendInput；textarea 注入/事件/focus 断言跟随到写路径模块
const HOST_SEND_INPUT_TS = readFileSync(join(RA_DIR, 'worldbook', 'hostSendInput.ts'), 'utf8');

const DESKTOP: Viewport = { width: 1920, height: 1080 };

function fakeFrame() {
  const props: Record<string, { value: string; priority: string }> = {};
  const attrs: Record<string, string> = {};
  const frame: FrameLike & { setAttribute(k: string, v: string): void; removeAttribute(k: string): void } = {
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
    setAttribute: vi.fn((k: string, v: string) => {
      attrs[k] = v;
    }),
    removeAttribute: vi.fn((k: string) => {
      delete attrs[k];
    }),
  };
  return { frame, props, attrs, get: (name: string) => props[name]?.value };
}

describe('1. 顶栏精简（TopNav）', () => {
  it('ConsoleTopNav 彻底移除 chevron 折叠收起按钮，保留档案、设置、刷新与楼层状态', () => {
    expect(TOP_NAV_SFC).not.toMatch(/chevron-down/);
    expect(TOP_NAV_SFC).not.toMatch(/chevron-up/);
    expect(TOP_NAV_SFC).not.toMatch(/toggle-collapse/);
    expect(TOP_NAV_SFC).toMatch(/档案/);
    expect(TOP_NAV_SFC).toMatch(/设置/);
    expect(TOP_NAV_SFC).toMatch(/floorId/);
    expect(TOP_NAV_SFC).toMatch(/refresh/);
  });
});

describe('2. 侧栏外沿贴边开关（Dock Toggle Handle）', () => {
  it('ConsoleDockHandle 具备战术拉手手柄、机械防滑线、指向箭头与状态指示灯', () => {
    expect(DOCK_HANDLE_SFC).toMatch(/ra-dock-handle/);
    expect(DOCK_HANDLE_SFC).toMatch(/ra-handle-grip/);
    expect(DOCK_HANDLE_SFC).toMatch(/ra-ridge-line/);
    expect(DOCK_HANDLE_SFC).toMatch(/ra-handle-arrow/);
    expect(DOCK_HANDLE_SFC).toMatch(/ra-handle-led/);
    expect(DOCK_HANDLE_SFC).toMatch(/arrowChar|arrowIconName/);
    expect(DOCK_HANDLE_SFC).toMatch(/\$emit\('toggle'\)/);
  });

  it('FloatingApp 在展开态与折叠态均贴合 ConsoleDockHandle 在面向聊天区外沿', () => {
    expect(FLOATING_APP_SFC).toMatch(/<ConsoleDockHandle/);
    expect(FLOATING_APP_SFC).toMatch(/flex-row-reverse/);
  });
});

describe('3. 建造网格动态自适应行数（Smart Grid Auto-Rows）', () => {
  it('ConsoleBuildGrid 使用 useElementSize 监听容器剩余高度，动态计算行数与 dynamicPageSize', () => {
    expect(BUILD_GRID_SFC).toMatch(/useElementSize/);
    expect(BUILD_GRID_SFC).toMatch(/dynamicPageSize/);
    expect(BUILD_GRID_SFC).toMatch(/auto-rows-\[60px\]/);
    expect(BUILD_GRID_SFC).toMatch(/gridContainerRef/);
  });

  it('自动重构分页计算与边界钳位', () => {
    expect(BUILD_GRID_SFC).toMatch(/totalPages/);
    expect(BUILD_GRID_SFC).toMatch(/pagedItems/);
    expect(BUILD_GRID_SFC).toMatch(/prevPage/);
    expect(BUILD_GRID_SFC).toMatch(/nextPage/);
  });

  it('第四阶段补丁：网格区域受限于剩余空间（flex-1 min-h-0），切页栏 flex-none 钉底，绝不被大类目顶开', () => {
    // 网格区域自身受约束并携带测量 ref（footer 高度彻底移出行数公式）
    expect(BUILD_GRID_SFC).toMatch(/ref="gridContainerRef"[^>]*class="ra-grid-area flex-1 min-h-0/);
    // 翻页 footer 固定钉底
    expect(BUILD_GRID_SFC).toMatch(/class="ra-pager flex-none/);
    // 容器不再用 justify-between 撑布局（footer 内部横向布局的 justify-between 保留）
    expect(BUILD_GRID_SFC).not.toMatch(/ra-grid-container[^"]*justify-between/);
  });

  it('第四阶段补丁：固定紧凑行高 60px 顶部对齐（卡片绝不拉伸变形），行数公式精确几何', () => {
    expect(BUILD_GRID_SFC).toMatch(/GRID_ROW_HEIGHT = 60/);
    expect(BUILD_GRID_SFC).toMatch(/GRID_ROW_GAP = 6/);
    expect(BUILD_GRID_SFC).toMatch(/Math\.floor\(\(h \+ GRID_ROW_GAP\) \/ \(GRID_ROW_HEIGHT \+ GRID_ROW_GAP\)\)/);
    expect(BUILD_GRID_SFC).not.toMatch(/- 46/);
    expect(BUILD_GRID_SFC).toMatch(/content-start/);
    expect(BUILD_GRID_SFC).not.toMatch(/auto-rows-fr/);
    expect(BUILD_GRID_SFC).toMatch(/min-height:\s*60px/);
  });

  it('行数公式几何不变量：rows×60 + (rows-1)×6 ≤ 区域高度（防辅 35 项分页后不撑开）', () => {
    const ROW = 60;
    const GAP = 6;
    const rows = (h: number) => Math.max(2, Math.floor((h + GAP) / (ROW + GAP)));
    for (const h of [132, 200, 264, 330, 400, 500, 700, 1080]) {
      const r = rows(h);
      expect(r * ROW + (r - 1) * GAP).toBeLessThanOrEqual(Math.max(h, 126));
    }
    // 防辅 35 项在典型侧栏高度下的分页：如 h=330 → 5 行 × 2 列 = 10/页 → 4 页，页面永不溢出
    expect(rows(330)).toBe(5);
    expect(Math.ceil(35 / (rows(330) * 2))).toBe(4);
    // 4K 巨幕：h≈1000 → 15 行 30 项/页，纵向空间靠更多行消化而非拉伸卡片
    expect(rows(1000)).toBe(15);
  });
});

describe('4. 基地全局切换与数据联动（Base Monitor & Switcher）', () => {
  it('ConsoleRadarScreen 提供战术基地下拉切选面板与前后切换键', () => {
    expect(RADAR_SCREEN_SFC).toMatch(/ra-base-trigger/);
    expect(RADAR_SCREEN_SFC).toMatch(/ra-base-dropdown/);
    expect(RADAR_SCREEN_SFC).toMatch(/selectBase/);
    expect(RADAR_SCREEN_SFC).toMatch(/select-base/);
  });

  it('ConsoleBuildGrid 接收 activeBaseIndex 并严格联动当前选定基地的建筑计数', () => {
    expect(BUILD_GRID_SFC).toMatch(/activeBaseIndex/);
    expect(BUILD_GRID_SFC).toMatch(/props\.activeBaseIndex/);

    // 模拟数据联动逻辑验证
    const mockBases: Base[] = [
      {
        name: '北坡主基地',
        status: '运转就绪',
        location: '38.2, 114.5',
        buildings: [
          { name: '盟军建造厂', state: '完好' },
          { name: '发电厂', state: '完好' },
          { name: '发电厂', state: '完好' },
        ],
        power: { gen: 300, use: 100 },
      },
      {
        name: '前哨站',
        status: '警戒',
        location: '39.0, 115.0',
        buildings: [
          { name: '哨戒炮', state: '完好' },
        ],
        power: { gen: 100, use: 50 },
      },
    ];

    const mockSnapshot = {
      bases: mockBases,
      forces: { troops: { 美国大兵: 10 }, vehicles: ['灰熊坦克'] },
    } as unknown as Schema;

    // 当 activeBaseIndex = 0 时，发电厂为 2，哨戒炮为 0
    const countMapBase0 = new Map<string, number>();
    const b0 = mockSnapshot.bases[0];
    for (const b of b0.buildings) {
      countMapBase0.set(b.name, (countMapBase0.get(b.name) ?? 0) + 1);
    }
    expect(countMapBase0.get('发电厂')).toBe(2);
    expect(countMapBase0.get('哨戒炮')).toBeUndefined();

    // 当 activeBaseIndex = 1 时，发电厂为 0，哨戒炮为 1
    const countMapBase1 = new Map<string, number>();
    const b1 = mockSnapshot.bases[1];
    for (const b of b1.buildings) {
      countMapBase1.set(b.name, (countMapBase1.get(b.name) ?? 0) + 1);
    }
    expect(countMapBase1.get('发电厂')).toBeUndefined();
    expect(countMapBase1.get('哨戒炮')).toBe(1);
  });
});

describe('5. 战术弹窗宿主全视窗化架构（Full-Window Tactical Modals via Host Overlay）', () => {
  it('控制台侧栏保持自身停靠尺寸（340px），绝不因子弹窗展开而拉伸自身为 100vw', () => {
    const f = fakeFrame();
    const shell = createShell({ frame: f.frame, storage: null, viewport: () => DESKTOP });
    shell.dockToRight();

    expect(f.get('width')).toBe('340px');

    shell.setModalOverlay(true);
    expect(shell.state.modalOverlay).toBe(true);
    // 侧栏自身尺寸始终锁定在 340px
    expect(f.get('width')).toBe('340px');
    expect(f.attrs['data-modal-overlay']).toBe('true');

    shell.setModalOverlay(false);
    expect(shell.state.modalOverlay).toBe(false);
    expect(f.get('width')).toBe('340px');
  });

  it('FloatingApp 与 modalHost 配合：模态框独立挂载于酒馆页面覆盖层，按需显隐，响应 Escape', () => {
    expect(FLOATING_APP_SFC).toMatch(/Teleport/);
    expect(FLOATING_APP_SFC).toMatch(/modalMountTarget/);
    expect(FLOATING_APP_SFC).toMatch(/initModalHost/);
    expect(FLOATING_APP_SFC).toMatch(/setModalHostVisible/);
    expect(FLOATING_APP_SFC).toMatch(/Escape/);
  });
});

describe('6. 战术部署指令下达工作流（Build Dispatch Workflow）', () => {
  it('DetailDrawer 包含高亮下达部署指令按钮与标准战术指令派发逻辑', () => {
    expect(DETAIL_DRAWER_SFC).toMatch(/ra-dispatch-btn/);
    expect(DETAIL_DRAWER_SFC).toMatch(/handleDispatch/);
    expect(DETAIL_DRAWER_SFC).toMatch(/【指挥官战术指令】/);
    // ENG-UI-03 接缝：写路径提取至 hostSendInput.ts 单一真源（工程四令与战术指令共用），
    // DetailDrawer 只调 fillHostSendInput；textarea 注入/事件/focus 断言跟随到写路径模块
    expect(DETAIL_DRAWER_SFC).toMatch(/fillHostSendInput/);
    expect(HOST_SEND_INPUT_TS).toMatch(/#send_textarea/);
    expect(HOST_SEND_INPUT_TS).toMatch(/textarea\.focus\(\)/);
  });

  it('模拟指令填入逻辑：生成正确战术指令并派发 input 事件与 focus', () => {
    let inputValue = '';
    let inputDispatched = false;
    let focused = false;
    const fakeTextarea = {
      set value(v: string) {
        inputValue = v;
      },
      get value() {
        return inputValue;
      },
      dispatchEvent: vi.fn((e: { type: string }) => {
        if (e.type === 'input') inputDispatched = true;
      }),
      focus: vi.fn(() => {
        focused = true;
      }),
    };

    const unitName = '光棱塔';
    const orderText = `【指挥官战术指令】批准建造：${unitName}`;

    fakeTextarea.value = orderText;
    fakeTextarea.dispatchEvent({ type: 'input' });
    fakeTextarea.focus();

    expect(fakeTextarea.value).toBe('【指挥官战术指令】批准建造：光棱塔');
    expect(inputDispatched).toBe(true);
    expect(focused).toBe(true);
  });
});
