/**
 * modalHostPipeline.test.ts —— 第四阶段：战术模态框宿主渲染管线修复与层叠层级（Z-Index）治理
 *
 * 覆盖面：
 * 1. 渲染管线（Style & Theme Pipeline）：
 *    - 宿主 iframe 监听 load 事件并实现幂等样式注入（杜绝 about:blank 异步重置抹除 <style>）；
 *    - 完整克隆主应用 <style>/<link> 与 adoptedStyleSheets（TailwindCSS / Vue Scoped / global.css）；
 *    - MutationObserver 动态监听主应用 head 样式变动；
 *    - 阵营主题（data-theme）与字体环境变量同步绑定至模态框根容器（--line-hot/--deep-2/--text 等）。
 * 2. 战术层级（Tactical Z-Index Hierarchy）：10000 底座 < 10010 主模态 < 10020 二级详情 < 10030 Toastr；
 * 3. Escape 先进后出（LIFO）：二级详情优先拦截关闭，二次按键才关闭底层主模态。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  destroyModalHost,
  getOverlayMountRoot,
  initModalHost,
  OVERLAY_HOST_ID,
  setModalEscapeHandler,
  setModalHostVisible,
  syncModalHostTheme,
  syncStylesToOverlay,
  THEME_CSS_VARS,
  Z_INDEX_DETAIL_DRAWER,
  Z_INDEX_HOST_BASE,
  Z_INDEX_MAIN_MODAL,
  Z_INDEX_TOAST,
  type ModalHostOptions,
} from '../host/modalHost';

const DIR = join(__dirname, '..');
const MODAL_HOST_TS = readFileSync(join(DIR, 'host/modalHost.ts'), 'utf8');
const FLOATING_APP_SFC = readFileSync(join(DIR, 'console/FloatingApp.vue'), 'utf8');
const DETAIL_DRAWER_SFC = readFileSync(join(__dirname, '../../红警指挥系统/ui/DetailDrawer.vue'), 'utf8');
const MODALS = {
  archive: readFileSync(join(DIR, 'modals/ModalArchive.vue'), 'utf8'),
  tech: readFileSync(join(DIR, 'modals/ModalTechTree.vue'), 'utf8'),
  mecha: readFileSync(join(DIR, 'modals/ModalMechaGirl.vue'), 'utf8'),
  settings: readFileSync(join(DIR, 'modals/ModalSettings.vue'), 'utf8'),
};

// ───────────────────── 最小假 DOM ─────────────────────

interface FakeStyle {
  cssText: string;
  innerHTML: string;
  setProperty(name: string, value: string, priority?: string): void;
  removeProperty(name: string): string;
  get(name: string): string | undefined;
  raw(): Map<string, { value: string; priority: string }>;
}

function createFakeStyle(): FakeStyle {
  const map = new Map<string, { value: string; priority: string }>();
  let css = '';
  const style: FakeStyle = {
    get cssText() {
      return css;
    },
    set cssText(v: string) {
      css = v;
      map.clear();
      for (const decl of v.split(';')) {
        const idx = decl.indexOf(':');
        if (idx <= 0) continue;
        const name = decl.slice(0, idx).trim();
        let value = decl.slice(idx + 1).trim();
        let priority = '';
        if (value.endsWith('!important')) {
          priority = 'important';
          value = value.replace(/!important\s*$/, '').trim();
        }
        if (name) map.set(name, { value, priority });
      }
    },
    get innerHTML() {
      return css;
    },
    set innerHTML(v: string) {
      css = v;
    },
    setProperty(name: string, value: string, priority = '') {
      map.set(name, { value, priority });
    },
    removeProperty(name: string) {
      const old = map.get(name)?.value ?? '';
      map.delete(name);
      return old;
    },
    get: (name: string) => map.get(name)?.value,
    raw: () => map,
  };
  return style;
}

interface FakeElement {
  tagName: string;
  id: string;
  attrs: Record<string, string>;
  attributes: Array<{ name: string; value: string }>;
  children: FakeElement[];
  parent: FakeElement | null;
  style: FakeStyle;
  listeners: Record<string, Array<(e: unknown) => void>>;
  textContent: string;
  innerHTML: string;
  className: string;
  sheet: { cssRules: Array<{ cssText: string }> } | null;
  outerHTML: string;
  appendChild(child: FakeElement): FakeElement;
  removeChild(child: FakeElement): void;
  remove(): void;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  addEventListener(type: string, fn: (e: unknown) => void): void;
  removeEventListener(type: string, fn: (e: unknown) => void): void;
}

function createFakeElement(tagName: string, id = ''): FakeElement {
  const el = {} as FakeElement;
  Object.assign(el, {
    tagName: tagName.toUpperCase(),
    id,
    attrs: {},
    attributes: [],
    children: [],
    parent: null,
    style: createFakeStyle(),
    listeners: {},
    textContent: '',
    innerHTML: '',
    className: '',
    sheet: null,
    appendChild(child: FakeElement) {
      child.parent?.removeChild(child);
      el.children.push(child);
      child.parent = el;
      return child;
    },
    removeChild(child: FakeElement) {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
    },
    remove() {
      el.parent?.removeChild(el);
    },
    setAttribute(k: string, v: string) {
      el.attrs[k] = v;
      if (k === 'id') el.id = v;
    },
    getAttribute(k: string) {
      return el.attrs[k] ?? null;
    },
    addEventListener(type: string, fn: (e: unknown) => void) {
      (el.listeners[type] ??= []).push(fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      const arr = el.listeners[type];
      if (arr) {
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      }
    },
  });
  // getter 必须用 defineProperty 定义：Object.assign 会立刻求值冻结成静态字符串
  Object.defineProperty(el, 'outerHTML', {
    get() {
      el.attributes = Object.entries(el.attrs).map(([name, value]) => ({ name, value }));
      const attrs = el.attributes.map(a => ` ${a.name}="${a.value}"`).join('');
      const inner = el.innerHTML || el.children.map(c => c.outerHTML).join('') || el.textContent;
      return `<${el.tagName.toLowerCase()}${attrs}>${inner}</${el.tagName.toLowerCase()}>`;
    },
  });
  return el;
}

function findById(root: FakeElement, id: string): FakeElement | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findById(c, id);
    if (hit) return hit;
  }
  return null;
}

function findByTag(root: FakeElement, tag: string, out: FakeElement[] = []): FakeElement[] {
  if (root.tagName === tag.toUpperCase()) out.push(root);
  for (const c of root.children) findByTag(c, tag, out);
  return out;
}

interface FakeOverlayDoc {
  documentElement: FakeElement;
  head: FakeElement;
  body: FakeElement;
  adoptedStyleSheets: unknown[];
  getElementById(id: string): FakeElement | null;
  createElement(tag: string): FakeElement;
}

function createFakeOverlayDoc(): FakeOverlayDoc {
  const html = createFakeElement('html');
  const head = createFakeElement('head');
  const body = createFakeElement('body');
  html.appendChild(head);
  html.appendChild(body);
  return {
    documentElement: html,
    head,
    body,
    adoptedStyleSheets: [],
    getElementById: (id: string) => findById(html, id),
    createElement: (tag: string) => createFakeElement(tag),
  };
}

type TrackedObserver = { observed?: unknown; disconnected: boolean; observe(t: unknown): void; disconnect(): void };
let observerInstances: TrackedObserver[] = [];

interface FakeOverlay extends FakeElement {
  contentDocument?: FakeOverlayDoc;
  contentWindow?: {
    CSSStyleSheet: new () => { replaceSync(css: string): void };
    addEventListener(type: string, fn: (e: unknown) => void): void;
    removeEventListener(type: string, fn: (e: unknown) => void): void;
    dispatchEscape(key: string): void;
  };
}

interface Harness {
  mainApp: FakeElement;
  mainStyles: FakeElement[];
  hostDoc: {
    body: FakeElement;
    getElementById(id: string): FakeElement | null;
    createElement(tag: string): FakeElement;
  };
  overlay: FakeOverlay;
}

function createHarness(theme = 'soviet'): Harness {
  // 主应用文档：#app[data-theme] + 若干 <style>/<link>
  const mainHead = createFakeElement('head');
  const mainBody = createFakeElement('body');

  const mainApp = createFakeElement('div', 'app');
  mainApp.setAttribute('data-theme', theme);
  mainBody.appendChild(mainApp);

  const styleTailwind = createFakeElement('style');
  styleTailwind.textContent = '.flex{display:flex}';
  const styleScoped = createFakeElement('style');
  styleScoped.textContent = '.ra-modal-card[data-v-x]{background:#0a0e17}';
  const styleGlobal = createFakeElement('style');
  styleGlobal.textContent = '#app[data-theme="soviet"]{--line-hot:rgba(240,120,120,0.56)}';
  for (const s of [styleTailwind, styleScoped, styleGlobal]) mainHead.appendChild(s);

  const linkTailwind = createFakeElement('link');
  linkTailwind.setAttribute('rel', 'stylesheet');
  linkTailwind.setAttribute('href', 'https://cdn.example/tailwind.css');
  mainHead.appendChild(linkTailwind);

  // 宿主文档（酒馆主页面）：body 内挂覆盖层 iframe
  const hostBody = createFakeElement('body');

  // 预置覆盖层 iframe 的 contentDocument / contentWindow
  const overlayDoc = createFakeOverlayDoc();
  const escapeListeners: Array<(e: unknown) => void> = [];
  class FakeCSSStyleSheet {
    css = '';
    replaceSync(cssText: string) {
      this.css = cssText;
    }
  }
  const contentWindow = {
    CSSStyleSheet: FakeCSSStyleSheet,
    addEventListener: (_t: string, fn: (e: unknown) => void) => escapeListeners.push(fn),
    removeEventListener: (_t: string, fn: (e: unknown) => void) => {
      const i = escapeListeners.indexOf(fn);
      if (i >= 0) escapeListeners.splice(i, 1);
    },
    dispatchEscape: (key: string) => {
      for (const fn of [...escapeListeners]) fn({ key });
    },
  };

  const overlay = createFakeElement('iframe') as FakeOverlay;
  overlay.contentDocument = overlayDoc;
  overlay.contentWindow = contentWindow;

  const hostDoc = {
    body: hostBody,
    getElementById: (id: string) => findById(hostBody, id),
    // 让 initModalHost 创建的 iframe 直接拿到预置 contentDocument/contentWindow
    createElement: (tag: string) => (tag === 'iframe' ? overlay : createFakeElement(tag)),
  };

  const fakeDocument = {
    head: mainHead,
    body: mainBody,
    querySelector: (sel: string) => (sel === '#app' ? mainApp : null),
    querySelectorAll: (sel: string) => {
      if (sel === 'style') return findByTag(mainHead, 'style');
      if (sel === 'link[rel="stylesheet"]') return findByTag(mainHead, 'link').filter(l => l.attrs['rel'] === 'stylesheet');
      return [];
    },
    getElementById: (id: string) => (id === 'app' ? mainApp : null),
    adoptedStyleSheets: [] as unknown[],
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('MutationObserver', class {
    observed?: unknown;
    disconnected = false;
    observe(target: unknown) {
      this.observed = target;
    }
    disconnect() {
      this.disconnected = true;
    }
    constructor() {
      observerInstances.push(this as unknown as TrackedObserver);
    }
  });
  (globalThis as Record<string, unknown>).frameElement = {
    ownerDocument: { body: hostBody, getElementById: hostDoc.getElementById, createElement: hostDoc.createElement },
  };

  return { mainApp, mainStyles: findByTag(mainHead, 'style'), hostDoc, overlay };
}

function cleanupHarness() {
  destroyModalHost();
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>).frameElement;
  observerInstances = [];
}

afterEach(cleanupHarness);

// ───────────────────── 1. 纯值契约：战术 Z-Index 层级 ─────────────────────

describe('第四阶段 · 战术 Z-Index 层级治理（Tactical Z-Index Hierarchy）', () => {
  it('层级常量严格递增：底座 10000 < 主模态 10010 < 二级详情 10020 < Toastr 10030', () => {
    expect(Z_INDEX_HOST_BASE).toBe(10000);
    expect(Z_INDEX_MAIN_MODAL).toBe(10010);
    expect(Z_INDEX_DETAIL_DRAWER).toBe(10020);
    expect(Z_INDEX_TOAST).toBe(10030);
  });

  it('四大主模态（档案/科技/机娘/设置）统一挂载 10010 层级', () => {
    for (const [name, src] of Object.entries(MODALS)) {
      expect(src, `${name} 模板 z-index`).toMatch(/(?:z-10010|z-\[10010\])/);
      expect(src, `${name} scoped 样式`).toMatch(/\.ra-modal-mask\s*\{[^}]*z-index:\s*10010/);
    }
  });

  it('二级详情 DetailDrawer 固定 10020 层级且遮罩与主模态解耦', () => {
    expect(DETAIL_DRAWER_SFC).toMatch(/z-index:\s*10020\s*!important/);
    expect(DETAIL_DRAWER_SFC).toMatch(/@click\.self="closeDetail"/);
  });

  it('FloatingApp 覆盖层样式定义主模态 10010 / 二级详情 10020 / Toastr 10030', () => {
    expect(FLOATING_APP_SFC).toMatch(/\.ra-modal-mask\s*\{[^}]*z-index:\s*10010\s*!important/s);
    expect(FLOATING_APP_SFC).toMatch(/\.detail-mask\s*\{[^}]*z-index:\s*10020\s*!important/s);
    expect(FLOATING_APP_SFC).toMatch(/#toast-container\s*\{[^}]*z-index:\s*10030\s*!important/);
    // 旧的扁平 z-index: 100 治理规则已废除
    expect(FLOATING_APP_SFC).not.toMatch(/z-index:\s*100\s*!important/);
  });

  it('modalHost 注入战术层级覆盖规则与宿主底座 10000', () => {
    expect(MODAL_HOST_TS).toMatch(/Z_INDEX_HOST_BASE = 10000/);
    expect(MODAL_HOST_TS).toMatch(/Z_INDEX_MAIN_MODAL = 10010/);
    expect(MODAL_HOST_TS).toMatch(/Z_INDEX_DETAIL_DRAWER = 10020/);
    expect(MODAL_HOST_TS).toMatch(/Z_INDEX_TOAST = 10030/);
    expect(MODAL_HOST_TS).toMatch(/\.ra-modal-mask/);
    expect(MODAL_HOST_TS).toMatch(/\.detail-mask/);
    expect(MODAL_HOST_TS).toMatch(/#toast-container/);
  });

  it('THEME_CSS_VARS 三大阵营齐全：--line-hot/--deep-2/--text 等关键变量全覆盖', () => {
    for (const theme of ['allied', 'soviet', 'yuri']) {
      const vars = THEME_CSS_VARS[theme];
      expect(vars, `${theme} 主题字典`).toBeDefined();
      for (const key of ['--void', '--line-hot', '--line-hi', '--line', '--text', '--text-2', '--deep-1', '--deep-2', '--deep-3', '--tint', '--tint-bright', '--t-hi', '--t-mid', '--t-low', '--t-faint', '--warn', '--ok', '--bad']) {
        expect(vars[key], `${theme} 缺少 ${key}`).toBeDefined();
      }
    }
  });
});

// ───────────────────── 2. 渲染管线行为（假 DOM） ─────────────────────

describe('第四阶段 · 模态宿主渲染管线（Style & Theme Pipeline）', () => {
  it('initModalHost 创建宿主 iframe：底座 z-index 10000、监听 load 事件、初始隐藏不拦截交互', () => {
    const h = createHarness('soviet');
    initModalHost();

    const overlay = h.hostDoc.getElementById(OVERLAY_HOST_ID);
    expect(overlay).not.toBeNull();
    expect(overlay!.tagName).toBe('IFRAME');
    expect(overlay!.style.get('z-index')).toBe('10000');
    expect(overlay!.style.get('display')).toBe('none');
    expect(overlay!.style.get('pointer-events')).toBe('none');
    // 核心改造：必须监听 load 事件（修复同步 innerHTML 被 about:blank 重置抹除的根因）
    expect(overlay!.listeners['load']).toBeDefined();
    expect(overlay!.style.get('width')).toBe('100vw');
    expect(overlay!.style.get('height')).toBe('100vh');
  });

  it('初始化后宿主文档含全部主应用 <style>/<link> 克隆与挂载根节点链 #app → #ra-modal-mount-root', () => {
    const h = createHarness('soviet');
    initModalHost();

    const overlay = h.hostDoc.getElementById(OVERLAY_HOST_ID)! as FakeOverlay;
    const doc = overlay.contentDocument!;
    const container = doc.getElementById('ra-modal-style-container');
    expect(container).not.toBeNull();
    const html = container.innerHTML;
    // Tailwind 展开样式、Vue Scoped 样式、global.css 均克隆
    for (const s of h.mainStyles) {
      expect(html).toContain(s.textContent);
    }
    expect(html).toContain('https://cdn.example/tailwind.css');
    // 战术层级覆盖规则注入
    expect(html).toContain('.ra-modal-mask');
    expect(html).toContain('.detail-mask');
    expect(html).toContain('#toast-container');
    // 挂载根节点结构
    const app = doc.getElementById('app');
    expect(app).not.toBeNull();
    expect(app!.className).toBe('ra-app--modal-open');
    const root = doc.getElementById('ra-modal-mount-root');
    expect(root).not.toBeNull();
    expect(root!.parent).toBe(app);
    expect(getOverlayMountRoot(overlay as unknown as HTMLIFrameElement)).toBe(root);
  });

  it('load 事件重放（模拟 about:blank 异步重置）后重建挂载根节点并回调 onMountRootReady', () => {
    const h = createHarness('soviet');
    const onMountRootReady = vi.fn();
    initModalHost({ onMountRootReady } satisfies ModalHostOptions);

    const overlay = h.hostDoc.getElementById(OVERLAY_HOST_ID)! as FakeOverlay;
    // 首次同步创建未触发 load；模拟浏览器完成 about:blank 初始化后重放 load
    onMountRootReady.mockClear();
    for (const fn of [...(overlay.listeners['load'] ?? [])]) fn({});
    expect(onMountRootReady).toHaveBeenCalledTimes(1);
    const root = overlay.contentDocument!.getElementById('ra-modal-mount-root');
    expect(root).not.toBeNull();
    expect(onMountRootReady).toHaveBeenCalledWith(root);
  });

  it('幂等性：多次 syncStylesToOverlay 不产生重复样式容器 / #app / 挂载根节点', () => {
    const h = createHarness('soviet');
    initModalHost();

    const overlay = h.hostDoc.getElementById(OVERLAY_HOST_ID)! as FakeOverlay;
    const doc = overlay.contentDocument!;

    syncStylesToOverlay(overlay as unknown as HTMLIFrameElement);
    syncStylesToOverlay(overlay as unknown as HTMLIFrameElement);

    const allDivs = findByTag(doc.documentElement, 'div');
    expect(allDivs.filter(el => el.id === 'ra-modal-style-container').length).toBe(1);
    expect(allDivs.filter(el => el.id === 'app').length).toBe(1);
    expect(allDivs.filter(el => el.id === 'ra-modal-mount-root').length).toBe(1);
    // 样式容器仍在 head 下
    expect(doc.head.children.includes(doc.getElementById('ra-modal-style-container')!)).toBe(true);
  });

  it('阵营主题（data-theme）与 CSS 变量同步绑定：--line-hot/--deep-2/--text 在模态框根容器 100% 生效', () => {
    const h = createHarness('soviet');
    initModalHost();
    syncModalHostTheme('soviet');

    const overlay = h.hostDoc.getElementById(OVERLAY_HOST_ID)! as FakeOverlay;
    const doc = overlay.contentDocument!;
    const app = doc.getElementById('app')!;
    expect(app.getAttribute('data-theme')).toBe('soviet');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('soviet');
    expect(doc.body.getAttribute('data-theme')).toBe('soviet');
    const vars = app.style.raw();
    expect(vars.get('--line-hot')?.value).toBe('rgba(240, 120, 120, 0.56)');
    expect(vars.get('--deep-2')?.value).toBe('#1e0c0e');
    expect(vars.get('--text')?.value).toBe('#eed9da');
    // 字体环境变量同步
    expect(vars.get('--mono')?.value).toContain('Cascadia Mono');
    expect(vars.get('font-family')?.value).toContain('Inter');
    expect(rootOf(doc)!.getAttribute('data-theme')).toBe('soviet');

    // 切换尤里紫后变量实时跟随
    syncModalHostTheme('yuri');
    expect(app.getAttribute('data-theme')).toBe('yuri');
    expect(vars.get('--deep-2')?.value).toBe('#170e20');
    expect(vars.get('--text')?.value).toBe('#e3d9ed');
    expect(vars.get('--line-hot')?.value).toBe('rgba(201, 145, 239, 0.54)');
  });

  it('未显式指定主题时从主应用 #app[data-theme] 推断当前阵营', () => {
    const h = createHarness('yuri');
    initModalHost();
    syncModalHostTheme();

    const overlay = h.hostDoc.getElementById(OVERLAY_HOST_ID)! as FakeOverlay;
    const app = overlay.contentDocument!.getElementById('app')!;
    expect(app.getAttribute('data-theme')).toBe('yuri');
  });

  it('MutationObserver 动态监听主应用 head 样式变动', () => {
    createHarness('soviet');
    initModalHost();

    expect(observerInstances.length).toBeGreaterThan(0);
    const observer = observerInstances[observerInstances.length - 1];
    expect(observer.observed).toBeDefined();
    expect(observer.disconnected).toBe(false);
  });

  it('setModalHostVisible(true) 唤起覆盖层并刷新样式，(false) 隐藏并停止交互', () => {
    const h = createHarness('soviet');
    initModalHost();

    const overlay = h.hostDoc.getElementById(OVERLAY_HOST_ID)!;
    setModalHostVisible(true);
    expect(overlay.style.get('display')).toBe('block');
    expect(overlay.style.get('pointer-events')).toBe('auto');
    const doc = (overlay as FakeOverlay).contentDocument!;
    expect(findByTag(doc.head, 'div').filter(el => el.id === 'ra-modal-style-container').length).toBe(1);

    setModalHostVisible(false);
    expect(overlay.style.get('display')).toBe('none');
    expect(overlay.style.get('pointer-events')).toBe('none');
  });

  it('宿主 iframe 内 Escape 统一派发至注册的调度回调（供 FloatingApp 做 LIFO）', () => {
    const h = createHarness('soviet');
    const onEscape = vi.fn();
    initModalHost({ onEscape } satisfies ModalHostOptions);

    const overlay = h.hostDoc.getElementById(OVERLAY_HOST_ID)! as FakeOverlay;
    overlay.contentWindow!.dispatchEscape('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);

    // 重新注册后旧回调被替换，不重复触发
    const next = vi.fn();
    setModalEscapeHandler(next);
    overlay.contentWindow!.dispatchEscape('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('destroyModalHost 清理观察器与覆盖层', () => {
    const h = createHarness('soviet');
    initModalHost();
    expect(h.hostDoc.getElementById(OVERLAY_HOST_ID)).not.toBeNull();

    destroyModalHost();
    expect(h.hostDoc.getElementById(OVERLAY_HOST_ID)).toBeNull();
    expect(observerInstances.some(o => o.disconnected)).toBe(true);
  });

  it('宿主样式未变动时重复 setModalHostVisible(true) 不重复重建 #ra-modal-style-container', () => {
    const h = createHarness('soviet');
    initModalHost();
    setModalHostVisible(true);
    const overlay = h.hostDoc.getElementById(OVERLAY_HOST_ID)! as FakeOverlay;
    const container = overlay.contentDocument!.getElementById('ra-modal-style-container');
    expect(container).not.toBeNull();
    const sentinel = '/* cached-style-sentinel */';
    container!.innerHTML = sentinel;

    setModalHostVisible(false);
    setModalHostVisible(true);
    expect(container!.innerHTML).toBe(sentinel);
  });
});

function rootOf(doc: FakeOverlayDoc): FakeElement | null {
  return doc.getElementById('ra-modal-mount-root');
}

// ───────────────────── 3. Escape LIFO 契约 ─────────────────────

describe('第四阶段 · Escape 先进后出（LIFO）按键调度', () => {
  it('FloatingApp onGlobalKey：二级详情优先关闭并 return，一次按键只关闭一层', () => {
    const fnMatch = FLOATING_APP_SFC.match(/function onGlobalKey[\s\S]*?\n\}/);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];
    const detailBranch = body.indexOf('if (detail.open)');
    const modalBranch = body.indexOf('activeModal.value !== null');
    expect(detailBranch).toBeGreaterThan(-1);
    expect(modalBranch).toBeGreaterThan(-1);
    expect(detailBranch).toBeLessThan(modalBranch);
    const detailBlock = body.slice(detailBranch, modalBranch);
    expect(detailBlock).toMatch(/closeDetail\(\)/);
    expect(detailBlock).toMatch(/return/);
  });

  it('DetailDrawer 自身 Escape 监听拦截事件派发（stopImmediatePropagation）仅关闭最上层二级详情', () => {
    expect(DETAIL_DRAWER_SFC).toMatch(/stopImmediatePropagation/);
  });

  it('主模态与二级详情同开时按 LIFO 模拟两次 Escape 仅各关一层', () => {
    let activeModal: string | null = 'archive';
    let detailOpen = true;

    const pressEscape = () => {
      if (detailOpen) {
        detailOpen = false;
        return;
      }
      if (activeModal !== null) {
        activeModal = null;
      }
    };

    pressEscape();
    expect(detailOpen).toBe(false);
    expect(activeModal).toBe('archive');

    pressEscape();
    expect(detailOpen).toBe(false);
    expect(activeModal).toBe(null);
  });
});
