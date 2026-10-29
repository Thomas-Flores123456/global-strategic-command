/**
 * timezoneWeatherEngine.ts —— 多基地标准时区、本地昼夜时钟与局部天气解析引擎（FD-26 · D-TZ-1 / D-WTH-1）
 *
 * 职责：
 * 1. 12 项标准天气预设白名单表（CANONICAL_WEATHER_PRESETS）与同义词自动归一化（normalizeCanonicalWeather）；
 * 2. 首座基地（bases[0]）锚定为战区标准时区（tz_offset = 0），后续基地按 tz_offset 实时推导本地时间、跨日偏移与昼夜相位；
 * 3. 基地有效天气解析（resolveEffectiveBaseWeather）：天体基地恒定「真空无气象」，地面基地遵循「局部天气优先、全局天气兜底」；
 * 4. 基地地理/天体选址类型智能推导（inferBaseSiteType）。
 *
 * 约束：纯函数，零 IO / 零酒馆 API / 零 Vue 依赖。
 */

import type { BaseSiteType } from '../core/schema';

/* ═══════════════ 1. 12 项标准天气预设白名单表与归一化 ═══════════════ */

export const CANONICAL_WEATHER_PRESETS = [
  '晴',
  '多云',
  '阴',
  '小雨',
  '大雾',
  '暴雨',
  '雷暴',
  '暴风雪',
  '强台风',
  '沙尘暴',
  '强磁暴',
  '真空无气象',
] as const;

export type CanonicalWeatherPreset = (typeof CANONICAL_WEATHER_PRESETS)[number];

const CANONICAL_WEATHER_SET = new Set<string>(CANONICAL_WEATHER_PRESETS);

const WEATHER_SYNONYM_MAP: Readonly<Record<string, CanonicalWeatherPreset>> = {
  // 晴
  晴: '晴',
  晴朗: '晴',
  晴天: '晴',
  碧空: '晴',
  万里无云: '晴',
  天晴: '晴',
  晴好: '晴',
  clear: '晴',
  sunny: '晴',
  fine: '晴',

  // 多云
  多云: '多云',
  少云: '多云',
  晴间多云: '多云',
  多云间晴: '多云',
  薄云: '多云',
  cloudy: '多云',
  partlycloudy: '多云',

  // 阴
  阴: '阴',
  阴天: '阴',
  阴沉: '阴',
  阴云: '阴',
  阴霾: '阴',
  overcast: '阴',

  // 小雨
  小雨: '小雨',
  微雨: '小雨',
  阵雨: '小雨',
  细雨: '小雨',
  毛毛雨: '小雨',
  小雪: '小雨',
  微雪: '小雨',
  零星小雨: '小雨',
  drizzle: '小雨',
  lightrain: '小雨',
  lightsnow: '小雨',

  // 大雾
  大雾: '大雾',
  浓雾: '大雾',
  迷雾: '大雾',
  雾霾: '大雾',
  海雾: '大雾',
  晨雾: '大雾',
  雾: '大雾',
  团雾: '大雾',
  fog: '大雾',
  densefog: '大雾',
  mist: '大雾',

  // 暴雨
  暴雨: '暴雨',
  大雨: '暴雨',
  强降雨: '暴雨',
  特大暴雨: '暴雨',
  豪雨: '暴雨',
  大雪: '暴雨',
  heavyrain: '暴雨',
  downpour: '暴雨',
  rainstorm: '暴雨',

  // 雷暴
  雷暴: '雷暴',
  雷雨: '雷暴',
  强雷暴: '雷暴',
  雷电: '雷暴',
  雷电交加: '雷暴',
  雷阵雨: '雷暴',
  电闪雷鸣: '雷暴',
  thunderstorm: '雷暴',
  lightningstorm: '雷暴',

  // 暴风雪
  暴风雪: '暴风雪',
  暴雪: '暴风雪',
  极寒: '暴风雪',
  极寒暴雪: '暴风雪',
  寒潮: '暴风雪',
  冻雨: '暴风雪',
  冰雹: '暴风雪',
  冰风暴: '暴风雪',
  风雪: '暴风雪',
  blizzard: '暴风雪',
  freezingrain: '暴风雪',
  snowstorm: '暴风雪',

  // 强台风
  强台风: '强台风',
  台风: '强台风',
  超强台风: '强台风',
  飓风: '强台风',
  热带气旋: '强台风',
  狂风: '强台风',
  暴风: '强台风',
  风暴: '强台风',
  typhoon: '强台风',
  hurricane: '强台风',
  cyclone: '强台风',
  storm: '强台风',

  // 沙尘暴
  沙尘暴: '沙尘暴',
  强沙尘暴: '沙尘暴',
  黑风暴: '沙尘暴',
  扬沙: '沙尘暴',
  浮尘: '沙尘暴',
  风沙: '沙尘暴',
  沙暴: '沙尘暴',
  sandstorm: '沙尘暴',
  duststorm: '沙尘暴',

  // 强磁暴
  强磁暴: '强磁暴',
  磁暴: '强磁暴',
  电磁风暴: '强磁暴',
  辐射风暴: '强磁暴',
  酸雨: '强磁暴',
  离子风暴: '强磁暴',
  地磁暴: '强磁暴',
  太阳风暴: '强磁暴',
  magneticstorm: '强磁暴',
  radstorm: '强磁暴',
  radiationstorm: '强磁暴',
  acidrain: '强磁暴',

  // 真空无气象
  真空无气象: '真空无气象',
  月面真空: '真空无气象',
  太空真空: '真空无气象',
  轨道真空: '真空无气象',
  无大气: '真空无气象',
  真空: '真空无气象',
  无气象: '真空无气象',
  vacuum: '真空无气象',
};

/**
 * 将任意天气描述归一化为 12 项标准天气预设之一。
 * - 空值 / 空字符串返回 `''`；
 * - 精确匹配或同义词表命中返回对应正典词；
 * - 未直接命中但包含特征词根时按恶劣等级优先归一；否则默认归为 `'晴'`。
 */
export function normalizeCanonicalWeather(raw: unknown): CanonicalWeatherPreset | '' {
  if (raw === null || raw === undefined) return '';
  const text = String(raw).trim();
  if (!text) return '';

  if (CANONICAL_WEATHER_SET.has(text)) {
    return text as CanonicalWeatherPreset;
  }

  const normKey = text.toLowerCase().replace(/[\s_·\-—/]+/g, '');
  const direct = WEATHER_SYNONYM_MAP[normKey] ?? WEATHER_SYNONYM_MAP[text];
  if (direct) return direct;

  // 子串特征词优先匹配（按天体 -> 极端恶劣 -> 中度不良 -> 良好顺序）
  if (/真空|无大气|无气象|月面|太空|vacuum/.test(normKey)) return '真空无气象';
  if (/磁暴|电磁|辐射|酸雨|离子|radstorm|magnetic|acidrain/.test(normKey)) return '强磁暴';
  if (/沙尘|黑风暴|扬沙|沙暴|风沙|sandstorm|duststorm/.test(normKey)) return '沙尘暴';
  if (/台风|飓风|气旋|狂风|typhoon|hurricane|cyclone/.test(normKey)) return '强台风';
  if (/暴风雪|暴雪|极寒|寒潮|冻雨|冰风暴|风雪|blizzard|freezingrain|snowstorm/.test(normKey)) return '暴风雪';
  if (/雷暴|雷雨|雷电|雷阵雨|thunder|lightning/.test(normKey)) return '雷暴';
  if (/暴雨|大雨|强降雨|豪雨|大雪|heavyrain|downpour|rainstorm/.test(normKey)) return '暴雨';
  if (/大雾|浓雾|迷雾|雾霾|海雾|雾|fog|mist/.test(normKey)) return '大雾';
  if (/小雨|微雨|阵雨|细雨|小雪|微雪|drizzle|lightrain/.test(normKey)) return '小雨';
  if (/多云|少云|cloudy/.test(normKey)) return '多云';
  if (/阴|overcast/.test(normKey)) return '阴';
  if (/晴|碧空|无云|clear|sunny/.test(normKey)) return '晴';

  return '晴';
}

/* ═══════════════ 2. 基地选址类型推导（inferBaseSiteType） ═══════════════ */

export const VALID_BASE_SITE_TYPES: readonly BaseSiteType[] = [
  'inland_canyon',
  'equatorial_coastal',
  'sea_platform',
  'high_latitude',
  'orbital_dock',
  'lunar_surface',
] as const;

const VALID_SITE_TYPE_SET = new Set<string>(VALID_BASE_SITE_TYPES);

const SITE_TYPE_ALIAS_MAP: Readonly<Record<string, BaseSiteType>> = {
  inland_canyon: 'inland_canyon',
  inlandcanyon: 'inland_canyon',
  内陆: 'inland_canyon',
  内陆深谷: 'inland_canyon',
  深谷: 'inland_canyon',
  山体: 'inland_canyon',
  山体加固: 'inland_canyon',
  峡谷: 'inland_canyon',

  equatorial_coastal: 'equatorial_coastal',
  equatorialcoastal: 'equatorial_coastal',
  赤道: 'equatorial_coastal',
  赤道滨海: 'equatorial_coastal',
  低纬滨海: 'equatorial_coastal',
  滨海: 'equatorial_coastal',
  海岛: 'equatorial_coastal',

  sea_platform: 'sea_platform',
  seaplatform: 'sea_platform',
  海上平台: 'sea_platform',
  海上半潜平台: 'sea_platform',
  海上半潜机动平台: 'sea_platform',
  海基平台: 'sea_platform',
  半潜平台: 'sea_platform',

  high_latitude: 'high_latitude',
  highlatitude: 'high_latitude',
  高纬: 'high_latitude',
  极地: 'high_latitude',
  高纬冻土: 'high_latitude',
  极地冻土: 'high_latitude',

  orbital_dock: 'orbital_dock',
  orbitaldock: 'orbital_dock',
  轨道: 'orbital_dock',
  轨道船坞: 'orbital_dock',
  近地轨道: 'orbital_dock',
  空间站: 'orbital_dock',

  lunar_surface: 'lunar_surface',
  lunarsurface: 'lunar_surface',
  月球: 'lunar_surface',
  月面: 'lunar_surface',
  月球表面: 'lunar_surface',
  月球基地: 'lunar_surface',
};

export interface BaseSiteInferInput {
  site_type?: string;
  name?: string;
  location?: string;
  buildings?: ReadonlyArray<{ name?: string }>;
}

/**
 * 解析显式选址字符串（若未识别则返回 `''`）。
 */
export function normalizeBaseSiteType(raw: unknown): BaseSiteType | '' {
  if (raw === null || raw === undefined) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  if (VALID_SITE_TYPE_SET.has(trimmed)) return trimmed as BaseSiteType;
  const key = trimmed.toLowerCase().replace(/[\s_-]+/g, '');
  if (SITE_TYPE_ALIAS_MAP[key]) return SITE_TYPE_ALIAS_MAP[key];
  if (SITE_TYPE_ALIAS_MAP[trimmed]) return SITE_TYPE_ALIAS_MAP[trimmed];

  if (/月|沙克尔顿|lunar/.test(key)) return 'lunar_surface';
  if (/轨道|船坞|空间站|orbital/.test(key)) return 'orbital_dock';
  if (/海基(?!地)|半潜|平台|驳船|seaplatform/.test(key)) return 'sea_platform';
  if (/赤道|滨海|文昌|海岛|滩头|礁|coastal|equator/.test(key)) return 'equatorial_coastal';
  if (/极地|高纬|冻土|冰原|勘察加|highlatitude|polar|arctic/.test(key)) return 'high_latitude';
  if (/内陆|深谷|山体|峡谷|inland|canyon/.test(key)) return 'inland_canyon';
  return '';
}

/**
 * 推导基地地理/天体选址类型（FD-26 / FD-27）：
 * - 若 `base.site_type` 已指定合法值则直接返回；
 * - 否则按 `name + location` 智能推导：
 *   含 `月/沙克尔顿` -> `'lunar_surface'`
 *   含 `轨道/船坞/空间站` -> `'orbital_dock'`
 *   含 `海基(?!地)/半潜/平台/驳船` -> `'sea_platform'`
 *   含 `赤道/滨海/文昌/海岛/滩头/礁` -> `'equatorial_coastal'`
 *   含 `极地/高纬/冻土/冰原/勘察加` -> `'high_latitude'`
 *   默认 -> `'inland_canyon'`
 */
export function inferBaseSiteType(base: BaseSiteInferInput | string | undefined | null): BaseSiteType {
  if (!base) return 'inland_canyon';
  if (typeof base === 'string') {
    return normalizeBaseSiteType(base) || 'inland_canyon';
  }
  const explicit = normalizeBaseSiteType(base.site_type);
  if (explicit) return explicit;

  const combined = `${base.name ?? ''} ${base.location ?? ''}`.trim();
  if (!combined) return 'inland_canyon';

  if (/月|沙克尔顿/.test(combined)) return 'lunar_surface';
  if (/轨道|船坞|空间站/.test(combined)) return 'orbital_dock';
  if (/海基(?!地)|半潜|平台|驳船/.test(combined)) return 'sea_platform';
  if (/赤道|滨海|文昌|海岛|滩头|礁/.test(combined)) return 'equatorial_coastal';
  if (/极地|高纬|冻土|冰原|勘察加/.test(combined)) return 'high_latitude';

  return 'inland_canyon';
}

/* ═══════════════ 3. 首基地标准时区与多基地本地时钟推导 ═══════════════ */

const CN_DIGIT_MAP: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12,
  十三: 13,
  十四: 14,
};

function parseChineseZoneNumber(text: string): number | null {
  const trimmed = text.trim();
  if (CN_DIGIT_MAP[trimmed] !== undefined) return CN_DIGIT_MAP[trimmed];
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function clampTzOffset(offset: number): number {
  const clamped = Math.max(-12, Math.min(14, offset));
  // 归一到 0.5 小时精度，消除 -0
  const rounded = Math.round(clamped * 2) / 2;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * 解析基地时区偏移（相对于首座基地标准时区 0 的小时数，范围 [-12, 14]）：
 * - 若 `isFirstBase === true`，恒返回 `0`（第一基地恒为战区标准时区 `0`）；
 * - 支持数字（`2`, `-5`, `5.5`）、带符号字符串（`"+2"`, `"-5"`, `"UTC+3"`, `"标准时+2"`, `"东二区"`, `"西四区"`, `"快2小时"`, `"慢4小时"`）解析。
 */
export function parseTimezoneOffset(raw: unknown, isFirstBase = false): number {
  if (isFirstBase) return 0;
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? clampTzOffset(raw) : 0;
  }
  const text = String(raw).trim();
  if (!text) return 0;

  if (/轨道标准时|月球标准时|标准时区|基准时/.test(text) && !/[+-]\s*\d/.test(text)) {
    return 0;
  }

  // 匹配「东X区」/「西X区」
  const zoneMatch = text.match(/([东西])\s*([零〇一二两三四五六七八九十\d]+)\s*区/);
  if (zoneMatch) {
    const sign = zoneMatch[1] === '西' ? -1 : 1;
    const val = parseChineseZoneNumber(zoneMatch[2]);
    if (val !== null) return clampTzOffset(sign * val);
  }

  // 匹配「快X小时」/「慢X小时」
  const fastSlowMatch = text.match(/([快慢])\s*(\d+(?:\.\d+)?)\s*(?:小时|h)?/i);
  if (fastSlowMatch) {
    const sign = fastSlowMatch[1] === '慢' ? -1 : 1;
    const val = Number(fastSlowMatch[2]);
    if (Number.isFinite(val)) return clampTzOffset(sign * val);
  }

  // 匹配带符号或纯数字，如 "+2", "-5", "UTC+3", "GMT-4", "标准时+2", "+5.5h"
  const numMatch = text.match(/([+-]?\d+(?:\.\d+)?)/);
  if (numMatch) {
    const val = Number(numMatch[1]);
    if (Number.isFinite(val)) return clampTzOffset(val);
  }

  return 0;
}

export type DaylightPhase = 'day' | 'dawn_dusk' | 'night' | 'space_eternal';

export interface BaseLocalClockView {
  baseId: string;
  baseName: string;
  /** 是否为第一基地（标准时区基准） */
  isStandardBase: boolean;
  /** 相对于首基地标准时的小时偏移（-12 ~ +14） */
  tzOffsetHours: number;
  /** 同 tzOffsetHours（便于调用方读取 effectiveOffset） */
  effectiveOffset: number;
  /** 格式化时区徽标，首基地为 "标准时 (±0h)"，其余如 "标准时 +2h" / "标准时 -5h" */
  tzBadgeText: string;
  /** 本地时间字符串 "HH:mm" */
  localTimeText: string;
  /** 本地小时数 (0~23) */
  localHour: number;
  /** 本地分钟数 (0~59) */
  localMinute: number;
  /** 相对于首基地的跨日偏移：-1(前一日) | 0(同日) | +1(次日) */
  dayShift: -1 | 0 | 1;
  /** 本地日序数（基于 globalClock.day + dayShift） */
  localDay: number;
  /** 昼夜相位：轨道/月面为 space_eternal，06:00-07:59 及 18:00-19:59 为 dawn_dusk，08:00-17:59 为 day，20:00-05:59 为 night */
  daylightPhase: DaylightPhase;
  /** 昼夜相位展示文本 */
  daylightLabel: string;
  /** 夜间隐蔽暴露度增量乘数（夜间 0.85 即 -15%，其余 1.0） */
  nightExposureMultiplier: number;
}

export interface ResolveBaseLocalClockOptions {
  isFirstBase?: boolean;
  siteType?: string;
  baseId?: string;
  baseName?: string;
  location?: string;
}

function parseClockTimeMinutes(rawTime: string | undefined): number {
  if (typeof rawTime === 'string') {
    const m = rawTime.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
      const hh = Number(m[1]);
      const mm = Number(m[2]);
      if (Number.isFinite(hh) && Number.isFinite(mm) && hh >= 0 && hh < 24 && mm >= 0 && mm < 60) {
        return hh * 60 + mm;
      }
    }
  }
  // 默认 08:00
  return 8 * 60;
}

function formatOffsetNumber(offset: number): string {
  if (offset === 0) return '±0h';
  const sign = offset > 0 ? '+' : '';
  return `${sign}${offset}h`;
}

/**
 * 推导基地本地时钟与昼夜相位（FD-26 · D-TZ-1）：
 * - 以 `globalClock?.time || '08:00'` 为首基地标准时间；
 * - 首基地 `effectiveOffset = 0`，其余基地按 `tzOffsetHours ?? 0` 偏移计算本地 `localTimeText`（`"HH:mm"`）、`localHour`（0~23）、`dayShift`（`-1 | 0 | 1`）、`tzBadgeText`；
 * - 昼夜相位 `daylightPhase`：若 `siteType === 'orbital_dock' || siteType === 'lunar_surface'` 为 `'space_eternal'`（`"☀️ 太空恒照"`）；
 *   否则 `06:00~07:59` 与 `18:00~19:59` 为 `'dawn_dusk'`（`"🌅 晨昏"`），`08:00~17:59` 为 `'day'`（`"☀️ 白昼"`），`20:00~05:59` 为 `'night'`（`"🌙 夜间"`，提供 `nightExposureMultiplier = 0.85`）。
 */
export function resolveBaseLocalClock(
  globalClock: { day?: number; time?: string } | undefined,
  tzOffsetHours: number | undefined,
  opts: ResolveBaseLocalClockOptions = {},
): BaseLocalClockView {
  const isFirstBase = opts.isFirstBase === true;
  const effectiveOffset = isFirstBase ? 0 : parseTimezoneOffset(tzOffsetHours ?? 0, false);

  const stdMinutes = parseClockTimeMinutes(globalClock?.time);
  const offsetMinutes = Math.round(effectiveOffset * 60);
  const rawLocalMinutes = stdMinutes + offsetMinutes;

  let dayShift: -1 | 0 | 1 = 0;
  if (rawLocalMinutes < 0) {
    dayShift = -1;
  } else if (rawLocalMinutes >= 1440) {
    dayShift = 1;
  }

  const wrappedMinutes = ((rawLocalMinutes % 1440) + 1440) % 1440;
  const localHour = Math.floor(wrappedMinutes / 60);
  const localMinute = wrappedMinutes % 60;
  const localTimeText = `${String(localHour).padStart(2, '0')}:${String(localMinute).padStart(2, '0')}`;

  const baseDay =
    typeof globalClock?.day === 'number' && Number.isFinite(globalClock.day) ? Math.floor(globalClock.day) : 1;
  const localDay = Math.max(1, baseDay + dayShift);

  const tzBadgeText =
    isFirstBase || effectiveOffset === 0
      ? '标准时 (±0h)'
      : `标准时 ${formatOffsetNumber(effectiveOffset)}`;

  const resolvedSiteType = inferBaseSiteType({
    site_type: opts.siteType,
    name: opts.baseName,
    location: opts.location,
  });

  let daylightPhase: DaylightPhase;
  let daylightLabel: string;
  if (resolvedSiteType === 'orbital_dock' || resolvedSiteType === 'lunar_surface') {
    daylightPhase = 'space_eternal';
    daylightLabel = '☀️ 太空恒照';
  } else if ((localHour >= 6 && localHour <= 7) || (localHour >= 18 && localHour <= 19)) {
    daylightPhase = 'dawn_dusk';
    daylightLabel = '🌅 晨昏';
  } else if (localHour >= 8 && localHour <= 17) {
    daylightPhase = 'day';
    daylightLabel = '☀️ 白昼';
  } else {
    daylightPhase = 'night';
    daylightLabel = '🌙 夜间';
  }

  const nightExposureMultiplier = daylightPhase === 'night' ? 0.85 : 1.0;

  return {
    baseId: opts.baseId ?? '',
    baseName: opts.baseName ?? '',
    isStandardBase: isFirstBase,
    tzOffsetHours: effectiveOffset,
    effectiveOffset,
    tzBadgeText,
    localTimeText,
    localHour,
    localMinute,
    dayShift,
    localDay,
    daylightPhase,
    daylightLabel,
    nightExposureMultiplier,
  };
}

/* ═══════════════ 4. 基地有效天气解析（resolveEffectiveBaseWeather） ═══════════════ */

export interface BaseWeatherView {
  /** 归一化后的标准预设天气名（12 选 1） */
  effectiveWeather: CanonicalWeatherPreset;
  /** 原始天气字符串（保留供排查） */
  rawWeather: string;
  /** 来源：'base_local'(基地局部覆写) | 'global_fallback'(继承 meta.weather) | 'extraterrestrial'(轨道/月面恒定真空) */
  source: 'base_local' | 'global_fallback' | 'extraterrestrial';
  /** 是否触发资金链折减（economyMultiplier < 1.0） */
  isSevereForEconomy: boolean;
  /** 是否触发常规火箭发射挂起（雷暴/暴风雪/强台风/沙尘暴/强磁暴） */
  isSevereForLaunch: boolean;
  /** 经济正向收入链乘数（良好 1.0，大雾 0.85，恶劣 0.50） */
  economyMultiplier: number;
  /** 局部暴露度增量乘数（大雾 0.80、沙尘暴 0.75、阴 0.95、其余 1.0） */
  localExposureMultiplier: number;
}

const SEVERE_LAUNCH_WEATHERS: ReadonlySet<CanonicalWeatherPreset> = new Set<CanonicalWeatherPreset>([
  '雷暴',
  '暴风雪',
  '强台风',
  '沙尘暴',
  '强磁暴',
]);

const HALF_ECONOMY_WEATHERS: ReadonlySet<CanonicalWeatherPreset> = new Set<CanonicalWeatherPreset>([
  '暴雨',
  '雷暴',
  '暴风雪',
  '强台风',
  '沙尘暴',
  '强磁暴',
]);

/**
 * 解析单座基地的当前有效气象（FD-26 · D-WTH-1）：
 * - 若基地为月球基地或轨道船坞（`site_type === 'lunar_surface' || site_type === 'orbital_dock'` 或名称/位置含 `月球/月面/轨道/空间站`），
 *   恒定返回 `effectiveWeather: '真空无气象'`, `source: 'extraterrestrial'`, `isSevereForEconomy: false`, `isSevereForLaunch: false`, `economyMultiplier: 1.0`, `localExposureMultiplier: 1.0`；
 * - 否则优先读取 `base?.weather`（非空时 `source: 'base_local'`），缺省回退 `globalWeather`（`source: 'global_fallback'`）；
 * - 按 §3.2.3 表格返回 `economyMultiplier`、`isSevereForLaunch`、`localExposureMultiplier`。
 */
export function resolveEffectiveBaseWeather(
  base: { weather?: string; site_type?: string; location?: string; name?: string } | undefined,
  globalWeather?: string,
): BaseWeatherView {
  const inferredSite = inferBaseSiteType(base);
  const combinedText = `${base?.name ?? ''} ${base?.location ?? ''}`;
  const isExtraterrestrialSite =
    inferredSite === 'lunar_surface' ||
    inferredSite === 'orbital_dock' ||
    /月球|月面|轨道|空间站|沙克尔顿/.test(combinedText);

  if (isExtraterrestrialSite) {
    return {
      effectiveWeather: '真空无气象',
      rawWeather: String(base?.weather || globalWeather || '真空无气象'),
      source: 'extraterrestrial',
      isSevereForEconomy: false,
      isSevereForLaunch: false,
      economyMultiplier: 1.0,
      localExposureMultiplier: 1.0,
    };
  }

  const rawBaseWeather = typeof base?.weather === 'string' ? base.weather.trim() : '';
  const rawGlobalWeather = typeof globalWeather === 'string' ? globalWeather.trim() : '';

  const hasBaseLocal = rawBaseWeather.length > 0;
  const rawChosen = hasBaseLocal ? rawBaseWeather : rawGlobalWeather;
  const source: BaseWeatherView['source'] = hasBaseLocal ? 'base_local' : 'global_fallback';
  const effectiveWeather: CanonicalWeatherPreset = normalizeCanonicalWeather(rawChosen) || '晴';

  if (effectiveWeather === '真空无气象') {
    return {
      effectiveWeather: '真空无气象',
      rawWeather: rawChosen || '真空无气象',
      source: 'extraterrestrial',
      isSevereForEconomy: false,
      isSevereForLaunch: false,
      economyMultiplier: 1.0,
      localExposureMultiplier: 1.0,
    };
  }

  let economyMultiplier = 1.0;
  if (effectiveWeather === '大雾') {
    economyMultiplier = 0.85;
  } else if (HALF_ECONOMY_WEATHERS.has(effectiveWeather)) {
    economyMultiplier = 0.5;
  }

  const isSevereForEconomy = economyMultiplier < 1.0;
  const isSevereForLaunch = SEVERE_LAUNCH_WEATHERS.has(effectiveWeather);

  let localExposureMultiplier = 1.0;
  if (effectiveWeather === '大雾') {
    localExposureMultiplier = 0.8;
  } else if (effectiveWeather === '沙尘暴') {
    localExposureMultiplier = 0.75;
  } else if (effectiveWeather === '阴') {
    localExposureMultiplier = 0.95;
  }

  return {
    effectiveWeather,
    rawWeather: rawChosen,
    source,
    isSevereForEconomy,
    isSevereForLaunch,
    economyMultiplier,
    localExposureMultiplier,
  };
}
