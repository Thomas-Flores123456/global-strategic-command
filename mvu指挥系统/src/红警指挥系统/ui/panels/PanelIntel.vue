<template>
  <div class="flex flex-col gap-2 p-2">
    <!-- ── 置顶区 ── -->
    <section v-if="pinnedItems.length" class="card" style="border-color: color-mix(in srgb, var(--warn) 35%, var(--line))">
      <div class="micro flex items-center gap-1.5 px-3 pt-2" style="color: var(--warn)">
        <Icon name="pin" :size="10" />
        置顶 · Pinned
      </div>
      <IntelRow v-for="(it, i) in pinnedItems" :key="'p' + i" :item="it" @pin="togglePin(it)" @archive="archiveItem(it)" @open="openIntel(it)" />
    </section>

    <!-- ── 常规流水 ── -->
    <section class="card">
      <div class="flex items-baseline justify-between px-3 pt-2">
        <span class="micro">情报流水 · 自动保留最近 {{ FLOW_LIMIT }} 条</span>
        <span v-if="unreadCount" class="chip chip--warn" style="height: 15px; font-size: 9px">{{ unreadCount }} 未读</span>
      </div>
      <IntelRow v-for="(it, i) in flowItems" :key="'f' + i" :item="it" @pin="togglePin(it)" @archive="archiveItem(it)" @open="openIntel(it)" />
      <div v-if="!flowItems.length" class="px-3 py-3" style="color: var(--t-faint); font-size: 11.5px">暂无情报</div>
    </section>

    <!-- ── 归档冷存区 ── -->
    <section class="card">
      <button class="pressable flex w-full items-center justify-between px-3 py-2" @click="show_archive = !show_archive">
        <span class="micro flex items-center gap-1.5">
          <Icon name="archive" :size="10" />
          归档 · Archived
        </span>
        <span class="num flex items-center gap-2" style="font-size: 10.5px; color: var(--t-faint)">
          {{ data.intel_archived.length }} 条
          <Icon :name="show_archive ? 'chevron-up' : 'chevron-down'" :size="10" />
        </span>
      </button>
      <div v-if="show_archive" class="border-t" style="border-color: var(--line)">
        <div
          v-for="(it, i) in data.intel_archived"
          :key="'a' + i"
          class="border-b px-3 py-1.5 last:border-b-0"
          style="border-color: var(--line); color: var(--t-faint); font-size: 11px; line-height: 1.6"
        >
          <span style="color: var(--t-low)">[{{ it.src }}]</span>
          {{ it.content }}
          <span class="num" style="font-size: 10px">· {{ it.date }}</span>
        </div>
        <div v-if="!data.intel_archived.length" class="px-3 py-2" style="color: var(--t-faint); font-size: 11px">归档为空</div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import Icon from '../Icon.vue';
import { useDataStore } from '../../composables/store';
import { openDetail } from '../../composables/useDetail';
import IntelRow from './IntelRow.vue';

/** 常规流水上限（超出时最旧非置顶条自动移入冷存·纯前端） */
const FLOW_LIMIT = 15;
/** 冷存硬上限（满了真删最旧） */
const ARCHIVE_LIMIT = 50;

const store = useDataStore();
const data = computed(() => store.data);

const show_archive = ref(false);

const pinnedItems = computed(() => data.value.intel.filter(it => it.pinned));
const flowItems = computed(() => data.value.intel.filter(it => !it.pinned));
const unreadCount = computed(() => data.value.intel.filter(it => !it.read).length);

type IntelItem = (typeof data.value.intel)[number];

function togglePin(it: IntelItem) {
  it.pinned = !it.pinned;
}

/** 点开正文：标记已读 + 详情抽屉展示全文 */
function openIntel(it: IntelItem) {
  it.read = true;
  openDetail({
    title: `${it.src}线报`,
    kind: '情报',
    params: [
      ['日期', it.date || '—'],
      ['可信度', it.cred],
    ],
    desc: it.content,
  });
}

/** 手动归档：移入冷存（纯前端数据整理，不触发新楼层） */
function archiveItem(it: IntelItem) {
  const idx = data.value.intel.indexOf(it);
  if (idx === -1) return;
  data.value.intel.splice(idx, 1);
  data.value.intel_archived.push(it);
  trimArchive();
}

/** 自动清理：流水超限时最旧非置顶条移入冷存（零 AI 参与） */
watchEffect(() => {
  while (flowItems.value.length > FLOW_LIMIT) {
    const oldest = data.value.intel.find(it => !it.pinned);
    if (!oldest) break;
    data.value.intel.splice(data.value.intel.indexOf(oldest), 1);
    data.value.intel_archived.push(oldest);
  }
  trimArchive();
});

function trimArchive() {
  while (data.value.intel_archived.length > ARCHIVE_LIMIT) {
    data.value.intel_archived.shift();
  }
}
</script>
