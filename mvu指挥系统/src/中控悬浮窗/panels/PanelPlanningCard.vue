<template>
  <section
    v-if="receipt"
    class="pln-card rounded-[3px] border p-3"
    :class="STATUS_CARD_CLASS[receipt.status]"
    data-test="planning-receipt-card"
    :data-receipt-status="receipt.status"
    :data-request-ref="receipt.request_ref"
  >
    <!-- ── 顶栏：[参谋部排产方案] + request_ref + 状态徽章 ── -->
    <header class="pln-header flex flex-wrap items-center justify-between gap-2 border-b pb-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="pln-tag font-mono text-[11px] font-bold">[参谋部排产方案]</span>
        <span
          v-if="receipt.request_ref"
          class="pln-req-ref font-mono text-[10.5px]"
          data-test="planning-request-ref"
        >
          #{{ receipt.request_ref }}
        </span>
        <span
          v-if="receipt.snapshot_ref"
          class="pln-snap-ref font-mono text-[10px]"
        >
          快照 {{ receipt.snapshot_ref }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <span
          class="pln-status-badge rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] font-bold"
          :class="STATUS_BADGE_CLASS[receipt.status]"
          data-test="planning-status-badge"
        >
          {{ statusLabel }}
        </span>
      </div>
    </header>

    <!-- ── 预算与基地摘要 + 参谋理由 ── -->
    <div class="pln-meta mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
      <div class="flex items-center gap-1">
        <span class="pln-meta-label">目标基地:</span>
        <span class="pln-meta-val font-bold" data-test="planning-base-ref">
          {{ receipt.base_ref || '未指定基地' }}
        </span>
      </div>
      <div class="flex items-center gap-1">
        <span class="pln-meta-label">测算总耗资:</span>
        <span class="pln-meta-val font-mono font-bold" data-test="planning-total-cost">
          {{ receipt.total_cost_credits }} 资金
        </span>
        <template v-if="receipt.budget_cap_credits !== undefined">
          <span class="pln-meta-sep font-mono">/ 预算上限 {{ receipt.budget_cap_credits }}</span>
          <span
            class="pln-budget-tag rounded-[2px] px-1 py-0.2 font-mono text-[9.5px]"
            :class="isOverBudget ? 'pln-budget-tag--over' : 'pln-budget-tag--ok'"
            data-test="planning-budget-compare"
          >
            {{ isOverBudget ? '超预算上限' : '预算内' }}
          </span>
        </template>
      </div>
    </div>

    <!-- 参谋摘要与理由 -->
    <div v-if="receipt.summary || receipt.reason" class="pln-reason-box mt-2 rounded-[2px] px-2.5 py-1.5 text-[11px]">
      <div v-if="receipt.summary" class="pln-summary font-medium" data-test="planning-summary">
        {{ receipt.summary }}
      </div>
      <div v-if="receipt.reason" class="pln-reason mt-0.5 text-[10.5px]" data-test="planning-reason">
        <span class="pln-reason-prefix font-mono">[参谋理由]</span> {{ receipt.reason }}
      </div>
    </div>

    <!-- ── 差异摘要标签（diff_summary 非空项） ── -->
    <div v-if="diffEntries.length > 0" class="pln-diff-bar mt-2 flex flex-wrap items-center gap-1.5" data-test="planning-diff-summary">
      <span
        v-for="entry in diffEntries"
        :key="entry.key"
        class="pln-diff-chip rounded-[2px] px-1.5 py-0.5 font-mono text-[10px]"
        :class="entry.chipClass"
        :data-diff-kind="entry.key"
      >
        {{ entry.label }}: {{ entry.items.join('、') }}
      </span>
    </div>

    <!-- ── 动作明细列表（receipt.actions） ── -->
    <div v-if="receipt.actions && receipt.actions.length > 0" class="mt-2.5 flex flex-col gap-1.5" data-test="planning-actions-list">
      <div
        v-for="(act, idx) in receipt.actions"
        :key="`${act.op}-${act.target}-${idx}`"
        class="pln-action-row rounded-[2px] border px-2 py-1.5"
        :class="act.status === 'rejected' ? 'pln-action-row--rejected' : 'pln-action-row--normal'"
        data-test="planning-action-item"
        :data-action-op="act.op"
        :data-action-status="act.status"
      >
        <div class="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="pln-op-badge rounded-[2px] px-1.5 py-0.2 font-mono text-[10px] font-bold" :class="OP_BADGE_CLASS[act.op]">
              {{ OP_LABELS[act.op] ?? act.op }}
            </span>
            <span class="pln-target font-bold">{{ act.target }}</span>
            <span class="pln-qty font-mono text-[10.5px]">×{{ act.quantity }}</span>
            <span v-if="act.base && act.base !== receipt.base_ref" class="pln-act-base font-mono text-[10px]">
              @{{ act.base }}
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-2.5 font-mono text-[10px]">
            <span class="pln-act-cost">耗资 {{ act.cost_credits }}</span>
            <span class="pln-act-time">预计 {{ act.est_minutes }} 分钟</span>
            <span v-if="act.eta_note" class="pln-act-eta">{{ act.eta_note }}</span>
            <span
              class="pln-act-status rounded-[2px] px-1 py-0.2"
              :class="ACTION_STATUS_CLASS[act.status]"
            >
              {{ ACTION_STATUS_LABELS[act.status] ?? act.status }}
            </span>
          </div>
        </div>

        <!-- UX-04：动作被驳回时醒目展示阻塞原因与下一步建议 -->
        <div
          v-if="act.status === 'rejected' && (act.blocker_reason || act.next_step || act.blocker_code)"
          class="pln-blocker-box mt-1.5 rounded-[2px] px-2 py-1 text-[10.5px]"
          data-test="planning-action-blocker"
        >
          <div v-if="act.blocker_reason || act.blocker_code" class="pln-blocker-reason font-medium">
            <span class="font-mono font-bold">[阻塞原因{{ act.blocker_code ? ` · ${act.blocker_code}` : '' }}]</span>
            {{ act.blocker_reason || '未满足排产前置条件' }}
          </div>
          <div v-if="act.next_step" class="pln-blocker-next mt-0.5" data-test="planning-action-next-step">
            <span class="font-mono font-bold">[下一步建议]</span>
            {{ act.next_step }}
          </div>
        </div>
      </div>
    </div>

    <!-- ── 交互按钮区 ── -->
    <footer class="pln-footer mt-2.5 flex flex-wrap items-center justify-end gap-2 border-t pt-2">
      <template v-if="canApprove">
        <button
          type="button"
          class="pln-btn pln-btn--dismiss"
          data-test="planning-dismiss-btn"
          @click="onDismiss"
        >
          暂不采纳
        </button>
        <button
          type="button"
          class="pln-btn pln-btn--approve"
          data-test="planning-approve-btn"
          @click="onApprove"
        >
          批准方案（填入发送框）
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="pln-btn pln-btn--dismiss"
          data-test="planning-dismiss-btn"
          @click="onDismiss"
        >
          收起回执
        </button>
      </template>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type {
  PlanningReceipt,
  PlanningReceiptActionResult,
  PlanningReceiptStatus,
} from '../../红警指挥系统/core/schema';

const props = defineProps<{
  receipt: PlanningReceipt | null;
}>();

const emit = defineEmits<{
  (e: 'approve', receipt: PlanningReceipt): void;
  (e: 'dismiss', requestRef: string): void;
}>();

const STATUS_LABELS: Record<PlanningReceiptStatus, string> = {
  advisory_ready: '参谋建议·待裁决',
  awaiting_approval: '超限委托·待复核',
  committed: '已核准入列',
  rejected: '已驳回',
  stale_snapshot: '快照已过期',
};

const STATUS_CARD_CLASS: Record<PlanningReceiptStatus, string> = {
  advisory_ready: 'pln-card--advisory',
  awaiting_approval: 'pln-card--awaiting',
  committed: 'pln-card--committed',
  rejected: 'pln-card--rejected',
  stale_snapshot: 'pln-card--stale',
};

const STATUS_BADGE_CLASS: Record<PlanningReceiptStatus, string> = {
  advisory_ready: 'pln-badge--advisory',
  awaiting_approval: 'pln-badge--awaiting',
  committed: 'pln-badge--committed',
  rejected: 'pln-badge--rejected',
  stale_snapshot: 'pln-badge--stale',
};

const OP_LABELS: Record<PlanningReceiptActionResult['op'], string> = {
  enqueue: '入队',
  promote: '加急',
  demote: '后置',
  hold: '暂缓',
  resume: '恢复',
};

const OP_BADGE_CLASS: Record<PlanningReceiptActionResult['op'], string> = {
  enqueue: 'pln-op--enqueue',
  promote: 'pln-op--promote',
  demote: 'pln-op--demote',
  hold: 'pln-op--hold',
  resume: 'pln-op--resume',
};

const ACTION_STATUS_LABELS: Record<PlanningReceiptActionResult['status'], string> = {
  accepted: '已通过',
  preview: '待核准',
  rejected: '阻塞驳回',
};

const ACTION_STATUS_CLASS: Record<PlanningReceiptActionResult['status'], string> = {
  accepted: 'pln-act-status--accepted',
  preview: 'pln-act-status--preview',
  rejected: 'pln-act-status--rejected',
};

const statusLabel = computed(() => {
  if (!props.receipt) return '';
  return STATUS_LABELS[props.receipt.status] ?? props.receipt.status;
});

const isOverBudget = computed(() => {
  if (!props.receipt || props.receipt.budget_cap_credits === undefined) return false;
  return props.receipt.total_cost_credits > props.receipt.budget_cap_credits;
});

interface DiffEntry {
  key: 'added' | 'promoted' | 'demoted' | 'held' | 'resumed';
  label: string;
  items: string[];
  chipClass: string;
}

const diffEntries = computed<DiffEntry[]>(() => {
  const diff = props.receipt?.diff_summary;
  if (!diff) return [];
  const defs: Array<{
    key: DiffEntry['key'];
    label: string;
    chipClass: string;
  }> = [
    { key: 'added', label: '新增入列', chipClass: 'pln-diff--added' },
    { key: 'promoted', label: '加急提序', chipClass: 'pln-diff--promoted' },
    { key: 'demoted', label: '后置降序', chipClass: 'pln-diff--demoted' },
    { key: 'held', label: '暂缓冻结', chipClass: 'pln-diff--held' },
    { key: 'resumed', label: '恢复排产', chipClass: 'pln-diff--resumed' },
  ];
  return defs
    .map(d => ({ ...d, items: diff[d.key] ?? [] }))
    .filter(d => d.items.length > 0);
});

const hasExecutableActions = computed(() => {
  if (!props.receipt?.actions) return false;
  return props.receipt.actions.some(a => a.status !== 'rejected');
});

const canApprove = computed(() => {
  if (!props.receipt) return false;
  const st = props.receipt.status;
  return (st === 'advisory_ready' || st === 'awaiting_approval') && hasExecutableActions.value;
});

function onApprove() {
  if (!props.receipt) return;
  emit('approve', props.receipt);
}

function onDismiss() {
  if (!props.receipt) return;
  emit('dismiss', props.receipt.request_ref);
}
</script>

<style scoped>
.pln-card {
  background: rgba(12, 22, 36, 0.85);
  border-color: rgba(56, 189, 248, 0.35);
  box-shadow: inset 0 0 14px rgba(56, 189, 248, 0.06);
}

.pln-card--awaiting {
  border-color: rgba(250, 204, 21, 0.5);
  box-shadow: inset 0 0 14px rgba(250, 204, 21, 0.08);
}

.pln-card--committed {
  border-color: rgba(74, 222, 128, 0.4);
}

.pln-card--rejected {
  border-color: rgba(248, 113, 113, 0.5);
  box-shadow: inset 0 0 14px rgba(248, 113, 113, 0.08);
}

.pln-card--stale {
  border-style: dashed;
  border-color: var(--rac-dim);
  opacity: 0.85;
}

.pln-header {
  border-color: rgba(56, 189, 248, 0.2);
}

.pln-tag {
  color: var(--rac-line);
  letter-spacing: 0.05em;
}

.pln-req-ref {
  color: var(--rac-text);
}

.pln-snap-ref {
  color: var(--rac-muted);
}

.pln-badge--advisory {
  background: rgba(56, 189, 248, 0.16);
  border: 1px solid rgba(56, 189, 248, 0.5);
  color: var(--rac-line);
}

.pln-badge--awaiting {
  background: rgba(250, 204, 21, 0.16);
  border: 1px solid rgba(250, 204, 21, 0.55);
  color: var(--rac-warn);
}

.pln-badge--committed {
  background: rgba(74, 222, 128, 0.14);
  border: 1px solid rgba(74, 222, 128, 0.45);
  color: var(--rac-ok, #4ade80);
}

.pln-badge--rejected {
  background: rgba(248, 113, 113, 0.16);
  border: 1px solid rgba(248, 113, 113, 0.55);
  color: var(--rac-danger, #f87171);
}

.pln-badge--stale {
  background: rgba(148, 163, 184, 0.14);
  border: 1px dashed var(--rac-dim);
  color: var(--rac-muted);
}

.pln-meta-label {
  color: var(--rac-muted);
}

.pln-meta-val {
  color: var(--rac-text);
}

.pln-meta-sep {
  color: var(--rac-muted);
}

.pln-budget-tag--ok {
  background: rgba(74, 222, 128, 0.14);
  border: 1px solid rgba(74, 222, 128, 0.4);
  color: var(--rac-ok, #4ade80);
}

.pln-budget-tag--over {
  background: rgba(250, 204, 21, 0.18);
  border: 1px solid rgba(250, 204, 21, 0.55);
  color: var(--rac-warn);
}

.pln-reason-box {
  background: rgba(0, 0, 0, 0.25);
  border-left: 2px solid var(--rac-line);
  color: var(--rac-text);
}

.pln-reason {
  color: var(--rac-muted);
}

.pln-reason-prefix {
  color: var(--rac-line);
}

.pln-diff-chip {
  border: 1px solid var(--rac-dim);
  background: rgba(255, 255, 255, 0.03);
  color: var(--rac-text);
}

.pln-diff--added {
  border-color: rgba(56, 189, 248, 0.4);
  color: var(--rac-line);
}

.pln-diff--promoted {
  border-color: rgba(250, 204, 21, 0.45);
  color: var(--rac-warn);
}

.pln-diff--held {
  border-color: rgba(248, 113, 113, 0.4);
  color: var(--rac-danger, #f87171);
}

.pln-action-row--normal {
  border-color: var(--rac-dim);
  background: rgba(0, 0, 0, 0.22);
}

.pln-action-row--rejected {
  border-color: rgba(248, 113, 113, 0.5);
  background: rgba(127, 29, 29, 0.18);
}

.pln-op-badge {
  background: rgba(56, 189, 248, 0.14);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: var(--rac-line);
}

.pln-op--promote {
  background: rgba(250, 204, 21, 0.14);
  border-color: rgba(250, 204, 21, 0.4);
  color: var(--rac-warn);
}

.pln-op--hold {
  background: rgba(248, 113, 113, 0.14);
  border-color: rgba(248, 113, 113, 0.4);
  color: var(--rac-danger, #f87171);
}

.pln-target {
  color: var(--rac-text);
}

.pln-qty,
.pln-act-base,
.pln-act-cost,
.pln-act-time,
.pln-act-eta {
  color: var(--rac-muted);
}

.pln-act-status--accepted {
  color: var(--rac-ok, #4ade80);
}

.pln-act-status--preview {
  color: var(--rac-line);
}

.pln-act-status--rejected {
  color: var(--rac-danger, #f87171);
  font-weight: 700;
}

.pln-blocker-box {
  background: rgba(248, 113, 113, 0.1);
  border-left: 2px solid var(--rac-danger, #f87171);
  color: var(--rac-text);
}

.pln-blocker-reason {
  color: var(--rac-danger, #f87171);
}

.pln-blocker-next {
  color: var(--rac-warn);
}

.pln-footer {
  border-color: rgba(56, 189, 248, 0.18);
}

.pln-btn {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.pln-btn--dismiss {
  border: 1px solid var(--rac-dim);
  background: transparent;
  color: var(--rac-muted);
}

.pln-btn--dismiss:hover {
  border-color: var(--rac-line);
  color: var(--rac-text);
}

.pln-btn--approve {
  border: 1px solid rgba(56, 189, 248, 0.65);
  background: rgba(56, 189, 248, 0.18);
  color: var(--rac-line);
  font-weight: 700;
}

.pln-btn--approve:hover {
  background: rgba(56, 189, 248, 0.28);
  color: var(--rac-hi);
}
</style>
