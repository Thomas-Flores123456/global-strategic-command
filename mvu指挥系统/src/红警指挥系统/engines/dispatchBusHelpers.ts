/**
 * dispatchBusHelpers.ts —— 统一调度指令总线纯辅助函数与工程指令转译模块
 *
 * 从 dispatchBus.ts 拆出：
 * - 核心类型与结果契约（UnifiedCommand / DispatchBusResult / RejectedDispatchOrder 等）
 * - 内部纯函数工具（写时复制、流水线位置挪动、并发计数、Allocate 属地 laneKey 重算）
 * - 四动词映射与 <工程> 指令双向无损转译桥（fromEngineeringOrder / toEngineeringOrder / toEngineeringCommandText）
 */

import { canon, type EngOrder } from '../parse/parsePipeline';
import { ENGINEERING_SLOT_REGISTRY, makeEngLaneKeyFor } from './engineeringSlots';
import { createLaneRegistryHub, type LaneRegistryHub } from './laneProviders';
import {
  isDispatchImmuneTaskStatus,
  type LaneResolveEnv,
  type LaneStationView,
  type TaskDomain,
  type UnifiedTask,
} from './taskOrchestrator';
import { DISPATCH_VERBS, type DispatchOrder, type DispatchVerb, type TransactionItem } from './transactionEngine';

/* ═══════════════ 1. 核心类型与结果契约（对齐任务包 §3.5） ═══════════════ */

/** 统一调度指令六大标准动词枚举 */
export const UNIFIED_COMMAND_TYPES = Object.freeze([
  'Promote',
  'Demote',
  'Hold',
  'Resume',
  'Cancel',
  'Allocate',
] as const);

/** 统一调度指令动词类型 */
export type UnifiedCommandType = (typeof UNIFIED_COMMAND_TYPES)[number];

/** 统一调度指令联合类型（§3.5） */
export type UnifiedCommand =
  | { type: 'Promote'; taskId: string }
  | { type: 'Demote'; taskId: string }
  | { type: 'Hold'; taskId: string }
  | { type: 'Resume'; taskId: string }
  | { type: 'Cancel'; taskId: string }
  | { type: 'Allocate'; taskId: string; baseId: string };

/** 调度降格诱因（兼容 transactionEngine.DispatchDemotion['cause']） */
export type DispatchDemotionCause = 'preempt' | 'demote' | 'hold';

/**
 * 调度执行中发生的 active → queued/held 降格记录（兼容并扩展 transactionEngine.DispatchDemotion）。
 */
export interface DispatchDemotion {
  /** 被降格任务的全局唯一 ID */
  taskId: string;
  /** 任务条令名称（兼容 transactionEngine.DispatchDemotion.item） */
  item: string;
  /** 属地基地（兼容 transactionEngine.DispatchDemotion.base） */
  base: string;
  /** 原始事务类型（兼容 transactionEngine.DispatchDemotion.type） */
  type: string;
  /** 所在流水线 Key */
  laneKey: string;
  /** 降格诱因：preempt=置顶抢占 | demote=置底让位 | hold=工务暂缓 */
  cause: DispatchDemotionCause;
}

/**
 * 调度指令拒收原因码（覆盖任务包 §3.5 六动词前置约束及 transactionEngine 既有原因码）。
 */
export type DispatchRejectReason =
  | 'task_not_found'
  | 'target_not_found'
  | 'immune_status'
  | 'invalid_status'
  | 'invalid_target_status'
  | 'invalid_scope'
  | 'missing_base_id'
  | 'invalid_verb'
  | 'container_task';

/**
 * 被拒调度指令诊断结构（兼容并扩展 transactionEngine.RejectedDispatchOrder）。
 */
export interface RejectedDispatchOrder {
  /** 目标任务 ID（未匹配旧版指令时为合成定位串或空串） */
  taskId: string;
  /** 触发拒收的统一调度指令快照 */
  command: UnifiedCommand;
  /** 兼容 transactionEngine.RejectedDispatchOrder 的旧版调度令视图 */
  order: DispatchOrder;
  /** 结构化拒收原因码 */
  reason: DispatchRejectReason;
  /** 人类可读的拒收详情 */
  detail: string;
}

/** 统一调度指令总线执行结果契约（§3.5） */
export interface DispatchBusResult {
  nextTasks: UnifiedTask[];
  promotedTaskIds: string[];
  preemptedTaskIds: string[];
  demotions: DispatchDemotion[];
  rejected: RejectedDispatchOrder[];
}

/** applyUnifiedCommands 可选扩展配置 */
export interface ApplyUnifiedCommandsOptions {
  /** 游戏内当前日历时刻（提供时为新升格且 startedAt 为空的 active 任务补记开工时刻） */
  now?: string;
  /** 同领域全局并发上限覆写回调（缺省读取 LaneStationView.globalLimit） */
  globalLimitFor?: (task: UnifiedTask) => number;
  /** Allocate 动词自定义属地 laneKey 重算钩子 */
  resolveAllocatedLaneKey?: (task: UnifiedTask, baseId: string, lanes: readonly LaneStationView[]) => string;
  /** 可选：工位环境快照（提供时 Allocate 可通过 LaneRegistryHub 动态推导属地 laneKey） */
  laneEnv?: LaneResolveEnv;
}

/** 旧版 <队列> 调度令转译可选配置 */
export interface FromLegacyDispatchOrdersOptions {
  /**
   * 为 true 时跳过未能匹配到任何任务或动词非法的旧版指令；
   * 缺省 false（将未匹配/非法动词指令映射为可诊断的占位 UnifiedCommand，交由 applyUnifiedCommands 统一产出 rejected）。
   */
  skipUnmatched?: boolean;
  /** 可选收集槽：接收未能匹配到任务的原始 DispatchOrder（调用方传入数组时追加写入） */
  unmatchedOrders?: DispatchOrder[];
}

/** 旧版 <队列> 调度令带诊断转译结果 */
export interface LegacyDispatchTranslationResult {
  commands: UnifiedCommand[];
  unmatchedOrders: DispatchOrder[];
  invalidVerbOrders: DispatchOrder[];
}

/** 扩展工程调度令输入视图（支持 parsePipeline.EngOrder 及模块属地指派） */
export interface EngineeringDispatchOrderInput extends Omit<EngOrder, 'verb'> {
  verb: EngOrder['verb'] | '指派' | '分配';
}

/* ═══════════════ 2. 内部纯函数工具（零副作用、写时复制） ═══════════════ */

/** V1 缺省工程槽显式标识（eng.main） */
const V1_DEFAULT_ENG_LANE = `eng:${ENGINEERING_SLOT_REGISTRY[0].slotId}`;

/** V2 缺省工程槽显式标识（eng.orbital） */
const V2_DEFAULT_ENG_LANE = `eng:${
  (
    ENGINEERING_SLOT_REGISTRY.find(s => s.accepts.includes('project') && !s.accepts.includes('retrofit')) ??
    ENGINEERING_SLOT_REGISTRY[0]
  ).slotId
}`;

/**
 * 承载从 fromLegacyDispatchOrders 生成的指令与原始 DispatchOrder 的只读弱引用关联，
 * 使 applyUnifiedCommands 生成 RejectedDispatchOrder 时可无损还原原始 order，同时保持 UnifiedCommand 纯净结构。
 */
export const LEGACY_ORDER_TRACE = new WeakMap<UnifiedCommand, DispatchOrder>();

/** 任务深拷贝（写时复制）：保证返回体与入参彻底隔离，支持入参 Object.freeze 深冻结 */
export function cloneTask(task: UnifiedTask): UnifiedTask {
  const next: UnifiedTask = {
    ...task,
    workload: { ...task.workload },
  };
  if (task.batch !== undefined) {
    next.batch = { ...task.batch };
  }
  if (task.topology !== undefined) {
    next.topology = {
      ...task.topology,
      ...(task.topology.dependsOn !== undefined ? { dependsOn: [...task.topology.dependsOn] } : {}),
      ...(task.topology.subTaskIds !== undefined ? { subTaskIds: [...task.topology.subTaskIds] } : {}),
    };
  }
  if (task.metadata !== undefined) {
    next.metadata = { ...task.metadata };
    if (Array.isArray(task.metadata.allocatableBases)) {
      next.metadata.allocatableBases = [...(task.metadata.allocatableBases as string[])];
    }
  }
  if (task.participatingBases !== undefined) {
    next.participatingBases = [...task.participatingBases];
  }
  const taskWithAlloc = task as UnifiedTask & { allocatableBases?: string[] };
  if (Array.isArray(taskWithAlloc.allocatableBases)) {
    (next as UnifiedTask & { allocatableBases?: string[] }).allocatableBases = [...taskWithAlloc.allocatableBases];
  }
  return next;
}

/** 指令浅拷贝（确保 rejected 中保存的 command 不引用外部可变对象） */
export function cloneCommand(cmd: UnifiedCommand): UnifiedCommand {
  if (cmd.type === 'Allocate') {
    return { type: 'Allocate', taskId: cmd.taskId, baseId: cmd.baseId };
  }
  return { type: cmd.type, taskId: cmd.taskId };
}

/**
 * 识别纯容器父节点（如 V1/V2 工程总成根节点 task:proj:${id}）：
 * - metadata.sourceKind === 'project_root'，或
 * - 无 parentId 且包含非空 subTaskIds 的顶层聚合节点。
 */
export function isContainerTask(task: UnifiedTask): boolean {
  if (task.metadata?.sourceKind === 'project_root') return true;
  if (task.topology?.parentId === undefined && (task.topology?.subTaskIds?.length ?? 0) > 0) {
    return true;
  }
  return false;
}

/** 解析任务的原始事务类型（供 DispatchDemotion / DispatchOrder 对齐） */
export function resolveRawTypeForTask(task: UnifiedTask): string {
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
      return task.metadata?.sourceKind === 'project_phase' || task.metadata?.sourceKind === 'project_root'
        ? '工程'
        : '改装';
    case 'megastructure':
      return '工程';
    case 'protocol':
      return '协议';
    default:
      return '生产';
  }
}

/** 统一指令动词 → 旧版调度动词展示映射 */
export function toDisplayVerb(type: string): string {
  switch (type) {
    case 'Promote':
      return '置顶';
    case 'Demote':
      return '置底';
    case 'Hold':
      return '暂缓';
    case 'Resume':
      return '恢复';
    case 'Cancel':
      return '取消';
    case 'Allocate':
      return '指派';
    default:
      return type;
  }
}

/** 构造用于 RejectedDispatchOrder.order 的兼容视图 */
export function buildCompatibleDispatchOrder(command: UnifiedCommand, task?: UnifiedTask): DispatchOrder {
  const traced = LEGACY_ORDER_TRACE.get(command);
  if (traced) {
    return {
      item: traced.item,
      ...(traced.base !== undefined ? { base: traced.base } : {}),
      ...(traced.type !== undefined ? { type: traced.type } : {}),
      verb: traced.verb,
    };
  }
  return {
    item: task?.name ?? command.taskId,
    ...(task?.leadBaseId ? { base: task.leadBaseId } : {}),
    ...(task ? { type: resolveRawTypeForTask(task) } : {}),
    verb: toDisplayVerb(command.type),
  };
}

/** 构造一条结构化降格记录 */
export function buildDemotion(task: UnifiedTask, cause: DispatchDemotionCause): DispatchDemotion {
  return {
    taskId: task.id,
    item: task.name,
    base: task.leadBaseId ?? '',
    type: resolveRawTypeForTask(task),
    laneKey: task.laneKey,
    cause,
  };
}

/** 为新升格 active 任务补记开工时刻（仅当 opts.now 非空且 startedAt 为空时写入） */
export function backfillStartedAtIfNeeded(task: UnifiedTask, now: string | undefined): void {
  if (typeof now !== 'string' || now.length === 0) return;
  if (task.metadata === undefined) {
    task.metadata = { startedAt: now };
  } else if (task.metadata.startedAt === undefined || task.metadata.startedAt === '') {
    task.metadata.startedAt = now;
  }
}

/** 同步维护 metadata.hold 标记（仅当 metadata 已携带 hold 字段时同步更新，避免污染无 hold 的任务结构） */
export function syncMetadataHoldIfPresent(task: UnifiedTask, hold: boolean): void {
  if (task.metadata !== undefined && 'hold' in task.metadata) {
    task.metadata = { ...task.metadata, hold };
  }
}

/** 将 index 处任务移动到所在 laneKey 的首位（保持与其他流水线任务的相对边界，对齐 transactionEngine.moveToLaneFront） */
export function moveTaskToLaneFront(tasks: UnifiedTask[], index: number): UnifiedTask[] {
  const target = tasks[index];
  const key = target.laneKey;
  const rest = tasks.filter((_, i) => i !== index);
  const firstLaneIdx = rest.findIndex(t => !isContainerTask(t) && t.laneKey === key);
  const insertAt = firstLaneIdx === -1 ? index : firstLaneIdx;
  return [...rest.slice(0, insertAt), target, ...rest.slice(insertAt)];
}

/**
 * 将未升格的 queued 任务移至所在 laneKey 的候列第 1 位（若流水线内已有在编 active 任务，则排在首个 queued 任务之前；
 * 若无 queued 任务，则排在末序 active 任务之后或流水线首位）。
 */
export function moveTaskToQueuedFront(tasks: UnifiedTask[], index: number): UnifiedTask[] {
  const target = tasks[index];
  const key = target.laneKey;
  const rest = tasks.filter((_, i) => i !== index);
  const firstQueuedIdx = rest.findIndex(t => !isContainerTask(t) && t.laneKey === key && t.status === 'queued');
  if (firstQueuedIdx !== -1) {
    return [...rest.slice(0, firstQueuedIdx), target, ...rest.slice(firstQueuedIdx)];
  }
  let lastActiveIdx = -1;
  for (let i = 0; i < rest.length; i++) {
    if (!isContainerTask(rest[i]) && rest[i].laneKey === key && rest[i].status === 'active') {
      lastActiveIdx = i;
    }
  }
  if (lastActiveIdx !== -1) {
    const insertAt = lastActiveIdx + 1;
    return [...rest.slice(0, insertAt), target, ...rest.slice(insertAt)];
  }
  const firstLaneIdx = rest.findIndex(t => !isContainerTask(t) && t.laneKey === key);
  const insertAt = firstLaneIdx === -1 ? index : firstLaneIdx;
  return [...rest.slice(0, insertAt), target, ...rest.slice(insertAt)];
}

/** 将 index 处任务移动到所在 laneKey 的末位（排在该流水线所有在编/候列任务之后，对齐 transactionEngine.moveToLaneBack） */
export function moveTaskToLaneBack(tasks: UnifiedTask[], index: number): UnifiedTask[] {
  const target = tasks[index];
  const key = target.laneKey;
  const rest = tasks.filter((_, i) => i !== index);
  let lastLaneIdx = -1;
  for (let i = 0; i < rest.length; i++) {
    if (!isContainerTask(rest[i]) && rest[i].laneKey === key) {
      lastLaneIdx = i;
    }
  }
  const insertAt = lastLaneIdx === -1 ? index : lastLaneIdx + 1;
  return [...rest.slice(0, insertAt), target, ...rest.slice(insertAt)];
}

/** 找到某流水线末序在编（最后一个 status === 'active'）任务的数组下标 */
export function findLastActiveIndexInLane(tasks: readonly UnifiedTask[], laneKey: string): number {
  for (let i = tasks.length - 1; i >= 0; i--) {
    const t = tasks[i];
    if (!isContainerTask(t) && t.laneKey === laneKey && t.status === 'active') {
      return i;
    }
  }
  return -1;
}

/** 统计某流水线当前在编（active）任务数 */
export function countActiveInLane(tasks: readonly UnifiedTask[], laneKey: string): number {
  let count = 0;
  for (const t of tasks) {
    if (!isContainerTask(t) && t.laneKey === laneKey && t.status === 'active') {
      count += 1;
    }
  }
  return count;
}

/** 统计某业务领域当前在编（active）任务总数（用于科研 techTier 等全局并发门） */
export function countActiveInDomain(tasks: readonly UnifiedTask[], domain: TaskDomain): number {
  let count = 0;
  for (const t of tasks) {
    if (!isContainerTask(t) && t.domain === domain && t.status === 'active') {
      count += 1;
    }
  }
  return count;
}

/** 工位领域覆盖判定（用于 Allocate 在 lanes 中匹配属地候选工位） */
export function laneDomainCovers(laneDomain: TaskDomain, taskDomain: TaskDomain): boolean {
  if (laneDomain === taskDomain) return true;
  if (laneDomain === 'production') {
    return taskDomain === 'construction' || taskDomain === 'retrofit';
  }
  if (laneDomain === 'retrofit') {
    return taskDomain === 'megastructure';
  }
  return false;
}

/**
 * 计算 Allocate 指派新属地基地后的目标 laneKey（纯函数）
 */
export function resolveAllocatedTaskLaneKey(
  task: UnifiedTask,
  baseId: string,
  lanes: readonly LaneStationView[],
  opts?: ApplyUnifiedCommandsOptions,
): string {
  const targetBase = baseId.trim();
  if (opts?.resolveAllocatedLaneKey) {
    return opts.resolveAllocatedLaneKey(task, targetBase, lanes);
  }

  const currentKey = task.laneKey ?? '';
  const engKeyFor = makeEngLaneKeyFor();

  // 提取原 laneKey 中可能内嵌的显式槽位标识（如 eng:eng.orbital / lane.vehicle_land）
  const engMatch = /(?:^|\s|:|\0)(eng:[A-Za-z0-9_.-]+)$/.exec(currentKey);
  const bareEngSlot = ENGINEERING_SLOT_REGISTRY.find(
    s => currentKey === s.slotId || currentKey.endsWith(`:${s.slotId}`) || currentKey.endsWith(` ${s.slotId}`),
  );
  const explicitEngLane = engMatch ? engMatch[1] : bareEngSlot ? `eng:${bareEngSlot.slotId}` : undefined;

  if (opts?.laneEnv) {
    const hub: LaneRegistryHub = createLaneRegistryHub();
    const rawType = resolveRawTypeForTask(task);
    const defaultEngLane = task.domain === 'megastructure' ? V2_DEFAULT_ENG_LANE : V1_DEFAULT_ENG_LANE;
    const synthTxn = {
      type: rawType,
      item: task.name,
      base: targetBase,
      ...(explicitEngLane ? { lane: explicitEngLane } : rawType === '工程' ? { lane: defaultEngLane } : {}),
    } as unknown as TransactionItem;
    return hub.resolveLaneKeyForTxn(synthTxn, opts.laneEnv);
  }

  let candidateKey: string | undefined;

  if (explicitEngLane) {
    candidateKey = engKeyFor({
      type: '工程',
      item: task.name,
      base: targetBase,
      lane: explicitEngLane,
    });
  } else if (task.leadBaseId && currentKey.startsWith(task.leadBaseId)) {
    const rest = currentKey.slice(task.leadBaseId.length);
    if (rest.startsWith(' ') || rest.startsWith(':') || rest.startsWith('\0') || rest.startsWith('/')) {
      candidateKey = `${targetBase}${rest}`;
    }
  }

  if (!candidateKey) {
    const prodMatch = /(?:^|\s|:|\0)(lane\.[A-Za-z0-9_.-]+)$/.exec(currentKey);
    if (prodMatch) {
      const sep = currentKey.includes('\0') ? '\0' : currentKey.includes(':') && !currentKey.includes(' ') ? ':' : ' ';
      candidateKey = `${targetBase}${sep}${prodMatch[1]}`;
    }
  }

  // 若 lanes 快照中已存在候选键，直接采用；否则尝试在 lanes 中按新属地与槽位/领域匹配
  if (candidateKey && lanes.some(l => l.laneKey === candidateKey)) {
    return candidateKey;
  }

  const baseLanes = lanes.filter(l => l.baseId === targetBase && laneDomainCovers(l.domain, task.domain));
  if (baseLanes.length > 0) {
    const oldLane = lanes.find(l => l.laneKey === currentKey);
    if (oldLane) {
      const sameDisplay = baseLanes.find(l => l.displayName === oldLane.displayName);
      if (sameDisplay) return sameDisplay.laneKey;
    }
    if (bareEngSlot) {
      const matchingSlot = baseLanes.find(l => l.laneKey.includes(bareEngSlot.slotId));
      if (matchingSlot) return matchingSlot.laneKey;
    }
    if (!candidateKey) {
      return baseLanes[0].laneKey;
    }
  }

  if (candidateKey) {
    return candidateKey;
  }

  if (task.domain === 'megastructure' || task.domain === 'retrofit') {
    const fallbackLane = task.domain === 'megastructure' ? V2_DEFAULT_ENG_LANE : V1_DEFAULT_ENG_LANE;
    return engKeyFor({
      type: '工程',
      item: task.name,
      base: targetBase,
      lane: fallbackLane,
    });
  }

  return currentKey ? `${targetBase} ${currentKey.trim()}` : targetBase;
}

/* ═══════════════ 3. 动词映射与 <工程> 指令双向无损转译辅助 ═══════════════ */

/** 旧版 <队列> 四动词 → UnifiedCommand 动词类型 */
export function legacyVerbToCommandType(
  verb: DispatchVerb | string,
): Extract<UnifiedCommandType, 'Promote' | 'Demote' | 'Hold' | 'Resume'> | undefined {
  switch (verb) {
    case '置顶':
      return 'Promote';
    case '置底':
      return 'Demote';
    case '暂缓':
      return 'Hold';
    case '恢复':
      return 'Resume';
    default:
      return undefined;
  }
}

/** UnifiedCommand 动词类型 → 旧版 <队列> 四动词（Cancel/Allocate 非队列四动词，返回 undefined） */
export function commandTypeToLegacyVerb(type: UnifiedCommandType): DispatchVerb | undefined {
  switch (type) {
    case 'Promote':
      return '置顶';
    case 'Demote':
      return '置底';
    case 'Hold':
      return '暂缓';
    case 'Resume':
      return '恢复';
    default:
      return undefined;
  }
}

/** 从工程任务名（如 "轨道船坞工程·核心舱段"）提取分段/模块短名称 */
export function extractSegmentShortName(task: UnifiedTask): string {
  const dotIdx = task.name.indexOf('·');
  if (dotIdx >= 0 && dotIdx + 1 < task.name.length) {
    return task.name.slice(dotIdx + 1).trim();
  }
  return task.name.trim();
}

/** 从工程任务 ID（如 "task:proj:proj_1:mod:core"）提取工程实例 ID */
export function extractProjectIdFromTask(task: UnifiedTask): string | undefined {
  if (typeof task.metadata?.projectId === 'string' && task.metadata.projectId.trim().length > 0) {
    return task.metadata.projectId.trim();
  }
  const match = /^task:proj:(.+?)(?::(?:phase|mod):[^:]+)?$/.exec(task.id);
  return match ? match[1] : undefined;
}

/** 匹配工程实例下的全部子任务 */
export function findProjectSubTasks(tasks: readonly UnifiedTask[], projectRefOrId: string): UnifiedTask[] {
  const raw = projectRefOrId.trim();
  if (!raw) return [];
  const rawCanon = canon(raw);
  const rootTask = tasks.find(
    t =>
      isContainerTask(t) &&
      (t.id === raw ||
        t.id === `task:proj:${raw}` ||
        t.metadata?.projectId === raw ||
        canon(t.metadata?.projectId) === rawCanon ||
        canon(t.name) === rawCanon),
  );
  const targetProjectId = rootTask?.metadata?.projectId ?? raw;
  const targetProjectCanon = canon(targetProjectId);
  const rootId = rootTask?.id ?? `task:proj:${targetProjectId}`;

  return tasks.filter(t => {
    if (isContainerTask(t)) return false;
    if (t.topology?.parentId === rootId) return true;
    if (t.metadata?.projectId !== undefined && canon(t.metadata.projectId) === targetProjectCanon) return true;
    return false;
  });
}

/**
 * 将 `<工程>` 指令（`暂停 / 恢复 / 取消 / 模块基地指派`）转译为 `UnifiedCommand[]`（纯函数）
 */
export function fromEngineeringOrder(
  order: EngineeringDispatchOrderInput,
  tasks: readonly UnifiedTask[],
): UnifiedCommand[] {
  const rawId = (order.id ?? order.name ?? '').trim();

  // 1. 若 order.id 直接命中某个非容器 UnifiedTask.id
  const directTask = rawId ? tasks.find(t => !isContainerTask(t) && t.id === rawId) : undefined;
  if (directTask && order.module === undefined && order.phase === undefined) {
    switch (order.verb) {
      case '暂停':
        return [{ type: 'Hold', taskId: directTask.id }];
      case '恢复':
        return [{ type: 'Resume', taskId: directTask.id }];
      case '取消':
        return [{ type: 'Cancel', taskId: directTask.id }];
      case '指派':
      case '分配':
        return [{ type: 'Allocate', taskId: directTask.id, baseId: order.base ?? '' }];
      case '注资':
        if (order.base !== undefined && directTask.scope === 'theater' && directTask.status === 'draft') {
          return [{ type: 'Allocate', taskId: directTask.id, baseId: order.base }];
        }
        return [];
      default:
        return [];
    }
  }

  const subTasks = findProjectSubTasks(tasks, rawId);

  // 2. 模块级指令（携带 module 键）
  if (order.module !== undefined) {
    const modKey = canon(order.module);
    const modTask =
      subTasks.find(t => canon(t.metadata?.moduleId) === modKey) ??
      subTasks.find(t => canon(extractSegmentShortName(t)) === modKey) ??
      subTasks.find(t => canon(t.name) === modKey) ??
      tasks.find(
        t =>
          !isContainerTask(t) &&
          (canon(t.metadata?.moduleId) === modKey || canon(extractSegmentShortName(t)) === modKey),
      );
    const targetId = modTask?.id ?? `unmatched:eng:${rawId}:mod:${order.module}`;
    switch (order.verb) {
      case '暂停':
        return [{ type: 'Hold', taskId: targetId }];
      case '恢复':
        return [{ type: 'Resume', taskId: targetId }];
      case '指派':
      case '分配':
        return [{ type: 'Allocate', taskId: targetId, baseId: order.base ?? '' }];
      case '注资':
        if (order.base !== undefined) {
          return [{ type: 'Allocate', taskId: targetId, baseId: order.base }];
        }
        return [];
      default:
        return [];
    }
  }

  // 3. 阶段级指令（携带 phase 键）
  if (order.phase !== undefined) {
    const phaseTask = subTasks.find(t => t.metadata?.phaseIdx === order.phase);
    const targetId = phaseTask?.id ?? `unmatched:eng:${rawId}:phase:${order.phase}`;
    switch (order.verb) {
      case '暂停':
        return [{ type: 'Hold', taskId: targetId }];
      case '恢复':
        return [{ type: 'Resume', taskId: targetId }];
      case '指派':
      case '分配':
        return [{ type: 'Allocate', taskId: targetId, baseId: order.base ?? '' }];
      case '注资':
        if (order.base !== undefined) {
          return [{ type: 'Allocate', taskId: targetId, baseId: order.base }];
        }
        return [];
      default:
        return [];
    }
  }

  // 4. 工程级指令（暂停 / 恢复 / 取消）
  if (subTasks.length === 0) {
    const fallbackId = `unmatched:eng:${rawId}`;
    switch (order.verb) {
      case '暂停':
        return [{ type: 'Hold', taskId: fallbackId }];
      case '恢复':
        return [{ type: 'Resume', taskId: fallbackId }];
      case '取消':
        return [{ type: 'Cancel', taskId: fallbackId }];
      default:
        return [];
    }
  }

  switch (order.verb) {
    case '暂停': {
      const targets = subTasks.filter(t => t.status === 'active' || t.status === 'queued');
      if (targets.length === 0) {
        return [{ type: 'Hold', taskId: subTasks[0].id }];
      }
      return targets.map(t => ({ type: 'Hold' as const, taskId: t.id }));
    }
    case '恢复': {
      const targets = subTasks.filter(t => t.status === 'held');
      if (targets.length === 0) {
        return [{ type: 'Resume', taskId: subTasks[0].id }];
      }
      return targets.map(t => ({ type: 'Resume' as const, taskId: t.id }));
    }
    case '取消': {
      const targets = subTasks.filter(t => !isDispatchImmuneTaskStatus(t.status));
      if (targets.length === 0) {
        return [{ type: 'Cancel', taskId: subTasks[0].id }];
      }
      return targets.map(t => ({ type: 'Cancel' as const, taskId: t.id }));
    }
    case '指派':
    case '分配': {
      const draftTarget = subTasks.find(t => t.status === 'draft') ?? subTasks[0];
      return [{ type: 'Allocate', taskId: draftTarget.id, baseId: order.base ?? '' }];
    }
    default:
      return [];
  }
}

/** 批量转译 `<工程>` 指令数组为 `UnifiedCommand[]` */
export function fromEngineeringOrders(
  orders: readonly EngineeringDispatchOrderInput[],
  tasks: readonly UnifiedTask[],
): UnifiedCommand[] {
  return orders.flatMap(order => fromEngineeringOrder(order, tasks));
}

/**
 * 将 `UnifiedCommand`（`Hold / Resume / Cancel / Allocate`）反向转译为结构化 `<工程>` `EngOrder`。
 * 若为 `Promote / Demote` 或目标任务不存在，则返回 `null`。
 */
export function toEngineeringOrder(command: UnifiedCommand, tasks: readonly UnifiedTask[]): EngOrder | null {
  const task = tasks.find(t => t.id === command.taskId);
  if (!task) return null;

  const projectId = extractProjectIdFromTask(task) ?? task.id;
  const moduleId = typeof task.metadata?.moduleId === 'string' ? task.metadata.moduleId : undefined;
  const phaseIdx = typeof task.metadata?.phaseIdx === 'number' ? task.metadata.phaseIdx : undefined;

  switch (command.type) {
    case 'Hold':
      return {
        verb: '暂停',
        id: projectId,
        ...(moduleId !== undefined ? { module: moduleId } : {}),
        ...(moduleId === undefined && phaseIdx !== undefined ? { phase: phaseIdx } : {}),
      };
    case 'Resume':
      return {
        verb: '恢复',
        id: projectId,
        ...(moduleId !== undefined ? { module: moduleId } : {}),
        ...(moduleId === undefined && phaseIdx !== undefined ? { phase: phaseIdx } : {}),
      };
    case 'Cancel':
      return {
        verb: '取消',
        id: projectId,
      };
    case 'Allocate':
      return {
        verb: '注资',
        id: projectId,
        base: command.baseId,
        ...(moduleId !== undefined ? { module: moduleId } : {}),
        ...(moduleId === undefined && phaseIdx !== undefined ? { phase: phaseIdx } : {}),
      };
    default:
      return null;
  }
}

/**
 * 将 `UnifiedCommand` 转译为标准 `【工程指令】` 或队列调度自然语言指令文本
 */
export function toEngineeringCommandText(
  command: UnifiedCommand,
  tasks: readonly UnifiedTask[],
  opts?: { moduleLevel?: boolean },
): string | null {
  const task = tasks.find(t => t.id === command.taskId);
  if (!task) return null;

  const projectId = extractProjectIdFromTask(task);
  const isModuleTask =
    opts?.moduleLevel ??
    (task.metadata?.sourceKind === 'project_module' || typeof task.metadata?.moduleId === 'string');
  const segName = extractSegmentShortName(task);

  if (projectId) {
    switch (command.type) {
      case 'Hold':
        return isModuleTask ? `【工程指令】暂停「${projectId}」${segName}` : `【工程指令】暂停「${projectId}」`;
      case 'Resume':
        return isModuleTask ? `【工程指令】恢复「${projectId}」${segName}` : `【工程指令】恢复「${projectId}」`;
      case 'Cancel':
        return `【工程指令】取消「${projectId}」`;
      case 'Allocate': {
        const baseId = command.baseId.trim();
        if (!baseId) return null;
        return `【工程指令】指派「${projectId}」${segName}，承建基地：${baseId}`;
      }
      default:
        break;
    }
  }

  // 若为常规队列四动词（Promote / Demote / Hold / Resume），输出与 dispatchOrderText.ts 同源文本
  const legacyVerb = commandTypeToLegacyVerb(command.type);
  if (legacyVerb && DISPATCH_VERBS.includes(legacyVerb)) {
    const type = resolveRawTypeForTask(task);
    const base = type && type !== '研究' ? (task.leadBaseId?.trim() ?? '') : '';
    const head = `（指挥指令：下达队列调度令「${legacyVerb}」——${type ? `${type}项目` : '项目'}「${task.name}」`;
    const basePart = base ? `，基地「${base}」` : '';
    return (
      `${head}${basePart}。请在 <队列> 报文中以「调度: ${legacyVerb}」声明该调度令；` +
      `调度只挪队列顺序与暂缓标记，不改写进度与工期，执行结果或被拒留痕随本楼结算呈现。）`
    );
  }

  if (command.type === 'Allocate') {
    const baseId = command.baseId.trim();
    if (!baseId) return null;
    return `【工程指令】指派「${task.id}」${segName}，承建基地：${baseId}`;
  }
  if (command.type === 'Cancel') {
    return `【工程指令】取消「${task.id}」`;
  }

  return null;
}
