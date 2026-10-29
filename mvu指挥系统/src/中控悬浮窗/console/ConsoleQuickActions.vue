<template>
  <div
    class="ra-quick-actions grid gap-1.5 p-1.5 select-none"
    :class="showEngineeringEntry ? 'grid-cols-3' : 'grid-cols-2'"
    @pointerdown.stop
  >
    <!-- 左键：【科技】(原维修按钮位置) -->
    <button
      class="ra-action-card ra-action-card--tech relative flex items-center gap-2 rounded-[2px] p-1.5 text-left transition-all"
      :class="{ 'ra-action-card--active': activeModal === 'tech' }"
      aria-label="打开科研与条令中心"
      :title="`科研中心：科技研发与统帅部条令（${activeResearchText}）`"
      :disabled="preLaunchLocked"
      @click="$emit('open-modal', 'tech')"
    >
      <div class="ra-action-icon ra-action-icon--tech flex size-7 flex-none items-center justify-center rounded-[2px]">
        <Icon name="flask" :size="14" />
      </div>
      <div class="flex min-w-0 flex-col justify-center gap-0.5">
        <span class="truncate text-[13px] leading-[1.15] font-bold tracking-wider text-(--rac-hi)">科技</span>
        <span class="ra-action-en ra-action-en--tech ob-num truncate font-mono text-[11px] leading-none tracking-[0.14em]">
          TECH
        </span>
      </div>
      <!-- 可实验/可突破协议计数徽标（PRT-UI-01：过滤 status === 'available' || status === 'experimenting'） -->
      <span
        v-if="!preLaunchLocked && protocolReadyCount > 0"
        class="ra-action-count ob-num rounded-[2px] bg-(--rac-hi) px-1 font-mono text-[11px] font-bold text-(--rac-bg)"
        data-protocol-ready-count
        :data-count="protocolReadyCount"
        :title="`可实验/攻关中协议 ${protocolReadyCount} 项`"
      >
        {{ protocolReadyCount }}
      </span>
    </button>

    <!-- FPS键：【工程】（D20 快捷动作区入口 + 进行中计数徽标；ENG-UI-01；生产环境默认隐藏，DEV 调试模式开启时显示） -->
    <button
      v-if="showEngineeringEntry"
      class="ra-action-card ra-action-card--eng relative flex items-center gap-2 rounded-[2px] p-1.5 text-left transition-all"
      :class="{ 'ra-action-card--active': activeModal === 'engineering' }"
      data-test="quick-action-engineering"
      aria-label="打开工程指挥"
      :title="`工程指挥：单位改装、巨构工程与天基任务（${engineeringStatusText}）`"
      :disabled="preLaunchLocked"
      @click="$emit('open-modal', 'engineering')"
    >
      <div class="ra-action-icon ra-action-icon--eng flex size-7 flex-none items-center justify-center rounded-[2px]">
        <Icon name="hammer" :size="14" />
      </div>
      <div class="flex min-w-0 flex-col justify-center gap-0.5">
        <span class="truncate text-[13px] leading-[1.15] font-bold tracking-wider text-(--rac-hi)">工程</span>
        <span class="ra-action-en ra-action-en--eng ob-num truncate font-mono text-[11px] leading-none tracking-[0.14em]">
          ENG
        </span>
      </div>
      <!-- 进行中计数徽标（读 snapshot.projects 过滤 status==='在建'） -->
      <span
        v-if="!preLaunchLocked && engineeringInProgress > 0"
        class="ra-action-count ob-num rounded-[2px] bg-(--rac-warn) px-1 font-mono text-[11px] font-bold text-(--rac-bg)"
      >
        {{ engineeringInProgress }}
      </span>
    </button>

    <!-- 右键：【军备 / 机娘】(原变卖按钮位置，ARM-03 升级为四维军备管理) -->
    <button
      class="ra-action-card ra-action-card--mecha flex items-center gap-2 rounded-[2px] p-1.5 text-left transition-all"
      :class="{ 'ra-action-card--active': activeModal === 'mecha' }"
      aria-label="打开军备与机娘编成"
      :title="`军备管理：机娘档案、驻军兵力、载具空军与库存装备（${mechaStatusText}）`"
      :disabled="preLaunchLocked"
      @click="$emit('open-modal', 'mecha')"
    >
      <div class="ra-action-icon ra-action-icon--mecha flex size-7 flex-none items-center justify-center rounded-[2px]">
        <Icon name="forces" :size="14" />
      </div>
      <div class="flex min-w-0 flex-col justify-center gap-0.5">
        <span class="truncate text-[13px] leading-[1.15] font-bold tracking-wider text-(--rac-hi)">军备</span>
        <span class="ra-action-en ra-action-en--mecha ob-num truncate font-mono text-[11px] leading-none tracking-[0.14em]">
          MECHA
        </span>
      </div>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import type { ProtocolDefinitionLike } from '../../红警指挥系统/engines/protocolEngine';
import type { Schema } from '../../红警指挥系统/core/schema';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import { debugState } from '../../红警指挥系统/composables/useDebugMode';
import { countExperimentableProtocols } from '../models/protocolCommands';
import type { ProtocolCommandStateView } from '../models/protocolCommands';

const props = withDefaults(
  defineProps<{
    snapshot: Schema | null;
    activeModal: string | null;
    preLaunchLocked?: boolean;
    showEngineering?: boolean;
  }>(),
  {
    showEngineering: undefined,
  },
);

defineEmits<{
  (e: 'open-modal', modal: 'tech' | 'mecha' | 'engineering'): void;
}>();

const showEngineeringEntry = computed<boolean>(() =>
  typeof props.showEngineering === 'boolean' ? props.showEngineering : Boolean(debugState.enabled),
);

const catalog = useCatalogStore();

/** 可实验/可突破协议计数（D-P14b / PRT-UI-01 / PRT-UI-03：统计 available / experimenting、对口实验室在线且协议点与资金足额的协议数） */
const protocolReadyCount = computed(() => {
  if (props.preLaunchLocked) return 0;
  const source = catalog as unknown as {
    protocols?: readonly ProtocolDefinitionLike[];
    effectiveCatalog?: { protocols?: readonly ProtocolDefinitionLike[] };
  };
  const defs = source?.effectiveCatalog?.protocols ?? source?.protocols ?? [];
  return countExperimentableProtocols(props.snapshot as ProtocolCommandStateView | null, defs);
});

/** 进行中工程计数（D20：snapshot.projects 过滤 status==='在建'；projects 为 optional 根数组） */
const engineeringInProgress = computed(() => {
  if (props.preLaunchLocked) return 0;
  return (props.snapshot?.projects ?? []).filter(p => p.status === '在建').length;
});

/** 工程入口副标题：在建数或空态 */
const engineeringStatusText = computed(() => {
  if (props.preLaunchLocked) return '待开局解锁';
  if (!props.snapshot) return '离线';
  return engineeringInProgress.value > 0 ? `在建 ${engineeringInProgress.value} 项` : '空闲中';
});

/** 当前正在研发的科技，或已研发数 */
const activeResearchText = computed(() => {
  if (props.preLaunchLocked) return '待开局解锁';
  if (!props.snapshot) return '离线';
  const researchQueue = props.snapshot.queues.find(q => q.type === '研究');
  if (researchQueue) {
    return `${researchQueue.item} ${researchQueue.progress}%`;
  }
  const doneCount = props.snapshot.tech.done.length;
  return doneCount > 0 ? `已攻克 ${doneCount} 项` : '序列待命';
});

/** 四维军备与机娘编成简报（ARM-03） */
const mechaStatusText = computed(() => {
  if (props.preLaunchLocked) return '待开局解锁';
  if (!props.snapshot) return '离线';
  const girls = props.snapshot.forces.girls ?? [];
  const vehicleCount = Object.values(props.snapshot.forces.vehicles ?? {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  if (girls.length > 0) {
    return `${girls.length} 机娘 // ${vehicleCount} 载具`;
  }
  return vehicleCount > 0 ? `载具 ${vehicleCount} // 兵装在线` : '军备在线';
});
</script>

<style scoped>
.ra-quick-actions {
  background: var(--rac-panel);
  border-bottom: 1px solid var(--rac-dim);
}

.ra-action-card {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--rac-accent) 8%, var(--rac-panel-2)) 0%,
    var(--rac-panel) 100%
  );
  border: 1px solid color-mix(in srgb, var(--rac-accent) 26%, var(--rac-dim));
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 18%, transparent);
  transition:
    background 0.16s ease-out,
    border-color 0.16s ease-out,
    box-shadow 0.16s ease-out;
  min-height: 44px;
}

.ra-action-card:hover:not(:disabled),
.ra-action-card--active {
  border-color: var(--rac-accent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--rac-accent) 20%, var(--rac-panel-2)) 0%,
    color-mix(in srgb, var(--rac-accent) 8%, var(--rac-panel)) 100%
  );
  box-shadow:
    inset 0 -2px 0 var(--rac-accent),
    0 0 10px color-mix(in srgb, var(--rac-accent) 18%, transparent);
}

.ra-action-card:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.ra-action-card:focus-visible {
  outline: 1px solid var(--rac-focus);
  outline-offset: 1px;
}

.ra-action-icon {
  background: color-mix(in srgb, var(--rac-accent) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--rac-accent) 32%, var(--rac-dim));
  color: color-mix(in srgb, var(--rac-accent) 80%, var(--rac-hi));
  transition:
    background 0.16s ease-out,
    border-color 0.16s ease-out,
    color 0.16s ease-out;
}

.ra-action-en {
  font-family: var(--rac-font-num);
  font-variant-numeric: tabular-nums;
  color: var(--rac-muted);
}

.ra-action-card:hover:not(:disabled) .ra-action-icon,
.ra-action-card.ra-action-card--active .ra-action-icon {
  background: color-mix(in srgb, var(--rac-accent) 26%, var(--rac-bg));
  border-color: var(--rac-accent);
  color: var(--rac-hi);
}

.ra-action-card:hover:not(:disabled) .ra-action-en {
  color: var(--rac-text);
}

.ra-action-card.ra-action-card--active .ra-action-en {
  color: var(--rac-accent);
}

/* 进行中计数徽标：右上角钉位，复用 patches 计数视觉（D20） */
.ra-action-count {
  position: absolute;
  top: -4px;
  right: -4px;
  line-height: 1.3;
  font-family: var(--rac-font-num);
  font-variant-numeric: tabular-nums;
}

.ra-action-badge {
  line-height: 1;
  padding: 1px 2px;
  background: var(--rac-bg);
  border-radius: 2px;
  color: var(--rac-muted);
  font-size: 11px;
  letter-spacing: 0.12em;
}

@media (prefers-reduced-motion: reduce) {
  .ra-action-card,
  .ra-action-icon {
    transition: none !important;
  }
}
</style>
