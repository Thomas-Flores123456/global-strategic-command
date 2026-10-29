/**
 * exposureMoraleEngine.ts —— 暴露度双驱更新引擎（EL-0~EL-4 / 常驻底线 / 自然冷却）与民心「第 0 态：无人在意 + 五阶入世」数值系统（FD-36）
 *
 * 核心职责：
 * 1. `resolveExposureLevel`：将暴露度 `0.0 ~ 10.0` 映射为世界书 `uid=19` & `uid=26` 法定五级状态
 *    （`EL-0 日常隐蔽` / `EL-1 轻微可疑` / `EL-2 战区警觉` / `EL-3 大势震动` / `EL-4 位面出圈`）；
 * 2. `computeExposureFloor`：根据在役基地选址、多阵营同区混建摩擦、超武/巨炮常驻暴露源与伪装建筑（裂缝产生器/暗网中继）
 *    及历史 `EL-4` 不可逆锁定，确定性推导常驻暴露底线 `floor`（`0.0 ~ 9.0`）；
 * 3. `isMoraleEngaged` & `resolveMoraleStage`：
 *    - 当玩家阵营尚处隐蔽种田、未与外界民众发生实质接触（未触发民心事件）且暴露度未达战区警觉（`< 4.5`）时，
 *      民心处于第 0 态 **`无人在意`**（灰色隐世态，零奖惩）；
 *    - 一旦发生抚民/扰民等民心事件，或暴露度 `>= 4.5`（EL-2 战区警觉），即破冰激活 `0.0 ~ 10.0` 五阶民心
 *      （`沸反盈天` / `人心惶惶` / `观望顺从` / `安居归心` / `万众一心`）；
 * 4. `settleExposureAndMorale`：执行每轮暴露度与民心的增量钳制、自然冷却衰减与底线保护。
 *
 * 🔴 纯函数铁律：零 IO / 零 DOM / 零 Vue·Pinia / 零酒馆 API。
 */

export type ExposureLevelCode = 'EL-0' | 'EL-1' | 'EL-2' | 'EL-3' | 'EL-4';

export type ExposureCanonicalLabel =
  | '日常隐蔽（EL-0）'
  | '轻微可疑（EL-1）'
  | '战区警觉（EL-2）'
  | '大势震动（EL-3）'
  | '位面出圈（EL-4）';

export interface ExposureLevelInfo {
  code: ExposureLevelCode;
  shortName: '日常隐蔽' | '轻微可疑' | '战区警觉' | '大势震动' | '位面出圈';
  canonicalLabel: ExposureCanonicalLabel;
  canNaturalDecay: boolean;
  irreversibleLock: boolean;
}

export type MoraleStageName =
  | '无人在意'
  | '沸反盈天'
  | '人心惶惶'
  | '观望顺从'
  | '安居归心'
  | '万众一心';

export interface MoraleStageInfo {
  stage: MoraleStageName;
  engaged: boolean;
  chainMultiplier: number;
  chainBonusText: string;
  /** 正值表示民众告密/流言导致每轮额外增加暴露度；负值表示人民掩护加速每轮暴露自然冷却 */
  exposureDriftPerTurn: number;
  effectSummary: string;
}

const SUPERWEAPON_OR_HEAVY_BEACON_RE =
  /天气控制|核弹发射井|基因突变|心灵控制塔|心灵信标|铁幕装置|巨炮|要塞巨炮|航天发射|质量投射/i;
const STEALTH_SHIELD_BUILDING_RE = /裂缝产生器|超维暗网|暗网中继|伪装网|电磁欺骗/i;
const ALLIED_BUILDING_RE = /盟军|光棱|爱国者|空指部|裂缝产生器|超时空|天气控制/i;
const SOVIET_BUILDING_RE = /苏联|苏军|磁能|磁暴|特斯拉|铁幕|核子反应堆|核弹发射井|复制中心/i;
const YURI_BUILDING_RE = /尤里|心灵|生物反应炉|基因突变|盖特|精神控制/i;

export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function clampRange(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return round2(Math.max(min, Math.min(max, n)));
}

/** 将 0.0~10.0 暴露度映射为世界书 uid=19 & uid=26 五级法定表述 */
export function resolveExposureLevel(value: number): ExposureLevelInfo {
  const v = clampRange(value, 0, 10);
  if (v >= 9.0) {
    return {
      code: 'EL-4',
      shortName: '位面出圈',
      canonicalLabel: '位面出圈（EL-4）',
      canNaturalDecay: false,
      irreversibleLock: true,
    };
  }
  if (v >= 7.0) {
    return {
      code: 'EL-3',
      shortName: '大势震动',
      canonicalLabel: '大势震动（EL-3）',
      canNaturalDecay: false,
      irreversibleLock: false,
    };
  }
  if (v >= 4.5) {
    return {
      code: 'EL-2',
      shortName: '战区警觉',
      canonicalLabel: '战区警觉（EL-2）',
      canNaturalDecay: true,
      irreversibleLock: false,
    };
  }
  if (v >= 2.0) {
    return {
      code: 'EL-1',
      shortName: '轻微可疑',
      canonicalLabel: '轻微可疑（EL-1）',
      canNaturalDecay: true,
      irreversibleLock: false,
    };
  }
  return {
    code: 'EL-0',
    shortName: '日常隐蔽',
    canonicalLabel: '日常隐蔽（EL-0）',
    canNaturalDecay: false,
    irreversibleLock: false,
  };
}

/**
 * 判定民心系统是否已从第 0 态「无人在意」（隐世未接触态）破冰激活：
 * - 当暴露度 >= 4.5（EL-2 战区警觉及以上）时，动静已大到周边民众知晓我方存在，自动破冰激活；
 * - 当 `engaged === true`、或存在非空 `last_change / trend`、或 `value !== 5.0`、
 *   或 `level` 已显式设为五阶入世状态（非 `'无人在意'`）时，视为已破冰激活；
 * - 否则处于第 0 态 `'无人在意'`。
 */
export function isMoraleEngaged(
  morale?: {
    value?: number;
    level?: string;
    trend?: string;
    last_change?: string;
    engaged?: boolean;
  } | null,
  exposureValue = 0,
): boolean {
  if (Number(exposureValue) >= 4.5) return true;
  if (!morale || typeof morale !== 'object') return false;
  if (morale.engaged === true) return true;
  if (morale.engaged === false) return false;
  if (typeof morale.last_change === 'string' && morale.last_change.trim() !== '') return true;
  if (typeof morale.trend === 'string' && morale.trend.trim() !== '' && morale.trend.trim() !== '平稳') return true;
  if (typeof morale.value === 'number' && Number.isFinite(morale.value) && Math.abs(morale.value - 5.0) > 1e-6) {
    return true;
  }
  const lv = String(morale.level ?? '').trim();
  if (
    lv === '沸反盈天' ||
    lv === '人心惶惶' ||
    lv === '观望顺从' ||
    lv === '安居归心' ||
    lv === '万众一心'
  ) {
    return true;
  }
  return false;
}

/**
 * 将 0.0~10.0 民心指数（或隐世未接触态）映射为「第 0 态：无人在意」或五阶入世状态及跨系统联动参数：
 * - 当 `opts.engaged === false` 时返回第 0 态 `'无人在意'`（零奖惩）；
 * - 当未传 `opts` 或 `opts.engaged !== false` 时，按 `0.0 ~ 10.0` 映射五阶状态。
 */
export function resolveMoraleStage(
  value: number,
  opts?: { engaged?: boolean; exposureValue?: number },
): MoraleStageInfo {
  const engaged =
    opts?.engaged !== undefined
      ? opts.engaged || Number(opts?.exposureValue ?? 0) >= 4.5
      : true;

  if (!engaged) {
    return {
      stage: '无人在意',
      engaged: false,
      chainMultiplier: 1.0,
      chainBonusText: '资金链收益 ±0%',
      exposureDriftPerTurn: 0,
      effectSummary: '隐蔽潜伏未入世，外界民众未知晓我方存在（零奖惩）',
    };
  }

  const v = clampRange(Number.isFinite(value) ? value : 5.0, 0, 10);
  if (v < 2.0) {
    return {
      stage: '沸反盈天',
      engaged: true,
      chainMultiplier: 0.75,
      chainBonusText: '资金链收益 -25%',
      exposureDriftPerTurn: 0.1,
      effectSummary: '辖区罢工抗命、向敌方告密（资金链 -25%，每轮暴露 +0.10）',
    };
  }
  if (v < 4.0) {
    return {
      stage: '人心惶惶',
      engaged: true,
      chainMultiplier: 0.9,
      chainBonusText: '资金链收益 -10%',
      exposureDriftPerTurn: 0.05,
      effectSummary: '流言四起、后勤摩擦（资金链 -10%，每轮暴露 +0.05）',
    };
  }
  if (v < 6.5) {
    return {
      stage: '观望顺从',
      engaged: true,
      chainMultiplier: 1.0,
      chainBonusText: '资金链收益 ±0%',
      exposureDriftPerTurn: 0,
      effectSummary: '社会秩序平稳（常态基线）',
    };
  }
  if (v < 8.5) {
    return {
      stage: '安居归心',
      engaged: true,
      chainMultiplier: 1.1,
      chainBonusText: '资金链收益 +10%',
      exposureDriftPerTurn: -0.08,
      effectSummary: '民众主动协作掩护（资金链 +10%，暴露自然冷却 -0.08/轮）',
    };
  }
  return {
    stage: '万众一心',
    engaged: true,
    chainMultiplier: 1.2,
    chainBonusText: '资金链收益 +20%',
    exposureDriftPerTurn: -0.12,
    effectSummary: '人民汪洋铁壁掩护、自发反谍（资金链 +20%，暴露自然冷却 -0.12/轮）',
  };
}

export function getMoraleChainMultiplier(
  moraleValue?: number,
  opts?: { engaged?: boolean; exposureValue?: number },
): number {
  return resolveMoraleStage(moraleValue ?? 5.0, opts).chainMultiplier;
}

/**
 * 推导当前战区常驻暴露底线（exposure.floor）：
 * - 若已达到 EL-4（>= 9.0 或现有 floor >= 9.0），不可逆锁定底线 >= 9.0；
 * - 统计各在役基地的多阵营建筑混建摩擦（>=2 阵营同基地 +0.4，3 阵营同基地 +0.9）、
 *   常驻超武/巨炮暴露源（每座 +0.6，地下层或轨道/月面豁免）、
 *   伪装/反侦察设施（裂缝产生器/暗网中继每座 -0.35）。
 */
export function computeExposureFloor(state: {
  exposure?: { value?: number; floor?: number };
  bases?: ReadonlyArray<{
    status?: string;
    site_type?: string;
    buildings?: ReadonlyArray<{ name?: string; layer?: string; state?: string }>;
  }>;
}): number {
  const prevValue = Number(state.exposure?.value ?? 0);
  const prevFloor = Number(state.exposure?.floor ?? 0);
  if (prevValue >= 9.0 || prevFloor >= 9.0) {
    return 9.0;
  }

  let rawFloor = 0;
  for (const base of state.bases ?? []) {
    if (!base || base.status === '废弃' || base.status === '失守') continue;
    const siteType = String(base.site_type ?? '');
    if (siteType === 'orbital_dock' || siteType === 'lunar_surface') continue;

    const factionsInBase = new Set<'allied' | 'soviet' | 'yuri'>();
    let heavySources = 0;
    let stealthShields = 0;

    for (const bld of base.buildings ?? []) {
      if (!bld || bld.state === '停机') continue;
      const bName = String(bld.name ?? '');
      const bLayer = String(bld.layer ?? '');
      const isUnderground = /地下|空腔|掩体/.test(bLayer);

      if (!isUnderground) {
        if (ALLIED_BUILDING_RE.test(bName)) factionsInBase.add('allied');
        if (SOVIET_BUILDING_RE.test(bName)) factionsInBase.add('soviet');
        if (YURI_BUILDING_RE.test(bName)) factionsInBase.add('yuri');
        if (SUPERWEAPON_OR_HEAVY_BEACON_RE.test(bName)) {
          heavySources++;
        }
      }
      if (STEALTH_SHIELD_BUILDING_RE.test(bName)) {
        stealthShields++;
      }
    }

    let baseFloor = 0;
    if (factionsInBase.size === 2) baseFloor += 0.4;
    if (factionsInBase.size >= 3) baseFloor += 0.9;
    baseFloor += heavySources * 0.6;
    baseFloor -= stealthShields * 0.35;

    if (siteType === 'inland_canyon' || siteType === 'high_latitude') {
      baseFloor -= 0.15;
    } else if (siteType === 'sea_platform') {
      baseFloor -= 0.25;
    }

    rawFloor += Math.max(0, baseFloor);
  }

  return clampRange(rawFloor, 0, 8.5);
}

export interface ExposureMoraleSettleInput {
  /** 显式绝对值（暴露度） */
  explicitExposure?: number | null;
  /** 显式增量（暴露度变化） */
  deltaExposure?: number | null;
  exposureTrend?: string | null;
  exposureLastChange?: string | null;
  /** 显式绝对值（民心 / 民心指数） */
  explicitMorale?: number | null;
  /** 显式增量（民心变化） */
  deltaMorale?: number | null;
  moraleTrend?: string | null;
  moraleLastChange?: string | null;
  /** 是否启用无冲击轮次的自然冷却衰减与民心联动漂移（默认 true） */
  enableNaturalDrift?: boolean;
}

export interface ExposureMoraleSettleResult {
  exposure: {
    value: number;
    floor: number;
    level: ExposureCanonicalLabel;
    trend: string;
    last_change: string;
  };
  morale: {
    value: number;
    level: MoraleStageName;
    engaged: boolean;
    trend: string;
    last_change: string;
  };
  conflictExposureBothProvided: boolean;
  conflictMoraleBothProvided: boolean;
  clampedExposureDelta: boolean;
  clampedMoraleDelta: boolean;
}

/**
 * 统一执行单轮 `<态势>` 暴露度与民心指数的双驱更新结算：
 * 1. 先结算民心（未接触且暴露度 <4.5 时为第 0 态「无人在意」；一旦触发民心事件或暴露度 >=4.5 则破冰进入 0~10 五阶状态）；
 * 2. 推导常驻暴露底线 `floor`；
 * 3. 结算暴露度（增量钳制 `[-1.5, +2.0]`，当未发生正向暴露冲击且处于 `EL-1/EL-2` 时按自然冷却 + 民心掩护/告密漂移，下限受 `floor` 托底）。
 */
export function settleExposureAndMorale(
  currentState: {
    exposure?: { value?: number; floor?: number; level?: string; trend?: string; last_change?: string };
    morale?: { value?: number; level?: string; engaged?: boolean; trend?: string; last_change?: string };
    bases?: ReadonlyArray<{
      status?: string;
      site_type?: string;
      buildings?: ReadonlyArray<{ name?: string; layer?: string; state?: string }>;
    }>;
  },
  input: ExposureMoraleSettleInput,
): ExposureMoraleSettleResult {
  // ── Step 1: 结算民心输入 (Morale 0.0 ~ 10.0, 默认基线 5.0) ──
  const prevMoraleVal =
    typeof currentState.morale?.value === 'number' && Number.isFinite(currentState.morale.value)
      ? clampRange(currentState.morale.value, 0, 10)
      : 5.0;

  const hasExplicitMorale = typeof input.explicitMorale === 'number' && Number.isFinite(input.explicitMorale);
  const hasDeltaMorale = typeof input.deltaMorale === 'number' && Number.isFinite(input.deltaMorale);
  const hasMoraleMeta =
    (typeof input.moraleTrend === 'string' && input.moraleTrend.trim() !== '') ||
    (typeof input.moraleLastChange === 'string' && input.moraleLastChange.trim() !== '');
  const conflictMoraleBothProvided = hasExplicitMorale && hasDeltaMorale;

  let nextMoraleVal = prevMoraleVal;
  let clampedMoraleDelta = false;
  if (hasDeltaMorale) {
    const rawDelta = input.deltaMorale!;
    const safeDelta = clampRange(rawDelta, -1.5, 1.5);
    if (Math.abs(safeDelta - rawDelta) > 1e-6) clampedMoraleDelta = true;
    nextMoraleVal = clampRange(prevMoraleVal + safeDelta, 0, 10);
  } else if (hasExplicitMorale) {
    nextMoraleVal = clampRange(input.explicitMorale!, 0, 10);
  }

  // ── Step 2: 先计算本轮暴露度初值与常驻暴露底线 ──
  const prevExpVal =
    typeof currentState.exposure?.value === 'number' && Number.isFinite(currentState.exposure.value)
      ? clampRange(currentState.exposure.value, 0, 10)
      : 0.0;
  let floor = computeExposureFloor(currentState);

  const hasExplicitExp = typeof input.explicitExposure === 'number' && Number.isFinite(input.explicitExposure);
  const hasDeltaExp = typeof input.deltaExposure === 'number' && Number.isFinite(input.deltaExposure);
  const conflictExposureBothProvided = hasExplicitExp && hasDeltaExp;

  let prelimExpVal = prevExpVal;
  let clampedExposureDelta = false;
  if (hasDeltaExp) {
    const rawDelta = input.deltaExposure!;
    const maxPos = rawDelta >= 7.0 ? 10.0 : 2.0;
    const safeDelta = clampRange(rawDelta, -1.5, maxPos);
    if (Math.abs(safeDelta - rawDelta) > 1e-6) clampedExposureDelta = true;
    prelimExpVal = clampRange(prevExpVal + safeDelta, 0, 10);
  } else if (hasExplicitExp) {
    prelimExpVal = clampRange(input.explicitExposure!, 0, 10);
  }
  if (prelimExpVal < floor) prelimExpVal = floor;

  // 判定民心是否已从「无人在意」破冰激活
  const wasEngaged = isMoraleEngaged(currentState.morale, prevExpVal);
  const nextEngaged =
    wasEngaged ||
    hasExplicitMorale ||
    hasDeltaMorale ||
    hasMoraleMeta ||
    prelimExpVal >= 4.5;

  const moraleStageInfo = resolveMoraleStage(nextMoraleVal, {
    engaged: nextEngaged,
    exposureValue: prelimExpVal,
  });

  // ── Step 3: 若本轮无显式暴露输入，执行自然冷却衰减（EL-1/EL-2）与民心联动漂移 ──
  let nextExpVal = prelimExpVal;
  if (!hasDeltaExp && !hasExplicitExp && input.enableNaturalDrift !== false) {
    const prevLevel = resolveExposureLevel(prevExpVal);
    let drift = 0;
    if (moraleStageInfo.exposureDriftPerTurn > 0) {
      drift += moraleStageInfo.exposureDriftPerTurn;
    } else if (prevLevel.canNaturalDecay && prevExpVal > floor) {
      const baseCool = prevLevel.code === 'EL-1' ? -0.05 : -0.03;
      const moraleCool = moraleStageInfo.exposureDriftPerTurn < 0 ? moraleStageInfo.exposureDriftPerTurn : 0;
      drift = Math.min(baseCool, moraleCool);
    }
    nextExpVal = clampRange(prevExpVal + drift, 0, 10);
  }

  if (nextExpVal >= 9.0 || floor >= 9.0) {
    floor = 9.0;
  }
  if (nextExpVal < floor) {
    nextExpVal = floor;
  }

  const expLevelInfo = resolveExposureLevel(nextExpVal);
  const expTrend =
    (typeof input.exposureTrend === 'string' && input.exposureTrend.trim()) ||
    (nextExpVal > prevExpVal
      ? '上升'
      : nextExpVal < prevExpVal
        ? '下降'
        : currentState.exposure?.trend || '平稳');
  const expLastChange =
    typeof input.exposureLastChange === 'string' && input.exposureLastChange.trim()
      ? input.exposureLastChange.trim()
      : currentState.exposure?.last_change || '';

  const moraleTrend =
    (typeof input.moraleTrend === 'string' && input.moraleTrend.trim()) ||
    (nextMoraleVal > prevMoraleVal
      ? '上升'
      : nextMoraleVal < prevMoraleVal
        ? '下降'
        : currentState.morale?.trend || (nextEngaged ? '平稳' : ''));
  const moraleLastChange =
    typeof input.moraleLastChange === 'string' && input.moraleLastChange.trim()
      ? input.moraleLastChange.trim()
      : currentState.morale?.last_change || '';

  return {
    exposure: {
      value: nextExpVal,
      floor,
      level: expLevelInfo.canonicalLabel,
      trend: expTrend,
      last_change: expLastChange,
    },
    morale: {
      value: nextMoraleVal,
      level: moraleStageInfo.stage,
      engaged: nextEngaged,
      trend: moraleTrend,
      last_change: moraleLastChange,
    },
    conflictExposureBothProvided,
    conflictMoraleBothProvided,
    clampedExposureDelta,
    clampedMoraleDelta,
  };
}
