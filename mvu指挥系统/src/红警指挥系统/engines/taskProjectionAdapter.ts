/**
 * taskProjectionAdapter.ts —— 阶段一全景只读视图投影适配器（UTO-PROJ-01）
 *
 * 真源：
 * - docs/design/systems/通用任务编排器总设计案.md（CTRL-UTO-CORE-01 §3 阶段一）
 * - docs/project/plans/通用任务编排器MVP任务包.md §2.2 / §3.3 / §6（任务卡 UTO-PROJ-01）
 *
 * 设计红线（任务包总原则 · 阶段一只读单向铁律）：
 * 1. 纯函数：零 Pinia、零 Vue、零宿主 API、零 DOM 引用、零未受控全局变量写入；
 *    对入参 state（bases/queues/projects）、catalog、lanes 零突变（入参被深冻结亦 100% 正常工作）；
 * 2. 只读单向投影：仅实现 toUnifiedTasks（queues[] + projects[] → UnifiedTask[]），
 *    绝不实现或暴露 fromUnifiedTasks 反向写回（阶段一红线，杜绝 queue_index 指针漂移源）；
 * 3. 双账本归一化与防双影：先扫 projects[] 建立队列领用表（claimedQueueIndices），
 *    已被工程分段领用（含 canon 身份核验通过）的 queues[k] 不再生成游离 "task:queue:${k}"；
 * 4. 指针漂移防御：queue_index 越界或名字张冠李戴 → 不领用、不崩溃，
 *    子任务按无队列项兜底映射并标记 metadata.syncWarn / syncWarnReason（fail-open）。
 *
 * 实现裁量（登记回执，非设计变更）：
 * a. laneKey 主通道恒为 LaneRegistryHub.resolveLaneKeyForTxn（黄金等价 settleFloor.ts L570-571）；
 *    catalog 缺席时以模块内空目录常量构造 LaneResolveEnv——工程槽推导（makeEngLaneKeyFor）
 *    不消费 catalog，行为逐字节不变；生产/建造关键词推导同样不依赖 catalog，仅 lane.default
 *    兜底语义对齐「未登记目录项」现状；
 * b. lanes 辅助对齐（任务卡签名第三参）：传入 lanes 且 hub 推导键不在其列时，按
 *    (baseId, 领域覆盖) 取首个候选对齐；无候选保留 hub 键（fail-open，不抛错）；
 * c. 指针合一身份核验与 projectEngine.syncProjects 同源口径：
 *    q 存在 && q.type === '工程' && canon(q.item) === canon(projectionItemName(ref, segName))；
 * d. syncWarnReason 二值枚举：'queue_index_out_of_bounds'（指针越界/queues 缺席）｜
 *    'queue_item_mismatch'（类型/名字失配，含同一队列项被多个分段重复指向的双影防御）；
 * e. V1 未入队阶段属地取 projectEngine.phaseBase（theater 轮转 / base 恒 lead_base）；
 *    V2 未入队模块属地取 projectEngine.moduleBase（显式指派 → theater 轮转 → lead_base，
 *    严格包含任务卡公式「mod.base || lead_base」的 base 工程情形）；
 * f. V1 缺省工程槽 = 注册表首槽（eng.main）；V2 缺省槽 = 注册表首个 project-only 槽
 *    （eng.orbital）——均从 ENGINEERING_SLOT_REGISTRY 数据驱动解析（projectEngine 同口径）；
 * g. 未入队分段（queue_index === null）的额定 workload 从 catalog 静态定义回填
 *    （days × 1440 / min_days / tflops / tops / resources.nanites，对齐
 *    projectEngine.buildProjection 裁量 h 投影口径）；已入队分段则以队列账本实况为准
 *    （total_minutes / spent_minutes / min_days_lock / cost_paid / started_at / eta），
 *    tflops/tops/nanites 仍从静态定义补齐（队列项不携带算力指标）；
 * h. 游离队列项的静态规格提取：'研究' 条目 passthrough workload 块（tflops/tops）、
 *    '建造'/'生产' 条目 passthrough assembly 块（req_nanites → naniteCost）——
 *    正有限数口径（对齐 settleFloor.readPosNum）；'工程' 游离项复用
 *    projectEngine.engAssemblySpecFor（V1 phases / V2 modules 同命名合同）；
 * i. 输出顺序：每个工程先父级总成容器后分段子任务（定义序），随后游离队列任务按
 *    queues[] 下标升序；id 全局唯一（工程前缀 "task:proj:" / 队列前缀 "task:queue:"）；
 * j. 父级总成容器 workload 汇总全部子任务 totalMinutes/spentMinutes；laneKey 取
 *    「lead_base × 本代缺省槽」，不占工位带宽（tickTaskOrchestration 第一阶段排除纯容器）。
 */

import type { EffectiveCatalog } from '../core/catalogEffective';
import { ENGINEERING_SLOT_REGISTRY } from './engineeringSlots';
import {
  engAssemblySpecFor,
  moduleBase,
  phaseBase,
  projectionItemName,
  type EngAssemblyDefSource,
} from './projectEngine';
import { canon } from '../parse/parsePipeline';
import {
  isProjectV2,
  type Project,
  type ProjectModule,
  type ProjectPhase,
  type ProjectV1,
  type ProjectV2,
} from '../core/schema';
import { createLaneRegistryHub, type LaneRegistryHub } from './laneProviders';
import {
  projectSegmentStatusToTaskStatus,
  queueStatusToTaskStatus,
  queueTypeToTaskDomain,
  type LaneResolveEnv,
  type LaneStationView,
  type TaskDomain,
  type TaskStatus,
  type UnifiedTask,
} from './taskOrchestrator';
import type { TransactionItem } from './transactionEngine';

/* ═══════════════ 公共类型与常量契约（§3.3） ═══════════════ */

/** 投影输入状态快照（stat_data 双账本只读子集；全部字段可选，缺席按空账本处理） */
export interface ProjectionStateInput {
  /** 战区基地清册（工程槽属地容量与 laneKey 推导用；LaneResolveEnv.bases 同形） */
  bases?: LaneResolveEnv['bases'];
  /**
   * stat_data.queues[] 队列账本（QueueItem v2 输出 ≡ TransactionItem 结构视图＋可选 lane 字段，
   * transactionEngine.ts L24 原话「与 schema.ts QueueItem 输出对齐」；schema 未导出类型别名，本地对齐）
   */
  queues?: ReadonlyArray<QueueLike>;
  /** stat_data.projects[] 工程账本（V1 phases[] / V2 modules[] 判别联合，只读） */
  projects?: ReadonlyArray<Project>;
}

/** 指针漂移防御告警原因（fail-open 降级留痕，供 UI 与对账观察） */
export type ProjectionSyncWarnReason = 'queue_index_out_of_bounds' | 'queue_item_mismatch';

/** catalog 缺席时的空目录兜底常量（模块内只读纪律：绝不修改） */
const EMPTY_CATALOG: EffectiveCatalog = {
  researches: [],
  buildings: [],
  productions: [],
  retrofits: [],
  projects: [],
  factionDefs: [],
  protocols: [],
};

/** 游戏内一日分钟数（对齐 projectEngine.MINUTES_PER_DAY 投影口径） */
const MINUTES_PER_DAY = 1440;

/** V1 缺省工程槽显式入口（注册表首槽 eng.main；projectEngine.MAIN_SLOT 同口径） */
const V1_DEFAULT_ENG_LANE = `eng:${ENGINEERING_SLOT_REGISTRY[0].slotId}`;

/** V2 缺省专属工程槽显式入口（注册表首个 project-only 槽，现 eng.orbital；数据驱动解析） */
const V2_DEFAULT_ENG_LANE = `eng:${
  (
    ENGINEERING_SLOT_REGISTRY.find(s => s.accepts.includes('project') && !s.accepts.includes('retrofit')) ??
    ENGINEERING_SLOT_REGISTRY[0]
  ).slotId
}`;

/** 工程父级总成容器任务 ID 前缀 */
const PROJ_TASK_PREFIX = 'task:proj';

/* ═══════════════ 内部只读视图与工具（零入参突变） ═══════════════ */

/** 队列账本元素统一视图（schema.QueueItem v2 输出 ≡ TransactionItem ＋ 可选 lane 字段） */
type QueueLike = TransactionItem & { lane?: string };

/** 事务视图（传给 LaneRegistryHub 推导 laneKey 的最小结构，恒为新构造对象） */
interface TxnView {
  type: string;
  item: string;
  base: string;
  lane?: string;
}

/** 静态分段 workload 块最小视图（RetrofitPhaseWorkload ≡ ProjectModuleWorkload 同构） */
interface StaticWorkloadView {
  days?: number;
  min_days?: number;
  tflops?: number;
  tops?: number;
}

/** 静态分段定义最小视图（V1 RetrofitPhase / V2 ProjectModuleDef 共用） */
interface StaticSegmentDef {
  name: string;
  workload?: StaticWorkloadView;
  resources?: { nanites?: number };
}

/** 有限非负数兜底（NaN/Infinity/undefined/null → 0；负数 → 0） */
function numOr0(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** 正有限数判定（对齐 settleFloor.readPosNum 口径；非正或非法 → undefined） */
function posNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 读取队列项可选 lane 字段（QueueItem.lane / TransactionItem 无此字段 → undefined） */
function queueLaneOf(q: QueueLike): string | undefined {
  const lane = (q as { lane?: unknown }).lane;
  return typeof lane === 'string' && lane.trim().length > 0 ? lane : undefined;
}

/** 工程分段状态（中文五态）→ 统一七态（无队列项兜底路径） */
function projectRootStatusToTaskStatus(status: string): TaskStatus {
  switch (status) {
    case '规划中':
      return 'draft';
    case '在建':
      return 'active';
    case '暂停':
      return 'held';
    case '完工':
      return 'completed';
    case '取消':
      return 'cancelled';
    default:
      return 'draft';
  }
}

/** 工位领域覆盖判定（lanes 辅助对齐用：production 工位承接建造/改装、retrofit 工位承接巨构） */
function laneDomainCovers(laneDomain: TaskDomain, taskDomain: TaskDomain): boolean {
  if (laneDomain === taskDomain) return true;
  if (laneDomain === 'production') {
    return taskDomain === 'construction' || taskDomain === 'retrofit';
  }
  if (laneDomain === 'retrofit') {
    return taskDomain === 'megastructure';
  }
  return false;
}

/** 投影上下文（单次 toUnifiedTasks 调用内共享的只读引用与领用表；不逃逸出函数） */
interface ProjectionContext {
  readonly queues: readonly QueueLike[];
  readonly catalog: EffectiveCatalog | undefined;
  readonly lanes: ReadonlyArray<LaneStationView> | undefined;
  readonly hub: LaneRegistryHub;
  readonly env: LaneResolveEnv;
  /** 已被工程分段领用的队列下标集（防双影铁律） */
  readonly claimedQueueIndices: Set<number>;
}

/**
 * laneKey 推导主函数：LaneRegistryHub 黄金等价通道 ＋ lanes 辅助对齐（裁量 a/b）。
 * 辅助对齐仅限 hub 落入 v1 兜底键（`${base} ${type}`＝目录未解析条目）且 lanes 提供
 * 同基地同领域候选时替换；命名产线/研究/工程推导结果恒保留 hub 键（黄金等价铁律，
 * 不被不完整 lanes 子集越权改写）。恒返回字符串，绝不抛错。
 */
function resolveLaneKey(txn: TxnView, domain: TaskDomain, ctx: ProjectionContext): string {
  const hubKey = ctx.hub.resolveLaneKeyForTxn(txn as TransactionItem, ctx.env);
  const lanes = ctx.lanes;
  if (!lanes || lanes.length === 0) return hubKey;
  const base = txn.base ?? '';
  const fellBackToV1Default = hubKey === `${base} ${txn.type}`;
  if (!fellBackToV1Default) return hubKey;
  const candidates = lanes.filter(l => (l.baseId ?? '') === base && laneDomainCovers(l.domain, domain));
  return candidates.length > 0 ? candidates[0].laneKey : hubKey;
}

/** 工程类事务 laneKey（显式槽位入口；缺省槽由世代口径决定，裁量 f） */
function engLaneKeyFor(
  base: string,
  item: string,
  explicitLane: string,
  domain: TaskDomain,
  ctx: ProjectionContext,
): string {
  return resolveLaneKey({ type: '工程', item, base, lane: explicitLane }, domain, ctx);
}

/* ═══════════════ 静态定义查找（canon 身份匹配，canon(ref) 先例） ═══════════════ */

/** V1 改装工程静态定义查找（catalog.retrofits 按 canon(name) === canon(ref)） */
function findV1Segments(ref: string, ctx: ProjectionContext): readonly StaticSegmentDef[] | undefined {
  const def = ctx.catalog?.retrofits.find(d => canon(d.name) === canon(ref));
  return def?.phases as readonly StaticSegmentDef[] | undefined;
}

/** V2 仓段化工程静态定义查找（catalog.projects 优先；retrofits 兜底为防御通道，实际不命中） */
function findV2Segments(ref: string, ctx: ProjectionContext): readonly StaticSegmentDef[] | undefined {
  const pools = [ctx.catalog?.projects, ctx.catalog?.retrofits];
  for (const pool of pools) {
    for (const def of pool ?? []) {
      const record = def as unknown as { name?: unknown; modules?: unknown };
      if (canon(record.name) !== canon(ref)) continue;
      if (Array.isArray(record.modules)) {
        return record.modules as readonly StaticSegmentDef[];
      }
    }
  }
  return undefined;
}

/** V2 模块静态定义的 prereqs 拓扑边（模块 id → 前置模块 id 集；定义缺席 → 空集防御） */
function findV2ModulePrereqs(ref: string, moduleId: string, ctx: ProjectionContext): readonly string[] {
  const defs = ctx.catalog?.projects.find(d => canon(d.name) === canon(ref));
  const modDef = defs?.modules.find(m => m.id === moduleId);
  return modDef?.prereqs ?? [];
}

/* ═══════════════ 指针合一与防双影（§3.3 铁律） ═══════════════ */

/** 队列项领用结果 */
interface QueueClaim {
  /** 身份核验通过的队列项（吸收进度与状态；undefined = 未领用） */
  readonly queue?: QueueLike;
  /** 领用下标（核验通过时存在，写入 metadata.queueIndex） */
  readonly queueIndex?: number;
  /** 指针漂移告警（fail-open 降级，不领用不崩溃） */
  readonly syncWarnReason?: ProjectionSyncWarnReason;
  /** 告警细节（人读留痕） */
  readonly syncWarnDetail?: string;
}

/**
 * 指针合一核验（防双影铁律，裁量 c/d）：
 * - queueIndex 非法（null/负数）→ 未入队（非告警，走静态 workload 回填）；
 * - 越界（queues 缺席或下标超界）→ syncWarn 'queue_index_out_of_bounds'；
 * - q.type !== '工程' 或 canon(item) 身份失配（张冠李戴）→ syncWarn 'queue_item_mismatch'；
 * - 同一下标已被其他分段领用（畸形双指向）→ syncWarn 'queue_item_mismatch'（第二个不吸收）；
 * - 核验通过 → 记入 claimedQueueIndices，步骤二不再为该下标生成游离任务。
 */
function claimQueueItem(expectedName: string, queueIndex: number | null, ctx: ProjectionContext): QueueClaim {
  if (queueIndex === null || !Number.isInteger(queueIndex) || queueIndex < 0) {
    return {};
  }
  const queues = ctx.queues;
  const q = queueIndex < queues.length ? queues[queueIndex] : undefined;
  if (q === undefined) {
    return {
      syncWarnReason: 'queue_index_out_of_bounds',
      syncWarnDetail: `queue_index=${queueIndex} 越界（queues 长度 ${queues.length}）`,
    };
  }
  if (ctx.claimedQueueIndices.has(queueIndex)) {
    return {
      syncWarnReason: 'queue_item_mismatch',
      syncWarnDetail: `queue_index=${queueIndex} 已被其他拓扑节点领用（畸形双指向防双影）`,
    };
  }
  if (q.type !== '工程' || canon(q.item) !== canon(expectedName)) {
    return {
      syncWarnReason: 'queue_item_mismatch',
      syncWarnDetail: `queue_index=${queueIndex} 身份失配（实读「${q.item}」≠ 期望「${expectedName}」）`,
    };
  }
  ctx.claimedQueueIndices.add(queueIndex);
  return { queue: q, queueIndex };
}

/* ═══════════════ workload 组装 ═══════════════ */

/** 静态分段 workload → 统一 workload 视图（未入队分段回填，裁量 g；buildProjection 同口径） */
function staticWorkloadToTaskWorkload(def: StaticSegmentDef | undefined): {
  totalMinutes: number;
  spentMinutes: number;
  minDaysLock: number;
  tflopsRequired?: number;
  topsRequired?: number;
  naniteCost?: number;
} {
  const workload = def?.workload;
  const days = numOr0(workload?.days);
  const minDays = numOr0(workload?.min_days);
  return {
    totalMinutes: days > 0 ? days * MINUTES_PER_DAY : 0,
    spentMinutes: 0,
    minDaysLock: minDays > 0 ? minDays : 0,
    tflopsRequired: posNum(workload?.tflops),
    topsRequired: posNum(workload?.tops),
    naniteCost: posNum(def?.resources?.nanites),
  };
}

/** 队列项实况 + 静态算力指标 → 统一 workload 视图（已入队分段吸收，裁量 g） */
function queueWorkloadWithStaticSpec(
  q: QueueLike,
  staticDef: StaticSegmentDef | undefined,
): {
  totalMinutes: number;
  spentMinutes: number;
  minDaysLock: number;
  tflopsRequired?: number;
  topsRequired?: number;
  naniteCost?: number;
} {
  const staticView = staticWorkloadToTaskWorkload(staticDef);
  return {
    totalMinutes: numOr0(q.total_minutes),
    spentMinutes: numOr0(q.spent_minutes),
    minDaysLock: numOr0(q.min_days_lock),
    tflopsRequired: staticView.tflopsRequired,
    topsRequired: staticView.topsRequired,
    naniteCost: staticView.naniteCost,
  };
}

/** 过滤 undefined 键（保持 workload 序列化干净） */
function compactWorkload(view: {
  totalMinutes: number;
  spentMinutes: number;
  minDaysLock: number;
  tflopsRequired?: number;
  topsRequired?: number;
  naniteCost?: number;
}): UnifiedTask['workload'] {
  return {
    totalMinutes: view.totalMinutes,
    spentMinutes: view.spentMinutes,
    minDaysLock: view.minDaysLock,
    ...(view.tflopsRequired !== undefined ? { tflopsRequired: view.tflopsRequired } : {}),
    ...(view.topsRequired !== undefined ? { topsRequired: view.topsRequired } : {}),
    ...(view.naniteCost !== undefined ? { naniteCost: view.naniteCost } : {}),
  };
}

/* ═══════════════ 工程分段子任务投影（V1 阶段 / V2 模块） ═══════════════ */

/** V1 线性阶段 → 统一子任务（id 阶梯、指针合一、静态 workload 回填、属地轮转） */
function phaseToTask(proj: ProjectV1, phase: ProjectPhase, index: number, ctx: ProjectionContext): UnifiedTask {
  const rootId = `${PROJ_TASK_PREFIX}:${proj.id}`;
  const phaseIdx = typeof phase.idx === 'number' ? phase.idx : index;
  const id = `${rootId}:phase:${phaseIdx}`;
  const name = projectionItemName(proj.ref, phase.name);
  const staticDefs = findV1Segments(proj.ref, ctx);
  const staticDef = staticDefs?.find(p => canon(p.name) === canon(phase.name));

  const claim = claimQueueItem(name, phase.queue_index, ctx);
  const base = claim.queue ? (claim.queue.base ?? '') : phaseBase(proj, phaseIdx);
  const txnLane = claim.queue ? queueLaneOf(claim.queue) : V1_DEFAULT_ENG_LANE;
  const laneKey = engLaneKeyFor(base, name, txnLane ?? V1_DEFAULT_ENG_LANE, 'retrofit', ctx);
  const workload = claim.queue
    ? compactWorkload(queueWorkloadWithStaticSpec(claim.queue, staticDef))
    : compactWorkload(staticWorkloadToTaskWorkload(staticDef));
  const status = projectSegmentStatusToTaskStatus(
    phase.status,
    claim.queue ? { status: claim.queue.status, hold: claim.queue.hold } : null,
  );

  return {
    id,
    domain: 'retrofit',
    name,
    scope: proj.scope,
    leadBaseId: base || undefined,
    laneKey,
    workload,
    status,
    costPaid: claim.queue ? claim.queue.cost_paid : undefined,
    ...(claim.queue && numOr0(claim.queue.qty) > 0
      ? { batch: { totalQty: numOr0(claim.queue.qty), completedQty: numOr0(claim.queue.qty_done) } }
      : {}),
    topology: {
      parentId: rootId,
      dependsOn: index > 0 ? [`${rootId}:phase:${prevPhaseKey(proj, index)}`] : [],
    },
    metadata: {
      sourceKind: 'project_phase',
      projectId: proj.id,
      phaseIdx,
      ...(claim.queueIndex !== undefined ? { queueIndex: claim.queueIndex } : {}),
      ...(claim.queue
        ? {
            rawType: claim.queue.type,
            startedAt: claim.queue.started_at,
            eta: claim.queue.eta,
          }
        : {}),
      ...(claim.syncWarnReason !== undefined
        ? { syncWarn: true, syncWarnReason: claim.syncWarnReason, syncWarnDetail: claim.syncWarnDetail }
        : {}),
    },
  };
}

/** V1 前一阶段任务 id 内嵌序号（数组序 i-1 对应阶段的 idx ?? i-1 兜底口径） */
function prevPhaseKey(proj: ProjectV1, index: number): number {
  const prev = proj.phases[index - 1];
  return typeof prev?.idx === 'number' ? prev.idx : index - 1;
}

/** V2 仓段模块 → 统一子任务（DAG 拓扑 dependsOn、指针合一、模块属地指派） */
function moduleToTask(proj: ProjectV2, mod: ProjectModule, index: number, ctx: ProjectionContext): UnifiedTask {
  const rootId = `${PROJ_TASK_PREFIX}:${proj.id}`;
  const id = `${rootId}:mod:${mod.id}`;
  const segName = mod.name && mod.name.trim().length > 0 ? mod.name : mod.id;
  const name = projectionItemName(proj.ref, segName);
  const staticDefs = findV2Segments(proj.ref, ctx);
  const staticDef = staticDefs?.find(m => canon(m.name) === canon(segName));
  const dependsOn = findV2ModulePrereqs(proj.ref, mod.id, ctx).map(p => `${rootId}:mod:${p}`);

  const claim = claimQueueItem(name, mod.queue_index, ctx);
  const base = claim.queue ? (claim.queue.base ?? '') : moduleBase(proj, mod, index);
  const txnLane = claim.queue ? queueLaneOf(claim.queue) : V2_DEFAULT_ENG_LANE;
  const laneKey = engLaneKeyFor(base, name, txnLane ?? V2_DEFAULT_ENG_LANE, 'megastructure', ctx);
  const workload = claim.queue
    ? compactWorkload(queueWorkloadWithStaticSpec(claim.queue, staticDef))
    : compactWorkload(staticWorkloadToTaskWorkload(staticDef));
  const status = projectSegmentStatusToTaskStatus(
    mod.status,
    claim.queue ? { status: claim.queue.status, hold: claim.queue.hold } : null,
  );
  const canAllocate =
    proj.scope === 'theater' && Array.isArray(proj.bases) && proj.bases.length >= 2 && mod.status === '未启动';
  const allocatableBases = canAllocate ? [...proj.bases] : undefined;

  return {
    id,
    domain: 'megastructure',
    name,
    scope: proj.scope,
    leadBaseId: base || undefined,
    ...(proj.scope === 'theater' && Array.isArray(proj.bases) && proj.bases.length > 0
      ? { participatingBases: [...proj.bases] }
      : {}),
    ...(canAllocate ? { canAllocate: true, allocatableBases } : {}),
    laneKey,
    workload,
    status,
    costPaid: claim.queue ? claim.queue.cost_paid : undefined,
    ...(claim.queue && numOr0(claim.queue.qty) > 0
      ? { batch: { totalQty: numOr0(claim.queue.qty), completedQty: numOr0(claim.queue.qty_done) } }
      : {}),
    topology: { parentId: rootId, dependsOn },
    metadata: {
      sourceKind: 'project_module',
      projectId: proj.id,
      moduleId: mod.id,
      ...(canAllocate ? { canAllocate: true, allocatableBases: [...proj.bases] } : {}),
      ...(claim.queueIndex !== undefined ? { queueIndex: claim.queueIndex } : {}),
      ...(claim.queue
        ? {
            rawType: claim.queue.type,
            startedAt: claim.queue.started_at,
            eta: claim.queue.eta,
          }
        : {}),
      ...(claim.syncWarnReason !== undefined
        ? { syncWarn: true, syncWarnReason: claim.syncWarnReason, syncWarnDetail: claim.syncWarnDetail }
        : {}),
    },
  } as UnifiedTask;
}

/* ═══════════════ 父级总成容器投影 ═══════════════ */

/** 工程（V1/V2）→ 父级总成容器任务 ＋ 全部分段子任务（容器先出、子任务定义序跟随） */
function projectToTasks(proj: Project, ctx: ProjectionContext): UnifiedTask[] {
  const isV2 = isProjectV2(proj);
  const rootId = `${PROJ_TASK_PREFIX}:${proj.id}`;

  const children: UnifiedTask[] = [];
  if (isV2) {
    proj.modules.forEach((mod, j) => children.push(moduleToTask(proj, mod, j, ctx)));
  } else {
    const v1 = proj as ProjectV1;
    v1.phases.forEach((phase, i) => children.push(phaseToTask(v1, phase, i, ctx)));
  }

  const root: UnifiedTask = {
    id: rootId,
    domain: isV2 ? 'megastructure' : 'retrofit',
    name: proj.ref,
    scope: proj.scope,
    leadBaseId: proj.lead_base || undefined,
    participatingBases: [...proj.bases],
    laneKey: engLaneKeyFor(
      proj.lead_base ?? '',
      proj.ref,
      isV2 ? V2_DEFAULT_ENG_LANE : V1_DEFAULT_ENG_LANE,
      isV2 ? 'megastructure' : 'retrofit',
      ctx,
    ),
    workload: {
      totalMinutes: children.reduce((sum, t) => sum + t.workload.totalMinutes, 0),
      spentMinutes: children.reduce((sum, t) => sum + t.workload.spentMinutes, 0),
    },
    status: projectRootStatusToTaskStatus(proj.status),
    topology: { subTaskIds: children.map(c => c.id) },
    metadata: { sourceKind: 'project_root', projectId: proj.id },
  };
  return [root, ...children];
}

/* ═══════════════ 游离队列项投影（步骤二） ═══════════════ */

/** 游离队列项静态规格提取（'工程' 走 engAssemblySpecFor；其余按类型选池防御读取，裁量 h） */
function staticSpecForQueueItemTyped(
  q: QueueLike,
  ctx: ProjectionContext,
): {
  tflopsRequired?: number;
  topsRequired?: number;
  naniteCost?: number;
} {
  const catalog = ctx.catalog;
  if (!catalog) return {};
  if (q.type === '工程') {
    const defs: ReadonlyArray<EngAssemblyDefSource> = [...catalog.retrofits, ...catalog.projects];
    const spec = engAssemblySpecFor(defs, { type: q.type, item: q.item });
    return {
      ...(posNum(spec?.tflops) !== undefined ? { tflopsRequired: spec?.tflops } : {}),
      ...(posNum(spec?.tops) !== undefined ? { topsRequired: spec?.tops } : {}),
    };
  }
  const pool: ReadonlyArray<{ name: string }> =
    q.type === '建造'
      ? catalog.buildings
      : q.type === '生产'
        ? catalog.productions
        : q.type === '研究'
          ? catalog.researches
          : q.type === '改装'
            ? catalog.retrofits
            : [];
  const entry = pool.find(e => canon(e.name) === canon(q.item)) as
    { workload?: { tflops?: unknown; tops?: unknown }; assembly?: { req_nanites?: unknown } } | undefined;
  return {
    ...(posNum(entry?.workload?.tflops) !== undefined ? { tflopsRequired: posNum(entry?.workload?.tflops) } : {}),
    ...(posNum(entry?.workload?.tops) !== undefined ? { topsRequired: posNum(entry?.workload?.tops) } : {}),
    ...(posNum(entry?.assembly?.req_nanites) !== undefined ? { naniteCost: posNum(entry?.assembly?.req_nanites) } : {}),
  };
}

/** 未被工程领用的队列项 → 游离统一任务（id = "task:queue:${idx}"，全领域映射） */
function queueItemToTask(q: QueueLike, idx: number, ctx: ProjectionContext): UnifiedTask {
  const domain = queueTypeToTaskDomain(q.type);
  const txn: TxnView = { type: q.type, item: q.item, base: q.base ?? '', lane: queueLaneOf(q) };
  const laneKey = resolveLaneKey(txn, domain, ctx);
  const spec = staticSpecForQueueItemTyped(q, ctx);
  const qty = numOr0(q.qty) > 0 ? numOr0(q.qty) : 1;

  return {
    id: `task:queue:${idx}`,
    domain,
    name: q.item,
    scope: q.type === '研究' || q.type === '协议' ? 'theater' : 'base',
    leadBaseId: (q.base ?? '') || undefined,
    laneKey,
    workload: {
      totalMinutes: numOr0(q.total_minutes),
      spentMinutes: numOr0(q.spent_minutes),
      minDaysLock: numOr0(q.min_days_lock),
      ...spec,
    },
    status: queueStatusToTaskStatus(q.status, Boolean(q.hold)),
    costPaid: q.cost_paid,
    batch: { totalQty: qty, completedQty: numOr0(q.qty_done) },
    metadata: {
      sourceKind: 'queue',
      queueIndex: idx,
      rawType: q.type,
      startedAt: q.started_at,
      eta: q.eta,
    },
  };
}

/* ═══════════════ 主入口：单向只读投影（§3.3 核心签名） ═══════════════ */

/**
 * 阶段一双账本单向只读投影（§3.3）：
 * stat_data.queues[] ＋ stat_data.projects[]（V1 phases[] 线性阶梯 / V2 modules[] 仓段 DAG）
 * → UnifiedTask[] 全景任务快照。
 *
 * 步骤一（防双影）：扫描 projects[]，逐工程产出父级总成容器与分段子任务；
 * queue_index 经 canon(ref)·canon(segName) 身份核验通过的分段直接吸收队列项
 * （进度/状态/时刻/属地/lane），并将军用下标记进 claimedQueueIndices；
 * 越界或失配 → syncWarn 降级（不领用、不崩溃，队列项保留为游离任务）。
 * 步骤二：扫描未被领用的 queues[]，逐项产出 "task:queue:${idx}" 游离任务。
 *
 * 只读铁律：对 state / catalog / lanes 零突变；返回体为全新构造对象，
 * 调用方修改返回体不回渗入参；绝不写回任何账本（无 fromUnifiedTasks 通道）。
 */
export function toUnifiedTasks(
  state: ProjectionStateInput,
  catalog?: EffectiveCatalog,
  lanes?: ReadonlyArray<LaneStationView>,
): UnifiedTask[] {
  const queues = state.queues ?? [];
  const projects = state.projects ?? [];
  const hub = createLaneRegistryHub();
  const ctx: ProjectionContext = {
    queues,
    catalog,
    lanes,
    hub,
    env: { bases: state.bases ?? [], queues, catalog: catalog ?? EMPTY_CATALOG },
    claimedQueueIndices: new Set<number>(),
  };

  const tasks: UnifiedTask[] = [];
  for (const proj of projects) {
    for (const task of projectToTasks(proj, ctx)) {
      tasks.push(task);
    }
  }
  for (let idx = 0; idx < queues.length; idx++) {
    if (ctx.claimedQueueIndices.has(idx)) continue;
    tasks.push(queueItemToTask(queues[idx], idx, ctx));
  }
  return tasks;
}
