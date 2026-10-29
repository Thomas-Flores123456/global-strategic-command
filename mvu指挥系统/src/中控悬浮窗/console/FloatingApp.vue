<template>
  <div
    class="ra-console-root flex size-full flex-col select-none"
    :class="{ 'ra-console--collapsed-dock': isCollapsedDock }"
  >
    <!-- ══ 侧边停靠折叠态：36px 垂直外沿推拉手柄 + 微缩电网控制条 ══ -->
    <template v-if="isCollapsedDock">
      <div
        class="ra-collapsed-outer flex size-full cursor-pointer overflow-hidden transition-colors select-none"
        :class="shell.state.dock === 'left' ? 'flex-row-reverse' : 'flex-row'"
        :title="shell.state.dock === 'right' ? '展开红警建造控制台' : '展开红警建造控制台'"
        @click="shell.toggle"
      >
        <!-- 侧栏外沿贴边开关手柄 (面向聊天区) -->
        <ConsoleDockHandle :dock="shell.state.dock" :collapsed="true" @toggle="shell.toggle" />

        <div class="my-1 flex w-full flex-1 justify-center overflow-hidden py-1.5">
          <ConsolePowerBar :gen="currentBasePower.gen" :use="currentBasePower.use" />
        </div>
      </div>
    </template>

    <!-- ══ 正常展开态或自由悬浮窗模式 ══ -->
    <template v-else>
      <!-- ══ 4. 最顶侧按键：【档案】、【改造】与【设置】+ 拖拽手柄 ══ -->
      <ConsoleTopNav
        :floor-id="floating.floorId"
        :busy="floating.busy"
        :active-modal="activeModal"
        :pending-patches-count="pendingPatchesCount"
        :pre-launch-locked="isPreLaunchLocked"
        :has-update-alert="Boolean(cardUpdateState.lastCheck?.hasUpdate || cardUpdateState.lastCheck?.hasLegacyChatSaveMismatch)"
        :has-breaking-update="Boolean(cardUpdateState.lastCheck?.hasBreakingSaveChange || cardUpdateState.lastCheck?.hasLegacyChatSaveMismatch)"
        :latest-version-label="cardUpdateState.lastCheck?.latestVersion || ''"
        :snapshot="floating.snapshot"
        @open-modal="openModal"
        @refresh="floating.refresh"
        @drag-start="onDragStart"
      />

      <template v-if="!shell.state.collapsed">
        <!-- ══ 时序冲突战术警报横幅（CTRL-UI-CHRONO-01：<生产> 对账 OVERRUN 三键纠偏） ══ -->
        <ChronoMismatchBanner />

        <!-- ══ 无数据降级横幅：最近有效 AI 楼缺失 / 读取异常 ══ -->
        <div v-if="floating.snapshot === null" class="floating-banner mono" role="status">
          无数据 · 未找到含合法 stat_data 的 AI 楼层{{ floating.lastError ? `（${floating.lastError}）` : '' }}
        </div>

        <!-- ══ 主控制台工作区：外沿手柄 + 左侧能量柱 + 右侧调度面板 ══ -->
        <div
          v-if="catalog.ready"
          class="ra-console-workspace flex min-h-0 flex-1 overflow-hidden"
          :class="shell.state.dock === 'left' ? 'flex-row-reverse' : 'flex-row'"
        >
          <!-- 侧栏外沿贴边开关手柄 (在面向聊天区的边缘) -->
          <ConsoleDockHandle :dock="shell.state.dock" :collapsed="false" @toggle="shell.toggle" />

          <!-- ══ 6. 竖向能量柱：红警经典垂直电力刻度条 ══ -->
          <ConsolePowerBar :gen="currentBasePower.gen" :use="currentBasePower.use" />

          <!-- ══ 控制台主栏 ══ -->
          <div
            ref="consoleMainRef"
            class="ra-console-main flex min-w-0 flex-1 flex-col overflow-hidden"
          >
            <!-- ══ 3. 雷达小地图区域：当前基地监视屏 ══ -->
            <ConsoleRadarScreen
              :bases="bases"
              :queues="floating.snapshot?.queues"
              :active-index="activeBaseIndex"
              :pre-launch-locked="isPreLaunchLocked"
              :planned-location="plannedLocationLabel"
              @select-base="onSelectBase"
            />

            <!-- ══ 1. 顶层快捷操作按钮：【科技】与【机娘 / 军备管理】（【工程】在 DEV 调试模式下开启） ══ -->
            <ConsoleQuickActions
              :snapshot="floating.snapshot"
              :active-modal="activeModal"
              :pre-launch-locked="isPreLaunchLocked"
              :show-engineering="debugState.enabled"
              @open-modal="openModal"
            />

            <!-- ══ 2 & 5. 五大核心基建页签 + 建造网格 + 最底侧双三角翻页键 ══ -->
            <ConsoleBuildGrid
              :snapshot="floating.snapshot"
              :active-base-index="activeBaseIndex"
              :pre-launch-locked="isPreLaunchLocked"
            />
          </div>
        </div>
      </template>
    </template>

    <!-- ══ 宿主全视窗战术弹窗挂载区（独立挂载于酒馆全屏，移出侧栏折叠分支，按需实例化） ══ -->
    <Teleport v-if="modalMountTarget" :to="modalMountTarget">
      <!-- ══ 详情抽屉（openLookup 查阅与战术部署指令闭环） ══ -->
      <DetailDrawer />

      <!-- ══ 科技树研发弹窗 ══ -->
      <ModalTechTree
        v-if="activeModal === 'tech'"
        :open="activeModal === 'tech'"
        @close="closeModal"
      />

      <!-- ══ 军备管理与机娘编成弹窗（ARM-03 · D-05 / UX-12，保持 modalId: 'mecha' 向后兼容） ══ -->
      <ModalMechaGirl
        v-if="activeModal === 'mecha' || activeModal === 'girl'"
        :open="activeModal === 'mecha' || activeModal === 'girl'"
        :snapshot="floating.snapshot"
        @close="closeModal"
      />

      <!-- ══ 战况档案快照弹窗 ══ -->
      <ModalArchive
        v-if="activeModal === 'archive'"
        :open="activeModal === 'archive'"
        @close="closeModal"
      />

      <!-- ══ 工程日程面板（CTRL-UI-SCHEDULE-01；与注入文本同源：时钟/基地×产线/科研槽板） ══ -->
      <ModalSchedule
        v-if="activeModal === 'schedule'"
        :open="activeModal === 'schedule'"
        :snapshot="floating.snapshot"
        @close="closeModal"
      />

      <!-- ══ 资源六柱与资金条面板（CTRL-UI-RES-01；只读消费 economy 切片，三态钉死） ══ -->
      <ModalResources
        v-if="activeModal === 'resources' || activeModal === 'economy'"
        :open="activeModal === 'resources' || activeModal === 'economy'"
        :snapshot="floating.snapshot"
        @close="closeModal"
      />

      <!-- ══ 工程指挥弹窗（ENG-UI-01 骨架；D17 一级主模态 + DetailDrawer 详情复用；生产环境默认关闭，DEV 开启） ══ -->
      <ModalEngineering
        v-if="activeModal === 'engineering' && debugState.enabled"
        :open="activeModal === 'engineering' && debugState.enabled"
        :snapshot="floating.snapshot"
        @close="closeModal"
      />

      <!-- 基地建筑体系总览弹窗 (Full-Window Modal) -->
      <ModalBuildings
        v-if="activeModal === 'buildings'"
        :snapshot="floating.snapshot"
        :active-base-index="activeBaseIndex"
        @close="closeModal"
        @select-base="handleSelectBase"
      />

      <!-- ══ 数据更新补丁 Diff 审核弹窗 ══ -->
      <PanelDataPatches
        v-if="activeModal === 'patches'"
        :open="activeModal === 'patches'"
        :snapshot="floating.snapshot"
        @close="closeModal"
      />

      <!-- ══ 控制台环境设置弹窗 ══ -->
      <ModalSettings
        v-if="activeModal === 'settings'"
        :open="activeModal === 'settings'"
        :floor-id="floating.floorId"
        :schema-version="floating.schemaVersion"
        :last-error="floating.lastError"
        :current-dock="shell.state.dock"
        @close="closeModal"
        @dock-left="shell.dockToLeft"
        @dock-right="shell.dockToRight"
        @dock-free="shell.dockFree"
      />

      <!-- ══ 全链路数据流转监控台弹窗（DBG41-07） ══ -->
      <ModalDataFlowInspector
        v-if="activeModal === 'dataflow' && !debugState.miniHudOpen"
        :open="activeModal === 'dataflow'"
        @open-full="openDataFlowFull"
        @close="closeModal"
      />

      <!-- ══ 角色卡版本更新与强制战局备份拦截弹窗（FD-47 / FD-48） ══ -->
      <ModalCardUpdate
        v-if="activeModal === 'card-update'"
        :open="activeModal === 'card-update'"
        :check-result="cardUpdateState.lastCheck"
        @close="closeModal"
        @updated="onCardUpdated"
        @confirm-update="handleConfirmCardUpdate"
        @restored="floating.refresh"
      />
    </Teleport>
    <template v-else>
      <DetailDrawer />
      <ModalTechTree
        v-if="activeModal === 'tech'"
        :open="activeModal === 'tech'"
        @close="closeModal"
      />
      <ModalMechaGirl
        v-if="activeModal === 'mecha' || activeModal === 'girl'"
        :open="activeModal === 'mecha' || activeModal === 'girl'"
        :snapshot="floating.snapshot"
        @close="closeModal"
      />
      <ModalArchive
        v-if="activeModal === 'archive'"
        :open="activeModal === 'archive'"
        @close="closeModal"
      />
      <ModalSchedule
        v-if="activeModal === 'schedule'"
        :open="activeModal === 'schedule'"
        :snapshot="floating.snapshot"
        @close="closeModal"
      />
      <ModalResources
        v-if="activeModal === 'resources' || activeModal === 'economy'"
        :open="activeModal === 'resources' || activeModal === 'economy'"
        :snapshot="floating.snapshot"
        @close="closeModal"
      />
      <ModalEngineering
        v-if="activeModal === 'engineering' && debugState.enabled"
        :open="activeModal === 'engineering' && debugState.enabled"
        :snapshot="floating.snapshot"
        @close="closeModal"
      />
      <ModalBuildings
        v-if="activeModal === 'buildings'"
        :snapshot="floating.snapshot"
        :active-base-index="activeBaseIndex"
        @close="closeModal"
        @select-base="handleSelectBase"
      />
      <PanelDataPatches
        v-if="activeModal === 'patches'"
        :open="activeModal === 'patches'"
        :snapshot="floating.snapshot"
        @close="closeModal"
      />
      <ModalSettings
        v-if="activeModal === 'settings'"
        :open="activeModal === 'settings'"
        :floor-id="floating.floorId"
        :schema-version="floating.schemaVersion"
        :last-error="floating.lastError"
        :current-dock="shell.state.dock"
        @close="closeModal"
        @dock-left="shell.dockToLeft"
        @dock-right="shell.dockToRight"
        @dock-free="shell.dockFree"
      />
      <ModalDataFlowInspector
        v-if="activeModal === 'dataflow' && !debugState.miniHudOpen"
        :open="activeModal === 'dataflow'"
        @open-full="openDataFlowFull"
        @close="closeModal"
      />

      <!-- ══ 角色卡版本更新与强制战局备份拦截弹窗（FD-47 / FD-48） ══ -->
      <ModalCardUpdate
        v-if="activeModal === 'card-update'"
        :open="activeModal === 'card-update'"
        :check-result="cardUpdateState.lastCheck"
        @close="closeModal"
        @updated="onCardUpdated"
        @confirm-update="handleConfirmCardUpdate"
        @restored="floating.refresh"
      />
    </template>

    <!-- ══ 角落 Mini HUD 实时数据流监视胶囊（无全屏遮罩非阻挡层，DBG41-07） ══ -->
    <ModalDataFlowInspector
      v-if="debugState.enabled && debugState.miniHudOpen"
      :open="activeModal === 'dataflow'"
      @open-full="openDataFlowFull"
      @close="closeModal"
    />

    <!-- ══ 宿主全视窗常驻战术 HUD 挂载区（独立挂载于酒馆全屏 100vw×100vh，手持板全屏自由浮动） ══ -->
    <Teleport v-if="hudMountTarget" :to="hudMountTarget">
      <TacticalPdaHost
        :scope-id="activePdaScopeId"
        :snapshot="floating.snapshot"
        @adopt-lore="handleAdoptPendingLore"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import DetailDrawer from '../../红警指挥系统/ui/DetailDrawer.vue';
import type { Base, Schema } from '../../红警指挥系统/core/schema';
import {
  inferPrimaryThemeFromSnapshot,
  installCrossFrameThemeSync,
  normalizeThemeKey,
  setTheme,
  ui,
} from '../../红警指挥系统/ui/ui';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import { debugState } from '../../红警指挥系统/composables/useDebugMode';
import { closeDetail, detail } from '../../红警指挥系统/composables/useDetail';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { readCurrentHostChatId } from '../../红警指挥系统/core/timelineLedger';
import { dismissChrono, parseState } from '../../红警指挥系统/composables/useParse';
import ChronoMismatchBanner from './ChronoMismatchBanner.vue';
import ConsoleBuildGrid from './ConsoleBuildGrid.vue';
import ConsoleDockHandle from './ConsoleDockHandle.vue';
import ConsolePowerBar from './ConsolePowerBar.vue';
import ConsoleQuickActions from './ConsoleQuickActions.vue';
import ConsoleRadarScreen from './ConsoleRadarScreen.vue';
import ConsoleTopNav from './ConsoleTopNav.vue';
import ModalArchive from '../modals/ModalArchive.vue';
import ModalBuildings from '../modals/ModalBuildings.vue';
import ModalEngineering from '../modals/ModalEngineering.vue';
import ModalMechaGirl from '../modals/ModalMechaGirl.vue';
import ModalResources from '../modals/ModalResources.vue';
import ModalSchedule from '../modals/ModalSchedule.vue';
import ModalSettings from '../modals/ModalSettings.vue';
import ModalDataFlowInspector from '../modals/ModalDataFlowInspector.vue';
import ModalCardUpdate from '../modals/ModalCardUpdate.vue';
import ModalTechTree from '../modals/ModalTechTree.vue';
import PanelDataPatches from '../panels/PanelDataPatches.vue';
import TacticalPdaHost from '../pda/TacticalPdaHost.vue';
import type { NormalizedPendingLoreItem } from '../pda/PdaTabIntel.vue';
import { useDataStore } from '../../红警指挥系统/composables/store';
import * as cardUpdateEngineModule from '../host/cardUpdateEngine';
import {
  cardUpdateState,
  checkCardUpdate,
  getCardUpdatePreferences,
  performSafeCardUpdate,
  type UpdateCheckResult,
} from '../host/cardUpdateEngine';
import { useModalErrorGuard } from '../host/modalErrorGuard';
import {
  destroyHudHost,
  destroyModalHost,
  initHudHost,
  initModalHost,
  setModalHostVisible,
  syncHudHostTheme,
  syncModalHostTheme,
} from '../host/modalHost';
import {
  playTacticalStagger,
  scheduleNextFrame,
} from '../../红警指挥系统/ui/motion/useGsapMotion';
import { SHELL_STORAGE_KEY, type Shell } from '../host/shell';

const props = defineProps<{ shell: Shell }>();

const consoleMainRef = ref<HTMLElement | null>(null);
watch(
  () => props.shell.state.collapsed,
  collapsed => {
    if (!collapsed) {
      scheduleNextFrame(() =>
        playTacticalStagger(consoleMainRef.value, ':scope > *', { maxItems: 6, duration: 0.18 }),
      );
    }
  },
);

const floating = useFloatingStore();
const catalog = useCatalogStore();
catalog.init();

const modalMountTarget = ref<HTMLElement | null>(null);
const hudMountTarget = ref<HTMLElement | null>(null);
/** SEAM-05：当前聊天 PDA 作用域分桶标识（避免跨角色卡/跨聊天串桶） */
const activePdaScopeId = computed(() => {
  void floating.floorId;
  return readCurrentHostChatId() || 'default';
});
/** CHRONO 防陈旧安全网的 floating.onRefresh 注销函数（onMounted 注册 / onUnmounted 注销） */
let offChronoGuard: (() => void) | null = null;

/** 当前是否处于侧边停靠折叠态（36px 微缩侧边条） */
const isCollapsedDock = computed(() => {
  return props.shell.state.collapsed && (props.shell.state.dock === 'right' || props.shell.state.dock === 'left');
});

/** 首次装载时若未配置停靠模式，默认常驻右侧原生栏（红警经典右侧建造栏） */
onMounted(() => {
  try {
    const raw = window.localStorage.getItem(SHELL_STORAGE_KEY);
    if (!raw || !props.shell.state.dock || props.shell.state.dock === 'free') {
      props.shell.dockToRight();
    }
  } catch {
    props.shell.dockToRight();
  }
  modalMountTarget.value = initModalHost({
    // 宿主 iframe 异步 load（about:blank 重置）后重建挂载根节点时，动态跟进 Teleport 目标
    onMountRootReady: root => {
      modalMountTarget.value = root;
    },
    // 宿主 iframe 内的 Escape 统一走 LIFO 调度（与主 window 同一处理函数）
    onEscape: onGlobalKey,
  });
  hudMountTarget.value = initHudHost({
    onMountRootReady: root => {
      hudMountTarget.value = root;
    },
  });
  installCrossFrameThemeSync();
  window.addEventListener('keydown', onGlobalKey);
  window.addEventListener('message', onBootStateMessage);
  try {
    if (window.parent && window.parent !== window) {
      window.parent.addEventListener('message', onBootStateMessage);
    }
  } catch {
    /* cross-frame guard */
  }
  // CHRONO 防陈旧安全网（CTRL-UI-CHRONO-01）：悬浮窗刷新落点楼号 ≠ 冲突暂存楼号
  // （切聊天/swipe 换页/删楼）→ 清暂存，横幅不跨场景残留；同楼重解析（顺延/重跑）不受碍
  offChronoGuard = floating.onRefresh(result => {
    const c = parseState.chrono;
    if (c && result?.floorId !== c.message_id) dismissChrono();
  });
  if (getCardUpdatePreferences().checkOnStartup) {
    void runStartupUpdateFlow().catch(() => {});
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey);
  window.removeEventListener('message', onBootStateMessage);
  try {
    if (window.parent && window.parent !== window) {
      window.parent.removeEventListener('message', onBootStateMessage);
    }
  } catch {
    /* cross-frame guard */
  }
  offChronoGuard?.();
  offChronoGuard = null;
  destroyHudHost();
  destroyModalHost();
  props.shell.setModalOverlay?.(false);
});

const isPreLaunchLocked = computed<boolean>(() => Boolean(floating.isPreLaunchLocked));
const plannedLocationLabel = computed<string>(() => floating.snapshot?.meta?.location?.trim() || '');

let lastAutoSyncedScopeKey = '';
watch(
  [activePdaScopeId, () => floating.snapshot],
  ([scopeId, snap]) => {
    if (!snap) return;
    const inferred = inferPrimaryThemeFromSnapshot(snap as unknown as Record<string, unknown>);
    if (!inferred) return;
    const scopeKey = `${scopeId}::${snap.meta?.world_id ?? ''}::${inferred}`;
    if (scopeKey !== lastAutoSyncedScopeKey) {
      lastAutoSyncedScopeKey = scopeKey;
      if (ui.theme !== inferred) {
        setTheme(inferred);
      }
    }
  },
  { immediate: true },
);

function onBootStateMessage(e: MessageEvent) {
  const data = e?.data as { type?: unknown; confirmed?: unknown; theme?: unknown } | null | undefined;
  if (!data || data.type !== 'ra-boot-state-changed') return;
  const confirmed = Boolean(data.confirmed);
  const nextTheme = normalizeThemeKey(data.theme);
  if (nextTheme) {
    setTheme(nextTheme);
  }
  floating.setBootConfirmed?.(confirmed);
  if (
    !confirmed &&
    activeModal.value &&
    activeModal.value !== 'settings' &&
    activeModal.value !== 'card-update'
  ) {
    activeModal.value = null;
  }
  void floating.refresh();
}

/** 当前激活弹窗：'tech' | 'mecha' | 'archive' | 'settings' | 'patches' | 'schedule' | 'resources' | 'engineering' | 'buildings' | 'card-update' | null */
type ModalKey =
  | 'tech'
  | 'mecha'
  | 'girl'
  | 'archive'
  | 'settings'
  | 'patches'
  | 'schedule'
  | 'resources'
  | 'economy'
  | 'engineering'
  | 'buildings'
  | 'pda'
  | 'command'
  | 'dataflow'
  | 'card-update';
const activeModal = ref<ModalKey | null>(null);

const pendingPatchesCount = computed(() => {
  const list = floating.snapshot?.pending_data_patches ?? [];
  return list.filter(p => p.status !== 'deferred').length;
});

function openModal(key: ModalKey) {
  if (
    isPreLaunchLocked.value &&
    key !== 'settings' &&
    key !== 'dataflow' &&
    key !== 'card-update'
  )
    return;
  if (key === 'engineering' && !debugState.enabled) return;
  if (key === 'dataflow' && debugState.miniHudOpen) {
    debugState.miniHudOpen = false;
    activeModal.value = 'dataflow';
    return;
  }
  activeModal.value = activeModal.value === key ? null : key;
}

watch(
  () => cardUpdateState.shouldPromptModal,
  shouldPrompt => {
    if (shouldPrompt && activeModal.value === null) {
      activeModal.value = 'card-update';
      cardUpdateState.shouldPromptModal = false;
    }
  },
  { immediate: true },
);

watch(
  () => debugState.enabled,
  enabled => {
    if (!enabled && activeModal.value === 'engineering') {
      activeModal.value = null;
    }
  },
);

function openDataFlowFull() {
  debugState.miniHudOpen = false;
  activeModal.value = 'dataflow';
}

function closeModal() {
  activeModal.value = null;
}

function onCardUpdated() {
  closeModal();
  void floating.refresh();
}

async function runStartupUpdateFlow() {
  const modAny = cardUpdateEngineModule as unknown as Record<string, unknown>;
  const startupFn = modAny.runStartupUpdateFlow as
    | (() => Promise<{ action?: string; result?: UpdateCheckResult | null } | UpdateCheckResult | null>)
    | undefined;
  if (typeof startupFn === 'function') {
    const flowRes = await startupFn();
    if (
      flowRes &&
      typeof flowRes === 'object' &&
      'action' in flowRes &&
      flowRes.action === 'prompt-breaking-backup' &&
      activeModal.value === null
    ) {
      activeModal.value = 'card-update';
    }
    return flowRes;
  }

  const checkLocalOrRemote = modAny.checkCardUpdateViaLocalOrRemote as
    | ((opts?: Record<string, unknown>) => Promise<UpdateCheckResult | null>)
    | undefined;
  if (typeof checkLocalOrRemote === 'function') {
    return await checkLocalOrRemote({ triggerAutoUpdateIfSafe: false });
  }
  return await checkCardUpdate({ triggerAutoUpdateIfSafe: false });
}

async function handleConfirmCardUpdate(
  targetResult?: UpdateCheckResult | null,
  alreadyHandledByModal = false,
) {
  if (alreadyHandledByModal) {
    void floating.refresh();
    return;
  }
  const activeCheck = targetResult ?? cardUpdateState.lastCheck;
  const modAny = cardUpdateEngineModule as unknown as Record<string, unknown>;
  const triggerLocalServerUpdate = modAny.triggerLocalServerUpdate as
    | ((opts?: { confirmBackupCompleted?: boolean }) => Promise<{
        ok?: boolean;
        offline?: boolean;
        currentVersion?: string;
        message?: string;
        error?: string;
      }>)
    | undefined;
  const checkCardUpdateViaLocalOrRemote = modAny.checkCardUpdateViaLocalOrRemote as
    | ((opts?: Record<string, unknown>) => Promise<UpdateCheckResult | null>)
    | undefined;
  const safeImportUpdatedCharacterCard = (modAny.safeImportUpdatedCharacterCard ??
    performSafeCardUpdate) as typeof performSafeCardUpdate;

  if (typeof triggerLocalServerUpdate === 'function') {
    const localRes = await triggerLocalServerUpdate({ confirmBackupCompleted: true });
    if (localRes && localRes.ok) {
      toastr.success(
        `本地服务已完成拉取与重编译（v${localRes.currentVersion || activeCheck?.latestVersion || ''}），世界书已自动同步`,
      );
      if (typeof checkCardUpdateViaLocalOrRemote === 'function') {
        await checkCardUpdateViaLocalOrRemote({ triggerAutoUpdateIfSafe: false }).catch(() => {});
      } else {
        await checkCardUpdate({ triggerAutoUpdateIfSafe: false }).catch(() => {});
      }
      onCardUpdated();
      return;
    }
  }

  const downloadUrl =
    (activeCheck as unknown as { downloadUrl?: string } | null)?.downloadUrl ||
    activeCheck?.resolvedCardUrls?.[0] ||
    '';
  if (activeCheck && downloadUrl && typeof safeImportUpdatedCharacterCard === 'function') {
    const fallbackRes = await safeImportUpdatedCharacterCard(activeCheck);
    if (fallbackRes && fallbackRes.ok) {
      toastr.success(`已完成角色卡更新（v${fallbackRes.updatedVersion || activeCheck.latestVersion}）`);
      onCardUpdated();
    }
  }
}

/** F5 防御层：弹窗子树 render 失败时回退弹窗态，覆盖层随 isAnyModalOpen 收起，避免全屏空覆盖层卡死酒馆 */
useModalErrorGuard({
  modalComponents: [
    DetailDrawer,
    ModalTechTree,
    ModalMechaGirl,
    ModalArchive,
    PanelDataPatches,
    ModalSettings,
    ModalDataFlowInspector,
    ModalCardUpdate,
    ModalResources,
    ModalSchedule,
    ModalEngineering,
    ModalBuildings,
  ],
  onModalFailure: (_err, source) => {
    activeModal.value = null;
    if (detail.open) closeDetail();
    toastr.error(`弹窗「${source}」渲染失败，已自动关闭（详见控制台）`);
  },
});

/** 监听所有弹窗或详情抽屉的开启态，唤起宿主全屏覆盖层（折叠为 Mini HUD 时不启用全屏遮罩） */
const isAnyModalOpen = computed(() => {
  const hasFullModal =
    activeModal.value !== null &&
    !(activeModal.value === 'dataflow' && debugState.miniHudOpen);
  return hasFullModal || detail.open;
});

watch(
  isAnyModalOpen,
  open => {
    props.shell.setModalOverlay?.(open);
    setModalHostVisible(open);
  },
  { immediate: true },
);

function onGlobalKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  // LIFO 先进后出：最上层的二级详情（z-index: 10020）优先关闭，
  // 仅当无二级详情时才关闭底层主模态（z-index: 10010），一次按键只关闭一层。
  if (detail.open) {
    closeDetail();
    return;
  }
  if (activeModal.value !== null) {
    activeModal.value = null;
  }
}

/** 基地清单与当前选中的基地序号 */
const bases = computed<Base[]>(() => floating.snapshot?.bases ?? []);
const activeBaseIndex = ref(0);

/** CTRL-RETIRE-01：退役基地（status==='废弃'）默认不作雷达首页；若有已展开运转基地，优先跳过空壳占位基地（如「待侦知部署点」） */
const firstActiveBaseIndex = computed(() => {
  const list = bases.value;
  const deployedIdx = list.findIndex(
    b => b.status !== '废弃' && ((b.buildings?.length ?? 0) > 0 || b.status === '运转中'),
  );
  if (deployedIdx >= 0) return deployedIdx;
  return list.findIndex(b => b.status !== '废弃');
});
watch(
  bases,
  list => {
    if (firstActiveBaseIndex.value < 0) return; // 全部退役或无基地：保持原状（数据仍可经退役记录查阅）
    const current = list[activeBaseIndex.value];
    const isPlaceholderEmpty =
      Boolean(current) &&
      (current.buildings?.length ?? 0) === 0 &&
      current.status === '隐蔽中' &&
      (current.name === '待侦知部署点' || current.id === 'cyber-entry' || String(current.name ?? '').includes('待侦知'));
    if (!current || current.status === '废弃' || (isPlaceholderEmpty && firstActiveBaseIndex.value !== activeBaseIndex.value)) {
      activeBaseIndex.value = firstActiveBaseIndex.value;
    }
  },
  { immediate: true },
);

function onSelectBase(idx: number) {
  activeBaseIndex.value = idx;
}

function handleSelectBase(idx: number) {
  activeBaseIndex.value = idx;
}

async function handleAdoptPendingLore(item: NormalizedPendingLoreItem) {
  if (!item?.id) return;
  try {
    // PdaWindowFrame.onAdoptLore 在 emit('adopt-lore') 前已完成带 write 的 confirmAndCommitPendingLore 与 updateFloorVars，
    // 此处仅刷新中控快照并同步 store，禁止无 write 重复调用 confirmAndCommitPendingLore 触发「新设定入档缺失写入器」错误日志
    await floating.refresh();
    const store = useDataStore();
    if (Array.isArray(floating.snapshot?.pending_lore)) {
      store.set('pending_lore', floating.snapshot.pending_lore as never);
    }
  } catch {
    /* 暂存门刷新失败时不阻断宿主 UI */
  }
}

/** 当前基地电力指标（若无基地则回退 0） */
const currentBasePower = computed(() => {
  const b = bases.value[activeBaseIndex.value] ?? bases.value[0];
  if (!b) return { gen: 0, use: 0 };
  return {
    gen: b.power?.gen ?? 0,
    use: b.power?.use ?? 0,
  };
});

/** 阵营配色沿用楼层 UI 的 localStorage 偏好：data-theme 挂在 #app 上供 global.css 变量覆盖，
 *  并实时同步至模态宿主根容器，确保弹窗内 --line-hot、--deep-2、--text 等 CSS 变量 100% 生效 */
watchEffect(() => {
  document.querySelector('#app')?.setAttribute('data-theme', ui.theme);
  syncModalHostTheme(ui.theme);
  syncHudHostTheme(ui.theme);
});

function onDragStart(e: PointerEvent) {
  if (e.button !== 0) return;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  props.shell.dragStart(e.screenX, e.screenY);
}
</script>

<style>
/* 脚本 iframe 内：整个文档就是红警控制台，内容区自滚 */
html,
body {
  height: 100%;
  overflow: hidden;
}

/* 覆盖 global.css body min-width: 280px */
html body {
  min-width: 0;
}

#app {
  height: 100%;
  min-width: 0;
  padding-left: 0 !important;
  padding-right: 0 !important;
  border: 1px solid color-mix(in srgb, var(--rac-accent) 48%, var(--rac-line));
  border-radius: 4px;
  background: var(--rac-bg);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.7),
    inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 22%, transparent);
}

#app.ra-app--modal-open {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

/* 全视窗弹窗投影蒙层居中与大屏适配（战术 Z-Index 层级治理）：
   宿主蒙层底座 10000（modalHost.ts OVERLAY iframe）｜ 主模态卡片 10010 ｜ 二级详情 10020 ｜ Toastr 10030 */
#app.ra-app--modal-open .ra-modal-mask {
  position: fixed !important;
  inset: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  background: color-mix(in srgb, var(--rac-bg) 82%, transparent) !important;
  backdrop-filter: blur(6px) !important;
  z-index: 10010 !important;
  padding: 16px !important;
}

/* 二级详情弹窗永远覆盖于主档案等主模态之上，遮罩相互解耦（独立关闭互不影响） */
#app.ra-app--modal-open .detail-mask {
  position: fixed !important;
  inset: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  background: color-mix(in srgb, var(--rac-bg) 60%, transparent) !important;
  backdrop-filter: blur(2px) !important;
  z-index: 10020 !important;
  padding: 16px !important;
}

/* 系统通知 / Toastr 提示层：最高战术层级，任何弹窗组合下都可见 */
#toast-container {
  z-index: 10030 !important;
}

#app.ra-app--modal-open .detail-sheet {
  max-width: 580px !important;
  max-height: 85vh !important;
  border: 1px solid color-mix(in srgb, var(--rac-accent) 45%, transparent) !important;
  border-radius: 4px !important;
  box-shadow:
    0 16px 48px rgba(0, 0, 0, 0.85),
    0 0 0 1px color-mix(in srgb, var(--rac-accent) 25%, transparent) !important;
  background: var(--rac-panel) !important;
}

.ra-console-root {
  background: var(--rac-bg);
}

.ra-collapsed-outer {
  background-image: var(--rac-surface-tint);
  background-color: var(--rac-bg);
  border-top: 2px solid var(--rac-accent);
  box-shadow: inset 0 1px 0 var(--rac-glow);
}
.ra-collapsed-outer:hover {
  background-color: var(--rac-panel);
  border-top-color: var(--rac-hi);
}

.floating-banner {
  flex: none;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--rac-warn);
  background: color-mix(in srgb, var(--rac-warn) 8%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--rac-warn) 20%, transparent);
}

.ra-console-workspace {
  background: var(--rac-bg);
}

.ra-console-main {
  background: var(--rac-bg);
}

/* 抽屉正文换行保持 */
#app .detail-sheet p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
