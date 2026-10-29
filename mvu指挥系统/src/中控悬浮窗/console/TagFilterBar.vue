<template>
  <div
    class="ra-tag-filter-bar flex flex-col border-b border-[var(--rac-dim)]/40 bg-[var(--rac-panel)] text-[12px] text-[var(--rac-muted)] select-none"
  >
    <!-- ══ 搜索与快捷控制顶栏 ══ -->
    <div class="ra-filter-top flex items-center gap-1.5 p-1.5">
      <!-- 搜索框容器 -->
      <div
        class="ra-search-box flex min-w-0 flex-1 items-center rounded-[2px] border border-[var(--rac-dim)]/60 bg-[var(--rac-bg)] px-2 py-1 transition-colors focus-within:border-[var(--rac-accent)]"
      >
        <span class="mr-1.5 flex-none font-mono text-[11px] text-[var(--rac-accent)]/70">⌕</span>
        <input
          :value="searchQuery"
          type="text"
          class="ra-search-input min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[var(--rac-hi)] placeholder-[var(--rac-dim)] outline-none"
          placeholder="检索名称 / 描述 / 战术标签..."
          aria-label="战术模糊检索"
          @input="onSearchInput"
        />
        <button
          v-if="searchQuery"
          class="ra-clear-btn ml-1 px-1 font-mono text-[11px] text-[var(--rac-muted)] hover:text-[var(--rac-hi)]"
          title="清空搜索词"
          aria-label="清空搜索词"
          @click="clearSearch"
        >
          ×
        </button>
      </div>

      <!-- ◆ 仅看收藏快捷开关（仅在未开启下方紧凑状态栏时置于顶栏；开启紧凑状态栏时归位至状态胶囊行，释放搜索框宽度） -->
      <button
        v-if="!showCompactQuickBar"
        type="button"
        data-test="filter-fav-btn"
        class="ra-fav-btn flex flex-none items-center gap-0.5 rounded-[2px] border px-1.5 py-1 font-mono text-[12px] transition-all"
        :class="
          statusFilter === 'fav'
            ? 'border-[var(--rac-warn)] bg-[var(--rac-warn)]/25 font-bold text-[var(--rac-hi)]'
            : (statusCounts?.fav ?? 0) > 0
              ? 'border-[var(--rac-warn)]/45 bg-[var(--rac-bg)] text-[var(--rac-warn)] hover:border-[var(--rac-warn)]'
              : 'border-[var(--rac-dim)]/60 bg-[var(--rac-bg)] text-[var(--rac-muted)] hover:border-[var(--rac-warn)]/50 hover:text-[var(--rac-hi)]'
        "
        :title="statusFilter === 'fav' ? '当前：仅显示已收藏项目（点击恢复全部）' : '仅看已收藏的建筑与生产单位（自动全库穿透）'"
        @click="toggleFavFilter"
      >
        <span>{{ statusFilter === 'fav' ? '◆' : '◇' }}</span>
        <span>收藏</span>
        <span v-if="(statusCounts?.fav ?? 0) > 0" class="text-[11px] opacity-90">({{ statusCounts?.fav }})</span>
      </button>

      <!-- 检索范围切换：当前分类 vs 全库穿透（输入搜索词或仅看收藏时自动穿透） -->
      <button
        class="ra-scope-btn flex flex-none items-center gap-1 rounded-[2px] border px-1.5 py-1 font-mono text-[12px] transition-all"
        :class="
          effectiveScopeIsAll
            ? 'border-[var(--rac-accent)] bg-[var(--rac-accent)]/20 font-bold text-[var(--rac-accent)]'
            : 'border-[var(--rac-dim)]/60 bg-[var(--rac-bg)] text-[var(--rac-muted)] hover:text-[var(--rac-muted)]'
        "
        :title="
          effectiveScopeIsAll
            ? '当前：全库穿透检索（搜索/收藏自动穿透，点击切换范围）'
            : '当前：本分类筛选（点击切为全库穿透）'
        "
        @click="toggleScope"
      >
        <span>{{ effectiveScopeIsAll ? '【全库】' : '【本类】' }}</span>
      </button>

      <!-- 展开/收起完整标签矩阵抽屉 -->
      <button
        class="ra-matrix-toggle flex flex-none items-center gap-1 rounded-[2px] border px-1.5 py-1 font-mono text-[11px] transition-all"
        :class="
          isMatrixOpen
            ? 'border-[var(--rac-accent)] bg-[var(--rac-accent)]/30 text-[var(--rac-accent)]'
            : activeFilterCount > 0
              ? 'border-[var(--rac-warn)] bg-[var(--rac-warn)]/30 text-[var(--rac-warn)]'
              : 'border-[var(--rac-dim)]/60 bg-[var(--rac-bg)] text-[var(--rac-muted)] hover:border-[var(--rac-accent)]/40'
        "
        :title="isMatrixOpen ? '收起战术特征筛选板' : '展开战术特征筛选板'"
        @click="toggleMatrix"
      >
        <span>TAGS</span>
        <span
          v-if="activeFilterCount > 0"
          class="ra-active-badge rounded-[2px] bg-[var(--rac-warn)]/20 px-1 text-[11px] font-bold text-[var(--rac-warn)]"
        >
          {{ activeFilterCount }}
        </span>
        <span class="transform text-[11px] transition-transform" :class="{ 'rotate-180': isMatrixOpen }">▼</span>
      </button>

      <!-- 重置按钮（仅当有激活筛选时呈现） -->
      <button
        v-if="hasActiveFilters"
        class="ra-reset-btn flex-none rounded-[2px] border border-[var(--rac-alert)]/40 bg-[var(--rac-alert)]/30 px-1.5 py-1 font-mono text-[11px] text-[var(--rac-alert)] transition-all hover:bg-[var(--rac-alert)]/40"
        title="重置所有筛选与搜索条件"
        @click="resetAll"
      >
        RESET
      </button>
    </div>

    <!-- ══ 紧凑合一快捷栏：状态筛选（全部 / ◆收藏 / 在建 / 已建）+ 阵营筛选 ══ -->
    <div
      v-if="showCompactQuickBar"
      class="ra-quick-filter-row flex flex-wrap items-center justify-between gap-1 border-t border-[var(--rac-dim)]/30 bg-[var(--rac-bg)]/60 px-1.5 py-1 font-mono text-[12px]"
      data-test="build-compact-filter-row"
    >
      <!-- 左侧：状态快捷胶囊 -->
      <div class="flex flex-wrap items-center gap-1" role="group" aria-label="建造状态快捷筛选">
        <button
          type="button"
          data-test="status-pill-all"
          class="ra-status-pill rounded-[2px] border px-1.5 py-0.5 transition-all"
          :class="
            statusFilter === 'all'
              ? 'ra-status-pill--active border-[var(--rac-accent)] bg-[var(--rac-accent)]/20 font-bold text-[var(--rac-hi)]'
              : 'border-[var(--rac-dim)]/50 bg-[var(--rac-panel)] text-[var(--rac-muted)] hover:text-[var(--rac-hi)]'
          "
          @click="setStatusFilter('all')"
        >
          全部<span v-if="statusCounts" class="ml-0.5 text-[11px] opacity-70">({{ statusCounts.all }})</span>
        </button>
        <button
          type="button"
          data-test="status-pill-active"
          class="ra-status-pill inline-flex items-center rounded-[2px] border px-1.5 py-0.5 transition-all"
          :class="
            statusFilter === 'active_queue'
              ? 'ra-status-pill--active border-[var(--rac-warn)] bg-[var(--rac-warn)]/25 font-bold text-[var(--rac-warn)]'
              : 'border-[var(--rac-dim)]/50 bg-[var(--rac-panel)] text-[var(--rac-muted)] hover:text-[var(--rac-warn)]'
          "
          title="仅显示正在建造或排队生产中的项目"
          @click="setStatusFilter(statusFilter === 'active_queue' ? 'all' : 'active_queue')"
        >
          <Icon name="gear" :size="11" class="mr-0.5" />在建<span v-if="statusCounts" class="ml-0.5 text-[11px] opacity-75">({{ statusCounts.active_queue }})</span>
        </button>
        <button
          type="button"
          data-test="status-pill-built"
          class="ra-status-pill inline-flex items-center rounded-[2px] border px-1.5 py-0.5 transition-all"
          :class="
            statusFilter === 'built'
              ? 'ra-status-pill--active border-[var(--rac-ok)] bg-[var(--rac-ok)]/20 font-bold text-[var(--rac-ok)]'
              : 'border-[var(--rac-dim)]/50 bg-[var(--rac-panel)] text-[var(--rac-muted)] hover:text-[var(--rac-ok)]'
          "
          title="仅显示当前基地已建成或已有在编数量的单位"
          @click="setStatusFilter(statusFilter === 'built' ? 'all' : 'built')"
        >
          <Icon name="check" :size="11" class="mr-0.5" />已建<span v-if="statusCounts" class="ml-0.5 text-[11px] opacity-75">({{ statusCounts.built }})</span>
        </button>
        <button
          type="button"
          data-test="filter-fav-btn"
          class="ra-fav-btn ra-status-pill inline-flex items-center gap-0.5 rounded-[2px] border px-1.5 py-0.5 transition-all"
          :class="
            statusFilter === 'fav'
              ? 'ra-status-pill--active border-[var(--rac-warn)] bg-[var(--rac-warn)]/25 font-bold text-[var(--rac-hi)]'
              : (statusCounts?.fav ?? 0) > 0
                ? 'border-[var(--rac-warn)]/45 bg-[var(--rac-panel)] text-[var(--rac-warn)] hover:border-[var(--rac-warn)]'
                : 'border-[var(--rac-dim)]/50 bg-[var(--rac-panel)] text-[var(--rac-muted)] hover:border-[var(--rac-warn)]/50 hover:text-[var(--rac-hi)]'
          "
          :title="statusFilter === 'fav' ? '当前：仅显示已收藏项目（点击恢复全部）' : '仅看已收藏的建筑与生产单位（自动全库穿透）'"
          @click="toggleFavFilter"
        >
          <span>{{ statusFilter === 'fav' ? '◆' : '◇' }}</span>
          <span>收藏</span>
          <span v-if="(statusCounts?.fav ?? 0) > 0" class="text-[11px] opacity-90">({{ statusCounts?.fav }})</span>
        </button>
      </div>

      <!-- 右侧：紧凑合一阵营筛选胶囊（保留 data-test="faction-filter-bar" 与 data-faction-filter 契约） -->
      <div
        v-if="factionPills && factionPills.length > 0"
        class="ra-faction-filter-bar flex flex-wrap items-center gap-1"
        data-test="faction-filter-bar"
        role="group"
        aria-label="已解锁阵营筛选"
      >
        <button
          v-for="pill in factionPills"
          :key="pill.id"
          type="button"
          class="ra-faction-pill rounded-[2px] border border-[var(--rac-dim)] px-1.5 py-0.5 font-mono text-[12px] font-bold transition-all"
          :class="{
            'ra-faction-pill--active border-[var(--rac-accent)] bg-[var(--rac-accent)]/15 text-[var(--rac-accent)]':
              selectedFactionFilter === pill.id,
          }"
          :data-faction-filter="pill.id"
          :aria-pressed="selectedFactionFilter === pill.id"
          @click="emit('update:selectedFactionFilter', pill.id)"
        >
          {{ pill.label }}
        </button>
      </div>
    </div>

    <!-- ══ 二级战术特征抽屉（展开时呈现） ══ -->
    <div
      v-if="isMatrixOpen"
      class="ra-trait-matrix flex flex-col gap-1.5 border-t border-[var(--rac-dim)]/40 bg-[var(--rac-bg)] p-1.5"
    >
      <!-- 特征栏小标题与逻辑模式开关（AND / OR） -->
      <div class="flex items-center justify-between font-mono text-[12px] text-[var(--rac-muted)]">
        <div class="flex items-center gap-1.5">
          <span class="font-bold text-[var(--rac-accent)]">◆ 战术特征 (多选):</span>
          <span v-if="selectedTraits.length" class="text-[var(--rac-ok)]">已选 {{ selectedTraits.length }} 项</span>
        </div>
        <div class="flex items-center gap-1">
          <span class="opacity-60">模式:</span>
          <button
            class="rounded-[2px] border px-1.5 py-0.5 text-[12px] font-bold transition-all"
            :class="
              traitMatchMode === 'or'
                ? 'border-[var(--rac-accent)] bg-[var(--rac-accent)]/40 text-[var(--rac-accent)]'
                : 'border-[var(--rac-dim)]/50 text-[var(--rac-muted)] hover:text-[var(--rac-muted)]'
            "
            title="包含任一特征即可"
            @click="setTraitMatchMode('or')"
          >
            并集 OR
          </button>
          <button
            class="rounded-[2px] border px-1.5 py-0.5 text-[12px] font-bold transition-all"
            :class="
              traitMatchMode === 'and'
                ? 'border-[var(--rac-accent)] bg-[var(--rac-accent)]/40 text-[var(--rac-accent)]'
                : 'border-[var(--rac-dim)]/50 text-[var(--rac-muted)] hover:text-[var(--rac-muted)]'
            "
            title="必须同时满足所有选定特征"
            @click="setTraitMatchMode('and')"
          >
            交集 AND
          </button>
        </div>
      </div>

      <!-- 二级战术特征胶囊群 -->
      <div class="flex flex-wrap gap-1">
        <button
          v-for="trait in SECONDARY_TRAITS"
          :key="trait"
          class="ra-pill inline-flex items-center rounded-[2px] border px-1.5 py-0.5 font-mono text-[12px] transition-all"
          :class="isTraitSelected(trait) ? 'ra-pill--trait-active' : 'ra-pill--inactive'"
          @click="toggleTrait(trait)"
        >
          <Icon v-if="isTraitSelected(trait)" name="check" :size="11" class="mr-0.5 text-[var(--rac-ok)]" />
          <span>{{ trait }}</span>
          <span v-if="traitCounts?.[trait] !== undefined" class="ml-0.5 text-[11px] opacity-70"
            >({{ traitCounts[trait] }})</span
          >
        </button>
      </div>
    </div>

    <!-- ══ 激活条件摘要微条（当折叠且有生效筛选时呈现） ══ -->
    <div
      v-else-if="hasActiveFilters"
      class="ra-active-strip no-scrollbar flex items-center gap-1 overflow-x-auto border-t border-[var(--rac-dim)]/30 bg-[var(--rac-bg)]/80 px-1.5 py-1 font-mono text-[12px]"
    >
      <span class="flex-none text-[var(--rac-muted)]">生效中:</span>
      <span
        v-if="effectiveScopeIsAll"
        class="ra-tag-chip py-0.2 flex flex-none items-center gap-0.5 rounded-[2px] border border-[var(--rac-accent)]/40 bg-[var(--rac-accent)]/40 px-1 text-[var(--rac-accent)]"
      >
        <span>全库穿透</span>
        <button v-if="scope === 'all'" class="hover:text-[var(--rac-hi)]" @click="toggleScope">×</button>
      </span>
      <span
        v-if="statusFilter !== 'all'"
        class="ra-tag-chip py-0.2 flex flex-none items-center gap-0.5 rounded-[2px] border border-[var(--rac-warn)]/50 bg-[var(--rac-warn)]/20 px-1 text-[var(--rac-hi)]"
      >
        <span>{{ statusFilterLabel }}</span>
        <button class="hover:text-[var(--rac-hi)]" @click="setStatusFilter('all')">×</button>
      </span>
      <span
        v-for="trait in selectedTraits"
        :key="trait"
        class="ra-tag-chip py-0.2 flex flex-none items-center gap-0.5 rounded-[2px] border border-[var(--rac-ok)]/40 bg-[var(--rac-ok)]/20 px-1 text-[var(--rac-ok)]"
      >
        <span>{{ trait }}</span>
        <button class="hover:text-[var(--rac-hi)]" @click="toggleTrait(trait)">×</button>
      </span>
      <span
        v-if="searchQuery"
        class="ra-tag-chip py-0.2 flex flex-none items-center gap-0.5 rounded-[2px] border border-[var(--rac-warn)]/40 bg-[var(--rac-warn)]/30 px-1 text-[var(--rac-warn)]"
      >
        <span class="max-w-[80px] truncate">"{{ searchQuery }}"</span>
        <button class="hover:text-[var(--rac-hi)]" @click="clearSearch">×</button>
      </span>
      <button class="ml-auto flex-none pl-1 text-[12px] text-[var(--rac-muted)] hover:text-[var(--rac-alert)]" @click="resetAll">
        [清空]
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { SECONDARY_TRAITS } from '../models/tagTaxonomy';
import type { BuildQuickStatusCounts, BuildQuickStatusFilter } from './consoleBuildGridHelpers';

const props = withDefaults(
  defineProps<{
    searchQuery?: string;
    selectedTraits?: string[];
    traitMatchMode?: 'and' | 'or';
    scope?: 'current' | 'all';
    traitCounts?: Record<string, number>;
    statusFilter?: BuildQuickStatusFilter;
    statusCounts?: BuildQuickStatusCounts;
    factionPills?: ReadonlyArray<{ id: string; label: string }>;
    selectedFactionFilter?: string;
    showCompactQuickBar?: boolean;
    debounceMs?: number;
  }>(),
  {
    searchQuery: '',
    selectedTraits: () => [],
    traitMatchMode: 'or',
    scope: 'current',
    traitCounts: undefined,
    statusFilter: 'all',
    statusCounts: undefined,
    factionPills: undefined,
    selectedFactionFilter: 'all',
    showCompactQuickBar: false,
    debounceMs: 0,
  },
);

const emit = defineEmits<{
  (e: 'update:searchQuery', value: string): void;
  (e: 'update:selectedTraits', value: string[]): void;
  (e: 'update:traitMatchMode', value: 'and' | 'or'): void;
  (e: 'update:scope', value: 'current' | 'all'): void;
  (e: 'update:statusFilter', value: BuildQuickStatusFilter): void;
  (e: 'update:selectedFactionFilter', value: string): void;
  (e: 'reset'): void;
}>();

const isMatrixOpen = ref(false);
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function clearSearchDebounce() {
  if (searchDebounceTimer !== null) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
}

onUnmounted(() => {
  clearSearchDebounce();
});

const effectiveScopeIsAll = computed(
  () =>
    props.scope === 'all' ||
    props.searchQuery.trim().length > 0 ||
    props.statusFilter === 'fav' ||
    props.statusFilter === 'active_queue',
);

const statusFilterLabel = computed(() => {
  if (props.statusFilter === 'fav') return '◆ 收藏';
  if (props.statusFilter === 'active_queue') return '在建/排产';
  if (props.statusFilter === 'built') return '已建/在编';
  return '全部';
});

const activeFilterCount = computed(() => {
  let count = 0;
  count += props.selectedTraits.length;
  if (props.searchQuery.trim()) count++;
  if (props.scope === 'all') count++;
  if (props.statusFilter && props.statusFilter !== 'all') count++;
  if (props.selectedFactionFilter && props.selectedFactionFilter !== 'all') count++;
  return count;
});

const hasActiveFilters = computed(() => activeFilterCount.value > 0);

function onSearchInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const val = target.value;
  clearSearchDebounce();
  if (props.debounceMs > 0) {
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null;
      emit('update:searchQuery', val);
    }, props.debounceMs);
  } else {
    emit('update:searchQuery', val);
  }
}

function clearSearch() {
  clearSearchDebounce();
  emit('update:searchQuery', '');
}

function toggleScope() {
  emit('update:scope', props.scope === 'all' ? 'current' : 'all');
}

function toggleMatrix() {
  isMatrixOpen.value = !isMatrixOpen.value;
}

function isTraitSelected(trait: string): boolean {
  return props.selectedTraits.includes(trait);
}

function toggleTrait(trait: string) {
  const current = [...props.selectedTraits];
  const idx = current.indexOf(trait);
  if (idx >= 0) {
    current.splice(idx, 1);
  } else {
    current.push(trait);
  }
  emit('update:selectedTraits', current);
}

function setTraitMatchMode(mode: 'and' | 'or') {
  emit('update:traitMatchMode', mode);
}

function setStatusFilter(next: BuildQuickStatusFilter) {
  emit('update:statusFilter', next);
}

function toggleFavFilter() {
  emit('update:statusFilter', props.statusFilter === 'fav' ? 'all' : 'fav');
}

function resetAll() {
  clearSearchDebounce();
  emit('update:searchQuery', '');
  emit('update:selectedTraits', []);
  emit('update:traitMatchMode', 'or');
  emit('update:scope', 'current');
  emit('update:statusFilter', 'all');
  emit('update:selectedFactionFilter', 'all');
  emit('reset');
}
</script>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.ra-tag-filter-bar {
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 5%, var(--rac-panel)) 0%, var(--rac-panel) 100%);
  border-bottom: 1px solid color-mix(in srgb, var(--rac-accent) 22%, var(--rac-dim));
}

.ra-faction-pill {
  background: var(--rac-panel);
  border: 1px solid color-mix(in srgb, var(--rac-accent) 20%, var(--rac-dim));
  color: var(--rac-muted);
}

.ra-faction-pill:hover {
  background: color-mix(in srgb, var(--rac-accent) 12%, var(--rac-panel-2));
  border-color: color-mix(in srgb, var(--rac-accent) 55%, var(--rac-line));
  color: var(--rac-hi);
}

.ra-faction-pill--active,
.ra-status-pill--active {
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 24%, var(--rac-panel-2)) 0%, color-mix(in srgb, var(--rac-accent) 10%, var(--rac-panel)) 100%);
  border: 1px solid var(--rac-accent);
  border-color: var(--rac-accent);
  color: var(--rac-hi);
  box-shadow: inset 0 -2px 0 var(--rac-accent);
}

.ra-pill {
  line-height: 1.2;
  min-height: 24px;
  position: relative;
}
.ra-pill::before {
  content: '';
  position: absolute;
  inset: -6px -2px;
}

.ra-pill--inactive {
  background: var(--rac-panel);
  border-color: var(--rac-dim);
  color: var(--rac-muted);
}

.ra-pill--inactive:hover {
  background: color-mix(in srgb, var(--rac-accent) 10%, var(--rac-panel-2));
  border-color: color-mix(in srgb, var(--rac-accent) 45%, var(--rac-line));
  color: var(--rac-hi);
}

.ra-pill--domain-active {
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 24%, var(--rac-panel-2)) 0%, color-mix(in srgb, var(--rac-accent) 10%, var(--rac-panel)) 100%);
  border: 1px solid var(--rac-accent);
  border-color: var(--rac-accent);
  color: var(--rac-hi);
  font-weight: 700;
  box-shadow: inset 0 -2px 0 var(--rac-accent);
}

.ra-pill--trait-active {
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 24%, var(--rac-panel-2)) 0%, color-mix(in srgb, var(--rac-accent) 10%, var(--rac-panel)) 100%);
  border: 1px solid var(--rac-accent);
  border-color: var(--rac-accent);
  color: var(--rac-hi);
  font-weight: 700;
  box-shadow: inset 0 -2px 0 var(--rac-accent);
}

.ra-pill:focus-visible {
  outline: 1px solid var(--rac-focus, var(--rac-accent));
  outline-offset: 1px;
}
</style>
