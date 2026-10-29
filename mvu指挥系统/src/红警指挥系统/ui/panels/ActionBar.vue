<template>
  <section class="border-t" style="border-color: var(--line); background: rgba(7, 13, 18, 0.7)">
    <!-- ══ 行动建议：宽松单行，不堆控件 ══ -->
    <div class="px-3 pt-4 pb-3">
      <div class="mb-2.5 flex items-center justify-between">
        <span class="section-label">行动建议</span>
        <span style="font-size: 9px; color: var(--text-4)">代价仅为预估</span>
      </div>
      <div class="decision-rail">
        <button
          v-for="(option, index) in data.options"
          :key="index"
          class="decision-option grid grid-cols-[26px_1fr_auto] items-center gap-3 px-2 py-3 text-left"
          @click="choose(option)"
        >
          <span class="decision-index">{{ index + 1 }}</span>
          <span class="min-w-0">
            <span class="block" style="color: var(--text); font-size: 12px; line-height: 1.6">{{ option.text }}</span>
            <span v-if="option.cost" class="mono mt-1 block" style="font-size: 9px; color: var(--amber)">{{
              option.cost
            }}</span>
          </span>
          <span v-if="option.tag" class="hud-tag hud-tag--muted">{{ option.tag }}</span>
        </button>
      </div>

      <!-- 自定义默认收起 -->
      <button
        v-if="!show_custom"
        class="mt-1 flex w-full items-center gap-2 px-2 py-2"
        style="font-size: 10.5px; color: var(--text-3)"
        @click="show_custom = true"
      >
        <span class="mono" style="color: var(--ice)">&gt;_</span>
        自定义行动
      </button>
      <div v-else class="command-prompt mt-2 flex items-center">
        <span class="mono pl-2" style="color: var(--ice); font-size: 10px">&gt;_</span>
        <input
          id="tw-command-custom-action"
          ref="customInput"
          v-model="custom"
          name="custom-action"
          aria-label="自定义行动"
          class="min-w-0 flex-1 bg-transparent px-2 py-2.5 outline-none"
          style="color: var(--text); font-size: 11.5px"
          placeholder="输入行动，回车发送"
          @keydown.enter="sendCustom"
          @keydown.esc="closeCustom"
        />
        <button
          class="icon-button"
          :style="{ color: custom.trim() ? 'var(--ice)' : 'var(--text-4)' }"
          aria-label="发送"
          @click="sendCustom"
        >
          <Icon name="send" :size="11" />
        </button>
      </div>
    </div>

    <!-- ══ 指挥工具带 ══ -->
    <div class="grid grid-cols-4 border-t" style="border-color: var(--line)">
      <button
        v-for="command in commands"
        :key="command.key"
        class="quick-command flex items-center justify-center gap-2 border-r py-3 last:border-r-0"
        :class="{ 'quick-command--active': active_menu === command.key }"
        style="border-color: var(--line); color: var(--text-3)"
        @click="toggleMenu(command.key)"
      >
        <Icon :name="command.icon" :size="11" />
        <span style="font-size: 10.5px; letter-spacing: 0.08em">{{ command.label }}</span>
      </button>
    </div>

    <!-- 前端推导菜单 -->
    <div
      v-if="active_menu"
      class="command-menu border-t px-3 py-3"
      style="border-color: var(--line); background: var(--glass-soft)"
    >
      <template v-if="active_menu === 'build'">
        <div class="section-label mb-2 px-2">可建造</div>
        <MenuRow
          v-for="building in buildable"
          :key="building.name"
          :label="building.name"
          :meta="`${building.cost} · ${building.power < 0 ? '发电' + -building.power : '耗电' + building.power}`"
          :disabled="building.cost > data.economy.credits"
          @pick="order('建造', building.name, building.cost)"
        />
        <div v-if="!buildable.length" class="px-2 py-2" style="font-size: 10.5px; color: var(--text-4)">无可建项</div>
      </template>

      <template v-else-if="active_menu === 'research'">
        <div class="section-label mb-2 px-2">可研究</div>
        <MenuRow
          v-for="research in researchable"
          :key="research.name"
          :label="research.name"
          :meta="`${research.cost} · ${research.eta}`"
          :disabled="research.cost > data.economy.credits || hasResearchInQueue"
          @pick="order('研究', research.name, research.cost)"
        />
        <div
          v-if="hasResearchInQueue"
          class="flex items-center gap-2 px-2 py-2"
          style="font-size: 10px; color: var(--amber)"
        >
          <Icon name="alert" :size="9" />研究槽占用中
        </div>
      </template>

      <template v-else-if="active_menu === 'produce'">
        <div class="section-label mb-2 px-2">可生产</div>
        <MenuRow
          v-for="product in producible"
          :key="product.name"
          :label="product.name"
          :meta="`${product.cost} · ${product.need_building}`"
          :disabled="product.cost > data.economy.credits"
          @pick="order('生产', product.name, product.cost)"
        />
        <div v-if="!producible.length" class="px-2 py-2" style="font-size: 10.5px; color: var(--text-4)">
          无可生产项
        </div>
      </template>

      <template v-else-if="active_menu === 'skip'">
        <div class="section-label mb-2 px-2">推进时间</div>
        <MenuRow label="至明日清晨" meta="推进一日" @pick="skip('至明日清晨')" />
        <MenuRow label="跳过三日" meta="推进三日" @pick="skip('跳过三日')" />
        <MenuRow label="至队列完成" meta="按最长队列" @pick="skip('至当前队列全部完成')" />
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import Icon from '../Icon.vue';
import { deriveBuildableWithContext, deriveProducibleWithContext, deriveResearchableWithContext } from '../../core/catalog';
import { buildCatalogPrerequisiteContext, queueItemsForAction } from '../../core/catalogRuntimeContext';
import { sendAction } from '../../worldbook/send';
import { useDataStore } from '../../composables/store';
import { useCatalogStore } from '../../composables/useCatalog';
import { ui } from '../ui';
import MenuRow from './MenuRow.vue';

const store = useDataStore();
const catalog = useCatalogStore();
const data = computed(() => store.data);
const currentBase = computed(() => {
  const byIndex = data.value.bases[ui.base_index];
  // CTRL-RETIRE-01：行动选项不引用退役实体；指向退役/越界时回退首个在役基地
  if (byIndex && byIndex.status !== '废弃') return byIndex;
  return data.value.bases.find(b => b.status !== '废弃') ?? byIndex ?? data.value.bases[0];
});
const custom = ref('');
const show_custom = ref(false);
const customInput = ref<HTMLInputElement | null>(null);
const active_menu = ref<'' | 'build' | 'research' | 'produce' | 'skip'>('');

const commands = [
  { key: 'build', label: '建造', icon: 'hammer' },
  { key: 'research', label: '研究', icon: 'flask' },
  { key: 'produce', label: '生产', icon: 'gear' },
  { key: 'skip', label: '跳时', icon: 'clock' },
] as const;

watch(show_custom, async shown => {
  if (!shown) return;
  await nextTick();
  customInput.value?.focus();
});

function toggleMenu(key: typeof active_menu.value) {
  active_menu.value = active_menu.value === key ? '' : key;
}
function closeCustom() {
  custom.value = '';
  show_custom.value = false;
}

const prerequisiteContext = computed(() => {
  const base = currentBase.value;
  if (!base) return null;
  return buildCatalogPrerequisiteContext({
    bases: data.value.bases,
    selectedBaseId: base.id,
    techDone: data.value.tech.done,
    forces: data.value.forces,
  });
});
const queuedResearchItems = computed(() =>
  currentBase.value ? queueItemsForAction(data.value.queues, '研究', currentBase.value.id, data.value.bases) : [],
);
const queuedBuildItems = computed(() =>
  currentBase.value ? queueItemsForAction(data.value.queues, '建造', currentBase.value.id, data.value.bases) : [],
);
const queuedProductionItems = computed(() =>
  currentBase.value ? queueItemsForAction(data.value.queues, '生产', currentBase.value.id, data.value.bases) : [],
);
const hasResearchInQueue = computed(() => queuedResearchItems.value.length > 0);
const buildable = computed(() =>
  prerequisiteContext.value
    ? deriveBuildableWithContext(catalog.buildings, prerequisiteContext.value, queuedBuildItems.value)
    : [],
);
const researchable = computed(() =>
  prerequisiteContext.value
    ? deriveResearchableWithContext(catalog.researches, prerequisiteContext.value, queuedResearchItems.value)
    : [],
);
const producible = computed(() =>
  prerequisiteContext.value
    ? deriveProducibleWithContext(catalog.productions, prerequisiteContext.value).filter(
        product => !queuedProductionItems.value.includes(product.name),
      )
    : [],
);

function choose(option: { text: string }) {
  sendAction(option.text);
}
function sendCustom() {
  const text = custom.value.trim();
  if (!text) return;
  custom.value = '';
  show_custom.value = false;
  sendAction(text);
}
function order(type: '建造' | '研究' | '生产', item: string, cost: number) {
  const base = currentBase.value;
  if (!base || !prerequisiteContext.value) return;
  active_menu.value = '';
  sendAction(
    `（指挥指令：在【${base.name}】下达${type}命令——${item}，预算 ${cost} 资金。请扣除资金并将其加入队列；队列的 base 字段必须记录基地 ID「${base.id}」。）`,
  );
}
function skip(label: string) {
  active_menu.value = '';
  sendAction(`（指挥指令：推进时间${label}，请结算队列进度、资金收支与期间事件。）`);
}
</script>
