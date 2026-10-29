import YAML from 'yaml';
import { normalizeFactionId, resolveStarterMcvInfo } from '../core/commandPresets';

export interface FactionCardTheme {
  primary: string;
  accent: string;
  bg: string;
}

export interface ParsedFactionUnlock {
  factionId: string;
  factionLabel: string;
  title: string;
  subtitle: string;
  theme: FactionCardTheme;
  badge: string;
  starterGirlName: string;
  starterGirlModel: string;
  starterGirlQuote: string;
  details: Record<string, string>;
  initialGrants: string[];
  raw: string;
}

const DEFAULT_FACTION_THEMES: Readonly<Record<string, FactionCardTheme>> = Object.freeze({
  soviet: { primary: '#c93b2b', accent: '#d4a84f', bg: '#140c0c' },
  allied: { primary: '#2563eb', accent: '#38bdf8', bg: '#0b1324' },
  yuri: { primary: '#7e22ce', accent: '#c084fc', bg: '#160b24' },
});

const FALLBACK_THEME: FactionCardTheme = Object.freeze({
  primary: '#2563eb',
  accent: '#38bdf8',
  bg: '#0b1324',
});

const DEFAULT_FACTION_BADGES: Readonly<Record<string, string>> = Object.freeze({
  soviet: '红星战旗',
  allied: '自由鹰徽',
  yuri: '心灵之眼',
});

const DEFAULT_STARTER_QUOTES: Readonly<Record<string, string>> = Object.freeze({
  soviet: '钢铁洪流已就位，指挥官同志，请下达展开指令！',
  allied: '全域数据链校准完毕，随时准备建立前哨基地。',
  yuri: '心灵信标谐振稳定，您的意志即刻延伸。',
});

const UNSAFE_CSS_PATTERN =
  /[\r\n;{}<>\\]|url\s*\(|expression\s*\(|var\s*\(|javascript\s*:|calc\s*\(|attr\s*\(|image-set\s*\(/i;

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const RGB_COLOR_RE =
  /^rgba?\(\s*\d{1,3}%?\s*(?:,\s*\d{1,3}%?\s*,\s*\d{1,3}%?(?:\s*,\s*(?:0|1|0?\.\d+|1\.0+|\d{1,3}%))?|\s+\d{1,3}%?\s+\d{1,3}%?(?:\s*\/\s*(?:0|1|0?\.\d+|1\.0+|\d{1,3}%))?)\s*\)$/i;

const HSL_COLOR_RE =
  /^hsla?\(\s*\d{1,3}(?:\.\d+)?(?:deg|rad|grad|turn)?\s*(?:,\s*\d{1,3}(?:\.\d+)?%\s*,\s*\d{1,3}(?:\.\d+)?%(?:\s*,\s*(?:0|1|0?\.\d+|1\.0+|\d{1,3}%))?|\s+\d{1,3}(?:\.\d+)?%\s+\d{1,3}(?:\.\d+)?%(?:\s*\/\s*(?:0|1|0?\.\d+|1\.0+|\d{1,3}%))?)\s*\)$/i;

/**
 * 校验 CSS 颜色值是否安全：
 * 仅允许合法的 #rgb / #rgba / #rrggbb / #rrggbbaa 或安全的 rgb(...) / rgba(...) / hsl(...) / hsla(...) 格式，
 * 严禁包含 `;`、`{`、`}`、`url(`、`expression(`、`var(`、`<`、`>`、`javascript:` 等任何注入字符。
 */
export function isSafeCssColor(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const s = val.trim();
  if (!s || s.length > 64) return false;
  if (UNSAFE_CSS_PATTERN.test(s)) return false;
  return HEX_COLOR_RE.test(s) || RGB_COLOR_RE.test(s) || HSL_COLOR_RE.test(s);
}

/**
 * 解析阵营卡片安全三色板（非法或缺失色值自动回退至阵营默认色板）。
 */
export function resolveFactionCardTheme(
  factionId: string,
  custom?: { primary?: unknown; accent?: unknown; bg?: unknown },
): FactionCardTheme {
  const norm = normalizeFactionId(factionId);
  const base = DEFAULT_FACTION_THEMES[norm] ?? FALLBACK_THEME;
  if (!custom || typeof custom !== 'object') {
    return { ...base };
  }
  return {
    primary: isSafeCssColor(custom.primary) ? String(custom.primary).trim() : base.primary,
    accent: isSafeCssColor(custom.accent) ? String(custom.accent).trim() : base.accent,
    bg: isSafeCssColor(custom.bg) ? String(custom.bg).trim() : base.bg,
  };
}

function stripCodeFences(raw: string): string {
  return raw
    .replace(/^\s*```[^\n]*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .replace(/^\s*```[^\n]*$/gm, '')
    .trim();
}

function canonKey(k: string): string {
  return k.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function parseLooseKeyValueLines(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  let currentSection: string | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    const isIndented = /^\s{2,}|\t/.test(rawLine);
    if (isIndented && currentSection) {
      if (trimmed.startsWith('-')) {
        const itemText = trimmed.replace(/^-\s*/, '').trim();
        if (itemText) {
          const prev = result[currentSection];
          if (Array.isArray(prev)) {
            prev.push(itemText);
          } else {
            result[currentSection] = [itemText];
          }
        }
        continue;
      }
      const subMatch = trimmed.match(/^([^:：]+)\s*[:：]\s*(.*)$/);
      if (subMatch) {
        const subKey = subMatch[1].trim();
        const subVal = subMatch[2].trim().replace(/^['"]|['"]$/g, '');
        const prev = result[currentSection];
        if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
          (prev as Record<string, unknown>)[subKey] = subVal;
        } else {
          result[currentSection] = { [subKey]: subVal };
        }
        continue;
      }
    }

    const match = trimmed.match(/^([^:：]+)\s*[:：]\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().replace(/^-\s*/, '');
    const val = match[2].trim().replace(/^['"]|['"]$/g, '');
    if (!val) {
      currentSection = key;
      if (!(key in result)) result[key] = {};
    } else {
      currentSection = null;
      result[key] = val;
    }
  }
  return result;
}

function parseRawObject(cleaned: string): Record<string, unknown> | null {
  try {
    const parsed = YAML.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 降级到宽松逐行键值提取
  }
  const fallback = parseLooseKeyValueLines(cleaned);
  return Object.keys(fallback).length > 0 ? fallback : null;
}

function pickField(obj: Record<string, unknown>, aliases: readonly string[]): unknown {
  const index = new Map<string, string>();
  for (const k of Object.keys(obj)) {
    index.set(canonKey(k), k);
  }
  for (const alias of aliases) {
    if (alias in obj && obj[alias] !== undefined && obj[alias] !== null) {
      return obj[alias];
    }
    const hit = index.get(canonKey(alias));
    if (hit !== undefined && obj[hit] !== undefined && obj[hit] !== null) {
      return obj[hit];
    }
  }
  return undefined;
}

function pickStr(obj: Record<string, unknown>, aliases: readonly string[]): string {
  const v = pickField(obj, aliases);
  if (v === undefined || v === null || typeof v === 'object') return '';
  return String(v).trim();
}

function extractThemeInput(
  obj: Record<string, unknown>,
): { primary?: unknown; accent?: unknown; bg?: unknown } {
  const rawTheme = pickField(obj, ['配色', 'theme', '主题', '主题色', '颜色', 'colors']);
  let primary: unknown = pickField(obj, ['主色', 'primary', 'primaryColor', 'primary_color']);
  let accent: unknown = pickField(obj, ['辉光色', 'accent', 'accentColor', 'accent_color', '副色', '点缀色']);
  let bg: unknown = pickField(obj, ['背景色', 'bg', 'background', 'bgColor', 'bg_color']);

  if (rawTheme && typeof rawTheme === 'object' && !Array.isArray(rawTheme)) {
    const tObj = rawTheme as Record<string, unknown>;
    primary = pickField(tObj, ['主色', 'primary', 'primaryColor', 'primary_color']) ?? primary;
    accent = pickField(tObj, ['辉光色', 'accent', 'accentColor', 'accent_color', '副色', '点缀色']) ?? accent;
    bg = pickField(tObj, ['背景色', 'bg', 'background', 'bgColor', 'bg_color']) ?? bg;
  } else if (typeof rawTheme === 'string' && rawTheme.trim()) {
    const parts = rawTheme
      .split(/[,，/|\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
    if (parts[0] && primary === undefined) primary = parts[0];
    if (parts[1] && accent === undefined) accent = parts[1];
    if (parts[2] && bg === undefined) bg = parts[2];
  }

  return { primary, accent, bg };
}

function extractDetails(rawDetails: unknown): Record<string, string> {
  const details: Record<string, string> = {};
  if (!rawDetails) return details;

  if (typeof rawDetails === 'object' && !Array.isArray(rawDetails)) {
    for (const [k, v] of Object.entries(rawDetails as Record<string, unknown>)) {
      const key = k.trim();
      const val = v !== undefined && v !== null ? String(v).trim() : '';
      if (key && val) {
        details[key] = val;
      }
    }
    return details;
  }

  if (Array.isArray(rawDetails)) {
    rawDetails.forEach((item, idx) => {
      if (item && typeof item === 'object') {
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          const key = k.trim();
          const val = v !== undefined && v !== null ? String(v).trim() : '';
          if (key && val) details[key] = val;
        }
        return;
      }
      const text = String(item ?? '').trim();
      if (!text) return;
      const m = text.match(/^([^:：]+)\s*[:：]\s*(.+)$/);
      if (m) {
        details[m[1].trim()] = m[2].trim();
      } else {
        details[`条目${idx + 1}`] = text;
      }
    });
    return details;
  }

  if (typeof rawDetails === 'string') {
    const segments = rawDetails.split(/[\r\n;；]+/);
    for (const seg of segments) {
      const text = seg.trim();
      if (!text) continue;
      const m = text.match(/^([^:：]+)\s*[:：]\s*(.+)$/);
      if (m) {
        details[m[1].trim()] = m[2].trim();
      }
    }
  }

  return details;
}

function extractInitialGrants(rawGrants: unknown): string[] {
  if (!rawGrants) return [];
  if (Array.isArray(rawGrants)) {
    return rawGrants
      .map(item => String(item ?? '').trim())
      .filter(Boolean);
  }
  if (typeof rawGrants === 'string') {
    return rawGrants
      .split(/[\r\n、,，;；]+/)
      .map(s => s.replace(/^-\s*/, '').trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * 解析 `<阵营解锁>` 标签块内容（支持 YAML / JSON 及简单 `键: 值` 行格式容错提取），
 * 缺省字段自动用 `resolveStarterMcvInfo` 回填；若为空或无法识别阵营则返回 `null`。
 */
export function parseFactionUnlockPayload(rawInner: string): ParsedFactionUnlock | null {
  if (typeof rawInner !== 'string') return null;
  const cleaned = stripCodeFences(rawInner);
  if (!cleaned) return null;

  const obj = parseRawObject(cleaned);
  if (!obj) return null;

  const rawFaction = pickStr(obj, ['阵营', 'faction', 'factionId', 'faction_id', '所属阵营', '解锁阵营']);
  const rawGirlName = pickStr(obj, [
    '首发机娘',
    'starterGirlName',
    'starter_girl_name',
    '机娘',
    '机娘名',
    '机娘姓名',
    'girlName',
    'girl',
  ]);
  const rawGirlModel = pickStr(obj, [
    '机娘型号',
    'starterGirlModel',
    'starter_girl_model',
    '载具型号',
    '型号',
    'vehicleName',
    'model',
  ]);

  const starter =
    resolveStarterMcvInfo(rawFaction) ??
    resolveStarterMcvInfo(rawGirlName) ??
    resolveStarterMcvInfo(rawGirlModel);

  if (!starter) {
    return null;
  }

  const factionId = starter.factionId;
  const factionLabel =
    pickStr(obj, ['阵营名称', 'factionLabel', 'faction_label']) || starter.factionLabel;

  const title =
    pickStr(obj, ['标题', 'title', '名称', 'name']) || `${starter.factionLabel}阵营解锁`;
  const subtitle =
    pickStr(obj, ['副标题', 'subtitle', 'sub_title', '标语']) ||
    `${starter.vehicleName} · ${starter.girlDuty}`;

  const theme = resolveFactionCardTheme(factionId, extractThemeInput(obj));

  const badge =
    pickStr(obj, ['徽章', 'badge', '徽标', '纹章', 'emblem']) ||
    DEFAULT_FACTION_BADGES[factionId] ||
    starter.factionLabel;

  const starterGirlName = rawGirlName || starter.girlName;
  const starterGirlModel = rawGirlModel || starter.vehicleName;
  const starterGirlQuote =
    pickStr(obj, [
      '机娘寄语',
      'starterGirlQuote',
      'starter_girl_quote',
      '寄语',
      '台词',
      '语音',
      'quote',
    ]) ||
    DEFAULT_STARTER_QUOTES[factionId] ||
    '';

  const details = extractDetails(
    pickField(obj, ['阵营详情', 'details', '详情', '特性', '阵营特性']),
  );
  const initialGrants = extractInitialGrants(
    pickField(obj, ['初始授权', 'initialGrants', 'initial_grants', '授权', '初始配给', '初始解锁', 'grants']),
  );

  return {
    factionId,
    factionLabel,
    title,
    subtitle,
    theme,
    badge,
    starterGirlName,
    starterGirlModel,
    starterGirlQuote,
    details,
    initialGrants,
    raw: rawInner.trim(),
  };
}
