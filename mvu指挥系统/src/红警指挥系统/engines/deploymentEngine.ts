/**
 * deploymentEngine.ts —— 展开/收起状态翻转事务引擎（E3a · CTRL-DEPLOY-01）
 *
 * 真源：docs/project/plans/E3-展开部署收起-设计稿.md（裁定点 D1-D8 全取推荐案）。
 * 版型母本：productionLanes.ts 模式切换事务段（requestModeSwitch / settleModeSwitches）。
 *
 * 设计裁定落地：
 * - D1：vehicles 保持 string[] 真源，不对象化；在途状态全由 pending_deployments 承载；
 * - D3：展开中载具保留在 vehicles 直至翻转（同模式切换「旧模式保持至 Δt 归零」语义）；
 * - D4：新基地电力初值经 basePowerFor 注入（catalog 定义），缺席 → {0,0}＋🟡 留痕；
 * - D6：收起耗时＝同块 deploy.duration_min（由解析层/入账层取值，引擎不另立字段）；
 * - D8：收起翻转后 buildings 空 → status='废弃'＋🟡 事件（退役不删，实体保留可审计）。
 *
 * 红线（仿 productionLanes §0.2）：
 * 1. 零 import 纯函数（不 import 保持零依赖，结构视图与 schema StatData 兼容）；
 * 2. 不原地修改入参（copy-on-write，未触达分支保留原引用）；Δt 是唯一燃料——Δt≤0 不推进；
 * 3. 引擎只消费注入回调/索引（deploy 目录、新基地电力），不直接读 catalog；
 * 4. warn/事件走结构化返回（不 console）；账本写权唯一在结算链。
 */

import {
  normalizeBaseSiteType,
  normalizeCanonicalWeather,
  parseTimezoneOffset,
} from './timezoneWeatherEngine';

/* ═══════════════ deploy 目录索引（E2 deploy 块机读形消费） ═══════════════ */

/** deploy 块机读形（E2 世界书 <数据> 块经 parser passthrough 直达；E3a 为 duration_min/reverse/capacity_ratio/deploy_limit 首个消费方） */
export interface DeployBlock {
  /** 部署目标建筑名 */
  into: string;
  capabilities?: readonly string[];
  /** 展开耗时（分钟）；收起对称复用（D6） */
  duration_min?: number;
  /** 是否可收起（false/缺席 → 收起拒收） */
  reverse?: boolean;
  /** 部署容量占比（同基地在场部署建筑合计 >1 → 满） */
  capacity_ratio?: number;
  /** 同基地同名部署建筑在场数上限 */
  deploy_limit?: number;
  /** E3c 案甲：前沿工地可建造建筑实名白名单（capabilities 含 'build.whitelist' 时生效；缺席＝不启用挂载校验，向后兼容） */
  whitelist?: readonly string[];
}

/** deploy 目录索引（纯函数注入红线：引擎/解析层只消费本接口，不直接读 catalog） */
export interface DeployCatalogIndex {
  /** 载具名 → 该车为 production 的 deploy 块 */
  byVehicle(vehicleName: string): DeployBlock | undefined;
  /** 在场建筑名 → 反查 deploy.into 命中（载具原名＋块）；多载具同名 into 取先注册者 */
  byInto(buildingName: string): { vehicle: string; block: DeployBlock } | undefined;
}

/** 归一化比对键（零依赖口径：trim＋小写；繁简归一属解析层 canon，不进本模块） */
function normKey(name: unknown): string {
  return String(name ?? '')
    .trim()
    .toLowerCase();
}

function readFinitePos(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function readFiniteNonNeg(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/* ═══════════════ MCV 名称双向等价与默认部署块兜底 ═══════════════ */

export const ALLIED_MCV_ALIASES = [
  'MCV（盟军）',
  'MCV(盟军)',
  '盟军移动基地车',
  '盟军MCV',
  '盟军基地车',
  '移动基地车',
  '基地车',
  'MCV',
] as const;

export const SOVIET_MCV_ALIASES = [
  'MCV（苏联）',
  'MCV(苏联)',
  '苏联移动基地车',
  '苏联MCV',
  '苏联基地车',
] as const;

export const YURI_MCV_ALIASES = [
  'MCV（尤里）',
  'MCV(尤里)',
  '尤里移动基地车',
  '尤里MCV',
  '尤里基地车',
] as const;

export const GENERIC_MCV_ALIASES = ['MCV', '移动基地车', '基地车'] as const;

export const DEFAULT_MCV_DEPLOY_BLOCKS: ReadonlyArray<{
  canonicalVehicle: string;
  aliases: readonly string[];
  block: DeployBlock;
}> = [
  {
    canonicalVehicle: 'MCV（盟军）',
    aliases: ALLIED_MCV_ALIASES,
    block: { into: '盟军建造厂', capabilities: ['build.conyard'], duration_min: 0, reverse: true },
  },
  {
    canonicalVehicle: 'MCV（苏联）',
    aliases: SOVIET_MCV_ALIASES,
    block: { into: '苏联建造厂', capabilities: ['build.conyard'], duration_min: 0, reverse: true },
  },
  {
    canonicalVehicle: 'MCV（尤里）',
    aliases: YURI_MCV_ALIASES,
    block: { into: '尤里建造厂', capabilities: ['build.conyard'], duration_min: 0, reverse: true },
  },
];

/**
 * 解析 MCV 载具同系别名列表：
 * - 传入特定阵营 MCV 名（如「盟军移动基地车」或「MCV（盟军）」）→ 返回该阵营全部别名 + 通用 MCV 名；
 * - 传入通用 MCV 名（「MCV」「移动基地车」「基地车」）→ 返回盟军/苏联/尤里全部 MCV 别名，便于在车队中匹配实际在账 MCV；
 * - 非 MCV 载具 → 仅返回自身名称。
 */
export function resolveMcvVehicleAliases(name: string): string[] {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return [];
  const key = normKey(trimmed);

  if (GENERIC_MCV_ALIASES.some(g => normKey(g) === key)) {
    const all = new Set<string>([
      trimmed,
      ...ALLIED_MCV_ALIASES,
      ...SOVIET_MCV_ALIASES,
      ...YURI_MCV_ALIASES,
    ]);
    return [...all];
  }

  for (const group of DEFAULT_MCV_DEPLOY_BLOCKS) {
    if (group.aliases.some(a => normKey(a) === key)) {
      const merged = new Set<string>([trimmed, ...group.aliases, ...GENERIC_MCV_ALIASES]);
      return [...merged];
    }
  }

  return [trimmed];
}

/** 在车队列表中按精确/大小写/MCV 同系别名查找实际在账载具名 */
export function findVehicleInFleet(fleet: readonly string[], queryName: string): string | undefined {
  const trimmed = String(queryName ?? '').trim();
  if (!trimmed) return undefined;
  const exact = fleet.find(v => v === trimmed);
  if (exact) return exact;
  const qKey = normKey(trimmed);
  const caseHit = fleet.find(v => normKey(v) === qKey);
  if (caseHit) return caseHit;
  const aliases = resolveMcvVehicleAliases(trimmed);
  for (const alias of aliases) {
    const aKey = normKey(alias);
    const hit = fleet.find(v => normKey(v) === aKey);
    if (hit) return hit;
  }
  return undefined;
}

const CONYARD_BUILDING_NAMES = [
  '盟军建造厂',
  '苏联建造厂',
  '尤里建造厂',
  '建造厂',
] as const;

/** 在基地建筑列表中匹配目标建筑（若传入通用「建造厂」则自动匹配基地在场的任意阵营建造厂） */
export function findDeployBuildingInBase(
  buildings: ReadonlyArray<{ name: string }>,
  queryBuilding: string,
): string | undefined {
  const trimmed = String(queryBuilding ?? '').trim();
  if (!trimmed) return undefined;
  const exact = buildings.find(b => b.name === trimmed);
  if (exact) return exact.name;
  const qKey = normKey(trimmed);
  const caseHit = buildings.find(b => normKey(b.name) === qKey);
  if (caseHit) return caseHit.name;
  if (CONYARD_BUILDING_NAMES.some(c => normKey(c) === qKey)) {
    for (const cName of CONYARD_BUILDING_NAMES) {
      const hit = buildings.find(b => normKey(b.name) === normKey(cName));
      if (hit) return hit.name;
    }
  }
  return undefined;
}

function isMcvDeployBlock(block: DeployBlock): boolean {
  return (block.capabilities ?? []).includes('build.conyard') || block.into.includes('建造厂');
}

function canonicalMcvVehicleName(vehicleName: string, intoBuilding?: string): string | undefined {
  const vKey = normKey(vehicleName);
  const intoKey = normKey(intoBuilding ?? '');
  if (intoKey === normKey('苏联建造厂') || SOVIET_MCV_ALIASES.some(a => normKey(a) === vKey)) {
    return 'MCV（苏联）';
  }
  if (intoKey === normKey('尤里建造厂') || YURI_MCV_ALIASES.some(a => normKey(a) === vKey)) {
    return 'MCV（尤里）';
  }
  if (
    intoKey === normKey('盟军建造厂') ||
    intoKey === normKey('建造厂') ||
    ALLIED_MCV_ALIASES.some(a => normKey(a) === vKey)
  ) {
    return 'MCV（盟军）';
  }
  return undefined;
}

/** 松散输入 → 合法 DeployBlock（into 非空字符串为硬条件；数值字段只收正数，MCV duration_min 归一为 0，reverse 只收布尔） */
function readDeployBlock(raw: unknown): DeployBlock | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const into = typeof r.into === 'string' ? r.into.trim() : '';
  if (!into) return undefined;
  const block: DeployBlock = { into };
  if (Array.isArray(r.capabilities))
    block.capabilities = r.capabilities.filter((c): c is string => typeof c === 'string');
  const duration = readFiniteNonNeg(r.duration_min);
  if (duration !== undefined && duration > 0) block.duration_min = duration;
  if (typeof r.reverse === 'boolean') block.reverse = r.reverse;
  const ratio = readFinitePos(r.capacity_ratio);
  if (ratio !== undefined) block.capacity_ratio = ratio;
  const limit = readFinitePos(r.deploy_limit);
  if (limit !== undefined) block.deploy_limit = limit;
  if (Array.isArray(r.whitelist)) block.whitelist = r.whitelist.filter((w): w is string => typeof w === 'string');
  if (isMcvDeployBlock(block)) {
    block.duration_min = 0;
    if (block.reverse === undefined) block.reverse = true;
  }
  return block;
}

/**
 * 从 catalog 形状（effectiveCatalog 或其子集）构建 deploy 目录索引
 * （仿 deployIndexFromCatalog 工厂先例；对缺池/缺 deploy 块/脏块容错——脏块跳过即空命中）。
 * byVehicle 同名后注册覆盖先注册（对齐 mergeByName 覆盖语义）；byInto 同名 into 先注册胜（反查歧义不静默换源）。
 * 预注册 MCV 默认映射，并将世界书 MCV 条目同步注册到同系所有别名键下，duration_min 归一为 0。
 */
export function deployBlockIndexFromCatalog(pools: {
  buildings?: ReadonlyArray<{ name: string; deploy?: unknown }>;
  productions?: ReadonlyArray<{ name: string; deploy?: unknown }>;
  retrofits?: ReadonlyArray<{ name: string; deploy?: unknown }>;
}): DeployCatalogIndex {
  const vehicleMap = new Map<string, DeployBlock>();
  const intoMap = new Map<string, { vehicle: string; block: DeployBlock }>();

  // 1. 预注册内置 MCV 默认映射
  for (const group of DEFAULT_MCV_DEPLOY_BLOCKS) {
    const defaultBlock: DeployBlock = { ...group.block };
    for (const alias of group.aliases) {
      vehicleMap.set(normKey(alias), defaultBlock);
    }
    intoMap.set(normKey(group.block.into), { vehicle: group.canonicalVehicle, block: defaultBlock });
    if (group.canonicalVehicle === 'MCV（升阳）') {
      intoMap.set(normKey('旭日建造厂'), {
        vehicle: group.canonicalVehicle,
        block: { ...defaultBlock, into: '旭日建造厂' },
      });
      intoMap.set(normKey('帝国建造厂'), {
        vehicle: group.canonicalVehicle,
        block: { ...defaultBlock, into: '帝国建造厂' },
      });
    }
  }
  intoMap.set(normKey('建造厂'), {
    vehicle: 'MCV（盟军）',
    block: { ...DEFAULT_MCV_DEPLOY_BLOCKS[0].block },
  });

  const absorb = (entries?: ReadonlyArray<{ name: string; deploy?: unknown }>) => {
    for (const e of entries ?? []) {
      const block = readDeployBlock(e.deploy);
      if (!block) continue;
      const vehicle = String(e.name ?? '').trim();
      if (!vehicle) continue;
      vehicleMap.set(normKey(vehicle), block);
      if (isMcvDeployBlock(block)) {
        const canonicalVehicle = canonicalMcvVehicleName(vehicle, block.into) ?? vehicle;
        for (const alias of resolveMcvVehicleAliases(canonicalVehicle)) {
          if (
            !GENERIC_MCV_ALIASES.some(g => normKey(g) === normKey(alias)) ||
            canonicalVehicle === 'MCV（盟军）'
          ) {
            vehicleMap.set(normKey(alias), block);
          }
        }
        const intoKey = normKey(block.into);
        intoMap.set(intoKey, { vehicle: canonicalVehicle, block });
        if (canonicalVehicle === 'MCV（盟军）') {
          intoMap.set(normKey('建造厂'), { vehicle: canonicalVehicle, block });
        } else if (canonicalVehicle === 'MCV（升阳）') {
          intoMap.set(normKey('升阳建造厂'), { vehicle: canonicalVehicle, block });
          intoMap.set(normKey('旭日建造厂'), { vehicle: canonicalVehicle, block: { ...block, into: '旭日建造厂' } });
          intoMap.set(normKey('帝国建造厂'), { vehicle: canonicalVehicle, block: { ...block, into: '帝国建造厂' } });
        }
      } else {
        const intoKey = normKey(block.into);
        if (!intoMap.has(intoKey)) intoMap.set(intoKey, { vehicle, block });
      }
    }
  };
  absorb(pools.buildings);
  absorb(pools.productions);
  absorb(pools.retrofits);
  return {
    byVehicle: name => vehicleMap.get(normKey(name)),
    byInto: name => intoMap.get(normKey(name)),
  };
}

/* ═══════════════ 在途事务与状态视图 ═══════════════ */

/** 部署指令（解析层 DeployOrder 结构兼容；duration_min 由解析层读 catalog 填入，不持久化） */
export interface DeploymentRequest {
  /** 载具名（展开＝车队在账车；收起＝反查回填的载具原名） */
  vehicle: string;
  action: '展开' | '收起';
  /** 目标基地（Base.id；当场建新基地时＝新基地名） */
  base: string;
  /** 展开＝deploy.into 建筑名；收起＝在场建筑名 */
  into: string;
  /** 仅「当场建新基地」的展开携带 */
  new_base?: {
    name: string;
    location?: string;
    tz_offset?: number;
    weather?: string;
    site_type?: string;
  };
  /** deploy.duration_min（入账时落入 remaining_minutes；缺席/0 → 首次 Δt>0 即翻转） */
  duration_min?: number;
}

export interface PendingDeployment {
  vehicle: string;
  action: '展开' | '收起';
  base: string;
  into: string;
  new_base?: {
    name: string;
    location?: string;
    tz_offset?: number;
    weather?: string;
    site_type?: string;
  };
  remaining_minutes: number;
}

/** 部署结算事件（结构化留痕，供 settleFloor 接缝转 ParseEvent；light 显式携带免类型猜测） */
export interface DeploymentEvent {
  type: 'deployment_done' | 'deployment_orphan' | 'deployment_new_base' | 'deployment_base_abandoned';
  light: '🟢' | '🟡';
  vehicle: string;
  base: string;
  into: string;
  detail: string;
}

/** 部署令拒收留痕（requestDeployment 经 warnSink 上报；只拒不入账，状态原样返回） */
export interface DeploymentWarn {
  type: 'deployment_rejected';
  reason:
    | 'mode_switch_in_flight'
    | 'no_deploy_block'
    | 'deploy_limit_full'
    | 'capacity_ratio_full'
    | 'not_reversible'
    | 'into_unknown';
  vehicle: string;
  base: string;
  into: string;
  detail: string;
}

interface BaseLike {
  id?: string;
  name?: string;
  location?: string;
  status?: string;
  tz_offset?: number;
  weather?: string;
  site_type?: string;
  power?: { gen?: number; use?: number };
  buildings?: { name: string; layer?: string; state?: string }[];
  alerts?: string[];
}

/** 本模块消费的最小状态视图（与 schema.ts StatData 结构兼容，不 import 保持零依赖） */
interface DeploymentState {
  bases?: ReadonlyArray<BaseLike>;
  forces?: { vehicles?: readonly string[] };
  pending_deployments?: ReadonlyArray<PendingDeployment>;
  /** 冲突护栏读取面（同建筑有模式切换在途 → 部署令拒收） */
  pending_mode_switches?: ReadonlyArray<{ base: string; building: string }>;
}

/** 基地定位（既有惯例引擎化：id 优先精确命中，缺席退名称唯一命中） */
function findBase(bases: ReadonlyArray<BaseLike>, ref: string): BaseLike | undefined {
  return bases.find(b => b.id === ref) ?? bases.find(b => b.name === ref);
}

/* ═══════════════ 入账（写权入口预留，仿 requestModeSwitch 版型） ═══════════════ */

/**
 * 部署指令入账（LLM <部署> 声明 / 前端调度经此进账本链）：
 * - 幂等：同 vehicle＋action＋base＋into（含 new_base 名）的在途指令重复 → 原样返回不入账；
 * - 替换：同 vehicle 的在途旧指令被新指令替换（以最新指令为准），不原地修改入参；
 * - 护栏（warnSink 上报 🟡 拒收、状态原样）：同建筑有模式切换在途；
 *   注入 deploy 索引时——展开：无 deploy 块 / deploy_limit 满 / capacity_ratio 满；
 *   收起：into 反查无源 / reverse=false。
 * remaining_minutes＝req.duration_min ?? deploy 块 duration_min ?? 0（0＝首次 Δt>0 即翻转）。
 */
export function requestDeployment<S extends DeploymentState>(
  state: S,
  req: DeploymentRequest,
  warnSink?: (warn: DeploymentWarn) => void,
  options: { deploy?: DeployCatalogIndex } = {},
): S {
  const pending = [...(state.pending_deployments ?? [])];
  const reject = (reason: DeploymentWarn['reason'], detail: string): S => {
    warnSink?.({ type: 'deployment_rejected', reason, vehicle: req.vehicle, base: req.base, into: req.into, detail });
    return state;
  };

  const base = findBase(state.bases ?? [], req.base);
  let effectiveVehicle = req.vehicle;
  let effectiveInto = req.into;

  if (req.action === '展开') {
    const fleet = state.forces?.vehicles ?? [];
    const matchedFleetVehicle = findVehicleInFleet(fleet, req.vehicle);
    if (matchedFleetVehicle) {
      effectiveVehicle = matchedFleetVehicle;
    }
  } else if (base) {
    const matchedBuilding = findDeployBuildingInBase(base.buildings ?? [], req.into);
    if (matchedBuilding) {
      effectiveInto = matchedBuilding;
    }
  }

  // 冲突护栏：同建筑有模式切换在途 → 拒收（部署/模式双在途会争同一建筑真源）
  const modeSwitch = (state.pending_mode_switches ?? []).find(
    s => s.base === req.base && s.building === effectiveInto,
  );
  if (modeSwitch) {
    return reject(
      'mode_switch_in_flight',
      `建筑「${effectiveInto}」@「${req.base}」有模式切换在途，部署令拒收（冲突护栏）`,
    );
  }

  const deploy = options.deploy;
  let duration = req.duration_min;
  if (deploy) {
    if (req.action === '展开') {
      let block = deploy.byVehicle(effectiveVehicle) ?? deploy.byVehicle(req.vehicle);
      if (!block) {
        for (const alias of resolveMcvVehicleAliases(effectiveVehicle)) {
          block = deploy.byVehicle(alias);
          if (block) break;
        }
      }
      if (!block)
        return reject('no_deploy_block', `catalog 无以「${req.vehicle}」为 production 的 deploy 块，展开令拒收`);
      duration ??= block.duration_min;
      if (!effectiveInto || (effectiveInto === '建造厂' && block.into)) {
        effectiveInto = block.into;
      }
      // 容量护栏只约束在场部署建筑（既有基地；new_base 为空基地免检）
      if (base) {
        if (block.deploy_limit !== undefined) {
          const count = (base.buildings ?? []).filter(b => normKey(b.name) === normKey(block.into)).length;
          if (count >= block.deploy_limit) {
            return reject(
              'deploy_limit_full',
              `基地「${req.base}」在场「${block.into}」已达 deploy_limit=${block.deploy_limit}，展开令拒收`,
            );
          }
        }
        if (block.capacity_ratio !== undefined) {
          let used = 0;
          for (const b of base.buildings ?? []) used += deploy.byInto(b.name)?.block.capacity_ratio ?? 0;
          if (used + block.capacity_ratio > 1) {
            return reject(
              'capacity_ratio_full',
              `基地「${req.base}」部署容量占比 ${used}+${block.capacity_ratio}>1 已满，展开令拒收`,
            );
          }
        }
      }
    } else {
      const hit = deploy.byInto(effectiveInto) ?? deploy.byInto(req.into);
      if (!hit)
        return reject('into_unknown', `建筑「${effectiveInto}」非任何载具的 deploy.into，无法反查载具，收起令拒收`);
      if (hit.block.reverse !== true) {
        return reject('not_reversible', `「${effectiveInto}」deploy.reverse=false，不支持收起，收起令拒收`);
      }
      duration ??= hit.block.duration_min;
      if (!effectiveVehicle || resolveMcvVehicleAliases(effectiveVehicle).length > 1) {
        effectiveVehicle = canonicalMcvVehicleName(hit.vehicle, effectiveInto) ?? hit.vehicle;
      }
    }
  }

  // 幂等：同参在途 → 不入账
  const identical = pending.some(
    p =>
      p.vehicle === effectiveVehicle &&
      p.action === req.action &&
      p.base === req.base &&
      p.into === effectiveInto &&
      (p.new_base?.name ?? '') === (req.new_base?.name ?? ''),
  );
  if (identical) return state;

  // 替换：同 vehicle 在途旧指令被新指令替换
  const kept = pending.filter(p => p.vehicle !== effectiveVehicle);
  const entry: PendingDeployment = {
    vehicle: effectiveVehicle,
    action: req.action,
    base: req.base,
    into: effectiveInto,
    remaining_minutes: duration ?? 0,
  };
  if (req.new_base) {
    entry.new_base = {
      name: req.new_base.name,
      location: req.new_base.location ?? '',
      ...(req.new_base.tz_offset !== undefined ? { tz_offset: req.new_base.tz_offset } : {}),
      ...(req.new_base.weather ? { weather: req.new_base.weather } : {}),
      ...(req.new_base.site_type ? { site_type: req.new_base.site_type } : {}),
    };
  }
  kept.push(entry);
  return { ...state, pending_deployments: kept };
}

/* ═══════════════ 结算（仿 settleModeSwitches 版型） ═══════════════ */

/**
 * 展开/收起结算（挂在 settleFloor 模式切换结算之后；Δt 是唯一燃料——Δt≤0 不推进）：
 * 在途条目 remaining−=Δt；到期翻转：
 * - 展开：vehicles 删 1 个该名 → 目标基地 buildings push { name: into, state: '运转' }；
 *   new_base 且基地不存在 → 先诞生 Base（id＝中文名、按名称定位合并的既有惯例引擎化；
 *   电力经 basePowerFor 注入，缺席 {0,0}＋🟡 留痕，D4）；基地已存在同名 → 合并部署不另建；
 * - 收起：buildings 删该建筑 → vehicles push 回载具原名；只收部署建筑本身，同基地其他建筑一概不动；
 *   翻转后 buildings 空 → status='废弃'＋🟡 事件（退役不删，D8）；
 * - orphan（车/基地/建筑中途消失）→ 条目出账＋🟡 留痕（不阻塞结算）；
 * - done → 🟢 事件（供接缝入 instruction 层）。
 */
export function settleDeployments<S extends DeploymentState>(
  state: S,
  deltaMinutes: number,
  options: { basePowerFor?: (into: string) => { gen: number; use: number } | undefined } = {},
): { next: S; events: DeploymentEvent[] } {
  const pending = state.pending_deployments ?? [];
  const hasImmediate = pending.some(p => (p.remaining_minutes ?? 0) <= 0);
  if (pending.length === 0 || (deltaMinutes <= 0 && !hasImmediate)) return { next: state, events: [] };

  const events: DeploymentEvent[] = [];
  const remaining: PendingDeployment[] = [];

  // copy-on-write：首次写入才克隆，未触达分支保留原引用
  let basesWork: BaseLike[] | null = null;
  const writableBases = (): BaseLike[] =>
    (basesWork ??= (state.bases ?? []).map(b => ({ ...b, buildings: [...(b.buildings ?? [])] })));
  let vehiclesWork: string[] | null = null;
  const writableVehicles = (): string[] => (vehiclesWork ??= [...(state.forces?.vehicles ?? [])]);
  const currentBases = (): ReadonlyArray<BaseLike> => basesWork ?? state.bases ?? [];
  const currentVehicles = (): readonly string[] => vehiclesWork ?? state.forces?.vehicles ?? [];

  for (const p of pending) {
    // 对于 remaining_minutes > 0 的在途条目，当 deltaMinutes <= 0 时保持原样不推进
    if (deltaMinutes <= 0 && p.remaining_minutes > 0) {
      remaining.push(p);
      continue;
    }

    const vehiclesNow = currentVehicles();
    const basesNow = currentBases();
    const base = findBase(basesNow, p.base);

    const matchedFleetVehicle = p.action === '展开' ? findVehicleInFleet(vehiclesNow, p.vehicle) : p.vehicle;
    const matchedBaseBuilding =
      p.action === '收起' && base ? findDeployBuildingInBase(base.buildings ?? [], p.into) : p.into;

    // orphan 判定（车/基地/建筑中途消失 → 出账留痕）
    if (p.action === '展开') {
      if (!matchedFleetVehicle) {
        events.push({
          type: 'deployment_orphan',
          light: '🟡',
          vehicle: p.vehicle,
          base: p.base,
          into: p.into,
          detail: `载具「${p.vehicle}」已不在车队（叙事炸车/漂移？），展开指令出账`,
        });
        continue;
      }
      if (!base && !p.new_base) {
        events.push({
          type: 'deployment_orphan',
          light: '🟡',
          vehicle: p.vehicle,
          base: p.base,
          into: p.into,
          detail: `目标基地「${p.base}」已不存在且未申报新基地，展开指令出账`,
        });
        continue;
      }
    } else {
      if (!base) {
        events.push({
          type: 'deployment_orphan',
          light: '🟡',
          vehicle: p.vehicle,
          base: p.base,
          into: p.into,
          detail: `目标基地「${p.base}」已不存在，收起指令出账`,
        });
        continue;
      }
      if (!matchedBaseBuilding) {
        events.push({
          type: 'deployment_orphan',
          light: '🟡',
          vehicle: p.vehicle,
          base: p.base,
          into: p.into,
          detail: `在场建筑「${p.into}」已不存在（@「${p.base}」），收起指令出账`,
        });
        continue;
      }
    }

    const effectiveDelta = deltaMinutes > 0 ? deltaMinutes : 0;
    const left = p.remaining_minutes - effectiveDelta;
    if (left > 0) {
      remaining.push({ ...p, remaining_minutes: left });
      continue;
    }

    // ── 翻转 ──
    if (p.action === '展开') {
      const actualVehicle = matchedFleetVehicle ?? p.vehicle;
      const fleet = writableVehicles();
      const vIdx = fleet.indexOf(actualVehicle);
      if (vIdx >= 0) fleet.splice(vIdx, 1); // 删 1 个该名（同名多辆只动 1 辆）

      let actualInto = p.into;
      if (!actualInto || actualInto === '建造厂') {
        const canonical = canonicalMcvVehicleName(actualVehicle);
        if (canonical === 'MCV（苏联）') actualInto = '苏联建造厂';
        else if (canonical === 'MCV（尤里）') actualInto = '尤里建造厂';
        else if (canonical === 'MCV（升阳）') actualInto = '升阳建造厂';
        else if (canonical === 'MCV（盟军）') actualInto = '盟军建造厂';
      }

      let target = findBase(writableBases(), p.base);
      let justCreatedNewBase = false;
      if (!target && p.new_base) {
        justCreatedNewBase = true;
        const isFirstBase = writableBases().length === 0;
        const power = options.basePowerFor?.(actualInto);
        const created: BaseLike = {
          id: p.new_base.name,
          name: p.new_base.name,
          location: p.new_base.location ?? '',
          status: '隐蔽中',
          ...(p.new_base.tz_offset !== undefined
            ? { tz_offset: isFirstBase ? 0 : parseTimezoneOffset(p.new_base.tz_offset, false) }
            : {}),
          ...(p.new_base.weather
            ? { weather: normalizeCanonicalWeather(p.new_base.weather) || p.new_base.weather }
            : {}),
          ...(p.new_base.site_type
            ? { site_type: normalizeBaseSiteType(p.new_base.site_type) || p.new_base.site_type }
            : {}),
          power: power ?? { gen: 0, use: 0 },
          buildings: [],
          alerts: [],
        };
        writableBases().push(created);
        target = created;
        events.push({
          type: 'deployment_new_base',
          light: power ? '🟢' : '🟡',
          vehicle: actualVehicle,
          base: p.base,
          into: actualInto,
          detail: power
            ? `新基地「${created.name}」已建立（电力采 catalog 定义 gen=${power.gen}/use=${power.use}，D4）`
            : `新基地「${created.name}」已建立（电力 catalog 无定义，按 {0,0} 初值＋警示，D4）`,
        });
      } else if (target && p.new_base) {
        const isFirstBase = writableBases()[0] === target;
        if (p.new_base.tz_offset !== undefined) {
          target.tz_offset = isFirstBase ? 0 : parseTimezoneOffset(p.new_base.tz_offset, false);
        }
        if (p.new_base.weather) {
          target.weather = normalizeCanonicalWeather(p.new_base.weather) || p.new_base.weather;
        }
        if (p.new_base.site_type) {
          target.site_type = normalizeBaseSiteType(p.new_base.site_type) || p.new_base.site_type;
        }
      }
      if (!target) continue; // 类型守卫（上文 orphan 已拦，理论不可达）
      const already = (target.buildings ?? []).some(b => b.name === actualInto);
      if (!already) target.buildings = [...(target.buildings ?? []), { name: actualInto, layer: '', state: '运转' }];

      // MCV 展开建造厂时：若基地处于隐蔽中、废弃或由枚举归一为警戒，自动提升为运转中；
      // 同基地多 MCV 合署展开（!already && !justCreatedNewBase）时累加基础发电量（+50W）
      if (actualInto.includes('建造厂')) {
        if (target.status === '隐蔽中' || target.status === '废弃' || target.status === '警戒') {
          target.status = '运转中';
        }
        const conyardPower = options.basePowerFor?.(actualInto);
        if (conyardPower && conyardPower.gen > 0) {
          if (!already) {
            if (!justCreatedNewBase) {
              target.power = {
                gen: (target.power?.gen ?? 0) + conyardPower.gen,
                use: (target.power?.use ?? 0) + (conyardPower.use ?? 0),
              };
            } else if ((target.power?.gen ?? 0) === 0) {
              target.power = {
                gen: conyardPower.gen,
                use: (target.power?.use ?? 0) + (conyardPower.use ?? 0),
              };
            }
          } else if (!justCreatedNewBase) {
            const conyardCount = (target.buildings ?? []).filter(
              b => b.name.includes('建造厂') && b.state !== '建造中' && b.state !== '受损' && b.state !== '停机',
            ).length;
            const minConyardGen = Math.max(1, conyardCount) * conyardPower.gen;
            if ((target.power?.gen ?? 0) < minConyardGen) {
              target.power = {
                gen: minConyardGen,
                use: (target.power?.use ?? 0) + (conyardPower.use ?? 0),
              };
            }
          }
        }
      }

      events.push({
        type: 'deployment_done',
        light: '🟢',
        vehicle: actualVehicle,
        base: p.base,
        into: actualInto,
        detail: already
          ? `展开完成：「${target.name ?? p.base}」已有在场「${actualInto}」（幂等），载具「${actualVehicle}」已离列`
          : `展开完成：载具「${actualVehicle}」于「${target.name ?? p.base}」部署为「${actualInto}」（运转）`,
      });
    } else {
      const target = findBase(writableBases(), p.base);
      if (!target) continue; // 类型守卫（orphan 已拦）
      const actualBuilding = matchedBaseBuilding ?? p.into;
      const buildings = [...(target.buildings ?? [])];
      const idx = buildings.findIndex(b => b.name === actualBuilding);
      if (idx >= 0) buildings.splice(idx, 1); // 只收部署建筑本身，同基地其他建筑一概不动
      target.buildings = buildings;

      const returnVehicle =
        resolveMcvVehicleAliases(p.vehicle).length > 1 ||
        CONYARD_BUILDING_NAMES.some(c => normKey(c) === normKey(actualBuilding))
          ? (canonicalMcvVehicleName(p.vehicle, actualBuilding) ?? p.vehicle)
          : p.vehicle;
      const fleet = writableVehicles();
      if (!fleet.includes(returnVehicle)) fleet.push(returnVehicle);
      events.push({
        type: 'deployment_done',
        light: '🟢',
        vehicle: returnVehicle,
        base: p.base,
        into: actualBuilding,
        detail: `收起完成：「${actualBuilding}」已撤收，载具「${returnVehicle}」回归车队（同基地其余建筑保留）`,
      });
      if (buildings.length === 0 && target.status !== '废弃') {
        target.status = '废弃';
        events.push({
          type: 'deployment_base_abandoned',
          light: '🟡',
          vehicle: returnVehicle,
          base: p.base,
          into: actualBuilding,
          detail: `基地「${target.name ?? p.base}」建筑已空，按退役不删铁律标记「废弃」（实体保留可审计，D8）`,
        });
      }
    }
  }

  const next: Record<string, unknown> = { ...(state as Record<string, unknown>), pending_deployments: remaining };
  if (basesWork) next.bases = basesWork;
  if (vehiclesWork) next.forces = { ...(state.forces ?? {}), vehicles: vehiclesWork };
  return { next: next as S, events };
}
