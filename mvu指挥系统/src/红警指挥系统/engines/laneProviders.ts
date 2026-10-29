/**
 * laneProviders.ts —— 三位一体工位环境提供者与组合注册中心（UTO-PROV-01）
 *
 * 真源：
 * - docs/design/systems/通用任务编排器总设计案.md（CTRL-UTO-CORE-01 §0.4 / §2 轴二）
 * - docs/project/plans/通用任务编排器MVP任务包.md（§2.2 / §3.2 / §6 UTO-PROV-01）
 * - docs/project/plans/协议玩法MVP任务包.md（§3.5.3 ProtocolLaneProvider 预留接缝）
 *
 * 设计红线（任务包总原则·账本写权与纯函数铁律）：
 * 1. 纯函数与零外部副作用：零 Pinia、零 Vue、零宿主 API、零 DOM 引用、零未受控全局变量写入；
 * 2. 零入参突变：所有推导与聚合只读消费 LaneResolveEnv 与 TransactionItem，绝不原地修改入参；
 * 3. 零破坏复用：不改动 productionLanes.ts、researchSlots.ts、engineeringSlots.ts、taskOrchestrator.ts
 *    的既有导出签名与内部公式，全部通过复用既有函数封装；
 * 4. 黄金等价铁律：对任意建造/生产/改装/研究/工程事务，LaneRegistryHub 输出的 laneKey、parallelLimit、
 *    globalLimit、accelEff 与 settleFloor.ts L521-575 三路分支计算结果 100% 逐字节相等。
 */

import {
  deployIndexFromCatalog,
  LANE_REGISTRY,
  laneBoard,
  laneCapacityInBase,
  makeAccelEffFor,
  makeProdLaneKeyFor,
  makeProdParallelLimitFor,
  prodLaneIndexFromCatalog,
  type DeployOf,
  type LaneStateView,
} from './productionLanes';
import {
  ENGINEERING_SLOT_REGISTRY,
  engSlotCapacityInBase,
  makeEngLaneKeyFor,
  makeEngParallelLimitFor,
  type EngStateView,
} from './engineeringSlots';
import {
  lineIndexFromCatalog,
  makeGlobalLimitFor,
  makeLaneKeyFor,
  makeParallelLimitFor,
  SLOT_REGISTRY,
  slotBoard,
  type LineOf,
  type SlotStateView,
} from './researchSlots';
import { SCHEDULE_COPY } from '../planning/scheduleCopy';
import { LEGACY_PROTOCOL_DEFINITIONS, resolveLegacyProtocolId, resolveLegacyProtocolName } from '../core/schema';
import type { ILaneProvider, LaneResolveEnv, LaneStationView, TaskDomain } from './taskOrchestrator';
import type { TransactionItem } from './transactionEngine';

/* ═══════════════ 公共类型与常量契约 ═══════════════ */

/** 结构化告警收集回调（兼容 settleFloor.ts 的 slotWarns 收集器签名） */
export type LaneWarnSink = (warn: { message: string }) => void;

/** 单次工位/分组键/容量推导可选参数 */
export interface LaneResolveOptions {
  /** 可选结构化 warn 收集器（兜底命中或非法显式槽位时留痕，不 console） */
  warnSink?: LaneWarnSink;
}

/** 协议推演预留流水线全局唯一 Key（对齐《协议玩法 MVP 任务包》§3.5.3 D-P27） */
export const PROTOCOL_LANE_KEY = 'theater:lane.protocol' as const;

/** 协议推演预留流水线默认显示名 */
export const PROTOCOL_LANE_DISPLAY_NAME = '最高统帅部协议推演序列' as const;

/** 事务扩展视图（兼容 QueueItem.lane 可选字段） */
type TxnWithOptionalLane = TransactionItem & { lane?: string };

/** 提取基地规范引用标识（优先非空 id，次选 name，兜底空串；与 laneBoard / engBoard 同口径） */
function resolveBaseRef(base: { id?: string; name?: string }): string {
  if (typeof base.id === 'string' && base.id.trim().length > 0) {
    return base.id;
  }
  return base.name ?? '';
}

/** 从环境快照提取有效目录的 prodLaneOf 查找回调 */
function buildProdLaneOf(env: LaneResolveEnv) {
  return prodLaneIndexFromCatalog({
    buildings: env.catalog?.buildings,
    productions: env.catalog?.productions,
    retrofits: env.catalog?.retrofits,
  });
}

/** 从环境快照提取有效目录的 E2b 通道B deployOf 能力面回调 */
function buildDeployOf(env: LaneResolveEnv): DeployOf {
  return deployIndexFromCatalog({
    buildings: env.catalog?.buildings,
    productions: env.catalog?.productions,
    retrofits: env.catalog?.retrofits,
  });
}

/** 从环境快照提取有效目录的科研 lineOf 查找回调 */
function buildResearchLineOf(env: LaneResolveEnv): LineOf {
  return lineIndexFromCatalog(env.catalog?.researches ?? []);
}

/** 从环境快照构造 productionLanes 最小状态视图（只读引用，零拷贝修改） */
function toProdStateView(env: LaneResolveEnv): LaneStateView {
  return {
    bases: env.bases,
    queues: env.queues,
  };
}

/** 从环境快照构造 researchSlots 最小状态视图 */
function toSlotStateView(env: LaneResolveEnv): SlotStateView {
  return {
    bases: env.bases,
    queues: env.queues,
  };
}

/** 从环境快照构造 engineeringSlots 最小状态视图 */
function toEngStateView(env: LaneResolveEnv): EngStateView {
  return {
    bases: env.bases,
    queues: env.queues,
  };
}

/* ═══════════════ 1. ProductionLaneProvider（九大制造/建造/改装产线） ═══════════════ */

export interface ProductionLaneProviderOptions {
  warnSink?: LaneWarnSink;
}

/**
 * 制造产线工位提供者（domain: 'production'，同时服务 'construction' | 'production' | 'retrofit' 常规队列事务）。
 *
 * 内部直接复用 productionLanes.ts 的 LANE_REGISTRY、prodLaneIndexFromCatalog、deployIndexFromCatalog、
 * laneBoard、laneCapacityInBase、makeProdLaneKeyFor、makeProdParallelLimitFor 与 makeAccelEffFor：
 * - 生产模式对口建筑数（含 E2b 通道B 展开车能力面）＝ 产线 capacity；
 * - 加速模式对口建筑提供递减加速比（基准 1.0，最高 2.50x）＝ accelMultiplier；
 * - 全切加速模式或锚定建筑不在场时 capacity=0, locked=true。
 */
export class ProductionLaneProvider implements ILaneProvider {
  readonly domain: TaskDomain = 'production';
  private readonly defaultWarnSink?: LaneWarnSink;

  constructor(options: ProductionLaneProviderOptions = {}) {
    this.defaultWarnSink = options.warnSink;
  }

  resolveLanes(env: LaneResolveEnv): LaneStationView[] {
    const prodState = toProdStateView(env);
    const prodLaneOf = buildProdLaneOf(env);
    const deployOf = buildDeployOf(env);
    const accelEffFor = makeAccelEffFor(prodState, prodLaneOf);
    const prodKeyFor = makeProdLaneKeyFor(prodLaneOf);

    // 调用 laneBoard 获取活动产线派生视图，与 LANE_REGISTRY 逐基地九线对齐
    const board = laneBoard(prodState, prodLaneOf, undefined, { deployOf });
    const boardByKey = new Map(board.map(entry => [`${entry.base} ${entry.laneId}`, entry] as const));

    const views: LaneStationView[] = [];
    for (const base of env.bases ?? []) {
      const baseRef = resolveBaseRef(base);
      for (const lane of LANE_REGISTRY) {
        const rawCap =
          lane.laneId === 'lane.default'
            ? 1
            : (laneCapacityInBase(prodState, baseRef, lane, deployOf) ??
              boardByKey.get(`${baseRef} ${lane.laneId}`)?.capacity ??
              0);
        const capacity = Math.max(0, rawCap);
        const locked = capacity <= 0;
        const syntheticTxn = { type: '生产', item: '', base: baseRef, lane: lane.laneId };
        const laneKey = lane.laneId === 'lane.default' ? `${baseRef} ${lane.laneId}` : prodKeyFor(syntheticTxn);
        const accelMultiplier = accelEffFor(syntheticTxn);

        views.push({
          laneKey,
          domain: this.domain,
          displayName: lane.name,
          baseId: baseRef,
          capacity,
          globalLimit: Infinity,
          accelMultiplier,
          locked,
          lockedReason: locked ? SCHEDULE_COPY.lockedReason(lane.anchor) : undefined,
        });
      }
    }
    return views;
  }

  resolveTaskLaneKey(txn: TransactionItem, env: LaneResolveEnv, opts?: LaneResolveOptions): string {
    const prodLaneOf = buildProdLaneOf(env);
    const warnSink = opts?.warnSink ?? this.defaultWarnSink;
    return makeProdLaneKeyFor(prodLaneOf, warnSink)(txn as TxnWithOptionalLane);
  }

  resolveParallelLimit(txn: TransactionItem, env: LaneResolveEnv, opts?: LaneResolveOptions): number {
    const prodState = toProdStateView(env);
    const prodLaneOf = buildProdLaneOf(env);
    const deployOf = buildDeployOf(env);
    const warnSink = opts?.warnSink ?? this.defaultWarnSink;
    return makeProdParallelLimitFor(prodState, prodLaneOf, { warnSink, deployOf })(txn as TxnWithOptionalLane);
  }

  resolveAccelEff(txn: TransactionItem, env: LaneResolveEnv): number {
    const prodState = toProdStateView(env);
    const prodLaneOf = buildProdLaneOf(env);
    return makeAccelEffFor(prodState, prodLaneOf)(txn as TxnWithOptionalLane);
  }
}

/* ═══════════════ 2. ResearchLaneProvider（11 大科研序列） ═══════════════ */

export interface ResearchLaneProviderOptions {
  warnSink?: LaneWarnSink;
}

/**
 * 科研序列工位提供者（domain: 'research'）。
 *
 * 内部直接复用 researchSlots.ts 的 SLOT_REGISTRY（11 槽）、lineIndexFromCatalog、
 * slotBoard、makeLaneKeyFor、makeParallelLimitFor 与 makeGlobalLimitFor（含 techTier T1=2/T2=4/T3=∞）：
 * - 全域序列 baseId 恒为 undefined；
 * - 锚定建筑（或 E2b 通道B research 能力面）在场时 unlocked=true, capacity=1, locked=false；
 * - 未开通时 capacity=0, locked=true, lockedReason 复用 SCHEDULE_COPY.lockedReason(slot.anchor)。
 */
export class ResearchLaneProvider implements ILaneProvider {
  readonly domain: TaskDomain = 'research';
  private readonly defaultWarnSink?: LaneWarnSink;

  constructor(options: ResearchLaneProviderOptions = {}) {
    this.defaultWarnSink = options.warnSink;
  }

  resolveLanes(env: LaneResolveEnv): LaneStationView[] {
    const slotView = toSlotStateView(env);
    const lineOf = buildResearchLineOf(env);
    const deployOf = buildDeployOf(env);
    const board = slotBoard(slotView, lineOf, undefined, { deployOf });
    const unlockedBySlot = new Map(board.map(entry => [entry.slotId, entry.unlocked] as const));
    const globalLimit = makeGlobalLimitFor(slotView)('研究');

    return SLOT_REGISTRY.map(slot => {
      const unlocked = unlockedBySlot.get(slot.slotId) ?? false;
      const capacity = unlocked ? slot.capacity : 0;
      const locked = !unlocked;
      return {
        laneKey: `research:${slot.slotId}`,
        domain: this.domain,
        displayName: slot.name,
        baseId: undefined,
        capacity,
        globalLimit,
        accelMultiplier: 1.0,
        locked,
        lockedReason: locked ? SCHEDULE_COPY.lockedReason(slot.anchor) : undefined,
      };
    });
  }

  resolveTaskLaneKey(txn: TransactionItem, env: LaneResolveEnv, opts?: LaneResolveOptions): string {
    const lineOf = buildResearchLineOf(env);
    const warnSink = opts?.warnSink ?? this.defaultWarnSink;
    return makeLaneKeyFor(lineOf, warnSink)(txn);
  }

  resolveParallelLimit(txn: TransactionItem, env: LaneResolveEnv, opts?: LaneResolveOptions): number {
    const slotView = toSlotStateView(env);
    const lineOf = buildResearchLineOf(env);
    const deployOf = buildDeployOf(env);
    const warnSink = opts?.warnSink ?? this.defaultWarnSink;
    return makeParallelLimitFor(slotView, lineOf, { warnSink, deployOf })(txn);
  }

  resolveGlobalLimit(env: LaneResolveEnv): number {
    const slotView = toSlotStateView(env);
    return makeGlobalLimitFor(slotView)('研究');
  }
}

/* ═══════════════ 3. EngineeringLaneProvider（属地工程改装与巨构泊位） ═══════════════ */

export interface EngineeringLaneProviderOptions {
  warnSink?: LaneWarnSink;
}

/**
 * 工程槽工位提供者（domain: 'retrofit'，覆盖 V1 阶段化改装工程与 V2 megastructure 仓段化工程槽）。
 *
 * 内部直接复用 engineeringSlots.ts 的 ENGINEERING_SLOT_REGISTRY（eng.main / eng.orbital）、
 * engSlotCapacityInBase、makeEngLaneKeyFor 与 makeEngParallelLimitFor：
 * - 按各基地在场锚定建筑（含 E2b 通道B engineer 能力面）计算属地工程槽 capacity；
 * - accelMultiplier 恒为 1.0，locked = capacity <= 0。
 */
export class EngineeringLaneProvider implements ILaneProvider {
  readonly domain: TaskDomain = 'retrofit';
  private readonly defaultWarnSink?: LaneWarnSink;

  constructor(options: EngineeringLaneProviderOptions = {}) {
    this.defaultWarnSink = options.warnSink;
  }

  resolveLanes(env: LaneResolveEnv): LaneStationView[] {
    const engState = toEngStateView(env);
    const deployOf = buildDeployOf(env);
    const engKeyFor = makeEngLaneKeyFor();

    const views: LaneStationView[] = [];
    for (const base of env.bases ?? []) {
      const baseRef = resolveBaseRef(base);
      for (const slot of ENGINEERING_SLOT_REGISTRY) {
        const capacity = Math.max(0, engSlotCapacityInBase(engState, baseRef, slot, deployOf) ?? 0);
        const locked = capacity <= 0;
        const laneKey = engKeyFor({
          type: '工程',
          item: '',
          base: baseRef,
          lane: `eng:${slot.slotId}`,
        });

        views.push({
          laneKey,
          domain: this.domain,
          displayName: slot.name,
          baseId: baseRef,
          capacity,
          globalLimit: Infinity,
          accelMultiplier: 1.0,
          locked,
          lockedReason: locked ? SCHEDULE_COPY.lockedReason(slot.anchor) : undefined,
        });
      }
    }
    return views;
  }

  resolveTaskLaneKey(txn: TransactionItem, _env: LaneResolveEnv, opts?: LaneResolveOptions): string {
    const warnSink = opts?.warnSink ?? this.defaultWarnSink;
    return makeEngLaneKeyFor(warnSink)(txn as TxnWithOptionalLane);
  }

  resolveParallelLimit(txn: TransactionItem, env: LaneResolveEnv, opts?: LaneResolveOptions): number {
    const engState = toEngStateView(env);
    const deployOf = buildDeployOf(env);
    const warnSink = opts?.warnSink ?? this.defaultWarnSink;
    return makeEngParallelLimitFor(engState, { warnSink, deployOf })(txn as TxnWithOptionalLane);
  }
}

/* ═══════════════ 4. ProtocolLaneProvider（协议自动实验排程与泳道投影 · D-P27 / UTO-LANE-01） ═══════════════ */

/** 协议攻关泳道单项输入形状（兼容 ProtocolInstance 与轻量协议测试夹具） */
export interface ProtocolLaneInputItem {
  ref?: string;
  id?: string;
  name?: string;
  track?: string;
  faction?: string;
  tier?: 1 | 2 | 3 | number;
  status?: string;
  attempts?: number;
  exp?: number;
  auto_queued?: boolean;
  queue_order?: number;
  hold?: boolean;
  next_prob_pct?: number;
  last_result?: {
    next_prob?: number;
    exp_after?: number;
    attempt?: number;
    outcome?: string;
  } | null;
}

/** 协议静态目录轻量对齐接口 */
export interface ProtocolLaneCatalogItemLike {
  id?: string;
  name?: string;
  track?: string;
  faction?: string;
  tier?: 1 | 2 | 3 | number;
}

/** 协议攻关泳道投影行视图（UTO-LANE-01） */
export interface ProtocolLaneItemView {
  /** 协议权威引用 ID */
  ref: string;
  /** 协议显示名 */
  name: string;
  /** 协议所属轨道/分科 */
  track: string;
  /** 所属阵营 */
  faction?: string;
  /** 协议阶位（1 / 2 / 3） */
  tier: 1 | 2 | 3;
  /** 当前状态（experimenting / available / locked 等） */
  status: string;
  /** 已开展实验轮次 */
  attempts: number;
  /** 当前协议定型经验（0 ~ 100） */
  exp: number;
  /** 下次实验突破率百分比（0 ~ 100） */
  next_prob_pct: number;
  /** 是否启用自动排程 */
  auto_queued: boolean;
  /** 排程顺位（1-based） */
  queue_order: number;
  /** 暂缓状态 */
  hold: boolean;
  /** 所属流水线 Key */
  laneKey: string;
}

const PROTOCOL_STEP_PROBS_BY_TIER: Readonly<Record<1 | 2 | 3, readonly number[]>> = {
  1: [55, 85, 100],
  2: [35, 65, 90, 100],
  3: [15, 35, 65, 90, 100],
};

function computeProtocolNextProbPct(tier: 1 | 2 | 3, attempts: number): number {
  const steps = PROTOCOL_STEP_PROBS_BY_TIER[tier] ?? PROTOCOL_STEP_PROBS_BY_TIER[1];
  const idx = Math.min(Math.max(0, Math.floor(attempts)), steps.length - 1);
  return steps[idx];
}

export interface ProtocolLaneProviderOptions {
  /** 协议序列显示名（缺省为 PROTOCOL_LANE_DISPLAY_NAME） */
  displayName?: string;
  /** 额定并发容量（缺省 1） */
  capacity?: number;
  /** 全局并发上限（缺省 Infinity） */
  globalLimit?: number;
  /** 推进加速倍率（缺省 1.0） */
  accelMultiplier?: number;
  /** 是否处于锁定态（缺省 false） */
  locked?: boolean;
  /** 锁定原因文案（locked=true 时生效） */
  lockedReason?: string;
  /** 动态环境裁决器（供 PRT-SLOT-01 接入实验室在场判定，缺省走静态配置） */
  resolveState?: (env: LaneResolveEnv) => {
    capacity?: number;
    locked?: boolean;
    lockedReason?: string;
    accelMultiplier?: number;
  };
}

/**
 * 协议自动实验排程提供者（domain: 'protocol', laneKey: 'theater:lane.protocol'）。
 * 对齐《协议玩法 MVP 任务包》§3.5.3 与 UTO-LANE-01，支持投影处于 experimenting 或 auto_queued: true 的协议项。
 */
export class ProtocolLaneProvider implements ILaneProvider {
  readonly domain: TaskDomain = 'protocol';
  private readonly options: ProtocolLaneProviderOptions;

  constructor(options: ProtocolLaneProviderOptions = {}) {
    this.options = { ...options };
  }

  resolveLanes(env: LaneResolveEnv): LaneStationView[] {
    const dynamic = this.options.resolveState?.(env);
    const rawCapacity = dynamic?.capacity ?? this.options.capacity ?? 1;
    const locked = dynamic?.locked ?? this.options.locked ?? rawCapacity <= 0;
    const capacity = locked ? 0 : Math.max(0, rawCapacity);
    const accelMultiplier = dynamic?.accelMultiplier ?? this.options.accelMultiplier ?? 1.0;
    const lockedReason = locked
      ? (dynamic?.lockedReason ?? this.options.lockedReason ?? SCHEDULE_COPY.lockedReason('对口科研实验设计局'))
      : undefined;

    return [
      {
        laneKey: PROTOCOL_LANE_KEY,
        domain: this.domain,
        displayName: this.options.displayName ?? PROTOCOL_LANE_DISPLAY_NAME,
        baseId: undefined,
        capacity,
        globalLimit: this.options.globalLimit ?? Infinity,
        accelMultiplier,
        locked,
        lockedReason,
      },
    ];
  }

  resolveTaskLaneKey(_txn: TransactionItem, _env: LaneResolveEnv): string {
    return PROTOCOL_LANE_KEY;
  }

  resolveParallelLimit(_txn: TransactionItem, env: LaneResolveEnv): number {
    const [lane] = this.resolveLanes(env);
    return lane ? lane.capacity : 1;
  }

  /**
   * 投影处于 experimenting 或 auto_queued: true 的协议项（UTO-LANE-01）：
   * 输出当前经验 exp、下次突破率 next_prob_pct、排程顺位 queue_order 与 hold 状态。
   */
  projectProtocols(
    protocols: ReadonlyArray<ProtocolLaneInputItem> | null | undefined,
    catalogProtocols?: ReadonlyArray<ProtocolLaneCatalogItemLike> | null,
  ): ProtocolLaneItemView[] {
    if (!Array.isArray(protocols) || protocols.length === 0) return [];

    const filtered = protocols
      .map((inst, index) => ({ inst, index }))
      .filter(
        ({ inst }) =>
          Boolean(inst) &&
          typeof inst === 'object' &&
          inst.status !== 'active' &&
          inst.status !== 'voided' &&
          (inst.status === 'experimenting' || inst.auto_queued === true),
      )
      .sort((a, b) => {
        const orderA =
          typeof a.inst.queue_order === 'number' && Number.isFinite(a.inst.queue_order)
            ? a.inst.queue_order
            : Number.MAX_SAFE_INTEGER;
        const orderB =
          typeof b.inst.queue_order === 'number' && Number.isFinite(b.inst.queue_order)
            ? b.inst.queue_order
            : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return a.index - b.index;
      });

    return filtered.map(({ inst }, idx) => {
      const rawRef = String(inst.ref ?? inst.id ?? inst.name ?? '').trim();
      const canonicalRef = resolveLegacyProtocolId(rawRef) ?? rawRef;
      const catalogDef = catalogProtocols?.find(item => {
        const itemKey = String(item.id ?? item.name ?? '').trim();
        const canonicalItem = resolveLegacyProtocolId(itemKey) ?? itemKey;
        return canonicalItem === canonicalRef || item.id === rawRef || item.name === rawRef;
      });
      const legacyDef = LEGACY_PROTOCOL_DEFINITIONS.find(leg => leg.id === canonicalRef || leg.name === rawRef);

      const explicitName = typeof inst.name === 'string' ? inst.name.trim() : '';
      const name =
        explicitName ||
        catalogDef?.name?.trim() ||
        legacyDef?.name ||
        resolveLegacyProtocolName(canonicalRef) ||
        resolveLegacyProtocolName(rawRef) ||
        rawRef ||
        '未命名协议';

      const explicitFaction = typeof inst.faction === 'string' ? inst.faction.trim() : '';
      const faction =
        explicitFaction ||
        catalogDef?.faction ||
        legacyDef?.faction ||
        (canonicalRef.startsWith('sov.') ? '苏联' : canonicalRef.startsWith('all.') ? '盟军' : undefined);

      const rawTier = inst.tier ?? catalogDef?.tier ?? legacyDef?.tier ?? 1;
      const tier: 1 | 2 | 3 = rawTier === 3 || rawTier === '3' ? 3 : rawTier === 2 || rawTier === '2' ? 2 : 1;

      const explicitTrack = typeof inst.track === 'string' ? inst.track.trim() : '';
      const catalogTrack = typeof catalogDef?.track === 'string' ? catalogDef.track.trim() : '';
      const track = explicitTrack || catalogTrack || (faction ? `${faction}·T${tier}` : `T${tier}`);

      const attempts =
        typeof inst.attempts === 'number' && Number.isFinite(inst.attempts) ? Math.max(0, Math.floor(inst.attempts)) : 0;
      const exp =
        typeof inst.exp === 'number' && Number.isFinite(inst.exp)
          ? Math.min(100, Math.max(0, Math.round(inst.exp)))
          : 0;

      const next_prob_pct =
        typeof inst.next_prob_pct === 'number' && Number.isFinite(inst.next_prob_pct)
          ? Math.min(100, Math.max(0, Math.round(inst.next_prob_pct)))
          : typeof inst.last_result?.next_prob === 'number' &&
              Number.isFinite(inst.last_result.next_prob) &&
              inst.last_result.next_prob > 0
            ? Math.min(100, Math.max(0, Math.round(inst.last_result.next_prob)))
            : computeProtocolNextProbPct(tier, attempts);

      const auto_queued = Boolean(inst.auto_queued);
      const queue_order =
        typeof inst.queue_order === 'number' && Number.isFinite(inst.queue_order)
          ? Math.max(1, Math.floor(inst.queue_order))
          : idx + 1;
      const hold = Boolean(inst.hold);
      const status =
        typeof inst.status === 'string' && inst.status.trim().length > 0
          ? inst.status.trim()
          : auto_queued
            ? 'available'
            : 'experimenting';

      return {
        ref: canonicalRef || rawRef || name,
        name,
        track,
        faction,
        tier,
        status,
        attempts,
        exp,
        next_prob_pct,
        auto_queued,
        queue_order,
        hold,
        laneKey: PROTOCOL_LANE_KEY,
      };
    });
  }
}

/* ═══════════════ 5. LaneRegistryHub（组合注册中心） ═══════════════ */

export interface LaneRegistryHubOptions {
  /** 默认全局 warnSink（单次调用未传 opts.warnSink 时生效） */
  warnSink?: LaneWarnSink;
  /** 是否默认挂载预留的 ProtocolLaneProvider（缺省 false，保持三大主干产线纯净） */
  includeProtocol?: boolean | ProtocolLaneProviderOptions;
  /** 额外挂载的自定义 Provider 列表 */
  extraProviders?: readonly ILaneProvider[];
}

/**
 * 流水线工位组合注册中心（LaneRegistryHub）。
 *
 * 默认内置三大主干提供者：
 * 1. ProductionLaneProvider（建造 / 生产 / 改装常规队列项）
 * 2. ResearchLaneProvider（11 科研序列与 techTier 全局门）
 * 3. EngineeringLaneProvider（V1 改装工程与 V2 仓段巨构工程槽）
 * 并支持按需挂载 ProtocolLaneProvider 或自定义 ILaneProvider。
 *
 * 黄金等价保证：
 * - resolveLaneKeyForTxn(txn, env, opts) 100% 逐字节等价于 settleFloor.ts L570-571
 * - resolveParallelLimitForTxn(txn, env, opts) 100% 逐字节等价于 settleFloor.ts L572-573
 * - resolveGlobalLimitForType(type, env) 100% 逐字节等价于 settleFloor.ts L574
 * - resolveAccelEffForTxn(txn, env) 100% 逐字节等价于 settleFloor.ts L549
 */
export class LaneRegistryHub {
  private readonly productionProvider: ProductionLaneProvider;
  private readonly researchProvider: ResearchLaneProvider;
  private readonly engineeringProvider: EngineeringLaneProvider;
  private readonly providers: ILaneProvider[];
  private readonly defaultWarnSink?: LaneWarnSink;

  constructor(options: LaneRegistryHubOptions = {}) {
    this.defaultWarnSink = options.warnSink;
    this.productionProvider = new ProductionLaneProvider({ warnSink: options.warnSink });
    this.researchProvider = new ResearchLaneProvider({ warnSink: options.warnSink });
    this.engineeringProvider = new EngineeringLaneProvider({ warnSink: options.warnSink });

    this.providers = [this.productionProvider, this.researchProvider, this.engineeringProvider];

    if (options.includeProtocol) {
      const protoOpts = typeof options.includeProtocol === 'object' ? options.includeProtocol : {};
      this.providers.push(new ProtocolLaneProvider(protoOpts));
    }

    if (options.extraProviders) {
      for (const p of options.extraProviders) {
        this.registerProvider(p);
      }
    }
  }

  /** 注册或替换指定领域的工位提供者 */
  registerProvider(provider: ILaneProvider): this {
    const idx = this.providers.findIndex(p => p.domain === provider.domain);
    if (idx >= 0) {
      this.providers[idx] = provider;
    } else {
      this.providers.push(provider);
    }
    return this;
  }

  /** 获取当前已注册的全部提供者（只读浅拷贝） */
  getProviders(): readonly ILaneProvider[] {
    return [...this.providers];
  }

  /** 按领域获取已注册的提供者 */
  getProvider(domain: TaskDomain): ILaneProvider | undefined {
    return this.providers.find(p => p.domain === domain);
  }

  /** 聚合输出当前环境下所有已注册提供者的流水线工位快照 */
  resolveAllLanes(env: LaneResolveEnv): LaneStationView[] {
    return this.providers.flatMap(provider => provider.resolveLanes(env));
  }

  /**
   * 推导事务的目标流水线 Key（黄金等价 settleFloor.ts L570-571）：
   * - '研究' → ResearchLaneProvider（makeLaneKeyFor）
   * - '工程' → EngineeringLaneProvider（makeEngLaneKeyFor）
   * - '协议'（且已挂载 protocol provider）→ ProtocolLaneProvider
   * - 其余（'建造' | '生产' | '改装' 等）→ ProductionLaneProvider（makeProdLaneKeyFor）
   */
  resolveLaneKeyForTxn(txn: TransactionItem, env: LaneResolveEnv, opts?: LaneResolveOptions): string {
    const effectiveOpts: LaneResolveOptions = {
      warnSink: opts?.warnSink ?? this.defaultWarnSink,
    };
    if (txn.type === '研究') {
      const custom = this.getProvider('research');
      if (custom && custom !== this.researchProvider) {
        return custom.resolveTaskLaneKey(txn, env);
      }
      return this.researchProvider.resolveTaskLaneKey(txn, env, effectiveOpts);
    }
    if (txn.type === '工程') {
      const custom = this.getProvider('retrofit');
      if (custom && custom !== this.engineeringProvider) {
        return custom.resolveTaskLaneKey(txn, env);
      }
      return this.engineeringProvider.resolveTaskLaneKey(txn, env, effectiveOpts);
    }
    if (txn.type === '协议') {
      const proto = this.getProvider('protocol');
      if (proto) {
        return proto.resolveTaskLaneKey(txn, env);
      }
    }
    const customProd = this.getProvider('production');
    if (customProd && customProd !== this.productionProvider) {
      return customProd.resolveTaskLaneKey(txn, env);
    }
    return this.productionProvider.resolveTaskLaneKey(txn, env, effectiveOpts);
  }

  /**
   * 推导事务所在流水线的局部并行上限（黄金等价 settleFloor.ts L572-573）：
   * - '研究' → ResearchLaneProvider（makeParallelLimitFor，含 E2b deployOf）
   * - '工程' → EngineeringLaneProvider（makeEngParallelLimitFor，含 E2b deployOf）
   * - '协议'（且已挂载 protocol provider）→ 协议工位 capacity
   * - 其余（'建造' | '生产' | '改装' 等）→ ProductionLaneProvider（makeProdParallelLimitFor，含 E2b deployOf）
   */
  resolveParallelLimitForTxn(txn: TransactionItem, env: LaneResolveEnv, opts?: LaneResolveOptions): number {
    const effectiveOpts: LaneResolveOptions = {
      warnSink: opts?.warnSink ?? this.defaultWarnSink,
    };
    if (txn.type === '研究') {
      return this.researchProvider.resolveParallelLimit(txn, env, effectiveOpts);
    }
    if (txn.type === '工程') {
      return this.engineeringProvider.resolveParallelLimit(txn, env, effectiveOpts);
    }
    if (txn.type === '协议') {
      const proto = this.getProvider('protocol');
      if (proto instanceof ProtocolLaneProvider) {
        return proto.resolveParallelLimit(txn, env);
      }
      if (proto) {
        const lanes = proto.resolveLanes(env);
        return lanes[0]?.capacity ?? 1;
      }
    }
    return this.productionProvider.resolveParallelLimit(txn, env, effectiveOpts);
  }

  /**
   * 推导事务类型的全局并行上限（黄金等价 settleFloor.ts L574 makeGlobalLimitFor）：
   * - '研究' → T1=2 / T2=4 / T3=Infinity
   * - 其余类型 → Infinity
   */
  resolveGlobalLimitForType(type: string, env: LaneResolveEnv): number {
    const slotView = toSlotStateView(env);
    return makeGlobalLimitFor(slotView)(type);
  }

  /**
   * 推导事务的双模加速倍率（黄金等价 settleFloor.ts L549 makeAccelEffFor）：
   * - 双模适用制造/建造产线 → 1.0 ~ 2.50x（递减表）
   * - 非双模产线 / 研究 / 工程 → 1
   */
  resolveAccelEffForTxn(txn: TransactionItem, env: LaneResolveEnv): number {
    if (txn.type === '协议') {
      const proto = this.getProvider('protocol');
      if (proto) {
        const lanes = proto.resolveLanes(env);
        return lanes[0]?.accelMultiplier ?? 1;
      }
    }
    return this.productionProvider.resolveAccelEff(txn, env);
  }
}

/** 创建标准流水线工位注册中心实例（工厂函数） */
export function createLaneRegistryHub(options: LaneRegistryHubOptions = {}): LaneRegistryHub {
  return new LaneRegistryHub(options);
}
