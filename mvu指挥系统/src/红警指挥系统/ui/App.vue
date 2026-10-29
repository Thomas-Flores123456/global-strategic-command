<template>
  <div class="terminal-shell flex flex-col">
    <!-- ══ 折叠态：单行摘要，不撑开楼层（catalog.ready 初始化屏障：overlay 就绪前不渲染，见 DLC设计.md §6）══ -->
    <button v-if="catalog.ready && !expanded" class="collapse-bar" aria-expanded="false" @click="expanded = true">
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="relative flex size-6 flex-none items-center justify-center" style="color: var(--ice)">
          <span class="absolute top-0 left-0 size-1.5 border-t border-l" style="border-color: var(--line-hot)" />
          <span class="absolute right-0 bottom-0 size-1.5 border-r border-b" style="border-color: var(--line-hi)" />
          <Icon name="signal" :size="11" />
        </span>
        <span style="color: var(--text); font-size: 12px; letter-spacing: 0.1em">指挥终端</span>
        <span v-if="alertCount" class="hud-tag hud-tag--danger flex-none">{{ alertCount }} 警报</span>
      </div>
      <div class="mono flex flex-none items-center gap-3" style="font-size: 10.5px">
        <span class="flex items-center gap-1.5">
          <Icon name="credits" :size="9" style="color: var(--text-4)" />
          <span style="color: var(--text-2)">{{ data.economy.credits.toLocaleString() }}</span>
        </span>
        <span class="flex items-center gap-1.5">
          <Icon name="power" :size="9" style="color: var(--text-4)" />
          <span :style="{ color: netPower >= 0 ? 'var(--safe)' : 'var(--danger)' }"
            >{{ netPower >= 0 ? '+' : '' }}{{ netPower }}</span
          >
        </span>
        <span class="flex items-center gap-1.5">
          <Icon name="eye" :size="9" style="color: var(--text-4)" />
          <span :style="{ color: exposureColor }">{{ data.exposure.value.toFixed(2) }}</span>
        </span>
        <Icon name="chevron-down" :size="9" style="color: var(--text-3)" />
      </div>
    </button>

    <!-- ══ 展开态：完整指挥终端 ══ -->
    <template v-else-if="catalog.ready">
      <header class="hud-header flex items-center justify-between px-4 py-3">
        <div class="flex items-center gap-3">
          <span class="relative flex size-7 items-center justify-center" style="color: var(--ice)">
            <span class="absolute top-0 left-0 size-2 border-t border-l" style="border-color: var(--line-hot)" />
            <span class="absolute right-0 bottom-0 size-2 border-r border-b" style="border-color: var(--line-hi)" />
            <Icon name="signal" :size="13" />
          </span>
          <div class="leading-none">
            <div style="color: var(--text); font-size: 13px; letter-spacing: 0.12em">指挥终端</div>
            <div class="mono mt-1.5" style="font-size: 8px; color: var(--text-4); letter-spacing: 0.14em">
              BEIPO / 01
            </div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="theme-switch" role="radiogroup" aria-label="阵营配色">
            <button
              v-for="t in THEMES"
              :key="t.key"
              class="theme-dot"
              :class="{ 'theme-dot--on': ui.theme === t.key }"
              :style="{ '--dot': t.color }"
              role="radio"
              :aria-checked="ui.theme === t.key"
              :aria-label="t.label"
              :title="t.label"
              @click="setTheme(t.key)"
            />
          </div>
          <div class="mono flex items-center gap-2" style="font-size: 10px; color: var(--safe)">
            <span class="status-dot" />
            联机
          </div>
          <button class="icon-button" style="color: var(--text-3)" aria-label="收起终端" @click="expanded = false">
            <Icon name="chevron-up" :size="11" />
          </button>
        </div>
      </header>

      <!-- ══ 模块导航：只留文字，减少视觉噪声 ══ -->
      <nav class="hud-header grid grid-cols-7 px-2" aria-label="指挥系统模块">
        <button
          v-for="tab in tabs"
          :key="tab"
          class="nav-tab relative py-3 text-center"
          :class="{ 'nav-tab--active': active_tab === tab }"
          :aria-current="active_tab === tab ? 'page' : undefined"
          @click="active_tab = tab"
        >
          <span style="font-size: 11px; letter-spacing: 0.12em">{{ tab }}</span>
          <span
            v-if="tab === '情报' && unreadIntel"
            class="mono absolute top-1.5 right-[18%] flex h-3 min-w-3 items-center justify-center px-0.5"
            style="background: var(--amber); color: var(--void); font-size: 7.5px; line-height: 1"
          >
            {{ unreadIntel }}
          </span>
        </button>
      </nav>

      <main>
        <PanelBase v-if="active_tab === '基地'" />
        <PanelTech v-else-if="active_tab === '科技'" />
        <PanelForces v-else-if="active_tab === '军力'" />
        <PanelFactions v-else-if="active_tab === '势力'" />
        <PanelIntel v-else-if="active_tab === '情报'" />
        <PanelQuests v-else-if="active_tab === '任务'" />
        <PanelSystem v-else-if="active_tab === '系统'" />
      </main>

      <ActionBar />

      <!-- ══ 常显遥测：四项需求，一行解决 ══ -->
      <footer class="hud-header grid grid-cols-4 border-t" style="border-color: var(--line)">
        <div class="telemetry-cell flex items-center justify-center gap-2 py-2.5" title="系统资金">
          <Icon name="credits" :size="10" style="color: var(--text-3)" />
          <span class="mono" style="color: var(--text); font-size: 10.5px">{{
            data.economy.credits.toLocaleString()
          }}</span>
        </div>
        <div class="telemetry-cell flex items-center justify-center gap-2 py-2.5" title="净电力">
          <Icon name="power" :size="10" style="color: var(--text-3)" />
          <span class="mono" :style="{ color: netPower >= 0 ? 'var(--safe)' : 'var(--danger)', fontSize: '10.5px' }">
            {{ netPower >= 0 ? '+' : '' }}{{ netPower }}
          </span>
        </div>
        <div class="telemetry-cell flex items-center justify-center gap-2 py-2.5" title="日期">
          <Icon name="calendar" :size="10" style="color: var(--text-3)" />
          <span style="color: var(--text-2); font-size: 10px">{{ shortDate }}</span>
        </div>
        <div class="telemetry-cell flex items-center justify-center gap-2 py-2.5" title="暴露度">
          <Icon name="eye" :size="10" style="color: var(--text-3)" />
          <span class="mono" :style="{ color: exposureColor, fontSize: '10.5px' }">{{
            data.exposure.value.toFixed(2)
          }}</span>
        </div>
      </footer>
    </template>

    <DetailDrawer />
  </div>
</template>

<script setup lang="ts">
import DetailDrawer from './DetailDrawer.vue';
import Icon from './Icon.vue';
import ActionBar from './panels/ActionBar.vue';
import PanelBase from './panels/PanelBase.vue';
import PanelFactions from './panels/PanelFactions.vue';
import PanelForces from './panels/PanelForces.vue';
import PanelIntel from './panels/PanelIntel.vue';
import PanelQuests from './panels/PanelQuests.vue';
import PanelSystem from './panels/PanelSystem.vue';
import PanelTech from './panels/PanelTech.vue';
import { useDataStore } from '../composables/store';
import { setTheme, ui, type ThemeKey } from './ui';
import { useCatalogStore } from '../composables/useCatalog';

const tabs = ['基地', '科技', '军力', '势力', '情报', '任务', '系统'] as const;
type TabKey = (typeof tabs)[number];
const active_tab = ref<TabKey>('基地');

/** 整卡折叠：默认收起，楼层里只占一行 */
const expanded = ref(false);

/** 阵营配色：data-theme 挂在 #app 元素上（同元素覆盖变量，兼容桥同步重算） */
const THEMES: { key: ThemeKey; label: string; color: string }[] = [
  { key: 'allied', label: '盟军蓝', color: '#8bc3e7' },
  { key: 'soviet', label: '苏联红', color: '#e25555' },
  { key: 'yuri', label: '尤里紫', color: '#b892e5' },
];
watchEffect(() => {
  document.querySelector('#app')?.setAttribute('data-theme', ui.theme);
});

const store = useDataStore();
const catalog = useCatalogStore();
catalog.init(); // 初始化屏障：同步读 $dlc overlay，读完置 ready 放行 UI
const data = computed(() => store.data);
const netPower = computed(() => data.value.bases.reduce((sum, base) => sum + base.power.gen - base.power.use, 0));
const unreadIntel = computed(() => data.value.intel.filter(item => !item.read).length);
const alertCount = computed(() => data.value.bases.reduce((sum, base) => sum + base.alerts.length, 0));
const shortDate = computed(() => data.value.meta.date.replace(/^.*·/, ''));
const exposureColor = computed(() => {
  const value = data.value.exposure.value;
  if (value < 4) return 'var(--safe)';
  if (value < 6) return 'var(--amber)';
  return 'var(--danger)';
});
</script>
