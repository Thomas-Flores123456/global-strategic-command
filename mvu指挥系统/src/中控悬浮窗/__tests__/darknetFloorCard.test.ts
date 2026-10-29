import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDarknetTerminalCardDom,
  hydrateFloorCardHost,
  parseDarknetTerminalPayload,
} from '../cards/floorCardHydrator';

class MockElement {
  tagName: string;
  className = '';
  type = '';
  textContent = '';
  innerHTML = '';
  scrollHeight = 320;
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
  contentDocument?: MockDocument;
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
    return this.textContent + ' ' + this.children.map(c => c.collectText()).join(' ');
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

const SAMPLE_DARKNET_PAYLOAD = `
<暗网>
市场状态: 正常连接
拍卖状态: 竞价中
距离下次拍卖: 0h
在售商品:
  - 编号: dn_item_01
    名称: 高纯度构造型纳米母液（50单位）
    类别: 战略资源
    价格: 1800
    库存: 2
    简介: 跨维工业节点富余标的，购买后自动充入基地纳米库存。
求购悬赏:
  - 编号: dn_bounty_01
    目标: 荒坂义体神经网底层协议样本
    类别: 情报数据
    悬赏金: 3500
    状态: 待交割
    简介: 某赛博位面反抗军高价求购，上传对应高可信度情报或实物样本即可领赏。
当期拍卖:
  - 编号: dn_auc_01
    拍品: 废弃天基动能武器火控黑匣子
    卖方: 跨维流亡军工署
    起拍价: 6000
    当前最高价: 9500
    领先方: 我方指挥部
    轮次: 第2轮叫价
    状态: 竞价中
    简介: 内含残缺轨道火控解算参数，拍下后可大幅加速天基工程研究。
本轮交割:
  - 动作: 售出信息
    标的: 北坡矿区灵脉分布与护山阵眼详图
    查重键: intel_beipo_spirit_vein_map
    资金变动: +1500
    说明: 首次上传跨位面灵脉测绘数据，通过唯一性核验，资金已划拨。
  - 动作: 购买商品
    标的: 高纯度构造型纳米母液（50单位）
    资金变动: -1800
    说明: 经超维暗网中继站传质舱接收完成，已入库。
  - 动作: 竞拍出价
    编号: dn_auc_01
    标的: 废弃天基动能武器火控黑匣子
    出价: 9500
    领先方: 我方指挥部
    说明: 指挥官在包厢内举牌压过『铁幕残党』，暂居第一顺位（落槌前不扣款）。
</暗网>
`;

describe('DARKNET-CARD-01 · <暗网> 超维暗网中继终端楼层卡片解析与水合', () => {
  it('parseDarknetTerminalPayload 正常解析包含本轮交割、当期拍卖、在售商品、求购悬赏的 <暗网> 文本', () => {
    const parsed = parseDarknetTerminalPayload(SAMPLE_DARKNET_PAYLOAD);
    expect(parsed).not.toBeNull();
    expect(parsed!.marketStatus).toBe('正常连接');
    expect(parsed!.auctionStatus).toBe('竞价中');
    expect(parsed!.nextAuction).toBe('0h');
    expect(parsed!.isAuctionBidding).toBe(true);

    // 本轮交割
    expect(parsed!.settlements).toHaveLength(3);
    expect(parsed!.settlements[0]).toEqual({
      action: '售出信息',
      target: '北坡矿区灵脉分布与护山阵眼详图',
      creditsDelta: 1500,
      creditsDeltaText: '+1500 CREDITS',
      bidPrice: undefined,
      dedupeKey: 'intel_beipo_spirit_vein_map',
      note: '首次上传跨位面灵脉测绘数据，通过唯一性核验，资金已划拨。',
    });
    expect(parsed!.settlements[1].creditsDelta).toBe(-1800);
    expect(parsed!.settlements[1].creditsDeltaText).toBe('-1800 CREDITS');
    expect(parsed!.settlements[2].action).toBe('竞拍出价');
    expect(parsed!.settlements[2].bidPrice).toBe(9500);
    expect(parsed!.settlements[2].creditsDeltaText).toBe('出价 9500 CREDITS (未落槌不扣款)');

    // 当期拍卖
    expect(parsed!.auctions).toHaveLength(1);
    expect(parsed!.auctions[0]).toEqual({
      id: 'dn_auc_01',
      name: '废弃天基动能武器火控黑匣子',
      seller: '跨维流亡军工署',
      startPrice: 6000,
      currentPrice: 9500,
      leader: '我方指挥部',
      round: '第2轮叫价',
      status: '竞价中',
      desc: '内含残缺轨道火控解算参数，拍下后可大幅加速天基工程研究。',
    });

    // 在售商品 & 求购悬赏
    expect(parsed!.items).toHaveLength(1);
    expect(parsed!.items[0].name).toBe('高纯度构造型纳米母液（50单位）');
    expect(parsed!.items[0].price).toBe(1800);
    expect(parsed!.items[0].stock).toBe(2);

    expect(parsed!.bounties).toHaveLength(1);
    expect(parsed!.bounties[0].target).toBe('荒坂义体神经网底层协议样本');
    expect(parsed!.bounties[0].rewardCredits).toBe(3500);
    expect(parsed!.bounties[0].status).toBe('待交割');

    // 空输入防御
    expect(parseDarknetTerminalPayload('')).toBeNull();
    expect(parseDarknetTerminalPayload('<暗网>   </暗网>')).toBeNull();
  });

  it('hydrateFloorCardHost 对 data-tw-card="darknet-terminal" 成功水合，渲染交割金额、拍品领先方、黑市手风琴交互且二次调用幂等返回 false', () => {
    const doc = new MockDocument();
    const host = doc.createElement('div');
    host.className = 'tw-floor-card-host';
    host.setAttribute('data-tw-card', 'darknet-terminal');

    const script = doc.createElement('script');
    script.className = 'tw-raw-payload';
    script.textContent = SAMPLE_DARKNET_PAYLOAD;
    host.appendChild(script);

    const iframeDoc = new MockDocument();
    const iframe = doc.createElement('iframe');
    iframe.className = 'tw-floor-card';
    iframe.setAttribute('data-tw-card', 'darknet-terminal');
    iframe.contentDocument = iframeDoc;
    host.appendChild(iframe);
    doc.body.appendChild(host);

    // 首次水合成功
    const firstResult = hydrateFloorCardHost(host as unknown as HTMLElement);
    expect(firstResult).toBe(true);
    expect(host.getAttribute('data-tw-hydrated')).toBe('true');

    // 验证卡片关键内容渲染
    const card = host.querySelector('[data-test="darknet-terminal-card"]')!;
    expect(card).not.toBeNull();
    const allText = card.collectText();
    expect(allText).toContain('🕶️ 超维暗网中继终端');
    expect(allText).toContain('市场 · 正常连接');
    expect(allText).toContain('🔥 拍卖竞价中 (竞价中)');
    expect(allText).toContain('+1500 CREDITS');
    expect(allText).toContain('-1800 CREDITS');
    expect(allText).toContain('交易单号: intel_beipo_spirit_vein_map');
    expect(allText).toContain('废弃天基动能武器火控黑匣子');
    expect(allText).toContain('当前最高价: 9500 CREDITS');
    expect(allText).toContain('领先方: 我方指挥部');
    expect(allText).toContain('轮次: 第2轮叫价');

    // 验证底部黑市与悬赏手风琴折叠/展开与高度同步回调
    const accordion = card.querySelector('[data-test="darknet-shelf-accordion"]')!;
    const toggleBtn = card.querySelector('[data-test="darknet-accordion-toggle"]')!;
    const accordionBody = card.querySelector('[data-test="darknet-accordion-body"]')!;

    expect(accordion.getAttribute('data-expanded')).toBe('false');
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(toggleBtn.textContent).toBe('▶ 当期黑市货架与求购悬赏 (2)');
    expect(accordionBody.style.display).toBe('none');

    // 修改 iframeDoc.body.scrollHeight 验证点击手风琴时触发 syncIframeHeight
    iframeDoc.body.scrollHeight = 520;
    toggleBtn.click();

    expect(accordion.getAttribute('data-expanded')).toBe('true');
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    expect(toggleBtn.textContent).toBe('▴ 当期黑市货架与求购悬赏 (2)');
    expect(accordionBody.style.display).toBe('grid');
    expect(iframe.style.height).toBe('520px');

    // 再次点击收起
    toggleBtn.click();
    expect(accordion.getAttribute('data-expanded')).toBe('false');
    expect(accordionBody.style.display).toBe('none');

    // 二次调用幂等返回 false
    const secondResult = hydrateFloorCardHost(host as unknown as HTMLElement);
    expect(secondResult).toBe(false);
  });

  it('buildDarknetTerminalCardDom 与 DarknetTerminalCard.vue SFC 契约一致', () => {
    const sfcPath = resolve(__dirname, '../cards/DarknetTerminalCard.vue');
    const sfcContent = readFileSync(sfcPath, 'utf-8');
    expect(sfcContent).toContain('data-test="darknet-terminal-card"');
    expect(sfcContent).toContain('🕶️ 超维暗网中继终端');
    expect(sfcContent).toContain('SUBSPACE DARKNET BROKER');
    expect(sfcContent).toContain('#f59e0b');
    expect(sfcContent).toContain('#38bdf8');

    const doc = new MockDocument();
    const parsed = parseDarknetTerminalPayload(SAMPLE_DARKNET_PAYLOAD)!;
    const onResize = vi.fn();
    const dom = buildDarknetTerminalCardDom(doc as unknown as Document, parsed, onResize) as unknown as MockElement;
    const toggle = dom.querySelector('[data-test="darknet-accordion-toggle"]')!;
    toggle.click();
    expect(onResize).toHaveBeenCalledTimes(1);
  });
});
