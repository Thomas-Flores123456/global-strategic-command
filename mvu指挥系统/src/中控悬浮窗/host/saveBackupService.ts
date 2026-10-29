/**
 * saveBackupService.ts —— FD-47 战局全保真备份下载、世界书克隆与原位恢复共享服务
 *
 * 核心职责：
 * 1. 提炼并统一 `PanelExportSave.vue` 的 `resolveLatestExportFloor` 回溯逻辑，从 `getLastMessageId`
 *    向前扫描最近一层非 `user`、非 `is_hidden` 且含有效 `stat_data` 的 AI 楼层（根治 TRAP-04）；
 * 2. 组装带 `save_schema` 与 `card_meta` 的 `SavePackV2WithSchema` 全保真快照；
 * 3. 提供安全 `.json` 本地文件下载（根治 TRAP-05：延迟 10 秒执行 `URL.revokeObjectURL`）；
 * 4. 提供酒馆内绑定世界书（`primary` 主世界书 + `chat` 聊天档案书）一键克隆备份；
 * 5. 提供当前聊天原位恢复 `restoreSavePackInPlace`（写回最新有效楼层 `stat_data`、重锚定 `$timeline.originChatId`、
 *    写入 `$save_schema` 并恢复聊天世界书词条）。
 */

import {
  parseSavePack,
  type SavePack,
  type SavePackWorldbookEntry,
} from '../../开场启动器/importSave';
import { readCurrentHostChatId } from '../../红警指挥系统/core/timelineLedger';
import { migrateV1toV2, Schema } from '../../红警指挥系统/core/schema';
import { tav } from '../../红警指挥系统/parse/systemCheck';
import { getHostWindow } from './modalHost';

export const CURRENT_SAVE_SCHEMA = 2 as const;

export interface SavePackV2WithSchema extends SavePack {
  version: 2;
  kind: 'redalert-save';
  save_schema: number;
  card_meta?: {
    name: string;
    version: string;
    avatar?: string;
  };
}

export interface BuildSavePackResult {
  ok: boolean;
  error?: string;
  pack?: SavePackV2WithSchema;
  jsonText?: string;
  floorId?: number;
  charName?: string;
  cardVersion?: string;
}

export interface BackupExecutionOptions {
  downloadFile?: boolean;
  copyToClipboard?: boolean;
  cloneWorldbooks?: boolean;
  versionTag?: string;
  customPrefix?: string;
}

export interface BackupExecutionResult {
  ok: boolean;
  error?: string;
  pack?: SavePackV2WithSchema;
  jsonText?: string;
  fileName?: string;
  fileDownloaded: boolean;
  clipboardCopied: boolean;
  clonedWorldbooks: string[];
  floorId: number | null;
}

export interface RestoreInPlaceResult {
  ok: boolean;
  error?: string;
  restoredFloorId?: number;
  restoredWorldbookEntriesCount?: number;
  saveSchema?: number;
  warnings: string[];
}

type ChatMsgLite = { role?: string; is_hidden?: boolean };
type GetVariablesFn = (o: { type: string; message_id?: number }) => Record<string, unknown> | undefined;

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasEffectiveStatData(statData: unknown): boolean {
  if (!isPlainRecord(statData)) return false;
  return Object.keys(statData).length > 0;
}

function safeClone<T>(val: T): T {
  if (val === undefined || val === null || typeof val !== 'object') return val;
  try {
    return JSON.parse(JSON.stringify(val)) as T;
  } catch {
    return val;
  }
}

/**
 * 从 `PanelExportSave.vue` 提炼：
 * 优先从 `getLastMessageId` 向前扫描非 `user`、非 `is_hidden` 且含有效 `stat_data` 的最新 AI 楼层；
 * 若无 `getLastMessageId` 则在 try/catch 保护下回退探测 `getCurrentMessageId`（严禁对全局脚本 iframe 裸调抛未捕获异常）。
 */
export function resolveLatestExportFloor(
  gv?: GetVariablesFn,
): { mid: number | null; statData: unknown } {
  const getVars = gv ?? tav<GetVariablesFn>('getVariables');
  if (!getVars) {
    return { mid: null, statData: undefined };
  }

  const glmi = tav<() => number>('getLastMessageId');
  const gcm = tav<(id: number) => ChatMsgLite[]>('getChatMessages');
  if (glmi) {
    let lastId: number | undefined;
    try {
      lastId = glmi();
    } catch {
      lastId = undefined;
    }
    if (typeof lastId === 'number' && lastId >= 0) {
      let fallbackMid: number | null = null;
      for (let id = lastId; id >= 0; id--) {
        if (gcm) {
          try {
            const m = gcm(id)?.[0];
            if (m && (m.role === 'user' || m.is_hidden)) continue;
          } catch {
            /* ignore single floor message lookup error */
          }
        }
        if (fallbackMid === null) fallbackMid = id;
        let vars: Record<string, unknown> | undefined;
        try {
          vars = getVars({ type: 'message', message_id: id });
        } catch {
          vars = undefined;
        }
        const statData = (vars ?? {})['stat_data'];
        if (hasEffectiveStatData(statData)) {
          return { mid: id, statData };
        }
      }
      return { mid: fallbackMid ?? lastId, statData: undefined };
    }
    return { mid: null, statData: undefined };
  }

  const gcmi = tav<() => number>('getCurrentMessageId');
  if (gcmi) {
    try {
      const mid = gcmi();
      if (typeof mid === 'number' && mid >= 0) {
        const statData = (getVars({ type: 'message', message_id: mid }) ?? {})['stat_data'];
        return {
          mid,
          statData: hasEffectiveStatData(statData) ? statData : undefined,
        };
      }
    } catch {
      return { mid: null, statData: undefined };
    }
  }
  return { mid: null, statData: undefined };
}

/**
 * 读取当前聊天存档结构代数（`$save_schema`）：
 * - 若 `chatVars.$save_schema` 为有效正整数则直接返回；
 * - 否则若当前聊天已有有效 `stat_data`（或为空聊天），返回 `CURRENT_SAVE_SCHEMA`（2）。
 */
export function readCurrentChatSaveSchema(): number {
  const gv = tav<GetVariablesFn>('getVariables');
  if (!gv) return CURRENT_SAVE_SCHEMA;
  try {
    const chatVars = (gv({ type: 'chat' }) ?? {}) as Record<string, unknown>;
    const raw = chatVars.$save_schema;
    if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  const { statData } = resolveLatestExportFloor(gv);
  if (hasEffectiveStatData(statData)) {
    return CURRENT_SAVE_SCHEMA;
  }
  return CURRENT_SAVE_SCHEMA;
}

/**
 * 将 `$save_schema` 写入当前聊天域变量 `{ type: 'chat' }`
 */
export function writeCurrentChatSaveSchema(schemaVersion: number = CURRENT_SAVE_SCHEMA): void {
  const safeSchema =
    typeof schemaVersion === 'number' && Number.isInteger(schemaVersion) && schemaVersion > 0
      ? schemaVersion
      : CURRENT_SAVE_SCHEMA;

  const uv = tav<
    (fn: (v: Record<string, unknown>) => Record<string, unknown>, o: { type: string }) => unknown
  >('updateVariablesWith');
  if (uv) {
    try {
      uv(
        vars => {
          const next = isPlainRecord(vars) ? { ...vars } : {};
          next.$save_schema = safeSchema;
          return next;
        },
        { type: 'chat' },
      );
      return;
    } catch {
      /* fallback to insertOrAssignVariables */
    }
  }

  const ia = tav<(v: Record<string, unknown>, o: { type: string }) => unknown>(
    'insertOrAssignVariables',
  );
  if (ia) {
    try {
      ia({ $save_schema: safeSchema }, { type: 'chat' });
    } catch {
      /* ignore */
    }
  }
}

interface ResolvedCardMeta {
  name: string;
  version: string;
  avatar?: string;
}

async function resolveCurrentCardMeta(): Promise<ResolvedCardMeta> {
  let name = '';
  let version = '';
  let avatar = '';

  // 1. 优先从 SillyTavern.characters[characterId] 获取真实角色项
  try {
    const hostWin = getHostWindow() as unknown as Record<string, unknown> | null;
    const st =
      ((globalThis as Record<string, unknown>).SillyTavern as Record<string, unknown> | undefined) ??
      (hostWin?.SillyTavern as Record<string, unknown> | undefined);
    if (st) {
      const chars = Array.isArray(st.characters) ? st.characters : [];
      const charId = Number(st.characterId);
      const currentChar =
        Number.isInteger(charId) && charId >= 0 && charId < chars.length
          ? (chars[charId] as Record<string, unknown> | undefined)
          : undefined;
      if (currentChar && isPlainRecord(currentChar)) {
        if (typeof currentChar.name === 'string' && currentChar.name.trim()) {
          name = currentChar.name.trim();
        }
        if (typeof currentChar.avatar === 'string' && currentChar.avatar.trim()) {
          avatar = currentChar.avatar.trim();
        }
        const dataObj = isPlainRecord(currentChar.data) ? currentChar.data : undefined;
        const verCandidate =
          (typeof dataObj?.character_version === 'string' && dataObj.character_version.trim()) ||
          (typeof currentChar.character_version === 'string' && currentChar.character_version.trim()) ||
          (typeof currentChar.version === 'string' && currentChar.version.trim()) ||
          '';
        if (verCandidate) {
          version = verCandidate;
        }
      }
      if (!name && typeof st.name2 === 'string' && st.name2.trim()) {
        name = st.name2.trim();
      }
    }
  } catch {
    /* ignore */
  }

  // 2. 通过 getCharacter('current') 补充探测
  const getCharacter = tav<(target?: string) => unknown>('getCharacter');
  if (getCharacter && (!name || !version || !avatar)) {
    try {
      const charRes = await Promise.resolve(getCharacter('current'));
      if (isPlainRecord(charRes)) {
        if (!name && typeof charRes.name === 'string' && charRes.name.trim()) {
          name = charRes.name.trim();
        }
        if (!avatar && typeof charRes.avatar === 'string' && charRes.avatar.trim()) {
          avatar = charRes.avatar.trim();
        }
        const dataObj = isPlainRecord(charRes.data) ? charRes.data : undefined;
        const verCandidate =
          (typeof charRes.version === 'string' && charRes.version.trim()) ||
          (typeof dataObj?.character_version === 'string' && dataObj.character_version.trim()) ||
          (typeof charRes.character_version === 'string' && charRes.character_version.trim()) ||
          '';
        if (!version && verCandidate) {
          version = verCandidate;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 3. 通过 getCurrentCharacterName 补充名称
  if (!name) {
    const getCharName = tav<() => string>('getCurrentCharacterName');
    if (getCharName) {
      try {
        const n = getCharName();
        if (typeof n === 'string' && n.trim()) {
          name = n.trim();
        }
      } catch {
        /* ignore */
      }
    }
  }

  return {
    name: name || '红警指挥系统',
    version: version || '1.0.0',
    ...(avatar ? { avatar } : {}),
  };
}

/**
 * 构建当前最新有效 AI 楼层的全保真 SavePack V2 快照（含 `save_schema` 与 `card_meta`）
 */
export async function buildCurrentSavePack(): Promise<BuildSavePackResult> {
  try {
    const gv = tav<GetVariablesFn>('getVariables');
    const hasFloorApi = Boolean(tav('getLastMessageId') || tav('getCurrentMessageId'));
    if (!gv || !hasFloorApi) {
      return {
        ok: false,
        error: '仅酒馆内可导出（变量 API 不可用）',
      };
    }

    const { mid, statData } = resolveLatestExportFloor(gv);
    if (mid === null || statData === undefined) {
      return {
        ok: false,
        error: '当前楼层无有效战况数据（本楼无变量数据）',
      };
    }

    const getChatName = tav<() => string>('getCurrentChatName');
    let chatName = '';
    if (getChatName) {
      try {
        chatName = getChatName() || '';
      } catch {
        chatName = '';
      }
    }
    if (!chatName) {
      chatName = readCurrentHostChatId();
    }

    const chatVars = (gv({ type: 'chat' }) ?? {}) as Record<string, unknown>;
    const parseState = isPlainRecord(chatVars.$parse)
      ? safeClone(chatVars.$parse)
      : undefined;
    const dlcRegistry = Array.isArray(chatVars.$dlc)
      ? safeClone(chatVars.$dlc as unknown[])
      : undefined;
    const timelineLedger = isPlainRecord(chatVars.$timeline)
      ? safeClone(chatVars.$timeline)
      : undefined;

    let chatWorldbookEntries: SavePackWorldbookEntry[] | undefined;
    try {
      const getChatWbName = tav<(target?: string) => string | null>('getChatWorldbookName');
      const getWb = tav<(name: string) => Promise<Record<string, unknown>[]>>('getWorldbook');
      const boundBook = getChatWbName ? (getChatWbName('current') ?? '').trim() : '';
      if (boundBook && getWb) {
        const rawEntries = await getWb(boundBook);
        if (Array.isArray(rawEntries)) {
          chatWorldbookEntries = rawEntries
            .filter(e => e && typeof e === 'object' && typeof e.name === 'string')
            .map((e): SavePackWorldbookEntry => {
              const strategy = e.strategy as { keys?: unknown[] } | undefined;
              const rawKeys = Array.isArray(e.keys)
                ? e.keys
                : Array.isArray(strategy?.keys)
                  ? strategy.keys
                  : undefined;
              return {
                name: String(e.name),
                content: typeof e.content === 'string' ? e.content : '',
                ...(typeof e.enabled === 'boolean' ? { enabled: e.enabled } : {}),
                ...(typeof e.comment === 'string' && e.comment ? { comment: e.comment } : {}),
                ...(rawKeys ? { keys: rawKeys.map(k => String(k)) } : {}),
                ...(isPlainRecord(e.position) ? { position: safeClone(e.position) } : {}),
                ...(isPlainRecord(e.strategy) ? { strategy: safeClone(e.strategy) } : {}),
                ...(isPlainRecord(e.recursion) ? { recursion: safeClone(e.recursion) } : {}),
                ...(isPlainRecord(e.extra) ? { extra: safeClone(e.extra) } : {}),
              };
            });
        }
      }
    } catch {
      /* 异步读取世界书失败时省略 chat_worldbook_entries，不阻断导出 */
    }

    const cardMeta = await resolveCurrentCardMeta();

    const pack: SavePackV2WithSchema = {
      version: 2,
      kind: 'redalert-save',
      exportedAt: new Date().toISOString(),
      source: {
        chat: chatName,
        message_id: mid,
      },
      stat_data: safeClone(statData) as Schema,
      save_schema: CURRENT_SAVE_SCHEMA,
      card_meta: cardMeta,
      ...(parseState !== undefined ? { parse_state: parseState } : {}),
      ...(dlcRegistry !== undefined ? { dlc_registry: dlcRegistry } : {}),
      ...(timelineLedger !== undefined ? { timeline_ledger: timelineLedger } : {}),
      ...(chatWorldbookEntries !== undefined ? { chat_worldbook_entries: chatWorldbookEntries } : {}),
    };

    const jsonText = JSON.stringify(pack);
    return {
      ok: true,
      pack,
      jsonText,
      floorId: mid,
      charName: cardMeta.name,
      cardVersion: cardMeta.version,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const buildFullSavePack = buildCurrentSavePack;

function sanitizeFileSegment(raw: string | undefined | null, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function formatBackupTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

export interface DownloadSavePackOptions {
  customPrefix?: string;
  versionTag?: string;
  charName?: string;
  chatName?: string;
  floorId?: number;
}

/**
 * 触发本地 `.json` 备份文件安全下载：
 * - 文件名格式：`红警战局备份_${safeCharName}_${safeChatName}_v${safeVer}_楼${floorId}_${timestamp}.json`
 * - 根治 TRAP-05：使用 `setTimeout(() => URL.revokeObjectURL(url), 10_000)` 延迟 10 秒释放 Blob URL
 */
export function downloadSavePackAsFile(
  packOrJson: SavePack | SavePackV2WithSchema | string,
  options?: DownloadSavePackOptions,
): { ok: boolean; fileName: string; error?: string } {
  let packObj: Partial<SavePackV2WithSchema> | null = null;
  let jsonText = '';

  if (typeof packOrJson === 'string') {
    jsonText = packOrJson;
    try {
      const parsed = JSON.parse(packOrJson);
      if (isPlainRecord(parsed)) {
        packObj = parsed as Partial<SavePackV2WithSchema>;
      }
    } catch {
      packObj = null;
    }
  } else if (isPlainRecord(packOrJson)) {
    packObj = packOrJson as Partial<SavePackV2WithSchema>;
    jsonText = JSON.stringify(packOrJson, null, 2);
  } else {
    return { ok: false, fileName: '', error: '无效的存档备份内容' };
  }

  const getCharName = tav<() => string>('getCurrentCharacterName');
  const getChatName = tav<() => string>('getCurrentChatName');

  const rawPrefix = options?.customPrefix || '红警战局备份';
  const rawCharName =
    options?.charName ||
    packObj?.card_meta?.name ||
    (getCharName ? getCharName() : '') ||
    '红警指挥系统';
  const rawChatName =
    options?.chatName ||
    packObj?.source?.chat ||
    (getChatName ? getChatName() : '') ||
    readCurrentHostChatId() ||
    '当前战局';
  const rawVer = (options?.versionTag || packObj?.card_meta?.version || '2.0').replace(/^[vV]+/, '');
  const rawFloor =
    typeof options?.floorId === 'number' && options.floorId >= 0
      ? options.floorId
      : typeof packObj?.source?.message_id === 'number' && packObj.source.message_id >= 0
        ? packObj.source.message_id
        : 0;

  const prefix = sanitizeFileSegment(rawPrefix, '红警战局备份');
  const safeCharName = sanitizeFileSegment(rawCharName, '红警指挥系统');
  const safeChatName = sanitizeFileSegment(rawChatName, '当前战局');
  const safeVer = sanitizeFileSegment(rawVer, '2.0');
  const timestamp = formatBackupTimestamp(new Date());
  const fileName = `${prefix}_${safeCharName}_${safeChatName}_v${safeVer}_楼${rawFloor}_${timestamp}.json`;

  try {
    const targetDoc =
      getHostWindow()?.document ?? (typeof document !== 'undefined' ? document : null);
    if (!targetDoc || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return { ok: false, fileName, error: '当前运行环境不支持触发浏览器文件下载' };
    }

    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = targetDoc.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    if (targetDoc.body) {
      targetDoc.body.appendChild(a);
    }
    a.click();
    if (a.parentNode) {
      a.parentNode.removeChild(a);
    }

    // TRAP-05 防护：严禁同步立即调用 revokeObjectURL，必须延迟 10 秒释放
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }, 10_000);

    return { ok: true, fileName };
  } catch (e) {
    return {
      ok: false,
      fileName,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface BackupWorldbooksResult {
  ok: boolean;
  clonedWorldbooks: string[];
  errors: string[];
}

/**
 * 克隆当前角色绑定主世界书（`primary`）与当前聊天绑定世界书（`chat`）生成独立备份副本
 */
export async function backupBoundWorldbooks(versionTag?: string): Promise<BackupWorldbooksResult> {
  const clonedWorldbooks: string[] = [];
  const errors: string[] = [];

  const getCharWbNames = tav<
    (target?: string) => { primary?: string | null; additional?: string[] } | null | undefined
  >('getCharWorldbookNames');
  const getChatWbName = tav<(target?: string) => string | null | undefined>('getChatWorldbookName');
  const getWb = tav<(name: string) => Promise<Record<string, unknown>[]> | Record<string, unknown>[]>(
    'getWorldbook',
  );
  const createOrReplaceWb = tav<
    (name: string, entries: Record<string, unknown>[]) => Promise<unknown> | unknown
  >('createOrReplaceWorldbook');
  const replaceWb = tav<
    (name: string, entries: Record<string, unknown>[]) => Promise<unknown> | unknown
  >('replaceWorldbook');
  const createWb = tav<
    (name: string, entries: Record<string, unknown>[]) => Promise<unknown> | unknown
  >('createWorldbook');

  const writeBackupBook = createOrReplaceWb ?? replaceWb ?? createWb;
  if (!getWb || !writeBackupBook) {
    return {
      ok: false,
      clonedWorldbooks: [],
      errors: ['酒馆世界书读写接口不可用'],
    };
  }

  let resolvedTag = (versionTag ?? '').trim();
  if (!resolvedTag) {
    const meta = await resolveCurrentCardMeta();
    resolvedTag = meta.version;
  }
  const cleanTag = sanitizeFileSegment(resolvedTag.replace(/^[vV]+/, ''), '2.0');

  const targetBooks: string[] = [];
  try {
    const charWbs = getCharWbNames?.('current');
    const primary = typeof charWbs?.primary === 'string' ? charWbs.primary.trim() : '';
    if (primary) targetBooks.push(primary);
  } catch (e) {
    errors.push(`读取角色主世界书失败：${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const chatWb = typeof getChatWbName?.('current') === 'string' ? getChatWbName('current')!.trim() : '';
    if (chatWb && !targetBooks.includes(chatWb)) {
      targetBooks.push(chatWb);
    }
  } catch (e) {
    errors.push(`读取聊天世界书失败：${e instanceof Error ? e.message : String(e)}`);
  }

  for (const bookName of targetBooks) {
    try {
      const entries = await Promise.resolve(getWb(bookName));
      const safeEntries = Array.isArray(entries) ? safeClone(entries) : [];
      const backupName = `${bookName}_v${cleanTag}备份`;
      await Promise.resolve(writeBackupBook(backupName, safeEntries));
      clonedWorldbooks.push(backupName);
    } catch (e) {
      errors.push(`克隆世界书「${bookName}」失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    ok: errors.length === 0,
    clonedWorldbooks,
    errors,
  };
}

/**
 * 一键执行完整战局备份：
 * `buildCurrentSavePack()` → 下载 `.json` 文件 → 复制到剪贴板 → 克隆绑定世界书
 */
export async function executeOneClickBackup(
  options?: BackupExecutionOptions,
): Promise<BackupExecutionResult> {
  const buildRes = await buildCurrentSavePack();
  if (!buildRes.ok || !buildRes.pack || !buildRes.jsonText) {
    return {
      ok: false,
      error: buildRes.error || '构建战局存档快照失败',
      fileDownloaded: false,
      clipboardCopied: false,
      clonedWorldbooks: [],
      floorId: null,
    };
  }

  const shouldDownload = options?.downloadFile ?? true;
  const shouldCopy = options?.copyToClipboard ?? true;
  const shouldCloneWb = options?.cloneWorldbooks ?? true;
  const versionTag = options?.versionTag || buildRes.cardVersion || '2.0';

  let fileDownloaded = false;
  let fileName: string | undefined;
  if (shouldDownload) {
    const dlRes = downloadSavePackAsFile(buildRes.pack, {
      customPrefix: options?.customPrefix,
      versionTag,
      charName: buildRes.charName,
      floorId: buildRes.floorId,
    });
    fileDownloaded = dlRes.ok;
    if (dlRes.fileName) fileName = dlRes.fileName;
  }

  let clipboardCopied = false;
  if (shouldCopy) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(buildRes.jsonText);
        clipboardCopied = true;
      }
    } catch {
      clipboardCopied = false;
    }
  }

  let clonedWorldbooks: string[] = [];
  if (shouldCloneWb) {
    const wbRes = await backupBoundWorldbooks(versionTag);
    clonedWorldbooks = wbRes.clonedWorldbooks;
  }

  writeCurrentChatSaveSchema(buildRes.pack.save_schema);

  return {
    ok: true,
    pack: buildRes.pack,
    jsonText: buildRes.jsonText,
    fileName,
    fileDownloaded,
    clipboardCopied,
    clonedWorldbooks,
    floorId: buildRes.floorId ?? null,
  };
}

/**
 * 在当前聊天原位恢复 `SavePack`（支持传入原始 JSON 字符串或已解析的 `SavePack` 对象）：
 * 1. 校验并归一化 `stat_data`；
 * 2. 定位当前聊天目标写入楼层（优先 `resolveLatestExportFloor` 找到的 `mid`，若仅 `#0` 楼则写 `#0` 楼）；
 * 3. 将 `stat_data` 写入目标楼层 message 变量；
 * 4. 恢复 `chat` 域变量（`$parse`、`$dlc`、重锚定 `originChatId` 后的 `$timeline` 以及 `$save_schema`）；
 * 5. 若 `chat_worldbook_entries` 非空，恢复至当前聊天绑定世界书。
 */
export async function restoreSavePackInPlace(
  rawJsonOrPack: string | SavePack,
): Promise<RestoreInPlaceResult> {
  const warnings: string[] = [];
  let pack: SavePack;

  if (typeof rawJsonOrPack === 'string') {
    const parsed = parseSavePack(rawJsonOrPack);
    if (!parsed.ok) {
      return {
        ok: false,
        error: parsed.error,
        warnings,
      };
    }
    pack = parsed.pack;
  } else if (isPlainRecord(rawJsonOrPack) && rawJsonOrPack.kind === 'redalert-save') {
    try {
      const migrated = migrateV1toV2(rawJsonOrPack.stat_data);
      const stat = Schema.parse(migrated);
      pack = {
        ...rawJsonOrPack,
        stat_data: stat,
        save_schema:
          typeof rawJsonOrPack.save_schema === 'number' &&
          Number.isInteger(rawJsonOrPack.save_schema) &&
          rawJsonOrPack.save_schema > 0
            ? rawJsonOrPack.save_schema
            : rawJsonOrPack.version === 2
              ? 2
              : 1,
      };
      if (migrated !== rawJsonOrPack.stat_data) {
        warnings.push('旧版 v1 存档已自动迁移至 v2 结构');
      }
    } catch (e) {
      return {
        ok: false,
        error: `存档核心数据校验失败：${e instanceof Error ? e.message : String(e)}`,
        warnings,
      };
    }
  } else {
    return {
      ok: false,
      error: '无效的红警战局备份包格式',
      warnings,
    };
  }

  if (pack.migratedFromV1 && !warnings.some(w => w.includes('v1'))) {
    warnings.push('旧版 v1 存档已自动迁移至 v2 结构');
  }

  const gv = tav<GetVariablesFn>('getVariables');
  const uv = tav<
    (
      fn: (v: Record<string, unknown>) => Record<string, unknown>,
      o: { type: string; message_id?: number },
    ) => Promise<unknown> | unknown
  >('updateVariablesWith');
  const ia = tav<
    (v: Record<string, unknown>, o: { type: string; message_id?: number }) => Promise<unknown> | unknown
  >('insertOrAssignVariables');
  const rv = tav<
    (v: Record<string, unknown>, o: { type: string; message_id?: number }) => Promise<unknown> | unknown
  >('replaceVariables');

  if (!uv && !ia && !rv) {
    return {
      ok: false,
      error: '当前运行环境不支持写入战局变量（仅酒馆内可执行原位恢复）',
      warnings,
    };
  }

  const { mid } = resolveLatestExportFloor(gv);
  let targetMid = mid;
  if (targetMid === null) {
    const glmi = tav<() => number>('getLastMessageId');
    if (glmi) {
      try {
        const lastId = glmi();
        if (typeof lastId === 'number' && lastId >= 0) {
          targetMid = lastId;
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (targetMid === null) {
    targetMid = 0;
  }

  const clonedStat = safeClone(pack.stat_data);
  const msgScope = { type: 'message', message_id: targetMid };

  try {
    let wroteMsg = false;
    if (uv) {
      try {
        await Promise.resolve(
          uv(
            vars => {
              const next = isPlainRecord(vars) ? { ...vars } : {};
              next.stat_data = clonedStat;
              return next;
            },
            msgScope,
          ),
        );
        wroteMsg = true;
      } catch {
        wroteMsg = false;
      }
    }
    if (!wroteMsg && ia) {
      try {
        await Promise.resolve(ia({ stat_data: clonedStat }, msgScope));
        wroteMsg = true;
      } catch {
        wroteMsg = false;
      }
    }
    if (!wroteMsg && rv) {
      const existing = (gv?.(msgScope) ?? {}) as Record<string, unknown>;
      await Promise.resolve(rv({ ...existing, stat_data: clonedStat }, msgScope));
      wroteMsg = true;
    }
    if (!wroteMsg) {
      return {
        ok: false,
        error: `无法向楼层 #${targetMid} 写入战局变量`,
        warnings,
      };
    }
  } catch (e) {
    return {
      ok: false,
      error: `写入楼层变量失败：${e instanceof Error ? e.message : String(e)}`,
      warnings,
    };
  }

  // 恢复聊天绑定世界书词条
  let restoredWorldbookEntriesCount = 0;
  let boundBookName = '';
  if (Array.isArray(pack.chat_worldbook_entries) && pack.chat_worldbook_entries.length > 0) {
    const getChatWbName = tav<(target?: string) => string | null | undefined>('getChatWorldbookName');
    const getOrCreateChatWb = tav<(target?: string, name?: string) => Promise<string> | string>(
      'getOrCreateChatWorldbook',
    );
    const replaceWb = tav<
      (name: string, entries: Record<string, unknown>[]) => Promise<unknown> | unknown
    >('replaceWorldbook');
    const createOrReplaceWb = tav<
      (name: string, entries: Record<string, unknown>[]) => Promise<unknown> | unknown
    >('createOrReplaceWorldbook');
    const updateWbWith = tav<
      (
        name: string,
        updater: (entries: Record<string, unknown>[]) => Record<string, unknown>[],
      ) => Promise<unknown> | unknown
    >('updateWorldbookWith');
    const createWb = tav<
      (name: string, entries: Record<string, unknown>[]) => Promise<unknown> | unknown
    >('createWorldbook');

    const entriesToWrite: Record<string, unknown>[] = pack.chat_worldbook_entries.map(e => ({
      name: e.name,
      content: e.content,
      enabled: e.enabled ?? true,
      ...(typeof e.comment === 'string' && e.comment ? { comment: e.comment } : {}),
      ...(Array.isArray(e.keys) ? { keys: [...e.keys] } : {}),
      ...(isPlainRecord(e.position) ? { position: safeClone(e.position) } : {}),
      ...(isPlainRecord(e.strategy) ? { strategy: safeClone(e.strategy) } : {}),
      ...(isPlainRecord(e.recursion) ? { recursion: safeClone(e.recursion) } : {}),
      ...(isPlainRecord(e.extra) ? { extra: safeClone(e.extra) } : {}),
    }));

    try {
      let targetBook = typeof getChatWbName?.('current') === 'string' ? getChatWbName('current')!.trim() : '';
      if (!targetBook && getOrCreateChatWb) {
        const created = await Promise.resolve(getOrCreateChatWb('current'));
        if (typeof created === 'string' && created.trim()) {
          targetBook = created.trim();
        }
      }
      if (targetBook) {
        if (replaceWb) {
          await Promise.resolve(replaceWb(targetBook, entriesToWrite));
          restoredWorldbookEntriesCount = entriesToWrite.length;
          boundBookName = targetBook;
        } else if (createOrReplaceWb) {
          await Promise.resolve(createOrReplaceWb(targetBook, entriesToWrite));
          restoredWorldbookEntriesCount = entriesToWrite.length;
          boundBookName = targetBook;
        } else if (updateWbWith) {
          await Promise.resolve(updateWbWith(targetBook, () => entriesToWrite));
          restoredWorldbookEntriesCount = entriesToWrite.length;
          boundBookName = targetBook;
        } else if (createWb) {
          await Promise.resolve(createWb(targetBook, entriesToWrite));
          restoredWorldbookEntriesCount = entriesToWrite.length;
          boundBookName = targetBook;
        } else {
          warnings.push('当前环境未提供世界书写入接口，聊天档案词条未能写回');
        }
      } else {
        warnings.push('未能获取或创建当前聊天专属世界书，聊天档案词条已跳过');
      }
    } catch (e) {
      warnings.push(`恢复聊天世界书词条时出现异常：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 恢复 chat 域变量（$parse、$dlc、重锚定 originChatId 后的 $timeline、以及 $save_schema）
  const getChatName = tav<() => string>('getCurrentChatName');
  let currentChatId = '';
  if (getChatName) {
    try {
      currentChatId = (getChatName() || '').trim();
    } catch {
      currentChatId = '';
    }
  }
  if (!currentChatId) {
    currentChatId = readCurrentHostChatId();
  }

  const resolvedSchema =
    typeof pack.save_schema === 'number' && Number.isInteger(pack.save_schema) && pack.save_schema > 0
      ? pack.save_schema
      : CURRENT_SAVE_SCHEMA;

  let reanchoredTimeline: Record<string, unknown> | undefined;
  if (isPlainRecord(pack.timeline_ledger)) {
    reanchoredTimeline = safeClone(pack.timeline_ledger);
    reanchoredTimeline.originChatId = currentChatId;
    if (boundBookName) {
      reanchoredTimeline.boundBookName = boundBookName;
    }
  }

  const chatPatch: Record<string, unknown> = {
    $save_schema: resolvedSchema,
    ...(isPlainRecord(pack.parse_state) ? { $parse: safeClone(pack.parse_state) } : {}),
    ...(Array.isArray(pack.dlc_registry) ? { $dlc: safeClone(pack.dlc_registry) } : {}),
    ...(reanchoredTimeline !== undefined ? { $timeline: reanchoredTimeline } : {}),
  };

  try {
    let wroteChat = false;
    if (uv) {
      try {
        await Promise.resolve(
          uv(
            vars => {
              const next = isPlainRecord(vars) ? { ...vars } : {};
              Object.assign(next, chatPatch);
              return next;
            },
            { type: 'chat' },
          ),
        );
        wroteChat = true;
      } catch {
        wroteChat = false;
      }
    }
    if (!wroteChat && ia) {
      try {
        await Promise.resolve(ia(chatPatch, { type: 'chat' }));
        wroteChat = true;
      } catch {
        wroteChat = false;
      }
    }
    if (!wroteChat && rv) {
      const existingChat = (gv?.({ type: 'chat' }) ?? {}) as Record<string, unknown>;
      await Promise.resolve(rv({ ...existingChat, ...chatPatch }, { type: 'chat' }));
    }
  } catch (e) {
    warnings.push(`恢复聊天扩展状态时出现异常：${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    ok: true,
    restoredFloorId: targetMid,
    restoredWorldbookEntriesCount,
    saveSchema: resolvedSchema,
    warnings,
  };
}
