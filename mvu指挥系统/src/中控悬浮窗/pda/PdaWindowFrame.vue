<template>
  <div
    ref="pdaWindowRef"
    class="pda-window-frame relative flex h-[440px] max-h-[calc(100vh-24px)] w-[320px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg border border-(--line-hot,rgba(145,201,239,0.54)) bg-(--deep-2,rgba(15,24,32,0.94)) font-mono text-xs text-(--text,#d9e5ed) shadow-2xl backdrop-blur-md select-none"
    :class="{
      'theme-allies': normalizedFaction === 'allies',
      'theme-soviet': normalizedFaction === 'soviet',
      'theme-yuri': normalizedFaction === 'yuri',
      'is-pinned': shell.state.pinned,
    }"
    :style="dynamicFrameStyle"
    :data-dock-side="shell.state.dockSide"
    :data-pinned="shell.state.pinned"
    :data-size-mode="resolvedSizeMode"
    :data-active-tab="resolvedActiveTab"
    :data-testid="'pda-window-frame'"
  >
    <!-- ══ 四角工规沉头螺栓护甲微装饰 ══ -->
    <span class="pointer-events-none absolute top-1 left-1 size-1.5 rounded-full border border-white/20 bg-black/50" />
    <span class="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full border border-white/20 bg-black/50" />
    <span
      class="pointer-events-none absolute bottom-1 left-1 size-1.5 rounded-full border border-white/20 bg-black/50"
    />
    <span
      class="pointer-events-none absolute right-1 bottom-1 size-1.5 rounded-full border border-white/20 bg-black/50"
    />

    <!-- ══ 顶栏拖拽手柄条 ══ -->
    <header
      ref="headerEl"
      class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-(--line,rgba(141,180,207,0.14)) bg-(--deep-1,rgba(7,12,17,0.9)) px-3 select-none"
      :class="shell.state.pinned ? 'cursor-default' : 'cursor-move'"
      @pointerdown="onHeaderPointerDown"
      @pointermove="onHeaderPointerMove"
      @pointerup="onHeaderPointerUp"
      @pointercancel="onHeaderPointerCancel"
    >
      <!-- 左侧终端标识与状态绿灯 -->
      <div class="pointer-events-none flex min-w-0 items-center gap-2">
        <span class="size-2 shrink-0 animate-pulse rounded-full" :style="{ backgroundColor: factionColor }" />
        <span class="truncate text-xs font-bold tracking-wider text-(--ice,#8bc3e7)">
          {{ title ?? 'PDA-MK5 // 战术终端' }}
        </span>
        <span
          class="hidden rounded-xs border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] leading-none text-(--text-3,#7a8e9a) sm:inline-block"
        >
          {{ sizeModeLabel }}
        </span>
      </div>

      <!-- 右侧控制按钮组（必须 stop 阻止拖拽冒泡，全部 whitespace-nowrap 防折行） -->
      <div class="flex shrink-0 items-center gap-1.5" @pointerdown.stop>
        <!-- 视口比例档位切换按钮（40%×60% 标准比例 ⇄ 52%×74% 宽屏展台 ⇄ 紧凑掌机） -->
        <button
          type="button"
          class="flex h-6 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-white/10 bg-white/5 px-1.5 text-[10px] leading-none font-bold whitespace-nowrap text-(--text-2,#8fa3b1) transition-colors hover:border-(--line-hot,rgba(145,201,239,0.5)) hover:bg-white/10 hover:text-(--ice,#8bc3e7) active:scale-95"
          :title="`当前尺寸档位：${sizeModeLabel}（点击切换 40%×60% 标准比例 / 52%×74% 宽屏 / 紧凑档）`"
          :data-testid="'pda-size-mode-btn'"
          @click="onCycleSizeMode"
        >
          <span>⤢ {{ sizeModeShortLabel }}</span>
        </button>

        <!-- Pin 锁按钮 -->
        <button
          type="button"
          class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm transition-colors hover:bg-white/10 active:scale-95"
          :class="shell.state.pinned ? 'bg-white/10 font-bold text-(--ice,#8bc3e7)' : 'text-(--text-3,#7a8e9a)'"
          :title="shell.state.pinned ? '已锁定位置（点击解锁）' : '未锁定位置（点击锁定防误触）'"
          :data-testid="'pda-pin-btn'"
          @click="shell.togglePin()"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="size-3.5"
            :class="{ 'rotate-45': shell.state.pinned }"
          >
            <line x1="12" y1="17" x2="12" y2="22" />
            <path d="M5 17h14v-2l-3-3V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v7l-3 3v2z" />
          </svg>
        </button>

        <!-- 一键折叠收回按钮（强制单行 whitespace-nowrap，杜绝 [ — ] 断行） -->
        <button
          type="button"
          class="flex h-6 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-white/10 bg-white/5 px-1.5 text-[11px] leading-none font-bold whitespace-nowrap text-(--text-2,#8fa3b1) transition-colors hover:bg-white/10 hover:text-white active:scale-95"
          title="折叠为战术纽扣"
          :data-testid="'pda-collapse-btn'"
          @click="shell.setCollapsed(true)"
        >
          <span class="whitespace-nowrap">[ — ]</span>
        </button>
      </div>
    </header>

    <!-- ══ 战区态势速览条（Mini HUD Strip：资金 | 电网 | 暴露度 | 战区时） ══ -->
    <div
      class="grid shrink-0 grid-cols-4 gap-1.5 border-b border-(--line,rgba(141,180,207,0.14)) bg-black/35 px-3 py-1.5 text-[11px]"
      :data-testid="'pda-telemetry-strip'"
    >
      <div class="flex items-center justify-between gap-1 rounded-xs border border-white/8 bg-white/4 px-2 py-1">
        <span class="text-[10px] whitespace-nowrap text-(--text-3,#7a8e9a)">💰 资金</span>
        <span class="truncate font-bold text-(--safe,#78b69b)">{{ telemetrySummary.creditsText }}</span>
      </div>
      <div class="flex items-center justify-between gap-1 rounded-xs border border-white/8 bg-white/4 px-2 py-1">
        <span class="text-[10px] whitespace-nowrap text-(--text-3,#7a8e9a)">⚡ 电网</span>
        <span
          class="truncate font-bold"
          :class="telemetrySummary.powerWarn ? 'text-(--alert-bright,#ff5a36)' : 'text-(--ice,#8bc3e7)'"
        >
          {{ telemetrySummary.powerText }}
        </span>
      </div>
      <div class="flex items-center justify-between gap-1 rounded-xs border border-white/8 bg-white/4 px-2 py-1">
        <span class="text-[10px] whitespace-nowrap text-(--text-3,#7a8e9a)">👁️ 暴露</span>
        <span
          class="truncate font-bold"
          :class="telemetrySummary.exposureWarn ? 'text-(--amber,#d2ad69)' : 'text-(--text,#d9e5ed)'"
        >
          {{ telemetrySummary.exposureText }}
        </span>
      </div>
      <div class="flex items-center justify-between gap-1 rounded-xs border border-white/8 bg-white/4 px-2 py-1">
        <span class="text-[10px] whitespace-nowrap text-(--text-3,#7a8e9a)">📅 战区时</span>
        <span class="truncate font-bold text-(--text,#d9e5ed)">{{ telemetrySummary.dateText }}</span>
      </div>
    </div>

    <!-- ══ 四联业务页签切换条 [ 战况动态 | 资金链网 | 战区情报 | 作战任务 ] ══ -->
    <nav
      class="flex h-8 shrink-0 items-center justify-between gap-1.5 border-b border-(--line,rgba(141,180,207,0.16)) bg-(--deep-1,rgba(7,12,17,0.92)) px-2.5"
      role="tablist"
      aria-label="战地手持板页签导航"
      :data-testid="'pda-tab-bar'"
    >
      <button
        v-for="tab in TAB_ITEMS"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="resolvedActiveTab === tab.id"
        class="flex h-6 flex-1 cursor-pointer items-center justify-center gap-1 rounded-xs border px-1.5 text-xs leading-none font-bold whitespace-nowrap transition-all active:scale-95"
        :class="
          resolvedActiveTab === tab.id
            ? 'border-(--line-hot,rgba(145,201,239,0.54)) bg-white/12 text-(--ice,#8bc3e7) shadow-[inset_0_0_8px_rgba(139,195,231,0.18)]'
            : 'border-transparent bg-transparent text-(--text-3,#7a8e9a) hover:bg-white/5 hover:text-(--text,#d9e5ed)'
        "
        :data-tab-id="tab.id"
        :data-short-label="tab.shortLabel"
        :data-active="resolvedActiveTab === tab.id"
        :data-test="`pda-tab-btn-${tab.id}`"
        :data-testid="`pda-tab-btn-${tab.id}`"
        @click="onSelectTab(tab.id)"
      >
        <span>{{ tab.label }}</span>
        <span
          v-if="tabBadgeCount(tab.id) > 0"
          class="rounded-full px-1.5 py-0.5 text-[10px] leading-none font-bold"
          :class="
            tab.id === 'events' && unreadEventCount > 0
              ? 'bg-(--alert-bright,#ff5a36)/25 text-(--alert-bright,#ff5a36)'
              : 'bg-white/10 text-(--ice,#8bc3e7)'
          "
        >
          {{ tabBadgeCount(tab.id) }}
        </span>
      </button>
    </nav>

    <!-- ══ 主体工作区（响应 shell.state.activeTab 动态切换四大业务页签，并保留默认插槽兼容） ══ -->
    <main class="relative flex flex-1 flex-col overflow-hidden" :data-testid="'pda-window-body'">
      <p v-if="loreCommitError" role="alert">{{ loreCommitError }}</p>
      <slot>
        <PdaTabEvents
          v-if="resolvedActiveTab === 'events'"
          :shell="shell"
          :snapshot="resolvedSnapshot"
          :events="liveEvents"
          :demo-mode="demoMode"
        />
        <PdaTabChains v-else-if="resolvedActiveTab === 'chains'" :snapshot="resolvedSnapshot" />
        <PdaTabIntel
          v-else-if="resolvedActiveTab === 'intel'"
          :snapshot="resolvedSnapshot"
          :memo="resolvedMemo"
          @adopt-lore="onAdoptLore"
          @save-memo="onSaveMemo"
          @toggle-pin-intel="onTogglePinIntel"
          @archive-intel-lore="onArchiveIntelLore"
        />
        <PdaTabQuests
          v-else-if="resolvedActiveTab === 'quests'"
          :snapshot="resolvedSnapshot"
          :memo="resolvedMemo"
          @save-memo="onSaveMemo"
        />
      </slot>
    </main>

    <!-- ══ 底栏辅助状态指示条 ══ -->
    <footer
      class="flex h-6 shrink-0 items-center justify-between border-t border-(--line,rgba(141,180,207,0.12)) bg-(--deep-1,rgba(7,12,17,0.9)) px-3 text-[10px] text-(--text-3,#7a8e9a)"
    >
      <span>SEC-CH: ENCRYPTED // L2 · {{ dynamicDimensionText }}</span>
      <span>TAB: {{ resolvedActiveTab.toUpperCase() }} ｜ DOCK: {{ shell.state.dockSide.toUpperCase() }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { getActivePinia } from 'pinia';
import { computed, ref, watch } from 'vue';
import {
  playTacticalStagger,
  scheduleNextFrame,
  useTacticalModalMotion,
} from '../../红警指挥系统/ui/motion/useGsapMotion';
import { isGirlDossierEntry } from '../../红警指挥系统/worldbook/girlFiler';
import { chatBookGateway } from '../../红警指挥系统/worldbook/chatBookBinding';
import { tav } from '../../红警指挥系统/parse/systemCheck';
import { confirmAndCommitPendingLore } from '../../红警指挥系统/worldbook/pendingLoreGate';
import type { Schema } from '../../红警指挥系统/core/schema';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { updateFloorVars } from '../host/floorVarWrite';
import PdaTabChains from './PdaTabChains.vue';
import PdaTabEvents from './PdaTabEvents.vue';
import type { PdaEventItem } from './PdaTabEvents.vue';
import PdaTabIntel from './PdaTabIntel.vue';
import type { NormalizedPendingLoreItem, PdaIntelItemLike } from './PdaTabIntel.vue';
import PdaTabQuests from './PdaTabQuests.vue';
import { derivePdaEventsFromSnapshot } from './notificationQueue';
import type { PdaShell, PdaSizeMode } from './pdaState';

export type PdaPrimaryTabId = 'events' | 'chains' | 'intel' | 'quests';

export interface PdaWindowFrameProps {
  shell: PdaShell;
  title?: string;
  faction?: 'allies' | 'soviet' | 'yuri' | string;
  snapshot?: (Partial<Schema> & { events?: PdaEventItem[]; memo?: string }) | null;
  events?: PdaEventItem[];
  floorId?: number | null;
  demoMode?: boolean;
}

const props = withDefaults(defineProps<PdaWindowFrameProps>(), {
  title: undefined,
  faction: 'allies',
  snapshot: undefined,
  events: undefined,
  floorId: undefined,
  demoMode: false,
});

const emit = defineEmits<{
  (e: 'tab-change', tab: PdaPrimaryTabId): void;
  (e: 'adopt-lore', item: NormalizedPendingLoreItem): void;
  (e: 'save-memo', text: string): void;
  (e: 'toggle-pin-intel', item: PdaIntelItemLike, nextPinned: boolean): void;
  (e: 'archive-intel-lore', item: PdaIntelItemLike, loreEntry: NormalizedPendingLoreItem): void;
}>();

function resolveFloating(): ReturnType<typeof useFloatingStore> | null {
  try {
    const pinia = getActivePinia() as
      | (NonNullable<ReturnType<typeof getActivePinia>> & {
          _s?: Map<string, ReturnType<typeof useFloatingStore>>;
        })
      | undefined;
    if (!pinia) return null;
    return pinia._s?.get('mvu_data.floating') ?? null;
  } catch {
    return null;
  }
}

const resolvedSnapshot = computed<(Partial<Schema> & { events?: PdaEventItem[]; memo?: string }) | null>(() => {
  if (props.snapshot !== undefined) return props.snapshot;
  const floating = resolveFloating();
  return (floating?.snapshot as (Partial<Schema> & { events?: PdaEventItem[]; memo?: string }) | null) ?? null;
});

const resolvedMemo = computed<string>(() => {
  const snap = resolvedSnapshot.value as Record<string, unknown> | null;
  return typeof snap?.memo === 'string' ? snap.memo : '';
});

/** 动态视口比例尺寸计算（默认 40% 浏览器窗口宽 × 60% 浏览器窗口高） */
const resolvedSizeMode = computed<PdaSizeMode>(() => props.shell.state.sizeMode ?? 'proportional');

const currentDynamicSize = computed(() => {
  if (typeof props.shell.dynamicSize === 'function') {
    return props.shell.dynamicSize();
  }
  return { width: 560, height: 620 };
});

const dynamicFrameStyle = computed(() => {
  const sz = currentDynamicSize.value;
  return {
    width: `${sz.width}px`,
    height: `${sz.height}px`,
  };
});

const dynamicDimensionText = computed(() => {
  const sz = currentDynamicSize.value;
  return `${sz.width}×${sz.height}px`;
});

const sizeModeShortLabel = computed(() => {
  if (resolvedSizeMode.value === 'large') return '52%×74%';
  if (resolvedSizeMode.value === 'compact') return '紧凑档';
  return '40%×60%';
});

const sizeModeLabel = computed(() => {
  if (resolvedSizeMode.value === 'large') return `宽屏展台 52%×74% (${dynamicDimensionText.value})`;
  if (resolvedSizeMode.value === 'compact') return `紧凑掌机 (${dynamicDimensionText.value})`;
  return `窗口自适应 40%×60% (${dynamicDimensionText.value})`;
});

function onCycleSizeMode() {
  props.shell.cycleSizeMode?.();
}

/** 顶栏下方战区态势速览条（Mini HUD Strip） */
const telemetrySummary = computed(() => {
  const snap = resolvedSnapshot.value;
  const credits = snap?.economy?.credits ?? 0;
  const daily = snap?.economy?.credits_daily ?? 0;
  const dailySign = daily > 0 ? `+${daily}` : `${daily}`;
  const creditsText = daily !== 0 ? `${credits} (${dailySign}/d)` : `${credits}`;

  const bases = Array.isArray(snap?.bases) ? snap!.bases : [];
  let powerOut = 0;
  let powerLoad = 0;
  for (const b of bases) {
    powerOut += Number((b as Record<string, unknown>).power_out ?? 0);
    powerLoad += Number((b as Record<string, unknown>).power_load ?? 0);
  }
  const powerWarn = powerLoad > powerOut;
  const powerText = bases.length > 0 ? `${powerOut}/${powerLoad}` : '待并网';

  const expVal = snap?.exposure?.value ?? 0;
  const expLevel = snap?.exposure?.level ?? '隐蔽';
  const exposureWarn = expVal >= 30;
  const exposureText = `${expLevel} (${expVal})`;

  const dateStr = snap?.meta?.date?.trim() || '战区初抵';
  const timeStr = snap?.meta?.time?.trim() || '';
  const dateText = timeStr ? `${dateStr.slice(5)} ${timeStr}` : dateStr;

  return {
    creditsText,
    powerText,
    powerWarn,
    exposureText,
    exposureWarn,
    dateText,
  };
});

/** 从真实 stat_data（资金链受挫/挂起/枯竭、暂存新势力、战区情报）构建动态事件列表 */
const liveEvents = computed<PdaEventItem[]>(() => {
  const raw = props.events ?? derivePdaEventsFromSnapshot(resolvedSnapshot.value);
  const readSet = new Set(props.shell.state.readEventIds);
  return raw.map(item => ({
    ...item,
    read: Boolean(item.read) || Boolean(item.id && readSet.has(item.id)),
  }));
});

const unreadEventCount = computed<number>(() => {
  return liveEvents.value.filter(e => e.id && !e.read).length;
});

function tabBadgeCount(tabId: PdaPrimaryTabId): number {
  const snap = resolvedSnapshot.value;
  if (tabId === 'events') return unreadEventCount.value;
  if (tabId === 'chains') return Array.isArray(snap?.economy?.chains) ? snap!.economy!.chains.length : 0;
  if (tabId === 'intel') {
    const pendingCount = Array.isArray(snap?.pending_lore)
      ? snap!.pending_lore.filter(e => !isGirlDossierEntry(e)).length
      : 0;
    const codexCount = Array.isArray(snap?.codex) ? snap!.codex.length : 0;
    return pendingCount > 0 ? pendingCount : codexCount;
  }
  if (tabId === 'quests') {
    return Array.isArray(snap?.quests?.active) ? snap!.quests!.active.length : 0;
  }
  return 0;
}

const loreCommitError = ref('');

async function onAdoptLore(item: NormalizedPendingLoreItem) {
  loreCommitError.value = '';
  const floating = resolveFloating();
  const currentPending = resolvedSnapshot.value?.pending_lore ?? floating?.snapshot?.pending_lore ?? [];
  const commitRes = await confirmAndCommitPendingLore(currentPending, {
    ids: [item.id],
    write: async entry => {
      const updateBook = tav<typeof updateWorldbookWith>('updateWorldbookWith');
      if (!updateBook) throw new Error('酒馆 API updateWorldbookWith 不可用');
      const txn = chatBookGateway.begin();
      const book = await chatBookGateway.guardedBook(txn, { createIfMissing: true });
      await updateBook(book, entries => {
        const index = entries.findIndex(e => e.extra?.pendingLoreId === entry.id);
        const patch = {
          name: `实体·${entry.kind}·${entry.name}`,
          content: `[${entry.name}]\n${entry.summary}${entry.raw === undefined ? '' : `\n${JSON.stringify(entry.raw, null, 2)}`}`,
          enabled: true,
          strategy: { type: 'selective' as const, keys: [entry.name] },
          extra: { pendingLoreId: entry.id, source_floor: entry.source_floor, source_swipe: entry.source_swipe },
        };
        if (index < 0) return [...entries, patch];
        entries[index] = { ...entries[index], ...patch, strategy: { ...entries[index].strategy, ...patch.strategy } };
        return entries;
      });
    },
  });
  if (!commitRes.ok) {
    loreCommitError.value = commitRes.error!;
    return;
  }
  const targetFloorId = props.floorId ?? floating?.floorId ?? 0;
  await updateFloorVars(targetFloorId, vars => {
    const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
    const factions = Array.isArray(sd.factions) ? [...(sd.factions as Array<Record<string, unknown>>)] : [];
    if ((item.kind === '势力' || !item.kind) && item.name && !factions.some(f => f.name === item.name)) {
      factions.push({ name: item.name, attitude: '未接触', intel: item.summary || '', risk: '未知' });
    }
    return { ...vars, stat_data: { ...sd, pending_lore: commitRes.remaining, factions } };
  });
  await floating?.refresh?.();
  emit('adopt-lore', item);
}

async function onTogglePinIntel(item: PdaIntelItemLike, nextPinned: boolean) {
  emit('toggle-pin-intel', item, nextPinned);
  const floating = resolveFloating();
  const targetFloorId = props.floorId ?? floating?.floorId ?? 0;
  try {
    await updateFloorVars(targetFloorId, vars => {
      const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
      const rawIntel = Array.isArray(sd.intel) ? [...(sd.intel as Array<Record<string, unknown>>)] : [];
      const nextIntel = rawIntel.map(entry => {
        const matchByTitle = item.title && entry.title === item.title;
        const matchByContent = entry.content === item.content && (entry.src ?? '') === (item.src ?? '');
        if (matchByTitle || matchByContent) {
          return { ...entry, pinned: nextPinned };
        }
        return entry;
      });
      return {
        ...vars,
        stat_data: {
          ...sd,
          intel: nextIntel,
        },
      };
    });
    await floating?.refresh?.();
  } catch {
    // 独立预览或无宿主 API 时安全降级
  }
}

async function onArchiveIntelLore(item: PdaIntelItemLike, loreEntry: NormalizedPendingLoreItem) {
  emit('archive-intel-lore', item, loreEntry);
  const floating = resolveFloating();
  const targetFloorId = props.floorId ?? floating?.floorId ?? 0;
  try {
    await updateFloorVars(targetFloorId, vars => {
      const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
      const rawPending = Array.isArray(sd.pending_lore) ? [...(sd.pending_lore as unknown[])] : [];
      const exists = rawPending.some(
        e => e && typeof e === 'object' && ((e as { id?: string }).id === loreEntry.id || (e as { name?: string }).name === loreEntry.name),
      );
      if (!exists) {
        rawPending.push(loreEntry);
      }
      return {
        ...vars,
        stat_data: {
          ...sd,
          pending_lore: rawPending,
        },
      };
    });
    await floating?.refresh?.();
  } catch {
    // 独立预览或无宿主 API 时安全降级
  }
}

async function onSaveMemo(text: string) {
  emit('save-memo', text);
  const floating = resolveFloating();
  const targetFloorId = props.floorId ?? floating?.floorId ?? 0;
  try {
    await updateFloorVars(targetFloorId, vars => {
      const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
      return {
        ...vars,
        stat_data: {
          ...sd,
          memo: text,
        },
      };
    });
    await floating?.refresh?.();
  } catch {
    // 独立预览或无宿主 API 时安全降级
  }
}

const TAB_ITEMS: ReadonlyArray<{ id: PdaPrimaryTabId; label: string; shortLabel: string }> = [
  { id: 'events', label: '战况动态', shortLabel: '动态' },
  { id: 'chains', label: '资金链网', shortLabel: '资金' },
  { id: 'intel', label: '战区情报', shortLabel: '情报' },
  { id: 'quests', label: '作战任务', shortLabel: '任务' },
];

const headerEl = ref<HTMLElement | null>(null);
const pdaWindowRef = ref<HTMLElement | null>(null);
useTacticalModalMotion(pdaWindowRef);

let isDragging = false;
let activePointerId: number | null = null;

/** 将 shell.state.activeTab 映射为四联装主键（兼容 'cash' 别名映射至 'chains'） */
const resolvedActiveTab = computed<PdaPrimaryTabId>(() => {
  const raw = props.shell.state.activeTab;
  if (raw === 'chains' || raw === 'cash') return 'chains';
  if (raw === 'intel') return 'intel';
  if (raw === 'quests') return 'quests';
  return 'events';
});

function onSelectTab(tab: PdaPrimaryTabId) {
  props.shell.setActiveTab(tab);
  emit('tab-change', tab);
}

watch(resolvedActiveTab, () => {
  scheduleNextFrame(() => {
    playTacticalStagger(pdaWindowRef.value, '[data-testid="pda-window-body"] > *, section, article, .pda-card', {
      maxItems: 10,
      duration: 0.15,
    });
  });
});

const normalizedFaction = computed(() => {
  const f = props.faction?.toLowerCase();
  if (f === 'allied' || f === 'allies') return 'allies';
  if (f === 'soviet') return 'soviet';
  if (f === 'yuri') return 'yuri';
  return 'allies';
});

const factionColor = computed(() => {
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

function onHeaderPointerDown(e: PointerEvent) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  if (props.shell.state.pinned) return;

  activePointerId = e.pointerId;
  isDragging = true;

  try {
    headerEl.value?.setPointerCapture(e.pointerId);
  } catch {
    // 安全降级
  }

  props.shell.dragStart(e.screenX, e.screenY);
}

function onHeaderPointerMove(e: PointerEvent) {
  if (!isDragging || activePointerId !== e.pointerId) return;
  props.shell.dragMove(e.screenX, e.screenY);
}

function finishHeaderDrag(e: PointerEvent) {
  if (activePointerId !== e.pointerId) return;
  try {
    headerEl.value?.releasePointerCapture(e.pointerId);
  } catch {
    // 安全降级
  }
  activePointerId = null;
  if (isDragging) {
    isDragging = false;
    props.shell.dragEnd();
  }
}

function onHeaderPointerUp(e: PointerEvent) {
  finishHeaderDrag(e);
}

function onHeaderPointerCancel(e: PointerEvent) {
  finishHeaderDrag(e);
}

defineExpose({
  resolvedActiveTab,
  liveEvents,
  onSelectTab,
  onAdoptLore,
  onSaveMemo,
  onCycleSizeMode,
});
</script>

<style scoped>
.pda-window-frame {
  box-sizing: border-box;
}
</style>
