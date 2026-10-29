/**
 * floorCardParsers.ts —— 楼层卡片载荷提取、YAML/键值解析、颜色白名单消毒与归一化（CMD-CARD-01 / MAIDEN-CARD-01）
 */
import * as YAML from 'yaml';

export type FactionKey = 'soviet' | 'allied' | 'yuri';

export interface FactionColorPalette {
  primary: string;
  accent: string;
  bg: string;
}

export interface FactionDetailEntry {
  label: string;
  value: string;
}

export interface ParsedFactionUnlock {
  faction: FactionKey;
  badge: string;
  title: string;
  subtitle: string;
  emblem: string;
  primaryColor: string;
  accentColor: string;
  bgColor: string;
  starterGirlName: string;
  starterGirlModel: string;
  starterGirlQuote: string;
  details: FactionDetailEntry[];
  initialGrants: string[];
}

export const FACTION_DEFAULT_PALETTES: Readonly<Record<FactionKey, FactionColorPalette>> = {
  soviet: { primary: '#c93b2b', accent: '#d4a84f', bg: '#140c0c' },
  allied: { primary: '#2563eb', accent: '#38bdf8', bg: '#0b1324' },
  yuri: { primary: '#7e22ce', accent: '#c084fc', bg: '#160b24' },
};

export const FACTION_DEFAULT_THEMES = FACTION_DEFAULT_PALETTES;

interface DefaultFactionMetaItem {
  badge: string;
  title: string;
  subtitle: string;
  emblem: string;
  starterGirlName: string;
  starterGirlModel: string;
  starterGirlQuote: string;
}

const DEFAULT_FACTION_META: Readonly<Record<FactionKey, DefaultFactionMetaItem>> = {
  soviet: {
    badge: 'SOVIET // 赤色重工启封',
    title: '苏联战区编制正式启封',
    subtitle: '战区最高统帅部 · 重核工业与钢铁洪流并网卷宗',
    emblem: '☭ RED STAR',
    starterGirlName: '喀秋莎',
    starterGirlModel: 'MCV-SOV 重型机动基地车核心机娘',
    starterGirlQuote: '同志，重核反应堆已满功率轰鸣，钢铁洪流随时为您碾碎一切阻碍！',
  },
  allied: {
    badge: 'ALLIED // 联合精确制导启封',
    title: '盟军战区编制正式启封',
    subtitle: '战区最高统帅部 · 宙斯盾空天信息网与超时空并网卷宗',
    emblem: '🦅 AEGIS WING',
    starterGirlName: '雅典娜',
    starterGirlModel: 'MCV-AL 战术机动基地车核心机娘',
    starterGirlQuote: '指挥官，全球卫星链路与超时空信标已校准完毕，请下达展开指令。',
  },
  yuri: {
    badge: 'YURI // 厄普西隆心灵启封',
    title: '尤里战区编制正式启封',
    subtitle: '战区最高统帅部 · 心灵信标与基因工程并网卷宗',
    emblem: 'Ψ PSI CORPS',
    starterGirlName: '天秤',
    starterGirlModel: 'MCV-PSI 心灵机动基地车核心机娘',
    starterGirlQuote: '思维波频已与您的意志完全同调，战区的一切都将归于统一。',
  },
};

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_COLOR_RE =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i;
const HSL_COLOR_RE =
  /^hsla?\(\s*(\d{1,3})(?:deg)?\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i;
const FORBIDDEN_COLOR_TOKENS_RE = /[;<>\\{}]|url\s*\(|expression\s*\(|var\s*\(|javascript:/i;

/**
 * 校验颜色字符串是否符合安全白名单（仅允许 `#rgb/#rrggbb/#rrggbbaa` 或安全 `rgb()/hsl()`）。
 * 任何含 `;`、`url(`、`expression(`、`var(` 等非法字符或调用一律拒绝。
 */
export function isSafeCssColor(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed || FORBIDDEN_COLOR_TOKENS_RE.test(trimmed)) return false;

  if (HEX_COLOR_RE.test(trimmed)) return true;

  const rgbMatch = RGB_COLOR_RE.exec(trimmed);
  if (rgbMatch) {
    const channels = [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
    return channels.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
  }

  const hslMatch = HSL_COLOR_RE.exec(trimmed);
  if (hslMatch) {
    const h = Number(hslMatch[1]);
    const s = Number(hslMatch[2]);
    const l = Number(hslMatch[3]);
    return h >= 0 && h <= 360 && s >= 0 && s <= 100 && l >= 0 && l <= 100;
  }

  return false;
}

/**
 * 消毒单个颜色字段；若不合法则回退到指定默认安全色。
 */
export function sanitizeCardColor(raw: unknown, fallback: string): string {
  if (isSafeCssColor(raw)) {
    return raw.trim();
  }
  return fallback;
}

export function normalizeFactionKey(raw: unknown, textHint = ''): FactionKey {
  const combined = `${String(raw ?? '')} ${textHint}`.trim().toLowerCase();
  if (
    combined.includes('soviet') ||
    combined.includes('苏联') ||
    combined.includes('苏维埃') ||
    combined.includes('红军') ||
    combined.includes('赤色')
  ) {
    return 'soviet';
  }
  if (
    combined.includes('yuri') ||
    combined.includes('epsilon') ||
    combined.includes('尤里') ||
    combined.includes('厄普西隆') ||
    combined.includes('心灵')
  ) {
    return 'yuri';
  }
  if (
    combined.includes('allied') ||
    combined.includes('allies') ||
    combined.includes('盟军') ||
    combined.includes('联合')
  ) {
    return 'allied';
  }
  return 'allied';
}

function normalizeDetailsList(raw: unknown): FactionDetailEntry[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const out: FactionDetailEntry[] = [];
    for (const item of raw) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        const label = String(rec.label ?? rec.key ?? rec.name ?? rec.title ?? '').trim();
        const value = String(rec.value ?? rec.desc ?? rec.content ?? '').trim();
        if (label || value) {
          out.push({ label: label || '条目', value });
        }
      } else if (typeof item === 'string' && item.trim()) {
        const idx = item.indexOf(':');
        const cnIdx = item.indexOf('：');
        const splitAt = idx >= 0 ? idx : cnIdx;
        if (splitAt > 0) {
          out.push({
            label: item.slice(0, splitAt).trim(),
            value: item.slice(splitAt + 1).trim(),
          });
        } else {
          out.push({ label: '并网条目', value: item.trim() });
        }
      }
    }
    return out;
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([k, v]) => ({
        label: String(k).trim(),
        value: typeof v === 'string' ? v.trim() : JSON.stringify(v),
      }))
      .filter(entry => entry.label.length > 0);
  }
  return [];
}

function normalizeGrantsList(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(item => String(item ?? '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[\n,，;；]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  return [];
}

function parseRawPayloadObject(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input !== 'string') return {};
  const trimmed = input
    .trim()
    .replace(/^<阵营解锁>\s*/i, '')
    .replace(/\s*<\/阵营解锁>$/i, '')
    .trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* continue to YAML */
  }
  try {
    const parsed = YAML.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fallback empty */
  }
  return {};
}

const PARSE_CACHE_LIMIT = 256;
const parserCache = new Map<string, unknown>();

function cloneCached<T>(val: T): T {
  if (val === null || val === undefined || typeof val !== 'object') return val;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(val);
    } catch {
      /* fallback to JSON clone */
    }
  }
  return JSON.parse(JSON.stringify(val)) as T;
}

function getFromParserCache<T>(prefix: string, rawInput: unknown): { hit: true; value: T } | { hit: false } {
  if (typeof rawInput !== 'string') return { hit: false };
  const key = `${prefix}::${rawInput}`;
  if (!parserCache.has(key)) return { hit: false };
  const cached = parserCache.get(key) as T;
  parserCache.delete(key);
  parserCache.set(key, cached);
  return { hit: true, value: cloneCached(cached) };
}

function setIntoParserCache<T>(prefix: string, rawInput: unknown, value: T): T {
  if (typeof rawInput !== 'string') return value;
  const key = `${prefix}::${rawInput}`;
  if (parserCache.has(key)) {
    parserCache.delete(key);
  } else if (parserCache.size >= PARSE_CACHE_LIMIT) {
    const oldestKey = parserCache.keys().next().value;
    if (oldestKey !== undefined) {
      parserCache.delete(oldestKey);
    }
  }
  parserCache.set(key, cloneCached(value));
  return value;
}

/**
 * 将原始字符串（JSON / YAML）或结构化对象解析为安全的 `ParsedFactionUnlock`。
 */
export function parseFactionUnlockPayload(
  input: ParsedFactionUnlock | string | Record<string, unknown> | null | undefined,
): ParsedFactionUnlock {
  const cached = getFromParserCache<ParsedFactionUnlock>('faction-unlock', input);
  if (cached.hit) return cached.value;
  const obj = parseRawPayloadObject(input);
  const starterGirlObj =
    obj.starterGirl && typeof obj.starterGirl === 'object'
      ? (obj.starterGirl as Record<string, unknown>)
      : obj.starter_girl && typeof obj.starter_girl === 'object'
        ? (obj.starter_girl as Record<string, unknown>)
        : obj['首发机娘'] && typeof obj['首发机娘'] === 'object'
          ? (obj['首发机娘'] as Record<string, unknown>)
          : {};
  const colorsObj =
    obj.colors && typeof obj.colors === 'object'
      ? (obj.colors as Record<string, unknown>)
      : obj.theme && typeof obj.theme === 'object'
        ? (obj.theme as Record<string, unknown>)
        : obj['配色'] && typeof obj['配色'] === 'object'
          ? (obj['配色'] as Record<string, unknown>)
          : {};

  const rawFaction = obj.faction ?? obj.factionId ?? obj.faction_id ?? obj['阵营'] ?? obj['阵营标识'];
  const rawTitle = obj.title ?? obj['标题'] ?? obj['主标题'] ?? obj.name ?? obj['名称'];
  const rawBadge = obj.badge ?? obj['徽章'] ?? obj['阵营徽章'] ?? obj.tag;

  const faction = normalizeFactionKey(rawFaction, `${String(rawTitle ?? '')} ${String(rawBadge ?? '')}`);
  const palette = FACTION_DEFAULT_PALETTES[faction];
  const meta = DEFAULT_FACTION_META[faction];

  const primaryRaw =
    obj.primaryColor ?? obj.primary_color ?? obj.primary ?? colorsObj.primary ?? obj['主色'] ?? obj['主色调'];
  const accentRaw =
    obj.accentColor ?? obj.accent_color ?? obj.accent ?? colorsObj.accent ?? obj['强调色'] ?? obj['副色'];
  const bgRaw =
    obj.bgColor ?? obj.bg_color ?? obj.bg ?? colorsObj.bg ?? colorsObj.background ?? obj['背景色'] ?? obj['底色'];

  const details = normalizeDetailsList(
    obj.details ?? obj['详情'] ?? obj['并网详情'] ?? obj['阵营工业与并网详情'] ?? obj.specs,
  );
  const initialGrants = normalizeGrantsList(
    obj.initialGrants ?? obj.initial_grants ?? obj.grants ?? obj['初始授权'] ?? obj['初始战区授权回执'] ?? obj['授权清单'],
  );

  return setIntoParserCache('faction-unlock', input, {
    faction,
    badge: String(rawBadge ?? meta.badge).trim() || meta.badge,
    title: String(rawTitle ?? meta.title).trim() || meta.title,
    subtitle: String(obj.subtitle ?? obj.subTitle ?? obj.sub_title ?? obj['副标题'] ?? meta.subtitle).trim() || meta.subtitle,
    emblem: String(obj.emblem ?? obj.insignia ?? obj['徽标'] ?? meta.emblem).trim() || meta.emblem,
    primaryColor: sanitizeCardColor(primaryRaw, palette.primary),
    accentColor: sanitizeCardColor(accentRaw, palette.accent),
    bgColor: sanitizeCardColor(bgRaw, palette.bg),
    starterGirlName:
      String(obj.starterGirlName ?? obj.starter_girl_name ?? starterGirlObj.name ?? obj['机娘姓名'] ?? meta.starterGirlName).trim() ||
      meta.starterGirlName,
    starterGirlModel:
      String(obj.starterGirlModel ?? obj.starter_girl_model ?? starterGirlObj.model ?? obj['机娘型号'] ?? meta.starterGirlModel).trim() ||
      meta.starterGirlModel,
    starterGirlQuote:
      String(
        obj.starterGirlQuote ?? obj.starter_girl_quote ?? starterGirlObj.quote ?? obj.quote ?? obj['机娘寄语'] ?? obj['寄语'] ?? meta.starterGirlQuote,
      ).trim() || meta.starterGirlQuote,
    details:
      details.length > 0
        ? details
        : [
            { label: '工业母机并网', value: 'T1 基础建造与电力网络已授信' },
            { label: '指挥链路状态', value: '战区最高统帅部直连就绪' },
          ],
    initialGrants:
      initialGrants.length > 0 ? initialGrants : ['T1 阵营基础发电与兵营建造许可', '首发 MCV 机动基地车展开授权'],
  });
}

export interface ParsedSpaceContract {
  id: string;
  title: string;
  kind: string;
  rocket: string;
  payload: string;
  base: string;
  rewardCredits: number;
  recoverBooster: boolean;
  status: string;
  weatherHoldReason?: string;
}

function extractRawSpaceContractRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input !== 'string') {
    return {};
  }
  const trimmed = input
    .trim()
    .replace(/^<(?:航天合同|航天|发射中心)(?:\s+[^>]*)?>\s*/i, '')
    .replace(/\s*<\/(?:航天合同|航天|发射中心)>$/i, '')
    .replace(/^```(?:yaml|yml|json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsedJson = JSON.parse(trimmed);
      if (parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson)) {
        return parsedJson as Record<string, unknown>;
      }
    } catch {
      // 回退到 YAML 解析
    }
  }
  try {
    const parsedYaml = YAML.parse(trimmed);
    if (Array.isArray(parsedYaml)) {
      const firstObj = parsedYaml.find(item => item && typeof item === 'object' && !Array.isArray(item)) as
        | Record<string, unknown>
        | undefined;
      if (firstObj) {
        return { ...firstObj, _itemCount: parsedYaml.length };
      }
    } else if (parsedYaml && typeof parsedYaml === 'object') {
      const obj = parsedYaml as Record<string, unknown>;
      for (const sectionKey of [
        '合同',
        '航天合同',
        '订单',
        '发射中心',
        '发射场',
        '星座',
        '在轨',
        '在轨资产',
        '卫星',
        '任务',
        'contracts',
        'launch_centers',
        'constellations',
        'missions',
      ]) {
        const sub = obj[sectionKey];
        if (Array.isArray(sub) && sub.length > 0) {
          const first = sub[0];
          if (first && typeof first === 'object' && !Array.isArray(first)) {
            return {
              _sectionType: sectionKey,
              _itemCount: sub.length,
              ...obj,
              ...(first as Record<string, unknown>),
            };
          }
          if (typeof first === 'string' && first.trim()) {
            return {
              _sectionType: sectionKey,
              _itemCount: sub.length,
              ...obj,
              名称: first.trim(),
            };
          }
        } else if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
          return {
            _sectionType: sectionKey,
            ...obj,
            ...(sub as Record<string, unknown>),
          };
        }
      }
      return obj;
    }
  } catch {
    // 回退到行级 YAML 键值解析
  }
  const record: Record<string, unknown> = {};
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^-\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const val = match[2].trim().replace(/^['"]|['"]$/g, '');
    if (key && !(key in record && val === '')) {
      record[key] = val;
    }
  }
  return record;
}

function pickSpaceField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== undefined && record[key] !== null && record[key] !== '') {
      return record[key];
    }
  }
  return undefined;
}

export function parseSpaceContractPayload(input: unknown): ParsedSpaceContract {
  const cached = getFromParserCache<ParsedSpaceContract>('space-contract', input);
  if (cached.hit) return cached.value;
  const rec = extractRawSpaceContractRecord(input);
  const rawStr = typeof input === 'string' ? input.trim() : '';
  const sectionType = String(rec._sectionType ?? '');
  const isLaunchCenter =
    /^<发射中心/i.test(rawStr) ||
    /发射中心|launch_center/i.test(sectionType) ||
    Boolean(
      (rec['等级'] !== undefined || rec['tier'] !== undefined || rec['工位'] !== undefined) &&
        !rec['合同编号'] &&
        !rec['运载火箭'],
    );
  const isConstellationOrMission =
    /星座|在轨|卫星|任务|constellation|mission/i.test(sectionType) ||
    Boolean((rec['星座'] !== undefined || rec['卫星'] !== undefined || rec['在轨'] !== undefined) && !rec['合同编号']);

  const idRaw = pickSpaceField(rec, ['id', '编号', '合同编号', '中心编号', '代号']);
  const titleRaw = pickSpaceField(rec, [
    'title',
    'name',
    '名称',
    '合同名称',
    '标题',
    '发射中心',
    '星座名称',
    '任务名称',
    '卫星',
    '标的',
  ]);
  const kindRaw = pickSpaceField(rec, ['kind', 'type', '类型', '类别', '等级', 'tier', '轨道', 'orbit']);
  const rocketRaw = pickSpaceField(rec, [
    'rocket',
    '运载火箭',
    '箭型',
    '主力箭型',
    '发射工位',
    '工位',
    '承建建筑',
    '设施',
  ]);
  const payloadRaw = pickSpaceField(rec, [
    'payload',
    '载荷',
    '有效载荷',
    '载荷能力',
    '效果',
    '效用',
    '功能',
    '描述',
    '说明',
    '简介',
  ]);
  const baseRaw = pickSpaceField(rec, [
    'base',
    '发射场',
    '发射基地',
    '所属基地',
    '基地',
    '选址',
    '位置',
    '地点',
  ]);
  const rewardRaw = pickSpaceField(rec, [
    'reward_credits',
    'rewardCredits',
    '报酬',
    '里程碑打款',
    '里程碑报酬',
    '报酬金额',
    '收益',
    '造价',
    '预算',
  ]);
  const recoverRaw = pickSpaceField(rec, [
    'recover_booster',
    'recoverBooster',
    '回收助推器',
    '复用助推器',
    'use_stored_booster',
  ]);
  const statusRaw = pickSpaceField(rec, ['status', 'state', '状态', '阶段', '进度']);
  const weatherRaw = pickSpaceField(rec, [
    'weather_hold_reason',
    'weatherHoldReason',
    '气象延误',
    '气象窗口',
    '气象挂起原因',
    '挂起原因',
    '延期原因',
  ]);

  let rewardCredits = 0;
  if (typeof rewardRaw === 'number' && Number.isFinite(rewardRaw)) {
    rewardCredits = rewardRaw;
  } else if (typeof rewardRaw === 'string') {
    const cleaned = Number(rewardRaw.replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(cleaned)) {
      rewardCredits = cleaned;
    }
  }

  let recoverBooster = false;
  if (typeof recoverRaw === 'boolean') {
    recoverBooster = recoverRaw;
  } else if (typeof recoverRaw === 'number') {
    recoverBooster = recoverRaw > 0;
  } else if (typeof recoverRaw === 'string') {
    const normalized = recoverRaw.trim().toLowerCase();
    recoverBooster = ['true', '1', 'yes', 'y', '是', '可回收', '可回收复用', '回收'].includes(normalized);
  }

  const weatherHoldReason =
    weatherRaw !== undefined && String(weatherRaw).trim() !== ''
      ? String(weatherRaw).trim()
      : undefined;

  const defaultId = isLaunchCenter ? 'LC-01' : isConstellationOrMission ? 'ORB-01' : 'SC-001';
  const defaultTitle = isLaunchCenter
    ? (baseRaw ? `${String(baseRaw).trim()}航天发射中心` : '战区航天发射中心')
    : isConstellationOrMission
      ? '天基轨道星座与航天任务'
      : '未命名航天合同';
  const defaultKind = isLaunchCenter
    ? '发射中心'
    : isConstellationOrMission
      ? '在轨星座'
      : 'orbital_launch';
  const defaultRocket = isLaunchCenter
    ? '标准发射工位与遥测阵列'
    : isConstellationOrMission
      ? '天基入轨序列'
      : '未指定运载火箭';
  const defaultPayload = isLaunchCenter
    ? '天地月多轨发射保障'
    : isConstellationOrMission
      ? '轨道遥感与通信中继组网'
      : '标准载荷';
  const defaultStatus = isLaunchCenter
    ? '运转'
    : isConstellationOrMission
      ? '在轨运行'
      : 'pending';

  return setIntoParserCache('space-contract', input, {
    id: idRaw !== undefined ? String(idRaw).trim() : defaultId,
    title: titleRaw !== undefined ? String(titleRaw).trim() : defaultTitle,
    kind: kindRaw !== undefined ? String(kindRaw).trim() : defaultKind,
    rocket: rocketRaw !== undefined ? String(rocketRaw).trim() : defaultRocket,
    payload: payloadRaw !== undefined ? String(payloadRaw).trim() : defaultPayload,
    base: baseRaw !== undefined ? String(baseRaw).trim() : '第一发射场',
    rewardCredits,
    recoverBooster,
    status: statusRaw !== undefined ? String(statusRaw).trim() : defaultStatus,
    ...(weatherHoldReason ? { weatherHoldReason } : {}),
  });
}

export const parseAerospaceContractPayload = parseSpaceContractPayload;

/* ═══════════════ MAIDEN-CARD-01 · 机娘卷宗卡与初诞/状态卡解析与 DOM 构建 ═══════════════ */

export interface ParsedMaidenDossierCard {
  name: string;
  callsign: string;
  serial: string;
  model: string;
  seq: string;
  faction: FactionKey;
  factionLabel: string;
  body: string;
  appearance: string;
  personality: string;
  form_mech: string;
  skills: string;
  flaws: string;
  weapons: string;
  exposure: string;
  balance: string;
  alias: string;
  shell: string;
  status: string;
  triggers: string[];
  colors: FactionColorPalette;
}

export interface ParsedMaidenStatusItem {
  name: string;
  callsign: string;
  serial: string;
  model: string;
  seq: string;
  faction: string;
  hp: string;
  base: string;
  duty: string;
  body: string;
  personality: string;
  appearance: string;
  shell: string;
  alias: string;
  status: string;
  affection: number;
  affectionDelta?: number;
  obedience: number;
  obedienceDelta?: number;
  traits: string[];
  unchristened: boolean;
}

export interface ParsedMaidenStatusCard {
  items: ParsedMaidenStatusItem[];
}

function stripMaidenTagWrapper(raw: string): string {
  return raw
    .trim()
    .replace(/^<(?:机娘档案|机娘|maiden_dossier|maiden|mecha_girl)>\s*/i, '')
    .replace(/\s*<\/(?:机娘档案|机娘|maiden_dossier|maiden|mecha_girl)>$/i, '')
    .replace(/^```(?:yaml|yml|json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function parseFlexibleYamlOrKeyValue(rawText: string): unknown {
  const cleaned = stripMaidenTagWrapper(rawText);
  if (!cleaned) return null;

  try {
    const parsedJson = JSON.parse(cleaned);
    if (parsedJson && typeof parsedJson === 'object') {
      return parsedJson;
    }
  } catch {
    /* fallback to YAML */
  }

  try {
    const parsedYaml = YAML.parse(cleaned);
    if (parsedYaml && typeof parsedYaml === 'object') {
      return parsedYaml;
    }
  } catch {
    /* fallback to line parser */
  }

  const record: Record<string, unknown> = {};
  let hasField = false;
  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^-\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const val = match[2].trim().replace(/^['"]|['"]$/g, '');
    if (key) {
      record[key] = val;
      hasField = true;
    }
  }
  return hasField ? record : null;
}

function stringifyMaidenField(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    return val
      .map(item => stringifyMaidenField(item))
      .filter(Boolean)
      .join(' · ');
  }
  if (typeof val === 'object') {
    return Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${stringifyMaidenField(v)}`)
      .join('；');
  }
  return '';
}

function parseMaidenStringList(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.map(v => String(v ?? '').trim()).filter(Boolean);
  }
  if (typeof val === 'string') {
    return val
      .split(/[\n,，、;；]+/)
      .map(s => s.replace(/^#/, '').trim())
      .filter(Boolean);
  }
  return [];
}

function resolveFactionLabel(factionKey: FactionKey, rawFaction: unknown): string {
  const rawStr = stringifyMaidenField(rawFaction);
  if (rawStr) return rawStr;
  if (factionKey === 'soviet') return '苏联';
  if (factionKey === 'yuri') return '尤里';
  return '盟军';
}

export function isMaidenShellDeferred(shell: string, alias: string): boolean {
  const s = (shell ?? '').trim();
  const a = (alias ?? '').trim();
  if (!s && !a) return true;
  if (s.includes('暂未编织') || a.includes('暂未编织')) return true;
  if (s === '无' && (!a || a === '无')) return true;
  return false;
}

export function parseMaidenDossierPayload(
  rawText: string | Record<string, unknown> | null | undefined,
): ParsedMaidenDossierCard | null {
  const cached = getFromParserCache<ParsedMaidenDossierCard | null>('maiden-dossier', rawText);
  if (cached.hit) return cached.value;
  let obj: Record<string, unknown> | null = null;
  if (rawText && typeof rawText === 'object' && !Array.isArray(rawText)) {
    obj = rawText;
  } else if (typeof rawText === 'string') {
    const parsed = parseFlexibleYamlOrKeyValue(rawText);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      obj = parsed[0] as Record<string, unknown>;
    } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      obj = parsed as Record<string, unknown>;
    }
  }

  if (!obj || Object.keys(obj).length === 0) {
    return null;
  }

  const nameRaw = pickSpaceField(obj, ['名称', '姓名', 'name']);
  const callsignRaw = pickSpaceField(obj, ['代号', '专属代号', '真名', '赐名', '战术代号', '呼号', 'callsign']);
  const serialRaw = pickSpaceField(obj, ['编号', '出厂编号', '工程编号', '机体编号', 'serial']);
  const modelRaw = pickSpaceField(obj, ['型号', '机体型号', '原型', '本体型号', 'model', 'prototype']);
  const seqRaw = pickSpaceField(obj, ['序列', '代次', '批次', '机体序列', 'seq']);
  const factionRaw = pickSpaceField(obj, ['阵营', '所属阵营', '派系', 'faction']);
  const bodyRaw = pickSpaceField(obj, ['躯体特征', '躯体', '身子', '体态', '体态特征', '生理特征', '纳米躯体', 'body']);
  const appearanceRaw = pickSpaceField(obj, [
    '外观',
    '外貌',
    '外在着装',
    '着装',
    '服饰',
    '衣装',
    '装束',
    '形象',
    '外貌特征',
    '外观着装',
    'appearance',
  ]);
  const personalityRaw = pickSpaceField(obj, [
    '性格',
    '基础性格',
    '初生性格',
    '性格特征',
    '性格描述',
    '心智性格',
    '心智',
    'personality',
  ]);
  const formMechRaw = pickSpaceField(obj, ['形态机制', '形态', '机制', 'form_mech', 'formMech']);
  const skillsRaw = pickSpaceField(obj, ['能力', '专属能力', '能力特征', '核心特征', '特质', '技能', '词条', 'skills', 'skill', 'traits']);
  const flawsRaw = pickSpaceField(obj, ['结构短板', '弱点', '短板', 'flaws', 'weakness']);
  const weaponsRaw = pickSpaceField(obj, ['武器', '武装', '制式武装', 'weapons', 'weapon']);
  const exposureRaw = pickSpaceField(obj, ['暴露分档', '暴露等级', '暴露', 'exposure']);
  const balanceRaw = pickSpaceField(obj, ['平衡位置', '平衡定位', '定位', 'balance']);
  const aliasRaw = pickSpaceField(obj, ['化名', '对外化名', '对外代号', '假名', '人间名', '伪名', 'alias']);
  const shellRaw = pickSpaceField(obj, ['社会外壳', '身份外壳', '对外身份', '外壳', '身份', '掩护身份', 'shell']);
  const statusRaw = pickSpaceField(obj, [
    '当前状态',
    '现状',
    '现状备注',
    '状态备注',
    '备注',
    '背景',
    '来历',
    '阶段',
    '档案阶段',
    '归档状态',
    '状态',
    'status',
    'stage',
  ]);
  const triggersRaw = pickSpaceField(obj, ['触发词', '关键词', 'triggers', 'trigger']);

  const name = stringifyMaidenField(nameRaw) || stringifyMaidenField(callsignRaw);
  const callsign = stringifyMaidenField(callsignRaw) || name;
  const serial = stringifyMaidenField(serialRaw);
  const model = stringifyMaidenField(modelRaw);
  const body = stringifyMaidenField(bodyRaw);
  const appearance = stringifyMaidenField(appearanceRaw);
  const personality = stringifyMaidenField(personalityRaw);

  if (!name && !callsign && !serial && !model && !body && !appearance && !personality) {
    return null;
  }

  const faction = normalizeFactionKey(factionRaw, `${model} ${serial} ${name}`);
  const factionLabel = resolveFactionLabel(faction, factionRaw);
  const palette = FACTION_DEFAULT_THEMES[faction];

  const colorsObj =
    obj.colors && typeof obj.colors === 'object'
      ? (obj.colors as Record<string, unknown>)
      : obj.theme && typeof obj.theme === 'object'
        ? (obj.theme as Record<string, unknown>)
        : {};

  const primary = sanitizeCardColor(
    pickSpaceField(obj, ['primaryColor', '主色']) ?? colorsObj.primary,
    palette.primary,
  );
  const accent = sanitizeCardColor(
    pickSpaceField(obj, ['accentColor', '强调色']) ?? colorsObj.accent,
    palette.accent,
  );
  const bg = sanitizeCardColor(
    pickSpaceField(obj, ['bgColor', '背景色']) ?? colorsObj.bg,
    palette.bg,
  );

  const seq =
    stringifyMaidenField(seqRaw) ||
    (serial.endsWith('-02') || serial.endsWith('02') ? '次生二号机 · 同型异构' : '首台原型');

  return setIntoParserCache('maiden-dossier', rawText, {
    name: name || serial || '未命名机娘',
    callsign: callsign || name || serial || '待授名',
    serial: serial || 'UNASSIGNED',
    model: model || '标准战术机娘',
    seq,
    faction,
    factionLabel,
    body,
    appearance,
    personality,
    form_mech: stringifyMaidenField(formMechRaw),
    skills: stringifyMaidenField(skillsRaw),
    flaws: stringifyMaidenField(flawsRaw),
    weapons: stringifyMaidenField(weaponsRaw),
    exposure: stringifyMaidenField(exposureRaw),
    balance: stringifyMaidenField(balanceRaw),
    alias: stringifyMaidenField(aliasRaw),
    shell: stringifyMaidenField(shellRaw),
    status: stringifyMaidenField(statusRaw),
    triggers: parseMaidenStringList(triggersRaw),
    colors: { primary, accent, bg },
  });
}

const KNOWN_MAIDEN_ITEM_KEYS = new Set([
  '名称', '姓名', 'name', '代号', '专属代号', '真名', '赐名', '呼号', 'callsign', '编号', '出厂编号', '工程编号', '机体编号', 'serial',
  '型号', '机体型号', '原型', '本体型号', 'model', '序列', '代次', '批次', '机体序列', 'seq', '阵营', '所属阵营', '派系', 'faction',
  'hp', 'HP', '血量', '耐久', '状态', '当前状态', '现状', '现状备注', '状态备注', '备注', '阶段', '档案阶段', '归档状态', 'status', 'stage',
  '任务', '职责', '职务', 'duty', '归属', '基地', '驻地', '所属基地', 'base',
  '躯体特征', '躯体', '身子', '体态', 'body', '性格', '基础性格', '初生性格', '性格特征', '性格描述', '心智性格', 'personality',
  '外观', '外貌', '外在着装', '着装', '服饰', '衣装', 'appearance', '社会外壳', '身份外壳', '对外身份', '外壳', 'shell', '化名', '对外化名', '对外代号', 'alias',
  '好感', '好感度', 'affection', '好感变化', 'affectionDelta', 'affection_delta',
  '服从', '服从度', 'obedience', '服从变化', 'obedienceDelta', 'obedience_delta',
  '特征标签', '能力特征', '核心特征', '标签', '特质', '技能', '词条', 'traits',
]);

function parseMetricWithDelta(
  valRaw: unknown,
  deltaRaw: unknown,
  defaultVal = 50,
): { value: number; delta?: number } {
  let delta: number | undefined;
  if (deltaRaw !== undefined && deltaRaw !== null && String(deltaRaw).trim() !== '') {
    const dNum = Number(String(deltaRaw).replace(/[^0-9.+-]/g, ''));
    if (Number.isFinite(dNum) && dNum !== 0) {
      delta = dNum;
    }
  }

  let value = defaultVal;
  if (typeof valRaw === 'number' && Number.isFinite(valRaw)) {
    value = valRaw;
  } else if (typeof valRaw === 'string' && valRaw.trim() !== '') {
    const trimmed = valRaw.trim();
    const inlineMatch = trimmed.match(/(-?\d+(?:\.\d+)?)\s*[（(]([+-]\d+(?:\.\d+)?)[)）]/);
    if (inlineMatch) {
      value = Number(inlineMatch[1]);
      if (delta === undefined) {
        const inlineDelta = Number(inlineMatch[2]);
        if (Number.isFinite(inlineDelta) && inlineDelta !== 0) {
          delta = inlineDelta;
        }
      }
    } else if (/^[+-]\d+(?:\.\d+)?$/.test(trimmed)) {
      const d = Number(trimmed);
      if (Number.isFinite(d)) {
        if (delta === undefined && d !== 0) delta = d;
        value = defaultVal + d;
      }
    } else {
      const numMatch = trimmed.match(/-?\d+(?:\.\d+)?/);
      if (numMatch) {
        value = Number(numMatch[0]);
      }
    }
  } else if (delta !== undefined) {
    value = defaultVal + delta;
  }

  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return delta !== undefined ? { value: clamped, delta } : { value: clamped };
}

function normalizeMaidenStatusItem(
  rec: Record<string, unknown>,
  fallbackName = '',
): ParsedMaidenStatusItem | null {
  const rawName = stringifyMaidenField(pickSpaceField(rec, ['名称', '姓名', 'name'])) || fallbackName;
  const callsign = stringifyMaidenField(pickSpaceField(rec, ['代号', '专属代号', '真名', '赐名', '战术代号', '呼号', 'callsign']));
  const serial = stringifyMaidenField(pickSpaceField(rec, ['编号', '出厂编号', '工程编号', '机体编号', 'serial']));
  const model = stringifyMaidenField(pickSpaceField(rec, ['型号', '机体型号', '原型', '本体型号', 'model', 'prototype']));
  const seq = stringifyMaidenField(pickSpaceField(rec, ['序列', '代次', '批次', '机体序列', 'seq']));
  const faction = stringifyMaidenField(pickSpaceField(rec, ['阵营', '所属阵营', '派系', 'faction']));
  const hp = stringifyMaidenField(pickSpaceField(rec, ['hp', 'HP', '耐久', '血量', '战损'])) || '满编正常';
  const base = stringifyMaidenField(pickSpaceField(rec, ['基地', '驻地', '所属基地', '归属', 'base']));
  const duty = stringifyMaidenField(pickSpaceField(rec, ['职责', '职务', '任务', '执勤', 'duty']));
  const body = stringifyMaidenField(pickSpaceField(rec, ['躯体特征', '躯体', '身子', '体态', 'body']));
  const personality = stringifyMaidenField(
    pickSpaceField(rec, ['性格', '基础性格', '初生性格', '性格特征', '性格描述', '心智性格', '心智', 'personality']),
  );
  const appearance = stringifyMaidenField(
    pickSpaceField(rec, ['外观', '外貌', '外在着装', '着装', '服饰', '衣装', '装束', '形象', '外貌特征', 'appearance']),
  );
  const shell = stringifyMaidenField(pickSpaceField(rec, ['社会外壳', '身份外壳', '对外身份', '外壳', '身份', 'shell']));
  const alias = stringifyMaidenField(pickSpaceField(rec, ['化名', '对外化名', '对外代号', '伪名', 'alias']));
  const status = stringifyMaidenField(
    pickSpaceField(rec, ['当前状态', '现状', '现状备注', '状态备注', '备注', '阶段', '档案阶段', '归档状态', '状态', 'status', 'stage']),
  );
  const traits = parseMaidenStringList(
    pickSpaceField(rec, ['特征标签', '能力特征', '核心特征', '战术特质', '标签', '特征', '特质', '技能', '词条', 'traits']),
  );

  const affMetric = parseMetricWithDelta(
    pickSpaceField(rec, ['好感', '好感度', 'affection']),
    pickSpaceField(rec, ['好感变化', '好感度变化', 'affectionDelta', 'affection_delta']),
    50,
  );
  const obeMetric = parseMetricWithDelta(
    pickSpaceField(rec, ['服从', '服从度', 'obedience']),
    pickSpaceField(rec, ['服从变化', '服从度变化', 'obedienceDelta', 'obedience_delta']),
    50,
  );

  const effectiveName = rawName || callsign;
  if (!effectiveName && !serial && !model && !body && !personality && !status && !duty) {
    return null;
  }

  const unchristened =
    !effectiveName ||
    effectiveName.includes('待授名') ||
    effectiveName.includes('未授名') ||
    callsign.includes('待授名') ||
    callsign.includes('未授名') ||
    duty.includes('待授名') ||
    status.includes('待授名') ||
    traits.some(t => t.includes('待授名') || t.includes('未授名'));

  return {
    name: effectiveName || (serial ? `待授名·${serial}` : '待授名'),
    callsign: callsign || effectiveName,
    serial,
    model,
    seq: seq || (unchristened ? '初诞待授名' : ''),
    faction,
    hp,
    base,
    duty,
    body,
    personality,
    appearance,
    shell,
    alias,
    status,
    affection: affMetric.value,
    ...(affMetric.delta !== undefined ? { affectionDelta: affMetric.delta } : {}),
    obedience: obeMetric.value,
    ...(obeMetric.delta !== undefined ? { obedienceDelta: obeMetric.delta } : {}),
    traits,
    unchristened,
  };
}

export function parseMaidenStatusPayload(
  rawText: string | Record<string, unknown> | unknown[] | null | undefined,
): ParsedMaidenStatusCard | null {
  const cached = getFromParserCache<ParsedMaidenStatusCard | null>('maiden-status', rawText);
  if (cached.hit) return cached.value;
  let parsed: unknown = null;
  if (Array.isArray(rawText) || (rawText && typeof rawText === 'object')) {
    parsed = rawText;
  } else if (typeof rawText === 'string') {
    parsed = parseFlexibleYamlOrKeyValue(rawText);
  }

  if (!parsed) return null;

  const items: ParsedMaidenStatusItem[] = [];

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const item = normalizeMaidenStatusItem(entry as Record<string, unknown>);
        if (item) items.push(item);
      }
    }
  } else if (typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const listCandidate = obj.items ?? obj.girls ?? obj['机娘'] ?? obj['列表'];
    if (Array.isArray(listCandidate)) {
      for (const entry of listCandidate) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          const item = normalizeMaidenStatusItem(entry as Record<string, unknown>);
          if (item) items.push(item);
        }
      }
    } else {
      const keys = Object.keys(obj);
      const isSingleMaiden = keys.some(k => KNOWN_MAIDEN_ITEM_KEYS.has(k));
      if (isSingleMaiden) {
        const item = normalizeMaidenStatusItem(obj);
        if (item) items.push(item);
      } else {
        for (const [k, v] of Object.entries(obj)) {
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            const item = normalizeMaidenStatusItem(v as Record<string, unknown>, k);
            if (item) items.push(item);
          }
        }
      }
    }
  }

  if (items.length === 0) return setIntoParserCache('maiden-status', rawText, null);
  return setIntoParserCache('maiden-status', rawText, { items });
}
