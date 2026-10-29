/**
 * TopNavRefresh.test.ts —— O-R2 接线回归：顶栏「刷新数据」按钮 → floating.refresh 全链直证
 *
 * 背景（NEXT.md 登记四十六 / 五十）：真机点击顶栏「刷新数据」未生效，直调 store.refresh() 正常。
 * 本批授权修复。静态勘察（src 与 dist 编译产物双侧）显示接线表面齐全，断点嫌疑集中在
 * 事件 / 绑定 / 交互层，故以可执行直证逐段钉死：
 *
 * ① ConsoleTopNav 真组件挂载点击直证（node 环境零 DOM：vue 官方 createRenderer + 内存 nodeOps
 *    挂载，直接派发按钮 onClick / 容器 onPointerdown / 顶栏 onPointerdown）：
 *    - 点击刷新按钮 → 父级 onRefresh 恰好一次（按钮 → emit('refresh') 段）；
 *    - busy 态 disabled 直绑（真机浏览器对 disabled 按钮原生不派发 click，锁内无需兜底）；
 *    - 右侧按钮容器 @pointerdown.stop 真实调用 stopPropagation（拖拽不吞按钮段）；
 *    - 顶栏空白处 pointerdown → drag-start 按左键门槛发出（拖拽链路不受修复影响）。
 * ② FloatingApp SSR 挂载接线直证（ModalSchedule.test.ts 先例：compiler-sfc 即时编译 + 打桩）：
 *    - 顶栏收到的 onRefresh 与 store.refresh 引用同一（绑定目标直证，非文字匹配）；
 *    - 以顶栏视角无参调用 onRefresh → busy 升起后必定回落、snapshot/floorId 真实水合
 *      （排除「busy 卡死 true 致按钮恒 disabled」与「事件参数污染 reader」两条嫌疑链）。
 * ③ 静态契约双轨：@refresh 唯一点位、按钮 disabled/click 契约、容器 stop、emits 声明、
 *    store busy 双分支回落钉死（引擎侧只读参照，零改动）。
 *
 * 结论口径：锁内两文件链路全段可证导通；真机残余变量（宿主环境 / ④零可观测反馈误判）
 * 不属于锁内可修复项，如实呈报主控裁决，不自行扩项。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读写临时编译产物，不进 bundle */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { createPinia, type Pinia } from 'pinia';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import type { FloorCandidate } from '../../红警指挥系统/parse/floorScanner';
import { useFloatingStore, type FloorReader } from '../../红警指挥系统/composables/useFloatingStore';

/* ═══════════════ 打桩（按解析后绝对路径生效，ModalSchedule.test.ts 先例） ═══════════════ */

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', render: () => hh('span') } };
});

/** 顶栏 onRefresh 捕获探针：FloatingApp 接线直证用（顶栏桩原样收 attrs，不做任何转发） */
const captured = vi.hoisted(() => ({ onRefresh: null as null | ((...args: unknown[]) => unknown) }));

vi.mock('../console/ConsoleTopNav.vue', () => ({
  default: {
    name: 'ConsoleTopNavWiringProbe',
    setup(_props: unknown, ctx: { attrs: Record<string, unknown> }) {
      captured.onRefresh = ctx.attrs.onRefresh as (...args: unknown[]) => unknown;
      return () => null;
    },
  },
}));

/** FloatingApp 重型子树全部置空桩：本套件只钉 TopNav 接线一段，不回归子面板渲染
 *  （vi.mock 须顶层静态路径，逐一显式登记，不可循环包裹） */
vi.mock('../console/ChronoMismatchBanner.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../console/ConsoleDockHandle.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../console/ConsolePowerBar.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../console/ConsoleQuickActions.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../console/ConsoleRadarScreen.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../console/ConsoleBuildGrid.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../../红警指挥系统/ui/DetailDrawer.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../modals/ModalArchive.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../modals/ModalMechaGirl.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../modals/ModalResources.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../modals/ModalSchedule.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../modals/ModalEngineering.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../modals/ModalBuildings.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../modals/ModalSettings.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../modals/ModalDataFlowInspector.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../modals/ModalTechTree.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../panels/PanelDataPatches.vue', () => ({ default: { name: 'NullStub', render: () => null } }));
vi.mock('../pda/TacticalPdaHost.vue', () => ({ default: { name: 'NullStub', render: () => null } }));

vi.mock('../host/modalHost', () => ({
  initModalHost: () => null,
  destroyModalHost: () => {},
  setModalHostVisible: () => {},
  syncModalHostTheme: () => {},
  initHudHost: () => null,
  destroyHudHost: () => {},
  syncHudHostTheme: () => {},
  getHudMountRoot: () => null,
}));

vi.mock('../host/modalErrorGuard', () => ({ useModalErrorGuard: () => {} }));

vi.mock('../../红警指挥系统/composables/useCatalog', () => ({
  useCatalogStore: () => ({ ready: true, init: () => {} }),
}));

vi.mock('../../红警指挥系统/ui/ui', () => ({
  ui: { theme: 'allied' },
  inferPrimaryThemeFromSnapshot: () => null,
  installCrossFrameThemeSync: () => {},
  normalizeThemeKey: () => null,
  setTheme: () => {},
}));

vi.mock('../../红警指挥系统/ui/motion/useGsapMotion', () => ({
  playTacticalStagger: () => {},
  scheduleNextFrame: () => {},
}));

vi.mock('../../红警指挥系统/composables/useParse', () => ({
  dismissChrono: () => {},
  parseState: { chrono: null },
}));

vi.mock('../../红警指挥系统/composables/useDetail', () => ({
  closeDetail: () => {},
  detail: { open: false },
}));

/* ═══════════════ SFC 即时编译（临时模块：组件旁写入，套件末清除） ═══════════════ */

const DIR = join(__dirname, '..');
const TOPNAV_SFC_PATH = join(DIR, 'console/ConsoleTopNav.vue');
const FLOATING_SFC_PATH = join(DIR, 'console/FloatingApp.vue');
const TOPNAV_COMPILED_PATH = join(DIR, 'console/ConsoleTopNav.__ssr__.mts');
const FLOATING_COMPILED_PATH = join(DIR, 'console/FloatingApp.__ssr__.mts');

/** compileScript 保留 import type 语句（.mts 下合法但为无用引用），顺手剥除（先例同口径） */
function compileSfc(sfcPath: string, compiledPath: string, id: string): Promise<Component> {
  return (async () => {
    const source = readFileSync(sfcPath, 'utf8');
    const { descriptor, errors } = parse(source, { filename: sfcPath });
    if (errors.length > 0) throw new Error(`${sfcPath} 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id,
      inlineTemplate: true,
      templateOptions: { id, scoped: descriptor.styles.some(s => s.scoped) },
    });
    const js = compiled.content
      .replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '')
      .replace(
        /^import\s+ModalBuildings\s+from\s+['"](?:\.\.|\.)(?:\/modals)?\/ModalBuildings\.vue['"];?[\t ]*$/gm,
        "const ModalBuildings = { name: 'NullStub', render: () => null };",
      );
    writeFileSync(compiledPath, js, 'utf8');
    try {
      const mod = (await import(pathToFileURL(compiledPath).href)) as { default: Component };
      return mod.default;
    } finally {
      try {
        unlinkSync(compiledPath);
      } catch {
        // ignore
      }
    }
  })();
}

let topNavPromise: Promise<Component> | undefined;
const loadTopNav = () => (topNavPromise ??= compileSfc(TOPNAV_SFC_PATH, TOPNAV_COMPILED_PATH, 'topnavssr'));
let floatingPromise: Promise<Component> | undefined;
const loadFloatingApp = () =>
  (floatingPromise ??= compileSfc(FLOATING_SFC_PATH, FLOATING_COMPILED_PATH, 'floatingappssr'));

afterAll(() => {
  try {
    unlinkSync(TOPNAV_COMPILED_PATH);
  } catch {
    // ignore
  }
  try {
    unlinkSync(FLOATING_COMPILED_PATH);
  } catch {
    // ignore
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ═══════════════ 内存 nodeOps 渲染器（node 环境零 DOM 挂载 + 事件直派） ═══════════════ */

interface FakeNode {
  kind: 'el' | 'text' | 'comment';
  tag: string;
  props: Record<string, unknown>;
  children: FakeNode[];
  parent: FakeNode | null;
  text: string;
}

function makeNode(kind: FakeNode['kind'], tag = '', text = ''): FakeNode {
  return { kind, tag, props: {}, children: [], parent: null, text };
}

/** vue 官方 createRenderer + 最小内存 nodeOps：挂载真实组件实例，props.onXxx 即编译后事件处理器 */
function createFakeRenderer() {
  const nodeOps = {
    createElement: (tag: string) => makeNode('el', tag),
    createText: (text: string) => makeNode('text', '', text),
    createComment: (text: string) => makeNode('comment', '', text),
    setText: (node: FakeNode, text: string) => {
      node.text = text;
    },
    setElementText: (el: FakeNode, text: string) => {
      const t = makeNode('text', '', text);
      t.parent = el;
      el.children = [t];
    },
    insert: (child: FakeNode, parent: FakeNode, anchor?: FakeNode | null) => {
      if (child.parent) {
        const from = child.parent.children.indexOf(child);
        if (from >= 0) child.parent.children.splice(from, 1);
      }
      child.parent = parent;
      const at = anchor ? parent.children.indexOf(anchor) : -1;
      if (at >= 0) parent.children.splice(at, 0, child);
      else parent.children.push(child);
    },
    remove: (child: FakeNode) => {
      const p = child.parent;
      if (!p) return;
      const at = p.children.indexOf(child);
      if (at >= 0) p.children.splice(at, 1);
      child.parent = null;
    },
    patchProp: (el: FakeNode, key: string, _prev: unknown, next: unknown) => {
      el.props[key] = next;
    },
    parentNode: (node: FakeNode) => node.parent,
    nextSibling: (node: FakeNode) => {
      const p = node.parent;
      if (!p) return null;
      return p.children[p.children.indexOf(node) + 1] ?? null;
    },
  };
  return createRenderer(nodeOps as unknown as Parameters<typeof createRenderer>[0]);
}

function walk(node: FakeNode, out: FakeNode[] = []): FakeNode[] {
  out.push(node);
  for (const c of [...node.children]) walk(c, out);
  return out;
}

function findByAriaLabel(root: FakeNode, label: string): FakeNode {
  const hit = walk(root).find(n => n.kind === 'el' && n.props['aria-label'] === label);
  if (!hit) throw new Error(`未找到 aria-label=${label} 的元素`);
  return hit;
}

/** 挂载 ConsoleTopNav 真组件（Icon 已打桩），返回内存树与三类事件探针 */
async function mountTopNav(over: { busy?: boolean; pendingPatchesCount?: number } = {}) {
  const Comp = await loadTopNav();
  const renderer = createFakeRenderer();
  const root = makeNode('el', 'root');
  const spies = { refresh: vi.fn(), openModal: vi.fn(), dragStart: vi.fn() };
  const Harness = {
    render: () =>
      h(Comp, {
        floorId: 1,
        busy: over.busy ?? false,
        activeModal: null,
        pendingPatchesCount: over.pendingPatchesCount ?? 0,
        onRefresh: spies.refresh,
        'onOpen-modal': spies.openModal,
        onDragStart: spies.dragStart,
      } as Record<string, unknown>),
  };
  renderer.createApp(Harness).mount(root as unknown as Element);
  return { root, spies };
}

/* ═══════════════ ① ConsoleTopNav 真组件挂载：按钮 → emit('refresh') 段直证 ═══════════════ */

describe('O-R2 直证 ① · ConsoleTopNav 刷新按钮点击（内存渲染器挂载）', () => {
  it('点击「刷新数据」按钮 → 父级 onRefresh 恰好一次，不误触 open-modal / drag-start', async () => {
    const { root, spies } = await mountTopNav();
    const btn = findByAriaLabel(root, '刷新数据');
    (btn.props.onClick as (e: unknown) => void)({ type: 'click' });
    expect(spies.refresh).toHaveBeenCalledTimes(1);
    expect(spies.openModal).not.toHaveBeenCalled();
    expect(spies.dragStart).not.toHaveBeenCalled();
  });

  it('busy 直绑 disabled：busy=true 时按钮 disabled（真机浏览器原生不派发 click），busy=false 可点', async () => {
    const busyMount = await mountTopNav({ busy: true });
    expect(findByAriaLabel(busyMount.root, '刷新数据').props.disabled).toBe(true);
    const idleMount = await mountTopNav({ busy: false });
    expect(findByAriaLabel(idleMount.root, '刷新数据').props.disabled).toBe(false);
  });

  it('右侧按钮容器 pointerdown 真实 stopPropagation：按钮按下不触发顶栏拖拽（排除拖拽吞按钮链）', async () => {
    const { root, spies } = await mountTopNav();
    const btn = findByAriaLabel(root, '刷新数据');
    const container = btn.parent;
    expect(container?.props.onPointerdown).toBeTypeOf('function');
    const evt = { button: 0, stopPropagation: vi.fn(), preventDefault: vi.fn() };
    (container!.props.onPointerdown as (e: unknown) => void)(evt);
    expect(evt.stopPropagation).toHaveBeenCalledTimes(1);
    expect(spies.dragStart).not.toHaveBeenCalled();
  });

  it('顶栏空白处 pointerdown 仍按左键门槛发出 drag-start（拖拽链路零回归）', async () => {
    const { root, spies } = await mountTopNav();
    const header = walk(root).find(n => n.tag === 'header');
    expect(header?.props.onPointerdown).toBeTypeOf('function');
    const onPointerdown = header!.props.onPointerdown as (e: unknown) => void;
    onPointerdown({ button: 0 });
    expect(spies.dragStart).toHaveBeenCalledTimes(1);
    onPointerdown({ button: 2 });
    expect(spies.dragStart).toHaveBeenCalledTimes(1);
  });

  it('邻位按钮零回归：档案/日程/资源/建筑/设置点击各发对应 open-modal', async () => {
    const { root, spies } = await mountTopNav();
    const cases: Array<[string, string]> = [
      ['打开战况档案', 'archive'],
      ['打开工程日程', 'schedule'],
      ['打开战略资源', 'resources'],
      ['打开基地建筑', 'buildings'],
      ['打开控制台设置', 'settings'],
    ];
    for (const [label, key] of cases) {
      const btn = findByAriaLabel(root, label);
      (btn.props.onClick as (e: unknown) => void)({ type: 'click' });
      expect(spies.openModal).toHaveBeenLastCalledWith(key);
    }
    expect(spies.openModal).toHaveBeenCalledTimes(cases.length);
  });

  it('当 pendingPatchesCount > 0 时顶栏「设置」按钮渲染 data-test="settings-patches-badge" 角标', async () => {
    const zeroMount = await mountTopNav({ pendingPatchesCount: 0 });
    const zeroBadge = walk(zeroMount.root).find(
      n => n.kind === 'el' && n.props['data-test'] === 'settings-patches-badge',
    );
    expect(zeroBadge).toBeUndefined();

    const badgeMount = await mountTopNav({ pendingPatchesCount: 3 });
    const settingsBtn = findByAriaLabel(badgeMount.root, '打开控制台设置');
    const badge = walk(settingsBtn).find(
      n => n.kind === 'el' && n.props['data-test'] === 'settings-patches-badge',
    );
    expect(badge).toBeDefined();
    expect(badge?.props.title).toBe('3 项待审数据补丁');
  });
});

/* ═══════════════ ② FloatingApp SSR 挂载：@refresh → store.refresh 段直证 ═══════════════ */

const fakeShell = {
  state: { x: 0, y: 0, collapsed: false, dock: 'free', modalOverlay: false },
  size: () => ({ width: 340, height: 480 }),
  toggle: () => {},
  setCollapsed: () => {},
  setModalOverlay: () => {},
  dockToLeft: () => {},
  dockToRight: () => {},
  dockFree: () => {},
  dragStart: () => {},
  dragMove: () => {},
  dragEnd: () => {},
  relayout: () => {},
  destroy: () => {},
};

const aiFloor = (stat_data: unknown): FloorCandidate => ({ role: 'assistant', is_hidden: false, stat_data });
const validV2 = (location: string) => ({ schema_version: 2, meta: { location } });

function readerOf(floors: (FloorCandidate | null)[]): FloorReader {
  return { lastMessageId: () => floors.length - 1, readFloor: id => floors[id] ?? null };
}

async function renderFloatingApp(pinia: Pinia): Promise<string> {
  const Comp = await loadFloatingApp();
  const app = createSSRApp({ render: () => h(Comp, { shell: fakeShell }) });
  app.use(pinia);
  return renderToString(app);
}

describe('O-R2 直证 ② · FloatingApp @refresh 接线（SSR 挂载 + Pinia 真 store）', () => {
  it('顶栏收到的 onRefresh 与 store.refresh 引用同一（绑定目标直证，非文字匹配）', async () => {
    vi.stubGlobal('document', { querySelector: () => null });
    const pinia = createPinia();
    await renderFloatingApp(pinia);
    const store = useFloatingStore(pinia);
    expect(captured.onRefresh).toBe(store.refresh);
  });

  it('以顶栏视角无参调用 onRefresh：busy 升起后必定回落，snapshot/floorId 真实水合', async () => {
    vi.stubGlobal('document', { querySelector: () => null });
    const pinia = createPinia();
    await renderFloatingApp(pinia);
    const store = useFloatingStore(pinia);
    store.setReader(readerOf([aiFloor(validV2('北坡'))]));
    expect(typeof captured.onRefresh).toBe('function');
    // 与 ConsoleTopNav $emit('refresh') 完全同形：零参数调用（排除事件参数污染 reader 链）
    const pending = captured.onRefresh!() as Promise<unknown>;
    expect(store.busy).toBe(true);
    await pending;
    expect(store.busy).toBe(false);
    expect(store.floorId).toBe(0);
    expect(store.snapshot?.meta.location).toBe('北坡');
    expect(store.lastError).toBeNull();
  });

  it('reader 异常路径：busy 同样必定回落（排除「busy 卡死 true 致按钮恒 disabled」嫌疑链）', async () => {
    vi.stubGlobal('document', { querySelector: () => null });
    const pinia = createPinia();
    await renderFloatingApp(pinia);
    const store = useFloatingStore(pinia);
    store.setReader({
      lastMessageId: () => {
        throw new Error('reader down');
      },
      readFloor: () => null,
    });
    await captured.onRefresh!();
    expect(store.busy).toBe(false);
    expect(store.snapshot).toBeNull();
    expect(store.lastError).toBe('reader down');
  });
});

/* ═══════════════ ③ 静态契约（接线源码钉死，双保险） ═══════════════ */

describe('O-R2 静态契约 · 接线钉死', () => {
  const topNavSrc = readFileSync(TOPNAV_SFC_PATH, 'utf8');
  const floatingSrc = readFileSync(FLOATING_SFC_PATH, 'utf8');
  const storeSrc = readFileSync(join(DIR, '../红警指挥系统/composables/useFloatingStore.ts'), 'utf8');

  it('FloatingApp 全文件唯一一处 @refresh，且直绑 floating.refresh', () => {
    expect(floatingSrc.match(/@refresh="floating\.refresh"/g)?.length).toBe(1);
    expect(floatingSrc.match(/<ConsoleTopNav\b/g)?.length).toBe(1);
  });

  it('ConsoleTopNav 刷新按钮：disabled 直绑 busy，click 直发 refresh 事件', () => {
    expect(topNavSrc).toMatch(/aria-label="刷新数据"/);
    expect(topNavSrc).toMatch(/:disabled="busy"\s+@click="\$emit\('refresh'\)"/);
    expect(topNavSrc).toContain(`(e: 'refresh'): void;`);
  });

  it('右侧按钮容器 @pointerdown.stop 与中间楼层指示 pointer-events-none 双向隔离', () => {
    expect(topNavSrc).toMatch(/<div class="flex(?:\s+shrink-0)? items-center gap-1" @pointerdown\.stop>/);
    expect(topNavSrc).toMatch(/pointer-events-none/);
  });

  it('useFloatingStore（只读参照）：busy 双分支回落 + inflight 双分支清空，结构上不存在卡死路径', () => {
    expect(storeSrc.match(/busy\.value = false;/g)?.length).toBe(2);
    expect(storeSrc.match(/inflight = null;/g)?.length).toBe(2);
    expect(storeSrc).toMatch(/if \(inflight\) return inflight;/);
  });
});
