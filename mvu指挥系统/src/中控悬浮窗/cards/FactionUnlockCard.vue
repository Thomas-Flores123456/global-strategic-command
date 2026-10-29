<template>
  <article
    class="tw-faction-unlock-card"
    data-test="faction-unlock-card"
    :data-faction="resolved.faction"
    :style="rootCssVars"
  >
    <!-- 顶部机密电传眉头状态轨 -->
    <div class="tw-faction-telemetry-strip">
      <span>CLASSIFIED // SUPREME COMMAND DECREE · FACTION:{{ resolved.faction.toUpperCase() }}</span>
      <span>CLEARANCE: OMEGA-1 // SEALED</span>
    </div>

    <!-- 顶部机密卷宗火漆与阵营抬头 -->
    <header class="tw-faction-unlock-header">
      <div class="tw-faction-unlock-badge-row">
        <span class="tw-faction-unlock-badge" data-test="faction-badge">
          {{ resolved.badge }}
        </span>
        <span class="tw-faction-unlock-emblem" data-test="faction-emblem">
          {{ resolved.emblem }}
        </span>
      </div>
      <h3 class="tw-faction-unlock-title" data-test="faction-title">
        {{ resolved.title }}
      </h3>
      <p class="tw-faction-unlock-subtitle" data-test="faction-subtitle">
        {{ resolved.subtitle }}
      </p>
    </header>

    <!-- 首发 MCV 机娘档案卡 -->
    <section class="tw-starter-girl-card" data-test="starter-girl-card">
      <div class="tw-starter-girl-meta">
        <span class="tw-starter-girl-tag">MCV CORE // 首发机动基地车机娘</span>
        <div class="tw-starter-girl-identity">
          <strong class="tw-starter-girl-name" data-test="starter-girl-name">
            {{ resolved.starterGirlName }}
          </strong>
          <span class="tw-starter-girl-model" data-test="starter-girl-model">
            {{ resolved.starterGirlModel }}
          </span>
        </div>
      </div>
      <blockquote class="tw-starter-girl-quote" data-test="starter-girl-quote">
        “{{ resolved.starterGirlQuote }}”
      </blockquote>
    </section>

    <!-- 可折叠展开的「阵营工业与并网详情」手风琴 -->
    <section class="tw-faction-details-section" data-test="faction-details-section">
      <button
        type="button"
        class="tw-faction-details-toggle"
        data-test="toggle-details"
        :aria-expanded="detailsOpen ? 'true' : 'false'"
        @click="toggleDetails"
      >
        <span class="tw-faction-details-toggle-title">阵营工业与并网详情</span>
        <span class="tw-faction-details-toggle-indicator" data-test="toggle-details-indicator">
          {{ detailsOpen ? '▼ 收起卷宗' : '▶ 展开卷宗' }} ({{ resolved.details.length }})
        </span>
      </button>

      <div
        v-if="detailsOpen"
        class="tw-faction-details-panel"
        data-test="details-panel"
      >
        <dl class="tw-faction-details-list">
          <div
            v-for="(item, idx) in resolved.details"
            :key="`${item.label}-${idx}`"
            class="tw-faction-details-item"
            data-test="detail-item"
          >
            <dt class="tw-faction-details-label">{{ item.label }}</dt>
            <dd class="tw-faction-details-value">{{ item.value }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- 「初始战区授权回执」绿灯列表 -->
    <footer class="tw-initial-grants-section" data-test="initial-grants">
      <div class="tw-initial-grants-header">
        <span class="tw-grant-led" aria-hidden="true">●</span>
        <span class="tw-initial-grants-title">初始战区授权回执</span>
      </div>
      <ul class="tw-initial-grants-list">
        <li
          v-for="(grant, idx) in resolved.initialGrants"
          :key="`${grant}-${idx}`"
          class="tw-initial-grant-item"
          data-test="grant-item"
        >
          <span class="tw-grant-item-dot" aria-hidden="true">🟢</span>
          <span class="tw-grant-item-text">{{ grant }}</span>
        </li>
      </ul>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  parseFactionUnlockPayload,
  type FactionColorPalette,
  type FactionDetailEntry,
  type FactionKey,
  type ParsedFactionUnlock,
} from './floorCardParsers';

export type { FactionColorPalette, FactionDetailEntry, FactionKey, ParsedFactionUnlock };

const props = withDefaults(
  defineProps<{
    payload: ParsedFactionUnlock | string | Record<string, unknown>;
    defaultDetailsOpen?: boolean;
  }>(),
  {
    defaultDetailsOpen: false,
  },
);

const detailsOpen = ref<boolean>(Boolean(props.defaultDetailsOpen));

function toggleDetails(): void {
  detailsOpen.value = !detailsOpen.value;
}

const resolved = computed<ParsedFactionUnlock>(() => parseFactionUnlockPayload(props.payload));

const rootCssVars = computed<Record<string, string>>(() => ({
  '--card-primary': resolved.value.primaryColor,
  '--card-accent': resolved.value.accentColor,
  '--card-bg': resolved.value.bgColor,
}));

defineExpose({
  detailsOpen,
  toggleDetails,
  resolved,
  rootCssVars,
});
</script>

<style scoped>
.tw-faction-unlock-card {
  position: relative;
  background-color: var(--card-bg, #0b1324);
  background-image:
    repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.018) 0px,
      rgba(255, 255, 255, 0.018) 1px,
      transparent 1px,
      transparent 3px
    ),
    radial-gradient(circle at 92% 18%, rgba(255, 255, 255, 0.04) 0%, transparent 55%);
  border: 1px solid var(--card-primary, #2563eb);
  border-top: 2px solid var(--card-accent, #38bdf8);
  border-radius: 0;
  color: #e2e8f0;
  font-family: 'JetBrains Mono', 'Share Tech Mono', 'Noto Sans SC', sans-serif;
  padding: 0;
  box-shadow:
    0 10px 28px rgba(0, 0, 0, 0.65),
    inset 0 0 0 1px rgba(255, 255, 255, 0.05);
  overflow: hidden;
}

.tw-faction-unlock-card::before {
  content: '';
  display: block;
  height: 4px;
  width: 100%;
  background: repeating-linear-gradient(
    -45deg,
    var(--card-primary, #2563eb),
    var(--card-primary, #2563eb) 8px,
    var(--card-accent, #38bdf8) 8px,
    var(--card-accent, #38bdf8) 12px,
    rgba(0, 0, 0, 0.65) 12px,
    rgba(0, 0, 0, 0.65) 18px
  );
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
}

.tw-faction-telemetry-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 14px;
  background: rgba(0, 0, 0, 0.48);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  color: #94a3b8;
  text-transform: uppercase;
}

.tw-faction-unlock-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  padding: 14px 16px 12px;
}

.tw-faction-unlock-badge-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.tw-faction-unlock-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.12em;
  background: var(--card-primary, #2563eb);
  color: #ffffff;
  border: 1px solid var(--card-accent, #38bdf8);
  border-radius: 0;
}

.tw-faction-unlock-emblem {
  display: inline-block;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 900;
  color: var(--card-accent, #38bdf8);
  letter-spacing: 0.14em;
  border: 2px solid var(--card-accent, #38bdf8);
  background: rgba(0, 0, 0, 0.42);
  transform: rotate(-2.5deg);
}

.tw-faction-unlock-title {
  margin: 0 0 5px;
  font-size: 18px;
  font-weight: 900;
  color: #f8fafc;
}

.tw-faction-unlock-subtitle {
  margin: 0;
  font-size: 11.5px;
  color: var(--card-accent, #38bdf8);
}

.tw-starter-girl-card {
  margin: 12px 16px;
  background: rgba(0, 0, 0, 0.42);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-left: 3px solid var(--card-accent, #38bdf8);
  border-radius: 0;
  padding: 0;
}

.tw-starter-girl-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.tw-starter-girl-tag {
  font-size: 10px;
  font-weight: 700;
  color: var(--card-accent, #38bdf8);
  letter-spacing: 0.12em;
}

.tw-starter-girl-identity {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tw-starter-girl-name {
  font-size: 13.5px;
  font-weight: 800;
  color: #ffffff;
  background: var(--card-primary, #2563eb);
  padding: 1px 8px;
}

.tw-starter-girl-model {
  font-size: 11px;
  color: #cbd5e1;
}

.tw-starter-girl-quote {
  margin: 0;
  padding: 9px 12px;
  font-size: 12px;
  color: #e2e8f0;
  background: rgba(0, 0, 0, 0.28);
}

.tw-faction-details-section {
  margin: 0 16px 12px;
}

.tw-faction-details-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--card-accent, #38bdf8);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-left: 3px solid var(--card-primary, #2563eb);
  border-radius: 0;
  cursor: pointer;
}

.tw-faction-details-panel {
  margin-top: -1px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 0;
}

.tw-faction-details-list {
  margin: 0;
  display: grid;
  gap: 1px;
  background: rgba(255, 255, 255, 0.12);
}

.tw-faction-details-item {
  display: grid;
  grid-template-columns: minmax(120px, 165px) 1fr;
  font-size: 11.5px;
  background: rgba(8, 12, 20, 0.92);
}

.tw-faction-details-label {
  padding: 6px 10px;
  color: var(--card-accent, #38bdf8);
  font-weight: 700;
  border-right: 1px solid rgba(255, 255, 255, 0.12);
}

.tw-faction-details-value {
  margin: 0;
  padding: 6px 12px;
  color: #f1f5f9;
}

.tw-initial-grants-section {
  padding: 10px 16px 14px;
  background: rgba(0, 0, 0, 0.34);
  border-top: 1px solid rgba(255, 255, 255, 0.14);
}

.tw-initial-grants-header {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10.5px;
  font-weight: 800;
  color: #4ade80;
  margin-bottom: 8px;
}

.tw-grant-led {
  display: inline-block;
  width: 7px;
  height: 7px;
  background: #22c55e;
  box-shadow: 0 0 8px #22c55e;
  color: transparent;
  font-size: 0;
}

.tw-initial-grants-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 6px;
}

.tw-initial-grant-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 11.5px;
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(74, 222, 128, 0.28);
  border-left: 3px solid #22c55e;
  border-radius: 0;
}

.tw-grant-item-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.85);
  font-size: 0;
  color: transparent;
}
</style>
