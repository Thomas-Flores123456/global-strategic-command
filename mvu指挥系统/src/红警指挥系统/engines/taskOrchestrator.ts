/**
 * taskOrchestrator.ts —— 通用任务编排器内核契约（UTO-CORE-01）
 *
 * 真源：docs/design/systems/通用任务编排器总设计案.md（CTRL-UTO-CORE-01 §1~§3）
 * ＋ docs/project/plans/通用任务编排器MVP任务包.md §3.1/§3.2/§3.4（执行契约）
 *
 * 设计红线（任务包总原则·账本写权与纯函数铁律）：
 * 1. 本模块恒为纯函数计算：零 Pinia、零 Vue、零宿主 API、零 DOM、零未受控全局变量写入；
 *    外部类型一律 `import type` 引入（EffectiveCatalog / TransactionItem / TransactionStatus / SettleEvent）；
 * 2. 不感知具体产线/槽位业务规则（工位快照由 UTO-PROV-01 的 ILaneProvider 实现供给）；
 * 3. 不直接修改持久化 Schema（stat_data.queues[] / projects[] 阶段一/二绝对锁定）；
 * 4. 所有映射与守卫函数不原地修改入参，未知非法值一律安全兜底、绝不抛错中断结算。
 *
 * 本任务（UTO-CORE-01 + UTO-TICK-01）范围：类型与常量契约 ＋ 双账本状态确定性映射 ＋ 终态守卫
 * ＋ tickTaskOrchestration 三阶段纯函数步进核心机（① 工位带宽抢占与超额挤退 ② 有效工时积分与两阶段/算力/minDaysLock 钳制桥接 ③ DAG 拓扑依赖解锁与离散步长边界）。
 */

import type { EffectiveCatalog } from '../core/catalogEffective';
import type { TransactionItem, TransactionStatus } from './transactionEngine';
import {
  MINUTES_PER_DAY,
  applyNaniteDeduction,
  phase2Multiplier,
  phaseSplit,
  type ComputeBudget,
  type NanitesDeductedEvent,
  type TwoStageEvent,
  type TwoStageSpec,
} from './twoStageAssemblyEngine';

export type { ComputeBudget, NanitesDeductedEvent, TwoStageEvent, TwoStageSpec };

/* ═══════════════ 轴一 · 任务领域与七态状态机常量与类型（§3.1） ═══════════════ */

/**
 * 任务领域全集（对齐总设计案 §1，预留 protocol 供《协议玩法》D-P27 自动实验排程并轨）。
 * 运行时冻结：任何调用方不得增删领域枚举（新增领域须走任务包契约变更）。
 */
export const TASK_DOMAINS = Object.freeze([
  'construction', // 基地基础设施/防御建筑建造（对应 QueueItem.type === '建造'）
  'production', // 人员训练、载具制造、军备下线（对应 QueueItem.type === '生产'）
  'research', // 基础与前沿理论攻坚（对应 QueueItem.type === '研究'）
  'retrofit', // 现役装备现代化总成改装（对应 QueueItem.type === '改装' 及 V1 Project）
  'megastructure', // 战略级跨基地仓段化巨构（对应 V2 Project 及 QueueItem.type === '工程' 仓段项）
  'protocol', // 最高统帅部协议自动实验排程（D-P27 预留扩展域）
] as const);

/** 任务所属业务领域 */
export type TaskDomain = (typeof TASK_DOMAINS)[number];

/**
 * 统一七态状态机全集。运行时冻结：状态枚举变更须走任务包契约变更。
 * 双账本映射真值表见 §3.1.2（queueStatusToTaskStatus / projectSegmentStatusToTaskStatus）。
 */
export const TASK_STATUSES = Object.freeze([
  'draft', // 规划立项中（未进入正式候列，如 V1 未启动阶段 / V2 待注资或前置未齐模块）
  'queued', // 已立项候列（等待流水线工位空缺，hold === false）
  'active', // 在编推演/制造中（占用工位带宽，消耗时间/算力推进）
  'held', // 奉令工务暂缓（工位让出，工时进度 spentMinutes 冻结保留）
  'settling', // 实体装配就绪，待战区呈报收讫确认（指令性交付终态，待过三色对账门）
  'completed', // 已验收交付/已定型并网（对应 QueueItem 'done' / Project '完工'）
  'cancelled', // 奉令撤销/作废（对应 QueueItem 'cancelled' / Project '取消'）
] as const);

/** 统一七态状态机 */
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** 工期负荷与工业指标 */
export interface TaskWorkload {
  /** 额定总工时（分钟；0 为即时/未核定工额 unknown_duration） */
  totalMinutes: number;
  /** 已消耗有效工时（积分量；仅引擎写，Δt×accel×power×compute 积分） */
  spentMinutes: number;
  /** 物理硬下限（天；0 为不锁，供两阶段引擎钳制最低工期） */
  minDaysLock?: number;
  /** 算力推演 TFLOPS 门槛/需求声明 */
  tflopsRequired?: number;
  /** 边缘战术 TOPS 门槛/需求声明 */
  topsRequired?: number;
  /** 纳米装配资源定额（工程纳米开工门或生产纳米抵扣额） */
  naniteCost?: number;
}

/** 批量生产批次参数（单件或科研/工程缺省为 { totalQty: 1, completedQty: 0|1 }） */
export interface TaskBatch {
  /** 目标总批量（对应 QueueItem.qty） */
  totalQty: number;
  /** 已下线入役批量（对应 QueueItem.qty_done） */
  completedQty: number;
}

/** 依赖拓扑图谱（DAG 拓扑节点，支持 V1 阶段阶梯与 V2 仓段化模块拓扑） */
export interface TaskTopology {
  /** 所属总成/父工程任务 ID（如 "task:proj:proj_1"） */
  parentId?: string;
  /** 强依赖的前置子任务 ID 清单（全部 completed 方可激活本任务） */
  dependsOn?: string[];
  /** 父工程包含的子任务 ID 清单 */
  subTaskIds?: string[];
}

/** 业务领域私有元数据扩展（含双账本溯源指针、started_at、eta、原始事务 type 等） */
export interface TaskMetadata {
  sourceKind?: 'queue' | 'project_root' | 'project_phase' | 'project_module';
  /** 指向 stat_data.queues[] 的原数组下标（阶段一只读/阶段二回写对齐） */
  queueIndex?: number;
  /** 指向 stat_data.projects[].id */
  projectId?: string;
  /** V1 阶段序号 */
  phaseIdx?: number;
  /** V2 模块 ID */
  moduleId?: string;
  /** 原始 QueueItem.type（'建造' | '生产' | '研究' | '改装' | '工程'） */
  rawType?: string;
  /** 开工游戏内日历时刻 */
  startedAt?: string;
  /** 预计完工时刻缓存 */
  eta?: string;
  [key: string]: unknown;
}

/** 统一任务实体契约（对齐任务包 §3.1） */
export interface UnifiedTask {
  /** 全局唯一实例标识（如 "task:queue:0", "task:proj:proj_1:phase:0", "task:proj:proj_2:mod:core"） */
  id: string;
  /** 任务所属领域 */
  domain: TaskDomain;
  /** 实体条令名称（如 "犀牛主战坦克", "灰熊坦克现代化改装工程·火控换装"） */
  name: string;
  /** 属地范围：base=属地单基地 | theater=战区跨基地协同/全域序列 */
  scope: 'base' | 'theater';
  /** 承建属地（单基地承建时为基地 ID/名称；跨基地时为牵头基地 lead_base） */
  leadBaseId?: string;
  /** 参与基地清册（跨基地巨构或协同排产用） */
  participatingBases?: string[];
  /** 目标流水线 Key（与 LaneStationView.laneKey 严格对齐） */
  laneKey: string;

  /** 工期负荷与工业指标 */
  workload: TaskWorkload;

  /** 状态机状态 */
  status: TaskStatus;
  /** 资金账务记账（true=立项时已扣除 | false=LLM 叙事立项欠条，待对账补扣） */
  costPaid?: boolean;
  /** 批量生产批次参数 */
  batch?: TaskBatch;

  /** 依赖拓扑图谱 */
  topology?: TaskTopology;

  /** 业务领域私有元数据扩展 */
  metadata?: TaskMetadata;
}

/* ═══════════════ 轴二 · 工位环境提供者接口（§3.2，实现在 UTO-PROV-01） ═══════════════ */

/** 运行时流水线工位状态快照 */
export interface LaneStationView {
  /** 流水线全局唯一索引 Key（与现行 laneKey 100% 兼容，如 "1号基地\0lane.vehicle_land" 或 "slot.main"） */
  laneKey: string;
  /** 业务领域名 */
  domain: TaskDomain;
  /** 规范显示名称（如 "陆地载具生产线", "主建筑研究序列", "重型改装主工位"） */
  displayName: string;
  /** 属地基地标识（全域科研序列/全域协议序列为 undefined） */
  baseId?: string;
  /** 额定并发工位容量（0 = 产能锚定建筑不在场或全切加速模式，序列滞留） */
  capacity: number;
  /** 同领域全局并发上限（科研序列受 techTier 限制：T1=2 / T2=4 / T3=Infinity；其余默认 Infinity） */
  globalLimit?: number;
  /** 工时推进加速倍率（如建筑双模并联递减加速比 1.0 ~ 2.50x，基准 1.0） */
  accelMultiplier: number;
  /** 是否处于锁定态（前置锚定建筑未建成/未并网） */
  locked: boolean;
  /** 锁定原因说明（直接复用 SCHEDULE_COPY 与各槽位模块既有文案） */
  lockedReason?: string;
}

/** 工位推导环境快照（基地/建筑/队列/有效目录，全部只读） */
export interface LaneResolveEnv {
  bases: ReadonlyArray<{
    id?: string;
    name?: string;
    status?: string;
    buildings?: ReadonlyArray<{ name: string; state?: string; mode?: string }>;
  }>;
  queues?: ReadonlyArray<TransactionItem>;
  catalog: EffectiveCatalog;
}

/** 领域工位提供者接口（ProductionLaneProvider / ResearchLaneProvider / EngineeringLaneProvider ＋ ProtocolLaneProvider 预留） */
export interface ILaneProvider {
  readonly domain: TaskDomain;
  /** 根据战区基地、建筑与目录快照，推导并输出该领域的所有可用流水线快照 */
  resolveLanes(env: LaneResolveEnv): LaneStationView[];
  /** 根据原始事务或任务归属，推导其目标 laneKey */
  resolveTaskLaneKey(txn: TransactionItem, env: LaneResolveEnv): string;
}

/* ═══════════════ 轴四 · 时间推进步进上下文与结果契约（§3.4） ═══════════════ */

export interface TickContext {
  /** 时钟推进时间步长（分钟） */
  deltaMinutes: number;
  /** 战区/属地电网供电效率回调或标量（0.0 ~ 1.0，缺省按任务通过 operationEngine 评估） */
  powerEfficiency?: number | ((task: UnifiedTask) => number);
  /** 算力供需比或两阶段分装效率回调（缺省 1.0；接入 twoStageAssemblyEngine 时提供精确分装倍率與纳米抵扣） */
  computeRatio?: number | ((task: UnifiedTask) => number);
  /** 游戏内当前日历时刻（用于为新升格 active 任务补记 startedAt） */
  now?: string;
  /**
   * 可选：两阶段装配数据块查询回调（桥接 twoStageAssemblyEngine）。
   * 未显式注入时，若注入了 computeFor / nanitesFor，则自动从 task.workload
   * （tflopsRequired / topsRequired / naniteCost）与 task.metadata.twoStageSpec 派生。
   */
  assemblyFor?: (task: UnifiedTask) => TwoStageSpec | undefined;
  /**
   * 可选：可用算力池查询回调或静态预算（桥接 twoStageAssemblyEngine.phase2Multiplier）。
   * 注入后自动启用两阶段算力积分：阶段一（配料）不吃算力，阶段二（组装/推演）按双算力满足度
   * 加速并执行双轨 minDaysLock（研究总工期地板 / 制造阶段二地板）物理硬下限钳制。
   */
  computeFor?: ComputeBudget | ((task: UnifiedTask) => ComputeBudget);
  /**
   * 可选：可用纳米库存查询回调或静态值（桥接 twoStageAssemblyEngine.applyNaniteDeduction）。
   * 注入后对零进度（spentMinutes === 0）的 active 任务执行一次阶段一纳米抵扣并产出 nanites_deducted 事件。
   */
  nanitesFor?: number | null | ((task: UnifiedTask) => number | null);
  /**
   * 可选：同领域/同类型全局并发上限覆写回调（缺省读取 LaneStationView.globalLimit）。
   */
  globalLimitFor?: (task: UnifiedTask) => number;
  /**
   * 可选：自定义 draft 拓扑节点解锁准入守卫（缺省要求 metadata.funded !== false）。
   */
  canUnlockDraft?: (task: UnifiedTask) => boolean;
  /**
   * 可选：容量缩水挤退事件类型（缺省 'preempted'；传入 'demoted' 时与 transactionEngine ③′ 回检事件名完全对齐）。
   */
  evictEventType?: 'preempted' | 'demoted';
  /**
   * 可选：带宽升格与回检相对工时积分的时序（缺省 'before_integration' 即 UTO 标准三阶段顺序：① 带宽裁决 → ② 工时积分 → ③ 拓扑解锁；
   * 传入 'after_integration' 时对齐 transactionEngine 既有四步序：先对存量 active 积分，再执行容量回检与空额升格）。
   */
  promotionTiming?: 'before_integration' | 'after_integration';
}

export interface TickResult {
  nextTasks: UnifiedTask[];
  completedTaskIds: string[];
  settlingTaskIds: string[];
  promotedTaskIds: string[];
  /** 因工位容量缩减而挤退回 queued 的任务 ID 清单 */
  preemptedTaskIds: string[];
  /** 因前置拓扑完成而由 draft 激活为 queued 的后置任务 ID 清单 */
  unlockedTaskIds: string[];
  /** 兼容既有 transactionEngine / twoStageAssemblyEngine 的结算事件流 */
  events: TwoStageEvent[];
}

/* ═══════════════ 双账本状态确定性映射（§3.1.2 真值表，全部纯函数） ═══════════════ */

/**
 * 队列账本五态 ＋ hold 标记 → 统一七态（§3.1.2 真值表）：
 * - 'queued' + hold → 'held'（奉令暂缓：工时留存、不占工位、不参与升格）；
 * - 'active' + hold → 'held'（异常防御归一：暂缓优先让出工位）；
 * - 'done' / 'completed' → 'completed'（'completed' 为宽容别名，防外部新档直写）；
 * - 'draft' / 'held' 直通（hold 标记账本不存在此二态，宽容接通）；
 * - 未知非法值安全兜底 hold ? 'held' : 'queued'（不占工位带宽、不抛错）。
 */
export function queueStatusToTaskStatus(status: string, hold?: boolean): TaskStatus {
  switch (status) {
    case 'queued':
      return hold ? 'held' : 'queued';
    case 'active':
      return hold ? 'held' : 'active';
    case 'settling':
      return 'settling'; // 对账态免疫 hold：裁决期内不再接受调度令
    case 'done':
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'draft':
      return 'draft';
    case 'held':
      return 'held';
    default:
      return hold ? 'held' : 'queued';
  }
}

/**
 * 统一七态 → 队列账本五态 ＋ hold 标记（投影回写口径，阶段二调度桥接用）：
 * - 'draft' → queued（draft 不入队列账本，回写按「未注资候列」口径归一，注资/解锁由工程侧裁决）；
 * - 'held' → queued + hold=true（队列账本无独立 held 态，恒经 hold 标记承载）。
 * 返回新对象，调用方修改不污染内部映射。
 */
export function taskStatusToQueueState(taskStatus: TaskStatus): { status: TransactionStatus; hold: boolean } {
  switch (taskStatus) {
    case 'draft':
    case 'queued':
      return { status: 'queued', hold: false };
    case 'active':
      return { status: 'active', hold: false };
    case 'held':
      return { status: 'queued', hold: true };
    case 'settling':
      return { status: 'settling', hold: false };
    case 'completed':
      return { status: 'done', hold: false };
    case 'cancelled':
      return { status: 'cancelled', hold: false };
    default:
      // TaskStatus 联合类型已穷尽；default 仅为 JS 边界调用兜底，不改变契约口径
      return { status: 'queued', hold: false };
  }
}

/**
 * 工程分段账本状态（ProjectPhase / ProjectModule 五态中文枚举）→ 统一七态（§3.1.2 真值表）：
 * - 「进行中 / 暂停」且存在有效 linkedQueue（queue_index 指针指向的投影队列项）时，
 *   优先跟随队列账本映射（指针合一防双影铁律），含 active+hold → held 防御归一；
 * - 「未启动」→ 'draft'；「进行中」无指针兜底 → 'active'；「暂停」无指针兜底 → 'held'；
 * - 「完工」→ 'completed'（可解锁下游 dependsOn 节点）；「取消」→ 'cancelled'；
 * - 未知非法值安全兜底 'draft'（不占工位带宽、不抛错）。
 */
export function projectSegmentStatusToTaskStatus(
  segStatus: string,
  linkedQueue?: { status: string; hold?: boolean } | null,
): TaskStatus {
  if (linkedQueue && (segStatus === '进行中' || segStatus === '暂停')) {
    return queueStatusToTaskStatus(linkedQueue.status, linkedQueue.hold);
  }
  switch (segStatus) {
    case '未启动':
      return 'draft';
    case '进行中':
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

/**
 * 原始事务类型 → 任务领域（§3.1 类型归域）：
 * - '工程' 按来源分账：V2 仓段化巨构（isV2Project=true）→ 'megastructure'，
 *   V1 线性阶段改装工程 → 'retrofit'；
 * - '协议' 预留接通 protocol 域（D-P27）；
 * - 未知非法值安全兜底 'production'（不抛错）。
 */
export function queueTypeToTaskDomain(type: string, opts?: { isV2Project?: boolean }): TaskDomain {
  switch (type) {
    case '建造':
      return 'construction';
    case '生产':
      return 'production';
    case '研究':
      return 'research';
    case '改装':
      return 'retrofit';
    case '工程':
      return opts?.isV2Project ? 'megastructure' : 'retrofit';
    case '协议':
      return 'protocol';
    default:
      return 'production';
  }
}

/* ═══════════════ 状态守卫（纯函数，供步进机与调度总线共用） ═══════════════ */

/** 终态判定：completed / cancelled 不可逆、不可复活（§3.1 状态机铁律） */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

/** 调度指令免疫判定：settling / completed / cancelled 不参与任何重排调度（§2.2 / §3.5） */
export function isDispatchImmuneTaskStatus(status: TaskStatus): boolean {
  return status === 'settling' || isTerminalTaskStatus(status);
}

/**
 * 七态合法迁移白名单（对齐 transactionEngine.LEGAL_TRANSITIONS §2 ＋ 七态扩展语义）：
 * - 队列五态子集逐条对齐：queued→active / active→settling / active→queued /
 *   settling→completed（三色门 MATCH·UNDERRUN 认领，步进机外裁决）/
 *   settling→active（UNDERRUN 余量退回）/ queued→cancelled / active→cancelled；
 * - 七态扩展：draft→queued（拓扑解锁/注资立项，§3.4 第三阶段）/ draft→cancelled（规划期撤销）/
 *   queued↔held（Hold/Resume）/ active→held（防御归一：active+hold=true）/ held→cancelled（暂缓期撤销）；
 * - 终态（completed/cancelled）出发的一切迁移与自迁移一律拒绝（不可逆）。
 */
const LEGAL_TASK_TRANSITIONS: ReadonlyArray<readonly [TaskStatus, TaskStatus]> = [
  ['queued', 'active'],
  ['active', 'settling'],
  ['active', 'queued'],
  ['settling', 'completed'],
  ['settling', 'active'],
  ['queued', 'cancelled'],
  ['active', 'cancelled'],
  ['draft', 'queued'],
  ['draft', 'cancelled'],
  ['queued', 'held'],
  ['active', 'held'],
  ['held', 'queued'],
  ['held', 'cancelled'],
];

/** 状态机迁移守卫：仅白名单迁移返回 true（终态不可逆、自迁移一律拒绝） */
export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false;
  if (isTerminalTaskStatus(from)) return false;
  return LEGAL_TASK_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/* ═══════════════ 时间推进三阶段步进核心机（§3.4 · UTO-TICK-01） ═══════════════ */

/**
 * 任务深拷贝（写时复制）：克隆一层嵌套结构（workload/batch/topology/metadata/数组字段），
 * 保证调用方对返回体的一切修改均不回渗入参。纯函数，无任何副作用。
 */
function cloneTask(task: UnifiedTask): UnifiedTask {
  const next: UnifiedTask = { ...task, workload: { ...task.workload } };
  if (task.batch !== undefined) next.batch = { ...task.batch };
  if (task.topology !== undefined) {
    next.topology = {
      ...task.topology,
      ...(task.topology.dependsOn !== undefined ? { dependsOn: [...task.topology.dependsOn] } : {}),
      ...(task.topology.subTaskIds !== undefined ? { subTaskIds: [...task.topology.subTaskIds] } : {}),
    };
  }
  if (task.metadata !== undefined) next.metadata = { ...task.metadata };
  if (task.participatingBases !== undefined) next.participatingBases = [...task.participatingBases];
  return next;
}

/**
 * 识别纯容器父节点（如 V1/V2 工程总成根节点 task:proj:${id}）：
 * - metadata.sourceKind === 'project_root'，或
 * - 无 parentId 且包含非空 subTaskIds 的顶层聚合节点。
 * 纯容器父节点不直接占用工位带宽，也不参与工时积分与拓扑解锁。
 */
function isContainerTask(task: UnifiedTask): boolean {
  if (task.metadata?.sourceKind === 'project_root') return true;
  if (task.topology?.parentId === undefined && (task.topology?.subTaskIds?.length ?? 0) > 0) {
    return true;
  }
  return false;
}

/** 解析任务的原始事务类型（供 twoStageAssemblyEngine 双算力权重与研究/制造双轨 minDaysLock 钳制分流） */
function resolveRawTypeForTask(task: UnifiedTask): string {
  const rawType = task.metadata?.rawType;
  if (typeof rawType === 'string' && rawType.trim().length > 0) {
    return rawType;
  }
  switch (task.domain) {
    case 'research':
      return '研究';
    case 'construction':
      return '建造';
    case 'production':
      return '生产';
    case 'retrofit':
      return '改装';
    case 'megastructure':
      return '工程';
    case 'protocol':
      return '协议';
    default:
      return '生产';
  }
}

/** 从任务与上下文解析 TwoStageSpec（优先 ctx.assemblyFor，次选 metadata.twoStageSpec 与 workload 声明） */
function resolveTwoStageSpec(task: UnifiedTask, ctx: TickContext): TwoStageSpec | undefined {
  if (ctx.assemblyFor) {
    return ctx.assemblyFor(task);
  }
  const metaSpec = task.metadata?.twoStageSpec as TwoStageSpec | undefined;
  const rawType = resolveRawTypeForTask(task);
  // 工程/巨构的 naniteCost 为纳米开工门而非阶段一配料抵扣（对齐 settleFloor.ts D8b）
  const allowWorkloadNaniteDeduction = task.domain !== 'megastructure' && rawType !== '工程';
  const reqNanites = metaSpec?.req_nanites ?? (allowWorkloadNaniteDeduction ? task.workload.naniteCost : undefined);
  const tflops = metaSpec?.tflops ?? task.workload.tflopsRequired;
  const tops = metaSpec?.tops ?? task.workload.topsRequired;
  const rawPhase1Ratio = (task.workload as { phase1Ratio?: number }).phase1Ratio;
  const hasPhase1Ratio = typeof rawPhase1Ratio === 'number' && Number.isFinite(rawPhase1Ratio) && rawPhase1Ratio > 0 && rawPhase1Ratio < 1;
  const tMat = metaSpec?.t_mat ?? (hasPhase1Ratio ? rawPhase1Ratio : undefined);
  const tAsm = metaSpec?.t_asm ?? (hasPhase1Ratio ? 1 - rawPhase1Ratio : undefined);
  if (
    reqNanites === undefined &&
    tflops === undefined &&
    tops === undefined &&
    tMat === undefined &&
    tAsm === undefined
  ) {
    return undefined;
  }
  return {
    ...(tMat !== undefined ? { t_mat: tMat } : {}),
    ...(tAsm !== undefined ? { t_asm: tAsm } : {}),
    ...(reqNanites !== undefined ? { req_nanites: reqNanites } : {}),
    ...(tflops !== undefined ? { tflops } : {}),
    ...(tops !== undefined ? { tops } : {}),
  };
}

/** 构造供 twoStageAssemblyEngine 纯函数消费的最小事务视图（零副作用） */
function toTxnViewForTwoStage(task: UnifiedTask): TransactionItem {
  const totalMinutes = Number.isFinite(task.workload.totalMinutes) ? task.workload.totalMinutes : 0;
  const spentMinutes = Number.isFinite(task.workload.spentMinutes) ? task.workload.spentMinutes : 0;
  const minDaysLock =
    typeof task.workload.minDaysLock === 'number' && Number.isFinite(task.workload.minDaysLock)
      ? Math.max(0, task.workload.minDaysLock)
      : 0;
  const progress = totalMinutes > 0 ? Math.min(100, (spentMinutes / totalMinutes) * 100) : 0;
  const mappedState = taskStatusToQueueState(task.status);
  return {
    type: resolveRawTypeForTask(task),
    item: task.name,
    base: task.leadBaseId ?? '',
    progress,
    eta: typeof task.metadata?.eta === 'string' ? task.metadata.eta : '',
    status: mappedState.status,
    started_at: typeof task.metadata?.startedAt === 'string' ? task.metadata.startedAt : '',
    total_minutes: totalMinutes,
    spent_minutes: spentMinutes,
    qty: task.batch?.totalQty ?? 1,
    qty_done: task.batch?.completedQty ?? 0,
    cost_paid: task.costPaid ?? true,
    min_days_lock: minDaysLock,
    hold: mappedState.hold,
  };
}

/** 求值电网供电效率（标量或回调，缺省 1.0，非法值安全兜底 1.0，负值钳为 0） */
function evalPowerEfficiency(ctx: TickContext, task: UnifiedTask): number {
  const raw = typeof ctx.powerEfficiency === 'function' ? ctx.powerEfficiency(task) : ctx.powerEfficiency;
  if (raw === undefined) return 1;
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 1;
}

/** 求值算力供需比（标量或回调，缺省 1.0，非法值安全兜底 1.0，负值钳为 0） */
function evalComputeRatio(ctx: TickContext, task: UnifiedTask): number {
  const raw = typeof ctx.computeRatio === 'function' ? ctx.computeRatio(task) : ctx.computeRatio;
  if (raw === undefined) return 1;
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 1;
}

/** 求值可用算力池预算（标量或回调，缺省 { tflops: 0, tops: 0 }） */
function evalComputeBudget(ctx: TickContext, task: UnifiedTask): ComputeBudget {
  if (ctx.computeFor === undefined) return { tflops: 0, tops: 0 };
  const raw = typeof ctx.computeFor === 'function' ? ctx.computeFor(task) : ctx.computeFor;
  return {
    tflops: typeof raw?.tflops === 'number' && Number.isFinite(raw.tflops) ? Math.max(0, raw.tflops) : 0,
    tops: typeof raw?.tops === 'number' && Number.isFinite(raw.tops) ? Math.max(0, raw.tops) : 0,
  };
}

/** 为 active 任务补记开工时刻（仅当 ctx.now 非空且 startedAt 为空时写入） */
function backfillStartedAtIfNeeded(task: UnifiedTask, now: string | undefined): void {
  if (typeof now !== 'string' || now.length === 0) return;
  if (task.metadata === undefined) {
    task.metadata = { startedAt: now };
  } else if (task.metadata.startedAt === undefined || task.metadata.startedAt === '') {
    task.metadata.startedAt = now;
  }
}

/** 对零进度（spentMinutes === 0）的 active 任务执行一次阶段一纳米抵扣判定（支持批内递减游标 remainingNanites） */
function runNaniteDeductionForTask(
  task: UnifiedTask,
  ctx: TickContext,
  events: TwoStageEvent[],
  naniteCursor: { deducted: number },
): void {
  if (ctx.nanitesFor === undefined) return;
  if (isContainerTask(task) || task.status !== 'active') return;
  if (task.workload.totalMinutes <= 0 || task.workload.spentMinutes !== 0) return;
  const spec = resolveTwoStageSpec(task, ctx);
  const rawAvailable = typeof ctx.nanitesFor === 'function' ? ctx.nanitesFor(task) : ctx.nanitesFor;
  const available =
    typeof rawAvailable === 'number' && Number.isFinite(rawAvailable)
      ? Math.max(0, rawAvailable - naniteCursor.deducted)
      : 0;
  const txnView = toTxnViewForTwoStage(task);
  const deduction = applyNaniteDeduction(txnView, spec, available);
  if (deduction.event) {
    task.workload.spentMinutes = deduction.txn.spent_minutes;
    naniteCursor.deducted += Math.max(0, deduction.event.amount);
    events.push(deduction.event);
  }
}

/**
 * 通用任务编排步进核心函数（§3.4 三阶段纯函数步进机 · UTO-TICK-01）。
 *
 * 标准三阶段结算顺序：
 * 1. 第一阶段：工位带宽抢占与超额挤退裁决（Bandwidth Allocation & Eviction）
 *    - 跳过纯容器父节点（project_root 或无 parentId 且含 subTaskIds 的工程总成节点）；
 *    - 容量缩水挤退（Capacity Shrinkage）：当 lane.locked（有效容量为 0）或当前 active 数 > effectiveCapacity
 *      （或超出同领域 globalLimit）时，按末序在编优先原则将超额 active 任务挤退回 'queued'（spentMinutes 进度 100% 留存），
 *      记入 preemptedTaskIds 并产出 preempted / demoted 事件；
 *    - 空额带宽升格（Bandwidth Promotion）：当 !lane.locked 且当前 active 数 < effectiveCapacity 且未达领域 globalLimit 时，
 *      按数组序扫描该流水线中 status === 'queued' 的候列任务（'held' 与 'draft' 绝不升格），依次升格为 'active'，
 *      补记 metadata.startedAt = ctx.now，记入 promotedTaskIds 并产出 promoted 事件；
 * 2. 第二阶段：有效工时积分推进（Workload Integration）
 *    - 当 ctx.deltaMinutes > 0 时，遍历所有 status === 'active' 的非容器任务：
 *    - 若 workload.totalMinutes <= 0，保持 'active' 不推进，产出 unknown_duration 事件；
 *    - 否则计算有效工时增量 Δspent = Δt × accelMultiplier × powerEfficiency × computeRatio，
 *      并支持桥接 twoStageAssemblyEngine（阶段一纳米抵扣、阶段二双算力加速及双轨 minDaysLock * 1440 物理硬下限钳制）；
 *    - 支持批量流水作业（batch.totalQty > 1）：每满单件工时累进 batch.completedQty 并产出 qty_progress 事件；
 *    - 累计有效工时达标（spentMinutes >= totalMinutes）时，任务状态转入 'settling'，记入 settlingTaskIds，
 *      产出 enter_settling 事件（红线：绝不在步进机内越过三色对账门直接置为 'completed'）；
 * 3. 第三阶段：DAG 拓扑依赖触发与离散步长边界（Topology Trigger & Discrete Step Boundary）
 *    - 扫描处于 'draft' 态且配置了非空 topology.dependsOn 的任务：当所有前置任务在本轮步进前已处于 'completed'
 *      （本轮刚进 'settling' 的任务不算 'completed'）且通过准入守卫时，由 'draft' 激活为 'queued'，记入 unlockedTaskIds；
 *    - 严守零单步跨任务穿透铁律：本轮新解锁为 'queued' 的任务绝不参与本轮第一阶段升格，也绝不消耗本轮 Δt。
 */
export function tickTaskOrchestration(
  currentTasks: readonly UnifiedTask[],
  lanes: readonly LaneStationView[],
  ctx: TickContext,
): TickResult {
  const nextTasks: UnifiedTask[] = currentTasks.map(cloneTask);
  const completedTaskIds: string[] = [];
  const settlingTaskIds: string[] = [];
  const promotedTaskIds: string[] = [];
  const preemptedTaskIds: string[] = [];
  const unlockedTaskIds: string[] = [];
  const events: TwoStageEvent[] = [];

  // 记录本轮步进前已处于 completed 终态的任务 ID 集合（第三阶段拓扑解锁唯一合法前置依据）
  const completedBeforeTick = new Set<string>();
  for (const task of currentTasks) {
    if (task.status === 'completed') {
      completedBeforeTick.add(task.id);
    }
  }

  // 建立流水线工位快照索引与领域全局上限索引（未知 laneKey 兜底：capacity=1, accelMultiplier=1, locked=false, globalLimit=Infinity）
  const laneMap = new Map<string, LaneStationView>();
  const domainGlobalLimitMap = new Map<TaskDomain, number>();
  for (const lane of lanes) {
    laneMap.set(lane.laneKey, lane);
    if (lane.globalLimit !== undefined && Number.isFinite(lane.globalLimit)) {
      const clamped = Math.max(0, lane.globalLimit);
      const prev = domainGlobalLimitMap.get(lane.domain);
      domainGlobalLimitMap.set(lane.domain, prev === undefined ? clamped : Math.min(prev, clamped));
    }
  }

  const getEffectiveCapacity = (task: UnifiedTask): number => {
    const lane = laneMap.get(task.laneKey);
    if (!lane) return 1;
    if (lane.locked) return 0;
    return typeof lane.capacity === 'number' && Number.isFinite(lane.capacity) ? Math.max(0, lane.capacity) : 0;
  };

  const isLaneLocked = (task: UnifiedTask): boolean => {
    const lane = laneMap.get(task.laneKey);
    if (!lane) return false;
    return Boolean(lane.locked) || getEffectiveCapacity(task) <= 0;
  };

  const getAccelMultiplier = (task: UnifiedTask): number => {
    const lane = laneMap.get(task.laneKey);
    if (!lane) return 1;
    return typeof lane.accelMultiplier === 'number' && Number.isFinite(lane.accelMultiplier)
      ? Math.max(0, lane.accelMultiplier)
      : 1;
  };

  const getEffectiveGlobalLimit = (task: UnifiedTask): number => {
    const lane = laneMap.get(task.laneKey);
    const laneLimit =
      lane?.globalLimit !== undefined
        ? Number.isFinite(lane.globalLimit)
          ? Math.max(0, lane.globalLimit)
          : Infinity
        : (domainGlobalLimitMap.get(task.domain) ?? Infinity);
    const customLimit = ctx.globalLimitFor ? ctx.globalLimitFor(task) : Infinity;
    const safeCustom =
      typeof customLimit === 'number' && Number.isFinite(customLimit) ? Math.max(0, customLimit) : Infinity;
    return Math.min(laneLimit, safeCustom);
  };

  // 第一阶段执行体：容量缩水挤退（末序在编优先）＋ 空额带宽升格
  const runStage1Bandwidth = (): Set<string> => {
    const activeByLane = new Map<string, number>();
    const activeByDomain = new Map<TaskDomain, number>();
    const newlyPromotedSet = new Set<string>();
    const evictType: 'preempted' | 'demoted' = ctx.evictEventType ?? 'preempted';

    // 1a. 容量缩水挤退（Capacity Shrinkage）：按数组序保留前 N 个合规 active，末序超额 active 挤退回 queued
    for (const task of nextTasks) {
      if (isContainerTask(task) || task.status !== 'active') continue;
      const laneCap = getEffectiveCapacity(task);
      const globalLimit = getEffectiveGlobalLimit(task);
      const laneUsed = activeByLane.get(task.laneKey) ?? 0;
      const domainUsed = activeByDomain.get(task.domain) ?? 0;

      if (!isLaneLocked(task) && laneUsed < laneCap && domainUsed < globalLimit) {
        activeByLane.set(task.laneKey, laneUsed + 1);
        activeByDomain.set(task.domain, domainUsed + 1);
        backfillStartedAtIfNeeded(task, ctx.now);
      } else if (canTransitionTaskStatus(task.status, 'queued')) {
        task.status = 'queued';
        preemptedTaskIds.push(task.id);
        events.push({
          type: evictType,
          item: task.name,
          base: task.leadBaseId ?? '',
          detail: `active 回检降格 queued（进度保留，gate_recheck：产线已占 ${laneUsed}/${laneCap}，同类型全局 ${domainUsed}/${globalLimit}）`,
        });
      }
    }

    // 1b. 空额带宽升格（Bandwidth Promotion）：仅 status === 'queued' 参与（'held' 与 'draft' 绝不升格）
    for (const task of nextTasks) {
      if (isContainerTask(task) || task.status !== 'queued') continue;
      if (task.metadata?.hold === true) continue;
      if (isLaneLocked(task) || !canTransitionTaskStatus(task.status, 'active')) continue;

      const laneCap = getEffectiveCapacity(task);
      const globalLimit = getEffectiveGlobalLimit(task);
      const laneUsed = activeByLane.get(task.laneKey) ?? 0;
      const domainUsed = activeByDomain.get(task.domain) ?? 0;
      if (laneUsed >= laneCap || domainUsed >= globalLimit) continue;

      task.status = 'active';
      activeByLane.set(task.laneKey, laneUsed + 1);
      activeByDomain.set(task.domain, domainUsed + 1);
      backfillStartedAtIfNeeded(task, ctx.now);
      promotedTaskIds.push(task.id);
      newlyPromotedSet.add(task.id);
      events.push({
        type: 'promoted',
        item: task.name,
        base: task.leadBaseId ?? '',
        detail: `带宽空位升格 active（产线 ${laneUsed + 1}/${laneCap}）`,
      });
    }

    return newlyPromotedSet;
  };

  // 第二阶段执行体：有效工时积分推进（含两阶段装配/算力加速与 minDaysLock 物理硬下限钳制）
  const runStage2Integration = (): void => {
    const safeDelta = Number.isFinite(ctx.deltaMinutes) ? Math.max(0, ctx.deltaMinutes) : 0;
    const useTwoStageCompute = ctx.computeFor !== undefined || ctx.assemblyFor !== undefined;

    for (const task of nextTasks) {
      if (isContainerTask(task) || task.status !== 'active') continue;

      if (task.workload.totalMinutes <= 0) {
        if (safeDelta > 0) {
          events.push({
            type: 'unknown_duration',
            item: task.name,
            base: task.leadBaseId ?? '',
            detail: `total_minutes=${task.workload.totalMinutes}（未知工期），进度不推进`,
          });
        }
        continue;
      }

      if (safeDelta <= 0) continue;

      const accelMultiplier = getAccelMultiplier(task);
      const powerEff = evalPowerEfficiency(ctx, task);
      const explicitComputeRatio = evalComputeRatio(ctx, task);
      const hasMetaTwoStageSpec = task.metadata?.twoStageSpec !== undefined;

      let effectiveRate: number;
      if (useTwoStageCompute || hasMetaTwoStageSpec) {
        // 桥接 twoStageAssemblyEngine：阶段一（配料）仅受基础工况与双模加速驱动，阶段二叠加双算力加速与双轨 minDaysLock 钳制
        const spec = resolveTwoStageSpec(task, ctx);
        const budget = evalComputeBudget(ctx, task);
        const phase1End = task.workload.totalMinutes * phaseSplit(spec).phase1;
        const twoStageMult =
          task.workload.spentMinutes < phase1End ? 1 : phase2Multiplier(toTxnViewForTwoStage(task), spec, budget);
        effectiveRate = Math.max(0, accelMultiplier * powerEff * twoStageMult * explicitComputeRatio);
      } else {
        // 直接标量/回调模式：Δspent = Δt × accel × power × compute，受 minDaysLock * 1440 物理硬下限钳制
        const rawRate = Math.max(0, accelMultiplier * powerEff * explicitComputeRatio);
        const minDaysLock =
          typeof task.workload.minDaysLock === 'number' && Number.isFinite(task.workload.minDaysLock)
            ? Math.max(0, task.workload.minDaysLock)
            : 0;
        const lockMinutes = minDaysLock > 0 ? minDaysLock * MINUTES_PER_DAY : 0;
        if (lockMinutes > 0) {
          const maxRateByLock = task.workload.totalMinutes / lockMinutes;
          effectiveRate = Math.min(rawRate, maxRateByLock);
        } else {
          effectiveRate = rawRate;
        }
      }

      task.workload.spentMinutes = task.workload.spentMinutes + safeDelta * effectiveRate;

      // 批量流水作业（batch.totalQty > 1）：对齐 transactionEngine 单件工时累进逻辑
      if (task.batch && task.batch.totalQty > 1) {
        const unitMinutes = task.workload.totalMinutes / task.batch.totalQty;
        const doneNow = Math.min(task.batch.totalQty, Math.floor(task.workload.spentMinutes / unitMinutes));
        if (doneNow !== task.batch.completedQty) {
          task.batch.completedQty = doneNow;
          events.push({
            type: 'qty_progress',
            item: task.name,
            base: task.leadBaseId ?? '',
            detail: `批次流水 ${doneNow}/${task.batch.totalQty}`,
          });
        }
      }

      // 满额转入 settling（等待三色对账门确认，绝不在步进机内越权自置 completed）
      const progress = Math.min(100, (task.workload.spentMinutes / task.workload.totalMinutes) * 100);
      if (progress >= 100 && canTransitionTaskStatus(task.status, 'settling')) {
        if (task.batch) {
          task.batch.completedQty = task.batch.totalQty;
        }
        task.status = 'settling';
        settlingTaskIds.push(task.id);
        events.push({
          type: 'enter_settling',
          item: task.name,
          base: task.leadBaseId ?? '',
          detail: '进度满，等待三色对账门裁决（settling→done 归 CTRL-RECONCILE-01）',
        });
      }
    }
  };

  const naniteCursor = { deducted: 0 };

  if (ctx.promotionTiming === 'after_integration') {
    // 兼容 transactionEngine / settleFloor 既有四步序（UTO-MAIN-01）：
    // 存量 active 零进度纳米抵扣 → 工时积分 → 开工时刻补记 → 带宽回检与空额升格 → 新升格纳米抵扣
    for (const task of nextTasks) {
      runNaniteDeductionForTask(task, ctx, events, naniteCursor);
    }
    runStage2Integration();
    if (ctx.now) {
      for (const task of nextTasks) {
        if (!isContainerTask(task) && task.status === 'active') {
          backfillStartedAtIfNeeded(task, ctx.now);
        }
      }
    }
    const newlyPromoted = runStage1Bandwidth();
    for (const task of nextTasks) {
      if (newlyPromoted.has(task.id)) {
        runNaniteDeductionForTask(task, ctx, events, naniteCursor);
      }
    }
  } else {
    // 标准 UTO 三阶段步进序：① 带宽抢占与超额挤退 → （两阶段零进度纳米抵扣） → ② 有效工时积分 → ③ DAG 拓扑解锁
    runStage1Bandwidth();
    for (const task of nextTasks) {
      runNaniteDeductionForTask(task, ctx, events, naniteCursor);
    }
    runStage2Integration();
  }

  // 第三阶段：DAG 拓扑依赖触发与离散步长边界（零单步跨任务穿透：新解锁的 queued 绝不回流阶段一/二）
  for (const task of nextTasks) {
    if (isContainerTask(task) || task.status !== 'draft') continue;
    const deps = task.topology?.dependsOn;
    if (!deps || deps.length === 0) continue;
    if (task.metadata?.funded === false) continue;
    if (ctx.canUnlockDraft && !ctx.canUnlockDraft(task)) continue;

    const allDepsCompleted = deps.every(depId => completedBeforeTick.has(depId));
    if (allDepsCompleted && canTransitionTaskStatus(task.status, 'queued')) {
      task.status = 'queued';
      unlockedTaskIds.push(task.id);
    }
  }

  return {
    nextTasks,
    completedTaskIds,
    settlingTaskIds,
    promotedTaskIds,
    preemptedTaskIds,
    unlockedTaskIds,
    events,
  };
}
