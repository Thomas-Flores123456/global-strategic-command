<template>
  <!--
    时序冲突诊断横幅（CTRL-UI-CHRONO-01 · 含 A′ 宽容档增补）

    数据源：useParse.ts 的 parseState.chrono（模块级 reactive 单例）——本楼 <生产> 三色对账
    产出的 OVERRUN 裁决记录。本组件严禁触碰楼层解析触发器接线薄层（跨端唯一安装点红线，
    与 PanelParseRepair 同款约束）、不自建任何酒馆事件监听：这里只消费暂存 + 调用手动动作 API
    （autoAdvanceChrono / forceCommissionChrono / regenerateChronoFloor / dismissChrono）。
    中控悬浮窗只读红线：写 API（撤回楼层/触发生成）全部收口在 useParse.ts 宿主层，
    本组件源码 0 命中（FloatingApp.test.ts 静态守卫）。

    A′ 增补（2026-09-28 驾驶员定案）：0 < 时序差距 ≤ AUTO_ADVANCE_TOLERANCE_MINUTES（1 日带宽）
    时「自动顺延时间」默认高亮推荐——顺延＝补差额 Δt 走 settleFloor 正常结算 → 重对账自然 MATCH，
    引擎 v1 口径零妥协（宽容不静默）。
  -->
  <div
    v-if="chrono && conflicts.length"
    ref="bannerRef"
    class="chrono-banner ob-hatch mono"
    role="alert"
    aria-label="时序冲突战术警报"
  >
    <div class="chrono-banner__head">
      <span class="chrono-banner__title">▲ 时间线偏差 · 第 #{{ chrono.message_id }} 楼进度待确认</span>
      <span class="chrono-banner__count">{{ conflicts.length }} 项完工声明超时</span>
      <button
        class="chrono-btn chrono-btn--dismiss"
        :disabled="busy"
        aria-label="忽略本次时序冲突提示（不改账本）"
        title="暂时收起提示，不改动当前存档与正文"
        @click="onDismiss"
      >
        忽略
      </button>
    </div>

    <ul class="chrono-banner__list">
      <li v-for="(v, i) in conflicts" :key="`${v.item}-${i}`" class="chrono-banner__row">
        <span class="chrono-tag" :data-kind="v.overrunKind ?? 'unknown'">{{ kindLabel(v) }}</span>
        <span class="chrono-item"
          >「{{ v.item }}」<template v-if="v.base">@{{ v.base }}</template></span
        >
        <span class="chrono-diff">{{ diffText(v) }}</span>
      </li>
    </ul>

    <div class="chrono-banner__actions">
      <button
        class="chrono-btn"
        :disabled="busy || !regeneratable"
        :title="
          regeneratable
            ? '撤回冲突楼层并重新生成（该楼全部 swipe 将被移除，变量随楼回收）'
            : '仅冲突楼为最新楼且真机环境可用'
        "
        @click="onRegenerate"
      >
        重新生成
      </button>
      <button
        class="chrono-btn"
        :class="{ 'chrono-btn--recommend': recommended }"
        :disabled="busy || !inTavern || advanceDelta <= 0"
        :title="
          advanceDelta > 0
            ? `时钟顺延 ${fmtMin(advanceDelta)} 差额并重结算本楼（声明自然 MATCH；A′ 宽容档）`
            : '当前冲突不含时序差距，顺延无意义'
        "
        @click="onAdvance"
      >
        自动顺延时间{{ advanceDelta > 0 ? ` +${fmtMin(advanceDelta)}` : '' }}
      </button>
      <button
        class="chrono-btn chrono-btn--danger"
        :disabled="busy || !inTavern || !commissionable"
        :title="
          commissionable ? '驾驶员逃生舱：绕过物理完工校验直接入役（warn 审计事件 + R23 留痕）' : '没有可特批的在册目标'
        "
        @click="onCommission"
      >
        强制特批入役
      </button>
    </div>

    <div v-if="recommended" class="chrono-banner__hint">
      差距 ≤1 日带宽：建议一键顺延——时钟走差额，叙事与日历对齐（A′ 宽容档，引擎零妥协）
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, onMounted, ref, watch } from 'vue';
import toastr from 'toastr';
import { playTacticalAlertPulse, scheduleNextFrame } from '../../红警指挥系统/ui/motion/useGsapMotion';
import {
  AUTO_ADVANCE_TOLERANCE_MINUTES,
  autoAdvanceDeltaFor,
  type VerdictRecord,
} from '../../红警指挥系统/engines/productionReconciliation';
import { in_tavern } from '../../红警指挥系统/composables/store';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { tav } from '../../红警指挥系统/parse/systemCheck';
import {
  autoAdvanceChrono,
  dismissChrono,
  forceCommissionChrono,
  parseState,
  regenerateChronoFloor,
} from '../../红警指挥系统/composables/useParse';

const floating = useFloatingStore();
const chrono = computed(() => parseState.chrono);
const inTavern = in_tavern;
/** 本地忙态（重新生成不经 parseState.busy——删除+触发阶段由 GENERATION_ENDED 重解析接管） */
const localBusy = ref(false);
const busy = computed(() => parseState.busy || localBusy.value);

/** 暂存里只有 OVERRUN 裁决（接缝处已过滤），这里再防御一次 */
const conflicts = computed(() => (chrono.value?.verdicts ?? []).filter(v => v.verdict === 'OVERRUN'));

/** A′：顺延分钟数 = 时序冲突 max remainingMinutes（无则 0 → 顺延钮禁用） */
const advanceDelta = computed(() => autoAdvanceDeltaFor(conflicts.value));
/** A′ 宽容档推荐：0 < 差距 ≤ 1 日带宽时高亮顺延钮 */
const recommended = computed(() => advanceDelta.value > 0 && advanceDelta.value <= AUTO_ADVANCE_TOLERANCE_MINUTES);
/** 可特批目标：time_conflict / over_qty / not_started（no_txn/cancelled 无在册事务可批） */
const commissionable = computed(() =>
  conflicts.value.some(
    v => v.overrunKind === 'time_conflict' || v.overrunKind === 'over_qty' || v.overrunKind === 'not_started',
  ),
);
/** 重新生成仅当冲突楼就是最新楼（ST 重新生成语义作用于末楼）；getLastMessageId 走 tav 探针（只读 API，PanelParseRepair 先例） */
const regeneratable = computed(() => {
  if (!inTavern || !chrono.value) return false;
  const glmi = tav<() => number>('getLastMessageId');
  if (!glmi) return false;
  try {
    return chrono.value.message_id === glmi();
  } catch {
    return false;
  }
});

const KIND_LABELS: Record<string, string> = {
  over_qty: '超产',
  time_conflict: '时序冲突',
  not_started: '未开工',
  no_txn: '无在册',
  cancelled: '已作废',
};

function kindLabel(v: VerdictRecord): string {
  return KIND_LABELS[v.overrunKind ?? ''] ?? '拦截';
}

/** 分钟 → 紧凑中文时长（Xd Yh Zm） */
function fmtMin(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m <= 0) return '0分';
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  return `${d ? `${d}天` : ''}${h ? `${h}时` : ''}${mm ? `${mm}分` : ''}` || '0分';
}

/** 差异数据行（验收标准①：醒目呈现差异数据） */
function diffText(v: VerdictRecord): string {
  switch (v.overrunKind) {
    case 'time_conflict':
      return `声明 ${v.declaredQty} 台／物理已下线 ${v.physicalDoneQty ?? 0} 台，还差 ${fmtMin(v.remainingMinutes ?? 0)}`;
    case 'over_qty':
      return `声明 ${v.declaredQty} 台超出在册批次 ${v.physicalDoneQty ?? '?'} 台`;
    case 'not_started':
      return `尚未开工即声明 ${v.declaredQty} 台下线`;
    case 'no_txn':
      return `声明 ${v.declaredQty} 台但无在册事务`;
    case 'cancelled':
      return `声明 ${v.declaredQty} 台但目标已作废`;
    default:
      return v.detail;
  }
}

function onDismiss() {
  dismissChrono();
}

const bannerRef = ref<HTMLElement | null>(null);
if (getCurrentInstance()) {
  onMounted(() => {
    if (chrono.value && conflicts.value.length > 0) {
      playTacticalAlertPulse(bannerRef.value);
    }
  });
}
watch(
  () => chrono.value?.message_id,
  nextId => {
    if (nextId != null && conflicts.value.length > 0) {
      scheduleNextFrame(() => playTacticalAlertPulse(bannerRef.value));
    }
  },
);

/**
 * [重新生成]：confirm 二次门（撤回语义明示）→ useParse 宿主层撤回冲突楼并重触发
 * （写 API 全部收口宿主层，本组件 0 命中，FloatingApp.test.ts 静态守卫）
 */
async function onRegenerate() {
  const mid = chrono.value?.message_id;
  if (mid == null || !regeneratable.value) return;
  if (
    !window.confirm(`将撤回 #${mid} 楼并重新生成。\n注意：该楼全部 swipe 历史与楼内变量将随楼移除。\n确认撤回重生成？`)
  ) {
    return;
  }
  localBusy.value = true;
  try {
    const res = await regenerateChronoFloor();
    if (res.ok) {
      toastr.info('已撤回冲突楼层，重新生成中…', '时序纠偏');
    } else {
      toastr.warning(res.error ?? '重新生成失败', '时序纠偏');
    }
    await floating.refresh();
  } catch (e) {
    console.error('[ChronoMismatchBanner] 重新生成失败', e);
    toastr.error('撤回/重生成失败，楼层状态已保留', '时序纠偏');
  } finally {
    localBusy.value = false;
  }
}

/** [自动顺延时间]（A′）：补差额 Δt 强制重解析本楼 → settleFloor 正常结算 → 声明自然 MATCH */
async function onAdvance() {
  const res = await autoAdvanceChrono();
  if (res.ok) {
    toastr.success(`已顺延 ${fmtMin(res.delta ?? 0)} 并重结算本楼`, '时序纠偏');
  } else {
    toastr.warning(res.error ?? '顺延失败', '时序纠偏');
  }
  await floating.refresh();
}

/** [强制特批入役]（逃生舱）：confirm 二次门 → 逐目标直接入役（审计留痕） */
async function onCommission() {
  const names = conflicts.value
    .filter(v => v.overrunKind === 'time_conflict' || v.overrunKind === 'over_qty' || v.overrunKind === 'not_started')
    .map(v => `「${v.item}」`)
    .join('、');
  if (
    !window.confirm(
      `将把 ${names} 直接特批入役：\n绕过三色门物理完工校验（逃生舱），留 warn 审计事件 + R23 痕迹。\n确认特批？`,
    )
  ) {
    return;
  }
  const res = await forceCommissionChrono();
  if (res.ok) {
    toastr.success(`已特批入役：${res.commissioned.map(n => `「${n}」`).join('、')}`, '时序纠偏');
    for (const f of res.failures) toastr.warning(f, '时序纠偏 · 部分未批');
  } else {
    toastr.error(res.error ?? '特批失败，账本未动', '时序纠偏');
  }
  await floating.refresh();
}
</script>

<style scoped>
/* 战术警报横幅：醒目但不闪烁（告警斜纹底 --rac-hatch-alert，零循环动画） */
.chrono-banner {
  flex: none;
  padding: 5px 10px 6px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--rac-text);
  background-color: color-mix(in srgb, var(--rac-alert) 10%, transparent);
  background-image: var(--rac-hatch-alert);
  border-bottom: 1px solid var(--rac-alert);
  border-left: 3px solid var(--rac-alert);
}

.chrono-banner__head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.chrono-banner__title {
  color: var(--rac-alert);
  font-weight: 600;
  letter-spacing: 0.04em;
  min-width: 0;
}

.chrono-banner__count {
  flex-shrink: 0;
  white-space: nowrap;
  color: var(--rac-muted);
  font-size: 11px;
}

.chrono-banner__list {
  margin: 3px 0 0;
  padding: 0;
  list-style: none;
  max-height: 112px;
  overflow-y: auto;
}

.chrono-banner__row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 2px 6px;
  padding: 2px 0;
  min-width: 0;
}

.chrono-tag {
  flex: none;
  flex-shrink: 0;
  white-space: nowrap;
  padding: 0 4px;
  font-size: 11px;
  color: var(--rac-warn);
  border: 1px solid var(--rac-warn);
  border-radius: 2px;
}

.chrono-tag[data-kind='no_txn'],
.chrono-tag[data-kind='cancelled'] {
  color: var(--rac-muted);
  border-color: var(--rac-muted);
}

.chrono-item {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--rac-hi);
  overflow-wrap: anywhere;
}

.chrono-diff {
  flex: 1 1 180px;
  min-width: 0;
  color: var(--rac-muted);
  overflow-wrap: anywhere;
}

.chrono-banner__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
  flex-wrap: wrap;
}

.chrono-btn {
  flex-shrink: 0;
  white-space: nowrap;
  padding: 2px 10px;
  min-height: 24px;
  font-size: 12px;
  color: var(--rac-text);
  background: var(--rac-panel);
  border: 1px solid var(--rac-line);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
}
.chrono-btn::before {
  content: '';
  position: absolute;
  inset: -6px -4px;
}

.chrono-btn:hover:not(:disabled) {
  background: var(--rac-panel-2);
  border-color: var(--rac-hi);
}

.chrono-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chrono-btn:focus-visible {
  outline: 1px solid var(--rac-focus);
  outline-offset: 1px;
}

/* A′ 宽容档推荐位：静态高亮（不用闪烁动画，颜色+文字双重提示，不只靠颜色） */
.chrono-btn--recommend {
  color: var(--rac-bg);
  background: var(--rac-warn);
  border-color: var(--rac-warn);
  font-weight: 600;
}

.chrono-btn--recommend:hover:not(:disabled) {
  filter: brightness(1.12);
}

.chrono-btn--danger {
  color: var(--rac-alert);
  background: color-mix(in srgb, var(--rac-alert) 8%, transparent);
  border-color: color-mix(in srgb, var(--rac-alert) 40%, transparent);
}

.chrono-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--rac-alert) 16%, transparent);
  border-color: var(--rac-alert);
}

.chrono-btn--dismiss {
  margin-left: auto;
  padding: 0 8px;
  min-height: 20px;
  font-size: 12px;
  color: var(--rac-muted);
  background: transparent;
  border-color: var(--rac-dim);
}

.chrono-banner__hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--rac-warn);
}
</style>
