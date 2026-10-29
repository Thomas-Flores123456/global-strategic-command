/**
 * ttChatSurfaceHydrator.test.ts —— PKG-C 聊天虚拟列表 `ChatSurface` 双轨楼层卡片水合器专项单测
 *
 * 覆盖：
 * 1. 当 `isManagedOwnershipRequired() === true` 时，`installFloorCardHydrator()` 只注册
 *    `ChatSurfaceParticipantV1`（`id === 'tavernweave/floor-cards'`, `protocolVersion === 1`），绝不启动 `MutationObserver`；
 * 2. 模拟虚拟列表完整生命周期：`prepareContent` -> `didCommitContent`（水合 `<阵营解锁>`、`<机娘档案>`、`<事件>` 等卡片）
 *    -> 滚出视口触发 `disposer()`（清理 `.tw-floor-card-mount`、重置 `data-tw-hydrated` 并保存 `data-tw-last-height`）
 *    -> 滚回视口从 `chat[]` 重建全新 `.mes_text` 再次触发 `prepareContent` + `didCommitContent`（验证占位高度恢复且卡片 100% 重建不丢失）；
 * 3. 测试 `claims.claim(source, activate)` 按需激活与 `signal` abort 时的高度缓存及 DOM 释放；
 * 4. 测试当 `isManagedOwnershipRequired() === false` 时正常回退至传统 `MutationObserver` 路径。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ChatSurfaceParticipantV1,
  ChatSurfaceRuntimeActivateContext,
  ChatSurfaceRuntimeClaims,
  TauriTavernChatSurfaceApi,
  TauriTavernDisposable,
} from '../host/ttHostBridge';
import {
  createFloorCardChatSurfaceParticipant,
  FLOOR_CARD_PARTICIPANT_ID,
  getFloorTagRepairEnabled,
  hydrateFloorCardHost,
  installFloorCardHydrator,
  recoverStrippedExternalWrappedCards,
  rescueWrappedFloorCardHosts,
  scanAndHydrateFloorCards,
  setFloorTagRepairEnabled,
} from '../cards/floorCardHydrator';

/* ═══════════════ 轻量级无依赖 DOM / MutationObserver 测试桩 ═══════════════ */

function toDataAttrName(prop: string): string {
  return `data-${prop.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`)}`;
}

class FakeStyleDeclaration {
  private map = new Map<string, string>();
  public height = '';
  public minHeight = '';
  public display = '';

  setProperty(name: string, value: string): void {
    const str = String(value);
    this.map.set(name, str);
    if (name === 'height') this.height = str;
    if (name === 'min-height') this.minHeight = str;
    if (name === 'display') this.display = str;
  }

  getPropertyValue(name: string): string {
    if (name === 'height' && this.height) return this.height;
    if (name === 'min-height' && this.minHeight) return this.minHeight;
    if (name === 'display' && this.display) return this.display;
    return this.map.get(name) ?? '';
  }
}

class FakeElement {
  public readonly tagName: string;
  public id = '';
  public className = '';
  public type = '';
  public scrollHeight = 240;
  public offsetHeight = 240;
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
      deleteProperty(_target, prop: string) {
        self.attrs.delete(toDataAttrName(prop));
        return true;
      },
    });
  }

  setAttribute(name: string, value: string): void {
    const str = String(value);
    this.attrs.set(name, str);
    if (name === 'class') this.className = str;
    if (name === 'id') this.id = str;
  }

  getAttribute(name: string): string | null {
    if (name === 'class') return this.className || null;
    if (name === 'id') return this.id || this.attrs.get('id') || null;
    return this.attrs.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
    if (name === 'class') this.className = '';
    if (name === 'id') this.id = '';
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
    const parts = selector
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      return parts.some(part => this.matches(part));
    }
    const s = parts[0] ?? '';
    if (!s) return false;
    if (s.startsWith('#')) {
      return this.getAttribute('id') === s.slice(1);
    }
    const attrMatch = /^(.*?)\[([a-z0-9_-]+)(?:="([^"]*)")?\]$/i.exec(s);
    if (attrMatch) {
      const [, base, name, value] = attrMatch;
      return (!base || this.matches(base)) && (value === undefined
        ? this.getAttribute(name) !== null
        : this.getAttribute(name) === value);
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

  closest(selector: string): FakeElement | null {
    return this.matches(selector) ? this : this.parentNode?.closest(selector) ?? null;
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
  public active = false;
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

  triggerBatch(nodes: FakeElement[]): void {
    if (this.active) this.callback(nodes.map(node => ({ addedNodes: [node] })));
  }
}

class FakeDocument {
  public readonly head: FakeElement;
  public readonly body: FakeElement;
  public readonly documentElement: FakeElement;
  public readonly defaultView: Record<string, unknown> & {
    MutationObserver: typeof FakeMutationObserver;
  };
  public readonly observers = new Set<FakeMutationObserver>();

  constructor() {
    this.defaultView = { MutationObserver: FakeMutationObserver };
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

  registerObserver(obs: FakeMutationObserver): void {
    this.observers.add(obs);
  }

  notifyAddedNode(node: FakeElement): void {
    for (const obs of this.observers) {
      obs.triggerAdded(node);
    }
  }
}

function appendCardHost(
  doc: FakeDocument,
  parent: FakeElement,
  cardType: string,
  options?: {
    rawPayload?: string;
    purified?: boolean;
    runtimeClaim?: boolean;
    height?: number;
    withLegacyIframe?: boolean;
  },
): FakeElement {
  const host = doc.createElement('div');
  host.className = options?.purified ? 'custom-tw-floor-card-host' : 'tw-floor-card-host';
  host.dataset.twCard = cardType;
  host.scrollHeight = options?.height ?? 268;
  host.offsetHeight = options?.height ?? 268;

  if (options?.runtimeClaim) {
    host.dataset.twRuntime = 'claim';
  }

  if (!options?.purified && options?.rawPayload !== undefined) {
    const script = doc.createElement('script');
    script.type = 'text/plain';
    script.className = 'tw-raw-payload';
    script.textContent = options.rawPayload;
    host.appendChild(script);
  }

  if (options?.withLegacyIframe) {
    const iframe = doc.createElement('iframe');
    iframe.className = 'tw-floor-card';
    iframe.setAttribute('srcdoc', '<p>legacy</p>');
    iframe.contentDocument = new FakeDocument();
    iframe.contentDocument.body.scrollHeight = options?.height ?? 268;
    host.appendChild(iframe);
  }

  parent.appendChild(host);
  return host;
}

/* ═══════════════ 测试套件 ═══════════════ */

describe('PKG-C · TauriTavern ChatSurface 双轨楼层卡片水合器 (ttChatSurfaceHydrator)', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).getChatMessages;
    delete (globalThis as Record<string, unknown>).chat;
  });

  it('1. 当 isManagedOwnershipRequired() === true 时，installFloorCardHydrator 只注册 ChatSurfaceParticipantV1，绝不启动 MutationObserver', () => {
    const doc = new FakeDocument();
    const registered: ChatSurfaceParticipantV1[] = [];
    const disposeSpy = vi.fn();

    const mockChatSurface: TauriTavernChatSurfaceApi = {
      protocolVersion: 1,
      isManagedOwnershipRequired: () => true,
      registerParticipant(participant: ChatSurfaceParticipantV1) {
        registered.push(participant);
        return { dispose: disposeSpy };
      },
    };

    const stop = installFloorCardHydrator(doc as unknown as Document, {
      chatSurface: mockChatSurface,
    });

    expect(registered).toHaveLength(1);
    expect(registered[0].id).toBe(FLOOR_CARD_PARTICIPANT_ID);
    expect(registered[0].id).toBe('tavernweave/floor-cards');
    expect(registered[0].protocolVersion).toBe(1);
    expect(typeof registered[0].prepareContent).toBe('function');
    expect(typeof registered[0].didCommitContent).toBe('function');

    // 验证绝未启动 MutationObserver
    expect(doc.observers.size).toBe(0);

    // 验证在 DOM 中直接插入节点不会触发任何后台 MutationObserver
    const strayHost = appendCardHost(doc, doc.body, 'faction-unlock', {
      rawPayload: 'faction: soviet\nstarterGirlName: 喀秋莎',
    });
    expect(strayHost.dataset.twHydrated).toBeUndefined();

    // 验证返回的 stop() 会幂等注销 participant
    stop();
    stop();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('2. 虚拟列表完整生命周期：prepareContent -> didCommitContent -> 滚出视口 disposer() 卸载并缓存高度 -> 滚回视口从 chat[] 重建全新 .mes_text 100% 恢复卡片', () => {
    const doc = new FakeDocument();
    const participant = createFloorCardChatSurfaceParticipant();

    // 模拟宿主 chat[] 消息数组（含 <阵营解锁>、<机娘档案>、<事件> 3 类卡片）
    const floorRawMessage = [
      '战区前线电报已抵达：',
      '<阵营解锁>',
      'faction: soviet',
      'title: 苏联北方重工战区启封',
      'starterGirlName: 喀秋莎',
      'starterGirlModel: MCV-SOV 重型机动基地车',
      'starterGirlQuote: 钢铁洪流已就位！',
      '</阵营解锁>',
      '<机娘档案>',
      '名称: 赤星',
      '代号: 赤星',
      '编号: RHINO-02',
      '型号: 犀牛重型坦克机娘',
      '序列: 次生二号机',
      '阵营: 苏联',
      '躯体特征: 174cm 北方重工体态',
      '性格: 忠诚果敢',
      '</机娘档案>',
      '<事件>',
      '事件：寒潮前哨电磁静默',
      '地点：北坡二号雷达站',
      '影响：全频段侦察半径临时下调15%',
      '</事件>',
    ].join('\n');

    (globalThis as Record<string, unknown>).getChatMessages = (id: number) =>
      id === 42 ? [{ message: floorRawMessage }] : [];

    // ── 阶段 A：首次进入视口（构建楼层 #42 DOM）──
    const mesEl1 = doc.createElement('div');
    mesEl1.className = 'mes';
    mesEl1.setAttribute('mesid', '42');
    const contentEl1 = doc.createElement('div');
    contentEl1.className = 'mes_text';
    mesEl1.appendChild(contentEl1);

    const factionHost1 = appendCardHost(doc, contentEl1, 'faction-unlock', {
      purified: true,
      height: 310,
      withLegacyIframe: true,
    });
    const maidenHost1 = appendCardHost(doc, contentEl1, 'maiden-dossier', {
      purified: true,
      height: 285,
    });
    const eventHost1 = appendCardHost(doc, contentEl1, 'tactical-event', {
      purified: true,
      height: 140,
    });

    const noOpClaims: ChatSurfaceRuntimeClaims = {
      claim: vi.fn(),
    };

    // 1) prepareContent 同步完成并返回 undefined，打上 data-tw-mesid="42"
    const prepResult = participant.prepareContent!(
      { mesid: 42, content: contentEl1 as unknown as HTMLElement },
      noOpClaims,
    );
    expect(prepResult).toBeUndefined();
    expect(factionHost1.dataset.twMesid).toBe('42');
    expect(maidenHost1.dataset.twMesid).toBe('42');
    expect(eventHost1.dataset.twMesid).toBe('42');
    expect(noOpClaims.claim).not.toHaveBeenCalled();

    // 2) didCommitContent 提交至 live DOM 并完成三张卡片单份挂载水合
    doc.body.appendChild(mesEl1);
    const abortCtrl1 = new AbortController();
    const disposer1 = participant.didCommitContent!({
      mesid: 42,
      element: mesEl1 as unknown as HTMLElement,
      content: contentEl1 as unknown as HTMLElement,
      signal: abortCtrl1.signal,
    });

    expect(factionHost1.dataset.twHydrated).toBe('true');
    expect(maidenHost1.dataset.twHydrated).toBe('true');
    expect(eventHost1.dataset.twHydrated).toBe('true');

    // 验证单份 .tw-floor-card-mount 构建且遗留 iframe 被隐藏并剥离 srcdoc
    expect(factionHost1.querySelectorAll('.tw-floor-card-mount')).toHaveLength(1);
    const legacyIframe = factionHost1.querySelector('iframe.tw-floor-card')!;
    expect(legacyIframe.style.display).toBe('none');
    expect(legacyIframe.getAttribute('srcdoc')).toBeNull();

    expect(
      factionHost1.querySelector('[data-test="faction-unlock-card"]')?.textContent,
    ).toContain('苏联北方重工战区启封');
    expect(
      maidenHost1.querySelector('[data-test="maiden-dossier-card"]')?.textContent,
    ).toContain('【赤星】');
    expect(
      eventHost1.querySelector('[data-test="tactical-event-card"]')?.textContent,
    ).toContain('寒潮前哨电磁静默');

    // ── 阶段 B：楼层 #42 滚出虚拟列表视口，触发 disposer() ──
    if (typeof disposer1 === 'function') {
      disposer1();
    } else {
      disposer1?.dispose();
    }

    // 验证 .tw-floor-card-mount 子树已移除，data-tw-hydrated 已重置，且记录了 data-tw-last-height
    expect(factionHost1.querySelectorAll('.tw-floor-card-mount')).toHaveLength(0);
    expect(maidenHost1.querySelectorAll('.tw-floor-card-mount')).toHaveLength(0);
    expect(eventHost1.querySelectorAll('.tw-floor-card-mount')).toHaveLength(0);

    expect(factionHost1.dataset.twHydrated).toBeUndefined();
    expect(maidenHost1.dataset.twHydrated).toBeUndefined();
    expect(eventHost1.dataset.twHydrated).toBeUndefined();

    expect(factionHost1.dataset.twLastHeight).toBe('310');
    expect(maidenHost1.dataset.twLastHeight).toBe('285');
    expect(eventHost1.dataset.twLastHeight).toBe('140');
    expect(factionHost1.style.minHeight).toBe('310px');

    // 从 DOM 中彻底销毁旧楼层节点（模拟虚拟列表回收 DOM）
    doc.body.removeChild(mesEl1);

    // ── 阶段 C：楼层 #42 滚回虚拟列表视口，从 chat[42] 重建全新 .mes_text 节点 ──
    const mesEl2 = doc.createElement('div');
    mesEl2.className = 'mes';
    // 故意不在外层 .mes 设置 mesid 属性，验证仅凭 ChatSurface 传入的 mesid 也能从原文水合
    const contentEl2 = doc.createElement('div');
    contentEl2.className = 'mes_text';
    mesEl2.appendChild(contentEl2);

    const factionHost2 = appendCardHost(doc, contentEl2, 'faction-unlock', {
      purified: true,
      height: 310,
    });
    const maidenHost2 = appendCardHost(doc, contentEl2, 'maiden-dossier', {
      purified: true,
      height: 285,
    });
    const eventHost2 = appendCardHost(doc, contentEl2, 'tactical-event', {
      purified: true,
      height: 140,
    });

    // 再次执行 prepareContent：新 DOM 节点应自动恢复上次卸载缓存的 data-tw-last-height 与 minHeight
    participant.prepareContent!(
      { mesid: 42, content: contentEl2 as unknown as HTMLElement },
      noOpClaims,
    );
    expect(factionHost2.dataset.twMesid).toBe('42');
    expect(factionHost2.dataset.twLastHeight).toBe('310');
    expect(factionHost2.style.minHeight).toBe('310px');
    expect(maidenHost2.dataset.twLastHeight).toBe('285');
    expect(maidenHost2.style.minHeight).toBe('285px');
    expect(eventHost2.dataset.twLastHeight).toBe('140');
    expect(eventHost2.style.minHeight).toBe('140px');

    // 再次执行 didCommitContent：三张卡片 100% 重建水合成功
    doc.body.appendChild(mesEl2);
    const abortCtrl2 = new AbortController();
    participant.didCommitContent!({
      mesid: 42,
      element: mesEl2 as unknown as HTMLElement,
      content: contentEl2 as unknown as HTMLElement,
      signal: abortCtrl2.signal,
    });

    expect(factionHost2.dataset.twHydrated).toBe('true');
    expect(maidenHost2.dataset.twHydrated).toBe('true');
    expect(eventHost2.dataset.twHydrated).toBe('true');

    expect(
      factionHost2.querySelector('[data-test="faction-unlock-card"]')?.textContent,
    ).toContain('喀秋莎');
    expect(
      maidenHost2.querySelector('[data-test="maiden-dossier-card"]')?.textContent,
    ).toContain('RHINO-02');
    expect(
      eventHost2.querySelector('[data-test="tactical-event-card"]')?.textContent,
    ).toContain('北坡二号雷达站');

    // 通过 AbortSignal 触发卸载，验证同样干净清理
    abortCtrl2.abort();
    expect(factionHost2.querySelectorAll('.tw-floor-card-mount')).toHaveLength(0);
    expect(factionHost2.dataset.twHydrated).toBeUndefined();
  });

  it('3. 支持 claims.claim(source, activate) 重型卡片按需激活与 signal abort 时的资源释放', () => {
    const doc = new FakeDocument();
    const participant = createFloorCardChatSurfaceParticipant();

    const mesEl = doc.createElement('div');
    mesEl.className = 'mes';
    const contentEl = doc.createElement('div');
    contentEl.className = 'mes_text';
    mesEl.appendChild(contentEl);

    const heavyHost = appendCardHost(doc, contentEl, 'faction-unlock', {
      rawPayload: 'faction: allied\ntitle: 盟军超时空实验场\nstarterGirlName: 雅典娜',
      runtimeClaim: true,
      height: 360,
    });
    const normalHost = appendCardHost(doc, contentEl, 'tactical-event', {
      rawPayload: '事件：超时空信标充能完成\n地点：第一实验基地',
      runtimeClaim: false,
      height: 150,
    });

    const claimedEntries: Array<{
      source: Element;
      activate: (ctx: ChatSurfaceRuntimeActivateContext) => TauriTavernDisposable;
    }> = [];

    const claims: ChatSurfaceRuntimeClaims = {
      claim(source, activate) {
        claimedEntries.push({ source, activate });
      },
    };

    // 1) prepareContent 识别 heavyHost 并注册 claim，normalHost 不注册 claim
    participant.prepareContent!(
      { mesid: 7, content: contentEl as unknown as HTMLElement },
      claims,
    );
    expect(claimedEntries).toHaveLength(1);
    expect(claimedEntries[0].source).toBe(heavyHost as unknown as Element);

    // 2) didCommitContent 立即水合 normalHost，而 heavyHost 等待 runtime 授权
    const floorAbort = new AbortController();
    participant.didCommitContent!({
      mesid: 7,
      element: mesEl as unknown as HTMLElement,
      content: contentEl as unknown as HTMLElement,
      signal: floorAbort.signal,
    });

    expect(normalHost.dataset.twHydrated).toBe('true');
    expect(heavyHost.dataset.twHydrated).toBeUndefined();
    expect(heavyHost.querySelectorAll('.tw-floor-card-mount')).toHaveLength(0);

    // 3) 触发 heavyHost 的 runtime activate 回调
    const runtimeAbort = new AbortController();
    const claimDisposer = claimedEntries[0].activate({
      mesid: 7,
      element: mesEl as unknown as HTMLElement,
      content: contentEl as unknown as HTMLElement,
      signal: runtimeAbort.signal,
      source: heavyHost as unknown as Element,
    });

    expect(heavyHost.dataset.twHydrated).toBe('true');
    expect(heavyHost.querySelectorAll('.tw-floor-card-mount')).toHaveLength(1);
    expect(
      heavyHost.querySelector('[data-test="faction-unlock-card"]')?.textContent,
    ).toContain('盟军超时空实验场');

    // 4) 当 runtimeAbort.abort() 触发时，heavyHost 卸载并保存高度，而 normalHost 仍保持水合
    runtimeAbort.abort();
    expect(heavyHost.querySelectorAll('.tw-floor-card-mount')).toHaveLength(0);
    expect(heavyHost.dataset.twHydrated).toBeUndefined();
    expect(heavyHost.dataset.twLastHeight).toBe('360');
    expect(normalHost.dataset.twHydrated).toBe('true');

    // 再次调用返回函数幂等无副作用
    if (typeof claimDisposer === 'function') {
      claimDisposer();
    } else {
      claimDisposer.dispose();
    }

    // 5) 整层卸载时 normalHost 也完成卸载
    floorAbort.abort();
    expect(normalHost.dataset.twHydrated).toBeUndefined();
    expect(normalHost.dataset.twLastHeight).toBe('150');
  });

  it('4. 当 isManagedOwnershipRequired() === false 时，自动回退至传统 MutationObserver 路径', () => {
    const doc = new FakeDocument();
    const registerSpy = vi.fn();

    const unmanagedChatSurface: TauriTavernChatSurfaceApi = {
      protocolVersion: 1,
      isManagedOwnershipRequired: () => false,
      registerParticipant: registerSpy,
    };

    const existingHost = appendCardHost(doc, doc.body, 'faction-unlock', {
      rawPayload: 'faction: yuri\ntitle: 尤里心灵信标启封\nstarterGirlName: 天秤',
    });

    const stop = installFloorCardHydrator(doc as unknown as Document, {
      chatSurface: unmanagedChatSurface,
    });

    // 未注册 ChatSurface participant，而是执行了初始扫描并启动了 MutationObserver
    expect(registerSpy).not.toHaveBeenCalled();
    expect(doc.observers.size).toBe(1);
    expect(existingHost.dataset.twHydrated).toBe('true');

    // 动态追加新卡片宿主，MutationObserver 自动完成水合
    const dynamicHost = appendCardHost(doc, doc.body, 'tactical-event', {
      rawPayload: '事件：心灵增幅器并网\n地点：尤里前哨基地',
    });
    expect(dynamicHost.dataset.twHydrated).toBe('true');
    expect(
      dynamicHost.querySelector('[data-test="tactical-event-card"]')?.textContent,
    ).toContain('心灵增幅器并网');

    stop();

    // stop 后不再自动水合，但可手动调用 hydrateFloorCardHost 带 mesid 水合
    (globalThis as Record<string, unknown>).chat = [
      { mes: '<事件>\n事件：手动补水合验证\n地点：二号高地\n</事件>' },
    ];
    const manualHost = appendCardHost(doc, doc.body, 'tactical-event', {
      purified: true,
    });
    expect(manualHost.dataset.twHydrated).toBeUndefined();

    expect(hydrateFloorCardHost(manualHost as unknown as HTMLElement, { mesid: 0 })).toBe(true);
    expect(manualHost.dataset.twHydrated).toBe('true');
    expect(manualHost.dataset.twMesid).toBe('0');
    expect(
      manualHost.querySelector('[data-test="tactical-event-card"]')?.textContent,
    ).toContain('手动补水合验证');
  });

  it('5. 楼层协议标签兼容修补开关（默认关闭）：默认不触发外部包裹标签修补，手动开启后可从 <SUOT> 原文自动恢复全部战报卡片', () => {
    const doc = new FakeDocument();
    setFloorTagRepairEnabled(false);
    expect(getFloorTagRepairEnabled()).toBe(false);

    // 场景 A：#50 楼（depth >= 1）被预设正则【夏瑾】行动选项2 将 <SUOT>...</SUOT> 删成空串，DOM 仅剩正文，但 chat[50].mes 保有完整原文
    (globalThis as Record<string, unknown>).chat = [];
    ((globalThis as Record<string, unknown>).chat as Array<{ mes: string }>)[50] = {
      mes: [
        '<Interleaving>',
        '正文段落：巡视灰白岩脊。',
        '</Interleaving>',
        '<SUOT>',
        '<摘要>',
        '时间: 2042-06-15 08:30',
        '纪要: 巡视洞口并开始首班值守。',
        '关键词: [洞口, 值守]',
        '</摘要>',
        '',
        '<timePast>0 D 0 H 30 M</timePast>',
        '',
        '<态势>',
        '日期: 2042-06-15 08:30',
        '位置: 恶土北坡',
        '</态势>',
        '',
        '<选项>',
        '- 文本: 安静值守',
        '  标签: 稳健',
        '</选项>',
        '</SUOT>',
      ].join('\n'),
    };

    const mes50 = doc.createElement('div');
    mes50.className = 'mes';
    mes50.setAttribute('mesid', '50');
    const mes50Text = doc.createElement('div');
    mes50Text.className = 'mes_text';
    mes50.appendChild(mes50Text);
    doc.body.appendChild(mes50);

    // 默认关闭（false）时，不干预被预设删除的 <SUOT> 块
    expect(scanAndHydrateFloorCards(doc as unknown as Document)).toBe(0);
    expect(mes50Text.querySelectorAll('.tw-floor-card-host')).toHaveLength(0);

    // 在中控台设置面板手动开启后，自动补齐并水合 4 张战报卡片
    setFloorTagRepairEnabled(true);
    expect(getFloorTagRepairEnabled()).toBe(true);

    const hydratedCount = scanAndHydrateFloorCards(doc as unknown as Document);
    expect(hydratedCount).toBe(4);

    const recoveredHosts = mes50Text.querySelectorAll('.tw-floor-card-host');
    expect(recoveredHosts.map(h => h.getAttribute('data-tw-card'))).toEqual([
      'story-summary',
      'chrono-step',
      'tactical-situation',
      'tactical-options',
    ]);
    for (const h of recoveredHosts) {
      expect(h.dataset.twHydrated).toBe('true');
    }

    // 再次扫描保持严格幂等（不重复追加卡片）
    expect(recoverStrippedExternalWrappedCards(doc as unknown as Document)).toBe(0);
    expect(mes50Text.querySelectorAll('.tw-floor-card-host')).toHaveLength(4);
    // MutationObserver 的根是新增卡片，不是 document；已水合也不能在卡片内部再次补卡。
    for (const host of recoveredHosts) {
      expect(scanAndHydrateFloorCards(host as unknown as HTMLElement)).toBe(0);
      expect(host.querySelectorAll('.tw-floor-card-host')).toHaveLength(0);
    }
    setFloorTagRepairEnabled(false);
  });

  it('SUOT 恢复保留显式 ChatSurface 容器与楼号，不在游离卡片内恢复整层', () => {
    setFloorTagRepairEnabled(true);
    try {
      const doc = new FakeDocument();
      const text = doc.createElement('div');
      text.className = 'mes_text';
      doc.body.appendChild(text);
      (globalThis as Record<string, unknown>).chat = [
        { mes: '<SUOT><摘要>纪要: 第一条</摘要>\n<摘要>纪要: 第二条</摘要></SUOT>' },
      ];
      const context = { mesid: 0, mesElement: text as unknown as HTMLElement };
      expect(scanAndHydrateFloorCards(text as unknown as HTMLElement, context)).toBe(2);
      const hosts = text.querySelectorAll('.tw-floor-card-host');
      expect(hosts).toHaveLength(2);
      for (const host of hosts) {
        expect(scanAndHydrateFloorCards(host as unknown as HTMLElement, context)).toBe(0);
        expect(host.querySelectorAll('.tw-floor-card-host')).toHaveLength(0);
      }
      const detached = doc.createElement('div');
      detached.className = 'tw-floor-card-host';
      detached.dataset.twMesid = '0';
      expect(recoverStrippedExternalWrappedCards(detached as unknown as HTMLElement)).toBe(0);
    } finally {
      setFloorTagRepairEnabled(false);
    }
  });

  it.each([
    ['单卡', ['摘要']],
    ['同型多卡', ['摘要', '摘要']],
    ['异型多卡', ['摘要', '态势', '选项', '事件']],
  ] as const)('SUOT 恢复 %s：观察器批次必须收敛，不能把卡片的楼号当消息容器', (_name, tags) => {
    setFloorTagRepairEnabled(true);
    const doc = new FakeDocument();
    const pending: FakeElement[] = [];
    // 按浏览器语义批次投递，只观察已连接的 body 子树，避免同步假桩掩盖微任务循环。
    const notify = vi.spyOn(doc, 'notifyAddedNode').mockImplementation(node => {
      let ancestor: FakeElement | null = node;
      while (ancestor && ancestor !== doc.body) ancestor = ancestor.parentNode;
      if (ancestor === doc.body) pending.push(node);
    });
    const payloads: Record<string, string> = {
      摘要: '时间: 2042-06-15\n纪要: 巡逻结束。\n关键词: [巡逻]',
      态势: '日期: 2042-06-15\n位置: 基地',
      选项: '- 文本: 留守\n  标签: 稳健',
      事件: '事件: 巡逻结束\n地点: 基地',
    };
    (globalThis as Record<string, unknown>).chat = [{
      mes: `<SUOT>\n${tags.map(tag => `<${tag}>\n${payloads[tag]}\n</${tag}>`).join('\n\n')}\n</SUOT>`,
    }];
    const stop = installFloorCardHydrator(doc as unknown as Document);
    try {
      const mes = doc.createElement('div');
      mes.className = 'mes';
      mes.setAttribute('mesid', '0');
      const text = doc.createElement('div');
      text.className = 'mes_text';
      mes.appendChild(text);
      doc.body.appendChild(mes);
      // 硬限制批次数：旧实现应失败，而不是让测试进程也无限增殖。
      for (let round = 0; round < 4 && pending.length > 0; round += 1) {
        const batch = pending.splice(0);
        for (const observer of doc.observers) observer.triggerBatch(batch);
      }
      expect(pending).toHaveLength(0);
      const hosts = text.querySelectorAll('.tw-floor-card-host');
      expect(hosts).toHaveLength(tags.length);
      for (const host of hosts) {
        expect(host.dataset.twHydrated).toBe('true');
        expect(host.querySelectorAll('.tw-floor-card-host')).toHaveLength(0);
      }
    } finally {
      stop();
      notify.mockRestore();
      setFloorTagRepairEnabled(false);
    }
  });
});
