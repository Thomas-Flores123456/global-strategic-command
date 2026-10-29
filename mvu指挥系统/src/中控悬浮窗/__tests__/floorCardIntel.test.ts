/**
 * floorCardIntel.test.ts —— FD-35 PKG-A <情报> 与 <世界演变> 正则拆分及 world-evolution-stealth 楼层静默隐藏双模式单测
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getWorldEvolutionFloorMode,
  hydrateFloorCardHost,
  mountTacticalIntelCard,
  mountWorldEvolutionStealthHost,
  refreshAllWorldEvolutionStealthHosts,
  setWorldEvolutionFloorMode,
  WORLD_EVO_FLOOR_MODE_STORAGE_KEY,
} from '../cards/floorCardHydrator';
import {
  SYSTEM_TAVERN_REGEX_REGISTRY,
  TACTICAL_INTEL_REGEX_ID,
  WORLD_EVOLUTION_STEALTH_REGEX_ID,
} from '../../红警指挥系统/worldbook/tavernRegexPipeline';

class MockElement {
  tagName: string;
  id = '';
  className = '';
  type = '';
  value = '';
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
  private listeners = new Map<string, Array<(evt?: unknown) => void>>();

  constructor(tag: string, doc: MockDocument) {
    this.tagName = tag.toLowerCase();
    this.ownerDocument = doc;
  }

  setAttribute(name: string, val: string): void {
    const str = String(val);
    this.attrs.set(name, str);
    if (name === 'id') this.id = str;
    if (name === 'class') this.className = str;
    if (name.startsWith('data-')) {
      const camel = name
        .slice(5)
        .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
      this.dataset[camel] = str;
    }
  }

  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
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

  addEventListener(evt: string, cb: (e?: unknown) => void): void {
    const arr = this.listeners.get(evt) ?? [];
    arr.push(cb);
    this.listeners.set(evt, arr);
  }

  private matches(selector: string): boolean {
    if (selector.startsWith('#')) {
      return this.id === selector.slice(1);
    }
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
  querySelector(selector: string): MockElement | null {
    return this.documentElement.querySelector(selector);
  }
  querySelectorAll(selector: string): MockElement[] {
    return this.documentElement.querySelectorAll(selector);
  }
}

describe('FD-35 PKG-A · <情报> 与 <世界演变> 系统正则拆分及 world-evolution-stealth 双模式', () => {
  const storageMap = new Map<string, string>();

  beforeEach(() => {
    storageMap.clear();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storageMap.set(k, String(v));
      },
      removeItem: (k: string) => {
        storageMap.delete(k);
      },
      clear: () => {
        storageMap.clear();
      },
    };
    setWorldEvolutionFloorMode('hidden');
  });

  it('TACTICAL_INTEL_REGEX_ID 仅匹配 <情报>，WORLD_EVOLUTION_STEALTH_REGEX_ID 独立匹配 <世界演变>', () => {
    const intelSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(r => r.id === TACTICAL_INTEL_REGEX_ID)!;
    const stealthSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(
      r => r.id === WORLD_EVOLUTION_STEALTH_REGEX_ID,
    )!;

    expect(intelSpec).toBeDefined();
    expect(stealthSpec).toBeDefined();
    expect(intelSpec.find_regex).toContain('情报');
    expect(stealthSpec.find_regex).toContain('世界演变');
    expect(stealthSpec.script_name).toBe('系统内建 · 世界演变暗流静默隐藏');

    const sampleIntel = '<情报>\n- 标题: 前线雷达截获敌机信号\n  渠道: 雷达侦察\n</情报>';
    const sampleWevo = '<世界演变>\n- 标题: 南美财阀秘密并购重水工厂\n  象限: 远方地缘\n</世界演变>';

    // TACTICAL_INTEL_REGEX_ID 只替换 <情报>，不触碰 <世界演变>
    expect(new RegExp(intelSpec.find_regex).test(sampleIntel)).toBe(true);
    expect(new RegExp(intelSpec.find_regex).test(sampleWevo)).toBe(false);
    const replacedIntel = sampleIntel.replace(
      new RegExp(intelSpec.find_regex, 'g'),
      intelSpec.replace_string,
    );
    expect(replacedIntel).toMatch(/data-(?:tw-card|card-type)="tactical-intel"/);

    // WORLD_EVOLUTION_STEALTH_REGEX_ID 只替换 <世界演变>，不触碰 <情报>
    expect(new RegExp(stealthSpec.find_regex).test(sampleWevo)).toBe(true);
    expect(new RegExp(stealthSpec.find_regex).test(sampleIntel)).toBe(false);
    const replacedWevo = sampleWevo.replace(
      new RegExp(stealthSpec.find_regex, 'g'),
      stealthSpec.replace_string,
    );
    expect(replacedWevo).toMatch(/data-(?:tw-card|card-type)="world-evolution-stealth"/);
    expect(replacedWevo).toMatch(/class="tw-(?:raw-payload|floor-raw)/);
  });

  it('mountWorldEvolutionStealthHost 在默认 hidden 模式下彻底无痕隐藏（display: none 且不剧透标题），切换 pulse 模式后渲染加密脉冲微标且同样不剧透内幕', () => {
    const doc = new MockDocument();
    const host = doc.createElement('div');
    host.className = 'tw-floor-card-host';
    host.setAttribute('data-card-type', 'world-evolution-stealth');

    const rawScript = doc.createElement('script');
    rawScript.className = 'tw-floor-raw';
    const rawWevoText = `<世界演变>
- 标题: 荒坂集团远东秘密核潜艇船坞异动
  象限: 远方地缘
  阶段: 发酵
  内容: 荒坂海事防务在千岛群岛秘密扩建深水潜艇掩体。
- 标题: 黑市纳米神经抑制剂走私潮
  象限: 社会黑市
  阶段: 萌芽
  内容: 自由港黑市出现大批量神经抑制药剂。
</世界演变>`;
    rawScript.textContent = rawWevoText;

    const mountEl = doc.createElement('div');
    mountEl.className = 'tw-floor-mount';
    mountEl.style.display = 'none';

    host.appendChild(rawScript);
    host.appendChild(mountEl);
    doc.body.appendChild(host);

    // 1. 默认模式为 hidden
    expect(getWorldEvolutionFloorMode()).toBe('hidden');
    expect(hydrateFloorCardHost(host as unknown as HTMLElement)).toBe(true);
    expect(host.getAttribute('data-tw-hydrated')).toBe('1');
    expect(host.style.display).toBe('none');
    expect(mountEl.style.display).toBe('none');

    const hiddenMarker = mountEl.querySelector('[data-test="world-evolution-stealth-hidden"]');
    expect(hiddenMarker).not.toBeNull();
    expect(hiddenMarker?.getAttribute('data-count')).toBe('2');
    expect(mountEl.querySelector('[data-test="world-evolution-stealth-pulse"]')).toBeNull();
    // 绝不剧透具体世界演变标题或内幕
    expect(mountEl.collectText()).not.toContain('荒坂集团远东秘密核潜艇船坞异动');
    expect(mountEl.collectText()).not.toContain('千岛群岛');

    // 2. 切换为 pulse 模式，自动刷新已挂载节点
    setWorldEvolutionFloorMode('pulse', doc as unknown as Document);
    expect(getWorldEvolutionFloorMode()).toBe('pulse');
    expect(storageMap.get(WORLD_EVO_FLOOR_MODE_STORAGE_KEY)).toBe('pulse');
    expect(host.style.display).toBe('');
    expect(mountEl.style.display).toBe('');

    const pulseEl = mountEl.querySelector('[data-test="world-evolution-stealth-pulse"]');
    expect(pulseEl).not.toBeNull();
    expect(pulseEl?.getAttribute('data-count')).toBe('2');
    expect(pulseEl?.textContent).toContain('监测到 2 道世界暗流静默推演');
    expect(pulseEl?.textContent).toContain('世界演变');
    // 脉冲微标同样绝不剧透任何具体标题或内容！
    expect(mountEl.collectText()).not.toContain('荒坂集团远东秘密核潜艇船坞异动');
    expect(mountEl.collectText()).not.toContain('黑市纳米神经抑制剂走私潮');

    // 3. 再次切回 hidden 模式
    setWorldEvolutionFloorMode('hidden', doc as unknown as Document);
    expect(host.style.display).toBe('none');
    expect(mountEl.style.display).toBe('none');
    expect(mountEl.querySelector('[data-test="world-evolution-stealth-hidden"]')).not.toBeNull();
  });

  it('当 <世界演变> 内容为空时，mountWorldEvolutionStealthHost 安全隐藏并返回 false', () => {
    const doc = new MockDocument();
    const mountEl = doc.createElement('div');
    mountEl.className = 'tw-floor-mount';
    doc.body.appendChild(mountEl);

    expect(
      mountWorldEvolutionStealthHost(
        mountEl as unknown as HTMLElement,
        '<世界演变>   </世界演变>',
        doc as unknown as Document,
      ),
    ).toBe(false);
    expect(mountEl.style.display).toBe('none');
  });

  it('明牌 <情报> 卡片仍由 mountTacticalIntelCard 正常渲染', () => {
    const doc = new MockDocument();
    const host = doc.createElement('div');
    host.className = 'tw-floor-card-host';
    host.setAttribute('data-card-type', 'tactical-intel');
    doc.body.appendChild(host);

    mountTacticalIntelCard(
      host as unknown as HTMLElement,
      '<情报>\n- 标题: 北坡雷达捕捉低空无人侦察机\n  渠道: 雷达侦察\n  可信度: 高\n</情报>',
    );
    expect(host.querySelector('[data-test="tactical-intel-card"]')).not.toBeNull();
    expect(host.collectText()).toContain('北坡雷达捕捉低空无人侦察机');
  });

  it('兼容 buildFloorCardIframeShell 新版宿主：world-evolution-stealth 在 visible 显化模式下挂载 buildWorldEvolutionCardDom 并隐藏占位 iframe，tactical-intel 兼容新版 iframe 壳', () => {
    const doc = new MockDocument();

    // 1. world-evolution-stealth visible 模式 + iframe 壳
    setWorldEvolutionFloorMode('visible', doc as unknown as Document);
    expect(getWorldEvolutionFloorMode()).toBe('visible');

    const wevoHost = doc.createElement('div');
    wevoHost.className = 'tw-floor-card-host';
    wevoHost.setAttribute('data-tw-card', 'world-evolution-stealth');
    const wevoScript = doc.createElement('script');
    wevoScript.className = 'tw-raw-payload';
    wevoScript.textContent = `<世界演变>
- 编号: WEVO-01
  标题: 太平洋环流异常磁暴与远洋航线断绝
  象限: 位面异象
  阶段: 发酵
  影响区域: 环太平洋海岸带
  态势: 高空电离层扰动加剧，跨洋卫星通讯与民用班轮停航。
</世界演变>`;
    const wevoIframe = doc.createElement('iframe');
    wevoIframe.className = 'tw-floor-card';
    wevoHost.appendChild(wevoScript);
    wevoHost.appendChild(wevoIframe);
    doc.body.appendChild(wevoHost);

    expect(hydrateFloorCardHost(wevoHost as unknown as HTMLElement)).toBe(true);
    expect(wevoHost.style.display).toBe('');
    expect(wevoIframe.style.display).toBe('none');
    const wevoCard = wevoHost.querySelector('[data-test="world-evolution-card"]');
    expect(wevoCard).not.toBeNull();
    expect(wevoCard!.collectText()).toContain('WORLD EVO // 世界演变暗流');
    expect(wevoCard!.collectText()).toContain('太平洋环流异常磁暴与远洋航线断绝');
    expect(wevoCard!.collectText()).toContain('环太平洋海岸带');

    // 2. tactical-intel + iframe 壳
    const intelHost = doc.createElement('div');
    intelHost.className = 'tw-floor-card-host';
    intelHost.setAttribute('data-tw-card', 'tactical-intel');
    const intelScript = doc.createElement('script');
    intelScript.className = 'tw-raw-payload';
    intelScript.textContent = `<情报>
- 标题: 东郊变电站截获加密跳频信号
  渠道: 电讯截获
  可信度: 中
  内容: 夜间高频脉冲持续 15 分钟。
</情报>`;
    const intelIframe = doc.createElement('iframe');
    intelIframe.className = 'tw-floor-card';
    intelHost.appendChild(intelScript);
    intelHost.appendChild(intelIframe);
    doc.body.appendChild(intelHost);

    expect(hydrateFloorCardHost(intelHost as unknown as HTMLElement)).toBe(true);
    expect(intelIframe.style.display).toBe('none');
    const intelCard = intelHost.querySelector('[data-test="tactical-intel-card"]');
    expect(intelCard).not.toBeNull();
    expect(intelCard!.collectText()).toContain('东郊变电站截获加密跳频信号');
  });
});
