import { FACTION_DEFS, type FactionDef, type FactionTierInfo, type ResearchDef } from '../../core/catalog';
import { normalizeFactionId } from '../../core/commandPresets';
import {
  buildEntityCredibilityIndex,
  isSystemCatalogEntity,
  type CatalogEntityLike,
} from '../../core/entityCredibility';
import {
  buildCatalogPrerequisiteContext,
  buildCompletedTechAndProtocolSet,
  buildUnitPresent,
  extractActiveProtocolSet,
  type RuntimeBaseLike,
  type RuntimeBuildingLike,
  type RuntimeForcesLike,
  type RuntimeProtocolsInput,
} from '../../core/catalogRuntimeContext';
import {
  isDebugBypassPrerequisitesActive,
  isDebugUnlockAllFactionsActive,
} from '../../composables/useDebugMode';
import {
  combineLegacyPrerequisites,
  evaluatePrerequisite,
  type PrerequisiteBaseState,
  type PrerequisiteContext,
  type PrerequisiteProtocolSource,
  type UnmetPrerequisite,
} from '../../core/prerequisites';
import { factionLabTier, scanActiveProtocolBuildings, type ProtocolAnchorStateView } from '../../engines/protocolAnchors';
import { techTier, type SlotStateView } from '../../engines/researchSlots';

export type TechCardState = 'done' | 'active' | 'queued' | 'ready' | 'locked';
export type TechSortMode = 'tactical' | 'tier' | 'line';
export type MissingPrereqKind = 'tech' | 'protocol' | 'building';

export interface MissingPrereqChip {
  name: string;
  kind: MissingPrereqKind;
  rawId?: string;
}

export interface UiResearch {
  id?: string;
  name: string;
  line: string;
  tier?: 1 | 2 | 3;
  meta: string;
  dynamic?: boolean;
  prereqMet: boolean;
  missingPrereqs: MissingPrereqChip[];
}

export interface CodexResearchEntryLike {
  name: string;
  kind: string;
  desc?: string;
  params?: Record<string, string>;
}

/**
 * 过滤动态图鉴（codex）中的科技条目：
 * - 基于世界书有效科技目录构建通用可信度索引（buildEntityCredibilityIndex）
 * - 凡是 isSystemCatalogEntity(index, c.name, 'research', 0.80) === true
 *   （即精确同名、归一同名、别名命中或高可信变体属于世界书已有科技）的条目，一律剔除
 * - 仅保留真正不属于世界书目录的 novel_eva 条目供科技面板渲染为「EVA 增补」
 */
export function filterDynamicCodexResearches<T extends CodexResearchEntryLike>(
  codexList: readonly T[] | null | undefined,
  catalogResearches: readonly CatalogEntityLike[] | null | undefined,
  customAliases?: Readonly<Record<string, string>>,
): T[] {
  if (!Array.isArray(codexList) || codexList.length === 0) return [];
  const techEntries = codexList.filter(
    c => Boolean(c) && c.kind === '科技' && typeof c.name === 'string' && c.name.trim().length > 0,
  );
  if (techEntries.length === 0) return [];
  const researches = catalogResearches ?? [];
  if (researches.length === 0) return techEntries;
  const index = buildEntityCredibilityIndex({ researches }, customAliases);
  return techEntries.filter(c => !isSystemCatalogEntity(index, c.name.trim(), 'research', 0.80));
}

export function extractMissingPrereqsFromUnmet(
  unmet: readonly UnmetPrerequisite[],
  catalogProtocols?: PrerequisiteProtocolSource,
): MissingPrereqChip[] {
  const chips: MissingPrereqChip[] = [];
  const seen = new Set<string>();
  const protocolKeys = new Set<string>();
  if (Array.isArray(catalogProtocols)) {
    for (const p of catalogProtocols) {
      if (p?.id) protocolKeys.add(p.id.trim());
      if (p?.name) protocolKeys.add(p.name.trim());
    }
  } else if (catalogProtocols && typeof catalogProtocols === 'object') {
    for (const [k, p] of Object.entries(catalogProtocols)) {
      protocolKeys.add(k.trim());
      if (p?.id) protocolKeys.add(p.id.trim());
      if (p?.name) protocolKeys.add(p.name.trim());
    }
  }

  const pushChip = (chip: MissingPrereqChip) => {
    const key = `${chip.kind}:${chip.name}`;
    if (!chip.name || seen.has(key)) return;
    seen.add(key);
    chips.push(chip);
  };

  for (const item of unmet) {
    const msg = item.message.trim();
    if (msg.startsWith('[协议] 缺少协议：')) {
      const raw = msg.slice('[协议] 缺少协议：'.length).trim();
      const m = /^(.+?)（([^（）]+)）$/.exec(raw);
      const name = m ? m[1].trim() : raw;
      const rawId = m ? m[2].trim() : raw;
      pushChip({ name, kind: 'protocol', rawId });
      continue;
    }
    if (msg.startsWith('缺少研究：')) {
      const raw = msg.slice('缺少研究：'.length).trim();
      const isProto =
        protocolKeys.has(raw) || /\.protocol\.|_protocol$/i.test(raw) || /协议$/.test(raw);
      pushChip({ name: raw, kind: isProto ? 'protocol' : 'tech', rawId: raw });
      continue;
    }
    const bldMatch = /^缺少(?:当前基地|全局)?建筑：(.+?)(?:（[^（）]*）)?$/.exec(msg);
    if (bldMatch) {
      pushChip({ name: bldMatch[1].trim(), kind: 'building' });
      continue;
    }
    const unitMatch = /^缺少单位：(.+?)(?:（[^（）]*）)?$/.exec(msg);
    if (unitMatch) {
      pushChip({ name: unitMatch[1].trim(), kind: 'building' });
    }
  }
  return chips;
}

function expandWithStrippedFactionName(targetSet: Set<string>, rawName: string): void {
  const trimmed = rawName.trim();
  if (!trimmed) return;
  targetSet.add(trimmed);
  const m = /^(?:盟军|苏联|苏军|苏维埃|尤里)(.+)$/.exec(trimmed);
  const stripped = m?.[1]?.trim();
  if (stripped && stripped.length >= 2) targetSet.add(stripped);
}

export function evaluateTechCardPrerequisites(
  researchDef: Partial<ResearchDef> | undefined,
  stateInput: {
    bases?: readonly RuntimeBaseLike[];
    techDone?: readonly string[];
    forces?: RuntimeForcesLike;
    protocols?: RuntimeProtocolsInput;
  },
  catalogProtocols?: PrerequisiteProtocolSource,
): { prereqMet: boolean; missingPrereqs: MissingPrereqChip[] } {
  if (!researchDef) return { prereqMet: true, missingPrereqs: [] };
  const rawBases = stateInput.bases ?? [];
  const normalizedBases: RuntimeBaseLike[] = rawBases.map((b, idx) => ({
    ...b,
    id: (b?.id && b.id.trim()) || (b?.name && b.name.trim()) || `base_${idx}`,
    name: (b?.name && b.name.trim()) || (b?.id && b.id.trim()) || `base_${idx}`,
    buildings: b?.buildings ?? [],
  }));
  const selectedBaseId = normalizedBases[0]?.id ?? '';
  const baseCtx = selectedBaseId
    ? buildCatalogPrerequisiteContext({
        bases: normalizedBases,
        selectedBaseId,
        techDone: stateInput.techDone ?? [],
        forces: stateInput.forces ?? { troops: {}, vehicles: [] },
        protocols: stateInput.protocols,
      })
    : null;

  if (baseCtx && normalizedBases.length > 0) {
    const mergedExisting = new Set<string>();
    const mergedCompleted = new Set<string>();
    const mergedRunning = new Set<string>();
    for (const st of baseCtx.bases.values()) {
      for (const name of st.existing) expandWithStrippedFactionName(mergedExisting, name);
      for (const name of st.completed) expandWithStrippedFactionName(mergedCompleted, name);
      for (const name of st.running) expandWithStrippedFactionName(mergedRunning, name);
    }
    for (const b of normalizedBases) {
      for (const bld of b.buildings ?? []) {
        const bName = bld?.name?.trim();
        if (!bName) continue;
        expandWithStrippedFactionName(mergedExisting, bName);
        if (bld.state !== '建造中' && bld.state !== '损毁' && bld.state !== '被毁') {
          expandWithStrippedFactionName(mergedCompleted, bName);
        }
        if (bld.state === '运转') {
          expandWithStrippedFactionName(mergedRunning, bName);
        }
      }
    }
    (baseCtx.bases as Map<string, PrerequisiteBaseState>).set(baseCtx.selectedBaseId, {
      existing: mergedExisting,
      completed: mergedCompleted,
      running: mergedRunning,
    });
  }

  const ctx: PrerequisiteContext = baseCtx
    ? { ...baseCtx, protocols: catalogProtocols }
    : {
        techDone: buildCompletedTechAndProtocolSet(stateInput.techDone ?? [], stateInput.protocols),
        activeProtocols: extractActiveProtocolSet(stateInput.protocols),
        selectedBaseId: '',
        bases: new Map(),
        unitPresent: buildUnitPresent(stateInput.forces ?? { troops: {}, vehicles: [] }),
        protocols: catalogProtocols,
      };

  const normalizedDef = researchDef.requirements ? { ...researchDef, need_buildings: [] } : researchDef;

  const evalResult = evaluatePrerequisite(combineLegacyPrerequisites(normalizedDef, 'completed'), ctx);
  if (evalResult.satisfied) {
    return { prereqMet: true, missingPrereqs: [] };
  }
  const missingPrereqs = extractMissingPrereqsFromUnmet(evalResult.unmet, catalogProtocols);
  if (isDebugBypassPrerequisitesActive()) {
    return { prereqMet: true, missingPrereqs };
  }
  return {
    prereqMet: false,
    missingPrereqs,
  };
}

export function inferResearchEntryFaction(entry: {
  id?: string;
  name?: string;
  faction?: string;
  scope?: string;
  line?: string;
  tags?: readonly string[];
  need_building?: string;
  need_buildings?: readonly string[];
}): string {
  if (entry.scope === 'common') return 'common';
  if (typeof entry.faction === 'string' && entry.faction.trim()) {
    const norm = normalizeFactionId(entry.faction);
    if (norm) return norm;
  }
  if (typeof entry.id === 'string' && entry.id.trim()) {
    const lowerId = entry.id.trim().toLowerCase();
    if (lowerId.startsWith('sov.') || lowerId.startsWith('soviet.') || lowerId.includes('.soviet.')) return 'soviet';
    if (lowerId.startsWith('all.') || lowerId.startsWith('allied.') || lowerId.includes('.allied.')) return 'allied';
    if (lowerId.startsWith('yuri.') || lowerId.includes('.yuri.')) return 'yuri';
    if (lowerId.startsWith('common.') || lowerId.includes('.common.')) return 'common';
  }
  if (typeof entry.line === 'string' && entry.line.trim()) {
    const lineNorm = normalizeFactionId(entry.line);
    if (lineNorm === 'allied' || lineNorm === 'soviet' || lineNorm === 'yuri') return lineNorm;
  }
  for (const tag of entry.tags ?? []) {
    const tagNorm = normalizeFactionId(tag);
    if (tagNorm === 'allied' || tagNorm === 'soviet' || tagNorm === 'yuri') return tagNorm;
  }
  const textProbe = [entry.name ?? '', entry.need_building ?? '', ...(entry.need_buildings ?? [])].join(' ');
  if (/苏联|苏军|苏维埃|红星|磁暴|铁幕|基洛夫|天启/.test(textProbe)) return 'soviet';
  if (/盟军|超时空|光棱|幻影|裂缝产生器/.test(textProbe)) return 'allied';
  if (/尤里|心灵控制|基因突变/.test(textProbe)) return 'yuri';
  return 'common';
}

export function shouldIncludeResearchByFactionFilter(
  entry: {
    id?: string;
    name?: string;
    faction?: string;
    scope?: string;
    line?: string;
    tags?: readonly string[];
    need_building?: string;
    need_buildings?: readonly string[];
  },
  unlockedFactions?: readonly string[],
  factionFilter?: string,
): boolean {
  const hasUnlockedFilter = Array.isArray(unlockedFactions) && unlockedFactions.length > 0;
  const hasActiveFilter = Boolean(factionFilter && factionFilter !== 'all');
  if (!hasUnlockedFilter && !hasActiveFilter) return true;

  const faction = inferResearchEntryFaction(entry);
  if (faction === 'common') return true;

  if (hasUnlockedFilter && !isDebugUnlockAllFactionsActive()) {
    const unlockedSet = new Set(unlockedFactions!.map(f => normalizeFactionId(f)).filter(Boolean));
    if (unlockedSet.size > 0 && !unlockedSet.has(faction)) return false;
  }
  if (hasActiveFilter) {
    const target = normalizeFactionId(factionFilter!);
    if (target && target !== 'all' && faction !== target) return false;
  }
  return true;
}

export function derivePanelFactionTiers(
  defsOrState:
    | readonly FactionDef[]
    | (ProtocolAnchorStateView & SlotStateView & { tech?: { done?: readonly string[] } })
    | null
    | undefined,
  buildingsOrDefs?: readonly RuntimeBuildingLike[] | readonly FactionDef[],
  doneInput: readonly string[] = [],
): FactionTierInfo[] {
  let defs: readonly FactionDef[] = FACTION_DEFS;
  let stateView: ProtocolAnchorStateView & SlotStateView;
  let allBuildings: readonly RuntimeBuildingLike[] = [];
  let done: readonly string[] = doneInput;

  if (Array.isArray(defsOrState)) {
    defs = defsOrState.length > 0 ? defsOrState : FACTION_DEFS;
    allBuildings = Array.isArray(buildingsOrDefs) ? (buildingsOrDefs as readonly RuntimeBuildingLike[]) : [];
    stateView = {
      bases: [{ status: '正常', buildings: allBuildings as readonly { name: string; state?: string }[] }],
    } as unknown as ProtocolAnchorStateView & SlotStateView;
  } else {
    stateView = (defsOrState ?? { bases: [] }) as ProtocolAnchorStateView & SlotStateView;
    if (Array.isArray(buildingsOrDefs) && buildingsOrDefs.length > 0) {
      defs = buildingsOrDefs as readonly FactionDef[];
    }
    allBuildings = (stateView.bases ?? []).flatMap(b => b?.buildings ?? []) as readonly RuntimeBuildingLike[];
    if (done.length === 0 && defsOrState && 'tech' in defsOrState && Array.isArray(defsOrState.tech?.done)) {
      done = defsOrState.tech.done;
    }
  }

  const scan = scanActiveProtocolBuildings(stateView);
  const globalTier = techTier(stateView);
  const result: FactionTierInfo[] = [];

  for (const def of defs) {
    const mcvNames = [def.mcv, `${def.faction}建造厂`];
    const hasMcv = allBuildings.some(b => mcvNames.includes(b.name));
    const hasSovietAnchor =
      def.faction === '苏联' &&
      (scan.sovietT2Lab ||
        scan.sovietT3Sanctuary ||
        allBuildings.some(b =>
          ['苏联战斗实验室', '红星实验设计局', '红星实验设计局综合体', '国家战略工程综合体', '红星科学城'].some(k =>
            b.name.includes(k),
          ),
        ));
    const hasAlliedAnchor =
      def.faction === '盟军' &&
      (scan.alliedT2Lab ||
        scan.alliedT3Sanctuary ||
        allBuildings.some(b =>
          ['战斗实验室', '盟军战斗实验室', '盟军作战实验室', '盟军联合科研与国家工程组织节点', '量子超算中心'].some(
            k => b.name === k || (k !== '战斗实验室' && b.name.includes(k)),
          ),
        ));
    if (!hasMcv && !hasSovietAnchor && !hasAlliedAnchor) continue;

    const labTier =
      def.faction === '苏联' || def.faction === '盟军'
        ? factionLabTier(stateView, def.faction)
        : allBuildings.some(b => b.name === def.lab && b.state !== '建造中')
          ? globalTier >= 3
            ? 3
            : 2
          : 1;

    const effectiveTier: 1 | 2 | 3 =
      labTier === 3 || (labTier === 2 && globalTier === 3 && scan.quantumSupercomputer && def.faction === '盟军')
        ? 3
        : labTier;

    if (effectiveTier === 3) {
      result.push({ faction: def.faction, tier: 3, next: 'T4 条件未公布' });
    } else if (effectiveTier === 2) {
      const t3Building = allBuildings.find(b =>
        (def.faction === '苏联'
          ? ['国家战略工程综合体', '红星科学城']
          : ['盟军联合科研与国家工程组织节点', '量子超算中心']
        ).some(anchor => b.name.includes(anchor)),
      );
      if (t3Building && t3Building.state === '建造中') {
        result.push({
          faction: def.faction,
          tier: 2,
          next: `${t3Building.name}建造中 ${(t3Building as { progress?: number }).progress ?? 0}%`,
        });
      } else {
        result.push({ faction: def.faction, tier: 2, next: 'T3 条件未公布' });
      }
    } else {
      const labCandidates = [
        def.lab,
        ...(def.faction === '苏联' ? ['红星实验设计局综合体', '红星实验设计局'] : []),
        ...(def.faction === '盟军' ? ['盟军作战实验室', '盟军战斗实验室'] : []),
      ];
      const constructingLab = allBuildings.find(b => labCandidates.includes(b.name) && b.state === '建造中');
      if (constructingLab) {
        result.push({
          faction: def.faction,
          tier: 1,
          next: `${constructingLab.name}建造中 ${(constructingLab as { progress?: number }).progress ?? 0}%`,
        });
      } else if (def.labResearch && done.includes(def.labResearch)) {
        result.push({ faction: def.faction, tier: 1, next: `建造${def.lab} → 升至 T2` });
      } else if (def.labResearch) {
        result.push({ faction: def.faction, tier: 1, next: `研发「${def.labResearch}」→ 升至 T2` });
      } else {
        result.push({ faction: def.faction, tier: 1, next: `需${def.lab}（详见世界书）` });
      }
    }
  }
  return result;
}

/**
 * 科技领域（line）战略优先级表：
 * 解决世界书加载顺序把「环保与公共设施」顶在第一屏最前面的问题。
 * 优先级数值越小越靠前：
 * 第一梯队：通用基础 → 主建筑 → 工业基础
 * 第二梯队：人员 → 装备 → 陆地载具 → 空中载具 → 水面舰艇 → 防御辅助
 * 第三梯队：阵营特色（盟军/苏联/尤里等） → 机娘保障工程 → 航天工业
 * 第四梯队：农畜业 → 环保与公共设施 → 动态研究（EVA 增补）
 */
const TECH_LINE_PRIORITY_EXACT: Readonly<Record<string, number>> = {
  通用: 10,
  主建筑: 20,
  工业基础: 30,
  人员: 40,
  装备: 50,
  陆地载具: 60,
  空中载具: 70,
  水面舰艇: 80,
  防御辅助: 90,
  盟军特色: 100,
  苏联特色: 101,
  尤里特色: 102,
  阵营特色: 105,
  机娘保障工程: 110,
  航天工业: 120,
  农畜业: 130,
  环保与公共设施: 140,
  动态研究: 150,
};

export function getTechLinePriority(line: string | undefined): number {
  const clean = (line ?? '').trim();
  if (!clean) return 999;
  if (clean in TECH_LINE_PRIORITY_EXACT) {
    return TECH_LINE_PRIORITY_EXACT[clean];
  }
  if (/通用/.test(clean)) return 12;
  if (/主建筑|基地/.test(clean)) return 22;
  if (/工业|资源|能源|电力/.test(clean)) return 32;
  if (/人员|步兵/.test(clean)) return 42;
  if (/装备|单兵/.test(clean)) return 52;
  if (/陆地|装甲|战车|载具/.test(clean)) return 62;
  if (/空中|航空|空军|战机/.test(clean)) return 72;
  if (/水面|舰艇|海军|船舶/.test(clean)) return 82;
  if (/防御|防空|工事/.test(clean)) return 92;
  if (/特色$/.test(clean)) return 104;
  if (/机娘|心智/.test(clean)) return 112;
  if (/航天|天基|轨道/.test(clean)) return 122;
  if (/农畜|农业|水培|生态/.test(clean)) return 132;
  if (/环保|公共|环卫|污水|废料/.test(clean)) return 142;
  if (/动态|EVA/i.test(clean)) return 152;
  return 125;
}

/** 从 meta 字符串（如 "300 · 约3日"）中提取数值型经费造价，用于同级内由低到高排序 */
export function parseTechMetaCost(meta: string | undefined): number {
  if (!meta) return 999999;
  const m = /(\d+(?:\.\d+)?)/.exec(meta);
  if (!m) return 999999;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 999999;
}

const TACTICAL_STATE_ORDER: Readonly<Record<TechCardState, number>> = {
  active: 0,
  queued: 1,
  ready: 2,
  locked: 3,
  done: 4,
};

const TIER_MODE_STATE_ORDER: Readonly<Record<TechCardState, number>> = {
  active: 0,
  queued: 1,
  ready: 2,
  done: 3,
  locked: 4,
};

/**
 * 对科技卡片列表执行多维智能排序：
 * - 'tactical'（默认 · 作战推荐）：
 *   1. 状态优先级：攻关中(active) → 排队中(queued) → 可立项(ready) → 待研制(locked) → 已攻克(done)
 *   2. 科技代际：T1 → T2 → T3（由浅入深）
 *   3. 若为 locked 待研制：按缺失前置数（missingPrereqs.length）升序，差 1 步即可解锁的“准立项”排在最前
 *   4. 领域战略优先级：通用/主建筑/工业/军事主战优先，环保市政靠后
 *   5. 经费造价升序
 * - 'tier'（代际梯度 T1→T3）：
 *   1. 科技代际 T1 → T2 → T3
 *   2. 领域战略优先级
 *   3. 状态优先级与缺失前置数
 *   4. 经费造价升序
 * - 'line'（领域分类）：
 *   1. 领域战略优先级
 *   2. 科技代际 T1 → T2 → T3
 *   3. 状态优先级与造价升序
 */
export function sortTechResearches<T extends UiResearch>(
  items: readonly T[],
  stateOf: (item: T) => TechCardState,
  mode: TechSortMode = 'tactical',
  queueOrderOf?: (name: string) => number,
): T[] {
  const indexed = items.map((item, idx) => ({
    item,
    idx,
    state: stateOf(item),
    tier: item.tier ?? 1,
    linePrio: getTechLinePriority(item.line),
    missingCount: item.missingPrereqs?.length ?? 0,
    cost: parseTechMetaCost(item.meta),
    queueOrder: queueOrderOf ? queueOrderOf(item.name) : idx,
  }));

  indexed.sort((a, b) => {
    if (mode === 'tactical') {
      const sa = TACTICAL_STATE_ORDER[a.state];
      const sb = TACTICAL_STATE_ORDER[b.state];
      if (sa !== sb) return sa - sb;

      if (a.state === 'queued' && a.queueOrder !== b.queueOrder) {
        return a.queueOrder - b.queueOrder;
      }
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.state === 'locked' && a.missingCount !== b.missingCount) {
        return a.missingCount - b.missingCount;
      }
      if (a.linePrio !== b.linePrio) return a.linePrio - b.linePrio;
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.idx - b.idx;
    }

    if (mode === 'tier') {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const sa = TIER_MODE_STATE_ORDER[a.state];
      const sb = TIER_MODE_STATE_ORDER[b.state];
      if (sa !== sb) return sa - sb;
      if (a.linePrio !== b.linePrio) return a.linePrio - b.linePrio;
      if (a.state === 'locked' && a.missingCount !== b.missingCount) {
        return a.missingCount - b.missingCount;
      }
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.idx - b.idx;
    }

    // mode === 'line'
    if (a.linePrio !== b.linePrio) return a.linePrio - b.linePrio;
    if (a.tier !== b.tier) return a.tier - b.tier;
    const sa = TACTICAL_STATE_ORDER[a.state];
    const sb = TACTICAL_STATE_ORDER[b.state];
    if (sa !== sb) return sa - sb;
    if (a.state === 'locked' && a.missingCount !== b.missingCount) {
      return a.missingCount - b.missingCount;
    }
    if (a.cost !== b.cost) return a.cost - b.cost;
    return a.idx - b.idx;
  });

  return indexed.map(entry => entry.item);
}

/**
 * 按领域战略优先级对分组对象（Record<line, T[]>）进行排序，
 * 且每个领域内部的科技列表也按指定排序模式排好序。
 */
export function sortTechByLineGroups<T extends UiResearch>(
  items: readonly T[],
  stateOf: (item: T) => TechCardState,
  mode: TechSortMode = 'tactical',
  queueOrderOf?: (name: string) => number,
): Record<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = item.line || '未分类';
    const arr = buckets.get(key);
    if (arr) arr.push(item);
    else buckets.set(key, [item]);
  }

  const sortedLines = [...buckets.keys()].sort((la, lb) => {
    const pa = getTechLinePriority(la);
    const pb = getTechLinePriority(lb);
    if (pa !== pb) return pa - pb;
    return la.localeCompare(lb, 'zh-CN');
  });

  const result: Record<string, T[]> = {};
  for (const line of sortedLines) {
    const groupItems = buckets.get(line) ?? [];
    result[line] = sortTechResearches(groupItems, stateOf, mode, queueOrderOf);
  }
  return result;
}

