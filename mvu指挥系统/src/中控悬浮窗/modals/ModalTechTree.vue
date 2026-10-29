<template>
  <Transition name="ra-modal">
    <div
      v-if="open"
      ref="backdropRef"
      class="ra-modal-mask fixed inset-0 z-10010 flex items-center justify-center p-3"
      @click.self="$emit('close')"
    >
      <section
        ref="panelRef"
        class="ra-modal-card ob-panel flex w-full flex-col overflow-hidden rounded-[2px] select-none"
        :style="modalDynamicStyle"
        :data-size-mode="sizeMode"
        role="dialog"
        aria-modal="true"
        aria-label="战术科研中心"
      >
        <header class="ra-modal-header flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <div class="flex flex-wrap items-center gap-2.5">
            <div class="flex items-center gap-2">
              <span class="ra-modal-icon"><Icon name="flask" :size="14" /></span>
              <span class="ra-modal-title text-[15px] font-bold tracking-wide"
                >战时战术科研中心 · TACTICAL R&amp;D</span
              >
            </div>

            <!-- PRT-UI-01：一级平行双生主厅切换器 -->
            <nav
              class="ra-hall-switcher flex flex-wrap items-center gap-1.5"
              role="tablist"
              aria-label="科研与协议双生主厅切换"
              data-hall-switcher
            >
              <button
                type="button"
                role="tab"
                class="ra-hall-tab flex items-center gap-1.5 rounded-[2px] border px-2.5 py-1 text-[12px] font-bold tracking-wide transition-all"
                :class="{ 'ra-hall-tab--active': activeHall === 'tech' }"
                :aria-selected="activeHall === 'tech'"
                data-hall-tab="tech"
                data-test="tab-tech"
                @click="selectHall('tech')"
              >
                <Icon name="flask" :size="12" />
                <span>科技研发树 (Tech Tree)</span>
                <span
                  v-if="effectiveNewlyRevealedCount > 0"
                  class="ra-hall-reveal-badge inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5 font-mono text-[11px] font-bold"
                  data-newly-revealed-badge
                  :data-revealed-count="effectiveNewlyRevealedCount"
                >
                  <Icon name="star" :size="11" />
                  <span>新揭示 +{{ effectiveNewlyRevealedCount }}</span>
                </span>
              </button>

              <span class="ra-hall-divider font-mono text-[11px]" aria-hidden="true">·</span>

              <button
                type="button"
                role="tab"
                class="ra-hall-tab flex items-center gap-1.5 rounded-[2px] border px-2.5 py-1 text-[12px] font-bold tracking-wide transition-all"
                :class="{ 'ra-hall-tab--active': activeHall === 'protocol' }"
                :aria-selected="activeHall === 'protocol'"
                data-hall-tab="protocol"
                data-test="tab-protocols"
                :data-protocol-ready="protocolReadyCount"
                :data-protocol-auto-queued="protocolAutoQueuedCount"
                @click="selectHall('protocol')"
              >
                <Icon name="book" :size="12" />
                <span>统帅部条令 (Protocols · 可攻关 {{ protocolReadyCount }})</span>
                <span
                  v-if="protocolAutoQueuedCount > 0"
                  class="ra-hall-auto-badge inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5 font-mono text-[11px] font-bold"
                  data-protocol-auto-badge
                  :data-auto-queued-count="protocolAutoQueuedCount"
                >
                  <Icon name="swap" :size="11" />
                  <span>排程 {{ protocolAutoQueuedCount }}</span>
                </span>
              </button>
            </nav>
          </div>

          <div class="flex items-center gap-2">
            <span class="tech-uto-summary ob-num font-mono text-[11px]" data-uto-tech-summary>
              研究组 {{ utoUnlockedSlotCount }}/{{ utoResearchSlots.length }} · 在研
              {{ utoScheduledResearchTasks.length }}
            </span>
            <button
              type="button"
              class="ra-size-mode-btn inline-flex items-center gap-1 rounded-[2px] border px-2 py-0.5 font-mono text-[11px] font-bold transition-colors"
              data-test="tech-modal-size-btn"
              :title="`切换科研中心视口尺寸（当前：${sizeModeLabel}）`"
              @click="cycleSizeMode"
            >
              <Icon name="layers" :size="11" />
              <span>{{ sizeModeLabel }}</span>
            </button>
            <button
              class="ra-modal-close rounded-[2px] p-1 transition-colors"
              aria-label="关闭弹窗"
              @click="$emit('close')"
            >
              <Icon name="close" :size="12" />
            </button>
          </div>
        </header>

        <!-- CMD-UI-01：多阵营筛选胶囊条 -->
        <div
          v-if="unlockedFactions.length >= 1"
          class="ra-faction-filter-bar flex flex-wrap items-center gap-1.5 border-b px-3 py-1"
          data-test="faction-filter-bar"
          role="group"
          aria-label="已解锁阵营筛选"
        >
          <span class="font-mono text-[11px] opacity-80">阵营筛选：</span>
          <button
            v-for="pill in factionFilterPills"
            :key="pill.id"
            type="button"
            class="ra-faction-pill rounded-[2px] border px-2 py-0.5 font-mono text-[11px] font-bold transition-all"
            :class="{ 'ra-faction-pill--active': selectedFactionFilter === pill.id }"
            :data-faction-filter="pill.id"
            :aria-pressed="selectedFactionFilter === pill.id"
            @click="selectedFactionFilter = pill.id"
          >
            {{ pill.label }}
          </button>
        </div>

        <div class="ra-modal-body flex-1 overflow-y-auto" :data-active-hall="activeHall">
          <template v-if="activeHall === 'tech'">
            <!-- UTO-UI-DOMAIN-01：11 大科研序列工位快照与在研课题 UnifiedTask 同源观察层 -->
            <section class="tech-uto-observer sr-only" data-uto-tech-observer aria-label="科研领域与在研课题概览">
              <div class="tech-uto-slots" role="list" aria-label="科研领域槽位状态">
                <span
                  v-for="slot in utoResearchSlots"
                  :key="slot.laneKey"
                  role="listitem"
                  class="tech-uto-slot font-mono"
                  :data-lane-key="slot.laneKey"
                  :data-lane-domain="slot.station.domain"
                  :data-slot-id="slot.slotId"
                  :data-unlocked="slot.unlocked ? 'true' : 'false'"
                  :data-capacity="slot.capacity"
                  :title="
                    slot.unlocked ? `${slot.displayName}（容量 ${slot.capacity}）` : (slot.lockedReason ?? '未开通')
                  "
                >
                  {{ slot.displayName }}
                </span>
              </div>
              <div
                v-if="utoScheduledResearchTasks.length > 0"
                class="tech-uto-tasks"
                role="list"
                aria-label="当前在研课题列表"
              >
                <div
                  v-for="task in utoScheduledResearchTasks"
                  :key="task.taskId"
                  role="listitem"
                  class="tech-uto-task font-mono"
                  :data-task-id="task.taskId"
                  :data-task-name="task.name"
                  :data-lane-key="task.laneKey"
                  :data-task-status="task.status"
                  :data-task-held="task.held ? 'true' : undefined"
                  :data-task-settling="task.settling ? 'true' : undefined"
                  :data-spent-minutes="task.spentMinutes"
                  :data-total-minutes="task.totalMinutes"
                >
                  <span class="tech-uto-task-name">{{ task.name }}</span>
                  <span class="tech-uto-task-progress"
                    >{{ task.spentMinutes }}/{{ task.totalMinutes }}m ({{ task.progressPct }}%)</span
                  >
                  <span class="tech-uto-task-state">{{
                    task.status === 'queued' ? '排队中' : task.status
                  }}</span>
                </div>
              </div>
            </section>
            <div
              v-if="highlightedTechTarget"
              class="px-2 py-1 text-[11px]"
              :data-highlighted-tech="highlightedTechTarget.techId"
              role="status"
            >
              定位科技：{{ highlightedTechTarget.techName }}
            </div>
            <PanelTech
              :snapshot="activeSnapshot"
              :highlighted-tech-target="highlightedTechTarget"
              :faction-filter="selectedFactionFilter"
              :unlocked-factions="unlockedFactions"
              @jump-to-protocol="handleJumpToProtocol"
              @jump-to-tech="handleJumpToTech"
            />
          </template>
          <template v-else>
            <div
              v-if="highlightedProtocolTarget"
              class="px-2 py-1 text-[11px]"
              :data-highlighted-protocol="highlightedProtocolTarget.protocolId"
              data-test="highlighted-protocol-banner"
              role="status"
            >
              定位协议：{{ highlightedProtocolTarget.protocolName }}
            </div>
            <PanelProtocol
              :snapshot="activeSnapshot"
              :initial-institute="preferredInstitute"
              :highlighted-protocol-target="highlightedProtocolTarget"
              :faction-filter="selectedFactionFilter"
              :unlocked-factions="unlockedFactions"
              @jump-to-tech="handleJumpToTech"
              @command-staged="handleCommandStaged"
              @schedule-dispatch="handleScheduleDispatch"
            />
          </template>
        </div>
      </section>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, getCurrentInstance, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { normalizeFactionId } from '../../红警指挥系统/core/commandPresets';
import { projectTechTreeObserverView } from '../../红警指挥系统/engines/engOrderBridge';
import type { TechTreeObserverView } from '../../红警指挥系统/engines/engOrderBridge';
import PanelTech from '../../红警指挥系统/ui/panels/PanelTech.vue';
import { filterDynamicCodexResearches } from '../../红警指挥系统/ui/panels/panelTechHelpers';
import type { ProtocolDefinitionLike } from '../../红警指挥系统/engines/protocolEngine';
import { DEFAULT_PROTOCOL_CATALOG as BASE_DEFAULT_PROTOCOL_CATALOG, mergeDefaultProtocolCatalog } from '../../红警指挥系统/engines/protocolCatalogIndex';
import { DEFAULT_YURI_PROTOCOL_CATALOG } from '../panels/panelProtocolHelpers';
import type { Schema } from '../../红警指挥系统/core/schema';
import { useDataStore } from '../../红警指挥系统/composables/store';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import { isDebugUnlockAllFactionsActive } from '../../红警指挥系统/composables/useDebugMode';
import { useTacticalModalMotion } from '../../红警指挥系统/ui/motion/useGsapMotion';
import { countAutoQueuedProtocols, countExperimentableProtocols } from '../models/protocolCommands';
import { inferDefaultBuildingCompute } from '../models/worldbookCatalogHelpers';
import type {
  ProtocolCommandStagedEvent,
  ProtocolCommandStateView,
  ProtocolScheduleDispatchEvent,
} from '../models/protocolCommands';

const PanelProtocol = defineAsyncComponent(() => import('../panels/PanelProtocol.vue').then(m => m.default));

export type TechModalHall = 'tech' | 'protocol';

interface ProtocolModalSlice {
  protocols?: ReadonlyArray<{
    ref?: string;
    status?: string;
    reveals?: readonly string[];
    last_result?: {
      outcome?: string;
    };
  }>;
  tech?: {
    done?: readonly string[];
  };
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    snapshot?: Schema | null;
    initialHall?: TechModalHall;
    newlyRevealedCount?: number;
  }>(),
  {
    snapshot: undefined,
    initialHall: 'tech',
    newlyRevealedCount: undefined,
  },
);

const backdropRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
useTacticalModalMotion(panelRef, backdropRef, { open: () => props.open });

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'jump-to-tech', researchName: string): void;
  (e: 'jump-to-protocol', protocolName: string): void;
  (e: 'command-staged', payload: ProtocolCommandStagedEvent): void;
  (e: 'schedule-dispatch', payload: ProtocolScheduleDispatchEvent): void;
}>();

const store = useDataStore();
const catalog = useCatalogStore();

const activeHall = ref<TechModalHall>(props.initialHall);
const lastJumpTarget = ref<string | null>(null);
const highlightedTechTarget = ref<{ techId: string; techName: string } | null>(null);
const highlightedProtocolTarget = ref<{ protocolId: string; protocolName: string } | null>(null);

export type TechModalSizeMode = 'wide' | 'full' | 'compact';
const sizeMode = ref<TechModalSizeMode>('wide');
const viewportWidth = ref<number>(1280);
const viewportHeight = ref<number>(820);

function readHostViewport(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 1280, h: 820 };
  let w = window.innerWidth || 1280;
  let h = window.innerHeight || 820;
  try {
    if (window.parent && window.parent !== window) {
      const pw = window.parent.innerWidth;
      const ph = window.parent.innerHeight;
      if (typeof pw === 'number' && pw > 320) w = Math.max(w, pw);
      if (typeof ph === 'number' && ph > 320) h = Math.max(h, ph);
    }
  } catch {
    // 跨域父窗口回退当前窗口尺寸
  }
  return { w, h };
}

function syncViewportSize(): void {
  const { w, h } = readHostViewport();
  viewportWidth.value = w;
  viewportHeight.value = h;
}

function cycleSizeMode(): void {
  if (sizeMode.value === 'wide') sizeMode.value = 'full';
  else if (sizeMode.value === 'full') sizeMode.value = 'compact';
  else sizeMode.value = 'wide';
}

const sizeModeLabel = computed<string>(() => {
  if (sizeMode.value === 'full') return '全屏 95%';
  if (sizeMode.value === 'compact') return '标准 920';
  return '宽屏 86%';
});

const modalDynamicStyle = computed<Record<string, string>>(() => {
  const vw = viewportWidth.value;
  const vh = viewportHeight.value;
  if (sizeMode.value === 'compact') {
    return {
      maxWidth: 'min(95vw, 920px)',
      maxHeight: '86vh',
    };
  }
  const wRatio = sizeMode.value === 'full' ? 0.95 : 0.86;
  const hRatio = sizeMode.value === 'full' ? 0.93 : 0.88;
  const maxW = sizeMode.value === 'full' ? 1680 : 1420;
  const targetW = Math.max(340, Math.min(maxW, Math.round(vw * wRatio)));
  const targetH = Math.max(460, Math.min(1020, Math.round(vh * hRatio)));
  return {
    maxWidth: `min(96vw, ${targetW}px)`,
    height: `min(92vh, ${targetH}px)`,
    maxHeight: '92vh',
  };
});

if (getCurrentInstance()) {
  onMounted(() => {
    syncViewportSize();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', syncViewportSize, { passive: true });
      try {
        if (window.parent && window.parent !== window && typeof window.parent.addEventListener === 'function') {
          window.parent.addEventListener('resize', syncViewportSize, { passive: true });
        }
      } catch {
        /* ignore cross-origin */
      }
    }
  });

  onBeforeUnmount(() => {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', syncViewportSize);
      try {
        if (window.parent && window.parent !== window && typeof window.parent.removeEventListener === 'function') {
          window.parent.removeEventListener('resize', syncViewportSize);
        }
      } catch {
        /* ignore cross-origin */
      }
    }
  });
}

watch(
  () => props.initialHall,
  val => {
    if (val) activeHall.value = val;
  },
);

function selectHall(hall: TechModalHall): void {
  activeHall.value = hall;
}

function handleJumpToTech(target: string | { techId: string; techName: string }): void {
  const resolved = typeof target === 'string' ? { techId: target, techName: target } : target;
  highlightedTechTarget.value = resolved;
  const researchName = resolved.techName;
  lastJumpTarget.value = researchName;
  activeHall.value = 'tech';
  emit('jump-to-tech', researchName);
}

function handleJumpToProtocol(target: string | { protocolId: string; protocolName: string }): void {
  const raw = typeof target === 'string' ? target.trim() : (target.protocolName || target.protocolId).trim();
  const source = catalog as unknown as {
    protocols?: readonly ProtocolDefinitionLike[];
    effectiveCatalog?: { protocols?: readonly ProtocolDefinitionLike[] };
  };
  const allProtocols = mergeDefaultProtocolCatalog(
    DEFAULT_PROTOCOL_CATALOG,
    source.effectiveCatalog?.protocols ?? source.protocols,
  );
  const matched = allProtocols.find(p => p.id === raw || p.name === raw);
  const resolved =
    typeof target === 'string'
      ? { protocolId: matched?.id ?? raw, protocolName: matched?.name ?? raw }
      : target;
  highlightedProtocolTarget.value = resolved;
  lastJumpTarget.value = resolved.protocolName;
  activeHall.value = 'protocol';
  emit('jump-to-protocol', resolved.protocolName);
}

const activeState = computed(() => (props.snapshot !== undefined ? props.snapshot : store.data));
const catalogAllResearches = computed(() => {
  const source = catalog as unknown as {
    dynamicCatalog?: { researches?: readonly { id?: string; name: string; aliases?: readonly string[]; line?: string }[] };
  };
  const dyn = source.dynamicCatalog?.researches ?? [];
  return dyn.length > 0 ? [...(catalog.researches ?? []), ...dyn] : (catalog.researches ?? []);
});
function ensureComputeFacilitiesInCatalog(
  rawBases: ReadonlyArray<{
    buildings?: ReadonlyArray<{ name: string; state?: string; status?: string }>;
  }> | undefined,
): void {
  const catSource = catalog as unknown as {
    buildings?: Array<Record<string, unknown>>;
    effectiveCatalog?: { buildings?: Array<Record<string, unknown>> };
  };
  const pools: Array<Array<Record<string, unknown>>> = [];
  if (Array.isArray(catSource.buildings)) pools.push(catSource.buildings);
  if (
    Array.isArray(catSource.effectiveCatalog?.buildings) &&
    catSource.effectiveCatalog!.buildings !== catSource.buildings
  ) {
    pools.push(catSource.effectiveCatalog!.buildings);
  }

  for (const pool of pools) {
    for (const cb of pool) {
      if (!cb || typeof cb !== 'object') continue;
      const existingOut = cb.outputs as { virtual?: { compute?: { tflops?: number; tops?: number } } } | undefined;
      if (existingOut?.virtual?.compute) continue;
      const defComp = inferDefaultBuildingCompute(cb.name, cb.id);
      if (defComp) {
        cb.outputs = {
          ...(existingOut ?? {}),
          virtual: {
            ...(existingOut?.virtual ?? {}),
            compute: defComp,
          },
        };
      }
    }

    for (const base of rawBases ?? []) {
      for (const b of base?.buildings ?? []) {
        if (!b?.name) continue;
        const bComp = inferDefaultBuildingCompute(b.name);
        if (!bComp) continue;
        const found = pool.find(c => (c.name ?? c.id) === b.name || c.id === b.name);
        if (found) {
          const existingOut = found.outputs as
            | { virtual?: { compute?: { tflops?: number; tops?: number } } }
            | undefined;
          if (!existingOut?.virtual?.compute) {
            found.outputs = {
              ...(existingOut ?? {}),
              virtual: {
                ...(existingOut?.virtual ?? {}),
                compute: bComp,
              },
            };
          }
        } else {
          pool.push({
            id: b.name,
            name: b.name,
            cost: 2500,
            power: 80,
            research: null,
            prereqs: [],
            need_buildings: [],
            desc: '',
            outputs: {
              virtual: {
                compute: bComp,
              },
            },
          });
        }
      }
    }
  }
}

const activeSnapshot = computed(() => {
  const raw = activeState.value;
  if (!raw) return raw;

  ensureComputeFacilitiesInCatalog(
    raw.bases as ReadonlyArray<{
      buildings?: ReadonlyArray<{ name: string; state?: string; status?: string }>;
    }>,
  );

  let basesMutated = false;
  const normalizedBases = Array.isArray(raw.bases)
    ? raw.bases.map(base => {
        if (!Array.isArray(base.buildings)) return base;
        let bldMutated = false;
        const nextBuildings = base.buildings.map(b => {
          const bRec = b as unknown as { name: string; state?: string; status?: string };
          const rawState = typeof bRec.state === 'string' ? bRec.state.trim() : '';
          const rawStatus = typeof bRec.status === 'string' ? bRec.status.trim() : '';
          const effectiveState = rawState || rawStatus || '运转';
          const normalizedState =
            effectiveState === '运转' ||
            effectiveState === '正常' ||
            effectiveState === '运行' ||
            effectiveState === '运行中' ||
            effectiveState === '在线'
              ? '运转'
              : effectiveState;
          if (bRec.state !== normalizedState) {
            bldMutated = true;
            return {
              ...b,
              state: normalizedState as typeof b.state,
            };
          }
          return b;
        });
        if (!bldMutated) return base;
        basesMutated = true;
        return {
          ...base,
          buildings: nextBuildings,
        };
      })
    : raw.bases;

  let codexMutated = false;
  let nextCodex = raw.codex;
  if (Array.isArray(raw.codex) && raw.codex.length > 0) {
    const novelTechNames = new Set(
      filterDynamicCodexResearches(raw.codex, catalogAllResearches.value).map(c => c.name),
    );
    const filteredCodex = raw.codex.filter(c => c.kind !== '科技' || novelTechNames.has(c.name));
    if (filteredCodex.length !== raw.codex.length) {
      codexMutated = true;
      nextCodex = filteredCodex;
    }
  }

  if (!basesMutated && !codexMutated) return raw;
  return {
    ...raw,
    ...(basesMutated ? { bases: normalizedBases } : {}),
    ...(codexMutated ? { codex: nextCodex } : {}),
  };
});

const FACTION_LABELS: Readonly<Record<string, string>> = {
  all: '全部',
  allied: '盟军',
  soviet: '苏联',
  yuri: '尤里',
  common: '通用',
};

function resolveUnlockedFactionsFromSnapshot(
  snapshot: { command?: { unlocked_factions?: readonly string[] } } | null | undefined,
): string[] {
  if (isDebugUnlockAllFactionsActive()) {
    return ['allied', 'soviet', 'yuri'];
  }
  const rawList = snapshot?.command?.unlocked_factions ?? ['allied'];
  const normalized: string[] = [];
  for (const item of rawList) {
    if (typeof item !== 'string') continue;
    const id = normalizeFactionId(item);
    if (id && id !== 'common' && !normalized.includes(id)) {
      normalized.push(id);
    }
  }
  return normalized.length > 0 ? normalized : ['allied'];
}

function inferTechOrBuildFaction(entry: {
  id?: string;
  name?: string;
  faction?: string;
  scope?: string;
  line?: string;
  tags?: readonly string[];
  need_building?: string;
  need_buildings?: readonly string[];
}): string {
  if (entry.scope === 'common') return 'common';
  if (typeof entry.faction === 'string' && entry.faction.trim()) {
    const norm = normalizeFactionId(entry.faction);
    if (norm) return norm;
  }
  if (typeof entry.id === 'string' && entry.id.trim()) {
    const lowerId = entry.id.trim().toLowerCase();
    if (lowerId.startsWith('sov.') || lowerId.startsWith('soviet.') || lowerId.includes('.soviet.')) return 'soviet';
    if (lowerId.startsWith('all.') || lowerId.startsWith('allied.') || lowerId.includes('.allied.')) return 'allied';
    if (lowerId.startsWith('yuri.') || lowerId.includes('.yuri.')) return 'yuri';
    if (lowerId.startsWith('common.') || lowerId.includes('.common.')) return 'common';
  }
  if (typeof entry.line === 'string' && entry.line.trim()) {
    const lineNorm = normalizeFactionId(entry.line);
    if (lineNorm === 'allied' || lineNorm === 'soviet' || lineNorm === 'yuri') return lineNorm;
  }
  for (const tag of entry.tags ?? []) {
    const tagNorm = normalizeFactionId(tag);
    if (tagNorm === 'allied' || tagNorm === 'soviet' || tagNorm === 'yuri') return tagNorm;
  }
  const textProbe = [entry.name ?? '', entry.need_building ?? '', ...(entry.need_buildings ?? [])].join(' ');
  if (/苏联|苏军|红星|磁暴|铁幕|基洛夫|天启/.test(textProbe)) return 'soviet';
  if (/盟军|超时空|光棱|幻影|裂缝产生器/.test(textProbe)) return 'allied';
  if (/尤里|心灵控制|基因突变/.test(textProbe)) return 'yuri';
  return 'common';
}

function filterEntriesByUnlockedFactions<
  T extends {
    id?: string;
    name?: string;
    faction?: string;
    scope?: string;
    line?: string;
    tags?: readonly string[];
    need_building?: string;
    need_buildings?: readonly string[];
  },
>(entries: readonly T[], unlockedFactions: readonly string[], activeFactionFilter = 'all'): T[] {
  const normalizedUnlocked = new Set(
    (unlockedFactions.length ? unlockedFactions : ['allied'])
      .map(f => normalizeFactionId(f))
      .filter(f => Boolean(f) && f !== 'common'),
  );
  if (normalizedUnlocked.size === 0) normalizedUnlocked.add('allied');

  const filterTarget =
    activeFactionFilter && activeFactionFilter !== 'all' ? normalizeFactionId(activeFactionFilter) : 'all';

  return entries.filter(entry => {
    const f = inferTechOrBuildFaction(entry);
    if (f !== 'common' && !normalizedUnlocked.has(f)) {
      return false;
    }
    if (filterTarget !== 'all' && f !== 'common' && f !== filterTarget) {
      return false;
    }
    return true;
  });
}

const unlockedFactions = computed<string[]>(() => resolveUnlockedFactionsFromSnapshot(activeSnapshot.value));
const selectedFactionFilter = ref<string>('all');

const preferredInstitute = computed<'soviet' | 'allied' | 'yuri'>(() => {
  const f = selectedFactionFilter.value;
  if (f === 'allied' || f === 'soviet' || f === 'yuri') return f;
  const list = unlockedFactions.value;
  if (list.length === 1) {
    const only = list[0];
    if (only === 'allied' || only === 'soviet' || only === 'yuri') return only;
  }
  if (!list.includes('soviet')) {
    if (list.includes('allied')) return 'allied';
    if (list.includes('yuri')) return 'yuri';
  }
  return 'soviet';
});

watch(unlockedFactions, list => {
  if (selectedFactionFilter.value !== 'all' && !list.includes(selectedFactionFilter.value)) {
    selectedFactionFilter.value = 'all';
  }
});

const factionFilterPills = computed(() => [
  { id: 'all', label: '全部' },
  ...unlockedFactions.value.map(id => ({
    id,
    label: FACTION_LABELS[id] ?? id,
  })),
]);

const localAutoQueuedCountOverride = ref<number | null>(null);

watch(
  () => (activeState.value as (Schema & ProtocolModalSlice) | null)?.protocols,
  () => {
    localAutoQueuedCountOverride.value = null;
  },
  { deep: true },
);

function handleCommandStaged(payload: ProtocolCommandStagedEvent): void {
  emit('command-staged', payload);
}

function handleScheduleDispatch(payload: ProtocolScheduleDispatchEvent): void {
  localAutoQueuedCountOverride.value = payload.queue.length;
  emit('schedule-dispatch', payload);
}

const DEFAULT_PROTOCOL_CATALOG: readonly ProtocolDefinitionLike[] = [
  ...BASE_DEFAULT_PROTOCOL_CATALOG,
  ...DEFAULT_YURI_PROTOCOL_CATALOG,
];

const mergedCatalogProtocols = computed<readonly ProtocolDefinitionLike[]>(() => {
  const source = catalog as unknown as {
    protocols?: readonly ProtocolDefinitionLike[];
    effectiveCatalog?: { protocols?: readonly ProtocolDefinitionLike[] };
  };
  const fromCatalog = source.effectiveCatalog?.protocols ?? source.protocols;
  const merged = mergeDefaultProtocolCatalog(DEFAULT_PROTOCOL_CATALOG, fromCatalog);
  return filterEntriesByUnlockedFactions(merged, unlockedFactions.value, selectedFactionFilter.value);
});

const protocolReadyCount = computed<number>(() =>
  countExperimentableProtocols(activeState.value as ProtocolCommandStateView | null, mergedCatalogProtocols.value),
);

const protocolAutoQueuedCount = computed<number>(() => {
  if (localAutoQueuedCountOverride.value !== null) {
    return localAutoQueuedCountOverride.value;
  }
  return countAutoQueuedProtocols(activeState.value as ProtocolCommandStateView | null);
});

const effectiveNewlyRevealedCount = computed<number>(() => {
  if (typeof props.newlyRevealedCount === 'number') {
    return Number.isFinite(props.newlyRevealedCount) ? Math.max(0, Math.floor(props.newlyRevealedCount)) : 0;
  }
  const state = activeState.value as (Schema & ProtocolModalSlice) | null;
  const protocols = state?.protocols ?? [];
  if (protocols.length === 0) return 0;

  const doneSet = new Set(state?.tech?.done ?? []);
  const source = catalog as unknown as {
    protocols?: readonly { id: string; name: string; reveals?: readonly string[] }[];
    effectiveCatalog?: { protocols?: readonly { id: string; name: string; reveals?: readonly string[] }[] };
    dynamicCatalog?: { researches?: readonly { id?: string; name: string }[] };
  };
  const defs = mergedCatalogProtocols.value as readonly { id: string; name?: string; reveals?: readonly string[] }[];
  const defByKey = new Map<string, { id: string; name?: string; reveals?: readonly string[] }>();
  for (const d of defs) {
    if (d.id) defByKey.set(d.id, d);
    if (d.name) defByKey.set(d.name, d);
  }
  const researchByKey = new Map<string, { id?: string; name: string }>();
  for (const t of catalog.researches as readonly { id?: string; name: string }[]) {
    if (t.name) researchByKey.set(t.name, t);
    if (t.id) researchByKey.set(t.id, t);
  }
  for (const t of source.dynamicCatalog?.researches ?? []) {
    if (t.name) researchByKey.set(t.name, t);
    if (t.id) researchByKey.set(t.id, t);
  }

  const revealed = new Set<string>();
  for (const p of protocols) {
    if (p.status !== 'active') continue;
    const def = defByKey.get(p.ref);
    for (const r of def?.reveals ?? p.reveals ?? []) {
      if (typeof r !== 'string' || !r.trim()) continue;
      const research = researchByKey.get(r);
      if (!doneSet.has(r) && !doneSet.has(research?.name ?? r)) revealed.add(research?.id ?? research?.name ?? r);
    }
  }
  return revealed.size;
});

const filteredResearchesForTechTree = computed(() =>
  filterEntriesByUnlockedFactions(catalog.researches ?? [], unlockedFactions.value, selectedFactionFilter.value),
);

const utoTechObserver = computed<TechTreeObserverView>(() =>
  projectTechTreeObserverView(activeState.value, {
    buildings: filterEntriesByUnlockedFactions(
      catalog.buildings ?? [],
      unlockedFactions.value,
      selectedFactionFilter.value,
    ),
    productions: filterEntriesByUnlockedFactions(
      catalog.productions ?? [],
      unlockedFactions.value,
      selectedFactionFilter.value,
    ),
    researches: filteredResearchesForTechTree.value,
    retrofits: catalog.retrofits ?? [],
    projects: catalog.projects ?? [],
    factionDefs: (catalog.factionDefs ?? []).filter(fd => {
      const f = normalizeFactionId(fd.faction);
      return !f || f === 'common' || unlockedFactions.value.includes(f);
    }),
  }),
);

const utoResearchSlots = computed(() => utoTechObserver.value.slots);
const utoScheduledResearchTasks = computed(() => utoTechObserver.value.scheduledResearchTasks);
const utoUnlockedSlotCount = computed(() => utoResearchSlots.value.filter(s => s.unlocked).length);
</script>

<style scoped>
.ra-modal-mask {
  z-index: 10010;
  background: color-mix(in srgb, var(--rac-bg) 82%, transparent);
}

.ra-modal-card {
  background: var(--rac-bg);
  border: 1px solid var(--rac-line);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.85),
    0 0 0 1px color-mix(in srgb, var(--rac-line) 15%, transparent);
}

.ra-modal-header {
  position: relative;
  background-image: var(--rac-header-stripe), var(--rac-surface-tint);
  background-color: var(--rac-panel);
  border-top: 2px solid var(--rac-accent);
  border-color: var(--rac-dim);
  box-shadow: inset 0 1px 0 var(--rac-glow);
}

.ra-modal-icon {
  color: var(--rac-accent);
}
.ra-modal-title {
  color: var(--rac-hi);
}

.tech-uto-summary {
  color: var(--rac-muted);
}

.ra-hall-tab {
  background: var(--rac-bg);
  border-color: var(--rac-dim);
  color: var(--rac-muted);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 12%, transparent);
  cursor: pointer;
}
.ra-hall-tab:hover {
  background: color-mix(in srgb, var(--rac-accent) 10%, var(--rac-panel-2));
  border-color: var(--rac-line);
  color: var(--rac-hi);
}
.ra-hall-tab--active {
  background: color-mix(in srgb, var(--rac-accent) 16%, var(--rac-panel-2));
  border-color: color-mix(in srgb, var(--rac-accent) 55%, var(--rac-line));
  color: var(--rac-hi);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 26%, transparent),
    inset 0 -2px 0 var(--rac-accent);
}

.ra-hall-divider {
  color: var(--rac-muted);
}

.ra-hall-reveal-badge {
  background: color-mix(in srgb, var(--rac-warn) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--rac-warn) 55%, transparent);
  color: var(--rac-warn);
}

.ra-hall-auto-badge {
  background: color-mix(in srgb, var(--rac-accent) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--rac-accent) 55%, transparent);
  color: var(--rac-accent);
}

.ra-faction-filter-bar {
  background: var(--rac-panel);
  border-color: var(--rac-dim);
  color: var(--rac-muted);
}

.ra-faction-pill {
  background: var(--rac-bg);
  border-color: var(--rac-dim);
  color: var(--rac-muted);
  cursor: pointer;
}

.ra-faction-pill:hover {
  background: var(--rac-panel-2);
  border-color: var(--rac-line);
  color: var(--rac-hi);
}

.ra-faction-pill--active {
  background: color-mix(in srgb, var(--rac-accent) 16%, var(--rac-panel-2));
  border-color: var(--rac-accent);
  color: var(--rac-hi);
  box-shadow: inset 0 -2px 0 var(--rac-accent);
}

.ra-size-mode-btn {
  background: var(--rac-bg);
  border-color: var(--rac-dim);
  color: var(--rac-muted);
  cursor: pointer;
}

.ra-size-mode-btn:hover {
  background: var(--rac-panel-2);
  border-color: var(--rac-line);
  color: var(--rac-hi);
}

.ra-modal-close {
  color: var(--rac-muted);
}
.ra-modal-close:hover {
  color: var(--rac-hi);
  background: var(--rac-panel-2);
}
.ra-modal-close:focus-visible {
  outline: 1px solid var(--rac-focus);
  outline-offset: 1px;
}

.ra-modal-body {
  background: var(--rac-bg);
}

.tech-uto-observer.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.ra-modal-enter-active,
.ra-modal-leave-active {
  transition:
    opacity 0.2s cubic-bezier(0.3, 0, 0.1, 1),
    transform 0.2s cubic-bezier(0.3, 0, 0.1, 1);
}

.ra-modal-enter-from,
.ra-modal-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
@media (prefers-reduced-motion: reduce) {
  .ra-modal-mask *,
  .ra-modal-mask {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
</style>
