/**
 * ttHostBridge.ts —— TauriTavern 宿主平台 ABI v1 统一探测与跨帧桥接网关
 *
 * 架构文档：docs/Architecture/TaruiTavern/README.md (§4.1)
 * 实施任务包：docs/Architecture/Future Developments/30-TauriTavern宿主适配与专属开发脚手架实施任务包.md (PKG-B)
 *
 * 核心职责：
 * 1. 作为全工程（除 ttHostSimulator.ts 外）唯一允许直接访问 `window.__TAURITAVERN__` 的网关模块；
 * 2. 支持从当前 window 向上穿透同源 parent（最多 4 层，兼容 TH-script--* 角色脚本 iframe 与原生 third-party 扩展）；
 * 3. 封装 Layout API、ChatSurface API、ExtensionStore API、WorldInfo API、Agent API、Skill API 的类型契约与安全访问器；
 * 4. 在传统 SillyTavern 环境下 100% 优雅判空回退（零异常、零副作用）。
 */

export type TauriTavernHostUnsubscribe = () => void | Promise<void>;
export type TauriTavernDisposable = (() => void) | { dispose(): void };

// ───────────────────────── 1. Layout API & Surface Taxonomy ─────────────────────────

export type TauriTavernMobileSurfaceType =
  | 'backdrop'
  | 'fullscreen-window'
  | 'free-window'
  | 'viewport-host'
  | 'edge-window'
  | 'none';

export const TT_SURFACE = {
  Backdrop: 'backdrop',
  FullscreenWindow: 'fullscreen-window',
  FreeWindow: 'free-window',
  ViewportHost: 'viewport-host',
  EdgeWindow: 'edge-window',
  None: 'none',
} as const satisfies Record<string, TauriTavernMobileSurfaceType>;

export interface LayoutRect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface LayoutInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LayoutImeState {
  activeSurface: Element | null;
  kind: 'composer' | 'fixed-shell' | 'dialog' | null;
  bottom: number;
  viewportBottomInset: number;
  keyboardOffset: number;
}

export interface LayoutSnapshot {
  timestampMs: number;
  viewport: LayoutRect;
  safeInsets: LayoutInsets;
  safeFrame: LayoutRect;
  ime: LayoutImeState;
}

export interface TauriTavernLayoutApi {
  snapshot(): LayoutSnapshot;
  subscribe(
    handler: (snap: LayoutSnapshot) => void,
  ): Promise<TauriTavernHostUnsubscribe> | TauriTavernHostUnsubscribe;
}

/**
 * 为 DOM 元素显式标记 TauriTavern 移动端几何准入契约 `data-tt-mobile-surface`
 */
export function applyMobileSurface(
  el: Element | HTMLElement | null | undefined,
  surface: TauriTavernMobileSurfaceType,
): void {
  if (!el || typeof el !== 'object') return;
  const htmlEl = el as HTMLElement;
  if (htmlEl.dataset) {
    htmlEl.dataset.ttMobileSurface = surface;
  } else if (typeof htmlEl.setAttribute === 'function') {
    htmlEl.setAttribute('data-tt-mobile-surface', surface);
  }
}

// ───────────────────────── 2. ChatSurface API (Participant V1) ─────────────────────────

export interface ChatSurfacePrepareContext {
  mesid: number;
  content: HTMLElement;
}

export interface ChatSurfaceMountedContext {
  mesid: number;
  element: HTMLElement;
  content: HTMLElement;
  signal: AbortSignal;
}

export interface ChatSurfaceRuntimeActivateContext extends ChatSurfaceMountedContext {
  source: Element;
}

export interface ChatSurfaceRuntimeClaims {
  claim(
    source: Element,
    activate: (context: ChatSurfaceRuntimeActivateContext) => TauriTavernDisposable,
  ): void;
}

export interface ChatSurfaceParticipantV1 {
  id: string;
  protocolVersion: 1;
  prepareContent?: (
    context: ChatSurfacePrepareContext,
    claims: ChatSurfaceRuntimeClaims,
  ) => void;
  didMount?: (context: ChatSurfaceMountedContext) => void | TauriTavernDisposable;
  didCommitContent?: (context: ChatSurfaceMountedContext) => void | TauriTavernDisposable;
}

export interface TauriTavernChatSurfaceApi {
  protocolVersion: number;
  isManagedOwnershipRequired?: () => boolean;
  registerParticipant(participant: ChatSurfaceParticipantV1): TauriTavernDisposable;
}

// ───────────────────────── 3. ExtensionStore API (KV & Blob) ─────────────────────────

export interface ExtensionStoreKeyRef {
  namespace: string;
  key: string;
  table?: string;
}

export interface ExtensionStoreSetJsonInput<T = unknown> extends ExtensionStoreKeyRef {
  value: T;
}

export interface ExtensionStoreRenameKeyInput extends ExtensionStoreKeyRef {
  newKey: string;
}

export interface ExtensionStoreTableRef {
  namespace: string;
  table?: string;
}

export interface ExtensionStoreSetBlobInput extends ExtensionStoreKeyRef {
  data: Blob | ArrayBuffer | Uint8Array | string;
}

export interface TauriTavernExtensionStoreApi {
  getJson<T = unknown>(input: ExtensionStoreKeyRef): Promise<T>;
  tryGetJson<T = unknown>(
    input: ExtensionStoreKeyRef,
  ): Promise<{ found: boolean; value?: T }>;
  setJson<T = unknown>(input: ExtensionStoreSetJsonInput<T>): Promise<void>;
  updateJson<T = unknown>(input: ExtensionStoreSetJsonInput<T>): Promise<void>;
  renameKey?(input: ExtensionStoreRenameKeyInput): Promise<void>;
  deleteJson(input: ExtensionStoreKeyRef): Promise<void>;
  listKeys(input: ExtensionStoreTableRef): Promise<string[]>;
  listTables(input: { namespace: string }): Promise<string[]>;
  deleteTable(input: { namespace: string; table: string }): Promise<void>;
  getBlob?(input: ExtensionStoreKeyRef): Promise<Blob>;
  setBlob?(input: ExtensionStoreSetBlobInput): Promise<void>;
  deleteBlob?(input: ExtensionStoreKeyRef): Promise<void>;
  listBlobKeys?(input: ExtensionStoreTableRef): Promise<string[]>;
}

// ───────────────────────── 4. WorldInfo API ─────────────────────────

export interface WorldInfoActivatedEntry {
  world: string;
  uid: string | number;
  displayName: string;
  constant: boolean;
  content?: string;
  position?: string;
}

export interface WorldInfoActivationBatch {
  timestampMs: number;
  trigger?: string;
  entries: WorldInfoActivatedEntry[];
}

export interface TauriTavernWorldInfoApi {
  getLastActivation(): Promise<WorldInfoActivationBatch | null>;
  subscribeActivations(
    handler: (batch: WorldInfoActivationBatch) => void,
  ): Promise<TauriTavernHostUnsubscribe> | TauriTavernHostUnsubscribe;
  openEntry(ref: { world: string; uid: string | number }): Promise<{ opened: boolean }>;
}

// ───────────────────────── 5. Agent API ─────────────────────────

export type AgentRunStatus =
  | 'created'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | string;

export interface AgentRunHandle {
  runId: string;
  status: AgentRunStatus;
  workspaceId: string;
  stableChatId: string;
}

export interface AgentRunEvent {
  seq: number;
  id: string;
  runId: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  type: string;
  payload: unknown;
}

export interface AgentWorkspaceFile {
  path: string;
  text: string;
  bytes: number;
  sha256: string;
}

export interface AgentProfileSummary {
  id: string;
  displayName: string;
  description?: string;
}

export interface AgentProfileDefinition {
  schemaVersion: 1;
  kind: 'tauritavern.agentProfile';
  id: string;
  displayName: string;
  description?: string;
  callable?: boolean;
  allowAsSubagent?: boolean;
  preset: { mode: 'currentPromptSnapshot' };
  model: { mode: 'currentPromptSnapshot' };
  run: {
    presentation: 'foreground' | 'background';
    modelRetry?: { maxRetries: number; intervalMs: number };
  };
  instructions: {
    agentSystemPrompt: string | null;
  };
  tools: {
    allow: string[];
    deny: string[];
    maxRounds: number;
    maxCallsPerRun: number;
  };
  skills: {
    visible: string[];
    deny: string[];
    maxReadCharsPerCall: number;
    maxReadCharsPerRun: number;
  };
  workspace: {
    visibleRoots: string[];
    writableRoots: string[];
  };
  plan: {
    mode: 'none';
  };
  output: {
    artifacts: Array<{
      id: string;
      path: string;
      kind: 'markdown' | 'json' | 'text';
      target: 'messageBody' | 'workspaceOnly';
      required: boolean;
      assemblyOrder: number;
    }>;
  };
}

export interface AgentProfilesApi {
  list(): Promise<{ profiles: AgentProfileSummary[] }>;
  load(
    input: string | { profileId: string },
  ): Promise<{ profile: AgentProfileDefinition | null }>;
  save(
    input: AgentProfileDefinition | { profile: AgentProfileDefinition },
  ): Promise<void>;
  delete(input: string | { profileId: string }): Promise<void>;
}

export interface AgentStartRunFromLegacyGenerateInput {
  chatRef?: unknown;
  stableChatId?: string;
  generationType?: string;
  generateOptions?: Record<string, unknown>;
  profileId?: string | null;
  generationIntent?: unknown;
  presentation?: 'foreground' | 'background';
  options?: {
    presentation?: 'foreground' | 'background';
    stream?: false;
  };
}

export interface AgentPromptSnapshot {
  chatCompletionPayload: unknown;
  worldInfoActivation?: WorldInfoActivationBatch;
}

export interface AgentStartRunWithPromptSnapshotInput {
  chatRef: unknown;
  stableChatId?: string;
  generationType?: string;
  profileId?: string | null;
  promptSnapshot: AgentPromptSnapshot;
  generationIntent?: unknown;
  presentation?: 'foreground' | 'background';
  options?: {
    presentation?: 'foreground' | 'background';
    stream?: boolean;
  };
}

export interface AgentSubscribeOptions {
  afterSeq?: number;
  limit?: number;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

export interface TauriTavernAgentApi {
  startRunFromLegacyGenerate(
    input?: AgentStartRunFromLegacyGenerateInput,
  ): Promise<AgentRunHandle>;
  startRunWithPromptSnapshot(
    input: AgentStartRunWithPromptSnapshotInput,
  ): Promise<AgentRunHandle>;
  subscribe(
    runId: string,
    handler: (event: AgentRunEvent) => void,
    options?: AgentSubscribeOptions,
  ): TauriTavernHostUnsubscribe;
  cancel(runId: string): Promise<AgentRunHandle>;
  readEvents(input: {
    runId: string;
    afterSeq?: number;
    beforeSeq?: number;
    limit?: number;
  }): Promise<{ events: AgentRunEvent[] }>;
  readWorkspaceFile(input: {
    runId: string;
    path: string;
  }): Promise<AgentWorkspaceFile>;
  profiles: AgentProfilesApi;
}

// ───────────────────────── 6. Skill API (.ttskill) ─────────────────────────

export interface TauriTavernSkillIndexEntry {
  name: string;
  description: string;
  sha256?: string;
  source?: string | null;
  updatedAt?: string;
}

export interface TauriTavernSkillImportFile {
  path: string;
  content: string;
}

export interface TauriTavernSkillImportInput {
  kind?: 'inlineFiles' | 'directory' | 'archiveFile' | 'archiveBase64';
  name?: string;
  source?: string;
  files?: TauriTavernSkillImportFile[];
  archiveBase64?: string;
}

export interface TauriTavernSkillInstallRequest {
  input: TauriTavernSkillImportInput;
  conflictStrategy?: 'skip' | 'replace';
}

export interface TauriTavernSkillInstallResult {
  name: string;
  action: 'installed' | 'replaced' | 'already_installed' | 'skipped';
  skill?: TauriTavernSkillIndexEntry;
}

export interface TauriTavernSkillReadRequest {
  name: string;
  path: string;
  maxChars?: number;
  startLine?: number;
  lineCount?: number;
  startChar?: number;
}

export interface TauriTavernSkillReadResult {
  name: string;
  path: string;
  content: string;
  chars: number;
  totalChars: number;
  startChar: number;
  endChar: number;
  totalLines: number;
  startLine: number;
  endLine: number;
  bytes: number;
  sha256: string;
  truncated: boolean;
  resourceRef: string;
}

export interface TauriTavernSkillExportPayload {
  fileName: string;
  contentBase64: string;
  sha256: string;
}

export interface TauriTavernSkillApi {
  list?(): Promise<{ skills: TauriTavernSkillIndexEntry[] } | TauriTavernSkillIndexEntry[]>;
  installImport(
    request: TauriTavernSkillInstallRequest,
  ): Promise<TauriTavernSkillInstallResult>;
  readFile(request: TauriTavernSkillReadRequest): Promise<TauriTavernSkillReadResult>;
  export?(input: { name: string }): Promise<TauriTavernSkillExportPayload>;
  exportSkill?(input: { name: string }): Promise<TauriTavernSkillExportPayload>;
  delete?(input: { name: string }): Promise<void>;
  deleteSkill?(input: { name: string }): Promise<void>;
}

// ───────────────────────── 7. Window Global & Bridge Contract ─────────────────────────

export interface TauriTavernApiNamespace {
  layout?: TauriTavernLayoutApi;
  chatSurface?: TauriTavernChatSurfaceApi;
  extensionStore?: TauriTavernExtensionStoreApi;
  extension?: {
    store?: TauriTavernExtensionStoreApi;
    [key: string]: unknown;
  };
  worldInfo?: TauriTavernWorldInfoApi;
  agent?: TauriTavernAgentApi;
  skill?: TauriTavernSkillApi;
  [key: string]: unknown;
}

export interface TauriTavernWindowGlobal {
  abiVersion?: number;
  traceHeader?: string;
  ready?: Promise<unknown> | null;
  api?: TauriTavernApiNamespace;
  [key: string]: unknown;
}

export const TT_AGENT_SYSTEM_NAMESPACE = 'agent-system';
export const TT_AGENT_SYSTEM_SETTINGS_KEY = 'settings';
export const TT_AGENT_SYSTEM_SETTINGS_CHANGED_EVENT =
  'tauritavern-agent-system-settings-changed';

export interface TauriTavernAgentSystemSettings {
  agentModeEnabled?: boolean;
  activeProfileId?: string;
  editingProfileId?: string;
  [key: string]: unknown;
}

export interface TauriTavernHostDiagnostics {
  isTauriTavern: boolean;
  abiVersion: number | null;
  chatSurfaceManaged: boolean;
  chatSurfaceProtocolVersion: number | null;
  hasLayoutApi: boolean;
  hasExtensionStoreApi: boolean;
  hasWorldInfoApi: boolean;
  hasAgentApi: boolean;
  hasSkillApi: boolean;
  safeFrameSummary: string;
}

export interface TauriTavernBridge {
  readonly isTauriTavern: boolean;
  readonly abiVersion: number | null;
  readonly raw: TauriTavernWindowGlobal | null;
  readonly hostWindow: Record<string, unknown> | null;
  waitForReady(): Promise<boolean>;
  isChatSurfaceManaged(): boolean;
  isAgentModeEnabled(): Promise<boolean>;
  subscribeAgentMode(
    handler: (enabled: boolean, settings?: TauriTavernAgentSystemSettings) => void,
  ): TauriTavernHostUnsubscribe;
  readonly layout: TauriTavernLayoutApi | null;
  readonly chatSurface: TauriTavernChatSurfaceApi | null;
  readonly extensionStore: TauriTavernExtensionStoreApi | null;
  readonly worldInfo: TauriTavernWorldInfoApi | null;
  readonly agent: TauriTavernAgentApi | null;
  readonly skill: TauriTavernSkillApi | null;
  diagnose(): TauriTavernHostDiagnostics;
}

/**
 * 从指定窗口或 globalThis 开始向上最多穿透 4 层同源 parent，寻找挂载了 `__TAURITAVERN__` 的宿主窗口
 */
export function resolveTauriTavernWindow(
  startWin?: unknown,
): Record<string, unknown> | null {
  let cur: unknown =
    startWin !== undefined
      ? startWin
      : typeof window !== 'undefined'
        ? window
        : globalThis;

  for (let depth = 0; depth <= 4; depth++) {
    if (!cur || typeof cur !== 'object') break;
    const rec = cur as Record<string, unknown>;
    try {
      if (
        (rec.__TAURITAVERN__ && typeof rec.__TAURITAVERN__ === 'object') ||
        rec.__TAURI_RUNNING__ === true ||
        rec.__TAURITAVERN_MAIN_READY__ != null
      ) {
        return rec;
      }
      const next = rec.parent;
      if (!next || next === cur) break;
      cur = next;
    } catch {
      // Cross-origin frame access guard
      break;
    }
  }
  return null;
}

export function getTauriTavernRaw(
  startWin?: unknown,
): TauriTavernWindowGlobal | null {
  const hostWin = resolveTauriTavernWindow(startWin);
  if (!hostWin) return null;
  const raw = hostWin.__TAURITAVERN__;
  if (raw && typeof raw === 'object') {
    return raw as TauriTavernWindowGlobal;
  }
  return null;
}

export function isTauriTavernEnvironment(startWin?: unknown): boolean {
  return resolveTauriTavernWindow(startWin) !== null;
}

/**
 * 等待 TauriTavern 宿主内核就绪（`__TAURITAVERN__.ready ?? __TAURITAVERN_MAIN_READY__`）。
 * 若当前并非 TauriTavern 环境，则立即返回 `false`，不阻塞传统 SillyTavern 启动。
 */
export async function waitForTauriTavernReady(startWin?: unknown): Promise<boolean> {
  const hostWin = resolveTauriTavernWindow(startWin);
  if (!hostWin) return false;
  try {
    const raw = hostWin.__TAURITAVERN__ as TauriTavernWindowGlobal | undefined;
    const readyPromise = raw?.ready ?? hostWin.__TAURITAVERN_MAIN_READY__;
    if (readyPromise && typeof (readyPromise as Promise<unknown>).then === 'function') {
      await readyPromise;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 判断当前是否由 TauriTavern ChatSurface 虚拟列表托管聊天消息 DOM 所有权。
 * 遵循官方契约：仅当 `api.chatSurface.isManagedOwnershipRequired() === true` 且 `protocolVersion === 1` 时返回 `true`。
 */
export function isChatSurfaceManaged(startWin?: unknown): boolean {
  try {
    const raw = getTauriTavernRaw(startWin);
    const cs = raw?.api?.chatSurface;
    if (!cs || typeof cs !== 'object') return false;
    if (cs.protocolVersion !== 1 || typeof cs.registerParticipant !== 'function') {
      return false;
    }
    return cs.isManagedOwnershipRequired?.() === true;
  } catch {
    return false;
  }
}

/**
 * 探测 TauriTavern 当前是否开启了主对话 Agent 模式（`agent-system.settings.agentModeEnabled`）。
 * 在传统 SillyTavern 或未启用时安全返回 `false`。
 */
export async function isTauriTavernAgentModeEnabled(
  startWin?: unknown,
): Promise<boolean> {
  try {
    const raw = getTauriTavernRaw(startWin);
    const extStore = raw?.api?.extensionStore ?? raw?.api?.extension?.store;
    if (!extStore || typeof extStore.tryGetJson !== 'function') {
      return false;
    }
    const result = await extStore.tryGetJson<TauriTavernAgentSystemSettings>({
      namespace: TT_AGENT_SYSTEM_NAMESPACE,
      key: TT_AGENT_SYSTEM_SETTINGS_KEY,
    });
    if (!result || result.found !== true || !result.value) {
      return false;
    }
    return Boolean(result.value.agentModeEnabled);
  } catch {
    return false;
  }
}

/**
 * 订阅 TauriTavern 主对话 Agent 模式开关变更事件（`tauritavern-agent-system-settings-changed`）。
 * 在传统 SillyTavern 下返回空操作清理函数。
 */
export function subscribeTauriTavernAgentMode(
  handler: (enabled: boolean, settings?: TauriTavernAgentSystemSettings) => void,
  startWin?: unknown,
): TauriTavernHostUnsubscribe {
  const targets = new Set<EventTarget>();
  const hostWin = resolveTauriTavernWindow(startWin);
  if (hostWin && typeof (hostWin as unknown as EventTarget).addEventListener === 'function') {
    targets.add(hostWin as unknown as EventTarget);
  }
  if (
    typeof window !== 'undefined' &&
    typeof window.addEventListener === 'function'
  ) {
    targets.add(window);
  }
  if (targets.size === 0) {
    return () => {};
  }

  const onEvent = (evt: Event) => {
    try {
      const customEvt = evt as CustomEvent<{
        settings?: TauriTavernAgentSystemSettings;
      }>;
      const settings = customEvt?.detail?.settings;
      const enabled = Boolean(settings?.agentModeEnabled);
      handler(enabled, settings);
    } catch {
      // ignore listener errors
    }
  };

  for (const target of targets) {
    try {
      target.addEventListener(TT_AGENT_SYSTEM_SETTINGS_CHANGED_EVENT, onEvent);
    } catch {
      // ignore cross-frame or unsupported event target
    }
  }

  return () => {
    for (const target of targets) {
      try {
        target.removeEventListener(
          TT_AGENT_SYSTEM_SETTINGS_CHANGED_EVENT,
          onEvent,
        );
      } catch {
        // ignore cleanup error
      }
    }
  };
}

export function diagnoseTauriTavernHost(
  startWin?: unknown,
): TauriTavernHostDiagnostics {
  const hostWin = resolveTauriTavernWindow(startWin);
  const raw = getTauriTavernRaw(startWin);
  const api = raw?.api;
  const cs = api?.chatSurface;
  const layout = api?.layout;
  const extStore = api?.extensionStore ?? api?.extension?.store;

  let safeFrameSummary = 'N/A (Legacy Host)';
  if (layout && typeof layout.snapshot === 'function') {
    try {
      const snap = layout.snapshot();
      const sf = snap?.safeFrame;
      const imeOffset = snap?.ime?.keyboardOffset ?? 0;
      if (sf && Number.isFinite(sf.width) && Number.isFinite(sf.height)) {
        safeFrameSummary = `${Math.round(sf.width)}×${Math.round(sf.height)} (insets: T${snap.safeInsets?.top ?? 0}/R${snap.safeInsets?.right ?? 0}/B${snap.safeInsets?.bottom ?? 0}/L${snap.safeInsets?.left ?? 0}, IME: ${imeOffset}px)`;
      }
    } catch {
      safeFrameSummary = 'Layout snapshot error';
    }
  }

  return {
    isTauriTavern: hostWin !== null,
    abiVersion: typeof raw?.abiVersion === 'number' ? raw.abiVersion : null,
    chatSurfaceManaged: isChatSurfaceManaged(startWin),
    chatSurfaceProtocolVersion:
      typeof cs?.protocolVersion === 'number' ? cs.protocolVersion : null,
    hasLayoutApi: Boolean(layout && typeof layout.snapshot === 'function'),
    hasExtensionStoreApi: Boolean(
      extStore && typeof extStore.setJson === 'function',
    ),
    hasWorldInfoApi: Boolean(
      api?.worldInfo && typeof api.worldInfo.getLastActivation === 'function',
    ),
    hasAgentApi: Boolean(
      api?.agent && typeof api.agent.startRunFromLegacyGenerate === 'function',
    ),
    hasSkillApi: Boolean(
      api?.skill && typeof api.skill.installImport === 'function',
    ),
    safeFrameSummary,
  };
}

export function getTauriTavernBridge(startWin?: unknown): TauriTavernBridge {
  return {
    get isTauriTavern() {
      return isTauriTavernEnvironment(startWin);
    },
    get abiVersion() {
      const raw = getTauriTavernRaw(startWin);
      return typeof raw?.abiVersion === 'number' ? raw.abiVersion : null;
    },
    get raw() {
      return getTauriTavernRaw(startWin);
    },
    get hostWindow() {
      return resolveTauriTavernWindow(startWin);
    },
    waitForReady() {
      return waitForTauriTavernReady(startWin);
    },
    isChatSurfaceManaged() {
      return isChatSurfaceManaged(startWin);
    },
    isAgentModeEnabled() {
      return isTauriTavernAgentModeEnabled(startWin);
    },
    subscribeAgentMode(handler) {
      return subscribeTauriTavernAgentMode(handler, startWin);
    },
    get layout() {
      const api = getTauriTavernRaw(startWin)?.api?.layout;
      return api && typeof api.snapshot === 'function' ? api : null;
    },
    get chatSurface() {
      const api = getTauriTavernRaw(startWin)?.api?.chatSurface;
      return api && typeof api.registerParticipant === 'function' ? api : null;
    },
    get extensionStore() {
      const rawApi = getTauriTavernRaw(startWin)?.api;
      const api = rawApi?.extensionStore ?? rawApi?.extension?.store;
      return api && typeof api.setJson === 'function' ? api : null;
    },
    get worldInfo() {
      const api = getTauriTavernRaw(startWin)?.api?.worldInfo;
      return api && typeof api.getLastActivation === 'function' ? api : null;
    },
    get agent() {
      const api = getTauriTavernRaw(startWin)?.api?.agent;
      return api && typeof api.startRunFromLegacyGenerate === 'function' ? api : null;
    },
    get skill() {
      const api = getTauriTavernRaw(startWin)?.api?.skill;
      return api && typeof api.installImport === 'function' ? api : null;
    },
    diagnose() {
      return diagnoseTauriTavernHost(startWin);
    },
  };
}

export const ttHostBridge: TauriTavernBridge = getTauriTavernBridge();
