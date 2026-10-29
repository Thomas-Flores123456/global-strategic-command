/**
 * 机娘档案落地器（girlFiler）——pending_lore → 当前聊天档案书入档
 *
 * 叙事中新机娘诞生 → <机娘档案> 标签 → parsePipeline 暂存 pending_lore（纯函数）→
 * 本模块渲染并提交到运行时世界书（真机书=运行态真源；仓库 JSON=设计态基线）。
 *
 * 落点（CTRL-CHATBOOK-01 §4.1 改挂）：写入目标为**当前聊天档案书**（经 chatBookBinding
 * 三重守卫；守卫失败 fail-closed 抛错，pending_lore 留存可重试）。档案段与剧情段落入同一本
 * 聊天书，以 comment 前缀分段替代原双书分卷：
 *   ① `档案·{名}·{型号}` upsert 技能档案（八段格式；E7e 纪律：绿灯/不可被递归/order 70000带续号/精确key）
 *   ② `剧情·{名}·人格与现状` upsert 人物条目（社会外壳/外观/性格/当前状态；key=[本名,化名]）
 *   ③ 聊天书内阵容总览条目追加一行（首写自建，空阵容起步；幂等：已含该机娘则跳过）
 * 原全局双书《机娘·能力档案》《剧情·北坡纪事》退为只读种子基线，存量条目不迁移。
 *
 * 渲染与 upsert 全部为纯函数（单测直接覆盖）；副作用只在 fileDossier 的守卫调用与
 * updateWorldbookWith 调用里。渲染产物与双书时代逐字节一致（只换落点不换内容）。
 * 幂等性：按 comment 前缀（`档案·{名}·`/`剧情·{名}·`）定位 upsert，重复提交不产生重复条目。
 */
import type { z } from 'zod';
import type { ChatBookGatewayLike } from './chatBookBinding';
import { chatBookGateway } from './chatBookBinding';
import { sanitizeWorldbookKeys } from './expansionFiler';
import type { GirlDossier } from '../core/schema';
import { tav } from '../parse/systemCheck';

export type Dossier = z.output<typeof GirlDossier>;
export type { GirlDossier };

/**
 * 判别 stat_data.pending_lore 中的异构元素是否为机娘初诞档案（GirlDossier）。
 * 校验非空对象、排除 kind === '势力' 及含暂存门 id 的新实体条目；
 * 同时要求具备机娘特征（Array.isArray(keys) && typeof shell === 'string'，或显式含 model/abilities），
 * 彻底阻断新势力对象（无 keys/shell）流入 fileDossier 触发 TypeError。
 */
export function isGirlDossierEntry(item: unknown): item is Dossier {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
  const rec = item as Record<string, unknown>;
  if (typeof rec.name !== 'string' || rec.name.trim() === '') return false;
  if (rec.kind === '势力' || (typeof rec.kind === 'string' && rec.kind !== '机娘')) return false;
  if (
    typeof rec.id === 'string' &&
    rec.id.length > 0 &&
    !rec.id.startsWith('maiden.') &&
    rec.type !== 'maiden'
  ) {
    return false;
  }
  return (
    (Array.isArray(rec.keys) && typeof rec.shell === 'string') ||
    typeof rec.model === 'string' ||
    Array.isArray(rec.abilities) ||
    Array.isArray(rec.special_skills)
  );
}

export const DOSSIER_BOOK = '机娘·能力档案';
export const STORY_BOOK = '剧情·北坡纪事';
/** 剧情书阵容总览条目的 comment 特征串（uid0「01·机娘阵容与社会外壳总览」） */
export const ROSTER_MARK = '机娘阵容与社会外壳总览';

/** TavernHelper 归一化世界书条目（@types/function/worldbook.d.ts 的运行时子集；新建时允许部分字段） */
export interface ThEntry {
  uid?: number;
  name: string;
  comment?: string;
  key?: (string | RegExp)[];
  keys?: (string | RegExp)[];
  enabled?: boolean;
  strategy?: { type?: string; keys?: (string | RegExp)[]; [k: string]: unknown };
  position?: { type?: string; order?: number; [k: string]: unknown };
  content?: string;
  probability?: number;
  recursion?: { prevent_incoming?: boolean; prevent_outgoing?: boolean; delay_until?: null | number };
  [k: string]: unknown;
}

function entryTitle(e: ThEntry): string {
  return String(e.name || e.comment || '');
}

/* ═══════════════ 渲染（纯函数） ═══════════════ */

/** 段落拼装：空值段整段不出（优雅降级） */
function joinSections(sections: (string | null)[]): string {
  return sections.filter((s): s is string => !!s && s.trim().length > 0).join('\n\n');
}

function header(book: string, d: Dossier): string {
  return d.model ? `[${book} | ${d.name}——${d.model}]` : `[${book} | ${d.name}]`;
}

function buildCapabilityMetaBlock(d: Dossier): string | null {
  const lines = [
    d.serial ? `[出厂编号] ${d.serial}` : null,
    d.callsign ? `[专属代号] ${d.callsign}` : null,
    d.seq ? `[机体序列] ${d.seq}` : null,
    d.faction ? `[所属阵营] ${d.faction}` : null,
    d.body ? `[躯体特征] ${d.body}` : null,
  ].filter((s): s is string => Boolean(s));
  return lines.length ? lines.join('\n') : null;
}

function hasStructuredMaidenDataFields(d: Dossier): boolean {
  return Boolean(
    (Array.isArray(d.special_skills) && d.special_skills.length > 0) ||
      (Array.isArray(d.special_equipment) && d.special_equipment.length > 0) ||
      d.id ||
      d.temperament_spectrum ||
      d.exposure_grade ||
      d.balance_slot ||
      d.prose,
  );
}

/**
 * 构建与《机娘·能力档案_世界书.json》完全同构的 `type: "maiden"` 结构化数据块对象（MAIDEN-DATA-01）
 */
export function buildStructuredMaidenDataObject(d: Dossier): Record<string, unknown> {
  const factionRaw = (d.faction || '通用').trim();
  const factionSlug =
    factionRaw === '盟军'
      ? 'allied'
      : factionRaw === '苏联'
        ? 'soviet'
        : factionRaw === '尤里'
          ? 'yuri'
          : 'common';
  const fallbackSlug = (d.serial || d.callsign || d.name || 'unit')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const id = d.id?.trim() || `maiden.${factionSlug}.${fallbackSlug || 'unit'}`;
  const model = (d.model || '新入列机娘').trim();
  const uniqueDossierName = d.name.includes('·') ? d.name : `${d.name}·${model}`;

  const specialSkills =
    Array.isArray(d.special_skills) && d.special_skills.length > 0
      ? d.special_skills.map(s => ({
          name: s.name,
          kind: s.kind || '核心权能',
          desc: s.desc || '',
        }))
      : d.skills
        ? d.skills
            .split(/\r?\n/)
            .map(l => l.replace(/^[\s·\-*]+/, '').trim())
            .filter(Boolean)
            .map(line => {
              const m = line.match(/^(?:【([^（】]+)(?:（([^）]+)）)?】|([^：:]+)[：:])\s*(.*)$/);
              if (m) {
                return {
                  name: (m[1] || m[3] || '专属权能').trim(),
                  kind: (m[2] || '核心权能').trim(),
                  desc: (m[4] || line).trim(),
                };
              }
              return { name: '专属战术权能', kind: '核心权能', desc: line };
            })
        : [];

  const specialEquipment =
    Array.isArray(d.special_equipment) && d.special_equipment.length > 0
      ? d.special_equipment.map(e => ({
          name: e.name,
          slot: e.slot || '专属挂载',
          desc: e.desc || '',
        }))
      : d.weapons
        ? d.weapons
            .split(/[；;、,，\n]+/)
            .map(s => s.trim())
            .filter(Boolean)
            .map(w => ({
              name: w,
              slot: '专属挂载',
              desc: `${model}随身标配与战术挂载武装。`,
            }))
        : [];

  return {
    schema_version: d.schema_version || 1,
    type: 'maiden',
    id,
    name: uniqueDossierName,
    model,
    faction: factionRaw,
    tier: typeof d.tier === 'number' ? d.tier : 1,
    incubation_mode: d.incubation_mode || 'blindbox_christen',
    preset_name: d.preset_name || d.name,
    callsign: d.callsign || d.name,
    serial: d.serial || '',
    ...(d.seq ? { seq: d.seq } : {}),
    ...(d.body ? { body: d.body } : {}),
    form_mech: d.form_mech || '',
    temperament_spectrum: d.temperament_spectrum || d.personality || '',
    special_skills: specialSkills,
    special_equipment: specialEquipment,
    flaws: d.flaws || '',
    exposure_grade: d.exposure_grade || d.exposure || '🟢 低危（常规人类工业外观）',
    balance_slot: d.balance_slot || d.balance || 'T1 基础战术骨干',
  };
}

export function buildStructuredMaidenDataBlock(d: Dossier): string {
  return `<数据>\n${JSON.stringify(buildStructuredMaidenDataObject(d), null, 2)}\n</数据>`;
}

function buildCapabilityDataBlock(d: Dossier): string {
  if (hasStructuredMaidenDataFields(d)) {
    return buildStructuredMaidenDataBlock(d);
  }
  const lines = [
    '类型: 机娘',
    `名称: ${d.name}`,
    `代号: ${d.callsign || d.name}`,
    `编号: ${d.serial || ''}`,
    `型号: ${d.model || ''}`,
    `序列: ${d.seq || ''}`,
    `阵营: ${d.faction || ''}`,
    `躯体特征: ${d.body || ''}`,
    `形态机制: ${d.form_mech || ''}`,
    `武器: ${d.weapons || ''}`,
    `技能: ${(d.skills || '').replace(/\r?\n/g, '；')}`,
    `结构性短板: ${d.flaws || ''}`,
    `暴露分档: ${d.exposure || ''}`,
  ];
  return `<数据>\n${lines.join('\n')}\n</数据>`;
}

/**
 * 能力档案标准渲染（MAIDEN-CORE-01 & MAIDEN-DATA-01）：
 * 若含三段式 prose 或结构化 special_skills / special_equipment，输出三段式设定与同构 JSON `<数据>` 块；
 * 兼容旧版八段式与键值 `<数据>` 块。
 */
export function formatCapabilityContent(d: Dossier): string {
  if (d.prose && d.prose.trim()) {
    return joinSections([
      header(DOSSIER_BOOK, d),
      buildCapabilityMetaBlock(d),
      d.prose.trim(),
      buildStructuredMaidenDataBlock(d),
    ]);
  }
  const effectiveSkills =
    d.skills ||
    (Array.isArray(d.special_skills) && d.special_skills.length > 0
      ? d.special_skills.map(s => `· 【${s.name}（${s.kind}）】${s.desc}`).join('\n')
      : '');
  const effectiveWeapons =
    d.weapons ||
    (Array.isArray(d.special_equipment) && d.special_equipment.length > 0
      ? d.special_equipment.map(e => e.name).join('；')
      : '');
  const effectiveExposure = d.exposure || d.exposure_grade || '';
  const effectiveBalance = d.balance || d.balance_slot || '';
  const weaponBits = [
    effectiveWeapons ? `· 武器：${effectiveWeapons}` : null,
    effectiveExposure ? `· 暴露分档：${effectiveExposure}` : null,
    effectiveBalance ? `· 平衡总纲位置：${effectiveBalance}` : null,
  ].filter(Boolean);
  return joinSections([
    header(DOSSIER_BOOK, d),
    buildCapabilityMetaBlock(d),
    d.form_mech ? `形态机制：${d.form_mech}` : null,
    effectiveSkills ? `能力：\n${effectiveSkills}` : null,
    d.flaws ? `结构性短板：${d.flaws}` : null,
    weaponBits.length ? `【⚔ 武器与暴露分档】\n${weaponBits.join('\n')}` : null,
    buildCapabilityDataBlock(d),
  ]);
}

/** 档案书条目正文（八段格式，对齐既有白凌/旗舰条目体例；含新生命周期字段或结构化数据块字段时同步输出元标签与 <数据> 块） */
export function renderDossierContent(d: Dossier): string {
  const hasMaidenLifecycleFields = Boolean(
    d.serial || d.callsign || d.seq || d.faction || d.body || d.rename_from || hasStructuredMaidenDataFields(d),
  );
  if (hasMaidenLifecycleFields) {
    return formatCapabilityContent(d);
  }
  const weaponBits = [
    d.weapons ? `· 武器：${d.weapons}` : null,
    d.exposure ? `· 暴露分档：${d.exposure}` : null,
    d.balance ? `· 平衡总纲位置：${d.balance}` : null,
  ].filter(Boolean);
  return joinSections([
    header(DOSSIER_BOOK, d),
    d.form_mech ? `形态机制：${d.form_mech}` : null,
    d.skills ? `能力：\n${d.skills}` : null,
    d.flaws ? `结构性短板：${d.flaws}` : null,
    weaponBits.length ? `【⚔ 武器与暴露分档】\n${weaponBits.join('\n')}` : null,
  ]);
}

function resolvePlotShellLine(d: Dossier): string {
  const alias = (d.alias ?? '').trim();
  const shell = (d.shell ?? '').trim();
  if (!alias && !shell) return '暂未编织（基地内勤）';
  if (alias.includes('暂未编织') && (!shell || shell.includes('暂未编织'))) {
    return shell.includes('暂未编织（基地内勤）') ? shell : '暂未编织（基地内勤）';
  }
  if (!alias) {
    return shell.includes('暂未编织') ? '暂未编织（基地内勤）' : `${shell}（化名：暂未编织（基地内勤））`;
  }
  if (!shell) {
    return alias.includes('暂未编织') ? '暂未编织（基地内勤）' : `${alias}。暂未编织（基地内勤）`;
  }
  return `${alias}。${shell}`;
}

/** 剧情书人物条目正文（当 alias 或 shell 为空时，默认显示 暂未编织（基地内勤）） */
export function formatPlotContent(d: Dossier): string {
  const shellLine = resolvePlotShellLine(d);
  return joinSections([
    header(STORY_BOOK, d),
    d.serial ? `[出厂编号] ${d.serial}` : null,
    d.body ? `[躯体特征] ${d.body}` : null,
    `社会外壳：${shellLine}`,
    d.appearance ? `外观：\n${d.appearance}` : null,
    d.personality ? `性格：${d.personality}` : null,
    d.status ? `当前状态：${d.status}` : null,
  ]);
}

/** 剧情书人物条目正文（对齐既有「人格与现状」体例） */
export function renderStoryContent(d: Dossier): string {
  return formatPlotContent(d);
}

/** 阵容总览追加行（对齐既有「· 白凌——盟军MCV首台。对外：…。」体例） */
export function renderRosterLine(d: Dossier): string {
  const model = d.model || '新入列机娘';
  const shellText = typeof d.shell === 'string' ? d.shell.trim() : '';
  const aliasText = typeof d.alias === 'string' ? d.alias.trim() : '';
  const isUnwoven =
    (!aliasText && !shellText) || aliasText.includes('暂未编织') || shellText.includes('暂未编织');
  const hasMaidenFields = Boolean(d.serial || d.callsign || d.seq || d.faction || d.body);
  const outward = isUnwoven
    ? hasMaidenFields
      ? '暂未编织（基地内勤）'
      : '（待定）'
    : aliasText || shellText.split(/[。\n]/)[0] || '（待定）';
  return `· ${d.name}——${model}。对外：${outward}。`;
}

/** 档案书触发 key：本名 + 代号 + 编号 + AI 建议触发词（技能专名/型号），经 sanitizeWorldbookKeys 净化去重 */
export function dossierKeys(d: Dossier): string[] {
  const keys = Array.isArray(d.keys) ? d.keys : [];
  return sanitizeWorldbookKeys([d.name, d.callsign ?? '', d.serial ?? '', ...keys], d.name);
}

/** 剧情书触发 key：本名 + 代号 + 对外化名（过滤暂未编织占位词，经 sanitizeWorldbookKeys 净化去重） */
export function storyKeys(d: Dossier): string[] {
  const alias = (d.alias ?? '').trim();
  const validAlias = alias && !alias.includes('暂未编织') ? alias : '';
  return sanitizeWorldbookKeys([d.name, d.callsign ?? '', validAlias], d.name);
}

/* ═══════════════ 定位与续号（纯函数） ═══════════════ */

/** 70000 带内续号：max(order∈[70001,79999])+1；带内无条目则 70001 */
export function nextOrder(entries: ThEntry[]): number {
  const inBand = entries.map(e => Number(e.position?.order ?? 0)).filter(o => o >= 70001 && o <= 79999);
  return inBand.length ? Math.max(...inBand) + 1 : 70001;
}

/** comment 数字前缀续号（两位补零）：现有「02·白凌·…」→ 下一个「NN·」 */
export function nextSeq(entries: ThEntry[]): string {
  const nums = entries
    .map(e => /^(\d+)·/.exec(e.name)?.[1])
    .filter((s): s is string => !!s)
    .map(Number);
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return String(n).padStart(2, '0');
}

/** 按「·机娘名·」/「·机娘名」定位既有条目（comment 约定：NN·名·后缀） */
export function findByGirl(entries: ThEntry[], name: string): ThEntry | undefined {
  return entries.find(e => entryTitle(e).includes(`·${name}·`) || entryTitle(e).endsWith(`·${name}`));
}

/**
 * 段位定位（聊天书单本分段模式）：
 * 1. 按 `档案·${d.name}·` / `剧情·${d.name}·` 精确前缀查找；
 * 2. 若 `d.rename_from` 非空，同时查找 `档案·${d.rename_from}·` / `剧情·${d.rename_from}·`；
 * 3. 若 `d.serial` 非空，同时回扫同分段内 `content` 含 `[出厂编号] ${d.serial}` 的条目。
 */
export function findInSegment(
  entries: ThEntry[],
  segment: string,
  name: string,
  d?: Partial<Dossier>,
): ThEntry | undefined {
  const byName = entries.find(e => entryTitle(e).startsWith(`${segment}·${name}·`));
  if (byName) return byName;

  const renameFrom = d?.rename_from?.trim();
  const serial = d?.serial?.trim();

  if (renameFrom) {
    const candidates = entries.filter(
      e =>
        entryTitle(e).startsWith(`${segment}·${renameFrom}·`) ||
        (serial ? entryTitle(e).startsWith(`${segment}·待授名·${serial}`) : false),
    );
    if (candidates.length > 1 && serial) {
      const hitBySerial = candidates.find(e => (e.content ?? '').includes(`[出厂编号] ${serial}`));
      if (hitBySerial) return hitBySerial;
    }
    if (candidates.length > 0) return candidates[0];
  }

  if (serial) {
    const bySerial = entries.find(
      e =>
        entryTitle(e).startsWith(`${segment}·`) &&
        ((e.content ?? '').includes(`[出厂编号] ${serial}`) ||
          (e.content ?? '').includes(`编号: ${serial}`) ||
          entryTitle(e).startsWith(`${segment}·${serial}·`) ||
          entryTitle(e).startsWith(`${segment}·待授名·${serial}`)),
    );
    if (bySerial) return bySerial;
  }

  const model = d?.model?.trim();
  if (model && !name.includes('待授名') && !name.includes('未授名')) {
    const pendingSameModel = entries.filter(e => {
      const t = entryTitle(e);
      return (
        t.startsWith(`${segment}·`) &&
        (t.includes('待授名') || t.includes('未授名')) &&
        (t.endsWith(`·${model}`) || (e.content ?? '').includes(`——${model}]`) || (e.content ?? '').includes(`型号: ${model}`))
      );
    });
    if (pendingSameModel.length === 1) return pendingSameModel[0];
  }

  return undefined;
}

/* ═══════════════ upsert（纯函数：entries 进出） ═══════════════ */

/**
 * 解析机娘在当前聊天世界书中真实将写入/更新的完整条目名：
 * - dossierEntryName: `档案·${d.name}·${d.model || '能力档案'}`
 * - storyEntryName: `剧情·${d.name}·人格与现状`
 * 若提供了 entries，先行调用 findInSegment 对齐段位寻址。
 */
export function resolveGirlWorldbookEntryNames(
  d: Dossier,
  entries?: readonly ThEntry[],
): { dossierEntryName: string; storyEntryName: string } {
  if (entries) {
    findInSegment(entries as ThEntry[], '档案', d.name, d);
    findInSegment(entries as ThEntry[], '剧情', d.name, d);
  }
  return {
    dossierEntryName: `档案·${d.name}·${d.model || '能力档案'}`,
    storyEntryName: `剧情·${d.name}·人格与现状`,
  };
}

export interface UpsertResult {
  entries: ThEntry[];
  action: 'created' | 'updated';
  entryName: string;
}

/** 档案段 upsert：comment 前缀「档案·{名}·」分段（§4.1 单本聊天书）；命中旧条目时原地更新其 comment/name、key 与 content */
export function upsertDossierEntry(entries: ThEntry[], d: Dossier): UpsertResult {
  const existing = findInSegment(entries, '档案', d.name, d);
  const content = renderDossierContent(d);
  const keys = dossierKeys(d);
  const { dossierEntryName: entryName } = resolveGirlWorldbookEntryNames(d);
  if (existing) {
    existing.name = entryName;
    existing.comment = entryName;
    existing.content = content;
    existing.strategy = { ...existing.strategy, type: 'selective', keys };
    existing.key = keys;
    existing.keys = keys;
    existing.recursion = { prevent_incoming: true, prevent_outgoing: true, delay_until: null };
    existing.matchWholeWords = false;
    existing.caseSensitive = false;
    existing.excludeRecursion = true;
    existing.preventRecursion = true;
    return { entries, action: 'updated', entryName };
  }
  entries.push({
    name: entryName,
    comment: entryName,
    key: keys,
    keys,
    enabled: true,
    strategy: { type: 'selective', keys },
    position: { type: 'before_character_definition', order: nextOrder(entries) },
    content,
    probability: 100,
    recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
    matchWholeWords: false,
    caseSensitive: false,
    excludeRecursion: true,
    preventRecursion: true,
  });
  return { entries, action: 'created', entryName };
}

export interface StoryUpsertResult extends UpsertResult {
  /** roster-entry-created：聊天书内首写自建总览条目（空阵容起步，§4.1） */
  rosterAction: 'appended' | 'already-present' | 'roster-entry-created';
}

/** 剧情段 upsert：comment 前缀「剧情·{名}·」分段；命中旧条目时原地更新其 comment/name、key 与 content */
export function upsertStoryEntry(entries: ThEntry[], d: Dossier): StoryUpsertResult {
  const existing = findInSegment(entries, '剧情', d.name, d);
  const content = renderStoryContent(d);
  const keys = storyKeys(d);
  const { storyEntryName: entryName } = resolveGirlWorldbookEntryNames(d);
  let action: 'created' | 'updated';
  if (existing) {
    existing.name = entryName;
    existing.comment = entryName;
    existing.content = content;
    existing.strategy = { ...existing.strategy, type: 'selective', keys };
    existing.key = keys;
    existing.keys = keys;
    existing.recursion = { prevent_incoming: true, prevent_outgoing: true, delay_until: null };
    existing.matchWholeWords = false;
    existing.caseSensitive = false;
    existing.excludeRecursion = true;
    existing.preventRecursion = true;
    action = 'updated';
  } else {
    entries.push({
      name: entryName,
      comment: entryName,
      key: keys,
      keys,
      enabled: true,
      strategy: { type: 'selective', keys },
      position: { type: 'before_character_definition', order: nextOrder(entries) },
      content,
      probability: 100,
      recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
      matchWholeWords: false,
      caseSensitive: false,
      excludeRecursion: true,
      preventRecursion: true,
    });
    action = 'created';
  }
  // 阵容总览行（幂等：已含「· 名——」则更新/不追加；若含 rename_from 旧名行则原地替换）
  let roster = entries.find(e => entryTitle(e).includes(ROSTER_MARK));
  let rosterAction: StoryUpsertResult['rosterAction'];
  const newRosterLine = renderRosterLine(d);
  if (!roster) {
    const rosterTitle = `总览·${ROSTER_MARK}`;
    roster = {
      name: rosterTitle,
      comment: rosterTitle,
      enabled: true,
      strategy: { type: 'constant', keys: [] },
      position: { type: 'before_character_definition', order: 70000 },
      content: `[本聊天机娘阵容总览]\n${newRosterLine}`,
      probability: 100,
      recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
      excludeRecursion: true,
      preventRecursion: true,
    };
    entries.push(roster);
    rosterAction = 'roster-entry-created';
  } else {
    roster.recursion = { prevent_incoming: true, prevent_outgoing: true, delay_until: null };
    roster.excludeRecursion = true;
    roster.preventRecursion = true;
    const currentRosterContent = roster.content ?? '';
    const renameFrom = d.rename_from?.trim();
    const serial = d.serial?.trim();
    const model = d.model?.trim();
    if (currentRosterContent.includes(`· ${d.name}——`)) {
      const lines = currentRosterContent.split('\n').map(line =>
        line.startsWith(`· ${d.name}——`) ? newRosterLine : line,
      );
      roster.content = lines.join('\n');
      rosterAction = 'already-present';
    } else if (renameFrom && currentRosterContent.includes(`· ${renameFrom}——`)) {
      const lines = currentRosterContent.split('\n').map(line =>
        line.startsWith(`· ${renameFrom}——`) ? newRosterLine : line,
      );
      roster.content = lines.join('\n');
      rosterAction = 'already-present';
    } else if (
      serial &&
      (currentRosterContent.includes(`· 待授名·${serial}——`) || currentRosterContent.includes(`· ${serial}——`))
    ) {
      const lines = currentRosterContent.split('\n').map(line =>
        line.startsWith(`· 待授名·${serial}——`) || line.startsWith(`· ${serial}——`) ? newRosterLine : line,
      );
      roster.content = lines.join('\n');
      rosterAction = 'already-present';
    } else if (
      model &&
      !d.name.includes('待授名') &&
      currentRosterContent.split('\n').some(l => l.startsWith('· 待授名') && l.includes(`——${model}。`))
    ) {
      let replaced = false;
      const lines = currentRosterContent.split('\n').map(line => {
        if (!replaced && line.startsWith('· 待授名') && line.includes(`——${model}。`)) {
          replaced = true;
          return newRosterLine;
        }
        return line;
      });
      roster.content = lines.join('\n');
      rosterAction = 'already-present';
    } else {
      roster.content = `${currentRosterContent.replace(/\s*$/, '')}\n${newRosterLine}`;
      rosterAction = 'appended';
    }
  }
  return { entries, action, entryName, rosterAction };
}

/* ═══════════════ 提交（副作用层） ═══════════════ */

export interface FileReceipt {
  girl: string;
  dossier: { book: string; action: string; entryName: string };
  story: { book: string; action: string; entryName: string; rosterAction: string };
}

export type FileDossierReceipt = FileReceipt;

type UpdateWorldbookWith = (name: string, updater: (entries: ThEntry[]) => ThEntry[]) => Promise<ThEntry[]>;

/**
 * 单个机娘档案入当前聊天档案书（§4.1 改挂：经三重守卫，守卫失败/建书失败/API 缺失均抛错
 * fail-closed——调用方 useGirlFiler 留 pending_lore 可重试，暂存机制原样复用）。
 * 档案段与剧情段同书两笔写入，每笔落笔前守卫现场重跑（写入中途切聊天由守卫①拦截）。
 * gateway 参数可注入（测试用桩）；不注入时用真实酒馆绑定层。
 */
export async function fileDossier(d: Dossier, gateway: ChatBookGatewayLike = chatBookGateway): Promise<FileReceipt> {
  const updateWb = tav<UpdateWorldbookWith>('updateWorldbookWith');
  if (!updateWb) throw new Error('酒馆 API updateWorldbookWith 不可用（独立预览环境无法入档）');

  const txn = gateway.begin();
  // 守卫②允许惰性建书（§3.1 首写触发）；任一守卫失败抛 GuardError，绝不降级写全局书
  const dossierBook = await gateway.guardedBook(txn, { createIfMissing: true });
  let dossierRes: UpsertResult | null = null;
  await updateWb(dossierBook, entries => {
    dossierRes = upsertDossierEntry(entries, d);
    return dossierRes.entries;
  });

  // 第二笔落笔前现场重跑守卫（同书；书已存在，不再声明建书意图）
  const storyBook = await gateway.guardedBook(txn, { createIfMissing: false });
  let storyRes: StoryUpsertResult | null = null;
  await updateWb(storyBook, entries => {
    storyRes = upsertStoryEntry(entries, d);
    return storyRes.entries;
  });

  const dr = dossierRes as UpsertResult | null;
  const sr = storyRes as StoryUpsertResult | null;
  return {
    girl: d.name,
    dossier: { book: dossierBook, action: dr?.action ?? 'unknown', entryName: dr?.entryName ?? '' },
    story: {
      book: storyBook,
      action: sr?.action ?? 'unknown',
      entryName: sr?.entryName ?? '',
      rosterAction: sr?.rosterAction ?? 'unknown',
    },
  };
}

/**
 * 单个机娘入档世界书统一入口（支持直接对 entries 数组执行纯函数双段 upsert，或经 gateway 执行聊天书写入）
 */
export function fileSingleGirlToWorldbook(
  entries: ThEntry[],
  d: Dossier,
): { entries: ThEntry[]; dossier: UpsertResult; story: StoryUpsertResult };
export function fileSingleGirlToWorldbook(
  d: Dossier,
  entries: ThEntry[],
): { entries: ThEntry[]; dossier: UpsertResult; story: StoryUpsertResult };
export function fileSingleGirlToWorldbook(d: Dossier, gateway?: ChatBookGatewayLike): Promise<FileReceipt>;
export function fileSingleGirlToWorldbook(
  first: Dossier | ThEntry[],
  second?: ChatBookGatewayLike | ThEntry[] | Dossier,
): Promise<FileReceipt> | { entries: ThEntry[]; dossier: UpsertResult; story: StoryUpsertResult } {
  if (Array.isArray(first)) {
    const entries = first;
    const d = second as Dossier;
    const dossier = upsertDossierEntry(entries, d);
    const story = upsertStoryEntry(entries, d);
    return { entries, dossier, story };
  }
  if (Array.isArray(second)) {
    const d = first as Dossier;
    const entries = second;
    const dossier = upsertDossierEntry(entries, d);
    const story = upsertStoryEntry(entries, d);
    return { entries, dossier, story };
  }
  return fileDossier(first as Dossier, second as ChatBookGatewayLike | undefined);
}

