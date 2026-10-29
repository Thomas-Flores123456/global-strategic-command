<template>
  <div class="flex flex-col gap-2 p-2">
    <!-- ── 进行中 ── -->
    <section class="card">
      <div class="flex items-baseline justify-between px-3 pt-2 pb-1">
        <span class="micro">进行中 · Active</span>
        <span class="num micro">{{ data.quests.active.length }} 项</span>
      </div>
      <button
        v-for="q in data.quests.active"
        :key="q.name"
        class="pressable block w-full border-t px-3 py-2 text-left"
        style="border-color: var(--line)"
        @click="openQuest(q)"
      >
        <div class="flex items-baseline justify-between gap-3">
          <span style="color: var(--t-hi); font-size: 12.5px">{{ q.name }}</span>
          <span class="chip chip--warn flex-none">{{ q.progress }}</span>
        </div>
        <div v-if="q.note" class="mt-0.5" style="color: var(--t-faint); font-size: 11px; line-height: 1.6">{{ q.note }}</div>
      </button>
      <div v-if="!data.quests.active.length" class="border-t px-3 py-3" style="border-color: var(--line); color: var(--t-faint); font-size: 11.5px">
        当前无进行中任务
      </div>
    </section>

    <!-- ── 已完成 ── -->
    <section class="card flex items-center justify-between px-3 py-2.5">
      <span class="micro flex items-center gap-1.5">
        <Icon name="check" :size="11" style="color: var(--ok)" />
        已完成 · Done
      </span>
      <span class="num" style="color: var(--t-hi); font-size: 14px">{{ data.quests.done_count }} <span style="font-size: 10px; color: var(--t-faint)">项</span></span>
    </section>
    <div class="px-1" style="color: var(--t-faint); font-size: 10px">明细见剧情记录 · 此处仅计数</div>
  </div>
</template>

<script setup lang="ts">
import Icon from '../Icon.vue';
import { useDataStore } from '../../composables/store';
import { openDetail } from '../../composables/useDetail';

const store = useDataStore();
const data = computed(() => store.data);

function openQuest(q: (typeof data.value.quests.active)[number]) {
  openDetail({
    title: q.name,
    kind: '任务',
    params: q.progress ? [['进度', q.progress]] : [],
    desc: q.detail || q.note || '暂无任务详情 · 可在对话中请 EVA 补录',
  });
}
</script>
