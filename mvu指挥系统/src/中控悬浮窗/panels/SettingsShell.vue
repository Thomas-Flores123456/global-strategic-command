<template>
  <!--
    SettingsShell —— VSCode/浏览器设置范式壳（CTRL-SETTINGS-SHELL-01）：
    左侧导航栏「只放一级分组」＋ 右侧主内容区（顶部可选横向子页 tab 栏 + 下方具名 slot 主内容）。
    纯壳组件：只负责导航结构与选中态，不含任何业务逻辑；分组由 `groups` 配置驱动，
    右侧内容通过 `#panel-<组key>` 具名 slot 由父组件注入，后续逐区迁移只需追加一条 group + 一个 slot。

    子页机制（pages）：预留给「后续内容量大的分组」（如未来 DLC 管理）。
    - 左栏「绝不」嵌套子页列表，只显示一级分组条目；
    - 仅当某个分组声明了多个子页（pages.length > 0）时，才在「右侧内容区顶部」渲染一条横向子页 tab 条；
    - 桌面态与窄屏态形态一致：子页 tab 条「始终」位于右侧内容区顶部；
    - 本任务两组（环境、内容体检）均不声明 pages，故实际不显示任何子页 tab 条。
    窄屏（<640，参考 shell.ts NARROW_BREAKPOINT）左栏折叠为顶部横向条，不截断右侧内容；子页栏仍在右侧内容区顶部。
  -->
  <div class="ra-settings-shell flex min-h-0 flex-1 overflow-hidden" :class="narrow ? 'flex-col' : 'flex-row'">
    <!-- 左侧导航栏（只放一级分组；窄屏退化为顶部横向滚动条） -->
    <nav
      class="ra-settings-nav flex-none border-[var(--rac-dim)]/60 bg-[var(--rac-panel)]"
      :class="narrow ? 'flex overflow-x-auto border-b' : 'w-[148px] overflow-y-auto border-r'"
      aria-label="设置分组导航"
    >
      <ul :class="narrow ? 'flex gap-0' : 'flex flex-col py-1.5'">
        <li v-for="group in groups" :key="group.key" class="flex-none">
          <button
            type="button"
            class="ra-nav-item flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] font-bold tracking-wide transition-all"
            :class="
              activeGroup === group.key
                ? 'is-active ra-nav-item--active text-[var(--rac-hi)]'
                : 'ra-nav-item--inactive text-[var(--rac-muted)] hover:bg-[var(--rac-panel-2)] hover:text-[var(--rac-hi)]'
            "
            :aria-current="activeGroup === group.key ? 'page' : undefined"
            @click="selectGroup(group.key)"
          >
            <span class="flex min-w-0 items-center gap-2">
              <span
                v-if="group.icon"
                class="flex-none transition-colors"
                :class="activeGroup === group.key ? 'text-[var(--rac-accent)]' : 'text-current'"
              >
                <Icon :name="group.icon as any" :size="13" />
              </span>
              <span class="truncate">{{ group.label }}</span>
            </span>
            <span
              v-if="group.badge"
              class="ra-nav-badge ob-num flex-none rounded-[2px] border border-[var(--rac-warn)]/60 bg-[var(--rac-warn)]/15 px-1.5 py-0.5 text-[11px] leading-none font-bold text-[var(--rac-warn)]"
            >
              {{ group.badge }}
            </span>
          </button>
        </li>
      </ul>
    </nav>

    <!-- 右侧主内容区 -->
    <div class="ra-settings-body min-w-0 flex-1 overflow-y-auto bg-[var(--rac-bg)]">
      <!--
        子页 tab 栏：始终渲染在右侧内容区顶部（桌面/窄屏一致），
        仅当当前组声明了多个子页（pages.length > 0）时才出现。
      -->
      <div
        v-if="activeGroupPages.length"
        class="ra-sub-tabbar ob-seg sticky top-0 z-1 flex w-full flex-wrap gap-0 rounded-none border-x-0 border-t-0 px-2"
        role="tablist"
        aria-label="子页切换"
      >
        <button
          v-for="page in activeGroupPages"
          :key="page.key"
          type="button"
          role="tab"
          class="-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-[12px] font-bold transition-all"
          :class="
            activePage === page.key
              ? 'is-active ra-sub-tab--active text-[var(--rac-hi)]'
              : 'ra-sub-tab--inactive border-transparent text-[var(--rac-muted)] hover:text-[var(--rac-text)]'
          "
          :aria-selected="activePage === page.key"
          @click="selectPage(page.key)"
        >
          <span>{{ page.label }}</span>
          <span
            v-if="page.badge"
            class="ob-num rounded-[2px] border border-[var(--rac-warn)]/60 bg-[var(--rac-warn)]/15 px-1 py-0.5 text-[11px] leading-none font-bold text-[var(--rac-warn)]"
          >
            {{ page.badge }}
          </span>
        </button>
      </div>

      <div class="p-4">
        <!-- 右侧主内容 slot：优先具名子页 slot（panel-<组>-<子页> 或显式 page.slot），否则回退到组级 slot（panel-<组>） -->
        <slot v-if="activePageSlot && $slots[activePageSlot]" :name="activePageSlot" />
        <slot v-else :name="`panel-${activeGroup}`" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';

/** 次级子页（右侧顶部横向 tab；支持显式 slot 兼容桥与子页角标） */
export interface SettingsPage {
  key: string;
  label: string;
  /** 可选：显式指定该子页对应的具名 slot（如 'panel-books'）；缺省为 `panel-${group.key}-${page.key}` */
  slot?: string;
  /** 可选：子页角标（如待审补丁数） */
  badge?: string;
}

/** 左栏一级分组条目 */
export interface SettingsGroup {
  key: string;
  label: string;
  icon?: string;
  /** 可选：组级角标（如待审补丁数、DEV 标识） */
  badge?: string;
  /**
   * 可选：该组在右侧内容区顶部再拆为多个横向子页 tab。
   * 不传/为空则右侧不显示子页栏，直接平铺组级内容。
   */
  pages?: SettingsPage[];
}

const props = defineProps<{
  groups: SettingsGroup[];
  /** 窄屏形态（由父组件按 shell 视口传入，默认 false）：折叠左栏为顶部横向条 */
  narrow?: boolean;
}>();

// 选中态自持有：默认首组，切组时落到该组首个子页（若有）
const activeGroup = ref<string>(props.groups[0]?.key ?? '');
const activePage = ref<string>(props.groups[0]?.pages?.[0]?.key ?? '');

const activeGroupPages = computed<SettingsPage[]>(() => {
  return props.groups.find(g => g.key === activeGroup.value)?.pages ?? [];
});

const activePageObj = computed<SettingsPage | undefined>(() =>
  activeGroupPages.value.find(p => p.key === activePage.value) ?? activeGroupPages.value[0],
);

/** 当前应渲染的具名子页 slot 名（支持显式 page.slot 兼容桥；无子页时为空，回退组级 slot） */
const activePageSlot = computed<string>(() => {
  if (!activeGroupPages.value.length) return '';
  return activePageObj.value?.slot || `panel-${activeGroup.value}-${activePage.value}`;
});

function selectGroup(key: string) {
  if (activeGroup.value === key) return;
  activeGroup.value = key;
  const pages = props.groups.find(g => g.key === key)?.pages ?? [];
  activePage.value = pages[0]?.key ?? '';
}

function selectPage(key: string) {
  activePage.value = key;
}

defineExpose({ activeGroup, activePage });
</script>

<style scoped>
/* 左栏窄条滚动隐藏，避免窄屏出现双滚动条视觉噪声 */
.ra-settings-nav {
  scrollbar-width: thin;
  border-color: color-mix(in srgb, var(--rac-accent) 20%, var(--rac-dim));
}

.ra-nav-item {
  border-left: 3px solid transparent;
  border-top: 1px solid transparent;
  border-bottom: 1px solid transparent;
}

.ra-nav-item--active {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--rac-accent) 22%, var(--rac-panel-2)) 0%,
    color-mix(in srgb, var(--rac-accent) 6%, var(--rac-panel)) 100%
  );
  border-left: 3px solid var(--rac-accent);
  border-top: 1px solid color-mix(in srgb, var(--rac-accent) 38%, var(--rac-dim));
  border-bottom: 1px solid color-mix(in srgb, var(--rac-accent) 38%, var(--rac-dim));
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 22%, transparent);
  color: var(--rac-hi);
}

.ra-sub-tabbar {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--rac-accent) 8%, var(--rac-panel)) 0%,
    var(--rac-panel) 100%
  );
  border-bottom: 1px solid color-mix(in srgb, var(--rac-accent) 28%, var(--rac-dim));
}

/* 子页 tab 激活态下划线与阵营底衬 */
.ra-sub-tab--active {
  border-bottom: 2px solid var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 18%, var(--rac-panel-2));
  color: var(--rac-hi);
}

.ra-sub-tab--inactive {
  border-bottom-color: transparent;
  color: var(--rac-muted);
}

.ra-sub-tab--inactive:hover {
  background: color-mix(in srgb, var(--rac-accent) 7%, var(--rac-panel-2));
  color: var(--rac-text);
}
</style>
