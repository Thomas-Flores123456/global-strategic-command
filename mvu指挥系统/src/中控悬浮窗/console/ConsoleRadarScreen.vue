<template>
  <div
    ref="radarRootRef"
    class="ra-radar-screen relative flex flex-col p-2.5 overflow-hidden rounded-[3px] select-none"
  >
    <!-- 背景扫描线与雷达点阵网格 -->
    <div class="ra-radar-grid ob-dotgrid absolute inset-0 pointer-events-none" />

    <!-- 顶部状态栏：雷达连接信号与基地多选调度 -->
    <header class="relative z-10 flex items-center justify-between gap-1 mb-1.5">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="ra-radar-dot w-1.5 h-1.5 rounded-full" :class="statusDotClass" />
        <span class="ra-radar-tag ob-num uppercase tracking-[0.16em] text-[11px] text-(--rac-muted) font-mono"> RADAR MONITOR </span>
      </div>

      <!-- 多基地切选器 (多于1个在役基地时展现；退役基地不参与翻页) -->
      <div v-if="activeBases.length > 1" class="flex items-center gap-1 flex-none" @pointerdown.stop>
        <button class="ra-radar-nav-btn" aria-label="上一个基地" title="切换至上一个基地" @click="prevBase">
          <Icon name="chevron-left" :size="11" />
        </button>
        <span class="ob-num text-[11px] font-mono text-(--rac-muted) px-0.5">
          {{ activePosition + 1 }}/{{ activeBases.length }}
        </span>
        <button class="ra-radar-nav-btn" aria-label="下一个基地" title="切换至下一个基地" @click="nextBase">
          <Icon name="chevron-right" :size="11" />
        </button>
      </div>
    </header>

    <!-- 主基地信息主体区 -->
    <div class="relative z-10 flex flex-col gap-1 min-w-0">
      <!-- 基地代号战术触发器与状态 (如：北坡主基地 // 隐蔽中) -->
      <div class="relative">
        <button
          class="ra-base-trigger flex items-center justify-between w-full px-1.5 py-1 rounded-[2px] transition-all text-left"
          :class="{ 'ra-base-trigger--open': isDropdownOpen }"
          title="点击展开战术基地调度清单"
          @click="toggleDropdown"
        >
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="text-(--rac-accent) text-[11px] font-mono">◆</span>
            <h2 class="ra-base-name truncate text-[13px] font-bold tracking-wide text-(--rac-hi)">
              {{ currentBase?.name || (preLaunchLocked ? '待开局部署' : '无在役基地') }}
            </h2>
          </div>
          <div class="flex items-center gap-1.5 flex-none">
            <span class="ra-base-status text-[12px] font-mono px-1.5 py-0.5 rounded-[2px]" :class="statusBadgeClass">
              // {{ currentBase?.status || (preLaunchLocked ? '待命锁定' : plannedLocation ? 'MCV待命' : '离线') }}
            </span>
            <span v-if="bases.length > 1" class="text-[11px] text-(--rac-muted) ml-0.5 font-mono">
              {{ isDropdownOpen ? '▲' : '▼' }}
            </span>
          </div>
        </button>

        <!-- 战术基地切选下拉菜单 -->
        <div
          v-if="isDropdownOpen && bases.length > 1"
          class="ra-base-dropdown absolute top-full left-0 right-0 z-30 mt-1 p-1 rounded-[2px] border shadow-2xl space-y-0.5"
          @click.stop
        >
          <button
            v-for="entry in activeBases"
            :key="entry.base.name + entry.index"
            class="ra-base-option flex items-center justify-between w-full px-2 py-1.5 rounded-[2px] text-left transition-colors"
            :class="
              entry.index === activeIndex
                ? 'ra-base-option--active'
                : 'ra-base-option--idle'
            "
            @click="selectBase(entry.index)"
          >
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="ob-num text-[11px] font-mono opacity-70">#{{ entry.index + 1 }}</span>
              <span class="text-[12px] font-bold truncate">{{ entry.base.name }}</span>
            </div>
            <div class="flex items-center gap-2 flex-none text-[11px] font-mono">
              <span
                class="text-[12px]"
                :class="entry.base.status === '警戒' ? 'text-(--rac-warn)' : 'text-(--rac-ok)'"
                >// {{ entry.base.status }}</span
              >
              <span class="ob-num inline-flex items-center gap-0.5 text-(--rac-muted)">
                <Icon name="power" :size="11" />{{
                  (entry.base.power?.gen ?? 0) - (entry.base.power?.use ?? 0) >= 0 ? '+' : ''
                }}{{ (entry.base.power?.gen ?? 0) - (entry.base.power?.use ?? 0) }}W
              </span>
            </div>
          </button>

          <!-- CTRL-RETIRE-01：退役基地默认折叠，可展开查阅（数据保留可审计，不参与首页/翻页） -->
          <div v-if="retiredBases.length" class="border-t border-(--rac-dim) pt-0.5">
            <button
              class="flex w-full items-center justify-between rounded-[2px] px-2 py-1 text-left font-mono text-[12px] text-(--rac-muted) transition-colors hover:text-(--rac-hi)"
              :aria-expanded="isRetiredOpen"
              @click="isRetiredOpen = !isRetiredOpen"
            >
              <span>退役记录（{{ retiredBases.length }}）</span>
              <span>{{ isRetiredOpen ? '▲' : '▼' }}</span>
            </button>
            <button
              v-for="entry in isRetiredOpen ? retiredBases : []"
              :key="entry.base.name + entry.index"
              class="ra-base-option flex w-full items-center justify-between rounded-[2px] px-2 py-1.5 text-left opacity-60 transition-colors"
              :class="
                entry.index === activeIndex
                  ? 'border border-(--rac-dim) bg-(--rac-panel-2) text-(--rac-muted)'
                  : 'border border-transparent text-(--rac-muted) hover:bg-(--rac-panel-2)'
              "
              @click="selectBase(entry.index)"
            >
              <div class="flex min-w-0 items-center gap-1.5">
                <span class="ob-num font-mono text-[11px] opacity-70">#{{ entry.index + 1 }}</span>
                <span class="truncate text-[12px] line-through">{{ entry.base.name }}</span>
              </div>
              <span class="flex-none font-mono text-[12px] text-(--rac-muted)">// 废弃</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 地理坐标与位置 -->
      <div class="flex items-center gap-1 text-[12px] text-(--rac-muted) truncate">
        <Icon name="location" :size="11" class="flex-none text-(--rac-accent)" />
        <span class="truncate">{{
          currentBase?.location ||
          (preLaunchLocked
            ? '请在战区开场启动器完成部署并发射'
            : plannedLocation
              ? `拟定坐标：${plannedLocation}`
              : '坐标未标定')
        }}</span>
      </div>

      <!-- FD-34：本基地 MCV 原点三环战术雷达平面图与建筑光点投影 -->
      <div class="ra-tactical-radar-wrap flex flex-col gap-1 pt-0.5">
        <div class="flex items-center gap-2">
          <div
            data-test="radar-tactical-plot"
            class="ra-tactical-plot ob-dotgrid relative flex-none"
            title="本基地 MCV 原点 (0,0) 三环防务雷达投影"
          >
            <!-- 圆盘内部柔和旋转扫描扇面與同心环 -->
            <span class="ra-plot-sweep" />
            <span class="ra-plot-ring ra-plot-ring--outer" />
            <span class="ra-plot-ring ra-plot-ring--mid" />
            <span class="ra-plot-ring ra-plot-ring--inner" />
            <span class="ra-plot-axis ra-plot-axis--h" />
            <span class="ra-plot-axis ra-plot-axis--v" />

            <!-- 中心 (50%, 50%) MCV 原点锚点 ⊕ -->
            <button
              type="button"
              data-test="radar-mcv-origin"
              class="ra-mcv-origin"
              title="MCV 原点 (0,0)"
              @mouseenter="selectBlip('__mcv_origin__')"
              @click.stop="selectBlip('__mcv_origin__')"
            >
              ⊕
            </button>

            <!-- 建筑实时状态光点 -->
            <button
              v-for="blip in radarBlips"
              :key="blip.key"
              type="button"
              data-test="radar-building-blip"
              :data-building-name="blip.name"
              :data-ring="blip.spatial.ring"
              :data-state="blip.state"
              class="ra-building-blip"
              :class="{ 'ra-building-blip--selected': selectedBlipKey === blip.key }"
              :style="{
                left: blip.leftPct + '%',
                top: blip.topPct + '%',
                backgroundColor: blip.color,
                boxShadow: '0 0 5px ' + blip.color,
              }"
              :title="blip.titleText"
              @mouseenter="selectBlip(blip.key)"
              @click.stop="selectBlip(blip.key)"
            />
          </div>

          <!-- 右侧三环统计、图例与设施态势概要（与 76px 雷达圆盘等高四行对齐，省去底部独立行与防区冗余） -->
          <div class="flex min-w-0 flex-1 flex-col justify-between gap-0.5 font-mono text-[11px] leading-tight text-(--rac-muted)">
            <div class="ob-num flex items-center justify-between">
              <span class="text-(--rac-accent)">⊕ MCV (0,0)</span>
              <span>R:1.0km</span>
            </div>
            <div class="ob-num flex items-center justify-between">
              <span>内环:{{ ringCounts.inner }}</span>
              <span>中环:{{ ringCounts.mid }}</span>
              <span>外环:{{ ringCounts.outer }}</span>
            </div>
            <div class="flex items-center justify-between text-[11px] opacity-90">
              <span class="inline-flex items-center gap-1"><i class="ra-legend-dot bg-(--rac-ok)" />运转</span>
              <span class="inline-flex items-center gap-1"><i class="ra-legend-dot bg-(--rac-warn)" />在建</span>
              <span class="inline-flex items-center gap-1"><i class="ra-legend-dot bg-(--rac-alert)" />受损</span>
            </div>
            <div class="ob-num flex items-center justify-between border-t border-(--rac-dim)/60 pt-0.5 text-[11px]">
              <span>设施: {{ totalBuildings }} 座</span>
              <span v-if="preLaunchLocked" class="text-(--rac-warn)">EVA 链路待激活</span>
              <span v-else-if="!currentBase" class="text-(--rac-warn)">待展开 MCV</span>
              <span v-else-if="buildingUnderConst > 0" class="text-(--rac-warn)">建造中: {{ buildingUnderConst }}</span>
              <span v-else class="text-(--rac-ok)">运转就绪</span>
            </div>
          </div>
        </div>

        <!-- 选中建筑光点坐标简报栏 -->
        <div
          data-test="radar-selected-blip-info"
          class="ra-selected-blip-info truncate rounded-[2px] px-1.5 py-0.5 font-mono text-[12px]"
          :title="selectedBlipInfo"
        >
          {{ selectedBlipInfo }}
        </div>
      </div>

      <!-- 基地警报条目 (如果有警报则高亮显示) -->
      <div
        v-if="currentBase?.alerts?.length"
        class="ra-radar-alert flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-[2px] border border-(--rac-alert) text-(--rac-alert) text-[12px] truncate"
      >
        <Icon name="alert" :size="11" class="flex-none text-(--rac-alert)" />
        <span class="truncate font-mono">{{ currentBase.alerts[0] }}</span>
      </div>
    </div>

    <!-- 四角工控微裁角框标 -->
    <div class="ra-radar-corner ra-radar-corner--tl" />
    <div class="ra-radar-corner ra-radar-corner--tr" />
    <div class="ra-radar-corner ra-radar-corner--bl" />
    <div class="ra-radar-corner ra-radar-corner--br" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import type { Base } from '../../红警指挥系统/core/schema';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import {
  resolveBuildingRelativeCoord,
  type ResolvedBuildingSpatial,
} from '../../红警指挥系统/engines/buildingCoordEngine';
import {
  playTacticalStagger,
  scheduleNextFrame,
} from '../../红警指挥系统/ui/motion/useGsapMotion';

export interface RadarQueueProjectionItem {
  type?: string;
  item?: string;
  base?: string;
  status?: string;
  progress?: number;
}

export interface NormalizedRadarSector {
  name: string;
  layer: string;
  status: string;
  desc: string;
  titleText: string;
}

const props = withDefaults(
  defineProps<{
    bases?: Base[];
    activeIndex?: number;
    preLaunchLocked?: boolean;
    plannedLocation?: string;
    queues?: RadarQueueProjectionItem[];
  }>(),
  {
    bases: () => [],
    activeIndex: 0,
    preLaunchLocked: false,
    plannedLocation: '',
    queues: undefined,
  },
);

let floatingStoreRef: ReturnType<typeof useFloatingStore> | null = null;
try {
  floatingStoreRef = useFloatingStore();
} catch {
  floatingStoreRef = null;
}

const emit = defineEmits<{
  (e: 'select-base', index: number): void;
}>();

const radarRootRef = ref<HTMLElement | null>(null);
watch(
  () => props.activeIndex,
  () => {
    scheduleNextFrame(() =>
      playTacticalStagger(
        radarRootRef.value,
        '.radar-screen, .radar-meta, .radar-stat, button, div',
        { maxItems: 8, duration: 0.16 },
      ),
    );
  },
);

const isDropdownOpen = ref(false);
/** CTRL-RETIRE-01：退役记录默认折叠 */
const isRetiredOpen = ref(false);

/** CTRL-RETIRE-01：在役基地（status!=='废弃'）参与首页与翻页；退役基地仅经折叠区查阅。index 与全量 bases 对齐。 */
const activeBases = computed(() =>
  props.bases.map((base, index) => ({ base, index })).filter(entry => entry.base.status !== '废弃'),
);
const retiredBases = computed(() =>
  props.bases.map((base, index) => ({ base, index })).filter(entry => entry.base.status === '废弃'),
);

function toggleDropdown() {
  if (props.bases.length <= 1) return;
  isDropdownOpen.value = !isDropdownOpen.value;
}

function selectBase(idx: number) {
  isDropdownOpen.value = false;
  emit('select-base', idx);
}

const currentBase = computed(() => {
  if (!props.bases.length) return null;
  // CTRL-RETIRE-01：首选 activeIndex 所指；若指向退役基地则回退首个在役基地（首页不当退役展示）
  const byIndex = props.bases[props.activeIndex];
  if (byIndex && byIndex.status !== '废弃') return byIndex;
  return activeBases.value[0]?.base ?? byIndex ?? props.bases[0];
});

/** 当前基地在在役序列中的位置（翻页显示用；退役选中时按 0 处理） */
const activePosition = computed(() => {
  const pos = activeBases.value.findIndex(e => e.index === props.activeIndex);
  return pos >= 0 ? pos : 0;
});

/** FD-38：当前基地空间防区与环境工程胶囊列表 */
const currentBaseSectors = computed<NormalizedRadarSector[]>(() => {
  const base = currentBase.value as (Base & { sectors?: unknown[] }) | null;
  const rawSectors = base?.sectors;
  if (!Array.isArray(rawSectors) || rawSectors.length === 0) return [];
  const result: NormalizedRadarSector[] = [];
  for (const item of rawSectors) {
    if (typeof item === 'string') {
      const name = item.trim();
      if (!name) continue;
      result.push({
        name,
        layer: '',
        status: '正常',
        desc: '',
        titleText: `${name} · 正常`,
      });
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const name = String(rec.name ?? '').trim();
      if (!name) continue;
      const layer = String(rec.layer ?? '').trim();
      const status = String(rec.status ?? '正常').trim() || '正常';
      const desc = String(rec.desc ?? '').trim();
      const titleText = [name, layer, status, desc].filter(Boolean).join(' · ');
      result.push({ name, layer, status, desc, titleText });
    }
  }
  return result;
});

/** FD-38：视图层自动合并 currentBase.buildings 与 queues 中尚未挂入 buildings 的本基地在建建筑 */
const effectiveBuildings = computed<Base['buildings']>(() => {
  const base = currentBase.value;
  if (!base) return [];
  const baseList: Base['buildings'] = Array.isArray(base.buildings) ? [...base.buildings] : [];
  const snap = floatingStoreRef?.snapshot as
    | { value?: { queues?: RadarQueueProjectionItem[] }; queues?: RadarQueueProjectionItem[] }
    | undefined;
  const rawQueues: readonly RadarQueueProjectionItem[] =
    props.queues ?? snap?.value?.queues ?? snap?.queues ?? [];
  if (!Array.isArray(rawQueues) || rawQueues.length === 0) return baseList;

  const baseId = String(base.id ?? '').trim();
  const baseName = String(base.name ?? '').trim();
  const isSingleActiveBase = activeBases.value.length <= 1;
  const isPrimaryActiveBase = activeBases.value[0]?.base === base;

  for (const q of rawQueues) {
    if (!q || q.type !== '建造') continue;
    const st = q.status ?? 'active';
    if (st !== 'active' && st !== 'queued' && st !== 'settling') continue;
    const itemName = String(q.item ?? '').trim();
    if (!itemName) continue;

    const qBase = String(q.base ?? '').trim();
    const belongsToCurrent = !qBase
      ? isSingleActiveBase || isPrimaryActiveBase
      : qBase === baseId || qBase === baseName || (isSingleActiveBase && isPrimaryActiveBase);
    if (!belongsToCurrent) continue;

    const alreadyInBuildings = baseList.some(b => String(b?.name ?? '').trim() === itemName);
    if (alreadyInBuildings) continue;

    baseList.push({
      name: itemName,
      layer: '',
      state: '建造中',
      ...(typeof q.progress === 'number' ? { progress: q.progress } : {}),
    });
  }
  return baseList;
});

const totalBuildings = computed(() => effectiveBuildings.value.length);

const buildingUnderConst = computed(() => {
  return effectiveBuildings.value.filter(b => b.state === '建造中').length;
});

const statusDotClass = computed(() => {
  if (props.preLaunchLocked || !currentBase.value) return 'bg-(--rac-warn)';
  const status = currentBase.value?.status;
  if (status === '暴露' || status === '失守') return 'bg-(--rac-alert)';
  if (status === '警戒') return 'bg-(--rac-warn)';
  return 'bg-(--rac-ok)';
});

const statusBadgeClass = computed(() => {
  if (props.preLaunchLocked || !currentBase.value) {
    return 'bg-(--rac-panel-2) text-(--rac-warn) border border-(--rac-warn)';
  }
  const status = currentBase.value?.status;
  if (status === '暴露' || status === '失守') return 'bg-(--rac-panel-2) text-(--rac-alert) border border-(--rac-alert)';
  if (status === '警戒') return 'bg-(--rac-panel-2) text-(--rac-warn) border border-(--rac-warn)';
  return 'bg-(--rac-panel-2) text-(--rac-ok) border border-(--rac-dim)';
});

function prevBase() {
  const list = activeBases.value;
  if (list.length <= 1) return;
  const pos = list.findIndex(e => e.index === props.activeIndex);
  const nextPos = pos <= 0 ? list.length - 1 : pos - 1;
  emit('select-base', list[nextPos].index);
}

function nextBase() {
  const list = activeBases.value;
  if (list.length <= 1) return;
  const pos = list.findIndex(e => e.index === props.activeIndex);
  const nextPos = pos < 0 || pos >= list.length - 1 ? 0 : pos + 1;
  emit('select-base', list[nextPos].index);
}

export interface RadarBuildingBlip {
  key: string;
  index: number;
  name: string;
  state: string;
  layer: string;
  color: string;
  leftPct: number;
  topPct: number;
  spatial: ResolvedBuildingSpatial;
  summaryText: string;
  titleText: string;
}

function formatSignedCoordNum(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  if (rounded === 0) return '0';
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function resolveBlipStateColor(state: string): string {
  if (state === '建造中') return 'var(--rac-warn)';
  if (state === '受损') return 'var(--rac-alert)';
  if (state === '停机') return 'var(--rac-muted)';
  return 'var(--rac-ok)';
}

const radarBlips = computed<RadarBuildingBlip[]>(() => {
  const base = currentBase.value;
  const blds = effectiveBuildings.value;
  if (!base || !Array.isArray(blds) || blds.length === 0) return [];
  const baseId = base.id || base.name || 'base-0';
  return blds.map((bld, idx) => {
    const spatial = resolveBuildingRelativeCoord(bld, idx, baseId);
    const leftPct = Math.max(
      8,
      Math.min(92, Math.round((50 + (spatial.coord.x / 10) * 42) * 10) / 10),
    );
    const topPct = Math.max(
      8,
      Math.min(92, Math.round((50 - (spatial.coord.y / 10) * 42) * 10) / 10),
    );
    const state = bld.state || '运转';
    const layer = bld.layer || '地表层';
    const color = resolveBlipStateColor(state);
    const coordPair = `(${formatSignedCoordNum(spatial.coord.x)},${formatSignedCoordNum(spatial.coord.y)})`;
    const bearingCn =
      spatial.ring === 'core' || spatial.distanceMeters === 0
        ? `MCV原点 ${coordPair}`
        : `${spatial.compassCn}·${spatial.distanceMeters}m ${coordPair}`;
    const summaryText = `◆ ${bld.name} ｜ ${bearingCn} ｜ ${spatial.ringLabel}`;
    const titleText = `${bld.name} ｜ ${bearingCn} ｜ ${spatial.ringLabel} · ${layer} · ${state}`;
    return {
      key: `${baseId}::${bld.name}::${idx}`,
      index: idx,
      name: bld.name,
      state,
      layer,
      color,
      leftPct,
      topPct,
      spatial,
      summaryText,
      titleText,
    };
  });
});

const ringCounts = computed(() => {
  let inner = 0;
  let mid = 0;
  let outer = 0;
  for (const b of radarBlips.value) {
    if (b.spatial.ring === 'inner') inner++;
    else if (b.spatial.ring === 'outer') outer++;
    else if (b.spatial.ring === 'mid') mid++;
  }
  return { inner, mid, outer };
});

const selectedBlipKey = ref<string>('');

watch(
  () => currentBase.value?.id ?? currentBase.value?.name,
  () => {
    selectedBlipKey.value = '';
  },
);

function selectBlip(key: string) {
  selectedBlipKey.value = key;
}

const selectedBlipInfo = computed<string>(() => {
  if (selectedBlipKey.value === '__mcv_origin__') {
    const coreBlip = radarBlips.value.find(b => b.spatial.ring === 'core');
    if (coreBlip) return coreBlip.summaryText;
    return '◆ MCV 原点 ｜ MCV原点 (0,0) ｜ 核心';
  }
  if (selectedBlipKey.value) {
    const found = radarBlips.value.find(b => b.key === selectedBlipKey.value);
    if (found) return found.summaryText;
  }
  const defaultNonCore = radarBlips.value.find(b => b.spatial.ring !== 'core');
  if (defaultNonCore) return defaultNonCore.summaryText;
  if (radarBlips.value[0]) return radarBlips.value[0].summaryText;
  return '◆ MCV 原点 ｜ MCV原点 (0,0) ｜ 核心';
});

defineExpose({
  radarBlips,
  selectedBlipKey,
  selectedBlipInfo,
  selectBlip,
});
</script>

<style scoped>
.ra-radar-screen {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--rac-accent) 10%, var(--rac-panel)) 0%,
    var(--rac-panel) 100%
  );
  border: 1px solid color-mix(in srgb, var(--rac-accent) 32%, var(--rac-dim));
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 22%, transparent);
  position: relative;
  margin: 8px;
}

/* 战术雷达画布点阵网格 */
.ra-radar-grid {
  background-image: radial-gradient(var(--rac-dot) 1px, transparent 1.2px);
  background-size: 16px 16px;
  opacity: 0.75;
}

/* 圆形雷达盘内部柔和旋转扫描扇面（随阵营 --rac-accent 呈现冰蓝/赤红/灵能紫光学扫描）
   顺时针旋转时，360deg 为前沿亮扫描线（Leading Edge），向后（逆时针 290deg~360deg）渐隐为余晖拖尾 */
.ra-plot-sweep,
.ra-radar-sweep {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    transparent 290deg,
    color-mix(in srgb, var(--rac-accent) 7%, transparent) 305deg,
    color-mix(in srgb, var(--rac-accent) 32%, transparent) 356deg,
    color-mix(in srgb, var(--rac-accent) 75%, var(--rac-hi)) 360deg
  );
  pointer-events: none;
  will-change: transform;
  animation: ra-plot-spin 4s linear infinite;
}

@keyframes ra-plot-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

@keyframes ra-sweep {
  from { transform: translateX(-100%); }
  to   { transform: translateX(100%); }
}

@media (prefers-reduced-motion: reduce) {
  .ra-plot-sweep,
  .ra-radar-sweep,
  .ra-building-blip,
  .ra-base-option {
    animation: none !important;
    transition: none !important;
  }
  .ra-plot-sweep,
  .ra-radar-sweep {
    opacity: 0.35;
  }
}

.ra-radar-nav-btn {
  padding: 1px 4px;
  color: var(--rac-muted);
  border-radius: 2px;
  background: var(--rac-panel);
  border: 1px solid var(--rac-dim);
  line-height: 1;
  min-height: 22px;
  position: relative;
}
.ra-radar-nav-btn::before {
  content: '';
  position: absolute;
  inset: -8px -4px;
}

.ra-radar-nav-btn:hover {
  color: var(--rac-hi);
  border-color: var(--rac-line);
  background: var(--rac-panel-2);
}

.ra-radar-nav-btn:focus-visible {
  outline: 1px solid var(--rac-focus);
  outline-offset: 1px;
}

.ra-base-trigger {
  background: color-mix(in srgb, var(--rac-accent) 8%, var(--rac-panel-2));
  border: 1px solid color-mix(in srgb, var(--rac-accent) 28%, var(--rac-dim));
  border-left: 2px solid var(--rac-accent);
  cursor: pointer;
}

.ra-base-trigger:hover,
.ra-base-trigger--open {
  background: color-mix(in srgb, var(--rac-accent) 14%, var(--rac-panel-2));
  border-color: color-mix(in srgb, var(--rac-accent) 55%, var(--rac-line));
  border-left: 2px solid var(--rac-accent);
}

.ra-base-option {
  background: transparent;
  border: 1px solid transparent;
  color: var(--rac-text);
  cursor: pointer;
  transition: all 0.16s ease-out;
}

.ra-base-option--active {
  background: color-mix(in srgb, var(--rac-accent) 12%, transparent);
  border-color: var(--rac-accent);
  color: var(--rac-accent);
}

.ra-base-option--idle:hover {
  background: var(--rac-panel-2);
  border-color: var(--rac-dim);
}

/* 四角装饰框（对标 sim.html .radar .corner，混入阵营色）*/
.ra-radar-corner {
  position: absolute;
  width: 8px;
  height: 8px;
  pointer-events: none;
  border-color: color-mix(in srgb, var(--rac-accent) 75%, var(--rac-hi));
}
.ra-radar-corner--tl {
  top: -1px;
  left: -1px;
  border-top: 1px solid;
  border-left: 1px solid;
}
.ra-radar-corner--tr {
  top: -1px;
  right: -1px;
  border-top: 1px solid;
  border-right: 1px solid;
}
.ra-radar-corner--bl {
  bottom: -1px;
  left: -1px;
  border-bottom: 1px solid;
  border-left: 1px solid;
}
.ra-radar-corner--br {
  bottom: -1px;
  right: -1px;
  border-bottom: 1px solid;
  border-right: 1px solid;
}

.ra-base-dropdown {
  background: var(--rac-panel);
  border: 1px solid var(--rac-line);
}

.ra-tactical-plot {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--rac-accent) 22%, var(--rac-bg)) 0%,
    color-mix(in srgb, var(--rac-line) 12%, var(--rac-bg)) 52%,
    var(--rac-bg) 82%
  );
  border: 1px solid color-mix(in srgb, var(--rac-accent) 55%, var(--rac-line));
  box-shadow:
    0 0 12px color-mix(in srgb, var(--rac-accent) 18%, transparent),
    inset 0 0 10px color-mix(in srgb, var(--rac-accent) 16%, transparent);
  overflow: hidden;
}
.ra-plot-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 1px dashed color-mix(in srgb, color-mix(in srgb, var(--rac-accent) 38%, var(--rac-line)) 50%, transparent);
  pointer-events: none;
}
.ra-plot-ring--inner {
  width: 30%;
  height: 30%;
}
.ra-plot-ring--mid {
  width: 58%;
  height: 58%;
}
.ra-plot-ring--outer {
  width: 86%;
  height: 86%;
}
.ra-plot-axis {
  position: absolute;
  background: color-mix(in srgb, color-mix(in srgb, var(--rac-accent) 38%, var(--rac-line)) 36%, transparent);
  pointer-events: none;
}
.ra-plot-axis--h {
  top: 50%;
  left: 6%;
  right: 6%;
  height: 1px;
}
.ra-plot-axis--v {
  left: 50%;
  top: 6%;
  bottom: 6%;
  width: 1px;
}
.ra-mcv-origin {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2;
  font-size: 11px;
  line-height: 1;
  color: var(--rac-accent);
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
}
.ra-building-blip {
  position: absolute;
  transform: translate(-50%, -50%);
  z-index: 3;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1px solid var(--rac-bg);
  padding: 0;
  cursor: pointer;
  transition: transform 120ms ease;
}
.ra-building-blip:hover,
.ra-building-blip--selected {
  transform: translate(-50%, -50%) scale(1.45);
  border-color: var(--rac-hi);
  z-index: 4;
}
.ra-legend-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
}
.ra-selected-blip-info {
  background: var(--rac-bg);
  border: 1px solid var(--rac-dim);
  color: var(--rac-text);
}
.ra-radar-alert {
  background: var(--rac-hatch-alert);
}
</style>
