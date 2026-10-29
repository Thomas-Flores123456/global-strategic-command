/**
 * dispatchBus.ts —— 统一调度指令总线与既有指令双向转译桥（UTO-BUS-01）
 *
 * 真源：
 * - docs/design/systems/通用任务编排器总设计案.md（CTRL-UTO-CORE-01 §4 轴四 UnifiedDispatchBus）
 * - docs/project/plans/通用任务编排器MVP任务包.md（§2.2 / §3.5 / §6 UTO-BUS-01）
 *
 * 辅助工具与 <工程> 指令转译已拆至 ./dispatchBusHelpers，本入口保持完整 Re-export。
 */

import { canon } from '../parse/parsePipeline';
import {
  backfillStartedAtIfNeeded,
  buildCompatibleDispatchOrder,
  buildDemotion,
  cloneCommand,
  cloneTask,
  commandTypeToLegacyVerb,
  countActiveInDomain,
  countActiveInLane,
  findLastActiveIndexInLane,
  isContainerTask,
  LEGACY_ORDER_TRACE,
  legacyVerbToCommandType,
  moveTaskToLaneBack,
  moveTaskToLaneFront,
  moveTaskToQueuedFront,
  resolveAllocatedTaskLaneKey,
  resolveRawTypeForTask,
  syncMetadataHoldIfPresent,
  UNIFIED_COMMAND_TYPES,
  type ApplyUnifiedCommandsOptions,
  type DispatchBusResult,
  type DispatchDemotion,
  type DispatchRejectReason,
  type FromLegacyDispatchOrdersOptions,
  type LegacyDispatchTranslationResult,
  type RejectedDispatchOrder,
  type UnifiedCommand,
} from './dispatchBusHelpers';
import {
  canTransitionTaskStatus,
  isDispatchImmuneTaskStatus,
  type LaneStationView,
  type TaskDomain,
  type UnifiedTask,
} from './taskOrchestrator';
import type { DispatchOrder } from './transactionEngine';

export * from './dispatchBusHelpers';

/* ═══════════════ 六动词统一调度指令总线执行器（§3.5 核心函数） ═══════════════ */

/**
 * 执行一批统一调度指令（Promote / Demote / Hold / Resume / Cancel / Allocate）。
 */
export function applyUnifiedCommands(
  tasks: readonly UnifiedTask[],
  lanes: readonly LaneStationView[],
  commands: readonly UnifiedCommand[],
  opts: ApplyUnifiedCommandsOptions = {},
): DispatchBusResult {
  let nextTasks: UnifiedTask[] = tasks.map(cloneTask);
  const promotedTaskIds: string[] = [];
  const preemptedTaskIds: string[] = [];
  const demotions: DispatchDemotion[] = [];
  const rejected: RejectedDispatchOrder[] = [];

  // 建立流水线工位快照索引与领域全局上限索引（未知 laneKey 安全兜底：capacity=1, locked=false, globalLimit=Infinity）
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

  const getEffectiveGlobalLimit = (task: UnifiedTask): number => {
    const lane = laneMap.get(task.laneKey);
    const laneLimit =
      lane?.globalLimit !== undefined
        ? Number.isFinite(lane.globalLimit)
          ? Math.max(0, lane.globalLimit)
          : Infinity
        : (domainGlobalLimitMap.get(task.domain) ?? Infinity);
    const customLimit = opts.globalLimitFor ? opts.globalLimitFor(task) : Infinity;
    const safeCustom =
      typeof customLimit === 'number' && Number.isFinite(customLimit) ? Math.max(0, customLimit) : Infinity;
    return Math.min(laneLimit, safeCustom);
  };

  const recordPromotion = (task: UnifiedTask): void => {
    task.status = 'active';
    syncMetadataHoldIfPresent(task, false);
    backfillStartedAtIfNeeded(task, opts.now);
    if (!promotedTaskIds.includes(task.id)) {
      promotedTaskIds.push(task.id);
    }
  };

  const recordPreemption = (victim: UnifiedTask): void => {
    victim.status = 'queued';
    syncMetadataHoldIfPresent(victim, false);
    if (!preemptedTaskIds.includes(victim.id)) {
      preemptedTaskIds.push(victim.id);
    }
    demotions.push(buildDemotion(victim, 'preempt'));
  };

  /**
   * 当某流水线因 Demote / Hold / Cancel 空出在编工位时，
   * 自动由该流水线当前首序合规 'queued' 候列项递补升格为 'active'。
   */
  const tryPromoteFirstQueuedInLane = (laneKey: string, excludeTaskId?: string): void => {
    for (const candidate of nextTasks) {
      if (isContainerTask(candidate) || candidate.laneKey !== laneKey) continue;
      if (excludeTaskId !== undefined && candidate.id === excludeTaskId) continue;
      if (candidate.status !== 'queued' || candidate.metadata?.hold === true) continue;
      if (isLaneLocked(candidate) || !canTransitionTaskStatus('queued', 'active')) break;

      const laneCap = getEffectiveCapacity(candidate);
      const globalLimit = getEffectiveGlobalLimit(candidate);
      const laneUsed = countActiveInLane(nextTasks, laneKey);
      const domainUsed = countActiveInDomain(nextTasks, candidate.domain);
      if (laneUsed < laneCap && domainUsed < globalLimit) {
        recordPromotion(candidate);
      }
      break;
    }
  };

  const pushRejection = (
    command: UnifiedCommand,
    reason: DispatchRejectReason,
    detail: string,
    task?: UnifiedTask,
  ): void => {
    rejected.push({
      taskId: task?.id ?? command.taskId,
      command: cloneCommand(command),
      order: buildCompatibleDispatchOrder(command, task),
      reason,
      detail,
    });
  };

  for (const command of commands) {
    // 1. 动词合法性守卫（防御运行时非受控输入）
    if (!UNIFIED_COMMAND_TYPES.includes(command.type)) {
      pushRejection(
        command,
        'invalid_verb',
        `非法调度指令动词「${String((command as { type?: unknown }).type)}」，仅支持 ${UNIFIED_COMMAND_TYPES.join('/')}`,
      );
      continue;
    }

    // 2. 目标存在性守卫
    const idx = nextTasks.findIndex(t => t.id === command.taskId);
    if (idx === -1) {
      const tracedOrder = LEGACY_ORDER_TRACE.get(command);
      const targetLabel = tracedOrder ? tracedOrder.item : command.taskId;
      pushRejection(command, 'task_not_found', `调度目标「${targetLabel}」不存在于任务列表`);
      continue;
    }

    const target = nextTasks[idx];

    // 3. 免疫态守卫（settling / completed / cancelled 一律拒收）
    if (isDispatchImmuneTaskStatus(target.status)) {
      pushRejection(
        command,
        'immune_status',
        `调度指令「${command.type}」不能作用于 ${target.status} 免疫态任务「${target.name}」（settling/completed/cancelled 免疫）`,
        target,
      );
      continue;
    }

    // 4. 纯容器父节点守卫（project_root 不直接参与工位重排）
    if (isContainerTask(target)) {
      pushRejection(
        command,
        'invalid_status',
        `调度指令「${command.type}」不能直接作用于工程总成容器节点「${target.name}」（${target.id}）`,
        target,
      );
      continue;
    }

    // 5. 六动词分派与前置状态约束校验
    switch (command.type) {
      case 'Promote': {
        if (target.status !== 'queued') {
          pushRejection(
            command,
            'invalid_status',
            `Promote 仅允许作用于 queued 态任务，目标「${target.name}」当前为 ${target.status} 态`,
            target,
          );
          break;
        }

        const laneKey = target.laneKey;
        const locked = isLaneLocked(target);
        const laneCap = getEffectiveCapacity(target);
        const globalLimit = getEffectiveGlobalLimit(target);

        if (locked || laneCap <= 0 || globalLimit <= 0) {
          nextTasks = moveTaskToQueuedFront(nextTasks, idx);
          break;
        }

        const laneUsed = countActiveInLane(nextTasks, laneKey);
        const domainUsed = countActiveInDomain(nextTasks, target.domain);

        if (laneUsed < laneCap && domainUsed < globalLimit) {
          recordPromotion(target);
          nextTasks = moveTaskToLaneFront(nextTasks, idx);
          break;
        }

        const lastActiveIdx = findLastActiveIndexInLane(nextTasks, laneKey);
        if (lastActiveIdx !== -1) {
          const victim = nextTasks[lastActiveIdx];
          recordPreemption(victim);
          const laneUsedAfter = countActiveInLane(nextTasks, laneKey);
          const domainUsedAfter = countActiveInDomain(nextTasks, target.domain);
          if (laneUsedAfter < laneCap && domainUsedAfter < globalLimit) {
            recordPromotion(target);
          }
          nextTasks = moveTaskToLaneFront(nextTasks, idx);
        } else {
          nextTasks = moveTaskToQueuedFront(nextTasks, idx);
        }
        break;
      }

      case 'Demote': {
        if (target.status !== 'active' && target.status !== 'queued') {
          pushRejection(
            command,
            'invalid_status',
            `Demote 仅允许作用于 active 或 queued 态任务，目标「${target.name}」当前为 ${target.status} 态`,
            target,
          );
          break;
        }

        const laneKey = target.laneKey;
        const wasActive = target.status === 'active';
        if (wasActive) {
          target.status = 'queued';
          syncMetadataHoldIfPresent(target, false);
          demotions.push(buildDemotion(target, 'demote'));
        }

        nextTasks = moveTaskToLaneBack(nextTasks, idx);

        if (wasActive) {
          tryPromoteFirstQueuedInLane(laneKey, target.id);
        }
        break;
      }

      case 'Hold': {
        if (target.status !== 'active' && target.status !== 'queued') {
          pushRejection(
            command,
            'invalid_status',
            `Hold 仅允许作用于 active 或 queued 态任务，目标「${target.name}」当前为 ${target.status} 态`,
            target,
          );
          break;
        }

        const laneKey = target.laneKey;
        const wasActive = target.status === 'active';
        if (wasActive) {
          demotions.push(buildDemotion(target, 'hold'));
        }

        target.status = 'held';
        syncMetadataHoldIfPresent(target, true);

        if (wasActive) {
          tryPromoteFirstQueuedInLane(laneKey, target.id);
        }
        break;
      }

      case 'Resume': {
        if (target.status !== 'held') {
          pushRejection(
            command,
            'invalid_status',
            `Resume 仅允许作用于 held 态任务，目标「${target.name}」当前为 ${target.status} 态`,
            target,
          );
          break;
        }

        target.status = 'queued';
        syncMetadataHoldIfPresent(target, false);

        const laneKey = target.laneKey;
        if (!isLaneLocked(target)) {
          const laneCap = getEffectiveCapacity(target);
          const globalLimit = getEffectiveGlobalLimit(target);
          const laneUsed = countActiveInLane(nextTasks, laneKey);
          const domainUsed = countActiveInDomain(nextTasks, target.domain);
          if (laneUsed < laneCap && domainUsed < globalLimit) {
            recordPromotion(target);
          }
        }
        break;
      }

      case 'Cancel': {
        if (!canTransitionTaskStatus(target.status, 'cancelled')) {
          pushRejection(
            command,
            'invalid_status',
            `Cancel 不能作用于 ${target.status} 态任务「${target.name}」`,
            target,
          );
          break;
        }

        const laneKey = target.laneKey;
        const wasActive = target.status === 'active';
        target.status = 'cancelled';
        syncMetadataHoldIfPresent(target, false);

        if (wasActive) {
          tryPromoteFirstQueuedInLane(laneKey, target.id);
        }
        break;
      }

      case 'Allocate': {
        const trimmedBaseId = typeof command.baseId === 'string' ? command.baseId.trim() : '';
        if (!trimmedBaseId) {
          pushRejection(
            command,
            'missing_base_id',
            `Allocate 承建指派必须提供非空 baseId（目标任务「${target.name}」）`,
            target,
          );
          break;
        }
        if (target.scope !== 'theater') {
          pushRejection(
            command,
            'invalid_scope',
            `Allocate 仅限 scope === 'theater' 的跨基地任务，目标「${target.name}」当前 scope 为 '${target.scope}'`,
            target,
          );
          break;
        }
        if (target.status !== 'draft') {
          pushRejection(
            command,
            'invalid_status',
            `Allocate 仅限处于 draft 规划阶段的任务，目标「${target.name}」当前为 ${target.status} 态`,
            target,
          );
          break;
        }

        const rawAllocatable =
          (target as UnifiedTask & { allocatableBases?: readonly string[] }).allocatableBases ??
          (Array.isArray(target.metadata?.allocatableBases)
            ? (target.metadata.allocatableBases as readonly string[])
            : undefined);
        let effectiveBaseId = trimmedBaseId;
        if (Array.isArray(rawAllocatable)) {
          if (rawAllocatable.length < 2) {
            pushRejection(
              command,
              'invalid_scope',
              `Allocate 仅限联建基地数 ≥2 的 theater 任务，目标「${target.name}」联建基地数为 ${rawAllocatable.length}`,
              target,
            );
            break;
          }
          const matched = rawAllocatable.find(b => b === trimmedBaseId || canon(b) === canon(trimmedBaseId));
          if (!matched) {
            pushRejection(
              command,
              'invalid_scope',
              `Allocate 目标基地「${trimmedBaseId}」不在任务「${target.name}」联建基地列表（${rawAllocatable.join('、')}）中`,
              target,
            );
            break;
          }
          effectiveBaseId = matched;
        }

        const nextLaneKey = resolveAllocatedTaskLaneKey(target, effectiveBaseId, lanes, opts);
        target.leadBaseId = effectiveBaseId;
        target.laneKey = nextLaneKey;
        if (target.participatingBases !== undefined) {
          if (!target.participatingBases.includes(effectiveBaseId)) {
            target.participatingBases = [...target.participatingBases, effectiveBaseId];
          }
        }
        if (
          target.metadata !== undefined &&
          ('base' in target.metadata || target.metadata.sourceKind === 'project_module')
        ) {
          target.metadata = { ...target.metadata, base: effectiveBaseId };
        }
        break;
      }
    }
  }

  return {
    nextTasks,
    promotedTaskIds,
    preemptedTaskIds,
    demotions,
    rejected,
  };
}

/* ═══════════════ 既有 <队列> 四动词指令双向无损转译桥 ═══════════════ */

/**
 * 在任务列表中定位旧版 <队列> 调度令目标（与 transactionEngine.findOrderTarget 100% 语义对齐，并支持 canon 宽容匹配）
 */
export function findTaskForLegacyDispatchOrder(
  tasks: readonly UnifiedTask[],
  order: DispatchOrder,
): UnifiedTask | undefined {
  // 第一遍：精确匹配（对齐 transactionEngine.findOrderTarget）
  let exactImmuneHit: UnifiedTask | undefined;
  for (const task of tasks) {
    if (isContainerTask(task)) continue;
    if (task.name !== order.item) continue;
    if (order.base !== undefined && order.base !== '' && (task.leadBaseId ?? '') !== order.base) continue;
    if (order.type !== undefined && order.type !== '' && resolveRawTypeForTask(task) !== order.type) continue;
    if (!isDispatchImmuneTaskStatus(task.status)) return task;
    if (!exactImmuneHit) exactImmuneHit = task;
  }
  if (exactImmuneHit) return exactImmuneHit;

  // 第二遍：canon 归一化匹配
  const itemCanon = canon(order.item);
  if (!itemCanon) return undefined;
  const baseCanon = order.base !== undefined && order.base.trim() !== '' ? canon(order.base) : undefined;
  const typeCanon = order.type !== undefined && order.type.trim() !== '' ? canon(order.type) : undefined;

  let canonImmuneHit: UnifiedTask | undefined;
  for (const task of tasks) {
    if (isContainerTask(task)) continue;
    if (canon(task.name) !== itemCanon) continue;
    if (baseCanon !== undefined && canon(task.leadBaseId ?? '') !== baseCanon) continue;
    if (typeCanon !== undefined && canon(resolveRawTypeForTask(task)) !== typeCanon) continue;
    if (!isDispatchImmuneTaskStatus(task.status)) return task;
    if (!canonImmuneHit) canonImmuneHit = task;
  }
  return canonImmuneHit;
}

/**
 * 将既有 `<队列>` 四动词调度令（`DispatchOrder[]`：`置顶 / 置底 / 暂缓 / 恢复`）转译为 `UnifiedCommand[]`。
 */
export function fromLegacyDispatchOrders(
  orders: readonly DispatchOrder[],
  tasks: readonly UnifiedTask[],
  opts: FromLegacyDispatchOrdersOptions = {},
): UnifiedCommand[] {
  const commands: UnifiedCommand[] = [];
  const unmatched: DispatchOrder[] = [];

  for (const order of orders) {
    const cmdType = legacyVerbToCommandType(order.verb);
    const matchedTask = findTaskForLegacyDispatchOrder(tasks, order);

    if (!cmdType) {
      unmatched.push({ ...order });
      if (opts.unmatchedOrders) {
        opts.unmatchedOrders.push({ ...order });
      }
      if (!opts.skipUnmatched) {
        const rawCmd = {
          type: String(order.verb) as UnifiedCommand['type'],
          taskId: matchedTask?.id ?? `unmatched:${order.item}`,
        } as UnifiedCommand;
        LEGACY_ORDER_TRACE.set(rawCmd, { ...order });
        commands.push(rawCmd);
      }
      continue;
    }

    if (!matchedTask) {
      unmatched.push({ ...order });
      if (opts.unmatchedOrders) {
        opts.unmatchedOrders.push({ ...order });
      }
      if (!opts.skipUnmatched) {
        const missingCmd: UnifiedCommand = {
          type: cmdType,
          taskId: `unmatched:${order.base ? `${order.base}:` : ''}${order.type ? `${order.type}:` : ''}${order.item}`,
        };
        LEGACY_ORDER_TRACE.set(missingCmd, { ...order });
        commands.push(missingCmd);
      }
      continue;
    }

    const cmd: UnifiedCommand = {
      type: cmdType,
      taskId: matchedTask.id,
    };
    LEGACY_ORDER_TRACE.set(cmd, { ...order });
    commands.push(cmd);
  }

  Object.defineProperty(commands, 'unmatchedOrders', {
    value: unmatched,
    enumerable: false,
    configurable: true,
  });

  return commands;
}

/**
 * 将既有 `<队列>` 调度令转译为统一指令并同步返回未命中与非法动词分类清单。
 */
export function translateLegacyDispatchOrders(
  orders: readonly DispatchOrder[],
  tasks: readonly UnifiedTask[],
  opts: { skipUnmatched?: boolean } = {},
): LegacyDispatchTranslationResult {
  const unmatchedOrders: DispatchOrder[] = [];
  const invalidVerbOrders: DispatchOrder[] = [];
  const commands: UnifiedCommand[] = [];

  for (const order of orders) {
    const cmdType = legacyVerbToCommandType(order.verb);
    if (!cmdType) {
      invalidVerbOrders.push({ ...order });
      if (!opts.skipUnmatched) {
        const matchedTask = findTaskForLegacyDispatchOrder(tasks, order);
        const rawCmd = {
          type: String(order.verb) as UnifiedCommand['type'],
          taskId: matchedTask?.id ?? `unmatched:${order.item}`,
        } as UnifiedCommand;
        LEGACY_ORDER_TRACE.set(rawCmd, { ...order });
        commands.push(rawCmd);
      }
      continue;
    }

    const matchedTask = findTaskForLegacyDispatchOrder(tasks, order);
    if (!matchedTask) {
      unmatchedOrders.push({ ...order });
      if (!opts.skipUnmatched) {
        const missingCmd: UnifiedCommand = {
          type: cmdType,
          taskId: `unmatched:${order.base ? `${order.base}:` : ''}${order.type ? `${order.type}:` : ''}${order.item}`,
        };
        LEGACY_ORDER_TRACE.set(missingCmd, { ...order });
        commands.push(missingCmd);
      }
      continue;
    }

    const cmd: UnifiedCommand = { type: cmdType, taskId: matchedTask.id };
    LEGACY_ORDER_TRACE.set(cmd, { ...order });
    commands.push(cmd);
  }

  return {
    commands,
    unmatchedOrders,
    invalidVerbOrders,
  };
}

/**
 * 将 `UnifiedCommand`（`Promote / Demote / Hold / Resume`）反向转译为旧版 `<队列>` `DispatchOrder`。
 * 若为 `Cancel / Allocate` 或目标任务不存在，则返回 `null`。
 */
export function toLegacyDispatchOrder(command: UnifiedCommand, tasks: readonly UnifiedTask[]): DispatchOrder | null {
  const verb = commandTypeToLegacyVerb(command.type);
  if (!verb) return null;
  const task = tasks.find(t => t.id === command.taskId);
  if (!task) return null;
  return {
    item: task.name,
    ...(task.leadBaseId ? { base: task.leadBaseId } : {}),
    type: resolveRawTypeForTask(task),
    verb,
  };
}
