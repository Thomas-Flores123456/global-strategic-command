/**
 * researchSlots.ts —— 科技研究槽注册表与裁决器（CTRL-RSLOT-IMPL-01）
 *
 * 真源：docs/design/systems/科技研究槽总设计案.md（confirmed，§2 混合开通制／§3.1 注册表全表／
 *       §4 双层并行上限／§5 数据模型与引擎会师）
 *
 * 设计红线（§1.3 / §5）：
 * 1. 槽位占用完全派生自 queues（type==='研究' && status==='active'），不新增任何 stat_data 字段；
 * 2. 本模块是喂给 transactionEngine SettleOptions 的一组纯回调工厂，不是引擎的新分支；
 * 3. 纯函数：零 Pinia、零 Vue、零宿主 API；不原地修改入参；warn 走结构化返回/收集器，不 console；
 * 4. LLM 报文零变化——槽归属由本裁决器查注册表决定，报文中不出现槽位字段（§5.4）。
 * 5. E2b 双通道锚定（批（八十四）授权）：通道A＝建筑名 includes anchorNames（既有，保留为兜底）；
 *    通道B＝在场建筑名命中 catalog deploy 目标且其 deploy.capabilities 覆盖本槽所需能力面
 *    （SLOT_DEPLOY_CAPABILITY，仅 slot.main/slot.faction 要求 'research'）。resolver 经 options.deployOf
 *    纯函数注入（DeployOf/capabilityCovers 与 productionLanes 同源共享，避免双份口径漂移）；
 *    不注入时行为与现状逐字节一致。
 *
 * 锚定建筑说明（§3.1）：registry 中 anchor 为设计案提案值原文；anchorNames 为机器判定名单，
 * 判定规则＝基地在场建筑名「包含」任一 anchorName（兼容「兵营」→「苏联兵营」等阵营前缀变体、
 * 「合成工坊」→「小型纳米合成工坊」等规格前缀）。建筑 state==='建造中' 视为未建成、不开通。
 * 提案值与 catalog need_buildings 实况的偏差逐条列入实现回执，供驾驶员 review 裁定（不静默改表）。
 */

/* ═══════════════ 类型定义 ═══════════════ */

import { capabilityCovers, type DeployOf } from './productionLanes';

/** 槽 ID（§3.1 全表 11 槽） */
export type SlotId =
  | 'slot.main'
  | 'slot.industry'
  | 'slot.defense'
  | 'slot.vehicle'
  | 'slot.personnel'
  | 'slot.equipment'
  | 'slot.agri'
  | 'slot.eco'
  | 'slot.aerospace'
  | 'slot.faction'
  | 'slot.mecha';

/** 注册表槽定义 */
export interface SlotDef {
  slotId: SlotId;
  name: string;
  /** 收纳的固定 line 名单（阵营特色线另走 linePattern 前缀匹配） */
  lines: readonly string[];
  /** 槽容量（§4.1 全表通则：恒 1，任何槽不随 tier 扩容） */
  capacity: 1;
  /** 锚定建筑（§3.1 提案值原文，展示用） */
  anchor: string;
  /** 锚定建筑机器判定名单（在场建筑名「包含」任一项即视为锚定建筑在场） */
  anchorNames: readonly string[];
}

/** 结构化 warn 留痕（§3.2 fail-open 保运行、留痕催修表；不 console） */
export interface SlotWarn {
  type: 'unregistered_line';
  /** 未注册的 line 值（有 line 但注册表没有时） */
  line?: string;
  /** 触发研究名（按研究名兜底失败时） */
  item?: string;
  message: string;
}

/** slotFor 结构化返回 */
export interface SlotResolution {
  slotId: SlotId;
  /** 命中方式：line 映射 / 阵营特色前缀 / 机娘研究名单枚举 / 兜底 */
  matched: 'line' | 'faction-pattern' | 'mecha-name' | 'fallback';
  warn?: SlotWarn;
}

/** 本模块消费的最小状态视图（与 schema.ts StatData 结构兼容，不 import 保持零依赖） */
export interface SlotStateView {
  bases?: ReadonlyArray<{ buildings?: ReadonlyArray<{ name: string; state?: string }> }>;
  queues?: ReadonlyArray<{ type: string; item: string; base?: string; status?: string; hold?: boolean }>;
}

/** 裁决器消费的最小事务视图（与 transactionEngine TransactionItem 结构兼容） */
export interface SlotTxnView {
  type: string;
  item: string;
  base: string;
}

/** 研究名 → line 的查找回调（通常由 catalog RESEARCHES 构建，见 lineIndexFromCatalog） */
export type LineOf = (researchName: string) => string | undefined;

/** slotBoard 派生只读视图条目（§5.3，供 UI/前馈日程消费） */
export interface SlotBoardEntry {
  slotId: SlotId;
  name: string;
  /** 开通状态：锚定建筑在场（已建成）为 true */
  unlocked: boolean;
  /** 在研项（type==='研究' && status==='active' 的 item 名） */
  active: string[];
  /** 排队数（status==='queued'） */
  queued: number;
}

/* ═══════════════ 注册表（§3.1 全表 · 冻结） ═══════════════ */

/** 阵营特色线前缀匹配（盟军特色／苏联特色／尤里特色…，`XX特色` 归 slot.faction） */
const FACTION_LINE_PATTERN = /特色$/;

/**
 * 机娘保障工程线研究名单枚举兜底（§3.3 勘误债 1：机娘书 9 项科技条目无 line 字段，
 * 名单提取自 worldbooks/通用·机娘保障工程_世界书.json 条目 02~10 标题；补打标后可退役）。
 */
export const MECHA_RESEARCH_NAMES: readonly string[] = [
  '相变微流道散热工学',
  '表皮电磁抑制与生物拟真协议',
  '通用神经总线适配协议',
  '高活性纳米创伤凝胶工学',
  '战术态势分流解算工学',
  '心智核心休眠自保回路',
  '纳米意识映射工学',
  '意识快照存储工学',
  '纳米躯体再造工学',
];

/** §3.1 注册表全表常量（11 槽；锚定建筑为提案值，偏差核定见实现回执） */
export const SLOT_REGISTRY: readonly SlotDef[] = [
  {
    slotId: 'slot.main',
    name: '主建筑槽',
    lines: ['主建筑'],
    capacity: 1,
    anchor: '建造厂核心（MCV）',
    // 实况偏差登记（跨文件先例 productionLanes.ts lane.main）：catalog 实务名为「盟军建造厂」（不含「核心」），放宽包含匹配
    anchorNames: ['建造厂', 'MCV'],
  },
  {
    slotId: 'slot.industry',
    name: '工业基础槽',
    lines: ['工业基础'],
    capacity: 1,
    anchor: '矿石精炼厂',
    anchorNames: ['矿石精炼厂'],
  },
  {
    slotId: 'slot.defense',
    name: '防御辅助槽',
    lines: ['防御辅助'],
    capacity: 1,
    anchor: '兵营',
    anchorNames: ['兵营'],
  },
  {
    slotId: 'slot.vehicle',
    name: '载具槽',
    lines: ['陆地载具', '空中载具', '水面舰艇'],
    capacity: 1,
    anchor: '战车工厂',
    anchorNames: ['战车工厂'],
  },
  {
    slotId: 'slot.personnel',
    name: '人员槽',
    lines: ['人员'],
    capacity: 1,
    anchor: '兵营',
    anchorNames: ['兵营'],
  },
  {
    slotId: 'slot.equipment',
    name: '人员装备槽',
    lines: ['装备'],
    capacity: 1,
    anchor: '个人装备制造所',
    // 裁决 A（19 号裁决报告）：装备槽锚点由合成工坊归位至装备制造所——catalog need_buildings ×13 与装备 uid4/盟军 uid0 正文均锚于此；includes 匹配兼收阵营前缀变体
    anchorNames: ['装备制造所'],
  },
  {
    slotId: 'slot.agri',
    name: '农畜业槽',
    lines: ['农畜业'],
    capacity: 1,
    anchor: '水培站（生态副食与水循环保障站）',
    anchorNames: ['水培站', '生态副食与水循环保障站'],
  },
  {
    slotId: 'slot.eco',
    name: '环保槽',
    lines: ['环保与公共设施'],
    capacity: 1,
    anchor: '基础废物分拣站',
    anchorNames: ['基础废物分拣站'],
  },
  {
    slotId: 'slot.aerospace',
    name: '航天工业槽',
    lines: ['航天工业'],
    capacity: 1,
    anchor: '航天发射中心',
    anchorNames: ['航天发射中心'],
  },
  {
    slotId: 'slot.faction',
    name: '阵营特色槽',
    lines: ['盟军特色'],
    capacity: 1,
    anchor: '对应阵营 MCV（建造厂核心）',
    // 实况偏差登记（跨文件先例 productionLanes.ts lane.main）：catalog 实务名为「盟军建造厂」（不含「核心」），放宽包含匹配
    anchorNames: ['建造厂', 'MCV'],
  },
  {
    slotId: 'slot.mecha',
    name: '机娘保障工程槽',
    lines: ['机娘保障工程'],
    capacity: 1,
    anchor: '机娘接口设施',
    anchorNames: ['机娘接口设施'],
  },
];

/** 全局研究并行上限（§4.2 tier 门：T1=2／T2=4／T3 不限） */
export const GLOBAL_RESEARCH_LIMITS: Readonly<Record<1 | 2 | 3, number>> = {
  1: 2,
  2: 4,
  3: Infinity,
};

/**
 * 各槽通道B所需能力面（E2b 映射规则注记，实现裁量登记回执）：
 * 仅 anchor 为建造厂/MCV 的 slot.main 与 slot.faction 参与 deploy 通道，一律要求 'research'；
 * 其余槽位不在表内＝不参通道B（保持名匹配唯一通道）。结构性红线：前沿工地（build.whitelist）与
 * 车族四场（produce.*）的能力面均不可覆盖 'research'——deploy 数据永远解不开研究槽。
 */
const SLOT_DEPLOY_CAPABILITY: Partial<Readonly<Record<SlotId, string>>> = {
  'slot.main': 'research',
  'slot.faction': 'research',
};

/** line → 槽定义的固定映射索引 */
const LINE_TO_SLOT: ReadonlyMap<string, SlotDef> = new Map(
  SLOT_REGISTRY.flatMap(slot => slot.lines.map(line => [line, slot] as const)),
);

/** 机娘研究名集合（名单枚举兜底判定用） */
const MECHA_NAME_SET: ReadonlySet<string> = new Set(MECHA_RESEARCH_NAMES);

/** 引擎默认 laneKey 合同复刻（transactionEngine 现行 `${base}\u0000${type}`，§5.2 default） */
function engineDefaultLaneKey(txn: SlotTxnView): string {
  return `${txn.base}\u0000${txn.type}`;
}

/* ═══════════════ slotFor：line/研究名 → 槽映射 ═══════════════ */

/**
 * line（或研究名）→ 槽 ID 映射（§3.2 归类判据）。
 * 优先级：固定 line 表 → `XX特色` 前缀归阵营特色槽 → 机娘研究名单枚举 → 兜底 slot.main＋warn。
 * fail-open：未注册 line 兜底进主建筑槽保运行，warn 结构化留痕催修表（不 console）。
 */
export function slotFor(lineOrName: string): SlotResolution {
  const direct = LINE_TO_SLOT.get(lineOrName);
  if (direct) return { slotId: direct.slotId, matched: 'line' };
  if (FACTION_LINE_PATTERN.test(lineOrName)) return { slotId: 'slot.faction', matched: 'faction-pattern' };
  if (MECHA_NAME_SET.has(lineOrName)) return { slotId: 'slot.mecha', matched: 'mecha-name' };
  return {
    slotId: 'slot.main',
    matched: 'fallback',
    warn: {
      type: 'unregistered_line',
      line: lineOrName,
      message: `line/研究名「${lineOrName}」未注册于研究槽注册表，兜底归入 slot.main（§3.2 fail-open）`,
    },
  };
}

/**
 * 研究事务 → 槽归属：先经 lineOf 查 line 再入表；查无 line 时用研究名自身走 slotFor
 * （覆盖机娘名单枚举与兜底）。
 */
function slotForResearch(item: string, lineOf: LineOf): SlotResolution {
  const line = lineOf(item);
  if (line !== undefined) {
    const byLine = slotFor(line);
    if (byLine.matched !== 'fallback') return byLine;
    // line 存在但未注册：warn 带上研究名便于定位
    return { ...byLine, warn: byLine.warn ? { ...byLine.warn, item } : byLine.warn };
  }
  const byName = slotFor(item);
  if (byName.warn) return { ...byName, warn: { ...byName.warn, item, line: undefined } };
  return byName;
}

/** 从 catalog RESEARCHES 形状的数组构建 lineOf 查找（集成层便捷工厂） */
export function lineIndexFromCatalog(researches: ReadonlyArray<{ name: string; line: string }>): LineOf {
  const index = new Map(researches.map(r => [r.name, r.line]));
  return name => index.get(name);
}

/* ═══════════════ 锚定建筑在场判定（§2 混合开通制） ═══════════════ */

const INACTIVE_RESEARCH_BUILDING_STATES = new Set([
  '建造中',
  '停机',
  '受损',
  '离线',
  '被毁',
  '战损',
  '损毁',
  '断电',
  '瘫痪',
  '摧毁',
]);

function isResearchBuildingActive(building: { state?: string }): boolean {
  const s = typeof building.state === 'string' ? building.state.trim() : '';
  return !s || !INACTIVE_RESEARCH_BUILDING_STATES.has(s);
}

/** 锚定建筑在场＝任一基地存在名称「包含」任一 anchorName 的建筑，且非建造中/受损/停机（建成且运转才开通）
 *  E2b 通道B：或建筑名命中 deploy 目标且被授予能力面覆盖本槽所需（SLOT_DEPLOY_CAPABILITY）；
 *  未注入 deployOf 时通道B恒不命中，行为与现状逐字节一致。 */
function anchorPresent(state: SlotStateView, slot: SlotDef, deployOf?: DeployOf): boolean {
  for (const base of state.bases ?? []) {
    for (const building of base.buildings ?? []) {
      if (!isResearchBuildingActive(building)) continue;
      if (slot.anchorNames.some(anchor => building.name.includes(anchor))) return true;
      const required = SLOT_DEPLOY_CAPABILITY[slot.slotId];
      if (required !== undefined && deployOf !== undefined) {
        if ((deployOf(building.name) ?? []).some(granted => capabilityCovers(granted, required))) return true;
      }
    }
  }
  return false;
}

/**
 * 全局科技资格 Tier 2 锚定建筑名单（D-P26 协议×科研院所阶梯会师）：
 * 覆盖《通用·主建筑》「战斗实验室」、《特色建筑·盟军》「盟军战斗实验室」、《特色建筑·苏联》「红星实验设计局综合体」
 * 及《特色建筑·尤里》「基因测序与心灵谐振研究院」。
 */
export const TECH_TIER_T2_ANCHORS: readonly string[] = [
  '战斗实验室',
  '红星实验设计局',
  '红星实验设计局综合体',
  '苏联战斗实验室',
  '苏联作战实验室',
  '基因测序与心灵谐振研究院',
  '尤里作战实验室',
  '尤里心灵研究实验室',
];

/**
 * 全局科技资格 Tier 3 锚定建筑名单（D-P26 协议×科研院所阶梯会师）：
 * 覆盖《特色建筑·苏联》「国家战略工程综合体／红星科学城」、《特色建筑·盟军》「盟军联合科研与国家工程组织节点」
 * 及《通用·主建筑》「量子超算中心」。
 */
export const TECH_TIER_T3_ANCHORS: readonly string[] = [
  '国家战略工程综合体',
  '红星科学城',
  '盟军联合科研与国家工程组织节点',
  '量子超算中心',
  '双螺旋生命工程与高维意识科学院',
  '双螺旋生命科学院',
];

/**
 * 基地科技资格 tier 推导（§4.2 + D-P26 会师）：
 * 遍历全部基地非「建造中」建筑取最高档——命中 TECH_TIER_T3_ANCHORS 立即返回 3（全局研究并行上限 ∞），
 * 命中 TECH_TIER_T2_ANCHORS 记为 2（全局研究并行上限 4，继续扫描防早退漏判 T3），默认返回 1（上限 2）。
 */
export function techTier(state: SlotStateView): 1 | 2 | 3 {
  let maxTier: 1 | 2 | 3 = 1;
  for (const base of state.bases ?? []) {
    for (const building of base.buildings ?? []) {
      if (!isResearchBuildingActive(building)) continue;
      if (TECH_TIER_T3_ANCHORS.some(anchor => building.name.includes(anchor))) {
        return 3;
      }
      if (maxTier < 2 && TECH_TIER_T2_ANCHORS.some(anchor => building.name.includes(anchor))) {
        maxTier = 2;
      }
    }
  }
  return maxTier;
}

/** 基地最高科技阶推导同义导出（兼容 resolveMaxTechTier 调用口径） */
export const resolveMaxTechTier = techTier;

/* ═══════════════ 回调工厂（§5.3 注入 transactionEngine 接缝） ═══════════════ */

/**
 * 生成注入引擎的 laneKeyFor 回调（§5.2 乙案）：
 * 研究事务 → `research:${slotId}`（槽即 lane，槽内串行天然由 parallelLimitFor 表达）；
 * 其余事务 → 引擎默认 `${base}\u0000${type}`（非研究路径行为逐字节零变化）。
 * @param warnSink 可选结构化 warn 收集器（兜底命中时留痕，不 console）
 */
export function makeLaneKeyFor(lineOf: LineOf, warnSink?: (warn: SlotWarn) => void): (txn: SlotTxnView) => string {
  return txn => {
    if (txn.type !== '研究') return engineDefaultLaneKey(txn);
    const resolution = slotForResearch(txn.item, lineOf);
    if (resolution.warn && warnSink) warnSink(resolution.warn);
    return `research:${resolution.slotId}`;
  };
}

/**
 * 生成注入引擎的 parallelLimitFor 回调（§2.2 开通门）：
 * 研究 lane：锚定建筑在场→槽容量（恒 1），不在场→0（有队无道：排队保留、升格封死）；
 * 非研究：委托现行规则（default 恒 1，可经 baseLimitFor 注入既有规则）。
 * E2b：options.deployOf 注入后锚定判定启用通道B（deploy 能力面）；不注入与现状逐字节一致。
 */
export function makeParallelLimitFor(
  state: SlotStateView,
  lineOf: LineOf,
  options: {
    baseLimitFor?: (txn: SlotTxnView) => number;
    warnSink?: (warn: SlotWarn) => void;
    deployOf?: DeployOf;
  } = {},
): (txn: SlotTxnView) => number {
  const baseLimitFor = options.baseLimitFor ?? (() => 1);
  // 开通状态在工厂时一次性快照（结算是纯函数，state 在单次结算内不变）
  const unlockedBySlot = new Map<SlotId, number>(
    SLOT_REGISTRY.map(slot => [slot.slotId, anchorPresent(state, slot, options.deployOf) ? slot.capacity : 0]),
  );
  return txn => {
    if (txn.type !== '研究') return baseLimitFor(txn);
    const resolution = slotForResearch(txn.item, lineOf);
    if (resolution.warn && options.warnSink) options.warnSink(resolution.warn);
    const cap = unlockedBySlot.get(resolution.slotId) ?? 0;
    if (cap > 0) return cap;
    if ((state.bases?.length ?? 0) === 0) return 1;
    if (!txn.base && resolution.matched === 'fallback') {
      const hasSupercomputer = (state.bases ?? []).some(b =>
        (b.buildings ?? []).some(bd => (bd.state ?? '运转') === '运转' && bd.name.includes('超算中心')),
      );
      if (hasSupercomputer) return 1;
    }
    return cap;
  };
}

/**
 * 生成注入引擎的 globalLimitFor 回调（§4.2 全局 tier 门）：
 * type==='研究' → T1=2／T2=4／T3=Infinity；其余 type → Infinity（现行无全局限语义零变化）。
 * @param options.techTierOf 可注入 tier 判定（T3 门卡机读接线后经此注入，默认 techTier 两档）
 */
export function makeGlobalLimitFor(
  state: SlotStateView,
  options: { techTierOf?: (state: SlotStateView) => 1 | 2 | 3 } = {},
): (type: string) => number {
  const tier = (options.techTierOf ?? techTier)(state);
  const researchLimit = GLOBAL_RESEARCH_LIMITS[tier];
  return type => (type === '研究' ? researchLimit : Infinity);
}

/* ═══════════════ slotBoard：派生只读视图（§5.3） ═══════════════ */

/**
 * 各槽 {开通状态, 在研项, 排队数} 派生只读视图——占用完全派生自 queues（§5.1 单一事实源），
 * 供 UI 槽位面板与 `<当前工程日程>` 前馈注入（RECONCILE 辖区）消费。
 * @param warnSink 可选 warn 收集器（队列中存在未注册 line 研究时留痕）
 * @param options.deployOf 可选 E2b 通道B resolver（与引擎门同口径）；不注入与现状一致
 */
export function slotBoard(
  state: SlotStateView,
  lineOf: LineOf,
  warnSink?: (warn: SlotWarn) => void,
  options: { deployOf?: DeployOf } = {},
): SlotBoardEntry[] {
  const entries = new Map<SlotId, SlotBoardEntry>(
    SLOT_REGISTRY.map(slot => [
      slot.slotId,
      {
        slotId: slot.slotId,
        name: slot.name,
        unlocked: anchorPresent(state, slot, options.deployOf),
        active: [],
        queued: 0,
      },
    ]),
  );
  for (const txn of state.queues ?? []) {
    if (txn.type !== '研究') continue;
    const resolution = slotForResearch(txn.item, lineOf);
    if (resolution.warn && warnSink) warnSink(resolution.warn);
    const entry = entries.get(resolution.slotId);
    if (!entry) continue;
    if (txn.status === 'active') entry.active.push(txn.item);
    else if (txn.status === 'queued') entry.queued += 1;
  }
  return [...entries.values()];
}
