<template>
  <div
    v-if="visible && currentItem"
    class="pda-notification-pill pointer-events-auto relative flex h-7 max-h-[28px] min-h-[28px] w-[240px] max-w-[260px] min-w-[200px] items-center justify-between rounded-full border border-(--line-hot,rgba(145,201,239,0.54)) bg-(--deep-2,rgba(13,21,29,0.92)) px-2 font-mono text-xs text-(--text,#d9e5ed) shadow-[0_4px_16px_rgba(0,0,0,0.5)] backdrop-blur-md transition-all duration-200 select-none"
    :class="{
      'ring-1 ring-(--alert-bright,#ff5a36)/50': resolvedLevel === 'critical',
    }"
    :data-level="resolvedLevel"
    :data-current-index="currentIndex"
    :data-total="items.length"
    :data-overflow-count="overflowCount"
    :data-test="'pda-notification-pill'"
    :data-testid="'pda-notification-pill'"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @click="onClickBody"
  >
    <!-- ══ 左侧：严重度微指示灯与单行文字摘要 ══ -->
    <div class="flex flex-1 cursor-pointer items-center gap-1.5 overflow-hidden pr-1">
      <!-- 严重度指示灯点 -->
      <span
        class="size-2 shrink-0 rounded-full"
        :class="{
          'animate-pulse bg-(--alert-bright,#ff5a36) shadow-[0_0_6px_var(--alert-bright,#ff5a36)]':
            resolvedLevel === 'critical',
          'bg-(--amber,#d2ad69)': resolvedLevel === 'warn' || resolvedLevel === 'warning',
          'bg-(--safe,#78b69b)': resolvedLevel === 'info',
        }"
      />

      <!-- 单行文字摘要 -->
      <span
        class="truncate text-[11px] leading-none font-medium tracking-tight text-(--text,#d9e5ed)"
        :title="currentItem.title"
        :data-testid="'pda-pill-title'"
      >
        {{ currentItem.title }}
      </span>
    </div>

    <!-- ══ 右侧：多条指示翻页器、风琴抽屉开关与收起按钮 ══ -->
    <div class="flex shrink-0 items-center gap-1 pl-1 text-[10px]" @click.stop>
      <!-- 多条翻页指示角标 [ 1/3 ◀ ▶ ] -->
      <template v-if="items.length > 1">
        <span class="font-mono text-(--text-3,#7a8e9a)" :data-testid="'pda-pill-counter'">
          {{ `${currentIndex + 1}/${items.length}${overflowCount > 0 ? `+${overflowCount}` : ''}` }}
        </span>
        <div class="flex items-center gap-0.5">
          <button
            type="button"
            class="flex size-4 cursor-pointer items-center justify-center rounded-sm text-(--text-3,#7a8e9a) hover:bg-white/10 hover:text-white active:scale-90"
            title="查看上一条"
            :data-testid="'pda-pill-prev'"
            @click.stop="prevItem"
          >
            ◀
          </button>
          <button
            type="button"
            class="flex size-4 cursor-pointer items-center justify-center rounded-sm text-(--text-3,#7a8e9a) hover:bg-white/10 hover:text-white active:scale-90"
            title="查看下一条"
            :data-testid="'pda-pill-next'"
            @click.stop="nextItem"
          >
            ▶
          </button>
          <button
            type="button"
            class="flex size-4 cursor-pointer items-center justify-center rounded-sm text-(--ice,#8bc3e7) hover:bg-white/10 hover:text-white active:scale-90"
            :title="fanoutOpen ? '收起风琴队列' : '展开风琴队列'"
            data-test="pda-pill-fanout-toggle"
            :data-testid="'pda-pill-fanout-toggle'"
            @click.stop="toggleFanout"
          >
            {{ fanoutOpen ? '▴' : '▾' }}
          </button>
        </div>
      </template>

      <!-- 末尾一键收起按钮 [ ✕ ]（收回纽扣，角标保留） -->
      <button
        type="button"
        class="flex size-4 cursor-pointer items-center justify-center rounded-full text-(--text-3,#7a8e9a) hover:bg-white/15 hover:text-white active:scale-90"
        title="收回纽扣（未读保留）"
        :data-testid="'pda-pill-close'"
        @click.stop="closePill"
      >
        ✕
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { PdaShell, PdaTabId } from './pdaState';

export interface PdaNotificationItem {
  id: string;
  level: 'critical' | 'warn' | 'warning' | 'info';
  severity?: 'critical' | 'warn' | 'warning' | 'info';
  title: string;
  targetTab?: PdaTabId;
  timestamp?: string;
}

export interface PdaNotificationPillProps {
  items: PdaNotificationItem[];
  shell?: PdaShell;
  visible?: boolean;
  intervalMs?: number;
  overflowCount?: number;
  fanoutOpen?: boolean;
}

const props = withDefaults(defineProps<PdaNotificationPillProps>(), {
  shell: undefined,
  visible: true,
  intervalMs: 6000,
  overflowCount: 0,
  fanoutOpen: false,
});

const emit = defineEmits<{
  (e: 'click-item', item: PdaNotificationItem): void;
  (e: 'close'): void;
  (e: 'change', index: number): void;
  (e: 'toggle-fanout'): void;
}>();

const currentIndex = ref(0);
const isHovered = ref(false);
let tickerTimer: ReturnType<typeof setInterval> | null = null;

// 当 items 变更时，保障索引不越界
watch(
  () => props.items.length,
  len => {
    if (len === 0) {
      currentIndex.value = 0;
    } else if (currentIndex.value >= len) {
      currentIndex.value = 0;
    }
  },
);

const currentItem = computed<PdaNotificationItem | null>(() => {
  if (!props.items || props.items.length === 0) return null;
  const idx = Math.min(Math.max(0, currentIndex.value), props.items.length - 1);
  return props.items[idx] ?? null;
});

const resolvedLevel = computed<'critical' | 'warn' | 'warning' | 'info'>(() => {
  const raw = currentItem.value?.level ?? currentItem.value?.severity ?? 'info';
  return raw;
});

function startTicker() {
  stopTicker();
  if (props.items.length <= 1) return;
  tickerTimer = setInterval(() => {
    if (!isHovered.value && props.items.length > 1) {
      nextItem();
    }
  }, props.intervalMs);
}

function stopTicker() {
  if (tickerTimer !== null) {
    clearInterval(tickerTimer);
    tickerTimer = null;
  }
}

function nextItem() {
  if (props.items.length <= 1) return;
  currentIndex.value = (currentIndex.value + 1) % props.items.length;
  emit('change', currentIndex.value);
}

function prevItem() {
  if (props.items.length <= 1) return;
  currentIndex.value = (currentIndex.value - 1 + props.items.length) % props.items.length;
  emit('change', currentIndex.value);
}

function onMouseEnter() {
  isHovered.value = true;
}

function onMouseLeave() {
  isHovered.value = false;
}

function onClickBody() {
  if (!currentItem.value) return;
  emit('click-item', currentItem.value);

  // 若关联了 shell，执行原地展开并聚焦目标条目
  if (props.shell) {
    const item = currentItem.value;
    props.shell.focusEvent(item.id, item.targetTab ?? 'events');
  }
}

function closePill() {
  emit('close');
}

function toggleFanout() {
  emit('toggle-fanout');
}

onMounted(() => {
  startTicker();
});

watch(
  () => [props.items.length, props.intervalMs],
  () => {
    startTicker();
  },
);

onUnmounted(() => {
  stopTicker();
});
</script>

<style scoped>
.pda-notification-pill {
  box-sizing: border-box;
}
</style>
