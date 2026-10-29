/**
 * girlAutoFiler.ts —— 机娘档案自动入档（CTRL-FLOOR-SLIM-01 中控台侧观察者）
 *
 * 管线：floating.snapshot.pending_lore → girlFiler.fileDossier（chatBookGateway 三重守卫）
 * → 当前聊天档案书；成功后清暂存 + codex 索引派生；失败不清暂存，下轮重试。
 *
 * 驾驶员裁决（2026-09-24）：
 * - 楼层终端瘦身，机娘入档观察者迁入中控悬浮窗；
 * - D-RAC-FLOAT-READONLY-01 受控例外（授权·限定写）：中控只允许对 floating.floorId 那一楼执行
 *   updateFloorVars（收口至 floorVarWrite.ts），且只做两件事——从 stat_data.pending_lore 移除
 *   「本轮已入档」条目、在 stat_data.codex 幂等 upsert 派生索引。其余字段零改动；写前复核聊天 ID 未漂移（fail-closed）。
 *
 * 可测性：宿主依赖全部经 GirlAutoFilerDeps 注入，默认实现仅在调用时触碰全局。
 */
import {
  recordWorldbookMutationsFromDiff,
  snapshotWorldbookEntriesBeforeWrite,
} from '../../红警指挥系统/worldbook/branchBookCloner';
import type { ChatBookGatewayLike, WriteTxn } from '../../红警指挥系统/worldbook/chatBookBinding';
import { chatBookGateway, GuardError } from '../../红警指挥系统/worldbook/chatBookBinding';
import { recordFlightLog } from '../../红警指挥系统/debug/dataFlowTracer';
import {
  fileDossier,
  isGirlDossierEntry,
  renderRosterLine,
  type Dossier,
  type FileDossierReceipt,
} from '../../红警指挥系统/worldbook/girlFiler';
import type { CodexEntry } from '../../红警指挥系统/core/schema';
import { makeFloorKey, makeSwipeKey, writeTimelineLedger } from '../../红警指挥系统/core/timelineLedger';
import { filerState, setAutoFile, type FileLogItem } from '../../红警指挥系统/composables/useGirlFiler';
import { tav } from '../../红警指挥系统/parse/systemCheck';
import { bindGatewayToTxn, captureAutoFileTxn, enqueueAutoFileTask } from './expansionAutoFiler';
import { updateFloorVars, type VarUpdater } from './floorVarWrite';

export { filerState, setAutoFile, type FileLogItem };
export const girlFilerState = filerState;
export const setGirlAutoFile = setAutoFile;

export interface GirlAutoFilerDeps {
  fileOne(d: Dossier, gateway?: ChatBookGatewayLike): Promise<FileDossierReceipt>;
  updateFloorVars(messageId: number, updater: VarUpdater): Promise<void>;
  readChatId(): string | null;
  readSwipeId?(floorId: number): number;
  gateway?: ChatBookGatewayLike;
  now(): Date;
}

export const realGirlAutoFilerDeps: GirlAutoFilerDeps = {
  fileOne: (d, gateway) => fileDossier(d, gateway),
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

/**
 * 纯函数：对本楼 stat_data 施加「限定写」——只移除已入档机娘条目、保留非机娘项（如新势力）与失败项，只 upsert codex 派生索引。
 * 入参不被修改；返回新 stat_data。
 */
export function applyFiledGirlsToStatData(
  statData: Record<string, unknown>,
  filedNames: readonly string[],
  filedGirls: readonly Dossier[],
): Record<string, unknown> {
  const next = { ...statData };
  const filed = new Set(filedNames);
  const pending = Array.isArray(statData.pending_lore) ? (statData.pending_lore as unknown[]) : [];
  next.pending_lore = pending.filter(p => !isGirlDossierEntry(p) || !filed.has(p.name));
  const codex = Array.isArray(statData.codex) ? (structuredClone(statData.codex) as CodexEntry[]) : [];
  for (const d of filedGirls) {
    if (!codex.some(c => c.name === d.name)) {
      codex.push({
        name: d.name,
        kind: '人员',
        desc: `机娘·${d.model || '型号待定'}。完整技能档案见《机娘·能力档案》；剧情条目见《剧情·北坡纪事》。`,
        params: {},
      });
    }
  }
  next.codex = codex;
  return next;
}

export interface GirlRunInput {
  floorId: number | null;
  pending: readonly unknown[];
  txn?: WriteTxn;
}

export interface GirlRunOutcome {
  filed: string[];
  failed: string[];
  wroteVars: boolean;
  skipped?: string;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function pushReceipt(log: FileLogItem): void {
  filerState.receipts.unshift(log);
  filerState.receipts.splice(10);
}

const ROSTER_MAP: Record<string, string> = {
  appended: '已追加',
  'already-present': '已存在',
  'roster-entry-created': '已建花名册并登记',
  'roster-entry-missing': '条目缺失',
};

/** 逐个入档；仅处理满足 isGirlDossierEntry 的机娘项，成功者在 floorId 楼限定写清暂存 + codex，失败者与非机娘项留存 */
export async function fileAllPendingGirls(
  input: GirlRunInput,
  deps: GirlAutoFilerDeps = realGirlAutoFilerDeps,
): Promise<GirlRunOutcome> {
  if (filerState.busy) return { filed: [], failed: [], wroteVars: false, skipped: 'busy' };
  const girlCandidates = (Array.isArray(input.pending) ? input.pending : []).filter(isGirlDossierEntry);
  if (input.floorId === null || girlCandidates.length === 0) {
    return { filed: [], failed: [], wroteVars: false, skipped: 'empty' };
  }
  filerState.busy = true;
  const activeGateway = deps.gateway ?? chatBookGateway;
  const txn: WriteTxn & { boundBook?: string | null } =
    input.txn ?? captureAutoFileTxn(activeGateway, () => deps.readChatId());
  const chatAtStart = txn.chatId || null;
  const pinnedGateway = bindGatewayToTxn(activeGateway, txn, () => deps.readChatId());
  const rawSwipe = deps.readSwipeId ? deps.readSwipeId(input.floorId) : 0;
  const swipeId = typeof rawSwipe === 'number' && Number.isFinite(rawSwipe) ? Math.max(0, Math.trunc(rawSwipe)) : 0;
  const filed: string[] = [];
  const filedGirls: Dossier[] = [];
  const failed: string[] = [];
  try {
    for (const d of [...girlCandidates]) {
      const time = deps.now().toLocaleTimeString();
      const fullDossierName = `档案·${d.name}·${d.model || '能力档案'}`;
      const fullStoryName = `剧情·${d.name}·人格与现状`;
      const legacyDossierName = `档案·${d.name}`;
      const legacyStoryName = `剧情·${d.name}`;
      const snapGateway =
        typeof pinnedGateway.getChatWorldbookName === 'function' ? pinnedGateway : undefined;
      let before: Awaited<ReturnType<typeof snapshotWorldbookEntriesBeforeWrite>> | null = null;
      try {
        before = await snapshotWorldbookEntriesBeforeWrite(
          [fullDossierName, fullStoryName, legacyDossierName, legacyStoryName],
          snapGateway,
        );
      } catch {
        /* 快照采集失败不阻断入档主流程 */
      }
      try {
        const receipt = await deps.fileOne(d, pinnedGateway);
        try {
          if (before) {
            const actualDossierName =
              receipt.dossier?.entryName && receipt.dossier.entryName !== d.name
                ? receipt.dossier.entryName
                : fullDossierName;
            const actualStoryName =
              receipt.story?.entryName && receipt.story.entryName !== d.name
                ? receipt.story.entryName
                : fullStoryName;
            const actualEntryNames = [actualDossierName, actualStoryName];
            if (!before.snapshots.get(actualDossierName)) {
              before.snapshots.set(
                actualDossierName,
                before.snapshots.get(fullDossierName) ?? before.snapshots.get(legacyDossierName) ?? null,
              );
            }
            if (!before.snapshots.get(actualStoryName)) {
              before.snapshots.set(
                actualStoryName,
                before.snapshots.get(fullStoryName) ?? before.snapshots.get(legacyStoryName) ?? null,
              );
            }
            const bookName =
              (receipt as { bookName?: string }).bookName ||
              receipt.dossier?.book ||
              receipt.story?.book ||
              before.bookName;
            let afterSnap: Awaited<ReturnType<typeof snapshotWorldbookEntriesBeforeWrite>> | null = null;
            try {
              afterSnap = await snapshotWorldbookEntriesBeforeWrite(actualEntryNames, snapGateway);
            } catch {
              /* 写后快照采集失败不阻断 */
            }
            const diffParams: Parameters<typeof recordWorldbookMutationsFromDiff>[0] & {
              afterSnapshots?: Map<string, unknown>;
            } = {
              floorId: input.floorId,
              swipeId,
              bookName,
              entryNames: actualEntryNames,
              beforeSnapshots: before.snapshots,
              rosterLineAdded: receipt.story?.rosterAction === 'appended' ? renderRosterLine(d) : undefined,
              ...(afterSnap ? { afterSnapshots: afterSnap.snapshots } : {}),
            };
            recordWorldbookMutationsFromDiff(diffParams);
            if (afterSnap) {
              writeTimelineLedger(draft => {
                const journal =
                  draft.floors[makeFloorKey(input.floorId!)]?.swipes[makeSwipeKey(swipeId)]?.wbJournal;
                if (Array.isArray(journal) && journal.length > 0) {
                  for (const targetName of actualEntryNames) {
                    for (let i = journal.length - 1; i >= 0; i--) {
                      if (journal[i].entryName === targetName) {
                        (journal[i] as unknown as { afterEntry?: unknown }).afterEntry =
                          afterSnap.snapshots.get(targetName) ?? null;
                        break;
                      }
                    }
                  }
                }
              });
            }
          }
        } catch {
          /* wbJournal 记录异常不影响入档主流程 */
        }
        filed.push(d.name);
        filedGirls.push(d);
        pushReceipt({
          time,
          girl: d.name,
          ok: true,
          note: `档案${receipt.dossier.action === 'created' ? '新建' : '更新'} · 人物${receipt.story.action === 'created' ? '新建' : '更新'} · 总览${
            ROSTER_MAP[receipt.story.rosterAction] ?? receipt.story.rosterAction
          }`,
        });
      } catch (e) {
        failed.push(d.name);
        const note = errText(e);
        pushReceipt({ time, girl: d.name, ok: false, note });
        const isGuard = e instanceof GuardError || (e as { name?: string })?.name === 'GuardError';
        recordFlightLog({
          category: 'auto_filer',
          status: isGuard ? 'blocked' : 'error',
          chatId: chatAtStart,
          floorId: input.floorId,
          swipeId,
          title: isGuard ? `机娘自动入档守卫拦截 (${d.name})` : `机娘自动入档失败 (${d.name})`,
          detail: note,
        });
      }
    }
    if (filed.length === 0) return { filed, failed, wroteVars: false };

    // 限定写前复核：聊天与绑定书未漂移（否则 floorId 属于别的聊天，fail-closed 不写变量）
    const currentBound =
      typeof activeGateway.getChatWorldbookName === 'function'
        ? activeGateway.getChatWorldbookName('current')
        : txn.boundBook;
    if (
      chatAtStart === null ||
      deps.readChatId() !== chatAtStart ||
      (txn.boundBook && currentBound !== undefined && currentBound !== txn.boundBook)
    ) {
      const note = '聊天已切换，暂存清理中止（条目已入书，下轮按名 upsert 幂等）';
      pushReceipt({
        time: deps.now().toLocaleTimeString(),
        girl: filed.join('、'),
        ok: false,
        note,
      });
      recordFlightLog({
        category: 'auto_filer',
        status: 'blocked',
        chatId: chatAtStart,
        floorId: input.floorId,
        swipeId,
        title: '机娘自动入档写前复核拦截',
        detail: `${filed.join('、')}：${note}`,
      });
      return { filed, failed, wroteVars: false };
    }
    const floorId = input.floorId;
    await deps.updateFloorVars(floorId, vars => {
      const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
      return { ...vars, stat_data: applyFiledGirlsToStatData(sd, filed, filedGirls) };
    });
    recordFlightLog({
      category: 'auto_filer',
      status: failed.length > 0 ? 'warn' : 'ok',
      chatId: chatAtStart,
      floorId: input.floorId,
      swipeId,
      title: `机娘自动入档完成 (${filed.length} 项)`,
      detail: `入档=[${filed.join('、')}]${failed.length > 0 ? ` · 失败=[${failed.join('、')}]` : ''}`,
    });
    return { filed, failed, wroteVars: true };
  } finally {
    filerState.busy = false;
  }
}

export interface FloatingLike {
  snapshot: { pending_lore?: unknown[] } | null;
  floorId: number | null;
  refresh(): Promise<unknown>;
  onRefresh(cb: () => void): () => void;
}

/** 从 floating store 当前快照触发一次入档，写后刷新 */
export async function runGirlFromFloating(
  floating: FloatingLike,
  deps: GirlAutoFilerDeps = realGirlAutoFilerDeps,
  txn?: WriteTxn,
) {
  const activeGateway = deps.gateway ?? chatBookGateway;
  const capturedTxn = txn ?? captureAutoFileTxn(activeGateway, () => deps.readChatId());
  const outcome = await fileAllPendingGirls(
    { floorId: floating.floorId, pending: floating.snapshot?.pending_lore ?? [], txn: capturedTxn },
    deps,
  );
  if (outcome.wroteVars) await floating.refresh();
  return outcome;
}

export const runGirlAutoFilerFromFloating = runGirlFromFloating;

/**
 * 安装自动入档观察者（中控台唯一安装点：中控 index.ts init）。
 * 每次 floating 刷新后若开关开、有机娘暂存且不忙 → 入档。失败不主动重刷，避免失败循环；下次生成/切换自然重试。
 */
export function installGirlAutoFiler(
  floating: FloatingLike,
  deps: GirlAutoFilerDeps = realGirlAutoFilerDeps,
): () => void {
  let queued = false;
  return floating.onRefresh(() => {
    if (!filerState.auto || filerState.busy || queued) return;
    const pendingSnapshot = floating.snapshot?.pending_lore;
    if (!pendingSnapshot?.some(isGirlDossierEntry)) return;
    const floorIdSnapshot = floating.floorId;
    const activeGateway = deps.gateway ?? chatBookGateway;
    const entryTxn = captureAutoFileTxn(activeGateway, () => deps.readChatId());
    queued = true;
    void enqueueAutoFileTask(async () => {
      try {
        if (!filerState.auto || filerState.busy) return;
        const outcome = await fileAllPendingGirls(
          { floorId: floorIdSnapshot, pending: pendingSnapshot, txn: entryTxn },
          deps,
        );
        if (outcome.wroteVars) await floating.refresh();
      } finally {
        queued = false;
      }
    }).catch(e => console.warn('[girlAutoFiler] 自动入档异常', e));
  });
}
