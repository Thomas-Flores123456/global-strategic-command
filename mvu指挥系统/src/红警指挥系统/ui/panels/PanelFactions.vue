<template>
  <div class="flex flex-col gap-2 p-2">
    <div class="px-1" style="color: var(--t-faint); font-size: 10px">仅显示指挥官已知信息 · 认知随情报更新</div>
    <section
      v-for="f in data.factions"
      :key="f.name"
      class="card px-3 py-2.5"
      :style="{ borderLeft: `2px solid ${attitudeColor(f.attitude)}` }"
    >
      <div class="flex items-center justify-between gap-2">
        <span style="color: var(--t-hi); font-size: 13px; letter-spacing: 0.03em">{{ f.name }}</span>
        <span class="flex flex-none items-center gap-1.5">
          <span class="chip" :class="attitudeChip(f.attitude)">{{ f.attitude }}</span>
          <span class="chip" :class="riskChip(f.risk)" :title="'暴露风险 ' + f.risk">
            <Icon name="eye" :size="9" />
            {{ f.risk }}
          </span>
        </span>
      </div>
      <div v-if="f.intel" class="mt-1.5 border-t pt-1.5" style="border-color: var(--line); color: var(--t-low); font-size: 11.5px; line-height: 1.6">
        {{ f.intel }}
      </div>
    </section>
    <div v-if="!data.factions.length" class="card px-3 py-4 text-center" style="color: var(--t-faint); font-size: 11.5px">
      尚未接触任何势力
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from '../Icon.vue';
import { useDataStore } from '../../composables/store';

const store = useDataStore();
const data = computed(() => store.data);

function attitudeColor(a: string) {
  return (
    { 敌意: 'var(--bad)', 警觉: 'var(--warn)', 中立: 'var(--t-faint)', 友善: 'var(--ok)', 未接触: 'var(--line-hi)' }[a] ??
    'var(--t-faint)'
  );
}
function attitudeChip(a: string) {
  return { 敌意: 'chip--bad', 警觉: 'chip--warn', 中立: 'chip--dim', 友善: 'chip--ok', 未接触: 'chip--faint' }[a] ?? 'chip--dim';
}
function riskChip(r: string) {
  return { 高: 'chip--bad', 中: 'chip--warn', 低: 'chip--ok', 未知: 'chip--faint' }[r] ?? 'chip--dim';
}
</script>
