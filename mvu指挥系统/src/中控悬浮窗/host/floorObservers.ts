/**
 * floorObservers.ts —— 楼层解析与悬浮窗刷新观察者（CTRL-FLOOR-SLIM-01 中控台侧接线）
 *
 * 职责：
 * 1. 唯一安装点：中控 index.ts init 时安装；pagehide 拆除；
 * 2. 事件接线：
 *    - GENERATION_ENDED / MESSAGE_SWIPED / MESSAGE_EDITED 串成「runParseFor → floating.refresh」（顺序固定）；
 *    - CHAT_CHANGED 和 init 时补解析最后一个 AI 楼（靠 hash 幂等）；
 * 3. 防重复：
 *    - 模块级 wired 标志守卫防重装；
 *    - inFlight 集合按 message_id 单飞；
 *    - EDITED 用 hash 判定、不传 force（force 仅留给手动重解析/重试）；
 *    - runParseFor 附带 expectChatId，写前复核聊天未切换，切了就 fail-closed。
 *
 * 注意：中控是全局脚本 iframe，禁止调用 getCurrentMessageId（Helper 会抛错）；
 * 取楼号统一用 getLastMessageId 往前找最新 AI 楼。
 */
import {
  ALLIED_WORLDBOOK_GROUP,
  allManagedEngineeringBooks,
  CORE_REQUIRED_WORLDBOOKS,
  ENGINEERING_COMMON_WORLDBOOK,
  ENGINEERING_WORLDBOOKS,
  ensureWorldbookSuffix,
  FACTION_ENGINEERING_WORLDBOOKS,
  FACTION_WORLDBOOK_GROUPS,
  getFactionWorldbookGroup,
  isEngineeringWorldbookName,
  LEGACY_DUPLICATE_WORLDBOOK_NAMES,
  MAIDEN_DOSSIER_WORLDBOOK,
  planFactionWorldbookSync,
  PROTOCOL_WORLDBOOK,
  SOVIET_WORLDBOOK_GROUP,
  stripWorldbookSuffix,
  YURI_WORLDBOOK_GROUP,
} from '../../开场启动器/worldbookManifest';
import { debugState } from '../../红警指挥系统/composables/useDebugMode';
import {
  ensureBranchWorldbookIsolation,
  reconcileSwipeWorldbookTransition,
  resolveChatArchiveBookFromLedger,
} from '../../红警指挥系统/worldbook/branchBookCloner';
import { normalizeFactionId } from '../../红警指挥系统/core/commandPresets';
import { in_tavern } from '../../红警指挥系统/composables/store';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import { ARCHIVE_BOOK, tav } from '../../红警指挥系统/parse/systemCheck';
import { nowPerfMs, recordPerfSample } from '../models/perfMonitor';
import {
  dismissChrono,
  ensureChatBookGatewayMethods,
  finalizeBranchWorldbookCloneIfNeeded,
  reconcileDeletedFloorsAbove,
  runParseFor,
  type RunOptions,
  type RunOutcome,
} from '../../红警指挥系统/composables/useParse';
import { readTimelineLedger } from '../../红警指挥系统/core/timelineLedger';
import type { SummaryDraft } from '../../红警指挥系统/core/schema';
import { chatBookGateway } from '../../红警指挥系统/worldbook/chatBookBinding';
import { recordFlightLog } from '../../红警指挥系统/debug/dataFlowTracer';
import {
  adoptSummary,
  getSummaryAutoConfirm,
  getSummaryBudgetConfig,
  getSummaryFloorHandling,
  getSummaryStrategy,
} from '../../红警指挥系统/worldbook/summaryFiler';
import { updateFloorVars } from './floorVarWrite';

type ChatMsgLite = {
  role?: string;
  is_hidden?: boolean;
  swipe_id?: number;
  data?: { stat_data?: Record<string, unknown> };
};

export interface MultiFactionWorldbookSyncDeps {
  getStatData?: () => Record<string, unknown> | null | undefined;
  getGlobalWorldbookNames?: () => Promise<string[]> | string[];
  getWorldbookNames?: () => Promise<string[]> | string[];
  rebindGlobalWorldbooks?: (names: string[]) => Promise<unknown> | unknown;
  getChatWorldbookName?: (target?: 'current' | string) => Promise<string | null> | string | null;
  rebindChatWorldbook?: (target: 'current' | string, bookName: string) => Promise<unknown> | unknown;
  getChatVars?: () => Promise<Record<string, unknown> | null | undefined> | Record<string, unknown> | null | undefined;
  chatArchiveBooks?: readonly string[];
  /** 工程与巨构世界书开关覆写（缺省取 debugState.enabled） */
  engineeringEnabled?: boolean;
  /** 可选宿主 updateWorldbookWith，用于在切换工程开关时同步更新世界书内巨构/工程协议条目的 enabled 状态 */
  updateWorldbookWith?: (
    name: string,
    updater: (entries: Array<Record<string, unknown>>) => Array<Record<string, unknown>>,
  ) => Promise<unknown> | unknown;
}

/**
 * 判定世界书条目是否属于「工程系统与仓段化巨构」受控条目：
 * 1. 包含 `<数据>..."type": "project"...</数据>` 的仓段化巨构条目；
 * 2. 《工程·通用》中的 `01·工程·通用总则`；
 * 3. 《全域战略指挥系统》中的 `25·工程指令响应协议（【工程指令】 · DIR-9/DIR-10）`。
 * 注意：绝不触碰 `⚠SVG资产·*·勿启用` 禁用资产条目或 `[已迁出...]` 墓碑条目。
 */
export function isMegastructureOrEngineeringGateEntry(entry: Record<string, unknown>): boolean {
  const title = String(entry.name ?? entry.comment ?? '').trim();
  const content = String(entry.content ?? '');
  if (title.startsWith('⚠SVG资产·') || title.startsWith('[已迁出') || content.startsWith('[条目已迁出]')) {
    return false;
  }
  if (title.includes('01·工程·通用总则') || title.includes('25·工程指令响应协议')) {
    return true;
  }
  if (/"type"\s*:\s*"project"/.test(content) && /<数据>[\s\S]*?<\/数据>/.test(content)) {
    return true;
  }
  return false;
}

/**
 * 在酒馆宿主中批量同步世界书内部的「巨构与工程协议条目」启用状态：
 * 当 engineeringEnabled=true 时开启（enabled=true, disable=false），
 * 当 engineeringEnabled=false 时关闭（enabled=false, disable=true）。
 */
export async function syncEngineeringWorldbookEntriesInHost(
  engineeringEnabled: boolean,
  deps?: Pick<MultiFactionWorldbookSyncDeps, 'getWorldbookNames' | 'updateWorldbookWith'>,
): Promise<string[]> {
  const updateWb =
    deps?.updateWorldbookWith ??
    tav<
      (
        name: string,
        updater: (entries: Array<Record<string, unknown>>) => Array<Record<string, unknown>>,
      ) => Promise<unknown>
    >('updateWorldbookWith');
  if (!updateWb) return [];

  const getAvailable =
    deps?.getWorldbookNames ?? tav<() => Promise<string[]> | string[]>('getWorldbookNames');
  const availableRaw = getAvailable ? await Promise.resolve(getAvailable()) : [];
  const available = new Set(Array.isArray(availableRaw) ? availableRaw : []);

  const candidateBareBooks = [
    ENGINEERING_COMMON_WORLDBOOK,
    '工程·苏联',
    '工程·尤里',
    '全域战略指挥系统',
    '异能穿越模拟器v1.0',
    '通用·航天工业',
  ];

  const updatedBooks: string[] = [];
  for (const bare of candidateBareBooks) {
    const suffixed = ensureWorldbookSuffix(bare);
    const targetName =
      available.size === 0
        ? bare
        : available.has(bare)
          ? bare
          : available.has(suffixed)
            ? suffixed
            : null;
    if (!targetName) continue;
    try {
      let touched = false;
      await Promise.resolve(
        updateWb(targetName, entries => {
          if (!Array.isArray(entries)) return entries;
          return entries.map(entry => {
            if (!entry || typeof entry !== 'object') return entry;
            if (!isMegastructureOrEngineeringGateEntry(entry)) return entry;
            const curEnabled = entry.enabled !== undefined ? Boolean(entry.enabled) : !entry.disable;
            if (curEnabled === engineeringEnabled) return entry;
            touched = true;
            return {
              ...entry,
              enabled: engineeringEnabled,
              disable: !engineeringEnabled,
            };
          });
        }),
      );
      if (touched) updatedBooks.push(targetName);
    } catch {
      /* 单本世界书不存在或未导入时静默跳过 */
    }
  }
  return updatedBooks;
}

/**
 * 从 stat_data 中提取已解锁阵营列表（CMD-UI-01）：
 * - 读取 `statData?.command?.unlocked_factions` 数组，用 `normalizeFactionId` 归一去重；
 * - 若为空或缺失则回退为 `['allied']`。
 */
export function extractUnlockedFactionsFromStatData(
  statData: Record<string, unknown> | null | undefined,
): string[] {
  const command = statData?.command as { unlocked_factions?: unknown } | undefined;
  const rawList = Array.isArray(command?.unlocked_factions)
    ? command.unlocked_factions
    : Array.isArray(statData?.unlocked_factions)
      ? statData.unlocked_factions
      : [];

  const normalized: string[] = [];
  for (const item of rawList) {
    if (typeof item !== 'string') continue;
    const id = normalizeFactionId(item);
    if (id && id !== 'common' && !normalized.includes(id)) {
      normalized.push(id);
    }
  }

  return normalized.length > 0 ? normalized : ['allied'];
}

function readLatestStatDataFromHost(): Record<string, unknown> | null {
  try {
    const mid = findLatestAiFloor();
    const gcm = tav<(id: number) => ChatMsgLite[]>('getChatMessages');
    if (mid !== null && gcm) {
      const msgs = gcm(mid);
      const sd = msgs?.[0]?.data?.stat_data;
      if (sd && typeof sd === 'object') return sd;
    }
    const getVars = tav<(opts?: Record<string, unknown>) => { stat_data?: Record<string, unknown> }>('getVariables');
    if (getVars) {
      const chatVars = getVars({ type: 'chat' });
      if (chatVars?.stat_data && typeof chatVars.stat_data === 'object') {
        return chatVars.stat_data;
      }
    }
  } catch {
    /* ignore host read error */
  }
  return null;
}

function readChatVarsFromHost(): Record<string, unknown> | null {
  try {
    const getVars = tav<(opts?: Record<string, unknown>) => Record<string, unknown>>('getVariables');
    if (getVars) {
      const chatVars = getVars({ type: 'chat' });
      if (chatVars && typeof chatVars === 'object' && !Array.isArray(chatVars)) {
        return chatVars;
      }
    }
  } catch {
    /* ignore host read error */
  }
  return null;
}

/**
 * 发现并自愈恢复当前聊天自己的世界书（主要是档案世界书）：
 * 1. 检查当前聊天原生绑定 `getChatWorldbookName('current')` 与聊天变量 `$timeline` 中的 `boundBookName` / `wbJournal[*].bookName`；
 * 2. 若原生绑定缺失（或指向不存在的孤儿书），而 `$timeline` 中记录的档案世界书在 `available` 中存在，
 *    自动调用 `rebindChatWorldbook('current', ledgerBook)` 恢复当前聊天的世界书绑定；
 * 3. 汇总当前聊天自己的全部世界书：
 *    - 当前聊天专属档案书（`红警档案·*`，含机娘档案、扩展档案、三层摘要）
 *    - 当前聊天 `$promoted` 注册表中已提升的独立档案世界书（`targetBook`）
 *    - 当前聊天 `$dlc` 注册表中已安装的 DLC 世界书（`books`）
 *    - 当前聊天 `$archive` 非空时的动态正史世界书（`EVA·动态档案`）
 */
export async function collectAndRestoreChatOwnWorldbooks(
  deps?: MultiFactionWorldbookSyncDeps,
  availableBooks?: readonly string[],
): Promise<{
  chatOwnBooks: string[];
  boundChatBook: string | null;
  reboundChatBook: boolean;
}> {
  const available = Array.isArray(availableBooks) ? availableBooks : [];
  const hasAvailableList = available.length > 0;
  const bookExistsInHost = (name: string) => !hasAvailableList || available.includes(name);

  if (Array.isArray(deps?.chatArchiveBooks)) {
    const explicit = [
      ...new Set(deps.chatArchiveBooks.map(b => (typeof b === 'string' ? b.trim() : '')).filter(Boolean)),
    ].filter(bookExistsInHost);
    return {
      chatOwnBooks: explicit,
      boundChatBook: explicit[0] ?? null,
      reboundChatBook: false,
    };
  }

  const getChatWb =
    deps?.getChatWorldbookName ?? tav<(target?: 'current' | string) => Promise<string | null> | string | null>('getChatWorldbookName');
  const rebindChatWb =
    deps?.rebindChatWorldbook ??
    tav<(target: 'current' | string, bookName: string) => Promise<unknown>>('rebindChatWorldbook');

  let currentBound = '';
  if (getChatWb) {
    try {
      const rawBound = await Promise.resolve(getChatWb('current'));
      if (typeof rawBound === 'string' && rawBound.trim()) {
        currentBound = rawBound.trim();
      }
    } catch {
      /* ignore */
    }
  }

  let chatVars: Record<string, unknown> | null | undefined = null;
  try {
    chatVars = deps?.getChatVars ? await Promise.resolve(deps.getChatVars()) : readChatVarsFromHost();
  } catch {
    chatVars = null;
  }

  const rawTimeline =
    chatVars && typeof chatVars.$timeline === 'object' && chatVars.$timeline !== null
      ? (chatVars.$timeline as Record<string, unknown>)
      : readTimelineLedger();
  const ledgerBook = resolveChatArchiveBookFromLedger(rawTimeline, available);

  let reboundChatBook = false;
  let effectiveChatBook = currentBound && bookExistsInHost(currentBound) ? currentBound : '';
  if (!effectiveChatBook && ledgerBook && bookExistsInHost(ledgerBook)) {
    effectiveChatBook = ledgerBook;
    if (rebindChatWb) {
      try {
        await Promise.resolve(rebindChatWb('current', ledgerBook));
        reboundChatBook = true;
      } catch (e) {
        console.warn('[floorObservers] 自动恢复绑定当前聊天档案世界书异常:', e);
      }
    }
  }

  const ownBooks = new Set<string>();
  if (effectiveChatBook) {
    ownBooks.add(effectiveChatBook);
  }

  // 2. 收集本聊天 $promoted 提升的独立档案世界书
  const promoted = chatVars?.$promoted;
  if (promoted && typeof promoted === 'object' && !Array.isArray(promoted)) {
    for (const rec of Object.values(promoted as Record<string, { targetBook?: unknown }>)) {
      const tb = typeof rec?.targetBook === 'string' ? rec.targetBook.trim() : '';
      if (tb && bookExistsInHost(tb)) {
        ownBooks.add(tb);
      }
    }
  }

  // 3. 收集本聊天 $dlc 安装的世界书
  const dlc = chatVars?.$dlc;
  if (dlc && typeof dlc === 'object' && !Array.isArray(dlc)) {
    for (const rec of Object.values(dlc as Record<string, { books?: unknown }>)) {
      if (Array.isArray(rec?.books)) {
        for (const b of rec.books) {
          const bName = typeof b === 'string' ? b.trim() : '';
          if (bName && bookExistsInHost(bName)) {
            ownBooks.add(bName);
          }
        }
      }
    }
  }

  // 4. 若本聊天 $archive 存有已晋升正史条目，确保《EVA·动态档案》一并加载
  const archive = chatVars?.$archive;
  if (
    archive &&
    typeof archive === 'object' &&
    !Array.isArray(archive) &&
    Object.keys(archive).length > 0 &&
    bookExistsInHost(ARCHIVE_BOOK)
  ) {
    ownBooks.add(ARCHIVE_BOOK);
  }

  return {
    chatOwnBooks: [...ownBooks],
    boundChatBook: effectiveChatBook || null,
    reboundChatBook,
  };
}

/**
 * 楼层事件触发的多阵营四书与《协议_世界书》+ 当前聊天专属档案世界书自动同步（CMD-UI-01 / DEC-04）：
 * - 读取当前 `stat_data` 的 `unlockedFactions`；
 * - 自动发现并恢复绑定当前聊天自己的档案世界书（`collectAndRestoreChatOwnWorldbooks`）；
 * - 调用 `planFactionWorldbookSync({ worldId, unlockedFactions, activeGlobal, available, chatArchiveBooks })`；
 * - 当 `nextActiveGlobal` 与 `activeGlobal` 存在差异时，调用 `rebindGlobalWorldbooks(nextActiveGlobal)` 并返回 `synced: true`。
 */
export async function syncMultiFactionWorldbooksOnFloorEvent(
  deps?: MultiFactionWorldbookSyncDeps,
): Promise<{
  synced: boolean;
  unlockedFactions: string[];
  nextActiveGlobal: string[];
  boundChatBook?: string | null;
  reboundChatBook?: boolean;
}> {
  const statData = deps?.getStatData ? deps.getStatData() : readLatestStatDataFromHost();
  const rawWorldId = (statData?.meta as { world_id?: unknown } | undefined)?.world_id;
  const worldId = typeof rawWorldId === 'string' ? rawWorldId.trim().toLowerCase() : undefined;
  const unlockedFactions = extractUnlockedFactionsFromStatData(statData);

  const getGlobal =
    deps?.getGlobalWorldbookNames ?? tav<() => Promise<string[]> | string[]>('getGlobalWorldbookNames');
  const getAvailable =
    deps?.getWorldbookNames ?? tav<() => Promise<string[]> | string[]>('getWorldbookNames');
  const rebind =
    deps?.rebindGlobalWorldbooks ?? tav<(names: string[]) => Promise<unknown>>('rebindGlobalWorldbooks');

  if (!getGlobal && !rebind) {
    recordFlightLog({
      category: 'faction_wb_sync',
      status: 'warn',
      chatId: readCurrentChatId(),
      floorId: null,
      swipeId: null,
      title: '多阵营世界书同步跳过',
      detail: `宿主未提供全局世界书读写接口，阵营=[${unlockedFactions.join(', ')}]`,
    });
    return { synced: false, unlockedFactions, nextActiveGlobal: [] };
  }

  const activeGlobalRaw = getGlobal ? await Promise.resolve(getGlobal()) : [];
  const activeGlobal = Array.isArray(activeGlobalRaw) ? activeGlobalRaw : [];
  const availableRaw = getAvailable ? await Promise.resolve(getAvailable()) : [];
  const available = Array.isArray(availableRaw) ? availableRaw : [];

  const { chatOwnBooks, boundChatBook, reboundChatBook } = await collectAndRestoreChatOwnWorldbooks(
    deps,
    available,
  );

  const engineeringEnabled =
    typeof deps?.engineeringEnabled === 'boolean' ? deps.engineeringEnabled : Boolean(debugState.enabled);

  const plan = planFactionWorldbookSync({
    worldId,
    unlockedFactions,
    activeGlobal,
    available,
    chatArchiveBooks: chatOwnBooks,
    engineeringEnabled,
  });

  const hasDiff =
    plan.changed ||
    plan.nextActiveGlobal.length !== activeGlobal.length ||
    plan.nextActiveGlobal.some((name, idx) => name !== activeGlobal[idx]);

  await syncEngineeringWorldbookEntriesInHost(engineeringEnabled, deps);

  if (hasDiff || reboundChatBook) {
    if (hasDiff && rebind) {
      await rebind(plan.nextActiveGlobal);
    }
    try {
      await useCatalogStore().refresh();
    } catch {
      /* Pinia 未激活或单测无 store 环境安全忽略 */
    }
    recordFlightLog({
      category: 'faction_wb_sync',
      status: 'ok',
      chatId: readCurrentChatId(),
      floorId: null,
      swipeId: null,
      title: '多阵营与聊天档案世界书绑定已同步',
      detail: `阵营=[${unlockedFactions.join(', ')}], 聊天书=${boundChatBook ?? '无'} -> [${plan.nextActiveGlobal.join(', ')}]`,
    });
    return {
      synced: true,
      unlockedFactions,
      nextActiveGlobal: plan.nextActiveGlobal,
      boundChatBook,
      reboundChatBook,
    };
  }

  recordFlightLog({
    category: 'faction_wb_sync',
    status: 'ok',
    chatId: readCurrentChatId(),
    floorId: null,
    swipeId: null,
    title: '多阵营与聊天档案世界书无变更跳过',
    detail: `阵营=[${unlockedFactions.join(', ')}], 聊天书=${boundChatBook ?? '无'} 维持不变`,
  });
  return {
    synced: false,
    unlockedFactions,
    nextActiveGlobal: plan.nextActiveGlobal,
    boundChatBook,
    reboundChatBook,
  };
}

export interface FloorObserversFloating {
  refresh(): Promise<unknown>;
  snapshot?: unknown;
}

export interface FloorObserversDeps {
  runParse(messageId: number, opts?: RunOptions): Promise<RunOutcome>;
  getLastMessageId(): number;
  getChatMessages(id: number): ChatMsgLite[];
  readChatId(): string | null;
  eventOn(event: string, callback: (...args: unknown[]) => void): EventOnReturn;
}

export function readCurrentChatId(): string | null {
  try {
    const id = (globalThis as { SillyTavern?: { getCurrentChatId?: () => string } }).SillyTavern?.getCurrentChatId?.();
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

export function findLatestAiFloor(
  deps?: Pick<FloorObserversDeps, 'getLastMessageId' | 'getChatMessages'>,
): number | null {
  const glmi = deps?.getLastMessageId ?? tav<() => number>('getLastMessageId');
  const gcm = deps?.getChatMessages ?? tav<(id: number) => ChatMsgLite[]>('getChatMessages');
  if (!glmi || !gcm) return null;
  let last: number;
  try {
    last = glmi();
  } catch {
    return null;
  }
  if (!Number.isFinite(last)) return null;
  for (let id = last; id >= 0; id--) {
    try {
      const msgs = gcm(id);
      const m = msgs?.[0];
      if (m && m.role !== 'user' && !m.is_hidden) return id;
    } catch {
      continue;
    }
  }
  return null;
}

let wired = false;
const inFlight = new Set<string>();
let stopHandles: EventOnReturn[] = [];
let autoConfirmingSummary = false;

/**
 * 当开启「摘要自动确认入档」（默认 true）且当前楼层 stat_data.pending_summaries 存在待确认草稿时，
 * 自动将其归档写入聊天世界书、按规则隐藏对应历史楼层，并从本楼 pending_summaries 中核销移除。
 */
export async function autoConfirmPendingSummariesIfEnabled(
  messageId: number,
  floating: FloorObserversFloating,
): Promise<number> {
  if (autoConfirmingSummary || !in_tavern || !getSummaryAutoConfirm()) return 0;
  const snap = (floating.snapshot ?? readLatestStatDataFromHost()) as
    | { pending_summaries?: SummaryDraft[] }
    | null
    | undefined;
  const pending = Array.isArray(snap?.pending_summaries) ? snap.pending_summaries : [];
  if (pending.length === 0) return 0;

  autoConfirmingSummary = true;
  let adoptedCount = 0;
  try {
    ensureChatBookGatewayMethods();
    const strategyType = getSummaryStrategy();
    const floorHandling = getSummaryFloorHandling();
    const budgetCfg = getSummaryBudgetConfig();
    const drafts: SummaryDraft[] = JSON.parse(JSON.stringify(pending));
    const remaining: SummaryDraft[] = [...drafts];

    for (const draft of drafts) {
      try {
        await adoptSummary(draft, {
          gateway: chatBookGateway,
          strategyType,
          floorHandling,
          currentFloor: messageId,
          tailReserve: budgetCfg.tailReserveFloors,
          onAdopted: () => {
            const idx = remaining.findIndex(
              p => p.from === draft.from && p.to === draft.to && (p.tier ?? 'meso') === (draft.tier ?? 'meso'),
            );
            if (idx >= 0) remaining.splice(idx, 1);
            adoptedCount++;
          },
        });
      } catch (err) {
        console.warn('[floorObservers] 自动确认入档摘要草稿异常:', err);
      }
    }

    if (adoptedCount > 0) {
      await updateFloorVars(messageId, vars => {
        const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
        return {
          ...vars,
          stat_data: {
            ...sd,
            pending_summaries: JSON.parse(JSON.stringify(remaining)),
          },
        };
      });
      await floating.refresh();
    }
  } finally {
    autoConfirmingSummary = false;
  }
  return adoptedCount;
}

export function isFloorObserversWired(): boolean {
  return wired;
}

export async function parseAndRefresh(
  messageId: number,
  floating: FloorObserversFloating,
  opts?: RunOptions & { source?: string },
  deps?: Pick<FloorObserversDeps, 'runParse' | 'readChatId'>,
): Promise<void> {
  const runner = deps?.runParse ?? runParseFor;
  const readId = deps?.readChatId ?? readCurrentChatId;
  const chatKey = opts?.expectChatId ?? readId() ?? undefined;
  const inFlightKey = `${chatKey ?? ''}#${messageId}`;
  const source = opts?.source ?? 'auto';
  if (inFlight.has(inFlightKey)) {
    recordFlightLog({
      category: 'inflight_guard',
      status: 'blocked',
      chatId: chatKey ?? null,
      floorId: messageId,
      swipeId: null,
      title: `单飞锁拦截 (${source})`,
      detail: `inFlightKey=${inFlightKey} 仍在执行中，跳过重入`,
    });
    return;
  }
  inFlight.add(inFlightKey);
  recordFlightLog({
    category: 'host_event',
    status: 'ok',
    chatId: chatKey ?? null,
    floorId: messageId,
    swipeId: null,
    title: `宿主事件 ${source}`,
    detail: `开始处理楼层 #${messageId} (${inFlightKey})`,
  });
  const t0 = nowPerfMs();
  try {
    await runner(messageId, {
      ...opts,
      expectChatId: chatKey,
    });
  } catch (e) {
    console.warn(`[floorObservers] 解析 #${messageId} 异常`, e);
  } finally {
    inFlight.delete(inFlightKey);
  }
  try {
    await floating.refresh();
  } catch (e) {
    console.warn('[floorObservers] 悬浮窗刷新异常', e);
  }
  if (!deps?.runParse) {
    await autoConfirmPendingSummariesIfEnabled(messageId, floating).catch(e => {
      console.warn('[floorObservers] 自动确认摘要入档异常', e);
    });
  }
  recordPerfSample('floor.parseAndRefresh', nowPerfMs() - t0, {
    detail: `floor #${messageId} (${opts?.source ?? 'auto'})`,
  });
  void syncMultiFactionWorldbooksOnFloorEvent({
    getStatData: () =>
      ((floating.snapshot ?? null) as Record<string, unknown> | null) ?? readLatestStatDataFromHost(),
  }).catch(e => {
    console.warn('[floorObservers] 多阵营世界书同步异常', e);
  });
}

export function teardownFloorObservers(): void {
  for (const h of stopHandles) {
    try {
      h.stop();
    } catch {
      /* ignore */
    }
  }
  stopHandles = [];
  inFlight.clear();
  wired = false;
}

export const realFloorObserversDeps: FloorObserversDeps = {
  runParse: runParseFor,
  getLastMessageId: () => {
    const fn = tav<() => number>('getLastMessageId');
    if (!fn) throw new Error('getLastMessageId 不可用');
    return fn();
  },
  getChatMessages: id => {
    const fn = tav<(mid: number) => ChatMsgLite[]>('getChatMessages');
    if (!fn) return [];
    return fn(id);
  },
  readChatId: readCurrentChatId,
  eventOn: (event, callback) => {
    const fn = tav<(evt: string, cb: (...args: unknown[]) => void) => EventOnReturn>('eventOn');
    if (fn) return fn(event, callback);
    if (typeof (globalThis as any).eventOn === 'function') {
      return (globalThis as any).eventOn(event, callback);
    }
    return { stop: () => {} };
  },
};

function safeErrorCatched<T extends (...args: unknown[]) => unknown>(fn: T): T {
  const ec = (globalThis as Record<string, unknown>).errorCatched as ((f: unknown) => T) | undefined;
  if (typeof ec === 'function') {
    return ec(fn);
  }
  return fn;
}

export function installFloorObservers(
  floating: FloorObserversFloating,
  deps: FloorObserversDeps = realFloorObserversDeps,
): () => void {
  if (wired) return teardownFloorObservers;
  if (!in_tavern && typeof (globalThis as any).eventOn !== 'function' && deps === realFloorObserversDeps) {
    void floating.refresh().catch(() => {});
    return () => {};
  }
  wired = true;

  const events = (globalThis as Record<string, unknown>).tavern_events as
    | {
        GENERATION_ENDED?: string;
        MESSAGE_SWIPED?: string;
        MESSAGE_EDITED?: string;
        MESSAGE_DELETED?: string;
        CHAT_CHANGED?: string;
      }
    | undefined;

  const onGenerationEnded = (_chatLength?: unknown) => {
    // 依据：SillyTavern 的 script.js 原文：
    // `eventSource.emit(event_types.GENERATION_ENDED, chat.length);`
    // 事件参数是聊天总条数（chat.length），并非 0 起算的楼号（例如 21 条消息对应最后楼号 20）。
    // 若当作楼号会造成越界异常。因此不再把事件参数当作楼号，一律由 findLatestAiFloor(deps) 定位最新 AI 楼。
    const mid = findLatestAiFloor(deps);
    if (mid !== null) {
      void parseAndRefresh(mid, floating, { force: false }, deps);
    }
  };

  const onMessageSwiped = async (message_id?: unknown) => {
    dismissChrono();
    const mid = typeof message_id === 'number' && Number.isFinite(message_id) ? message_id : findLatestAiFloor(deps);
    if (mid !== null) {
      try {
        const rawSwipeId = deps.getChatMessages(mid)?.[0]?.swipe_id;
        if (typeof rawSwipeId === 'number' && Number.isFinite(rawSwipeId)) {
          ensureChatBookGatewayMethods();
          await reconcileSwipeWorldbookTransition({
            floorId: mid,
            newSwipeId: Math.max(0, Math.trunc(rawSwipeId)),
          });
        }
      } catch (e) {
        console.warn(`[floorObservers] Swipe #${mid} 世界书同步异常`, e);
      }
      await parseAndRefresh(mid, floating, { force: false }, deps);
    }
  };

  const onMessageEdited = (message_id?: unknown) => {
    const mid = typeof message_id === 'number' && Number.isFinite(message_id) ? message_id : findLatestAiFloor(deps);
    if (mid !== null) {
      let last: number;
      try {
        last = deps.getLastMessageId();
      } catch {
        last = mid;
      }
      void parseAndRefresh(mid, floating, { force: false, downstreamWarning: mid < last }, deps);
    }
  };

  const onMessageDeleted = async () => {
    const last = findLatestAiFloor(deps) ?? -1;
    try {
      await reconcileDeletedFloorsAbove(last);
    } catch (e) {
      console.warn('[floorObservers] 删楼水位线对账异常', e);
    }
    if (last >= 0) {
      await parseAndRefresh(last, floating, { force: false }, deps);
    } else {
      await floating.refresh();
    }
  };

  const onChatChanged = async () => {
    dismissChrono();
    const mid = findLatestAiFloor(deps);
    recordFlightLog({
      category: 'host_event',
      status: 'ok',
      chatId: deps.readChatId() ?? readCurrentChatId(),
      floorId: null,
      swipeId: null,
      title: '宿主事件 CHAT_CHANGED',
      detail: `切换聊天会话，最新 AI 楼层=${mid !== null ? `#${mid}` : '无'}`,
    });
    try {
      ensureChatBookGatewayMethods();
      const ledgerBefore = readTimelineLedger();
      const isoRes = await ensureBranchWorldbookIsolation({ branchMaxFloor: mid ?? -1 });
      await finalizeBranchWorldbookCloneIfNeeded(ledgerBefore, mid ?? -1, isoRes);
    } catch (e) {
      console.warn('[floorObservers] 分支档案书隔离异常', e);
    }
    if (mid !== null) {
      await parseAndRefresh(mid, floating, { force: false }, deps);
    } else {
      await floating.refresh();
      void syncMultiFactionWorldbooksOnFloorEvent({
        getStatData: () =>
          ((floating.snapshot ?? null) as Record<string, unknown> | null) ?? readLatestStatDataFromHost(),
      }).catch(e => {
        console.warn('[floorObservers] 多阵营世界书同步异常', e);
      });
    }
    try {
      await useCatalogStore().refresh();
    } catch {
      /* Pinia 未激活时安全忽略 */
    }
  };

  if (events?.GENERATION_ENDED) {
    stopHandles.push(deps.eventOn(events.GENERATION_ENDED, safeErrorCatched(onGenerationEnded)));
  }
  if (events?.MESSAGE_SWIPED) {
    stopHandles.push(deps.eventOn(events.MESSAGE_SWIPED, safeErrorCatched(onMessageSwiped)));
  }
  if (events?.MESSAGE_EDITED) {
    stopHandles.push(deps.eventOn(events.MESSAGE_EDITED, safeErrorCatched(onMessageEdited)));
  }
  const messageDeletedEvent =
    events?.MESSAGE_DELETED ??
    (events && events.GENERATION_ENDED === 'tavern_generation_ended' && !('MESSAGE_DELETED' in events)
      ? undefined
      : 'message_deleted');
  if (messageDeletedEvent) {
    stopHandles.push(deps.eventOn(messageDeletedEvent, safeErrorCatched(onMessageDeleted)));
  }
  if (events?.CHAT_CHANGED) {
    stopHandles.push(deps.eventOn(events.CHAT_CHANGED, safeErrorCatched(onChatChanged)));
  }

  // init 时恢复聊天档案世界书绑定并补解析最后一个 AI 楼（靠 hash 幂等，未解析楼在此补落盘）
  const initialFloor = findLatestAiFloor(deps);
  if (deps === realFloorObserversDeps) {
    void (async () => {
      try {
        ensureChatBookGatewayMethods();
        const ledgerBefore = readTimelineLedger();
        const isoRes = await ensureBranchWorldbookIsolation({ branchMaxFloor: initialFloor ?? -1 });
        await finalizeBranchWorldbookCloneIfNeeded(ledgerBefore, initialFloor ?? -1, isoRes);
      } catch (e) {
        console.warn('[floorObservers] 初始聊天档案书绑定检查异常', e);
      }
    })();
  }
  if (initialFloor !== null) {
    void parseAndRefresh(initialFloor, floating, { force: false }, deps);
  } else {
    void floating.refresh();
    if (deps === realFloorObserversDeps) {
      void syncMultiFactionWorldbooksOnFloorEvent({
        getStatData: () =>
          ((floating.snapshot ?? null) as Record<string, unknown> | null) ?? readLatestStatDataFromHost(),
      }).catch(e => {
        console.warn('[floorObservers] 初始世界书同步异常', e);
      });
    }
  }

  return teardownFloorObservers;
}

export interface WorldbookAutoFilerDeps extends MultiFactionWorldbookSyncDeps {
  eventOn?: (event: string, callback: (...args: unknown[]) => void) => EventOnReturn;
}

/**
 * 安装多阵营四书自动同步监听器（监听 MESSAGE_RECEIVED / MESSAGE_SWIPED / MESSAGE_EDITED / CHAT_CHANGED）
 */
export function installWorldbookAutoFiler(deps?: WorldbookAutoFilerDeps): () => void {
  const eventOn = deps?.eventOn ?? realFloorObserversDeps.eventOn;
  const events = (globalThis as Record<string, unknown>).tavern_events as
    | {
        MESSAGE_RECEIVED?: string;
        GENERATION_ENDED?: string;
        MESSAGE_SWIPED?: string;
        MESSAGE_EDITED?: string;
        CHAT_CHANGED?: string;
      }
    | undefined;

  const handles: EventOnReturn[] = [];
  let syncing = false;
  const triggerSync = () => {
    if (syncing) return;
    syncing = true;
    void syncMultiFactionWorldbooksOnFloorEvent(deps)
      .catch(e => {
        console.warn('[floorObservers] 多阵营世界书自动同步异常', e);
      })
      .finally(() => {
        syncing = false;
      });
  };

  const eventNames = [
    events?.MESSAGE_RECEIVED ?? 'MESSAGE_RECEIVED',
    events?.MESSAGE_SWIPED ?? 'MESSAGE_SWIPED',
    events?.MESSAGE_EDITED ?? 'MESSAGE_EDITED',
    events?.CHAT_CHANGED ?? 'CHAT_CHANGED',
  ];

  for (const evt of new Set(eventNames.filter(Boolean))) {
    handles.push(eventOn(evt, safeErrorCatched(triggerSync)));
  }

  return () => {
    for (const h of handles) {
      try {
        h.stop();
      } catch {
        /* ignore */
      }
    }
  };
}

