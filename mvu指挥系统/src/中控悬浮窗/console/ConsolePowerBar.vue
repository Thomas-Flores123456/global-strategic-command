<template>
  <aside
    class="ra-power-column flex flex-col items-center justify-between py-2 select-none"
    :class="{ 'ra-power--deficit': isLowPower, 'ra-power--heavy': isHeavyLoad && !isLowPower }"
    :title="tooltipText"
    aria-label="基地电网负荷表"
  >
    <!-- 顶端电能代号与净余 -->
    <div class="ra-power-head flex flex-col items-center gap-0.5">
      <span class="ra-pwr-icon flex items-center justify-center">
        <Icon name="power" :size="11" />
      </span>
      <span
        class="ra-pwr-val mono"
        :class="isLowPower ? 'text-deficit' : net >= 0 ? 'text-surplus' : 'text-deficit'"
      >
        {{ isLowPower ? 'LOW' : `${animatedNet >= 0 ? '+' : ''}${animatedNet}` }}
      </span>
    </div>

    <!-- 垂直经典刻度能量槽 -->
    <div class="ra-power-track relative flex flex-1 items-end my-1.5 w-full justify-center">
      <!-- 刻度槽底衬 -->
      <div class="ra-power-channel relative w-[10px] h-full overflow-hidden rounded-[2px]">
        <!-- 静态网格刻度虚线 (红警经典 LED 槽横格) -->
        <div class="ra-power-grid absolute inset-0 pointer-events-none z-10" />

        <!-- 发电总量柱 (自底向上填充：上半截超出负载部分呈现红警经典盈余绿) -->
        <div
          class="ra-power-fill absolute bottom-0 left-0 right-0 transition-all duration-300"
          data-test="power-gen-bar"
          :style="{ height: `${animatedGenHeightPct}%` }"
        />

        <!-- 耗电负载柱 (自底向上覆盖：红警经典负载红，直观标识已被消耗的电力份额) -->
        <div
          v-if="use > 0"
          class="ra-power-load absolute bottom-0 left-0 right-0 z-[5] transition-all duration-300"
          data-test="power-load-bar"
          :style="{ height: `${animatedUseHeightPct}%` }"
        />

        <!-- 耗电指示线 / 负荷分界游标横线 -->
        <div
          v-if="gen > 0 || use > 0"
          class="ra-power-needle absolute left-0 right-0 z-20 transition-all duration-300"
          :style="{ bottom: `${animatedUseHeightPct}%` }"
        />
      </div>

      <!-- 侧边物理标尺小三角指示器 -->
      <div
        v-if="gen > 0 || use > 0"
        class="ra-power-arrow absolute right-0 z-30 transition-all duration-300 pointer-events-none"
        :style="{ bottom: `calc(${animatedUseHeightPct}% - 3px)` }"
      />
    </div>

      <!-- 底端负荷百分比与告警 -->
    <div class="ra-power-foot flex flex-col items-center">
      <span v-if="isLowPower" class="ra-pwr-warn mono">
        !
      </span>
      <span v-else class="ra-pwr-pct mono">
        {{ `${animatedLoadPct}%` }}
      </span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { useGsapNumber } from '../../红警指挥系统/ui/motion/useGsapMotion';

const props = withDefaults(
  defineProps<{
    gen: number;
    use: number;
  }>(),
  {
    gen: 0,
    use: 0,
  },
);

/** 净余电力 = 发电 - 耗电 */
const net = computed(() => props.gen - props.use);

/** 低电量预警：耗电超出总发电量，或无发电但有耗电 */
const isLowPower = computed(() => props.use > props.gen || (props.gen === 0 && props.use > 0));

/** 重负载预警：负荷达到 85% 以上 */
const isHeavyLoad = computed(() => props.gen > 0 && props.use / props.gen >= 0.85);

/** 负荷比 */
const loadRatio = computed(() => {
  if (props.gen <= 0) return props.use > 0 ? 1 : 0;
  return Math.min(props.use / props.gen, 1.5);
});

/**
 * 红警经典电力柱刻度尺：
 * 1. 低发电量时（如 100~400W）保留充足上方爬升刻度，随电厂扩建逐步升高；
 * 2. 无论发电量/耗电量如何巨大（哪怕数万瓦），顶端始终保留至少 12%~15% 的暗格余量（硬封顶 88%），绝不到顶！
 */
const MAX_POWER_BAR_PCT = 88;

const maxScale = computed(() => {
  const peak = Math.max(props.gen, props.use, 0);
  if (peak <= 0) return 100;
  // 渐近余量：小电网时分母相对更大（柱体在 35%~65% 区间），大电网时渐近逼近 MAX_POWER_BAR_PCT 但永不到顶
  const climbFactor = 1 - Math.exp(-peak / 450); // (0, 1) 单调递增且永不等于 1
  const targetPeakPct = Math.min(MAX_POWER_BAR_PCT, 28 + climbFactor * (MAX_POWER_BAR_PCT - 28));
  return peak / (targetPeakPct / 100);
});

const genHeightPercent = computed(() => {
  if (props.gen <= 0 || maxScale.value <= 0) return 0;
  return Math.min(MAX_POWER_BAR_PCT, Math.max(4, (props.gen / maxScale.value) * 100));
});

const useHeightPercent = computed(() => {
  if (props.use <= 0 || maxScale.value <= 0) return 0;
  return Math.min(MAX_POWER_BAR_PCT, Math.max(3, (props.use / maxScale.value) * 100));
});

const animatedNet = useGsapNumber(() => net.value, { duration: 0.38 });
const animatedGenHeightPct = useGsapNumber(() => genHeightPercent.value, { duration: 0.42, decimals: 2 });
const animatedUseHeightPct = useGsapNumber(() => useHeightPercent.value, { duration: 0.42, decimals: 2 });
const animatedLoadPct = useGsapNumber(() => Math.round(loadRatio.value * 100), { duration: 0.38 });

const tooltipText = computed(() => {
  const status = isLowPower.value ? '电力赤字 · 基础建筑面临断电停机！' : isHeavyLoad.value ? '重负载运转中' : '电网负载正常';
  return `【战术基地电网】\n发电量: ${props.gen} W\n耗电量: ${props.use} W\n净余电力: ${net.value >= 0 ? '+' : ''}${net.value} W\n电网负荷: ${Math.round(loadRatio.value * 100)}%\n状态: ${status}`;
});
</script>

<style scoped>
.ra-power-column {
  width: 30px;
  flex: none;
  background: var(--rac-panel);
  border-right: 1px solid var(--rac-dim);
  box-shadow: inset -1px 0 0 color-mix(in srgb, var(--rac-hi) 4%, transparent);
}

.ra-pwr-icon {
  color: var(--rac-line);
}

.ra-power--heavy .ra-pwr-icon {
  color: var(--rac-warn);
}

.ra-power--deficit .ra-pwr-icon {
  color: var(--rac-alert);
}

.ra-pwr-val {
  font-family: var(--rac-font-num);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
}

.text-surplus {
  color: var(--rac-ok);
}

.text-deficit {
  color: var(--rac-alert);
}

.ra-power-track {
  min-height: 120px;
}

.ra-power-channel {
  background: var(--rac-bg);
  border: 1px solid var(--rac-dim);
  box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.8);
}

/* 分格刻度：每 4px 一道 1px 暗缝隙（Oblivion 精密刻度槽）*/
.ra-power-grid {
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 3px,
    var(--rac-bg) 3px,
    var(--rac-bg) 4px
  );
}

/* 发电总量柱（经典红警三段式刻度条：上半段盈余呈现鲜明翡翠绿 --rac-ok，顶端高光刻度线标定发电上限） */
.ra-power-fill {
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--rac-ok) 72%, var(--rac-bg)) 0%,
    var(--rac-ok) 100%
  );
  border-top: 2px solid color-mix(in srgb, var(--rac-ok) 78%, var(--rac-hi));
  box-shadow: inset 0 0 6px color-mix(in srgb, var(--rac-ok) 38%, transparent);
}

.ra-power--heavy .ra-power-fill {
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--rac-warn) 72%, var(--rac-bg)) 0%,
    var(--rac-warn) 100%
  );
  border-top: 2px solid color-mix(in srgb, var(--rac-warn) 80%, var(--rac-hi));
}

.ra-power--deficit .ra-power-fill {
  background: var(--rac-hatch-alert);
  border-top: 2px solid var(--rac-alert);
}

/* 耗电负载段填色（经典红警：已消耗电力自底向上呈現琥珀黄→橙红过渡，与上方盈余绿段形成红绿黄三色直观对比） */
.ra-power-load {
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--rac-alert) 78%, var(--rac-bg)) 0%,
    color-mix(in srgb, var(--rac-warn) 92%, var(--rac-bg)) 72%,
    var(--rac-warn) 100%
  );
  box-shadow: inset 0 0 4px color-mix(in srgb, var(--rac-warn) 32%, transparent);
}

.ra-power--heavy .ra-power-load {
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--rac-alert) 92%, var(--rac-bg)) 0%,
    var(--rac-warn) 100%
  );
  box-shadow: inset 0 0 6px color-mix(in srgb, var(--rac-alert) 42%, transparent);
}

.ra-power--deficit .ra-power-load {
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--rac-alert) 78%, var(--rac-bg)) 0%,
    var(--rac-alert) 100%
  );
  box-shadow: inset 0 0 8px color-mix(in srgb, var(--rac-alert) 55%, transparent);
}

/* 负载分界游标横杠（红黄负载与绿色盈余的鲜明交界） */
.ra-power-needle {
  height: 2px;
  background: var(--rac-hi);
  box-shadow: 0 0 4px color-mix(in srgb, var(--rac-warn) 70%, transparent);
}

.ra-power--heavy .ra-power-needle {
  background: var(--rac-warn);
  box-shadow: 0 0 5px color-mix(in srgb, var(--rac-warn) 80%, transparent);
}

.ra-power--deficit .ra-power-needle {
  background: var(--rac-alert);
  box-shadow: 0 0 6px color-mix(in srgb, var(--rac-alert) 85%, transparent);
}

/* 侧边微型三角游标 */
.ra-power-arrow {
  width: 0;
  height: 0;
  border-top: 3px solid transparent;
  border-bottom: 3px solid transparent;
  border-right: 4px solid var(--rac-warn);
}

.ra-power--heavy .ra-power-arrow {
  border-right-color: var(--rac-warn);
}

.ra-power--deficit .ra-power-arrow {
  border-right-color: var(--rac-alert);
}

.ra-pwr-pct {
  font-family: var(--rac-font-num);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--rac-muted);
  letter-spacing: -0.04em;
  line-height: 1;
}

.ra-pwr-warn {
  font-family: var(--rac-font-num);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  font-weight: 900;
  color: var(--rac-alert);
  line-height: 1;
}

@media (prefers-reduced-motion: reduce) {
  .ra-power-fill,
  .ra-power-load,
  .ra-power-needle,
  .ra-power-arrow,
  .ra-pwr-warn {
    animation: none !important;
    transition: none !important;
  }
}
</style>
