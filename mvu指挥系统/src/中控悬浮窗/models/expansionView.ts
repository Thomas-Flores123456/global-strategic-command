/**
 * expansionView.ts —— 聊天档案书条目视图派生（纯函数，F1 管理页 §6 信息合同 & FD-32 人物分支）
 */
import { stripExpansionCommentPrefix } from '../../红警指挥系统/worldbook/expansionFiler';

/** §2.4 前缀命名空间：扩展段（含 FD-32 人物、地点与势力）可提升；机娘/摘要段只列不提升 */
export const EXPANSION_KINDS = ['人物', '科技', '建筑', '载具', '人员', '装备', '地点', '势力'] as const;
export const EXPANSION_PREFIXES = EXPANSION_KINDS;
const OTHER_PREFIXES = ['档案', '剧情', '总览', '摘要'] as const;

export type ExpansionKindType = (typeof EXPANSION_KINDS)[number];

/** 扩展档案分类色标类名映射（FD-32 新增 人物: badge-npc，BUG-R2-25 新增 势力: badge-npc） */
export const KIND_BADGE_CLASS: Record<string, string> = {
  人物: 'badge-npc',
  科技: 'badge-tech',
  建筑: 'badge-building',
  载具: 'badge-vehicle',
  人员: 'badge-troop',
  装备: 'badge-gear',
  地点: 'badge-building',
  势力: 'badge-npc',
};

export interface EntryGroup<E> {
  prefix: string;
  promotable: boolean;
  items: E[];
}

export function prefixOf(name: string): string {
  const seg = /^([^·]+)·/.exec(name)?.[1];
  if (
    seg &&
    ((EXPANSION_PREFIXES as readonly string[]).includes(seg) || (OTHER_PREFIXES as readonly string[]).includes(seg))
  ) {
    return seg;
  }
  return '其他';
}

export function groupChatBookEntries<E extends { name: string }>(entries: readonly E[]): EntryGroup<E>[] {
  const order = [...EXPANSION_PREFIXES, ...OTHER_PREFIXES, '其他'];
  const map = new Map<string, E[]>();
  for (const e of entries) {
    const p = prefixOf(e.name);
    if (!map.has(p)) map.set(p, []);
    map.get(p)!.push(e);
  }
  return order
    .filter(p => map.has(p))
    .map(p => ({ prefix: p, promotable: (EXPANSION_PREFIXES as readonly string[]).includes(p), items: map.get(p)! }));
}

/** §4.1 建议名：书名 `红警扩展·{条目名}`，条目名沿用原 comment 去前缀（兼容 人物· 前缀） */
export function suggestPromotion(entryName: string): { bookName: string; entryName: string } {
  const stripped = stripExpansionCommentPrefix(entryName).replace(/^人物·/, '').replace(/·设定$/, '');
  const base = stripped || entryName;
  return { bookName: `红警扩展·${base}`, entryName: base };
}
