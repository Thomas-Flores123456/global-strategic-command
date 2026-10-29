<template>
  <header class="ra-top-nav flex flex-col gap-1.5 px-2 py-1.5 select-none" @pointerdown="onDragStart">
    <!-- 第一层（系统铭牌与工具条）：左侧战区控制台标识 + 实时楼层号；右侧 PDA 召回 + 刷新 + 设置（单行紧凑不折行） -->
    <div class="ra-top-nav__sysbar flex items-center justify-between gap-1.5">
      <div class="pointer-events-none flex min-w-0 items-center gap-1.5 overflow-hidden">
        <span
          class="ra-faction-plate shrink-0 font-mono text-[11px] font-bold tracking-[0.12em]"
          data-test="topnav-faction-plate"
          :title="busy ? `CONSOLE · ${factionBadgeLabel} · 同步中` : `CONSOLE · ${factionBadgeLabel} · 中控就绪`"
        >
          <span
            class="ra-sys-dot size-1.5 shrink-0 rounded-full"
            :class="busy ? 'animate-ping bg-[var(--rac-warn)]' : 'bg-[var(--rac-accent)]'"
          />
          <span>{{ factionBadgeLabel }}</span>
        </span>
        <span v-if="floorId !== null" class="ra-floor-pill shrink-0 font-mono text-[11px] font-bold">
          #{{ floorId }}
        </span>
        <span
          v-if="preLaunchLocked"
          class="ra-prelaunch-pill truncate font-mono text-[11px] font-bold"
          data-test="topnav-prelaunch-badge"
          title="尚未完成开局部署，战术模块暂未解锁"
        >
          PRE-LAUNCH · 待开局
        </span>
        <span
          v-if="debugState.enabled"
          class="ra-dev-pill pointer-events-auto shrink-0 cursor-pointer font-mono text-[11px] font-bold"
          data-test="topnav-dev-badge"
          title="点击打开全链路数据流转监控台 (DEV)"
          @pointerdown.stop
          @click="$emit('open-modal', 'dataflow')"
        >
          <Icon name="bug" :size="12" /> DEV
        </span>
      </div>

      <div class="flex shrink-0 items-center gap-1" @pointerdown.stop>
        <button
          type="button"
          class="ra-nav-btn ra-sys-btn ra-sys-btn--pda flex shrink-0 items-center gap-1 rounded-[3px] px-2 py-0.5 whitespace-nowrap transition-colors"
          aria-label="召回战地手持板 PDA"
          :title="preLaunchLocked ? '请先完成开局部署后再解锁此面板' : '将战地终端 PDA 移回屏幕中央并展开'"
          :disabled="preLaunchLocked"
          data-test="topnav-pda-recall"
          data-testid="topnav-pda-recall"
          @click="onRecallPda"
        >
          <Icon name="pda" :size="12" />
          <span class="font-mono text-[11px] font-bold tracking-wider">PDA</span>
        </button>

        <button
          type="button"
          class="ra-icon-btn shrink-0"
          aria-label="刷新数据"
          title="刷新楼层快照数据"
          :disabled="busy"
          @click="$emit('refresh')"
        >
          <Icon name="refresh" :size="11" :class="{ 'animate-spin': busy }" />
        </button>

        <button
          v-if="hasUpdateAlert"
          type="button"
          class="ra-update-pill flex shrink-0 items-center gap-1 rounded-[3px] border px-2 py-0.5 font-mono text-[11px] font-bold whitespace-nowrap transition-colors"
          :class="[
            hasBreakingUpdate
              ? 'border-[var(--warn)] bg-[var(--rac-panel-2)] text-[var(--warn)]'
              : 'border-[var(--rac-accent)] bg-[var(--rac-panel-2)] text-[var(--rac-hi)]',
            { 'ra-update-pill--active': activeModal === 'card-update' },
          ]"
          :title="
            hasBreakingUpdate
              ? '检测到含存档结构升级的角色卡新版本，点击备份并更新'
              : '检测到角色卡新版本，点击查看更新日志'
          "
          data-test="topnav-card-update-pill"
          data-testid="topnav-card-update-pill"
          @click="$emit('open-modal', 'card-update')"
        >
          <template v-if="hasBreakingUpdate">★ 新版 {{ latestVersionLabel || '需备份' }}</template>
          <template v-else>◆ 新版 {{ latestVersionLabel }}</template>
        </button>

        <button
          type="button"
          class="ra-nav-btn ra-sys-btn ra-top-bar__settings relative flex shrink-0 items-center gap-1 rounded-[3px] px-2 py-0.5 whitespace-nowrap transition-colors"
          :class="{ 'ra-nav-btn--active': activeModal === 'settings' }"
          aria-label="打开控制台设置"
          title="控制台环境选项"
          @click="$emit('open-modal', 'settings')"
        >
          <Icon name="gear" :size="11" class="shrink-0 text-[var(--rac-muted)]" />
          <span class="text-[12px] font-bold tracking-wider">设置</span>
          <span
            v-if="pendingPatchesCount && pendingPatchesCount > 0"
            class="ra-settings-badge"
            data-test="settings-patches-badge"
            :title="`${pendingPatchesCount} 项待审数据补丁`"
          >{{ pendingPatchesCount }}</span>
        </button>
      </div>
    </div>

    <!-- 第二层（战略态势双指标栏）：暴露度 EL 等级胶囊 + 民心五阶胶囊（两列等宽对称排布，告别阶梯折行） -->
    <div class="ra-top-nav__metrics pointer-events-none grid grid-cols-2 gap-1.5" data-test="topnav-metrics-row">
      <!-- 暴露度 EL 等级胶囊（FD-36 · PKG-C） -->
      <span
        class="ra-metric-pill flex min-w-0 items-center justify-center gap-1 truncate rounded-[2px] border px-2 py-1 font-mono text-[11px] leading-none font-bold"
        :class="exposurePillClass"
        :title="exposureTooltip"
        :data-exposure-level="exposureInfo.code"
        data-test="topnav-exposure-pill"
        data-testid="topnav-exposure-pill"
      >
        <Icon name="eye" :size="11" class="shrink-0 opacity-80" />
        <span class="truncate">暴露 {{ exposureValueText }} · {{ exposureInfo.code }}</span>
      </span>

      <!-- 民心五阶指数胶囊（FD-36 · PKG-C） -->
      <span
        class="ra-metric-pill flex min-w-0 items-center justify-center gap-1 truncate rounded-[2px] border px-2 py-1 font-mono text-[11px] leading-none font-bold"
        :class="moralePillClass"
        :title="moraleTooltip"
        :data-morale-stage="moraleInfo.stage"
        data-test="topnav-morale-pill"
        data-testid="topnav-morale-pill"
      >
        <span class="truncate">{{
          moraleInfo.stage === '无人在意' ? '民心 · 无人在意' : `民心 ${moraleValueText} · ${moraleInfo.stage}`
        }}</span>
      </span>
    </div>

    <!-- 第三层（4 等宽情报与内政主导航）：【档案】【日程】【资源】【建筑】水平舒展单行排列 -->
    <div class="ra-top-nav__grid grid grid-cols-4 gap-1.5" @pointerdown.stop>
      <button
        type="button"
        class="ra-nav-btn flex items-center justify-center gap-1.5 rounded-[3px] px-1.5 py-1 whitespace-nowrap transition-colors"
        :class="{ 'ra-nav-btn--active': activeModal === 'archive' }"
        aria-label="打开战况档案"
        :title="preLaunchLocked ? '请先完成开局部署后再解锁此面板' : '战况档案：查阅历史记录与世界书词条'"
        :disabled="preLaunchLocked"
        @click="$emit('open-modal', 'archive')"
      >
        <Icon name="archive" :size="11" class="shrink-0 text-[var(--rac-accent)]" />
        <span class="text-[12px] font-bold tracking-wider">档案</span>
      </button>

      <!-- 工程日程面板（CTRL-UI-SCHEDULE-01；与注入文本同源，含时钟/槽板/产线板） -->
      <button
        type="button"
        class="ra-nav-btn flex items-center justify-center gap-1.5 rounded-[3px] px-1.5 py-1 whitespace-nowrap transition-colors"
        :class="{ 'ra-nav-btn--active': activeModal === 'schedule' }"
        aria-label="打开工程日程"
        :title="preLaunchLocked ? '请先完成开局部署后再解锁此面板' : '工程日程：查看各基地建造、生产与科研进度'"
        :disabled="preLaunchLocked"
        @click="$emit('open-modal', 'schedule')"
      >
        <Icon name="calendar" :size="11" class="shrink-0 text-[var(--rac-accent)]" />
        <span class="text-[12px] font-bold tracking-wider">日程</span>
      </button>

      <!-- 资源六柱与资金条面板（CTRL-UI-RES-01；只读消费 economy 切片，三态语义钉死） -->
      <button
        type="button"
        class="ra-nav-btn flex items-center justify-center gap-1.5 rounded-[3px] px-1.5 py-1 whitespace-nowrap transition-colors"
        :class="{ 'ra-nav-btn--active': activeModal === 'resources' }"
        aria-label="打开战略资源"
        :title="preLaunchLocked ? '请先完成开局部署后再解锁此面板' : '战略资源：查看资金收支、物资库存与暗网交易'"
        :disabled="preLaunchLocked"
        @click="$emit('open-modal', 'resources')"
      >
        <Icon name="credits" :size="11" class="shrink-0 text-[var(--rac-accent)]" />
        <span class="text-[12px] font-bold tracking-wider">资源</span>
      </button>

      <button
        type="button"
        class="ra-nav-btn relative flex items-center justify-center gap-1.5 rounded-[3px] px-1.5 py-1 whitespace-nowrap transition-colors"
        :class="{ 'ra-nav-btn--active': activeModal === 'buildings' }"
        aria-label="打开基地建筑"
        :title="preLaunchLocked ? '请先完成开局部署后再解锁此面板' : '基地建筑：查看各基地设施状态与建造蓝图'"
        :disabled="preLaunchLocked"
        @click="$emit('open-modal', 'buildings')"
      >
        <Icon name="base" :size="12" class="text-[var(--rac-accent)]" />
        <span class="text-[12px] font-bold tracking-wider">建筑</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { getActivePinia } from 'pinia';
import { computed } from 'vue';
import { useDataStore } from '../../红警指挥系统/composables/store';
import { debugState } from '../../红警指挥系统/composables/useDebugMode';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import {
  computeExposureFloor,
  isMoraleEngaged,
  resolveExposureLevel,
  resolveMoraleStage,
} from '../../红警指挥系统/engines/exposureMoraleEngine';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { ui } from '../../红警指挥系统/ui/ui';
import { recallPdaToCenter, type PdaShell } from '../pda/pdaState';

export interface TopNavExposureLike {
  value?: number;
  floor?: number;
  level?: string;
  trend?: string;
  last_change?: string;
}

export interface TopNavMoraleLike {
  value?: number;
  level?: string;
  trend?: string;
  last_change?: string;
}

const props = defineProps<{
  floorId: number | null;
  busy: boolean;
  collapsed?: boolean;
  activeModal: string | null;
  pendingPatchesCount?: number;
  pdaShell?: PdaShell;
  preLaunchLocked?: boolean;
  hasUpdateAlert?: boolean;
  hasBreakingUpdate?: boolean;
  latestVersionLabel?: string;
  exposure?: TopNavExposureLike | null;
  morale?: TopNavMoraleLike | null;
  snapshot?: {
    exposure?: TopNavExposureLike;
    morale?: TopNavMoraleLike;
    bases?: ReadonlyArray<{
      status?: string;
      site_type?: string;
      buildings?: ReadonlyArray<{ name?: string; layer?: string; state?: string }>;
    }>;
  } | null;
}>();

const emit = defineEmits<{
  (
    e: 'open-modal',
    modal:
      | 'archive'
      | 'settings'
      | 'patches'
      | 'schedule'
      | 'resources'
      | 'buildings'
      | 'dataflow'
      | 'card-update',
  ): void;
  (e: 'refresh'): void;
  (e: 'drag-start', evt: PointerEvent): void;
  (e: 'recall-pda'): void;
}>();

const dataStoreRef = (() => {
  try {
    const pinia = getActivePinia();
    if (!pinia) return null;
    return (useDataStore as unknown as (p?: unknown) => Record<string, unknown>)(pinia);
  } catch {
    return null;
  }
})();

const floatingStoreRef = (() => {
  try {
    const pinia = getActivePinia();
    if (!pinia) return null;
    return (useFloatingStore as unknown as (p?: unknown) => Record<string, unknown>)(pinia);
  } catch {
    return null;
  }
})();

function resolveStateRoot(): Record<string, unknown> | null {
  if (props.snapshot && typeof props.snapshot === 'object') {
    return props.snapshot as unknown as Record<string, unknown>;
  }
  const candidates: unknown[] = [];
  if (floatingStoreRef) {
    candidates.push(floatingStoreRef.snapshot);
    candidates.push(floatingStoreRef.stat);
  }
  if (dataStoreRef) {
    candidates.push(dataStoreRef.stat);
    const d = dataStoreRef.data;
    candidates.push(d && typeof d === 'object' && 'value' in (d as Record<string, unknown>) ? (d as { value?: unknown }).value : d);
    candidates.push(dataStoreRef.snapshot);
  }
  try {
    const pinia = getActivePinia() as (ReturnType<typeof getActivePinia> & { _s?: Map<string, Record<string, unknown>> }) | undefined;
    if (pinia?._s) {
      for (const s of pinia._s.values()) {
        candidates.push(s.stat);
        const sd = s.data;
        candidates.push(sd && typeof sd === 'object' && 'value' in (sd as Record<string, unknown>) ? (sd as { value?: unknown }).value : sd);
        candidates.push(s.snapshot);
      }
    }
  } catch {
    /* ignore */
  }
  for (const c of candidates) {
    if (c && typeof c === 'object') {
      return c as Record<string, unknown>;
    }
  }
  return null;
}

const rawExposure = computed<TopNavExposureLike>(() => {
  if (props.exposure && typeof props.exposure === 'object') {
    return props.exposure;
  }
  const root = resolveStateRoot();
  const exp = root?.exposure as TopNavExposureLike | undefined;
  return exp && typeof exp === 'object' ? exp : {};
});

const rawMorale = computed<TopNavMoraleLike>(() => {
  if (props.morale && typeof props.morale === 'object') {
    return props.morale;
  }
  const root = resolveStateRoot();
  const mor = root?.morale as TopNavMoraleLike | undefined;
  return mor && typeof mor === 'object' ? mor : {};
});

const exposureValue = computed<number>(() => {
  const v = rawExposure.value.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
});

const exposureFloor = computed<number>(() => {
  const f = rawExposure.value.floor;
  if (typeof f === 'number' && Number.isFinite(f)) {
    return f;
  }
  const root = resolveStateRoot();
  const bases = (root?.bases as ReadonlyArray<{
    status?: string;
    site_type?: string;
    buildings?: ReadonlyArray<{ name?: string; layer?: string; state?: string }>;
  }>) ?? [];
  return computeExposureFloor({
    bases,
    previousValue: exposureValue.value,
  });
});

const exposureInfo = computed(() => resolveExposureLevel(exposureValue.value));

const exposureValueText = computed(() => exposureValue.value.toFixed(1));
const exposureFloorText = computed(() => exposureFloor.value.toFixed(1));

const exposureTooltip = computed(() => {
  const lastChange = (rawExposure.value.last_change || '').trim();
  const changePart = lastChange ? ` | 最近事件: ${lastChange}` : '';
  return `暴露度 ${exposureValueText.value} · ${exposureInfo.value.canonicalLabel} | 常驻底线 floor: ${exposureFloorText.value}${changePart}`;
});

const exposurePillClass = computed(() => {
  switch (exposureInfo.value.code) {
    case 'EL-4':
      return 'border-(--rac-alert)/70 bg-(--rac-alert)/20 text-(--rac-alert) ob-hatch';
    case 'EL-3':
      return 'border-(--rac-alert)/55 bg-(--rac-alert)/12 text-(--rac-alert)';
    case 'EL-2':
      return 'border-(--rac-warn)/60 bg-(--rac-warn)/14 text-(--rac-warn)';
    case 'EL-1':
      return 'border-(--rac-line)/65 bg-(--rac-panel-2) text-(--rac-text)';
    case 'EL-0':
    default:
      return 'border-(--rac-ok)/55 bg-(--rac-ok)/12 text-(--rac-ok)';
  }
});

const moraleValue = computed<number>(() => {
  const v = rawMorale.value.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : 5.0;
});

const moraleEngaged = computed(() => isMoraleEngaged(rawMorale.value, exposureValue.value));
const moraleInfo = computed(() =>
  resolveMoraleStage(moraleValue.value, {
    engaged: moraleEngaged.value,
    exposureValue: exposureValue.value,
  }),
);
const moraleValueText = computed(() => moraleValue.value.toFixed(1));

const moraleTooltip = computed(() => {
  if (moraleInfo.value.stage === '无人在意') {
    return `民心状态 · 无人在意 | ${moraleInfo.value.effectSummary}`;
  }
  const lastChange = (rawMorale.value.last_change || '').trim();
  const changePart = lastChange ? ` | 最近事件: ${lastChange}` : '';
  return `民心指数 ${moraleValueText.value} · ${moraleInfo.value.stage} | ${moraleInfo.value.effectSummary}${changePart}`;
});

const moralePillClass = computed(() => {
  switch (moraleInfo.value.stage) {
    case '无人在意':
      return 'border-(--rac-dim) bg-(--rac-panel) text-(--rac-muted) border-dashed';
    case '万众一心':
      return 'border-(--rac-hi) bg-(--rac-hi)/18 text-(--rac-hi)';
    case '安居归心':
      return 'border-(--rac-ok)/60 bg-(--rac-ok)/14 text-(--rac-ok)';
    case '观望顺从':
      return 'border-(--rac-line)/65 bg-(--rac-panel-2) text-(--rac-text)';
    case '人心惶惶':
      return 'border-(--rac-warn)/60 bg-(--rac-warn)/14 text-(--rac-warn)';
    case '沸反盈天':
    default:
      return 'border-(--rac-alert)/70 bg-(--rac-alert)/18 text-(--rac-alert) ob-hatch';
  }
});

const factionBadgeLabel = computed<string>(() => {
  const theme = ui?.theme ?? 'allied';
  if (theme === 'soviet') return 'SOVIET // KREMLIN';
  if (theme === 'yuri') return 'PSICORPS // YURI';
  return 'ALLIED // EVA';
});

function onDragStart(e: PointerEvent) {
  if (e.button !== 0) return;
  emit('drag-start', e);
}

function onRecallPda() {
  if (props.preLaunchLocked) return;
  recallPdaToCenter(props.pdaShell);
  emit('recall-pda');
}

defineExpose({
  onRecallPda,
  exposureValue,
  exposureFloor,
  exposureInfo,
  moraleValue,
  moraleInfo,
});
</script>

<style scoped>
.ra-top-nav {
  position: relative;
  background-image: var(--rac-header-stripe), var(--rac-surface-tint);
  background-color: var(--rac-overlay);
  border-top: 2px solid var(--rac-accent);
  border-bottom: 1px solid var(--rac-dim);
  box-shadow: inset 0 1px 0 var(--rac-glow);
  cursor: grab;
}

.ra-top-nav::before {
  content: '';
  position: absolute;
  top: -2px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--rac-rail);
  pointer-events: none;
}

.ra-top-nav:active {
  cursor: grabbing;
}

.ra-top-nav__sysbar {
  min-height: 22px;
}

.ra-faction-plate {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border-radius: 2px;
  border: 1px solid color-mix(in srgb, var(--rac-accent) 45%, transparent);
  background: color-mix(in srgb, var(--rac-accent) 14%, var(--rac-panel-2));
  color: var(--rac-hi);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 22%, transparent);
  line-height: 1.15;
}

.ra-sys-dot {
  box-shadow: 0 0 6px var(--rac-accent);
}

.ra-floor-pill {
  padding: 1px 5px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--rac-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--rac-line) 45%, transparent);
  color: var(--rac-hi);
  line-height: 1.2;
}

.ra-dev-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--rac-warn) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--rac-warn) 55%, transparent);
  color: var(--rac-warn);
  line-height: 1.2;
}

.ra-prelaunch-pill {
  padding: 1px 5px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--rac-warn) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--rac-warn) 50%, transparent);
  color: var(--rac-warn);
  line-height: 1.2;
}

.ra-nav-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.ra-nav-btn {
  background: var(--rac-panel);
  border: 1px solid var(--rac-dim);
  color: var(--rac-text);
  font-family: inherit;
  line-height: 1;
  min-height: 26px;
  position: relative;
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 14%, transparent);
}

.ra-sys-btn {
  min-height: 22px;
}

.ra-sys-btn--pda {
  border-color: color-mix(in srgb, var(--rac-line) 65%, transparent);
  background: var(--rac-panel-2);
}

/* 适度扩展触达区，避免相邻按钮热区互相重叠 */
.ra-nav-btn::before {
  content: '';
  position: absolute;
  inset: -3px -2px;
}

.ra-nav-btn:hover {
  background: color-mix(in srgb, var(--rac-accent) 10%, var(--rac-panel-2));
  border-color: var(--rac-line);
  color: var(--rac-hi);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 24%, transparent),
    inset 0 -2px 0 color-mix(in srgb, var(--rac-accent) 55%, transparent);
}

.ra-nav-btn--active {
  background: color-mix(in srgb, var(--rac-accent) 16%, var(--rac-panel-2));
  border-color: color-mix(in srgb, var(--rac-accent) 55%, var(--rac-line));
  color: var(--rac-hi);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 28%, transparent),
    inset 0 -2px 0 var(--rac-accent);
}

.ra-nav-btn:focus-visible,
.ra-icon-btn:focus-visible,
.ra-update-pill:focus-visible {
  outline: 1px solid var(--rac-focus);
  outline-offset: 1px;
}

.ra-update-pill {
  min-height: 22px;
  line-height: 1;
  cursor: pointer;
}

.ra-update-pill:hover {
  filter: brightness(1.12);
}

.ra-update-pill--active {
  box-shadow: inset 0 -2px 0 currentColor;
}

.ra-settings-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 9999px;
  background: var(--rac-warn);
  color: var(--rac-bg);
  font-family: var(--rac-font-num);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.ra-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  border-radius: 3px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel);
  color: var(--rac-muted);
  transition: all 0.12s ease;
}

.ra-icon-btn:hover:not(:disabled) {
  color: var(--rac-hi);
  border-color: var(--rac-line);
  background: var(--rac-panel-2);
}

.ra-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
