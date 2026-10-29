<template>
  <section ref="cardRootRef" class="tw-darknet-terminal-card" data-test="darknet-terminal-card">
    <div class="tw-darknet-telemetry-strip" data-test="darknet-telemetry-strip">
      <span>SUBSPACE DARKNET BROKER // QUANTUM RELAY TERMINAL</span>
      <span>NEXT AUCTION: {{ resolved.nextAuction }}</span>
    </div>

    <header class="tw-darknet-header" data-test="darknet-header">
      <h3 class="tw-darknet-title" data-test="darknet-title">
        🕶️ 超维暗网中继终端
      </h3>
      <div class="tw-darknet-badges">
        <span class="tw-darknet-market-badge" data-test="darknet-market-status">
          市场 · {{ resolved.marketStatus }}
        </span>
        <span
          class="tw-darknet-auction-badge"
          :class="{ 'is-bidding': resolved.isAuctionBidding }"
          data-test="darknet-auction-status"
        >
          {{ resolved.isAuctionBidding ? `🔥 拍卖竞价中 (${resolved.auctionStatus})` : `拍卖 · ${resolved.auctionStatus}` }}
        </span>
      </div>
    </header>

    <div class="tw-darknet-body">
      <div class="tw-darknet-section" data-test="darknet-settlements-section">
        <div class="tw-darknet-section-title">
          ⚡ 本轮交割回执 ({{ resolved.settlements.length }})
        </div>
        <div class="tw-darknet-settlement-list">
          <div v-if="resolved.settlements.length === 0" class="tw-darknet-note">
            本轮暂无暗网实物或情报交割记录。
          </div>
          <div
            v-for="(item, idx) in resolved.settlements"
            :key="`settlement-${idx}`"
            class="tw-darknet-settlement-item"
            data-test="darknet-settlement-item"
          >
            <div class="tw-darknet-settlement-top">
              <div class="tw-darknet-settlement-left">
                <span class="tw-darknet-action-tag" data-test="darknet-settlement-action">
                  {{ item.action }}
                </span>
                <span class="tw-darknet-target-name" data-test="darknet-settlement-target">
                  {{ item.target }}
                </span>
                <span
                  v-if="item.dedupeKey"
                  class="tw-darknet-dedupe-tag"
                  data-test="darknet-settlement-dedupe"
                >
                  交易单号: {{ item.dedupeKey }}
                </span>
              </div>
              <span
                class="tw-darknet-delta"
                :class="item.creditsDelta > 0 ? 'is-positive' : item.creditsDelta < 0 ? 'is-negative' : 'is-neutral'"
                data-test="darknet-settlement-delta"
              >
                {{ item.creditsDeltaText }}
              </span>
            </div>
            <p v-if="item.note" class="tw-darknet-note" data-test="darknet-settlement-note">
              {{ item.note }}
            </p>
          </div>
        </div>
      </div>

      <div class="tw-darknet-section" data-test="darknet-auctions-section">
        <div class="tw-darknet-section-title">
          🏛️ 超维拍卖厅实时叫价榜 ({{ resolved.auctions.length }})
        </div>
        <div class="tw-darknet-auction-list">
          <div v-if="resolved.auctions.length === 0" class="tw-darknet-note">
            当期拍卖厅休市中 · 距离下场专场开启: {{ resolved.nextAuction }}
          </div>
          <div
            v-for="auc in resolved.auctions"
            :key="auc.id"
            class="tw-darknet-auction-item"
            data-test="darknet-auction-item"
          >
            <div class="tw-darknet-auction-top">
              <span class="tw-darknet-auction-name" data-test="darknet-auction-name">
                {{ auc.name }}
              </span>
              <span class="tw-darknet-dedupe-tag" data-test="darknet-auction-lot-status">
                {{ auc.status }} · 卖方: {{ auc.seller }}
              </span>
            </div>
            <div class="tw-darknet-auction-meta">
              <span>起拍价: {{ auc.startPrice }} CREDITS</span>
              <span class="tw-darknet-auction-price" data-test="darknet-auction-price">
                当前最高价: {{ auc.currentPrice }} CREDITS
              </span>
              <span class="tw-darknet-auction-leader" data-test="darknet-auction-leader">
                领先方: {{ auc.leader }}
              </span>
              <span data-test="darknet-auction-round">
                轮次: {{ auc.round }}
              </span>
            </div>
            <p v-if="auc.desc" class="tw-darknet-note">
              {{ auc.desc }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <div
      class="tw-darknet-accordion"
      data-test="darknet-shelf-accordion"
      :data-expanded="expanded ? 'true' : 'false'"
    >
      <button
        type="button"
        class="tw-darknet-accordion-toggle"
        data-test="darknet-accordion-toggle"
        :aria-expanded="expanded ? 'true' : 'false'"
        @click="toggleAccordion"
      >
        {{ `${expanded ? '▴' : '▶'} 当期黑市货架与求购悬赏 (${shelfTotal})` }}
      </button>
      <div
        v-show="expanded"
        class="tw-darknet-accordion-body"
        data-test="darknet-accordion-body"
      >
        <div
          v-for="item in resolved.items"
          :key="item.id"
          class="tw-darknet-shelf-card"
          data-test="darknet-market-item"
        >
          <div class="tw-darknet-shelf-header">
            <span>[黑市] {{ item.name }}</span>
            <span class="tw-darknet-shelf-price">{{ item.price }} CREDITS (库存 {{ item.stock }})</span>
          </div>
          <p v-if="item.desc" class="tw-darknet-note">
            {{ item.category }} · {{ item.desc }}
          </p>
        </div>

        <div
          v-for="bounty in resolved.bounties"
          :key="bounty.id"
          class="tw-darknet-shelf-card"
          data-test="darknet-bounty-item"
        >
          <div class="tw-darknet-shelf-header">
            <span>[悬赏] {{ bounty.target }}</span>
            <span class="tw-darknet-shelf-price">+{{ bounty.rewardCredits }} CREDITS ({{ bounty.status }})</span>
          </div>
          <p v-if="bounty.desc" class="tw-darknet-note">
            {{ bounty.category }} · {{ bounty.desc }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import {
  playTacticalModalEnter,
  scheduleNextFrame,
  useTacticalModalMotion,
} from '../../红警指挥系统/ui/motion/useGsapMotion';
import type { ParsedDarknetTerminalCard } from './floorCardDarknet';

const props = defineProps<{
  card?: ParsedDarknetTerminalCard;
  onResize?: () => void;
}>();

const cardRootRef = ref<HTMLElement | null>(null);
useTacticalModalMotion(cardRootRef, undefined, { duration: 0.2 });

const expanded = ref(false);

const resolved = computed<ParsedDarknetTerminalCard>(() => ({
  marketStatus: props.card?.marketStatus ?? '正常连接',
  auctionStatus: props.card?.auctionStatus ?? '休市待启',
  nextAuction: props.card?.nextAuction ?? '7d',
  isAuctionBidding: props.card?.isAuctionBidding ?? false,
  settlements: props.card?.settlements ?? [],
  auctions: props.card?.auctions ?? [],
  items: props.card?.items ?? [],
  bounties: props.card?.bounties ?? [],
  compactSummary: props.card?.compactSummary ?? '交割 0 笔 · 拍品 0 件 · 货架/悬赏 0 项',
}));

const shelfTotal = computed(() => resolved.value.items.length + resolved.value.bounties.length);

function toggleAccordion(): void {
  expanded.value = !expanded.value;
  if (expanded.value) {
    scheduleNextFrame(() => playTacticalModalEnter(cardRootRef.value, null, { duration: 0.18 }));
  }
  void nextTick(() => {
    props.onResize?.();
  });
}
</script>

<style scoped>
.tw-darknet-terminal-card {
  position: relative;
  background-color: #050811;
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-left: 3px solid #f59e0b;
  color: #e2e8f0;
  font-family: 'JetBrains Mono', 'Share Tech Mono', 'Noto Sans SC', 'Microsoft YaHei', monospace;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.65);
  overflow: hidden;
}
.tw-darknet-telemetry-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: #f59e0b;
  background: rgba(10, 14, 26, 0.92);
  border-bottom: 1px solid rgba(245, 158, 11, 0.22);
}
.tw-darknet-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(15, 23, 42, 0.92);
  border-bottom: 1px solid rgba(56, 189, 248, 0.2);
}
.tw-darknet-title {
  margin: 0;
  font-size: 14px;
  font-weight: 900;
  color: #fef3c7;
}
.tw-darknet-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
}
.tw-darknet-market-badge {
  padding: 2px 8px;
  color: #38bdf8;
  background: rgba(14, 116, 144, 0.2);
  border: 1px solid rgba(56, 189, 248, 0.42);
}
.tw-darknet-auction-badge {
  padding: 2px 9px;
  color: #cbd5e1;
  background: rgba(30, 41, 59, 0.65);
  border: 1px solid rgba(148, 163, 184, 0.3);
}
.tw-darknet-auction-badge.is-bidding {
  color: #fef3c7;
  background: rgba(217, 119, 6, 0.28);
  border: 1px solid #f59e0b;
}
.tw-darknet-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 14px;
}
.tw-darknet-section-title {
  font-size: 11px;
  font-weight: 800;
  color: #f59e0b;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(245, 158, 11, 0.2);
}
.tw-darknet-settlement-item {
  padding: 8px 10px;
  background: rgba(10, 16, 29, 0.92);
  border: 1px solid rgba(56, 189, 248, 0.18);
  border-left: 2px solid #38bdf8;
}
.tw-darknet-action-tag {
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 800;
  color: #0f172a;
  background: #f59e0b;
}
.tw-darknet-delta.is-positive {
  color: #4ade80;
}
.tw-darknet-delta.is-negative {
  color: #fb7185;
}
.tw-darknet-delta.is-neutral {
  color: #38bdf8;
}
.tw-darknet-accordion-toggle {
  width: 100%;
  padding: 8px 14px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  color: #38bdf8;
  background: rgba(7, 11, 20, 0.96);
  border: none;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
  cursor: pointer;
  text-align: left;
}
</style>
