<template>
  <aside
    class="ra-dock-handle flex flex-col items-center justify-center select-none cursor-pointer"
    :class="[
      dock === 'left' ? 'ra-dock-handle--left' : 'ra-dock-handle--right',
      { 'ra-dock-handle--collapsed': collapsed },
    ]"
    :title="tooltipText"
    aria-label="控制台侧边推拉伸缩手柄"
    @click.stop="$emit('toggle')"
  >
    <!-- 上延伸微导轨线 -->
    <div class="ra-handle-rail flex-1 w-[1px] my-1" />

    <!-- 核心战术推拉把手（红警经典机械拉手） -->
    <div class="ra-handle-grip flex flex-col items-center justify-center py-2 px-0.5 rounded-[2px] transition-all">
      <!-- 战术指向箭头 -->
      <span class="ra-handle-arrow font-bold transition-transform">
        <Icon :name="arrowIconName" :size="11" />
      </span>

      <!-- 机械防滑凹槽横线刻痕 -->
      <div class="ra-handle-ridges flex flex-col gap-[2px] my-1.5 pointer-events-none">
        <span class="ra-ridge-line" />
        <span class="ra-ridge-line" />
        <span class="ra-ridge-line" />
      </div>

      <!-- 状态微型指示灯 -->
      <span class="ra-handle-led w-[3px] h-[3px] rounded-full" />
    </div>

    <!-- 下延伸微导轨线 -->
    <div class="ra-handle-rail flex-1 w-[1px] my-1" />
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import type { DockMode } from '../host/shell';

const props = withDefaults(
  defineProps<{
    dock?: DockMode;
    collapsed: boolean;
  }>(),
  {
    dock: 'right',
  },
);

defineEmits<{
  (e: 'toggle'): void;
}>();

const arrowIconName = computed<'chevron-left' | 'chevron-right'>(() => {
  if (props.dock === 'left') {
    return props.collapsed ? 'chevron-right' : 'chevron-left';
  }
  // 靠右停靠或自由模式（默认靠右，面向左侧聊天区）
  return props.collapsed ? 'chevron-left' : 'chevron-right';
});

const tooltipText = computed(() => {
  return props.collapsed ? '展开红警建造控制台' : '收起红警建造控制台';
});
</script>

<style scoped>
.ra-dock-handle {
  width: 14px;
  flex: none;
  background: var(--rac-bg);
  transition: background-color 0.2s cubic-bezier(.3,0,.1,1), border-color 0.2s cubic-bezier(.3,0,.1,1);
  z-index: 25;
}

.ra-dock-handle--right {
  border-right: 1px solid var(--rac-dim);
}

.ra-dock-handle--left {
  border-left: 1px solid var(--rac-dim);
}

.ra-dock-handle:hover {
  background: var(--rac-panel);
}

.ra-dock-handle:hover.ra-dock-handle--right {
  border-right-color: var(--rac-line);
}

.ra-dock-handle:hover.ra-dock-handle--left {
  border-left-color: var(--rac-line);
}

/* 延伸微导轨 */
.ra-handle-rail {
  background: linear-gradient(
    to bottom,
    transparent 0%,
    var(--rac-dim) 20%,
    color-mix(in srgb, var(--rac-accent) 65%, var(--rac-line)) 50%,
    var(--rac-dim) 80%,
    transparent 100%
  );
}

/* 核心拉手把手 */
.ra-handle-grip {
  width: 12px;
  min-height: 60px;
  background: color-mix(in srgb, var(--rac-accent) 12%, var(--rac-panel));
  border: 1px solid color-mix(in srgb, var(--rac-accent) 32%, var(--rac-dim));
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 18%, transparent);
}

.ra-dock-handle:hover .ra-handle-grip {
  background: color-mix(in srgb, var(--rac-accent) 20%, var(--rac-panel-2));
  border-color: var(--rac-accent);
  box-shadow:
    0 0 6px var(--rac-glow),
    inset 0 1px 0 color-mix(in srgb, var(--rac-hi) 16%, transparent);
}

.ra-handle-arrow {
  font-size: 11px;
  line-height: 1;
  color: var(--rac-line);
}

.ra-dock-handle:hover .ra-handle-arrow {
  color: var(--rac-hi);
}

/* 机械刻痕防滑线 */
.ra-ridge-line {
  display: block;
  width: 6px;
  height: 1px;
  background: var(--rac-dim);
}

.ra-dock-handle:hover .ra-ridge-line {
  background: var(--rac-line);
}

/* 状态微型指示灯 */
.ra-handle-led {
  background: var(--rac-accent);
  box-shadow: 0 0 4px var(--rac-accent);
}

.ra-dock-handle--collapsed .ra-handle-led {
  background: var(--rac-warn);
  box-shadow: 0 0 4px var(--rac-warn);
}

/* focus ring */
.ra-dock-handle:focus-visible {
  outline: 1px solid var(--rac-focus);
  outline-offset: -1px;
}
</style>
