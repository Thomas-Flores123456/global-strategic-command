import type { BuildingDef, ProductionDef, ResearchDef } from '../core/catalog';
import { RESEARCHES } from '../core/catalog'; // 兼容旧单测注入槽；生产环境优先走世界书 effectiveCatalogSnapshot
import { checkOverlayData, lintBookContent, tav, type CheckIssue } from '../parse/systemCheck';
import {
  dynamicCatalogSnapshot,
  effectiveCatalogSnapshot,
  type DlcOverlay,
} from '../composables/useCatalog';

function getBaseResearches(): readonly ResearchDef[] {
  if (RESEARCHES.length > 0) {
    return RESEARCHES;
  }
  try {
    const snap = effectiveCatalogSnapshot();
    const snapResearches = snap?.researches ?? [];
    if (snapResearches.length === 0) return [];

    const wbNames = new Set<string>(
      (dynamicCatalogSnapshot()?.researches ?? []).map(r => r.name),
    );
    const dlcOnlyNames = new Set<string>();
    const gv = tav<(o?: { type?: string }) => Record<string, unknown> | undefined>('getVariables');
    if (gv) {
      try {
        const rawDlc = gv({ type: 'chat' })?.$dlc;
        if (isPlainRecord(rawDlc)) {
          for (const entry of Object.values(rawDlc)) {
            if (isPlainRecord(entry) && isPlainRecord(entry.data) && Array.isArray(entry.data.researches)) {
              for (const r of entry.data.researches) {
                if (isPlainRecord(r) && typeof r.name === 'string' && !wbNames.has(r.name)) {
                  dlcOnlyNames.add(r.name);
                }
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
    return dlcOnlyNames.size > 0
      ? snapResearches.filter(r => !dlcOnlyNames.has(r.name))
      : snapResearches;
  } catch {
    return RESEARCHES;
  }
}

function getBaseResearchNames(): Set<string> {
  return new Set(getBaseResearches().map(research => research.name));
}

/** 前端核心版本（requires.core 检查基准） */
export const CORE_VERSION = '1.0';

/* ═══════════════ manifest 类型 ═══════════════ */

export interface DlcCodexSeed {
  name: string;
  kind: string;
  desc: string;
  params: Record<string, string>;
}

/** ST 原生世界书条目（酒馆导出格式，字段透传；此处仅声明校验/安装需要的几个） */
export interface RawWorldbookEntry {
  uid: number;
  key: string[];
  comment: string;
  content: string;
  constant: boolean;
  disable?: boolean;
  [k: string]: unknown;
}

/** DLC 世界书：book 就是 ST 原生导出 JSON 体（可拆出单独保存为 .json 手动导入——优雅降级） */
export interface DlcWorldbook {
  name: string;
  book: { entries: Record<string, RawWorldbookEntry> };
}

export interface DlcManifest {
  dlc: {
    id: string;
    name: string;
    kind: 'faction' | 'addon' | 'patch';
    version: string;
    requires?: { core?: string };
    /** 数据卡：安装时把 data 层渲染成一条绿灯世界书条目（AI 可读的精确数值）；默认开，显式 false 关闭 */
    dataCard?: boolean;
  };
  data?: {
    faction?: { name?: string; mcv: string; lab: string; labResearch?: string | null };
    researches?: ResearchDef[];
    buildings?: BuildingDef[];
    productions?: ProductionDef[];
    codex?: DlcCodexSeed[];
  };
  patch?: {
    takeover?: { from: string; entries: string[]; to: string }[];
  };
  worldbooks?: DlcWorldbook[];
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

function validStringRecord(value: unknown): value is Record<string, string> {
  return isPlainRecord(value) && Object.values(value).every(item => typeof item === 'string');
}

function validCodexSeed(value: unknown): value is DlcCodexSeed {
  return (
    isPlainRecord(value) &&
    validName(value.name) &&
    validName(value.kind) &&
    typeof value.desc === 'string' &&
    validStringRecord(value.params)
  );
}

export interface RegisteredBookAsset {
  fingerprint: string;
  installedVersion: string;
}

export interface RegisteredDlc {
  version: string;
  name: string;
  kind: DlcManifest['dlc']['kind'];
  books: string[];
  bookAssets?: Record<string, RegisteredBookAsset>;
  takeoverAssets?: Record<string, RegisteredBookAsset>;
  codexSeeds: string[];
  /** 仅记录本包安装时实际新增的 codex；卸载不得删除安装前已存在的同名项。 */
  codexOwned?: string[];
  backups: Record<string, { content: string }>;
  data: NonNullable<DlcManifest['data']>;
  installedAt: string;
}

export interface ParsedRegistry {
  records: Map<string, RegisteredDlc>;
  overlays: DlcOverlay[];
}

function validUniqueNameArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(validName) && new Set(value).size === value.length;
}

function parseRegisteredBookAssets(value: unknown): Record<string, RegisteredBookAsset> | undefined | null {
  if (value === undefined) return undefined; // 兼容旧注册表；破坏性重装/卸载会因缺所有权证据另行拒绝。
  if (!isPlainRecord(value)) return null;
  const assets: Record<string, RegisteredBookAsset> = {};
  for (const [name, rawAsset] of Object.entries(value)) {
    if (
      !validName(name) ||
      !isPlainRecord(rawAsset) ||
      typeof rawAsset.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(rawAsset.fingerprint) ||
      !validName(rawAsset.installedVersion)
    ) {
      return null;
    }
    assets[name] = {
      fingerprint: rawAsset.fingerprint.toLowerCase(),
      installedVersion: rawAsset.installedVersion,
    };
  }
  return assets;
}

/** install / uninstall / replay 共用的严格注册表解析器；未知或损坏形状一律 fail-closed。 */
export function parseDlcRegistry(value: unknown): { registry?: ParsedRegistry; error?: string } {
  if (value === undefined) return { registry: { records: new Map(), overlays: [] } };
  if (!isPlainRecord(value)) return { error: '$dlc 注册表必须是对象' };

  const records = new Map<string, RegisteredDlc>();
  const overlays: DlcOverlay[] = [];
  const destructiveOwners = new Map<string, string>();
  for (const [id, rawEntry] of Object.entries(value)) {
    if (!validName(id) || !isPlainRecord(rawEntry)) return { error: `$dlc.${id || '(空ID)'} 条目非法` };
    if (
      !validName(rawEntry.version) ||
      !validName(rawEntry.name) ||
      !['faction', 'addon', 'patch'].includes(String(rawEntry.kind)) ||
      !validName(rawEntry.installedAt)
    ) {
      return { error: `$dlc.${id} 的 version/name/kind/installedAt 非法` };
    }
    const books = rawEntry.books;
    const codexSeeds = rawEntry.codexSeeds;
    const codexOwned = rawEntry.codexOwned;
    if (!validUniqueNameArray(books)) return { error: `$dlc.${id}.books 必须是无重复的合法名称数组` };
    if (!validUniqueNameArray(codexSeeds)) {
      return { error: `$dlc.${id}.codexSeeds 必须是无重复的合法名称数组` };
    }
    if (codexOwned !== undefined && !validUniqueNameArray(codexOwned)) {
      return { error: `$dlc.${id}.codexOwned 必须是无重复的合法名称数组` };
    }
    if (codexOwned?.some(name => !codexSeeds.includes(name))) {
      return { error: `$dlc.${id}.codexOwned 含未登记于 codexSeeds 的名称` };
    }
    if (!isPlainRecord(rawEntry.backups)) return { error: `$dlc.${id}.backups 必须是对象` };
    const backups: Record<string, { content: string }> = {};
    const takeoverBooks = new Set<string>();
    for (const [key, backup] of Object.entries(rawEntry.backups)) {
      const split = key.indexOf('#');
      if (
        !validName(key) ||
        split <= 0 ||
        split === key.length - 1 ||
        !isPlainRecord(backup) ||
        typeof backup.content !== 'string'
      ) {
        return { error: `$dlc.${id}.backups.${key} 非法` };
      }
      takeoverBooks.add(key.slice(0, split));
      backups[key] = { content: backup.content };
    }
    if (!isPlainRecord(rawEntry.data)) return { error: `$dlc.${id}.data 必须是对象` };
    const dataShapeError = validateManifestShape({
      dlc: {
        id,
        name: rawEntry.name,
        kind: rawEntry.kind,
        version: rawEntry.version,
      },
      data: rawEntry.data,
    });
    if (dataShapeError) return { error: `$dlc.${id}.data 损坏：${dataShapeError}` };
    const codexNames = ((rawEntry.data.codex ?? []) as DlcCodexSeed[]).map(seed => seed.name);
    if (new Set(codexNames).size !== codexNames.length) return { error: `$dlc.${id}.data.codex 名称重复` };
    if (
      codexNames.length !== codexSeeds.length ||
      codexNames.some(name => !codexSeeds.includes(name)) ||
      codexSeeds.some(name => !codexNames.includes(name))
    ) {
      return { error: `$dlc.${id}.data.codex 与 codexSeeds 账本不一致` };
    }
    const bookAssets = parseRegisteredBookAssets(rawEntry.bookAssets);
    if (bookAssets === null) return { error: `$dlc.${id}.bookAssets 损坏` };
    if (bookAssets && Object.keys(bookAssets).some(name => !books.includes(name))) {
      return { error: `$dlc.${id}.bookAssets 含未登记于 books 的资产` };
    }
    if (bookAssets && Object.values(bookAssets).some(asset => asset.installedVersion !== rawEntry.version)) {
      return { error: `$dlc.${id}.bookAssets 版本与注册表不一致` };
    }
    const takeoverAssets = parseRegisteredBookAssets(rawEntry.takeoverAssets);
    if (takeoverAssets === null) return { error: `$dlc.${id}.takeoverAssets 损坏` };
    if (takeoverAssets && Object.keys(takeoverAssets).some(name => !takeoverBooks.has(name))) {
      return { error: `$dlc.${id}.takeoverAssets 含未登记于 backups 的资产` };
    }
    if (takeoverAssets && Object.values(takeoverAssets).some(asset => asset.installedVersion !== rawEntry.version)) {
      return { error: `$dlc.${id}.takeoverAssets 版本与注册表不一致` };
    }
    const overlay = {
      id,
      ...rawEntry.data,
      books,
      bookAssets,
      takeoverAssets,
      codexSeeds,
    } as DlcOverlay;
    if (
      checkOverlayData(overlay, getBaseResearchNames()).some(
        issue => issue.level === 'error',
      )
    ) {
      return { error: `$dlc.${id}.data 未通过 catalog 数据校验` };
    }
    for (const book of new Set([...books, ...takeoverBooks])) {
      const previousOwner = destructiveOwners.get(book);
      if (previousOwner) return { error: `世界书《${book}》被 ${previousOwner} 与 ${id} 重复认领或接管` };
      destructiveOwners.set(book, id);
    }
    const record: RegisteredDlc = {
      version: rawEntry.version,
      name: rawEntry.name,
      kind: rawEntry.kind as RegisteredDlc['kind'],
      books,
      bookAssets,
      takeoverAssets,
      codexSeeds,
      codexOwned,
      backups,
      data: rawEntry.data as RegisteredDlc['data'],
      installedAt: rawEntry.installedAt,
    };
    records.set(id, record);
    overlays.push(overlay);
  }
  return { registry: { records, overlays } };
}

function validateObjectArray(container: Record<string, unknown>, field: string, label: string): string | null {
  const value = container[field];
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `${label} 必须是数组`;
  const invalidIndex = value.findIndex(item => !isPlainRecord(item));
  return invalidIndex < 0 ? null : `${label}[${invalidIndex}] 必须是对象`;
}

/** JSON 边界形状门；字段语义和前置条件由 checkOverlayData 继续验证。 */
export function validateManifestShape(value: unknown): string | null {
  if (!isPlainRecord(value)) return 'DLC manifest 必须是对象';
  if (!isPlainRecord(value.dlc)) return '缺少 dlc 元数据块';
  const dlc = value.dlc;
  if (!validName(dlc.id) || !validName(dlc.name) || !validName(dlc.version)) {
    return 'dlc.id / dlc.name / dlc.version 必须是无首尾空白的非空字符串';
  }
  if (!['faction', 'addon', 'patch'].includes(String(dlc.kind))) {
    return `dlc.kind 非法：${String(dlc.kind)}（应为 faction/addon/patch）`;
  }
  if (dlc.requires !== undefined) {
    if (!isPlainRecord(dlc.requires)) return 'dlc.requires 必须是对象';
    if (dlc.requires.core !== undefined && !validName(dlc.requires.core)) {
      return 'dlc.requires.core 必须是无首尾空白的非空字符串';
    }
  }
  if (dlc.dataCard !== undefined && typeof dlc.dataCard !== 'boolean') return 'dlc.dataCard 必须是布尔值';
  if (value.data !== undefined) {
    if (!isPlainRecord(value.data)) return 'data 必须是对象';
    for (const [field, label] of [
      ['researches', 'data.researches'],
      ['buildings', 'data.buildings'],
      ['productions', 'data.productions'],
      ['codex', 'data.codex'],
    ] as const) {
      const error = validateObjectArray(value.data, field, label);
      if (error) return error;
    }
    if (value.data.faction !== undefined) {
      if (!isPlainRecord(value.data.faction)) return 'data.faction 必须是对象';
      if (!validName(value.data.faction.mcv) || !validName(value.data.faction.lab)) {
        return 'data.faction.mcv / lab 必须是无首尾空白的非空字符串';
      }
      if (value.data.faction.name !== undefined && !validName(value.data.faction.name)) {
        return 'data.faction.name 必须是无首尾空白的非空字符串';
      }
      if (
        value.data.faction.labResearch !== undefined &&
        value.data.faction.labResearch !== null &&
        !validName(value.data.faction.labResearch)
      ) {
        return 'data.faction.labResearch 必须是 null 或无首尾空白的非空字符串';
      }
    }
    for (const [index, seed] of ((value.data.codex ?? []) as unknown[]).entries()) {
      if (!validCodexSeed(seed)) {
        return `data.codex[${index}] 的 name/kind/desc/params 非法或 params 含非字符串值`;
      }
    }
  }
  if (value.worldbooks !== undefined) {
    if (!Array.isArray(value.worldbooks)) return 'worldbooks 必须是数组';
    const seenBookNames = new Set<string>();
    for (const [index, candidate] of value.worldbooks.entries()) {
      if (!isPlainRecord(candidate)) return `worldbooks[${index}] 必须是对象`;
      if (!validName(candidate.name)) return `worldbooks[${index}].name 必须是无首尾空白的非空字符串`;
      if (seenBookNames.has(candidate.name)) return `worldbooks 不得重复声明《${candidate.name}》`;
      seenBookNames.add(candidate.name);
      if (!isPlainRecord(candidate.book) || !isPlainRecord(candidate.book.entries)) {
        return `worldbooks「${candidate.name}」缺 book.entries（应为 ST 原生世界书 JSON 体）`;
      }
      const invalidEntry = Object.values(candidate.book.entries).findIndex(entry => !isPlainRecord(entry));
      if (invalidEntry >= 0) return `worldbooks「${candidate.name}」的 entries[${invalidEntry}] 必须是对象`;
    }
  }
  if (value.patch !== undefined) {
    if (!isPlainRecord(value.patch)) return 'patch 必须是对象';
    const error = validateObjectArray(value.patch, 'takeover', 'patch.takeover');
    if (error) return error;
    for (const [index, candidate] of ((value.patch.takeover ?? []) as Record<string, unknown>[]).entries()) {
      if (
        !validName(candidate.from) ||
        candidate.from.includes('#') ||
        !validName(candidate.to) ||
        !Array.isArray(candidate.entries) ||
        !candidate.entries.every(validName)
      ) {
        return `patch.takeover[${index}] 的 from/to/entries 非法`;
      }
    }
  }
  return null;
}

export function parseManifest(text: string): { manifest?: DlcManifest; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: `JSON 解析失败：${e instanceof Error ? e.message.slice(0, 120) : '未知错误'}` };
  }
  const error = validateManifestShape(raw);
  if (error) return { error };
  return { manifest: raw as DlcManifest };
}

/* ═══════════════ 预检（包侧 R1-R12） ═══════════════ */

function collectRequirementResearchNames(condition: unknown, names: Set<string>): void {
  if (!isPlainRecord(condition)) return;
  if (condition.kind === 'research' && validName(condition.name)) names.add(condition.name);
  if (Array.isArray(condition.conditions)) {
    for (const child of condition.conditions) collectRequirementResearchNames(child, names);
  }
}

function checkResearchCycles(m: DlcManifest, installed: DlcOverlay[]): CheckIssue[] {
  const baseResearches = getBaseResearches();
  const effective = new Map(baseResearches.map(research => [research.name, research]));
  const baseNames = new Set(baseResearches.map(research => research.name));
  for (const overlay of installed as unknown[]) {
    if (!isPlainRecord(overlay) || overlay.id === m.dlc.id) continue; // 同 ID 更新：旧 overlay 会被整包替换，不得混入最终依赖图。
    if (checkOverlayData(overlay, baseNames).some(issue => issue.level === 'error')) continue;
    const record = overlay as Record<string, unknown>;
    for (const research of (record.researches ?? []) as ResearchDef[]) effective.set(research.name, research);
  }
  for (const research of m.data?.researches ?? []) effective.set(research.name, research);

  const graph = new Map<string, string[]>();
  for (const research of effective.values()) {
    const deps = new Set(Array.isArray(research.prereqs) ? research.prereqs : []);
    collectRequirementResearchNames(research.requirements, deps);
    graph.set(
      research.name,
      [...deps].filter(name => effective.has(name)),
    );
  }
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles = new Set<string>();
  const visit = (name: string) => {
    const current = state.get(name) ?? 0;
    if (current === 2) return;
    if (current === 1) {
      const start = stack.indexOf(name);
      cycles.add([...stack.slice(start), name].join(' → '));
      return;
    }
    state.set(name, 1);
    stack.push(name);
    for (const dependency of graph.get(name) ?? []) visit(dependency);
    stack.pop();
    state.set(name, 2);
  };
  for (const name of graph.keys()) visit(name);
  return [...cycles].map(cycle => ({
    rule: 'R3',
    level: 'error' as const,
    target: '(research graph)',
    message: `包内研究前置形成循环：${cycle}`,
  }));
}

function ownedBookNames(installed: DlcOverlay[], packageId: string): Set<string> {
  const baseNames = getBaseResearchNames();
  const owners = (installed as unknown[]).filter(
    (candidate): candidate is Record<string, unknown> =>
      isPlainRecord(candidate) &&
      candidate.id === packageId &&
      !checkOverlayData(candidate, baseNames).some(issue => issue.level === 'error'),
  );
  if (owners.length !== 1 || !Array.isArray(owners[0].books) || !isPlainRecord(owners[0].bookAssets)) {
    return new Set();
  }
  return new Set(
    owners[0].books.filter(
      name => validName(name) && isPlainRecord((owners[0].bookAssets as Record<string, unknown>)[name]),
    ),
  );
}

export function precheckManifest(m: DlcManifest, installed: DlcOverlay[]): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const shapeError = validateManifestShape(m);
  if (shapeError) return [{ rule: 'R3', level: 'error', target: '(manifest)', message: shapeError }];

  // requires.core（仅支持 ">=X.Y"）
  const req = m.dlc.requires?.core;
  if (req) {
    const mm = req.match(/^>=(\d+)\.(\d+)$/);
    if (!mm) {
      issues.push({
        rule: 'REQ',
        level: 'error',
        target: m.dlc.id,
        message: `requires.core 格式不支持（${req}），已拒绝安装`,
      });
    } else {
      const [cur, need] = [CORE_VERSION.split('.').map(Number), [Number(mm[1]), Number(mm[2])]];
      if (cur[0] < need[0] || (cur[0] === need[0] && cur[1] < need[1])) {
        issues.push({
          rule: 'REQ',
          level: 'error',
          target: m.dlc.id,
          message: `需要核心 ${req}，当前 ${CORE_VERSION}`,
        });
      }
    }
  }

  // R1/R2/R3/R12(覆盖base)：data 块硬校验
  const overlay: DlcOverlay = { id: m.dlc.id, ...(m.data ?? {}) };
  const baseNames = getBaseResearchNames();
  const overlayIssues = checkOverlayData(overlay, baseNames);
  issues.push(...overlayIssues);
  if (overlayIssues.some(issue => issue.level === 'error')) return issues;
  issues.push(...checkResearchCycles(m, installed));

  // R4 科技名与已装包冲突。已装损坏包由 checkOverlayData 单独体检，此处只读取安全条目。
  const installedNames = new Map<string, string>();
  for (const candidate of installed as unknown[]) {
    if (!isPlainRecord(candidate) || !Array.isArray(candidate.researches)) continue;
    const owner = validName(candidate.id) ? candidate.id : '(overlay)';
    for (const research of candidate.researches) {
      if (isPlainRecord(research) && validName(research.name)) installedNames.set(research.name, owner);
    }
  }
  for (const research of m.data?.researches ?? []) {
    const owner = installedNames.get(research.name);
    if (owner && owner !== m.dlc.id)
      issues.push({
        rule: 'R4',
        level: 'error',
        target: research.name,
        message: `与已装包 ${owner} 的科技重名——科技名全局唯一`,
      });
  }

  // R5/R7 包内世界书文本 lint + R9 常驻预算（内容在包里，无需酒馆 API）
  for (const wb of m.worldbooks ?? []) {
    const entries = Object.values(wb.book?.entries ?? {});
    let constCount = 0;
    let constChars = 0;
    for (const e of entries) {
      const name = String(e.comment ?? '(未命名)');
      const content = String(e.content ?? '');
      issues.push(...lintBookContent(wb.name, name, content));
      if (e.constant === true && e.disable !== true) {
        constCount++;
        constChars += content.length;
      }
    }
    if (constCount > 10 || constChars > 8000) {
      issues.push({
        rule: 'R9',
        level: 'warn',
        target: wb.name,
        message: `常驻预算超标：蓝灯 ${constCount} 条 / ${constChars} 字（红线：蓝灯仅总则，其余绿灯）`,
      });
    }
  }

  // R6 MCV 铁律（faction 包的特色科技书）
  if (m.dlc.kind === 'faction') {
    if (!m.data?.faction) {
      issues.push({
        rule: 'R2',
        level: 'error',
        target: m.dlc.id,
        message: 'faction 包缺 data.faction（mcv/lab 声明）',
      });
    }
    const specialBook = (m.worldbooks ?? []).find(wb => wb.name.startsWith('特色科技·'));
    if (
      specialBook &&
      !Object.values(specialBook.book?.entries ?? {}).some(e => /MCV|建造厂核心/.test(String(e.content ?? '')))
    ) {
      issues.push({ rule: 'R6', level: 'error', target: specialBook.name, message: '特色科技书未见 MCV 铁律表述' });
    }
  }

  // R8 文本↔数据一致性：data 科技名应出现在包内某世界书（数据卡自动兕底，此项仅提示叙事完整性）
  const allText = (m.worldbooks ?? [])
    .map(wb =>
      Object.values(wb.book?.entries ?? {})
        .map(e => String(e.content ?? ''))
        .join('\n'),
    )
    .join('\n');
  for (const r of m.data?.researches ?? []) {
    if (r.name && !allText.includes(r.name)) {
      issues.push({
        rule: 'R8',
        level: 'info',
        target: r.name,
        message: '科技未在包内世界书叙事出现（数据卡会自动兕底数值，但建议补叙事）',
      });
    }
  }

  // 书名冲突：目标书已存在（酒馆内可查时）且非本包重装
  const getAllNames = tav<() => string[]>('getWorldbookNames');
  if (getAllNames) {
    try {
      const existing = new Set(getAllNames());
      const ownedBooks = ownedBookNames(installed, m.dlc.id);
      for (const wb of m.worldbooks ?? []) {
        if (existing.has(wb.name) && !ownedBooks.has(wb.name)) {
          issues.push({
            rule: 'R10',
            level: 'error',
            target: wb.name,
            message: '同名世界书已存在且未登记为本包旧版本资产——禁止覆盖手工或他包内容',
          });
        }
      }
      // R11 takeover 对账：目标书与条目存在性
      for (const t of m.patch?.takeover ?? []) {
        if (!existing.has(t.from))
          issues.push({ rule: 'R11', level: 'error', target: t.from, message: 'takeover 目标书不存在' });
      }
    } catch {
      issues.push({
        rule: 'ENV',
        level: 'warn',
        target: '预检',
        message: '世界书清单读取失败，书名冲突与 takeover 存在性未检查',
      });
    }
  } else {
    issues.push({
      rule: 'ENV',
      level: 'info',
      target: '预检',
      message: '独立预览：书名冲突 / takeover 存在性检查留待酒馆内执行',
    });
  }
  return issues;
}

export interface WbEntryFull {
  uid: number;
  name: string;
  content: string;
  [k: string]: unknown;
}

/* ═════════════ 数据卡：data 层 → 世界书条目（AI 可读） ═════════════ */

/**
 * 把 manifest.data 渲染成一条绿灯条目（keys=全部 data 名字）。
 * 动机：$dlc 注册表对 AI 不可见，作者手写文本可能漏数值（R8 漂移）——
 * 数据卡保证 AI 聊到任何 DLC 名词都能拿到与前端 overlay 严格一致的数值。
 * 预检阶段即渲染（确认门展示），安装时写入目标书末尾；卸载随整本书删除。
 */
export function renderDataCardEntry(m: DlcManifest): { comment: string; keys: string[]; content: string } | null {
  if (m.dlc.dataCard === false) return null;
  const d = m.data ?? {};
  const rs = d.researches ?? [];
  const bs = d.buildings ?? [];
  const ps = d.productions ?? [];
  if (!rs.length && !bs.length && !ps.length) return null;

  const bookName =
    ((m.worldbooks ?? []).find(wb => wb.name.startsWith('特色科技·')) ?? (m.worldbooks ?? [])[0])?.name ??
    `DLC·${m.dlc.name}`;
  const lines: string[] = [
    `[${bookName} | 数据卡]`,
    `（本条由DLC安装器按结构化数据自动生成，数值与指挥终端严格一致；叙事性档案见本书其余条目。）`,
  ];
  if (rs.length) {
    lines.push('研究：');
    for (const r of rs) {
      const bits = [
        `${r.cost}`,
        r.eta,
        `T${r.tier}`,
        r.line,
        r.prereq ? `前置:${r.prereq}` : '',
        r.unlocks ? `解锁:${r.unlocks}` : '',
      ].filter(Boolean);
      lines.push(`· ${r.name}｜${bits.join('｜')}`);
    }
  }
  if (bs.length) {
    lines.push('建筑：');
    for (const b of bs) {
      // power 符号约定同 catalog：负=发电，正=耗电（发电厂 -200，兵营 +20）
      const bits = [
        `${b.cost}`,
        typeof b.power === 'number' ? (b.power < 0 ? `发电${-b.power}` : `耗电${b.power}`) : '',
        b.research ? `前置研究:${b.research}` : '',
      ].filter(Boolean);
      lines.push(`· ${b.name}｜${bits.join('｜')}`);
    }
  }
  if (ps.length) {
    lines.push('生产：');
    for (const p of ps) {
      const bits = [`${p.cost}`, p.need_building ? `产地:${p.need_building}` : ''].filter(Boolean);
      lines.push(`· ${p.name}｜${bits.join('｜')}`);
    }
  }
  const keys = [...rs.map(r => r.name), ...bs.map(b => b.name), ...ps.map(p => p.name)];
  return { comment: '99·数据卡（EVA自动生成）', keys, content: lines.join('\n') };
}

/** 把数据卡包装成完整的 ST 原生条目（绿灯） */
export function wrapDataCardAsRawEntry(
  card: { comment: string; keys: string[]; content: string },
  uid: number,
): RawWorldbookEntry {
  return {
    uid,
    key: card.keys,
    keysecondary: [],
    comment: card.comment,
    content: card.content,
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    addMemo: true,
    order: 100,
    position: 0,
    disable: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    probability: 100,
    useProbability: true,
    depth: 4,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    role: null,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    displayIndex: uid,
  };
}

export function need<T>(name: string): T {
  const fn = tav<T>(name);
  if (!fn) throw new Error(`酒馆 API ${name} 不可用（独立预览环境无法执行写操作）`);
  return fn;
}
