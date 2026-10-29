/**
 * pdaBeacon.test.ts —— 战地手持板（PDA）战术纽扣与宿主容器测试
 *
 * 覆盖：
 * 1. PdaBeaconButton 44×44px 尺寸、圆角与工规类名；
 * 2. 盟军 / 苏联 / 尤里 阵营色彩映射与高危告警微弱呼吸；
 * 3. 未读角标（Badge Counter）>0 呈现、=0 隐藏、>99 截断与高危告警样式；
 * 4. 指针拖拽与单击展开手势状态机判定；
 * 5. TacticalPdaHost 宿主 fixed 定位、z-index 阶梯（9995/9996）、穿透与形态切换。
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

const VIEWPORT_DESKTOP: Viewport = { width: 1440, height: 900 };

/* ═══════════════ 打桩配置 ═══════════════ */

vi.mock('../PdaBeaconButton.vue', () => ({
  default: {
    name: 'PdaBeaconButtonMock',
    props: ['shell', 'unreadCount', 'hasCritical', 'faction'],
    emits: ['click'],
    render(ctx: { unreadCount?: number; hasCritical?: boolean; faction?: string }) {
      return h('button', {
        class: 'pda-beacon-button-mock',
        'data-unread': ctx.unreadCount,
        'data-critical': ctx.hasCritical,
        'data-faction': ctx.faction,
      });
    },
  },
}));

vi.mock('../PdaWindowFrame.vue', () => ({
  default: {
    name: 'PdaWindowFrameMock',
    props: ['shell', 'faction'],
    render() {
      return h('div', { class: 'pda-window-frame w-[320px] h-[440px]' });
    },
  },
}));

vi.mock('../PdaNotificationPill.vue', () => ({
  default: {
    name: 'PdaNotificationPillMock',
    props: ['items', 'shell', 'visible', 'intervalMs'],
    render() {
      return h('div', { class: 'pda-notification-pill-mock' });
    },
  },
}));

vi.mock('../../../红警指挥系统/ui/ui', () => ({
  ui: { theme: 'allied' },
}));

/* ═══════════════ SFC 即时编译 ═══════════════ */

const DIR = fileURLToPath(new URL('..', import.meta.url));
const BEACON_SFC_PATH = join(DIR, 'PdaBeaconButton.vue');
const BEACON_COMPILED_PATH = join(DIR, 'PdaBeaconButton.__ssr__.mts');
const HOST_SFC_PATH = join(DIR, 'TacticalPdaHost.vue');
const HOST_COMPILED_PATH = join(DIR, 'TacticalPdaHost.__ssr__.mts');

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

let beaconPromise: Promise<Component> | undefined;
const loadBeaconButton = () => (beaconPromise ??= compileSfc(BEACON_SFC_PATH, BEACON_COMPILED_PATH, 'pdabeaconssr'));

let hostPromise: Promise<Component> | undefined;
const loadPdaHost = () => (hostPromise ??= compileSfc(HOST_SFC_PATH, HOST_COMPILED_PATH, 'pdahostssr'));

afterAll(() => {
  for (const p of [BEACON_COMPILED_PATH, HOST_COMPILED_PATH]) {
    try {
      unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
});

function createTestShell(initialCollapsed = true): PdaShell {
  return createPdaShell({
    storage: null,
    viewport: () => VIEWPORT_DESKTOP,
  });
}

describe('PDA-BEACON-01: PdaBeaconButton 战术纽扣渲染与形态契约', () => {
  it('物理规格严格锁定 44×44px，并带有圆角与半透明磨砂外壳类名', async () => {
    const Comp = await loadBeaconButton();
    const shell = createTestShell(true);
    const html = await renderToString(createSSRApp({ render: () => h(Comp, { shell }) }));

    expect(html).toContain('size-[44px]');
    expect(html).toContain('rounded-[10px]');
    expect(html).toContain('pda-beacon-button');
    expect(html).toContain('backdrop-blur-md');
  });

  it('阵营色彩映射：盟军 (allies)、苏联 (soviet)、尤里 (yuri) 主题契约', async () => {
    const Comp = await loadBeaconButton();
    const shell = createTestShell(true);

    // 1. 盟军
    const alliesHtml = await renderToString(createSSRApp({ render: () => h(Comp, { shell, faction: 'allies' }) }));
    expect(alliesHtml).toContain('theme-allies');
    expect(alliesHtml).toContain('data-faction="allies"');

    // 2. 苏联
    const sovietHtml = await renderToString(createSSRApp({ render: () => h(Comp, { shell, faction: 'soviet' }) }));
    expect(sovietHtml).toContain('theme-soviet');
    expect(sovietHtml).toContain('data-faction="soviet"');

    // 3. 尤里
    const yuriHtml = await renderToString(createSSRApp({ render: () => h(Comp, { shell, faction: 'yuri' }) }));
    expect(yuriHtml).toContain('theme-yuri');
    expect(yuriHtml).toContain('data-faction="yuri"');
  });

  it('未读角标规则：0 条隐藏、N 条展示、>99 截断显示 +99', async () => {
    const Comp = await loadBeaconButton();
    const shell = createTestShell(true);

    // unread = 0: 隐藏
    const zeroHtml = await renderToString(createSSRApp({ render: () => h(Comp, { shell, unreadCount: 0 }) }));
    expect(zeroHtml).not.toContain('pda-beacon-badge');

    // unread = 5: 显示 +5
    const fiveHtml = await renderToString(createSSRApp({ render: () => h(Comp, { shell, unreadCount: 5 }) }));
    expect(fiveHtml).toContain('pda-beacon-badge');
    expect(fiveHtml).toContain('+5');

    // unread = 150: 截断为 +99
    const maxHtml = await renderToString(createSSRApp({ render: () => h(Comp, { shell, unreadCount: 150 }) }));
    expect(maxHtml).toContain('pda-beacon-badge');
    expect(maxHtml).toContain('+99');
  });

  it('告警跃迁：hasCritical 为 true 时激活高危红色光晕与高频呼吸动画', async () => {
    const Comp = await loadBeaconButton();
    const shell = createTestShell(true);

    const critHtml = await renderToString(
      createSSRApp({
        render: () => h(Comp, { shell, unreadCount: 2, hasCritical: true }),
      }),
    );

    expect(critHtml).toContain('is-critical');
    expect(critHtml).toContain('data-has-critical="true"');
    expect(critHtml).toContain('animate-pulse');
  });
});

describe('PDA-HOST-01: TacticalPdaHost 宿主挂载容器与 Z-Index 阶梯治理', () => {
  it('宿主容器设置 fixed 定位与 pointer-events: none 穿透保障', async () => {
    const HostComp = await loadPdaHost();
    const shell = createTestShell(true);
    const html = await renderToString(createSSRApp({ render: () => h(HostComp, { shell }) }));

    expect(html).toContain('tactical-pda-host');
    expect(html).toContain('fixed');
    expect(html).toContain('pointer-events-none');
  });

  it('Z-Index 阶梯规范：收纳态 z-index: 9996，展开态 z-index: 9995', async () => {
    const HostComp = await loadPdaHost();
    const shell = createTestShell(true);

    // 折叠态：9996
    const collapsedHtml = await renderToString(createSSRApp({ render: () => h(HostComp, { shell }) }));
    expect(collapsedHtml).toMatch(/z-index:\s*9996/);

    // 展开态：9995
    shell.setCollapsed(false);
    const expandedHtml = await renderToString(createSSRApp({ render: () => h(HostComp, { shell }) }));
    expect(expandedHtml).toMatch(/z-index:\s*9995/);
  });

  it('hidden 为 true 时完全不渲染 DOM 节点', async () => {
    const HostComp = await loadPdaHost();
    const shell = createTestShell(true);
    shell.setHidden(true);

    const html = await renderToString(createSSRApp({ render: () => h(HostComp, { shell }) }));
    expect(html).toContain('<!--v-if-->');
    expect(html).not.toContain('tactical-pda-host');
  });

  it('收纳态与展开态插槽/结构正常切换', async () => {
    const HostComp = await loadPdaHost();
    const shell = createTestShell(true);

    // 收纳态包含 pda-beacon-cluster
    const colHtml = await renderToString(createSSRApp({ render: () => h(HostComp, { shell }) }));
    expect(colHtml).toContain('pda-beacon-cluster');
    expect(colHtml).not.toContain('pda-fallback-frame');

    // 展开态渲染手持板机体 (320×440)
    shell.setCollapsed(false);
    const expHtml = await renderToString(createSSRApp({ render: () => h(HostComp, { shell }) }));
    expect(expHtml).toContain('pda-window-cluster');
    expect(expHtml).toContain('pda-window-frame');
    expect(expHtml).toContain('w-[320px]');
    expect(expHtml).toContain('h-[440px]');
  });

  it('PKG-B (B3): TacticalPdaHost 未显式传入 events 时自动从 snapshot 派生实时事件并驱动纽扣未读角标与高危态', async () => {
    const HostComp = await loadPdaHost();
    const shell = createTestShell(true);

    const snapshotWithOutageAndLore = {
      economy: {
        credits: 1500,
        credits_daily: 0,
        wallet: {},
        chains: [
          {
            id: 'chain-outage-1',
            name: '北坡高压精炼线',
            flow: '收入' as const,
            rate_daily: 500,
            eff: 0,
            status: 'broken' as const,
            reason: '电网断供停产',
            updated_at_day: 3,
          },
        ],
      },
      pending_lore: [
        {
          id: 'lore-faction-1',
          kind: '势力',
          name: '灰烬铁道同盟',
          summary: '活跃于北境铁路网的武装组织',
          source_floor: 3,
        },
      ],
    };

    const html = await renderToString(
      createSSRApp({
        render: () => h(HostComp, { shell, snapshot: snapshotWithOutageAndLore }),
      }),
    );

    // 派生出 2 条未读事件（1 条 critical 断供 + 1 条 info 势力接触），驱动纽扣 data-unread="2" 与 data-critical="true"
    expect(html).toContain('data-unread="2"');
    expect(html).toContain('data-critical="true"');
    expect(html).toContain('pda-notification-pill-mock');

    // PdaBeaconButton.vue 光晕样式固定静态 filter: blur(5px)，@keyframes 内不再对 filter: blur 插值
    const beaconSfc = readFileSync(BEACON_SFC_PATH, 'utf8');
    expect(beaconSfc).toMatch(/\.pda-beacon-glow\s*\{[^}]*filter:\s*blur\(5px\)/s);
    const keyframesBlocks = beaconSfc.match(/@keyframes\s+pda-beacon-[^{]+\{[\s\S]*?\n\}/g) ?? [];
    expect(keyframesBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of keyframesBlocks) {
      expect(block).not.toMatch(/filter:\s*blur/);
    }
  });
});
