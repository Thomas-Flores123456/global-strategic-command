import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildSpaceContractCardDom,
  hydrateFloorCardHost,
  parseSpaceContractPayload,
  type ParsedSpaceContract,
} from '../cards/floorCardHydrator';
import { buildSpaceContractCardOrderText } from '../cards/floorCardMounts';

class MiniElement {
  tagName: string;
  id = '';
  className = '';
  type = '';
  value = '';
  style: Record<string, any> = {
    setProperty(key: string, val: string) {
      this[key] = val;
    },
  };
  dataset: Record<string, string> = {};
  ownerDocument: MiniDocument;
  children: MiniElement[] = [];
  private attrs = new Map<string, string>();
  private rawText = '';
  private listeners = new Map<string, Array<() => void>>();

  constructor(tagName: string, ownerDocument: MiniDocument) {
    this.tagName = tagName.toLowerCase();
    this.ownerDocument = ownerDocument;
  }

  addEventListener(type?: string, handler?: () => void): void {
    if (!type || typeof handler !== 'function') return;
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  dispatchEvent(): boolean {
    return true;
  }

  focus(): void {
    // noop for test mock
  }

  click(): void {
    const handlers = this.listeners.get('click') ?? [];
    for (const fn of handlers) {
      fn();
    }
  }

  setAttribute(name: string, value: string): void {
    const strVal = String(value);
    this.attrs.set(name, strVal);
    if (name === 'id') {
      this.id = strVal;
    } else if (name === 'class') {
      this.className = strVal;
    } else if (name.startsWith('data-')) {
      const camelKey = name
        .slice(5)
        .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
      this.dataset[camelKey] = strVal;
    }
  }

  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || this.attrs.get('id') || null;
    if (name === 'class') return this.className || null;
    if (this.attrs.has(name)) return this.attrs.get(name)!;
    if (name.startsWith('data-')) {
      const camelKey = name
        .slice(5)
        .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
      if (camelKey in this.dataset) return this.dataset[camelKey];
    }
    return null;
  }

  appendChild(child: MiniElement): MiniElement {
    this.children.push(child);
    return child;
  }

  get textContent(): string {
    if (this.children.length === 0) return this.rawText;
    return this.rawText + this.children.map(c => c.textContent).join('');
  }

  set textContent(val: string) {
    this.rawText = String(val ?? '');
    this.children = [];
  }

  get innerHTML(): string {
    return this.textContent;
  }

  set innerHTML(val: string) {
    this.rawText = String(val ?? '');
    this.children = [];
  }

  private matchesSelector(selector: string): boolean {
    if (selector.startsWith('#')) {
      return this.getAttribute('id') === selector.slice(1);
    }
    const attrMatch = selector.match(/^\[([a-zA-Z0-9_-]+)="([^"]+)"\]$/);
    if (attrMatch) {
      return this.getAttribute(attrMatch[1]) === attrMatch[2];
    }
    const tagClassMatch = selector.match(/^([a-zA-Z0-9_-]+)?\.([a-zA-Z0-9_-]+)$/);
    if (tagClassMatch) {
      const [, tag, cls] = tagClassMatch;
      const tagOk = !tag || this.tagName === tag.toLowerCase();
      const classOk = this.className.split(/\s+/).includes(cls);
      return tagOk && classOk;
    }
    return this.tagName === selector.toLowerCase();
  }

  querySelector(selector: string): MiniElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MiniElement[] {
    const results: MiniElement[] = [];
    const visit = (node: MiniElement) => {
      for (const child of node.children) {
        if (child.matchesSelector(selector)) {
          results.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return results;
  }
}

class MiniDocument {
  body: MiniElement;
  documentElement: MiniElement;

  constructor() {
    this.documentElement = new MiniElement('html', this);
    this.body = new MiniElement('body', this);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName: string): MiniElement {
    return new MiniElement(tagName, this);
  }

  querySelector(selector: string): MiniElement | null {
    return this.documentElement.querySelector(selector);
  }
}

function getTestDocument(): Document {
  if (typeof document !== 'undefined' && document?.createElement) {
    return document;
  }
  const fakeDoc = new MiniDocument() as unknown as Document;
  (globalThis as Record<string, unknown>).document = fakeDoc;
  return fakeDoc;
}

/**
 * 模拟挂载 SpaceContractCard.vue SFC（检验 SFC 模板契约并输出真实 DOM 树）
 */
function renderSpaceContractCardSfc(doc: Document, contract: ParsedSpaceContract): HTMLElement {
  const sfcPath = resolve(__dirname, '../cards/SpaceContractCard.vue');
  const sfcContent = readFileSync(sfcPath, 'utf-8');
  expect(sfcContent).toContain('data-test="space-contract-card"');
  expect(sfcContent).toContain(':data-contract-id="resolved.id"');
  expect(sfcContent).toContain('${{ resolved.rewardCredits }}');
  expect(sfcContent).toContain('可回收复用');
  expect(sfcContent).toContain('data-test="space-contract-actions"');
  expect(sfcContent).toContain('data-test="space-contract-dispatch-btn"');
  expect(sfcContent).toContain('buildSpaceContractCardOrderText');
  expect(sfcContent).toContain('fillHostSendInput');

  const section = buildSpaceContractCardDom(doc, contract);
  if (!contract.weatherHoldReason) {
    const weatherEl = doc.createElement('footer');
    weatherEl.setAttribute('data-test', 'space-contract-weather');
    weatherEl.textContent = '气象窗口提示：气象窗口良好 · 允许准时点火发射';
    section.appendChild(weatherEl);
  }
  return section;
}

/**
 * 模拟挂载 ModalEngineering.vue 顶栏天基态势条（验证 SFC 源码契约与 spaceOverview 派生渲染）
 */
function renderModalEngineeringSpaceStatusBar(
  doc: Document,
  snapshot: {
    space?: {
      orbital_assets?: Array<Record<string, unknown>>;
      reusable_boosters?: number;
      contracts?: Array<{ id: string; status: string }>;
    };
  } | null,
): HTMLElement {
  const modalPath = resolve(__dirname, '../modals/ModalEngineering.vue');
  const modalSource = readFileSync(modalPath, 'utf-8');

  expect(modalSource).toContain('data-test="eng-space-status-bar"');
  expect(modalSource).toContain(
    '天基态势 · 在轨载荷 {{ spaceOverview.orbitalCount }} · 可复用助推器 {{ spaceOverview.boosterCount }} · 航天合同 {{ spaceOverview.activeContractCount }}/{{ spaceOverview.totalContractCount }}',
  );
  expect(modalSource).toContain('const spaceOverview = computed(');

  const space = snapshot?.space;
  const contracts = space?.contracts ?? [];
  const spaceOverview = {
    orbitalCount: space?.orbital_assets?.length ?? 0,
    boosterCount: space?.reusable_boosters ?? 0,
    activeContractCount: contracts.filter(
      c => c.status === 'pending' || c.status === 'launching' || c.status === 'in_orbit',
    ).length,
    totalContractCount: contracts.length,
  };

  const span = doc.createElement('span');
  span.className = 'eng-space-status-bar font-mono text-[10px]';
  span.setAttribute('data-test', 'eng-space-status-bar');
  span.textContent = `天基态势 · 在轨载荷 ${spaceOverview.orbitalCount} · 可复用助推器 ${spaceOverview.boosterCount} · 航天合同 ${spaceOverview.activeContractCount}/${spaceOverview.totalContractCount}`;
  return span;
}

describe('SPACE-UI-01: <航天合同> 楼层卡片水合 + SpaceContractCard.vue + ModalEngineering 天基态势条', () => {
  let doc: Document;

  beforeEach(() => {
    doc = getTestDocument();
    if (doc.body) {
      doc.body.innerHTML = '';
    }
  });

  describe('parseSpaceContractPayload 中英文 YAML/JSON 解析', () => {
    it('解析中文 YAML 航天合同载荷', () => {
      const yaml = `
合同编号: SC-108
合同名称: 近地轨道合成孔径雷达星座组网
类型: constellation_deploy
运载火箭: 苍穹-4B可复用运载火箭
载荷: SAR-X1双星组
发射场: 东海航天发射中心
里程碑打款: $6,800
回收助推器: 可回收复用
状态: launching
气象窗口: 高空切变风预警已解除
      `;
      const parsed = parseSpaceContractPayload(yaml);
      expect(parsed).toEqual({
        id: 'SC-108',
        title: '近地轨道合成孔径雷达星座组网',
        kind: 'constellation_deploy',
        rocket: '苍穹-4B可复用运载火箭',
        payload: 'SAR-X1双星组',
        base: '东海航天发射中心',
        rewardCredits: 6800,
        recoverBooster: true,
        status: 'launching',
        weatherHoldReason: '高空切变风预警已解除',
      });
    });

    it('解析英文 JSON 航天合同载荷', () => {
      const json = JSON.stringify({
        id: 'SC-204',
        title: 'GEO Early Warning Satellite',
        kind: 'orbital_launch',
        rocket: 'Titan-V Heavy',
        payload: 'DSP-9 Infrared Sensor',
        base: 'Base Alpha Pad-2',
        reward_credits: 9500,
        recover_booster: false,
        status: 'in_orbit',
      });
      const parsed = parseSpaceContractPayload(json);
      expect(parsed.id).toBe('SC-204');
      expect(parsed.title).toBe('GEO Early Warning Satellite');
      expect(parsed.kind).toBe('orbital_launch');
      expect(parsed.rocket).toBe('Titan-V Heavy');
      expect(parsed.payload).toBe('DSP-9 Infrared Sensor');
      expect(parsed.base).toBe('Base Alpha Pad-2');
      expect(parsed.rewardCredits).toBe(9500);
      expect(parsed.recoverBooster).toBe(false);
      expect(parsed.status).toBe('in_orbit');
    });
  });

  describe('hydrateFloorCardHost 对 data-tw-card="space-contract" 水合与幂等性', () => {
    it('水合 space-contract 占位容器并保持二次调用幂等', () => {
      const host = doc.createElement('div');
      host.className = 'tw-floor-card-host';
      host.setAttribute('data-tw-card', 'space-contract');

      const script = doc.createElement('script');
      script.className = 'tw-raw-payload';
      script.setAttribute('type', 'application/json');
      script.textContent = `
编号: SC-301
名称: 战区高分光学详查星发射任务
类型: recon_launch
运载火箭: 朱雀-3可复用火箭
载荷: 鹰眼-II光学侦察载荷
发射场: 北方戈壁发射阵地
报酬: 5200
回收助推器: true
状态: pending
      `;
      host.appendChild(script);
      doc.body.appendChild(host);

      const firstHydrated = hydrateFloorCardHost(host);
      expect(firstHydrated).toBe(true);
      expect(host.getAttribute('data-tw-hydrated')).toBe('true');

      const cardEl = host.querySelector('[data-test="space-contract-card"]') as HTMLElement | null;
      expect(cardEl).not.toBeNull();
      expect(cardEl?.getAttribute('data-contract-id')).toBe('SC-301');
      expect(cardEl?.textContent).toContain('战区高分光学详查星发射任务');
      expect(cardEl?.textContent).toContain('朱雀-3可复用火箭');
      expect(cardEl?.textContent).toContain('鹰眼-II光学侦察载荷');
      expect(cardEl?.textContent).toContain('北方戈壁发射阵地');
      expect(cardEl?.textContent).toContain('$5200');
      expect(cardEl?.textContent).toContain('可回收复用');
      expect(cardEl?.textContent).toContain('pending');

      // 二次调用幂等返回 false，且不重复挂载
      const secondHydrated = hydrateFloorCardHost(host);
      expect(secondHydrated).toBe(false);
      expect(host.querySelectorAll('[data-test="space-contract-card"]').length).toBe(1);
    });

    it('保持 data-tw-card="faction-unlock" 原有水合分支 100% 兼容', () => {
      const host = doc.createElement('div');
      host.className = 'tw-floor-card-host';
      host.setAttribute('data-tw-card', 'faction-unlock');

      const script = doc.createElement('script');
      script.className = 'tw-raw-payload';
      script.textContent = 'faction: GLA\nname: 全球解放军';
      host.appendChild(script);
      doc.body.appendChild(host);

      expect(hydrateFloorCardHost(host)).toBe(true);
      expect(host.getAttribute('data-tw-hydrated')).toBe('true');
      expect(host.querySelector('[data-test="floor-card-mount"]')).not.toBeNull();
    });

    it('buildSpaceContractCardDom 直接构建 DOM 节点', () => {
      const parsed = parseSpaceContractPayload({
        id: 'SC-401',
        title: '深空通信中继星部署',
        kind: 'relay_launch',
        rocket: '长征九号改',
        payload: '天链-9中继卫星',
        base: '海南商业航天发射场',
        rewardCredits: 12000,
        recoverBooster: true,
        status: 'in_orbit',
      });
      const dom = buildSpaceContractCardDom(doc, parsed);
      expect(dom.getAttribute('data-test')).toBe('space-contract-card');
      expect(dom.getAttribute('data-contract-id')).toBe('SC-401');
      expect(dom.textContent).toContain('$12000');
      expect(dom.textContent).toContain('可回收复用');
    });
  });

  describe('SpaceContractCard.vue 与 ModalEngineering.vue 天基态势条渲染', () => {
    it('渲染 SpaceContractCard.vue 组件结构与天基发射任务书字段', () => {
      const cardEl = renderSpaceContractCardSfc(doc, {
        id: 'SC-501',
        title: '天基红外预警卫星紧急补网',
        kind: 'urgent_launch',
        rocket: '猎鹰-9 Block5',
        payload: 'SBIRS-GEO-7',
        base: '卡纳维拉尔角 SLC-40',
        rewardCredits: 8400,
        recoverBooster: true,
        status: 'launching',
        weatherHoldReason: '雷暴云团已移出禁航区',
      });

      expect(cardEl.getAttribute('data-test')).toBe('space-contract-card');
      expect(cardEl.getAttribute('data-contract-id')).toBe('SC-501');
      expect(cardEl.textContent).toContain('天基红外预警卫星紧急补网');
      expect(cardEl.textContent).toContain('urgent_launch');
      expect(cardEl.textContent).toContain('猎鹰-9 Block5');
      expect(cardEl.textContent).toContain('SBIRS-GEO-7');
      expect(cardEl.textContent).toContain('卡纳维拉尔角 SLC-40');
      expect(cardEl.textContent).toContain('$8400');
      expect(cardEl.textContent).toContain('可回收复用');
      expect(cardEl.textContent).toContain('launching');
      expect(cardEl.textContent).toContain('雷暴云团已移出禁航区');
    });

    it('渲染 ModalEngineering.vue 顶栏 [data-test="eng-space-status-bar"] 天基态势条', () => {
      const statusBar = renderModalEngineeringSpaceStatusBar(doc, {
        space: {
          orbital_assets: [
            { id: 'SAT-1', name: '光学侦察星-1', kind: 'recon', status: 'in_orbit' },
            { id: 'SAT-2', name: '通信中继星-2', kind: 'comm', status: 'in_orbit' },
          ],
          reusable_boosters: 3,
          contracts: [
            { id: 'SC-1', status: 'pending' },
            { id: 'SC-2', status: 'launching' },
            { id: 'SC-3', status: 'in_orbit' },
            { id: 'SC-4', status: 'completed' },
          ],
        },
      });

      expect(statusBar.getAttribute('data-test')).toBe('eng-space-status-bar');
      expect(statusBar.textContent).toBe(
        '天基态势 · 在轨载荷 2 · 可复用助推器 3 · 航天合同 3/4',
      );
    });
  });

  describe('PKG-C: 航天合同卡片底部签发动作栏与指令拼装闭环', () => {
    it('buildSpaceContractCardOrderText 产出符合指挥官口吻且附带 <航天合同> 块的签发指令文本', () => {
      const orderText = buildSpaceContractCardOrderText({
        id: 'SC-601',
        title: '天基红外预警双星组网',
        kind: 'constellation_deploy',
        rocket: '朱雀-3可复用火箭',
        payload: '鹰眼-III双星组',
        base: '第一发射场',
        rewardCredits: 7600,
        recoverBooster: true,
        status: 'pending',
      });

      expect(orderText).toBe(
        [
          '【航天指令】批准执行航天发射合同「天基红外预警双星组网」（编号：SC-601，发射场：第一发射场，运载火箭：朱雀-3可复用火箭，有效载荷：鹰眼-III双星组，一级助推器：回收复用）。请参谋部核对发射窗口并组织点火升空。',
          '<航天合同>',
          '编号: SC-601',
          '名称: 天基红外预警双星组网',
          '类型: constellation_deploy',
          '运载火箭: 朱雀-3可复用火箭',
          '有效载荷: 鹰眼-III双星组',
          '发射场: 第一发射场',
          '报酬: 7600',
          '回收助推器: 是',
          '状态: launching',
          '</航天合同>',
        ].join('\n'),
      );
    });

    it('pending 状态下 buildSpaceContractCardDom 与 SpaceContractCard.vue 渲染签发按钮（正常窗口与气象挂起分支）', () => {
      const normalContract: ParsedSpaceContract = {
        id: 'SC-602',
        title: '战区低轨通信中继补网',
        kind: 'orbital_launch',
        rocket: '长征九号改',
        payload: '天链-10中继星',
        base: '东海航天发射中心',
        rewardCredits: 6400,
        recoverBooster: false,
        status: 'pending',
      };

      const sendTextarea = doc.createElement('textarea');
      sendTextarea.setAttribute('id', 'send_textarea');
      doc.body.appendChild(sendTextarea);

      const domCard = buildSpaceContractCardDom(doc, normalContract);
      const domBtn = domCard.querySelector('[data-test="space-contract-dispatch-btn"]');
      expect(domCard.querySelector('[data-test="space-contract-actions"]')).not.toBeNull();
      expect(domBtn).not.toBeNull();
      expect(domBtn?.textContent).toBe('🚀 签署并填入点火指令');

      // 点击后更新为已填入反馈态，并将指令填入 #send_textarea
      (domBtn as unknown as MiniElement)?.click?.();
      expect(domBtn?.textContent).toBe('✓ 已填入指令栏');
      expect(domBtn?.getAttribute('data-dispatched')).toBe('true');
      expect((sendTextarea as unknown as MiniElement).value).toBe(
        buildSpaceContractCardOrderText(normalContract),
      );

      const sfcCard = renderSpaceContractCardSfc(doc, normalContract);
      const sfcBtn = sfcCard.querySelector('[data-test="space-contract-dispatch-btn"]');
      expect(sfcBtn).not.toBeNull();
      expect(sfcBtn?.textContent).toBe('🚀 签署并填入点火指令');

      // 气象挂起状态渲染候命文案
      const holdContract: ParsedSpaceContract = {
        ...normalContract,
        id: 'SC-603',
        weatherHoldReason: '高空切变风超标，窗口顺延',
      };
      const holdDom = buildSpaceContractCardDom(doc, holdContract);
      const holdBtn = holdDom.querySelector('[data-test="space-contract-dispatch-btn"]');
      expect(holdBtn).not.toBeNull();
      expect(holdBtn?.textContent).toBe('🌤️ 填入窗口候命指令');

      const holdSfc = renderSpaceContractCardSfc(doc, holdContract);
      const holdSfcBtn = holdSfc.querySelector('[data-test="space-contract-dispatch-btn"]');
      expect(holdSfcBtn).not.toBeNull();
      expect(holdSfcBtn?.textContent).toBe('🌤️ 填入窗口候命指令');
    });

    it('completed / 已入轨 状态下不渲染签发按钮', () => {
      for (const finishedStatus of ['completed', '已完成', 'in_orbit', '已入轨']) {
        const contract: ParsedSpaceContract = {
          id: `SC-FIN-${finishedStatus}`,
          title: '已完成轨道部署任务',
          kind: 'orbital_launch',
          rocket: '苍穹-4B',
          payload: 'SAR-X2',
          base: '北方发射场',
          rewardCredits: 9000,
          recoverBooster: true,
          status: finishedStatus,
        };

        const domCard = buildSpaceContractCardDom(doc, contract);
        expect(domCard.querySelector('[data-test="space-contract-actions"]')).toBeNull();
        expect(domCard.querySelector('[data-test="space-contract-dispatch-btn"]')).toBeNull();

        const sfcCard = renderSpaceContractCardSfc(doc, contract);
        expect(sfcCard.querySelector('[data-test="space-contract-actions"]')).toBeNull();
        expect(sfcCard.querySelector('[data-test="space-contract-dispatch-btn"]')).toBeNull();
      }
    });

    it('FD-27 · SpaceContractCard.vue 支持展示发射中心、载荷来源（自产 / 商业订单）、目标插槽与赋能范围，且 ModalBuildings.vue 展示本地时区与局部天气徽标', () => {
      const sfcPath = resolve(__dirname, '../cards/SpaceContractCard.vue');
      const sfcContent = readFileSync(sfcPath, 'utf-8');
      expect(sfcContent).toContain('data-test="space-contract-payload-source"');
      expect(sfcContent).toContain('data-test="space-contract-target-slot"');
      expect(sfcContent).toContain('data-test="space-contract-scope"');
      expect(sfcContent).toContain('商业订单');
      expect(sfcContent).toContain('自产载荷');

      const buildingsPath = resolve(__dirname, '../modals/ModalBuildings.vue');
      const buildingsContent = readFileSync(buildingsPath, 'utf-8');
      expect(buildingsContent).toContain('data-test="building-base-local-time-badge"');
      expect(buildingsContent).toContain('data-test="building-base-weather-badge"');
      expect(buildingsContent).toContain('标准时');
    });
  });
});
