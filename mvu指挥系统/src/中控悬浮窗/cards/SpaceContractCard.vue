<template>
  <section
    class="tw-space-contract-card"
    :class="{ 'has-weather-hold': isHold }"
    data-test="space-contract-card"
    :data-contract-id="resolved.id"
  >
    <header class="tw-space-contract-header">
      <div class="tw-space-contract-title-group">
        <span class="tw-space-contract-id" data-test="space-contract-id">
          {{ resolved.id }}
        </span>
        <h3 class="tw-space-contract-title" data-test="space-contract-title">
          {{ resolved.title }}
        </h3>
      </div>
      <div class="tw-space-contract-badges">
        <span class="tw-space-contract-kind" data-test="space-contract-kind">
          {{ resolved.kind }}
        </span>
        <span class="tw-space-contract-status" data-test="space-contract-status">
          {{ resolved.status }}
        </span>
      </div>
    </header>

    <div class="tw-space-contract-grid">
      <div class="tw-space-contract-field" data-test="space-contract-rocket">
        <span class="tw-space-contract-label">运载火箭</span>
        <strong class="tw-space-contract-value">{{ resolved.rocket }}</strong>
      </div>
      <div class="tw-space-contract-field" data-test="space-contract-payload">
        <span class="tw-space-contract-label">有效载荷</span>
        <strong class="tw-space-contract-value">{{ resolved.payload }}</strong>
      </div>
      <div class="tw-space-contract-field" data-test="space-contract-base">
        <span class="tw-space-contract-label">发射基地 / 发射中心</span>
        <strong class="tw-space-contract-value">
          {{ resolved.launchCenterId ? `${resolved.base} (${resolved.launchCenterId})` : resolved.base }}
        </strong>
      </div>
      <div class="tw-space-contract-field" data-test="space-contract-payload-source">
        <span class="tw-space-contract-label">载荷来源</span>
        <strong class="tw-space-contract-value">{{ payloadSourceLabel }}</strong>
      </div>
      <div
        v-if="resolved.targetSlot"
        class="tw-space-contract-field"
        data-test="space-contract-target-slot"
      >
        <span class="tw-space-contract-label">目标插槽</span>
        <strong class="tw-space-contract-value">{{ resolved.targetSlot }}</strong>
      </div>
      <div
        v-if="resolved.scope"
        class="tw-space-contract-field"
        data-test="space-contract-scope"
      >
        <span class="tw-space-contract-label">赋能范围</span>
        <strong class="tw-space-contract-value">{{ scopeDisplayLabel }}</strong>
      </div>
      <div class="tw-space-contract-field" data-test="space-contract-reward">
        <span class="tw-space-contract-label">报酬金额</span>
        <strong class="tw-space-contract-value">${{ resolved.rewardCredits }}</strong>
      </div>
      <div class="tw-space-contract-field" data-test="space-contract-booster">
        <span class="tw-space-contract-label">一级助推器</span>
        <strong class="tw-space-contract-value">
          {{ resolved.recoverBooster ? '可回收复用' : '一次性消耗' }}
        </strong>
      </div>
    </div>

    <footer class="tw-space-contract-footer" data-test="space-contract-weather">
      <span class="tw-space-contract-weather-label">气象窗口提示：</span>
      <span class="tw-space-contract-weather-text">
        {{ resolved.weatherHoldReason || '气象窗口良好 · 允许准时点火发射' }}
      </span>
    </footer>

    <div
      v-if="!isFinished"
      class="tw-space-contract-actions"
      data-test="space-contract-actions"
    >
      <span class="tw-space-contract-action-hint">
        指令将填入下方聊天输入框，确认后手动发送
      </span>
      <button
        type="button"
        class="tw-space-contract-dispatch-btn"
        data-test="space-contract-dispatch-btn"
        :data-dispatched="dispatched ? 'true' : undefined"
        @click="handleDispatch"
      >
        {{ dispatchButtonLabel }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { fillHostSendInput } from '../../红警指挥系统/worldbook/hostSendInput';
import type { ParsedSpaceContract } from './floorCardHydrator';
import { buildSpaceContractCardOrderText } from './floorCardMounts';

type ExtendedSpaceContractInput = ParsedSpaceContract & {
  launchCenterId?: string;
  launch_center_id?: string;
  targetSlot?: string;
  target_slot?: string;
  payloadSource?: 'domestic' | 'commercial' | string;
  payload_source?: 'domestic' | 'commercial' | string;
  client?: string;
  scope?: 'theater' | 'base' | string;
  targetBase?: string;
  target_base?: string;
};

const props = defineProps<{
  contract?: ExtendedSpaceContractInput;
  id?: string;
  title?: string;
  kind?: string;
  rocket?: string;
  payload?: string;
  base?: string;
  rewardCredits?: number;
  recoverBooster?: boolean;
  status?: string;
  weatherHoldReason?: string;
  launchCenterId?: string;
  targetSlot?: string;
  payloadSource?: 'domestic' | 'commercial' | string;
  client?: string;
  scope?: 'theater' | 'base' | string;
  targetBase?: string;
}>();

const resolved = computed(() => {
  const c = props.contract;
  const rawSource =
    c?.payloadSource ??
    c?.payload_source ??
    props.payloadSource ??
    ((c?.kind ?? props.kind) === 'commercial' ? 'commercial' : 'domestic');
  return {
    id: c?.id ?? props.id ?? 'SC-001',
    title: c?.title ?? props.title ?? '未命名航天合同',
    kind: c?.kind ?? props.kind ?? 'orbital_launch',
    rocket: c?.rocket ?? props.rocket ?? '未指定运载火箭',
    payload: c?.payload ?? props.payload ?? '标准载荷',
    base: c?.base ?? props.base ?? '第一发射场',
    rewardCredits: c?.rewardCredits ?? props.rewardCredits ?? 0,
    recoverBooster: c?.recoverBooster ?? props.recoverBooster ?? false,
    status: c?.status ?? props.status ?? 'pending',
    weatherHoldReason: c?.weatherHoldReason ?? props.weatherHoldReason,
    launchCenterId: c?.launchCenterId ?? c?.launch_center_id ?? props.launchCenterId ?? '',
    targetSlot: c?.targetSlot ?? c?.target_slot ?? props.targetSlot ?? '',
    payloadSource: rawSource,
    client: c?.client ?? props.client ?? '',
    scope: c?.scope ?? props.scope ?? '',
    targetBase: c?.targetBase ?? c?.target_base ?? props.targetBase ?? '',
  };
});

const payloadSourceLabel = computed(() => {
  if (resolved.value.payloadSource === 'commercial') {
    return resolved.value.client
      ? `商业订单 (${resolved.value.client})`
      : '商业订单';
  }
  return '自产载荷';
});

const scopeDisplayLabel = computed(() => {
  if (resolved.value.scope === 'base') {
    return resolved.value.targetBase
      ? `单基地定向赋能 (${resolved.value.targetBase})`
      : '单基地定向赋能';
  }
  if (resolved.value.scope === 'theater') {
    return '全战区共享加成';
  }
  return resolved.value.scope;
});

const isHold = computed(
  () =>
    Boolean(resolved.value.weatherHoldReason) ||
    /顺延|hold|delay|延误/i.test(String(resolved.value.status ?? '')),
);

const isFinished = computed(() =>
  /^(completed|已完成|完成|in_orbit|在轨|已入轨)$/i.test(String(resolved.value.status ?? '').trim()),
);

const dispatched = ref(false);

watch(
  () => [resolved.value.id, resolved.value.status],
  () => {
    dispatched.value = false;
  },
);

const dispatchButtonLabel = computed(() => {
  if (dispatched.value) return '✓ 已填入指令栏';
  return isHold.value ? '🌤️ 填入窗口候命指令' : '🚀 签署并填入点火指令';
});

function handleDispatch(): void {
  fillHostSendInput(buildSpaceContractCardOrderText(resolved.value));
  dispatched.value = true;
}
</script>

<style scoped>
.tw-space-contract-card {
  position: relative;
  background-color: #060d1a;
  background-image:
    linear-gradient(rgba(56, 189, 248, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(56, 189, 248, 0.04) 1px, transparent 1px);
  background-size: 18px 18px;
  border: 1px solid rgba(56, 189, 248, 0.45);
  border-top: 2px solid #38bdf8;
  border-radius: 0;
  color: #e2e8f0;
  font-family: 'JetBrains Mono', 'Share Tech Mono', 'Noto Sans SC', monospace;
  padding: 0;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.65);
  overflow: hidden;
}
.tw-space-contract-card::before {
  content: 'MCC FLIGHT TELEMETRY // ORBITAL DISPATCH TERMINAL';
  display: block;
  padding: 4px 14px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: #38bdf8;
  background: rgba(2, 132, 199, 0.16);
  border-bottom: 1px solid rgba(56, 189, 248, 0.28);
}
.tw-space-contract-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: rgba(15, 23, 42, 0.78);
  border-bottom: 1px solid rgba(56, 189, 248, 0.28);
  padding: 11px 14px;
  margin: 0;
}
.tw-space-contract-title-group {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tw-space-contract-id {
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.1em;
  color: #ffffff;
  background: #0284c7;
  border: 1px solid #7dd3fc;
  padding: 3px 9px;
  border-radius: 0;
}
.tw-space-contract-title {
  margin: 0;
  font-size: 15px;
  font-weight: 900;
  color: #f8fafc;
}
.tw-space-contract-badges {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10.5px;
}
.tw-space-contract-kind {
  padding: 3px 9px;
  border-radius: 0;
  color: #7dd3fc;
  background: rgba(14, 165, 233, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.4);
}
.tw-space-contract-status {
  padding: 3px 10px;
  border-radius: 0;
  font-weight: 800;
  color: #4ade80;
  background: rgba(22, 163, 74, 0.16);
  border: 1px solid rgba(74, 222, 128, 0.55);
}
.tw-space-contract-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
  gap: 1px;
  background: rgba(56, 189, 248, 0.22);
  margin: 0;
}
.tw-space-contract-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(7, 14, 28, 0.95);
  padding: 9px 12px;
  border-radius: 0;
}
.tw-space-contract-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #64748b;
}
.tw-space-contract-value {
  font-size: 12.5px;
  font-weight: 700;
  color: #f1f5f9;
}
.tw-space-contract-footer {
  font-size: 11.5px;
  font-weight: 700;
  color: #fde68a;
  background: rgba(245, 158, 11, 0.14);
  border-top: 1px solid rgba(251, 191, 36, 0.45);
  border-left: 4px solid #f59e0b;
  padding: 8px 14px;
}
.tw-space-contract-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 14px;
  background: rgba(8, 15, 29, 0.92);
  border-top: 1px solid rgba(56, 189, 248, 0.24);
}
.tw-space-contract-action-hint {
  font-size: 10.5px;
  color: #94a3b8;
  letter-spacing: 0.04em;
}
.tw-space-contract-dispatch-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #e0f2fe;
  background: rgba(2, 132, 199, 0.22);
  border: 1px solid rgba(56, 189, 248, 0.55);
  border-left: 3px solid #38bdf8;
  border-radius: 0;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.tw-space-contract-dispatch-btn:hover {
  color: #ffffff;
  background: rgba(14, 165, 233, 0.36);
  border-color: #7dd3fc;
}
.tw-space-contract-dispatch-btn[data-dispatched="true"] {
  color: #86efac;
  background: rgba(22, 163, 74, 0.22);
  border-color: rgba(74, 222, 128, 0.6);
  border-left-color: #4ade80;
}
</style>
