<template>
  <div class="flex flex-col gap-2 p-2">
    <!-- ── 概览指标 ── -->
    <div class="grid grid-cols-3 gap-2">
      <section class="card flex flex-col items-center py-2">
        <span class="tag-en">Units</span>
        <span class="num" style="color: var(--t-hi); font-size: 18px; line-height: 1.3">
          {{ onlineCount }}<span style="color: var(--t-faint); font-size: 11px">/{{ data.forces.girls.length }}</span>
        </span>
        <span style="font-size: 10px; color: var(--t-low)">机娘在线</span>
      </section>
      <section class="card flex flex-col items-center py-2">
        <span class="tag-en">Troops</span>
        <span class="num" style="color: var(--t-hi); font-size: 18px; line-height: 1.3">{{ troopTotal }}</span>
        <span style="font-size: 10px; color: var(--t-low)">量产体</span>
      </section>
      <section class="card flex flex-col items-center py-2">
        <span class="tag-en">Command</span>
        <span class="num" style="color: var(--t-hi); font-size: 18px; line-height: 1.3">{{ data.forces.command_cap }}</span>
        <span style="font-size: 10px; color: var(--t-low)">编制占用</span>
      </section>
    </div>

    <!-- ── 机娘 ── -->
    <section class="card">
      <button class="pressable flex w-full items-center justify-between px-3 py-2" @click="show_girls = !show_girls">
        <span class="micro">机娘序列 · Roster</span>
        <span class="num flex items-center gap-2" style="font-size: 10.5px; color: var(--t-low)">
          <span v-if="hurtCount" class="chip chip--bad">{{ hurtCount }} 受损</span>
          <Icon :name="show_girls ? 'chevron-up' : 'chevron-down'" :size="10" />
        </span>
      </button>
      <div v-if="show_girls" class="border-t px-3 pb-1" style="border-color: var(--line)">
        <div
          v-for="g in data.forces.girls"
          :key="g.name"
          class="flex items-center justify-between border-b py-1.5 last:border-b-0"
          style="border-color: var(--line)"
        >
          <span class="flex items-center gap-2">
            <span class="dot" :style="{ background: hpColor(g.hp) }" />
            <span style="color: var(--t-hi); font-size: 12px">{{ g.name }}</span>
            <span style="color: var(--t-faint); font-size: 10.5px">{{ g.duty }}</span>
          </span>
          <span class="chip" :class="hpChip(g.hp)" style="height: 16px; font-size: 9.5px">{{ g.hp }}</span>
        </div>
      </div>
    </section>

    <!-- ── 量产体分布 ── -->
    <section v-if="Object.keys(data.forces.troops).length" class="card px-3 py-2">
      <div class="micro mb-1.5">量产体分布</div>
      <div class="flex flex-wrap gap-1">
        <span v-for="(n, t) in data.forces.troops" :key="t" class="chip">
          {{ t }}
          <span class="num" style="color: var(--t-hi)">×{{ n }}</span>
        </span>
      </div>
    </section>

    <!-- ── 载具 ── -->
    <section class="card px-3 py-2">
      <div class="micro mb-1.5">载具 · Vehicles</div>
      <div v-if="data.forces.vehicles.length" class="flex flex-wrap gap-1">
        <span v-for="v in data.forces.vehicles" :key="v" class="chip">{{ v }}</span>
      </div>
      <div v-else style="color: var(--t-faint); font-size: 11.5px">无在役载具</div>
    </section>

    <!-- ── 弹药 ── -->
    <section class="card px-3 py-2">
      <div class="micro mb-1.5">弹药存量 · Ammunition</div>
      <div v-for="(lv, t) in data.forces.ammo" :key="t" class="flex items-center justify-between py-1">
        <span style="font-size: 12px; color: var(--t-mid)">{{ t }}</span>
        <span class="flex items-center gap-2">
          <span class="flex gap-0.5" aria-hidden="true">
            <span
              v-for="n in 4"
              :key="n"
              class="ablk"
              :style="n <= ammoLevel(lv) ? { background: ammoColor(lv) } : {}"
            />
          </span>
          <span :style="{ color: ammoColor(lv), fontSize: '10.5px', minWidth: '26px', textAlign: 'right' }">{{ lv }}</span>
        </span>
      </div>
      <div v-if="!Object.keys(data.forces.ammo).length" style="color: var(--t-faint); font-size: 11.5px">无库存记录</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import Icon from '../Icon.vue';
import { useDataStore } from '../../composables/store';

const store = useDataStore();
const data = computed(() => store.data);

const show_girls = ref(false);

const onlineCount = computed(() => data.value.forces.girls.filter(g => g.hp !== '离线').length);
const hurtCount = computed(() => data.value.forces.girls.filter(g => g.hp === '轻损' || g.hp === '重损').length);
const troopTotal = computed(() => Object.values(data.value.forces.troops).reduce((s, n) => s + n, 0));

function hpColor(hp: string) {
  return { 完好: 'var(--ok)', 轻损: 'var(--warn)', 重损: 'var(--bad)', 离线: 'var(--t-faint)' }[hp] ?? 'var(--t-low)';
}
function hpChip(hp: string) {
  return { 完好: 'chip--ok', 轻损: 'chip--warn', 重损: 'chip--bad', 离线: 'chip--faint' }[hp] ?? 'chip--dim';
}
function ammoColor(lv: string) {
  return { 充足: 'var(--ok)', 尚可: 'var(--t-mid)', 告急: 'var(--warn)', 无: 'var(--bad)' }[lv] ?? 'var(--t-low)';
}
function ammoLevel(lv: string) {
  return { 充足: 4, 尚可: 3, 告急: 1, 无: 0 }[lv] ?? 0;
}
</script>
