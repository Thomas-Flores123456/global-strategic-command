/**
 * productionLanes.ts —— 产线注册表与裁决器（CTRL-PROD-LANE-01）
 *
 * 真源：docs/design/systems/产线与产能调度总设计案.md（confirmed-v2，
 *       §1 九线注册表／§2 四级判定＋canon 原生容量／§4 双模机制与加速系数）。
 *
 * 设计红线（§0.2 / §6）：
 * 1. 产线同源：本模块是喂给 transactionEngine SettleOptions 与 scheduleText 的一组纯回调工厂，
 *    日程/面板分组只消费本模块 laneKeyFor 真实输出，文本侧不另立分类；
 * 2. 账本写权：本模块只读 stat_data（bases/queues/pending_mode_switches），队列写权唯一在引擎结算链；
 * 3. 不重复造 owner：注册表引用现有建筑名（anchorNames 包含匹配），不新建世界书条目；
 * 4. 存档兼容：旧档无 lane/mode/accel_scope 字段一律惰性缺省——lane 缺省走推导兜底、
 *    mode 缺省='生产'、accel_scope 缺省='global'，行为等价 v1；
 * 5. 与研究槽同构（researchSlots.ts 版型）：纯函数零副作用、零 Pinia/Vue/宿主 API、
 *    不原地修改入参、warn 走结构化返回/收集器（不 console）。
 *
 * 实现裁量（登记回执，非设计变更）：
 * a. lane.default 兜底键＝v1 逐字节 `${base} ${type}`——「旧默认单线语义由 lane.default 承载」
 *    （§5 落地门 4）的机器兑现；命名产线键＝`${base} ${laneId}`；
 * b. 建造事务三级推导：防御关键词→lane.defense、MCV 关键词→lane.main、其余→lane.other_building；
 *    生产事务按产物名关键词推导（舰艇/空中/陆地/人员/装备），改装恒→lane.equipment；
 * c. 容量判定 base 不可解析（空/查无此基地）→ fail-open 恒 1（v1 行为等价，防旧档队列滞留）；
 *    base 可解析时＝该基地该品类「生产模式」建筑数（canon 原生容量，全部加速＝0 队列滞留）；
 * d. 适用品类（canon 冻结）：MCV/兵营/战车工厂/空军指挥部/造船厂——lane.equipment（工坊）与
 *    lane.default 无 mode 语义，mode 字段恒视为 '生产'。
 * e. E2b 双通道锚定（批（八十四）授权）：通道A＝建筑名 includes anchorNames（既有，保留为兜底）；
 *    通道B＝在场建筑名命中 catalog deploy 目标（某载具 deploy.into===建筑名）且其 deploy.capabilities
 *    覆盖本 lane 所需能力面（LANE_DEPLOY_CAPABILITY）。resolver 经 options.deployOf 纯函数注入
 *    （仿 lineIndexFromCatalog/prodLaneIndexFromCatalog 先例，deployIndexFromCatalog 工厂构建）；
 *    不注入时行为与 v1 逐字节一致。能力面映射注记见 LANE_DEPLOY_CAPABILITY 定义处。
 */

/* ═══════════════ 类型定义 ═══════════════ */

/** 产线 ID（§1 九线全表） */
export type LaneId =
  | 'lane.main'
  | 'lane.defense'
  | 'lane.other_building'
  | 'lane.personnel'
  | 'lane.vehicle_land'
  | 'lane.vehicle_air'
  | 'lane.vehicle_naval'
  | 'lane.equipment'
  | 'lane.default';

/** 注册表产线定义 */
export interface LaneDef {
  laneId: LaneId;
  name: string;
  /** 锚定建筑（§1 提案值原文，展示用） */
  anchor: string;
  /** 锚定建筑机器判定名单（在场建筑名「包含」任一项即命中；兼容阵营/规格前缀） */
  anchorNames: readonly string[];
  /**
   * 双模适用品类（canon §4.1 冻结：MCV/兵营/战车工厂/空军指挥部/造船厂）：
   * true＝mode:'加速' 的建筑不计容量、只贡献加速；false＝无 mode 语义（恒视为生产）。
   */
  dualMode: boolean;
}

/** 结构化 warn 留痕（fail-open 保运行、留痕催修表；不 console） */
export interface LaneWarn {
  type: 'unknown_explicit_lane' | 'unknown_catalog_lane';
  /** 非法的 lane 值原文 */
  lane?: string;
  /** 触发事务名 */
  item?: string;
  message: string;
}

/** laneFor 结构化返回（Q2 四级判定命中方式） */
export interface LaneResolution {
  laneId: LaneId;
  matched: 'explicit' | 'catalog' | 'derived' | 'fallback';
  warn?: LaneWarn;
}

/** 本模块消费的最小状态视图（与 schema.ts StatData 结构兼容，不 import 保持零依赖） */
export interface LaneStateView {
  bases?: ReadonlyArray<{
    id?: string;
    name?: string;
    buildings?: ReadonlyArray<{
      name: string;
      state?: string;
      status?: string;
      /** 双模真源（§4.1）：缺省/'生产'＝生产模式；非适用品类恒视为生产 */
      mode?: string;
      /** 加速对象（§4.3）：缺省/'global'＝加速全部基地同品类；'base'＝仅本基地 */
      accel_scope?: string;
    }>;
  }>;
  queues?: ReadonlyArray<{ type: string; item: string; base?: string; status?: string; lane?: string }>;
  /** 模式切换在途事务（§4.4，schema optional 挂载；旧档缺席＝零行为变化） */
  pending_mode_switches?: ReadonlyArray<{
    base: string;
    building: string;
    target_mode: string;
    remaining_minutes: number;
  }>;
}

/** 裁决器消费的最小事务视图（与 transactionEngine TransactionItem 结构兼容＋Q4 可选 lane） */
export interface ProdTxnView {
  type: string;
  item: string;
  base: string;
  /** Q4 可选显式产线字段（QueueItem.lane；''=未指定走推导） */
  lane?: string;
}

/** catalog 显式 lane 查找回调（Q2 第 2 级；由 prodLaneIndexFromCatalog 构建） */
export type LaneOf = (type: string, item: string) => string | undefined;

/**
 * deploy 能力面 resolver（E2b 通道B；由 deployIndexFromCatalog 构建或测试合成）：
 * 在场建筑名 → 该建筑作为载具 deploy 目标（deploy.into===建筑名）获得的能力面清单；
 * 非 deploy 目标返回 undefined。引擎只消费本回调，不直接读 catalog（纯函数注入红线）。
 */
export type DeployOf = (buildingName: string) => readonly string[] | undefined;

/** laneBoard 派生只读视图条目（供 UI/前馈日程消费） */
export interface LaneBoardEntry {
  laneId: LaneId;
  name: string;
  /** 所属基地（id 或名原文；产线恒按基地隔离，§6） */
  base: string;
  /** 该基地本线容量＝生产模式锚定建筑数（lane.default 恒 1） */
  capacity: number;
  /** 在编项（status==='active' 的 item 名） */
  active: string[];
  /** 排队数（status==='queued'） */
  queued: number;
}

/* ═══════════════ 注册表（§1 九线全表 · 冻结） ═══════════════ */

export const LANE_REGISTRY: readonly LaneDef[] = [
  {
    laneId: 'lane.main',
    name: '主建筑建造线',
    anchor: '建造厂核心（MCV）',
    anchorNames: ['建造厂', 'MCV'], // 实况偏差登记：catalog 实务名为「盟军建造厂」（不含「核心」），放宽包含匹配
    dualMode: true,
  },
  {
    laneId: 'lane.defense',
    name: '防御辅助建造线',
    anchor: '建造厂核心（MCV）',
    anchorNames: ['建造厂', 'MCV'],
    dualMode: true,
  },
  {
    laneId: 'lane.other_building',
    name: '其他建筑线',
    anchor: '建造厂核心（MCV）',
    anchorNames: ['建造厂', 'MCV'],
    dualMode: true,
  },
  {
    laneId: 'lane.personnel',
    name: '人员训练线',
    anchor: '兵营',
    anchorNames: ['兵营', '训导营'],
    dualMode: true,
  },
  {
    laneId: 'lane.vehicle_land',
    name: '陆地载具生产线',
    anchor: '战车工厂',
    anchorNames: ['战车工厂', '战车总装厂', '军工车间'],
    dualMode: true,
  },
  {
    laneId: 'lane.vehicle_air',
    name: '空中载具生产线',
    anchor: '空军指挥部',
    anchorNames: ['空军指挥部', '空指部', '航空引导盘'],
    dualMode: true,
  },
  {
    laneId: 'lane.vehicle_naval',
    name: '舰艇生产线',
    anchor: '造船厂',
    anchorNames: ['造船厂', '船坞', '船厂'],
    dualMode: true,
  },
  {
    laneId: 'lane.equipment',
    name: '装备生产线',
    anchor: '对应工坊',
    anchorNames: ['工坊', '个人装备制造所', '装备制造所'],
    dualMode: false, // 工坊非 canon 适用品类，恒视为生产
  },
  {
    laneId: 'lane.default',
    name: '综合线',
    anchor: '恒开通（=v1 行为）',
    anchorNames: [],
    dualMode: false,
  },
];

const LANE_BY_ID: ReadonlyMap<string, LaneDef> = new Map(LANE_REGISTRY.map(l => [l.laneId, l]));

/** 产线键解析：命名产线键＝`${base} ${laneId}`——从右侧匹配注册表 id（base 名可含空格） */
export function laneDefFromKey(laneKey: string): LaneDef | undefined {
  for (const def of LANE_REGISTRY) {
    if (def.laneId !== 'lane.default' && laneKey.endsWith(` ${def.laneId}`)) return def;
  }
  return undefined;
}

/* ═══════════════ laneFor：Q2 四级判定 ═══════════════ */

/** 三级推导关键词表（建造类：防御／MCV；其余建造→其他建筑线） */
const DEFENSE_BUILDING_PATTERN = /碉堡|防空|炮位|雷区|围墙|光棱塔|哨戒|近防|要塞|地雷|掩体|拦截|防御|伪装|护盾|岗哨/;
const MCV_BUILDING_PATTERN = /建造厂核心|MCV/i;

/** 三级推导关键词表（生产类：产物名 → 产线；顺序即优先级） */
const PRODUCTION_DERIVE_TABLE: ReadonlyArray<readonly [RegExp, LaneId]> = [
  [/舰|艇|潜艇|航母|驱逐舰|巡洋舰|船/, 'lane.vehicle_naval'],
  [/战机|直升机|无人机|侦察机|轰炸机|运输机|飞行器/, 'lane.vehicle_air'],
  [/坦克|装甲车|机甲|战车|履带车|履带底盘|卡车|吉普|摩托|自行火炮|机动平台/, 'lane.vehicle_land'],
  [/步兵|大兵|工程兵|间谍|狙击|军犬|士兵|军官|机娘|突击队|医疗队|兵种/, 'lane.personnel'],
  [/装备|武器|枪械|弹药|瞄准|外骨骼|军服|护具|防具/, 'lane.equipment'],
];

/**
 * 事务 → 产线归属（§2 Q2 四级判定）：
 * 1. 显式指定：QueueItem.lane 非空且为注册表 id（非法值 warn＋落下一级）；
 * 2. 产物映射：catalog lane 字段（经 laneOf 回调；非法值 warn＋落下一级）；
 * 3. 类型推导：注册表内置推导表（建造按防御/MCV 关键词，生产按产物关键词，改装恒装备线）；
 * 4. 兜底：lane.default（行为等价 v1 单线）。
 * 研究事务不属于本模块辖区（研究槽 researchSlots 裁决），直接落兜底。
 */
export function laneFor(txn: ProdTxnView, laneOf?: LaneOf): LaneResolution {
  // 第 1 级：显式指定
  const explicit = typeof txn.lane === 'string' ? txn.lane.trim() : '';
  if (explicit) {
    const def = LANE_BY_ID.get(explicit);
    if (def) return { laneId: def.laneId, matched: 'explicit' };
    const warn: LaneWarn = {
      type: 'unknown_explicit_lane',
      lane: explicit,
      item: txn.item,
      message: `QueueItem.lane「${explicit}」未注册于产线注册表，忽略显式值转推导（Q2 第 1 级 fail-open）`,
    };
    // 显式非法不直接兜底——继续走 2–4 级
    const next = laneForCatalogAndDerive(txn, laneOf);
    return { ...next, warn: next.warn ?? warn };
  }
  return laneForCatalogAndDerive(txn, laneOf);
}

/** Q2 第 2–4 级（内部）：catalog 映射 → 推导 → 兜底 */
function laneForCatalogAndDerive(txn: ProdTxnView, laneOf?: LaneOf): LaneResolution {
  // 第 2 级：catalog 产物映射
  const catalogLane = laneOf?.(txn.type, txn.item)?.trim();
  if (catalogLane) {
    const def = LANE_BY_ID.get(catalogLane);
    if (def) return { laneId: def.laneId, matched: 'catalog' };
    const warn: LaneWarn = {
      type: 'unknown_catalog_lane',
      lane: catalogLane,
      item: txn.item,
      message: `catalog 条目「${txn.item}」lane「${catalogLane}」未注册于产线注册表，转推导（Q2 第 2 级 fail-open）`,
    };
    const next = deriveLane(txn);
    return { ...next, warn: next.warn ?? warn };
  }
  return deriveLane(txn);
}

/** Q2 第 3 级：类型推导（注册表内置映射表）；第 4 级：兜底 lane.default */
function deriveLane(txn: ProdTxnView): LaneResolution {
  if (txn.type === '建造') {
    if (MCV_BUILDING_PATTERN.test(txn.item)) return { laneId: 'lane.main', matched: 'derived' };
    if (DEFENSE_BUILDING_PATTERN.test(txn.item)) return { laneId: 'lane.defense', matched: 'derived' };
    return { laneId: 'lane.other_building', matched: 'derived' };
  }
  if (txn.type === '改装') return { laneId: 'lane.equipment', matched: 'derived' };
  if (txn.type === '生产') {
    for (const [pattern, laneId] of PRODUCTION_DERIVE_TABLE) {
      if (pattern.test(txn.item)) return { laneId, matched: 'derived' };
    }
  }
  return { laneId: 'lane.default', matched: 'fallback' };
}

const PRODUCTION_ANCHOR_LANE_IDS: readonly LaneId[] = [
  'lane.personnel',
  'lane.vehicle_land',
  'lane.vehicle_air',
  'lane.vehicle_naval',
  'lane.equipment',
];

function resolveProductionLaneFromAnchor(buildingName: string): LaneId | undefined {
  const b = buildingName.trim();
  if (!b) return undefined;
  for (const laneId of PRODUCTION_ANCHOR_LANE_IDS) {
    const def = LANE_BY_ID.get(laneId);
    if (def && buildingMatchesLaneAnchor(b, def)) {
      return laneId;
    }
  }
  return undefined;
}

function stripMassProdSuffixForLane(name: string): string {
  return name.replace(/\s*[（(](?:量产体|量产型步兵)[）)]\s*$/u, '').trim();
}

/**
 * 从 catalog 形状构建 laneOf 查找（Q2 第 2 级）：
 * 1. 优先读取显式 lane 字段（若填写为锚定建筑名如「兵营」/「战车工厂」则自动归一为对应 laneId，非法值原样返回以触发 warn）；
 * 2. 生产条目未填显式 lane 时，按其 need_building / need_buildings 锚定的生产建筑同源反推所属产线
 *    （兵营→lane.personnel、战车工厂→lane.vehicle_land、空军指挥部→lane.vehicle_air、造船厂→lane.vehicle_naval、工坊→lane.equipment），
 *    并同步索引 aliases 与去量产后缀名（BUG-LIVE-27）。
 */
export function prodLaneIndexFromCatalog(pools: {
  buildings?: ReadonlyArray<{ name: string; lane?: string }>;
  productions?: ReadonlyArray<{
    name: string;
    aliases?: readonly string[];
    lane?: string;
    need_building?: string;
    need_buildings?: readonly string[];
  }>;
  retrofits?: ReadonlyArray<{ name: string; lane?: string }>;
}): LaneOf {
  const index = new Map<string, string>();
  for (const e of pools.buildings ?? []) if (e.lane) index.set(`建造 ${e.name}`, e.lane);
  for (const e of pools.productions ?? []) {
    let resolvedLane: string | undefined;
    const explicitLane = typeof e.lane === 'string' ? e.lane.trim() : '';
    if (explicitLane) {
      resolvedLane =
        LANE_BY_ID.has(explicitLane) || explicitLane.startsWith('lane.')
          ? explicitLane
          : (resolveProductionLaneFromAnchor(explicitLane) ?? explicitLane);
    } else {
      const reqBuildings = [
        ...(typeof e.need_building === 'string' && e.need_building.trim() ? [e.need_building.trim()] : []),
        ...(Array.isArray(e.need_buildings) ? e.need_buildings : []),
      ];
      for (const req of reqBuildings) {
        if (typeof req !== 'string') continue;
        const hit = resolveProductionLaneFromAnchor(req);
        if (hit) {
          resolvedLane = hit;
          break;
        }
      }
    }
    if (resolvedLane) {
      index.set(`生产 ${e.name}`, resolvedLane);
      const stripped = stripMassProdSuffixForLane(e.name);
      if (stripped && !index.has(`生产 ${stripped}`)) {
        index.set(`生产 ${stripped}`, resolvedLane);
      }
      if (Array.isArray(e.aliases)) {
        for (const alias of e.aliases) {
          if (typeof alias === 'string' && alias.trim() && !index.has(`生产 ${alias.trim()}`)) {
            index.set(`生产 ${alias.trim()}`, resolvedLane);
          }
        }
      }
    }
  }
  for (const e of pools.retrofits ?? []) if (e.lane) index.set(`改装 ${e.name}`, e.lane);
  return (type, item) => {
    const exact = index.get(`${type} ${item}`);
    if (exact !== undefined) return exact;
    const stripped = stripMassProdSuffixForLane(item);
    return stripped !== item ? index.get(`${type} ${stripped}`) : undefined;
  };
}

/* ═══════════════ E2b 通道B：deploy 能力面锚定消费 ═══════════════ */

/**
 * 能力面覆盖判定：granted 精确等于 required，或 granted 为 `xxx.*` 通配且 required 落在 `xxx.` 命名空间内。
 * 例：'produce.*' 覆盖 'produce.vehicle'；'build.whitelist' 不覆盖 'build.full'，更不覆盖 'research'。
 */
export function capabilityCovers(granted: string, required: string): boolean {
  if (granted === required) return true;
  if (granted.endsWith('.*')) return required.startsWith(granted.slice(0, -1));
  return false;
}

/**
 * 从 catalog 形状（effectiveCatalog 或其子集）构建 deploy 能力面 resolver（E2b 通道B索引工厂）：
 * 扫描三池中带 deploy 块的条目（E2a 世界书 `<数据>` 块经 parser passthrough 直达），
 * 以 deploy.into（部署目标建筑名）为键聚合 capabilities（多载具部署同名目标时能力面并集）。
 * MCV 无 `<数据>` 块系（八十二）登记决定——本工厂只忠实索引在场数据，不臆造能力面。
 */
export function deployIndexFromCatalog(pools: {
  buildings?: ReadonlyArray<{ name: string; deploy?: { into?: string; capabilities?: readonly string[] } }>;
  productions?: ReadonlyArray<{ name: string; deploy?: { into?: string; capabilities?: readonly string[] } }>;
  retrofits?: ReadonlyArray<{ name: string; deploy?: { into?: string; capabilities?: readonly string[] } }>;
}): DeployOf {
  const index = new Map<string, Set<string>>();
  const absorb = (entries?: ReadonlyArray<{ deploy?: { into?: string; capabilities?: readonly string[] } }>) => {
    for (const e of entries ?? []) {
      const into = e.deploy?.into;
      if (!into) continue;
      let granted = index.get(into);
      if (!granted) {
        granted = new Set();
        index.set(into, granted);
      }
      for (const cap of e.deploy?.capabilities ?? []) granted.add(cap);
    }
  };
  absorb(pools.buildings);
  absorb(pools.productions);
  absorb(pools.retrofits);
  return name => {
    const granted = index.get(name);
    return granted ? [...granted] : undefined;
  };
}

/**
 * 各产线通道B所需能力面（E2b 映射规则注记，实现裁量登记回执）：
 * - lane.main（主建筑建造线，承载 MCV 级全量建造）→ 'build.full'：白名单工地不可伪托主建线；
 * - lane.defense / lane.other_building → 'build.whitelist'：前沿工地（build.whitelist）挂此两线，
 *   白名单建造得以引擎化而不触碰主线；
 * - 生产四线（人员/陆地/空中/舰艇）与装备线 → 'produce.<品类>'：车族四车 deploy 授予的 'produce.*'
 *   经通配覆盖全线，细化品类授权（如仅 'produce.vehicle'）亦可精确落地；
 * - lane.default → undefined（恒开通综合线无锚定语义，不参与通道B）。
 * 结构性红线：本表所有值均非 'research'——任何 deploy 能力面都不可经产线侧解锁研究槽。
 */
export const LANE_DEPLOY_CAPABILITY: Readonly<Record<LaneId, string | undefined>> = {
  'lane.main': 'build.full',
  'lane.defense': 'build.whitelist',
  'lane.other_building': 'build.whitelist',
  'lane.personnel': 'produce.personnel',
  'lane.vehicle_land': 'produce.vehicle',
  'lane.vehicle_air': 'produce.vehicle',
  'lane.vehicle_naval': 'produce.vehicle',
  'lane.equipment': 'produce.equipment',
  'lane.default': undefined,
};

const LANE_UPGRADE_DESCENDANTS: Readonly<Partial<Record<LaneId, readonly string[]>>> = {
  'lane.personnel': ['尤里克隆与新兵训导营'],
  'lane.vehicle_land': [
    '扩大版自动化战车工厂',
    '全自动军工综合体',
    '巨型联合兵工厂',
    '苏维埃工业工厂',
    '国家总动员兵工城',
    '国家总动员兵工城实现',
    '尤里生物机电战车总装厂',
  ],
  'lane.vehicle_air': ['苏联空军基地', '空天飞机维护综合体', '神经航空引导盘'],
  'lane.vehicle_naval': [
    '简易船坞',
    '海军造船厂',
    '扩大版造船厂',
    '超级造船综合体',
    '尤里船厂',
    '尤里半潜与仿生造船厂',
    '潜艇船坞',
  ],
};

/**
 * 双通道锚定命中判定：通道A＝建筑名 includes anchorNames 或命中 FD-22 高阶替代建筑（既有兜底）；
 * 通道B＝建筑名为 deploy 目标且被授予的能力面覆盖本 lane 所需（LANE_DEPLOY_CAPABILITY）。
 * 未注入 deployOf 时通道B恒不命中，行为与 v1 逐字节一致。
 */
export function buildingMatchesLaneAnchor(buildingName: string, def: LaneDef, deployOf?: DeployOf): boolean {
  if (def.anchorNames.some(anchor => buildingName.includes(anchor))) return true;
  const descendants = LANE_UPGRADE_DESCENDANTS[def.laneId];
  if (descendants && descendants.some(desc => buildingName === desc || buildingName.includes(desc))) {
    return true;
  }
  const required = LANE_DEPLOY_CAPABILITY[def.laneId];
  if (required === undefined || deployOf === undefined) return false;
  return (deployOf(buildingName) ?? []).some(granted => capabilityCovers(granted, required));
}

/* ═══════════════ 容量与加速（§2 Q3 canon 原生容量／§4 双模） ═══════════════ */

/** 基地解析：id 精确匹配 → name 精确匹配；空 base/查无 → undefined（调用方 fail-open） */
function resolveBase(state: LaneStateView, baseRef: string) {
  const ref = baseRef.trim();
  if (!ref) return undefined;
  return (state.bases ?? []).find(b => b.id === ref) ?? (state.bases ?? []).find(b => b.name === ref);
}

const INACTIVE_BUILDING_STATES = new Set(['建造中', '停机', '受损', '离线', '被毁', '战损']);

/** 建筑是否计入「在场」：仅「运转」或 legacy「正常」态（缺省按运转计；建造中/受损/停机/战损/离线/被毁不计入产能与加速，兼容 state/status，FIX-P1-01 / SIM-WEATHER-01） */
function isPresent(building: { state?: string; status?: string }): boolean {
  const rawState = typeof building.state === 'string' ? building.state.trim() : '';
  const rawStatus = typeof building.status === 'string' ? building.status.trim() : '';
  if (rawState && INACTIVE_BUILDING_STATES.has(rawState)) return false;
  if (rawStatus && INACTIVE_BUILDING_STATES.has(rawStatus)) return false;
  const s = rawState || rawStatus || '运转';
  return s === '运转' || s === '正常' || s === '';
}

/** 建筑是否处于生产模式：非双模品类恒 true；双模品类 mode==='加速' 才 false（缺省生产） */
function isProductionMode(building: { mode?: string }, def: LaneDef): boolean {
  if (!def.dualMode) return true;
  return building.mode !== '加速';
}

/**
 * 某基地某产线容量＝该基地该品类「生产模式」锚定建筑数（§2 Q3 canon 原生容量）；
 * 全部加速＝0（队列滞留，待任一切回生产）。基地不可解析返回 undefined（fail-open 由调用方兜底 1）。
 * E2b：锚定命中走双通道（buildingMatchesLaneAnchor），deployOf 未注入时与 v1 逐字节一致。
 */
export function laneCapacityInBase(
  state: LaneStateView,
  baseRef: string,
  def: LaneDef,
  deployOf?: DeployOf,
): number | undefined {
  if (def.laneId === 'lane.default') return 1;
  const base = resolveBase(state, baseRef);
  if (!base) return undefined;
  let count = 0;
  for (const building of base.buildings ?? []) {
    if (!isPresent(building)) continue;
    if (!buildingMatchesLaneAnchor(building.name, def, deployOf)) continue;
    if (isProductionMode(building, def)) count += 1;
  }
  return count;
}

/** §4.2 递减加速表：第 1 座 +0.50｜第 2 座 +0.30｜第 3 座 +0.20｜第 4 座起 +0.05/座 */
const ACCEL_INCREMENTS: readonly number[] = [0.5, 0.3, 0.2];

/** §4.2 硬上限（生产时间不低于基础值四成） */
export const ACCEL_COEFFICIENT_CAP = 2.5;

/**
 * 加速系数（canon 公式冻结）：accelCount≤0→1；按递减表累计；硬上限 2.50。
 * 均摊不稀释——系数对适用范围内每座生产建筑全额生效。
 */
export function accelCoefficientFor(accelCount: number): number {
  const n = Math.max(0, Math.floor(accelCount));
  if (n === 0) return 1;
  let bonus = 0;
  for (let i = 0; i < n; i++) bonus += ACCEL_INCREMENTS[i] ?? 0.05;
  return Math.min(ACCEL_COEFFICIENT_CAP, 1 + bonus);
}

/**
 * 事务的生效加速数（§4.3 聚合）：global 同品类加速建筑数（全基地）＋本基地 base scope 同品类加速数。
 * 非双模品类/兜底线/基地不可解析 → 0（系数 1）。
 */
export function effectiveAccelCount(state: LaneStateView, txn: ProdTxnView, def: LaneDef): number {
  if (!def.dualMode) return 0;
  const base = resolveBase(state, txn.base);
  if (!base) return 0;
  let globalCount = 0;
  let baseCount = 0;
  for (const b of state.bases ?? []) {
    for (const building of b.buildings ?? []) {
      if (!isPresent(building)) continue;
      if (!buildingMatchesLaneAnchor(building.name, def)) continue;
      if (building.mode !== '加速') continue;
      if (building.accel_scope === 'base') {
        if (b === base) baseCount += 1;
      } else {
        globalCount += 1;
      }
    }
  }
  return globalCount + baseCount;
}

/* ═══════════════ 回调工厂（注入 transactionEngine / scheduleText 接缝） ═══════════════ */

/** v1 默认键复刻（transactionEngine/scheduleText 现行 `${base} ${type}`，行为等价锁） */
function v1DefaultLaneKey(txn: ProdTxnView): string {
  return `${txn.base} ${txn.type}`;
}

/**
 * 生成产线分组键回调（产线同源红线：引擎升格门/回检/调度令与日程文本共用一个输出）：
 * 命名产线 → `${base} ${laneId}`；兜底 → v1 逐字节 `${base} ${type}`（lane.default 承载旧语义）。
 * 研究事务由调用方组合 researchSlots 回调；本回调对研究事务同样落兜底键。
 */
export function makeProdLaneKeyFor(laneOf?: LaneOf, warnSink?: (warn: LaneWarn) => void): (txn: ProdTxnView) => string {
  return txn => {
    const resolution = laneFor(txn, laneOf);
    if (resolution.warn && warnSink) warnSink(resolution.warn);
    if (resolution.laneId === 'lane.default') return v1DefaultLaneKey(txn);
    return `${txn.base} ${resolution.laneId}`;
  };
}

/**
 * 生成产线并行上限回调（§2 Q3）：
 * 兜底线 → 恒 1（v1 行为等价）；命名产线 → 该基地生产模式锚定建筑数（全部加速＝0 滞留）；
 * 基地不可解析 → 恒 1（fail-open，防旧档/空 base 队列滞留）。
 * E2b：options.deployOf 注入后容量判定启用通道B（deploy 能力面锚定）；不注入与 v1 一致。
 */
export function makeProdParallelLimitFor(
  state: LaneStateView,
  laneOf?: LaneOf,
  options: { warnSink?: (warn: LaneWarn) => void; deployOf?: DeployOf } = {},
): (txn: ProdTxnView) => number {
  return txn => {
    const resolution = laneFor(txn, laneOf);
    if (resolution.warn && options.warnSink) options.warnSink(resolution.warn);
    const def = LANE_BY_ID.get(resolution.laneId);
    if (!def || def.laneId === 'lane.default') return 1;
    const cap = laneCapacityInBase(state, txn.base, def, options.deployOf) ?? 1;
    if (cap === 0 && txn.type === '建造') {
      const base = resolveBase(state, txn.base);
      const blds = base?.buildings ?? [];
      if (blds.length > 0 && blds.every(b => b.name.includes('发电'))) {
        return 1;
      }
    }
    return cap;
  };
}

/**
 * 生成加速系数回调（§4.2/§4.3，喂 settleFloor 积分链与工况 eff 乘法叠加）：
 * 双模品类命名产线 → accelCoefficientFor(global 同品类加速数＋本基地 base scope 加速数)；
 * 其余 → 1。实际推进分钟×系数 ⇒ 实际生产时间＝基础÷系数（与分装减免乘法叠加）。
 */
export function makeAccelEffFor(state: LaneStateView, laneOf?: LaneOf): (txn: ProdTxnView) => number {
  return txn => {
    const resolution = laneFor(txn, laneOf);
    const def = LANE_BY_ID.get(resolution.laneId);
    if (!def) return 1;
    return accelCoefficientFor(effectiveAccelCount(state, txn, def));
  };
}

/* ═══════════════ 模式切换事务（§4.4 · 720 分钟校准 · v1 从简） ═══════════════ */

/** canon 校准时长（约半日）；战时紧急切换/良品率惩罚 v1 不做（设计案 §4.4 备案） */
export const MODE_SWITCH_MINUTES = 720;

export interface ModeSwitchRequest {
  /** 目标基地（id 或名） */
  base: string;
  /** 目标建筑名 */
  building: string;
  target_mode: '生产' | '加速';
}

export interface PendingModeSwitch extends ModeSwitchRequest {
  remaining_minutes: number;
}

/** 模式切换结算事件（结构化留痕，供 settleFloor 转 ParseEvent） */
export interface ModeSwitchEvent {
  type: 'mode_switch_done' | 'mode_switch_orphan';
  base: string;
  building: string;
  detail: string;
}

interface ModeSwitchState {
  bases?: LaneStateView['bases'];
  pending_mode_switches?: ReadonlyArray<PendingModeSwitch>;
}

/**
 * 切换指令入账（写权入口预留：LLM `<队列>` 动词/前端调度令经此进账本链）：
 * 同 base＋building 的在途切换被新指令替换（以最新指令为准），不原地修改入参。
 * 目标建筑当前 mode 已与 target 一致且无在途切换 → 原样返回（幂等）。
 */
export function requestModeSwitch<S extends ModeSwitchState>(state: S, req: ModeSwitchRequest): S {
  const pending = [...(state.pending_mode_switches ?? [])].filter(
    p => !(p.base === req.base && p.building === req.building),
  );
  // 幂等：建筑已是目标模式且无在途切换 → 不入账
  const base = (state.bases ?? []).find(b => b.id === req.base) ?? (state.bases ?? []).find(b => b.name === req.base);
  const current = base?.buildings?.find(b => b.name === req.building);
  if (
    current &&
    (current.mode ?? '生产') === req.target_mode &&
    pending.length === (state.pending_mode_switches ?? []).length
  ) {
    return state;
  }
  pending.push({ ...req, remaining_minutes: MODE_SWITCH_MINUTES });
  return { ...state, pending_mode_switches: pending };
}

/**
 * 模式切换结算（挂在 settleFloor 主结算之后；Δt 是唯一燃料——Δt≤0 不推进）：
 * 在途条目 remaining−=Δt；到期 → 目标建筑 mode 翻转、条目出账、留痕；
 * 建筑/基地已不存在 → 条目出账＋orphan 留痕（不阻塞结算）。
 */
export function settleModeSwitches<S extends ModeSwitchState>(
  state: S,
  deltaMinutes: number,
): { next: S; events: ModeSwitchEvent[] } {
  const pending = state.pending_mode_switches ?? [];
  if (pending.length === 0 || deltaMinutes <= 0) return { next: state, events: [] };

  const events: ModeSwitchEvent[] = [];
  const matured = new Map<string, '生产' | '加速'>(); // `${base} ${building}` → target_mode
  const remainingPending: PendingModeSwitch[] = [];

  for (const p of pending) {
    const left = p.remaining_minutes - deltaMinutes;
    const base = (state.bases ?? []).find(b => b.id === p.base) ?? (state.bases ?? []).find(b => b.name === p.base);
    const building = base?.buildings?.find(b => b.name === p.building);
    if (!base || !building) {
      events.push({
        type: 'mode_switch_orphan',
        base: p.base,
        building: p.building,
        detail: `目标建筑已不存在，模式切换指令出账（${p.building}→${p.target_mode}）`,
      });
      continue;
    }
    if (left > 0) {
      remainingPending.push({ ...p, remaining_minutes: left });
      continue;
    }
    if (building.mode === p.target_mode) {
      events.push({
        type: 'mode_switch_done',
        base: p.base,
        building: p.building,
        detail: `模式校准完成，建筑已是「${p.target_mode}」模式（幂等）`,
      });
      continue;
    }
    matured.set(`${p.base} ${p.building}`, p.target_mode);
    events.push({
      type: 'mode_switch_done',
      base: p.base,
      building: p.building,
      detail: `模式校准完成：「${p.building}」切换为「${p.target_mode}」模式（720 分钟校准）`,
    });
  }

  if (matured.size === 0) {
    return { next: { ...state, pending_mode_switches: remainingPending }, events };
  }
  const nextBases = (state.bases ?? []).map(b => ({
    ...b,
    buildings: (b.buildings ?? []).map(building => {
      const target =
        matured.get(`${b.id ?? b.name ?? ''} ${building.name}`) ?? matured.get(`${b.name ?? ''} ${building.name}`);
      return target ? { ...building, mode: target } : building;
    }),
  }));
  return { next: { ...state, bases: nextBases, pending_mode_switches: remainingPending }, events };
}

/* ═══════════════ laneBoard：派生只读视图 ═══════════════ */

/**
 * 各基地各产线 {容量, 在编项, 排队数} 派生只读视图——占用完全派生自 queues（账本单一事实源），
 * 容量派生自 bases 建筑双模真源；供 UI 产线面板与日程前馈消费。
 * 只列出「容量>0 或有活动」的 (基地 × 产线)；lane.default 恒容量 1。
 * E2b：options.deployOf 注入后容量判定启用通道B（与引擎门同口径）；不注入与 v1 一致。
 */
export function laneBoard(
  state: LaneStateView,
  laneOf?: LaneOf,
  warnSink?: (warn: LaneWarn) => void,
  options: { deployOf?: DeployOf } = {},
): LaneBoardEntry[] {
  const entries = new Map<string, LaneBoardEntry>();
  const keyOf = (base: string, laneId: LaneId) => `${base} ${laneId}`;
  const ensure = (base: string, def: LaneDef): LaneBoardEntry => {
    const key = keyOf(base, def.laneId);
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        laneId: def.laneId,
        name: def.name,
        base,
        capacity: def.laneId === 'lane.default' ? 1 : (laneCapacityInBase(state, base, def, options.deployOf) ?? 1),
        active: [],
        queued: 0,
      };
      entries.set(key, entry);
    }
    return entry;
  };

  // 容量>0 的 (基地 × 命名产线) 预列（含零活动空线，供面板呈现可用产能）
  for (const base of state.bases ?? []) {
    const baseRef = base.id ?? base.name ?? '';
    for (const def of LANE_REGISTRY) {
      if (def.laneId === 'lane.default') continue;
      if ((laneCapacityInBase(state, baseRef, def, options.deployOf) ?? 0) > 0) ensure(baseRef, def);
    }
  }

  // 队列活动归线（研究/工程事务不属本模块辖区，跳过——研究走 researchSlots、工程走 engineeringSlots，
  // 三套注册表互不串道 D5-B）
  for (const txn of state.queues ?? []) {
    if (txn.type === '研究') continue;
    if (txn.type === '工程') continue; // ENG-PROJ-01 顺带守卫（主代理授权）：工程投影项归 engBoard，防展示层污染
    if (txn.status !== 'active' && txn.status !== 'queued') continue;
    const resolution = laneFor({ type: txn.type, item: txn.item, base: txn.base ?? '', lane: txn.lane }, laneOf);
    if (resolution.warn && warnSink) warnSink(resolution.warn);
    const def = LANE_BY_ID.get(resolution.laneId);
    if (!def) continue;
    const entry = ensure(txn.base ?? '', def);
    if (txn.status === 'active') entry.active.push(txn.item);
    else entry.queued += 1;
  }
  return [...entries.values()];
}

export {
  KIROV_HANGAR_BUILDING_NAMES,
  DREADNOUGHT_DOCK_BUILDING_NAMES,
  evaluateSovietSpecialCapacity,
  type SovietBuildingInputItem,
  type SovietSpecialCapacityEvaluation,
} from '../core/prerequisites';
