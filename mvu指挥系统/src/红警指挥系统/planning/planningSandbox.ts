/**
 * planningSandbox.ts —— 排产沙盒试排纯函数（PLAN-SANDBOX-01）
 *
 * 设计契约与红线：
 * 1. 100% 零副作用纯函数：使用 klona 深拷贝入参 state，绝不原地修改入参 state；
 * 2. 复用 buildPlanningContext 执行基地解析、前置校验、零剧透过滤与阻塞三段式诊断；
 * 3. 复用 applyDispatchOrders 在沙盒副本上演练队列调序（promote/demote/hold/resume）；
 * 4. 严格执行同楼旧队列冲突门、幂等指纹门、快照过期门、指挥官保护锁与预算上限门。
 */

import { klona } from 'klona';
import type { ResearchDef } from '../core/catalog';
import type { EffectiveCatalog } from '../core/catalogEffective';
import {
  buildEntityCredibilityIndex,
  canonEntityKey,
  evaluateEntityCredibility,
  type EntityCredibilityIndex,
  type EntityDomain,
} from '../core/entityCredibility';
import {
  buildCatalogPrerequisiteContext,
  resolveBaseReference,
  type RuntimeBaseLike,
  type RuntimeProtocolsInput,
} from '../core/catalogRuntimeContext';
import {
  combineLegacyPrerequisites,
  evaluatePrerequisite,
  BUILDING_EQUIVALENTS,
  resolveUnitEquivalentCandidates,
  ROOT_CONYARD_BUILDINGS,
  setHasEquivalentBuilding,
  stripFactionBuildingPrefix,
} from '../core/prerequisites';
import { BUILTIN_BUILDING_UPGRADE_SPECS } from '../engines/productionReconciliation';
import { createLaneRegistryHub } from '../engines/laneProviders';
import { durationFromEntry } from '../engines/settleFloor';
import {
  buildPlanningContext,
  classifyPlanningBlocker,
  type PlanningCandidateItem,
} from './planningContext';
import type { ParsedPlanningIntent, PlanningActionOp } from './planningParser';
import type {
  PlanningReceipt,
  PlanningReceiptActionResult,
  PlanningReceiptDiffSummary,
  PlanningReceiptStatus,
  StatData,
} from '../core/schema';
import { applyDispatchOrders, type DispatchVerb, type TransactionItem } from '../engines/transactionEngine';

export interface PlanningSandboxOptions {
  currentSnapshotRef?: string;
}

export interface PlanningSandboxResult {
  receipt: PlanningReceipt;
  sandboxState: StatData;
  canCommit: boolean;
  alreadyCommitted: boolean;
}

const EMPTY_CATALOG: EffectiveCatalog = {
  buildings: [],
  productions: [],
  researches: [],
  retrofits: [],
  projects: [],
  protocols: [],
  girls: [],
  factionDefs: [],
} as unknown as EffectiveCatalog;

function cleanText(val: unknown): string {
  return typeof val === 'string' ? val.trim() : '';
}

function createEmptyDiffSummary(): PlanningReceiptDiffSummary {
  return {
    added: [],
    promoted: [],
    demoted: [],
    held: [],
    resumed: [],
  };
}

/**
 * 同步并读取沙盒资金（兼容 Schema 标准 state.economy.credits 与测试夹具 state.resources.credits）
 */
function normalizeSandboxCredits(sandboxState: StatData): void {
  const anyState = sandboxState as unknown as Record<string, unknown>;
  const resourcesObj =
    anyState.resources && typeof anyState.resources === 'object' && !Array.isArray(anyState.resources)
      ? (anyState.resources as Record<string, unknown>)
      : null;
  const resourceCredits =
    resourcesObj && typeof resourcesObj.credits === 'number' && Number.isFinite(resourcesObj.credits)
      ? resourcesObj.credits
      : undefined;

  if (!sandboxState.economy || typeof sandboxState.economy !== 'object') {
    (sandboxState as unknown as Record<string, unknown>).economy = {
      credits: resourceCredits ?? 0,
      credits_daily: 0,
      wallet: {},
      chains: [],
    };
    return;
  }

  const econCredits =
    typeof sandboxState.economy.credits === 'number' && Number.isFinite(sandboxState.economy.credits)
      ? sandboxState.economy.credits
      : undefined;

  if (econCredits === undefined && resourceCredits !== undefined) {
    sandboxState.economy.credits = resourceCredits;
  } else if (econCredits === 0 && resourceCredits !== undefined && resourceCredits > 0) {
    sandboxState.economy.credits = resourceCredits;
  } else if (econCredits !== undefined && resourcesObj && typeof resourcesObj.credits === 'number' && resourcesObj.credits === 0 && econCredits > 0) {
    resourcesObj.credits = econCredits;
  }
}

function getSandboxCredits(sandboxState: StatData): number {
  const anyState = sandboxState as unknown as Record<string, unknown>;
  const resourcesObj =
    anyState.resources && typeof anyState.resources === 'object' && !Array.isArray(anyState.resources)
      ? (anyState.resources as Record<string, unknown>)
      : null;
  if (typeof sandboxState.economy?.credits === 'number' && Number.isFinite(sandboxState.economy.credits)) {
    return sandboxState.economy.credits;
  }
  if (resourcesObj && typeof resourcesObj.credits === 'number' && Number.isFinite(resourcesObj.credits)) {
    return resourcesObj.credits;
  }
  return 0;
}

function deductSandboxCredits(sandboxState: StatData, cost: number): void {
  const current = getSandboxCredits(sandboxState);
  const nextCredits = Math.max(0, current - cost);
  if (sandboxState.economy && typeof sandboxState.economy === 'object') {
    sandboxState.economy.credits = nextCredits;
  }
  const anyState = sandboxState as unknown as Record<string, unknown>;
  if (anyState.resources && typeof anyState.resources === 'object' && !Array.isArray(anyState.resources)) {
    const res = anyState.resources as Record<string, unknown>;
    if (typeof res.credits === 'number') {
      res.credits = nextCredits;
    }
  }
}

function toRuntimeBases(state: StatData): RuntimeBaseLike[] {
  return (state.bases ?? []).map(b => ({
    id: cleanText(b.id) || cleanText(b.name),
    name: cleanText(b.name) || cleanText(b.id),
    buildings: (b.buildings ?? []).map(bld => ({
      name: cleanText(bld.name),
      state: cleanText(bld.state) || '运转',
    })),
  }));
}

function diagnoseBaseFailure(
  state: StatData,
  targetBaseRef?: string,
): { code: 'base_not_found' | 'base_retired'; baseId: string; reason: string; nextStep: string } {
  const bases = state.bases ?? [];
  const ref = cleanText(targetBaseRef);
  if (bases.length === 0) {
    return {
      code: 'base_not_found',
      baseId: ref,
      reason: ref ? `未找到目标基地「${ref}」` : '当前没有任何在册基地',
      nextStep: '请先核对基地编号或展开基地车建立据点',
    };
  }

  const runtimeBases = toRuntimeBases(state);
  if (ref) {
    const resolved = resolveBaseReference(runtimeBases, ref);
    if (resolved.status !== 'resolved') {
      return {
        code: 'base_not_found',
        baseId: ref,
        reason: `未找到目标基地「${ref}」`,
        nextStep: '请核对基地编号或名称后再下达排产指令',
      };
    }
    const found = bases.find(b => (cleanText(b.id) || cleanText(b.name)) === resolved.baseId);
    if (!found) {
      return {
        code: 'base_not_found',
        baseId: ref,
        reason: `未找到目标基地「${ref}」`,
        nextStep: '请核对基地编号或名称后再下达排产指令',
      };
    }
    if (cleanText(found.status) === '废弃') {
      const label = cleanText(found.name) || cleanText(found.id) || ref;
      return {
        code: 'base_retired',
        baseId: cleanText(found.id) || ref,
        reason: `目标基地「${label}」已处于废弃状态，无法排产`,
        nextStep: '请改派至其他在役基地执行排产',
      };
    }
  }

  const hasActiveBase = bases.some(b => cleanText(b.status) !== '废弃');
  if (!hasActiveBase) {
    const first = bases[0];
    const label = cleanText(first?.name) || cleanText(first?.id) || '默认基地';
    return {
      code: 'base_retired',
      baseId: cleanText(first?.id) || '',
      reason: `基地「${label}」已处于废弃状态，当前无可用在役基地`,
      nextStep: '请改派至其他在役基地或先建立新据点',
    };
  }

  return {
    code: 'base_not_found',
    baseId: ref,
    reason: ref ? `未找到目标基地「${ref}」` : '无法解析目标基地上下文',
    nextStep: '请核对基地编号或名称后再下达排产指令',
  };
}

function findCandidate(
  items: readonly PlanningCandidateItem[],
  ref: string,
  kind?: string,
  credibilityIndex?: EntityCredibilityIndex | null,
): PlanningCandidateItem | undefined {
  const target = cleanText(ref);
  if (!target) return undefined;
  const targetCanon = canonEntityKey(target);
  const normalizedKind = kind === '生产' || kind === '建造' ? kind : undefined;

  const matchItem = (item: PlanningCandidateItem, nameOrId: string, canonKey: string): boolean => {
    const id = cleanText(item.id);
    const name = cleanText(item.name);
    return (
      id === nameOrId ||
      name === nameOrId ||
      (Boolean(canonKey) && (canonEntityKey(id) === canonKey || canonEntityKey(name) === canonKey))
    );
  };

  if (normalizedKind) {
    const exactWithKind = items.find(
      item => item.kind === normalizedKind && matchItem(item, target, targetCanon),
    );
    if (exactWithKind) return exactWithKind;
  }
  const exactAny = items.find(item => matchItem(item, target, targetCanon));
  if (exactAny) return exactAny;

  // 建筑同义词/阵营前缀等价对齐（与 settleFloorHelpers.findCatalogBuildingDef 同源）
  if (normalizedKind !== '生产') {
    const stripped = stripFactionBuildingPrefix(target);
    const eqCandidates = [
      ...(BUILDING_EQUIVALENTS[target] ?? []),
      ...(stripped && stripped !== target ? [stripped, ...(BUILDING_EQUIVALENTS[stripped] ?? [])] : []),
    ];
    for (const cand of eqCandidates) {
      const candCanon = canonEntityKey(cand);
      const hit = items.find(
        item => item.kind === '建造' && matchItem(item, cand, candCanon),
      );
      if (hit) return hit;
    }
    if (stripped.length >= 2) {
      const strippedCanon = canonEntityKey(stripped);
      const prefixHit = items.find(item => {
        if (item.kind !== '建造') return false;
        const itemStripped = stripFactionBuildingPrefix(cleanText(item.name));
        return itemStripped.length >= 2 && canonEntityKey(itemStripped) === strippedCanon;
      });
      if (prefixHit) return prefixHit;
    }
  }

  // 生产单位同义词/阵营前缀等价对齐（复用 UNIT_EQUIVALENT_GROUPS 单一事实源）
  if (normalizedKind !== '建造') {
    const unitCandidates = resolveUnitEquivalentCandidates(target);
    for (const cand of unitCandidates) {
      if (cand === target) continue;
      const candCanon = canonEntityKey(cand);
      const hit = items.find(
        item => item.kind === '生产' && matchItem(item, cand, candCanon),
      );
      if (hit) return hit;
    }
  }

  if (credibilityIndex) {
    const domain: EntityDomain =
      normalizedKind === '生产' ? 'production' : normalizedKind === '建造' ? 'building' : 'any';
    const cred = evaluateEntityCredibility(credibilityIndex, target, {
      domain,
      highThreshold: 0.80,
    });
    if (cred.verdict === 'system_high' && cred.matchedName) {
      const matchedCanon = canonEntityKey(cred.matchedName);
      if (normalizedKind) {
        const alignedWithKind = items.find(
          item => item.kind === normalizedKind && matchItem(item, cred.matchedName!, matchedCanon),
        );
        if (alignedWithKind) return alignedWithKind;
      }
      return items.find(item => matchItem(item, cred.matchedName!, matchedCanon));
    }
  }

  return undefined;
}

interface BuiltinFoundationBuildingFallback {
  canonicalName: string;
  aliases: readonly string[];
  unitCost: number;
  unitMinutes: number;
  needBuildings: readonly string[];
}

const BUILTIN_FOUNDATION_BUILDING_FALLBACKS: readonly BuiltinFoundationBuildingFallback[] = [
  {
    canonicalName: '矿石精炼厂',
    aliases: ['矿石精炼厂', '盟军矿石精炼厂', '苏联矿石精炼厂', '奴隶矿场', '尤里奴隶矿场', '精炼厂', '矿场', '采矿场'],
    unitCost: 2000,
    unitMinutes: 9360,
    needBuildings: ['发电厂'],
  },
  {
    canonicalName: '发电厂',
    aliases: ['发电厂', '盟军发电厂'],
    unitCost: 800,
    unitMinutes: 5040,
    needBuildings: [],
  },
  {
    canonicalName: '苏联磁能反应炉',
    aliases: ['苏联磁能反应炉', '磁能反应炉', '磁能反应堆', '苏联磁能反应堆'],
    unitCost: 600,
    unitMinutes: 3600,
    needBuildings: [],
  },
  {
    canonicalName: '高能厌氧生化反应炉',
    aliases: ['高能厌氧生化反应炉', '生化反应炉', '尤里生物反应炉', '尤里生化反应炉', '厌氧生化反应炉'],
    unitCost: 800,
    unitMinutes: 5040,
    needBuildings: [],
  },
  {
    canonicalName: '兵营',
    aliases: ['兵营', '盟军兵营', '苏联兵营'],
    unitCost: 500,
    unitMinutes: 3600,
    needBuildings: [],
  },
  {
    canonicalName: '尤里克隆与新兵训导营',
    aliases: ['尤里克隆与新兵训导营', '尤里兵营', '尤里训导营', '尤里新兵训导营'],
    unitCost: 500,
    unitMinutes: 3600,
    needBuildings: ['高能厌氧生化反应炉'],
  },
  {
    canonicalName: '超维暗网中继站',
    aliases: ['超维暗网中继站'],
    unitCost: 1200,
    unitMinutes: 7200,
    needBuildings: ['发电厂'],
  },
  {
    canonicalName: '盟军围墙',
    aliases: ['盟军围墙', '围墙', '苏联围墙', '反载具障碍带'],
    unitCost: 100,
    unitMinutes: 1440,
    needBuildings: [],
  },
  {
    canonicalName: '尤里复合生化护墙',
    aliases: ['尤里复合生化护墙', '尤里围墙', '尤里生化护墙', '生化护墙'],
    unitCost: 100,
    unitMinutes: 1440,
    needBuildings: [],
  },
  {
    canonicalName: '盟军碉堡',
    aliases: ['盟军碉堡', '机枪碉堡', '碉堡', '驻军碉堡'],
    unitCost: 500,
    unitMinutes: 3600,
    needBuildings: ['兵营'],
  },
  {
    canonicalName: '苏联战斗碉堡',
    aliases: ['苏联战斗碉堡', '战斗碉堡'],
    unitCost: 500,
    unitMinutes: 3600,
    needBuildings: ['兵营'],
  },
  {
    canonicalName: '苏联哨戒炮',
    aliases: ['苏联哨戒炮', '哨戒炮', '哨戒炮位'],
    unitCost: 500,
    unitMinutes: 3600,
    needBuildings: ['兵营'],
  },
  {
    canonicalName: '苏联高射炮',
    aliases: ['苏联高射炮', '高射炮', '高射炮防空阵地', '近程防空阵地'],
    unitCost: 1000,
    unitMinutes: 5040,
    needBuildings: ['兵营'],
  },
  {
    canonicalName: '爱国者防空阵地',
    aliases: ['爱国者防空阵地', '爱国者防空导弹阵地', '爱国者导弹'],
    unitCost: 1000,
    unitMinutes: 5040,
    needBuildings: ['兵营'],
  },
  {
    canonicalName: '盖特机炮塔',
    aliases: ['盖特机炮塔', '盖特机炮', '尤里盖特炮'],
    unitCost: 1000,
    unitMinutes: 5040,
    needBuildings: ['尤里克隆与新兵训导营'],
  },
  {
    canonicalName: '心灵感应器',
    aliases: ['心灵感应器', '尤里心灵感应器'],
    unitCost: 1000,
    unitMinutes: 5040,
    needBuildings: ['尤里克隆与新兵训导营'],
  },
  {
    canonicalName: '照明塔',
    aliases: ['照明塔'],
    unitCost: 100,
    unitMinutes: 1440,
    needBuildings: [],
  },
  {
    canonicalName: '通讯中继桩',
    aliases: ['通讯中继桩'],
    unitCost: 200,
    unitMinutes: 1440,
    needBuildings: ['兵营'],
  },
];

function resolveBuiltinFoundationBuildingCandidate(
  state: StatData,
  baseId: string,
  baseName: string,
  targetRef: string,
  rawActionKind: string,
  credits: number,
): PlanningCandidateItem | undefined {
  if (rawActionKind && rawActionKind !== '建造') return undefined;
  const target = cleanText(targetRef);
  if (!target) return undefined;
  const targetCanon = canonEntityKey(target);
  const spec = BUILTIN_FOUNDATION_BUILDING_FALLBACKS.find(item =>
    item.aliases.some(a => a === target || canonEntityKey(a) === targetCanon),
  );
  if (!spec) return undefined;

  const targetBase = (state.bases ?? []).find(
    b =>
      (cleanText(b.id) || cleanText(b.name)) === baseId ||
      canonEntityKey(cleanText(b.id)) === canonEntityKey(baseId) ||
      canonEntityKey(cleanText(b.name)) === canonEntityKey(baseId),
  );
  const existingSet = new Set<string>();
  const runningSet = new Set<string>();
  for (const bld of targetBase?.buildings ?? []) {
    const bName = cleanText(bld.name);
    if (!bName) continue;
    existingSet.add(bName);
    if ((cleanText(bld.state) || '运转') === '运转') {
      runningSet.add(bName);
    }
  }
  for (const q of state.queues ?? []) {
    if (q.type !== '建造' || q.status === 'done' || q.status === 'cancelled') continue;
    const qItem = cleanText(q.item);
    if (qItem) existingSet.add(qItem);
  }

  const hasConyard = [...ROOT_CONYARD_BUILDINGS].some(
    rootName => setHasEquivalentBuilding(runningSet, rootName) || setHasEquivalentBuilding(existingSet, rootName),
  );
  if (!hasConyard) {
    return {
      id: spec.canonicalName,
      name: target,
      kind: '建造',
      category: '基地建筑',
      unitCost: spec.unitCost,
      unitMinutes: spec.unitMinutes,
      laneKey: `${baseId} build.other`,
      laneName: '其他建筑线',
      canProduceNow: false,
      blocked: {
        code: 'lane_locked',
        reason: `产线「其他建筑线」未开通（缺少在场运转的「建造厂核心」）`,
        impact: `当前无法在${baseName}对「${target}」执行建造施工`,
        nextStep: `请先在${baseName}展开建造厂核心`,
        missingItems: ['建造厂核心'],
      },
    };
  }

  const missingBlds = spec.needBuildings.filter(req => !setHasEquivalentBuilding(existingSet, req));
  if (missingBlds.length > 0) {
    return {
      id: spec.canonicalName,
      name: target,
      kind: '建造',
      category: '基地建筑',
      unitCost: spec.unitCost,
      unitMinutes: spec.unitMinutes,
      laneKey: `${baseId} build.other`,
      laneName: '其他建筑线',
      canProduceNow: false,
      blocked: {
        code: 'missing_building',
        reason: `缺少前置建筑${missingBlds.map(m => `「${m}」`).join('、')}`,
        impact: `当前无法在${baseName}对「${target}」执行建造施工`,
        nextStep: `请先在${baseName}建造「${missingBlds[0]}」`,
        missingItems: missingBlds,
      },
    };
  }

  if (credits < spec.unitCost) {
    const deficit = Math.max(1, Math.ceil(spec.unitCost - credits));
    return {
      id: spec.canonicalName,
      name: target,
      kind: '建造',
      category: '基地建筑',
      unitCost: spec.unitCost,
      unitMinutes: spec.unitMinutes,
      laneKey: `${baseId} build.other`,
      laneName: '其他建筑线',
      canProduceNow: false,
      blocked: {
        code: 'insufficient_credits',
        reason: `可用资金不足（单价 ${spec.unitCost}，当前可用 ${credits}，尚缺 ${deficit}）`,
        impact: `当前无法在${baseName}全额拨付「${target}」的建造施工经费`,
        nextStep: `请等待资金链日结入账至少 ${deficit} 资金后再行立项`,
        missingItems: [],
      },
    };
  }

  return {
    id: spec.canonicalName,
    name: target,
    kind: '建造',
    category: '基地建筑',
    unitCost: spec.unitCost,
    unitMinutes: spec.unitMinutes,
    laneKey: `${baseId} build.other`,
    laneName: '其他建筑线',
    canProduceNow: true,
  };
}

function findResearchCandidate(
  researches: readonly ResearchDef[],
  ref: string,
  credibilityIndex?: EntityCredibilityIndex | null,
): ResearchDef | undefined {
  const target = cleanText(ref);
  if (!target) return undefined;
  const targetCanon = canonEntityKey(target);

  const exact = researches.find(r => {
    const id = cleanText((r as unknown as { id?: string }).id);
    const name = cleanText(r.name);
    return (
      id === target ||
      name === target ||
      (Boolean(targetCanon) && (canonEntityKey(id) === targetCanon || canonEntityKey(name) === targetCanon))
    );
  });
  if (exact) return exact;

  if (credibilityIndex) {
    const cred = evaluateEntityCredibility(credibilityIndex, target, {
      domain: 'research',
      highThreshold: 0.80,
    });
    if (cred.verdict === 'system_high' && cred.matchedName) {
      const matchedCanon = canonEntityKey(cred.matchedName);
      return researches.find(
        r => cleanText(r.name) === cred.matchedName || canonEntityKey(r.name) === matchedCanon,
      );
    }
  }

  return undefined;
}

function mapOpToDispatchVerb(op: Exclude<PlanningActionOp, 'enqueue'>): DispatchVerb {
  switch (op) {
    case 'promote':
      return '置顶';
    case 'demote':
      return '置底';
    case 'hold':
      return '暂缓';
    case 'resume':
      return '恢复';
  }
}

function resolvePrimaryBaseRef(state: StatData, intent: ParsedPlanningIntent): string {
  for (const act of intent.actions ?? []) {
    const ref = cleanText(act.base_ref);
    if (ref) return ref;
  }
  const activeBase = (state.bases ?? []).find(b => cleanText(b.status) !== '废弃') ?? state.bases?.[0];
  return cleanText(activeBase?.id) || cleanText(activeBase?.name) || '';
}

function isCommittedBatchStillInFlight(
  state: StatData,
  intent: ParsedPlanningIntent,
  catalog: EffectiveCatalog | null,
): boolean {
  const fp = cleanText(intent.fingerprint);
  if (!fp.startsWith('plan_')) return true;
  const enqueueActions = (intent.actions ?? []).filter(a => a.op === 'enqueue');
  if (enqueueActions.length === 0) return true;

  const safeCatalog = catalog ?? EMPTY_CATALOG;
  const credibilityIndex = buildEntityCredibilityIndex(safeCatalog);
  const doneTechCanon = new Set((state.tech?.done ?? []).map(t => canonEntityKey(t)));
  const activeQueues = (state.queues ?? []).filter(
    q => q.status === 'queued' || q.status === 'active' || q.status === 'settling',
  );

  return enqueueActions.every(action => {
    const targetRef = cleanText(action.catalog_ref) || cleanText(action.task_ref);
    if (!targetRef) return false;
    const rawKind = cleanText((action as { kind?: string }).kind);
    const isResearch = rawKind === '研究' || rawKind === '科研' || rawKind === '研发';
    if (isResearch) {
      const rDef = findResearchCandidate(safeCatalog.researches ?? [], targetRef, credibilityIndex);
      const rCanon = canonEntityKey(rDef?.name ?? targetRef);
      if (doneTechCanon.has(rCanon)) return true;
      return activeQueues.some(
        q => canonEntityKey(q.item) === rCanon || canonEntityKey(q.item) === canonEntityKey(targetRef),
      );
    }
    const ctx = buildPlanningContext(state, safeCatalog, { targetBaseRef: action.base_ref });
    const entry = ctx
      ? findCandidate(ctx.produceableItems, targetRef, rawKind, credibilityIndex)
      : undefined;
    const targetCanon = canonEntityKey(entry?.name ?? targetRef);
    const rawCanon = canonEntityKey(targetRef);
    const baseCanonSet = new Set<string>();
    if (cleanText(action.base_ref)) baseCanonSet.add(canonEntityKey(action.base_ref));
    if (ctx?.baseId) baseCanonSet.add(canonEntityKey(ctx.baseId));
    if (ctx?.baseName) baseCanonSet.add(canonEntityKey(ctx.baseName));

    return activeQueues.some(q => {
      const qItemCanon = canonEntityKey(q.item);
      if (qItemCanon !== targetCanon && qItemCanon !== rawCanon) return false;
      if (baseCanonSet.size === 0 || !cleanText(q.base)) return true;
      return baseCanonSet.has(canonEntityKey(q.base));
    });
  });
}

/**
 * 排产沙盒试排纯函数（PLAN-SANDBOX-01）
 */
export function runPlanningSandbox(
  state: StatData,
  intent: ParsedPlanningIntent,
  catalog: EffectiveCatalog | null,
  options?: PlanningSandboxOptions,
): PlanningSandboxResult {
  const sandboxState = klona(state);
  normalizeSandboxCredits(sandboxState);
  if (!Array.isArray(sandboxState.queues)) {
    sandboxState.queues = [];
  }

  const primaryBaseRef = resolvePrimaryBaseRef(sandboxState, intent);
  const baseReceiptFields = {
    request_ref: cleanText(intent.request_ref),
    fingerprint: cleanText(intent.fingerprint),
    snapshot_ref: cleanText(intent.snapshot_ref),
    mode: intent.mode,
    base_ref: primaryBaseRef,
    ...(intent.budget_cap_credits !== undefined ? { budget_cap_credits: intent.budget_cap_credits } : {}),
    reason: cleanText(intent.reason),
  };

  // 1. 同楼旧队列/调度令冲突门禁
  if (intent.conflict_with_legacy_queue === true) {
    return {
      receipt: {
        ...baseReceiptFields,
        status: 'rejected',
        total_cost_credits: 0,
        summary: '同楼已通过旧队列或调度令申报相同项目，忽略重复排产意图',
        actions: [],
        diff_summary: createEmptyDiffSummary(),
      },
      sandboxState,
      canCommit: false,
      alreadyCommitted: false,
    };
  }

  // 2. 幂等指纹门禁（若前一批次同配比入列项早已全部完工归档，放行跨楼层复产）
  const committedFingerprints = state.planning?.committed_fingerprints ?? [];
  if (
    cleanText(intent.fingerprint) &&
    committedFingerprints.includes(cleanText(intent.fingerprint)) &&
    isCommittedBatchStillInFlight(state, intent, catalog)
  ) {
    return {
      receipt: {
        ...baseReceiptFields,
        status: 'committed',
        total_cost_credits: 0,
        summary: '该排产方案已核准入列（幂等防重）',
        actions: [],
        diff_summary: createEmptyDiffSummary(),
      },
      sandboxState,
      canCommit: false,
      alreadyCommitted: true,
    };
  }

  // 3. 快照过期门禁
  const intentSnap = cleanText(intent.snapshot_ref);
  const currentSnap = cleanText(options?.currentSnapshotRef);
  if (intentSnap && currentSnap && intentSnap !== currentSnap) {
    return {
      receipt: {
        ...baseReceiptFields,
        status: 'stale_snapshot',
        total_cost_credits: 0,
        summary: '排产快照已过期，请基于最新战况重新提报',
        actions: [],
        diff_summary: createEmptyDiffSummary(),
      },
      sandboxState,
      canCommit: false,
      alreadyCommitted: false,
    };
  }

  // 4. 合并指挥官保护锁集合
  const protectedSet = new Set<string>();
  for (const ref of state.planning?.protected_task_refs ?? []) {
    const cleaned = cleanText(ref);
    if (cleaned) protectedSet.add(cleaned);
  }
  for (const ref of intent.protected_task_refs ?? []) {
    const cleaned = cleanText(ref);
    if (cleaned) protectedSet.add(cleaned);
  }

  const safeCatalog = catalog ?? EMPTY_CATALOG;
  const credibilityIndex = buildEntityCredibilityIndex(safeCatalog);
  const laneHub = createLaneRegistryHub();
  const actionResults: PlanningReceiptActionResult[] = [];
  const diffSummary = createEmptyDiffSummary();
  let totalCostCredits = 0;
  let resolvedPrimaryBaseId = primaryBaseRef;

  const passActionStatus: 'preview' | 'accepted' = intent.mode === 'advisory' ? 'preview' : 'accepted';

  let cachedCtx: ReturnType<typeof buildPlanningContext> = null;
  let cachedCtxBaseRef: string | null = null;
  let ctxDirty = true;
  let hasEnqueuedBuildingSinceCtx = false;

  // 5. 逐条在沙盒副本上试排动作
  for (const action of intent.actions ?? []) {
    const qty = Math.max(1, Math.floor(action.quantity || 1));

    if (action.op === 'enqueue') {
      const targetRef = cleanText(action.catalog_ref) || cleanText(action.task_ref);
      const normBaseRef = cleanText(action.base_ref);
      if (ctxDirty || cachedCtxBaseRef !== normBaseRef) {
        cachedCtx = buildPlanningContext(sandboxState, safeCatalog, {
          targetBaseRef: action.base_ref,
          protectedTaskRefs: [...protectedSet],
        });
        cachedCtxBaseRef = normBaseRef;
        ctxDirty = false;
        hasEnqueuedBuildingSinceCtx = false;
      }
      let ctx = cachedCtx;

      if (!ctx) {
        const baseDiag = diagnoseBaseFailure(sandboxState, action.base_ref);
        actionResults.push({
          op: 'enqueue',
          target: targetRef,
          base: baseDiag.baseId || cleanText(action.base_ref),
          quantity: qty,
          cost_credits: 0,
          est_minutes: 0,
          status: 'rejected',
          blocker_code: baseDiag.code,
          blocker_reason: baseDiag.reason,
          next_step: baseDiag.nextStep,
        });
        continue;
      }

      if (!resolvedPrimaryBaseId) {
        resolvedPrimaryBaseId = ctx.baseId;
      }

      const rawActionKind = cleanText((action as { kind?: string }).kind);
      const isResearchKind =
        rawActionKind === '研究' || rawActionKind === '科研' || rawActionKind === '研发';

      if (isResearchKind) {
        const researchDef = findResearchCandidate(
          safeCatalog.researches ?? [],
          targetRef,
          credibilityIndex,
        );
        if (!researchDef) {
          actionResults.push({
            op: 'enqueue',
            target: targetRef,
            base: ctx.baseId,
            quantity: qty,
            cost_credits: 0,
            est_minutes: 0,
            status: 'rejected',
            blocker_code: 'missing_research',
            blocker_reason: '目标科技未解锁或未在当前战区科技目录登记',
            next_step: '请先核查前置科技与科研实验室条件',
          });
          continue;
        }

        const unitCost =
          typeof researchDef.cost === 'number' && Number.isFinite(researchDef.cost)
            ? researchDef.cost
            : 0;
        const durationInfo = durationFromEntry(researchDef);
        const unitMinutes = durationInfo ? Math.round(durationInfo.totalMinutes) : 1440;
        const costCredits = unitCost * qty;
        const estMinutes = unitMinutes * qty;

        const runtimeBases = toRuntimeBases(sandboxState);
        const protocolsInput = (sandboxState.protocols ?? undefined) as RuntimeProtocolsInput;
        const prereqContext = buildCatalogPrerequisiteContext({
          bases: runtimeBases,
          selectedBaseId: ctx.baseId,
          techDone: sandboxState.tech?.done ?? [],
          forces: {
            troops: sandboxState.forces?.troops ?? {},
            vehicles: sandboxState.forces?.vehicles ?? [],
          },
          protocols: protocolsInput,
        });

        if (prereqContext) {
          const enrichedPrereqContext = {
            ...prereqContext,
            protocols: safeCatalog.protocols ?? [],
            catalog: {
              protocols: safeCatalog.protocols ?? [],
            },
          };
          const combinedCondition = combineLegacyPrerequisites(researchDef, 'running');
          const prereqEval = evaluatePrerequisite(combinedCondition, enrichedPrereqContext);
          if (!prereqEval.satisfied) {
            const blocked = classifyPlanningBlocker({
              itemName: researchDef.name,
              kind: '生产',
              baseName: ctx.baseName,
              baseState: ctx.baseState,
              prerequisiteEval: prereqEval,
              unitCost,
              credits: getSandboxCredits(sandboxState),
            });
            actionResults.push({
              op: 'enqueue',
              target: researchDef.name,
              base: ctx.baseId,
              quantity: qty,
              cost_credits: costCredits,
              est_minutes: estMinutes,
              status: 'rejected',
              blocker_code: blocked?.code ?? 'missing_research',
              blocker_reason: blocked?.reason ?? `目标科技「${researchDef.name}」前置条件未满足`,
              next_step: blocked?.nextStep ?? '请先完成前置科技或建造对应科研设施',
            });
            continue;
          }
        }

        const availableCredits = getSandboxCredits(sandboxState);
        if (availableCredits < costCredits) {
          actionResults.push({
            op: 'enqueue',
            target: researchDef.name,
            base: ctx.baseId,
            quantity: qty,
            cost_credits: costCredits,
            est_minutes: estMinutes,
            status: 'rejected',
            blocker_code: 'insufficient_credits',
            blocker_reason: `立项研究「${researchDef.name}」需资金 ${costCredits}，当前可用资金仅 ${availableCredits}`,
            next_step: '请等待资金链回流后再立项研究',
          });
          continue;
        }

        deductSandboxCredits(sandboxState, costCredits);
        const existingResearchInQueue = (sandboxState.queues ?? []).find(
          q =>
            canonEntityKey(cleanText(q.item)) === canonEntityKey(researchDef.name) &&
            (q.status === 'queued' || q.status === 'active'),
        );
        if (existingResearchInQueue) {
          if (!existingResearchInQueue.total_minutes || existingResearchInQueue.total_minutes <= 0) {
            existingResearchInQueue.total_minutes = unitMinutes;
          }
          existingResearchInQueue.cost_paid = true;
        } else {
          sandboxState.queues.push({
            type: '研究',
            item: researchDef.name,
            base: ctx.baseId,
            progress: 0,
            eta: '',
            status: 'queued',
            started_at: '',
            total_minutes: unitMinutes,
            spent_minutes: 0,
            qty,
            qty_done: 0,
            cost_paid: true,
            min_days_lock: 0,
            hold: false,
          });
        }

        totalCostCredits += costCredits;
        diffSummary.added.push(`${researchDef.name}×${qty}`);
        actionResults.push({
          op: 'enqueue',
          target: researchDef.name,
          base: ctx.baseId,
          quantity: qty,
          cost_credits: costCredits,
          est_minutes: estMinutes,
          status: passActionStatus,
          eta_note: `预计耗时 ${estMinutes} 分钟（产线：科研实验室）`,
        });
        continue;
      }

      let produceable = findCandidate(
        ctx.produceableItems,
        targetRef,
        rawActionKind,
        credibilityIndex,
      );
      if (!produceable && hasEnqueuedBuildingSinceCtx) {
        cachedCtx = buildPlanningContext(sandboxState, safeCatalog, {
          targetBaseRef: action.base_ref,
          protectedTaskRefs: [...protectedSet],
        });
        ctx = cachedCtx!;
        hasEnqueuedBuildingSinceCtx = false;
        produceable = findCandidate(
          ctx.produceableItems,
          targetRef,
          rawActionKind,
          credibilityIndex,
        );
      }
      let nearUnlock = !produceable
        ? findCandidate(
            ctx.blockedCatalogItems ?? ctx.nearUnlockItems,
            targetRef,
            rawActionKind,
            credibilityIndex,
          )
        : undefined;

      if (!produceable && !nearUnlock) {
        const fallbackCandidate = resolveBuiltinFoundationBuildingCandidate(
          sandboxState,
          ctx.baseId,
          ctx.baseName,
          targetRef,
          rawActionKind,
          getSandboxCredits(sandboxState),
        );
        if (fallbackCandidate) {
          if (fallbackCandidate.canProduceNow) {
            produceable = fallbackCandidate;
          } else {
            nearUnlock = fallbackCandidate;
          }
        }
      }

      // 命中 nearUnlockItems 且 !canProduceNow（存在阻塞）
      if (nearUnlock && !nearUnlock.canProduceNow) {
        const costCredits = nearUnlock.unitCost * qty;
        const estMinutes = nearUnlock.unitMinutes * qty;
        const blocked = nearUnlock.blocked;
        actionResults.push({
          op: 'enqueue',
          target: nearUnlock.name || targetRef,
          base: ctx.baseId,
          quantity: qty,
          cost_credits: costCredits,
          est_minutes: estMinutes,
          status: 'rejected',
          blocker_code: blocked?.code ?? 'missing_research',
          blocker_reason: blocked?.reason ?? `目标「${nearUnlock.name}」当前存在排产阻塞`,
          next_step: blocked?.nextStep ?? '请先解除前置阻塞后再试',
        });
        continue;
      }

      // 不在可造也不在相近候选（或完全未解锁/剧透屏蔽）
      if (!produceable) {
        // 若因缓存未包含最新资金阻塞项，兜底刷新一次 ctx
        const freshCtx = buildPlanningContext(sandboxState, safeCatalog, {
          targetBaseRef: action.base_ref,
          protectedTaskRefs: [...protectedSet],
        });
        cachedCtx = freshCtx;
        const retryNear = freshCtx
          ? findCandidate(
              freshCtx.blockedCatalogItems ?? freshCtx.nearUnlockItems,
              targetRef,
              rawActionKind,
              credibilityIndex,
            )
          : undefined;
        if (retryNear && !retryNear.canProduceNow) {
          const costCredits = retryNear.unitCost * qty;
          const estMinutes = retryNear.unitMinutes * qty;
          const blocked = retryNear.blocked;
          actionResults.push({
            op: 'enqueue',
            target: retryNear.name || targetRef,
            base: ctx.baseId,
            quantity: qty,
            cost_credits: costCredits,
            est_minutes: estMinutes,
            status: 'rejected',
            blocker_code: blocked?.code ?? 'missing_research',
            blocker_reason: blocked?.reason ?? `目标「${retryNear.name}」当前存在排产阻塞`,
            next_step: blocked?.nextStep ?? '请先解除前置阻塞后再试',
          });
          continue;
        }
        actionResults.push({
          op: 'enqueue',
          target: targetRef,
          base: ctx.baseId,
          quantity: qty,
          cost_credits: 0,
          est_minutes: 0,
          status: 'rejected',
          blocker_code: 'missing_research',
          blocker_reason: '目标条目未解锁或未在当前战区图鉴登记',
          next_step: '请先核查前置科技与产线建筑',
        });
        continue;
      }

      if (produceable.kind === '建造') {
        hasEnqueuedBuildingSinceCtx = true;
      }

      const costCredits = produceable.unitCost * qty;
      const estMinutes = produceable.unitMinutes * qty;
      const availableCredits = getSandboxCredits(sandboxState);

      if (availableCredits < costCredits) {
        actionResults.push({
          op: 'enqueue',
          target: produceable.name,
          base: ctx.baseId,
          quantity: qty,
          cost_credits: costCredits,
          est_minutes: estMinutes,
          status: 'rejected',
          blocker_code: 'insufficient_credits',
          blocker_reason: `排产「${produceable.name}×${qty}」需资金 ${costCredits}，当前可用资金仅 ${availableCredits}`,
          next_step: '请等待资金链回流或缩减排产批次数量',
        });
        continue;
      }

      // 通过校验：在沙盒中预扣资金并以零已耗工时（status: 'queued', spent_minutes: 0）入列
      deductSandboxCredits(sandboxState, costCredits);
      const targetBase = (sandboxState.bases ?? []).find(
        b =>
          (cleanText(b.id) || cleanText(b.name)) === ctx.baseId ||
          canonEntityKey(cleanText(b.id)) === canonEntityKey(ctx.baseId) ||
          canonEntityKey(cleanText(b.name)) === canonEntityKey(ctx.baseId),
      );
      const matchesActionBase = (qBase: string | undefined): boolean => {
        const cleaned = cleanText(qBase);
        if (!cleaned) return true;
        const qCanon = canonEntityKey(cleaned);
        if (cleaned === ctx.baseId || qCanon === canonEntityKey(ctx.baseId)) return true;
        if (targetBase) {
          const bId = cleanText(targetBase.id);
          const bName = cleanText(targetBase.name);
          if (bId && (cleaned === bId || qCanon === canonEntityKey(bId))) return true;
          if (bName && (cleaned === bName || qCanon === canonEntityKey(bName))) return true;
        }
        return false;
      };
      const matchesItemName = (qItemRaw: string, prodName: string): boolean => {
        const qClean = cleanText(qItemRaw);
        if (!qClean) return false;
        if (canonEntityKey(qClean) === canonEntityKey(prodName) || canonEntityKey(qClean) === canonEntityKey(targetRef)) {
          return true;
        }
        if (produceable.kind === '建造') {
          const s1 = stripFactionBuildingPrefix(qClean);
          const s2 = stripFactionBuildingPrefix(prodName);
          if (s1.length >= 2 && canonEntityKey(s1) === canonEntityKey(s2)) return true;
          const eqs = BUILDING_EQUIVALENTS[prodName] ?? BUILDING_EQUIVALENTS[s2] ?? [];
          if (eqs.some(a => canonEntityKey(a) === canonEntityKey(qClean))) return true;
        }
        return false;
      };
      const existingProduceInQueue = (sandboxState.queues ?? []).find(
        q =>
          matchesItemName(q.item, produceable.name) &&
          matchesActionBase(q.base) &&
          (q.status === 'queued' || q.status === 'active') &&
          (!q.total_minutes ||
            q.total_minutes <= 0 ||
            Boolean((q as { direct_enqueued_in_parse?: boolean }).direct_enqueued_in_parse) ||
            ((q.spent_minutes ?? 0) <= 0 &&
              (q.progress ?? 0) <= 0 &&
              (q.qty ?? 1) === qty)),
      );
      if (existingProduceInQueue) {
        if (!existingProduceInQueue.total_minutes || existingProduceInQueue.total_minutes <= 0) {
          existingProduceInQueue.total_minutes = estMinutes;
        }
        existingProduceInQueue.qty = qty;
        existingProduceInQueue.cost_paid = true;
        delete (existingProduceInQueue as { direct_enqueued_in_parse?: boolean }).direct_enqueued_in_parse;
      } else {
        sandboxState.queues.push({
          type: produceable.kind,
          item: produceable.name,
          base: ctx.baseId,
          progress: 0,
          eta: '',
          status: 'queued',
          started_at: '',
          total_minutes: estMinutes,
          spent_minutes: 0,
          qty,
          qty_done: 0,
          cost_paid: true,
          min_days_lock: 0,
          hold: false,
        });
      }

      // FD-38 · 建造立项通过校验时，同步向目标基地 buildings 挂载或补齐 state: '建造中' 条目
      if (produceable.kind === '建造') {
        if (targetBase) {
          if (!Array.isArray(targetBase.buildings)) {
            targetBase.buildings = [];
          }
          const upgradeSpec =
            BUILTIN_BUILDING_UPGRADE_SPECS[produceable.name] ??
            BUILTIN_BUILDING_UPGRADE_SPECS[produceable.name.trim()];
          const catalogBld = (safeCatalog.buildings ?? []).find(
            b => canonEntityKey(cleanText(b.name)) === canonEntityKey(produceable.name),
          ) as unknown as { upgrade_mode?: string } | undefined;
          const isReplaceUpgrade =
            upgradeSpec?.upgrade_mode === 'replace' || catalogBld?.upgrade_mode === 'replace';

          if (!isReplaceUpgrade) {
            const actionSpatial = action as {
              coord?: { x: number; y: number };
              bearing?: string;
              layer?: string;
            };
            const targetCanon = canonEntityKey(produceable.name);
            const existingUnderConst = targetBase.buildings.filter(
              b => canonEntityKey(cleanText(b.name)) === targetCanon && b.state === '建造中',
            );

            if (existingUnderConst.length > 0) {
              const firstUnderConst = existingUnderConst[0] as unknown as Record<string, unknown>;
              if (actionSpatial.layer) {
                firstUnderConst.layer = actionSpatial.layer;
              }
              if (actionSpatial.coord) {
                firstUnderConst.coord = { x: actionSpatial.coord.x, y: actionSpatial.coord.y };
              }
              if (actionSpatial.bearing) {
                firstUnderConst.bearing = actionSpatial.bearing;
              }
              for (let k = existingUnderConst.length; k < qty; k++) {
                targetBase.buildings.push({
                  name: produceable.name,
                  layer: actionSpatial.layer ?? '',
                  state: '建造中',
                  ...(actionSpatial.coord
                    ? { coord: { x: actionSpatial.coord.x, y: actionSpatial.coord.y } }
                    : {}),
                  ...(actionSpatial.bearing ? { bearing: actionSpatial.bearing } : {}),
                });
              }
            } else {
              for (let k = 0; k < qty; k++) {
                targetBase.buildings.push({
                  name: produceable.name,
                  layer: actionSpatial.layer ?? '',
                  state: '建造中',
                  ...(actionSpatial.coord
                    ? { coord: { x: actionSpatial.coord.x, y: actionSpatial.coord.y } }
                    : {}),
                  ...(actionSpatial.bearing ? { bearing: actionSpatial.bearing } : {}),
                });
              }
            }
          }
        }
      }

      totalCostCredits += costCredits;
      diffSummary.added.push(`${produceable.name}×${qty}`);
      actionResults.push({
        op: 'enqueue',
        target: produceable.name,
        base: ctx.baseId,
        quantity: qty,
        cost_credits: costCredits,
        est_minutes: estMinutes,
        status: passActionStatus,
        eta_note: `预计耗时 ${estMinutes} 分钟（产线：${produceable.laneName}）`,
      });
      continue;
    }

    // promote | demote | hold | resume
    const target = cleanText(action.task_ref) || cleanText(action.catalog_ref);
    let targetBaseId = cleanText(action.base_ref);
    if (targetBaseId) {
      const resolved = resolveBaseReference(toRuntimeBases(sandboxState), targetBaseId);
      if (resolved.status === 'resolved') {
        targetBaseId = resolved.baseId;
      }
    }

    // 指挥官保护锁检查
    if ((action.op === 'demote' || action.op === 'hold') && protectedSet.has(target)) {
      actionResults.push({
        op: action.op,
        target,
        base: targetBaseId || resolvedPrimaryBaseId,
        quantity: 1,
        cost_credits: 0,
        est_minutes: 0,
        status: 'rejected',
        blocker_code: 'protected_task',
        blocker_reason: `任务「${target}」受指挥官保护锁锁定，禁止降级或暂缓`,
        next_step: '如需调整该任务优先级，请先由指挥官解除保护锁',
      });
      continue;
    }

    // 查找在编队列项
    const matchedQueue = (sandboxState.queues ?? []).find(q => {
      if (cleanText(q.item) !== target) return false;
      if (targetBaseId && cleanText(q.base) !== targetBaseId) return false;
      return q.status === 'queued' || q.status === 'active';
    });

    if (!matchedQueue) {
      actionResults.push({
        op: action.op,
        target,
        base: targetBaseId || resolvedPrimaryBaseId,
        quantity: 1,
        cost_credits: 0,
        est_minutes: 0,
        status: 'rejected',
        blocker_code: 'task_not_found',
        blocker_reason: `在编队列中未找到可调度的任务「${target}」`,
        next_step: '请确认该任务当前已在队列中且未进入结算或完成态',
      });
      continue;
    }

    const dispatchVerb = mapOpToDispatchVerb(action.op);
    const laneEnv = {
      bases: sandboxState.bases ?? [],
      queues: sandboxState.queues as unknown as TransactionItem[],
      catalog: safeCatalog,
      projects: sandboxState.projects ?? [],
    };
    const dispatchRes = applyDispatchOrders(
      sandboxState.queues as unknown as TransactionItem[],
      [
        {
          item: matchedQueue.item,
          ...(matchedQueue.base ? { base: matchedQueue.base } : {}),
          type: matchedQueue.type,
          verb: dispatchVerb,
        },
      ],
      {
        laneKeyFor: txn => laneHub.resolveLaneKeyForTxn(txn, laneEnv),
        parallelLimitFor: txn => laneHub.resolveParallelLimitForTxn(txn, laneEnv),
      },
    );

    if (dispatchRes.rejected.length > 0) {
      const rej = dispatchRes.rejected[0];
      actionResults.push({
        op: action.op,
        target,
        base: matchedQueue.base || targetBaseId || resolvedPrimaryBaseId,
        quantity: 1,
        cost_credits: 0,
        est_minutes: 0,
        status: 'rejected',
        blocker_code: rej.reason,
        blocker_reason: rej.detail,
        next_step: '请核查目标任务当前状态后再试',
      });
      continue;
    }

    sandboxState.queues = dispatchRes.next as StatData['queues'];
    if (action.op === 'promote') diffSummary.promoted.push(target);
    if (action.op === 'demote') diffSummary.demoted.push(target);
    if (action.op === 'hold') diffSummary.held.push(target);
    if (action.op === 'resume') diffSummary.resumed.push(target);

    actionResults.push({
      op: action.op,
      target,
      base: matchedQueue.base || targetBaseId || resolvedPrimaryBaseId,
      quantity: 1,
      cost_credits: 0,
      est_minutes: 0,
      status: passActionStatus,
    });
  }

  // 6. 预算上限门禁与汇总回执状态
  const passedCount = actionResults.filter(a => a.status !== 'rejected').length;
  const rejectedCount = actionResults.filter(a => a.status === 'rejected').length;
  const overBudget =
    intent.budget_cap_credits !== undefined && totalCostCredits > intent.budget_cap_credits;

  let status: PlanningReceiptStatus;
  let canCommit = false;
  let summary = '';

  if (passedCount === 0) {
    status = 'rejected';
    canCommit = false;
    const firstRej = actionResults.find(a => a.status === 'rejected');
    summary = firstRej?.blocker_reason
      ? `排产方案被驳回：${firstRej.blocker_reason}`
      : '排产方案无可执行动作，已驳回';
  } else if (intent.mode === 'advisory') {
    status = 'advisory_ready';
    canCommit = false;
    summary =
      rejectedCount > 0
        ? `参谋排产预案就绪（通过 ${passedCount} 项，受阻 ${rejectedCount} 项，预计耗资 ${totalCostCredits}）`
        : `参谋排产预案就绪（共 ${passedCount} 项，预计耗资 ${totalCostCredits}）`;
  } else if (overBudget) {
    status = 'awaiting_approval';
    canCommit = false;
    summary = `排产总耗资 ${totalCostCredits} 超出授权预算上限 ${intent.budget_cap_credits}，转入人工待批`;
  } else if (rejectedCount > 0) {
    status = 'awaiting_approval';
    canCommit = false;
    summary = `排产方案部分受阻（通过 ${passedCount} 项，被拒 ${rejectedCount} 项），转入人工待批`;
  } else {
    status = 'committed';
    canCommit = true;
    for (const act of actionResults) {
      if (act.status === 'preview') {
        act.status = 'accepted';
      }
    }
    summary = `单次托管排产已核准入列（共 ${passedCount} 项，耗资 ${totalCostCredits}）`;
  }

  return {
    receipt: {
      ...baseReceiptFields,
      base_ref: resolvedPrimaryBaseId || primaryBaseRef,
      status,
      total_cost_credits: totalCostCredits,
      summary,
      actions: actionResults,
      diff_summary: diffSummary,
    },
    sandboxState,
    canCommit,
    alreadyCommitted: false,
  };
}
