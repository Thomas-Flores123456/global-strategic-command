<template>
  <section ref="cardRootRef" class="tw-maiden-status-card" data-test="maiden-status-card">
    <article
      v-for="(item, idx) in resolvedItems"
      :key="`${item.serial || item.name}-${idx}`"
      class="tw-maiden-status-item"
      :class="item.unchristened ? 'is-unchristened' : 'is-christened'"
      data-test="maiden-status-item"
      :data-unchristened="item.unchristened ? 'true' : 'false'"
    >
      <template v-if="item.unchristened">
        <div
          class="tw-maiden-unchristened-banner"
          data-test="maiden-unchristened-banner"
        >
          ✨ NANITE EMERGENCE // 新生机娘唤醒 · 等待指挥官命名
        </div>

        <div class="tw-maiden-unchristened-meta">
          <strong data-test="maiden-serial">
            出厂编号：{{ item.serial || 'UNASSIGNED' }}
          </strong>
          <span data-test="maiden-model-seq">
            ｜ 机体型号：{{ item.model || '未知型号' }} · {{ item.seq || '初诞个体' }}
          </span>
        </div>

        <div class="tw-maiden-unchristened-field" data-test="maiden-body">
          【机体与外貌特征】：{{ item.body || item.appearance || '刚脱离纳米温床的初生构造体' }}
        </div>

        <div class="tw-maiden-unchristened-field" data-test="maiden-personality">
          【初生性格与姿态】：{{ item.personality || item.status || '懵懂待命，目光追随指挥官' }}
        </div>

        <footer
          class="tw-maiden-unchristened-hint"
          data-test="maiden-unchristened-hint"
        >
          🎖️ 请在下一轮对话中为她赐予【专属名字】，完成正式入列登记
        </footer>
      </template>

      <template v-else>
        <header class="tw-maiden-status-header">
          <strong class="tw-maiden-status-name" data-test="maiden-name">
            {{ item.callsign || item.name }}
          </strong>
          <span class="tw-maiden-status-meta" data-test="maiden-meta">
            {{ formatMeta(item) }}
          </span>
          <span class="tw-maiden-status-hp" data-test="maiden-hp">
            HP: {{ item.hp }}
          </span>
        </header>

        <div class="tw-maiden-status-metrics">
          <div class="tw-maiden-metric-box" data-test="maiden-affection">
            <span>好感度 {{ item.affection }}/100</span>
            <span
              v-if="item.affectionDelta"
              class="tw-maiden-metric-delta"
              data-test="affection-delta"
            >
              {{ formatDelta(item.affectionDelta) }}
            </span>
          </div>

          <div class="tw-maiden-metric-box" data-test="maiden-obedience">
            <span>服从度 {{ item.obedience }}/100</span>
            <span
              v-if="item.obedienceDelta"
              class="tw-maiden-metric-delta"
              data-test="obedience-delta"
            >
              {{ formatDelta(item.obedienceDelta) }}
            </span>
          </div>
        </div>

        <div class="tw-maiden-status-updates" data-test="maiden-updates">
          <div v-if="item.body" data-test="maiden-body">
            身子特征：{{ item.body }}
          </div>
          <div v-if="item.personality" data-test="maiden-personality">
            性格表现：{{ item.personality }}
          </div>
          <div v-if="item.status || item.duty" data-test="maiden-current-status">
            当前状态：{{ [item.duty, item.status].filter(Boolean).join(' · ') }}
          </div>
          <div v-if="item.shell || item.alias" data-test="maiden-shell">
            社会外壳：{{ [item.alias, item.shell].filter(Boolean).join(' · ') }}
          </div>
        </div>

        <div
          v-if="item.traits && item.traits.length > 0"
          class="tw-maiden-status-traits"
          data-test="maiden-traits"
        >
          <span
            v-for="(trait, tIdx) in item.traits"
            :key="`${trait}-${tIdx}`"
            class="tw-maiden-trait-chip"
            data-test="maiden-trait-chip"
          >
            #{{ trait.replace(/^#/, '') }}
          </span>
        </div>
      </template>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTacticalModalMotion } from '../../红警指挥系统/ui/motion/useGsapMotion';
import {
  parseMaidenStatusPayload,
  type ParsedMaidenStatusCard,
  type ParsedMaidenStatusItem,
} from './floorCardHydrator';

const cardRootRef = ref<HTMLElement | null>(null);
useTacticalModalMotion(cardRootRef, undefined, { duration: 0.2 });

const props = defineProps<{
  payload?: string | Record<string, unknown> | unknown[] | ParsedMaidenStatusCard | null;
  card?: ParsedMaidenStatusCard;
  items?: ParsedMaidenStatusItem[];
  name?: string;
  callsign?: string;
  serial?: string;
  model?: string;
  seq?: string;
  faction?: string;
  hp?: string;
  base?: string;
  duty?: string;
  body?: string;
  personality?: string;
  appearance?: string;
  shell?: string;
  alias?: string;
  status?: string;
  affection?: number;
  affectionDelta?: number;
  obedience?: number;
  obedienceDelta?: number;
  traits?: string[];
  unchristened?: boolean;
}>();

const resolvedItems = computed<ParsedMaidenStatusItem[]>(() => {
  if (props.card?.items && props.card.items.length > 0) {
    return props.card.items;
  }
  if (props.items && props.items.length > 0) {
    return props.items;
  }
  if (props.payload) {
    if (
      typeof props.payload === 'object' &&
      !Array.isArray(props.payload) &&
      'items' in props.payload &&
      Array.isArray((props.payload as ParsedMaidenStatusCard).items)
    ) {
      return (props.payload as ParsedMaidenStatusCard).items;
    }
    const parsed = parseMaidenStatusPayload(props.payload as string | Record<string, unknown>);
    if (parsed && parsed.items.length > 0) {
      return parsed.items;
    }
  }

  const effectiveName = props.name || props.callsign || '';
  const isUnchristened =
    props.unchristened ??
    (!effectiveName ||
      effectiveName.includes('待授名') ||
      effectiveName.includes('未授名') ||
      Boolean(props.duty?.includes('待授名')) ||
      Boolean(props.status?.includes('待授名')));

  return [
    {
      name: effectiveName || '待授名',
      callsign: props.callsign || effectiveName,
      serial: props.serial || '',
      model: props.model || '',
      seq: props.seq || (isUnchristened ? '初诞待授名' : ''),
      faction: props.faction || '',
      hp: props.hp || '满编正常',
      base: props.base || '',
      duty: props.duty || '',
      body: props.body || '',
      personality: props.personality || '',
      appearance: props.appearance || '',
      shell: props.shell || '',
      alias: props.alias || '',
      status: props.status || '',
      affection: props.affection ?? 50,
      ...(props.affectionDelta !== undefined ? { affectionDelta: props.affectionDelta } : {}),
      obedience: props.obedience ?? 50,
      ...(props.obedienceDelta !== undefined ? { obedienceDelta: props.obedienceDelta } : {}),
      traits: props.traits ?? [],
      unchristened: isUnchristened,
    },
  ];
});

function formatMeta(item: ParsedMaidenStatusItem): string {
  return [item.serial ? `#${item.serial}` : '', item.model, item.seq].filter(Boolean).join(' · ');
}

function formatDelta(delta?: number): string {
  if (delta === undefined || !Number.isFinite(delta) || delta === 0) return '';
  return delta > 0 ? `+${delta}` : `${delta}`;
}
</script>

<style scoped>
.tw-maiden-status-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-family: "Microsoft YaHei", sans-serif;
}
.tw-maiden-status-item {
  border-radius: 6px;
  padding: 12px 14px;
  background: rgba(15, 23, 42, 0.94);
  border: 1px solid rgba(148, 163, 184, 0.35);
  color: #e2e8f0;
}
.tw-maiden-status-item.is-unchristened {
  background: linear-gradient(145deg, rgba(42, 28, 8, 0.96), rgba(24, 16, 6, 0.96));
  border: 1px solid #f59e0b;
}
.tw-maiden-unchristened-banner {
  background: rgba(245, 158, 11, 0.18);
  border: 1px solid rgba(251, 191, 36, 0.55);
  color: #fbbf24;
  font-size: 12px;
  font-weight: 800;
  padding: 6px 10px;
  border-radius: 4px;
  margin-bottom: 10px;
}
.tw-maiden-metric-delta {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
  font-weight: 700;
  font-size: 11px;
}
.tw-maiden-trait-chip {
  display: inline-block;
  margin-right: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
  font-size: 11px;
}
</style>
