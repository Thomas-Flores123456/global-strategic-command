/**
 * expansionAutoFiler.ts —— 扩展档案自动入档（F1 · CTRL-CHATBOOK-02 §2.1 接线，中控台侧）
 *
 * 管线：floating.snapshot.pending_expansions → expansionFiler.fileExpansion（chatBookGateway 三重守卫，
 * 惰性建书）→ 当前聊天档案书；成功后清暂存 + codex 索引派生；失败不清暂存，下轮重试（pending_lore 先例）。
 *
 * 驾驶员裁决（2026-09-23）：
 * - 楼层终端回归纯行动选项，本功能落中控台；独立开关 `rts-expansion-autofile`，默认开；
 * - D-RAC-FLOAT-READONLY-01 受控例外（授权·限定写）：中控只允许对 floating.floorId 那一楼执行
 *   updateVariablesWith，且只做两件事——从 stat_data.pending_expansions 移除「本轮已入档」条目、
 *   在 stat_data.codex 幂等 upsert 派生索引。其余字段零改动；写前复核聊天 ID 未漂移（fail-closed）。
 *
 * 可测性：宿主依赖全部经 AutoFilerDeps 注入，默认实现仅在调用时触碰全局。
 */
import { reactive } from 'vue';
import {
  recordWorldbookMutationsFromDiff,
  snapshotWorldbookEntriesBeforeWrite,
} from '../../红警指挥系统/worldbook/branchBookCloner';
import type { ChatBookGatewayLike, WriteTxn } from '../../红警指挥系统/worldbook/chatBookBinding';
import { chatBookGateway, GuardError } from '../../红警指挥系统/worldbook/chatBookBinding';
import { recordFlightLog } from '../../红警指挥系统/debug/dataFlowTracer';
import {
  fileExpansion,
  makeExpansionComment,
  upsertCodexList,
  type FileExpansionReceipt,
} from '../../红警指挥系统/worldbook/expansionFiler';
import type { CodexEntry, ExpansionDossier } from '../../红警指挥系统/core/schema';
import { makeFloorKey, makeSwipeKey, writeTimelineLedger } from '../../红警指挥系统/core/timelineLedger';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import { tav } from '../../红警指挥系统/parse/systemCheck';
import { updateFloorVars, type VarUpdater } from './floorVarWrite';

export const EXPANSION_AUTO_KEY = 'rts-expansion-autofile';

export interface ExpansionFileLog {
  time: string;
  name: string;
  ok: boolean;
  note: string;
  fork?: boolean;
}

function loadAuto(): boolean {
  try {
    return localStorage.getItem(EXPANSION_AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const expansionFilerState = reactive({
  auto: loadAuto(),
  busy: false,
  receipts: [] as ExpansionFileLog[],
});

export function setExpansionAutoFile(v: boolean): void {
  expansionFilerState.auto = v;
  try {
    localStorage.setItem(EXPANSION_AUTO_KEY, v ? 'on' : 'off');
  } catch {
    /* storage 不可用时仅本次生效 */
  }
}

export interface AutoFilerDeps {
  fileOne(d: ExpansionDossier, gateway: ChatBookGatewayLike, codexSink: CodexEntry[]): Promise<FileExpansionReceipt>;
  updateFloorVars(messageId: number, updater: VarUpdater): Promise<void>;
  readChatId(): string | null;
  readSwipeId?(floorId: number): number;
  gateway: ChatBookGatewayLike;
  now(): Date;
}

export const realAutoFilerDeps: AutoFilerDeps = {
  fileOne: (d, gateway, codexSink) => fileExpansion(d, gateway, { codexSink }),
  updateFloorVars: (messageId, updater) => updateFloorVars(messageId, updater),
  readChatId() {
    try {
      const id = (
        globalThis as { SillyTavern?: { getCurrentChatId?: () => string } }
      ).SillyTavern?.getCurrentChatId?.();
      return typeof id === 'string' && id ? id : null;
    } catch {
      return null;
    }
  },
  readSwipeId(floorId: number): number {
    try {
      const sid = tav<(id: number) => Array<{ swipe_id?: number }>>('getChatMessages')?.(floorId)?.[0]?.swipe_id;
      return typeof sid === 'number' && Number.isFinite(sid) && Number.isInteger(sid) && sid >= 0 ? sid : 0;
    } catch {
      return 0;
    }
  },
  gateway: chatBookGateway,
  now: () => new Date(),
};

const EXPANSION_FILABLE_KINDS = new Set<ExpansionDossier['kind']>([
  '科技',
  '建筑',
  '载具',
  '人员',
  '人物',
  '装备',
  '地点',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v));
}

function toCodexLoreExpansionDossier(item: unknown): ExpansionDossier | null {
  if (!isPlainObject(item)) return null;
  const raw = isPlainObject(item.raw) ? item.raw : null;
  const codex = isPlainObject(raw?.codex) ? raw.codex : null;
  if (raw?.tag !== '图鉴' && !codex) return null;
  const name = String(codex?.name ?? item.name ?? '').trim();
  const kind = String(codex?.kind ?? item.kind ?? '').trim() as ExpansionDossier['kind'];
  if (!name || !EXPANSION_FILABLE_KINDS.has(kind)) return null;
  const desc = String(codex?.desc ?? item.summary ?? '').trim();
  const rawParams = isPlainObject(codex?.params) ? codex.params : {};
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawParams)) {
    if (v !== undefined && v !== null) params[k] = String(v);
  }
  return {
    name,
    kind,
    desc: desc || `新发现${kind}「${name}」`,
    params,
    detail: desc,
    keys: [name],
  };
}

/**
 * 汇总快照中待自动入档的扩展条目：包含 `<扩展档案>` 暂存（pending_expansions）
 * 以及 `<图鉴>` 新增的沙盒非势力实体暂存（pending_lore 中 raw.tag === '图鉴' 且属合法扩展类别）。
 */
export function collectPendingExpansionsFromSnapshot(
  snapshot:
    | { pending_expansions?: readonly ExpansionDossier[]; pending_lore?: readonly unknown[] }
    | null
    | undefined,
): ExpansionDossier[] {
  if (!snapshot) return [];
  const out: ExpansionDossier[] = Array.isArray(snapshot.pending_expansions)
    ? [...snapshot.pending_expansions]
    : [];
  const seen = new Set(out.map(d => `${String(d.kind ?? '').trim()}::${String(d.name ?? '').trim()}`));
  if (Array.isArray(snapshot.pending_lore)) {
    for (const item of snapshot.pending_lore) {
      const dossier = toCodexLoreExpansionDossier(item);
      if (!dossier) continue;
      const key = `${dossier.kind}::${dossier.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(dossier);
    }
  }
  return out;
}

/**
 * 纯函数：对本楼 stat_data 施加「限定写」——只移除已入档条目、只 upsert codex 派生索引。
 * 入参不被修改；返回新 stat_data。
 * 支持按 `${kind}::${name}` 复合键精准核销同名异类条目，同时向后兼容纯名称字符串。
 */
export function applyFiledToStatData(
  statData: Record<string, unknown>,
  filedNamesOrKeys: readonly string[],
  codexEntries: readonly CodexEntry[],
): Record<string, unknown> {
  const next = { ...statData };
  const filed = new Set(filedNamesOrKeys);
  const pending = Array.isArray(statData.pending_expansions)
    ? (statData.pending_expansions as { name?: unknown; kind?: unknown }[])
    : [];
  next.pending_expansions = pending.filter(p => {
    const pName = String(p?.name ?? '');
    const pKind = String(p?.kind ?? '').trim();
    const compositeKey = `${pKind}::${pName}`;
    return !filed.has(compositeKey) && !filed.has(pName);
  });
  if (Array.isArray(statData.pending_lore)) {
    next.pending_lore = (statData.pending_lore as unknown[]).filter(item => {
      const dossier = toCodexLoreExpansionDossier(item);
      if (!dossier) return true;
      const compositeKey = `${dossier.kind}::${dossier.name}`;
      return !filed.has(compositeKey) && !filed.has(dossier.name);
    });
  }
  let codex = Array.isArray(statData.codex) ? (structuredClone(statData.codex) as CodexEntry[]) : [];
  for (const entry of codexEntries) codex = upsertCodexList(codex, entry).codex;
  next.codex = codex;
  return next;
}

export interface RunInput {
  floorId: number | null;
  pending: readonly ExpansionDossier[];
  pendingLore?: readonly unknown[];
  txn?: WriteTxn;
}

export interface RunOutcome {
  filed: string[];
  failed: string[];
  wroteVars: boolean;
  skipped?: string;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function pushReceipt(log: ExpansionFileLog): void {
  expansionFilerState.receipts.unshift(log);
  expansionFilerState.receipts.splice(10);
}

export function captureAutoFileTxn(
  gateway: ChatBookGatewayLike,
  readChatId: () => string | null,
): WriteTxn & { boundBook?: string | null } {
  let chatId = readChatId();
  if (!chatId && gateway !== chatBookGateway) {
    try {
      const base = gateway.begin();
      if (base?.chatId) chatId = base.chatId;
    } catch {
      /* begin 异常留到实际 guardedBook 抛 GuardError */
    }
  }
  const boundBook =
    typeof gateway.getChatWorldbookName === 'function' ? gateway.getChatWorldbookName('current') : undefined;
  return { chatId: chatId ?? '', boundBook };
}

export function bindGatewayToTxn(
  gateway: ChatBookGatewayLike,
  txn: WriteTxn & { boundBook?: string | null },
  readChatId: () => string | null,
): ChatBookGatewayLike {
  let expectedBook = txn.boundBook;
  return {
    ...gateway,
    begin: () => {
      if (!txn.chatId) return gateway.begin();
      return { chatId: txn.chatId };
    },
    guardedBook: async (_ignoredTxn, opts) => {
      const currentChatId = readChatId();
      if (!txn.chatId || currentChatId === null || currentChatId !== txn.chatId) {
        throw new GuardError({
          guard: 1,
          rule: 'chat-id-drift',
          expected: `chatId=${txn.chatId}`,
          actual: `chatId=${currentChatId}`,
        });
      }
      if (expectedBook && typeof gateway.getChatWorldbookName === 'function') {
        const currentBound = gateway.getChatWorldbookName('current');
        if (currentBound !== expectedBook) {
          throw new GuardError({
            guard: 2,
            rule: 'binding-missing',
            expected: `boundBook=${expectedBook}`,
            actual: `boundBook=${currentBound}`,
          });
        }
      }
      const book = await gateway.guardedBook({ chatId: txn.chatId }, opts);
      if (expectedBook && book !== expectedBook) {
        throw new GuardError({
          guard: 2,
          rule: 'binding-missing',
          expected: `boundBook=${expectedBook}`,
          actual: `boundBook=${book}`,
        });
      }
      expectedBook = book;
      txn.boundBook = book;
      return book;
    },
  };
}

/** 逐个入档；成功者在 floorId 楼限定写清暂存 + codex，失败者留存可重试 */
export async function fileAllPendingExpansions(
  input: RunInput,
  deps: AutoFilerDeps = realAutoFilerDeps,
): Promise<RunOutcome> {
  if (expansionFilerState.busy) return { filed: [], failed: [], wroteVars: false, skipped: 'busy' };
  const effectivePending = input.pendingLore?.length
    ? collectPendingExpansionsFromSnapshot({
        pending_expansions: input.pending,
        pending_lore: input.pendingLore,
      })
    : [...input.pending];
  if (input.floorId === null || effectivePending.length === 0) {
    return { filed: [], failed: [], wroteVars: false, skipped: 'empty' };
  }
  expansionFilerState.busy = true;
  const txn: WriteTxn & { boundBook?: string | null } = input.txn ?? captureAutoFileTxn(deps.gateway, () => deps.readChatId());
  const chatAtStart = txn.chatId || null;
  const pinnedGateway = bindGatewayToTxn(deps.gateway, txn, () => deps.readChatId());
  const rawSwipe = deps.readSwipeId ? deps.readSwipeId(input.floorId) : 0;
  const swipeId = typeof rawSwipe === 'number' && Number.isFinite(rawSwipe) ? Math.max(0, Math.trunc(rawSwipe)) : 0;
  const filed: string[] = [];
  const filedCompositeKeys: string[] = [];
  const failed: string[] = [];
  const codexEntries: CodexEntry[] = [];
  try {
    for (const d of effectivePending) {
      const time = deps.now().toLocaleTimeString();
      const defaultEntryName = makeExpansionComment(d);
      const altEntryName = `${d.kind}·${d.name}`;
      const snapGateway =
        typeof pinnedGateway.getChatWorldbookName === 'function' ? pinnedGateway : undefined;
      let before: Awaited<ReturnType<typeof snapshotWorldbookEntriesBeforeWrite>> | null = null;
      try {
        before = await snapshotWorldbookEntriesBeforeWrite([defaultEntryName, altEntryName], snapGateway);
      } catch {
        /* 快照采集失败不阻断入档主流程 */
      }
      try {
        const receipt = await deps.fileOne(d, pinnedGateway, codexEntries);
        try {
          if (before) {
            const targetEntryName = receipt.entryName || defaultEntryName;
            if (!before.snapshots.has(targetEntryName)) {
              before.snapshots.set(
                targetEntryName,
                before.snapshots.get(defaultEntryName) ?? before.snapshots.get(altEntryName) ?? null,
              );
            }
            let afterSnap: Awaited<ReturnType<typeof snapshotWorldbookEntriesBeforeWrite>> | null = null;
            try {
              afterSnap = await snapshotWorldbookEntriesBeforeWrite([targetEntryName], snapGateway);
            } catch {
              /* 写后快照采集失败不阻断 */
            }
            const diffParams: Parameters<typeof recordWorldbookMutationsFromDiff>[0] & {
              afterSnapshots?: Map<string, unknown>;
            } = {
              floorId: input.floorId,
              swipeId,
              bookName: receipt.book || before.bookName,
              entryNames: [targetEntryName],
              beforeSnapshots: before.snapshots,
              ...(afterSnap ? { afterSnapshots: afterSnap.snapshots } : {}),
            };
            recordWorldbookMutationsFromDiff(diffParams);
            if (afterSnap) {
              const afterEntry = afterSnap.snapshots.get(targetEntryName) ?? null;
              writeTimelineLedger(draft => {
                const journal =
                  draft.floors[makeFloorKey(input.floorId!)]?.swipes[makeSwipeKey(swipeId)]?.wbJournal;
                if (Array.isArray(journal) && journal.length > 0) {
                  const lastRec = journal[journal.length - 1];
                  if (lastRec && lastRec.entryName === targetEntryName) {
                    (lastRec as unknown as { afterEntry?: unknown }).afterEntry = afterEntry;
                  }
                }
              });
            }
          }
        } catch {
          /* wbJournal 记录异常不影响入档主流程 */
        }
        filed.push(d.name);
        filedCompositeKeys.push(`${String(d.kind ?? '').trim()}::${d.name}`);
        pushReceipt({
          time,
          name: d.name,
          ok: true,
          fork: receipt.forkWarning,
          note: `${receipt.book} · ${receipt.entryName} · ${receipt.action === 'created' ? '新建' : '更新'}${
            receipt.forkWarning ? ` · ⚠ 已提升实体的本线分叉（提升书：${receipt.forkPromotedBook ?? '?'}）` : ''
          }`,
        });
      } catch (e) {
        failed.push(d.name);
        const note = errText(e);
        pushReceipt({ time, name: d.name, ok: false, note });
        const isGuard = e instanceof GuardError || (e as { name?: string })?.name === 'GuardError';
        recordFlightLog({
          category: 'auto_filer',
          status: isGuard ? 'blocked' : 'error',
          chatId: chatAtStart,
          floorId: input.floorId,
          swipeId,
          title: isGuard ? `扩展自动入档守卫拦截 (${d.name})` : `扩展自动入档失败 (${d.name})`,
          detail: note,
        });
      }
    }
    if (filed.length === 0) return { filed, failed, wroteVars: false };

    // 限定写前复核：聊天与绑定书未漂移（否则 floorId 属于别的聊天，fail-closed 不写变量）
    const currentBound =
      typeof deps.gateway?.getChatWorldbookName === 'function' ? deps.gateway.getChatWorldbookName('current') : txn.boundBook;
    if (
      chatAtStart === null ||
      deps.readChatId() !== chatAtStart ||
      (txn.boundBook && currentBound !== undefined && currentBound !== txn.boundBook)
    ) {
      const note = '聊天已切换，暂存清理中止（条目已入书，下轮按名 upsert 幂等）';
      pushReceipt({
        time: deps.now().toLocaleTimeString(),
        name: filed.join('、'),
        ok: false,
        note,
      });
      recordFlightLog({
        category: 'auto_filer',
        status: 'blocked',
        chatId: chatAtStart,
        floorId: input.floorId,
        swipeId,
        title: '扩展自动入档写前复核拦截',
        detail: `${filed.join('、')}：${note}`,
      });
      return { filed, failed, wroteVars: false };
    }
    const floorId = input.floorId;
    await deps.updateFloorVars(floorId, vars => {
      const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
      return { ...vars, stat_data: applyFiledToStatData(sd, filedCompositeKeys, codexEntries) };
    });
    const hasData = effectivePending.some(
      d =>
        filedCompositeKeys.includes(`${String(d.kind ?? '').trim()}::${d.name}`) &&
        (Boolean(d.data) || (d as { type?: unknown }).type === 'data'),
    );
    if (hasData || filed.length > 0) {
      try {
        await useCatalogStore().refresh();
      } catch {
        /* 目录刷新失败不阻断入档主流程 */
      }
    }
    recordFlightLog({
      category: 'auto_filer',
      status: failed.length > 0 ? 'warn' : 'ok',
      chatId: chatAtStart,
      floorId: input.floorId,
      swipeId,
      title: `扩展自动入档完成 (${filed.length} 项)`,
      detail: `入档=[${filed.join('、')}]${failed.length > 0 ? ` · 失败=[${failed.join('、')}]` : ''}`,
    });
    return { filed, failed, wroteVars: true };
  } finally {
    expansionFilerState.busy = false;
  }
}

export interface FloatingLike {
  snapshot: { pending_expansions?: ExpansionDossier[]; pending_lore?: unknown[] } | null;
  floorId: number | null;
  refresh(): Promise<unknown>;
  onRefresh(cb: () => void): () => void;
}

/**
 * 扩展档案与机娘档案共享的轻量级异步串行队列：
 * 避免同一轮 onRefresh 同时触发 expansionAutoFiler 与 girlAutoFiler 并发交叉读写同一世界书与楼层变量。
 */
let sharedAutoFileQueue: Promise<unknown> = Promise.resolve();

export function enqueueAutoFileTask<T>(task: () => Promise<T>): Promise<T> {
  const next = sharedAutoFileQueue.then(task, task);
  sharedAutoFileQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** 从 floating store 当前快照触发一次入档，写后刷新 */
export async function runFromFloating(
  floating: FloatingLike,
  deps: AutoFilerDeps = realAutoFilerDeps,
  txn?: WriteTxn,
) {
  const capturedTxn = txn ?? captureAutoFileTxn(deps.gateway, () => deps.readChatId());
  const outcome = await fileAllPendingExpansions(
    { floorId: floating.floorId, pending: collectPendingExpansionsFromSnapshot(floating.snapshot), txn: capturedTxn },
    deps,
  );
  if (outcome.wroteVars) await floating.refresh();
  return outcome;
}

/**
 * 安装自动入档观察者（中控台唯一安装点：中控 index.ts init）。
 * 每次 floating 刷新后若开关开、有暂存且不忙 → 入档。失败不主动重刷，避免失败循环；下次生成/切换自然重试。
 */
export function installExpansionAutoFiler(floating: FloatingLike, deps: AutoFilerDeps = realAutoFilerDeps): () => void {
  let queued = false;
  return floating.onRefresh(() => {
    if (!expansionFilerState.auto || expansionFilerState.busy || queued) return;
    const pendingSnapshot = collectPendingExpansionsFromSnapshot(floating.snapshot);
    if (!pendingSnapshot.length) return;
    const floorIdSnapshot = floating.floorId;
    const entryTxn = captureAutoFileTxn(deps.gateway, () => deps.readChatId());
    queued = true;
    void enqueueAutoFileTask(async () => {
      try {
        if (!expansionFilerState.auto || expansionFilerState.busy) return;
        const outcome = await fileAllPendingExpansions(
          { floorId: floorIdSnapshot, pending: pendingSnapshot, txn: entryTxn },
          deps,
        );
        if (outcome.wroteVars) await floating.refresh();
      } finally {
        queued = false;
      }
    }).catch(e => console.warn('[expansionAutoFiler] 自动入档异常', e));
  });
}
