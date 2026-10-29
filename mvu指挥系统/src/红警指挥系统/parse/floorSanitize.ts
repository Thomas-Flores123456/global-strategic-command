/**
 * floorSanitize.ts —— 楼层原文 L0 清洗（CTRL-PARSE-L0-01）
 *
 * 解析管线与 <timePast> 读取共用的纯函数层，只做「哪些区域不参与业务提取」的判定：
 * 1. stripThinking：剥离思考容器（think / thinking / reasoning / thought(s) / 思考 / 思考过程 / 思维链）。
 *    - 开标签只有在行首（允许前导空白）或紧跟另一个标签的 > 之后才算容器开头，句中提到的不算；
 *    - 容器内的任何闭标签都能结束容器；容器内再次提到开标签不算嵌套；
 *    - 残缺：只有闭标签、没有开头（宿主截掉了前缀）时，删掉该闭标签及之前全部内容；
 *      若闭标签之后已无任何内容，视为尾部垃圾，不删；
 *    - 未闭合：截到其后第一个行首 <正文>；没有 <正文> 则截到文末（fail-closed，由调用方记 🟡）。
 * 2. maskBody：屏蔽 <正文> 容器内部，战报块只在正文之外提取；
 *    未闭合的 <正文> 只延伸到下一个行首业务标签，不吞掉其后的战报。
 * 被删区域一律替换为单个换行，保证其后的标签落在行首。
 */

/** 通用标签扫描（与 parsePipeline.scanMarkers 同一容忍度：全角括号 / 属性垃圾 / 大小写） */
const TAG_RE = /[<\uFF1C]\s*(\/)?\s*([^<>\uFF1C\uFF1E\r\n]*?)\s*[>\uFF1E]/g;

/** 思考容器名（小写比较） */
export const THINK_TAGS = ['think', 'thinking', 'reasoning', 'thought', 'thoughts', '思考', '思考过程', '思维链'];
const THINK_SET = new Set(THINK_TAGS);

/** 正文容器名 */
const BODY_TAG = '正文';

export interface TagToken {
  index: number;
  end: number;
  isClose: boolean;
  /** 首个 token，小写 */
  name: string;
}

export interface SanitizeNote {
  kind: 'think-stripped' | 'think-orphan-close' | 'think-unclosed' | 'body-masked' | 'body-unclosed';
  /** 删除的字符数 */
  removed: number;
}

export interface SanitizeResult {
  /** 仅剥离思考容器后的文本（<timePast> 等全楼元信息在此读取） */
  thinkFree: string;
  /** 再屏蔽 <正文> 后的文本（战报块只在此提取） */
  business: string;
  notes: SanitizeNote[];
}

export function scanTags(text: string): TagToken[] {
  const out: TagToken[] = [];
  const re = new RegExp(TAG_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = (m[2].split(/[\s|=/]+/).filter(Boolean)[0] ?? '').toLowerCase();
    out.push({ index: m.index, end: re.lastIndex, isClose: !!m[1], name });
  }
  return out;
}

function isInlineSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\u3000';
}

/**
 * 行首判定：向前跳过空白后，是文首 / 换行 / 另一个标签的 >；
 * 也接受紧贴在行首代码围栏（至少三个反引号）之后的写法。
 */
export function atLineStart(text: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && isInlineSpace(text[i])) i--;
  if (i < 0) return true;
  const c = text[i];
  if (c === '\n' || c === '\r' || c === '>' || c === '\uFF1E') return true;
  if (c !== '`') return false;
  let ticks = 0;
  while (i >= 0 && text[i] === '`') {
    ticks++;
    i--;
  }
  if (ticks < 3) return false;
  while (i >= 0 && isInlineSpace(text[i])) i--;
  return i < 0 || text[i] === '\n' || text[i] === '\r';
}

/** 严格行尾：向后跳过空白后，是文末 / 换行（「句子。<战况>⏎」这类黏连开标签的容忍依据） */
export function endsLine(text: string, end: number): boolean {
  let i = end;
  while (i < text.length && isInlineSpace(text[i])) i++;
  return i >= text.length || text[i] === '\n' || text[i] === '\r';
}

/** 行尾判定：向后跳过空白后，是文末 / 换行 / 另一个标签的 < */
function atLineEnd(text: string, end: number): boolean {
  let i = end;
  while (i < text.length && isInlineSpace(text[i])) i++;
  if (i >= text.length) return true;
  const c = text[i];
  return c === '\n' || c === '\r' || c === '<' || c === '\uFF1C';
}

/** 按区间删除，每段替换为单个换行 */
function applyCuts(text: string, cuts: Array<[number, number]>, preserveOffsets = false): string {
  if (!cuts.length) return text;
  let out = '';
  let pos = 0;
  for (const [s, e] of cuts) {
    out += text.slice(pos, s) + (preserveOffsets ? text.slice(s, e).replace(/[^\r\n]/g, ' ') : '\n');
    pos = e;
  }
  return out + text.slice(pos);
}

/** 剥离思考容器 */
export function stripThinking(raw: string, preserveOffsets = false): { text: string; notes: SanitizeNote[] } {
  const text = typeof raw === 'string' ? raw : '';
  const all = scanTags(text);
  const tags = all.filter(t => THINK_SET.has(t.name));
  const cuts: Array<[number, number]> = [];
  const notes: SanitizeNote[] = [];
  let openAt = -1;
  let seenContainer = false;
  for (const t of tags) {
    if (openAt >= 0) {
      if (t.isClose) {
        cuts.push([openAt, t.end]);
        notes.push({ kind: 'think-stripped', removed: t.end - openAt });
        openAt = -1;
      }
      continue;
    }
    if (!t.isClose) {
      if (atLineStart(text, t.index)) {
        openAt = t.index;
        seenContainer = true;
      }
      continue;
    }
    // 容器外的闭标签：仅第一处、且在任何容器之前时按「残缺前缀」处理
    if (seenContainer) continue;
    seenContainer = true;
    const standalone = atLineStart(text, t.index) || atLineEnd(text, t.end);
    const hasTail = text.slice(t.end).trim().length > 0;
    if (standalone && hasTail) {
      const hasBodyBefore = all.some(token => token.index < t.index && !token.isClose && token.name === BODY_TAG);
      const start = hasBodyBefore ? t.index : 0;
      cuts.push([start, t.end]);
      notes.push({ kind: 'think-orphan-close', removed: t.end - start });
    }
  }
  if (openAt >= 0) {
    const body = all.find(t => t.index > openAt && !t.isClose && t.name === BODY_TAG && atLineStart(text, t.index));
    const end = body ? body.index : text.length;
    cuts.push([openAt, end]);
    notes.push({ kind: 'think-unclosed', removed: end - openAt });
  }
  return {
    text: applyCuts(text, cuts, preserveOffsets).replace(
      /<[\s/]*(?:interleaving|suot|content)\b[^>]*>|<disclaimer\b[^>]*>[\s\S]*?<\/disclaimer>/gi,
      match => (preserveOffsets ? match.replace(/[^\r\n]/g, ' ') : '\n'),
    ),
    notes,
  };
}

/** 屏蔽 <正文> 容器；isBusinessTag 判定某标签名是否为业务块（由调用方按词表注入） */
export function maskBody(
  text: string,
  isBusinessTag: (name: string) => boolean,
): { text: string; notes: SanitizeNote[] } {
  const tags = scanTags(text);
  const cuts: Array<[number, number]> = [];
  const notes: SanitizeNote[] = [];
  let i = 0;
  while (i < tags.length) {
    const t = tags[i];
    if (t.isClose || t.name !== BODY_TAG || !atLineStart(text, t.index)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < tags.length && !(tags[j].isClose && tags[j].name === BODY_TAG)) j++;
    if (j < tags.length) {
      cuts.push([t.index, tags[j].end]);
      notes.push({ kind: 'body-masked', removed: tags[j].end - t.index });
      i = j + 1;
      continue;
    }
    let k = i + 1;
    while (k < tags.length && !(!tags[k].isClose && isBusinessTag(tags[k].name) && atLineStart(text, tags[k].index)))
      k++;
    const end = k < tags.length ? tags[k].index : text.length;
    cuts.push([t.index, end]);
    notes.push({ kind: 'body-unclosed', removed: end - t.index });
    i = k;
  }
  return { text: applyCuts(text, cuts), notes };
}

/** L0 统一清洗入口 */
export function sanitizeFloorText(raw: string, isBusinessTag: (name: string) => boolean): SanitizeResult {
  const think = stripThinking(raw);
  const body = maskBody(think.text, isBusinessTag);
  return { thinkFree: think.text, business: body.text, notes: [...think.notes, ...body.notes] };
}
