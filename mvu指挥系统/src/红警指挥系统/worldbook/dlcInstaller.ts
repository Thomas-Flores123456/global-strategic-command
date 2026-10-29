/**
 * DLC 安装器（DLC设计.md §7 流水线，批3）
 * 解析 → 预检（R1-R12 包侧版本）→ 确认门（UI 层）→ 执行 → 回执 / 卸载回滚。
 * 全部酒馆 API 经 tav() 获取；独立预览可走到预检为止，执行步骤抛错由 UI 拦截。
 *
 * 双源同一事务：写世界书 + 绑定 + codex 种子（经 store 双向同步）+ $dlc 注册表
 * 在 install() 单流程内完成；卸载按 $dlc registry 精确回滚（书/绑定/种子/takeover 备份）。
 */
import { tav } from '../parse/systemCheck';
import type { DlcOverlay } from '../core/catalogEffective';
import {
  CORE_VERSION,
  isPlainRecord,
  need,
  parseDlcRegistry,
  parseManifest,
  precheckManifest,
  renderDataCardEntry,
  validateManifestShape,
  validName,
  wrapDataCardAsRawEntry,
  type DlcCodexSeed,
  type DlcManifest,
  type DlcWorldbook,
  type RawWorldbookEntry,
  type RegisteredBookAsset,
  type RegisteredDlc,
} from './dlcManifestHelpers';

export {
  CORE_VERSION,
  parseManifest,
  precheckManifest,
  renderDataCardEntry,
  validateManifestShape,
  type DlcCodexSeed,
  type DlcManifest,
  type DlcWorldbook,
  type RawWorldbookEntry,
};

/* ═══════════════ 安装 ═══════════════ */

export interface InstallReceipt {
  books: string[];
  takeoverCount: number;
  codexSeeds: string[];
}

/** DLC 执行期需要可逆的 codex 写接口；旧函数回调仅兼容没有 codex 种子的包。 */
export interface DlcCodexTransaction {
  read(): DlcCodexSeed[];
  write(items: DlcCodexSeed[]): void | Promise<void>;
}

type DlcCodexWriter = DlcCodexTransaction | ((seeds: DlcCodexSeed[]) => void);
type DlcCodexRemover = DlcCodexTransaction | ((names: string[]) => void);

interface UndoStep {
  label: string;
  run: () => Promise<void>;
}

async function rollbackSteps(steps: UndoStep[]): Promise<string[]> {
  const errors: string[] = [];
  for (const step of [...steps].reverse()) {
    try {
      await step.run();
    } catch (error) {
      errors.push(`${step.label}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}

function transactionError(action: string, cause: unknown, rollbackErrors: string[]): Error {
  const original = cause instanceof Error ? cause.message : String(cause);
  const suffix = rollbackErrors.length
    ? `；补偿未完全通过：${rollbackErrors.join('；')}（已停止继续覆盖，请人工检查）`
    : '；已按指纹完成补偿';
  return new Error(`${action}失败：${original}${suffix}`, { cause });
}

function isCodexTransaction(writer: DlcCodexWriter | DlcCodexRemover): writer is DlcCodexTransaction {
  return (
    typeof writer === 'object' &&
    writer !== null &&
    typeof writer.read === 'function' &&
    typeof writer.write === 'function'
  );
}

function sameCharBooks(
  left: { primary: string | null; additional: string[] },
  right: { primary: string | null; additional: string[] },
): boolean {
  return left.primary === right.primary && canonicalJson(left.additional) === canonicalJson(right.additional);
}

async function setCharBooksTransactional(
  next: { primary: string | null; additional: string[] },
  getCharBooks: (character: string) => { primary: string | null; additional: string[] },
  rebindChar: (character: string, books: { primary: string | null; additional: string[] }) => Promise<void>,
  undoSteps: UndoStep[],
): Promise<void> {
  const before = structuredClone(getCharBooks('current'));
  if (sameCharBooks(before, next)) return;
  undoSteps.push({
    label: '恢复角色卡世界书绑定',
    run: async () => {
      const current = structuredClone(getCharBooks('current'));
      if (sameCharBooks(current, before)) return;
      if (!sameCharBooks(current, next)) throw new Error('角色卡世界书绑定已出现并发变化');
      await rebindChar('current', before);
      if (!sameCharBooks(structuredClone(getCharBooks('current')), before))
        throw new Error('角色卡世界书绑定恢复未获确认');
    },
  });
  await rebindChar('current', next);
  if (!sameCharBooks(structuredClone(getCharBooks('current')), next)) throw new Error('角色卡世界书绑定写入未获确认');
}

async function setCodexTransactional(
  transaction: DlcCodexTransaction,
  next: DlcCodexSeed[],
  undoSteps: UndoStep[],
): Promise<void> {
  const before = structuredClone(transaction.read());
  if (canonicalJson(before) === canonicalJson(next)) return;
  undoSteps.push({
    label: '恢复 codex',
    run: async () => {
      const current = structuredClone(transaction.read());
      if (canonicalJson(current) === canonicalJson(before)) return;
      if (canonicalJson(current) !== canonicalJson(next)) throw new Error('codex 已出现并发变化');
      await transaction.write(structuredClone(before));
      if (canonicalJson(transaction.read()) !== canonicalJson(before)) throw new Error('codex 恢复未获确认');
    },
  });
  await transaction.write(structuredClone(next));
  if (canonicalJson(transaction.read()) !== canonicalJson(next)) throw new Error('codex 写入未获确认');
}

async function setRegistryTransactional(
  expectedBefore: unknown,
  next: unknown,
  getVariables: (options: { type: string }) => Record<string, unknown>,
  updateVariables: (
    updater: (variables: Record<string, unknown>) => Record<string, unknown>,
    options: { type: string },
  ) => unknown,
  undoSteps: UndoStep[],
): Promise<void> {
  if (canonicalJson(getVariables({ type: 'chat' }).$dlc) !== canonicalJson(expectedBefore)) {
    throw new Error('DLC 注册表在写入前发生变化');
  }
  undoSteps.push({
    label: '恢复 DLC 注册表',
    run: async () => {
      const current = getVariables({ type: 'chat' }).$dlc;
      if (canonicalJson(current) === canonicalJson(expectedBefore)) return;
      if (canonicalJson(current) !== canonicalJson(next)) throw new Error('DLC 注册表已出现并发变化');
      await updateVariables(
        variables => {
          if (expectedBefore === undefined) delete variables.$dlc;
          else variables.$dlc = structuredClone(expectedBefore);
          return variables;
        },
        { type: 'chat' },
      );
      if (canonicalJson(getVariables({ type: 'chat' }).$dlc) !== canonicalJson(expectedBefore)) {
        throw new Error('DLC 注册表恢复未获确认');
      }
    },
  });
  await updateVariables(
    variables => {
      if (next === undefined) delete variables.$dlc;
      else variables.$dlc = structuredClone(next);
      return variables;
    },
    { type: 'chat' },
  );
  if (canonicalJson(getVariables({ type: 'chat' }).$dlc) !== canonicalJson(next)) {
    throw new Error('DLC 注册表写入未获确认');
  }
}


type WorldbookProbe =
  | { status: 'absent'; name: string }
  | { status: 'found'; name: string; raw: { entries: Record<string, unknown> }; fingerprint: string }
  | { status: 'unreadable'; name: string; reason: string };

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function sha256(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('宿主缺少 Web Crypto，无法核验 DLC 世界书资产指纹');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 绕开 Helper 的 world_names 缓存，直接读取目标 SillyTavern 1.18.0 后端 `/api/worldinfo/list|get`。
 * list 能区分 absent；任何网络、权限、形状或读取异常都归 unreadable，绝不猜成“不存在”。
 */
async function probeWorldbook(name: string): Promise<WorldbookProbe> {
  const context = (
    globalThis as unknown as {
      SillyTavern?: { getRequestHeaders?: () => Record<string, string> };
    }
  ).SillyTavern;
  if (!context || typeof context.getRequestHeaders !== 'function' || typeof globalThis.fetch !== 'function') {
    return { status: 'unreadable', name, reason: '宿主实时世界书读取接口不可用' };
  }
  try {
    const headers = context.getRequestHeaders();
    const sanitizeResponse = await globalThis.fetch('/api/files/sanitize-filename', {
      method: 'POST',
      headers,
      body: JSON.stringify({ fileName: name }),
    });
    if (!sanitizeResponse.ok) {
      return { status: 'unreadable', name, reason: `世界书名清洗失败（HTTP ${sanitizeResponse.status}）` };
    }
    const sanitized = (await sanitizeResponse.json()) as unknown;
    if (!isPlainRecord(sanitized) || sanitized.fileName !== name) {
      return { status: 'unreadable', name, reason: '世界书名含宿主会改写的非法文件字符' };
    }
    const readNames = async (): Promise<Set<string>> => {
      const response = await globalThis.fetch('/api/worldinfo/list', {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(`世界书清单读取失败（HTTP ${response.status}）`);
      const list = (await response.json()) as unknown;
      if (!Array.isArray(list) || !list.every(item => isPlainRecord(item) && validName(item.file_id))) {
        throw new Error('世界书清单响应形状非法');
      }
      const names = list.map(item => item.file_id as string);
      const foldedCollision = names.find(
        candidate => candidate.toLocaleLowerCase() === name.toLocaleLowerCase() && candidate !== name,
      );
      if (foldedCollision) throw new Error(`世界书名与现有《${foldedCollision}》仅大小写不同，无法安全区分`);
      return new Set(names);
    };
    const namesBefore = await readNames();
    const getResponse = await globalThis.fetch('/api/worldinfo/get', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name }),
    });
    if (!getResponse.ok) return { status: 'unreadable', name, reason: `世界书读取失败（HTTP ${getResponse.status}）` };
    const raw = (await getResponse.json()) as unknown;
    if (!isPlainRecord(raw) || !isPlainRecord(raw.entries)) {
      return { status: 'unreadable', name, reason: '世界书响应缺少 entries 对象' };
    }
    const namesAfter = await readNames();
    const listedBefore = namesBefore.has(name);
    const listedAfter = namesAfter.has(name);
    if (listedBefore !== listedAfter) {
      return { status: 'unreadable', name, reason: '世界书清单在读取期间变化，无法确认存在性' };
    }
    const book = raw as { entries: Record<string, unknown> };
    if (listedBefore) return { status: 'found', name, raw: book, fingerprint: await sha256(book) };
    if (Object.keys(book.entries).length > 0) {
      return { status: 'unreadable', name, reason: '世界书未进入实时清单但读取到了内容，可能存在逐文件读取故障' };
    }
    return { status: 'absent', name };
  } catch (error) {
    return {
      status: 'unreadable',
      name,
      reason: `世界书读取异常：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function sameProbe(left: WorldbookProbe, right: WorldbookProbe): boolean {
  if (left.status !== right.status || left.name !== right.name) return false;
  if (left.status === 'found' && right.status === 'found') return left.fingerprint === right.fingerprint;
  return left.status === 'absent' && right.status === 'absent';
}

function importResultOk(result: unknown): boolean {
  if (typeof result === 'boolean') return result;
  if (typeof result !== 'object' || result === null || !('ok' in result)) return false;
  return (result as { ok?: unknown }).ok === true;
}

/**
 * 基于刚读取的后端 raw 快照整书直写。
 * 实际写入复用 Helper 的完整书体导入以同步 ST worldInfoCache，但最终成败只认后端读回指纹；
 * Helper 的 boolean / Response 返回值都不被当作持久化成功的充分证据。
 */
async function saveProbedWorldbook(
  name: string,
  expected: WorldbookProbe,
  raw: { entries: Record<string, unknown> },
): Promise<Extract<WorldbookProbe, { status: 'found' }>> {
  if (expected.status !== 'found') throw new Error(`《${name}》缺少可写入的 found 快照`);
  const asset = await importRawBookRegistered(name, JSON.stringify(raw), expected);
  const after = await probeWorldbook(name);
  if (after.status !== 'found' || after.fingerprint !== asset.fingerprint) {
    throw new Error(`《${name}》写入后指纹复核失败，请人工检查`);
  }
  return after;
}

async function deleteProbedWorldbook(
  name: string,
  expected: Extract<WorldbookProbe, { status: 'found' }>,
): Promise<Extract<WorldbookProbe, { status: 'absent' }>> {
  const latest = await probeWorldbook(name);
  if (!sameProbe(expected, latest)) throw new Error(`《${name}》在删除前发生变化或不可读`);
  const deleteWorldbook = need<(bookName: string) => Promise<boolean>>('deleteWorldbook');
  const refreshWorldbookList = (
    globalThis as unknown as { SillyTavern?: { updateWorldInfoList?: () => Promise<void> } }
  ).SillyTavern?.updateWorldInfoList;
  if (typeof refreshWorldbookList !== 'function') {
    throw new Error('宿主 updateWorldInfoList 不可用，不能安全删除世界书');
  }
  try {
    const deleted = await deleteWorldbook(name);
    await refreshWorldbookList();
    const after = await probeWorldbook(name);
    if (!deleted || after.status !== 'absent') throw new Error(`《${name}》删除后仍存在或无法确认`);
    return after;
  } catch (error) {
    const afterFailure = await probeWorldbook(name);
    if (sameProbe(expected, afterFailure)) throw new Error(`《${name}》删除失败，原书未变化`, { cause: error });
    if (afterFailure.status === 'absent') {
      await importRawBookRegistered(name, JSON.stringify(expected.raw), afterFailure);
      const restored = await probeWorldbook(name);
      if (!sameProbe(expected, restored)) {
        throw new Error(`《${name}》删除失败且原书恢复未通过指纹核验，请立即人工检查`, { cause: error });
      }
      throw new Error(`《${name}》删除失败，已恢复原书`, { cause: error });
    }
    throw new Error(`《${name}》删除失败后出现第三方内容变化或不可读，未自动覆盖，请人工检查`, { cause: error });
  }
}

async function restoreWorldbookProbe(
  name: string,
  before: WorldbookProbe,
  expectedCurrent: WorldbookProbe,
): Promise<void> {
  const current = await probeWorldbook(name);
  if (!sameProbe(expectedCurrent, current)) throw new Error(`《${name}》补偿前已出现并发变化`);
  if (before.status === 'unreadable') throw new Error(`《${name}》原快照不可读，不能自动补偿`);
  if (before.status === 'found') {
    await importRawBookRegistered(name, JSON.stringify(before.raw), current);
    return;
  }
  if (current.status !== 'found') {
    if (current.status === 'absent') return;
    throw new Error(`《${name}》当前书体不可读`);
  }
  await deleteProbedWorldbook(name, current);
}

/* ── 裸世界书直接导入（万能导入口第二通道）──
 * 手上只有 ST 原生导出的 xx_世界书.json 时，无需包装成 DLC manifest，
 * 嗅探到裸 entries 结构即走此通道批量 importRawWorldbook。
 * 注意：importRawWorldbook 是替换语义——同名书会被整本覆盖（也因此可用作“本地改完重拖=更新推送”）。
 */

/** 嗅探文本是否为 ST 原生世界书导出体：有 entries 对象且无 dlc 元数据块 */
export function sniffRawWorldbook(text: string): { entries: Record<string, RawWorldbookEntry> } | null {
  try {
    const j = JSON.parse(text) as { dlc?: unknown; entries?: unknown };
    if (
      j &&
      typeof j === 'object' &&
      !j.dlc &&
      j.entries &&
      typeof j.entries === 'object' &&
      !Array.isArray(j.entries)
    ) {
      return j as { entries: Record<string, RawWorldbookEntry> };
    }
  } catch {
    /* 非 JSON，交给 manifest 通道报错 */
  }
  return null;
}

/** 文件名 → 书名：去 .json 与 _世界书 后缀（与 R10 对账正则兼容） */
export function bookNameFromFile(fileName: string): string {
  return fileName.replace(/\.json$/i, '').replace(/_世界书$/, '');
}

export interface RawBookItem {
  name: string;
  json: string;
  entryCount: number;
}

/** 绕开 Helper 缓存的存在性探测；不可读不是“不存在”。 */
export async function bookExists(name: string): Promise<boolean> {
  const probe = await probeWorldbook(name);
  if (probe.status === 'unreadable') throw new Error(probe.reason);
  return probe.status === 'found';
}

/**
 * 直接导入完整书体并返回资产指纹。
 * 禁止先调用 createOrReplaceWorldbook(name, [])：该 Helper 依赖可能陈旧的 world_names，存在先清空后报错窗口。
 */
async function importRawBookRegistered(
  name: string,
  json: string,
  expectedBefore?: WorldbookProbe,
): Promise<RegisteredBookAsset> {
  const importRaw = need<(n: string, json: string) => Promise<boolean | Response>>('importRawWorldbook');
  const deleteWorldbook = need<(n: string) => Promise<boolean>>('deleteWorldbook');
  const refreshWorldbookList = (
    globalThis as unknown as { SillyTavern?: { updateWorldInfoList?: () => Promise<void> } }
  ).SillyTavern?.updateWorldInfoList;
  if (typeof refreshWorldbookList !== 'function') {
    throw new Error('宿主 updateWorldInfoList 不可用，不能安全刷新世界书缓存');
  }
  const before = expectedBefore ?? (await probeWorldbook(name));
  if (before.status === 'unreadable') throw new Error(`《${name}》导入前无法核验：${before.reason}`);
  const attemptedRaw = JSON.parse(json) as unknown;
  if (!isPlainRecord(attemptedRaw) || !isPlainRecord(attemptedRaw.entries)) {
    throw new Error(`《${name}》待导入 JSON 缺少 entries 对象`);
  }
  const attemptedFingerprint = await sha256(attemptedRaw);
  const latest = await probeWorldbook(name);
  if (latest.status === 'unreadable' || !sameProbe(before, latest)) {
    throw new Error(`《${name}》在确认后发生变化或不可读，未执行导入`);
  }

  try {
    const result = await importRaw(name, json);
    if (!importResultOk(result)) throw new Error('importRawWorldbook 返回失败状态');
    await refreshWorldbookList();
    const after = await probeWorldbook(name);
    if (after.status !== 'found') {
      throw new Error(`导入后无法读回世界书：${after.status === 'unreadable' ? after.reason : '目标书不存在'}`);
    }
    if (after.fingerprint !== attemptedFingerprint) {
      throw new Error('导入后读回内容与本次 payload 指纹不一致');
    }
    return { fingerprint: attemptedFingerprint, installedVersion: '' };
  } catch (error) {
    const afterFailure = await probeWorldbook(name);
    if (afterFailure.status === 'unreadable') {
      throw new Error(`《${name}》导入失败且当前书体不可读，未自动补偿，请人工检查`, { cause: error });
    }
    if (before.status === 'found') {
      if (afterFailure.status === 'found' && afterFailure.fingerprint === before.fingerprint) {
        throw new Error(`《${name}》导入失败，原书未变化`, { cause: error });
      }
      if (afterFailure.status !== 'found' || afterFailure.fingerprint !== attemptedFingerprint) {
        throw new Error(`《${name}》导入失败后出现第三方内容变化，未自动覆盖，请人工检查`, { cause: error });
      }
      const rollback = await importRaw(name, JSON.stringify(before.raw)).catch(() => false);
      await refreshWorldbookList().catch(() => undefined);
      const restored = await probeWorldbook(name);
      if (!importResultOk(rollback) || !sameProbe(before, restored)) {
        throw new Error(`《${name}》导入失败且原书回滚未通过指纹核验，请立即人工检查`, { cause: error });
      }
    } else if (afterFailure.status === 'found') {
      if (afterFailure.fingerprint !== attemptedFingerprint) {
        throw new Error(`《${name}》导入失败后出现非本次 payload 内容，未自动删除，请人工检查`, { cause: error });
      }
      const deleted = await deleteWorldbook(name).catch(() => false);
      await refreshWorldbookList().catch(() => undefined);
      const afterDelete = await probeWorldbook(name);
      if (!deleted || afterDelete.status !== 'absent') {
        throw new Error(`《${name}》导入失败且新书清理未获确认，请人工检查`, { cause: error });
      }
    }
    throw new Error(`《${name}》导入失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** 批量导入裸世界书；失败即抛错中断（已导部分不回滚，报错会列出已完成项）；bindToChar 时去重追加进角色卡 additional */
export async function installRawBooks(books: RawBookItem[], bindToChar: boolean): Promise<string[]> {
  const log: string[] = [];
  for (const b of books) {
    try {
      await importRawBookRegistered(b.name, b.json);
    } catch (e) {
      throw new Error(`${e instanceof Error ? e.message : String(e)}；已完成：${log.join('、') || '无'}`, { cause: e });
    }
    log.push(`《${b.name}》${b.entryCount} 条`);
  }
  if (bindToChar && books.length) {
    const getCharBooks = need<(c: string) => { primary: string | null; additional: string[] }>('getCharWorldbookNames');
    const rebindChar =
      need<(c: string, w: { primary: string | null; additional: string[] }) => Promise<void>>('rebindCharWorldbooks');
    const cur = getCharBooks('current');
    const additional = [...new Set([...cur.additional, ...books.map(b => b.name)])];
    await rebindChar('current', { primary: cur.primary, additional });
  }
  return log;
}

export async function installDlc(
  m: DlcManifest,
  pushCodex: DlcCodexWriter,
  installed: DlcOverlay[] = [],
): Promise<InstallReceipt> {
  // 先跑纯数据硬门：畸形/不兼容包不得在探测任何宿主写 API 后才失败。
  const staticBlocking = precheckManifest(m, installed).filter(
    issue => issue.level === 'error' && issue.rule !== 'R10' && issue.rule !== 'R11',
  );
  if (staticBlocking.length) {
    throw new Error(
      `DLC 预检失败，未执行安装：${staticBlocking.map(issue => `${issue.rule}/${issue.target} ${issue.message}`).join('；')}`,
    );
  }

  // 执行门以实时、严格解析的 $dlc 为唯一权威；UI 缓存只用于预览，不授予资产所有权。
  const gv = need<(o: { type: string }) => Record<string, unknown>>('getVariables');
  const frozenRegistryValue = structuredClone(gv({ type: 'chat' }).$dlc);
  const parsedRegistry = parseDlcRegistry(frozenRegistryValue);
  const liveRegistry = parsedRegistry.registry;
  const blocking = [
    ...(parsedRegistry.error
      ? [{ rule: 'R3', level: 'error' as const, target: '$dlc', message: parsedRegistry.error }]
      : []),
    ...precheckManifest(m, liveRegistry?.overlays ?? installed),
  ].filter(issue => issue.level === 'error' && issue.rule !== 'R10' && issue.rule !== 'R11');
  if (blocking.length || !liveRegistry) {
    throw new Error(
      `DLC 预检失败，未执行安装：${blocking.map(issue => `${issue.rule}/${issue.target} ${issue.message}`).join('；')}`,
    );
  }

  const bookNames = (m.worldbooks ?? []).map(wb => wb.name);
  const takeoverBookNames = new Set((m.patch?.takeover ?? []).map(item => item.from));
  const overlappingBook = bookNames.find(name => takeoverBookNames.has(name));
  if (overlappingBook) {
    throw new Error(`DLC 预检失败，未执行安装：世界书《${overlappingBook}》不能同时作为包体和 takeover 源书`);
  }
  const oldRecord = liveRegistry.records.get(m.dlc.id);
  const removedBooks = oldRecord?.books.filter(name => !bookNames.includes(name)) ?? [];
  if (removedBooks.length) {
    throw new Error(
      `DLC 预检失败，未执行安装：同 ID 更新移除了旧资产《${removedBooks.join('》《')}》，须先由驾驶员裁决`,
    );
  }
  for (const targetBook of new Set([...bookNames, ...takeoverBookNames])) {
    for (const [ownerId, record] of liveRegistry.records) {
      if (ownerId === m.dlc.id) continue;
      const ownsBook = record.books.includes(targetBook);
      const ownsTakeover = Object.keys(record.backups).some(key => key.startsWith(`${targetBook}#`));
      if (ownsBook || ownsTakeover) {
        throw new Error(
          `DLC 预检失败，未执行安装：${takeoverBookNames.has(targetBook) ? 'R11' : 'R10'}/${targetBook} 已由包 ${ownerId} ${ownsBook ? '持有书资产' : '接管'}`,
        );
      }
    }
  }
  const oldTakeoverBooks = new Set(Object.keys(oldRecord?.backups ?? {}).map(key => key.split('#')[0]));
  const removedTakeovers = [...oldTakeoverBooks].filter(name => !takeoverBookNames.has(name));
  if (removedTakeovers.length) {
    throw new Error(
      `DLC 预检失败，未执行安装：同 ID 更新移除了旧接管《${removedTakeovers.join('》《')}》，须先由驾驶员裁决`,
    );
  }

  const seeds = m.data?.codex ?? [];
  if (oldRecord?.codexSeeds.length && oldRecord.codexOwned === undefined) {
    throw new Error('DLC 预检失败，未执行安装：旧注册表缺少 codexOwned 所有权账本，须驾驶员裁决');
  }
  const codexTransaction = isCodexTransaction(pushCodex) ? pushCodex : null;
  if ((seeds.length || oldRecord?.codexOwned?.length) && !codexTransaction) {
    throw new Error('DLC 预检失败，未执行安装：含 codex 变更的包必须提供可逆 read/write 事务接口');
  }

  const beforeBooks = new Map<string, WorldbookProbe>();
  for (const name of new Set([...bookNames, ...(m.patch?.takeover ?? []).map(item => item.from)])) {
    const probe = await probeWorldbook(name);
    if (probe.status === 'unreadable') {
      throw new Error(`DLC 预检失败，未执行安装：ENV/${name} ${probe.reason}`);
    }
    beforeBooks.set(name, probe);
  }
  for (const wb of m.worldbooks ?? []) {
    const existing = beforeBooks.get(wb.name)!;
    if (existing.status !== 'found') continue;
    const asset = oldRecord?.bookAssets?.[wb.name];
    if (!asset || asset.fingerprint !== existing.fingerprint) {
      throw new Error(`DLC 预检失败，未执行安装：R10/${wb.name} 同名世界书缺少可核验的本包资产指纹或内容已漂移`);
    }
  }
  for (const takeover of m.patch?.takeover ?? []) {
    const existing = beforeBooks.get(takeover.from)!;
    if (existing.status !== 'found') {
      throw new Error(`DLC 预检失败，未执行安装：R11/${takeover.from} 接管目标书不存在`);
    }
    const oldTakeoverAsset = oldRecord?.takeoverAssets?.[takeover.from];
    const hadOldTakeover = Object.keys(oldRecord?.backups ?? {}).some(key => key.startsWith(`${takeover.from}#`));
    if (hadOldTakeover && (!oldTakeoverAsset || oldTakeoverAsset.fingerprint !== existing.fingerprint)) {
      throw new Error(`DLC 预检失败，未执行安装：R11/${takeover.from} 既有接管书内容已漂移或缺少资产指纹`);
    }
    const names = new Set(
      Object.values(existing.raw.entries).map(entry =>
        isPlainRecord(entry) ? String(entry.comment ?? entry.name ?? '') : '',
      ),
    );
    const missing = takeover.entries.filter(name => !names.has(name));
    if (missing.length) {
      throw new Error(`DLC 预检失败，未执行安装：R11/${takeover.from} 缺少接管条目：${missing.join('、')}`);
    }
  }

  const assertRegistryUnchanged = () => {
    if (canonicalJson(gv({ type: 'chat' }).$dlc) !== canonicalJson(frozenRegistryValue)) {
      throw new Error('DLC 预检后注册表发生变化，已中止安装');
    }
  };
  assertRegistryUnchanged();
  const getCharBooks = need<(c: string) => { primary: string | null; additional: string[] }>('getCharWorldbookNames');
  const rebindChar =
    need<(c: string, w: { primary: string | null; additional: string[] }) => Promise<void>>('rebindCharWorldbooks');
  const updateVars =
    need<(u: (v: Record<string, unknown>) => Record<string, unknown>, o: { type: string }) => unknown>(
      'updateVariablesWith',
    );
  const undoSteps: UndoStep[] = [];

  try {
    // 1. 导入完整世界书；每本成功后立即登记可验证逆操作。
    const dataCard = renderDataCardEntry(m);
    const dataCardBook = dataCard
      ? (((m.worldbooks ?? []).find(wb => wb.name.startsWith('特色科技·')) ?? (m.worldbooks ?? [])[0])?.name ?? null)
      : null;
    const bookAssets: Record<string, RegisteredBookAsset> = {};
    for (const wb of m.worldbooks ?? []) {
      assertRegistryUnchanged();
      let book = wb.book;
      if (wb.name === dataCardBook && dataCard) {
        const entries = { ...wb.book.entries };
        const uid = Math.max(-1, ...Object.values(entries).map(entry => Number(entry.uid) || 0)) + 1;
        entries[String(uid)] = wrapDataCardAsRawEntry(dataCard, uid);
        book = { entries };
      }
      const before = beforeBooks.get(wb.name)!;
      const asset = await importRawBookRegistered(wb.name, JSON.stringify(book), before);
      asset.installedVersion = m.dlc.version;
      bookAssets[wb.name] = asset;
      const after = await probeWorldbook(wb.name);
      if (after.status !== 'found' || after.fingerprint !== asset.fingerprint) {
        throw new Error(`《${wb.name}》安装后资产指纹复核失败`);
      }
      undoSteps.push({
        label: `恢复世界书《${wb.name}》`,
        run: () => restoreWorldbookProbe(wb.name, before, after),
      });
    }

    // 2. 绑定角色卡 additional；getter 读回不一致即失败并补偿。
    if (bookNames.length) {
      assertRegistryUnchanged();
      const current = structuredClone(getCharBooks('current'));
      await setCharBooksTransactional(
        { primary: current.primary, additional: [...new Set([...current.additional, ...bookNames])] },
        getCharBooks,
        rebindChar,
        undoSteps,
      );
    }

    // 3. takeover 基于刚读到的 raw 克隆修改，禁止 Helper 从陈旧 worldInfoCache 重新取源。
    const backups: Record<string, { content: string }> = { ...(oldRecord?.backups ?? {}) };
    const takeoverAssets: Record<string, RegisteredBookAsset> = {};
    const takeoverExpected = new Map([...beforeBooks.entries()].filter(([, probe]) => probe.status === 'found'));
    let takeoverCount = 0;
    for (const takeover of m.patch?.takeover ?? []) {
      assertRegistryUnchanged();
      const latest = await probeWorldbook(takeover.from);
      if (!sameProbe(takeoverExpected.get(takeover.from)!, latest) || latest.status !== 'found') {
        throw new Error(`接管《${takeover.from}》在确认后发生变化或不可读，已中止`);
      }
      const nextRaw = structuredClone(latest.raw);
      for (const entryName of takeover.entries) {
        const entry = Object.values(nextRaw.entries).find(
          candidate => isPlainRecord(candidate) && String(candidate.comment ?? candidate.name ?? '') === entryName,
        );
        if (!isPlainRecord(entry)) throw new Error(`接管《${takeover.from}》缺条目「${entryName}」`);
        const content = String(entry.content ?? '');
        const backupKey = `${takeover.from}#${entryName}`;
        if (!(backupKey in backups)) backups[backupKey] = { content };
        entry.content = `${content.match(/^\[[^\]]+\]/)?.[0] ?? `[${takeover.from}]`}\n本条目型号主权已由 DLC「${m.dlc.name}」接管，完整档案详见《${takeover.to}》。原引进渠道保留：经同盟关系仍可研究引进（详见双方武备书总则）。`;
        takeoverCount++;
      }
      const after = await saveProbedWorldbook(takeover.from, latest, nextRaw);
      takeoverExpected.set(takeover.from, after);
      takeoverAssets[takeover.from] = { fingerprint: after.fingerprint, installedVersion: m.dlc.version };
      undoSteps.push({
        label: `恢复接管源书《${takeover.from}》`,
        run: () => restoreWorldbookProbe(takeover.from, latest, after),
      });
    }

    // 4. codex 只通过 read/write 事务接口修改；同 ID 更新只移除旧账本中本包实际拥有的项。
    const oldOwned = new Set(oldRecord?.codexOwned ?? []);
    const codexOwned: string[] = [];
    if (codexTransaction) {
      assertRegistryUnchanged();
      const current = structuredClone(codexTransaction.read());
      const next = current.filter(item => !oldOwned.has(item.name));
      for (const seed of seeds) {
        if (next.some(item => item.name === seed.name)) continue;
        next.push(structuredClone(seed));
        codexOwned.push(seed.name);
      }
      await setCodexTransactional(codexTransaction, next, undoSteps);
    }

    // 5. 最后提交注册表；此前任一步失败都会按逆序补偿，未入册的半安装状态不会被宣称成功。
    const registry: RegisteredDlc = {
      version: m.dlc.version,
      name: m.dlc.name,
      kind: m.dlc.kind,
      books: bookNames,
      bookAssets,
      takeoverAssets,
      codexSeeds: seeds.map(seed => seed.name),
      codexOwned,
      backups,
      data: m.data ?? {},
      installedAt: new Date().toISOString(),
    };
    const nextRegistryValue: Record<string, unknown> = isPlainRecord(frozenRegistryValue)
      ? structuredClone(frozenRegistryValue)
      : {};
    nextRegistryValue[m.dlc.id] = registry;
    await setRegistryTransactional(frozenRegistryValue, nextRegistryValue, gv, updateVars, undoSteps);

    return { books: bookNames, takeoverCount, codexSeeds: registry.codexSeeds };
  } catch (error) {
    throw transactionError('DLC 安装', error, await rollbackSteps(undoSteps));
  }
}

/* ═══════════════ 卸载（照注册表精确回滚） ═══════════════ */

export interface UninstallPlan {
  id: string;
  books: string[];
  backupCount: number;
  codexSeeds: string[];
}

export function readUninstallPlan(id: string): UninstallPlan | null {
  const gv = tav<(o: { type: string }) => Record<string, unknown>>('getVariables');
  if (!gv) return null;
  try {
    const parsed = parseDlcRegistry(gv({ type: 'chat' }).$dlc);
    const reg = parsed.registry?.records.get(id);
    if (!reg) return null;
    // 旧注册表无可核验指纹时不展示破坏性确认按钮。
    if (reg.books.some(book => !reg.bookAssets?.[book])) return null;
    if (Object.keys(reg.backups).some(key => !reg.takeoverAssets?.[key.split('#')[0]])) return null;
    return {
      id,
      books: reg.books,
      backupCount: Object.keys(reg.backups).length,
      codexSeeds: reg.codexSeeds,
    };
  } catch {
    return null;
  }
}

export async function uninstallDlc(id: string, removeCodex: DlcCodexRemover): Promise<void> {
  const gv = need<(o: { type: string }) => Record<string, unknown>>('getVariables');
  const frozenRegistryValue = structuredClone(gv({ type: 'chat' }).$dlc);
  const parsed = parseDlcRegistry(frozenRegistryValue);
  const reg = parsed.registry?.records.get(id);
  if (parsed.error || !reg) {
    throw new Error(parsed.error ? `$dlc 注册表损坏：${parsed.error}` : `$dlc 注册表无 ${id}，无法安全卸载`);
  }
  if (reg.codexSeeds.length && reg.codexOwned === undefined) {
    throw new Error(`$dlc.${id} 缺少 codexOwned 所有权账本，无法安全卸载`);
  }
  const codexTransaction = isCodexTransaction(removeCodex) ? removeCodex : null;
  if (reg.codexOwned?.length && !codexTransaction) {
    throw new Error('卸载含 codex 资产的包必须提供可逆 read/write 事务接口');
  }

  const updateVars =
    need<(u: (v: Record<string, unknown>) => Record<string, unknown>, o: { type: string }) => unknown>(
      'updateVariablesWith',
    );
  const getCharBooks = need<(c: string) => { primary: string | null; additional: string[] }>('getCharWorldbookNames');
  const rebindChar =
    need<(c: string, w: { primary: string | null; additional: string[] }) => Promise<void>>('rebindCharWorldbooks');

  const byBook = new Map<string, { entryName: string; content: string }[]>();
  for (const [key, backup] of Object.entries(reg.backups)) {
    const split = key.indexOf('#');
    if (split <= 0 || split === key.length - 1) throw new Error(`$dlc.${id}.backups 键非法：${key}`);
    const book = key.slice(0, split);
    const entryName = key.slice(split + 1);
    if (!byBook.has(book)) byBook.set(book, []);
    byBook.get(book)!.push({ entryName, content: backup.content });
  }

  const probes = new Map<string, Extract<WorldbookProbe, { status: 'found' }>>();
  for (const name of new Set([...reg.books, ...byBook.keys()])) {
    const probe = await probeWorldbook(name);
    if (probe.status !== 'found') {
      throw new Error(`卸载已阻断：《${name}》${probe.status === 'unreadable' ? probe.reason : '不存在'}`);
    }
    const asset = reg.bookAssets?.[name] ?? reg.takeoverAssets?.[name];
    if (!asset || asset.fingerprint !== probe.fingerprint) {
      throw new Error(`卸载已阻断：《${name}》内容已漂移或缺少可核验所有权指纹`);
    }
    probes.set(name, probe);
  }
  const assertRegistryUnchanged = () => {
    if (canonicalJson(gv({ type: 'chat' }).$dlc) !== canonicalJson(frozenRegistryValue)) {
      throw new Error('卸载确认后 DLC 注册表发生变化，已中止');
    }
  };
  assertRegistryUnchanged();
  const undoSteps: UndoStep[] = [];

  try {
    // 1. 还原 takeover；后续失败时可按本事务写出的恢复指纹回到接管态。
    for (const [book, items] of byBook) {
      assertRegistryUnchanged();
      const latest = await probeWorldbook(book);
      if (!sameProbe(probes.get(book)!, latest) || latest.status !== 'found') {
        throw new Error(`卸载已阻断：《${book}》在确认后发生变化`);
      }
      const restoredRaw = structuredClone(latest.raw);
      for (const item of items) {
        const entry = Object.values(restoredRaw.entries).find(
          candidate => isPlainRecord(candidate) && String(candidate.comment ?? candidate.name ?? '') === item.entryName,
        );
        if (!isPlainRecord(entry)) throw new Error(`卸载回滚失败：《${book}》缺条目「${item.entryName}」`);
        entry.content = item.content;
      }
      const restored = await saveProbedWorldbook(book, latest, restoredRaw);
      probes.set(book, restored);
      undoSteps.push({
        label: `恢复接管态《${book}》`,
        run: () => restoreWorldbookProbe(book, latest, restored),
      });
    }

    // 2. 解绑角色卡。
    if (reg.books.length) {
      assertRegistryUnchanged();
      const current = structuredClone(getCharBooks('current'));
      await setCharBooksTransactional(
        { primary: current.primary, additional: current.additional.filter(book => !reg.books.includes(book)) },
        getCharBooks,
        rebindChar,
        undoSteps,
      );
    }

    // 3. 删除包体书；每本删除成功后登记“仅在仍 absent 时恢复原指纹”的逆操作。
    for (const book of reg.books) {
      assertRegistryUnchanged();
      const latest = await probeWorldbook(book);
      if (!sameProbe(probes.get(book)!, latest) || latest.status !== 'found') {
        throw new Error(`卸载已阻断：《${book}》在删除前发生变化`);
      }
      const absent = await deleteProbedWorldbook(book, latest);
      undoSteps.push({
        label: `恢复已删除世界书《${book}》`,
        run: () => restoreWorldbookProbe(book, latest, absent),
      });
    }

    // 4. 只删除 codexOwned 账本中的本包实际资产；同名预存项不在账本内，不得删除。
    if (codexTransaction && reg.codexOwned?.length) {
      assertRegistryUnchanged();
      const owned = new Set(reg.codexOwned);
      const current = structuredClone(codexTransaction.read());
      await setCodexTransactional(
        codexTransaction,
        current.filter(item => !owned.has(item.name)),
        undoSteps,
      );
    }

    // 5. 最后删除注册表项。
    const nextRegistryValue = isPlainRecord(frozenRegistryValue) ? structuredClone(frozenRegistryValue) : {};
    delete nextRegistryValue[id];
    await setRegistryTransactional(frozenRegistryValue, nextRegistryValue, gv, updateVars, undoSteps);
  } catch (error) {
    throw transactionError('DLC 卸载', error, await rollbackSteps(undoSteps));
  }
}

export * from './dlcArchiveOrphan';


