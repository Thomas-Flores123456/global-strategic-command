<template>
  <div
    class="pda-tab-events flex h-full flex-1 flex-col overflow-hidden font-mono text-xs text-(--text,#d9e5ed) select-none"
    :data-active-filter="activeFilter"
    :data-unread-count="unreadCount"
    :data-testid="'pda-tab-events'"
  >
    <!-- ══ 顶栏：微型过滤器与一键已读工具条 ══ -->
    <div
      class="flex flex-col gap-1.5 border-b border-(--line,rgba(141,180,207,0.12)) bg-(--deep-1,rgba(7,12,17,0.75)) px-2.5 py-2"
    >
      <!-- 四档严重度过滤按钮（强制单行 whitespace-nowrap，杜绝 [🔴 警报] 断行） -->
      <div class="flex items-center justify-between gap-1.5" role="tablist" aria-label="战地事件严重度过滤">
        <button
          v-for="opt in FILTER_OPTIONS"
          :key="opt.id"
          type="button"
          class="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-sm border px-2 py-1.5 text-[11px] leading-none font-bold whitespace-nowrap transition-colors active:scale-95"
          :class="
            activeFilter === opt.id
              ? 'border-(--line-hot,rgba(145,201,239,0.54)) bg-white/12 text-(--ice,#8bc3e7)'
              : 'border-white/8 bg-black/35 text-(--text-3,#7a8e9a) hover:border-white/20 hover:text-(--text,#d9e5ed)'
          "
          :data-filter="opt.id"
          :data-active="activeFilter === opt.id"
          :data-testid="`pda-event-filter-${opt.id}`"
          @click="setFilter(opt.id)"
        >
          <span>{{ opt.label }}</span>
          <span class="text-[10px] opacity-75">({{ filterCount(opt.id) }})</span>
        </button>
      </div>

      <!-- 次栏：未读战报统计与一键标为已读 -->
      <div class="flex items-center justify-between text-[11px] text-(--text-3,#7a8e9a)">
        <div class="flex items-center gap-1.5">
          <span>动态流: {{ filteredEvents.length }}/{{ normalizedEvents.length }}</span>
          <span
            v-if="unreadCount > 0"
            class="rounded-sm bg-(--alert-bright,#ff5a36)/20 px-1.5 py-0.5 font-bold text-(--alert-bright,#ff5a36)"
            :data-testid="'pda-events-unread-badge'"
          >
            未读 {{ unreadCount }}
          </span>
        </div>

        <button
          type="button"
          class="cursor-pointer rounded-sm border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] whitespace-nowrap text-(--ice,#8bc3e7) transition-colors hover:border-(--line-hot,rgba(145,201,239,0.54)) hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="unreadCount === 0"
          :data-testid="'pda-events-mark-all-read'"
          @click="markAllAsRead"
        >
          一键标为已读
        </button>
      </div>
    </div>

    <!-- ══ 主体：垂直时间轴事件卡片列表 ══ -->
    <div class="flex-1 overflow-y-auto px-3 py-2.5">
      <div
        v-if="filteredEvents.length === 0"
        class="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-center text-(--text-3,#7a8e9a)"
        :data-testid="'pda-events-empty'"
      >
        <div class="flex flex-col items-center gap-1">
          <span class="text-xs font-bold text-(--ice,#8bc3e7)">[ 当前战区暂无突发动态事件 ]</span>
          <span class="text-[11px] text-(--text-3,#7a8e9a)">当前过滤条件下未检索到战地动态记录 · 防区运转平稳</span>
        </div>

        <!-- 战区值班简报卡（告别大块纯黑空白，提供战区概况与快捷跳转） -->
        <div
          class="w-full max-w-[440px] rounded-sm border border-white/10 bg-black/35 p-3 text-left text-[11px]"
          :data-testid="'pda-duty-briefing-card'"
        >
          <div class="mb-2 flex items-center justify-between border-b border-white/8 pb-1.5">
            <span class="font-bold text-(--ice,#8bc3e7)">DUTY BRIEFING // 战地值班简报</span>
            <span class="rounded-xs bg-(--safe,#78b69b)/20 px-1.5 py-0.5 text-[10px] font-bold text-(--safe,#78b69b)">
              防务绿灯
            </span>
          </div>
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="rounded-xs border border-white/6 bg-white/3 p-1.5">
              <div class="text-[10px] text-(--text-3,#7a8e9a)">驻扎基地</div>
              <div class="mt-0.5 text-xs font-bold text-(--text,#d9e5ed)">{{ dutyBriefing.baseCount }} 座</div>
            </div>
            <div class="rounded-xs border border-white/6 bg-white/3 p-1.5">
              <div class="text-[10px] text-(--text-3,#7a8e9a)">在册人员/图鉴</div>
              <div class="mt-0.5 text-xs font-bold text-(--ice,#8bc3e7)">{{ dutyBriefing.codexCount }} 项</div>
            </div>
            <div class="rounded-xs border border-white/6 bg-white/3 p-1.5">
              <div class="text-[10px] text-(--text-3,#7a8e9a)">活跃资金链</div>
              <div class="mt-0.5 text-xs font-bold text-(--safe,#78b69b)">{{ dutyBriefing.chainCount }} 条</div>
            </div>
          </div>
          <div class="mt-2.5 flex items-center justify-end gap-2">
            <button
              type="button"
              class="cursor-pointer rounded-xs border border-white/12 bg-white/5 px-2 py-1 text-[10px] font-bold text-(--ice,#8bc3e7) transition-colors hover:bg-white/12"
              @click="resolvedShell?.setActiveTab('intel')"
            >
              查阅战区情报与人员 ➔
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-xs border border-white/12 bg-white/5 px-2 py-1 text-[10px] font-bold text-(--text,#d9e5ed) transition-colors hover:bg-white/12"
              @click="resolvedShell?.setActiveTab('quests')"
            >
              作战任务板 ➔
            </button>
          </div>
        </div>
      </div>

      <ol
        v-else
        class="relative ml-1.5 flex flex-col gap-2 border-l border-(--line,rgba(141,180,207,0.2)) pl-3"
        :data-testid="'pda-events-timeline'"
      >
        <li
          v-for="item in filteredEvents"
          :key="item.id"
          class="pda-event-card group relative cursor-pointer rounded-sm border p-2 transition-all"
          :class="[
            levelCardClass(item.level),
            resolvedShell?.state.highlightEventId === item.id
              ? 'hot-pulse-focus ring-1 ring-(--ice,#8bc3e7)'
              : 'hover:border-(--line-hot,rgba(145,201,239,0.45))',
          ]"
          :data-event-id="item.id"
          :data-event-level="item.level"
          :data-event-verb="item.verb"
          :data-unread="!item.isRead"
          :data-highlighted="resolvedShell?.state.highlightEventId === item.id"
          :data-testid="'pda-event-card'"
          @click="onSelectEvent(item)"
        >
          <!-- 垂直时间轴节点指示器 -->
          <span
            class="absolute top-3 left-[-16.5px] size-2 rounded-full border border-black/80"
            :class="levelDotClass(item.level)"
          />

          <!-- 卡片首行：事件动词标签 + 发生楼层/时间 + 未读红点 -->
          <div class="mb-1 flex items-center justify-between gap-1.5">
            <div class="flex items-center gap-1.5 overflow-hidden">
              <span
                class="shrink-0 rounded-xs px-1 py-0.5 text-[10px] leading-none font-bold"
                :class="levelBadgeClass(item.level)"
                :data-testid="'pda-event-verb'"
              >
                [{{ item.verb }}]
              </span>
              <span class="truncate text-[11px] font-bold text-(--text,#d9e5ed)" :data-testid="'pda-event-title'">
                {{ item.title }}
              </span>
            </div>

            <div class="flex shrink-0 items-center gap-1.5 text-[10px] text-(--text-3,#7a8e9a)">
              <span :data-testid="'pda-event-meta'">{{ item.floorText }} · {{ item.timeText }}</span>
              <!-- 未读红点标记（与 pdaShell.state.readEventIds 联动） -->
              <span
                v-if="!item.isRead"
                class="size-2 rounded-full bg-(--alert-bright,#ff5a36) shadow-[0_0_6px_var(--alert-bright,#ff5a36)]"
                title="未读战报"
                :data-testid="'pda-event-unread-dot'"
              />
            </div>
          </div>

          <!-- 卡片正文：概要描述與直达引导 -->
          <p class="text-[11px] leading-relaxed text-(--text-2,#8fa3b1)" :data-testid="'pda-event-summary'">
            {{ item.summary }}
          </p>

          <div class="mt-1.5 flex items-center justify-between text-[10px] text-(--text-4,#354957)">
            <span>LEVEL // {{ item.level.toUpperCase() }}</span>
            <span class="text-(--ice,#8bc3e7) opacity-80 group-hover:opacity-100">点击直达 ➔</span>
          </div>
        </li>
      </ol>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getActivePinia } from 'pinia';
import { computed, getCurrentInstance, inject, ref, watch } from 'vue';
import type { Schema } from '../../红警指挥系统/core/schema';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import type { PdaShell, PdaTabId } from './pdaState';
import {
  derivePdaEventsFromSnapshot,
  type PdaEventFilter,
  type PdaEventItem,
  type PdaEventLevel,
} from './notificationQueue';

export type { PdaEventFilter, PdaEventItem, PdaEventLevel };

export interface NormalizedPdaEventItem {
  id: string;
  level: PdaEventLevel;
  verb: string;
  title: string;
  summary: string;
  floorText: string;
  timeText: string;
  targetTab: PdaTabId;
  isRead: boolean;
}

export interface PdaTabEventsProps {
  shell?: PdaShell;
  events?: PdaEventItem[];
  snapshot?: (Partial<Schema> & { events?: PdaEventItem[] }) | null;
  filter?: PdaEventFilter;
  demoMode?: boolean;
  selectedDirectiveId?: string | null;
}

const props = withDefaults(defineProps<PdaTabEventsProps>(), {
  shell: undefined,
  events: undefined,
  snapshot: undefined,
  filter: 'all',
  demoMode: false,
  selectedDirectiveId: null,
});

const emit = defineEmits<{
  (e: 'select-event', item: NormalizedPdaEventItem): void;
  (e: 'mark-read', id: string): void;
  (e: 'mark-all-read', ids: string[]): void;
  (e: 'filter-change', filter: PdaEventFilter): void;
}>();

const FILTER_OPTIONS: ReadonlyArray<{ id: PdaEventFilter; label: string }> = [
  { id: 'all', label: '[全部]' },
  { id: 'critical', label: '[🔴 警报]' },
  { id: 'warn', label: '[🟡 预警]' },
  { id: 'info', label: '[🟢 简讯]' },
];

/** 默认战地动态流 fallback（当 snapshot.events 与 props.events 均未提供时兜底展示） */
const DEFAULT_FALLBACK_EVENTS: ReadonlyArray<PdaEventItem> = [
  {
    id: 'evt-default-power-outage',
    level: 'critical',
    verb: '工况异常',
    title: '基地电网断供停产告警',
    summary: '主反应堆过载保护触发，矿石精炼厂供电中断，关联资金链暂停运转。',
    floor: '#12',
    time: '12:40',
    targetTab: 'chains',
  },
  {
    id: 'evt-default-chain-shift',
    level: 'warn',
    verb: '资金链变动',
    title: '废料商路遇袭降效',
    summary: '遭遇拾荒者武装伏击，荒原精炼贸易线履约效率跌至 50%，日均净入减少。',
    floor: '#11',
    time: '12:15',
    targetTab: 'chains',
  },
  {
    id: 'evt-default-faction-contact',
    level: 'info',
    verb: '势力接触',
    title: '截获新频段信号：自由商人联合会',
    summary: '侦测到中立武装商团活动迹象，新势力情报已进入待收录列表。',
    floor: '#10',
    time: '11:50',
    targetTab: 'intel',
  },
];

const injectedShell = getCurrentInstance() ? inject<PdaShell | undefined>('pdaShell', undefined) : undefined;
const resolvedShell = computed<PdaShell | undefined>(() => props.shell ?? injectedShell);

const activeFilter = ref<PdaEventFilter>(props.filter);
const selectedDirectiveId = ref<string | null>(props.selectedDirectiveId ?? null);

watch(
  () => props.filter,
  next => {
    if (next) activeFilter.value = next;
  },
);

watch(
  () => props.selectedDirectiveId,
  next => {
    if (next !== undefined) selectedDirectiveId.value = next;
  },
);

const localReadIds = ref<Set<string>>(new Set());

/** 安全获取 floatingStore 快照（兼容无 Pinia 的 SSR 测试环境） */
const storeSnapshot = computed<(Partial<Schema> & { events?: PdaEventItem[] }) | null>(() => {
  if (props.snapshot !== undefined) return props.snapshot;
  try {
    const pinia = getActivePinia();
    if (!pinia) return null;
    const floating = useFloatingStore(pinia);
    return (floating.snapshot as (Partial<Schema> & { events?: PdaEventItem[] }) | null) ?? null;
  } catch {
    return null;
  }
});

const rawEvents = computed<readonly PdaEventItem[]>(() => {
  if (props.events !== undefined) {
    if (props.events.length === 0 && props.demoMode) {
      return DEFAULT_FALLBACK_EVENTS;
    }
    return props.events;
  }
  const snap = storeSnapshot.value;
  if (snap) {
    const derived = derivePdaEventsFromSnapshot(snap);
    if (derived.length === 0 && props.demoMode) {
      return DEFAULT_FALLBACK_EVENTS;
    }
    return derived;
  }
  return props.demoMode ? DEFAULT_FALLBACK_EVENTS : [];
});

function normalizeLevel(raw?: string): PdaEventLevel {
  if (!raw) return 'info';
  const lower = raw.toLowerCase();
  if (lower === 'critical' || lower === 'alert' || lower === 'error' || lower === 'danger') {
    return 'critical';
  }
  if (lower === 'warn' || lower === 'warning') {
    return 'warn';
  }
  return 'info';
}

function defaultVerbForLevel(level: PdaEventLevel): string {
  if (level === 'critical') return '工况异常';
  if (level === 'warn') return '资金链变动';
  return '势力接触';
}

function inferTargetTab(verb: string, explicit?: PdaTabId): PdaTabId {
  if (explicit) return explicit;
  if (verb.includes('资金') || verb.includes('工况') || verb.includes('断电') || verb.includes('商路')) {
    return 'chains';
  }
  if (verb.includes('势力') || verb.includes('情报') || verb.includes('世界书')) {
    return 'intel';
  }
  return 'events';
}

const normalizedEvents = computed<NormalizedPdaEventItem[]>(() => {
  const shellReadSet = new Set(resolvedShell.value?.state.readEventIds ?? []);
  return rawEvents.value.map((item, idx) => {
    const id = item.id || `evt-${idx}`;
    const level = normalizeLevel(item.level ?? item.severity);
    const verb = item.verb || item.type || item.category || defaultVerbForLevel(level);
    const title = item.title || verb;
    const summary = item.summary || item.message || item.desc || item.content || '无附加详情';
    const rawFloor = item.floor ?? item.floorId;
    const floorText =
      rawFloor !== undefined && rawFloor !== null && String(rawFloor).trim() !== ''
        ? String(rawFloor).startsWith('#')
          ? String(rawFloor)
          : `#${rawFloor}`
        : '#--';
    const timeText = item.time || item.timestamp || item.date || '--:--';
    const isRead = Boolean(item.read) || shellReadSet.has(id) || localReadIds.value.has(id);

    return {
      id,
      level,
      verb,
      title,
      summary,
      floorText,
      timeText,
      targetTab: inferTargetTab(verb, item.targetTab),
      isRead,
    };
  });
});

const filteredEvents = computed<NormalizedPdaEventItem[]>(() => {
  if (activeFilter.value === 'all') {
    return normalizedEvents.value;
  }
  return normalizedEvents.value.filter(item => item.level === activeFilter.value);
});

watch(
  filteredEvents,
  list => {
    if (selectedDirectiveId.value && !list.some(item => item.id === selectedDirectiveId.value)) {
      selectedDirectiveId.value = null;
    }
  },
  { immediate: true },
);

const unreadCount = computed<number>(() => {
  return normalizedEvents.value.filter(item => !item.isRead).length;
});

function filterCount(filterId: PdaEventFilter): number {
  if (filterId === 'all') return normalizedEvents.value.length;
  return normalizedEvents.value.filter(item => item.level === filterId).length;
}

const dutyBriefing = computed(() => {
  const snap = storeSnapshot.value;
  const baseCount = Array.isArray(snap?.bases) ? snap!.bases.length : 0;
  const codexCount = Array.isArray(snap?.codex) ? snap!.codex.length : 0;
  const chainCount = Array.isArray(snap?.economy?.chains) ? snap!.economy!.chains.length : 0;
  return { baseCount, codexCount, chainCount };
});

function setFilter(next: PdaEventFilter) {
  activeFilter.value = next;
  if (selectedDirectiveId.value && !filteredEvents.value.some(item => item.id === selectedDirectiveId.value)) {
    selectedDirectiveId.value = null;
  }
  if (
    resolvedShell.value?.state.highlightEventId &&
    !filteredEvents.value.some(item => item.id === resolvedShell.value?.state.highlightEventId)
  ) {
    resolvedShell.value.clearHighlight();
  }
  emit('filter-change', next);
}

function onSelectEvent(item: NormalizedPdaEventItem) {
  selectedDirectiveId.value = item.id;
  localReadIds.value.add(item.id);
  resolvedShell.value?.markEventRead(item.id);
  resolvedShell.value?.focusEvent(item.id, item.targetTab);
  emit('mark-read', item.id);
  emit('select-event', item);
}

function markAllAsRead() {
  const ids = normalizedEvents.value.map(item => item.id);
  for (const id of ids) {
    localReadIds.value.add(id);
  }
  resolvedShell.value?.markAllEventsRead(ids);
  emit('mark-all-read', ids);
}

function levelCardClass(level: PdaEventLevel): string {
  switch (level) {
    case 'critical':
      return 'border-(--alert-bright,#ff5a36)/45 bg-(--alert-bright,#ff5a36)/8';
    case 'warn':
      return 'border-(--amber,#d2ad69)/40 bg-(--amber,#d2ad69)/8';
    case 'info':
    default:
      return 'border-white/10 bg-black/35';
  }
}

function levelDotClass(level: PdaEventLevel): string {
  switch (level) {
    case 'critical':
      return 'animate-pulse bg-(--alert-bright,#ff5a36) shadow-[0_0_6px_var(--alert-bright,#ff5a36)]';
    case 'warn':
      return 'bg-(--amber,#d2ad69)';
    case 'info':
    default:
      return 'bg-(--safe,#78b69b)';
  }
}

function levelBadgeClass(level: PdaEventLevel): string {
  switch (level) {
    case 'critical':
      return 'bg-(--alert-bright,#ff5a36)/25 text-(--alert-bright,#ff5a36)';
    case 'warn':
      return 'bg-(--amber,#d2ad69)/25 text-(--amber,#d2ad69)';
    case 'info':
    default:
      return 'bg-(--safe,#78b69b)/25 text-(--safe,#78b69b)';
  }
}

defineExpose({
  activeFilter,
  selectedDirectiveId,
  filteredEvents,
  unreadCount,
  setFilter,
  markAllAsRead,
  onSelectEvent,
});
</script>

<style scoped>
.pda-tab-events {
  box-sizing: border-box;
}
</style>
