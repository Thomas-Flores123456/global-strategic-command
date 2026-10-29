/**
 * planningReceipt.ts —— 排产回执与零时间边界提交（PLAN-COMMIT-01）
 *
 * 设计契约与红线：
 * 1. 调用 runPlanningSandbox 执行纯函数试排；
 * 2. 仅当 canCommit === true（或显式 forceApprove === true 且存在可接受动作）时，
 *    将沙盒状态（真实扣款、status='queued' & spent_minutes=0 入队、队列调序）落入 next，
 *    并记录幂等指纹（上限 50 条）与 latest_receipt；
 * 3. advisory_ready / awaiting_approval / rejected / stale_snapshot 绝不修改 queues 与 credits，
 *    仅写入 planning.latest_receipt 与（待批/预案态下）planning.pending_plan；
 * 4. 零时间边界：在 settleFloor 之后调用时，新入队项恒保持 status='queued', spent_minutes=0，
 *    绝不吃本楼 Δt 推进。
 */

import { klona } from 'klona';
import type { EffectiveCatalog } from '../core/catalogEffective';
import type { ParsedPlanningIntent, PlanningActionItem } from './planningParser';
import { runPlanningSandbox } from './planningSandbox';
import type { PlanningReceipt, PlanningReceiptActionResult, PlanningState, StatData } from '../core/schema';
import { appendFloorProcessOp } from '../core/timelineLedger';

export interface CommitPlanningOptions {
  currentSnapshotRef?: string;
  floor?: number;
  forceApprove?: boolean;
}

export interface PlanningCommitEvent {
  type: string;
  level: 'info' | 'warning' | 'error';
  item: string;
  message: string;
  /** 兼容 useParse ParseEvent 结构，方便直接推入 result.events */
  light: '🟢' | '🟡';
  layer: 'instruction';
}

export interface CommitPlanningResult {
  next: StatData;
  receipt: PlanningReceipt;
  committed: boolean;
  events: PlanningCommitEvent[];
}

function cleanText(val: unknown): string {
  return typeof val === 'string' ? val.trim() : '';
}

function ensurePlanningState(state: StatData): PlanningState {
  if (!state.planning || typeof state.planning !== 'object') {
    state.planning = {
      latest_receipt: null,
      pending_plan: null,
      committed_fingerprints: [],
      protected_task_refs: [],
    };
  } else {
    if (!Array.isArray(state.planning.committed_fingerprints)) {
      state.planning.committed_fingerprints = [];
    }
    if (!Array.isArray(state.planning.protected_task_refs)) {
      state.planning.protected_task_refs = [];
    }
    if (state.planning.latest_receipt === undefined) {
      state.planning.latest_receipt = null;
    }
    if (state.planning.pending_plan === undefined) {
      state.planning.pending_plan = null;
    }
  }
  return state.planning;
}

/**
 * 排产意图提交与回执落账纯函数（PLAN-COMMIT-01）
 */
export function commitPlanningIntent(
  state: StatData,
  intent: ParsedPlanningIntent,
  catalog: EffectiveCatalog | null,
  options?: CommitPlanningOptions,
): CommitPlanningResult {
  const sandboxResult = runPlanningSandbox(state, intent, catalog, {
    currentSnapshotRef: options?.currentSnapshotRef,
  });

  const itemRef = cleanText(intent.request_ref) || cleanText(intent.fingerprint) || '排产计划';

  // 1. 幂等已提交跳过：完全不改入参状态（连 latest_receipt / queues / credits 均保持原样）
  if (sandboxResult.alreadyCommitted) {
    const next = klona(state);
    const receipt: PlanningReceipt = {
      ...sandboxResult.receipt,
      ...(options?.floor !== undefined ? { created_at_floor: options.floor } : {}),
    };
    return {
      next,
      receipt,
      committed: false,
      events: [
        {
          type: 'planning_idempotent_skip',
          level: 'info',
          item: itemRef,
          message: receipt.summary,
          light: '🟢',
          layer: 'instruction',
        },
      ],
    };
  }

  const hasAcceptableActions = sandboxResult.receipt.actions.some(a => a.status !== 'rejected');
  const canForceCommit =
    options?.forceApprove === true &&
    hasAcceptableActions &&
    sandboxResult.receipt.status !== 'rejected' &&
    sandboxResult.receipt.status !== 'stale_snapshot';

  // 2. 允许正式入列（delegate_once 全通过且未超预算，或指挥官显式 forceApprove）
  if (sandboxResult.canCommit || canForceCommit) {
    const next = sandboxResult.sandboxState;
    const planning = ensurePlanningState(next);

    const committedActions: PlanningReceiptActionResult[] = sandboxResult.receipt.actions.map(act =>
      act.status === 'preview' ? { ...act, status: 'accepted' } : { ...act },
    );

    const acceptedCount = committedActions.filter(a => a.status === 'accepted').length;
    const committedReceipt: PlanningReceipt = {
      ...sandboxResult.receipt,
      status: 'committed',
      actions: committedActions,
      summary: canForceCommit && !sandboxResult.canCommit
        ? `指挥官人工核准排产方案入列（生效 ${acceptedCount} 项，耗资 ${sandboxResult.receipt.total_cost_credits}）`
        : sandboxResult.receipt.summary,
      ...(options?.floor !== undefined ? { created_at_floor: options.floor } : {}),
    };

    const fp = cleanText(intent.fingerprint);
    if (fp) {
      const filtered = planning.committed_fingerprints.filter(existing => existing !== fp);
      filtered.push(fp);
      planning.committed_fingerprints = filtered.slice(-50);
    }

    planning.latest_receipt = committedReceipt;
    planning.pending_plan = null;

    if (options?.floor !== undefined) {
      appendFloorProcessOp(options.floor, 0, {
        kind: 'COMMIT_PLANNING',
        ts: Date.now(),
        planId: itemRef,
        intentSnapshot: intent,
        queuesSnapshot: next.queues,
        creditsAfter: next.economy?.credits,
        planningSnapshot: next.planning as unknown as Record<string, unknown>,
      });
    }

    return {
      next,
      receipt: committedReceipt,
      committed: true,
      events: [
        {
          type: 'planning_committed',
          level: 'info',
          item: itemRef,
          message: committedReceipt.summary,
          light: '🟢',
          layer: 'instruction',
        },
      ],
    };
  }

  // 3. 非提交态（advisory_ready / awaiting_approval / rejected / stale_snapshot）
  //    严禁修改 state.queues 与 state.economy.credits / state.resources.credits；
  //    若同楼 parsePipeline 预入队了未通过校验的 direct_enqueued_in_parse 队列项，则在 rejected 态下回滚清理，消除双轨分裂
  const next = klona(state);
  if (sandboxResult.receipt.status === 'rejected' && Array.isArray(next.queues)) {
    const rejectedTargets = new Set(
      sandboxResult.receipt.actions
        .filter(a => a.status === 'rejected' && a.op === 'enqueue')
        .map(a => cleanText(a.target)),
    );
    if (rejectedTargets.size > 0) {
      next.queues = next.queues.filter(q => {
        const isDirectFromParse = Boolean((q as { direct_enqueued_in_parse?: boolean }).direct_enqueued_in_parse);
        if (!isDirectFromParse) return true;
        return !rejectedTargets.has(cleanText(q.item));
      });
    }
  }
  const planning = ensurePlanningState(next);

  const receipt: PlanningReceipt = {
    ...sandboxResult.receipt,
    ...(options?.floor !== undefined ? { created_at_floor: options.floor } : {}),
  };

  planning.latest_receipt = receipt;
  if (receipt.status === 'awaiting_approval' || receipt.status === 'advisory_ready') {
    planning.pending_plan = klona(intent);
  }

  const isInfo = receipt.status === 'advisory_ready';
  const eventType =
    receipt.status === 'advisory_ready'
      ? 'planning_advisory_ready'
      : receipt.status === 'awaiting_approval'
        ? 'planning_awaiting_approval'
        : receipt.status === 'stale_snapshot'
          ? 'planning_stale_snapshot'
          : 'planning_rejected';

  return {
    next,
    receipt,
    committed: false,
    events: [
      {
        type: eventType,
        level: isInfo ? 'info' : 'warning',
        item: itemRef,
        message: receipt.summary,
        light: isInfo ? '🟢' : '🟡',
        layer: 'instruction',
      },
    ],
  };
}

export const commitPlanningOption = commitPlanningIntent;

/**
 * 生成指挥官一键批准排产方案的条令文本（供 UI 或快捷指令消费）
 */
export function buildApprovalCommandText(
  receiptOrIntent: {
    request_ref?: string;
    base_ref?: string;
    actions?: ReadonlyArray<
      | Partial<PlanningReceiptActionResult>
      | (Partial<PlanningActionItem> & { target?: string; status?: string })
    >;
  },
): string {
  const reqRef = cleanText(receiptOrIntent.request_ref) || '未命名方案';
  const baseRef = cleanText(receiptOrIntent.base_ref);
  const rawActions = receiptOrIntent.actions ?? [];

  const actionSummaries: string[] = [];
  for (const act of rawActions) {
    const rec = act as Record<string, unknown>;
    if (rec.status === 'rejected') continue;
    const op = cleanText(rec.op) || 'enqueue';
    const target =
      cleanText(rec.target) || cleanText(rec.catalog_ref) || cleanText(rec.task_ref) || '未知目标';
    const qty = typeof rec.quantity === 'number' && rec.quantity > 0 ? Math.floor(rec.quantity) : 1;
    if (op === 'enqueue') {
      actionSummaries.push(`排产 ${target}×${qty}`);
    } else if (op === 'promote') {
      actionSummaries.push(`加急 ${target}`);
    } else if (op === 'demote') {
      actionSummaries.push(`后置 ${target}`);
    } else if (op === 'hold') {
      actionSummaries.push(`暂缓 ${target}`);
    } else if (op === 'resume') {
      actionSummaries.push(`恢复 ${target}`);
    }
  }

  const baseClause = baseRef ? `（目标基地：${baseRef}）` : '';
  const detailClause = actionSummaries.length > 0 ? `：${actionSummaries.join('、')}` : '';
  return `【批准排产方案 ${reqRef}】${baseClause}${detailClause}`;
}

/**
 * 自愈修复因历史双轨入队或图鉴加载时序导致「队列已实际入列/完工，但 latest_receipt 却残留 rejected」的矛盾回执。
 */
export function reconcileStaleRejectedPlanningReceipt(state: StatData): boolean {
  const receipt = state.planning?.latest_receipt;
  if (!receipt || receipt.status !== 'rejected' || !Array.isArray(receipt.actions) || receipt.actions.length === 0) {
    return false;
  }

  const queues = state.queues ?? [];
  const bases = state.bases ?? [];
  const techDone = new Set((state.tech?.done ?? []).map(t => cleanText(t)).filter(Boolean));

  let allReconciled = true;
  let totalCost = 0;
  const addedSummary: string[] = [];

  const updatedActions: PlanningReceiptActionResult[] = receipt.actions.map(act => {
    if (act.status !== 'rejected' || act.op !== 'enqueue') {
      if (act.status === 'rejected') allReconciled = false;
      return act;
    }
    const target = cleanText(act.target);
    const qty = typeof act.quantity === 'number' && act.quantity > 0 ? act.quantity : 1;
    if (!target) {
      allReconciled = false;
      return act;
    }

    const matchedQueue = queues.find(
      q =>
        cleanText(q.item) === target &&
        q.status !== 'cancelled' &&
        ((q.total_minutes ?? 0) > 0 || q.status === 'done' || q.status === 'settling' || q.status === 'active'),
    );
    const matchedBuilding = bases.some(b =>
      (b.buildings ?? []).some(
        bld => cleanText(bld.name) === target && (cleanText(bld.state) === '运转' || cleanText(bld.state) === '建造中'),
      ),
    );
    const matchedTech = techDone.has(target);

    if (!matchedQueue && !matchedBuilding && !matchedTech) {
      allReconciled = false;
      return act;
    }

    const estMinutes =
      (act.est_minutes && act.est_minutes > 0 ? act.est_minutes : matchedQueue?.total_minutes) ?? 0;
    const inferredCost =
      act.cost_credits && act.cost_credits > 0
        ? act.cost_credits
        : target.includes('矿石精炼厂') || target.includes('精炼厂')
          ? 2000 * qty
          : 0;
    totalCost += inferredCost;
    addedSummary.push(`${target}×${qty}`);

    const reconciled: PlanningReceiptActionResult = {
      op: act.op,
      target: act.target,
      base: act.base,
      quantity: qty,
      cost_credits: inferredCost,
      est_minutes: estMinutes,
      status: 'accepted',
    };
    return reconciled;
  });

  if (!allReconciled) {
    return false;
  }

  receipt.status = 'committed';
  receipt.actions = updatedActions;
  receipt.total_cost_credits = totalCost;
  receipt.summary = `委托排产方案已核准入列（新增 ${addedSummary.length} 项，总耗资 ${totalCost}）`;
  receipt.diff_summary = {
    added: addedSummary,
    promoted: receipt.diff_summary?.promoted ?? [],
    demoted: receipt.diff_summary?.demoted ?? [],
    held: receipt.diff_summary?.held ?? [],
    resumed: receipt.diff_summary?.resumed ?? [],
  };
  if (receipt.fingerprint && Array.isArray(state.planning?.committed_fingerprints)) {
    if (!state.planning.committed_fingerprints.includes(receipt.fingerprint)) {
      state.planning.committed_fingerprints.push(receipt.fingerprint);
    }
  }
  return true;
}

