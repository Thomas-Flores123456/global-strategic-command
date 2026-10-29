/**
 * pdaFrame.test.ts —— PDA-FRAME-01: PdaWindowFrame 320×440px 展开态三防机身测试
 */

/* eslint-disable import-x/no-nodejs-modules -- 测试即时编译 SFC 临时产物 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { createPdaShell, type PdaShell, type Viewport } from '../pdaState';

vi.mock('../PdaTabEvents.vue', () => ({
  default: {
    name: 'PdaTabEventsMock',
    props: ['shell', 'snapshot', 'events', 'filter'],
    render() {
      return h('div', { class: 'pda-tab-events-mock' }, '战况动态面板');
    },
  },
}));

vi.mock('../PdaTabChains.vue', () => ({
  default: {
    name: 'PdaTabChainsMock',
    props: ['chains', 'snapshot'],
    render() {
      return h('div', { class: 'pda-tab-chains-mock' }, '资金链网面板');
    },
  },
}));

vi.mock('../PdaTabIntel.vue', () => ({
  default: {
    name: 'PdaTabIntelMock',
    props: ['factions', 'pendingLore', 'snapshot', 'memo'],
    render() {
      return h('div', { class: 'pda-tab-intel-mock' }, '战区情报面板');
    },
  },
}));

const VIEWPORT_DESKTOP: Viewport = { width: 1440, height: 900 };

const DIR = fileURLToPath(new URL('..', import.meta.url));
const FRAME_SFC_PATH = join(DIR, 'PdaWindowFrame.vue');
const FRAME_COMPILED_PATH = join(DIR, 'PdaWindowFrame.__ssr__.mts');

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
    const js = compiled.content.replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '');
    writeFileSync(compiledPath, js, 'utf8');
    const mod = (await import(pathToFileURL(compiledPath).href)) as { default: Component };
    return mod.default;
  })();
}

let framePromise: Promise<Component> | undefined;
const loadWindowFrame = () => (framePromise ??= compileSfc(FRAME_SFC_PATH, FRAME_COMPILED_PATH, 'pdaframessr'));

afterAll(() => {
  try {
    unlinkSync(FRAME_COMPILED_PATH);
  } catch {
    /* ignore */
  }
});

function createTestShell(initialCollapsed = false): PdaShell {
  const shell = createPdaShell({
    storage: null,
    viewport: () => VIEWPORT_DESKTOP,
  });
  if (!initialCollapsed) {
    shell.setCollapsed(false);
  }
  return shell;
}

describe('PDA-FRAME-01: PdaWindowFrame 320×440px 展开态三防机身', () => {
  it('严格符合 320×440px 规格约束，并带有防溢出截断类名', async () => {
    const Comp = await loadWindowFrame();
    const shell = createTestShell();
    const html = await renderToString(createSSRApp({ render: () => h(Comp, { shell }) }));

    expect(html).toContain('w-[320px]');
    expect(html).toContain('h-[440px]');
    expect(html).toContain('max-h-[calc(100vh-24px)]');
    expect(html).toContain('max-w-[calc(100vw-24px)]');
    expect(html).toContain('rounded-lg');
    expect(html).toContain('pda-window-frame');
  });

  it('工规外观与四角沉头螺栓护甲微装饰', async () => {
    const Comp = await loadWindowFrame();
    const shell = createTestShell();
    const html = await renderToString(createSSRApp({ render: () => h(Comp, { shell }) }));

    // 四角螺栓护甲
    expect(html).toContain('top-1 left-1');
    expect(html).toContain('top-1 right-1');
    expect(html).toContain('bottom-1 left-1');
    expect(html).toContain('right-1 bottom-1');
  });

  it('顶栏手柄、标题与阵营色彩映射', async () => {
    const Comp = await loadWindowFrame();
    const shell = createTestShell();

    // 默认标题
    const defaultHtml = await renderToString(createSSRApp({ render: () => h(Comp, { shell }) }));
    expect(defaultHtml).toContain('PDA-MK5 // 战术终端');
    expect(defaultHtml).toContain('theme-allies');

    // 苏联阵营
    const sovietHtml = await renderToString(createSSRApp({ render: () => h(Comp, { shell, faction: 'soviet' }) }));
    expect(sovietHtml).toContain('theme-soviet');

    // 尤里阵营
    const yuriHtml = await renderToString(createSSRApp({ render: () => h(Comp, { shell, faction: 'yuri' }) }));
    expect(yuriHtml).toContain('theme-yuri');
  });

  it('Pin 锁防误触状态切换：锁定禁止拖动、解锁恢复拖动', async () => {
    const Comp = await loadWindowFrame();
    const shell = createTestShell();

    // 未锁定状态：手柄为 cursor-move，无 is-pinned
    const unpinnedHtml = await renderToString(createSSRApp({ render: () => h(Comp, { shell }) }));
    expect(unpinnedHtml).toContain('cursor-move');
    expect(unpinnedHtml).not.toContain('is-pinned');

    // 点击锁定 Pin
    shell.togglePin();
    expect(shell.state.pinned).toBe(true);

    const pinnedHtml = await renderToString(createSSRApp({ render: () => h(Comp, { shell }) }));
    expect(pinnedHtml).toContain('cursor-default');
    expect(pinnedHtml).toContain('is-pinned');
    expect(pinnedHtml).toContain('data-pinned="true"');
  });

  it('折叠按钮动作：调用 shell.setCollapsed(true) 切换回纽扣态', async () => {
    const Comp = await loadWindowFrame();
    const shell = createTestShell();
    expect(shell.state.collapsed).toBe(false);

    // 折叠按钮存在且具备 testid
    const html = await renderToString(createSSRApp({ render: () => h(Comp, { shell }) }));
    expect(html).toContain('pda-collapse-btn');
    expect(html).toContain('[ — ]');

    // 模拟调用折叠
    shell.setCollapsed(true);
    expect(shell.state.collapsed).toBe(true);
  });

  it('支持默认插槽自定义内容渲染', async () => {
    const Comp = await loadWindowFrame();
    const shell = createTestShell();

    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(
            Comp,
            { shell },
            {
              default: () => h('div', { class: 'custom-tab-panel' }, '战况档案面板'),
            },
          ),
      }),
    );

    expect(html).toContain('custom-tab-panel');
    expect(html).toContain('战况档案面板');
  });

  it('支持按浏览器窗口比例动态计算展开态尺寸（默认 40% 宽 × 60% 高）与三档比例切换，并渲染战区态势速览条', async () => {
    const Comp = await loadWindowFrame();
    const shell = createTestShell();
    // VIEWPORT_DESKTOP = 1440 x 900 -> 40% width = 576px, 60% height = 540px
    expect(shell.dynamicSize?.()).toEqual({ width: 576, height: 540 });

    const html = await renderToString(createSSRApp({ render: () => h(Comp, { shell }) }));
    expect(html).toContain('width:576px');
    expect(html).toContain('height:540px');
    expect(html).toContain('data-testid="pda-telemetry-strip"');
    expect(html).toContain('data-testid="pda-size-mode-btn"');
    expect(html).toContain('40%×60%');

    // 切换至宽屏展台档 (52% x 74% -> 749 x 666)
    shell.cycleSizeMode?.();
    expect(shell.state.sizeMode).toBe('large');
    expect(shell.dynamicSize?.()).toEqual({ width: 749, height: 666 });

    // 再切换至紧凑掌机档 (380 x 520)
    shell.cycleSizeMode?.();
    expect(shell.state.sizeMode).toBe('compact');
    expect(shell.dynamicSize?.()).toEqual({ width: 380, height: 520 });
  });
});
