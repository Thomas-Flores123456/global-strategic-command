/**
 * 研究解锁反向推导（单一真源 · 取代手写 `unlocks` 文案作为"解锁了什么"的权威答案）
 *
 * 背景：世界书 `ResearchDef.unlocks` 是人工填写的自然语言；审计发现 336 项研究中 79 项写着
 * 「无（研究线终点）」但实际被生产/建筑/后续研究/改装/协议以 prereqs 引用。前馈层早已用反向扫描
 * 得到正确结果，而面板「解锁」栏与 DLC 数据卡只读字面 → 三处口径不一致。
 *
 * 本模块把反向扫描收口为纯函数，三处消费点共用：
 * - 真源 = 目录各集合对该研究的 prereqs / research / requirements(research 原子) 引用；
 * - `unlocks` 字面只在"反向扫描一无所获"时作为补充回退（保留 DLC 作者写的叙事型解锁说明）；
 * - 匹配一律过 canon（parseCommon）双侧归一；同时接受研究 name 与 id。
 *
 * 纯函数：零 IO / 零 store / 零酒馆 API。
 */
import type {
  BuildingDef,
  ProductionDef,
  ProtocolCatalogItem,
  ResearchDef,
  RetrofitDef,
} from './catalog';
import type { PrerequisiteCondition } from './prerequisites';
import { canon } from '../parse/parseCommon';

/** 解锁分组（按消费方习惯的呈现序） */
export interface ResearchUnlocks {
  /** 可生产（单位/装备） */
  productions: string[];
  /** 可建造 */
  buildings: string[];
  /** 后续科技 */
  researches: string[];
  /** 可改装 */
  retrofits: string[];
  /** 协议/条令 */
  protocols: string[];
  /** 反向扫描是否命中任何下游 */
  hasDownstream: boolean;
}

/** 最小目录鸭型（EffectiveCatalog 与 ParsedWorldbookCatalog 子集均可喂入） */
export interface ResearchUnlockCatalogLike {
  researches?: readonly Pick<ResearchDef, 'name' | 'prereqs' | 'requirements'>[] | null;
  productions?: readonly Pick<ProductionDef, 'name' | 'prereqs' | 'requirements'>[] | null;
  buildings?: readonly Pick<BuildingDef, 'name' | 'research' | 'prereqs' | 'requirements'>[] | null;
  retrofits?: readonly Pick<RetrofitDef, 'name' | 'research'>[] | null;
  protocols?: readonly Pick<ProtocolCatalogItem, 'name' | 'prereqs' | 'requirements'>[] | null;
}

/** 从 PrerequisiteCondition 树中抽出全部 research 原子的 name/id（只读遍历） */
function collectResearchAtoms(cond: PrerequisiteCondition | undefined | null, out: string[]): void {
  if (!cond || typeof cond !== 'object') return;
  if ('op' in cond && Array.isArray(cond.conditions)) {
    for (const c of cond.conditions) collectResearchAtoms(c, out);
    return;
  }
  if ('kind' in cond && cond.kind === 'research') {
    if (typeof cond.name === 'string' && cond.name) out.push(cond.name);
    if (typeof cond.id === 'string' && cond.id) out.push(cond.id);
  }
}

/**
 * 反向推导某研究解锁的全部下游（按集合分组、各组内按目录序去重）。
 * @param techKeys 研究的 name / id / 任意别名（任一匹配即视为引用了该研究）
 */
export function resolveResearchUnlocks(
  techKeys: readonly string[] | string,
  catalog: ResearchUnlockCatalogLike | null | undefined,
): ResearchUnlocks {
  const keys = new Set(
    (Array.isArray(techKeys) ? techKeys : [techKeys]).map(k => canon(k)).filter(k => k.length > 0),
  );
  const out: ResearchUnlocks = { productions: [], buildings: [], researches: [], retrofits: [], protocols: [], hasDownstream: false };
  if (keys.size === 0 || !catalog) return out;

  const refersToTech = (entry: {
    prereqs?: readonly string[] | null;
    research?: string | null;
    requirements?: PrerequisiteCondition | null;
  }): boolean => {
    const refs: string[] = [];
    for (const p of entry.prereqs ?? []) if (typeof p === 'string') refs.push(p);
    if (typeof entry.research === 'string' && entry.research) refs.push(entry.research);
    collectResearchAtoms(entry.requirements ?? undefined, refs);
    return refs.some(r => keys.has(canon(r)));
  };

  const pushUnique = (bucket: string[], name: string) => {
    const clean = String(name ?? '').trim();
    if (!clean) return;
    const k = canon(clean);
    if (keys.has(k)) return; // 自引用（同名/别名）不算下游
    if (bucket.some(x => canon(x) === k)) return;
    bucket.push(clean);
  };

  for (const p of catalog.productions ?? []) if (refersToTech(p)) pushUnique(out.productions, p.name);
  for (const b of catalog.buildings ?? []) if (refersToTech(b)) pushUnique(out.buildings, b.name);
  for (const r of catalog.researches ?? []) if (refersToTech(r)) pushUnique(out.researches, r.name);
  for (const rt of catalog.retrofits ?? []) if (refersToTech(rt)) pushUnique(out.retrofits, rt.name);
  for (const pr of catalog.protocols ?? []) if (refersToTech(pr)) pushUnique(out.protocols, pr.name);

  out.hasDownstream =
    out.productions.length + out.buildings.length + out.researches.length + out.retrofits.length + out.protocols.length > 0;
  return out;
}

/** 分组 → 一行条令体文案（面板/数据卡/世界书回填共用同一句式） */
export function formatResearchUnlocks(u: ResearchUnlocks): string {
  const parts: string[] = [];
  if (u.productions.length) parts.push(`可生产：${u.productions.join('、')}`);
  if (u.buildings.length) parts.push(`可建造：${u.buildings.join('、')}`);
  if (u.retrofits.length) parts.push(`可改装：${u.retrofits.join('、')}`);
  if (u.protocols.length) parts.push(`可攻关协议：${u.protocols.join('、')}`);
  if (u.researches.length) parts.push(`后续科技：${u.researches.join('、')}`);
  return parts.join('；');
}

/** 扁平化为高光标签（前馈「现已解锁」用；按 生产→建筑→改装→协议→后续科技 序） */
export function flattenResearchUnlocks(u: ResearchUnlocks): string[] {
  return [...u.productions, ...u.buildings, ...u.retrofits, ...u.protocols, ...u.researches];
}

/**
 * 面板/数据卡展示用："解锁"文本的权威解析：
 * 反向扫描命中 → 分组文案；未命中 → 回退到作者手写 `unlocks`（非「无…」字面）；两者皆空 → ''。
 */
export function resolveResearchUnlocksText(
  research: Pick<ResearchDef, 'name' | 'unlocks'> & { id?: string },
  catalog: ResearchUnlockCatalogLike | null | undefined,
): string {
  const keys = [research.name, ...(research.id ? [research.id] : [])];
  const derived = resolveResearchUnlocks(keys, catalog);
  if (derived.hasDownstream) return formatResearchUnlocks(derived);
  const written = String(research.unlocks ?? '').trim();
  if (!written || /^无/.test(written)) return '';
  return written;
}
