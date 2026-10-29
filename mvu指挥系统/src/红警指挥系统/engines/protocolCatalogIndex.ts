/**
 * protocolCatalogIndex.ts —— 协议目录统一归一化索引与同源查找表（DEC-CATALOG-01）
 *
 * 职责：
 * 1. 提供统一的协议键名归一化函数 `normalizeProtocolLookupKey`（兼容全半角括号、中点、短横线、斜杠、书名号、序号前缀、空白符与大小写）；
 * 2. 提供通用泛型协议查找表构建函数 `buildProtocolCatalogLookup` 与 `lookupProtocolCatalogEntry`；
 * 3. 收口协议基础回退表（18 条存量协议 + 内建兜底项 + 轨道默认目录），供
 *    `catalogEffective.ts`、`prerequisites.ts`、`PanelProtocol.vue`（及 `parsePipeline.ts`）同源复用。
 */

import {
  LEGACY_PROTOCOL_DEFINITIONS,
  resolveLegacyProtocolId,
  resolveLegacyProtocolName,
} from '../core/schema';

export interface ProtocolCatalogEntryBase {
  id?: string;
  ref?: string;
  name: string;
  aliases?: readonly string[];
  track?: string;
  faction?: string;
}

export interface DefaultProtocolCatalogEntry {
  id: string;
  name: string;
  faction: '苏联' | '盟军' | string;
  track: string;
  tier: 1 | 2 | 3;
  cost_points: number;
  experiment_cost_credits: number;
  desc: string;
  aliases?: readonly string[];
  reveals?: readonly string[];
}

export interface ProtocolIndexInputItem {
  id?: unknown;
  ref?: unknown;
  name?: unknown;
  aliases?: unknown;
  track?: unknown;
  faction?: unknown;
  [key: string]: unknown;
}

export type ProtocolIndexSource =
  | { protocols?: readonly ProtocolIndexInputItem[] | Record<string, ProtocolIndexInputItem> | null }
  | readonly ProtocolIndexInputItem[]
  | Record<string, ProtocolIndexInputItem>
  | null
  | undefined;

export interface ProtocolIdIndex {
  /** 协议权威 ID → 权威中文名（含目录动态项 + LEGACY_PROTOCOL_DEFINITIONS 18 条兜底） */
  idToName: Record<string, string>;
  /** 协议中文名 → 协议权威 ID（含目录动态项 + LEGACY_PROTOCOL_DEFINITIONS 18 条兜底） */
  nameToId: Record<string, string>;
  /** 别名 → 协议权威 ID */
  aliasToId: Record<string, string>;
  /** 别名 → 协议权威中文名 */
  aliasToName: Record<string, string>;
  /** 按名称/别名/ID 解析协议权威 ID */
  resolveProtocolIdByName: (nameOrAliasOrId: unknown) => string | undefined;
  /** 按 ID/别名/名称 解析协议权威中文名 */
  resolveProtocolNameById: (idOrAliasOrName: unknown) => string | undefined;
}

export interface ProtocolCatalogLookup<T = ProtocolCatalogEntryBase> extends ProtocolIdIndex {
  /** 原始收录条目列表 */
  entries: readonly T[];
  /** 权威 ID → 条目映射 */
  byId: Map<string, T>;
  /** 权威名称 → 条目映射 */
  byName: Map<string, T>;
  /** 归一化键（ID/名称/别名） → 条目映射 */
  byNormalizedKey: Map<string, T>;
  /** ID/别名 → 名称 Map（兼容 prerequisites 查表） */
  idToNameMap: Map<string, string>;
  /** 名称/别名 → ID Map（兼容 prerequisites 查表） */
  nameToIdMap: Map<string, string>;
  /** 已知协议键集合（含原始与归一化键） */
  knownProtocolKeys: Set<string>;
  /** 按任意 ID / 名称 / 别名查找条目 */
  get: (keyOrName: unknown) => T | undefined;
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * 统一协议键名归一化函数：
 * - 剥离首尾书名号/方括号/全半角括号包裹；
 * - 剥离前导数字序号（如 `44·`、`154.`、`72、`）；
 * - 统一全半角括号 `（）` → `()`、中点 `・•` → `·`、斜杠 `／⁄` → `/`、破折号/短横线 `—－–―--` → `-`；
 * - 移除全部空白字符并转小写。
 */
export function normalizeProtocolLookupKey(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/^[《「【（(]+|[》」】）)]+$/g, '')
    .replace(/^\d+\s*[·・•.、]\s*/, '')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/[·・•]/g, '·')
    .replace(/[／⁄]/g, '/')
    .replace(/[—－–―]+|--+/g, '-')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/* ═══════════════ 轨道与存量协议静态回退真源（对齐 §3.4 / §3.7.3 & FD-52） ═══════════════ */

export const COMMON_TRACK_NAMES: readonly string[] = Object.freeze([
  '通用前沿工程与战时动员',
  '通用战略授权与核常管控',
]);

export const SOVIET_TRACK_NAMES: readonly string[] = Object.freeze([
  '钢铁基干与国家动员',
  '过载工程与战区拒止',
  '国家战略工程与工业外延',
]);

export const ALLIED_TRACK_NAMES: readonly string[] = Object.freeze([
  '跨国联合防务条约',
  '相干光棱与全谱拟态遮蔽',
  '超时空跃迁与天基气象打击',
]);

/** 内建协议回退表（18 条存量协议 + FD-52 新增 14 条阵营协议 + D-P6/D-P12 验收夹具协议） */
export const BUILTIN_PROTOCOL_FALLBACKS: readonly {
  id: string;
  name: string;
  aliases?: readonly string[];
  faction?: string;
}[] = Object.freeze([
  ...LEGACY_PROTOCOL_DEFINITIONS,
  {
    id: 'sov.research.t2.superconducting_grid_protocol',
    name: '高压超导电网协议',
    aliases: ['高压超导电网协议'],
    faction: '苏联',
  },
  // FD-52 通用协议新标准名与旧名双向别名映射
  {
    id: 'sov.protocol.ra3.sputnik_one_way_deployment',
    name: '一次展开前沿节点协议',
    aliases: [
      'Sputnik一次展开前沿节点协议',
      '前哨基地展开协议',
      '06·Sputnik一次展开前沿节点协议',
      '06·一次展开前沿节点协议（三阵营通用）',
      '06·一次展开前沿节点协议（三阵营通用／含Sputnik制式）',
    ],
    faction: '通用',
  },
  {
    id: 'sov.protocol.ra3.crusher_crane_salvage',
    name: '战地重型抢修—拆件再生—废钢回炉协议',
    aliases: [
      'Crusher Crane维修—拆件—报废协议',
      '碾压起重机维修拆件协议',
      '07·Crusher Crane维修—拆件—报废协议',
      '07·战地重型抢修—拆件再生—废钢回炉协议（三阵营通用）',
    ],
    faction: '通用',
  },
  {
    id: 'sov.protocol.ra3.motorized_mortar_reserve',
    name: '摩托化迫击炮与伴随曲射后备分队协议',
    aliases: [
      '摩托化迫击炮后备分队协议',
      '11·摩托化迫击炮后备分队协议',
      '11·摩托化迫击炮与伴随曲射后备分队协议（三阵营通用）',
    ],
    faction: '通用',
  },
  {
    id: 'sov.protocol.ra3.mass_production_fold_in',
    name: '战时重工业流水线并网与大批量折叠调度协议',
    aliases: [
      'Mass Production工业调度折叠协议',
      '大规模生产工业调度折叠协议',
      '15·Mass Production工业调度折叠协议',
      '15·战时重工业流水线并网与大批量折叠调度协议（三阵营通用）',
    ],
    faction: '通用',
  },
  // FD-52 新增盟军 10 条 + 苏联 3 条 + 尤里 1 条
  {
    id: 'all.protocol.t1.stanag_hot_refuel_rearm',
    name: '北约STANAG野战油弹互认与热挂弹快反协议',
    aliases: ['STANAG热挂弹快反协议', '31·北约STANAG野战油弹互认与热挂弹快反协议'],
    faction: '盟军',
  },
  {
    id: 'all.protocol.t1.airborne_pathfinder_drop',
    name: '高空战术伞降与特战信标引导空投协议',
    aliases: ['盟军空降部队协议', 'Airborne空投协议', '32·高空战术伞降与特战信标引导空投协议'],
    faction: '盟军',
  },
  {
    id: 'all.protocol.t1.ifv_modular_turret_swap',
    name: '多功能步兵车（IFV）乘员即插即用武器站协议',
    aliases: ['IFV模块化武器站协议', '多功能步兵车武器切换协议', '33·多功能步兵车（IFV）乘员即插即用武器站协议'],
    faction: '盟军',
  },
  {
    id: 'all.protocol.t1.spy_infiltration_grid_blackout',
    name: '幽灵特工—敌后电网断电与火控信令劫持规程',
    aliases: ['盟军间谍渗透断电协议', '34·幽灵特工—敌后电网断电与火控信令劫持规程'],
    faction: '盟军',
  },
  {
    id: 'all.protocol.t2.prism_cascade_refraction_network',
    name: '光棱塔—光棱坦克多节点次级折射串联网协议',
    aliases: ['光棱折射串联网协议', '35·光棱塔—光棱坦克多节点次级折射串联网协议'],
    faction: '盟军',
  },
  {
    id: 'all.protocol.t2.mirage_mobile_gap_ambush',
    name: '幻影拟态场—全频段机动裂缝车并网黑障伏击协议',
    aliases: ['裂缝幻影黑障伏击协议', '36·幻影拟态场—全频段机动裂缝车并网黑障伏击协议'],
    faction: '盟军',
  },
  {
    id: 'all.protocol.t1.chrono_miner_phase_return',
    name: '超时空采矿车—精炼厂单向相位折跃卸载规程',
    aliases: ['超时空采矿车折跃卸载协议', '37·超时空采矿车—精炼厂单向相位折跃卸载规程'],
    faction: '盟军',
  },
  {
    id: 'all.protocol.t2.chrono_ricoagulation_damping',
    name: '超时空突击群—相位再凝固阻尼与防分子撕裂协议',
    aliases: ['超时空相位再凝固护盾协议', '38·超时空突击群—相位再凝固阻尼与防分子撕裂协议'],
    faction: '盟军',
  },
  {
    id: 'all.protocol.t2.tactical_weather_nuclear_grid_storm',
    name: '战术气象车—移动核能车驻锄并网与局部雷暴引导协议',
    aliases: ['战术气象车核能并网雷暴协议', '39·战术气象车—移动核能车驻锄并网与局部雷暴引导协议'],
    faction: '盟军',
  },
  {
    id: 'all.protocol.t3.zeus_orbital_prism_weather_interlock',
    name: '「宙斯之盾」天基超级光棱炮—电离层透镜气象联锁齐射协议',
    aliases: [
      '天基超级光棱炮气象联锁协议',
      '宙斯之盾天基光棱联锁协议',
      '40·「宙斯之盾」天基超级光棱炮—电离层透镜气象联锁齐射协议',
    ],
    faction: '盟军',
  },
  {
    id: 'sov.protocol.t2.apocalypse_rhino_crush_salvo',
    name: '天启—犀牛重装甲集群履带碾压与双炮序列齐射条令',
    aliases: ['天启重装甲集群碾压齐射条令', '41·天启—犀牛重装甲集群履带碾压与双炮序列齐射条令'],
    faction: '苏联',
  },
  {
    id: 'sov.protocol.t2.mobile_iron_curtain_pulse_grid_assault',
    name: '机动铁幕车—超导脉冲供能车驻锄并网集群赋盾协议',
    aliases: ['机动铁幕车集群赋盾协议', '42·机动铁幕车—超导脉冲供能车驻锄并网集群赋盾协议'],
    faction: '苏联',
  },
  {
    id: 'sov.protocol.t3.red_star_fusion_superconducting_grid_overdrive',
    name: '红星科学城—重核聚变与超导脉冲电网极限并网调度协议',
    aliases: ['红星超导脉冲电网极限并网协议', '43·红星科学城—重核聚变与超导脉冲电网极限并网调度协议'],
    faction: '苏联',
  },
  {
    id: 'yuri.protocol.t2.mobile_mutator_shepherd_berserk_storm',
    name: '机动基因谐振突变车—牧羊人恒温并机与狂兽化风暴协议',
    aliases: ['机动基因车牧羊人并机协议', '狂兽化风暴协议', '44·机动基因谐振突变车—牧羊人恒温并机与狂兽化风暴协议'],
    faction: '尤里',
  },
]);

const legacyAliasesById = new Map<string, readonly string[]>(
  LEGACY_PROTOCOL_DEFINITIONS.map(def => [def.id, def.aliases]),
);

export const DEFAULT_PROTOCOL_CATALOG: readonly DefaultProtocolCatalogEntry[] = Object.freeze([
  // ── 通用轨道 1：通用前沿工程与战时动员（4 条） ──
  {
    id: 'sov.protocol.ra3.sputnik_one_way_deployment',
    name: '一次展开前沿节点协议',
    faction: '通用',
    track: '通用前沿工程与战时动员',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '【三阵营通用】规范前沿勘探车/前哨工程车抵达远端资源区或交通要冲后，以车体大梁液压打桩、解体锚固为一次性前沿扩展节点。',
    aliases: [
      ...(legacyAliasesById.get('sov.protocol.ra3.sputnik_one_way_deployment') ?? []),
      'Sputnik一次展开前沿节点协议',
      '前哨基地展开协议',
    ],
  },
  {
    id: 'sov.protocol.ra3.crusher_crane_salvage',
    name: '战地重型抢修—拆件再生—废钢回炉协议',
    faction: '通用',
    track: '通用前沿工程与战时动员',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '【三阵营通用】整合战地维修厂、工程起重机与回收熔炉，建立火线战损载具“抢修—拆件再生—废钢回炉”三级闭环。',
    aliases: [
      ...(legacyAliasesById.get('sov.protocol.ra3.crusher_crane_salvage') ?? []),
      'Crusher Crane维修—拆件—报废协议',
      '碾压起重机维修拆件协议',
    ],
  },
  {
    id: 'sov.protocol.ra3.motorized_mortar_reserve',
    name: '摩托化迫击炮与伴随曲射后备分队协议',
    faction: '通用',
    track: '通用前沿工程与战时动员',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '【三阵营通用】授权一线步兵营利用高机动越野车或挎斗摩托编组伴随迫击炮快反分队，提供步坦协同曲射压制与烟幕遮蔽。',
    aliases: [
      ...(legacyAliasesById.get('sov.protocol.ra3.motorized_mortar_reserve') ?? []),
      '摩托化迫击炮后备分队协议',
    ],
  },
  {
    id: 'sov.protocol.ra3.mass_production_fold_in',
    name: '战时重工业流水线并网与大批量折叠调度协议',
    faction: '通用',
    track: '通用前沿工程与战时动员',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '【三阵营通用】通过多座兵工厂/船厂跨厂工装共享与流水线节拍折叠，显著压缩大批量同型装备的单台工时与边际成本。',
    aliases: [
      ...(legacyAliasesById.get('sov.protocol.ra3.mass_production_fold_in') ?? []),
      'Mass Production工业调度折叠协议',
      '大规模生产工业调度折叠协议',
    ],
  },

  // ── 通用轨道 2：通用战略授权与核常管控（3 条） ──
  {
    id: 'sov.research.t2.nuclear_exercise_isolation_notification',
    name: '核演习隔离与通报规程',
    faction: '通用',
    track: '通用战略授权与核常管控',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '【全阵营通用】确立战略核力量演训信令与实战点火回路的物理硬隔离、分级回执点验及防误判降级通报条令。',
    aliases: legacyAliasesById.get('sov.research.t2.nuclear_exercise_isolation_notification'),
  },
  {
    id: 'sov.research.t3.conventional_strategic_authorization_isolation',
    name: '常规战略打击授权隔离协议',
    faction: '通用',
    track: '通用战略授权与核常管控',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '【全阵营通用】构建高超声速滑翔弹与天基常规战略武器规划锁定与终段点火的双阶物理隔离授权链。',
    aliases: legacyAliasesById.get('sov.research.t3.conventional_strategic_authorization_isolation'),
  },
  {
    id: 'sov.research.t3.nuclear_command_succession_rebuild',
    name: '核指挥接替与态势重建规程',
    faction: '通用',
    track: '通用战略授权与核常管控',
    tier: 3,
    cost_points: 1,
    experiment_cost_credits: 4000,
    desc: '【全阵营通用】依托深层地下掩体、超低频对潜通信与空中末日指挥机冗余网，保障极端打击下战略指挥链完整接替。',
    aliases: legacyAliasesById.get('sov.research.t3.nuclear_command_succession_rebuild'),
  },

  // ── 苏联轨道 1：钢铁基干与国家动员（3 条） ──
  {
    id: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
    name: '战斗工兵—预制战斗碉堡协议',
    faction: '苏联',
    track: '钢铁基干与国家动员',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '授权前线战斗工兵开展模块化预制钢筋混凝土战斗碉堡快速构筑。',
    aliases: legacyAliasesById.get('sov.protocol.ra3.combat_engineer_prefab_bunker'),
  },
  {
    id: 'sov.protocol.ra3.urban_molotov_magnetic_mine',
    name: '动员兵燃烧瓶／防空兵附着式反机动雷协议',
    faction: '苏联',
    track: '钢铁基干与国家动员',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '为一线动员兵与防空步兵配发街垒燃烧瓶及磁吸式反装甲机动雷具。',
    aliases: legacyAliasesById.get('sov.protocol.ra3.urban_molotov_magnetic_mine'),
  },
  {
    id: 'sov.protocol.t2.apocalypse_rhino_crush_salvo',
    name: '天启—犀牛重装甲集群履带碾压与双炮序列齐射条令',
    faction: '苏联',
    track: '钢铁基干与国家动员',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '授权天启重型坦克开启车首磁力破障切割器执行物理履带碾压，并协同伴随犀牛坦克实施 125mm 双炮序列齐射。',
    aliases: ['天启重装甲集群碾压齐射条令', '41·天启—犀牛重装甲集群履带碾压与双炮序列齐射条令'],
  },

  // ── 苏联轨道 2：过载工程与战区拒止（7 条） ──
  {
    id: 'sov.protocol.ra3.terror_drone_dual_mode',
    name: '恐怖机器人拆解／短时电磁锁止双任务包协议',
    faction: '苏联',
    track: '过载工程与战区拒止',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '为恐怖机器人加装机械破拆爪与短时电磁停滞脉冲双模任务载荷。',
    aliases: legacyAliasesById.get('sov.protocol.ra3.terror_drone_dual_mode'),
  },
  {
    id: 'sov.protocol.ra3.tesla_mobile_parallel_charge',
    name: '磁暴步兵移动储能并联充能协议',
    faction: '苏联',
    track: '过载工程与战区拒止',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '规范磁暴步兵便携电容组与磁暴线圈阵列的野战并联过载充能条令。',
    aliases: legacyAliasesById.get('sov.protocol.ra3.tesla_mobile_parallel_charge'),
  },
  {
    id: 'sov.research.t2.iron_curtain_emergency_overload',
    name: '铁幕紧急过载协议',
    faction: '苏联',
    track: '过载工程与战区拒止',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '在独立高压电网支撑下驱动铁幕装置进入短时紧急谐振过载防护态。',
    aliases: legacyAliasesById.get('sov.research.t2.iron_curtain_emergency_overload'),
  },
  {
    id: 'sov.protocol.ra3.v4_precision_payload_package',
    name: 'V3体系V4精确弹／多载荷任务包协议',
    faction: '苏联',
    track: '过载工程与战区拒止',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '升级远程火箭投送体系，换装 V4 末端制导精确弹头与集束多载荷包。',
    aliases: legacyAliasesById.get('sov.protocol.ra3.v4_precision_payload_package'),
  },
  {
    id: 'sov.protocol.ra3.kirov_dreadnought_overlimit',
    name: '基洛夫—无畏越限运行协议',
    faction: '苏联',
    track: '过载工程与战区拒止',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '解除基洛夫空艇推进器与无畏级战列舰齐射机构的常规安全出力限制。',
    aliases: legacyAliasesById.get('sov.protocol.ra3.kirov_dreadnought_overlimit'),
  },
  {
    id: 'sov.protocol.ra3.anchored_magnetic_lock',
    name: '地锚式磁锁／局部奇点压制区协议',
    faction: '苏联',
    track: '过载工程与战区拒止',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '布设高强地锚式磁锁发生器，形成局部高磁束缚与奇点压制拒止场。',
    aliases: legacyAliasesById.get('sov.protocol.ra3.anchored_magnetic_lock'),
  },
  {
    id: 'sov.protocol.t2.mobile_iron_curtain_pulse_grid_assault',
    name: '机动铁幕车—超导脉冲供能车驻锄并网集群赋盾协议',
    faction: '苏联',
    track: '过载工程与战区拒止',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '联动机动铁幕伴随投射车与野战超导磁能脉冲供能车驻锄并网，对 4–6 台重型主战坦克同步施加集群铁幕力场。',
    aliases: ['机动铁幕车集群赋盾协议', '42·机动铁幕车—超导脉冲供能车驻锄并网集群赋盾协议'],
  },

  // ── 苏联轨道 3：国家战略工程与工业外延（2 条） ──
  {
    id: 'sov.protocol.ra3.hammer_inventory_reentry',
    name: '受库存与授权约束的轨道常规载荷再入协议',
    faction: '苏联',
    track: '国家战略工程与工业外延',
    tier: 3,
    cost_points: 1,
    experiment_cost_credits: 4000,
    desc: '在战略库存与双阶授权约束下调用轨道常规动能/高爆再入打击载荷。',
    aliases: legacyAliasesById.get('sov.protocol.ra3.hammer_inventory_reentry'),
  },
  {
    id: 'sov.protocol.t3.red_star_fusion_superconducting_grid_overdrive',
    name: '红星科学城—重核聚变与超导脉冲电网极限并网调度协议',
    faction: '苏联',
    track: '国家战略工程与工业外延',
    tier: 3,
    cost_points: 1,
    experiment_cost_credits: 4000,
    desc: '依托红星科学城将重核聚变/快堆电站与超导磁储能环网深度并网，消除铁幕与磁暴防线极限并发时的拉闸断电风险。',
    aliases: ['红星超导脉冲电网极限并网协议', '43·红星科学城—重核聚变与超导脉冲电网极限并网调度协议'],
  },

  // ── 盟军轨道 1：跨国联合防务条约（4 条） ──
  {
    id: 'all.protocol.t1.stanag_hot_refuel_rearm',
    name: '北约STANAG野战油弹互认与热挂弹快反协议',
    faction: '盟军',
    track: '跨国联合防务条约',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '统一北约 STANAG 弹药挂架与 JP-8 燃油标准，授权前线机场与整备点执行“发动机不停机热加油、热挂弹”。',
    aliases: ['STANAG热挂弹快反协议', '31·北约STANAG野战油弹互认与热挂弹快反协议'],
  },
  {
    id: 'all.protocol.t1.airborne_pathfinder_drop',
    name: '高空战术伞降与特战信标引导空投协议',
    faction: '盟军',
    track: '跨国联合防务条约',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '经典盟军「空降部队（Airborne）」条令：授权运输机群依托前线特战信标实施高跳低开精准伞降投送。',
    aliases: ['盟军空降部队协议', 'Airborne空投协议', '32·高空战术伞降与特战信标引导空投协议'],
  },
  {
    id: 'all.research.t1.european_defense_agreement',
    name: '欧洲联合防务协议',
    faction: '盟军',
    track: '跨国联合防务条约',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '接入欧洲战区联合防务标准，开放欧陆联军特种技术装备与联合实验配额。',
    aliases: legacyAliasesById.get('all.research.t1.european_defense_agreement'),
  },
  {
    id: 'all.research.t1.pacific_rim_defense_agreement',
    name: '环太平洋防务合作协议',
    faction: '盟军',
    track: '跨国联合防务条约',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '接入环太平洋防务协作网络，开放远东与太平洋盟军先进海空装备引进通道。',
    aliases: legacyAliasesById.get('all.research.t1.pacific_rim_defense_agreement'),
  },

  // ── 盟军轨道 2：相干光棱与全谱拟态遮蔽（4 条） ──
  {
    id: 'all.protocol.t1.ifv_modular_turret_swap',
    name: '多功能步兵车（IFV）乘员即插即用武器站协议',
    faction: '盟军',
    track: '相干光棱与全谱拟态遮蔽',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '授权多功能步兵车根据搭载步兵工种实时自适应切换机枪、防空反坦导弹、抢修机械臂或稳像狙击武器站。',
    aliases: ['IFV模块化武器站协议', '多功能步兵车武器切换协议', '33·多功能步兵车（IFV）乘员即插即用武器站协议'],
  },
  {
    id: 'all.protocol.t1.spy_infiltration_grid_blackout',
    name: '幽灵特工—敌后电网断电与火控信令劫持规程',
    faction: '盟军',
    track: '相干光棱与全谱拟态遮蔽',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '授权伪装特工携带数字 IFF 克隆密匙与短路逻辑弹潜入敌方电站或实验室，触发防空网断电或重置敌方超武充能。',
    aliases: ['盟军间谍渗透断电协议', '34·幽灵特工—敌后电网断电与火控信令劫持规程'],
  },
  {
    id: 'all.protocol.t2.prism_cascade_refraction_network',
    name: '光棱塔—光棱坦克多节点次级折射串联网协议',
    faction: '盟军',
    track: '相干光棱与全谱拟态遮蔽',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '授权多座光棱塔与光棱坦克互为次级反射中继，将多束泵浦激光相干合束注入主发射节点，打出超视距倍增穿透死光。',
    aliases: ['光棱折射串联网协议', '35·光棱塔—光棱坦克多节点次级折射串联网协议'],
  },
  {
    id: 'all.protocol.t2.mirage_mobile_gap_ambush',
    name: '幻影拟态场—全频段机动裂缝车并网黑障伏击协议',
    faction: '盟军',
    track: '相干光棱与全谱拟态遮蔽',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '联动全频段机动裂缝遮蔽车、移动核能供电车与幻影坦克，撑开 3 公里驻锄黑障穹顶并赋予伏击群首轮开火不破隐加成。',
    aliases: ['裂缝幻影黑障伏击协议', '36·幻影拟态场—全频段机动裂缝车并网黑障伏击协议'],
  },

  // ── 盟军轨道 3：超时空跃迁与天基气象打击（4 条） ──
  {
    id: 'all.protocol.t1.chrono_miner_phase_return',
    name: '超时空采矿车—精炼厂单向相位折跃卸载规程',
    faction: '盟军',
    track: '超时空跃迁与天基气象打击',
    tier: 1,
    cost_points: 1,
    experiment_cost_credits: 500,
    desc: '授权满载或遇袭的超时空采矿车直接锁定矿石精炼厂地面信标，执行单向回城相位折跃卸载。',
    aliases: ['超时空采矿车折跃卸载协议', '37·超时空采矿车—精炼厂单向相位折跃卸载规程'],
  },
  {
    id: 'all.protocol.t2.chrono_ricoagulation_damping',
    name: '超时空突击群—相位再凝固阻尼与防分子撕裂协议',
    faction: '盟军',
    track: '超时空跃迁与天基气象打击',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '为超时空轻型坦克及传送突击群加装量子陀螺相位阻尼器，将跃迁落地后的再凝固脆弱期从 10 秒压缩至 4 秒。',
    aliases: ['超时空相位再凝固护盾协议', '38·超时空突击群—相位再凝固阻尼与防分子撕裂协议'],
  },
  {
    id: 'all.protocol.t2.tactical_weather_nuclear_grid_storm',
    name: '战术气象车—移动核能车驻锄并网与局部雷暴引导协议',
    faction: '盟军',
    track: '超时空跃迁与天基气象打击',
    tier: 2,
    cost_points: 1,
    experiment_cost_credits: 1500,
    desc: '联动战术人工气象调控车与野战移动式核能供电保障车驻锄并网，在敌军集结区定点诱发局部雷暴闪电与强风切变。',
    aliases: ['战术气象车核能并网雷暴协议', '39·战术气象车—移动核能车驻锄并网与局部雷暴引导协议'],
  },
  {
    id: 'all.protocol.t3.zeus_orbital_prism_weather_interlock',
    name: '「宙斯之盾」天基超级光棱炮—电离层透镜气象联锁齐射协议',
    faction: '盟军',
    track: '超时空跃迁与天基气象打击',
    tier: 3,
    cost_points: 1,
    experiment_cost_credits: 4000,
    desc: '先由气象调制系统排空云雾、电离出大气光学自聚焦透镜通道，再引导近地轨道「天基超级光棱炮」实施零衰减贯顶死光齐射。',
    aliases: [
      '天基超级光棱炮气象联锁协议',
      '宙斯之盾天基光棱联锁协议',
      '40·「宙斯之盾」天基超级光棱炮—电离层透镜气象联锁齐射协议',
    ],
  },
]);

/**
 * 合并默认协议目录与外部目录协议条目（使用归一化键匹配同源条目）。
 */
export function mergeDefaultProtocolCatalog<
  T extends { id: string; name: string; faction?: string; track?: string; desc?: string; aliases?: readonly string[] },
>(defaults: readonly T[], fromCatalog?: readonly T[] | null): readonly T[] {
  if (!Array.isArray(fromCatalog) || fromCatalog.length === 0) {
    return defaults;
  }
  const defaultLookup = buildProtocolCatalogLookup(defaults, { includeLegacyFallbacks: false });
  const shouldMergeDefaults = fromCatalog.some(
    item =>
      item &&
      typeof item.id === 'string' &&
      (item.id.includes('.') || lookupProtocolCatalogEntry(defaultLookup, item.id || item.name) !== undefined),
  );
  if (!shouldMergeDefaults) {
    return fromCatalog;
  }
  const result: T[] = [...defaults];
  const indexById = new Map<string, number>();
  const indexByName = new Map<string, number>();
  const indexByNorm = new Map<string, number>();
  const registerIndex = (item: T, idx: number) => {
    if (item.id) {
      indexById.set(item.id, idx);
      const normId = normalizeProtocolLookupKey(item.id);
      if (normId) indexByNorm.set(normId, idx);
    }
    if (item.name) {
      indexByName.set(item.name, idx);
      const normName = normalizeProtocolLookupKey(item.name);
      if (normName) indexByNorm.set(normName, idx);
    }
    if (Array.isArray(item.aliases)) {
      for (const alias of item.aliases) {
        if (typeof alias === 'string' && alias.trim()) {
          const normAlias = normalizeProtocolLookupKey(alias);
          if (normAlias && !indexByNorm.has(normAlias)) indexByNorm.set(normAlias, idx);
        }
      }
    }
  };
  result.forEach((item, idx) => registerIndex(item, idx));

  for (const item of fromCatalog) {
    const normId = item.id ? normalizeProtocolLookupKey(item.id) : '';
    const normName = item.name ? normalizeProtocolLookupKey(item.name) : '';
    const existingIdx =
      indexById.get(item.id) ??
      indexByName.get(item.name) ??
      (normId ? indexByNorm.get(normId) : undefined) ??
      (normName ? indexByNorm.get(normName) : undefined);
    if (existingIdx !== undefined) {
      const base = result[existingIdx];
      // FD-52 通用协议防回退守卫：若底表已升格为「通用」协议，而宿主旧世界书缓存仍残留旧「苏联」归属或旧轨道名，强制以底表通用归属与轨道为准
      const isCommonizedBase = base.faction === '通用' || base.faction === 'common';
      const isStaleLegacyTrack =
        item.track === '钢铁基干与国家动员' ||
        item.track === '国家战略工程与工业外延' ||
        item.track === '战略授权与核管控' ||
        item.track === '通用前沿工程与节点展开';
      const preserveCommonBase = isCommonizedBase && (item.faction === '苏联' || isStaleLegacyTrack);

      result[existingIdx] = {
        ...base,
        ...item,
        name: preserveCommonBase ? base.name : item.name || base.name,
        faction: preserveCommonBase ? base.faction : item.faction || base.faction,
        track: preserveCommonBase ? base.track : item.track || base.track,
        desc: preserveCommonBase ? base.desc : item.desc || base.desc,
      };
      registerIndex(result[existingIdx], existingIdx);
    } else {
      const idx = result.length;
      result.push(item);
      registerIndex(item, idx);
    }
  }
  return result;
}

export function extractProtocolItemsFromSource(source: ProtocolIndexSource): ProtocolIndexInputItem[] {
  if (!source) return [];
  if (Array.isArray(source)) return source;
  if (isPlainRecord(source)) {
    if ('protocols' in source) {
      const inner = source.protocols;
      if (Array.isArray(inner)) return inner;
      if (isPlainRecord(inner)) return Object.values(inner) as ProtocolIndexInputItem[];
      return [];
    }
    // 排除 ProtocolIdIndex / ProtocolCatalogLookup 对象被误当成字典源
    if ('idToName' in source && 'nameToId' in source) {
      return [];
    }
    return Object.values(source) as ProtocolIndexInputItem[];
  }
  return [];
}

export interface BuildProtocolCatalogLookupOptions {
  /** 是否自动合并 LEGACY_PROTOCOL_DEFINITIONS 18 条存量协议作为 ID/名称解析兜底（默认 true） */
  includeLegacyFallbacks?: boolean;
  /** 是否额外合并 BUILTIN_PROTOCOL_FALLBACKS（如高压超导电网协议，默认 false） */
  includeBuiltinFallbacks?: boolean;
  /** 后注册同名/同 ID 条目是否覆盖已有映射（默认 false 先到先得；prerequisites 场景可设为 true） */
  preferLaterEntries?: boolean;
}

/**
 * 构建统一协议查找表（支持泛型条目还原 + ID/名称/全半角别名双向解析）。
 */
export function buildProtocolCatalogLookup<
  T extends { id?: string; name: string; aliases?: readonly string[]; track?: string; faction?: string } = ProtocolCatalogEntryBase,
>(
  items?: readonly T[] | ProtocolIndexSource,
  options: BuildProtocolCatalogLookupOptions = {},
): ProtocolCatalogLookup<T> {
  const {
    includeLegacyFallbacks = true,
    includeBuiltinFallbacks = false,
    preferLaterEntries = false,
  } = options;

  const entries: T[] = [];
  const byId = new Map<string, T>();
  const byName = new Map<string, T>();
  const byNormalizedKey = new Map<string, T>();

  const idToName: Record<string, string> = {};
  const nameToId: Record<string, string> = {};
  const aliasToId: Record<string, string> = {};
  const aliasToName: Record<string, string> = {};

  const idToNameMap = new Map<string, string>();
  const nameToIdMap = new Map<string, string>();
  const knownProtocolKeys = new Set<string>();
  const normalizedToEntry = new Map<string, { id: string; name: string }>();

  const rawItems = Array.isArray(items)
    ? (items as readonly ProtocolIndexInputItem[])
    : extractProtocolItemsFromSource(items as ProtocolIndexSource);

  const registerKeyPair = (
    rawId: string,
    rawName: string,
    rawAliases: readonly unknown[] | undefined,
    sourceItem?: T,
    allowOverride = preferLaterEntries,
  ) => {
    const id = rawId || (rawName ? (resolveLegacyProtocolId(rawName) ?? rawName) : '');
    const name = rawName || (rawId ? (resolveLegacyProtocolName(rawId) ?? rawId) : '');

    if (rawId) {
      knownProtocolKeys.add(rawId);
      const normRawId = normalizeProtocolLookupKey(rawId);
      if (normRawId) knownProtocolKeys.add(normRawId);
    }
    if (rawName) {
      knownProtocolKeys.add(rawName);
      const normRawName = normalizeProtocolLookupKey(rawName);
      if (normRawName) knownProtocolKeys.add(normRawName);
    }

    if (!id || !name) return;

    knownProtocolKeys.add(id);
    knownProtocolKeys.add(name);

    if (allowOverride || !(id in idToName)) idToName[id] = name;
    if (allowOverride || !(name in nameToId)) nameToId[name] = id;

    if (allowOverride || !idToNameMap.has(id)) idToNameMap.set(id, name);
    if (allowOverride || !nameToIdMap.has(name)) nameToIdMap.set(name, id);
    if (allowOverride || !nameToIdMap.has(id)) nameToIdMap.set(id, id);
    if (allowOverride || !idToNameMap.has(name)) idToNameMap.set(name, name);

    const mappedName = idToName[id] ?? name;
    const pair = { id, name: mappedName };
    const normId = normalizeProtocolLookupKey(id);
    const normName = normalizeProtocolLookupKey(name);

    if (normId) {
      knownProtocolKeys.add(normId);
      if (allowOverride || !normalizedToEntry.has(normId)) normalizedToEntry.set(normId, pair);
    }
    if (normName) {
      knownProtocolKeys.add(normName);
      if (allowOverride || !normalizedToEntry.has(normName)) normalizedToEntry.set(normName, pair);
    }

    const entryObj: T =
      sourceItem ??
      ({
        id,
        name: mappedName,
        ...(Array.isArray(rawAliases)
          ? { aliases: rawAliases.filter((a): a is string => typeof a === 'string') }
          : {}),
      } as unknown as T);

    if (sourceItem) {
      entries.push(sourceItem);
    }
    if (allowOverride || !byId.has(id)) byId.set(id, entryObj);
    if (allowOverride || !byName.has(name)) byName.set(name, entryObj);
    if (normId && (allowOverride || !byNormalizedKey.has(normId))) byNormalizedKey.set(normId, entryObj);
    if (normName && (allowOverride || !byNormalizedKey.has(normName))) byNormalizedKey.set(normName, entryObj);

    if (Array.isArray(rawAliases)) {
      for (const rawAlias of rawAliases) {
        if (typeof rawAlias !== 'string') continue;
        const alias = rawAlias.trim();
        if (!alias) continue;
        knownProtocolKeys.add(alias);
        if (alias !== mappedName && (allowOverride || !(alias in aliasToId))) aliasToId[alias] = id;
        if (alias !== mappedName && (allowOverride || !(alias in aliasToName))) aliasToName[alias] = mappedName;
        if (allowOverride || !nameToIdMap.has(alias)) nameToIdMap.set(alias, id);
        if (allowOverride || !idToNameMap.has(alias)) idToNameMap.set(alias, mappedName);

        const normAlias = normalizeProtocolLookupKey(alias);
        if (normAlias) {
          knownProtocolKeys.add(normAlias);
          if (allowOverride || !normalizedToEntry.has(normAlias)) normalizedToEntry.set(normAlias, pair);
          if (allowOverride || !byNormalizedKey.has(normAlias)) byNormalizedKey.set(normAlias, entryObj);
        }
      }
    }
  };

  // 1. 第一优先级：传入的协议条目
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const rawId =
      (typeof item.id === 'string' && item.id.trim()) ||
      (typeof item.ref === 'string' && item.ref.trim()) ||
      '';
    const rawName = typeof item.name === 'string' ? item.name.trim() : '';
    const aliases = Array.isArray(item.aliases) ? item.aliases : undefined;
    registerKeyPair(rawId, rawName, aliases, item as unknown as T, preferLaterEntries);
  }

  // 2. 第二优先级：存量协议与内建回退（不覆盖已注册的同 ID/同名条目）
  if (includeLegacyFallbacks || includeBuiltinFallbacks) {
    const fallbackList = includeBuiltinFallbacks ? BUILTIN_PROTOCOL_FALLBACKS : LEGACY_PROTOCOL_DEFINITIONS;
    for (const fallback of fallbackList) {
      const existingEntry = byId.get(fallback.id) ?? byName.get(fallback.name);
      registerKeyPair(fallback.id, fallback.name, fallback.aliases, existingEntry, false);
    }
  }

  const resolveId = (query: unknown): string | undefined => {
    if (typeof query !== 'string' || query.trim() === '') return undefined;
    const trimmed = query.trim();
    if (Object.prototype.hasOwnProperty.call(nameToId, trimmed)) return nameToId[trimmed];
    if (Object.prototype.hasOwnProperty.call(idToName, trimmed)) return trimmed;
    if (Object.prototype.hasOwnProperty.call(aliasToId, trimmed)) return aliasToId[trimmed];
    if (nameToIdMap.has(trimmed)) return nameToIdMap.get(trimmed);
    const norm = normalizeProtocolLookupKey(trimmed);
    const hit = normalizedToEntry.get(norm);
    if (hit) return hit.id;
    return includeLegacyFallbacks ? resolveLegacyProtocolId(trimmed) : undefined;
  };

  const resolveName = (query: unknown): string | undefined => {
    if (typeof query !== 'string' || query.trim() === '') return undefined;
    const trimmed = query.trim();
    if (Object.prototype.hasOwnProperty.call(idToName, trimmed)) return idToName[trimmed];
    if (Object.prototype.hasOwnProperty.call(nameToId, trimmed)) return trimmed;
    if (Object.prototype.hasOwnProperty.call(aliasToName, trimmed)) return aliasToName[trimmed];
    if (idToNameMap.has(trimmed)) return idToNameMap.get(trimmed);
    const norm = normalizeProtocolLookupKey(trimmed);
    const hit = normalizedToEntry.get(norm);
    if (hit) return hit.name;
    return includeLegacyFallbacks ? resolveLegacyProtocolName(trimmed) : undefined;
  };

  const getEntry = (keyOrName: unknown): T | undefined => {
    if (typeof keyOrName !== 'string' || keyOrName.trim() === '') return undefined;
    const trimmed = keyOrName.trim();
    const direct = byId.get(trimmed) ?? byName.get(trimmed);
    if (direct) return direct;

    const norm = normalizeProtocolLookupKey(trimmed);
    if (norm) {
      const normHit = byNormalizedKey.get(norm);
      if (normHit) return normHit;
    }

    const legacyId = resolveLegacyProtocolId(trimmed);
    if (legacyId) {
      const hitById = byId.get(legacyId) ?? byNormalizedKey.get(normalizeProtocolLookupKey(legacyId));
      if (hitById) return hitById;
    }
    const legacyName = resolveLegacyProtocolName(trimmed);
    if (legacyName) {
      const hitByName = byName.get(legacyName) ?? byNormalizedKey.get(normalizeProtocolLookupKey(legacyName));
      if (hitByName) return hitByName;
    }
    return undefined;
  };

  return {
    entries,
    byId,
    byName,
    byNormalizedKey,
    idToName,
    nameToId,
    aliasToId,
    aliasToName,
    idToNameMap,
    nameToIdMap,
    knownProtocolKeys,
    get: getEntry,
    resolveProtocolIdByName: resolveId,
    resolveProtocolNameById: resolveName,
  };
}

/**
 * 在协议查找表中按 ID、名称或全半角别名查找协议条目。
 */
export function lookupProtocolCatalogEntry<T>(
  lookup: ProtocolCatalogLookup<T> | null | undefined,
  keyOrName: unknown,
): T | undefined {
  if (!lookup) return undefined;
  return lookup.get(keyOrName);
}

export function isProtocolIdIndex(val: unknown): val is ProtocolIdIndex {
  return (
    isPlainRecord(val) &&
    typeof val.resolveProtocolIdByName === 'function' &&
    typeof val.resolveProtocolNameById === 'function'
  );
}

/**
 * 从有效目录（或协议数组/字典）构建协议名↔ID 双向索引（纯函数，兼容 catalogEffective.ts 既有契约）。
 */
export function buildProtocolIdIndex(catalog?: ProtocolIndexSource): ProtocolIdIndex {
  if (isProtocolIdIndex(catalog)) {
    return catalog;
  }
  const lookup = buildProtocolCatalogLookup(catalog, {
    includeLegacyFallbacks: true,
    includeBuiltinFallbacks: false,
    preferLaterEntries: false,
  });
  return {
    idToName: lookup.idToName,
    nameToId: lookup.nameToId,
    aliasToId: lookup.aliasToId,
    aliasToName: lookup.aliasToName,
    resolveProtocolIdByName: lookup.resolveProtocolIdByName,
    resolveProtocolNameById: lookup.resolveProtocolNameById,
  };
}

/**
 * 按协议名称（或别名/ID）解析协议权威 ID。
 * 兼容 `(name, catalogOrIndex?)` 与 `(catalogOrIndex, name)` 两种入参顺序。
 */
export function resolveProtocolIdByName(
  nameOrCatalog: unknown,
  catalogOrName?: ProtocolIdIndex | ProtocolIndexSource | unknown,
): string | undefined {
  if (typeof nameOrCatalog === 'string') {
    const idx = isProtocolIdIndex(catalogOrName)
      ? catalogOrName
      : buildProtocolIdIndex(catalogOrName as ProtocolIndexSource);
    return idx.resolveProtocolIdByName(nameOrCatalog);
  }
  if (typeof catalogOrName === 'string') {
    const idx = isProtocolIdIndex(nameOrCatalog)
      ? nameOrCatalog
      : buildProtocolIdIndex(nameOrCatalog as ProtocolIndexSource);
    return idx.resolveProtocolIdByName(catalogOrName);
  }
  return undefined;
}

/**
 * 按协议 ID（或别名/名称）解析协议权威中文名。
 * 兼容 `(id, catalogOrIndex?)` 与 `(catalogOrIndex, id)` 两种入参顺序。
 */
export function resolveProtocolNameById(
  idOrCatalog: unknown,
  catalogOrId?: ProtocolIdIndex | ProtocolIndexSource | unknown,
): string | undefined {
  if (typeof idOrCatalog === 'string') {
    const idx = isProtocolIdIndex(catalogOrId)
      ? catalogOrId
      : buildProtocolIdIndex(catalogOrId as ProtocolIndexSource);
    return idx.resolveProtocolNameById(idOrCatalog);
  }
  if (typeof catalogOrId === 'string') {
    const idx = isProtocolIdIndex(idOrCatalog)
      ? idOrCatalog
      : buildProtocolIdIndex(idOrCatalog as ProtocolIndexSource);
    return idx.resolveProtocolNameById(catalogOrId);
  }
  return undefined;
}
