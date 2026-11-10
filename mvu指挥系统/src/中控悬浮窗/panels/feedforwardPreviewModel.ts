/**
 * feedforwardPreviewModel.ts —— 把 formatStrategicFeedforwardPrompt 的纯文本报文切成可分区渲染的结构。
 *
 * 只做"形态识别"，不改一个字：标题 / 元信息 / 【分区】 / · 条目 / - 子项 / ※ 注记 / N. [P0·标签] 诊断。
 * 原文 = 各行按原顺序拼回；任何识别不出的行都按 text 保留，保证预览不丢内容。
 */

export type PreviewLineKind = 'item' | 'sub' | 'note' | 'diag' | 'text';

export interface PreviewLine {
  kind: PreviewLineKind;
  text: string;
  /** diag 专用：P0/P1/P2/P3 */
  priority?: string;
  /** diag 专用：方括号内的领域标签 */
  label?: string;
  /** diag 专用：「 —— 诊断：」之后的说明 */
  detail?: string;
}

export interface PreviewSection {
  /** 中文序号（一、二…）；无序号的分区为空串 */
  index: string;
  title: string;
  /** 紧跟在 】 后同一行的正文 */
  lead: string;
  lines: PreviewLine[];
}

export interface PreviewDoc {
  title: string;
  /** 分区之前的元信息行（已去掉前导 · ） */
  meta: string[];
  sections: PreviewSection[];
}

const SECTION_RE = /^【(.+?)】(.*)$/;
const INDEX_RE = /^([一二三四五六七八九十]+)、(.*)$/;
const DIAG_RE = /^\d+\.\s*\[(P\d)·([^\]]+)\]\s*(.*)$/;
const DIAG_SPLIT = ' —— 诊断：';

/** 竖线分隔符按段切开，供模板给 ｜ 加视觉间距；保持内容逐字不变 */
export function splitPipeSegments(text: string): string[] {
  return text.split('｜');
}

export function parseFeedforwardPreview(text: string): PreviewDoc {
  const doc: PreviewDoc = { title: '', meta: [], sections: [] };
  const rawLines = String(text ?? '').split('\n');
  let current: PreviewSection | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (!raw.trim()) continue;

    if (i === 0 && /^\[.+\]$/.test(raw.trim())) {
      doc.title = raw.trim().slice(1, -1);
      continue;
    }

    const sec = raw.match(SECTION_RE);
    if (sec) {
      const idx = sec[1].match(INDEX_RE);
      current = {
        index: idx ? idx[1] : '',
        title: idx ? idx[2] : sec[1],
        lead: sec[2].trim(),
        lines: [],
      };
      doc.sections.push(current);
      continue;
    }

    if (!current) {
      doc.meta.push(raw.replace(/^·\s*/, '').trim());
      continue;
    }

    const trimmed = raw.trim();
    const diag = trimmed.match(DIAG_RE);
    if (diag) {
      const [headline, ...rest] = diag[3].split(DIAG_SPLIT);
      current.lines.push({
        kind: 'diag',
        priority: diag[1],
        label: diag[2],
        text: headline.trim(),
        detail: rest.length ? rest.join(DIAG_SPLIT).trim() : undefined,
      });
      continue;
    }
    if (/^\s+-\s/.test(raw)) {
      current.lines.push({ kind: 'sub', text: trimmed.replace(/^-\s*/, '') });
      continue;
    }
    if (trimmed.startsWith('※')) {
      current.lines.push({ kind: 'note', text: trimmed.replace(/^※\s*/, '') });
      continue;
    }
    if (trimmed.startsWith('·')) {
      current.lines.push({ kind: 'item', text: trimmed.replace(/^·\s*/, '') });
      continue;
    }
    current.lines.push({ kind: 'text', text: trimmed });
  }

  return doc;
}
