/**
 * timePastParser.ts —— <timePast> 时间解析与时钟推进积分器（CTRL-TIME-PARSER-01）
 *
 * 对齐任务包 §3.9 时间驱动客观引擎规范：
 * 1. 鲁棒语法提取（parseTimePast）：
 *    - 支持标准标签 <timePast>xx D xx H xx M</timePast>，大小写与内部空白容忍；
 *    - 兼容缺省单位（如 2 D 4 H、15 M、0 D 12 H 30 M、36 H）；
 *    - 兼容紧凑语法与缩写（如 2d4h、1.5 H、0.5 D、中文 2天4小时15分、1天半）；
 *    - 换算为标准整型分钟数 Δt（如 1 D 2 H 30 M = 1590 分钟）；
 * 2. 安全兜底与隔离（Safe Fallback）：
 *    - 标签缺失、格式畸变或解析为负数/非法时安全降级至默认步长（默认 60 分钟）；
 *    - 返回结构化元数据（success, rawText, deltaMinutes, days, hours, minutes, isFallback）；
 * 3. 正文清洗工具（stripTimePast）：
 *    - 剥离正文中的 <timePast>...</timePast> 块及多余首尾空行；
 * 4. 日历时钟推进积分（advanceCalendar）：
 *    - 纯函数根据当前日期与增量 Δt 计算推进后的日期与跨越天数 day_count 增量。
 */

import { indexFloorProtocols } from './floorProtocolIndex';
import { stripThinking } from './floorSanitize';

/** 匹配 <time_Anchor>...</time_Anchor> 块（兼容大小写与全角尖括号） */
const TIME_ANCHOR_BLOCK_REGEX =
  /[<\uFF1C]\s*time_anchor\b[^>\uFF1E]*[>\uFF1E]([\s\S]*?)[<\uFF1C]\s*\/\s*time_anchor\s*[>\uFF1E]/i;

/** 从 <time_Anchor> 内容中提取内联 timePast 属性值（自动剥离后续紧跟的其他 key:value 属性） */
const INLINE_TIME_PAST_ATTR_REGEX =
  /\btimepast\s*[:：=]\s*([^\r\n|<>\uFF1C\uFF1E;；,，]+?)(?=\s+[a-z_][a-z0-9_]*\s*[:：=]|$)/i;

function extractInlineTimePastFromAnchor(raw: string): string | null {
  const thinkFree = stripThinking(raw).text;
  const anchorMatch = thinkFree.match(TIME_ANCHOR_BLOCK_REGEX);
  if (!anchorMatch) return null;
  const attrMatch = anchorMatch[1].match(INLINE_TIME_PAST_ATTR_REGEX);
  const val = attrMatch?.[1]?.trim();
  return val ? val : null;
}

/** 匹配首个 <timePast> 标签及其内容的正则表达式（不区分大小写，支持内部任意空白换行） */
export const TIME_PAST_REGEX = /<\s*timepast\s*>([\s\S]*?)<\s*\/\s*timepast\s*>/i;

/** 匹配所有 <timePast> 标签块的全局正则表达式（用于文本剥离清洗） */
export const ALL_TIME_PAST_REGEX = /<\s*timepast\s*>[\s\S]*?<\s*\/\s*timepast\s*>/gi;

/** 默认兜底分钟数（1 小时） */
export const DEFAULT_FALLBACK_MINUTES = 60;

/* ═══════════════ 类型定义 ═══════════════ */

export interface TimePastParseOptions {
  /** 解析失败或缺失时的兜底时间步长（单位：分钟），默认 60 */
  defaultMinutes?: number;
}

export interface TimePastParseResult {
  /** 是否成功解析出合法标签且数值有效 */
  success: boolean;
  /** 匹配到的原始标签内部文本（已去除首尾空白） */
  rawText?: string;
  /** 换算为标准整型分钟数 Δt（若触发 fallback，则为 defaultMinutes） */
  deltaMinutes: number;
  /** 规范化后的天数 (Math.floor(deltaMinutes / 1440)) */
  days: number;
  /** 规范化后的小时 (Math.floor((deltaMinutes % 1440) / 60)) */
  hours: number;
  /** 规范化后的分钟 (deltaMinutes % 60) */
  minutes: number;
  /** 是否触发了安全兜底 */
  isFallback: boolean;
  /** 失败或告警原因描述（若触发 fallback） */
  error?: string;
}

export interface CalendarAdvanceOptions {
  /** 当日期字符串缺少时间部分时，是否自动追加时间后缀（默认 false） */
  appendTimeIfMissing?: boolean;
  /** 缺少时间后缀时的默认起始时间，格式 HH:mm，默认 '08:00' */
  defaultStartTime?: string;
}

export interface CalendarAdvanceResult {
  /** 推进后的日期字符串 */
  newDate: string;
  /** 跨越的自然日天数增量（>= 0） */
  dayCountDelta: number;
  /** 推进后的总天数 (currentDayCount + dayCountDelta) */
  newDayCount: number;
  /** 推进后的时间分量（HH:mm，若可推导） */
  timeStr?: string;
}

/* ═══════════════ 辅助解析工具 ═══════════════ */

/**
 * 将整型分钟数规范化分解为 days, hours, minutes
 */
function normalizeMinutes(totalMinutes: number): { days: number; hours: number; minutes: number } {
  const safe = Math.max(0, Math.round(totalMinutes));
  const days = Math.floor(safe / 1440);
  const hours = Math.floor((safe % 1440) / 60);
  const minutes = safe % 60;
  return { days, hours, minutes };
}

/**
 * 解析标签内部字符串为总分钟数
 * 支持：
 * - 英文分量：D, H, M 及其复数和缩写（d, day, days, h, hr, hrs, hour, hours, m, min, mins, minute, minutes）
 * - 浮点数：1.5 H, 0.5 D
 * - 中文分量：天, 小时, 时, 分, 分钟, 半天, 1天半, 半小时, 1小时半
 * - 纯数字：直接视为分钟
 */
function parseTimeStringToMinutes(content: string): { totalMinutes: number; matched: boolean } {
  const trimmed = content.trim();
  if (!trimmed) {
    return { totalMinutes: 0, matched: false };
  }

  // 严格拦截负数（如 -2 H, -15M 等非法时空倒流）
  if (/-\s*\d+/.test(trimmed)) {
    return { totalMinutes: 0, matched: false };
  }

  // 1. 兼容纯数字（无单位降级为分钟数）
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const val = parseFloat(trimmed);
    return { totalMinutes: val, matched: !Number.isNaN(val) };
  }

  let days = 0;
  let hours = 0;
  let minutes = 0;
  let hasMatch = false;

  // 2. 中文“半”的自然语言习惯处理
  // 例：“1天半” -> 1.5 天；“半天” -> 0.5 天
  const dayHalfMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*天半/);
  if (dayHalfMatch) {
    days += parseFloat(dayHalfMatch[1]) + 0.5;
    hasMatch = true;
  } else if (/半天/.test(trimmed)) {
    days += 0.5;
    hasMatch = true;
  }

  // 例：“1小时半” / “1个半小时” -> 1.5 小时；“半小时” -> 0.5 小时
  const hourHalfMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:个)?(?:小时半|时半)/);
  if (hourHalfMatch) {
    hours += parseFloat(hourHalfMatch[1]) + 0.5;
    hasMatch = true;
  } else if (/半(?:个)?小时|半时/.test(trimmed)) {
    hours += 0.5;
    hasMatch = true;
  }

  // 3. 正则扫描标准与缩写分量
  // 天数正则：支持 D, d, day, days, 天
  const dayRegex = /(\d+(?:\.\d+)?)\s*(?:d(?:ays?)?|天)(?!半)/gi;
  let dMatch: RegExpExecArray | null;
  while ((dMatch = dayRegex.exec(trimmed)) !== null) {
    days += parseFloat(dMatch[1]);
    hasMatch = true;
  }

  // 小时正则：支持 H, h, hr, hrs, hour, hours, 小时, 时
  const hourRegex = /(\d+(?:\.\d+)?)\s*(?:h(?:(?:ou)?rs?)?|小时|时)(?!半)/gi;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = hourRegex.exec(trimmed)) !== null) {
    hours += parseFloat(hMatch[1]);
    hasMatch = true;
  }

  // 分钟正则：支持 M, m, min, mins, minute, minutes, 分, 分钟
  // 注意：使用前瞻防止误匹配非分钟词汇
  const minRegex = /(\d+(?:\.\d+)?)\s*(?:min(?:ute)?s?|m(?!s)|分(?:钟)?)/gi;
  let mMatch: RegExpExecArray | null;
  while ((mMatch = minRegex.exec(trimmed)) !== null) {
    minutes += parseFloat(mMatch[1]);
    hasMatch = true;
  }

  if (!hasMatch) {
    return { totalMinutes: 0, matched: false };
  }

  const total = days * 1440 + hours * 60 + minutes;
  if (Number.isNaN(total) || total < 0) {
    return { totalMinutes: 0, matched: false };
  }

  return { totalMinutes: total, matched: true };
}

/* ═══════════════ 核心纯函数导出 ═══════════════ */

/**
 * 从文本中精准提取 <timePast> 标签并换算为标准整型分钟数 Δt
 *
 * @param text 大模型输出正文或待解析文本
 * @param options 解析选项（支持配置兜底时间步长）
 * @returns 结构化解析结果
 */
export function parseTimePast(text: string, options: TimePastParseOptions = {}): TimePastParseResult {
  const fallbackMinutes = options.defaultMinutes ?? DEFAULT_FALLBACK_MINUTES;

  if (!text || typeof text !== 'string') {
    const norm = normalizeMinutes(fallbackMinutes);
    return {
      success: false,
      deltaMinutes: Math.round(fallbackMinutes),
      days: norm.days,
      hours: norm.hours,
      minutes: norm.minutes,
      isFallback: true,
      error: 'Empty or non-string input text',
    };
  }

  // 与卡片回退共用块索引：损坏的首个时间块不能被后面的块悄悄顶替。
  const block = indexFloorProtocols(text).find(b => b.tag === 'timepast');
  if (block && block.status !== 'valid') {
    const norm = normalizeMinutes(fallbackMinutes);
    return {
      success: false,
      deltaMinutes: Math.round(fallbackMinutes),
      days: norm.days,
      hours: norm.hours,
      minutes: norm.minutes,
      isFallback: true,
      error: 'Tag <timePast> not found',
    };
  }

  const rawText = (block?.payload && block.payload.trim()) || extractInlineTimePastFromAnchor(text);
  if (rawText === null || rawText === undefined) {
    const norm = normalizeMinutes(fallbackMinutes);
    return {
      success: false,
      deltaMinutes: Math.round(fallbackMinutes),
      days: norm.days,
      hours: norm.hours,
      minutes: norm.minutes,
      isFallback: true,
      error: 'Tag <timePast> not found',
    };
  }

  const { totalMinutes, matched } = parseTimeStringToMinutes(rawText);

  if (!matched) {
    const norm = normalizeMinutes(fallbackMinutes);
    return {
      success: false,
      rawText,
      deltaMinutes: Math.round(fallbackMinutes),
      days: norm.days,
      hours: norm.hours,
      minutes: norm.minutes,
      isFallback: true,
      error: `Failed to parse time content: "${rawText}"`,
    };
  }

  const roundedMinutes = Math.round(totalMinutes);
  const norm = normalizeMinutes(roundedMinutes);

  return {
    success: true,
    rawText,
    deltaMinutes: roundedMinutes,
    days: norm.days,
    hours: norm.hours,
    minutes: norm.minutes,
    isFallback: false,
  };
}

/**
 * 格式化整型分钟数为标准 <timePast> 标签
 *
 * @param deltaMinutes 增量分钟数
 * @returns 标准格式化标签字符串，例如 `<timePast>0 D 8 H 0 M</timePast>`
 */
export function formatTimePast(deltaMinutes: number): string {
  const norm = normalizeMinutes(deltaMinutes);
  return `<timePast>${norm.days} D ${norm.hours} H ${norm.minutes} M</timePast>`;
}

/**
 * 纯函数：剥离文本中的所有 <timePast>...</timePast> 标签块及多余连续空行
 *
 * @param text 待清洗的正文内容
 * @returns 清洗后的干净正文
 */
export function stripTimePast(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // 1. 剥离所有 <timePast>...</timePast>
  let cleaned = text.replace(ALL_TIME_PAST_REGEX, '');

  // 2. 压缩可能由标签剥离产生的多余连续空行（3个及以上换行压缩为双换行）
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // 3. 清除开头空行与末尾空白
  cleaned = cleaned.replace(/^\s*\n+/, '').trimEnd();

  return cleaned;
}

/**
 * 辅助格式化两位数字
 */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 日历时钟推进积分纯函数
 *
 * 根据当前日期字符串与增量 Δt（分钟），推导推进后的日期字符串与跨越天数增量
 *
 * 支持格式：
 * 1. 标准 ISO/日期时间：YYYY-MM-DD HH:mm、YYYY/MM/DD HH:mm（如 "2026-09-18 08:00"）
 * 2. 游戏架空复合格式：前缀 + HH:mm（如 "秋·九月十七 08:00"、"第47天 08:00"）
 * 3. 纯时间格式：HH:mm（如 "08:00"）
 * 4. 纯文本描述：如 "秋·九月十七"、"第47天"
 *
 * @param currentDate 当前日期字符串
 * @param deltaMinutes 推进分钟数（>= 0）
 * @param currentDayCount 当前已流逝总天数（默认 0）
 * @param options 日历推进选项
 */
export function advanceCalendar(
  currentDate: string,
  deltaMinutes: number,
  currentDayCount = 0,
  options: CalendarAdvanceOptions = {},
): CalendarAdvanceResult {
  const safeDelta = Math.max(0, Math.round(deltaMinutes || 0));
  const safeDayCount = Math.max(0, Math.round(currentDayCount || 0));
  const defaultStartTime = options.defaultStartTime ?? '08:00';

  if (!currentDate || typeof currentDate !== 'string') {
    const dayCountDelta = Math.floor(safeDelta / 1440);
    return {
      newDate: '',
      dayCountDelta,
      newDayCount: safeDayCount + dayCountDelta,
    };
  }

  const trimmedDate = currentDate.trim();

  // ── 模式 1：标准公历日期时间（YYYY-MM-DD HH:mm 或带秒 / 斜杠分隔） ──
  const standardDateMatch = trimmedDate.match(
    /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );

  if (standardDateMatch) {
    const year = Number(standardDateMatch[1]);
    const sep = standardDateMatch[2];
    const month = Number(standardDateMatch[3]);
    const day = Number(standardDateMatch[4]);
    const hasTime = standardDateMatch[5] !== undefined;

    let initH = 8;
    let initM = 0;

    if (hasTime) {
      initH = Number(standardDateMatch[5]);
      initM = Number(standardDateMatch[6]);
    } else if (options.appendTimeIfMissing) {
      const [sh, sm] = defaultStartTime.split(':').map(Number);
      initH = sh || 0;
      initM = sm || 0;
    }

    const baseDate = new Date(year, month - 1, day, initH, initM, 0);
    const oldMidnight = new Date(year, month - 1, day, 0, 0, 0).getTime();

    // 累加时间
    baseDate.setMinutes(baseDate.getMinutes() + safeDelta);

    const newYear = baseDate.getFullYear();
    const newMonth = baseDate.getMonth() + 1;
    const newDay = baseDate.getDate();
    const newH = baseDate.getHours();
    const newM = baseDate.getMinutes();

    const newMidnight = new Date(newYear, newMonth - 1, newDay, 0, 0, 0).getTime();
    const dayCountDelta = Math.round((newMidnight - oldMidnight) / (24 * 3600 * 1000));
    const timeStr = `${pad2(newH)}:${pad2(newM)}`;

    let newDateStr: string;
    if (hasTime || options.appendTimeIfMissing) {
      newDateStr = `${newYear}${sep}${pad2(newMonth)}${sep}${pad2(newDay)} ${timeStr}`;
    } else {
      newDateStr = `${newYear}${sep}${pad2(newMonth)}${sep}${pad2(newDay)}`;
    }

    return {
      newDate: newDateStr,
      dayCountDelta,
      newDayCount: safeDayCount + dayCountDelta,
      timeStr,
    };
  }

  // ── 模式 2 & 3：前缀 + 时间 或 纯时间 (HH:mm) ──
  const timeSuffixMatch = trimmedDate.match(/^(.*?)(\d{1,2}):(\d{2})$/);
  if (timeSuffixMatch) {
    const prefix = timeSuffixMatch[1];
    const curH = Number(timeSuffixMatch[2]);
    const curM = Number(timeSuffixMatch[3]);

    const curTotalMins = curH * 60 + curM;
    const advancedTotalMins = curTotalMins + safeDelta;

    const dayCountDelta = Math.floor(advancedTotalMins / 1440);
    const remMins = advancedTotalMins % 1440;
    const newH = Math.floor(remMins / 60);
    const newM = remMins % 60;
    const timeStr = `${pad2(newH)}:${pad2(newM)}`;

    // 如果前缀包含“第N天”，联动自增
    let newPrefix = prefix;
    const dayRegex = /第\s*(\d+)\s*天/;
    const dayMatch = prefix.match(dayRegex);
    if (dayMatch && dayCountDelta > 0) {
      const origDay = parseInt(dayMatch[1], 10);
      newPrefix = prefix.replace(dayRegex, `第${origDay + dayCountDelta}天`);
    }

    return {
      newDate: `${newPrefix}${timeStr}`,
      dayCountDelta,
      newDayCount: safeDayCount + dayCountDelta,
      timeStr,
    };
  }

  // ── 模式 4：纯文本日期无时间后缀（如 "秋·九月十七" 或 "第47天"） ──
  const dayCountDelta = Math.floor(safeDelta / 1440);
  let newDate = trimmedDate;

  // 检查是否包含“第N天”
  const dayRegex = /第\s*(\d+)\s*天/;
  const dayMatch = trimmedDate.match(dayRegex);
  if (dayMatch && dayCountDelta > 0) {
    const origDay = parseInt(dayMatch[1], 10);
    newDate = trimmedDate.replace(dayRegex, `第${origDay + dayCountDelta}天`);
  }

  let timeStr: string | undefined;
  if (options.appendTimeIfMissing) {
    const [sh, sm] = defaultStartTime.split(':').map(Number);
    const totalStartMins = (sh || 0) * 60 + (sm || 0) + (safeDelta % 1440);
    const newH = Math.floor(totalStartMins / 60) % 24;
    const newM = totalStartMins % 60;
    timeStr = `${pad2(newH)}:${pad2(newM)}`;
    newDate = `${newDate} ${timeStr}`;
  }

  return {
    newDate,
    dayCountDelta,
    newDayCount: safeDayCount + dayCountDelta,
    timeStr,
  };
}
