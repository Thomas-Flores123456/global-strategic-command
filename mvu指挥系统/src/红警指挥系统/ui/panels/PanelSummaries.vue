<template>
  <!--
    战史与剧情摘要 · Story Chronicles
    包含：
    1. 实时剧情上下文 Token 总量预估（含未被隐藏的聊天正文）与四维占比可视化仪表盘
    2. 大、中、小三档摘要预算与近场原文保留楼层动态调节拖条（支持一键预设档位与实时联动）
    3. 三个清爽子视图：战史摘要（待确认草稿 + 已归档卷宗） / 逐楼纪要 / 生成与接口设置
  -->
  <section ref="summariesRootRef" class="ra-summaries flex flex-col gap-3 text-xs text-[var(--rac-text)]">
    <!-- 顶部状态头栏 -->
    <div class="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--rac-dim)] bg-[var(--rac-panel)] px-3 py-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="inline-flex items-center gap-1.5 font-semibold tracking-wide text-[var(--rac-hi)]">
          <Icon name="archive" :size="13" />
          战史与剧情摘要
        </span>
        <span
          class="inline-flex items-center rounded border px-2 py-0.5 font-mono text-[12px]"
          :class="
            channelMode === 'delegate_main'
              ? 'border-[var(--rac-ok)]/40 bg-[var(--rac-ok)]/15 text-[var(--rac-ok)]'
              : 'border-[var(--rac-accent)]/40 bg-[var(--rac-accent)]/15 text-[var(--rac-accent)]'
          "
        >
          {{ channelMode === 'delegate_main' ? '主模型顺带生成' : '后台独立模型生成' }}
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-2.5 text-[12px] text-[var(--rac-text)]">
        <span class="font-mono">
          当前 <strong class="text-[var(--rac-hi)]">#{{ currentFloor }}</strong> 楼 · 保留近
          <strong class="text-[var(--rac-ok)]">{{ budgetDraft.tailReserveFloors }}</strong> 楼原文
        </span>
        <button
          type="button"
          class="sum-btn px-2.5 py-1 text-[12px]"
          :class="{ 'sum-btn--primary': showBudgetSliders }"
          @click="showBudgetSliders = !showBudgetSliders"
        >
          {{ showBudgetSliders ? '收起预算调节 ▲' : '调节三档预算 ▼' }}
        </button>
        <button
          type="button"
          class="sum-btn px-2.5 py-1 text-[12px]"
          :disabled="busy"
          @click="refreshRanges"
        >
          刷新
        </button>
      </div>
    </div>

    <!-- ══════════════════ 常驻仪表盘：上下文 Token 总量预估（含未隐藏正文）与四维占比 + 动态预算拖条 ══════════════════ -->
    <div class="rounded border border-[var(--rac-dim)] bg-[var(--rac-panel)] p-3">
      <!-- 第一行：总 Token 预估（含未隐藏正文） vs 摘要总预算水位 -->
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-baseline gap-2">
          <span class="font-semibold text-[var(--rac-hi)]">剧情上下文实时预估（含未隐藏正文）</span>
          <span class="font-mono text-sm font-bold text-[var(--rac-accent)]">
            {{ animatedGrandTotalTokens }} tok
          </span>
          <span class="font-mono text-[11px] text-[var(--rac-muted)]">
            （摘要合计 {{ animatedSummaryTotalTokens }} tok + 未隐藏正文 {{ animatedUnhiddenRawTokens }} tok）
          </span>
        </div>

        <div class="flex items-center gap-2 font-mono text-[11px]">
          <span class="text-[var(--rac-text)]">
            三档摘要总预算：
            <strong
              :class="
                breakdown.summaryBudgetUsagePct > 100
                  ? 'text-[var(--rac-warn)]'
                  : 'text-[var(--rac-ok)]'
              "
            >
              {{ breakdown.summaryTotalTokens }} / {{ breakdown.summaryBudgetTotal }} tok ({{ breakdown.summaryBudgetUsagePct }}%)
            </strong>
          </span>
          <span
            v-if="breakdown.summaryTotalTokens > breakdown.summaryBudgetTotal"
            class="rounded border border-[var(--rac-warn)]/50 bg-[var(--rac-warn)]/15 px-1.5 py-0.5 text-[12px] text-[var(--rac-warn)]"
          >
            建议归并总纲或上调预算
          </span>
        </div>
      </div>

      <!-- 第二行：四项上下文占比条（战役总纲 / 阶段摘要 / 逐楼纪要 / 未隐藏正文） -->
      <div
        class="mt-2.5 flex h-3 w-full overflow-hidden rounded-full border border-[var(--rac-dim)] bg-[var(--rac-bg)]"
        title="四项上下文占比：战役总纲 / 阶段摘要 / 逐楼纪要 / 未隐藏正文"
      >
        <div
          v-if="breakdown.macroSharePct > 0"
          class="h-full bg-[var(--rac-focus)] transition-all duration-200"
          :style="{ width: `${Math.max(2, breakdown.macroSharePct)}%` }"
          :title="`大摘要（战役总纲）：${breakdown.macroTokens} tok (${breakdown.macroSharePct}%)`"
        />
        <div
          v-if="breakdown.mesoSharePct > 0"
          class="h-full bg-[var(--rac-warn)] transition-all duration-200"
          :style="{ width: `${Math.max(2, breakdown.mesoSharePct)}%` }"
          :title="`中摘要（阶段摘要）：${breakdown.mesoTokens} tok (${breakdown.mesoSharePct}%)`"
        />
        <div
          v-if="breakdown.microSharePct > 0"
          class="h-full bg-[var(--rac-accent)] transition-all duration-200"
          :style="{ width: `${Math.max(2, breakdown.microSharePct)}%` }"
          :title="`小摘要（逐楼纪要）：${breakdown.microTokens} tok (${breakdown.microSharePct}%)`"
        />
        <div
          v-if="breakdown.unhiddenRawSharePct > 0"
          class="h-full bg-[var(--rac-ok)]/85 transition-all duration-200"
          :style="{ width: `${Math.max(2, breakdown.unhiddenRawSharePct)}%` }"
          :title="`未隐藏聊天正文（${breakdown.unhiddenFloorCount} 楼）：${breakdown.unhiddenRawTokens} tok (${breakdown.unhiddenRawSharePct}%)`"
        />
      </div>

      <!-- 第三行：四维分项占比与预算指标卡（支持在卡片上直接手填目标预算） -->
      <div class="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <!-- 1. 大摘要 -->
        <div class="rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] px-2.5 py-1.5">
          <div class="flex items-center justify-between text-[12px]">
            <span class="inline-flex items-center gap-1.5 font-medium text-[var(--rac-hi)]">
              <span class="inline-block h-2 w-2 rounded-full bg-[var(--rac-focus)]" />
              大摘要 ({{ breakdown.macroCount }})
            </span>
            <span class="font-mono font-bold text-[var(--rac-focus)]">{{ breakdown.macroSharePct }}%</span>
          </div>
          <div class="mt-1 flex items-center justify-between gap-1 font-mono text-[11px] text-[var(--rac-text)]">
            <span>{{ breakdown.macroTokens }} tok</span>
            <label class="inline-flex items-center gap-1 text-[var(--rac-muted)]" title="点击直接输入大摘要总预算 (tok)">
              <span>预算</span>
              <input
                v-model.number="budgetDraft.macroBudgetTokens"
                type="number"
                min="200"
                max="8000"
                step="50"
                aria-label="大摘要总预算上限"
                class="sum-num-input w-14"
                @change="onBudgetNumberCommit"
                @blur="onBudgetNumberCommit"
              />
            </label>
          </div>
          <div class="mt-1 h-1 w-full overflow-hidden rounded bg-[var(--rac-panel-2)]">
            <div
              class="h-full transition-all duration-200"
              :class="breakdown.macroBudgetUsagePct > 100 ? 'bg-[var(--rac-alert)]' : 'bg-[var(--rac-focus)]'"
              :style="{ width: `${Math.min(100, breakdown.macroBudgetUsagePct)}%` }"
            />
          </div>
        </div>

        <!-- 2. 中摘要 -->
        <div class="rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] px-2.5 py-1.5">
          <div class="flex items-center justify-between text-[12px]">
            <span class="inline-flex items-center gap-1.5 font-medium text-[var(--rac-hi)]">
              <span class="inline-block h-2 w-2 rounded-full bg-[var(--rac-warn)]" />
              中摘要 ({{ breakdown.mesoCount }})
            </span>
            <span class="font-mono font-bold text-[var(--rac-warn)]">{{ breakdown.mesoSharePct }}%</span>
          </div>
          <div class="mt-1 flex items-center justify-between gap-1 font-mono text-[11px] text-[var(--rac-text)]">
            <span>{{ breakdown.mesoTokens }} tok</span>
            <label class="inline-flex items-center gap-1 text-[var(--rac-muted)]" title="点击直接输入中摘要总预算 (tok)">
              <span>预算</span>
              <input
                v-model.number="budgetDraft.mesoBudgetTokens"
                type="number"
                min="300"
                max="10000"
                step="50"
                aria-label="中摘要总预算上限"
                class="sum-num-input w-14"
                @change="onBudgetNumberCommit"
                @blur="onBudgetNumberCommit"
              />
            </label>
          </div>
          <div class="mt-1 h-1 w-full overflow-hidden rounded bg-[var(--rac-panel-2)]">
            <div
              class="h-full transition-all duration-200"
              :class="breakdown.mesoBudgetUsagePct > 100 ? 'bg-[var(--rac-alert)]' : 'bg-[var(--rac-warn)]'"
              :style="{ width: `${Math.min(100, breakdown.mesoBudgetUsagePct)}%` }"
            />
          </div>
        </div>

        <!-- 3. 小摘要 -->
        <div class="rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] px-2.5 py-1.5">
          <div class="flex items-center justify-between text-[12px]">
            <span class="inline-flex items-center gap-1.5 font-medium text-[var(--rac-hi)]">
              <span class="inline-block h-2 w-2 rounded-full bg-[var(--rac-accent)]" />
              小摘要 ({{ breakdown.microCount }})
            </span>
            <span class="font-mono font-bold text-[var(--rac-accent)]">{{ breakdown.microSharePct }}%</span>
          </div>
          <div class="mt-1 flex items-center justify-between gap-1 font-mono text-[11px] text-[var(--rac-text)]">
            <span>{{ breakdown.microTokens }} tok</span>
            <label class="inline-flex items-center gap-1 text-[var(--rac-muted)]" title="点击直接输入小摘要总预算 (tok)">
              <span>预算</span>
              <input
                v-model.number="budgetDraft.microBudgetTokens"
                type="number"
                min="100"
                max="5000"
                step="50"
                aria-label="小摘要总预算上限"
                class="sum-num-input w-14"
                @change="onBudgetNumberCommit"
                @blur="onBudgetNumberCommit"
              />
            </label>
          </div>
          <div class="mt-1 h-1 w-full overflow-hidden rounded bg-[var(--rac-panel-2)]">
            <div
              class="h-full transition-all duration-200"
              :class="breakdown.microBudgetUsagePct > 100 ? 'bg-[var(--rac-alert)]' : 'bg-[var(--rac-accent)]'"
              :style="{ width: `${Math.min(100, breakdown.microBudgetUsagePct)}%` }"
            />
          </div>
        </div>

        <!-- 4. 未被隐藏的聊天正文 -->
        <div class="rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] px-2.5 py-1.5">
          <div class="flex items-center justify-between text-[12px]">
            <span class="inline-flex items-center gap-1.5 font-medium text-[var(--rac-hi)]">
              <span class="inline-block h-2 w-2 rounded-full bg-[var(--rac-ok)]" />
              未隐藏正文 ({{ breakdown.unhiddenFloorCount }}楼)
            </span>
            <span class="font-mono font-bold text-[var(--rac-ok)]">{{ breakdown.unhiddenRawSharePct }}%</span>
          </div>
          <div class="mt-1 flex items-center justify-between gap-1 font-mono text-[11px] text-[var(--rac-text)]">
            <span>{{ breakdown.unhiddenRawTokens }} tok</span>
            <label class="inline-flex items-center gap-1 text-[var(--rac-muted)]" title="点击直接输入近场保留原文楼层数">
              <span>保留</span>
              <input
                v-model.number="budgetDraft.tailReserveFloors"
                type="number"
                min="2"
                max="40"
                step="1"
                aria-label="近场保留原文楼层数"
                class="sum-num-input w-11"
                @change="onBudgetNumberCommit"
                @blur="onBudgetNumberCommit"
              />
              <span>楼</span>
            </label>
          </div>
          <div class="mt-1 h-1 w-full overflow-hidden rounded bg-[var(--rac-panel-2)]">
            <div
              class="h-full bg-[var(--rac-ok)] transition-all duration-200"
              :style="{ width: `${Math.min(100, breakdown.unhiddenRawSharePct)}%` }"
            />
          </div>
        </div>
      </div>

      <!-- 第四部分：可展开的大中小三档预算动态调节面板（滑块 + 手动数字输入双向联动） -->
      <div
        v-if="showBudgetSliders"
        class="mt-3 border-t border-[var(--rac-dim)] pt-3"
      >
        <div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <span class="font-semibold text-[var(--rac-hi)]">动态调节三档摘要预算与原文保留范围</span>
            <span class="ml-2 text-[12px] text-[var(--rac-muted)]">可拖动滑块或直接在右侧输入框填入目标数值</span>
          </div>

          <!-- 一键预设档位按钮 -->
          <div class="inline-flex flex-wrap items-center gap-1 rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] p-1">
            <button
              v-for="(preset, pKey) in SUMMARY_BUDGET_PRESETS"
              :key="pKey"
              type="button"
              class="sum-pill"
              :class="{ 'sum-pill--active': isPresetMatched(pKey as SummaryBudgetPresetKey) }"
              :title="preset.desc"
              @click="applyBudgetPreset(pKey as SummaryBudgetPresetKey)"
            >
              {{ preset.label }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <!-- 拖条组 1：大摘要（战役总纲）预算 -->
          <div class="rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-medium text-[var(--rac-hi)]">◆ 大摘要（战役总纲）预算</span>
              <span class="font-mono text-[11px] text-[var(--rac-focus)]">
                已用 {{ breakdown.macroTokens }} / {{ budgetDraft.macroBudgetTokens }} tok ({{ breakdown.macroBudgetUsagePct }}%)
              </span>
            </div>

            <div class="mt-2">
              <div class="flex items-center justify-between gap-2 text-[12px] text-[var(--rac-text)]">
                <span>总预算上限</span>
                <label class="inline-flex items-center gap-1 font-mono">
                  <input
                    v-model.number="budgetDraft.macroBudgetTokens"
                    type="number"
                    min="200"
                    max="8000"
                    step="50"
                    class="sum-num-input w-18"
                    @change="onBudgetNumberCommit"
                    @blur="onBudgetNumberCommit"
                  />
                  <span class="text-[var(--rac-muted)]">tok</span>
                </label>
              </div>
              <input
                v-model.number="budgetDraft.macroBudgetTokens"
                type="range"
                min="200"
                max="8000"
                step="50"
                class="sum-slider sum-slider--purple mt-1.5 w-full"
                @input="onBudgetSliderInput"
              />
            </div>

            <div class="mt-2">
              <div class="flex items-center justify-between gap-2 text-[12px] text-[var(--rac-text)]">
                <span>单卷生成目标篇幅（影响 AI 提炼字数）</span>
                <label class="inline-flex items-center gap-1 font-mono">
                  <input
                    v-model.number="budgetDraft.macroSingleTargetTokens"
                    type="number"
                    min="150"
                    max="1500"
                    step="25"
                    class="sum-num-input w-18"
                    @change="onBudgetNumberCommit"
                    @blur="onBudgetNumberCommit"
                  />
                  <span class="text-[var(--rac-muted)]">tok</span>
                </label>
              </div>
              <input
                v-model.number="budgetDraft.macroSingleTargetTokens"
                type="range"
                min="150"
                max="1500"
                step="25"
                class="sum-slider sum-slider--purple mt-1.5 w-full"
                @input="onBudgetSliderInput"
              />
            </div>
          </div>

          <!-- 拖条组 2：中摘要（阶段摘要）预算 -->
          <div class="rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-medium text-[var(--rac-hi)]">◆ 中摘要（阶段摘要）预算</span>
              <span class="font-mono text-[11px] text-[var(--rac-warn)]">
                已用 {{ breakdown.mesoTokens }} / {{ budgetDraft.mesoBudgetTokens }} tok ({{ breakdown.mesoBudgetUsagePct }}%)
              </span>
            </div>

            <div class="mt-2">
              <div class="flex items-center justify-between gap-2 text-[12px] text-[var(--rac-text)]">
                <span>总预算上限</span>
                <label class="inline-flex items-center gap-1 font-mono">
                  <input
                    v-model.number="budgetDraft.mesoBudgetTokens"
                    type="number"
                    min="300"
                    max="10000"
                    step="50"
                    class="sum-num-input w-18"
                    @change="onBudgetNumberCommit"
                    @blur="onBudgetNumberCommit"
                  />
                  <span class="text-[var(--rac-muted)]">tok</span>
                </label>
              </div>
              <input
                v-model.number="budgetDraft.mesoBudgetTokens"
                type="range"
                min="300"
                max="10000"
                step="50"
                class="sum-slider sum-slider--amber mt-1.5 w-full"
                @input="onBudgetSliderInput"
              />
            </div>

            <div class="mt-2">
              <div class="flex items-center justify-between gap-2 text-[12px] text-[var(--rac-text)]">
                <span>单段生成目标篇幅（影响 AI 提炼字数）</span>
                <label class="inline-flex items-center gap-1 font-mono">
                  <input
                    v-model.number="budgetDraft.mesoSingleTargetTokens"
                    type="number"
                    min="100"
                    max="1200"
                    step="25"
                    class="sum-num-input w-18"
                    @change="onBudgetNumberCommit"
                    @blur="onBudgetNumberCommit"
                  />
                  <span class="text-[var(--rac-muted)]">tok</span>
                </label>
              </div>
              <input
                v-model.number="budgetDraft.mesoSingleTargetTokens"
                type="range"
                min="100"
                max="1200"
                step="25"
                class="sum-slider sum-slider--amber mt-1.5 w-full"
                @input="onBudgetSliderInput"
              />
            </div>
          </div>

          <!-- 拖条组 3：小摘要（逐楼纪要）预算 -->
          <div class="rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-medium text-[var(--rac-hi)]">◇ 小摘要（逐楼纪要）预算</span>
              <span class="font-mono text-[11px] text-[var(--rac-accent)]">
                已用 {{ breakdown.microTokens }} / {{ budgetDraft.microBudgetTokens }} tok ({{ breakdown.microBudgetUsagePct }}%)
              </span>
            </div>

            <div class="mt-2">
              <div class="flex items-center justify-between gap-2 text-[12px] text-[var(--rac-text)]">
                <span>总预算上限（未归档活跃 {{ breakdown.microUncoveredTokens }} tok）</span>
                <label class="inline-flex items-center gap-1 font-mono">
                  <input
                    v-model.number="budgetDraft.microBudgetTokens"
                    type="number"
                    min="100"
                    max="5000"
                    step="50"
                    class="sum-num-input w-18"
                    @change="onBudgetNumberCommit"
                    @blur="onBudgetNumberCommit"
                  />
                  <span class="text-[var(--rac-muted)]">tok</span>
                </label>
              </div>
              <input
                v-model.number="budgetDraft.microBudgetTokens"
                type="range"
                min="100"
                max="5000"
                step="50"
                class="sum-slider sum-slider--sky mt-1.5 w-full"
                @input="onBudgetSliderInput"
              />
            </div>

            <div class="mt-2">
              <div class="flex items-center justify-between gap-2 text-[12px] text-[var(--rac-text)]">
                <span>单楼纪要目标篇幅</span>
                <label class="inline-flex items-center gap-1 font-mono">
                  <input
                    v-model.number="budgetDraft.microSingleTargetTokens"
                    type="number"
                    min="20"
                    max="300"
                    step="10"
                    class="sum-num-input w-18"
                    @change="onBudgetNumberCommit"
                    @blur="onBudgetNumberCommit"
                  />
                  <span class="text-[var(--rac-muted)]">tok</span>
                </label>
              </div>
              <input
                v-model.number="budgetDraft.microSingleTargetTokens"
                type="range"
                min="20"
                max="300"
                step="10"
                class="sum-slider sum-slider--sky mt-1.5 w-full"
                @input="onBudgetSliderInput"
              />
            </div>
          </div>

          <!-- 拖条组 4：未隐藏聊天正文保留范围 -->
          <div class="rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] p-2.5">
            <div class="flex items-center justify-between">
              <span class="font-medium text-[var(--rac-hi)]">● 未隐藏聊天正文保留范围</span>
              <span class="font-mono text-[11px] text-[var(--rac-ok)]">
                当前未隐藏 {{ breakdown.unhiddenFloorCount }} 楼 ({{ breakdown.unhiddenRawTokens }} tok)
              </span>
            </div>

            <div class="mt-2">
              <div class="flex items-center justify-between gap-2 text-[12px] text-[var(--rac-text)]">
                <span>近场不压缩原文保留楼层数</span>
                <label class="inline-flex items-center gap-1 font-mono">
                  <span class="text-[var(--rac-muted)]">最近</span>
                  <input
                    v-model.number="budgetDraft.tailReserveFloors"
                    type="number"
                    min="2"
                    max="40"
                    step="1"
                    class="sum-num-input w-14"
                    @change="onBudgetNumberCommit"
                    @blur="onBudgetNumberCommit"
                  />
                  <span class="text-[var(--rac-muted)]">楼</span>
                </label>
              </div>
              <input
                v-model.number="budgetDraft.tailReserveFloors"
                type="range"
                min="2"
                max="40"
                step="1"
                class="sum-slider sum-slider--emerald mt-1.5 w-full"
                @input="onBudgetSliderInput"
              />
            </div>

            <div class="mt-2.5 text-[12px] leading-relaxed text-[var(--rac-muted)]">
              调小保留楼层数可提早将旧楼层压缩为阶段摘要并隐藏原文，显著降低未隐藏正文的 Token 占比；调大则保留更多近期完整对话描写。
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 顶部子页分段导航栏 -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--rac-dim)] pb-2">
      <div class="inline-flex flex-wrap items-center gap-1.5 rounded bg-[var(--rac-bg)] p-1 border border-[var(--rac-dim)]">
        <button
          type="button"
          class="sum-tab"
          :class="{ 'sum-tab--active': activeSubTab === 'archive' }"
          @click="activeSubTab = 'archive'"
        >
          <span>战史摘要 ({{ savedRanges.length }})</span>
          <span
            v-if="pendingSummaries.length > 0"
            class="ml-1.5 rounded bg-[var(--rac-warn)]/20 px-1.5 py-0.2 font-mono text-[11px] font-bold text-[var(--rac-warn)] border border-[var(--rac-warn)]/40"
          >
            待确认 {{ pendingSummaries.length }}
          </span>
        </button>
        <button
          type="button"
          class="sum-tab"
          :class="{ 'sum-tab--active': activeSubTab === 'micro' }"
          @click="activeSubTab = 'micro'"
        >
          逐楼纪要 ({{ microSummaries.length }})
        </button>
        <button
          type="button"
          class="sum-tab"
          :class="{ 'sum-tab--active': activeSubTab === 'config' }"
          @click="activeSubTab = 'config'"
        >
          生成与接口设置
        </button>
      </div>

      <span class="font-mono text-[11px] text-[var(--rac-muted)]">
        当前世界书：<strong class="text-[var(--rac-hi)]">{{ boundBookName || '尚未绑定聊天世界书' }}</strong>
      </span>
    </div>

    <!-- ══════════════════ 子页 1：战史摘要（操作栏 + 待确认草稿 + 已归档卷宗） ══════════════════ -->
    <div v-if="activeSubTab === 'archive'" class="flex flex-col gap-3">
      <!-- 满 20 楼未归档提醒横幅 -->
      <div
        v-if="unsummarizedCount >= DEFAULT_SUMMARY_N"
        class="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--rac-warn)]/50 bg-[var(--rac-warn)]/15 px-3 py-2"
      >
        <div class="flex items-center gap-2 text-[var(--rac-warn)]">
          <Icon name="alert" :size="13" />
          <span>
            已有 <strong>{{ unsummarizedCount }}</strong> 楼剧情尚未归档（建议每满 {{ DEFAULT_SUMMARY_N }} 楼提炼一次阶段摘要，避免上下文膨胀）
          </span>
        </div>
        <button
          type="button"
          class="sum-btn sum-btn--primary px-3 py-1 text-[12px]"
          :disabled="busy || !env.inTavern || !canGenerateNext"
          @click="generateNextSummary"
        >
          {{ channelMode === 'delegate_main' ? '预约下一轮顺带生成' : '立即生成阶段摘要' }}
        </button>
      </div>

      <!-- 预约顺带生成状态横幅 -->
      <div
        v-if="queuedDelegation"
        class="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--rac-accent)]/50 bg-[var(--rac-accent)]/15 px-3 py-2"
      >
        <div class="font-mono text-[12px] text-[var(--rac-hi)]">
          ▲ 已预约摘要任务：下一轮正常聊天回复末尾将一并输出
          <strong>{{ queuedDelegation.tier === 'macro' ? '〈战役总纲〉' : '〈阶段摘要〉' }}</strong>
          [#{{ formatFloor(queuedDelegation.from) }}-#{{ formatFloor(queuedDelegation.to) }}]
        </div>
        <button type="button" class="sum-btn px-2.5 py-1 text-[12px]" @click="cancelDelegationQueue">
          取消预约
        </button>
      </div>

      <!-- 一键提炼操作卡（带进度引导说明） -->
      <div class="rounded border border-[var(--rac-dim)] bg-[var(--rac-panel)] p-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-[var(--rac-hi)]">战史提炼操作</div>
            <div class="mt-0.5 text-[12px] text-[var(--rac-text)]">
              <template v-if="canGenerateNext">
                可提炼区间 <strong class="font-mono text-[var(--rac-accent)]">#{{ formatFloor(nextRange![0]) }} ~ #{{ formatFloor(nextRange![1]) }}</strong> 楼（最近 {{ budgetDraft.tailReserveFloors }} 楼保留为实时对话不压缩，单段目标约 {{ budgetDraft.mesoSingleTargetTokens }} tok）。
              </template>
              <template v-else>
                当前聊天至 <strong class="font-mono text-[var(--rac-hi)]">#{{ currentFloor }}</strong> 楼。最近 {{ budgetDraft.tailReserveFloors }} 楼保留为实时对话，满 <strong class="font-mono text-[var(--rac-accent)]">#{{ (savedRanges.length ? Math.max(...savedRanges.map(r => r.to)) : 0) + budgetDraft.tailReserveFloors + 1 }}</strong> 楼后即可提炼下一段阶段摘要。
              </template>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="sum-btn sum-btn--primary px-3 py-1.5 text-xs font-semibold"
              :disabled="busy || !env.inTavern || !canGenerateNext"
              @click="generateNextSummary"
            >
              {{
                busy
                  ? '正在处理…'
                  : canGenerateNext
                    ? `${channelMode === 'delegate_main' ? '预约阶段摘要' : '生成阶段摘要'} [#${formatFloor(nextRange![0])}-#${formatFloor(nextRange![1])}]`
                    : '暂无可归档楼层'
              }}
            </button>

            <button
              type="button"
              class="sum-btn px-3 py-1.5 text-xs"
              :disabled="busy || !env.inTavern || !macroCandidate"
              :title="
                macroCandidate
                  ? `将 ${macroCandidate.mesoSegments.length} 段阶段摘要归并提炼为战役总纲（目标约 ${budgetDraft.macroSingleTargetTokens} tok）`
                  : '累积满 2 段阶段摘要后，可合成为跨阶段战役总纲'
              "
              @click="generateMacroSummary"
            >
              {{
                macroCandidate
                  ? `归并战役总纲 [#${formatFloor(macroCandidate.from)}-#${formatFloor(macroCandidate.to)}] (${macroCandidate.mesoSegments.length}段)`
                  : '归并战役总纲 (需满2段阶段摘要)'
              }}
            </button>
          </div>
        </div>
      </div>

      <!-- ── 待确认摘要草稿（pending_summaries） ── -->
      <div class="rounded border border-[var(--rac-dim)] bg-[var(--rac-panel)] p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="font-semibold text-[var(--rac-hi)]">
            待确认摘要草稿 ({{ pendingSummaries.length }})
          </span>
          <span class="text-[12px] text-[var(--rac-muted)]">
            草稿经你确认后才会正式写入世界书并隐藏原楼层
          </span>
        </div>

        <div
          v-if="!pendingSummaries.length"
          class="mt-2 rounded border border-dashed border-[var(--rac-dim)] bg-[var(--rac-bg)] px-3 py-3 text-[var(--rac-muted)]"
        >
          当前没有待确认的摘要草稿。
        </div>

        <div
          v-for="(draft, idx) in pendingSummaries"
          :key="(draft.tier ?? 'meso') + '-' + draft.from + '-' + draft.to + '-' + idx"
          class="mt-2.5 rounded border p-3"
          :class="
            draft.tier === 'macro'
              ? 'border-[var(--rac-focus)]/50 bg-[var(--rac-focus)]/10'
              : 'border-[var(--rac-warn)]/40 bg-[var(--rac-bg)]'
          "
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="rounded border px-1.5 py-0.5 font-mono text-[12px] font-semibold"
                :class="
                  draft.tier === 'macro'
                    ? 'border-[var(--rac-focus)]/50 bg-[var(--rac-focus)]/20 text-[var(--rac-hi)]'
                    : 'border-[var(--rac-warn)]/50 bg-[var(--rac-warn)]/20 text-[var(--rac-warn)]'
                "
              >
                {{ draft.tier === 'macro' ? '战役总纲' : '阶段摘要' }}
              </span>
              <span class="font-mono text-sm font-bold text-[var(--rac-hi)]">
                {{ renderSummaryComment(draft.from, draft.to, draft.tier === 'macro' ? 'macro' : 'meso') }}
              </span>
              <span class="font-mono text-[11px] text-[var(--rac-accent)]">
                ~{{ estimateTextTokens(draft.text) }} tok
              </span>
              <span class="font-mono text-[11px] text-[var(--rac-muted)]">
                {{ draft.model === 'main-llm-delegated' ? '主模型顺带生成' : draft.model || '默认模型' }}
                {{ draft.generatedAt ? '· ' + draft.generatedAt.slice(11, 16) : '' }}
              </span>
            </div>

            <div class="flex items-center gap-2">
              <button
                type="button"
                class="sum-btn sum-btn--primary px-3 py-1 text-[12px] font-semibold"
                :disabled="busy || !env.inTavern"
                @click="doAdopt(draft, idx)"
              >
                确认入档
              </button>
              <button
                type="button"
                class="sum-btn px-2.5 py-1 text-[12px]"
                :disabled="busy || !env.inTavern"
                @click="doRegenerate(draft, idx)"
              >
                重新生成
              </button>
              <button
                type="button"
                class="sum-btn sum-btn--danger px-2.5 py-1 text-[12px]"
                :disabled="busy"
                @click="doDiscardPending(idx)"
              >
                舍弃
              </button>
            </div>
          </div>

          <!-- 实体触发词列表 -->
          <div v-if="draft.keys && draft.keys.length" class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="k in draft.keys"
              :key="k"
              class="rounded border border-[var(--rac-accent)]/30 bg-[var(--rac-accent)]/15 px-2 py-0.5 font-mono text-[11px] text-[var(--rac-accent)]"
            >
              #{{ k }}
            </span>
          </div>

          <!-- 正文文本 -->
          <div class="mt-2 whitespace-pre-wrap leading-relaxed text-[var(--rac-text)]">
            {{ draft.text }}
          </div>
        </div>
      </div>

      <!-- ── 已归档战史卷宗（savedRanges） ── -->
      <div class="rounded border border-[var(--rac-dim)] bg-[var(--rac-panel)] p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="font-semibold text-[var(--rac-hi)]">
            已归档战史卷宗 ({{ savedRanges.length }})
          </span>
          <span class="text-[12px] text-[var(--rac-muted)]">
            点击任意条目可展开查阅完整摘要正文
          </span>
        </div>

        <div
          v-if="!savedRanges.length"
          class="mt-2 rounded border border-dashed border-[var(--rac-dim)] bg-[var(--rac-bg)] px-3 py-3 text-[var(--rac-muted)]"
        >
          当前聊天世界书内尚无已归档的战史卷宗。
        </div>

        <div
          v-for="r in savedRanges"
          :key="(r.tier ?? 'meso') + '-' + r.from + '-' + r.to"
          class="mt-2 rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] px-3 py-2"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div
              class="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-2"
              @click="toggleExpandSaved(r)"
            >
              <span
                class="rounded border px-1.5 py-0.5 font-mono text-[12px] font-semibold"
                :class="
                  r.tier === 'macro'
                    ? 'border-[var(--rac-focus)]/50 bg-[var(--rac-focus)]/20 text-[var(--rac-hi)]'
                    : 'border-[var(--rac-warn)]/50 bg-[var(--rac-warn)]/20 text-[var(--rac-warn)]'
                "
              >
                {{ r.tier === 'macro' ? '战役总纲' : '阶段摘要' }}
              </span>
              <span class="font-mono text-xs font-bold text-[var(--rac-hi)]">
                {{ renderSummaryComment(r.from, r.to, r.tier === 'macro' ? 'macro' : 'meso') }}
              </span>
              <span class="font-mono text-[11px] text-[var(--rac-accent)]">
                ~{{ estimateTextTokens(r.entry.content ?? '') }} tok
              </span>
              <span class="font-mono text-[12px] text-[var(--rac-text)]">
                {{ r.entry.strategy?.type === 'selective' ? '● 按关键词触发' : '◆ 常驻注入' }} · 深度
                {{ r.entry.position?.depth ?? DEFAULT_DEPTH }}
              </span>
              <span
                v-if="(r.entry.extra as Record<string, unknown> | undefined)?.coveredByMacro"
                class="font-mono text-[11px] text-[var(--rac-accent)]"
              >
                [已并入 {{ (r.entry.extra as Record<string, unknown>).coveredByMacro }}]
              </span>
              <span
                v-if="isRangeHidden(r.from, r.to)"
                class="rounded border border-[var(--rac-ok)]/40 bg-[var(--rac-ok)]/15 px-1.5 py-0.5 font-mono text-[12px] text-[var(--rac-ok)]"
              >
                原楼已隐藏
              </span>
              <span class="font-mono text-[12px] text-[var(--rac-accent)] hover:underline">
                {{ isSavedExpanded(r) ? '收起正文 ▲' : '查阅正文 ▼' }}
              </span>
            </div>

            <div class="flex flex-none items-center gap-2">
              <button
                type="button"
                class="sum-btn px-2.5 py-1 text-[12px]"
                :disabled="busy || !env.inTavern || !hidingGateApproved"
                @click="toggleRangeHide(r.from, r.to)"
              >
                <template v-if="!hidingGateApproved">隐藏已停用</template>
                <template v-else-if="isRangeHidden(r.from, r.to)">恢复显示原楼</template>
                <template v-else>隐藏原楼</template>
              </button>

              <button
                type="button"
                class="sum-btn sum-btn--danger px-2.5 py-1 text-[12px]"
                :disabled="busy || !env.inTavern"
                title="从世界书移除此条摘要；若为阶段摘要将同时恢复显示对应区间的原始楼层"
                @click="doDiscardSaved(r.from, r.to, r.tier)"
              >
                删除归档
              </button>
            </div>
          </div>

          <!-- 展开查阅已归档摘要正文与触发关键词 -->
          <div
            v-if="isSavedExpanded(r)"
            class="mt-2 border-t border-[var(--rac-dim)] pt-2"
          >
            <div
              v-if="Array.isArray(r.entry.strategy?.keys) && r.entry.strategy.keys.length"
              class="mb-2 flex flex-wrap gap-1.5"
            >
              <span
                v-for="k in r.entry.strategy.keys"
                :key="k"
                class="rounded border border-[var(--rac-accent)]/30 bg-[var(--rac-accent)]/15 px-2 py-0.5 font-mono text-[11px] text-[var(--rac-accent)]"
              >
                #{{ k }}
              </span>
            </div>
            <div class="whitespace-pre-wrap leading-relaxed text-[var(--rac-text)]">
              {{ r.entry.content || '（无正文内容）' }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══════════════════ 子页 2：逐楼纪要（小摘要流水） ══════════════════ -->
    <div v-else-if="activeSubTab === 'micro'" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--rac-dim)] bg-[var(--rac-panel)] p-3">
        <div>
          <div class="font-semibold text-[var(--rac-hi)]">
            逐楼战地纪要流水 ({{ microSummaries.length }}) · 共约 {{ breakdown.microTokens }} tok
          </div>
          <div class="mt-0.5 text-[12px] text-[var(--rac-text)]">
            每轮 AI 回复中的 &lt;摘要&gt; 纪要会自动记录于此，并在提炼阶段摘要时优先作为高密度时间线输入。
          </div>
        </div>
        <button
          type="button"
          class="sum-btn sum-btn--primary px-3 py-1.5 text-xs font-semibold"
          :disabled="busy || !env.inTavern"
          @click="scanMicroSummariesFromChat"
        >
          扫描历史聊天补全
        </button>
      </div>

      <div class="max-h-96 overflow-y-auto rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] p-3">
        <div v-if="!microSummaries.length" class="py-3 text-[var(--rac-muted)]">
          暂无逐楼纪要记录。AI 回复附带 &lt;摘要&gt; 后会自动归入流水，也可点击右上角「扫描历史聊天补全」一键提取。
        </div>
        <div
          v-for="m in reversedMicroSummaries"
          :key="m.floor"
          class="border-b border-[var(--rac-dim)] py-2.5 last:border-b-0"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="font-mono text-xs font-bold text-[var(--rac-accent)]">#{{ formatFloor(m.floor) }}</span>
              <span v-if="m.date" class="font-mono text-[11px] text-[var(--rac-warn)]">[{{ m.date }}]</span>
              <span class="font-mono text-[11px] text-[var(--rac-muted)]">~{{ estimateTextTokens(m.text) }} tok</span>
            </div>
            <div v-if="m.keys?.length" class="flex flex-wrap gap-1.5">
              <span
                v-for="k in m.keys"
                :key="k"
                class="rounded border border-[var(--rac-dim)] bg-[var(--rac-panel)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--rac-text)]"
              >
                #{{ k }}
              </span>
            </div>
          </div>
          <div class="mt-1 leading-relaxed text-[var(--rac-text)]">{{ m.text }}</div>
        </div>
      </div>
    </div>

    <!-- ══════════════════ 子页 3：生成与接口设置 ══════════════════ -->
    <div v-else-if="activeSubTab === 'config'" class="flex flex-col gap-3">
      <!-- 1. 摘要生成方式（两张清晰的模式选择卡） -->
      <div class="rounded border border-[var(--rac-dim)] bg-[var(--rac-panel)] p-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="font-semibold text-[var(--rac-hi)]">第一步：选择摘要生成方式</span>
          <span class="text-[12px] text-[var(--rac-muted)]">点击卡片即可切换</span>
        </div>

        <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            class="flex flex-col items-start rounded border p-3 text-left transition-colors"
            :class="
              channelMode === 'delegate_main'
                ? 'border-[var(--rac-accent)] bg-[var(--rac-accent)]/15 text-[var(--rac-hi)] shadow-sm'
                : 'border-[var(--rac-dim)] bg-[var(--rac-bg)] text-[var(--rac-text)] hover:border-[var(--rac-line)]'
            "
            @click="setChannel('delegate_main')"
          >
            <div class="flex w-full items-center justify-between gap-2">
              <span class="font-semibold text-[var(--rac-hi)]">主模型顺带生成（省心免配）</span>
              <span
                class="rounded px-1.5 py-0.5 font-mono text-[12px]"
                :class="
                  channelMode === 'delegate_main'
                    ? 'bg-[var(--rac-accent)]/25 text-[var(--rac-hi)] border border-[var(--rac-accent)]/40'
                    : 'bg-[var(--rac-panel-2)] text-[var(--rac-muted)]'
                "
              >
                {{ channelMode === 'delegate_main' ? '◆ 当前使用' : '零额外调用' }}
              </span>
            </div>
            <div class="mt-1.5 text-[12px] leading-relaxed text-[var(--rac-text)]">
              无需配置额外接口。点击预约后，由当前聊天主模型在下一轮正常回复末尾顺带输出阶段摘要或战役总纲。
            </div>
          </button>

          <button
            type="button"
            class="flex flex-col items-start rounded border p-3 text-left transition-colors"
            :class="
              channelMode === 'generate_raw'
                ? 'border-[var(--rac-accent)] bg-[var(--rac-accent)]/15 text-[var(--rac-hi)] shadow-sm'
                : 'border-[var(--rac-dim)] bg-[var(--rac-bg)] text-[var(--rac-text)] hover:border-[var(--rac-line)]'
            "
            @click="setChannel('generate_raw')"
          >
            <div class="flex w-full items-center justify-between gap-2">
              <span class="font-semibold text-[var(--rac-hi)]">后台独立模型生成（即时出稿）</span>
              <span
                class="rounded px-1.5 py-0.5 font-mono text-[12px]"
                :class="
                  channelMode === 'generate_raw'
                    ? 'bg-[var(--rac-accent)]/25 text-[var(--rac-hi)] border border-[var(--rac-accent)]/40'
                    : 'bg-[var(--rac-panel-2)] text-[var(--rac-muted)]'
                "
              >
                {{ channelMode === 'generate_raw' ? '◆ 当前使用' : '支持副模型' }}
              </span>
            </div>
            <div class="mt-1.5 text-[12px] leading-relaxed text-[var(--rac-text)]">
              点击生成时立即在后台单独发起请求，不占用主对话回复；可直接复用主接口，或绑定便宜高速的副模型。
            </div>
          </button>
        </div>

        <!-- 若选了主模型顺带生成，给出清爽提示，不展示下面复杂的副模型接口表单 -->
        <div
          v-if="channelMode === 'delegate_main'"
          class="mt-2.5 rounded border border-[var(--rac-ok)]/40 bg-[var(--rac-ok)]/15 px-3 py-2 text-[12px] text-[var(--rac-ok)]"
        >
          ◆ 当前使用「主模型顺带生成」，无需配置下方副模型接口，直接前往「战史摘要」页预约生成即可。
        </div>

        <!-- 2. 后台摘要专用模型接口（仅在选「后台独立模型生成」时展开） -->
        <div
          v-else
          class="mt-3 rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] p-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div class="font-semibold text-[var(--rac-hi)]">后台摘要模型来源</div>
              <div class="text-[12px] text-[var(--rac-muted)]">选择后台生成摘要时调用的接口</div>
            </div>

            <!-- 3 个清晰的模式切换胶囊按钮 -->
            <div class="inline-flex flex-wrap items-center gap-1 rounded border border-[var(--rac-dim)] bg-[var(--rac-panel)] p-1">
              <button
                type="button"
                class="sum-pill"
                :class="{ 'sum-pill--active': endpointDraft.mode === 'default' }"
                @click="selectEndpointMode('default')"
              >
                跟随酒馆主接口（默认）
              </button>
              <button
                type="button"
                class="sum-pill"
                :class="{ 'sum-pill--active': endpointDraft.mode === 'proxy_preset' }"
                @click="selectEndpointMode('proxy_preset')"
              >
                酒馆连接预设
              </button>
              <button
                type="button"
                class="sum-pill"
                :class="{ 'sum-pill--active': endpointDraft.mode === 'custom' }"
                @click="selectEndpointMode('custom')"
              >
                自定义直连 API
              </button>
            </div>
          </div>

          <!-- 模式 A：跟随酒馆主接口 -->
          <div v-if="endpointDraft.mode === 'default'" class="mt-3 border-t border-[var(--rac-dim)] pt-2.5">
            <div class="mb-2 text-[12px] text-[var(--rac-ok)]">
              ◆ 直接使用你在酒馆里当前连接好的主接口，无需填写 API 地址与密钥。
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <label class="text-[12px] text-[var(--rac-text)]">指定模型名称（选填）：</label>
              <input
                v-model="endpointDraft.model"
                type="text"
                class="sum-input min-w-[240px] flex-1"
                placeholder="留空即可（默认完全跟随当前聊天模型）"
              />
              <button type="button" class="sum-btn sum-btn--primary px-3 py-1.5 text-[12px]" @click="saveEndpointConfig">
                保存设置
              </button>
            </div>
          </div>

          <!-- 模式 B：使用酒馆连接预设 -->
          <div v-else-if="endpointDraft.mode === 'proxy_preset'" class="mt-3 border-t border-[var(--rac-dim)] pt-2.5">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div class="mb-1 text-[12px] text-[var(--rac-text)]">酒馆连接预设名称</div>
                <input
                  v-model="endpointDraft.proxyPreset"
                  type="text"
                  class="sum-input w-full"
                  placeholder="填写酒馆 API 连接里的预设名，如 DeepSeek-V3"
                />
              </div>
              <div>
                <div class="mb-1 text-[12px] text-[var(--rac-text)]">覆盖模型名称（选填）</div>
                <input
                  v-model="endpointDraft.model"
                  type="text"
                  class="sum-input w-full"
                  placeholder="留空则使用该预设自带的默认模型"
                />
              </div>
            </div>
            <div class="mt-2.5 flex justify-end">
              <button type="button" class="sum-btn sum-btn--primary px-3 py-1.5 text-[12px]" @click="saveEndpointConfig">
                保存预设配置
              </button>
            </div>
          </div>

          <!-- 模式 C：自定义直连 API -->
          <div v-else-if="endpointDraft.mode === 'custom'" class="mt-3 border-t border-[var(--rac-dim)] pt-2.5">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div class="mb-1 text-[12px] text-[var(--rac-text)]">接口地址 (API URL)</div>
                <input
                  v-model="endpointDraft.apiurl"
                  type="text"
                  class="sum-input w-full"
                  placeholder="https://api.openai.com/v1"
                />
              </div>
              <div>
                <div class="mb-1 flex items-center justify-between text-[12px] text-[var(--rac-text)]">
                  <span>接口密钥 (API Key)</span>
                  <button
                    type="button"
                    class="text-[12px] text-[var(--rac-accent)] hover:underline"
                    @click="showApiKey = !showApiKey"
                  >
                    {{ showApiKey ? '隐藏密钥' : '显示密钥' }}
                  </button>
                </div>
                <input
                  v-model="endpointDraft.key"
                  :type="showApiKey ? 'text' : 'password'"
                  class="sum-input w-full"
                  placeholder="sk-..."
                />
              </div>
              <div>
                <div class="mb-1 text-[12px] text-[var(--rac-text)]">模型名称 (Model)</div>
                <input
                  v-model="endpointDraft.model"
                  type="text"
                  class="sum-input w-full"
                  placeholder="例如：deepseek-chat / gpt-4o-mini / gemini-2.5-flash"
                />
              </div>
              <div>
                <div class="mb-1 text-[12px] text-[var(--rac-text)]">接口协议类型</div>
                <select v-model="endpointDraft.source" class="sum-input w-full">
                  <option value="openai">OpenAI 兼容接口（通用反代）</option>
                  <option value="deepseek">DeepSeek 官方</option>
                  <option value="claude">Claude (Anthropic)</option>
                  <option value="makersuite">Google Gemini</option>
                </select>
              </div>
            </div>
            <div class="mt-2.5 flex justify-end">
              <button type="button" class="sum-btn sum-btn--primary px-3 py-1.5 text-[12px]" @click="saveEndpointConfig">
                保存直连配置
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. 归档与楼层隐藏规则（清晰的横向行 + 右侧双按钮分段开关，绝不折行） -->
      <div class="rounded border border-[var(--rac-dim)] bg-[var(--rac-panel)] p-3">
        <div class="mb-2 font-semibold text-[var(--rac-hi)]">第二步：归档与楼层隐藏规则</div>

        <div class="divide-y divide-[var(--rac-dim)]">
          <!-- 规则 0：摘要草稿自动确认入档（默认开启） -->
          <div class="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-1">
            <div class="min-w-[200px] flex-1">
              <div class="font-medium text-[var(--rac-hi)]">摘要生成后确认方式</div>
              <div class="mt-0.5 text-[12px] text-[var(--rac-text)]">
                默认开启自动确认：阶段摘要或战役总纲生成后立即写入聊天世界书并按规则隐藏原楼层，免去二次手动确认。
              </div>
            </div>
            <div class="inline-flex flex-none items-center gap-1 rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] p-1">
              <button
                type="button"
                class="sum-pill"
                :class="{ 'sum-pill--active': autoConfirmMode }"
                @click="setAutoConfirm(true)"
              >
                自动确认入档（默认）
              </button>
              <button
                type="button"
                class="sum-pill"
                :class="{ 'sum-pill--active': !autoConfirmMode }"
                @click="setAutoConfirm(false)"
              >
                人工确认后入档
              </button>
            </div>
          </div>

          <!-- 规则 A：入档后原楼层处理 -->
          <div class="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div class="min-w-[200px] flex-1">
              <div class="font-medium text-[var(--rac-hi)]">确认入档后原楼层处理</div>
              <div class="mt-0.5 text-[12px] text-[var(--rac-text)]">
                自动隐藏已归档的历史楼层可大幅节省上下文开销；删除归档时会自动恢复显示。
              </div>
            </div>
            <div class="inline-flex flex-none items-center gap-1 rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] p-1">
              <button
                type="button"
                class="sum-pill"
                :class="{ 'sum-pill--active': floorHandlingMode === 'hide' }"
                @click="setFloorHandling('hide')"
              >
                自动隐藏原楼层（默认）
              </button>
              <button
                type="button"
                class="sum-pill"
                :class="{ 'sum-pill--active': floorHandlingMode === 'keep' }"
                @click="setFloorHandling('keep')"
              >
                保留原楼层不隐藏
              </button>
            </div>
          </div>

          <!-- 规则 B：生成触发时机 -->
          <div class="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div class="min-w-[200px] flex-1">
              <div class="font-medium text-[var(--rac-hi)]">阶段摘要触发时机</div>
              <div class="mt-0.5 text-[12px] text-[var(--rac-text)]">
                自动模式下每满 {{ DEFAULT_SUMMARY_N }} 楼自动生成草稿放入待确认区，仍需你确认后才入档。
              </div>
            </div>
            <div class="inline-flex flex-none items-center gap-1 rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] p-1">
              <button
                type="button"
                class="sum-pill"
                :class="{ 'sum-pill--active': triggerMode === 'manual' }"
                @click="setTrigger('manual')"
              >
                手动生成 + 满楼提醒
              </button>
              <button
                type="button"
                class="sum-pill"
                :class="{ 'sum-pill--active': triggerMode === 'auto' }"
                @click="setTrigger('auto')"
              >
                每满 {{ DEFAULT_SUMMARY_N }} 楼自动生成草稿（默认）
              </button>
            </div>
          </div>

          <!-- 规则 C：世界书注入方式 -->
          <div class="flex flex-wrap items-center justify-between gap-3 py-2.5 last:pb-1">
            <div class="min-w-[200px] flex-1">
              <div class="font-medium text-[var(--rac-hi)]">阶段摘要世界书激活方式</div>
              <div class="mt-0.5 text-[12px] text-[var(--rac-text)]">
                战役总纲固定为蓝灯常驻；已归并进总纲的旧阶段摘要会自动转为绿灯按关键词触发。
              </div>
            </div>
            <div class="inline-flex flex-none items-center gap-1 rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] p-1">
              <button
                type="button"
                class="sum-pill"
                :class="{ 'sum-pill--active': strategyMode === 'constant' }"
                @click="setStrategy('constant')"
              >
                ◆ 常驻注入（默认）
              </button>
              <button
                type="button"
                class="sum-pill"
                :class="{ 'sum-pill--active': strategyMode === 'selective' }"
                @click="setStrategy('selective')"
              >
                ● 按关键词触发
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. 底层兼容性诊断（默认折叠） -->
      <details class="rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] px-3 py-2">
        <summary class="cursor-pointer select-none text-[12px] text-[var(--rac-muted)] hover:text-[var(--rac-hi)]">
          高级：楼层隐藏开关与宿主兼容性自检（当前状态：{{ hidingGateApproved ? '已启用' : '已停用' }}）
        </summary>
        <div class="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--rac-dim)] pt-2.5">
          <div class="flex items-center gap-2 text-[12px]">
            <span class="text-[var(--rac-text)]">楼层隐藏功能状态：</span>
            <span
              class="font-mono font-semibold"
              :class="hidingGateApproved ? 'text-[var(--rac-ok)]' : 'text-[var(--rac-warn)]'"
            >
              {{ hidingGateApproved ? '已启用（默认开启可用）' : '已停用（隐藏按钮置灰）' }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="sum-btn px-2.5 py-1 text-[12px]"
              :disabled="busy || !env.inTavern"
              @click="runHidingProbe"
            >
              运行兼容性自检
            </button>
            <button
              type="button"
              class="sum-btn px-2.5 py-1 text-[12px]"
              :class="hidingGateApproved ? 'sum-btn--danger' : 'sum-btn--primary'"
              @click="toggleHidingGate"
            >
              {{ hidingGateApproved ? '停用楼层隐藏' : '启用楼层隐藏' }}
            </button>
          </div>
        </div>

        <div v-if="probeReport" class="mt-2 border-t border-[var(--rac-dim)] pt-2 text-xs">
          <div class="flex items-center gap-2">
            <span :class="probeReport.ok ? 'text-[var(--rac-ok)]' : 'text-[var(--rac-alert)]'">
              {{ probeReport.ok ? '◆ 自检正常' : '× 自检异常' }}
            </span>
            <span class="font-mono text-[12px] text-[var(--rac-text)]">
              {{ probeReport.note }}
            </span>
          </div>
          <pre class="mt-1.5 max-h-24 overflow-auto rounded border border-[var(--rac-dim)] bg-[var(--rac-bg)] p-2 font-mono text-[11px] text-[var(--rac-text)]">{{
            JSON.stringify(probeReport.observed, null, 2)
          }}</pre>
        </div>
      </details>
    </div>

    <!-- 底部操作回执 / 报错横幅 -->
    <div
      v-if="infoMsg"
      class="rounded border border-[var(--rac-ok)]/40 bg-[var(--rac-ok)]/15 px-3 py-2 text-xs text-[var(--rac-ok)]"
    >
      ◆ {{ infoMsg }}
    </div>
    <div
      v-if="errorMsg"
      class="rounded border border-[var(--rac-alert)]/50 bg-[var(--rac-alert)]/15 px-3 py-2 text-xs text-[var(--rac-alert)]"
    >
      × {{ errorMsg }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import Icon from '../Icon.vue';
import { chatBookGateway } from '../../worldbook/chatBookBinding';
import type { ThEntry } from '../../worldbook/girlFiler';
import type { MicroSummaryItem, SummaryDraft } from '../../core/schema';
import { in_tavern, useDataStore } from '../../composables/store';
import {
  DEFAULT_DEPTH,
  DEFAULT_SUMMARY_N,
  SUMMARY_BUDGET_PRESETS,
  adoptSummary,
  buildMacroSummarySourceDigest,
  buildMesoSummarySourceDigest,
  computeSummaryContextBreakdown,
  discardSummary,
  estimateTextTokens,
  extractSummaryRanges,
  formatFloor,
  formatMicroSummariesForPrompt,
  getSummaryAutoConfirm,
  getSummaryBudgetConfig,
  getSummaryChannel,
  getSummaryEndpointConfig,
  getSummaryFloorHandling,
  getSummaryStrategy,
  getSummaryTrigger,
  hideRange,
  isHidingGateApproved,
  nextMacroSummaryCandidate,
  nextSummaryRange,
  probeHiddenFloorEffects,
  renderSummaryComment,
  requestMacroSummary,
  requestSummary,
  setHidingGateApproved,
  setSummaryAutoConfirm,
  setSummaryBudgetConfig,
  setSummaryChannel,
  setSummaryEndpointConfig,
  setSummaryFloorHandling,
  setSummaryStrategy,
  setSummaryTrigger,
  unhideRange,
  upsertMicroSummary,
  type ProbeReport,
  type SummaryBudgetConfig,
  type SummaryBudgetPresetKey,
  type SummaryChannel,
  type SummaryEndpointConfig,
  type SummaryEndpointMode,
  type SummaryFloorHandling,
  type SummaryRangeInfo,
  type SummaryStrategy,
  type SummaryTrigger,
} from '../../worldbook/summaryFiler';
import { extractFloorSummaries } from '../../parse/summaryBlockParser';
import { checkEnv, tav } from '../../parse/systemCheck';
import { useFloatingStore } from '../../composables/useFloatingStore';
import { playTacticalStagger, scheduleNextFrame, useGsapNumber } from '../motion/useGsapMotion';
import { updateFloorVars } from '../../../中控悬浮窗/host/floorVarWrite';
import {
  clearSummaryDelegationPrompt,
  clearSummaryDelegationTask,
  getQueuedSummaryDelegationTask,
  queueSummaryDelegationTask,
  syncSummaryDelegationPrompt,
  type SummaryDelegationTask,
} from '../../../中控悬浮窗/host/summaryRunner';

const store = useDataStore();
const floating = useFloatingStore();
const env = checkEnv(in_tavern);

/**
 * 纯 JSON 深拷贝：剥离 Vue 3 响应式 Proxy，避免真机浏览器调用 window.structuredClone(Proxy)
 * 抛出 DataCloneError: Failed to execute 'structuredClone' on 'Window': [object Object] could not be cloned.
 */
function clonePlain<T>(val: T): T {
  if (val === undefined || val === null) return val;
  return JSON.parse(JSON.stringify(val)) as T;
}

async function syncPendingSummariesToFloor() {
  if (floating.floorId === null) return;
  const nextPending = clonePlain(store.data.pending_summaries ?? []);
  const nextMicro = store.data.micro_summaries ? clonePlain(store.data.micro_summaries) : undefined;
  await updateFloorVars(floating.floorId, vars => {
    const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
    return {
      ...vars,
      stat_data: {
        ...sd,
        pending_summaries: clonePlain(nextPending),
        ...(nextMicro !== undefined ? { micro_summaries: clonePlain(nextMicro) } : {}),
      },
    };
  });
  await floating.refresh();
}

const activeSubTab = ref<'archive' | 'micro' | 'config'>('archive');
const showBudgetSliders = ref(true);
const showApiKey = ref(false);
const busy = ref(false);
const infoMsg = ref('');
const errorMsg = ref('');
const savedRanges = ref<SummaryRangeInfo[]>([]);
const rawChatMessages = ref<Array<{ message_id: number; message?: string; is_hidden?: boolean }>>([]);
const expandedSavedKeys = ref<Set<string>>(new Set());
const boundBookName = ref<string | null>(null);
const hiddenRangesSet = ref<Set<string>>(new Set());
const probeReport = ref<ProbeReport | null>(null);
const queuedDelegation = ref<SummaryDelegationTask | null>(getQueuedSummaryDelegationTask());

function savedKey(r: SummaryRangeInfo): string {
  return `${r.tier ?? 'meso'}-${r.from}-${r.to}`;
}
function isSavedExpanded(r: SummaryRangeInfo): boolean {
  return expandedSavedKeys.value.has(savedKey(r));
}
function toggleExpandSaved(r: SummaryRangeInfo) {
  const key = savedKey(r);
  const next = new Set(expandedSavedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedSavedKeys.value = next;
}

// 设置项与三档预算响应式
const autoConfirmMode = ref<boolean>(getSummaryAutoConfirm());
const strategyMode = ref<SummaryStrategy>(getSummaryStrategy());
const triggerMode = ref<SummaryTrigger>(getSummaryTrigger());
const floorHandlingMode = ref<SummaryFloorHandling>(getSummaryFloorHandling());
const hidingGateApproved = ref<boolean>(isHidingGateApproved());
const channelMode = ref<SummaryChannel>(getSummaryChannel());
const endpointDraft = reactive<SummaryEndpointConfig>(getSummaryEndpointConfig());
const budgetDraft = reactive<SummaryBudgetConfig>(getSummaryBudgetConfig());

function setAutoConfirm(v: boolean) {
  autoConfirmMode.value = v;
  setSummaryAutoConfirm(v);
  if (v && pendingSummaries.value.length > 0 && env.inTavern && !busy.value) {
    void autoAdoptAllPending();
  }
}

function onBudgetSliderInput() {
  const saved = setSummaryBudgetConfig({ ...budgetDraft });
  Object.assign(budgetDraft, saved);
}

function onBudgetNumberCommit() {
  const saved = setSummaryBudgetConfig({ ...budgetDraft });
  Object.assign(budgetDraft, saved);
}

function applyBudgetPreset(key: SummaryBudgetPresetKey) {
  const preset = SUMMARY_BUDGET_PRESETS[key];
  if (!preset) return;
  const saved = setSummaryBudgetConfig({ ...preset.config });
  Object.assign(budgetDraft, saved);
  infoMsg.value = `已切换至「${preset.label}」预算方案（摘要总预算 ${saved.macroBudgetTokens + saved.mesoBudgetTokens + saved.microBudgetTokens} tok · 保留近 ${saved.tailReserveFloors} 楼原文）`;
}

function isPresetMatched(key: SummaryBudgetPresetKey): boolean {
  const p = SUMMARY_BUDGET_PRESETS[key]?.config;
  if (!p) return false;
  return (
    budgetDraft.macroBudgetTokens === p.macroBudgetTokens &&
    budgetDraft.mesoBudgetTokens === p.mesoBudgetTokens &&
    budgetDraft.microBudgetTokens === p.microBudgetTokens &&
    budgetDraft.tailReserveFloors === p.tailReserveFloors
  );
}

function setStrategy(v: SummaryStrategy) {
  strategyMode.value = v;
  setSummaryStrategy(v);
}
function setTrigger(v: SummaryTrigger) {
  triggerMode.value = v;
  setSummaryTrigger(v);
}
function setFloorHandling(v: SummaryFloorHandling) {
  floorHandlingMode.value = v;
  setSummaryFloorHandling(v);
}
function setChannel(v: SummaryChannel) {
  channelMode.value = v;
  setSummaryChannel(v);
  if (v === 'generate_raw') {
    clearSummaryDelegationPrompt();
  } else {
    queuedDelegation.value = syncSummaryDelegationPrompt(store.data, {
      currentFloor: currentFloor.value,
      worldbookEntries: savedRanges.value.map(r => r.entry),
    });
  }
}
function selectEndpointMode(mode: SummaryEndpointMode) {
  endpointDraft.mode = mode;
  const saved = setSummaryEndpointConfig({ ...endpointDraft });
  Object.assign(endpointDraft, saved);
}
function saveEndpointConfig() {
  const saved = setSummaryEndpointConfig({ ...endpointDraft });
  Object.assign(endpointDraft, saved);
  infoMsg.value =
    saved.mode === 'custom'
      ? `已保存自定义直连 API (${saved.model || saved.source})`
      : saved.mode === 'proxy_preset'
        ? `已保存酒馆连接预设 (${saved.proxyPreset || '默认'})`
        : '已保存：后台摘要跟随当前酒馆主接口';
}
function cancelDelegationQueue() {
  clearSummaryDelegationTask();
  clearSummaryDelegationPrompt();
  queuedDelegation.value = null;
  infoMsg.value = '已取消下一轮顺带生成摘要预约';
}
function toggleHidingGate() {
  const next = !hidingGateApproved.value;
  hidingGateApproved.value = next;
  setHidingGateApproved(next);
}

// 暂存草稿列表与逐楼小摘要列表
const pendingSummaries = computed(() => store.data.pending_summaries ?? []);
const microSummaries = computed<MicroSummaryItem[]>(() => store.data.micro_summaries ?? []);
const reversedMicroSummaries = computed(() => [...microSummaries.value].sort((a, b) => b.floor - a.floor));

// 读取当前最新楼层号
function readCurrentFloor(): number {
  const getLastId = tav<() => number>('getLastMessageId');
  if (getLastId) {
    try {
      return getLastId();
    } catch {
      /* ignore */
    }
  }
  return 0;
}

const currentFloor = ref(readCurrentFloor());

// 下一可用中摘要区间计算（跟随玩家动态调节的近场保留楼层数）
const nextRange = computed(() => {
  const entries = savedRanges.value.map(r => r.entry);
  return nextSummaryRange(entries, currentFloor.value, budgetDraft.tailReserveFloors);
});

const canGenerateNext = computed(() => nextRange.value !== null);

// 下一可用大摘要归并候选
const macroCandidate = computed(() => {
  const entries = savedRanges.value.map(r => r.entry);
  return nextMacroSummaryCandidate(entries, { minCount: 2 });
});

// 统计未摘要楼层数
const unsummarizedCount = computed(() => {
  const maxTo = savedRanges.value.length ? Math.max(...savedRanges.value.map(r => r.to)) : 0;
  return Math.max(0, currentFloor.value - maxTo);
});

// 实时计算大、中、小三档摘要 + 未被隐藏聊天正文的 Token 总量与各自占比
const breakdown = computed(() =>
  computeSummaryContextBreakdown({
    savedRanges: savedRanges.value,
    microSummaries: microSummaries.value,
    rawMessages: rawChatMessages.value,
    hiddenRangeKeys: hiddenRangesSet.value,
    currentFloor: currentFloor.value,
    budgetConfig: budgetDraft,
  }),
);

const summariesRootRef = ref<HTMLElement | null>(null);
const animatedGrandTotalTokens = useGsapNumber(() => breakdown.value.grandTotalTokens, { duration: 0.35 });
const animatedSummaryTotalTokens = useGsapNumber(() => breakdown.value.summaryTotalTokens, { duration: 0.35 });
const animatedUnhiddenRawTokens = useGsapNumber(() => breakdown.value.unhiddenRawTokens, { duration: 0.35 });

watch(
  () => [activeSubTab.value, showBudgetSliders.value],
  () => {
    scheduleNextFrame(() => {
      playTacticalStagger(summariesRootRef.value, '.rounded.border', { maxItems: 12, duration: 0.16 });
    });
  },
);

function isRangeHidden(from: number, to: number): boolean {
  return hiddenRangesSet.value.has(`${from}-${to}`);
}

/** 刷新当前聊天书中的摘要条目与未隐藏楼层正文读数 */
async function refreshRanges() {
  currentFloor.value = readCurrentFloor();
  queuedDelegation.value = getQueuedSummaryDelegationTask();

  const getMsgs =
    tav<
      (
        range: string | number,
        opts?: { hide_state?: string },
      ) => Array<{ message_id: number; message?: string; is_hidden?: boolean }>
    >('getChatMessages');

  if (getMsgs && currentFloor.value > 0) {
    try {
      const allMsgs = getMsgs(`1-${currentFloor.value}`, { hide_state: 'all' });
      rawChatMessages.value = Array.isArray(allMsgs) ? allMsgs : [];
    } catch {
      rawChatMessages.value = [];
    }
  } else {
    rawChatMessages.value = [];
  }

  const getBound = tav<(chat: 'current') => string | null>('getChatWorldbookName');
  const getWb = tav<(name: string) => Promise<ThEntry[]>>('getWorldbook');

  if (!getBound || !getWb) {
    savedRanges.value = [];
    return;
  }

  try {
    const book = getBound('current');
    boundBookName.value = book;
    if (!book) {
      savedRanges.value = [];
      return;
    }
    const entries = await getWb(book);
    savedRanges.value = extractSummaryRanges(entries);
    if (getMsgs) {
      const nextHidden = new Set<string>();
      for (const r of savedRanges.value) {
        try {
          const msgs = getMsgs(`${r.from}-${r.to}`);
          if (Array.isArray(msgs) && msgs.length > 0 && msgs.some(m => m.is_hidden === true)) {
            nextHidden.add(`${r.from}-${r.to}`);
          }
        } catch {
          if (hiddenRangesSet.value.has(`${r.from}-${r.to}`)) {
            nextHidden.add(`${r.from}-${r.to}`);
          }
        }
      }
      hiddenRangesSet.value = nextHidden;
    }
  } catch (e) {
    errorMsg.value = `刷新世界书摘要失败: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** 扫描当前聊天楼层中的 <摘要>/<summary> 标签并补齐到 micro_summaries */
async function scanMicroSummariesFromChat() {
  busy.value = true;
  infoMsg.value = '';
  errorMsg.value = '';
  try {
    const lastId = readCurrentFloor();
    const getMsgs =
      tav<(range: string | number) => Array<{ message_id: number; message: string; role: string }>>('getChatMessages');
    if (!getMsgs || lastId <= 0) {
      infoMsg.value = '当前无楼层可供扫描';
      return;
    }
    const msgs = getMsgs(`1-${lastId}`);
    let list = [...(store.data.micro_summaries ?? [])];
    let added = 0;
    for (const m of msgs) {
      const parsed = extractFloorSummaries(m.message ?? '');
      if (parsed.micro) {
        list = upsertMicroSummary(list, {
          floor: m.message_id,
          date: parsed.micro.date || store.data.meta?.date || '',
          text: parsed.micro.text,
          keys: parsed.micro.keys,
          updatedAt: new Date().toISOString(),
        });
        added++;
      }
    }
    store.data.micro_summaries = list;
    await syncPendingSummariesToFloor();
    activeSubTab.value = 'micro';
    infoMsg.value = `扫描完毕：共从 1~#${lastId} 楼提取/更新 ${added} 条逐楼纪要`;
  } catch (e) {
    errorMsg.value = `扫描逐楼纪要失败: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = false;
  }
}

/** 采纳暂存摘要草稿 */
async function doAdopt(draft: SummaryDraft, index: number) {
  busy.value = true;
  infoMsg.value = '';
  errorMsg.value = '';
  try {
    const plainDraft = clonePlain(draft);
    const receipt = await adoptSummary(plainDraft, {
      gateway: chatBookGateway,
      strategyType: strategyMode.value,
      floorHandling: floorHandlingMode.value,
      currentFloor: currentFloor.value,
      tailReserve: budgetDraft.tailReserveFloors,
      onAdopted: () => {
        if (index >= 0 && index < store.data.pending_summaries.length) {
          store.data.pending_summaries.splice(index, 1);
        } else {
          const matchIdx = store.data.pending_summaries.findIndex(
            p => p.from === plainDraft.from && p.to === plainDraft.to && (p.tier ?? 'meso') === (plainDraft.tier ?? 'meso'),
          );
          if (matchIdx >= 0) store.data.pending_summaries.splice(matchIdx, 1);
        }
      },
    });

    if (receipt.hidden) {
      hiddenRangesSet.value.add(`${receipt.from}-${receipt.to}`);
    }
    try {
      await syncPendingSummariesToFloor();
    } catch (syncErr) {
      console.warn('[PanelSummaries] 同步待确认摘要列表至楼层变量异常:', syncErr);
    }
    const demotedNote =
      receipt.demotedMesoComments && receipt.demotedMesoComments.length > 0
        ? `，已将 ${receipt.demotedMesoComments.length} 段旧阶段摘要转为按关键词触发`
        : '';
    infoMsg.value = `已将 ${receipt.comment} 归档至《${receipt.book}》${receipt.hidden ? `并隐藏 ${receipt.hiddenFloors.length} 楼原文` : ''}${demotedNote}`;
    await refreshRanges();
  } catch (e) {
    errorMsg.value = `归档失败: ${e instanceof Error ? e.message : String(e)}`;
    await refreshRanges().catch(() => {});
  } finally {
    busy.value = false;
  }
}

/** 自动确认并归档全部待确认摘要草稿（当开启「自动确认入档」时调用） */
async function autoAdoptAllPending() {
  if (!autoConfirmMode.value || !env.inTavern || busy.value) return;
  while ((store.data.pending_summaries?.length ?? 0) > 0) {
    const first = store.data.pending_summaries[0];
    if (!first) break;
    await doAdopt(first, 0);
    if (errorMsg.value) break;
  }
}

/** 重新生成摘要 */
async function doRegenerate(draft: SummaryDraft, index: number) {
  busy.value = true;
  infoMsg.value = '';
  errorMsg.value = '';
  try {
    let newDraft: SummaryDraft;
    if (draft.tier === 'macro') {
      const mesoInRange = savedRanges.value.filter(
        r => (r.tier ?? 'meso') === 'meso' && r.from >= draft.from && r.to <= draft.to,
      );
      newDraft = await requestMacroSummary(
        mesoInRange.length > 0 ? mesoInRange : [{ from: draft.from, to: draft.to, text: draft.text, keys: draft.keys }],
        { model: draft.model, microSummaries: store.data.micro_summaries },
      );
    } else {
      newDraft = await requestSummary([draft.from, draft.to], {
        model: draft.model,
        microSummaries: store.data.micro_summaries,
      });
    }
    store.data.pending_summaries[index] = newDraft;
    await syncPendingSummariesToFloor();
    infoMsg.value = `已按最新预算重新生成 [${draft.from}-${draft.to}] ${draft.tier === 'macro' ? '战役总纲' : '阶段摘要'}草稿`;
  } catch (e) {
    errorMsg.value = `重新生成失败: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = false;
  }
}

/** 弃置暂存草稿 */
async function doDiscardPending(index: number) {
  store.data.pending_summaries.splice(index, 1);
  try {
    await syncPendingSummariesToFloor();
  } catch (e) {
    errorMsg.value = `舍弃草稿保存失败: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** 删除已归档摘要段（阶段摘要自动恢复显示原楼层） */
async function doDiscardSaved(from: number, to: number, tier: 'meso' | 'macro' = 'meso') {
  busy.value = true;
  infoMsg.value = '';
  errorMsg.value = '';
  try {
    const receipt = await discardSummary(from, to, chatBookGateway, { tier });
    if (tier !== 'macro') {
      hiddenRangesSet.value.delete(`${from}-${to}`);
    }
    infoMsg.value =
      tier === 'macro'
        ? `已删除战役总纲 [${from}-${to}]（阶段摘要仍保留）`
        : `已删除阶段摘要 [${from}-${to}]，并恢复显示 ${receipt.unhiddenFloors.length} 楼原始聊天记录`;
    await refreshRanges();
  } catch (e) {
    errorMsg.value = `删除归档失败: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = false;
  }
}

/** 切换区间隐藏状态 */
async function toggleRangeHide(from: number, to: number) {
  busy.value = true;
  infoMsg.value = '';
  errorMsg.value = '';
  const key = `${from}-${to}`;
  try {
    if (hiddenRangesSet.value.has(key)) {
      await unhideRange(from, to);
      hiddenRangesSet.value.delete(key);
      infoMsg.value = `已恢复显示 [${from}-${to}] 楼原始聊天记录`;
    } else {
      const floors = await hideRange(from, to, {
        currentFloor: currentFloor.value,
        tailReserve: budgetDraft.tailReserveFloors,
      });
      hiddenRangesSet.value.add(key);
      infoMsg.value = `已隐藏 [${from}-${to}] 楼原始聊天记录（共 ${floors.length} 楼）`;
    }
    await refreshRanges();
  } catch (e) {
    errorMsg.value = `楼层隐藏切换失败: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = false;
  }
}

/** 生成下一段阶段摘要到当前楼 */
async function generateNextSummary() {
  const range = nextRange.value;
  if (!range) return;
  busy.value = true;
  infoMsg.value = '';
  errorMsg.value = '';
  try {
    if (channelMode.value === 'delegate_main') {
      const [from, to] = range;
      const digest =
        buildMesoSummarySourceDigest(from, to, {
          microSummaries: store.data.micro_summaries,
        }) || formatMicroSummariesForPrompt(store.data.micro_summaries, from, to);
      const task: SummaryDelegationTask = {
        tier: 'meso',
        from,
        to,
        sourceDigest: digest,
        createdAt: new Date().toISOString(),
      };
      queueSummaryDelegationTask(task);
      queuedDelegation.value = syncSummaryDelegationPrompt(store.data, {
        currentFloor: currentFloor.value,
      });
      infoMsg.value = `已预约摘要任务：主模型将在下一轮回复末尾一并输出 [${from}-${to}] 阶段摘要（目标约 ${budgetDraft.mesoSingleTargetTokens} tok）`;
      return;
    }

    const draft = await requestSummary(range, {
      storeSink: store.data.pending_summaries,
      microSummaries: store.data.micro_summaries,
    });
    if (autoConfirmMode.value && env.inTavern) {
      await doAdopt(draft, store.data.pending_summaries.length - 1);
      return;
    }
    await syncPendingSummariesToFloor();
    infoMsg.value = `已生成 [${draft.from}-${draft.to}] 阶段摘要草稿，请确认后入档`;
  } catch (e) {
    errorMsg.value = `生成摘要失败: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = false;
  }
}

/** 合成战役总纲（Macro） */
async function generateMacroSummary() {
  const cand = macroCandidate.value;
  if (!cand) return;
  busy.value = true;
  infoMsg.value = '';
  errorMsg.value = '';
  try {
    if (channelMode.value === 'delegate_main') {
      const digest = buildMacroSummarySourceDigest(cand.mesoSegments, {
        microSummaries: store.data.micro_summaries,
      });
      const task: SummaryDelegationTask = {
        tier: 'macro',
        from: cand.from,
        to: cand.to,
        sourceDigest: digest,
        createdAt: new Date().toISOString(),
      };
      queueSummaryDelegationTask(task);
      queuedDelegation.value = syncSummaryDelegationPrompt(store.data, {
        currentFloor: currentFloor.value,
      });
      infoMsg.value = `已预约总纲任务：主模型将在下一轮回复末尾一并输出 [${cand.from}-${cand.to}] 战役总纲（目标约 ${budgetDraft.macroSingleTargetTokens} tok）`;
      return;
    }

    const draft = await requestMacroSummary(cand.mesoSegments, {
      storeSink: store.data.pending_summaries,
      microSummaries: store.data.micro_summaries,
    });
    if (autoConfirmMode.value && env.inTavern) {
      await doAdopt(draft, store.data.pending_summaries.length - 1);
      return;
    }
    await syncPendingSummariesToFloor();
    infoMsg.value = `已归并生成 [${draft.from}-${draft.to}] 战役总纲草稿，确认入档后旧阶段摘要将自动转为按需触发`;
  } catch (e) {
    errorMsg.value = `归并战役总纲失败: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = false;
  }
}

/** 运行兼容性自检探针 */
async function runHidingProbe() {
  busy.value = true;
  infoMsg.value = '';
  errorMsg.value = '';
  try {
    const report = await probeHiddenFloorEffects(1);
    probeReport.value = report;
    if (report.ok) {
      infoMsg.value = '兼容性自检通过：楼层隐藏与变量读取均正常，已自动复原';
    } else {
      errorMsg.value = `自检异常：${report.note}`;
    }
  } catch (e) {
    errorMsg.value = `自检抛错: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = false;
  }
}

// 自动预生成检查：若开启自动模式，每当未摘要楼层达到 N 时在后台生成草稿（或挂载顺带生成预约）
watch(
  () => [currentFloor.value, triggerMode.value, nextRange.value],
  async () => {
    if (triggerMode.value === 'auto' && env.inTavern && nextRange.value) {
      const [from, to] = nextRange.value;
      const alreadyPending = pendingSummaries.value.some(p => p.from === from && p.to === to);
      if (!alreadyPending && !busy.value) {
        if (channelMode.value === 'delegate_main') {
          queuedDelegation.value = syncSummaryDelegationPrompt(store.data, {
            currentFloor: currentFloor.value,
            worldbookEntries: savedRanges.value.map(r => r.entry),
          });
          return;
        }
        try {
          const draft = await requestSummary(nextRange.value, {
            storeSink: store.data.pending_summaries,
            microSummaries: store.data.micro_summaries,
          });
          if (autoConfirmMode.value) {
            await doAdopt(draft, store.data.pending_summaries.length - 1);
          } else {
            await syncPendingSummariesToFloor();
          }
        } catch {
          /* background silent */
        }
      }
    }
  },
);

onMounted(async () => {
  await refreshRanges();
  if (autoConfirmMode.value && env.inTavern && (store.data.pending_summaries?.length ?? 0) > 0) {
    await autoAdoptAllPending();
  }
});
</script>

<style scoped>
/* 顶部子页切换 Tab */
.sum-tab {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 600;
  color: var(--rac-muted);
  background: transparent;
  border: 1px solid transparent;
  transition: all 0.15s ease;
  cursor: pointer;
}
.sum-tab:hover {
  color: var(--rac-hi);
  background: color-mix(in srgb, var(--rac-panel-2) 65%, transparent);
}
.sum-tab--active {
  color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 20%, transparent);
  border-color: color-mix(in srgb, var(--rac-accent) 45%, transparent);
}

/* 通用战术按钮 */
.sum-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  border: 1px solid color-mix(in srgb, var(--rac-line) 65%, transparent);
  background: color-mix(in srgb, var(--rac-panel) 85%, transparent);
  color: var(--rac-text);
  transition: all 0.15s ease;
  cursor: pointer;
}
.sum-btn:hover:not(:disabled) {
  border-color: var(--rac-line);
  background: var(--rac-panel-2);
  color: var(--rac-hi);
}
.sum-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
.sum-btn--primary {
  border-color: color-mix(in srgb, var(--rac-accent) 60%, transparent);
  background: color-mix(in srgb, var(--rac-accent) 25%, transparent);
  color: var(--rac-hi);
}
.sum-btn--primary:hover:not(:disabled) {
  border-color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 38%, transparent);
  color: var(--rac-hi);
}
.sum-btn--danger {
  border-color: color-mix(in srgb, var(--rac-alert) 55%, transparent);
  background: color-mix(in srgb, var(--rac-alert) 22%, transparent);
  color: var(--rac-alert);
}
.sum-btn--danger:hover:not(:disabled) {
  border-color: var(--rac-alert);
  background: color-mix(in srgb, var(--rac-alert) 35%, transparent);
  color: var(--rac-hi);
}

/* 分段开关胶囊按钮 */
.sum-pill {
  padding: 4px 10px;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 500;
  color: var(--rac-muted);
  background: transparent;
  border: 1px solid transparent;
  white-space: nowrap;
  transition: all 0.15s ease;
  cursor: pointer;
}
.sum-pill:hover {
  color: var(--rac-hi);
}
.sum-pill--active {
  color: var(--rac-hi);
  background: color-mix(in srgb, var(--rac-accent) 25%, transparent);
  border-color: color-mix(in srgb, var(--rac-accent) 55%, transparent);
  font-weight: 600;
}

/* 清晰可见的深色输入框与下拉框 */
.sum-input {
  border-radius: 3px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-bg);
  padding: 5px 10px;
  font-size: 12px;
  color: var(--rac-hi);
  outline: none;
  transition: border-color 0.15s ease;
}
.sum-input::placeholder {
  color: var(--rac-muted);
}
.sum-input:focus {
  border-color: var(--rac-focus);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--rac-focus) 25%, transparent);
}

/* 预算调节拖条样式 */
.sum-slider {
  height: 6px;
  border-radius: 999px;
  background: var(--rac-panel-2);
  cursor: pointer;
}
.sum-slider--purple {
  accent-color: var(--rac-focus);
}
.sum-slider--amber {
  accent-color: var(--rac-warn);
}
.sum-slider--sky {
  accent-color: var(--rac-accent);
}
.sum-slider--emerald {
  accent-color: var(--rac-ok);
}

/* 手动数字输入框（预算 tok 与保留楼层数直接填入） */
.sum-num-input {
  border-radius: 3px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-bg);
  padding: 1px 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  color: var(--rac-hi);
  text-align: right;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.sum-num-input:hover {
  border-color: var(--rac-line);
}
.sum-num-input:focus {
  border-color: var(--rac-focus);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--rac-focus) 30%, transparent);
}
</style>
