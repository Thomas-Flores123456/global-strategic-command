import { describe, expect, it } from 'vitest';
import {
  hydrateFloorCardHost,
  hydrateFloorCardsInElement,
  parseAerospaceContractPayload,
  parseChronoStepPayload,
  parseCodexPayload,
  parseDataPatchPayload,
  parseDeploymentOrderPayload,
  parseEconomyChainsPayload,
  parseEngineeringOrderPayload,
  parseIntelDossierPayload,
  parseProductionSchedulePayload,
  parseTacticalEventPayload,
  rescueBareProtocolBlocksInDom,
  scanAndHydrateFloorCards,
} from '../cards/floorCardHydrator';
import {
  sanitizeLegacyBattlefieldTailRegex,
  SYSTEM_TAVERN_REGEX_REGISTRY,
} from '../../红警指挥系统/worldbook/tavernRegexPipeline';

class MockElement {
  tagName: string;
  className = '';
  type = '';
  textContent = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> & { setProperty: (k: string, v: string) => void } = Object.assign(
    {},
    {
      setProperty(k: string, v: string) {
        this[k] = v;
      },
    },
  );
  children: MockElement[] = [];
  parentNode: MockElement | null = null;
  ownerDocument: MockDocument;
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Array<() => void>>();

  constructor(tag: string, doc: MockDocument) {
    this.tagName = tag.toLowerCase();
    this.ownerDocument = doc;
  }

  setAttribute(name: string, val: string): void {
    const str = String(val);
    this.attrs.set(name, str);
    if (name === 'class') this.className = str;
    if (name.startsWith('data-')) {
      const camel = name
        .slice(5)
        .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
      this.dataset[camel] = str;
    }
  }

  getAttribute(name: string): string | null {
    if (name === 'class') return this.className || null;
    if (this.attrs.has(name)) return this.attrs.get(name)!;
    if (name.startsWith('data-')) {
      const camel = name
        .slice(5)
        .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
      return this.dataset[camel] ?? null;
    }
    return null;
  }

  appendChild(child: MockElement): MockElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(evt: string, cb: () => void): void {
    const arr = this.listeners.get(evt) ?? [];
    arr.push(cb);
    this.listeners.set(evt, arr);
  }

  click(): void {
    for (const cb of this.listeners.get('click') ?? []) {
      cb();
    }
  }

  private matches(selector: string): boolean {
    const attrMatch = selector.match(/^\[([a-zA-Z0-9_-]+)="([^"]+)"\]$/);
    if (attrMatch) {
      return this.getAttribute(attrMatch[1]) === attrMatch[2];
    }
    const tagCls = selector.match(/^([a-zA-Z0-9_-]+)?\.([a-zA-Z0-9_-]+)$/);
    if (tagCls) {
      const [, t, c] = tagCls;
      if (t && this.tagName !== t.toLowerCase()) return false;
      return this.className.split(/\s+/).includes(c);
    }
    return this.tagName === selector.toLowerCase();
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const out: MockElement[] = [];
    const walk = (n: MockElement) => {
      for (const ch of n.children) {
        if (ch.matches(selector)) out.push(ch);
        walk(ch);
      }
    };
    walk(this);
    return out;
  }

  collectText(): string {
    if (this.children.length === 0) return this.textContent;
    return this.textContent + this.children.map(c => c.collectText()).join(' ');
  }
}

class MockDocument {
  body: MockElement;
  documentElement: MockElement;
  head: MockElement;
  constructor() {
    this.documentElement = new MockElement('html', this);
    this.head = new MockElement('head', this);
    this.body = new MockElement('body', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string): MockElement {
    return new MockElement(tag, this);
  }
}

function makeHost(doc: MockDocument, cardType: string, payload: string): MockElement {
  const host = doc.createElement('div');
  host.className = 'tw-floor-card-host';
  host.setAttribute('data-tw-card', cardType);
  const script = doc.createElement('script');
  script.className = 'tw-raw-payload';
  script.textContent = payload;
  host.appendChild(script);
  doc.body.appendChild(host);
  return host;
}

describe('CARD-ALL-PROTOCOLS-01 · 全系 11 类协议标签水合、方案 C 渲染与默认精简折叠机架导轨', () => {
  it('SYSTEM_TAVERN_REGEX_REGISTRY 注册全部 11 类楼层协议标签，且旧 <战况> 尾部吞噬段被精确剥离', () => {
    const names = SYSTEM_TAVERN_REGEX_REGISTRY.map(r => r.script_name);
    expect(names).toContain('系统·阵营解锁卷宗卡片挂载');
    expect(names).toContain('系统·航天工程合同交互终端挂载');
    expect(names).toContain('系统·机娘心智建档卷宗卡片挂载');
    expect(names).toContain('系统·机娘初诞与状态终端挂载');
    expect(names).toContain('系统·总参装备与科技列装图鉴挂载');
    expect(names).toContain('系统·战区加密态势电报卡片挂载');
    expect(names).toContain('系统·总参重工基建蓝图终端挂载');
    expect(names).toContain('系统·兵工流水线排产调度终端挂载');
    expect(names).toContain('系统·战区机密情报卷宗卡片挂载');
    expect(names).toContain('系统·纳米固件量化重构终端挂载');
    expect(names).toContain('系统·战术时钟步进标尺挂载');

    const legacyRegex = '(<战况>[\\s\\S]*?<\\/战况>)[\\s\\S]*$';
    expect(sanitizeLegacyBattlefieldTailRegex(legacyRegex)).toBe('(<战况>[\\s\\S]*?<\\/战况>)');
  });

  it('解析并水合 <图鉴>、<事件>、<工程>、<排产计划>、<扩展档案>、<数据更新> 并验证默认折叠导轨与点击展开切换', () => {
    const doc = new MockDocument();

    // 1. <图鉴>
    const codexRaw = `
- 名称：盟军兵营
  类别：建筑
  简介：盟军基础步兵训练与战备整编母体设施。
- 名称：个人装备工程学
  类别：科技
  简介：单兵防弹插板与战术通信终端标准化工程。
`;
    const parsedCodex = parseCodexPayload(codexRaw);
    expect(parsedCodex?.items).toHaveLength(2);
    expect(parsedCodex?.items[0].code).toBe('BLD');
    expect(parsedCodex?.items[1].code).toBe('TECH');

    const codexHost = makeHost(doc, 'codex-entry', codexRaw);
    expect(hydrateFloorCardHost(codexHost as unknown as HTMLElement)).toBe(true);
    const codexCard = codexHost.querySelector('[data-test="codex-entry-card"]')!;
    expect(codexCard).not.toBeNull();
    // 默认处于精简折叠态
    expect(codexCard.getAttribute('data-collapsed')).toBe('true');
    expect(codexCard.className).toContain('is-collapsed');

    const toggleBtn = codexCard.querySelector('[data-test="compact-rack-toggle"]')!;
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(toggleBtn.textContent).toBe('▶ 展开卷宗');

    // 点击展开
    toggleBtn.click();
    expect(codexCard.getAttribute('data-collapsed')).toBe('false');
    expect(codexCard.className).toContain('is-expanded');
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    expect(toggleBtn.textContent).toBe('▴ 折叠收起');

    // 再次点击收起
    toggleBtn.click();
    expect(codexCard.getAttribute('data-collapsed')).toBe('true');

    // 2. <事件>
    const eventHost = makeHost(
      doc,
      'tactical-event',
      '事件：MCV展开\n载具：MCV（盟军）\n基地：前沿第一基地',
    );
    expect(hydrateFloorCardHost(eventHost as unknown as HTMLElement)).toBe(true);
    const eventCard = eventHost.querySelector('[data-test="tactical-event-card"]')!;
    expect(eventCard.getAttribute('data-collapsed')).toBe('true');
    expect(eventCard.collectText()).toContain('MCV展开');
    expect(eventCard.collectText()).toContain('前沿第一基地');

    // 3. <工程>
    const engHost = makeHost(
      doc,
      'engineering-order',
      '工程名称：深井地热并网改造\n基地：前沿第一基地\n工期：6小时\n状态：施工中\n效果：基地基础电力上限+300',
    );
    expect(hydrateFloorCardHost(engHost as unknown as HTMLElement)).toBe(true);
    const engCard = engHost.querySelector('[data-test="engineering-order-card"]')!;
    expect(engCard.getAttribute('data-collapsed')).toBe('true');
    expect(engCard.collectText()).toContain('深井地热并网改造');

    // 4. <排产计划>
    const prodHost = makeHost(
      doc,
      'production-schedule',
      '单位：犀牛主战坦克\n数量：x4\n基地：北方红星分基地\n产线：重型装甲总装线\n耗时：2小时',
    );
    expect(hydrateFloorCardHost(prodHost as unknown as HTMLElement)).toBe(true);
    const prodCard = prodHost.querySelector('[data-test="production-schedule-card"]')!;
    expect(prodCard.getAttribute('data-collapsed')).toBe('true');
    expect(prodCard.collectText()).toContain('犀牛主战坦克');

    // 5. <扩展档案>
    const intelHost = makeHost(
      doc,
      'intel-dossier',
      '名称：黑曜石防务财团\n类型：势力档案\n归属：中立军工复合体\n威胁：中度关注\n摘要：控制环太平洋多座深水散货港口与稀有金属转运站。',
    );
    expect(hydrateFloorCardHost(intelHost as unknown as HTMLElement)).toBe(true);
    const intelCard = intelHost.querySelector('[data-test="intel-dossier-card"]')!;
    expect(intelCard.getAttribute('data-collapsed')).toBe('true');
    expect(intelCard.collectText()).toContain('黑曜石防务财团');

    // 6. <数据更新>
    const patchHost = makeHost(
      doc,
      'data-patch',
      '目标条目：盟军兵营\n世界书：建筑与产线主库\n电力负载：-20\n建造成本：$500',
    );
    expect(hydrateFloorCardHost(patchHost as unknown as HTMLElement)).toBe(true);
    const patchCard = patchHost.querySelector('[data-test="data-patch-card"]')!;
    expect(patchCard.getAttribute('data-collapsed')).toBe('true');
    expect(patchCard.collectText()).toContain('盟军兵营');
  });

  it('解析并水合 <timePast> 战术时钟步进横幅（0 D 0 H 30 M）', () => {
    const doc = new MockDocument();
    const parsed = parseChronoStepPayload('0 D 0 H 30 M');
    expect(parsed).not.toBeNull();
    expect(parsed?.days).toBe(0);
    expect(parsed?.hours).toBe(0);
    expect(parsed?.minutes).toBe(30);
    expect(parsed?.formattedCode).toBe('+00D 00H 30M');
    expect(parsed?.humanLabel).toBe('战区时钟推进 30分钟');

    const chronoHost = makeHost(doc, 'chrono-step', '0 D 0 H 30 M');
    expect(hydrateFloorCardHost(chronoHost as unknown as HTMLElement)).toBe(true);
    const chronoCard = chronoHost.querySelector('[data-test="chrono-step-card"]')!;
    expect(chronoCard).not.toBeNull();
    expect(chronoCard.collectText()).toContain('+00D 00H 30M');
    expect(chronoCard.collectText()).toContain('战区时钟推进 30分钟');
  });

  it('解析并水合新增 deployment-order (<部署>/<展开>)、economy-chains (<资金链>) 及增强版 <生产> 与 <发射中心>/<航天>', () => {
    const doc = new MockDocument();

    // 1. <部署> -> deployment-order
    const deployRaw = `<部署>
行动: 展开
单位: 盟军机动建设车
新基地: 恶土前哨主基地
位置: 北坡掩体谷地
防区:
  - 洞口防红外伪装网
建筑:
  - 盟军建造厂
</部署>`;
    const parsedDeploy = parseDeploymentOrderPayload(deployRaw);
    expect(parsedDeploy.items).toHaveLength(1);
    expect(parsedDeploy.items[0].action).toBe('展开');
    expect(parsedDeploy.items[0].unit).toBe('盟军机动建设车');
    expect(parsedDeploy.items[0].base).toBe('恶土前哨主基地');
    expect(parsedDeploy.items[0].sectors).toContain('洞口防红外伪装网');
    expect(parsedDeploy.lineCount).toBeGreaterThanOrEqual(6);

    const deployHost = makeHost(doc, 'deployment-order', deployRaw);
    expect(hydrateFloorCardHost(deployHost as unknown as HTMLElement)).toBe(true);
    const deployCard = deployHost.querySelector('[data-test="deployment-order-card"]')!;
    expect(deployCard).not.toBeNull();
    expect(deployCard.collectText()).toContain('DEPLOY // 战区部署与基地展开回执');
    expect(deployCard.collectText()).toContain('盟军机动建设车');
    expect(deployCard.collectText()).toContain('恶土前哨主基地');

    // 2. <资金链> -> economy-chains
    const chainsRaw = `<资金链>
- 名称: 荒坂外围稀有金属走私线
  状态: 运转中
  基础日收: 650
  效率: 110%
  剩余容量: 15000
  基地: 恶土前哨主基地
  描述: 通过北坡秘密货场向自由港每日输送精炼矿砂
</资金链>`;
    const parsedChains = parseEconomyChainsPayload(chainsRaw);
    expect(parsedChains.items).toHaveLength(1);
    expect(parsedChains.items[0].name).toBe('荒坂外围稀有金属走私线');
    expect(parsedChains.items[0].dailyRate).toBe('+650/日');
    expect(parsedChains.items[0].efficiency).toBe('110%');

    const chainsHost = makeHost(doc, 'economy-chains', chainsRaw);
    expect(hydrateFloorCardHost(chainsHost as unknown as HTMLElement)).toBe(true);
    const chainsCard = chainsHost.querySelector('[data-test="economy-chains-card"]')!;
    expect(chainsCard).not.toBeNull();
    expect(chainsCard.collectText()).toContain('CHAIN // 战区多元资金链态势');
    expect(chainsCard.collectText()).toContain('荒坂外围稀有金属走私线');
    expect(chainsCard.collectText()).toContain('+650/日');

    // 3. <生产> 特批交割块 -> production-schedule
    const deliveryRaw = `<生产>
- 名称: 盟军发电厂
  类型: 建造
  基地: 恶土前哨主基地
  状态: 完工
</生产>`;
    const parsedDelivery = parseProductionSchedulePayload(deliveryRaw);
    expect(parsedDelivery.items).toHaveLength(1);
    expect(parsedDelivery.items[0].unit).toBe('盟军发电厂');
    expect(parsedDelivery.items[0].line).toBe('建造');
    expect(parsedDelivery.items[0].status).toBe('完工');

    // 4. <发射中心> 块 -> aerospace-contract
    const launchCenterRaw = `<发射中心>
名称: 南海文昌大型航天发射综合体
基地: 南海文昌滨海分基地
等级: Tier-3
状态: 运转中
</发射中心>`;
    const parsedLc = parseAerospaceContractPayload(launchCenterRaw);
    expect(parsedLc.id).toBe('LC-01');
    expect(parsedLc.title).toBe('南海文昌大型航天发射综合体');
    expect(parsedLc.base).toBe('南海文昌滨海分基地');
    expect(parsedLc.kind).toBe('Tier-3');
    expect(parsedLc.status).toBe('运转中');

    const lcHost = makeHost(doc, 'aerospace-contract', launchCenterRaw);
    expect(hydrateFloorCardHost(lcHost as unknown as HTMLElement)).toBe(true);
    expect(lcHost.collectText()).toContain('南海文昌大型航天发射综合体');
  });

  it('同楼多摘要（<摘要> + <中摘要>/<大摘要>）合署渲染进首张 story-summary 卡片，并支持裸协议标签 DOM 兜底救援（不误伤普通叙事段落）', () => {
    const doc = new MockDocument();
    const mesText = doc.createElement('div');
    mesText.className = 'mes_text';
    doc.body.appendChild(mesText);

    // 普通叙事段落提及 <部署> 标签名，严禁被误伤
    const narrativeP = doc.createElement('p');
    narrativeP.textContent = '指挥官在沙盘前审阅了<部署>与<中摘要>的战术预案，下令部队按计划推进。';
    mesText.appendChild(narrativeP);

    // 第一个 story-summary 宿主（含 <摘要>）
    const summaryHost1 = doc.createElement('div');
    summaryHost1.className = 'tw-floor-card-host';
    summaryHost1.setAttribute('data-tw-card', 'story-summary');
    const summaryScript1 = doc.createElement('script');
    summaryScript1.className = 'tw-raw-payload';
    summaryScript1.textContent = '<摘要>\n时间: 第一日 09:00\n纪要: 主基地展开并完成发电厂立项。\n关键词: 基地展开、发电厂\n</摘要>';
    summaryHost1.appendChild(summaryScript1);
    mesText.appendChild(summaryHost1);

    // 第二个同楼裸 <p>&lt;中摘要&gt;...&lt;/中摘要&gt;</p>（如 #82~#100 残留）
    const bareMidSummaryP = doc.createElement('p');
    bareMidSummaryP.textContent = '<中摘要>\n阶段: 北坡初建期\n总结: 完成掩体清理与首座发电厂并网。\n</中摘要>';
    mesText.appendChild(bareMidSummaryP);

    // 第三个同楼裸 <p>&lt;部署&gt;...&lt;/部署&gt;</p>（如 #64 残留）
    const bareDeployP = doc.createElement('p');
    bareDeployP.textContent = '<部署>\n行动: 展开\n单位: 盟军基地车\n新基地: 北坡一号基地\n</部署>';
    mesText.appendChild(bareDeployP);

    // 执行统一扫描与兜底水合
    const rescued = rescueBareProtocolBlocksInDom(mesText as unknown as ParentNode);
    expect(rescued).toBe(2);
    const hydrated = scanAndHydrateFloorCards(mesText as unknown as ParentNode);
    expect(hydrated).toBeGreaterThanOrEqual(2);

    // 1. 普通叙事段落完好无损
    expect(narrativeP.style.display).not.toBe('none');

    // 2. 裸 <中摘要> 被隐藏且内容已合署进第一个 story-summary 宿主
    expect(bareMidSummaryP.style.display).toBe('none');
    expect(bareMidSummaryP.getAttribute('data-tw-merged-summary')).toBe('true');
    expect(summaryScript1.textContent).toContain('<中摘要>');
    expect(summaryHost1.getAttribute('data-tw-hydrated')).toBe('true');

    // 3. 裸 <部署> 原地转换为 deployment-order 宿主并完成战术卡片水合
    expect(bareDeployP.style.display).toBe('none');
    const rescuedDeployCard = mesText.querySelector('[data-test="deployment-order-card"]');
    expect(rescuedDeployCard).not.toBeNull();
    expect(rescuedDeployCard!.collectText()).toContain('北坡一号基地');
  });

  it('模拟真机 #100 楼 DOM：当底部 <p>&lt;中摘要&gt;... 的闭标签 </中摘要> 被 DOMPurify 剥离时，hydrateFloorCardsInElement 仍能合署渲染出 .tw-story-summary-extra-section 并彻底隐藏底部裸 <p>', () => {
    const doc = new MockDocument();
    const mesEl = doc.createElement('div');
    mesEl.className = 'mes_text';
    doc.body.appendChild(mesEl);

    // 顶部已有 .custom-tw-floor-card-host[data-tw-card="story-summary"]（由正则替换 <摘要> 生成，内部 script.tw-raw-payload 不含外层 <摘要> 标签）
    const primaryHost = doc.createElement('div');
    primaryHost.className = 'custom-tw-floor-card-host';
    primaryHost.setAttribute('data-tw-card', 'story-summary');
    const primaryScript = doc.createElement('script');
    primaryScript.className = 'tw-raw-payload';
    primaryScript.textContent =
      '时间: 第五幕终章 18:00\n纪要: 北翼峡谷防线全线告捷，百楼战役圆满收官。\n关键词: 北翼峡谷大捷, 百楼收官';
    primaryHost.appendChild(primaryScript);
    mesEl.appendChild(primaryHost);

    // 模拟真机同时存在 chat[0].mes（含 <摘要> + <中摘要>）与 DOM 底部被 DOMPurify 剥离了闭标签 </中摘要> 的裸 <p>
    const prevChat = (globalThis as Record<string, unknown>).chat;
    (globalThis as Record<string, unknown>).chat = [
      {
        mes: `<摘要>
时间: 第五幕终章 18:00
纪要: 北翼峡谷防线全线告捷，百楼战役圆满收官。
关键词: 北翼峡谷大捷, 百楼收官
</摘要>

<中摘要>
范围: 82-100
标题: 第五幕·三级记忆熔铸与夜之城天穹破晓百楼大捷
内容: 自82楼起指挥部完成三级记忆熔铸与北翼峡谷防线决战，彻底粉碎荒坂外围封锁。
关键词: [三级记忆压缩, R2-S6分水岭, 北翼峡谷大捷, 百楼收官]
</中摘要>`,
      },
    ];

    try {
      const ctx = { mesid: 0, mesElement: mesEl as unknown as HTMLElement };
      // 模拟顶部主卡片在底部裸 <p> 被救援前已先行水合过一次
      expect(hydrateFloorCardHost(primaryHost as unknown as HTMLElement, ctx)).toBe(true);

      // 底部有一个被 Showdown + DOMPurify 剥离了闭标签 </中摘要> 的裸 <p>
      const strippedCloseMidSummaryP = doc.createElement('p');
      strippedCloseMidSummaryP.textContent = `<中摘要>
范围: 82-100
标题: 第五幕·三级记忆熔铸与夜之城天穹破晓百楼大捷
内容: 自82楼起指挥部完成三级记忆熔铸与北翼峡谷防线决战，彻底粉碎荒坂外围封锁。
关键词: [三级记忆压缩, R2-S6分水岭, 北翼峡谷大捷, 百楼收官]`;
      mesEl.appendChild(strippedCloseMidSummaryP);

      // 执行 hydrateFloorCardsInElement(mesEl, ctx)
      hydrateFloorCardsInElement(mesEl as unknown as ParentNode, ctx);

      // 1) 顶部 story-summary 卡片合署渲染出小摘要 + 中摘要，且 .tw-story-summary-extra-section 严格等于 1（绝不因 rawMessage 与裸 <p> 双源而重复渲染为 2 个）
      const extraSections = primaryHost.querySelectorAll('.tw-story-summary-extra-section');
      expect(extraSections).toHaveLength(1);
      const mergedBadges = primaryHost.querySelectorAll('.is-merged-badge');
      expect(mergedBadges).toHaveLength(1);
      expect(extraSections[0].collectText()).toContain(
        '第五幕·三级记忆熔铸与夜之城天穹破晓百楼大捷',
      );
      expect(extraSections[0].collectText()).toContain('82-100');
      expect(primaryHost.collectText()).toContain('北翼峡谷防线全线告捷');

      // 2) 底部的 <p>&lt;中摘要&gt;...</p> 被彻底隐藏，不再裸露在楼层中
      expect(strippedCloseMidSummaryP.style.display).toBe('none');
      expect(strippedCloseMidSummaryP.getAttribute('data-tw-merged-summary')).toBe('true');
    } finally {
      (globalThis as Record<string, unknown>).chat = prevChat;
    }
  });
});
