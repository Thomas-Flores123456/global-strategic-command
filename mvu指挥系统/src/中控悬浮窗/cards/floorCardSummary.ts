/**
 * floorCardSummary.ts —— <摘要> / <summary> / <中摘要> / <大摘要> 战地纪要与阶段卷宗合署折叠胶囊卡片解析器与 DOM 渲染器
 */
import { parseSummaryInnerContent } from '../../红警指挥系统/parse/summaryBlockParser';
import { parseOpenTagAttributes } from '../../红警指挥系统/parse/floorProtocolIndex';
import { ensureCardStyleInDoc } from './floorCardStyles';

export interface StorySummaryExtraSection {
  tier: 'micro' | 'meso' | 'macro';
  tierLabel?: string;
  title: string;
  range: string;
  time: string;
  summary: string;
  keywords: string[];
}

export interface StorySummaryCardPayload {
  tier: 'micro' | 'meso' | 'macro';
  tierLabel: string;
  dateOrRange: string;
  range?: string;
  title: string;
  time: string;
  summary: string;
  text: string;
  keywords: string[];
  keys: string[];
  compactPreview: string;
  rawText: string;
  hasStructuredFields: boolean;
  extraSections?: StorySummaryExtraSection[];
}

export type ParsedStorySummaryCard = StorySummaryCardPayload;

export const STORY_SUMMARY_CARD_CSS = `
/* ═══ 战区本轮纪要与阶段卷宗折叠胶囊 · TACTICAL FIELD LOG CAPSULE ═══ */
.tw-story-summary-card {
  position: relative;
  background-color: var(--tw-theme-bg, var(--rac-bg, #060b14));
  background-image:
    radial-gradient(circle at 95% 15%, color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 12%, transparent), transparent 45%),
    linear-gradient(90deg, color-mix(in srgb, var(--tw-theme-panel, var(--rac-panel-bg, #0f172a)) 92%, #000000) 0%, color-mix(in srgb, var(--tw-theme-bg, var(--rac-bg, #090e19)) 95%, #000000) 100%);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 28%, transparent);
  border-left: 3px solid var(--tw-theme-accent, var(--rac-accent, #38bdf8));
  color: #e2e8f0;
  font-family: 'JetBrains Mono', 'Share Tech Mono', 'Noto Sans SC', 'Microsoft YaHei', monospace;
  font-size: 12px;
  overflow: hidden;
  transition: background-color 180ms ease, border-color 180ms ease;
}
.tw-story-summary-card[data-tier="meso"] {
  border-color: rgba(245, 158, 11, 0.32);
  border-left-color: #f59e0b;
}
.tw-story-summary-card[data-tier="macro"] {
  border-color: rgba(168, 85, 247, 0.38);
  border-left-color: #a855f7;
}
.tw-story-summary-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;
}
.tw-story-summary-header:hover {
  background: color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 10%, rgba(15, 23, 42, 0.45));
}
.tw-story-summary-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.tw-story-summary-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--tw-theme-accent, var(--rac-accent, #38bdf8));
  background: color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 34%, transparent);
}
.tw-story-summary-card[data-tier="meso"] > .tw-story-summary-header .tw-story-summary-badge:not(.is-merged-badge),
.tw-story-summary-badge[data-badge-tier="meso"] {
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.32);
}
.tw-story-summary-card[data-tier="macro"] > .tw-story-summary-header .tw-story-summary-badge:not(.is-merged-badge),
.tw-story-summary-badge[data-badge-tier="macro"] {
  color: #c084fc;
  background: rgba(168, 85, 247, 0.14);
  border-color: rgba(168, 85, 247, 0.36);
}
.tw-story-summary-meta {
  flex-shrink: 0;
  font-size: 10.5px;
  color: #94a3b8;
}
.tw-story-summary-preview {
  color: #cbd5e1;
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}
.tw-story-summary-toggle {
  flex-shrink: 0;
  font-size: 10.5px;
  color: #64748b;
  letter-spacing: 0.04em;
}
.tw-story-summary-body {
  display: none;
  padding: 10px 14px 12px;
  border-top: 1px solid color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 20%, rgba(51, 65, 85, 0.45));
  background: color-mix(in srgb, var(--tw-theme-bg, var(--rac-bg, #060a13)) 90%, #000000);
}
.tw-story-summary-card.is-expanded .tw-story-summary-body {
  display: block;
}
.tw-story-summary-section-title {
  margin: 0 0 6px;
  font-size: 12.5px;
  font-weight: 700;
  color: #f8fafc;
  letter-spacing: 0.03em;
}
.tw-story-summary-prose {
  margin: 0;
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
}
.tw-story-summary-keys {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}
.tw-story-summary-key {
  padding: 1px 6px;
  font-size: 10px;
  color: color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 85%, #ffffff);
  background: color-mix(in srgb, var(--tw-theme-primary, var(--rac-primary, #1e3a8a)) 25%, transparent);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 32%, transparent);
}
.tw-story-summary-extra-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(148, 163, 184, 0.28);
}
.tw-story-summary-extra-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
`;

export function resolveSummaryTierLabel(tier: 'micro' | 'meso' | 'macro'): string {
  if (tier === 'macro') return '战役总纲 · 大摘要';
  if (tier === 'meso') return '阶段卷宗 · 中摘要';
  return '战地纪要 · 小摘要';
}

function formatRangeBadge(rangeStr: string): string {
  const clean = rangeStr.trim().replace(/^#/, '').replace(/\s*楼$/, '');
  if (!clean) return '';
  return `#${clean} 楼`;
}

function normalizeRangeString(rawRange: string | [number, number] | undefined): {
  rangeStr: string;
  span: number;
} {
  if (!rawRange) return { rangeStr: '', span: 0 };
  if (Array.isArray(rawRange)) {
    const [s, e] = rawRange;
    return {
      rangeStr: `${s}-${e}`,
      span: Math.max(0, e - s + 1),
    };
  }
  const cleaned = String(rawRange).trim().replace(/#/g, '').replace(/\s*楼$/g, '');
  const m = cleaned.match(/(\d+)\s*[-~～至到]\s*(\d+)/);
  if (m) {
    const s = Number.parseInt(m[1], 10);
    const e = Number.parseInt(m[2], 10);
    const start = Math.min(s, e);
    const end = Math.max(s, e);
    return {
      rangeStr: `${start}-${end}`,
      span: end - start + 1,
    };
  }
  return { rangeStr: cleaned, span: 0 };
}

interface ParsedSectionInternal {
  tier: 'micro' | 'meso' | 'macro';
  tierLabel: string;
  range: string;
  dateOrRange: string;
  title: string;
  time: string;
  summary: string;
  keywords: string[];
  hasStructuredFields: boolean;
  rawText: string;
}

function parseSingleSummarySection(rawSection: string): ParsedSectionInternal | null {
  const rawTrimmed = (rawSection ?? '').trim();
  if (!rawTrimmed) return null;

  let explicitTier: 'micro' | 'meso' | 'macro' | undefined;
  let working = rawTrimmed;
  let openAttrs: Record<string, string> = {};

  // 1. 若带有外层 <摘要>/<summary>/<中摘要 ...>/<大摘要 ...> 包裹标签，提取标签名与属性
  const wrapperMatch = working.match(
    /^<((?:摘要|summary|中摘要|大摘要))(\s+[^>]*)?>([\s\S]*?)<\/\1>$/i,
  );
  if (wrapperMatch) {
    const tagName = wrapperMatch[1];
    const openTagFull = `<${tagName}${wrapperMatch[2] ?? ''}>`;
    openAttrs = parseOpenTagAttributes(openTagFull);
    if (tagName === '大摘要') explicitTier = 'macro';
    else if (tagName === '中摘要') explicitTier = 'meso';
    else explicitTier = 'micro';
    working = wrapperMatch[3].trim();
  }

  // 2. 检测头部方括号标记 [MACRO] / [MESO] / [大摘要] / [中摘要] / [小摘要]
  if (/^\[(?:MACRO|大摘要)\]/i.test(working)) {
    explicitTier = 'macro';
    working = working.replace(/^\[(?:MACRO|大摘要)\]\s*/i, '');
  } else if (/^\[(?:MESO|中摘要)\]/i.test(working)) {
    explicitTier = 'meso';
    working = working.replace(/^\[(?:MESO|中摘要)\]\s*/i, '');
  } else if (/^\[(?:MICRO|小摘要|摘要)\]/i.test(working)) {
    explicitTier = 'micro';
    working = working.replace(/^\[(?:MICRO|小摘要|摘要)\]\s*/i, '');
  }

  // 3. 扫描键值行中的 阶次/层级/tier 与 范围/标题（补充 parseSummaryInnerContent 未覆盖的别名）
  let extraRangeRaw =
    openAttrs['范围'] ?? openAttrs['楼层范围'] ?? openAttrs['区间'] ?? openAttrs['range'] ?? '';
  let extraTitleRaw =
    openAttrs['标题'] ?? openAttrs['阶段标题'] ?? openAttrs['总纲标题'] ?? openAttrs['title'] ?? '';
  let extraTimeRaw = openAttrs['时间'] ?? openAttrs['日期'] ?? openAttrs['time'] ?? '';
  let hasStructured = Object.keys(openAttrs).length > 0;

  const cleanedLines: string[] = [];
  for (const line of working.split(/\r?\n/)) {
    const tierMatch = line.match(/^\s*(?:-\s*)?(?:阶次|层级|tier)\s*[:：]\s*(.+)$/i);
    if (tierMatch) {
      hasStructured = true;
      const val = tierMatch[1].trim().toLowerCase();
      if (val === '大摘要' || val === 'macro') explicitTier = 'macro';
      else if (val === '中摘要' || val === 'meso') explicitTier = 'meso';
      else if (val === '小摘要' || val === '摘要' || val === 'micro') explicitTier = 'micro';
      continue;
    }
    const rangeAliasMatch = line.match(/^\s*(?:-\s*)?(?:范围|楼层范围|区间|range)\s*[:：]\s*(.+)$/i);
    if (rangeAliasMatch && !extraRangeRaw) {
      extraRangeRaw = rangeAliasMatch[1].trim().replace(/^['"]|['"]$/g, '');
      hasStructured = true;
    }
    const titleAliasMatch = line.match(/^\s*(?:-\s*)?(?:标题|阶段标题|总纲标题|title)\s*[:：]\s*(.+)$/i);
    if (titleAliasMatch && !extraTitleRaw) {
      extraTitleRaw = titleAliasMatch[1].trim().replace(/^['"]|['"]$/g, '');
      hasStructured = true;
    }
    cleanedLines.push(line);
  }
  const bodyForInner = cleanedLines.join('\n').trim();

  const inner = parseSummaryInnerContent(bodyForInner);
  if (
    inner.date ||
    inner.title ||
    inner.range ||
    inner.keys.length > 0 ||
    /^\s*(?:-\s*)?(?:时间|日期|time|date|范围|楼层范围|区间|range|标题|阶段标题|总纲标题|title|内容|综述|正文|摘要|纪要|content|summary|关键词|标签|keywords|tags)\s*[:：]/im.test(
      bodyForInner,
    )
  ) {
    hasStructured = true;
  }

  const { rangeStr, span } = normalizeRangeString(inner.range ?? (extraRangeRaw || undefined));
  const title = (inner.title || extraTitleRaw || '').trim();
  const time = (inner.date || extraTimeRaw || '').trim();
  const summaryText = (inner.text || bodyForInner || '').trim();
  if (!summaryText && !title) return null;

  let tier: 'micro' | 'meso' | 'macro' = explicitTier ?? 'micro';
  if (!explicitTier) {
    if (rangeStr || title) {
      if (/总纲|大摘要/.test(title) || span > 30) {
        tier = 'macro';
      } else {
        tier = 'meso';
      }
    }
  }

  const tierLabel = resolveSummaryTierLabel(tier);
  const dateOrRange = rangeStr ? formatRangeBadge(rangeStr) : time;

  return {
    tier,
    tierLabel,
    range: rangeStr,
    dateOrRange,
    title,
    time,
    summary: summaryText || title,
    keywords: inner.keys,
    hasStructuredFields: hasStructured,
    rawText: rawTrimmed,
  };
}

/**
 * 将可能包含多段摘要（如同楼既有 <摘要> 又有 <中摘要>/<大摘要>）的原始文本拆分为有序段落数组。
 */
function splitCombinedSummarySections(raw: string): string[] {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return [];

  // 情况 1：显式包含多个 <摘要>/<summary>/<中摘要>/<大摘要> 标签块
  const tagBlockRe =
    /<(摘要|summary|中摘要|大摘要)(?:\s+[^>]*)?>[\s\S]*?<\/(?:摘要|summary|中摘要|大摘要)>/gi;
  const tagMatches = trimmed.match(tagBlockRe);
  if (tagMatches && tagMatches.length > 1) {
    return tagMatches.map(s => s.trim()).filter(Boolean);
  }

  // 情况 2：无外层标签，但由空行分隔的多块结构化摘要（例如小摘要 + 中/大摘要通过 \n\n 拼接）
  const chunks = trimmed.split(/\r?\n\s*\r?\n/).map(c => c.trim()).filter(Boolean);
  if (chunks.length <= 1) return [trimmed];

  const isSectionHeaderChunk = (chunk: string): boolean =>
    /^\[(?:MACRO|MESO|MICRO|大摘要|中摘要|小摘要|摘要)\]/i.test(chunk) ||
    /^\s*(?:-\s*)?(?:阶次|层级|tier|范围|楼层范围|区间|range|阶段标题|总纲标题)\s*[:：]/im.test(
      chunk,
    ) ||
    (/^\s*(?:-\s*)?(?:标题|title)\s*[:：]/im.test(chunk) &&
      /^\s*(?:-\s*)?(?:内容|综述|正文|摘要|纪要|content|summary)\s*[:：]/im.test(chunk)) ||
    (/^\s*(?:-\s*)?(?:时间|日期|time|date)\s*[:：]/im.test(chunk) &&
      /^\s*(?:-\s*)?(?:纪要|摘要|内容|正文|summary|content)\s*[:：]/im.test(chunk));

  // 只有当后续 chunk 明确是另一个结构化摘要块开头时才拆分，避免把同一摘要的多段纯文本误拆
  const sections: string[] = [];
  let current: string[] = [chunks[0]];
  let currentHasStruct = isSectionHeaderChunk(chunks[0]);

  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (currentHasStruct && isSectionHeaderChunk(chunk)) {
      sections.push(current.join('\n\n'));
      current = [chunk];
      currentHasStruct = true;
    } else {
      current.push(chunk);
      if (isSectionHeaderChunk(chunk)) currentHasStruct = true;
    }
  }
  if (current.length > 0) {
    sections.push(current.join('\n\n'));
  }

  return sections;
}

export function parseStorySummaryCardPayload(raw: string): StorySummaryCardPayload {
  const rawStr = typeof raw === 'string' ? raw : '';
  const trimmed = rawStr.trim();
  if (!trimmed) {
    return {
      tier: 'micro',
      tierLabel: resolveSummaryTierLabel('micro'),
      dateOrRange: '',
      range: '',
      title: '',
      time: '',
      summary: '',
      text: '',
      keywords: [],
      keys: [],
      compactPreview: '',
      rawText: '',
      hasStructuredFields: false,
    };
  }

  const rawSections = splitCombinedSummarySections(trimmed);
  const parsedSections = rawSections
    .map(sec => parseSingleSummarySection(sec))
    .filter((s): s is ParsedSectionInternal => s !== null);

  if (parsedSections.length === 0) {
    return {
      tier: 'micro',
      tierLabel: resolveSummaryTierLabel('micro'),
      dateOrRange: '',
      range: '',
      title: '',
      time: '',
      summary: '',
      text: '',
      keywords: [],
      keys: [],
      compactPreview: '',
      rawText: trimmed,
      hasStructuredFields: false,
    };
  }

  const primary = parsedSections[0];
  const singleLine = primary.summary.replace(/\s+/g, ' ').trim();
  const compactPreview = singleLine.length > 56 ? `${singleLine.slice(0, 56)}…` : singleLine;

  const extraSections: StorySummaryExtraSection[] | undefined =
    parsedSections.length > 1
      ? parsedSections.slice(1).map(sec => ({
          tier: sec.tier,
          tierLabel: sec.tierLabel,
          title: sec.title,
          range: sec.range,
          time: sec.time,
          summary: sec.summary,
          keywords: sec.keywords,
        }))
      : undefined;

  return {
    tier: primary.tier,
    tierLabel: primary.tierLabel,
    dateOrRange: primary.dateOrRange,
    ...(primary.range ? { range: primary.range } : {}),
    title: primary.title,
    time: primary.time,
    summary: primary.summary,
    text: primary.summary,
    keywords: primary.keywords,
    keys: primary.keywords,
    compactPreview,
    rawText: trimmed,
    hasStructuredFields: parsedSections.some(s => s.hasStructuredFields),
    ...(extraSections ? { extraSections } : {}),
  };
}

export function parseStorySummaryPayload(rawPayload: string): ParsedStorySummaryCard | null {
  const trimmed = (rawPayload ?? '').trim();
  if (!trimmed) return null;
  const parsed = parseStorySummaryCardPayload(trimmed);
  if (!parsed.summary.trim() && !parsed.title.trim()) return null;
  return parsed;
}

function appendKeywordsBlock(doc: Document, container: HTMLElement, keywords: string[]): void {
  if (!Array.isArray(keywords) || keywords.length === 0) return;
  const keysWrap = doc.createElement('div');
  keysWrap.className = 'tw-story-summary-keys';
  for (const k of keywords) {
    const chip = doc.createElement('span');
    chip.className = 'tw-story-summary-key';
    chip.textContent = k.startsWith('#') ? k : `#${k}`;
    keysWrap.appendChild(chip);
  }
  container.appendChild(keysWrap);
}

export function buildStorySummaryCardDom(
  doc: Document,
  data: StorySummaryCardPayload | ParsedStorySummaryCard,
  onHeightChange?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-story-summary-card-style', STORY_SUMMARY_CARD_CSS);

  const tier = data.tier ?? 'micro';
  const tierLabel = data.tierLabel || resolveSummaryTierLabel(tier);
  const summaryText = data.summary ?? data.text ?? '';
  const keywords = data.keywords ?? data.keys ?? [];
  const rangeBadge = data.range
    ? formatRangeBadge(data.range)
    : data.dateOrRange || data.time || '';
  const singleLine = summaryText.replace(/\s+/g, ' ').trim();
  const compactPreview =
    data.compactPreview ?? (singleLine.length > 56 ? `${singleLine.slice(0, 56)}…` : singleLine);

  const root = doc.createElement('section');
  root.className = 'tw-story-summary-card';
  root.setAttribute('data-test', 'story-summary-card');
  root.setAttribute('data-tier', tier);

  const header = doc.createElement('div');
  header.className = 'tw-story-summary-header';
  header.setAttribute('data-test', 'story-summary-toggle');

  const left = doc.createElement('div');
  left.className = 'tw-story-summary-left';

  const badge = doc.createElement('span');
  badge.className = 'tw-story-summary-badge';
  badge.setAttribute('data-badge-tier', tier);
  badge.textContent = tierLabel;
  left.appendChild(badge);

  if (rangeBadge) {
    const meta = doc.createElement('span');
    meta.className = 'tw-story-summary-meta';
    meta.textContent = rangeBadge;
    left.appendChild(meta);
  }

  // 若存在同楼合署的中/大摘要，在头部折叠栏附加合署卷宗徽章
  if (Array.isArray(data.extraSections) && data.extraSections.length > 0) {
    for (const sec of data.extraSections) {
      const mergedBadge = doc.createElement('span');
      mergedBadge.className = 'tw-story-summary-badge is-merged-badge';
      mergedBadge.setAttribute('data-badge-tier', sec.tier);
      const secLabel = sec.tierLabel || resolveSummaryTierLabel(sec.tier);
      const secRange = sec.range ? ` ${formatRangeBadge(sec.range)}` : '';
      mergedBadge.textContent = `+ ${secLabel}${secRange}`;
      left.appendChild(mergedBadge);
    }
  }

  const preview = doc.createElement('span');
  preview.className = 'tw-story-summary-preview';
  preview.textContent = data.title ? `【${data.title}】${compactPreview}` : compactPreview;
  left.appendChild(preview);

  const toggle = doc.createElement('span');
  toggle.className = 'tw-story-summary-toggle';
  toggle.textContent = '展开纪要 ▾';

  header.appendChild(left);
  header.appendChild(toggle);

  const body = doc.createElement('div');
  body.className = 'tw-story-summary-body';

  if (data.title) {
    const titleEl = doc.createElement('div');
    titleEl.className = 'tw-story-summary-section-title';
    titleEl.setAttribute('data-test', 'story-summary-title');
    titleEl.textContent = data.title;
    body.appendChild(titleEl);
  }

  const prose = doc.createElement('p');
  prose.className = 'tw-story-summary-prose';
  prose.textContent = summaryText;
  body.appendChild(prose);

  appendKeywordsBlock(doc, body, keywords);

  // 渲染同楼合署的附加摘要分区（如中摘要 / 大摘要卷宗）
  if (Array.isArray(data.extraSections) && data.extraSections.length > 0) {
    for (const sec of data.extraSections) {
      const secWrap = doc.createElement('div');
      secWrap.className = 'tw-story-summary-extra-section';
      secWrap.setAttribute('data-test', 'story-summary-extra-section');
      secWrap.setAttribute('data-tier', sec.tier);

      const secHeader = doc.createElement('div');
      secHeader.className = 'tw-story-summary-extra-header';

      const secBadge = doc.createElement('span');
      secBadge.className = 'tw-story-summary-badge';
      secBadge.setAttribute('data-badge-tier', sec.tier);
      secBadge.textContent = sec.tierLabel || resolveSummaryTierLabel(sec.tier);
      secHeader.appendChild(secBadge);

      const secMetaText = sec.range ? formatRangeBadge(sec.range) : sec.time;
      if (secMetaText) {
        const secMeta = doc.createElement('span');
        secMeta.className = 'tw-story-summary-meta';
        secMeta.textContent = secMetaText;
        secHeader.appendChild(secMeta);
      }

      secWrap.appendChild(secHeader);

      if (sec.title) {
        const secTitle = doc.createElement('div');
        secTitle.className = 'tw-story-summary-section-title';
        secTitle.textContent = sec.title;
        secWrap.appendChild(secTitle);
      }

      const secProse = doc.createElement('p');
      secProse.className = 'tw-story-summary-prose';
      secProse.textContent = sec.summary;
      secWrap.appendChild(secProse);

      appendKeywordsBlock(doc, secWrap, sec.keywords);

      body.appendChild(secWrap);
    }
  }

  header.addEventListener('click', () => {
    const expanded = root.classList.toggle('is-expanded');
    toggle.textContent = expanded ? '收起 ▴' : '展开纪要 ▾';
    onHeightChange?.();
  });

  root.appendChild(header);
  root.appendChild(body);
  return root;
}
