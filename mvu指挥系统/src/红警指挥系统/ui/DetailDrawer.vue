<template>
  <Transition name="drawer">
    <div v-if="detail.open && detail.data" ref="drawerMaskRef" class="detail-mask" @click.self="closeDetail">
      <section ref="drawerSheetRef" class="detail-sheet" role="dialog" aria-modal="true" :aria-label="detail.data.title">
        <header class="flex items-start justify-between gap-3 border-b px-4 pt-3.5 pb-3" style="border-color: var(--line)">
          <div class="flex min-w-0 flex-wrap items-center gap-2.5">
            <span style="color: var(--text); font-size: 14px; letter-spacing: 0.06em; font-weight: 700">{{ detail.data.title }}</span>
            <span class="hud-tag hud-tag--muted">{{ detail.data.kind }}</span>
          </div>
          <button class="icon-button pressable flex-none" style="color: var(--text-3)" aria-label="关闭详情" @click="closeDetail">
            <Icon name="close" :size="12" />
          </button>
        </header>

        <div class="detail-sheet__scroll px-4 py-3.5">
          <div v-if="detail.data.params.length" class="grid grid-cols-2 gap-1.5">
            <div v-for="[k, v] in detail.data.params" :key="k" class="detail-param rounded-[2px]">
              <div style="font-size: 9px; color: var(--text-4); letter-spacing: 0.1em">{{ k }}</div>
              <div class="mono mt-1" style="font-size: 11.5px; color: var(--text)">{{ v }}</div>
            </div>
          </div>

          <p v-if="detail.data.desc" class="mt-3 mb-0" style="font-size: 12px; line-height: 1.8; color: var(--text-2)">
            {{ detail.data.desc }}
          </p>

          <div v-if="detail.data.note" class="mt-3 flex items-center gap-1.5" style="font-size: 10px; color: var(--text-4)">
            <Icon name="intel" :size="10" />
            {{ detail.data.note }}
          </div>

          <!-- FD-39 (PKG-D)：本基地现有与在建设施列表 -->
          <div
            v-if="isBuildingKind && currentBaseInstances.length > 0"
            class="mt-3.5 rounded-[3px] border border-[#38bdf8]/30 bg-[#0b1522]/80 p-2.5"
            data-test="drawer-building-instances"
          >
            <div class="mb-2 flex items-center justify-between text-[11px] font-bold tracking-wider text-[#7dd3fc]">
              <span>◆ 本基地现有与在建设施（{{ currentBase?.name || '主基地' }} · 共 {{ currentBaseInstances.length }} 座）</span>
            </div>
            <div class="flex flex-col gap-1.5">
              <div
                v-for="inst in currentBaseInstances"
                :key="`${inst.buildingIndex}-${inst.ordinal}`"
                class="flex flex-wrap items-center justify-between gap-1.5 rounded-[2px] border border-white/10 bg-black/35 px-2 py-1.5 font-mono text-[10.5px]"
                data-test="drawer-building-instance-item"
              >
                <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span class="font-bold text-[#e2e8f0]">#{{ inst.ordinal }} {{ inst.name }}</span>
                  <span
                    class="rounded-[2px] px-1.5 py-0.5 text-[10px]"
                    :class="{
                      'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40': inst.state === '运转',
                      'bg-sky-500/20 text-sky-300 border border-sky-500/40': inst.state === '建造中',
                      'bg-rose-500/25 text-rose-300 border border-rose-500/50': inst.state === '受损',
                      'bg-slate-500/25 text-slate-300 border border-slate-500/40': inst.state === '停机',
                    }"
                  >
                    <template v-if="inst.state === '建造中'">
                      {{ `建造中 ${inst.progress ?? 0}%${inst.eta ? ` ${inst.eta}` : ''}` }}
                    </template>
                    <template v-else-if="inst.state === '受损'">⚠️受损</template>
                    <template v-else>{{ inst.state }}</template>
                  </span>
                  <span class="rounded-[2px] border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-[#cbd5e1]">
                    [{{ inst.layer || '地面层' }}]
                  </span>
                  <span class="text-[10px] text-[#94a3b8]">
                    📍 {{ inst.ringLabel }} · {{ inst.bearingLabel }}
                  </span>
                  <span
                    v-for="addon in inst.addons"
                    :key="addon"
                    class="rounded-[2px] border border-cyan-400/40 bg-cyan-950/50 px-1.5 py-0.5 text-[9.5px] text-cyan-200"
                  >
                    ➕ {{ addon }}
                  </span>
                </div>
                <div class="flex items-center gap-1">
                  <button
                    v-if="inst.state === '受损'"
                    type="button"
                    class="pressable rounded-[2px] border border-rose-400/60 bg-rose-950/60 px-2 py-0.5 text-[10px] font-bold text-rose-200 hover:bg-rose-900/70"
                    data-test="drawer-instance-repair-btn"
                    @click="handleInstanceRepair(inst)"
                  >
                    【🛠️ 紧急抢修】
                  </button>
                  <button
                    v-if="inst.dualModeCapable && inst.state === '运转'"
                    type="button"
                    class="pressable rounded-[2px] border border-sky-400/50 bg-sky-950/50 px-2 py-0.5 text-[10px] text-sky-200 hover:bg-sky-900/60"
                    data-test="drawer-instance-mode-btn"
                    @click="handleInstanceModeSwitch(inst)"
                  >
                    {{ inst.mode === '加速' ? '🚀加速（切回生产）' : '⚙️生产（切换加速）' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ══ 战术指令下达工作流动作栏 ══ -->
        <footer
          v-if="isDispatchable"
          class="detail-sheet__footer flex flex-col gap-2 border-t px-4 py-2.5"
          style="border-color: var(--line); background: rgba(11, 16, 24, 0.95)"
        >
          <!-- 步兵/载具/飞机/生产列装：数量选择（1/5/10 或数值输入）与目标基地选择 -->
          <div v-if="isProduceKind" class="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div class="flex items-center gap-1">
              <span style="color: var(--text-3)">列装数量</span>
              <button
                v-for="preset in [1, 5, 10]"
                :key="preset"
                type="button"
                class="pressable rounded-[2px] border px-1.5 py-0.5 font-mono text-[10.5px]"
                :class="{
                  'opacity-40 cursor-not-allowed':
                    productionGate.isMaxedOut ||
                    (productionGate.remainingQuota !== null && preset > productionGate.remainingQuota),
                }"
                :disabled="
                  productionGate.isMaxedOut ||
                  (productionGate.remainingQuota !== null && preset > productionGate.remainingQuota)
                "
                :style="{
                  borderColor: produceQty === preset ? '#38bdf8' : 'var(--line)',
                  color: produceQty === preset ? '#38bdf8' : 'var(--text-2)',
                  background: produceQty === preset ? 'rgba(56, 189, 248, 0.14)' : 'rgba(255, 255, 255, 0.03)',
                }"
                @click="produceQty = preset"
              >
                ×{{ preset }}
              </button>
              <input
                v-model.number="produceQty"
                type="number"
                min="1"
                :max="productionGate.remainingQuota !== null ? Math.max(1, productionGate.remainingQuota) : 999"
                :disabled="productionGate.isMaxedOut"
                aria-label="列装数量"
                class="mono w-14 rounded-[2px] border bg-black/30 px-1.5 py-0.5 text-center text-[11px] outline-none"
                style="border-color: var(--line); color: var(--text)"
              />
            </div>
            <div v-if="availableBases.length" class="flex items-center gap-1">
              <span style="color: var(--text-3)">目标基地</span>
              <select
                v-model="selectedBaseName"
                aria-label="目标基地"
                class="rounded-[2px] border bg-black/40 px-1.5 py-0.5 text-[11px] outline-none"
                style="border-color: var(--line); color: var(--text)"
              >
                <option v-for="b in availableBases" :key="b.id || b.name" :value="b.name">
                  {{ b.name }}
                </option>
              </select>
            </div>
          </div>

          <!-- FD-22：建筑原位升级（补差价）与附属扩建提示条 -->
          <div
            v-if="buildingUpgradeInfo"
            class="rounded-[2px] border border-[#38bdf8]/40 bg-[#0c4a6e]/25 px-2.5 py-1.5 font-mono text-[10.5px] text-[#bae6fd]"
            data-test="building-upgrade-banner"
          >
            <template v-if="buildingUpgradeInfo.mode === 'addon'">
              ◆ <b>附属扩建模块</b> · 需依托已建成的「{{ buildingUpgradeInfo.hostLabel }}」（扩建费用
              <b>${{ buildingUpgradeInfo.cost }}</b>，完工后与原设施并存运转）
            </template>
            <template v-else-if="!buildingUpgradeInfo.standalone">
              ▲ <b>就地升级方案</b> · 将现有的「{{ buildingUpgradeInfo.hostLabel }}」升级为
              <b>{{ buildingUpgradeInfo.upgradedName }}</b>（升级费用 <b>${{ buildingUpgradeInfo.deltaCost }}</b>）
            </template>
            <template v-else-if="buildingUpgradeInfo.hasHostInCurrentBase">
              ▲ <b>可就地升级 · 基地已有「{{ buildingUpgradeInfo.matchedHostInBase }}」</b>：可补差价升级
              <b>${{ buildingUpgradeInfo.deltaCost }}</b>（直接新建造价 ${{ buildingUpgradeInfo.cost }}）
            </template>
            <template v-else>
              ◆ <b>支持直接新建，或在已有「{{ buildingUpgradeInfo.hostLabel }}」基础上补差价升级</b>（直接新建
              <b>${{ buildingUpgradeInfo.cost }}</b> / 补差价升级 <b>${{ buildingUpgradeInfo.deltaCost }}</b>）
            </template>
          </div>

          <!-- FD-39 (PKG-D)：建筑部署选址与建造方式配置栏 -->
          <div
            v-if="isBuildingKind"
            class="flex flex-col gap-1.5 rounded-[2px] border border-white/10 bg-black/30 p-2 font-mono text-[10.5px]"
            data-test="drawer-building-spatial-config"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-1.5" data-test="drawer-construct-strategy">
                <span style="color: var(--text-3)">建造方式</span>
                <template
                  v-if="
                    buildingUpgradeInfo?.mode === 'replace' &&
                    buildingUpgradeInfo.standalone &&
                    buildingUpgradeInfo.hasHostInCurrentBase
                  "
                >
                  <button
                    type="button"
                    class="pressable rounded-[2px] border px-2 py-0.5 text-[10px]"
                    :style="{
                      borderColor: selectedStrategy === 'new' ? '#38bdf8' : 'var(--line)',
                      color: selectedStrategy === 'new' ? '#38bdf8' : 'var(--text-2)',
                      background: selectedStrategy === 'new' ? 'rgba(56, 189, 248, 0.14)' : 'rgba(255, 255, 255, 0.03)',
                    }"
                    @click="selectedStrategy = 'new'"
                  >
                    ◆ 直接新建 (${{ buildingUpgradeInfo.cost }})
                  </button>
                  <button
                    type="button"
                    class="pressable rounded-[2px] border px-2 py-0.5 text-[10px]"
                    :style="{
                      borderColor: selectedStrategy === 'upgrade' ? '#38bdf8' : 'var(--line)',
                      color: selectedStrategy === 'upgrade' ? '#38bdf8' : 'var(--text-2)',
                      background:
                        selectedStrategy === 'upgrade' ? 'rgba(56, 189, 248, 0.14)' : 'rgba(255, 255, 255, 0.03)',
                    }"
                    @click="selectedStrategy = 'upgrade'"
                  >
                    ▲ 就地升级现有设施 (${{ buildingUpgradeInfo.deltaCost }})
                  </button>
                </template>
                <span v-else-if="selectedStrategy === 'addon'" class="text-[#7dd3fc]">
                  + 加装附属模块
                </span>
                <span v-else-if="selectedStrategy === 'upgrade'" class="text-[#7dd3fc]">
                  ▲ 就地升级替换
                </span>
                <span v-else class="text-[#cbd5e1]">
                  ◆ 直接新建<template v-if="currentBaseInstances.length > 0">（第{{ currentBaseInstances.length + 1 }}座）</template>
                </span>
              </div>

              <div v-if="availableBases.length > 1" class="flex items-center gap-1">
                <span style="color: var(--text-3)">目标基地</span>
                <select
                  v-model="selectedBaseName"
                  aria-label="建筑部署目标基地"
                  class="rounded-[2px] border bg-black/40 px-1.5 py-0.5 text-[10.5px] outline-none"
                  style="border-color: var(--line); color: var(--text)"
                >
                  <option v-for="b in availableBases" :key="b.id || b.name" :value="b.name">
                    {{ b.name }}
                  </option>
                </select>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <label class="flex items-center gap-1.5">
                <span class="flex-none" style="color: var(--text-3)">部署区域</span>
                <select
                  v-model="selectedLayer"
                  aria-label="部署区域"
                  data-test="drawer-layer-select"
                  class="min-w-0 flex-1 rounded-[2px] border bg-black/40 px-1.5 py-0.5 text-[10.5px] outline-none"
                  style="border-color: var(--line); color: var(--text)"
                >
                  <option v-for="opt in availableLayerOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
              </label>

              <label class="flex items-center gap-1.5">
                <span class="flex-none" style="color: var(--text-3)">布防方位</span>
                <select
                  v-model="selectedBearing"
                  aria-label="布防方位"
                  data-test="drawer-bearing-select"
                  class="min-w-0 flex-1 rounded-[2px] border bg-black/40 px-1.5 py-0.5 text-[10.5px] outline-none"
                  style="border-color: var(--line); color: var(--text)"
                >
                  <option v-for="bOpt in bearingPresetOptions" :key="bOpt.value" :value="bOpt.value">
                    {{ bOpt.label }}
                  </option>
                </select>
              </label>
            </div>

            <div class="flex items-center gap-1.5">
              <span class="flex-none" style="color: var(--text-3)">指定位置</span>
              <input
                v-model="customBearingInput"
                type="text"
                aria-label="自定义方位或坐标"
                data-test="drawer-custom-bearing-input"
                placeholder="自定义方位/坐标，如：东侧通风井旁 (2,1)"
                class="min-w-0 flex-1 rounded-[2px] border bg-black/30 px-2 py-0.5 text-[10.5px] outline-none"
                style="border-color: var(--line); color: var(--text)"
              />
            </div>
          </div>

          <div class="flex items-center justify-between gap-2">
            <div class="text-[10px] font-mono text-[#94a3b8] flex items-center gap-1.5">
              <span
                class="w-1.5 h-1.5 rounded-full"
                :class="canDispatch ? 'bg-[#38bdf8] animate-pulse' : 'bg-amber-500'"
              />
              <span
                v-if="!canDispatch"
                class="tracking-wide text-amber-300"
                data-test="research-gate-reason"
                >{{ dispatchHint }}</span
              >
              <span v-else class="tracking-wide">指挥链路联通 · 待命下达</span>
            </div>
            <button
              class="ra-dispatch-btn flex items-center gap-1.5 px-3.5 py-1.5 rounded-[3px] font-bold text-[11.5px] tracking-wider transition-all"
              :class="{ 'opacity-50 cursor-not-allowed': !canDispatch }"
              :disabled="!canDispatch"
              :title="dispatchHint || dispatchBtnText"
              data-test="dispatch-order-btn"
              aria-label="下达战术指令"
              @click="handleDispatch"
            >
              <Icon name="hammer" :size="13" />
              <span>{{ dispatchBtnText }}</span>
            </button>
          </div>
        </footer>
        <!-- ══ 工程指令闭环四令操作组（ENG-UI-03 / §3.8 / D19；kind='工程' 且携带 eng 载荷时渲染） ══ -->
        <footer
          v-if="engCmdButtons"
          class="detail-sheet__footer eng-cmd-footer border-t px-4 py-2.5"
          style="border-color: var(--line); background: rgba(11, 16, 24, 0.95)"
        >
          <div class="text-[10px] font-mono text-[#94a3b8] flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-[#38bdf8] animate-pulse" />
            <span class="tracking-wide">指挥链路联通 · 工程四令待命（指令载入输入栏，AI 结转执行）</span>
          </div>
          <div class="eng-cmd-group" role="group" :aria-label="engCmdGroupLabel">
            <button
              v-for="btn in engCmdButtons"
              :key="btn.verb"
              class="eng-cmd-btn pressable"
              :class="{ 'eng-cmd-btn--danger': btn.verb === '取消' }"
              :disabled="!btn.enabled"
              :title="btn.hint"
              :aria-label="btn.label"
              @click="handleEngCommand(btn)"
            >
              {{ btn.label }}
            </button>
          </div>
        </footer>

        <!-- 取消令二次确认弹层（§3.3 固定结算文案：注资不退、进度作废；层级压于本抽屉之上） -->
        <div v-if="cancelConfirmOpen" class="eng-cancel-mask" role="presentation" @click.self="cancelConfirmOpen = false">
          <section class="eng-cancel-card" role="alertdialog" aria-modal="true" :aria-label="ENG_COPY.confirm.title">
            <header class="eng-cancel-title">
              <Icon name="alert" :size="12" />
              {{ ENG_COPY.confirm.title }}
            </header>
            <p class="eng-cancel-text">{{ cancelSettlementText }}</p>
            <p class="eng-cancel-note">{{ ENG_COPY.confirm.note }}</p>
            <div class="eng-cancel-actions">
              <button class="eng-cmd-btn pressable" @click="cancelConfirmOpen = false">
                {{ ENG_COPY.confirm.deny }}
              </button>
              <button class="eng-cmd-btn eng-cmd-btn--danger pressable" @click="handleCancelAffirm">
                {{ ENG_COPY.confirm.affirm }}
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import toastr from 'toastr';
import Icon from './Icon.vue';
import { closeDetail, detail } from '../composables/useDetail';
import { deriveResearchableWithContext } from '../core/catalog';
import {
  buildCatalogPrerequisiteContext,
  buildCompletedTechAndProtocolSet,
  buildUnitPresent,
  extractActiveProtocolSet,
  queueItemsForAction,
} from '../core/catalogRuntimeContext';
import {
  combineLegacyPrerequisites,
  evaluatePrerequisite,
  UNIT_EQUIVALENT_GROUPS,
  type PrerequisiteContext,
  type PrerequisiteProtocolSource,
  type UnmetPrerequisite,
} from '../core/prerequisites';
import { BUILTIN_BUILDING_UPGRADE_SPECS } from '../engines/productionReconciliation';
import { useCatalogStore } from '../composables/useCatalog';
import { useDataStore } from '../composables/store';
import {
  ENG_COMMAND_COPY,
  buildCancelSettlement,
  buildOrderForButton,
  engCommandButtonsFor,
  type EngCommandButton,
} from '../../中控悬浮窗/models/engCommands';
import { fillHostSendInput } from '../worldbook/hostSendInput';
import {
  BUILDING_BEARING_PRESETS,
  buildDrawerInstanceQuickOrder,
  buildSpatialBuildingDispatchOrder,
  resolveAvailableLayerOptions,
  resolveDrawerBuildingInstances,
  type BuildingConstructStrategy,
  type DrawerBuildingInstanceItem,
} from './detailDrawerBuildingHelpers';
import { playTacticalDrawerEnter, scheduleNextFrame } from './motion/useGsapMotion';

const store = useDataStore();
const catalog = useCatalogStore();

const drawerMaskRef = ref<HTMLElement | null>(null);
const drawerSheetRef = ref<HTMLElement | null>(null);

watch(
  () => detail.open,
  isOpen => {
    if (isOpen) {
      scheduleNextFrame(() => {
        playTacticalDrawerEnter(drawerSheetRef.value, drawerMaskRef.value);
      });
    }
  },
  { flush: 'post' },
);

/** 列装数量与目标基地选择（FIX-P1-01 抽屉部分） */
const produceQty = ref(1);
const selectedBaseName = ref('');
const selectedStrategy = ref<BuildingConstructStrategy>('new');
const selectedLayer = ref('auto');
const selectedBearing = ref('auto');
const customBearingInput = ref('');
const availableBases = computed(() => store.data?.bases ?? []);
const currentBase = computed(() => {
  const bases = availableBases.value;
  return bases.find(b => b.name === selectedBaseName.value || b.id === selectedBaseName.value) ?? bases[0] ?? null;
});

watch(
  () => [detail.open, detail.data?.title] as const,
  ([open]) => {
    if (!open) return;
    produceQty.value = 1;
    const defBase = store.data?.bases?.[0]?.name || '';
    selectedBaseName.value = defBase;
    selectedLayer.value = 'auto';
    selectedBearing.value = 'auto';
    customBearingInput.value = '';
  },
  { immediate: true },
);

/** 工程四令文案集别名（模板引用） */
const ENG_COPY = ENG_COMMAND_COPY;

/* ══ 工程指令闭环四令（ENG-UI-03）：按钮组由 eng 载荷驱动，零 MVU 直写 ══ */

const engCmdButtons = computed<EngCommandButton[] | null>(() => {
  const eng = detail.data?.eng;
  if (!eng) return null;
  return engCommandButtonsFor(eng.project);
});

const engCmdGroupLabel = computed(() => ENG_COMMAND_COPY.groupLabel(detail.data?.eng?.project.ref ?? ''));

/** 取消令二次确认弹层状态（取消为终态操作，必须先过确认门） */
const cancelConfirmOpen = ref(false);

const cancelSettlementText = computed(() => {
  const eng = detail.data?.eng;
  return eng ? buildCancelSettlement(eng.project, eng.def) : '';
});

/* 抽屉关闭/换条时复位确认弹层（组件常驻，v-if 只切显隐） */
watch(
  () => detail.open,
  open => {
    if (!open) cancelConfirmOpen.value = false;
  },
);

/** 指令文本 → 宿主输入框（唯一写路径 hostSendInput：textarea 优先，/setinput 兜底） */
function sendEngOrder(orderText: string, label: string) {
  const channel = fillHostSendInput(orderText);
  if (channel === 'failed') {
    toastr.warning('宿主输入栏与 /setinput 均不可达，指令未载入', '工程指令');
    return;
  }
  toastr.success(`工程指令已载入输入栏：${orderText}`, label);
  closeDetail();
}

function handleEngCommand(btn: EngCommandButton) {
  const eng = detail.data?.eng;
  if (!eng || !btn.enabled) return;
  if (btn.verb === '取消') {
    cancelConfirmOpen.value = true; // 取消令先过二次确认弹层（附结算文案）
    return;
  }
  try {
    sendEngOrder(buildOrderForButton(btn, eng.project.id), `工程${btn.verb}令`);
  } catch (err) {
    toastr.warning(String(err), '工程指令拼装失败');
  }
}

function handleCancelAffirm() {
  const eng = detail.data?.eng;
  if (!eng) return;
  cancelConfirmOpen.value = false;
  try {
    sendEngOrder(buildOrderForButton({ verb: '取消', label: '', enabled: true, hint: '', phaseIdx: null }, eng.project.id), '工程取消令');
  } catch (err) {
    toastr.warning(String(err), '工程指令拼装失败');
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && cancelConfirmOpen.value) {
    // 确认弹层压于抽屉之上，优先拦截仅关自身
    event.stopImmediatePropagation();
    cancelConfirmOpen.value = false;
    return;
  }
  if (event.key === 'Escape' && detail.open) {
    // LIFO 先进后出：二级详情处于最上层（z-index: 10020），优先拦截并仅关闭自身，
    // 阻止事件继续派发至主弹窗的 Escape 监听，二次按键才关闭底层主模态。
    event.stopImmediatePropagation();
    closeDetail();
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));

const PERSONAL_DOSSIER_PARAM_KEYS = new Set([
  '随行渊源',
  '席位任命',
  '开局职务',
  '性格与口吻',
  '履历与绝活',
  '外貌着装',
  '所属势力',
  '态度',
  '信任度',
  '社会外壳',
  '暴露分档',
]);

/** 判断当前详情是否为只读档案查阅或个人/机娘/NPC 卷宗（禁止渲染底部列装生产/投入建造/研发立项操作栏） */
const isArchiveOrPersonalDossier = computed(() => {
  if (!detail.data) return false;
  if (detail.data.readonly === true) return true;
  const k = detail.data.kind;
  if (k === '机娘' || k === '人物' || k === '档案' || k === '阵营' || k === '势力' || k === '地点' || k === '保障工程') {
    return true;
  }
  const note = (detail.data.note ?? '').trim();
  if (
    note.startsWith('正史 ·') ||
    note.startsWith('只读基线 ·') ||
    note.startsWith('在册卷宗 ·') ||
    note.startsWith('待入档卷宗 ·') ||
    note.startsWith('草稿 ·') ||
    note.startsWith('动态档案 ·') ||
    note.startsWith('暂无详细档案')
  ) {
    return true;
  }
  if (k === '人员') {
    const hasPersonalParam = detail.data.params.some(([key]) => PERSONAL_DOSSIER_PARAM_KEYS.has(key));
    const hasCostParam = detail.data.params.some(([key]) => key.includes('造价') || key.includes('费用'));
    if (hasPersonalParam && !hasCostParam) return true;
  }
  return false;
});

/** 判断当前详情条目是否支持战术下达 */
const isDispatchable = computed(() => {
  if (!detail.data) return false;
  if (isArchiveOrPersonalDossier.value) return false;
  const k = detail.data.kind;
  if (['建筑', '生产', '科技', '人员', '载具', '飞机', '巨构', '防辅'].includes(k)) return true;
  return detail.data.params.some(([key]) => key.includes('造价') || key.includes('费用'));
});

/** 是否为步兵/载具/飞机/生产列装卡 */
const isProduceKind = computed(() => {
  if (!detail.data || isArchiveOrPersonalDossier.value) return false;
  return ['人员', '载具', '生产', '飞机'].includes(detail.data.kind);
});

/** FD-39 (PKG-D)：是否为建筑/防辅/巨构类详情卡 */
const isBuildingKind = computed(() => {
  if (isArchiveOrPersonalDossier.value) return false;
  const k = detail.data?.kind;
  return k === '建筑' || k === '防辅' || k === '巨构';
});

/** 当前选定基地内与本建筑同名的在场/在建实例列表 */
const currentBaseInstances = computed<DrawerBuildingInstanceItem[]>(() => {
  if (!detail.data || !isBuildingKind.value) return [];
  return resolveDrawerBuildingInstances(detail.data.title, currentBase.value, catalog.buildings);
});

const availableLayerOptions = computed(() => resolveAvailableLayerOptions(currentBase.value));
const bearingPresetOptions = BUILDING_BEARING_PRESETS;

const ACTIVE_OR_QUEUED_RESEARCH_STATUSES = new Set(['active', 'queued', 'paused', 'settling', 'held']);

function formatUnmetPrereqNames(unmet: readonly UnmetPrerequisite[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (n: string) => {
    const t = n.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    names.push(t);
  };
  for (const item of unmet) {
    const msg = item.message.trim();
    if (msg.startsWith('[协议] 缺少协议：')) {
      const raw = msg.slice('[协议] 缺少协议：'.length).trim();
      const m = /^(.+?)（([^（）]+)）$/.exec(raw);
      add(m ? m[1] : raw);
    } else if (msg.startsWith('缺少研究：')) {
      add(msg.slice('缺少研究：'.length));
    } else {
      const bld = /^缺少(?:当前基地|全局)?建筑：(.+?)(?:（[^（）]*）)?$/.exec(msg);
      if (bld) add(bld[1]);
      const unit = /^缺少单位：(.+?)(?:（[^（）]*）)?$/.exec(msg);
      if (unit) add(unit[1]);
    }
  }
  return names;
}

/** 研发前置科技/协议与队列守卫（FIX-P1-02 · 07 [P1-4] · UX-TECH-01） */
const researchGate = computed<{ allowed: boolean; canDispatch: boolean; reason: string }>(() => {
  if (!detail.data || detail.data.kind !== '科技') return { allowed: true, canDispatch: true, reason: '' };
  const title = detail.data.title;
  const stateData = store.data;
  if (!stateData) return { allowed: true, canDispatch: true, reason: '' };

  const completed = buildCompletedTechAndProtocolSet(stateData.tech?.done, stateData.protocols);
  if ((stateData.tech?.done ?? []).includes(title) || completed.has(title)) {
    return { allowed: false, canDispatch: false, reason: '该科技已研发完成' };
  }

  const bases = stateData.bases ?? [];
  const baseId = currentBase.value?.id || bases[0]?.id || '';
  const queued = baseId ? queueItemsForAction(stateData.queues ?? [], '研究', baseId, bases) : [];
  const inQueueByStatus = (stateData.queues ?? []).some(
    q =>
      (q.type === '研究' || !q.type) &&
      q.item === title &&
      ACTIVE_OR_QUEUED_RESEARCH_STATUSES.has(q.status ?? 'active'),
  );
  if (inQueueByStatus || (queued.includes(title) && !(stateData.queues ?? []).some(q => q.item === title && (q.status === 'done' || q.status === 'cancelled')))) {
    return { allowed: false, canDispatch: false, reason: '该科技已在研发或排队序列中' };
  }

  const catalogProtocols =
    (catalog as unknown as {
      effectiveCatalog?: { protocols?: PrerequisiteProtocolSource };
      protocols?: PrerequisiteProtocolSource;
    }).effectiveCatalog?.protocols ?? (catalog as unknown as { protocols?: PrerequisiteProtocolSource }).protocols;

  const baseCtx =
    bases.length > 0 && baseId
      ? buildCatalogPrerequisiteContext({
          bases,
          selectedBaseId: baseId,
          techDone: stateData.tech?.done ?? [],
          forces: stateData.forces ?? { troops: {}, vehicles: [] },
          protocols: stateData.protocols,
        })
      : null;

  const ctx: PrerequisiteContext = baseCtx
    ? { ...baseCtx, protocols: catalogProtocols }
    : {
        techDone: completed,
        activeProtocols: extractActiveProtocolSet(stateData.protocols),
        selectedBaseId: baseId,
        bases: new Map(),
        unitPresent: buildUnitPresent(stateData.forces ?? { troops: {}, vehicles: [] }),
        protocols: catalogProtocols,
      };

  const researchDef = catalog.researches.find(r => r.name === title);
  const paramPrereqs = (detail.data.params ?? [])
    .filter(([k]) => k === '前置' || k === '前置科技' || k === '前置协议')
    .flatMap(([, v]) =>
      v && v !== '——' && v !== '无'
        ? v
            .split(/[、,，/]/)
            .map(s => s.trim())
            .filter(Boolean)
        : [],
    );
  const targetDef = researchDef ?? (paramPrereqs.length > 0 ? { name: title, prereqs: paramPrereqs } : null);

  if (targetDef) {
    const evalResult = evaluatePrerequisite(combineLegacyPrerequisites(targetDef, 'completed'), ctx);
    if (!evalResult.satisfied || (researchDef && baseCtx && deriveResearchableWithContext([researchDef], ctx, []).length === 0)) {
      const missingNames = formatUnmetPrereqNames(evalResult.unmet);
      const suffix = missingNames.length > 0 ? missingNames.join('、') : '前置科技、战略协议或实验室设施未就绪';
      return { allowed: false, canDispatch: false, reason: `缺失前置：${suffix}` };
    }
  }
  return { allowed: true, canDispatch: true, reason: '' };
});

/** 生产项目数量上限守卫（HERO-UNIT-01：如英雄单位 max_count=1，到达上限后变灰不可再生产） */
const productionGate = computed<{
  allowed: boolean;
  canDispatch: boolean;
  isMaxedOut: boolean;
  maxCount: number | null;
  remainingQuota: number | null;
  reason: string;
}>(() => {
  if (!detail.data || !isProduceKind.value) {
    return { allowed: true, canDispatch: true, isMaxedOut: false, maxCount: null, remainingQuota: null, reason: '' };
  }
  const title = detail.data.title.trim();
  const prodDef = catalog.productions.find(
    p => p.name === title || (Array.isArray(p.aliases) && p.aliases.includes(title)),
  );
  let maxCount: number | null =
    typeof prodDef?.max_count === 'number' && prodDef.max_count > 0 ? prodDef.max_count : null;
  if (maxCount === null) {
    const paramEntry = (detail.data.params ?? []).find(([k]) => k === '数量上限' || k === '上限' || k === 'max_count');
    if (paramEntry) {
      const m = String(paramEntry[1]).match(/\d+/);
      if (m) {
        const parsed = Number(m[0]);
        if (Number.isInteger(parsed) && parsed > 0) maxCount = parsed;
      }
    }
  }
  if (maxCount === null) {
    return { allowed: true, canDispatch: true, isMaxedOut: false, maxCount: null, remainingQuota: null, reason: '' };
  }

  const stateData = store.data;
  if (!stateData) {
    return { allowed: true, canDispatch: true, isMaxedOut: false, maxCount, remainingQuota: maxCount, reason: '' };
  }

  const candidateNames = new Set<string>([title]);
  if (prodDef?.name) candidateNames.add(prodDef.name.trim());
  for (const alias of prodDef?.aliases ?? []) {
    if (typeof alias === 'string' && alias.trim()) candidateNames.add(alias.trim());
  }
  const baseParam = (detail.data.params ?? []).find(([k]) => k === '基础原型');
  if (baseParam?.[1]?.trim()) {
    candidateNames.add(baseParam[1].trim());
  }
  for (const group of UNIT_EQUIVALENT_GROUPS) {
    if (group.some(g => candidateNames.has(g))) {
      for (const g of group) candidateNames.add(g);
    }
  }

  let troopAndVehCount = 0;
  for (const [k, cnt] of Object.entries(stateData.forces?.troops ?? {})) {
    if (candidateNames.has(k.trim()) && typeof cnt === 'number' && cnt > 0) {
      troopAndVehCount += cnt;
    }
  }
  for (const v of stateData.forces?.vehicles ?? []) {
    const cleanV = String(v).replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
    if (candidateNames.has(String(v).trim()) || candidateNames.has(cleanV)) {
      troopAndVehCount += 1;
    }
  }
  for (const [k, cnt] of Object.entries(stateData.forces?.equipment ?? {})) {
    if (candidateNames.has(k.trim()) && typeof cnt === 'number' && cnt > 0) {
      troopAndVehCount += cnt;
    }
  }

  let girlCount = 0;
  const rawRootGirls = (stateData as unknown as { girls?: Array<{ name?: string; model?: string; alias?: string }> }).girls ?? [];
  const allGirls = [...rawRootGirls, ...(stateData.forces?.girls ?? [])];
  const seenGirlNames = new Set<string>();
  for (const g of allGirls) {
    const gName = typeof g?.name === 'string' ? g.name.trim() : '';
    if (!gName || seenGirlNames.has(gName)) continue;
    seenGirlNames.add(gName);
    const gModel = typeof g?.model === 'string' ? g.model.trim() : '';
    const gAlias = typeof g?.alias === 'string' ? g.alias.trim() : '';
    if (candidateNames.has(gName) || (gModel && candidateNames.has(gModel)) || (gAlias && candidateNames.has(gAlias))) {
      girlCount += 1;
    }
  }

  const ownedCount = Math.max(troopAndVehCount, girlCount);

  let queuedCount = 0;
  for (const q of stateData.queues ?? []) {
    if (q.type !== '生产' && q.type !== undefined) continue;
    if (!ACTIVE_OR_QUEUED_RESEARCH_STATUSES.has(q.status ?? 'active')) continue;
    if (candidateNames.has(q.item.trim())) {
      queuedCount += Math.max(1, (q.qty ?? 1) - (q.qty_done ?? 0));
    }
  }

  if (ownedCount >= maxCount) {
    return {
      allowed: false,
      canDispatch: false,
      isMaxedOut: true,
      maxCount,
      remainingQuota: 0,
      reason: `已达数量上限（${ownedCount}/${maxCount}），不可再生产`,
    };
  }

  if (ownedCount + queuedCount >= maxCount) {
    return {
      allowed: false,
      canDispatch: false,
      isMaxedOut: true,
      maxCount,
      remainingQuota: 0,
      reason: `在产序列已占满数量上限（${ownedCount + queuedCount}/${maxCount}），不可再生产`,
    };
  }

  const remainingQuota = maxCount - ownedCount - queuedCount;
  const requestedQty = Math.max(1, Math.floor(Number(produceQty.value) || 1));
  if (requestedQty > remainingQuota) {
    return {
      allowed: false,
      canDispatch: false,
      isMaxedOut: false,
      maxCount,
      remainingQuota,
      reason: `超出数量上限（剩余可产 ${remainingQuota}/${maxCount}）`,
    };
  }

  return {
    allowed: true,
    canDispatch: true,
    isMaxedOut: false,
    maxCount,
    remainingQuota,
    reason: '',
  };
});

const canDispatch = computed(() => researchGate.value.canDispatch && productionGate.value.canDispatch);
const dispatchHint = computed(() => researchGate.value.reason || productionGate.value.reason);

/** FD-22：当前建筑详情的原位升级/母体扩建信息推导 */
const buildingUpgradeInfo = computed(() => {
  if (!detail.data || detail.data.kind !== '建筑') return null;
  const rawTitle = detail.data.title.trim();
  const cleanTitle = rawTitle.replace(/（[^（）]+）$/, '').trim();
  const catBld =
    catalog.buildings.find(b => b.name === rawTitle || b.name === cleanTitle) ??
    catalog.buildings.find(b => b.upgraded_name === rawTitle || b.upgraded_name === cleanTitle);
  const spec =
    BUILTIN_BUILDING_UPGRADE_SPECS[rawTitle] ??
    BUILTIN_BUILDING_UPGRADE_SPECS[cleanTitle] ??
    (catBld ? BUILTIN_BUILDING_UPGRADE_SPECS[catBld.name] : undefined);
  const mode = catBld?.upgrade_mode ?? spec?.upgrade_mode;
  const rawHosts = catBld?.host_building ?? spec?.host_building;
  const hosts = typeof rawHosts === 'string' ? [rawHosts] : Array.isArray(rawHosts) ? rawHosts : [];
  if (!mode || hosts.length === 0) return null;

  const standalone = catBld?.standalone ?? (spec?.upgraded_name ? false : mode === 'replace');
  const upgradedName = catBld?.upgraded_name || spec?.upgraded_name || catBld?.name || cleanTitle;
  const cost =
    catBld?.cost ??
    (() => {
      const costParam = (detail.data?.params ?? []).find(([k]) => k === '造价');
      const m = costParam?.[1]?.match(/\d+/);
      return m ? Number(m[0]) : 1500;
    })();
  const hostCatDef = catalog.buildings.find(cb => hosts.includes(cb.name));
  const hostCost = hostCatDef?.cost ?? 0;
  const deltaCost = mode === 'replace' && standalone ? Math.max(0, cost - hostCost) : cost;

  const baseBldNames = (currentBase.value?.buildings ?? [])
    .filter(b => b.state !== '被毁')
    .map(b => b.name.trim());
  const matchedHostInBase =
    baseBldNames.find(bn =>
      hosts.some(
        h =>
          h === bn ||
          h.replace(/^(?:盟军|苏联|苏军|尤里)/, '') === bn.replace(/^(?:盟军|苏联|苏军|尤里)/, ''),
      ),
    ) ?? null;

  return {
    mode,
    standalone,
    upgradedName,
    hostLabel: hosts.join(' / '),
    cost,
    deltaCost,
    hasHostInCurrentBase: Boolean(matchedHostInBase),
    matchedHostInBase,
  };
});

watch(
  () => [detail.open, detail.data?.title, buildingUpgradeInfo.value?.mode, buildingUpgradeInfo.value?.standalone] as const,
  () => {
    const upg = buildingUpgradeInfo.value;
    if (upg?.mode === 'addon') {
      selectedStrategy.value = 'addon';
    } else if (upg?.mode === 'replace' && !upg.standalone) {
      selectedStrategy.value = 'upgrade';
    } else {
      selectedStrategy.value = 'new';
    }
  },
  { immediate: true },
);

function handleInstanceRepair(inst: DrawerBuildingInstanceItem) {
  const targetBase = (selectedBaseName.value || currentBase.value?.name || '').trim();
  const orderText = buildDrawerInstanceQuickOrder(inst, targetBase, 'repair');
  const channel = fillHostSendInput(orderText);
  if (channel === 'failed') {
    toastr.warning('宿主输入栏与 /setinput 均不可达，指令未载入', '战术指令');
    return;
  }
  toastr.success(`抢修指令已载入输入栏：【${inst.name} #${inst.ordinal}】`, '紧急抢修待命');
  closeDetail();
}

function handleInstanceModeSwitch(inst: DrawerBuildingInstanceItem) {
  const targetBase = (selectedBaseName.value || currentBase.value?.name || '').trim();
  const action = inst.mode === '加速' ? 'switch_prod' : 'switch_accel';
  const orderText = buildDrawerInstanceQuickOrder(inst, targetBase, action);
  const channel = fillHostSendInput(orderText);
  if (channel === 'failed') {
    toastr.warning('宿主输入栏与 /setinput 均不可达，指令未载入', '战术指令');
    return;
  }
  toastr.success(`产线模式切换指令已载入输入栏：【${inst.name} #${inst.ordinal}】`, '产线切换待命');
  closeDetail();
}

/** 战术按钮文案 */
const dispatchBtnText = computed(() => {
  if (!detail.data) return '【下达部署指令】';
  const k = detail.data.kind;
  if (['人员', '载具', '生产', '飞机'].includes(k)) {
    if (productionGate.value.isMaxedOut) return '【不可再生产】';
    return '【列装生产】';
  }
  if (k === '科技') return '【下达研发指令】';
  return '【下达部署指令】';
});

/** 触发战术部署指令下达工作流（填入酒馆输入框并聚焦） */
function handleDispatch() {
  if (!detail.data) return;
  if (!canDispatch.value) {
    toastr.warning(dispatchHint.value || '前置条件未满足，无法下达指令', '战术指令受阻');
    return;
  }
  const unitName = detail.data.title;
  const k = detail.data.kind;

  let verb = '批准建造';
  if (['人员', '载具', '生产', '飞机'].includes(k)) {
    verb = '批准列装';
  } else if (k === '科技') {
    verb = '批准研发';
  }

  let orderText = `【指挥官战术指令】${verb}：${unitName}`;
  if (['人员', '载具', '生产', '飞机'].includes(k)) {
    const qty = Math.max(1, Math.floor(Number(produceQty.value) || 1));
    const targetBase = (selectedBaseName.value || currentBase.value?.name || '').trim();
    orderText = targetBase
      ? `【指挥官战术指令】${verb}：${unitName} 数量: ${qty} 基地: ${targetBase}`
      : `【指挥官战术指令】${verb}：${unitName} 数量: ${qty}`;
  } else if (isBuildingKind.value) {
    const targetBase = (selectedBaseName.value || currentBase.value?.name || '').trim();
    const shouldIncludeBase =
      availableBases.value.length > 1 ||
      selectedLayer.value !== 'auto' ||
      selectedBearing.value !== 'auto' ||
      Boolean(customBearingInput.value.trim()) ||
      currentBaseInstances.value.length > 0 ||
      selectedStrategy.value !== 'new';
    orderText = buildSpatialBuildingDispatchOrder({
      buildingTitle: unitName,
      baseName: shouldIncludeBase ? targetBase : undefined,
      strategy: selectedStrategy.value,
      layer: selectedLayer.value,
      bearing: selectedBearing.value,
      customBearing: customBearingInput.value,
      existingInstanceCount: currentBaseInstances.value.length,
      upgradeInfo: buildingUpgradeInfo.value,
    });
  }

  // 唯一写路径（hostSendInput）：宿主 #send_textarea 优先，TavernHelper /setinput 兜底
  const channel = fillHostSendInput(orderText);
  if (channel === 'failed') {
    toastr.warning('宿主输入栏与 /setinput 均不可达，指令未载入', '战术指令');
    return;
  }

  toastr.success(`战术指令已载入输入栏：【${unitName}】`, '战术指令待命中');
  closeDetail();
}
</script>

<style scoped>
/* 二级详情弹窗：战术层级 10020，永远覆盖于主模态卡片（10010）之上，遮罩相互解耦 */
.detail-mask {
  z-index: 10020 !important;
}

.ra-dispatch-btn {
  background: linear-gradient(180deg, #0284c7 0%, #0369a1 100%);
  border: 1px solid #38bdf8;
  color: #ffffff;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
  cursor: pointer;
}

.ra-dispatch-btn:hover {
  background: linear-gradient(180deg, #0369a1 0%, #075985 100%);
  border-color: #7dd3fc;
  box-shadow: 0 0 14px rgba(56, 189, 248, 0.65);
  transform: translateY(-1px);
}

.ra-dispatch-btn:active {
  transform: translateY(0);
}

/* ══ 工程指令四令按钮组（ENG-UI-03） ══ */
.eng-cmd-footer {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

.eng-cmd-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.eng-cmd-btn {
  padding: 4px 10px;
  border: 1px solid #38bdf8;
  border-radius: 3px;
  background: linear-gradient(180deg, #0284c7 0%, #0369a1 100%);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.eng-cmd-btn:hover:not(:disabled) {
  background: linear-gradient(180deg, #0369a1 0%, #075985 100%);
  border-color: #7dd3fc;
}

.eng-cmd-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.eng-cmd-btn--danger {
  border-color: #d16f6f;
  background: linear-gradient(180deg, #a03d3d 0%, #7f2f2f 100%);
}

.eng-cmd-btn--danger:hover:not(:disabled) {
  background: linear-gradient(180deg, #7f2f2f 0%, #662626 100%);
  border-color: #e08d8d;
}

/* 取消令二次确认弹层：压于二级详情抽屉（10020）之上 */
.eng-cancel-mask {
  position: fixed;
  inset: 0;
  z-index: 10021;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(4, 8, 12, 0.6);
}

.eng-cancel-card {
  max-width: 380px;
  padding: 14px 16px;
  border: 1px solid #d16f6f;
  border-radius: 4px;
  background: #0b1018;
  box-shadow: 0 0 18px rgba(209, 111, 111, 0.35);
}

.eng-cancel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #e08d8d;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.eng-cancel-text {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.8;
  color: #cfdde0;
}

.eng-cancel-note {
  margin: 8px 0 0;
  font-size: 9.5px;
  line-height: 1.6;
  color: #8aa1a7;
}

.eng-cancel-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

@media (prefers-reduced-motion: reduce) {
  .eng-cmd-btn {
    transition: none;
  }
}
</style>
