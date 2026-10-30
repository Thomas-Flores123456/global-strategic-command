<template>
  <Transition name="ra-modal">
    <div
      v-if="open"
      ref="backdropRef"
      class="ra-modal-mask fixed inset-0 z-10010 flex items-center justify-center p-3"
      @click.self="$emit('close')"
    >
      <section
        ref="panelRef"
        class="ra-modal-card flex max-h-[90vh] w-full max-w-[1080px] flex-col overflow-hidden rounded-[4px] select-none"
        role="dialog"
        aria-modal="true"
        aria-label="战区工程与科研调度日程"
      >
        <!-- ── 区域 1：顶栏（战区工务中枢 & 落账模式控制器） ── -->
        <header class="ra-modal-header flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-2">
          <div class="flex items-center gap-2">
            <span class="ra-modal-icon"><Icon name="clock" :size="14" /></span>
            <span class="ra-modal-title text-[13px] font-bold tracking-wide">战时基地工务日程 · THEATRE SCHEDULE</span>
            <span v-if="model.clockText" class="sch-clock font-mono text-[11px]">{{ model.clockText }}</span>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              data-test="schedule-mode-instant-toggle"
              class="sch-filter-btn inline-flex items-center gap-1 font-mono text-[11px] font-semibold"
              :class="{ 'sch-filter-btn--active': instantMode }"
              :aria-pressed="instantMode"
              @click="instantMode = !instantMode"
            >
              <Icon name="power" :size="11" />
              <span>即时编排: {{ instantMode ? '开启' : '托盘' }}</span>
            </button>
            <button
              type="button"
              data-test="schedule-tray-toggle"
              class="sch-filter-btn inline-flex items-center gap-1 font-mono text-[11px]"
              :class="{ 'sch-filter-btn--active': trayOpen || commandTray.length > 0 }"
              :aria-pressed="trayOpen"
              @click="trayOpen = !trayOpen"
            >
              <Icon name="send" :size="11" />
              <span>指令托盘 ({{ commandTray.length }})</span>
            </button>
            <button
              type="button"
              class="ra-modal-close rounded-[2px] p-1 transition-colors"
              aria-label="关闭弹窗"
              @click="$emit('close')"
            >
              <Icon name="close" :size="12" />
            </button>
          </div>
        </header>

        <!-- ── 区域 2：顶栏里程碑提示横幅与全局产能 KPI 仪表带 ── -->
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-(--rac-dim) bg-(--rac-panel-2) px-4 py-1.5 text-[11px]">
          <div
            data-test="schedule-next-milestone"
            class="sch-milestone-banner flex min-w-0 flex-1 items-center justify-between gap-2 rounded-[2px] px-2 py-0.5"
            :class="{
              'sch-milestone-banner--settling':
                model.nextMilestone.hasMilestone && model.nextMilestone.remainingMinutes === 0,
              'sch-milestone-banner--active':
                model.nextMilestone.hasMilestone && (model.nextMilestone.remainingMinutes ?? 0) > 0,
              'sch-milestone-banner--empty': !model.nextMilestone.hasMilestone,
            }"
          >
            <div class="flex min-w-0 items-center gap-2">
              <span class="sch-milestone-tag flex-none rounded-[2px] px-1.5 py-0.5 font-mono text-[11px] font-bold">
                {{ model.nextMilestone.label }}
              </span>
              <span class="sch-milestone-summary truncate">{{ model.nextMilestone.summary }}</span>
            </div>
            <span
              v-if="model.nextMilestone.baseName"
              class="sch-milestone-base flex-none font-mono text-[11px]"
              style="color: var(--rac-muted)"
            >
              属地：{{ model.nextMilestone.baseName }}
            </span>
          </div>

          <div
            data-test="schedule-kpi-ribbon"
            class="flex flex-wrap items-center gap-3 font-mono text-[11px]"
          >
            <span class="flex items-center gap-1" style="color: var(--rac-muted)">
              <span>进行中:</span>
              <span class="font-bold" style="color: var(--rac-warn)">{{ totalActiveTxns }}</span>
            </span>
            <span class="flex items-center gap-1" style="color: var(--rac-muted)">
              <span>排队中:</span>
              <span class="font-bold" style="color: var(--rac-line)">{{ totalQueuedTxns }}</span>
            </span>
            <span class="flex items-center gap-1" style="color: var(--rac-muted)">
              <span>运转工位:</span>
              <span class="font-bold" style="color: var(--rac-ok)">
                {{ kpiSummary.activeStationCount }}/{{ kpiSummary.totalUnlockedCapacity }}
              </span>
            </span>
            <span class="flex items-center gap-1" style="color: var(--rac-muted)">
              <span>并联加速产线:</span>
              <span class="font-bold text-(--rac-warn)">{{ kpiSummary.acceleratingLaneCount }} 条</span>
            </span>
            <span class="flex items-center gap-1" style="color: var(--rac-muted)">
              <span>基地数量:</span>
              <span class="font-medium" style="color: var(--rac-text)">{{ model.bases.length }}</span>
            </span>
          </div>
        </div>

        <!-- ── 区域 3：三视图切换、时间标尺缩放与过滤器栏 ── -->
        <div
          class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-1.5"
          style="border-color: var(--rac-dim); background: rgba(0, 0, 0, 0.2)"
        >
          <div class="flex flex-wrap items-center gap-2">
            <!-- 三视图胶囊 -->
            <div data-test="schedule-view-switch" class="flex items-center gap-1">
              <button
                type="button"
                class="sch-filter-btn inline-flex items-center gap-1"
                :class="{ 'sch-filter-btn--active': viewMode === 'base' }"
                @click="viewMode = 'base'"
              >
                <Icon name="base" :size="11" />
                <span>基地工位甘特</span>
              </button>
              <button
                type="button"
                class="sch-filter-btn inline-flex items-center gap-1"
                :class="{ 'sch-filter-btn--active': viewMode === 'domain' }"
                @click="viewMode = 'domain'"
              >
                <Icon name="compass" :size="11" />
                <span>五大领域汇总</span>
              </button>
              <button
                type="button"
                class="sch-filter-btn inline-flex items-center gap-1"
                :class="{ 'sch-filter-btn--active': viewMode === 'table' }"
                @click="viewMode = 'table'"
              >
                <Icon name="doc" :size="11" />
                <span>紧凑工单表</span>
              </button>
            </div>

            <!-- 时间标尺胶囊 -->
            <div data-test="schedule-horizon-switch" class="flex items-center gap-1 border-l border-(--rac-dim) pl-2 font-mono">
              <button
                v-for="hOpt in HORIZON_OPTIONS"
                :key="hOpt.mode"
                type="button"
                class="sch-filter-btn"
                :class="{ 'sch-filter-btn--active': horizonMode === hOpt.mode }"
                @click="horizonMode = hOpt.mode"
              >
                {{ hOpt.label }}
              </button>
            </div>

            <!-- 基地快速切换胶囊 -->
            <div v-if="model.bases.length > 1" class="flex items-center gap-1 border-l border-(--rac-dim) pl-2">
              <button
                type="button"
                class="sch-filter-btn"
                :class="{ 'sch-filter-btn--active': activeBaseKey === null }"
                @click="activeBaseKey = null"
              >
                全部基地
              </button>
              <button
                v-for="b in visibleBases"
                :key="b.key"
                type="button"
                class="sch-filter-btn"
                :class="{ 'sch-filter-btn--active': activeBaseKey === b.key }"
                @click="activeBaseKey = b.key"
              >
                {{ b.name }}
              </button>
            </div>
          </div>

          <div class="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              class="sch-filter-btn text-[11px]"
              :class="{ 'sch-filter-btn--active': onlyActiveLanes }"
              :aria-pressed="onlyActiveLanes"
              @click="onlyActiveLanes = !onlyActiveLanes"
            >
              仅看活跃/已开通
            </button>
            <button
              type="button"
              data-test="schedule-draft-toggle"
              class="sch-filter-btn inline-flex items-center gap-1 text-[11px]"
              :class="{ 'sch-filter-btn--active': showDraftChain }"
              :aria-pressed="showDraftChain"
              @click="showDraftChain = !showDraftChain"
            >
              <Icon name="layers" :size="11" />
              <span>含后续阶段</span>
            </button>
            <button
              v-if="retiredCount > 0"
              type="button"
              class="sch-filter-btn text-[11px]"
              :class="{ 'sch-filter-btn--active': showRetired }"
              :aria-pressed="showRetired"
              @click="showRetired = !showRetired"
            >
              {{ showRetired ? `隐藏废弃基地 (${retiredCount})` : `显示废弃基地 (${retiredCount})` }}
            </button>
            <button
              type="button"
              class="sch-filter-btn text-[11px] opacity-85 hover:opacity-100"
              @click="showResearchSection = !showResearchSection"
            >
              {{ showResearchSection ? '收起科研队列' : '查看科研队列' }}
            </button>
          </div>
        </div>

        <!-- ── 区域 4：主视区（三视图联动 + 科研专席 + 条令攻关） ── -->
        <div class="ra-modal-body flex-1 overflow-y-auto px-4 py-3">
          <PanelPlanningCard
            v-if="model.planningReceipt && !dismissedReceiptRefs.has(model.planningReceipt.request_ref)"
            :receipt="model.planningReceipt"
            class="mb-3"
            @approve="onApprovePlanning"
            @dismiss="onDismissPlanning"
          />

          <!-- ── 跨防区单位调配在途专席（UNIT-TRANSFER-01） ── -->
          <section
            v-if="model.pendingTransfers && model.pendingTransfers.length > 0"
            class="mb-3 rounded-[3px] border p-2.5"
            data-test="schedule-pending-transfers"
            style="border-color: var(--rac-dim); background: rgba(0, 0, 0, 0.22)"
          >
            <div class="mb-1.5 flex items-center justify-between font-mono text-[11px]">
              <span class="inline-flex items-center gap-1 font-bold text-(--rac-warn)">
                <Icon name="rocket" :size="11" />
                <span>跨基地单位调配进行中 ({{ model.pendingTransfers.length }})</span>
              </span>
              <span style="color: var(--rac-muted)">随战区时钟自动推进交割</span>
            </div>
            <div class="flex flex-col gap-1.5">
              <div
                v-for="tr in model.pendingTransfers"
                :key="tr.id"
                class="flex flex-wrap items-center justify-between gap-2 rounded-[2px] border px-2.5 py-1.5 text-[11px]"
                style="border-color: var(--rac-dim); background: var(--rac-panel)"
              >
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="font-bold">{{ tr.unit }}</span>
                  <span v-if="tr.category !== 'girls'" class="font-mono font-bold text-(--rac-line)">
                    ×{{ tr.qty }}
                  </span>
                  <span class="font-mono text-[11px]" style="color: var(--rac-muted)">
                    [{{ tr.fromBase }} → {{ tr.toBase }}]
                  </span>
                  <span
                    v-if="tr.method"
                    class="rounded-[2px] border px-1.5 py-0.2 font-mono text-[11px]"
                    style="border-color: var(--rac-dim); color: var(--rac-line)"
                  >
                    {{ tr.method }}
                  </span>
                </div>
                <div class="flex items-center gap-2 font-mono text-[11px]">
                  <span class="text-(--rac-warn)">进度 {{ tr.progress }}%</span>
                  <span class="font-bold text-(--rac-ok)">剩余 {{ tr.etaText }}</span>
                </div>
              </div>
            </div>
          </section>

          <div v-if="model.allEmpty" class="sch-empty" :data-empty-copy="model.allEmptyText">
            <div class="sch-empty-banner">
              <span class="sch-empty-tag">[工程调度室]</span>
              <span class="sch-empty-text">当前各基地与科研部门均无进行中的任务</span>
            </div>
          </div>

          <!-- ══ 视图 A：基地 → 产线双模左栏 + 多轨时间轴甘特右栏 ══ -->
          <div v-if="viewMode === 'base'" class="flex flex-col gap-3">
            <section
              v-for="(base, bi) in displayedBases"
              :key="base.key"
              class="sch-base-panel rounded-[3px] border p-2.5"
              :class="{ 'sch-base-panel--retired': base.retired }"
              style="border-color: var(--rac-dim); background: rgba(0, 0, 0, 0.2)"
            >
              <button
                type="button"
                class="sch-base-toggle sch-base-header w-full"
                :aria-expanded="!isCollapsed(base.key)"
                :aria-controls="`sch-base-body-${bi}`"
                @click="toggleBase(base.key)"
              >
                <span class="flex min-w-0 items-center gap-1.5">
                  <Icon
                    :name="isCollapsed(base.key) ? 'chevron-right' : 'chevron-down'"
                    :size="12"
                    class="flex-none"
                    style="color: var(--rac-muted)"
                  />
                  <span class="truncate text-[12.5px] font-bold tracking-wide">{{ base.name }}</span>
                  <span v-if="base.retired" class="sch-retired-badge flex-none">废弃</span>
                </span>
                <span class="flex flex-none items-center gap-2">
                  <span class="sch-base-meta font-mono text-[11px]">
                    进行 {{ baseActiveCount(base) }} · 排队 {{ baseQueuedCount(base) }}
                  </span>
                  <span class="sch-base-tag hidden md:inline">基地施工队列</span>
                </span>
              </button>

              <div v-if="!isCollapsed(base.key)" :id="`sch-base-body-${bi}`">
                <div v-if="base.empty" class="sch-empty-line">
                  <span class="sch-empty-bullet">·</span>
                  <span>（当前无进行中的建造、生产或改装任务）</span>
                </div>

                <div v-else class="mt-2 flex flex-col gap-2">
                  <!-- 时间轴公共刻度顶冠（F10 分栏表头 + T0 当前时刻浅亮衬底） -->
                  <div
                    data-test="schedule-gantt-axis-header"
                    class="hidden items-stretch rounded-[2px] border border-(--rac-dim)/60 bg-(--rac-panel-2) font-mono text-[11px] md:grid md:grid-cols-12"
                  >
                    <div class="col-span-4 flex items-center border-r border-(--rac-dim)/60 px-2.5 py-1 text-(--rac-muted)">
                      产线工位与双模调速舱
                    </div>
                    <div class="col-span-8 flex flex-col justify-center px-2 py-1">
                      <div class="grid grid-cols-4 gap-1 sm:grid-cols-6">
                        <div
                          v-for="seg in ganttAxis.segments.slice(0, 6)"
                          :key="seg.index"
                          class="sch-axis-seg truncate rounded-[2px] px-1.5 py-0.5 text-[11px]"
                          :class="{ 'sch-axis-seg--origin': seg.isOriginSegment }"
                        >
                          {{ seg.isOriginSegment ? `T0 (${ganttAxis.originLabel})` : seg.label }}
                        </div>
                      </div>
                      <div class="mt-0.5 flex items-center justify-between text-[11px] text-(--rac-line)">
                        <span>T0 ({{ ganttAxis.originLabel }})</span>
                        <span v-for="tick in ganttAxis.ticks.slice(1)" :key="tick.offsetMin">{{ tick.label }}</span>
                      </div>
                    </div>
                  </div>

                  <div
                    v-for="lane in displayedBaseLanes(base)"
                    :key="lane.key"
                    class="sch-lane-card grid grid-cols-1 gap-2 rounded-[3px] border p-2 md:grid-cols-12"
                    :class="{ 'sch-lane--stranded': lane.stranded }"
                    :data-lane-key="lane.key"
                    :data-lane-domain="lane.domain"
                    style="border-color: var(--rac-dim); background: var(--rac-panel)"
                  >
                    <!-- 左栏：产线工位与内嵌双模调速舱 -->
                    <div
                      data-test="schedule-lane-dualmode"
                      class="flex flex-col justify-between gap-1.5 border-b border-(--rac-dim)/60 pb-2 md:col-span-4 md:border-r md:border-b-0 md:pr-2.5 md:pb-0"
                    >
                      <div>
                        <div class="flex flex-wrap items-center justify-between gap-1">
                          <span class="sch-lane-name text-[11.5px]">{{ lane.name }}</span>
                          <span class="sch-lane-meta text-[11px]">
                            占用 {{ lane.activeCount }}/{{ lane.capacity
                            }}<template v-if="lane.queuedCount > 0"> · 排队 {{ lane.queuedCount }}</template>
                          </span>
                        </div>
                        <div v-if="lane.stranded" class="sch-stranded mt-0.5 text-[11px]">
                          缺少对应生产建筑，队列已暂停
                        </div>
                        <div
                          v-else-if="
                            lane.dualModeSummary?.dualModeCapable &&
                            lane.dualModeSummary.productionCount === 0 &&
                            lane.dualModeSummary.accelCount > 0
                          "
                          class="sch-stranded mt-0.5 text-[11px]"
                        >
                          全加速运转中（无生产工位，候列暂停推进）
                        </div>
                      </div>

                      <!-- 双模建筑分布与快捷调速按钮 -->
                      <div
                        v-if="lane.dualModeSummary?.dualModeCapable"
                        class="flex flex-col gap-1 rounded-[2px] border border-(--rac-dim)/60 bg-(--rac-bg) p-1.5 font-mono text-[11px]"
                      >
                        <div class="flex flex-wrap items-center justify-between gap-1">
                          <span class="inline-flex items-center gap-1 text-(--rac-muted)">
                            <Icon name="gear" :size="11" />
                            <span>生产×{{ lane.dualModeSummary.productionCount }} · 加速×{{ lane.dualModeSummary.accelCount }}</span>
                          </span>
                          <span class="sch-accel-pill inline-flex items-center gap-1 rounded-[2px] px-1 py-0.2 font-bold">
                            <Icon name="rocket" :size="11" />
                            <span>加速 {{ (lane.dualModeSummary.accelMultiplier ?? 1).toFixed(2) }}x</span>
                          </span>
                        </div>
                        <div
                          v-for="(inst, idx) in lane.dualModeSummary.instances"
                          :key="`${inst.baseIndex}-${inst.buildingIndex}`"
                          class="flex flex-wrap items-center justify-between gap-1 border-t border-(--rac-dim)/40 pt-1"
                        >
                          <span class="truncate text-(--rac-text)">#{{ idx + 1 }} {{ inst.name }}</span>
                          <div class="flex items-center gap-1">
                            <button
                              type="button"
                              data-test="schedule-dualmode-btn"
                              class="sch-dualmode-btn rounded-[2px] border px-1.5 py-0.2 text-[11px] font-semibold transition-colors"
                              :class="inst.mode === '加速' ? 'sch-dualmode-btn--accel' : 'sch-dualmode-btn--prod'"
                              @click.stop="onToggleBuildingMode(inst)"
                            >
                              {{ inst.mode === '加速' ? '切回生产' : '切为加速' }}
                            </button>
                            <button
                              v-if="inst.mode === '加速'"
                              type="button"
                              data-test="schedule-dualmode-scope-btn"
                              class="rounded-[2px] border border-(--rac-dim) bg-(--rac-panel-2) px-1 py-0.2 text-[11px] text-(--rac-muted) hover:text-(--rac-hi)"
                              @click.stop="onToggleBuildingScope(inst)"
                            >
                              {{ inst.accelScope === 'base' ? '仅本基地' : '战区全局' }}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- 右栏：按工位成轨的 F10 战术网格块面甘特排程区 -->
                    <div
                      data-test="schedule-gantt-track-lane"
                      class="flex flex-col justify-center gap-1.5 md:col-span-8"
                    >
                      <div
                        v-for="subTrack in subTracksForLane(lane)"
                        :key="subTrack.trackIndex"
                        data-test="schedule-gantt-subtrack"
                        class="sch-subtrack-row flex items-stretch gap-1.5"
                      >
                        <div class="sch-subtrack-badge flex w-[64px] flex-none flex-col justify-center rounded-[2px] px-1.5 py-1 font-mono text-[11px]">
                          <span class="font-bold text-(--rac-line)">{{ subTrack.label }}</span>
                          <span class="truncate text-[11px] text-(--rac-muted)">{{ subTrack.freeAtText }}</span>
                        </div>

                        <div
                          class="sch-subtrack-timeline relative min-h-[38px] flex-1 overflow-hidden rounded-[2px] border border-(--rac-dim)/70"
                          :class="{ 'sch-subtrack-timeline--blocked': lane.stranded }"
                        >
                          <!-- 贯穿式竖向时间虚线网格 + T0 原点标尺 -->
                          <div class="pointer-events-none absolute inset-0 z-0">
                            <span class="sch-grid-origin-line absolute top-0 bottom-0 left-0" />
                            <span
                              v-for="tick in ganttAxis.ticks.slice(1)"
                              :key="tick.offsetMin"
                              data-test="schedule-gantt-gridline"
                              class="sch-grid-line absolute top-0 bottom-0"
                              :style="{ left: `${tick.pct}%` }"
                            />
                          </div>

                          <!-- 45° 斜线空闲/候列阴影区 -->
                          <div
                            v-if="subTrackFreeZoneStyle(subTrack)"
                            data-test="schedule-gantt-hatch"
                            class="sch-hatch-zone pointer-events-none absolute top-0 bottom-0 z-0"
                            :class="lane.stranded ? 'sch-hatch-zone--alert' : 'sch-hatch-zone--dim'"
                            :style="subTrackFreeZoneStyle(subTrack)!"
                          />

                          <!-- 空闲工位提示 -->
                          <div
                            v-if="subTrack.rows.length === 0"
                            class="relative z-10 flex h-full min-h-[36px] items-center px-2 font-mono text-[11px] text-(--rac-muted)"
                          >
                            {{ lane.stranded ? '工位受阻停摆 · 待前置建筑恢复' : '产线工位空闲 · 待命接单' }}
                          </div>

                          <!-- 同工位水平接力甘特任务色块 -->
                          <div
                            v-for="txn in subTrack.rows"
                            :key="txn.taskId ?? txn.item"
                            data-test="schedule-gantt-block"
                            class="sch-txn sch-gantt-block group absolute top-[2px] bottom-[2px] z-10 flex cursor-pointer items-center rounded-[2px] px-2 transition-all"
                            :class="[
                              SCH_BLOCK_CATEGORY_CLASS[blockCategoryFor(txn)],
                              { 'sch-gantt-block--selected': isSelectedTxn(txn) },
                            ]"
                            :data-task-id="txn.taskId"
                            :data-block-category="blockCategoryFor(txn)"
                            :style="ganttSpanStyle(txn)"
                            @click="selectTxn(txn, lane.capacity)"
                          >
                            <!-- 色块内嵌已完成进度填充层（保持 schedule-gantt-bar 契约） -->
                            <div
                              data-test="schedule-gantt-bar"
                              class="sch-gantt-bar pointer-events-none absolute top-0 bottom-0 left-0 transition-all"
                              :class="SCH_GANTT_STATE_CLASS[txn.ganttState]"
                              :data-gantt-state="txn.ganttState"
                              :data-gantt-pct="txn.ganttPct"
                              :style="{ width: `${txn.ganttPct}%` }"
                            />

                            <!-- 色块内嵌文字（窄块自动向右延展不截断） -->
                            <div class="sch-gantt-block-content relative z-10 flex min-w-0 flex-1 items-center justify-between gap-2">
                              <div class="flex min-w-0 items-center gap-1.5">
                                <span class="sch-tone-dot" :class="SCH_TONE_CLASS[txn.tone]" />
                                <span class="sch-txn-item truncate text-[11px]" :title="txn.item">{{ txn.item }}</span>
                                <span v-if="txn.batchText" class=" font-mono text-[11px] text-(--rac-warn)">
                                  [{{ txn.batchText }}]
                                </span>
                                <span class="sch-txn-pred truncate text-[11px]" :title="txn.predicate">
                                  {{ txn.predicate }}
                                </span>
                              </div>
                              <div class="flex flex-none items-center gap-1.5">
                                <span class="font-mono text-[11px] font-bold text-(--rac-hi)">{{ txn.ganttPct }}%</span>
                                <span v-if="txn.endEtaText" class="font-mono text-[11px] text-(--rac-muted)">
                                  预计完工: {{ txn.endEtaText }}
                                </span>
                              </div>
                            </div>

                            <!-- 悬浮/选中快捷操作胶囊（保持 SSR 与 aria-label 契约） -->
                            <span
                              class="sch-verbs sch-verbs--floating"
                              role="group"
                              :aria-label="dispatchGroupLabel(txn.item)"
                            >
                              <button
                                v-for="btn in dispatchVerbsFor(txn)"
                                :key="btn.verb"
                                type="button"
                                class="sch-verb-btn"
                                :class="{ 'sch-verb-btn--armed': btn.armed }"
                                :disabled="!btn.enabled"
                                :aria-label="`${btn.verb}「${txn.item}」`"
                                :title="btn.hint"
                                @click.stop="onDispatch(btn.verb, txn, lane.capacity)"
                              >
                                {{ btn.verb }}
                              </button>
                            </span>
                          </div>
                        </div>
                      </div>

                      <!-- 可选展开：后续工程阶段拓扑虚线预览块（默认关闭，SSR 不混入） -->
                      <template v-if="showDraftChain && lane.draftPreviews && lane.draftPreviews.length > 0">
                        <div
                          v-for="draft in lane.draftPreviews"
                          :key="draft.taskId ?? draft.item"
                          data-test="schedule-draft-preview-row"
                          class="sch-draft-row flex flex-col gap-1 rounded-[2px] border border-dashed px-2 py-1 text-[11px]"
                        >
                          <div class="flex items-center justify-between gap-2">
                            <span class="inline-flex items-center gap-1 font-semibold text-(--rac-accent)">
                              <Icon name="layers" :size="11" />
                              <span>{{ draft.item }}</span>
                            </span>
                            <span class="font-mono text-[11px] text-(--rac-muted)">
                              待前序完工解锁 · {{ draft.startEtaText }} → {{ draft.endEtaText }}
                            </span>
                          </div>
                        </div>
                      </template>
                    </div>
                  </div>

                  <div
                    v-if="onlyActiveLanes && hiddenIdleLaneCount(base) > 0"
                    class="flex items-center justify-between rounded-[2px] border border-dashed border-(--rac-dim) px-2.5 py-1 font-mono text-[11px] text-(--rac-muted)"
                  >
                    <span>▸ 已折叠 {{ hiddenIdleLaneCount(base) }} 条空闲或未建产线</span>
                    <button type="button" class="text-(--rac-line) hover:underline" @click="onlyActiveLanes = false">
                      展开全部产线
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <!-- ══ 视图 B：五大业务领域跨基地汇总甘特视图 ══ -->
          <div
            v-show="viewMode === 'domain'"
            data-test="schedule-domain-view"
            class="flex flex-col gap-2.5"
          >
            <template v-if="viewMode === 'domain'">
            <section
              v-for="grp in filteredDomainGroups"
              :key="grp.id"
              :data-domain-group="grp.id"
              class="rounded-[3px] border border-(--rac-dim) bg-(--rac-panel) p-2.5"
            >
              <div class="sch-base-header flex items-center justify-between pb-1.5">
                <span class="text-[12px] font-bold">{{ grp.label }}</span>
                <span class="font-mono text-[11px] text-(--rac-muted)">
                  进行 {{ grp.activeCount }} · 排队 {{ grp.queuedCount }}
                </span>
              </div>
              <div v-if="grp.rows.length === 0" class="sch-empty-line text-[11px]">
                <span class="sch-empty-bullet">·</span>
                <span>该领域当前无在途或候列工程</span>
              </div>
              <div v-else class="mt-1.5 flex flex-col gap-1.5">
                <div
                  v-for="txn in grp.rows"
                  :key="txn.taskId ?? `${txn.base}-${txn.item}`"
                  class="sch-subtrack-timeline relative min-h-[36px] overflow-hidden rounded-[2px] border border-(--rac-dim)/70"
                >
                  <div class="pointer-events-none absolute inset-0 z-0">
                    <span class="sch-grid-origin-line absolute top-0 bottom-0 left-0" />
                    <span
                      v-for="tick in ganttAxis.ticks.slice(1)"
                      :key="tick.offsetMin"
                      class="sch-grid-line absolute top-0 bottom-0"
                      :style="{ left: `${tick.pct}%` }"
                    />
                  </div>
                  <div
                    class="sch-txn sch-gantt-block group absolute top-[2px] bottom-[2px] z-10 flex cursor-pointer items-center rounded-[2px] px-2 transition-all"
                    :class="[
                      SCH_BLOCK_CATEGORY_CLASS[blockCategoryFor(txn)],
                      { 'sch-gantt-block--selected': isSelectedTxn(txn) },
                    ]"
                    :style="ganttSpanStyle(txn)"
                    @click="selectTxn(txn)"
                  >
                    <div
                      class="sch-gantt-bar pointer-events-none absolute top-0 bottom-0 left-0"
                      :class="SCH_GANTT_STATE_CLASS[txn.ganttState]"
                      :style="{ width: `${txn.ganttPct}%` }"
                    />
                    <div class="sch-gantt-block-content relative z-10 flex min-w-0 flex-1 items-center justify-between gap-2">
                      <div class="flex min-w-0 items-center gap-1.5">
                        <span v-if="txn.base" class="rounded-[2px] bg-(--rac-panel-2) px-1 py-0.2 font-mono text-[11px] text-(--rac-line)">
                          [{{ txn.base }}]
                        </span>
                        <span class="sch-tone-dot" :class="SCH_TONE_CLASS[txn.tone]" />
                        <span class="sch-txn-item text-[11px]">{{ txn.item }}</span>
                        <span class="sch-txn-pred truncate text-[11px]">{{ txn.predicate }}</span>
                      </div>
                      <span v-if="txn.endEtaText" class="font-mono text-[11px] text-(--rac-muted)">
                        预计完工: {{ txn.endEtaText }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            </template>
          </div>

          <!-- ══ 视图 C：紧凑工单管理表 ══ -->
          <div
            v-show="viewMode === 'table'"
            data-test="schedule-table-view"
            class="overflow-x-auto rounded-[3px] border border-(--rac-dim) bg-(--rac-panel)"
          >
            <table v-if="viewMode === 'table'" class="w-full border-collapse text-left font-mono text-[11px]">
              <thead>
                <tr class="border-b border-(--rac-dim) bg-(--rac-panel-2) text-(--rac-muted)">
                  <th class="px-2.5 py-1.5">属地</th>
                  <th class="px-2.5 py-1.5">类型</th>
                  <th class="px-2.5 py-1.5">项目名称</th>
                  <th class="px-2.5 py-1.5">状态谓语</th>
                  <th class="px-2.5 py-1.5">完成度</th>
                  <th class="px-2.5 py-1.5">预计完工</th>
                  <th class="px-2.5 py-1.5">调度操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="allTableRows.length === 0">
                  <td colspan="7" class="px-3 py-3 text-center text-(--rac-muted)">当前无在途或排队工单</td>
                </tr>
                <tr
                  v-for="txn in allTableRows"
                  :key="txn.taskId ?? `${txn.base}-${txn.item}`"
                  class="cursor-pointer border-b border-(--rac-dim)/40 hover:bg-(--rac-panel-2)"
                  @click="selectTxn(txn)"
                >
                  <td class="px-2.5 py-1.5 text-(--rac-line)">{{ txn.base || '战区全局' }}</td>
                  <td class="px-2.5 py-1.5 text-(--rac-muted)">{{ txn.type }}</td>
                  <td class="px-2.5 py-1.5 font-semibold text-(--rac-text)">{{ txn.item }}</td>
                  <td class="px-2.5 py-1.5 text-(--rac-muted)">{{ txn.predicate }}</td>
                  <td class="px-2.5 py-1.5 text-(--rac-warn)">{{ txn.ganttPct }}%</td>
                  <td class="px-2.5 py-1.5 text-(--rac-muted)">{{ txn.endEtaText || '-' }}</td>
                  <td class="px-2.5 py-1.5">
                    <span class="sch-verbs">
                      <button
                        v-for="btn in dispatchVerbsFor(txn)"
                        :key="btn.verb"
                        type="button"
                        class="sch-verb-btn"
                        :class="{ 'sch-verb-btn--armed': btn.armed }"
                        :disabled="!btn.enabled"
                        :title="btn.hint"
                        @click.stop="onDispatch(btn.verb, txn)"
                      >
                        {{ btn.verb }}
                      </button>
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- ══ 战区科研调度专席 ══ -->
          <section
            v-show="showResearchSection"
            class="sch-base mt-4 border-t pt-3"
            style="border-color: var(--rac-dim)"
          >
            <div class="sch-base-header sch-research-header">
              <span>战区科研队列</span>
              <span class="sch-base-tag">各领域研究组</span>
            </div>
            <div
              v-for="slot in model.researchSlots"
              :key="slot.key"
              class="sch-lane"
              :class="{ 'sch-lane--locked': !slot.unlocked }"
              :data-lane-key="slot.key"
              :data-lane-domain="slot.domain"
            >
              <div class="sch-lane-header">
                <span class="sch-lane-name">{{ slot.name.replace(/研究序列$/, '研究组') }}</span>
                <span v-if="slot.unlocked" class="sch-lane-meta">
                  进行 {{ slot.activeItems.length }}/{{ slot.limit
                  }}<template v-if="slot.queuedCount > 0"> · 排队 {{ slot.queuedCount }}</template>
                </span>
                <span v-else class="sch-locked-reason">{{ slot.lockedReason?.replace(/，序列未开通$/, '，暂未开放') }}</span>
              </div>
              <div
                v-for="txn in slot.txns"
                :key="txn.taskId ?? txn.item"
                class="sch-txn cursor-pointer"
                :data-task-id="txn.taskId"
                @click="selectTxn(txn, slot.limit)"
              >
                <span class="sch-tone-dot" :class="SCH_TONE_CLASS[txn.tone]" />
                <span class="sch-txn-item">{{ txn.item }}</span>
                <span class="sch-txn-pred">{{ txn.predicate }}</span>
                <span class="sch-verbs" role="group" :aria-label="dispatchGroupLabel(txn.item)">
                  <button
                    v-for="btn in dispatchVerbsFor(txn)"
                    :key="btn.verb"
                    type="button"
                    class="sch-verb-btn"
                    :class="{ 'sch-verb-btn--armed': btn.armed }"
                    :disabled="!btn.enabled"
                    :aria-label="`${btn.verb}「${txn.item}」`"
                    :title="btn.hint"
                    @click.stop="onDispatch(btn.verb, txn, slot.limit)"
                  >
                    {{ btn.verb }}
                  </button>
                </span>
                <div class="sch-gantt-track mt-1 h-[4px] w-full basis-full overflow-hidden rounded-[2px]">
                  <div
                    data-test="schedule-gantt-bar"
                    class="sch-gantt-bar h-full transition-all"
                    :class="SCH_GANTT_STATE_CLASS[txn.ganttState]"
                    :data-gantt-state="txn.ganttState"
                    :data-gantt-pct="txn.ganttPct"
                    :style="{ width: `${txn.ganttPct}%` }"
                  />
                </div>
              </div>
            </div>
          </section>

          <!-- ══ 统帅部条令攻关队列 ══ -->
          <section
            v-if="model.protocolLane.enabled || model.protocolLane.items.length > 0"
            data-test="schedule-protocol-lane"
            :data-lane-key="model.protocolLane.laneKey"
            class="sch-protocol-lane mt-4 rounded-[3px] border p-2.5"
            style="border-color: var(--rac-dim); background: rgba(0, 0, 0, 0.2)"
          >
            <div class="sch-base-header flex flex-wrap items-center justify-between gap-2 pb-1.5">
              <div class="flex items-center gap-2">
                <span class="text-[12px] font-bold tracking-wide">统帅部条令攻关队列</span>
                <span class="sch-base-tag">条令攻关进度</span>
              </div>
              <div class="flex items-center gap-2 font-mono text-[11px]" style="color: var(--rac-muted)">
                <span>{{
                  model.protocolLane.institutesText === '战地参谋部基础推演（尚无专属科研院所在役）'
                    ? '基础推演（尚未建成科研院所）'
                    : model.protocolLane.institutesText
                }}</span>
                <span>·</span>
                <span>
                  协议点 {{ model.protocolLane.protocolPoints.toFixed(2) }}（+{{
                    model.protocolLane.dailyRate.toFixed(2)
                  }}/日）
                </span>
              </div>
            </div>

            <div v-if="model.protocolLane.items.length > 0" class="mt-1.5 flex flex-col gap-1.5">
              <div
                v-for="proto in model.protocolLane.items"
                :key="proto.ref"
                class="sch-proto-row flex flex-col gap-1 rounded-[2px] px-2 py-1.5 text-[11px]"
                :data-protocol-ref="proto.ref"
                style="background: rgba(0, 0, 0, 0.25)"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex min-w-0 items-center gap-1.5">
                    <span class="sch-proto-order rounded-[2px] px-1 py-0.5 font-mono text-[11px] font-bold">
                      #{{ proto.queue_order }}
                    </span>
                    <span class="font-bold">{{ proto.name }}</span>
                    <span class="sch-proto-track rounded-[2px] px-1.5 py-0.5 font-mono text-[11px]">
                      {{ proto.track }}
                    </span>
                    <span v-if="proto.hold" class="sch-retired-badge">暂缓</span>
                  </div>
                  <div class="flex items-center gap-2 font-mono text-[11px]">
                    <span>经验 {{ proto.exp }}%</span>
                    <span>·</span>
                    <span>突破率 {{ proto.next_prob_pct }}%</span>
                    <span>·</span>
                    <span>顺位 #{{ proto.queue_order }}</span>
                  </div>
                </div>
                <div class="sch-gantt-track h-[4px] w-full overflow-hidden rounded-[2px]">
                  <div
                    class="sch-gantt-bar h-full transition-all"
                    :class="proto.hold ? 'sch-gantt-bar--paused' : 'sch-gantt-bar--active'"
                    :style="{ width: `${proto.exp}%` }"
                  />
                </div>
              </div>
            </div>
            <div v-else class="sch-empty-line mt-1 text-[11px]">
              <span class="sch-empty-bullet">·</span>
              <span>当前没有正在攻关或排队的条令</span>
            </div>
          </section>

          <!-- ══ 底部 F10 语义图例栏（空心圆环 + 45° 斜线纹理说明） ══ -->
          <div
            data-test="schedule-gantt-legend"
            class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[2px] border border-(--rac-dim)/60 bg-(--rac-panel) px-3 py-1.5 font-mono text-[11px] text-(--rac-muted)"
          >
            <div class="flex flex-wrap items-center gap-3">
              <span
                v-for="leg in GANTT_LEGEND_ITEMS"
                :key="leg.key"
                class="inline-flex items-center gap-1.5"
              >
                <span class="sch-legend-ring" :class="leg.swatchClass" aria-hidden="true" />
                <span>{{ leg.label }}</span>
              </span>
              <span class="inline-flex items-center gap-1.5">
                <span class="sch-legend-hatch" aria-hidden="true" />
                <span>排程候列/空闲</span>
              </span>
            </div>
            <span class="text-[11px] text-(--rac-line)">悬停或点击任务块可唤出快捷调度胶囊</span>
          </div>
        </div>

        <!-- ── 区域 5：底部选中工单调度台与参谋指令托盘 ── -->
        <footer class="border-t border-(--rac-dim) bg-(--rac-panel) px-4 py-2 text-[11px]">
          <div
            data-test="schedule-task-inspector"
            class="flex flex-wrap items-center justify-between gap-2"
          >
            <div v-if="activeInspectorTxn" class="flex min-w-0 flex-wrap items-center gap-2 font-mono text-[11px]">
              <span class="sch-inspector-badge inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5 font-bold">
                <Icon name="wrench" :size="11" />
                <span>工单调度台</span>
              </span>
              <span class="font-bold text-(--rac-hi)">「{{ activeInspectorTxn.item }}」</span>
              <span class="text-(--rac-muted)">属地: {{ activeInspectorTxn.base || '战区科研' }}</span>
              <span class="text-(--rac-muted)">进度: {{ activeInspectorTxn.ganttPct }}%</span>
              <span v-if="activeInspectorTxn.effectiveAccel" class="text-(--rac-warn)">
                倍率: {{ activeInspectorTxn.effectiveAccel.toFixed(2) }}x
              </span>
              <span v-if="activeInspectorTxn.endEtaText" class="text-(--rac-line)">
                预计完工: {{ activeInspectorTxn.endEtaText }}
              </span>
            </div>
            <div v-else class="inline-flex items-center gap-1 font-mono text-[11px] text-(--rac-muted)">
              <Icon name="wrench" :size="11" />
              <span>工单调度台：点击任意在途或候列工单可执行置顶、置底、暂缓、恢复、撤销与跨基地改派</span>
            </div>

            <div v-if="activeInspectorTxn" class="flex flex-wrap items-center gap-1.5 font-mono">
              <button
                v-for="ebtn in extendedVerbsFor(activeInspectorTxn)"
                :key="ebtn.verb"
                type="button"
                class="sch-verb-btn px-1.5 py-0.5 text-[11px]"
                :class="{
                  'sch-verb-btn--armed': ebtn.armed,
                  'sch-verb-btn--danger': ebtn.verb === '撤销',
                }"
                :disabled="!ebtn.enabled"
                :data-test="`inspector-verb-${ebtn.verb}`"
                :title="ebtn.hint"
                @click="onExtendedDispatch(ebtn.verb, activeInspectorTxn)"
              >
                {{
                  ebtn.verb === '撤销' && confirmingCancelKey === txnKey(activeInspectorTxn)
                    ? '确认撤销？'
                    : ebtn.verb === '指派'
                      ? '改派基地'
                      : ebtn.verb
                }}
              </button>
              <select
                v-if="visibleBases.length > 0"
                v-model="allocateTargetBase"
                data-test="inspector-allocate-select"
                class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-1.5 py-0.5 text-[11px] text-(--rac-text)"
              >
                <option v-for="b in visibleBases" :key="b.key" :value="b.name">{{ b.name }}</option>
              </select>
              <button
                type="button"
                data-test="inspector-enqueue-tray-btn"
                class="sch-filter-btn text-[11px]"
                @click="enqueueInspectorToTray('置顶', activeInspectorTxn)"
              >
                + 加入指令托盘
              </button>
            </div>
          </div>

          <div
            v-if="trayOpen || commandTray.length > 0"
            data-test="schedule-command-tray"
            class="mt-2 flex flex-col gap-1.5 rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) p-2 font-mono text-[11px]"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="inline-flex items-center gap-1 font-bold text-(--rac-line)">
                <Icon name="send" :size="11" />
                <span>参谋指令托盘（已暂存 {{ commandTray.length }} 项调度变更）</span>
              </span>
              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  data-test="tray-clear-btn"
                  class="sch-filter-btn"
                  :disabled="commandTray.length === 0"
                  @click="clearCommandTray"
                >
                  清空托盘
                </button>
                <button
                  type="button"
                  data-test="tray-fill-btn"
                  class="sch-filter-btn"
                  :disabled="commandTray.length === 0"
                  @click="fillTrayOrdersToInput"
                >
                  填入发送框
                </button>
                <button
                  type="button"
                  data-test="tray-send-btn"
                  class="sch-filter-btn sch-filter-btn--active"
                  :disabled="commandTray.length === 0"
                  @click="sendTrayOrdersNow"
                >
                  立即下达
                </button>
              </div>
            </div>
            <div v-if="commandTray.length === 0" class="text-(--rac-muted)">
              当前托盘为空，关闭「即时编排」或点击「+ 加入指令托盘」可暂存多条变更合并下达
            </div>
            <div v-else class="flex flex-wrap gap-1.5">
              <span
                v-for="item in commandTray"
                :key="item.id"
                class="rounded-[2px] border border-(--rac-dim) bg-(--rac-panel-2) px-1.5 py-0.5 text-(--rac-text)"
              >
                [{{ item.verb }}] {{ item.summary }}
              </span>
            </div>
          </div>
        </footer>
      </section>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import { fillHostSendInput } from '../../红警指挥系统/worldbook/hostSendInput';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import type { PlanningReceipt, Schema } from '../../红警指挥系统/core/schema';
import { SCHEDULE_COPY } from '../../红警指挥系统/planning/scheduleCopy';
import type { DispatchVerb } from '../../红警指挥系统/engines/transactionEngine';
import { useDataStore } from '../../红警指挥系统/composables/store';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { updateFloorVars } from '../host/floorVarWrite';
import {
  DISPATCH_ORDER_COPY,
  dispatchOrderText,
  dispatchVerbButtonsFor,
  extendedDispatchOrderText,
  extendedDispatchVerbButtonsFor,
  formatBatchScheduleOrdersText,
  type ExtendedScheduleVerb,
  type QueuedTrayOrderItem,
} from '../models/dispatchOrderText';
import {
  buildGanttTimeAxis,
  computeGanttBarPosition,
  resolveGanttBlockCategory,
  scheduleLaneSubTracks,
  type DomainScheduleGroup,
  type GanttBlockCategory,
  type GanttHorizonMode,
  type GanttSubTrackRow,
  type LaneDualModeBuildingRef,
  type ScheduleViewMode,
} from '../models/scheduleGanttModel';
import {
  formatPlanningApprovalOrderText,
  schedulePanelModel,
  type ScheduleBaseSection,
  type ScheduleProdLaneRow,
  type ScheduleSlotRow,
  type ScheduleTxnRow,
} from '../models/schedulePanelModel';
import {
  executeInstantScheduleMutation,
  toggleScheduleLaneBuildingMode,
  toggleScheduleLaneBuildingScope,
} from './modalScheduleHelpers';
import { useTacticalModalMotion } from '../../红警指挥系统/ui/motion/useGsapMotion';

const PanelPlanningCard = defineAsyncComponent(() => import('../panels/PanelPlanningCard.vue').then(m => m.default));

const props = defineProps<{
  open: boolean;
  snapshot: Schema | null;
}>();

defineEmits<{
  (e: 'close'): void;
}>();

const backdropRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
useTacticalModalMotion(panelRef, backdropRef, { open: () => props.open });

const catalog = useCatalogStore();
const baseEmptyText = SCHEDULE_COPY.baseEmpty;
void baseEmptyText;

const editTick = ref(0);
const model = computed(() => (void editTick.value, schedulePanelModel(props.snapshot ?? {}, catalog.effectiveCatalog)));

const viewMode = ref<ScheduleViewMode>('base');
const horizonMode = ref<GanttHorizonMode>('auto');
const instantMode = ref(true);
const trayOpen = ref(false);
const onlyActiveLanes = ref(true);
const showDraftChain = ref(false);
const activeBaseKey = ref<string | null>(null);
const showRetired = ref(false);
const showResearchSection = ref(false);

const HORIZON_OPTIONS: ReadonlyArray<{ mode: GanttHorizonMode; label: string }> = [
  { mode: '72h', label: '3天 (72h)' },
  { mode: '7d', label: '7天 (1周)' },
  { mode: '30d', label: '30天 (1月)' },
  { mode: 'auto', label: '自适应全景' },
];

const GANTT_LEGEND_ITEMS: ReadonlyArray<{ key: string; label: string; swatchClass: string }> = [
  { key: 'construction', label: '建造工程', swatchClass: 'sch-legend-ring--construction' },
  { key: 'production', label: '军工生产', swatchClass: 'sch-legend-ring--production' },
  { key: 'research', label: '科研攻关', swatchClass: 'sch-legend-ring--research' },
  { key: 'retrofit', label: '改装/巨构', swatchClass: 'sch-legend-ring--retrofit' },
  { key: 'paused', label: '暂停/受阻', swatchClass: 'sch-legend-ring--paused' },
];

const retiredCount = computed(() => model.value.bases.filter(b => b.retired).length);

const collapsedBases = ref(new Set<string>());
function toggleBase(key: string) {
  const s = collapsedBases.value;
  if (s.has(key)) s.delete(key);
  else s.add(key);
}
function isCollapsed(key: string) {
  return collapsedBases.value.has(key);
}

function baseActiveCount(base: ScheduleBaseSection) {
  return base.lanes.reduce((acc, l) => acc + l.activeCount, 0);
}
function baseQueuedCount(base: ScheduleBaseSection) {
  return base.lanes.reduce((acc, l) => acc + l.queuedCount, 0);
}

const visibleBases = computed(() =>
  showRetired.value ? model.value.bases : model.value.bases.filter(b => !b.retired),
);
const displayedBases = computed(() => {
  if (!activeBaseKey.value) return visibleBases.value;
  return visibleBases.value.filter(b => b.key === activeBaseKey.value);
});

function isLaneActiveOrUnlocked(lane: ScheduleProdLaneRow): boolean {
  return (
    lane.capacity > 0 ||
    lane.activeCount > 0 ||
    lane.queuedCount > 0 ||
    lane.txns.length > 0 ||
    lane.stranded ||
    (lane.dualModeSummary?.instances.length ?? 0) > 0
  );
}

function displayedBaseLanes(base: ScheduleBaseSection): ScheduleProdLaneRow[] {
  if (!onlyActiveLanes.value) return base.lanes;
  const active = base.lanes.filter(isLaneActiveOrUnlocked);
  return active.length > 0 ? active : base.lanes;
}

function hiddenIdleLaneCount(base: ScheduleBaseSection): number {
  const active = base.lanes.filter(isLaneActiveOrUnlocked);
  if (active.length === 0) return 0;
  return Math.max(0, base.lanes.length - active.length);
}

const totalActiveTxns = computed(() =>
  model.value.bases.reduce((acc, b) => acc + b.lanes.reduce((lacc, l) => lacc + l.activeCount, 0), 0),
);
const totalQueuedTxns = computed(() =>
  model.value.bases.reduce((acc, b) => acc + b.lanes.reduce((lacc, l) => lacc + l.queuedCount, 0), 0),
);

const kpiSummary = computed(() =>
  model.value.kpiSummary ?? {
    activeStationCount: totalActiveTxns.value,
    totalUnlockedCapacity: model.value.bases.reduce(
      (acc, b) => acc + b.lanes.reduce((lacc, l) => lacc + l.capacity, 0),
      0,
    ),
    acceleratingLaneCount: 0,
    strandedLaneCount: 0,
  },
);

const ganttAxis = computed(() =>
  buildGanttTimeAxis(model.value.clock, horizonMode.value, model.value.maxEndOffsetMin ?? 1440),
);

function ganttSpanStyle(txn: ScheduleTxnRow): Record<string, string> {
  const pos = computeGanttBarPosition(txn.startOffsetMin, txn.endOffsetMin, ganttAxis.value.horizonMinutes);
  return {
    left: `${pos.leftPct}%`,
    width: `${pos.widthPct}%`,
  };
}

function blockCategoryFor(txn: ScheduleTxnRow): GanttBlockCategory {
  return resolveGanttBlockCategory(txn);
}

function subTracksForLane(lane: ScheduleProdLaneRow): GanttSubTrackRow[] {
  if (lane.subTracks && lane.subTracks.length > 0) {
    return lane.subTracks;
  }
  return scheduleLaneSubTracks(
    lane.txns,
    lane.capacity,
    lane.accelMultiplier ?? 1,
    model.value.clock,
  ).subTracks;
}

function subTracksForResearchSlot(slot: ScheduleSlotRow): GanttSubTrackRow[] {
  if (slot.subTracks && slot.subTracks.length > 0) {
    return slot.subTracks;
  }
  return scheduleLaneSubTracks(
    slot.txns,
    slot.limit,
    slot.accelMultiplier ?? 1,
    model.value.clock,
  ).subTracks;
}

function subTrackFreeZoneStyle(subTrack: GanttSubTrackRow): Record<string, string> | null {
  const horizon = ganttAxis.value.horizonMinutes;
  if (!Number.isFinite(horizon) || horizon <= 0) return null;
  if (subTrack.isIdle) {
    return { left: '0%', width: '100%' };
  }
  const freeAt = Math.max(0, subTrack.freeAtMin ?? 0);
  if (freeAt >= horizon) return null;
  const leftPct = Number(Math.min(100, Math.max(0, (freeAt / horizon) * 100)).toFixed(2));
  const widthPct = Number(Math.max(0, 100 - leftPct).toFixed(2));
  if (widthPct < 4) return null;
  return {
    left: `${leftPct}%`,
    width: `${widthPct}%`,
  };
}

const visibleBaseNames = computed(() => new Set(visibleBases.value.map(b => b.name)));

const filteredDomainGroups = computed<DomainScheduleGroup[]>(() => {
  const groups = model.value.domainGroups ?? [];
  if (showRetired.value && !activeBaseKey.value) return groups;
  return groups.map(g => {
    const rows = g.rows.filter(r => !r.base || visibleBaseNames.value.has(r.base));
    return {
      ...g,
      rows,
    };
  });
});

const allTableRows = computed<ScheduleTxnRow[]>(() => {
  const baseRows = displayedBases.value.flatMap(b => b.lanes.flatMap(l => l.txns));
  const researchRows = model.value.researchSlots.flatMap(s => s.txns);
  return [...baseRows, ...researchRows];
});

const selectedTxnKey = ref<string | null>(null);
const selectedTxnCapacity = ref<number>(1);
const confirmingCancelKey = ref<string | null>(null);
const allocateTargetBase = ref<string>('');
const commandTray = ref<QueuedTrayOrderItem[]>([]);
let traySeq = 0;

function txnKey(txn: ScheduleTxnRow): string {
  return txn.taskId || `${txn.type}::${txn.base}::${txn.item}`;
}

function isSelectedTxn(txn: ScheduleTxnRow): boolean {
  return activeInspectorTxn.value !== null && txnKey(activeInspectorTxn.value) === txnKey(txn);
}

const activeInspectorTxn = computed<ScheduleTxnRow | null>(() => {
  const pool = allTableRows.value;
  if (pool.length === 0) return null;
  if (selectedTxnKey.value) {
    const found = pool.find(t => txnKey(t) === selectedTxnKey.value);
    if (found) return found;
  }
  return pool.find(t => t.status === 'active') ?? pool[0] ?? null;
});

function selectTxn(txn: ScheduleTxnRow, capacity = 1) {
  selectedTxnKey.value = txnKey(txn);
  selectedTxnCapacity.value = Math.max(1, capacity);
  confirmingCancelKey.value = null;
  if (!allocateTargetBase.value && visibleBases.value.length > 0) {
    allocateTargetBase.value = txn.base || visibleBases.value[0].name;
  }
}

const dismissedReceiptRefs = ref(new Set<string>());

function onDismissPlanning(refId: string) {
  const next = new Set(dismissedReceiptRefs.value);
  next.add(refId);
  dismissedReceiptRefs.value = next;
}

async function showToast(message: string, kind: 'success' | 'warning' = 'success') {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    const toastr = await Promise.race([
      import('toastr').then(m => m.default),
      new Promise<null>(resolve => {
        timer = globalThis.setTimeout(() => resolve(null), 1500);
      }),
    ]);
    if (toastr && typeof toastr[kind] === 'function') {
      toastr[kind](message, '参谋部排产方案');
      return;
    }
  } catch {
    // 非宿主或测试环境降级静默留痕
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
  console.info(`[参谋部排产方案] ${message}`);
}

function onApprovePlanning(receipt: PlanningReceipt) {
  const orderText = formatPlanningApprovalOrderText(receipt);
  const channel = fillHostSendInput(orderText);
  if (channel === 'failed') {
    void showToast('宿主输入栏与 /setinput 均不可达，批准指令未载入', 'warning');
    return;
  }
  void showToast(`参谋方案 #${receipt.request_ref || '未编号'} 已填入发送框，请确认后发送`, 'success');
}

const dispatchVerbsFor = dispatchVerbButtonsFor;
const dispatchGroupLabel = DISPATCH_ORDER_COPY.groupLabel;

function extendedVerbsFor(txn: ScheduleTxnRow) {
  return extendedDispatchVerbButtonsFor({
    status: txn.status,
    hold: txn.hold,
    canAllocate: txn.type !== '研究' && visibleBases.value.length > 0,
  });
}

const SCH_TONE_CLASS: Record<ScheduleTxnRow['tone'], string> = {
  run: 'sch-tone--run',
  idle: 'sch-tone--idle',
  hold: 'sch-tone--hold',
  ready: 'sch-tone--ready',
  ok: 'sch-tone--ok',
  dead: 'sch-tone--dead',
};

const SCH_GANTT_STATE_CLASS: Record<ScheduleTxnRow['ganttState'], string> = {
  active: 'sch-gantt-bar--active',
  queued: 'sch-gantt-bar--queued',
  paused: 'sch-gantt-bar--paused',
  settling: 'sch-gantt-bar--settling',
  done: 'sch-gantt-bar--done',
};

const SCH_BLOCK_CATEGORY_CLASS: Record<GanttBlockCategory, string> = {
  construction: 'sch-gantt-block--construction',
  production: 'sch-gantt-block--production',
  research: 'sch-gantt-block--research',
  retrofit: 'sch-gantt-block--retrofit',
  paused: 'sch-gantt-block--paused',
};

function getSafeFloating() {
  try {
    return useFloatingStore();
  } catch {
    return { floorId: null, refresh: () => {} };
  }
}

function getSafeDataStore() {
  try {
    return useDataStore();
  } catch {
    return { data: null };
  }
}

function buildMutateContext() {
  const effCat =
    (catalog as unknown as { effectiveCatalog?: unknown }).effectiveCatalog ?? (catalog as unknown);
  return {
    snapshot: (props.snapshot ?? null) as unknown as Record<string, unknown> | null,
    dataStore: getSafeDataStore(),
    floating: getSafeFloating(),
    catalog: effCat as Parameters<typeof executeInstantScheduleMutation>[1]['catalog'],
    updateFloorVars,
    onTick: () => {
      editTick.value += 1;
    },
  };
}

function enqueueInspectorToTray(verb: ExtendedScheduleVerb, txn: ScheduleTxnRow, targetBase?: string) {
  const resolvedAllocBase = targetBase || allocateTargetBase.value || visibleBases.value[0]?.name || txn.base;
  const orderText = extendedDispatchOrderText(verb, {
    item: txn.item,
    type: txn.type,
    base: txn.base,
    allocateBase: resolvedAllocBase,
  });
  const summary =
    verb === '指派'
      ? `${txn.item} → ${resolvedAllocBase}`
      : `${txn.base ? `${txn.base}·` : ''}${txn.item}`;
  commandTray.value.push({
    id: `tray_${(traySeq += 1)}`,
    verb,
    item: txn.item,
    base: txn.base,
    type: txn.type,
    summary,
    orderText,
  });
  trayOpen.value = true;
}

async function onDispatch(verb: DispatchVerb, txn: ScheduleTxnRow, capacity = 1) {
  if (instantMode.value) {
    await executeInstantScheduleMutation(
      {
        verb,
        item: txn.item,
        type: txn.type,
        base: txn.base,
        taskId: txn.taskId,
        queueIndex: txn.queueIndex,
        capacity,
      },
      buildMutateContext(),
    );
    return;
  }
  const { sendAction } = await import('../../红警指挥系统/worldbook/send');
  await sendAction(dispatchOrderText(verb, { item: txn.item, type: txn.type, base: txn.base }));
}

async function onExtendedDispatch(verb: ExtendedScheduleVerb, txn: ScheduleTxnRow) {
  const key = txnKey(txn);
  if (verb === '撤销') {
    if (confirmingCancelKey.value !== key) {
      confirmingCancelKey.value = key;
      return;
    }
    confirmingCancelKey.value = null;
  } else {
    confirmingCancelKey.value = null;
  }

  const resolvedAllocBase = allocateTargetBase.value || visibleBases.value[0]?.name || txn.base;

  if (instantMode.value) {
    await executeInstantScheduleMutation(
      {
        verb,
        item: txn.item,
        type: txn.type,
        base: txn.base,
        taskId: txn.taskId,
        queueIndex: txn.queueIndex,
        allocateBase: resolvedAllocBase,
        capacity: selectedTxnCapacity.value,
      },
      buildMutateContext(),
    );
    return;
  }

  enqueueInspectorToTray(verb, txn, resolvedAllocBase);
}

async function onToggleBuildingMode(inst: LaneDualModeBuildingRef) {
  await toggleScheduleLaneBuildingMode(inst, buildMutateContext());
}

async function onToggleBuildingScope(inst: LaneDualModeBuildingRef) {
  await toggleScheduleLaneBuildingScope(inst, buildMutateContext());
}

function clearCommandTray() {
  commandTray.value = [];
}

function fillTrayOrdersToInput() {
  const text = formatBatchScheduleOrdersText(commandTray.value);
  if (!text) return;
  const ch = fillHostSendInput(text);
  if (ch !== 'failed') {
    void showToast(`已将 ${commandTray.value.length} 项调度令填入发送框`, 'success');
  }
}

async function sendTrayOrdersNow() {
  const text = formatBatchScheduleOrdersText(commandTray.value);
  if (!text) return;
  const { sendAction } = await import('../../红警指挥系统/worldbook/send');
  await sendAction(text);
  commandTray.value = [];
}
</script>

<style scoped>
.ra-modal-mask {
  z-index: 10010;
  background: rgba(0, 0, 0, 0.82);
  backdrop-filter: blur(5px);
}
.ra-modal-card {
  background: var(--rac-bg);
  border: 1px solid var(--rac-line);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.85);
}
.ra-modal-header {
  background: var(--rac-panel);
  border-color: var(--rac-dim);
}
.ra-modal-icon,
.sch-clock {
  color: var(--rac-line);
}
.ra-modal-title {
  color: var(--rac-hi);
}
.ra-modal-close {
  color: var(--rac-muted);
}
.ra-modal-close:hover {
  color: var(--rac-hi);
  background: var(--rac-panel-2);
}
.ra-modal-body {
  background: var(--rac-bg);
}
.sch-empty {
  padding: 6px 2px 10px;
}
.sch-empty-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--rac-accent) 6%, transparent);
  border: 1px dashed color-mix(in srgb, var(--rac-accent) 28%, transparent);
  border-radius: 2px;
}
.sch-empty-tag {
  color: var(--rac-line);
  font-family: monospace;
  font-size: 11px;
}
.sch-empty-text,
.sch-base-meta,
.sch-txn-pred,
.sch-lane-meta,
.sch-empty-line,
.sch-locked-reason {
  color: var(--rac-muted);
}
.sch-filter-btn {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 2px;
  border: 1px solid var(--rac-dim);
  background: transparent;
  color: var(--rac-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}
.sch-filter-btn:hover:not(:disabled) {
  color: var(--rac-text);
  border-color: var(--rac-line);
}
.sch-filter-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sch-filter-btn--active {
  background: color-mix(in srgb, var(--rac-accent) 16%, transparent);
  color: var(--rac-line);
  border-color: var(--rac-line);
}
.sch-base-panel--retired {
  border-style: dashed;
  opacity: 0.75;
}
.sch-base-toggle {
  cursor: pointer;
  background: transparent;
  text-align: left;
}
.sch-retired-badge {
  padding: 0 4px;
  border: 1px dashed var(--rac-warn);
  border-radius: 2px;
  color: var(--rac-warn);
  font-size: 11px;
  line-height: 15px;
}
.sch-base-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 0 4px;
  color: var(--rac-line);
  font-size: 12px;
  font-weight: 700;
  border-bottom: 1px solid color-mix(in srgb, var(--rac-accent) 20%, transparent);
}
.sch-base-tag {
  font-family: monospace;
  font-size: 11px;
  font-weight: normal;
  color: var(--rac-muted);
}
.sch-empty-line {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px;
  font-size: 11px;
}
.sch-lane {
  padding: 3px 0 3px 10px;
}
.sch-lane--locked {
  opacity: 0.72;
}
.sch-lane-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}
.sch-lane-name,
.sch-txn-item {
  color: var(--rac-text);
  font-weight: 600;
}
.sch-stranded {
  color: var(--rac-warn);
}
.sch-accel-pill {
  background: color-mix(in srgb, var(--rac-warn) 18%, var(--rac-panel));
  border: 1px solid color-mix(in srgb, var(--rac-warn) 45%, transparent);
  color: var(--rac-warn);
}
.sch-dualmode-btn--accel {
  border-color: color-mix(in srgb, var(--rac-warn) 75%, transparent);
  background: color-mix(in srgb, var(--rac-warn) 20%, var(--rac-panel));
  color: var(--rac-warn);
}
.sch-dualmode-btn--prod {
  border-color: color-mix(in srgb, var(--rac-accent) 60%, transparent);
  background: color-mix(in srgb, var(--rac-accent) 16%, var(--rac-panel));
  color: var(--rac-accent);
}
.sch-axis-seg {
  border: 1px solid color-mix(in srgb, var(--rac-dim) 70%, transparent);
  background: color-mix(in srgb, var(--rac-bg) 65%, var(--rac-panel));
  color: var(--rac-muted);
}
.sch-axis-seg--origin {
  border-color: color-mix(in srgb, var(--rac-accent) 55%, transparent);
  background: color-mix(in srgb, var(--rac-accent) 18%, var(--rac-panel-2));
  color: var(--rac-hi);
  font-weight: 700;
}
.sch-subtrack-badge {
  border: 1px solid color-mix(in srgb, var(--rac-dim) 75%, transparent);
  background: var(--rac-panel-2);
}
.sch-subtrack-timeline {
  background: var(--rac-bg);
}
.sch-subtrack-timeline--blocked {
  background-image: var(--rac-hatch-alert);
  border-color: color-mix(in srgb, var(--rac-alert) 55%, var(--rac-dim));
}
.sch-grid-origin-line {
  width: 2px;
  background: color-mix(in srgb, var(--rac-accent) 70%, transparent);
}
.sch-grid-line {
  border-left: 1px dashed color-mix(in srgb, var(--rac-line) 28%, transparent);
}
.sch-hatch-zone--dim {
  background-image: var(--rac-hatch-dim);
}
.sch-hatch-zone--alert {
  background-image: var(--rac-hatch-alert);
}
.sch-gantt-block {
  min-width: 56px;
  overflow: visible;
  border: 1px solid color-mix(in srgb, var(--rac-line) 38%, transparent);
  border-left-width: 2px;
  border-bottom-width: 2px;
  background: color-mix(in srgb, var(--rac-panel-2) 88%, var(--rac-bg));
}
.sch-gantt-block--construction {
  border-color: color-mix(in srgb, var(--rac-warn) 45%, transparent);
  border-left-color: var(--rac-warn);
  border-bottom-color: var(--rac-warn);
  background: color-mix(in srgb, var(--rac-warn) 16%, var(--rac-panel));
}
.sch-gantt-block--production {
  border-color: color-mix(in srgb, var(--rac-accent) 45%, transparent);
  border-left-color: var(--rac-accent);
  border-bottom-color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 16%, var(--rac-panel));
}
.sch-gantt-block--research {
  border-color: color-mix(in srgb, var(--rac-ok) 45%, transparent);
  border-left-color: var(--rac-ok);
  border-bottom-color: var(--rac-ok);
  background: color-mix(in srgb, var(--rac-ok) 16%, var(--rac-panel));
}
.sch-gantt-block--retrofit {
  border-color: color-mix(in srgb, var(--rac-line) 55%, transparent);
  border-left-color: var(--rac-hi);
  border-bottom-color: var(--rac-line);
  background: color-mix(in srgb, var(--rac-line) 22%, var(--rac-panel));
}
.sch-gantt-block--paused {
  border-color: color-mix(in srgb, var(--rac-alert) 45%, transparent);
  border-left-color: var(--rac-alert);
  border-bottom-color: var(--rac-alert);
  background: color-mix(in srgb, var(--rac-alert) 14%, var(--rac-panel));
  background-image: var(--rac-hatch-alert);
}
.sch-gantt-block--selected {
  box-shadow: 0 0 0 1px var(--rac-accent);
}
.sch-gantt-block-content {
  white-space: nowrap;
}
.sch-draft-row {
  border-color: color-mix(in srgb, var(--rac-accent) 42%, transparent);
  background: color-mix(in srgb, var(--rac-accent) 8%, var(--rac-bg));
}
.sch-tone-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 1px;
}
.sch-tone--run {
  background: var(--rac-warn);
}
.sch-tone--idle,
.sch-tone--ready {
  background: var(--rac-line);
}
.sch-tone--hold {
  background: var(--rac-muted);
}
.sch-tone--ok {
  background: var(--rac-ok);
}
.sch-tone--dead {
  background: var(--rac-alert);
}
.sch-verbs {
  display: inline-flex;
  gap: 3px;
}
.sch-verbs--floating {
  position: absolute;
  top: 2px;
  right: 4px;
  z-index: 20;
  padding: 1px 3px;
  border-radius: 2px;
  border: 1px solid var(--rac-line);
  background: var(--rac-panel);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.14s ease;
}
.sch-gantt-block:hover .sch-verbs--floating,
.sch-gantt-block:focus-within .sch-verbs--floating,
.sch-gantt-block--selected .sch-verbs--floating {
  opacity: 1;
  pointer-events: auto;
}
.sch-verb-btn {
  padding: 0 4px;
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
  background: transparent;
  color: var(--rac-muted);
  font-size: 11px;
  line-height: 15px;
  cursor: pointer;
}
.sch-verb-btn:hover:not(:disabled) {
  color: var(--rac-hi);
  border-color: var(--rac-line);
}
.sch-verb-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sch-verb-btn--armed {
  color: var(--rac-warn);
  border-color: var(--rac-warn);
}
.sch-verb-btn--danger {
  color: var(--rac-alert);
  border-color: var(--rac-alert);
}
.sch-inspector-badge {
  background: color-mix(in srgb, var(--rac-accent) 18%, var(--rac-panel-2));
  border: 1px solid color-mix(in srgb, var(--rac-accent) 45%, transparent);
  color: var(--rac-accent);
}
.sch-legend-ring {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 9999px;
  border: 2px solid var(--rac-line);
}
.sch-legend-ring--construction {
  border-color: var(--rac-warn);
}
.sch-legend-ring--production {
  border-color: var(--rac-accent);
}
.sch-legend-ring--research {
  border-color: var(--rac-ok);
}
.sch-legend-ring--retrofit {
  border-color: var(--rac-hi);
}
.sch-legend-ring--paused {
  border-color: var(--rac-alert);
}
.sch-legend-hatch {
  display: inline-block;
  width: 12px;
  height: 9px;
  border-radius: 1px;
  border: 1px solid var(--rac-dim);
  background-image: var(--rac-hatch-dim);
}
.sch-milestone-banner {
  border: 1px solid var(--rac-dim);
  background: color-mix(in srgb, var(--rac-panel-2) 70%, transparent);
  color: var(--rac-text);
}
.sch-milestone-banner--settling .sch-milestone-tag {
  background: color-mix(in srgb, var(--rac-ok) 20%, transparent);
  color: var(--rac-ok);
  border: 1px solid color-mix(in srgb, var(--rac-ok) 45%, transparent);
}
.sch-milestone-banner--active .sch-milestone-tag {
  background: color-mix(in srgb, var(--rac-warn) 20%, transparent);
  color: var(--rac-warn);
  border: 1px solid color-mix(in srgb, var(--rac-warn) 45%, transparent);
}
.sch-milestone-banner--empty .sch-milestone-tag {
  background: color-mix(in srgb, var(--rac-muted) 15%, transparent);
  color: var(--rac-muted);
  border: 1px solid var(--rac-dim);
}
.sch-gantt-track {
  background: color-mix(in srgb, var(--rac-line) 15%, transparent);
}
.sch-gantt-bar--active {
  background: color-mix(in srgb, var(--rac-warn) 34%, transparent);
}
.sch-gantt-bar--queued {
  background: color-mix(in srgb, var(--rac-accent) 28%, transparent);
}
.sch-gantt-bar--paused {
  background: color-mix(in srgb, var(--rac-muted) 26%, transparent);
}
.sch-gantt-bar--settling,
.sch-gantt-bar--done {
  background: color-mix(in srgb, var(--rac-ok) 36%, transparent);
}
.sch-proto-order,
.sch-proto-track {
  border: 1px solid var(--rac-dim);
  background: color-mix(in srgb, var(--rac-accent) 12%, transparent);
  color: var(--rac-line);
}
</style>

