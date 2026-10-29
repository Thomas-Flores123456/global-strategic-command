/**
 * ConsoleTopNavMorale.test.ts —— FD-36 (PKG-C) 中控台顶栏暴露度 EL 等级增强与民心五阶胶囊单测
 *
 * 覆盖：
 * 1. 默认态：渲染 [data-test="topnav-exposure-pill"]（0.0 · EL-0）与 [data-test="topnav-morale-pill"]（民心 · 无人在意）；
 * 2. 暴露度 EL-0~EL-4 档位简码、data-exposure-level、常驻底线 floor（显式或由基地建筑推导）及 last_change 悬停提示；
 * 3. 民心五阶状态（沸反盈天 / 人心惶惶 / 观望顺从 / 安居归心 / 万众一心）文案、data-morale-stage、五阶配色与联动效应悬停提示。
 */

/* eslint-disable import-x/no-nodejs-modules -- 测试即时编译 SFC 临时产物 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';

const mockStoreState = reactive<{
  stat: {
    exposure?: {
      value?: number;
      floor?: number;
      level?: string;
      trend?: string;
      last_change?: string;
    };
    morale?: {
      value?: number;
      level?: string;
      trend?: string;
      last_change?: string;
    };
    bases?: Array<{
      status?: string;
      site_type?: string;
      buildings?: Array<{ name?: string; layer?: string; state?: string }>;
    }>;
  };
}>({
  stat: {},
});

vi.mock('../../红警指挥系统/composables/store', () => ({
  in_tavern: false,
  useDataStore: () => mockStoreState,
}));

vi.mock('../../红警指挥系统/composables/useFloatingStore', () => ({
  useFloatingStore: () => ({
    snapshot: null,
  }),
}));

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', props: ['name', 'size'], render: () => hh('span') } };
});

const DIR = join(__dirname, '..');
const TOPNAV_SFC_PATH = join(DIR, 'console/ConsoleTopNav.vue');
const TOPNAV_COMPILED_PATH = join(DIR, 'console/ConsoleTopNav.__fd36_morale__.mts');

function stripTypeImports(code: string): string {
  return code
    .replace(/^import\s+type\s[\s\S]*?from\s+['"][^'"]+['"];?[\t ]*$/gm, '')
    .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
}

let topNavCompPromise: Promise<Component> | undefined;

function loadConsoleTopNav(): Promise<Component> {
  topNavCompPromise ??= (async () => {
    const source = readFileSync(TOPNAV_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: TOPNAV_SFC_PATH });
    if (errors.length > 0) {
      throw new Error(`${TOPNAV_SFC_PATH} 解析失败：${errors.map(String).join('; ')}`);
    }
    const compiled = compileScript(descriptor, {
      id: 'consoletopnavfd36morale',
      inlineTemplate: true,
      templateOptions: {
        id: 'consoletopnavfd36morale',
        scoped: descriptor.styles.some(s => s.scoped),
      },
    });
    writeFileSync(TOPNAV_COMPILED_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
    const mod = (await import(pathToFileURL(TOPNAV_COMPILED_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return topNavCompPromise;
}

afterAll(() => {
  try {
    unlinkSync(TOPNAV_COMPILED_PATH);
  } catch {
    /* ignore */
  }
});

interface VElement {
  kind: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: VNodeItem[];
  parent: VElement | null;
}
interface VText {
  kind: 'text';
  text: string;
  parent: VElement | null;
}
type VNodeItem = VElement | VText;

function makeElement(tag: string): VElement {
  return { kind: 'element', tag, attrs: {}, children: [], parent: null };
}

function getText(node: VNodeItem): string {
  if (node.kind === 'text') return node.text;
  return node.children.map(getText).join('');
}

function findByDataTest(root: VElement, dataTest: string): VElement | undefined {
  let found: VElement | undefined;
  const walk = (el: VElement) => {
    if (found) return;
    if (el.attrs['data-test'] === dataTest || el.attrs['data-testid'] === dataTest) {
      found = el;
      return;
    }
    for (const c of el.children) {
      if (c.kind === 'element') walk(c);
    }
  };
  walk(root);
  return found;
}

function mountTopNav(Comp: Component, extraProps: Record<string, unknown> = {}) {
  const renderer = createRenderer<VNodeItem, VElement>({
    createElement: tag => makeElement(tag),
    createText: text => ({ kind: 'text', text, parent: null }),
    createComment: text => ({ kind: 'text', text: `<!--${text}-->`, parent: null }),
    setText: (node, text) => {
      if (node.kind === 'text') node.text = text;
    },
    setElementText: (el, text) => {
      el.children = [{ kind: 'text', text, parent: el }];
    },
    insert: (child, parent, anchor) => {
      child.parent = parent;
      const idx = anchor ? parent.children.indexOf(anchor) : -1;
      if (idx >= 0) parent.children.splice(idx, 0, child);
      else parent.children.push(child);
    },
    remove: child => {
      if (!child.parent) return;
      const idx = child.parent.children.indexOf(child);
      if (idx >= 0) child.parent.children.splice(idx, 1);
      child.parent = null;
    },
    parentNode: node => node.parent,
    nextSibling: node => {
      if (!node.parent) return null;
      const idx = node.parent.children.indexOf(node);
      return node.parent.children[idx + 1] ?? null;
    },
    patchProp: (el, key, _prev, next) => {
      if (key.startsWith('on') && key.length > 2) return;
      if (next === null || next === undefined || next === false) {
        delete el.attrs[key];
      } else {
        el.attrs[key] = String(next);
      }
    },
  });

  const root = makeElement('div');
  const app = renderer.createApp({
    render: () =>
      h(Comp, {
        floorId: 12,
        busy: false,
        activeModal: null,
        ...extraProps,
      }),
  });
  app.mount(root);
  return { root, app };
}

describe('FD-36 PKG-C · ConsoleTopNav 暴露度 EL 等级增强与民心五阶胶囊单测', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockStoreState.stat = {};
  });

  it('1. 默认基线：渲染 topnav-exposure-pill (0.0 · EL-0) 与 topnav-morale-pill (民心 · 无人在意)', async () => {
    const Comp = await loadConsoleTopNav();
    const { root } = mountTopNav(Comp);

    const expPill = findByDataTest(root, 'topnav-exposure-pill');
    expect(expPill).toBeDefined();
    expect(getText(expPill!)).toContain('0.0');
    expect(getText(expPill!)).toContain('EL-0');
    expect(expPill!.attrs['data-exposure-level']).toBe('EL-0');
    expect(expPill!.attrs.title).toContain('日常隐蔽（EL-0）');
    expect(expPill!.attrs.title).toContain('floor: 0.0');

    const morPill = findByDataTest(root, 'topnav-morale-pill');
    expect(morPill).toBeDefined();
    expect(getText(morPill!)).toContain('民心 · 无人在意');
    expect(morPill!.attrs['data-morale-stage']).toBe('无人在意');
    expect(morPill!.attrs.class).toContain('--rac-muted');
    expect(morPill!.attrs.title).toContain('隐蔽潜伏未入世');
  });

  it('2. 暴露度 EL-0~EL-4 动态更新：展示档位简码、常驻底线 floor 与最近事件 last_change', async () => {
    const Comp = await loadConsoleTopNav();
    mockStoreState.stat = {
      exposure: {
        value: 3.2,
        floor: 0.8,
        last_change: '前哨巡逻队交火引发关注',
      },
    };

    const { root } = mountTopNav(Comp);
    const expPill = findByDataTest(root, 'topnav-exposure-pill')!;
    expect(getText(expPill)).toContain('3.2');
    expect(getText(expPill)).toContain('EL-1');
    expect(expPill.attrs['data-exposure-level']).toBe('EL-1');
    expect(expPill.attrs.title).toContain('轻微可疑（EL-1）');
    expect(expPill.attrs.title).toContain('floor: 0.8');
    expect(expPill.attrs.title).toContain('前哨巡逻队交火引发关注');

    // 升至 EL-4 位面出圈
    mockStoreState.stat.exposure = {
      value: 9.4,
      floor: 9.0,
      last_change: '天气控制机全功率轰击触发全球警报',
    };
    await nextTick();
    const expPillAfter = findByDataTest(root, 'topnav-exposure-pill')!;
    expect(getText(expPillAfter)).toContain('9.4');
    expect(getText(expPillAfter)).toContain('EL-4');
    expect(expPillAfter.attrs['data-exposure-level']).toBe('EL-4');
    expect(expPillAfter.attrs.title).toContain('位面出圈（EL-4）');
    expect(expPillAfter.attrs.title).toContain('floor: 9.0');
  });

  it('3. 民心指数五阶状态（沸反盈天 / 人心惶惶 / 观望顺从 / 安居归心 / 万众一心）与对应配色及悬停提示', async () => {
    const Comp = await loadConsoleTopNav();
    mockStoreState.stat = {
      morale: {
        value: 7.2,
        last_change: '民生供电与净水配给恢复',
      },
    };

    const { root } = mountTopNav(Comp);
    const morPill = findByDataTest(root, 'topnav-morale-pill')!;
    expect(getText(morPill)).toContain('民心 7.2 · 安居归心');
    expect(morPill.attrs['data-morale-stage']).toBe('安居归心');
    expect(morPill.attrs.class).toContain('--rac-ok');
    expect(morPill.attrs.title).toContain('安居归心');
    expect(morPill.attrs.title).toContain('民生供电与净水配给恢复');

    // 切换至万众一心 (9.1)
    mockStoreState.stat.morale = { value: 9.1, last_change: '击退围剿军团保卫辖区' };
    await nextTick();
    expect(getText(findByDataTest(root, 'topnav-morale-pill')!)).toContain('民心 9.1 · 万众一心');
    expect(findByDataTest(root, 'topnav-morale-pill')!.attrs['data-morale-stage']).toBe('万众一心');
    expect(findByDataTest(root, 'topnav-morale-pill')!.attrs.class).toContain('--rac-hi');

    // 切换至人心惶惶 (2.8)
    mockStoreState.stat.morale = { value: 2.8, last_change: '夜间断电引发恐慌' };
    await nextTick();
    expect(getText(findByDataTest(root, 'topnav-morale-pill')!)).toContain('民心 2.8 · 人心惶惶');
    expect(findByDataTest(root, 'topnav-morale-pill')!.attrs['data-morale-stage']).toBe('人心惶惶');
    expect(findByDataTest(root, 'topnav-morale-pill')!.attrs.class).toContain('--rac-warn');

    // 切换至沸反盈天 (1.2)
    mockStoreState.stat.morale = { value: 1.2, last_change: '强征物资引发罢工' };
    await nextTick();
    expect(getText(findByDataTest(root, 'topnav-morale-pill')!)).toContain('民心 1.2 · 沸反盈天');
    expect(findByDataTest(root, 'topnav-morale-pill')!.attrs['data-morale-stage']).toBe('沸反盈天');
    expect(findByDataTest(root, 'topnav-morale-pill')!.attrs.class).toContain('--rac-alert');
  });

  it('4. 顶栏三层工整结构：暴露度与民心独立置于第二层 grid-cols-2 对称条 [data-test="topnav-metrics-row"]，不与第一层系统铭牌混排折行', async () => {
    const Comp = await loadConsoleTopNav();
    const { root } = mountTopNav(Comp);
    const metricsRow = findByDataTest(root, 'topnav-metrics-row');
    expect(metricsRow).toBeDefined();
    expect(metricsRow!.attrs.class).toContain('grid-cols-2');
    expect(findByDataTest(metricsRow!, 'topnav-exposure-pill')).toBeDefined();
    expect(findByDataTest(metricsRow!, 'topnav-morale-pill')).toBeDefined();
  });
});
