/**
 * pendingLoreGate.ts —— 外部世界书落地暂存门（EVT-STAGE-01）
 *
 * 真源：《事件系统与资金链状态机总设计案》§4.1（变量作用域隔离铁律）、
 *       §4.2（外部世界书落地的"延迟确认门"）＋决策 Q4（暂存隔离＋确认门后入书）；
 *       《MVP 任务包》§3.5·§6。
 *
 * 三重防线：
 * 1. 暂存隔离（Stage First）：解析产生的新实体只写当前 Message 槽位
 *    `stat_data.pending_lore`（z.array(z.any())，EVT-SCHEMA-01 交付）；
 *    楼层解析/Swipe 期间**绝不调用世界书写入 API**（本模块零宿主导入，
 *    写入只经调用方注入的 writer，纯函数可全量 spy 验证）；
 * 2. 切页天然隔离：暂存条目锚定 source_floor/source_swipe，数据物理驻留单楼
 *    Message 槽——用户换 Swipe 即随槽位消亡（pendingLoreAfterSwipe 直证语义），
 *    100% 杜绝幽灵条目污染世界书（Q4）；
 * 3. 入档门控双途径（Filing Triggers）：
 *    - 途径 A 显式确认：commitPendingLoreToWorldbook（中控"战备态势审核台"【确认入册】）；
 *    - 途径 B 时空锚定：commitPendingLoreOnAdvance（玩家在当前 Swipe 发送新指令、
 *      确认进入下一楼时，本楼暂存项批量原子入档）。
 *
 * 原子性（all-or-nothing）：先校验选中项齐全（缺 id → 零写入零移除）→ 顺序写入全部
 * 选中项 → 全部成功才整批移除；任一写入抛错 → fail-closed：暂存列表原样保全，
 * 绝不出现「已移除但未写入」的丢失态（写入但未移除的重复风险由 writer 幂等兜底，
 * 属注入方契约，本门 fail-closed 保证不丢数据）。
 *
 * 铁律：纯函数核＋副作用落地层（仿 worldbookDataFiler 形制）；不原地修改入参；
 * 生产端 writer 绑线（tav / updateWorldbookWith）属前端接线任务，本模块只定义接缝。
 */
import { isGirlDossierEntry, type Dossier } from './girlFiler';
import { recordFlightLog } from '../debug/dataFlowTracer';
import { canon } from '../parse/parsePipeline';
import { tav } from '../parse/systemCheck';

/* ═══════════════ 类型 ═══════════════ */

/** 暂存实体类别（对齐 CodexEntry.kind 的动态注册口径；非法值降级'其他'） */
export type PendingLoreKind =
  | '势力'
  | '科技'
  | '建筑'
  | '载具'
  | '人员'
  | '人物'
  | '装备'
  | '地点'
  | '阵营'
  | '单位'
  | '其他';

const KINDS: readonly PendingLoreKind[] = [
  '势力',
  '科技',
  '建筑',
  '载具',
  '人员',
  '人物',
  '装备',
  '地点',
  '阵营',
  '单位',
  '其他',
];

/** 暂存条目（时空锚定：楼层＋Swipe 双键） */
export interface PendingLoreEntry {
  /** 去重键：canon(名称) 派生 */
  id: string;
  kind: PendingLoreKind;
  name: string;
  /** 索引级摘要（完整设定在世界书，延迟提交机制） */
  summary: string;
  /** 来源楼层（Message 槽位号） */
  source_floor: number;
  /** 来源 Swipe 分支号 */
  source_swipe: number;
  created_day: number;
  /** 原始声明载荷留痕（审计回溯用） */
  raw?: unknown;
}

/** 暂存输入（解析层产出；宽松字段） */
export interface PendingLoreInput {
  name: string;
  kind?: string;
  summary?: string;
  raw?: unknown;
}

/** 时空锚（staging 时的楼层/分支/天数事实） */
export interface StageContext {
  floor: number;
  swipe: number;
  day: number;
}

/** 世界书写入接缝（途径 A/B 共用；生产端由前端注入真 API，测试注入 spy） */
export type WorldbookWriter = (entry: PendingLoreEntry) => void | Promise<void>;

/** 入档结果（原子语义产物） */
export interface LoreCommitResult {
  /** 提交后的暂存列表（失败时＝原样保全） */
  pendingLore: PendingLoreEntry[];
  /** 成功落地的条目（失败时恒空） */
  committed: PendingLoreEntry[];
  ok: boolean;
  /** 失败原因（ok=false 时给出） */
  error?: string;
}

/* ═══════════════ 归一化（z.any() 容错读回） ═══════════════ */

function normalizeKind(kind: unknown): PendingLoreKind {
  if (typeof kind === 'string') {
    const hit = KINDS.find(k => canon(k) === canon(kind));
    if (hit) return hit;
  }
  return '其他';
}

/** 暂存去重键（canon 派生：繁简/空白/大小写归一） */
export function pendingLoreIdOf(name: string): string {
  return `lore_${canon(name)}`;
}

/**
 * 提取必须原样保留在 stat_data.pending_lore 中的未入档机娘条目（isGirlDossierEntry 或无 id 的机娘草稿），
 * 严禁在确认或驳回新势力时将未入档机娘当残渣清空。
 */
function extractPreservedGirls(pending: readonly unknown[]): Dossier[] {
  return pending.filter((item): item is Dossier => {
    if (isGirlDossierEntry(item)) return true;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
    const rec = item as Record<string, unknown>;
    if (typeof rec.name !== 'string' || rec.name.trim() === '') return false;
    if (rec.kind === '势力') return false;
    return typeof rec.id !== 'string' || rec.id.length === 0;
  });
}

/** 宽容读回：从 z.array(z.any()) 槽位过滤出合法形态的新势力/实体暂存条目（跳过机娘档案与非法残渣） */
export function readPendingLore(pending: readonly unknown[]): PendingLoreEntry[] {
  const out: PendingLoreEntry[] = [];
  for (const item of pending) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    if (isGirlDossierEntry(item)) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.name !== 'string' || rec.name.trim() === '') continue;
    if (typeof rec.id !== 'string' || rec.id.length === 0) continue;
    out.push({
      id: rec.id,
      kind: normalizeKind(rec.kind),
      name: rec.name,
      summary: typeof rec.summary === 'string' ? rec.summary : '',
      source_floor: Number.isFinite(rec.source_floor) ? (rec.source_floor as number) : -1,
      source_swipe: Number.isFinite(rec.source_swipe) ? (rec.source_swipe as number) : -1,
      created_day: Number.isFinite(rec.created_day) ? (rec.created_day as number) : 0,
      raw: rec.raw,
    });
  }
  return out;
}

/* ═══════════════ 防线①：暂存隔离（纯函数，零世界书调用） ═══════════════ */

export interface StageResult {
  /** 新暂存列表（旧条目原序保留＋新增追加；新数组，入参零突变） */
  pendingLore: PendingLoreEntry[];
  /** 本次实际入暂存的条目 */
  added: PendingLoreEntry[];
  /** 被拒条目（重名/空名）与原因 */
  skipped: Array<{ name: string; reason: '重名去重' | '空名拒绝' }>;
}

/**
 * 新实体入暂存：只写 Message 槽位数组，绝不触碰世界书 API（Q4）。
 * - canon 去重：与既有暂存同名（繁简/空白归一后）→ 拒绝追加（skipped）；
 * - 时空锚定：每条记录 source_floor/source_swipe（Swipe 隔离与途径 B 批量落盘的锚）。
 */
export function stagePendingLore(
  pending: readonly unknown[],
  inputs: readonly PendingLoreInput[],
  ctx: StageContext,
): StageResult {
  const preservedGirls = extractPreservedGirls(pending);
  const existing = readPendingLore(pending);
  const seen = new Set(existing.map(e => e.id));
  const added: PendingLoreEntry[] = [];
  const skipped: StageResult['skipped'] = [];

  for (const input of inputs) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name === '') {
      skipped.push({ name: String(input.name), reason: '空名拒绝' });
      continue;
    }
    const id = pendingLoreIdOf(name);
    if (seen.has(id)) {
      skipped.push({ name, reason: '重名去重' });
      continue;
    }
    seen.add(id);
    added.push({
      id,
      kind: normalizeKind(input.kind),
      name,
      summary: typeof input.summary === 'string' ? input.summary : '',
      source_floor: ctx.floor,
      source_swipe: ctx.swipe,
      created_day: ctx.day,
      raw: input.raw,
    });
  }
  return {
    pendingLore: [...(preservedGirls as unknown as PendingLoreEntry[]), ...existing, ...added],
    added,
    skipped,
  };
}

/* ═══════════════ 防线②：切页天然隔离直证 ═══════════════ */

/**
 * Swipe 换槽语义直证：新分支的暂存视图＝基线（该分支上一楼/生成前）重算，
 * 旧分支 stage 进槽位的条目物理不在此槽 → 自动作废。
 * 本门零 Chat 级状态：暂存只存在于 Message 槽，换槽即换真源（§4.1 铁律），
 * 旧分支条目永远不会借本函数渗入新分支或世界书。
 */
export function pendingLoreAfterSwipe(basePending: readonly unknown[]): PendingLoreEntry[] {
  return readPendingLore(basePending);
}

/* ═══════════════ 防线③：入档门控（原子 all-or-nothing） ═══════════════ */

export interface CommitOptions {
  /** 世界书写入接缝（必填；显式注入＝可测＋生产可绑线） */
  write: WorldbookWriter;
}

export interface PickOptions extends CommitOptions {
  /** 选中入档条目 id；缺省/'all'＝全部（途径 B 时空锚定批量） */
  ids?: readonly string[] | 'all';
}

function readHostFloorSwipeSnapshot(anchorFloor?: number): { floorId: number | null; swipeId: number | null } {
  const glmi = tav<() => number>('getLastMessageId');
  const gcm = tav<(id: number) => Array<{ swipe_id?: number }>>('getChatMessages');
  let floorId: number | null = null;
  if (glmi) {
    try {
      const last = glmi();
      if (typeof last === 'number' && Number.isFinite(last) && last >= 0) floorId = last;
    } catch {
      floorId = null;
    }
  }
  const targetFloor = typeof anchorFloor === 'number' && Number.isFinite(anchorFloor) && anchorFloor >= 0 ? anchorFloor : floorId;
  let swipeId: number | null = null;
  if (targetFloor !== null && gcm) {
    try {
      const sid = gcm(targetFloor)?.[0]?.swipe_id;
      if (typeof sid === 'number' && Number.isFinite(sid)) swipeId = Math.max(0, Math.trunc(sid));
    } catch {
      swipeId = null;
    }
  }
  return { floorId, swipeId };
}

/**
 * 核心入档（私有语义，公开面走途径 A/B 包装）：
 * 1. 预检：选中 id 必须全部在暂存中（缺一 → 零写入零移除，ok=false）；
 * 2. 顺序写入全部选中项（任一抛错或写中宿主楼层/Swipe 漂移 → fail-closed：committed 恒空、列表原样保全）；
 * 3. 全部成功 → 一次性整批移除选中项（新数组返回，入参零突变）。
 */
async function commitLore(
  pending: readonly unknown[],
  write: WorldbookWriter,
  ids: readonly string[] | 'all',
): Promise<LoreCommitResult> {
  const preservedGirls = extractPreservedGirls(pending);
  const entries = readPendingLore(pending);
  const allPreserved = [...(preservedGirls as unknown as PendingLoreEntry[]), ...entries];
  const picked =
    ids === 'all'
      ? entries
      : ids.map(id => entries.find(e => e.id === id)).filter((e): e is PendingLoreEntry => e !== undefined);
  const missing = ids === 'all' ? [] : ids.filter(id => !entries.some(e => e.id === id));

  if (missing.length > 0) {
    const error = `选中条目不在暂存区：${missing.join('、')}`;
    recordFlightLog({
      category: 'auto_filer',
      status: 'warn',
      chatId: null,
      floorId: null,
      swipeId: null,
      title: '新设定入档预检拦截',
      detail: error,
    });
    return { pendingLore: allPreserved, committed: [], ok: false, error };
  }
  if (picked.length === 0) {
    return { pendingLore: allPreserved, committed: [], ok: true };
  }
  try {
    for (const entry of picked) {
      const snapBefore = readHostFloorSwipeSnapshot(entry.source_floor);
      await write(entry); // 顺序原子写
      const snapAfter = readHostFloorSwipeSnapshot(entry.source_floor);
      if (
        (snapBefore.floorId !== null && snapAfter.floorId !== snapBefore.floorId) ||
        (snapBefore.swipeId !== null && snapAfter.swipeId !== snapBefore.swipeId)
      ) {
        const error = '写入期间宿主楼层或 Swipe 已切换，拒绝核销暂存（fail-closed）';
        recordFlightLog({
          category: 'auto_filer',
          status: 'blocked',
          chatId: null,
          floorId: snapAfter.floorId ?? entry.source_floor,
          swipeId: snapAfter.swipeId ?? entry.source_swipe,
          title: '新设定入档守卫拦截 (楼层/Swipe漂移)',
          detail: `${entry.name}: ${error}`,
        });
        return {
          pendingLore: allPreserved,
          committed: [],
          ok: false,
          error,
        };
      }
    }
  } catch (e) {
    const error = `世界书写入失败，整批保全暂存（fail-closed）：${e instanceof Error ? e.message : String(e)}`;
    const isGuard = (e as { name?: string })?.name === 'GuardError';
    recordFlightLog({
      category: 'auto_filer',
      status: isGuard ? 'blocked' : 'error',
      chatId: null,
      floorId: picked[0]?.source_floor ?? null,
      swipeId: picked[0]?.source_swipe ?? null,
      title: isGuard ? '新设定入档守卫拦截' : '新设定入档写入失败',
      detail: error,
    });
    return {
      pendingLore: allPreserved,
      committed: [],
      ok: false,
      error,
    };
  }
  const doneIds = new Set(picked.map(e => e.id));
  const remaining = [
    ...(preservedGirls as unknown as PendingLoreEntry[]),
    ...entries.filter(e => !doneIds.has(e.id)),
  ];
  recordFlightLog({
    category: 'auto_filer',
    status: 'ok',
    chatId: null,
    floorId: picked[0]?.source_floor ?? null,
    swipeId: picked[0]?.source_swipe ?? null,
    title: `新设定入档完成 (${picked.length} 项)`,
    detail: `入档=[${picked.map(e => e.name).join('、')}]`,
  });
  return { pendingLore: remaining, committed: picked, ok: true };
}

/** 途径 A · 显式确认入册（中控"战备态势审核台" / 战术 PDA【采纳落地】按钮触发） */
export async function commitPendingLoreToWorldbook(
  pending: readonly unknown[],
  opts: PickOptions,
): Promise<LoreCommitResult> {
  return commitLore(pending, opts.write, opts.ids ?? 'all');
}

/** 途径 B · 时空锚定批量落盘（玩家发送新指令确认进入下一楼时触发） */
export async function commitPendingLoreOnAdvance(
  pending: readonly unknown[],
  opts: CommitOptions,
): Promise<LoreCommitResult> {
  return commitLore(pending, opts.write, 'all');
}

export interface ConfirmPendingLoreOptions {
  ids?: readonly string[] | 'all';
  write?: WorldbookWriter;
}

/**
 * 确认并提交待核准新势力/实体暂存项：必须提供真实 writer，失败时保留原始暂存。
 * 计算写回 stat_data.pending_lore 的 remaining 数组时，原样保留所有无 id 的未入档机娘（isGirlDossierEntry）。
 */
export async function confirmAndCommitPendingLore(
  pending: readonly unknown[],
  opts: ConfirmPendingLoreOptions = {},
): Promise<Omit<LoreCommitResult, 'pendingLore'> & { pendingLore: readonly unknown[]; remaining: readonly unknown[] }> {
  if (typeof opts.write !== 'function') {
    const error = '未提供世界书写入器，暂存未入档';
    recordFlightLog({
      category: 'auto_filer',
      status: 'error',
      chatId: null,
      floorId: null,
      swipeId: null,
      title: '新设定入档缺失写入器',
      detail: error,
    });
    return { ok: false, committed: [], pendingLore: pending, remaining: pending, error };
  }
  const res = await commitLore(pending, opts.write, opts.ids ?? 'all');
  const remaining = res.ok ? res.pendingLore : pending;
  return { ...res, pendingLore: remaining, remaining };
}

/**
 * 忽略/驳回待确认新势力暂存项：仅移除指定 id 的暂存实体，原样保留所有未入档机娘（isGirlDossierEntry 或无 id 机娘草稿）。
 */
export function dismissPendingLore(
  pending: readonly unknown[],
  ids: readonly string[] | 'all',
): { pendingLore: PendingLoreEntry[]; remaining: unknown[]; dismissed: PendingLoreEntry[] } {
  const preservedGirls = extractPreservedGirls(pending);
  const entries = readPendingLore(pending);
  const dropSet = ids === 'all' ? new Set(entries.map(e => e.id)) : new Set(ids);
  const dismissed = entries.filter(e => dropSet.has(e.id));
  const kept = entries.filter(e => !dropSet.has(e.id));
  const remaining = [...preservedGirls, ...kept];
  return {
    pendingLore: remaining as unknown as PendingLoreEntry[],
    remaining,
    dismissed,
  };
}
