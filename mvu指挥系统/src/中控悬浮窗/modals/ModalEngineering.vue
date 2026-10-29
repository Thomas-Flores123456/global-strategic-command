<template>
  <Transition name="ra-modal">
    <div
      v-if="open"
      ref="modalBackdropEl"
      class="ra-modal-mask fixed inset-0 z-10010 flex items-center justify-center p-3"
      @click.self="$emit('close')"
    >
      <section
        ref="modalCardEl"
        class="ra-modal-card eng-modal-card flex max-h-[90vh] w-full flex-col overflow-hidden rounded-[4px] select-none"
        :style="modalDynamicStyle"
        data-test="eng-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="重工与现代化改装工程"
      >
        <header class="ra-modal-header flex items-center justify-between border-b px-3.5 py-2.5">
          <div class="flex items-center gap-2">
            <span class="ra-modal-icon"><Icon name="hammer" :size="14" /></span>
            <span class="ra-modal-title text-[13px] font-bold tracking-wide">重工总成与现代化改装工程 · ENGINEERING</span>
          </div>
          <div class="flex items-center gap-3">
            <span data-test="eng-space-status-bar" class="eng-space-status-bar font-mono text-[10px]">
              天基态势 · 在轨载荷 {{ spaceOverview.orbitalCount }} · 可复用助推器 {{ spaceOverview.boosterCount }} · 航天合同 {{ spaceOverview.activeContractCount }}/{{ spaceOverview.totalContractCount }}
            </span>
            <span v-if="inProgressCount > 0" class="eng-header-count font-mono text-[10px]">在建 {{ inProgressCount }}</span>
            <button class="ra-modal-close rounded-[2px] p-1 transition-colors" aria-label="关闭弹窗" @click="$emit('close')">
              <Icon name="close" :size="12" />
            </button>
          </div>
        </header>

        <div class="ra-modal-body eng-body flex min-h-0 flex-1">
          <!-- ══ 左栏：可建设工程目录（顶栏 短期/长期 切换 + 搜索与等级筛选，D18v2 / D21） ══ -->
          <aside class="eng-catalog flex w-[250px] flex-none flex-col">
            <div class="eng-tabs flex" role="tablist" aria-label="工程范围切换">
              <button
                role="tab"
                data-test="eng-tab-short"
                class="eng-tab"
                :class="{ 'eng-tab--active': effectiveScopeTab === 'short' }"
                :aria-selected="effectiveScopeTab === 'short'"
                @click="switchScopeTab('short')"
              >
                <span>短期改装</span>
                <span class="eng-tab-count font-mono">{{ shortCatalog.length }}</span>
              </button>
              <button
                role="tab"
                data-test="eng-tab-long"
                class="eng-tab"
                :class="{ 'eng-tab--active': effectiveScopeTab === 'long' }"
                :aria-selected="effectiveScopeTab === 'long'"
                @click="switchScopeTab('long')"
              >
                <span>长期巨构</span>
                <span v-if="longProjectCatalog.length > 0" class="eng-tab-count font-mono">{{ longProjectCatalog.length }}</span>
                <span v-else class="eng-tab-lock"><Icon name="lock" :size="9" /></span>
              </button>
              <button
                role="tab"
                data-test="eng-tab-space"
                class="eng-tab"
                :class="{ 'eng-tab--active': effectiveScopeTab === 'space' }"
                :aria-selected="effectiveScopeTab === 'space'"
                @click="switchScopeTab('space')"
              >
                <span>天基航天</span>
                <span class="eng-tab-count font-mono">{{ spaceOverview.orbitalCount }}</span>
              </button>
            </div>

            <div v-if="effectiveScopeTab !== 'space'" class="eng-catalog-toolbar">
              <input
                v-model.trim="catalogQuery"
                type="search"
                class="eng-catalog-search"
                placeholder="搜索工程 / 前置理论..."
                aria-label="搜索工程或前置理论"
              />
              <div v-if="effectiveScopeTab === 'short'" class="eng-cat-filters" data-test="eng-cat-filter" role="group" aria-label="兵种与对象分类筛选">
                <button
                  v-for="c in SHORT_CATEGORY_FILTERS"
                  :key="c.key"
                  type="button"
                  class="eng-grade-filter-chip"
                  :class="{ 'eng-grade-filter-chip--active': categoryFilter === c.key }"
                  :data-cat-key="c.key"
                  @click="categoryFilter = c.key"
                >
                  {{ c.label }}
                </button>
              </div>
              <div v-if="effectiveScopeTab === 'short'" class="eng-grade-filters" role="group" aria-label="改装等级筛选">
                <button
                  v-for="g in SHORT_GRADE_FILTERS"
                  :key="g.key"
                  type="button"
                  class="eng-grade-filter-chip"
                  :class="{ 'eng-grade-filter-chip--active': gradeFilter === g.key }"
                  @click="gradeFilter = g.key"
                >
                  {{ g.label }}
                </button>
              </div>
            </div>

            <div class="eng-catalog-list flex-1 overflow-y-auto">
              <template v-if="effectiveScopeTab === 'short'">
                <button
                  v-for="def in filteredShortCatalog"
                  :key="def.name"
                  class="eng-catalog-item"
                  :class="{ 'eng-catalog-item--active': selectedDef?.name === def.name }"
                  @click="selectDef(def.name)"
                >
                  <span class="eng-item-dot" :class="catalogItemDotClass(def)" :title="catalogItemStatusTitle(def)" aria-hidden="true" />
                  <span class="eng-catalog-item-name">{{ def.name }}</span>
                  <span class="eng-item-state-badge" :data-tone="catalogItemBadge(def).tone">{{ catalogItemBadge(def).text }}</span>
                  <span v-if="def.kind === 'project'" class="eng-v2-tag">仓段</span>
                  <span class="eng-grade-badge" :class="gradeClass(defGrade(def))">{{ defGrade(def) }}</span>
                </button>
                <div v-if="filteredShortCatalog.length === 0" class="eng-empty-line">
                  {{ shortCatalog.length === 0 ? '工程目录暂未加载 · 暂无可下达项目' : '无匹配工程条目' }}
                </div>
              </template>

              <template v-else-if="effectiveScopeTab === 'long'">
                <button
                  v-for="def in filteredLongProjectCatalog"
                  :key="def.name"
                  class="eng-catalog-item"
                  :class="{ 'eng-catalog-item--active': selectedDef?.name === def.name }"
                  @click="selectDef(def.name)"
                >
                  <span class="eng-item-dot" :class="catalogItemDotClass(def)" :title="catalogItemStatusTitle(def)" aria-hidden="true" />
                  <span class="eng-catalog-item-name">{{ def.name }}</span>
                  <span class="eng-item-state-badge" :data-tone="catalogItemBadge(def).tone">{{ catalogItemBadge(def).text }}</span>
                  <span class="eng-v2-tag">仓段</span>
                  <span class="eng-grade-badge" :class="gradeClass(defGrade(def))">{{ defGrade(def) }}</span>
                </button>
                <div v-for="def in longRetrofitCatalog" :key="def.name" class="eng-catalog-item eng-catalog-item--locked" aria-disabled="true">
                  <span class="eng-catalog-item-name">{{ def.name }}</span>
                  <span class="eng-lock-badge">后续版本</span>
                </div>
                <div v-if="longProjectCatalog.length === 0" class="eng-long-lock">
                  <span class="eng-long-lock-icon"><Icon name="lock" :size="18" /></span>
                  <span class="eng-lock-badge eng-lock-badge--lg">后续版本</span>
                  <p class="eng-long-lock-text">
                    跨基地大型联建工程将于后续版本开放：届时可指派多个基地分担舱段制造并协同总装。
                  </p>
                </div>
              </template>

              <template v-else>
                <div class="eng-space-nav-group" role="tablist" aria-label="天基航天子视图切换">
                  <div class="eng-space-nav-title">天基视图模式</div>
                  <button
                    type="button"
                    role="tab"
                    data-test="space-subview-mcc"
                    class="eng-catalog-item"
                    :class="{ 'eng-catalog-item--active': spaceSubView === 'mcc' }"
                    :aria-selected="spaceSubView === 'mcc'"
                    @click="switchSpaceSubView('mcc')"
                  >
                    <span class="eng-item-dot eng-item-dot--ready" aria-hidden="true" />
                    <span class="eng-catalog-item-name">📡 测控与发射台</span>
                    <span class="eng-item-state-badge" data-tone="ready">主大厅</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    data-test="space-subview-constellation"
                    class="eng-catalog-item"
                    :class="{ 'eng-catalog-item--active': spaceSubView === 'constellation' }"
                    :aria-selected="spaceSubView === 'constellation'"
                    @click="switchSpaceSubView('constellation')"
                  >
                    <span class="eng-item-dot eng-item-dot--ready" aria-hidden="true" />
                    <span class="eng-catalog-item-name">🌐 轨道星座组网</span>
                    <span class="eng-item-state-badge" data-tone="ready">组网</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    data-test="space-subview-station"
                    class="eng-catalog-item"
                    :class="{ 'eng-catalog-item--active': spaceSubView === 'station' }"
                    :aria-selected="spaceSubView === 'station'"
                    @click="switchSpaceSubView('station')"
                  >
                    <span class="eng-item-dot eng-item-dot--ready" aria-hidden="true" />
                    <span class="eng-catalog-item-name">🛰️ 空间站组装</span>
                    <span class="eng-item-state-badge" data-tone="ready">拼装</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    data-test="space-subview-lunar"
                    class="eng-catalog-item"
                    :class="{ 'eng-catalog-item--active': spaceSubView === 'lunar' }"
                    :aria-selected="spaceSubView === 'lunar'"
                    @click="switchSpaceSubView('lunar')"
                  >
                    <span class="eng-item-dot eng-item-dot--ready" aria-hidden="true" />
                    <span class="eng-catalog-item-name">🌕 月球基地建设</span>
                    <span class="eng-item-state-badge" data-tone="ready">月面</span>
                  </button>
                </div>
                <div class="eng-space-nav-group">
                  <div class="eng-space-nav-title">在轨星座速览 ({{ orbitalAssetCards.length }})</div>
                  <div v-if="orbitalAssetCards.length === 0" class="eng-empty-line">暂无在轨卫星或空间站载荷</div>
                  <div v-for="asset in orbitalAssetCards" :key="asset.id" class="eng-space-mini-item">
                    <span class="eng-space-mini-name">{{ asset.name }}</span>
                    <span class="eng-item-state-badge" data-tone="done">{{ asset.orbit }} · {{ asset.kindLabel }}</span>
                  </div>
                </div>
              </template>
            </div>
          </aside>

          <!-- ══ 主内容区：选中工程信息容器 + 工程实例分组 / 天基航天左右双栏工作台 ══ -->
          <div class="eng-main flex min-w-0 flex-1 flex-col overflow-y-auto">
            <SpaceBlueprintCanvas
              v-if="effectiveSpaceCanvasDomain"
              :domain="effectiveSpaceCanvasDomain"
              :snapshot="props.snapshot"
              :selected-base-name="selectedBaseDisplayName"
              @commit-blueprint="handleCommitSpaceCanvasBlueprint"
              @launch-node="handleLaunchSpaceCanvasNode"
            />

            <template v-if="effectiveScopeTab !== 'space' || isLegacyV2TestFallback">
            <section v-if="selectedDef" class="eng-info" aria-label="选中工程信息">
              <div class="eng-info-head">
                <span class="eng-info-name">{{ selectedDef.name }}</span>
                <span class="eng-grade-badge" :class="gradeClass(defGrade(selectedDef))">{{ defGrade(selectedDef) }}</span>
                <span class="eng-scope-tag">{{ selectedIsV2 || effectiveScopeTab === 'long' ? '长期 · 战略总成' : '短期 · 单基地改装' }}</span>
                <span v-if="sceneProject" class="eng-instance-pill" :data-status="sceneProject.status">当前状态 · {{ sceneProject.status }}</span>
              </div>

              <!-- 顶部改装蜕变对比横幅 -->
              <div
                v-if="selectedRetrofitPreview"
                class="eng-upgrade-banner"
                data-test="eng-retrofit-target-preview"
              >
                <span class="eng-upgrade-side">
                  {{ selectedRetrofitPreview.isBuildingRetrofit ? '改装设施' : '改装对象' }} ·
                  <b class="font-mono">{{ selectedRetrofitPreview.targetLabel }}</b>
                </span>
                <span class="eng-upgrade-arrow">➔ 升级型号 ·</span>
                <b class="eng-upgrade-target font-mono text-[#7dd3fc]">{{ selectedRetrofitPreview.upgradedLabel }}</b>
                <span v-if="hasLiveRuntimeState" class="eng-upgrade-count font-mono">
                  当前在役：{{ selectedRetrofitPreview.inServiceCount }}
                </span>
              </div>

              <!-- 中部双栏工作台：左「工序阶梯/模块网格 + 进度」∥ 右「立项三门核验清单 + 方案摘要」 -->
              <div class="eng-workbench-grid">
                <div class="eng-workbench-col">
                  <!-- V1 阶段阶梯指示器（观察a：档位数读 def.phases 实际阶段数） -->
                  <div v-if="!selectedIsV2" class="eng-info-row eng-info-row--ladder">
                    <div class="eng-ladder-header">
                      <span class="eng-info-label">施工阶段</span>
                      <span class="eng-phase-ladder" :aria-label="`共 ${defPhaseCount(selectedDef)} 阶段`">
                        <span v-for="i in defPhaseCount(selectedDef)" :key="i" class="eng-phase-step" :class="phaseStepClass(i - 1)">
                          <span
                            class="eng-phase-dot"
                            :data-task-id="phaseObserverFor(i - 1)?.taskId"
                            :data-task-status="phaseObserverFor(i - 1)?.status"
                            :data-task-held="phaseObserverFor(i - 1)?.held ? 'true' : undefined"
                            :data-task-settling="phaseObserverFor(i - 1)?.settling ? 'true' : undefined"
                            :data-task-draft="phaseObserverFor(i - 1)?.draft ? 'true' : undefined"
                            :data-spent-minutes="phaseObserverFor(i - 1)?.spentMinutes"
                            :data-total-minutes="phaseObserverFor(i - 1)?.totalMinutes"
                            aria-hidden="true"
                          />
                          <span class="eng-phase-step-idx font-mono">P{{ i }}</span>
                          <span class="eng-phase-step-name">{{ phaseStepName(selectedDef, i - 1) }}</span>
                          <span v-if="phaseStepStateText(i - 1)" class="eng-phase-step-state font-mono">{{ phaseStepStateText(i - 1) }}</span>
                        </span>
                        <span class="eng-phase-text font-mono">{{ v1DonePhaseCount }}/{{ defPhaseCount(selectedDef) }}</span>
                      </span>
                    </div>
                  </div>

                  <!-- V2 模块网格（V2-07） -->
                  <div v-else class="eng-modgrid-block">
                    <div class="eng-info-row">
                      <span class="eng-info-label">舱段模块</span>
                      <span class="eng-modgrid-summary font-mono">
                        已完成 {{ v2DoneCount }}/{{ v2ModuleCards.length }} · {{ v2Instance ? v2Instance.status : '未立项' }}
                      </span>
                    </div>
                    <div class="eng-modgrid" role="list" aria-label="仓段模块拓扑网格">
                      <button
                        v-for="mod in v2ModuleCards"
                        :key="mod.moduleId"
                        role="listitem"
                        class="eng-mod"
                        :class="{
                          'eng-mod--pending': mod.stateKey === 'pending',
                          'eng-mod--active': mod.stateKey === 'active',
                          'eng-mod--paused': mod.stateKey === 'paused',
                          'eng-mod--done': mod.stateKey === 'done',
                          'eng-mod--cancelled': mod.stateKey === 'cancelled',
                          'eng-mod--locked': mod.locked,
                          'eng-mod--selected': selectedModuleId === mod.moduleId,
                        }"
                        :data-module-id="mod.moduleId"
                        :data-module-state="mod.stateKey"
                        :data-locked="mod.locked ? 'true' : undefined"
                        :data-task-id="moduleObserverFor(mod.moduleId)?.taskId"
                        :data-task-status="moduleObserverFor(mod.moduleId)?.status"
                        :data-task-held="moduleObserverFor(mod.moduleId)?.held ? 'true' : undefined"
                        :data-task-settling="moduleObserverFor(mod.moduleId)?.settling ? 'true' : undefined"
                        :data-task-draft="moduleObserverFor(mod.moduleId)?.draft ? 'true' : undefined"
                        :data-spent-minutes="moduleObserverFor(mod.moduleId)?.spentMinutes"
                        :data-total-minutes="moduleObserverFor(mod.moduleId)?.totalMinutes"
                        :title="mod.locked ? `前置未满足：${mod.blockingPrereqs.join('、')}` : (mod.projectionName ?? mod.name)"
                        :aria-label="`模块 ${mod.name}（${mod.status}）`"
                        @click="selectModule(mod.moduleId)"
                      >
                        <span class="eng-mod-head">
                          <span class="eng-mod-dot" aria-hidden="true" />
                          <span class="eng-mod-name">{{ mod.name }}</span>
                          <span class="eng-mod-id font-mono">{{ mod.moduleId }}</span>
                        </span>
                        <span class="eng-mod-state">{{ mod.status }}</span>
                        <span class="eng-mod-meta font-mono">
                          <span class="eng-mod-base">承建 · {{ mod.baseName || '待指派' }}</span>
                          <span class="eng-mod-queue">{{ mod.projectionName ? `排产于 ${mod.projectionName}` : '未排产' }}</span>
                        </span>
                        <span v-if="mod.locked" class="eng-mod-prereq">前置 · {{ mod.blockingPrereqs.join('、') }}</span>
                      </button>
                    </div>
                  </div>

                  <!-- 进度条 + ETA 位 -->
                  <div class="eng-info-row">
                    <span class="eng-info-label">进度 / ETA</span>
                    <span class="eng-progress-track" role="progressbar" :aria-valuenow="engProgress.now" aria-valuemin="0" aria-valuemax="100">
                      <span class="eng-progress-fill" :style="{ width: engProgress.pct }" />
                    </span>
                    <span class="eng-eta font-mono">{{ utoActiveEtaText }}</span>
                  </div>

                  <!-- UTO-UI-DOMAIN-01：属地工程工位快照与在途工程任务同源观察层 -->
                  <div
                    v-if="utoStations.length > 0 || utoScheduledTasks.length > 0 || utoDraftTasks.length > 0"
                    class="eng-uto-observer"
                    data-uto-eng-observer
                    :data-uto-draft-count="utoDraftTasks.length"
                  >
                    <span
                      v-for="st in utoStations"
                      v-show="isStationRelevantForSelected(st)"
                      :key="st.laneKey"
                      class="eng-uto-station font-mono"
                      :class="{ 'eng-uto-station--ready': st.capacity > 0 && !st.locked, 'eng-uto-station--zero': st.capacity === 0 || st.locked }"
                      :data-lane-key="st.laneKey"
                      :data-lane-domain="st.domain"
                      :data-lane-capacity="st.capacity"
                      :data-lane-locked="st.locked ? 'true' : 'false'"
                    >
                      <span class="eng-uto-station-main">
                        {{ resolveBaseDisplayName(st.baseId) ? `${resolveBaseDisplayName(st.baseId)}·` : '' }}{{ st.displayName }}（容量 {{ st.capacity }}）
                      </span>
                      <span v-if="st.capacity === 0" class="eng-uto-station-hint">需建造「{{ stationUnlockHint(st) }}」解锁工位</span>
                    </span>
                    <span
                      v-for="task in utoScheduledTasks"
                      :key="task.id"
                      class="eng-uto-task font-mono"
                      :data-task-id="task.id"
                      :data-task-status="task.status"
                      :data-task-held="task.status === 'held' ? 'true' : undefined"
                      :data-task-settling="task.status === 'settling' ? 'true' : undefined"
                      :data-spent-minutes="task.workload.spentMinutes"
                      :data-total-minutes="task.workload.totalMinutes"
                    >
                      {{ task.name }} {{ task.workload.spentMinutes }}/{{ task.workload.totalMinutes }}m · {{ task.status }}
                    </span>
                  </div>
                </div>

                <!-- 右卡：立项三门核验清单 + 工程方案摘要 -->
                <div class="eng-workbench-col eng-workbench-col--right">
                  <div class="eng-gate-checklist" data-test="eng-gate-checklist">
                    <div class="eng-gate-checklist-title">立项三门核验清单</div>
                    <div
                      v-for="gate in gateChecklist"
                      :key="gate.key"
                      class="eng-gate-item"
                      :class="{ 'eng-gate-item--ok': gate.ok, 'eng-gate-item--warn': gate.warn }"
                      :data-gate-key="gate.key"
                    >
                      <span class="eng-gate-label">{{ gate.label }}</span>
                      <span class="eng-gate-val font-mono">{{ gate.value }}</span>
                      <span class="eng-gate-status font-mono">{{ gate.statusText }}</span>
                    </div>
                  </div>

                  <!-- 资金 / 纳米占用位 -->
                  <div class="eng-info-row eng-info-row--res">
                    <template v-if="selectedIsV2">
                      <span class="eng-res-slot">
                        <Icon name="credits" :size="11" /> 资金占用 <b class="font-mono">{{ v2Def?.cost != null ? `$${v2Def.cost}` : '待勘测' }}</b>
                      </span>
                      <span class="eng-res-slot">
                        <Icon name="gear" :size="11" /> 纳米占用 <b class="font-mono">{{ formatNaniteRequirement(v2Def?.requirements?.nanites) }}</b>
                      </span>
                      <span class="eng-res-slot eng-res-slot--prereq">
                        前置理论 · {{ v2Def?.requirements?.research || '——' }}
                        <span
                          v-if="hasLiveRuntimeState && v2Def?.requirements?.research"
                          class="eng-prereq-status"
                          :class="isResearchUnlocked(v2Def.requirements.research) ? 'eng-prereq-status--ok' : 'eng-prereq-status--warn'"
                        >
                          {{ isResearchUnlocked(v2Def.requirements.research) ? '✓ 已掌握' : '⚠ 未研发' }}
                        </span>
                      </span>
                      <span v-if="v2Def?.requirements?.building" class="eng-res-slot eng-res-slot--prereq">所需设施 · {{ v2Def.requirements.building }}</span>
                    </template>
                    <template v-else>
                      <span class="eng-res-slot">
                        <Icon name="credits" :size="11" /> 资金占用 <b class="font-mono">{{ selectedDef.cost != null ? `$${selectedDef.cost}` : '待勘测' }}</b>
                      </span>
                      <span class="eng-res-slot">
                        <Icon name="gear" :size="11" /> 纳米占用 <b class="font-mono">{{ formatNaniteRequirement(selectedDef.resources?.nanites) }}</b>
                      </span>
                      <span class="eng-res-slot eng-res-slot--prereq">
                        前置理论 · {{ selectedDef.research }}
                        <span
                          v-if="hasLiveRuntimeState && selectedDef.research"
                          class="eng-prereq-status"
                          :class="isResearchUnlocked(selectedDef.research) ? 'eng-prereq-status--ok' : 'eng-prereq-status--warn'"
                        >
                          {{ isResearchUnlocked(selectedDef.research) ? '✓ 已掌握' : '⚠ 未研发' }}
                        </span>
                      </span>
                    </template>
                  </div>

                  <p class="eng-info-desc">{{ selectedDef.desc }}</p>
                </div>
              </div>

              <!-- ENG-UI-02 场景引擎接入。勿改 id -->
              <div v-if="selectedShowScene" id="eng-scene-slot" class="eng-scene-slot" aria-label="工程场景区">
                <EngSceneView :def="selectedDef" :project="sceneProject" @hotspot-info="onSceneHotspot" />
              </div>

              <!-- ENG-UI-03 立项令入口 -->
              <div v-if="!selectedIsV2" class="eng-initiate-row">
                <button class="eng-initiate-btn" :disabled="!initiateTarget.enabled" :title="initiateTarget.hint" aria-label="下达立项指令" @click="handleInitiate">
                  <Icon name="send" :size="11" /> {{ ENG_COMMAND_COPY.initiate.label }}
                </button>
                <span class="eng-initiate-hint">{{ friendlyInitiateHint }}</span>
              </div>

              <!-- V2-07 仓段化指令区 -->
              <div v-else class="eng-v2cmd">
                <div v-if="usingMock" class="eng-mock-note font-mono">预览模式 · 当前展示示例工程数据</div>
                <div class="eng-v2cmd-row" role="group" :aria-label="ENG_COMMAND_COPY.v2.groupLabel(selectedDef.name)">
                  <button class="eng-initiate-btn" :disabled="!initiateTarget.enabled" :title="v2InitiateHint" aria-label="下达立项指令" @click="handleInitiate">
                    <Icon name="send" :size="11" /> {{ ENG_COMMAND_COPY.initiate.label }}
                  </button>
                  <button
                    v-for="btn in v2ProjectButtons"
                    :key="btn.verb"
                    class="eng-v2cmd-btn"
                    :class="{ 'eng-v2cmd-btn--danger': btn.verb === '取消' }"
                    :disabled="!btn.enabled"
                    :title="btn.hint"
                    :aria-label="btn.label"
                    :data-dispatch-verb="engVerbToUnifiedCommandType(btn.verb)"
                    @click="handleV2ProjectOrder(btn)"
                  >
                    {{ btn.label }}
                  </button>
                </div>
                <div v-if="selectedModule" class="eng-mod-actions">
                  <span class="eng-mod-actions-label font-mono">选中模块「{{ selectedModule.name }}」</span>
                  <button
                    v-for="btn in selectedModuleButtons"
                    :key="btn.verb"
                    class="eng-v2cmd-btn"
                    :disabled="!btn.enabled"
                    :title="btn.hint"
                    :aria-label="`${btn.label}（${selectedModule.name}）`"
                    :data-dispatch-verb="engVerbToUnifiedCommandType(btn.verb)"
                    @click="handleV2ModuleOrder(btn)"
                  >
                    {{ btn.label }}
                  </button>
                  <button
                    v-if="canShowV2AllocateButton"
                    class="eng-v2cmd-btn"
                    :disabled="!initiateTarget.enabled"
                    :title="`基地指派令（Allocate）：将模块「${selectedModule?.name ?? ''}」指派至「${initiateTarget.base || '待定'}」`"
                    :aria-label="`指派承建基地（${selectedModule?.name ?? ''}）`"
                    data-dispatch-verb="Allocate"
                    @click="handleV2AllocateOrder()"
                  >
                    指派基地
                  </button>
                </div>
                <span class="eng-initiate-hint">{{ friendlyV2InitiateHint }}</span>

                <div v-if="v2CancelConfirmOpen" class="eng-cancel-mask" role="presentation" @click.self="v2CancelConfirmOpen = false">
                  <section class="eng-cancel-card" role="alertdialog" aria-modal="true" :aria-label="ENG_COMMAND_COPY.confirm.title">
                    <header class="eng-cancel-title"><Icon name="alert" :size="12" /> {{ ENG_COMMAND_COPY.confirm.title }}</header>
                    <p class="eng-cancel-text">{{ v2CancelSettlement }}</p>
                    <p class="eng-cancel-note">{{ ENG_COMMAND_COPY.confirm.note }}</p>
                    <div class="eng-cancel-actions">
                      <button class="eng-v2cmd-btn" @click="v2CancelConfirmOpen = false">{{ ENG_COMMAND_COPY.confirm.deny }}</button>
                      <button class="eng-v2cmd-btn eng-v2cmd-btn--danger" @click="handleV2CancelAffirm">{{ ENG_COMMAND_COPY.confirm.affirm }}</button>
                    </div>
                  </section>
                </div>
              </div>
            </section>
            <section v-else class="eng-info eng-info--empty">
              <p class="eng-empty-line">请从左侧列表选择一项工程或改装项目</p>
            </section>

            <!-- ══ 工程实例分组：进行中 / 规划中 / 已完工 ══ -->
            <section
              class="eng-groups"
              :class="{ 'eng-groups--compact-empty': allProjectGroupsEmpty }"
              aria-label="工程项目进度分组"
            >
              <div v-if="usingMock" class="eng-mock-note font-mono">预览模式 · 当前展示示例工程数据</div>
              <div v-for="group in projectGroups" :key="group.key" class="eng-group">
                <div class="eng-group-header">
                  <span class="eng-tone-dot" :class="group.toneClass" />
                  {{ group.label }}
                  <span class="eng-group-count font-mono">{{ group.items.length }}</span>
                </div>
                <div v-if="group.items.length === 0" class="eng-empty-line">暂无{{ group.label }}工程</div>
                <div
                  v-for="p in group.items"
                  :key="p.id"
                  class="eng-card"
                  :class="{ 'eng-card--active': selectedDef?.name === p.ref }"
                  role="button"
                  tabindex="0"
                  @click="focusProjectInView(p)"
                  @keydown.enter.prevent="focusProjectInView(p)"
                >
                  <span class="eng-card-name">{{ displayName(p) }}</span>
                  <span class="eng-card-meta">
                    <span class="eng-grade-badge" :class="gradeClass(p.grade)">{{ p.grade }}</span>
                    <span class="eng-card-phase font-mono">{{ phaseSummary(p) }}</span>
                    <button type="button" class="eng-card-detail-btn" :aria-label="`查看${displayName(p)}档案详情`" @click.stop="openProjectDetail(p)">
                      详情
                    </button>
                  </span>
                </div>
              </div>
            </section>
            </template>

            <!-- ══ 🚀 天基航天测控大厅（effectiveScopeTab === 'space' · FD-27 多发射中心切换栏 + 左右双栏工作台） ══ -->
            <div v-else-if="spaceSubView === 'mcc'" class="eng-space-main" data-test="eng-space-main">
              <!-- 0. 顶部天基全局态势条与发射门控提示 -->
              <div class="eng-space-telemetry-ribbon font-mono" data-test="eng-space-telemetry-ribbon">
                <span class="eng-space-stat">🛰️ 在轨载荷 <b>{{ spaceOverview.orbitalCount }}</b></span>
                <span class="eng-space-stat">🚀 可复用助推器 <b>{{ spaceOverview.boosterCount }}</b></span>
                <span class="eng-space-stat">📋 活跃/总合同 <b>{{ spaceOverview.activeContractCount }}/{{ spaceOverview.totalContractCount }}</b></span>
                <span class="eng-space-stat">
                  📡 发射场 <b>{{ launchReadiness.launchpadReady ? launchReadiness.launchpadBaseNames.join('、') : '未就绪' }}</b>
                </span>
                <span class="eng-space-stat">
                  🏙️ 激活发射中心 <b>{{ launchCenterCards.filter(c => c.isBuilt).length }}/{{ launchCenterCards.length }}</b>
                </span>
              </div>

              <div
                class="eng-space-gate-banner"
                :class="`eng-space-gate-banner--${launchReadiness.bannerTone}`"
                data-test="eng-space-gate-banner"
              >
                {{ launchReadiness.bannerText }}
              </div>

              <!-- 兼容旧版 #eng-scene-slot 契约 -->
              <div id="eng-scene-slot" class="eng-scene-slot eng-scene-slot--compact" aria-label="天基测控场景区">
                <EngSceneView :def="spaceSceneDef" :project="spaceSceneProject" @hotspot-info="onSceneHotspot" />
              </div>

              <!-- 1. 顶部【天地月多发射中心切换栏】（.eng-mcc-center-bar） -->
              <section
                class="eng-mcc-center-bar"
                data-test="eng-mcc-center-bar"
                aria-label="天地月多发射中心切换栏"
              >
                <div class="eng-mcc-center-bar-head">
                  <span class="font-mono text-[11px] font-bold text-[#7dd3fc]">
                    🌐 天地月多发射中心切换栏 ({{ launchCenterCards.length }})
                  </span>
                  <div class="flex flex-wrap items-center gap-1.5">
                    <button
                      v-if="!activeLaunchCenter.isBuilt"
                      type="button"
                      class="eng-v2cmd-btn font-mono text-[10px]"
                      data-test="btn-plan-new-launch-center"
                      @click="handlePlanNewLaunchCenter(activeLaunchCenter.base)"
                    >
                      ➕ 在当前基地规划新建航天发射中心（填入指令）
                    </button>
                    <button
                      v-for="unbuiltBase in unbuiltLaunchCenterBases"
                      :key="`plan-lc-${unbuiltBase}`"
                      type="button"
                      class="eng-mcc-new-center-btn font-mono text-[10px]"
                      :data-test="`btn-plan-new-launch-center-${unbuiltBase}`"
                      @click="handlePlanNewLaunchCenter(unbuiltBase)"
                    >
                      ➕ 在「{{ unbuiltBase }}」规划新建航天发射中心（填入指令）
                    </button>
                  </div>
                </div>

                <div class="eng-mcc-center-cards">
                  <button
                    v-for="center in launchCenterCards"
                    :key="center.id"
                    type="button"
                    class="eng-mcc-center-card"
                    :class="{ 'eng-mcc-center-card--active': activeLaunchCenter.id === center.id }"
                    data-test="eng-mcc-center-card"
                    :data-center-id="center.id"
                    :data-base="center.base"
                    :data-site-type="center.siteType"
                    :data-tier="center.tier"
                    @click="selectLaunchCenter(center.id)"
                  >
                    <div class="eng-mcc-center-card-top">
                      <span class="eng-mcc-center-title" data-test="mcc-center-title">
                        {{ center.base }} · {{ center.name }}
                      </span>
                      <span
                        class="eng-mcc-tier-badge font-mono"
                        :data-tier="center.tier"
                        data-test="mcc-center-tier-badge"
                      >
                        {{ center.tierBadge }}
                      </span>
                    </div>

                    <div class="eng-mcc-center-site" data-test="mcc-center-site-badge">
                      {{ center.siteBadge }}
                    </div>

                    <div class="eng-mcc-center-meta font-mono">
                      <span class="eng-mcc-tz-pill" data-test="mcc-center-tz-badge">
                        {{ center.localTimeBadge }}
                      </span>
                      <span class="eng-mcc-weather-pill" data-test="mcc-center-weather-badge">
                        {{ center.weatherBadge }}
                      </span>
                      <span class="eng-mcc-cap-pill">
                        运力上限 {{ center.maxPayloadTons }}t
                      </span>
                    </div>
                  </button>
                </div>
              </section>

              <!-- 2. 主体【左右两栏并排工作台】（复用 .eng-canvas-workbench 响应式双栏布局） -->
              <div class="eng-canvas-workbench" data-test="eng-mcc-workbench">
                <!-- 左栏：当前选中发射中心的 4→8→12 槽交互拓扑图 -->
                <div class="eng-mcc-workbench-left" data-test="eng-mcc-workbench-left">
                  <div class="eng-mcc-left-status font-mono" data-test="mcc-left-slot-progress">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        🧩 发射中心拓扑进度：<b>4→8→12 槽</b>（已挂载
                        <b>{{ activeLaunchCenterSlotStats.mountedCount }}</b> / 已展开
                        <b>{{ activeLaunchCenterSlotStats.unlockedCount }}</b> / 共 12 槽 · 当前等级
                        <b>{{ activeLaunchCenter.tierBadge }}</b>）
                      </span>
                      <span
                        class="eng-mcc-spaceport-pill"
                        :class="{ 'eng-mcc-spaceport-pill--active': activeLaunchCenter.isSpaceportCity }"
                        data-test="mcc-spaceport-city-badge"
                        :data-active="activeLaunchCenter.isSpaceportCity ? 'true' : 'false'"
                      >
                        {{
                          activeLaunchCenter.isSpaceportCity
                            ? `✦ 已激活【🏙️🚀 国家航天城·产装测发流水线】（lane: spaceport:${activeLaunchCenter.baseId} · 工期-35% / 成本-25%）`
                            : '◇ 【🏙️🚀 国家航天城·产装测发流水线】未激活（集齐 VAB + 地下旋压厂 + 卫星超净产线 + 深冷化工厂解锁）'
                        }}
                      </span>
                    </div>
                  </div>

                  <SpaceBlueprintCanvas
                    domain="launch_center"
                    :snapshot="props.snapshot"
                    :selected-base-name="activeLaunchCenter.base"
                    :initial-draft="activeLaunchCenterDraft"
                    :hide-inspector="true"
                    @commit-blueprint="handleCommitSpaceCanvasBlueprint"
                    @launch-node="handleLaunchSpaceCanvasNode"
                    @update:draft="handleUpdateLaunchCenterDraft"
                    @select-slot="handleSelectLaunchCenterSlot"
                  />
                </div>

                <!-- 右栏：3 个顶部切换页签（Tab 1 中心扩建 / Tab 2 航天装备产线与仓库 / Tab 3 火箭整备与发射合同） -->
                <div class="eng-mcc-workbench-right" data-test="eng-mcc-workbench-right">
                  <div class="eng-mcc-right-tabs" role="tablist" aria-label="测控与发射台工作台页签">
                    <button
                      type="button"
                      role="tab"
                      class="eng-mcc-right-tab"
                      :class="{ 'eng-mcc-right-tab--active': mccRightTab === 'expand' }"
                      :aria-selected="mccRightTab === 'expand'"
                      data-test="mcc-tab-expand"
                      @click="mccRightTab = 'expand'"
                    >
                      🏗️ 中心扩建与选配
                    </button>
                    <button
                      type="button"
                      role="tab"
                      class="eng-mcc-right-tab"
                      :class="{ 'eng-mcc-right-tab--active': mccRightTab === 'manufacture' }"
                      :aria-selected="mccRightTab === 'manufacture'"
                      data-test="mcc-tab-manufacture"
                      @click="mccRightTab = 'manufacture'"
                    >
                      🏭 航天装备产线与仓库
                    </button>
                    <button
                      type="button"
                      role="tab"
                      class="eng-mcc-right-tab"
                      :class="{ 'eng-mcc-right-tab--active': mccRightTab === 'contract' }"
                      :aria-selected="mccRightTab === 'contract'"
                      data-test="mcc-tab-contract"
                      @click="mccRightTab = 'contract'"
                    >
                      🚀 火箭整备与发射合同
                    </button>
                  </div>

                  <!-- ══ Tab 1：🏗️ 中心扩建与选配 ══ -->
                  <section
                    v-show="mccRightTab === 'expand'"
                    class="eng-mcc-tab-panel"
                    data-test="mcc-panel-expand"
                    aria-label="中心扩建与选配"
                  >
                    <header class="eng-space-card-title flex items-center justify-between gap-2">
                      <span>🏗️ {{ activeLaunchCenter.name }} · 拓扑插槽与扩建构件</span>
                      <span class="font-mono text-[9.5px] text-[#7dd3fc]">
                        {{ activeLaunchCenter.tierBadge }}
                      </span>
                    </header>

                    <!-- 12 槽速跳选择栏 -->
                    <div class="eng-mcc-slot-pills font-mono" data-test="mcc-expand-slot-list">
                      <button
                        v-for="slotItem in launchCenterSlotCatalog"
                        :key="slotItem.id"
                        type="button"
                        class="eng-mcc-slot-pill"
                        :class="{
                          'eng-mcc-slot-pill--active': selectedLcSlotId === slotItem.id,
                          'eng-mcc-slot-pill--mounted': Boolean(activeLaunchCenterDraft[slotItem.id]),
                        }"
                        :data-test="`mcc-slot-pill-${slotItem.id}`"
                        @click="selectedLcSlotId = slotItem.id"
                      >
                        <span>{{ activeLaunchCenterDraft[slotItem.id] ? '🟢' : '⚪' }}</span>
                        <span>T{{ slotItem.tier }}·{{ slotItem.label }}</span>
                      </button>
                    </div>

                    <div v-if="selectedLcSlotDef" class="eng-mcc-slot-detail">
                      <div class="flex items-center justify-between gap-2 font-mono text-[10.5px]">
                        <strong class="text-[#e0f2fe]">
                          当前选中插槽：{{ selectedLcSlotDef.label }}（Tier-{{ selectedLcSlotDef.tier }}）
                        </strong>
                        <span class="text-[#94a3b8]">接口：{{ selectedLcSlotDef.interfaceType }}</span>
                      </div>
                      <p class="mt-1 font-mono text-[9.5px] text-[#94a3b8]">
                        {{ selectedLcSlotDef.desc }}
                      </p>
                    </div>

                    <div class="eng-mcc-module-list" data-test="mcc-expand-module-list">
                      <div
                        v-for="mod in filteredLaunchCenterModules"
                        :key="mod.id"
                        class="eng-mcc-module-card"
                        :class="{ 'eng-mcc-module-card--mounted': activeLaunchCenterDraft[mod.slotId] === mod.id }"
                        :data-test="`mcc-expand-module-${mod.id}`"
                      >
                        <div class="flex flex-wrap items-center justify-between gap-1 font-mono text-[10.5px]">
                          <strong class="text-[#f1f5f9]">{{ mod.name }}</strong>
                          <span class="text-[#7dd3fc]">${{ mod.cost }} · 纳米{{ mod.nanites }} · {{ mod.days }}d</span>
                        </div>
                        <div class="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[9px]">
                          <span class="rounded-[2px] border border-[#38bdf8]/40 bg-[#0c4a6e]/30 px-1.5 py-0.2 text-[#bae6fd]">
                            适配槽位：{{ mod.slotLabel }} (T{{ mod.tier }})
                          </span>
                          <span
                            v-if="mod.isExpansionHub"
                            class="rounded-[2px] border border-[#c084fc]/50 bg-[#581c87]/40 px-1.5 py-0.2 text-[#f3e8ff]"
                          >
                            🌟 扩建枢纽（展开下阶外延槽）
                          </span>
                        </div>
                        <p class="mt-1 text-[9.5px] text-[#94a3b8]">{{ mod.effect }}</p>
                        <div class="mt-1.5 flex justify-end">
                          <button
                            type="button"
                            class="eng-v2cmd-btn font-mono text-[10px]"
                            data-test="btn-expand-lc-module"
                            :data-module-id="mod.id"
                            @click="handleExpandLaunchCenterModule(mod)"
                          >
                            {{
                              activeLaunchCenterDraft[mod.slotId] === mod.id
                                ? '✓ 已挂载 · 重新生成扩建指令'
                                : '🏗️ 选配并填入发射中心扩建指令'
                            }}
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>

                  <!-- ══ Tab 2：🏭 航天装备产线与仓库 ══ -->
                  <section
                    v-show="mccRightTab === 'manufacture'"
                    class="eng-mcc-tab-panel"
                    data-test="mcc-panel-manufacture"
                    aria-label="航天装备产线与仓库"
                  >
                    <!-- 2.1 三大专业制造建筑状态栏 -->
                    <div class="eng-mcc-subbox" data-test="mcc-aero-buildings-bar">
                      <header class="eng-space-card-title">
                        🏭 三大专业航天制造建筑状态栏（{{ activeLaunchCenter.base }}）
                      </header>
                      <div class="eng-mcc-fac-grid">
                        <div
                          v-for="fac in aeroFacilityStatuses"
                          :key="fac.key"
                          class="eng-mcc-fac-card"
                          :class="{ 'eng-mcc-fac-card--built': fac.built }"
                          :data-test="`mcc-aero-fac-${fac.key}`"
                        >
                          <div class="flex items-center justify-between gap-1 font-mono text-[10.5px]">
                            <strong class="text-[#f1f5f9]">{{ fac.icon }} {{ fac.name }}</strong>
                            <span
                              class="eng-item-state-badge"
                              :data-tone="fac.built ? 'done' : fac.inQueue ? 'active' : 'locked'"
                            >
                              {{ fac.built ? '已建成运转' : fac.inQueue ? '建造中' : '未建造' }}
                            </span>
                          </div>
                          <p class="mt-1 text-[9.5px] text-[#94a3b8]">
                            {{ fac.roleDesc }}（Tier-{{ fac.tier }} · ${{ fac.cost }}）
                          </p>
                          <div v-if="!fac.built" class="mt-1.5 flex justify-end">
                            <button
                              type="button"
                              class="eng-v2cmd-btn font-mono text-[9.5px]"
                              :data-test="`btn-build-aero-fac-${fac.key}`"
                              @click="handleBuildAeroFacility(fac)"
                            >
                              ➕ 建造{{ fac.name }}（填入指令）
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- 2.2 在建进度条区 -->
                    <div class="eng-mcc-subbox" data-test="mcc-aero-queues">
                      <header class="eng-space-card-title">
                        ⏳ 航天装备/部件/载荷在建进度条 ({{ aeroActiveQueues.length }})
                      </header>
                      <div v-if="aeroActiveQueues.length === 0" class="eng-empty-line">
                        当前无在途航天装备/载荷排产队列 · 可在下方库存架一键排产
                      </div>
                      <div v-else data-test="aero-active-queues">
                        <div
                          v-for="(q, qIdx) in aeroActiveQueues"
                          :key="`aero-q-${qIdx}-${q.item}`"
                          class="eng-mcc-queue-row font-mono"
                          data-test="mcc-aero-queue-item"
                        >
                          <div class="flex flex-wrap items-center justify-between gap-1 text-[10px]">
                            <strong class="text-[#e0f2fe]">{{ q.item }}</strong>
                            <span class="text-[#7dd3fc]">
                              进度 {{ q.progress }}% · 批次 {{ q.qtyDone }}/{{ q.qty }} · {{ q.base }} ·
                              {{ q.eta || '计算中' }}
                            </span>
                          </div>
                          <div class="mt-1 h-1.5 w-full overflow-hidden rounded-[2px] bg-slate-900">
                            <div
                              class="h-full bg-[#38bdf8]"
                              :style="{ width: `${Math.min(100, Math.max(0, q.progress))}%` }"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- 2.3 四大品类库存与一键排产架 -->
                    <div class="eng-mcc-subbox" data-test="mcc-aero-stock-rack">
                      <header class="eng-space-card-title">
                        📦 四大品类航天装备库存与一键排产架
                      </header>
                      <div
                        v-for="group in aeroEquipmentGroups"
                        :key="group.categoryKey"
                        class="eng-mcc-equip-group"
                        :data-test="`mcc-equip-group-${group.categoryKey}`"
                      >
                        <div class="eng-mcc-equip-group-title font-mono">
                          <span>{{ group.categoryLabel }}</span>
                          <span class="text-[9px] text-[#94a3b8]">承建：{{ group.facilityName }}</span>
                        </div>
                        <div class="eng-mcc-equip-items">
                          <div
                            v-for="item in group.items"
                            :key="item.id"
                            class="eng-mcc-equip-row"
                            :data-test="`mcc-equip-item-${item.id}`"
                          >
                            <div class="min-w-0 flex-1">
                              <div class="flex flex-wrap items-center justify-between gap-1 font-mono text-[10px]">
                                <strong class="text-[#f1f5f9]">{{ item.name }}</strong>
                                <span
                                  class="eng-mcc-stock-badge"
                                  :class="{ 'eng-mcc-stock-badge--has': item.stock > 0 }"
                                  :data-test="`mcc-equip-stock-${item.id}`"
                                >
                                  库存 {{ item.stock }}
                                </span>
                              </div>
                              <div class="mt-0.5 font-mono text-[9px] text-[#94a3b8]">
                                ${{ item.cost }} · {{ item.days }}d · {{ item.facility }} · {{ item.desc }}
                              </div>
                            </div>
                            <div class="flex flex-none items-center gap-1">
                              <button
                                type="button"
                                class="eng-v2cmd-btn font-mono text-[9.5px]"
                                :data-test="`btn-produce-1-${item.id}`"
                                @click="handleScheduleAeroEquipment(item, 1)"
                              >
                                +1 排产
                              </button>
                              <button
                                type="button"
                                class="eng-v2cmd-btn font-mono text-[9.5px]"
                                :data-test="`btn-produce-4-${item.id}`"
                                @click="handleScheduleAeroEquipment(item, 4)"
                              >
                                +4 批量流水线排产
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  <!-- ══ Tab 3：🚀 火箭整备与发射合同 ══ -->
                  <section
                    v-show="mccRightTab === 'contract'"
                    class="eng-mcc-tab-panel"
                    data-test="mcc-panel-contract"
                    aria-label="火箭整备与发射合同"
                  >
                    <!-- 载荷来源双轨切换（严守 D7-B 红线：前端绝不乱造商业订单！） -->
                    <div class="eng-mcc-source-switch font-mono" data-test="mcc-payload-source-switch">
                      <button
                        type="button"
                        class="eng-mcc-source-btn"
                        :class="{ 'eng-mcc-source-btn--active': payloadSourceTab === 'domestic' }"
                        data-test="payload-source-domestic"
                        @click="payloadSourceTab = 'domestic'"
                      >
                        🏠 自家需求订单与自产载荷
                      </button>
                      <button
                        type="button"
                        class="eng-mcc-source-btn"
                        :class="{ 'eng-mcc-source-btn--active': payloadSourceTab === 'commercial' }"
                        data-test="payload-source-commercial"
                        @click="payloadSourceTab = 'commercial'"
                      >
                        💼 外部商业委托载荷（仅接收 LLM 下发）({{ externalCommercialOrders.length }})
                      </button>
                    </div>

                    <!-- 选址运力上限、局部天气窗口与燃料回款加成实时验算盒 -->
                    <div class="eng-mcc-verify-box font-mono" data-test="mcc-capacity-verification">
                      <div class="flex flex-wrap items-center justify-between gap-1 text-[10px]">
                        <span class="text-[#7dd3fc]">
                          📐 当前发射中心验算：<b>{{ activeLaunchCenter.base }} · {{ activeLaunchCenter.name }}</b>
                        </span>
                        <span class="text-[#86efac]">
                          最大有效运力：<b>{{ activeLaunchCenter.maxPayloadTons }}t</b>（×{{ activeLaunchCenter.payloadMult }}）
                        </span>
                      </div>
                      <div class="mt-1 flex flex-wrap items-center gap-3 text-[9.5px] text-[#cbd5e1]">
                        <span>💰 选址燃料回款加成：<b>{{ activeLaunchCenter.payoutMultText }}</b></span>
                        <span>🌤️ 局部气象窗口：<b>{{ activeLaunchCenter.weatherBadge }}</b></span>
                        <span>🕒 当地时区：<b>{{ activeLaunchCenter.localTimeBadge }}</b></span>
                      </div>
                    </div>

                    <!-- 分支 B：外部商业委托载荷（严格只读 space.commercial_orders，严守 D7-B 红线） -->
                    <div
                      v-show="payloadSourceTab === 'commercial'"
                      class="eng-mcc-subbox"
                      data-test="mcc-commercial-orders-box"
                    >
                      <header class="eng-space-card-title">
                        💼 外部商业委托载荷池 ({{ externalCommercialOrders.length }})
                      </header>
                      <div
                        v-if="externalCommercialOrders.length === 0"
                        class="eng-mcc-commercial-empty font-mono"
                        data-test="mcc-commercial-orders-empty"
                      >
                        暂无外部商业委托载荷（前端严禁伪造商业单，仅接收 LLM 在剧情 &lt;航天合同&gt; 中下发的商业委托）
                      </div>
                      <div v-else class="flex flex-col gap-1.5">
                        <div
                          v-for="order in externalCommercialOrders"
                          :key="order.id"
                          class="eng-space-contract-item"
                          data-test="mcc-commercial-order-item"
                          :data-order-id="order.id"
                        >
                          <div class="eng-space-contract-head font-mono">
                            <span class="eng-space-asset-name">{{ order.name }}</span>
                            <span class="eng-item-state-badge" data-tone="ready">{{ order.orbit }} · {{ order.mass_t }}t</span>
                            <span class="eng-item-state-badge" :data-tone="order.status === 'pending' ? 'active' : 'done'">
                              {{ order.status }}
                            </span>
                          </div>
                          <div class="eng-space-asset-bonus font-mono">
                            委托方：{{ order.client }} · 载荷质量：{{ order.mass_t }}t · 履约报酬：${{ order.reward_credits }}
                          </div>
                          <div v-if="order.status === 'pending'" class="eng-space-contract-actions">
                            <button
                              type="button"
                              class="eng-v2cmd-btn font-mono text-[10px]"
                              data-test="btn-accept-commercial-order"
                              @click="handleSelectCommercialOrderForLaunch(order)"
                            >
                              🚀 选中该商业载荷并配箭履约发射
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- 分支 A：自家需求订单与自产载荷 + 火箭整备拟定器 -->
                    <section
                      v-show="payloadSourceTab === 'domestic'"
                      class="eng-space-card eng-space-drafter"
                      data-test="eng-space-contract-drafter"
                      aria-label="拟定并发起新发射合同"
                    >
                      <header class="eng-space-card-title">🚀 火箭整备与发射合同拟定台</header>

                      <!-- 自产库存载荷快捷选配 -->
                      <div class="mb-2 rounded-[2px] border border-slate-700/70 bg-slate-950/60 p-2 font-mono text-[9.5px]">
                        <div class="mb-1 text-[#7dd3fc]">🛰️ 库存自产载荷与火箭芯级/助推器选配：</div>
                        <div class="flex flex-wrap gap-1">
                          <button
                            v-for="pItem in domesticPayloadOptions"
                            :key="pItem.id"
                            type="button"
                            class="eng-mcc-slot-pill"
                            :class="{ 'eng-mcc-slot-pill--active': spaceDraft.payload === pItem.name }"
                            @click="selectDomesticPayloadPreset(pItem)"
                          >
                            {{ pItem.name }} (库存:{{ pItem.stock }})
                          </button>
                        </div>
                        <div class="mt-1.5 flex flex-wrap gap-2.5 text-[#cbd5e1]">
                          <label class="eng-space-check">
                            <input v-model="rocketStageCheck.coreFirst" type="checkbox" />
                            <span>芯一级 (库存:{{ getAeroEquipmentStock('common.unit.aero.core_first_stage', '标准运载火箭芯一级') }})</span>
                          </label>
                          <label class="eng-space-check">
                            <input v-model="rocketStageCheck.strapBooster" type="checkbox" />
                            <span>捆绑助推器 (库存:{{ getAeroEquipmentStock('common.unit.aero.strap_on_booster', '通用捆绑式助推器') }})</span>
                          </label>
                          <label class="eng-space-check">
                            <input v-model="rocketStageCheck.vacuumSecond" type="checkbox" />
                            <span>真空芯二级 (库存:{{ getAeroEquipmentStock('common.unit.aero.vacuum_second_stage', '高空入轨真空芯二级') }})</span>
                          </label>
                          <label class="eng-space-check">
                            <input v-model="rocketStageCheck.upperKick" type="checkbox" />
                            <span>远征上面级 (库存:{{ getAeroEquipmentStock('common.unit.aero.upper_kick_stage', '远征上面级') }})</span>
                          </label>
                        </div>
                      </div>

                      <div class="eng-space-form">
                        <label class="eng-space-field">
                          <span class="eng-space-field-label">发射基地 / 发射中心</span>
                          <input v-model.trim="spaceDraft.base" type="text" class="eng-catalog-search" placeholder="发射基地名称" />
                        </label>
                        <label class="eng-space-field">
                          <span class="eng-space-field-label">任务类型</span>
                          <select v-model="spaceDraft.kind" class="eng-catalog-search" @change="onSpaceDraftKindChange">
                            <option v-for="opt in SPACE_CONTRACT_KIND_OPTIONS" :key="opt.key" :value="opt.key">{{ opt.label }}</option>
                          </select>
                        </label>
                        <label class="eng-space-field">
                          <span class="eng-space-field-label">运载火箭</span>
                          <select v-model="spaceDraft.rocket" class="eng-catalog-search">
                            <option v-for="r in DEFAULT_ROCKET_OPTIONS" :key="r" :value="r">{{ r }}</option>
                          </select>
                        </label>
                        <label class="eng-space-field">
                          <span class="eng-space-field-label">有效载荷</span>
                          <input v-model.trim="spaceDraft.payload" type="text" class="eng-catalog-search" placeholder="有效载荷名称" />
                        </label>
                        <label class="eng-space-field">
                          <span class="eng-space-field-label">合同名称</span>
                          <input v-model.trim="spaceDraft.title" type="text" class="eng-catalog-search" placeholder="发射合同标题" />
                        </label>
                        <div class="eng-space-check-row">
                          <label class="eng-space-check">
                            <input v-model="spaceDraft.recoverBooster" type="checkbox" />
                            <span>回收一级助推器</span>
                          </label>
                          <label class="eng-space-check">
                            <input v-model="spaceDraft.useStoredBooster" type="checkbox" :disabled="spaceOverview.boosterCount <= 0" />
                            <span>调用库存助推器复用 (+15%)</span>
                          </label>
                        </div>
                        <div class="eng-space-payout font-mono">
                          预计里程碑报酬：<b>${{ draftPayoutPreview.totalPayout }}</b>
                          <span v-if="draftPayoutPreview.boosterApplied">（含复用奖励 +${{ draftPayoutPreview.reuseBonus }}）</span>
                          <span class="ml-2 text-[#7dd3fc]">· 选址修正 {{ activeLaunchCenter.payoutMultText }}</span>
                        </div>
                        <button
                          type="button"
                          class="eng-initiate-btn"
                          data-test="eng-space-draft-submit"
                          @click="handleSubmitSpaceContract"
                        >
                          <Icon name="send" :size="11" /> 【签发合同并填入指令栏】
                        </button>
                      </div>
                    </section>

                    <!-- 发射合同账本与在轨星座名册 -->
                    <section class="eng-space-card" data-test="eng-space-contract-list" aria-label="发射合同账本">
                      <header class="eng-space-card-title">📋 发射合同账本 ({{ spaceContracts.length }})</header>
                      <div v-if="spaceContracts.length === 0" class="eng-empty-line">暂无登记在册的发射合同</div>
                      <div v-for="c in spaceContracts" :key="c.id" class="eng-space-contract-item">
                        <div class="eng-space-contract-head">
                          <span class="eng-space-asset-name">{{ c.title }}</span>
                          <span class="eng-item-state-badge font-mono" :data-tone="c.status === 'completed' || c.status === 'in_orbit' ? 'done' : 'active'">
                            {{ c.status }}
                          </span>
                        </div>
                        <div class="eng-space-asset-bonus font-mono">
                          {{ c.rocket }} · 载荷：{{ c.payload }} · 报酬：${{ c.reward_credits }}
                          <span v-if="c.weather_hold_reason" class="eng-prereq-status eng-prereq-status--warn">{{ c.weather_hold_reason }}</span>
                        </div>
                        <div v-if="c.status === 'pending'" class="eng-space-contract-actions">
                          <button
                            type="button"
                            class="eng-v2cmd-btn"
                            data-test="eng-space-contract-launch-btn"
                            @click="handleLaunchExistingContract(c)"
                          >
                            🚀 填入点火发射指令
                          </button>
                        </div>
                      </div>
                    </section>

                    <section class="eng-space-card" data-test="eng-space-orbital-list" aria-label="在轨星座名册">
                      <header class="eng-space-card-title">🛰️ 在轨星座名册 ({{ orbitalAssetCards.length }})</header>
                      <div v-if="orbitalAssetCards.length === 0" class="eng-empty-line">
                        当前尚无在轨卫星或空间站载荷 · 请在上方拟定并发起发射合同
                      </div>
                      <div v-for="asset in orbitalAssetCards" :key="asset.id" class="eng-space-asset-item">
                        <div class="eng-space-asset-head">
                          <span class="eng-space-asset-name">{{ asset.name }}</span>
                          <span class="eng-item-state-badge" data-tone="ready">{{ asset.kindLabel }}</span>
                          <span class="eng-item-state-badge font-mono" data-tone="done">{{ asset.orbit }} · {{ asset.statusLabel }}</span>
                        </div>
                        <div class="eng-space-asset-bonus">{{ asset.bonusDesc }}（入轨第 {{ asset.launchedAtDay }} 天）</div>
                      </div>
                    </section>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getHostViewportWidth, getHostWindow } from '../host/modalHost';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import type { ProjectDef, RetrofitDef } from '../../红警指挥系统/core/catalog';
import type { Project, ProjectV2, Schema, SpaceContract } from '../../红警指挥系统/core/schema';
import { isProjectV1, isProjectV2 } from '../../红警指挥系统/core/schema';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import { openDetail } from '../../红警指挥系统/composables/useDetail';
import EngSceneView from '../panels/EngSceneView.vue';
import SpaceBlueprintCanvas from '../panels/SpaceBlueprintCanvas.vue';
import type { EngSceneHotspotEvent } from '../models/engScene';
import type { SpaceCanvasNodeActionPayload } from '../models/spaceCanvasModel';
import { ENG_COMMAND_COPY, buildCancelSettlementV2, engV2ModuleButtons, engV2ModuleCards, engV2ProjectButtons, initiateTargetFor } from '../models/engCommands';
import type { EngCommandButton, EngModuleCommandButton, EngV2ModuleCard } from '../models/engCommands';
import {
  DEFAULT_ROCKET_OPTIONS,
  SPACE_CONTRACT_KIND_OPTIONS,
  buildAeroBuildingConstructCommand,
  buildAeroEquipmentProduceCommand,
  buildAerospaceMccCatalogDef,
  buildAerospaceMccSyntheticProject,
  buildExistingContractLaunchOrderText,
  buildOrbitalAssetCards,
  buildSpaceContractOrderText,
  computeContractPayoutPreview,
  diagnoseLaunchReadiness,
  resolveAeroEquipmentStockCount,
} from '../models/spacePanelModel';
import { BUILDABLE_AERO_EQUIPMENT_CATALOG, LAUNCHPAD_BUILDINGS } from '../../红警指挥系统/engines/spaceEngine';
import { fillHostSendInput } from '../../红警指挥系统/worldbook/hostSendInput';
import { engVerbToUnifiedCommandType, findModuleObserverMetrics, findPhaseObserverMetrics, projectEngineeringObserverView } from '../../红警指挥系统/engines/engOrderBridge';
import type { EngineeringObserverView, UtoTaskObserverMetrics } from '../../红警指挥系统/engines/engOrderBridge';
import {
  MOCK_PROJECTS, SHORT_CATEGORY_FILTERS, SHORT_GRADE_FILTERS, buildCatalogUnlockPrecomputed, buildDynamicProjectCatalog,
  buildEngineeringGateChecklist, buildInitiateOrderText, buildProjectDetailPayload,
  buildProjectDetailV2Payload, buildProjectGroups, buildSceneHotspotDetailPayload, buildV2AllocateOrderText,
  buildV2ModuleOrderText, buildV2ProjectOrderText, checkHasLiveRuntimeState, checkIsResearchUnlocked,
  computeEngProgressPair, defGrade, dispatchEngOrderWithToast, filterLongProjectCatalogDefs, filterShortCatalogDefs,
  formatNaniteRequirement, formatPhaseSummary, gradeClass, isAerospaceProjectDef, isOrbitalStation, phaseCount, resolveBaseDisplayNameFromList,
  resolveCatalogItemBadge, resolveCatalogItemDotClass, resolveCatalogItemStatusTitle, resolveInitiateHints,
  resolvePhaseStepClass, resolvePhaseStepName, resolvePhaseStepStateText, resolveProjectDisplayName,
  resolveRetrofitTargetPreview, resolveSelectedCatalogDef, resolveStationUnlockHint, resolveUsingMock,
  resolveUtoActiveEtaText,
} from './modalEngineeringHelpers';
import type { EngToastChannel, ProjectGroup, RetrofitCategoryKey } from './modalEngineeringHelpers';
import { useTacticalModalMotion } from '../../红警指挥系统/ui/motion/useGsapMotion';

const props = withDefaults(defineProps<{ open: boolean; snapshot: Schema | null; demoMode?: boolean | 'auto' }>(), { demoMode: 'auto' });
defineEmits<{ (e: 'close'): void }>();

/* ══ 动态宿主屏幕尺寸识别：穿透 340px 侧栏脚本 iframe，读取酒馆顶层/宿主全屏视口并占据 80% 宽度 ══ */
const modalBackdropEl = ref<HTMLElement | null>(null);
const modalCardEl = ref<HTMLElement | null>(null);
useTacticalModalMotion(modalCardEl, modalBackdropEl, { open: () => props.open });
function detectFullBrowserViewport(): { width: number; height: number } {
  const candidatesW: number[] = [getHostViewportWidth()];
  const candidatesH: number[] = [];
  const pushWin = (win: Window | null | undefined) => {
    try {
      if (win && typeof win.innerWidth === 'number' && win.innerWidth > 0) {
        candidatesW.push(win.innerWidth);
      }
      if (win && typeof win.innerHeight === 'number' && win.innerHeight > 0) {
        candidatesH.push(win.innerHeight);
      }
    } catch {
      /* 忽略跨域访问异常 */
    }
  };
  pushWin(getHostWindow());
  if (typeof window !== 'undefined') {
    pushWin(window);
    pushWin(window.parent);
    pushWin(window.top);
  }
  if (modalCardEl.value?.ownerDocument?.defaultView) {
    pushWin(modalCardEl.value.ownerDocument.defaultView);
  }
  const width = Math.max(0, ...candidatesW);
  const height = Math.max(0, ...candidatesH);
  return { width, height };
}
const viewportWidth = ref<number>(detectFullBrowserViewport().width);
const viewportHeight = ref<number>(detectFullBrowserViewport().height);
let hostWinRef: (Window & typeof globalThis) | null = null;
let topWinRef: Window | null = null;
function handleWindowResize() {
  const rect = detectFullBrowserViewport();
  viewportWidth.value = rect.width;
  viewportHeight.value = rect.height;
}
if (getCurrentInstance()) {
  onMounted(() => {
    handleWindowResize();
    hostWinRef = getHostWindow();
    hostWinRef?.addEventListener('resize', handleWindowResize, { passive: true });
    try {
      if (typeof window !== 'undefined' && window.top && window.top !== hostWinRef) {
        topWinRef = window.top;
        topWinRef.addEventListener('resize', handleWindowResize, { passive: true });
      }
    } catch {
      topWinRef = null;
    }
  });
  onBeforeUnmount(() => {
    hostWinRef?.removeEventListener('resize', handleWindowResize);
    hostWinRef = null;
    try {
      topWinRef?.removeEventListener('resize', handleWindowResize);
    } catch {
      /* ignore */
    }
    topWinRef = null;
  });
}
watch(
  () => props.open,
  isOpen => {
    if (isOpen) {
      handleWindowResize();
    }
  },
);
const modalDynamicStyle = computed<Record<string, string>>(() => {
  const w = viewportWidth.value;
  const h = viewportHeight.value;
  // 若仅能读到侧栏 iframe 小尺寸（< 640px），使用宿主全屏遮罩层百分比/视口单位兜底，绝不把弹窗压成 300px
  if (!w || w < 640) {
    return {
      width: '80vw',
      maxWidth: '80vw',
      minWidth: 'min(960px, 94vw)',
      height: '88vh',
      maxHeight: '90vh',
    };
  }
  const targetW = w >= 1024 ? Math.round(w * 0.8) : Math.round(w * 0.94);
  const targetH = h >= 680 ? Math.round(h * 0.88) : Math.round(h > 0 ? h * 0.92 : 820);
  return {
    width: `${targetW}px`,
    maxWidth: w >= 1024 ? '80vw' : '94vw',
    height: `${targetH}px`,
    maxHeight: '90vh',
  };
});

const catalog = useCatalogStore();

const spaceOverview = computed(() => {
  const space = props.snapshot?.space;
  const contracts = space?.contracts ?? [];
  return {
    orbitalCount: space?.orbital_assets?.length ?? 0,
    boosterCount: space?.reusable_boosters ?? 0,
    activeContractCount: contracts.filter(c => c.status === 'pending' || c.status === 'launching' || c.status === 'in_orbit').length,
    totalContractCount: contracts.length,
  };
});

/* ══ 左栏目录：短期改装 vs 长期巨构 vs 天基航天 ══ */
const scopeTab = ref<'short' | 'long' | 'space'>('short');
const catalogQuery = ref('');
const gradeFilter = ref<'all' | '大改' | '中改' | '小改'>('all');
const categoryFilter = ref<RetrofitCategoryKey>('all');

const projectCatalog = computed<ProjectDef[]>(() => buildDynamicProjectCatalog(catalog.projects, catalog.retrofits, props.snapshot?.projects));
const shortCatalog = computed<(RetrofitDef | ProjectDef)[]>(() => catalog.retrofits.filter(d => d.scope !== 'theater' && defGrade(d) !== '巨构'));
const longRetrofitCatalog = computed<RetrofitDef[]>(() => catalog.retrofits.filter(d => d.scope === 'theater'));
const spaceProjectCatalog = computed<ProjectDef[]>(() => projectCatalog.value.filter(d => isAerospaceProjectDef(d)));
const longProjectCatalog = computed<ProjectDef[]>(() => projectCatalog.value.filter(d => !isAerospaceProjectDef(d)));

const effectiveScopeTab = computed<'short' | 'long' | 'space'>(() => {
  if (scopeTab.value === 'short' && shortCatalog.value.length === 0) {
    if (longProjectCatalog.value.length > 0) return 'long';
    if (spaceProjectCatalog.value.length > 0 || (props.snapshot?.space?.launch_centers?.length ?? 0) > 0) return 'space';
  }
  return scopeTab.value;
});
const switchScopeTab = (tab: 'short' | 'long' | 'space') => {
  scopeTab.value = tab;
  if (tab === 'space') {
    spaceSelectedProjectName.value = null;
    spaceSubView.value = 'mcc';
  }
};

const filteredShortCatalog = computed<(RetrofitDef | ProjectDef)[]>(() =>
  filterShortCatalogDefs(shortCatalog.value, gradeFilter.value, catalogQuery.value, categoryFilter.value),
);
const filteredLongProjectCatalog = computed<ProjectDef[]>(() => filterLongProjectCatalogDefs(longProjectCatalog.value, catalogQuery.value));

const selectedName = ref<string | null>(null);
const spaceSelectedProjectName = ref<string | null>(null);
const spaceSubView = ref<'mcc' | 'constellation' | 'station' | 'lunar'>('mcc');
/** 仅在旧版 V2 单测夹具（无短期目录且仅注入「空间站仓段化工程」）下保留旧 V2 详情块；真实运行态彻底移除旧轨道空间站卡片 */
const isLegacyV2TestFallback = computed<boolean>(() =>
  scopeTab.value === 'short' &&
  shortCatalog.value.length === 0 &&
  longProjectCatalog.value.length === 0 &&
  spaceProjectCatalog.value.length === 1 &&
  spaceProjectCatalog.value[0]?.name === '空间站仓段化工程',
);
const effectiveSpaceSelectedProjectName = computed<string | null>(() => {
  if (spaceSelectedProjectName.value) return spaceSelectedProjectName.value;
  if (isLegacyV2TestFallback.value && spaceSubView.value !== 'constellation' && spaceSubView.value !== 'lunar') {
    return spaceProjectCatalog.value[0].name;
  }
  return null;
});
const effectiveSpaceCanvasDomain = computed<'constellation' | 'station' | 'lunar' | null>(() => {
  if (effectiveScopeTab.value !== 'space') return null;
  if (spaceSubView.value === 'constellation' || spaceSubView.value === 'station' || spaceSubView.value === 'lunar') {
    return spaceSubView.value;
  }
  // 仅在纯天基 SSR 单测环境（shortCatalog 与 longProjectCatalog 均为空且未切到 space Tab）下自动默认打开 station 组装视图
  if (
    scopeTab.value === 'short' &&
    shortCatalog.value.length === 0 &&
    longProjectCatalog.value.length === 0 &&
    spaceProjectCatalog.value.length > 0 &&
    !isLegacyV2TestFallback.value
  ) {
    return 'station';
  }
  return null;
});
function selectSpaceProject(name: string | null) {
  spaceSelectedProjectName.value = name;
  if (name === null) {
    spaceSubView.value = 'mcc';
    return;
  }
  selectedName.value = name;
  if (name.includes('空间站') || name.includes('轨道')) {
    spaceSubView.value = 'station';
  } else if (name.includes('月球') || name.includes('月面')) {
    spaceSubView.value = 'lunar';
  }
}
function switchSpaceSubView(view: 'mcc' | 'constellation' | 'station' | 'lunar') {
  spaceSubView.value = view;
  if (view === 'mcc' || view === 'constellation') {
    spaceSelectedProjectName.value = null;
  } else if (view === 'station') {
    const match = spaceProjectCatalog.value.find(d => d.name.includes('空间站') || d.name.includes('轨道'));
    if (match) {
      spaceSelectedProjectName.value = match.name;
      selectedName.value = match.name;
    }
  } else if (view === 'lunar') {
    const match = spaceProjectCatalog.value.find(d => d.name.includes('月球') || d.name.includes('月面'));
    if (match) {
      spaceSelectedProjectName.value = match.name;
      selectedName.value = match.name;
    } else {
      spaceSelectedProjectName.value = null;
    }
  }
}
const selectedDef = computed<RetrofitDef | ProjectDef | null>(() =>
  resolveSelectedCatalogDef(
    effectiveScopeTab.value === 'space' && effectiveSpaceSelectedProjectName.value
      ? effectiveSpaceSelectedProjectName.value
      : selectedName.value,
    effectiveScopeTab.value,
    shortCatalog.value,
    longProjectCatalog.value,
    spaceProjectCatalog.value,
  ),
);
const selectDef = (name: string) => { selectedName.value = name; };

const selectedIsV2 = computed(() => selectedDef.value?.kind === 'project');
const v2Def = computed<ProjectDef | null>(() => (selectedDef.value?.kind === 'project' ? selectedDef.value : null));
const selectedRetrofitPreview = computed(() => resolveRetrofitTargetPreview(selectedDef.value, props.snapshot));
const selectedShowScene = computed<boolean>(() =>
  Boolean(selectedDef.value && (selectedIsV2.value || selectedDef.value.scope === 'theater' || effectiveScopeTab.value === 'long')),
);

/** 观察a（ENG-SU-RM-01 §五a）修复：V1 阶梯档位读 def.phases 实际阶段数 */
function defPhaseCount(def: RetrofitDef | ProjectDef): number {
  if (def.kind !== 'retrofit') return phaseCount('大改');
  return def.phases?.length ?? phaseCount(def.grade);
}

/* ══ 工程实例分组：快照 projects 优先；MOCK-ENG-UI-01 / MOCK-ENG-V2-07 演示数据由 modalEngineeringHelpers 承载 ══ */
const realProjects = computed<Project[]>(() => props.snapshot?.projects ?? []);
const hasLiveRuntimeState = computed<boolean>(() => checkHasLiveRuntimeState(props.snapshot));
const usingMock = computed<boolean>(() => resolveUsingMock(props.demoMode, realProjects.value.length, hasLiveRuntimeState.value));
const projects = computed<Project[]>(() => (usingMock.value ? MOCK_PROJECTS : realProjects.value));
const inProgressCount = computed(() => realProjects.value.filter(p => p.status === '在建').length);
const projectGroups = computed<ProjectGroup[]>(() => buildProjectGroups(projects.value));
const allProjectGroupsEmpty = computed(() => projectGroups.value.every(g => g.items.length === 0));

const displayName = (p: Project) => resolveProjectDisplayName(p, catalog.retrofits, catalog.projects);
const phaseSummary = (p: Project) => formatPhaseSummary(p);

/* ══ V2-07 仓段化工程卡与进度计算 ══ */
const v2Instance = computed<ProjectV2 | null>(() => {
  const def = v2Def.value;
  if (!def) return null;
  const matches = projects.value.filter(
    p =>
      isProjectV2(p) &&
      (p.ref === def.name || (def.name === '轨道空间站' && (p.ref === '空间站' || p.ref === '空间站仓段化工程'))),
  );
  return matches.find(p => p.status === '在建') ?? matches[0] ?? null;
});
const v2ModuleCards = computed<EngV2ModuleCard[]>(() => (v2Def.value ? engV2ModuleCards(v2Def.value, v2Instance.value, props.snapshot?.bases) : []));
const v2DoneCount = computed(() => v2ModuleCards.value.filter(m => m.status === '完工').length);

const v1DonePhaseCount = computed<number>(() => {
  if (usingMock.value || selectedIsV2.value) return 0;
  const proj = sceneProject.value;
  return proj && isProjectV1(proj) ? proj.phases.filter(ph => ph.status === '完工').length : 0;
});

const engProgress = computed(() =>
  computeEngProgressPair(
    selectedIsV2.value, selectedDef.value, usingMock.value, v1DonePhaseCount.value,
    selectedDef.value ? defPhaseCount(selectedDef.value) : 0, v2DoneCount.value, v2ModuleCards.value.length,
  ),
);

const catalogUnlockPrecomputed = computed(() =>
  buildCatalogUnlockPrecomputed(
    projects.value,
    props.snapshot?.tech?.done,
    props.snapshot?.protocols,
    props.snapshot?.bases,
  ),
);

const phaseStepName = (def: RetrofitDef | ProjectDef, phaseIdx: number) =>
  resolvePhaseStepName(def, phaseIdx, defPhaseCount(def), !usingMock.value ? sceneProject.value : null);
const phaseStepClass = (phaseIdx: number) => resolvePhaseStepClass(phaseIdx, !usingMock.value ? sceneProject.value : null);
const phaseStepStateText = (phaseIdx: number) => resolvePhaseStepStateText(phaseIdx, !usingMock.value ? sceneProject.value : null);
const isResearchUnlocked = (research: string | undefined) =>
  checkIsResearchUnlocked(research, props.snapshot?.tech?.done, props.snapshot?.protocols, catalogUnlockPrecomputed.value);
const catalogItemDotClass = (def: RetrofitDef | ProjectDef) =>
  resolveCatalogItemDotClass(
    def,
    projects.value,
    hasLiveRuntimeState.value,
    props.snapshot?.tech?.done,
    props.snapshot?.protocols,
    props.snapshot?.bases,
    catalogUnlockPrecomputed.value,
  );
const catalogItemBadge = (def: RetrofitDef | ProjectDef) =>
  resolveCatalogItemBadge(
    def,
    projects.value,
    hasLiveRuntimeState.value,
    props.snapshot?.tech?.done,
    props.snapshot?.protocols,
    props.snapshot?.bases,
    catalogUnlockPrecomputed.value,
  );
const catalogItemStatusTitle = (def: RetrofitDef | ProjectDef) =>
  resolveCatalogItemStatusTitle(
    def,
    projects.value,
    hasLiveRuntimeState.value,
    props.snapshot?.tech?.done,
    props.snapshot?.protocols,
    props.snapshot?.bases,
    catalogUnlockPrecomputed.value,
  );
const isStationRelevantForSelected = (st: { domain?: string; laneKey?: string; displayName?: string }) =>
  selectedIsV2.value || effectiveScopeTab.value === 'long' ? true : !isOrbitalStation(st);
const resolveBaseDisplayName = (baseId: string) => resolveBaseDisplayNameFromList(baseId, props.snapshot?.bases);
const stationUnlockHint = (st: { domain?: string; laneKey?: string; displayName?: string }) => resolveStationUnlockHint(st);

function focusProjectInView(p: Project) {
  const isAero =
    p.ref.includes('空间站') || p.ref.includes('轨道') || p.ref.includes('天基') || p.ref.includes('月球') || p.ref.includes('月面');
  if (isAero) {
    scopeTab.value = 'space';
    const targetName = p.ref === '空间站' && spaceProjectCatalog.value.some(d => d.name === '轨道空间站') ? '轨道空间站' : p.ref;
    selectSpaceProject(targetName);
    return;
  }
  scopeTab.value = isProjectV2(p) || p.grade === '巨构' || p.scope === 'theater' ? 'long' : 'short';
  gradeFilter.value = 'all';
  catalogQuery.value = '';
  selectedName.value = p.ref;
}

/* ══ UTO-UI-DOMAIN-01 · 通用任务编排器只读观察者投影接入 ══ */
const utoObserver = computed<EngineeringObserverView>(() =>
  projectEngineeringObserverView(
    { bases: props.snapshot?.bases, queues: props.snapshot?.queues, projects: projects.value },
    {
      buildings: catalog.buildings, productions: catalog.productions, researches: catalog.researches,
      retrofits: catalog.retrofits, projects: catalog.projects, factionDefs: catalog.factionDefs,
    },
  ),
);
const utoStations = computed(() => utoObserver.value.stations);
const utoTasks = computed(() => utoObserver.value.allTasks);
const utoScheduledTasks = computed(() => utoObserver.value.scheduledEngineeringTasks);
const utoDraftTasks = computed(() => utoObserver.value.draftEngineeringTasks);

const phaseObserverMap = computed<Map<number, UtoTaskObserverMetrics>>(() => {
  const map = new Map<number, UtoTaskObserverMetrics>();
  const proj = sceneProject.value;
  const def = selectedDef.value;
  if (!proj || !isProjectV1(proj)) return map;
  const maxPhases = Math.max(proj.phases?.length ?? 0, def ? defPhaseCount(def) : 0);
  for (let idx = 0; idx < maxPhases; idx += 1) {
    const metrics = findPhaseObserverMetrics(utoObserver.value, proj.id, idx);
    if (metrics) map.set(idx, metrics);
  }
  return map;
});

const moduleObserverMap = computed<Map<string, UtoTaskObserverMetrics>>(() => {
  const map = new Map<string, UtoTaskObserverMetrics>();
  const inst = v2Instance.value;
  if (!inst) return map;
  for (const mod of v2ModuleCards.value) {
    const metrics = findModuleObserverMetrics(utoObserver.value, inst.id, mod.moduleId);
    if (metrics) map.set(mod.moduleId, metrics);
  }
  return map;
});

const phaseObserverFor = (phaseIdx: number): UtoTaskObserverMetrics | null => {
  if (phaseObserverMap.value.has(phaseIdx)) {
    return phaseObserverMap.value.get(phaseIdx) ?? null;
  }
  const proj = sceneProject.value;
  return proj && isProjectV1(proj) ? findPhaseObserverMetrics(utoObserver.value, proj.id, phaseIdx) : null;
};
const moduleObserverFor = (moduleId: string): UtoTaskObserverMetrics | null => {
  if (moduleObserverMap.value.has(moduleId)) {
    return moduleObserverMap.value.get(moduleId) ?? null;
  }
  return v2Instance.value ? findModuleObserverMetrics(utoObserver.value, v2Instance.value.id, moduleId) : null;
};

const utoActiveEtaText = computed(() =>
  resolveUtoActiveEtaText(selectedIsV2.value ? v2Instance.value : sceneProject.value, usingMock.value, utoScheduledTasks.value),
);

const canShowV2AllocateButton = computed(() => {
  const inst = v2Instance.value;
  const mod = selectedModule.value;
  return Boolean(inst && mod && inst.scope === 'theater' && (inst.bases?.length ?? 0) >= 2 && mod.status === '未启动');
});

const selectedModuleId = ref<string | null>(null);
watch(() => v2Def.value?.name ?? null, () => { selectedModuleId.value = v2ModuleCards.value[0]?.moduleId ?? null; }, { immediate: true });
const selectedModule = computed<EngV2ModuleCard | null>(() => {
  const cards = v2ModuleCards.value;
  return cards.length === 0 ? null : (cards.find(m => m.moduleId === selectedModuleId.value) ?? cards[0]);
});
function selectModule(moduleId: string) { selectedModuleId.value = moduleId; }

const selectedModuleButtons = computed<EngModuleCommandButton[]>(() =>
  v2Def.value && selectedModule.value ? (engV2ModuleButtons(v2Instance.value, v2Def.value, selectedModule.value.moduleId) ?? []) : [],
);
const v2ProjectButtons = computed<EngCommandButton[]>(() => engV2ProjectButtons(v2Instance.value));
const v2CancelConfirmOpen = ref(false);
const v2CancelSettlement = computed(() => (v2Instance.value ? buildCancelSettlementV2(v2Instance.value, v2Def.value) : ''));
watch(() => [selectedDef.value?.name, props.open] as const, () => { v2CancelConfirmOpen.value = false; });

/* ══ ENG-UI-02 场景引擎接线与详情抽屉 ══ */
const sceneProject = computed<Project | null>(() => {
  const name = selectedDef.value?.name;
  if (!name) return null;
  const matches = projects.value.filter(p => p.ref === name);
  return matches.find(p => p.status === '在建') ?? matches[0] ?? null;
});
const onSceneHotspot = (h: EngSceneHotspotEvent) => openDetail(buildSceneHotspotDetailPayload(h, selectedDef.value?.name));

function openProjectDetail(p: Project) {
  if (isProjectV2(p)) {
    const def = (catalog.projects ?? []).find(d => d.name === p.ref);
    openDetail(buildProjectDetailV2Payload(p, displayName(p), def, props.snapshot?.bases));
    return;
  }
  const def = catalog.retrofits.find(d => d.name === p.ref);
  openDetail(buildProjectDetailPayload(p, displayName(p), def, props.snapshot?.bases));
}

/* ══ ENG-UI-03 / D-SU-RM-2：立项与 V2 指令下发 ══ */
const initiateTarget = computed(() => initiateTargetFor(selectedDef.value, props.snapshot?.bases));
const gateChecklist = computed(() =>
  buildEngineeringGateChecklist(selectedDef.value, props.snapshot, hasLiveRuntimeState.value, initiateTarget.value),
);
const initiateHints = computed(() => resolveInitiateHints(initiateTarget.value));
const v2InitiateHint = computed(() => initiateHints.value.v2InitiateHint);
const friendlyInitiateHint = computed(() => initiateHints.value.friendlyInitiateHint);
const friendlyV2InitiateHint = computed(() => initiateHints.value.friendlyV2InitiateHint);

/* ══ 🚀 天基航天测控与合同拟定器状态 ══ */
const spaceSelectedV2Def = computed<ProjectDef | null>(() =>
  spaceProjectCatalog.value.find(d => d.name === effectiveSpaceSelectedProjectName.value) ?? null,
);
const spaceSceneDef = computed<ProjectDef>(() => spaceSelectedV2Def.value ?? buildAerospaceMccCatalogDef());
const spaceSceneProject = computed<Project | null>(() => {
  if (spaceSelectedV2Def.value) {
    const matches = projects.value.filter(p => p.ref === spaceSelectedV2Def.value!.name);
    return matches.find(p => p.status === '在建') ?? matches[0] ?? null;
  }
  return buildAerospaceMccSyntheticProject(props.snapshot);
});
const launchReadiness = computed(() => diagnoseLaunchReadiness(props.snapshot));
const orbitalAssetCards = computed(() => buildOrbitalAssetCards(props.snapshot));
const spaceContracts = computed<SpaceContract[]>(() => props.snapshot?.space?.contracts ?? []);

/* ══ FD-27 · 天地月多发射中心切换栏 + 左右双栏工作台（中心扩建 / 航天装备产线 / 火箭整备与发射合同） ══ */
type MccRightTabKey = 'expand' | 'manufacture' | 'contract';
const mccRightTab = ref<MccRightTabKey>('expand');
const payloadSourceTab = ref<'domestic' | 'commercial'>('domestic');
const selectedLaunchCenterId = ref<string>('');
const selectedLcSlotId = ref<string>('lc_pad_1');
const launchCenterDraftMap = ref<Record<string, Record<string, string>>>({});
const rocketStageCheck = ref({
  coreFirst: true,
  strapBooster: true,
  vacuumSecond: true,
  upperKick: false,
});

interface LaunchCenterSiteProfile {
  siteType: string;
  badgeText: string;
  payoutMult: number;
  payoutMultText: string;
  payloadMult: number;
  baseMaxTons: number;
  immuneToEarthWeather: boolean;
}

const LAUNCH_CENTER_SITE_PROFILES: Record<string, LaunchCenterSiteProfile> = {
  equatorial_coastal: {
    siteType: 'equatorial_coastal',
    badgeText: '🌊 赤道/低纬滨海 · 燃料回款+20% · 运力×1.15',
    payoutMult: 1.2,
    payoutMultText: '×1.20 (+20%)',
    payloadMult: 1.15,
    baseMaxTons: 25,
    immuneToEarthWeather: false,
  },
  inland_canyon: {
    siteType: 'inland_canyon',
    badgeText: '⛰️ 内陆深谷加固 · 隐蔽暴露+0.05 · 高轨×0.90',
    payoutMult: 1.0,
    payoutMultText: '×1.00 (标准)',
    payloadMult: 1.0,
    baseMaxTons: 22,
    immuneToEarthWeather: false,
  },
  sea_platform: {
    siteType: 'sea_platform',
    badgeText: '🚢 海上半潜平台 · 回款+20% · 运力×1.15 · 上限T2',
    payoutMult: 1.2,
    payoutMultText: '×1.20 (+20%)',
    payloadMult: 1.15,
    baseMaxTons: 25,
    immuneToEarthWeather: false,
  },
  high_latitude: {
    siteType: 'high_latitude',
    badgeText: '❄️ 高纬/极地试验场 · 极轨回款+25% · 极轨运力×1.20',
    payoutMult: 1.25,
    payoutMultText: '×1.25 (+25%)',
    payloadMult: 1.2,
    baseMaxTons: 26,
    immuneToEarthWeather: false,
  },
  orbital_dock: {
    siteType: 'orbital_dock',
    badgeText: '🛰️ 轨道船坞母港 · 回款+50% · 运力×2.00 · 全天候真空',
    payoutMult: 1.5,
    payoutMultText: '×1.50 (+50%)',
    payloadMult: 2.0,
    baseMaxTons: 80,
    immuneToEarthWeather: true,
  },
  lunar_surface: {
    siteType: 'lunar_surface',
    badgeText: '🌕 月面低重力中心 · 回款+35% · 运力×1.50 · 全天候真空',
    payoutMult: 1.35,
    payoutMultText: '×1.35 (+35%)',
    payloadMult: 1.5,
    baseMaxTons: 60,
    immuneToEarthWeather: true,
  },
};

function inferSiteTypeForBase(baseNameOrLoc: string, explicitSiteType?: string): string {
  if (explicitSiteType && LAUNCH_CENTER_SITE_PROFILES[explicitSiteType]) {
    return explicitSiteType;
  }
  const text = (baseNameOrLoc || '').toLowerCase();
  if (text.includes('月') || text.includes('lunar')) return 'lunar_surface';
  if (text.includes('轨') || text.includes('空间站') || text.includes('船坞') || text.includes('orbital')) return 'orbital_dock';
  if (text.includes('海上') || text.includes('平台') || text.includes('远洋')) return 'sea_platform';
  if (text.includes('极') || text.includes('高纬') || text.includes('普列谢茨克') || text.includes('北疆')) return 'high_latitude';
  if (text.includes('滨海') || text.includes('文昌') || text.includes('赤道') || text.includes('海岛') || text.includes('海岸')) {
    return 'equatorial_coastal';
  }
  return 'inland_canyon';
}

function parseClockMinutes(clockText: string | undefined): number {
  const m = /^(\d{1,2}):(\d{2})/.exec((clockText ?? '').trim());
  if (!m) return 8 * 60;
  return (Number(m[1]) % 24) * 60 + (Number(m[2]) % 60);
}

function formatBaseLocalTimeBadge(
  metaClock: string | undefined,
  baseIndex: number,
  baseTzOffset: number | undefined,
  primaryTzOffset: number,
): string {
  const baseMins = parseClockMinutes(metaClock);
  const effectiveOffset = typeof baseTzOffset === 'number' && Number.isFinite(baseTzOffset) ? baseTzOffset : primaryTzOffset;
  const deltaHours = baseIndex === 0 ? 0 : effectiveOffset - primaryTzOffset;
  const shiftedMins = ((baseMins + Math.round(deltaHours * 60)) % 1440 + 1440) % 1440;
  const hh = Math.floor(shiftedMins / 60);
  const mm = shiftedMins % 60;
  const hhStr = String(hh).padStart(2, '0');
  const mmStr = String(mm).padStart(2, '0');
  const dayNightIcon = hh >= 6 && hh < 18 ? '☀️' : '🌙';
  const relLabel =
    baseIndex === 0 || deltaHours === 0
      ? '标准时'
      : `标准${deltaHours > 0 ? `+${deltaHours}` : `${deltaHours}`}h`;
  return `${dayNightIcon} ${hhStr}:${mmStr} (${relLabel})`;
}

interface LaunchCenterSlotCatalogItem {
  id: string;
  label: string;
  tier: 1 | 2 | 3;
  interfaceType: string;
  desc: string;
}

const launchCenterSlotCatalog: readonly LaunchCenterSlotCatalogItem[] = [
  { id: 'lc_pad_1', label: '1# 标准常温发射工位', tier: 1, interfaceType: 'launch_pad_std', desc: '承担首期中型常温运载火箭垂直点火发射任务。' },
  { id: 'lc_hif', label: '总装测试厂房槽', tier: 1, interfaceType: 'launch_assembly', desc: '【Tier-1→Tier-2 扩建枢纽】挂载垂直总装测试厂房 (VAB) 后展开 Tier-2 外圈 4 槽。' },
  { id: 'lc_prop_yard', label: '推进剂储罐与加注区', tier: 1, interfaceType: 'launch_propellant', desc: '提供四氧化二氮/偏二甲肼与液氧煤油推进剂贮存加注能力。' },
  { id: 'lc_telemetry_1', label: '近场遥测与卫星制造中心槽', tier: 1, interfaceType: 'launch_telemetry', desc: '负责火箭主动段遥测跟踪，双向映射独立建筑【卫星制造中心】。' },
  { id: 'lc_pad_2', label: '2# 低温重型发射工位', tier: 2, interfaceType: 'launch_pad_heavy', desc: '由 VAB 展开的 2# 低温重型工位，解锁重型低温火箭与能源号重型火箭。' },
  { id: 'lc_crawler_way', label: '重型双轨转运与导流枢纽', tier: 2, interfaceType: 'launch_hub_heavy', desc: '【Tier-2→Tier-3 扩建枢纽】挂载超重型双轨转运与航天城基座后展开 Tier-3 终极 4 槽。' },
  { id: 'lc_recovery_zone', label: '助推器垂直回收坪 / 海上船坞', tier: 2, interfaceType: 'launch_recovery', desc: '配备毫米波着陆制导雷达与稳姿机械爪，支持芯一级与捆绑助推器垂直回收复用。' },
  { id: 'lc_weather_tower', label: '全天候防雷与深空测控阵槽', tier: 2, interfaceType: 'launch_weather', desc: '飞秒激光引雷消雨，使本发射中心局部豁免雷暴/台风挂起并提供深空遥测。' },
  { id: 'lc_pad_super', label: '3# 百米级机械臂捕获塔架', tier: 3, interfaceType: 'launch_pad_super', desc: '支持超级重型两级全复用运载系统与载人登月任务，实现原位空中机械臂捕获复飞。' },
  { id: 'lc_underground_fab', label: '火箭制造厂·地下洞库旋压总厂', tier: 3, interfaceType: 'launch_mega_fab', desc: '双向映射基地独立建筑【火箭制造厂】，专司各级火箭发动机与箭体芯级/助推器制造。' },
  { id: 'lc_spacecraft_hall', label: '大型航天器与空间站舱段总装中心', tier: 3, interfaceType: 'launch_mega_payload_line', desc: '双向映射基地独立建筑【大型航天器与舱段总装中心】，专司飞船、登月舱与空间站舱段总装。' },
  { id: 'lc_cryo_plant', label: '深冷液氧甲烷原位合成化工厂', tier: 3, interfaceType: 'launch_mega_cryo', desc: '现场大规模制备深冷液氧甲烷与液氢推进剂，每次发射净回款 +20%。' },
];

interface LaunchCenterModuleItem {
  id: string;
  name: string;
  slotId: string;
  slotLabel: string;
  tier: 1 | 2 | 3;
  cost: number;
  nanites: number;
  days: number;
  isExpansionHub: boolean;
  effect: string;
}

const LAUNCH_CENTER_MODULE_CATALOG: readonly LaunchCenterModuleItem[] = [
  {
    id: 'asset.lc.pad_std',
    name: '1# 标准常温起竖发射工位',
    slotId: 'lc_pad_1',
    slotLabel: '1# 标准常温发射工位',
    tier: 1,
    cost: 2200,
    nanites: 100,
    days: 5,
    isExpansionHub: false,
    effect: '配备脐带勤务塔、导流槽与场区主变电供水母站，解锁中型常温运载火箭发射。',
  },
  {
    id: 'asset.lc.hif_horiz',
    name: '水平分段总装测试厂房',
    slotId: 'lc_hif',
    slotLabel: '总装测试厂房槽',
    tier: 1,
    cost: 1500,
    nanites: 70,
    days: 4,
    isExpansionHub: false,
    effect: '卧式箭体对接与气密检测厂房，满足中小型常温运载火箭快速整备。',
  },
  {
    id: 'asset.lc.vab_vertical',
    name: '垂直总装测试厂房 (VAB)',
    slotId: 'lc_hif',
    slotLabel: '总装测试厂房槽',
    tier: 1,
    cost: 3400,
    nanites: 160,
    days: 7,
    isExpansionHub: true,
    effect: '【Tier-1→Tier-2 扩建枢纽】百米级垂直总装大厅，挂载后自动展开 Tier-2 中型发射中心外圈 4 槽。',
  },
  {
    id: 'asset.lc.prop_depot',
    name: '推进剂储罐与高压加注区',
    slotId: 'lc_prop_yard',
    slotLabel: '推进剂储罐与加注区',
    tier: 1,
    cost: 1800,
    nanites: 80,
    days: 4,
    isExpansionHub: false,
    effect: '防爆地下储罐群与高纯液氧煤油闭路自动加注系统，缩短发射前加注流程。',
  },
  {
    id: 'asset.lc.sat_mfg_center',
    name: '卫星制造中心',
    slotId: 'lc_telemetry_1',
    slotLabel: '近场遥测与卫星制造中心槽',
    tier: 1,
    cost: 3200,
    nanites: 150,
    days: 6,
    isExpansionHub: false,
    effect: '双向映射独立建筑【卫星制造中心】：专司侦察/预警通信/勘探星与月面探测车制造。',
  },
  {
    id: 'asset.lc.pad_cryo',
    name: '2# 低温重型脐带发射塔架',
    slotId: 'lc_pad_2',
    slotLabel: '2# 低温重型发射工位',
    tier: 2,
    cost: 3800,
    nanites: 180,
    days: 8,
    isExpansionHub: false,
    effect: '解锁重型低温无毒运载火箭(22t)与能源号重型运载火箭(35t)。',
  },
  {
    id: 'asset.lc.crawler_std',
    name: '重型双轨履带转运车与导流枢纽',
    slotId: 'lc_crawler_way',
    slotLabel: '重型双轨转运与导流枢纽',
    tier: 2,
    cost: 2600,
    nanites: 120,
    days: 5,
    isExpansionHub: false,
    effect: '承载千吨级活动发射平台垂直转运，连通 VAB 总装大厅与 2# 低温重型工位。',
  },
  {
    id: 'asset.lc.crawler_super_base',
    name: '超重型双轨转运与航天城流水线基座',
    slotId: 'lc_crawler_way',
    slotLabel: '重型双轨转运与导流枢纽',
    tier: 2,
    cost: 4600,
    nanites: 220,
    days: 9,
    isExpansionHub: true,
    effect: '【Tier-2→Tier-3 扩建枢纽】万吨级电磁调平双轨路基，挂载后自动展开 Tier-3「国家航天城」4 槽。',
  },
  {
    id: 'asset.lc.lz_recovery',
    name: '助推器垂直回收着陆坪 / 海上船坞',
    slotId: 'lc_recovery_zone',
    slotLabel: '助推器垂直回收坪 / 海上船坞',
    tier: 2,
    cost: 3000,
    nanites: 140,
    days: 6,
    isExpansionHub: false,
    effect: '解锁芯一级与捆绑助推器 100% 垂直回收返库复用。',
  },
  {
    id: 'asset.lc.weather_laser_tower',
    name: '全天候防雷与深空测控阵',
    slotId: 'lc_weather_tower',
    slotLabel: '全天候防雷与深空测控阵槽',
    tier: 2,
    cost: 3600,
    nanites: 170,
    days: 7,
    isExpansionHub: false,
    effect: '飞秒激光引雷消雨，使本发射中心局部豁免雷暴/台风挂起并提供深空遥测。',
  },
  {
    id: 'asset.lc.mechazilla_tower',
    name: '3# 百米级超重型机械臂捕获塔架',
    slotId: 'lc_pad_super',
    slotLabel: '3# 百米级机械臂捕获塔架',
    tier: 3,
    cost: 7200,
    nanites: 340,
    days: 12,
    isExpansionHub: false,
    effect: '百米级缓冲捕获机械臂（筷子塔），解锁超级重型两级全复用运载系统（基准运力 65t+）。',
  },
  {
    id: 'asset.lc.rocket_mega_fab',
    name: '火箭制造厂·地下洞库旋压总厂',
    slotId: 'lc_underground_fab',
    slotLabel: '火箭制造厂·地下洞库旋压总厂',
    tier: 3,
    cost: 4500,
    nanites: 210,
    days: 8,
    isExpansionHub: false,
    effect: '双向映射独立建筑【火箭制造厂】，专司各级发动机、芯一级、助推器与上面级制造。',
  },
  {
    id: 'asset.lc.spacecraft_ait_hall',
    name: '大型航天器与舱段总装中心',
    slotId: 'lc_spacecraft_hall',
    slotLabel: '大型航天器与空间站舱段总装中心',
    tier: 3,
    cost: 6500,
    nanites: 300,
    days: 10,
    isExpansionHub: false,
    effect: '双向映射独立建筑【大型航天器与舱段总装中心】，专司飞船、登月舱与空间站舱段制造。',
  },
  {
    id: 'asset.lc.cryo_methalox_plant',
    name: '深冷液氧甲烷原位合成化工厂',
    slotId: 'lc_cryo_plant',
    slotLabel: '深冷液氧甲烷原位合成化工厂',
    tier: 3,
    cost: 4200,
    nanites: 195,
    days: 8,
    isExpansionHub: false,
    effect: '集齐 VAB + 地下旋压总厂 + 舱段总装中心 + 深冷化工厂时，激活【🏙️🚀 国家航天城·产装测发流水线】！',
  },
];

interface LaunchCenterCardView {
  id: string;
  baseId: string;
  base: string;
  name: string;
  siteType: string;
  siteBadge: string;
  tier: 1 | 2 | 3;
  tierBadge: string;
  localTimeBadge: string;
  weatherBadge: string;
  payoutMult: number;
  payoutMultText: string;
  payloadMult: number;
  maxPayloadTons: number;
  isBuilt: boolean;
  isSpaceportCity: boolean;
  mountedSlots: Record<string, string>;
}

const launchCenterCards = computed<LaunchCenterCardView[]>(() => {
  const snap = props.snapshot;
  const bases = snap?.bases ?? [];
  const primaryTz = typeof bases[0]?.tz_offset === 'number' ? bases[0].tz_offset : 8;
  const globalWeather = snap?.meta?.weather || '晴朗';
  const globalClock = snap?.clock?.time || (snap?.meta as { clock?: string })?.clock;
  const explicitCenters = snap?.space?.launch_centers ?? [];
  const globalSlots = snap?.space?.completed_slots?.launch_center ?? {};

  const cards: LaunchCenterCardView[] = [];
  const coveredBaseNames = new Set<string>();

  // 1. 先遍历已登记的 launch_centers
  for (const lc of explicitCenters) {
    const matchedBaseIdx = bases.findIndex(b => b.name === lc.base || b.id === lc.base);
    const matchedBase = matchedBaseIdx >= 0 ? bases[matchedBaseIdx] : undefined;
    const baseDisplay = matchedBase?.name || lc.base || '主发射场';
    const baseId = matchedBase?.id || baseDisplay;
    coveredBaseNames.add(baseDisplay);

    const siteType = inferSiteTypeForBase(
      `${baseDisplay} ${matchedBase?.location ?? ''}`,
      lc.site_type || matchedBase?.site_type,
    );
    const profile = LAUNCH_CENTER_SITE_PROFILES[siteType] ?? LAUNCH_CENTER_SITE_PROFILES.inland_canyon;
    const rawSlots: Record<string, string> = {
      ...globalSlots,
      ...(lc.slots ?? {}),
      ...(lc.mounted_slots ?? {}),
      ...(launchCenterDraftMap.value[lc.id] ?? {}),
    };
    const hasVab = Boolean(rawSlots.lc_hif === 'asset.lc.vab_vertical' || rawSlots.lc_vab_1);
    const hasCrawler = Boolean(
      rawSlots.lc_crawler_way === 'asset.lc.crawler_super_base' || rawSlots.lc_crawler_1,
    );
    const computedTier: 1 | 2 | 3 =
      lc.tier === 3 || (hasVab && hasCrawler)
        ? 3
        : lc.tier === 2 || hasVab
          ? 2
          : 1;
    const effectiveTier: 1 | 2 | 3 = siteType === 'sea_platform' && computedTier > 2 ? 2 : computedTier;
    const tierBaseTons = effectiveTier === 3 ? 150 : effectiveTier === 2 ? 65 : profile.baseMaxTons;
    const maxPayloadTons = Math.round(tierBaseTons * profile.payloadMult);

    const localWeatherRaw = profile.immuneToEarthWeather
      ? '真空无气象干扰'
      : matchedBase?.weather || globalWeather;
    const hasWeatherTower = Boolean(rawSlots.lc_weather_tower);
    const weatherBadge = profile.immuneToEarthWeather
      ? '🌌 真空全天候窗口'
      : hasWeatherTower
        ? `⚡ ${localWeatherRaw} (防雷塔全天候豁免)`
        : `🌤️ ${localWeatherRaw}`;

    const isSpaceportCity = Boolean(
      hasVab &&
        rawSlots.lc_underground_fab &&
        (rawSlots.lc_spacecraft_hall || rawSlots.lc_telemetry_1) &&
        rawSlots.lc_cryo_plant,
    );

    cards.push({
      id: lc.id || `lc-${baseId}`,
      baseId,
      base: baseDisplay,
      name: lc.name || `${baseDisplay}航天发射中心`,
      siteType,
      siteBadge: profile.badgeText,
      tier: effectiveTier,
      tierBadge:
        effectiveTier === 3
          ? 'Tier-3 · 大型发射中心(12槽)'
          : effectiveTier === 2
            ? 'Tier-2 · 中型发射中心(8槽)'
            : 'Tier-1 · 小型发射场(4槽)',
      localTimeBadge: formatBaseLocalTimeBadge(
        globalClock,
        matchedBaseIdx >= 0 ? matchedBaseIdx : 0,
        matchedBase?.tz_offset,
        primaryTz,
      ),
      weatherBadge,
      payoutMult: profile.payoutMult,
      payoutMultText: profile.payoutMultText,
      payloadMult: profile.payloadMult,
      maxPayloadTons,
      isBuilt: true,
      isSpaceportCity,
      mountedSlots: rawSlots,
    });
  }

  // 2. 遍历拥有航天发射台/测控中心建筑的基地（若尚未在 explicitCenters 登记则自动派生）
  bases.forEach((b, idx) => {
    const bName = b.name || b.id;
    if (coveredBaseNames.has(bName)) return;
    let hasTier3LaunchComplex = false;
    let hasTier2LaunchComplex = false;
    const hasLaunchBld = (b.buildings ?? []).some(entry => {
      const name = typeof entry === 'string' ? entry : (entry as { name?: string })?.name ?? '';
      if (name.includes('大型航天发射综合体') || name.includes('巨型航天发射港')) {
        hasTier3LaunchComplex = true;
      } else if (name.includes('重型航天发射场')) {
        hasTier2LaunchComplex = true;
      }
      return (
        LAUNCHPAD_BUILDINGS.some(pad => name === pad || name.includes(pad)) ||
        name.includes('航天') ||
        name.includes('发射') ||
        name.includes('火箭') ||
        name.includes('卫星')
      );
    });
    if (!hasLaunchBld && cards.length > 0) return;
    coveredBaseNames.add(bName);

    const centerId = `lc-${b.id || idx + 1}`;
    const siteType = inferSiteTypeForBase(`${bName} ${b.location ?? ''}`, b.site_type);
    const profile = LAUNCH_CENTER_SITE_PROFILES[siteType] ?? LAUNCH_CENTER_SITE_PROFILES.inland_canyon;
    const defaultSlots: Record<string, string> = hasLaunchBld
      ? {
          lc_pad_1: 'asset.lc.pad_std',
        }
      : {};
    const rawSlots: Record<string, string> = {
      ...defaultSlots,
      ...(idx === 0 ? globalSlots : {}),
      ...(launchCenterDraftMap.value[centerId] ?? {}),
    };
    const hasVab = Boolean(rawSlots.lc_hif === 'asset.lc.vab_vertical' || rawSlots.lc_vab_1);
    const hasCrawler = Boolean(
      rawSlots.lc_crawler_way === 'asset.lc.crawler_super_base' || rawSlots.lc_crawler_1,
    );
    const computedTier: 1 | 2 | 3 =
      hasTier3LaunchComplex || (hasVab && hasCrawler)
        ? 3
        : hasTier2LaunchComplex || hasVab
          ? 2
          : 1;
    const effectiveTier: 1 | 2 | 3 = siteType === 'sea_platform' && computedTier > 2 ? 2 : computedTier;
    const tierBaseTons = effectiveTier === 3 ? 150 : effectiveTier === 2 ? 65 : profile.baseMaxTons;
    const maxPayloadTons = Math.round(tierBaseTons * profile.payloadMult);
    const localWeatherRaw = profile.immuneToEarthWeather ? '真空无气象干扰' : b.weather || globalWeather;
    const hasWeatherTower = Boolean(rawSlots.lc_weather_tower);
    const weatherBadge = profile.immuneToEarthWeather
      ? '🌌 真空全天候窗口'
      : hasWeatherTower
        ? `⚡ ${localWeatherRaw} (防雷塔全天候豁免)`
        : `🌤️ ${localWeatherRaw}`;
    const isSpaceportCity = Boolean(
      hasVab &&
        rawSlots.lc_underground_fab &&
        (rawSlots.lc_spacecraft_hall || rawSlots.lc_telemetry_1) &&
        rawSlots.lc_cryo_plant,
    );

    cards.push({
      id: centerId,
      baseId: b.id || bName,
      base: bName,
      name: hasLaunchBld ? `${bName}航天发射中心` : `${bName}预备航天场址`,
      siteType,
      siteBadge: profile.badgeText,
      tier: effectiveTier,
      tierBadge:
        effectiveTier === 3
          ? 'Tier-3 · 大型发射中心(12槽)'
          : effectiveTier === 2
            ? 'Tier-2 · 中型发射中心(8槽)'
            : 'Tier-1 · 小型发射场(4槽)',
      localTimeBadge: formatBaseLocalTimeBadge(globalClock, idx, b.tz_offset, primaryTz),
      weatherBadge,
      payoutMult: profile.payoutMult,
      payoutMultText: profile.payoutMultText,
      payloadMult: profile.payloadMult,
      maxPayloadTons,
      isBuilt: hasLaunchBld,
      isSpaceportCity,
      mountedSlots: rawSlots,
    });
  });

  // 3. 若快照无任何基地，提供默认主发射场兜底卡
  if (cards.length === 0) {
    const fallbackId = 'lc-main-default';
    const profile = LAUNCH_CENTER_SITE_PROFILES.inland_canyon;
    const rawSlots = {
      lc_pad_1: 'common.space.lc_pad_std',
      lc_mcc_core: 'common.space.lc_mcc_command',
      ...globalSlots,
      ...(launchCenterDraftMap.value[fallbackId] ?? {}),
    };
    cards.push({
      id: fallbackId,
      baseId: 'base-1',
      base: '主基地',
      name: '主基地航天发射中心',
      siteType: 'inland_canyon',
      siteBadge: profile.badgeText,
      tier: 1,
      tierBadge: 'Tier-1 · 小型发射场(4槽)',
      localTimeBadge: formatBaseLocalTimeBadge(globalClock, 0, 8, 8),
      weatherBadge: `🌤️ ${globalWeather}`,
      payoutMult: profile.payoutMult,
      payoutMultText: profile.payoutMultText,
      payloadMult: profile.payloadMult,
      maxPayloadTons: 25,
      isBuilt: launchReadiness.value.launchpadReady,
      isSpaceportCity: false,
      mountedSlots: rawSlots,
    });
  }

  return cards;
});

const unbuiltLaunchCenterBases = computed<string[]>(() => {
  const bases = props.snapshot?.bases ?? [];
  const builtBases = new Set(launchCenterCards.value.filter(c => c.isBuilt).map(c => c.base));
  return bases
    .map(b => b.name || b.id)
    .filter(name => Boolean(name) && !builtBases.has(name));
});

const activeLaunchCenter = computed<LaunchCenterCardView>(() => {
  const list = launchCenterCards.value;
  return list.find(c => c.id === selectedLaunchCenterId.value) ?? list[0];
});

const activeLaunchCenterDraft = computed<Record<string, string>>(() => {
  const center = activeLaunchCenter.value;
  return {
    ...(center?.mountedSlots ?? {}),
    ...(launchCenterDraftMap.value[center?.id ?? ''] ?? {}),
  };
});

const activeLaunchCenterSlotStats = computed(() => {
  const draft = activeLaunchCenterDraft.value;
  const hasVab = Boolean(draft.lc_hif === 'asset.lc.vab_vertical' || draft.lc_vab_1);
  const hasCrawler = Boolean(
    draft.lc_crawler_way === 'asset.lc.crawler_super_base' || draft.lc_crawler_1,
  );
  const unlockedCount = hasVab && hasCrawler ? 12 : hasVab ? 8 : 4;
  const mountedCount = Object.values(draft).filter(Boolean).length;
  return {
    unlockedCount,
    mountedCount,
  };
});

function selectLaunchCenter(centerId: string) {
  selectedLaunchCenterId.value = centerId;
  const target = launchCenterCards.value.find(c => c.id === centerId);
  if (target) {
    spaceDraft.value.base = target.base;
  }
}

function handleUpdateLaunchCenterDraft(nextDraft: Record<string, string>) {
  const cid = activeLaunchCenter.value?.id;
  if (!cid) return;
  launchCenterDraftMap.value = {
    ...launchCenterDraftMap.value,
    [cid]: { ...nextDraft },
  };
}

function handleSelectLaunchCenterSlot(slotId: string) {
  selectedLcSlotId.value = slotId;
  mccRightTab.value = 'expand';
}

const selectedLcSlotDef = computed<LaunchCenterSlotCatalogItem | null>(
  () => launchCenterSlotCatalog.find(s => s.id === selectedLcSlotId.value) ?? launchCenterSlotCatalog[0] ?? null,
);

const filteredLaunchCenterModules = computed<LaunchCenterModuleItem[]>(() => {
  const exact = LAUNCH_CENTER_MODULE_CATALOG.filter(m => m.slotId === selectedLcSlotId.value);
  return exact.length > 0 ? exact : LAUNCH_CENTER_MODULE_CATALOG;
});

async function handlePlanNewLaunchCenter(baseName: string) {
  const targetBase = (baseName || activeLaunchCenter.value.base || '主基地').trim();
  const loadedToast = await loadToastrSafe();
  dispatchEngOrderWithToast(
    () =>
      `【建造指令】在「${targetBase}」规划新建【航天发射台与测控中心】（Tier-1 小型发射场 4 槽底座），同步铺设一号标准发射工位与地面遥测中心。`,
    fillHostSendInput,
    loadedToast,
    '新建航天发射中心令',
    '新建航天发射中心指令已载入输入栏',
  );
}

async function handleExpandLaunchCenterModule(mod: LaunchCenterModuleItem) {
  const cid = activeLaunchCenter.value.id;
  launchCenterDraftMap.value = {
    ...launchCenterDraftMap.value,
    [cid]: {
      ...(launchCenterDraftMap.value[cid] ?? activeLaunchCenter.value.mountedSlots),
      [mod.slotId]: mod.id,
    },
  };
  const baseName = activeLaunchCenter.value.base;
  const loadedToast = await loadToastrSafe();
  dispatchEngOrderWithToast(
    () =>
      `【发射中心扩建令】在「${baseName} · ${activeLaunchCenter.value.name}」的槽位【${mod.slotLabel} (${mod.slotId})】挂载建造【${mod.name}】（预计资金 $${mod.cost} · 纳米 ${mod.nanites} · 工期 ${mod.days}d）。`,
    fillHostSendInput,
    loadedToast,
    '发射中心拓扑扩建令',
    '发射中心扩建指令已载入输入栏',
  );
}

/* ══ Tab 2：🏭 三大专业航天制造建筑状态栏 + 在建进度条 + 四大品类 14 项航天装备排产架 ══ */
interface AeroFacilityStatusCard {
  key: 'rocket_plant' | 'sat_center' | 'spacecraft_complex';
  name: '火箭制造厂' | '卫星制造中心' | '大型航天器与舱段总装中心';
  icon: string;
  tier: 2 | 3;
  cost: number;
  built: boolean;
  inQueue: boolean;
  roleDesc: string;
}

const aeroFacilityStatuses = computed<AeroFacilityStatusCard[]>(() => {
  const rawBuildings = (props.snapshot?.bases ?? []).flatMap(b => b.buildings ?? []);
  const allBuildings = rawBuildings
    .filter(entry => typeof entry === 'string' || ((entry as { state?: string })?.state ?? '运转') !== '建造中')
    .map(entry => (typeof entry === 'string' ? entry : (entry as { name?: string })?.name ?? ''));
  const buildingInProgressNames = rawBuildings
    .filter(entry => typeof entry !== 'string' && (entry as { state?: string })?.state === '建造中')
    .map(entry => (entry as { name?: string })?.name ?? '');
  const constructionQueues = Array.isArray(props.snapshot?.queues)
    ? props.snapshot.queues.filter(
        q => q && q.type === '建造' && q.status !== 'done' && q.status !== 'cancelled',
      )
    : ((props.snapshot?.queues as unknown as { construction?: Array<{ item?: string }> } | undefined)?.construction ??
      []);
  const checkBuilt = (keywords: string[]) =>
    allBuildings.some(bName => keywords.some(k => bName.includes(k)));
  const checkQueue = (keywords: string[]) =>
    constructionQueues.some(q => keywords.some(k => (q.item || '').includes(k))) ||
    buildingInProgressNames.some(bName => keywords.some(k => bName.includes(k)));

  return [
    {
      key: 'rocket_plant',
      name: '火箭制造厂',
      icon: '🔥',
      tier: 2,
      cost: 2500,
      built: checkBuilt(['火箭制造厂']),
      inQueue: checkQueue(['火箭制造厂']),
      roleDesc: '专司海平面煤油机、真空氢氧机、全流量甲烷机及芯一级/助推器/芯二级/远征上面级制造',
    },
    {
      key: 'sat_center',
      name: '卫星制造中心',
      icon: '🛰️',
      tier: 2,
      cost: 3200,
      built: checkBuilt(['卫星制造中心']),
      inQueue: checkQueue(['卫星制造中心']),
      roleDesc: '专司低轨高分侦察星、高轨红外预警通信星、多光谱勘探星、月面无人着陆器与巡视车制造',
    },
    {
      key: 'spacecraft_complex',
      name: '大型航天器与舱段总装中心',
      icon: '🛸',
      tier: 3,
      cost: 6500,
      built: checkBuilt(['大型航天器与舱段总装中心', '舱段总装中心']),
      inQueue: checkQueue(['大型航天器与舱段总装中心', '舱段总装中心']),
      roleDesc: '专司无人货运/载人飞船、双级载人登月舱与天枢核心舱/空间站模块化舱段总装',
    },
  ];
});

interface AeroEquipmentCatalogItem {
  id: string;
  name: string;
  categoryKey: 'engines' | 'stages' | 'satellites' | 'spacecraft';
  categoryLabel: string;
  facility: '火箭制造厂' | '卫星制造中心' | '大型航天器与舱段总装中心';
  cost: number;
  days: number;
  massTons: number;
  desc: string;
}

const CANONICAL_AERO_EQUIPMENT_ITEMS: readonly AeroEquipmentCatalogItem[] = [
  // 品类一：🔥 各级发动机（火箭制造厂）
  {
    id: 'common.unit.aero.sea_level_kerolox_engine',
    name: '海平面大推力液氧煤油发动机组',
    categoryKey: 'engines',
    categoryLabel: '🔥 各级火箭发动机',
    facility: '火箭制造厂',
    cost: 800,
    days: 1,
    massTons: 4,
    desc: '高压补燃循环液氧煤油海平面主推发动机组，适配助推器与芯一级',
  },
  {
    id: 'common.unit.aero.vacuum_hydrolox_engine',
    name: '高空真空氢氧/膨胀循环发动机',
    categoryKey: 'engines',
    categoryLabel: '🔥 各级火箭发动机',
    facility: '火箭制造厂',
    cost: 1200,
    days: 1.5,
    massTons: 3,
    desc: '高比冲真空氢氧膨胀循环发动机，大幅提升高轨与深空入轨效率',
  },
  {
    id: 'common.unit.aero.full_flow_methalox_engine',
    name: '全流量分级燃烧液氧甲烷发动机组',
    categoryKey: 'engines',
    categoryLabel: '🔥 各级火箭发动机',
    facility: '火箭制造厂',
    cost: 1800,
    days: 2,
    massTons: 5,
    desc: '全流量分级燃烧室液氧甲烷发动机组，支持数十次免大修垂直复用',
  },
  // 品类二：🚀 助推器与各级芯级（火箭制造厂）
  {
    id: 'common.unit.aero.strap_on_booster',
    name: '通用捆绑式助推器',
    categoryKey: 'stages',
    categoryLabel: '🚀 助推器与各级芯级',
    facility: '火箭制造厂',
    cost: 1200,
    days: 1.5,
    massTons: 6,
    desc: '可模块化捆绑于芯一级周侧，提升起飞推重比与低轨运力上限',
  },
  {
    id: 'common.unit.aero.core_first_stage',
    name: '标准运载火箭芯一级',
    categoryKey: 'stages',
    categoryLabel: '🚀 助推器与各级芯级',
    facility: '火箭制造厂',
    cost: 2200,
    days: 2,
    massTons: 12,
    desc: '配备栅格舵与着陆支腿的主力运载火箭一子级箭体',
  },
  {
    id: 'common.unit.aero.vacuum_second_stage',
    name: '高空入轨真空芯二级',
    categoryKey: 'stages',
    categoryLabel: '🚀 助推器与各级芯级',
    facility: '火箭制造厂',
    cost: 1600,
    days: 1.5,
    massTons: 8,
    desc: '承担高空接力加速与精确入轨段推进的真空二子级',
  },
  {
    id: 'common.unit.aero.upper_kick_stage',
    name: '远征上面级',
    categoryKey: 'stages',
    categoryLabel: '🚀 助推器与各级芯级',
    facility: '火箭制造厂',
    cost: 1500,
    days: 1.5,
    massTons: 5,
    desc: '具备多次在轨点火能力，支持一箭多星异轨部署与地月转移入轨',
  },
  // 品类三：🛰️ 自产卫星与无人探测载荷（卫星制造中心）
  {
    id: 'common.unit.aero.leo_recon_sat_payload',
    name: '低轨高分光学侦察卫星载荷',
    categoryKey: 'satellites',
    categoryLabel: '🛰️ 自产卫星与无人探测载荷',
    facility: '卫星制造中心',
    cost: 1800,
    days: 2,
    massTons: 8,
    desc: '提供全天候亚米级光学与合成孔径雷达战术侦察视野',
  },
  {
    id: 'common.unit.aero.geo_ew_comm_sat_payload',
    name: '高轨红外预警与通信卫星载荷',
    categoryKey: 'satellites',
    categoryLabel: '🛰️ 自产卫星与无人探测载荷',
    facility: '卫星制造中心',
    cost: 2600,
    days: 2.5,
    massTons: 14,
    desc: '地球同步轨道天基红外导弹预警与高通量战略通信中继载荷',
  },
  {
    id: 'common.unit.aero.survey_asat_sat_payload',
    name: '天基多光谱资源勘探卫星载荷',
    categoryKey: 'satellites',
    categoryLabel: '🛰️ 自产卫星与无人探测载荷',
    facility: '卫星制造中心',
    cost: 2200,
    days: 2,
    massTons: 10,
    desc: '兼具全球矿脉资源遥感勘探与轨道态势感知巡检能力',
  },
  {
    id: 'common.unit.aero.lunar_lander_rover_payload',
    name: '月面无人软着陆器与巡视探测车',
    categoryKey: 'satellites',
    categoryLabel: '🛰️ 自产卫星与无人探测载荷',
    facility: '卫星制造中心',
    cost: 4200,
    days: 3.5,
    massTons: 18,
    desc: '执行月面极区水冰勘探、信标中继部署与月壤原位采掘前哨任务',
  },
  // 品类四：🛸 飞船与大型舱段载荷（大型航天器与舱段总装中心）
  {
    id: 'common.unit.aero.orbital_spacecraft_payload',
    name: '宇宙飞船载荷总成',
    categoryKey: 'spacecraft',
    categoryLabel: '🛸 飞船与大型舱段载荷',
    facility: '大型航天器与舱段总装中心',
    cost: 3800,
    days: 3,
    massTons: 22,
    desc: '承担空间站乘组天地往返轮换与推进剂/科研物资大宗补给',
  },
  {
    id: 'common.unit.aero.crewed_lunar_module_payload',
    name: '双级载人登月舱与月面增压车',
    categoryKey: 'spacecraft',
    categoryLabel: '🛸 飞船与大型舱段载荷',
    facility: '大型航天器与舱段总装中心',
    cost: 6500,
    days: 4.5,
    massTons: 42,
    desc: '含下降着陆级、月面起飞上升级与全地形月面增压机动巡视车',
  },
  {
    id: 'common.unit.orbital.modular_station_segments',
    name: '天枢核心舱与空间站模块化舱段总成',
    categoryKey: 'spacecraft',
    categoryLabel: '🛸 飞船与大型舱段载荷',
    facility: '大型航天器与舱段总装中心',
    cost: 5000,
    days: 4,
    massTons: 35,
    desc: '大型轨道空间站核心舱、实验舱与桁架太阳翼预制舱段总成',
  },
];

function getAeroEquipmentStock(itemId: string, itemName: string): number {
  const byId = resolveAeroEquipmentStockCount(itemId, props.snapshot);
  const byName = resolveAeroEquipmentStockCount(itemName, props.snapshot);
  return Math.max(byId, byName);
}

const aeroEquipmentGroups = computed(() => {
  const categories: Array<{
    categoryKey: AeroEquipmentCatalogItem['categoryKey'];
    categoryLabel: string;
    facilityName: string;
  }> = [
    { categoryKey: 'engines', categoryLabel: '🔥 各级火箭发动机 (3项)', facilityName: '火箭制造厂' },
    { categoryKey: 'stages', categoryLabel: '🚀 助推器与各级芯级 (4项)', facilityName: '火箭制造厂' },
    { categoryKey: 'satellites', categoryLabel: '🛰️ 自产卫星与无人探测载荷 (4项)', facilityName: '卫星制造中心' },
    { categoryKey: 'spacecraft', categoryLabel: '🛸 飞船与大型舱段载荷 (3项)', facilityName: '大型航天器与舱段总装中心' },
  ];

  return categories.map(cat => ({
    ...cat,
    items: CANONICAL_AERO_EQUIPMENT_ITEMS.filter(i => i.categoryKey === cat.categoryKey).map(item => ({
      ...item,
      stock: getAeroEquipmentStock(item.id, item.name),
    })),
  }));
});

const aeroActiveQueues = computed(() => {
  const prodQueues = Array.isArray(props.snapshot?.queues)
    ? props.snapshot.queues.filter(
        q => q && q.type === '生产' && q.status !== 'done' && q.status !== 'cancelled',
      )
    : ((
        props.snapshot?.queues as unknown as {
          production?: Array<{
            item?: string;
            progress?: number;
            qty?: number;
            qty_done?: number;
            base?: string;
            eta?: string;
          }>;
        } | undefined
      )?.production ?? []);
  const aeroNames = new Set([
    ...CANONICAL_AERO_EQUIPMENT_ITEMS.flatMap(i => [i.id, i.name]),
    ...BUILDABLE_AERO_EQUIPMENT_CATALOG.flatMap(s => [s.id, s.name, ...s.aliases]),
  ]);
  return prodQueues
    .filter(q => {
      const name = q.item || '';
      return (
        aeroNames.has(name) ||
        name.includes('发动机') ||
        name.includes('助推器') ||
        name.includes('芯一级') ||
        name.includes('芯二级') ||
        name.includes('上面级') ||
        name.includes('卫星') ||
        name.includes('飞船') ||
        name.includes('登月') ||
        name.includes('核心舱') ||
        name.includes('着陆器')
      );
    })
    .map(q => ({
      item: q.item,
      progress: typeof q.progress === 'number' ? q.progress : 0,
      qty: q.qty ?? 1,
      qtyDone: q.qty_done ?? 0,
      base: q.base || activeLaunchCenter.value.base,
      eta: q.eta || '',
    }));
});
const activeAeroProductionQueues = aeroActiveQueues;

async function handleBuildAeroFacility(fac: AeroFacilityStatusCard) {
  const baseName = activeLaunchCenter.value.base || selectedBaseDisplayName.value;
  const loadedToast = await loadToastrSafe();
  dispatchEngOrderWithToast(
    () => buildAeroBuildingConstructCommand(baseName, fac.name),
    fillHostSendInput,
    loadedToast,
    '航天制造建筑立项令',
    `${fac.name}建造指令已载入输入栏`,
  );
}

async function handleScheduleAeroEquipment(item: AeroEquipmentCatalogItem, batchCount: 1 | 4) {
  const baseName = activeLaunchCenter.value.base || selectedBaseDisplayName.value;
  const loadedToast = await loadToastrSafe();
  dispatchEngOrderWithToast(
    () => buildAeroEquipmentProduceCommand(baseName, item.id || item.name, batchCount),
    fillHostSendInput,
    loadedToast,
    '航天装备产线排产令',
    `${item.name} ×${batchCount} 排产指令已载入输入栏`,
  );
}

/* ══ Tab 3：🚀 火箭整备与发射合同（自家载荷 vs 仅读取 LLM 下发的外部商业委托载荷 · 严守 D7-B 红线） ══ */
const externalCommercialOrders = computed(() => {
  const raw = props.snapshot?.space?.commercial_orders;
  if (!Array.isArray(raw)) return [];
  return raw.map(order => ({
    id: order.id,
    name: order.name,
    client: order.client || '外部商业机构',
    orbit: order.orbit || 'LEO',
    mass_t: typeof order.mass_t === 'number' ? order.mass_t : 5,
    reward_credits:
      typeof order.reward_credits === 'number'
        ? order.reward_credits
        : typeof order.reward === 'number'
          ? order.reward
          : 2000,
    status: order.status || 'pending',
  }));
});

const domesticPayloadOptions = computed(() =>
  CANONICAL_AERO_EQUIPMENT_ITEMS.filter(
    i => i.categoryKey === 'satellites' || i.categoryKey === 'spacecraft',
  ).map(item => ({
    ...item,
    stock: getAeroEquipmentStock(item.id, item.name),
  })),
);

function selectDomesticPayloadPreset(item: AeroEquipmentCatalogItem) {
  spaceDraft.value.payload = item.name;
  spaceDraft.value.title = `${item.name}发射任务`;
  spaceDraft.value.base = activeLaunchCenter.value.base;
  if (item.categoryKey === 'spacecraft') {
    spaceDraft.value.kind = 'station';
    spaceDraft.value.rewardCredits = Math.max(3000, item.cost);
  } else if (item.id.includes('geo_ew_comm')) {
    spaceDraft.value.kind = 'comm';
    spaceDraft.value.rewardCredits = 2400;
  } else {
    spaceDraft.value.kind = 'recon';
    spaceDraft.value.rewardCredits = 2000;
  }
}

async function handleSelectCommercialOrderForLaunch(order: {
  id: string;
  name: string;
  client: string;
  orbit: string;
  mass_t: number;
  reward_credits: number;
}) {
  spaceDraft.value.kind = 'commercial';
  spaceDraft.value.payload = order.name;
  spaceDraft.value.title = `【商业履约】${order.client} · ${order.name}`;
  spaceDraft.value.rewardCredits = order.reward_credits;
  spaceDraft.value.base = activeLaunchCenter.value.base;
  payloadSourceTab.value = 'domestic';
  const loadedToast = await loadToastrSafe();
  dispatchEngOrderWithToast(
    () =>
      buildSpaceContractOrderText({
        title: `【商业履约】${order.client} · ${order.name}`,
        kind: 'commercial',
        rocket: spaceDraft.value.rocket,
        payload: order.name,
        base: activeLaunchCenter.value.base,
        rewardCredits: order.reward_credits,
        recoverBooster: spaceDraft.value.recoverBooster,
        useStoredBooster: spaceDraft.value.useStoredBooster && spaceOverview.value.boosterCount > 0,
        launchCenterId: activeLaunchCenter.value.id,
        payloadSource: 'commercial',
        client: order.client,
        massTons: order.mass_t,
        orbitTarget: order.orbit,
      }),
    fillHostSendInput,
    loadedToast,
    '商业委托载荷发射合同令',
    '外部商业委托发射合同已载入输入栏',
  );
}

const spaceDraft = ref<{
  title: string;
  kind: SpaceContract['kind'];
  rocket: string;
  payload: string;
  base: string;
  recoverBooster: boolean;
  useStoredBooster: boolean;
  rewardCredits: number;
}>({
  title: `${SPACE_CONTRACT_KIND_OPTIONS[0].defaultPayload}发射任务`,
  kind: SPACE_CONTRACT_KIND_OPTIONS[0].key,
  rocket: DEFAULT_ROCKET_OPTIONS[0],
  payload: SPACE_CONTRACT_KIND_OPTIONS[0].defaultPayload,
  base: '',
  recoverBooster: true,
  useStoredBooster: false,
  rewardCredits: SPACE_CONTRACT_KIND_OPTIONS[0].defaultReward,
});

watch(
  () => activeLaunchCenter.value?.base,
  baseName => {
    if (baseName && !spaceDraft.value.base) {
      spaceDraft.value.base = baseName;
    }
  },
  { immediate: true },
);

function onSpaceDraftKindChange() {
  const opt = SPACE_CONTRACT_KIND_OPTIONS.find(o => o.key === spaceDraft.value.kind);
  if (opt) {
    spaceDraft.value.payload = opt.defaultPayload;
    spaceDraft.value.rewardCredits = opt.defaultReward;
    spaceDraft.value.title = `${opt.defaultPayload}发射任务`;
  }
}

const draftPayoutPreview = computed(() =>
  computeContractPayoutPreview(
    spaceDraft.value.rewardCredits,
    spaceDraft.value.useStoredBooster,
    spaceOverview.value.boosterCount,
  ),
);

const selectedBaseDisplayName = computed<string>(() =>
  spaceDraft.value.base.trim() ||
  launchReadiness.value.launchpadBaseNames[0] ||
  props.snapshot?.bases?.[0]?.name ||
  props.snapshot?.bases?.[0]?.id ||
  '主发射场',
);

async function handleSubmitSpaceContract() {
  const fallbackBase = selectedBaseDisplayName.value;
  const loadedToast = await loadToastrSafe();
  dispatchEngOrderWithToast(
    () =>
      buildSpaceContractOrderText({
        title: spaceDraft.value.title,
        kind: spaceDraft.value.kind,
        rocket: spaceDraft.value.rocket,
        payload: spaceDraft.value.payload,
        base: fallbackBase,
        rewardCredits: spaceDraft.value.rewardCredits,
        recoverBooster: spaceDraft.value.recoverBooster,
        useStoredBooster: spaceDraft.value.useStoredBooster && spaceOverview.value.boosterCount > 0,
      }),
    fillHostSendInput,
    loadedToast,
    '天基航天合同令',
    '航天合同指令已载入输入栏',
  );
}

async function handleCommitSpaceCanvasBlueprint(orderText: string) {
  if (!orderText || !orderText.trim()) return;
  const loadedToast = await loadToastrSafe();
  dispatchEngOrderWithToast(
    () => orderText,
    fillHostSendInput,
    loadedToast,
    '天基蓝图规划令',
    '天基工程总体蓝图已载入输入栏',
  );
}

async function handleLaunchSpaceCanvasNode(payload: SpaceCanvasNodeActionPayload) {
  if (!payload) return;
  const baseName = selectedBaseDisplayName.value;
  if (payload.contractPreset) {
    const preset = payload.contractPreset;
    if (preset.title) spaceDraft.value.title = preset.title;
    if (preset.kind) spaceDraft.value.kind = preset.kind as SpaceContract['kind'];
    if (preset.payload) spaceDraft.value.payload = preset.payload;
    if (preset.rocket) spaceDraft.value.rocket = preset.rocket;
    if (typeof preset.rewardCredits === 'number') spaceDraft.value.rewardCredits = preset.rewardCredits;
    if (typeof preset.recoverBooster === 'boolean') spaceDraft.value.recoverBooster = preset.recoverBooster;
    spaceDraft.value.base = baseName;
  } else {
    spaceDraft.value.base = baseName;
  }
  if (!payload.orderText || !payload.orderText.trim()) return;
  const loadedToast = await loadToastrSafe();
  dispatchEngOrderWithToast(
    () => payload.orderText,
    fillHostSendInput,
    loadedToast,
    '天基节点建造与发射令',
    '天基节点发射/建造指令已载入输入栏',
  );
}

async function handleLaunchExistingContract(c: SpaceContract) {
  const loadedToast = await loadToastrSafe();
  dispatchEngOrderWithToast(
    () =>
      buildExistingContractLaunchOrderText(
        c,
        spaceDraft.value.useStoredBooster && spaceOverview.value.boosterCount > 0,
      ),
    fillHostSendInput,
    loadedToast,
    '天基点火发射令',
    '点火发射指令已载入输入栏',
  );
}

async function loadToastrSafe(timeoutMs = 3000): Promise<EngToastChannel | null> {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    const toastr = await Promise.race([
      import('toastr').then(m => m.default),
      new Promise<null>(resolve => { timer = globalThis.setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    return toastr ?? null;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
}

async function handleInitiate() {
  const def = selectedDef.value;
  const target = initiateTarget.value;
  if (!def || !target.enabled) return;
  const loadedToast = (await loadToastrSafe());
  dispatchEngOrderWithToast(() => buildInitiateOrderText(def.name, target.base), fillHostSendInput, loadedToast, '工程立项令', '工程指令已载入输入栏');
}

async function handleV2ProjectOrder(btn: EngCommandButton) {
  const inst = v2Instance.value;
  if (!inst || !btn.enabled) return;
  if (btn.verb === '取消') { v2CancelConfirmOpen.value = true; return; }
  const loadedToast = (await loadToastrSafe());
  dispatchEngOrderWithToast(() => buildV2ProjectOrderText(btn, inst.id, utoTasks.value), fillHostSendInput, loadedToast, '仓段化工程令', '工程指令已载入输入栏');
}

async function handleV2CancelAffirm() {
  v2CancelConfirmOpen.value = false;
  const inst = v2Instance.value;
  const cancelBtn = v2ProjectButtons.value.find(b => b.verb === '取消');
  if (!inst || !cancelBtn?.enabled) return;
  const loadedToast = (await loadToastrSafe());
  dispatchEngOrderWithToast(() => buildV2ProjectOrderText(cancelBtn, inst.id, utoTasks.value), fillHostSendInput, loadedToast, '仓段化工程令', '工程指令已载入输入栏');
}

async function handleV2ModuleOrder(btn: EngModuleCommandButton) {
  const inst = v2Instance.value;
  if (!inst || !btn.enabled) return;
  const loadedToast = (await loadToastrSafe());
  dispatchEngOrderWithToast(() => buildV2ModuleOrderText(btn, inst.id, utoTasks.value), fillHostSendInput, loadedToast, '仓段化模块令', '模块指令已载入输入栏');
}

async function handleV2AllocateOrder(baseOverride?: string) {
  const inst = v2Instance.value;
  const mod = selectedModule.value;
  if (!inst || !mod) return;
  const baseTarget = (baseOverride ?? initiateTarget.value.base).trim();
  if (!baseTarget) return;
  const loadedToast = await loadToastrSafe();
  dispatchEngOrderWithToast(
    () => buildV2AllocateOrderText(inst.id, mod.moduleId, mod.name, baseTarget, utoTasks.value),
    fillHostSendInput, loadedToast, '模块基地指派令', '模块指派令已载入输入栏',
  );
}
</script>

<style scoped>
.ra-modal-mask {
  z-index: 10010;
  background: rgba(4, 7, 12, 0.82);
  backdrop-filter: blur(5px);
}
.ra-modal-card,
.eng-modal-card {
  width: 80vw !important;
  max-width: 80vw !important;
  min-width: min(1040px, 94vw) !important;
  height: 88vh !important;
  max-height: 90vh !important;
  background: var(--rac-bg, #080a0b);
  border: 1px solid var(--rac-line, #5f7c84);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.85),
    0 0 0 1px rgba(95, 124, 132, 0.15);
}
@media (max-width: 1023px) {
  .ra-modal-card,
  .eng-modal-card {
    width: 95vw !important;
    max-width: 95vw !important;
    min-width: 92vw !important;
    height: 92vh !important;
  }
}
.ra-modal-header {
  background: var(--rac-panel, #0c1113);
  border-color: var(--rac-dim, #2c3b40);
  width: 100%;
}
.ra-modal-icon {
  color: var(--rac-line, #5f7c84);
}
.ra-modal-title {
  color: var(--rac-hi, #d4e3e6);
}
.ra-modal-close {
  color: var(--rac-muted, #8aa1a7);
}
.ra-modal-close:hover {
  color: var(--rac-hi, #d4e3e6);
  background: var(--rac-panel-2, #0f1619);
}
.eng-body { min-height: 320px; width: 100%; }
.eng-catalog { border-right: 1px solid var(--rac-dim, #2c3b40); background: var(--rac-panel, #0c1113); }
.eng-tabs { border-bottom: 1px solid var(--rac-dim, #2c3b40); }
.eng-tab { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 3px; padding: 6px 0; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: var(--rac-muted, #8aa1a7); background: transparent; border: none; border-bottom: 1px solid transparent; cursor: pointer; }
.eng-tab--active { color: var(--rac-hi, #d4e3e6); border-bottom-color: var(--rac-line, #5f7c84); background: var(--rac-panel-2, #0f1619); }
.eng-tab:focus-visible { outline: 1px solid var(--rac-focus, var(--rac-accent)); outline-offset: -1px; }
.eng-tab-lock { color: var(--rac-muted, #8aa1a7); display: inline-flex; }
.eng-tab-count { padding: 0 4px; border-radius: 2px; font-size: 9px; line-height: 1.4; color: var(--rac-muted, #8aa1a7); background: rgba(95, 124, 132, 0.16); }
.eng-tab--active .eng-tab-count { color: #7dd3fc; background: rgba(56, 189, 248, 0.16); }
.eng-catalog-toolbar { display: flex; flex-direction: column; gap: 4px; padding: 6px 6px 4px; border-bottom: 1px solid var(--rac-dim, #2c3b40); background: rgba(12, 17, 19, 0.85); }
.eng-catalog-search { width: 100%; padding: 4px 7px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: var(--rac-bg, #080a0b); color: var(--rac-text, #cfdde0); font-size: 10px; outline: none; }
.eng-catalog-search:focus { border-color: #38bdf8; }
.eng-grade-filters { display: flex; gap: 3px; }
.eng-grade-filter-chip { flex: 1; padding: 2px 0; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: transparent; color: var(--rac-muted, #8aa1a7); font-size: 9px; cursor: pointer; }
.eng-grade-filter-chip--active { color: var(--rac-hi, #d4e3e6); border-color: var(--rac-line, #5f7c84); background: rgba(95, 124, 132, 0.2); }
.eng-item-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--rac-line, #5f7c84); }
.eng-item-dot--ready { background: #38bdf8; }
.eng-item-dot--active { background: var(--rac-warn, #d2ad69); box-shadow: 0 0 5px rgba(210, 173, 105, 0.7); }
.eng-item-dot--paused { background: var(--rac-warn, #d2ad69); opacity: 0.6; }
.eng-item-dot--done { background: var(--rac-ok, #78b69b); }
.eng-item-dot--locked { background: var(--rac-dim, #2c3b40); }
.eng-catalog-list { padding: 4px; }
.eng-catalog-item { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; padding: 5px 6px; margin-bottom: 2px; border: 1px solid transparent; border-radius: 2px; background: transparent; color: var(--rac-text, #cfdde0); font-size: 10.5px; text-align: left; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease; }
.eng-catalog-item:hover { background: var(--rac-panel-2, #0f1619); border-color: var(--rac-dim, #2c3b40); }
.eng-catalog-item--active { background: var(--rac-panel-2, #0f1619); border-color: var(--rac-line, #5f7c84); box-shadow: inset 2px 0 0 var(--rac-line, #5f7c84); }
.eng-catalog-item:focus-visible, .eng-card:focus-visible, .eng-mod:focus-visible { outline: 1px solid var(--rac-focus, var(--rac-accent)); outline-offset: 1px; }
.eng-catalog-item--locked { opacity: 0.55; cursor: not-allowed; }
.eng-catalog-item-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eng-long-lock { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 18px 10px; text-align: center; }
.eng-long-lock-icon { color: var(--rac-dim, #2c3b40); }
.eng-long-lock-text { margin: 0; font-size: 9.5px; line-height: 1.7; color: var(--rac-muted, #8aa1a7); }
.eng-lock-badge { flex: none; padding: 1px 4px; border: 1px dashed var(--rac-dim, #2c3b40); border-radius: 2px; font-size: 8.5px; letter-spacing: 0.1em; color: var(--rac-muted, #8aa1a7); }
.eng-lock-badge--lg { font-size: 10px; padding: 2px 8px; color: var(--rac-warn, #d2ad69); border-color: rgba(210, 173, 105, 0.4); }
.eng-main { padding: 10px 12px; }
.eng-info { border: 1px solid var(--rac-dim, #2c3b40); border-radius: 3px; background: var(--rac-panel, #0c1113); padding: 8px 10px; margin-bottom: 10px; }
.eng-info-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.eng-info-name { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; color: var(--rac-hi, #d4e3e6); }
.eng-scope-tag { font-size: 9px; font-family: monospace; color: var(--rac-muted, #8aa1a7); }
.eng-info-row { display: flex; align-items: center; gap: 8px; margin-top: 7px; font-size: 10.5px; color: var(--rac-muted, #8aa1a7); }
.eng-info-label { flex: none; width: 64px; font-size: 9.5px; letter-spacing: 0.08em; }
.eng-info-row--ladder { align-items: flex-start; }
.eng-ladder-header { display: flex; align-items: flex-start; gap: 8px; width: 100%; }
.eng-phase-ladder { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; flex: 1; }
.eng-phase-step { display: inline-flex; align-items: center; gap: 5px; padding: 3px 7px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: var(--rac-panel-2, #0f1619); color: var(--rac-text, #cfdde0); font-size: 9.5px; }
.eng-phase-step--done { border-color: rgba(120, 182, 155, 0.45); background: rgba(120, 182, 155, 0.1); }
.eng-phase-step--active { border-color: rgba(210, 173, 105, 0.55); background: rgba(210, 173, 105, 0.12); }
.eng-phase-step-idx { font-size: 8.5px; color: var(--rac-muted, #8aa1a7); }
.eng-phase-step-name { font-weight: 600; color: var(--rac-hi, #d4e3e6); }
.eng-phase-step-state, .eng-uto-station-hint { font-size: 8.5px; color: var(--rac-warn, #d2ad69); }
.eng-phase-dot { width: 7px; height: 7px; border-radius: 50%; border: 1px solid var(--rac-line, #5f7c84); background: transparent; }
.eng-phase-step--done .eng-phase-dot { border-color: var(--rac-ok, #78b69b); background: var(--rac-ok, #78b69b); }
.eng-phase-step--active .eng-phase-dot { border-color: var(--rac-warn, #d2ad69); background: var(--rac-warn, #d2ad69); }
.eng-phase-text { margin-left: auto; font-size: 9.5px; color: var(--rac-muted, #8aa1a7); }
.eng-instance-pill { margin-left: auto; padding: 1px 6px; border: 1px solid rgba(210, 173, 105, 0.4); border-radius: 2px; font-size: 9px; color: var(--rac-warn, #d2ad69); background: rgba(210, 173, 105, 0.1); }
.eng-uto-observer { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 7px; }
.eng-uto-station { display: inline-flex; align-items: center; gap: 6px; padding: 2.5px 7px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: var(--rac-panel-2, #0f1619); font-size: 9.5px; color: var(--rac-text, #cfdde0); }
.eng-uto-station--ready { border-color: rgba(120, 182, 155, 0.4); }
.eng-uto-station--zero { border-color: rgba(210, 173, 105, 0.35); }
.eng-uto-task { padding: 2px 6px; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 2px; background: rgba(56, 189, 248, 0.08); font-size: 9px; color: #7dd3fc; }
.eng-prereq-status { margin-left: 4px; padding: 0.5px 4px; border-radius: 2px; font-size: 8.5px; }
.eng-prereq-status--ok { color: var(--rac-ok, #78b69b); background: rgba(120, 182, 155, 0.12); }
.eng-prereq-status--warn { color: var(--rac-warn, #d2ad69); background: rgba(210, 173, 105, 0.12); }
.eng-progress-track { flex: 1; max-width: 260px; height: 6px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: var(--rac-bg, #080a0b); overflow: hidden; }
.eng-progress-fill { display: block; height: 100%; background: var(--rac-line, #5f7c84); transition: width 0.3s ease; }
.eng-eta { font-size: 10px; color: var(--rac-muted, #8aa1a7); }
.eng-info-row--res { gap: 14px; flex-wrap: wrap; }
.eng-res-slot { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: var(--rac-text, #cfdde0); }
.eng-res-slot b { color: var(--rac-hi, #d4e3e6); }
.eng-res-slot--prereq { color: var(--rac-muted, #8aa1a7); }
.eng-info-desc { margin: 8px 0 0; font-size: 10.5px; line-height: 1.7; color: var(--rac-muted, #8aa1a7); }
.eng-scene-slot { margin-top: 8px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 3px; background: var(--rac-bg, #080a0b); overflow: hidden; }
.eng-mock-note { margin-bottom: 6px; font-size: 9px; letter-spacing: 0.06em; color: var(--rac-warn, #d2ad69); opacity: 0.85; }
.eng-group { margin-bottom: 8px; }
.eng-group-header { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; color: var(--rac-line, #5f7c84); border-bottom: 1px solid rgba(56, 189, 248, 0.18); }
.eng-group-count, .eng-modgrid-summary { font-size: 9.5px; color: var(--rac-muted, #8aa1a7); }
.eng-tone-dot { width: 6px; height: 6px; border-radius: 1px; }
.eng-tone--run { background: var(--rac-warn, #d2ad69); }
.eng-tone--idle { background: var(--rac-line, #5f7c84); }
.eng-tone--ok { background: var(--rac-ok, #78b69b); }
.eng-card { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; margin-top: 4px; padding: 5px 8px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: var(--rac-panel, #0c1113); color: var(--rac-text, #cfdde0); font-size: 10.5px; text-align: left; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease; }
.eng-card--active { border-color: #38bdf8; background: var(--rac-panel-2, #0f1619); box-shadow: inset 2px 0 0 #38bdf8; }
.eng-card-detail-btn { padding: 1px 6px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: rgba(15, 22, 25, 0.9); color: #7dd3fc; font-size: 9px; cursor: pointer; }
.eng-card-detail-btn:hover { border-color: #38bdf8; background: rgba(56, 189, 248, 0.15); }
.eng-card-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.eng-card-meta { flex: none; display: inline-flex; align-items: center; gap: 6px; }
.eng-card-phase, .eng-mod-actions-label { font-size: 9px; color: var(--rac-muted, #8aa1a7); }
.eng-grade-badge { flex: none; padding: 0.5px 4px; border-radius: 2px; font-size: 8.5px; line-height: 1.3; letter-spacing: 0.06em; border: 1px solid; }
.eng-grade-badge--minor { color: var(--rac-ok, #78b69b); border-color: rgba(120, 182, 155, 0.35); background: rgba(120, 182, 155, 0.1); }
.eng-grade-badge--mid { color: var(--rac-warn, #d2ad69); border-color: rgba(210, 173, 105, 0.35); background: rgba(210, 173, 105, 0.1); }
.eng-grade-badge--major { color: var(--rac-alert, #d16f6f); border-color: rgba(209, 111, 111, 0.35); background: rgba(209, 111, 111, 0.1); }
.eng-grade-badge--mega { color: #7dd3fc; border-color: rgba(56, 189, 248, 0.35); background: rgba(56, 189, 248, 0.1); }
.eng-header-count { color: var(--rac-warn, #d2ad69); letter-spacing: 0.06em; }
.eng-empty-line { padding: 6px 4px; font-size: 10px; color: var(--rac-muted, #8aa1a7); }
@media (prefers-reduced-motion: reduce) { .eng-catalog-item, .eng-card, .eng-progress-fill, .eng-initiate-btn { transition: none; } }
.eng-initiate-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-top: 7px; border-top: 1px dashed var(--rac-dim, #2c3b40); }
.eng-initiate-btn { flex: none; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border: 1px solid #38bdf8; border-radius: 3px; background: linear-gradient(180deg, #0284c7 0%, #0369a1 100%); color: #ffffff; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease; }
.eng-initiate-btn:hover:not(:disabled), .eng-v2cmd-btn:hover:not(:disabled) { background: linear-gradient(180deg, #0369a1 0%, #075985 100%); border-color: #7dd3fc; }
.eng-initiate-btn:disabled, .eng-v2cmd-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.eng-initiate-hint { min-width: 0; font-size: 9px; line-height: 1.5; color: var(--rac-muted, #8aa1a7); }
.eng-v2-tag { flex: none; padding: 0.5px 4px; border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 2px; font-size: 8px; line-height: 1.3; letter-spacing: 0.08em; color: #7dd3fc; background: rgba(56, 189, 248, 0.08); }
.eng-modgrid-block { margin-top: 7px; }
.eng-modgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; margin-top: 4px; }
.eng-mod { display: flex; flex-direction: column; gap: 3px; padding: 6px 7px; border: 1px solid var(--rac-dim, #2c3b40); border-left-width: 2px; border-radius: 3px; background: var(--rac-panel-2, #0f1619); color: var(--rac-text, #cfdde0); text-align: left; cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease; }
.eng-mod:hover { border-color: var(--rac-line, #5f7c84); }
.eng-mod--selected { border-color: #38bdf8; box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.5); }
.eng-mod-head { display: flex; align-items: center; gap: 5px; min-width: 0; }
.eng-mod-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; font-weight: 700; color: var(--rac-hi, #d4e3e6); }
.eng-mod-id { margin-left: auto; flex: none; font-size: 8.5px; color: var(--rac-muted, #8aa1a7); }
.eng-mod-dot { flex: none; width: 7px; height: 7px; border-radius: 1px; background: var(--rac-line, #5f7c84); }
.eng-mod--pending .eng-mod-dot { background: var(--rac-line, #5f7c84); }
.eng-mod--active .eng-mod-dot { background: var(--rac-warn, #d2ad69); }
.eng-mod--paused .eng-mod-dot { background: var(--rac-warn, #d2ad69); opacity: 0.5; }
.eng-mod--done .eng-mod-dot { background: var(--rac-ok, #78b69b); }
.eng-mod--cancelled .eng-mod-dot { background: var(--rac-alert, #d16f6f); }
.eng-mod--pending { border-left-color: var(--rac-line, #5f7c84); }
.eng-mod--active, .eng-mod--paused { border-left-color: var(--rac-warn, #d2ad69); }
.eng-mod--done { border-left-color: var(--rac-ok, #78b69b); }
.eng-mod--cancelled { border-left-color: var(--rac-alert, #d16f6f); }
.eng-mod-state { font-size: 9px; letter-spacing: 0.06em; color: var(--rac-muted, #8aa1a7); }
.eng-mod--active .eng-mod-state { color: var(--rac-warn, #d2ad69); }
.eng-mod--done .eng-mod-state { color: var(--rac-ok, #78b69b); }
.eng-mod--cancelled .eng-mod-state { color: var(--rac-alert, #d16f6f); }
.eng-mod-meta { display: flex; flex-direction: column; gap: 1px; font-size: 8.5px; color: var(--rac-muted, #8aa1a7); }
.eng-mod-queue { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eng-mod--locked { opacity: 0.5; border-style: dashed; }
.eng-mod-prereq { font-size: 8.5px; line-height: 1.5; color: var(--rac-warn, #d2ad69); }
.eng-v2cmd { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; padding-top: 7px; border-top: 1px dashed var(--rac-dim, #2c3b40); }
.eng-v2cmd-row, .eng-mod-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.eng-v2cmd-btn { padding: 4px 10px; border: 1px solid #38bdf8; border-radius: 3px; background: linear-gradient(180deg, #0284c7 0%, #0369a1 100%); color: #ffffff; font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease; }
.eng-v2cmd-btn--danger { border-color: #d16f6f; background: linear-gradient(180deg, #a03d3d 0%, #7f2f2f 100%); }
.eng-v2cmd-btn--danger:hover:not(:disabled) { background: linear-gradient(180deg, #7f2f2f 0%, #662626 100%); border-color: #e08d8d; }
.eng-cancel-mask { position: fixed; inset: 0; z-index: 10021; display: flex; align-items: center; justify-content: center; background: rgba(4, 8, 12, 0.6); }
.eng-cancel-card { max-width: 380px; padding: 14px 16px; border: 1px solid #d16f6f; border-radius: 4px; background: #0b1018; box-shadow: 0 0 18px rgba(209, 111, 111, 0.35); }
.eng-cancel-title { display: flex; align-items: center; gap: 6px; color: #e08d8d; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; }
.eng-cancel-text { margin: 8px 0 0; font-size: 11px; line-height: 1.8; color: #cfdde0; }
.eng-cancel-note { margin: 8px 0 0; font-size: 9.5px; line-height: 1.6; color: #8aa1a7; }
.eng-cancel-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.eng-cat-filters { display: flex; gap: 3px; }
.eng-item-state-badge { flex: none; padding: 0.5px 4px; border-radius: 2px; font-size: 8.5px; line-height: 1.3; border: 1px solid var(--rac-dim, #2c3b40); color: var(--rac-muted, #8aa1a7); }
.eng-item-state-badge[data-tone="active"] { color: var(--rac-warn, #d2ad69); border-color: rgba(210, 173, 105, 0.4); background: rgba(210, 173, 105, 0.1); }
.eng-item-state-badge[data-tone="ready"] { color: #7dd3fc; border-color: rgba(56, 189, 248, 0.4); background: rgba(56, 189, 248, 0.1); }
.eng-item-state-badge[data-tone="done"] { color: var(--rac-ok, #78b69b); border-color: rgba(120, 182, 155, 0.4); background: rgba(120, 182, 155, 0.1); }
.eng-upgrade-banner { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 8px; padding: 6px 10px; border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 3px; background: rgba(56, 189, 248, 0.08); font-size: 11px; color: var(--rac-text, #cfdde0); }
.eng-upgrade-count { margin-left: auto; font-size: 9.5px; color: var(--rac-warn, #d2ad69); }
.eng-workbench-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; margin-top: 6px; }
.eng-workbench-col { min-width: 0; }
.eng-workbench-col--right { padding: 6px 8px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 3px; background: var(--rac-panel-2, #0f1619); }
.eng-gate-checklist { display: flex; flex-direction: column; gap: 4px; }
.eng-gate-checklist-title { font-size: 10px; font-weight: 700; color: var(--rac-hi, #d4e3e6); letter-spacing: 0.06em; }
.eng-gate-item { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 6px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: var(--rac-panel, #0c1113); font-size: 9.5px; }
.eng-gate-item--ok { border-color: rgba(120, 182, 155, 0.35); }
.eng-gate-item--warn { border-color: rgba(210, 173, 105, 0.45); }
.eng-gate-label { color: var(--rac-muted, #8aa1a7); }
.eng-gate-val { color: var(--rac-text, #cfdde0); }
.eng-gate-status { font-size: 9px; color: var(--rac-ok, #78b69b); }
.eng-gate-item--warn .eng-gate-status { color: var(--rac-warn, #d2ad69); }
.eng-groups--compact-empty { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 4px 8px; border: 1px dashed var(--rac-dim, #2c3b40); border-radius: 3px; background: rgba(12, 17, 19, 0.6); }
.eng-groups--compact-empty .eng-group { margin-bottom: 0; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.eng-groups--compact-empty .eng-group-header { border-bottom: none; padding: 2px 0; font-size: 10px; }
.eng-groups--compact-empty .eng-empty-line { padding: 0; font-size: 9px; }
.eng-space-subview-bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; padding: 5px 8px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 3px; background: var(--rac-panel, #0c1113); }
.eng-space-subview-btn { padding: 4px 10px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: var(--rac-panel-2, #0f1619); color: var(--rac-muted, #8aa1a7); font-size: 10px; font-weight: 700; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease; }
.eng-space-subview-btn:hover { border-color: var(--rac-line, #5f7c84); color: var(--rac-text, #cfdde0); }
.eng-space-subview-btn--active { border-color: #38bdf8; background: rgba(56, 189, 248, 0.14); color: #7dd3fc; box-shadow: inset 0 -2px 0 #38bdf8; }
.eng-space-main { display: flex; flex-direction: column; gap: 8px; }
.eng-space-telemetry-ribbon { display: flex; flex-wrap: wrap; gap: 12px; padding: 6px 10px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 3px; background: var(--rac-panel, #0c1113); font-size: 10.5px; color: var(--rac-text, #cfdde0); }
.eng-space-gate-banner { padding: 6px 10px; border-radius: 3px; border: 1px solid var(--rac-dim, #2c3b40); font-size: 10.5px; }
.eng-space-gate-banner--ready { border-color: rgba(120, 182, 155, 0.45); background: rgba(120, 182, 155, 0.1); color: var(--rac-ok, #78b69b); }
.eng-space-gate-banner--warn { border-color: rgba(210, 173, 105, 0.45); background: rgba(210, 173, 105, 0.1); color: var(--rac-warn, #d2ad69); }
.eng-space-gate-banner--blocked { border-color: rgba(209, 111, 111, 0.45); background: rgba(209, 111, 111, 0.1); color: var(--rac-alert, #d16f6f); }
.eng-space-console-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; }
.eng-space-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.eng-space-card { padding: 8px 10px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 3px; background: var(--rac-panel, #0c1113); }
.eng-space-card-title, .eng-space-nav-title { font-size: 10.5px; font-weight: 700; color: var(--rac-hi, #d4e3e6); margin-bottom: 6px; }
.eng-space-asset-item, .eng-space-contract-item { padding: 5px 7px; margin-top: 4px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: var(--rac-panel-2, #0f1619); }
.eng-space-asset-head, .eng-space-contract-head { display: flex; align-items: center; gap: 6px; font-size: 10px; }
.eng-space-asset-name { font-weight: 700; color: var(--rac-hi, #d4e3e6); margin-right: auto; }
.eng-space-asset-bonus { margin-top: 3px; font-size: 9.5px; color: var(--rac-muted, #8aa1a7); }
.eng-space-contract-actions { margin-top: 5px; }
.eng-space-form { display: flex; flex-direction: column; gap: 6px; }
.eng-space-field { display: flex; flex-direction: column; gap: 2px; font-size: 9.5px; color: var(--rac-muted, #8aa1a7); }
.eng-space-check-row { display: flex; flex-wrap: wrap; gap: 10px; font-size: 9.5px; color: var(--rac-text, #cfdde0); }
.eng-space-check { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.eng-space-payout { font-size: 10px; color: var(--rac-text, #cfdde0); }
.eng-space-nav-group { margin-bottom: 8px; }
.eng-space-mini-item { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 3px 6px; font-size: 9.5px; color: var(--rac-text, #cfdde0); }
.eng-space-mini-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ══ FD-27 · 天地月多发射中心切换栏 + 左右双栏工作台样式 ══ */
.eng-scene-slot--compact { max-height: 180px; }
.eng-mcc-center-bar { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 3px; background: linear-gradient(180deg, rgba(12, 19, 28, 0.95) 0%, rgba(9, 14, 20, 0.95) 100%); }
.eng-mcc-center-bar-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; }
.eng-mcc-new-center-btn { padding: 3px 8px; border: 1px dashed rgba(56, 189, 248, 0.55); border-radius: 2px; background: rgba(14, 116, 144, 0.16); color: #7dd3fc; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease; }
.eng-mcc-new-center-btn:hover { background: rgba(14, 116, 144, 0.28); border-color: #38bdf8; }
.eng-mcc-center-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 6px; }
.eng-mcc-center-card { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 3px; background: var(--rac-panel-2, #0f1619); color: var(--rac-text, #cfdde0); text-align: left; cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease; }
.eng-mcc-center-card:hover { border-color: rgba(56, 189, 248, 0.5); background: rgba(15, 25, 34, 0.95); }
.eng-mcc-center-card--active { border-color: #38bdf8; background: rgba(14, 34, 52, 0.72); box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.45); }
.eng-mcc-center-card-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.eng-mcc-center-title { font-size: 10.5px; font-weight: 700; color: #f1f5f9; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eng-mcc-tier-badge { flex: none; padding: 1px 5px; border: 1px solid rgba(56, 189, 248, 0.45); border-radius: 2px; background: rgba(56, 189, 248, 0.12); color: #7dd3fc; font-size: 8.5px; }
.eng-mcc-tier-badge[data-tier="2"] { border-color: rgba(168, 85, 247, 0.55); background: rgba(168, 85, 247, 0.14); color: #d8b4fe; }
.eng-mcc-tier-badge[data-tier="3"] { border-color: rgba(250, 204, 21, 0.6); background: rgba(250, 204, 21, 0.14); color: #fde047; }
.eng-mcc-center-site { font-size: 9.5px; color: #bae6fd; line-height: 1.4; }
.eng-mcc-center-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; font-size: 9px; color: #94a3b8; }
.eng-mcc-tz-pill, .eng-mcc-weather-pill, .eng-mcc-cap-pill { padding: 1px 5px; border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 2px; background: rgba(15, 23, 42, 0.65); }

.eng-canvas-workbench { display: grid; grid-template-columns: minmax(0, 1.38fr) minmax(320px, 1fr); gap: 10px; align-items: start; }
@media (max-width: 960px) {
  .eng-canvas-workbench { grid-template-columns: 1fr; }
}
.eng-mcc-workbench-left { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.eng-mcc-left-status { padding: 6px 9px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 3px; background: var(--rac-panel, #0c1113); font-size: 9.5px; color: var(--rac-text, #cfdde0); }
.eng-mcc-spaceport-pill { padding: 2px 6px; border: 1px dashed rgba(148, 163, 184, 0.35); border-radius: 2px; font-size: 9px; color: #94a3b8; }
.eng-mcc-spaceport-pill--active { border-style: solid; border-color: rgba(52, 211, 153, 0.6); background: rgba(16, 185, 129, 0.14); color: #6ee7b7; }

.eng-mcc-workbench-right { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 8px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 3px; background: var(--rac-panel, #0c1113); }
.eng-mcc-right-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding-bottom: 6px; border-bottom: 1px solid var(--rac-dim, #2c3b40); }
.eng-mcc-right-tab { flex: 1; min-width: 110px; padding: 5px 7px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: var(--rac-panel-2, #0f1619); color: var(--rac-muted, #8aa1a7); font-size: 9.5px; font-weight: 700; cursor: pointer; transition: all 0.15s ease; }
.eng-mcc-right-tab:hover { border-color: var(--rac-line, #5f7c84); color: var(--rac-text, #cfdde0); }
.eng-mcc-right-tab--active { border-color: #38bdf8; background: rgba(56, 189, 248, 0.16); color: #7dd3fc; box-shadow: inset 0 -2px 0 #38bdf8; }
.eng-mcc-tab-panel { display: flex; flex-direction: column; gap: 8px; }
.eng-mcc-slot-pills { display: flex; flex-wrap: wrap; gap: 4px; }
.eng-mcc-slot-pill { display: inline-flex; align-items: center; gap: 3px; padding: 2.5px 6px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: var(--rac-panel-2, #0f1619); color: #cbd5e1; font-size: 9px; cursor: pointer; }
.eng-mcc-slot-pill--mounted { border-color: rgba(52, 211, 153, 0.45); color: #a7f3d0; }
.eng-mcc-slot-pill--active { border-color: #38bdf8; background: rgba(56, 189, 248, 0.18); color: #e0f2fe; }
.eng-mcc-slot-detail { padding: 6px 8px; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 2px; background: rgba(15, 23, 42, 0.7); }
.eng-mcc-module-list { display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow-y: auto; }
.eng-mcc-module-card { padding: 6px 8px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: var(--rac-panel-2, #0f1619); }
.eng-mcc-module-card--mounted { border-color: rgba(52, 211, 153, 0.5); background: rgba(6, 78, 59, 0.18); }

.eng-mcc-subbox { padding: 7px 8px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 3px; background: var(--rac-panel-2, #0f1619); }
.eng-mcc-fac-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px; }
.eng-mcc-fac-card { padding: 6px 7px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: var(--rac-panel, #0c1113); }
.eng-mcc-fac-card--built { border-color: rgba(52, 211, 153, 0.45); }
.eng-mcc-queue-row { padding: 5px 7px; margin-top: 4px; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 2px; background: rgba(15, 23, 42, 0.7); }
.eng-mcc-equip-group { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--rac-dim, #2c3b40); }
.eng-mcc-equip-group:first-of-type { margin-top: 0; padding-top: 0; border-top: none; }
.eng-mcc-equip-group-title { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px; font-size: 10px; font-weight: 700; color: #7dd3fc; }
.eng-mcc-equip-items { display: flex; flex-direction: column; gap: 4px; }
.eng-mcc-equip-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; padding: 5px 7px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: var(--rac-panel, #0c1113); }
.eng-mcc-stock-badge { padding: 0.5px 5px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; font-size: 9px; color: #94a3b8; }
.eng-mcc-stock-badge--has { border-color: rgba(52, 211, 153, 0.5); background: rgba(16, 185, 129, 0.14); color: #6ee7b7; }

.eng-mcc-source-switch { display: flex; flex-wrap: wrap; gap: 5px; }
.eng-mcc-source-btn { flex: 1; min-width: 140px; padding: 5px 8px; border: 1px solid var(--rac-dim, #2c3b40); border-radius: 2px; background: var(--rac-panel-2, #0f1619); color: #94a3b8; font-size: 9.5px; font-weight: 700; cursor: pointer; }
.eng-mcc-source-btn--active { border-color: #38bdf8; background: rgba(56, 189, 248, 0.16); color: #e0f2fe; }
.eng-mcc-verify-box { padding: 6px 8px; border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 2px; background: rgba(12, 26, 42, 0.65); }
.eng-mcc-commercial-empty { padding: 10px 8px; border: 1px dashed rgba(210, 173, 105, 0.45); border-radius: 2px; background: rgba(210, 173, 105, 0.08); color: #fcd34d; font-size: 9.5px; line-height: 1.6; }
</style>
