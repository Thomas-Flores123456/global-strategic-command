<template>
  <!--
    参谋前馈设置面板 · Strategic Feedforward Settings（FD-31 · 五阶战役状态机与慢热前馈中心）
    - page="policy"：前馈策略与门禁（实时战役阶段识别、通联门禁状态、总开关、三档叙事节奏、四档系统通联门禁覆写）
    - page="preview"：实时报文预览（基于当前有效楼层或 #0 楼开局设定实时计算 deriveStrategicFeedforward + formatStrategicFeedforwardPrompt）
  -->
  <section class="ra-feedforward-settings flex flex-col gap-3 text-xs" data-test="panel-feedforward-settings">
    <!-- ══════════════════ 顶部共用状态卡：当前战役阶段与系统通联门禁 ══════════════════ -->
    <div
      class="flex flex-col gap-2 rounded-[3px] border border-rac-dim bg-rac-panel p-2.5"
      data-test="ff-status-card"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-1.5">
          <Icon name="status" :size="12" />
          <span class="font-mono text-[12px] font-bold tracking-wide text-rac-hi">
            参谋形势研判与阶段设置
          </span>
        </div>
        <span
          class="rounded-[2px] border px-1.5 py-0.5 font-mono text-[12px] font-bold"
          :class="
            prefs.enabled
              ? 'border-(--rac-ok)/55 bg-(--rac-ok)/14 text-(--rac-ok)'
              : 'border-(--rac-dim) bg-(--rac-bg) text-(--rac-muted) border-dashed'
          "
          data-test="ff-enabled-badge"
        >
          {{ prefs.enabled ? '● 已启用' : '○ 已停用' }}
        </span>
      </div>

      <div class="grid grid-cols-1 gap-2 border-t border-rac-dim/60 pt-2 sm:grid-cols-2">
        <div class="flex flex-col gap-0.5 rounded-[2px] border border-rac-dim/50 bg-rac-bg px-2.5 py-1.5">
          <span class="font-mono text-[12px] text-rac-muted">当前战役阶段</span>
          <span class="font-mono text-[12px] font-bold text-rac-focus" data-test="ff-phase-label">
            {{ phaseResolution.phaseLabel }}
          </span>
        </div>

        <div class="flex flex-col gap-0.5 rounded-[2px] border border-rac-dim/50 bg-rac-bg px-2.5 py-1.5">
          <span class="font-mono text-[12px] text-rac-muted">系统与机娘联络状态</span>
          <span
            class="font-mono text-[12px] font-bold"
            :class="linkGateColorClass"
            data-test="ff-link-gate-status"
          >
            {{ linkGateLabel }}
          </span>
        </div>
      </div>
    </div>

    <!-- ══════════════════ 子页 1：policy（前馈策略与门禁） ══════════════════ -->
    <template v-if="activePage === 'policy'">
      <!-- 总开关 -->
      <div class="rounded-[3px] border border-rac-dim bg-rac-panel p-2.5">
        <label class="flex cursor-pointer items-center justify-between gap-2">
          <div class="flex flex-col pr-2">
            <span class="text-[12px] font-bold text-rac-hi">
              启用每轮战况汇总与参谋提醒
            </span>
            <span class="text-[12px] text-rac-muted">
              在每轮 AI 回复前自动附带当前基地战况、建造进度与参谋建议（默认开启）
            </span>
          </div>
          <input
            :checked="prefs.enabled"
            type="checkbox"
            data-test="toggle-feedforward-enabled"
            class="size-4 flex-none cursor-pointer accent-rac-focus"
            @change="onToggleEnabled(($event.target as HTMLInputElement).checked)"
          />
        </label>
      </div>

      <!-- 前馈叙事节奏档位（3选1卡片） -->
      <div>
        <div class="mb-1.5 flex items-center justify-between">
          <span class="font-mono text-[11px] tracking-wider text-rac-muted uppercase">
            参谋提醒与叙事节奏
          </span>
          <span class="font-mono text-[12px] text-rac-muted opacity-80">
            调整参谋催促基建生产的频率与文末建议风格
          </span>
        </div>
        <div class="space-y-1.5">
          <button
            v-for="item in pacingOptions"
            :key="item.key"
            type="button"
            :data-test="`ff-pacing-${item.key}`"
            class="flex w-full cursor-pointer flex-col gap-1 rounded-[3px] border p-2.5 text-left transition-colors"
            :class="
              prefs.pacingMode === item.key
                ? 'border-rac-focus bg-rac-focus-soft text-rac-hi'
                : 'border-rac-dim bg-rac-panel text-rac-muted hover:border-rac-line hover:text-rac-hi'
            "
            :aria-pressed="prefs.pacingMode === item.key"
            @click="onSelectPacing(item.key)"
          >
            <div class="flex items-center justify-between">
              <span class="text-[12px] font-bold" :class="prefs.pacingMode === item.key ? 'text-rac-focus' : 'text-rac-hi'">
                {{ item.title }}
              </span>
              <span class="font-mono text-[11px] opacity-80">{{ item.badge }}</span>
            </div>
            <p class="text-[12px] leading-relaxed opacity-90">
              {{ item.desc }}
            </p>
          </button>
        </div>
      </div>

      <!-- 系统与机娘通联门禁覆写（4选1按钮组） -->
      <div>
        <div class="mb-1.5 flex items-center justify-between">
          <span class="font-mono text-[11px] tracking-wider text-rac-muted uppercase">
            系统与机娘出场时机
          </span>
          <span class="font-mono text-[12px] text-rac-muted opacity-80">
            防止未绑定或静默期机娘跨时空抢戏
          </span>
        </div>
        <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <button
            v-for="opt in linkOverrideOptions"
            :key="opt.key"
            type="button"
            :data-test="`ff-link-override-${opt.key}`"
            class="flex cursor-pointer flex-col gap-0.5 rounded-[3px] border p-2 text-left transition-colors"
            :class="
              prefs.systemLinkOverride === opt.key
                ? 'border-rac-focus bg-rac-focus-soft text-rac-hi'
                : 'border-rac-dim bg-rac-panel text-rac-muted hover:border-rac-line hover:text-rac-hi'
            "
            :aria-pressed="prefs.systemLinkOverride === opt.key"
            @click="onSelectLinkOverride(opt.key)"
          >
            <span class="text-[12px] font-bold" :class="prefs.systemLinkOverride === opt.key ? 'text-rac-focus' : 'text-rac-hi'">
              {{ opt.label }}
            </span>
            <span class="font-mono text-[11px] opacity-80">{{ opt.sub }}</span>
          </button>
        </div>
      </div>

      <!-- 机娘孵化与赐名模式覆写（4选1按钮组） -->
      <div>
        <div class="mb-1.5 flex items-center justify-between">
          <span class="font-mono text-[11px] tracking-wider text-rac-muted uppercase">
            新机娘登场与命名方式
          </span>
          <span class="font-mono text-[12px] text-rac-muted opacity-80">
            设置新机娘诞生时是由指挥官剧情赐名，还是直接使用预设名字
          </span>
        </div>
        <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <button
            v-for="incOpt in incubationOverrideOptions"
            :key="incOpt.key"
            type="button"
            :data-test="`ff-incubation-override-${incOpt.key}`"
            class="flex cursor-pointer flex-col gap-0.5 rounded-[3px] border p-2 text-left transition-colors"
            :class="
              (prefs.maidenIncubationOverride || 'auto') === incOpt.key
                ? 'border-rac-focus bg-rac-focus-soft text-rac-hi'
                : 'border-rac-dim bg-rac-panel text-rac-muted hover:border-rac-line hover:text-rac-hi'
            "
            :aria-pressed="(prefs.maidenIncubationOverride || 'auto') === incOpt.key"
            @click="onSelectIncubationOverride(incOpt.key)"
          >
            <span
              class="text-[12px] font-bold"
              :class="(prefs.maidenIncubationOverride || 'auto') === incOpt.key ? 'text-rac-focus' : 'text-rac-hi'"
            >
              {{ incOpt.label }}
            </span>
            <span class="font-mono text-[11px] opacity-80">{{ incOpt.sub }}</span>
          </button>
        </div>
      </div>
    </template>

    <!-- ══════════════════ 子页 2：preview（实时报文预览） ══════════════════ -->
    <template v-else>
      <div class="flex flex-col gap-2 rounded-[3px] border border-rac-dim bg-rac-panel p-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2 font-mono text-[12px]" data-test="ff-preview-stats">
            <span class="text-rac-muted">
              数据源:
              <strong class="text-rac-hi" data-test="ff-preview-source">
                {{ floating.snapshot ? `第 #${floating.floorId ?? 1} 楼实况快照` : '#0 楼开局初始状态' }}
              </strong>
            </span>
            <span class="text-rac-muted" data-test="ff-preview-milestones">
              里程碑回执：待收讫 {{ previewFeedforward.completionMilestones?.settlingItems?.length ?? 0 }} / 新竣工 {{ previewFeedforward.completionMilestones?.completedItems?.length ?? 0 }}
            </span>
            <span class="text-rac-muted" data-test="ff-preview-quests">
              作战任务：在途 {{ effectiveStatData.quests?.active?.length ?? 0 }} / 候选提案 {{ (previewFeedforward as { questRecommendations?: unknown[] })?.questRecommendations?.length ?? 0 }}
            </span>
            <span class="text-rac-muted">
              字符数: <strong class="ob-num text-rac-focus" data-test="ff-preview-chars">{{ previewCharCount }}</strong>
            </span>
            <span class="text-rac-muted">
              估算 Token: <strong class="ob-num text-(--rac-ok)" data-test="ff-preview-tokens">~{{ previewTokenEstimate }}</strong>
            </span>
          </div>

          <div class="flex items-center gap-1.5">
            <div class="ob-seg" role="group" aria-label="预览视图" data-test="ff-preview-view-toggle">
              <button
                type="button"
                class="cursor-pointer rounded-l-[2px] border border-rac-dim px-2 py-1 font-mono text-[12px] transition-colors"
                :class="previewView === 'structured' ? 'bg-rac-dim text-rac-hi' : 'bg-rac-bg text-rac-muted hover:text-rac-hi'"
                :aria-pressed="previewView === 'structured'"
                @click="previewView = 'structured'"
              >
                分区
              </button>
              <button
                type="button"
                class="-ml-px cursor-pointer rounded-r-[2px] border border-rac-dim px-2 py-1 font-mono text-[12px] transition-colors"
                :class="previewView === 'raw' ? 'bg-rac-dim text-rac-hi' : 'bg-rac-bg text-rac-muted hover:text-rac-hi'"
                :aria-pressed="previewView === 'raw'"
                @click="previewView = 'raw'"
              >
                原文
              </button>
            </div>
            <button
              type="button"
              data-test="ff-btn-refresh-preview"
              class="cursor-pointer rounded-[2px] border border-rac-dim bg-rac-bg px-2 py-1 font-mono text-[12px] text-rac-muted transition-colors hover:border-rac-line hover:text-rac-hi"
              @click="refreshHostContext"
            >
              刷新状态
            </button>
            <button
              type="button"
              data-test="ff-btn-copy-preview"
              class="inline-flex cursor-pointer items-center gap-1 rounded-[2px] border border-rac-dim bg-rac-bg px-2 py-1 font-mono text-[12px] text-rac-hi transition-colors hover:border-rac-focus hover:text-rac-focus"
              @click="onCopyPreview"
            >
              <Icon v-if="copied" name="check" :size="12" />
              <span>{{ copied ? '已复制' : '复制报文' }}</span>
            </button>
          </div>
        </div>

        <pre
          v-if="previewView === 'raw'"
          data-test="ff-preview-content"
          class="max-h-[48vh] overflow-auto rounded-[2px] border border-rac-dim/70 bg-rac-bg p-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-rac-hi select-text"
        >{{ previewPromptText }}</pre>

        <div
          v-else
          data-test="ff-preview-structured"
          class="ff-doc max-h-[48vh] overflow-auto rounded-[2px] border border-rac-dim/70 bg-rac-bg select-text"
        >
          <template v-if="previewDoc.sections.length === 0">
            <p class="p-2.5 font-mono text-[12px] text-rac-muted">{{ previewPromptText }}</p>
          </template>
          <template v-else>
            <header class="ff-doc__head">
              <div class="ff-doc__title">{{ previewDoc.title }}</div>
              <p v-for="(m, i) in previewDoc.meta" :key="i" class="ff-doc__meta">
                <template v-for="(seg, j) in splitPipeSegments(m)" :key="j">
                  <span v-if="j > 0" class="ff-doc__pipe">｜</span>{{ seg }}
                </template>
              </p>
            </header>

            <details
              v-for="(sec, si) in previewDoc.sections"
              :key="si"
              class="ff-sec"
              :open="si < 3"
            >
              <summary class="ff-sec__summary">
                <span class="ff-sec__idx">{{ sec.index || '·' }}</span>
                <span class="ff-sec__title">{{ sec.title }}</span>
                <span class="ff-sec__count ob-num">{{ sec.lines.length + (sec.lead ? 1 : 0) }}</span>
              </summary>
              <div class="ff-sec__body">
                <p v-if="sec.lead" class="ff-line ff-line--lead">
                  <template v-for="(seg, j) in splitPipeSegments(sec.lead)" :key="j">
                    <span v-if="j > 0" class="ff-doc__pipe">｜</span>{{ seg }}
                  </template>
                </p>
                <template v-for="(ln, li) in sec.lines" :key="li">
                  <div v-if="ln.kind === 'diag'" class="ff-diag" :data-priority="ln.priority">
                    <span class="ff-diag__tag ob-tag"><b>{{ ln.priority }}</b><i>{{ ln.label }}</i></span>
                    <div class="ff-diag__body">
                      <div class="ff-diag__headline">{{ ln.text }}</div>
                      <div v-if="ln.detail" class="ff-diag__detail">{{ ln.detail }}</div>
                    </div>
                  </div>
                  <p v-else class="ff-line" :class="`ff-line--${ln.kind}`">
                    <template v-for="(seg, j) in splitPipeSegments(ln.text)" :key="j">
                      <span v-if="j > 0" class="ff-doc__pipe">｜</span>{{ seg }}
                    </template>
                  </p>
                </template>
              </div>
            </details>
          </template>
        </div>
      </div>
    </template>
  </section>
</template>

<script lang="ts">
import { ref } from 'vue';
import {
  getFeedforwardPreferences,
  type FeedforwardPreferences,
} from '../../红警指挥系统/planning/strategicFeedforward';

/** 模块级共享响应式偏好：保证 ModalSettings 内 policy 与 preview 双子页实例实时同步 */
const sharedPrefs = ref<FeedforwardPreferences>(getFeedforwardPreferences());
</script>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { parseFeedforwardPreview, splitPipeSegments } from './feedforwardPreviewModel';
import { SCHEMA_VERSION, Schema, type StatData } from '../../红警指挥系统/core/schema';
import { readDlcOverlaysFromRegistry, type DlcOverlay } from '../../红警指挥系统/core/catalogEffective';
import { dynamicCatalogSnapshot } from '../../红警指挥系统/composables/useCatalog';
import { tavernFloorReader, useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { scanLatestValidFloor } from '../../红警指挥系统/parse/floorScanner';
import {
  deriveStrategicFeedforward,
  formatStrategicFeedforwardPrompt,
  readBootChoicesHintFromVars,
  resolveCampaignPhase,
  setFeedforwardPreferences,
  type BootChoicesHint,
  type FeedforwardMaidenIncubationOverride,
  type FeedforwardPacingMode,
  type FeedforwardSystemLinkOverride,
  type StrategicFeedforward,
  type StrategicFeedforwardOptions,
} from '../../红警指挥系统/planning/strategicFeedforward';

const props = defineProps<{
  page?: 'policy' | 'preview';
}>();

const activePage = computed<'policy' | 'preview'>(() =>
  props.page === 'preview' ? 'preview' : 'policy',
);

const floating = useFloatingStore();
const prefs = sharedPrefs;
const hostTick = ref(0);
const copied = ref(false);

function refreshHostContext() {
  prefs.value = getFeedforwardPreferences();
  hostTick.value += 1;
}

onMounted(() => {
  refreshHostContext();
});

function readHostChatVars(): Record<string, unknown> | undefined {
  // 依赖 hostTick 以便手动刷新时重读宿主变量
  void hostTick.value;
  try {
    const gv = (globalThis as { getVariables?: (opt: { type: 'chat' }) => Record<string, unknown> })
      .getVariables;
    if (typeof gv === 'function') {
      return gv({ type: 'chat' });
    }
  } catch {
    /* 非酒馆环境或沙箱异常时安全降级 */
  }
  return undefined;
}

const bootChoices = computed<BootChoicesHint | null>(() => {
  const vars = readHostChatVars();
  if (!vars || typeof vars !== 'object') return null;
  const direct = readBootChoicesHintFromVars(vars);
  if (direct && Object.keys(direct).length > 0) return direct;
  const rawBoot = vars['$boot'];
  if (rawBoot && typeof rawBoot === 'object' && !Array.isArray(rawBoot)) {
    const innerChoices = (rawBoot as Record<string, unknown>)['choices'];
    if (typeof innerChoices === 'string' && innerChoices.trim()) {
      const fromJson = readBootChoicesHintFromVars({ $boot: innerChoices });
      if (fromJson && Object.keys(fromJson).length > 0) return fromJson;
      return { entryMode: innerChoices.trim() };
    }
    if (innerChoices && typeof innerChoices === 'object' && !Array.isArray(innerChoices)) {
      const nested = readBootChoicesHintFromVars({
        ...vars,
        $boot: {
          ...(rawBoot as Record<string, unknown>),
          ...(innerChoices as Record<string, unknown>),
        },
      });
      if (nested && Object.keys(nested).length > 0) return nested;
    }
  }
  return direct;
});

const effectiveStatData = computed<StatData>(() => {
  if (floating.snapshot) return floating.snapshot;
  return Schema.parse({});
});

const phaseResolution = computed(() =>
  resolveCampaignPhase(effectiveStatData.value, bootChoices.value, prefs.value),
);

const linkGateLabel = computed<string>(() => {
  const mode = phaseResolution.value.effectiveSystemLinkMode;
  if (mode === 'post_transmigration_bind' || !phaseResolution.value.systemBound) {
    return '未绑定·禁绝系统与机娘';
  }
  if (mode === 'commander_initiate' || !phaseResolution.value.maidensCanProactivelySpeak) {
    return '被动静默·待指挥官亲自呼叫';
  }
  return '已并网·允许参谋主动献策';
});

const linkGateColorClass = computed<string>(() => {
  const mode = phaseResolution.value.effectiveSystemLinkMode;
  if (mode === 'post_transmigration_bind' || !phaseResolution.value.systemBound) {
    return 'text-(--rac-warn)';
  }
  if (mode === 'commander_initiate' || !phaseResolution.value.maidensCanProactivelySpeak) {
    return 'text-(--rac-text)';
  }
  return 'text-(--rac-ok)';
});

const pacingOptions: ReadonlyArray<{
  key: FeedforwardPacingMode;
  title: string;
  badge: string;
  desc: string;
}> = [
  {
    key: 'slow_sim',
    title: '慢热种田推进（默认推荐）',
    badge: 'SLOW SIM · RECOMMENDED',
    desc: '抑制流水线监工式催促，优先掩体踏勘、15日多阵营磨合、电力与现金流安全垫，将节奏主权交还指挥官',
  },
  {
    key: 'balanced',
    title: '均衡战术参谋',
    badge: 'BALANCED · STANDARD',
    desc: '均衡提醒产线闲置、科研缺口与兵力配置',
  },
  {
    key: 'story_first',
    title: '剧情沉浸免打扰',
    badge: 'STORY FIRST · IMMERSIVE',
    desc: '不催促闲置产线，仅在停电、资金见底或遇袭时发出预警',
  },
];

const linkOverrideOptions: ReadonlyArray<{
  key: FeedforwardSystemLinkOverride;
  label: string;
  sub: string;
}> = [
  {
    key: 'auto',
    label: '跟随开局设定（自动）',
    sub: '根据开局选项与基地建造进度自动判断',
  },
  {
    key: 'post_transmigration_bind',
    label: '强制：未穿越/未绑定（零系统与机娘）',
    sub: '序章未解锁系统时，禁止系统播报与机娘提前登场',
  },
  {
    key: 'commander_initiate',
    label: '强制：由指挥官亲自联系（机娘静默待机）',
    sub: '已绑定系统但尚未展开基地车，仅后台记录不主动献策',
  },
  {
    key: 'immediate_active',
    label: '强制：已并网主动通联（允许机娘献策）',
    sub: '基地与系统、机娘全面联通，开放完整参谋建议',
  },
];

const incubationOverrideOptions: ReadonlyArray<{
  key: FeedforwardMaidenIncubationOverride;
  label: string;
  sub: string;
}> = [
  {
    key: 'auto',
    label: '跟随开局设定（自动）',
    sub: '首台新机娘由指挥官剧情赐名，后续按战况自然登场',
  },
  {
    key: 'iconic_plus_blindbox',
    label: '方案 B：经典 MCV ＋ 战地盲盒赐名',
    sub: '三大 MCV 固定真名，常规首台新机娘等待指挥官亲口赐名',
  },
  {
    key: 'full_blindbox',
    label: '全员自由盲盒（含 MCV）',
    sub: '所有新机娘登场时均先保持无名状态，等待指挥官亲口赐名',
  },
  {
    key: 'preset_roster',
    label: '省心预设名册（自动定名）',
    sub: '直接使用世界书内预设好的机娘名字入列',
  },
];

function onToggleEnabled(enabled: boolean) {
  prefs.value = setFeedforwardPreferences({ enabled });
}

function onSelectPacing(pacingMode: FeedforwardPacingMode) {
  prefs.value = setFeedforwardPreferences({ pacingMode });
}

function onSelectLinkOverride(systemLinkOverride: FeedforwardSystemLinkOverride) {
  prefs.value = setFeedforwardPreferences({ systemLinkOverride });
}

function onSelectIncubationOverride(maidenIncubationOverride: FeedforwardMaidenIncubationOverride) {
  prefs.value = setFeedforwardPreferences({ maidenIncubationOverride });
}

interface PreviewMilestoneSummaryLike {
  settlingItems?: readonly unknown[];
  completedItems?: readonly unknown[];
}

type PreviewFeedforwardView = Partial<StrategicFeedforward> & {
  completionMilestones?: PreviewMilestoneSummaryLike;
  questRecommendations?: readonly unknown[];
};

const previewFeedforward = computed<PreviewFeedforwardView>(() => {
  const vars = readHostChatVars();
  let overlays: DlcOverlay[] = [];
  try {
    overlays = readDlcOverlaysFromRegistry(vars?.$dlc);
  } catch {
    overlays = [];
  }
  let dynamicWb = null;
  try {
    dynamicWb = dynamicCatalogSnapshot();
  } catch {
    dynamicWb = null;
  }
  const currentFloorId = floating.floorId ?? 0;
  let prevData: StatData | null = null;
  if (floating.snapshot && currentFloorId > 0) {
    try {
      const prevSnap = scanLatestValidFloor(currentFloorId - 1, tavernFloorReader.readFloor);
      prevData = prevSnap?.data ?? null;
    } catch {
      prevData = null;
    }
  }
  const snapshot = {
    floorId: currentFloorId,
    schemaVersion: SCHEMA_VERSION,
    data: effectiveStatData.value,
  };
  const feed = deriveStrategicFeedforward(snapshot, overlays, dynamicWb, {
    bootChoices: bootChoices.value,
    preferences: prefs.value,
    prevData,
  } as StrategicFeedforwardOptions);
  return (feed ?? {}) as PreviewFeedforwardView;
});

const previewPromptText = computed<string>(() => {
  const feed = previewFeedforward.value;
  if (!feed || !('floorId' in feed)) return '// 暂无可生成的战略前馈视图';
  return formatStrategicFeedforwardPrompt(feed as StrategicFeedforward);
});

const previewCharCount = computed(() => previewPromptText.value.length);

/** 预览视图：分区折叠（默认）/ 原文 pre；两者共用同一份 previewPromptText，复制始终复制原文 */
const previewView = ref<'structured' | 'raw'>('structured');
const previewDoc = computed(() => parseFeedforwardPreview(previewPromptText.value));

/** 粗略估算中英混合 Token 数（中文字符约 0.65 token，ASCII 约 0.28 token） */
const previewTokenEstimate = computed(() => {
  const text = previewPromptText.value;
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 255) cjk++;
    else other++;
  }
  return Math.max(1, Math.round(cjk * 0.65 + other * 0.3));
});

async function onCopyPreview() {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(previewPromptText.value);
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 1800);
    }
  } catch {
    copied.value = false;
  }
}
</script>

<style scoped>
.text-rac-muted { color: var(--rac-muted); }
.text-rac-hi { color: var(--rac-hi); }
.text-rac-focus { color: var(--rac-focus); }
.bg-rac-bg { background: var(--rac-bg); }
.bg-rac-panel { background: var(--rac-panel); }
.bg-rac-dim { background: var(--rac-dim); }
.border-rac-dim { border-color: var(--rac-dim); }

/* ── 分区预览：报文按【分区】折叠，条目按层级缩进，诊断按优先级着色 ── */
.ff-doc {
  font-family: var(--rac-font-num), ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.55;
  color: var(--rac-text);
}
.ff-doc__head {
  padding: 8px 10px 6px;
  border-bottom: 1px solid var(--rac-dim);
  background: var(--rac-panel);
}
.ff-doc__title {
  color: var(--rac-hi);
  font-weight: 600;
  letter-spacing: 0.06em;
}
.ff-doc__meta {
  margin: 3px 0 0;
  color: var(--rac-muted);
}
.ff-doc__pipe {
  color: var(--rac-dim);
  margin: 0 2px;
}

.ff-sec {
  border-bottom: 1px solid var(--rac-dim);
}
.ff-sec:last-child {
  border-bottom: 0;
}
.ff-sec__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  list-style: none;
  user-select: none;
  background: var(--rac-panel-2);
  color: var(--rac-hi);
}
.ff-sec__summary::-webkit-details-marker {
  display: none;
}
.ff-sec__summary::before {
  content: '▸';
  color: var(--rac-muted);
  width: 10px;
  flex: none;
  transition: transform 120ms ease;
}
.ff-sec[open] > .ff-sec__summary::before {
  transform: rotate(90deg);
}
.ff-sec__idx {
  flex: none;
  min-width: 1.4em;
  text-align: center;
  padding: 0 4px;
  border: 1px solid var(--rac-dim);
  color: var(--rac-muted);
  font-size: 11px;
}
.ff-sec__title {
  flex: 1;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.ff-sec__count {
  color: var(--rac-muted);
  font-size: 11px;
}
.ff-sec__body {
  padding: 4px 10px 8px 28px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ff-line {
  margin: 0;
  position: relative;
  overflow-wrap: anywhere;
}
.ff-line--lead {
  color: var(--rac-hi);
}
.ff-line--item::before {
  content: '·';
  position: absolute;
  left: -12px;
  color: var(--rac-focus);
}
.ff-line--sub {
  margin-left: 14px;
  color: var(--rac-muted);
}
.ff-line--sub::before {
  content: '–';
  position: absolute;
  left: -12px;
  color: var(--rac-dim);
}
.ff-line--note {
  margin-top: 2px;
  padding: 4px 8px;
  border-left: 2px solid var(--rac-warn);
  background: var(--rac-surface-tint);
  color: var(--rac-muted);
}

.ff-diag {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 5px 0;
}
.ff-diag + .ff-diag {
  border-top: 1px dashed var(--rac-dim);
}
.ff-diag__tag {
  flex: none;
  margin-top: 1px;
}
.ff-diag[data-priority='P0'] .ff-diag__tag > b {
  background: var(--rac-alert);
  color: var(--rac-bg);
}
.ff-diag[data-priority='P1'] .ff-diag__tag > b {
  background: var(--rac-warn);
  color: var(--rac-bg);
}
.ff-diag__body {
  flex: 1;
  min-width: 0;
}
.ff-diag__headline {
  color: var(--rac-hi);
  overflow-wrap: anywhere;
}
.ff-diag__detail {
  margin-top: 2px;
  color: var(--rac-muted);
  overflow-wrap: anywhere;
}
.hover\:border-rac-line:hover { border-color: var(--rac-line); }
.hover\:text-rac-hi:hover { color: var(--rac-hi); }
.hover\:text-rac-focus:hover { color: var(--rac-focus); }
.accent-rac-focus { accent-color: var(--rac-focus); }
.border-rac-focus { border-color: var(--rac-focus); }
.bg-rac-focus-soft { background: color-mix(in srgb, var(--rac-focus) 22%, transparent); }
</style>
