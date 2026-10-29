<template>
  <!--
    PanelPerfMonitor.vue —— 中控悬浮窗运行时性能监测与遥测探针面板（CTRL-PERF-MONITOR-01）
    挂载于 ModalSettings.vue 左栏「性能监测」分组（#panel-perf）。
    只读遥测与微基准自检，零 MVU/世界书写入。
  -->
  <div class="ra-perf-monitor space-y-3.5 text-[12px] text-(--rac-text) select-none" data-test="panel-perf-monitor">
    <!-- ── 顶栏：战备健康度评级 + 操作工具栏 ── -->
    <div
      class="ob-panel flex flex-wrap items-center justify-between gap-2 rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) px-3 py-2.5"
    >
      <div class="flex items-center gap-2.5">
        <span
          class="inline-flex size-7 items-center justify-center rounded-[2px] border font-mono text-[15px] font-bold"
          :class="gradeBadgeClass(health.grade)"
          data-test="perf-health-grade"
        >
          {{ health.grade }}
        </span>
        <div>
          <div class="flex items-center gap-2">
            <span class="text-[13px] font-bold text-(--rac-hi)">终端性能与帧率监控</span>
            <span
              class="rounded-[2px] border px-1.5 py-0.2 font-mono text-[11px]"
              :class="
                state.fpsSampling
                  ? 'border-(--rac-ok)/50 bg-(--rac-panel-2) text-(--rac-ok)'
                  : 'border-(--rac-dim) text-(--rac-muted)'
              "
            >
              {{ state.fpsSampling ? '● 实时采样中' : '○ 待机采样' }}
            </span>
          </div>
          <div class="mt-0.5 text-[12px] text-(--rac-muted)">
            {{ health.label }} — {{ health.summary }}
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 font-mono text-[12px]">
        <button
          type="button"
          data-test="perf-run-benchmark-btn"
          class="cursor-pointer rounded-[2px] border border-(--rac-accent) bg-(--rac-accent)/15 px-2.5 py-1 font-bold text-(--rac-accent) transition-colors hover:bg-(--rac-accent)/25 disabled:opacity-50"
          :disabled="runningBenchmark"
          @click="onRunBenchmark"
        >
          {{ runningBenchmark ? '⋯ 压测中...' : '◆ 运行管线基准自检' }}
        </button>
        <button
          type="button"
          data-test="perf-refresh-dom-btn"
          class="cursor-pointer rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-1 text-(--rac-hi) transition-colors hover:border-(--rac-line)"
          @click="onRefreshSnapshot"
        >
          ◆ 刷新盘点
        </button>
        <button
          type="button"
          data-test="perf-copy-report-btn"
          class="cursor-pointer rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-1 text-(--rac-hi) transition-colors hover:border-(--rac-line)"
          @click="onCopyReport"
        >
          {{ copiedFeedback ? '● 已复制 JSON' : '◇ 复制诊断报告' }}
        </button>
        <button
          type="button"
          data-test="perf-reset-btn"
          class="cursor-pointer rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-1 text-(--rac-muted) transition-colors hover:border-(--rac-alert)/50 hover:text-(--rac-alert)"
          @click="onResetStats"
        >
          × 清零
        </button>
      </div>
    </div>

    <!-- ── 区块 1：核心运行态 KPI 四宫格 ── -->
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4" data-test="perf-kpi-grid">
      <!-- FPS 与帧间隔 -->
      <div class="ob-readout rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) p-2.5 font-mono">
        <div class="text-[12px] text-(--rac-muted)">实时合成帧率 (FPS)</div>
        <div class="mt-1 flex items-baseline justify-between">
          <span
            class="text-[15px] font-bold"
            :class="
              state.currentFps >= 50
                ? 'text-(--rac-ok)'
                : state.currentFps >= 30
                  ? 'text-(--rac-warn)'
                  : 'text-(--rac-alert)'
            "
            data-test="perf-kpi-fps"
          >
            {{ state.currentFps }} <small class="text-[11px] font-normal">fps</small>
          </span>
          <span class="text-[11px] text-(--rac-muted)">{{ state.avgFrameTimeMs }}ms/帧</span>
        </div>
        <div class="mt-1 text-[11px] text-(--rac-muted)">
          掉帧 (&gt;33ms): <span class="text-(--rac-hi)">{{ state.droppedFrames }}</span>
        </div>
      </div>

      <!-- 主线程长任务 LongTask (>50ms) -->
      <div class="ob-readout rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) p-2.5 font-mono">
        <div class="text-[12px] text-(--rac-muted)">长任务阻塞 (&gt;50ms)</div>
        <div class="mt-1 flex items-baseline justify-between">
          <span
            class="text-[15px] font-bold"
            :class="
              state.longTaskCount === 0
                ? 'text-(--rac-ok)'
                : state.longTaskCount <= 3
                  ? 'text-(--rac-warn)'
                  : 'text-(--rac-alert)'
            "
            data-test="perf-kpi-longtask"
          >
            {{ state.longTaskCount }} <small class="text-[11px] font-normal">次</small>
          </span>
          <span class="text-[11px] text-(--rac-muted)">峰值 {{ state.maxLongTaskMs }}ms</span>
        </div>
        <div class="mt-1 text-[11px] text-(--rac-muted)">
          预算红线: <span class="text-(--rac-hi)">INP &le; 200ms</span>
        </div>
      </div>

      <!-- 跨帧 DOM 节点总规模 -->
      <div class="ob-readout rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) p-2.5 font-mono">
        <div class="text-[12px] text-(--rac-muted)">跨帧 DOM 节点总量</div>
        <div class="mt-1 flex items-baseline justify-between">
          <span class="text-[15px] font-bold text-(--rac-accent)" data-test="perf-kpi-dom-total">
            {{ state.domTopology.totalTrackedNodes }}
          </span>
          <span class="text-[11px] text-(--rac-muted)">
            卡片 {{ state.domTopology.hostHydratedCards }} 张
          </span>
        </div>
        <div class="mt-1 text-[11px] text-(--rac-muted)">
          主控 {{ state.domTopology.consoleIframeNodes }} · 弹窗 {{ state.domTopology.modalOverlayNodes }}
        </div>
      </div>

      <!-- JS 堆内存快照 -->
      <div class="ob-readout rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) p-2.5 font-mono">
        <div class="text-[12px] text-(--rac-muted)">JS 堆内存占用 (Heap)</div>
        <div class="mt-1 flex items-baseline justify-between">
          <span class="text-[15px] font-bold text-(--rac-hi)" data-test="perf-kpi-memory">
            {{ state.memory.supported ? `${state.memory.usedMB} MB` : 'N/A' }}
          </span>
          <span v-if="state.memory.supported" class="text-[11px] text-(--rac-muted)">
            {{ state.memory.usagePct }}%
          </span>
        </div>
        <div class="mt-1 text-[11px] text-(--rac-muted)">
          {{
            state.memory.supported
              ? `已分配 ${state.memory.totalMB} / 限额 ${state.memory.limitMB} MB`
              : '当前宿主未暴露 performance.memory'
          }}
        </div>
      </div>
    </div>

    <!-- ── 区块 2：关键管线阶段耗时与缓存命中矩阵 ── -->
    <div class="rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-3" data-test="perf-metrics-table">
      <div class="mb-2 flex items-center justify-between">
        <span class="font-mono text-[12px] font-bold tracking-wider text-(--rac-hi) uppercase">
          各环节耗时与缓存命中率
        </span>
        <span class="font-mono text-[11px] text-(--rac-muted)">预算阈值参考 ST-D2 性能门禁</span>
      </div>

      <div class="space-y-2">
        <div
          v-for="m in metricList"
          :key="m.id"
          class="rounded-[2px] border border-(--rac-dim)/60 bg-(--rac-bg) px-2.5 py-2 font-mono"
          :data-metric-id="m.id"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <div class="flex items-center gap-2">
              <span
                class="inline-block size-2 rounded-full"
                :class="
                  m.count === 0
                    ? 'bg-(--rac-dim)'
                    : m.avgMs <= m.budgetMs
                      ? 'bg-(--rac-ok)'
                      : 'bg-(--rac-warn)'
                "
              />
              <span class="font-bold text-(--rac-hi)">{{ m.label }}</span>
            </div>
            <div class="flex flex-wrap items-center gap-3 text-[11px]">
              <span class="text-(--rac-muted)">
                调用: <strong class="text-(--rac-hi)">{{ m.count }}</strong>
              </span>
              <span v-if="m.cacheHits > 0 || m.cacheMisses > 0" class="text-(--rac-ok)">
                缓存命中: {{ m.cacheHits }}/{{ m.cacheHits + m.cacheMisses }} ({{ hitRatePct(m) }}%)
              </span>
              <span v-if="m.skippedCount > 0" class="text-(--rac-accent)">
                脏标记跳过: {{ m.skippedCount }} 次
              </span>
              <span class="text-(--rac-muted)">
                最新 <strong class="text-(--rac-hi)">{{ m.lastMs }}ms</strong> · 均值
                <strong :class="m.avgMs > m.budgetMs ? 'text-(--rac-warn)' : 'text-(--rac-ok)'">{{ m.avgMs }}ms</strong>
                · 峰值 <strong class="text-(--rac-hi)">{{ m.maxMs }}ms</strong>
                <small class="opacity-70">/ 预算 {{ m.budgetMs }}ms</small>
              </span>
            </div>
          </div>
          <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-[1px] bg-(--rac-panel-2)">
            <div
              class="h-full transition-all"
              :class="m.avgMs > m.budgetMs ? 'bg-(--rac-warn)' : 'bg-(--rac-accent)'"
              :style="{ width: `${barWidthPct(m.avgMs, m.budgetMs)}%` }"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ── 区块 3：跨帧三层容器与楼层卡片单份挂载拓扑诊断 ── -->
    <div class="rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-3" data-test="perf-dom-topology">
      <div class="mb-2 flex items-center justify-between">
        <span class="font-mono text-[12px] font-bold tracking-wider text-(--rac-hi) uppercase">
          界面节点数量与楼层卡片状态
        </span>
        <span class="font-mono text-[11px] text-(--rac-ok)">单份宿主 DOM 水合已启用</span>
      </div>

      <div class="grid grid-cols-2 gap-2 font-mono text-[11px] sm:grid-cols-4">
        <div class="rounded-[2px] border border-(--rac-dim)/60 bg-(--rac-bg) p-2">
          <div class="text-[12px] text-(--rac-muted)">1. 侧栏主控 iframe</div>
          <div class="mt-0.5 text-[13px] font-bold text-(--rac-hi)">
            {{ state.domTopology.consoleIframeNodes }} <small class="text-[11px] font-normal">nodes</small>
          </div>
          <div class="text-[11px] text-(--rac-muted)">z-index: 9990 · 常驻停靠</div>
        </div>

        <div class="rounded-[2px] border border-(--rac-dim)/60 bg-(--rac-bg) p-2">
          <div class="text-[12px] text-(--rac-muted)">2. 全屏弹窗伴生帧</div>
          <div class="mt-0.5 text-[13px] font-bold text-(--rac-hi)">
            {{ state.domTopology.modalOverlayNodes }} <small class="text-[11px] font-normal">nodes</small>
          </div>
          <div class="text-[11px] text-(--rac-muted)">
            状态: {{ state.domTopology.modalOverlayVisible ? '展开激活' : '后台休眠 (v-if 卸载)' }}
          </div>
        </div>

        <div class="rounded-[2px] border border-(--rac-dim)/60 bg-(--rac-bg) p-2">
          <div class="text-[12px] text-(--rac-muted)">3. 战术 PDA 伴生帧</div>
          <div class="mt-0.5 text-[13px] font-bold text-(--rac-hi)">
            {{ state.domTopology.hudHostNodes }} <small class="text-[11px] font-normal">nodes</small>
          </div>
          <div class="text-[11px] text-(--rac-muted)">z-index: 9995 · GPU 合成层</div>
        </div>

        <div class="rounded-[2px] border border-(--rac-dim)/60 bg-(--rac-bg) p-2">
          <div class="text-[12px] text-(--rac-muted)">4. 宿主楼层内嵌卡片</div>
          <div class="mt-0.5 text-[13px] font-bold text-(--rac-ok)">
            {{ state.domTopology.hostFloorCardMounts }} <small class="text-[11px] font-normal">挂载容器</small>
          </div>
          <div class="text-[11px] text-(--rac-muted)">
            已水合 {{ state.domTopology.hostHydratedCards }} · 隐藏壳 {{ state.domTopology.hostFloorCardIframes }}
          </div>
        </div>
      </div>
    </div>

    <!-- ── 区块 4：一键微基准自检回执（若已执行） ── -->
    <div
      v-if="state.lastBenchmark"
      class="rounded-[2px] border border-(--rac-accent)/60 bg-(--rac-panel) p-3 font-mono"
      data-test="perf-benchmark-report"
    >
      <div class="mb-2 flex items-center justify-between">
        <span class="text-[12px] font-bold text-(--rac-accent)">
          ◆ 全链路微基准压测报告 · 评级 {{ state.lastBenchmark.grade }} （总耗时 {{ state.lastBenchmark.totalMs }}ms）
        </span>
        <span class="text-[11px] text-(--rac-muted)">冷启动 vs 缓存热路径对比</span>
      </div>

      <div class="space-y-1.5">
        <div
          v-for="step in state.lastBenchmark.steps"
          :key="step.id"
          class="flex flex-wrap items-center justify-between gap-2 rounded-[2px] border border-(--rac-dim)/50 bg-(--rac-bg) px-2.5 py-1.5 text-[11px]"
        >
          <div>
            <span class="text-[12px] font-bold text-(--rac-hi)">{{ step.label }}</span>
            <span class="ml-2 text-[11px] text-(--rac-muted)">{{ step.note }}</span>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-(--rac-muted)">冷: {{ step.coldMs }}ms</span>
            <span class="font-bold text-(--rac-ok)">热: {{ step.warmMs }}ms</span>
            <span v-if="step.speedupRatio > 1" class="rounded-[2px] bg-(--rac-panel-2) px-1.5 py-0.2 text-(--rac-ok)">
              {{ step.speedupRatio }}x 提速
            </span>
            <span :class="step.passed ? 'text-(--rac-ok)' : 'text-(--rac-warn)'">
              {{ step.passed ? '● PASS' : '▲ WARN' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 区块 5：最近遥测事件流 ── -->
    <div class="rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-3 font-mono" data-test="perf-event-log">
      <div class="mb-2 flex items-center justify-between">
        <span class="text-[12px] font-bold tracking-wider text-(--rac-hi) uppercase">
          最近性能遥测事件流 (RECENT TELEMETRY EVENTS)
        </span>
        <span class="text-[11px] text-(--rac-muted)">保留最近 {{ state.recentEvents.length }} / 40 条</span>
      </div>

      <div v-if="state.recentEvents.length === 0" class="py-3 text-center text-[12px] text-(--rac-muted)">
        暂无遥测事件记录，点击上方「◆ 运行管线基准自检」或触发楼层刷新即可采集实时数据
      </div>
      <div v-else class="max-h-[150px] space-y-1 overflow-y-auto pr-1 text-[11px]">
        <div
          v-for="ev in state.recentEvents"
          :key="ev.seq"
          class="flex items-center justify-between gap-2 rounded-[2px] bg-(--rac-bg) px-2 py-1"
        >
          <div class="flex min-w-0 items-center gap-2">
            <span
              class="inline-block size-1.5 flex-none rounded-full"
              :class="ev.overBudget ? 'bg-(--rac-warn)' : 'bg-(--rac-ok)'"
            />
            <span class="truncate text-[12px] text-(--rac-hi)">{{ ev.label }}</span>
            <span v-if="ev.detail" class="truncate text-[11px] text-(--rac-muted)">[{{ ev.detail }}]</span>
          </div>
          <span
            class="flex-none font-bold"
            :class="ev.overBudget ? 'text-(--rac-warn)' : 'text-(--rac-ok)'"
          >
            {{ ev.durationMs }}ms
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getActivePinia } from 'pinia';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import {
  evaluatePerfHealthGrade,
  exportPerfDiagnosticReport,
  perfMonitorState,
  resetPerfMonitorStats,
  runPerfPipelineBenchmark,
  sampleDomTopology,
  sampleMemoryUsage,
  startRealtimePerfSampling,
  stopRealtimePerfSampling,
  type PerfMetricStat,
} from '../models/perfMonitor';

const state = perfMonitorState;
const runningBenchmark = ref(false);
const copiedFeedback = ref(false);

const metricList = computed<PerfMetricStat[]>(() => Object.values(state.metrics));
const health = computed(() => evaluatePerfHealthGrade());

function resolveCurrentSnapshot(): Record<string, unknown> | null {
  try {
    const pinia = getActivePinia() as
      | (NonNullable<ReturnType<typeof getActivePinia>> & {
          _s?: Map<string, ReturnType<typeof useFloatingStore>>;
        })
      | undefined;
    const floating = pinia?._s?.get('mvu_data.floating');
    return (floating?.snapshot as unknown as Record<string, unknown> | null) ?? null;
  } catch {
    return null;
  }
}

function hitRatePct(m: PerfMetricStat): number {
  const total = m.cacheHits + m.cacheMisses;
  if (total <= 0) return 0;
  return Math.round((m.cacheHits / total) * 100);
}

function barWidthPct(val: number, budget: number): number {
  if (val <= 0 || budget <= 0) return 0;
  return Math.min(100, Math.max(4, Math.round((val / budget) * 100)));
}

function gradeBadgeClass(grade: 'S' | 'A' | 'B' | 'C'): string {
  switch (grade) {
    case 'S':
      return 'border-(--rac-ok)/60 bg-(--rac-panel-2) text-(--rac-ok)';
    case 'A':
      return 'border-(--rac-accent)/60 bg-(--rac-panel-2) text-(--rac-accent)';
    case 'B':
      return 'border-(--rac-warn)/60 bg-(--rac-panel-2) text-(--rac-warn)';
    default:
      return 'border-(--rac-alert)/60 bg-(--rac-panel-2) text-(--rac-alert)';
  }
}

function onRefreshSnapshot(): void {
  sampleDomTopology();
  sampleMemoryUsage();
}

async function onRunBenchmark(): Promise<void> {
  if (runningBenchmark.value) return;
  runningBenchmark.value = true;
  try {
    await runPerfPipelineBenchmark(resolveCurrentSnapshot());
  } finally {
    runningBenchmark.value = false;
  }
}

async function onCopyReport(): Promise<void> {
  const json = exportPerfDiagnosticReport();
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(json);
    }
  } catch {
    // 忽略非安全上下文剪贴板异常
  }
  copiedFeedback.value = true;
  setTimeout(() => {
    copiedFeedback.value = false;
  }, 1800);
}

function onResetStats(): void {
  resetPerfMonitorStats();
  sampleDomTopology();
  sampleMemoryUsage();
}

onMounted(() => {
  sampleDomTopology();
  sampleMemoryUsage();
  startRealtimePerfSampling();
});

onUnmounted(() => {
  stopRealtimePerfSampling();
});
</script>
