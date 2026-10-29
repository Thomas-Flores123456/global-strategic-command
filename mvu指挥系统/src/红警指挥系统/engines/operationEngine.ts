/**
 * operationEngine.ts —— 资金链工况硬联动引擎（EVT-OPR-01 / SIM-WEATHER-01 / DEC-CATALOG-01）
 *
 * 真源：《事件系统与资金链状态机总设计案》§6.3（CTRL-EVENT-01 接缝）＋决策 Q7；
 *       《MVP 任务包》§3.4·§6。
 *
 * 职责（Q7 选择 B：基地电力与天候直接制约链条效率，践行 SSOT）：
 * 1. 电网赤字断供与依赖建筑失能：链条依托基地（deps.base_id）净电量赤字（use > gen）或
 *    依赖建筑（deps.buildings）全部处于受损/停机/离线/被毁/缺失时，
 *    依赖设施停机停产 → 链条 eff 强制 0、状态自动转入 distressed、reason 留工况说明；
 * 2. 电网与建筑恢复：被工况钳制的链条自动恢复挂起前状态与效率——以 reason 工况
 *    标记（GRID_OUTAGE_MARKER）为复原判据，叙事性受挫链（如暴风雪封路 eff=0.5）
 *    不被电网波动误复原；
 * 3. 恶劣天候衰减：暴风雪/辐射风暴/沙尘暴/强磁暴/冻雨等仅对正向收入链乘以工况衰减系数——
 *    固定支出/维护费链（flow === '支出' 或 amount < 0）保持原额不减免；支持从 data.meta?.weather 回退读取。
 */
import { canon } from '../parse/parsePipeline';
import { setHasEquivalentBuilding } from '../core/prerequisitesHelpers';
import type { IncomeChain } from '../core/schema';
import { resolveEffectiveBaseWeather } from './timezoneWeatherEngine';

/* ═══════════════ 公共建筑工况纯函数（双 operationEngine 同源对齐） ═══════════════ */

export interface BuildingStatusLike {
  name?: string;
  state?: string | null;
  status?: string | null;
  building_state?: string | null;
  is_damaged?: boolean;
  damage_ratio?: number;
}

export const OPERATIONAL_BUILDING_STATES: ReadonlySet<string> = new Set([
  '运转',
  '正常',
  '在役',
  '运行',
  '运行中',
  'active',
  'normal',
  'online',
  'operational',
  'running',
]);

export const NON_OPERATIONAL_BUILDING_STATES: ReadonlySet<string> = new Set([
  '受损',
  '轻损',
  '重损',
  '停机',
  '离线',
  '被毁',
  '摧毁',
  '损毁',
  '瘫痪',
  '断电',
  '建造中',
  '停摆',
  'damaged',
  'broken',
  'critical',
  'offline',
  'suspended',
  'stopped',
  'destroyed',
  'disabled',
  'outage',
  'constructing',
  'building',
]);

/**
 * 判定单座建筑是否处于正常在役（可运转）状态。
 * - 同时兼容 `b.status`、`b.state`、`b.building_state` 字段；
 * - 若处于 `'受损' | '停机' | '离线' | '被毁'` 等失能态，或 `is_damaged === true` / `damage_ratio > 0`，返回 `false`；
 * - 未显式标注状态字面量时默认视为正常在役（`true`）。
 */
export function isBuildingOperational(b: BuildingStatusLike | null | undefined): boolean {
  if (!b || typeof b !== 'object') return false;
  if (b.is_damaged === true) return false;
  if (typeof b.damage_ratio === 'number' && Number.isFinite(b.damage_ratio) && b.damage_ratio > 0) {
    return false;
  }
  const rawState = b.state ?? b.status ?? b.building_state;
  if (rawState === undefined || rawState === null) return true;
  if (typeof rawState !== 'string') return false;

  const normalized = rawState.trim().toLowerCase();
  if (normalized === '') return true;
  if (NON_OPERATIONAL_BUILDING_STATES.has(normalized)) return false;
  if (OPERATIONAL_BUILDING_STATES.has(normalized)) return true;

  if (/受损|轻损|重损|停机|离线|被毁|摧毁|损毁|瘫痪|断电|建造中|停摆/.test(normalized)) {
    return false;
  }
  return false;
}

/**
 * 计算基地建筑群的综合在役健康度系数（范围 [0, 1]，空建筑列表默认返回 1）。
 */
export function computeBaseBuildingHealthFactor(
  buildings?: readonly (BuildingStatusLike | null | undefined)[] | null,
): number {
  if (!Array.isArray(buildings) || buildings.length === 0) return 1;
  const validBuildings = buildings.filter((b): b is BuildingStatusLike => Boolean(b && typeof b === 'object'));
  if (validBuildings.length === 0) return 1;

  let operationalScore = 0;
  for (const b of validBuildings) {
    if (isBuildingOperational(b)) {
      operationalScore += 1;
    }
  }
  const ratio = operationalScore / validBuildings.length;
  return Math.max(0, Math.min(1, Math.round((ratio + Number.EPSILON) * 10000) / 10000));
}

/* ═══════════════ 电网与依赖建筑工况 ═══════════════ */

/** 基地电力与建筑物理事实（Base.power + Base.buildings 的最小结构视图） */
export interface BasePowerView {
  /** 基地唯一标识（Base.id） */
  id: string;
  /** 基地显示名称（Base.name，可选；供 deps.base_id 按中文名或 canon 名匹配） */
  name?: string;
  power?: {
    gen: number;
    use: number;
  };
  /** 基地建筑列表（可选；供 deps.buildings 存在且在役校验，兼容 state / status） */
  buildings?: ReadonlyArray<BuildingStatusLike & { name: string }>;
  /** 基地驻防载具列表（可选；供 FD-51 采矿车与依赖载具核验） */
  forces?: {
    vehicles?: readonly string[];
  };
}

/** FD-51 链条物理三要素兼容扩展类型（避免并行编译时序耦合） */
type ChainPhysicalView = IncomeChain & {
  chain_kind?: '采矿精炼' | '废料回收' | '油气化工' | '本土商路' | '工业转化' | '后勤维护' | string;
  deps?: IncomeChain['deps'] & {
    vehicles?: readonly string[];
    faction?: string;
  };
};

/** 电网工况判定产物 */
export interface GridStatus {
  /** 是否断供（净赤字 use > gen，§6.3 派生判定） */
  outage: boolean;
  /** 净余电力 gen - use（<0 赤字） */
  net: number;
}

/** 单基地电网工况：net < 0 即断供（设施停工停产） */
export function gridStatusOf(base: BasePowerView): GridStatus {
  const gen = Number.isFinite(base.power?.gen) ? base.power!.gen : 0;
  const use = Number.isFinite(base.power?.use) ? base.power!.use : 0;
  const net = gen - use;
  return { outage: net < 0, net };
}

/** 工况断供展示标记；挂起身份由 distressed 状态及末尾原态后缀判定。 */
export const GRID_OUTAGE_MARKER = '电网断供';

/** 工况复原说明 */
export const GRID_RESTORE_NOTE = '电网恢复供电，链条恢复标称效率';

/** 电网钳制事件（留痕，供中控/战报展示） */
export interface GridConstraintEvent {
  id: string;
  name: string;
  kind: 'grid_outage' | 'grid_restore';
  detail: string;
}

/** 电网钳制结算产物 */
export interface GridConstraintResult {
  /** 钳制/复原后的链条（新数组；未变化元素原样引用） */
  chains: IncomeChain[];
  /** 本期触发的工况事件清单 */
  events: GridConstraintEvent[];
}

/**
 * 电网与依赖建筑硬联动（§6.3 · Q7 · SIM-WEATHER-01）：对整组链条应用断供/建筑失能钳制与恢复复原（纯函数，幂等语义）。
 * - 断供或依赖建筑失能：deps.base_id 命中断供基地，或 deps.buildings 中任一依赖建筑在基地中缺失/全部处于
 *   `'受损' | '停机' | '离线' | '被毁'` 等非正常在役态时，计息链（active/distressed）→ eff=0、distressed、
 *   reason 记录断供/依赖建筑失能原因（保留原说明拼尾便于审计回溯）；
 * - 恢复：当前 distressed 且带末尾原态后缀，基地供电与依赖建筑均恢复正常在役 → 还原挂起前状态与 eff；
 * - 已是目标形态的链条原样引用（幂等重放零 churn）。
 */
export function applyGridConstraints(input: {
  chains: readonly IncomeChain[];
  bases: readonly BasePowerView[];
  nowDay?: number;
  vehicles?: readonly string[];
  factions?: readonly { name: string; attitude: string }[];
}): GridConstraintResult {
  const baseMap = new Map<string, BasePowerView>();
  for (const b of input.bases) {
    if (b.id) {
      baseMap.set(b.id, b);
      baseMap.set(canon(b.id), b);
    }
    if (b.name) {
      baseMap.set(b.name, b);
      baseMap.set(canon(b.name), b);
    }
  }
  const chains: IncomeChain[] = [];
  const events: GridConstraintEvent[] = [];

  for (const chain of input.chains) {
    const extChain = chain as ChainPhysicalView;
    const chainKind = typeof extChain.chain_kind === 'string' ? extChain.chain_kind.trim() : '';
    const baseId = chain.deps?.base_id ?? '';
    const explicitBuildings = chain.deps?.buildings ?? [];
    // A. 采矿精炼默认建筑核验：若 chain_kind === '采矿精炼' 且未显式声明依赖建筑，默认视同需要 ['矿石精炼厂']
    const reqBuildings =
      chainKind === '采矿精炼' && explicitBuildings.length === 0 ? ['矿石精炼厂'] : explicitBuildings;
    let base = baseId !== '' ? (baseMap.get(baseId) ?? baseMap.get(canon(baseId))) : undefined;
    if (!base && reqBuildings.length > 0 && input.bases.length > 0) {
      base =
        input.bases.find(b => {
          const allBuildingNames = new Set(
            (b.buildings ?? []).filter(bd => bd && typeof bd.name === 'string').map(bd => bd.name),
          );
          return reqBuildings.some(req => setHasEquivalentBuilding(allBuildingNames, req));
        }) ?? (input.bases.length === 1 ? input.bases[0] : undefined);
    }

    const stateMatch = chain.status === 'distressed'
      ? chain.reason.match(/\[原状态:(active|distressed),eff:([0-9.]+)\]$/)
      : null;
    const constrainedByGrid = stateMatch !== null;
    const powerOutage = base !== undefined && gridStatusOf(base).outage;

    const failedBuildings: string[] = [];
    const skipEmptyBuildingsCheckOnPurePowerRestore =
      constrainedByGrid && !chain.reason.includes('依赖建筑') && (base?.buildings?.length ?? 0) === 0;
    if (
      base !== undefined &&
      base.buildings !== undefined &&
      reqBuildings.length > 0 &&
      !skipEmptyBuildingsCheckOnPurePowerRestore
    ) {
      const operationalSet = new Set(
        base.buildings
          .filter(bd => bd && typeof bd.name === 'string' && isBuildingOperational(bd))
          .map(bd => bd.name),
      );
      for (const req of reqBuildings) {
        if (!setHasEquivalentBuilding(operationalSet, req)) {
          failedBuildings.push(req);
        }
      }
    }
    const buildingOutage = failedBuildings.length > 0;

    // A. 采矿精炼与显式依赖载具核验（仅当调用方传入 input.vehicles 时启用，保持旧调用零破坏）
    const failedVehicles: string[] = [];
    if (input.vehicles !== undefined) {
      const reqVehicles = (extChain.deps?.vehicles ?? [])
        .map(v => String(v ?? '').trim())
        .filter(Boolean);
      const needCheckVehicles = reqVehicles.length > 0 || chainKind === '采矿精炼';
      if (needCheckVehicles) {
        const allVehicles = [...input.vehicles, ...(base?.forces?.vehicles ?? [])]
          .map(v => String(v ?? '').trim())
          .filter(Boolean);
        const HARVESTER_RE = /采矿车|矿车|harvester|miner/i;
        const matchesVehicleReq = (req: string): boolean => {
          const reqCanon = canon(req);
          const isHarvesterReq = HARVESTER_RE.test(req);
          return allVehicles.some(v => {
            if (isHarvesterReq && HARVESTER_RE.test(v)) return true;
            const vCanon = canon(v);
            return vCanon === reqCanon || vCanon.includes(reqCanon) || reqCanon.includes(vCanon);
          });
        };
        if (reqVehicles.length > 0) {
          for (const reqV of reqVehicles) {
            if (!matchesVehicleReq(reqV)) {
              failedVehicles.push(reqV);
            }
          }
        } else if (chainKind === '采矿精炼') {
          if (!allVehicles.some(v => HARVESTER_RE.test(v))) {
            failedVehicles.push('采矿车');
          }
        }
      }
    }
    const vehicleOutage = failedVehicles.length > 0;

    // B. 本土商路外交态度核验（仅当调用方传入 input.factions 且 chain.deps?.faction 非空时启用）
    const rawDepFaction = typeof extChain.deps?.faction === 'string' ? extChain.deps.faction.trim() : '';
    let factionHostile = false;
    if (input.factions !== undefined && rawDepFaction !== '') {
      const targetCanon = canon(rawDepFaction);
      const matchedFaction = input.factions.find(f => f && canon(f.name) === targetCanon);
      if (
        matchedFaction &&
        (canon(matchedFaction.attitude) === canon('敌意') ||
          /敌意|敌对|死敌|交战/.test(String(matchedFaction.attitude ?? '')))
      ) {
        factionHostile = true;
      }
    }

    // C. 统一挂起与自动恢复
    const inOutage = powerOutage || buildingOutage || vehicleOutage || factionHostile;

    if (inOutage) {
      // 断供、依赖建筑非运转、采矿车未就位或贸易势力敌对钳制：编码挂起前原状态与原 eff 并保留原始业务备注
      if (!constrainedByGrid && (chain.status === 'active' || chain.status === 'distressed') && chain.eff !== 0) {
        const stateSuffix = `[原状态:${chain.status},eff:${chain.eff}]`;
        let outagePrefix: string;
        if (!powerOutage && !buildingOutage && (vehicleOutage || factionHostile)) {
          const parts: string[] = [];
          if (vehicleOutage) parts.push(`依赖载具未就位(${failedVehicles.join('、')})`);
          if (factionHostile) parts.push(`贸易势力敌对断交(${rawDepFaction})`);
          outagePrefix = `因${parts.join('；')}，链条暂停运转`;
        } else if (!powerOutage && buildingOutage && !vehicleOutage && !factionHostile) {
          outagePrefix = `因基地${GRID_OUTAGE_MARKER}（依赖建筑「${failedBuildings.join('、')}」受损/停机），依赖设施停机停产`;
        } else if (powerOutage && !vehicleOutage && !factionHostile) {
          outagePrefix = `因基地${GRID_OUTAGE_MARKER}，依赖设施停机停产`;
        } else {
          const extraParts: string[] = [];
          if (buildingOutage) extraParts.push(`依赖建筑「${failedBuildings.join('、')}」受损/停机`);
          if (vehicleOutage) extraParts.push(`依赖载具未就位(${failedVehicles.join('、')})`);
          if (factionHostile) extraParts.push(`贸易势力敌对断交(${rawDepFaction})`);
          outagePrefix = `因基地${GRID_OUTAGE_MARKER}（${extraParts.join('；')}），依赖设施停机停产`;
        }
        const reason = `${outagePrefix}${chain.reason ? `（原：${chain.reason}）` : ''}${stateSuffix}`;
        chains.push({
          ...chain,
          eff: 0,
          status: 'distressed',
          reason,
          updated_at_day: input.nowDay ?? chain.updated_at_day,
        });
        events.push({ id: chain.id, name: chain.name, kind: 'grid_outage', detail: `eff→0（distressed）：${reason}` });
        continue;
      }
      chains.push(chain);
      continue;
    }

    if (constrainedByGrid) {
      // 电网与依赖建筑恢复：解析挂起后缀还原至挂起前原状态（active/distressed）与原 eff，并还原原始业务备注
      const restoredStatus: 'active' | 'distressed' =
        stateMatch[1] === 'distressed' ? 'distressed' : 'active';
      const parsedEff = Number(stateMatch[2]);
      const restoredEff =
        Number.isFinite(parsedEff) && parsedEff > 0 && parsedEff <= 1
          ? parsedEff
          : restoredStatus === 'distressed'
            ? 0.5
            : 1;
      const origMatch = chain.reason.match(/（原：([\s\S]*?)）(?:\[原状态:|$)/);
      const restoredReason = origMatch && origMatch[1] ? origMatch[1] : GRID_RESTORE_NOTE;

      if (chain.status !== restoredStatus || chain.eff !== restoredEff || chain.reason !== restoredReason) {
        chains.push({
          ...chain,
          eff: restoredEff,
          status: restoredStatus,
          reason: restoredReason,
          updated_at_day: input.nowDay ?? chain.updated_at_day,
        });
        events.push({
          id: chain.id,
          name: chain.name,
          kind: 'grid_restore',
          detail: `eff→${restoredEff}（${restoredStatus}）：${restoredReason}`,
        });
        continue;
      }
    }
    chains.push(chain);
  }
  return { chains, events };
}

/* ═══════════════ 天候衰减（结算视图，零持久化 · SIM-WEATHER-01） ═══════════════ */

/**
 * 恶劣天候衰减系数表（§6.3 / SIM-WEATHER-01：暴风雪/辐射风暴/沙尘暴/强磁暴/冻雨 → 物流与基础收入效率乘衰减系数）。
 */
export const WEATHER_DECAY_DEFAULTS: Readonly<Record<string, number>> = {
  大雾: 0.85,
  浓雾: 0.85,
  迷雾: 0.85,
  雾霾: 0.85,
  海雾: 0.85,
  fog: 0.85,
  辐射风暴: 0.5,
  暴风雪: 0.5,
  暴雪: 0.5,
  强台风: 0.5,
  台风: 0.5,
  飓风: 0.5,
  热带气旋: 0.5,
  狂风: 0.5,
  沙尘暴: 0.5,
  强磁暴: 0.5,
  磁暴: 0.5,
  冻雨: 0.5,
  暴雨: 0.5,
  雷暴: 0.5,
  酸雨: 0.5,
  radstorm: 0.5,
  blizzard: 0.5,
  typhoon: 0.5,
  hurricane: 0.5,
  sandstorm: 0.5,
  magneticstorm: 0.5,
  freezingrain: 0.5,
  storm: 0.5,
};

export interface BaseWeatherLookupLike {
  id?: string;
  name?: string;
  weather?: string;
  site_type?: string;
  location?: string;
}

export interface WeatherFallbackSource {
  weather?: string | null;
  meta?: { weather?: string | null } | null;
  bases?: ReadonlyArray<BaseWeatherLookupLike> | null;
  data?: {
    weather?: string | null;
    meta?: { weather?: string | null } | null;
    bases?: ReadonlyArray<BaseWeatherLookupLike> | null;
  } | null;
}

const canonKey = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '');

function isDecayTable(val: unknown): val is Readonly<Record<string, number>> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const obj = val as Record<string, unknown>;
  if ('meta' in obj || 'data' in obj || 'weather' in obj || 'chains' in obj || 'bases' in obj) return false;
  return Object.values(obj).some(v => typeof v === 'number');
}

function extractBasesFromSource(
  ...sources: unknown[]
): ReadonlyArray<BaseWeatherLookupLike> | undefined {
  for (const src of sources) {
    if (!src) continue;
    if (Array.isArray(src)) {
      return src as ReadonlyArray<BaseWeatherLookupLike>;
    }
    if (typeof src === 'object') {
      const s = src as WeatherFallbackSource;
      if (Array.isArray(s.bases)) return s.bases;
      if (Array.isArray(s.data?.bases)) return s.data!.bases!;
    }
  }
  return undefined;
}

function extractWeatherFromSource(
  weatherOrSource: string | WeatherFallbackSource | undefined | null,
  fallbackSource?: WeatherFallbackSource | Readonly<Record<string, number>> | null,
): string | undefined {
  if (typeof weatherOrSource === 'string' && weatherOrSource.trim() !== '') {
    return weatherOrSource.trim();
  }
  const tryObject = (src: unknown): string | undefined => {
    if (!src || typeof src !== 'object' || Array.isArray(src)) return undefined;
    const s = src as WeatherFallbackSource;
    if (typeof s.weather === 'string' && s.weather.trim() !== '') return s.weather.trim();
    if (typeof s.data?.meta?.weather === 'string' && s.data.meta.weather.trim() !== '') {
      return s.data.meta.weather.trim();
    }
    if (typeof s.meta?.weather === 'string' && s.meta.weather.trim() !== '') {
      return s.meta.weather.trim();
    }
    if (typeof s.data?.weather === 'string' && s.data.weather.trim() !== '') {
      return s.data.weather.trim();
    }
    return undefined;
  };
  return tryObject(weatherOrSource) ?? (!isDecayTable(fallbackSource) ? tryObject(fallbackSource) : undefined);
}

/** 单天候衰减系数（未登记/晴天 → 1 不衰减；系数钳制在 (0,1]） */
export function weatherDecayOf(
  weather: string | WeatherFallbackSource | undefined,
  table: Readonly<Record<string, number>> = WEATHER_DECAY_DEFAULTS,
): number {
  const resolved = extractWeatherFromSource(weather);
  if (resolved === undefined || resolved === '') return 1;
  const key = canonKey(resolved);
  let v = table[key];
  if (v === undefined && table === WEATHER_DECAY_DEFAULTS) {
    for (const [k, factor] of Object.entries(WEATHER_DECAY_DEFAULTS)) {
      if (key.includes(k)) {
        v = factor;
        break;
      }
    }
  }
  if (v === undefined) return 1;
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1;
}

export type WeatherChainLike = IncomeChain & {
  amount?: number;
  type?: string;
  is_upkeep?: boolean;
};

/**
 * 判定资金链是否为受天候折减的正向收入链：
 * - 固定支出/维护费链（`flow === '支出'`、`amount < 0`、`rate_daily < 0`、`is_upkeep === true`）返回 `false`，保持原额不减免；
 * - 正向收入链返回 `true`。
 */
export function isPositiveIncomeChain(chain: Partial<WeatherChainLike> | null | undefined): boolean {
  if (!chain || typeof chain !== 'object') return false;
  if (chain.is_upkeep === true) return false;
  if (typeof chain.flow === 'string') {
    const flowNorm = chain.flow.trim().toLowerCase();
    if (flowNorm === '支出' || flowNorm === 'expense' || flowNorm === 'outflow' || flowNorm === 'upkeep') {
      return false;
    }
  }
  if (typeof chain.type === 'string') {
    const typeNorm = chain.type.trim().toLowerCase();
    if (typeNorm === '支出' || typeNorm === 'expense' || typeNorm === 'upkeep' || typeNorm === 'maintenance') {
      return false;
    }
  }
  if (typeof chain.amount === 'number' && Number.isFinite(chain.amount)) {
    return chain.amount > 0;
  }
  if (typeof chain.rate_daily === 'number' && Number.isFinite(chain.rate_daily)) {
    return chain.rate_daily > 0;
  }
  return true;
}

export interface WithWeatherViewObjectInput<T extends Partial<WeatherChainLike> = IncomeChain>
  extends WeatherFallbackSource {
  chains: readonly T[];
  table?: Readonly<Record<string, number>>;
  bases?: ReadonlyArray<BaseWeatherLookupLike>;
}

/**
 * 天候衰减结算视图（SIM-WEATHER-01 / FD-26 D-WTH-1 局部天气优先）：
 * - 当恶劣天气（暴风雪/沙尘暴/强磁暴/冻雨/辐射风暴/大雾等）生效时，**仅对正向收入链**乘以天气折减系数；
 * - 若传入 `bases` 且某条 `chain.deps.base_id` 绑定了具体基地，优先使用该基地的 `resolveEffectiveBaseWeather(base, weather)` 计算天气乘数（实现单基地局部天气独立折减，不跨基地误伤）；
 * - 固定支出/维护费链（`flow === '支出'` 或 `amount < 0` 或 `rate_daily < 0`）保持原额不减免；
 * - 当 `weather`（或 `view.weather`）未显式传入时，支持从 `data.meta?.weather`（或 `meta?.weather`）回退读取当前天气；
 * - 非计息链（`establishing` / `broken` / `exhausted`）原样引用。
 */
export function withWeatherView<T extends Partial<WeatherChainLike> = IncomeChain>(
  chainsOrInput: readonly T[] | WithWeatherViewObjectInput<T>,
  weatherOrContext?: string | WeatherFallbackSource | ReadonlyArray<BaseWeatherLookupLike>,
  tableOrData?:
    | Readonly<Record<string, number>>
    | WeatherFallbackSource
    | ReadonlyArray<BaseWeatherLookupLike>,
  optionalTable?: Readonly<Record<string, number>> | ReadonlyArray<BaseWeatherLookupLike>,
): T[] {
  let chains: readonly T[];
  let resolvedWeather: string | undefined;
  let table: Readonly<Record<string, number>> = WEATHER_DECAY_DEFAULTS;
  let bases: ReadonlyArray<BaseWeatherLookupLike> | undefined;

  if (Array.isArray(chainsOrInput)) {
    chains = chainsOrInput;
    resolvedWeather = extractWeatherFromSource(
      Array.isArray(weatherOrContext) ? undefined : weatherOrContext,
      Array.isArray(tableOrData) ? undefined : tableOrData,
    );
    bases = extractBasesFromSource(tableOrData, weatherOrContext, optionalTable);
    if (isDecayTable(optionalTable)) {
      table = optionalTable;
    } else if (isDecayTable(tableOrData)) {
      table = tableOrData;
    }
  } else if (chainsOrInput && typeof chainsOrInput === 'object' && 'chains' in chainsOrInput) {
    const viewInput = chainsOrInput as WithWeatherViewObjectInput<T>;
    chains = Array.isArray(viewInput.chains) ? viewInput.chains : [];
    resolvedWeather = extractWeatherFromSource(
      viewInput,
      Array.isArray(weatherOrContext) ? undefined : (weatherOrContext as WeatherFallbackSource | undefined),
    );
    bases = extractBasesFromSource(viewInput, weatherOrContext, tableOrData, optionalTable);
    if (isDecayTable(viewInput.table)) {
      table = viewInput.table;
    } else if (isDecayTable(weatherOrContext)) {
      table = weatherOrContext;
    } else if (isDecayTable(tableOrData)) {
      table = tableOrData;
    }
  } else {
    return [];
  }

  const globalDecay = weatherDecayOf(resolvedWeather, table);
  const hasBases = Array.isArray(bases) && bases.length > 0;
  if (globalDecay === 1 && !hasBases) return chains as T[];

  const findBaseForChain = (baseRef: string): BaseWeatherLookupLike | undefined => {
    if (!hasBases || !baseRef) return undefined;
    const trimmed = baseRef.trim();
    if (!trimmed) return undefined;
    const cRef = canon(trimmed);
    return (
      bases!.find(b => b && (b.id === trimmed || b.name === trimmed)) ??
      bases!.find(b => b && (canon(b.id ?? '') === cRef || canon(b.name ?? '') === cRef))
    );
  };

  let anyChanged = false;
  const mapped = chains.map(chain => {
    const status = chain.status ?? 'active';
    if (status !== 'active' && status !== 'distressed') {
      return chain;
    }
    if (!isPositiveIncomeChain(chain)) {
      return chain;
    }

    let chainDecay = globalDecay;
    const baseId = chain.deps?.base_id ?? '';
    const matchedBase = findBaseForChain(baseId);
    if (matchedBase) {
      const baseWeather = resolveEffectiveBaseWeather(matchedBase, resolvedWeather);
      if (baseWeather.source === 'extraterrestrial') {
        chainDecay = 1;
      } else if (table === WEATHER_DECAY_DEFAULTS) {
        chainDecay = baseWeather.economyMultiplier;
      } else {
        chainDecay = weatherDecayOf(baseWeather.effectiveWeather, table);
      }
    }

    if (chainDecay === 1) {
      return chain;
    }

    anyChanged = true;
    const baseEff = typeof chain.eff === 'number' && Number.isFinite(chain.eff) ? chain.eff : 1;
    const next: T = {
      ...chain,
      eff: Math.max(0, Math.min(1, baseEff * chainDecay)),
    };
    if ('amount' in chain && typeof chain.amount === 'number' && chain.amount > 0) {
      (next as WeatherChainLike).amount = chain.amount * chainDecay;
    }
    return next;
  });

  return anyChanged ? mapped : (chains as T[]);
}
