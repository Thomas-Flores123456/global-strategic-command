<template>
  <!--
    世界演变 · World Evolution（FD-35 · D-WEVO-STEALTH-02）
    中控设置面板专属一级分组「世界演变」双子页：
    - page="active"：活跃暗流演进 (L1) —— 四象限筛选、四阶段演进轨迹条、置顶锁 TTL、沉淀入世界书 L3、转化为前线侦察指令
    - page="archived"：历史平息归档 (L2·L3) —— 已平息/归档的历史世界演变记录及一键补入世界书 L3
    顶部共用：世界暗流五维监控概览 + 聊天楼层 <世界演变> 显示策略切换器（彻底无痕全隐 vs 仅露加密脉冲微标）
  -->
  <section class="ra-world-evo card flex flex-col gap-3 px-3 py-2.5 text-xs" data-test="panel-world-evolution">
    <!-- ══════════════════ 顶部共用控制栏：五维监控概览 + 楼层显示策略切换器 ══════════════════ -->
    <div
      class="flex flex-col gap-2.5 rounded-[3px] border border-rac-dim bg-rac-panel p-2.5"
      data-test="wevo-header-bar"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-1.5">
          <Icon name="intel" :size="12" />
          <span class="font-mono text-[12px] font-bold tracking-wide text-rac-hi">
            世界暗流与局势演变
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-2 font-mono text-[11px]" data-test="wevo-overview-metrics">
          <span class="rounded-[2px] border border-[var(--rac-accent)]/40 bg-[var(--rac-accent)]/15 px-1.5 py-0.5 text-[var(--rac-accent)]">
            活跃暗流: <strong data-test="wevo-metric-active">{{ activeEvolutions.length }}</strong>
          </span>
          <span class="rounded-[2px] border border-[var(--rac-dim)] bg-[var(--rac-panel-2)] px-1.5 py-0.5 text-[var(--rac-text)]">
            历史归档: <strong data-test="wevo-metric-archived">{{ archivedEvolutions.length }}</strong>
          </span>
          <span class="rounded-[2px] border border-[var(--rac-alert)]/45 bg-[var(--rac-alert)]/15 px-1.5 py-0.5 text-[var(--rac-alert)]">
            高危高潮: <strong data-test="wevo-metric-climax">{{ climaxCount }}</strong>
          </span>
        </div>
      </div>

      <!-- 聊天楼层 <世界演变> 显示策略切换器 -->
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-t border-rac-dim/60 pt-2"
        data-test="wevo-floor-mode-switcher"
      >
        <div class="flex flex-col">
          <span class="text-[12px] font-semibold text-rac-hi">聊天楼层 &lt;世界演变&gt; 显示策略</span>
          <span class="text-[12px] text-rac-muted">
            控制 AI 输出中的幕后世界暗流在聊天正文楼层中的呈现方式（防剧透无痕全隐 vs 加密脉冲微标）
          </span>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            data-test="wevo-floor-mode-hidden"
            class="cursor-pointer rounded-[2px] border px-2 py-1 font-mono text-[12px] transition-colors"
            :class="
              floorMode === 'hidden'
                ? 'border-rac-focus bg-rac-focus-soft font-bold text-rac-hi'
                : 'border-rac-dim bg-rac-bg text-rac-muted hover:border-rac-line hover:text-rac-hi'
            "
            :aria-pressed="floorMode === 'hidden'"
            @click="setFloorStealthMode('hidden')"
          >
            彻底无痕全隐 (默认)
          </button>
          <button
            type="button"
            data-test="wevo-floor-mode-pulse"
            class="cursor-pointer rounded-[2px] border px-2 py-1 font-mono text-[12px] transition-colors"
            :class="
              floorMode === 'pulse'
                ? 'border-rac-focus bg-rac-focus-soft font-bold text-rac-hi'
                : 'border-rac-dim bg-rac-bg text-rac-muted hover:border-rac-line hover:text-rac-hi'
            "
            :aria-pressed="floorMode === 'pulse'"
            @click="setFloorStealthMode('pulse')"
          >
            仅露加密脉冲微标
          </button>
        </div>
      </div>
    </div>

    <!-- ══════════════════ 子页①：活跃暗流演进 (L1) ══════════════════ -->
    <template v-if="currentPage === 'active'">
      <!-- 四象限筛选胶囊栏 -->
      <div
        class="flex flex-wrap items-center justify-between gap-1.5 rounded-[3px] border border-rac-dim bg-rac-panel px-2.5 py-1.5"
        data-test="wevo-domain-filter-bar"
      >
        <div class="flex flex-wrap items-center gap-1">
          <button
            v-for="dom in DOMAIN_FILTER_OPTIONS"
            :key="dom.key"
            type="button"
            data-test="wevo-domain-filter"
            :data-domain="dom.key"
            class="cursor-pointer rounded-[2px] border px-2 py-0.5 font-mono text-[12px] transition-colors"
            :class="
              selectedDomain === dom.key
                ? 'border-rac-focus bg-rac-focus-soft font-bold text-rac-hi'
                : 'border-rac-dim bg-rac-bg text-rac-muted hover:border-rac-line hover:text-rac-hi'
            "
            @click="selectedDomain = dom.key"
          >
            {{ dom.label }} ({{ domainCount(dom.key) }})
          </button>
        </div>
        <span class="font-mono text-[11px] text-rac-muted">
          当前活跃暗流 {{ activeEvolutions.length }} / 5
        </span>
      </div>

      <!-- 空状态 -->
      <div
        v-if="filteredActiveEvolutions.length === 0"
        class="rounded-[3px] border border-dashed border-rac-dim bg-rac-panel/50 py-6 text-center text-[12px] text-rac-muted"
        data-test="wevo-active-empty"
      >
        当前象限下暂无活跃演进中的世界暗流记录
      </div>

      <!-- 活跃世界演变导演级监控卡片列表 -->
      <div v-else class="flex flex-col gap-2.5" data-test="wevo-active-list">
        <article
          v-for="evo in filteredActiveEvolutions"
          :key="evo.id"
          class="flex flex-col gap-2 rounded-[3px] border p-2.5 transition-colors"
          :class="
            evo.stage === '高潮'
              ? 'border-[var(--rac-alert)]/60 bg-[var(--rac-alert)]/10'
              : evo.pinned
                ? 'border-[var(--rac-warn)]/55 bg-[var(--rac-panel-2)]'
                : 'border-rac-dim bg-rac-panel'
          "
          data-test="wevo-active-card"
          :data-testid="'wevo-active-card'"
          :data-evo-id="evo.id"
          :data-domain="evo.domain"
          :data-stage="evo.stage"
        >
          <!-- 首行：象限徽章 + 标题 + TTL / 锁定状态 + 张力值 -->
          <div class="flex flex-wrap items-center justify-between gap-1.5">
            <div class="flex min-w-0 flex-wrap items-center gap-1.5">
              <span
                class="shrink-0 rounded-[2px] border px-1.5 py-0.5 font-mono text-[12px] font-bold"
                :class="domainBadgeClass(evo.domain)"
                data-test="wevo-card-domain"
              >
                ◆ {{ evo.domain }}
              </span>
              <span
                class="truncate text-[12px] font-bold text-rac-hi"
                data-test="wevo-card-title"
              >
                {{ evo.title }}
              </span>
            </div>

            <div class="flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
              <span
                class="rounded-[2px] border border-[var(--rac-warn)]/40 bg-[var(--rac-warn)]/15 px-1.5 py-0.5 text-[var(--rac-warn)]"
                data-test="wevo-tension"
              >
                ▲ 张力 {{ evo.tension }}%
              </span>
              <span
                class="rounded-[2px] border px-1.5 py-0.5 font-bold"
                :class="
                  evo.pinned
                    ? 'border-[var(--rac-warn)]/60 bg-[var(--rac-warn)]/20 text-[var(--rac-hi)]'
                    : 'border-[var(--rac-dim)] bg-[var(--rac-panel-2)] text-[var(--rac-text)]'
                "
                data-test="wevo-ttl-badge"
              >
                {{ evo.pinned ? '◆ 已锁定常驻' : `◇ TTL ${evo.ttl_floors} 轮` }}
              </span>
            </div>
          </div>

          <!-- 四阶段演进轨迹条：萌芽 → 发酵 → 高潮 → 平息 -->
          <div
            class="flex items-center gap-1 rounded-[2px] border border-rac-dim/70 bg-black/35 px-2 py-1 font-mono text-[12px]"
            data-test="wevo-stage-track"
          >
            <template v-for="(step, idx) in WORLD_EVO_STAGES" :key="step">
              <span
                class="rounded-[2px] px-1.5 py-0.5 transition-colors"
                :class="stageStepClass(step, evo.stage)"
                :data-stage-step="step"
                :data-active="evo.stage === step ? 'true' : 'false'"
              >
                {{ step }}
              </span>
              <span v-if="idx < WORLD_EVO_STAGES.length - 1" class="text-rac-muted">→</span>
            </template>
          </div>

          <!-- 前序演变链路 -->
          <div
            v-if="evo.evolves_from"
            class="font-mono text-[12px] text-[var(--rac-accent)]"
            data-test="wevo-evolves-from"
          >
            → 承接自: {{ evo.evolves_from }}
          </div>

          <!-- 完整内幕摘要 -->
          <p
            class="text-[12px] leading-relaxed text-rac-text select-text"
            data-test="wevo-summary"
          >
            {{ evo.summary }}
          </p>

          <!-- 趋势预测 -->
          <div
            v-if="evo.trend"
            class="rounded-[2px] border border-[var(--rac-warn)]/35 bg-[var(--rac-warn)]/12 px-2 py-1 text-[12px] text-[var(--rac-warn)] select-text"
            data-test="wevo-trend"
          >
            ▲ 趋势预测：{{ evo.trend }}
          </div>

          <!-- 底部三合一操作栏 -->
          <div class="mt-0.5 flex flex-wrap items-center justify-end gap-1.5 border-t border-rac-dim/60 pt-1.5">
            <button
              type="button"
              data-test="wevo-pin-btn"
              class="cursor-pointer rounded-[2px] border px-2 py-0.5 font-mono text-[12px] font-bold transition-colors"
              :class="
                evo.pinned
                  ? 'border-[var(--rac-warn)]/70 bg-[var(--rac-warn)]/25 text-[var(--rac-hi)]'
                  : 'border-rac-dim bg-rac-bg text-rac-muted hover:border-[var(--rac-warn)]/50 hover:text-[var(--rac-warn)]'
              "
              @click="onTogglePin(evo)"
            >
              {{ evo.pinned ? '◆ 解除锁定' : '◇ 置顶锁 TTL' }}
            </button>

            <button
              type="button"
              data-test="wevo-archive-wb-btn"
              class="cursor-pointer rounded-[2px] border border-[var(--rac-ok)]/50 bg-[var(--rac-ok)]/15 px-2 py-0.5 font-mono text-[12px] font-bold text-[var(--rac-ok)] transition-colors hover:bg-[var(--rac-ok)]/25"
              @click="onArchiveActiveToWb(evo)"
            >
              ◆ 沉淀入世界书 L3
            </button>

            <button
              type="button"
              data-test="wevo-act-btn"
              class="cursor-pointer rounded-[2px] border border-[var(--rac-accent)]/55 bg-[var(--rac-accent)]/15 px-2 py-0.5 font-mono text-[12px] font-bold text-[var(--rac-hi)] transition-colors hover:bg-[var(--rac-accent)]/25"
              @click="onConvertToReconCommand(evo)"
            >
              {{ lastActedEvoId === evo.id ? '◆ 已填入侦察指令' : '→ 转化为前线侦察指令' }}
            </button>
          </div>
        </article>
      </div>
    </template>

    <!-- ══════════════════ 子页②：历史平息归档 (L2·L3) ══════════════════ -->
    <template v-else>
      <div
        class="flex items-center justify-between rounded-[3px] border border-rac-dim bg-rac-panel px-2.5 py-1.5 font-mono text-[12px] text-rac-muted"
      >
        <span>已平息或完结的历史暗流记录（共 {{ archivedEvolutions.length }} 条记录）</span>
        <span>L3 世界书已入档：{{ archivedEvolutions.filter(a => a.archived_to_wb).length }} 条</span>
      </div>

      <div
        v-if="archivedEvolutions.length === 0"
        class="rounded-[3px] border border-dashed border-rac-dim bg-rac-panel/50 py-6 text-center text-[12px] text-rac-muted"
        data-test="wevo-archived-empty"
      >
        暂无已平息或归档的历史世界演变记录
      </div>

      <div v-else class="flex flex-col gap-2" data-test="wevo-archived-list">
        <article
          v-for="arc in archivedEvolutions"
          :key="arc.id"
          class="flex flex-col gap-1.5 rounded-[3px] border border-rac-dim bg-rac-panel p-2.5"
          data-test="wevo-archived-card"
          :data-testid="'wevo-archived-card'"
          :data-evo-id="arc.id"
          :data-domain="arc.domain"
          :data-stage="arc.stage"
        >
          <div class="flex flex-wrap items-center justify-between gap-1.5">
            <div class="flex min-w-0 flex-wrap items-center gap-1.5">
              <span
                class="shrink-0 rounded-[2px] border px-1.5 py-0.5 font-mono text-[12px] font-bold"
                :class="domainBadgeClass(arc.domain)"
              >
                ◆ {{ arc.domain }}
              </span>
              <span class="rounded-[2px] bg-[var(--rac-panel-2)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--rac-text)]">
                最终阶段: {{ arc.stage }}
              </span>
              <span class="truncate text-[12px] font-bold text-rac-hi">
                {{ arc.title }}
              </span>
            </div>

            <span
              class="rounded-[2px] border px-1.5 py-0.5 font-mono text-[12px] font-bold"
              :class="
                arc.archived_to_wb
                  ? 'border-[var(--rac-ok)]/50 bg-[var(--rac-ok)]/15 text-[var(--rac-ok)]'
                  : 'border-[var(--rac-warn)]/45 bg-[var(--rac-warn)]/15 text-[var(--rac-warn)]'
              "
              data-test="wevo-archived-wb-status"
            >
              {{ arc.archived_to_wb ? '◆ L3 世界书已入档' : '◇ L3 世界书待入档' }}
            </span>
          </div>

          <p class="text-[12px] leading-relaxed text-rac-text select-text">
            {{ arc.summary }}
          </p>

          <div class="mt-0.5 flex items-center justify-end border-t border-rac-dim/50 pt-1.5">
            <button
              type="button"
              data-test="wevo-archived-to-wb-btn"
              class="cursor-pointer rounded-[2px] border px-2 py-0.5 font-mono text-[12px] font-bold transition-colors"
              :class="
                arc.archived_to_wb
                  ? 'border-[var(--rac-ok)]/50 bg-[var(--rac-ok)]/15 text-[var(--rac-ok)]'
                  : 'border-[var(--rac-accent)]/55 bg-[var(--rac-accent)]/15 text-[var(--rac-hi)] hover:bg-[var(--rac-accent)]/25'
              "
              @click="onArchiveHistoryToWb(arc)"
            >
              {{ arc.archived_to_wb ? '◆ 已沉淀入世界书 L3' : '→ 沉淀入世界书 L3' }}
            </button>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { getActivePinia } from 'pinia';
import { computed, onMounted, ref } from 'vue';
import { useDataStore } from '../../红警指挥系统/composables/store';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { setWorldEvolutionFloorMode } from '../cards/floorCardExtraMounts';
import { updateFloorVars } from '../host/floorVarWrite';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { fillHostSendInput } from '../../红警指挥系统/worldbook/hostSendInput';
import type { PendingLoreEntry } from '../../红警指挥系统/worldbook/pendingLoreGate';

export type WorldEvoFloorMode = 'hidden' | 'pulse';
export type WorldEvoDomainType = '远方地缘' | '位面异象' | '暗流科技' | '社会黑市';
export type WorldEvoStageType = '萌芽' | '发酵' | '显化' | '高潮' | '平息';

const WORLD_EVO_FLOOR_MODE_STORAGE_KEY = 'rac_world_evo_floor_mode_v1';
const WORLD_EVO_STAGES: readonly WorldEvoStageType[] = ['萌芽', '发酵', '高潮', '平息'] as const;
const DOMAIN_FILTER_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: '远方地缘', label: '远方地缘' },
  { key: '位面异象', label: '位面异象' },
  { key: '暗流科技', label: '暗流科技' },
  { key: '社会黑市', label: '社会黑市' },
] as const;

export interface WorldEvolutionItemLike {
  id?: string;
  title?: string;
  src?: string;
  domain?: string;
  evo_domain?: string;
  stage?: string;
  ttl_floors?: number;
  ttl?: number;
  tension?: number;
  evolves_from?: string;
  summary?: string;
  content?: string;
  trend?: string;
  hook?: string;
  pinned?: boolean;
  kind?: string;
  scope?: string;
  archived_to_wb?: boolean;
  date?: string;
}

export interface NormalizedWorldEvolutionItem {
  id: string;
  title: string;
  domain: string;
  stage: string;
  ttl_floors: number;
  tension: number;
  evolves_from: string;
  summary: string;
  trend: string;
  pinned: boolean;
  kind: string;
  archived_to_wb: boolean;
  raw: WorldEvolutionItemLike;
}

const props = withDefaults(
  defineProps<{
    page?: 'active' | 'archived';
    worldEvolutions?: readonly WorldEvolutionItemLike[];
    intelArchived?: readonly WorldEvolutionItemLike[];
  }>(),
  {
    page: 'active',
  },
);

const emit = defineEmits<{
  (e: 'change-floor-mode', mode: WorldEvoFloorMode): void;
  (e: 'toggle-pin', item: NormalizedWorldEvolutionItem, pinned: boolean): void;
  (e: 'archive-to-wb', item: NormalizedWorldEvolutionItem): void;
  (e: 'convert-to-recon', item: NormalizedWorldEvolutionItem, commandText: string): void;
}>();

const currentPage = computed(() => (props.page === 'archived' ? 'archived' : 'active'));

function readInitialFloorMode(): WorldEvoFloorMode {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(WORLD_EVO_FLOOR_MODE_STORAGE_KEY);
      if (v === 'pulse' || v === 'hidden') return v;
    }
  } catch {
    /* ignore */
  }
  return 'hidden';
}

const floorMode = ref<WorldEvoFloorMode>(readInitialFloorMode());
const selectedDomain = ref<string>('all');
const lastActedEvoId = ref<string | null>(null);
const revisionTick = ref(0);
const pinnedOverrides = ref<Record<string, boolean>>({});
const movedToArchiveIds = ref<Set<string>>(new Set());
const localArchivedList = ref<WorldEvolutionItemLike[]>([]);
const wbArchivedIds = ref<Set<string>>(new Set());

function syncFloorStealthNodesInDom(mode: WorldEvoFloorMode) {
  try {
    const docs: Document[] = [];
    if (typeof document !== 'undefined') docs.push(document);
    if (typeof window !== 'undefined' && window.parent?.document && window.parent.document !== document) {
      docs.push(window.parent.document);
    }
    const ownerDoc =
      typeof window !== 'undefined'
        ? (window.frameElement as HTMLElement | null | undefined)?.ownerDocument
        : undefined;
    if (ownerDoc && !docs.includes(ownerDoc)) {
      docs.push(ownerDoc);
    }

    for (const doc of docs) {
      setWorldEvolutionFloorMode(mode, doc);
      const hosts = doc.querySelectorAll('[data-card-type="world-evolution-stealth"], [data-tw-card="world-evolution-stealth"]');
      hosts.forEach(node => {
        const el = node as HTMLElement;
        el.setAttribute('data-stealth-mode', mode);
        if (mode === 'hidden') {
          el.style.display = 'none';
        } else {
          el.style.display = '';
        }
      });
    }

    if (typeof window !== 'undefined') {
      const hook = (window as unknown as { __racRefreshWorldEvolutionFloorMode?: (m: WorldEvoFloorMode) => void })
        .__racRefreshWorldEvolutionFloorMode;
      if (typeof hook === 'function') {
        hook(mode);
      }
    }
  } catch {
    /* ignore */
  }
}

function setFloorStealthMode(mode: WorldEvoFloorMode) {
  floorMode.value = mode;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(WORLD_EVO_FLOOR_MODE_STORAGE_KEY, mode);
    }
  } catch {
    /* ignore */
  }
  syncFloorStealthNodesInDom(mode);
  emit('change-floor-mode', mode);
}

onMounted(() => {
  floorMode.value = readInitialFloorMode();
  syncFloorStealthNodesInDom(floorMode.value);
});

const dataStore = (() => {
  try {
    return useDataStore() as Record<string, unknown>;
  } catch {
    return null;
  }
})();

const floatingStore = (() => {
  try {
    return useFloatingStore() as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
})();

function collectRootStates(): Array<Record<string, unknown>> {
  const roots: Array<Record<string, unknown>> = [];
  const pushObj = (candidate: unknown) => {
    if (candidate && typeof candidate === 'object' && !roots.includes(candidate as Record<string, unknown>)) {
      roots.push(candidate as Record<string, unknown>);
    }
  };

  if (dataStore) {
    pushObj((dataStore as { stat?: unknown }).stat);
    const d = (dataStore as { data?: { value?: unknown } | unknown }).data;
    pushObj(d && typeof d === 'object' && 'value' in (d as Record<string, unknown>) ? (d as { value?: unknown }).value : d);
    pushObj((dataStore as { snapshot?: unknown }).snapshot);
  }
  if (floatingStore) {
    pushObj((floatingStore as { stat?: unknown }).stat);
    pushObj((floatingStore as { snapshot?: unknown }).snapshot);
  }
  try {
    const pinia = getActivePinia() as (ReturnType<typeof getActivePinia> & { _s?: Map<string, Record<string, unknown>> }) | undefined;
    if (pinia?._s) {
      for (const s of pinia._s.values()) {
        pushObj(s.stat);
        const sd = s.data;
        pushObj(sd && typeof sd === 'object' && 'value' in (sd as Record<string, unknown>) ? (sd as { value?: unknown }).value : sd);
        pushObj(s.snapshot);
      }
    }
  } catch {
    /* ignore */
  }
  return roots;
}

const KNOWN_DOMAINS = new Set<string>(['远方地缘', '位面异象', '暗流科技', '社会黑市']);

function isArchivedWorldEvolutionItem(item: WorldEvolutionItemLike | null | undefined): boolean {
  if (!item || typeof item !== 'object') return false;
  if (item.kind === 'world' || item.scope === 'world') return true;
  if (item.stage && ['萌芽', '发酵', '显化', '高潮', '平息'].includes(String(item.stage))) return true;
  const dom = String(item.domain || item.evo_domain || '').trim();
  if (KNOWN_DOMAINS.has(dom)) return true;
  return false;
}

function defaultTensionForStage(stage: string): number {
  switch (stage) {
    case '显化':
    case '高潮':
      return 85;
    case '发酵':
      return 55;
    case '平息':
      return 15;
    case '萌芽':
    default:
      return 25;
  }
}

function normalizeWorldEvolutionItem(
  item: WorldEvolutionItemLike,
  idx = 0,
): NormalizedWorldEvolutionItem {
  const title = String(item.title || item.src || item.summary || item.content || `暗流事件 #${idx + 1}`).trim();
  const id = String(item.id || title || `wevo_${idx}`).trim();
  const domain = String(item.domain || item.evo_domain || '远方地缘').trim();
  const stage = String(item.stage || '萌芽').trim();
  const rawTtl = typeof item.ttl_floors === 'number' ? item.ttl_floors : typeof item.ttl === 'number' ? item.ttl : 5;
  const ttl_floors = Math.max(0, Math.round(rawTtl));
  const rawTension = typeof item.tension === 'number' && Number.isFinite(item.tension) ? item.tension : defaultTensionForStage(stage);
  const tension = Math.max(0, Math.min(100, Math.round(rawTension)));
  const evolves_from = String(item.evolves_from || '').trim();
  const summary = String(item.summary ?? item.content ?? '').trim();
  const trend = String(item.trend ?? item.hook ?? '').trim();
  const pinned = Boolean(item.pinned);
  const kind = String(item.kind || item.scope || 'world');
  const archived_to_wb = Boolean(item.archived_to_wb);

  return {
    id,
    title,
    domain,
    stage,
    ttl_floors,
    tension,
    evolves_from,
    summary,
    trend,
    pinned,
    kind,
    archived_to_wb,
    raw: item,
  };
}

function readRawActiveEvolutions(): WorldEvolutionItemLike[] {
  void revisionTick.value;
  if (Array.isArray(props.worldEvolutions)) {
    return [...props.worldEvolutions];
  }
  const roots = collectRootStates();
  for (const root of roots) {
    const intelObj = root.intel as Record<string, unknown> | WorldEvolutionItemLike[] | undefined;
    if (intelObj && !Array.isArray(intelObj) && Array.isArray(intelObj.world_evolutions)) {
      return intelObj.world_evolutions as WorldEvolutionItemLike[];
    }
    if (Array.isArray(root.world_evolutions)) {
      return root.world_evolutions as WorldEvolutionItemLike[];
    }
    if (Array.isArray(intelObj)) {
      const worldItems = intelObj.filter(i => isArchivedWorldEvolutionItem(i));
      if (worldItems.length > 0) return worldItems;
    }
  }
  return [];
}

function readRawArchivedEvolutions(): WorldEvolutionItemLike[] {
  void revisionTick.value;
  if (Array.isArray(props.intelArchived)) {
    return props.intelArchived.filter(i => isArchivedWorldEvolutionItem(i));
  }
  const roots = collectRootStates();
  for (const root of roots) {
    const intelObj = root.intel as Record<string, unknown> | undefined;
    if (intelObj && !Array.isArray(intelObj) && Array.isArray(intelObj.intel_archived)) {
      return (intelObj.intel_archived as WorldEvolutionItemLike[]).filter(i => isArchivedWorldEvolutionItem(i));
    }
    if (Array.isArray(root.intel_archived)) {
      return (root.intel_archived as WorldEvolutionItemLike[]).filter(i => isArchivedWorldEvolutionItem(i));
    }
  }
  return [];
}

const activeEvolutions = computed<NormalizedWorldEvolutionItem[]>(() => {
  void revisionTick.value;
  const rawList = readRawActiveEvolutions();
  return rawList
    .map((item, idx) => normalizeWorldEvolutionItem(item, idx))
    .filter(item => !movedToArchiveIds.value.has(item.id))
    .map(item => ({
      ...item,
      pinned: item.id in pinnedOverrides.value ? pinnedOverrides.value[item.id]! : item.pinned,
    }));
});

const filteredActiveEvolutions = computed<NormalizedWorldEvolutionItem[]>(() => {
  if (selectedDomain.value === 'all') return activeEvolutions.value;
  return activeEvolutions.value.filter(e => e.domain === selectedDomain.value);
});

const archivedEvolutions = computed<NormalizedWorldEvolutionItem[]>(() => {
  void revisionTick.value;
  const rawArchived = readRawArchivedEvolutions();
  const combined: WorldEvolutionItemLike[] = [...rawArchived];
  for (const extra of localArchivedList.value) {
    const extraNorm = normalizeWorldEvolutionItem(extra);
    if (!combined.some((c, i) => normalizeWorldEvolutionItem(c, i).id === extraNorm.id)) {
      combined.push(extra);
    }
  }
  return combined.map((item, idx) => {
    const norm = normalizeWorldEvolutionItem(item, idx);
    return {
      ...norm,
      archived_to_wb: wbArchivedIds.value.has(norm.id) ? true : norm.archived_to_wb,
    };
  });
});

const climaxCount = computed(() =>
  activeEvolutions.value.filter(e => e.stage === '高潮' || e.stage === '显化').length,
);

function domainCount(domainKey: string): number {
  if (domainKey === 'all') return activeEvolutions.value.length;
  return activeEvolutions.value.filter(e => e.domain === domainKey).length;
}

function domainBadgeClass(domain: string): string {
  switch (domain) {
    case '远方地缘':
      return 'border-[var(--rac-accent)]/45 bg-[var(--rac-accent)]/15 text-[var(--rac-accent)]';
    case '位面异象':
      return 'border-[var(--rac-focus)]/45 bg-[var(--rac-focus)]/15 text-[var(--rac-hi)]';
    case '暗流科技':
      return 'border-[var(--rac-ok)]/45 bg-[var(--rac-ok)]/15 text-[var(--rac-ok)]';
    case '社会黑市':
      return 'border-[var(--rac-warn)]/45 bg-[var(--rac-warn)]/15 text-[var(--rac-warn)]';
    default:
      return 'border-[var(--rac-dim)] bg-[var(--rac-panel-2)] text-[var(--rac-text)]';
  }
}

function stageStepClass(step: string, currentStage: string): string {
  const effectiveStage = currentStage === '显化' ? '高潮' : currentStage;
  if (step !== effectiveStage) {
    return 'text-rac-muted opacity-60';
  }
  if (step === '高潮') {
    return 'bg-[var(--rac-alert)]/25 font-bold text-[var(--rac-alert)] ring-1 ring-[var(--rac-alert)]/60';
  }
  if (step === '发酵') {
    return 'bg-[var(--rac-warn)]/25 font-bold text-[var(--rac-warn)] ring-1 ring-[var(--rac-warn)]/50';
  }
  if (step === '平息') {
    return 'bg-[var(--rac-dim)]/40 font-bold text-[var(--rac-text)] ring-1 ring-[var(--rac-line)]/50';
  }
  return 'bg-[var(--rac-accent)]/25 font-bold text-[var(--rac-hi)] ring-1 ring-[var(--rac-accent)]/50';
}

function onTogglePin(evo: NormalizedWorldEvolutionItem): boolean {
  const nextPinned = !evo.pinned;
  pinnedOverrides.value = {
    ...pinnedOverrides.value,
    [evo.id]: nextPinned,
  };
  try {
    evo.raw.pinned = nextPinned;
  } catch {
    /* ignore readonly */
  }
  for (const root of collectRootStates()) {
    const intelObj = root.intel as Record<string, unknown> | WorldEvolutionItemLike[] | undefined;
    if (intelObj && !Array.isArray(intelObj) && Array.isArray(intelObj.world_evolutions)) {
      for (const item of intelObj.world_evolutions as WorldEvolutionItemLike[]) {
        if (normalizeWorldEvolutionItem(item).id === evo.id) {
          item.pinned = nextPinned;
        }
      }
    } else if (Array.isArray(intelObj)) {
      for (const item of intelObj) {
        if (normalizeWorldEvolutionItem(item).id === evo.id) {
          item.pinned = nextPinned;
        }
      }
    }
  }
  revisionTick.value += 1;
  emit('toggle-pin', { ...evo, pinned: nextPinned }, nextPinned);
  return nextPinned;
}

function resolveCurrentFloorId(): number {
  const raw = (floatingStore as { floorId?: { value?: number | null } | number | null } | null)?.floorId;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === 'object' && typeof raw.value === 'number' && Number.isFinite(raw.value)) {
    return raw.value;
  }
  return 0;
}

function buildPendingLoreFromWorldEvo(
  item: NormalizedWorldEvolutionItem,
  archivedRecord: WorldEvolutionItemLike,
): PendingLoreEntry {
  const name = (item.title || item.id || '世界演变暗流').trim();
  const kind = item.domain === '暗流科技' ? '科技' : '其他';
  const summary = (item.summary || item.trend || name).trim();
  return {
    id: `lore_wevo_${item.id}`,
    kind,
    name,
    summary,
    source_floor: resolveCurrentFloorId(),
    source_swipe: -1,
    created_day: 0,
    raw: archivedRecord,
  };
}

function appendPendingLoreInRoot(root: Record<string, unknown>, loreEntry: PendingLoreEntry): void {
  if (!Array.isArray(root.pending_lore)) {
    root.pending_lore = [];
  }
  const pendingArr = root.pending_lore as Array<Record<string, unknown>>;
  const exists = pendingArr.some(
    x => x && typeof x === 'object' && (x.id === loreEntry.id || x.name === loreEntry.name),
  );
  if (!exists) {
    pendingArr.push(loreEntry as unknown as Record<string, unknown>);
  }
}

function onArchiveActiveToWb(evo: NormalizedWorldEvolutionItem) {
  const archivedRecord: WorldEvolutionItemLike = {
    ...evo.raw,
    id: evo.id,
    title: evo.title,
    domain: evo.domain,
    evo_domain: evo.domain,
    stage: evo.stage,
    summary: evo.summary,
    content: evo.summary,
    trend: evo.trend,
    kind: 'world',
    scope: 'world',
    archived_to_wb: true,
  };
  const loreEntry = buildPendingLoreFromWorldEvo(evo, archivedRecord);

  try {
    evo.raw.archived_to_wb = true;
  } catch {
    /* ignore */
  }

  for (const root of collectRootStates()) {
    const intelObj = root.intel as Record<string, unknown> | WorldEvolutionItemLike[] | undefined;
    if (intelObj && !Array.isArray(intelObj)) {
      if (Array.isArray(intelObj.world_evolutions)) {
        const list = intelObj.world_evolutions as WorldEvolutionItemLike[];
        const idx = list.findIndex((item, i) => normalizeWorldEvolutionItem(item, i).id === evo.id);
        if (idx >= 0) {
          list.splice(idx, 1);
        }
      }
      if (!Array.isArray(intelObj.intel_archived)) {
        intelObj.intel_archived = [];
      }
      const arcList = intelObj.intel_archived as WorldEvolutionItemLike[];
      const existing = arcList.find((item, i) => normalizeWorldEvolutionItem(item, i).id === evo.id);
      if (existing) {
        existing.archived_to_wb = true;
      } else {
        arcList.unshift(archivedRecord);
      }
    } else if (Array.isArray(intelObj)) {
      const idx = intelObj.findIndex((item, i) => normalizeWorldEvolutionItem(item, i).id === evo.id);
      if (idx >= 0) {
        intelObj.splice(idx, 1);
      }
      if (!Array.isArray(root.intel_archived)) {
        root.intel_archived = [];
      }
      const arcList = root.intel_archived as WorldEvolutionItemLike[];
      const existing = arcList.find((item, i) => normalizeWorldEvolutionItem(item, i).id === evo.id);
      if (existing) {
        existing.archived_to_wb = true;
      } else {
        arcList.unshift(archivedRecord);
      }
    }
    appendPendingLoreInRoot(root, loreEntry);
  }

  void updateFloorVars(resolveCurrentFloorId(), vars => {
    const sd = ((vars.stat_data ?? {}) as Record<string, unknown>);
    let nextIntel = sd.intel;
    let nextIntelArchived = Array.isArray(sd.intel_archived)
      ? [...(sd.intel_archived as WorldEvolutionItemLike[])]
      : undefined;

    if (sd.intel && typeof sd.intel === 'object' && !Array.isArray(sd.intel)) {
      const intelRec = { ...(sd.intel as Record<string, unknown>) };
      if (Array.isArray(intelRec.world_evolutions)) {
        intelRec.world_evolutions = (intelRec.world_evolutions as WorldEvolutionItemLike[]).filter(
          (item, i) => normalizeWorldEvolutionItem(item, i).id !== evo.id,
        );
      }
      const innerArc = Array.isArray(intelRec.intel_archived)
        ? [...(intelRec.intel_archived as WorldEvolutionItemLike[])]
        : [];
      const existingIdx = innerArc.findIndex((item, i) => normalizeWorldEvolutionItem(item, i).id === evo.id);
      if (existingIdx >= 0) {
        innerArc[existingIdx] = { ...innerArc[existingIdx], archived_to_wb: true };
      } else {
        innerArc.unshift(archivedRecord);
      }
      intelRec.intel_archived = innerArc;
      nextIntel = intelRec;
    } else if (Array.isArray(sd.intel)) {
      nextIntel = (sd.intel as WorldEvolutionItemLike[]).filter(
        (item, i) => normalizeWorldEvolutionItem(item, i).id !== evo.id,
      );
    }

    if (nextIntelArchived !== undefined || Array.isArray(sd.intel) || !sd.intel) {
      const arcArr = nextIntelArchived ?? [];
      const existingIdx = arcArr.findIndex((item, i) => normalizeWorldEvolutionItem(item, i).id === evo.id);
      if (existingIdx >= 0) {
        arcArr[existingIdx] = { ...arcArr[existingIdx], archived_to_wb: true };
      } else {
        arcArr.unshift(archivedRecord);
      }
      nextIntelArchived = arcArr;
    }

    const rawPending = Array.isArray(sd.pending_lore) ? [...(sd.pending_lore as unknown[])] : [];
    const exists = rawPending.some(
      e =>
        e &&
        typeof e === 'object' &&
        ((e as { id?: string }).id === loreEntry.id || (e as { name?: string }).name === loreEntry.name),
    );
    if (!exists) {
      rawPending.push(loreEntry);
    }

    return {
      ...vars,
      stat_data: {
        ...sd,
        ...(nextIntel !== undefined ? { intel: nextIntel } : {}),
        ...(nextIntelArchived !== undefined ? { intel_archived: nextIntelArchived } : {}),
        pending_lore: rawPending,
      },
    };
  }).catch(() => {
    /* 独立预览或无宿主 API 时安全降级 */
  });

  const nextMoved = new Set(movedToArchiveIds.value);
  nextMoved.add(evo.id);
  movedToArchiveIds.value = nextMoved;

  const nextWb = new Set(wbArchivedIds.value);
  nextWb.add(evo.id);
  wbArchivedIds.value = nextWb;

  localArchivedList.value = [archivedRecord, ...localArchivedList.value.filter(x => normalizeWorldEvolutionItem(x).id !== evo.id)];
  revisionTick.value += 1;
  emit('archive-to-wb', { ...evo, archived_to_wb: true });
}

function onArchiveHistoryToWb(arc: NormalizedWorldEvolutionItem) {
  const archivedRecord: WorldEvolutionItemLike = {
    ...arc.raw,
    id: arc.id,
    title: arc.title,
    domain: arc.domain,
    evo_domain: arc.domain,
    stage: arc.stage,
    summary: arc.summary,
    content: arc.summary,
    trend: arc.trend,
    kind: 'world',
    scope: 'world',
    archived_to_wb: true,
  };
  const loreEntry = buildPendingLoreFromWorldEvo(arc, archivedRecord);

  try {
    arc.raw.archived_to_wb = true;
  } catch {
    /* ignore */
  }
  for (const root of collectRootStates()) {
    const intelObj = root.intel as Record<string, unknown> | undefined;
    if (intelObj && !Array.isArray(intelObj) && Array.isArray(intelObj.intel_archived)) {
      for (const item of intelObj.intel_archived as WorldEvolutionItemLike[]) {
        if (normalizeWorldEvolutionItem(item).id === arc.id) {
          item.archived_to_wb = true;
        }
      }
    }
    if (Array.isArray(root.intel_archived)) {
      for (const item of root.intel_archived as WorldEvolutionItemLike[]) {
        if (normalizeWorldEvolutionItem(item).id === arc.id) {
          item.archived_to_wb = true;
        }
      }
    }
    appendPendingLoreInRoot(root, loreEntry);
  }

  void updateFloorVars(resolveCurrentFloorId(), vars => {
    const sd = ((vars.stat_data ?? {}) as Record<string, unknown>);
    let nextIntel = sd.intel;
    let nextIntelArchived = Array.isArray(sd.intel_archived)
      ? (sd.intel_archived as WorldEvolutionItemLike[]).map((item, i) =>
          normalizeWorldEvolutionItem(item, i).id === arc.id ? { ...item, archived_to_wb: true } : item,
        )
      : undefined;

    if (sd.intel && typeof sd.intel === 'object' && !Array.isArray(sd.intel)) {
      const intelRec = { ...(sd.intel as Record<string, unknown>) };
      if (Array.isArray(intelRec.intel_archived)) {
        intelRec.intel_archived = (intelRec.intel_archived as WorldEvolutionItemLike[]).map((item, i) =>
          normalizeWorldEvolutionItem(item, i).id === arc.id ? { ...item, archived_to_wb: true } : item,
        );
      }
      nextIntel = intelRec;
    }

    const rawPending = Array.isArray(sd.pending_lore) ? [...(sd.pending_lore as unknown[])] : [];
    const exists = rawPending.some(
      e =>
        e &&
        typeof e === 'object' &&
        ((e as { id?: string }).id === loreEntry.id || (e as { name?: string }).name === loreEntry.name),
    );
    if (!exists) {
      rawPending.push(loreEntry);
    }

    return {
      ...vars,
      stat_data: {
        ...sd,
        ...(nextIntel !== undefined ? { intel: nextIntel } : {}),
        ...(nextIntelArchived !== undefined ? { intel_archived: nextIntelArchived } : {}),
        pending_lore: rawPending,
      },
    };
  }).catch(() => {
    /* 独立预览或无宿主 API 时安全降级 */
  });

  const nextWb = new Set(wbArchivedIds.value);
  nextWb.add(arc.id);
  wbArchivedIds.value = nextWb;
  revisionTick.value += 1;
  emit('archive-to-wb', { ...arc, archived_to_wb: true });
}

function buildWorldEvoReconCommand(evo: { title: string; domain: string; stage: string }): string {
  return `【暗流侦察】针对宏观暗流「${evo.title}」（${evo.domain}·${evo.stage}），立即派遣侦察力量核实其对我方战区的潜在波及！`;
}

function fillReconCommandToHostInput(commandText: string): boolean {
  let filled = false;
  try {
    const parentDoc = typeof window !== 'undefined' ? window.parent?.document : undefined;
    const selfDoc = typeof document !== 'undefined' ? document : undefined;
    const frameDoc =
      typeof window !== 'undefined'
        ? (window.frameElement as HTMLElement | null | undefined)?.ownerDocument
        : undefined;
    const candidates = [
      parentDoc?.querySelector?.('#send_textarea'),
      selfDoc?.querySelector?.('#send_textarea'),
      frameDoc?.querySelector?.('#send_textarea'),
    ].filter((el, idx, arr): el is HTMLTextAreaElement => Boolean(el) && arr.indexOf(el) === idx);

    for (const textarea of candidates) {
      textarea.value = commandText;
      const ViewEvent = textarea.ownerDocument?.defaultView?.Event ?? Event;
      textarea.dispatchEvent(new ViewEvent('input', { bubbles: true }));
      textarea.dispatchEvent(new ViewEvent('change', { bubbles: true }));
      textarea.focus?.();
      filled = true;
    }
  } catch {
    /* ignore cross-origin */
  }
  if (!filled) {
    try {
      const res = fillHostSendInput(commandText);
      filled = res.ok;
    } catch {
      /* ignore */
    }
  }
  return filled;
}

function onConvertToReconCommand(evo: NormalizedWorldEvolutionItem): string {
  const commandText = buildWorldEvoReconCommand(evo);
  fillReconCommandToHostInput(commandText);
  lastActedEvoId.value = evo.id;
  emit('convert-to-recon', evo, commandText);
  return commandText;
}

defineExpose({
  floorMode,
  setFloorStealthMode,
  selectedDomain,
  activeEvolutions,
  filteredActiveEvolutions,
  archivedEvolutions,
  climaxCount,
  onTogglePin,
  onArchiveActiveToWb,
  onArchiveHistoryToWb,
  onConvertToReconCommand,
});
</script>

<style scoped>
.text-rac-muted { color: var(--rac-muted); }
.text-rac-hi { color: var(--rac-hi); }
.text-rac-text { color: var(--rac-text); }
.text-rac-focus { color: var(--rac-focus); }
.bg-rac-bg { background: var(--rac-bg); }
.bg-rac-panel { background: var(--rac-panel); }
.border-rac-dim { border-color: var(--rac-dim); }
.border-rac-focus { border-color: var(--rac-focus); }
.bg-rac-focus-soft { background: color-mix(in srgb, var(--rac-focus) 22%, transparent); }
.hover\:border-rac-line:hover { border-color: var(--rac-line); }
</style>
