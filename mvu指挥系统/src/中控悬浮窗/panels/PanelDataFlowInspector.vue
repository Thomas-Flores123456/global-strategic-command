<template>
  <div
    class="ra-dataflow-inspector flex flex-col gap-3 text-[12px] text-(--rac-text)"
    data-test="panel-dataflow-inspector"
  >
    <!-- 顶部总览控制条 -->
    <div class="ob-panel rounded-[2px] border border-(--rac-accent)/40 bg-(--rac-panel) p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="inline-flex items-center rounded-[2px] border border-(--rac-accent)/50 bg-(--rac-panel-2) px-2 py-0.5 font-mono text-[11px] font-bold text-(--rac-accent)"
          >
            ◆ DATAFLOW INSPECTOR
          </span>
          <span
            class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-0.5 font-mono text-[11px] text-(--rac-text)"
            data-test="buffer-traces-count"
          >
            已捕获楼层链路 {{ dataFlowDebugState.traces.length }}/5
          </span>
          <span
            class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-0.5 font-mono text-[11px] text-(--rac-text)"
            data-test="buffer-flights-count"
          >
            异步飞行记录 {{ dataFlowDebugState.flightLogs.length }}/100
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- 楼层 Trace 下拉选择器 -->
          <select
            v-if="dataFlowDebugState.traces.length > 0"
            :value="selectedTrace?.traceId ?? ''"
            data-test="trace-selector"
            class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-1 font-mono text-[11px] text-(--rac-hi)"
            @change="onSelectTrace(($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="trace in dataFlowDebugState.traces"
              :key="trace.traceId"
              :value="trace.traceId"
            >
              #{{ trace.meta.floorId ?? '?' }} [{{ trace.meta.source }}] ·
              {{ trace.totalDurationMs.toFixed(1) }}ms · Δ{{ trace.totalDiffs.length }}项
            </option>
          </select>
          <span v-else class="font-mono text-[11px] text-(--rac-muted)">暂无已捕获楼层 Trace</span>

          <button
            type="button"
            data-test="clear-all-btn"
            class="rounded-[2px] border border-(--rac-alert)/40 bg-(--rac-panel-2) px-2.5 py-1 text-[12px] text-(--rac-alert) hover:bg-(--rac-bg)"
            @click="onClearAll"
          >
            × 清空记录
          </button>
        </div>
      </div>

      <!-- 胶囊式最近楼层 Trace 快捷切换条 -->
      <div
        v-if="dataFlowDebugState.traces.length > 0"
        class="mt-2 flex flex-wrap items-center gap-1.5 border-t border-(--rac-dim) pt-2"
      >
        <button
          v-for="trace in dataFlowDebugState.traces"
          :key="trace.traceId"
          type="button"
          :data-test="`trace-pill-${trace.traceId}`"
          class="rounded-[2px] border px-2 py-0.5 font-mono text-[11px] transition-colors"
          :class="
            selectedTrace?.traceId === trace.traceId
              ? 'border-(--rac-accent) bg-(--rac-panel-2) font-semibold text-(--rac-accent)'
              : 'border-(--rac-dim) bg-(--rac-bg) text-(--rac-muted) hover:border-(--rac-line) hover:text-(--rac-text)'
          "
          @click="onSelectTrace(trace.traceId)"
        >
          #{{ trace.meta.floorId ?? '?' }} [{{ trace.meta.source }}] ·
          {{ trace.totalDurationMs.toFixed(1) }}ms · Δ{{ trace.totalDiffs.length }}项
        </button>
      </div>

      <!-- 四个子页切换按钮 -->
      <div class="ob-seg mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-(--rac-dim) pt-2.5">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          type="button"
          :data-test="`tab-${tab.key}`"
          class="rounded-[2px] border px-3 py-1 text-[12px] font-medium transition-colors"
          :class="
            activeTab === tab.key
              ? 'is-active border-(--rac-accent) bg-(--rac-panel-2) font-semibold text-(--rac-hi)'
              : 'border-(--rac-dim) bg-(--rac-bg) text-(--rac-muted) hover:border-(--rac-line) hover:text-(--rac-text)'
          "
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- 子页 1 · 七阶瀑布流 (waterfall) -->
    <div
      v-if="activeTab === 'waterfall'"
      class="grid grid-cols-1 gap-3 lg:grid-cols-12"
      data-test="view-waterfall"
    >
      <template v-if="selectedTrace">
        <!-- 左侧：七阶与九大玩法子齿轮列表 -->
        <div class="flex flex-col gap-1.5 rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-2.5 lg:col-span-5">
          <div class="mb-1 flex items-center justify-between text-[12px]">
            <span class="font-semibold text-(--rac-accent)">
              七阶同步流水线 (#{{ selectedTrace.meta.floorId ?? '?' }} · {{ selectedTrace.meta.source }})
            </span>
            <span class="font-mono text-[11px] text-(--rac-muted)">
              总计 {{ selectedTrace.totalDurationMs.toFixed(1) }}ms · Δ{{ selectedTrace.totalDiffs.length }}项
            </span>
          </div>

          <div
            v-for="stage in selectedTrace.stages"
            :key="stage.stageId"
            class="flex flex-col gap-1"
          >
            <div
              :data-test="`stage-row-${stage.stageId}`"
              class="cursor-pointer rounded-[2px] border p-2 transition-colors"
              :class="
                activeStage?.stageId === stage.stageId
                  ? 'border-(--rac-accent)/80 bg-(--rac-panel-2)'
                  : 'border-(--rac-dim) bg-(--rac-bg) hover:border-(--rac-line)'
              "
              @click="selectedStageId = stage.stageId"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5">
                  <button
                    v-if="stage.substages && stage.substages.length > 0"
                    type="button"
                    data-test="toggle-s2-substages"
                    class="rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) px-1 text-[11px] text-(--rac-warn)"
                    @click.stop="s2Expanded = !s2Expanded"
                  >
                    {{ s2Expanded ? '▼' : '▸' }} {{ stage.substages.length }}齿轮
                  </button>
                  <span class="font-mono text-[12px] font-semibold text-(--rac-hi)">
                    {{ stage.stageLabel }}
                  </span>
                </div>
                <div class="flex items-center gap-1.5 font-mono text-[11px]">
                  <span
                    class="rounded-[2px] border px-1.5 py-0.2 uppercase"
                    :class="STATUS_BADGE_CLASS[stage.status]"
                  >
                    {{ stage.status }}
                  </span>
                  <span class="text-(--rac-text)">{{ stage.durationMs.toFixed(1) }}ms</span>
                  <span
                    :class="stage.diffs.length > 0 ? 'font-bold text-(--rac-warn)' : 'text-(--rac-muted)'"
                  >
                    Δ{{ stage.diffs.length }}
                  </span>
                </div>
              </div>
              <div class="mt-1 truncate text-[12px] text-(--rac-muted)">{{ stage.summary }}</div>
            </div>

            <!-- S2_SETTLE 内部九大玩法子齿轮 (S2a..S2i) -->
            <div
              v-if="stage.substages && stage.substages.length > 0 && s2Expanded"
              class="ml-3 flex flex-col gap-1 border-l-2 border-(--rac-warn)/40 pl-2"
              data-test="s2-substages-list"
            >
              <div
                v-for="sub in stage.substages"
                :key="sub.stageId"
                :data-test="`stage-row-${sub.stageId}`"
                class="cursor-pointer rounded-[2px] border p-1.5 transition-colors"
                :class="
                  activeStage?.stageId === sub.stageId
                    ? 'border-(--rac-warn)/80 bg-(--rac-panel-2)'
                    : 'border-(--rac-dim)/80 bg-(--rac-bg) hover:border-(--rac-line)'
                "
                @click="selectedStageId = sub.stageId"
              >
                <div class="flex items-center justify-between gap-1.5">
                  <span class="font-mono text-[11px] text-(--rac-text)">{{ sub.stageLabel }}</span>
                  <div class="flex items-center gap-1.5 font-mono text-[11px]">
                    <span
                      class="rounded-[2px] border px-1 py-0.2 uppercase"
                      :class="STATUS_BADGE_CLASS[sub.status]"
                    >
                      {{ sub.status }}
                    </span>
                    <span class="text-(--rac-muted)">{{ sub.durationMs.toFixed(1) }}ms</span>
                    <span :class="sub.diffs.length > 0 ? 'font-bold text-(--rac-warn)' : 'text-(--rac-muted)'">
                      Δ{{ sub.diffs.length }}
                    </span>
                  </div>
                </div>
                <div class="mt-0.5 truncate text-[11px] text-(--rac-muted)">{{ sub.summary }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧：选中阶段 Diff 明细与本楼事件/告警/隔离预览 -->
        <div class="flex flex-col gap-2.5 rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-3 lg:col-span-7">
          <template v-if="activeStage">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-(--rac-dim) pb-2">
              <div>
                <div class="font-mono text-[13px] font-bold text-(--rac-accent)">
                  {{ activeStage.stageLabel }} ({{ activeStage.stageId }})
                </div>
                <div class="mt-0.5 text-[12px] text-(--rac-text)">{{ activeStage.summary }}</div>
              </div>
              <div class="flex items-center gap-2 font-mono text-[11px]">
                <span
                  class="rounded-[2px] border px-1.5 py-0.5 uppercase"
                  :class="STATUS_BADGE_CLASS[activeStage.status]"
                >
                  {{ activeStage.status }}
                </span>
                <span class="text-(--rac-text)">{{ activeStage.durationMs.toFixed(2) }}ms</span>
                <span class="text-(--rac-warn)">变更 {{ activeStage.diffs.length }} 项</span>
              </div>
            </div>

            <!-- 阶段 Diff 明细表 -->
            <div>
              <div class="mb-1.5 font-semibold text-(--rac-warn)">
                阶段字段变更明细 (Δ{{ activeStage.diffs.length }})
              </div>
              <div
                v-if="activeStage.diffs.length === 0"
                class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) p-3 text-center text-(--rac-muted)"
              >
                本阶段无 stat_data 字段变更
              </div>
              <div v-else class="max-h-64 overflow-y-auto rounded-[2px] border border-(--rac-dim) bg-(--rac-bg)">
                <table class="w-full text-left font-mono text-[11px]">
                  <thead class="border-b border-(--rac-dim) bg-(--rac-panel-2) text-[12px] text-(--rac-muted)">
                    <tr>
                      <th class="px-2 py-1">字段路径 (path)</th>
                      <th class="px-2 py-1">类型</th>
                      <th class="px-2 py-1">变更前 → 变更后</th>
                      <th class="px-2 py-1 text-right">差值 (Δ)</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-(--rac-dim)/60">
                    <tr v-for="d in activeStage.diffs" :key="d.path">
                      <td class="px-2 py-1 font-semibold text-(--rac-accent)">{{ d.path }}</td>
                      <td class="px-2 py-1 text-(--rac-muted)">{{ d.kind }}</td>
                      <td class="px-2 py-1 text-(--rac-text)">
                        <span class="text-(--rac-muted)">{{ formatDiffVal(d.before) }}</span>
                        <span class="mx-1 text-(--rac-muted)">→</span>
                        <span class="text-(--rac-hi)">{{ formatDiffVal(d.after) }}</span>
                      </td>
                      <td class="px-2 py-1 text-right font-bold">
                        <span
                          v-if="d.numericDelta !== undefined"
                          :class="d.numericDelta >= 0 ? 'text-(--rac-ok)' : 'text-(--rac-alert)'"
                        >
                          {{ d.numericDelta >= 0 ? `+${d.numericDelta}` : d.numericDelta }}
                        </span>
                        <span v-else class="text-(--rac-muted)">-</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </template>

          <!-- 本楼产出事件 / 校验告警 / 隔离项预览 -->
          <div class="grid grid-cols-1 gap-2 pt-1 md:grid-cols-3">
            <div class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) p-2">
              <div class="mb-1 font-semibold text-(--rac-ok)">
                结算事件 ({{ selectedTrace.eventsCount }})
              </div>
              <div v-if="selectedTrace.eventsPreview.length === 0" class="text-[11px] text-(--rac-muted)">
                无事件
              </div>
              <ul v-else class="max-h-32 space-y-1 overflow-y-auto font-mono text-[11px] text-(--rac-text)">
                <li v-for="(ev, idx) in selectedTrace.eventsPreview" :key="idx">
                  [{{ ev.domain || ev.level || 'info' }}] {{ ev.msg }}
                </li>
              </ul>
            </div>

            <div class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) p-2">
              <div class="mb-1 font-semibold text-(--rac-warn)">
                校验告警 ({{ selectedTrace.issuesCount }})
              </div>
              <div v-if="selectedTrace.issuesPreview.length === 0" class="text-[11px] text-(--rac-muted)">
                无告警
              </div>
              <ul v-else class="max-h-32 space-y-1 overflow-y-auto font-mono text-[11px] text-(--rac-warn)">
                <li v-for="(iss, idx) in selectedTrace.issuesPreview" :key="idx">
                  [{{ iss.code }}] {{ iss.message }}
                </li>
              </ul>
            </div>

            <div class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) p-2">
              <div class="mb-1 font-semibold text-(--rac-alert)">
                隔离拦截 ({{ selectedTrace.quarantineCount }})
              </div>
              <div v-if="selectedTrace.quarantinePreview.length === 0" class="text-[11px] text-(--rac-muted)">
                无隔离项
              </div>
              <ul v-else class="max-h-32 space-y-1 overflow-y-auto font-mono text-[11px] text-(--rac-alert)">
                <li v-for="(q, idx) in selectedTrace.quarantinePreview" :key="idx">
                  &lt;{{ q.blockType }}&gt; {{ q.reason }}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </template>

      <div
        v-else
        class="col-span-full rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-6 text-center text-(--rac-muted)"
      >
        当前尚无楼层解析 Trace。可触发一次楼层解析，或切换到「◆ 干跑与排障包」直接执行免落盘试算。
      </div>
    </div>

    <!-- 子页 2 · 状态 Diff 与字段溯源 (diff) -->
    <div
      v-if="activeTab === 'diff'"
      class="flex flex-col gap-3 rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-3"
      data-test="view-diff"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-1 items-center gap-2">
          <span class="font-semibold text-(--rac-warn)">Who Touched Me? 字段反向溯源:</span>
          <input
            v-model="fieldQuery"
            type="text"
            data-test="field-query-input"
            placeholder="输入字段路径或关键词（如 credits / nanites / queues[0]）..."
            class="min-w-[220px] flex-1 rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2.5 py-1 font-mono text-[12px] text-(--rac-hi)"
          />
          <button
            v-if="fieldQuery"
            type="button"
            class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-1 text-[12px] text-(--rac-muted) hover:text-(--rac-text)"
            @click="fieldQuery = ''"
          >
            清除
          </button>
        </div>

        <div class="flex items-center gap-1.5">
          <button
            type="button"
            data-test="diff-mode-trace"
            class="rounded-[2px] border px-2.5 py-1 text-[12px]"
            :class="
              diffMode === 'trace'
                ? 'border-(--rac-accent) bg-(--rac-panel-2) font-semibold text-(--rac-accent)'
                : 'border-(--rac-dim) bg-(--rac-bg) text-(--rac-muted)'
            "
            @click="diffMode = 'trace'"
          >
            ◆ 阶段修改链溯源 ({{ mutationHits.length }} 阶段)
          </button>
          <button
            type="button"
            data-test="diff-mode-total"
            class="rounded-[2px] border px-2.5 py-1 text-[12px]"
            :class="
              diffMode === 'total'
                ? 'border-(--rac-warn) bg-(--rac-panel-2) font-semibold text-(--rac-warn)'
                : 'border-(--rac-dim) bg-(--rac-bg) text-(--rac-muted)'
            "
            @click="diffMode = 'total'"
          >
            ◇ 整楼总 Diff ({{ filteredTotalDiffs.length }} 项)
          </button>
        </div>
      </div>

      <!-- 快捷筛选芯片 -->
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-[12px] text-(--rac-muted)">快捷芯片:</span>
        <button
          v-for="chip in QUICK_FIELD_CHIPS"
          :key="chip"
          type="button"
          :data-test="`field-chip-${chip}`"
          class="rounded-[2px] border px-2 py-0.5 font-mono text-[11px] transition-colors"
          :class="
            fieldQuery === chip
              ? 'border-(--rac-warn) bg-(--rac-panel-2) text-(--rac-warn)'
              : 'border-(--rac-dim) bg-(--rac-bg) text-(--rac-muted) hover:border-(--rac-line) hover:text-(--rac-text)'
          "
          @click="fieldQuery = fieldQuery === chip ? '' : chip"
        >
          {{ chip }}
        </button>
      </div>

      <template v-if="selectedTrace">
        <!-- 视图 A：阶段修改链溯源 -->
        <div v-if="diffMode === 'trace'" class="flex flex-col gap-2" data-test="mutation-chain-list">
          <div
            v-if="mutationHits.length === 0"
            class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) p-4 text-center text-(--rac-muted)"
          >
            未找到匹配「{{ fieldQuery || '全部字段' }}」的阶段修改记录
          </div>
          <div
            v-for="hit in mutationHits"
            :key="hit.stageId"
            :data-test="`mutation-hit-${hit.stageId}`"
            class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) p-2.5"
          >
            <div class="mb-1.5 flex items-center justify-between">
              <span class="font-mono text-[12px] font-bold text-(--rac-accent)">
                {{ hit.stageLabel }} ({{ hit.stageId }})
              </span>
              <span class="font-mono text-[11px] text-(--rac-warn)">命中 {{ hit.diffs.length }} 项</span>
            </div>
            <table class="w-full text-left font-mono text-[11px]">
              <tbody class="divide-y divide-(--rac-dim)/60">
                <tr v-for="d in hit.diffs" :key="d.path">
                  <td class="py-1 pr-2 font-semibold text-(--rac-hi)">{{ d.path }}</td>
                  <td class="py-1 pr-2 text-(--rac-muted)">{{ d.kind }}</td>
                  <td class="py-1 pr-2 text-(--rac-text)">
                    {{ formatDiffVal(d.before) }} → {{ formatDiffVal(d.after) }}
                  </td>
                  <td class="py-1 text-right font-bold">
                    <span
                      v-if="d.numericDelta !== undefined"
                      :class="d.numericDelta >= 0 ? 'text-(--rac-ok)' : 'text-(--rac-alert)'"
                    >
                      {{ d.numericDelta >= 0 ? `+${d.numericDelta}` : d.numericDelta }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 视图 B：整楼总 Diff (selectedTrace.totalDiffs) -->
        <div v-else class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg)" data-test="total-diffs-table">
          <div
            v-if="filteredTotalDiffs.length === 0"
            class="p-4 text-center text-(--rac-muted)"
          >
            当前筛选条件下无整楼总 Diff 条目
          </div>
          <table v-else class="w-full text-left font-mono text-[11px]">
            <thead class="border-b border-(--rac-dim) bg-(--rac-panel-2) text-[12px] text-(--rac-muted)">
              <tr>
                <th class="px-2.5 py-1.5">字段路径 (path)</th>
                <th class="px-2.5 py-1.5">类型</th>
                <th class="px-2.5 py-1.5">基线值 (S0) → 落盘值 (S6)</th>
                <th class="px-2.5 py-1.5 text-right">净差值 (Δ)</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-(--rac-dim)/60">
              <tr v-for="d in filteredTotalDiffs" :key="d.path">
                <td class="px-2.5 py-1 font-semibold text-(--rac-accent)">{{ d.path }}</td>
                <td class="px-2.5 py-1 text-(--rac-muted)">{{ d.kind }}</td>
                <td class="px-2.5 py-1 text-(--rac-text)">
                  {{ formatDiffVal(d.before) }} → {{ formatDiffVal(d.after) }}
                </td>
                <td class="px-2.5 py-1 text-right font-bold">
                  <span
                    v-if="d.numericDelta !== undefined"
                    :class="d.numericDelta >= 0 ? 'text-(--rac-ok)' : 'text-(--rac-alert)'"
                  >
                    {{ d.numericDelta >= 0 ? `+${d.numericDelta}` : d.numericDelta }}
                  </span>
                  <span v-else class="text-(--rac-muted)">-</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <div v-else class="p-4 text-center text-(--rac-muted)">暂无选中楼层 Trace</div>
    </div>

    <!-- 子页 3 · 异步飞行记录仪 (flight) -->
    <div
      v-if="activeTab === 'flight'"
      class="flex flex-col gap-2.5 rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-3"
      data-test="view-flight"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-semibold text-(--rac-accent)">类别过滤:</span>
          <select
            v-model="flightCategory"
            data-test="flight-category-filter"
            class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-1 font-mono text-[11px] text-(--rac-text)"
          >
            <option value="all">all (全部类别)</option>
            <option value="host_event">host_event (宿主事件)</option>
            <option value="inflight_guard">inflight_guard (单飞锁)</option>
            <option value="wb_gateway">wb_gateway (世界书守卫)</option>
            <option value="auto_filer">auto_filer (自动入档)</option>
            <option value="faction_wb_sync">faction_wb_sync (书组同步)</option>
            <option value="chrono_action">chrono_action (时序裁决)</option>
          </select>

          <span class="ml-1 font-semibold text-(--rac-accent)">状态过滤:</span>
          <select
            v-model="flightStatus"
            data-test="flight-status-filter"
            class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-1 font-mono text-[11px] text-(--rac-text)"
          >
            <option value="all">all (全部状态)</option>
            <option value="ok">ok</option>
            <option value="blocked">blocked</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
        </div>

        <span class="font-mono text-[11px] text-(--rac-muted)">
          匹配 {{ filteredFlightLogs.length }} / {{ dataFlowDebugState.flightLogs.length }} 条
        </span>
      </div>

      <div
        v-if="filteredFlightLogs.length === 0"
        class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) p-5 text-center text-(--rac-muted)"
      >
        暂无匹配的异步飞行记录
      </div>
      <div v-else class="max-h-96 space-y-1.5 overflow-y-auto pr-1" data-test="flight-log-list">
        <div
          v-for="item in filteredFlightLogs"
          :key="item.id"
          :data-test="`flight-row-${item.id}`"
          class="rounded-[2px] border px-2.5 py-2 font-mono text-[11px]"
          :class="
            item.status === 'error'
              ? 'border-(--rac-alert)/80 bg-(--rac-panel-2) text-(--rac-hi)'
              : item.status === 'blocked'
                ? 'border-(--rac-warn)/80 bg-(--rac-panel-2) text-(--rac-hi)'
                : item.status === 'warn'
                  ? 'border-(--rac-warn)/50 bg-(--rac-bg) text-(--rac-text)'
                  : 'border-(--rac-dim) bg-(--rac-bg) text-(--rac-text)'
          "
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-1.5">
              <span
                class="rounded-[2px] border px-1.5 py-0.2 text-[11px] uppercase"
                :class="FLIGHT_STATUS_BADGE[item.status]"
              >
                {{ item.status }}
              </span>
              <span class="rounded-[2px] bg-(--rac-panel-2) px-1.5 py-0.2 text-[11px] text-(--rac-accent)">
                {{ item.category }}
              </span>
              <span class="text-(--rac-muted)">
                #{{ item.floorId ?? '-' }} (swipe:{{ item.swipeId ?? '-' }})
              </span>
              <span class="font-bold text-(--rac-hi)">{{ item.title }}</span>
            </div>
            <span class="text-[11px] text-(--rac-muted)">
              {{ item.ts }}
              <template v-if="item.durationMs !== undefined"> · {{ item.durationMs.toFixed(1) }}ms</template>
            </span>
          </div>
          <div class="mt-1 break-all text-[12px] text-(--rac-text)">{{ item.detail }}</div>
        </div>
      </div>
    </div>

    <!-- 子页 4 · 免落盘干跑与 AI 排障包 (dryrun) -->
    <div
      v-if="activeTab === 'dryrun'"
      class="flex flex-col gap-3 rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-3"
      data-test="view-dryrun"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="font-semibold text-(--rac-warn)">
          ◆ 战报解析模拟测试（基于当前楼层数据模拟结算，不会改动真实存档）
        </span>
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            v-for="tpl in DRY_RUN_TEMPLATES"
            :key="tpl.key"
            type="button"
            :data-test="`tpl-${tpl.key}`"
            class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-1 text-[12px] text-(--rac-accent) hover:border-(--rac-accent)/60"
            @click="dryRunText = tpl.content"
          >
            {{ tpl.label }}
          </button>
        </div>
      </div>

      <textarea
        v-model="dryRunText"
        rows="6"
        data-test="dryrun-textarea"
        placeholder="粘贴或选择上方预设战术标签报文（如 <timePast>、<排产计划>、<事件>、<暗网>）..."
        class="w-full rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) p-2.5 font-mono text-[12px] text-(--rac-hi)"
      />

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-test="run-dryrun-btn"
          class="rounded-[2px] border border-(--rac-warn)/60 bg-(--rac-panel-2) px-3 py-1.5 font-semibold text-(--rac-warn) hover:bg-(--rac-bg)"
          @click="onRunDryRun"
        >
          ◆ 开始模拟试算
        </button>

        <button
          type="button"
          data-test="build-repro-btn"
          :disabled="!selectedTrace"
          class="rounded-[2px] border border-(--rac-accent)/60 bg-(--rac-panel-2) px-3 py-1.5 font-semibold text-(--rac-accent) hover:bg-(--rac-bg) disabled:opacity-40"
          @click="onBuildAndCopyRepro"
        >
          ◇ 生成并复制 AI 排障复现包
        </button>

        <span v-if="dryRunNotice" class="font-mono text-[11px] text-(--rac-ok)" data-test="dryrun-notice">
          {{ dryRunNotice }}
        </span>
      </div>

      <div v-if="reproBundleJson" class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between text-[12px] text-(--rac-muted)">
          <span>AI 排障复现包 JSON 预览（可直接发给 AI 或填入回归单测夹具）:</span>
          <span class="font-mono text-[11px]">{{ reproBundleJson.length }} chars</span>
        </div>
        <textarea
          :value="reproBundleJson"
          readonly
          rows="8"
          data-test="repro-bundle-preview"
          class="w-full rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) p-2.5 font-mono text-[11px] text-(--rac-ok)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { effectiveCatalogSnapshot as getEffectiveCatalog } from '../../红警指挥系统/composables/useCatalog';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import {
  dataFlowDebugState,
  clearDataFlowTraces,
  clearFlightLogs,
  type FloorTraceRecord,
  type TraceStageRecord,
  type AsyncFlightLogEntry,
  type FlightLogCategory,
} from '../../红警指挥系统/debug/dataFlowTracer';
import {
  traceFieldMutations,
  type FieldDiffEntry,
  type StageFieldMutationHit,
} from '../../红警指挥系统/debug/stateDiffEngine';
import {
  runDryRunPipeline,
  buildReproBundleJson,
} from '../../红警指挥系统/debug/reproBundleAndDryRun';

export type DataFlowTabKey = 'waterfall' | 'diff' | 'flight' | 'dryrun';

const props = defineProps<{
  initialTab?: DataFlowTabKey;
}>();

const floating = useFloatingStore();

const TABS: ReadonlyArray<{ key: DataFlowTabKey; label: string }> = [
  { key: 'waterfall', label: '◆ 七阶瀑布流' },
  { key: 'diff', label: '◆ 状态Diff与溯源' },
  { key: 'flight', label: '◆ 异步飞行记录' },
  { key: 'dryrun', label: '◆ 干跑与排障包' },
];

const QUICK_FIELD_CHIPS = [
  'credits',
  'nanites',
  'queues',
  'buildings',
  'protocols',
  'chains',
  'darknet',
  'command',
  'morale',
  'exposure',
] as const;

const DRY_RUN_TEMPLATES = [
  {
    key: 'planning',
    label: '填充产线/排产测试报文',
    content: `<态势>\n<timePast>60</timePast>\n</态势>\n<排产计划>\n- 类型: 建造\n  项目: 发电厂\n  基地: 主基地\n  数量: 1\n- 类型: 生产\n  项目: 美国大兵\n  基地: 主基地\n  数量: 2\n</排产计划>`,
  },
  {
    key: 'events',
    label: '填充事件/资金链测试报文',
    content: `<态势>\n<timePast>120</timePast>\n</态势>\n<事件>\n- 类型: 资金链建立\n  名称: 恶土废料精炼线\n  流向: 收入\n  日速率: 1200\n  效率: 1\n</事件>`,
  },
  {
    key: 'darknet',
    label: '填充暗网交割测试报文',
    content: `<态势>\n<timePast>180</timePast>\n</态势>\n<暗网>\n- 类型: 交易回执\n  渠道: 实物变现\n  标的: 军用级钛合金装甲板\n  数量: 10\n  金额: +1500\n  说明: 恶土黑市中间人现金交割\n</暗网>`,
  },
] as const;

const STATUS_BADGE_CLASS: Record<TraceStageRecord['status'], string> = {
  ok: 'border-(--rac-ok)/50 bg-(--rac-panel-2) text-(--rac-ok)',
  warn: 'border-(--rac-warn)/50 bg-(--rac-panel-2) text-(--rac-warn)',
  blocked: 'border-(--rac-alert)/60 bg-(--rac-panel-2) text-(--rac-alert)',
  skipped: 'border-(--rac-dim) bg-(--rac-bg) text-(--rac-muted)',
};

const FLIGHT_STATUS_BADGE: Record<AsyncFlightLogEntry['status'], string> = {
  ok: 'border-(--rac-ok)/50 bg-(--rac-panel-2) text-(--rac-ok)',
  warn: 'border-(--rac-warn)/50 bg-(--rac-panel-2) text-(--rac-warn)',
  blocked: 'border-(--rac-warn) bg-(--rac-panel-2) text-(--rac-warn) font-bold',
  error: 'border-(--rac-alert) bg-(--rac-panel-2) text-(--rac-alert) font-bold',
};

const activeTab = ref<DataFlowTabKey>(props.initialTab ?? 'waterfall');
watch(
  () => props.initialTab,
  val => {
    if (val) activeTab.value = val;
  },
);

const selectedTraceId = ref<string>('');
const selectedStageId = ref<string>('');
const s2Expanded = ref(true);

const fieldQuery = ref('');
const diffMode = ref<'trace' | 'total'>('trace');

const flightCategory = ref<'all' | FlightLogCategory>('all');
const flightStatus = ref<'all' | AsyncFlightLogEntry['status']>('all');

const dryRunText = ref<string>(DRY_RUN_TEMPLATES[0].content);
const dryRunNotice = ref('');
const reproBundleJson = ref('');

const selectedTrace = computed<FloorTraceRecord | null>(() => {
  const list = dataFlowDebugState.traces;
  if (list.length === 0) return null;
  return list.find(t => t.traceId === selectedTraceId.value) ?? list[0];
});

const activeStage = computed<TraceStageRecord | null>(() => {
  const trace = selectedTrace.value;
  if (!trace || trace.stages.length === 0) return null;
  const targetId = selectedStageId.value;
  if (targetId) {
    for (const st of trace.stages) {
      if (st.stageId === targetId) return st;
      if (st.substages) {
        const sub = st.substages.find(s => s.stageId === targetId);
        if (sub) return sub;
      }
    }
  }
  return trace.stages[0];
});

const mutationHits = computed<StageFieldMutationHit[]>(() => {
  if (!selectedTrace.value) return [];
  return traceFieldMutations(selectedTrace.value, fieldQuery.value);
});

const filteredTotalDiffs = computed<FieldDiffEntry[]>(() => {
  const trace = selectedTrace.value;
  if (!trace) return [];
  const q = fieldQuery.value.trim().toLowerCase();
  if (!q) return trace.totalDiffs;
  return trace.totalDiffs.filter(d => d.path.toLowerCase().includes(q));
});

const filteredFlightLogs = computed<AsyncFlightLogEntry[]>(() =>
  dataFlowDebugState.flightLogs.filter(
    item =>
      (flightCategory.value === 'all' || item.category === flightCategory.value) &&
      (flightStatus.value === 'all' || item.status === flightStatus.value),
  ),
);

function onSelectTrace(traceId: string): void {
  selectedTraceId.value = traceId;
  selectedStageId.value = '';
}

function onClearAll(): void {
  clearDataFlowTraces();
  clearFlightLogs();
  selectedTraceId.value = '';
  selectedStageId.value = '';
  dryRunNotice.value = '';
  reproBundleJson.value = '';
}

function formatDiffVal(val: unknown): string {
  if (val === undefined) return '∅';
  if (typeof val === 'string') return JSON.stringify(val);
  if (typeof val === 'number' || typeof val === 'boolean' || val === null) return String(val);
  const raw = JSON.stringify(val);
  return raw.length > 96 ? `${raw.slice(0, 93)}...` : raw;
}

function onRunDryRun(): void {
  const res = runDryRunPipeline({
    rawText: dryRunText.value,
    baselineStatData: floating.snapshot,
    catalog: getEffectiveCatalog(),
    floorId: floating.floorId ?? undefined,
  });
  const latest = (res as { trace?: FloorTraceRecord } | null)?.trace ?? dataFlowDebugState.traces[0];
  if (latest) {
    selectedTraceId.value = latest.traceId;
    selectedStageId.value = '';
    dryRunNotice.value = `● 干跑完成 [${latest.traceId}]：耗时 ${latest.totalDurationMs.toFixed(1)}ms · Δ${latest.totalDiffs.length}项 · 事件 ${latest.eventsCount} 条（未修改真实存档）`;
  }
}

async function onBuildAndCopyRepro(): Promise<void> {
  if (!selectedTrace.value) return;
  const json = buildReproBundleJson(selectedTrace.value, dataFlowDebugState.flightLogs);
  reproBundleJson.value = json;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(json);
      dryRunNotice.value = '● 已生成并复制 AI 排障复现包至剪贴板';
      return;
    }
  } catch {
    // 非安全上下文剪贴板权限受限时保留预览框文本
  }
  dryRunNotice.value = '● 已生成 AI 排障复现包（请从下方预览框复制）';
}
</script>
