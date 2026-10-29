/**
 * schedulePanelModel.ts —— 工程日程面板视图模型（CTRL-UI-SCHEDULE-01 / UTO-UI-SCHED-01 全景工位矩阵接入）
 *
 * 真源与纪律：
 * - 同源渲染红线：通过通用任务编排器（UTO）的 `LaneRegistryHub`（`createLaneRegistryHub`）与
 *   `toUnifiedTasks` 单向只读投影适配器，同源派生各基地制造产线（9 大产线）、战区科研序列（11 大序列）
 *   与属地工程工位（`eng.main` 通用工程槽 / `eng.orbital` 轨道组装泊位，含 V1 线性阶段与 V2 仓段模块），
 *   彻底消除面板模型内部重复拼装或遗漏工程工位的多账本分流冗余；
 * - 谓语与色调同源：工况系数走 `makeTxnEffFor`，状态谓语走 `scheduleText.predicateFor`（带同工位前序
 *   「列于X之后」），五态色调走 `queueDisplayModel`，显示名/锁定理由/空态文案全部源自 `SCHEDULE_COPY`；
 * - 只读观察者红线：仅作 UTO 只读投影消费，零宿主变量写路径；
 * - 🔴 纯函数：零 IO / 零 DOM / 零 vue·pinia / 零酒馆 API；不原地修改入参。
 */
import type { EffectiveCatalog } from '../../红警指挥系统/core/catalogEffective';
import {
  createLaneRegistryHub,
  PROTOCOL_LANE_DISPLAY_NAME,
  PROTOCOL_LANE_KEY,
  ProtocolLaneProvider,
  type LaneRegistryHub,
  type ProtocolLaneCatalogItemLike,
  type ProtocolLaneInputItem,
  type ProtocolLaneItemView,
} from '../../红警指挥系统/engines/laneProviders';
import { laneDefFromKey } from '../../红警指挥系统/engines/productionLanes';
import { dailyProtocolPointRate, scanActiveProtocolBuildings } from '../../红警指挥系统/engines/protocolAnchors';
import { SCHEDULE_COPY } from '../../红警指挥系统/planning/scheduleCopy';
import { fmtMinutes, hasProtocolScheduleActivity, isScheduled, predicateFor } from '../../红警指挥系统/planning/scheduleText';
import { makeTxnEffFor } from '../../红警指挥系统/engines/settleFloor';
import {
  taskStatusToQueueState,
  type LaneResolveEnv,
  type LaneStationView,
  type TaskDomain,
  type TaskMetadata,
  type TaskStatus,
  type UnifiedTask,
} from '../../红警指挥系统/engines/taskOrchestrator';
import { toUnifiedTasks, type ProjectionStateInput } from '../../红警指挥系统/engines/taskProjectionAdapter';
import type { TransactionItem } from '../../红警指挥系统/engines/transactionEngine';
import type { PlanningReceipt, Project, ProtocolInstance, Schema } from '../../红警指挥系统/core/schema';
import { queueDisplayModel, type QueueTone } from './queueDisplayModel';
import {
  buildDomainScheduleGroups,
  buildDraftDependencyIndex,
  precomputeGlobalAccelCountByLane,
  scheduleLaneSubTracks,
  summarizeLaneDualModeBuildings,
  type DomainScheduleGroup,
  type GanttSubTrackRow,
  type LaneDualModeSummary,
  type ScheduleKpiSummary,
} from './scheduleGanttModel';

export * from './scheduleGanttModel';

type QueueItem = Schema['queues'][number];

/** 默认工位环境注册中心实例（内置制造 9 线 + 科研 11 槽 + 工程双槽提供者） */
export const defaultLaneRegistryHub: LaneRegistryHub = createLaneRegistryHub();

/** 协议攻关泳道提供者实例（UTO-LANE-01：默认挂载最高统帅部协议推演序列） */
export const defaultProtocolLaneProvider: ProtocolLaneProvider = new ProtocolLaneProvider();

/** 日程面板选项（UTO-LANE-01：includeProtocol 默认为 true） */
export interface SchedulePanelOptions {
  includeProtocol?: boolean;
}

/** 队列项兼容扩展（兼容 duration_minutes 或 total_minutes 输入） */
export type MilestoneQueueItemLike = Partial<QueueItem> & {
  duration_minutes?: number;
};

/** 面板消费的快照最小结构（兼容 Schema 与双账本 queues[] + projects[] + protocols[]） */
export interface SchedulePanelInput {
  bases?: Array<{
    id?: string;
    name?: string;
    status?: string;
    buildings?: Array<{ name?: string; state?: string; status?: string; mode?: string; accel_scope?: string }>;
  }>;
  queues?: MilestoneQueueItemLike[];
  projects?: Project[];
  protocols?: Array<Partial<ProtocolInstance> & ProtocolLaneInputItem>;
  protocol_points?: number;
  clock?: { day: number; time: string };
  planning?: { latest_receipt?: PlanningReceipt | null; protected_task_refs?: string[] } | null;
}

export type ScheduleGanttState = 'active' | 'queued' | 'paused' | 'settling' | 'done';

/** 顶栏「下一已知里程碑提示」横幅视图模型（UX-SCHED-01 · UX-07） */
export interface NextMilestoneBanner {
  hasMilestone: boolean;
  label: '待确认完工' | '最近完工项' | '暂无在建任务';
  itemName: string | null;
  baseName: string | null;
  remainingMinutes: number | null;
  summary: string;
}

/** 最高统帅部协议攻关泳道视图模型（UTO-LANE-01） */
export interface ScheduleProtocolLaneModel {
  laneKey: string;
  displayName: string;
  enabled: boolean;
  hasActivity: boolean;
  protocolPoints: number;
  dailyRate: number;
  institutesText: string;
  items: ProtocolLaneItemView[];
  station: LaneStationView;
}

export interface ScheduleTxnRow {
  item: string;
  /** 队列事务类型（生产/研究/建造/改装/工程；调度令指令文本消歧用，CTRL-UI-DISPATCH-01） */
  type: QueueItem['type'];
  /** 基地引用原值（研究全局唯一可为 ''；调度令指令文本基地消歧用） */
  base: string;
  /** 暂缓标记（§2.3 调度令；行内「暂缓/恢复」按钮态同源） */
  hold: boolean;
  status: QueueItem['status'];
  /** 五态色调（queueDisplayModel 同源映射，供组件配色） */
  tone: QueueTone;
  /** predicateFor 同源谓语（带 lane 内前序「列于X之后」，与注入文本逐字一致） */
  predicate: string;
  /** 甘特横道条完成百分比（0 ~ 100，UX-SCHED-01） */
  ganttPct: number;
  /** 甘特横道条色彩状态（UX-SCHED-01） */
  ganttState: ScheduleGanttState;
  /** 预计剩余分钟数（未知工期为 null，待收讫/已完工为 0，UX-SCHED-01） */
  remainingMinutes: number | null;
  /** 统一任务全局唯一标识（UTO-UI-SCHED-01 同源追踪） */
  taskId?: string;
  /** 统一任务所属业务领域（UTO-UI-SCHED-01） */
  domain?: TaskDomain;
  /** 统一任务七态状态（UTO-UI-SCHED-01） */
  taskStatus?: TaskStatus;
  /** 统一任务来源分类（queue / project_phase / project_module） */
  sourceKind?: TaskMetadata['sourceKind'];
  /** 原队列下标（queues[] 中的索引，供即时编排定位） */
  queueIndex?: number;
  /** 子轨道编号（0-based，工位 #1 为 0） */
  subTrackIndex?: number;
  /** 距离当前时钟 T=0 的预计开工偏移分钟数（active 为 0，queued 为前序释放时刻） */
  startOffsetMin?: number;
  /** 距离当前时钟 T=0 的预计完工偏移分钟数 */
  endOffsetMin?: number;
  /** 世界内预计开工时刻文案（如 "第6日 13:30" 或 "当前时刻"） */
  startEtaText?: string;
  /** 世界内预计完工时刻文案（如 "第6日 19:30"） */
  endEtaText?: string;
  /** 当前生效的综合推进倍率（如 1.5） */
  effectiveAccel?: number;
  /** 最低锁定天数提示（min_days_lock > 0 时存在） */
  minDaysLock?: number;
  /** 批次进度文案（qty > 1 时如 "0/5 批"） */
  batchText?: string;
  /** 是否为未启动后续工程阶段拓扑预览项 */
  isDraftPreview?: boolean;
}

/** 基地工位行（制造产线 + 工程工位同源矩阵：直呈 capacity/active/queued，容量 0 滞留态标 stranded） */
export interface ScheduleProdLaneRow {
  key: string;
  name: string;
  capacity: number;
  activeCount: number;
  queuedCount: number;
  /** 在编项 item 名（active 直呈） */
  activeItems: string[];
  /** 容量 0 仍有在编/候列 → 滞留态（产能锚定建筑不在场） */
  stranded: boolean;
  txns: ScheduleTxnRow[];
  /** 工位所属业务领域（production 制造产线 / retrofit 工程工位） */
  domain?: TaskDomain;
  /** 对应的 UTO 工位视图快照 */
  station?: LaneStationView;
  /** 未开通/容量 0 时的世界内锁定理由 */
  lockedReason?: string;
  /** 产线双模建筑实例与加速比统计（供左栏直接渲染双模切换器） */
  dualModeSummary?: LaneDualModeSummary;
  /** 当前产线生效加速倍率 */
  accelMultiplier?: number;
  /** 产线并行子轨道分组视图（供甘特图按工位 #1、#2 分轨渲染） */
  subTracks?: GanttSubTrackRow[];
  /** 关联的未启动后续阶段预览项（当开启「含后续阶段」时展示） */
  draftPreviews?: ScheduleTxnRow[];
}

export interface ScheduleBaseSection {
  key: string;
  name: string;
  /** 该基地无在编事务（空态行 SCHEDULE_COPY.baseEmpty） */
  empty: boolean;
  /** 废弃基地（Base.status='废弃'，CTRL-RETIRE-01 退役态）：模型只透传标记，
   *  呈现策略归组件（默认隐藏＋可切换检阅；实体保留可审计不丢弃） */
  retired: boolean;
  lanes: ScheduleProdLaneRow[];
}

/** 战区科研序列行（ResearchLaneProvider 直呈 unlocked/active/queued；恒 11 序列） */
export interface ScheduleSlotRow {
  key: string;
  slotId: string;
  /** 条令体显示名（SCHEDULE_COPY.researchLaneName，管线词「槽」不上面板） */
  name: string;
  unlocked: boolean;
  /** 并行上限：开通＝工位容量；未开通＝0 */
  limit: number;
  activeItems: string[];
  queuedCount: number;
  /** 未开通的世界内理由（anchor 未建成照实呈现——序列未开通因果） */
  lockedReason?: string;
  txns: ScheduleTxnRow[];
  /** 工位所属业务领域（恒为 research） */
  domain?: TaskDomain;
  /** 对应的 UTO 工位视图快照 */
  station?: LaneStationView;
  /** 科研工位并行子轨道分组视图 */
  subTracks?: GanttSubTrackRow[];
  /** 关联的未启动后续阶段预览项 */
  draftPreviews?: ScheduleTxnRow[];
  /** 当前科研序列生效推进倍率 */
  accelMultiplier?: number;
}

export interface SchedulePanelModel {
  /** 机制时钟照实呈现（clock；无 clock 字段为 undefined） */
  clock?: { day: number; time: string };
  /** 时钟行文本（SCHEDULE_COPY.clockLine 同源） */
  clockText?: string;
  /** 全空态：无任何在编事务（base+研究两节仍渲染板，条目行出空态文案） */
  allEmpty: boolean;
  allEmptyText: string;
  bases: ScheduleBaseSection[];
  /** 战区科研调度一节：恒 11 槽（含未开通槽与理由） */
  researchSlots: ScheduleSlotRow[];
  /** UTO 全景工位快照矩阵（制造 9 线 × 基地 ＋ 科研 11 序列 ＋ 工程槽 × 基地） */
  stations: LaneStationView[];
  /** UTO 单向只读投影全量任务（含 project_root / draft / active / queued / held / settling / completed / cancelled） */
  tasks: UnifiedTask[];
  /** UTO 在编/候列/暂缓/待收讫任务子集（不含 project_root、draft、completed、cancelled） */
  scheduledTasks: UnifiedTask[];
  /** UTO 未启动规划态拓扑子任务（status === 'draft'，含 dependsOn 依赖链） */
  draftTasks: UnifiedTask[];
  /** 各基地工程工位行扁平视图（eng.main / eng.orbital 等） */
  engineeringLanes: ScheduleProdLaneRow[];
  /** 参谋部最新排产回执（PLAN-UI-01：来自 stat_data.planning.latest_receipt） */
  planningReceipt: PlanningReceipt | null;
  /** 下一已知里程碑提示横幅（UX-SCHED-01 · UX-07） */
  nextMilestone: NextMilestoneBanner;
  /** 最高统帅部协议攻关泳道视图（UTO-LANE-01） */
  protocolLane: ScheduleProtocolLaneModel;
  /** 五大业务领域跨基地汇总视图（供「五大领域汇总」Tab 消费） */
  domainGroups: DomainScheduleGroup[];
  /** 全局产能与工况 KPI 摘要（运转工位数、开通总工位数、加速产线数、滞留产线数） */
  kpiSummary: ScheduleKpiSummary;
  /** 全战区在途/排队任务最大预计完工偏移分钟数（供自适应甘特标尺计算） */
  maxEndOffsetMin: number;
}

/** 内部归一化任务绑定项（携带 UnifiedTask 与对齐的 QueueItem 视图） */
interface ResolvedScheduledTask {
  readonly task: UnifiedTask;
  readonly qView: QueueItem;
  readonly stationId: string;
}

/** 任务领域 → 缺省队列事务类型 */
function domainToQueueType(domain: TaskDomain, sourceKind?: TaskMetadata['sourceKind']): QueueItem['type'] {
  if (sourceKind === 'project_phase' || sourceKind === 'project_module') return '工程';
  switch (domain) {
    case 'construction':
      return '建造';
    case 'research':
      return '研究';
    case 'retrofit':
      return '改装';
    case 'megastructure':
      return '工程';
    default:
      return '生产';
  }
}

/** 从 laneKey 提取标准工位标识（research:slot.* / eng:eng.* / lane.*） */
function extractStationId(laneKey: string): string {
  if (laneKey.startsWith('research:')) return laneKey;
  const engMatch = laneKey.match(/(?:^|\s)(eng:[^\s]+)$/);
  if (engMatch) return engMatch[1];
  if (laneKey.endsWith(' lane.default') || laneKey === 'lane.default') return 'lane.default';
  return laneDefFromKey(laneKey)?.laneId ?? 'lane.default';
}

/** 判定 UnifiedTask 是否属于上日程表展示的在途/候列任务（排除容器、draft 规划态及终态） */
function isScheduledUnifiedTask(task: UnifiedTask): boolean {
  if (task.metadata?.sourceKind === 'project_root') return false;
  if (task.metadata?.syncWarn === true && task.metadata?.queueIndex === undefined) return false;
  return task.status === 'active' || task.status === 'settling' || task.status === 'queued' || task.status === 'held';
}

/** UnifiedTask → 对齐的 QueueItem 视图（有原队列项时优先保真原字段，纯工程分段无损合成） */
function toQueueItemView(task: UnifiedTask, queues: readonly QueueItem[]): QueueItem {
  const qIdx = typeof task.metadata?.queueIndex === 'number' ? task.metadata.queueIndex : undefined;
  const q = qIdx !== undefined && qIdx >= 0 && qIdx < queues.length ? queues[qIdx] : undefined;
  const mappedState = taskStatusToQueueState(task.status);
  const status = (q ? q.status : mappedState.status) as QueueItem['status'];
  const hold = q ? Boolean(q.hold) : mappedState.hold;
  const totalMinutes = q ? q.total_minutes : task.workload.totalMinutes;
  const spentMinutes = q ? q.spent_minutes : task.workload.spentMinutes;
  const progress =
    q && typeof q.progress === 'number'
      ? q.progress
      : totalMinutes > 0
        ? Math.min(100, Math.max(0, (spentMinutes / totalMinutes) * 100))
        : 0;
  const rawType = (q?.type ??
    (task.metadata?.rawType as QueueItem['type'] | undefined) ??
    domainToQueueType(task.domain, task.metadata?.sourceKind)) as QueueItem['type'];

  return {
    type: rawType,
    item: q ? q.item : task.name,
    base: q ? (q.base ?? '') : (task.leadBaseId ?? ''),
    status,
    progress,
    spent_minutes: spentMinutes,
    total_minutes: totalMinutes,
    min_days_lock: q?.min_days_lock ?? task.workload.minDaysLock ?? 0,
    qty: q ? q.qty : (task.batch?.totalQty ?? 1),
    qty_done: q ? q.qty_done : (task.batch?.completedQty ?? 0),
    cost_paid: q ? q.cost_paid : (task.costPaid ?? true),
    hold,
    started_at: q ? q.started_at : ((task.metadata?.startedAt as string | undefined) ?? ''),
    eta: q ? q.eta : ((task.metadata?.eta as string | undefined) ?? ''),
    ...(q?.lane !== undefined ? { lane: q.lane } : {}),
  } as QueueItem;
}

/** 推导单条事务的甘特条可视化字段（UX-SCHED-01 · P2-⑤） */
function resolveGanttMetrics(
  task: UnifiedTask,
  qView: QueueItem & { duration_minutes?: number },
): {
  ganttPct: number;
  ganttState: ScheduleGanttState;
  remainingMinutes: number | null;
} {
  const ganttState: ScheduleGanttState =
    qView.status === 'done' || task.status === 'completed'
      ? 'done'
      : qView.status === 'settling' || task.status === 'settling'
        ? 'settling'
        : qView.hold || task.status === 'held'
          ? 'paused'
          : qView.status === 'active' || task.status === 'active'
            ? 'active'
            : 'queued';

  const totalMinutes =
    typeof qView.duration_minutes === 'number' && Number.isFinite(qView.duration_minutes) && qView.duration_minutes > 0
      ? qView.duration_minutes
      : typeof qView.total_minutes === 'number' && Number.isFinite(qView.total_minutes)
        ? qView.total_minutes
        : 0;
  const spentMinutes =
    typeof qView.spent_minutes === 'number' && Number.isFinite(qView.spent_minutes)
      ? Math.max(0, qView.spent_minutes)
      : 0;

  if (ganttState === 'done' || ganttState === 'settling') {
    return {
      ganttPct: 100,
      ganttState,
      remainingMinutes: 0,
    };
  }

  const rawPct =
    totalMinutes > 0 && spentMinutes > 0
      ? (spentMinutes / totalMinutes) * 100
      : typeof qView.progress === 'number' && Number.isFinite(qView.progress)
        ? qView.progress
        : totalMinutes > 0
          ? (spentMinutes / totalMinutes) * 100
          : 0;
  const ganttPct = Math.min(100, Math.max(0, Math.round(rawPct)));
  const remainingMinutes = totalMinutes > 0 ? Math.max(0, Math.round(totalMinutes - spentMinutes)) : null;

  return {
    ganttPct,
    ganttState,
    remainingMinutes,
  };
}

/**
 * 计算顶栏「下一已知里程碑提示」横幅（UX-SCHED-01 · UX-07 纯函数）。
 * 1. 若存在 status === 'settling' 的待收讫项，优先返回「待收讫确认」（remainingMinutes = 0）；
 * 2. 否则扫描 status === 'active' 且剩余分钟数 (duration_minutes/total_minutes - spent_minutes) > 0 的项，
 *    取剩余分钟数最小者返回「下一完工节点」；
 * 3. 无活跃可预测任务时返回「暂无在途里程碑」。
 */
export function computeNextMilestoneBanner(snapshot: SchedulePanelInput | null | undefined): NextMilestoneBanner {
  const queues = snapshot?.queues ?? [];
  const bases = snapshot?.bases ?? [];

  const resolveBaseDisplayName = (rawBase: string | undefined): string | null => {
    const trimmed = String(rawBase ?? '').trim();
    if (!trimmed) return null;
    const matched = bases.find(
      b => (typeof b.id === 'string' && b.id.trim() === trimmed) || (typeof b.name === 'string' && b.name.trim() === trimmed),
    );
    return matched?.name?.trim() || trimmed;
  };

  for (const q of queues) {
    if (!q || q.status !== 'settling') continue;
    const itemName = String(q.item ?? '').trim() || '未命名任务';
    const baseName = resolveBaseDisplayName(q.base);
    return {
      hasMilestone: true,
      label: '待确认完工',
      itemName,
      baseName,
      remainingMinutes: 0,
      summary: `「${itemName}」已达到预计工时，等待结算确认`,
    };
  }

  let bestItemName: string | null = null;
  let bestBaseName: string | null = null;
  let bestRemaining: number | null = null;

  for (const q of queues) {
    if (!q || q.status !== 'active' || q.hold === true) continue;
    const total =
      typeof q.duration_minutes === 'number' && Number.isFinite(q.duration_minutes)
        ? q.duration_minutes
        : typeof q.total_minutes === 'number' && Number.isFinite(q.total_minutes)
          ? q.total_minutes
          : 0;
    const spent =
      typeof q.spent_minutes === 'number' && Number.isFinite(q.spent_minutes) ? Math.max(0, q.spent_minutes) : 0;
    const remaining = Math.round(total - spent);
    if (remaining <= 0) continue;

    if (bestRemaining === null || remaining < bestRemaining) {
      bestRemaining = remaining;
      bestItemName = String(q.item ?? '').trim() || '未命名任务';
      bestBaseName = resolveBaseDisplayName(q.base);
    }
  }

  if (bestItemName !== null && bestRemaining !== null) {
    return {
      hasMilestone: true,
      label: '最近完工项',
      itemName: bestItemName,
      baseName: bestBaseName,
      remainingMinutes: bestRemaining,
      summary: `距离「${bestItemName}」完工预计还需 ${fmtMinutes(bestRemaining)}（${bestRemaining} 分钟）`,
    };
  }

  return {
    hasMilestone: false,
    label: '暂无在建任务',
    itemName: null,
    baseName: null,
    remainingMinutes: null,
    summary: '当前没有正在计时的建造、生产或科研任务',
  };
}

/** 归一化任务列表 → 谓语行（工位内数组序＝优先级，prevInLane 与 scheduleText.predicateFor 同源） */
function buildTxnRows(
  items: readonly ResolvedScheduledTask[],
  effFor: (t: TransactionItem) => number,
): ScheduleTxnRow[] {
  return items.map(({ task, qView }, i) => {
    const gantt = resolveGanttMetrics(task, qView);
    const qIdx = typeof task.metadata?.queueIndex === 'number' ? task.metadata.queueIndex : undefined;
    const rawEff = effFor(qView as unknown as TransactionItem);
    const effectiveAccel = Number.isFinite(rawEff) && rawEff > 0 ? Number(rawEff.toFixed(2)) : 1;
    const minDaysLock =
      typeof qView.min_days_lock === 'number' && Number.isFinite(qView.min_days_lock) && qView.min_days_lock > 0
        ? qView.min_days_lock
        : undefined;
    const qty = typeof qView.qty === 'number' && Number.isFinite(qView.qty) ? qView.qty : 1;
    const qtyDone = typeof qView.qty_done === 'number' && Number.isFinite(qView.qty_done) ? qView.qty_done : 0;
    const batchText = qty > 1 ? `${qtyDone}/${qty} 批` : undefined;

    return {
      item: qView.item,
      type: qView.type,
      base: qView.base,
      hold: qView.hold,
      status: qView.status,
      tone: queueDisplayModel(qView).tone,
      predicate: predicateFor(
        qView as unknown as TransactionItem,
        items[i - 1]?.qView as unknown as TransactionItem | undefined,
        effFor,
      ),
      ganttPct: gantt.ganttPct,
      ganttState: gantt.ganttState,
      remainingMinutes: gantt.remainingMinutes,
      taskId: task.id,
      domain: task.domain,
      taskStatus: task.status,
      sourceKind: task.metadata?.sourceKind,
      ...(qIdx !== undefined ? { queueIndex: qIdx } : {}),
      effectiveAccel,
      ...(minDaysLock !== undefined ? { minDaysLock } : {}),
      ...(batchText !== undefined ? { batchText } : {}),
    };
  });
}

/**
 * 工程日程面板视图模型（纯函数）。
 * 通过 LaneRegistryHub.resolveAllLanes 与 toUnifiedTasks 同源派生：
 * 时钟行 → 基地（bases 数组序）→ 工位（制造 9 产线 + 工程双槽）→ 事务谓语行；战区科研调度 11 槽单列；
 * 默认启用最高统帅部协议攻关泳道（includeProtocol = true）与下一已知里程碑提示。
 */
export function schedulePanelModel(
  stat: SchedulePanelInput,
  catalog: EffectiveCatalog,
  options: SchedulePanelOptions = { includeProtocol: true },
): SchedulePanelModel {
  const includeProtocol = options.includeProtocol ?? true;
  const bases = stat.bases ?? [];
  const queues = (stat.queues ?? []) as QueueItem[];
  const projects = stat.projects ?? [];
  const clock = stat.clock;

  const safeCatalog: EffectiveCatalog = {
    ...catalog,
    researches: catalog?.researches ?? [],
    buildings: catalog?.buildings ?? [],
    productions: catalog?.productions ?? [],
    retrofits: catalog?.retrofits ?? [],
    projects: catalog?.projects ?? [],
    factionDefs: catalog?.factionDefs ?? [],
  };

  const hub = defaultLaneRegistryHub;
  const laneEnv: LaneResolveEnv = {
    bases: bases.map(b => ({
      id: b.id,
      name: b.name,
      status: b.status,
      buildings: (b.buildings ?? []).map(bd => ({
        name: bd.name ?? '',
        state: bd.state,
        mode: bd.mode,
      })),
    })),
    queues: queues as unknown as ReadonlyArray<TransactionItem>,
    catalog: safeCatalog,
  };

  /* ── 1. UTO 工位矩阵与单向只读任务投影 ── */
  const stations = hub.resolveAllLanes(laneEnv);
  const allTasks = toUnifiedTasks(
    {
      bases: laneEnv.bases,
      queues: queues as unknown as ProjectionStateInput['queues'],
      projects,
    },
    safeCatalog,
  );

  const draftTasks = allTasks.filter(t => t.metadata?.sourceKind !== 'project_root' && t.status === 'draft');

  // 收集在编/候列/暂缓/待收讫任务，并按原队列下标优先保序（确保与 queues[] 优先级顺序 100% 一致）
  const rawScheduled: Array<{ task: UnifiedTask; qView: QueueItem; orderKey: number; seq: number }> = [];
  allTasks.forEach((task, seq) => {
    if (!isScheduledUnifiedTask(task)) return;
    const qView = toQueueItemView(task, queues);
    if (!isScheduled(qView as unknown as TransactionItem)) return;
    const qIdx = typeof task.metadata?.queueIndex === 'number' ? task.metadata.queueIndex : Number.MAX_SAFE_INTEGER;
    rawScheduled.push({ task, qView, orderKey: qIdx, seq });
  });
  rawScheduled.sort((a, b) => (a.orderKey !== b.orderKey ? a.orderKey - b.orderKey : a.seq - b.seq));

  const scheduledTasks = rawScheduled.map(r => r.task);
  const effFor = makeTxnEffFor(catalog, stat as never);

  const canon = (s: string) => s.trim();
  const baseIndexOf = (baseRef: string) => {
    const ref = canon(baseRef);
    if (!ref) return -1;
    return bases.findIndex(b => (b.id !== undefined && canon(b.id) === ref) || canon(b.name ?? '') === ref);
  };

  /* ── 2. 按领域与属地工位归组任务 ── */
  const researchTasksByKey = new Map<string, ResolvedScheduledTask[]>();
  const baseTasksByKey = new Map<string, ResolvedScheduledTask[]>();
  const orphanTasksByKey = new Map<string, ResolvedScheduledTask[]>();

  for (const { task, qView } of rawScheduled) {
    const stationId = extractStationId(task.laneKey);
    const resolved: ResolvedScheduledTask = { task, qView, stationId };

    if (task.domain === 'research' || task.laneKey.startsWith('research:')) {
      const rKey = task.laneKey.startsWith('research:') ? task.laneKey : `research:${stationId}`;
      const list = researchTasksByKey.get(rKey) ?? [];
      list.push(resolved);
      researchTasksByKey.set(rKey, list);
      continue;
    }

    const bi = baseIndexOf(qView.base);
    if (bi >= 0) {
      const mKey = `${bi}|${stationId}`;
      const list = baseTasksByKey.get(mKey) ?? [];
      list.push(resolved);
      baseTasksByKey.set(mKey, list);
    } else {
      const oKey = `${qView.base}|${stationId}`;
      const list = orphanTasksByKey.get(oKey) ?? [];
      list.push(resolved);
      orphanTasksByKey.set(oKey, list);
    }
  }

  /* ── 3. 基地 → 制造产线 + 工程工位矩阵组装 ── */
  const prodViews = stations.filter(s => s.domain === 'production');
  const engViews = stations.filter(s => s.domain === 'retrofit');
  const researchViews = stations.filter(s => s.domain === 'research');

  const prodPerBase = bases.length > 0 ? prodViews.length / bases.length : 0;
  const engPerBase = bases.length > 0 ? engViews.length / bases.length : 0;

  // 提取工位模板字典（供孤儿基地或兜底查询 displayName / domain / lockedReason）
  const probeStations =
    bases.length > 0
      ? [...prodViews.slice(0, prodPerBase), ...engViews.slice(0, engPerBase)]
      : hub.resolveAllLanes({
          bases: [{ id: '__probe__', name: '__probe__', buildings: [] }],
          queues: [],
          catalog,
        });
  const templateByStationId = new Map<string, LaneStationView>();
  for (const st of probeStations) {
    if (st.domain === 'research') continue;
    templateByStationId.set(extractStationId(st.laneKey), st);
  }

  const baseSections = new Map<number, ScheduleBaseSection>();
  const engineeringLanes: ScheduleProdLaneRow[] = [];
  let maxEndOffsetMin = 0;
  const globalAccelByLane = precomputeGlobalAccelCountByLane(bases);
  const draftDepIndex = buildDraftDependencyIndex(draftTasks);

  for (let bi = 0; bi < bases.length; bi++) {
    const b = bases[bi];
    const baseRefKey = b.id ?? b.name ?? '';
    const sec: ScheduleBaseSection = {
      key: baseRefKey,
      name: b.name ?? b.id ?? '',
      empty: true,
      retired: (b.status ?? '') === '废弃',
      lanes: [],
    };
    const stationsForBase = [
      ...prodViews.slice(bi * prodPerBase, (bi + 1) * prodPerBase),
      ...engViews.slice(bi * engPerBase, (bi + 1) * engPerBase),
    ];

    const coveredStations = new Set<string>();
    for (const view of stationsForBase) {
      const stationId = extractStationId(view.laneKey);
      coveredStations.add(stationId);
      const tasks = baseTasksByKey.get(`${bi}|${stationId}`) ?? [];
      const isDefaultProd = stationId === 'lane.default';
      const isEngStation = stationId.startsWith('eng:');
      const prelisted = !isDefaultProd && view.capacity > 0;
      if (!prelisted && tasks.length === 0) continue;

      const rowKey = prelisted ? view.laneKey : `${tasks[0].qView.base} ${stationId}`;
      const activeItems = [...new Set(tasks.filter(t => t.task.status === 'active').map(t => t.qView.item))];
      const activeCount = activeItems.length;
      const queuedCount = tasks.filter(t => t.task.status === 'queued' || t.task.status === 'held').length;
      const stranded = view.capacity === 0 && (activeCount > 0 || queuedCount > 0 || tasks.length > 0);

      const dualModeSummary = summarizeLaneDualModeBuildings(bases, baseRefKey, stationId, 1, globalAccelByLane);
      const rawTxns = buildTxnRows(tasks, effFor);
      const laneEff =
        rawTxns.length > 0 && rawTxns[0].effectiveAccel !== undefined
          ? rawTxns[0].effectiveAccel
          : dualModeSummary.accelMultiplier;
      const trackResult = scheduleLaneSubTracks(rawTxns, view.capacity, laneEff, clock, draftTasks, draftDepIndex);
      if (trackResult.maxEndOffsetMin > maxEndOffsetMin) {
        maxEndOffsetMin = trackResult.maxEndOffsetMin;
      }

      const row: ScheduleProdLaneRow = {
        key: rowKey,
        name: view.displayName,
        capacity: view.capacity,
        activeCount,
        queuedCount,
        activeItems,
        stranded,
        txns: trackResult.enrichedTxns,
        domain: view.domain,
        station: view,
        lockedReason: view.lockedReason,
        dualModeSummary,
        accelMultiplier: dualModeSummary.accelMultiplier,
        subTracks: trackResult.subTracks,
        draftPreviews: trackResult.draftPreviews,
      };
      sec.lanes.push(row);
      if (isEngStation) engineeringLanes.push(row);
    }

    // 兜底：若存在已注册工位之外的自定义工位在途任务，确保不丢事务
    for (const [mKey, tasks] of baseTasksByKey) {
      const sepIdx = mKey.indexOf('|');
      if (Number(mKey.slice(0, sepIdx)) !== bi) continue;
      const stationId = mKey.slice(sepIdx + 1);
      if (coveredStations.has(stationId) || tasks.length === 0) continue;
      const sampleQ = tasks[0].qView;
      const activeItems = [...new Set(tasks.filter(t => t.task.status === 'active').map(t => t.qView.item))];
      const activeCount = activeItems.length;
      const queuedCount = tasks.filter(t => t.task.status === 'queued' || t.task.status === 'held').length;
      const dualModeSummary = summarizeLaneDualModeBuildings(bases, baseRefKey, stationId, 1, globalAccelByLane);
      const rawTxns = buildTxnRows(tasks, effFor);
      const laneEff =
        rawTxns.length > 0 && rawTxns[0].effectiveAccel !== undefined
          ? rawTxns[0].effectiveAccel
          : dualModeSummary.accelMultiplier;
      const trackResult = scheduleLaneSubTracks(rawTxns, 0, laneEff, clock, draftTasks, draftDepIndex);
      if (trackResult.maxEndOffsetMin > maxEndOffsetMin) {
        maxEndOffsetMin = trackResult.maxEndOffsetMin;
      }

      const row: ScheduleProdLaneRow = {
        key: `${sampleQ.base} ${stationId}`,
        name: SCHEDULE_COPY.defaultLaneName(sampleQ.type ?? '生产'),
        capacity: 0,
        activeCount,
        queuedCount,
        activeItems,
        stranded: true,
        txns: trackResult.enrichedTxns,
        domain: tasks[0].task.domain,
        dualModeSummary,
        accelMultiplier: dualModeSummary.accelMultiplier,
        subTracks: trackResult.subTracks,
        draftPreviews: trackResult.draftPreviews,
      };
      sec.lanes.push(row);
      if (stationId.startsWith('eng:')) engineeringLanes.push(row);
    }

    sec.lanes.sort((a, b) => a.key.localeCompare(b.key));
    sec.empty = sec.lanes.every(l => l.txns.length === 0);
    baseSections.set(bi, sec);
  }

  /* ── 4. 孤儿基地兜底（base 无法解析到在册基地时归入 SCHEDULE_COPY.baseUnnamed，不丢事务） ── */
  const orphanBase: ScheduleBaseSection = {
    key: '__orphan__',
    name: SCHEDULE_COPY.baseUnnamed,
    empty: false,
    retired: false,
    lanes: [],
  };

  for (const [oKey, tasks] of orphanTasksByKey) {
    if (tasks.length === 0) continue;
    const sepIdx = oKey.lastIndexOf('|');
    const rawBase = oKey.slice(0, sepIdx);
    const stationId = oKey.slice(sepIdx + 1);
    const tpl = templateByStationId.get(stationId);
    const sampleQ = tasks[0].qView;
    const capacity = Math.max(0, hub.resolveParallelLimitForTxn(sampleQ as unknown as TransactionItem, laneEnv));
    const activeItems = [...new Set(tasks.filter(t => t.task.status === 'active').map(t => t.qView.item))];
    const activeCount = activeItems.length;
    const queuedCount = tasks.filter(t => t.task.status === 'queued' || t.task.status === 'held').length;
    const stranded = capacity === 0 && (activeCount > 0 || queuedCount > 0 || tasks.length > 0);
    const dualModeSummary = summarizeLaneDualModeBuildings(bases, rawBase, stationId, 1, globalAccelByLane);
    const rawTxns = buildTxnRows(tasks, effFor);
    const laneEff =
      rawTxns.length > 0 && rawTxns[0].effectiveAccel !== undefined
        ? rawTxns[0].effectiveAccel
        : dualModeSummary.accelMultiplier;
    const trackResult = scheduleLaneSubTracks(rawTxns, capacity, laneEff, clock, draftTasks, draftDepIndex);
    if (trackResult.maxEndOffsetMin > maxEndOffsetMin) {
      maxEndOffsetMin = trackResult.maxEndOffsetMin;
    }

    const row: ScheduleProdLaneRow = {
      key: `${rawBase} ${stationId}`,
      name: tpl?.displayName ?? SCHEDULE_COPY.defaultLaneName(sampleQ.type ?? '生产'),
      capacity,
      activeCount,
      queuedCount,
      activeItems,
      stranded,
      txns: trackResult.enrichedTxns,
      domain: tpl?.domain ?? tasks[0].task.domain,
      station: tpl,
      lockedReason: stranded ? tpl?.lockedReason : undefined,
      dualModeSummary,
      accelMultiplier: dualModeSummary.accelMultiplier,
      subTracks: trackResult.subTracks,
      draftPreviews: trackResult.draftPreviews,
    };
    orphanBase.lanes.push(row);
    if (stationId.startsWith('eng:')) engineeringLanes.push(row);
  }

  orphanBase.lanes.sort((a, b) => a.key.localeCompare(b.key));
  orphanBase.empty = orphanBase.lanes.every(l => l.txns.length === 0);

  const baseList: ScheduleBaseSection[] = bases.map((_, i) => baseSections.get(i)!);
  if (orphanBase.lanes.length > 0) baseList.push(orphanBase);

  /* ── 5. 战区科研调度：恒 11 槽（ResearchLaneProvider 直呈开通态/active/queued + 未开通理由） ── */
  const researchSlots: ScheduleSlotRow[] = researchViews.map(view => {
    const slotId = view.laneKey.startsWith('research:') ? view.laneKey.slice('research:'.length) : view.laneKey;
    const unlocked = !view.locked;
    const limit = unlocked ? view.capacity : 0;
    const tasks = researchTasksByKey.get(view.laneKey) ?? [];
    const activeItems = tasks.filter(t => t.task.status === 'active').map(t => t.qView.item);
    const queuedCount = tasks.filter(t => t.task.status === 'queued' || t.task.status === 'held').length;
    const rawTxns = buildTxnRows(tasks, effFor);
    const slotEff = rawTxns.length > 0 && rawTxns[0].effectiveAccel !== undefined ? rawTxns[0].effectiveAccel : 1;
    const trackResult = scheduleLaneSubTracks(rawTxns, limit, slotEff, clock, draftTasks);
    if (trackResult.maxEndOffsetMin > maxEndOffsetMin) {
      maxEndOffsetMin = trackResult.maxEndOffsetMin;
    }

    return {
      key: view.laneKey,
      slotId,
      name: SCHEDULE_COPY.researchLaneName(view.displayName),
      unlocked,
      limit,
      activeItems,
      queuedCount,
      lockedReason: unlocked ? undefined : view.lockedReason,
      txns: trackResult.enrichedTxns,
      domain: 'research',
      station: view,
      subTracks: trackResult.subTracks,
      draftPreviews: trackResult.draftPreviews,
      accelMultiplier: slotEff,
    };
  });

  // 序列表之外的研究 lane（槽注册表缺漏）兜底列尾，不丢事务
  for (const [key, tasks] of researchTasksByKey) {
    if (researchSlots.some(r => r.key === key)) continue;
    const rawTxns = buildTxnRows(tasks, effFor);
    const slotEff = rawTxns.length > 0 && rawTxns[0].effectiveAccel !== undefined ? rawTxns[0].effectiveAccel : 1;
    const trackResult = scheduleLaneSubTracks(rawTxns, 1, slotEff, clock, draftTasks);
    if (trackResult.maxEndOffsetMin > maxEndOffsetMin) {
      maxEndOffsetMin = trackResult.maxEndOffsetMin;
    }
    researchSlots.push({
      key,
      slotId: key.startsWith('research:') ? key.slice('research:'.length) : key,
      name: SCHEDULE_COPY.fallbackResearchLaneName,
      unlocked: true,
      limit: 1,
      activeItems: tasks.filter(t => t.task.status === 'active').map(t => t.qView.item),
      queuedCount: tasks.filter(t => t.task.status === 'queued' || t.task.status === 'held').length,
      txns: trackResult.enrichedTxns,
      domain: 'research',
      subTracks: trackResult.subTracks,
      draftPreviews: trackResult.draftPreviews,
      accelMultiplier: slotEff,
    });
  }

  /* ── 6. 最高统帅部协议攻关泳道（UTO-LANE-01）与下一已知里程碑提示（UX-SCHED-01） ── */
  const [protocolStation] = defaultProtocolLaneProvider.resolveLanes(laneEnv);
  const catalogProtocols = (
    (safeCatalog as { protocols?: readonly ProtocolLaneCatalogItemLike[] }).protocols ?? []
  ) as readonly ProtocolLaneCatalogItemLike[];
  const projectedProtocols = includeProtocol
    ? defaultProtocolLaneProvider.projectProtocols(stat.protocols, catalogProtocols)
    : [];
  const protoScan = scanActiveProtocolBuildings({ bases: laneEnv.bases });
  const dailyRate = dailyProtocolPointRate({ bases: laneEnv.bases });
  const institutesText =
    protoScan.buildings.length > 0
      ? protoScan.buildings.map(b => b.name).join('＋')
      : SCHEDULE_COPY.protocolNoActiveInstitute;
  const rawProtocolPoints = stat.protocol_points ?? 0;
  const protocolPoints =
    typeof rawProtocolPoints === 'number' && Number.isFinite(rawProtocolPoints) ? Math.max(0, rawProtocolPoints) : 0;

  const protocolLane: ScheduleProtocolLaneModel = {
    laneKey: PROTOCOL_LANE_KEY,
    displayName: protocolStation?.displayName ?? PROTOCOL_LANE_DISPLAY_NAME,
    enabled: includeProtocol,
    hasActivity:
      includeProtocol &&
      (projectedProtocols.length > 0 || hasProtocolScheduleActivity(stat.protocols as ReadonlyArray<Partial<ProtocolInstance>>)),
    protocolPoints,
    dailyRate,
    institutesText,
    items: projectedProtocols,
    station: protocolStation,
  };

  const nextMilestone = computeNextMilestoneBanner(stat);
  const domainGroups = buildDomainScheduleGroups(baseList, researchSlots, protocolLane);

  const nonRetiredLanes = baseList.filter(b => !b.retired).flatMap(b => b.lanes);
  const kpiSummary: ScheduleKpiSummary = {
    activeStationCount:
      nonRetiredLanes.reduce((sum, l) => sum + l.activeCount, 0) +
      researchSlots.reduce((sum, s) => sum + s.activeItems.length, 0),
    totalUnlockedCapacity:
      nonRetiredLanes.reduce((sum, l) => sum + Math.max(0, l.capacity), 0) +
      researchSlots.reduce((sum, s) => sum + (s.unlocked ? Math.max(0, s.limit) : 0), 0),
    acceleratingLaneCount: nonRetiredLanes.filter(l => (l.dualModeSummary?.accelMultiplier ?? 1) > 1).length,
    strandedLaneCount: nonRetiredLanes.filter(l => l.stranded).length,
  };

  return {
    clock,
    clockText: clock ? SCHEDULE_COPY.clockLine(clock.day, clock.time) : undefined,
    allEmpty: rawScheduled.length === 0,
    allEmptyText: SCHEDULE_COPY.allEmpty,
    bases: baseList,
    researchSlots,
    stations,
    tasks: allTasks,
    scheduledTasks,
    draftTasks,
    engineeringLanes,
    planningReceipt: stat.planning?.latest_receipt ?? null,
    nextMilestone,
    protocolLane,
    domainGroups,
    kpiSummary,
    maxEndOffsetMin,
  };
}

const PLANNING_OP_LABELS: Record<PlanningReceipt['actions'][number]['op'], string> = {
  enqueue: '入队',
  promote: '加急',
  demote: '后置',
  hold: '暂缓',
  resume: '恢复',
};

/**
 * 将待批准回执中的非 rejected 动作转化为结构化批准指令文本（供 fillHostSendInput 填入 #send_textarea）。
 * 包含人类可读批示摘要与标准 <排产计划> 块（mode: "delegate_once", request_ref, base_ref, actions）。
 */
export function formatPlanningApprovalOrderText(receipt: PlanningReceipt): string {
  const validActions = (receipt.actions ?? []).filter(a => a.status !== 'rejected');
  const actionBrief =
    validActions.length > 0
      ? validActions
          .map(a => `${PLANNING_OP_LABELS[a.op] ?? a.op}「${a.target}」×${Math.max(1, Math.round(a.quantity || 1))}`)
          .join('、')
      : '无可执行动作';

  const payload = {
    request_ref: receipt.request_ref,
    ...(receipt.snapshot_ref ? { snapshot_ref: receipt.snapshot_ref } : {}),
    mode: 'delegate_once' as const,
    base_ref: receipt.base_ref,
    ...(receipt.budget_cap_credits !== undefined ? { budget_cap_credits: receipt.budget_cap_credits } : {}),
    ...(receipt.reason ? { reason: receipt.reason } : {}),
    actions: validActions.map(a => ({
      op: a.op,
      target: a.target,
      ...(a.op === 'enqueue' ? { catalog_ref: a.target } : { task_ref: a.target }),
      base_ref: a.base || receipt.base_ref,
      quantity: Math.max(1, Math.round(a.quantity || 1)),
    })),
  };

  return [
    `【参谋方案核准令】批准执行排产方案 ${receipt.request_ref || '未编号'}（目标基地：${receipt.base_ref || '默认基地'}，测算耗资：${receipt.total_cost_credits}）：${actionBrief}。`,
    '<排产计划>',
    JSON.stringify(payload, null, 2),
    '</排产计划>',
  ].join('\n');
}

/** 别名导出：对齐任务包 buildSchedulePanelModel 命名契约 */
export const buildSchedulePanelModel = schedulePanelModel;
