<template>
  <div
    v-if="open"
    ref="backdropRef"
    class="ra-modal-mask fixed inset-0 z-[10010] flex items-center justify-center p-2 sm:p-4"
    @click.self="emit('close')"
  >
    <div
      ref="panelRef"
      class="ra-modal-card ra-armory-modal ob-panel ob-enter flex max-h-[92vh] w-full flex-col overflow-hidden"
      :class="modalSizeClass"
      :style="modalDynamicStyle"
      :data-size-mode="sizeMode"
      role="dialog"
      aria-label="军备管理"
    >
      <!-- ══ 顶栏：标题 + 四维汇总微章 + 视口尺寸切换 + 关闭 ══ -->
      <header class="ra-modal-head flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 select-none">
        <div class="flex flex-wrap items-center gap-2">
          <Icon name="shield" :size="18" class="text-(--rac-accent)" />
          <span class="mono text-[14px] font-bold tracking-[0.12em] text-(--rac-hi)">
            军备管理 · ARMAMENT &amp; MECHA COMMAND
          </span>
          <span
            class="mono rounded-[2px] border border-(--rac-accent) bg-(--rac-panel-2) px-2 py-0.5 text-[11px] font-bold text-(--rac-accent)"
          >
            {{ activeScope === 'ALL' ? '战区全局' : activeScope }}
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="hidden items-center gap-1.5 font-mono text-[11px] lg:flex">
            <span class="ob-tag">
              <b>机娘</b>
              <i class="text-(--rac-accent)">{{ vm.summary.girlsCount }}</i>
            </span>
            <span class="ob-tag">
              <b>兵力</b>
              <i class="text-(--rac-hi)">{{ vm.summary.personnelCount }}</i>
            </span>
            <span class="ob-tag">
              <b>载具</b>
              <i class="text-(--rac-ok)">{{ vm.summary.vehiclesAndAircraftCount }}</i>
            </span>
            <span v-if="vm.pendingTransfers && vm.pendingTransfers.length > 0" class="ob-tag">
              <b>调配中</b>
              <i class="text-(--rac-warn)">{{ vm.pendingTransfers.length }}</i>
            </span>
          </div>

          <button
            type="button"
            class="inline-flex cursor-pointer items-center gap-1 rounded-[2px] border border-(--rac-dim) bg-(--rac-panel-2) px-2 py-1 font-mono text-[11px] font-bold text-(--rac-accent) transition-colors hover:border-(--rac-accent) hover:text-(--rac-hi)"
            data-testid="armory-modal-size-btn"
            :title="`切换窗口尺寸（当前：${sizeModeLabel}）`"
            @click="cycleSizeMode"
          >
            <Icon name="grid" :size="12" /> {{ sizeModeLabel }}
          </button>

          <button
            type="button"
            class="ra-modal-close mono flex size-6 cursor-pointer items-center justify-center text-[13px]"
            title="关闭窗口 (ESC)"
            @click="emit('close')"
          >
            ×
          </button>
        </div>
      </header>

      <!-- ══ 双轴控制栏：维度一（战区/基地 Scope 切换器 + 实时战术检索框）+ 维度二（四维军备 Tab） ══ -->
      <div class="ra-armory-controls flex flex-col gap-2 border-b border-(--rac-line) bg-(--rac-panel) px-3.5 py-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <!-- 作用域切换器（战区全局 ALL / 各基地） -->
          <div class="flex flex-wrap items-center gap-1.5" data-testid="armory-scope-bar">
            <span class="mono mr-1 text-[11px] font-bold tracking-wider text-(--rac-muted)">战区防区 //</span>
            <button
              v-for="scopeOpt in vm.baseOptions"
              :key="scopeOpt"
              type="button"
              class="ra-scope-pill mono cursor-pointer px-2.5 py-1 text-[11px] font-bold transition-colors"
              :class="{ 'is-active': activeScope === scopeOpt }"
              :data-testid="`scope-btn-${scopeOpt}`"
              @click="selectScope(scopeOpt)"
            >
              {{ scopeOpt === 'ALL' ? '战区全局 ALL' : `◆ ${scopeOpt}` }}
            </button>
          </div>

          <!-- 实时战术搜索框 -->
          <div class="flex items-center gap-1.5">
            <div class="relative flex items-center">
              <input
                v-model.trim="searchQuery"
                type="text"
                data-testid="armory-search-input"
                placeholder="检索姓名 / 代号 / 型号 / 特征 / 驻地..."
                class="mono w-56 rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2.5 py-1 text-[11px] text-(--rac-hi) placeholder:text-(--rac-muted) focus:border-(--rac-accent) focus:outline-none sm:w-64"
              />
              <button
                v-if="searchQuery"
                type="button"
                class="mono ml-1 cursor-pointer rounded-[2px] border border-(--rac-dim) bg-(--rac-panel-2) px-1.5 py-0.5 text-[11px] text-(--rac-muted) hover:border-(--rac-warn) hover:text-(--rac-warn)"
                title="清空检索"
                @click="searchQuery = ''"
              >
                ×
              </button>
            </div>
          </div>
        </div>

        <!-- 四维军备 Tab 导航 -->
        <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4" data-testid="armory-tab-bar">
          <button
            v-for="t in tabDefs"
            :key="t.id"
            type="button"
            class="ra-armory-tab mono flex cursor-pointer items-center justify-between px-2.5 py-1.5 text-[11px] font-bold transition-colors"
            :class="{ 'is-active': activeTab === t.id }"
            :data-testid="`tab-btn-${t.id}`"
            @click="activeTab = t.id"
          >
            <span class="inline-flex items-center gap-1.5">
              <Icon :name="t.icon" :size="13" />
              <span>{{ t.label }}</span>
            </span>
            <span class="ra-tab-badge mono px-1.5 py-0.5 text-[11px]">{{ t.count }}</span>
          </button>
        </div>
      </div>

      <!-- ══ 主体内容区 ══ -->
      <div class="flex-1 overflow-y-auto p-3.5">
        <!-- ── 跨防区在途单位调配监控条（UNIT-TRANSFER-01） ── -->
        <div
          v-if="vm.pendingTransfers && vm.pendingTransfers.length > 0"
          class="ra-sub-box mb-3 flex flex-col gap-1.5 p-2.5"
          data-testid="armory-pending-transfers"
        >
          <div class="mono flex items-center justify-between text-[11px] font-bold text-(--rac-warn)">
            <span>▸ 跨防区单位调配进行中 ({{ vm.pendingTransfers.length }})</span>
            <span class="text-[11px] font-normal text-(--rac-muted)">随战区时钟自动推进到站</span>
          </div>
          <div class="flex flex-col gap-1.5">
            <div
              v-for="tr in vm.pendingTransfers"
              :key="tr.id"
              class="ra-row-card flex flex-col gap-1 px-2.5 py-2 text-[11px]"
              :data-testid="`transfer-row-${tr.unit}`"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="font-extrabold text-(--rac-hi)">
                    {{ tr.unit }}
                  </span>
                  <span v-if="tr.category !== 'girls'" class="mono font-bold text-(--rac-accent)">
                    ×{{ tr.qty }}
                  </span>
                  <span class="ra-tag-chip mono px-1.5 py-0.5 text-[11px]">
                    ◆ {{ tr.fromBase }} → ◆ {{ tr.toBase }}
                  </span>
                  <span v-if="tr.method" class="meta-chip seq-chip mono px-1.5 py-0.5 text-[11px]">
                    {{ tr.method }}
                  </span>
                </div>
                <div class="mono flex items-center gap-2 text-[11px] font-bold text-(--rac-warn)">
                  <span>进度 {{ tr.progress }}%</span>
                  <span>· 剩余 {{ tr.etaText }}</span>
                </div>
              </div>
              <div class="h-1.5 w-full overflow-hidden rounded-[2px] bg-(--rac-bg)">
                <div
                  class="h-full bg-(--rac-warn) transition-all duration-300"
                  :style="{ width: `${Math.max(4, tr.progress)}%` }"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- ────────────── TAB 1：英雄机娘（girls） ────────────── -->
        <section v-if="activeTab === 'girls'" class="flex flex-col gap-3" data-testid="panel-girls">
          <!-- 真实机娘为空：战术空态 -->
          <div
            v-if="vm.girls.isEmpty"
            class="ra-empty-box flex flex-col items-center justify-center gap-2.5 py-8 text-center"
            data-testid="girls-empty-state"
          >
            <div class="mono text-[13px] font-bold text-(--rac-hi)">
              // 当前防区（{{ activeScope === 'ALL' ? '战区全局' : activeScope }}）暂无在编机娘 //
            </div>
            <p class="max-w-[460px] text-[11px] leading-relaxed text-(--rac-muted)">
              当剧情产出 &lt;机娘档案&gt; 或战况编入机娘单位后，此处将实时呈现机娘机体型号、好感/服从指标、驻地归属与聊天绑定世界书双段正史。
            </p>
          </div>

          <!-- 机娘主从双栏视图（左：列表独立滚动，右：选中详情独立滚动 + Sticky 顶栏） -->
          <div v-else class="grid grid-cols-1 gap-3.5 md:grid-cols-12 md:items-start" data-testid="girls-master-detail">
            <!-- 左侧：机娘编成列表 -->
            <div class="ra-girls-sidebar flex flex-col gap-1.5 md:col-span-4" data-testid="girls-list">
              <div class="mono mb-0.5 flex items-center justify-between px-0.5 text-[11px] font-bold text-(--rac-muted)">
                <span>在编单位 ({{ filteredGirls.length }})</span>
                <span class="text-[11px] opacity-80">点击切换档案</span>
              </div>
              <button
                v-for="g in filteredGirls"
                :key="g.name"
                type="button"
                class="ra-girl-item girl-roster-card flex cursor-pointer flex-col gap-1.5 p-2.5 text-left transition-colors"
                :class="{ 'is-selected': currentGirl?.name === g.name }"
                :data-testid="`girl-row-${g.name}`"
                @click="selectGirl(g.name)"
              >
                <!-- 第一行：左端横向锁定姓名与代号，右端仅展示 2~3 字简短战备徽章 hpBadge -->
                <div class="flex items-center justify-between gap-2">
                  <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                    <span class="shrink-0 truncate text-[14px] font-bold tracking-wide text-(--rac-hi)">
                      {{ g.callsign && g.name === g.model ? g.callsign : g.name }}
                    </span>
                    <span
                      v-if="g.callsign && g.callsign !== g.name && g.name !== g.model"
                      class="mono truncate text-[11px] font-bold text-(--rac-warn)"
                    >
                      代号「{{ g.callsign }}」
                    </span>
                    <span
                      v-if="g.unchristened"
                      class="badge-unchristened shrink-0"
                      data-test="girl-unchristened-badge"
                    >
                      ★ 待指挥官赐名
                    </span>
                  </div>
                  <span class="ra-hp-pill mono shrink-0 px-1.5 py-0.5 text-[11px] font-bold" :data-hp="g.hpBadge">
                    {{ g.hpBadge }}
                  </span>
                </div>

                <!-- 第二行：机体型号 + 阵营芯片 + 好感/服从迷你读数 -->
                <div class="flex flex-wrap items-center justify-between gap-1.5">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="mono text-[11px] font-bold text-(--rac-accent)">{{ g.model }}</span>
                    <span v-if="g.faction" class="ra-faction-chip mono px-1.5 py-0.5 text-[11px]">
                      {{ g.faction }}
                    </span>
                  </div>
                  <span
                    v-if="g.affection !== null || g.obedience !== null"
                    class="mono text-[11px] text-(--rac-muted)"
                  >
                    好感 {{ g.affection !== null ? `${g.affection}%` : '—' }} · 服从 {{ g.obedience !== null ? `${g.obedience}%` : '—' }}
                  </span>
                </div>

                <!-- 第三行：驻地正式名称 + 编号 + 序列 + 在途调配徽标 -->
                <div class="flex flex-wrap items-center gap-1 text-[11px] text-(--rac-muted)">
                  <span class="ra-tag-chip mono px-1.5 py-0.5">◆ {{ g.base }}</span>
                  <span
                    v-if="g.activeTransfer"
                    class="ra-pending-chip mono px-1.5 py-0.5 text-(--rac-warn)"
                    :data-testid="`girl-transfer-badge-${g.name}`"
                  >
                    ▸ 调往 {{ g.activeTransfer.toBase }} · 余 {{ g.activeTransfer.etaText }}
                  </span>
                  <span v-if="g.serial" class="meta-chip serial-chip mono px-1.5 py-0.5">
                    编号: {{ g.serial }}
                  </span>
                  <span v-if="g.seq" class="meta-chip seq-chip mono px-1.5 py-0.5">
                    {{ g.seq }}
                  </span>
                  <span v-if="g.isPending" class="ra-pending-chip mono px-1.5 py-0.5">NEW · 待入档</span>
                </div>

                <!-- 第四行：实时勤务动态摘要（单行截断） -->
                <div
                  v-if="g.statusHeadline"
                  class="truncate border-t border-(--rac-dim) pt-1 text-[11px] text-(--rac-muted)"
                  :title="g.statusHeadline"
                >
                  ▸ {{ g.statusHeadline }}
                </div>
              </button>
            </div>

            <!-- 右侧：焦点机娘战术档案舱 -->
            <div v-if="focusedProfile" class="ra-girl-detail-scroll flex flex-col gap-2.5 md:col-span-8" data-testid="girl-detail-pane">
              <div class="ra-hero-card flex flex-col gap-3 p-3.5">
                <div class="dossier-header ra-dossier-sticky-head flex flex-col gap-2 pb-2.5">
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-[17px] font-extrabold tracking-wider text-(--rac-hi)">
                        {{ focusedProfile.name }}
                      </span>
                      <span
                        v-if="focusedProfile.callsign && focusedProfile.callsign !== focusedProfile.name"
                        class="mono text-[11px] font-bold text-(--rac-warn)"
                        data-test="girl-callsign"
                      >
                        代号「{{ focusedProfile.callsign }}」
                      </span>
                      <span
                        v-if="focusedProfile.unchristened"
                        class="badge-unchristened"
                        data-test="girl-unchristened-badge"
                      >
                        ★ 待指挥官赐名
                      </span>
                      <span class="mono text-[12px] font-bold text-(--rac-accent)">
                        {{ focusedProfile.model }}
                      </span>
                      <span
                        v-if="focusedProfile.serial"
                        class="meta-chip serial-chip"
                        data-test="girl-serial-chip"
                      >
                        编号: {{ focusedProfile.serial }}
                      </span>
                      <span
                        v-if="focusedProfile.seq"
                        class="meta-chip seq-chip"
                        data-test="girl-seq-chip"
                      >
                        {{ focusedProfile.seq }}
                      </span>
                      <span class="ra-hp-pill mono px-2 py-0.5 text-[11px] font-bold" :data-hp="focusedProfile.hpBadge">
                        {{ focusedProfile.hpBadge }}
                      </span>
                    </div>

                    <div class="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        class="ra-cmd-btn mono shrink-0 cursor-pointer px-2.5 py-1 text-[11px] font-bold transition-colors"
                        title="向聊天输入框填入机娘调防/勤务指令"
                        @click="stageGirlCommand(focusedProfile)"
                      >
                        拟定调防/勤务指令
                      </button>
                      <button
                        type="button"
                        class="ra-mini-btn mono shrink-0 cursor-pointer px-2.5 py-1 text-[11px] font-bold transition-colors"
                        data-testid="open-girl-drawer-btn"
                        @click="openGirlInDrawer(focusedProfile)"
                      >
                        查阅完整设定档案 ▸
                      </button>
                    </div>
                  </div>

                  <!-- 实时勤务动态横幅 -->
                  <div class="rounded-[2px] border border-(--rac-dim) bg-(--rac-panel-2) px-2.5 py-1.5 text-[11px]">
                    <div class="font-semibold text-(--rac-hi)">
                      ▸ 实时勤务动态：{{ focusedProfile.statusHeadline || focusedProfile.status }}
                    </div>
                    <div class="mono mt-0.5 text-[11px] text-(--rac-muted)">
                      驻地：{{ focusedProfile.base }} · 职责：{{ focusedProfile.duty }}
                      <span v-if="focusedProfile.callsign"> · 代号：{{ focusedProfile.callsign }}</span>
                      <span v-if="focusedProfile.faction"> · 阵营：{{ focusedProfile.faction }}</span>
                    </div>
                  </div>

                  <!-- 子视图切换器 -->
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div
                      class="ob-seg inline-flex items-center rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-0.5 font-mono text-[11px]"
                      data-testid="girl-detail-view-switch"
                    >
                      <button
                        type="button"
                        class="cursor-pointer rounded-[2px] px-2.5 py-0.5 transition-colors"
                        :class="
                          detailViewMode === 'all'
                            ? 'bg-(--rac-panel-2) font-bold text-(--rac-hi)'
                            : 'text-(--rac-muted) hover:text-(--rac-hi)'
                        "
                        @click="detailViewMode = 'all'"
                      >
                        全览模式
                      </button>
                      <button
                        type="button"
                        class="cursor-pointer rounded-[2px] px-2.5 py-0.5 transition-colors"
                        :class="
                          detailViewMode === 'combat'
                            ? 'bg-(--rac-panel-2) font-bold text-(--rac-hi)'
                            : 'text-(--rac-muted) hover:text-(--rac-hi)'
                        "
                        @click="detailViewMode = 'combat'"
                      >
                        权能与武装
                      </button>
                      <button
                        type="button"
                        class="cursor-pointer rounded-[2px] px-2.5 py-0.5 transition-colors"
                        :class="
                          detailViewMode === 'dossier'
                            ? 'bg-(--rac-panel-2) font-bold text-(--rac-hi)'
                            : 'text-(--rac-muted) hover:text-(--rac-hi)'
                        "
                        @click="detailViewMode = 'dossier'"
                      >
                        深度卷宗
                      </button>
                    </div>
                    <span v-if="focusedProfile.temperamentSpectrum" class="mono text-[11px] text-(--rac-accent)">
                      ◆ 机魂光谱：{{ focusedProfile.temperamentSpectrum }}
                    </span>
                  </div>
                </div>

                <!-- 4:8 黄金比例战术仪表带（替代原四等分窄格子） -->
                <div class="grid grid-cols-1 gap-2.5 lg:grid-cols-12">
                  <!-- 左侧 4 列：好感度 + 服从度 上下紧凑双仪表盘 -->
                  <div class="flex flex-col gap-2 lg:col-span-4">
                    <div class="ra-metric-box flex flex-col justify-between p-2.5">
                      <div class="flex items-center justify-between gap-1.5">
                        <span class="mono text-[11px] text-(--rac-muted)">好感度 AFFECTION</span>
                        <span class="mono shrink-0 whitespace-nowrap text-[11px] font-bold text-(--rac-warn)">
                          {{ affectionStageLabel(focusedProfile.affection) }}
                        </span>
                      </div>
                      <div class="mono mt-1 text-[15px] font-extrabold text-(--rac-warn)">
                        {{ focusedProfile.affection !== null ? `${focusedProfile.affection}%` : '—' }}
                      </div>
                      <div class="ra-progress-track mt-1.5">
                        <div
                          class="ra-progress-fill is-gold"
                          :style="{ width: `${clampPercent(focusedProfile.affection)}%` }"
                        />
                      </div>
                    </div>

                    <div class="ra-metric-box flex flex-col justify-between p-2.5">
                      <div class="flex items-center justify-between gap-1.5">
                        <span class="mono text-[11px] text-(--rac-muted)">服从度 OBEDIENCE</span>
                        <span class="mono shrink-0 whitespace-nowrap text-[11px] font-bold text-(--rac-accent)">
                          {{ obedienceStageLabel(focusedProfile.obedience) }}
                        </span>
                      </div>
                      <div class="mono mt-1 text-[15px] font-extrabold text-(--rac-accent)">
                        {{ focusedProfile.obedience !== null ? `${focusedProfile.obedience}%` : '—' }}
                      </div>
                      <div class="ra-progress-track mt-1.5">
                        <div
                          class="ra-progress-fill is-faction"
                          :style="{ width: `${clampPercent(focusedProfile.obedience)}%` }"
                        />
                      </div>
                    </div>
                  </div>

                  <!-- 右侧 8 列：对外身份 SHELL（3 列） + 暴露分档 EXPOSURE（5 列） -->
                  <div class="grid grid-cols-1 gap-2.5 lg:col-span-8 lg:grid-cols-8">
                    <div class="ra-metric-box flex flex-col justify-between p-2.5 lg:col-span-3">
                      <div class="mono text-[11px] text-(--rac-muted)">对外身份 SHELL</div>
                      <p
                        v-if="isShellDeferred"
                        class="shell-deferred-hint mt-1.5 text-[11px] leading-snug"
                        data-test="girl-shell-deferred"
                      >
                        ◆ 基地内勤 · 尚未安排对外伪装身份（执行外勤时解锁）
                      </p>
                      <div v-else class="mt-1.5 text-[11px] font-bold leading-relaxed text-(--rac-hi)">
                        {{ focusedProfile.shell || focusedProfile.alias }}
                      </div>
                    </div>

                    <div
                      class="ra-metric-box flex flex-col justify-between p-2.5 lg:col-span-5"
                      data-testid="girl-exposure-value"
                    >
                      <div class="mono text-[11px] text-(--rac-muted)">暴露分档 EXPOSURE</div>
                      <div v-if="focusedProfile.exposureGrades.length > 1" class="mt-1.5 flex flex-col gap-1">
                        <div
                          v-for="(eg, egIdx) in focusedProfile.exposureGrades"
                          :key="`eg-${egIdx}-${eg.code}`"
                          class="flex items-start gap-1.5 rounded-[2px] border border-(--rac-dim) bg-(--rac-panel-2) px-2 py-1 text-[11px]"
                        >
                          <span
                            class="mono shrink-0 font-bold"
                            :class="
                              eg.tone === 'danger'
                                ? 'text-(--rac-alert)'
                                : eg.tone === 'warn'
                                  ? 'text-(--rac-warn)'
                                  : eg.tone === 'ok'
                                    ? 'text-(--rac-ok)'
                                    : 'text-(--rac-accent)'
                            "
                          >
                            {{ eg.code }}
                          </span>
                          <span class="leading-snug text-(--rac-text)">{{ eg.label }}</span>
                        </div>
                      </div>
                      <div v-else class="mt-1.5 text-[11px] font-bold leading-snug text-(--rac-hi)">
                        {{ focusedProfile.exposure || '● 常规伪装（基地内勤）' }}
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 纳米躯体、外貌着装与性格侧写结构化双栏 -->
                <div v-show="detailViewMode !== 'combat'" class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div class="dossier-section ra-sub-box p-2.5 text-[11px]" data-test="girl-body-section">
                    <h5 class="mono mb-1 text-[11px] font-bold text-(--rac-warn)">◆ 机体与外貌特征</h5>
                    <p class="leading-relaxed text-(--rac-text)">
                      {{ focusedProfile.body || '暂无外貌特征记录' }}
                    </p>
                    <p
                      v-if="focusedProfile.appearance && focusedProfile.appearance !== focusedProfile.body"
                      class="mt-1.5 border-t border-(--rac-dim) pt-1.5 leading-relaxed text-(--rac-muted)"
                    >
                      <span class="mono font-bold text-(--rac-hi)">常服/挂件：</span>{{ focusedProfile.appearance }}
                    </p>
                  </div>
                  <div class="ra-sub-box p-2.5 text-[11px]">
                    <h5 class="mono mb-1 text-[11px] font-bold text-(--rac-accent)">◆ 性格侧写与勤务近况</h5>
                    <p class="leading-relaxed text-(--rac-text)">
                      <span class="mono font-bold text-(--rac-hi)">性格作风：</span>{{ focusedProfile.personality || '沉稳待命，严格执行统帅部指令' }}
                    </p>
                    <p class="mt-1.5 border-t border-(--rac-dim) pt-1.5 leading-relaxed text-(--rac-muted)">
                      <span class="mono font-bold text-(--rac-hi)">当前任务：</span>{{ focusedProfile.duty }}
                    </p>
                  </div>
                </div>

                <!-- 特征标签与挂载武装 -->
                <div
                  v-if="focusedProfile.traits.length > 0 || focusedProfile.loadouts.length > 0"
                  v-show="detailViewMode !== 'dossier'"
                  class="flex flex-wrap gap-1.5"
                >
                  <span
                    v-for="trait in focusedProfile.traits"
                    :key="`t-${trait}`"
                    class="ra-tag-chip mono px-2 py-0.5 text-[11px]"
                  >
                    ◆ {{ trait }}
                  </span>
                  <span
                    v-for="w in focusedProfile.loadouts"
                    :key="`w-${w}`"
                    class="ra-weapon-chip mono px-2 py-0.5 text-[11px]"
                  >
                    ▸ {{ w }}
                  </span>
                </div>

                <!-- 技能与机制摘要（支持结构化 <数据> 特殊技能与特殊装备展示） -->
                <div
                  v-if="
                    focusedProfile.specialSkills.length > 0 ||
                    focusedProfile.specialEquipment.length > 0 ||
                    focusedProfile.skills ||
                    focusedProfile.form_mech ||
                    focusedProfile.flaws
                  "
                  v-show="detailViewMode !== 'dossier'"
                  class="ra-sub-box flex flex-col gap-2.5 p-2.5 text-[11px]"
                  data-testid="girl-special-data-section"
                >
                  <div v-if="focusedProfile.form_mech">
                    <div class="mono mb-1 text-[11px] font-bold text-(--rac-warn)">◆ 形态耦合与机魂机制</div>
                    <div class="leading-relaxed text-(--rac-hi)">
                      {{ focusedProfile.form_mech }}
                    </div>
                  </div>

                  <!-- 结构化特殊技能卡片 -->
                  <div v-if="focusedProfile.specialSkills.length > 0" data-testid="girl-special-skills-list">
                    <div class="mono mb-1.5 text-[11px] font-bold text-(--rac-warn)">
                      ◆ 专属特殊技能 · SPECIAL SKILLS ({{ focusedProfile.specialSkills.length }})
                    </div>
                    <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      <div
                        v-for="sk in focusedProfile.specialSkills"
                        :key="`sk-${sk.name}`"
                        class="ra-row-card flex flex-col gap-1 p-2"
                      >
                        <div class="flex flex-wrap items-center justify-between gap-1">
                          <span class="font-bold text-(--rac-hi)">◆ {{ sk.name }}</span>
                          <span class="ra-faction-chip mono px-1.5 py-0.5 text-[11px]">{{ sk.kind }}</span>
                        </div>
                        <p class="text-[11px] leading-relaxed text-(--rac-text)">{{ sk.desc }}</p>
                      </div>
                    </div>
                  </div>
                  <div v-else-if="focusedProfile.skills">
                    <div class="mono mb-1 text-[11px] font-bold text-(--rac-warn)">◆ 战术技能与权能</div>
                    <div class="whitespace-pre-line leading-relaxed text-(--rac-text)">
                      {{ focusedProfile.skills }}
                    </div>
                  </div>

                  <!-- 结构化特殊装备卡片 -->
                  <div v-if="focusedProfile.specialEquipment.length > 0" data-testid="girl-special-equipment-list">
                    <div class="mono mb-1.5 text-[11px] font-bold text-(--rac-accent)">
                      ◆ 专属特殊装备 · SPECIAL EQUIPMENT ({{ focusedProfile.specialEquipment.length }})
                    </div>
                    <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      <div
                        v-for="eq in focusedProfile.specialEquipment"
                        :key="`eq-${eq.name}`"
                        class="ra-row-card flex flex-col gap-1 p-2"
                      >
                        <div class="flex flex-wrap items-center justify-between gap-1">
                          <span class="font-bold text-(--rac-warn)">▸ {{ eq.name }}</span>
                          <span class="ra-tag-chip mono px-1.5 py-0.5 text-[11px]">{{ eq.slot }}</span>
                        </div>
                        <p class="text-[11px] leading-relaxed text-(--rac-text)">{{ eq.desc }}</p>
                      </div>
                    </div>
                  </div>

                  <div v-if="focusedProfile.flaws" class="border-t border-(--rac-dim) pt-1.5 text-(--rac-warn)">
                    <span class="mono font-bold">▲ 结构性短板：</span>{{ focusedProfile.flaws }}
                  </div>
                </div>

                <!-- 世界书双段正史回读（已自动剥离 <数据> 机器块与重复头，支持结构化章节卡片与原始卷宗切换） -->
                <div v-show="detailViewMode !== 'combat'" class="ra-sub-box p-2.5 text-[11px]" data-testid="girl-worldbook-section">
                  <div class="mono mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-(--rac-accent)">
                    <span>◆ 详细设定档案（来自世界书记录）</span>
                    <div class="flex items-center gap-2">
                      <span v-if="loadingGirlName === focusedProfile.name" class="text-(--rac-muted)">读取中…</span>
                      <button
                        v-if="focusedProfile.dossierContent || focusedProfile.storyContent"
                        type="button"
                        class="ra-raw-toggle-btn mono cursor-pointer px-2 py-0.5 text-[11px]"
                        @click="showRawWorldbook = !showRawWorldbook"
                      >
                        {{ showRawWorldbook ? '收起原始标签 ▲' : '查看原始卷宗 ▾' }}
                      </button>
                    </div>
                  </div>

                  <!-- 结构化世界书章节卡片（当存在解析出的章节且非原始标签模式时呈现） -->
                  <div
                    v-if="!showRawWorldbook && focusedProfile.worldbookSections.length > 0"
                    class="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2"
                  >
                    <div
                      v-for="(sec, sIdx) in focusedProfile.worldbookSections"
                      :key="`wb-sec-${sIdx}-${sec.title}`"
                      class="rounded-[2px] border border-(--rac-dim) bg-(--rac-panel-2) p-2"
                    >
                      <div class="mono mb-1 text-[11px] font-bold text-(--rac-warn)">
                        ◆ {{ sec.title }}
                      </div>
                      <div class="space-y-1 text-[11px] leading-relaxed text-(--rac-text)">
                        <p v-for="(ln, lIdx) in sec.lines" :key="`ln-${lIdx}`">{{ ln }}</p>
                      </div>
                    </div>
                  </div>

                  <div v-if="focusedProfile.cleanDossierContent || (showRawWorldbook && focusedProfile.dossierContent)" class="mb-2">
                    <div class="mono text-[11px] font-bold text-(--rac-warn)">【档案·机体与能力】</div>
                    <pre class="ra-dossier-pre mt-1 whitespace-pre-wrap leading-relaxed text-[11px]">{{ showRawWorldbook ? focusedProfile.dossierContent : focusedProfile.cleanDossierContent }}</pre>
                  </div>
                  <div v-if="focusedProfile.cleanStoryContent || (showRawWorldbook && focusedProfile.storyContent)">
                    <div class="mono text-[11px] font-bold text-(--rac-warn)">【剧情·人格与现状】</div>
                    <pre class="ra-dossier-pre mt-1 whitespace-pre-wrap leading-relaxed text-[11px]">{{ showRawWorldbook ? focusedProfile.storyContent : focusedProfile.cleanStoryContent }}</pre>
                  </div>
                  <div
                    v-if="!focusedProfile.cleanDossierContent && !focusedProfile.cleanStoryContent && !showRawWorldbook && (focusedProfile.dossierContent || focusedProfile.storyContent)"
                    class="text-[11px] text-(--rac-muted)"
                  >
                    核心设定字段已全部提取至上方战术档案卡；如需核对世界书原始文本，可点击右上角「查看原始卷宗 ▾」。
                  </div>
                  <div
                    v-if="!focusedProfile.dossierContent && !focusedProfile.storyContent"
                    class="text-[11px] text-(--rac-muted)"
                  >
                    暂未读取到详细档案正文，可点击右上角「查阅完整设定档案」查看。
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ────────────── TAB 2：人员兵力（personnel） ────────────── -->
        <section v-else-if="activeTab === 'personnel'" class="flex flex-col gap-3" data-testid="panel-personnel">
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[11px] text-(--rac-muted)">指挥部在编军官</div>
              <div class="mono mt-0.5 text-[16px] font-extrabold text-(--rac-warn)">
                {{ vm.personnel.officers.length }} <span class="text-[11px] font-normal">名</span>
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[11px] text-(--rac-muted)">当前驻军总兵力</div>
              <div class="mono mt-0.5 text-[16px] font-extrabold text-(--rac-hi)">
                {{ vm.personnel.totalCount }} <span class="text-[11px] font-normal">人</span>
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[11px] text-(--rac-muted)">建制兵种类别</div>
              <div class="mono mt-0.5 text-[16px] font-extrabold text-(--rac-accent)">
                {{ vm.personnel.rows.length }} <span class="text-[11px] font-normal">类</span>
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[11px] text-(--rac-muted)">在训步兵队列</div>
              <div class="mono mt-0.5 text-[16px] font-extrabold text-(--rac-warn)">
                {{ vm.personnel.trainingQueues.length }} <span class="text-[11px] font-normal">项</span>
              </div>
            </div>
          </div>

          <div
            v-if="activeScope !== 'ALL' && vm.personnel.totalCount === 0 && vm.unassignedPersonnelCount > 0"
            class="ra-sub-box flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-(--rac-warn)"
            data-testid="personnel-unassigned-hint"
          >
            <span>
              ◆ 本基地暂无独立驻防步兵编制（全战区共有 {{ vm.unassignedPersonnelCount }} 名人员处于「战区机动直属」调配池，可切回「战区全局」查看）
            </span>
          </div>

          <div v-if="vm.personnel.isEmpty" class="ra-empty-box py-6 text-center text-[12px] text-(--rac-muted)">
            当前防区暂无成建制步兵、随行军官或训练队列。
          </div>

          <!-- 在册参谋与重要人物紧凑名录条 -->
          <div
            v-if="vm.notableCharacters.length > 0"
            class="flex flex-col gap-1.5"
            data-testid="personnel-notable-characters-section"
          >
            <div class="mono text-[11px] font-bold text-(--rac-warn)">
              ◆ 在册参谋与重要人物 ({{ vm.notableCharacters.length }})
            </div>
            <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <div
                v-for="ch in vm.notableCharacters"
                :key="`notable-${ch.name}`"
                class="ra-row-card flex flex-col gap-1 px-3 py-2"
                :data-testid="`notable-char-${ch.name}`"
              >
                <div class="flex flex-wrap items-center justify-between gap-1.5">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-[12px] font-extrabold text-(--rac-hi)">{{ ch.name }}</span>
                    <span v-if="ch.callsign" class="mono text-[11px] font-bold text-(--rac-warn)">
                      「{{ ch.callsign }}」
                    </span>
                    <span class="meta-chip seq-chip">{{ ch.roleOrIdentity }}</span>
                  </div>
                  <span class="ra-tag-chip mono px-1.5 py-0.5 text-[11px]">◆ {{ ch.statusOrBase }}</span>
                </div>
                <div class="mono flex flex-wrap items-center gap-2 text-[11px] text-(--rac-muted)">
                  <span class="text-(--rac-accent)">阵营/势力：{{ ch.faction }}</span>
                  <span v-if="ch.attitude">· 立场：{{ ch.attitude }}</span>
                  <span v-if="ch.trust && ch.trust !== '—'">· 信任度：{{ ch.trust }}</span>
                </div>
                <p v-if="ch.desc" class="text-[11px] leading-snug text-(--rac-text)">
                  {{ ch.desc }}
                </p>
              </div>
            </div>
          </div>

          <!-- 指挥部在编副官与随行核心人类 -->
          <div v-if="vm.personnel.officers.length > 0" class="flex flex-col gap-2" data-testid="personnel-officers-section">
            <div class="mono text-[11px] font-bold text-(--rac-warn)">◆ 指挥部在编军官与随行核心人员</div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div
                v-for="off in vm.personnel.officers"
                :key="off.name"
                class="ra-row-card flex flex-col gap-1.5 p-3"
                :data-testid="`officer-card-${off.name}`"
              >
                <div class="flex flex-wrap items-center justify-between gap-1.5">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-[13px] font-extrabold text-(--rac-hi)">{{ off.name }}</span>
                    <span v-if="off.callsign" class="mono text-[11px] font-bold text-(--rac-warn)">
                      「{{ off.callsign }}」
                    </span>
                    <span class="meta-chip seq-chip">{{ off.title }}</span>
                  </div>
                  <span class="ra-tag-chip mono px-1.5 py-0.5 text-[11px]">{{ off.origin }}</span>
                </div>
                <div class="mono text-[11px] text-(--rac-accent)">
                  归属：{{ off.faction }} · 席位：{{ off.roleLabel }}
                  <span v-if="off.dailyUpkeep > 0"> · 薪饷 {{ off.dailyUpkeep }}/日</span>
                </div>
                <p v-if="off.appearance" class="text-[11px] leading-snug text-(--rac-text)">
                  <span class="mono text-(--rac-muted)">外貌：</span>{{ off.appearance }}
                </p>
                <p v-if="off.personality" class="text-[11px] leading-snug text-(--rac-text)">
                  <span class="mono text-(--rac-muted)">性格：</span>{{ off.personality }}
                </p>
                <p v-if="off.desc" class="text-[11px] leading-snug text-(--rac-muted)">
                  {{ off.desc }}
                </p>
              </div>
            </div>
          </div>

          <div v-if="filteredPersonnelRows.length > 0" class="flex flex-col gap-1.5">
            <div class="mono text-[11px] font-bold text-(--rac-warn)">◆ 兵种编制与驻地分布（点击查阅图鉴）</div>
            <div
              v-for="row in filteredPersonnelRows"
              :key="row.unitType"
              class="ra-row-card flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 transition-colors hover:border-(--rac-accent)"
              :data-testid="`personnel-row-${row.unitType}`"
              @click="openItemLookup(row.unitType)"
            >
              <div class="flex items-center gap-2">
                <span class="text-[13px] font-bold text-(--rac-hi)">{{ row.unitType }}</span>
                <span class="mono text-[12px] font-bold text-(--rac-accent)">×{{ row.total }}</span>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="b in row.byBase"
                  :key="`${row.unitType}-${b.base}`"
                  class="ra-tag-chip mono px-2 py-0.5 text-[11px]"
                >
                  {{ b.base }}: {{ b.count }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="vm.personnel.trainingQueues.length > 0" class="flex flex-col gap-1.5">
            <div class="mono text-[11px] font-bold text-(--rac-warn)">◆ 正在训练步兵队列</div>
            <div
              v-for="(q, idx) in vm.personnel.trainingQueues"
              :key="`pq-${idx}-${q.item}`"
              class="ra-row-card flex items-center justify-between px-3 py-2 text-[11px]"
            >
              <div>
                <span class="font-bold text-(--rac-hi)">{{ q.item }}</span>
                <span class="mono ml-2 text-(--rac-muted)">({{ q.base }})</span>
              </div>
              <div class="mono text-(--rac-warn)">进度 {{ q.progress }}% {{ q.eta ? `· ${q.eta}` : '' }}</div>
            </div>
          </div>
        </section>

        <!-- ────────────── TAB 3：载具空军（vehicles） ────────────── -->
        <section v-else-if="activeTab === 'vehicles'" class="flex flex-col gap-3" data-testid="panel-vehicles">
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[11px] text-(--rac-muted)">地面装甲载具</div>
              <div class="mono mt-0.5 text-[15px] font-extrabold text-(--rac-hi)">
                {{ vm.vehicles.totalVehicles }} 台
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[11px] text-(--rac-muted)">空军飞行器</div>
              <div class="mono mt-0.5 text-[15px] font-extrabold text-(--rac-accent)">
                {{ vm.vehicles.totalAircraft }} 架
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[11px] text-(--rac-muted)">完好战备数</div>
              <div class="mono mt-0.5 text-[15px] font-extrabold text-(--rac-ok)">
                {{ vm.vehicles.intactCount }}
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[11px] text-(--rac-muted)">受损 / 待修</div>
              <div class="mono mt-0.5 text-[15px] font-extrabold text-(--rac-warn)">
                {{ vm.vehicles.damagedCount }}
              </div>
            </div>
          </div>

          <div
            v-if="activeScope !== 'ALL' && vm.vehicles.totalCount === 0 && vm.unassignedVehicleCount > 0"
            class="ra-sub-box flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-(--rac-warn)"
            data-testid="vehicles-unassigned-hint"
          >
            <span>
              ◆ 本基地暂无独立驻防载具编制（全战区共有 {{ vm.unassignedVehicleCount }} 台载具/战机处于「战区机动直属」调配池，可切回「战区全局」查看）
            </span>
          </div>

          <div v-if="vm.vehicles.isEmpty" class="ra-empty-box py-6 text-center text-[12px] text-(--rac-muted)">
            当前防区暂无在役装甲载具或空军编队。
          </div>

          <div v-if="filteredVehicleGroups.length > 0" class="flex flex-col gap-2">
            <div class="mono text-[11px] font-bold text-(--rac-warn)">◆ 载具与空军型号完好率明细（点击查阅图鉴）</div>
            <div
              v-for="grp in filteredVehicleGroups"
              :key="`${grp.category}-${grp.model}`"
              class="ra-row-card flex cursor-pointer flex-col gap-1.5 px-3 py-2.5 transition-colors hover:border-(--rac-accent)"
              :data-testid="`vehicle-group-${grp.model}`"
              @click="openItemLookup(grp.model)"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="ra-tag-chip mono px-1.5 py-0.5 text-[11px]">
                    {{ grp.category === 'aircraft' ? '空军' : '陆装' }}
                  </span>
                  <span class="text-[13px] font-bold text-(--rac-hi)">{{ grp.model }}</span>
                  <span class="mono text-[12px] font-bold text-(--rac-accent)">共 {{ grp.total }} 台</span>
                  <span
                    v-for="gName in grp.assignedGirls ?? []"
                    :key="`${grp.model}-girl-${gName}`"
                    class="ra-weapon-chip mono px-1.5 py-0.5 text-[11px] font-bold"
                    :data-testid="`vehicle-girl-badge-${grp.model}-${gName}`"
                  >
                    ★ {{ gName }}专属座驾
                  </span>
                </div>
                <div class="mono flex items-center gap-2 text-[11px]">
                  <span class="text-(--rac-ok)">完好 {{ grp.intact }}</span>
                  <span v-if="grp.damaged > 0" class="font-bold text-(--rac-warn)">受损 {{ grp.damaged }}</span>
                </div>
              </div>

              <!-- 双色金属完好/受损比例进度条 -->
              <div class="flex h-1.5 w-full overflow-hidden rounded-[2px] bg-(--rac-bg)">
                <div
                  class="h-full bg-(--rac-ok) transition-all duration-300"
                  :style="{ width: `${vehicleIntactPercent(grp)}%` }"
                />
                <div
                  v-if="grp.damaged > 0"
                  class="h-full bg-(--rac-warn) transition-all duration-300"
                  :style="{ width: `${100 - vehicleIntactPercent(grp)}%` }"
                />
              </div>

              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="b in grp.byBase"
                  :key="`${grp.model}-${b.base}`"
                  class="ra-tag-chip mono px-2 py-0.5 text-[11px]"
                >
                  {{ b.base }}: {{ b.count }} (完好{{ b.intact }}/受损{{ b.damaged }})
                </span>
              </div>
            </div>
          </div>

          <div v-if="vm.vehicles.productionQueues.length > 0" class="flex flex-col gap-1.5">
            <div class="mono text-[11px] font-bold text-(--rac-warn)">◆ 在产载具 / 战机流水线</div>
            <div
              v-for="(q, idx) in vm.vehicles.productionQueues"
              :key="`vq-${idx}-${q.item}`"
              class="ra-row-card flex items-center justify-between px-3 py-2 text-[11px]"
            >
              <div>
                <span class="font-bold text-(--rac-hi)">{{ q.item }}</span>
                <span class="mono ml-2 text-(--rac-muted)">({{ q.base }})</span>
              </div>
              <div class="mono text-(--rac-warn)">进度 {{ q.progress }}% {{ q.eta ? `· ${q.eta}` : '' }}</div>
            </div>
          </div>
        </section>

        <!-- ────────────── TAB 4：制式装备（equipment） ────────────── -->
        <section v-else-if="activeTab === 'equipment'" class="flex flex-col gap-3" data-testid="panel-equipment">
          <div class="grid grid-cols-3 gap-2">
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[11px] text-(--rac-muted)">制式装备与挂载总计</div>
              <div class="mono mt-0.5 text-[15px] font-extrabold text-(--rac-hi)">
                {{ vm.equipment.totalCount }} 件
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[11px] text-(--rac-muted)">机娘已挂载武装</div>
              <div class="mono mt-0.5 text-[15px] font-extrabold text-(--rac-accent)">
                {{ vm.equipment.girlLoadouts.length }} 项
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[11px] text-(--rac-muted)">在产 / 改装军备队列</div>
              <div class="mono mt-0.5 text-[15px] font-extrabold text-(--rac-warn)">
                {{ vm.equipment.activeQueues.length }} 项
              </div>
            </div>
          </div>

          <div v-if="vm.equipment.isEmpty" class="ra-empty-box py-6 text-center text-[12px] text-(--rac-muted)">
            当前防区暂无登记的制式装备库存、机娘挂载或改装队列。
          </div>

          <!-- 制式装备库存 -->
          <div v-if="filteredEquipmentItems.length > 0" class="flex flex-col gap-1.5">
            <div class="mono text-[11px] font-bold text-(--rac-warn)">◆ 基地制式装备与军械库存（点击查阅图鉴）</div>
            <div
              v-for="eq in filteredEquipmentItems"
              :key="eq.name"
              class="ra-row-card flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 transition-colors hover:border-(--rac-accent)"
              :data-testid="`equipment-row-${eq.name}`"
              @click="openItemLookup(eq.name)"
            >
              <div class="flex items-center gap-2">
                <span class="text-[13px] font-bold text-(--rac-hi)">{{ eq.name }}</span>
                <span class="mono text-[12px] font-bold text-(--rac-accent)">×{{ eq.count }}</span>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="b in eq.byBase"
                  :key="`${eq.name}-${b.base}`"
                  class="ra-tag-chip mono px-2 py-0.5 text-[11px]"
                >
                  {{ b.base }}: {{ b.count }}
                </span>
              </div>
            </div>
          </div>

          <!-- 机娘已挂载武装 -->
          <div v-if="vm.equipment.girlLoadouts.length > 0" class="flex flex-col gap-1.5">
            <div class="mono text-[11px] font-bold text-(--rac-warn)">◆ 机娘已挂载专属武装（源自档案 &lt;数据&gt;）</div>
            <div
              v-for="(ld, idx) in vm.equipment.girlLoadouts"
              :key="`ld-${idx}-${ld.girl}-${ld.item}`"
              class="ra-row-card flex cursor-pointer items-center justify-between px-3 py-2 text-[11px] transition-colors hover:border-(--rac-accent)"
              :data-testid="`loadout-row-${ld.girl}`"
              @click="openItemLookup(ld.item)"
            >
              <span class="font-bold text-(--rac-hi)">▸ {{ ld.item }}</span>
              <span class="mono text-(--rac-accent)">{{ ld.girl }} · {{ ld.base }}</span>
            </div>
          </div>

          <!-- 生产与改装队列 -->
          <div v-if="vm.equipment.activeQueues.length > 0" class="flex flex-col gap-1.5">
            <div class="mono text-[11px] font-bold text-(--rac-warn)">◆ 生产 / 改装中的军备条目</div>
            <div
              v-for="(q, idx) in vm.equipment.activeQueues"
              :key="`eqq-${idx}-${q.item}`"
              class="ra-row-card flex items-center justify-between px-3 py-2 text-[11px]"
              :data-testid="`equipment-queue-${q.item}`"
            >
              <div>
                <span class="ra-tag-chip mono mr-1.5 px-1.5 py-0.5 text-[11px]">{{ q.type }}</span>
                <span class="font-bold text-(--rac-hi)">{{ q.item }}</span>
                <span class="mono ml-2 text-(--rac-muted)">({{ q.base }})</span>
              </div>
              <div class="mono text-(--rac-warn)">进度 {{ q.progress }}% {{ q.eta ? `· ${q.eta}` : '' }}</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { openGirlLookup, openLookup } from '../../红警指挥系统/composables/useDetail';
import { fillHostSendInput } from '../../红警指挥系统/worldbook/hostSendInput';
import { loadGirlDossierDetail } from '../models/archiveIndex';
import { buildArmoryViewModel, resolveFocusedGirlProfile } from '../models/armoryPanelModel';
import type {
  ArmoryDossierInput,
  ArmoryGirlItem,
  ArmoryScope,
  ArmorySnapshotLike,
  ArmoryTabId,
} from '../models/armoryPanelModel';
import {
  playTacticalStagger,
  scheduleNextFrame,
  useTacticalModalMotion,
} from '../../红警指挥系统/ui/motion/useGsapMotion';

const props = withDefaults(
  defineProps<{
    open: boolean;
    snapshot: ArmorySnapshotLike | null;
    initialScope?: ArmoryScope;
    initialTab?: ArmoryTabId;
    initialSelectedGirl?: string;
    dossierMapOverride?: Record<string, ArmoryDossierInput>;
  }>(),
  {
    initialScope: 'ALL',
    initialTab: 'girls',
    initialSelectedGirl: '',
    dossierMapOverride: undefined,
  },
);

const emit = defineEmits<{
  close: [];
}>();

const backdropRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
useTacticalModalMotion(panelRef, backdropRef, { open: () => props.open });

const activeScope = ref<ArmoryScope>(props.initialScope || 'ALL');
const activeTab = ref<ArmoryTabId>(props.initialTab || 'girls');
const selectedGirlName = ref<string>(props.initialSelectedGirl || '');
const loadingGirlName = ref<string>('');
const showRawWorldbook = ref<boolean>(false);
const loadedDossiers = reactive<Record<string, ArmoryDossierInput>>({});

const searchQuery = ref<string>('');
const detailViewMode = ref<'all' | 'combat' | 'dossier'>('all');
const sizeMode = ref<'wide' | 'full' | 'compact'>('wide');

function cycleSizeMode(): void {
  if (sizeMode.value === 'wide') {
    sizeMode.value = 'full';
  } else if (sizeMode.value === 'full') {
    sizeMode.value = 'compact';
  } else {
    sizeMode.value = 'wide';
  }
}

const sizeModeLabel = computed<string>(() => {
  if (sizeMode.value === 'full') return '全屏 96%';
  if (sizeMode.value === 'compact') return '标准 1080';
  return '宽屏 90%';
});

const modalSizeClass = computed<string>(() => {
  if (sizeMode.value === 'full') return 'max-w-[96vw]';
  if (sizeMode.value === 'compact') return 'max-w-[1080px]';
  return 'max-w-[1440px]';
});

const modalDynamicStyle = computed(() => ({
  borderTop: '2px solid var(--rac-accent)',
  boxShadow:
    '0 12px 42px rgba(0, 0, 0, 0.82), 0 0 0 1px color-mix(in srgb, var(--rac-accent) 22%, transparent)',
}));

function clampPercent(val: number | null | undefined): number {
  if (val === null || val === undefined || !Number.isFinite(val)) return 0;
  return Math.max(0, Math.min(100, Math.round(val)));
}

function affectionStageLabel(val: number | null | undefined): string {
  if (val === null || val === undefined) return '待测';
  if (val >= 85) return '生死相托';
  if (val >= 65) return '深厚信赖';
  if (val >= 45) return '默契协作';
  return '初识磨合';
}

function obedienceStageLabel(val: number | null | undefined): string {
  if (val === null || val === undefined) return '待测';
  if (val >= 95) return '绝对服从';
  if (val >= 75) return '高度授命';
  if (val >= 50) return '常规执行';
  return '戒备观察';
}

watch([activeTab, activeScope, selectedGirlName], () => {
  scheduleNextFrame(() =>
    playTacticalStagger(panelRef.value, '.ra-armory-card, .ra-girl-row, section, article', {
      maxItems: 14,
      duration: 0.16,
    }),
  );
});

const mergedDossierMap = computed<Record<string, ArmoryDossierInput>>(() => ({
  ...loadedDossiers,
  ...(props.dossierMapOverride ?? {}),
}));

const vm = computed(() =>
  buildArmoryViewModel(props.snapshot, activeScope.value, mergedDossierMap.value),
);

const tabDefs = computed<
  Array<{ id: ArmoryTabId; label: string; icon: 'star' | 'infantry' | 'plane' | 'ammo'; count: number }>
>(() => [
  { id: 'girls', label: '机娘编成', icon: 'star', count: vm.value.summary.girlsCount },
  { id: 'personnel', label: '人员兵力', icon: 'infantry', count: vm.value.summary.personnelCount },
  { id: 'vehicles', label: '载具空军', icon: 'plane', count: vm.value.summary.vehiclesAndAircraftCount },
  { id: 'equipment', label: '制式装备', icon: 'ammo', count: vm.value.summary.equipmentCount },
]);

const normalizedSearch = computed(() => searchQuery.value.trim().toLowerCase());

const filteredGirls = computed<ArmoryGirlItem[]>(() => {
  const q = normalizedSearch.value;
  if (!q) return vm.value.girls.items;
  return vm.value.girls.items.filter(g => {
    const blob = [
      g.name,
      g.callsign,
      g.model,
      g.serial,
      g.seq,
      g.faction,
      g.base,
      g.duty,
      g.statusHeadline,
      ...g.traits,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return blob.includes(q);
  });
});

const filteredPersonnelRows = computed(() => {
  const q = normalizedSearch.value;
  if (!q) return vm.value.personnel.rows;
  return vm.value.personnel.rows.filter(r =>
    [r.unitType, ...r.byBase.map(b => b.base)].join(' ').toLowerCase().includes(q),
  );
});

const filteredVehicleGroups = computed(() => {
  const q = normalizedSearch.value;
  if (!q) return vm.value.vehicles.groups;
  return vm.value.vehicles.groups.filter(grp =>
    [grp.model, ...(grp.assignedGirls ?? []), ...grp.byBase.map(b => b.base)]
      .join(' ')
      .toLowerCase()
      .includes(q),
  );
});

const filteredEquipmentItems = computed(() => {
  const q = normalizedSearch.value;
  if (!q) return vm.value.equipment.items;
  return vm.value.equipment.items.filter(eq =>
    [eq.name, ...eq.byBase.map(b => b.base)].join(' ').toLowerCase().includes(q),
  );
});

const currentGirl = computed<ArmoryGirlItem | null>(() => {
  const list = filteredGirls.value.length > 0 ? filteredGirls.value : vm.value.girls.items;
  if (list.length === 0) return null;
  const hit = list.find(g => g.name === selectedGirlName.value);
  return hit ?? list[0];
});

const focusedProfile = computed<ArmoryGirlItem | null>(() => {
  if (!currentGirl.value) return null;
  const dossier = mergedDossierMap.value[currentGirl.value.name] ?? currentGirl.value.dossier;
  const resolved = resolveFocusedGirlProfile(currentGirl.value, dossier);
  resolved.base = currentGirl.value.base;
  return resolved;
});

const isShellDeferred = computed<boolean>(() => {
  const g = focusedProfile.value;
  if (!g) return false;
  const shell = (g.shell || '').trim();
  const alias = (g.alias || '').trim();
  if (!shell && !alias) return true;
  if (shell.includes('暂未编织') || alias.includes('暂未编织')) return true;
  return false;
});

async function ensureGirlDossierLoaded(girl: ArmoryGirlItem | null) {
  if (!girl) return;
  if (props.dossierMapOverride?.[girl.name] || loadedDossiers[girl.name]) return;
  loadingGirlName.value = girl.name;
  try {
    const detail = await loadGirlDossierDetail(girl.name, { model: girl.model });
    // G8-12：未命中（草稿）不缓存，下次选中/重开时重试，入档后可读到正史
    if (detail.dossierEntry || detail.storyEntry) {
      loadedDossiers[girl.name] = detail;
    }
  } catch {
    // 非酒馆测试环境忽略读取异常
  } finally {
    if (loadingGirlName.value === girl.name) {
      loadingGirlName.value = '';
    }
  }
}

function selectScope(scopeOpt: ArmoryScope) {
  activeScope.value = scopeOpt;
}

function selectGirl(name: string) {
  selectedGirlName.value = name;
  const hit = vm.value.girls.items.find(g => g.name === name) ?? null;
  void ensureGirlDossierLoaded(hit);
}

function openGirlInDrawer(girl: ArmoryGirlItem) {
  const rawCodex = (props.snapshot as { codex?: unknown } | null)?.codex;
  const codex = Array.isArray(rawCodex) ? (rawCodex as Parameters<typeof openGirlLookup>[1]) : [];
  void openGirlLookup(girl.name, codex);
}

function openItemLookup(name: string) {
  if (!name) return;
  const rawCodex = (props.snapshot as { codex?: unknown } | null)?.codex;
  const codex = Array.isArray(rawCodex) ? (rawCodex as Parameters<typeof openLookup>[1]) : [];
  openLookup(name, codex);
}

function stageGirlCommand(girl: ArmoryGirlItem) {
  if (!girl) return;
  const label = girl.callsign && girl.callsign !== girl.name ? `${girl.name}（${girl.callsign}）` : girl.name;
  const orderText = `【指挥官战术指令】调配机娘「${label}」（${girl.model}，当前驻地：${girl.base}）执行勤务/驻防部署：`;
  fillHostSendInput(orderText);
}

function vehicleIntactPercent(grp: { total: number; intact: number }): number {
  if (!grp.total || grp.total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((grp.intact / grp.total) * 100)));
}

watch(
  () => [props.open, props.open ? currentGirl.value?.name : undefined] as const,
  ([isOpen]) => {
    if (isOpen && currentGirl.value) {
      void ensureGirlDossierLoaded(currentGirl.value);
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.ra-modal-mask {
  z-index: 10010;
  background: rgba(0, 0, 0, 0.78);
  backdrop-filter: blur(4px);
}

.ra-modal-card {
  background: linear-gradient(180deg, var(--rac-panel) 0%, var(--rac-bg) 100%);
  border: 1px solid color-mix(in srgb, var(--rac-accent) 55%, var(--rac-line));
  border-radius: 2px;
  color: var(--rac-text);
  box-shadow:
    0 12px 42px rgba(0, 0, 0, 0.75),
    0 0 24px rgba(0, 0, 0, 0.5);
}

.ra-modal-head {
  background-image:
    var(--rac-header-stripe, none),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--rac-accent) 14%, var(--rac-panel-2)) 0%,
      var(--rac-panel) 100%
    );
  border-bottom: 1px solid color-mix(in srgb, var(--rac-accent) 40%, var(--rac-line));
}

.ra-modal-close {
  color: var(--rac-muted);
  background: var(--rac-bg);
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
}

.ra-modal-close:hover {
  color: var(--rac-alert);
  border-color: var(--rac-alert);
}

.ra-scope-pill {
  color: var(--rac-muted);
  background: var(--rac-panel-2);
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
}

.ra-scope-pill:hover {
  color: var(--rac-hi);
  border-color: var(--rac-line);
}

.ra-scope-pill.is-active {
  color: var(--rac-hi);
  background: color-mix(in srgb, var(--rac-accent) 18%, var(--rac-panel-2));
  border-color: var(--rac-accent);
}

.ra-armory-tab {
  position: relative;
  color: var(--rac-muted);
  background: var(--rac-panel-2);
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
}

.ra-armory-tab:hover {
  color: var(--rac-hi);
  border-color: var(--rac-line);
}

.ra-armory-tab.is-active {
  color: var(--rac-hi);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--rac-accent) 18%, var(--rac-panel-2)) 0%,
    var(--rac-panel) 100%
  );
  border-color: var(--rac-accent);
  box-shadow: inset 0 2px 0 var(--rac-accent);
}

.ra-tab-badge {
  background: var(--rac-bg);
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
  color: var(--rac-warn);
  font-size: 11px;
}

.ra-empty-box {
  background: var(--rac-panel);
  border: 1px dashed var(--rac-line);
  border-radius: 2px;
}

.ra-example-btn,
.ra-mini-btn {
  color: var(--rac-warn);
  background: var(--rac-panel-2);
  border: 1px solid color-mix(in srgb, var(--rac-warn) 65%, var(--rac-line));
  border-radius: 2px;
}

.ra-mini-btn:hover {
  color: var(--rac-hi);
  border-color: var(--rac-warn);
  background: color-mix(in srgb, var(--rac-warn) 16%, var(--rac-panel-2));
}

.ra-cmd-btn {
  color: var(--rac-accent);
  background: var(--rac-panel-2);
  border: 1px solid color-mix(in srgb, var(--rac-accent) 60%, var(--rac-line));
  border-radius: 2px;
}

.ra-cmd-btn:hover {
  color: var(--rac-hi);
  border-color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 18%, var(--rac-panel-2));
}

.ra-girl-item {
  background: var(--rac-panel);
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
}

.ra-girl-item:hover {
  border-color: var(--rac-line);
  background: var(--rac-panel-2);
}

.ra-girl-item.is-selected {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--rac-warn) 14%, var(--rac-panel-2)) 0%,
    var(--rac-panel) 100%
  );
  border-color: var(--rac-warn);
  box-shadow: inset 2px 0 0 var(--rac-warn);
}

.ra-hero-card {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--rac-accent) 10%, var(--rac-panel-2)) 0%,
    var(--rac-panel) 65%,
    var(--rac-bg) 100%
  );
  border: 1px solid var(--rac-line);
  border-radius: 2px;
}

.ra-dossier-sticky-head {
  position: sticky;
  top: 0;
  z-index: 4;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--rac-panel) 96%, transparent) 0%,
    color-mix(in srgb, var(--rac-bg) 92%, transparent) 100%
  );
  border-bottom: 1px solid var(--rac-dim);
  backdrop-filter: blur(4px);
}

@media (min-width: 768px) {
  .ra-girls-sidebar,
  .ra-girl-detail-scroll {
    max-height: calc(92vh - 165px);
    overflow-y: auto;
    padding-right: 2px;
  }
}

.ra-progress-track {
  width: 100%;
  height: 5px;
  background: color-mix(in srgb, var(--rac-hi) 10%, var(--rac-bg));
  border-radius: 2px;
  overflow: hidden;
}

.ra-progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.25s ease;
}

.ra-progress-fill.is-gold {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--rac-warn) 65%, transparent),
    var(--rac-warn)
  );
}

.ra-progress-fill.is-faction {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--rac-accent) 65%, transparent),
    var(--rac-accent)
  );
}

.ra-faction-chip {
  color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 14%, var(--rac-panel-2));
  border: 1px solid color-mix(in srgb, var(--rac-accent) 50%, var(--rac-dim));
  border-radius: 2px;
}

.ra-raw-toggle-btn {
  color: var(--rac-muted);
  background: var(--rac-bg);
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
}

.ra-raw-toggle-btn:hover {
  color: var(--rac-warn);
  border-color: var(--rac-warn);
}

.ra-metric-box {
  background: var(--rac-panel);
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
}

.ra-sub-box {
  background: color-mix(in srgb, var(--rac-bg) 65%, var(--rac-panel));
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
}

.ra-row-card {
  background: var(--rac-panel-2);
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
}

.ra-tag-chip {
  color: var(--rac-text);
  background: var(--rac-bg);
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
}

.ra-weapon-chip {
  color: var(--rac-warn);
  background: color-mix(in srgb, var(--rac-warn) 12%, var(--rac-panel-2));
  border: 1px solid color-mix(in srgb, var(--rac-warn) 60%, var(--rac-dim));
  border-radius: 2px;
}

.ra-pending-chip {
  color: var(--rac-warn);
  background: color-mix(in srgb, var(--rac-warn) 16%, var(--rac-panel-2));
  border: 1px solid var(--rac-warn);
  border-radius: 2px;
}

.ra-dossier-pre {
  font-family: inherit;
  color: var(--rac-text);
}

.ra-hp-pill {
  border-radius: 2px;
  color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 14%, var(--rac-panel-2));
  border: 1px solid color-mix(in srgb, var(--rac-accent) 55%, var(--rac-dim));
}

.ra-hp-pill[data-hp='完好'] {
  color: var(--rac-ok);
  background: color-mix(in srgb, var(--rac-ok) 14%, var(--rac-panel-2));
  border: 1px solid var(--rac-ok);
}

.ra-hp-pill[data-hp='执勤中'] {
  color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 14%, var(--rac-panel-2));
  border: 1px solid var(--rac-accent);
}

.ra-hp-pill[data-hp='轻损'] {
  color: var(--rac-warn);
  background: color-mix(in srgb, var(--rac-warn) 14%, var(--rac-panel-2));
  border: 1px solid var(--rac-warn);
}

.ra-hp-pill[data-hp='重损'],
.ra-hp-pill[data-hp='离线'] {
  color: var(--rac-alert);
  background: color-mix(in srgb, var(--rac-alert) 16%, var(--rac-panel-2));
  border: 1px solid var(--rac-alert);
}

.badge-unchristened {
  color: var(--rac-warn);
  background: color-mix(in srgb, var(--rac-warn) 16%, var(--rac-panel-2));
  border: 1px solid var(--rac-warn);
  border-radius: 2px;
  padding: 1px 6px;
  font-size: 11px;
  font-weight: 700;
}

.meta-chip {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 2px;
}

.serial-chip {
  color: var(--rac-warn);
  background: color-mix(in srgb, var(--rac-warn) 12%, var(--rac-panel-2));
  border: 1px solid color-mix(in srgb, var(--rac-warn) 60%, var(--rac-dim));
}

.seq-chip {
  color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 14%, var(--rac-panel-2));
  border: 1px solid color-mix(in srgb, var(--rac-accent) 55%, var(--rac-dim));
}

.shell-deferred-hint {
  color: var(--rac-muted);
  font-weight: 600;
}
</style>
