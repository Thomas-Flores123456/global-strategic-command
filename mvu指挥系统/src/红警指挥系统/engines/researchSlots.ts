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
export interface SlotBuildingView {
  name: string;
  state?: string;
  research_accel?: number;
  research_lines?: readonly string[];
}

export interface SlotStateView {
  bases?: ReadonlyArray<{
    status?: string;
    buildings?: ReadonlyArray<SlotBuildingView>;
  }>;
  queues?: ReadonlyArray<{ type: string; item: string; base?: string; status?: string; hold?: boolean }>;
}

/** 建筑目录科研加速规格（供 <扩展档案> 落盘 <数据> 块后由 catalog 注入） */
export interface ResearchBuildingSpec {
  accel?: number;
  lines?: readonly string[];
}

export type ResearchBuildingSpecOf = (buildingName: string) => ResearchBuildingSpec | undefined;

/** 裁决器消费的最小事务视图（与 transactionEngine TransactionItem 结构兼容） */
export interface SlotTxnView {
  type: string;
  item: string;
  base: string;
}

/** 研究名 → line 的查找回调（通常由 catalog RESEARCHES 构建，见 lineIndexFromCatalog） */
export type LineOf = (researchName: string) => string | undefined;

export interface SlotAccelSource {
  name: string;
  accel: number;
}

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
  /** 非标/特许科研建筑对该槽的综合推进倍率（默认 1） */
  accelMultiplier?: number;
  /** 提供加速的在役建筑明细 */
  accelSources?: SlotAccelSource[];
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
export function slotForResearch(item: string, lineOf: LineOf): SlotResolution {
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

/** 从 catalog BUILDINGS 形状的数组构建科研加速查找回调 */
export function researchSpecIndexFromCatalog(
  buildings?: ReadonlyArray<{
    name?: string;
    id?: string;
    research_accel?: number;
    research_lines?: readonly string[];
  }>,
): ResearchBuildingSpecOf {
  const map = new Map<string, ResearchBuildingSpec>();
  for (const b of buildings ?? []) {
    if (!b || typeof b.research_accel !== 'number' || b.research_accel <= 0) continue;
    const spec: ResearchBuildingSpec = {
      accel: Math.min(0.35, Math.max(0, b.research_accel)),
      lines: b.research_lines,
    };
    if (typeof b.name === 'string' && b.name.trim()) map.set(b.name.trim(), spec);
    if (typeof b.id === 'string' && b.id.trim()) map.set(b.id.trim(), spec);
  }
  return name => map.get(name.trim());
}

/** 单座非标科研建筑加速上限（+35%）与单槽总加速倍率硬上限（2.00x） */
export const MAX_SINGLE_RESEARCH_BUILDING_ACCEL = 0.35;
export const RESEARCH_ACCEL_CAP = 2.0;

const WILDCARD_RESEARCH_LINE_RE = /^(?:全领域|全序列|通用|全部|全局|综合|all|\*)$/i;

const SLOT_SEMANTIC_LINE_PATTERNS: Readonly<Record<SlotId, RegExp>> = {
  'slot.main': /主建筑|建造|工程|地下|结构/,
  'slot.industry': /工业|材料|冶金|化工|精炼|能源|电力|电子/,
  'slot.defense': /防御|工事|掩体|防空|雷达|警戒/,
  'slot.vehicle': /载具|装甲|战车|车辆|底盘|航空|空军|飞行|舰艇|海军|船舶/,
  'slot.personnel': /人员|步兵|训练|医疗|生物|基因|人体/,
  'slot.equipment': /装备|单兵|武器|枪械|火控|外骨骼|护具|弹药/,
  'slot.agri': /农|畜|水培|副食|生态副食|育种|种植|食品|粮食/,
  'slot.eco': /环保|水循环|净水|环境|废物|回收|公共设施/,
  'slot.aerospace': /航天|轨道|火箭|空间|天基|卫星|推进/,
  'slot.faction': /特色|阵营/,
  'slot.mecha': /机娘|心智|神经|纳米医疗|机魂/,
};

/**
 * 判定建筑声明的 `research_lines` 是否匹配指定科研槽：
 * - `mode === 'accelerate'` 时：未声明 `lines` 或含 `全领域/通用` 视为全槽通用加速；
 * - `mode === 'unlock'` 时：仅当显式声明了具体领域且命中该槽时才视为可开通该槽（防通用加速意外全开 11 槽）。
 */
export function buildingResearchLinesMatchSlot(
  lines: readonly string[] | undefined,
  slot: SlotDef,
  mode: 'accelerate' | 'unlock' = 'accelerate',
): boolean {
  if (!lines || lines.length === 0) {
    return mode === 'accelerate';
  }
  const hasWildcard = lines.some(l => WILDCARD_RESEARCH_LINE_RE.test(l.trim()));
  if (hasWildcard) {
    return mode === 'accelerate';
  }
  const slotShortId = slot.slotId.replace(/^slot\./, '').toLowerCase();
  const slotCleanName = slot.name.replace(/槽$/, '');
  const semanticRe = SLOT_SEMANTIC_LINE_PATTERNS[slot.slotId];

  return lines.some(rawLine => {
    const token = rawLine.trim();
    if (!token) return false;
    const lower = token.toLowerCase();
    if (lower === slot.slotId.toLowerCase() || lower === slotShortId) return true;
    if (token === slot.name || token === slotCleanName || slot.name.includes(token) || token.includes(slotCleanName)) {
      return true;
    }
    if (slot.lines.some(l => l === token || l.includes(token) || token.includes(l))) {
      return true;
    }
    if (semanticRe && semanticRe.test(token)) {
      return true;
    }
    return false;
  });
}

function resolveBuildingResearchSpec(
  building: SlotBuildingView,
  researchSpecOf?: ResearchBuildingSpecOf,
): { accel: number; lines?: readonly string[] } | null {
  const fromCatalog = researchSpecOf?.(building.name);
  const rawAccel =
    typeof building.research_accel === 'number' && Number.isFinite(building.research_accel)
      ? building.research_accel
      : fromCatalog?.accel;
  if (typeof rawAccel !== 'number' || !Number.isFinite(rawAccel) || rawAccel <= 0) {
    return null;
  }
  const accel = Math.min(MAX_SINGLE_RESEARCH_BUILDING_ACCEL, Math.max(0, rawAccel));
  const lines =
    Array.isArray(building.research_lines) && building.research_lines.length > 0
      ? building.research_lines
      : fromCatalog?.lines;
  return { accel, lines };
}

export function resolveResearchSlotAccelSources(
  state: SlotStateView,
  slot: SlotDef,
  researchSpecOf?: ResearchBuildingSpecOf,
): SlotAccelSource[] {
  const sources: SlotAccelSource[] = [];
  for (const base of state.bases ?? []) {
    if (!isResearchBaseUsable(base)) continue;
    for (const building of base.buildings ?? []) {
      if (!isResearchBuildingActive(building)) continue;
      const spec = resolveBuildingResearchSpec(building, researchSpecOf);
      if (!spec) continue;
      if (buildingResearchLinesMatchSlot(spec.lines, slot, 'accelerate')) {
        sources.push({ name: building.name, accel: spec.accel });
      }
    }
  }
  return sources;
}

/**
 * 计算指定科研槽在当前在役非标/特许科研建筑加持下的综合推进倍率（1.00 ~ 2.00x）：
 * - 按单建筑 accel 降序排列后采用递减叠加：第 1 座 100%、第 2 座 75%、第 3 座起 50%；
 * - 总倍率封顶 RESEARCH_ACCEL_CAP (2.00x)。
 */
export function resolveResearchSlotAccelMultiplier(
  state: SlotStateView,
  slot: SlotDef,
  researchSpecOf?: ResearchBuildingSpecOf,
): number {
  const matchedAccels = resolveResearchSlotAccelSources(state, slot, researchSpecOf).map(s => s.accel);
  if (matchedAccels.length === 0) return 1;
  matchedAccels.sort((a, b) => b - a);
  let bonus = 0;
  for (let i = 0; i < matchedAccels.length; i++) {
    const weight = i === 0 ? 1.0 : i === 1 ? 0.75 : 0.5;
    bonus += matchedAccels[i] * weight;
  }
  return Math.min(RESEARCH_ACCEL_CAP, Math.round((1 + bonus) * 100) / 100);
}

/** 生成研究事务的科研建筑加速系数回调（非研究事务恒返回 1） */
export function makeResearchAccelEffFor(
  state: SlotStateView,
  lineOf: LineOf,
  options: { researchSpecOf?: ResearchBuildingSpecOf } = {},
): (txn: SlotTxnView) => number {
  const accelBySlot = new Map<SlotId, number>(
    SLOT_REGISTRY.map(slot => [
      slot.slotId,
      resolveResearchSlotAccelMultiplier(state, slot, options.researchSpecOf),
    ]),
  );
  return txn => {
    if (txn.type !== '研究') return 1;
    const resolution = slotForResearch(txn.item, lineOf);
    return accelBySlot.get(resolution.slotId) ?? 1;
  };
}

/* ═══════════════ 锚定建筑在场判定（§2 混合开通制） ═══════════════ */

/** 非运转建筑状态集合（研究槽与协议锚点 protocolAnchors 共用，G3-10） */
export const INACTIVE_RESEARCH_BUILDING_STATES: ReadonlySet<string> = new Set([
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

/** 基地是否参与科研判定（失守/废弃基地的建筑不计入开通、加速、科技 tier 与超算兜底） */
function isResearchBaseUsable(base: { status?: string }): boolean {
  return base.status !== '失守' && base.status !== '废弃';
}

/** 锚定建筑在场＝任一基地存在名称「包含」任一 anchorName 的建筑，且非建造中/受损/停机（建成且运转才开通）
 *  E2b 通道B：或建筑名命中 deploy 目标且被授予能力面覆盖本槽所需（SLOT_DEPLOY_CAPABILITY）；
 *  未注入 deployOf 时通道B恒不命中，行为与现状逐字节一致。 */
function anchorPresent(
  state: SlotStateView,
  slot: SlotDef,
  deployOf?: DeployOf,
  researchSpecOf?: ResearchBuildingSpecOf,
): boolean {
  for (const base of state.bases ?? []) {
    if (!isResearchBaseUsable(base)) continue;
    for (const building of base.buildings ?? []) {
      if (!isResearchBuildingActive(building)) continue;
      if (slot.anchorNames.some(anchor => building.name.includes(anchor))) return true;
      const required = SLOT_DEPLOY_CAPABILITY[slot.slotId];
      if (required !== undefined && deployOf !== undefined) {
        if ((deployOf(building.name) ?? []).some(granted => capabilityCovers(granted, required))) return true;
      }
      const spec = resolveBuildingResearchSpec(building, researchSpecOf);
      if (spec && buildingResearchLinesMatchSlot(spec.lines, slot, 'unlock')) {
        return true;
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
    if (!isResearchBaseUsable(base)) continue;
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
    researchSpecOf?: ResearchBuildingSpecOf;
  } = {},
): (txn: SlotTxnView) => number {
  const baseLimitFor = options.baseLimitFor ?? (() => 1);
  // 开通状态在工厂时一次性快照（结算是纯函数，state 在单次结算内不变）
  const unlockedBySlot = new Map<SlotId, number>(
    SLOT_REGISTRY.map(slot => [
      slot.slotId,
      anchorPresent(state, slot, options.deployOf, options.researchSpecOf) ? slot.capacity : 0,
    ]),
  );
  return txn => {
    if (txn.type !== '研究') return baseLimitFor(txn);
    const resolution = slotForResearch(txn.item, lineOf);
    if (resolution.warn && options.warnSink) options.warnSink(resolution.warn);
    const cap = unlockedBySlot.get(resolution.slotId) ?? 0;
    if (cap > 0) return cap;
    if ((state.bases?.length ?? 0) === 0) return 1;
    if (!txn.base && resolution.matched === 'fallback') {
      const hasSupercomputer = (state.bases ?? []).some(
        b =>
          isResearchBaseUsable(b) &&
          (b.buildings ?? []).some(bd => isResearchBuildingActive(bd) && bd.name.includes('超算中心')),
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
  options: { deployOf?: DeployOf; researchSpecOf?: ResearchBuildingSpecOf } = {},
): SlotBoardEntry[] {
  const entries = new Map<SlotId, SlotBoardEntry>(
    SLOT_REGISTRY.map(slot => {
      const accelSources = resolveResearchSlotAccelSources(state, slot, options.researchSpecOf);
      const accelMultiplier = resolveResearchSlotAccelMultiplier(state, slot, options.researchSpecOf);
      return [
        slot.slotId,
        {
          slotId: slot.slotId,
          name: slot.name,
          unlocked: anchorPresent(state, slot, options.deployOf, options.researchSpecOf),
          active: [],
          queued: 0,
          ...(accelMultiplier > 1.001 ? { accelMultiplier } : {}),
          ...(accelSources.length > 0 ? { accelSources } : {}),
        },
      ];
    }),
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
