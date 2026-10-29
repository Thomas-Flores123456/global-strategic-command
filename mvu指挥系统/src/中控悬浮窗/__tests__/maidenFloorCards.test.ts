/**
 * maidenFloorCards.test.ts —— MAIDEN-CARD-01 `<机娘>` 与 `<机娘档案>` 楼层双卡片水合器与组件单测
 *
 * 覆盖：
 * 1. `<机娘>` 初诞待授名态（`unchristened === true`）：琥珀金横幅、出厂编号、型号/序列、身子特征、初生性格与授名引导；
 * 2. `<机娘>` 日常状态更新态（单机娘对象 / YAML 数组 / 键值映射）：代号、HP、好感/服从进度条及 `+8` 增量徽标、身子/性格/现状/外壳与 `#特征标签`；
 * 3. `<机娘档案>` 建档卷宗卡水合：红警三阵营安全主题色、身份铭牌、常驻身子/性格区、社会外壳延迟空态与已编织态、手风琴展开/收起及 Iframe 高度同步；
 * 4. `aerospace-contract` 存量卡片类型兼容映射至 `space-contract` 水合分支；
 * 5. `MaidenDossierCard.vue` 与 `MaidenStatusCard.vue` 的 Vue SSR 渲染与折叠交互。
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
  buildMaidenDossierCardDom,
  buildMaidenStatusCardDom,
  FACTION_DEFAULT_THEMES,
  hydrateFloorCardHost,
  parseMaidenDossierPayload,
  parseMaidenStatusPayload,
  scanAndHydrateFloorCards,
} from '../cards/floorCardHydrator';

const CARDS_DIR = fileURLToPath(new URL('../cards', import.meta.url));
const DOSSIER_SFC_PATH = join(CARDS_DIR, 'MaidenDossierCard.vue');
const DOSSIER_COMPILED_PATH = join(CARDS_DIR, 'MaidenDossierCard.__ssr__.mts');
const STATUS_SFC_PATH = join(CARDS_DIR, 'MaidenStatusCard.vue');
const STATUS_COMPILED_PATH = join(CARDS_DIR, 'MaidenStatusCard.__ssr__.mts');

let dossierCompPromise: Promise<Component> | undefined;
let statusCompPromise: Promise<Component> | undefined;

function compileSfcToComponent(sfcPath: string, outPath: string, scopeId: string): Promise<Component> {
  return (async () => {
    const source = readFileSync(sfcPath, 'utf8');
    const { descriptor, errors } = parse(source, { filename: sfcPath });
    if (errors.length > 0) {
      throw new Error(`${sfcPath} 解析失败：${errors.map(String).join('; ')}`);
    }
    const compiled = compileScript(descriptor, {
      id: scopeId,
      inlineTemplate: true,
      templateOptions: {
        id: scopeId,
        scoped: descriptor.styles.some(s => s.scoped),
      },
    });
    const js = compiled.content
      .replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '')
      .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
    writeFileSync(outPath, js, 'utf8');
    const mod = (await import(pathToFileURL(outPath).href)) as { default: Component };
    return mod.default;
  })();
}

function loadMaidenDossierCardSfc(): Promise<Component> {
  return (dossierCompPromise ??= compileSfcToComponent(
    DOSSIER_SFC_PATH,
    DOSSIER_COMPILED_PATH,
    'maidendossiercardssr',
  ));
}

function loadMaidenStatusCardSfc(): Promise<Component> {
  return (statusCompPromise ??= compileSfcToComponent(
    STATUS_SFC_PATH,
    STATUS_COMPILED_PATH,
    'maidenstatuscardssr',
  ));
}

afterAll(() => {
  try {
    unlinkSync(DOSSIER_COMPILED_PATH);
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(STATUS_COMPILED_PATH);
  } catch {
    /* ignore */
  }
});

/* ═══════════════ 轻量级无依赖 DOM 测试桩 ═══════════════ */

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
  public id = '';
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
    if (name === 'id') this.id = String(value);
  }

  getAttribute(name: string): string | null {
    if (name === 'class') return this.className || null;
    if (name === 'id') return this.id || this.attrs.get('id') || null;
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
    if (s.startsWith('#')) {
      return this.getAttribute('id') === s.slice(1);
    }
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

class FakeDocument {
  public readonly head: FakeElement;
  public readonly body: FakeElement;
  public readonly documentElement: FakeElement;

  constructor() {
    this.documentElement = new FakeElement('html', this);
    this.head = new FakeElement('head', this);
    this.body = new FakeElement('body', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }

  getElementById(id: string): FakeElement | null {
    return this.documentElement.querySelector(`#${id}`);
  }

  querySelector(selector: string): FakeElement | null {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.documentElement.querySelectorAll(selector);
  }
}

function createFloorCardHost(
  doc: FakeDocument,
  cardType: string,
  rawPayload: string,
): { host: FakeElement; iframe: FakeElement } {
  const host = doc.createElement('div');
  host.className = 'tw-floor-card-host';
  host.dataset.twCard = cardType;

  const script = doc.createElement('script');
  script.type = 'text/plain';
  script.className = 'tw-raw-payload';
  script.textContent = rawPayload;
  host.appendChild(script);

  const iframe = doc.createElement('iframe');
  iframe.className = 'tw-floor-card';
  iframe.dataset.twCard = cardType;
  iframe.contentDocument = new FakeDocument();
  iframe.contentDocument.body.scrollHeight = 290;
  host.appendChild(iframe);

  doc.body.appendChild(host);
  return { host, iframe };
}

describe('MAIDEN-CARD-01 · <机娘> 初诞待授名态与日常状态同步态水合', () => {
  it('解析并水合初诞待授名机娘卡片：显示琥珀金脉冲横幅、出厂编号、身子特征、初生性格与授名引导', () => {
    const rawUnchristened = `
名称: 待授名
编号: RHINO-02
型号: 犀牛重型坦克机娘
序列: 次生二号机 · 同型异构
阵营: 苏联
躯体特征: 高挑丰满的北方重工体态，锁骨下镌刻暗金序列钢印，腰腹紧致且带有微温散热纹路
性格: 初生懵懂而炽热，看向指挥官时眼神专注顺从
当前状态: 刚从战车工厂二号纳米温床走出，等待指挥官赐名
`;

    const parsed = parseMaidenStatusPayload(rawUnchristened);
    expect(parsed).not.toBeNull();
    expect(parsed!.items).toHaveLength(1);

    const item = parsed!.items[0];
    expect(item.unchristened).toBe(true);
    expect(item.serial).toBe('RHINO-02');
    expect(item.model).toBe('犀牛重型坦克机娘');
    expect(item.seq).toBe('次生二号机 · 同型异构');
    expect(item.body).toContain('锁骨下镌刻暗金序列钢印');

    const doc = new FakeDocument();
    const { host, iframe } = createFloorCardHost(doc, 'maiden-status', rawUnchristened);

    const hydrated = hydrateFloorCardHost(host as unknown as HTMLElement);
    expect(hydrated).toBe(true);
    expect(host.dataset.twHydrated).toBe('true');
    expect(iframe.style.height).toBe('290px');
    expect(doc.getElementById('tw-maiden-status-card-style')).not.toBeNull();

    const cardEl = host.querySelector('[data-test="maiden-status-card"]');
    expect(cardEl).not.toBeNull();

    const bannerEl = host.querySelector('[data-test="maiden-unchristened-banner"]');
    expect(bannerEl?.textContent).toBe(
      '[NANITE EMERGENCE] // 新生机娘唤醒 · 等待指挥官命名',
    );
    expect(host.querySelector('[data-test="maiden-serial"]')?.textContent).toContain('RHINO-02');
    expect(host.querySelector('[data-test="maiden-model-seq"]')?.textContent).toContain(
      '犀牛重型坦克机娘 · 次生二号机 · 同型异构',
    );
    expect(host.querySelector('[data-test="maiden-body"]')?.textContent).toContain(
      '高挑丰满的北方重工体态',
    );
    expect(host.querySelector('[data-test="maiden-personality"]')?.textContent).toContain(
      '初生懵懂而炽热',
    );
    expect(host.querySelector('[data-test="maiden-unchristened-hint"]')?.textContent).toContain(
      '请在下一轮对话中为她赐予【专属名字】，完成正式入列登记',
    );
  });

  it('解析并水合已授名机娘日常状态卡（支持增量好感/服从徽标、社会外壳更新与特征标签）', () => {
    const rawChristened = `
- 名称: 赤星
  代号: 赤星
  编号: RHINO-02
  型号: 犀牛重型坦克机娘
  序列: 次生二号机
  HP: 满编正常
  好感: 68
  好感变化: +8
  服从: 85 (+5)
  身子: 刚完成装甲维护，额角微汗，作战服贴合修长腿部线条
  性格: 飒爽护短，被夸奖后会耳尖泛红
  当前状态: 驻守北坡二号装甲掩体
  化名: 叶莲娜
  社会外壳: 北方矿业重型机械工程师
  特征标签: [重装突击, 双联滑膛炮, 护盾共鸣]
`;

    const parsed = parseMaidenStatusPayload(rawChristened);
    expect(parsed).not.toBeNull();
    expect(parsed!.items).toHaveLength(1);

    const item = parsed!.items[0];
    expect(item.unchristened).toBe(false);
    expect(item.name).toBe('赤星');
    expect(item.affection).toBe(68);
    expect(item.affectionDelta).toBe(8);
    expect(item.obedience).toBe(85);
    expect(item.obedienceDelta).toBe(5);
    expect(item.traits).toEqual(['重装突击', '双联滑膛炮', '护盾共鸣']);

    const doc = new FakeDocument();
    const dom = buildMaidenStatusCardDom(doc as unknown as Document, parsed!);

    expect(dom.getAttribute('data-test')).toBe('maiden-status-card');
    expect(dom.querySelector('[data-test="maiden-unchristened-banner"]')).toBeNull();
    expect(dom.querySelector('[data-test="maiden-name"]')?.textContent).toBe('赤星');
    expect(dom.querySelector('[data-test="maiden-hp"]')?.textContent).toContain('满编正常');
    expect(dom.querySelector('[data-test="affection-delta"]')?.textContent).toBe('+8');
    expect(dom.querySelector('[data-test="obedience-delta"]')?.textContent).toBe('+5');
    expect(dom.querySelector('[data-test="maiden-shell"]')?.textContent).toContain(
      '叶莲娜 · 北方矿业重型机械工程师',
    );

    const traitChips = dom.querySelectorAll('[data-test="maiden-trait-chip"]');
    expect(traitChips.map(c => c.textContent)).toEqual([
      '#重装突击',
      '#双联滑膛炮',
      '#护盾共鸣',
    ]);
  });
});

describe('MAIDEN-CARD-01 · <机娘档案> 建档卷宗卡水合与手风琴折叠', () => {
  it('正确解析 <机娘档案> 卷宗载荷、应用阵营安全三色、展示延迟社会外壳空态并支持手风琴展开/收起同步高度', () => {
    const rawDossier = `
名称: 赤星
代号: 赤星
编号: RHINO-02
型号: 犀牛重型坦克机娘
序列: 次生二号机 · 同型异构
阵营: 苏联
躯体特征: 174cm 饱满匀称体态，蜜色肌肤带纳米导能微光
外观: 银白短发配赤红战术贝雷帽，披挂轻量化反应装甲披风
性格: 忠诚果敢，私下粘人
形态机制: 纳米信标轻装态 / 125mm 双联重装展开态
能力: 复合反应装甲过载、穿甲齐射信标校准
结构短板: 全功率齐射后需散热冷却 45 秒
武器: 125mm 双联装高初速滑膛炮、同轴重机枪
暴露分档: EL-1 战术伪装级
平衡位置: 正面重装突破核心
化名: 暂未编织
社会外壳: 暂未编织（基地内勤）
当前状态: 已完成指挥官赐名仪式并正式入列
触发词: 赤星、RHINO-02、犀牛二号机
`;

    const parsed = parseMaidenDossierPayload(rawDossier);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('赤星');
    expect(parsed!.serial).toBe('RHINO-02');
    expect(parsed!.seq).toBe('次生二号机 · 同型异构');
    expect(parsed!.faction).toBe('soviet');
    expect(parsed!.colors).toEqual(FACTION_DEFAULT_THEMES.soviet);
    expect(parsed!.triggers).toEqual(['赤星', 'RHINO-02', '犀牛二号机']);

    const doc = new FakeDocument();
    const { host, iframe } = createFloorCardHost(doc, 'maiden-dossier', rawDossier);

    const hydrated = hydrateFloorCardHost(host as unknown as HTMLElement);
    expect(hydrated).toBe(true);
    expect(doc.getElementById('tw-maiden-dossier-card-style')).not.toBeNull();

    const card = host.querySelector('[data-test="maiden-dossier-card"]')!;
    expect(card).not.toBeNull();
    expect(card.getAttribute('data-maiden-name')).toBe('赤星');
    expect(card.getAttribute('data-maiden-serial')).toBe('RHINO-02');
    expect(card.getAttribute('data-maiden-seq')).toBe('次生二号机 · 同型异构');
    expect(card.style.getPropertyValue('--card-primary')).toBe('#c93b2b');

    // 常驻区与社会外壳延迟编织空态断言
    expect(card.querySelector('[data-test="maiden-dossier-name"]')?.textContent).toBe('【赤星】');
    expect(card.querySelector('[data-test="maiden-dossier-body"]')?.textContent).toContain(
      '174cm 饱满匀称体态',
    );
    const deferredShell = card.querySelector('[data-test="maiden-shell-deferred"]');
    expect(deferredShell).not.toBeNull();
    expect(deferredShell?.textContent).toBe(
      '[LOCKED] 基地内勤 · 尚未安排对外伪装身份（执行外勤时解锁）',
    );

    // 手风琴默认收起，点击后展开并同步 iframe 高度
    const toggleBtn = card.querySelector('[data-test="maiden-dossier-toggle"]')!;
    expect(toggleBtn.textContent).toBe('▶ 展开战术能力与武装暴露分档');
    expect(card.querySelector('[data-test="maiden-dossier-details"]')).toBeNull();

    iframe.contentDocument!.body.scrollHeight = 460;
    toggleBtn.click();

    expect(toggleBtn.textContent).toBe('▼ 收起战术卷宗');
    expect(iframe.style.height).toBe('460px');

    const detailsPanel = card.querySelector('[data-test="maiden-dossier-details"]');
    expect(detailsPanel).not.toBeNull();
    expect(detailsPanel?.querySelector('[data-test="maiden-form-mech"]')?.textContent).toContain(
      '125mm 双联重装展开态',
    );
    expect(detailsPanel?.querySelector('[data-test="maiden-weapons"]')?.textContent).toContain(
      '125mm 双联装高初速滑膛炮',
    );
    expect(detailsPanel?.querySelector('[data-test="maiden-exposure"]')?.textContent).toContain(
      'EL-1 战术伪装级',
    );

    // 再次点击收起
    iframe.contentDocument!.body.scrollHeight = 280;
    toggleBtn.click();
    expect(toggleBtn.textContent).toBe('▶ 展开战术能力与武装暴露分档');
    expect(card.querySelector('[data-test="maiden-dossier-details"]')).toBeNull();
    expect(iframe.style.height).toBe('280px');
  });

  it('兼容 aerospace-contract 卡片类型并映射至 space-contract 水合分支', () => {
    const doc = new FakeDocument();
    const { host } = createFloorCardHost(
      doc,
      'aerospace-contract',
      '编号: SC-108\n名称: 天眼低轨侦察星座发射\n运载火箭: 联盟-5\n报酬: 3500',
    );

    const count = scanAndHydrateFloorCards(doc as unknown as ParentNode);
    expect(count).toBe(1);
    expect(host.dataset.twHydrated).toBe('true');
    const spaceCard = host.querySelector('[data-test="space-contract-card"]');
    expect(spaceCard).not.toBeNull();
    expect(spaceCard?.getAttribute('data-contract-id')).toBe('SC-108');
  });
});

describe('MAIDEN-CARD-01 · MaidenDossierCard.vue 与 MaidenStatusCard.vue SSR 渲染验证', () => {
  it('MaidenDossierCard.vue 支持 SSR 渲染及手风琴展开控制', async () => {
    const MaidenDossierCardComp = await loadMaidenDossierCardSfc();
    let exposedRef:
      | {
          detailsOpen: Ref<boolean>;
          toggleDetails: () => void;
        }
      | undefined;

    const dossierPayload = `
名称: 霜星
编号: PRISM-02
型号: 光棱坦克机娘
序列: 次生二号机
阵营: 盟军
躯体特征: 纤细高挑的光学偏振体态
外观: 金发碧眼，纯白礼装夹克
性格: 冷静精密
化名: 艾琳·诺克斯
社会外壳: 精密光学研究所访问学者
能力: 折射光束齐射
`;

    const htmlCollapsed = await renderToString(
      createSSRApp({
        render: () =>
          h(MaidenDossierCardComp, {
            payload: dossierPayload,
          }),
      }),
    );

    expect(htmlCollapsed).toContain('data-test="maiden-dossier-card"');
    expect(htmlCollapsed).toContain('--card-primary:#2563eb');
    expect(htmlCollapsed).toContain('data-test="maiden-shell-woven"');
    expect(htmlCollapsed).toContain('艾琳·诺克斯 · 精密光学研究所访问学者');
    expect(htmlCollapsed).not.toContain('data-test="maiden-dossier-details"');

    const SetupComp = MaidenDossierCardComp as Component & {
      setup?: (
        props: Record<string, unknown>,
        ctx: { expose: (exp: unknown) => void; emit: (e: string, ...args: unknown[]) => void },
      ) => unknown;
    };
    SetupComp.setup?.(
      { payload: dossierPayload },
      {
        expose: exp => {
          exposedRef = exp as typeof exposedRef;
        },
        emit: () => {},
      },
    );
    expect(exposedRef).toBeDefined();
    expect(exposedRef!.detailsOpen.value).toBe(false);
    exposedRef!.toggleDetails();
    expect(exposedRef!.detailsOpen.value).toBe(true);

    const htmlExpanded = await renderToString(
      createSSRApp({
        render: () =>
          h(MaidenDossierCardComp, {
            payload: dossierPayload,
            initialExpanded: true,
          }),
      }),
    );

    expect(htmlExpanded).toContain('data-test="maiden-dossier-details"');
    expect(htmlExpanded).toContain('折射光束齐射');
  });

  it('MaidenStatusCard.vue 支持初诞待授名态与日常状态同步态的 SSR 渲染', async () => {
    const MaidenStatusCardComp = await loadMaidenStatusCardSfc();

    const unchristenedHtml = await renderToString(
      createSSRApp({
        render: () =>
          h(MaidenStatusCardComp, {
            payload: '名称: 待授名\n编号: Kirov-02\n型号: 基洛夫空艇机娘\n身子: 丰腴高挑的航空重装甲体态',
          }),
      }),
    );

    expect(unchristenedHtml).toContain('data-test="maiden-status-card"');
    expect(unchristenedHtml).toContain('data-test="maiden-unchristened-banner"');
    expect(unchristenedHtml).toContain('Kirov-02');
    expect(unchristenedHtml).toContain('丰腴高挑的航空重装甲体态');

    const christenedHtml = await renderToString(
      createSSRApp({
        render: () =>
          h(MaidenStatusCardComp, {
            name: '天穹',
            serial: 'Kirov-02',
            model: '基洛夫空艇机娘',
            hp: '满编正常',
            affection: 72,
            affectionDelta: 12,
            obedience: 90,
            body: '换装高空防寒披肩',
            traits: ['高空轰炸', '氦气护盾'],
          }),
      }),
    );

    expect(christenedHtml).toContain('data-test="maiden-name"');
    expect(christenedHtml).toContain('天穹');
    expect(christenedHtml).toContain('data-test="affection-delta"');
    expect(christenedHtml).toContain('+12');
    expect(christenedHtml).toContain('#高空轰炸');
  });
});
