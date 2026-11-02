<template>
  <Transition name="ra-modal">
    <div
      v-if="open"
      ref="backdropRef"
      class="ra-modal-mask fixed inset-0 z-10010 flex items-center justify-center p-3"
      data-test="modal-situation-mask"
      @click.self="$emit('close')"
    >
      <section
        ref="panelRef"
        class="ra-modal-card ob-panel flex max-h-[88vh] w-full max-w-[960px] flex-col overflow-hidden rounded-[4px] select-none"
        role="dialog"
        aria-modal="true"
        aria-label="战区舆情与暴露态势中枢"
        data-test="modal-situation"
      >
        <!-- ── 顶栏：战区舆情与暴露态势中枢 ── -->
        <header class="ra-modal-header flex items-center justify-between border-b px-3.5 py-2.5">
          <div class="flex items-center gap-2">
            <span class="ra-modal-icon"><Icon name="eye" :size="14" /></span>
            <span class="ra-modal-title text-[13px] font-bold tracking-wide">
              战区舆情与暴露态势中枢 · SITUATION &amp; CIVIC COMMAND
            </span>
          </div>
          <button
            type="button"
            class="ra-modal-close rounded-[2px] p-1 transition-colors"
            aria-label="关闭弹窗"
            data-test="modal-situation-close"
            @click="$emit('close')"
          >
            <Icon name="close" :size="12" />
          </button>
        </header>

        <!-- ── 顶栏下方：双页签切换条 + 核心指标速览 ── -->
        <div
          class="sit-subbar flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2"
        >
          <div class="flex items-center gap-2" role="tablist" aria-label="态势总控页签">
            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === 'morale'"
              data-test="tab-morale"
              data-testid="tab-morale"
              class="sit-tab-btn inline-flex items-center gap-1.5"
              :class="{ 'sit-tab-btn--active': activeTab === 'morale' }"
              @click="switchTab('morale')"
            >
              <Icon name="factions" :size="12" />
              <span>民心舆情与市政</span>
              <span class="sit-tab-pill font-mono text-[11px]">
                {{
                  model.moraleTab.header.stage === '无人在意'
                    ? '无人在意'
                    : `${model.moraleTab.header.valueText} · ${model.moraleTab.header.stage}`
                }}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === 'exposure'"
              data-test="tab-exposure"
              data-testid="tab-exposure"
              class="sit-tab-btn inline-flex items-center gap-1.5"
              :class="{ 'sit-tab-btn--active': activeTab === 'exposure' }"
              @click="switchTab('exposure')"
            >
              <Icon name="eye" :size="12" />
              <span>暴露等级与底线拆解</span>
              <span class="sit-tab-pill font-mono text-[11px]">
                {{ model.exposureTab.header.valueText }} · {{ model.exposureTab.header.code }}
              </span>
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span class="sit-meta-chip rounded-[2px] border px-2 py-0.5">
              常驻底线: {{ model.exposureTab.header.floorText }}
            </span>
            <span class="sit-meta-chip rounded-[2px] border px-2 py-0.5">
              民生滋养: {{ model.moraleTab.civicMatrix.totalMonthlyBonusText }}
            </span>
          </div>
        </div>

        <!-- ── 主体滚动内容区 ── -->
        <div class="ra-modal-body flex-1 overflow-y-auto px-4 py-3">
          <!-- ════════════════════════════════════════════════════════════════ -->
          <!-- TAB 1：民心舆情与市政 -->
          <!-- ════════════════════════════════════════════════════════════════ -->
          <div v-if="activeTab === 'morale'" class="flex flex-col gap-3" data-test="panel-morale">
            <!-- 1. 破冰头栏与五阶刻度尺 -->
            <section
              class="sit-card rounded-[3px] border p-3"
              data-test="morale-header-card"
            >
              <div class="flex flex-wrap items-center justify-between gap-2 border-b pb-2" style="border-color: var(--rac-dim)">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-[12px] font-bold" style="color: var(--rac-hi)">
                    ◆ 战区民心指数
                  </span>
                  <span
                    class="font-mono text-[16px] font-bold"
                    style="color: var(--rac-hi)"
                    data-test="morale-header-value"
                  >
                    {{ model.moraleTab.header.engaged ? model.moraleTab.header.valueText : '—' }}
                  </span>
                  <span
                    class="sit-badge rounded-[2px] border px-2 py-0.5 font-mono text-[11px] font-bold"
                    :class="moraleStageBadgeClass(model.moraleTab.header.stage)"
                    data-test="morale-header-stage"
                  >
                    {{ model.moraleTab.header.stage }}
                  </span>
                  <span
                    class="sit-badge rounded-[2px] border px-2 py-0.5 font-mono text-[11px]"
                    data-test="morale-header-engaged"
                  >
                    {{ model.moraleTab.header.engaged ? '已破冰入世' : '隐蔽潜伏 · 未入世' }}
                  </span>
                  <span class="font-mono text-[11px]" style="color: var(--rac-muted)">
                    态势：{{ model.moraleTab.header.trendText }}
                  </span>
                </div>
                <span class="font-mono text-[11px]" style="color: var(--rac-accent)" data-test="morale-next-stage-hint">
                  {{ model.moraleTab.header.nextStageHint }}
                </span>
              </div>

              <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span style="color: var(--rac-text)">
                  <strong style="color: var(--rac-muted)">最近舆情记录：</strong>{{ model.moraleTab.header.lastEventText }}
                </span>
                <span class="font-mono" style="color: var(--rac-muted)">
                  {{ model.moraleTab.header.effectSummary }}
                </span>
              </div>

              <!-- 五阶刻度尺 -->
              <div
                class="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-5"
                data-test="morale-stage-ladder"
              >
                <div
                  v-for="item in model.moraleTab.stageLadder"
                  :key="item.stage"
                  class="sit-ladder-cell flex flex-col justify-between rounded-[2px] border p-2 text-[11px]"
                  :class="{ 'sit-ladder-cell--active': item.active }"
                  :data-stage="item.stage"
                  :data-active="item.active ? 'true' : 'false'"
                >
                  <div>
                    <div class="flex items-center justify-between gap-1 font-bold">
                      <span style="color: var(--rac-hi)">{{ item.stage }}</span>
                      <span class="font-mono" style="color: var(--rac-muted)">{{ item.rangeText }}</span>
                    </div>
                    <div class="mt-1 font-mono" style="color: var(--rac-accent)">
                      {{ item.chainBonusText }}
                    </div>
                    <div class="font-mono" style="color: var(--rac-text)">
                      暴露 {{ item.exposureDriftText }}
                    </div>
                  </div>
                  <p class="mt-1.5 leading-snug" style="color: var(--rac-muted)">
                    {{ item.desc }}
                  </p>
                </div>
              </div>
            </section>

            <!-- 2. 跨系统实时增益 / 惩罚算力板 -->
            <section
              class="grid grid-cols-1 gap-2.5 sm:grid-cols-3"
              data-test="morale-active-effects"
            >
              <div class="sit-card rounded-[3px] border p-2.5 text-[11px]">
                <div class="font-bold" style="color: var(--rac-muted)">▸ 商路与资金链民心修正</div>
                <div class="mt-1 flex items-baseline justify-between gap-2">
                  <span class="font-mono text-[13px] font-bold" style="color: var(--rac-hi)">
                    {{ model.moraleTab.activeEffects.chainBonusText }}
                  </span>
                  <span
                    class="font-mono font-bold"
                    :class="
                      model.moraleTab.activeEffects.moraleDailyCreditsDelta > 0
                        ? 'sit-text--ok'
                        : model.moraleTab.activeEffects.moraleDailyCreditsDelta < 0
                          ? 'sit-text--alert'
                          : 'sit-text--muted'
                    "
                    data-test="morale-credits-delta"
                  >
                    {{ model.moraleTab.activeEffects.moraleDailyCreditsDeltaText }}
                  </span>
                </div>
                <div class="mt-1 font-mono" style="color: var(--rac-muted)">
                  在册正向商路标称日收：{{ model.moraleTab.activeEffects.baseDailyPositiveCredits }} Credits / 日
                </div>
              </div>

              <div class="sit-card rounded-[3px] border p-2.5 text-[11px]">
                <div class="font-bold" style="color: var(--rac-muted)">▸ 民众掩护与暴露联动漂移</div>
                <div
                  class="mt-1 font-mono text-[12px] font-bold"
                  :class="
                    model.moraleTab.activeEffects.exposureDriftPerTurn < 0
                      ? 'sit-text--ok'
                      : model.moraleTab.activeEffects.exposureDriftPerTurn > 0
                        ? 'sit-text--alert'
                        : 'sit-text--muted'
                  "
                  data-test="morale-exposure-drift"
                >
                  {{ model.moraleTab.activeEffects.exposureDriftText }}
                </div>
                <div class="mt-1" style="color: var(--rac-muted)">
                  安居归心及以上提供民众掩护加速冷却；人心惶惶及以下引发流言告密。
                </div>
              </div>

              <div class="sit-card rounded-[3px] border p-2.5 text-[11px]">
                <div class="font-bold" style="color: var(--rac-muted)">▸ 民间眼线与辖区治安阈值</div>
                <div
                  class="mt-1 font-mono font-bold"
                  :class="model.moraleTab.activeEffects.informantChannelUnlocked ? 'sit-text--ok' : 'sit-text--muted'"
                  data-test="informant-channel-badge"
                >
                  {{ model.moraleTab.activeEffects.informantChannelText }}
                </div>
                <div
                  class="mt-1 font-mono"
                  :class="model.moraleTab.activeEffects.crisisQuestTriggered ? 'sit-text--alert font-bold' : 'sit-text--muted'"
                  data-test="crisis-quest-badge"
                >
                  {{ model.moraleTab.activeEffects.crisisAlertText }}
                </div>
              </div>
            </section>

            <!-- 3. 驻地民生与环保公共设施盘点矩阵 -->
            <section
              class="sit-card rounded-[3px] border p-3"
              data-test="morale-civic-matrix"
            >
              <div class="flex flex-wrap items-center justify-between gap-2 border-b pb-2" style="border-color: var(--rac-dim)">
                <div class="flex items-center gap-2">
                  <Icon name="civic" :size="13" />
                  <span class="text-[12px] font-bold" style="color: var(--rac-hi)">
                    驻地民生与环保公共设施盘点矩阵
                  </span>
                  <span class="sit-badge rounded-[2px] border px-1.5 py-0.5 font-mono text-[11px]">
                    已建 {{ model.moraleTab.civicMatrix.installed.length }} 座
                  </span>
                </div>
                <span class="font-mono text-[11px] font-bold" style="color: var(--rac-ok)" data-test="civic-total-monthly">
                  正常运转月度滋养合计：{{ model.moraleTab.civicMatrix.totalMonthlyBonusText }}
                </span>
              </div>

              <!-- 基地缺电导致净水/污水停供高危预警 -->
              <div
                v-if="model.moraleTab.civicMatrix.hasPowerOutageAlert"
                class="sit-alert-banner mt-2 rounded-[2px] border px-2.5 py-1.5 text-[11px] font-bold"
                data-test="civic-power-outage-alert"
              >
                ▲ {{ model.moraleTab.civicMatrix.powerOutageAlertText }}
              </div>

              <div class="mt-2.5 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <!-- 已建民生设施列表 -->
                <div data-test="civic-installed-list">
                  <div class="mb-1.5 text-[11px] font-bold" style="color: var(--rac-muted)">
                    ▸ 在役民生与环保设施明细
                  </div>
                  <div
                    v-if="model.moraleTab.civicMatrix.installed.length === 0"
                    class="sit-empty rounded-[2px] border border-dashed p-2.5 text-[11px]"
                  >
                    当前各驻地尚未建成任何民生或环保公共设施。
                  </div>
                  <div v-else class="flex flex-col gap-1.5">
                    <div
                      v-for="(inst, idx) in model.moraleTab.civicMatrix.installed"
                      :key="`${inst.baseName}-${inst.buildingName}-${idx}`"
                      class="sit-row-card flex flex-wrap items-center justify-between gap-2 rounded-[2px] border px-2.5 py-1.5 text-[11px]"
                      :class="`sit-row-card--${inst.tone}`"
                      data-test="civic-installed-item"
                    >
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span class="font-bold" style="color: var(--rac-hi)">{{ inst.buildingName }}</span>
                        <span class="font-mono" style="color: var(--rac-muted)">[{{ inst.baseName }}]</span>
                      </div>
                      <div class="flex flex-wrap items-center gap-2 font-mono">
                        <span
                          class="sit-badge rounded-[2px] border px-1.5 py-0.5"
                          :class="`sit-badge--${inst.tone}`"
                        >
                          {{ inst.statusBadgeText }}
                        </span>
                        <span class="font-bold" style="color: var(--rac-text)">{{ inst.monthlyBonusText }}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 待建核心民生短板推荐 -->
                <div data-test="civic-missing-list">
                  <div class="mb-1.5 text-[11px] font-bold" style="color: var(--rac-muted)">
                    ▸ 待建核心民生短板推荐
                  </div>
                  <div
                    v-if="model.moraleTab.civicMatrix.missingRecommendations.length === 0"
                    class="sit-empty rounded-[2px] border border-dashed p-2.5 text-[11px]"
                  >
                    核心民生与环保公共设施体系已全部配齐。
                  </div>
                  <div v-else class="flex flex-col gap-1.5">
                    <div
                      v-for="rec in model.moraleTab.civicMatrix.missingRecommendations"
                      :key="rec.name"
                      class="sit-row-card flex items-center justify-between gap-2 rounded-[2px] border px-2.5 py-1.5 text-[11px]"
                      data-test="civic-missing-item"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="font-bold" style="color: var(--rac-hi)">{{ rec.name }}</span>
                          <span class="font-mono" style="color: var(--rac-ok)">首建 {{ rec.firstBuildBonusText }}</span>
                          <span class="font-mono" style="color: var(--rac-accent)">{{ rec.monthlyBonusText }}</span>
                        </div>
                        <div class="truncate" style="color: var(--rac-muted)">{{ rec.roleDesc }}</div>
                      </div>
                      <button
                        type="button"
                        class="sit-action-btn shrink-0 rounded-[2px] border px-2 py-1 font-mono text-[11px] font-bold"
                        data-test="jump-build-civic-btn"
                        @click="handleJumpToBuild(rec.name)"
                      >
                        前往建造
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- 4. 分基地辖区民心与地方势力态度同屏对照 -->
            <section
              class="grid grid-cols-1 gap-3 lg:grid-cols-2"
              data-test="morale-regional-overview"
            >
              <!-- 分基地辖区民心 -->
              <div class="sit-card rounded-[3px] border p-3" data-test="regional-bases-list">
                <div class="mb-2 flex items-center justify-between border-b pb-1.5 text-[12px] font-bold" style="border-color: var(--rac-dim); color: var(--rac-hi)">
                  <span>◆ 分基地辖区民心状态</span>
                  <span class="font-mono text-[11px]" style="color: var(--rac-muted)">
                    在役驻地 {{ model.moraleTab.regionalOverview.bases.length }} 座
                  </span>
                </div>
                <div
                  v-if="model.moraleTab.regionalOverview.bases.length === 0"
                  class="sit-empty rounded-[2px] border border-dashed p-2.5 text-[11px]"
                >
                  暂无在役基地辖区记录。
                </div>
                <div v-else class="flex flex-col gap-1.5">
                  <div
                    v-for="b in model.moraleTab.regionalOverview.bases"
                    :key="b.baseId"
                    class="sit-row-card flex flex-wrap items-center justify-between gap-2 rounded-[2px] border px-2.5 py-1.5 text-[11px]"
                    data-test="regional-base-item"
                  >
                    <div>
                      <span class="font-bold" style="color: var(--rac-hi)">{{ b.baseName }}</span>
                      <span class="ml-1.5" style="color: var(--rac-muted)">{{ b.location }}</span>
                    </div>
                    <div class="flex flex-wrap items-center gap-2 font-mono">
                      <span style="color: var(--rac-muted)">民生设施 {{ b.civicCount }} 座</span>
                      <span style="color: var(--rac-accent)">
                        {{ b.isLocalOverride ? '独立辖区' : '全局同步' }}
                      </span>
                      <span class="font-bold" style="color: var(--rac-hi)">
                        {{ b.localStage === '无人在意' ? '无人在意' : `${b.localMoraleText} · ${b.localStage}` }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 周边地方势力态度对照表 -->
              <div class="sit-card rounded-[3px] border p-3" data-test="regional-factions-list">
                <div class="mb-2 flex items-center justify-between border-b pb-1.5 text-[12px] font-bold" style="border-color: var(--rac-dim); color: var(--rac-hi)">
                  <span>◆ 周边地方势力态度与关联商路</span>
                  <span class="font-mono text-[11px]" style="color: var(--rac-muted)">
                    在册势力 {{ model.moraleTab.regionalOverview.factions.length }} 方
                  </span>
                </div>
                <div
                  v-if="model.moraleTab.regionalOverview.factions.length === 0"
                  class="sit-empty rounded-[2px] border border-dashed p-2.5 text-[11px]"
                >
                  尚未接触登记任何周边地方势力。
                </div>
                <div v-else class="flex flex-col gap-1.5">
                  <div
                    v-for="fac in model.moraleTab.regionalOverview.factions"
                    :key="fac.name"
                    class="sit-row-card flex flex-col gap-1 rounded-[2px] border px-2.5 py-1.5 text-[11px]"
                    data-test="regional-faction-item"
                  >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <span class="font-bold" style="color: var(--rac-hi)">{{ fac.name }}</span>
                      <div class="flex items-center gap-1.5 font-mono">
                        <span class="sit-badge rounded-[2px] border px-1.5 py-0.5">
                          态度：{{ fac.attitude }}
                        </span>
                        <span class="sit-badge rounded-[2px] border px-1.5 py-0.5">
                          风险：{{ fac.risk }}
                        </span>
                      </div>
                    </div>
                    <div style="color: var(--rac-muted)">{{ fac.intel }}</div>
                    <div class="font-mono" style="color: var(--rac-accent)">
                      关联商路：{{ fac.linkedChains.length > 0 ? fac.linkedChains.join('、') : '暂无绑定商路' }}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- 5. 快捷抚民与市政调度芯片 -->
            <section
              class="sit-card rounded-[3px] border p-3"
              data-test="morale-quick-actions"
            >
              <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span class="font-bold" style="color: var(--rac-hi)">
                  ▸ 快捷抚民与市政调度指令（点击填入聊天输入框）
                </span>
                <span
                  v-if="copiedActionLabel"
                  class="font-mono font-bold"
                  style="color: var(--rac-ok)"
                  data-test="quick-action-feedback"
                >
                  已填入/复制指令：{{ copiedActionLabel }}
                </span>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="act in model.moraleTab.quickActions"
                  :key="act.id"
                  type="button"
                  class="sit-chip-btn rounded-[2px] border px-2.5 py-1.5 text-left font-mono text-[11px] font-bold transition-colors"
                  data-test="quick-action-chip"
                  :data-action-id="act.id"
                  @click="handleTriggerQuickAction(act)"
                >
                  <span style="color: var(--rac-accent)">[{{ act.tag }}]</span>
                  <span class="ml-1">{{ act.label }}</span>
                </button>
              </div>
            </section>
          </div>

          <!-- ════════════════════════════════════════════════════════════════ -->
          <!-- TAB 2：暴露等级与底线拆解 -->
          <!-- ════════════════════════════════════════════════════════════════ -->
          <div v-else class="flex flex-col gap-3" data-test="panel-exposure">
            <!-- 1. 暴露头栏与 EL-0~EL-4 五级法定标尺 -->
            <section
              class="sit-card rounded-[3px] border p-3"
              data-test="exposure-header-card"
            >
              <div class="flex flex-wrap items-center justify-between gap-2 border-b pb-2" style="border-color: var(--rac-dim)">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-[12px] font-bold" style="color: var(--rac-hi)">
                    ◆ 当前战区暴露度
                  </span>
                  <span
                    class="font-mono text-[16px] font-bold"
                    style="color: var(--rac-hi)"
                    data-test="exposure-header-value"
                  >
                    {{ model.exposureTab.header.valueText }}
                  </span>
                  <span
                    class="sit-badge rounded-[2px] border px-2 py-0.5 font-mono text-[11px] font-bold"
                    :class="exposureCodeBadgeClass(model.exposureTab.header.code)"
                    data-test="exposure-header-code"
                  >
                    {{ model.exposureTab.header.canonicalLabel }}
                  </span>
                  <span
                    class="sit-badge rounded-[2px] border px-2 py-0.5 font-mono text-[11px]"
                    data-test="exposure-header-floor"
                  >
                    常驻底线 {{ model.exposureTab.header.floorText }}
                  </span>
                  <span class="font-mono text-[11px]" style="color: var(--rac-muted)">
                    态势：{{ model.exposureTab.header.trendText }}
                  </span>
                </div>
                <span
                  v-if="model.exposureTab.header.irreversibleLocked"
                  class="sit-alert-banner rounded-[2px] border px-2 py-0.5 font-mono text-[11px] font-bold"
                  data-test="exposure-irreversible-badge"
                >
                  ★ EL-4 [R] 位面出圈永久锁定（底线锁定 9.0）
                </span>
              </div>

              <div class="mt-2 text-[11px]" style="color: var(--rac-text)">
                <strong style="color: var(--rac-muted)">最近暴露事件：</strong>{{ model.exposureTab.header.lastEventText }}
              </div>

              <!-- EL-0 ~ EL-4 五级标尺 -->
              <div
                class="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-5"
                data-test="exposure-level-ladder"
              >
                <div
                  v-for="lv in model.exposureTab.levelLadder"
                  :key="lv.code"
                  class="sit-ladder-cell flex flex-col justify-between rounded-[2px] border p-2 text-[11px]"
                  :class="{ 'sit-ladder-cell--active': lv.active }"
                  :data-level-code="lv.code"
                  :data-active="lv.active ? 'true' : 'false'"
                >
                  <div>
                    <div class="flex items-center justify-between gap-1 font-bold">
                      <span class="font-mono" style="color: var(--rac-hi)">{{ lv.code }} · {{ lv.shortName }}</span>
                      <span class="font-mono" style="color: var(--rac-muted)">{{ lv.rangeText }}</span>
                    </div>
                    <div
                      class="mt-1 font-mono"
                      :style="{ color: lv.canNaturalDecay ? 'var(--rac-ok)' : 'var(--rac-warn)' }"
                    >
                      {{ lv.canNaturalDecay ? '可自然冷却' : '不可自然冷却' }}
                    </div>
                  </div>
                  <p class="mt-1.5 leading-snug" style="color: var(--rac-muted)">
                    {{ lv.consequenceText }}
                  </p>
                </div>
              </div>
            </section>

            <!-- 2. 常驻暴露底线分基地物理来源拆解 -->
            <section
              class="sit-card rounded-[3px] border p-3"
              data-test="exposure-floor-breakdown"
            >
              <div class="mb-2 flex flex-wrap items-center justify-between gap-2 border-b pb-1.5" style="border-color: var(--rac-dim)">
                <span class="text-[12px] font-bold" style="color: var(--rac-hi)">
                  ◆ 常驻暴露底线物理成因拆解
                </span>
                <span class="font-mono text-[11px] font-bold" style="color: var(--rac-accent)">
                  全战区生效常驻底线：{{ model.exposureTab.floorBreakdown.totalFloorText }}
                </span>
              </div>

              <div
                v-if="model.exposureTab.floorBreakdown.bases.length === 0"
                class="sit-empty rounded-[2px] border border-dashed p-2.5 text-[11px]"
              >
                当前无在役地面基地，常驻暴露底线为 0.0。
              </div>
              <div v-else class="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div
                  v-for="b in model.exposureTab.floorBreakdown.bases"
                  :key="b.baseId"
                  class="sit-row-card flex flex-col gap-1 rounded-[2px] border p-2.5 text-[11px]"
                  data-test="exposure-base-floor-card"
                >
                  <div class="flex items-center justify-between border-b pb-1" style="border-color: var(--rac-dim)">
                    <span class="font-bold" style="color: var(--rac-hi)">
                      {{ b.baseName }} · {{ b.siteTypeLabel }}
                    </span>
                    <span class="font-mono font-bold" style="color: var(--rac-accent)">
                      净底线 {{ b.netBaseFloorText }}
                    </span>
                  </div>
                  <div class="font-mono" style="color: var(--rac-text)">
                    · 多阵营混建摩擦：{{ b.factionMixText }}
                  </div>
                  <div class="font-mono" style="color: var(--rac-text)">
                    · 地表重型信标源：{{ b.heavyBeaconText }}
                  </div>
                  <div class="font-mono" style="color: var(--rac-ok)">
                    · 伪装与反侦察抵消：{{ b.stealthShieldText }}
                  </div>
                  <div class="font-mono" style="color: var(--rac-muted)">
                    · 选址环境修正：{{ b.siteModifierText }}
                  </div>
                </div>
              </div>
            </section>

            <!-- 3. 每轮自然冷却与民心掩护/告密修正合成说明 -->
            <section
              class="sit-card rounded-[3px] border p-3 text-[11px]"
              data-test="exposure-drift-summary"
            >
              <div class="mb-2 border-b pb-1.5 text-[12px] font-bold" style="border-color: var(--rac-dim); color: var(--rac-hi)">
                ◆ 平静轮次自然冷却与民心联动漂移核算
              </div>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-3 font-mono">
                <div class="sit-row-card rounded-[2px] border p-2">
                  <div style="color: var(--rac-muted)">基础自然冷却</div>
                  <div class="mt-0.5 font-bold" style="color: var(--rac-hi)">
                    {{ model.exposureTab.driftSummary.baseNaturalCoolText }}
                  </div>
                </div>
                <div class="sit-row-card rounded-[2px] border p-2">
                  <div style="color: var(--rac-muted)">民心掩护 / 告密修正</div>
                  <div class="mt-0.5 font-bold" style="color: var(--rac-hi)">
                    {{ model.exposureTab.driftSummary.moraleDriftText }}
                  </div>
                </div>
                <div class="sit-row-card rounded-[2px] border p-2">
                  <div style="color: var(--rac-muted)">平静轮次预计净漂移</div>
                  <div class="mt-0.5 font-bold" style="color: var(--rac-accent)">
                    {{ model.exposureTab.driftSummary.netDriftText }}
                  </div>
                </div>
              </div>
              <p class="mt-2" style="color: var(--rac-muted)">
                {{ model.exposureTab.driftSummary.formulaSummaryText }}
              </p>
            </section>

            <!-- 4. 反侦察与降敏快捷指令芯片 -->
            <section
              class="sit-card rounded-[3px] border p-3"
              data-test="exposure-quick-actions"
            >
              <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span class="font-bold" style="color: var(--rac-hi)">
                  ▸ 反侦察与降敏快捷调度指令（点击填入聊天输入框）
                </span>
                <span
                  v-if="copiedActionLabel"
                  class="font-mono font-bold"
                  style="color: var(--rac-ok)"
                  data-test="quick-action-feedback"
                >
                  已填入/复制指令：{{ copiedActionLabel }}
                </span>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="act in model.exposureTab.quickActions"
                  :key="act.id"
                  type="button"
                  class="sit-chip-btn rounded-[2px] border px-2.5 py-1.5 text-left font-mono text-[11px] font-bold transition-colors"
                  data-test="quick-action-chip"
                  :data-action-id="act.id"
                  @click="handleTriggerQuickAction(act)"
                >
                  <span style="color: var(--rac-accent)">[{{ act.tag }}]</span>
                  <span class="ml-1">{{ act.label }}</span>
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { getActivePinia } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useDataStore } from '../../红警指挥系统/composables/store';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import type { ExposureLevelCode, MoraleStageName } from '../../红警指挥系统/engines/exposureMoraleEngine';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { fillHostSendInput } from '../../红警指挥系统/worldbook/hostSendInput';
import {
  buildSituationPanelModel,
  type SituationQuickActionChip,
  type SituationTabKey,
} from '../models/situationPanelModel';

const props = withDefaults(
  defineProps<{
    open?: boolean;
    initialTab?: SituationTabKey;
    snapshot?: unknown;
  }>(),
  {
    open: true,
    initialTab: 'morale',
    snapshot: null,
  },
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'jump-to-build', buildingName?: string): void;
}>();

const backdropRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);

const activeTab = ref<SituationTabKey>(props.initialTab === 'exposure' ? 'exposure' : 'morale');
const copiedActionLabel = ref('');
const lastDispatchedPrompt = ref('');

watch(
  [() => props.open, () => props.initialTab],
  ([isOpen, nextTab]) => {
    if (isOpen && (nextTab === 'morale' || nextTab === 'exposure')) {
      activeTab.value = nextTab;
    }
  },
  { immediate: true },
);

function switchTab(tab: SituationTabKey) {
  activeTab.value = tab;
}

function resolveStateRoot(): unknown {
  if (props.snapshot && typeof props.snapshot === 'object') {
    return props.snapshot;
  }
  try {
    const pinia = getActivePinia();
    if (pinia) {
      const floating = (useFloatingStore as unknown as (p?: unknown) => Record<string, unknown>)(pinia);
      if (floating?.snapshot && typeof floating.snapshot === 'object') {
        return floating.snapshot;
      }
      const dataStore = (useDataStore as unknown as (p?: unknown) => Record<string, unknown>)(pinia);
      if (dataStore?.stat && typeof dataStore.stat === 'object') {
        return dataStore.stat;
      }
    }
  } catch {
    /* ignore */
  }
  return {};
}

const model = computed(() => buildSituationPanelModel(resolveStateRoot()));

function handleJumpToBuild(buildingName?: string) {
  emit('jump-to-build', buildingName);
  emit('close');
}

function handleTriggerQuickAction(action: SituationQuickActionChip) {
  lastDispatchedPrompt.value = action.prompt;
  copiedActionLabel.value = action.label;
  try {
    fillHostSendInput(action.prompt);
  } catch {
    /* ignore */
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(action.prompt).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

function moraleStageBadgeClass(stage: MoraleStageName): string {
  switch (stage) {
    case '万众一心':
    case '安居归心':
      return 'sit-badge--ok';
    case '人心惶惶':
      return 'sit-badge--warn';
    case '沸反盈天':
      return 'sit-badge--alert';
    default:
      return 'sit-badge--neutral';
  }
}

function exposureCodeBadgeClass(code: ExposureLevelCode): string {
  switch (code) {
    case 'EL-4':
    case 'EL-3':
      return 'sit-badge--alert';
    case 'EL-2':
      return 'sit-badge--warn';
    case 'EL-0':
      return 'sit-badge--ok';
    default:
      return 'sit-badge--neutral';
  }
}

defineExpose({
  activeTab,
  switchTab,
  model,
  copiedActionLabel,
  lastDispatchedPrompt,
  handleJumpToBuild,
  handleTriggerQuickAction,
});
</script>

<style scoped>
.ra-modal-mask {
  z-index: 10010;
  background: rgba(0, 0, 0, 0.76);
}

.ra-modal-card {
  background: var(--rac-bg);
  border: 1px solid var(--rac-line);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.85),
    0 0 0 1px color-mix(in srgb, var(--rac-line) 20%, transparent);
}

.sit-subbar {
  border-color: var(--rac-dim);
  background: var(--rac-panel-2);
}

.sit-tab-btn {
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 2px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel);
  color: var(--rac-muted);
  cursor: pointer;
  transition: all 0.14s ease;
}

.sit-tab-btn:hover {
  color: var(--rac-hi);
  border-color: var(--rac-line);
}

.sit-tab-btn--active {
  background: color-mix(in srgb, var(--rac-accent) 18%, var(--rac-panel-2));
  color: var(--rac-hi);
  border-color: var(--rac-accent);
  box-shadow: inset 0 -2px 0 var(--rac-accent);
}

.sit-tab-pill {
  padding: 1px 5px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.28);
  color: var(--rac-text);
}

.sit-meta-chip {
  border-color: var(--rac-dim);
  background: var(--rac-panel);
  color: var(--rac-text);
}

.sit-card {
  border-color: var(--rac-dim);
  background: var(--rac-panel);
}

.sit-ladder-cell {
  border-color: var(--rac-dim);
  background: var(--rac-panel-2);
}

.sit-ladder-cell--active {
  border-color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 15%, var(--rac-panel-2));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rac-accent) 45%, transparent);
}

.sit-row-card {
  border-color: var(--rac-dim);
  background: var(--rac-panel-2);
}

.sit-row-card--ok {
  border-left: 2px solid var(--rac-ok);
}

.sit-row-card--warn {
  border-left: 2px solid var(--rac-warn);
}

.sit-row-card--alert {
  border-left: 2px solid var(--rac-alert);
  background-image: var(--rac-hatch-alert);
}

.sit-badge {
  border-color: var(--rac-dim);
  background: var(--rac-panel-2);
  color: var(--rac-text);
}

.sit-badge--ok {
  border-color: color-mix(in srgb, var(--rac-ok) 55%, transparent);
  background: color-mix(in srgb, var(--rac-ok) 14%, var(--rac-panel-2));
  color: var(--rac-ok);
}

.sit-badge--warn {
  border-color: color-mix(in srgb, var(--rac-warn) 55%, transparent);
  background: color-mix(in srgb, var(--rac-warn) 14%, var(--rac-panel-2));
  color: var(--rac-warn);
}

.sit-badge--alert {
  border-color: color-mix(in srgb, var(--rac-alert) 65%, transparent);
  background: color-mix(in srgb, var(--rac-alert) 18%, var(--rac-panel-2));
  color: var(--rac-alert);
}

.sit-badge--neutral {
  border-color: var(--rac-dim);
  background: var(--rac-panel-2);
  color: var(--rac-muted);
}

.sit-text--ok {
  color: var(--rac-ok);
}

.sit-text--alert {
  color: var(--rac-alert);
}

.sit-text--muted {
  color: var(--rac-muted);
}

.sit-alert-banner {
  border-color: var(--rac-alert);
  background: color-mix(in srgb, var(--rac-alert) 16%, var(--rac-panel-2));
  background-image: var(--rac-hatch-alert);
  color: var(--rac-alert);
}

.sit-empty {
  border-color: var(--rac-dim);
  color: var(--rac-muted);
}

.sit-action-btn {
  border-color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 14%, var(--rac-panel));
  color: var(--rac-hi);
  cursor: pointer;
}

.sit-action-btn:hover {
  background: color-mix(in srgb, var(--rac-accent) 26%, var(--rac-panel-2));
}

.sit-chip-btn {
  border-color: var(--rac-dim);
  background: var(--rac-panel-2);
  color: var(--rac-text);
  cursor: pointer;
}

.sit-chip-btn:hover {
  border-color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 14%, var(--rac-panel-2));
  color: var(--rac-hi);
}
</style>
