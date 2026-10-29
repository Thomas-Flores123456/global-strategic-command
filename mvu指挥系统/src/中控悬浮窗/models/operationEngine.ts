/**
 * 动态条件工况与降频纯函数计算器（中控台高阶物理层 · 任务包 §3.6 SSOT 计算核心）
 *
 * 核心哲学：
 * 1. 工况驱动原则：MVU 仅提供环境 Fact（电网净余/赤字、昼夜时段、天候、建筑受损度等），
 *    当前有效产出由前端纯函数动态求值，不存冗余变量。
 * 2. 纯函数设计：零 Pinia、零 Vue、零宿主 API 强依赖，保证完全可测与线程安全，
 *    便于响应式 computed 直接消费与离线仿真。
 * 3. 严格对齐任务包 §3.6 契约：
 *    - triggers: low_power, night, weather_bad, damaged, overclock ＋ 开放 string 扩展；
 *    - behaviors: degraded, idle, suspended, boosted ＋ 开放 string 扩展；
 *    - buffs: flat / ratio / km 三种物理单位修正精确求值。
 */

import {
  HUMAN_ADJUTANT_DAILY_UPKEEP,
  deriveStaffSlotCap,
  normalizeFactionId,
  resolveAdjutantBuffPreset,
} from '../../红警指挥系统/core/commandPresets';
import {
  NON_OPERATIONAL_BUILDING_STATES,
  OPERATIONAL_BUILDING_STATES,
  WEATHER_DECAY_DEFAULTS,
  applyGridConstraints,
  computeBaseBuildingHealthFactor,
  isBuildingOperational,
  isPositiveIncomeChain,
  weatherDecayOf,
  withWeatherView,
  type BasePowerView,
  type BuildingStatusLike,
} from '../../红警指挥系统/engines/operationEngine';
import type { Adjutant, CommandHQ, StatData } from '../../红警指挥系统/core/schema';

export {
  NON_OPERATIONAL_BUILDING_STATES,
  OPERATIONAL_BUILDING_STATES,
  WEATHER_DECAY_DEFAULTS,
  applyGridConstraints,
  computeBaseBuildingHealthFactor,
  isBuildingOperational,
  isPositiveIncomeChain,
  weatherDecayOf,
  withWeatherView,
  type BasePowerView,
  type BuildingStatusLike,
};
import type {
  OperationalBuff,
  OperationalCondition,
  OperationalConditionItem,
  ResourceRate,
  VirtualOutputs,
  WorldbookBuildingData,
} from './worldbookCatalogParser';

// ==========================================
// 1. 类型定义
// ==========================================

/**
 * 基地即时环境事实输入 (Environment Facts)
 */
export interface BaseEnvironmentFact {
  /** 电网净余电力 (gen - use)，< 0 视为赤字 */
  power_net?: number;
  /** 显式电网赤字/低电标记 (若未直接提供，自动由 power_net < 0 或 power.gen < power.use 判定) */
  is_low_power?: boolean;
  /** 电网双指标对象 { gen, use } */
  power?: {
    gen?: number;
    use?: number;
  };
  /** 昼夜时段：'day' | 'night' | 'dawn' | 'dusk' 等 */
  time_of_day?: 'day' | 'night' | 'dawn' | 'dusk' | string;
  /** 显式夜间标记 */
  is_night?: boolean;
  /** 天气状况：'clear' | 'sunny' | 'rain' | 'cloudy' | 'overcast' | 'storm' | 'snow' | 'fog' | 'bad' 等 */
  weather?: string;
  /** 显式恶劣天气标记 (阴雨/风暴/雪暴/浓雾等) */
  is_weather_bad?: boolean;
  /** 建筑受损状态：'运转' | '建造中' | '受损' | '停机' | string */
  building_state?: '运转' | '建造中' | '受损' | '停机' | string;
  /** 建筑受损比例 (0 为完好，>0 为受损；如 0.3 表示损失 30% 结构) */
  damage_ratio?: number;
  /** 显式受损标记 */
  is_damaged?: boolean;
  /** 显式超频标记 */
  is_overclock?: boolean;
  /** 开放自定义触发器集合 (如 'emp_blast', 'winter_freeze', 'sandstorm') */
  active_triggers?: string[] | Set<string> | Record<string, boolean>;
}

/**
 * 建筑标称输入参数（用于非全量 BuildingData 或直接传入标称数值场景）
 */
export interface BuildingNominalInput {
  /** 标称功耗 (MW 或游戏电力单位)，正数为耗电，负数为发电 */
  power?: number;
  /** 标称标量产出 (如发电量、日产额) */
  base_output?: number;
  /** 标称虚拟能力池 (算力/C4ISR/抢修/电网缓冲) */
  virtual?: VirtualOutputs;
  /** 标称资源产出速率 Record<string, number> */
  resources?: ResourceRate;
  /** 标称资源消耗速率 Record<string, number> */
  input_resources?: ResourceRate;
  /** 静态基础 Buffs */
  buffs?: OperationalBuff[];
}

/**
 * 动态工况求值计算结果
 */
export interface OperationEvaluationResult {
  /** 是否存在任何激活的工况条件 */
  isActive: boolean;
  /** 激活的工况条件列表（按原始条目声明序） */
  activeConditions: OperationalConditionItem[];
  /** 主导/有效行为状态：'normal' | 'suspended' | 'idle' | 'degraded' | 'boosted' | string */
  primaryBehavior: 'normal' | 'suspended' | 'idle' | 'degraded' | 'boosted' | string;
  /** 所有激活的行为列表 */
  activeBehaviors: string[];
  /** 综合有效效率乘数 (默认 1.0，停机/夜间光伏等为 0，多重降频为连乘) */
  efficiency: number;
  /** 即时有效功耗 (若工况有 power 修正则采用；若停机且无显式 power 则降为 0；否则保持标称功耗) */
  effectivePower: number;
  /** 即时有效标量输出 (若定义了 base_output/output 则按工况计算；如光伏夜间 0，阴雨 25%) */
  effectiveOutput?: number;
  /** 即时有效虚拟能力池 (算力/态势感知/抢修通量/电网缓冲按综合效率连乘缩放) */
  effectiveVirtual?: VirtualOutputs;
  /** 即时有效实体资源产出 (各项产率按综合效率缩放) */
  effectiveResources?: ResourceRate;
  /** 即时有效实体资源消耗 (各项消耗按综合效率缩放，停机归零) */
  effectiveInputResources?: ResourceRate;
  /** 即时生效的 Buffs 列表 (静态基础 Buffs + 激活条件 Buffs) */
  effectiveBuffs: OperationalBuff[];
  /** 激活工况的军工可解释性描述列表 */
  activeDescs: string[];
}

// ==========================================
// 2. 词典与常量
// ==========================================

const BAD_WEATHER_KEYWORDS = new Set([
  'bad',
  'rain',
  'rainy',
  'heavy_rain',
  'storm',
  'thunderstorm',
  'snow',
  'snowy',
  'blizzard',
  'fog',
  'foggy',
  'overcast',
  'cloudy',
  'sandstorm',
  'acid_rain',
  'hail',
  '阴雨',
  '阴天',
  '大雨',
  '暴雨',
  '雷阵雨',
  '风暴',
  '雷暴',
  '暴雪',
  '大雪',
  '大雾',
  '浓雾',
  '沙尘暴',
  '暴风雪',
  '辐射风暴',
  '强磁暴',
  '磁暴',
  '冻雨',
  '酸雨',
  '冰雹',
  '恶劣',
  'blizzard',
  'radstorm',
  'magneticstorm',
  'freezingrain',
]);

const NIGHT_KEYWORDS = new Set(['night', 'midnight', 'dark', '夜间', '黑夜', '深夜', '夜晚']);

const DAMAGED_STATES = new Set(['受损', '轻损', '重损', 'damaged', 'broken', 'critical']);

/** 行为优先级权重：suspended (4) > idle (3) > degraded (2) > boosted (1) > normal (0) */
const BEHAVIOR_PRIORITY: Record<string, number> = {
  suspended: 4,
  idle: 3,
  degraded: 2,
  boosted: 1,
  normal: 0,
};

// ==========================================
// 3. 工具函数
// ==========================================

/** 限制小数精度至 4 位，避免浮点数精度漂移 */
export function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

/**
 * 判断指定 trigger 在当前环境中是否被激活
 */
export function isTriggerActive(trigger: string, env?: BaseEnvironmentFact): boolean {
  if (!env || !trigger) return false;

  const normalizedTrigger = trigger.trim().toLowerCase();

  // 1. 优先检查开放自定义触发器集合 (active_triggers)
  if (env.active_triggers) {
    if (Array.isArray(env.active_triggers)) {
      if (env.active_triggers.some(t => t.trim().toLowerCase() === normalizedTrigger)) {
        return true;
      }
    } else if (env.active_triggers instanceof Set) {
      for (const t of env.active_triggers) {
        if (t.trim().toLowerCase() === normalizedTrigger) return true;
      }
    } else if (typeof env.active_triggers === 'object') {
      for (const [k, v] of Object.entries(env.active_triggers)) {
        if (k.trim().toLowerCase() === normalizedTrigger && Boolean(v)) {
          return true;
        }
      }
    }
  }

  // 2. 检查特定内建触发器
  switch (normalizedTrigger) {
    case 'low_power': {
      if (env.is_low_power === true) return true;
      if (typeof env.power_net === 'number' && env.power_net < 0) return true;
      if (env.power && typeof env.power.gen === 'number' && typeof env.power.use === 'number') {
        return env.power.gen < env.power.use;
      }
      return false;
    }

    case 'night': {
      if (env.is_night === true) return true;
      if (typeof env.time_of_day === 'string') {
        const tod = env.time_of_day.trim().toLowerCase();
        if (NIGHT_KEYWORDS.has(tod)) return true;
      }
      return false;
    }

    case 'weather_bad': {
      if (env.is_weather_bad === true) return true;
      if (typeof env.weather === 'string') {
        const w = env.weather.trim().toLowerCase();
        if (BAD_WEATHER_KEYWORDS.has(w)) return true;
      }
      return false;
    }

    case 'damaged': {
      if (env.is_damaged === true) return true;
      if (typeof env.building_state === 'string') {
        const state = env.building_state.trim().toLowerCase();
        if (DAMAGED_STATES.has(state)) return true;
      }
      if (typeof env.damage_ratio === 'number' && env.damage_ratio > 0) return true;
      return false;
    }

    case 'overclock': {
      if (env.is_overclock === true) return true;
      return false;
    }

    default: {
      // 开放扩展字符串触发器：检查 env 上是否存在直接以 trigger 命名的布尔属性
      const rawEnv = env as Record<string, unknown>;
      if (rawEnv[trigger] === true || rawEnv[normalizedTrigger] === true) return true;
      if (rawEnv[`is_${trigger}`] === true || rawEnv[`is_${normalizedTrigger}`] === true) return true;
      return false;
    }
  }
}

// ==========================================
// 4. Buff 精确求值算法 (flat / ratio / km)
// ==========================================

/**
 * 单项 Buff 施加计算
 * - flat: 基础数值直接加减 (+value)
 * - km: 战术距离/空情雷达半径加减 (+value km)
 * - ratio: 比例乘数调整 (baseValue * (1 + value))
 */
export function applyBuff(baseValue: number, buff: OperationalBuff): number {
  const unit = (buff.unit ?? 'flat').toLowerCase();
  switch (unit) {
    case 'ratio':
      return round4(baseValue * (1 + buff.value));
    case 'km':
    case 'flat':
    default:
      return round4(baseValue + buff.value);
  }
}

/**
 * 多项 Buff 对单一目标属性的综合结算
 *
 * 运算规则：
 * - flat 与 km 归入加法修正量：flatSum = sum(flat) + sum(km)
 * - ratio 归入乘法修正量：ratioSum = sum(ratio)
 * - 默认顺序 (flat_first): finalValue = (baseValue + flatSum) * (1 + ratioSum)
 * - 可选顺序 (ratio_first): finalValue = baseValue * (1 + ratioSum) + flatSum
 */
export function resolveBuffValue(
  baseValue: number,
  buffs: OperationalBuff[],
  options?: { mode?: 'flat_first' | 'ratio_first' },
): number {
  if (!buffs || buffs.length === 0) return baseValue;

  let flatSum = 0;
  let kmSum = 0;
  let ratioSum = 0;

  for (const b of buffs) {
    const unit = (b.unit ?? 'flat').toLowerCase();
    if (unit === 'ratio') {
      ratioSum += b.value;
    } else if (unit === 'km') {
      kmSum += b.value;
    } else {
      flatSum += b.value;
    }
  }

  const mode = options?.mode ?? 'flat_first';
  const totalAdditive = flatSum + kmSum;

  if (mode === 'ratio_first') {
    return round4(baseValue * (1 + ratioSum) + totalAdditive);
  }
  return round4((baseValue + totalAdditive) * (1 + ratioSum));
}

/**
 * 针对特定 target 的 Buff 汇总与求解
 */
export function resolveBuffsForTarget(
  target: string,
  baseValue: number,
  buffs: OperationalBuff[],
  options?: { mode?: 'flat_first' | 'ratio_first' },
): number {
  if (!buffs || buffs.length === 0) return baseValue;
  const targetBuffs = buffs.filter(b => b.target === target);
  return resolveBuffValue(baseValue, targetBuffs, options);
}

/**
 * 将 Buffs 按 target 分组统计
 */
export function summarizeBuffs(
  buffs: OperationalBuff[],
): Record<string, { flat: number; ratio: number; km: number; count: number }> {
  const summary: Record<string, { flat: number; ratio: number; km: number; count: number }> = {};
  for (const b of buffs) {
    if (!summary[b.target]) {
      summary[b.target] = { flat: 0, ratio: 0, km: 0, count: 0 };
    }
    const s = summary[b.target];
    s.count += 1;
    const unit = (b.unit ?? 'flat').toLowerCase();
    if (unit === 'ratio') {
      s.ratio = round4(s.ratio + b.value);
    } else if (unit === 'km') {
      s.km = round4(s.km + b.value);
    } else {
      s.flat = round4(s.flat + b.value);
    }
  }
  return summary;
}

// ==========================================
// 5. 核心工况计算器 (纯函数)
// ==========================================

/**
 * 动态条件工况与降频纯函数计算器
 *
 * @param operation 条目内的 operation 节点
 * @param env 基地即时环境事实
 * @param nominal 标称基准输入（功耗、标量产出、虚拟池、资源流等）
 */
export function calculateOperation(
  operation: OperationalCondition | undefined,
  env: BaseEnvironmentFact,
  nominal: BuildingNominalInput = {},
): OperationEvaluationResult {
  const nominalPower = typeof nominal.power === 'number' ? nominal.power : 0;
  const nominalBaseOutput = nominal.base_output !== undefined ? nominal.base_output : operation?.base_output;
  const baseBuffs = operation?.buffs ?? nominal.buffs ?? [];

  // 1. 无工况配置或条件为空时的安全直通
  if (!operation || !Array.isArray(operation.conditions) || operation.conditions.length === 0) {
    return {
      isActive: false,
      activeConditions: [],
      primaryBehavior: 'normal',
      activeBehaviors: [],
      efficiency: 1.0,
      effectivePower: nominalPower,
      effectiveOutput: nominalBaseOutput,
      effectiveVirtual: nominal.virtual ? deepCloneVirtual(nominal.virtual) : undefined,
      effectiveResources: nominal.resources ? { ...nominal.resources } : undefined,
      effectiveInputResources: nominal.input_resources ? { ...nominal.input_resources } : undefined,
      effectiveBuffs: [...baseBuffs],
      activeDescs: [],
    };
  }

  // 2. 筛选激活的工况条件
  const activeConditions = operation.conditions.filter(c => isTriggerActive(c.trigger, env));

  // 3. 若无条件激活，返回标准正常状态
  if (activeConditions.length === 0) {
    return {
      isActive: false,
      activeConditions: [],
      primaryBehavior: 'normal',
      activeBehaviors: [],
      efficiency: 1.0,
      effectivePower: nominalPower,
      effectiveOutput: nominalBaseOutput,
      effectiveVirtual: nominal.virtual ? deepCloneVirtual(nominal.virtual) : undefined,
      effectiveResources: nominal.resources ? { ...nominal.resources } : undefined,
      effectiveInputResources: nominal.input_resources ? { ...nominal.input_resources } : undefined,
      effectiveBuffs: [...baseBuffs],
      activeDescs: [],
    };
  }

  // 4. 判定主导行为状态
  const activeBehaviors = activeConditions.map(c => c.behavior);
  let primaryBehavior = activeBehaviors[0] ?? 'normal';
  let highestWeight = BEHAVIOR_PRIORITY[primaryBehavior] ?? 0;

  for (const b of activeBehaviors) {
    const weight = BEHAVIOR_PRIORITY[b] ?? 0;
    if (weight > highestWeight) {
      highestWeight = weight;
      primaryBehavior = b;
    }
  }

  // 5. 综合计算效率乘数
  let efficiency = 1.0;

  if (primaryBehavior === 'suspended') {
    efficiency = 0;
  } else {
    let hasExplicitZeroEfficiency = false;
    for (const c of activeConditions) {
      if (typeof c.efficiency === 'number') {
        efficiency *= c.efficiency;
        if (c.efficiency === 0) hasExplicitZeroEfficiency = true;
      } else if (c.behavior === 'suspended' || c.behavior === 'idle') {
        efficiency = 0;
        hasExplicitZeroEfficiency = true;
      }
    }
    efficiency = hasExplicitZeroEfficiency ? 0 : Math.max(0, round4(efficiency));
  }

  // 6. 即时有效功耗计算
  // 规则：
  // - 若工况显式指定了 power，优先采用与 primaryBehavior 匹配的工况功耗（或最小功耗）
  // - 若工况未指定 power，且处于 suspended 停机状态，功耗归零 (0)
  // - 否则维持标称功耗
  let effectivePower = nominalPower;
  const conditionsWithPower = activeConditions.filter(c => typeof c.power === 'number');

  if (conditionsWithPower.length > 0) {
    const matching = conditionsWithPower.find(c => c.behavior === primaryBehavior);
    effectivePower = matching ? matching.power! : conditionsWithPower[0].power!;
  } else if (primaryBehavior === 'suspended') {
    effectivePower = 0;
  }

  // 7. 即时有效标量产出计算
  // 规则：
  // - 停机或效率为 0 时产出严格归零
  // - 若激活条件显式指定了 output，优先采用
  // - 否则由 nominalBaseOutput * efficiency 推导
  let effectiveOutput: number | undefined;

  if (efficiency === 0 || primaryBehavior === 'suspended') {
    effectiveOutput = nominalBaseOutput !== undefined ? 0 : undefined;
  } else {
    const conditionsWithOutput = activeConditions.filter(c => typeof c.output === 'number');
    if (conditionsWithOutput.length > 0) {
      const matching = conditionsWithOutput.find(c => c.behavior === primaryBehavior);
      effectiveOutput = matching ? matching.output! : conditionsWithOutput[0].output!;
    } else if (nominalBaseOutput !== undefined) {
      effectiveOutput = round4(nominalBaseOutput * efficiency);
    }
  }

  // 8. 即时有效虚拟能力池计算 (按综合效率连乘缩放)
  let effectiveVirtual: VirtualOutputs | undefined;
  if (nominal.virtual) {
    effectiveVirtual = scaleVirtualOutputs(nominal.virtual, efficiency);
  }

  // 9. 即时有效实体资源流计算 (按综合效率缩放)
  let effectiveResources: ResourceRate | undefined;
  if (nominal.resources) {
    effectiveResources = {};
    for (const [k, v] of Object.entries(nominal.resources)) {
      effectiveResources[k] = round4(v * efficiency);
    }
  }

  let effectiveInputResources: ResourceRate | undefined;
  if (nominal.input_resources) {
    effectiveInputResources = {};
    for (const [k, v] of Object.entries(nominal.input_resources)) {
      effectiveInputResources[k] = round4(v * efficiency);
    }
  }

  // 10. 即时生效 Buff 列表计算
  // 规则：若设施停机 (suspended)，通常不提供静态基础 Buff；
  // 仅在非停机状态下保留基础 Buff，并追加所有激活工况提供的额外 Buff
  const effectiveBuffs: OperationalBuff[] = [];
  if (primaryBehavior !== 'suspended') {
    effectiveBuffs.push(...baseBuffs);
  }
  for (const c of activeConditions) {
    if (Array.isArray(c.buffs)) {
      effectiveBuffs.push(...c.buffs);
    }
  }

  // 11. 收集军工可解释性描述
  const activeDescs = activeConditions.map(c => c.desc).filter(Boolean);

  return {
    isActive: true,
    activeConditions,
    primaryBehavior,
    activeBehaviors,
    efficiency,
    effectivePower,
    effectiveOutput,
    effectiveVirtual,
    effectiveResources,
    effectiveInputResources,
    effectiveBuffs,
    activeDescs,
  };
}

/**
 * 针对 WorldbookBuildingData 条目的高级便捷求值函数
 */
export function calculateBuildingOperation(
  building: WorldbookBuildingData | (Record<string, unknown> & { operation?: OperationalCondition; power?: number }),
  env: BaseEnvironmentFact,
): OperationEvaluationResult {
  // 融合建筑自身 state / status 至环境事实（若环境事实未显式指定 building_state）
  let mergedEnv = env;
  const rawBuilding = building as Record<string, unknown>;
  const rawState =
    typeof rawBuilding.state === 'string'
      ? rawBuilding.state
      : typeof rawBuilding.status === 'string'
        ? rawBuilding.status
        : undefined;
  if (rawState && !env.building_state) {
    mergedEnv = {
      ...env,
      building_state: rawState,
    };
  }

  const bData = building as WorldbookBuildingData;
  const nominal: BuildingNominalInput = {
    power: typeof building.power === 'number' ? building.power : 0,
    base_output: building.operation?.base_output,
    virtual: bData.outputs?.virtual,
    resources: bData.outputs?.resources,
    input_resources: bData.inputs?.resources,
    buffs: building.operation?.buffs,
  };

  return calculateOperation(building.operation, mergedEnv, nominal);
}

// ==========================================
// 6. 辅助内部函数
// ==========================================

function deepCloneVirtual(virtual: VirtualOutputs): VirtualOutputs {
  return {
    compute: virtual.compute ? { ...virtual.compute } : undefined,
    c4isr: virtual.c4isr ? { ...virtual.c4isr } : undefined,
    repair_rate: virtual.repair_rate,
    grid_buffer: virtual.grid_buffer,
  };
}

function scaleVirtualOutputs(virtual: VirtualOutputs, efficiency: number): VirtualOutputs {
  const result: VirtualOutputs = {};

  if (virtual.compute) {
    result.compute = {
      tflops: typeof virtual.compute.tflops === 'number' ? round4(virtual.compute.tflops * efficiency) : undefined,
      tops: typeof virtual.compute.tops === 'number' ? round4(virtual.compute.tops * efficiency) : undefined,
    };
  }

  if (virtual.c4isr) {
    result.c4isr = {
      recon_km: typeof virtual.c4isr.recon_km === 'number' ? round4(virtual.c4isr.recon_km * efficiency) : undefined,
    };
  }

  if (typeof virtual.repair_rate === 'number') {
    result.repair_rate = round4(virtual.repair_rate * efficiency);
  }

  if (typeof virtual.grid_buffer === 'number') {
    (result as Record<string, unknown>).grid_buffer = round4(virtual.grid_buffer * efficiency);
  } else if (virtual.grid_buffer && typeof virtual.grid_buffer === 'object') {
    result.grid_buffer = {
      storage_mwh:
        typeof virtual.grid_buffer.storage_mwh === 'number'
          ? round4(virtual.grid_buffer.storage_mwh * efficiency)
          : undefined,
      max_discharge_mw:
        typeof virtual.grid_buffer.max_discharge_mw === 'number'
          ? round4(virtual.grid_buffer.max_discharge_mw * efficiency)
          : undefined,
    };
  }

  return result;
}

// ==========================================
// 7. 中控台联席参谋部管理动作 (CMD-ENGINE-01)
// ==========================================

export type ConsoleOperation =
  | {
      type: 'CommandAssignAdjutant';
      slotRole: 'faction' | 'staff';
      faction?: string;
      identity: 'human' | 'mcv_girl' | 'commander_self';
      name: string;
      title?: string;
      buffPreset?: string;
    }
  | {
      type: 'CommandDismissAdjutant';
      adjutantId: string;
    };

export interface ConsoleOperationResult {
  ok: boolean;
  summary: string;
  state: StatData;
  data: StatData;
  next: StatData;
  adjutant?: Adjutant;
  removed?: Adjutant;
  error?: string;
}

function ensureConsoleCommandHQ(
  state: StatData,
  precomputedCap?: number,
): CommandHQ & { staff_slot_cap?: number } {
  const existing = (state.command ?? {}) as Partial<CommandHQ & { staff_slot_cap?: number }>;
  const slotCap = precomputedCap ?? deriveStaffSlotCap(state);
  const cmd: CommandHQ & { staff_slot_cap?: number } = {
    ...existing,
    commander_name: typeof existing.commander_name === 'string' ? existing.commander_name : '',
    commander_title:
      typeof existing.commander_title === 'string' && existing.commander_title
        ? existing.commander_title
        : '战区最高统帅',
    unlocked_factions: Array.isArray(existing.unlocked_factions) ? [...existing.unlocked_factions] : ['allied'],
    mcv_granted_factions: Array.isArray(existing.mcv_granted_factions) ? [...existing.mcv_granted_factions] : [],
    adjutants: Array.isArray(existing.adjutants) ? [...existing.adjutants] : [],
    break_in_penalties: Array.isArray(existing.break_in_penalties) ? [...existing.break_in_penalties] : [],
    staff_slot_cap: slotCap,
  };
  state.command = cmd;
  return cmd;
}

export function canStartOperation(
  state: StatData,
  op: ConsoleOperation,
  precomputedCap?: number,
): { ok: boolean; slotCap: number; error?: string } {
  const slotCap = precomputedCap ?? deriveStaffSlotCap(state);
  if (op.type === 'CommandAssignAdjutant') {
    const trimmedName = (op.name ?? '').trim();
    if (!trimmedName) {
      return { ok: false, slotCap, error: '副官姓名不能为空' };
    }
    if (op.slotRole === 'staff') {
      const adjutants = Array.isArray(state.command?.adjutants) ? state.command.adjutants : [];
      const sameNameIdx = adjutants.findIndex(a => a.role === 'staff' && a.name === trimmedName);
      const currentStaffCount = adjutants.filter(a => a.role === 'staff').length;
      if (sameNameIdx < 0 && currentStaffCount >= slotCap) {
        return { ok: false, slotCap, error: `参谋槽位已达上限（${slotCap}/${slotCap}）` };
      }
    }
  } else if (op.type === 'CommandDismissAdjutant') {
    const targetId = (op.adjutantId ?? '').trim();
    const adjutants = Array.isArray(state.command?.adjutants) ? state.command.adjutants : [];
    const idx = adjutants.findIndex(a => a.id === targetId || a.name === targetId);
    if (idx < 0) {
      return { ok: false, slotCap, error: `未找到副官 ${targetId}` };
    }
  }
  return { ok: true, slotCap };
}

/**
 * 执行中控台参谋部管理动作（指派副官 / 解聘副官）。
 */
export function applyOperation(state: StatData, op: ConsoleOperation): ConsoleOperationResult {
  const check = canStartOperation(state, op);
  const cap = check.slotCap;
  const cmd = ensureConsoleCommandHQ(state, cap);

  switch (op.type) {
    case 'CommandAssignAdjutant': {
      const trimmedName = (op.name ?? '').trim();
      if (!trimmedName) {
        return {
          ok: false,
          error: '副官姓名不能为空',
          summary: '指派副官失败：副官姓名不能为空',
          state,
          data: state,
          next: state,
        };
      }

      const role = op.slotRole;
      const faction = op.faction
        ? normalizeFactionId(op.faction)
        : role === 'staff'
          ? 'common'
          : 'allied';
      const upkeepDaily = op.identity === 'human' ? HUMAN_ADJUTANT_DAILY_UPKEEP : 0;
      const resolvedBuff = op.buffPreset ? resolveAdjutantBuffPreset(op.buffPreset) : undefined;
      const buffPreset = op.identity === 'commander_self' ? '' : (resolvedBuff?.id ?? op.buffPreset ?? '');

      if (role === 'faction') {
        const adj: Adjutant = {
          id: `adj_faction_${faction}`,
          role: 'faction',
          faction,
          identity: op.identity,
          name: trimmedName,
          title:
            (op.title ?? '').trim() ||
            (op.identity === 'commander_self' ? '战区最高统帅兼直辖' : `${faction}阵营主责副官`),
          buff_preset: buffPreset,
          upkeep_daily: upkeepDaily,
          status: 'active',
          note: '',
        };
        const existIdx = cmd.adjutants.findIndex(
          a => a.role === 'faction' && normalizeFactionId(a.faction) === faction,
        );
        if (existIdx >= 0) {
          cmd.adjutants[existIdx] = adj;
        } else {
          cmd.adjutants.push(adj);
        }
        return {
          ok: true,
          summary: `已指派 ${trimmedName} 担任 ${faction} 阵营主责副官（身份：${op.identity}，日薪：${upkeepDaily}）`,
          state,
          data: state,
          next: state,
          adjutant: adj,
        };
      }

      const sameNameIdx = cmd.adjutants.findIndex(a => a.role === 'staff' && a.name === trimmedName);
      const currentStaffCount = cmd.adjutants.filter(a => a.role === 'staff').length;
      if (sameNameIdx < 0 && currentStaffCount >= cap) {
        return {
          ok: false,
          error: `参谋槽位已达上限（${cap}/${cap}）`,
          summary: `指派随行参谋失败：参谋槽位已达上限（${cap}/${cap}），无法增补 ${trimmedName}`,
          state,
          data: state,
          next: state,
        };
      }

      const adj: Adjutant = {
        id: `adj_staff_${trimmedName}`,
        role: 'staff',
        faction,
        identity: op.identity,
        name: trimmedName,
        title: (op.title ?? '').trim() || '联席参谋部随行参谋',
        buff_preset: buffPreset,
        upkeep_daily: upkeepDaily,
        status: 'active',
        note: '',
      };

      if (sameNameIdx >= 0) {
        cmd.adjutants[sameNameIdx] = adj;
      } else {
        cmd.adjutants.push(adj);
      }

      const nextStaffCount = cmd.adjutants.filter(a => a.role === 'staff').length;
      return {
        ok: true,
        summary: `已指派 ${trimmedName} 担任随行参谋（槽位 ${nextStaffCount}/${cap}，身份：${op.identity}，日薪：${upkeepDaily}）`,
        state,
        data: state,
        next: state,
        adjutant: adj,
      };
    }

    case 'CommandDismissAdjutant': {
      const targetId = (op.adjutantId ?? '').trim();
      const idx = cmd.adjutants.findIndex(a => a.id === targetId || a.name === targetId);
      if (idx < 0) {
        return {
          ok: false,
          error: `未找到副官 ${targetId}`,
          summary: `解聘副官失败：未找到副官「${targetId}」`,
          state,
          data: state,
          next: state,
        };
      }

      const [removed] = cmd.adjutants.splice(idx, 1);
      cmd.staff_slot_cap = cap;
      return {
        ok: true,
        summary: `已解聘副官 ${removed.name}（${removed.role === 'faction' ? '阵营主责副官' : '随行参谋'}）`,
        state,
        data: state,
        next: state,
        removed,
      };
    }
  }
}

