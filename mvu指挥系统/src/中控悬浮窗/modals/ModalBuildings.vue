<template>
  <div
    ref="backdropRef"
    class="ra-modal-backdrop fixed inset-0 z-90 flex items-center justify-center bg-black/75 p-2 select-none sm:p-4"
    role="dialog"
    aria-modal="true"
    aria-label="基地建筑体系总览"
    @click.self="$emit('close')"
  >
    <div
      ref="panelRef"
      class="ra-bld-modal ob-panel ob-enter flex max-h-[94vh] w-full max-w-[1480px] flex-col overflow-hidden rounded-[2px] border border-(--rac-accent)/60 bg-(--rac-bg) text-(--rac-text) shadow-2xl"
      :style="modalDynamicStyle"
      :data-size-mode="sizeMode"
    >
      <!-- ══ 顶部标题栏：基地/战区切换 + 动态多阵营切换 + 全局 KPI + 视口缩放 + 关闭 ══ -->
      <header
        class="flex flex-wrap items-center justify-between gap-2 border-b border-(--rac-accent)/35 bg-(--rac-panel) px-3 py-2"
        :style="{
          backgroundImage:
            'var(--rac-header-stripe, none), linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 12%, var(--rac-panel-2)) 0%, var(--rac-panel) 100%)',
        }"
      >
        <div class="flex items-center gap-2">
          <Icon name="base" :size="18" class="text-(--rac-accent)" />
          <div>
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-mono text-[15px] font-bold tracking-wider text-(--rac-hi)">
                基地建筑与五大体系总览
              </span>
              <span
                class="rounded-[2px] border border-(--rac-accent)/40 bg-(--rac-panel-2) px-1.5 py-0.5 font-mono text-[12px] text-(--rac-accent)"
                data-test="building-active-base-badge"
              >
                {{ overview.activeBaseName }}
              </span>
              <!-- FD-27 · 基地实时本地时区时间与局部天气轻量徽标 -->
              <span
                class="rounded-[2px] border border-(--rac-accent)/35 bg-(--rac-panel-2) px-1.5 py-0.5 font-mono text-[11px] text-(--rac-accent)"
                data-test="building-base-local-time-badge"
              >
                {{ activeBaseTimezoneWeather.localTimeBadge }}
              </span>
              <span
                class="rounded-[2px] border border-(--rac-dim) bg-(--rac-panel-2) px-1.5 py-0.5 font-mono text-[12px] text-(--rac-text)"
                data-test="building-base-weather-badge"
              >
                <Icon name="sun" :size="11" class="mr-1 inline-block text-(--rac-accent)" />{{ activeBaseTimezoneWeather.weatherBadge }}
              </span>
            </div>
            <p class="font-mono text-[12px] text-(--rac-muted)">
              点击任意建筑可查阅设定档案，或向聊天框填入建造与模式切换指令
            </p>
            <!-- FD-38 · 当前基地空间防区与环境工程胶囊列表 -->
            <div
              v-if="activeBaseSectors.length > 0"
              data-test="modal-buildings-sectors"
              class="mt-1 flex flex-wrap items-center gap-1 font-mono text-[12px]"
            >
              <span class="text-(--rac-muted)">防区与环境工程:</span>
              <span
                v-for="(sec, sIdx) in activeBaseSectors"
                :key="sec.name + sIdx"
                data-test="modal-building-sector-pill"
                class="inline-flex items-center gap-1 rounded-[2px] border border-(--rac-accent)/35 bg-(--rac-panel-2) px-1.5 py-0.5 text-[12px] text-(--rac-accent)"
                :title="sec.titleText"
              >
                <Icon name="shield" :size="12" />
                <span>{{ sec.name }}</span>
                <span v-if="sec.layer" class="text-[11px] text-(--rac-muted)">[{{ sec.layer }}]</span>
              </span>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- FD-39 · 一级视图模式切换器（实况+蓝图 ⇄ 基地实况沙盘 ⇄ 体系蓝图树） -->
          <div
            class="ob-seg flex flex-wrap items-center rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-0.5 font-mono text-[12px]"
            data-test="building-primary-view-switch"
          >
            <button
              type="button"
              class="rounded-[2px] px-2 py-0.5 transition-colors"
              :class="
                primaryViewMode === 'split'
                  ? 'is-active bg-(--rac-accent)/20 font-bold text-(--rac-hi)'
                  : 'text-(--rac-muted) hover:text-(--rac-hi)'
              "
              data-test="building-view-btn-split"
              @click="primaryViewMode = 'split'"
            >
              <Icon name="power" :size="12" /> 全览
            </button>
            <button
              type="button"
              class="rounded-[2px] px-2 py-0.5 transition-colors"
              :class="
                primaryViewMode === 'live'
                  ? 'is-active bg-(--rac-ok)/20 font-bold text-(--rac-hi)'
                  : 'text-(--rac-muted) hover:text-(--rac-hi)'
              "
              data-test="building-view-btn-live"
              @click="primaryViewMode = 'live'"
            >
              <Icon name="base" :size="12" /> 基地实况
            </button>
            <button
              type="button"
              class="rounded-[2px] px-2 py-0.5 transition-colors"
              :class="
                primaryViewMode === 'blueprint'
                  ? 'is-active bg-(--rac-accent)/20 font-bold text-(--rac-hi)'
                  : 'text-(--rac-muted) hover:text-(--rac-hi)'
              "
              data-test="building-view-btn-blueprint"
              @click="primaryViewMode = 'blueprint'"
            >
              <Icon name="layers" :size="12" /> 建造蓝图
            </button>
          </div>

          <!-- 动态多阵营视角切换胶囊（全部 / 盟军 / 苏联 / 尤里 / 动态解锁阵营） -->
          <div
            class="ob-seg flex flex-wrap items-center rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-0.5 font-mono text-[12px]"
            data-test="building-faction-switch"
          >
            <button
              v-for="pill in availableFactionPills"
              :key="pill.id"
              type="button"
              class="rounded-[2px] px-2 py-0.5 transition-colors"
              :class="factionFilter === pill.id ? pill.activeClass : pill.inactiveClass"
              :data-faction-filter="pill.id"
              :data-test="`building-faction-btn-${pill.id}`"
              @click="factionFilter = pill.id as BuildingFactionFilter"
            >
              {{ pill.label }}
            </button>
          </div>

          <!-- 当前基地 / 战区全局 切换胶囊 -->
          <div
            class="ob-seg flex items-center rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-0.5 font-mono text-[12px]"
            data-test="building-scope-switch"
          >
            <button
              type="button"
              class="rounded-[2px] px-2 py-0.5 transition-colors"
              :class="
                scopeMode === 'base'
                  ? 'is-active bg-(--rac-accent)/20 font-bold text-(--rac-hi)'
                  : 'text-(--rac-muted) hover:text-(--rac-hi)'
              "
              @click="scopeMode = 'base'"
            >
              当前基地
            </button>
            <button
              type="button"
              class="rounded-[2px] px-2 py-0.5 transition-colors"
              :class="
                scopeMode === 'global'
                  ? 'is-active bg-(--rac-accent)/20 font-bold text-(--rac-hi)'
                  : 'text-(--rac-muted) hover:text-(--rac-hi)'
              "
              @click="scopeMode = 'global'"
            >
              战区全局
            </button>
          </div>

          <!-- 可编辑/双模调度模式开关 -->
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-[2px] border px-2.5 py-0.5 font-mono text-[12px] font-semibold transition-colors"
            :class="
              editMode
                ? 'border-(--rac-warn) bg-(--rac-panel-2) text-(--rac-warn)'
                : 'border-(--rac-dim) bg-(--rac-panel) text-(--rac-muted) hover:border-(--rac-accent) hover:text-(--rac-hi)'
            "
            data-test="building-edit-mode-toggle"
            @click="editMode = !editMode"
          >
            <Icon name="wrench" :size="12" />
            <span>{{ editMode ? '完成调度' : '产线与供电调度' }}</span>
          </button>

          <!-- 多基地快速切换胶囊 -->
          <div v-if="bases.length > 1 && scopeMode === 'base'" class="flex items-center gap-1">
            <button
              v-for="(b, idx) in bases"
              :key="b.id || idx"
              type="button"
              class="rounded-[2px] border px-2 py-0.5 font-mono text-[12px] transition-colors"
              :class="
                idx === activeBaseIndex
                  ? 'border-(--rac-accent) bg-(--rac-panel-2) text-(--rac-hi)'
                  : 'border-(--rac-dim) bg-(--rac-panel) text-(--rac-muted) hover:text-(--rac-text)'
              "
              @click="$emit('select-base', idx)"
            >
              {{ b.name }}
            </button>
          </div>

          <!-- 顶栏 KPI 摘要 -->
          <div class="hidden items-center gap-2 font-mono text-[12px] md:flex">
            <span class="ob-tag">
              <b>已建</b>
              <i class="text-(--rac-ok)">{{ overview.totalBuiltCount }} 座（运转 {{ overview.totalRunningCount }}）</i>
            </span>
            <span class="ob-tag">
              <b>在建</b>
              <i class="text-(--rac-warn)">{{ overview.totalBuildingQueueCount }} 项</i>
            </span>
            <span class="ob-tag" :class="{ 'is-alert': overview.powerSummary.net < 0 }">
              <b>净电</b>
              <i :class="overview.powerSummary.net >= 0 ? 'text-(--rac-ok)' : 'text-(--rac-alert)'">
                {{ overview.powerSummary.net >= 0 ? `+${overview.powerSummary.net}` : overview.powerSummary.net }}
              </i>
            </span>
          </div>

          <!-- 弹窗视口尺寸切换按钮（宽屏 90% ⇄ 全屏 96% ⇄ 标准 1080） -->
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-[2px] border border-(--rac-dim) bg-(--rac-panel-2) px-2 py-1 font-mono text-[12px] font-bold text-(--rac-accent) transition-colors hover:border-(--rac-accent) hover:text-(--rac-hi)"
            data-test="building-modal-size-btn"
            :title="`切换窗口尺寸（当前：${sizeModeLabel}）`"
            @click="onCycleSizeMode"
          >
            <Icon name="grid" :size="11" /> {{ sizeModeLabel }}
          </button>

          <button
            type="button"
            class="rounded-[2px] border border-(--rac-dim) bg-(--rac-panel-2) px-2.5 py-1 font-mono text-[12px] text-(--rac-muted) hover:border-(--rac-accent) hover:text-(--rac-hi)"
            aria-label="关闭基地建筑弹窗"
            @click="$emit('close')"
          >
            × 关闭
          </button>
        </div>
      </header>

      <!-- ══ 五大建筑体系独立页签（D-BLD-02） ══ -->
      <nav
        v-if="primaryViewMode !== 'live'"
        class="ob-seg grid grid-cols-5 gap-1 border-b border-(--rac-accent)/30 bg-(--rac-panel) px-3 py-1.5"
        aria-label="五大建筑体系切换"
      >
        <button
          v-for="tab in BUILDING_SYSTEM_TABS"
          :key="tab.id"
          type="button"
          class="flex items-center justify-between rounded-[2px] border px-2.5 py-1.5 text-left transition-all"
          :class="
            activeSystemId === tab.id
              ? 'is-active border-(--rac-accent) bg-(--rac-panel-2) text-(--rac-hi) shadow-inner'
              : 'border-(--rac-dim)/60 bg-(--rac-panel) text-(--rac-muted) hover:border-(--rac-accent)/50 hover:text-(--rac-text)'
          "
          :style="
            activeSystemId === tab.id
              ? {
                  background:
                    'linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 20%, var(--rac-panel-2)) 0%, color-mix(in srgb, var(--rac-accent) 6%, var(--rac-panel)) 100%)',
                  borderTop: '2px solid var(--rac-accent)',
                  boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 24%, transparent)',
                }
              : undefined
          "
          :data-test="`building-tab-${tab.id}`"
          @click="
            activeSystemId = tab.id;
            expandedNodeId = null;
            hoveredNodeId = null;
          "
        >
          <div class="flex min-w-0 items-center gap-1.5">
            <Icon :name="tab.icon" :size="15" />
            <div class="truncate">
              <div class="truncate font-mono text-[12px] font-semibold">{{ tab.label }}</div>
              <div class="hidden truncate font-mono text-[11px] opacity-75 lg:block">{{ tab.subtitle }}</div>
            </div>
          </div>
          <span
            class="ml-1 flex-none rounded-[2px] bg-black/40 px-1.5 py-0.5 font-mono text-[11px]"
            :class="overview.systems[tab.id].builtNodeCount > 0 ? 'text-(--rac-ok)' : 'text-(--rac-muted)'"
          >
            {{ overview.systems[tab.id].builtNodeCount }}/{{ overview.systems[tab.id].totalNodeCount }}
          </span>
        </button>
      </nav>

      <!-- ══ 主内容滚动区：交互式蓝图拓扑 + 4 格体系能力指标 + 已建建筑检索清单 ══ -->
      <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
        <!-- MCV 尚未展开时的最高优先级门禁警告条 -->
        <div
          v-if="!overview.hasOperationalConyard"
          class="ob-hatch flex flex-none shrink-0 flex-wrap items-center justify-between gap-2 rounded-[2px] border border-(--rac-warn)/70 bg-(--rac-panel-2) px-3 py-1.5 font-mono text-[12px] text-(--rac-warn)"
          data-test="building-no-conyard-banner"
        >
          <span class="inline-flex items-center gap-1">
            <Icon name="alert" :size="12" />
            建造厂尚未展开：当前{{ scopeMode === 'global' ? '战区' : '基地' }}无运转中的建造厂，暂无法新建任何设施。
          </span>
          <button
            type="button"
            class="rounded-[2px] border border-(--rac-warn) bg-(--rac-panel) px-2 py-0.5 text-[12px] font-bold text-(--rac-hi) hover:bg-(--rac-panel-2)"
            data-test="deploy-mcv-order-btn"
            @click="onDeployMcvOrder"
          >
            下令展开基地车 (MCV)
          </button>
        </div>

        <!-- ══ FD-39 · 基地实况三环/分层沙盘与防区工程看板区 ══ -->
        <section
          v-if="primaryViewMode !== 'blueprint'"
          class="ob-panel flex flex-none shrink-0 flex-col gap-2.5 rounded-[2px] border border-(--rac-accent)/45 bg-(--rac-panel) p-2.5 font-mono"
          data-test="building-live-sandbox-section"
        >
          <!-- 顶条：本基地建造厂中枢（多 MCV 合署展示） + 垂直空间层位筛选器 -->
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-(--rac-dim)/60 pb-2">
            <div class="flex flex-wrap items-center gap-1.5 text-[12px]" data-test="live-conyard-hubs">
              <span class="inline-flex items-center gap-1 font-bold text-(--rac-accent)">
                <Icon name="base" :size="12" /> 基地建造中枢：
              </span>
              <span
                v-if="liveSandbox.conyardHubs.length > 1"
                class="rounded-[2px] border border-(--rac-warn)/60 bg-(--rac-panel-2) px-1.5 py-0.5 text-[11px] font-bold text-(--rac-warn)"
                data-test="live-multi-conyard-badge"
              >
                多中枢合署 ×{{ liveSandbox.conyardHubs.length }}
              </span>
              <span
                v-for="(hub, hIdx) in liveSandbox.conyardHubs"
                :key="`${hub.name}-${hIdx}`"
                class="inline-flex items-center gap-1 rounded-[2px] border border-(--rac-warn)/50 bg-(--rac-panel-2) px-1.5 py-0.5 text-[11px] text-(--rac-warn)"
                data-test="live-conyard-hub-pill"
              >
                <Icon name="base" :size="11" />
                <span>◆ {{ hub.name }} · 核心(0,0) · +{{ hub.powerGen }}W</span>
                <span v-if="hub.layer" class="text-[11px] text-(--rac-muted)">[{{ hub.layer }}]</span>
              </span>
              <span
                v-if="liveSandbox.conyardHubs.length === 0"
                class="inline-flex items-center gap-1 text-[12px] text-(--rac-warn)"
              >
                <Icon name="alert" :size="12" /> 尚未展开建造厂核心
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-1 text-[12px]" data-test="live-layer-filter">
              <span class="text-(--rac-muted)">部署区域:</span>
              <button
                type="button"
                class="rounded-[2px] border px-1.5 py-0.5 transition-colors"
                :class="
                  selectedLayerFilter === 'all'
                    ? 'border-(--rac-accent) bg-(--rac-panel-2) font-bold text-(--rac-hi)'
                    : 'border-(--rac-dim) bg-(--rac-panel) text-(--rac-muted) hover:text-(--rac-hi)'
                "
                data-test="live-layer-btn-all"
                @click="selectedLayerFilter = 'all'"
              >
                全部区域 ({{ liveSandbox.allInstances.length }})
              </button>
              <button
                v-for="lyr in liveSandbox.availableLayers"
                :key="lyr"
                type="button"
                class="rounded-[2px] border px-1.5 py-0.5 transition-colors"
                :class="
                  selectedLayerFilter === lyr
                    ? 'border-(--rac-accent) bg-(--rac-panel-2) font-bold text-(--rac-accent)'
                    : 'border-(--rac-dim) bg-(--rac-panel) text-(--rac-muted) hover:text-(--rac-accent)'
                "
                :data-test="`live-layer-btn-${lyr}`"
                @click="selectedLayerFilter = lyr"
              >
                {{ lyr }}
              </button>
            </div>
          </div>

          <!-- 主体三栏网格：左栏基地防务态势图 + 中栏基地现有与在建设施 + 右栏电网负荷明细 -->
          <div class="grid grid-cols-1 gap-2.5 lg:grid-cols-12">
            <!-- 左栏（4 列）：MCV 三环战术空间沙盘 -->
            <div
              class="flex flex-col justify-between gap-2 rounded-[2px] border border-(--rac-dim)/80 bg-(--rac-panel-2) p-2 lg:col-span-4"
              data-test="live-tactical-sandbox-plot"
            >
              <div class="flex flex-wrap items-center justify-between gap-1 text-[12px]">
                <span class="inline-flex items-center gap-1 font-bold text-(--rac-accent)">
                  <Icon name="compass" :size="12" /> 基地防务态势图
                </span>
                <span class="text-[11px] text-(--rac-muted)">
                  核心{{ liveSandbox.ringCounts.core }} · 内环{{ liveSandbox.ringCounts.inner }} · 中环{{ liveSandbox.ringCounts.mid }} · 外环{{ liveSandbox.ringCounts.outer }}
                </span>
              </div>

              <div
                class="ob-dotgrid relative mx-auto aspect-square w-full max-w-[220px] overflow-hidden rounded-[2px] border border-(--rac-accent)/45 bg-(--rac-bg)"
                :style="{
                  backgroundImage:
                    'radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--rac-accent) 12%, var(--rac-bg)) 0%, var(--rac-bg) 80%)',
                  boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 20%, transparent)',
                }"
              >
                <div class="pointer-events-none absolute inset-[4%] rounded-full border border-dashed border-(--rac-alert)/35" />
                <div class="pointer-events-none absolute inset-[18%] rounded-full border border-dashed border-(--rac-ok)/35" />
                <div class="pointer-events-none absolute inset-[33%] rounded-full border border-dashed border-(--rac-accent)/40" />
                <div class="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-(--rac-line)/30" />
                <div class="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-(--rac-line)/30" />
                <span class="pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 text-[11px] text-(--rac-muted)">N</span>
                <span class="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-[11px] text-(--rac-muted)">S</span>
                <span class="pointer-events-none absolute top-1/2 left-1.5 -translate-y-1/2 text-[11px] text-(--rac-muted)">W</span>
                <span class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[11px] text-(--rac-muted)">E</span>
                <span class="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] font-bold text-(--rac-warn)">
                  ⊕ MCV (0,0)
                </span>

                <button
                  v-for="blip in filteredLiveBlips"
                  :key="blip.key"
                  type="button"
                  class="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/80 shadow transition-transform hover:scale-125"
                  :class="blip.instance.state === '建造中' ? 'ring-1 ring-(--rac-warn)' : ''"
                  :style="{ left: `${blip.leftPct}%`, top: `${blip.topPct}%`, backgroundColor: blip.color }"
                  :title="blip.titleText"
                  :data-building-name="blip.instance.name"
                  :data-ring="blip.ring"
                  :data-state="blip.instance.state"
                  data-test="live-sandbox-blip"
                  @mouseenter="selectedLiveBlipKey = blip.key"
                  @click="selectedLiveBlipKey = blip.key"
                />
              </div>

              <div
                class="flex flex-wrap items-center justify-between gap-1 rounded-[2px] border border-(--rac-dim)/60 bg-(--rac-panel) px-2 py-1 text-[11px]"
                data-test="live-selected-blip-detail"
              >
                <div v-if="selectedLiveBlip" class="min-w-0 flex-1">
                  <div class="truncate font-semibold text-(--rac-hi)">
                    #{{ selectedLiveBlip.instance.instanceOrdinal || 1 }} {{ selectedLiveBlip.instance.name }} ｜ {{ selectedLiveBlip.instance.layer || '地面' }} ｜ {{ selectedLiveBlip.ringLabel }} · {{ selectedLiveBlip.bearingLabel }}
                  </div>
                  <div class="truncate text-(--rac-muted)">
                    {{
                      `状态: ${selectedLiveBlip.instance.state}${
                        selectedLiveBlip.instance.state === '建造中'
                          ? ` ${selectedLiveBlip.instance.progress ?? 0}%${selectedLiveBlip.instance.eta ? ` · ${selectedLiveBlip.instance.eta}` : ''}`
                          : ''
                      }${
                        selectedLiveBlip.instance.addons?.length
                          ? ` ｜ 附属模块: + ${selectedLiveBlip.instance.addons.join(' / ')}`
                          : ''
                      }`
                    }}
                  </div>
                </div>
                <span v-else class="text-(--rac-muted)">悬停或点击态势图光点查看设施位置与状态</span>
                <button
                  v-if="selectedLiveBlip"
                  type="button"
                  class="flex-none inline-flex items-center gap-1 rounded-[2px] border border-(--rac-accent)/50 bg-(--rac-panel-2) px-1.5 py-0.5 text-[11px] text-(--rac-accent) hover:bg-(--rac-bg)"
                  @click="onClickNode(selectedLiveBlip.instance.name)"
                >
                  <Icon name="doc" :size="11" /> 查阅档案
                </button>
              </div>
            </div>
            <!-- 中栏（5 列）：本基地现有与在建设施列表 -->
            <div
              class="flex flex-col gap-1.5 rounded-[2px] border border-(--rac-dim)/80 bg-(--rac-panel-2) p-2 lg:col-span-5"
              data-test="live-base-instances-panel"
            >
              <div class="flex flex-wrap items-center justify-between gap-1 text-[12px]">
                <span class="inline-flex items-center gap-1 font-bold text-(--rac-hi)">
                  <Icon name="base" :size="12" /> 基地现有与在建设施（{{ filteredLiveInstances.length }} 座）
                </span>
                <span
                  v-if="liveSandbox.underConstructionInstances.length > 0"
                  class="inline-flex items-center gap-1 text-(--rac-warn)"
                >
                  <Icon name="hammer" :size="11" /> 在建 {{ liveSandbox.underConstructionInstances.length }} 座
                </span>
              </div>

              <div class="flex max-h-[260px] flex-col gap-1 overflow-y-auto pr-0.5">
                <div
                  v-for="(inst, rIdx) in filteredLiveInstances"
                  :key="`${inst.baseIndex}-${inst.buildingIndex}-${inst.name}-${rIdx}`"
                  class="flex flex-col gap-1 rounded-[2px] border border-(--rac-dim)/70 bg-(--rac-panel) px-2 py-1.5 text-[12px] transition-colors hover:border-(--rac-accent)/60"
                  :data-building-name="inst.name"
                  :data-state="inst.state"
                  data-test="live-building-instance-row"
                >
                  <div class="flex flex-wrap items-center justify-between gap-1">
                    <button
                      type="button"
                      class="flex min-w-0 items-center gap-1 text-left font-semibold text-(--rac-hi) hover:text-(--rac-accent)"
                      @click="onClickNode(inst.name)"
                    >
                      <span class="truncate">{{ inst.name }}</span>
                      <span class="text-[11px] text-(--rac-accent)">#{{ inst.instanceOrdinal || 1 }}</span>
                      <span class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-1 text-[11px] text-(--rac-muted)">
                        [{{ inst.layer || '地面' }}]
                      </span>
                    </button>

                    <div class="flex flex-wrap items-center gap-1">
                      <span
                        class="rounded-[2px] border px-1.5 py-0.5 text-[11px] font-semibold"
                        :class="
                          inst.state === '运转'
                            ? 'border-(--rac-ok)/45 bg-(--rac-panel-2) text-(--rac-ok)'
                            : inst.state === '建造中'
                              ? 'border-(--rac-warn)/55 bg-(--rac-panel-2) text-(--rac-warn)'
                              : inst.state === '受损'
                                ? 'border-(--rac-alert)/55 bg-(--rac-panel-2) text-(--rac-alert)'
                                : 'border-(--rac-dim) bg-(--rac-panel-2) text-(--rac-muted)'
                        "
                      >
                        {{
                          inst.state === '建造中'
                            ? `◆ 建造中 ${inst.progress ?? 0}%${inst.eta ? ` · ${inst.eta}` : ''}`
                            : inst.state === '受损'
                              ? '◆ 受损'
                              : inst.state
                        }}
                      </span>
                      <span
                        class="rounded-[2px] border px-1 py-0.5 text-[11px]"
                        :class="
                          (inst.powerGen ?? 0) > 0
                            ? 'border-(--rac-ok)/40 bg-(--rac-panel-2) text-(--rac-ok)'
                            : (inst.powerUse ?? 0) > 0
                              ? 'border-(--rac-warn)/40 bg-(--rac-panel-2) text-(--rac-warn)'
                              : 'border-(--rac-dim) bg-(--rac-panel-2) text-(--rac-muted)'
                        "
                      >
                        {{
                          (inst.powerGen ?? 0) > 0
                            ? `+${inst.powerGen}W`
                            : (inst.powerUse ?? 0) > 0
                              ? `-${inst.powerUse}W`
                              : '0W'
                        }}
                      </span>
                    </div>
                  </div>

                  <div class="flex flex-wrap items-center justify-between gap-1">
                    <div class="flex flex-wrap items-center gap-1">
                      <span
                        class="py-0.2 inline-flex items-center rounded-[2px] border px-1.5 text-[11px] font-semibold"
                        :class="coordRingBadgeClass(inst.ring || 'mid')"
                        :data-ring="inst.ring || 'mid'"
                        data-test="live-sandbox-coord-badge"
                      >
                        {{
                          inst.ring === 'core'
                            ? `◆ ${inst.bearingLabel || 'MCV原点 (0,0)'}`
                            : `◆ ${inst.ringLabel || '中环'} · ${inst.bearingLabel || 'MCV原点 (0,0)'}`
                        }}
                      </span>
                      <span
                        v-for="addonName in inst.addons ?? []"
                        :key="addonName"
                        class="py-0.2 rounded-[2px] border border-(--rac-ok)/50 bg-(--rac-panel-2) px-1 text-[11px] text-(--rac-ok)"
                        data-test="live-instance-addon-pill"
                      >
                        + {{ addonName }}
                      </span>
                    </div>

                    <button
                      v-if="inst.dualModeCapable && inst.state !== '建造中' && inst.buildingIndex >= 0"
                      type="button"
                      class="rounded-[2px] border px-1.5 py-0.5 text-[11px] font-semibold transition-colors"
                      :class="
                        inst.mode === '加速'
                          ? 'border-(--rac-warn)/70 bg-(--rac-panel-2) text-(--rac-warn) hover:bg-(--rac-bg)'
                          : 'border-(--rac-accent)/60 bg-(--rac-panel-2) text-(--rac-accent) hover:bg-(--rac-bg)'
                      "
                      :data-test="`live-toggle-mode-${inst.baseIndex}-${inst.buildingIndex}`"
                      @click.stop="toggleInstanceMode(inst)"
                    >
                      {{ inst.mode === '加速' ? '加速 ⇄ 生产' : '生产 ⇄ 加速' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <!-- 右栏（3 列）：基地电网收支明细账本 -->
            <div
              class="flex flex-col justify-between gap-2 rounded-[2px] border border-(--rac-dim)/80 bg-(--rac-panel-2) p-2 lg:col-span-3"
              data-test="live-power-ledger-panel"
            >
              <div class="flex flex-col gap-1 border-b border-(--rac-dim)/60 pb-1.5 text-[12px]">
                <span class="inline-flex items-center gap-1 font-bold text-(--rac-ok)">
                  <Icon name="power" :size="12" /> 基地电网负荷明细
                </span>
                <div class="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                  <span class="text-(--rac-ok)">供电 +{{ liveSandbox.powerLedger.reportedGen }}W</span>
                  <span class="text-(--rac-warn)">负载 -{{ liveSandbox.powerLedger.reportedUse }}W</span>
                  <span
                    class="font-bold"
                    :class="liveSandbox.powerLedger.net >= 0 ? 'text-(--rac-ok)' : 'text-(--rac-alert)'"
                  >
                    净余 {{ liveSandbox.powerLedger.net >= 0 ? `+${liveSandbox.powerLedger.net}` : liveSandbox.powerLedger.net }}W
                  </span>
                </div>
              </div>

              <div class="flex max-h-[230px] flex-1 flex-col gap-2 overflow-y-auto text-[11px]">
                <div>
                  <div class="mb-1 inline-flex items-center gap-1 font-bold text-(--rac-ok)">
                    <Icon name="power" :size="11" /> 发电设施明细（{{ liveSandbox.powerLedger.generators.length }} 座）
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <div
                      v-for="g in liveSandbox.powerLedger.generators"
                      :key="g.key"
                      class="flex items-center justify-between gap-1 rounded-[2px] bg-(--rac-panel) px-1.5 py-0.5"
                    >
                      <span class="truncate text-(--rac-hi)">{{ g.instanceLabel }}</span>
                      <span class="flex-none font-bold text-(--rac-ok)">+{{ g.gen }}W</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div class="mb-1 inline-flex items-center gap-1 font-bold text-(--rac-warn)">
                    <Icon name="plug" :size="11" /> 耗电负载明细（{{ liveSandbox.powerLedger.consumers.length }} 座）
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <div
                      v-for="c in liveSandbox.powerLedger.consumers"
                      :key="c.key"
                      class="flex items-center justify-between gap-1 rounded-[2px] bg-(--rac-panel) px-1.5 py-0.5"
                    >
                      <span class="truncate text-(--rac-muted)">
                        {{ c.instanceLabel }}
                        <span v-if="c.state === '建造中'" class="text-(--rac-warn)">[在建]</span>
                      </span>
                      <span class="flex-none text-(--rac-warn)">-{{ c.use }}W</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 底栏：基地空间防区与环境工程看板 -->
          <div
            class="flex flex-col gap-2 rounded-[2px] border border-(--rac-accent)/35 bg-(--rac-panel-2) p-2"
            data-test="live-sectors-board"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 text-[12px]">
                <span class="inline-flex items-center gap-1 font-bold text-(--rac-accent)">
                  <Icon name="shield" :size="12" /> 基地防区与环境工程（{{ filteredLiveSectors.length }} 处）
                </span>
                <span class="text-[11px] text-(--rac-muted)">
                  各防区工事状态、驻地设施与抢修调度
                </span>
              </div>
              <button
                type="button"
                class="rounded-[2px] border border-(--rac-accent)/60 bg-(--rac-panel) px-2 py-0.5 text-[12px] font-bold text-(--rac-accent) hover:bg-(--rac-bg)"
                data-test="live-sector-create-btn"
                @click="onTriggerSectorOrder(undefined, 'create')"
              >
                + 新辟防区工程
              </button>
            </div>

            <div
              v-if="filteredLiveSectors.length === 0"
              class="py-1.5 text-center text-[12px] text-(--rac-muted)"
            >
              当前区域暂无防区工事 · 可点击右上角「+ 新辟防区工程」下达勘探与改造指令
            </div>

            <div v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div
                v-for="(sec, sIdx) in filteredLiveSectors"
                :key="`${sec.name}-${sIdx}`"
                class="flex flex-col justify-between gap-1.5 rounded-[2px] border border-(--rac-accent)/35 bg-(--rac-panel) p-2 text-[12px]"
                data-test="live-sector-card"
              >
                <div class="flex flex-col gap-1">
                  <div class="flex flex-wrap items-center justify-between gap-1">
                    <div class="flex items-center gap-1 font-bold text-(--rac-accent)">
                      <Icon name="shield" :size="12" />
                      <span>{{ sec.name }}</span>
                      <span class="rounded-[2px] border border-(--rac-accent)/40 bg-(--rac-panel-2) px-1 text-[11px] text-(--rac-accent)">
                        [{{ sec.layer || '地面防区' }}]
                      </span>
                    </div>
                    <span
                      class="rounded-[2px] border px-1.5 py-0.5 text-[11px] font-semibold"
                      :class="
                        sec.statusTone === 'danger'
                          ? 'border-(--rac-alert)/55 bg-(--rac-panel-2) text-(--rac-alert)'
                          : sec.statusTone === 'warn'
                            ? 'border-(--rac-warn)/55 bg-(--rac-panel-2) text-(--rac-warn)'
                            : sec.statusTone === 'accent'
                              ? 'border-(--rac-accent)/55 bg-(--rac-panel-2) text-(--rac-accent)'
                              : 'border-(--rac-ok)/45 bg-(--rac-panel-2) text-(--rac-ok)'
                      "
                    >
                      {{ sec.status }}
                    </span>
                  </div>

                  <p class="leading-relaxed text-(--rac-text)" data-test="live-sector-desc">
                    {{ sec.desc || '防区工事运转正常' }}
                  </p>
                </div>

                <div class="flex flex-col gap-1 border-t border-(--rac-dim)/50 pt-1">
                  <div class="flex flex-wrap items-center gap-1 text-[11px] text-(--rac-muted)">
                    <span>区域内设施:</span>
                    <template v-if="sec.coLocatedBuildings.length > 0">
                      <span
                        v-for="bName in sec.coLocatedBuildings"
                        :key="bName"
                        class="rounded-[2px] border border-(--rac-dim) bg-(--rac-panel-2) px-1 text-(--rac-text)"
                      >
                        {{ bName }}
                      </span>
                    </template>
                    <span v-else>暂无同区设施</span>
                  </div>

                  <div class="flex flex-wrap items-center justify-end gap-1">
                    <button
                      type="button"
                      class="rounded-[2px] border border-(--rac-accent)/50 bg-(--rac-panel-2) px-1.5 py-0.5 text-[12px] font-semibold text-(--rac-accent) hover:bg-(--rac-bg)"
                      data-test="sector-reinforce-btn"
                      @click="onTriggerSectorOrder(sec, 'reinforce')"
                    >
                      加固/扩建
                    </button>
                    <button
                      v-if="sec.statusTone === 'danger' || sec.statusTone === 'warn'"
                      type="button"
                      class="rounded-[2px] border border-(--rac-alert)/60 bg-(--rac-panel-2) px-1.5 py-0.5 text-[12px] font-semibold text-(--rac-alert) hover:bg-(--rac-bg)"
                      data-test="sector-repair-btn"
                      @click="onTriggerSectorOrder(sec, 'repair')"
                    >
                      紧急抢修
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <template v-if="primaryViewMode !== 'live'">
        <!-- 图例提示条与交互式蓝图工具栏 -->
        <div
          class="flex flex-none shrink-0 flex-wrap items-center justify-between gap-2 rounded-[2px] border border-(--rac-dim)/60 bg-(--rac-panel) px-3 py-1.5 font-mono text-[12px]"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-bold text-(--rac-accent)">
              {{ currentSystem.meta.label }} · {{ currentSystem.meta.subtitle }}
            </span>
            <!-- 拓扑模式切换按钮（cluster 同类归并 ⇄ expanded 全部型号展开） -->
            <button
              type="button"
              class="rounded-[2px] border px-2 py-0.5 font-mono text-[12px] font-bold transition-colors"
              :class="
                topologyViewMode === 'expanded'
                  ? 'border-(--rac-warn) bg-(--rac-panel-2) text-(--rac-warn)'
                  : 'border-(--rac-accent)/60 bg-(--rac-panel-2) text-(--rac-accent) hover:bg-(--rac-bg)'
              "
              data-test="building-topology-mode-toggle"
              @click="toggleTopologyViewMode"
            >
              {{
                topologyViewMode === 'expanded'
                  ? '◆ 全部型号展开（点击归并同类）'
                  : '◆ 同类归并视图 ⇄ 全部型号展开'
              }}
            </button>

            <!-- 阵营专属聚焦开关 -->
            <button
              type="button"
              class="rounded-[2px] border px-2 py-0.5 font-mono text-[12px] transition-colors"
              :class="
                hideOtherFactionNodes
                  ? 'border-(--rac-ok)/70 bg-(--rac-panel-2) font-bold text-(--rac-ok)'
                  : 'border-(--rac-dim) bg-(--rac-panel-2) text-(--rac-muted) hover:border-(--rac-accent) hover:text-(--rac-hi)'
              "
              data-test="building-hide-other-faction-toggle"
              @click="hideOtherFactionNodes = !hideOtherFactionNodes"
            >
              {{
                hideOtherFactionNodes
                  ? '◆ 仅看本阵营与通用设施'
                  : '◇ 显示全部阵营设施'
              }}
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-2.5">
            <!-- 画布缩放与居中控制栏 -->
            <div
              class="flex items-center gap-1 rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-1.5 py-0.5"
              data-test="building-canvas-controls"
            >
              <button
                type="button"
                class="py-0.2 rounded-[2px] px-1.5 text-[11px] text-(--rac-muted) hover:bg-(--rac-panel-2) hover:text-(--rac-hi)"
                data-test="building-zoom-out-btn"
                title="缩小蓝图画布"
                @click="zoomOutCanvas"
              >
                - 缩小
              </button>
              <button
                type="button"
                class="py-0.2 rounded-[2px] border border-(--rac-dim)/60 bg-(--rac-panel) px-1.5 text-[11px] text-(--rac-accent) hover:border-(--rac-accent)"
                data-test="building-zoom-reset-btn"
                title="重置缩放与居中适配"
                @click="resetCanvasView"
              >
                {{ Math.round(canvasZoom * 100) }}% / 适配
              </button>
              <button
                type="button"
                class="py-0.2 rounded-[2px] px-1.5 text-[11px] text-(--rac-muted) hover:bg-(--rac-panel-2) hover:text-(--rac-hi)"
                data-test="building-zoom-in-btn"
                title="放大蓝图画布"
                @click="zoomInCanvas"
              >
                + 放大
              </button>
              <button
                type="button"
                class="py-0.2 rounded-[2px] border px-1.5 text-[11px] transition-colors"
                :class="
                  canvasTallMode
                    ? 'border-(--rac-accent) bg-(--rac-panel-2) font-bold text-(--rac-hi)'
                    : 'border-(--rac-dim)/60 bg-(--rac-panel) text-(--rac-muted) hover:text-(--rac-hi)'
                "
                data-test="building-canvas-expand-btn"
                title="切换蓝图画布高度"
                @click="canvasTallMode = !canvasTallMode"
              >
                {{ canvasTallMode ? '▲ 标准高度' : '▼ 加高画布' }}
              </button>
            </div>

            <!-- 状态图例 -->
            <div class="hidden flex-wrap items-center gap-2.5 xl:flex">
              <span class="flex items-center gap-1">
                <i class="inline-block size-2.5 rounded-[1px] border border-(--rac-ok) bg-(--rac-panel-2)" />
                已建成
              </span>
              <span class="flex items-center gap-1">
                <i class="inline-block size-2.5 rounded-[1px] border border-(--rac-warn) bg-(--rac-panel-2)" />
                建造中
              </span>
              <span class="flex items-center gap-1">
                <i class="inline-block size-2.5 rounded-[1px] border border-dashed border-(--rac-accent) bg-(--rac-panel-2)" />
                已解锁
              </span>
              <span class="flex items-center gap-1">
                <i class="inline-block size-2.5 rounded-[1px] border border-(--rac-warn) bg-(--rac-panel)" />
                上游前置
              </span>
              <span class="flex items-center gap-1">
                <i class="inline-block size-2.5 rounded-[1px] border border-(--rac-accent) bg-(--rac-panel)" />
                下游解锁
              </span>
            </div>
          </div>
        </div>

        <!-- ══ 全体系蓝图对照 SVG（D-BLD-03：默认基线 viewBox="0 0 960 460"，支持 Dagre 自动拓扑、滚轮缩放与按住拖拽平移） ══ -->
        <div
          class="ob-dotgrid relative w-full flex-none shrink-0 overflow-auto rounded-[2px] border border-(--rac-accent)/40 bg-(--rac-bg)"
          :class="[
            canvasTallMode ? 'h-[580px] min-h-[580px]' : 'min-h-[360px]',
            isDraggingCanvas ? 'cursor-grabbing' : 'cursor-grab',
          ]"
          :style="{
            backgroundImage:
              'radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--rac-accent) 10%, var(--rac-bg)) 0%, var(--rac-bg) 80%)',
            boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 22%, transparent)',
          }"
          data-test="building-blueprint-svg-wrap"
          @wheel.prevent="onCanvasWheel"
          @mousedown="onCanvasMouseDown"
          @mousemove="onCanvasMouseMove"
          @mouseup="onCanvasMouseUp"
          @mouseleave="onCanvasMouseUp"
        >
          <svg
            :viewBox="blueprintLayout.viewBox"
            class="block h-auto w-full min-w-[780px]"
            :class="canvasTallMode ? 'min-h-[560px]' : 'min-h-[340px]'"
            role="img"
            :aria-label="`${currentSystem.meta.label}蓝图拓扑图`"
          >
            <defs>
              <pattern id="bld-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="var(--rac-dot)" stroke-width="0.6" stroke-opacity="0.55" />
              </pattern>
              <marker id="arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--rac-ok)" />
              </marker>
              <marker id="arrow-dim" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--rac-line)" />
              </marker>
              <marker id="arrow-feedback" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--rac-accent)" />
              </marker>
              <marker id="arrow-upstream" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--rac-warn)" />
              </marker>
              <marker id="arrow-downstream" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--rac-accent)" />
              </marker>
            </defs>

            <rect :width="blueprintLayout.viewBoxWidth" :height="blueprintLayout.viewBoxHeight" fill="url(#bld-grid)" />

            <g :transform="canvasTransformAttr" data-test="building-blueprint-viewport">
              <!-- 体系专属底图分区背景（同类归并模式下显示四圈/四阶泳道参照） -->
              <g v-if="activeSystemId === 'defense' && topologyViewMode === 'cluster' && !hideOtherFactionNodes" class="opacity-80">
                <rect x="25" y="20" width="190" height="420" rx="2" fill="var(--rac-panel)" stroke="var(--rac-dim)" stroke-dasharray="4 3" />
                <text x="120" y="40" text-anchor="middle" fill="var(--rac-accent)" font-size="11" font-family="monospace">
                  外圈 · 远程预警与区域防空
                </text>
                <rect x="270" y="20" width="190" height="420" rx="2" fill="var(--rac-panel)" stroke="var(--rac-dim)" stroke-dasharray="4 3" />
                <text x="365" y="40" text-anchor="middle" fill="var(--rac-accent)" font-size="11" font-family="monospace">
                  中圈 · 中程防空与反装甲火力
                </text>
                <rect x="515" y="20" width="190" height="420" rx="2" fill="var(--rac-panel-2)" stroke="var(--rac-dim)" stroke-dasharray="4 3" />
                <text x="610" y="40" text-anchor="middle" fill="var(--rac-hi)" font-size="11" font-family="monospace">
                  内圈 · 近程点防御与工事屏障
                </text>
                <rect x="745" y="20" width="190" height="420" rx="2" fill="var(--rac-panel-2)" stroke="var(--rac-ok)" stroke-opacity="0.6" />
                <text x="840" y="40" text-anchor="middle" fill="var(--rac-ok)" font-size="11" font-family="monospace">
                  核心内圈 · 地下掩体与损管设施
                </text>
              </g>

              <g v-else-if="activeSystemId === 'agro' && topologyViewMode === 'cluster' && !hideOtherFactionNodes" class="opacity-80">
                <rect x="20" y="20" width="190" height="420" rx="2" fill="var(--rac-panel)" stroke="var(--rac-dim)" stroke-dasharray="4 3" />
                <text x="115" y="40" text-anchor="middle" fill="var(--rac-ok)" font-size="11" font-family="monospace">
                  阶段 I · 水土环控与基础种养
                </text>
                <rect x="270" y="20" width="190" height="420" rx="2" fill="var(--rac-panel)" stroke="var(--rac-dim)" stroke-dasharray="4 3" />
                <text x="365" y="40" text-anchor="middle" fill="var(--rac-ok)" font-size="11" font-family="monospace">
                  阶段 II · 农牧种养区
                </text>
                <rect x="520" y="20" width="190" height="420" rx="2" fill="var(--rac-panel-2)" stroke="var(--rac-dim)" stroke-dasharray="4 3" />
                <text x="615" y="40" text-anchor="middle" fill="var(--rac-ok)" font-size="11" font-family="monospace">
                  阶段 III · 精加工与战略冷链
                </text>
                <rect x="745" y="20" width="190" height="420" rx="2" fill="var(--rac-panel-2)" stroke="var(--rac-ok)" stroke-opacity="0.6" />
                <text x="840" y="40" text-anchor="middle" fill="var(--rac-hi)" font-size="11" font-family="monospace">
                  阶段 IV · 沼气发电与生态循环
                </text>
              </g>

              <!-- 拓扑有向连线（支持上下游依赖链动态流光高亮） -->
              <g>
                <template v-for="edge in renderedEdges" :key="edge.id">
                  <path
                    :d="edge.path"
                    fill="none"
                    :stroke="edge.stroke"
                    :stroke-width="
                      edge.highlightRole === 'upstream' || edge.highlightRole === 'downstream'
                        ? 2.6
                        : edge.active
                          ? 2
                          : 1.3
                    "
                    :stroke-opacity="edge.highlightRole === 'dimmed' ? 0.3 : 1"
                    :stroke-dasharray="
                      edge.highlightRole === 'upstream' || edge.highlightRole === 'downstream'
                        ? '7 4'
                        : edge.feedback
                          ? '6 4'
                          : edge.active
                            ? undefined
                            : '3 3'
                    "
                    :marker-end="edge.marker"
                    :data-edge-id="edge.id"
                    :data-highlight-role="edge.highlightRole"
                  />
                  <text
                    v-if="edge.label"
                    :x="edge.labelX"
                    :y="edge.labelY"
                    text-anchor="middle"
                    fill="var(--rac-accent)"
                    font-size="11"
                    font-family="monospace"
                  >
                    {{ edge.label }}
                  </text>
                </template>
              </g>

              <!-- 拓扑建筑节点卡片（宽度升级为 172px × 高度 58px） -->
              <g
                v-for="node in blueprintLayout.nodes"
                :key="node.id"
                class="cursor-pointer transition-opacity hover:opacity-95"
                :class="{
                  'opacity-40': node.dimmedByFaction && node.highlightRole === 'none',
                  'opacity-35': node.highlightRole === 'dimmed',
                }"
                :data-test="`blueprint-node-${node.id}`"
                :data-highlight-role="node.highlightRole"
                @mouseenter="hoveredNodeId = node.id"
                @mouseleave="hoveredNodeId = null"
                @click.stop="onClickBlueprintNode(node)"
              >
                <title>
                  {{ node.displayName }} · {{ node.statusText }}（含 {{ node.clusterItems.length || 1 }} 种型号 · 点击展开/查阅）
                </title>
                <!-- 选中或悬停上下游高亮外框 -->
                <rect
                  v-if="
                    expandedNodeId === node.id ||
                    node.highlightRole === 'focus' ||
                    node.highlightRole === 'upstream' ||
                    node.highlightRole === 'downstream'
                  "
                  :x="node.x - 90"
                  :y="node.y - 33"
                  width="180"
                  height="66"
                  rx="2"
                  fill="none"
                  :stroke="
                    node.highlightRole === 'upstream'
                      ? 'var(--rac-warn)'
                      : 'var(--rac-accent)'
                  "
                  stroke-width="2"
                  stroke-dasharray="4 2"
                />
                <rect
                  :x="node.x - 86"
                  :y="node.y - 29"
                  width="172"
                  height="58"
                  rx="2"
                  :fill="expandedNodeId === node.id ? 'var(--rac-panel-2)' : nodeFill(node.state)"
                  :stroke="expandedNodeId === node.id ? 'var(--rac-accent)' : nodeStroke(node)"
                  :stroke-width="
                    expandedNodeId === node.id || node.highlightRole === 'focus'
                      ? 2.2
                      : node.state === 'built' || node.state === 'building'
                        ? 1.8
                        : 1.2
                  "
                  :stroke-dasharray="node.state === 'unlocked' && expandedNodeId !== node.id ? '5 3' : undefined"
                />
                <!-- 左侧状态色条 -->
                <rect
                  :x="node.x - 86"
                  :y="node.y - 29"
                  width="4"
                  height="58"
                  rx="1"
                  :fill="nodeStroke(node)"
                />
                <!-- 建筑名称 -->
                <text
                  :x="node.x - 74"
                  :y="node.y - 7"
                  :fill="node.state === 'locked' && expandedNodeId !== node.id ? 'var(--rac-muted)' : 'var(--rac-hi)'"
                  font-size="11"
                  font-weight="bold"
                  font-family="monospace"
                >
                  {{ node.displayShortLabel }}
                </text>
                <!-- 状态副文本（放宽截断阈值） -->
                <text
                  :x="node.x - 74"
                  :y="node.y + 14"
                  :fill="nodeSubTextColor(node)"
                  font-size="11"
                  font-family="monospace"
                >
                  {{
                    node.state === 'locked' && !node.isOriginConyard
                      ? truncateText(node.hint, node.clusterItems.length > 1 ? 13 : 18)
                      : truncateText(node.statusText, node.clusterItems.length > 1 ? 13 : 18)
                  }}
                </text>
                <!-- 右上角产线/阵营/双模/座数简标 -->
                <text
                  :x="node.x + 78"
                  :y="node.y - 13"
                  text-anchor="end"
                  :fill="node.resolvedFactionColor"
                  font-size="11"
                  font-family="monospace"
                >
                  {{
                    node.builtCount > 0
                      ? `${node.dualModeCapable ? '◆' : ''}×${node.builtCount}`
                      : node.resolvedFactionBadge
                        ? `[${node.resolvedFactionBadge}]`
                        : ''
                  }}
                </text>
                <!-- 右下角可展开建筑簇胶囊角标（当该节点合并了多座世界书建筑时显示 ▸N座 / ▾N座） -->
                <g v-if="node.clusterItems.length > 1">
                  <rect
                    :x="node.x + 36"
                    :y="node.y + 7"
                    width="46"
                    height="17"
                    rx="2"
                    :fill="expandedNodeId === node.id ? 'var(--rac-accent)' : 'var(--rac-bg)'"
                    :stroke="expandedNodeId === node.id ? 'var(--rac-hi)' : 'var(--rac-accent)'"
                    stroke-width="0.9"
                  />
                  <text
                    :x="node.x + 59"
                    :y="node.y + 18"
                    text-anchor="middle"
                    :fill="expandedNodeId === node.id ? 'var(--rac-bg)' : 'var(--rac-accent)'"
                    font-size="11"
                    font-weight="bold"
                    font-family="monospace"
                  >
                    {{ expandedNodeId === node.id ? '▾' : '▸' }}{{ node.clusterItems.length }}型
                  </text>
                </g>
              </g>
            </g>
          </svg>

          <!-- ══ 蓝图节点点击就地展开抽屉（合并节点一键展开下辖全部型号） ══ -->
          <div
            v-if="expandedNode"
            class="border-t border-(--rac-accent)/60 bg-(--rac-panel) p-2.5"
            data-test="svg-cluster-expand-drawer"
            @mousedown.stop
          >
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2 font-mono">
                <span class="rounded-[2px] border border-(--rac-accent)/50 bg-(--rac-panel-2) px-1.5 py-0.5 text-[11px] font-bold text-(--rac-accent)">
                  同类型号 · {{ expandedNode.laneLabel }}
                </span>
                <span class="text-[13px] font-bold text-(--rac-hi)">
                  {{ expandedNode.displayShortLabel }}
                </span>
                <span class="text-[12px] text-(--rac-muted)">
                  （共 {{ expandedNode.clusterItems.length }} 种衍生型号 · 点击卡片查阅档案或下令建造）
                </span>
              </div>
              <div class="flex items-center gap-1.5 font-mono">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-[2px] border border-(--rac-accent)/70 bg-(--rac-panel-2) px-2 py-0.5 text-[12px] text-(--rac-accent) hover:bg-(--rac-bg)"
                  @click="onClickNode(expandedNode.matchedNames[0] ?? expandedNode.displayName ?? expandedNode.name)"
                >
                  <Icon name="doc" :size="12" /> 查阅「{{ expandedNode.displayName }}」档案
                </button>
                <button
                  type="button"
                  class="rounded-[2px] border border-(--rac-dim) bg-(--rac-panel-2) px-2 py-0.5 text-[12px] text-(--rac-muted) hover:text-(--rac-hi)"
                  data-test="close-svg-cluster-drawer"
                  @click="expandedNodeId = null"
                >
                  × 收起
                </button>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              <button
                v-for="sub in expandedNode.clusterItems"
                :key="sub.id"
                type="button"
                class="flex flex-col justify-between gap-1 rounded-[2px] border border-t-2 px-2.5 py-1.5 text-left font-mono transition-all hover:border-(--rac-accent) hover:bg-(--rac-panel-2)"
                :class="
                  sub.state === 'built'
                    ? 'border-(--rac-ok)/70 border-t-(--rac-ok) bg-(--rac-panel-2)'
                    : sub.state === 'unlocked'
                      ? 'border-(--rac-accent)/60 border-t-(--rac-accent) bg-(--rac-panel-2)'
                      : 'border-(--rac-dim)/80 border-t-(--rac-accent)/40 bg-(--rac-bg)'
                "
                :style="{
                  boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 18%, transparent)',
                }"
                :data-test="`cluster-item-${sub.name}`"
                @click="onClickNode(sub.name)"
              >
                <div class="flex items-center justify-between gap-1">
                  <span class="truncate text-[12px] font-bold text-(--rac-hi)">
                    {{ sub.name }}
                  </span>
                  <div class="flex flex-none items-center gap-1">
                    <span
                      v-if="!resolveEntryBadge(sub).isCommon"
                      class="py-0.2 rounded-[2px] px-1 text-[11px]"
                      :class="resolveEntryBadge(sub).badgeClass"
                    >
                      {{ resolveEntryBadge(sub).label }}
                    </span>
                    <span
                      class="py-0.2 rounded-[2px] px-1 text-[11px]"
                      :class="
                        sub.state === 'built'
                          ? 'bg-(--rac-panel) text-(--rac-ok)'
                          : sub.state === 'unlocked'
                            ? 'bg-(--rac-panel) text-(--rac-accent)'
                            : 'bg-(--rac-panel) text-(--rac-muted)'
                      "
                    >
                      {{ sub.statusText }}
                    </span>
                  </div>
                </div>
                <div class="flex items-center justify-between gap-1 text-[11px] text-(--rac-muted)">
                  <span class="truncate">{{ sub.prereqText }}</span>
                  <span class="flex-none text-(--rac-text)">
                    ${{ sub.cost }} · {{ sub.power <= 0 ? `发电+${Math.abs(sub.power)}` : `耗电${sub.power}` }}
                  </span>
                </div>
              </button>
            </div>
          </div>
        </div>

        <!-- ══ 底部 4 张体系能力指标卡 ══ -->
        <div class="grid flex-none shrink-0 grid-cols-2 gap-2 md:grid-cols-4" data-test="building-system-metrics">
          <div
            v-for="m in currentSystem.metrics"
            :key="m.label"
            class="ob-readout rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) px-3 py-2"
          >
            <div class="font-mono text-[12px] text-(--rac-muted)">{{ m.label }}</div>
            <div
              class="mt-0.5 font-mono text-[15px] font-bold"
              :class="
                m.tone === 'ok'
                  ? 'text-(--rac-ok)'
                  : m.tone === 'warn'
                    ? 'text-(--rac-warn)'
                    : m.tone === 'accent'
                      ? 'text-(--rac-accent)'
                      : 'text-(--rac-hi)'
              "
            >
              {{ m.value }}
            </div>
            <div v-if="m.subText" class="mt-0.5 truncate font-mono text-[11px] text-(--rac-muted)">
              {{ m.subText }}
            </div>
          </div>
        </div>

        <!-- ══ 当前体系已建建筑实况清单（支持长尾建筑兜底检索、双模切换与状态编辑） ══ -->
        <section class="flex-none shrink-0 rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-2.5">
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span class="font-mono text-[13px] font-semibold text-(--rac-hi)">
              {{ currentSystem.meta.shortLabel }} · 已部署设施清单（{{ currentSystem.builtList.length }} 类）
            </span>
            <span class="font-mono text-[12px]" :class="editMode ? 'text-(--rac-warn)' : 'text-(--rac-muted)'">
              {{
                editMode
                  ? '◆ 调度模式：可直接切换产线【生产 ⇄ 加速】、加速范围与设施【运转 ⇄ 停机】状态'
                  : '点击设施查看详情 · 开启右上角「产线与供电调度」可快速切换生产/加速模式'
              }}
            </span>
          </div>

          <div
            v-if="currentSystem.builtList.length === 0"
            class="py-3 text-center font-mono text-[12px] text-(--rac-muted)"
          >
            当前{{ scopeMode === 'global' ? '战区' : '基地' }}暂无此类设施 ·
            {{
              overview.hasOperationalConyard
                ? '可在上方蓝图中点击可建项目下达建造令'
                : '请先在当前基地展开基地车 (MCV)'
            }}
          </div>

          <div v-else class="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="fac in currentSystem.builtList"
              :key="fac.name"
              class="flex flex-col justify-between gap-1.5 rounded-[2px] border border-t-2 border-(--rac-dim)/80 border-t-(--rac-accent)/70 bg-(--rac-panel-2) px-2.5 py-1.5 font-mono transition-all hover:border-(--rac-accent)"
              :style="{
                background:
                  'linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 8%, var(--rac-panel-2)) 0%, var(--rac-panel-2) 100%)',
                boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 20%, transparent)',
              }"
            >
              <div class="flex items-center justify-between gap-2">
                <button
                  type="button"
                  class="min-w-0 flex-1 text-left"
                  @click="onClickNode(fac.name)"
                >
                  <div class="truncate text-[12px] font-semibold text-(--rac-hi)">
                    {{ fac.name }}
                    <span class="ml-1 text-[11px] text-(--rac-accent)">×{{ fac.count }}</span>
                    <span
                      v-if="fac.dualModeCapable"
                      class="py-0.2 ml-1 rounded-[2px] border border-(--rac-accent)/40 bg-(--rac-panel) px-1 text-[11px] text-(--rac-accent)"
                    >
                      可并联加速
                    </span>
                  </div>
                  <div class="truncate text-[11px] text-(--rac-muted)">
                    运转 {{ fac.runningCount }}
                    <template v-if="fac.offlineCount > 0"> · 停损 {{ fac.offlineCount }}</template>
                    <template v-if="fac.dualModeCapable">
                      · 生产{{ fac.productionModeCount }}/加速{{ fac.accelModeCount }}
                    </template>
                    <template v-if="fac.layers.length > 0"> · {{ fac.layers.join('/') }}</template>
                  </div>
                  <div class="mt-1 flex flex-wrap items-center gap-1">
                    <span
                      class="py-0.2 inline-flex items-center rounded-[2px] border px-1.5 text-[11px] font-semibold"
                      :class="resolveCoordBadge(fac).badgeClass"
                      :data-building-name="fac.name"
                      :data-ring="resolveCoordBadge(fac).ring"
                      :data-ring-label="resolveCoordBadge(fac).ringLabel"
                      :data-coord="`${resolveCoordBadge(fac).coord.x},${resolveCoordBadge(fac).coord.y}`"
                      data-test="building-coord-badge"
                    >
                      {{ resolveCoordBadge(fac).badgeText }}
                    </span>
                  </div>
                </button>
                <span
                  class="flex-none rounded-[2px] border px-1.5 py-0.5 text-[11px]"
                  :class="
                    fac.offlineCount === 0
                      ? 'border-(--rac-ok)/45 bg-(--rac-panel) text-(--rac-ok)'
                      : 'border-(--rac-warn)/55 bg-(--rac-panel) text-(--rac-warn)'
                  "
                >
                  {{ fac.offlineCount === 0 ? '运转' : '部分停损' }}
                </span>
              </div>

              <!-- FD-22：母体建筑已挂载扩建挂件 + 原位升阶 / 附着扩建快捷入口 -->
              <div
                v-if="resolveFacilityMountedAddons(fac).length || fac.upgradeOptions?.length || fac.addonOptions?.length"
                class="flex flex-col gap-1 border-t border-(--rac-dim)/50 pt-1.5 text-[11px]"
                :data-test="`facility-upgrades-${fac.name}`"
              >
                <div v-if="resolveFacilityMountedAddons(fac).length" class="flex flex-wrap items-center gap-1">
                  <span class="text-(--rac-muted)">已挂载：</span>
                  <span
                    v-for="addonName in resolveFacilityMountedAddons(fac)"
                    :key="addonName"
                    class="py-0.2 rounded-[2px] border border-(--rac-ok)/50 bg-(--rac-panel) px-1.5 text-[11px] text-(--rac-ok)"
                    data-test="mounted-addon-badge"
                  >
                    + {{ addonName }}
                  </span>
                </div>

                <div
                  v-if="fac.upgradeOptions?.length || fac.addonOptions?.some(a => !a.isMounted)"
                  class="flex flex-wrap items-center gap-1"
                >
                  <button
                    v-for="upg in fac.upgradeOptions"
                    :key="upg.name"
                    type="button"
                    class="rounded-[2px] border px-1.5 py-0.5 font-semibold transition-colors"
                    :class="
                      upg.inQueue
                        ? 'border-(--rac-warn)/80 bg-(--rac-panel) text-(--rac-warn)'
                        : upg.isUnlocked
                          ? 'border-(--rac-accent)/70 bg-(--rac-panel) text-(--rac-accent) hover:bg-(--rac-bg)'
                          : 'border-(--rac-dim) bg-(--rac-panel) text-(--rac-muted) hover:border-(--rac-accent)'
                    "
                    :data-test="`facility-upgrade-btn-${upg.name}`"
                    :title="
                      upg.standalone
                        ? `就地升级为「${upg.displayName}」· 补差价 $${upg.deltaCost}（直接新建造价 $${upg.cost}）`
                        : `原位升级为「${upg.displayName}」· 升级费用 $${upg.deltaCost}`
                    "
                    @click.stop="onClickNode(upg.name)"
                  >
                    ▲ {{ upg.inQueue ? '升级中' : '原位升级' }}：{{ upg.displayName }}（${{ upg.deltaCost }}）
                  </button>

                  <button
                    v-for="addon in (fac.addonOptions ?? []).filter(a => !a.isMounted)"
                    :key="addon.name"
                    type="button"
                    class="rounded-[2px] border px-1.5 py-0.5 font-semibold transition-colors"
                    :class="
                      addon.inQueue
                        ? 'border-(--rac-warn)/80 bg-(--rac-panel) text-(--rac-warn)'
                        : addon.isUnlocked
                          ? 'border-(--rac-ok)/70 bg-(--rac-panel) text-(--rac-ok) hover:bg-(--rac-bg)'
                          : 'border-(--rac-dim) bg-(--rac-panel) text-(--rac-muted) hover:border-(--rac-accent)'
                    "
                    :data-test="`facility-addon-btn-${addon.name}`"
                    :title="`扩建附属模块「${addon.displayName}」· 扩建费用 $${addon.cost}`"
                    @click.stop="onClickNode(addon.name)"
                  >
                    + {{ addon.inQueue ? '扩建中' : '加装模块' }}：{{ addon.displayName }}（${{ addon.cost }}）
                  </button>
                </div>
              </div>

              <!-- 可编辑模式（或双模建筑快捷切换栏 / 多实例逐座坐标与挂件展开） -->
              <div
                v-if="editMode || fac.dualModeCapable || fac.instances.length > 1"
                class="flex flex-col gap-1 border-t border-(--rac-dim)/50 pt-1.5"
              >
                <div
                  v-for="(inst, iIdx) in fac.instances"
                  :key="`${inst.baseIndex}-${inst.buildingIndex}`"
                  class="flex flex-wrap items-center justify-between gap-1 text-[11px]"
                >
                  <div class="flex flex-wrap items-center gap-1">
                    <span class="truncate text-(--rac-muted)">
                      {{ scopeMode === 'global' ? `${inst.baseName}` : `#${inst.instanceOrdinal ?? iIdx + 1}` }}
                      <span class="ml-0.5 text-[11px] text-(--rac-muted)">[{{ inst.layer || '地面' }}]</span>
                      <span v-if="inst.dualModeCapable" class="ml-1 text-(--rac-hi)">
                        [{{ inst.mode === '加速' ? '加速' : '生产' }}]
                      </span>
                    </span>
                    <span
                      v-if="fac.instances.length > 1 || editMode"
                      class="py-0.2 inline-flex items-center rounded-[2px] border px-1 text-[11px] font-semibold"
                      :class="resolveInstanceCoordBadge(inst, iIdx).badgeClass"
                      :data-building-name="inst.name"
                      :data-ring="resolveInstanceCoordBadge(inst, iIdx).ring"
                      data-test="facility-instance-coord-badge"
                    >
                      {{ resolveInstanceCoordBadge(inst, iIdx).badgeText }}
                    </span>
                    <span
                      v-for="addonName in resolveInstanceAddons(inst)"
                      :key="addonName"
                      class="py-0.2 rounded-[2px] border border-(--rac-ok)/50 bg-(--rac-panel) px-1 text-[11px] text-(--rac-ok)"
                    >
                      + {{ addonName }}
                    </span>
                  </div>

                  <div class="flex flex-wrap items-center gap-1">
                    <!-- 生产 ⇄ 加速 双模切换按钮 -->
                    <button
                      v-if="inst.dualModeCapable"
                      type="button"
                      class="rounded-[2px] border px-1.5 py-0.5 font-semibold transition-colors"
                      :class="
                        inst.mode === '加速'
                          ? 'border-(--rac-warn)/80 bg-(--rac-panel) text-(--rac-warn) hover:bg-(--rac-bg)'
                          : 'border-(--rac-accent)/60 bg-(--rac-panel) text-(--rac-accent) hover:bg-(--rac-bg)'
                      "
                      :data-test="`toggle-building-mode-${inst.baseIndex}-${inst.buildingIndex}`"
                      @click.stop="toggleInstanceMode(inst)"
                    >
                      {{ inst.mode === '加速' ? '切回生产' : '切为加速' }}
                    </button>

                    <!-- 加速覆盖范围切换（全局 ⇄ 本基地） -->
                    <button
                      v-if="inst.dualModeCapable && inst.mode === '加速' && editMode"
                      type="button"
                      class="rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) px-1.5 py-0.5 text-(--rac-muted) hover:border-(--rac-accent) hover:text-(--rac-hi)"
                      :data-test="`toggle-building-scope-${inst.baseIndex}-${inst.buildingIndex}`"
                      @click.stop="toggleInstanceScope(inst)"
                    >
                      {{ inst.accelScope === 'base' ? '仅本基地' : '战区全局' }}
                    </button>

                    <!-- 运转 ⇄ 停机 状态切换（编辑模式下开放） -->
                    <button
                      v-if="editMode"
                      type="button"
                      class="rounded-[2px] border px-1.5 py-0.5 transition-colors"
                      :class="
                        inst.state === '运转'
                          ? 'border-(--rac-ok)/50 bg-(--rac-panel) text-(--rac-ok) hover:bg-(--rac-bg)'
                          : 'border-(--rac-warn)/60 bg-(--rac-panel) text-(--rac-warn) hover:bg-(--rac-bg)'
                      "
                      :data-test="`toggle-building-state-${inst.baseIndex}-${inst.buildingIndex}`"
                      @click.stop="toggleInstanceState(inst)"
                    >
                      {{ inst.state === '运转' ? '拉闸停机' : '恢复运转' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ══ 本体系全部可建型号图鉴与前置总表（覆盖全部世界书建筑，支持盟军/苏联/尤里/动态阵营徽章） ══ -->
        <section
          v-if="groupedCatalogEntries.length > 0"
          class="flex-none shrink-0 rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-2.5"
          data-test="building-system-full-catalog"
        >
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span class="inline-flex items-center gap-1 font-mono text-[13px] font-semibold text-(--rac-hi)">
              <Icon name="book" :size="13" /> {{ currentSystem.meta.shortLabel }} · 全部可建型号图鉴（共 {{ currentSystem.catalogEntries.length }} 种）
            </span>
            <span class="font-mono text-[12px] text-(--rac-muted)">
              涵盖通用与各阵营全部设施型号 · 点击卡片查阅档案或下令建造
            </span>
          </div>

          <div class="flex flex-col gap-2.5">
            <div v-for="grp in groupedCatalogEntries" :key="grp.groupName">
              <div class="mb-1 flex items-center gap-1.5 font-mono text-[12px] font-bold text-(--rac-accent)">
                <span>▸ {{ grp.groupName }}</span>
                <span class="text-[11px] font-normal text-(--rac-muted)">（{{ grp.items.length }} 座）</span>
              </div>
              <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                <button
                  v-for="entry in grp.items"
                  :key="entry.id"
                  type="button"
                  class="flex flex-col justify-between gap-1 rounded-[2px] border px-2 py-1.5 text-left font-mono transition-colors hover:border-(--rac-accent)"
                  :class="
                    entry.state === 'built'
                      ? 'border-(--rac-ok)/60 bg-(--rac-panel-2)'
                      : entry.state === 'unlocked'
                        ? 'border-(--rac-accent)/50 bg-(--rac-panel-2)'
                        : 'border-(--rac-dim)/60 bg-(--rac-bg)'
                  "
                  :data-test="`catalog-entry-${entry.name}`"
                  @click="onClickNode(entry.name)"
                >
                  <div class="flex items-center justify-between gap-1">
                    <span class="truncate text-[12px] font-semibold text-(--rac-hi)">
                      {{ entry.name }}
                    </span>
                    <div class="flex flex-none items-center gap-1">
                      <span
                        v-if="!resolveEntryBadge(entry).isCommon"
                        class="py-0.2 rounded-[2px] px-1 text-[11px]"
                        :class="resolveEntryBadge(entry).badgeClass"
                        :data-faction-badge="resolveEntryBadge(entry).factionId"
                      >
                        {{ resolveEntryBadge(entry).label }}
                      </span>
                      <span
                        class="py-0.2 rounded-[2px] px-1 text-[11px]"
                        :class="
                          entry.state === 'built'
                            ? 'bg-(--rac-panel) text-(--rac-ok)'
                            : entry.state === 'unlocked'
                              ? 'bg-(--rac-panel) text-(--rac-accent)'
                              : 'bg-(--rac-panel) text-(--rac-muted)'
                        "
                      >
                        {{ entry.statusText }}
                      </span>
                    </div>
                  </div>
                  <div class="flex items-center justify-between gap-1 text-[11px] text-(--rac-muted)">
                    <span class="truncate">{{ entry.prereqText }}</span>
                    <span class="flex-none">${{ entry.cost }}</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </section>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref } from 'vue';
import toastr from 'toastr';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import type { EffectiveCatalog } from '../../红警指挥系统/core/catalogEffective';
import type { StatData } from '../../红警指挥系统/core/schema';
import { useDataStore } from '../../红警指挥系统/composables/store';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import { openLookup } from '../../红警指挥系统/composables/useDetail';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { resolveBuildingRelativeCoord } from '../../红警指挥系统/engines/buildingCoordEngine';
import { fillHostSendInput } from '../../红警指挥系统/worldbook/hostSendInput';
import {
  BUILDING_SYSTEM_TABS,
  buildBuildingOverviewModel,
  classifyBuildingSystem,
  inferConyardFaction,
  isDualModeBuildingName,
  type BuildingBlueprintNode,
  type BuildingFactionFilter,
  type BuildingScopeMode,
  type BuildingSystemId,
  type BuiltBuildingInstanceRef,
} from '../models/buildingSystemModel';
import { updateFloorVars } from '../host/floorVarWrite';
import { useTacticalModalMotion } from '../../红警指挥系统/ui/motion/useGsapMotion';
import {
  computeBuildingModalDynamicStyle,
  computeInteractiveBlueprintLayout,
  coordRingBadgeClass,
  cycleBuildingModalSizeMode,
  deployMcvOrder,
  groupSystemCatalogEntries,
  nodeFill,
  nodeStroke,
  nodeSubTextColor,
  resolveAvailableFactionPills,
  resolveBlueprintNodeAction,
  resolveBuildingEntryFactionBadge,
  resolveBuildingModalSizeLabel,
  resolveFacilityCoordBadge,
  resolveSingleBuildingPowerPair,
  toggleBuildingInstanceMode,
  toggleBuildingInstanceScope,
  toggleBuildingInstanceState,
  truncateText,
  type BuildingModalSizeMode,
  type BuildingTopologyViewMode,
} from './modalBuildingsHelpers';

const props = withDefaults(defineProps<{ snapshot?: StatData | null; activeBaseIndex?: number }>(), {
  snapshot: null,
  activeBaseIndex: 0,
});
defineEmits<{ (e: 'close'): void; (e: 'select-base', index: number): void }>();

const backdropRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
useTacticalModalMotion(panelRef, backdropRef);

const catalog = useCatalogStore();
const dataStore = useDataStore();
const floating = useFloatingStore();
const scopeMode = ref<BuildingScopeMode>('base');
const primaryViewMode = ref<'split' | 'live' | 'blueprint'>('split');
const selectedLayerFilter = ref<string>('all');
const selectedLiveBlipKey = ref<string | null>(null);
const factionFilter = ref<BuildingFactionFilter>('all');
const activeSystemId = ref<BuildingSystemId>('military');
const expandedNodeId = ref<string | null>(null);
const hoveredNodeId = ref<string | null>(null);
const editMode = ref(false);
const editTick = ref(0);

// 弹窗动态窗口尺寸适配（wide 90% ⇄ full 96% ⇄ compact 标准 1080）
const sizeMode = ref<BuildingModalSizeMode>('wide');
const viewportWidth = ref<number>(1280);
const viewportHeight = ref<number>(820);

function readHostViewport(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 1280, h: 820 };
  let w = window.innerWidth || 1280;
  let h = window.innerHeight || 820;
  try {
    if (window.parent && window.parent !== window) {
      const pw = window.parent.innerWidth;
      const ph = window.parent.innerHeight;
      if (typeof pw === 'number' && pw > 320) w = Math.max(w, pw);
      if (typeof ph === 'number' && ph > 320) h = Math.max(h, ph);
    }
  } catch {
    /* ignore cross-origin parent window */
  }
  return { w, h };
}

function syncViewportSize(): void {
  const { w, h } = readHostViewport();
  viewportWidth.value = w;
  viewportHeight.value = h;
}

function onCycleSizeMode(): void {
  sizeMode.value = cycleBuildingModalSizeMode(sizeMode.value);
}

const sizeModeLabel = computed(() => resolveBuildingModalSizeLabel(sizeMode.value));
const modalDynamicStyle = computed(() => ({
  ...computeBuildingModalDynamicStyle(sizeMode.value, viewportWidth.value, viewportHeight.value),
  borderTop: '2px solid var(--rac-accent)',
  boxShadow:
    '0 12px 42px rgba(0, 0, 0, 0.85), 0 0 0 1px color-mix(in srgb, var(--rac-accent) 22%, transparent), inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 28%, transparent)',
}));

if (getCurrentInstance()) {
  onMounted(() => {
    syncViewportSize();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', syncViewportSize, { passive: true });
      try {
        if (window.parent && window.parent !== window && typeof window.parent.addEventListener === 'function') {
          window.parent.addEventListener('resize', syncViewportSize, { passive: true });
        }
      } catch {
        /* ignore cross-origin */
      }
    }
  });

  onBeforeUnmount(() => {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', syncViewportSize);
      try {
        if (window.parent && window.parent !== window && typeof window.parent.removeEventListener === 'function') {
          window.parent.removeEventListener('resize', syncViewportSize);
        }
      } catch {
        /* ignore cross-origin */
      }
    }
  });
}

// 交互式蓝图拓扑控制状态（默认 expanded 全部型号展开 ⇄ cluster 同类归并、默认开启加高画布、阵营聚焦、平移与缩放）
const topologyViewMode = ref<BuildingTopologyViewMode>('expanded');
const hideOtherFactionNodes = ref(false);
const canvasTallMode = ref(true);
const canvasZoom = ref(1);
const canvasPanX = ref(0);
const canvasPanY = ref(0);
const isDraggingCanvas = ref(false);
const dragStartClientX = ref(0);
const dragStartClientY = ref(0);

function toggleTopologyViewMode(): void {
  topologyViewMode.value = topologyViewMode.value === 'cluster' ? 'expanded' : 'cluster';
  expandedNodeId.value = null;
}

function zoomInCanvas(): void {
  canvasZoom.value = Math.min(2.2, Number((canvasZoom.value + 0.15).toFixed(2)));
}

function zoomOutCanvas(): void {
  canvasZoom.value = Math.max(0.55, Number((canvasZoom.value - 0.15).toFixed(2)));
}

function resetCanvasView(): void {
  canvasZoom.value = 1;
  canvasPanX.value = 0;
  canvasPanY.value = 0;
}

function onCanvasWheel(e: WheelEvent): void {
  const delta = e.deltaY < 0 ? 0.1 : -0.1;
  canvasZoom.value = Math.max(0.55, Math.min(2.2, Number((canvasZoom.value + delta).toFixed(2))));
}

function onCanvasMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return;
  isDraggingCanvas.value = true;
  dragStartClientX.value = e.clientX - canvasPanX.value;
  dragStartClientY.value = e.clientY - canvasPanY.value;
}

function onCanvasMouseMove(e: MouseEvent): void {
  if (!isDraggingCanvas.value) return;
  canvasPanX.value = Math.round(e.clientX - dragStartClientX.value);
  canvasPanY.value = Math.round(e.clientY - dragStartClientY.value);
}

function onCanvasMouseUp(): void {
  isDraggingCanvas.value = false;
}

const canvasTransformAttr = computed(() => {
  if (canvasPanX.value === 0 && canvasPanY.value === 0 && canvasZoom.value === 1) {
    return undefined;
  }
  return `translate(${canvasPanX.value} ${canvasPanY.value}) scale(${canvasZoom.value})`;
});

const bases = computed(() => props.snapshot?.bases ?? []);

const activeBaseSectors = computed(() => {
  const list = bases.value;
  if (!list.length) return [];
  const idx = Math.max(0, Math.min(props.activeBaseIndex ?? 0, Math.max(0, list.length - 1)));
  const activeBase = list[idx] as (typeof list[number] & { sectors?: unknown[] }) | undefined;
  const rawSectors = activeBase?.sectors;
  if (!Array.isArray(rawSectors) || rawSectors.length === 0) return [];
  const result: Array<{ name: string; layer: string; status: string; desc: string; titleText: string }> = [];
  for (const item of rawSectors) {
    if (typeof item === 'string') {
      const name = item.trim();
      if (!name) continue;
      result.push({ name, layer: '', status: '正常', desc: '', titleText: `${name} · 正常` });
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const name = String(rec.name ?? '').trim();
      if (!name) continue;
      const layer = String(rec.layer ?? '').trim();
      const status = String(rec.status ?? '正常').trim() || '正常';
      const desc = String(rec.desc ?? '').trim();
      const titleText = [name, layer, status, desc].filter(Boolean).join(' · ');
      result.push({ name, layer, status, desc, titleText });
    }
  }
  return result;
});

const activeBaseTimezoneWeather = computed(() => {
  const list = bases.value;
  const idx = Math.max(0, Math.min(props.activeBaseIndex ?? 0, Math.max(0, list.length - 1)));
  const activeBase = list[idx];
  const primaryTz = typeof list[0]?.tz_offset === 'number' && Number.isFinite(list[0].tz_offset) ? list[0].tz_offset : 8;
  const currentTz =
    typeof activeBase?.tz_offset === 'number' && Number.isFinite(activeBase.tz_offset)
      ? activeBase.tz_offset
      : primaryTz;
  const deltaHours = idx === 0 ? 0 : currentTz - primaryTz;

  const rawClock = (
    props.snapshot?.clock?.time ??
    (props.snapshot?.meta as { clock?: string })?.clock ??
    '08:00'
  ).trim();
  const clockMatch = /^(\d{1,2}):(\d{2})/.exec(rawClock);
  const baseMinutes = clockMatch
    ? (Number(clockMatch[1]) % 24) * 60 + (Number(clockMatch[2]) % 60)
    : 8 * 60;
  const localMinutes = ((baseMinutes + Math.round(deltaHours * 60)) % 1440 + 1440) % 1440;
  const hh = Math.floor(localMinutes / 60);
  const mm = localMinutes % 60;
  const hhStr = String(hh).padStart(2, '0');
  const mmStr = String(mm).padStart(2, '0');
  const dayNightIcon = hh >= 6 && hh < 18 ? '昼' : '夜';
  const relLabel =
    idx === 0 || deltaHours === 0
      ? '标准时'
      : `标准${deltaHours > 0 ? `+${deltaHours}` : `${deltaHours}`}h`;

  const weatherRaw = (activeBase?.weather || props.snapshot?.meta?.weather || '晴朗').trim();

  return {
    localTimeBadge: `${dayNightIcon} ${hhStr}:${mmStr} (${relLabel})`,
    weatherBadge: weatherRaw,
  };
});

const effectiveCat = computed<Partial<EffectiveCatalog>>(
  () =>
    (catalog as unknown as { effectiveCatalog?: Partial<EffectiveCatalog> }).effectiveCatalog ??
    (catalog as unknown as Partial<EffectiveCatalog>),
);

const overview = computed(() => {
  void editTick.value;
  return buildBuildingOverviewModel(props.snapshot, effectiveCat.value, {
    scope: scopeMode.value,
    activeBaseIndex: props.activeBaseIndex,
    factionFilter: factionFilter.value,
  });
});

const availableFactionPills = computed(() =>
  resolveAvailableFactionPills(overview.value, props.snapshot, effectiveCat.value),
);

const currentSystem = computed(() => overview.value.systems[activeSystemId.value]);

const activeFocusNodeId = computed(() => hoveredNodeId.value ?? expandedNodeId.value ?? null);

const blueprintLayout = computed(() =>
  computeInteractiveBlueprintLayout(currentSystem.value, {
    viewMode: topologyViewMode.value,
    factionFilter: factionFilter.value as string,
    hideOtherFactions: hideOtherFactionNodes.value,
    focusNodeId: activeFocusNodeId.value,
    availablePills: availableFactionPills.value,
  }),
);

const renderedEdges = computed(() => blueprintLayout.value.edges);

const expandedNode = computed<BuildingBlueprintNode | null>(() =>
  expandedNodeId.value
    ? (blueprintLayout.value.nodes.find(n => n.id === expandedNodeId.value) ??
      currentSystem.value.nodes.find(n => n.id === expandedNodeId.value) ??
      null)
    : null,
);

const groupedCatalogEntries = computed(() =>
  groupSystemCatalogEntries(currentSystem.value.catalogEntries ?? []),
);

const resolveEntryBadge = (entry: { name?: string; faction?: string }) =>
  resolveBuildingEntryFactionBadge(entry, availableFactionPills.value);

const resolveCoordBadge = (fac: { name: string; instances?: readonly BuiltBuildingInstanceRef[] }) =>
  resolveFacilityCoordBadge(fac, props.snapshot);

function resolveInstanceCoordBadge(inst: BuiltBuildingInstanceRef, fallbackIdx = 0) {
  const rawBld =
    inst.buildingIndex >= 0
      ? (props.snapshot?.bases?.[inst.baseIndex]?.buildings?.[inst.buildingIndex] as
          | { name?: string; coord?: { x: number; y: number }; bearing?: string }
          | undefined)
      : undefined;
  const instExt = inst as BuiltBuildingInstanceRef & {
    coord?: { x: number; y: number };
    bearing?: string;
  };
  const spatial = resolveBuildingRelativeCoord(
    {
      name: rawBld?.name || inst.name,
      coord: rawBld?.coord ?? instExt.coord,
      bearing: rawBld?.bearing ?? instExt.bearing,
    },
    inst.buildingIndex >= 0 ? inst.buildingIndex : fallbackIdx,
    inst.baseId || 'base-0',
  );
  const badgeText =
    spatial.ring === 'core'
      ? `◆ ${spatial.bearingLabel}`
      : `◆ ${spatial.ringLabel} · ${spatial.bearingLabel}`;
  return {
    ...spatial,
    badgeText,
    badgeClass: coordRingBadgeClass(spatial.ring),
  };
}

function resolveInstanceAddons(inst: BuiltBuildingInstanceRef): string[] {
  const instExt = inst as BuiltBuildingInstanceRef & { addons?: string[] };
  if (Array.isArray(instExt.addons) && instExt.addons.length > 0) {
    return instExt.addons;
  }
  const rawBld =
    inst.buildingIndex >= 0
      ? (props.snapshot?.bases?.[inst.baseIndex]?.buildings?.[inst.buildingIndex] as
          | { addons?: string[] }
          | undefined)
      : undefined;
  return Array.isArray(rawBld?.addons) ? rawBld.addons.filter(Boolean) : [];
}

function resolveFacilityMountedAddons(fac: {
  mountedAddons?: string[];
  instances?: readonly BuiltBuildingInstanceRef[];
}): string[] {
  const set = new Set<string>(fac.mountedAddons ?? []);
  for (const inst of fac.instances ?? []) {
    for (const ad of resolveInstanceAddons(inst)) {
      if (ad) set.add(ad);
    }
  }
  return Array.from(set);
}

function resolveBuildingPowerPair(name: string, mode?: string): { powerGen: number; powerUse: number } {
  return resolveSingleBuildingPowerPair(name, effectiveCat.value, mode);
}
interface LiveExtendedInstance extends BuiltBuildingInstanceRef {
  instanceOrdinal: number;
  coord: { x: number; y: number };
  ring: 'core' | 'inner' | 'mid' | 'outer';
  ringLabel: '核心' | '内环' | '中环' | '外环';
  bearingLabel: string;
  progress?: number;
  eta?: string;
  addons: string[];
  powerGen: number;
  powerUse: number;
}

const liveSandbox = computed(() => {
  void editTick.value;
  const list = bases.value;
  const activeIdx = Math.max(0, Math.min(props.activeBaseIndex ?? 0, Math.max(0, list.length - 1)));
  const targetBasesWithIndex =
    scopeMode.value === 'global'
      ? list
          .map((base, baseIndex) => ({ base, baseIndex }))
          .filter(x => x.base.status !== '失守' && x.base.status !== '废弃')
      : list[activeIdx]
        ? [{ base: list[activeIdx], baseIndex: activeIdx }]
        : [];

  const conyardHubs: Array<{
    name: string;
    faction: string;
    factionLabel: string;
    state: string;
    mode: '生产' | '加速';
    layer: string;
    powerGen: number;
  }> = [];
  const allInstances: LiveExtendedInstance[] = [];
  const underConstructionInstances: LiveExtendedInstance[] = [];
  const layerSet = new Set<string>();

  for (const { base, baseIndex } of targetBasesWithIndex) {
    const ordMap = new Map<string, number>();
    const bList = base.buildings ?? [];
    for (let buildingIndex = 0; buildingIndex < bList.length; buildingIndex += 1) {
      const b = bList[buildingIndex];
      if (!b) continue;
      const ord = (ordMap.get(b.name) ?? 0) + 1;
      ordMap.set(b.name, ord);
      const spatial = resolveBuildingRelativeCoord(
        { name: b.name, coord: b.coord, bearing: b.bearing },
        buildingIndex,
        base.id || base.name,
      );
      const { powerGen, powerUse } = resolveBuildingPowerPair(b.name);
      const bRec = b as Record<string, unknown>;
      const addons = Array.isArray(bRec.addons) ? bRec.addons.map(String).filter(Boolean) : [];
      const layer = String(b.layer || '地面').trim() || '地面';
      layerSet.add(layer);

      const inst: LiveExtendedInstance = {
        baseIndex,
        baseId: base.id || base.name,
        baseName: base.name,
        buildingIndex,
        name: b.name,
        instanceOrdinal: ord,
        state: (b.state as BuiltBuildingInstanceRef['state']) || '运转',
        mode: b.mode === '加速' ? '加速' : '生产',
        accelScope: b.accel_scope === 'base' ? 'base' : 'global',
        layer,
        dualModeCapable: isDualModeBuildingName(b.name),
        coord: spatial.coord,
        ring: spatial.ring,
        ringLabel: spatial.ringLabel,
        bearingLabel: spatial.bearingLabel,
        progress: typeof b.progress === 'number' ? b.progress : undefined,
        eta: typeof bRec.eta === 'string' ? bRec.eta : undefined,
        addons,
        powerGen,
        powerUse,
      };
      allInstances.push(inst);
      if (inst.state === '建造中') {
        underConstructionInstances.push(inst);
      }
      if (/建造厂|基地车|MCV|前沿工地|作战前哨站|指挥中枢|Sputnik/i.test(b.name)) {
        const fac = inferConyardFaction(b.name);
        const factionLabel =
          fac === 'allied' ? '盟军' : fac === 'soviet' ? '苏联' : fac === 'yuri' ? '尤里' : '通用';
        conyardHubs.push({
          name: b.name,
          faction: fac,
          factionLabel,
          state: inst.state,
          mode: inst.mode,
          layer,
          powerGen,
        });
      }
    }
  }
  // 补充 queues 中尚未落入 base.buildings 的在途建造项
  const targetBaseIds = new Set(targetBasesWithIndex.map(x => x.base.id));
  const targetBaseNames = new Set(targetBasesWithIndex.map(x => x.base.name));
  const rawQueues = props.snapshot?.queues ?? [];
  rawQueues.forEach((q, qIdx) => {
    if (q.type !== '建造') return;
    if (q.status !== 'active' && q.status !== 'queued' && q.status !== 'settling') return;
    if (scopeMode.value !== 'global' && q.base && !targetBaseIds.has(q.base) && !targetBaseNames.has(q.base)) return;
    const alreadyInBuildings = allInstances.some(i => i.name === q.item && i.state === '建造中');
    if (alreadyInBuildings) return;
    const sameNameCount = allInstances.filter(i => i.name === q.item).length;
    const qRec = q as Record<string, unknown>;
    const qLayer = String(qRec.layer || '地面').trim() || '地面';
    layerSet.add(qLayer);
    const spatial = resolveBuildingRelativeCoord(
      {
        name: q.item,
        coord: qRec.coord as { x: number; y: number } | undefined,
        bearing: typeof qRec.bearing === 'string' ? qRec.bearing : undefined,
      },
      allInstances.length + qIdx,
      q.base || 'base-0',
    );
    const { powerGen, powerUse } = resolveBuildingPowerPair(q.item);
    const qInst: LiveExtendedInstance = {
      baseIndex: activeIdx,
      baseId: q.base || 'base-0',
      baseName: q.base || list[activeIdx]?.name || '当前基地',
      buildingIndex: -1 - qIdx,
      name: q.item,
      instanceOrdinal: sameNameCount + 1,
      state: '建造中',
      mode: '生产',
      accelScope: 'base',
      layer: qLayer,
      dualModeCapable: isDualModeBuildingName(q.item),
      coord: spatial.coord,
      ring: spatial.ring,
      ringLabel: spatial.ringLabel,
      bearingLabel: spatial.bearingLabel,
      progress: typeof q.progress === 'number' ? q.progress : 0,
      eta: typeof qRec.eta === 'string' ? qRec.eta : undefined,
      addons: [],
      powerGen,
      powerUse,
    };
    allInstances.push(qInst);
    underConstructionInstances.push(qInst);
  });

  const ringCounts = { core: 0, inner: 0, mid: 0, outer: 0 };
  const blips = allInstances.map(inst => {
    ringCounts[inst.ring] += 1;
    const leftPct = Math.max(6, Math.min(94, Math.round((50 + inst.coord.x * 4.2) * 10) / 10));
    const topPct = Math.max(6, Math.min(94, Math.round((50 - inst.coord.y * 4.2) * 10) / 10));
    const color =
      inst.state === '运转'
        ? 'var(--rac-ok)'
        : inst.state === '建造中'
          ? 'var(--rac-warn)'
          : inst.state === '受损'
            ? 'var(--rac-alert)'
            : 'var(--rac-muted)';
    return {
      key: `${inst.baseIndex}-${inst.buildingIndex}-${inst.name}-${inst.instanceOrdinal}`,
      instance: inst,
      system: classifyBuildingSystem({ name: inst.name }),
      leftPct,
      topPct,
      color,
      ring: inst.ring,
      ringLabel: inst.ringLabel,
      bearingLabel: inst.bearingLabel,
      titleText: `#${inst.instanceOrdinal} ${inst.name} [${inst.layer}] · ${inst.ringLabel} ${inst.bearingLabel} · ${inst.state}`,
    };
  });

  const sectors = activeBaseSectors.value.map(sec => {
    const lyr = sec.layer || '地面防区';
    if (sec.layer) layerSet.add(sec.layer);
    const statusTone: 'ok' | 'warn' | 'danger' | 'accent' = /受损|破坏|瘫痪|危急/.test(sec.status)
      ? 'danger'
      : /警戒|告警|交战/.test(sec.status)
        ? 'warn'
        : /施工|建设|扩建|改造/.test(sec.status)
          ? 'accent'
          : 'ok';
    const coLocatedBuildings = allInstances
      .filter(i => (sec.layer ? i.layer === sec.layer : i.layer === '地面' || i.layer === '地表层'))
      .map(i => (i.instanceOrdinal > 1 ? `${i.name} #${i.instanceOrdinal}` : i.name));
    return {
      name: sec.name,
      layer: lyr,
      status: sec.status,
      statusTone,
      desc: sec.desc || '防区工事运转正常',
      coLocatedBuildings,
    };
  });

  const generators = allInstances
    .filter(i => i.powerGen > 0)
    .map(i => ({
      key: `gen-${i.baseIndex}-${i.buildingIndex}-${i.instanceOrdinal}`,
      name: i.name,
      instanceLabel: `${i.name} #${i.instanceOrdinal}`,
      baseName: i.baseName,
      layer: i.layer,
      state: i.state,
      gen: i.powerGen,
      use: 0,
      addons: i.addons,
    }));
  const consumers = allInstances
    .filter(i => i.powerUse > 0)
    .map(i => ({
      key: `use-${i.baseIndex}-${i.buildingIndex}-${i.instanceOrdinal}`,
      name: i.name,
      instanceLabel: `${i.name} #${i.instanceOrdinal}`,
      baseName: i.baseName,
      layer: i.layer,
      state: i.state,
      gen: 0,
      use: i.powerUse,
      addons: i.addons,
    }));
  const totalCatalogGen = generators
    .filter(g => g.state !== '建造中' && g.state !== '停机')
    .reduce((s, g) => s + g.gen, 0);
  const totalCatalogUse = consumers
    .filter(c => c.state !== '建造中' && c.state !== '停机')
    .reduce((s, c) => s + c.use, 0);
  const rawGen = overview.value.powerSummary.gen;
  const rawUse = overview.value.powerSummary.use;
  const reportedGen = rawGen > 0 ? rawGen : totalCatalogGen;
  const reportedUse = rawUse > 0 ? rawUse : totalCatalogUse;

  return {
    conyardHubs,
    blips,
    ringCounts,
    availableLayers: Array.from(layerSet),
    sectors,
    powerLedger: {
      generators,
      consumers,
      totalCatalogGen,
      totalCatalogUse,
      reportedGen,
      reportedUse,
      net: reportedGen - reportedUse,
    },
    allInstances,
    underConstructionInstances,
  };
});

const filteredLiveBlips = computed(() =>
  selectedLayerFilter.value === 'all'
    ? liveSandbox.value.blips
    : liveSandbox.value.blips.filter(b => b.instance.layer === selectedLayerFilter.value),
);

const filteredLiveInstances = computed(() =>
  selectedLayerFilter.value === 'all'
    ? liveSandbox.value.allInstances
    : liveSandbox.value.allInstances.filter(i => i.layer === selectedLayerFilter.value),
);

const filteredLiveSectors = computed(() =>
  selectedLayerFilter.value === 'all'
    ? liveSandbox.value.sectors
    : liveSandbox.value.sectors.filter(s => s.layer === selectedLayerFilter.value),
);

const selectedLiveBlip = computed(
  () =>
    filteredLiveBlips.value.find(b => b.key === selectedLiveBlipKey.value) ??
    filteredLiveBlips.value[0] ??
    null,
);

function onTriggerSectorOrder(
  sector: { name: string; layer?: string; status?: string } | undefined,
  action: 'reinforce' | 'repair' | 'create',
): void {
  const baseName = bases.value[props.activeBaseIndex ?? 0]?.name || '当前基地';
  let orderText = '';
  if (action === 'create' || !sector) {
    orderText = `【指挥官战术指令】在「${baseName}」规划开辟新空间防区与环境工程（请参谋部结合当前基地地形提交防区改造方案）`;
  } else if (action === 'repair') {
    orderText = `【指挥官战术指令】紧急抢修受损防区工程：${sector.name} 基地: ${baseName}`;
  } else {
    const lyr = sector.layer && sector.layer !== '默认防区' && sector.layer !== '地面防区' ? `（层级: ${sector.layer}）` : '';
    orderText = `【指挥官战术指令】加固并扩建基地防区：${sector.name}${lyr} 基地: ${baseName}`;
  }
  const res = fillHostSendInput(orderText);
  if (res.ok) {
    toastr.success(`已向聊天输入框装填防区工程指令：${sector ? sector.name : '新辟防区'}`);
  }
}

const onClickNode = (buildingName: string) => openLookup(buildingName, props.snapshot?.codex ?? []);
const onDeployMcvOrder = () => deployMcvOrder(bases.value[props.activeBaseIndex]?.name || '当前基地');

function onClickBlueprintNode(node: BuildingBlueprintNode) {
  const act = resolveBlueprintNodeAction(node, expandedNodeId.value);
  if (act.kind === 'deploy_mcv') return onDeployMcvOrder();
  expandedNodeId.value = act.nextExpandedNodeId;
  if (act.lookupName) openLookup(act.lookupName, props.snapshot?.codex ?? []);
}

const mutateCtx = () => ({
  snapshot: props.snapshot,
  dataStore,
  floating,
  updateFloorVars,
  catalog: effectiveCat.value,
  onTick: () => {
    editTick.value += 1;
  },
});

const toggleInstanceMode = (inst: BuiltBuildingInstanceRef) => toggleBuildingInstanceMode(inst, mutateCtx());
const toggleInstanceScope = (inst: BuiltBuildingInstanceRef) => toggleBuildingInstanceScope(inst, mutateCtx());
const toggleInstanceState = (inst: BuiltBuildingInstanceRef) => toggleBuildingInstanceState(inst, mutateCtx());
</script>
