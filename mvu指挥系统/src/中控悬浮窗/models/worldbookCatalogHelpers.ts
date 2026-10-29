/**
 * worldbookCatalogHelpers.ts —— 世界书目录 Zod Schema 契约、字段正则提取与原始载荷预处理辅助
 */
import { z } from 'zod';
import type { PrerequisiteCondition } from '../../红警指挥系统/core/prerequisites';
import { resolveLegacyProtocolName } from '../../红警指挥系统/core/schema';

/** 查找世界书条目中内嵌数据块的标准正则 */
export const DATA_BLOCK_REGEX = /<数据>([\s\S]*?)<\/数据>/;

// ==========================================
// 1. v1.2 扩展实体与虚拟能力类型系统
// ==========================================

/** 物理实体资源速率（单位：标准物理单位/游戏日） */
export type ResourceRate = Record<string, number>;

export const ResourceRateSchema = z.record(z.string(), z.number());

/** 虚拟能力与算力产出（常态可用带宽，非消耗库存） */
export interface VirtualOutputs {
  /** 双轨算力池贡献 */
  compute?: {
    tflops?: number;
    tops?: number;
  };
  /** 态势感知与 C4ISR 指挥通信 */
  c4isr?: {
    recon_km?: number;
    c2_slots?: number;
    ew_rating?: number;
  };
  /** 电网韧性缓冲 */
  grid_buffer?: {
    storage_mwh?: number;
    max_discharge_mw?: number;
  };
  /** 抢修通量（维修类建筑/载具） */
  repair_rate?: number;
}

export const VirtualOutputsSchema = z
  .object({
    compute: z
      .object({
        tflops: z.number().optional(),
        tops: z.number().optional(),
      })
      .optional(),
    c4isr: z
      .object({
        recon_km: z.number().optional(),
        c2_slots: z.number().optional(),
        ew_rating: z.number().optional(),
      })
      .optional(),
    grid_buffer: z
      .object({
        storage_mwh: z.number().optional(),
        max_discharge_mw: z.number().optional(),
      })
      .optional(),
    repair_rate: z.number().optional(),
  })
  .passthrough();

/** 实体原料净消耗 */
export interface EntityInputs {
  resources?: ResourceRate;
}

export const EntityInputsSchema = z
  .object({
    resources: ResourceRateSchema.optional(),
  })
  .passthrough();

/** 实体资源与虚拟能力产出 */
export interface EntityOutputs {
  resources?: ResourceRate;
  virtual?: VirtualOutputs;
}

export const EntityOutputsSchema = z
  .object({
    resources: ResourceRateSchema.optional(),
    virtual: VirtualOutputsSchema.optional(),
  })
  .passthrough();

/** 本地专属缓冲仓储容量 */
export interface EntityStorage {
  resources?: ResourceRate;
}

export const EntityStorageSchema = z
  .object({
    resources: ResourceRateSchema.optional(),
  })
  .passthrough();

/** 动态工况 Buff 调整项 */
export interface OperationalBuff {
  target: string;
  value: number;
  unit?: 'flat' | 'ratio' | 'km' | string;
}

export const OperationalBuffSchema = z.object({
  target: z.string(),
  value: z.number(),
  unit: z.string().optional(),
});

/** 动态工况单项条件 */
export interface OperationalConditionItem {
  trigger: 'low_power' | 'night' | 'weather_bad' | 'damaged' | 'overclock' | string;
  behavior: 'degraded' | 'idle' | 'suspended' | 'boosted' | string;
  efficiency?: number;
  power?: number;
  output?: number;
  buffs?: OperationalBuff[];
  desc: string;
}

export const OperationalConditionItemSchema = z.object({
  trigger: z.string(),
  behavior: z.string(),
  efficiency: z.number().optional(),
  power: z.number().optional(),
  output: z.number().optional(),
  buffs: z.array(OperationalBuffSchema).optional(),
  desc: z.string(),
});

/** 动态条件工况配置 */
export interface OperationalCondition {
  output_type?: 'power' | 'resource' | 'buff';
  base_output?: number;
  buffs?: OperationalBuff[];
  conditions: OperationalConditionItem[];
}

export const OperationalConditionSchema = z
  .object({
    output_type: z.enum(['power', 'resource', 'buff']).optional(),
    base_output: z.number().optional(),
    buffs: z.array(OperationalBuffSchema).optional(),
    conditions: z.array(OperationalConditionItemSchema).default([]),
  })
  .passthrough();

/** 双轨代偿生产配方 */
export interface ProductionRecipe {
  id: string;
  name: string;
  is_default?: boolean;
  inputs?: {
    credits?: number;
    resources?: ResourceRate;
  };
  outputs?: {
    resources?: ResourceRate;
    virtual?: VirtualOutputs;
  };
  desc: string;
}

export const ProductionRecipeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    is_default: z.boolean().optional(),
    inputs: z
      .object({
        credits: z.number().optional(),
        resources: ResourceRateSchema.optional(),
      })
      .optional()
      .default({}),
    outputs: z
      .object({
        resources: ResourceRateSchema.optional(),
        virtual: VirtualOutputsSchema.optional(),
      })
      .optional()
      .default({}),
    desc: z.string(),
  })
  .passthrough();

/** 物理计算量需求 */
export interface ResearchWorkload {
  tflops?: number;
  tops?: number;
  days?: number;
  min_days?: number;
}

export const ResearchWorkloadSchema = z
  .object({
    tflops: z.number().optional(),
    tops: z.number().optional(),
    days: z.number().optional(),
    min_days: z.number().optional(),
  })
  .passthrough();

/** 两阶段生产配置 */
export interface TwoStageAssembly {
  t_mat?: number;
  t_asm?: number;
  req_nanites?: number;
  min_days?: number;
  t_min?: number;
}

export const TwoStageAssemblySchema = z
  .object({
    t_mat: z.number().optional(),
    t_asm: z.number().optional(),
    req_nanites: z.number().optional(),
    min_days: z.number().optional(),
    t_min: z.number().optional(),
  })
  .passthrough();

// ==========================================
// 1.1 工程玩法 MVP：retrofit V1 可选增量类型（D14-A / D15 / D16 / D22）
// ==========================================

/** 工程资源需求（P0 面向未来接口：对象化承载，永不裸字段） */
export interface RetrofitResources {
  nanites?: number;
}

export const RetrofitResourcesSchema = z
  .object({
    nanites: z.number().optional(),
  })
  .passthrough();

/** retrofit 阶段工作量（需求侧声明；tflops/tops 走冻结加速公式，永不作前置） */
export interface RetrofitPhaseWorkload {
  days: number;
  min_days: number;
  tflops?: number;
  tops?: number;
}

export const RetrofitPhaseWorkloadSchema = z
  .object({
    days: z.number(),
    min_days: z.number(),
    tflops: z.number().optional(),
    tops: z.number().optional(),
  })
  .passthrough();

/** retrofit 单阶段定义（D15：name 必填，workload/cost/resources 全 optional） */
export interface RetrofitPhase {
  name: string;
  workload?: RetrofitPhaseWorkload;
  cost?: number;
  resources?: RetrofitResources;
}

export const RetrofitPhaseSchema = z
  .object({
    name: z.string(),
    workload: RetrofitPhaseWorkloadSchema.optional(),
    cost: z.number().optional(),
    resources: RetrofitResourcesSchema.optional(),
  })
  .passthrough();

/** 改装目标平台指针（D16：引用不搬块，遵守唯一 owner；非库存实例） */
export interface RetrofitTarget {
  kind: 'unit' | 'building';
  id: string;
}

export const RetrofitTargetSchema = z.object({
  kind: z.enum(['unit', 'building']),
  id: z.string(),
});

// ==========================================
// 2. 核心条目数据块类型与 Schema
// ==========================================

export interface WorldbookDataBase {
  schema_version?: number;
  type: 'research' | 'building' | 'production' | 'retrofit' | 'project' | 'protocol';
  id: string;
  name: string;
  cost: number;
  desc: string;
  tags: string[];
  faction?: string;
  scope?: string;
  requirements?: PrerequisiteCondition;
}

export interface WorldbookBuildingData extends WorldbookDataBase {
  type: 'building';
  power: number;
  tier?: 1 | 2 | 3;
  research?: string | null;
  need_building?: string;
  prereqs: string[];
  need_buildings: string[];
  icon?: string;
  /** 建筑五大体系显式分类（FD-18 单一事实源：military/defense/agro/industry/research_space） */
  system?: 'military' | 'defense' | 'agro' | 'industry' | 'research_space';
  /** 建筑在所属体系下的子分环/阶段分组（如：外圈·远程预警反导与隐身屏蔽） */
  system_group?: string;
  /** 是否可脱离母体独立平地建造（FD-22：缺省 true；纯升级包/扩建挂件为 false） */
  standalone?: boolean;
  /** 主体/前代建筑对象（FD-22：支持单个或多个母体建筑名称） */
  host_building?: string | string[];
  /** 升级/扩建作用模式（FD-22：replace=原位换代升版，addon=母体外挂模块） */
  upgrade_mode?: 'replace' | 'addon';
  /** 升级完成后的正式高级建筑名称（FD-22：缺省取自身 name） */
  upgraded_name?: string;
  eta?: string;
  workload?: ResearchWorkload;
  operation?: OperationalCondition;
  inputs?: EntityInputs;
  outputs?: EntityOutputs;
  storage?: EntityStorage;
  recipes?: ProductionRecipe[];
}

export const WorldbookBuildingDataSchema = z
  .object({
    schema_version: z.number().optional().default(1),
    type: z.literal('building'),
    id: z.string(),
    name: z.string().optional(),
    cost: z.number().default(0),
    power: z.number().default(0),
    tier: z
      .union([z.literal(1), z.literal(2), z.literal(3)])
      .optional()
      .default(1),
    research: z.string().nullable().optional(),
    need_building: z.string().optional(),
    prereqs: z.array(z.string()).optional().default([]),
    need_buildings: z.array(z.string()).optional().default([]),
    icon: z.string().optional(),
    faction: z.string().optional(),
    scope: z.string().optional(),
    system: z.enum(['military', 'defense', 'agro', 'industry', 'research_space']).optional(),
    system_group: z.string().optional(),
    standalone: z.boolean().optional(),
    host_building: z.union([z.string(), z.array(z.string())]).optional(),
    upgrade_mode: z.enum(['replace', 'addon']).optional(),
    upgraded_name: z.string().optional(),
    eta: z.string().optional(),
    workload: ResearchWorkloadSchema.optional(),
    tags: z.array(z.string()).optional().default([]),
    desc: z.string().optional().default(''),
    operation: OperationalConditionSchema.optional(),
    inputs: EntityInputsSchema.optional(),
    outputs: EntityOutputsSchema.optional(),
    storage: EntityStorageSchema.optional(),
    recipes: z.array(ProductionRecipeSchema).optional(),
    requirements: z.any().optional(),
  })
  .passthrough();

export interface WorldbookResearchData extends WorldbookDataBase {
  type: 'research';
  eta?: string;
  line: string;
  tier: 1 | 2 | 3;
  unlocks?: string;
  prereq?: string;
  prereqs: string[];
  need_buildings: string[];
  need_units?: string[];
  workload?: ResearchWorkload;
  /** V2（schema_version:2）新字段：历史曾用名（别名），供权威名集合/体检对账 */
  aliases?: string[];
  /** V2：通用=common，阵营特色=faction（faction 时另附 faction 字段） */
  scope?: string;
  faction?: string;
  /** V2：扩展包归属（默认 base；DLC 用 dlc:<包名>） */
  pack?: string;
  /** V2：active|deprecated|planned；deprecated 配 replaced_by */
  status?: string;
  replaced_by?: string;
  /** V2：仅非实体解锁（能力/系统/UI 开关） */
  grants?: string[];
}

export const WorldbookResearchDataSchema = z
  .object({
    schema_version: z.number().optional().default(1),
    type: z.literal('research'),
    id: z.string(),
    name: z.string().optional(),
    cost: z.number().default(0),
    eta: z.string().optional().default(''),
    line: z.string().optional().default('通用'),
    tier: z
      .union([z.literal(1), z.literal(2), z.literal(3)])
      .optional()
      .default(1),
    unlocks: z.string().optional().default(''),
    prereq: z.string().optional().default(''),
    prereqs: z.array(z.string()).optional().default([]),
    need_buildings: z.array(z.string()).optional().default([]),
    need_units: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional().default([]),
    desc: z.string().optional().default(''),
    workload: ResearchWorkloadSchema.optional(),
    requirements: z.any().optional(),
    // ── V2（schema_version:2）可选透传字段：显式声明，避免依赖 passthrough 的隐式行为 ──
    aliases: z.array(z.string()).optional(),
    scope: z.string().optional(),
    faction: z.string().optional(),
    pack: z.string().optional(),
    status: z.string().optional(),
    replaced_by: z.string().optional(),
    grants: z.array(z.string()).optional(),
  })
  .passthrough();

export type WorldbookProductionCategory =
  | 'infantry'
  | 'vehicle'
  | 'aircraft'
  | 'naval'
  | 'defense'
  | 'armor'
  | 'support'
  | 'artillery'
  | 'air'
  | 'equipment'
  | 'ship'
  | 'platform'
  | 'component'
  | 'doctrine';

export const WorldbookProductionCategorySchema = z.enum([
  'infantry',
  'vehicle',
  'aircraft',
  'naval',
  'defense',
  'armor',
  'support',
  'artillery',
  'air',
  'equipment',
  'ship',
  'platform',
  'component',
  'doctrine',
]);

export interface WorldbookProductionData extends WorldbookDataBase {
  type: 'production';
  need_building?: string;
  need_buildings: string[];
  prereqs?: string[];
  category?: WorldbookProductionCategory;
  aliases?: string[];
  /** 生产数量上限（HERO-UNIT-01：如英雄级唯一单位 max_count=1；缺省无上限） */
  max_count?: number;
  eta?: string;
  workload?: ResearchWorkload;
  assembly?: TwoStageAssembly;
  outputs?: EntityOutputs;
  storage?: EntityStorage;
}

export const WorldbookProductionDataSchema = z
  .object({
    schema_version: z.number().optional().default(1),
    type: z.literal('production'),
    id: z.string(),
    name: z.string().optional(),
    cost: z.number().default(0),
    need_building: z.string().optional().default(''),
    need_buildings: z.array(z.string()).optional().default([]),
    prereqs: z.array(z.string()).optional().default([]),
    category: WorldbookProductionCategorySchema.optional(),
    faction: z.string().optional(),
    scope: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    max_count: z.number().int().positive().optional(),
    eta: z.string().optional(),
    workload: ResearchWorkloadSchema.optional(),
    tags: z.array(z.string()).optional().default([]),
    desc: z.string().optional().default(''),
    assembly: TwoStageAssemblySchema.optional(),
    outputs: EntityOutputsSchema.optional(),
    storage: EntityStorageSchema.optional(),
    requirements: z.any().optional(),
  })
  .passthrough();

export interface WorldbookRetrofitData extends WorldbookDataBase {
  type: 'retrofit';
  research: string;
  grade?: string;
  /** V1 可选增量（D15）：多阶段定义；数值冻结过 ENG-ECON-01 对账门 */
  phases?: RetrofitPhase[];
  /** V1 可选增量（P0 对象化）：工程级资源需求，禁止裸 nanites 字段 */
  resources?: RetrofitResources;
  /** V1 可选增量（D16）：改装目标平台指针（引用不搬块） */
  target?: RetrofitTarget;
  /** V1 可选增量：base=短期单基地 | theater=长期多基地（theater 实操属 Growth） */
  scope?: 'base' | 'theater';
  /** V1 可选增量（D22）：SVG 场景 id，如 'scene.workshop.generic' */
  scene?: string;
  /** 对应的标准生产单位名称（FD-22：支持单个或多个单位名） */
  target_unit?: string | string[];
  /** 对应的母体建筑名称（FD-22：用于建筑类改装工程） */
  host_building?: string | string[];
  /** 现代化改造后的正式高级型号名分（FD-22：单目标为 string，多目标支持映射表） */
  upgraded_name?: string | Record<string, string>;
}

export const WorldbookRetrofitDataSchema = z
  .object({
    schema_version: z.number().optional().default(1),
    type: z.literal('retrofit'),
    id: z.string(),
    name: z.string().optional(),
    cost: z.number().optional().default(0),
    research: z.string(),
    grade: z.string().optional(),
    tags: z.array(z.string()).optional().default([]),
    desc: z.string().optional().default(''),
    requirements: z.any().optional(),
    // ── 工程玩法 V1 可选增量（schema_version 保持 1，旧块零改动）──
    phases: z.array(RetrofitPhaseSchema).optional(),
    resources: RetrofitResourcesSchema.optional(),
    target: RetrofitTargetSchema.optional(),
    scope: z.enum(['base', 'theater']).optional(),
    scene: z.string().optional(),
    target_unit: z.union([z.string(), z.array(z.string())]).optional(),
    host_building: z.union([z.string(), z.array(z.string())]).optional(),
    upgraded_name: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  })
  .passthrough();

/* ==========================================
 * 1.2 仓段化 V2：project 块类型（V2-04 · 仓段化V2设计案 §3.1，schema_version 2）
 *    模块拓扑取代 V1 线性阶段链；产物形状对齐 projectEngine.ProjectV2Def（startProjectV2 直喂口径）。
 * ========================================== */

/** V2 模块工作量（字段口径对齐 RetrofitPhaseWorkload：days/min_days 必填进投影，tflops/tops 需求侧留加速接缝） */
export interface ProjectModuleWorkload {
  days: number;
  min_days: number;
  tflops?: number;
  tops?: number;
}

export const ProjectModuleWorkloadSchema = z
  .object({
    days: z.number(),
    min_days: z.number(),
    tflops: z.number().optional(),
    tops: z.number().optional(),
  })
  .passthrough();

/** V2 仓段模块静态定义（设计案 §3.1 modules[] 元素；D-C1 模块≈带身份的单阶段） */
export interface ProjectModuleDef {
  /** 模块 id（工程内唯一；prereqs 拓扑边引用键） */
  id: string;
  /** 模块名（缺省回填 id——parseSingleDataBlock 兑底；投影命名合同 `ref·模块名` 第二元） */
  name: string;
  /** 模块注资额（D8 分模块注资：断链=模块停摆非工程暴毙） */
  cost?: number;
  workload?: ProjectModuleWorkload;
  /** 模块级纳米开工门（D8b 门槛非抵扣；P0 对象化复用 retrofit 口径） */
  resources?: RetrofitResources;
  /** 前置模块 id 集（拓扑边）；空集=根模块（缺省兑底 []） */
  prereqs: string[];
}

export const ProjectModuleDefSchema = z
  .object({
    id: z.string(),
    name: z.string().optional().default(''),
    cost: z.number().optional(),
    workload: ProjectModuleWorkloadSchema.optional(),
    resources: RetrofitResourcesSchema.optional(),
    prereqs: z.array(z.string()).optional().default([]),
  })
  .passthrough();

/**
 * V2 工程资格需求（§3.1 requirements：扁平四键声明位，与 retrofit 的条件树 requirements 是两种口径——
 * 机器门分别由属地槽锚定建筑门/模块注资门/模块纳米开工门承载，声明位本身不求值）。
 */
export interface ProjectRequirements {
  /** 前置科技 ∈ tech.done（资格门） */
  research?: string;
  /** 锚定建筑声明位（机器门=工程槽属地容量，D-C4） */
  building?: string;
  /** 造价声明位（机器扣款按模块注资额；D12 对账门 V2-11） */
  credits?: number;
  /** 纳米声明位（机器门按模块开工门，D8b） */
  nanites?: number;
}

export const ProjectRequirementsSchema = z
  .object({
    research: z.string().optional(),
    building: z.string().optional(),
    credits: z.number().optional(),
    nanites: z.number().optional(),
  })
  .passthrough();

/**
 * 仓段化 V2 工程块（V2-04 激活，替换 D14-A MVP 占位分支）：
 * type:'project' + schema_version:2 才是合法 project 块——版本轴判别（设计案 §2），
 * schema_version ≠2（含缺失）一律 fail-closed 条目级隔离（V2 是唯一 project 版本，零存量迁移负担）。
 * tier/scene/outcome/pack/status 为透传字段（不入引擎契约，V2-06/V2-07/V2-11 消费）。
 */
export interface WorldbookProjectData {
  schema_version: 2;
  type: 'project';
  /** 命名规约 <阵营>.project.<slug>（点号 id 必须显式 name≠id，见 parseSingleDataBlock 护栏） */
  id: string;
  /** 运行时引用键（ref=def.name，V1 `ref: def.name` 同口径） */
  name: string;
  /** 声明位缺省 0（机器口径=模块 cost 合计；requirements.credits 为对账声明位） */
  cost: number;
  desc: string;
  tags: string[];
  /** 小改|中改|大改|巨构（D-C2 V2 档）；catalog 侧枚举收敛，缺省引擎补「巨构」 */
  grade?: string;
  /** 缺省 base（D-C3 不强制多基地） */
  scope?: 'base' | 'theater';
  requirements?: ProjectRequirements;
  /** 模块拓扑（≥1；空数组/缺席 fail-closed） */
  modules: ProjectModuleDef[];
  tier?: number;
  /** D22 场景 id 透传（如 'scene.orbital_shipyard'） */
  scene?: string;
  /** 完工产出物透传（引擎现固定 {type:'mark'}，def 驱动 outcome 归 V2-11 对齐） */
  outcome?: { type: string; text?: string };
  pack?: string;
  status?: string;
}

export const WorldbookProjectDataSchema = z
  .object({
    schema_version: z.literal(2),
    type: z.literal('project'),
    id: z.string(),
    name: z.string().optional(),
    cost: z.number().optional().default(0),
    tags: z.array(z.string()).optional().default([]),
    desc: z.string().optional().default(''),
    grade: z.string().optional(),
    scope: z.enum(['base', 'theater']).optional(),
    requirements: ProjectRequirementsSchema.optional(),
    modules: z.array(ProjectModuleDefSchema).min(1),
    tier: z.number().optional(),
    scene: z.string().optional(),
    outcome: z
      .object({
        type: z.string(),
        text: z.string().optional(),
      })
      .passthrough()
      .optional(),
    pack: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();

/* ==========================================
 * 1.3 协议玩法 MVP：protocol 块类型（PRT-PARSE-01 · 任务包 §3.1 / D-P17 / D-P20b）
 * ========================================== */

/** 协议启封发现配置（可选；缺省=开局无需启封） */
export interface ProtocolDiscovery {
  kind: 'experiment' | 'event';
  building_any?: string[];
  research_all?: string[];
}

export const ProtocolDiscoverySchema = z
  .object({
    kind: z.enum(['experiment', 'event']),
    building_any: z.array(z.string()).optional(),
    research_all: z.array(z.string()).optional(),
  })
  .passthrough();

/** 按协议 Tier 计算缺省单次实验消耗资金（T1=500 / T2=1500 / T3=4000） */
export function defaultExperimentCostCreditsByTier(tier: 1 | 2 | 3 | number | undefined): number {
  if (tier === 3) return 4000;
  if (tier === 2) return 1500;
  return 500;
}

export interface WorldbookProtocolData {
  schema_version: number;
  type: 'protocol';
  id: string;
  name: string;
  scope: string;
  faction: string;
  track: string;
  tier: 1 | 2 | 3;
  /** 每次实验消耗协议点数（缺省恒为 1） */
  cost_points: number;
  /** 单次实验消耗资金（缺省按 tier 表 T1=500 / T2=1500 / T3=4000） */
  experiment_cost_credits: number;
  /** 激活后可见的科技 ID 数组（缺省 []） */
  reveals: string[];
  /** 可选启封条件；缺省=开局无需启封 */
  discovery?: ProtocolDiscovery;
  /** 可选预留互斥协议 ID 列表（缺省 []） */
  exclusive_with: string[];
  /** 准入门：复用现有三原子树（可选） */
  requirements?: PrerequisiteCondition;
  /** 可选传统前置研究名列表 */
  prereqs?: string[];
  /** 可选传统前置建筑名列表 */
  need_buildings?: string[];
  /** 可选别名列表 */
  aliases?: string[];
  pack: string;
  status: string;
  desc: string;
  tags: string[];
}

/** 任务包 §3.1 / §6 PRT-PARSE-01 别名 */
export type WbProtocolBlock = WorldbookProtocolData;

export const WorldbookProtocolDataSchema = z
  .object({
    schema_version: z.number().optional().default(2),
    type: z.literal('protocol'),
    id: z.string(),
    name: z.string().optional(),
    scope: z.string().optional().default('faction'),
    faction: z.string().optional().default(''),
    track: z.string().optional().default(''),
    tier: z
      .union([z.literal(1), z.literal(2), z.literal(3)])
      .optional()
      .default(1),
    cost_points: z.number().positive().optional().default(1),
    experiment_cost_credits: z.number().nonnegative().optional(),
    reveals: z.array(z.string()).optional().default([]),
    discovery: ProtocolDiscoverySchema.optional(),
    exclusive_with: z.array(z.string()).optional().default([]),
    requirements: z.any().optional(),
    prereqs: z.array(z.string()).optional(),
    need_buildings: z.array(z.string()).optional(),
    aliases: z.array(z.string()).optional(),
    pack: z.string().optional().default('base'),
    status: z.string().optional().default('active'),
    desc: z.string().optional().default(''),
    tags: z.array(z.string()).optional().default([]),
  })
  .passthrough();

/* ==========================================
 * 1.4 机娘能力档案数据块：maiden 块类型（MAIDEN-DATA-01）
 * ========================================== */

export interface MaidenSpecialSkillItem {
  name: string;
  kind: string;
  desc: string;
}

export const MaidenSpecialSkillItemSchema = z
  .object({
    name: z.string(),
    kind: z.string(),
    desc: z.string(),
  })
  .passthrough();

export interface MaidenSpecialEquipmentItem {
  name: string;
  slot: string;
  desc: string;
}

export const MaidenSpecialEquipmentItemSchema = z
  .object({
    name: z.string(),
    slot: z.string(),
    desc: z.string(),
  })
  .passthrough();

export type MaidenIncubationBlockMode = 'iconic_fixed' | 'blindbox_christen' | 'rule_guideline';

export interface WorldbookMaidenData {
  schema_version: number;
  type: 'maiden';
  id: string;
  name: string;
  model: string;
  faction: string;
  tier?: number;
  incubation_mode: MaidenIncubationBlockMode;
  preset_name?: string;
  callsign?: string;
  serial?: string;
  form_mech?: string;
  temperament_spectrum?: string;
  special_skills: MaidenSpecialSkillItem[];
  special_equipment: MaidenSpecialEquipmentItem[];
  flaws?: string;
  exposure_grade?: string;
  balance_slot?: string;
  desc: string;
  tags: string[];
}

export const WorldbookMaidenDataSchema = z
  .object({
    schema_version: z.number().optional().default(1),
    type: z.literal('maiden'),
    id: z.string(),
    name: z.string().optional(),
    model: z.string(),
    faction: z.string().optional().default('通用'),
    tier: z.number().optional(),
    incubation_mode: z
      .enum(['iconic_fixed', 'blindbox_christen', 'rule_guideline'])
      .optional()
      .default('blindbox_christen'),
    preset_name: z.string().optional(),
    callsign: z.string().optional(),
    serial: z.string().optional(),
    form_mech: z.string().optional(),
    temperament_spectrum: z.string().optional(),
    special_skills: z.array(MaidenSpecialSkillItemSchema).optional().default([]),
    special_equipment: z.array(MaidenSpecialEquipmentItemSchema).optional().default([]),
    flaws: z.string().optional(),
    exposure_grade: z.string().optional(),
    balance_slot: z.string().optional(),
    desc: z.string().optional().default(''),
    tags: z.array(z.string()).optional().default([]),
  })
  .passthrough();

export type WorldbookDataBlock =
  | WorldbookBuildingData
  | WorldbookResearchData
  | WorldbookProductionData
  | WorldbookRetrofitData
  | WorldbookProjectData
  | WorldbookProtocolData
  | WorldbookMaidenData;

export const WorldbookDataBlockSchema = z.discriminatedUnion('type', [
  WorldbookBuildingDataSchema,
  WorldbookResearchDataSchema,
  WorldbookProductionDataSchema,
  WorldbookRetrofitDataSchema,
  WorldbookProjectDataSchema,
  WorldbookProtocolDataSchema,
  WorldbookMaidenDataSchema,
]);


// ==========================================
// 5. 核心纯函数实现
// ==========================================

/**
 * 从世界书正文中提取 <数据>...</数据> 内的原始文本
 * 自动兼容前后的换行、缩进及空白字符。
 */
export function extractDataBlockString(content: string): string | null {
  if (!content || typeof content !== 'string') return null;
  const match = content.match(DATA_BLOCK_REGEX);
  if (!match) return null;
  return match[1].trim();
}

/**
 * 从世界书条目正文中智能提炼展示描述：
 * 1. 剥离 <数据>...</数据> 块
 * 2. 剥离首行中括号/方括号标题（如 `[通用·主建筑 | 战车工厂]` 或 `【...】`）
 * 3. 提取第一段自然语言叙述（优先按连续双换行分段，取首个非空段落）
 */
export function extractDescriptionFromContent(content: string, maxLength?: number): string {
  if (!content || typeof content !== 'string') return '';

  // 1. 剥离 <数据>...</数据> 标签及其内容，以及 *系统映射：...* 元数据行
  const withoutData = content
    .replace(/<数据>[\s\S]*?<\/数据>/g, '')
    .replace(
      /(?:^|(?:\r?\n)+)[ \t]*(?:\*+|[·\-•]+\s*)?(?:(?:【|\[)\s*系统映射\s*(?:】|\])|系统映射\s*[：:])[^\r\n]*/g,
      '',
    )
    .trim();

  // 2. 剥离开头的首行中括号标题，例如 `[通用·主建筑 | 战车工厂]` 或 `【...】`
  const withoutTitle = withoutData.replace(/^(\[[^\]\n]*\]|【[^】\n]*】)[^\S\r\n]*\r?\n?/, '').trim();

  if (!withoutTitle) return '';

  // 3. 提取第一段自然语言叙述（按双换行 \r?\n\s*\r?\n 分段）
  const paragraphs = withoutTitle
    .split(/\r?\n\s*\r?\n/)
    .map(p => p.trim())
    .filter(Boolean);

  let desc = paragraphs.length > 0 ? paragraphs[0] : '';

  if (maxLength && maxLength > 0 && desc.length > maxLength) {
    desc = desc.slice(0, maxLength);
  }

  return desc;
}

/**
 * 剥离生产项目名称尾部的“（量产体）”/“（量产型步兵）”后缀，保持兵种标准名称整洁。
 */
export function stripMassProductionSuffix(rawName: string): string {
  if (!rawName || typeof rawName !== 'string') return '';
  return rawName
    .trim()
    .replace(/\s*[（(](?:量产体|量产型步兵)[）)]\s*$/u, '')
    .trim();
}

/**
 * 历史动作型建筑旧名（xx实现/xx改造/xx升级/xx改装/xx扩建）→ 正式实体建筑/设施名映射表
 * 确保即使宿主尚未重新导入最新版世界书 JSON，运行时解析也能自动正名为实体建筑名。
 */
export const LEGACY_ACTION_BUILDING_NAME_MAP: Readonly<Record<string, string>> = {
  '盟军先进态势与 C4ISR 指挥实现': '盟军先进态势与C4ISR指挥中心',
  盟军先进态势与C4ISR指挥实现: '盟军先进态势与C4ISR指挥中心',
  先进光棱塔升级: '先进光棱塔',
  爱国者阵地增强改装: '爱国者PAC-3增强防空阵地',
  数字孪生与柔性生产改造: '数字孪生与柔性生产车间',
  智能电网调度改造: '智能电网潮流调度中心',
  预测维护改造: '预测性健康维护中心',
  无人仓储与最优调度改造: '无人立体仓储调度中心',
  盟军稳定入轨实现: '盟军稳定入轨发射场',
  盟军持续轨道节点实现: '盟军持续轨道空间站',
  苏联先进态势与防空指挥实现: '苏联先进态势与防空指挥中心',
  战略铁路编组与动员扩建: '战略铁路编组与动员枢纽',
  装甲储备与装备再生扩建: '装甲储备与装备再生基地',
  'Crusher Crane维修—拆件—报废扩建': 'Crusher Crane重型拆解回收站',
  '快堆—闭式燃料循环升级': '快堆闭式循环核电站',
  地下国家连续性升级: '国家连续性深层地下要塞',
  国家总动员兵工城实现: '国家总动员兵工城',
  地下重载军运实现: '地下重载军运管道枢纽',
  铁幕多节点网络升级: '铁幕多节点偏折网络',
};

export function normalizeActionBuildingName(rawName: string): string {
  const trimmed = (rawName || '').trim();
  return LEGACY_ACTION_BUILDING_NAME_MAP[trimmed] ?? trimmed;
}

/**
 * 推导算力设施建筑的默认名义算力产出（outputs.virtual.compute）
 * 兼容带阵营前缀的战斗实验室/作战实验室（盟军/苏联/尤里/升阳/焚风）、设计局、研究院、超算中心与量子超算中心
 */
export function inferDefaultBuildingCompute(
  rawName: unknown,
  rawId?: unknown,
): { tflops: number; tops: number } | null {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  const id = typeof rawId === 'string' ? rawId.trim().toLowerCase() : '';
  if (!name && !id) return null;

  if (
    /量子超算中心|国家战略工程综合体|红星科学城|盟军联合科研与国家工程组织节点|盟军尖端科技研究院|双螺旋生命工程与高维意识科学院/.test(
      name,
    ) ||
    /quantum_supercomputing|red_star_science_city|joint_research_organization|double_helix_academy/.test(id)
  ) {
    return { tflops: 120, tops: 60 };
  }
  if (/超算中心|大型超算中心/.test(name) || /supercomputing_center/.test(id)) {
    return { tflops: 50, tops: 30 };
  }
  if (
    /战斗实验室|作战实验室|红星实验设计局|基因测序与心灵谐振研究院|纳米电脑主机|焚风湍流实验室|战术科研中心/.test(
      name,
    ) ||
    /battle_lab|red_star_design_bureau|gene_psychic_institute/.test(id)
  ) {
    return { tflops: 50, tops: 30 };
  }
  return null;
}

/**
 * 从 eta 文本（如 "约3日"、"约2-3日"、"约12小时"）解析出标准工期天数与锁定期
 */
export function parseEtaStringToWorkload(
  etaStr: unknown,
  existingMinDays?: number,
): { days: number; min_days: number } | null {
  if (typeof etaStr !== 'string' || !etaStr.trim()) return null;
  const s = etaStr.trim();
  const rangeMatch = s.match(/(\d+(?:\.\d+)?)\s*[-~～至]\s*(\d+(?:\.\d+)?)\s*[日天]/);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b > 0) {
      const days = b - a <= 5 ? b : Math.round((a + b) / 2);
      const min_days =
        typeof existingMinDays === 'number' && existingMinDays > 0
          ? existingMinDays
          : Math.max(1, Math.floor(a));
      return { days, min_days };
    }
  }
  const singleDayMatch = s.match(/(\d+(?:\.\d+)?)\s*[日天]/);
  if (singleDayMatch) {
    const d = Number(singleDayMatch[1]);
    if (Number.isFinite(d) && d > 0) {
      const defaultMin = d <= 2 ? 1 : d <= 4 ? 2 : d <= 5 ? 3 : Math.max(1, Math.round(d * 0.7));
      const min_days =
        typeof existingMinDays === 'number' && existingMinDays > 0 ? existingMinDays : defaultMin;
      return { days: d, min_days };
    }
  }
  const hourMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:小时|h|hr)/i);
  if (hourMatch) {
    const h = Number(hourMatch[1]);
    if (Number.isFinite(h) && h > 0) {
      const days = Number((h / 24).toFixed(4));
      const min_days = typeof existingMinDays === 'number' && existingMinDays > 0 ? existingMinDays : 0;
      return { days, min_days };
    }
  }
  return null;
}

function roundHalfDay(x: number): number {
  return Math.round(x * 2) / 2;
}

export type InferredEntityDurationCategory = '建筑' | '人员' | '装备' | '陆军载具' | '空军' | '海军';

/**
 * 按实体类别与造价推导写实工期（days / min_days）：
 * - 建筑（building）：轻型围墙/工事 1~2 天，兵营/碉堡($500~$600) 2.5 天，发电厂($800) 3.5 天，
 *   空指/船厂($1500~$1800) 5 天，矿石精炼厂/战车工厂($2000) 6.5 天，重型/超武 9~45 天；
 * - 人员（infantry）：控制在几天内（0.5 ~ 4 天：普通步兵 $200~$300 约 1 天，特种兵 $500~$900 约 1.5~2.5 天，传奇/顶级 $1500~$2000 约 3.5~4 天）；
 * - 装备（equipment）：0.5 ~ 5 天；
 * - 陆军载具（vehicle / armor / support / artillery）：起步 2~3 天（恐怖机器人 $400 约 2.5 天），
 *   常规主战坦克/采矿车（$900~$1600）约 4~5.5 天，重型要塞坦克（$2000~$2500）约 6.5~8 天，十天内出厂；
 * - 空军（air / aircraft）：流水线生产，最多二三十天（轻型旋翼机 4~6 天，主力战机 10~16 天，重型战略轰炸机 22~28 天）；
 * - 海军舰艇（naval / ship）：快艇/潜航器 7~18 天，驱护舰/常规潜艇两三个月（38~75 天），战列舰/大型航母按季度算（85~120 天）。
 */
export function inferCategoryEntityDuration(entry: {
  type?: unknown;
  name?: unknown;
  cost?: unknown;
  tier?: unknown;
  category?: unknown;
  need_building?: unknown;
  need_buildings?: unknown;
  system?: unknown;
  tags?: unknown;
}): { eta: string; days: number; min_days: number; categoryLabel: InferredEntityDurationCategory } {
  const c = typeof entry.cost === 'number' && Number.isFinite(entry.cost) && entry.cost >= 0 ? entry.cost : 500;
  const typeStr = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '';
  const catStr = typeof entry.category === 'string' ? entry.category.trim().toLowerCase() : '';
  const needStr = [
    typeof entry.need_building === 'string' ? entry.need_building : '',
    ...(Array.isArray(entry.need_buildings) ? entry.need_buildings.filter(s => typeof s === 'string') : []),
  ].join(' ');
  const isBuilding =
    typeStr === 'building' ||
    (!typeStr &&
      !catStr &&
      typeof entry.system === 'string' &&
      ['military', 'defense', 'agro', 'industry', 'research_space'].includes(entry.system));

  if (isBuilding) {
    let days = 2.5;
    let min_days = 1.5;
    if (c <= 200) {
      days = 1;
      min_days = 0.5;
    } else if (c <= 400) {
      days = 2;
      min_days = 1;
    } else if (c <= 600) {
      days = 2.5;
      min_days = 1.5;
    } else if (c <= 1000) {
      days = 3.5;
      min_days = 2;
    } else if (c <= 1800) {
      days = 5;
      min_days = 3;
    } else if (c <= 2500) {
      days = 6.5;
      min_days = 4;
    } else if (c <= 5000) {
      days = 9;
      min_days = 6;
    } else if (c <= 20000) {
      days = roundHalfDay(10 + c / 2500);
      min_days = 8;
    } else {
      days = Math.min(45, Math.round(18 + Math.sqrt(c / 10000) * 3));
      min_days = Math.round(days * 0.7);
    }
    return { eta: `约${days}日`, days, min_days, categoryLabel: '建筑' };
  }

  const isNaval = catStr === 'naval' || catStr === 'ship' || /造船厂|船坞/.test(needStr);
  const isAir = catStr === 'air' || catStr === 'aircraft' || /空军|航空|机场|引导盘/.test(needStr);
  const isEquip = catStr === 'equipment' || /装备制造所/.test(needStr);
  const isInfantry =
    catStr === 'infantry' || (!isNaval && !isAir && !isEquip && /兵营|训导营/.test(needStr));

  if (isEquip) {
    const days = Math.min(5, Math.max(0.5, roundHalfDay(0.5 + c / 800)));
    const min_days = Math.max(0.25, roundHalfDay(days * 0.6));
    return { eta: `约${days}日`, days, min_days, categoryLabel: '装备' };
  }
  if (isInfantry) {
    const days = Math.min(4, Math.max(0.5, roundHalfDay(0.5 + c / 500)));
    const min_days = Math.max(0.5, roundHalfDay(days * 0.6));
    return { eta: `约${days}日`, days, min_days, categoryLabel: '人员' };
  }
  if (isAir) {
    let days: number;
    if (c <= 1500) days = roundHalfDay(3 + c / 500);
    else if (c <= 10000) days = Math.round(6 + (c - 1500) / 750);
    else days = Math.min(28, Math.round(17 + (c - 10000) / 3000));
    const min_days = Math.max(2, Math.round(days * 0.7));
    return { eta: `约${days}日`, days, min_days, categoryLabel: '空军' };
  }
  if (isNaval) {
    let days: number;
    if (c <= 4000) days = Math.round(6 + c / 350);
    else if (c <= 20000) days = Math.round(18 + (c - 4000) / 800);
    else if (c <= 80000) days = Math.round(38 + (c - 20000) / 1600);
    else if (c <= 200000) days = Math.round(75 + (c - 80000) / 6000);
    else days = Math.min(120, Math.round(95 + (c - 200000) / 14000));
    const min_days = Math.max(4, Math.round(days * 0.75));
    return { eta: `约${days}日`, days, min_days, categoryLabel: '海军' };
  }

  let days: number;
  if (c <= 600) days = roundHalfDay(2 + c / 600);
  else if (c <= 2500) days = roundHalfDay(3 + (c - 600) / 400);
  else if (c <= 6000) days = roundHalfDay(8 + (c - 2500) / 1800);
  else days = Math.min(12, Math.round(10 + (c - 6000) / 15000));
  const min_days = Math.max(1.5, roundHalfDay(days * 0.65));
  return { eta: `约${days}日`, days, min_days, categoryLabel: '陆军载具' };
}

/**
 * 当科技词条既无 eta 也无 workload.days 时，按经费与 Tier 推导标准科研工期
 */
export function inferDefaultResearchDuration(
  cost?: unknown,
  tier?: unknown,
): { eta: string; days: number; min_days: number } {
  const c = typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? cost : 200;
  const t = tier === 3 ? 3 : tier === 2 ? 2 : 1;
  if (t === 1) {
    if (c <= 200) return { eta: '约2日', days: 2, min_days: 1 };
    if (c <= 350) return { eta: '约3日', days: 3, min_days: 2 };
    if (c <= 500) return { eta: '约4日', days: 4, min_days: 3 };
    if (c <= 800) return { eta: '约5日', days: 5, min_days: 3 };
    return { eta: '约8日', days: 8, min_days: 5 };
  }
  if (t === 2) {
    if (c <= 800) return { eta: '约6日', days: 6, min_days: 4 };
    if (c <= 1200) return { eta: '约8日', days: 8, min_days: 6 };
    return { eta: '约10日', days: 10, min_days: 7 };
  }
  if (c <= 2000) return { eta: '约14日', days: 14, min_days: 10 };
  return { eta: '约20日', days: 20, min_days: 14 };
}

/**
 * 预处理原始数据对象，保证 id 与 name 双向对称填充，以及 research 工期字段双向互推
 */
export function preprocessRawData(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };

  if (!obj.id && typeof obj.name === 'string') {
    obj.id = obj.name;
  }
  if ((!obj.name || (typeof obj.name === 'string' && !obj.name.trim())) && typeof obj.id === 'string') {
    obj.name = obj.type === 'protocol' ? (resolveLegacyProtocolName(obj.id) ?? obj.id) : obj.id;
  }
  if (obj.type === 'production' && obj.max_count === undefined && typeof obj.limit === 'number') {
    obj.max_count = obj.limit;
  }
  if (obj.type === 'research') {
    const rawEta = typeof obj.eta === 'string' ? obj.eta.trim() : '';
    const rawWl =
      typeof obj.workload === 'object' && obj.workload !== null && !Array.isArray(obj.workload)
        ? (obj.workload as Record<string, unknown>)
        : undefined;
    const hasDays = typeof rawWl?.days === 'number' && Number.isFinite(rawWl.days) && rawWl.days > 0;
    const hasMinDays =
      typeof rawWl?.min_days === 'number' && Number.isFinite(rawWl.min_days) && rawWl.min_days > 0;

    if (rawEta && !hasDays) {
      const parsed = parseEtaStringToWorkload(rawEta, hasMinDays ? (rawWl?.min_days as number) : undefined);
      if (parsed) {
        obj.workload = {
          ...(rawWl ?? {}),
          days: parsed.days,
          min_days: hasMinDays ? rawWl!.min_days : parsed.min_days,
        };
      }
    } else if (!rawEta && (hasDays || hasMinDays)) {
      const d = (hasDays ? rawWl!.days : rawWl!.min_days) as number;
      obj.eta = `约${d}日`;
      if (!hasDays) {
        obj.workload = {
          ...(rawWl ?? {}),
          days: d,
        };
      }
    } else if (!rawEta && !hasDays) {
      const inferred = inferDefaultResearchDuration(obj.cost, obj.tier);
      obj.eta = inferred.eta;
      obj.workload = {
        ...(rawWl ?? {}),
        days: inferred.days,
        min_days: hasMinDays ? rawWl!.min_days : inferred.min_days,
      };
    }
  }
  if (obj.type === 'building') {
    if (typeof obj.name === 'string' && obj.name.trim()) {
      obj.name = normalizeActionBuildingName(obj.name);
    }
    if (Array.isArray(obj.need_buildings)) {
      obj.need_buildings = obj.need_buildings.map(s =>
        typeof s === 'string' ? normalizeActionBuildingName(s) : s,
      );
    }
    if (typeof obj.need_building === 'string' && obj.need_building.trim()) {
      obj.need_building = obj.need_building
        .split('+')
        .map(s => normalizeActionBuildingName(s))
        .join('+');
    }
    if (
      (!obj.need_building || (typeof obj.need_building === 'string' && !obj.need_building.trim())) &&
      Array.isArray(obj.need_buildings) &&
      obj.need_buildings.length > 0
    ) {
      const joined = obj.need_buildings
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .join('+');
      if (joined) obj.need_building = joined;
    }
    if (
      (!obj.research || (typeof obj.research === 'string' && !obj.research.trim())) &&
      Array.isArray(obj.prereqs) &&
      obj.prereqs.length > 0
    ) {
      const joined = obj.prereqs
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .join('+');
      if (joined) obj.research = joined;
    }

    const rawOutputs =
      typeof obj.outputs === 'object' && obj.outputs !== null && !Array.isArray(obj.outputs)
        ? (obj.outputs as Record<string, unknown>)
        : undefined;
    const rawVirtual =
      rawOutputs &&
      typeof rawOutputs.virtual === 'object' &&
      rawOutputs.virtual !== null &&
      !Array.isArray(rawOutputs.virtual)
        ? (rawOutputs.virtual as Record<string, unknown>)
        : undefined;
    const rawCompute =
      rawVirtual &&
      typeof rawVirtual.compute === 'object' &&
      rawVirtual.compute !== null &&
      !Array.isArray(rawVirtual.compute)
        ? (rawVirtual.compute as Record<string, unknown>)
        : undefined;
    const hasDeclaredCompute =
      rawCompute !== undefined &&
      ((typeof rawCompute.tflops === 'number' && Number.isFinite(rawCompute.tflops)) ||
        (typeof rawCompute.tops === 'number' && Number.isFinite(rawCompute.tops)));
    if (!hasDeclaredCompute) {
      const inferredCompute = inferDefaultBuildingCompute(obj.name, obj.id);
      if (inferredCompute) {
        obj.outputs = {
          ...(rawOutputs ?? {}),
          virtual: {
            ...(rawVirtual ?? {}),
            compute: inferredCompute,
          },
        };
      }
    }

    const rawBldEta = typeof obj.eta === 'string' ? obj.eta.trim() : '';
    const rawBldWl =
      typeof obj.workload === 'object' && obj.workload !== null && !Array.isArray(obj.workload)
        ? (obj.workload as Record<string, unknown>)
        : undefined;
    const hasBldDays = typeof rawBldWl?.days === 'number' && Number.isFinite(rawBldWl.days) && rawBldWl.days > 0;
    const hasBldMinDays =
      typeof rawBldWl?.min_days === 'number' && Number.isFinite(rawBldWl.min_days) && rawBldWl.min_days > 0;
    if (!rawBldEta && !hasBldDays && typeof obj.days !== 'number') {
      const inferred = inferCategoryEntityDuration(obj);
      obj.eta = inferred.eta;
      obj.workload = {
        ...(rawBldWl ?? {}),
        days: inferred.days,
        min_days: hasBldMinDays ? rawBldWl!.min_days : inferred.min_days,
      };
    }
  }
  if (obj.type === 'production') {
    const rawProdEta = typeof obj.eta === 'string' ? obj.eta.trim() : '';
    const rawProdWl =
      typeof obj.workload === 'object' && obj.workload !== null && !Array.isArray(obj.workload)
        ? (obj.workload as Record<string, unknown>)
        : undefined;
    const rawAsm =
      typeof obj.assembly === 'object' && obj.assembly !== null && !Array.isArray(obj.assembly)
        ? (obj.assembly as Record<string, unknown>)
        : undefined;
    const hasProdDays = typeof rawProdWl?.days === 'number' && Number.isFinite(rawProdWl.days) && rawProdWl.days > 0;
    const hasProdMinDays =
      typeof rawProdWl?.min_days === 'number' && Number.isFinite(rawProdWl.min_days) && rawProdWl.min_days > 0;
    const hasAsmMinDays =
      typeof rawAsm?.min_days === 'number' && Number.isFinite(rawAsm.min_days) && rawAsm.min_days > 0;
    if (!rawProdEta && !hasProdDays && !hasAsmMinDays && typeof obj.days !== 'number') {
      const inferred = inferCategoryEntityDuration(obj);
      obj.eta = inferred.eta;
      obj.workload = {
        ...(rawProdWl ?? {}),
        days: inferred.days,
        min_days: hasProdMinDays ? rawProdWl!.min_days : inferred.min_days,
      };
    }
  }

  return obj;
}
