/**
 * planningContext.ts —— 排产上下文生成与可行动阻塞分类纯函数（PLAN-CTX-01）
 *
 * 设计契约与红线：
 * 1. 纯函数与零副作用：零 Pinia、零 Vue、零宿主 API、零 DOM 引用、零入参突变；
 * 2. 同源复用：直接复用 catalogRuntimeContext、prerequisites、laneProviders、settleFloor、chainEngine；
 * 3. 零剧透铁律：严格过滤未解锁阵营及未揭盲/隐藏条目；
 * 4. UX-04 阻塞三段式：所有阻塞详情输出「原因（reason）→ 影响（impact）→ 下一步（nextStep）」。
 */

import type { BuildingDef, FactionDef, ProductionDef } from '../core/catalog';
import type { EffectiveCatalog } from '../core/catalogEffective';
import { normalizeFactionId } from '../core/commandPresets';
import {
  buildCatalogPrerequisiteContext,
  buildCompletedTechAndProtocolSet,
  isQueueVisibleForBase,
  resolveBaseReference,
  type RuntimeBaseLike,
  type RuntimeProtocolsInput,
} from '../core/catalogRuntimeContext';
import { calcDailyNet } from '../engines/chainEngine';
import { ProductionLaneProvider } from '../engines/laneProviders';
import {
  combineLegacyPrerequisites,
  evaluatePrerequisite,
  type PrerequisiteEvaluation,
  type UnmetPrerequisite,
} from '../core/prerequisites';
import {
  inferDefaultProductionMotherBuilding,
  ROOT_CONYARD_BUILDINGS,
  setHasEquivalentBuilding,
} from '../core/prerequisitesHelpers';
import type { StatData } from '../core/schema';
import { durationFromEntry } from '../engines/settleFloor';
import type { LaneResolveEnv, LaneStationView } from '../engines/taskOrchestrator';
import type { TransactionItem } from '../engines/transactionEngine';

export type { LaneStationView };

/* ═══════════════ 结构化导出类型 ═══════════════ */

export type PlanningBlockedReasonCode =
  | 'missing_research'
  | 'missing_building'
  | 'missing_unit'
  | 'insufficient_credits'
  | 'lane_locked'
  | 'lane_occupied'
  | 'facility_offline'
  | 'base_retired'
  | 'base_not_found';

export interface PlanningBlockedDetail {
  code: PlanningBlockedReasonCode;
  /** 原因（如：缺少前置科技「光棱聚焦基础」） */
  reason: string;
  /** 影响（如：当前无法在北坡主基地立项排产） */
  impact: string;
  /** 下一步（如：请先在科技厅完成「光棱聚焦基础」研发） */
  nextStep: string;
  missingItems: string[];
}

export interface PlanningCandidateItem {
  id: string;
  name: string;
  kind: '生产' | '建造';
  category: string;
  faction?: string;
  tier?: number;
  unitCost: number;
  unitMinutes: number;
  laneKey: string;
  laneName: string;
  canProduceNow: boolean;
  blocked?: PlanningBlockedDetail;
}

export interface PlanningBaseContext {
  baseId: string;
  baseName: string;
  baseState: string;
  credits: number;
  dailyNetCredits: number;
  lanes: LaneStationView[];
  produceableItems: PlanningCandidateItem[];
  /** 仅差 1~2 个前置或因资金/工位暂阻的相近候选 */
  nearUnlockItems: PlanningCandidateItem[];
  /** 当前战区已解锁图鉴中因前置/产线/资金受阻的全部候选（供沙盒点名排产时精确归因，不受 nearUnlock 截断） */
  blockedCatalogItems?: PlanningCandidateItem[];
  protectedTaskRefs: string[];
  activeQueueSummary: Array<{
    item: string;
    type: string;
    status: string;
    qty: number;
    spentMinutes: number;
    totalMinutes: number;
    hold?: boolean;
  }>;
}

export interface ClassifyPlanningBlockerInput {
  itemName?: string;
  kind?: '生产' | '建造';
  baseName?: string;
  baseState?: string;
  baseNotFound?: boolean;
  prerequisiteEval?: PrerequisiteEvaluation | null;
  unmet?: readonly UnmetPrerequisite[];
  lane?: Pick<LaneStationView, 'displayName' | 'capacity' | 'locked' | 'lockedReason'> | null;
  activeInLaneCount?: number;
  facilityOfflineNames?: readonly string[];
  completedBuildings?: ReadonlySet<string>;
  runningBuildings?: ReadonlySet<string>;
  unitCost?: number;
  credits?: number;
}

export interface BuildPlanningContextOptions {
  targetBaseRef?: string;
  protectedTaskRefs?: readonly string[];
  maxCandidates?: number;
}

/* ═══════════════ 内部工具函数 ═══════════════ */

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

interface ParsedUnmetBuckets {
  missingResearch: string[];
  missingProtocols: string[];
  missingBuildings: string[];
  missingUnits: string[];
}

/**
 * 解析 evaluatePrerequisite 产出的 unmet 消息桶
 */
function parseUnmetPrerequisites(unmetList: readonly UnmetPrerequisite[]): ParsedUnmetBuckets {
  const missingResearch: string[] = [];
  const missingProtocols: string[] = [];
  const missingBuildings: string[] = [];
  const missingUnits: string[] = [];

  const pushUnique = (arr: string[], val: string) => {
    const trimmed = val.trim();
    if (trimmed && !arr.includes(trimmed)) arr.push(trimmed);
  };

  for (const item of unmetList) {
    const msg = cleanText(item.message);
    if (!msg || msg === '任选条件均未满足') continue;

    if (msg.startsWith('[协议] 缺少协议：')) {
      const raw = msg.slice('[协议] 缺少协议：'.length).trim();
      const cleanName = raw.replace(/（[^（）]+）$/, '').trim() || raw;
      pushUnique(missingProtocols, cleanName);
      pushUnique(missingResearch, cleanName);
      continue;
    }

    if (msg.startsWith('缺少研究：')) {
      const raw = msg.slice('缺少研究：'.length).trim();
      pushUnique(missingResearch, raw);
      continue;
    }

    const buildingMatch = msg.match(/^缺少(?:当前基地|全局)建筑：(.+?)(?:（(?:existing|completed|running)）)?$/);
    if (buildingMatch) {
      pushUnique(missingBuildings, buildingMatch[1].trim());
      continue;
    }

    const unitMatch = msg.match(/^缺少单位：(.+?)(?:（需要\s*\d+，当前\s*\d+）)?$/);
    if (unitMatch) {
      pushUnique(missingUnits, unitMatch[1].trim());
      continue;
    }
  }

  return { missingResearch, missingProtocols, missingBuildings, missingUnits };
}

function extractAnchorFromLockedReason(lockedReason?: string): string {
  const raw = cleanText(lockedReason);
  if (!raw) return '';
  const match = raw.match(/^需(.+?)在场/);
  if (match) return match[1].trim();
  return raw;
}

function formatQuotedList(items: readonly string[]): string {
  return items.map(name => `「${name}」`).join('、');
}

/* ═══════════════ 1. UX-04 阻塞分类纯函数 ═══════════════ */

/**
 * 将前置不满足、产线未开通、设施停机、资金不足、工位满载等状态转化为符合 UX-04
 * 「原因（reason）→ 影响（impact）→ 下一步（nextStep）」三段式结构的 PlanningBlockedDetail。
 * 若当前无任何阻塞或提醒，返回 undefined。
 */
export function classifyPlanningBlocker(input: ClassifyPlanningBlockerInput): PlanningBlockedDetail | undefined {
  const baseLabel = cleanText(input.baseName) || '目标基地';
  const itemLabel = cleanText(input.itemName) || '目标条目';
  const actionLabel = input.kind === '建造' ? '建造施工' : '立项排产';

  // 1. 基地不存在
  if (input.baseNotFound) {
    return {
      code: 'base_not_found',
      reason: `未找到基地「${baseLabel}」`,
      impact: `当前无法为「${itemLabel}」建立属地排产上下文`,
      nextStep: '请核对基地编号或名称，切换至有效在役基地后重试',
      missingItems: [baseLabel],
    };
  }

  // 2. 基地已废弃/退役
  if (cleanText(input.baseState) === '废弃') {
    return {
      code: 'base_retired',
      reason: `基地「${baseLabel}」已处于废弃退役状态`,
      impact: `当前无法在「${baseLabel}」对「${itemLabel}」执行${actionLabel}`,
      nextStep: '请切换至其他非废弃在役基地执行排产规划',
      missingItems: [],
    };
  }

  // 3. 前置条件不满足（研究/协议、建筑、单位）
  const unmetList = input.unmet ?? input.prerequisiteEval?.unmet ?? [];
  const isPrereqUnmet =
    (input.prerequisiteEval !== undefined && input.prerequisiteEval !== null && !input.prerequisiteEval.satisfied) ||
    unmetList.length > 0;

  if (isPrereqUnmet) {
    const { missingResearch, missingProtocols, missingBuildings, missingUnits } = parseUnmetPrerequisites(unmetList);

    if (missingResearch.length > 0) {
      const hasProtocolOnly = missingProtocols.length > 0 && missingProtocols.length === missingResearch.length;
      const quoted = formatQuotedList(missingResearch);
      return {
        code: 'missing_research',
        reason: hasProtocolOnly ? `缺少前置协议${quoted}` : `缺少前置科技${quoted}`,
        impact: `当前无法在${baseLabel}对「${itemLabel}」执行${actionLabel}`,
        nextStep: hasProtocolOnly
          ? `请先在协议厅激活${quoted}或完成对应前置科技研发`
          : `请先在科技厅完成${quoted}研发（或激活等效协议）`,
        missingItems: [...missingResearch, ...missingBuildings, ...missingUnits],
      };
    }

    if (missingBuildings.length > 0) {
      // 检查是否是因为建筑虽已建成但处于停机/受损态导致 running 不满足
      const offlineBuilt = missingBuildings.filter(
        b =>
          input.completedBuildings !== undefined &&
          setHasEquivalentBuilding(input.completedBuildings, b) &&
          (input.runningBuildings === undefined || !setHasEquivalentBuilding(input.runningBuildings, b)),
      );
      if (offlineBuilt.length > 0 && offlineBuilt.length === missingBuildings.length) {
        const quotedOffline = formatQuotedList(offlineBuilt);
        return {
          code: 'facility_offline',
          reason: `前置设施${quotedOffline}当前处于停机或受损状态`,
          impact: `当前无法在${baseLabel}启动「${itemLabel}」的${actionLabel}`,
          nextStep: `请先恢复${baseLabel}内${quotedOffline}的电力供应或完成抢修并网`,
          missingItems: offlineBuilt,
        };
      }

      const quoted = formatQuotedList(missingBuildings);
      return {
        code: 'missing_building',
        reason: `缺少前置建筑${quoted}`,
        impact: `当前无法在${baseLabel}对「${itemLabel}」执行${actionLabel}`,
        nextStep: `请先在${baseLabel}完成${quoted}建造并投入运转`,
        missingItems: [...missingBuildings, ...missingUnits],
      };
    }

    if (missingUnits.length > 0) {
      const quoted = formatQuotedList(missingUnits);
      return {
        code: 'missing_unit',
        reason: `缺少前置实装单位${quoted}`,
        impact: `当前无法在${baseLabel}对「${itemLabel}」执行${actionLabel}`,
        nextStep: `请先在战区生产或部署至少 1 单位${quoted}`,
        missingItems: [...missingUnits],
      };
    }

    return {
      code: input.kind === '建造' ? 'missing_building' : 'missing_research',
      reason: `「${itemLabel}」前置条件尚未满足`,
      impact: `当前无法在${baseLabel}对「${itemLabel}」执行${actionLabel}`,
      nextStep: `请先核查${baseLabel}的前置建筑与科技条件`,
      missingItems: [itemLabel],
    };
  }

  // 4. 显式传入的设施停机/受损
  if (input.facilityOfflineNames && input.facilityOfflineNames.length > 0) {
    const offlineList = input.facilityOfflineNames.map(cleanText).filter(Boolean);
    if (offlineList.length > 0) {
      const quoted = formatQuotedList(offlineList);
      return {
        code: 'facility_offline',
        reason: `关键产线设施${quoted}当前处于停机或受损状态`,
        impact: `「${itemLabel}」所属产线产能归零，无法在${baseLabel}推进${actionLabel}`,
        nextStep: `请先恢复${baseLabel}内${quoted}的供电或将其切回生产模式`,
        missingItems: offlineList,
      };
    }
  }

  // 5. 产线未开通（lane_locked）
  if (input.lane?.locked) {
    const laneTitle = cleanText(input.lane.displayName) || '目标产线';
    const anchorName = extractAnchorFromLockedReason(input.lane.lockedReason);
    const missingItems = anchorName ? [anchorName] : [laneTitle];
    const reasonText = anchorName
      ? `产线「${laneTitle}」未开通（缺少在场运转的「${anchorName}」）`
      : `产线「${laneTitle}」未开通`;
    const nextStepText = anchorName
      ? `请先在${baseLabel}建造并运转「${anchorName}」（或将加速态建筑切回生产模式）`
      : `请先在${baseLabel}建成并运转「${laneTitle}」锚定设施`;

    return {
      code: 'lane_locked',
      reason: reasonText,
      impact: `当前无法在${baseLabel}通过「${laneTitle}」对「${itemLabel}」执行${actionLabel}`,
      nextStep: nextStepText,
      missingItems,
    };
  }

  // 6. 资金不足（insufficient_credits）
  if (
    typeof input.unitCost === 'number' &&
    Number.isFinite(input.unitCost) &&
    typeof input.credits === 'number' &&
    Number.isFinite(input.credits) &&
    input.unitCost > input.credits
  ) {
    const deficit = Math.max(1, Math.ceil(input.unitCost - input.credits));
    return {
      code: 'insufficient_credits',
      reason: `可用资金不足（单价 ${input.unitCost}，当前可用 ${input.credits}，尚缺 ${deficit}）`,
      impact: `当前无法在${baseLabel}全额拨付「${itemLabel}」的${actionLabel}经费`,
      nextStep: `请等待资金链日结入账至少 ${deficit} 资金，或暂缓低优先级支出后再行立项`,
      missingItems: [],
    };
  }

  // 7. 工位满载需排队（lane_occupied —— 仍允许 canProduceNow: true 入队候列）
  if (
    input.lane &&
    !input.lane.locked &&
    input.lane.capacity > 0 &&
    typeof input.activeInLaneCount === 'number' &&
    input.activeInLaneCount >= input.lane.capacity
  ) {
    const laneTitle = cleanText(input.lane.displayName) || '当前产线';
    return {
      code: 'lane_occupied',
      reason: `「${laneTitle}」并发工位已满（在制 ${input.activeInLaneCount}/${input.lane.capacity}）`,
      impact: `「${itemLabel}」可立即入队立项，但需等待${baseLabel}前序在制任务释放工位后方可推进工时`,
      nextStep: `可直接下达排产指令进入候列，或使用置顶/暂缓指令调整「${laneTitle}」优先级`,
      missingItems: [],
    };
  }

  return undefined;
}

/* ═══════════════ 零剧透与阵营/层级推导辅助 ═══════════════ */

const KNOWN_FACTION_NAMES = ['盟军', '苏联', '尤里'] as const;
const COMMON_FACTION_MARKERS = new Set(['common', '通用', 'neutral', '中立', 'all', '公共', 'general']);

function normalizeFactionKey(raw: unknown): string | undefined {
  const text = cleanText(raw);
  if (!text) return undefined;
  if (COMMON_FACTION_MARKERS.has(text.toLowerCase())) return undefined;
  return normalizeFactionId(text) || text.toLowerCase();
}

function inferItemFaction(
  entry: BuildingDef | ProductionDef,
  factionDefs: readonly FactionDef[],
): string | undefined {
  const rawRecord = entry as unknown as Record<string, unknown>;
  const rawScope = cleanText(rawRecord.scope).toLowerCase();
  if (rawScope === 'common') {
    return undefined;
  }

  const rawFactionText = cleanText(rawRecord.faction);
  if (rawFactionText) {
    return normalizeFactionKey(rawFactionText);
  }

  const rawId = cleanText(rawRecord.id).toLowerCase();
  if (rawId.startsWith('common.') || rawId.startsWith('bld.common.') || rawId.startsWith('unit.common.')) {
    return undefined;
  }
  if (rawId.startsWith('sov.') || rawId.startsWith('soviet.') || rawId.startsWith('bld.soviet.') || rawId.startsWith('unit.soviet.')) {
    return 'soviet';
  }
  if (rawId.startsWith('all.') || rawId.startsWith('ally.') || rawId.startsWith('allied.') || rawId.startsWith('bld.allied.') || rawId.startsWith('unit.allied.')) {
    return 'allied';
  }
  if (rawId.startsWith('yuri.') || rawId.startsWith('bld.yuri.') || rawId.startsWith('unit.yuri.')) {
    return 'yuri';
  }

  // 检查 tags 是否声明了阵营（含「苏联特色」「盟军特色」「尤里特色」）
  if (Array.isArray(entry.tags)) {
    for (const tag of entry.tags) {
      const t = cleanText(tag);
      if (!t) continue;
      if (COMMON_FACTION_MARKERS.has(t.toLowerCase())) {
        return undefined;
      }
      for (const fName of KNOWN_FACTION_NAMES) {
        if (t === fName || t === `${fName}特色` || t === `${fName}专属`) {
          return normalizeFactionKey(fName);
        }
      }
      for (const def of factionDefs) {
        const defFaction = cleanText(def.faction);
        if (defFaction && (t === defFaction || t === `${defFaction}特色`)) {
          return normalizeFactionKey(defFaction);
        }
      }
    }
  }

  // 检查名称或前置建筑是否带明确阵营前缀或阵营专属母体
  const knownFactions = new Set<string>([
    ...KNOWN_FACTION_NAMES,
    ...factionDefs.map(d => cleanText(d.faction)).filter(Boolean),
  ]);

  for (const faction of knownFactions) {
    if (faction && entry.name.startsWith(faction)) {
      return normalizeFactionKey(faction);
    }
  }

  const rawNeedBuilding = cleanText((entry as { need_building?: unknown }).need_building);
  const allNeedBuildings = [
    ...(entry.need_buildings ?? []),
    ...(rawNeedBuilding ? rawNeedBuilding.split(/[+＋]/) : []),
  ]
    .map(cleanText)
    .filter(Boolean);

  for (const bName of allNeedBuildings) {
    if (
      bName.startsWith('尤里') ||
      bName === '高能厌氧生化反应炉' ||
      bName === '神经航空引导盘' ||
      bName === '基因测序与心灵谐振研究院' ||
      bName === '双螺旋生命工程与高维意识科学院' ||
      bName === '心灵感应器'
    ) {
      return 'yuri';
    }
    if (
      bName.startsWith('苏联') ||
      bName.startsWith('苏维埃') ||
      bName === '红星实验设计局综合体' ||
      bName === '红星实验设计局' ||
      bName === '国家战略工程综合体' ||
      bName === '红星科学城'
    ) {
      return 'soviet';
    }
    if (bName.startsWith('盟军')) {
      return 'allied';
    }
    for (const def of factionDefs) {
      const fName = cleanText(def.faction);
      if (!fName) continue;
      if (bName === def.mcv || bName === def.lab || bName === `${fName}建造厂` || bName.startsWith(fName)) {
        return normalizeFactionKey(fName);
      }
    }
  }

  return undefined;
}

function inferItemTier(entry: BuildingDef | ProductionDef, catalog: EffectiveCatalog): number | undefined {
  const rawRecord = entry as unknown as Record<string, unknown>;
  if (typeof rawRecord.tier === 'number' && Number.isFinite(rawRecord.tier)) {
    return rawRecord.tier;
  }

  const needBuildings = entry.need_buildings ?? [];
  if (needBuildings.some(b => b.includes('战斗实验室') || b.includes('作战实验室') || b.includes('设计局'))) {
    return 2;
  }

  const prereqNames = entry.prereqs ?? [];
  if (prereqNames.length > 0 && Array.isArray(catalog.researches)) {
    let maxTier = 1;
    for (const pName of prereqNames) {
      const found = catalog.researches.find(r => r.name === pName);
      if (found && typeof found.tier === 'number' && found.tier > maxTier) {
        maxTier = found.tier;
      }
    }
    return maxTier;
  }

  return 1;
}

function inferItemCategory(kind: '生产' | '建造', laneName: string, entry: BuildingDef | ProductionDef): string {
  const rawRecord = entry as unknown as Record<string, unknown>;
  const explicitCategory = cleanText(rawRecord.category);
  if (explicitCategory) return explicitCategory;
  if (laneName) return laneName;
  return kind === '建造' ? '基地建筑' : '军备生产';
}

/**
 * 推导当前已解锁/可感知的阵营集合（零剧透铁律 + 单一事实源并集）：
 * 1. 合并 state.command?.unlocked_factions 与 state.command?.primary_faction；
 * 2. 同时合并当前在场建筑（MCV/实验室/阵营专属建筑）与已掌握科技/协议推导出的阵营，
 *    防止 Schema 默认 unlocked_factions=['allied'] 时误锁已在场的苏联/尤里基地；
 * 3. 若完全无阵营特征，则不主动过滤通用无阵营条目，但过滤带未接触阵营专属标签的条目。
 */
function resolveUnlockedFactions(
  state: StatData,
  catalog: EffectiveCatalog,
  completedTechAndProtocols: ReadonlySet<string>,
): ReadonlySet<string> | null {
  const derived = new Set<string>();
  const rawCommand = (state as unknown as Record<string, unknown>).command;
  if (rawCommand && typeof rawCommand === 'object' && !Array.isArray(rawCommand)) {
    const cmdObj = rawCommand as Record<string, unknown>;
    const unlockedRaw = cmdObj.unlocked_factions;
    if (Array.isArray(unlockedRaw)) {
      for (const item of unlockedRaw) {
        const norm = normalizeFactionKey(item);
        if (norm) derived.add(norm);
      }
    }
    const primaryRaw = normalizeFactionKey(cmdObj.primary_faction);
    if (primaryRaw) {
      derived.add(primaryRaw);
    }
  }

  const factionDefs = catalog.factionDefs ?? [];
  const allBuildings = (state.bases ?? []).flatMap(b => b.buildings ?? []);

  for (const b of allBuildings) {
    const bName = cleanText(b.name);
    if (!bName) continue;
    if (
      bName.startsWith('尤里') ||
      bName === '高能厌氧生化反应炉' ||
      bName === '神经航空引导盘' ||
      bName === '基因测序与心灵谐振研究院' ||
      bName === '双螺旋生命工程与高维意识科学院' ||
      bName === '心灵感应器' ||
      bName === '奴隶矿场'
    ) {
      derived.add('yuri');
    } else if (
      bName.startsWith('苏联') ||
      bName.startsWith('苏维埃') ||
      bName === '磁能反应炉' ||
      bName === '红星实验设计局综合体' ||
      bName === '红星实验设计局' ||
      bName === '国家战略工程综合体' ||
      bName === '红星科学城'
    ) {
      derived.add('soviet');
    } else if (bName.startsWith('盟军')) {
      derived.add('allied');
    }
  }

  for (const def of factionDefs) {
    const fName = cleanText(def.faction);
    if (!fName) continue;
    const mcvNames = [def.mcv, `${fName}建造厂`, def.lab];
    if (allBuildings.some(b => mcvNames.includes(b.name) || b.name.startsWith(fName))) {
      const norm = normalizeFactionKey(fName);
      if (norm) derived.add(norm);
    }
  }

  // 若研究中有特定阵营特色线已完成，也视为该阵营已解锁
  for (const research of catalog.researches ?? []) {
    if (completedTechAndProtocols.has(research.name)) {
      const rFaction = normalizeFactionKey((research as unknown as { faction?: unknown }).faction);
      if (rFaction) derived.add(rFaction);
      for (const fName of KNOWN_FACTION_NAMES) {
        if (research.line.includes(fName)) {
          const norm = normalizeFactionKey(fName);
          if (norm) derived.add(norm);
        }
      }
    }
  }

  return derived.size > 0 ? derived : null;
}

/**
 * 零剧透门禁：判断条目是否对当前指挥官可见
 */
function isItemSpoilerSafe(
  entry: BuildingDef | ProductionDef,
  unlockedFactions: ReadonlySet<string> | null,
  factionDefs: readonly FactionDef[],
  completedTechAndProtocols: ReadonlySet<string>,
  codexNames: ReadonlySet<string>,
): boolean {
  const rawRecord = entry as unknown as Record<string, unknown>;

  // 1. 显式未揭盲/隐藏标记检查
  const isExplicitlyHidden =
    rawRecord.hidden === true ||
    rawRecord.blind === true ||
    rawRecord.revealed === false ||
    rawRecord.spoiler === true ||
    (Array.isArray(entry.tags) &&
      entry.tags.some(t => t === 'hidden' || t === '隐藏' || t === '未揭盲' || t === 'blind'));

  if (isExplicitlyHidden) {
    if (!completedTechAndProtocols.has(entry.name) && !codexNames.has(entry.name)) {
      return false;
    }
  }

  // 2. 阵营解锁门禁检查
  const itemFaction = inferItemFaction(entry, factionDefs);
  if (itemFaction && unlockedFactions !== null) {
    if (!unlockedFactions.has(itemFaction)) {
      return false;
    }
  }

  return true;
}

/* ═══════════════ 2. 排产上下文生成纯函数 ═══════════════ */

/**
 * 构建指定基地的排产上下文快照（PLAN-CTX-01）
 */
export function buildPlanningContext(
  state: StatData,
  catalog: EffectiveCatalog,
  options?: BuildPlanningContextOptions,
): PlanningBaseContext | null {
  const bases = state.bases ?? [];
  if (bases.length === 0) return null;

  const runtimeBases: RuntimeBaseLike[] = bases.map(b => {
    const bId = cleanText(b.id) || cleanText(b.name);
    const bName = cleanText(b.name) || bId;
    const bldList = (b.buildings ?? []).map(bld => ({
      name: cleanText(bld.name),
      state: cleanText(bld.state) || '运转',
    }));
    const existingNames = new Set(bldList.map(bld => bld.name));
    for (const q of state.queues ?? []) {
      if (q.type !== '建造' || q.status === 'done' || q.status === 'cancelled') continue;
      const qItem = cleanText(q.item);
      if (!qItem || existingNames.has(qItem)) continue;
      const qBase = cleanText(q.base);
      const belongsToBase =
        (!qBase && bases.length === 1) ||
        qBase === bId ||
        qBase === bName;
      if (belongsToBase) {
        bldList.push({ name: qItem, state: '建造中' });
        existingNames.add(qItem);
      }
    }
    return {
      id: bId,
      name: bName,
      buildings: bldList,
    };
  });

  // 1. 解析目标基地（未传 targetBaseRef 时默认取首个非 '废弃' 基地）
  let targetBase = bases[0];
  if (cleanText(options?.targetBaseRef)) {
    const resolved = resolveBaseReference(runtimeBases, options!.targetBaseRef);
    if (resolved.status !== 'resolved') {
      return null;
    }
    const found = bases.find(b => (cleanText(b.id) || cleanText(b.name)) === resolved.baseId);
    if (!found || cleanText(found.status) === '废弃') {
      return null;
    }
    targetBase = found;
  } else {
    const activeBase = bases.find(b => cleanText(b.status) !== '废弃');
    if (!activeBase) {
      return null;
    }
    targetBase = activeBase;
  }

  const baseId = cleanText(targetBase.id) || cleanText(targetBase.name);
  const baseName = cleanText(targetBase.name) || baseId;
  const baseState = cleanText(targetBase.status) || '隐蔽中';

  // 2. 复用同源纯函数构建前置上下文与完成科技/协议并集
  const protocolsInput = (state.protocols ?? undefined) as RuntimeProtocolsInput;
  const completedTechAndProtocols = buildCompletedTechAndProtocolSet(state.tech?.done ?? [], protocolsInput);

  const prereqContext = buildCatalogPrerequisiteContext({
    bases: runtimeBases,
    selectedBaseId: baseId,
    techDone: state.tech?.done ?? [],
    forces: {
      troops: state.forces?.troops ?? {},
      vehicles: state.forces?.vehicles ?? [],
    },
    protocols: protocolsInput,
  });
  if (!prereqContext) return null;

  // 补充协议目录供 evaluatePrerequisite 双向解析协议 ID ↔ 名称
  const enrichedPrereqContext = {
    ...prereqContext,
    protocols: catalog.protocols ?? [],
    catalog: {
      protocols: catalog.protocols ?? [],
    },
  };

  // 3. 复用 ProductionLaneProvider 获取当前基地产线视图
  const laneProvider = new ProductionLaneProvider();
  const laneEnv: LaneResolveEnv = {
    bases: bases.map(b => ({
      id: cleanText(b.id) || cleanText(b.name),
      name: cleanText(b.name) || cleanText(b.id),
      status: cleanText(b.status),
      buildings: (b.buildings ?? []).map(bld => ({
        name: cleanText(bld.name),
        state: cleanText(bld.state),
        mode: bld.mode,
      })),
    })),
    queues: (state.queues ?? []) as unknown as ReadonlyArray<TransactionItem>,
    catalog,
  };

  const allLanes = laneProvider.resolveLanes(laneEnv);
  const baseLanes = allLanes.filter(l => l.baseId === baseId);
  const laneByKey = new Map<string, LaneStationView>();
  for (const lane of baseLanes) {
    laneByKey.set(lane.laneKey, lane);
  }
  const defaultLaneView = laneByKey.get(`${baseId} lane.default`);

  // 4. 统计当前基地可見队列与各产线在制负载
  const activeQueueSummary: PlanningBaseContext['activeQueueSummary'] = [];
  const activeInLaneCounts = new Map<string, number>();

  for (const q of state.queues ?? []) {
    if (q.status === 'done' || q.status === 'cancelled') continue;
    if (q.type !== '研究' && !isQueueVisibleForBase(q, baseId, runtimeBases)) {
      continue;
    }
    activeQueueSummary.push({
      item: q.item,
      type: q.type,
      status: q.status ?? 'active',
      qty: q.qty ?? 1,
      spentMinutes: q.spent_minutes ?? 0,
      totalMinutes: q.total_minutes ?? 0,
      ...(q.hold ? { hold: true } : {}),
    });

    if ((q.type === '生产' || q.type === '建造' || q.type === '改装') && q.status === 'active' && !q.hold) {
      const txnForKey = {
        type: q.type,
        item: q.item,
        base: baseId,
        ...(q.lane ? { lane: q.lane } : {}),
      } as unknown as TransactionItem;
      const rawKey = laneProvider.resolveTaskLaneKey(txnForKey, laneEnv);
      const matchedLane = laneByKey.get(rawKey) ?? defaultLaneView;
      const canonicalKey = matchedLane?.laneKey ?? rawKey;
      activeInLaneCounts.set(canonicalKey, (activeInLaneCounts.get(canonicalKey) ?? 0) + 1);
    }
  }

  // 5. 计算资金与日净收益
  const credits = typeof state.economy?.credits === 'number' && Number.isFinite(state.economy.credits)
    ? state.economy.credits
    : 0;
  const chains = state.economy?.chains ?? [];
  const dailyNetCredits =
    chains.length > 0
      ? calcDailyNet(chains)
      : typeof state.economy?.credits_daily === 'number' && Number.isFinite(state.economy.credits_daily)
        ? state.economy.credits_daily
        : 0;

  // 6. 零剧透门禁上下文
  const factionDefs = catalog.factionDefs ?? [];
  const unlockedFactions = resolveUnlockedFactions(state, catalog, completedTechAndProtocols);
  const codexNames = new Set((state.codex ?? []).map(c => cleanText(c.name)).filter(Boolean));
  const baseBuildingState = prereqContext.bases.get(baseId);

  const produceableItems: PlanningCandidateItem[] = [];
  const nearUnlockItems: PlanningCandidateItem[] = [];
  const blockedCatalogItems: PlanningCandidateItem[] = [];

  const evaluateCatalogPool = (
    pool: readonly (BuildingDef | ProductionDef)[],
    kind: '生产' | '建造',
  ) => {
    const buildingReqState = kind === '生产' ? 'running' : 'existing';

    for (const entry of pool) {
      if (
        !isItemSpoilerSafe(entry, unlockedFactions, factionDefs, completedTechAndProtocols, codexNames)
      ) {
        continue;
      }

      const rawRecord = entry as unknown as Record<string, unknown>;
      const id = cleanText(rawRecord.id) || cleanText(entry.name);
      const name = cleanText(entry.name);
      if (!name) continue;

      if (kind === '生产') {
        const maxCount = typeof rawRecord.max_count === 'number' && rawRecord.max_count > 0 ? rawRecord.max_count : null;
        if (maxCount !== null) {
          const aliases = Array.isArray(rawRecord.aliases)
            ? rawRecord.aliases.map(cleanText).filter(Boolean)
            : [];
          const candidateNames = new Set<string>([name, ...aliases]);
          let ownedCount = 0;
          for (const [k, cnt] of Object.entries(state.forces?.troops ?? {})) {
            if (candidateNames.has(cleanText(k)) && typeof cnt === 'number' && cnt > 0) {
              ownedCount += cnt;
            }
          }
          for (const v of state.forces?.vehicles ?? []) {
            if (candidateNames.has(cleanText(v))) ownedCount += 1;
          }
          let girlCount = 0;
          for (const g of state.forces?.girls ?? []) {
            if (candidateNames.has(cleanText(g.name)) || candidateNames.has(cleanText(g.model))) {
              girlCount += 1;
            }
          }
          let queuedCount = 0;
          for (const q of state.queues ?? []) {
            if (q.status === 'done' || q.status === 'cancelled') continue;
            if (q.type === '生产' && candidateNames.has(cleanText(q.item))) {
              queuedCount += Math.max(1, (q.qty ?? 1) - (q.qty_done ?? 0));
            }
          }
          if (Math.max(ownedCount, girlCount) + queuedCount >= maxCount) {
            continue;
          }
        }
      }

      const unitCost = typeof entry.cost === 'number' && Number.isFinite(entry.cost) ? entry.cost : 0;
      const durationInfo = durationFromEntry(entry);
      const unitMinutes = durationInfo ? Math.round(durationInfo.totalMinutes) : 1440;

      const syntheticTxn = {
        type: kind,
        item: name,
        base: baseId,
        ...(typeof entry.lane === 'string' && entry.lane.trim() ? { lane: entry.lane.trim() } : {}),
      } as unknown as TransactionItem;

      const rawLaneKey = laneProvider.resolveTaskLaneKey(syntheticTxn, laneEnv);
      const laneView = laneByKey.get(rawLaneKey) ?? defaultLaneView;
      const laneKey = laneView?.laneKey ?? rawLaneKey;
      const laneName = laneView?.displayName ?? (kind === '建造' ? '其他建筑建造线' : '默认生产序列');

      const hasExplicitNeedBuildings =
        (Array.isArray(entry.need_buildings) && entry.need_buildings.some(b => cleanText(b).length > 0)) ||
        cleanText((entry as { need_building?: unknown }).need_building).length > 0;
      const inferredMother =
        kind === '生产' && !hasExplicitNeedBuildings
          ? inferDefaultProductionMotherBuilding(
              name,
              cleanText((entry as { category?: unknown }).category),
            )
          : undefined;
      const normalizedEntryForPrereq =
        inferredMother
          ? { ...entry, need_buildings: [inferredMother] }
          : kind === '建造' && !hasExplicitNeedBuildings && !ROOT_CONYARD_BUILDINGS.has(name)
            ? { ...entry, need_buildings: ['建造厂核心'] }
            : entry;

      const combinedCondition = combineLegacyPrerequisites(normalizedEntryForPrereq, buildingReqState);
      const prereqEval = evaluatePrerequisite(combinedCondition, enrichedPrereqContext);

      const faction = inferItemFaction(entry, factionDefs);
      const tier = inferItemTier(entry, catalog);
      const category = inferItemCategory(kind, laneName, entry);
      const activeInLaneCount = activeInLaneCounts.get(laneKey) ?? 0;

      if (prereqEval.satisfied && !laneView?.locked) {
        const blocker = classifyPlanningBlocker({
          itemName: name,
          kind,
          baseName,
          baseState,
          prerequisiteEval: prereqEval,
          lane: laneView,
          activeInLaneCount,
          completedBuildings: baseBuildingState?.completed,
          runningBuildings: baseBuildingState?.running,
          unitCost,
          credits,
        });

        if (blocker && blocker.code === 'insufficient_credits') {
          const creditBlockedItem: PlanningCandidateItem = {
            id,
            name,
            kind,
            category,
            ...(faction ? { faction } : {}),
            ...(tier !== undefined ? { tier } : {}),
            unitCost,
            unitMinutes,
            laneKey,
            laneName,
            canProduceNow: false,
            blocked: blocker,
          };
          nearUnlockItems.push(creditBlockedItem);
          blockedCatalogItems.push(creditBlockedItem);
        } else {
          produceableItems.push({
            id,
            name,
            kind,
            category,
            ...(faction ? { faction } : {}),
            ...(tier !== undefined ? { tier } : {}),
            unitCost,
            unitMinutes,
            laneKey,
            laneName,
            canProduceNow: true,
            ...(blocker ? { blocked: blocker } : {}),
          });
        }
        continue;
      }

      // 判定是否属于 nearUnlockItems（仅差 1~2 个前置，或前置已满足仅产线未开通）
      const blocker = classifyPlanningBlocker({
        itemName: name,
        kind,
        baseName,
        baseState,
        prerequisiteEval: prereqEval,
        lane: laneView,
        activeInLaneCount,
        completedBuildings: baseBuildingState?.completed,
        runningBuildings: baseBuildingState?.running,
        unitCost,
        credits,
      });

      if (blocker) {
        const blockedCandidate: PlanningCandidateItem = {
          id,
          name,
          kind,
          category,
          ...(faction ? { faction } : {}),
          ...(tier !== undefined ? { tier } : {}),
          unitCost,
          unitMinutes,
          laneKey,
          laneName,
          canProduceNow: false,
          blocked: blocker,
        };
        blockedCatalogItems.push(blockedCandidate);

        const missingCount = blocker.missingItems.length;
        const isNearUnlock =
          (prereqEval.satisfied && Boolean(laneView?.locked)) ||
          (missingCount >= 1 && missingCount <= 2);

        if (isNearUnlock) {
          nearUnlockItems.push(blockedCandidate);
        }
      }
    }
  };

  evaluateCatalogPool(catalog.productions ?? [], '生产');
  evaluateCatalogPool(catalog.buildings ?? [], '建造');

  const maxCandidates =
    typeof options?.maxCandidates === 'number' && options.maxCandidates > 0
      ? Math.floor(options.maxCandidates)
      : undefined;

  const finalProduceable = maxCandidates ? produceableItems.slice(0, maxCandidates) : produceableItems;
  const finalNearUnlock = maxCandidates ? nearUnlockItems.slice(0, maxCandidates) : nearUnlockItems;

  const protectedSet = new Set<string>();
  for (const ref of state.planning?.protected_task_refs ?? []) {
    const cleaned = cleanText(ref);
    if (cleaned) protectedSet.add(cleaned);
  }
  for (const ref of options?.protectedTaskRefs ?? []) {
    const cleaned = cleanText(ref);
    if (cleaned) protectedSet.add(cleaned);
  }

  return {
    baseId,
    baseName,
    baseState,
    credits,
    dailyNetCredits,
    lanes: baseLanes,
    produceableItems: finalProduceable,
    nearUnlockItems: finalNearUnlock,
    blockedCatalogItems,
    protectedTaskRefs: [...protectedSet],
    activeQueueSummary,
  };
}

/* ═══════════════ 3. 参谋提示词条令体格式化纯函数 ═══════════════ */

/**
 * 生成紧凑条令体文本摘要（供参谋提示词消费）
 */
export function formatPlanningContextPrompt(ctx: PlanningBaseContext): string {
  const lines: string[] = [];
  const netSign = ctx.dailyNetCredits >= 0 ? `+${ctx.dailyNetCredits}` : `${ctx.dailyNetCredits}`;

  lines.push(`【排产态势纪要 · ${ctx.baseName}（${ctx.baseId}｜${ctx.baseState}）】`);
  lines.push(`· 战区资金：现存 ${ctx.credits}｜日均净流 ${netSign}/日`);

  const openLanes = ctx.lanes.filter(l => !l.locked);
  const lockedLanes = ctx.lanes.filter(l => l.locked);
  const openSummary =
    openLanes.length > 0
      ? openLanes
          .map(l => `${l.displayName}(容量${l.capacity}${l.accelMultiplier > 1 ? `·加速${l.accelMultiplier}x` : ''})`)
          .join('、')
      : '无';
  lines.push(`· 已开通产线(${openLanes.length})：${openSummary}`);
  if (lockedLanes.length > 0) {
    lines.push(`· 未开通产线(${lockedLanes.length})：${lockedLanes.map(l => l.displayName).join('、')}`);
  }

  if (ctx.activeQueueSummary.length > 0) {
    const qText = ctx.activeQueueSummary
      .map(q => `${q.type}:${q.item}×${q.qty}[${q.hold ? '暂缓' : q.status} ${q.spentMinutes}/${q.totalMinutes}m]`)
      .join('；');
    lines.push(`· 在途队列(${ctx.activeQueueSummary.length})：${qText}`);
  } else {
    lines.push('· 在途队列(0)：当前无在途排产任务');
  }

  if (ctx.protectedTaskRefs.length > 0) {
    lines.push(`· 受保护任务锁：${ctx.protectedTaskRefs.join('、')}`);
  }

  if (ctx.produceableItems.length > 0) {
    const prodText = ctx.produceableItems
      .map(item => {
        const days = +(item.unitMinutes / 1440).toFixed(1);
        const note = item.blocked ? `（提示：${item.blocked.reason}）` : '';
        return `${item.name}[${item.kind}｜${item.laneName}｜造价${item.unitCost}｜约${days}日]${note}`;
      })
      .join('；');
    lines.push(`· 立即可排产候选(${ctx.produceableItems.length})：${prodText}`);
  } else {
    lines.push('· 立即可排产候选(0)：无');
  }

  if (ctx.nearUnlockItems.length > 0) {
    const nearText = ctx.nearUnlockItems
      .map(item => {
        const detail = item.blocked
          ? `${item.blocked.reason} → ${item.blocked.nextStep}`
          : '前置待完备';
        return `${item.name}[${item.kind}｜造价${item.unitCost}｜阻因：${detail}]`;
      })
      .join('；');
    lines.push(`· 临近解锁/暂阻候选(${ctx.nearUnlockItems.length})：${nearText}`);
  }

  return lines.join('\n');
}
