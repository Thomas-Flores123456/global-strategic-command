<template>
  <!-- 形态 A：完整弹窗态 (open && !debugState.miniHudOpen) -->
  <Transition name="ra-modal">
    <div
      v-if="open && !debugState.miniHudOpen"
      class="ra-modal-mask fixed inset-0 z-10010 flex items-center justify-center p-3"
      data-test="modal-dataflow-full"
      @click.self="$emit('close')"
    >
      <section
        class="ra-modal-card flex max-h-[88vh] w-full max-w-[960px] flex-col overflow-hidden rounded-[4px] select-none"
        role="dialog"
        aria-modal="true"
        aria-label="全链路数据流转监控台"
      >
        <header
          class="ra-modal-header flex flex-none items-center justify-between border-b px-3.5 py-2.5"
        >
          <div class="flex items-center gap-2">
            <span class="text-[13px] font-bold tracking-wide text-sky-300">
              📡 全链路数据流转监控台 · DATAFLOW INSPECTOR
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              data-test="dataflow-collapse-hud-btn"
              class="rounded border border-amber-500/50 bg-amber-950/40 px-2.5 py-1 font-mono text-[11px] font-semibold text-amber-200 transition-colors hover:bg-amber-900/50"
              @click="debugState.miniHudOpen = true"
            >
              🗕 折叠为实时监视条 (Mini HUD)
            </button>
            <button
              type="button"
              data-test="dataflow-close-modal-btn"
              class="ra-modal-close rounded-[2px] px-2 py-1 text-[11px] transition-colors"
              aria-label="关闭弹窗"
              @click="$emit('close')"
            >
              ✕
            </button>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-3">
          <PanelDataFlowInspector />
        </div>
      </section>
    </div>
  </Transition>

  <!-- 形态 B：角落 Mini HUD 实时监视胶囊（无全屏遮罩，不阻挡底层交互） -->
  <div
    v-if="debugState.enabled && debugState.miniHudOpen"
    class="pointer-events-auto fixed right-3 bottom-3 z-10005 flex flex-wrap items-center gap-2 rounded border border-sky-500/60 bg-zinc-950/95 px-3 py-1.5 font-mono text-[11px] text-zinc-100 shadow-lg select-none"
    data-test="modal-dataflow-minihud"
  >
    <span class="font-semibold text-sky-300" data-test="minihud-trace-summary">
      📡 #{{ latestTrace?.meta.floorId ?? '-' }} ·
      {{
        latestTrace
          ? `${latestTrace.totalDurationMs.toFixed(1)}ms · Δ${latestTrace.totalDiffs.length}`
          : '待捕获'
      }}
    </span>

    <span
      class="rounded border px-1.5 py-0.5 text-[10px]"
      :class="
        alertFlightLog
          ? alertFlightLog.status === 'error'
            ? 'border-rose-500/80 bg-rose-950/60 text-rose-200 font-bold'
            : 'border-amber-500/80 bg-amber-950/60 text-amber-200 font-bold'
          : 'border-zinc-700 bg-zinc-900 text-zinc-300'
      "
      data-test="minihud-flight-summary"
    >
      ✈️ {{ dataFlowDebugState.flightLogs.length }}
      <template v-if="alertFlightLog"> · {{ alertFlightLog.status.toUpperCase() }}</template>
    </span>

    <button
      type="button"
      data-test="dataflow-expand-full-btn"
      class="rounded border border-sky-500/50 bg-sky-950/50 px-2 py-0.5 text-[10.5px] font-semibold text-sky-200 hover:bg-sky-900/60"
      @click="onExpandFull"
    >
      🗖 展开监控台
    </button>

    <button
      type="button"
      data-test="dataflow-close-hud-btn"
      class="rounded border border-rose-500/40 bg-rose-950/40 px-1.5 py-0.5 text-[10.5px] text-rose-200 hover:bg-rose-900/50"
      @click="onCloseHud"
    >
      ✕ 关闭 HUD
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { debugState } from '../../红警指挥系统/composables/useDebugMode';
import {
  dataFlowDebugState,
  type AsyncFlightLogEntry,
  type FloorTraceRecord,
} from '../../红警指挥系统/debug/dataFlowTracer';
import PanelDataFlowInspector from '../panels/PanelDataFlowInspector.vue';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-full'): void;
}>();

const latestTrace = computed<FloorTraceRecord | null>(
  () => dataFlowDebugState.traces[0] ?? null,
);

const alertFlightLog = computed<AsyncFlightLogEntry | null>(
  () =>
    dataFlowDebugState.flightLogs.find(
      item => item.status === 'blocked' || item.status === 'error',
    ) ?? null,
);

function onExpandFull(): void {
  debugState.miniHudOpen = false;
  if (!props.open) {
    emit('open-full');
  }
}

function onCloseHud(): void {
  debugState.miniHudOpen = false;
  emit('close');
}
</script>

<style scoped>
.ra-modal-mask {
  z-index: 10010;
  background: rgba(4, 7, 12, 0.82);
}

.ra-modal-card {
  background: var(--rac-bg, #080a0b);
  border: 1px solid var(--rac-line, #5f7c84);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.85),
    0 0 0 1px rgba(95, 124, 132, 0.15);
}

.ra-modal-header {
  background: var(--rac-panel, #0c1113);
  border-color: var(--rac-dim, #2c3b40);
}

.ra-modal-close {
  color: var(--rac-muted, #8aa1a7);
}
.ra-modal-close:hover {
  color: var(--rac-hi, #d4e3e6);
  background: var(--rac-panel-2, #0f1619);
}
</style>
