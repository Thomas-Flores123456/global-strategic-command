/**
 * factionUnlockCard.test.ts —— CMD-CARD-01 `<阵营解锁>` 动态配色卷宗卡与楼层水合器单测
 *
 * 覆盖：
 * 1. 苏联赤金 (`soviet`)、盟军电光蓝 (`allied`)、尤里 (`yuri`) 及自定义合法 HEX/RGB/HSL 配色的 `<阵营解锁>` 载荷渲染
 *    （CSS 变量 `--card-primary / --card-accent / --card-bg` 绑定、阵营徽章、机娘寄语、详情手风琴折叠展开、初始授权列表）；
 * 2. 恶意颜色字符串（如 `#fff; background:url(javascript:alert(1))`、`expression(...)`、`var(...)`）被安全拦截并回退为默认色板；
 * 3. `scanAndHydrateFloorCards` / `hydrateFloorCardHost` / `installFloorCardHydrator` 对多个 `.tw-floor-card-host` 的幂等挂载
 *    （重复调用不二次挂载、同源 Iframe 挂载与高度同步、手风琴点击交互、MutationObserver 增量水合与 stop 清理）。
 */

/* eslint-disable import-x/no-nodejs-modules -- 测试即时编译 SFC 临时产物 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, describe, expect, it } from 'vitest';
import { createSSRApp, h, type Component, type Ref } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import {
  FACTION_DEFAULT_PALETTES,
  hydrateFloorCardHost,
  installFloorCardHydrator,
  isSafeCssColor,
  parseFactionUnlockPayload,
  sanitizeCardColor,
  scanAndHydrateFloorCards,
  type ParsedFactionUnlock,
} from '../cards/floorCardHydrator';

const CARDS_DIR = fileURLToPath(new URL('../cards', import.meta.url));
const SFC_PATH = join(CARDS_DIR, 'FactionUnlockCard.vue');
const COMPILED_SFC_PATH = join(CARDS_DIR, 'FactionUnlockCard.__ssr__.mts');

let cardCompPromise: Promise<Component> | undefined;

function loadFactionUnlockCardSfc(): Promise<Component> {
  return (cardCompPromise ??= (async () => {
    const source = readFileSync(SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: SFC_PATH });
    if (errors.length > 0) {
      throw new Error(`${SFC_PATH} 解析失败：${errors.map(String).join('; ')}`);
    }
    const compiled = compileScript(descriptor, {
      id: 'factionunlockcardssr',
      inlineTemplate: true,
      templateOptions: {
        id: 'factionunlockcardssr',
        scoped: descriptor.styles.some(s => s.scoped),
      },
    });
    const js = compiled.content
      .replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '')
      .replace(/^export\s+type\s[^;]*;?[\t ]*$/gm, '')
      .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
    writeFileSync(COMPILED_SFC_PATH, js, 'utf8');
    const mod = (await import(pathToFileURL(COMPILED_SFC_PATH).href)) as { default: Component };
    return mod.default;
  })());
}

afterAll(() => {
  try {
    unlinkSync(COMPILED_SFC_PATH);
  } catch {
    /* ignore */
  }
});

/* ═══════════════ 轻量级无依赖 DOM / MutationObserver 测试桩（适配 vitest node 环境） ═══════════════ */

function toDatasetKey(attrName: string): string {
  return attrName
    .slice('data-'.length)
    .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function toDataAttrName(prop: string): string {
  return `data-${prop.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`)}`;
}

class FakeStyleDeclaration {
  private map = new Map<string, string>();
  public height = '';
  public display = '';

  setProperty(name: string, value: string): void {
    this.map.set(name, String(value));
    if (name === 'height') this.height = String(value);
    if (name === 'display') this.display = String(value);
  }

  getPropertyValue(name: string): string {
    if (name === 'height' && this.height) return this.height;
    if (name === 'display' && this.display) return this.display;
    return this.map.get(name) ?? '';
  }
}

class FakeElement {
  public readonly tagName: string;
  public className = '';
  public type = '';
  public scrollHeight = 260;
  public parentNode: FakeElement | null = null;
  public readonly children: FakeElement[] = [];
  public readonly style = new FakeStyleDeclaration();
  public readonly dataset: Record<string, string | undefined>;
  public contentDocument: FakeDocument | null = null;

  private attrs = new Map<string, string>();
  private rawText = '';
  private listeners = new Map<string, Array<() => void>>();

  constructor(
    tagName: string,
    public readonly ownerDocument: FakeDocument,
  ) {
    this.tagName = tagName.toLowerCase();
    const self = this;
    this.dataset = new Proxy({} as Record<string, string | undefined>, {
      get(_target, prop: string) {
        return self.attrs.get(toDataAttrName(prop));
      },
      set(_target, prop: string, val: string | undefined) {
        const attr = toDataAttrName(prop);
        if (val === undefined) {
          self.attrs.delete(attr);
        } else {
          self.attrs.set(attr, String(val));
        }
        return true;
      },
    });
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
    if (name === 'class') this.className = String(value);
  }

  getAttribute(name: string): string | null {
    if (name === 'class') return this.className || null;
    return this.attrs.get(name) ?? null;
  }

  get textContent(): string {
    if (this.children.length === 0) return this.rawText;
    return this.rawText + this.children.map(c => c.textContent).join('');
  }

  set textContent(v: string) {
    this.children.length = 0;
    this.rawText = String(v ?? '');
  }

  get innerHTML(): string {
    return this.textContent;
  }

  set innerHTML(v: string) {
    this.children.length = 0;
    this.rawText = String(v ?? '');
  }

  appendChild(child: FakeElement): FakeElement {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.children.push(child);
    this.ownerDocument.notifyAddedNode(child);
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  addEventListener(event: string, cb: () => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }

  click(): void {
    for (const cb of this.listeners.get('click') ?? []) {
      cb();
    }
  }

  matches(selector: string): boolean {
    const s = selector.trim();
    if (!s) return false;
    const dataMatch = /^\[data-([a-z0-9-]+)="([^"]+)"\]$/i.exec(s);
    if (dataMatch) {
      const key = `data-${dataMatch[1]}`;
      return this.getAttribute(key) === dataMatch[2];
    }
    const tagClassMatch = /^([a-z0-9]+)?\.([a-z0-9_-]+)$/i.exec(s);
    if (tagClassMatch) {
      const [, tag, cls] = tagClassMatch;
      if (tag && this.tagName !== tag.toLowerCase()) return false;
      const classes = this.className.split(/\s+/).filter(Boolean);
      return classes.includes(cls);
    }
    return this.tagName === s.toLowerCase();
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const results: FakeElement[] = [];
    const visit = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.matches(selector)) {
          results.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return results;
  }
}

class FakeMutationObserver {
  private active = false;
  constructor(
    private readonly callback: (mutations: Array<{ addedNodes: FakeElement[] }>) => void,
  ) {}

  observe(target: FakeElement | FakeDocument): void {
    this.active = true;
    const doc = target instanceof FakeDocument ? target : target.ownerDocument;
    doc.registerObserver(this);
  }

  disconnect(): void {
    this.active = false;
  }

  triggerAdded(node: FakeElement): void {
    if (!this.active) return;
    this.callback([{ addedNodes: [node] }]);
  }
}

class FakeDocument {
  public readonly body: FakeElement;
  public readonly documentElement: FakeElement;
  public readonly defaultView: { MutationObserver: typeof FakeMutationObserver };
  private observers = new Set<FakeMutationObserver>();

  constructor() {
    this.defaultView = { MutationObserver: FakeMutationObserver };
    this.documentElement = new FakeElement('html', this);
    this.body = new FakeElement('body', this);
    this.documentElement.appendChild(this.body);
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }

  querySelector(selector: string): FakeElement | null {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.documentElement.querySelectorAll(selector);
  }

  registerObserver(obs: FakeMutationObserver): void {
    this.observers.add(obs);
  }

  notifyAddedNode(node: FakeElement): void {
    for (const obs of this.observers) {
      obs.triggerAdded(node);
    }
  }
}

function createFloorCardHostInDoc(
  doc: FakeDocument,
  rawPayload: string,
  options?: { cardType?: string; withIframe?: boolean },
): { host: FakeElement; iframe: FakeElement | null } {
  const host = doc.createElement('div');
  host.className = 'tw-floor-card-host';
  host.dataset.twCard = options?.cardType ?? 'faction-unlock';
  host.dataset.twTitle = '战区阵营编制启封卷宗';

  const script = doc.createElement('script');
  script.type = 'text/plain';
  script.className = 'tw-raw-payload';
  script.textContent = rawPayload;
  host.appendChild(script);

  let iframe: FakeElement | null = null;
  if (options?.withIframe !== false) {
    iframe = doc.createElement('iframe');
    iframe.className = 'tw-floor-card';
    iframe.dataset.twCard = options?.cardType ?? 'faction-unlock';
    iframe.contentDocument = new FakeDocument();
    iframe.contentDocument.body.scrollHeight = 312;
    host.appendChild(iframe);
  }

  return { host, iframe };
}

/* ═══════════════ 测试套件 ═══════════════ */

describe('CMD-CARD-01 · FactionUnlockCard.vue 动态配色卷宗卡与安全色板校验', () => {
  it('苏联赤金、盟军电光蓝及自定义合法 HEX/RGB/HSL 配色的 <阵营解锁> 载荷渲染与手风琴折叠展开', async () => {
    const FactionUnlockCard = await loadFactionUnlockCardSfc();

    // 1. 苏联赤金默认色板渲染（YAML 字符串载荷）
    const sovietYaml = `
faction: soviet
badge: SOVIET // 赤色重工启封
title: 苏联战区编制正式启封
subtitle: 第七重工集群与冷核反应堆并网完成
starterGirlName: 喀秋莎
starterGirlModel: MCV-SOV 重型机动基地车核心机娘
starterGirlQuote: 同志，钢铁洪流随时为您踏平一切阻碍！
details:
  工业母机: 重型冷核反应堆
  并网协议: T1-SOV-GRID
initialGrants:
  - 磁暴线圈初级电网授权
  - 犀牛重型坦克生产线许可
`;

    const sovietHtml = await renderToString(
      createSSRApp({
        render: () => h(FactionUnlockCard, { payload: sovietYaml }),
      }),
    );

    expect(sovietHtml).toContain('data-test="faction-unlock-card"');
    expect(sovietHtml).toContain('data-faction="soviet"');
    expect(sovietHtml).toContain('--card-primary:#c93b2b');
    expect(sovietHtml).toContain('--card-accent:#d4a84f');
    expect(sovietHtml).toContain('--card-bg:#140c0c');
    expect(sovietHtml).toContain('SOVIET // 赤色重工启封');
    expect(sovietHtml).toContain('苏联战区编制正式启封');
    expect(sovietHtml).toContain('喀秋莎');
    expect(sovietHtml).toContain('MCV-SOV 重型机动基地车核心机娘');
    expect(sovietHtml).toContain('同志，钢铁洪流随时为您踏平一切阻碍！');
    expect(sovietHtml).toContain('data-test="toggle-details"');
    expect(sovietHtml).toContain('磁暴线圈初级电网授权');
    expect(sovietHtml).toContain('犀牛重型坦克生产线许可');

    // 2. 盟军电光蓝默认色板渲染（结构化对象载荷）
    const alliedPayload = parseFactionUnlockPayload({
      faction: 'allied',
      title: '盟军空天联合作战体系启封',
      starterGirlName: '雅典娜',
      starterGirlModel: 'MCV-AL 战术基地车机娘',
      starterGirlQuote: '超时空传送仪与宙斯盾护盾已同步上线。',
      details: {
        核心枢纽: '超时空信标阵列',
        空指链路: '全球精确制导网',
      },
      initialGrants: ['多功能步兵车装配授权', '爱国者防空导弹网并网'],
    });

    const alliedHtml = await renderToString(
      createSSRApp({
        render: () => h(FactionUnlockCard, { payload: alliedPayload, defaultDetailsOpen: true }),
      }),
    );

    expect(alliedHtml).toContain('data-faction="allied"');
    expect(alliedHtml).toContain('--card-primary:#2563eb');
    expect(alliedHtml).toContain('--card-accent:#38bdf8');
    expect(alliedHtml).toContain('--card-bg:#0b1324');
    expect(alliedHtml).toContain('雅典娜');
    expect(alliedHtml).toContain('超时空传送仪与宙斯盾护盾已同步上线。');
    expect(alliedHtml).toContain('data-test="details-panel"');
    expect(alliedHtml).toContain('超时空信标阵列');
    expect(alliedHtml).toContain('多功能步兵车装配授权');

    // 3. 自定义合法 HEX 配色 + 详情手风琴折叠展开交互验证
    const customHexPayload = JSON.stringify({
      faction: 'yuri',
      primaryColor: '#9333ea',
      accentColor: '#e879f9',
      bgColor: '#1e1030',
      title: '厄普西隆心灵战区启封',
      starterGirlName: '天秤',
      starterGirlModel: 'MCV-PSI 心灵基地车',
      starterGirlQuote: '心灵波频已覆盖战区。',
      details: [{ label: '心灵信标', value: '全频段同调' }],
      initialGrants: ['精神控制增幅器授权'],
    });

    const customHtml = await renderToString(
      createSSRApp({
        render: () => h(FactionUnlockCard, { payload: customHexPayload }),
      }),
    );
    expect(customHtml).toContain('--card-primary:#9333ea');
    expect(customHtml).toContain('--card-accent:#e879f9');
    expect(customHtml).toContain('--card-bg:#1e1030');

    // 验证 setup 暴露的手风琴折叠展开切换逻辑
    const SetupComp = FactionUnlockCard as Component & {
      setup?: (
        props: Record<string, unknown>,
        ctx: { expose: (exp: unknown) => void },
      ) => unknown;
    };
    let exposed: {
      detailsOpen: Ref<boolean>;
      toggleDetails: () => void;
      resolved: Ref<ParsedFactionUnlock>;
    } | null = null;

    SetupComp.setup?.(
      { payload: customHexPayload, defaultDetailsOpen: false },
      {
        expose: exp => {
          exposed = exp as typeof exposed;
        },
      },
    );

    expect(exposed).not.toBeNull();
    expect(exposed!.detailsOpen.value).toBe(false);
    exposed!.toggleDetails();
    expect(exposed!.detailsOpen.value).toBe(true);
    exposed!.toggleDetails();
    expect(exposed!.detailsOpen.value).toBe(false);
  });

  it('恶意颜色字符串（如 #fff; background:url(javascript:alert(1))）被安全拦截并回退为对应阵营默认色板', async () => {
    const FactionUnlockCard = await loadFactionUnlockCardSfc();

    // 显式测试白名单校验纯函数
    expect(isSafeCssColor('#c93b2b')).toBe(true);
    expect(isSafeCssColor('#fff')).toBe(true);
    expect(isSafeCssColor('#112233aa')).toBe(true);
    expect(isSafeCssColor('rgb(37, 99, 235)')).toBe(true);
    expect(isSafeCssColor('hsl(210, 80%, 45%)')).toBe(true);

    expect(isSafeCssColor('#fff; background:url(javascript:alert(1))')).toBe(false);
    expect(isSafeCssColor('expression(alert(1))')).toBe(false);
    expect(isSafeCssColor('var(--evil-inject)')).toBe(false);
    expect(isSafeCssColor('rgb(999, 0, 0)')).toBe(false);
    expect(isSafeCssColor('')).toBe(false);

    expect(
      sanitizeCardColor('#fff; background:url(javascript:alert(1))', FACTION_DEFAULT_PALETTES.soviet.primary),
    ).toBe('#c93b2b');

    // 在组件与解析器中验证恶意颜色注入回退到阵营安全色板
    const maliciousSovietPayload = {
      faction: 'soviet',
      primaryColor: '#fff; background:url(javascript:alert(1))',
      accentColor: 'expression(window.pwned=1)',
      bgColor: 'var(--hacked-bg); color: red',
      starterGirlName: '喀秋莎',
    };

    const parsedSoviet = parseFactionUnlockPayload(maliciousSovietPayload);
    expect(parsedSoviet.primaryColor).toBe(FACTION_DEFAULT_PALETTES.soviet.primary);
    expect(parsedSoviet.accentColor).toBe(FACTION_DEFAULT_PALETTES.soviet.accent);
    expect(parsedSoviet.bgColor).toBe(FACTION_DEFAULT_PALETTES.soviet.bg);

    const html = await renderToString(
      createSSRApp({
        render: () => h(FactionUnlockCard, { payload: maliciousSovietPayload }),
      }),
    );

    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('expression(');
    expect(html).not.toContain('var(--hacked-bg)');
    expect(html).toContain('--card-primary:#c93b2b');
    expect(html).toContain('--card-accent:#d4a84f');
    expect(html).toContain('--card-bg:#140c0c');
  });
});

describe('CMD-CARD-01 · floorCardHydrator 幂等挂载、多卡片扫描与 MutationObserver 监听', () => {
  it('hydrateFloorCardHost 与 scanAndHydrateFloorCards 对多个 .tw-floor-card-host 执行幂等水合（重复调用不二次挂载）', () => {
    const doc = new FakeDocument();

    const { host: hostSoviet, iframe: iframeSoviet } = createFloorCardHostInDoc(
      doc,
      JSON.stringify({
        faction: 'soviet',
        title: '苏联重工编制启封',
        starterGirlName: '喀秋莎',
        starterGirlModel: 'MCV-SOV',
        starterGirlQuote: '乌拉！重工基地车就绪！',
        details: { 反应堆: '冷核聚变堆', 装甲厂: '重型履带装配线' },
        initialGrants: ['犀牛坦克授权', '磁暴步兵授权'],
      }),
    );

    const { host: hostAllied } = createFloorCardHostInDoc(
      doc,
      JSON.stringify({
        faction: 'allied',
        primaryColor: '#fff; background:url(javascript:alert(1))',
        title: '盟军战术编制启封',
        starterGirlName: '雅典娜',
        starterGirlQuote: '超时空网络就绪。',
        details: { 指挥网: '宙斯盾卫星链' },
        initialGrants: ['光棱塔授权'],
      }),
    );

    doc.body.appendChild(hostSoviet);
    doc.body.appendChild(hostAllied);

    // 首次全量扫描：2 个宿主均应被成功水合
    const firstHydratedCount = scanAndHydrateFloorCards(doc as unknown as ParentNode);
    expect(firstHydratedCount).toBe(2);
    expect(hostSoviet.dataset.twHydrated).toBe('true');
    expect(hostAllied.dataset.twHydrated).toBe('true');

    // 验证苏联卡片 CSS 变量与内容、同源 Iframe 挂载与高度同步
    const sovietCard = hostSoviet.querySelector('[data-test="faction-unlock-card"]')!;
    expect(sovietCard).not.toBeNull();
    expect(sovietCard.style.getPropertyValue('--card-primary')).toBe('#c93b2b');
    expect(sovietCard.style.getPropertyValue('--card-accent')).toBe('#d4a84f');
    expect(sovietCard.style.getPropertyValue('--card-bg')).toBe('#140c0c');
    expect(sovietCard.textContent).toContain('喀秋莎');
    expect(sovietCard.textContent).toContain('乌拉！重工基地车就绪！');
    expect(sovietCard.textContent).toContain('犀牛坦克授权');

    // 验证单份宿主挂载：Iframe 高度已同步并隐藏，且不再向隐藏 Iframe 重复注入第二套卡片 DOM
    expect(iframeSoviet!.style.height).toBe('312px');
    expect(iframeSoviet!.style.display).toBe('none');
    expect(hostSoviet.querySelectorAll('.tw-floor-card-mount')).toHaveLength(1);
    const iframeCard = iframeSoviet!.contentDocument!.querySelector('[data-test="faction-unlock-card"]');
    expect(iframeCard).toBeNull();

    // 验证手风琴按钮点击展开与收起
    const toggleBtn = sovietCard.querySelector('[data-test="toggle-details"]')!;
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(sovietCard.querySelector('[data-test="details-panel"]')).toBeNull();

    toggleBtn.click();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    const detailsPanel = sovietCard.querySelector('[data-test="details-panel"]')!;
    expect(detailsPanel).not.toBeNull();
    expect(detailsPanel.textContent).toContain('冷核聚变堆');

    toggleBtn.click();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(sovietCard.querySelector('[data-test="details-panel"]')).toBeNull();

    // 验证盟军卡片恶意颜色被拦截并回退为盟军默认蓝
    const alliedCard = hostAllied.querySelector('[data-test="faction-unlock-card"]')!;
    expect(alliedCard.style.getPropertyValue('--card-primary')).toBe('#2563eb');
    expect(alliedCard.style.getPropertyValue('--card-accent')).toBe('#38bdf8');
    expect(alliedCard.style.getPropertyValue('--card-bg')).toBe('#0b1324');

    // 幂等性验证：重复调用 scanAndHydrateFloorCards / hydrateFloorCardHost 绝不二次挂载
    const secondHydratedCount = scanAndHydrateFloorCards(doc as unknown as ParentNode);
    expect(secondHydratedCount).toBe(0);
    expect(hydrateFloorCardHost(hostSoviet as unknown as HTMLElement)).toBe(false);
    expect(hydrateFloorCardHost(hostAllied as unknown as HTMLElement)).toBe(false);
    expect(hostSoviet.querySelectorAll('[data-test="faction-unlock-card"]')).toHaveLength(1);
    expect(hostAllied.querySelectorAll('[data-test="faction-unlock-card"]')).toHaveLength(1);
  });

  it('installFloorCardHydrator 自动水合存量节点并通过 MutationObserver 水合新增节点，stop 后停止监听', () => {
    const doc = new FakeDocument();
    const { host: initialHost } = createFloorCardHostInDoc(
      doc,
      JSON.stringify({ faction: 'soviet', starterGirlName: '喀秋莎' }),
    );
    doc.body.appendChild(initialHost);

    const stop = installFloorCardHydrator(doc as unknown as Document);
    expect(initialHost.dataset.twHydrated).toBe('true');

    // 动态插入新楼层卡片宿主，MutationObserver 应自动水合
    const { host: dynamicHost } = createFloorCardHostInDoc(
      doc,
      JSON.stringify({ faction: 'yuri', starterGirlName: '天秤' }),
    );
    doc.body.appendChild(dynamicHost);
    expect(dynamicHost.dataset.twHydrated).toBe('true');
    const yuriCard = dynamicHost.querySelector('[data-test="faction-unlock-card"]')!;
    expect(yuriCard.style.getPropertyValue('--card-primary')).toBe('#7e22ce');

    // 调用 stop() 后再插入节点不再自动水合
    stop();
    const { host: postStopHost } = createFloorCardHostInDoc(
      doc,
      JSON.stringify({ faction: 'allied', starterGirlName: '雅典娜' }),
    );
    doc.body.appendChild(postStopHost);
    expect(postStopHost.dataset.twHydrated).toBeUndefined();
  });

  it.each([
    '',
    '<Interleaving>\n<thinking>\n示例：<阵营解锁>\nfaction: allied\nstarterGirlName: 错误机娘\n</阵营解锁>\n</thinking>\n<正文>第一段正文</正文>\n</thinking>\n<thinking>\n接下来输出 `<阵营解锁>` 等协议。\n</thinking>\n<正文>第二段正文</正文>\n</Interleaving>\n',
  ])('DOMPurify 原文回退应跳过交错思考伪标签（前缀 %s）', async prefix => {
    // 上一轮水合的微任务缓存不得跨测试复用。
    await Promise.resolve();
    const doc = new FakeDocument();
    const mesEl = doc.createElement('div');
    mesEl.className = 'mes';
    mesEl.setAttribute('mesid', '2');

    const purifiedHost = doc.createElement('div');
    purifiedHost.className = 'custom-tw-floor-card-host';
    purifiedHost.dataset.twCard = 'faction-unlock';
    purifiedHost.dataset.twTitle = '战区阵营编制启封卷宗';
    mesEl.appendChild(purifiedHost);
    doc.body.appendChild(mesEl);

    const prevGetter = (globalThis as Record<string, unknown>).getChatMessages;
    (globalThis as Record<string, unknown>).getChatMessages = (id: number) =>
      id === 2
        ? [
            {
              message:
                prefix + '正文叙述\n<阵营解锁>\nfaction: soviet\ntitle: 苏联重核编制启封\nstarterGirlName: 喀秋莎\n</阵营解锁>',
            },
          ]
        : [];

    try {
      const count = scanAndHydrateFloorCards(doc as unknown as ParentNode);
      expect(count).toBe(1);
      expect(purifiedHost.dataset.twHydrated).toBe('true');
      const card = purifiedHost.querySelector('[data-test="faction-unlock-card"]');
      expect(card).not.toBeNull();
      expect(card?.textContent).toContain('苏联重核编制启封');
      expect(card?.textContent).toContain('喀秋莎');
    } finally {
      if (prevGetter === undefined) {
        delete (globalThis as Record<string, unknown>).getChatMessages;
      } else {
        (globalThis as Record<string, unknown>).getChatMessages = prevGetter;
      }
    }
  });
});
