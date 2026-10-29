/**
 * 目录类型契约与纯推导函数（FD-27 · 世界书 SSOT 收口）：
 * 1. 【唯一事实源（SSOT）宣告】：世界书 `<数据>` 块（ParsedWorldbookCatalog / EffectiveCatalog）为全系统唯一业务数据源；
 * 2. 【静态空数组退役】：本文件导出的 `RESEARCHES / BUILDINGS / PRODUCTIONS / RETROFITS / PROJECTS / PROTOCOLS`
 *    静态空数组已正式退役，仅保留作为类型签名与旧单测 fixture 兼容注入槽，严禁生产业务代码直接将其当作数据源引用；
 * 3. 本文件职责聚焦于 TypeScript 强类型定义（`ResearchDef` / `BuildingDef` / `ProductionDef` / `RetrofitDef` / `ProjectDef` / `ProtocolCatalogItem`）
 *    以及零副作用的上下文推导纯函数（`derive*`、`deriveFactionTiers`）。
 *
 * 科技树双轨模型（与世界书 06a 对齐）：
 *  - line='盟军特色' 为盟军阵营特色理论，研究需建造厂核心（MCV）在场（已进 need_buildings 机器推导）
 *  - 其余线均为通用理论：一次研究、全阵营生效；高级解锁常为“通用+特色”组合前置
 *  - 科技名跨树全局唯一，tech.done 存名即可判定归属
 * AI 创造的新条目不在此表，走变量 codex（世界书目录第一优先，三层查找见 useDetail.ts）。
 *
 * 前置字段设计（兼顾展示与推导 + 面向 T2/T3 多前置）：
 *  - prereq / research / need_building：字符串，供详情弹窗人类可读展示（可含"或""+"等自然语言）
 *  - prereqs / need_buildings / need_units：字符串数组，供 derive* 机器推导（AND 语义，全满足才可用）
 *  units 实物前置对应"F-16C 已产至少一台"这类——升到 T2 后大量沿用，届时把已产型号写进 tech.done 或专门的清单即可。
 */

import {
  combineLegacyPrerequisites,
  evaluatePrerequisite,
  type PrerequisiteCondition,
  type PrerequisiteContext,
} from './prerequisites';
// 类型贯通（ENG-PARSE-01 / V2-04 / PRT-PARSE-01）：retrofit、project、protocol 增量字段形状以世界书 parser 为唯一事实源，type-only 导入零运行时依赖
import type {
  ProjectModuleDef,
  ProjectRequirements,
  ProtocolDiscovery,
  RetrofitPhase,
  RetrofitResources,
  RetrofitTarget,
} from '../../中控悬浮窗/models/worldbookCatalogParser';

export interface ResearchDef {
  name: string;
  cost: number;
  eta: string;
  line: string; // 所属科技线（PanelTech 分组用）
  /** 科技层级：1=基础档 2=战斗实验室档 3=未开放（全员必填，UI 徽章+详情统一展示） */
  tier: 1 | 2 | 3;
  unlocks: string; // 解锁物（展示）
  prereq: string; // 前置（展示，自然语言）
  prereqs: string[]; // 前置研究（推导，AND）
  need_buildings?: string[]; // 前置建筑（推导，AND）
  need_units?: string[]; // 前置实物/已产型号（推导，AND）
  /** 结构化附加前置；与旧机器字段按 AND 合并，显示字段不参与求值 */
  requirements?: PrerequisiteCondition;
  desc: string;
  tags?: string[];
}

export interface BuildingDef {
  id?: string;
  name: string;
  cost: number;
  power: number; // 耗电（负=发电）
  research: string | null; // 前置研究（展示，null=基础解锁）
  need_building?: string; // 额外前置建筑（展示）
  prereqs: string[]; // 前置研究（推导，AND）
  need_buildings: string[]; // 前置建筑（推导，AND）
  /** 结构化附加前置；与旧机器字段按 AND 合并，显示字段不参与求值 */
  requirements?: PrerequisiteCondition;
  /** 产线注册表引用（产线设计案 Q5 按需回填；未填走 Q2 推导，不阻塞） */
  lane?: string;
  /** 阵营归属（common/allied/soviet 或中文阵营名） */
  faction?: string;
  /** 五大建筑体系显式分类（FD-18 单一事实源） */
  system?: 'military' | 'defense' | 'agro' | 'industry' | 'research_space';
  /** 所属体系下的子分环/阶段分组 */
  system_group?: string;
  /** 是否可脱离母体独立平地建造（FD-22：缺省 true；纯升级包/扩建挂件为 false） */
  standalone?: boolean;
  /** 主体/前代建筑对象（FD-22：支持单个或多个母体建筑名称） */
  host_building?: string | string[];
  /** 升级/扩建作用模式（FD-22：replace=原位换代升版，addon=母体外挂模块） */
  upgrade_mode?: 'replace' | 'addon';
  /** 升级完成后的正式高级建筑名称（FD-22：缺省取自身 name） */
  upgraded_name?: string;
  desc: string;
  tags?: string[];
}

export interface ProductionDef {
  name: string;
  cost: number;
  need_building: string; // 主产地（展示）
  need_buildings: string[]; // 前置建筑（推导，AND）
  prereqs?: string[]; // 前置研究（推导，AND；旧目录缺省为空）
  /** 结构化附加前置；与旧机器字段按 AND 合并，显示字段不参与求值 */
  requirements?: PrerequisiteCondition;
  /** 产线注册表引用（产线设计案 Q5 按需回填；未填走 Q2 推导，不阻塞） */
  lane?: string;
  /** 生产数量上限（HERO-UNIT-01：如英雄级单位 max_count=1；缺省无上限） */
  max_count?: number;
  /** 可选别名集合（用于跨 forces.troops / forces.girls 匹配已拥有数量） */
  aliases?: string[];
  desc: string;
  tags?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 【静态数组退役与单测兼容槽宣告】（FD-27 · 世界书 `<数据>` 块唯一事实源 SSOT）
// 世界书 `<数据>` 块为唯一数据源（SSOT）；本文件仅保留类型定义（*Def）与纯推导函数（derive*），
// 以下空数组导出已退役，仅作旧测试 fixture 兼容注入槽，禁止业务代码直接作为数据源引用。
// ═══════════════════════════════════════════════════════════════════════════
export const RESEARCHES: ResearchDef[] = [];

/** 轻量 T1 科技名称列表（供开场启动器 Step2Resources.vue 在生产纯化态下回退使用） */
export const T1_RESEARCH_NAMES: readonly string[] = [
  '基础步兵训练学',
  '装甲载具工学',
  '航空工学基础',
  '船舶工学基础',
  '纳米精密合成学',
  '个人装备工程学',
  '军事教育体系学',
  '战地维修工程学',
  '高级作战实验理论',
  '化石燃料发电学',
  '风光发电学',
  '电力储能学',
  '石油勘探学',
  '石油开采学',
  '石油精炼学',
  '合成燃料学',
  '灵沁油处理学',
  '基础化工学',
  '标准弹药制造学',
  '重型弹药制造学',
  '防空拦截工学',
  '自动化火力工学',
  '区域封锁工学',
  '强化工事工学',
  '战场态势感知学',
  '战场医疗工学',
  '情报分析工学',
  '电子对抗工学',
  '地下掩蔽工学',
  '压制火炮工学',
  '近程防空工学',
  '前沿保障工学',
  '军犬行为工程学',
  '战场通信工程学',
  '反装甲战术学',
  '精确射击学',
  '火力支援学',
  '无人飞行器操控学',
  '两栖作战基础',
  '宪兵执法学',
  '消音与隐蔽射击工学',
  '光学瞄准工学',
  '弹药工程学',
  '纳米防护材料学',
  '战术附件工学',
  '精密狙击系统工学',
  '便携反装甲系统工学',
  '单兵通讯终端工学',
  '战术护目系统工学',
  '单兵爆破器材工学',
  '便携防空系统工学',
  '机动侦察工学',
  '无人地面平台学',
  '重装甲突击学',
  '间接火力载具学',
  '战场工程载具学',
  '防空载具学',
  '战场保障载具学',
  '战场指挥载具学',
  '装甲抢修载具学',
  '火箭炮载具学',
  '机动雷达学',
  '战场救护载具学',
  '两栖载具工学',
  '制空权学说',
  '先进多用途航空学',
  '近距空中支援学',
  '旋翼攻击学',
  '战略无人航空学',
  '无人作战航空器学',
  '航空侦察学',
  '战术巡飞弹药学',
  '重型旋翼运输学',
  '倾转旋翼工学',
  '固定翼空运航空学',
  '战略空运航空学',
  '战略轰炸航空学',
  '超音速突防轰炸学',
  '水面作战舰艇学',
  '舰队防空作战学',
  '核动力潜艇工学',
  '两栖突击舰艇学',
  '快速战斗支援学',
  '常规航空母舰工学',
  '核动力航空母舰工学',
  '近海作战艇学',
  '水雷战学',
  '导弹快艇工学',
  '近海护卫舰学',
  '拟态全息工学',
];

// 【条目冻结】见 RESEARCHES 上方冻结宣告（2026-10-10 驾驶员裁决 · 32 号方案 A）：不得新增/修改/删除条目。
export const BUILDINGS: BuildingDef[] = [];

// 【条目冻结】见 RESEARCHES 上方冻结宣告（2026-10-10 驾驶员裁决 · 32 号方案 A）：不得新增/修改/删除条目。
export const PRODUCTIONS: ProductionDef[] = [];

/**
 * 现代化改装工程（kind='retrofit'，T2复检报告§六已拍板）：
 * 改造≠新理论——不开新研究树，全部为已付费 T2 理论的工程应用，前置直接挂对应理论。
 * 机制：费用≈同型新造 35–50%、工期短、需战地维修所/原厂、改装期间单位离线。
 * 机娘铁律：改装不产生新首台——首台机娘法则只认“型号首产”，现代化改装是同一单位的续写。
 * 权威名单收录其名（见 useCatalog.effectiveCatalogNames），但不入 RESEARCHES——不与研究混淆。
 */
export interface RetrofitDef {
  kind: 'retrofit';
  name: string;
  research: string; // 挂靠的已有 T2 理论（前置）
  grade: '小改' | '中改' | '大改';
  desc: string;
  // ── 工程玩法 V1 可选增量（D14-A/D15/D16/D22，ENG-PARSE-01）：静态基线不声明，由世界书动态条目贯通 ──
  cost?: number; // 总造价（对齐苏军 2S19 先例）
  phases?: RetrofitPhase[];
  resources?: RetrofitResources; // P0 对象化，禁止裸 nanites 字段
  target?: RetrofitTarget; // D16：引用不搬块
  scope?: 'base' | 'theater';
  scene?: string; // D22：场景 id，如 'scene.workshop.generic'
  /** 对应的标准生产单位名称（FD-22：支持单个或多个单位名） */
  target_unit?: string | string[];
  /** 对应的母体建筑名称（FD-22：用于建筑类改装工程） */
  host_building?: string | string[];
  /** 现代化改造后的正式高级型号名分（FD-22：单目标为 string，多目标支持映射表） */
  upgraded_name?: string | Record<string, string>;
}

// 【条目冻结】见 RESEARCHES 上方冻结宣告（2026-10-10 驾驶员裁决 · 32 号方案 A）：不得新增/修改/删除条目。
export const RETROFITS: RetrofitDef[] = [];

/**
 * 仓段化 V2 工程静态定义（V2-04 · 仓段化V2设计案 §3.1）：
 * 形状对齐 projectEngine.ProjectV2Def（startProjectV2 直喂口径）——id/name/grade?/scope?/
 * requirements{research?,building?,credits?,nanites?}/modules[{id,name,cost?,workload?,resources?,prereqs}]；
 * tier/scene/outcome/pack/status 为世界书透传位（引擎不消费，V2-06/V2-07/V2-11 接手）。
 * 与 RetrofitDef 分立而非并入同族容器：结构异质（modules 拓扑 vs phases 线性链），
 * 消费面互斥（V2 专属槽 eng.orbital vs V1 首槽 eng.main），且 RETROFITS 条目层已冻结
 * （2026-10-10 驾驶员裁决）——并入会迫使冻结容器接纳异构条目。
 */
export interface ProjectDef {
  kind: 'project';
  /** 世界书 project 块稳定 id（如 all.project.orbital_shipyard；引擎不消费，留名↔ID 索引层） */
  id: string;
  /** 工程名（运行时引用键 ref=def.name，V1 同口径） */
  name: string;
  desc: string;
  /** 声明位：造价合计（机器口径=模块 cost 合计；requirements.credits 为对账声明位，D12 对账门 V2-11）——引擎不消费 */
  cost?: number;
  /** 小改|中改|大改|巨构（D-C2 V2 档）；缺省由引擎补「巨构」 */
  grade?: '小改' | '中改' | '大改' | '巨构';
  /** 缺省 base（D-C3 不强制多基地） */
  scope?: 'base' | 'theater';
  requirements?: ProjectRequirements;
  /** 模块拓扑（≥1；prereqs 闭包无环由引擎 validateModuleTopology 立项门把守） */
  modules: ProjectModuleDef[];
  tier?: number;
  scene?: string;
  pack?: string;
  status?: string;
}

// 【条目冻结】同 RETROFITS 上方冻结宣告（2026-10-10 驾驶员裁决 · 32 号方案 A）：
// 静态基线不落仓段化工程条目——V2 工程定义的唯一编辑面 = 世界书 type:'project' 块（V2-08《工程·通用》落书）；
// 本空数组仅作 mergeByName 兜底基线与 DLC 冲突检查参照（运行时有效目录 = useCatalog 三源合并）。
export const PROJECTS: ProjectDef[] = [];

/**
 * 协议静态定义（PRT-PARSE-01 · 任务包 §3.1 / §6 PRT-PARSE-01 / D-P17）：
 * 唯一编辑面 = 《协议_世界书》type:'protocol' 数据块；静态基线为空集合，供 catalogEffective 合并兜底。
 */
export interface ProtocolCatalogItem {
  type?: 'protocol';
  schema_version?: number;
  /** 协议权威 ID（如 sov.protocol.ra3.combat_engineer_prefab_bunker） */
  id: string;
  /** 协议中文名（如 战斗工兵—预制战斗碉堡协议） */
  name: string;
  /** 作用域（缺省 'faction'） */
  scope?: string;
  /** 所属阵营（如 '苏联' | '盟军'） */
  faction: string;
  /** 所属协议轨道 */
  track: string;
  /** 协议层级：1 | 2 | 3 */
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
  pack?: string;
  status?: string;
  desc: string;
  tags?: string[];
}

export type ProtocolDef = ProtocolCatalogItem;

/** 静态基线第四集合：协议字典（默认空集合 {}，保持存量三集合 100% 不变） */
export const protocols: Record<string, ProtocolCatalogItem> = {};

/** 静态基线协议数组形式（供数组管道兜底引用） */
export const PROTOCOLS: ProtocolCatalogItem[] = [];

function createLegacyPrerequisiteContext(
  techDone: readonly string[],
  buildings: readonly string[],
  units: readonly string[] = [],
): PrerequisiteContext {
  const buildingSet = new Set(buildings);
  const unitPresent = new Map<string, number>();
  for (const unit of units) unitPresent.set(unit, (unitPresent.get(unit) ?? 0) + 1);
  return {
    techDone: new Set(techDone),
    selectedBaseId: '$legacy',
    bases: new Map([['$legacy', { existing: buildingSet, completed: buildingSet, running: buildingSet }]]),
    unitPresent,
  };
}

/**
 * Context-aware 派生：结构化 requirements 必须走真实基地三态与 current/global 上下文。
 * S1-B 接入 ActionBar 后使用本组函数；非法条件一律 fail-closed。
 */
export function deriveResearchableWithContext(
  catalog: ResearchDef[],
  context: PrerequisiteContext,
  queued: readonly string[],
): ResearchDef[] {
  return catalog.filter(
    item =>
      !context.techDone.has(item.name) &&
      !queued.includes(item.name) &&
      evaluatePrerequisite(combineLegacyPrerequisites(item, 'completed'), context).satisfied,
  );
}

export function deriveBuildableWithContext(
  catalog: BuildingDef[],
  context: PrerequisiteContext,
  queued: readonly string[],
): BuildingDef[] {
  return catalog.filter(
    item =>
      !queued.includes(item.name) &&
      evaluatePrerequisite(combineLegacyPrerequisites(item, 'existing'), context).satisfied,
  );
}

export function deriveProducibleWithContext(catalog: ProductionDef[], context: PrerequisiteContext): ProductionDef[] {
  return catalog.filter(item => evaluatePrerequisite(combineLegacyPrerequisites(item, 'running'), context).satisfied);
}

/**
 * Legacy 派生适配器：保持既有调用与旧字段行为。
 * 单一字符串数组无法忠实表达 scope/state；因此遇到显式 requirements 时必须 fail-closed，
 * 禁止把同一集合近似成 existing/completed/running。
 */
export function deriveResearchable(
  catalog: ResearchDef[],
  done: string[],
  queued: string[],
  completed: string[] = [],
  units: string[] = [],
): ResearchDef[] {
  const context = createLegacyPrerequisiteContext(done, completed, units);
  return catalog.filter(
    item =>
      item.requirements === undefined &&
      !done.includes(item.name) &&
      !queued.includes(item.name) &&
      evaluatePrerequisite(combineLegacyPrerequisites(item, 'completed'), context).satisfied,
  );
}

export function deriveBuildable(
  catalog: BuildingDef[],
  done: string[],
  existing: string[],
  queued: string[],
): BuildingDef[] {
  const context = createLegacyPrerequisiteContext(done, existing);
  return catalog.filter(
    item =>
      item.requirements === undefined &&
      !queued.includes(item.name) &&
      evaluatePrerequisite(combineLegacyPrerequisites(item, 'existing'), context).satisfied,
  );
}

export function deriveProducible(catalog: ProductionDef[], running: string[], done: string[] = []): ProductionDef[] {
  const context = createLegacyPrerequisiteContext(done, running);
  return catalog.filter(
    item =>
      item.requirements === undefined &&
      evaluatePrerequisite(combineLegacyPrerequisites(item, 'running'), context).satisfied,
  );
}

/* ==================== 阵营科技层级（T级）推导 ====================
 * 与世界书 06a/13a 对齐：层级推进逐阵营独立，战斗实验室不跨阵营。
 * 零变量成本：T级完全由建筑名推导（名称约定：盟军建筑无前缀，
 * 苏联/尤里建筑带阵营前缀，如"苏联建造厂""苏联战斗实验室"）。
 * E2b 口径修正：MCV 在场判定双兼容世界书实名（"盟军建造厂"）与 legacy 名（"建造厂核心"，
 * 旧存档可能已按旧名落账），两端均精确等名匹配——includes('建造厂') 会跨阵营误中，禁止。
 * T3/T4 条件世界书未公布，推导上限 T2；具体化后再扩展。 */

export interface FactionTierInfo {
  /** 阵营名（内置三阵营 + DLC/codex 动态阵营） */
  faction: string;
  /** 当前层级（T1~T4，支持红星实验设计局综合体与 T3 战略科研节点推导） */
  tier: 1 | 2 | 3 | 4;
  /** 下一层级的去向提示 */
  next: string;
}

interface BuildingLike {
  name: string;
  state: string;
  progress?: number;
}

/** 阵营定义：MCV/实验室名约定 + 实验室前置研究（可空） */
export interface FactionDef {
  faction: string;
  mcv: string;
  lab: string;
  labResearch: string | null;
}

/** 内置三阵营（base 层，合并时不可被 DLC/codex 覆盖——见 useCatalog.factionDefs）
 *  mcv 字段保留 legacy 名（"建造厂核心"系）；世界书实名（"X建造厂"）由 deriveFactionTiers 双兼容推导。 */
export const FACTION_DEFS: FactionDef[] = [
  { faction: '盟军', mcv: '建造厂核心', lab: '战斗实验室', labResearch: '高级作战实验理论' },
  { faction: '苏联', mcv: '苏联建造厂核心', lab: '苏联战斗实验室', labResearch: null },
  { faction: '尤里', mcv: '尤里建造厂核心', lab: '尤里战斗实验室', labResearch: null },
];

const FACTION_LAB_ALIASES: Readonly<Record<string, readonly string[]>> = {
  苏联: ['红星实验设计局综合体', '红星实验设计局', '苏联战斗实验室', '苏联作战实验室'],
  盟军: ['盟军战斗实验室', '盟军作战实验室'],
  尤里: ['基因测序与心灵谐振研究院', '尤里心灵研究实验室', '尤里作战实验室', '尤里战斗实验室'],
};

const FACTION_T3_BUILDINGS: Readonly<Record<string, readonly string[]>> = {
  苏联: ['国家战略工程综合体', '红星科学城', '赤星轨道战略投送阵列', '国家战略工程综合体／红星科学城'],
  盟军: ['盟军联合科研与国家工程组织节点', '量子超算中心'],
  尤里: ['双螺旋生命工程与高维意识科学院', '双螺旋生命科学院'],
};

/** 按已有 MCV 的阵营推导各自 T 级（未接入的阵营不返回）；阵营清单由 useCatalog 三源合并提供 */
export function deriveFactionTiers(defs: FactionDef[], buildings: BuildingLike[], done: string[]): FactionTierInfo[] {
  const result: FactionTierInfo[] = [];
  for (const def of defs) {
    // E2b 口径修正：MCV 在场＝legacy 名（def.mcv，旧存档可能已按「建造厂核心」系落账）
    // 或世界书实名（`${faction}建造厂`，如「盟军建造厂」）——两端均精确等名匹配；
    // 盟军无前缀护栏语义保持：精确匹配 MCV 名，避免「苏联建造厂」误判为盟军（禁 includes('建造厂')）。
    const mcvNames = [def.mcv, `${def.faction}建造厂`];
    const hasMcv = buildings.some(b => mcvNames.includes(b.name));
    if (!hasMcv) continue;
    const labNames = [def.lab, ...(FACTION_LAB_ALIASES[def.faction] ?? [])];
    const lab = buildings.find(b => labNames.includes(b.name));
    if (lab && lab.state !== '建造中') {
      const t3Names = FACTION_T3_BUILDINGS[def.faction] ?? [];
      const t3Building = buildings.find(b => t3Names.includes(b.name));
      if (t3Building && t3Building.state !== '建造中') {
        result.push({ faction: def.faction, tier: 3, next: 'T4 条件未公布' });
      } else if (t3Building) {
        result.push({ faction: def.faction, tier: 2, next: `${t3Building.name}建造中 ${t3Building.progress ?? 0}%` });
      } else {
        result.push({ faction: def.faction, tier: 2, next: 'T3 条件未公布' });
      }
    } else if (lab) {
      result.push({ faction: def.faction, tier: 1, next: `${lab.name}建造中 ${lab.progress ?? 0}%` });
    } else if (def.labResearch && done.includes(def.labResearch)) {
      result.push({ faction: def.faction, tier: 1, next: `可建${def.lab}→T2` });
    } else if (def.labResearch) {
      result.push({ faction: def.faction, tier: 1, next: `研${def.labResearch}→T2` });
    } else {
      result.push({ faction: def.faction, tier: 1, next: `需${def.lab}（详见世界书）` });
    }
  }
  return result;
}
