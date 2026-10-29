/**
 * researchAdvisory.ts —— 研究建议纯逻辑（长驻角色脚本共享层，RAC-ADV-01）
 *
 * 职责：
 * 1. 生成类型 → 基线矩阵（任务包 §3.4）与 Helper 自定义 generate 过滤判定（§3.5）；
 * 2. 多基地分组推导（§3.7）：对每个有效 Base.id 严格镜像 ActionBar 权威链
 *    buildCatalogPrerequisiteContext → queueItemsForAction('研究') → deriveResearchableWithContext；
 * 3. prompt 文本格式化（含来源楼号 / schema 版本 / 只读声明）；
 * 4. 注入配置常量与构造函数（§3.8）。
 *
 * 纯函数：零 IO / 零事件 / 零 DOM / 零 vue·pinia / 零酒馆 API。
 * 事件监听、令牌消费、injectPrompts 调用属 RAC-ENTRY-01；$dlc 注册表由调用方读出后以 overlays 注入。
 * 有效目录每次调用重算，不缓存（D-RAC-STALE-DLC-01）。
 */
import { deriveResearchableWithContext } from '../core/catalog';
import { mergeEffectiveCatalog, type DlcOverlay, type DynamicWorldbookCatalog } from '../core/catalogEffective';
import type { ParsedWorldbookCatalog } from '../../中控悬浮窗/models/worldbookCatalogParser';
import { buildCatalogPrerequisiteContext, queueItemsForAction } from '../core/catalogRuntimeContext';
import {
  resolveScanStart,
  scanLatestValidFloor,
  type FloorCandidate,
  type FloorSnapshot,
  type GenerationEntry,
} from '../parse/floorScanner';
import { deployIndexFromCatalog, type DeployOf } from '../engines/productionLanes';
import {
  GLOBAL_RESEARCH_LIMITS,
  lineIndexFromCatalog,
  SLOT_REGISTRY,
  slotBoard,
  techTier,
  type SlotBoardEntry,
  type SlotStateView,
} from '../engines/researchSlots';
import type { SCHEMA_VERSION } from '../core/schema';

// ───────────────────────── §3.4 / §3.5 生成类型判定 ─────────────────────────

/**
 * GENERATION_AFTER_COMMANDS 事件的纯数据描述（由调用方从事件参数拼装，本模块不读事件）。
 * - `type`：事件第一参数（核心 Generate 的 type；顶部正常发送可能为 undefined）；
 * - `options`：事件第二参数（核心 Generate 会带 automatic_trigger / signal / depth 等字段；Helper 自定义 generate 为 `{}`）；
 * - `dryRun`：事件第三参数；
 * - `hasStartedToken`：本次 AFTER_COMMANDS 之前是否收到过配对的 GENERATION_STARTED（令牌由调用方维护与消费）；
 * - `viaActionBar`：调用方可选标记——ActionBar `sendAction` 已先创建 user 楼；扫描起点与 normal 相同，仅影响入口标签。
 */
export interface GenerationDescriptor {
  type: string | undefined;
  options: Record<string, unknown>;
  dryRun: boolean;
  hasStartedToken: boolean;
  viaActionBar?: boolean;
}

/**
 * §3.5 令牌过滤判定：要求 STARTED 令牌存在，且 options 含至少一个核心字段
 * （`automatic_trigger !== undefined` 或存在 `signal` / `depth` 字段）。
 * Helper `generate()` 只发 AFTER_COMMANDS 且 options 为 `{}` → false。
 */
export function shouldInject(descriptor: Pick<GenerationDescriptor, 'options' | 'hasStartedToken'>): boolean {
  if (!descriptor.hasStartedToken) return false;
  const options = descriptor.options;
  if (typeof options !== 'object' || options === null) return false;
  return options.automatic_trigger !== undefined || 'signal' in options || 'depth' in options;
}

/**
 * §3.4 生成类型 → 基线入口。任一 fail-closed 行命中即返回 null（不注入）：
 * 无 STARTED 令牌配对 / options 缺核心字段 / dry_run / quiet / impersonate / 未知类型 /
 * automatic_trigger 为真 / depth 非 0。
 */
export function resolveGenerationEntry(descriptor: GenerationDescriptor): GenerationEntry | null {
  if (descriptor.dryRun) return null;
  if (!shouldInject(descriptor)) return null;
  const { options } = descriptor;
  if (options.automatic_trigger) return null;
  if (options.depth !== undefined && options.depth !== 0) return null;

  const type = descriptor.type ?? 'normal';
  switch (type) {
    case 'normal':
      return descriptor.viaActionBar ? 'actionbar' : 'normal';
    case 'regenerate':
    case 'swipe':
    case 'continue':
      return type;
    default:
      // quiet / impersonate / 任何未知类型
      return null;
  }
}

// ───────────────────────── §3.7 多基地分组推导 ─────────────────────────

export interface AdvisoryCandidate {
  name: string;
  cost: number;
  /** 工期（catalog ResearchDef.eta 原文，如“约3日”） */
  eta: string;
  /** economy.credits >= cost */
  affordable: boolean;
}

export interface AdvisoryBaseGroup {
  baseId: string;
  baseName: string;
  /** 研究槽是否占用：镜像 ActionBar `hasResearchInQueue`（研究队列按设计全局可见） */
  researchSlotBusy: boolean;
  /** 已在研究队列中的项目名（镜像 queueItemsForAction(…,'研究',…)） */
  queuedResearch: string[];
  candidates: AdvisoryCandidate[];
}

export interface ResearchSlotOccupancy {
  /** 11 大科研序列总数（固定 11） */
  totalSlots: number;
  /** 已开通序列数（锚定建筑已建成在场） */
  unlockedSlots: number;
  /** 已开通序列名称列表 */
  unlockedSlotNames: string[];
  /** 当前在研占用数（status === 'active' 的研究项数） */
  activeCount: number;
  /** 当前排队等待数（status === 'queued' 的研究项数） */
  queuedCount: number;
  /** 已开通且当前未占用的空闲序列数 */
  availableUnlockedSlots: number;
  /** 战区科技资格等级（1 | 2 | 3） */
  techTier: 1 | 2 | 3;
  /** 全局研究并行上限（T1=2 / T2=4 / T3=Infinity） */
  globalLimit: number;
  /** 全局并行余量（T1/T2 为 max(0, globalLimit - activeCount)，T3 为 Infinity） */
  globalRemaining: number;
  /** 综合可立项并行余量（受全局并行上限与已开通空槽双重约束） */
  effectiveRemaining: number;
  /** 11 槽看板明细 */
  slots: SlotBoardEntry[];
}

export interface ResearchAdvisory {
  floorId: number;
  schemaVersion: typeof SCHEMA_VERSION;
  credits: number;
  /** 战区全局研究槽是否占用（全局研究队列提升至战区级汇总） */
  researchSlotBusy?: boolean;
  /** 战区全局研究队列中的项目名 */
  queuedResearch?: string[];
  /** 战区 11 大科研序列占用与全局余量汇总（UX-ADV-01） */
  slotOccupancy?: ResearchSlotOccupancy;
  groups: AdvisoryBaseGroup[];
}

export function deriveGlobalResearchLimit(state: SlotStateView): {
  techTier: 1 | 2 | 3;
  globalLimit: number;
} {
  const tier = techTier(state);
  return { techTier: tier, globalLimit: GLOBAL_RESEARCH_LIMITS[tier] };
}

export function buildResearchSlotOccupancy(
  state: SlotStateView,
  researches: ReadonlyArray<{ name: string; line: string }>,
  deployOf?: DeployOf,
): ResearchSlotOccupancy {
  const lineOf = lineIndexFromCatalog(researches);
  const slots = slotBoard(state, lineOf, undefined, { deployOf });
  const totalSlots = SLOT_REGISTRY.length;
  const unlockedEntries = slots.filter(s => s.unlocked);
  const unlockedSlots = unlockedEntries.length;
  const unlockedSlotNames = unlockedEntries.map(s => s.name);
  const activeCount = slots.reduce((sum, s) => sum + s.active.length, 0);
  const queuedCount = slots.reduce((sum, s) => sum + s.queued, 0);
  const availableUnlockedSlots = unlockedEntries.filter(s => s.active.length === 0).length;
  const { techTier: tier, globalLimit } = deriveGlobalResearchLimit(state);
  const globalRemaining = Number.isFinite(globalLimit) ? Math.max(0, globalLimit - activeCount) : Infinity;
  const effectiveRemaining = Math.min(globalRemaining, availableUnlockedSlots);
  return {
    totalSlots,
    unlockedSlots,
    unlockedSlotNames,
    activeCount,
    queuedCount,
    availableUnlockedSlots,
    techTier: tier,
    globalLimit,
    globalRemaining,
    effectiveRemaining,
    slots,
  };
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 快照 → 分组建议。以下情况返回 null（不注入）：
 * 快照 null / 无基地 / Base.id 为空或重复 / 任一基地前置上下文为 null。
 * 目录来源：overlays 每次合并重算。快照 data 中任何非 Schema 字段（含模型伪造的 advisory）均不参与推导。
 * R3 动态目录通道：`dynamicWb` 为世界书动态目录（可选），参与三级合并（世界书动态 > 静态基线 > DLC overlay）；
 * 不传（undefined/null）时行为与改造前逐字节一致（纯增量、向后兼容）。
 */
export function deriveResearchAdvisory(
  snapshot: FloorSnapshot | null,
  overlays: readonly DlcOverlay[],
  dynamicWb?: ParsedWorldbookCatalog | DynamicWorldbookCatalog | null,
): ResearchAdvisory | null {
  if (!snapshot) return null;
  const { data } = snapshot;
  if (data.bases.length === 0) return null;

  const ids = new Set<string>();
  for (const base of data.bases) {
    const id = clean(base.id);
    if (!id || ids.has(id)) return null;
    ids.add(id);
  }

  const catalog = mergeEffectiveCatalog(overlays, dynamicWb, data.protocols);
  const credits = data.economy.credits;
  const groups: AdvisoryBaseGroup[] = [];
  const globalQueuedResearch = queueItemsForAction(data.queues, '研究', clean(data.bases[0].id), data.bases);
  const globalSlotBusy = globalQueuedResearch.length > 0;
  const deployOf = deployIndexFromCatalog({
    buildings: catalog.buildings,
    productions: catalog.productions,
    retrofits: catalog.retrofits,
  });
  const slotOccupancy = buildResearchSlotOccupancy(
    { bases: data.bases, queues: data.queues },
    catalog.researches,
    deployOf,
  );

  for (const base of data.bases) {
    const baseId = clean(base.id);
    const context = buildCatalogPrerequisiteContext({
      bases: data.bases,
      selectedBaseId: baseId,
      techDone: data.tech.done,
      forces: data.forces,
      protocols: data.protocols,
    });
    if (!context) return null;
    const queuedResearch = queueItemsForAction(data.queues, '研究', baseId, data.bases);
    const researchable = deriveResearchableWithContext(catalog.researches, context, queuedResearch);
    groups.push({
      baseId,
      baseName: base.name,
      researchSlotBusy: queuedResearch.length > 0,
      queuedResearch,
      candidates: researchable.map(item => ({
        name: item.name,
        cost: item.cost,
        eta: item.eta,
        affordable: credits >= item.cost,
      })),
    });
  }

  return {
    floorId: snapshot.floorId,
    schemaVersion: snapshot.schemaVersion,
    credits,
    researchSlotBusy: globalSlotBusy,
    queuedResearch: globalQueuedResearch,
    slotOccupancy,
    groups,
  };
}

// ───────────────────────── prompt 格式化 ─────────────────────────

export const RESEARCH_ADVISORY_READONLY_NOTICE =
  '本段为前端按科技目录与前置条件自动推导的只读派生视图，仅供叙事参考：' +
  '不得将其回写到 stat_data，不得据此宣称任何研究已解锁或已完成；' +
  'stat_data 中任何名为 advisory 的字段均无效，研究进度一律以变量更新规则为准。';

export function formatResearchAdvisory(advisory: ResearchAdvisory): string {
  const globalQueued = advisory.queuedResearch ?? advisory.groups[0]?.queuedResearch ?? [];
  const globalBusy =
    advisory.researchSlotBusy ?? advisory.groups.some(g => g.researchSlotBusy) ?? globalQueued.length > 0;
  const globalSlot = globalBusy ? `占用中（队列：${globalQueued.join('、')}）` : '空闲';
  const occ = advisory.slotOccupancy;
  const totalSlots = occ?.totalSlots ?? SLOT_REGISTRY.length;
  const unlockedSlots = occ?.unlockedSlots ?? 0;
  const unlockedNamesText =
    occ && occ.unlockedSlotNames.length > 0 ? `（${occ.unlockedSlotNames.join('、')}）` : '';
  const activeCount = occ?.activeCount ?? globalQueued.length;
  const tier = occ?.techTier ?? 1;
  const globalLimit = occ?.globalLimit ?? GLOBAL_RESEARCH_LIMITS[tier];
  const globalRemaining =
    occ?.globalRemaining ?? (Number.isFinite(globalLimit) ? Math.max(0, globalLimit - activeCount) : Infinity);
  const limitText = Number.isFinite(globalLimit) ? `${globalLimit}` : '不限';
  const remainingText = Number.isFinite(globalRemaining) ? `${globalRemaining}` : '不限';
  const activeSlotText =
    occ && occ.slots.some(s => s.active.length > 0)
      ? `（${occ.slots
          .filter(s => s.active.length > 0)
          .map(s => `${s.name}：${s.active.join('、')}`)
          .join('；')}）`
      : '';
  const lines: string[] = [
    '[研究建议 · 只读派生视图]',
    `来源：第 ${advisory.floorId} 楼 stat_data（schema_version ${advisory.schemaVersion}），当前资金 ${advisory.credits}。`,
    RESEARCH_ADVISORY_READONLY_NOTICE,
    `战区全局研究槽：${globalSlot}`,
    `战区11大科研序列：已开通 ${unlockedSlots}/${totalSlots}${unlockedNamesText} ｜ 当前在研 ${activeCount}/${limitText}${activeSlotText} ｜ 全局并行余量 ${remainingText}（T${tier}）`,
  ];
  for (const group of advisory.groups) {
    lines.push(`基地「${group.baseName}」（ID ${group.baseId}）可研究候选：`);
    if (group.candidates.length === 0) {
      lines.push('- （当前无可研究项）');
      continue;
    }
    for (const item of group.candidates) {
      lines.push(
        `- ${item.name} ｜ 费用 ${item.cost} ｜ 工期 ${item.eta} ｜ ${item.affordable ? '资金充足' : '资金不足'}`,
      );
    }
  }
  return lines.join('\n');
}

// ───────────────────────── §3.8 注入配置 ─────────────────────────

export const RESEARCH_ADVISORY_INJECT_ID = 'tavernweave.research-advisory.v1';

export const RESEARCH_ADVISORY_INJECT_CONFIG = {
  id: RESEARCH_ADVISORY_INJECT_ID,
  position: 'in_chat',
  depth: 0,
  role: 'system',
  should_scan: false,
} as const;

export type ResearchAdvisoryInjection = typeof RESEARCH_ADVISORY_INJECT_CONFIG & { content: string };

export function buildResearchAdvisoryInjection(advisory: ResearchAdvisory): ResearchAdvisoryInjection {
  return { ...RESEARCH_ADVISORY_INJECT_CONFIG, content: formatResearchAdvisory(advisory) };
}

// ───────────────────────── 组合入口（供 RAC-ENTRY-01） ─────────────────────────

export interface ResearchAdvisoryPlan {
  entry: GenerationEntry;
  scanStart: number;
  snapshot: FloorSnapshot;
  advisory: ResearchAdvisory;
  injection: ResearchAdvisoryInjection;
}

/**
 * 一次 AFTER_COMMANDS 的完整纯推导：生成类型判定 → 扫描起点 → 最近有效楼 → 分组建议 → 注入配置。
 * 任一环节 fail-closed → null。楼层读取以 reader 注入，本函数不触碰酒馆 API。
 * R3：`dynamicWb`（可选）透传至 deriveResearchAdvisory，世界书新增研究由此进入建议候选；不传时行为不变。
 */
export function planResearchAdvisory(input: {
  generation: GenerationDescriptor;
  lastMessageId: number;
  readFloor: (id: number) => FloorCandidate | null;
  overlays: readonly DlcOverlay[];
  /** R3：世界书动态目录（可选）；缺席时退化为「静态基线 + DLC overlay」两源合并 */
  dynamicWb?: ParsedWorldbookCatalog | DynamicWorldbookCatalog | null;
}): ResearchAdvisoryPlan | null {
  const entry = resolveGenerationEntry(input.generation);
  if (!entry) return null;
  const scanStart = resolveScanStart(entry, input.lastMessageId);
  const snapshot = scanLatestValidFloor(scanStart, input.readFloor);
  const advisory = deriveResearchAdvisory(snapshot, input.overlays, input.dynamicWb);
  if (!snapshot || !advisory) return null;
  return { entry, scanStart, snapshot, advisory, injection: buildResearchAdvisoryInjection(advisory) };
}
