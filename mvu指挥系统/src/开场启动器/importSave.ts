/**
 * 阶段 G · 存档导入纯函数层（零宿主依赖，可 vitest 直测）
 *
 * 对接指挥系统「导出存档到剪贴板」（PanelSystem.vue G1）产出的导出包：
 * `{ version, kind: 'redalert-save', exportedAt, source: { chat, message_id }, stat_data }`
 *
 * 防御原则：任何解析失败都返回 `{ ok: false, error }`，绝不 throw 到 UI 层；
 * stat_data 一律经 Schema.parse 归一（老存档缺键自动兑底，脏形态直接拒收）。
 */

import { migrateV1toV2, Schema } from '../红警指挥系统/core/schema';
import { getWorldManifest } from '../红警指挥系统/core/worlds';
import {
  defaultDateForWorld,
  defaultFactionAdjutantFor,
  findLocation,
  locationsForWorld,
  resolveSelectedFactions,
  type FactionAdjutantConfig,
  type HumanRosterMember,
  type LaunchChoices,
} from './presets';

/** SavePack V2 聊天绑定档案世界书词条快照（FD-37 · D-SAVE-GARRISON-01 全保真导出/导入） */
export interface SavePackWorldbookEntry {
  name: string;
  content: string;
  enabled?: boolean;
  comment?: string;
  keys?: string[];
  position?: Record<string, unknown>;
  strategy?: Record<string, unknown>;
  recursion?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

/** 存档导出包（G1 导出 / G2 导入共用的线格式契约，兼容 V1 与 SEAM-06 SavePack V2） */
export interface SavePack {
  version: number;
  kind: 'redalert-save';
  exportedAt: string;
  source: { chat: string; message_id: number };
  /** 已经 Schema.parse 归一化的变量树 */
  stat_data: Schema;
  /** 仅供导入 UI 提示；不写回变量树 */
  migratedFromV1?: true;
  /** SavePack V2 扩展载荷（SEAM-06） */
  parse_state?: Record<string, unknown>;
  dlc_registry?: unknown[];
  timeline_ledger?: Record<string, unknown>;
  chat_worldbook_entries?: SavePackWorldbookEntry[];
  /** 存档结构代数（FD-47，默认 2） */
  save_schema?: number;
  /** 导出时的角色卡元数据快照（FD-47） */
  card_meta?: {
    name: string;
    version: string;
    avatar?: string;
  };
}

const importedStatPackRegistry = new WeakMap<object, SavePack>();
let lastParsedSavePack: SavePack | null = null;

/** 循环解包 Vue reactive Proxy（读取 __v_raw 直至拿到非 Proxy 原始对象） */
export function unwrapRawObject(val: unknown): object | null {
  if (typeof val !== 'object' || val === null) return null;
  let cur: unknown = val;
  let guard = 0;
  while (typeof cur === 'object' && cur !== null && guard++ < 8) {
    const raw = (cur as { __v_raw?: unknown }).__v_raw;
    if (!raw || raw === cur) break;
    cur = raw;
  }
  return typeof cur === 'object' && cur !== null ? cur : null;
}

/** 清除最近一次导入存档包缓存（供 UI「清除存档继承」调用） */
export function clearLastParsedSavePack(): void {
  lastParsedSavePack = null;
}

/** 根据 choices.importedStat 反查原 SavePack（供 pipeline 导入恢复 V2 扩展状态） */
export function getSavePackForImportedStat(importedStat: unknown): SavePack | undefined {
  const rawObj = unwrapRawObject(importedStat);
  if (!rawObj) return undefined;
  const direct = importedStatPackRegistry.get(rawObj);
  if (direct) return direct;
  if (typeof importedStat === 'object' && importedStat !== null) {
    const byProxy = importedStatPackRegistry.get(importedStat);
    if (byProxy) return byProxy;
  }
  const statLike = rawObj as { meta?: { world_id?: string; date?: string } };
  if (
    lastParsedSavePack &&
    statLike.meta?.world_id === lastParsedSavePack.stat_data.meta.world_id &&
    statLike.meta?.date === lastParsedSavePack.stat_data.meta.date
  ) {
    return lastParsedSavePack;
  }
  return undefined;
}

export type ParseSaveResult = { ok: true; pack: SavePack } | { ok: false; error: string };
export type ImportSaveResult = ParseSaveResult;

/** 解析粘贴文本 → 归一化存档包；失败给人话错误（UI 红框直显） */
export function parseSavePack(text: string): ParseSaveResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法 JSON——请粘贴指挥系统「导出存档到剪贴板」复制的完整内容' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'JSON 结构不对（应为对象）——这不是本系统的存档导出包' };
  }
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'redalert-save') {
    return { ok: false, error: '档案标识不匹配（kind 不是 redalert-save）——请确认粘贴的是红警指挥系统导出的战局档案' };
  }
  if (typeof r.version !== 'number') {
    return { ok: false, error: '存档缺 version 字段（或非数字）' };
  }
  if (typeof r.stat_data !== 'object' || r.stat_data === null) {
    return { ok: false, error: '档案缺少核心战局数据（stat_data）——导出时所在楼层可能尚未生成战局数据' };
  }
  let stat: Schema;
  const migrated = migrateV1toV2(r.stat_data);
  try {
    stat = Schema.parse(migrated);
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 120) : String(e);
    return { ok: false, error: `stat_data 不符合变量树结构：${detail}` };
  }
  if (!getWorldManifest(stat.meta.world_id)) {
    return { ok: false, error: `stat_data.world_id「${stat.meta.world_id || '空'}」未注册，不能安全导入` };
  }
  const src =
    typeof r.source === 'object' && r.source !== null && !Array.isArray(r.source)
      ? (r.source as Record<string, unknown>)
      : {};
  const parse_state =
    typeof r.parse_state === 'object' && r.parse_state !== null && !Array.isArray(r.parse_state)
      ? (r.parse_state as Record<string, unknown>)
      : undefined;
  const dlc_registry = Array.isArray(r.dlc_registry) ? (r.dlc_registry as unknown[]) : undefined;
  const timeline_ledger =
    typeof r.timeline_ledger === 'object' && r.timeline_ledger !== null && !Array.isArray(r.timeline_ledger)
      ? (r.timeline_ledger as Record<string, unknown>)
      : undefined;
  const isPlainObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  const chat_worldbook_entries = Array.isArray(r.chat_worldbook_entries)
    ? r.chat_worldbook_entries
        .filter(
          (e): e is Record<string, unknown> =>
            isPlainObj(e) && typeof (e as { name?: unknown }).name === 'string',
        )
        .map((e): SavePackWorldbookEntry => ({
          name: String(e.name),
          content: typeof e.content === 'string' ? e.content : '',
          ...(typeof e.enabled === 'boolean' ? { enabled: e.enabled } : {}),
          ...(typeof e.comment === 'string' && e.comment ? { comment: e.comment } : {}),
          ...(Array.isArray(e.keys) ? { keys: e.keys.map(k => String(k)) } : {}),
          ...(isPlainObj(e.position) ? { position: JSON.parse(JSON.stringify(e.position)) } : {}),
          ...(isPlainObj(e.strategy) ? { strategy: JSON.parse(JSON.stringify(e.strategy)) } : {}),
          ...(isPlainObj(e.recursion) ? { recursion: JSON.parse(JSON.stringify(e.recursion)) } : {}),
          ...(isPlainObj(e.extra) ? { extra: JSON.parse(JSON.stringify(e.extra)) } : {}),
        }))
    : undefined;

  const save_schema =
    typeof r.save_schema === 'number' && Number.isInteger(r.save_schema) && r.save_schema > 0
      ? Number(r.save_schema)
      : r.version === 2
        ? 2
        : 1;
  const card_meta =
    isPlainObj(r.card_meta) &&
    typeof r.card_meta.name === 'string' &&
    typeof r.card_meta.version === 'string'
      ? {
          name: r.card_meta.name,
          version: r.card_meta.version,
          ...(typeof r.card_meta.avatar === 'string' && r.card_meta.avatar
            ? { avatar: r.card_meta.avatar }
            : {}),
        }
      : undefined;

  const pack: SavePack = {
    version: r.version,
    kind: 'redalert-save',
    exportedAt: typeof r.exportedAt === 'string' ? r.exportedAt : '',
    source: {
      chat: typeof src.chat === 'string' ? src.chat : '',
      message_id: typeof src.message_id === 'number' ? src.message_id : -1,
    },
    stat_data: stat,
    save_schema,
    ...(migrated !== r.stat_data ? { migratedFromV1: true as const } : {}),
    ...(parse_state !== undefined ? { parse_state } : {}),
    ...(dlc_registry !== undefined ? { dlc_registry } : {}),
    ...(timeline_ledger !== undefined ? { timeline_ledger } : {}),
    ...(chat_worldbook_entries !== undefined ? { chat_worldbook_entries } : {}),
    ...(card_meta !== undefined ? { card_meta } : {}),
  };
  importedStatPackRegistry.set(stat, pack);
  lastParsedSavePack = pack;
  return {
    ok: true,
    pack,
  };
}

/**
 * 从浏览器本地选择的 `.json` 文件读取并解析 SavePack（FD-47）
 * 优先使用 `file.text()`，降级使用 `FileReader`；任何读取或解析异常均捕获并返回 `{ ok: false, error }`。
 */
export async function readSavePackFromFile(file: File): Promise<ImportSaveResult> {
  if (!file || typeof file !== 'object') {
    return { ok: false, error: '未选择有效的备份文件' };
  }
  try {
    let text: string;
    if (typeof file.text === 'function') {
      text = await file.text();
    } else if (typeof FileReader !== 'undefined') {
      text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
        reader.readAsText(file, 'utf-8');
      });
    } else {
      return { ok: false, error: '当前运行环境不支持本地文件读取' };
    }
    if (!text || !text.trim()) {
      return { ok: false, error: '所选备份文件内容为空' };
    }
    return parseSavePack(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `读取备份文件失败：${detail}` };
  }
}

export interface ImportChoicesResult {
  /** 回填后的完整 choices（新对象，不改入参） */
  choices: LaunchChoices;
  /** 非致命偏差（如存档基地不在部署地点列表），UI 黄字提示 */
  warnings: string[];
}

/**
 * 存档包 → 向导选择回填（G2 契约）：
 * - 难度强制 'custom'（存档数值全量进 custom* 覆写通道）
 * - custom 资金←economy.credits、custom 科技←tech.done、暴露←exposure.value、日期←meta.date
 * - worldId←meta.world_id；地点优先保留 bases[0] 既有 id，缺失时回落该世界默认地点
 * - personaMode 不动（导入的是战局进度，不是指挥官身份）
 * - importedFrom←source.chat（经 snapshotChoices 透传进 $boot 快照）
 */
export function packToChoices(pack: SavePack, current: LaunchChoices): ImportChoicesResult {
  const warnings: string[] = [];
  if (pack.migratedFromV1) warnings.push('旧版 v1 存档已迁移为 v2（世界按修真正史处理）');
  const sd = pack.stat_data;
  const next: LaunchChoices = {
    ...current,
    worldId: sd.meta.world_id,
    preset: 'custom',
    customCredits: sd.economy.credits,
    customTech: [...sd.tech.done],
    customExposure: sd.exposure.value,
    importedFrom: pack.source.chat,
    // G2 修正：全量变量树随 choices 透传，buildStatData 以此为基线无缝继承机娘/建筑/图鉴/队列等进度
    importedStat: sd,
  };
  const rawSd = unwrapRawObject(sd);
  if (rawSd) importedStatPackRegistry.set(rawSd, pack);
  importedStatPackRegistry.set(sd, pack);
  lastParsedSavePack = pack;
  if (Array.isArray(sd.command?.unlocked_factions) && sd.command.unlocked_factions.length > 0) {
    const unlocked = resolveSelectedFactions(sd.command.unlocked_factions);
    next.selectedFactions = unlocked;
    next.factionId = unlocked[0] || 'allied';
  }
  const factionAdjutants: Record<string, FactionAdjutantConfig> = {
    ...(current.factionAdjutants ?? {}),
  };
  for (const fid of next.selectedFactions ?? ['allied']) {
    if (!factionAdjutants[fid]) {
      factionAdjutants[fid] = defaultFactionAdjutantFor(fid);
    }
  }
  if (Array.isArray(sd.command?.adjutants) && sd.command.adjutants.length > 0) {
    const humanRoster: HumanRosterMember[] = [];
    for (const adj of sd.command.adjutants) {
      if (adj.role === 'faction' && adj.faction) {
        const baseSlot = factionAdjutants[adj.faction] ?? defaultFactionAdjutantFor(adj.faction);
        factionAdjutants[adj.faction] = {
          ...baseSlot,
          identity: adj.identity,
          name: adj.name,
          title: adj.title,
          buffPreset: adj.buff_preset || baseSlot.buffPreset,
        };
        if (adj.identity === 'human' && adj.name.trim()) {
          humanRoster.push({
            id: adj.id || `human_${adj.faction}`,
            name: adj.name.trim(),
            title: adj.title || '',
            faction: adj.faction,
            buffPreset: adj.buff_preset || 'logistics_actuary',
            bio: adj.note || '',
            assignment: `faction:${adj.faction}`,
          });
        }
      } else if (adj.role === 'staff') {
        next.staffAdjutant = {
          enabled: true,
          name: adj.name,
          title: adj.title,
          buffPreset: adj.buff_preset || 'logistics_actuary',
        };
        if (adj.name.trim()) {
          humanRoster.push({
            id: adj.id || 'human_staff',
            name: adj.name.trim(),
            title: adj.title || '战区联席参谋官',
            faction: 'common',
            buffPreset: adj.buff_preset || 'logistics_actuary',
            bio: adj.note || '',
            assignment: 'staff',
          });
        }
      }
    }
    if (humanRoster.length > 0) {
      next.humanRoster = humanRoster;
    }
  }
  next.factionAdjutants = factionAdjutants;
  if (sd.meta.date.trim()) {
    next.date = sd.meta.date;
  } else {
    next.date = defaultDateForWorld(sd.meta.world_id);
    warnings.push('存档无日期记录，已回落该世界默认日期');
  }
  const baseId = sd.bases[0]?.id;
  const worldLocations = locationsForWorld(sd.meta.world_id);
  if (baseId) {
    next.locationId = baseId;
    if (!worldLocations.some(location => location.id === baseId)) {
      warnings.push(`存档基地「${baseId}」不在「${getWorldManifest(sd.meta.world_id)!.display_name}」预设列表，将按存档原址保留`);
    }
  } else {
    next.locationId = findLocation('', sd.meta.world_id).id;
    warnings.push('存档无基地记录，已回落该世界默认地点');
  }
  return { choices: next, warnings };
}
