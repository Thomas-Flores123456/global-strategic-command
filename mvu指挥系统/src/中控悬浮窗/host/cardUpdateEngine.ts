/**
 * cardUpdateEngine.ts —— 角色卡远端版本感知、跨代存档变动拦截与生产级安全写卡引擎（FD-47 · W2）
 *
 * 核心职责：
 * 1. 安全版本比对 `safeCompareVersion`（显式基于 compare-versions，非标版本号自动降级，根治 TRAP-01）；
 * 2. 多源 CDN 自动重写（testingcf.jsdelivr.net <-> cdn.jsdelivr.net）与 15 秒全程流超时拉取；
 * 3. 跨版本区间扫描 + 存档结构代数（save_schema）双重高危判定 `evaluateUpdatePlan`（根治 TRAP-06）；
 * 4. PNG `tEXt` 块（ccv3 优先 / chara 次选）解析、CRC32 封装与内嵌版本号防撕裂核验（根治 TRAP-03）；
 * 5. 真实头像文件名定位 `resolveCurrentAvatarFile` 与重名卡 `卡名1.png` 伪异常 `finishImport` 补救（根治 TRAP-02）；
 * 6. 自动检查与静默更新高危强制拦截状态机 `checkCardUpdate`。
 */

import { reactive } from 'vue';
import { compare, validate } from 'compare-versions';

/** 酒馆助手全局函数安全探测（iframe 注入或测试环境 stub；缺失时返回 undefined） */
function tav<T = (...args: never[]) => unknown>(name: string): T | undefined {
  const fn = (globalThis as Record<string, unknown>)[name];
  return typeof fn === 'function' ? (fn as T) : undefined;
}

export const CARD_UPDATE_PREFS_STORAGE_KEY = 'rac_card_update_prefs_v1';
export const DEFAULT_LOCAL_SAVE_SCHEMA = 2;
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
export const DEFAULT_LOCAL_SERVER_URL = 'http://127.0.0.1:5500';
export const DEFAULT_LOCAL_PROBE_TIMEOUT_MS = 4_000;

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ReleaseNoteItem {
  version: string;
  date?: string;
  breaking_save: boolean;
  save_schema?: number;
  save_warning?: string;
  notes: string | string[];
  summary?: string;
  save_migration_note?: string;
}

export type CardReleaseEntry = ReleaseNoteItem;

export interface CardUpdateManifest {
  card_name?: string;
  latest_version: string;
  save_schema: number;
  card_url: string | string[];
  releases: ReleaseNoteItem[];
}

export interface CardUpdatePreferences {
  checkOnStartup: boolean;
  autoUpdateSilent: boolean;
  manifestUrl: string;
  ignoredVersion: string;
  localServerUrl?: string;
  dismissedBreakingVersion?: string;
}

export type CardUpdateConfig = CardUpdatePreferences;

export type UpdateCheckStatus =
  | 'up-to-date'
  | 'update-available'
  | 'breaking-update-available'
  | 'unconfigured'
  | 'error';

export interface LocalServerVersionStatus {
  ok: boolean;
  mode: 'pc-local-server';
  autoUpdateEnabled: boolean;
  local: {
    version: string;
    saveSchema: number;
    distReady: boolean;
    missingDist?: string[];
    gitBranch?: string;
    gitCommitShort?: string;
    gitDirty?: boolean;
  };
  check: {
    status: UpdateCheckStatus;
    checkedAt: string;
    localVersion: string;
    latestVersion: string;
    localSaveSchema?: number;
    remoteSaveSchema?: number;
    hasUpdate: boolean;
    hasBreakingSaveChange: boolean;
    missedReleases: CardReleaseEntry[];
    breakingWarnings: string[];
    downloadUrl?: string;
    error?: string;
  };
}

export interface LocalServerUpdateResult {
  ok: boolean;
  status: 'updated' | 'up-to-date' | 'dirty-worktree' | 'error';
  message: string;
  previousVersion: string;
  currentVersion: string;
  distReady?: boolean;
  updatedAt?: string;
  offline?: boolean;
  error?: string;
  steps?: Array<{ step: string; ok: boolean; detail: string }>;
}

export interface UpdateCheckResult {
  status?: UpdateCheckStatus;
  checkedAt: string;
  localVersion: string;
  latestVersion: string;
  localSaveSchema: number;
  remoteSaveSchema: number;
  hasUpdate: boolean;
  hasBreakingSaveChange: boolean;
  hasLegacyChatSaveMismatch: boolean;
  resolvedCardUrls: string[];
  downloadUrl?: string;
  missedReleases: ReleaseNoteItem[];
  breakingWarnings: string[];
  manifest?: CardUpdateManifest;
  error?: string;
  localServerOnline?: boolean;
  localDistReady?: boolean;
  localGitBranch?: string;
  localGitCommitShort?: string;
}

export type UpdateStage =
  | 'idle'
  | 'checking'
  | 'fetching_card'
  | 'verifying_png'
  | 'importing_card'
  | 'finishing_worldbook'
  | 'done'
  | 'error';

export interface CardUpdateRuntimeState {
  busy: boolean;
  stage: UpdateStage;
  stageDetail: string;
  lastError: string | null;
  lastCheck: UpdateCheckResult | null;
  shouldPromptModal: boolean;
  localServerOnline?: boolean;
  localDistReady?: boolean;
}

export type VersionCompareOperator = '<' | '<=' | '>' | '>=' | '=';

export interface CheckCardUpdateOptions {
  manifestUrl?: string;
  localServerUrl?: string;
  localVersion?: string;
  localSaveSchema?: number;
  chatSaveSchema?: number;
  triggerAutoUpdateIfSafe?: boolean;
  forcePopupOnNormalUpdate?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const DEFAULT_CARD_UPDATE_PREFERENCES: Readonly<CardUpdatePreferences> = Object.freeze({
  checkOnStartup: true,
  autoUpdateSilent: false,
  manifestUrl: '',
  ignoredVersion: '',
  localServerUrl: DEFAULT_LOCAL_SERVER_URL,
  dismissedBreakingVersion: '',
});

export const DEFAULT_UPDATE_CONFIG = DEFAULT_CARD_UPDATE_PREFERENCES;

export const cardUpdateState: CardUpdateRuntimeState = reactive<CardUpdateRuntimeState>({
  busy: false,
  stage: 'idle',
  stageDetail: '',
  lastError: null,
  lastCheck: null,
  shouldPromptModal: false,
  localServerOnline: false,
  localDistReady: false,
});

/* ═══════════════════════ 1. 版本归一化与安全比对（TRAP-01） ═══════════════════════ */

/**
 * 归一化版本号字符串：去除首尾空白与前导 v/V。
 */
export function normalizeVersion(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^[vV]+/, '').trim();
}

/**
 * 安全版本比对纯函数（根治 TRAP-01）：
 * - 显式使用 compare-versions 的 validate + compare；
 * - 遇到非标准版本号（如 "新春版"、"测试版"）时绝不抛错，安全回退为字符串与 0.0.0 规则判定。
 */
export function safeCompareVersion(
  v1: string,
  v2: string,
  op: VersionCompareOperator,
): boolean {
  const norm1 = normalizeVersion(v1);
  const norm2 = normalizeVersion(v2);

  if (norm1 && norm2 && validate(norm1) && validate(norm2)) {
    try {
      return compare(norm1, norm2, op);
    } catch {
      // 落入下方非标准版本号安全回退分支
    }
  }

  if (op === '=') {
    return norm1 === norm2;
  }
  if (norm1 === norm2) {
    return op === '<=' || op === '>=';
  }

  const isZeroOrEmpty1 = norm1 === '' || norm1 === '0.0.0' || norm1 === '0.0';
  const isZeroOrEmpty2 = norm2 === '' || norm2 === '0.0.0' || norm2 === '0.0';

  let cmp: number;
  if (isZeroOrEmpty1 && !isZeroOrEmpty2) {
    cmp = -1;
  } else if (!isZeroOrEmpty1 && isZeroOrEmpty2) {
    cmp = 1;
  } else {
    try {
      const localeCmp = norm1.localeCompare(norm2, undefined, { numeric: true, sensitivity: 'base' });
      cmp = localeCmp !== 0 ? localeCmp : norm1 < norm2 ? -1 : 1;
    } catch {
      cmp = norm1 < norm2 ? -1 : 1;
    }
  }

  switch (op) {
    case '<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    case '>=':
      return cmp >= 0;
    default:
      return false;
  }
}

/* ═══════════════════════ 2. 多源 CDN 候选派生与全程超时拉取 ═══════════════════════ */

const JSDELIVR_TESTINGCF_PREFIX = 'https://testingcf.jsdelivr.net/';
const JSDELIVR_CDN_PREFIX = 'https://cdn.jsdelivr.net/';

function replaceVersionPlaceholder(rawUrl: string, version?: string): string {
  if (typeof version !== 'string' || !version.trim()) {
    return rawUrl;
  }
  const cleanVer = normalizeVersion(version) || version.trim();
  const rawVer = version.trim();
  return rawUrl
    .replace(/([vV])\{version\}/g, (_m, prefix: string) => `${prefix}${encodeURIComponent(cleanVer)}`)
    .replace(/\{version\}/g, encodeURIComponent(rawVer));
}

/**
 * 将单个或多个 URL 展开为去重的多源候选列表：
 * - 自动替换 `{version}` 占位符为 `encodeURIComponent(version)`；
 * - 若匹配 `testingcf.jsdelivr.net` 或 `cdn.jsdelivr.net`，自动派生另一子域同路径备源。
 */
export function deriveCdnFallbackUrls(
  urlOrUrls: string | string[],
  version?: string,
): string[] {
  const inputs = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
  const out: string[] = [];
  const seen = new Set<string>();

  const pushUnique = (u: string) => {
    const trimmed = u.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  for (const item of inputs) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const resolved = replaceVersionPlaceholder(trimmed, version);
    pushUnique(resolved);

    if (resolved.toLowerCase().startsWith(JSDELIVR_TESTINGCF_PREFIX)) {
      const rest = resolved.slice(JSDELIVR_TESTINGCF_PREFIX.length);
      pushUnique(`${JSDELIVR_CDN_PREFIX}${rest}`);
    } else if (resolved.toLowerCase().startsWith(JSDELIVR_CDN_PREFIX)) {
      const rest = resolved.slice(JSDELIVR_CDN_PREFIX.length);
      pushUnique(`${JSDELIVR_TESTINGCF_PREFIX}${rest}`);
    }
  }

  return out;
}

/**
 * 带 AbortController 全程流读取超时与多源 CDN 自动备援的拉取器。
 */
export async function fetchWithCdnFallback(
  urlOrUrls: string | string[],
  type: 'text',
  timeoutMs?: number,
  fetchImpl?: typeof fetch,
): Promise<string>;
export async function fetchWithCdnFallback(
  urlOrUrls: string | string[],
  type: 'blob',
  timeoutMs?: number,
  fetchImpl?: typeof fetch,
): Promise<Blob>;
export async function fetchWithCdnFallback<T = unknown>(
  urlOrUrls: string | string[],
  type: 'json',
  timeoutMs?: number,
  fetchImpl?: typeof fetch,
): Promise<T>;
export async function fetchWithCdnFallback(
  urlOrUrls: string | string[],
  type: 'text' | 'blob' | 'json',
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  fetchImpl?: typeof fetch,
): Promise<string | Blob | unknown> {
  const candidates = deriveCdnFallbackUrls(urlOrUrls);
  if (candidates.length === 0) {
    throw new Error('未提供有效的远端地址');
  }

  const fetchFn = fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetchFn) {
    throw new Error('当前环境不支持 fetch 请求');
  }

  const errors: string[] = [];
  const effectiveTimeout =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_FETCH_TIMEOUT_MS;

  for (const url of candidates) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const timeoutErr = new Error(`请求超时（>${effectiveTimeout}ms）`);
          try {
            controller.abort(timeoutErr);
          } catch {
            controller.abort();
          }
          reject(timeoutErr);
        }, effectiveTimeout);
      });

      const taskPromise = (async () => {
        const response = await fetchFn(url, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
        }
        if (type === 'blob') {
          if (typeof response.blob === 'function') {
            return await response.blob();
          }
          const buf = await response.arrayBuffer();
          return new Blob([buf]);
        }
        if (type === 'text') {
          return await response.text();
        }
        if (typeof response.json === 'function') {
          return await response.json();
        }
        const rawText = await response.text();
        return JSON.parse(rawText) as unknown;
      })();

      return await Promise.race([taskPromise, timeoutPromise]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${url}] ${msg}`);
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  }

  throw new Error(`远端资源拉取失败（已尝试 ${candidates.length} 个源）：${errors.join('；')}`);
}

/* ═══════════════════════ 3. 跨版本区间扫描 + 存档代数双重高危判定（TRAP-06） ═══════════════════════ */

/**
 * 评估本地版本、存档结构代数与远端清单的差异及高危存档变动状态。
 */
export function evaluateUpdatePlan(
  localVersion: string,
  localSaveSchema: number,
  manifest: CardUpdateManifest,
  chatSaveSchema?: number,
): UpdateCheckResult {
  const normLocal = normalizeVersion(localVersion) || '0.0.0';
  const normLatest = normalizeVersion(manifest.latest_version) || manifest.latest_version.trim() || '0.0.0';
  const safeLocalSchema =
    typeof localSaveSchema === 'number' && Number.isFinite(localSaveSchema)
      ? localSaveSchema
      : DEFAULT_LOCAL_SAVE_SCHEMA;
  const remoteSaveSchema =
    typeof manifest.save_schema === 'number' && Number.isFinite(manifest.save_schema)
      ? manifest.save_schema
      : safeLocalSchema;

  const hasUpdate = safeCompareVersion(normLocal, normLatest, '<');
  const releases = Array.isArray(manifest.releases) ? manifest.releases : [];
  const missedReleases = releases.filter(
    r => r && typeof r.version === 'string' && safeCompareVersion(r.version, normLocal, '>'),
  );

  const hasReleaseBreaking = missedReleases.some(r => Boolean(r.breaking_save));
  const hasSchemaBump =
    typeof manifest.save_schema === 'number' && manifest.save_schema > safeLocalSchema;
  const hasBreakingSaveChange = hasUpdate && (hasReleaseBreaking || hasSchemaBump);

  const maxTargetSchema = Math.max(safeLocalSchema, remoteSaveSchema);
  const hasLegacyChatSaveMismatch =
    typeof chatSaveSchema === 'number' &&
    Number.isFinite(chatSaveSchema) &&
    chatSaveSchema < maxTargetSchema;

  const breakingWarnings: string[] = [];
  for (const rel of missedReleases) {
    if (rel.breaking_save && typeof rel.save_warning === 'string' && rel.save_warning.trim()) {
      const cleanRelVer = normalizeVersion(rel.version) || rel.version.trim();
      breakingWarnings.push(`[v${cleanRelVer}] ${rel.save_warning.trim()}`);
    }
  }

  if (hasSchemaBump && breakingWarnings.length === 0) {
    breakingWarnings.push(
      `新版战局存档结构已升级（第 ${safeLocalSchema} 代 ▸ 第 ${manifest.save_schema} 代），直接更新可能影响旧档字段读取，请先备份当前战局。`,
    );
  } else if (hasBreakingSaveChange && breakingWarnings.length === 0) {
    breakingWarnings.push(
      '检测到跨越版本包含战局存档结构调整，直接更新可能影响旧档字段读取，请先备份当前战局。',
    );
  }

  const resolvedCardUrls = deriveCdnFallbackUrls(manifest.card_url, normLatest);
  const status: UpdateCheckStatus = hasBreakingSaveChange
    ? 'breaking-update-available'
    : hasUpdate
      ? 'update-available'
      : 'up-to-date';

  return {
    status,
    checkedAt: new Date().toISOString(),
    localVersion: normLocal,
    latestVersion: normLatest,
    localSaveSchema: safeLocalSchema,
    remoteSaveSchema,
    hasUpdate,
    hasBreakingSaveChange,
    hasLegacyChatSaveMismatch,
    resolvedCardUrls,
    downloadUrl: resolvedCardUrls[0] || undefined,
    missedReleases,
    breakingWarnings,
    manifest,
  };
}

/* ═══════════════════════ 4. PNG tEXt 块解析、CRC32 封装与内嵌版本预核验（TRAP-03） ═══════════════════════ */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * 计算标准 IEEE 802.3 CRC32 校验值（供 PNG Chunk 封装使用）。
 */
export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 判断二进制字节流是否为标准 PNG（前 8 字节匹配 `\x89PNG\r\n\x1a\n`）。
 */
export function isPngBytes(buffer: Uint8Array): boolean {
  if (!(buffer instanceof Uint8Array) || buffer.byteLength < PNG_SIGNATURE.byteLength) {
    return false;
  }
  for (let i = 0; i < PNG_SIGNATURE.byteLength; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) {
      return false;
    }
  }
  return true;
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    const ab = await blob.arrayBuffer();
    return new Uint8Array(ab);
  }
  if (typeof Response !== 'undefined') {
    const ab = await new Response(blob).arrayBuffer();
    return new Uint8Array(ab);
  }
  return await new Promise<Uint8Array>((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('当前环境不支持读取 Blob 二进制内容'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error('FileReader 未返回 ArrayBuffer'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取 Blob 失败'));
    reader.readAsArrayBuffer(blob);
  });
}

function decodeBase64Utf8(base64: string): string {
  const cleaned = base64.replace(/[\r\n\s]+/g, '');
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return Buffer.from(cleaned, 'base64').toString('utf-8');
  }
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function encodeBase64Utf8(text: string): string {
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return Buffer.from(text, 'utf-8').toString('base64');
  }
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function parseCardPayloadObject(rawText: string): Record<string, unknown> | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  // 若本身已是 JSON 文本
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return obj as Record<string, unknown>;
      }
    } catch {
      // 继续尝试 Base64 解码
    }
  }

  try {
    const decoded = decodeBase64Utf8(trimmed);
    const obj = JSON.parse(decoded);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
  } catch {
    // 忽略损坏块
  }
  return null;
}

function extractVersionFromCardObject(card: Record<string, unknown> | null): string | null {
  if (!card) return null;
  const data =
    card.data && typeof card.data === 'object' && !Array.isArray(card.data)
      ? (card.data as Record<string, unknown>)
      : null;
  const rawVer = data?.character_version ?? card.character_version;
  if (typeof rawVer === 'string' && rawVer.trim().length > 0) {
    return rawVer.trim();
  }
  return null;
}

function extractCardObjectFromPngBytes(bytes: Uint8Array): Record<string, unknown> | null {
  if (!isPngBytes(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let ccv3Payload: string | null = null;
  let charaPayload: string | null = null;

  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.byteLength) {
      break;
    }

    if (type === 'tEXt' && length > 0) {
      let nullIdx = -1;
      for (let i = dataStart; i < dataEnd; i++) {
        if (bytes[i] === 0) {
          nullIdx = i;
          break;
        }
      }
      if (nullIdx > dataStart) {
        let keyword = '';
        for (let i = dataStart; i < nullIdx; i++) {
          keyword += String.fromCharCode(bytes[i]);
        }
        const keyLower = keyword.toLowerCase();
        if (keyLower === 'ccv3' || keyLower === 'chara') {
          const textBytes = bytes.subarray(nullIdx + 1, dataEnd);
          const payloadText = new TextDecoder('latin1').decode(textBytes);
          if (keyLower === 'ccv3') {
            ccv3Payload = payloadText;
          } else if (keyLower === 'chara') {
            charaPayload = payloadText;
          }
        }
      }
    }

    if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (ccv3Payload) {
    const parsedCcv3 = parseCardPayloadObject(ccv3Payload);
    if (parsedCcv3) return parsedCcv3;
  }
  if (charaPayload) {
    const parsedChara = parseCardPayloadObject(charaPayload);
    if (parsedChara) return parsedChara;
  }
  return null;
}

/**
 * 从角色卡 Blob（PNG 或 JSON）中提取内嵌的角色卡对象。
 */
export async function extractCardObjectFromBlob(
  blob: Blob,
): Promise<Record<string, unknown> | null> {
  try {
    const bytes = await readBlobBytes(blob);
    if (isPngBytes(bytes)) {
      return extractCardObjectFromPngBytes(bytes);
    }
    const text = new TextDecoder('utf-8').decode(bytes);
    return parseCardPayloadObject(text);
  } catch {
    return null;
  }
}

/**
 * 从角色卡 Blob（支持含 `ccv3` / `chara` `tEXt` 块的 PNG 与 JSON 文本）中提取 `character_version`。
 */
export async function extractVersionFromCardBlob(blob: Blob): Promise<string | null> {
  try {
    const cardObj = await extractCardObjectFromBlob(blob);
    return extractVersionFromCardObject(cardObj);
  } catch {
    return null;
  }
}

/**
 * 构造标准 PNG `tEXt` Chunk（含 4 字节大端长度 + 'tEXt' + keyword + 0x00 + text + 4 字节大端 CRC32）。
 */
export function createPngTextChunk(keyword: string, text: string): Uint8Array {
  const keyBytes = new TextEncoder().encode(keyword);
  const textBytes = new TextEncoder().encode(text);
  const dataLength = keyBytes.byteLength + 1 + textBytes.byteLength;
  const chunk = new Uint8Array(12 + dataLength);
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

  view.setUint32(0, dataLength, false);
  chunk[4] = 0x74; // 't'
  chunk[5] = 0x45; // 'E'
  chunk[6] = 0x58; // 'X'
  chunk[7] = 0x74; // 't'

  chunk.set(keyBytes, 8);
  chunk[8 + keyBytes.byteLength] = 0x00;
  chunk.set(textBytes, 8 + keyBytes.byteLength + 1);

  const crc = computeCrc32(chunk.subarray(4, 8 + dataLength));
  view.setUint32(8 + dataLength, crc, false);
  return chunk;
}

function createDefaultEndChunk(): Uint8Array {
  const chunk = new Uint8Array(12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 0, false);
  chunk[4] = 0x49; // 'I'
  chunk[5] = 0x45; // 'E'
  chunk[6] = 0x4e; // 'N'
  chunk[7] = 0x44; // 'D'
  const crc = computeCrc32(chunk.subarray(4, 8));
  view.setUint32(8, crc, false);
  return chunk;
}

async function fetchCurrentAvatarPngBytes(cardName?: string): Promise<Uint8Array> {
  const avatarFile = resolveCurrentAvatarFile(cardName);
  const getCharFn = tav<(name: string) => Promise<{ avatar?: unknown }>>('getCharacter');
  if (getCharFn) {
    try {
      const ch = await getCharFn(avatarFile);
      if (ch?.avatar instanceof Blob) {
        const bytes = await readBlobBytes(ch.avatar);
        if (isPngBytes(bytes)) return bytes;
      }
    } catch {
      // 忽略并尝试后续途径
    }
  }

  const st = getSillyTavernContext();
  const candidateUrls: string[] = [];
  if (typeof st?.getThumbnailUrl === 'function') {
    try {
      const thumbUrl = st.getThumbnailUrl('avatar', avatarFile);
      if (typeof thumbUrl === 'string' && thumbUrl.trim()) {
        candidateUrls.push(thumbUrl.trim());
      }
    } catch {
      // 忽略
    }
  }
  candidateUrls.push(`/characters/${encodeURIComponent(avatarFile)}`);

  for (const url of candidateUrls) {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (resp.ok) {
        const blob = await resp.blob();
        const bytes = await readBlobBytes(blob);
        if (isPngBytes(bytes)) {
          return bytes;
        }
      }
    } catch {
      // 尝试下一个候选
    }
  }

  throw new Error(`无法获取当前角色卡（${cardName || avatarFile}）的真实头像 PNG，已中止封装以防损毁头像`);
}

/**
 * 将 JSON 角色卡封装进现有 PNG 头像中：
 * - 移除原有的 `chara` / `ccv3` `tEXt` 块；
 * - 在 `IEND` 块前写入新的 `chara` 与 `ccv3` `tEXt` 块并重算标准 CRC32。
 */
export async function wrapJsonCardIntoPng(
  cardName: string,
  jsonText: string,
  existingPngBytes?: Uint8Array,
): Promise<Blob> {
  const basePng =
    existingPngBytes && isPngBytes(existingPngBytes)
      ? existingPngBytes
      : await fetchCurrentAvatarPngBytes(cardName);

  if (!isPngBytes(basePng)) {
    throw new Error('提供的头像底图不是有效的 PNG 二进制数据');
  }

  let normalizedJson = jsonText.trim();
  try {
    const parsed = JSON.parse(normalizedJson) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (cardName && typeof parsed.name !== 'string') {
        parsed.name = cardName;
      }
      normalizedJson = JSON.stringify(parsed);
    }
  } catch {
    throw new Error('角色卡 JSON 内容格式非法，无法封装为 PNG');
  }

  const base64Payload = encodeBase64Utf8(normalizedJson);
  const charaChunk = createPngTextChunk('chara', base64Payload);
  const ccv3Chunk = createPngTextChunk('ccv3', base64Payload);

  const keptChunks: Uint8Array[] = [PNG_SIGNATURE];
  const view = new DataView(basePng.buffer, basePng.byteOffset, basePng.byteLength);
  let offset = 8;
  let iendChunk: Uint8Array | null = null;

  while (offset + 12 <= basePng.byteLength) {
    const length = view.getUint32(offset, false);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > basePng.byteLength) {
      break;
    }
    const type = String.fromCharCode(
      basePng[offset + 4],
      basePng[offset + 5],
      basePng[offset + 6],
      basePng[offset + 7],
    );

    if (type === 'tEXt' && length > 0) {
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      let nullIdx = -1;
      for (let i = dataStart; i < dataEnd; i++) {
        if (basePng[i] === 0) {
          nullIdx = i;
          break;
        }
      }
      if (nullIdx > dataStart) {
        let keyword = '';
        for (let i = dataStart; i < nullIdx; i++) {
          keyword += String.fromCharCode(basePng[i]);
        }
        const keyLower = keyword.toLowerCase();
        if (keyLower === 'chara' || keyLower === 'ccv3') {
          offset = chunkEnd;
          continue;
        }
      }
    }

    if (type === 'IEND') {
      iendChunk = basePng.subarray(offset, chunkEnd);
      break;
    }

    keptChunks.push(basePng.subarray(offset, chunkEnd));
    offset = chunkEnd;
  }

  keptChunks.push(charaChunk);
  keptChunks.push(ccv3Chunk);
  keptChunks.push(iendChunk ?? createDefaultEndChunk());

  const totalLength = keptChunks.reduce((acc, part) => acc + part.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of keptChunks) {
    output.set(part, cursor);
    cursor += part.byteLength;
  }

  return new Blob([output], { type: 'image/png' });
}

/* ═══════════════════════ 5. 真实头像文件名定位与卡名1.png finishImport 补救（TRAP-02） ═══════════════════════ */

interface SillyTavernCharacterEntry {
  name?: string;
  avatar?: string;
  version?: string;
  character_version?: string;
  data?: {
    name?: string;
    character_version?: string;
    character_book?: {
      name?: string;
      entries?: unknown;
      [k: string]: unknown;
    };
    extensions?: {
      world?: string;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

interface SillyTavernContextLike {
  characterId?: string | number;
  characters?: SillyTavernCharacterEntry[];
  name2?: string;
  getCharacters?: () => Promise<unknown>;
  getOneCharacter?: (avatarFile: string) => Promise<unknown>;
  saveWorldInfo?: (name: string, data: unknown, immediately?: boolean) => Promise<unknown>;
  reloadWorldInfoEditor?: (file: string, loadIfNotSelected?: boolean) => void;
  convertCharacterBook?: (characterBook: unknown) => unknown;
  reloadCurrentChat?: () => Promise<unknown>;
  getThumbnailUrl?: (type: string, file: string) => string;
}

function getSillyTavernContext(): SillyTavernContextLike | null {
  const extract = (win: unknown): SillyTavernContextLike | null => {
    if (!win || typeof win !== 'object') return null;
    const st = (win as Record<string, unknown>).SillyTavern;
    if (!st || typeof st !== 'object') return null;
    const stObj = st as Record<string, unknown>;
    if (typeof stObj.getContext === 'function') {
      try {
        const ctx = (stObj.getContext as () => unknown)();
        if (ctx && typeof ctx === 'object') {
          return new Proxy(stObj as SillyTavernContextLike, {
            get(target, prop, receiver) {
              if (prop in target && target[prop as keyof SillyTavernContextLike] !== undefined) {
                return Reflect.get(target, prop, receiver);
              }
              return (ctx as Record<string | symbol, unknown>)[prop];
            },
          });
        }
      } catch {
        // 忽略
      }
    }
    return stObj as SillyTavernContextLike;
  };

  const direct = extract(globalThis);
  if (direct) return direct;

  if (typeof window !== 'undefined') {
    let cur: Window | null = window;
    for (let depth = 0; depth < 4 && cur; depth++) {
      try {
        const found = extract(cur);
        if (found) return found;
        if (!cur.parent || cur.parent === cur) break;
        cur = cur.parent;
      } catch {
        break;
      }
    }
  }
  return null;
}

function getCurrentCharacterNameSafe(): string {
  const fn = tav<() => string | null>('getCurrentCharacterName');
  if (fn) {
    try {
      const name = fn();
      if (typeof name === 'string' && name.trim()) {
        return name.trim();
      }
    } catch {
      // 忽略
    }
  }
  const st = getSillyTavernContext();
  if (typeof st?.name2 === 'string' && st.name2.trim()) {
    return st.name2.trim();
  }
  return '';
}

function ensurePngExtension(fileOrName: string): string {
  const trimmed = fileOrName.trim();
  if (!trimmed) return 'character.png';
  return /\.png$/i.test(trimmed) ? trimmed : `${trimmed}.png`;
}

/**
 * 定位当前角色卡的真实头像文件名（如 `红警系统·测试1.png`），防止重名卡更新建错新卡（根治 TRAP-02）。
 */
export function resolveCurrentAvatarFile(expectedCardName?: string): string {
  const st = getSillyTavernContext();
  const chars = Array.isArray(st?.characters) ? st.characters : [];

  if (st && st.characterId !== undefined && st.characterId !== null && st.characterId !== '') {
    const chid = Number(st.characterId);
    if (Number.isInteger(chid) && chid >= 0 && chid < chars.length) {
      const activeChar = chars[chid];
      if (activeChar && typeof activeChar.avatar === 'string' && activeChar.avatar.trim()) {
        return ensurePngExtension(activeChar.avatar);
      }
    }
  }

  const targetName = (expectedCardName || getCurrentCharacterNameSafe()).trim();
  if (targetName && chars.length > 0) {
    const matched = chars.find(
      c => c && typeof c.name === 'string' && c.name.trim() === targetName && typeof c.avatar === 'string' && c.avatar.trim(),
    );
    if (matched?.avatar) {
      return ensurePngExtension(matched.avatar);
    }
  }

  return ensurePngExtension(targetName || 'character');
}

/**
 * 获取当前本地角色卡的版本号：
 * 优先调用 `getCharacter(resolveCurrentAvatarFile(expectedCardName))` 或 `getCharacter('current')`，
 * 失败时兜底读取 `SillyTavern.characters` 中的 `data?.character_version`，最终兜底 `'0.0.0'`。
 */
export async function getLocalCardVersion(expectedCardName?: string): Promise<string> {
  const avatarFile = resolveCurrentAvatarFile(expectedCardName);
  const getCharFn = tav<
    (name: string) => Promise<{ version?: string; data?: { character_version?: string } } | null | undefined>
  >('getCharacter');

  if (getCharFn) {
    const candidates = [avatarFile, avatarFile.replace(/\.png$/i, ''), 'current'];
    const tried = new Set<string>();
    for (const key of candidates) {
      const trimmedKey = key.trim();
      if (!trimmedKey || tried.has(trimmedKey)) continue;
      tried.add(trimmedKey);
      try {
        const char = await getCharFn(trimmedKey);
        const ver =
          typeof char?.version === 'string' && char.version.trim()
            ? char.version.trim()
            : typeof char?.data?.character_version === 'string' && char.data.character_version.trim()
              ? char.data.character_version.trim()
              : '';
        if (ver) {
          return normalizeVersion(ver) || ver;
        }
      } catch {
        // 继续尝试下一个候选标识
      }
    }
  }

  const st = getSillyTavernContext();
  const chars = Array.isArray(st?.characters) ? st.characters : [];
  if (chars.length > 0) {
    const chid =
      st?.characterId !== undefined && st?.characterId !== null && st?.characterId !== ''
        ? Number(st.characterId)
        : -1;
    const byId = Number.isInteger(chid) && chid >= 0 ? chars[chid] : undefined;
    const byAvatar = chars.find(c => c && c.avatar === avatarFile);
    const byName = expectedCardName
      ? chars.find(c => c && c.name === expectedCardName)
      : undefined;
    const target = byId ?? byAvatar ?? byName;
    const fallbackVer =
      target?.data?.character_version ?? target?.character_version ?? target?.version;
    if (typeof fallbackVer === 'string' && fallbackVer.trim()) {
      return normalizeVersion(fallbackVer) || fallbackVer.trim();
    }
  }

  return '0.0.0';
}

function resolveCurrentPrimaryWorldbook(avatarFile: string): string | null {
  const getCharWb = tav<(target?: string) => { primary?: string | null } | null>('getCharWorldbookNames');
  if (getCharWb) {
    try {
      const wb = getCharWb('current');
      if (typeof wb?.primary === 'string' && wb.primary.trim()) {
        return wb.primary.trim();
      }
    } catch {
      // 忽略
    }
  }
  const st = getSillyTavernContext();
  const chars = Array.isArray(st?.characters) ? st.characters : [];
  const matched =
    chars.find(c => c && c.avatar === avatarFile) ??
    (st?.characterId !== undefined ? chars[Number(st.characterId)] : undefined);
  const world = matched?.data?.extensions?.world;
  if (typeof world === 'string' && world.trim()) {
    return world.trim();
  }
  return null;
}

/**
 * 当 `importRawCharacter` 因同名卡后缀（如 `卡名1.png`）抛出 `不存在` 伪异常时的完整收尾流程：
 * 1. `getCharacters()` 刷新酒馆角色列表；
 * 2. `getOneCharacter(avatarFile)` 加载目标角色卡完整详情；
 * 3. 核对角色卡版本；
 * 4. `saveWorldInfo` & `reloadWorldInfoEditor` 保存并重载内嵌世界书；
 * 5. `reloadCurrentChat` 重载当前聊天会话。
 */
export async function finishImport(
  avatarFile: string,
  oldWorldbook: string | null | undefined,
  expectedVersion: string,
  fallbackCharacterBook?: { name?: string; entries?: unknown; [k: string]: unknown } | null,
): Promise<void> {
  const st = getSillyTavernContext();
  const normalizedAvatar = ensurePngExtension(avatarFile);

  if (typeof st?.getCharacters === 'function') {
    await st.getCharacters();
  }
  if (typeof st?.getOneCharacter === 'function') {
    await st.getOneCharacter(normalizedAvatar);
  }

  const chars = Array.isArray(st?.characters) ? st.characters : [];
  const chid =
    st?.characterId !== undefined && st?.characterId !== null && st?.characterId !== ''
      ? Number(st.characterId)
      : -1;
  const character =
    chars.find(c => c && (c.avatar === normalizedAvatar || c.avatar === avatarFile)) ??
    (Number.isInteger(chid) && chid >= 0 ? chars[chid] : undefined);

  const landedVer = character?.data?.character_version ?? character?.character_version ?? character?.version;
  if (
    typeof landedVer === 'string' &&
    landedVer.trim() &&
    expectedVersion &&
    normalizeVersion(landedVer) !== normalizeVersion(expectedVersion)
  ) {
    throw new Error(
      `角色卡落盘版本核验不一致（期望 v${normalizeVersion(expectedVersion)}，实际 v${normalizeVersion(landedVer)}）`,
    );
  }

  const book = character?.data?.character_book ?? fallbackCharacterBook ?? null;
  const targetBookName =
    (typeof book?.name === 'string' && book.name.trim()) ||
    (typeof oldWorldbook === 'string' && oldWorldbook.trim()) ||
    '';

  if (typeof st?.saveWorldInfo === 'function' && (book || targetBookName)) {
    const bookToSave = book ?? { name: targetBookName, entries: {} };
    const effectiveBookName = targetBookName || (typeof character?.name === 'string' ? character.name : 'worldbook');
    const converted =
      typeof st.convertCharacterBook === 'function'
        ? st.convertCharacterBook(bookToSave)
        : bookToSave;
    await st.saveWorldInfo(effectiveBookName, converted, true);
    if (typeof st.reloadWorldInfoEditor === 'function') {
      st.reloadWorldInfoEditor(effectiveBookName);
    }
  }

  if (typeof st?.reloadCurrentChat === 'function') {
    await st.reloadCurrentChat();
  }
}

function publishCardUpdateGlobalState(payload: UpdateCheckResult | null): void {
  const initGlobal = tav<(name: string, value: unknown) => void>('initializeGlobal');
  if (initGlobal) {
    try {
      initGlobal('RacCardUpdateState', payload);
    } catch {
      // 忽略跨沙盒共享异常
    }
  }
  const emit = tav<(event: string, data?: unknown) => unknown>('eventEmit');
  if (emit) {
    try {
      void emit('rac:card_update_status', payload);
    } catch {
      // 忽略事件广播异常
    }
  }
}

/**
 * 执行生产级安全写卡流程：
 * 1. `fetching_card`：多源 CDN 拉取角色卡 Blob；
 * 2. `verifying_png`：解包 PNG `tEXt` 核对 `character_version === latestVersion`（防 CDN 缓存撕裂）；若为 JSON 则封装为 PNG；
 * 3. `importing_card`：调用 `importRawCharacter`；
 * 4. `finishing_worldbook`：若抛 `不存在` 伪异常，自动调用 `finishImport` 补齐世界书保存与聊天重载；
 * 5. `done`：更新状态并广播 `RacCardUpdateState` 与 `rac:card_update_status`。
 */
export async function performSafeCardUpdate(
  checkResult?: UpdateCheckResult | null,
  onProgress?: (stage: UpdateStage, detail: string) => void,
): Promise<{ ok: boolean; updatedVersion?: string; error?: string }> {
  const report = (stage: UpdateStage, detail: string) => {
    cardUpdateState.stage = stage;
    cardUpdateState.stageDetail = detail;
    onProgress?.(stage, detail);
  };

  const activeCheck = checkResult ?? cardUpdateState.lastCheck;
  if (!activeCheck) {
    const errMsg = '尚未获取有效的版本检查结果，无法执行更新';
    cardUpdateState.stage = 'error';
    cardUpdateState.stageDetail = errMsg;
    cardUpdateState.lastError = errMsg;
    return { ok: false, error: errMsg };
  }

  const candidateUrls =
    Array.isArray(activeCheck.resolvedCardUrls) && activeCheck.resolvedCardUrls.length > 0
      ? activeCheck.resolvedCardUrls
      : activeCheck.manifest?.card_url
        ? deriveCdnFallbackUrls(activeCheck.manifest.card_url, activeCheck.latestVersion)
        : [];

  if (candidateUrls.length === 0) {
    const errMsg = '缺少有效的远端角色卡下载地址';
    cardUpdateState.stage = 'error';
    cardUpdateState.stageDetail = errMsg;
    cardUpdateState.lastError = errMsg;
    return { ok: false, error: errMsg };
  }

  cardUpdateState.busy = true;
  cardUpdateState.lastError = null;

  try {
    report('fetching_card', `正在下载新版角色卡 (v${activeCheck.latestVersion})…`);
    let content = await fetchWithCdnFallback(candidateUrls, 'blob');

    report('verifying_png', '正在校验角色卡文件结构与内嵌版本号…');
    const cardObj = await extractCardObjectFromBlob(content);
    const cardVersion = extractVersionFromCardObject(cardObj);

    if (
      cardVersion !== null &&
      normalizeVersion(cardVersion) !== normalizeVersion(activeCheck.latestVersion)
    ) {
      const mismatchErr = `远端节点缓存尚未同步（下载卡片内嵌版本为 v${normalizeVersion(cardVersion)}，目标版本为 v${normalizeVersion(activeCheck.latestVersion)}）。为防止旧缓存覆盖当前角色卡，已自动中止更新。`;
      cardUpdateState.stage = 'error';
      cardUpdateState.stageDetail = mismatchErr;
      cardUpdateState.lastError = mismatchErr;
      return { ok: false, error: mismatchErr };
    }

    const rawBytes = await readBlobBytes(content);
    const expectedCardName = activeCheck.manifest?.card_name;
    if (!isPngBytes(rawBytes)) {
      const jsonText = new TextDecoder('utf-8').decode(rawBytes);
      content = await wrapJsonCardIntoPng(
        expectedCardName || getCurrentCharacterNameSafe() || 'character',
        jsonText,
      );
    }

    const avatarFile = resolveCurrentAvatarFile(expectedCardName);
    const oldWorldbook = resolveCurrentPrimaryWorldbook(avatarFile);
    const embeddedData =
      cardObj?.data && typeof cardObj.data === 'object' && !Array.isArray(cardObj.data)
        ? (cardObj.data as Record<string, unknown>)
        : null;
    const embeddedBook =
      (embeddedData?.character_book as { name?: string; entries?: unknown } | undefined) ??
      (cardObj?.character_book as { name?: string; entries?: unknown } | undefined) ??
      null;

    report('importing_card', `正在导入角色卡 (${avatarFile})…`);
    const importRawCharacterFn = tav<(filename: string, blob: Blob) => Promise<Response>>(
      'importRawCharacter',
    );
    if (!importRawCharacterFn) {
      throw new Error('酒馆宿主未提供角色卡导入接口 (importRawCharacter)');
    }

    const finalVersion = normalizeVersion(cardVersion ?? activeCheck.latestVersion) || activeCheck.latestVersion;

    try {
      const response = await importRawCharacterFn(avatarFile.replace(/\.png$/i, ''), content);
      if (response && typeof response === 'object') {
        const resJson =
          typeof response.json === 'function'
            ? ((await response.json().catch(() => ({}))) as Record<string, unknown>)
            : {};
        if (('ok' in response && !response.ok) || resJson?.error) {
          const reason =
            typeof resJson?.error === 'string'
              ? resJson.error
              : `导入角色卡失败 (HTTP ${(response as Response).status ?? 'unknown'})`;
          throw new Error(reason);
        }
      }
    } catch (importErr) {
      const errMsg = importErr instanceof Error ? importErr.message : String(importErr);
      if (errMsg.includes('不存在')) {
        report('finishing_worldbook', '正在同步同名角色卡内嵌世界书并刷新当前会话…');
        await finishImport(avatarFile, oldWorldbook, finalVersion, embeddedBook);
      } else {
        throw importErr;
      }
    }

    const updatedCheck: UpdateCheckResult = {
      ...activeCheck,
      localVersion: finalVersion,
      hasUpdate: false,
      hasBreakingSaveChange: false,
    };
    cardUpdateState.lastCheck = updatedCheck;
    cardUpdateState.shouldPromptModal = false;
    cardUpdateState.lastError = null;
    report('done', `角色卡已安全更新至 v${finalVersion}`);

    publishCardUpdateGlobalState(updatedCheck);
    return { ok: true, updatedVersion: finalVersion };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    cardUpdateState.stage = 'error';
    cardUpdateState.stageDetail = msg;
    cardUpdateState.lastError = msg;
    return { ok: false, error: msg };
  } finally {
    cardUpdateState.busy = false;
  }
}

/* ═══════════════════════ 6. 偏好持久化与自动检查/高危强制拦截入口 ═══════════════════════ */

function resolveLocalStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function') {
      return localStorage;
    }
  } catch {
    // 忽略沙箱权限异常
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // 忽略
  }
  return null;
}

function readScriptConfigOverrides(): Partial<CardUpdatePreferences> {
  const gv = tav<(opt: { type: 'script' }) => Record<string, unknown> | undefined>('getVariables');
  if (!gv) return {};
  try {
    const vars = gv({ type: 'script' });
    if (!vars || typeof vars !== 'object') return {};
    const nested =
      vars.card_update && typeof vars.card_update === 'object' && !Array.isArray(vars.card_update)
        ? (vars.card_update as Record<string, unknown>)
        : {};

    const rawUrl =
      vars.manifestUrl ??
      vars.manifest_url ??
      vars['清单链接'] ??
      vars['更新清单链接'] ??
      nested.manifestUrl ??
      nested.manifest_url;
    const rawCheckOnStartup =
      vars.checkOnStartup ??
      vars.check_on_startup ??
      vars['自动检查更新'] ??
      nested.checkOnStartup ??
      nested.check_on_startup;
    const rawAutoSilent =
      vars.autoUpdateSilent ??
      vars.auto_update_silent ??
      vars.auto_update ??
      vars['自动静默更新'] ??
      nested.autoUpdateSilent ??
      nested.auto_update_silent;
    const rawIgnored =
      vars.ignoredVersion ??
      vars.ignored_version ??
      nested.ignoredVersion ??
      nested.ignored_version;

    const out: Partial<CardUpdatePreferences> = {};
    if (typeof rawUrl === 'string' && rawUrl.trim()) {
      out.manifestUrl = rawUrl.trim();
    }
    if (typeof rawCheckOnStartup === 'boolean') {
      out.checkOnStartup = rawCheckOnStartup;
    }
    if (typeof rawAutoSilent === 'boolean') {
      out.autoUpdateSilent = rawAutoSilent;
    }
    if (typeof rawIgnored === 'string') {
      out.ignoredVersion = rawIgnored.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 读取角色卡更新策略偏好（合并脚本级变量配置与 `localStorage['rac_card_update_prefs_v1']`）。
 */
export function getCardUpdatePreferences(customStorage?: Storage | null): CardUpdatePreferences {
  const scriptDefaults = readScriptConfigOverrides();
  const base: CardUpdatePreferences = {
    ...DEFAULT_CARD_UPDATE_PREFERENCES,
    ...scriptDefaults,
    autoUpdateSilent:
      typeof scriptDefaults.autoUpdateSilent === 'boolean' ? scriptDefaults.autoUpdateSilent : false,
  };

  const storage = customStorage !== undefined ? customStorage : resolveLocalStorage();
  if (!storage) return base;

  try {
    const raw = storage.getItem(CARD_UPDATE_PREFS_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<CardUpdatePreferences>;
    if (!parsed || typeof parsed !== 'object') return base;

    const ignoredVer =
      typeof parsed.ignoredVersion === 'string'
        ? parsed.ignoredVersion.trim()
        : base.ignoredVersion;
    const dismissedVer =
      typeof parsed.dismissedBreakingVersion === 'string'
        ? parsed.dismissedBreakingVersion.trim()
        : ignoredVer;

    return {
      checkOnStartup:
        typeof parsed.checkOnStartup === 'boolean' ? parsed.checkOnStartup : base.checkOnStartup,
      autoUpdateSilent:
        typeof parsed.autoUpdateSilent === 'boolean' ? parsed.autoUpdateSilent : false,
      manifestUrl:
        typeof parsed.manifestUrl === 'string' && parsed.manifestUrl.trim()
          ? parsed.manifestUrl.trim()
          : base.manifestUrl,
      ignoredVersion: ignoredVer,
      localServerUrl:
        typeof parsed.localServerUrl === 'string' && parsed.localServerUrl.trim()
          ? parsed.localServerUrl.trim()
          : base.localServerUrl || DEFAULT_LOCAL_SERVER_URL,
      dismissedBreakingVersion: dismissedVer,
    };
  } catch {
    return base;
  }
}

export const loadCardUpdatePreferences = getCardUpdatePreferences;
export const loadUpdateConfig = getCardUpdatePreferences;

/**
 * 更新并持久化角色卡更新策略偏好至 `localStorage['rac_card_update_prefs_v1']`。
 */
export function setCardUpdatePreferences(
  patch: Partial<CardUpdatePreferences>,
  customStorage?: Storage | null,
): CardUpdatePreferences {
  const current = getCardUpdatePreferences(customStorage);
  const nextIgnored =
    typeof patch.ignoredVersion === 'string'
      ? patch.ignoredVersion.trim()
      : typeof patch.dismissedBreakingVersion === 'string'
        ? patch.dismissedBreakingVersion.trim()
        : current.ignoredVersion;
  const nextDismissed =
    typeof patch.dismissedBreakingVersion === 'string'
      ? patch.dismissedBreakingVersion.trim()
      : nextIgnored;

  const next: CardUpdatePreferences = {
    checkOnStartup:
      typeof patch.checkOnStartup === 'boolean' ? patch.checkOnStartup : current.checkOnStartup,
    autoUpdateSilent:
      typeof patch.autoUpdateSilent === 'boolean'
        ? patch.autoUpdateSilent
        : current.autoUpdateSilent,
    manifestUrl:
      typeof patch.manifestUrl === 'string' ? patch.manifestUrl.trim() : current.manifestUrl,
    ignoredVersion: nextIgnored,
    localServerUrl:
      typeof patch.localServerUrl === 'string' && patch.localServerUrl.trim()
        ? patch.localServerUrl.trim()
        : current.localServerUrl || DEFAULT_LOCAL_SERVER_URL,
    dismissedBreakingVersion: nextDismissed,
  };

  const storage = customStorage !== undefined ? customStorage : resolveLocalStorage();
  if (storage) {
    try {
      storage.setItem(CARD_UPDATE_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 忽略配额或隐私限制异常
    }
  }
  return next;
}

export const saveCardUpdatePreferences = setCardUpdatePreferences;
export const saveUpdateConfig = setCardUpdatePreferences;

/**
 * 关闭版本更新提示弹窗；若 `ignoreCurrentVersion === true`，同时记录忽略当前 `latestVersion`。
 */
export function dismissCardUpdatePrompt(ignoreCurrentVersion = false): void {
  cardUpdateState.shouldPromptModal = false;
  if (ignoreCurrentVersion && cardUpdateState.lastCheck?.latestVersion) {
    setCardUpdatePreferences({
      ignoredVersion: cardUpdateState.lastCheck.latestVersion,
      dismissedBreakingVersion: cardUpdateState.lastCheck.latestVersion,
    });
  }
}

/**
 * 重置运行时更新状态（用于测试或会话清理）。
 */
export function resetCardUpdateState(): void {
  cardUpdateState.busy = false;
  cardUpdateState.stage = 'idle';
  cardUpdateState.stageDetail = '';
  cardUpdateState.lastError = null;
  cardUpdateState.lastCheck = null;
  cardUpdateState.shouldPromptModal = false;
  cardUpdateState.localServerOnline = false;
  cardUpdateState.localDistReady = false;
}

function readChatSaveSchemaFromHost(): number | undefined {
  const gv = tav<(opt: { type: 'chat' }) => Record<string, unknown> | undefined>('getVariables');
  if (!gv) return undefined;
  try {
    const chatVars = gv({ type: 'chat' });
    const raw = chatVars?.$save_schema;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return raw;
    }
  } catch {
    // 忽略
  }
  return undefined;
}

/**
 * 获取当前聊天存档格式代数（若未标记则默认返回 DEFAULT_LOCAL_SAVE_SCHEMA = 2）。
 */
export function getCurrentChatSaveSchema(): number {
  return readChatSaveSchemaFromHost() ?? DEFAULT_LOCAL_SAVE_SCHEMA;
}

function resolveLocalSaveSchemaFromHost(): number {
  const gv = tav<(opt: { type: 'script' }) => Record<string, unknown> | undefined>('getVariables');
  if (gv) {
    try {
      const scriptVars = gv({ type: 'script' });
      const raw = scriptVars?.save_schema ?? scriptVars?.saveSchema;
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        return raw;
      }
    } catch {
      // 忽略
    }
  }
  return DEFAULT_LOCAL_SAVE_SCHEMA;
}

/**
 * 拉取并校验远端版本清单 manifest.json。
 */
export async function fetchUpdateManifest(
  manifestUrl: string,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<CardUpdateManifest> {
  const rawManifest = await fetchWithCdnFallback<CardUpdateManifest>(
    manifestUrl,
    'json',
    options?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
    options?.fetchImpl,
  );
  if (
    !rawManifest ||
    typeof rawManifest !== 'object' ||
    typeof rawManifest.latest_version !== 'string' ||
    !rawManifest.latest_version.trim()
  ) {
    throw new Error('远端版本清单格式无效（缺少 latest_version）');
  }
  return {
    card_name: typeof rawManifest.card_name === 'string' ? rawManifest.card_name : undefined,
    latest_version: rawManifest.latest_version.trim(),
    save_schema:
      typeof rawManifest.save_schema === 'number' && Number.isFinite(rawManifest.save_schema)
        ? rawManifest.save_schema
        : DEFAULT_LOCAL_SAVE_SCHEMA,
    card_url: rawManifest.card_url ?? '',
    releases: Array.isArray(rawManifest.releases) ? rawManifest.releases : [],
  };
}

/**
 * 检查远端版本清单（FD-48 确立“默认只检不更”铁律）：
 * - 未配置 `manifestUrl` 时静默返回 `null`；
 * - 若 `hasUpdate && hasBreakingSaveChange`：强制置位 `shouldPromptModal = true`；
 * - 默认只检不更：除非调用方显式传入 `triggerAutoUpdateIfSafe === true` 且 `prefs.autoUpdateSilent === true` 且无破坏性改动，否则绝不调用写卡。
 */
export async function checkCardUpdate(
  options?: CheckCardUpdateOptions,
): Promise<UpdateCheckResult | null> {
  const prefs = getCardUpdatePreferences();
  const manifestUrl = (options?.manifestUrl ?? prefs.manifestUrl ?? '').trim();
  if (!manifestUrl) {
    return null;
  }

  cardUpdateState.busy = true;
  cardUpdateState.stage = 'checking';
  cardUpdateState.stageDetail = '正在检查远端角色卡版本清单…';
  cardUpdateState.lastError = null;

  try {
    const manifest = await fetchUpdateManifest(manifestUrl, {
      fetchImpl: options?.fetchImpl,
      timeoutMs: options?.timeoutMs,
    });

    const localVersion =
      options?.localVersion ?? (await getLocalCardVersion(manifest.card_name));
    const localSaveSchema =
      options?.localSaveSchema ?? resolveLocalSaveSchemaFromHost();
    const chatSaveSchema =
      options?.chatSaveSchema ?? readChatSaveSchemaFromHost();

    const result = evaluateUpdatePlan(
      localVersion,
      localSaveSchema,
      manifest,
      chatSaveSchema,
    );

    cardUpdateState.lastCheck = result;
    publishCardUpdateGlobalState(result);

    if (result.hasUpdate && result.hasBreakingSaveChange) {
      cardUpdateState.shouldPromptModal = true;
      cardUpdateState.stage = 'idle';
      cardUpdateState.stageDetail = `检测到含战局存档结构变动的新版本 (v${result.latestVersion})，请先导出备份`;
      return result;
    }

    if (
      result.hasUpdate &&
      !result.hasBreakingSaveChange &&
      prefs.autoUpdateSilent &&
      options?.triggerAutoUpdateIfSafe === true
    ) {
      await performSafeCardUpdate(result);
      return cardUpdateState.lastCheck ?? result;
    }

    if (result.hasUpdate) {
      const isIgnored =
        Boolean(prefs.ignoredVersion) &&
        normalizeVersion(result.latestVersion) === normalizeVersion(prefs.ignoredVersion);
      if (options?.forcePopupOnNormalUpdate || (!prefs.autoUpdateSilent && !isIgnored)) {
        cardUpdateState.shouldPromptModal = true;
      } else {
        cardUpdateState.shouldPromptModal = false;
      }
      cardUpdateState.stage = 'idle';
      cardUpdateState.stageDetail = `发现角色卡新版本 v${result.latestVersion}`;
      return result;
    }

    cardUpdateState.shouldPromptModal = false;
    cardUpdateState.stage = 'idle';
    cardUpdateState.stageDetail = `当前已是最新版本 (v${result.localVersion})`;
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    cardUpdateState.stage = 'error';
    cardUpdateState.stageDetail = msg;
    cardUpdateState.lastError = msg;
    return null;
  } finally {
    cardUpdateState.busy = false;
  }
}

/* ═══════════════════════ 7. FD-48 本地 PC 服务端 (:5500) 优先桥接与受控更新 ═══════════════════════ */

export interface ProbeLocalServerOptions {
  localServerUrl?: string;
  manifestUrl?: string;
  refresh?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * 探测本地 PC 启动服务（默认 `http://127.0.0.1:5500`）的版本状态接口 `/api/version-status`。
 * 超时（默认 4000ms）或网络错误时静默返回 `null`，绝不抛未捕获异常。
 */
export async function probeLocalServerVersionStatus(
  options?: ProbeLocalServerOptions | string,
): Promise<LocalServerVersionStatus | null> {
  const opts: ProbeLocalServerOptions =
    typeof options === 'string' ? { localServerUrl: options } : (options ?? {});
  const prefs = getCardUpdatePreferences();
  const baseUrl = (opts.localServerUrl || prefs.localServerUrl || DEFAULT_LOCAL_SERVER_URL)
    .trim()
    .replace(/\/+$/, '');
  if (!baseUrl) return null;

  const fetchFn = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetchFn) return null;

  const timeoutMs =
    typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? opts.timeoutMs
      : DEFAULT_LOCAL_PROBE_TIMEOUT_MS;

  const qs = new URLSearchParams();
  if (opts.refresh) qs.set('refresh', '1');
  if (typeof opts.manifestUrl === 'string' && opts.manifestUrl.trim()) {
    qs.set('manifestUrl', opts.manifestUrl.trim());
  }
  const queryStr = qs.toString();
  const targetUrl = `${baseUrl}/api/version-status${queryStr ? `?${queryStr}` : ''}`;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    const timeoutPromise = new Promise<null>(resolve => {
      timer = setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // 忽略
        }
        resolve(null);
      }, timeoutMs);
    });

    const requestPromise = (async (): Promise<LocalServerVersionStatus | null> => {
      const resp = await fetchFn(targetUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!resp || !resp.ok) return null;
      const data = (await resp.json()) as Partial<LocalServerVersionStatus> | null;
      if (
        !data ||
        typeof data !== 'object' ||
        !data.local ||
        typeof data.local !== 'object' ||
        !data.check ||
        typeof data.check !== 'object'
      ) {
        return null;
      }
      cardUpdateState.localServerOnline = true;
      cardUpdateState.localDistReady = Boolean(data.local.distReady);
      return data as LocalServerVersionStatus;
    })();

    const res = await Promise.race([requestPromise, timeoutPromise]);
    if (!res) {
      cardUpdateState.localServerOnline = false;
    }
    return res;
  } catch {
    cardUpdateState.localServerOnline = false;
    return null;
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

export interface CheckLocalOrRemoteOptions {
  manifestUrl?: string;
  localServerUrl?: string;
  localVersion?: string;
  localSaveSchema?: number;
  chatSaveSchema?: number;
  refresh?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  forcePopupOnNormalUpdate?: boolean;
  triggerAutoUpdateIfSafe?: boolean;
}

/**
 * 优先通过本地 `:5500` 服务检测版本，离线或未配置时按需回退至远端 `manifestUrl`（严格只检不更）。
 */
export async function checkCardUpdateViaLocalOrRemote(
  options?: CheckLocalOrRemoteOptions,
): Promise<UpdateCheckResult> {
  const prefs = getCardUpdatePreferences();
  const effectiveManifestUrl = (options?.manifestUrl ?? prefs.manifestUrl ?? '').trim();
  const localServerUrl = (
    options?.localServerUrl ??
    prefs.localServerUrl ??
    DEFAULT_LOCAL_SERVER_URL
  ).trim();

  const status = await probeLocalServerVersionStatus({
    localServerUrl,
    manifestUrl: effectiveManifestUrl || undefined,
    refresh: options?.refresh,
    fetchImpl: options?.fetchImpl,
    timeoutMs: options?.timeoutMs,
  });

  const localChatSaveSchema = options?.chatSaveSchema ?? getCurrentChatSaveSchema();

  if (status) {
    const localSaveSchema =
      options?.localSaveSchema ??
      status.check.localSaveSchema ??
      status.local.saveSchema ??
      DEFAULT_LOCAL_SAVE_SCHEMA;

    if (status.check.status !== 'unconfigured' && status.check.status !== 'error') {
      const localVersion =
        normalizeVersion(
          options?.localVersion ?? status.check.localVersion ?? status.local.version,
        ) || '0.0.0';
      const latestVersion =
        normalizeVersion(status.check.latestVersion ?? status.local.version) || localVersion;
      const remoteSaveSchema =
        typeof status.check.remoteSaveSchema === 'number' &&
        Number.isFinite(status.check.remoteSaveSchema)
          ? status.check.remoteSaveSchema
          : localSaveSchema;

      const hasUpdate =
        Boolean(status.check.hasUpdate) || safeCompareVersion(localVersion, latestVersion, '<');
      const hasChatSchemaJump = remoteSaveSchema > localChatSaveSchema;
      const hasSchemaBump = remoteSaveSchema > localSaveSchema || hasChatSchemaJump;
      const hasBreakingSaveChange =
        Boolean(status.check.hasBreakingSaveChange) || (hasUpdate && hasSchemaBump);

      const mappedStatus: UpdateCheckStatus = hasBreakingSaveChange
        ? 'breaking-update-available'
        : hasUpdate
          ? 'update-available'
          : 'up-to-date';

      const breakingWarnings = Array.isArray(status.check.breakingWarnings)
        ? [...status.check.breakingWarnings]
        : [];
      if (hasBreakingSaveChange && breakingWarnings.length === 0) {
        const baseSchema = Math.min(localSaveSchema, localChatSaveSchema);
        breakingWarnings.push(
          `新版战局存档结构已升级（第 ${baseSchema} 代 ▸ 第 ${remoteSaveSchema} 代），直接更新可能影响旧档字段读取，请先备份当前战局。`,
        );
      }

      const missedReleases: ReleaseNoteItem[] = Array.isArray(status.check.missedReleases)
        ? status.check.missedReleases.map(r => ({
            ...r,
            notes: r.notes ?? r.summary ?? '',
          }))
        : [];

      const downloadUrl = status.check.downloadUrl || '';
      const resolvedCardUrls = downloadUrl
        ? deriveCdnFallbackUrls(downloadUrl, latestVersion)
        : [];

      const result: UpdateCheckResult = {
        status: mappedStatus,
        checkedAt: status.check.checkedAt || new Date().toISOString(),
        localVersion,
        latestVersion,
        localSaveSchema,
        remoteSaveSchema,
        hasUpdate,
        hasBreakingSaveChange,
        hasLegacyChatSaveMismatch:
          localChatSaveSchema < Math.max(localSaveSchema, remoteSaveSchema),
        resolvedCardUrls,
        downloadUrl: downloadUrl || undefined,
        missedReleases,
        breakingWarnings,
        localServerOnline: true,
        localDistReady: Boolean(status.local.distReady),
        localGitBranch: status.local.gitBranch,
        localGitCommitShort: status.local.gitCommitShort,
      };

      cardUpdateState.lastCheck = result;
      cardUpdateState.shouldPromptModal = Boolean(
        (result.hasUpdate && result.hasBreakingSaveChange) ||
          (result.hasUpdate && options?.forcePopupOnNormalUpdate),
      );
      publishCardUpdateGlobalState(result);
      return result;
    }

    // 本地服务在线但 status === 'unconfigured'（或 'error'）
    if (effectiveManifestUrl) {
      const remoteRes = await checkCardUpdate({
        manifestUrl: effectiveManifestUrl,
        localVersion: options?.localVersion ?? status.local.version,
        localSaveSchema,
        chatSaveSchema: localChatSaveSchema,
        fetchImpl: options?.fetchImpl,
        timeoutMs: options?.timeoutMs,
        forcePopupOnNormalUpdate: options?.forcePopupOnNormalUpdate,
        triggerAutoUpdateIfSafe: false,
      });
      if (remoteRes) {
        const enriched: UpdateCheckResult = {
          ...remoteRes,
          localServerOnline: true,
          localDistReady: Boolean(status.local.distReady),
          localGitBranch: status.local.gitBranch,
          localGitCommitShort: status.local.gitCommitShort,
        };
        cardUpdateState.lastCheck = enriched;
        return enriched;
      }
    }

    const localVer =
      normalizeVersion(options?.localVersion ?? status.local.version) || '0.0.0';
    const unconfiguredFallback: UpdateCheckResult = {
      status: 'up-to-date',
      checkedAt: status.check.checkedAt || new Date().toISOString(),
      localVersion: localVer,
      latestVersion: localVer,
      localSaveSchema,
      remoteSaveSchema: localSaveSchema,
      hasUpdate: false,
      hasBreakingSaveChange: false,
      hasLegacyChatSaveMismatch: localChatSaveSchema < localSaveSchema,
      resolvedCardUrls: [],
      missedReleases: [],
      breakingWarnings: [],
      localServerOnline: true,
      localDistReady: Boolean(status.local.distReady),
      localGitBranch: status.local.gitBranch,
      localGitCommitShort: status.local.gitCommitShort,
    };
    cardUpdateState.lastCheck = unconfiguredFallback;
    publishCardUpdateGlobalState(unconfiguredFallback);
    return unconfiguredFallback;
  }

  // 本地服务离线（status === null）
  const fallbackLocalSchema = options?.localSaveSchema ?? resolveLocalSaveSchemaFromHost();
  if (effectiveManifestUrl) {
    const remoteRes = await checkCardUpdate({
      manifestUrl: effectiveManifestUrl,
      localVersion: options?.localVersion,
      localSaveSchema: fallbackLocalSchema,
      chatSaveSchema: localChatSaveSchema,
      fetchImpl: options?.fetchImpl,
      timeoutMs: options?.timeoutMs,
      forcePopupOnNormalUpdate: options?.forcePopupOnNormalUpdate,
      triggerAutoUpdateIfSafe: false,
    });
    if (remoteRes) {
      const enriched: UpdateCheckResult = {
        ...remoteRes,
        localServerOnline: false,
      };
      cardUpdateState.lastCheck = enriched;
      return enriched;
    }
  }

  const fallbackLocalVer =
    normalizeVersion(options?.localVersion ?? (await getLocalCardVersion())) || '0.0.0';
  const offlineFallback: UpdateCheckResult = {
    status: 'up-to-date',
    checkedAt: new Date().toISOString(),
    localVersion: fallbackLocalVer,
    latestVersion: fallbackLocalVer,
    localSaveSchema: fallbackLocalSchema,
    remoteSaveSchema: fallbackLocalSchema,
    hasUpdate: false,
    hasBreakingSaveChange: false,
    hasLegacyChatSaveMismatch: localChatSaveSchema < fallbackLocalSchema,
    resolvedCardUrls: [],
    missedReleases: [],
    breakingWarnings: [],
    localServerOnline: false,
  };
  cardUpdateState.lastCheck = offlineFallback;
  return offlineFallback;
}

export interface TriggerLocalServerUpdateOptions {
  localServerUrl?: string;
  confirmBackupCompleted?: boolean;
  allowDirty?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * 向本地 PC 启动服务 `POST /api/local-update` 发起受控更新（拉取最新代码并重编译 dist/）。
 * 网络失败或超时时返回友好指引结果，绝不抛未捕获异常。
 */
export async function triggerLocalServerUpdate(
  options?: TriggerLocalServerUpdateOptions,
): Promise<LocalServerUpdateResult> {
  const prefs = getCardUpdatePreferences();
  const baseUrl = (
    options?.localServerUrl ||
    prefs.localServerUrl ||
    DEFAULT_LOCAL_SERVER_URL
  )
    .trim()
    .replace(/\/+$/, '');
  const offlineResult: LocalServerUpdateResult = {
    ok: false,
    status: 'error',
    offline: true,
    message: '无法连接本地启动服务（端口 5500），请在电脑端运行「一键更新.bat」完成更新。',
    previousVersion: '',
    currentVersion: '',
  };

  const fetchFn = options?.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!baseUrl || !fetchFn) {
    return offlineResult;
  }

  const timeoutMs =
    typeof options?.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : 60_000;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    const timeoutPromise = new Promise<LocalServerUpdateResult>(resolve => {
      timer = setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // 忽略
        }
        resolve(offlineResult);
      }, timeoutMs);
    });

    const requestPromise = (async (): Promise<LocalServerUpdateResult> => {
      const resp = await fetchFn(`${baseUrl}/api/local-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmBackupCompleted: options?.confirmBackupCompleted ?? true,
          allowDirty: Boolean(options?.allowDirty),
        }),
        cache: 'no-store',
        signal: controller.signal,
      });

      const data = (await resp.json().catch(() => null)) as Partial<LocalServerUpdateResult> | null;
      if (data && typeof data === 'object' && typeof data.status === 'string') {
        return {
          ok: Boolean(data.ok),
          status: data.status,
          message:
            typeof data.message === 'string'
              ? data.message
              : data.ok
                ? '本地服务已完成更新与重编译'
                : '本地受控更新未完成',
          previousVersion: typeof data.previousVersion === 'string' ? data.previousVersion : '',
          currentVersion: typeof data.currentVersion === 'string' ? data.currentVersion : '',
          distReady: data.distReady,
          updatedAt: data.updatedAt,
          steps: Array.isArray(data.steps) ? data.steps : undefined,
        };
      }
      if (!resp.ok) {
        return offlineResult;
      }
      return {
        ok: true,
        status: 'updated',
        message: '本地服务已完成更新与重编译',
        previousVersion: '',
        currentVersion: '',
      };
    })();

    return await Promise.race([requestPromise, timeoutPromise]);
  } catch {
    return offlineResult;
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

/* ═══════════════════════ 8. 启动期只检不更工作流与 FD-47 兼容桥接函数 ═══════════════════════ */

export type StartupUpdateAction =
  | 'skipped-disabled'
  | 'up-to-date'
  | 'notify-normal-update'
  | 'prompt-breaking-backup'
  | 'dismissed-breaking'
  | 'error';

export interface StartupUpdateFlowOptions {
  config?: Partial<CardUpdateConfig>;
  manifestUrl?: string;
  localServerUrl?: string;
  localVersion?: string;
  localSaveSchema?: number;
  chatSaveSchema?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  storage?: Storage | null;
}

export interface StartupUpdateFlowResult {
  action: StartupUpdateAction;
  checkResult: UpdateCheckResult | null;
  result?: UpdateCheckResult | null;
  config: CardUpdateConfig;
  error?: string;
}

/**
 * 启动期版本检测流程（FD-48 铁律：100% 只检不更，绝不自动执行覆盖写卡！）：
 * - 即使 `config.autoUpdateSilent` 为 `true`，也绝不调用 `performSafeCardUpdate` / `safeImportUpdatedCharacterCard`；
 * - 即使 `config.manifestUrl` 为空，只要 `config.checkOnStartup !== false`，也会通过 `checkCardUpdateViaLocalOrRemote` 尝试从本地 `:5500` 获取版本状态；
 * - 发现破坏性存档变动（且未被 `dismissedBreakingVersion` 忽略）时返回 `action: 'prompt-breaking-backup'`；
 * - 发现普通新版本时一律返回 `action: 'notify-normal-update'`。
 */
export async function runStartupUpdateFlow(
  options?: StartupUpdateFlowOptions,
): Promise<StartupUpdateFlowResult> {
  const baseConfig = getCardUpdatePreferences(options?.storage);
  const config: CardUpdateConfig = {
    ...baseConfig,
    ...(options?.config ?? {}),
  };
  if (typeof options?.manifestUrl === 'string') {
    config.manifestUrl = options.manifestUrl.trim();
  }
  if (typeof options?.localServerUrl === 'string') {
    config.localServerUrl = options.localServerUrl.trim();
  }

  if (config.checkOnStartup === false) {
    return {
      action: 'skipped-disabled',
      checkResult: null,
      result: null,
      config,
    };
  }

  const hasDirectManifestMock =
    Boolean((options?.manifestUrl || options?.config?.manifestUrl)?.trim()) &&
    Boolean(options?.fetchImpl) &&
    !options?.localServerUrl &&
    !options?.config?.localServerUrl;

  let check: UpdateCheckResult | null = null;
  if (hasDirectManifestMock) {
    check = await checkCardUpdate({
      manifestUrl: config.manifestUrl,
      localVersion: options?.localVersion,
      localSaveSchema: options?.localSaveSchema,
      chatSaveSchema: options?.chatSaveSchema,
      fetchImpl: options?.fetchImpl,
      timeoutMs: options?.timeoutMs,
      triggerAutoUpdateIfSafe: false,
    });
  } else {
    check = await checkCardUpdateViaLocalOrRemote({
      manifestUrl: config.manifestUrl,
      localServerUrl: config.localServerUrl,
      localVersion: options?.localVersion,
      localSaveSchema: options?.localSaveSchema,
      chatSaveSchema: options?.chatSaveSchema,
      fetchImpl: options?.fetchImpl,
      timeoutMs: options?.timeoutMs,
      triggerAutoUpdateIfSafe: false,
    });
  }

  if (!check || check.status === 'error') {
    cardUpdateState.shouldPromptModal = false;
    return {
      action: 'error',
      checkResult: check,
      result: check,
      config,
      error: check?.error || cardUpdateState.lastError || '版本检测失败',
    };
  }

  if (check.hasUpdate && check.hasBreakingSaveChange) {
    const dismissedVer = config.dismissedBreakingVersion || config.ignoredVersion || '';
    if (
      dismissedVer &&
      normalizeVersion(dismissedVer) === normalizeVersion(check.latestVersion)
    ) {
      cardUpdateState.shouldPromptModal = false;
      return {
        action: 'dismissed-breaking',
        checkResult: check,
        result: check,
        config,
      };
    }
    cardUpdateState.shouldPromptModal = true;
    return {
      action: 'prompt-breaking-backup',
      checkResult: check,
      result: check,
      config,
    };
  }

  if (check.hasUpdate && !check.hasBreakingSaveChange) {
    cardUpdateState.shouldPromptModal = false;
    return {
      action: 'notify-normal-update',
      checkResult: check,
      result: check,
      config,
    };
  }

  cardUpdateState.shouldPromptModal = false;
  return {
    action: 'up-to-date',
    checkResult: check,
    result: check,
    config,
  };
}

export const getCurrentCardVersion = getLocalCardVersion;
export const resolveCurrentCharacterAvatar = resolveCurrentAvatarFile;
export const safeImportUpdatedCharacterCard = performSafeCardUpdate;

/**
 * 从 PNG 二进制 Buffer 中直接提取内嵌的角色卡对象与版本号（兼容辅助函数）。
 */
export function extractCardDataFromPngBuffer(
  buffer: ArrayBuffer | Uint8Array,
): { card: Record<string, unknown> | null; version: string | null } {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const card = extractCardObjectFromPngBytes(bytes);
  const version = extractVersionFromCardObject(card);
  return { card, version };
}

/**
 * 核验下载到的角色卡 PNG（或 Blob/Buffer）内嵌版本号是否与期望版本号一致（防 CDN 缓存撕裂）。
 */
export async function verifyDownloadedCardPngVersion(
  blobOrBuffer: Blob | ArrayBuffer | Uint8Array,
  expectedVersion: string,
): Promise<{ ok: boolean; actualVersion: string | null; expectedVersion: string; error?: string }> {
  const normExpected = normalizeVersion(expectedVersion) || expectedVersion.trim();
  let actualVersion: string | null = null;

  if (blobOrBuffer instanceof Uint8Array || blobOrBuffer instanceof ArrayBuffer) {
    actualVersion = extractCardDataFromPngBuffer(blobOrBuffer).version;
  } else {
    actualVersion = await extractVersionFromCardBlob(blobOrBuffer);
  }

  if (
    actualVersion !== null &&
    normalizeVersion(actualVersion) !== normExpected
  ) {
    return {
      ok: false,
      actualVersion,
      expectedVersion: normExpected,
      error: `远端节点缓存尚未同步（下载卡片内嵌版本为 v${normalizeVersion(actualVersion)}，目标版本为 v${normExpected}）`,
    };
  }

  return {
    ok: true,
    actualVersion,
    expectedVersion: normExpected,
  };
}
