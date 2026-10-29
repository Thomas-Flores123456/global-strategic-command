/**
 * engineeringSlots.ts —— 工程槽注册表与裁决器（ENG-SLOT-01）
 *
 * 真源：docs/project/plans/工程玩法MVP任务包.md §3.2（工程槽注册表契约）/§3.3（阶段→queue 投影契约）；
 *       docs/project/plans/工程玩法-脑暴决策记录-2026-10-10.md §2 的 D5-B（第三套注册表，与 11 槽研究、
 *       9 线产线平级）、D10-A（无全局 tier 门，容量=该基地锚定建筑数）、D21（长期工程各阶段投影带各自
 *       base，占用属地基地工程槽容量）。
 *
 * 设计红线（对齐 researchSlots/productionLanes 版型）：
 * 1. 槽位占用完全派生自 queues（type==='工程' && status==='active'），不新增任何 stat_data 字段；
 * 2. 本模块是喂给 transactionEngine SettleOptions 的一组纯回调工厂，不是引擎的新分支；
 *    分流接缝在 settleFloor/scheduleText 的组合回调处（'研究'→researchSlots／'工程'→本模块／
 *    其余→productionLanes），三套注册表互不复用（D5-B 拒绝 D5-A lane.project 扩展与 D5-C 全走 lane.equipment）；
 * 3. 纯函数：零 Pinia、零 Vue、零宿主 API；不原地修改入参；warn 走结构化返回/收集器，不 console；
 * 4. 投影契约（§3.3）：投影项 QueueItem.lane 显式指定 `eng:<slotId>`（兼容裸 slotId 写法），
 *    经本模块 engSlotFor 显式入口裁决；未注册值 warn＋兜底首槽（fail-open 保运行，对齐产线 Q2 第 1 级先例）；
 * 5. 容量裁决（D10-A/D21）：容量=属地基地可运转锚定建筑数（仿 productionLanes.laneCapacityInBase），
 *    属地=QueueItem.base 所指基地；无全局 tier 门（settleFloor 既有 globalLimitFor 对非'研究'恒 Infinity，
 *    天然满足，无需本模块另设）。
 *
 * 实现裁量（登记回执，非设计变更）：
 * a. 锚定词表选型：anchorNames=['建造厂','MCV','维修所']。理由——catalog.ts 实况：建造厂系条目
 *    （盟军建造厂/苏联建造厂/建造厂核心）均含「建造厂」，与研究槽 slot.main 词表（L132：['建造厂','MCV']）
 *    同源先例；维修类建筑实况名「战地维修所」（catalog L2119， retrofit 机制注释明文「需战地维修所/原厂」），
 *    包含词「维修所」兼容阵营前缀变体。展示名 anchor 取「建造厂核心/战地维修所」双锚呈现。
 * b. laneKey 形态：`${base} eng:${slotId}`。任务卡语义「形如 eng:<slotId>」由 key 内嵌标记承载；
 *    必须携带 base 前缀——引擎升格门按 laneKey 等值计 active 数（transactionEngine.countActive），
 *    若缺 base，多基地 theater 工程会跨基地互挤（D21 属地容量即失效）；前缀形态对齐产线 `${base} ${laneId}`。
 * c. 通道B 能力面：'engineer'（新命名空间，对齐 'research'/'build.full'/'produce.*' 先例的命名粒度；
 *    当前 catalog 无 deploy 条目授予该能力面——与研究槽同例，不注入 deployOf 时通道B恒不命中、
 *    行为与通道A单通道逐字节一致；未来维修车 deploy 成维修所类条目可直接授予，无需改本模块）。
 * d. v1 无双模语义：工程槽容量不按建筑 mode 折算（产线双模是建造/生产专属机制，§3.2 未要求）；
 *    「建造中」视为未建成不计容量（对齐 researchSlots.anchorPresent / productionLanes.isPresent 口径）。
 * e. 基地不可解析（空 base/查无此基地）→ fail-open 恒 1（对齐产线裁量 c，防旧档/异常队列滞留）。
 * f. V2-02 eng.orbital 锚定词表选型（仓段化 V2 设计案 §8 D-C4「锚定发射台/轨道设施类建筑」）：
 *    全名锚定世界书实况建筑——航天发射中心（《通用·航天工业》uid4 05 <数据> type:building id；
 *    catalog.ts L2598 同名）/海上发射平台（同 uid4 条目扩建形态叙述）/大型航天发射综合体（《通用·主建筑》
 *    uid17 18 <数据> id）/山体发射场（《通用·主建筑》uid23 24）/巨型航天发射港（《通用·主建筑》uid29 30）。
 *    刻意不用短词「发射」：苏联武备/特色书存在导弹发射井群/发射架/发射车（uid86/uid21 等）会被误命中；
 *    也不用「发射平台」：苏联特色建筑 uid18「机动发射平台支援区」为导弹设施。includes 语义仍兼容阵营/规格前缀。
 *    容量口径同 eng.main（属地可运转锚定建筑数，建造中不计，裁量 d 同例）。
 */

/* ═══════════════ 类型定义 ═══════════════ */

import { capabilityCovers, type DeployOf } from './productionLanes';

/** 工程槽 ID（首版 eng.main；V2-02 追加 eng.orbital 轨道组装泊位；注册即开通新槽，不改裁决器） */
export type EngineeringSlotId = 'eng.main' | 'eng.orbital';

/** 注册表槽定义（§3.2 契约原文） */
export interface EngineeringSlotDef {
  slotId: EngineeringSlotId;
  name: string;
  /** 锚定建筑展示名 */
  anchor: string;
  /** 锚定建筑机器判定名单（在场建筑名「包含」任一项即命中；兼容阵营/规格前缀） */
  anchorNames: readonly string[];
  /** 承接的工程品类（retrofit 改装块 / project 长期工程） */
  accepts: readonly ('retrofit' | 'project')[];
}

/** 结构化 warn 留痕（fail-open 保运行、留痕催修表；不 console） */
export interface EngSlotWarn {
  type: 'unknown_explicit_slot';
  /** 非法的 lane 值原文 */
  lane?: string;
  /** 触发事务名 */
  item?: string;
  message: string;
}

/** engSlotFor 结构化返回 */
export interface EngSlotResolution {
  slotId: EngineeringSlotId;
  /** 命中方式：显式 lane 指定 / 缺省归首槽 */
  matched: 'explicit' | 'default';
  warn?: EngSlotWarn;
}

/** 本模块消费的最小状态视图（与 schema.ts StatData 结构兼容，不 import 保持零依赖） */
export interface EngStateView {
  bases?: ReadonlyArray<{
    id?: string;
    name?: string;
    buildings?: ReadonlyArray<{ name: string; state?: string; status?: string }>;
  }>;
  queues?: ReadonlyArray<{ type: string; item: string; base?: string; status?: string; lane?: string }>;
}

/** 裁决器消费的最小事务视图（与 transactionEngine TransactionItem 结构兼容＋§3.3 可选 lane） */
export interface EngTxnView {
  type: string;
  item: string;
  base: string;
  /** §3.3 投影项显式槽位（`eng:<slotId>`，兼容裸 slotId；''=未指定归首槽） */
  lane?: string;
}

/** engBoard 派生只读视图条目（供 UI/前馈日程消费；属地口径，逐基地×槽） */
export interface EngBoardEntry {
  slotId: EngineeringSlotId;
  name: string;
  /** 属地基地（id 或名原文） */
  base: string;
  /** 属地容量=该基地可运转锚定建筑数 */
  capacity: number;
  /** 在编项（type==='工程' && status==='active' 的 item 名） */
  active: string[];
  /** 排队数（status==='queued'） */
  queued: number;
}

/* ═══════════════ 注册表（首版 · D5-B） ═══════════════ */

/**
 * 注册表：eng.main 通用工程槽（锚定建造厂核心/战地维修所，选型理由见文件头裁量 a）＋
 * eng.orbital 轨道组装泊位（V2-02 / D-C4，锚定发射台类建筑，词表选型见文件头裁量 f）。
 * 顺序契约：eng.main 为首槽（缺省/兜底归属，fail-open 锚点），追加槽不得插队。
 */
export const ENGINEERING_SLOT_REGISTRY: readonly EngineeringSlotDef[] = [
  {
    slotId: 'eng.main',
    name: '通用工程槽',
    anchor: '建造厂核心/战地维修所',
    anchorNames: ['建造厂', 'MCV', '维修所', '军工车间', '造船厂', '科学城'],
    accepts: ['retrofit', 'project'],
  },
  {
    slotId: 'eng.orbital',
    name: '轨道组装泊位',
    anchor: '航天发射中心/发射场系',
    anchorNames: ['航天发射中心', '海上发射平台', '大型航天发射综合体', '山体发射场', '巨型航天发射港'],
    accepts: ['project'],
  },
];

/**
 * 各槽通道B所需能力面（实现裁量 c）：工程槽 → 'engineer'（eng.orbital 同面复用，不发明新命名空间）。
 * 结构性红线对齐产线：本表值非 'research'、非 'build.*'、非 'produce.*'——
 * 任何 deploy 能力面都不可经工程槽侧解锁研究槽或产线。
 */
export const ENG_DEPLOY_CAPABILITY: Readonly<Record<EngineeringSlotId, string | undefined>> = {
  'eng.main': 'engineer',
  'eng.orbital': 'engineer',
};

/** slotId → 槽定义索引 */
const SLOT_BY_ID: ReadonlyMap<string, EngineeringSlotDef> = new Map(
  ENGINEERING_SLOT_REGISTRY.map(slot => [slot.slotId, slot] as const),
);

/** 首槽（缺省/兜底归属；注册表首条，fail-open 锚点） */
const DEFAULT_SLOT: EngineeringSlotDef = ENGINEERING_SLOT_REGISTRY[0];

/** 引擎默认 laneKey 合同复刻（transactionEngine 现行 `${base} ${type}`，对齐 researchSlots 先例） */
function engineDefaultLaneKey(txn: EngTxnView): string {
  return `${txn.base} ${txn.type}`;
}

/* ═══════════════ engSlotFor：事务 → 槽映射（§3.3 显式入口） ═══════════════ */

/**
 * 工程事务 → 槽归属（本模块辖区仅 type==='工程'，调用方组合裁决器保证）：
 * 1. 显式指定：QueueItem.lane 非空——剥 `eng:` 前缀后查注册表（兼容裸 slotId 写法），
 *    非法值 warn＋兜底首槽（fail-open，对齐产线 Q2 第 1 级先例，不阻塞结算）；
 * 2. 缺省：归首槽（首版注册表唯一槽，无歧义；扩槽后投影引擎恒写显式 lane，§3.3）。
 */
export function engSlotFor(txn: EngTxnView): EngSlotResolution {
  const explicit = typeof txn.lane === 'string' ? txn.lane.trim() : '';
  if (explicit) {
    const candidate = explicit.startsWith('eng:') ? explicit.slice('eng:'.length) : explicit;
    const def = SLOT_BY_ID.get(candidate);
    if (def) return { slotId: def.slotId, matched: 'explicit' };
    return {
      slotId: DEFAULT_SLOT.slotId,
      matched: 'default',
      warn: {
        type: 'unknown_explicit_slot',
        lane: explicit,
        item: txn.item,
        message: `QueueItem.lane「${explicit}」未注册于工程槽注册表，兜底归入 ${DEFAULT_SLOT.slotId}（§3.3 显式入口 fail-open）`,
      },
    };
  }
  return { slotId: DEFAULT_SLOT.slotId, matched: 'default' };
}

/* ═══════════════ 锚定建筑门（双通道，§3.2） ═══════════════ */

/**
 * 双通道锚定命中判定（仿 researchSlots.anchorPresent L301-310 与 productionLanes.buildingMatchesLaneAnchor L376-381）：
 * 通道A＝建筑名 includes anchorNames（兜底，兼容阵营前缀变体）；
 * 通道B＝建筑名为 deploy 目标且被授予的能力面覆盖本槽所需（ENG_DEPLOY_CAPABILITY）。
 * 未注入 deployOf 时通道B恒不命中，行为与通道A单通道逐字节一致。
 */
function buildingMatchesEngAnchor(buildingName: string, def: EngineeringSlotDef, deployOf?: DeployOf): boolean {
  if (def.anchorNames.some(anchor => buildingName.includes(anchor))) return true;
  if (def.slotId === 'eng.orbital' && buildingName.includes('天基轨道船坞')) return true;
  const required = ENG_DEPLOY_CAPABILITY[def.slotId];
  if (required === undefined || deployOf === undefined) return false;
  return (deployOf(buildingName) ?? []).some(granted => capabilityCovers(granted, required));
}

/** 基地解析：id 精确匹配 → name 精确匹配；空 base/查无 → undefined（对齐 productionLanes.resolveBase） */
function resolveBase(state: EngStateView, baseRef: string) {
  const ref = baseRef.trim();
  if (!ref) return undefined;
  return (state.bases ?? []).find(b => b.id === ref) ?? (state.bases ?? []).find(b => b.name === ref);
}

/* ═══════════════ 属地容量裁决（D10-A / D21） ═══════════════ */

/**
 * 某基地某工程槽容量＝该基地可运转（非建造中）锚定建筑数（仿 laneCapacityInBase L408-424，无全局 tier 门）。
 * 属地口径：只看 baseRef 所指基地（D21 长期工程各阶段占用属地基地槽容量）。
 * 基地不可解析返回 undefined（fail-open 由调用方兜底 1，对齐产线裁量 c）。
 */
const INACTIVE_ENG_BUILDING_STATES = new Set(['建造中', '停机', '受损', '离线', '被毁', '战损']);

function isEngBuildingActive(building: { state?: string; status?: string }): boolean {
  const rawState = typeof building.state === 'string' ? building.state.trim() : '';
  const rawStatus = typeof building.status === 'string' ? building.status.trim() : '';
  if (rawState && INACTIVE_ENG_BUILDING_STATES.has(rawState)) return false;
  if (rawStatus && INACTIVE_ENG_BUILDING_STATES.has(rawStatus)) return false;
  const s = rawState || rawStatus || '运转';
  return s === '运转' || s === '正常' || s === '';
}

export function engSlotCapacityInBase(
  state: EngStateView,
  baseRef: string,
  def: EngineeringSlotDef,
  deployOf?: DeployOf,
): number | undefined {
  const base = resolveBase(state, baseRef);
  if (!base) return undefined;
  let count = 0;
  for (const building of base.buildings ?? []) {
    if (!isEngBuildingActive(building)) continue;
    if (buildingMatchesEngAnchor(building.name, def, deployOf)) count += 1;
  }
  return count;
}

/* ═══════════════ 回调工厂（注入 transactionEngine 接缝，settleFloor/scheduleText 组合） ═══════════════ */

/**
 * 生成注入引擎的 laneKeyFor 回调（仿 researchSlots.makeLaneKeyFor）：
 * 工程事务 → `${base} eng:${slotId}`（base 前缀属地分组，内嵌 `eng:<slotId>` 标记，裁量 b）；
 * 其余事务 → 引擎默认 `${base} ${type}`（组合回调保证不会到达，防御性兜底逐字节等价引擎缺席行为）。
 */
export function makeEngLaneKeyFor(warnSink?: (warn: EngSlotWarn) => void): (txn: EngTxnView) => string {
  return txn => {
    if (txn.type !== '工程') return engineDefaultLaneKey(txn);
    const resolution = engSlotFor(txn);
    if (resolution.warn && warnSink) warnSink(resolution.warn);
    return `${txn.base} eng:${resolution.slotId}`;
  };
}

/**
 * 生成注入引擎的 parallelLimitFor 回调（仿 productionLanes.makeProdParallelLimitFor）：
 * 工程事务 → 属地基地锚定建筑数（0=有队无道：排队保留、升格封死，对齐研究槽 §2.2 开通门语义）；
 * 基地不可解析 → 恒 1（fail-open）；其余类型委托 baseLimitFor（缺省恒 1）。
 * E2b 通道B：options.deployOf 注入后锚定判定启用 deploy 能力面；不注入与通道A单通道一致。
 */
export function makeEngParallelLimitFor(
  state: EngStateView,
  options: {
    baseLimitFor?: (txn: EngTxnView) => number;
    warnSink?: (warn: EngSlotWarn) => void;
    deployOf?: DeployOf;
  } = {},
): (txn: EngTxnView) => number {
  const baseLimitFor = options.baseLimitFor ?? (() => 1);
  return txn => {
    if (txn.type !== '工程') return baseLimitFor(txn);
    const resolution = engSlotFor(txn);
    if (resolution.warn && options.warnSink) options.warnSink(resolution.warn);
    const def = SLOT_BY_ID.get(resolution.slotId) ?? DEFAULT_SLOT;
    const cap = engSlotCapacityInBase(state, txn.base, def, options.deployOf);
    if (cap !== undefined) return cap;
    return (state.bases?.length ?? 0) > 0 ? 0 : 1;
  };
}

/* ═══════════════ engBoard：派生只读视图 ═══════════════ */

/**
 * 各基地各工程槽 {容量, 在编项, 排队数} 派生只读视图——占用完全派生自 queues（账本单一事实源），
 * 容量派生自属地基地锚定建筑；供 UI 工程面板与日程前馈消费。
 * 只列出「容量>0 或有工程活动」的 (基地 × 槽)。
 */
export function engBoard(
  state: EngStateView,
  warnSink?: (warn: EngSlotWarn) => void,
  options: { deployOf?: DeployOf } = {},
): EngBoardEntry[] {
  const entries = new Map<string, EngBoardEntry>();
  const keyOf = (base: string, slotId: EngineeringSlotId) => `${base} ${slotId}`;
  const ensure = (base: string, def: EngineeringSlotDef): EngBoardEntry => {
    const key = keyOf(base, def.slotId);
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        slotId: def.slotId,
        name: def.name,
        base,
        capacity: engSlotCapacityInBase(state, base, def, options.deployOf) ?? 1,
        active: [],
        queued: 0,
      };
      entries.set(key, entry);
    }
    return entry;
  };

  // 容量>0 的 (基地 × 槽) 预列（含零活动空槽，供面板呈现可用产能；对齐 laneBoard 先例）
  for (const base of state.bases ?? []) {
    const baseRef = base.id ?? base.name ?? '';
    for (const def of ENGINEERING_SLOT_REGISTRY) {
      if ((engSlotCapacityInBase(state, baseRef, def, options.deployOf) ?? 0) > 0) ensure(baseRef, def);
    }
  }

  // 队列活动归槽（仅 '工程' 事务属本模块辖区，其余类型跳过——与研究槽/产线互不串道）
  for (const txn of state.queues ?? []) {
    if (txn.type !== '工程') continue;
    if (txn.status !== 'active' && txn.status !== 'queued') continue;
    const resolution = engSlotFor({ type: txn.type, item: txn.item, base: txn.base ?? '', lane: txn.lane });
    if (resolution.warn && warnSink) warnSink(resolution.warn);
    const def = SLOT_BY_ID.get(resolution.slotId);
    if (!def) continue;
    const entry = ensure(txn.base ?? '', def);
    if (txn.status === 'active') entry.active.push(txn.item);
    else entry.queued += 1;
  }
  return [...entries.values()];
}
