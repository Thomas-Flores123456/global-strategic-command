/**
 * pdaPill.test.ts —— PDA-PILL-01: PdaNotificationPill 伴生挂起胶囊测试
 */

/* eslint-disable import-x/no-nodejs-modules -- 测试即时编译 SFC 临时产物 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, describe, expect, it } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import type { PdaNotificationItem } from '../PdaNotificationPill.vue';
import { createPdaShell, type PdaShell, type Viewport } from '../pdaState';

const VIEWPORT_DESKTOP: Viewport = { width: 1440, height: 900 };

const DIR = fileURLToPath(new URL('..', import.meta.url));
const PILL_SFC_PATH = join(DIR, 'PdaNotificationPill.vue');
const PILL_COMPILED_PATH = join(DIR, 'PdaNotificationPill.__ssr__.mts');

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

let pillPromise: Promise<Component> | undefined;
const loadNotificationPill = () => (pillPromise ??= compileSfc(PILL_SFC_PATH, PILL_COMPILED_PATH, 'pdapillssr'));

afterAll(() => {
  try {
    unlinkSync(PILL_COMPILED_PATH);
  } catch {
    // ignore
  }
});

function createTestShell(): PdaShell {
  return createPdaShell({
    storage: null,
    viewport: () => VIEWPORT_DESKTOP,
  });
}

const SAMPLE_NOTIFS: PdaNotificationItem[] = [
  { id: 'ev-1', level: 'critical', title: '🔴 废料商路遇袭 · 净入-150', targetTab: 'cash' },
  { id: 'ev-2', level: 'warn', title: '🟡 荒原商会态度转为冷淡', targetTab: 'intel' },
  { id: 'ev-3', level: 'info', title: '🟢 弹药制造厂完工交付', targetTab: 'events' },
];

describe('PDA-PILL-01: PdaNotificationPill 伴生挂起胶囊测试', () => {
  it('单行高度 28px、宽度 200~260px 范围与磨砂半透明 HUD 胶囊外壳', async () => {
    const Comp = await loadNotificationPill();
    const html = await renderToString(
      createSSRApp({
        render: () => h(Comp, { items: SAMPLE_NOTIFS }),
      }),
    );

    expect(html).toContain('h-7'); // 高度 28px (h-7 = 1.75rem = 28px)
    expect(html).toContain('w-[240px]');
    expect(html).toContain('min-w-[200px]');
    expect(html).toContain('max-w-[260px]');
    expect(html).toContain('rounded-full');
    expect(html).toContain('pda-notification-pill');
    expect(html).toContain('backdrop-blur-md');
  });

  it('严重度等级样式：critical 激活告警脉冲光环与红色光点', async () => {
    const Comp = await loadNotificationPill();

    // 1. critical 样式
    const critHtml = await renderToString(
      createSSRApp({
        render: () => h(Comp, { items: [SAMPLE_NOTIFS[0]!] }),
      }),
    );
    expect(critHtml).toContain('data-level="critical"');
    expect(critHtml).toContain('bg-(--alert-bright');
    expect(critHtml).toContain('animate-pulse');

    // 2. warn 样式
    const warnHtml = await renderToString(
      createSSRApp({
        render: () => h(Comp, { items: [SAMPLE_NOTIFS[1]!] }),
      }),
    );
    expect(warnHtml).toContain('data-level="warn"');
    expect(warnHtml).toContain('bg-(--amber');

    // 3. info 样式
    const infoHtml = await renderToString(
      createSSRApp({
        render: () => h(Comp, { items: [SAMPLE_NOTIFS[2]!] }),
      }),
    );
    expect(infoHtml).toContain('data-level="info"');
    expect(infoHtml).toContain('bg-(--safe');
  });

  it('多条通知排队与指示器 [ 1/3 ◀ ▶ ] 呈现规则', async () => {
    const Comp = await loadNotificationPill();

    // 单条通知：隐藏翻页器
    const singleHtml = await renderToString(
      createSSRApp({
        render: () => h(Comp, { items: [SAMPLE_NOTIFS[0]!] }),
      }),
    );
    expect(singleHtml).not.toContain('pda-pill-counter');
    expect(singleHtml).not.toContain('pda-pill-prev');

    // 多条通知（3条）：展示 1/3 翻页指示与翻页按钮
    const multiHtml = await renderToString(
      createSSRApp({
        render: () => h(Comp, { items: SAMPLE_NOTIFS }),
      }),
    );
    expect(multiHtml).toContain('pda-pill-counter');
    expect(multiHtml).toContain('1/3');
    expect(multiHtml).toContain('pda-pill-prev');
    expect(multiHtml).toContain('pda-pill-next');
    expect(multiHtml).toContain('◀');
    expect(multiHtml).toContain('▶');
  });

  it('末尾收起按钮 [ ✕ ] 存在且具备独立 testid', async () => {
    const Comp = await loadNotificationPill();
    const html = await renderToString(
      createSSRApp({
        render: () => h(Comp, { items: SAMPLE_NOTIFS }),
      }),
    );

    expect(html).toContain('pda-pill-close');
    expect(html).toContain('✕');
  });

  it('空队列防御：items 为空时不渲染 DOM', async () => {
    const Comp = await loadNotificationPill();
    const html = await renderToString(
      createSSRApp({
        render: () => h(Comp, { items: [] }),
      }),
    );

    expect(html).toContain('<!--v-if-->');
    expect(html).not.toContain('pda-notification-pill');
  });

  it('点击胶囊联动 shell.focusEvent：自动展开手持板并直达目标页签', () => {
    const shell = createTestShell();
    expect(shell.state.collapsed).toBe(true);

    // 模拟聚焦事件动作
    shell.focusEvent('ev-1', 'cash');
    expect(shell.state.collapsed).toBe(false);
    expect(shell.state.activeTab).toBe('cash');
    expect(shell.state.highlightEventId).toBe('ev-1');
  });
});
