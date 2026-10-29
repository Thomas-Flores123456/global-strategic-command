/**
 * 全域战略指挥系统 —— MVU 变量结构定义（变量树 v2）
 *
 * 分层原则：
 * - 硬变量：数字/枚举，AI 每轮按更新规则增减，前端直接渲染
 * - 软变量：短文本，AI 描述性更新，容错高
 * - 凡是算得出的数（净电力/净余额/可建清单）一律由前端推导，不存冗余
 */

import {
  isLegacyProtocolIdentifier,
  isRecord,
  LEGACY_PROTOCOL_DEFINITIONS,
  LEGACY_PROTOCOL_ID_TO_NAME,
  LEGACY_PROTOCOL_NAME_TO_ID,
  migrateLegacyProtocolsInState,
  migrateV1toV2,
  PROTOCOL_SCHEMA_VERSION,
  ProtocolInstance,
  ProtocolLastResult,
  ProtocolStatus,
  resolveLegacyProtocolId,
  resolveLegacyProtocolName,
  SCHEMA_VERSION,
  type LegacyProtocolDefinition,
  type ProtocolInstanceType,
  type ProtocolLastResultType,
  type ProtocolStatusType,
  // @ts-expect-error Node 22 原生执行 dump_schema.ts 需显式 .ts 后缀
} from './schemaMigration.ts';

export {
  isLegacyProtocolIdentifier,
  LEGACY_PROTOCOL_DEFINITIONS,
  LEGACY_PROTOCOL_ID_TO_NAME,
  LEGACY_PROTOCOL_NAME_TO_ID,
  migrateLegacyProtocolsInState,
  migrateV1toV2,
  PROTOCOL_SCHEMA_VERSION,
  ProtocolInstance,
  ProtocolLastResult,
  ProtocolStatus,
  resolveLegacyProtocolId,
  resolveLegacyProtocolName,
  SCHEMA_VERSION,
  type LegacyProtocolDefinition,
  type ProtocolInstanceType,
  type ProtocolLastResultType,
  type ProtocolStatusType,
};

/** 建筑状态 */
export const BuildingState = z.enum(['运转', '建造中', '受损', '停机']);

/** 建筑相对 MCV 原点 (0, 0) 的平面坐标（FD-34 · D-BLD-COORD-01，东+x 北+y，每格=100m） */
export const BuildingCoord = z.object({
  x: z.number().min(-10).max(10),
  y: z.number().min(-10).max(10),
});
export type BuildingCoord = z.output<typeof BuildingCoord>;

/** 建筑条目 */
export const Building = z.object({
  name: z.string(),
  layer: z.string().default(''), // 地表层/地下层/空腔层…
  state: BuildingState.default('运转'),
  progress: z.number().min(0).max(100).optional(), // 仅建造中有
  eta: z.string().optional(), // 仅建造中有，如"余3日"
  /** 相对于本基地 MCV 原点 (0,0) 的平面坐标（FD-34）：可选惰性缺省，缺省时由 buildingCoordEngine 按三环确定性推导 */
  coord: BuildingCoord.optional(),
  /** 相对于本基地 MCV 的标准方位与距离描述（如 "西北·280m (-2,+2)"） */
  bearing: z.string().optional(),
  /** 双模真源（产线设计案 §4.1，canon《多建筑并联加速》）：可选惰性缺省='生产'（引擎侧兑现），
   *  旧档解析输出零新增键（零迁移钉死测试锁定）；适用品类冻结：MCV/兵营/战车工厂/空军指挥部/造船厂——
   *  其余品类无 mode 语义（引擎恒视为生产） */
  mode: z.enum(['生产', '加速']).optional(),
  /** 加速对象（§4.3）：可选惰性缺省='global'（canon 原生默认）；'base'=仅本基地 */
  accel_scope: z.enum(['global', 'base']).optional(),
  /** 已挂载于本母体建筑上的原位扩建模块名称列表（FD-22 / FD-37，如 ["智能电网潮流调度中心"]；可选惰性缺省，旧档零新增键） */
  addons: z.array(z.string()).optional(),
});

/** 基地地理/天体选址类型（FD-26 / FD-27） */
export const BaseSiteType = z.enum([
  'inland_canyon',
  'equatorial_coastal',
  'sea_platform',
  'high_latitude',
  'orbital_dock',
  'lunar_surface',
]);
export type BaseSiteType = z.output<typeof BaseSiteType>;

/** 分基地驻防军备明细（FD-37 · D-SAVE-GARRISON-03：可选惰性缺省，旧档零新增键；全局 stat_data.forces 仍为战区总账） */
export const BaseForces = z.object({
  troops: z.record(z.string(), z.number()).optional(),
  vehicles: z.array(z.string()).optional(),
  equipment: z.record(z.string(), z.number()).optional(),
});
export type BaseForces = z.output<typeof BaseForces>;

/** 基地空间防区与环境工程改造词条（FD-38 · D-BASE-LIFE-04：可选惰性缺省，旧档零新增键） */
export const BaseSector = z.object({
  name: z.string(),
  layer: z.string().default(''), // 地表层 / 地下层 / 山体掩体 / 外部前哨…
  status: z.string().default('正常'), // 正常 / 警戒 / 施工中 / 受损…
  desc: z.string().default(''), // 简短工程/防务效能描述
});
export type BaseSector = z.output<typeof BaseSector>;

/** 基地 */
export const Base = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string().default(''), // 基地所在地，如"青岚山北坡"
  // '废弃'：退役态（CTRL-RETIRE-01 · 方案 A 状态机退役，只加不改；实体保留可审计，UI 默认折叠）
  // '运转中'：MCV 展开建造厂后基地进入正常运转态（MCV-ENGINE-01）
  status: z.enum(['隐蔽中', '运转中', '警戒', '暴露', '失守', '废弃']).default('隐蔽中'),
  /** 相对于第一座基地（bases[0] 标准时区 = 0）的小时偏移（FD-26 · D-TZ-1）：可选惰性缺省=0，旧档零新增键 */
  tz_offset: z.number().min(-12).max(14).optional(),
  /** 基地级局部天气（FD-26 · D-WTH-1，取自12项标准天气预设表）：可选惰性缺省，缺省时引擎回退 meta.weather */
  weather: z.string().optional(),
  /** 基地选址类型（FD-26 / FD-27 6大选址）：可选惰性缺省，缺省时由引擎按 location/建筑推导 */
  site_type: z.string().optional(),
  /** 基地辖区局部民心指数（FD-36 · 0.0~10.0，可选惰性缺省，缺省时回退全局 morale.value） */
  morale: z.number().min(0).max(10).optional(),
  power: z
    .object({
      gen: z.number().default(0), // 发电
      use: z.number().default(0), // 耗电（净余=gen-use 由前端算）
    })
    .prefault({}),
  buildings: z.array(Building).default([]),
  alerts: z.array(z.string()).default([]), // 基地级警报，无事空数组
  /** 本基地驻防兵力、载具与装备明细（FD-37：可选惰性缺省，缺省时由军备面板归入战区机动直属池） */
  forces: BaseForces.optional(),
  /** 本基地已开辟的空间防区、隐蔽伪装与环境基础设施词条（FD-38：可选惰性缺省，旧档零新增键） */
  sectors: z.array(BaseSector).optional(),
});

/**
 * 队列（建造/研究/生产各自然一条=T1事实串行；数组结构天生支持T2并行）
 *
 * QueueItem v2（CTRL-TXN-SCHEMA-01 · 事务化扩展，真源：系统事务与时间推进总设计案 §3.1）：
 * - 旧五字段（type/item/base/progress/eta）语义与默认值零变化；
 * - v2 新增字段全部 `.default()`，旧档零迁移成本（元素级默认值兑底，先例：Base.status/Girl.hp）；
 * - progress 语义收紧：仅事务引擎写（设计案 §2.2 铁律1），LLM/<生产> 声明只是对账输入；
 * - eta 降级为展示缓存；数组顺序即队列优先级（§2.3.3，不设 priority 数字）。
 */
export const QueueItem = z.object({
  // ── 既有字段（零破坏；type 枚举扩「改装」= v1 四类耗时事务收口，§1.3；
  //    扩「工程」= 工程玩法 MVP §3.3 阶段→queue 投影，lane 显式指定 eng:<slotId>）──
  type: z.enum(['建造', '研究', '生产', '改装', '工程']),
  item: z.string(),
  base: z.string().default(''),
  progress: z.number().min(0).max(100).default(0),
  eta: z.string().default(''),
  // ── v2 新增（全部 default，旧档零迁移成本）──
  /** 五态事务状态机（§2）；default 'active'=旧档在途队列视为进行中 */
  status: z.enum(['queued', 'active', 'settling', 'done', 'cancelled']).default('active'),
  /** 游戏内日历开工时刻；''=旧档，首次结算时由引擎补记 */
  started_at: z.string().default(''),
  /** 总工期（分钟）；0=未知工期（§3.3 工期来源），引擎不推进但不报错 */
  total_minutes: z.number().default(0),
  /** 已消耗工期（分钟）；仅引擎写（Δt×eff 积分） */
  spent_minutes: z.number().default(0),
  /** 批量数（生产类批次流水） */
  qty: z.number().default(1),
  /** 已下线数（批次流水，先下线先入役候审） */
  qty_done: z.number().default(0),
  /** 本建造队列已转正的建筑数量；惰性缺省零注入（对齐 lane 先例：旧档/未交付不写字段） */
  building_delivered_qty: z.number().int().nonnegative().optional(),
  /** 立项时是否已扣款；false=LLM 叙述立项账务欠条（Q4，事后补扣） */
  cost_paid: z.boolean().default(true),
  /** 物理硬下限（天）；0=不锁，供 2STAGE 引擎钳制 */
  min_days_lock: z.number().default(0),
  /** 暂缓标记（§2.3 调度令）；hold=true 时带宽升格跳过 */
  hold: z.boolean().default(false),
  /** 显式产线指定（产线设计案 Q4 可选机制；缺席/''=未指定走 Q2 推导兜底；惰性缺省零迁移） */
  lane: z.string().optional(),
});

/** 机娘 */
export const Girl = z.object({
  name: z.string(),
  duty: z.string().default(''), // 软·当前职务
  hp: z.enum(['完好', '轻损', '重损', '离线', '轻伤', '重伤', '修复中']).default('完好'),
  base: z.string().default(''), // 驻地归属（空串=战区直属/未绑定单基地，ARM-02）
  serial: z.string().default(''), // 出厂工程编号，如“犀牛-02”
  callsign: z.string().default(''), // 指挥官亲赐代号
  model: z.string().default(''), // 原型/型号
  seq: z.string().default(''), // 序列：首台原型 / 次生二号机
  faction: z.string().default(''), // 所属阵营
  body: z.string().default(''), // 躯体特征/身子
  personality: z.string().default(''), // 性格心智
  appearance: z.string().default(''), // 外貌衣装
  shell: z.string().default(''), // 社会外壳
  alias: z.string().default(''), // 对外化名
  status: z.string().default(''), // 当前心境/剧情状态描述
  exposure: z.string().optional(), // 暴露状态/暴露度（可选，兼容 <态势>/<机娘> 直接声明）
  affection: z.number().min(0).max(100).default(50), // 好感度
  obedience: z.number().min(0).max(100).default(50), // 服从度
  traits: z.array(z.string()).default([]), // 特征标签
});

/** 待授名/待命名机娘候审记录（与 Girl 同源扩展 stage 阶段标识） */
export const PendingGirlSchema = Girl.extend({
  stage: z.string().default('待命名'),
});
export type PendingGirl = z.output<typeof PendingGirlSchema>;

/** 势力（指挥官已知情报视图） */
export const Faction = z.object({
  name: z.string(),
  attitude: z.enum(['敌意', '警觉', '中立', '友善', '未接触']).default('未接触'),
  intel: z.string().default(''), // 认知概要（归档情报压入此处）
  risk: z.enum(['高', '中', '低', '未知']).default('未知'),
});

/** 情报六大来源渠道分类（FD-33 D-INTEL-EVO-02） */
export const IntelSrcKind = z.enum([
  '雷达侦察',
  '渗透内线',
  '暗网流言',
  '电讯截获',
  '前线目视',
  '宏观广播',
]);
export type IntelSrcKind = z.output<typeof IntelSrcKind>;

/** 情报核实与演进状态（FD-33 D-INTEL-EVO-02） */
export const IntelStatus = z.enum(['待核实', '已证实', '已证伪', '演进中']);
export type IntelStatus = z.output<typeof IntelStatus>;

/** 世界演变四大发散象限（FD-33 D-INTEL-EVO-03） */
export const WorldEvoDomain = z.enum(['远方地缘', '位面异象', '暗流科技', '社会黑市']);
export type WorldEvoDomain = z.output<typeof WorldEvoDomain>;

/** 世界演变四阶段（FD-33 D-INTEL-EVO-04，兼容 显化） */
export const WorldEvoStage = z.enum(['萌芽', '发酵', '显化', '高潮', '平息']);
export type WorldEvoStage = z.output<typeof WorldEvoStage>;

/** 情报与世界演变条目（三态：置顶/常规/归档由 pinned + 所在数组决定；FD-33 扩展六大渠道、演进与世界演变五维字段） */
export const IntelItem = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  scope: z.enum(['tactical', 'local', 'world']).optional(),
  src: z.string(), // 监听/侦察/渗透/医堂/线报…
  src_kind: IntelSrcKind.optional(),
  content: z.string(),
  date: z.string().default(''),
  cred: z.enum(['高', '中', '低']).default('中'), // 可信度
  status: IntelStatus.optional(),
  evolves_from: z.string().optional(),
  /** FD-50：所属多阶情报链/侦察溯源案卷名称（如「北郊加密信标溯源」「灰区黑市暗桩甄别」） */
  chain: z.string().optional(),
  /** FD-50：当前处于情报链的第几阶（如 "1/3"、"2/3"、"第2阶/共3阶"） */
  chain_step: z.string().optional(),
  /** FD-50：下一阶核查方向或终局派生任务/档案钩子（由 LLM 结合现场态势自由埋设） */
  next_lead: z.string().optional(),
  evo_domain: WorldEvoDomain.optional(),
  stage: WorldEvoStage.optional(),
  ttl_floors: z.number().int().min(0).max(20).optional(),
  hook: z.string().optional(),
  read: z.boolean().default(false),
  pinned: z.boolean().default(false),
});

/** 任务解锁蓝图条目（FD-30 Tier A） */
export const QuestUnlockUnit = z.object({
  name: z.string(),
  kind: z.enum(['人员', '载具', '装备']).default('载具'),
  producer: z.string().default(''),
  cost: z.number().default(600),
  desc: z.string().default(''),
  faction: z.string().optional(),
});
export type QuestUnlockUnit = z.output<typeof QuestUnlockUnit>;

/** 资金与物资链条五大物理分类（FD-51） */
export const ChainKind = z.enum([
  '采矿精炼',
  '废料回收',
  '油气化工',
  '本土商路',
  '工业转化',
  '后勤维护',
]);
export type ChainKind = z.output<typeof ChainKind>;

/** 任务资金链奖励条目（FD-30 / FD-51） */
export const QuestChainReward = z.object({
  id: z.string().optional(),
  name: z.string(),
  rate_daily: z.number().default(0),
  capacity: z.number().optional(),
  chain_kind: ChainKind.optional(),
  wallet_daily: z.record(z.string(), z.number()).optional(),
  resources_daily: z.record(z.string(), z.record(z.string(), z.number())).optional(),
  vehicles: z.array(z.string()).optional(),
  faction: z.string().optional(),
});
export type QuestChainReward = z.output<typeof QuestChainReward>;

/** 任务地方势力关系奖励条目（FD-30） */
export const QuestFactionReward = z.object({
  name: z.string(),
  attitude: z.enum(['敌意', '警觉', '中立', '友善', '未接触']).optional(),
  intel: z.string().optional(),
});
export type QuestFactionReward = z.output<typeof QuestFactionReward>;

/** 任务参战机娘奖励条目（FD-30） */
export const QuestGirlReward = z.object({
  name: z.string(),
  affection_delta: z.number().optional(),
  obedience_delta: z.number().optional(),
  traits: z.array(z.string()).optional(),
});
export type QuestGirlReward = z.output<typeof QuestGirlReward>;

/** 任务在研科技进度助力（FD-30） */
export const QuestTechBoost = z.object({
  name: z.string(),
  progress_delta: z.number(),
});
export type QuestTechBoost = z.output<typeof QuestTechBoost>;

/** 任务奖励结构（FD-29 / FD-30） */
export const QuestReward = z.object({
  credits: z.number().default(0),
  intel_points: z.number().default(0),
  resources: z.record(z.string(), z.record(z.string(), z.number())).default({}),
  items: z.array(z.string()).default([]),
  text: z.string().default(''),
  unlock_factions: z.array(z.string()).optional(),
  unlock_units: z.array(QuestUnlockUnit).optional(),
  troops: z.record(z.string(), z.number()).optional(),
  vehicles: z.array(z.string()).optional(),
  chains: z.array(QuestChainReward).optional(),
  protocols: z.array(z.string()).optional(),
  factions: z.array(QuestFactionReward).optional(),
  wallet: z.record(z.string(), z.number()).optional(),
  girl_rewards: z.array(QuestGirlReward).optional(),
  tech_boost: QuestTechBoost.optional(),
});
export type QuestReward = z.output<typeof QuestReward>;

/** 任务 */
export const Quest = z.object({
  name: z.string(),
  category: z.enum(['主线', '支线', '紧急', '日常', '指令']).optional(),
  status: z.enum(['进行中', '已完成', '已失败', '已取消']).optional(),
  issuer: z.string().optional(),
  /** FD-48：所属系列任务/战役名称（如「铁幕回响」「北郊铁道复苏」） */
  series: z.string().optional(),
  /** FD-48：当前处于系列任务的第几环（如 "1/3"、"2/3"、"第2环/共3环"） */
  chain_step: z.string().optional(),
  /** FD-48：下一环任务预告或后续演进线索（由 LLM 结合现场态势自由埋设） */
  next_quest: z.string().optional(),
  progress: z.string().default(''),
  note: z.string().default(''),
  detail: z.string().default(''), // 任务详情（背景/目标/奖励），详情弹窗显示
  rewards: QuestReward.optional(),
  reward_claimed: z.boolean().optional(),
  updated_floor: z.number().optional(),
});

/**
 * 动态百科条目：AI 创造的新科技/新单位/新建筑（隐藏科技机制）
 * 标准内容的详情写死在前端 catalog/girls，零变量成本；此处只存 AI 创新的增量
 * 只存索引级摘要，完整设定走世界书（延迟提交机制，见 pending_lore）
 */
export const CodexEntry = z.object({
  name: z.string(),
  // '阵营'/'势力' 供 DLC/动态阵营与势力注册；'人物' 供 <扩展档案> 重要 NPC 档案同步（FD-32）；'地点' 供恶土聚落/据点等地理设定；
  // .catch 防非法 kind 炸整棵树——真机实测：枚举外值会让 MVU 同步的 schema.parse 打回整个 codex（种子全丢），降级为'其他'更皮实
  kind: z.enum(['科技', '建筑', '载具', '人员', '人物', '装备', '地点', '阵营', '势力', '其他']).catch('其他'),
  desc: z.string().default(''), // 1~2 句摘要
  params: z.record(z.string(), z.string()).default({}), // 造价/耗电/工期/前置…自由键值
});

/**
 * 顶层默认值 = 归零态（D1 拍板修订）：字符串''、数字0、数组[]、record{}。
 * `Schema.parse({})` = 归零态 = 键结构契约；开局正式值由未来开场 UI 确认后写入 #0 楼。
 * 富演示数据已搬入 previewData.ts（仅预览 mock，真机零引用）。
 * 元素级默认值（如 Base.status/Girl.hp）保留——那是元素被创建时缺字段的兑底。
 */
/**
 * 机娘档案（延迟提交暂存）：新机娘诞生楼由 <机娘档案> 标签写入本结构，
 * 落地器（girlFiler）渲染进《机娘·能力档案》+《剧情·北坡纪事》双书后清除——
 * 变量树不长期滞留大文本（哲学同 codex：完整设定走世界书）。
 * 字段内容为散文详写（提示词约束勿标签化）；空字段渲染时优雅降级（整段不出）。
 */
export const GirlSpecialSkillSchema = z.object({
  name: z.string(),
  kind: z.string().default('核心权能'),
  desc: z.string().default(''),
});

export const GirlSpecialEquipmentSchema = z.object({
  name: z.string(),
  slot: z.string().default('专属挂载'),
  desc: z.string().default(''),
});

export const GirlDossier = z.object({
  schema_version: z.number().int().default(1),
  type: z.string().default('maiden'),
  id: z.string().default(''), // 结构化数据块唯一 ID，如 maiden.allied.chrono_miner_01
  name: z.string(),
  model: z.string().default(''), // 型号/首台身份，如“盟军基地车（MCV）首台”
  serial: z.string().default(''), // 出厂编号
  callsign: z.string().default(''), // 专属代号
  rename_from: z.string().default(''), // 赐名前旧称/待授名标识
  seq: z.string().default(''), // 首台原型 / 次生二号机
  faction: z.string().default(''), // 阵营
  tier: z.number().int().min(0).max(3).default(1), // 科技阶位 T0~T3
  incubation_mode: z.string().default('blindbox_christen'), // iconic_fixed | blindbox_christen | rule_guideline
  preset_name: z.string().default(''), // 预设名册兜底真名
  body: z.string().default(''), // 躯体特征/身子
  keys: z.array(z.string()).default([]), // 档案书触发词（本名之外的型号/技能专名）
  // ── 档案书段（机娘·能力档案，与 <数据> 块字段 1:1 对齐）──
  form_mech: z.string().default(''), // 形态机制（可空段）
  temperament_spectrum: z.string().default(''), // 机魂性格光谱
  special_skills: z.array(GirlSpecialSkillSchema).default([]), // 结构化特殊技能数组
  special_equipment: z.array(GirlSpecialEquipmentSchema).default([]), // 结构化特殊装备数组
  skills: z.string().default(''), // 能力（多条「· 技能名：描述」散文或由 special_skills 自动派生）
  flaws: z.string().default(''), // 结构性短板
  weapons: z.string().default(''), // 武器（主/副/底牌或由 special_equipment 自动派生）
  exposure: z.string().default(''), // 暴露分档 🟢／🟡／🔴
  exposure_grade: z.string().default(''), // 对齐 <数据> 块 exposure_grade
  balance: z.string().default(''), // 平衡总纲位置
  balance_slot: z.string().default(''), // 对齐 <数据> 块 balance_slot
  prose: z.string().default(''), // 可选三段式档案散文正文
  // ── 剧情书段（剧情·北坡纪事）──
  alias: z.string().default(''), // 对外化名（剧情书 key + 阵容总览行）
  shell: z.string().default(''), // 社会外壳（身份编织+当前形态）
  appearance: z.string().default(''), // 外观（全形态+分体伪装态）
  personality: z.string().default(''), // 性格
  status: z.string().default(''), // 当前状态
  base: z.string().default(''), // 驻地归属（可选随档案同步至 forces.girls）
  duty: z.string().default(''), // 当前职务（可选随档案同步至 forces.girls）
  traits: z.array(z.string()).default([]), // 能力特征/特质标签（随档案同步至 forces.girls）
});

/**
 * 数据更新补丁（§3.12 动态补丁管线）
 * <数据更新> 标签落此暂存，经中控台 Diff 审核门后由 worldbookDataFiler 写入世界书并清除
 */
export const DataPatch = z.object({
  id: z.string().default(() => `patch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
  target: z.string(), // 目标建筑/载具名称或 ID（如 "战车工厂" 或 "soviet_war_factory"）
  category: z.string().optional(),
  operation: z.enum(['patch', 'replace']).default('patch'),
  patch: z.record(z.string(), z.unknown()).default({}), // 更新的载荷对象
  changes: z.record(z.string(), z.unknown()).optional(), // 兼容 changes 字段载荷
  reason: z.string().default(''), // 剧情改装/变更理由
  timestamp: z.number().default(() => Date.now()),
  status: z.enum(['pending', 'applied', 'deferred', 'rejected']).default('pending'),
});
export type DataPatch = z.output<typeof DataPatch>;

/**
 * 扩展档案（延迟提交暂存，CTRL-CHATBOOK-02 §2.2）：
 * LLM 在剧情中创造的新实体（科技/建筑/载具/人员/装备），由 <扩展档案> 标签写入本结构，
 * 落地器（expansionFiler）经 chatBookGateway 写入当前聊天档案书后清除——
 * 变量树不长期滞留大文本；完整设定走世界书。
 */
export const ExpansionDossier = z.object({
  name: z.string(), // 实体名（实体对齐 applyAlign 复用）
  kind: z.enum(['科技', '建筑', '载具', '人员', '人物', '装备', '地点', '势力']), // 对齐 CodexEntry.kind（FD-32 新增 '人物'，BUG-LIVE-15a 新增 '地点'，BUG-R2-25 新增 '势力'）
  desc: z.string().default(''), // 1~2 句摘要（自动派生 codex 索引用）
  params: z.record(z.string(), z.string()).default({}), // 造价/耗电/工期/前置…（对齐 CodexEntry.params）
  detail: z.string().default(''), // 完整设定散文（世界书条目正文主体）
  keys: z.array(z.string()).default([]), // 触发词（本名之外的专名）
  data: z.record(z.string(), z.unknown()).optional(), // 可选结构化 <数据> 块载荷（经 FORBIDDEN_PATCH_KEYS 红线校验后渲染进条目正文）
});
export type ExpansionDossier = z.output<typeof ExpansionDossier>;

/** 剧情摘要层级：micro=单楼微纪要（<摘要>标签） | meso=阶段中摘要（每N楼归并） | macro=战役大摘要（多段中摘要归并） */
export const SummaryTier = z.enum(['micro', 'meso', 'macro']);
export type SummaryTier = z.output<typeof SummaryTier>;

/** 单楼微纪要（小摘要 · Micro）：由每楼 <摘要>/<summary> 标签解析入账，作为中摘要的高密度输入源与时间轴 */
export const MicroSummaryItem = z.object({
  floor: z.number().int().min(0), // 所在楼层号（唯一幂等键）
  date: z.string().default(''), // 战区时间/日期（如 "秋·九月十九"）
  text: z.string(), // 单楼核心事实纪要（50~120字）
  keys: z.array(z.string()).default([]), // 关联实体/关键词
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type MicroSummaryItem = z.output<typeof MicroSummaryItem>;

/**
 * 剧情摘要草稿（延迟提交暂存，CTRL-CHATBOOK-03 §4 + 三层摘要扩展）：
 * generateRaw 后台独立请求或主模型 <中摘要>/<大摘要> 标签产出落此暂存，管理页预览审核后由 summaryFiler 写入聊天档案书
 * 并依策略隐藏对应楼层或降级旧中摘要——变量树不长期滞留大文本；完整摘要走世界书。
 */
export const SummaryDraft = z.object({
  from: z.number(), // 起始楼层号（左闭）
  to: z.number(), // 结束楼层号（右闭）
  text: z.string(), // 摘要正文散文
  keys: z.array(z.string()).default([]), // 可选实体名数组（分层激活模式 selective key 用）
  generatedAt: z.string().default(() => new Date().toISOString()), // 生成时间 ISO 字符串
  model: z.string().default(''), // 生成使用的模型名
  status: z.enum(['pending', 'applied', 'discarded']).default('pending'), // 审核状态
  tier: SummaryTier.optional(), // 摘要层级（缺省视作 'meso' 中摘要，100% 兼容旧档）
  title: z.string().optional(), // 可选章节/卷宗标题
});
export type SummaryDraft = z.output<typeof SummaryDraft>;

/**
 * 工程实体（工程玩法 MVP 任务包 §3.1；D1-C 混合账本 / D2-A 全量升格 / D21 范围轴；
 * 仓段化 V2 设计案 §3.2：判别联合扩展，2026-10-12 设计门冻结）
 *
 * - `stat_data.projects` 为 optional 根数组（先例 pending_mode_switches），旧档零注入零迁移；
 * - 元素级 `schema_version`（独立版本轴，P0 原则 5）：1=V1 线性阶段链 / 2=V2 模块拓扑，元素级共存；
 * - 派生不落盘：进度/ETA 一律由投影 queue 项（QueueItem.type='工程'）与引擎重算，不进本结构；
 * - `ref` 指向世界书 retrofit/project 块 id（引用不搬块，V1 唯一 owner 原则）；
 * - `scope` 显式声明、默认 'base'，不按 grade 推导（D21）；theater 时 bases ≥2（superRefine 校验，两分支同一生效）。
 */
export const PROJECT_SCHEMA_VERSION = 1 as const;
/** 仓段化 V2 版本轴值（仓段化 V2 设计案 §3.2 / P0-5 元素级独立版本轴；V1 轴值 1 不动，两轴共存于 projects[]） */
export const PROJECT_SCHEMA_VERSION_V2 = 2 as const;

/** 工程阶段（D2-A：小改=1 / 中改=2~3 / 大改=4~5；P0 原则 2：预留扩展位，仓段化 modules 并入不重构） */
export const ProjectPhase = z.object({
  idx: z.number().int().min(0), // 阶段序号（0 起，对齐 retrofit 块 phases[] 数组序）
  name: z.string().default(''), // 阶段名（对齐静态定义 phases[].name）
  status: z.enum(['未启动', '进行中', '暂停', '完工', '取消']).default('未启动'),
  /** 投影 queue 索引指针：指向 queues[] 中本阶段投影项的下标；null=未投影（阶段未启动/已结算回写后） */
  queue_index: z.number().int().min(0).nullable().default(null),
});
export type ProjectPhase = z.output<typeof ProjectPhase>;

/** 类型化产出物（P0 原则 4 / D13-A：首版='mark' 已改装标记；D13-B 升级只加枚举值） */
export const ProjectOutcome = z.object({
  type: z.enum(['mark', 'variant']).default('mark'),
});
export type ProjectOutcome = z.output<typeof ProjectOutcome>;

/**
 * 工程模块（V2 仓段化，仓段化 V2 设计案 §3.2 / D-C1 模块≈带身份的单阶段）：
 * 字段形状与 ProjectPhase 刻意同构（status/queue_index），queue 投影、结算、UI 状态色最大化复用；
 * `base` 为模块级承建基地指派（Base.id）——仓段化天然多基地，但不强制（D-C3：单基地=scope base 合法）。
 */
export const ProjectModule = z.object({
  id: z.string(), // 模块 id（对齐世界书 modules[].id）
  name: z.string().default(''),
  status: z.enum(['未启动', '进行中', '暂停', '完工', '取消']).default('未启动'),
  base: z.string().default(''), // 承建基地（Base.id）——模块级指派
  /** 投影 queue 索引指针（同 ProjectPhase.queue_index 口径）；null=未投影（模块未启动/已结算回写后） */
  queue_index: z.number().int().min(0).nullable().default(null),
});
export type ProjectModule = z.output<typeof ProjectModule>;

/** 工程公共字段底座（V1/V2 判别联合共享；grade 枚举 D-C2 扩「巨构」档） */
const ProjectBaseFields = z.object({
  id: z.string().startsWith('proj:'), // 运行时实例 id，形如 proj:<instance>
  ref: z.string(), // 世界书 retrofit/project 块 id（引用不搬块）
  scope: z.enum(['base', 'theater']).default('base'), // base=短期单基地 | theater=长期多基地
  bases: z.array(z.string()).default([]), // 参与基地（Base.id）；theater 时 ≥2
  lead_base: z.string().default(''), // 牵头基地（Base.id）
  grade: z.enum(['小改', '中改', '大改', '巨构']), // D-C2：巨构=V2 仓段化档
  status: z.enum(['规划中', '在建', '暂停', '完工', '取消']).default('规划中'),
  outcome: ProjectOutcome.prefault({}),
});

/** V1 分支：线性阶段链（现字段零改动；.strict() 使 V2 键（modules 等）混入即拒收=判别联合误用拒收） */
export const ProjectV1 = ProjectBaseFields.extend({
  phases: z.array(ProjectPhase).default([]),
  schema_version: z.literal(PROJECT_SCHEMA_VERSION).default(PROJECT_SCHEMA_VERSION),
}).strict();
export type ProjectV1 = z.output<typeof ProjectV1>;

/** V2 分支：模块拓扑（modules[] ≥1，无 phases；仓段化 V2 设计案 §3.2） */
export const ProjectV2 = ProjectBaseFields.extend({
  modules: z.array(ProjectModule).min(1),
  schema_version: z.literal(PROJECT_SCHEMA_VERSION_V2),
}).strict();
export type ProjectV2 = z.output<typeof ProjectV2>;

/**
 * 工程判别联合（仓段化 V2 设计案 §3.2）：`schema_version` 为判别键——1=V1 phases[] 线性链 / 2=V2 modules[] 拓扑。
 * preprocess：判别键缺省兑底 1（等价原 literal(1).default(1) 语义，V1 旧档与缺省输入零迁移）；
 * 外层 superRefine 使 theater bases≥2（D21）校验对两个分支同一生效。
 */
export const Project = z
  .preprocess(
    value =>
      isRecord(value) && value.schema_version === undefined
        ? { ...value, schema_version: PROJECT_SCHEMA_VERSION }
        : value,
    z.discriminatedUnion('schema_version', [ProjectV1, ProjectV2]),
  )
  .superRefine((project, ctx) => {
    if (project.scope === 'theater' && project.bases.length < 2) {
      ctx.addIssue({ code: 'custom', message: 'theater 工程 bases 必须 ≥2（D21）', path: ['bases'] });
    }
  });
export type Project = z.output<typeof Project>;

/** V2 判别守卫（联合收窄唯一入口；消费方禁止自行断言 schema_version） */
export function isProjectV2(project: Project): project is ProjectV2 {
  return project.schema_version === PROJECT_SCHEMA_VERSION_V2;
}

/** V1 判别守卫（同 isProjectV2 口径） */
export function isProjectV1(project: Project): project is ProjectV1 {
  return project.schema_version === PROJECT_SCHEMA_VERSION;
}

/**
 * 六大战略资源柱（任务包 §3.7）· Null/0/>0 严格三态状态机
 * - null：未探明/未建仓（前置科技未就绪）——前端显示横杠/未解锁，悬浮窗完全隐身不渲染
 * - 0：已建产线但当前库存告罄（DEPLETED）——前端标红告警，提示战术链条中断
 * - >0：正常实物库存流转
 * 防降级红线：null 与 0 物理语义不同，严禁模糊默认合并把 null 降级或转为 0
 * record 开放键：LLM 可在剧情中动态新增世界特定物料（如「紫幽玄铁」）自动入库
 * 独占约束：纳米主建材（nanites 柱）仅由红警基地建造厂/纳米工坊产出，本地自然界不可采集
 */
export const EconomyResources = z.object({
  /** 1. 纳米机械储备（绝对核心主建材；仅建造厂/纳米工坊产出，自然界不可采集） */
  nanites: z.record(z.string(), z.number().nonnegative().nullable()).default({
    标准纳米工料: null,
    高精构造型纳米: null,
    机娘修复凝胶: null,
  }),

  /** 2. 矿产与原矿（采矿车/精炼厂/回收厂） */
  minerals: z.record(z.string(), z.number().nonnegative().nullable()).default({
    铁矿石: null,
    铜矿砂: null,
    煤炭: null,
    铝土矿: null,
    稀土矿: null,
    金银原矿: null,
    灵石原矿: null,
  }),

  /** 3. 大宗常规建材与化工材料（地下工程与重化消耗） */
  materials: z.record(z.string(), z.number().nonnegative().nullable()).default({
    高强工程钢材: null,
    特种防爆水泥: null,
    再生塑料颗粒: null,
    化工装药原料: null,
  }),

  /** 4. 燃油与能源介质（机械化开拔与战备供能） */
  fuel: z.record(z.string(), z.number().nonnegative().nullable()).default({
    粗原油: null,
    精炼柴油: null,
    航空煤油: null,
    灵沁原油: null,
  }),

  /** 5. 战术军械弹药（弹药厂标准化抽象槽） */
  munitions: z.record(z.string(), z.number().nonnegative().nullable()).default({
    步兵制式弹药: null,
    大口径炮弹: null,
    战术制导导弹: null,
  }),

  /** 6. 基地维生与水文后勤（自持与人道运作） */
  logistics: z.record(z.string(), z.number().nonnegative().nullable()).default({
    工业与生活净水: null,
    战备副食与口粮: null,
    战地急救医药: null,
    机械通用备件: null,
  }),
});
export type EconomyResources = z.output<typeof EconomyResources>;

/**
 * 资金链条实体模型（EVT-SCHEMA-01 · CTRL-EVENT-01 §3.1，Q2/Q3 决策落地）：
 * - LLM 仅被赋予「声明因果链条」写权（Q2），资金增长一律由 chainEngine 按 Δt 纯函数积分派生，
 *   严禁裸改 credits 总额；
 * - 五态生命周期状态机（Q3）：establishing → active → distressed → broken → exhausted；
 * - 嵌套 deps/capacity 一律 .prefault({})（先例 Base.power）：缺省输入兑底空对象＋元素级默认值，
 *   旧档零迁移零报错。
 */
/** 资金链流向 */
export const ChainFlow = z.enum(['收入', '支出']);

/** 资金链五态状态机 */
export const ChainStatus = z.enum([
  'establishing', // 铺设中（在途构建，消耗工时/资金）
  'active', // 正常履约（产生全额日息）
  'distressed', // 受挫告警（前置受损/外部干扰，效率降级）
  'broken', // 链条断裂（彻底停摆，保留骨架可修复）
  'exhausted', // 永久枯竭（资源采空/合约终止，只读终态）
]);

/** 资金链条实体 */
export const IncomeChain = z.object({
  id: z.string(), // 唯一标识 (如 "chain_crystal_smuggle_01")
  name: z.string(), // 链条专名 (如 "青岚山原矿直销通道")
  flow: ChainFlow.default('收入'), // 资金流向
  rate_daily: z.number().min(0).default(0), // 标称日额度 (credits/日；本土外币/纯货物商路可为 0)
  /** FD-51：链条物理分类（可选惰性缺省，缺省时由引擎按依赖建筑/名称推断） */
  chain_kind: ChainKind.optional(),
  /** FD-51：本地外币日净收支（正数=日收入，负数=日消耗） */
  wallet_daily: z.record(z.string(), z.number()).optional(),
  /** FD-51：六柱战略资源货物日净收支（第一层为六柱键或中文柱名，第二层为小类名->日净量，正数=产出入库，负数=消耗扣库） */
  resources_daily: z.record(z.string(), z.record(z.string(), z.number())).optional(),
  status: ChainStatus.default('active'), // 运行状态
  eff: z.number().min(0).max(2).default(1), // 实际履约效率 (0.0 ~ 2.0)

  /** 物理依赖清单 (软绑定，用于工况连锁判定 §3.4：电网断供/极端天候；FD-51 扩展 vehicles 与 faction) */
  deps: z
    .object({
      base_id: z.string().default(''), // 依托基地
      base: z.string().optional(), // 兼容 FD-30 任务悬赏依托基地简写
      buildings: z.array(z.string()).default([]), // 依托建筑 (如 ["矿石精炼厂", "货运站"])
      /** FD-51：依赖现役载具/矿车列表（如 ["武装采矿车"] 或 ["采矿车"]） */
      vehicles: z.array(z.string()).optional(),
      /** FD-51：依赖地方势力名称（如 "铁道幸存者同盟"，态度变为敌意时自动受挫/停摆） */
      faction: z.string().optional(),
      world_resource: z.string().default(''), // 依托世界书矿脉/资源条目 ID
    })
    .prefault({}),

  /** 枯竭与时序指标 */
  capacity: z
    .object({
      total_yield: z.number().nullable().default(null), // 理论总蕴藏额度 (null 为无限/长期稳定)
      total: z.number().optional(), // 兼容 FD-30 任务悬赏容量简写
      extracted: z.number().default(0), // 累计已提取额度
    })
    .prefault({}),

  reason: z.string().default(''), // 当前状态说明 (如 "因暴风雪封路，货运暂缓")
  updated_at_day: z.number().default(0), // 最后一次状态跃迁的游戏内天数
});
export type ChainFlow = z.output<typeof ChainFlow>;
export type ChainStatus = z.output<typeof ChainStatus>;
export type IncomeChain = z.output<typeof IncomeChain>;

export const PlanningReceiptStatus = z.enum([
  'advisory_ready',
  'awaiting_approval',
  'committed',
  'rejected',
  'stale_snapshot',
]);
export type PlanningReceiptStatus = z.output<typeof PlanningReceiptStatus>;

export const PlanningReceiptActionResult = z.object({
  op: z.enum(['enqueue', 'promote', 'demote', 'hold', 'resume']).default('enqueue'),
  target: z.string().default(''),
  base: z.string().default(''),
  quantity: z.number().default(1),
  cost_credits: z.number().default(0),
  est_minutes: z.number().default(0),
  status: z.enum(['accepted', 'rejected', 'preview']).default('preview'),
  blocker_code: z.string().optional(),
  blocker_reason: z.string().optional(),
  next_step: z.string().optional(),
  eta_note: z.string().optional(),
});
export type PlanningReceiptActionResult = z.output<typeof PlanningReceiptActionResult>;

export const PlanningReceiptDiffSummary = z.object({
  added: z.array(z.string()).default([]),
  promoted: z.array(z.string()).default([]),
  demoted: z.array(z.string()).default([]),
  held: z.array(z.string()).default([]),
  resumed: z.array(z.string()).default([]),
});
export type PlanningReceiptDiffSummary = z.output<typeof PlanningReceiptDiffSummary>;

export const PlanningReceipt = z.object({
  request_ref: z.string().default(''),
  fingerprint: z.string().default(''),
  snapshot_ref: z.string().default(''),
  mode: z.enum(['advisory', 'delegate_once']).default('advisory'),
  status: PlanningReceiptStatus.default('advisory_ready'),
  base_ref: z.string().default(''),
  total_cost_credits: z.number().default(0),
  budget_cap_credits: z.number().optional(),
  summary: z.string().default(''),
  reason: z.string().default(''),
  actions: z.array(PlanningReceiptActionResult).default([]),
  diff_summary: PlanningReceiptDiffSummary.prefault({}),
  created_at_floor: z.number().optional(),
});
export type PlanningReceipt = z.output<typeof PlanningReceipt>;

export const PlanningState = z.object({
  latest_receipt: PlanningReceipt.nullable().default(null),
  pending_plan: z.any().nullable().default(null),
  committed_fingerprints: z.array(z.string()).default([]),
  protected_task_refs: z.array(z.string()).default([]),
});
export type PlanningState = z.output<typeof PlanningState>;

export const AdjutantRole = z.enum(['faction', 'staff']);
export type AdjutantRole = z.output<typeof AdjutantRole>;

export const AdjutantIdentity = z.enum(['human', 'mcv_girl', 'commander_self']);
export type AdjutantIdentity = z.output<typeof AdjutantIdentity>;

export const AdjutantStatus = z.enum(['active', 'degraded', 'suspended', 'recovering']);
export type AdjutantStatus = z.output<typeof AdjutantStatus>;

export const Adjutant = z.object({
  id: z.string().default(''),
  role: AdjutantRole.default('faction'),
  faction: z.string().default(''),
  identity: AdjutantIdentity.default('mcv_girl'),
  name: z.string().default(''),
  title: z.string().default(''),
  buff_preset: z.string().default(''),
  upkeep_daily: z.number().min(0).default(0),
  status: AdjutantStatus.default('active'),
  note: z.string().default(''),
  /** 可选：驻地基地限定（FD-26 D-SCOPE-1；缺省=战区全局生效） */
  base: z.string().optional(),
});
export type Adjutant = z.output<typeof Adjutant>;

export const PenaltyEffectKind = z.enum([
  'power_loss',
  'daily_upkeep',
  'exposure_floor',
  'prod_slowdown',
]);
export type PenaltyEffectKind = z.output<typeof PenaltyEffectKind>;

export const FactionBreakInPenalty = z.object({
  id: z.string().default(''),
  faction: z.string().default(''),
  name: z.string().default(''),
  effect_kind: PenaltyEffectKind.default('daily_upkeep'),
  magnitude: z.number().min(0).default(0),
  total_minutes: z.number().min(0).default(21600),
  remaining_minutes: z.number().min(0).default(21600),
  reason: z.string().default(''),
  /** 可选：仅作用于指定基地（FD-26 D-SCOPE-1；缺省=战区全局生效） */
  base: z.string().optional(),
});
export type FactionBreakInPenalty = z.output<typeof FactionBreakInPenalty>;

export const CommandHQ = z.object({
  commander_name: z.string().default(''),
  commander_title: z.string().default('战区最高统帅'),
  unlocked_factions: z.array(z.string()).default(['allied']),
  mcv_granted_factions: z.array(z.string()).default([]),
  adjutants: z.array(Adjutant).default([]),
  break_in_penalties: z.array(FactionBreakInPenalty).default([]),
  intel_points: z.number().optional(),
  upkeep_remainder: z.number().min(0).optional(),
});
export type CommandHQ = z.output<typeof CommandHQ>;

export const Meta = z.object({
  world_id: z.string().default(''),
  date: z.string().default(''),
  day_count: z.number().default(0),
  location: z.string().default(''),
  weather: z.string().optional(),
});
export type Meta = z.output<typeof Meta>;

export const OrbitalAsset = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['recon', 'comm', 'navigation', 'weapon', 'station', 'commercial']).default('commercial'),
  orbit: z.string().default('LEO'),
  status: z.enum(['active', 'degraded', 'deorbited']).default('active'),
  launched_at_day: z.number().default(1),
  bonus_desc: z.string().default(''),
  /** 可选：绑定的天基拓扑插槽 ID（FD-27） */
  slot_id: z.string().optional(),
  /** 可选：作用域（theater 全战区 | base 单基地定向赋能，FD-26/FD-27） */
  scope: z.enum(['theater', 'base']).optional(),
  /** 可选：当 scope='base' 时定向赋能的目标基地（如空间太阳能微波输电目标基地） */
  target_base: z.string().optional(),
});
export type OrbitalAsset = z.output<typeof OrbitalAsset>;

/** 基地强绑定的航天发射中心/航天城账本条目（FD-27） */
export const LaunchCenterRecord = z.object({
  id: z.string(),
  base: z.string(),
  name: z.string(),
  site_type: BaseSiteType.default('inland_canyon'),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  status: z.enum(['运转', '建造中', '受损', '停机']).default('运转'),
  mounted_slots: z.record(z.string(), z.string()).default({}),
});
export type LaunchCenterRecord = z.output<typeof LaunchCenterRecord>;

/** 仅由 LLM 下发的外部商业订单载荷条目（FD-27 D7-B：前端严禁伪造生成） */
export const SpaceCommercialOrder = z.object({
  id: z.string(),
  name: z.string(),
  client: z.string().default('外部商业委托'),
  orbit: z.string().default('LEO'),
  mass_t: z.number().default(5),
  reward_credits: z.number().default(2500),
  status: z.enum(['pending', 'assigned', 'completed', 'expired']).default('pending'),
});
export type SpaceCommercialOrder = z.output<typeof SpaceCommercialOrder>;

export const SpaceContract = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(['commercial', 'recon', 'comm', 'constellation', 'station']).default('commercial'),
  rocket: z.string().default('通用中型运载火箭'),
  payload: z.string().default('商业通信卫星'),
  base: z.string().default(''),
  reward_credits: z.number().default(0),
  recover_booster: z.boolean().default(false),
  status: z.enum(['pending', 'launching', 'in_orbit', 'in_progress', 'completed', 'failed']).default('pending'),
  duration_days: z.number().optional(),
  elapsed_days: z.number().optional(),
  weather_hold_reason: z.string().optional(),
  /** 可选：关联的发射中心 ID 或名称（FD-27） */
  launch_center_id: z.string().optional(),
  /** 可选：入轨后点亮的目标拓扑插槽 ID（如 st_port_hab / orb_leo_1 / lun_pad_1，FD-27） */
  target_slot: z.string().optional(),
  /** 可选：对应构件资产 ID（如 asset.st.hab，FD-27） */
  asset_id: z.string().optional(),
  /** 可选：有效载荷质量（吨，FD-27 运力门控） */
  mass_t: z.number().optional(),
  /** 可选：载荷来源（domestic 自产需求 | commercial LLM外部商业订单，FD-27 D7-B） */
  payload_source: z.enum(['domestic', 'commercial']).optional(),
  /** 可选：商业委托客户名（仅 payload_source === 'commercial'） */
  client: z.string().optional(),
  /** 可选：入轨资产作用域（theater | base，FD-26/FD-27） */
  scope: z.enum(['theater', 'base']).optional(),
  /** 可选：定向赋能基地名（当 scope === 'base'） */
  target_base: z.string().optional(),
  /** 可选：目标轨道（如 LEO / GEO / SSO / TLI，F06-02 持久化） */
  orbit: z.string().optional(),
});
export type SpaceContract = z.output<typeof SpaceContract>;

export const SpaceSlice = z.object({
  orbital_assets: z.array(OrbitalAsset).default([]),
  contracts: z.array(SpaceContract).default([]),
  reusable_boosters: z.number().default(0),
  /** 按基地绑定的多发射中心/航天城账本（FD-27，可选惰性挂载保旧档零新增键） */
  launch_centers: z.array(LaunchCenterRecord).optional(),
  /** 已在轨/月面/发射中心落成点亮的四域拓扑插槽实绩映射：slotId -> assetId（FD-27） */
  completed_slots: z.record(z.string(), z.string()).optional(),
  /** 可制造航天装备/部件与自产载荷库存（发动机/芯级/助推器/上面级/自产载荷，FD-27 D7-A） */
  equipment_stock: z.record(z.string(), z.number()).optional(),
  /** 仅限由 LLM 下发的外部商业订单载荷池（前端严禁伪造生成，FD-27 D7-B） */
  commercial_orders: z.array(SpaceCommercialOrder).optional(),
});
export type SpaceSlice = z.output<typeof SpaceSlice>;

/** 暗网资源映射（DARKNET-CORE-01） */
export const DarknetResourceMap = z.object({
  pillar: z.string().default(''),
  key: z.string().default(''),
  qty: z.number().min(0).default(0),
});
export type DarknetResourceMap = z.output<typeof DarknetResourceMap>;

/** 暗网黑市在售商品（DARKNET-CORE-01） */
export const DarknetMarketItem = z.object({
  id: z.string().default(''),
  name: z.string().default(''),
  category: z.string().default('战略物资'),
  price: z.number().min(0).default(0),
  stock: z.number().min(0).default(1),
  seller: z.string().optional(),
  desc: z.string().default(''),
  resource_map: DarknetResourceMap.optional(),
});
export type DarknetMarketItem = z.output<typeof DarknetMarketItem>;

/** 暗网求购悬赏条目（DARKNET-CORE-01） */
export const DarknetBountyItem = z.object({
  id: z.string().default(''),
  target: z.string().default(''),
  category: z.string().default('情报数据'),
  reward_credits: z.number().min(0).default(0),
  status: z.enum(['open', 'completed', 'expired']).default('open'),
  client: z.string().optional(),
  difficulty: z.string().optional(),
  deadline_text: z.string().default(''),
  desc: z.string().default(''),
});
export type DarknetBountyItem = z.output<typeof DarknetBountyItem>;

/** 暗网拍卖会拍品条目（DARKNET-CORE-01） */
export const DarknetAuctionItem = z.object({
  id: z.string().default(''),
  name: z.string().default(''),
  category: z.string().optional(),
  seller: z.string().default('跨维匿名卖方'),
  start_price: z.number().min(0).default(0),
  current_price: z.number().min(0).default(0),
  buyout_price: z.number().min(0).optional(),
  leader: z.string().default('暂无出价'),
  round_text: z.string().default('第1轮'),
  rounds_left: z.number().int().min(0).optional(),
  status: z.enum(['bidding', 'sold', 'passed', 'cancelled']).default('bidding'),
  desc: z.string().default(''),
  resource_map: DarknetResourceMap.optional(),
  consign_deducted: z.boolean().optional(),
  refunded: z.boolean().optional(),
});
export type DarknetAuctionItem = z.output<typeof DarknetAuctionItem>;

/** 暗网交割账本流水记录（DARKNET-CORE-01） */
export const DarknetSettlementRecord = z.object({
  id: z.string().default(''),
  action: z.string().default(''),
  target: z.string().default(''),
  credits_delta: z.number().default(0),
  note: z.string().default(''),
  at_day: z.number().default(0),
});
export type DarknetSettlementRecord = z.output<typeof DarknetSettlementRecord>;

/** 跨维暗网终端状态机与账本（DARKNET-CORE-01） */
export const DarknetState = z.object({
  market_status: z.string().default('未接入'),
  auction_status: z.enum(['closed', 'bidding', 'open', 'settled']).default('closed'),
  next_auction_in_minutes: z.number().min(0).default(10080),
  items: z.array(DarknetMarketItem).default([]),
  bounties: z.array(DarknetBountyItem).default([]),
  auctions: z.array(DarknetAuctionItem).default([]),
  sold_intel_ids: z.array(z.string()).default([]),
  completed_bounty_ids: z.array(z.string()).default([]),
  settled_auction_ids: z.array(z.string()).default([]),
  ledger: z.array(DarknetSettlementRecord).default([]),
});
export type DarknetState = z.output<typeof DarknetState>;

/** 多元资金五大被动/链条渠道日净入明细（DARKNET-CORE-01） */
export const EconomyChannelDaily = z.object({
  refining: z.number().default(0),
  recycling: z.number().default(0),
  petrochemical: z.number().default(0),
  chains: z.number().default(0),
  total: z.number().default(0),
});
export type EconomyChannelDaily = z.output<typeof EconomyChannelDaily>;

export const Schema = z.object({
  schema_version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),

  meta: Meta.prefault({}),

  economy: z
    .object({
      credits: z.number().default(0), // 系统资金
      credits_daily: z.number().default(0), // 日均净入
      wallet: z.record(z.string(), z.number()).default({}),
      /** 六大战略资源三态机（§3.7）。整体缺省=未探明（旧档/归零态零注入、零提示词成本）；
       *  一经写入，缺席柱自动补 null 预置小类；null 严禁降级为 0 */
      resources: EconomyResources.optional(),
      /** 纳米工料快捷镜像（与 economy.resources.nanites 同步，optional 挂载零注入） */
      nanites: z.record(z.string(), z.number().nonnegative().nullable()).optional(),
      /** 资金链条账本（EVT-SCHEMA-01 · 设计案 §3.1）：default([]) 兑底——缺省自动回填空数组（验收标准 1），
       *  供 chainEngine 五态机与 settleFloor 时钟积分（EVT-CHAIN-01/EVT-SETTLE-01）作恒数组真源 */
      chains: z.array(IncomeChain).default([]),
      /** 跨维暗网终端状态与流水（DARKNET-CORE-01）：optional 挂载，旧档零注入 */
      darknet: DarknetState.optional(),
      /** 多元资金分渠道日净入明细（DARKNET-CORE-01）：optional 挂载，旧档零注入 */
      channel_daily: EconomyChannelDaily.optional(),
    })
    .prefault({}),

  exposure: z
    .object({
      value: z
        .preprocess(val => {
          if (typeof val !== 'number' || !Number.isFinite(val)) return val;
          if (val < 0) return 0;
          if (val > 10 && val <= 100) return Math.min(10, Math.round((val / 10) * 100) / 100);
          if (val > 100) return 10;
          return val;
        }, z.number().min(0).max(10))
        .default(0), // 两位小数（自动兼容旧版开场启动器 15/30 百分制标度 -> 1.5/3.0）
      /** 常驻暴露底线（FD-36 · D-EXP-MORALE-01）：可选惰性缺省，由引擎按基地多阵营混建/超武常驻源/伪装建筑推导 */
      floor: z
        .preprocess(val => {
          if (typeof val !== 'number' || !Number.isFinite(val)) return val;
          if (val < 0) return 0;
          if (val > 10 && val <= 100) return Math.min(10, Math.round((val / 10) * 100) / 100);
          if (val > 100) return 10;
          return val;
        }, z.number().min(0).max(10))
        .optional(),
      /** 五级法定暴露等级表述（FD-36 · 对齐世界书 uid=19/26，如 "日常隐蔽（EL-0）"） */
      level: z.string().optional(),
      trend: z.string().default(''),
      last_change: z.string().default(''),
    })
    .prefault({}),

  /** 战区民心指数（FD-36 · D-EXP-MORALE-02，兑现世界书 uid=19 的 0.0~10.0 民心指数；隐蔽未接触时默认第 0 态「无人在意」） */
  morale: z
    .object({
      value: z.number().min(0).max(10).default(5),
      level: z.string().default('无人在意'),
      engaged: z.boolean().optional(),
      trend: z.string().default(''),
      last_change: z.string().default(''),
    })
    .prefault({}),

  bases: z.array(Base).default([]),

  /** 全局时钟（设计案 §4.1）：游戏内第 N 天＋当日时刻，advanceCalendar 输出是唯一写入方；
   *  optional 挂载（对齐 economy.resources 先例）：旧档/#0 楼归零态零注入 */
  clock: z
    .object({
      day: z.number(),
      time: z.string(),
    })
    .optional(),

  queues: z.array(QueueItem).default([]),

  /** 模式切换在途事务（产线设计案 §4.4，720 分钟校准；optional 挂载对齐 clock 先例：旧档零注入） */
  pending_mode_switches: z
    .array(
      z.object({
        base: z.string().default(''),
        building: z.string(),
        target_mode: z.enum(['生产', '加速']),
        remaining_minutes: z.number().default(720),
      }),
    )
    .optional(),

  /** 展开/收起在途事务（E3 · 设计稿§二，deploymentEngine 写权；optional 挂载仿 pending_mode_switches 先例：旧档零注入；
   *  D1：vehicles 保持 string[] 真源不对象化，在途状态全由本区承载；D3：展开中载具保留在 vehicles 至翻转） */
  pending_deployments: z
    .array(
      z.object({
        vehicle: z.string(), // 载具名（forces.vehicles 字符串真源不动）
        action: z.enum(['展开', '收起']),
        base: z.string().default(''), // 目标基地（Base.id；展开建新基地时＝新基地名）
        into: z.string(), // 展开＝deploy.into 建筑名；收起＝在场建筑名（载具原名由 vehicle 承载回填语义）
        new_base: z
          .object({
            name: z.string(),
            location: z.string().default(''),
            /** 展开建新基地时直接设定的相对首基地时区偏移（FD-26 D-TZ-1） */
            tz_offset: z.number().optional(),
            /** 展开建新基地时设定的初始局部天气（FD-26 D-WTH-1） */
            weather: z.string().optional(),
            /** 展开建新基地时的地理/天体选址类型（FD-26/FD-27） */
            site_type: z.string().optional(),
          })
          .optional(), // 仅「当场建新基地」的展开携带
        remaining_minutes: z.number().default(0), // 展开＝deploy.duration_min；收起＝同块 duration_min（D6 对称）
      }),
    )
    .optional(),

  /** 工程账本（工程玩法 MVP §3.1，D1-C/D2-A/D21）：optional 挂载仿 pending_mode_switches 先例，旧档零注入；
   *  派生不落盘——进度/ETA 由投影 queue 项（type='工程'）承载；元素级 schema_version 预留迁移位 */
  projects: z.array(Project).optional(),

  /** 协议五态账本（协议玩法 MVP §3.2，D-P1/D-P2b & FD-30 协议线索兼容）：optional 挂载仿 projects 先例，无协议旧档零注入；
   *  旧档 tech.done / 在研队列中的 18 条存量协议经 migrateLegacyProtocolsInState 自动迁入 */
  protocols: z
    .array(
      z.union([
        ProtocolInstance,
        z.object({
          ref: z.string().optional(),
          id: z.string(),
          name: z.string(),
          tier: z.number().default(1),
          status: z
            .enum([
              'unrevealed',
              'revealed',
              'undiscovered',
              'locked',
              'available',
              'experimenting',
              'active',
              'voided',
            ])
            .default('revealed'),
          progress: z.number().default(0),
          locked_points: z.number().default(0),
        }),
      ]),
    )
    .optional(),

  /** 协议点储备（协议玩法 MVP §3.2，D-P1/D-P8b）：根标量，缺省兑底 0 */
  protocol_points: z.number().default(0),

  tech: z
    .object({
      done: z.array(z.string()).default([]),
    })
    .prefault({}),

  forces: z
    .object({
      girls: z.array(Girl).default([]),
      troops: z.record(z.string(), z.number()).default({}),
      command_cap: z.string().default(''),
      vehicles: z.array(z.string()).default([]),
      ammo: z.record(z.string(), z.enum(['充足', '尚可', '告急', '无'])).default({}),
      equipment: z.record(z.string(), z.number().default(0)).default({}),
    })
    .prefault({}),

  factions: z.array(Faction).default([]),

  intel: z.array(IntelItem).default([]),

  /** 冷存区：流水超15条时前端自动移入（纯代码，零AI参与）；上限50条 */
  intel_archived: z.array(IntelItem).default([]),

  /** 动态百科：AI 创造物的索引（前端详情弹窗优先查此表，查不到 fallback 到 catalog/girls 静态表） */
  codex: z.array(CodexEntry).default([]),

  /** 机娘档案暂存区：<机娘档案> 标签落此，入档双书成功后由落地器清除（girlFiler）；
   *  EVT-SCHEMA-01 扩容（CTRL-EVENT-01 §4.2/Q4 外部世界书落地暂存门）：元素放宽为 z.any()，
   *  兼收新势力/新科技/新据点等暂存实体（EVT-STAGE-01 承接确认门），旧机娘档案例子零破坏 */
  pending_lore: z.array(z.any()).default([]),

  /** 待授名机娘候审列表（optional 挂载仿 projects 先例，旧档零注入；当后续赐名转正后自动核销移除） */
  pending_girls: z.array(PendingGirlSchema).optional(),

  /** 数据更新补丁暂存区：<数据更新> 标签落此，中控台 Diff 审核后由 worldbookDataFiler 写入世界书并清除（§3.12） */
  pending_data_patches: z.array(DataPatch).default([]),

  /** 已批准生效的数据更新补丁账本（17号方案A · SEAM-03）：随楼层 stat_data 快照自然回退，作为有效目录第4层内存叠加态 */
  applied_data_patches: z.array(DataPatch).default([]),

  /** 扩展档案暂存区：<扩展档案> 标签落此，经 chatBookGateway 写入聊天档案书后由 expansionFiler 清除（CTRL-CHATBOOK-02） */
  pending_expansions: z.array(ExpansionDossier).default([]),

  /** 剧情摘要草稿暂存区：generateRaw 后台产物或 <中摘要>/<大摘要> 落此暂存，审核采纳后写入聊天档案书（CTRL-CHATBOOK-03） */
  pending_summaries: z.array(SummaryDraft).default([]),

  /** 逐楼小摘要流水账（Micro Summaries）：由每楼 <摘要>/<summary> 标签按 floor 幂等入账（optional 挂载仿 projects 先例，旧档零注入） */
  micro_summaries: z.array(MicroSummaryItem).optional(),

  quests: z
    .object({
      active: z.array(Quest).default([]),
      history: z.array(Quest).optional(),
      done_count: z.number().default(0),
    })
    .prefault({}),

  planning: PlanningState.prefault({}),

  command: CommandHQ.prefault({}),

  space: SpaceSlice.prefault({}),

  /** 选项栏：AI 每轮根据局势生成 3 条（预估≠结算，结算以变量更新为准） */
  options: z
    .array(
      z.object({
        text: z.string(),
        tag: z.string().default(''), // 侦察/伪装/稳妥…
        cost: z.string().default(''), // 代价预告，如"暴露+0.05~0.15"
      }),
    )
    .default([]),
});

const rawSchemaParse = Schema.parse.bind(Schema);
const rawSchemaSafeParse = Schema.safeParse.bind(Schema);
Schema.parse = ((data: unknown, params?: unknown) =>
  rawSchemaParse(migrateLegacyProtocolsInState(data), params as never)) as typeof Schema.parse;
Schema.safeParse = ((data: unknown, params?: unknown) =>
  rawSchemaSafeParse(migrateLegacyProtocolsInState(data), params as never)) as typeof Schema.safeParse;

export type Schema = z.output<typeof Schema>;
export type StatData = z.output<typeof Schema>;
export type BuildingState = z.output<typeof BuildingState>;
export type Building = z.output<typeof Building>;
export type Base = z.output<typeof Base>;
export type QueueItem = z.output<typeof QueueItem>;
export type Girl = z.output<typeof Girl>;
export type Faction = z.output<typeof Faction>;
export type IntelItem = z.output<typeof IntelItem>;
export type Quest = z.output<typeof Quest>;
export type CodexEntry = z.output<typeof CodexEntry>;
export type GirlDossier = z.output<typeof GirlDossier>;
export const Dossier = GirlDossier;
export type Dossier = GirlDossier;
