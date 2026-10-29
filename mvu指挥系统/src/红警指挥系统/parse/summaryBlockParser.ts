/**
 * summaryBlockParser.ts —— 楼层三层摘要标签解析器（<摘要> / <summary> / <中摘要> / <大摘要>）
 *
 * 职责：
 * 1. 从剥离思考容器后的楼层原文中提取：
 *    - 【小摘要（Micro）】：`<摘要>...</摘要>` 或 `<summary>...</summary>`（兼容 YAML 键值与纯散文两种写法）；
 *    - 【委托中摘要（Meso）】：`<中摘要>...</中摘要>`（方案 C 委托主 LLM 顺带输出）；
 *    - 【委托大摘要（Macro）】：`<大摘要>...</大摘要>`（方案 C 委托主 LLM 顺带输出）。
 * 2. 提供 `stripSummaryBlocks` 在进入战报 YAML 块扫描前剥离摘要标签，避免污染 `<战况>`。
 */

import { indexFloorProtocols } from './floorProtocolIndex';

export interface ParsedMicroSummaryPayload {
  date: string;
  text: string;
  keys: string[];
  tag: '摘要' | 'summary';
  raw: string;
}

export interface ParsedDelegatedSummaryPayload {
  tier: 'meso' | 'macro';
  from: number;
  to: number;
  title?: string;
  text: string;
  keys: string[];
  raw: string;
}

export interface ParsedFloorSummaries {
  micro: ParsedMicroSummaryPayload | null;
  delegatedDrafts: ParsedDelegatedSummaryPayload[];
}


/** 拆分关键词列表（兼容 `[a, b]`、`a、b，c` 等格式） */
export function parseSummaryKeysList(rawKeys: string): string[] {
  const cleaned = rawKeys
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .trim();
  if (!cleaned) return [];
  return [
    ...new Set(
      cleaned
        .split(/[,，、;；|/\s]+/)
        .map(s => s.trim().replace(/^['"「『]|['"」』]$/g, ''))
        .filter(Boolean),
    ),
  ];
}

/** 解析内部文本（兼容结构化行 `时间/纪要/关键词` 与自由散文 + `【实体：...】`） */
export function parseSummaryInnerContent(inner: string): {
  date: string;
  title: string;
  range: [number, number] | null;
  text: string;
  keys: string[];
} {
  let working = inner.trim();
  let date = '';
  let title = '';
  let range: [number, number] | null = null;
  let keys: string[] = [];

  // 1. 提取末尾或文中的 【实体：...】 / 【关键词：...】
  const bracketEntityRe = /【(?:实体|关键词|关联)[：:]\s*([^】]+)】/g;
  let bm: RegExpExecArray | null;
  while ((bm = bracketEntityRe.exec(working)) !== null) {
    keys.push(...parseSummaryKeysList(bm[1]));
  }
  working = working.replace(bracketEntityRe, '').trim();

  // 2. 按行扫描结构化字段
  const lines = working.split(/\r?\n/);
  const proseLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 区间: 1-20 / 楼层: 001-020 / 范围: #1-#20
    const rangeMatch = /^(?:-\s*)?(?:区间|楼层|范围|range)\s*[：:]\s*#?0*(\d+)\s*[-~～至到]\s*#?0*(\d+)\s*$/i.exec(line);
    if (rangeMatch) {
      const f = Number(rangeMatch[1]);
      const t = Number(rangeMatch[2]);
      if (Number.isFinite(f) && Number.isFinite(t) && f <= t) {
        range = [f, t];
      }
      continue;
    }

    // 时间 / 日期
    const dateMatch = /^(?:-\s*)?(?:时间|日期|战区时间|date|time)\s*[：:]\s*(.+)$/i.exec(line);
    if (dateMatch && !date) {
      date = dateMatch[1].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }

    // 标题 / 卷名
    const titleMatch = /^(?:-\s*)?(?:标题|章节|卷宗|title)\s*[：:]\s*(.+)$/i.exec(line);
    if (titleMatch && !title) {
      title = titleMatch[1].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }

    // 关键词 / 实体 / keys
    const keysMatch = /^(?:-\s*)?(?:关键词|实体|关联实体|标签|keys|tags)\s*[：:]\s*(.+)$/i.exec(line);
    if (keysMatch) {
      keys.push(...parseSummaryKeysList(keysMatch[1]));
      continue;
    }

    // 纪要 / 摘要 / 内容 / 正文
    const summaryLineMatch = /^(?:-\s*)?(?:纪要|摘要|内容|正文|事件|summary|text)\s*[：:]\s*(.*)$/i.exec(line);
    if (summaryLineMatch) {
      const val = summaryLineMatch[1].trim();
      if (val && val !== '|' && val !== '>') {
        proseLines.push(val.replace(/^['"]|['"]$/g, ''));
      }
      continue;
    }

    proseLines.push(line);
  }

  keys = [...new Set(keys)];
  const text = proseLines.join('\n').trim();
  return { date, title, range, text, keys };
}

/** 从开标签属性或正文中提取楼层区间（如 `区间="1-20"`、`范围="1-40"` 或 `from="1" to="20"`） */
function parseRangeFromAttrOrBody(
  attrStr: string,
  bodyRange: [number, number] | null,
): [number, number] | null {
  if (bodyRange) return bodyRange;
  const attrRangeMatch =
    /(?:区间|楼层|范围|range|floors?)\s*=\s*["']?#?0*(\d+)\s*[-~～至到]\s*#?0*(\d+)["']?/i.exec(attrStr);
  if (attrRangeMatch) {
    const f = Number(attrRangeMatch[1]);
    const t = Number(attrRangeMatch[2]);
    if (Number.isFinite(f) && Number.isFinite(t) && f <= t) return [f, t];
  }
  const fromMatch = /\bfrom\s*=\s*["']?0*(\d+)["']?/i.exec(attrStr);
  const toMatch = /\bto\s*=\s*["']?0*(\d+)["']?/i.exec(attrStr);
  if (fromMatch && toMatch) {
    const f = Number(fromMatch[1]);
    const t = Number(toMatch[2]);
    if (Number.isFinite(f) && Number.isFinite(t) && f <= t) return [f, t];
  }
  return null;
}

/** 从开标签属性或正文中提取标题（如 `标题="恶土扎根与双阵营并网阶段纪要"` 或 `title="..."`） */
function parseTitleFromAttrOrBody(attrStr: string, bodyTitle: string): string {
  if (bodyTitle) return bodyTitle;
  const attrTitleMatch = /(?:标题|章节|卷宗|title)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'\uFF1E]+))/i.exec(attrStr);
  return (attrTitleMatch?.[1] ?? attrTitleMatch?.[2] ?? attrTitleMatch?.[3] ?? '').trim();
}

/**
 * 提取单楼中的 `<摘要>`/`<summary>` 与 `<中摘要>`/`<大摘要>`。
 * 先经 `stripThinking` 剥离思考容器，防止思维链中的草稿伪标签被误提。
 */
export function extractFloorSummaries(raw: string): ParsedFloorSummaries {
  if (!raw || typeof raw !== 'string') {
    return { micro: null, delegatedDrafts: [] };
  }
  const blocks = indexFloorProtocols(raw).filter(block => block.status === 'valid');

  let micro: ParsedMicroSummaryPayload | null = null;
  for (const block of blocks.filter(b => b.tag === '摘要' || b.tag === 'summary')) {
    const tagRaw = block.tag === 'summary' ? 'summary' : '摘要';
    const inner = block.payload;
    if (!inner) continue;
    const parsed = parseSummaryInnerContent(inner);
    if (!parsed.text) continue;
    // 若同一楼既有 <summary> 又有 <摘要>，优先保留显式 <摘要> 或后出现者
    if (!micro || tagRaw === '摘要' || micro.tag !== '摘要') {
      micro = {
        date: parsed.date,
        text: parsed.text,
        keys: parsed.keys,
        tag: tagRaw,
        raw: inner,
      };
    }
  }

  const delegatedDrafts: ParsedDelegatedSummaryPayload[] = [];
  for (const block of blocks.filter(b => b.tag === '中摘要' || b.tag === '大摘要')) {
    const tagName = block.tag;
    const attrStr = block.openTag;
    const inner = block.payload;
    if (!inner) continue;
    const parsed = parseSummaryInnerContent(inner);
    if (!parsed.text) continue;
    const range = parseRangeFromAttrOrBody(attrStr, parsed.range);
    const title = parseTitleFromAttrOrBody(attrStr, parsed.title);
    const [from, to] = range ?? [1, 1];
    delegatedDrafts.push({
      tier: tagName === '大摘要' ? 'macro' : 'meso',
      from,
      to,
      ...(title ? { title } : {}),
      text: parsed.text,
      keys: parsed.keys,
      raw: inner,
    });
  }

  return { micro, delegatedDrafts };
}

/**
 * 剥离 `<摘要>` / `<summary>` / `<中摘要>` / `<大摘要>` 块，供 `parsePipeline` 块扫描前清洗。
 */
export function stripSummaryBlocks(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const blocks = indexFloorProtocols(raw).filter(b => b.status === 'valid'
    && ['摘要', 'summary', '中摘要', '大摘要'].includes(b.tag));
  let result = raw;
  for (const block of blocks.reverse()) {
    result = result.slice(0, block.start) + '\n' + result.slice(block.end);
  }
  return result;
}
