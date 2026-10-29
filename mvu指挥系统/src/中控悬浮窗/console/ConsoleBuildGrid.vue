<template>
  <div class="ra-build-console flex min-h-0 flex-1 flex-col select-none">
    <!-- ══ 五大核心基建页签 ══ -->
    <nav
      class="ra-build-tabs grid grid-cols-5 gap-0.5 border-b border-[var(--rac-dim)] bg-[var(--rac-panel)] p-1"
      aria-label="基建建造类别"
    >
      <button
        v-for="tab in mainTabs"
        :key="tab.id"
        class="ra-tab-btn relative flex flex-col items-center justify-center rounded-[2px] px-0.5 py-1 transition-all"
        :class="{ 'ra-tab-btn--active': currentTab === tab.id }"
        :aria-current="currentTab === tab.id ? 'page' : undefined"
        :aria-label="`${tab.label} · ${tabCount(tab.id)} 项`"
        @click="selectTab(tab.id)"
      >
        <span class="ra-tab-led" />
        <Icon :name="tab.icon" :size="15" />
        <span class="mt-0.5 text-[11px] leading-none font-bold tracking-wider">{{ tab.label }}</span>
        <span class="ra-tab-tip" role="tooltip">
          {{ tab.label }} · {{ tabCount(tab.id) }} 项<template v-if="tab.domains.length">｜{{ tab.domains.join(' / ') }}</template>
        </span>
      </button>
    </nav>

    <!-- ══ 大类内子领域切换栏（基建/工业/科研/防御按领域；生产按人员/装备/陆空海） ══ -->
    <div
      v-if="subTabs.length"
      class="ra-sub-tabs flex items-center justify-center gap-1.5 border-b border-[var(--rac-accent)]/30 bg-[var(--rac-bg)] px-2 py-1"
    >
      <button
        v-for="sub in subTabs"
        :key="sub.id"
        class="ra-sub-btn relative flex items-center justify-center rounded-[2px] px-2.5 py-1 transition-all"
        :class="{ 'ra-sub-btn--active': currentSub === sub.id }"
        :aria-label="sub.label"
        @click="selectSub(sub.id)"
      >
        <Icon :name="sub.icon" :size="13" />
        <span class="ra-tab-tip ra-tab-tip--sub" role="tooltip">{{ sub.label }}</span>
      </button>
    </div>

    <!-- ══ 战术胶囊标签筛选、模糊搜索、收藏与阵营/状态紧凑合一栏 ══ -->
    <TagFilterBar
      v-model:search-query="searchQuery"
      v-model:selected-traits="selectedTraits"
      v-model:trait-match-mode="traitMatchMode"
      v-model:scope="filterScope"
      v-model:status-filter="statusFilter"
      v-model:selected-faction-filter="selectedFactionFilter"
      :trait-counts="traitCounts"
      :status-counts="statusCounts"
      :faction-pills="unlockedFactions.length >= 1 ? factionFilterPills : undefined"
      :show-compact-quick-bar="true"
      @reset="resetFilters"
    />

    <!-- ══ 建造网格调度面板（经典 2 列网格卡片） ══ -->
    <div class="ra-grid-container flex min-h-0 flex-1 flex-col overflow-hidden p-1.5">
      <!-- 空态指示 -->
      <div
        v-if="!currentItems.length"
        class="flex min-h-0 flex-1 flex-col items-center justify-center p-4 text-center font-mono text-[12px] text-[var(--rac-muted)]"
      >
        <Icon name="hammer" :size="20" class="mb-2 opacity-50" />
        <template v-if="preLaunchLocked">
          <div data-test="prelaunch-locked-panel" class="flex flex-col items-center text-center">
            <span class="font-bold tracking-wider text-[var(--rac-warn)]">
              EVA 战术链路尚未激活 · 待开局部署
            </span>
            <span class="mt-1.5 text-[12px] leading-relaxed text-[var(--rac-muted)]">
              请先在中央【战区开场启动器】完成世界战区、参战阵营、切入模式与初始坐标配置，并点击「确认部署并发射开场」。发射后中控台将自动接管战局。
            </span>
          </div>
        </template>
        <template v-else-if="hasActiveFilters">
          <span>{{ hasActiveFilters ? '未检索到匹配战术项目' : '当前类别暂无可调度项目' }}</span>
          <button
            class="ra-filter-reset-btn mt-2 rounded-[2px] border border-[var(--rac-accent)]/40 px-2 py-0.5 font-mono text-[12px] text-[var(--rac-accent)] transition-colors hover:bg-[var(--rac-accent)]/10"
            @click="resetFilters"
          >
            [重置筛选条件]
          </button>
        </template>
        <template v-else-if="isZeroBaseStandby">
          <div data-test="mcv-standby-panel" class="flex flex-col items-center text-center">
            <span class="font-bold text-[var(--rac-warn)]">
              MCV 机动待命 · 尚未展开基地（0 建筑可建）
            </span>
            <span v-if="plannedDeploySiteLabel" class="mt-1 text-[12px] text-[var(--rac-accent)]">
              拟定部署坐标：{{ plannedDeploySiteLabel }}
            </span>
            <template v-if="availableMcvInFleet">
              <span class="mt-1 text-[12px] leading-relaxed text-[var(--rac-text)]">
                车队待命载具：{{ availableMcvInFleet }} · 基地车展开为建造厂核心后，方可建立首座基地并解锁电力、矿场、兵营与防御建造序列
              </span>
              <button
                type="button"
                data-test="deploy-mcv-btn"
                class="ra-deploy-mcv-btn mt-2.5 rounded-[2px] border border-[var(--rac-accent)] bg-[var(--rac-accent)]/15 px-3 py-1 font-mono text-[12px] font-bold text-[var(--rac-hi)] transition-colors hover:bg-[var(--rac-accent)]/25"
                @click="handleDeployMcvClick"
              >
                → 【下达展开 MCV 指令】（{{ availableMcvInFleet }}）
              </button>
              <span
                v-if="mcvDeployStagedHint"
                data-test="deploy-mcv-hint"
                class="mt-1.5 text-[12px] text-[var(--rac-ok)]"
              >
                {{ mcvDeployStagedHint }}
              </span>
            </template>
            <template v-else-if="pendingMcvDeployment">
              <span class="mt-1 text-[12px] text-[var(--rac-warn)]">
                基地车正在展开：{{ pendingMcvDeployment.vehicle }} → {{ pendingMcvDeployment.into }}（预计剩余 {{ pendingMcvDeployment.remaining_minutes }} 分钟）
              </span>
            </template>
            <span v-else class="mt-1 text-[12px] leading-relaxed text-[var(--rac-muted)]">
              当前处于序章/潜行待机阶段，车队暂未接收 MCV 移动基地车 · 待完成跨界投送并展开基地车后解锁建造序列
            </span>
          </div>
        </template>
        <template v-else-if="currentTab !== '生产' && hasRuntimeBases && !hasOperationalConyard">
          <span class="font-bold text-[var(--rac-warn)]">
            当前基地「{{ currentBaseName }}」尚未展开建造厂核心（MCV）
          </span>
          <template v-if="availableMcvInFleet">
            <span class="mt-1 text-[12px] text-[var(--rac-text)]">
              车队待命载具：{{ availableMcvInFleet }} · 展开后即可解锁基建、工业、科研与防御建造序列
            </span>
            <button
              type="button"
              data-test="deploy-mcv-btn"
              class="ra-deploy-mcv-btn mt-2.5 rounded-[2px] border border-[var(--rac-accent)] bg-[var(--rac-accent)]/15 px-3 py-1 font-mono text-[12px] font-bold text-[var(--rac-hi)] transition-colors hover:bg-[var(--rac-accent)]/25"
              @click="handleDeployMcvClick"
            >
              → 【下达展开 MCV 指令】（{{ availableMcvInFleet }}）
            </button>
            <span
              v-if="mcvDeployStagedHint"
              data-test="deploy-mcv-hint"
              class="mt-1.5 text-[12px] text-[var(--rac-ok)]"
            >
              {{ mcvDeployStagedHint }}
            </span>
          </template>
          <span v-else class="mt-1 text-[12px] text-[var(--rac-muted)]">
            当前基地无运转中的建造厂，且车队中暂无可用 MCV 移动基地车
          </span>
        </template>
        <template v-else-if="currentTab === '生产' && hasRuntimeBases">
          <span>
            当前类别暂无已解锁可制造项目（需先在基地建成并运转对应生产建筑：兵营 / 个人装备制造所 / 战车工厂 / 空军指挥部 / 海军造船厂，并完成前置科技研发）
          </span>
        </template>
        <span v-else>当前类别暂无可调度项目</span>
      </div>

      <!-- 2 列建造图标网格（固定紧凑行高，行数随视口高度自适应；高度严格受限，绝不顶开切页栏） -->
      <!-- eslint-disable better-tailwindcss/enforce-consistent-class-order -->
      <div
        v-else
        ref="gridContainerRef"
        class="ra-grid-area flex-1 min-h-0 overflow-hidden grid grid-cols-2 gap-1.5 auto-rows-[60px] content-start"
      >
        <button
          v-for="item in pagedItems"
          :key="item.id"
          v-memo="[
            item.id,
            item.name,
            item.builtCount,
            item.isMaxedOut,
            item.isModernized,
            item.isFavorite,
            item.queueModel?.progress,
            item.queueModel?.tone,
            item.queueModel?.badge,
            item.queueModel?.predicate,
            item.liveStats?.builtCount,
            item.liveStats?.underConstructionCount,
            item.liveStats?.damagedCount,
            item.liveStats?.accelCount,
            item.liveStats?.mountedAddonCount,
            item.activeQueueCount,
            item.title,
          ]"
          class="ra-card ra-build-card ra-unit-card group relative flex flex-col justify-between overflow-hidden rounded-[3px] py-1 px-2 text-left transition-all"
          :class="{
            'ra-card--building': item.queueModel?.tone === 'run',
            'ra-card--maxed': item.isMaxedOut && !item.queueModel,
            'ra-card--fav': item.isFavorite,
          }"
          :data-maxed="item.isMaxedOut && !item.queueModel ? 'true' : undefined"
          :data-favorited="item.isFavorite ? 'true' : undefined"
          :title="cardTitle(item)"
          @click="openDetail(item.name)"
        >
          <!-- 队列状态进度光条（五态分色；仅 active 播脉冲，done/cancelled 静态） -->
          <div
            v-if="item.queueModel"
            class="ra-card-progress pointer-events-none absolute inset-y-0 left-0"
            :class="[
              // eslint-disable-next-line better-tailwindcss/no-concatenated-classes -- ra-* 为手写 scoped 类，不走 Tailwind purge
              `ra-card-progress--${item.queueModel.tone}`,
              { 'ra-card-progress--pulse': item.queueModel.pulsing },
            ]"
            :style="{ width: `${item.queueModel.progress}%` }"
          />

          <!-- 顶部：项目名称、收藏与建造/排队状态标签（D-BLD-04：移除常驻 已建N 与 ra-card--built） -->
          <div class="relative z-10 flex items-center justify-between gap-1 leading-tight">
            <span class="ra-card-name truncate text-[12px] leading-tight font-bold text-[var(--rac-hi)]">
              {{ item.name }}
            </span>
            <div class="flex flex-none items-center gap-0.5">
              <span
                v-if="item.queueModel"
                data-test="build-card-queue-badge"
                class="ra-card-tag ra-card-tag--queue flex-none"
                :class="[
                  // eslint-disable-next-line better-tailwindcss/no-concatenated-classes -- ra-* 为手写 scoped 类，不走 Tailwind purge
                  `ra-card-tag--queue--${item.queueModel.tone}`,
                  { 'animate-pulse': item.queueModel.pulsing },
                ]"
                :title="item.queueModel.settlingHint"
              >
                {{ (item.activeQueueCount ?? 0) > 1 ? `${item.queueModel.badge}×${item.activeQueueCount}` : item.queueModel.badge }}
              </span>
              <span
                v-else-if="item.isMaxedOut"
                class="ra-card-tag ra-card-tag--maxed flex-none"
                data-test="prod-maxed-badge"
              >
                不可再生产
              </span>
              <span
                v-else-if="item.isModernized"
                class="ra-card-tag ra-card-tag--modernized flex-none"
                data-test="prod-modernized-badge"
                :title="`直产现代改型号（原基础型：${item.baseUnitName}）`"
              >
                现代改
              </span>
              <span v-else-if="item.dynamic" class="ra-card-tag ra-card-tag--eva flex-none"> EVA </span>

              <template v-if="item.category !== '生产' && item.liveStats">
                <span
                  v-if="item.liveStats.builtCount > 0"
                  data-test="build-card-built-pill"
                  class="ra-card-tag ra-card-tag--built flex-none"
                  :title="`本基地已建 ${item.liveStats.builtCount} 座`"
                >
                  ×{{ item.liveStats.builtCount }}
                </span>
                <span
                  v-if="item.liveStats.underConstructionCount > 0 && !item.queueModel"
                  data-test="build-card-constructing-pill"
                  class="ra-card-tag ra-card-tag--queue--run flex-none"
                  :title="`本基地正在施工 ${item.liveStats.underConstructionCount} 座`"
                >
                  在建×{{ item.liveStats.underConstructionCount }}
                </span>
                <span
                  v-if="item.liveStats.accelCount > 0"
                  data-test="build-card-accel-pill"
                  class="ra-card-tag ra-card-tag--accel flex-none"
                  title="双模并联加速运转中"
                >
                  ▲加速{{ item.liveStats.accelCount }}
                </span>
                <span
                  v-if="item.liveStats.damagedCount > 0"
                  data-test="build-card-damaged-pill"
                  class="ra-card-tag ra-card-tag--damaged flex-none"
                  title="存在受损建筑实例，点击查阅并抢修"
                >
                  ▲损{{ item.liveStats.damagedCount }}
                </span>
                <span
                  v-if="item.liveStats.mountedAddonCount > 0"
                  data-test="build-card-addon-pill"
                  class="ra-card-tag ra-card-tag--addon flex-none"
                  title="已挂载母体扩建模块"
                >
                  +{{ item.liveStats.mountedAddonCount }}
                </span>
              </template>

              <!-- ◆ 收藏切换按钮（独立点击不打开详情抽屉） -->
              <span
                role="button"
                tabindex="-1"
                data-test="build-card-fav-btn"
                class="ra-card-fav flex-none rounded-[2px] px-0.5 font-mono text-[11px] leading-none transition-opacity"
                :class="
                  item.isFavorite
                    ? 'text-[var(--rac-warn)] opacity-100'
                    : 'text-[var(--rac-muted)] opacity-35 group-hover:opacity-90 hover:text-[var(--rac-hi)]'
                "
                :title="item.isFavorite ? '取消收藏（不再置顶）' : '收藏该项目（列表内置顶，支持一键筛选）'"
                @click.stop="onToggleFavorite(item)"
              >
                {{ item.isFavorite ? '◆' : '◇' }}
              </span>
            </div>
          </div>

          <!-- 中部：造价与电力/资源需求 -->
          <div class="relative z-10 flex items-center justify-between font-mono text-[11px] leading-none">
            <span class="font-semibold text-[var(--rac-hi)]">${{ item.cost }}</span>
            <span
              v-if="item.power !== undefined"
              class="inline-flex items-center"
              :class="item.power < 0 ? 'text-[var(--rac-ok)]' : item.power > 0 ? 'text-[var(--rac-warn)]' : 'text-[var(--rac-muted)]'"
            >
              <Icon name="power" :size="11" class="mr-0.5" />{{ item.power < 0 ? `+${Math.abs(item.power)}` : item.power > 0 ? `-${item.power}` : '0' }}
            </span>
          </div>

          <!-- 底部：在册条目出同源状态谓语（进度X%；尚需T／批次三段式／待收讫），已达上限出不可再生产提示，其余出前置摘要 -->
          <div class="relative z-10 flex items-center justify-between truncate text-[11px] leading-tight text-[var(--rac-muted)]">
            <span class="truncate">{{
              item.queueModel
                ? item.queueModel.predicate
                : item.isMaxedOut
                  ? `已达上限 (${item.builtCount}/${item.maxCount}) · 不可再生产`
                  : item.prereq || item.meta || '常规列装'
            }}</span>
            <span
              v-if="item.tags && item.tags.length"
              class="ra-card-tag-pill ml-1 flex-none rounded-[1px] border border-[var(--rac-accent)]/20 bg-[var(--rac-accent)]/10 px-1 font-mono text-[11px] text-[var(--rac-accent)]/80"
            >
              {{ item.tags[0] }}
            </span>
          </div>
        </button>
      </div>

      <!-- ══ 最底侧翻页键（经典双三角 ▲ 与 ▼；flex-none 永远钉底，绝不被网格顶开） ══ -->
      <!-- eslint-disable better-tailwindcss/enforce-consistent-class-order -->
      <footer
        class="ra-pager flex-none flex items-center justify-between pt-1.5 px-2 border-t border-[var(--rac-dim)]/40 mt-1"
      >
        <!-- 上一页双三角键 -->
        <button
          class="ra-page-btn flex items-center gap-1 rounded-[2px] px-2 py-1"
          :disabled="currentPage <= 0"
          aria-label="上一页"
          title="上一页"
          @click="prevPage"
        >
          <span class="text-[11px]">▲</span>
          <span class="font-mono text-[11px]">PREV</span>
        </button>

        <!-- 页码指示器 -->
        <div class="ra-page-indicator font-mono text-[11px] text-[var(--rac-muted)]">
          <span class="font-bold text-[var(--rac-accent)]">{{ currentPage + 1 }}</span>
          <span class="opacity-50"> / </span>
          <span>{{ totalPages }}</span>
        </div>

        <!-- 下一页双三角键 -->
        <button
          class="ra-page-btn flex items-center gap-1 rounded-[2px] px-2 py-1"
          :disabled="currentPage >= totalPages - 1"
          aria-label="下一页"
          title="下一页"
          @click="nextPage"
        >
          <span class="font-mono text-[11px]">NEXT</span>
          <span class="text-[11px]">▼</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useElementSize } from '@vueuse/core';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import type { CodexEntry, QueueItem, Schema } from '../../红警指挥系统/core/schema';
import {
  buildEntityCredibilityIndex,
  isSystemCatalogEntity,
} from '../../红警指挥系统/core/entityCredibility';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import {
  isDebugBypassPrerequisitesActive,
  isDebugUnlockAllFactionsActive,
} from '../../红警指挥系统/composables/useDebugMode';
import { openLookup } from '../../红警指挥系统/composables/useDetail';
import TagFilterBar from './TagFilterBar.vue';
import {
  BUILD_PANEL_GROUPS,
  PRIMARY_DOMAINS,
  PRODUCTION_SUBS,
  SUB_TAB_ICONS,
  domainsOfBuilding,
  inferItemTags,
  inferProductionSubTab,
  isConyardOriginBuilding,
  isEquipmentProduction,
  isSingleInstancePerBaseBuilding,
  matchItem,
  sortBuildGridItems,
  stripFactionBuildingPrefix,
} from '../models/tagTaxonomy';
import type { BuildPanelGroupId } from '../models/tagTaxonomy';
import { stripMassProductionSuffix } from '../models/worldbookCatalogParser';
import type { QueueDisplayModel } from '../models/queueDisplayModel';
import { makeProdLaneKeyFor, prodLaneIndexFromCatalog } from '../../红警指挥系统/engines/productionLanes';
import type { EffectiveCatalog } from '../../红警指挥系统/core/catalogEffective';
import {
  deriveBuildableWithContext as catalogDeriveBuildableWithContext,
  deriveProducibleWithContext,
} from '../../红警指挥系统/core/catalog';
import { buildCatalogPrerequisiteContext } from '../../红警指挥系统/core/catalogRuntimeContext';
import * as prerequisitesModule from '../../红警指挥系统/core/prerequisites';
import { fillHostSendInput } from '../../红警指挥系统/worldbook/hostSendInput';
import {
  playTacticalStagger,
  scheduleNextFrame,
} from '../../红警指挥系统/ui/motion/useGsapMotion';
import {
  CONYARD_BUILDING_NAMES,
  CONSTRUCTION_YARDS,
  FACTION_LABELS,
  bucketBuilding,
  buildActiveQueueCountMap,
  buildBaseBuildingLiveStatsMap,
  buildBaseMotherBuildingCache,
  buildBuiltCountMap,
  buildCatalogCanonNames,
  buildCompletedTechAndProtocolSet,
  buildDeployMcvOrderText,
  buildFactionFilterPills,
  buildPrerequisiteContext,
  buildQueueDisplayModel,
  buildQueueMap,
  buildResearchTierMap,
  buildSubTabsForGroup,
  checkBaseHasFactionMotherBuilding,
  checkHasOperationalConyard,
  checkIsZeroBaseStandby,
  computeBuildQuickStatusCounts,
  computeTraitCounts,
  domainsOf,
  filterItemsByFaction,
  formatBuildCardTitle,
  inferBuildEntryFaction,
  inferProductionUnlockTierFromMap,
  isBuildItemFavorited,
  isDuplicateCodexEntry,
  isIndividualCharacterCodexEntry,
  isMcvVehicleName,
  loadBuildFavoritesFromStorage,
  matchBuildQuickStatus,
  parseCodexEntryMeta,
  resolveAvailableMcvInFleet,
  resolveBaseConyardFactions,
  resolveCurrentBase,
  resolveEffectiveFilterScope,
  resolveModernizedProductionUnit,
  resolvePlannedDeploySiteName,
  resolveProductionBuiltCount,
  resolveProductionQueueItem,
  resolveUnlockedFactions,
  saveBuildFavoritesToStorage,
  shouldSkipBuildingEntry,
  sortBuildGridItemsWithFavorites,
  toggleBuildFavoriteInSet,
} from './consoleBuildGridHelpers';
import type { BuildingCardLiveStats, BuildQuickStatusFilter, MainTabId, SubTabId } from './consoleBuildGridHelpers';

const props = withDefaults(
  defineProps<{
    snapshot: Schema | null;
    activeBaseIndex?: number;
    initialTab?: MainTabId;
    preLaunchLocked?: boolean;
  }>(),
  {
    activeBaseIndex: 0,
    initialTab: '基建',
    preLaunchLocked: false,
  },
);

const catalog = useCatalogStore();

const gridContainerRef = ref<HTMLElement | null>(null);
const { height: containerHeight } = useElementSize(gridContainerRef);

/** 网格几何常量：固定紧凑行高 60px（经典红警侧栏图标尺寸）+ gap-1.5 行间距 */
const GRID_ROW_HEIGHT = 60;
const GRID_ROW_GAP = 6;

/** 五大类页签（建造面板改版：基建/工业/科研/防御/生产；巨构已退役并全权交由工程系统承载） */
const mainTabs = BUILD_PANEL_GROUPS.map(g => ({ id: g.id as MainTabId, label: g.label, icon: g.icon, domains: g.domains }));

/** 生产大类子页签由 tagTaxonomy.PRODUCTION_SUBS 单一事实源供给（'人员' / '装备' / '陆军' / '空军' / '海军'） */

const currentTab = ref<MainTabId>(props.initialTab);
const currentSub = ref<SubTabId>('全部');
const currentPage = ref(0);

const dynamicPageSize = computed(() => {
  const h = containerHeight.value;
  if (!h || h <= 0) return 6;
  const rows = Math.max(2, Math.floor((h + GRID_ROW_GAP) / (GRID_ROW_HEIGHT + GRID_ROW_GAP)));
  return rows * 2;
});

const pageSize = dynamicPageSize;
const codex = computed<CodexEntry[]>(() => props.snapshot?.codex ?? []);
const catalogBuildingNameSet = computed<Set<string>>(
  () => new Set((catalog.buildings ?? []).map(b => b.name.trim()).filter(Boolean)),
);
const builtCountMap = computed(() => buildBuiltCountMap(props.snapshot, props.activeBaseIndex));
const buildingLiveStatsMap = computed(() =>
  buildBaseBuildingLiveStatsMap(props.snapshot, props.activeBaseIndex, catalogBuildingNameSet.value),
);
const activeQueueCountMap = computed(() =>
  buildActiveQueueCountMap(props.snapshot, props.activeBaseIndex, catalogBuildingNameSet.value),
);
const queueMap = computed(() => buildQueueMap(props.snapshot));

function deriveBuildableWithContext<T extends { name: string }>(
  items: readonly T[],
  ctx: NonNullable<ReturnType<typeof buildCatalogPrerequisiteContext>>,
): T[] {
  const fn =
    (prerequisitesModule as { deriveBuildableWithContext?: (...args: unknown[]) => T[] })
      .deriveBuildableWithContext ?? catalogDeriveBuildableWithContext;
  return (fn as (items: readonly T[], ctx: unknown, queued?: readonly string[]) => T[])(items, ctx, []);
}

const prerequisiteContext = computed(() =>
  buildPrerequisiteContext(props.snapshot, props.activeBaseIndex, catalog.protocols),
);

const currentBase = computed(() => resolveCurrentBase(props.snapshot, props.activeBaseIndex));
const currentBaseName = computed(() => currentBase.value?.name?.trim() || resolvePlannedDeploySiteName(props.snapshot));
const hasRuntimeBases = computed(() => {
  const bases = props.snapshot?.bases ?? [];
  return bases.length > 0 && prerequisiteContext.value !== null;
});
const currentBaseConyardFactions = computed(() => {
  const rawPrimary = (props.snapshot?.command as { primary_faction?: string } | undefined)?.primary_faction ?? '';
  const fallbackFaction = /soviet|sov|苏联|苏军|苏维埃/i.test(rawPrimary) ? 'soviet' : 'allied';
  return resolveBaseConyardFactions(currentBase.value, fallbackFaction);
});
const hasOperationalConyard = computed(() => {
  if (isDebugBypassPrerequisitesActive()) return true;
  const filter = selectedFactionFilter.value;
  if (filter && filter !== 'all' && filter !== 'common') {
    return currentBaseConyardFactions.value.has(filter);
  }
  return checkHasOperationalConyard(currentBase.value);
});

export interface ConsoleBuildItem {
  id: string;
  name: string;
  baseUnitName?: string;
  isModernized?: boolean;
  modernizedRetrofitName?: string;
  category: MainTabId;
  subCategory?: SubTabId;
  faction?: string;
  cost: number;
  power?: number;
  prereq?: string;
  meta?: string;
  desc?: string;
  tags?: string[];
  builtCount: number;
  maxCount?: number;
  isMaxedOut?: boolean;
  queueModel?: QueueDisplayModel;
  liveStats?: BuildingCardLiveStats;
  activeQueueCount?: number;
  unlockTier?: number;
  dynamic?: boolean;
  isFavorite?: boolean;
  title?: string;
}

const favoriteKeys = ref<Set<string>>(loadBuildFavoritesFromStorage());

function onToggleFavorite(item: Pick<ConsoleBuildItem, 'id' | 'name' | 'baseUnitName'>) {
  const next = toggleBuildFavoriteInSet(favoriteKeys.value, item);
  favoriteKeys.value = next;
  saveBuildFavoritesToStorage(next);
}

const unlockedFactions = computed<string[]>(() =>
  isDebugUnlockAllFactionsActive()
    ? ['allied', 'soviet', 'yuri']
    : resolveUnlockedFactions(props.snapshot),
);
const selectedFactionFilter = ref<string>('all');

watch(unlockedFactions, list => {
  if (selectedFactionFilter.value !== 'all' && !list.includes(selectedFactionFilter.value)) {
    selectedFactionFilter.value = 'all';
  }
});

const factionFilterPills = computed(() => buildFactionFilterPills(unlockedFactions.value));

function selectFactionFilter(factionId: string) {
  selectedFactionFilter.value = factionId;
  currentPage.value = 0;
}

const availableMcvInFleet = computed<string | null>(() =>
  resolveAvailableMcvInFleet({
    snapshot: props.snapshot,
    selectedFactionFilter: selectedFactionFilter.value,
    unlockedFactions: unlockedFactions.value,
  }),
);

const isZeroBaseStandby = computed<boolean>(
  () => !props.preLaunchLocked && checkIsZeroBaseStandby(props.snapshot, availableMcvInFleet.value),
);

const plannedDeploySiteLabel = computed<string>(() => props.snapshot?.meta?.location?.trim() || '');

const pendingMcvDeployment = computed(() =>
  (props.snapshot?.pending_deployments ?? []).find(d => d.action === '展开'),
);

const mcvDeployStagedHint = ref('');

function handleDeployMcvClick() {
  const mcv = availableMcvInFleet.value;
  if (!mcv) return;
  const { orderText, hintText } = buildDeployMcvOrderText(currentBaseName.value, mcv);
  fillHostSendInput(orderText);
  mcvDeployStagedHint.value = hintText;
}

watch([() => props.activeBaseIndex, currentBaseName, hasOperationalConyard], () => {
  mcvDeployStagedHint.value = '';
});

const researchTierByName = computed(() => buildResearchTierMap(catalog.researches));

function inferProductionUnlockTier(prereqs?: readonly string[], hasRequirements?: boolean): number {
  return inferProductionUnlockTierFromMap(researchTierByName.value, prereqs, hasRequirements);
}

const laneKeyForQueue = computed(() =>
  makeProdLaneKeyFor(prodLaneIndexFromCatalog(catalog as unknown as EffectiveCatalog)),
);

function displayOf(q: QueueItem): QueueDisplayModel {
  return buildQueueDisplayModel(q, laneKeyForQueue.value);
}

function cardTitle(item: ConsoleBuildItem): string {
  return item.title ?? formatBuildCardTitle(item, item.tags?.join(', ') || '常规');
}

const catalogCanonNames = computed<Set<string>>(() =>
  buildCatalogCanonNames(catalog.buildings, catalog.productions),
);

const catalogCredibilityIndex = computed(() =>
  buildEntityCredibilityIndex({
    buildings: catalog.buildings,
    productions: catalog.productions,
    researches: catalog.researches,
    retrofits: catalog.retrofits,
    projects: catalog.projects,
    protocols: catalog.protocols,
  }),
);

/** 巨构关键词识别列表（「空间站」已退场：D-C6——本体升格为 V2 仓段化工程「轨道空间站」，建造面板不再单列） */
const MEGASTRUCTURE_KEYWORDS = [
  '超时空',
  '天气控制',
  '气象',
  '核弹',
  '铁幕',
  '心灵控制',
  '基因突变',
  '法式要塞巨炮',
  '小型模块化核反应堆',
  '航天发射中心',
  '火箭制造厂',
  '卫星测控站',
  '间谍卫星上行站',
];

/** 全量条目汇编与分类归集 */
const allItems = computed<ConsoleBuildItem[]>(() => {
  const result: ConsoleBuildItem[] = [];
  const prereqCtx = prerequisiteContext.value;
  const debugBypass = isDebugBypassPrerequisitesActive();
  if (props.preLaunchLocked && !debugBypass) return [];
  const hasRunningBuildings = (currentBase.value?.buildings ?? []).some(b => b.state === '运转');
  const runtimeBasesActive = hasRuntimeBases.value || isZeroBaseStandby.value;
  const conyardActive = hasOperationalConyard.value;

  // 1. 建筑目录 (catalog.buildings)：按主领域分桶，巨构关键词优先
  const unlockedBuildingNames = new Set(
    debugBypass
      ? catalog.buildings.map(item => item.name)
      : prereqCtx && conyardActive
        ? deriveBuildableWithContext(catalog.buildings, prereqCtx).map(item => item.name)
        : [],
  );

  // 预计算当前基地活跃阵营已拥有的阵营专属建筑剥离名集合（如基地有盟军建造厂且目录含「盟军发电厂」，则通用槽位模板「发电厂」自动让位，避免出现两张相同 $800/+200 电厂卡）
  const activeFactionSpecificBuildingBaseNames = new Set<string>();
  for (const b of catalog.buildings) {
    const trimmed = b.name.trim();
    const stripped = stripFactionBuildingPrefix(trimmed);
    if (!stripped || stripped === trimmed) continue;
    const bMeta = b as { id?: string; faction?: string; scope?: string };
    const f = inferBuildEntryFaction({
      id: bMeta.id,
      name: trimmed,
      faction: bMeta.faction,
      scope: bMeta.scope,
      tags: b.tags,
      need_building: b.need_building,
      need_buildings: b.need_buildings,
    });
    if (f !== 'common' && currentBaseConyardFactions.value.has(f)) {
      activeFactionSpecificBuildingBaseNames.add(stripped);
    }
  }

  for (const b of catalog.buildings) {
    const bMeta = b as { id?: string; faction?: string; scope?: string; standalone?: boolean };
    const trimmedBldName = b.name.trim();
    const strippedBldName = stripFactionBuildingPrefix(trimmedBldName);
    const canFallbackToStripped =
      strippedBldName !== trimmedBldName && !catalogBuildingNameSet.value.has(strippedBldName);
    const q =
      queueMap.value.get(b.name) ??
      (canFallbackToStripped ? queueMap.value.get(strippedBldName) : undefined);
    const liveStats =
      buildingLiveStatsMap.value.get(b.name) ??
      (canFallbackToStripped ? buildingLiveStatsMap.value.get(strippedBldName) : undefined);
    const builtCount =
      liveStats?.builtCount ??
      builtCountMap.value.get(b.name) ??
      (canFallbackToStripped ? builtCountMap.value.get(strippedBldName) : undefined) ??
      0;
    const queueCountFromMap =
      activeQueueCountMap.value.get(b.name) ??
      (canFallbackToStripped ? activeQueueCountMap.value.get(strippedBldName) : undefined) ??
      0;
    const activeQueueCount = Math.max(queueCountFromMap, liveStats?.underConstructionCount ?? 0);

    // 若当前卡片为通用槽位模板（如「发电厂」「战斗实验室」），且当前基地所属阵营已有专属同名实现（如「盟军发电厂」「盟军战斗实验室」），且本基地未直接建造/排队该通用名，则不重复展示通用模板卡
    if (
      !debugBypass &&
      runtimeBasesActive &&
      strippedBldName === trimmedBldName &&
      activeFactionSpecificBuildingBaseNames.has(trimmedBldName) &&
      !q &&
      builtCount <= 0 &&
      (liveStats?.underConstructionCount ?? 0) <= 0
    ) {
      continue;
    }

    if (!debugBypass && runtimeBasesActive && !unlockedBuildingNames.has(b.name) && !q && (liveStats?.underConstructionCount ?? 0) <= 0) {
      continue;
    }

    const tags = inferItemTags({ name: b.name, desc: b.desc, tags: b.tags });
    if (
      shouldSkipBuildingEntry({
        b: { id: bMeta.id, name: b.name, cost: b.cost, standalone: bMeta.standalone },
        tags,
        builtCount,
        q,
      })
    ) {
      continue;
    }

    const faction = inferBuildEntryFaction({
      id: bMeta.id,
      name: b.name,
      faction: bMeta.faction,
      scope: bMeta.scope,
      tags,
      need_building: b.need_building,
      need_buildings: b.need_buildings,
    });
    if (
      !debugBypass &&
      runtimeBasesActive &&
      !q &&
      (liveStats?.underConstructionCount ?? 0) <= 0 &&
      faction !== 'common' &&
      !currentBaseConyardFactions.value.has(faction)
    ) {
      continue;
    }
    const { cat, sub } = bucketBuilding(b.name, b.desc, tags);

    const bldItem: ConsoleBuildItem = {
      id: `bld-${b.name}`,
      name: b.name,
      category: cat,
      subCategory: sub,
      faction,
      cost: b.cost,
      power: b.power,
      prereq: b.research ? `需 ${b.research}` : b.need_building ? `需 ${b.need_building}` : '',
      desc: b.desc,
      tags,
      builtCount,
      liveStats,
      ...(activeQueueCount > 0 ? { activeQueueCount } : {}),
      queueModel: q ? displayOf(q) : undefined,
      unlockTier: (b as { tier?: number }).tier ?? (b.research ? 1 : 0),
    };
    bldItem.title = formatBuildCardTitle(bldItem, tags.join(', ') || '常规');
    result.push(bldItem);
  }

  // 2. 生产目录 (catalog.productions)
  const unlockedProdNames = new Set(
    debugBypass
      ? catalog.productions.map(item => stripMassProductionSuffix(item.name) || item.name)
      : prereqCtx && hasRunningBuildings
        ? deriveProducibleWithContext(catalog.productions, prereqCtx)
            .filter(item => Boolean(item.need_building) || Boolean(item.need_buildings?.length))
            .map(item => stripMassProductionSuffix(item.name) || item.name)
        : [],
  );

  const completedTechAndProtocolSet = buildCompletedTechAndProtocolSet(
    props.snapshot?.tech?.done ?? [],
    props.snapshot?.protocols,
  );
  const motherBuildingCache = buildBaseMotherBuildingCache(currentBase.value, currentBaseConyardFactions.value);

  for (const p of catalog.productions) {
    const pMeta = p as {
      id?: string;
      faction?: string;
      scope?: string;
      category?: string;
      max_count?: number;
      aliases?: readonly string[];
    };
    if (pMeta.category === 'doctrine') continue;

    const cleanName = stripMassProductionSuffix(p.name) || p.name;
    const modRes = resolveModernizedProductionUnit({
      cleanName,
      rawName: p.name,
      snapshot: props.snapshot,
      catalogRetrofits: catalog.retrofits,
      precomputedCompletedSet: completedTechAndProtocolSet,
    });
    const effectiveDisplayName = modRes.displayName;
    const q = resolveProductionQueueItem(
      queueMap.value,
      cleanName,
      p.name,
      pMeta.aliases,
      modRes.isModernized ? effectiveDisplayName : undefined,
    );
    const count = resolveProductionBuiltCount(
      builtCountMap.value,
      cleanName,
      p.name,
      pMeta.aliases,
      modRes.isModernized ? effectiveDisplayName : undefined,
    );
    const maxCount = typeof pMeta.max_count === 'number' && pMeta.max_count > 0 ? pMeta.max_count : undefined;
    const isMaxedOut = maxCount !== undefined && count >= maxCount;

    if (!debugBypass && runtimeBasesActive && !unlockedProdNames.has(cleanName) && !q && count <= 0) {
      continue;
    }

    const subCat = inferProductionSubTab({
      name: cleanName,
      needBuilding: p.need_building,
      rawCategory: pMeta.category,
    });
    const tagCategory = subCat === '人员' || subCat === '装备' ? '人员' : '载具';
    const tags = inferItemTags({
      name: cleanName,
      desc: p.desc,
      category: tagCategory,
      subCategory: subCat,
      tags: p.tags,
    });
    const faction = inferBuildEntryFaction({
      id: pMeta.id,
      name: cleanName,
      faction: pMeta.faction,
      scope: pMeta.scope,
      tags,
      need_building: p.need_building,
      need_buildings: p.need_buildings,
    });
    const effectiveNeedBlds = p.need_buildings?.length
      ? p.need_buildings
      : p.need_building
        ? [p.need_building]
        : [];
    if (
      !debugBypass &&
      runtimeBasesActive &&
      !q &&
      count <= 0 &&
      faction !== 'common' &&
      !checkBaseHasFactionMotherBuilding(
        currentBase.value,
        effectiveNeedBlds,
        faction,
        currentBaseConyardFactions.value,
        motherBuildingCache,
      )
    ) {
      continue;
    }
    const prereqSummary = modRes.isModernized
      ? `直产现代改 · 原型 ${cleanName}`
      : p.prereqs && p.prereqs.length > 0
        ? `${p.need_building ? `${p.need_building} · ` : ''}${p.prereqs[0]}`
        : p.need_building;
    const unlockTier = inferProductionUnlockTier(p.prereqs, Boolean(p.requirements));

    const prodQueueCount =
      activeQueueCountMap.value.get(effectiveDisplayName) ??
      activeQueueCountMap.value.get(cleanName) ??
      activeQueueCountMap.value.get(p.name) ??
      0;

    const prodItem: ConsoleBuildItem = {
      id: `prod-${cleanName}`,
      name: effectiveDisplayName,
      baseUnitName: cleanName,
      ...(modRes.isModernized
        ? { isModernized: true, modernizedRetrofitName: modRes.retrofitName }
        : {}),
      category: '生产',
      subCategory: subCat,
      faction,
      cost: p.cost,
      prereq: prereqSummary,
      desc: p.desc,
      tags,
      builtCount: count,
      ...(maxCount !== undefined ? { maxCount, isMaxedOut } : {}),
      ...(prodQueueCount > 0 ? { activeQueueCount: prodQueueCount } : {}),
      queueModel: q ? displayOf(q) : undefined,
      unlockTier,
    };
    prodItem.title = formatBuildCardTitle(prodItem, tags.join(', ') || '常规');
    result.push(prodItem);
  }

  // 3. 动态条目 (codex)
  const catalogNames = new Set<string>();
  for (const b of catalog.buildings) catalogNames.add(b.name);
  for (const p of catalog.productions) catalogNames.add(p.name);
  for (const p of catalog.productions) catalogNames.add(stripMassProductionSuffix(p.name));
  const canonNames = catalogCanonNames.value;
  const credibilityIndex = catalogCredibilityIndex.value;
  const knownPersonNames = new Set(
    [
      ...(props.snapshot?.girls ?? []).flatMap(g => [g.name?.trim(), g.model?.trim()]),
      ...(props.snapshot?.forces?.girls ?? []).flatMap(g => [g.name?.trim(), g.model?.trim()]),
      ...(props.snapshot?.command?.adjutants ?? []).map(a => a.name?.trim()),
    ].filter((n): n is string => Boolean(n)),
  );

  for (const c of codex.value) {
    if (catalogNames.has(c.name)) continue;
    const { cost, power, codexTags, desc, codexFaction, cleanCodexName } = parseCodexEntryMeta(c);
    const codexDomain = c.kind === '建筑' ? 'building' : 'production';
    if (
      isDuplicateCodexEntry(c.name, cleanCodexName, catalogNames, canonNames) ||
      isSystemCatalogEntity(credibilityIndex, c.name, codexDomain, 0.80) ||
      isSystemCatalogEntity(credibilityIndex, cleanCodexName, codexDomain, 0.80) ||
      (c.kind === '建筑' &&
        (isSystemCatalogEntity(credibilityIndex, c.name, 'retrofit', 0.80) ||
          isSystemCatalogEntity(credibilityIndex, c.name, 'project', 0.80)))
    ) {
      continue;
    }
    const q = queueMap.value.get(cleanCodexName) ?? queueMap.value.get(c.name);
    const codexLiveStats =
      c.kind === '建筑'
        ? (buildingLiveStatsMap.value.get(cleanCodexName) ??
           buildingLiveStatsMap.value.get(c.name) ??
           buildingLiveStatsMap.value.get(stripFactionBuildingPrefix(cleanCodexName)))
        : undefined;
    const codexQueueCount =
      activeQueueCountMap.value.get(cleanCodexName) ??
      activeQueueCountMap.value.get(c.name) ??
      (c.kind === '建筑'
        ? activeQueueCountMap.value.get(stripFactionBuildingPrefix(cleanCodexName))
        : undefined) ??
      0;
    const count =
      codexLiveStats?.builtCount ??
      builtCountMap.value.get(cleanCodexName) ??
      builtCountMap.value.get(c.name) ??
      builtCountMap.value.get(stripFactionBuildingPrefix(cleanCodexName)) ??
      0;
    if (c.kind === '建筑' && count > 0 && !q) continue;
    if (runtimeBasesActive && !conyardActive && !q && count <= 0) continue;

    if (c.kind === '人员' || c.kind === '装备' || c.kind === '载具') {
      if (isIndividualCharacterCodexEntry(c, knownPersonNames)) {
        continue;
      }
      const subCat =
        c.kind === '人员'
          ? '人员'
          : c.kind === '装备'
            ? '装备'
            : inferProductionSubTab({ name: cleanCodexName, needBuilding: String(c.params?.['前置'] ?? '') });
      const rawCodexPrereq = String(c.params?.['前置'] ?? '').trim();
      const defaultMotherBld =
        subCat === '人员'
          ? '兵营'
          : subCat === '装备'
            ? '个人装备制造所'
            : subCat === '空军'
              ? '空军指挥部'
              : subCat === '海军'
                ? '海军造船厂'
                : '战车工厂';
      const requiredMotherBlds = rawCodexPrereq ? [rawCodexPrereq] : [defaultMotherBld];
      if (
        runtimeBasesActive &&
        !q &&
        count <= 0 &&
        !checkBaseHasFactionMotherBuilding(
          currentBase.value,
          requiredMotherBlds,
          codexFaction || 'common',
          currentBaseConyardFactions.value,
          motherBuildingCache,
        )
      ) {
        continue;
      }
      const tags = inferItemTags({
        name: cleanCodexName,
        desc,
        category: c.kind === '载具' ? '载具' : '人员',
        subCategory: subCat,
        tags: codexTags,
      });
      const codexProdItem: ConsoleBuildItem = {
        id: `codex-${cleanCodexName}`,
        name: cleanCodexName,
        category: '生产',
        subCategory: subCat,
        faction: codexFaction,
        cost: isNaN(cost) ? (c.kind === '装备' ? 100 : c.kind === '人员' ? 200 : 800) : cost,
        prereq: c.params['前置'] || 'EVA动态列装',
        desc,
        tags,
        builtCount: count,
        ...(codexQueueCount > 0 ? { activeQueueCount: codexQueueCount } : {}),
        queueModel: q ? displayOf(q) : undefined,
        unlockTier: 1,
        dynamic: true,
      };
      codexProdItem.title = formatBuildCardTitle(codexProdItem, tags.join(', ') || '常规');
      result.push(codexProdItem);
    } else if (c.kind === '建筑') {
      const tags = inferItemTags({ name: cleanCodexName, desc, tags: codexTags });
      const { cat, sub } = bucketBuilding(cleanCodexName, desc, tags);
      const effectiveCodexQueueCount = Math.max(codexQueueCount, codexLiveStats?.underConstructionCount ?? 0);
      const codexBldItem: ConsoleBuildItem = {
        id: `codex-${cleanCodexName}`,
        name: cleanCodexName,
        category: cat,
        subCategory: sub,
        faction: codexFaction,
        cost: isNaN(cost) ? 1000 : cost,
        power,
        prereq: c.params['前置'] || 'EVA动态增补',
        desc,
        tags,
        builtCount: count,
        liveStats: codexLiveStats,
        ...(effectiveCodexQueueCount > 0 ? { activeQueueCount: effectiveCodexQueueCount } : {}),
        queueModel: q ? displayOf(q) : undefined,
        unlockTier: 1,
        dynamic: true,
      };
      codexBldItem.title = formatBuildCardTitle(codexBldItem, tags.join(', ') || '常规');
      result.push(codexBldItem);
    }
  }

  const filteredByFaction = filterItemsByFaction(result, unlockedFactions.value, selectedFactionFilter.value);
  const favSet = favoriteKeys.value;
  for (const item of filteredByFaction) {
    item.isFavorite = isBuildItemFavorited(item, favSet);
  }
  return sortBuildGridItemsWithFavorites(filteredByFaction, list => sortBuildGridItems(list));
});

const tabCountsMap = computed<Record<MainTabId, number>>(() => {
  const counts: Record<MainTabId, number> = {
    基建: 0,
    工业: 0,
    科研: 0,
    防御: 0,
    生产: 0,
  };
  for (const item of allItems.value) {
    if (item.category in counts) {
      counts[item.category] += 1;
    }
  }
  return counts;
});

function tabCount(tabId: MainTabId): number {
  return tabCountsMap.value[tabId] ?? 0;
}

const searchQuery = ref('');
const selectedTraits = ref<string[]>([]);
const traitMatchMode = ref<'and' | 'or'>('or');
const filterScope = ref<'current' | 'all'>('current');
const statusFilter = ref<BuildQuickStatusFilter>('all');

const effectiveFilterScope = computed<'current' | 'all'>(() =>
  resolveEffectiveFilterScope({
    explicitScope: filterScope.value,
    searchQuery: searchQuery.value,
    statusFilter: statusFilter.value,
  }),
);

const scopedItems = computed(() => {
  if (effectiveFilterScope.value === 'all') return allItems.value;
  return allItems.value.filter(
    item => item.category === currentTab.value && (currentSub.value === '全部' || item.subCategory === currentSub.value),
  );
});

const subTabs = computed<{ id: SubTabId; label: string; icon: string }[]>(() =>
  buildSubTabsForGroup(currentTab.value, allItems.value),
);

const statusCounts = computed(() => computeBuildQuickStatusCounts(allItems.value));
const traitCounts = computed<Record<string, number>>(() => computeTraitCounts(scopedItems.value));

const hasActiveFilters = computed(() =>
  Boolean(
    searchQuery.value.trim() ||
      selectedTraits.value.length ||
      filterScope.value === 'all' ||
      statusFilter.value !== 'all' ||
      selectedFactionFilter.value !== 'all',
  ),
);

const currentItems = computed(() =>
  scopedItems.value.filter(
    item =>
      matchBuildQuickStatus(item, statusFilter.value) &&
      matchItem(item, {
        selectedTraits: selectedTraits.value,
        traitMatchMode: traitMatchMode.value,
        searchQuery: searchQuery.value,
      }),
  ),
);

function resetFilters() {
  searchQuery.value = '';
  selectedTraits.value = [];
  traitMatchMode.value = 'or';
  filterScope.value = 'current';
  statusFilter.value = 'all';
  selectedFactionFilter.value = 'all';
  currentPage.value = 0;
}

const totalPages = computed(() => Math.max(1, Math.ceil(currentItems.value.length / pageSize.value)));

const pagedItems = computed(() => {
  const start = currentPage.value * pageSize.value;
  return currentItems.value.slice(start, start + pageSize.value);
});

function selectTab(tab: MainTabId) {
  currentTab.value = tab;
  currentSub.value = '全部';
  currentPage.value = 0;
}

function selectSub(sub: SubTabId) {
  currentSub.value = sub;
  currentPage.value = 0;
}

function prevPage() {
  if (currentPage.value > 0) currentPage.value--;
}

function nextPage() {
  if (currentPage.value < totalPages.value - 1) currentPage.value++;
}

watch([currentTab, currentSub, currentPage], () => {
  scheduleNextFrame(() =>
    playTacticalStagger(gridContainerRef.value, 'button, .build-cell, .ra-grid-cell', {
      maxItems: 12,
      duration: 0.15,
      stagger: 0.015,
    }),
  );
});

function openDetail(name: string) {
  openLookup(name, codex.value);
}

watch(
  [
    currentTab,
    currentSub,
    pageSize,
    searchQuery,
    selectedTraits,
    traitMatchMode,
    filterScope,
    statusFilter,
    selectedFactionFilter,
  ],
  () => {
    if (currentPage.value >= totalPages.value) {
      currentPage.value = Math.max(0, totalPages.value - 1);
    }
  },
);
</script>

<style scoped>
.ra-build-console { background: var(--rac-bg); }
.ra-build-tabs {
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 7%, var(--rac-panel)) 0%, var(--rac-panel) 100%);
  border-bottom: 1px solid color-mix(in srgb, var(--rac-accent) 24%, var(--rac-dim));
}
.ra-tab-btn { background: var(--rac-panel); border: 1px solid var(--rac-dim); color: var(--rac-muted); position: relative; min-height: 28px; }
.ra-tab-btn:hover { background: color-mix(in srgb, var(--rac-accent) 10%, var(--rac-panel-2)); color: var(--rac-text); border-color: color-mix(in srgb, var(--rac-accent) 42%, var(--rac-line)); }
.ra-tab-btn--active {
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 22%, var(--rac-panel-2)) 0%, color-mix(in srgb, var(--rac-accent) 8%, var(--rac-panel)) 100%);
  color: var(--rac-hi);
  border-color: color-mix(in srgb, var(--rac-accent) 65%, var(--rac-line));
  box-shadow: inset 0 -2px 0 var(--rac-accent), inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 28%, transparent);
}
.ra-tab-btn:focus-visible { outline: 1px solid var(--rac-focus, var(--rac-accent)); outline-offset: -1px; }
.ra-tab-tip { position: absolute; top: calc(100% + 4px); left: 50%; transform: translateX(-50%); z-index: 30; white-space: nowrap; padding: 3px 8px; border: 1px solid var(--rac-dim); border-radius: 2px; background: var(--rac-bg); color: var(--rac-hi); font-family: inherit; font-size: 12px; letter-spacing: 0.04em; opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
.ra-tab-btn:hover .ra-tab-tip, .ra-tab-btn:focus-visible .ra-tab-tip, .ra-sub-btn:hover .ra-tab-tip, .ra-sub-btn:focus-visible .ra-tab-tip { opacity: 1; }
.ra-tab-tip--sub { top: auto; bottom: calc(100% + 4px); }
.ra-tab-led { width: 18px; height: 2px; background: var(--rac-dim); margin-bottom: 2px; transition: background 0.15s ease, box-shadow 0.15s ease; }
.ra-tab-btn--active .ra-tab-led { background: var(--rac-accent); box-shadow: 0 0 5px var(--rac-accent); }
.ra-sub-btn { color: var(--rac-muted); border: 1px solid var(--rac-dim); background: var(--rac-panel); min-height: 24px; position: relative; }
.ra-sub-btn::before { content: ''; position: absolute; inset: -6px -2px; }
.ra-sub-btn:hover { color: var(--rac-hi); border-color: color-mix(in srgb, var(--rac-accent) 45%, var(--rac-line)); background: color-mix(in srgb, var(--rac-accent) 10%, var(--rac-panel-2)); }
.ra-sub-btn--active {
  color: var(--rac-hi);
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 20%, var(--rac-panel-2)) 0%, color-mix(in srgb, var(--rac-accent) 8%, var(--rac-panel)) 100%);
  border-color: color-mix(in srgb, var(--rac-accent) 60%, var(--rac-line));
  box-shadow: inset 0 -2px 0 var(--rac-accent);
  font-weight: 700;
}
.ra-grid-area {
  background: radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--rac-accent) 7%, transparent) 0%, transparent 75%);
}
.ra-card,
.ra-unit-card,
.ra-build-card {
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 6%, var(--rac-panel-2)) 0%, var(--rac-panel) 100%);
  border: 1px solid color-mix(in srgb, var(--rac-accent) 22%, var(--rac-dim));
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 16%, transparent), inset 2px 0 0 color-mix(in srgb, var(--rac-accent) 42%, var(--rac-dim));
  min-height: 60px;
  transition: background 0.18s cubic-bezier(.3,0,.1,1), border-color 0.18s cubic-bezier(.3,0,.1,1), box-shadow 0.18s cubic-bezier(.3,0,.1,1);
}
.ra-card:hover,
.ra-unit-card:hover,
.ra-build-card:hover,
.ra-card--active {
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 16%, var(--rac-panel-2)) 0%, color-mix(in srgb, var(--rac-accent) 8%, var(--rac-panel)) 100%);
  border-color: var(--rac-accent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 26%, transparent), inset 3px 0 0 var(--rac-accent);
}
.ra-card:focus-visible { outline: 1px solid var(--rac-focus, var(--rac-accent)); outline-offset: -1px; }
.ra-card--fav {
  border-color: color-mix(in srgb, var(--rac-warn) 45%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--rac-warn) 20%, transparent), inset 2px 0 0 color-mix(in srgb, var(--rac-warn) 75%, transparent);
}
.ra-card--fav:hover {
  border-color: color-mix(in srgb, var(--rac-warn) 75%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--rac-warn) 28%, transparent), inset 3px 0 0 var(--rac-warn);
}
.ra-card--building { border-color: var(--rac-warn); }
.ra-card--maxed { opacity: 0.46; filter: grayscale(0.85); border-color: var(--rac-dim); background: color-mix(in srgb, var(--rac-panel) 55%, transparent); }
.ra-card--maxed:hover { background: color-mix(in srgb, var(--rac-panel-2) 65%, transparent); border-color: var(--rac-dim); }
.ra-card--built { border-color: var(--rac-line); }
.ra-card--built::before { content: ''; position: absolute; top: -1px; left: -1px; width: 18px; height: 2px; background: var(--rac-hi); pointer-events: none; }
.ra-card-progress--run { background: color-mix(in srgb, var(--rac-warn) 14%, transparent); border-right: 2px solid var(--rac-warn); }
.ra-card-progress--ready { background: color-mix(in srgb, var(--rac-hi) 10%, transparent); border-right: 2px solid var(--rac-hi); }
.ra-card-progress--ok { background: color-mix(in srgb, var(--rac-ok) 10%, transparent); border-right: 2px solid var(--rac-ok); }
.ra-card-progress--dead { background: color-mix(in srgb, var(--rac-alert) 8%, transparent); border-right: 2px solid var(--rac-alert); }
.ra-card-progress--idle, .ra-card-progress--hold { background: color-mix(in srgb, var(--rac-dim) 20%, transparent); border-right: 2px solid var(--rac-dim); }
.ra-card-progress--pulse { animation: ra-queue-pulse 1.6s ease-in-out infinite; }
@keyframes ra-queue-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
@media (prefers-reduced-motion: reduce) { .ra-card-progress--pulse { animation: none; } }
.ra-card-tag { font-size: 11px; font-family: inherit; padding: 0.5px 3px; border-radius: 2px; line-height: 1.2; }
.ra-card-tag--built { color: var(--rac-ok); background: color-mix(in srgb, var(--rac-ok) 12%, transparent); border: 1px solid color-mix(in srgb, var(--rac-ok) 35%, transparent); }
.ra-card-tag--accel { color: var(--rac-accent); background: color-mix(in srgb, var(--rac-accent) 12%, transparent); border: 1px solid color-mix(in srgb, var(--rac-accent) 38%, transparent); }
.ra-card-tag--damaged { color: var(--rac-alert); background: color-mix(in srgb, var(--rac-alert) 14%, transparent); border: 1px solid color-mix(in srgb, var(--rac-alert) 45%, transparent); font-weight: 700; }
.ra-card-tag--addon { color: var(--rac-ok); background: color-mix(in srgb, var(--rac-ok) 12%, transparent); border: 1px solid color-mix(in srgb, var(--rac-ok) 38%, transparent); }
.ra-card-tag--queue--run { color: var(--rac-warn); background: color-mix(in srgb, var(--rac-warn) 10%, transparent); border: 1px solid color-mix(in srgb, var(--rac-warn) 40%, transparent); }
.ra-card-tag--queue--idle { color: var(--rac-text); background: color-mix(in srgb, var(--rac-line) 15%, transparent); border: 1px solid color-mix(in srgb, var(--rac-line) 30%, transparent); }
.ra-card-tag--queue--hold { color: var(--rac-muted); background: color-mix(in srgb, var(--rac-dim) 25%, transparent); border: 1px solid color-mix(in srgb, var(--rac-dim) 50%, transparent); }
.ra-card-tag--queue--ready { color: var(--rac-hi); background: color-mix(in srgb, var(--rac-hi) 10%, transparent); border: 1px solid var(--rac-line); font-weight: 700; }
.ra-card-tag--queue--ok { color: var(--rac-ok); background: color-mix(in srgb, var(--rac-ok) 12%, transparent); border: 1px solid color-mix(in srgb, var(--rac-ok) 35%, transparent); }
.ra-card-tag--queue--dead { color: var(--rac-alert); background: color-mix(in srgb, var(--rac-alert) 8%, transparent); border: 1px solid color-mix(in srgb, var(--rac-alert) 30%, transparent); }
.ra-card-tag--eva { color: var(--rac-hi); background: color-mix(in srgb, var(--rac-line) 20%, transparent); border: 1px solid var(--rac-line); }
.ra-card-tag--modernized { color: var(--rac-ok); background: color-mix(in srgb, var(--rac-ok) 14%, transparent); border: 1px solid color-mix(in srgb, var(--rac-ok) 42%, transparent); font-weight: 700; }
.ra-card-tag--maxed { color: var(--rac-muted); background: color-mix(in srgb, var(--rac-dim) 35%, transparent); border: 1px solid var(--rac-dim); }
.ra-pager {
  border-top: 1px solid color-mix(in srgb, var(--rac-accent) 24%, var(--rac-dim));
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 5%, var(--rac-panel)) 0%, var(--rac-panel) 100%);
}
.ra-page-btn {
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 6%, var(--rac-panel-2)) 0%, var(--rac-panel) 100%);
  border: 1px solid color-mix(in srgb, var(--rac-accent) 24%, var(--rac-dim));
  color: var(--rac-text);
  transition: all 0.18s cubic-bezier(.3,0,.1,1);
  min-height: 28px;
  position: relative;
}
.ra-page-btn::before { content: ''; position: absolute; inset: -8px -4px; }
.ra-page-btn:hover:not(:disabled) {
  background: linear-gradient(180deg, color-mix(in srgb, var(--rac-accent) 16%, var(--rac-panel-2)) 0%, color-mix(in srgb, var(--rac-accent) 8%, var(--rac-panel)) 100%);
  border-color: var(--rac-accent);
  color: var(--rac-hi);
}
.ra-page-btn:focus-visible { outline: 1px solid var(--rac-focus, var(--rac-accent)); outline-offset: 1px; }
.ra-page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.ra-card-tag-pill { line-height: 1.1; }
.ra-filter-reset-btn { background: color-mix(in srgb, var(--rac-line) 12%, transparent); }
</style>
