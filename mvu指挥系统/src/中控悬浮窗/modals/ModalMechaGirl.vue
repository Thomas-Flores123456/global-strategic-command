<template>
  <div
    v-if="open"
    ref="backdropRef"
    class="ra-modal-mask fixed inset-0 z-[10010] flex items-center justify-center p-2 sm:p-4"
    @click.self="emit('close')"
  >
    <div
      ref="panelRef"
      class="ra-modal-card ra-armory-modal flex max-h-[88vh] w-full max-w-[1020px] flex-col overflow-hidden"
      role="dialog"
      aria-label="军备管理"
    >
      <!-- ══ 顶栏：标题 + 四维汇总微章 + 关闭 ══ -->
      <header class="ra-modal-head flex items-center gap-2 px-3.5 py-2.5 select-none">
        <Icon name="shield" :size="15" class="text-[var(--faction)]" />
        <span class="mono text-[13px] font-bold tracking-[0.12em] text-[var(--text-strong)]">
          军备管理 · ARMAMENT &amp; MECHA COMMAND
        </span>
        <span
          class="mono rounded-sm border border-[var(--line-hot)] bg-[var(--faction-weak)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--faction)]"
        >
          {{ activeScope === 'ALL' ? '战区全局' : activeScope }}
        </span>
        <span class="flex-1" />
        <button
          type="button"
          class="ra-modal-close mono flex size-6 cursor-pointer items-center justify-center text-[13px]"
          title="关闭窗口 (ESC)"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>

      <!-- ══ 双轴控制栏：维度一（战区/基地 Scope 切换器）+ 维度二（四维军备 Tab） ══ -->
      <div class="ra-armory-controls flex flex-col gap-2 border-b border-[var(--line)] bg-[var(--bg-1)] px-3.5 py-2.5">
        <!-- 作用域切换器（战区全局 ALL / 各基地） -->
        <div class="flex flex-wrap items-center gap-1.5" data-testid="armory-scope-bar">
          <span class="mono mr-1 text-[10px] font-bold tracking-wider text-[var(--muted)]">战区防区 //</span>
          <button
            v-for="scopeOpt in vm.baseOptions"
            :key="scopeOpt"
            type="button"
            class="ra-scope-pill mono cursor-pointer px-2.5 py-1 text-[11px] font-bold transition-colors"
            :class="{ 'is-active': activeScope === scopeOpt }"
            :data-testid="`scope-btn-${scopeOpt}`"
            @click="selectScope(scopeOpt)"
          >
            {{ scopeOpt === 'ALL' ? '战区全局 ALL' : `📍 ${scopeOpt}` }}
          </button>
        </div>

        <!-- 四维军备 Tab 导航 -->
        <div class="grid grid-cols-4 gap-1.5" data-testid="armory-tab-bar">
          <button
            v-for="t in tabDefs"
            :key="t.id"
            type="button"
            class="ra-armory-tab mono flex cursor-pointer items-center justify-between px-2.5 py-1.5 text-[11px] font-bold transition-colors"
            :class="{ 'is-active': activeTab === t.id }"
            :data-testid="`tab-btn-${t.id}`"
            @click="activeTab = t.id"
          >
            <span>{{ t.label }}</span>
            <span class="ra-tab-badge mono px-1.5 py-0.2 text-[10px]">{{ t.count }}</span>
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
          <div class="mono flex items-center justify-between text-[11px] font-bold text-[var(--gold)]">
            <span>🚚 跨防区单位调配进行中 ({{ vm.pendingTransfers.length }})</span>
            <span class="text-[10px] font-normal text-[var(--muted)]">随战区时钟自动推进到站</span>
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
                  <span class="font-extrabold text-[var(--text-strong)]">
                    {{ tr.unit }}
                  </span>
                  <span v-if="tr.category !== 'girls'" class="mono font-bold text-[var(--faction)]">
                    ×{{ tr.qty }}
                  </span>
                  <span class="ra-tag-chip mono px-1.5 py-0.2 text-[10px]">
                    📍 {{ tr.fromBase }} → 📍 {{ tr.toBase }}
                  </span>
                  <span v-if="tr.method" class="meta-chip seq-chip mono px-1.5 py-0.2 text-[10px]">
                    {{ tr.method }}
                  </span>
                </div>
                <div class="mono flex items-center gap-2 text-[11px] font-bold text-[var(--gold)]">
                  <span>进度 {{ tr.progress }}%</span>
                  <span>· 剩余 {{ tr.etaText }}</span>
                </div>
              </div>
              <div class="h-1.5 w-full overflow-hidden rounded-xs bg-[var(--bg-0)]">
                <div
                  class="h-full bg-[var(--gold)] transition-all duration-300"
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
            <div class="mono text-[13px] font-bold text-[var(--text-strong)]">
              // 当前防区（{{ activeScope === 'ALL' ? '战区全局' : activeScope }}）暂无在编机娘 //
            </div>
            <p class="max-w-[460px] text-[11px] leading-relaxed text-[var(--muted)]">
              当剧情产出 &lt;机娘档案&gt; 或战况编入机娘单位后，此处将实时呈现机娘机体型号、好感/服从指标、驻地归属与聊天绑定世界书双段正史。
            </p>
          </div>

          <!-- 机娘主从双栏视图（左：列表独立滚动，右：选中详情独立滚动 + Sticky 顶栏） -->
          <div v-else class="grid grid-cols-1 gap-3.5 md:grid-cols-12 md:items-start" data-testid="girls-master-detail">
            <!-- 左侧：机娘编成列表 -->
            <div class="ra-girls-sidebar flex flex-col gap-1.5 md:col-span-4" data-testid="girls-list">
              <div class="mono mb-0.5 flex items-center justify-between px-0.5 text-[10px] font-bold text-[var(--muted)]">
                <span>在编单位 ({{ vm.girls.items.length }})</span>
                <span class="text-[9px] opacity-80">点击切换档案</span>
              </div>
              <button
                v-for="g in vm.girls.items"
                :key="g.name"
                type="button"
                class="ra-girl-item girl-roster-card flex cursor-pointer flex-col gap-1.5 p-2.5 text-left transition-colors"
                :class="{ 'is-selected': currentGirl?.name === g.name }"
                :data-testid="`girl-row-${g.name}`"
                @click="selectGirl(g.name)"
              >
                <div class="flex items-start justify-between gap-1.5">
                  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span class="text-[14px] font-extrabold tracking-wide text-[var(--text-strong)]">
                      {{ g.callsign && g.name === g.model ? g.callsign : g.name }}
                    </span>
                    <span
                      v-if="g.callsign && g.callsign !== g.name && g.name !== g.model"
                      class="mono text-[10px] font-bold text-[var(--gold)]"
                    >
                      代号「{{ g.callsign }}」
                    </span>
                    <span
                      v-if="g.unchristened"
                      class="badge-unchristened"
                      data-test="girl-unchristened-badge"
                    >
                      ✨ 待指挥官赐名
                    </span>
                  </div>
                  <span class="ra-hp-pill mono shrink-0 px-1.5 py-0.5 text-[10px] font-bold" :data-hp="g.status">
                    {{ g.status }}
                  </span>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="mono text-[11px] font-bold text-[var(--faction)]">{{ g.model }}</span>
                  <span v-if="g.faction" class="ra-faction-chip mono px-1.5 py-0.2 text-[9px]">
                    {{ g.faction }}
                  </span>
                </div>
                <div class="flex flex-wrap items-center gap-1 text-[10px] text-[var(--muted)]">
                  <span class="ra-tag-chip mono px-1.5 py-0.2">📍 {{ g.base }}</span>
                  <span
                    v-if="g.activeTransfer"
                    class="ra-pending-chip mono px-1.5 py-0.2 text-[var(--gold)]"
                    :data-testid="`girl-transfer-badge-${g.name}`"
                  >
                    🚚 调往 {{ g.activeTransfer.toBase }} · 余 {{ g.activeTransfer.etaText }}
                  </span>
                  <span v-if="g.serial" class="meta-chip serial-chip mono px-1.5 py-0.2">
                    编号: {{ g.serial }}
                  </span>
                  <span v-if="g.seq" class="meta-chip seq-chip mono px-1.5 py-0.2">
                    {{ g.seq }}
                  </span>
                  <span v-if="g.isPending" class="ra-pending-chip mono px-1.5 py-0.2">NEW · 待入档</span>
                </div>
              </button>
            </div>

            <!-- 右侧：焦点机娘战术档案舱 -->
            <div v-if="focusedProfile" class="ra-girl-detail-scroll flex flex-col gap-2.5 md:col-span-8" data-testid="girl-detail-pane">
              <div class="ra-hero-card flex flex-col gap-3 p-3.5">
                <div class="dossier-header ra-dossier-sticky-head flex flex-wrap items-start justify-between gap-2 pb-2.5">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-[17px] font-extrabold tracking-wider text-[var(--text-strong)]">
                        {{ focusedProfile.name }}
                      </span>
                      <span
                        v-if="focusedProfile.callsign && focusedProfile.callsign !== focusedProfile.name"
                        class="mono text-[11px] font-bold text-[var(--gold)]"
                        data-test="girl-callsign"
                      >
                        代号「{{ focusedProfile.callsign }}」
                      </span>
                      <span
                        v-if="focusedProfile.unchristened"
                        class="badge-unchristened"
                        data-test="girl-unchristened-badge"
                      >
                        ✨ 待指挥官赐名
                      </span>
                      <span class="mono text-[12px] font-bold text-[var(--faction)]">
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
                      <span class="ra-hp-pill mono px-2 py-0.5 text-[10px] font-bold" :data-hp="focusedProfile.status">
                        {{ focusedProfile.status }}
                      </span>
                    </div>
                    <div class="mono mt-1 text-[11px] text-[var(--muted)]">
                      驻地：{{ focusedProfile.base }} · 职责：{{ focusedProfile.duty }}
                      <span v-if="focusedProfile.callsign"> · 代号：{{ focusedProfile.callsign }}</span>
                      <span v-if="focusedProfile.faction"> · 阵营：{{ focusedProfile.faction }}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="ra-mini-btn mono shrink-0 cursor-pointer px-2.5 py-1 text-[10px] font-bold"
                    data-testid="open-girl-drawer-btn"
                    @click="openGirlInDrawer(focusedProfile)"
                  >
                    查阅完整设定档案 ▸
                  </button>
                </div>

                <!-- 核心指标四宫格（带可视化进度条与防截断提示） -->
                <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <div class="ra-metric-box flex flex-col justify-between p-2.5">
                    <div class="flex items-center justify-between gap-1">
                      <span class="mono text-[10px] text-[var(--muted)]">好感度 AFFECTION</span>
                      <span class="mono text-[9px] text-[var(--gold)]">
                        {{ affectionStageLabel(focusedProfile.affection) }}
                      </span>
                    </div>
                    <div class="mono mt-1 text-[15px] font-extrabold text-[var(--gold)]">
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
                    <div class="flex items-center justify-between gap-1">
                      <span class="mono text-[10px] text-[var(--muted)]">服从度 OBEDIENCE</span>
                      <span class="mono text-[9px] text-[var(--faction)]">
                        {{ obedienceStageLabel(focusedProfile.obedience) }}
                      </span>
                    </div>
                    <div class="mono mt-1 text-[15px] font-extrabold text-[var(--faction)]">
                      {{ focusedProfile.obedience !== null ? `${focusedProfile.obedience}%` : '—' }}
                    </div>
                    <div class="ra-progress-track mt-1.5">
                      <div
                        class="ra-progress-fill is-faction"
                        :style="{ width: `${clampPercent(focusedProfile.obedience)}%` }"
                      />
                    </div>
                  </div>
                  <div class="ra-metric-box flex flex-col justify-between p-2.5">
                    <div class="mono text-[10px] text-[var(--muted)]">对外身份 SHELL</div>
                    <p
                      v-if="isShellDeferred"
                      class="shell-deferred-hint mt-1 text-[11px] leading-snug"
                      data-test="girl-shell-deferred"
                    >
                      🔒 基地内勤 · 尚未安排对外伪装身份（执行外勤时解锁）
                    </p>
                    <div v-else class="mt-1 text-[11px] font-bold leading-snug text-[var(--text-strong)]">
                      {{ focusedProfile.shell || focusedProfile.alias }}
                    </div>
                  </div>
                  <div class="ra-metric-box flex flex-col justify-between p-2.5">
                    <div class="mono text-[10px] text-[var(--muted)]">暴露分档 EXPOSURE</div>
                    <div
                      class="mt-1 text-[11px] font-bold leading-snug text-[var(--text-strong)]"
                      data-testid="girl-exposure-value"
                    >
                      {{ focusedProfile.exposure || '🟢 常规伪装（基地内勤）' }}
                    </div>
                  </div>
                </div>

                <!-- 纳米躯体、外貌着装与性格侧写结构化双栏 -->
                <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div class="dossier-section ra-sub-box p-2.5 text-[11px]" data-test="girl-body-section">
                    <h5 class="mono mb-1 text-[10px] font-bold text-[var(--gold)]">◆ 机体与外貌特征</h5>
                    <p class="leading-relaxed text-[var(--text)]">
                      {{ focusedProfile.body || '暂无外貌特征记录' }}
                    </p>
                    <p
                      v-if="focusedProfile.appearance && focusedProfile.appearance !== focusedProfile.body"
                      class="mt-1.5 border-t border-[var(--line)] pt-1.5 leading-relaxed text-[var(--muted)]"
                    >
                      <span class="mono font-bold text-[var(--text-strong)]">常服/挂件：</span>{{ focusedProfile.appearance }}
                    </p>
                  </div>
                  <div class="ra-sub-box p-2.5 text-[11px]">
                    <h5 class="mono mb-1 text-[10px] font-bold text-[var(--faction)]">◆ 性格侧写与勤务近况</h5>
                    <p class="leading-relaxed text-[var(--text)]">
                      <span class="mono font-bold text-[var(--text-strong)]">性格作风：</span>{{ focusedProfile.personality || '沉稳待命，严格执行统帅部指令' }}
                    </p>
                    <p class="mt-1.5 border-t border-[var(--line)] pt-1.5 leading-relaxed text-[var(--muted)]">
                      <span class="mono font-bold text-[var(--text-strong)]">当前任务：</span>{{ focusedProfile.duty }}
                    </p>
                  </div>
                </div>

                <!-- 特征标签与挂载武装 -->
                <div v-if="focusedProfile.traits.length > 0 || focusedProfile.loadouts.length > 0" class="flex flex-wrap gap-1.5">
                  <span
                    v-for="trait in focusedProfile.traits"
                    :key="`t-${trait}`"
                    class="ra-tag-chip mono px-2 py-0.5 text-[10px]"
                  >
                    #{{ trait }}
                  </span>
                  <span
                    v-for="w in focusedProfile.loadouts"
                    :key="`w-${w}`"
                    class="ra-weapon-chip mono px-2 py-0.5 text-[10px]"
                  >
                    ⚔ {{ w }}
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
                  class="ra-sub-box flex flex-col gap-2.5 p-2.5 text-[11px]"
                  data-testid="girl-special-data-section"
                >
                  <div v-if="focusedProfile.form_mech">
                    <div class="mono mb-1 text-[10px] font-bold text-[var(--gold)]">◆ 形态耦合与机魂机制</div>
                    <div class="leading-relaxed text-[var(--text-strong)]">
                      {{ focusedProfile.form_mech }}
                    </div>
                  </div>

                  <!-- 结构化特殊技能卡片 -->
                  <div v-if="focusedProfile.specialSkills.length > 0" data-testid="girl-special-skills-list">
                    <div class="mono mb-1.5 text-[10px] font-bold text-[var(--gold)]">
                      ◆ 专属特殊技能 · SPECIAL SKILLS ({{ focusedProfile.specialSkills.length }})
                    </div>
                    <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      <div
                        v-for="sk in focusedProfile.specialSkills"
                        :key="`sk-${sk.name}`"
                        class="ra-row-card flex flex-col gap-1 p-2"
                      >
                        <div class="flex flex-wrap items-center justify-between gap-1">
                          <span class="font-bold text-[var(--text-strong)]">✦ {{ sk.name }}</span>
                          <span class="ra-faction-chip mono px-1.5 py-0.2 text-[9px]">{{ sk.kind }}</span>
                        </div>
                        <p class="text-[11px] leading-relaxed text-[var(--text)]">{{ sk.desc }}</p>
                      </div>
                    </div>
                  </div>
                  <div v-else-if="focusedProfile.skills">
                    <div class="mono mb-1 text-[10px] font-bold text-[var(--gold)]">◆ 战术技能与权能</div>
                    <div class="whitespace-pre-line leading-relaxed text-[var(--text)]">
                      {{ focusedProfile.skills }}
                    </div>
                  </div>

                  <!-- 结构化特殊装备卡片 -->
                  <div v-if="focusedProfile.specialEquipment.length > 0" data-testid="girl-special-equipment-list">
                    <div class="mono mb-1.5 text-[10px] font-bold text-[var(--faction)]">
                      ◆ 专属特殊装备 · SPECIAL EQUIPMENT ({{ focusedProfile.specialEquipment.length }})
                    </div>
                    <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      <div
                        v-for="eq in focusedProfile.specialEquipment"
                        :key="`eq-${eq.name}`"
                        class="ra-row-card flex flex-col gap-1 p-2"
                      >
                        <div class="flex flex-wrap items-center justify-between gap-1">
                          <span class="font-bold text-[var(--gold)]">⚔ {{ eq.name }}</span>
                          <span class="ra-tag-chip mono px-1.5 py-0.2 text-[9px]">{{ eq.slot }}</span>
                        </div>
                        <p class="text-[11px] leading-relaxed text-[var(--text)]">{{ eq.desc }}</p>
                      </div>
                    </div>
                  </div>

                  <div v-if="focusedProfile.flaws" class="border-t border-[var(--line)] pt-1.5 text-[var(--warn)]">
                    <span class="mono font-bold">⚠ 结构性短板：</span>{{ focusedProfile.flaws }}
                  </div>
                </div>

                <!-- 世界书双段正史回读（已自动剥离 <数据> 机器块与重复头，支持一键展开原卷宗） -->
                <div class="ra-sub-box p-2.5 text-[11px]" data-testid="girl-worldbook-section">
                  <div class="mono mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-[var(--faction)]">
                    <span>◆ 详细设定档案（来自世界书记录）</span>
                    <div class="flex items-center gap-2">
                      <span v-if="loadingGirlName === focusedProfile.name" class="text-[var(--muted)]">读取中…</span>
                      <button
                        v-if="focusedProfile.dossierContent || focusedProfile.storyContent"
                        type="button"
                        class="ra-raw-toggle-btn mono cursor-pointer px-1.5 py-0.5 text-[9px]"
                        @click="showRawWorldbook = !showRawWorldbook"
                      >
                        {{ showRawWorldbook ? '收起原始标签 ▴' : '查看原始卷宗 ▾' }}
                      </button>
                    </div>
                  </div>
                  <div v-if="focusedProfile.cleanDossierContent || (showRawWorldbook && focusedProfile.dossierContent)" class="mb-2">
                    <div class="mono text-[10px] font-bold text-[var(--gold)]">【档案·机体与能力】</div>
                    <pre class="ra-dossier-pre mt-1 whitespace-pre-wrap leading-relaxed text-[11px]">{{ showRawWorldbook ? focusedProfile.dossierContent : focusedProfile.cleanDossierContent }}</pre>
                  </div>
                  <div v-if="focusedProfile.cleanStoryContent || (showRawWorldbook && focusedProfile.storyContent)">
                    <div class="mono text-[10px] font-bold text-[var(--gold)]">【剧情·人格与现状】</div>
                    <pre class="ra-dossier-pre mt-1 whitespace-pre-wrap leading-relaxed text-[11px]">{{ showRawWorldbook ? focusedProfile.storyContent : focusedProfile.cleanStoryContent }}</pre>
                  </div>
                  <div
                    v-if="!focusedProfile.cleanDossierContent && !focusedProfile.cleanStoryContent && !showRawWorldbook && (focusedProfile.dossierContent || focusedProfile.storyContent)"
                    class="text-[11px] text-[var(--muted)]"
                  >
                    核心设定字段已全部提取至上方战术档案卡；如需核对世界书原始文本，可点击右上角「查看原始卷宗 ▾」。
                  </div>
                  <div
                    v-if="!focusedProfile.dossierContent && !focusedProfile.storyContent"
                    class="text-[11px] text-[var(--muted)]"
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
              <div class="mono text-[10px] text-[var(--muted)]">指挥部在编军官</div>
              <div class="mono mt-0.5 text-[16px] font-extrabold text-[var(--gold)]">
                {{ vm.personnel.officers.length }} <span class="text-[11px] font-normal">名</span>
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[10px] text-[var(--muted)]">当前驻军总兵力</div>
              <div class="mono mt-0.5 text-[16px] font-extrabold text-[var(--text-strong)]">
                {{ vm.personnel.totalCount }} <span class="text-[11px] font-normal">人</span>
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[10px] text-[var(--muted)]">建制兵种类别</div>
              <div class="mono mt-0.5 text-[16px] font-extrabold text-[var(--faction)]">
                {{ vm.personnel.rows.length }} <span class="text-[11px] font-normal">类</span>
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[10px] text-[var(--muted)]">在训步兵队列</div>
              <div class="mono mt-0.5 text-[16px] font-extrabold text-[var(--gold)]">
                {{ vm.personnel.trainingQueues.length }} <span class="text-[11px] font-normal">项</span>
              </div>
            </div>
          </div>

          <div
            v-if="activeScope !== 'ALL' && vm.personnel.totalCount === 0 && vm.unassignedPersonnelCount > 0"
            class="ra-sub-box flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-[var(--gold)]"
            data-testid="personnel-unassigned-hint"
          >
            <span>
              ◆ 本基地暂无独立驻防步兵编制（全战区共有 {{ vm.unassignedPersonnelCount }} 名人员处于「战区机动直属」调配池，可切回「战区全局」查看）
            </span>
          </div>

          <div v-if="vm.personnel.isEmpty" class="ra-empty-box py-6 text-center text-[12px] text-[var(--muted)]">
            当前防区暂无成建制步兵、随行军官或训练队列。
          </div>

          <!-- 在册参谋与重要人物紧凑名录条 -->
          <div
            v-if="vm.notableCharacters.length > 0"
            class="flex flex-col gap-1.5"
            data-testid="personnel-notable-characters-section"
          >
            <div class="mono text-[11px] font-bold text-[var(--gold)]">
              ■ 在册参谋与重要人物 ({{ vm.notableCharacters.length }})
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
                    <span class="text-[12px] font-extrabold text-[var(--text-strong)]">{{ ch.name }}</span>
                    <span v-if="ch.callsign" class="mono text-[10px] font-bold text-[var(--gold)]">
                      「{{ ch.callsign }}」
                    </span>
                    <span class="meta-chip seq-chip">{{ ch.roleOrIdentity }}</span>
                  </div>
                  <span class="ra-tag-chip mono px-1.5 py-0.2 text-[9px]">📍 {{ ch.statusOrBase }}</span>
                </div>
                <div class="mono flex flex-wrap items-center gap-2 text-[10px] text-[var(--muted)]">
                  <span class="text-[var(--faction)]">阵营/势力：{{ ch.faction }}</span>
                  <span v-if="ch.attitude">· 立场：{{ ch.attitude }}</span>
                  <span v-if="ch.trust && ch.trust !== '—'">· 信任度：{{ ch.trust }}</span>
                </div>
                <p v-if="ch.desc" class="text-[11px] leading-snug text-[var(--text)]">
                  {{ ch.desc }}
                </p>
              </div>
            </div>
          </div>

          <!-- 指挥部在编副官与随行核心人类 -->
          <div v-if="vm.personnel.officers.length > 0" class="flex flex-col gap-2" data-testid="personnel-officers-section">
            <div class="mono text-[11px] font-bold text-[var(--gold)]">■ 指挥部在编军官与随行核心人员</div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div
                v-for="off in vm.personnel.officers"
                :key="off.name"
                class="ra-row-card flex flex-col gap-1.5 p-3"
                :data-testid="`officer-card-${off.name}`"
              >
                <div class="flex flex-wrap items-center justify-between gap-1.5">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-[13px] font-extrabold text-[var(--text-strong)]">{{ off.name }}</span>
                    <span v-if="off.callsign" class="mono text-[10px] font-bold text-[var(--gold)]">
                      「{{ off.callsign }}」
                    </span>
                    <span class="meta-chip seq-chip">{{ off.title }}</span>
                  </div>
                  <span class="ra-tag-chip mono px-1.5 py-0.5 text-[9px]">{{ off.origin }}</span>
                </div>
                <div class="mono text-[10px] text-[var(--faction)]">
                  归属：{{ off.faction }} · 席位：{{ off.roleLabel }}
                  <span v-if="off.dailyUpkeep > 0"> · 薪饷 {{ off.dailyUpkeep }}/日</span>
                </div>
                <p v-if="off.appearance" class="text-[11px] leading-snug text-[var(--text)]">
                  <span class="mono text-[var(--muted)]">外貌：</span>{{ off.appearance }}
                </p>
                <p v-if="off.personality" class="text-[11px] leading-snug text-[var(--text)]">
                  <span class="mono text-[var(--muted)]">性格：</span>{{ off.personality }}
                </p>
                <p v-if="off.desc" class="text-[11px] leading-snug text-[var(--muted)]">
                  {{ off.desc }}
                </p>
              </div>
            </div>
          </div>

          <div v-if="vm.personnel.rows.length > 0" class="flex flex-col gap-1.5">
            <div class="mono text-[11px] font-bold text-[var(--gold)]">■ 兵种编制与驻地分布</div>
            <div
              v-for="row in vm.personnel.rows"
              :key="row.unitType"
              class="ra-row-card flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              :data-testid="`personnel-row-${row.unitType}`"
            >
              <div class="flex items-center gap-2">
                <span class="text-[13px] font-bold text-[var(--text-strong)]">{{ row.unitType }}</span>
                <span class="mono text-[12px] font-bold text-[var(--faction)]">×{{ row.total }}</span>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="b in row.byBase"
                  :key="`${row.unitType}-${b.base}`"
                  class="ra-tag-chip mono px-2 py-0.5 text-[10px]"
                >
                  {{ b.base }}: {{ b.count }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="vm.personnel.trainingQueues.length > 0" class="flex flex-col gap-1.5">
            <div class="mono text-[11px] font-bold text-[var(--gold)]">■ 正在训练步兵队列</div>
            <div
              v-for="(q, idx) in vm.personnel.trainingQueues"
              :key="`pq-${idx}-${q.item}`"
              class="ra-row-card flex items-center justify-between px-3 py-2 text-[11px]"
            >
              <div>
                <span class="font-bold text-[var(--text-strong)]">{{ q.item }}</span>
                <span class="mono ml-2 text-[var(--muted)]">({{ q.base }})</span>
              </div>
              <div class="mono text-[var(--gold)]">进度 {{ q.progress }}% {{ q.eta ? `· ${q.eta}` : '' }}</div>
            </div>
          </div>
        </section>

        <!-- ────────────── TAB 3：载具空军（vehicles） ────────────── -->
        <section v-else-if="activeTab === 'vehicles'" class="flex flex-col gap-3" data-testid="panel-vehicles">
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[10px] text-[var(--muted)]">地面装甲载具</div>
              <div class="mono mt-0.5 text-[15px] font-extrabold text-[var(--text-strong)]">
                {{ vm.vehicles.totalVehicles }} 台
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[10px] text-[var(--muted)]">空军飞行器</div>
              <div class="mono mt-0.5 text-[15px] font-extrabold text-[var(--faction)]">
                {{ vm.vehicles.totalAircraft }} 架
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[10px] text-[var(--muted)]">完好战备数</div>
              <div class="mono mt-0.5 text-[15px] font-extrabold text-[var(--ok)]">
                {{ vm.vehicles.intactCount }}
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[10px] text-[var(--muted)]">受损 / 待修</div>
              <div class="mono mt-0.5 text-[15px] font-extrabold text-[var(--warn)]">
                {{ vm.vehicles.damagedCount }}
              </div>
            </div>
          </div>

          <div
            v-if="activeScope !== 'ALL' && vm.vehicles.totalCount === 0 && vm.unassignedVehicleCount > 0"
            class="ra-sub-box flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-[var(--gold)]"
            data-testid="vehicles-unassigned-hint"
          >
            <span>
              ◆ 本基地暂无独立驻防载具编制（全战区共有 {{ vm.unassignedVehicleCount }} 台载具/战机处于「战区机动直属」调配池，可切回「战区全局」查看）
            </span>
          </div>

          <div v-if="vm.vehicles.isEmpty" class="ra-empty-box py-6 text-center text-[12px] text-[var(--muted)]">
            当前防区暂无在役装甲载具或空军编队。
          </div>

          <div v-if="vm.vehicles.groups.length > 0" class="flex flex-col gap-2">
            <div class="mono text-[11px] font-bold text-[var(--gold)]">■ 载具与空军型号完好率明细</div>
            <div
              v-for="grp in vm.vehicles.groups"
              :key="`${grp.category}-${grp.model}`"
              class="ra-row-card flex flex-col gap-1.5 px-3 py-2.5"
              :data-testid="`vehicle-group-${grp.model}`"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="ra-tag-chip mono px-1.5 py-0.2 text-[10px]">
                    {{ grp.category === 'aircraft' ? '空军' : '陆装' }}
                  </span>
                  <span class="text-[13px] font-bold text-[var(--text-strong)]">{{ grp.model }}</span>
                  <span class="mono text-[12px] font-bold text-[var(--faction)]">共 {{ grp.total }} 台</span>
                  <span
                    v-for="gName in grp.assignedGirls ?? []"
                    :key="`${grp.model}-girl-${gName}`"
                    class="ra-weapon-chip mono px-1.5 py-0.2 text-[10px] font-bold"
                    :data-testid="`vehicle-girl-badge-${grp.model}-${gName}`"
                  >
                    ★ {{ gName }}专属座驾
                  </span>
                </div>
                <div class="mono flex items-center gap-2 text-[11px]">
                  <span class="text-[var(--ok)]">完好 {{ grp.intact }}</span>
                  <span v-if="grp.damaged > 0" class="font-bold text-[var(--warn)]">受损 {{ grp.damaged }}</span>
                </div>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="b in grp.byBase"
                  :key="`${grp.model}-${b.base}`"
                  class="ra-tag-chip mono px-2 py-0.5 text-[10px]"
                >
                  {{ b.base }}: {{ b.count }} (完好{{ b.intact }}/受损{{ b.damaged }})
                </span>
              </div>
            </div>
          </div>

          <div v-if="vm.vehicles.productionQueues.length > 0" class="flex flex-col gap-1.5">
            <div class="mono text-[11px] font-bold text-[var(--gold)]">■ 在产载具 / 战机流水线</div>
            <div
              v-for="(q, idx) in vm.vehicles.productionQueues"
              :key="`vq-${idx}-${q.item}`"
              class="ra-row-card flex items-center justify-between px-3 py-2 text-[11px]"
            >
              <div>
                <span class="font-bold text-[var(--text-strong)]">{{ q.item }}</span>
                <span class="mono ml-2 text-[var(--muted)]">({{ q.base }})</span>
              </div>
              <div class="mono text-[var(--gold)]">进度 {{ q.progress }}% {{ q.eta ? `· ${q.eta}` : '' }}</div>
            </div>
          </div>
        </section>

        <!-- ────────────── TAB 4：制式装备（equipment） ────────────── -->
        <section v-else-if="activeTab === 'equipment'" class="flex flex-col gap-3" data-testid="panel-equipment">
          <div class="grid grid-cols-3 gap-2">
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[10px] text-[var(--muted)]">制式装备与挂载总计</div>
              <div class="mono mt-0.5 text-[15px] font-extrabold text-[var(--text-strong)]">
                {{ vm.equipment.totalCount }} 件
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[10px] text-[var(--muted)]">机娘已挂载武装</div>
              <div class="mono mt-0.5 text-[15px] font-extrabold text-[var(--faction)]">
                {{ vm.equipment.girlLoadouts.length }} 项
              </div>
            </div>
            <div class="ra-metric-box p-2.5">
              <div class="mono text-[10px] text-[var(--muted)]">在产 / 改装军备队列</div>
              <div class="mono mt-0.5 text-[15px] font-extrabold text-[var(--gold)]">
                {{ vm.equipment.activeQueues.length }} 项
              </div>
            </div>
          </div>

          <div v-if="vm.equipment.isEmpty" class="ra-empty-box py-6 text-center text-[12px] text-[var(--muted)]">
            当前防区暂无登记的制式装备库存、机娘挂载或改装队列。
          </div>

          <!-- 制式装备库存 -->
          <div v-if="vm.equipment.items.length > 0" class="flex flex-col gap-1.5">
            <div class="mono text-[11px] font-bold text-[var(--gold)]">■ 基地制式装备与军械库存</div>
            <div
              v-for="eq in vm.equipment.items"
              :key="eq.name"
              class="ra-row-card flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              :data-testid="`equipment-row-${eq.name}`"
            >
              <div class="flex items-center gap-2">
                <span class="text-[13px] font-bold text-[var(--text-strong)]">{{ eq.name }}</span>
                <span class="mono text-[12px] font-bold text-[var(--faction)]">×{{ eq.count }}</span>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="b in eq.byBase"
                  :key="`${eq.name}-${b.base}`"
                  class="ra-tag-chip mono px-2 py-0.5 text-[10px]"
                >
                  {{ b.base }}: {{ b.count }}
                </span>
              </div>
            </div>
          </div>

          <!-- 机娘已挂载武装 -->
          <div v-if="vm.equipment.girlLoadouts.length > 0" class="flex flex-col gap-1.5">
            <div class="mono text-[11px] font-bold text-[var(--gold)]">■ 机娘已挂载专属武装（源自档案 &lt;数据&gt;）</div>
            <div
              v-for="(ld, idx) in vm.equipment.girlLoadouts"
              :key="`ld-${idx}-${ld.girl}-${ld.item}`"
              class="ra-row-card flex items-center justify-between px-3 py-2 text-[11px]"
              :data-testid="`loadout-row-${ld.girl}`"
            >
              <span class="font-bold text-[var(--text-strong)]">⚔ {{ ld.item }}</span>
              <span class="mono text-[var(--faction)]">{{ ld.girl }} · {{ ld.base }}</span>
            </div>
          </div>

          <!-- 生产与改装队列 -->
          <div v-if="vm.equipment.activeQueues.length > 0" class="flex flex-col gap-1.5">
            <div class="mono text-[11px] font-bold text-[var(--gold)]">■ 生产 / 改装中的军备条目</div>
            <div
              v-for="(q, idx) in vm.equipment.activeQueues"
              :key="`eqq-${idx}-${q.item}`"
              class="ra-row-card flex items-center justify-between px-3 py-2 text-[11px]"
              :data-testid="`equipment-queue-${q.item}`"
            >
              <div>
                <span class="ra-tag-chip mono mr-1.5 px-1.5 py-0.2 text-[10px]">{{ q.type }}</span>
                <span class="font-bold text-[var(--text-strong)]">{{ q.item }}</span>
                <span class="mono ml-2 text-[var(--muted)]">({{ q.base }})</span>
              </div>
              <div class="mono text-[var(--gold)]">进度 {{ q.progress }}% {{ q.eta ? `· ${q.eta}` : '' }}</div>
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
import { openGirlLookup } from '../../红警指挥系统/composables/useDetail';
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

const tabDefs = computed<Array<{ id: ArmoryTabId; label: string; count: number }>>(() => [
  { id: 'girls', label: '机娘编成', count: vm.value.summary.girlsCount },
  { id: 'personnel', label: '人员兵力', count: vm.value.summary.personnelCount },
  { id: 'vehicles', label: '载具空军', count: vm.value.summary.vehiclesAndAircraftCount },
  { id: 'equipment', label: '制式装备', count: vm.value.summary.equipmentCount },
]);

const currentGirl = computed<ArmoryGirlItem | null>(() => {
  const list = vm.value.girls.items;
  if (list.length === 0) return null;
  const hit = list.find(g => g.name === selectedGirlName.value);
  return hit ?? list[0];
});

const focusedProfile = computed<ArmoryGirlItem | null>(() => {
  if (!currentGirl.value) return null;
  const dossier = mergedDossierMap.value[currentGirl.value.name] ?? currentGirl.value.dossier;
  return resolveFocusedGirlProfile(currentGirl.value, dossier);
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
    loadedDossiers[girl.name] = detail;
  } catch {
    // 非酒馆测试环境忽略读取异常
  } finally {
    if (loadingGirlName.value === girl.name) {
      loadingGirlName.value = '';
    }
  }
}

async function ensureGirlsDossierBatchLoaded(girls: readonly ArmoryGirlItem[]) {
  const missing = girls.filter(
    g => g?.name && !props.dossierMapOverride?.[g.name] && !loadedDossiers[g.name],
  );
  if (missing.length === 0) return;
  if (missing.length === 1) {
    await ensureGirlDossierLoaded(missing[0]);
    return;
  }
  loadingGirlName.value = missing[0].name;
  try {
    const settled = await Promise.all(
      missing.map(async g => {
        try {
          const detail = await loadGirlDossierDetail(g.name, { model: g.model });
          return [g.name, detail] as const;
        } catch {
          return null;
        }
      }),
    );
    const batchUpdates: Record<string, ArmoryDossierInput> = {};
    for (const entry of settled) {
      if (entry) {
        batchUpdates[entry[0]] = entry[1];
      }
    }
    if (Object.keys(batchUpdates).length > 0) {
      Object.assign(loadedDossiers, batchUpdates);
    }
  } finally {
    loadingGirlName.value = '';
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
  background: rgba(4, 7, 12, 0.78);
  backdrop-filter: blur(4px);
}

.ra-modal-card {
  background: linear-gradient(180deg, var(--bg-1) 0%, var(--bg-0) 100%);
  border: 1.5px solid var(--line-hot);
  border-radius: 3px;
  box-shadow:
    0 12px 42px rgba(0, 0, 0, 0.75),
    0 0 24px rgba(0, 0, 0, 0.5);
}

.ra-modal-head {
  background: linear-gradient(90deg, var(--deep-2) 0%, var(--bg-2) 60%, var(--bg-1) 100%);
  border-bottom: 1.5px solid var(--line-hot);
}

.ra-modal-close {
  color: var(--muted);
  background: var(--bg-0);
  border: 1px solid var(--line);
  border-radius: 2px;
}

.ra-modal-close:hover {
  color: var(--danger);
  border-color: var(--danger);
}

.ra-scope-pill {
  color: var(--muted);
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 2px;
}

.ra-scope-pill.is-active {
  color: var(--text-strong);
  background: var(--faction-weak);
  border-color: var(--line-hot);
}

.ra-armory-tab {
  color: var(--muted);
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 2px;
}

.ra-armory-tab.is-active {
  color: var(--text-strong);
  background: linear-gradient(180deg, var(--deep-2) 0%, var(--bg-2) 100%);
  border-color: var(--gold);
}

.ra-tab-badge {
  background: var(--bg-0);
  border: 1px solid var(--line);
  border-radius: 2px;
  color: var(--gold);
}

.ra-empty-box {
  background: var(--bg-1);
  border: 1px dashed var(--line-hot);
  border-radius: 2px;
}

.ra-example-btn,
.ra-mini-btn {
  color: var(--gold);
  background: var(--bg-2);
  border: 1px solid var(--gold);
  border-radius: 2px;
}

.ra-girl-item {
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 2px;
}

.ra-girl-item.is-selected {
  background: linear-gradient(90deg, var(--deep-1) 0%, var(--bg-2) 100%);
  border-color: var(--gold);
}

.ra-hero-card {
  background: linear-gradient(135deg, var(--deep-1) 0%, var(--bg-2) 65%, var(--bg-1) 100%);
  border: 1px solid var(--line-hot);
  border-radius: 2px;
}

.ra-dossier-sticky-head {
  position: sticky;
  top: 0;
  z-index: 4;
  background: linear-gradient(180deg, rgba(10, 18, 30, 0.96) 0%, rgba(10, 18, 30, 0.88) 100%);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(4px);
}

@media (min-width: 768px) {
  .ra-girls-sidebar,
  .ra-girl-detail-scroll {
    max-height: calc(88vh - 155px);
    overflow-y: auto;
    padding-right: 2px;
  }
}

.ra-progress-track {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.ra-progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.25s ease;
}

.ra-progress-fill.is-gold {
  background: linear-gradient(90deg, rgba(232, 194, 102, 0.65), var(--gold));
}

.ra-progress-fill.is-faction {
  background: linear-gradient(90deg, rgba(92, 178, 255, 0.65), var(--faction));
}

.ra-faction-chip {
  color: var(--faction);
  background: var(--faction-weak);
  border: 1px solid var(--line-hot);
  border-radius: 2px;
}

.ra-raw-toggle-btn {
  color: var(--muted);
  background: var(--bg-0);
  border: 1px solid var(--line);
  border-radius: 2px;
}

.ra-raw-toggle-btn:hover {
  color: var(--gold);
  border-color: var(--gold);
}

.ra-metric-box {
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: 2px;
}

.ra-sub-box {
  background: rgba(6, 12, 20, 0.55);
  border: 1px solid var(--line);
  border-radius: 2px;
}

.ra-row-card {
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 2px;
}

.ra-tag-chip {
  color: var(--text);
  background: var(--bg-0);
  border: 1px solid var(--line);
  border-radius: 2px;
}

.ra-weapon-chip {
  color: var(--gold);
  background: rgba(232, 194, 102, 0.1);
  border: 1px solid var(--gold);
  border-radius: 2px;
}

.ra-pending-chip {
  color: var(--gold);
  background: rgba(232, 194, 102, 0.16);
  border: 1px solid var(--gold);
  border-radius: 2px;
}

.ra-dossier-pre {
  font-family: inherit;
  color: var(--text);
}

.ra-hp-pill {
  border-radius: 2px;
}

.ra-hp-pill[data-hp='完好'] {
  color: var(--ok);
  background: rgba(68, 212, 132, 0.14);
  border: 1px solid var(--ok);
}

.ra-hp-pill[data-hp='轻损'] {
  color: var(--warn);
  background: rgba(232, 168, 56, 0.14);
  border: 1px solid var(--warn);
}

.ra-hp-pill[data-hp='重损'],
.ra-hp-pill[data-hp='离线'] {
  color: var(--danger);
  background: rgba(255, 68, 68, 0.16);
  border: 1px solid var(--danger);
}

.badge-unchristened {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.16);
  border: 1px solid #f59e0b;
  border-radius: 2px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 700;
}

.meta-chip {
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 2px;
}

.serial-chip {
  color: var(--gold);
  background: rgba(232, 194, 102, 0.12);
  border: 1px solid var(--gold);
}

.seq-chip {
  color: var(--faction);
  background: var(--faction-weak);
  border: 1px solid var(--line-hot);
}

.shell-deferred-hint {
  color: var(--muted);
  font-weight: 600;
}
</style>
