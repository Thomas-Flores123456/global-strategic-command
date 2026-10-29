<template>
  <button
    ref="buttonEl"
    type="button"
    class="pda-beacon-button relative flex size-[44px] cursor-pointer touch-none items-center justify-center rounded-[10px] border border-(--line-hi,rgba(155,196,224,0.24)) bg-(--deep-2,rgba(15,24,32,0.85)) shadow-[0_4px_12px_rgba(0,0,0,0.4)] backdrop-blur-md transition-transform select-none active:scale-95"
    :class="{
      'theme-allies': normalizedFaction === 'allies',
      'theme-soviet': normalizedFaction === 'soviet',
      'theme-yuri': normalizedFaction === 'yuri',
      'ring-1 ring-(--alert-bright,#ff5a36)/50': hasCritical,
      'hover:border-(--line-hot,rgba(145,201,239,0.54))': !hasCritical,
    }"
    :data-faction="normalizedFaction"
    :data-has-critical="hasCritical"
    :data-unread-count="unreadCount"
    :title="`战地手持板 (PDA) · 状态: 收纳 · ${unreadCount > 0 ? `${unreadCount} 条新变动` : '待机'}`"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
  >
    <!-- 外圈工规四角刻度微装饰 -->
    <div
      class="pointer-events-none absolute inset-[3px] rounded-[7px] border border-(--line,rgba(141,180,207,0.12)) opacity-60"
    />

    <!-- 阵营微弱呼吸冷光光晕 -->
    <div
      class="pda-beacon-glow pointer-events-none absolute inset-1.5 rounded-full"
      :class="[hasCritical ? 'is-critical bg-(--alert-bright,#ff5a36)' : 'bg-current']"
      :style="{ color: factionColor }"
    />

    <!-- 中心战术核心徽章图标 -->
    <div class="relative z-10 flex size-6 items-center justify-center text-white/90 drop-shadow-sm">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-5 transition-colors duration-300"
        :style="{ stroke: factionColor }"
      >
        <!-- 核心节点 -->
        <circle cx="12" cy="12" r="3" fill="currentColor" fill-opacity="0.3" />
        <!-- 战术菱形/六角外框 -->
        <path d="M12 2.5 L20.5 7.5 L20.5 16.5 L12 21.5 L3.5 16.5 L3.5 7.5 Z" stroke-dasharray="2 1.5" />
        <!-- 四向定位十字准星短线 -->
        <line x1="12" y1="1" x2="12" y2="4" />
        <line x1="12" y1="20" x2="12" y2="23" />
        <line x1="1" y1="12" x2="4" y2="12" />
        <line x1="20" y1="12" x2="23" y2="12" />
      </svg>
    </div>

    <!-- 未读战报角标（Badge Counter） -->
    <span
      v-if="unreadCount && unreadCount > 0"
      class="pda-beacon-badge pointer-events-none absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 font-mono text-[10px] leading-none font-bold shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
      :class="
        hasCritical
          ? 'animate-pulse bg-(--alert-bright,#ff5a36) text-white ring-1 ring-white/60'
          : 'bg-(--amber,#d2ad69) text-black'
      "
    >
      +{{ unreadCount > 99 ? '99' : unreadCount }}
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import type { PdaShell } from './pdaState';

export interface PdaBeaconProps {
  shell: PdaShell;
  unreadCount?: number;
  hasCritical?: boolean;
  faction?: 'allies' | 'soviet' | 'yuri' | string;
}

const props = withDefaults(defineProps<PdaBeaconProps>(), {
  unreadCount: 0,
  hasCritical: false,
  faction: 'allies',
});

const emit = defineEmits<{
  (e: 'click'): void;
  (e: 'drag-start'): void;
  (e: 'drag-end'): void;
}>();

const buttonEl = ref<HTMLButtonElement | null>(null);

/** 阵营名称规整映射（如 'allied' -> 'allies'） */
const normalizedFaction = computed(() => {
  const f = props.faction?.toLowerCase();
  if (f === 'allied' || f === 'allies') return 'allies';
  if (f === 'soviet') return 'soviet';
  if (f === 'yuri') return 'yuri';
  return 'allies';
});

/** 阵营对应的主题颜色 */
const factionColor = computed(() => {
  if (props.hasCritical) return 'var(--alert-bright, #ff5a36)';
  switch (normalizedFaction.value) {
    case 'soviet':
      return 'var(--rac-accent, #ef4444)';
    case 'yuri':
      return 'var(--tint, #c084fc)';
    case 'allies':
    default:
      return 'var(--ice, #8bc3e7)';
  }
});

// ───────────────────────── 交互与拖拽手势 ─────────────────────────

let pointerDownTimer: ReturnType<typeof setTimeout> | null = null;
let isDragging = false;
let startClientX = 0;
let startClientY = 0;
let activePointerId: number | null = null;

function clearTimer() {
  if (pointerDownTimer !== null) {
    clearTimeout(pointerDownTimer);
    pointerDownTimer = null;
  }
}

function onPointerDown(e: PointerEvent) {
  // 只响应鼠标主键或触控
  if (e.button !== 0 && e.pointerType === 'mouse') return;

  activePointerId = e.pointerId;
  startClientX = e.clientX;
  startClientY = e.clientY;
  isDragging = false;

  const screenX = e.screenX;
  const screenY = e.screenY;

  try {
    buttonEl.value?.setPointerCapture(e.pointerId);
  } catch {
    // 安全降级处理
  }

  clearTimer();

  // 长按 >200ms 直接进入拖拽移动态
  pointerDownTimer = setTimeout(() => {
    if (!props.shell.state.pinned) {
      isDragging = true;
      props.shell.dragStart(screenX, screenY);
      emit('drag-start');
    }
  }, 200);
}

function onPointerMove(e: PointerEvent) {
  if (activePointerId !== e.pointerId) return;

  const dist = Math.hypot(e.clientX - startClientX, e.clientY - startClientY);

  if (isDragging) {
    props.shell.dragMove(e.screenX, e.screenY);
  } else if (dist > 5) {
    // 移动超过 5px 立即进入拖拽态，取消短触判定
    clearTimer();
    if (!props.shell.state.pinned) {
      isDragging = true;
      props.shell.dragStart(e.screenX, e.screenY);
      emit('drag-start');
      props.shell.dragMove(e.screenX, e.screenY);
    }
  }
}

function finishPointer(e: PointerEvent) {
  if (activePointerId !== e.pointerId) return;

  clearTimer();

  try {
    buttonEl.value?.releasePointerCapture(e.pointerId);
  } catch {
    // 安全降级
  }

  activePointerId = null;

  if (isDragging) {
    isDragging = false;
    props.shell.dragEnd();
    emit('drag-end');
  } else {
    // 短触无明显位移（距离 <= 5px），判定为正常单击展开
    const dist = Math.hypot(e.clientX - startClientX, e.clientY - startClientY);
    if (dist <= 5) {
      props.shell.toggleCollapse();
      emit('click');
    }
  }
}

function onPointerUp(e: PointerEvent) {
  finishPointer(e);
}

function onPointerCancel(e: PointerEvent) {
  finishPointer(e);
}

onUnmounted(() => {
  clearTimer();
});
</script>

<style scoped>
@keyframes pda-beacon-breathe {
  0%,
  100% {
    opacity: 0.2;
    transform: scale(0.94);
  }
  50% {
    opacity: 0.75;
    transform: scale(1.08);
  }
}

@keyframes pda-beacon-critical {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.92);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}

.pda-beacon-glow {
  filter: blur(5px);
  will-change: transform, opacity;
  animation: pda-beacon-breathe 3.2s ease-in-out infinite;
}

.pda-beacon-glow.is-critical {
  animation: pda-beacon-critical 1.1s ease-in-out infinite;
}
</style>
