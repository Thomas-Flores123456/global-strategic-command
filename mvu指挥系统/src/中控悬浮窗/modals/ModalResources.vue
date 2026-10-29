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
        class="ra-modal-card flex max-h-[88vh] w-full max-w-[960px] flex-col overflow-hidden rounded-[4px] select-none"
        role="dialog"
        aria-modal="true"
        aria-label="战略资源"
      >
        <!-- ── 顶栏：战时战略资源与金库调度中枢 ── -->
        <header class="ra-modal-header flex items-center justify-between border-b px-3.5 py-2.5">
          <div class="flex items-center gap-2">
            <span class="ra-modal-icon"><Icon name="credits" :size="14" /></span>
            <span class="ra-modal-title text-[13px] font-bold tracking-wide">战略资源与战备金库 · STRATEGIC RESOURCES</span>
          </div>
          <button
            class="ra-modal-close rounded-[2px] p-1 transition-colors"
            aria-label="关闭弹窗"
            @click="$emit('close')"
          >
            <Icon name="close" :size="12" />
          </button>
        </header>

        <!-- ── 战备金库与流转 HUD 指标区 ── -->
        <div class="px-4 py-2 border-b" style="border-color: var(--rac-dim); background: rgba(0, 0, 0, 0.2)">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <!-- 资金现值与现金流 -->
            <div class="res-credits-row flex flex-wrap items-baseline gap-2.5">
              <span class="res-credits-label text-[12px] font-bold" style="color: var(--rac-hi)">
                {{ model.creditsBar.creditsLabel }}
              </span>
              <span class="res-credits-value font-mono text-[16px] font-bold" style="color: var(--rac-hi)">
                {{ model.creditsBar.creditsText }}
              </span>
              <span class="res-credits-daily font-mono text-[11px]" :class="DAILY_TONE_CLASS[model.creditsBar.dailyTone]">
                {{ model.creditsBar.creditsDailyLabel }} {{ model.creditsBar.creditsDailyText }}
              </span>

              <!-- 多元资金日流芯片组（channelDaily.total > 0 时紧凑呈列） -->
              <span
                v-if="model.darknet.channelDaily.total > 0"
                data-test="channel-daily-chips"
                class="res-channel-chips font-mono text-[10.5px] px-2 py-0.5 rounded-[2px] border"
              >
                精炼 {{ formatChannelSigned(model.darknet.channelDaily.refining) }} | 回收 {{ formatChannelSigned(model.darknet.channelDaily.recycling) }} | 油化 {{ formatChannelSigned(model.darknet.channelDaily.petrochemical) }} | 商路 {{ formatChannelSigned(model.darknet.channelDaily.chains) }}
              </span>
            </div>

            <!-- 全战区战略物资指标速览 -->
            <div class="flex items-center gap-3 text-[11px]">
              <span class="flex items-center gap-1.5" style="color: var(--rac-muted)">
                <span>实物流转:</span>
                <span class="num font-bold" style="color: var(--rac-ok)">{{ animatedFlowCount }}</span>
              </span>
              <span class="flex items-center gap-1.5" style="color: var(--rac-muted)">
                <span>库存告罄:</span>
                <span class="num font-bold" :class="{ 'text-red-400 res-pulse-alert': totalDepletedCount > 0 }" style="color: var(--rac-alert)">
                  {{ animatedDepletedCount }}
                </span>
              </span>
              <span class="flex items-center gap-1.5" style="color: var(--rac-muted)">
                <span>在册物料:</span>
                <span class="num font-mono" style="color: var(--rac-text)">{{ animatedItemsCount }}</span>
              </span>
            </div>
          </div>

          <!-- 流水摘要如实降级：无逐笔账本且无分渠道净入时展示 -->
          <div v-if="!model.ledger.available" class="res-ledger-note text-[10px] mt-1" style="color: var(--rac-muted)">
            {{ model.ledger.note }}
          </div>
        </div>

        <!-- ── 二级页签切换条（📦 战备物资库 / 🕶️ 跨维暗网终端） ── -->
        <div
          class="px-4 py-1.5 border-b flex flex-wrap items-center justify-between gap-2"
          style="border-color: var(--rac-dim); background: rgba(0, 0, 0, 0.28)"
        >
          <div class="flex items-center gap-2">
            <button
              type="button"
              data-test="tab-pillars"
              class="res-tab-btn"
              :class="{ 'res-tab-btn--active': activeTab === 'pillars' }"
              @click="switchTab('pillars')"
            >
              📦 战备物资库
            </button>
            <button
              type="button"
              data-test="tab-darknet"
              class="res-tab-btn flex items-center gap-1.5"
              :class="{ 'res-tab-btn--active': activeTab === 'darknet' }"
              @click="switchTab('darknet')"
            >
              <span>🕶️ 跨维暗网终端</span>
              <span
                v-if="model.darknet.auctionStatus === 'bidding'"
                data-test="darknet-bidding-badge"
                class="res-bidding-badge text-[9.5px] px-1.5 py-0.5 rounded-[2px] font-bold"
              >
                🔥 拍卖中
              </span>
            </button>
          </div>

          <!-- 暗网信道状态速览与探测刷新按钮 -->
          <div class="flex items-center gap-2 text-[10.5px]">
            <span
              class="font-mono px-1.5 py-0.5 rounded-[2px] border"
              :class="model.darknet.unlocked ? 'res-status-pill--ok' : 'res-status-pill--locked'"
            >
              信道: {{ model.darknet.marketStatusText }}
            </span>
            <button
              type="button"
              data-test="darknet-refresh-btn"
              class="res-action-btn text-[10px]"
              @click="handleRefreshMarket()"
            >
              📡 刷新暗网行情
            </button>
          </div>
        </div>

        <!-- ── 战备快筛条（柱域分类 + 状态快筛，仅在战略六柱页签呈现） ── -->
        <div
          v-if="activeTab === 'pillars'"
          class="px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2"
          style="border-color: var(--rac-dim); background: rgba(0, 0, 0, 0.12)"
        >
          <!-- 柱分类快筛药丸 -->
          <div class="flex items-center gap-1 flex-wrap">
            <button
              class="res-filter-btn"
              :class="{ 'res-filter-btn--active': activePillarKey === null }"
              @click="activePillarKey = null"
            >
              全部类别
            </button>
            <button
              v-for="p in model.pillars"
              :key="p.key"
              class="res-filter-btn flex items-center gap-1"
              :class="{ 'res-filter-btn--active': activePillarKey === p.key }"
              @click="activePillarKey = p.key"
            >
              <span>{{ p.name }}</span>
              <span
                v-if="p.depletedCount > 0"
                class="w-1.5 h-1.5 rounded-full bg-red-400 inline-block animate-pulse"
                title="该类别下有紧缺或耗尽物资"
              />
            </button>
          </div>

          <!-- 状态筛选 + 批量折叠操作 -->
          <div class="flex items-center gap-1.5 ml-auto">
            <button
              v-if="totalDepletedCount > 0"
              class="res-filter-btn text-[10px]"
              :class="{ 'res-filter-btn--armed': statusFilter === 'depleted' }"
              @click="statusFilter = statusFilter === 'depleted' ? 'all' : 'depleted'"
            >
              仅看告罄 ({{ totalDepletedCount }})
            </button>
            <button
              class="res-filter-btn text-[10px]"
              :class="{ 'res-filter-btn--active': statusFilter === 'flow' }"
              @click="statusFilter = statusFilter === 'flow' ? 'all' : 'flow'"
            >
              仅看流转 ({{ totalFlowCount }})
            </button>
            <button
              class="res-filter-btn text-[10px] opacity-75 hover:opacity-100"
              @click="toggleCollapseAll"
            >
              {{ areAllCollapsed ? '展开全部类别' : '收起全部类别' }}
            </button>
          </div>
        </div>

        <div class="ra-modal-body flex-1 overflow-y-auto px-4 py-3">
          <!-- ════════════════════════════════════════════════════════════════ -->
          <!-- TAB 1：📦 战备物资库 -->
          <!-- ════════════════════════════════════════════════════════════════ -->
          <template v-if="activeTab === 'pillars'">
            <!-- ══ 整体未探明降级态（economy.resources 缺席＝旧档/归零态零注入语义） ══ -->
            <div
              v-if="!model.surveyed"
              class="res-unsurveyed p-3 border border-dashed rounded-[3px]"
              style="border-color: var(--rac-dim); color: var(--rac-muted)"
            >
              {{ model.unsurveyedText }}
            </div>

            <!-- ══ 六柱网格看板（2列高密度卡片；支持折叠展开、三态配色与告罄高亮） ══ -->
            <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <section
                v-for="pillar in displayedPillars"
                :key="pillar.key"
                class="res-pillar res-pillar-card rounded-[3px] border p-2.5 flex flex-col justify-between"
                :class="{ 'res-pillar--locked': pillar.allLocked }"
                style="border-color: var(--rac-dim); background: var(--rac-panel)"
              >
                <!-- 柱头（可点击折叠/展开） -->
                <button
                  class="res-pillar-toggle w-full flex items-center justify-between pb-1.5 border-b text-left"
                  style="border-color: var(--rac-dim)"
                  :aria-expanded="!isCollapsed(pillar.key)"
                  @click="togglePillar(pillar.key)"
                >
                  <div class="flex items-center gap-1.5 min-w-0">
                    <Icon
                      :name="isCollapsed(pillar.key) ? 'chevron-right' : 'chevron-down'"
                      :size="12"
                      class="flex-none transition-transform"
                      style="color: var(--rac-muted)"
                    />
                    <span class="res-pillar-name text-[12px] font-bold tracking-wide truncate">{{ pillar.name }}</span>
                    <span class="res-pillar-key font-mono text-[9.5px] opacity-75">{{ pillar.key }}</span>
                  </div>
                  <div class="flex items-center gap-2 flex-none">
                    <span class="res-pillar-meta font-mono text-[10px]">
                      已解锁 {{ pillar.unlockedCount }}/{{ pillar.totalCount
                      }}<template v-if="pillar.depletedCount > 0"> · <span style="color: var(--rac-alert)">告罄 {{ pillar.depletedCount }}</span></template>
                    </span>
                  </div>
                </button>

                <!-- 柱体卡片内容（折叠受控） -->
                <div v-show="!isCollapsed(pillar.key)" class="mt-2 flex-1 flex flex-col justify-between">
                  <div class="res-pillar-desc text-[10px] pb-2" style="color: var(--rac-muted)">
                    {{ pillar.desc }}
                  </div>

                  <!-- 空项提示（如未配置任何预置项） -->
                  <div v-if="pillar.items.length === 0" class="res-item py-1">
                    <span class="res-item-name res-item--locked">—</span>
                  </div>

                  <!-- 物料小类列表（受状态过滤影响） -->
                  <div v-else class="flex flex-col gap-1">
                    <div
                      v-for="item in pillar.filteredItems"
                      :key="item.name"
                      class="res-item flex items-center justify-between gap-1.5 py-1 px-2 rounded-[2px]"
                      :class="{ 'res-item--alarm': item.tone === 'depleted' }"
                      style="background: rgba(0, 0, 0, 0.22)"
                    >
                      <div class="flex items-center gap-2 min-w-0 flex-1">
                        <span class="res-tone-dot" :class="DOT_TONE_CLASS[item.tone]" />
                        <span class="res-item-name text-[11px] truncate" :title="item.name">{{ item.name }}</span>
                      </div>
                      <div class="flex items-center gap-1.5 flex-none font-mono text-[11px]">
                        <span class="res-item-value" :class="ITEM_TONE_CLASS[item.tone]">{{ item.valueText }}</span>
                        <span v-if="item.tag" class="res-item-tag text-[9.5px] px-1 rounded-[2px]" :class="ITEM_TONE_CLASS[item.tone]">
                          {{ item.tag }}
                        </span>
                      </div>
                    </div>

                    <!-- 若该柱内部在当前筛选下无匹配项 -->
                    <div
                      v-if="pillar.filteredItems.length === 0 && pillar.items.length > 0"
                      class="text-[10px] py-1.5 text-center"
                      style="color: var(--rac-muted)"
                    >
                      当前筛选条件下没有匹配的物资
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </template>

          <!-- ════════════════════════════════════════════════════════════════
               TAB 2：🕶️ 跨维暗网终端
               ════════════════════════════════════════════════════════════════ -->
          <div v-else data-test="darknet-terminal-panel" class="flex flex-col gap-3">
            <!-- 1. 未建超维暗网中继站时的红警战术锁定引导框 -->
            <div
              v-if="!model.darknet.unlocked"
              data-test="darknet-locked-banner"
              class="res-darknet-locked rounded-[3px] border p-3 flex flex-wrap items-center justify-between gap-3"
            >
              <div class="flex flex-col gap-1">
                <div class="text-[12px] font-bold" style="color: var(--rac-alert)">
                  🔒 跨维暗网量子信道尚未接通 · 待建【超维暗网中继站】
                </div>
                <div class="text-[11px]" style="color: var(--rac-text)">
                  需建造 T1 通用建筑 <strong>【超维暗网中继站】</strong>（造价 1,200 资金 · 耗电 30 · 前置发电厂）以接通跨维度黑市撮合系统、传质变现舱与专场拍卖所。
                </div>
              </div>
              <button
                type="button"
                data-test="darknet-build-relay-btn"
                class="res-action-btn res-action-btn--warn text-[11px] font-bold flex-none"
                @click="handleBuildRelay()"
              >
                🛠️ 填入建造超维暗网中继站指令
              </button>
            </div>

            <!-- 2. 暗网四大主战功能区 + 流水账本 -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <!-- A. 快速实物与情报投递台 -->
              <section
                data-test="darknet-section-delivery"
                class="res-darknet-card rounded-[3px] border p-2.5 flex flex-col gap-2"
              >
                <div class="flex items-center justify-between border-b pb-1.5" style="border-color: var(--rac-dim)">
                  <span class="text-[12px] font-bold" style="color: var(--rac-hi)">📤 快速实物与情报投递台</span>
                  <span class="font-mono text-[10px]" style="color: var(--rac-muted)">
                    已售唯一情报 {{ model.darknet.soldIntelCount }} 份
                  </span>
                </div>

                <!-- A1. 已解锁(>0)实物物资一键投递变现 -->
                <div class="flex flex-col gap-1">
                  <div class="text-[10.5px] font-semibold" style="color: var(--rac-muted)">
                    可调拨现货库存（库存 &gt; 0，可直接变现）
                  </div>
                  <div v-if="unlockedFlowResources.length === 0" class="text-[10px] py-1" style="color: var(--rac-muted)">
                    当前没有库存大于 0 的现货可供投递变现
                  </div>
                  <div v-else class="flex flex-wrap gap-1.5 max-h-[96px] overflow-y-auto">
                    <div
                      v-for="res in unlockedFlowResources"
                      :key="`${res.pillarKey}:${res.name}`"
                      class="res-delivery-chip flex items-center gap-1.5 px-2 py-1 rounded-[2px] text-[10.5px]"
                    >
                      <span class="font-semibold">{{ res.name }}</span>
                      <span class="font-mono opacity-80">({{ res.valueText }})</span>
                      <button
                        type="button"
                        data-test="darknet-sell-resource-btn"
                        :data-target="res.name"
                        class="res-action-btn text-[9.5px] px-1.5 py-0.5"
                        @click="handleSellResource(res.name)"
                      >
                        投递变现
                      </button>
                    </div>
                  </div>
                </div>

                <!-- A2. 现有情报列表上传变现 -->
                <div class="flex flex-col gap-1">
                  <div class="text-[10.5px] font-semibold" style="color: var(--rac-muted)">
                    已掌握的战区情报（每份情报仅可出售一次）
                  </div>
                  <div v-if="availableIntelItems.length === 0" class="text-[10px] py-1" style="color: var(--rac-muted)">
                    当前暂无在册战区情报条目
                  </div>
                  <div v-else class="flex flex-col gap-1 max-h-[88px] overflow-y-auto">
                    <div
                      v-for="intel in availableIntelItems"
                      :key="intel.key"
                      class="flex items-center justify-between gap-2 px-2 py-1 rounded-[2px] text-[10.5px]"
                      style="background: rgba(0, 0, 0, 0.24)"
                    >
                      <span class="truncate" :title="intel.label">[{{ intel.src }}] {{ intel.summary }}</span>
                      <button
                        type="button"
                        data-test="darknet-sell-intel-btn"
                        :data-target="intel.label"
                        class="res-action-btn text-[9.5px] px-1.5 py-0.5 flex-none"
                        @click="handleSellIntel(intel.label)"
                      >
                        投递变现
                      </button>
                    </div>
                  </div>
                </div>

                <!-- A3. 自定义战利品名称委托送拍 / 投递出售 -->
                <div class="flex items-center gap-1.5 pt-1 border-t" style="border-color: var(--rac-dim)">
                  <input
                    v-model="customLootName"
                    data-test="darknet-custom-input"
                    type="text"
                    placeholder="输入自定义战利品/奇物名称…"
                    class="res-darknet-input flex-1 text-[11px] px-2 py-1 rounded-[2px]"
                  />
                  <button
                    type="button"
                    data-test="darknet-consign-btn"
                    class="res-action-btn text-[10px] flex-none"
                    @click="handleConsignCustom()"
                  >
                    委托送拍
                  </button>
                  <button
                    type="button"
                    data-test="darknet-custom-sell-btn"
                    class="res-action-btn text-[10px] flex-none"
                    @click="handleSellCustomResource()"
                  >
                    投递出售
                  </button>
                </div>
              </section>

              <!-- B. 当期黑市直购货架 -->
              <section
                data-test="darknet-section-market"
                class="res-darknet-card rounded-[3px] border p-2.5 flex flex-col gap-2"
              >
                <div class="flex items-center justify-between border-b pb-1.5" style="border-color: var(--rac-dim)">
                  <span class="text-[12px] font-bold" style="color: var(--rac-hi)">🛒 当期黑市直购货架</span>
                  <span class="font-mono text-[10px]" style="color: var(--rac-muted)">
                    在售 {{ model.darknet.items.length }} 项
                  </span>
                </div>

                <div v-if="model.darknet.items.length === 0" class="text-[10.5px] py-3 text-center" style="color: var(--rac-muted)">
                  当期黑市货架暂无挂牌商品，可点击顶栏「📡 刷新暗网行情」探测跨维货源。
                </div>
                <div v-else class="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
                  <div
                    v-for="item in model.darknet.items"
                    :key="item.id || item.name"
                    data-test="darknet-market-item"
                    class="p-2 rounded-[2px] border flex flex-col gap-1"
                    style="border-color: var(--rac-dim); background: rgba(0, 0, 0, 0.24)"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-1.5 min-w-0">
                        <span class="text-[11.5px] font-bold truncate" style="color: var(--rac-text)">{{ item.name }}</span>
                        <span class="text-[9.5px] px-1 rounded-[2px] border" style="border-color: var(--rac-dim); color: var(--rac-muted)">
                          {{ item.category }}
                        </span>
                      </div>
                      <div class="flex items-center gap-2 flex-none font-mono text-[10.5px]">
                        <span style="color: var(--rac-hi)">{{ item.price }} 资金</span>
                        <span style="color: var(--rac-muted)">库存 {{ item.stock }}</span>
                        <button
                          type="button"
                          data-test="darknet-buy-btn"
                          :data-target="item.name"
                          class="res-action-btn text-[10px]"
                          @click="handleBuyItem(item)"
                        >
                          填入采购令
                        </button>
                      </div>
                    </div>
                    <div v-if="item.desc" class="text-[10px]" style="color: var(--rac-muted)">
                      {{ item.desc }}
                    </div>
                  </div>
                </div>
              </section>

              <!-- C. 跨维高价求购悬赏 -->
              <section
                data-test="darknet-section-bounties"
                class="res-darknet-card rounded-[3px] border p-2.5 flex flex-col gap-2"
              >
                <div class="flex items-center justify-between border-b pb-1.5" style="border-color: var(--rac-dim)">
                  <span class="text-[12px] font-bold" style="color: var(--rac-hi)">🎯 跨维高价求购悬赏</span>
                  <span class="font-mono text-[10px]" style="color: var(--rac-muted)">
                    悬赏 {{ model.darknet.bounties.length }} 项
                  </span>
                </div>

                <div v-if="model.darknet.bounties.length === 0" class="text-[10.5px] py-3 text-center" style="color: var(--rac-muted)">
                  当前暂无跨维买家发布的求购悬赏单。
                </div>
                <div v-else class="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
                  <div
                    v-for="bounty in model.darknet.bounties"
                    :key="bounty.id || bounty.target"
                    data-test="darknet-bounty-item"
                    class="p-2 rounded-[2px] border flex flex-col gap-1"
                    style="border-color: var(--rac-dim); background: rgba(0, 0, 0, 0.24)"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-1.5 min-w-0">
                        <span class="text-[11.5px] font-bold truncate" style="color: var(--rac-text)">{{ bounty.target }}</span>
                        <span class="text-[9.5px] px-1 rounded-[2px] border" style="border-color: var(--rac-dim); color: var(--rac-muted)">
                          {{ BOUNTY_STATUS_TEXT[bounty.status] }}
                        </span>
                      </div>
                      <div class="flex items-center gap-2 flex-none font-mono text-[10.5px]">
                        <span style="color: var(--rac-ok)">+{{ bounty.reward_credits }} 资金</span>
                        <span v-if="bounty.deadline_text" style="color: var(--rac-muted)">{{ bounty.deadline_text }}</span>
                        <button
                          type="button"
                          data-test="darknet-bounty-btn"
                          :data-target="bounty.target"
                          class="res-action-btn text-[10px]"
                          @click="handleClaimBounty(bounty)"
                        >
                          交割领赏
                        </button>
                      </div>
                    </div>
                    <div v-if="bounty.desc" class="text-[10px]" style="color: var(--rac-muted)">
                      {{ bounty.desc }}
                    </div>
                  </div>
                </div>
              </section>

              <!-- D. 超维暗网拍卖厅 -->
              <section
                data-test="darknet-section-auctions"
                class="res-darknet-card rounded-[3px] border p-2.5 flex flex-col gap-2"
              >
                <div class="flex items-center justify-between border-b pb-1.5" style="border-color: var(--rac-dim)">
                  <span class="text-[12px] font-bold" style="color: var(--rac-hi)">🔨 超维暗网拍卖厅</span>
                  <span
                    data-test="darknet-auction-badge"
                    class="font-mono text-[10px] px-1.5 py-0.5 rounded-[2px]"
                    :class="model.darknet.auctionStatus === 'bidding' ? 'res-bidding-badge' : ''"
                    style="color: var(--rac-hi)"
                  >
                    {{ model.darknet.auctionBadgeText }}
                  </span>
                </div>

                <div v-if="model.darknet.auctions.length === 0" class="text-[10.5px] py-3 text-center" style="color: var(--rac-muted)">
                  当前休拍期暂无在拍标的（{{ model.darknet.auctionBadgeText }}）。
                </div>
                <div v-else class="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
                  <div
                    v-for="auction in model.darknet.auctions"
                    :key="auction.id || auction.name"
                    data-test="darknet-auction-item"
                    class="p-2 rounded-[2px] border flex flex-col gap-1"
                    style="border-color: var(--rac-dim); background: rgba(0, 0, 0, 0.24)"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-1.5 min-w-0">
                        <span class="text-[11.5px] font-bold truncate" style="color: var(--rac-text)">{{ auction.name }}</span>
                        <span class="text-[9.5px] px-1 rounded-[2px] border" style="border-color: var(--rac-dim); color: var(--rac-muted)">
                          {{ auction.round_text }}
                        </span>
                      </div>
                      <button
                        type="button"
                        data-test="darknet-bid-btn"
                        :data-target="auction.name"
                        class="res-action-btn text-[10px] flex-none"
                        @click="handleBidAuction(auction)"
                      >
                        跟牌加价
                      </button>
                    </div>
                    <div class="flex flex-wrap items-center gap-3 font-mono text-[10px]" style="color: var(--rac-muted)">
                      <span>卖方: {{ auction.seller }}</span>
                      <span>起拍价: {{ auction.start_price }}</span>
                      <span style="color: var(--rac-hi)">当前最高价: {{ auction.current_price }}</span>
                      <span>领先方: {{ auction.leader }}</span>
                    </div>
                    <div v-if="auction.desc" class="text-[10px]" style="color: var(--rac-muted)">
                      {{ auction.desc }}
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <!-- E. 最近交割流水账本 -->
            <section
              data-test="darknet-section-ledger"
              class="res-darknet-card rounded-[3px] border p-2.5 flex flex-col gap-2"
            >
              <div class="flex items-center justify-between border-b pb-1.5" style="border-color: var(--rac-dim)">
                <span class="text-[12px] font-bold" style="color: var(--rac-hi)">📜 最近交割流水账本</span>
                <span class="font-mono text-[10px]" style="color: var(--rac-muted)">
                  记录 {{ model.darknet.recentLedger.length }} 笔
                </span>
              </div>

              <div v-if="model.darknet.recentLedger.length === 0" class="text-[10.5px] py-2 text-center" style="color: var(--rac-muted)">
                暂无跨维暗网交割流水记录。
              </div>
              <div v-else class="flex flex-col gap-1 max-h-[150px] overflow-y-auto">
                <div
                  v-for="rec in model.darknet.recentLedger"
                  :key="rec.id || `${rec.at_day}-${rec.target}`"
                  data-test="darknet-ledger-row"
                  class="flex flex-wrap items-center justify-between gap-2 px-2 py-1 rounded-[2px] text-[10.5px]"
                  style="background: rgba(0, 0, 0, 0.24)"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-mono text-[9.5px] px-1 rounded-[2px] border" style="border-color: var(--rac-dim); color: var(--rac-muted)">
                      D{{ rec.at_day }} · {{ rec.action }}
                    </span>
                    <span class="font-semibold truncate" style="color: var(--rac-text)">{{ rec.target }}</span>
                    <span v-if="rec.note" class="text-[10px] truncate" style="color: var(--rac-muted)">— {{ rec.note }}</span>
                  </div>
                  <span
                    class="font-mono font-bold"
                    :class="rec.credits_delta >= 0 ? 'res-ledger-delta--pos' : 'res-ledger-delta--neg'"
                  >
                    {{ rec.credits_delta >= 0 ? `+${rec.credits_delta}` : String(rec.credits_delta) }}
                  </span>
                </div>
              </div>
            </section>

            <!-- 3. 面板底部：待发战术指令预览条 -->
            <div
              data-test="darknet-prompt-preview"
              class="res-prompt-preview rounded-[3px] border p-2.5 flex flex-col gap-1"
            >
              <div class="flex items-center justify-between gap-2 text-[10.5px]">
                <span class="font-bold" style="color: var(--rac-hi)">📡 待发战术指令预览条</span>
                <span v-if="lastOrderFeedback" data-test="darknet-prompt-feedback" class="font-mono text-[10px]" style="color: var(--rac-ok)">
                  {{ lastOrderFeedback }}
                </span>
              </div>
              <div class="font-mono text-[11px] break-all" style="color: var(--rac-text)">
                {{ lastOrderPrompt || '点击上方任意【填入采购令 / 交割领赏 / 跟牌加价 / 投递变现】按钮，自动生成超维暗网战术指令并填入酒馆输入框。' }}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import type { Schema } from '../../红警指挥系统/core/schema';
import { fillHostSendInput } from '../../红警指挥系统/worldbook/hostSendInput';
import type { HostSendChannel } from '../../红警指挥系统/worldbook/hostSendInput';
import {
  buildDarknetOrderPrompt,
  buildDarknetRefreshMarketPrompt,
  buildDarknetRelayBuildPrompt,
  resourcePanelModel,
} from '../models/resourcePanelModel';
import type {
  CreditsDailyTone,
  DarknetAuctionItemView,
  DarknetBountyItemView,
  DarknetMarketItemView,
  DarknetOrderPromptIntent,
  ResourceItemRow,
  ResourcePillarKey,
  ResourceTone,
} from '../models/resourcePanelModel';
import {
  playTacticalStagger,
  scheduleNextFrame,
  useGsapNumber,
  useTacticalModalMotion,
} from '../../红警指挥系统/ui/motion/useGsapMotion';

export type ResourceModalTab = 'pillars' | 'darknet';

const props = withDefaults(
  defineProps<{
    open: boolean;
    snapshot: Schema | null;
    initialTab?: ResourceModalTab;
  }>(),
  {
    initialTab: 'pillars',
  },
);

defineEmits<{
  (e: 'close'): void;
}>();

const backdropRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
useTacticalModalMotion(panelRef, backdropRef, {
  open: () => props.open,
  staggerSelector: '.res-pillar-card, .res-darknet-card',
});

/**
 * 只读消费 economy 切片与 bases 建筑列表（snapshot 直传，无中间层级）；
 * 保持 resourcePanelModel(props.snapshot?.economy ?? {}) 调用签名向后兼容。
 */
const model = computed(() => {
  if (!props.snapshot?.bases || props.snapshot.bases.length === 0) {
    return resourcePanelModel(props.snapshot?.economy ?? {});
  }
  return resourcePanelModel(props.snapshot?.economy ?? {}, {
    bases: props.snapshot.bases,
  });
});

/** 顶层二级页签：'pillars'（战略六柱库存，默认） | 'darknet'（跨维暗网终端） */
const activeTab = ref<ResourceModalTab>(props.initialTab ?? 'pillars');

watch(
  () => props.initialTab,
  nextTab => {
    if (nextTab) activeTab.value = nextTab;
  },
);

function switchTab(tab: ResourceModalTab) {
  activeTab.value = tab;
  scheduleNextFrame(() => {
    playTacticalStagger(panelRef.value, '.res-pillar-card, .res-darknet-card');
  });
}

/** 柱域分类筛选（null 表示全部） */
const activePillarKey = ref<ResourcePillarKey | null>(null);

/** 状态快筛：'all' | 'depleted' | 'flow' | 'locked' */
const statusFilter = ref<'all' | 'depleted' | 'flow' | 'locked'>('all');

/** 卡片折叠态管理（Set 追踪折叠的 key；默认全展开） */
const collapsedPillars = ref(new Set<string>());

function togglePillar(key: string) {
  const set = collapsedPillars.value;
  if (set.has(key)) set.delete(key);
  else set.add(key);
}

function isCollapsed(key: string) {
  return collapsedPillars.value.has(key);
}

const areAllCollapsed = computed(() =>
  model.value.pillars.length > 0 && model.value.pillars.every(p => collapsedPillars.value.has(p.key)),
);

function toggleCollapseAll() {
  if (areAllCollapsed.value) {
    collapsedPillars.value.clear();
  } else {
    collapsedPillars.value = new Set(model.value.pillars.map(p => p.key));
  }
}

/** 战备统计衍生指标 */
const allItems = computed(() => model.value.pillars.flatMap(p => p.items));
const totalItemsCount = computed(() => allItems.value.length);
const totalFlowCount = computed(() => allItems.value.filter(i => i.tone === 'flow').length);
const totalDepletedCount = computed(() => allItems.value.filter(i => i.tone === 'depleted').length);

const animatedFlowCount = useGsapNumber(() => totalFlowCount.value, { duration: 0.35 });
const animatedDepletedCount = useGsapNumber(() => totalDepletedCount.value, { duration: 0.35 });
const animatedItemsCount = useGsapNumber(() => totalItemsCount.value, { duration: 0.35 });

/** 柱卡片展示列表（受柱分类筛选影响，预计算 filteredItems 避免模板重复过滤） */
const displayedPillars = computed(() => {
  const pillars = !activePillarKey.value
    ? model.value.pillars
    : model.value.pillars.filter(p => p.key === activePillarKey.value);
  return pillars.map(p => ({
    ...p,
    filteredItems: filteredItems(p.items),
  }));
});

/** 物料项状态过滤 */
function filteredItems(items: ResourceItemRow[]): ResourceItemRow[] {
  if (statusFilter.value === 'all') return items;
  return items.filter(i => i.tone === statusFilter.value);
}

function formatChannelSigned(val: number): string {
  return val >= 0 ? `+${val}` : String(val);
}

/* ═══════════════ 暗网投递台与快捷填框交互 ═══════════════ */

export interface UnlockedFlowResourceEntry {
  pillarKey: ResourcePillarKey;
  pillarName: string;
  name: string;
  value: number;
  valueText: string;
}

/** 当前已解锁且库存 > 0 的六柱实物物资（供投递台点选变现） */
const unlockedFlowResources = computed<UnlockedFlowResourceEntry[]>(() => {
  const list: UnlockedFlowResourceEntry[] = [];
  for (const pillar of model.value.pillars) {
    for (const item of pillar.items) {
      if (item.tone === 'flow' && typeof item.value === 'number' && item.value > 0) {
        list.push({
          pillarKey: pillar.key,
          pillarName: pillar.name,
          name: item.name,
          value: item.value,
          valueText: item.valueText,
        });
      }
    }
  }
  return list;
});

/** 现有 snapshot.intel 情报列表映射（供投递台点选上传变现） */
const availableIntelItems = computed(() => {
  const rawIntel = props.snapshot?.intel ?? [];
  return rawIntel.map((entry, idx) => {
    const src = entry.src || '战区情报';
    const content = (entry.content || '').trim();
    const summary = content.length > 28 ? `${content.slice(0, 28)}…` : content || `情报条目#${idx + 1}`;
    const label = `${src}：${summary}`;
    return {
      key: `${idx}-${src}`,
      src,
      summary,
      label,
    };
  });
});

const customLootName = ref('');
const lastOrderPrompt = ref('');
const lastOrderChannel = ref<HostSendChannel | null>(null);
const lastOrderFeedback = ref('');

function dispatchRawPrompt(promptText: string): string {
  lastOrderPrompt.value = promptText;
  const ch = fillHostSendInput(promptText);
  lastOrderChannel.value = ch;
  lastOrderFeedback.value =
    ch === 'failed'
      ? '⚠️ 未检测到宿主输入框，请复制下方指令发送'
      : '✅ 已填入酒馆聊天框，请确认后发送执行';
  return promptText;
}

function dispatchDarknetPrompt(intent: DarknetOrderPromptIntent): string {
  const promptText = buildDarknetOrderPrompt(intent);
  return dispatchRawPrompt(promptText);
}

function handleBuildRelay(): string {
  const firstBaseName = props.snapshot?.bases?.[0]?.name || '当前主力基地';
  return dispatchRawPrompt(buildDarknetRelayBuildPrompt(firstBaseName));
}

function handleRefreshMarket(): string {
  return dispatchRawPrompt(buildDarknetRefreshMarketPrompt());
}

function handleBuyItem(item: Pick<DarknetMarketItemView, 'name' | 'price'>): string {
  return dispatchDarknetPrompt({
    kind: 'buy',
    targetName: item.name,
    priceOrQty: item.price,
  });
}

function handleClaimBounty(bounty: Pick<DarknetBountyItemView, 'target' | 'reward_credits'>): string {
  return dispatchDarknetPrompt({
    kind: 'bounty',
    targetName: bounty.target,
    priceOrQty: bounty.reward_credits,
  });
}

function handleBidAuction(
  auction: Pick<DarknetAuctionItemView, 'name' | 'current_price' | 'start_price'>,
  overrideBid?: number,
): string {
  const basePrice = Math.max(auction.current_price || 0, auction.start_price || 0);
  const step = Math.max(50, Math.round((basePrice || 500) * 0.1));
  const nextBid = overrideBid !== undefined ? overrideBid : basePrice + step;
  return dispatchDarknetPrompt({
    kind: 'bid',
    targetName: auction.name,
    priceOrQty: nextBid,
  });
}

function handleSellResource(resourceName: string): string {
  return dispatchDarknetPrompt({
    kind: 'sell_resource',
    targetName: resourceName,
  });
}

function handleSellIntel(intelTitle: string): string {
  return dispatchDarknetPrompt({
    kind: 'sell_intel',
    targetName: intelTitle,
  });
}

function handleConsignCustom(customName?: string): string {
  const resolved = (customName ?? customLootName.value).trim() || '未知高价值战利品';
  return dispatchDarknetPrompt({
    kind: 'consign',
    targetName: resolved,
  });
}

function handleSellCustomResource(customName?: string): string {
  const resolved = (customName ?? customLootName.value).trim() || '未知战利品物资';
  return dispatchDarknetPrompt({
    kind: 'sell_resource',
    targetName: resolved,
  });
}

const BOUNTY_STATUS_TEXT: Record<'open' | 'completed' | 'expired', string> = {
  open: '悬赏开放',
  completed: '已交割',
  expired: '已过期',
};

/** 三态/日均色调静态 class 映射（禁动态拼接，防 Tailwind purge；键域与 resourcePanelModel tone 联合类型一一对应） */
const DAILY_TONE_CLASS: Record<CreditsDailyTone, string> = {
  surplus: 'res-daily--surplus',
  deficit: 'res-daily--deficit',
  balance: 'res-daily--balance',
};
const DOT_TONE_CLASS: Record<ResourceTone, string> = {
  flow: 'res-tone--flow',
  depleted: 'res-tone--depleted',
  locked: 'res-tone--locked',
};
const ITEM_TONE_CLASS: Record<ResourceTone, string> = {
  flow: 'res-item--flow',
  depleted: 'res-item--depleted',
  locked: 'res-item--locked',
};

defineExpose({
  activeTab,
  switchTab,
  model,
  unlockedFlowResources,
  availableIntelItems,
  customLootName,
  lastOrderPrompt,
  lastOrderChannel,
  lastOrderFeedback,
  dispatchDarknetPrompt,
  handleBuildRelay,
  handleRefreshMarket,
  handleBuyItem,
  handleClaimBounty,
  handleBidAuction,
  handleSellResource,
  handleSellIntel,
  handleConsignCustom,
  handleSellCustomResource,
});
</script>

<style scoped>
.ra-modal-mask {
  z-index: 10010;
  background: rgba(4, 7, 12, 0.75);
  backdrop-filter: blur(4px);
}

.ra-modal-card {
  background: var(--rac-bg);
  border: 1px solid var(--rac-line);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.85),
    0 0 0 1px color-mix(in srgb, var(--rac-line) 20%, transparent);
}

.ra-modal-enter-active,
.ra-modal-leave-active {
  transition: opacity 0.2s cubic-bezier(.3, 0, .1, 1), transform 0.2s cubic-bezier(.3, 0, .1, 1);
}

.ra-modal-enter-from,
.ra-modal-leave-to {
  opacity: 0;
  transform: scale(0.97);
}

/* ══ 二级页签与多元日流芯片 ══ */
.res-tab-btn {
  font-size: 11.5px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 2px;
  border: 1px solid var(--rac-dim);
  background: rgba(15, 23, 42, 0.55);
  color: var(--rac-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.res-tab-btn:hover {
  color: var(--rac-text);
  border-color: var(--rac-line);
}

.res-tab-btn--active {
  background: rgba(56, 189, 248, 0.18);
  color: var(--rac-hi);
  border-color: var(--rac-line);
  box-shadow: inset 0 0 8px rgba(56, 189, 248, 0.18);
}

.res-channel-chips {
  border-color: rgba(56, 189, 248, 0.35);
  background: rgba(12, 34, 58, 0.45);
  color: var(--rac-text);
}

.res-bidding-badge {
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid var(--rac-alert);
  color: var(--rac-alert);
  animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

.res-status-pill--ok {
  border-color: rgba(34, 197, 94, 0.45);
  background: rgba(20, 83, 45, 0.25);
  color: var(--rac-ok);
}

.res-status-pill--locked {
  border-color: rgba(239, 68, 68, 0.45);
  background: rgba(127, 29, 29, 0.22);
  color: var(--rac-alert);
}

/* ══ 暗网终端卡片与操作按钮 ══ */
.res-darknet-locked {
  border-color: rgba(239, 68, 68, 0.5);
  background: linear-gradient(90deg, rgba(127, 29, 29, 0.28), rgba(15, 23, 42, 0.65));
}

.res-darknet-card {
  border-color: var(--rac-dim);
  background: var(--rac-panel);
}

.res-delivery-chip {
  border: 1px solid var(--rac-dim);
  background: rgba(0, 0, 0, 0.28);
  color: var(--rac-text);
}

.res-darknet-input {
  border: 1px solid var(--rac-dim);
  background: rgba(4, 7, 12, 0.65);
  color: var(--rac-text);
  outline: none;
}

.res-darknet-input:focus {
  border-color: var(--rac-line);
}

.res-action-btn {
  padding: 2px 8px;
  border-radius: 2px;
  border: 1px solid var(--rac-line);
  background: rgba(56, 189, 248, 0.14);
  color: var(--rac-hi);
  cursor: pointer;
  transition: all 0.15s ease;
}

.res-action-btn:hover {
  background: rgba(56, 189, 248, 0.28);
}

.res-action-btn--warn {
  border-color: var(--rac-alert);
  background: rgba(239, 68, 68, 0.18);
  color: var(--rac-hi);
}

.res-action-btn--warn:hover {
  background: rgba(239, 68, 68, 0.32);
}

.res-ledger-delta--pos {
  color: var(--rac-ok);
}

.res-ledger-delta--neg {
  color: var(--rac-alert);
}

.res-prompt-preview {
  border-color: var(--rac-line);
  background: rgba(8, 22, 38, 0.68);
}

/* ══ 顶栏与筛选按钮 ══ */
.res-filter-btn {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 2px;
  border: 1px solid var(--rac-dim);
  background: transparent;
  color: var(--rac-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.res-filter-btn:hover {
  color: var(--rac-text);
  border-color: var(--rac-line);
}

.res-filter-btn--active {
  background: rgba(56, 189, 248, 0.15);
  color: var(--rac-line);
  border-color: var(--rac-line);
}

.res-filter-btn--armed {
  background: rgba(239, 68, 68, 0.15);
  color: var(--rac-alert);
  border-color: var(--rac-alert);
}

/* ══ 资金与日均色调 ══ */
.res-daily--surplus {
  color: var(--rac-ok);
}

.res-daily--deficit {
  color: var(--rac-alert);
}

.res-daily--balance {
  color: var(--rac-muted);
}

/* ══ 六柱卡片 ══ */
.res-pillar-card {
  transition: border-color 0.15s ease;
}

.res-pillar-card:hover {
  border-color: rgba(56, 189, 248, 0.45);
}

.res-pillar--locked {
  opacity: 0.72;
}

.res-pillar-toggle {
  background: transparent;
  cursor: pointer;
}

.res-pillar-toggle:hover .res-pillar-name {
  color: var(--rac-hi);
}

.res-pillar-name {
  color: var(--rac-hi);
  letter-spacing: 0.04em;
}

.res-pillar-key {
  color: var(--rac-muted);
}

.res-pillar-meta {
  color: var(--rac-muted);
}

.res-item-name {
  flex: none;
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rac-text);
  font-weight: 600;
}

.res-tone-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 1px;
}

/* 三态色调（flow 实物绿｜depleted 告罄红｜locked 未解锁灰） */
.res-tone--flow {
  background: var(--rac-ok);
}

.res-tone--depleted {
  background: var(--rac-alert);
  box-shadow: 0 0 4px var(--rac-alert);
}

.res-tone--locked {
  background: var(--rac-muted);
}

.res-item--flow {
  color: var(--rac-ok);
}

.res-item--depleted {
  color: var(--rac-alert);
  font-weight: bold;
}

.res-item--locked {
  color: var(--rac-muted);
}

.res-item--alarm {
  border: 1px dashed rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.08) !important;
}

.res-pulse-alert {
  animation: pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
