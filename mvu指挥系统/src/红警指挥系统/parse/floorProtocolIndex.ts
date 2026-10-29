import { atLineStart, scanTags, stripThinking, THINK_TAGS } from './floorSanitize';

export type FloorProtocolCardType =
  | 'faction-unlock'
  | 'aerospace-contract'
  | 'maiden-dossier'
  | 'maiden-status'
  | 'codex-entry'
  | 'tactical-event'
  | 'engineering-order'
  | 'production-schedule'
  | 'expansion-dossier'
  | 'intel-dossier'
  | 'data-patch'
  | 'chrono-step'
  | 'darknet-terminal'
  | 'story-summary'
  | 'tactical-situation'
  | 'tactical-options'
  | 'tactical-quest'
  | 'tactical-intel'
  | 'world-evolution-stealth'
  | 'deployment-order'
  | 'economy-chains';

export const TAG_TO_CARD_TYPE: Record<string, FloorProtocolCardType> = {
  摘要: 'story-summary',
  summary: 'story-summary',
  中摘要: 'story-summary',
  大摘要: 'story-summary',
  timepast: 'chrono-step',
  timePast: 'chrono-step',
  态势: 'tactical-situation',
  初始状态: 'tactical-situation',
  战况: 'tactical-situation',
  战区态势: 'tactical-situation',
  环境态势: 'tactical-situation',
  环境: 'tactical-situation',
  事件: 'tactical-event',
  阵营解锁: 'faction-unlock',
  阵营启封: 'faction-unlock',
  航天合同: 'aerospace-contract',
  航天: 'aerospace-contract',
  天基: 'aerospace-contract',
  太空: 'aerospace-contract',
  发射中心: 'aerospace-contract',
  机娘档案: 'maiden-dossier',
  机娘: 'maiden-status',
  机娘状态: 'maiden-status',
  图鉴: 'codex-entry',
  工程: 'engineering-order',
  排产计划: 'production-schedule',
  生产: 'production-schedule',
  排产: 'production-schedule',
  生产计划: 'production-schedule',
  扩展档案: 'expansion-dossier',
  扩展: 'expansion-dossier',
  新扩展: 'expansion-dossier',
  数据更新: 'data-patch',
  数据补丁: 'data-patch',
  数据修改: 'data-patch',
  暗网: 'darknet-terminal',
  暗网订单: 'darknet-terminal',
  暗网采购: 'darknet-terminal',
  暗网交易: 'darknet-terminal',
  黑市: 'darknet-terminal',
  黑市订单: 'darknet-terminal',
  黑市交易: 'darknet-terminal',
  选项: 'tactical-options',
  行动选项: 'tactical-options',
  决策选项: 'tactical-options',
  任务: 'tactical-quest',
  作战任务: 'tactical-quest',
  任务指令: 'tactical-quest',
  悬赏任务: 'tactical-quest',
  情报: 'tactical-intel',
  战区情报: 'tactical-intel',
  情报电讯: 'tactical-intel',
  世界演变: 'world-evolution-stealth',
  世界暗流: 'world-evolution-stealth',
  宏观演变: 'world-evolution-stealth',
  部署: 'deployment-order',
  展开: 'deployment-order',
  deploy: 'deployment-order',
  资金链: 'economy-chains',
};

export function resolveFloorProtocolCardType(tag: string): FloorProtocolCardType | null {
  if (!tag) return null;
  return TAG_TO_CARD_TYPE[tag] ?? TAG_TO_CARD_TYPE[tag.toLowerCase()] ?? null;
}

export const FLOOR_PROTOCOL_TAGS = [
  '摘要',
  'summary',
  '中摘要',
  '大摘要',
  'timepast',
  '态势',
  '初始状态',
  '战况',
  '战区态势',
  '环境态势',
  '环境',
  '事件',
  '阵营解锁',
  '阵营启封',
  '航天合同',
  '航天',
  '天基',
  '太空',
  '发射中心',
  '机娘档案',
  '机娘',
  '机娘状态',
  '图鉴',
  '工程',
  '排产计划',
  '生产',
  '排产',
  '生产计划',
  '扩展档案',
  '扩展',
  '新扩展',
  '数据更新',
  '数据补丁',
  '数据修改',
  '暗网',
  '暗网订单',
  '暗网采购',
  '暗网交易',
  '黑市',
  '黑市订单',
  '黑市交易',
  '选项',
  '行动选项',
  '决策选项',
  '任务',
  '作战任务',
  '任务指令',
  '悬赏任务',
  '情报',
  '战区情报',
  '情报电讯',
  '世界演变',
  '世界暗流',
  '宏观演变',
  '部署',
  '展开',
  'deploy',
  '资金链',
] as const;

export type FloorProtocolTag = (typeof FLOOR_PROTOCOL_TAGS)[number];
const supported = new Set<string>(FLOOR_PROTOCOL_TAGS);
const boundaries = new Set(['正文', 'interleaving', ...THINK_TAGS]);

export interface FloorProtocolBlock {
  tag: FloorProtocolTag;
  cardType?: FloorProtocolCardType;
  /** 所有位置均为原文 UTF-16 偏移，end 不包含在区间内。 */
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  ordinal: number;
  openTag: string;
  openTagAttrs?: Record<string, string>;
  payload: string;
  status: 'valid' | 'unclosed' | 'boundary-crossing';
}

export type IndexedProtocolBlock = FloorProtocolBlock;

/** 解析开标签中的属性，如 `<中摘要 范围="2-20" 标题="第一幕">` */
export function parseOpenTagAttributes(openTag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!openTag || !openTag.startsWith('<')) return attrs;
  const inner = openTag.replace(/^<[^\s/>]+/, '').replace(/\/?>$/, '').trim();
  if (!inner) return attrs;
  const attrRe = /([a-zA-Z0-9_\u4e00-\u9fa5-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(inner)) !== null) {
    const key = m[1].trim();
    const val = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (key) attrs[key] = val;
  }
  return attrs;
}

function enrichSummaryBlockPayload(
  tag: string,
  innerPayload: string,
  attrs: Record<string, string>,
): string {
  if ((tag !== '中摘要' && tag !== '大摘要') || !innerPayload) {
    return innerPayload;
  }
  const prefixLines: string[] = [];
  const hasTierMarker =
    /^\[(?:中摘要|大摘要|MESO|MACRO)\]/i.test(innerPayload) ||
    /^(?:阶次|层级|tier)\s*[:：]/im.test(innerPayload);
  if (!hasTierMarker) {
    prefixLines.push(`阶次: ${tag}`);
  }

  const attrRange =
    attrs['范围'] ?? attrs['楼层范围'] ?? attrs['区间'] ?? attrs['range'] ?? '';
  if (attrRange && !/^(?:范围|楼层范围|区间|range)\s*[:：]/im.test(innerPayload)) {
    prefixLines.push(`范围: ${attrRange}`);
  }

  const attrTitle =
    attrs['标题'] ?? attrs['阶段标题'] ?? attrs['总纲标题'] ?? attrs['title'] ?? '';
  if (attrTitle && !/^(?:标题|阶段标题|总纲标题|title)\s*[:：]/im.test(innerPayload)) {
    prefixLines.push(`标题: ${attrTitle}`);
  }

  if (prefixLines.length === 0) return innerPayload;
  return `${prefixLines.join('\n')}\n${innerPayload}`;
}

/** 无宿主副作用、无跨楼缓存。保留无效块的序号，避免下一张卡片顶替错误块。 */
export function indexFloorProtocols(
  raw: string,
  resolveTag: (name: string) => string | null = name => (supported.has(name) ? name : null),
): FloorProtocolBlock[] {
  const text = stripThinking(raw, true).text;
  const tokens = scanTags(text).map(token => ({ ...token, name: resolveTag(token.name) ?? token.name }));
  const blocks: FloorProtocolBlock[] = [];
  const ordinals = new Map<string, number>();
  let body = false;
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i];
    if (open.name === '正文' && (open.isClose || atLineStart(text, open.index))) {
      body = !open.isClose;
      continue;
    }
    if (open.isClose || !supported.has(open.name) || !atLineStart(text, open.index)) continue;
    // 正文已闭合时，容器中的协议示例绝不参与业务。未闭合正文允许在正式协议处恢复。
    if (body) {
      const laterBodyClose = tokens.slice(i + 1).some(t => t.isClose && t.name === '正文');
      if (laterBodyClose) continue;
      body = false;
    }
    let contentEnd = raw.length;
    let end = raw.length;
    let status: FloorProtocolBlock['status'] = 'unclosed';
    let next = tokens.length;
    for (let j = i + 1; j < tokens.length; j++) {
      const token = tokens[j];
      if (token.isClose && token.name === open.name) {
        contentEnd = token.index;
        end = token.end;
        status = 'valid';
        next = j + 1;
        break;
      }
      if (
        boundaries.has(token.name) ||
        (!token.isClose &&
          (supported.has(token.name) || resolveTag(token.name) !== null) &&
          atLineStart(text, token.index))
      ) {
        contentEnd = end = token.index;
        status = 'boundary-crossing';
        next = j;
        break;
      }
    }
    // 中间存在被清除的思考区亦视为跨区，不拼接成看似有效的业务块。
    if (status === 'valid' && raw.slice(open.end, contentEnd) !== text.slice(open.end, contentEnd)) {
      status = 'boundary-crossing';
    }
    const ordinal = ordinals.get(open.name) ?? 0;
    ordinals.set(open.name, ordinal + 1);
    const openTag = raw.slice(open.index, open.end);
    const openTagAttrs = parseOpenTagAttributes(openTag);
    const rawInner = status === 'valid' ? raw.slice(open.end, contentEnd).trim() : '';
    const payload =
      status === 'valid' ? enrichSummaryBlockPayload(open.name, rawInner, openTagAttrs) : '';
    const cardType = resolveFloorProtocolCardType(open.name) ?? undefined;
    blocks.push({
      tag: open.name as FloorProtocolTag,
      ...(cardType ? { cardType } : {}),
      start: open.index,
      end,
      contentStart: open.end,
      contentEnd,
      ordinal,
      openTag,
      ...(Object.keys(openTagAttrs).length > 0 ? { openTagAttrs } : {}),
      payload,
      status,
    });
    i = next - 1;
  }
  return blocks;
}
