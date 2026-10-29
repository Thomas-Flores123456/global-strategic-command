<template>
  <div
    ref="protocolPanelRootRef"
    class="prt-panel-root flex flex-col gap-2 p-2 select-none"
    :data-institute-theme="activeInstitute"
    data-protocol-panel
  >
    <!-- ── 顶栏：左翼【科研院所子页切换栏】 ＋ 右翼【全局算力与实验室并网栏】 ── -->
    <div class="prt-topbar grid grid-cols-1 gap-2 lg:grid-cols-12">
      <!-- 左翼：科研院所子页切换栏与动态晋升头衔 -->
      <section
        class="prt-institute-bar flex flex-col justify-between gap-1.5 rounded-[2px] border p-2 lg:col-span-7"
        data-protocol-institute-bar
      >
        <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-4" role="tablist" aria-label="阵营科研院所子页切换">
          <button
            type="button"
            role="tab"
            class="prt-institute-tab flex flex-col justify-between gap-1 rounded-[2px] px-2 py-1.5 text-left font-mono transition-all"
            :class="{ 'prt-institute-tab--active': activeInstitute === 'common' }"
            :aria-selected="activeInstitute === 'common'"
            data-institute-tab="common"
            @click="selectInstitute('common')"
          >
            <div class="flex w-full items-center justify-between gap-1">
              <span class="truncate text-[11.5px] font-bold">◆ 通用联合条令总署 · COMMON</span>
              <span class="prt-mini-tier shrink-0 rounded-[2px] px-1 py-0.5 text-[11px] font-bold">
                T{{ commonInstituteInfo.tier }}
              </span>
            </div>
            <div class="flex w-full items-center justify-between text-[11px] opacity-85">
              <span>已颁布 {{ instituteProgressSummary.common.active }}/{{ instituteProgressSummary.common.total }}</span>
              <span>{{ commonTracks.length }} 组条令</span>
            </div>
          </button>

          <button
            type="button"
            role="tab"
            class="prt-institute-tab flex flex-col justify-between gap-1 rounded-[2px] px-2 py-1.5 text-left font-mono transition-all"
            :class="{ 'prt-institute-tab--active': activeInstitute === 'soviet' }"
            :aria-selected="activeInstitute === 'soviet'"
            data-institute-tab="soviet"
            @click="selectInstitute('soviet')"
          >
            <div class="flex w-full items-center justify-between gap-1">
              <span class="truncate text-[11.5px] font-bold">◆ 苏联科研院所 · SOVIET</span>
              <span class="prt-mini-tier shrink-0 rounded-[2px] px-1 py-0.5 text-[11px] font-bold">
                T{{ sovietInstituteInfo.tier }}
              </span>
            </div>
            <div class="flex w-full items-center justify-between text-[11px] opacity-85">
              <span>已颁布 {{ instituteProgressSummary.soviet.active }}/{{ instituteProgressSummary.soviet.total }}</span>
              <span>{{ sovietTracks.length }} 组条令</span>
            </div>
          </button>

          <button
            type="button"
            role="tab"
            class="prt-institute-tab flex flex-col justify-between gap-1 rounded-[2px] px-2 py-1.5 text-left font-mono transition-all"
            :class="{ 'prt-institute-tab--active': activeInstitute === 'allied' }"
            :aria-selected="activeInstitute === 'allied'"
            data-institute-tab="allied"
            @click="selectInstitute('allied')"
          >
            <div class="flex w-full items-center justify-between gap-1">
              <span class="truncate text-[11.5px] font-bold">◆ 盟军科研院所 · ALLIED</span>
              <span class="prt-mini-tier shrink-0 rounded-[2px] px-1 py-0.5 text-[11px] font-bold">
                T{{ alliedInstituteInfo.tier }}
              </span>
            </div>
            <div class="flex w-full items-center justify-between text-[11px] opacity-85">
              <span>已颁布 {{ instituteProgressSummary.allied.active }}/{{ instituteProgressSummary.allied.total }}</span>
              <span>{{ alliedTracks.length }} 组条约</span>
            </div>
          </button>

          <button
            type="button"
            role="tab"
            class="prt-institute-tab flex flex-col justify-between gap-1 rounded-[2px] px-2 py-1.5 text-left font-mono transition-all"
            :class="{ 'prt-institute-tab--active': activeInstitute === 'yuri' }"
            :aria-selected="activeInstitute === 'yuri'"
            data-institute-tab="yuri"
            @click="selectInstitute('yuri')"
          >
            <div class="flex w-full items-center justify-between gap-1">
              <span class="truncate text-[11.5px] font-bold">◆ 尤里认知与生物工程督导院 · YURI</span>
              <span class="prt-mini-tier shrink-0 rounded-[2px] px-1 py-0.5 text-[11px] font-bold">
                T{{ yuriInstituteInfo.tier }}
              </span>
            </div>
            <div class="flex w-full items-center justify-between text-[11px] opacity-85">
              <span>已颁布 {{ instituteProgressSummary.yuri.active }}/{{ instituteProgressSummary.yuri.total }}</span>
              <span>{{ yuriTracks.length }} 组协议</span>
            </div>
          </button>
        </div>

        <!-- 当前院所动态晋升头衔 -->
        <div
          class="flex flex-wrap items-center justify-between gap-1.5 border-t pt-1.5"
          style="border-color: var(--prt-border)"
        >
          <div class="flex flex-wrap items-center gap-2">
            <div
              class="prt-institute-title text-[13px] font-bold tracking-wide"
              data-institute-title
              :data-institute-stage="currentInstituteInfo.stage"
              :data-institute-tier="currentInstituteInfo.tier"
            >
              {{ currentInstituteInfo.title }}
            </div>
            <span
              class="prt-tier-pill rounded-[2px] px-1.5 py-0.5 font-mono text-[11px] font-bold"
              data-institute-tier-badge
              :data-institute-tier="currentInstituteInfo.tier"
            >
              最高准入 T{{ currentInstituteInfo.tier }}
            </span>
          </div>
          <div class="prt-institute-sub font-mono text-[11px]">
            {{ currentInstituteInfo.subtitle }}
          </div>
        </div>
      </section>

      <!-- 右翼：全局算力与实验室并网栏 -->
      <section
        class="prt-global-grid flex flex-col justify-between gap-1.5 rounded-[2px] border p-2 lg:col-span-5"
        data-protocol-global-grid
        aria-label="科研算力与实验室并网栏"
      >
        <div class="flex flex-wrap items-center justify-between gap-1.5">
          <span class="prt-grid-heading font-mono text-[11px] font-semibold">◆ 科研算力与实验室并网</span>
          <div class="flex items-center gap-1.5 font-mono text-[11px]">
            <span class="prt-points-stock" data-protocol-points :data-points="protocolPoints">
              储备 <strong>{{ formattedProtocolPoints }}</strong> 点
            </span>
            <span
              class="prt-points-rate rounded-[2px] px-1.5 py-0.5 font-bold"
              data-protocol-daily-rate
              :data-daily-rate="dailyPointRate"
              :data-daily-rate-precise="preciseDailyRateText"
            >
              {{ formattedDailyRateText }}
            </span>
            <span
              v-if="autoQueueList.length > 0"
              class="prt-points-rate rounded-[2px] px-1.5 py-0.5 font-bold"
              data-protocol-topbar-auto-badge
              :data-auto-queued-count="autoQueueList.length"
            >
              ◆ 排程 {{ autoQueueList.length }}
            </span>
          </div>
        </div>

        <!-- 常驻并网节点徽标 -->
        <div class="grid grid-cols-2 gap-1.5">
          <div
            class="prt-grid-badge ob-tag flex items-center justify-between gap-1 rounded-[2px] border px-2 py-1 font-mono text-[11px]"
            :class="{ 'prt-grid-badge--on': isBattleLabInService }"
            data-grid-badge="battle_lab"
            :data-in-service="isBattleLabInService ? 'true' : 'false'"
          >
            <span class="flex min-w-0 items-center gap-1.5 truncate">
              <span class="prt-badge-dot flex-none" aria-hidden="true" />
              <span class="truncate">战斗实验室</span>
            </span>
            <span class="prt-badge-state flex-none">{{ isBattleLabInService ? '在役' : '未建' }}</span>
          </div>

          <div
            class="prt-grid-badge ob-tag flex items-center justify-between gap-1 rounded-[2px] border px-2 py-1 font-mono text-[11px]"
            :class="{ 'prt-grid-badge--on': gridStatus.supercomputer }"
            data-grid-badge="supercomputer"
            :data-in-service="gridStatus.supercomputer ? 'true' : 'false'"
          >
            <span class="flex min-w-0 items-center gap-1.5 truncate">
              <span class="prt-badge-dot flex-none" aria-hidden="true" />
              <span class="truncate">超算中心 (+0.10/日)</span>
            </span>
            <span class="prt-badge-state flex-none">{{ gridStatus.supercomputer ? '在役' : '未建' }}</span>
          </div>

          <div
            class="prt-grid-badge ob-tag flex items-center justify-between gap-1 rounded-[2px] border px-2 py-1 font-mono text-[11px]"
            :class="{ 'prt-grid-badge--on': gridStatus.quantumSupercomputer }"
            data-grid-badge="quantum_supercomputer"
            :data-in-service="gridStatus.quantumSupercomputer ? 'true' : 'false'"
          >
            <span class="flex min-w-0 items-center gap-1.5 truncate">
              <span class="prt-badge-dot flex-none" aria-hidden="true" />
              <span class="truncate">量子超算中心 (+0.25/日)</span>
            </span>
            <span class="prt-badge-state flex-none">{{ gridStatus.quantumSupercomputer ? '在役' : '未建' }}</span>
          </div>

          <div
            class="prt-grid-badge ob-tag flex items-center justify-between gap-1 rounded-[2px] border px-2 py-1 font-mono text-[11px]"
            :class="{ 'prt-grid-badge--on': gridStatus.crossFactionSynergy }"
            data-grid-badge="cross_faction_synergy"
            :data-in-service="gridStatus.crossFactionSynergy ? 'true' : 'false'"
          >
            <span class="flex min-w-0 items-center gap-1.5 truncate">
              <span class="prt-badge-dot flex-none" aria-hidden="true" />
              <span class="truncate">双阵营协同 (+50%)</span>
            </span>
            <span class="prt-badge-state flex-none">{{ gridStatus.crossFactionSynergy ? '在役' : '未建' }}</span>
          </div>
        </div>
      </section>
    </div>

    <!-- ── 三栏主体骨架：左栏轨道目录 (n/N) ＋ 主视区节点链图骨架 ＋ 右栏详情抽屉槽位 ── -->
    <div class="prt-tri-layout grid grid-cols-1 items-start gap-2 md:grid-cols-12">
      <!-- 1. 左栏轨道目录 -->
      <aside
        class="prt-track-sidebar flex flex-col gap-1.5 rounded-[2px] border p-2 md:col-span-3"
        data-protocol-track-list
        aria-label="机密条令目录"
      >
        <div class="prt-section-header flex items-center justify-between px-1 font-mono text-[11px]">
          <span>{{
            activeInstitute === 'common'
              ? '◆ 通用联合条令总署'
              : activeInstitute === 'soviet'
                ? '苏军统帅部条令'
                : activeInstitute === 'yuri'
                  ? '◆ 尤里认知与生物工程督导院'
                  : '盟军防务条约'
          }}</span>
          <span>共 {{ currentTracks.length }} 组</span>
        </div>

        <button
          v-for="(track, idx) in currentTracks"
          :key="track.name"
          type="button"
          class="prt-track-item flex flex-col gap-1.5 rounded-[2px] border p-2 text-left transition-all"
          :class="{ 'prt-track-item--active': activeTrackName === track.name }"
          data-protocol-track-item
          :data-track-index="idx + 1"
          :data-track-name="track.name"
          :data-track-active="activeTrackName === track.name ? 'true' : 'false'"
          :data-track-progress="`${track.activeCount}/${track.totalCount}`"
          @click="selectTrack(track.name)"
        >
          <div class="flex w-full items-center justify-between gap-1.5">
            <span class="prt-track-title truncate text-[12px] font-semibold"> {{ idx + 1 }}. {{ track.name }} </span>
            <span class="prt-track-count flex-none font-mono text-[11px] font-bold">
              {{ track.activeCount }}/{{ track.totalCount }}
            </span>
          </div>
          <div class="prt-progress-track h-[4px] w-full overflow-hidden rounded-[1px]">
            <div
              class="prt-progress-fill h-full transition-all"
              :style="{
                width: `${track.totalCount > 0 ? Math.round((track.activeCount / track.totalCount) * 100) : 0}%`,
              }"
            />
          </div>
        </button>
      </aside>

      <!-- 2. 主视区：选中轨道协议节点序列骨架（全卷宗常驻可查阅 + 五态链图与经验条） -->
      <main
        class="prt-main-stage prt-col-scroll flex flex-col gap-2 rounded-[2px] border p-2.5 md:col-span-5"
        data-protocol-main-stage
        aria-label="条令攻关主视区"
      >
        <div
          class="flex flex-wrap items-center justify-between gap-2 border-b pb-1.5"
          style="border-color: var(--prt-border)"
        >
          <div class="flex items-center gap-2">
            <span class="prt-stage-track-title text-[13px] font-bold" data-active-track-title>
              {{ activeTrack?.name ?? '未选择条令系列' }}
            </span>
            <span v-if="activeTrack" class="prt-stage-track-meta font-mono text-[11px]">
              （已颁布 {{ activeTrack.activeCount }}/{{ activeTrack.totalCount }}）
            </span>
          </div>
          <span class="prt-stage-hint font-mono text-[11px]"> 逐级攻关 · 定型配发 </span>
        </div>

        <div
          v-if="showNoLabEmptyState"
          class="prt-no-lab-banner flex items-center justify-between gap-2 rounded-[2px] border px-2.5 py-1.5 font-mono text-[11px]"
          data-test="protocol-no-lab-empty"
          role="status"
        >
          <span>◆ 战地参谋部编制 [T1] · 尚未建造作战实验室或科研院所（全卷宗已开放查阅与自动排程预编）</span>
          <span class="shrink-0 opacity-80">共 {{ activeTrack?.nodes.length ?? 0 }} 项条令</span>
        </div>

        <div v-if="activeTrack && activeTrack.nodes.length > 0" class="flex flex-col gap-1.5" data-protocol-chain>
          <template v-for="(node, nIdx) in activeTrack.nodes" :key="node.id">
            <div
              v-if="nIdx > 0"
              class="prt-connector"
              :class="{ 'is-energized': activeTrack.nodes[nIdx - 1].status === 'active' }"
              data-protocol-connector
              aria-hidden="true"
            />
            <button
              type="button"
              :aria-pressed="selectedNode?.id === node.id"
              :data-protocol-node="node.id"
              class="prt-node-card flex flex-col gap-1.5 rounded-[2px] border p-2.5 text-left transition-all"
              :class="{
                'prt-node-card--active': node.status === 'active',
                'prt-node-card--selected': selectedNode?.id === node.id,
              }"
              data-protocol-node-card
              :data-protocol-id="node.id"
              :data-protocol-name="node.name"
              :data-protocol-tier="node.tier"
              :data-protocol-status="node.status"
              :data-protocol-exp="node.exp"
              :data-protocol-auto-queued="node.autoQueued ? 'true' : 'false'"
              :data-protocol-queue-order="node.autoQueued ? node.queueOrder : undefined"
              :data-protocol-hold="node.hold ? 'true' : 'false'"
              @click="selectNode(node.id)"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex min-w-0 items-center gap-1.5">
                  <span class="prt-node-seq flex-none font-mono text-[11px]">#{{ nIdx + 1 }}</span>
                  <span class="prt-node-name text-[12.5px] font-bold" :title="node.name">
                    {{ node.name }}
                  </span>
                </div>
                <div class="flex flex-none items-center gap-1 font-mono text-[11px]">
                  <span class="prt-node-tier rounded-[2px] border px-1.5 py-0.5 font-bold">T{{ node.tier }}</span>
                  <span class="prt-node-status rounded-[2px] px-1.5 py-0.5 font-bold">
                    {{ statusLabel(node.status) }}
                  </span>
                </div>
              </div>

              <p v-if="node.desc" class="prt-node-desc line-clamp-2 text-[12px] leading-snug">
                {{ node.desc }}
              </p>

              <div class="flex flex-wrap items-center justify-between gap-1.5 pt-0.5 font-mono text-[11px]">
                <span class="prt-node-hint">{{ nodeHint(node) }}</span>
                <span class="prt-prob-badge font-bold" :data-protocol-next-prob="node.nextProb"
                  >{{ node.status === 'active' ? '终态突破率' : 'P(' + (node.attempts + 1) + ') 下次突破率' }}
                  {{ node.nextProb }}%</span
                >
              </div>

              <div class="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                <span class="prt-cost-chip rounded-[2px] px-1.5 py-0.5"
                  >单次 {{ node.costPoints }} 点 + {{ node.costCredits }} 资金</span
                >
                <span
                  v-if="node.reveals.length > 0"
                  class="prt-reveal-chip rounded-[2px] px-1.5 py-0.5"
                >
                  ◆ 揭示科技 ×{{ node.reveals.length }}
                </span>
                <span
                  v-if="node.autoQueued"
                  class="prt-auto-badge rounded-[2px] px-1.5 py-0.5 font-mono text-[11px] font-bold"
                  data-protocol-node-auto-badge
                  :data-queue-order="node.queueOrder"
                  :data-hold="node.hold ? 'true' : 'false'"
                >
                  ◆ 自动排程 #{{ node.queueOrder }}{{ node.hold ? ' · 暂缓' : '' }}
                </span>
              </div>

              <span v-if="isLabSealed(node)" data-protocol-lab-sealed class="prt-sealed text-[11px]"
                >▲ 对口实验室离线 · 已攒经验 {{ node.exp }}% 封存保留</span
              >
              <!-- 定型经验进度条 -->
              <div class="flex items-center gap-2 pt-0.5 font-mono text-[11px]">
                <span class="prt-node-exp-label flex-none">定型经验</span>
                <div
                  class="prt-progress-track h-[4px] flex-1 overflow-hidden rounded-[1px]"
                  role="progressbar"
                  :aria-label="node.name + '定型经验'"
                  :aria-valuenow="node.exp"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div
                    class="prt-progress-fill h-full"
                    data-protocol-exp-bar
                    :data-exp-value="node.exp"
                    :style="{ width: `${node.exp}%` }"
                  />
                </div>
                <span class="prt-node-exp-val flex-none font-bold">{{ node.exp }}%</span>
              </div>
            </button>
          </template>
        </div>

        <div v-else class="prt-empty-stage py-6 text-center font-mono text-[11px]">当前系列下暂无条令条目</div>
      </main>

      <!-- 3. 右栏详情抽屉槽位（4 段式结构化机密条令实验卷宗舱） -->
      <aside
        class="prt-detail-slot prt-col-scroll flex flex-col gap-2 rounded-[2px] border p-2.5 md:col-span-4"
        data-protocol-detail-slot
        aria-label="协议详情与揭示槽位"
      >
        <div
          class="prt-section-header flex items-center justify-between border-b pb-1.5 font-mono text-[11px]"
          style="border-color: var(--prt-border)"
        >
          <span class="font-bold">◆ 机密条令实验卷宗</span>
          <span class="prt-tier-pill rounded-[2px] px-1.5 py-0.5 font-bold">
            {{ selectedNode ? `T${selectedNode.tier} · ${statusLabel(selectedNode.status)}` : '待命' }}
          </span>
        </div>

        <template v-if="selectedNode">
          <div class="prt-detail-subcard rounded-[2px] border p-2.5">
            <div class="prt-detail-title text-[13.5px] font-extrabold tracking-wide" data-detail-protocol-name>
              {{ selectedNode.name }}
            </div>
            <div class="prt-detail-meta mt-1 font-mono text-[11px]">
              编号：{{ selectedNode.id }}<br />阵营：{{ selectedNode.faction }} · 系列：{{ selectedNode.track }} · T{{
                selectedNode.tier
              }}
            </div>
            <div class="prt-detail-meta mt-1.5 flex flex-wrap gap-1.5 font-mono text-[11px]">
              <span class="prt-cost-chip rounded-[2px] px-1.5 py-0.5">状态：{{ statusLabel(selectedNode.status) }}</span>
              <span class="prt-cost-chip rounded-[2px] px-1.5 py-0.5">轮次：{{ selectedNode.attempts }}</span>
              <span class="prt-cost-chip rounded-[2px] px-1.5 py-0.5">
                单次：{{ selectedNode.costPoints }}点 + {{ selectedNode.costCredits }}资金
              </span>
            </div>
          </div>

          <span
            v-if="isLabSealed(selectedNode)"
            data-protocol-lab-sealed
            class="prt-sealed rounded-[2px] border px-2 py-1 text-[11px]"
            >▲ 对口实验室离线 · 已攒经验 {{ selectedNode.exp }}% 封存保留；轮次与累计投入不清零</span
          >

          <div class="prt-detail-subcard rounded-[2px] border p-2.5">
            <div class="font-mono text-[11px] font-bold" style="color: var(--prt-accent)">◆ 条令战术效果说明</div>
            <p class="prt-detail-desc mt-1 text-[12px] leading-relaxed">
              {{ selectedNode.desc }}
            </p>
          </div>

          <div
            data-protocol-experiment-cost
            class="prt-detail-subcard flex flex-col gap-1.5 rounded-[2px] border p-2.5 text-[11px]"
          >
            <div class="flex items-center justify-between font-mono font-bold" style="color: var(--prt-accent)">
              <span>◆ 实验投入与突破率阶梯</span>
              <span>最多 {{ PROTOCOL_TIER_EXPERIMENT_SPEC[selectedNode.tier].maxAttempts }} 轮硬保底必成</span>
            </div>
            <div class="font-mono leading-relaxed opacity-90">
              单次消耗 {{ selectedNode.costPoints }} 协议点 + {{ selectedNode.costCredits }} 资金<br />
              累计已投 {{ selectedNode.pointsSpent }} 点 / {{ selectedNode.creditsSpent }} 资金<br />
              已开展 {{ selectedNode.attempts }} 轮 · 经验 {{ selectedNode.exp }}% · P({{ selectedNode.attempts + 1 }})
              {{ selectedNode.nextProb }}%
            </div>
            <div class="mt-1 grid grid-cols-3 gap-1 sm:grid-cols-5">
              <div
                v-for="step in selectedAttemptSteps"
                :key="step.attempt"
                class="prt-step-cell flex flex-col items-center rounded-[2px] border px-1 py-1 font-mono text-[11px]"
                :class="{
                  'is-current': step.isCurrentNext,
                  'is-passed': step.isPassed,
                }"
              >
                <span class="opacity-80">第{{ step.attempt }}轮</span>
                <span class="font-bold">{{ step.probPercent }}%</span>
              </div>
            </div>
          </div>

          <section
            data-protocol-unlocks
            class="prt-detail-subcard rounded-[2px] border p-2.5 text-[11px]"
            aria-label="关联装备建筑与改装工程预览"
          >
            <strong class="font-mono" style="color: var(--prt-accent)">◆ 关联装备、建筑与改装工程</strong>
            <ul v-if="selectedUnlocks.length" class="mt-1.5 flex flex-wrap gap-1.5">
              <li
                v-for="entry in selectedUnlocks"
                :key="entry.name"
                class="prt-cost-chip rounded-[2px] px-2 py-0.5 font-mono text-[11px]"
              >
                {{ entry.name }}
              </li>
            </ul>
            <p v-else class="mt-1 opacity-75">暂无已登记关联装备或工程</p>
          </section>

          <div
            data-protocol-reveals
            class="prt-detail-subcard flex flex-col gap-1.5 rounded-[2px] border p-2.5"
          >
            <span class="font-mono text-[11px] font-bold" style="color: var(--prt-accent)">激活揭示科技：</span
            ><span v-if="!selectedNode.reveals.length" class="text-[11px] opacity-75">暂无揭示科技配置</span>
            <button
              v-for="rev in selectedNode.reveals"
              :key="rev"
              type="button"
              class="prt-reveal-link rounded-[2px] border px-2 py-1 text-left font-mono text-[11px] transition-all"
              data-protocol-reveal-link
              :data-reveal-target="rev"
              :data-reveal-tech-link="rev"
              @click="jumpToTech(rev)"
            >
              ◆ {{ revealTarget(rev).techName }} →
            </button>
          </div>

          <div data-protocol-actions class="flex flex-col gap-1.5">
            <button
              type="button"
              class="prt-action-btn prt-action-btn--primary rounded-[2px] border px-2.5 py-2 font-mono text-[11.5px] font-bold transition-all"
              data-protocol-experiment-btn
              :data-protocol-id="selectedNode.id"
              :data-next-attempt="selectedNode.attempts + 1"
              :data-predicted-outcome="selectedExperimentGuard.prediction.outcome"
              :data-predicted-exp="selectedExperimentGuard.prediction.expAfter"
              :disabled="!selectedExperimentGuard.enabled"
              @click="handleExperimentClick(selectedNode)"
            >
              ◆ 开展第 {{ selectedNode.attempts + 1 }} 轮实验
            </button>
            <p
              v-if="!selectedExperimentGuard.enabled"
              class="prt-guard-reason rounded-[2px] border px-2 py-1 font-mono text-[11px]"
              data-protocol-guard-reason
              :data-guard-code="selectedExperimentGuard.reasonCode ?? undefined"
            >
              ◆ {{ selectedExperimentGuard.reasonText }}
            </p>
            <button
              type="button"
              class="prt-action-btn prt-action-btn--secondary rounded-[2px] border px-2.5 py-1.5 font-mono text-[11px] font-bold transition-all"
              :class="{ 'prt-action-btn--queued': selectedNode.autoQueued }"
              data-protocol-auto-toggle
              :data-protocol-id="selectedNode.id"
              :data-auto-queued="selectedNode.autoQueued ? 'true' : 'false'"
              :aria-pressed="selectedNode.autoQueued"
              :disabled="!canToggleAutoQueue(selectedNode)"
              @click="toggleAutoQueue(selectedNode.id)"
            >
              {{
                selectedNode.autoQueued
                  ? `◇ 自动安排实验（已入列 #${selectedNode.queueOrder ?? 1} · 点击取消）`
                  : '◇ 自动安排实验'
              }}
            </button>
            <div
              v-if="stagedReceipt"
              class="prt-staged-receipt rounded-[2px] border px-2 py-1.5 font-mono text-[11px]"
              data-protocol-staged-receipt
              :data-staged-kind="stagedReceipt.kind"
              :data-staged-protocol-id="stagedReceipt.protocolId"
              :data-staged-outcome="stagedReceipt.outcome ?? undefined"
              :data-staged-channel="stagedReceipt.channel"
              role="status"
              aria-live="polite"
            >
              <div class="font-bold">{{ stagedReceipt.title }}</div>
              <div class="mt-0.5 opacity-90">{{ stagedReceipt.commandText }}</div>
            </div>
            <slot name="actions" :node="selectedNode" />
          </div>

          <section
            class="prt-auto-queue mt-1 flex flex-col gap-1.5 border-t pt-2"
            style="border-color: var(--prt-border)"
            data-protocol-auto-queue
            :data-queue-count="autoQueueList.length"
            aria-label="自动实验排程候列"
          >
            <div class="flex items-center justify-between font-mono text-[11px]">
              <span class="font-semibold">◆ 自动实验排程候列</span>
              <span>{{ autoQueueList.length }} 项</span>
            </div>
            <p v-if="autoQueueList.length === 0" class="font-mono text-[11px] opacity-75">
              暂无自动排程协议（支持对准入未齐/待立项/攻关中协议开启自动排程）
            </p>
            <div v-else class="flex flex-col gap-1">
              <div
                v-for="(qNode, qIdx) in autoQueueList"
                :key="qNode.id"
                class="prt-queue-item flex flex-col gap-1 rounded-[2px] border p-1.5 font-mono text-[11px]"
                data-protocol-queue-item
                :data-protocol-id="qNode.id"
                :data-queue-order="qIdx + 1"
                :data-protocol-hold="qNode.hold ? 'true' : 'false'"
              >
                <div class="flex items-center justify-between gap-1">
                  <span class="truncate font-bold" :title="qNode.name"> #{{ qIdx + 1 }} {{ qNode.name }} </span>
                  <span class="flex-none text-[11px]">
                    {{ qNode.hold ? '◇ 暂缓' : qIdx === 0 ? '◆ 首序' : '● 候列' }} · {{ qNode.exp }}%
                  </span>
                </div>
                <div class="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    class="prt-queue-btn rounded-[2px] border px-1.5 py-0.5 text-[11px]"
                    data-protocol-queue-up
                    :data-protocol-id="qNode.id"
                    :disabled="qIdx === 0"
                    aria-label="上移排程优先级"
                    @click="moveAutoQueueItem(qNode.id, 'up')"
                  >
                    ▲ 上移
                  </button>
                  <button
                    type="button"
                    class="prt-queue-btn rounded-[2px] border px-1.5 py-0.5 text-[11px]"
                    data-protocol-queue-down
                    :data-protocol-id="qNode.id"
                    :disabled="qIdx === autoQueueList.length - 1"
                    aria-label="下移排程优先级"
                    @click="moveAutoQueueItem(qNode.id, 'down')"
                  >
                    ▼ 下移
                  </button>
                  <button
                    type="button"
                    class="prt-queue-btn rounded-[2px] border px-1.5 py-0.5 text-[11px]"
                    data-protocol-queue-top
                    :data-protocol-id="qNode.id"
                    :disabled="qIdx === 0"
                    aria-label="置顶排程优先级"
                    @click="moveAutoQueueItem(qNode.id, 'top')"
                  >
                    ▲ 置顶
                  </button>
                  <button
                    type="button"
                    class="prt-queue-btn rounded-[2px] border px-1.5 py-0.5 text-[11px]"
                    data-protocol-queue-hold
                    :data-protocol-id="qNode.id"
                    :data-hold="qNode.hold ? 'true' : 'false'"
                    :aria-pressed="qNode.hold"
                    :aria-label="qNode.hold ? '恢复自动实验排程' : '暂缓自动实验排程'"
                    @click="toggleAutoQueueHold(qNode.id)"
                  >
                    {{ qNode.hold ? '● 恢复' : '◇ 暂缓' }}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </template>
        <div v-else class="py-4 text-center font-mono text-[11px]">从左侧选择一项条令，查看攻关进度与具体效果</div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { playTacticalStagger, scheduleNextFrame } from '../../红警指挥系统/ui/motion/useGsapMotion';
import { dailyProtocolPointRate, scanActiveProtocolBuildings } from '../../红警指挥系统/engines/protocolAnchors';
import { evaluateCommandHQModifiers } from '../../红警指挥系统/engines/settleFloorPhases';
import { PROTOCOL_TIER_EXPERIMENT_SPEC } from '../../红警指挥系统/engines/protocolEngine';
import { ALLIED_TRACK_NAMES, buildProtocolCatalogLookup, SOVIET_TRACK_NAMES } from '../../红警指挥系统/engines/protocolCatalogIndex';
import type { Schema } from '../../红警指挥系统/core/schema';
import { useDataStore } from '../../红警指挥系统/composables/store';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import { canToggleProtocolAutoQueue } from '../models/protocolCommands';
import type { ProtocolAutoQueueItemView, ProtocolCommandStagedEvent, ProtocolExperimentGuardResult, ProtocolScheduleAction, ProtocolScheduleDispatchEvent } from '../models/protocolCommands';
import {
  attachNormalizedQueueOrdersToTracks, buildAttemptLadderSteps, buildAutoQueueList, buildExternalQueueSignature, buildLegacyTechDoneSet,
  buildNormalizedQueueOrderMap, buildRawTrackViewsForFaction, buildRuntimeProtocolMap, buildScheduleChangeDispatch,
  computeIsLabSealed, computeMoveAutoQueueNext, computeNodeHint, computeSelectedUnlocks,
  computeToggleAutoQueueHoldNext, computeToggleAutoQueueNext, defaultCreditsByTier, detectHasCustomCatalogOnly,
  evaluateNodeExperimentGuard, executeProtocolExperimentClick, findProtocolNodeById, formatPreciseDailyRateText,
  formatProtocolPoints, normalizeReveals, referencesProtocol, resolveAlliedInstituteInfo,
  resolveCommonInstituteInfo, resolveMergedCatalogProtocols, resolveNodeQueueStateFromMap, resolveRevealTarget,
  resolveSovietInstituteInfo, resolveTotalDailyPoints, resolveYuriInstituteInfo, safeNumber,
  shouldShowProtocolNoLabEmptyState, statusLabel, COMMON_TRACK_NAMES, YURI_TRACK_NAMES,
} from './panelProtocolHelpers';
import type { InstituteStageInfo, InstituteTheme, LocalQueueOverride, ProtocolAttemptStepView, ProtocolCatalogEntry, ProtocolCompatibleState, ProtocolGridStatus, ProtocolNodeView, ProtocolRuntimeEntry, ProtocolStagedReceiptView, ProtocolStatusType, ProtocolTrackView } from './panelProtocolHelpers';

export type { InstituteStageInfo, InstituteTheme, ProtocolCatalogEntry, ProtocolCompatibleState, ProtocolGridStatus, ProtocolRuntimeEntry, ProtocolStagedReceiptView, ProtocolStatusType } from './panelProtocolHelpers';

const props = withDefaults(
  defineProps<{
    snapshot?: Schema | ProtocolCompatibleState | null;
    initialInstitute?: InstituteTheme;
    initialTrack?: string | null;
    totalDailyPoints?: number;
    factionFilter?: string;
    unlockedFactions?: readonly string[];
  }>(),
  { snapshot: undefined, initialInstitute: 'soviet', initialTrack: null, totalDailyPoints: undefined, factionFilter: undefined, unlockedFactions: undefined },
);

const emit = defineEmits<{
  (e: 'jump-to-tech', target: { techId: string; techName: string }): void;
  (e: 'command-staged', payload: ProtocolCommandStagedEvent): void;
  (e: 'schedule-dispatch', payload: ProtocolScheduleDispatchEvent): void;
}>();

let store: ReturnType<typeof useDataStore> | null = null;
let catalog: ReturnType<typeof useCatalogStore> | null = null;
try {
  store = useDataStore();
  catalog = useCatalogStore();
} catch {
  store = null;
  catalog = null;
}

const activeState = computed<ProtocolCompatibleState | null>(() =>
  props.snapshot !== undefined ? props.snapshot : ((store?.data as ProtocolCompatibleState | undefined) ?? null),
);

const activeInstitute = ref<InstituteTheme>(
  props.factionFilter === 'common' ||
    props.factionFilter === 'allied' ||
    props.factionFilter === 'soviet' ||
    props.factionFilter === 'yuri'
    ? props.factionFilter
    : props.initialInstitute,
);
watch(() => props.initialInstitute, val => { if (val) activeInstitute.value = val; });
watch(
  () => props.factionFilter,
  val => {
    if (val === 'common' || val === 'allied' || val === 'soviet' || val === 'yuri') activeInstitute.value = val;
  },
);

function selectInstitute(inst: InstituteTheme): void { activeInstitute.value = inst; }

const gridStatus = computed<ProtocolGridStatus>(() => scanActiveProtocolBuildings(activeState.value));
const isBattleLabInService = computed<boolean>(() =>
  Boolean(
    gridStatus.value.commonBattleLab ||
      gridStatus.value.alliedT2Lab ||
      gridStatus.value.sovietT2Lab ||
      gridStatus.value.yuriT2Lab ||
      gridStatus.value.alliedT3Sanctuary ||
      gridStatus.value.sovietT3Sanctuary ||
      gridStatus.value.yuriT3Sanctuary,
  ),
);
const commonInstituteInfo = computed<InstituteStageInfo>(() => resolveCommonInstituteInfo(gridStatus.value));
const sovietInstituteInfo = computed<InstituteStageInfo>(() => resolveSovietInstituteInfo(gridStatus.value));
const alliedInstituteInfo = computed<InstituteStageInfo>(() => resolveAlliedInstituteInfo(gridStatus.value));
const yuriInstituteInfo = computed<InstituteStageInfo>(() => resolveYuriInstituteInfo(gridStatus.value));
const currentInstituteInfo = computed<InstituteStageInfo>(() =>
  activeInstitute.value === 'common'
    ? commonInstituteInfo.value
    : activeInstitute.value === 'soviet'
      ? sovietInstituteInfo.value
      : activeInstitute.value === 'yuri'
        ? yuriInstituteInfo.value
        : alliedInstituteInfo.value,
);

const protocolPoints = computed<number>(() => {
  const raw = activeState.value?.protocol_points;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
});

const formattedProtocolPoints = computed<string>(() => formatProtocolPoints(protocolPoints.value));
const dailyPointRate = computed(() => {
  const baseRate = dailyProtocolPointRate(activeState.value);
  const bonus = evaluateCommandHQModifiers(activeState.value as Partial<Schema> | null | undefined).protocolDailyRateBonus;
  return bonus > 0 ? Math.round((baseRate + bonus) * 10000) / 10000 : baseRate;
});
const totalDailyPoints = computed<number>(() => resolveTotalDailyPoints(activeState.value, props.totalDailyPoints));

const showNoLabEmptyState = computed<boolean>(() =>
  shouldShowProtocolNoLabEmptyState(activeState.value, {
    totalDailyPoints: totalDailyPoints.value,
    hasCustomCatalogOnly: detectHasCustomCatalogOnly(catalog),
  }),
);

const formattedDailyRateText = computed<string>(() => `+${dailyPointRate.value.toFixed(2)} 点/日`);
const preciseDailyRateText = computed<string>(() => formatPreciseDailyRateText(dailyPointRate.value));

function revealTarget(raw: string): { techId: string; techName: string } { return resolveRevealTarget(catalog, raw); }
function jumpToTech(raw: string): void { emit('jump-to-tech', revealTarget(raw)); }

const nodeLabSealedMap = computed<Map<string, boolean>>(() => {
  const map = new Map<string, boolean>();
  const nodes = activeTrack.value?.nodes ?? [];
  const state = activeState.value;
  const scan = gridStatus.value;
  for (const node of nodes) {
    map.set(node.id, computeIsLabSealed(state, node, scan));
  }
  return map;
});

const nodeHintMap = computed<Map<string, string>>(() => {
  const map = new Map<string, string>();
  const nodes = activeTrack.value?.nodes ?? [];
  const state = activeState.value;
  const scan = gridStatus.value;
  for (const node of nodes) {
    map.set(node.id, computeNodeHint(state, nodes, node, scan));
  }
  return map;
});

function isLabSealed(node: ProtocolNodeView): boolean {
  if (nodeLabSealedMap.value.has(node.id)) {
    return nodeLabSealedMap.value.get(node.id)!;
  }
  return computeIsLabSealed(activeState.value, node, gridStatus.value);
}

function nodeHint(node: ProtocolNodeView): string {
  if (nodeHintMap.value.has(node.id)) {
    return nodeHintMap.value.get(node.id)!;
  }
  return computeNodeHint(activeState.value, activeTrack.value?.nodes ?? [], node, gridStatus.value);
}

const selectedUnlocks = computed(() => computeSelectedUnlocks(catalog, selectedNode.value));

const mergedCatalogProtocols = computed<readonly ProtocolCatalogEntry[]>(() => resolveMergedCatalogProtocols(catalog));
const catalogProtocolLookup = computed(() => buildProtocolCatalogLookup(mergedCatalogProtocols.value));
const runtimeProtocolMap = computed(() => buildRuntimeProtocolMap(activeState.value, catalogProtocolLookup.value));
const legacyTechDoneSet = computed(() => buildLegacyTechDoneSet(activeState.value, catalogProtocolLookup.value));

const localQueueOverrides = ref<Record<string, LocalQueueOverride>>({});
const externalQueueSignature = computed(() => buildExternalQueueSignature(activeState.value));
watch(externalQueueSignature, () => { localQueueOverrides.value = {}; });

function resolveNodeQueueState(nodeId: string, status: ProtocolStatusType, inst?: ProtocolRuntimeEntry): LocalQueueOverride {
  return resolveNodeQueueStateFromMap(localQueueOverrides.value, nodeId, status, inst);
}

function buildRawTrackViews(faction: '通用' | '苏联' | '盟军' | '尤里', trackNames: readonly string[]): ProtocolTrackView[] {
  return buildRawTrackViewsForFaction({
    faction,
    trackNames,
    mergedCatalogProtocols: mergedCatalogProtocols.value,
    runtimeProtocolMap: runtimeProtocolMap.value,
    legacyTechDoneSet: legacyTechDoneSet.value,
    activeState: activeState.value,
    resolveQueueState: resolveNodeQueueState,
  });
}

const rawCommonTracks = computed<ProtocolTrackView[]>(() => buildRawTrackViews('通用', COMMON_TRACK_NAMES));
const rawSovietTracks = computed<ProtocolTrackView[]>(() => buildRawTrackViews('苏联', SOVIET_TRACK_NAMES));
const rawAlliedTracks = computed<ProtocolTrackView[]>(() => buildRawTrackViews('盟军', ALLIED_TRACK_NAMES));
const rawYuriTracks = computed<ProtocolTrackView[]>(() => buildRawTrackViews('尤里', YURI_TRACK_NAMES));
const autoQueueList = computed<ProtocolAutoQueueItemView[]>(() =>
  buildAutoQueueList(rawSovietTracks.value, rawAlliedTracks.value, rawYuriTracks.value, rawCommonTracks.value),
);
const normalizedQueueOrderMap = computed<Map<string, number>>(() => buildNormalizedQueueOrderMap(autoQueueList.value));

function attachNormalizedQueueOrders(tracks: readonly ProtocolTrackView[]): ProtocolTrackView[] {
  return attachNormalizedQueueOrdersToTracks(tracks, normalizedQueueOrderMap.value);
}

const commonTracks = computed<ProtocolTrackView[]>(() => attachNormalizedQueueOrders(rawCommonTracks.value));
const sovietTracks = computed<ProtocolTrackView[]>(() => attachNormalizedQueueOrders(rawSovietTracks.value));
const alliedTracks = computed<ProtocolTrackView[]>(() => attachNormalizedQueueOrders(rawAlliedTracks.value));
const yuriTracks = computed<ProtocolTrackView[]>(() => attachNormalizedQueueOrders(rawYuriTracks.value));

const instituteProgressSummary = computed(() => {
  const sum = (tracks: readonly ProtocolTrackView[]) => ({
    active: tracks.reduce((s, t) => s + t.activeCount, 0),
    total: tracks.reduce((s, t) => s + t.totalCount, 0),
  });
  return {
    common: sum(commonTracks.value),
    soviet: sum(sovietTracks.value),
    allied: sum(alliedTracks.value),
    yuri: sum(yuriTracks.value),
  };
});

const currentTracks = computed<ProtocolTrackView[]>(() =>
  activeInstitute.value === 'common'
    ? commonTracks.value
    : activeInstitute.value === 'soviet'
      ? sovietTracks.value
      : activeInstitute.value === 'yuri'
        ? yuriTracks.value
        : alliedTracks.value,
);

const selectedTrackByInstitute = ref<{ common: string; soviet: string; allied: string; yuri: string }>({
  common: props.initialTrack && COMMON_TRACK_NAMES.includes(props.initialTrack) ? props.initialTrack : COMMON_TRACK_NAMES[0],
  soviet: props.initialTrack && SOVIET_TRACK_NAMES.includes(props.initialTrack) ? props.initialTrack : SOVIET_TRACK_NAMES[0],
  allied: props.initialTrack && ALLIED_TRACK_NAMES.includes(props.initialTrack) ? props.initialTrack : ALLIED_TRACK_NAMES[0],
  yuri: props.initialTrack && YURI_TRACK_NAMES.includes(props.initialTrack) ? props.initialTrack : YURI_TRACK_NAMES[0],
});

const activeTrackName = computed<string>(() => {
  const inst = activeInstitute.value;
  const preferred = selectedTrackByInstitute.value[inst];
  const list = currentTracks.value;
  if (list.some(t => t.name === preferred)) return preferred;
  return list[0]?.name ?? '';
});

const activeTrack = computed<ProtocolTrackView | undefined>(() =>
  currentTracks.value.find(t => t.name === activeTrackName.value),
);

function selectTrack(trackName: string): void {
  selectedTrackByInstitute.value = {
    ...selectedTrackByInstitute.value,
    [activeInstitute.value]: trackName,
  };
}

const protocolPanelRootRef = ref<HTMLElement | null>(null);
watch(
  () => [activeInstitute.value, activeTrackName.value],
  () => {
    scheduleNextFrame(() => {
      playTacticalStagger(protocolPanelRootRef.value, '.prt-track-item, .prt-node-card, .prt-detail-drawer', {
        maxItems: 14,
        duration: 0.16,
        stagger: 0.018,
      });
    });
  },
);

const selectedNodeId = ref<string | null>(null);
const selectedNode = computed<ProtocolNodeView | undefined>(() => {
  const nodes = activeTrack.value?.nodes ?? [];
  if (nodes.length === 0) return undefined;
  if (selectedNodeId.value) {
    const matched = nodes.find(n => n.id === selectedNodeId.value);
    if (matched) return matched;
  }
  return nodes[0];
});

function selectNode(nodeId: string): void {
  selectedNodeId.value = nodeId;
}

const stagedReceipt = ref<ProtocolStagedReceiptView | null>(null);

const selectedExperimentGuard = computed<ProtocolExperimentGuardResult>(() =>
  evaluateNodeExperimentGuard(activeState.value, selectedNode.value, mergedCatalogProtocols.value),
);
const canExperimentSelected = computed<boolean>(() => selectedExperimentGuard.value.enabled);
const experimentGuardReason = computed<string>(() => selectedExperimentGuard.value.reasonText ?? '');
const selectedAttemptSteps = computed<ProtocolAttemptStepView[]>(() => {
  const n = selectedNode.value;
  if (!n) return [];
  return buildAttemptLadderSteps(n.tier, n.attempts, n.status);
});

function findNodeById(protocolId: string): ProtocolNodeView | undefined {
  return findProtocolNodeById(
    sovietTracks.value,
    alliedTracks.value,
    protocolId,
    yuriTracks.value,
    commonTracks.value,
  );
}

function handleExperimentClick(targetNode?: ProtocolNodeView): ProtocolCommandStagedEvent | null {
  const res = executeProtocolExperimentClick({
    state: activeState.value,
    node: targetNode ?? selectedNode.value,
    catalogProtocols: mergedCatalogProtocols.value,
  });
  if (!res) return null;
  stagedReceipt.value = res.receipt;
  emit('command-staged', res.eventPayload);
  return res.eventPayload;
}

function canToggleAutoQueue(node: ProtocolNodeView): boolean {
  return canToggleProtocolAutoQueue(node.status);
}

function dispatchScheduleChange(
  action: ProtocolScheduleAction,
  targetNode: ProtocolNodeView,
  nextAutoQueued: boolean,
  nextOrder: number,
  nextHold: boolean,
): ProtocolScheduleDispatchEvent {
  const res = buildScheduleChangeDispatch({
    action,
    targetNode,
    nextAutoQueued,
    nextOrder,
    nextHold,
    queueSnapshot: autoQueueList.value,
  });
  stagedReceipt.value = res.receipt;
  emit('schedule-dispatch', res.payload);
  return res.payload;
}

function toggleAutoQueue(targetNodeOrId?: ProtocolNodeView | string): ProtocolScheduleDispatchEvent | null {
  const target =
    typeof targetNodeOrId === 'string'
      ? findNodeById(targetNodeOrId)
      : (targetNodeOrId ?? selectedNode.value);
  if (!target) return null;
  const res = computeToggleAutoQueueNext({
    target,
    currentList: autoQueueList.value,
    currentOverrides: localQueueOverrides.value,
  });
  if (!res) return null;
  localQueueOverrides.value = res.nextOverrides;
  return dispatchScheduleChange(res.action, target, res.nextAutoQueued, res.nextOrder, false);
}

function moveAutoQueueItem(protocolId: string, direction: 'up' | 'down' | 'top'): ProtocolScheduleDispatchEvent | null {
  const res = computeMoveAutoQueueNext({
    protocolId,
    direction,
    currentList: autoQueueList.value,
    currentOverrides: localQueueOverrides.value,
  });
  if (!res) return null;
  localQueueOverrides.value = res.nextOverrides;
  const targetNode = findNodeById(protocolId);
  if (targetNode) {
    return dispatchScheduleChange(res.action, targetNode, true, res.nextOrder, res.nextHold);
  }
  return null;
}

function toggleAutoQueueHold(protocolId: string): ProtocolScheduleDispatchEvent | null {
  const target = findNodeById(protocolId);
  const res = computeToggleAutoQueueHoldNext({
    protocolId,
    target,
    currentList: autoQueueList.value,
    currentOverrides: localQueueOverrides.value,
  });
  if (!res || !target) return null;
  localQueueOverrides.value = res.nextOverrides;
  return dispatchScheduleChange(res.action, target, true, res.nextOrder, res.nextHold);
}
</script>

<style scoped>
/* ── Oblivion 五层金属底座桥接 + 三院所局部色温导轨 ── */
.prt-panel-root {
  --prt-bg: var(--rac-bg);
  --prt-panel: var(--rac-panel);
  --prt-panel-2: var(--rac-panel-2);
  --prt-primary: hsl(0 78% 56%);
  --prt-accent: hsl(38 72% 62%);
  --prt-border: color-mix(in srgb, var(--prt-primary) 28%, var(--rac-dim));
  --prt-border-strong: color-mix(in srgb, var(--prt-primary) 68%, var(--rac-line));
  --prt-text-hi: var(--rac-hi);
  --prt-text-mid: var(--rac-text);
  --prt-text-muted: var(--rac-muted);
  --prt-progress-bar: linear-gradient(
    90deg,
    color-mix(in srgb, var(--prt-primary) 86%, black) 0%,
    var(--prt-primary) 58%,
    var(--prt-accent) 100%
  );
  --prt-progress-glow: color-mix(in srgb, var(--prt-accent) 38%, transparent);
  background: var(--prt-bg);
  color: var(--prt-text-hi);
}

.prt-panel-root[data-institute-theme='soviet'] {
  --prt-primary: hsl(0 78% 56%);
  --prt-accent: hsl(38 72% 62%);
}

.prt-panel-root[data-institute-theme='allied'] {
  --prt-primary: hsl(199 92% 60%);
  --prt-accent: hsl(199 80% 72%);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--prt-primary) 4%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--prt-primary) 4%, transparent) 1px, transparent 1px),
    var(--prt-bg);
  background-size: 20px 20px, 20px 20px, 100% 100%;
}

.prt-panel-root[data-institute-theme='yuri'] {
  --prt-primary: hsl(270 92% 72%);
  --prt-accent: hsl(282 85% 76%);
}

.prt-panel-root[data-institute-theme='common'] {
  --prt-primary: hsl(162 72% 48%);
  --prt-accent: hsl(43 88% 64%);
}

.prt-institute-bar,
.prt-global-grid,
.prt-track-sidebar,
.prt-main-stage,
.prt-detail-slot {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--prt-primary) 7%, var(--prt-panel-2)) 0%,
    var(--prt-panel) 100%
  );
  border-color: var(--prt-border);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--prt-primary) 22%, transparent),
    0 4px 12px rgba(0, 0, 0, 0.32);
}

.prt-institute-tab {
  --tab-inst-color: var(--prt-primary);
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid var(--rac-dim);
  border-top: 2px solid color-mix(in srgb, var(--tab-inst-color) 65%, var(--rac-dim));
  color: var(--prt-text-mid);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--tab-inst-color) 18%, transparent);
  cursor: pointer;
}
.prt-institute-tab[data-institute-tab='soviet'] {
  --tab-inst-color: hsl(0 78% 56%);
}
.prt-institute-tab[data-institute-tab='allied'] {
  --tab-inst-color: hsl(199 92% 60%);
}
.prt-institute-tab[data-institute-tab='yuri'] {
  --tab-inst-color: hsl(270 92% 72%);
}
.prt-institute-tab:hover {
  border-color: color-mix(in srgb, var(--tab-inst-color) 55%, var(--rac-line));
  border-top-color: var(--tab-inst-color);
  color: var(--prt-text-hi);
}
.prt-institute-tab--active {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--tab-inst-color) 18%, var(--prt-panel-2)) 0%,
    var(--prt-panel-2) 100%
  );
  border-color: var(--prt-border-strong);
  border-top: 2px solid var(--tab-inst-color);
  color: var(--prt-text-hi);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--prt-primary) 22%, transparent),
    0 2px 8px rgba(0, 0, 0, 0.35);
}

.prt-tier-pill {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid color-mix(in srgb, var(--prt-accent) 62%, var(--rac-dim));
  color: var(--prt-accent);
}
.prt-institute-title {
  color: var(--prt-text-hi);
}
.prt-institute-sub,
.prt-section-header,
.prt-stage-track-meta,
.prt-stage-hint {
  color: var(--prt-text-muted);
}
.prt-grid-heading {
  color: var(--prt-accent);
}
.prt-points-stock {
  color: var(--prt-text-mid);
}
.prt-points-stock strong {
  color: var(--prt-text-hi);
}
.prt-points-rate {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--prt-border-strong);
  color: var(--prt-accent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--prt-primary) 22%, transparent);
}

.prt-grid-badge {
  background: rgba(0, 0, 0, 0.26);
  border-color: var(--rac-dim);
  color: var(--rac-muted);
}
.prt-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: var(--rac-muted);
  opacity: 0.55;
}
.prt-grid-badge--on {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--rac-ok) 14%, var(--prt-panel-2)) 0%,
    var(--prt-panel-2) 100%
  );
  border-color: color-mix(in srgb, var(--rac-ok) 58%, var(--rac-line));
  color: var(--prt-text-hi);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--rac-ok) 22%, transparent);
}
.prt-grid-badge--on .prt-badge-dot {
  background: var(--rac-ok);
  opacity: 1;
  box-shadow: 0 0 6px color-mix(in srgb, var(--rac-ok) 65%, transparent);
}
.prt-grid-badge--on .prt-badge-state {
  color: var(--rac-ok);
  font-weight: 700;
}

.prt-track-item {
  background: rgba(0, 0, 0, 0.24);
  border-color: var(--rac-dim);
  color: var(--prt-text-mid);
  cursor: pointer;
}
.prt-track-item:hover {
  background: var(--prt-panel-2);
  border-color: var(--prt-border);
}
.prt-track-item--active {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--prt-primary) 18%, var(--prt-panel-2)) 0%,
    var(--prt-panel-2) 100%
  );
  border-color: var(--prt-border-strong);
  border-left: 3px solid var(--prt-primary);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--prt-primary) 22%, transparent);
  color: var(--prt-text-hi);
}
.prt-track-count {
  color: var(--prt-accent);
}
.prt-progress-track {
  background:
    repeating-linear-gradient(
      90deg,
      transparent 0,
      transparent 14px,
      rgba(0, 0, 0, 0.45) 14px,
      rgba(0, 0, 0, 0.45) 16px
    ),
    color-mix(in srgb, var(--rac-line) 42%, rgba(0, 0, 0, 0.55));
}
.prt-progress-fill {
  background: var(--prt-progress-bar);
  box-shadow: 0 0 6px var(--prt-progress-glow);
}

.prt-node-card {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--prt-panel-2) 92%, black) 0%,
    rgba(0, 0, 0, 0.26) 100%
  );
  border-color: var(--rac-dim);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--prt-primary) 16%, transparent);
  cursor: pointer;
}
.prt-node-card:hover,
.prt-node-card--selected {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--prt-primary) 14%, var(--prt-panel-2)) 0%,
    var(--prt-panel-2) 100%
  );
  border-color: var(--prt-border-strong);
  box-shadow:
    inset 3px 0 0 var(--prt-primary),
    inset 0 1px 0 color-mix(in srgb, var(--prt-primary) 22%, transparent);
}
.prt-node-card--active {
  border-color: color-mix(in srgb, var(--prt-accent) 68%, var(--rac-line));
  border-left: 3px solid var(--prt-accent);
}
.prt-node-seq,
.prt-node-exp-label,
.prt-detail-meta {
  color: var(--prt-text-muted);
}
.prt-node-tier {
  border-color: var(--prt-border);
  color: var(--prt-accent);
}
.prt-node-status {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--rac-dim);
  color: var(--prt-text-mid);
}
.prt-node-exp-val {
  color: var(--prt-accent);
}
.prt-detail-desc {
  color: var(--prt-text-mid);
}
.prt-reveal-link {
  background: rgba(0, 0, 0, 0.28);
  border-color: var(--prt-border);
  color: var(--prt-accent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--prt-primary) 22%, transparent);
  cursor: pointer;
}
.prt-reveal-link:hover {
  border-color: var(--prt-border-strong);
  color: var(--prt-text-hi);
}
.prt-panel-root *,
.prt-panel-root {
  box-sizing: border-box;
}
.prt-tri-layout > *,
.prt-node-card {
  min-width: 0;
}
.prt-node-card,
.prt-detail-slot {
  overflow-wrap: anywhere;
}
.prt-node-name {
  white-space: normal;
}

/* 精密双线电路导轨连接器 */
.prt-connector {
  width: 8px;
  height: 14px;
  margin-inline: auto;
  border-inline: 1px solid var(--prt-border);
  background: linear-gradient(
    180deg,
    transparent 0%,
    color-mix(in srgb, var(--prt-primary) 22%, transparent) 50%,
    transparent 100%
  );
}
.prt-connector.is-energized {
  border-inline-color: var(--prt-accent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--prt-primary) 45%, transparent) 0%,
    var(--prt-accent) 50%,
    color-mix(in srgb, var(--prt-primary) 45%, transparent) 100%
  );
  box-shadow: 0 0 8px var(--prt-progress-glow);
}

.prt-node-card[data-protocol-status='undiscovered'] {
  background: repeating-linear-gradient(
    135deg,
    transparent,
    transparent 6px,
    color-mix(in srgb, var(--rac-line) 24%, transparent) 6px,
    color-mix(in srgb, var(--rac-line) 24%, transparent) 12px
  );
  border-style: dashed;
}
.prt-node-card[data-protocol-status='locked'] {
  border-style: dashed;
}
.prt-node-card[data-protocol-status='available'] {
  border-color: var(--prt-primary);
}
.prt-node-card[data-protocol-status='experimenting'] {
  border-color: var(--prt-accent);
  box-shadow:
    inset 3px 0 0 var(--prt-accent),
    inset 0 1px 0 color-mix(in srgb, var(--prt-primary) 22%, transparent);
}
.prt-prob-badge,
.prt-sealed {
  color: var(--prt-accent);
}
.prt-auto-badge {
  align-self: flex-start;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--prt-accent);
  color: var(--prt-accent);
}

/* 底部装甲操作按键 */
.prt-action-btn {
  background: linear-gradient(180deg, var(--prt-panel-2) 0%, rgba(0, 0, 0, 0.38) 100%);
  border-color: var(--prt-border);
  border-left: 3px solid var(--prt-primary);
  color: var(--prt-text-hi);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--prt-primary) 22%, transparent);
  cursor: pointer;
}
.prt-action-btn--primary {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--prt-primary) 24%, var(--prt-panel-2)) 0%,
    var(--prt-panel-2) 100%
  );
  border-color: var(--prt-border-strong);
  border-left: 3px solid var(--prt-accent);
}
.prt-action-btn--primary:hover:not(:disabled) {
  border-color: var(--prt-accent);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--prt-primary) 28%, transparent),
    0 0 10px var(--prt-progress-glow);
}
.prt-action-btn--secondary:hover:not(:disabled),
.prt-action-btn--queued {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--prt-accent) 16%, var(--prt-panel-2)) 0%,
    var(--prt-panel-2) 100%
  );
  border-color: var(--prt-accent);
  border-left: 3px solid var(--prt-accent);
  color: var(--prt-accent);
}
.prt-action-btn:disabled,
.prt-queue-btn:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
.prt-guard-reason {
  background: rgba(0, 0, 0, 0.28);
  border-color: var(--prt-border);
  color: var(--prt-accent);
}
.prt-staged-receipt {
  background: rgba(0, 0, 0, 0.36);
  border-color: var(--prt-accent);
  border-left: 3px solid var(--prt-accent);
  color: var(--prt-text-hi);
}
.prt-queue-item {
  background: rgba(0, 0, 0, 0.25);
  border-color: var(--prt-border);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--prt-primary) 16%, transparent);
}
.prt-queue-btn {
  background: linear-gradient(180deg, var(--prt-panel-2) 0%, rgba(0, 0, 0, 0.38) 100%);
  border-color: var(--prt-border);
  color: var(--prt-text-mid);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--prt-primary) 18%, transparent);
  cursor: pointer;
}
.prt-queue-btn:hover:not(:disabled) {
  border-color: var(--prt-accent);
  color: var(--prt-text-hi);
}
.prt-mini-tier {
  background: rgba(0, 0, 0, 0.42);
  border: 1px solid var(--prt-border);
  color: var(--prt-accent);
}
.prt-no-lab-banner {
  background: rgba(0, 0, 0, 0.32);
  border-color: var(--prt-border);
  border-left: 3px solid var(--prt-accent);
  color: var(--prt-accent);
}
.prt-node-desc {
  color: var(--prt-text-mid);
}
.prt-cost-chip {
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid var(--rac-dim);
  color: var(--prt-text-mid);
}
.prt-reveal-chip {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--prt-border);
  color: var(--prt-accent);
}
.prt-detail-subcard {
  background: rgba(0, 0, 0, 0.24);
  border-color: var(--rac-dim);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--prt-primary) 16%, transparent);
}
.prt-step-cell {
  background: rgba(0, 0, 0, 0.28);
  border-color: var(--rac-dim);
  color: var(--prt-text-muted);
}
.prt-step-cell.is-passed {
  background: color-mix(in srgb, var(--prt-primary) 10%, rgba(0, 0, 0, 0.28));
  border-color: var(--prt-border);
  border-top: 2px solid var(--prt-primary);
  color: var(--prt-text-mid);
}
.prt-step-cell.is-current {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--prt-accent) 20%, var(--prt-panel-2)) 0%,
    var(--prt-panel-2) 100%
  );
  border-color: var(--prt-accent);
  border-top: 2px solid var(--prt-accent);
  color: var(--prt-accent);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--prt-primary) 22%, transparent),
    0 0 8px var(--prt-progress-glow);
}
@media (min-width: 768px) {
  .prt-col-scroll,
  .prt-track-sidebar {
    max-height: calc(88vh - 220px);
    overflow-y: auto;
  }
}
.prt-panel-root button:focus-visible {
  outline: 2px solid var(--prt-accent);
  outline-offset: 2px;
}
.prt-reveal-link,
.prt-institute-tab {
  min-height: 44px;
}
@media (prefers-reduced-motion: reduce) {
  .prt-panel-root *,
  .prt-panel-root *::before,
  .prt-panel-root *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
</style>
