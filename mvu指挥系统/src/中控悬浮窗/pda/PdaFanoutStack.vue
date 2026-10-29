<template>
  <div
    v-if="resolvedItems.length > 0"
    class="pda-fanout-stack pointer-events-auto flex w-[292px] max-w-[292px] flex-col gap-1 rounded-md border border-(--line-hot,rgba(145,201,239,0.54)) bg-(--deep-2,rgba(13,21,29,0.95)) p-2 font-mono text-xs text-(--text,#d9e5ed) shadow-[0_8px_24px_rgba(0,0,0,0.65)] backdrop-blur-md select-none"
    :data-visible-count="resolvedItems.length"
    :data-overflow-count="overflowCount"
    :data-test="'pda-fanout-stack'"
    :data-testid="'pda-fanout-stack'"
  >
    <!-- ══ 顶栏：风琴栈标题与 [ 全部已读 ] 按钮 ══ -->
    <header class="flex items-center justify-between border-b border-white/10 pb-1 text-[10px]">
      <span class="font-bold tracking-wider text-(--ice,#8bc3e7)">
        {{ `战情队列 (${resolvedItems.length}${overflowCount > 0 ? `+${overflowCount}` : ''})` }}
      </span>
      <button
        type="button"
        class="cursor-pointer rounded-xs border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] leading-none font-bold text-(--ice,#8bc3e7) transition-colors hover:border-(--line-hot,rgba(145,201,239,0.54)) hover:bg-white/15 active:scale-95"
        data-test="pda-fanout-mark-all-read"
        data-testid="pda-fanout-mark-all-read"
        @click.stop="markAllRead"
      >
        [ 全部已读 ]
      </button>
    </header>

    <!-- ══ 主体：2~5 条风琴层叠通知卡片 ══ -->
    <ul class="flex flex-col gap-1" data-test="pda-fanout-list" data-testid="pda-fanout-list">
      <li
        v-for="(item, idx) in resolvedItems"
        :key="item.id || idx"
        class="pda-fanout-card group flex cursor-pointer items-center justify-between gap-1.5 rounded-xs border px-2 py-1.5 transition-all hover:translate-x-0.5"
        :class="severityCardClass(item)"
        :style="{ zIndex: resolvedItems.length - idx }"
        :data-event-id="item.id"
        :data-severity="itemSeverity(item)"
        :data-target-tab="item.targetTab || 'events'"
        data-test="pda-fanout-item"
        data-testid="pda-fanout-item"
        @click.stop="select(item)"
      >
        <div class="flex min-w-0 flex-1 items-center gap-1.5">
          <span class="size-2 shrink-0 rounded-full" :class="severityDotClass(item)" />
          <span class="truncate text-[11px] font-medium text-(--text,#d9e5ed)">
            {{ item.title || item.verb || item.summary || item.id }}
          </span>
        </div>
        <span class="shrink-0 text-[9px] text-(--text-3,#7a8e9a)">
          {{ item.verb || itemSeverityLabel(item) }}
        </span>
      </li>
    </ul>

    <!-- ══ 底栏：超出 5 条时的 +N 条更多战情溢出提示 ══ -->
    <div
      v-if="overflowCount > 0"
      class="mt-0.5 flex cursor-pointer items-center justify-center rounded-xs border border-dashed border-(--amber,#d2ad69)/40 bg-(--amber,#d2ad69)/10 py-1 text-[10px] font-bold text-(--amber,#d2ad69) transition-colors hover:bg-(--amber,#d2ad69)/20"
      data-test="pda-fanout-overflow"
      data-testid="pda-fanout-overflow"
      @click.stop="onOverflowClick"
    >
      +{{ overflowCount }} 条更多战情
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, inject } from 'vue';
import type { PdaEventItem } from './PdaTabEvents.vue';
import { normalizeNotificationSeverity, type PdaNotificationSeverity } from './notificationQueue';
import type { PdaShell } from './pdaState';

export interface PdaFanoutStackProps {
  visible?: readonly PdaEventItem[];
  items?: readonly PdaEventItem[];
  overflowCount?: number;
  totalUnread?: number;
  shell?: PdaShell;
}

const props = withDefaults(defineProps<PdaFanoutStackProps>(), {
  visible: undefined,
  items: undefined,
  overflowCount: 0,
  totalUnread: undefined,
  shell: undefined,
});

const emit = defineEmits<{
  (e: 'select', event: PdaEventItem): void;
  (e: 'mark-all-read'): void;
}>();

const injectedShell = getCurrentInstance() ? inject<PdaShell | undefined>('pdaShell', undefined) : undefined;
const resolvedShell = computed<PdaShell | undefined>(() => props.shell ?? injectedShell);

const resolvedItems = computed<readonly PdaEventItem[]>(() => {
  return props.visible ?? props.items ?? [];
});

function itemSeverity(item: PdaEventItem): PdaNotificationSeverity {
  return normalizeNotificationSeverity(item.level ?? item.severity);
}

function itemSeverityLabel(item: PdaEventItem): string {
  const sev = itemSeverity(item);
  if (sev === 'critical') return '警报';
  if (sev === 'warning') return '预警';
  return '简讯';
}

function severityDotClass(item: PdaEventItem): string {
  const sev = itemSeverity(item);
  if (sev === 'critical') {
    return 'animate-pulse bg-(--alert-bright,#ff5a36) shadow-[0_0_6px_var(--alert-bright,#ff5a36)]';
  }
  if (sev === 'warning') {
    return 'bg-(--amber,#d2ad69)';
  }
  return 'bg-(--safe,#78b69b)';
}

function severityCardClass(item: PdaEventItem): string {
  const sev = itemSeverity(item);
  if (sev === 'critical') {
    return 'border-(--alert-bright,#ff5a36)/50 bg-(--alert-bright,#ff5a36)/12 hover:border-(--alert-bright,#ff5a36)';
  }
  if (sev === 'warning') {
    return 'border-(--amber,#d2ad69)/40 bg-(--amber,#d2ad69)/10 hover:border-(--amber,#d2ad69)';
  }
  return 'border-white/10 bg-black/40 hover:border-(--line-hot,rgba(145,201,239,0.54))';
}

function select(event: PdaEventItem) {
  emit('select', event);
  if (resolvedShell.value) {
    if (event.id) {
      resolvedShell.value.markEventRead(event.id);
    }
    resolvedShell.value.focusEvent(event.id, event.targetTab ?? 'events');
  }
}

function markAllRead() {
  emit('mark-all-read');
  if (resolvedShell.value) {
    const ids = resolvedItems.value.map(item => item.id).filter(Boolean);
    resolvedShell.value.markAllEventsRead(ids);
  }
}

function onOverflowClick() {
  if (resolvedShell.value) {
    resolvedShell.value.setActiveTab('events');
    resolvedShell.value.setCollapsed(false);
  }
}

defineExpose({
  resolvedItems,
  select,
  markAllRead,
});
</script>

<style scoped>
.pda-fanout-stack {
  box-sizing: border-box;
}
</style>
