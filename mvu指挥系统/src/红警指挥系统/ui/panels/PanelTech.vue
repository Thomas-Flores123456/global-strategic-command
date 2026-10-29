<template>
  <div ref="techPanelRoot" class="ra-tech-panel flex flex-col gap-2.5 p-2 select-none">
    <!-- ── 战区科研态势中枢（HUD 仪表盘栅格：阵营层级 / 科研槽 / 算力并网） ── -->
    <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
      <!-- 1. 阵营科技层级 -->
      <section class="card ob-panel ra-tech-hud-card flex flex-col justify-between px-3 py-2.5">
        <div class="micro flex items-center justify-between text-[var(--rac-accent)]">
          <span class="flex items-center gap-1.5 font-semibold tracking-wider">
            <Icon name="signal" :size="11" />
            科技代际 · Tier
          </span>
          <span class="num ob-num text-[11px] text-[var(--rac-muted)]">当前上限</span>
        </div>
        <div
          v-for="f in factionTiers"
          :key="f.faction"
          class="mt-2 flex flex-col gap-1.5"
          data-test="faction-tier-row"
          :data-faction="f.faction"
          :data-tier="`T${f.tier}`"
        >
          <div class="flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <span class="text-[13px] font-bold tracking-wide text-[var(--rac-hi)]">{{ f.faction }}</span>
              <span
                class="num ob-num tier-badge"
                :class="{ 'tier-badge--t1': f.tier === 1, 'tier-badge--t2': f.tier === 2, 'tier-badge--t3': f.tier === 3 }"
                data-test="faction-tier-badge"
                :data-faction="f.faction"
                :data-tier="`T${f.tier}`"
                >T{{ f.tier }}</span
              >
            </span>
            <span class="flex items-center gap-1">
              <span
                v-for="t in 4"
                :key="t"
                class="tstep ob-num"
                :class="{ 'tstep--on': t < f.tier, 'tstep--cur': t === f.tier }"
                >T{{ t }}</span
              >
            </span>
          </div>
          <div class="flex items-center justify-between text-[12px] text-[var(--rac-muted)]">
            <span>晋升条件</span>
            <span class="num ob-num truncate text-right font-medium text-[var(--rac-text)]">{{ f.next }}</span>
          </div>
        </div>
      </section>

      <!-- 2. 科研工位与槽位总览 -->
      <section class="card ob-panel ra-tech-hud-card flex flex-col justify-between px-3 py-2.5" data-tech-slots>
        <div class="flex items-center justify-between">
          <span class="micro flex items-center gap-1.5 font-semibold tracking-wider text-[var(--rac-accent)]">
            <Icon name="tech" :size="11" />
            研究课题组 · Slots
          </span>
          <span class="num ob-num text-[11px] text-[var(--rac-text)]"
            >已开放 {{ unlockedCount }}/{{ board.length }} 组</span
          >
        </div>

        <!-- 主线常显工位微卡 -->
        <div class="mt-1.5 flex flex-col gap-1">
          <div
            v-for="s in mainSlots"
            :key="s.slotId"
            class="rounded-[3px] border px-2 py-1"
            :style="{
              borderColor: s.active.length
                ? 'color-mix(in srgb, var(--rac-warn) 45%, var(--rac-dim))'
                : 'var(--rac-dim)',
              background: s.active.length
                ? 'color-mix(in srgb, var(--rac-warn) 10%, var(--rac-panel-2))'
                : 'var(--rac-panel-2)',
            }"
          >
            <div class="flex items-center justify-between gap-1.5">
              <span class="flex min-w-0 items-center gap-1.5">
                <Icon
                  :name="s.unlocked ? (s.active.length ? 'flask' : 'check') : 'lock'"
                  :size="11"
                  :style="{
                    color: s.unlocked
                      ? s.active.length
                        ? 'var(--rac-warn)'
                        : 'var(--rac-ok)'
                      : 'var(--rac-muted)',
                  }"
                  class="flex-none"
                />
                <span class="truncate text-[12px] text-[var(--rac-hi)]">{{ formatSlotDisplayName(s.name) }}</span>
                <span v-if="!s.unlocked" class="num ob-num flex-none truncate text-[11px] text-[var(--rac-muted)]"
                  >需建筑: {{ anchorOf(s.slotId) }}</span
                >
              </span>
              <span class="num ob-num flex-none text-[11px] text-[var(--rac-text)]">
                <template v-if="s.active.length"
                  ><span class="font-semibold text-[var(--rac-warn)]">攻关中</span></template
                >
                <template v-else-if="s.unlocked"><span class="text-[var(--rac-ok)]">空闲待命</span></template>
                <template v-else>未开放</template>
                <template v-if="s.queued"> · 排队 {{ s.queued }}</template>
              </span>
            </div>
            <!-- 在研项实时条令 -->
            <div v-for="item in s.active" :key="item" class="mt-1 flex items-center gap-1.5">
              <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--rac-text)]">{{ item }}</span>
              <span class="num ob-num flex-none text-[11px] text-[var(--rac-warn)]">{{ progressOf(item) }}%</span>
              <span class="seg" style="width: 44px"
                ><i :style="{ width: progressOf(item) + '%', background: 'var(--rac-warn)' }"
              /></span>
              <span class="num ob-num flex-none text-[11px] text-[var(--rac-muted)]">{{ etaOf(item) }}</span>
            </div>
          </div>
        </div>

        <!-- 定向攻关槽抽屉/折叠开关 -->
        <button
          class="pressable micro mt-1 flex w-full items-center justify-between border-t border-[var(--rac-dim)] pt-1 text-[12px] text-[var(--rac-muted)] hover:text-[var(--rac-hi)]"
          @click="showDerived = !showDerived"
        >
          <span>专科课题组 · {{ derivedSlots.length }}</span>
          <Icon :name="showDerived ? 'chevron-up' : 'chevron-down'" :size="11" class="text-[var(--rac-muted)]" />
        </button>
        <div v-if="showDerived" class="mt-1 flex max-h-[140px] flex-col gap-1 overflow-y-auto">
          <div
            v-for="s in derivedSlots"
            :key="s.slotId"
            class="border-b border-[var(--rac-dim)] py-1 last:border-b-0"
          >
            <div class="flex items-center justify-between gap-1.5">
              <span class="flex min-w-0 items-center gap-1.5">
                <Icon
                  :name="s.unlocked ? (s.active.length ? 'flask' : 'check') : 'lock'"
                  :size="11"
                  :style="{
                    color: s.unlocked
                      ? s.active.length
                        ? 'var(--rac-warn)'
                        : 'var(--rac-ok)'
                      : 'var(--rac-muted)',
                  }"
                  class="flex-none"
                />
                <span class="truncate text-[12px] text-[var(--rac-hi)]">{{ formatSlotDisplayName(s.name) }}</span>
                <span v-if="!s.unlocked" class="num ob-num flex-none truncate text-[11px] text-[var(--rac-muted)]"
                  >需建筑: {{ anchorOf(s.slotId) }}</span
                >
              </span>
              <span class="num ob-num flex-none text-[11px] text-[var(--rac-text)]">
                <template v-if="s.active.length">攻关中 ×{{ s.active.length }}</template>
                <template v-else-if="s.unlocked">空闲待命</template>
                <template v-else>未开放</template>
                <template v-if="s.queued"> · 排队 {{ s.queued }}</template>
              </span>
            </div>
            <div v-for="item in s.active" :key="item" class="mt-0.5 flex items-center gap-1.5">
              <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--rac-text)]">{{ item }}</span>
              <span class="num ob-num flex-none text-[11px] text-[var(--rac-warn)]">{{ progressOf(item) }}%</span>
              <span class="seg" style="width: 40px"
                ><i :style="{ width: progressOf(item) + '%', background: 'var(--rac-warn)' }"
              /></span>
              <span class="num ob-num flex-none text-[11px] text-[var(--rac-muted)]">{{ etaOf(item) }}</span>
            </div>
          </div>
        </div>

        <!-- 保底游离在研项 -->
        <div
          v-for="item in orphanActives"
          :key="item"
          class="mt-1 flex items-center gap-1.5 border-t border-[var(--rac-dim)] pt-1"
        >
          <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--rac-warn)]">{{ item }}</span>
          <span class="num ob-num flex-none text-[11px] text-[var(--rac-warn)]">{{ progressOf(item) }}%</span>
          <span class="num ob-num flex-none text-[11px] text-[var(--rac-muted)]">未归类课题</span>
        </div>
      </section>

      <!-- 3. 算力拓扑网络 -->
      <section class="card ob-panel ra-tech-hud-card flex flex-col justify-between px-3 py-2.5" data-tech-compute>
        <div class="flex items-center justify-between">
          <span class="micro flex items-center gap-1.5 font-semibold tracking-wider text-[var(--rac-accent)]">
            <Icon name="gear" :size="11" />
            科研算力 · Compute
          </span>
          <span
            v-if="compute.sources.length"
            class="num ob-num py-0.2 rounded-sm px-1.5 text-[11px]"
            :style="{
              color: compute.deficit ? 'var(--rac-warn)' : 'var(--rac-ok)',
              background: compute.deficit
                ? 'color-mix(in srgb, var(--rac-warn) 16%, transparent)'
                : 'color-mix(in srgb, var(--rac-ok) 16%, transparent)',
              border: compute.deficit
                ? '1px solid color-mix(in srgb, var(--rac-warn) 40%, transparent)'
                : '1px solid color-mix(in srgb, var(--rac-ok) 40%, transparent)',
            }"
          >
            {{ compute.deficit ? '算力不足' : '算力充足' }}
          </span>
          <span v-else class="num ob-num text-[11px] text-[var(--rac-muted)]">未接入</span>
        </div>

        <div v-if="compute.sources.length" class="mt-2 flex flex-col gap-1.5">
          <div class="flex items-center justify-between text-[12px]">
            <span class="text-[var(--rac-muted)]">TFLOPS 负荷</span>
            <span class="num ob-num text-[var(--rac-hi)]">
              {{ compute.usedTflops }} / {{ compute.tflops }}
              <span class="text-[11px] text-[var(--rac-muted)]"
                >（余 {{ compute.freeTflops > 0 ? '+' : '' }}{{ compute.freeTflops }}）</span
              >
            </span>
          </div>
          <div class="flex items-center justify-between text-[12px]">
            <span class="text-[var(--rac-muted)]">TOPS 边缘</span>
            <span class="num ob-num text-[var(--rac-hi)]">
              {{ compute.usedTops }} / {{ compute.tops }}
              <span class="text-[11px] text-[var(--rac-muted)]"
                >（余 {{ compute.freeTops > 0 ? '+' : '' }}{{ compute.freeTops }}）</span
              >
            </span>
          </div>

          <button
            class="pressable micro mt-1 flex w-full items-center justify-between border-t border-[var(--rac-dim)] pt-1 text-[12px] text-[var(--rac-muted)] hover:text-[var(--rac-hi)]"
            @click="showComputeDetail = !showComputeDetail"
          >
            <span>明细 · {{ compute.sources.length }} 源 / {{ compute.usage.length }} 占用</span>
            <Icon :name="showComputeDetail ? 'chevron-up' : 'chevron-down'" :size="11" class="text-[var(--rac-muted)]" />
          </button>
          <div v-if="showComputeDetail" class="mt-1 flex max-h-[140px] flex-col overflow-y-auto">
            <div class="micro py-0.5 text-[11px] text-[var(--rac-muted)]">算力来源设施</div>
            <div
              v-for="s in compute.sources"
              :key="s.baseName + s.buildingName"
              class="flex items-center justify-between gap-1.5 py-0.5 text-[12px]"
            >
              <span class="min-w-0 truncate text-[var(--rac-text)]">{{ s.baseName }} · {{ s.buildingName }}</span>
              <span class="num ob-num flex-none text-[11px] text-[var(--rac-ok)]"
                >+{{ s.tflops }}T / +{{ s.tops }}Top</span
              >
            </div>
            <div class="micro mt-1 border-t border-dashed border-[var(--rac-dim)] pt-1 text-[11px] text-[var(--rac-muted)]">
              当前算力占用
            </div>
            <div
              v-for="u in compute.usage"
              :key="u.item"
              class="flex items-center justify-between gap-1.5 py-0.5 text-[12px]"
            >
              <span class="min-w-0 truncate text-[var(--rac-text)]">
                {{ u.item }}<span v-if="!u.declared" class="text-[var(--rac-muted)]"> · 固定工时</span>
              </span>
              <span class="num ob-num flex-none text-[11px] text-[var(--rac-muted)]"
                >{{ u.tflops }}Tfl · {{ u.tops }}Top</span
              >
            </div>
            <div v-if="compute.undeclaredCount" class="pt-0.5 text-[11px] text-[var(--rac-muted)]">
              {{ compute.undeclaredCount }} 项课题按固定工时推进
            </div>
          </div>
        </div>
        <div v-else class="mt-2 text-[12px] leading-relaxed text-[var(--rac-muted)]">
          尚未建成算力设施。建造战斗实验室、超算中心或量子超算中心后，可提供科研算力并加速课题研发。
        </div>
      </section>
    </div>

    <!-- ── 战术检索与状态快筛工具栏 ── -->
    <div class="card ob-panel ra-tech-toolbar flex flex-wrap items-center justify-between gap-2 p-2">
      <!-- 搜索框 -->
      <div
        class="flex min-w-[200px] flex-1 items-center gap-1.5 rounded-[3px] border border-[var(--rac-dim)] bg-[var(--rac-bg)] px-2 py-1 focus-within:border-[var(--rac-accent)]"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          class="text-[var(--rac-muted)]"
        >
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3.5 3.5" />
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索科技名称、领域或代号..."
          class="w-full border-none bg-transparent text-[12px] text-[var(--rac-hi)] placeholder-[var(--rac-muted)] outline-none"
        />
        <button v-if="searchQuery" class="p-0.5 hover:opacity-80" @click="searchQuery = ''">
          <Icon name="close" :size="11" class="text-[var(--rac-muted)]" />
        </button>
      </div>

      <!-- 状态筛选药丸 -->
      <div class="flex flex-wrap items-center gap-1">
        <button class="filter-pill" :class="{ 'filter-pill--active': filterStatus === 'all' }" @click="filterStatus = 'all'">
          全部 {{ uiResearches.length }}
        </button>
        <button class="filter-pill" :class="{ 'filter-pill--active': filterStatus === 'active' }" @click="filterStatus = 'active'">
          <span class="dot-indicator dot--active" /> 攻关中 {{ activeCountTotal }}
        </button>
        <button class="filter-pill" :class="{ 'filter-pill--active': filterStatus === 'queued' }" @click="filterStatus = 'queued'">
          <span class="dot-indicator dot--queued" /> 排队中 {{ queuedCountTotal }}
        </button>
        <button class="filter-pill" :class="{ 'filter-pill--active': filterStatus === 'ready' }" @click="filterStatus = 'ready'">
          <span class="dot-indicator dot--done" /> 可立项 {{ readyCountTotal }}
        </button>
        <button class="filter-pill" :class="{ 'filter-pill--active': filterStatus === 'done' }" @click="filterStatus = 'done'">
          <span class="dot-indicator dot--done" /> 已攻克 {{ doneCountTotal }}
        </button>
        <button class="filter-pill" :class="{ 'filter-pill--active': filterStatus === 'locked' }" @click="filterStatus = 'locked'">
          <span class="dot-indicator dot--locked" /> 待研制 {{ lockedCountTotal }}
        </button>
      </div>

      <!-- 排序模式与视图切换 -->
      <div class="flex flex-wrap items-center gap-1.5">
        <div
          class="flex items-center gap-0.5 rounded-[3px] border border-[var(--rac-dim)] bg-[var(--rac-bg)] p-0.5"
          role="group"
          aria-label="科技卡片排序方式"
        >
          <button
            type="button"
            class="filter-pill"
            :class="{ 'filter-pill--active': sortMode === 'tactical' }"
            data-test="tech-sort-tactical"
            title="按作战急需排序：攻关中 → 排队中 → 可立项 → 准解锁(缺1项前置) → 待研制 → 已攻克"
            @click="sortMode = 'tactical'"
          >
            作战推荐
          </button>
          <button
            type="button"
            class="filter-pill"
            :class="{ 'filter-pill--active': sortMode === 'tier' }"
            data-test="tech-sort-tier"
            title="按科技代际由低到高排序：T1 基础 → T2 实验室 → T3 战略"
            @click="sortMode = 'tier'"
          >
            代际 T1→T3
          </button>
          <button
            type="button"
            class="filter-pill"
            :class="{ 'filter-pill--active': sortMode === 'line' }"
            data-test="tech-sort-line"
            title="按战略领域主次归类排序：通用/主建筑/工业/军事主战优先"
            @click="sortMode = 'line'"
          >
            领域归类
          </button>
        </div>

        <div class="flex items-center gap-0.5 rounded-[3px] border border-[var(--rac-dim)] bg-[var(--rac-bg)] p-0.5">
          <button class="view-btn" :class="{ 'view-btn--active': viewMode === 'grid' }" title="卡片网格视图" @click="viewMode = 'grid'">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="2" width="5" height="5" rx="1" />
              <rect x="9" y="2" width="5" height="5" rx="1" />
              <rect x="2" y="9" width="5" height="5" rx="1" />
              <rect x="9" y="9" width="5" height="5" rx="1" />
            </svg>
          </button>
          <button class="view-btn" :class="{ 'view-btn--active': viewMode === 'accordion' }" title="分类折叠列表" @click="viewMode = 'accordion'">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
              <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- ── 双栏工作台：左侧领域导航轨 + 右侧科技卡片矩阵（viewMode === 'grid'） ── -->
    <div v-if="viewMode === 'grid'" class="flex flex-col items-start gap-2.5 md:flex-row">
      <!-- 左侧理论序列导航轨 -->
      <aside class="flex w-full flex-none flex-col gap-1.5 select-none md:w-[220px]">
        <div class="micro flex items-center justify-between px-1 text-[11px] text-[var(--rac-muted)]">
          <span>科研领域</span>
          <span class="num ob-num">共 {{ Object.keys(byLine).length }} 类</span>
        </div>

        <!-- 全部领域选项 -->
        <button
          class="nav-line-card"
          :class="{ 'nav-line-card--active': activeLine === null }"
          @click="activeLine = null"
        >
          <div class="flex w-full items-center justify-between">
            <span class="text-[12px] font-semibold text-[var(--rac-hi)]">全部科技</span>
            <span class="num ob-num text-[11px] text-[var(--rac-text)]"
              >{{ doneCountTotal }}/{{ uiResearches.length }}</span
            >
          </div>
          <div class="mt-1.5 h-[2px] w-full overflow-hidden rounded-full bg-[var(--rac-dim)]">
            <div
              class="h-full bg-[var(--rac-ok)]"
              :style="{ width: `${(doneCountTotal / (uiResearches.length || 1)) * 100}%` }"
            />
          </div>
        </button>

        <!-- 各序列列表（遍历 byLine） -->
        <button
          v-for="(items, line) in byLine"
          :key="line"
          class="nav-line-card"
          :class="{ 'nav-line-card--active': activeLine === line }"
          @click="activeLine = line"
        >
          <div class="flex w-full items-center justify-between">
            <span class="truncate text-[12px] text-[var(--rac-hi)]">{{ line }}</span>
            <span class="num ob-num flex-none text-[11px] text-[var(--rac-text)]"
              >{{ doneCount(items) }}/{{ items.length }}</span
            >
          </div>

          <!-- 契约块阵 (必须保留 blk, blk--on, blk--active) -->
          <div class="mt-1 flex w-full items-center justify-between">
            <span class="flex flex-wrap gap-0.5">
              <span
                v-for="r in items"
                :key="r.name"
                class="blk"
                :class="{
                  'blk--on': stateOf(r) === 'done',
                  'blk--active': stateOf(r) === 'active',
                  'blk--queued': stateOf(r) === 'queued',
                }"
                :title="r.name"
              />
            </span>
            <span
              v-if="hasActiveInLine(items)"
              class="py-0.2 animate-pulse rounded-sm border border-[var(--rac-warn)]/40 bg-[var(--rac-warn)]/15 px-1 text-[11px] font-bold text-[var(--rac-warn)]"
            >
              攻关中
            </span>
          </div>
        </button>
      </aside>

      <!-- 右侧科技节点网格矩阵 -->
      <main class="flex w-full min-w-0 flex-1 flex-col gap-2">
        <!-- 当前序列标题与统计 -->
        <div class="flex items-center justify-between px-1">
          <span class="flex items-center gap-1.5 text-[12px] font-bold tracking-wide text-[var(--rac-hi)]">
            <span>{{ activeLine || '全部科技总览' }}</span>
            <span class="num ob-num text-[11px] font-normal text-[var(--rac-muted)]">
              （{{ filteredResearches.length }} 项{{ searchQuery ? '匹配' : '' }}）
            </span>
          </span>
          <span class="text-[11px] text-[var(--rac-muted)]"> 点击卡片查看科技详情与解锁内容 </span>
        </div>

        <!-- 卡片网格 -->
        <div v-if="filteredResearches.length" class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="r in filteredResearches"
            :key="r.name"
            class="tech-card pressable"
            :class="{
              'tech-card--done': stateOf(r) === 'done',
              'tech-card--active': stateOf(r) === 'active',
              'tech-card--queued': stateOf(r) === 'queued',
              'tech-card--ready': stateOf(r) === 'ready',
              'tech-card--highlighted': isHighlighted(r.name),
              'tech-card--pulse': isHighlighted(r.name),
              'animate-pulse': isHighlighted(r.name),
              'tech-card--locked': stateOf(r) === 'locked',
            }"
            :data-tech-name="r.name"
            :data-tech-state="stateOf(r)"
            :data-prereq-met="r.prereqMet ? 'true' : 'false'"
            :data-highlighted-tech="
              isHighlighted(r.name) ? (props.highlightedTechTarget?.techId ?? highlightedTechName ?? r.name) : undefined
            "
            :tabindex="isHighlighted(r.name) ? 0 : undefined"
            @click="openLookup(r.name, data.codex)"
          >
            <!-- 头部：图标 + 名称 + Tier/EVA -->
            <div class="flex items-start justify-between gap-1.5">
              <span class="flex min-w-0 flex-1 items-center gap-1.5">
                <span
                  class="flex-none"
                  :style="{
                    color:
                      stateOf(r) === 'done'
                        ? 'var(--rac-ok)'
                        : stateOf(r) === 'ready'
                          ? 'var(--rac-accent)'
                          : stateOf(r) === 'active' || stateOf(r) === 'queued'
                            ? 'var(--rac-warn)'
                            : 'var(--rac-muted)',
                  }"
                >
                  <Icon
                    :name="
                      stateOf(r) === 'done'
                        ? 'check'
                        : stateOf(r) === 'active'
                          ? 'flask'
                          : stateOf(r) === 'queued'
                            ? 'clock'
                            : stateOf(r) === 'ready'
                              ? 'tech'
                              : 'lock'
                    "
                    :size="11"
                  />
                </span>
                <span
                  class="truncate text-[12px] font-semibold"
                  :style="{
                    color:
                      stateOf(r) === 'done' || stateOf(r) === 'ready'
                        ? 'var(--rac-hi)'
                        : stateOf(r) === 'active' || stateOf(r) === 'queued'
                          ? 'var(--rac-warn)'
                          : 'var(--rac-text)',
                  }"
                  :title="r.name"
                  >{{ r.name }}</span
                >
              </span>
              <span class="flex flex-none items-center gap-0.5">
                <span
                  v-if="r.tier"
                  class="num ob-num tier-badge"
                  :class="{ 'tier-badge--t1': r.tier === 1, 'tier-badge--t2': r.tier === 2, 'tier-badge--t3': r.tier === 3 }"
                  >T{{ r.tier }}</span
                >
                <span v-if="r.dynamic" class="eva-badge">EVA 增补</span>
              </span>
            </div>

            <!-- 攻关中进度展示 -->
            <div
              v-if="stateOf(r) === 'active'"
              class="mt-2 flex flex-col gap-1 rounded-[2px] border border-[var(--rac-warn)]/40 bg-[var(--rac-warn)]/12 p-1.5"
            >
              <div class="flex items-center justify-between text-[11px]">
                <span class="font-medium text-[var(--rac-warn)]">研发进度</span>
                <span class="num ob-num font-bold text-[var(--rac-warn)]">{{ progressOf(r.name) }}%</span>
              </div>
              <div class="seg w-full">
                <i :style="{ width: progressOf(r.name) + '%', background: 'var(--rac-warn)' }" />
              </div>
              <div v-if="etaOf(r.name)" class="num ob-num text-right text-[11px] text-[var(--rac-muted)]">
                预估: {{ etaOf(r.name) }}
              </div>
            </div>
            <!-- 排队中提示 -->
            <div
              v-else-if="stateOf(r) === 'queued'"
              class="mt-2 flex items-center justify-between rounded-[2px] border border-[var(--rac-warn)]/35 bg-[var(--rac-warn)]/10 px-1.5 py-1 text-[11px]"
              data-test="tech-queued-banner"
            >
              <span class="font-medium text-[var(--rac-warn)]">排队中 · 第 {{ queueOrderOf(r.name) }} 位</span>
              <span v-if="etaOf(r.name)" class="num ob-num text-[11px] text-[var(--rac-muted)]">
                预估: {{ etaOf(r.name) }}
              </span>
            </div>

            <!-- 缺失前置可点击直跳芯片（UX-08） -->
            <div
              v-if="r.missingPrereqs.length > 0 && stateOf(r) !== 'done'"
              class="mt-1.5 flex flex-wrap items-center gap-1"
              data-test="missing-prereq-list"
            >
              <button
                v-for="chip in r.missingPrereqs"
                :key="`${chip.kind}:${chip.name}`"
                type="button"
                class="missing-prereq-chip"
                :class="`missing-prereq-chip--${chip.kind}`"
                data-test="missing-prereq-chip"
                :data-prereq-kind="chip.kind"
                :data-prereq-name="chip.name"
                :data-prereq-id="chip.rawId ?? chip.name"
                :title="`缺少${formatPrereqKind(chip.kind)}：${chip.name}`"
                @click="handleMissingPrereqClick(chip, $event)"
              >
                <span class="missing-prereq-chip__kind">{{ formatPrereqKind(chip.kind) }}</span>
                <span class="missing-prereq-chip__name">{{ chip.name }}</span>
              </button>
            </div>

            <!-- 底部：所属序列与工额造价参数 -->
            <div
              class="mt-2 flex items-center justify-between gap-1 border-t border-[var(--rac-dim)] pt-1.5 text-[11px]"
            >
              <span class="truncate text-[var(--rac-muted)]">{{ r.line }}</span>
              <span class="num ob-num flex-none truncate text-right text-[var(--rac-text)]">{{ r.meta }}</span>
            </div>
          </div>
        </div>

        <!-- 空态提示 -->
        <div v-else class="card ob-panel flex flex-col items-center justify-center gap-2 p-6 text-center">
          <Icon name="tech" :size="20" class="text-[var(--rac-muted)]" />
          <div class="text-[12px] font-semibold text-[var(--rac-text)]">没有找到匹配的科技项目</div>
          <div class="text-[12px] text-[var(--rac-muted)]">请尝试调整搜索关键词或切换状态筛选条件</div>
        </div>
      </main>
    </div>

    <!-- ── 条令序列手风琴清单（viewMode === 'accordion'） ── -->
    <div v-else class="flex flex-col gap-2">
      <section v-for="(items, line) in filteredByLine" :key="line" class="card ob-panel">
        <button class="pressable flex w-full items-center justify-between px-3 py-2.5" @click="toggle(line)">
          <span class="flex items-center gap-2.5">
            <span class="text-[12px] font-semibold tracking-wider text-[var(--rac-hi)]">{{ line }}</span>
            <span class="num ob-num micro text-[11px] text-[var(--rac-text)]">{{ doneCount(items) }}/{{ items.length }}</span>
          </span>
          <span class="flex items-center gap-2.5">
            <!-- 完成度块阵 -->
            <span class="flex gap-0.5">
              <span
                v-for="r in items"
                :key="r.name"
                class="blk"
                :class="{
                  'blk--on': stateOf(r) === 'done',
                  'blk--active': stateOf(r) === 'active',
                  'blk--queued': stateOf(r) === 'queued',
                }"
                :title="r.name"
              />
            </span>
            <Icon :name="expanded[line] ? 'chevron-up' : 'chevron-down'" :size="11" class="text-[var(--rac-muted)]" />
          </span>
        </button>
        <div v-if="expanded[line]" class="border-t border-[var(--rac-dim)] px-3 pb-1.5">
          <button
            v-for="r in items"
            :key="r.name"
            class="pressable flex w-full items-center justify-between gap-3 border-b border-[var(--rac-dim)] py-1.5 text-left last:border-b-0"
            @click="openLookup(r.name, data.codex)"
          >
            <span class="flex min-w-0 items-center gap-2">
              <span
                class="flex-none"
                :style="{
                  color:
                    stateOf(r) === 'done'
                      ? 'var(--rac-ok)'
                      : stateOf(r) === 'active' || stateOf(r) === 'queued'
                        ? 'var(--rac-warn)'
                        : 'var(--rac-muted)',
                }"
              >
                <Icon :name="stateOf(r) === 'done' ? 'check' : stateOf(r) === 'active' ? 'flask' : 'lock'" :size="11" />
              </span>
              <span
                class="truncate text-[12px]"
                :style="{ color: stateOf(r) === 'done' ? 'var(--rac-hi)' : 'var(--rac-text)' }"
              >
                {{ r.name }}
              </span>
              <span
                v-if="r.tier"
                class="num ob-num tier-badge flex-none"
                :class="{ 'tier-badge--t1': r.tier === 1, 'tier-badge--t2': r.tier === 2, 'tier-badge--t3': r.tier === 3 }"
                >T{{ r.tier }}</span
              >
              <span v-if="r.dynamic" class="eva-badge flex-none">EVA 增补</span>
            </span>
            <span class="num ob-num flex-none text-[11px] text-[var(--rac-muted)]">{{ r.meta }}</span>
          </button>
        </div>
      </section>
    </div>

    <!-- ── 战区条令说明底栏 ── -->
    <div class="px-1 pb-1 text-[12px] text-[var(--rac-muted)]">
      说明：通用科技研发完成后全战区共享生效；阵营专属科技需拥有对应阵营基地车（MCV）或建造厂后方可立项。
    </div>
  </div>
</template>

<script lang="ts">
import type { RuntimeProtocolsInput } from '../../core/catalogRuntimeContext';
import type { PrerequisiteProtocolSource } from '../../core/prerequisites';
import {
  derivePanelFactionTiers,
  evaluateTechCardPrerequisites,
  extractMissingPrereqsFromUnmet,
  filterDynamicCodexResearches,
  getTechLinePriority,
  shouldIncludeResearchByFactionFilter,
  sortTechByLineGroups,
  sortTechResearches,
  type CodexResearchEntryLike,
  type MissingPrereqChip,
  type MissingPrereqKind,
  type TechCardState,
  type TechSortMode,
  type UiResearch,
} from './panelTechHelpers';

export {
  derivePanelFactionTiers,
  evaluateTechCardPrerequisites,
  extractMissingPrereqsFromUnmet,
  filterDynamicCodexResearches,
  getTechLinePriority,
  sortTechByLineGroups,
  sortTechResearches,
};
export type { CodexResearchEntryLike, MissingPrereqChip, MissingPrereqKind, TechCardState, TechSortMode, UiResearch };
</script>

<script setup lang="ts">
import { nextTick, ref, computed, reactive, watch } from 'vue';
import Icon from '../Icon.vue';
import { playTacticalStagger, scheduleNextFrame } from '../motion/useGsapMotion';
import { useCatalogStore } from '../../composables/useCatalog';
import { useDataStore } from '../../composables/store';
import { openLookup } from '../../composables/useDetail';
import { inferDefaultResearchDuration } from '../../../中控悬浮窗/models/worldbookCatalogHelpers';
import { lineIndexFromCatalog, slotBoard, SLOT_REGISTRY, type SlotId } from '../../engines/researchSlots';
import { deployIndexFromCatalog } from '../../engines/productionLanes';
import { computeOverview } from '../../engines/researchCompute';

const props = defineProps<{
  snapshot?: import('../../core/schema').Schema | null;
  highlightedTechTarget?: { techId: string; techName: string } | null;
  factionFilter?: string;
  unlockedFactions?: readonly string[];
}>();
const emit = defineEmits<{
  (e: 'jump-to-protocol', protocolName: string): void;
  (e: 'jump-to-tech', techName: string): void;
}>();
const techPanelRoot = ref<HTMLElement | null>(null);
const highlightedTechName = ref<string | null>(null);
const store = useDataStore();
const catalog = useCatalogStore();
const data = computed(() => props.snapshot ?? store.data);

/** 阵营层级：基于 protocolAnchors.factionLabTier 与 researchSlots.techTier 推导（支持红星实验设计局综合体 T2 与科学城 T3） */
const factionTiers = computed(() => derivePanelFactionTiers(data.value, catalog.factionDefs, data.value.tech.done));

/** 科研槽总览：与日程线同源口径（slotView 直接喂 store 数据，lineOf/deployOf 由 catalog 三池构建） */
const lineOf = computed(() => lineIndexFromCatalog(catalog.researches));
const deployOf = computed(() =>
  deployIndexFromCatalog({
    buildings: catalog.buildings,
    productions: catalog.productions,
    retrofits: catalog.retrofits,
  }),
);
const slotView = computed(() => ({ bases: data.value.bases, queues: data.value.queues }));
const board = computed(() => slotBoard(slotView.value, lineOf.value, undefined, { deployOf: deployOf.value }));

const MAIN_SLOTS: ReadonlySet<SlotId> = new Set(['slot.main', 'slot.faction', 'slot.mecha']);
const mainSlots = computed(() => board.value.filter(s => MAIN_SLOTS.has(s.slotId)));
const derivedSlots = computed(() => board.value.filter(s => !MAIN_SLOTS.has(s.slotId)));
const unlockedCount = computed(() => board.value.filter(s => s.unlocked).length);
function anchorOf(slotId: SlotId): string {
  return SLOT_REGISTRY.find(s => s.slotId === slotId)?.anchorNames[0] ?? '?';
}
function formatSlotDisplayName(name: string): string {
  return name.replace(/槽$/, '组');
}
function formatPrereqKind(kind: MissingPrereqKind): string {
  if (kind === 'tech') return '科技';
  if (kind === 'building') return '建筑';
  if (kind === 'protocol') return '条令';
  return kind;
}

/** 队列进度/工期查询（按 item 名对回 store.queues） */
function queueOf(item: string) {
  return data.value.queues.find(q => q.type === '研究' && q.item === item);
}
function queueOrderOf(item: string): number {
  const idx = data.value.queues.filter(q => q.type === '研究' && q.status === 'queued').findIndex(q => q.item === item);
  return idx >= 0 ? idx + 1 : 1;
}
function progressOf(item: string): number {
  return queueOf(item)?.progress ?? 0;
}
function etaOf(item: string): string {
  return queueOf(item)?.eta ?? '';
}
/** 未归入任何槽的在研项（旧数据/未知 line 兜底，保证信息不丢） */
const orphanActives = computed(() => {
  const covered = new Set(board.value.flatMap(s => s.active));
  return data.value.queues
    .filter(q => q.type === '研究' && q.status !== 'queued' && !covered.has(q.item))
    .map(q => q.item);
});

/** 算力总览：静态名义口径（不含 ×1.7 加速折算） */
const compute = computed(() =>
  computeOverview(data.value.bases, data.value.queues, catalog.buildings, catalog.researches),
);

const showDerived = ref(false);
const showComputeDetail = ref(false);

/** 检索与过滤控制状态 */
const searchQuery = ref('');
const filterStatus = ref<'all' | 'active' | 'queued' | 'ready' | 'done' | 'locked'>('all');
const sortMode = ref<TechSortMode>('tactical');
const activeLine = ref<string | null>(null);
const viewMode = ref<'grid' | 'accordion'>('grid');

function parseTier(s: string | undefined): 1 | 2 | 3 | undefined {
  if (!s) return undefined;
  return s.includes('3') ? 3 : s.includes('2') ? 2 : s.includes('1') ? 1 : undefined;
}
const catalogProtocolsSource = computed<PrerequisiteProtocolSource | undefined>(() => {
  const c = catalog as unknown as {
    protocols?: PrerequisiteProtocolSource;
    effectiveCatalog?: { protocols?: PrerequisiteProtocolSource };
  };
  return c.effectiveCatalog?.protocols ?? c.protocols;
});
const catalogAllResearches = computed(() => {
  const c = catalog as unknown as {
    dynamicCatalog?: { researches?: readonly { id?: string; name: string; aliases?: readonly string[]; line?: string }[] };
  };
  const dyn = c.dynamicCatalog?.researches ?? [];
  return dyn.length > 0 ? [...catalog.researches, ...dyn] : catalog.researches;
});
const uiResearches = computed<UiResearch[]>(() => {
  const stateInput = {
    bases: data.value.bases,
    techDone: data.value.tech.done,
    forces: data.value.forces,
    protocols: (data.value as unknown as { protocols?: RuntimeProtocolsInput }).protocols,
  };
  return [
    ...catalog.researches
      .filter(r =>
        shouldIncludeResearchByFactionFilter(
          r as { id?: string; name?: string; faction?: string; scope?: string; line?: string; tags?: readonly string[]; need_building?: string; need_buildings?: readonly string[] },
          props.unlockedFactions,
          props.factionFilter,
        ),
      )
      .map(r => {
        const { prereqMet, missingPrereqs } = evaluateTechCardPrerequisites(r, stateInput, catalogProtocolsSource.value);
        const wl = (r as { workload?: { days?: number; min_days?: number } }).workload;
        const etaStr =
          (typeof r.eta === 'string' && r.eta.trim()) ||
          (wl?.days ? `约${wl.days}日` : wl?.min_days ? `约${wl.min_days}日` : inferDefaultResearchDuration(r.cost, r.tier).eta);
        return {
          id: (r as { id?: string }).id,
          name: r.name,
          line: r.line,
          tier: r.tier,
          meta: [r.cost, etaStr].filter(v => v !== undefined && v !== null && String(v).trim() !== '').join(' · '),
          dynamic: false,
          prereqMet,
          missingPrereqs,
        };
      }),
    ...filterDynamicCodexResearches(data.value.codex, catalogAllResearches.value)
      .filter(c =>
        shouldIncludeResearchByFactionFilter(
          { name: c.name, faction: c.params['阵营'], line: c.params['科技线'] },
          props.unlockedFactions,
          props.factionFilter,
        ),
      )
      .map(c => {
        const rawPrereq = (c.params['前置'] ?? c.params['前置科技'] ?? '').trim();
        const prereqs =
          rawPrereq && rawPrereq !== '——' && rawPrereq !== '无'
            ? rawPrereq.split(/[、,，/]/).map(s => s.trim()).filter(Boolean)
            : [];
        const { prereqMet, missingPrereqs } = evaluateTechCardPrerequisites(
          { name: c.name, prereqs },
          stateInput,
          catalogProtocolsSource.value,
        );
        return {
          name: c.name,
          line: c.params['科技线'] ?? '动态研究',
          tier: parseTier(c.params['层级']),
          meta: [c.params['造价'] ?? c.params['费用'], c.params['工期']].filter(Boolean).join(' · ') || 'EVA 增补',
          dynamic: true,
          prereqMet,
          missingPrereqs,
        };
      }),
  ];
});
const allResearches = uiResearches;
const byLine = computed(() =>
  sortTechByLineGroups(uiResearches.value, stateOf, sortMode.value, queueOrderOf),
);

const expanded = reactive<Record<string, boolean>>({});
function toggle(line: string) {
  expanded[line] = !expanded[line];
}

function stateOf(r: UiResearch): TechCardState {
  if (data.value.tech.done.includes(r.name)) return 'done';
  const q = queueOf(r.name);
  if (q && q.status !== 'done' && q.status !== 'cancelled') {
    return q.status === 'queued' ? 'queued' : 'active';
  }
  return r.prereqMet ? 'ready' : 'locked';
}
function doneCount(items: UiResearch[]) {
  return items.filter(r => data.value.tech.done.includes(r.name)).length;
}
function hasActiveInLine(items: UiResearch[]): boolean {
  return items.some(r => stateOf(r) === 'active' || stateOf(r) === 'queued');
}

const activeCountTotal = computed(() => uiResearches.value.filter(r => stateOf(r) === 'active').length);
const queuedCountTotal = computed(() => uiResearches.value.filter(r => stateOf(r) === 'queued').length);
const readyCountTotal = computed(() => uiResearches.value.filter(r => stateOf(r) === 'ready').length);
const doneCountTotal = computed(() => uiResearches.value.filter(r => stateOf(r) === 'done').length);
const lockedCountTotal = computed(() => uiResearches.value.filter(r => stateOf(r) === 'locked').length);

const filteredResearches = computed(() => {
  let list = uiResearches.value;
  if (activeLine.value) list = list.filter(r => r.line === activeLine.value);
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase();
    list = list.filter(r => r.name.toLowerCase().includes(q) || r.line.toLowerCase().includes(q));
  }
  if (filterStatus.value !== 'all') list = list.filter(r => stateOf(r) === filterStatus.value);
  return sortTechResearches(list, stateOf, sortMode.value, queueOrderOf);
});

const filteredByLine = computed(() => {
  let list = uiResearches.value;
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase();
    list = list.filter(r => r.name.toLowerCase().includes(q) || r.line.toLowerCase().includes(q));
  }
  if (filterStatus.value !== 'all') list = list.filter(r => stateOf(r) === filterStatus.value);
  return sortTechByLineGroups(list, stateOf, sortMode.value, queueOrderOf);
});

watch(
  () => [activeLine.value, filterStatus.value, sortMode.value, viewMode.value],
  () => {
    scheduleNextFrame(() => {
      playTacticalStagger(techPanelRoot.value, '.tech-card, .card', { maxItems: 18, duration: 0.16, stagger: 0.015 });
    });
  },
);
function isHighlighted(name: string): boolean {
  if (highlightedTechName.value && name === highlightedTechName.value) return true;
  const target = props.highlightedTechTarget;
  if (!target) return false;
  const research = (catalog.researches as readonly { id?: string; name: string }[]).find(r => r.id === target.techId);
  return name === target.techName || name === research?.name;
}
async function handleMissingPrereqClick(chip: MissingPrereqChip, event?: Event): Promise<void> {
  event?.stopPropagation?.();
  if (chip.kind === 'protocol') {
    emit('jump-to-protocol', chip.name);
    return;
  }
  if (chip.kind === 'tech') {
    highlightedTechName.value = chip.name;
    searchQuery.value = '';
    filterStatus.value = 'all';
    activeLine.value = null;
    viewMode.value = 'grid';
    emit('jump-to-tech', chip.name);
    await nextTick();
    const card = Array.from(techPanelRoot.value?.querySelectorAll<HTMLElement>('[data-tech-name]') ?? []).find(el =>
      isHighlighted(el.dataset.techName ?? ''),
    );
    card?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    card?.focus({ preventScroll: true });
    return;
  }
  openLookup(chip.name, data.value.codex);
}
watch(
  () => props.highlightedTechTarget,
  async target => {
    if (!target) return;
    highlightedTechName.value = target.techName;
    searchQuery.value = '';
    filterStatus.value = 'all';
    activeLine.value = null;
    viewMode.value = 'grid';
    await nextTick();
    const card = Array.from(techPanelRoot.value?.querySelectorAll<HTMLElement>('[data-tech-name]') ?? []).find(el =>
      isHighlighted(el.dataset.techName ?? ''),
    );
    card?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    card?.focus({ preventScroll: true });
  },
  { immediate: true },
);
</script>

<style scoped>
@import './panelTech.css';

.ra-tech-panel .card,
.ra-tech-hud-card,
.ra-tech-toolbar {
  border-radius: 3px;
  border: 1px solid color-mix(in srgb, var(--rac-accent) 26%, var(--rac-dim));
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 7%, var(--rac-panel)) 0%, var(--rac-panel) 100%);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 18%, transparent),
    inset 2px 0 0 color-mix(in srgb, var(--rac-accent) 55%, var(--rac-dim));
}

.tstep {
  font-size: 11px;
  line-height: 1;
  padding: 2px 6px;
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
  background: var(--rac-bg);
  color: var(--rac-muted);
  font-variant-numeric: tabular-nums;
}
.tstep--on {
  color: var(--rac-ok);
  border-color: color-mix(in srgb, var(--rac-ok) 55%, var(--rac-dim));
  background: color-mix(in srgb, var(--rac-ok) 12%, var(--rac-panel-2));
}
.tstep--cur {
  color: var(--rac-hi);
  border-color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 22%, var(--rac-panel-2));
  box-shadow: inset 0 -2px 0 var(--rac-accent);
  font-weight: 700;
}

.tier-badge {
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 2px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel-2);
  color: var(--rac-text);
  font-variant-numeric: tabular-nums;
}
.tier-badge--t1 {
  color: var(--rac-accent);
  border-color: color-mix(in srgb, var(--rac-accent) 45%, var(--rac-dim));
  background: color-mix(in srgb, var(--rac-accent) 12%, var(--rac-panel-2));
}
.tier-badge--t2 {
  color: var(--rac-warn);
  border-color: color-mix(in srgb, var(--rac-warn) 50%, var(--rac-dim));
  background: color-mix(in srgb, var(--rac-warn) 14%, var(--rac-panel-2));
}
.tier-badge--t3 {
  color: var(--rac-alert);
  border-color: color-mix(in srgb, var(--rac-alert) 55%, var(--rac-dim));
  background: color-mix(in srgb, var(--rac-alert) 15%, var(--rac-panel-2));
}

.eva-badge {
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 2px;
  border: 1px solid color-mix(in srgb, var(--rac-accent) 40%, var(--rac-dim));
  background: color-mix(in srgb, var(--rac-accent) 12%, var(--rac-panel-2));
  color: var(--rac-accent);
  letter-spacing: 0.04em;
}

.filter-pill {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 2px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel);
  color: var(--rac-muted);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.filter-pill:hover {
  background: color-mix(in srgb, var(--rac-accent) 12%, var(--rac-panel-2));
  border-color: color-mix(in srgb, var(--rac-accent) 45%, var(--rac-line));
  color: var(--rac-hi);
}
.filter-pill--active {
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 24%, var(--rac-panel-2)) 0%, color-mix(in srgb, var(--rac-accent) 10%, var(--rac-panel)) 100%);
  color: var(--rac-hi);
  border-color: var(--rac-accent);
  box-shadow: inset 0 -2px 0 var(--rac-accent);
  font-weight: 600;
}

.dot-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}
.dot--active {
  background: var(--rac-warn);
  box-shadow: 0 0 4px var(--rac-warn);
}
.dot--queued {
  background: var(--rac-accent);
}
.dot--done {
  background: var(--rac-ok);
}
.dot--locked {
  background: var(--rac-muted);
}

.view-btn {
  padding: 4px 6px;
  border-radius: 2px;
  color: var(--rac-muted);
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}
.view-btn:hover {
  color: var(--rac-hi);
  background: var(--rac-panel-2);
}
.view-btn--active {
  background: color-mix(in srgb, var(--rac-accent) 22%, var(--rac-panel-2));
  color: var(--rac-hi);
  box-shadow: inset 0 -2px 0 var(--rac-accent);
}

.nav-line-card {
  padding: 6px 8px;
  border-radius: 3px;
  border: 1px solid color-mix(in srgb, var(--rac-accent) 18%, var(--rac-dim));
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 5%, var(--rac-panel-2)) 0%, var(--rac-panel) 100%);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}
.nav-line-card:hover {
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 14%, var(--rac-panel-2)) 0%, var(--rac-panel) 100%);
  border-color: color-mix(in srgb, var(--rac-accent) 55%, var(--rac-line));
}
.nav-line-card--active {
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 22%, var(--rac-panel-2)) 0%, color-mix(in srgb, var(--rac-accent) 8%, var(--rac-panel)) 100%);
  border-color: var(--rac-accent);
  box-shadow:
    inset 3px 0 0 var(--rac-accent),
    inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 24%, transparent);
}

.tech-card {
  padding: 9px 10px;
  border-radius: 3px;
  border: 1px solid color-mix(in srgb, var(--rac-accent) 22%, var(--rac-dim));
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 6%, var(--rac-panel-2)) 0%, var(--rac-panel) 100%);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 16%, transparent),
    inset 2px 0 0 color-mix(in srgb, var(--rac-accent) 40%, var(--rac-dim));
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
  position: relative;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}
.tech-card:hover {
  transform: translateY(-1px);
  border-color: var(--rac-accent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 16%, var(--rac-panel-2)) 0%, color-mix(in srgb, var(--rac-accent) 8%, var(--rac-panel)) 100%);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 28%, transparent),
    inset 3px 0 0 var(--rac-accent),
    0 4px 12px rgba(0, 0, 0, 0.35);
}
.tech-card--done {
  border-color: color-mix(in srgb, var(--rac-ok) 45%, var(--rac-dim));
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-ok) 10%, var(--rac-panel-2)) 0%, var(--rac-panel) 100%);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--rac-ok) 20%, transparent),
    inset 3px 0 0 var(--rac-ok);
}
.tech-card--done:hover {
  border-color: var(--rac-ok);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--rac-ok) 30%, transparent),
    inset 3px 0 0 var(--rac-ok),
    0 4px 12px rgba(0, 0, 0, 0.35);
}
.tech-card--active {
  border-color: color-mix(in srgb, var(--rac-warn) 65%, var(--rac-line));
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-warn) 16%, var(--rac-panel-2)) 0%, var(--rac-panel) 100%);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--rac-warn) 26%, transparent),
    inset 3px 0 0 var(--rac-warn);
}
.tech-card--queued {
  border-color: color-mix(in srgb, var(--rac-warn) 48%, var(--rac-dim));
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-warn) 10%, var(--rac-panel-2)) 0%, var(--rac-panel) 100%);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--rac-warn) 18%, transparent),
    inset 3px 0 0 color-mix(in srgb, var(--rac-warn) 75%, var(--rac-dim));
}
.tech-card--ready {
  border-color: color-mix(in srgb, var(--rac-accent) 50%, var(--rac-dim));
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 12%, var(--rac-panel-2)) 0%, var(--rac-panel) 100%);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 22%, transparent),
    inset 3px 0 0 var(--rac-accent);
}
.tech-card--locked {
  opacity: 0.84;
  border-color: var(--rac-dim);
  background: var(--rac-panel);
  box-shadow: inset 2px 0 0 var(--rac-dim);
}

.missing-prereq-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 2px;
  border: 1px solid color-mix(in srgb, var(--rac-alert) 45%, var(--rac-dim));
  background: color-mix(in srgb, var(--rac-alert) 15%, var(--rac-bg));
  color: var(--rac-alert);
  cursor: pointer;
}
.missing-prereq-chip--protocol {
  border-color: color-mix(in srgb, var(--rac-warn) 50%, var(--rac-dim));
  background: color-mix(in srgb, var(--rac-warn) 15%, var(--rac-bg));
  color: var(--rac-warn);
}
.missing-prereq-chip__kind {
  font-family: monospace;
  opacity: 0.85;
  text-transform: uppercase;
}

.tech-card--highlighted {
  outline: 2px solid var(--rac-warn);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .tech-card, .filter-pill, .view-btn, .nav-line-card, .animate-pulse {
    animation: none !important;
    transition: none !important;
  }
}
</style>
