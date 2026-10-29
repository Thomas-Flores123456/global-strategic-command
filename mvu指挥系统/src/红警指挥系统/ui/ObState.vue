<template>
  <span
    class="ob-state"
    :class="[
      `ob-state--${state}`,
      {
        'ob-hatch': state === 'failed',
        'ob-hatch--dim': state === 'unknown',
      },
    ]"
    :data-state="state"
    :title="tooltipText"
  >
    <span
      v-if="state === 'building'"
      class="ob-state__bar"
      aria-hidden="true"
    >
      <span
        class="ob-state__bar-fill"
        :style="{ height: `${normalizedProgress}%` }"
      />
    </span>
    <span class="ob-state__text" :class="{ 'ob-state__text--strike': state === 'offline' }">
      <slot>{{ displayText }}</slot>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export type ObStateKind =
  | 'draft'
  | 'sent'
  | 'live'
  | 'building'
  | 'failed'
  | 'unknown'
  | 'depleted'
  | 'offline';

const props = defineProps<{
  state: ObStateKind;
  label?: string;
  reason?: string;
  progress?: number;
}>();

const DEFAULT_LABELS: Record<ObStateKind, string> = {
  draft: '待发',
  sent: '已下达⋯',
  live: '运转',
  building: '在建',
  failed: '被拒',
  unknown: '未探明',
  depleted: '告罄',
  offline: '停机',
};

const normalizedProgress = computed<number>(() => {
  if (typeof props.progress !== 'number' || !Number.isFinite(props.progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(props.progress)));
});

const displayText = computed<string>(() => {
  const raw = props.label?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_LABELS[props.state] ?? props.state;

  if (props.state === 'sent') {
    return base.endsWith('⋯') ? base : `${base}⋯`;
  }
  if (props.state === 'building' && typeof props.progress === 'number' && Number.isFinite(props.progress)) {
    return base.includes('%') ? base : `${base} ${normalizedProgress.value}%`;
  }
  if (props.state === 'failed' && props.reason?.trim()) {
    return `${base}：${props.reason.trim()}`;
  }
  if (props.state === 'unknown' && !raw) {
    return '— · 未探明';
  }
  return base;
});

const tooltipText = computed<string | undefined>(() => {
  if (props.reason?.trim()) {
    return `${displayText.value} (${props.reason.trim()})`;
  }
  return undefined;
});
</script>

<style scoped>
.ob-state {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 12px;
  line-height: 1.25;
  font-weight: 600;
  white-space: nowrap;
  border: 1px solid var(--rac-dim);
  color: var(--rac-text);
  background: transparent;
}

.ob-state--draft {
  border-style: dashed;
  border-color: var(--rac-dim);
  color: var(--rac-muted);
  background: transparent;
}

.ob-state--sent {
  border-style: solid;
  border-color: var(--rac-line);
  color: var(--rac-text);
  background: transparent;
}

.ob-state--live {
  border-style: solid;
  border-color: var(--rac-hi);
  background: var(--rac-hi);
  color: var(--rac-bg);
}

.ob-state--building {
  padding-left: 9px;
  border-style: solid;
  border-color: var(--rac-line);
  color: var(--rac-hi);
  background: var(--rac-panel-2);
}

.ob-state__bar {
  position: absolute;
  left: 2px;
  top: 2px;
  bottom: 2px;
  width: 2px;
  background: var(--rac-dim);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
}

.ob-state__bar-fill {
  width: 100%;
  background: var(--rac-line);
}

.ob-state--failed {
  border-style: solid;
  border-color: var(--rac-alert);
  color: var(--rac-alert);
  background-image: var(--rac-hatch-alert);
}

.ob-state--unknown {
  border-style: solid;
  border-color: var(--rac-dim);
  color: var(--rac-muted);
  background-image: var(--rac-hatch-dim);
}

.ob-state--depleted {
  border-style: solid;
  border-color: color-mix(in srgb, var(--rac-alert) 55%, transparent);
  color: var(--rac-alert);
  background: transparent;
}

.ob-state--offline {
  border-style: dashed;
  border-color: color-mix(in srgb, var(--rac-warn) 65%, transparent);
  color: var(--rac-warn);
  background: transparent;
}

.ob-state__text--strike {
  text-decoration: line-through;
}
</style>
