<template>
  <!-- 战地手持板 (PDA) 顶级 Fixed 宿主层：严格 pointer-events: none 保证底层酒馆操作不被遮挡 -->
  <div
    v-if="!shell.state.hidden"
    class="tactical-pda-host pointer-events-none fixed transition-[left,top] duration-75 select-none"
    :style="hostStyle"
    :data-dock-side="shell.state.dockSide"
    :data-collapsed="shell.state.collapsed"
    :data-pinned="shell.state.pinned"
    data-tt-mobile-surface="free-window"
  >
    <!-- ══ A. 收纳纽扣态 (44×44px + 伴生通知胶囊与风琴栈槽位，预留四周安全内边距防角标/阴影裁切) ══ -->
    <template v-if="shell.state.collapsed">
      <div
        class="flex flex-col gap-1.5 p-2"
        :class="shell.state.dockSide === 'right' ? 'items-end' : 'items-start'"
      >
        <div
          class="pda-beacon-cluster pointer-events-none flex items-center gap-2"
          :class="shell.state.dockSide === 'right' ? 'flex-row-reverse' : 'flex-row'"
          data-tt-mobile-surface="free-window"
        >
          <PdaBeaconButton
            :shell="shell"
            :unread-count="resolvedUnreadCount"
            :has-critical="resolvedHasCritical"
            :faction="resolvedFaction"
            class="pointer-events-auto"
            @click="onBeaconClick"
          />

          <!-- 伴生战术挂起通知胶囊槽位（PDA-PILL-01 / PDA-CAPSULE-01） -->
          <slot name="pill" :shell="shell" :queue="notificationQueue">
            <PdaNotificationPill
              v-if="pillItems.length > 0 && !isPillDismissed"
              :items="pillItems"
              :overflow-count="notificationQueue.overflowCount"
              :fanout-open="isFanoutOpen"
              :shell="shell"
              @toggle-fanout="isFanoutOpen = !isFanoutOpen"
              @close="isPillDismissed = true"
            />
          </slot>
        </div>

        <!-- 伴生风琴层叠通知抽屉（PDA-CAPSULE-01：2~5 条风琴栈 + +N 溢出提示） -->
        <slot name="fanout" :shell="shell" :queue="notificationQueue">
          <PdaFanoutStack
            v-if="notificationQueue.visible.length >= 2 && !isPillDismissed && isFanoutOpen"
            :visible="notificationQueue.visible"
            :overflow-count="notificationQueue.overflowCount"
            :total-unread="notificationQueue.totalUnread"
            :shell="shell"
            @select="onFanoutSelect"
            @mark-all-read="onFanoutMarkAllRead"
          />
        </slot>
      </div>
    </template>

    <!-- ══ B. 展开态 (默认 40%vw × 60%vh 视口比例自适应三防手持板机体) ══ -->
    <template v-else>
      <div class="pda-window-cluster pointer-events-auto" data-tt-mobile-surface="free-window">
        <slot name="window" :shell="shell">
          <PdaWindowFrame
            :shell="shell"
            :faction="resolvedFaction"
            :snapshot="resolvedSnapshot"
            @adopt-lore="onAdoptLore"
            @save-memo="onSaveMemo"
          />
        </slot>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { getActivePinia } from 'pinia';
import { computed, onUnmounted, provide, ref, watch } from 'vue';
import type { Schema } from '../../红警指挥系统/core/schema';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { ui } from '../../红警指挥系统/ui/ui';
import { HUD_HOST_ID, syncHudHostGeometry } from '../host/modalHost';
import { ttHostBridge } from '../host/ttHostBridge';
import PdaBeaconButton from './PdaBeaconButton.vue';
import PdaFanoutStack from './PdaFanoutStack.vue';
import PdaNotificationPill from './PdaNotificationPill.vue';
import type { PdaNotificationItem } from './PdaNotificationPill.vue';
import type { PdaEventItem } from './PdaTabEvents.vue';
import type { NormalizedPendingLoreItem } from './PdaTabIntel.vue';
import PdaWindowFrame from './PdaWindowFrame.vue';
import { buildNotificationQueue, derivePdaEventsFromSnapshot } from './notificationQueue';
import { createPdaShell, defaultPdaDeps } from './pdaState';
import type { PdaShell, Viewport } from './pdaState';

export interface TacticalPdaHostProps {
  shell?: PdaShell;
  unreadCount?: number;
  hasCritical?: boolean;
  faction?: 'allies' | 'soviet' | 'yuri' | string;
  notifications?: PdaNotificationItem[];
  events?: PdaEventItem[];
  scopeId?: string | null;
  snapshot?: (Partial<Schema> & { events?: PdaEventItem[]; memo?: string }) | null;
}

const props = withDefaults(defineProps<TacticalPdaHostProps>(), {
  shell: undefined,
  unreadCount: 0,
  hasCritical: false,
  faction: undefined,
  notifications: () => [],
  events: undefined,
  scopeId: undefined,
  snapshot: undefined,
});

const isPillDismissed = ref(false);
const isFanoutOpen = ref(true);

watch(
  () => [props.notifications, props.events, props.snapshot?.events],
  () => {
    isPillDismissed.value = false;
  },
  { deep: true },
);

const emit = defineEmits<{
  (e: 'beacon-click'): void;
  (e: 'adopt-lore', item: NormalizedPendingLoreItem): void;
  (e: 'save-memo', text: string): void;
  (e: 'select-notification', item: PdaEventItem): void;
  (e: 'mark-all-read'): void;
}>();

const basePdaDeps = defaultPdaDeps();

function getHostViewport(): Viewport {
  const fallbackVp = basePdaDeps.viewport();
  const layoutApi = ttHostBridge.layout;
  if (layoutApi) {
    try {
      const snap = layoutApi.snapshot();
      const width =
        snap?.viewport && Number.isFinite(snap.viewport.width) && snap.viewport.width > 0
          ? snap.viewport.width
          : fallbackVp.width;
      const height =
        snap?.viewport && Number.isFinite(snap.viewport.height) && snap.viewport.height > 0
          ? snap.viewport.height
          : fallbackVp.height;
      return {
        width,
        height,
        safeInsets: snap?.safeInsets
          ? {
              top: snap.safeInsets.top ?? 0,
              right: snap.safeInsets.right ?? 0,
              bottom: snap.safeInsets.bottom ?? 0,
              left: snap.safeInsets.left ?? 0,
            }
          : fallbackVp.safeInsets,
      };
    } catch {
      return fallbackVp;
    }
  }
  return fallbackVp;
}

// 若未传入外部 shell，则创建并托管内置响应式实例
let isInternalShell = false;
const shell = (() => {
  if (props.shell) {
    if (props.scopeId !== undefined) {
      props.shell.setPdaSessionScope(props.scopeId);
    }
    return props.shell;
  }
  isInternalShell = true;
  return createPdaShell({
    ...basePdaDeps,
    viewport: getHostViewport,
    scopeId: props.scopeId,
    defaultSizeMode: 'proportional',
  });
})();

let layoutUnsubscribe: (() => void | Promise<void>) | null = null;
let isComponentUnmounted = false;
if (ttHostBridge.layout && typeof ttHostBridge.layout.subscribe === 'function') {
  try {
    const subRes = ttHostBridge.layout.subscribe(() => {
      if (!isComponentUnmounted) {
        shell.relayout();
      }
    });
    if (typeof subRes === 'function') {
      layoutUnsubscribe = subRes;
    } else if (subRes && typeof (subRes as Promise<unknown>).then === 'function') {
      void (subRes as Promise<() => void | Promise<void>>)
        .then(unsub => {
          if (typeof unsub === 'function') {
            if (isComponentUnmounted) {
              void unsub();
            } else {
              layoutUnsubscribe = unsub;
            }
          }
        })
        .catch(() => {});
    }
  } catch {
    /* 忽略 layout.subscribe 异常 */
  }
}

watch(
  () => props.scopeId,
  nextScope => {
    if (nextScope !== undefined) {
      shell.setPdaSessionScope(nextScope);
    }
  },
);

const resolvedSnapshot = computed<(Partial<Schema> & { events?: PdaEventItem[]; memo?: string }) | null>(() => {
  if (props.snapshot !== undefined) return props.snapshot;
  try {
    const pinia = getActivePinia() as
      | (NonNullable<ReturnType<typeof getActivePinia>> & {
          _s?: Map<string, ReturnType<typeof useFloatingStore>>;
        })
      | undefined;
    if (!pinia) return null;
    const floating = pinia._s?.get('mvu_data.floating');
    if (!floating) return null;
    return (floating.snapshot as (Partial<Schema> & { events?: PdaEventItem[]; memo?: string }) | null) ?? null;
  } catch {
    return null;
  }
});

const sourceEvents = computed<PdaEventItem[]>(() => {
  if (props.events && props.events.length > 0) {
    return props.events;
  }
  if (props.notifications && props.notifications.length > 0) {
    return props.notifications.map(n => ({
      id: n.id,
      level: n.level === 'warning' ? 'warn' : n.level,
      severity: n.severity ?? n.level,
      title: n.title,
      targetTab: n.targetTab,
      timestamp: n.timestamp,
    }));
  }
  if (props.events !== undefined) {
    return props.events;
  }
  return derivePdaEventsFromSnapshot(resolvedSnapshot.value);
});

const notificationQueue = computed(() => {
  const readSet = new Set<string>(shell.state.readEventIds);
  return buildNotificationQueue(sourceEvents.value, readSet);
});

const pillItems = computed<PdaNotificationItem[]>(() => {
  return notificationQueue.value.visible.map(ev => ({
    id: ev.id,
    level:
      ev.level === 'critical' || ev.severity === 'critical'
        ? 'critical'
        : ev.level === 'warn' || ev.level === 'warning' || ev.severity === 'warn' || ev.severity === 'warning'
          ? 'warn'
          : 'info',
    title: ev.title || ev.verb || ev.summary || ev.id,
    targetTab: ev.targetTab,
    timestamp: ev.timestamp || ev.time,
  }));
});

const resolvedUnreadCount = computed<number>(() => {
  return props.unreadCount > 0 ? props.unreadCount : notificationQueue.value.totalUnread;
});

const resolvedHasCritical = computed<boolean>(() => {
  return props.hasCritical || notificationQueue.value.highestSeverity === 'critical';
});

// 向子树提供 shell 访问
provide('pdaShell', shell);

/** 阵营规整：优先用显式 prop，否则跟随 ui.theme */
const resolvedFaction = computed(() => {
  if (props.faction) {
    return props.faction;
  }
  const theme = ui.theme;
  if (theme === 'allied') return 'allies';
  if (theme === 'soviet') return 'soviet';
  if (theme === 'yuri') return 'yuri';
  return 'allies';
});

/** 是否处于真实的宿主独立 HUD iframe 内部 */
const isInsideWindowedIframe = computed(() => {
  if (typeof window === 'undefined') return false;
  try {
    const hostDoc = typeof window.frameElement !== 'undefined' ? window.frameElement.ownerDocument : null;
    if (!hostDoc) return false;
    const hud = hostDoc.getElementById(HUD_HOST_ID);
    return !!(hud && hud.tagName === 'IFRAME');
  } catch {
    return false;
  }
});

/** 宿主绝对定位与 Z-Index 阶梯治理：若在宿主独立窗口化 iframe 内部，填满 iframe；否则退化使用绝对坐标 */
const hostStyle = computed(() => {
  if (isInsideWindowedIframe.value) {
    return {
      left: '0px',
      top: '0px',
      width: '100%',
      height: '100%',
      zIndex: shell.state.collapsed ? 9996 : 9995,
    };
  }
  return {
    left: `${shell.state.x}px`,
    top: `${shell.state.y}px`,
    zIndex: shell.state.collapsed ? 9996 : 9995,
  };
});

/** 动态同步宿主 HUD iframe 物理包围盒（贴合手持板真实几何尺寸，开启原生 pointer-events: auto 响应） */
watch(
  [
    () => shell.state.x,
    () => shell.state.y,
    () => shell.state.collapsed,
    () => shell.state.sizeMode,
    () => shell.dynamicSize?.().width,
    () => shell.dynamicSize?.().height,
    () => shell.state.hidden,
    () => shell.state.dockSide,
    () => pillItems.value.length > 0,
    () => notificationQueue.value.visible.length,
    isPillDismissed,
    isFanoutOpen,
  ],
  () => {
    if (shell.state.hidden) {
      syncHudHostGeometry({ x: 0, y: 0, width: 0, height: 0, hidden: true });
      return;
    }

    if (shell.state.collapsed) {
      const hasActivePill = pillItems.value.length > 0 && !isPillDismissed.value;
      if (hasActivePill) {
        const visibleCount = notificationQueue.value.visible.length;
        const hasFanout = visibleCount >= 2 && isFanoutOpen.value;
        const hasOverflow = notificationQueue.value.overflowCount > 0;
        // 44px(纽扣) + 8px(gap-2) + 240px(胶囊条) = 292px 内容宽 + 两侧各 10px 阴影与角标安全余量 = 312px
        const totalWidth = 312;
        const fanoutHeight =
          64 + 44 + visibleCount * 36 + (hasOverflow ? 32 : 0) + 20;
        const totalHeight = hasFanout ? Math.max(248, fanoutHeight) : 64;
        const x =
          shell.state.dockSide === 'right'
            ? Math.max(0, shell.state.x - (totalWidth - 60))
            : Math.max(0, shell.state.x - 8);
        const y = Math.max(0, shell.state.y - 8);
        syncHudHostGeometry({
          x,
          y,
          width: totalWidth,
          height: totalHeight,
          hidden: false,
        });
      } else {
        syncHudHostGeometry({
          x: Math.max(0, shell.state.x - 8),
          y: Math.max(0, shell.state.y - 8),
          width: 60,
          height: 60,
          hidden: false,
        });
      }
    } else {
      const expSize = shell.dynamicSize ? shell.dynamicSize() : shell.size();
      syncHudHostGeometry({
        x: shell.state.x,
        y: shell.state.y,
        width: expSize.width,
        height: expSize.height,
        hidden: false,
      });
    }
  },
  { immediate: true },
);

function onBeaconClick() {
  emit('beacon-click');
}

function onAdoptLore(item: NormalizedPendingLoreItem) {
  emit('adopt-lore', item);
}

function onSaveMemo(text: string) {
  emit('save-memo', text);
}

function onFanoutSelect(item: PdaEventItem) {
  emit('select-notification', item);
}

function onFanoutMarkAllRead() {
  emit('mark-all-read');
}

onUnmounted(() => {
  isComponentUnmounted = true;
  if (layoutUnsubscribe) {
    try {
      void layoutUnsubscribe();
    } catch {
      /* 忽略 unsubscribe 异常 */
    }
    layoutUnsubscribe = null;
  }
  if (isInternalShell) {
    shell.destroy();
  }
});

defineExpose({
  shell,
  notificationQueue,
});
</script>

<style scoped>
.tactical-pda-host {
  /* 确保不因父容器的 flex 布局或 transform 发生漂移 */
  box-sizing: border-box;
}
</style>
