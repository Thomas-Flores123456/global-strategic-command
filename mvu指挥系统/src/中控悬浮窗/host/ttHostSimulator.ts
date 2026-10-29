/**
 * ttHostSimulator.ts —— TauriTavern 浏览器级高保真宿主模拟器（TT-DevKit Layer 1）
 *
 * 架构文档：docs/Architecture/TaruiTavern/README.md (§3.2)
 * 实施任务包：docs/Architecture/Future Developments/30-TauriTavern宿主适配与专属开发脚手架实施任务包.md (PKG-A)
 *
 * 核心职责：
 * 1. 在浏览器开发态与 Vitest 单测环境下挂载完整的 `window.__TAURITAVERN__`（ABI v1）五大 API 模拟实现；
 * 2. 安全红线：若目标窗口已存在非模拟器创建的真实 `__TAURITAVERN__` 且未传 `force: true`，绝不覆盖真实宿主；
 * 3. 提供 `simControl` 控制器，支持一键压测 ChatSurface 虚拟滚动卸载/重挂、Layout 多端安全区/IME 切换、
 *    ExtensionStore 内存 CRUD、WorldInfo 激活广播以及 Agent/Skill 运行时沙盒。
 */

import type {
  AgentProfileDefinition,
  AgentProfileSummary,
  AgentRunEvent,
  AgentRunHandle,
  AgentRunStatus,
  AgentStartRunFromLegacyGenerateInput,
  AgentStartRunWithPromptSnapshotInput,
  AgentSubscribeOptions,
  AgentWorkspaceFile,
  ChatSurfaceMountedContext,
  ChatSurfaceParticipantV1,
  ChatSurfaceRuntimeActivateContext,
  ChatSurfaceRuntimeClaims,
  ExtensionStoreKeyRef,
  ExtensionStoreRenameKeyInput,
  ExtensionStoreSetBlobInput,
  ExtensionStoreSetJsonInput,
  ExtensionStoreTableRef,
  LayoutImeState,
  LayoutInsets,
  LayoutRect,
  LayoutSnapshot,
  TauriTavernAgentApi,
  TauriTavernChatSurfaceApi,
  TauriTavernDisposable,
  TauriTavernExtensionStoreApi,
  TauriTavernHostUnsubscribe,
  TauriTavernLayoutApi,
  TauriTavernSkillApi,
  TauriTavernSkillExportPayload,
  TauriTavernSkillImportFile,
  TauriTavernSkillIndexEntry,
  TauriTavernSkillInstallRequest,
  TauriTavernSkillInstallResult,
  TauriTavernSkillReadRequest,
  TauriTavernSkillReadResult,
  TauriTavernWindowGlobal,
  TauriTavernWorldInfoApi,
  WorldInfoActivationBatch,
} from './ttHostBridge';

const SIMULATOR_FLAG = '__isTauriTavernSimulator__';

export type TauriTavernLayoutPreset = 'desktop' | 'mobile-notch' | 'android-ime';

export interface TauriTavernSimulatorOptions {
  /** 目标宿主窗口对象，默认 window 或 globalThis */
  win?: Record<string, unknown>;
  /** 目标 Document 对象，默认 win.document 或全局 document（Node 单测下自动回退轻量 DOM 桩） */
  doc?: Document;
  /** 若目标窗口已存在真实 __TAURITAVERN__，是否强制覆盖（默认 false） */
  force?: boolean;
  /** ChatSurface 是否默认处于虚拟列表托管模式（默认 true） */
  managedChatSurface?: boolean;
  /** 初始布局预设（默认 'desktop'） */
  initialLayoutPreset?: TauriTavernLayoutPreset;
}

export interface MountedFloorRecord {
  mesid: number;
  element: HTMLElement;
  content: HTMLElement;
  signal: AbortSignal;
}

export interface ChatSurfaceSimulatorControl {
  readonly api: TauriTavernChatSurfaceApi;
  setManagedOwnership(managed: boolean): void;
  mountFloor(
    mesid: number,
    htmlStringOrElement: string | HTMLElement,
    options?: { autoGrantRuntime?: boolean },
  ): MountedFloorRecord;
  unmountFloor(mesid: number): boolean;
  remountFloor(
    mesid: number,
    overrideHtml?: string,
    options?: { autoGrantRuntime?: boolean },
  ): MountedFloorRecord;
  grantRuntime(mesid: number): number;
  revokeRuntime(mesid: number): number;
  simulateVirtualScrollUnmount(mesids: number[]): number;
  simulateVirtualScrollRemount(mesids: number[]): MountedFloorRecord[];
  getMountedFloor(mesid: number): MountedFloorRecord | null;
  listMountedMesids(): number[];
  getParticipantCount(): number;
}

export interface LayoutSimulatorControl {
  readonly api: TauriTavernLayoutApi;
  setPreset(
    preset: TauriTavernLayoutPreset,
    activeSurface?: Element | null,
  ): LayoutSnapshot;
  setCustomSnapshot(
    custom: Partial<LayoutSnapshot> & {
      viewport?: Partial<LayoutRect>;
      safeInsets?: Partial<LayoutInsets>;
      safeFrame?: Partial<LayoutRect>;
      ime?: Partial<LayoutImeState>;
    },
  ): LayoutSnapshot;
}

export interface ExtensionStoreSimulatorControl {
  readonly api: TauriTavernExtensionStoreApi;
  clear(): void;
}

export interface WorldInfoSimulatorControl {
  readonly api: TauriTavernWorldInfoApi;
  emitActivation(batch: WorldInfoActivationBatch): void;
  getOpenedEntries(): Array<{ world: string; uid: string | number }>;
}

export interface AgentSimulatorControl {
  readonly api: TauriTavernAgentApi;
  emitRunEvent(
    runId: string,
    event: {
      type: string;
      payload?: unknown;
      level?: 'debug' | 'info' | 'warn' | 'error';
      status?: AgentRunStatus;
    },
  ): AgentRunEvent;
  writeWorkspaceFile(runId: string, path: string, text: string): AgentWorkspaceFile;
  readWorkspaceFile(runId: string, path: string): Promise<AgentWorkspaceFile>;
  getRun(runId: string): AgentRunHandle | null;
}

export interface SkillSimulatorControl {
  readonly api: TauriTavernSkillApi;
  clear(): void;
}

export interface TauriTavernSimulatorControl {
  readonly chatSurface: ChatSurfaceSimulatorControl;
  readonly layout: LayoutSimulatorControl;
  readonly extensionStore: ExtensionStoreSimulatorControl;
  readonly worldInfo: WorldInfoSimulatorControl;
  readonly agent: AgentSimulatorControl;
  readonly skill: SkillSimulatorControl;
}

export interface TauriTavernSimulatorInstance {
  readonly installed: boolean;
  readonly skippedReason?: 'real-host-present';
  readonly hostGlobal: TauriTavernWindowGlobal;
  readonly simControl: TauriTavernSimulatorControl;
  uninstall(): void;
}

// ───────────────────────── Lightweight Node DOM Fallback ─────────────────────────

function camelToDataAttr(prop: string): string {
  return `data-${prop.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`)}`;
}

function dataAttrToCamel(attr: string): string {
  return attr
    .slice(5)
    .replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase());
}

class SimStyleDeclaration {
  private props = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.props.set(name, String(value));
  }

  getPropertyValue(name: string): string {
    return this.props.get(name) ?? '';
  }

  removeProperty(name: string): string {
    const prev = this.props.get(name) ?? '';
    this.props.delete(name);
    return prev;
  }
}

class SimElement {
  public readonly tagName: string;
  public parentNode: SimElement | null = null;
  public readonly children: SimElement[] = [];
  public readonly style = new SimStyleDeclaration();
  public readonly dataset: Record<string, string | undefined>;
  public readonly classList: {
    add: (...tokens: string[]) => void;
    remove: (...tokens: string[]) => void;
    contains: (token: string) => boolean;
  };

  private attrs = new Map<string, string>();
  private rawText = '';

  constructor(
    tagName: string,
    public readonly ownerDocument: SimDocument,
  ) {
    this.tagName = tagName.toUpperCase();
    const self = this;

    this.dataset = new Proxy({} as Record<string, string | undefined>, {
      get(_target, prop: string) {
        if (typeof prop !== 'string') return undefined;
        return self.attrs.get(camelToDataAttr(prop));
      },
      set(_target, prop: string, value: string | undefined) {
        if (typeof prop === 'string') {
          const attr = camelToDataAttr(prop);
          if (value === undefined) self.attrs.delete(attr);
          else self.attrs.set(attr, String(value));
        }
        return true;
      },
    });

    this.classList = {
      add: (...tokens: string[]) => {
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        for (const t of tokens) if (t) set.add(t);
        self.className = Array.from(set).join(' ');
      },
      remove: (...tokens: string[]) => {
        const removeSet = new Set(tokens);
        self.className = self.className
          .split(/\s+/)
          .filter(t => t && !removeSet.has(t))
          .join(' ');
      },
      contains: (token: string) =>
        self.className.split(/\s+/).filter(Boolean).includes(token),
    };
  }

  get id(): string {
    return this.attrs.get('id') ?? '';
  }
  set id(val: string) {
    if (val) this.attrs.set('id', String(val));
    else this.attrs.delete('id');
  }

  get className(): string {
    return this.attrs.get('class') ?? '';
  }
  set className(val: string) {
    if (val) this.attrs.set('class', String(val));
    else this.attrs.delete('class');
  }

  get firstChild(): SimElement | null {
    return this.children[0] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? (this.attrs.get(name) ?? null) : null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  appendChild<T extends SimElement>(child: T): T {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild<T extends SimElement>(child: T): T {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  get textContent(): string {
    if (this.children.length === 0) return this.rawText;
    return this.rawText + this.children.map(c => c.textContent).join('');
  }

  set textContent(val: string) {
    this.children.splice(0);
    this.rawText = String(val ?? '');
  }

  get innerHTML(): string {
    if (this.children.length === 0) return this.rawText;
    return this.children.map(c => c.outerHTML).join('');
  }

  set innerHTML(html: string) {
    this.children.splice(0);
    this.rawText = '';
    const trimmed = String(html ?? '');
    if (!trimmed) return;

    const tagRegex = /<([a-zA-Z0-9-]+)([^>]*)>([\s\S]*?)<\/\1>/g;
    let matched = false;
    let m: RegExpExecArray | null;
    while ((m = tagRegex.exec(trimmed)) !== null) {
      matched = true;
      const [, tag, attrStr, inner] = m;
      const child = this.ownerDocument.createElement(tag);
      const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let am: RegExpExecArray | null;
      while ((am = attrRegex.exec(attrStr)) !== null) {
        const attrName = am[1];
        const attrVal = am[2] ?? am[3] ?? '';
        child.setAttribute(attrName, attrVal);
        if (attrName.startsWith('data-')) {
          child.dataset[dataAttrToCamel(attrName)] = attrVal;
        }
      }
      child.innerHTML = inner;
      this.appendChild(child);
    }
    if (!matched) {
      this.rawText = trimmed;
    }
  }

  get outerHTML(): string {
    const tag = this.tagName.toLowerCase();
    const attrs = Array.from(this.attrs.entries())
      .map(([k, v]) => ` ${k}="${v}"`)
      .join('');
    return `<${tag}${attrs}>${this.innerHTML}</${tag}>`;
  }

  matches(selector: string): boolean {
    const sel = selector.trim();
    if (!sel) return false;

    // Extract attribute selectors: [attr="val"] or [attr]
    const attrMatches = Array.from(
      sel.matchAll(/\[([a-zA-Z0-9_:-]+)(?:=["']?([^"'\]]+)["']?)?\]/g),
    );
    for (const am of attrMatches) {
      const attrName = am[1];
      const expectedVal = am[2];
      if (!this.hasAttribute(attrName)) return false;
      if (expectedVal !== undefined && this.getAttribute(attrName) !== expectedVal) {
        return false;
      }
    }

    const withoutAttrs = sel.replace(/\[[^\]]+\]/g, '');
    const idMatch = withoutAttrs.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch && this.id !== idMatch[1]) return false;

    const classMatches = Array.from(withoutAttrs.matchAll(/\.([a-zA-Z0-9_-]+)/g));
    for (const cm of classMatches) {
      if (!this.classList.contains(cm[1])) return false;
    }

    const tagPart = withoutAttrs
      .replace(/#[a-zA-Z0-9_-]+/g, '')
      .replace(/\.[a-zA-Z0-9_-]+/g, '')
      .trim();
    if (tagPart && this.tagName.toLowerCase() !== tagPart.toLowerCase()) {
      return false;
    }

    return true;
  }

  querySelector(selector: string): SimElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): SimElement[] {
    const results: SimElement[] = [];
    const visit = (node: SimElement) => {
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

class SimDocument {
  public readonly documentElement: SimElement;
  public readonly body: SimElement;

  constructor() {
    this.documentElement = new SimElement('html', this);
    this.body = new SimElement('body', this);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName: string): SimElement {
    return new SimElement(tagName, this);
  }

  getElementById(id: string): SimElement | null {
    return this.documentElement.querySelector(`#${id}`);
  }

  querySelector(selector: string): SimElement | null {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector: string): SimElement[] {
    return this.documentElement.querySelectorAll(selector);
  }
}

function ensureHostWindowAndDocument(options: TauriTavernSimulatorOptions): {
  targetWin: Record<string, unknown>;
  targetDoc: Document;
} {
  const g = globalThis as unknown as Record<string, unknown>;

  if (!g.window || typeof g.window !== 'object') {
    g.window = g;
  }
  if (!g.document || typeof g.document !== 'object') {
    g.document = new SimDocument();
  }

  // Ensure window event target helpers exist on globalThis/window for Node test environments
  const winListeners = new Map<string, Set<(ev: unknown) => void>>();
  if (typeof g.addEventListener !== 'function') {
    g.addEventListener = (type: string, listener: (ev: unknown) => void) => {
      let set = winListeners.get(type);
      if (!set) {
        set = new Set();
        winListeners.set(type, set);
      }
      set.add(listener);
    };
    g.removeEventListener = (type: string, listener: (ev: unknown) => void) => {
      winListeners.get(type)?.delete(listener);
    };
    g.dispatchEvent = (ev: { type?: string }) => {
      const type = ev?.type ?? '';
      for (const fn of Array.from(winListeners.get(type) ?? [])) {
        fn(ev);
      }
      return true;
    };
  }

  const targetWin: Record<string, unknown> =
    options.win ?? (g.window as Record<string, unknown>);
  if (!targetWin.document && options.doc) {
    targetWin.document = options.doc;
  } else if (!targetWin.document) {
    targetWin.document = g.document;
  }

  const targetDoc = (options.doc ?? targetWin.document) as Document;
  return { targetWin, targetDoc };
}

// ───────────────────────── Internal Helpers ─────────────────────────

function invokeDisposable(disposable: void | TauriTavernDisposable | null | undefined): void {
  if (!disposable) return;
  try {
    if (typeof disposable === 'function') {
      disposable();
    } else if (typeof disposable === 'object' && typeof disposable.dispose === 'function') {
      disposable.dispose();
    }
  } catch {
    // Disposer errors are isolated per participant lifecycle contract
  }
}

function createDualDisposable(fn: () => void): (() => void) & { dispose(): void } {
  let called = false;
  const once = () => {
    if (called) return;
    called = true;
    fn();
  };
  once.dispose = once;
  return once;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function deepClone<T>(val: T): T {
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) {
    return val.map(item => deepClone(item)) as unknown as T;
  }
  if (isPlainObject(val)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = deepClone(v);
    }
    return out as T;
  }
  return val;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = deepClone(target);
  for (const [key, srcVal] of Object.entries(source)) {
    const tgtVal = result[key];
    if (isPlainObject(tgtVal) && isPlainObject(srcVal)) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else {
      result[key] = deepClone(srcVal);
    }
  }
  return result;
}

const VALID_STORE_NAME_RE = /^[A-Za-z0-9_.-]+$/;

function assertValidStoreSegment(label: string, value: string | undefined): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`[TT ExtensionStore] Invalid ${label}: cannot be empty`);
  }
  if (value.startsWith('.')) {
    throw new Error(`[TT ExtensionStore] Invalid ${label} "${value}": cannot start with "."`);
  }
  if (value.includes('..')) {
    throw new Error(`[TT ExtensionStore] Invalid ${label} "${value}": cannot contain ".."`);
  }
  if (!VALID_STORE_NAME_RE.test(value)) {
    throw new Error(
      `[TT ExtensionStore] Invalid ${label} "${value}": only [A-Za-z0-9_.-] is allowed`,
    );
  }
  return value;
}

function computePseudoSha256(text: string): string {
  // Deterministic 64-char hex digest for synchronous browser/Vitest simulation
  const seeds = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const idx = i & 7;
    seeds[idx] = Math.imul(seeds[idx] ^ code, 0x01000193) >>> 0;
    seeds[(idx + 3) & 7] = (seeds[(idx + 3) & 7] + ((code << 5) | (code >>> 3))) >>> 0;
  }
  return seeds.map(n => n.toString(16).padStart(8, '0')).join('');
}

function utf8ByteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).byteLength;
  }
  return text.length;
}

function encodeBase64(text: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf8').toString('base64');
  }
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(text)));
  }
  return text;
}

function toBlobInstance(data: Blob | ArrayBuffer | Uint8Array | string): Blob {
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data;
  }
  if (typeof data === 'string') {
    return new Blob([data], { type: 'text/plain;charset=utf-8' });
  }
  if (data instanceof Uint8Array) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return new Blob([copy.buffer], { type: 'application/octet-stream' });
  }
  if (data instanceof ArrayBuffer) {
    return new Blob([data], { type: 'application/octet-stream' });
  }
  return new Blob([String(data)]);
}

// ───────────────────────── 1. Layout Simulator ─────────────────────────

function buildPresetSnapshot(
  preset: TauriTavernLayoutPreset,
  activeSurface: Element | null = null,
): LayoutSnapshot {
  const now = Date.now();
  if (preset === 'mobile-notch') {
    return {
      timestampMs: now,
      viewport: { left: 0, top: 0, width: 390, height: 844, right: 390, bottom: 844 },
      safeInsets: { top: 47, right: 0, bottom: 34, left: 0 },
      safeFrame: { left: 0, top: 47, width: 390, height: 763, right: 390, bottom: 810 },
      ime: {
        activeSurface,
        kind: null,
        bottom: 0,
        viewportBottomInset: 0,
        keyboardOffset: 0,
      },
    };
  }
  if (preset === 'android-ime') {
    return {
      timestampMs: now,
      viewport: { left: 0, top: 0, width: 390, height: 844, right: 390, bottom: 844 },
      safeInsets: { top: 47, right: 0, bottom: 34, left: 0 },
      safeFrame: { left: 0, top: 47, width: 390, height: 477, right: 390, bottom: 524 },
      ime: {
        activeSurface,
        kind: 'dialog',
        bottom: 320,
        viewportBottomInset: 320,
        keyboardOffset: 286,
      },
    };
  }
  // Default: 'desktop'
  return {
    timestampMs: now,
    viewport: { left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080 },
    safeInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    safeFrame: { left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080 },
    ime: {
      activeSurface,
      kind: null,
      bottom: 0,
      viewportBottomInset: 0,
      keyboardOffset: 0,
    },
  };
}

function cloneLayoutSnapshot(snap: LayoutSnapshot): LayoutSnapshot {
  return {
    timestampMs: snap.timestampMs,
    viewport: { ...snap.viewport },
    safeInsets: { ...snap.safeInsets },
    safeFrame: { ...snap.safeFrame },
    ime: { ...snap.ime },
  };
}

function createLayoutSimulator(
  doc: Document | undefined,
  initialPreset: TauriTavernLayoutPreset,
): LayoutSimulatorControl & { dispose(): void } {
  let current = buildPresetSnapshot(initialPreset);
  const subscribers = new Set<(snap: LayoutSnapshot) => void>();

  const syncCssVariables = (snap: LayoutSnapshot) => {
    const rootStyle = doc?.documentElement?.style;
    if (rootStyle && typeof rootStyle.setProperty === 'function') {
      rootStyle.setProperty('--tt-inset-top', `${snap.safeInsets.top}px`);
      rootStyle.setProperty('--tt-inset-right', `${snap.safeInsets.right}px`);
      rootStyle.setProperty('--tt-inset-bottom', `${snap.safeInsets.bottom}px`);
      rootStyle.setProperty('--tt-inset-left', `${snap.safeInsets.left}px`);
      rootStyle.setProperty('--tt-ime-bottom', `${snap.ime.bottom}px`);
      rootStyle.setProperty(
        '--tt-viewport-bottom-inset',
        `${snap.ime.viewportBottomInset}px`,
      );
    }
    const surfaceEl = snap.ime.activeSurface as HTMLElement | null;
    if (surfaceEl?.style && typeof surfaceEl.style.setProperty === 'function') {
      surfaceEl.style.setProperty('--tt-ime-bottom', `${snap.ime.bottom}px`);
    }
  };

  const notifyAll = () => {
    const snapCopy = cloneLayoutSnapshot(current);
    for (const handler of Array.from(subscribers)) {
      try {
        handler(cloneLayoutSnapshot(snapCopy));
      } catch {
        // Ignore subscriber error
      }
    }
  };

  syncCssVariables(current);

  const api: TauriTavernLayoutApi = {
    snapshot(): LayoutSnapshot {
      return cloneLayoutSnapshot(current);
    },
    subscribe(handler: (snap: LayoutSnapshot) => void): TauriTavernHostUnsubscribe {
      subscribers.add(handler);
      try {
        handler(cloneLayoutSnapshot(current));
      } catch {
        // Ignore initial callback error
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscribers.delete(handler);
      };
    },
  };

  return {
    api,
    setPreset(
      preset: TauriTavernLayoutPreset,
      activeSurface: Element | null = null,
    ): LayoutSnapshot {
      current = buildPresetSnapshot(preset, activeSurface);
      syncCssVariables(current);
      notifyAll();
      return cloneLayoutSnapshot(current);
    },
    setCustomSnapshot(custom): LayoutSnapshot {
      const viewport: LayoutRect = {
        ...current.viewport,
        ...(custom.viewport ?? {}),
      };
      viewport.right = custom.viewport?.right ?? viewport.left + viewport.width;
      viewport.bottom = custom.viewport?.bottom ?? viewport.top + viewport.height;

      const safeInsets: LayoutInsets = {
        ...current.safeInsets,
        ...(custom.safeInsets ?? {}),
      };

      const ime: LayoutImeState = {
        ...current.ime,
        ...(custom.ime ?? {}),
      };

      const defaultBottomOcclusion = Math.max(safeInsets.bottom, ime.viewportBottomInset);
      const computedSafeFrame: LayoutRect = {
        left: viewport.left + safeInsets.left,
        top: viewport.top + safeInsets.top,
        width: Math.max(0, viewport.width - safeInsets.left - safeInsets.right),
        height: Math.max(0, viewport.height - safeInsets.top - defaultBottomOcclusion),
        right: Math.max(0, viewport.width - safeInsets.right),
        bottom: Math.max(0, viewport.height - defaultBottomOcclusion),
      };

      current = {
        timestampMs: custom.timestampMs ?? Date.now(),
        viewport,
        safeInsets,
        safeFrame: custom.safeFrame
          ? { ...computedSafeFrame, ...custom.safeFrame }
          : computedSafeFrame,
        ime,
      };
      syncCssVariables(current);
      notifyAll();
      return cloneLayoutSnapshot(current);
    },
    dispose() {
      subscribers.clear();
      const rootStyle = doc?.documentElement?.style;
      if (rootStyle && typeof rootStyle.removeProperty === 'function') {
        rootStyle.removeProperty('--tt-inset-top');
        rootStyle.removeProperty('--tt-inset-right');
        rootStyle.removeProperty('--tt-inset-bottom');
        rootStyle.removeProperty('--tt-inset-left');
        rootStyle.removeProperty('--tt-ime-bottom');
        rootStyle.removeProperty('--tt-viewport-bottom-inset');
      }
    },
  };
}

// ───────────────────────── 2. ChatSurface Simulator ─────────────────────────

interface PendingRuntimeClaim {
  participantId: string;
  source: Element;
  activate: (context: ChatSurfaceRuntimeActivateContext) => TauriTavernDisposable;
}

interface InternalMountedFloorState {
  mesid: number;
  element: HTMLElement;
  content: HTMLElement;
  abortController: AbortController;
  disposers: TauriTavernDisposable[];
  claims: PendingRuntimeClaim[];
  activeRuntimeDisposers: TauriTavernDisposable[];
}

function createChatSurfaceSimulator(
  doc: Document,
  initialManaged: boolean,
): ChatSurfaceSimulatorControl & { dispose(): void } {
  let managedOwnership = initialManaged;
  const participants = new Map<string, ChatSurfaceParticipantV1>();
  const rawHtmlByMesid = new Map<number, string>();
  const mountedFloors = new Map<number, InternalMountedFloorState>();

  const ensureChatContainer = (d: Document): HTMLElement => {
    let chat = d.getElementById('chat');
    if (!chat) {
      chat = d.createElement('div');
      chat.id = 'chat';
      d.body.appendChild(chat);
    }
    return chat;
  };

  const buildFloorElements = (
    d: Document,
    mesid: number,
    htmlStringOrElement: string | HTMLElement,
  ): { element: HTMLElement; content: HTMLElement; rawHtml: string } => {
    if (typeof htmlStringOrElement === 'string') {
      const element = d.createElement('div');
      element.className = 'mes';
      element.setAttribute('mesid', String(mesid));
      element.dataset.mesid = String(mesid);

      const content = d.createElement('div');
      content.className = 'mes_text';
      content.innerHTML = htmlStringOrElement;
      element.appendChild(content);

      return { element, content, rawHtml: htmlStringOrElement };
    }

    const passedEl = htmlStringOrElement;
    if (passedEl.classList.contains('mes')) {
      passedEl.setAttribute('mesid', String(mesid));
      passedEl.dataset.mesid = String(mesid);
      let content = passedEl.querySelector<HTMLElement>('.mes_text');
      if (!content) {
        content = d.createElement('div');
        content.className = 'mes_text';
        while (passedEl.firstChild) {
          content.appendChild(passedEl.firstChild);
        }
        passedEl.appendChild(content);
      }
      return { element: passedEl, content, rawHtml: content.innerHTML };
    }

    if (passedEl.classList.contains('mes_text')) {
      const element = d.createElement('div');
      element.className = 'mes';
      element.setAttribute('mesid', String(mesid));
      element.dataset.mesid = String(mesid);
      element.appendChild(passedEl);
      return { element, content: passedEl, rawHtml: passedEl.innerHTML };
    }

    const element = d.createElement('div');
    element.className = 'mes';
    element.setAttribute('mesid', String(mesid));
    element.dataset.mesid = String(mesid);

    const content = d.createElement('div');
    content.className = 'mes_text';
    content.appendChild(passedEl);
    element.appendChild(content);
    return { element, content, rawHtml: content.innerHTML };
  };

  const revokeRuntime = (mesid: number): number => {
    const state = mountedFloors.get(mesid);
    if (!state) return 0;
    const list = state.activeRuntimeDisposers.splice(0);
    for (let i = list.length - 1; i >= 0; i--) {
      invokeDisposable(list[i]);
    }
    return list.length;
  };

  const grantRuntime = (mesid: number): number => {
    const state = mountedFloors.get(mesid);
    if (!state) return 0;
    if (state.activeRuntimeDisposers.length > 0) {
      revokeRuntime(mesid);
    }
    let count = 0;
    for (const claim of state.claims) {
      const activateCtx: ChatSurfaceRuntimeActivateContext = {
        mesid: state.mesid,
        element: state.element,
        content: state.content,
        signal: state.abortController.signal,
        source: claim.source,
      };
      const disp = claim.activate(activateCtx);
      state.activeRuntimeDisposers.push(disp);
      count++;
    }
    return count;
  };

  const unmountFloor = (mesid: number): boolean => {
    const state = mountedFloors.get(mesid);
    if (!state) return false;

    revokeRuntime(mesid);
    state.abortController.abort();

    const disposers = state.disposers.splice(0);
    for (let i = disposers.length - 1; i >= 0; i--) {
      invokeDisposable(disposers[i]);
    }

    state.element.remove();
    mountedFloors.delete(mesid);
    return true;
  };

  const mountFloor = (
    mesid: number,
    htmlStringOrElement: string | HTMLElement,
    options?: { autoGrantRuntime?: boolean },
  ): MountedFloorRecord => {
    if (mountedFloors.has(mesid)) {
      unmountFloor(mesid);
    }

    const { element, content, rawHtml } = buildFloorElements(
      doc,
      mesid,
      htmlStringOrElement,
    );
    rawHtmlByMesid.set(mesid, rawHtml);

    const claims: PendingRuntimeClaim[] = [];
    for (const participant of participants.values()) {
      const claimsCollector: ChatSurfaceRuntimeClaims = {
        claim(source, activate) {
          claims.push({
            participantId: participant.id,
            source,
            activate,
          });
        },
      };
      participant.prepareContent?.({ mesid, content }, claimsCollector);
    }

    const chatContainer = ensureChatContainer(doc);
    chatContainer.appendChild(element);

    const abortController = new AbortController();
    const mountedCtx: ChatSurfaceMountedContext = {
      mesid,
      element,
      content,
      signal: abortController.signal,
    };

    const disposers: TauriTavernDisposable[] = [];
    for (const participant of participants.values()) {
      const mountDisp = participant.didMount?.(mountedCtx);
      if (mountDisp) disposers.push(mountDisp);
      const commitDisp = participant.didCommitContent?.(mountedCtx);
      if (commitDisp) disposers.push(commitDisp);
    }

    const state: InternalMountedFloorState = {
      mesid,
      element,
      content,
      abortController,
      disposers,
      claims,
      activeRuntimeDisposers: [],
    };
    mountedFloors.set(mesid, state);

    if (options?.autoGrantRuntime) {
      grantRuntime(mesid);
    }

    return {
      mesid,
      element,
      content,
      signal: abortController.signal,
    };
  };

  const remountFloor = (
    mesid: number,
    overrideHtml?: string,
    options?: { autoGrantRuntime?: boolean },
  ): MountedFloorRecord => {
    const rawHtml = overrideHtml ?? rawHtmlByMesid.get(mesid);
    if (rawHtml === undefined) {
      throw new Error(
        `[TT ChatSurface Simulator] Cannot remount floor #${mesid}: no raw HTML recorded`,
      );
    }
    unmountFloor(mesid);
    return mountFloor(mesid, rawHtml, options);
  };

  const api: TauriTavernChatSurfaceApi = {
    protocolVersion: 1,
    isManagedOwnershipRequired() {
      return managedOwnership;
    },
    registerParticipant(participant: ChatSurfaceParticipantV1): TauriTavernDisposable {
      if (!participant || participant.protocolVersion !== 1 || !participant.id) {
        throw new Error('[TT ChatSurface Simulator] Invalid ChatSurfaceParticipantV1');
      }
      participants.set(participant.id, participant);
      return createDualDisposable(() => {
        participants.delete(participant.id);
      });
    },
  };

  return {
    api,
    setManagedOwnership(managed: boolean) {
      managedOwnership = managed;
    },
    mountFloor,
    unmountFloor,
    remountFloor,
    grantRuntime,
    revokeRuntime,
    simulateVirtualScrollUnmount(mesids: number[]): number {
      let count = 0;
      for (const id of mesids) {
        if (unmountFloor(id)) count++;
      }
      return count;
    },
    simulateVirtualScrollRemount(mesids: number[]): MountedFloorRecord[] {
      return mesids.map(id => remountFloor(id));
    },
    getMountedFloor(mesid: number): MountedFloorRecord | null {
      const s = mountedFloors.get(mesid);
      if (!s) return null;
      return {
        mesid: s.mesid,
        element: s.element,
        content: s.content,
        signal: s.abortController.signal,
      };
    },
    listMountedMesids(): number[] {
      return Array.from(mountedFloors.keys()).sort((a, b) => a - b);
    },
    getParticipantCount(): number {
      return participants.size;
    },
    dispose() {
      for (const mesid of Array.from(mountedFloors.keys())) {
        unmountFloor(mesid);
      }
      participants.clear();
      rawHtmlByMesid.clear();
    },
  };
}

// ───────────────────────── 3. ExtensionStore Simulator ─────────────────────────

function createExtensionStoreSimulator(): ExtensionStoreSimulatorControl {
  const jsonStore = new Map<string, Map<string, Map<string, unknown>>>();
  const blobStore = new Map<string, Map<string, Map<string, Blob>>>();

  const resolveCoords = (input: { namespace: string; table?: string; key?: string }) => {
    const namespace = assertValidStoreSegment('namespace', input.namespace);
    const table = assertValidStoreSegment('table', input.table ?? 'default');
    const key =
      input.key !== undefined ? assertValidStoreSegment('key', input.key) : undefined;
    return { namespace, table, key: key as string };
  };

  const ensureJsonTable = (namespace: string, table: string): Map<string, unknown> => {
    let nsMap = jsonStore.get(namespace);
    if (!nsMap) {
      nsMap = new Map();
      jsonStore.set(namespace, nsMap);
    }
    let tblMap = nsMap.get(table);
    if (!tblMap) {
      tblMap = new Map();
      nsMap.set(table, tblMap);
    }
    return tblMap;
  };

  const ensureBlobTable = (namespace: string, table: string): Map<string, Blob> => {
    let nsMap = blobStore.get(namespace);
    if (!nsMap) {
      nsMap = new Map();
      blobStore.set(namespace, nsMap);
    }
    let tblMap = nsMap.get(table);
    if (!tblMap) {
      tblMap = new Map();
      nsMap.set(table, tblMap);
    }
    return tblMap;
  };

  const api: TauriTavernExtensionStoreApi = {
    async getJson<T = unknown>(input: ExtensionStoreKeyRef): Promise<T> {
      const { namespace, table, key } = resolveCoords(input);
      const tbl = jsonStore.get(namespace)?.get(table);
      if (!tbl || !tbl.has(key)) {
        throw new Error(
          `[TT ExtensionStore] Key not found: ${namespace}/${table}/${key}`,
        );
      }
      return deepClone(tbl.get(key)) as T;
    },

    async tryGetJson<T = unknown>(
      input: ExtensionStoreKeyRef,
    ): Promise<{ found: boolean; value?: T }> {
      const { namespace, table, key } = resolveCoords(input);
      const tbl = jsonStore.get(namespace)?.get(table);
      if (!tbl || !tbl.has(key)) {
        return { found: false };
      }
      return { found: true, value: deepClone(tbl.get(key)) as T };
    },

    async setJson<T = unknown>(input: ExtensionStoreSetJsonInput<T>): Promise<void> {
      const { namespace, table, key } = resolveCoords(input);
      const tbl = ensureJsonTable(namespace, table);
      tbl.set(key, deepClone(input.value));
    },

    async updateJson<T = unknown>(input: ExtensionStoreSetJsonInput<T>): Promise<void> {
      const { namespace, table, key } = resolveCoords(input);
      const tbl = ensureJsonTable(namespace, table);
      if (!tbl.has(key)) {
        tbl.set(key, deepClone(input.value));
        return;
      }
      const existing = tbl.get(key);
      if (isPlainObject(existing) && isPlainObject(input.value)) {
        tbl.set(key, deepMerge(existing, input.value));
      } else {
        tbl.set(key, deepClone(input.value));
      }
    },

    async renameKey(input: ExtensionStoreRenameKeyInput): Promise<void> {
      const { namespace, table, key } = resolveCoords(input);
      const newKey = assertValidStoreSegment('newKey', input.newKey);
      const tbl = jsonStore.get(namespace)?.get(table);
      if (!tbl || !tbl.has(key)) {
        throw new Error(
          `[TT ExtensionStore] Cannot rename missing key: ${namespace}/${table}/${key}`,
        );
      }
      if (key === newKey) return;
      const val = tbl.get(key);
      tbl.delete(key);
      tbl.set(newKey, val);
    },

    async deleteJson(input: ExtensionStoreKeyRef): Promise<void> {
      const { namespace, table, key } = resolveCoords(input);
      jsonStore.get(namespace)?.get(table)?.delete(key);
    },

    async listKeys(input: ExtensionStoreTableRef): Promise<string[]> {
      const { namespace, table } = resolveCoords(input);
      const tbl = jsonStore.get(namespace)?.get(table);
      if (!tbl) return [];
      return Array.from(tbl.keys()).sort();
    },

    async listTables(input: { namespace: string }): Promise<string[]> {
      const namespace = assertValidStoreSegment('namespace', input.namespace);
      const names = new Set<string>();
      const jsonNs = jsonStore.get(namespace);
      if (jsonNs) {
        for (const [tblName, tbl] of jsonNs.entries()) {
          if (tbl.size > 0) names.add(tblName);
        }
      }
      const blobNs = blobStore.get(namespace);
      if (blobNs) {
        for (const [tblName, tbl] of blobNs.entries()) {
          if (tbl.size > 0) names.add(tblName);
        }
      }
      return Array.from(names).sort();
    },

    async deleteTable(input: { namespace: string; table: string }): Promise<void> {
      const namespace = assertValidStoreSegment('namespace', input.namespace);
      const table = assertValidStoreSegment('table', input.table);
      jsonStore.get(namespace)?.delete(table);
      blobStore.get(namespace)?.delete(table);
    },

    async getBlob(input: ExtensionStoreKeyRef): Promise<Blob> {
      const { namespace, table, key } = resolveCoords(input);
      const tbl = blobStore.get(namespace)?.get(table);
      const found = tbl?.get(key);
      if (!found) {
        throw new Error(
          `[TT ExtensionStore] Blob not found: ${namespace}/${table}/${key}`,
        );
      }
      return found;
    },

    async setBlob(input: ExtensionStoreSetBlobInput): Promise<void> {
      const { namespace, table, key } = resolveCoords(input);
      const tbl = ensureBlobTable(namespace, table);
      tbl.set(key, toBlobInstance(input.data));
    },

    async deleteBlob(input: ExtensionStoreKeyRef): Promise<void> {
      const { namespace, table, key } = resolveCoords(input);
      blobStore.get(namespace)?.get(table)?.delete(key);
    },

    async listBlobKeys(input: ExtensionStoreTableRef): Promise<string[]> {
      const { namespace, table } = resolveCoords(input);
      const tbl = blobStore.get(namespace)?.get(table);
      if (!tbl) return [];
      return Array.from(tbl.keys()).sort();
    },
  };

  return {
    api,
    clear() {
      jsonStore.clear();
      blobStore.clear();
    },
  };
}

// ───────────────────────── 4. WorldInfo Simulator ─────────────────────────

function createWorldInfoSimulator(): WorldInfoSimulatorControl & { dispose(): void } {
  let lastActivation: WorldInfoActivationBatch | null = null;
  const subscribers = new Set<(batch: WorldInfoActivationBatch) => void>();
  const openedEntries: Array<{ world: string; uid: string | number }> = [];

  const api: TauriTavernWorldInfoApi = {
    async getLastActivation(): Promise<WorldInfoActivationBatch | null> {
      return lastActivation ? deepClone(lastActivation) : null;
    },
    subscribeActivations(
      handler: (batch: WorldInfoActivationBatch) => void,
    ): TauriTavernHostUnsubscribe {
      subscribers.add(handler);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscribers.delete(handler);
      };
    },
    async openEntry(ref: { world: string; uid: string | number }): Promise<{ opened: boolean }> {
      if (!ref?.world) {
        return { opened: false };
      }
      openedEntries.push({ world: ref.world, uid: ref.uid });
      return { opened: true };
    },
  };

  return {
    api,
    emitActivation(batch: WorldInfoActivationBatch) {
      lastActivation = deepClone(batch);
      for (const handler of Array.from(subscribers)) {
        try {
          handler(deepClone(batch));
        } catch {
          // Ignore subscriber error
        }
      }
    },
    getOpenedEntries() {
      return deepClone(openedEntries);
    },
    dispose() {
      subscribers.clear();
      lastActivation = null;
      openedEntries.length = 0;
    },
  };
}

// ───────────────────────── 5. Agent Simulator ─────────────────────────

interface SimulatedAgentRunState {
  handle: AgentRunHandle;
  events: AgentRunEvent[];
  subscribers: Set<(event: AgentRunEvent) => void>;
  workspaceFiles: Map<string, AgentWorkspaceFile>;
}

function createAgentSimulator(): AgentSimulatorControl & { dispose(): void } {
  const profiles = new Map<string, AgentProfileDefinition>();
  const runs = new Map<string, SimulatedAgentRunState>();
  let runCounter = 0;

  const normalizeProfileId = (input: string | { profileId: string }): string =>
    typeof input === 'string' ? input : input.profileId;

  const emitRunEvent = (
    runId: string,
    eventInput: {
      type: string;
      payload?: unknown;
      level?: 'debug' | 'info' | 'warn' | 'error';
      status?: AgentRunStatus;
    },
  ): AgentRunEvent => {
    const state = runs.get(runId);
    if (!state) {
      throw new Error(`[TT Agent Simulator] Run not found: ${runId}`);
    }
    const seq = state.events.length + 1;
    const ev: AgentRunEvent = {
      seq,
      id: `${runId}-ev-${seq}`,
      runId,
      timestamp: new Date().toISOString(),
      level: eventInput.level ?? 'info',
      type: eventInput.type,
      payload: deepClone(eventInput.payload ?? {}),
    };
    state.events.push(ev);

    if (eventInput.status) {
      state.handle.status = eventInput.status;
    } else if (eventInput.type === 'run_completed') {
      state.handle.status = 'completed';
    } else if (eventInput.type === 'run_failed') {
      state.handle.status = 'failed';
    } else if (eventInput.type === 'run_cancelled') {
      state.handle.status = 'cancelled';
    }

    for (const sub of Array.from(state.subscribers)) {
      try {
        sub(deepClone(ev));
      } catch {
        // Isolate subscriber callback errors
      }
    }
    return deepClone(ev);
  };

  const createNewRun = (stableChatId?: string): AgentRunHandle => {
    runCounter += 1;
    const runId = `sim-run-${runCounter}`;
    const handle: AgentRunHandle = {
      runId,
      status: 'running',
      workspaceId: `sim-ws-${runCounter}`,
      stableChatId: stableChatId ?? 'sim-chat-default',
    };
    runs.set(runId, {
      handle,
      events: [],
      subscribers: new Set(),
      workspaceFiles: new Map(),
    });
    emitRunEvent(runId, {
      type: 'run_created',
      payload: { runId, workspaceId: handle.workspaceId },
    });
    return deepClone(handle);
  };

  const writeWorkspaceFile = (
    runId: string,
    filePath: string,
    text: string,
  ): AgentWorkspaceFile => {
    const state = runs.get(runId);
    if (!state) {
      throw new Error(`[TT Agent Simulator] Run not found: ${runId}`);
    }
    const fileRecord: AgentWorkspaceFile = {
      path: filePath,
      text,
      bytes: utf8ByteLength(text),
      sha256: computePseudoSha256(text),
    };
    state.workspaceFiles.set(filePath, fileRecord);
    return deepClone(fileRecord);
  };

  const readWorkspaceFile = async (
    runId: string,
    filePath: string,
  ): Promise<AgentWorkspaceFile> => {
    const state = runs.get(runId);
    if (!state) {
      throw new Error(`[TT Agent Simulator] Run not found: ${runId}`);
    }
    const fileRecord = state.workspaceFiles.get(filePath);
    if (!fileRecord) {
      throw new Error(
        `[TT Agent Simulator] Workspace file not found: ${runId}:${filePath}`,
      );
    }
    return deepClone(fileRecord);
  };

  const api: TauriTavernAgentApi = {
    async startRunFromLegacyGenerate(
      input?: AgentStartRunFromLegacyGenerateInput,
    ): Promise<AgentRunHandle> {
      return createNewRun(input?.stableChatId);
    },

    async startRunWithPromptSnapshot(
      input: AgentStartRunWithPromptSnapshotInput,
    ): Promise<AgentRunHandle> {
      return createNewRun(input.stableChatId);
    },

    subscribe(
      runId: string,
      handler: (event: AgentRunEvent) => void,
      options?: AgentSubscribeOptions,
    ): TauriTavernHostUnsubscribe {
      const state = runs.get(runId);
      if (!state) {
        options?.onError?.(new Error(`[TT Agent Simulator] Run not found: ${runId}`));
        return () => {};
      }
      const afterSeq = options?.afterSeq ?? 0;
      const replay = state.events.filter(e => e.seq > afterSeq);
      const sliced =
        typeof options?.limit === 'number' ? replay.slice(0, options.limit) : replay;
      for (const ev of sliced) {
        try {
          handler(deepClone(ev));
        } catch (err) {
          options?.onError?.(err);
        }
      }
      state.subscribers.add(handler);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        state.subscribers.delete(handler);
      };
    },

    async cancel(runId: string): Promise<AgentRunHandle> {
      const state = runs.get(runId);
      if (!state) {
        throw new Error(`[TT Agent Simulator] Run not found: ${runId}`);
      }
      emitRunEvent(runId, {
        type: 'run_cancelled',
        status: 'cancelled',
      });
      return deepClone(state.handle);
    },

    async readEvents(input: {
      runId: string;
      afterSeq?: number;
      beforeSeq?: number;
      limit?: number;
    }): Promise<{ events: AgentRunEvent[] }> {
      const state = runs.get(input.runId);
      if (!state) {
        return { events: [] };
      }
      let list = state.events.filter(ev => {
        if (typeof input.afterSeq === 'number' && ev.seq <= input.afterSeq) return false;
        if (typeof input.beforeSeq === 'number' && ev.seq >= input.beforeSeq) return false;
        return true;
      });
      if (typeof input.limit === 'number' && input.limit >= 0) {
        list = list.slice(0, input.limit);
      }
      return { events: deepClone(list) };
    },

    async readWorkspaceFile(input: {
      runId: string;
      path: string;
    }): Promise<AgentWorkspaceFile> {
      return readWorkspaceFile(input.runId, input.path);
    },

    profiles: {
      async list(): Promise<{ profiles: AgentProfileSummary[] }> {
        const list: AgentProfileSummary[] = Array.from(profiles.values()).map(p => ({
          id: p.id,
          displayName: p.displayName,
          description: p.description,
        }));
        return { profiles: list };
      },

      async load(
        input: string | { profileId: string },
      ): Promise<{ profile: AgentProfileDefinition | null }> {
        const id = normalizeProfileId(input);
        const found = profiles.get(id) ?? null;
        return { profile: found ? deepClone(found) : null };
      },

      async save(
        input: AgentProfileDefinition | { profile: AgentProfileDefinition },
      ): Promise<void> {
        const profile = 'profile' in input ? input.profile : input;
        if (!profile || !profile.id) {
          throw new Error('[TT Agent Simulator] Invalid AgentProfileDefinition');
        }
        profiles.set(profile.id, deepClone(profile));
      },

      async delete(input: string | { profileId: string }): Promise<void> {
        const id = normalizeProfileId(input);
        profiles.delete(id);
      },
    },
  };

  return {
    api,
    emitRunEvent,
    writeWorkspaceFile,
    readWorkspaceFile,
    getRun(runId: string): AgentRunHandle | null {
      const state = runs.get(runId);
      return state ? deepClone(state.handle) : null;
    },
    dispose() {
      profiles.clear();
      runs.clear();
    },
  };
}

// ───────────────────────── 6. Skill Simulator (.ttskill) ─────────────────────────

interface StoredSkillRecord {
  entry: TauriTavernSkillIndexEntry;
  files: Map<string, string>;
}

function extractDescriptionFromSkillFiles(
  name: string,
  files: TauriTavernSkillImportFile[] | undefined,
): string {
  const skillMd = files?.find(
    f => f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md'),
  )?.content;
  if (skillMd) {
    const descMatch = skillMd.match(/description\s*:\s*["']?([^\r\n"']+)["']?/i);
    if (descMatch?.[1]) return descMatch[1].trim();
    const firstLine = skillMd
      .split(/\r?\n/)
      .map(l => l.replace(/^#+\s*/, '').trim())
      .find(l => l.length > 0 && !l.startsWith('---'));
    if (firstLine) return firstLine;
  }
  return `Simulated skill package: ${name}`;
}

function createSkillSimulator(): SkillSimulatorControl {
  const skills = new Map<string, StoredSkillRecord>();

  const exportSkillImpl = async (input: {
    name: string;
  }): Promise<TauriTavernSkillExportPayload> => {
    const record = skills.get(input.name);
    if (!record) {
      throw new Error(`[TT Skill Simulator] Skill not found: ${input.name}`);
    }
    const serialized = JSON.stringify({
      name: record.entry.name,
      source: record.entry.source,
      files: Array.from(record.files.entries()).map(([path, content]) => ({
        path,
        content,
      })),
    });
    return {
      fileName: `${record.entry.name}.ttskill`,
      contentBase64: encodeBase64(serialized),
      sha256: computePseudoSha256(serialized),
    };
  };

  const deleteSkillImpl = async (input: { name: string }): Promise<void> => {
    skills.delete(input.name);
  };

  const api: TauriTavernSkillApi = {
    async list(): Promise<{ skills: TauriTavernSkillIndexEntry[] }> {
      return {
        skills: Array.from(skills.values()).map(s => deepClone(s.entry)),
      };
    },

    async installImport(
      request: TauriTavernSkillInstallRequest,
    ): Promise<TauriTavernSkillInstallResult> {
      const name = request.input?.name?.trim() || 'unnamed-skill';
      const strategy = request.conflictStrategy ?? 'skip';
      const existing = skills.get(name);

      if (existing && strategy === 'skip') {
        return {
          name,
          action: 'skipped',
          skill: deepClone(existing.entry),
        };
      }

      const fileMap = new Map<string, string>();
      for (const file of request.input?.files ?? []) {
        fileMap.set(file.path, file.content);
      }
      const combinedText = Array.from(fileMap.entries())
        .map(([p, c]) => `${p}:${c}`)
        .join('\n');

      const entry: TauriTavernSkillIndexEntry = {
        name,
        description: extractDescriptionFromSkillFiles(name, request.input?.files),
        sha256: computePseudoSha256(combinedText || name),
        source: request.input?.source ?? null,
        updatedAt: new Date().toISOString(),
      };

      skills.set(name, { entry, files: fileMap });

      return {
        name,
        action: existing ? 'replaced' : 'installed',
        skill: deepClone(entry),
      };
    },

    async readFile(
      request: TauriTavernSkillReadRequest,
    ): Promise<TauriTavernSkillReadResult> {
      const record = skills.get(request.name);
      if (!record) {
        throw new Error(`[TT Skill Simulator] Skill not found: ${request.name}`);
      }
      const fullContent = record.files.get(request.path);
      if (fullContent === undefined) {
        throw new Error(
          `[TT Skill Simulator] Skill file not found: ${request.name}/${request.path}`,
        );
      }

      const allLines = fullContent.split(/\r?\n/);
      const totalLines = allLines.length;
      const totalChars = fullContent.length;

      const startLine = Math.max(1, request.startLine ?? 1);
      const endLine =
        typeof request.lineCount === 'number'
          ? Math.min(totalLines, startLine + Math.max(0, request.lineCount) - 1)
          : totalLines;

      let sliced =
        request.startLine !== undefined || request.lineCount !== undefined
          ? allLines.slice(startLine - 1, endLine).join('\n')
          : fullContent;

      const startChar = Math.max(0, request.startChar ?? 0);
      if (startChar > 0) {
        sliced = sliced.slice(startChar);
      }

      let truncated = false;
      if (typeof request.maxChars === 'number' && sliced.length > request.maxChars) {
        sliced = sliced.slice(0, request.maxChars);
        truncated = true;
      }

      return {
        name: request.name,
        path: request.path,
        content: sliced,
        chars: sliced.length,
        totalChars,
        startChar,
        endChar: startChar + sliced.length,
        totalLines,
        startLine,
        endLine,
        bytes: utf8ByteLength(fullContent),
        sha256: computePseudoSha256(fullContent),
        truncated,
        resourceRef: `ttskill://${request.name}/${request.path}`,
      };
    },

    export: exportSkillImpl,
    exportSkill: exportSkillImpl,
    delete: deleteSkillImpl,
    deleteSkill: deleteSkillImpl,
  };

  return {
    api,
    clear() {
      skills.clear();
    },
  };
}

// ───────────────────────── 7. Main Installer Entry ─────────────────────────

export function installTauriTavernSimulator(
  options: TauriTavernSimulatorOptions = {},
): TauriTavernSimulatorInstance {
  const { targetWin, targetDoc } = ensureHostWindowAndDocument(options);

  const layoutSim = createLayoutSimulator(
    targetDoc,
    options.initialLayoutPreset ?? 'desktop',
  );
  const chatSurfaceSim = createChatSurfaceSimulator(
    targetDoc,
    options.managedChatSurface ?? true,
  );
  const extensionStoreSim = createExtensionStoreSimulator();
  const worldInfoSim = createWorldInfoSimulator();
  const agentSim = createAgentSimulator();
  const skillSim = createSkillSimulator();

  const simControl: TauriTavernSimulatorControl = {
    chatSurface: chatSurfaceSim,
    layout: layoutSim,
    extensionStore: extensionStoreSim,
    worldInfo: worldInfoSim,
    agent: agentSim,
    skill: skillSim,
  };

  // Safety Red Line: Do not overwrite an existing non-simulator __TAURITAVERN__ unless force: true
  const existing = targetWin.__TAURITAVERN__ as
    | (TauriTavernWindowGlobal & { [SIMULATOR_FLAG]?: boolean })
    | undefined;

  if (existing && typeof existing === 'object' && !existing[SIMULATOR_FLAG] && !options.force) {
    return {
      installed: false,
      skippedReason: 'real-host-present',
      hostGlobal: existing,
      simControl,
      uninstall() {
        // No-op: never remove or mutate a real TauriTavern host global
      },
    };
  }

  const readyPromise = Promise.resolve(true);
  const simulatedGlobal: TauriTavernWindowGlobal & { [SIMULATOR_FLAG]: boolean } = {
    [SIMULATOR_FLAG]: true,
    abiVersion: 1,
    traceHeader: 'x-tauritavern-sim-trace',
    ready: readyPromise,
    api: {
      layout: layoutSim.api,
      chatSurface: chatSurfaceSim.api,
      extensionStore: extensionStoreSim.api,
      worldInfo: worldInfoSim.api,
      agent: agentSim.api,
      skill: skillSim.api,
    },
  };

  const hadMainReady = '__TAURITAVERN_MAIN_READY__' in targetWin;
  const previousMainReady = targetWin.__TAURITAVERN_MAIN_READY__;

  targetWin.__TAURITAVERN__ = simulatedGlobal;
  targetWin.__TAURITAVERN_MAIN_READY__ = readyPromise;

  let uninstalled = false;
  return {
    installed: true,
    hostGlobal: simulatedGlobal,
    simControl,
    uninstall() {
      if (uninstalled) return;
      uninstalled = true;

      chatSurfaceSim.dispose();
      layoutSim.dispose();
      extensionStoreSim.clear();
      worldInfoSim.dispose();
      agentSim.dispose();
      skillSim.clear();

      if (targetWin.__TAURITAVERN__ === simulatedGlobal) {
        delete targetWin.__TAURITAVERN__;
      }
      if (!hadMainReady) {
        delete targetWin.__TAURITAVERN_MAIN_READY__;
      } else {
        targetWin.__TAURITAVERN_MAIN_READY__ = previousMainReady;
      }
    },
  };
}
