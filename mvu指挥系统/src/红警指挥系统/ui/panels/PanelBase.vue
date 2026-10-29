<template>
  <div class="px-3 pt-3 pb-2">
    <!-- ══ 基地态势视窗：只承载位置、暴露与警报 ══ -->
    <section class="tactical-stage">
      <svg class="absolute inset-0 h-full w-full" viewBox="0 0 540 220" preserveAspectRatio="none" aria-hidden="true">
        <path class="topo-line" d="M-18 50C54 17 111 78 174 39S290 22 355 62s121 27 204-15" />
        <path class="topo-line" d="M-22 68C46 39 111 94 182 58s134-17 193 25 113 31 183-7" />
        <path class="topo-line" d="M-13 88c69-18 112 29 182-4s145-18 203 17 108 28 186-2" />
        <path class="topo-line" d="M-14 166c91-39 151-4 217-39s123-17 177 18 109 29 178-12" />
        <path class="topo-line" d="M6 188c73-29 130-2 197-30s123-10 178 16 102 21 158-7" />
        <path class="map-line" d="M46 158 124 124 194 142 265 94" />
        <path class="map-line" d="M124 124 148 76M194 142l13 45M265 94l41 24" stroke-dasharray="3 4" />
        <circle class="map-node" cx="124" cy="124" r="2.2" />
        <circle class="map-node" cx="194" cy="142" r="1.6" />
        <circle class="map-node" cx="265" cy="94" r="1.4" />
        <!-- 移除：背景装饰环在 preserveAspectRatio="none" 下会随容器撑满被横向拉成椭圆、
             位置漂移且与右侧暴露度正圆环视觉打架（560px 时不明显，撑满全宽后暴露）。 -->
      </svg>

      <!-- 基地身份 -->
      <div class="absolute top-0 right-0 left-0 z-10 flex items-start justify-between px-4 py-3.5">
        <div>
          <div class="flex items-center gap-2.5">
            <span class="status-dot" :style="{ color: statusColor(base.status) }" />
            <span style="color: var(--text); font-size: 14px; letter-spacing: 0.08em">{{ base.name }}</span>
            <span class="hud-tag" :class="statusTag(base.status)">{{ base.status }}</span>
          </div>
          <div class="mt-2 flex items-center gap-1.5" style="color: var(--text-3); font-size: 10px">
            <Icon name="location" :size="10" />
            {{ base.location || data.meta.location }}
          </div>
        </div>
        <div v-if="activeBases.length > 1" class="base-switch">
          <button class="base-switch__btn" aria-label="上一个基地" @click="prevBase">
            <Icon name="chevron-left" :size="12" />
          </button>
          <span class="base-switch__count mono">{{ activePosition + 1 }}<i>/</i>{{ activeBases.length }}</span>
          <button class="base-switch__btn" aria-label="下一个基地" @click="nextBase">
            <Icon name="chevron-right" :size="12" />
          </button>
        </div>
      </div>

      <!-- 暴露扫描环 -->
      <div class="absolute top-[42px] right-4 z-10 h-[104px] w-[104px]">
        <svg class="h-full w-full" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="scope-ring" cx="60" cy="60" r="43" stroke-width="1.1" />
          <circle class="scope-ring" cx="60" cy="60" r="51" stroke-width="0.45" stroke-dasharray="1 6" />
          <circle
            class="scope-progress"
            cx="60"
            cy="60"
            r="43"
            stroke-width="2"
            :stroke="exposureColor"
            :stroke-dasharray="exposureCircumference"
            :stroke-dashoffset="exposureOffset"
            transform="rotate(-90 60 60)"
          />
          <g v-for="n in 12" :key="n" :transform="`rotate(${n * 30} 60 60)`">
            <line class="scope-tick" x1="60" y1="4" x2="60" :y2="n % 3 === 0 ? 10 : 7" />
          </g>
          <path class="scope-cross" d="M60 13v9m0 76v9M13 60h9m76 0h9" />
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span style="font-size: 9px; color: var(--text-3); letter-spacing: 0.12em">暴露度</span>
          <span class="mono mt-1" :style="{ color: exposureColor, fontSize: '21px', lineHeight: 1 }">
            {{ data.exposure.value.toFixed(2) }}
          </span>
          <span class="mt-1.5" :style="{ color: exposureColor, fontSize: '10px', letterSpacing: '.14em' }">{{
            exposureLabel
          }}</span>
        </div>
      </div>

      <!-- 变化与警报：留在视窗下缘 -->
      <div class="absolute right-4 bottom-3.5 left-4 z-10">
        <div class="hairline mb-2.5" />
        <div class="flex items-center justify-between gap-4">
          <span class="min-w-0 truncate" style="font-size: 10px; color: var(--text-3)">
            {{ data.exposure.last_change }}
          </span>
          <span class="mono flex-none" style="font-size: 9px; color: var(--text-4)">{{ data.exposure.trend }}</span>
        </div>
        <div v-if="base.alerts.length" class="mt-2 flex items-center gap-2" style="color: var(--danger)">
          <Icon name="alert" :size="10" />
          <span class="truncate" style="font-size: 10.5px">{{ base.alerts[0] }}</span>
        </div>
      </div>
    </section>

    <!-- ══ 资源横条：从态势图中移出 ══ -->
    <section class="mt-3 grid grid-cols-2 border-y" style="border-color: var(--line)">
      <button class="telemetry-cell py-3 pr-4 text-left" @click="show_wallet = !show_wallet">
        <div class="flex items-center justify-between">
          <span style="font-size: 10px; color: var(--text-3)">系统资金</span>
          <Icon :name="show_wallet ? 'chevron-up' : 'chevron-down'" :size="9" style="color: var(--text-4)" />
        </div>
        <div class="mt-1.5 flex items-baseline gap-2">
          <span class="mono" style="color: var(--text); font-size: 21px; line-height: 1">{{
            data.economy.credits.toLocaleString()
          }}</span>
          <span class="mono" style="color: var(--safe); font-size: 9px">+{{ data.economy.credits_daily }}/日</span>
        </div>
      </button>
      <div class="telemetry-cell py-3 pl-4">
        <div style="font-size: 10px; color: var(--text-3)">基地电力</div>
        <div class="mt-1.5 flex items-baseline gap-2">
          <span
            class="mono"
            :style="{ color: netPower >= 0 ? 'var(--safe)' : 'var(--danger)', fontSize: '21px', lineHeight: 1 }"
          >
            {{ netPower >= 0 ? '+' : '' }}{{ netPower }}
          </span>
          <span class="mono" style="font-size: 9px; color: var(--text-4)"
            >耗 {{ base.power.use }} / 发 {{ base.power.gen }}</span
          >
        </div>
        <div class="meter mt-2.5">
          <i :style="{ width: powerUsePct + '%', background: powerUsePct > 90 ? 'var(--danger)' : 'var(--safe)' }" />
        </div>
      </div>
    </section>

    <!-- 钱袋抽屉 -->
    <section v-if="show_wallet" class="mt-2 border-b px-2 pb-3" style="border-color: var(--line)">
      <div v-if="walletItems.length" class="grid grid-cols-[repeat(auto-fit,minmax(64px,1fr))] gap-2 pt-1">
        <div v-for="item in walletItems" :key="item.label" class="text-center">
          <div class="mono" style="color: var(--text); font-size: 13px">{{ item.value }}</div>
          <div class="mt-1" style="font-size: 9px; color: var(--text-3)">{{ item.label }}</div>
        </div>
      </div>
      <div v-else class="pt-2 text-center" style="font-size: 10px; color: var(--text-4)">当前世界暂无本地货币</div>
    </section>

    <!-- ══ 作业队列 ══ -->
    <section class="pt-5">
      <div class="flex items-center justify-between pb-2.5">
        <span class="section-label">作业队列</span>
        <span class="mono" style="font-size: 8.5px; color: var(--text-4)">{{ baseQueues.length }} 项</span>
      </div>
      <div v-if="baseQueues.length" class="rule-y">
        <button
          v-for="queue in visibleQueues"
          :key="queue.type + queue.item"
          class="queue-row pressable grid w-full grid-cols-[1fr_auto] items-center gap-5 border-b py-3 text-left"
          style="border-color: var(--line)"
          @click="openLookup(queue.item, data.codex)"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2.5">
              <Icon :name="queueIcon(queue.type)" :size="11" style="color: var(--text-3)" />
              <span class="truncate" style="color: var(--text); font-size: 12px">{{ queue.item }}</span>
            </div>
            <div class="meter mt-2">
              <i :style="{ width: queue.progress + '%' }" />
            </div>
          </div>
          <div class="mono min-w-[46px] text-right" style="font-size: 9.5px; color: var(--text-3)">
            <div style="color: var(--ice); font-size: 11px">{{ queue.progress }}%</div>
            <div class="mt-0.5">{{ queue.eta }}</div>
          </div>
        </button>
        <button
          v-if="baseQueues.length > QUEUE_PREVIEW"
          class="flex w-full items-center justify-center gap-1.5 py-2"
          style="font-size: 10px; color: var(--text-3)"
          @click="show_all_queues = !show_all_queues"
        >
          {{ show_all_queues ? '收起' : `展开全部 ${baseQueues.length} 项` }}
          <Icon :name="show_all_queues ? 'chevron-up' : 'chevron-down'" :size="8" />
        </button>
      </div>
      <div v-else class="rule-y py-4" style="color: var(--text-4); font-size: 11px">队列空闲</div>
    </section>

    <!-- ══ 建筑层级 ══ -->
    <section class="pt-2">
      <button class="flex w-full items-center justify-between py-3" @click="show_buildings = !show_buildings">
        <span class="section-label">建筑层级</span>
        <span class="mono flex items-center gap-2" style="font-size: 8.5px; color: var(--text-3)">
          {{ base.buildings.length }} 座
          <span v-if="abnormalCount" style="color: var(--amber)">{{ abnormalCount }} 异常</span>
          <Icon :name="show_buildings ? 'chevron-up' : 'chevron-down'" :size="9" />
        </span>
      </button>
      <div v-if="show_buildings" class="rule-y pb-1">
        <div
          v-for="(group, layer) in buildingsByLayer"
          :key="layer"
          class="grid grid-cols-[58px_1fr] gap-4 border-b py-3 last:border-b-0"
          style="border-color: var(--line)"
        >
          <span style="font-size: 9px; color: var(--text-4)">{{ layer }}</span>
          <div class="flex flex-wrap gap-x-4 gap-y-2">
            <button
              v-for="building in group"
              :key="building.name"
              class="pressable flex items-center gap-2"
              style="font-size: 10.5px; color: var(--text-2)"
              @click="openLookup(building.name, data.codex)"
            >
              <span class="status-dot" :style="{ color: stateColor(building.state), width: '4px', height: '4px' }" />
              {{ building.name }}
              <span v-if="building.state === '建造中'" class="mono" style="font-size: 8px; color: var(--amber)"
                >{{ building.progress }}%</span
              >
            </button>
          </div>
        </div>
      </div>
    </section>
    <!-- ══ 退役基地（CTRL-RETIRE-01：默认折叠，可展开查阅；数据保留可审计，不提供删除） ══ -->
    <section v-if="retiredBases.length" class="pt-2">
      <button class="flex w-full items-center justify-between py-3" @click="show_retired = !show_retired">
        <span class="section-label">退役记录</span>
        <span class="mono flex items-center gap-2" style="font-size: 8.5px; color: var(--text-4)">
          {{ retiredBases.length }} 座已废弃
          <Icon :name="show_retired ? 'chevron-up' : 'chevron-down'" :size="9" />
        </span>
      </button>
      <div v-if="show_retired" class="rule-y pb-1">
        <button
          v-for="entry in retiredBases"
          :key="entry.base.id"
          class="pressable flex w-full items-center justify-between border-b py-2.5 text-left last:border-b-0"
          style="border-color: var(--line)"
          @click="openLookup(entry.base.name, data.codex)"
        >
          <span class="truncate" style="font-size: 10.5px; color: var(--text-4)">
            <span class="mono mr-2" style="font-size: 9px">#{{ entry.index + 1 }}</span>
            {{ entry.base.name }}
          </span>
          <span class="hud-tag hud-tag--muted">废弃</span>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import Icon from '../Icon.vue';
import { isQueueVisibleForBase } from '../../core/catalogRuntimeContext';
import { useDataStore } from '../../composables/store';
import { ui } from '../ui';
import { openLookup } from '../../composables/useDetail';

const store = useDataStore();
const data = computed(() => store.data);

const base = computed(() => {
  const byIndex = data.value.bases[ui.base_index];
  // CTRL-RETIRE-01：退役基地默认不作清单主视图；指向退役/越界时回退首个在役基地
  if (byIndex && byIndex.status !== '废弃') return byIndex;
  return activeBases.value[0]?.base ?? byIndex ?? data.value.bases[0];
});
const show_wallet = ref(false);
const show_buildings = ref(false);
const show_all_queues = ref(false);
const show_retired = ref(false);
const QUEUE_PREVIEW = 2;

/** CTRL-RETIRE-01：在役/退役分清单（index 与 data.bases 全量对齐，供切选与查阅） */
const activeBases = computed(() =>
  data.value.bases.map((base, index) => ({ base, index })).filter(entry => entry.base.status !== '废弃'),
);
const retiredBases = computed(() =>
  data.value.bases.map((base, index) => ({ base, index })).filter(entry => entry.base.status === '废弃'),
);
const activePosition = computed(() => {
  const current = base.value;
  if (!current) return 0;
  const pos = activeBases.value.findIndex(entry => entry.base.id === current.id);
  return pos >= 0 ? pos : 0;
});
/** 研究全局显示；物理队列按 Base.id，唯一旧名称/单基地空 base 由共享兼容层处理。 */
const baseQueues = computed(() =>
  base.value ? data.value.queues.filter(queue => isQueueVisibleForBase(queue, base.value.id, data.value.bases)) : [],
);
const visibleQueues = computed(() =>
  show_all_queues.value ? baseQueues.value : baseQueues.value.slice(0, QUEUE_PREVIEW),
);

function prevBase() {
  const list = activeBases.value;
  if (list.length <= 1) return;
  const pos = list.findIndex(entry => entry.index === ui.base_index);
  ui.base_index = list[(pos <= 0 ? list.length : pos) - 1].index;
}
function nextBase() {
  const list = activeBases.value;
  if (list.length <= 1) return;
  const pos = list.findIndex(entry => entry.index === ui.base_index);
  ui.base_index = list[pos < 0 || pos >= list.length - 1 ? 0 : pos + 1].index;
}

const netPower = computed(() => base.value.power.gen - base.value.power.use);
const powerUsePct = computed(() =>
  base.value.power.gen ? Math.min(100, (base.value.power.use / base.value.power.gen) * 100) : 0,
);
const buildingsByLayer = computed(() => _.groupBy(base.value.buildings, building => building.layer || '未分层'));
const abnormalCount = computed(
  () => base.value.buildings.filter(building => building.state === '受损' || building.state === '停机').length,
);
const walletItems = computed(() =>
  Object.entries(data.value.economy.wallet).map(([label, value]) => ({ label, value: value.toLocaleString() })),
);

const exposureCircumference = 2 * Math.PI * 43;
const exposureOffset = computed(() => exposureCircumference * (1 - data.value.exposure.value / 10));
const exposureColor = computed(() => {
  const value = data.value.exposure.value;
  if (value < 4) return 'var(--safe)';
  if (value < 6) return 'var(--amber)';
  return 'var(--danger)';
});
const exposureLabel = computed(() => {
  const value = data.value.exposure.value;
  if (value < 2) return '隐蔽';
  if (value < 4) return '风闻';
  if (value < 6) return '警觉';
  if (value < 8) return '锁定';
  return '暴露';
});

function statusColor(status: string) {
  return (
    { 隐蔽中: 'var(--safe)', 警戒: 'var(--amber)', 暴露: 'var(--danger)', 失守: 'var(--danger)' }[status] ??
    'var(--text-3)'
  );
}
function statusTag(status: string) {
  return (
    { 隐蔽中: 'hud-tag--safe', 警戒: 'hud-tag--amber', 暴露: 'hud-tag--danger', 失守: 'hud-tag--danger' }[status] ??
    'hud-tag--muted'
  );
}
function stateColor(state: string) {
  return (
    { 运转: 'var(--safe)', 建造中: 'var(--amber)', 受损: 'var(--danger)', 停机: 'var(--text-4)' }[state] ??
    'var(--text-3)'
  );
}
function queueIcon(type: string): 'hammer' | 'flask' | 'gear' {
  return ({ 建造: 'hammer', 研究: 'flask', 生产: 'gear' } as const)[type as '建造' | '研究' | '生产'] ?? 'gear';
}
</script>
