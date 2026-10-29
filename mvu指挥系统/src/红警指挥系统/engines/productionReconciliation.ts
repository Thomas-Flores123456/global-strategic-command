/**
 * productionReconciliation.ts —— 前馈工程日程注入与 `<生产>` 三色对账裁决门（CTRL-RECONCILE-01）
 *
 * 真源：docs/design/systems/系统事务与时间推进总设计案.md §2（状态机四铁律）/§2.3.4（前馈闭环）/
 *       §3（QueueItem v2）/§4（时间结算流水线·三色门合约）/§4.1（前馈注入＝active/settling 倒计时清单）/
 *       §5.2（结项语义改挂）；docs/project/plans/中控台版本迭代任务包.md CTRL-RECONCILE-01 卡。
 * `<生产>` 报文格式锚点：__tests__/timePastParser.test.ts 既有夹具（`- 名称: 数量单位` 清单，CTRL-TIME-PARSER-01）。
 *
 * 三色裁决冻结表（验收标准③；settling→done 唯一通道＝本门，铁律3）：
 *   声明目标＝canon(item)（可带 基地/类型 消歧，同键多条声明先聚合求和）命中的单条在册事务：
 *   - settling 且 声明数 == qty     → MATCH：status→done（canTransition 白名单守卫），资产入账；
 *   - settling 且 声明数 <  qty     → UNDERRUN：声明数拆出 done 分项入役，余量退回 active
 *                                     （qty/total/spent/progress 按单位工期重计，批次间隔不变）；
 *   - active  且 声明数 <= qty_done → UNDERRUN：认领物理已下线台数拆出 done 分项，余量续跑 active；
 *   - settling 且 声明数 >  qty     → OVERRUN 超产拦截：事务原地不动＋warn 事件；
 *   - active  且 声明数 >  qty_done → OVERRUN 时序冲突拦截：原地不动＋warn 事件（含差距数据）；
 *   - queued / 仅 cancelled / 无候选 → OVERRUN 拦截：原地不动＋warn 事件；
 *   - 仅 done 候选                  → NOOP 幂等（重解析/重复声明不重复入账）；
 *   - 多个在册候选                  → declaration_rejected（需消歧），原地不动。
 *
 * 资产入账语义（对齐 parsePipeline「操作:完成」现行批准语义）：
 *   研究 → tech.done（canon 去重幂等）；建造 → 目标基地唯一同名建筑 state='运转'
 *   （不唯一/不存在 → 事务照 done、事件升 warn 备注降级）；生产/改装 → 不写 forces
 *   （不推断单位分类，🔴 红线2 勤务格零触碰）。
 *
 * 诚实边界（实现裁量，收工报告同步登记）：
 * 1. §5.2「active 差距小（≤1 日带宽）按 UNDERRUN 宽容认领」——A′ 定案（2026-09-28 驾驶员拍板）：
 *    宽容不静默，经 CTRL-UI-CHRONO-01 横幅一键「自动顺延时间」兑现（补差额 Δt 走 settleFloor
 *    正常结算→重对账自然 MATCH）；引擎 v1 口径零改动，本门对一切「物理未完工却声明完工」仍
 *    统一 OVERRUN 拦截。本文件导出 autoAdvanceDeltaFor / forceCommission 作为横幅消费的纯函数支持：
 *    - autoAdvanceDeltaFor：从裁决记录算出顺延分钟数（时序冲突取 max remainingMinutes）；
 *    - forceCommission：🔴 驾驶员逃生舱——显式特批入役，**故意绕过** canTransition 白名单
 *      （active→done/queued→done 均非法，此处唯一例外），必须经 warn 审计事件＋R23 留痕；
 * 2. OVERRUN「挂起」不落任何持久字段：事务保持原状态原字段原地不动，拦截只经事件流水留痕
 *    （schema/status 零新增，🔴 红线2）；UI 纠偏横幅（CTRL-UI-CHRONO-01）从解析报告流水消费差异数据；
 * 3. 旧式 <操作>「完成」通道已归一（F2-乙，驾驶员已裁）：parsePipeline 不再 splice 直达账本，
 *    收讫声明经 operationCompletionsToDeclarations 映射喂本门——本门是全通道唯一裁决点；
 * 4. 多个 <生产> 块全部解析，按 canon(item)＋基地＋类型 聚合（数量求和）后再裁决；
 * 5. 前馈日程文本与提示词挂载均已迁出：buildScheduleText → scheduleText.ts（§4.1.1 两级分组条令体，
 *    文案常量集 scheduleCopy.ts），注入接线 → 中控悬浮窗/scheduleRunner.ts（案A 平行管线）。
 *
 * 🔴 红线：纯函数——零 Pinia、零 Vue、零宿主 API；不原地修改入参；不改 QueueItem.status 默认值与
 * 状态机四铁律（所有状态迁移先过 transactionEngine.canTransition 白名单守卫，守卫拒绝即 fail-closed
 * 转 declaration_rejected 留痕）；不写 forces 勤务格。
 */

import { stripThinking } from '../parse/floorSanitize';
import { canon, type OperationCompletion, type ParseEvent } from '../parse/parsePipeline';
import type { CheckIssue } from '../parse/systemCheck';
import { findBuildableAeroEquipmentSpec } from './spaceEngine';
import { canTransition, type TransactionItem } from './transactionEngine';

/* ═══════════════ 类型定义 ═══════════════ */

/** 三色裁决色标（设计案 §4）；NOOP/REJECTED 为门内安全出口，不动账本 */
export type TriColorVerdict = 'MATCH' | 'UNDERRUN' | 'OVERRUN';
export type GateVerdict = TriColorVerdict | 'NOOP' | 'REJECTED';

/** 一条 `<生产>` 声明（`- 名称: 数量单位`，可带 indented 基地/类型 消歧行） */
export interface ProductionDeclaration {
  /** 项目名（原文，比对时过 canon） */
  item: string;
  /** 声明下线数量（正整数） */
  qty: number;
  /** 可选：基地消歧（Base.id 或基地名） */
  base?: string;
  /** 可选：类型消歧（建造/研究/生产/改装） */
  type?: string;
  /** 原始报文行（留痕） */
  raw: string;
}

/** 被拒报文行（格式畸变/数量非法；对齐 dispatch_rejected 的宽进严出哲学） */
export interface RejectedDeclarationLine {
  raw: string;
  reason: 'malformed_line' | 'invalid_qty';
  detail: string;
}

export interface ProductionParseResult {
  /** 正文是否含至少一个 <生产> 块（false 时门零成本跳过） */
  found: boolean;
  declarations: ProductionDeclaration[];
  rejected: RejectedDeclarationLine[];
}

/** 对账事件（结构化留痕；level 驱动 🟢/🟡 与 R23 issue 映射） */
export interface ReconcileEvent {
  type:
    | 'reconcile_match' // MATCH：settling→done，资产入账
    | 'reconcile_underrun' // UNDERRUN：按实认领部分 done，余量退回/留在 active
    | 'reconcile_overrun' // OVERRUN：拦截挂起（事务原地不动）
    | 'reconcile_noop' // 仅命中 done：幂等跳过（重解析/重复声明）
    | 'declaration_rejected' // 候选不唯一/守卫拒绝/报文行被拒
    | 'force_commission'; // 驾驶员强制特批入役（逃生舱，绕过三色门物理校验，审计留痕）
  level: 'info' | 'warn';
  item: string;
  base: string;
  detail?: string;
}

/** 每条聚合声明的裁决记录（差异数据源，供 CTRL-UI-CHRONO-01 横幅消费） */
export interface VerdictRecord {
  item: string;
  base?: string;
  type?: string;
  /** 声明数量（聚合后） */
  declaredQty: number;
  verdict: GateVerdict;
  /** 实际认领入 done 的数量 */
  claimedQty: number;
  /** 退回/留在 active 的数量 */
  remainderQty: number;
  /** 裁决时物理已下线数量（OVERRUN 差异数据） */
  physicalDoneQty?: number;
  /** 裁决时剩余工期（分钟，OVERRUN 时序差距数据） */
  remainingMinutes?: number;
  /** OVERRUN 细分类型（CTRL-UI-CHRONO-01 横幅分派纠偏动作用；仅 OVERRUN 裁决携带） */
  overrunKind?: 'over_qty' | 'time_conflict' | 'not_started' | 'no_txn' | 'cancelled';
  detail: string;
}

export interface ReconcileResult<S extends ReconcileStateShape> {
  /** 新状态对象（入参 state 不被修改） */
  next: S;
  events: ReconcileEvent[];
  verdicts: VerdictRecord[];
}

/** 资产入账所需的最小建筑视图（结构类型，StatData Building 天然满足） */
export interface ReconcileBuildingLike {
  name: string;
  layer?: string;
  state?: string;
  coord?: { x: number; y: number };
  bearing?: string;
  addons?: string[];
  progress?: number;
  eta?: string;
}

/** 资产入账所需的最小基地视图（结构类型，StatData Base 天然满足） */
export interface ReconcileBaseLike {
  id: string;
  name: string;
  buildings?: ReconcileBuildingLike[];
  forces?: {
    troops?: Record<string, number>;
    vehicles?: string[];
    equipment?: Record<string, number>;
  };
}

/** 资产入账所需的最小部队/军备视图（ARM-02） */
export interface ReconcileForcesLike {
  troops?: Record<string, number>;
  vehicles?: string[];
  equipment?: Record<string, number>;
}

/** 三色门状态约束：queues 必需，tech/bases/forces 缺席时对应资产入账降级为备注 */
export interface ReconcileStateShape {
  queues: TransactionItem[];
  tech?: { done: string[] };
  bases?: ReconcileBaseLike[];
  forces?: ReconcileForcesLike;
  space?: {
    equipment_stock?: Record<string, number>;
    [key: string]: unknown;
  };
  /** 同楼是否已通过 <部队>/<兵力> 显式覆盖更新（true 时跳过自动记入 forces 防双计） */
  forcesExplicitlyUpdated?: boolean;
  /** 可选：项目分类映射（equipment/troops/vehicles） */
  itemCategories?: Readonly<Record<string, 'equipment' | 'troops' | 'vehicles'>>;
  /** 可选：建筑升级/扩建规格覆盖表（FD-22；未传时使用内置 BUILTIN_BUILDING_UPGRADE_SPECS） */
  buildingUpgradeSpecs?: Readonly<
    Record<
      string,
      {
        host_building: readonly string[];
        upgrade_mode: 'replace' | 'addon';
        upgraded_name?: string;
      }
    >
  >;
}

/** FD-22 内置建筑原位升级（replace）与母体外挂扩建（addon）规格表 */
export const BUILTIN_BUILDING_UPGRADE_SPECS: Readonly<
  Record<
    string,
    {
      host_building: readonly string[];
      upgrade_mode: 'replace' | 'addon';
      upgraded_name?: string;
    }
  >
> = {
  // ── 9 个原位升阶包（standalone: false, upgrade_mode: 'replace'，完工后更名为 upgraded_name）──
  全谱电磁与微波隐身屏蔽系统: { host_building: ['裂缝产生器'], upgrade_mode: 'replace', upgraded_name: '全谱电磁隐身裂缝产生器' },
  先进光棱塔升级: { host_building: ['光棱塔'], upgrade_mode: 'replace', upgraded_name: '先进光棱塔' },
  爱国者阵地增强改装: { host_building: ['爱国者防空阵地', '爱国者导弹阵地'], upgrade_mode: 'replace', upgraded_name: '爱国者PAC-3增强防空阵地' },
  THAAD增程机动拦截发射单元: { host_building: ['THAAD 末段高空拦截阵地'], upgrade_mode: 'replace', upgraded_name: 'THAAD-ER增程高空拦截阵地' },
  GPI超高空火控引导站: { host_building: ['GPI 滑翔段拦截系统'], upgrade_mode: 'replace', upgraded_name: 'GPI超高空火控拦截系统' },
  '快堆—闭式燃料循环升级': { host_building: ['大型裂变发电站'], upgrade_mode: 'replace', upgraded_name: '快堆闭式循环核电站' },
  地下国家连续性升级: { host_building: ['深层地下综合体'], upgrade_mode: 'replace', upgraded_name: '国家连续性深层地下要塞' },
  地下重载军运实现: { host_building: ['地下高速管道枢纽'], upgrade_mode: 'replace', upgraded_name: '地下重载军运管道枢纽' },
  铁幕多节点网络升级: { host_building: ['铁幕装置'], upgrade_mode: 'replace', upgraded_name: '铁幕多节点偏折网络' },
  // 支持直接以 upgraded_name 下达建造队列时的原位替换
  全谱电磁隐身裂缝产生器: { host_building: ['裂缝产生器'], upgrade_mode: 'replace', upgraded_name: '全谱电磁隐身裂缝产生器' },
  先进光棱塔: { host_building: ['光棱塔'], upgrade_mode: 'replace', upgraded_name: '先进光棱塔' },
  '爱国者PAC-3增强防空阵地': { host_building: ['爱国者防空阵地', '爱国者导弹阵地'], upgrade_mode: 'replace', upgraded_name: '爱国者PAC-3增强防空阵地' },
  'THAAD-ER增程高空拦截阵地': { host_building: ['THAAD 末段高空拦截阵地'], upgrade_mode: 'replace', upgraded_name: 'THAAD-ER增程高空拦截阵地' },
  GPI超高空火控拦截系统: { host_building: ['GPI 滑翔段拦截系统'], upgrade_mode: 'replace', upgraded_name: 'GPI超高空火控拦截系统' },
  快堆闭式循环核电站: { host_building: ['大型裂变发电站'], upgrade_mode: 'replace', upgraded_name: '快堆闭式循环核电站' },
  国家连续性深层地下要塞: { host_building: ['深层地下综合体'], upgrade_mode: 'replace', upgraded_name: '国家连续性深层地下要塞' },
  地下重载军运管道枢纽: { host_building: ['地下高速管道枢纽'], upgrade_mode: 'replace', upgraded_name: '地下重载军运管道枢纽' },
  铁幕多节点偏折网络: { host_building: ['铁幕装置'], upgrade_mode: 'replace', upgraded_name: '铁幕多节点偏折网络' },
  // ── 21 座跨代高阶主体建筑（standalone: true, upgrade_mode: 'replace'）──
  海军造船厂: { host_building: ['简易船坞'], upgrade_mode: 'replace' },
  扩大版自动化战车工厂: { host_building: ['战车工厂', '盟军战车工厂', '苏联战车工厂'], upgrade_mode: 'replace' },
  扩大版造船厂: { host_building: ['海军造船厂', '盟军海军船坞', '苏联海军船坞'], upgrade_mode: 'replace' },
  空天飞机维护综合体: { host_building: ['空军指挥部', '盟军空军指挥部', '苏联空军基地'], upgrade_mode: 'replace' },
  全自动军工综合体: { host_building: ['扩大版自动化战车工厂', '苏维埃工业工厂'], upgrade_mode: 'replace' },
  深层地下综合体: { host_building: ['强化地下掩蔽所'], upgrade_mode: 'replace' },
  量子超算中心: { host_building: ['超算中心'], upgrade_mode: 'replace' },
  巨型自动化矿业综合体: { host_building: ['矿石精炼厂', '盟军矿石精炼厂', '苏联矿石精炼厂'], upgrade_mode: 'replace' },
  巨型航天发射港: { host_building: ['航天发射中心', '拜科努尔式重型航天发射综合体', '盟军天基轨道上行中心'], upgrade_mode: 'replace' },
  聚变发电阵列: { host_building: ['受控核聚变实验堆'], upgrade_mode: 'replace' },
  超级造船综合体: { host_building: ['扩大版造船厂'], upgrade_mode: 'replace' },
  巨型联合兵工厂: { host_building: ['全自动军工综合体', '扩大版自动化战车工厂'], upgrade_mode: 'replace' },
  纳米躯体再造舱: { host_building: ['高阶医疗中心'], upgrade_mode: 'replace' },
  超时空传送阵列: { host_building: ['超时空传送仪'], upgrade_mode: 'replace' },
  天气控制仪增强设施: { host_building: ['天气控制仪'], upgrade_mode: 'replace' },
  天基超级光棱炮: { host_building: ['轨道武器平台'], upgrade_mode: 'replace' },
  战区超导脉冲电网中枢: { host_building: ['超级磁能反应炉', '快堆闭式循环核电站', '大型裂变发电站'], upgrade_mode: 'replace' },
  国家总动员兵工城: { host_building: ['扩大版自动化战车工厂', '苏维埃工业工厂'], upgrade_mode: 'replace' },
  国家总动员兵工城实现: { host_building: ['扩大版自动化战车工厂', '苏维埃工业工厂'], upgrade_mode: 'replace' },
  八百公里同步环轨重载投射与工业综合体: { host_building: ['拜科努尔式重型航天发射综合体', '巨型航天发射港'], upgrade_mode: 'replace' },
  月球空间站: { host_building: ['地月转运站'], upgrade_mode: 'replace' },
  月面有人基地: { host_building: ['月面有人前哨站'], upgrade_mode: 'replace' },
  // ── 14 个母体附着扩建挂件（standalone: false, upgrade_mode: 'addon'）──
  数字孪生与柔性生产车间: { host_building: ['盟军战车工厂', '战车工厂', '空军指挥部', '盟军空军指挥部', '海军造船厂'], upgrade_mode: 'addon', upgraded_name: '数字孪生与柔性生产车间' },
  数字孪生与柔性生产改造: { host_building: ['盟军战车工厂', '战车工厂', '空军指挥部', '盟军空军指挥部', '海军造船厂'], upgrade_mode: 'addon', upgraded_name: '数字孪生与柔性生产车间' },
  智能电网潮流调度中心: { host_building: ['盟军发电厂', '发电厂'], upgrade_mode: 'addon', upgraded_name: '智能电网潮流调度中心' },
  智能电网调度改造: { host_building: ['盟军发电厂', '发电厂'], upgrade_mode: 'addon', upgraded_name: '智能电网潮流调度中心' },
  预测性健康维护中心: { host_building: ['盟军战地维修所', '战地维修所'], upgrade_mode: 'addon', upgraded_name: '预测性健康维护中心' },
  预测维护改造: { host_building: ['盟军战地维修所', '战地维修所'], upgrade_mode: 'addon', upgraded_name: '预测性健康维护中心' },
  无人立体仓储调度中心: { host_building: ['大宗矿料与建材堆场', '区域物流枢纽'], upgrade_mode: 'addon', upgraded_name: '无人立体仓储调度中心' },
  无人仓储与最优调度改造: { host_building: ['大宗矿料与建材堆场', '区域物流枢纽'], upgrade_mode: 'addon', upgraded_name: '无人立体仓储调度中心' },
  战略铁路编组与动员枢纽: { host_building: ['区域物流枢纽'], upgrade_mode: 'addon', upgraded_name: '战略铁路编组与动员枢纽' },
  战略铁路编组与动员扩建: { host_building: ['区域物流枢纽'], upgrade_mode: 'addon', upgraded_name: '战略铁路编组与动员枢纽' },
  装甲储备与装备再生基地: { host_building: ['重型装备整备库', '苏联重型维修工厂', '战地维修所'], upgrade_mode: 'addon', upgraded_name: '装甲储备与装备再生基地' },
  装甲储备与装备再生扩建: { host_building: ['重型装备整备库', '苏联重型维修工厂', '战地维修所'], upgrade_mode: 'addon', upgraded_name: '装甲储备与装备再生基地' },
  基洛夫巨型收纳与保障库: { host_building: ['苏联空军基地', '空军指挥部'], upgrade_mode: 'addon' },
  无畏重型船坞与重弹保障段: { host_building: ['苏联海军船坞', '海军造船厂', '扩大版造船厂'], upgrade_mode: 'addon' },
  战略堡垒潜艇保障段: { host_building: ['苏联海军船坞', '海军造船厂', '扩大版造船厂'], upgrade_mode: 'addon' },
  天启超重总装跨: { host_building: ['苏联战车工厂', '战车工厂', '扩大版自动化战车工厂'], upgrade_mode: 'addon' },
  'Crusher Crane重型拆解回收站': { host_building: ['苏联重型维修工厂', '战地维修所'], upgrade_mode: 'addon', upgraded_name: 'Crusher Crane重型拆解回收站' },
  'Crusher Crane维修—拆件—报废扩建': { host_building: ['苏联重型维修工厂', '战地维修所'], upgrade_mode: 'addon', upgraded_name: 'Crusher Crane重型拆解回收站' },
  空间核动力无核试验模块: { host_building: ['航天发射中心', '红星实验设计局综合体'], upgrade_mode: 'addon' },
  苏联大规模工程扩建模块: { host_building: ['建造厂核心', '红星实验设计局综合体'], upgrade_mode: 'addon' },
  红星工控防护与电磁注入终端: { host_building: ['模块化网电作战枢纽', '红星实验设计局综合体'], upgrade_mode: 'addon' },
};

/* ═══════════════ `<生产>` 声明块解析 ═══════════════ */

/** 匹配所有 <生产> 标签块（多个块全部解析，聚合在门内完成） */
export const PRODUCTION_BLOCK_REGEX = /<\s*生产\s*>([\s\S]*?)<\s*\/\s*生产\s*>/gi;

const DECL_LINE_REGEX =
  /^\s*(?:[-*•]\s*)?([^:：]+?)\s*[:：]\s*(\d+(?:\.\d+)?)\s*([^\s,，;；|（(]*)\s*(?:[（(](.*?)[）)]|[,，;；|]\s*(.+))?\s*$/;
const SUBKEY_LINE_REGEX = /^\s*(基地|base|类型|type)\s*[:：]\s*(.+?)\s*$/i;

function applyInlineDeclarationMeta(target: ProductionDeclaration, rawMeta: string | undefined): void {
  if (!rawMeta || !rawMeta.trim()) return;
  for (const part of rawMeta.split(/[,，;；|]/)) {
    const m = part.match(SUBKEY_LINE_REGEX);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (!val) continue;
    if (key === '基地' || key === 'base') target.base = val;
    else target.type = val;
  }
}

/**
 * 解析 LLM 输出中的 `<生产>` 声明块（验收标准②）。
 * 报文格式（锚定 timePastParser 既有夹具）：
 *   <生产>
 *   - 犀牛主战坦克: 1台
 *   - 天启坦克：2辆
 *     基地: 青岚基地        // 可选消歧行，缩进挂在上一声明下
 *   轨道空间站·居住舱: 1项 (基地: 恶土前哨主基地, 类型: 工程)
 *   </生产>
 * 非法行不静默丢弃——进 rejected 留痕（对齐调度令 rejected 哲学）。
 */
export function parseProductionDeclarations(rawText: unknown): ProductionParseResult {
  const empty: ProductionParseResult = { found: false, declarations: [], rejected: [] };
  if (typeof rawText !== 'string' || !rawText) return empty;
  const cleanedText = stripThinking(rawText).text;

  const declarations: ProductionDeclaration[] = [];
  const rejected: RejectedDeclarationLine[] = [];
  let found = false;

  for (const blockMatch of cleanedText.matchAll(PRODUCTION_BLOCK_REGEX)) {
    found = true;
    const body = blockMatch[1] ?? '';
    let current: ProductionDeclaration | null = null;
    for (const line of body.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const subMatch = line.match(SUBKEY_LINE_REGEX);
      if (subMatch) {
        if (current) {
          const key = subMatch[1].toLowerCase();
          const value = subMatch[2].trim();
          if (key === '基地' || key === 'base') current.base = value;
          else current.type = value;
        } else {
          rejected.push({ raw: line.trim(), reason: 'malformed_line', detail: '无法识别的 <生产> 块内行' });
        }
        continue;
      }
      const declMatch = line.match(DECL_LINE_REGEX);
      if (declMatch) {
        const item = declMatch[1].trim();
        const qtyRaw = declMatch[2];
        const qty = Number(qtyRaw);
        if (!item) {
          rejected.push({ raw: line.trim(), reason: 'malformed_line', detail: '声明行缺少项目名' });
          current = null;
          continue;
        }
        if (!Number.isInteger(qty) || qty <= 0) {
          rejected.push({
            raw: line.trim(),
            reason: 'invalid_qty',
            detail: `声明数量「${qtyRaw}」非法（须为正整数）`,
          });
          current = null;
          continue;
        }
        current = { item, qty, raw: line.trim() };
        applyInlineDeclarationMeta(current, declMatch[4] ?? declMatch[5]);
        declarations.push(current);
        continue;
      }
      // 块内非空、非声明、非消歧行：可能是 LLM 夹带叙述
      rejected.push({ raw: line.trim(), reason: 'malformed_line', detail: '无法识别的 <生产> 块内行' });
    }
  }

  return { found, declarations, rejected };
}

/* ═══════════════ F2-乙 · 收讫通道归一适配器 ═══════════════ */

/**
 * 归一适配器：战况.操作.完成 收讫声明 → ProductionDeclaration（喂同一个 reconcileProduction，三色门仍是唯一裁决点）。
 * 字段映射：item/type/base 直通（base 已是 parse 层解析后的 Base.id，门内 baseMatches 仍做 id↔名 互解）；
 * qty＝唯一在册候选的整批 qty（操作.完成 无数量位，语义＝全批认领）；
 * 多候选/无候选 → qty=1 交由门内自判（REJECTED 候选不唯一 / OVERRUN no_txn），适配器绝不越权裁决。
 */
export function operationCompletionsToDeclarations(
  state: ReconcileStateShape,
  completions: readonly OperationCompletion[],
): ProductionDeclaration[] {
  const queues = state.queues ?? [];
  return completions.map(op => {
    const probe: ProductionDeclaration = { item: op.item, qty: 1, base: op.base, type: op.type, raw: op.raw };
    const matching = queues.filter(q => declarationMatches(q, probe, state.bases));
    const live = matching.filter(q => q.status === 'queued' || q.status === 'active' || q.status === 'settling');
    const terminal = matching.filter(q => q.status === 'done' || q.status === 'cancelled');
    const qty =
      live.length === 1 ? safeQty(live[0]) : live.length === 0 && terminal.length === 1 ? safeQty(terminal[0]) : 1;
    return { item: op.item, qty, base: op.base, type: op.type, raw: op.raw };
  });
}

/* ═══════════════ 三色对账裁决门 ═══════════════ */

function safeQty(txn: TransactionItem): number {
  return txn.qty > 0 ? txn.qty : 1;
}

/** 聚合键：canon(item)＋canon(base)＋canon(type)（同键声明数量求和） */
function aggregateKeyOf(d: ProductionDeclaration): string {
  return `${canon(d.item)}${d.base ?? ''}${canon(d.type ?? '')}`;
}

/** 基地消歧匹配：queue.base（多为 Base.id）vs 声明基地（id 或基地名），可经 bases 名↔id 互解 */
function baseMatches(qBase: string, declBase: string, bases?: ReconcileBaseLike[]): boolean {
  if (canon(qBase) === canon(declBase)) return true;
  const byId = bases?.find(b => b.id === qBase);
  if (byId && canon(byId.name) === canon(declBase)) return true;
  const byName = bases?.find(b => canon(b.name) === canon(declBase));
  if (byName && byName.id === qBase) return true;
  return false;
}

function declarationMatches(txn: TransactionItem, d: ProductionDeclaration, bases?: ReconcileBaseLike[]): boolean {
  if (canon(txn.item) !== canon(d.item)) return false;
  if (d.type && canon(txn.type) !== canon(d.type)) return false;
  if (d.base && !baseMatches(txn.base, d.base, bases)) return false;
  return true;
}

/** 资产入账结果：notes 信息性备注；failures 触发事件升 warn */
interface AssetOutcome {
  tech?: { done: string[] };
  bases?: ReconcileBaseLike[];
  forces?: ReconcileForcesLike;
  space?: ReconcileStateShape['space'];
  notes: string[];
  failures: string[];
}

const VEHICLE_CATEGORY_SET = new Set([
  'vehicle',
  'vehicles',
  'aircraft',
  'air',
  'naval',
  'vessel',
  'ship',
  'armor',
  'support',
  'artillery',
  'platform',
  '陆地载具',
  '空中载具',
  '水面舰艇',
  '载具',
]);

/**
 * 从有效目录（catalog.productions）推导单位资产入账分类映射表（BUG-LIVE-05）：
 * - 'troops'：步兵/人员（category='infantry'|'troops'|'人员'|'步兵'，或 lane='lane.personnel'，或前置建筑含「兵营」）
 * - 'vehicles'：陆海空载具（category 属于载具/战机/舰艇类，或 lane='lane.vehicle_*'，或前置建筑含「战车工厂/空军指挥部/空军基地/造船厂/船坞」）
 * - 'equipment'：单兵/航天/特种装备（category='equipment'|'component'|'装备'，或 lane='lane.equipment'，或前置建筑含「个人装备制造所/工坊」）
 */
const INFANTRY_PERSONNEL_NAME_RE =
  /(?:工程兵|工程师|侦察兵|医疗兵|医护兵|大兵|动员兵|步兵|新兵|特工|狙击手|突击兵|突击队|火箭飞行兵|飞行兵|磁暴步兵|辐射工兵|疯狂伊文|爆破兵|防空步兵|心灵突击队|病毒狙击手|尤里新兵|尤里复制人|复制人|狂兽人|海豹部队|谭雅|鲍里斯|军犬|警犬|防暴队|重装大兵|时空军团兵|冷冻军团兵|化学部队|铁幕特工|心灵专家|掷弹兵|迫击炮兵|机枪兵|喷火兵|伞兵|特种兵|卫兵|哨兵)/u;

const EQUIPMENT_PART_NAME_RE =
  /(?:外骨骼|装甲包|升级包|配件|套件|模块|芯片|终端|夜视仪|瞄准镜|防弹衣|插板|弹匣|榴弹发射器|挂载|涂装|组件)/u;

const VEHICLE_UNIT_NAME_RE =
  /(?:坦克|战车|装甲车|履带车|防空车|采矿车|矿车|基地车|MCV|火炮|榴弹炮|自行火炮|火箭炮|发射车|运输车|工程车|抢修车|雷达车|直升机|战机|攻击机|轰炸机|预警机|运输机|无人机|飞艇|潜艇|驱逐舰|巡洋舰|护卫舰|航母|无畏舰|快艇|气垫船|登陆艇)/iu;

export function inferUnitCategoryFromItemName(rawName: string): 'troops' | 'vehicles' | 'equipment' | undefined {
  const s = String(rawName ?? '').trim();
  if (!s) return undefined;
  if (EQUIPMENT_PART_NAME_RE.test(s)) return 'equipment';
  if (INFANTRY_PERSONNEL_NAME_RE.test(s)) return 'troops';
  if (VEHICLE_UNIT_NAME_RE.test(s)) return 'vehicles';
  return undefined;
}

export function buildItemCategoriesFromCatalog(
  catalog:
    | {
        productions?: readonly {
          name: string;
          aliases?: readonly string[];
          category?: unknown;
          subcategory?: unknown;
          sub_category?: unknown;
          line?: unknown;
          domain?: unknown;
          lane?: unknown;
          productionBuilding?: unknown;
          production_building?: unknown;
          need_buildings?: readonly string[];
          need_building?: unknown;
        }[];
      }
    | null
    | undefined,
): Record<string, 'troops' | 'vehicles' | 'equipment'> {
  const map: Record<string, 'troops' | 'vehicles' | 'equipment'> = {};
  for (const p of catalog?.productions ?? []) {
    if (!p || typeof p.name !== 'string' || !p.name.trim()) continue;
    const catRaw = typeof p.category === 'string' ? p.category.trim().toLowerCase() : '';
    const subcatRaw =
      typeof p.subcategory === 'string'
        ? p.subcategory.trim().toLowerCase()
        : typeof p.sub_category === 'string'
          ? p.sub_category.trim().toLowerCase()
          : '';
    const lineRaw = typeof p.line === 'string' ? p.line.trim().toLowerCase() : '';
    const domRaw = typeof p.domain === 'string' ? p.domain.trim().toLowerCase() : '';
    const laneRaw = typeof p.lane === 'string' ? p.lane.trim() : '';
    const needBlds: string[] = [];
    if (Array.isArray(p.need_buildings)) {
      for (const b of p.need_buildings) {
        if (typeof b === 'string' && b.trim()) needBlds.push(b.trim());
      }
    }
    if (typeof p.need_building === 'string' && p.need_building.trim()) {
      needBlds.push(p.need_building.trim());
    } else if (Array.isArray(p.need_building)) {
      for (const b of p.need_building) {
        if (typeof b === 'string' && b.trim()) needBlds.push(b.trim());
      }
    }
    if (typeof p.productionBuilding === 'string' && p.productionBuilding.trim()) {
      needBlds.push(p.productionBuilding.trim());
    }
    if (typeof p.production_building === 'string' && p.production_building.trim()) {
      needBlds.push(p.production_building.trim());
    }

    const combinedMeta = `${catRaw} ${subcatRaw} ${lineRaw} ${domRaw}`;
    let resolved: 'troops' | 'vehicles' | 'equipment' | undefined;
    if (
      catRaw === 'infantry' ||
      catRaw === 'troops' ||
      catRaw === '人员' ||
      catRaw === '步兵' ||
      subcatRaw.includes('人员') ||
      subcatRaw.includes('步兵') ||
      laneRaw === 'lane.personnel'
    ) {
      resolved = 'troops';
    } else if (
      catRaw === 'equipment' ||
      catRaw === 'component' ||
      catRaw === '装备' ||
      subcatRaw.includes('装备') ||
      laneRaw === 'lane.equipment'
    ) {
      resolved = 'equipment';
    } else if (
      VEHICLE_CATEGORY_SET.has(catRaw) ||
      laneRaw === 'lane.vehicle_land' ||
      laneRaw === 'lane.vehicle_air' ||
      laneRaw === 'lane.vehicle_naval'
    ) {
      resolved = 'vehicles';
    } else if (needBlds.some(b => b.includes('兵营') || b.includes('复制中心'))) {
      resolved = 'troops';
    } else if (
      needBlds.some(
        b =>
          b.includes('战车工厂') ||
          b.includes('空军指挥部') ||
          b.includes('空军基地') ||
          b.includes('造船厂') ||
          b.includes('船坞'),
      )
    ) {
      resolved = 'vehicles';
    } else if (needBlds.some(b => b.includes('装备制造所') || b.includes('工坊'))) {
      resolved = 'equipment';
    } else if (/人员|步兵|兵种|特工|infantry|troop|soldier|personnel/i.test(combinedMeta)) {
      resolved = 'troops';
    } else {
      resolved = inferUnitCategoryFromItemName(p.name);
    }

    if (resolved) {
      map[p.name] = resolved;
      map[canon(p.name)] = resolved;
      for (const alias of p.aliases ?? []) {
        if (typeof alias === 'string' && alias.trim()) {
          map[alias.trim()] = resolved;
          map[canon(alias)] = resolved;
        }
      }
    }
  }
  return map;
}

/**
 * 资产入账（MATCH/UNDERRUN 认领份额；对齐「操作:完成」现行批准语义）。
 * 不原地修改：tech/bases/forces 仅在确有写入时克隆返回。
 */
function applyAssetClaim(
  state: ReconcileStateShape,
  txn: TransactionItem,
  claimedQty = 1,
  options?: { autoSettle?: boolean },
): AssetOutcome {
  const outcome: AssetOutcome = { notes: [], failures: [] };

  if (txn.type === '研究') {
    if (!state.tech) {
      outcome.failures.push('状态无 tech 字段，tech.done 落账跳过');
      return outcome;
    }
    const techRec = state.tech as { done: string[]; doing?: string[]; [k: string]: unknown };
    const hasDoingMatch =
      Array.isArray(techRec.doing) && techRec.doing.some(name => canon(name) === canon(txn.item));
    const nextDoing =
      Array.isArray(techRec.doing) && hasDoingMatch
        ? techRec.doing.filter(name => canon(name) !== canon(txn.item))
        : undefined;
    if (state.tech.done.some(name => canon(name) === canon(txn.item))) {
      if (nextDoing !== undefined) {
        outcome.tech = { ...state.tech, doing: nextDoing } as NonNullable<ReconcileStateShape['tech']>;
      }
      outcome.notes.push('tech.done 已含同名（幂等跳过）');
      return outcome;
    }
    outcome.tech = {
      ...state.tech,
      done: [...state.tech.done, txn.item],
      ...(nextDoing !== undefined ? { doing: nextDoing } : {}),
    } as NonNullable<ReconcileStateShape['tech']>;
    outcome.notes.push('入 tech.done');
    return outcome;
  }

  if (txn.type === '建造') {
    const bases = state.bases;
    if (!bases) {
      outcome.failures.push('状态无 bases 字段，建筑运转落账跳过');
      return outcome;
    }
    const base = txn.base
      ? (bases.find(b => b.id === txn.base) ?? bases.find(b => canon(b.name) === canon(txn.base)))
      : bases.length === 1
        ? bases[0]
        : undefined;
    if (!base) {
      outcome.failures.push('目标基地建筑不存在，建筑运转落账跳过');
      return outcome;
    }
    const alreadyDelivered = txn.building_delivered_qty ?? 0;
    const neededQty = Math.max(0, Math.max(1, Math.floor(claimedQty)) - alreadyDelivered);
    if (neededQty === 0) {
      outcome.notes.push('目标建筑已运转（幂等跳过）');
      return outcome;
    }
    const specTable = state.buildingUpgradeSpecs ?? BUILTIN_BUILDING_UPGRADE_SPECS;
    const upgradeSpec = specTable[txn.item] ?? specTable[txn.item.trim()];
    const finalBldName = upgradeSpec?.upgraded_name?.trim() || txn.item;
    const isMatchName = (bd: ReconcileBuildingLike): boolean =>
      canon(bd.name) === canon(txn.item) || canon(bd.name) === canon(finalBldName);
    const bldsList = base.buildings ?? [];
    const matches = bldsList.filter(isMatchName);
    const underConstIdx = bldsList.findIndex(bd => isMatchName(bd) && bd.state === '建造中');

    const toRunningBuilding = (bd: ReconcileBuildingLike): ReconcileBuildingLike => {
      const nextBd: ReconcileBuildingLike = {
        ...bd,
        name: finalBldName,
        state: '运转',
      };
      delete nextBd.progress;
      delete nextBd.eta;
      return nextBd;
    };

    const applyUpgradeSideEffects = (blds: ReconcileBuildingLike[]): void => {
      if (upgradeSpec?.upgrade_mode === 'replace') {
        const hostIdx = blds.findIndex(
          bd =>
            canon(bd.name) !== canon(txn.item) &&
            canon(bd.name) !== canon(finalBldName) &&
            upgradeSpec.host_building.some(h => canon(h) === canon(bd.name)),
        );
        if (hostIdx >= 0) blds.splice(hostIdx, 1);
      }
      if (upgradeSpec?.upgrade_mode === 'addon') {
        const hostIdx = blds.findIndex(
          bd =>
            canon(bd.name) !== canon(txn.item) &&
            canon(bd.name) !== canon(finalBldName) &&
            upgradeSpec.host_building.some(h => canon(h) === canon(bd.name)),
        );
        if (hostIdx >= 0) {
          blds[hostIdx] = {
            ...blds[hostIdx],
            addons: Array.from(new Set([...(blds[hostIdx].addons ?? []), finalBldName])),
          };
        }
      }
    };

    // 1. 优先匹配 state === '建造中' 的实例（即使已有同名 '运转' 建筑也不报“不唯一”，精准转正新修建筑）
    if (underConstIdx >= 0) {
      outcome.bases = bases.map(b => {
        if (b !== base) return b;
        const blds = [...(b.buildings ?? [])];
        let flipped = 0;
        for (let i = 0; i < blds.length && flipped < neededQty; i++) {
          if (isMatchName(blds[i]) && blds[i].state === '建造中') {
            blds[i] = toRunningBuilding(blds[i]);
            flipped++;
          }
        }
        applyUpgradeSideEffects(blds);
        return {
          ...b,
          buildings: blds,
        };
      });
      outcome.notes.push(
        finalBldName !== txn.item ? `目标基地建筑升级运转（${txn.item} ➔ ${finalBldName}）` : '目标基地建筑运转',
      );
      return outcome;
    }

    if (matches.length === 1) {
      const addonHostIdx =
        upgradeSpec?.upgrade_mode === 'addon'
          ? bldsList.findIndex(
              bd =>
                canon(bd.name) !== canon(txn.item) &&
                canon(bd.name) !== canon(finalBldName) &&
                upgradeSpec.host_building.some(h => canon(h) === canon(bd.name)),
            )
          : -1;
      const addonAlreadyMounted =
        addonHostIdx < 0 ||
        Boolean(base.buildings?.[addonHostIdx]?.addons?.some(a => canon(a) === canon(finalBldName)));
      if (matches[0].state === '运转' && matches[0].name === finalBldName && addonAlreadyMounted) {
        if (neededQty > 1) {
          outcome.bases = bases.map(b => {
            if (b !== base) return b;
            const blds = [...(b.buildings ?? [])];
            for (let k = 1; k < neededQty; k++) {
              blds.push({ name: finalBldName, layer: '', state: '运转' });
            }
            return { ...b, buildings: blds };
          });
          outcome.notes.push('目标基地建筑运转');
          return outcome;
        }
        outcome.notes.push('目标建筑已运转（幂等跳过）');
        return outcome;
      }
      outcome.bases = bases.map(b => {
        if (b !== base) return b;
        const blds = [...(b.buildings ?? [])];
        applyUpgradeSideEffects(blds);
        return {
          ...b,
          buildings: blds.map(bd => (isMatchName(bd) ? toRunningBuilding(bd) : bd)),
        };
      });
      outcome.notes.push(
        finalBldName !== txn.item ? `目标基地建筑升级运转（${txn.item} ➔ ${finalBldName}）` : '目标基地建筑运转',
      );
      return outcome;
    }

    if (matches.length >= 2 && matches.every(bd => bd.state === '运转')) {
      if (neededQty > matches.length) {
        outcome.bases = bases.map(b => {
          if (b !== base) return b;
          const blds = [...(b.buildings ?? [])];
          for (let k = matches.length; k < neededQty; k++) {
            blds.push({ name: finalBldName, layer: '', state: '运转' });
          }
          return { ...b, buildings: blds };
        });
        outcome.notes.push('目标基地建筑运转');
        return outcome;
      }
      outcome.notes.push('目标建筑已运转（幂等跳过）');
      return outcome;
    }

    // FD-22：当基地中尚未预插在建同名项，但存在可原位升级/挂载的母体建筑时
    if (matches.length === 0 && upgradeSpec) {
      const blds = base.buildings ?? [];
      const hostIdx = blds.findIndex(bd => upgradeSpec.host_building.some(h => canon(h) === canon(bd.name)));
      if (hostIdx >= 0) {
        if (upgradeSpec.upgrade_mode === 'replace') {
          const replacedHostName = blds[hostIdx].name;
          outcome.bases = bases.map(b => {
            if (b !== base) return b;
            return {
              ...b,
              buildings: (b.buildings ?? []).map((bd, idx) =>
                idx === hostIdx ? toRunningBuilding(bd) : bd,
              ),
            };
          });
          outcome.notes.push(`原位升级替换母体（${replacedHostName} ➔ ${finalBldName}）`);
          return outcome;
        }
        if (upgradeSpec.upgrade_mode === 'addon') {
          outcome.bases = bases.map(b => {
            if (b !== base) return b;
            const nextBlds = [...(b.buildings ?? [])];
            nextBlds[hostIdx] = {
              ...nextBlds[hostIdx],
              addons: Array.from(new Set([...(nextBlds[hostIdx].addons ?? []), finalBldName])),
            };
            nextBlds.push({ name: finalBldName, state: '运转' });
            return {
              ...b,
              buildings: nextBlds,
            };
          });
          outcome.notes.push(`母体扩建模块挂载运转（+${finalBldName}）`);
          return outcome;
        }
      }
    }

    // FD-38：无在建占位时的自动补建兜底（非纯外挂 addon 或 standalone !== false）
    const isNonStandaloneUpgrade =
      upgradeSpec !== undefined &&
      ((upgradeSpec as { standalone?: boolean }).standalone === false ||
        upgradeSpec.upgrade_mode === 'addon' ||
        Boolean(upgradeSpec.upgraded_name));
    if (matches.length === 0 && !isNonStandaloneUpgrade) {
      outcome.bases = bases.map(b => {
        if (b !== base) return b;
        const nextBlds = [...(b.buildings ?? [])];
        for (let k = 0; k < neededQty; k++) {
          nextBlds.push({ name: finalBldName, layer: '', state: '运转' });
        }
        return {
          ...b,
          buildings: nextBlds,
        };
      });
      outcome.notes.push('目标基地建筑运转');
      return outcome;
    }

    outcome.failures.push(`目标基地建筑${matches.length ? '不唯一' : '不存在'}，建筑运转落账跳过`);
    return outcome;
  }

  if (txn.type === '生产' || txn.type === '改装') {
    const forces = state.forces;
    const aeroSpec = findBuildableAeroEquipmentSpec(txn.item);
    const explicitCat =
      state.itemCategories?.[txn.item] ??
      state.itemCategories?.[canon(txn.item)] ??
      (aeroSpec ? 'equipment' : undefined);
    const shouldClaimForces =
      !state.forcesExplicitlyUpdated &&
      Boolean(forces) &&
      (Boolean(options?.autoSettle) || forces!.equipment !== undefined || explicitCat !== undefined);
    if (shouldClaimForces && forces) {
      const cat =
        explicitCat ??
        inferUnitCategoryFromItemName(txn.item) ??
        (options?.autoSettle ? (txn.type === '改装' ? 'equipment' : 'vehicles') : undefined);
      const addQty = Math.max(1, Math.floor(claimedQty));
      const targetBase =
        txn.base && state.bases
          ? (state.bases.find(b => b.id === txn.base) ?? state.bases.find(b => canon(b.name) === canon(txn.base)))
          : state.bases?.length === 1
            ? state.bases[0]
            : undefined;
      const troopKey =
        forces.troops !== undefined
          ? Object.keys(forces.troops).find(k => canon(k) === canon(txn.item))
          : undefined;
      if (cat === 'troops' || (cat === undefined && troopKey !== undefined)) {
        const key = troopKey ?? txn.item;
        const prevTroops = forces.troops ?? {};
        const nextForces: NonNullable<ReconcileStateShape['forces']> = {
          ...forces,
          troops: { ...prevTroops, [key]: (prevTroops[key] ?? 0) + addQty },
        };
        if (nextForces.equipment) {
          const wrongEquipKey = Object.keys(nextForces.equipment).find(k => canon(k) === canon(txn.item));
          if (wrongEquipKey !== undefined) {
            const cleanedEquip = { ...nextForces.equipment };
            delete cleanedEquip[wrongEquipKey];
            nextForces.equipment = cleanedEquip;
          }
        }
        outcome.forces = nextForces;
        if (targetBase && state.bases) {
          const prevBaseTroops = targetBase.forces?.troops ?? {};
          const baseKey = Object.keys(prevBaseTroops).find(k => canon(k) === canon(txn.item)) ?? key;
          outcome.bases = state.bases.map(b => {
            if (b !== targetBase) return b;
            const nextBaseForces: NonNullable<ReconcileBaseLike['forces']> = {
              ...(b.forces ?? {}),
              troops: { ...prevBaseTroops, [baseKey]: (prevBaseTroops[baseKey] ?? 0) + addQty },
            };
            if (nextBaseForces.equipment) {
              const wrongBaseEquipKey = Object.keys(nextBaseForces.equipment).find(k => canon(k) === canon(txn.item));
              if (wrongBaseEquipKey !== undefined) {
                const cleanedBaseEquip = { ...nextBaseForces.equipment };
                delete cleanedBaseEquip[wrongBaseEquipKey];
                nextBaseForces.equipment = cleanedBaseEquip;
              }
            }
            return {
              ...b,
              forces: nextBaseForces,
            };
          });
          outcome.notes.push(`入 forces.troops[${key}] +${addQty}（入驻「${targetBase.name}」）`);
        } else {
          outcome.notes.push(`入 forces.troops[${key}] +${addQty}`);
        }
        return outcome;
      }
      if (cat === 'vehicles') {
        const prevVeh = forces.vehicles ?? [];
        const addedVehicles = Array.from({ length: addQty }, () => txn.item);
        outcome.forces = {
          ...forces,
          vehicles: [...prevVeh, ...addedVehicles],
        };
        if (targetBase && state.bases) {
          const prevBaseVeh = targetBase.forces?.vehicles ?? [];
          outcome.bases = state.bases.map(b =>
            b === targetBase
              ? {
                  ...b,
                  forces: {
                    ...(b.forces ?? {}),
                    vehicles: [...prevBaseVeh, ...addedVehicles],
                  },
                }
              : b,
          );
          outcome.notes.push(`入 forces.vehicles +${addQty}（入驻「${targetBase.name}」）`);
        } else {
          outcome.notes.push(`入 forces.vehicles +${addQty}`);
        }
        return outcome;
      }
      const prevEquip = forces.equipment ?? {};
      const equipKey =
        aeroSpec?.name ??
        Object.keys(prevEquip).find(k => canon(k) === canon(txn.item)) ??
        txn.item;
      const nextQty = (prevEquip[equipKey] ?? 0) + addQty;
      outcome.forces = {
        ...forces,
        equipment: { ...prevEquip, [equipKey]: nextQty },
      };
      if (aeroSpec && state.space) {
        const prevStock = state.space.equipment_stock ?? {};
        outcome.space = {
          ...state.space,
          equipment_stock: {
            ...prevStock,
            [aeroSpec.name]: nextQty,
          },
        };
      }
      if (targetBase && state.bases) {
        const prevBaseEquip = targetBase.forces?.equipment ?? {};
        const baseEquipKey = Object.keys(prevBaseEquip).find(k => canon(k) === canon(equipKey)) ?? equipKey;
        outcome.bases = state.bases.map(b =>
          b === targetBase
            ? {
                ...b,
                forces: {
                  ...(b.forces ?? {}),
                  equipment: { ...prevBaseEquip, [baseEquipKey]: (prevBaseEquip[baseEquipKey] ?? 0) + addQty },
                },
              }
            : b,
        );
        outcome.notes.push(`入 forces.equipment[${equipKey}] +${addQty}（入驻「${targetBase.name}」）`);
      } else {
        outcome.notes.push(`入 forces.equipment[${equipKey}] +${addQty}`);
      }
      return outcome;
    }
    // 现行批准语义：仅结项，不推断单位分类（🔴 红线2：forces 勤务格零触碰）
    outcome.notes.push('不推断单位分类（现行批准语义）');
    return outcome;
  }

  if (txn.type === '工程') {
    outcome.notes.push('工程阶段/模块投影项结项（由 syncProjects 回写里程碑）');
    return outcome;
  }

  outcome.failures.push(`未知事务类型「${txn.type}」，资产落账跳过`);
  return outcome;
}

/** canTransition 白名单守卫包装：非法迁移 fail-closed（返回 null），绝不硬闯 */
function guardedStatus(txn: TransactionItem, to: TransactionItem['status']): TransactionItem | null {
  if (txn.status === to) return { ...txn };
  if (!canTransition(txn.status, to)) return null;
  return { ...txn, status: to };
}

export interface ReconcileProductionOptions {
  /** BUG-R2-20：是否在处理完显式 <生产> 声明后，自动将所有剩余处于 settling（满工时）的队列项交割转为 done 并入库 */
  autoSettleRemaining?: boolean;
}

export interface AutoSettleOptions {
  /** 是否要求 total_minutes > 0 && spent_minutes >= total_minutes（默认 false：所有 status === 'settling' 均交割） */
  requirePositiveTotalMinutes?: boolean;
  /** 跳过指定队列下标（例如同楼已被显式 <生产> 声明标记为 OVERRUN/REJECTED 的项） */
  skipIndices?: ReadonlySet<number>;
}

/**
 * BUG-R2-20：系统主权满工时自动完工交割纯函数。
 * 扫描 queues 中所有仍处于 `status === 'settling'`（工时已满）的队列项，
 * 自动将其转为 `status = 'done'`（带 `auto_settled: true` 供同楼 <生产> 幂等防重），
 * 并调用同一套 `applyAssetClaim` 完成建造/生产/研究/工程资产入库。
 */
export function autoSettleCompletedQueues<S extends ReconcileStateShape>(
  state: S,
  options: AutoSettleOptions = {},
): ReconcileResult<S> {
  const events: ReconcileEvent[] = [];
  const verdicts: VerdictRecord[] = [];
  const queues = [...state.queues];
  let tech = state.tech;
  let bases = state.bases;
  let forces = state.forces;
  let space = state.space;

  for (let i = 0; i < queues.length; i++) {
    if (options.skipIndices?.has(i)) continue;
    const target = queues[i];
    if (!target || target.status !== 'settling') continue;
    if (
      options.requirePositiveTotalMinutes &&
      !(target.total_minutes > 0 && target.spent_minutes >= target.total_minutes)
    ) {
      continue;
    }

    const qty = safeQty(target);
    const doneItem = guardedStatus(
      {
        ...target,
        qty_done: qty,
        progress: 100,
        auto_settled: true,
        ...(target.type === '建造' ? { building_delivered_qty: qty } : {}),
      },
      'done',
    );
    if (!doneItem) continue;

    const asset = applyAssetClaim(
      {
        queues,
        tech,
        bases,
        forces,
        space,
        forcesExplicitlyUpdated: state.forcesExplicitlyUpdated,
        itemCategories: state.itemCategories,
        buildingUpgradeSpecs: state.buildingUpgradeSpecs,
      },
      target,
      qty,
      { autoSettle: true },
    );
    if (asset.tech) tech = asset.tech;
    if (asset.bases) bases = asset.bases;
    if (asset.forces) forces = asset.forces;
    if (asset.space) space = asset.space;
    queues[i] = doneItem;

    const detail =
      `系统满工时自动完工交割「${target.item}」${qty > 1 ? ` ${qty} 台` : ''}` +
      `（资产：${[...asset.notes, ...asset.failures].join('；')}）`;
    events.push({
      type: 'reconcile_match',
      level: asset.failures.length ? 'warn' : 'info',
      item: target.item,
      base: target.base,
      detail,
    });
    verdicts.push({
      item: target.item,
      base: target.base,
      type: target.type,
      declaredQty: qty,
      verdict: 'MATCH',
      claimedQty: qty,
      remainderQty: 0,
      detail,
    });
  }

  let next = { ...state, queues } as S;
  if (tech !== state.tech) (next as ReconcileStateShape).tech = tech;
  if (bases !== state.bases) (next as ReconcileStateShape).bases = bases;
  if (forces !== state.forces) (next as ReconcileStateShape).forces = forces;
  if (space !== state.space) (next as ReconcileStateShape).space = space;

  if (options?.autoSettleRemaining) {
    const autoRes = autoSettleCompletedQueues(next, { skipIndices: blockedSettlingIndices });
    if (autoRes.events.length > 0) {
      next = autoRes.next;
      events.push(...autoRes.events);
      verdicts.push(...autoRes.verdicts);
    }
  }

  return { next, events, verdicts };
}

/**
 * 三色对账裁决门（验收标准③）——事务 settling→done 的唯一通道（铁律3）。
 * 输入：本楼状态（settleTransactions 之后）＋ `<生产>` 解析结果；
 * 输出：新状态（入参零突变）＋事件流水＋逐声明裁决记录。
 * 无任何声明时（found=false）调用方应跳过；即便传入也只做 rejected 行留痕、不碰账本。
 */
export function reconcileProduction<S extends ReconcileStateShape>(
  state: S,
  parsed: ProductionParseResult,
  options?: ReconcileProductionOptions,
): ReconcileResult<S> {
  const events: ReconcileEvent[] = [];
  const verdicts: VerdictRecord[] = [];
  const queues = [...state.queues];
  let tech = state.tech;
  let bases = state.bases;
  let forces = state.forces;
  let space = state.space;
  const blockedSettlingIndices = new Set<number>();

  // ① 被拒报文行先留痕（不动账本）
  for (const rej of parsed.rejected) {
    events.push({
      type: 'declaration_rejected',
      level: 'warn',
      item: '（报文行）',
      base: '',
      detail: `${rej.detail}：${rej.raw}`,
    });
    verdicts.push({
      item: rej.raw,
      declaredQty: 0,
      verdict: 'REJECTED',
      claimedQty: 0,
      remainderQty: 0,
      detail: rej.detail,
    });
  }

  // ② 同键声明聚合（数量求和；base/type/raw 取首条）
  const aggregated = new Map<string, ProductionDeclaration>();
  for (const d of parsed.declarations) {
    const key = aggregateKeyOf(d);
    const prev = aggregated.get(key);
    if (prev) prev.qty += d.qty;
    else aggregated.set(key, { ...d });
  }

  // ③ 逐条聚合声明裁决
  for (const decl of aggregated.values()) {
    const matching = queues.map((q, i) => ({ q, i })).filter(({ q }) => declarationMatches(q, decl, bases));
    const live = matching.filter(({ q }) => q.status === 'queued' || q.status === 'active' || q.status === 'settling');
    const terminal = matching.filter(({ q }) => q.status === 'done' || q.status === 'cancelled');

    const pushVerdict = (v: VerdictRecord) => verdicts.push(v);
    const baseVerdict = {
      item: decl.item,
      base: decl.base,
      type: decl.type,
      declaredQty: decl.qty,
    };

    // BUG-LIVE-24a：若声明的研究课题（或匹配到的研究队列项）早已存在于 state.tech.done 中，
    // 且当前无 settling 待认领项（仅无候选或残留 queued/active 副本），视为幂等 NOOP 并清理残留研究队列项，不报 OVERRUN
    const isAlreadyDoneResearch =
      Boolean(tech?.done?.some(t => canon(t) === canon(decl.item))) &&
      (canon(decl.type ?? '') === '研究' ||
        (!decl.type && live.length > 0 && live.every(({ q }) => q.type === '研究'))) &&
      !live.some(({ q }) => q.status === 'settling');
    if (isAlreadyDoneResearch) {
      for (const { q, i } of live) {
        if (q.type === '研究') {
          queues[i] = { ...q, status: 'done', progress: 100, qty_done: safeQty(q) };
        }
      }
      events.push({
        type: 'reconcile_noop',
        level: 'info',
        item: decl.item,
        base: decl.base ?? '',
        detail: '目标科技已存在于 tech.done，重复声明幂等跳过（残留队列项已同步归档）',
      });
      pushVerdict({
        ...baseVerdict,
        verdict: 'NOOP',
        claimedQty: 0,
        remainderQty: 0,
        detail: '已在 tech.done，幂等跳过',
      });
      continue;
    }

    // 无在册候选
    if (!live.length && !terminal.length) {
      events.push({
        type: 'reconcile_overrun',
        level: 'warn',
        item: decl.item,
        base: decl.base ?? '',
        detail: `声明 ${decl.qty} 台但无在册事务（可能已结项或从未立项），拦截挂起`,
      });
      pushVerdict({
        ...baseVerdict,
        verdict: 'OVERRUN',
        claimedQty: 0,
        remainderQty: 0,
        overrunKind: 'no_txn',
        detail: '无在册事务',
      });
      continue;
    }

    // 仅终态候选：done → 幂等 NOOP（若为本楼刚由系统自动完工交割的 auto_settled 项且数量吻合，则幂等确认 MATCH 且绝不重复入账）；cancelled → OVERRUN
    if (!live.length) {
      const autoSettledDone = terminal.filter(({ q }) => q.status === 'done' && Boolean(q.auto_settled));
      if (autoSettledDone.length === 1) {
        const { q: autoTarget, i: autoIdx } = autoSettledDone[0];
        const autoQty = safeQty(autoTarget);
        if (decl.qty === autoQty) {
          const { auto_settled: _omitAutoSettled, ...cleanDone } = autoTarget;
          queues[autoIdx] = cleanDone;
          const detail = `MATCH 吻合入役「${decl.item}」${autoQty > 1 ? ` ${autoQty}/${autoQty} 台` : ''}（本楼已由系统满工时自动完工交割，幂等防重跳过二次入账）`;
          events.push({
            type: 'reconcile_match',
            level: 'info',
            item: decl.item,
            base: autoTarget.base,
            detail,
          });
          pushVerdict({
            ...baseVerdict,
            verdict: 'MATCH',
            claimedQty: autoQty,
            remainderQty: 0,
            detail,
          });
          continue;
        }
        if (decl.qty > autoQty) {
          events.push({
            type: 'reconcile_overrun',
            level: 'warn',
            item: decl.item,
            base: autoTarget.base,
            detail: `声明 ${decl.qty} 台超出在册批次 ${autoQty} 台（超产），拦截挂起，事务原地不动`,
          });
          pushVerdict({
            ...baseVerdict,
            verdict: 'OVERRUN',
            claimedQty: 0,
            remainderQty: autoQty,
            physicalDoneQty: autoQty,
            remainingMinutes: 0,
            overrunKind: 'over_qty',
            detail: '超产拦截',
          });
          continue;
        }
      }
      if (terminal.some(({ q }) => q.status === 'done')) {
        events.push({
          type: 'reconcile_noop',
          level: 'info',
          item: decl.item,
          base: decl.base ?? '',
          detail: '目标事务已 done，重复声明幂等跳过（不重复入账）',
        });
        pushVerdict({ ...baseVerdict, verdict: 'NOOP', claimedQty: 0, remainderQty: 0, detail: '已 done，幂等跳过' });
      } else {
        events.push({
          type: 'reconcile_overrun',
          level: 'warn',
          item: decl.item,
          base: decl.base ?? '',
          detail: '目标事务已 cancelled（驾驶员取消/驳回），声明与账本冲突，拦截挂起',
        });
        pushVerdict({
          ...baseVerdict,
          verdict: 'OVERRUN',
          claimedQty: 0,
          remainderQty: 0,
          overrunKind: 'cancelled',
          detail: '目标已作废',
        });
      }
      continue;
    }

    // 多个在册候选：需消歧，fail-closed
    if (live.length > 1) {
      for (const { i } of live) blockedSettlingIndices.add(i);
      events.push({
        type: 'declaration_rejected',
        level: 'warn',
        item: decl.item,
        base: decl.base ?? '',
        detail: `命中 ${live.length} 条在册事务，候选不唯一（请补 基地/类型 消歧行），声明未执行`,
      });
      pushVerdict({ ...baseVerdict, verdict: 'REJECTED', claimedQty: 0, remainderQty: 0, detail: '候选不唯一' });
      continue;
    }

    const { q: target, i: targetIndex } = live[0];
    const qty = safeQty(target);
    const unit = qty > 0 ? target.total_minutes / qty : 0;
    const d = decl.qty;

    /** 资产入账 + 事件/裁决落笔（MATCH 与 UNDERRUN 共用） */
    const commitClaim = (
      claimed: number,
      remainder: number,
      kind: 'MATCH' | 'UNDERRUN',
      donePart: TransactionItem,
      remainderPart: TransactionItem | null,
      verb: string,
    ) => {
      const asset = applyAssetClaim(
        {
          queues,
          tech,
          bases,
          forces,
          space,
          forcesExplicitlyUpdated: state.forcesExplicitlyUpdated,
          itemCategories: state.itemCategories,
          buildingUpgradeSpecs: state.buildingUpgradeSpecs,
        },
        target,
        claimed,
      );
      if (asset.tech) tech = asset.tech;
      if (asset.bases) bases = asset.bases;
      if (asset.forces) forces = asset.forces;
      if (asset.space) space = asset.space;
      if (remainderPart) queues.splice(targetIndex, 1, remainderPart, donePart);
      else queues.splice(targetIndex, 1, donePart);
      const detail =
        `${verb}「${decl.item}」${qty > 1 ? ` ${claimed}/${qty} 台` : ''}` +
        `${remainder > 0 ? `，余量 ${remainder} 台退回 active` : ''}` +
        `（资产：${[...asset.notes, ...asset.failures].join('；')}）`;
      events.push({
        type: kind === 'MATCH' ? 'reconcile_match' : 'reconcile_underrun',
        level: asset.failures.length ? 'warn' : 'info',
        item: decl.item,
        base: target.base,
        detail,
      });
      pushVerdict({ ...baseVerdict, verdict: kind, claimedQty: claimed, remainderQty: remainder, detail });
    };

    const rejectGuardFailure = (to: string) => {
      events.push({
        type: 'declaration_rejected',
        level: 'warn',
        item: decl.item,
        base: target.base,
        detail: `状态机白名单拒绝 ${target.status}→${to}（铁律守卫 fail-closed），声明未执行`,
      });
      pushVerdict({ ...baseVerdict, verdict: 'REJECTED', claimedQty: 0, remainderQty: 0, detail: '守卫拒绝' });
    };

    // ── settling 分支 ──
    if (target.status === 'settling') {
      if (d === qty) {
        const done = guardedStatus(
          {
            ...target,
            qty_done: qty,
            progress: 100,
            ...(target.type === '建造' ? { building_delivered_qty: qty } : {}),
          },
          'done',
        );
        if (!done) {
          rejectGuardFailure('done');
          continue;
        }
        commitClaim(d, 0, 'MATCH', done, null, 'MATCH 吻合入役');
        continue;
      }
      if (d < qty) {
        const remainderQty = qty - d;
        const remainingRatio = remainderQty / qty;
        const remainderTotal = unit * remainderQty;
        const remainderSpent = Math.max(0, target.spent_minutes * remainingRatio);
        const remainderProgress = Math.min(100, Math.round(target.progress * remainingRatio * 100) / 100);
        const remainder = guardedStatus(
          {
            ...target,
            qty: remainderQty,
            qty_done: Math.max(0, Math.min(remainderQty, Math.floor((target.qty_done || qty) - d))),
            ...(target.type === '建造'
              ? { building_delivered_qty: Math.max(0, Math.min(remainderQty, (target.building_delivered_qty ?? 0) - d)) }
              : {}),
            total_minutes: remainderTotal,
            spent_minutes: remainderSpent,
            progress: remainderProgress,
          },
          'active',
        );
        if (!remainder) {
          rejectGuardFailure('active');
          continue;
        }
        commitClaim(d, remainderQty, 'UNDERRUN', remainder, null, 'UNDERRUN 按实认领');
        continue;
      }
      // d > qty：超产拦截
      blockedSettlingIndices.add(targetIndex);
      events.push({
        type: 'reconcile_overrun',
        level: 'warn',
        item: decl.item,
        base: target.base,
        detail: `声明 ${d} 台超出在册批次 ${qty} 台（超产），拦截挂起，事务原地不动`,
      });
      pushVerdict({
        ...baseVerdict,
        verdict: 'OVERRUN',
        claimedQty: 0,
        remainderQty: qty,
        physicalDoneQty: qty,
        remainingMinutes: 0,
        overrunKind: 'over_qty',
        detail: '超产拦截',
      });
      continue;
    }

    // ── active 分支 ──
    if (target.status === 'active') {
      const physicalDone = Math.min(qty, Math.max(0, Math.floor(target.qty_done)));
      if (d <= physicalDone) {
        // 认领已下线台数（先下线先入役候审→本门过堂）
        const remainderQty = qty - d;
        const donePart: TransactionItem = {
          ...target,
          status: 'done',
          qty: d,
          qty_done: d,
          ...(target.type === '建造' ? { building_delivered_qty: d } : {}),
          total_minutes: unit * d,
          spent_minutes: unit * d,
          progress: 100,
        };
        const remainderSpent = Math.max(0, target.spent_minutes - unit * d);
        const remainderTotal = unit * remainderQty;
        const remainder: TransactionItem = {
          ...target,
          qty: remainderQty,
          qty_done: physicalDone - d,
          ...(target.type === '建造'
            ? { building_delivered_qty: Math.max(0, Math.min(remainderQty, (target.building_delivered_qty ?? 0) - d)) }
            : {}),
          total_minutes: remainderTotal,
          spent_minutes: remainderSpent,
          progress: remainderTotal > 0 ? Math.min(100, (remainderSpent / remainderTotal) * 100) : target.progress,
        };
        commitClaim(d, remainderQty, 'UNDERRUN', donePart, remainder, 'UNDERRUN 按实认领（已下线台数）');
        continue;
      }
      // 声明超出物理已下线：时序冲突拦截（§5.2 宽容档 v1 未实现，见模块头诚实边界 1）
      const remainingMinutes = Math.max(0, target.total_minutes - target.spent_minutes);
      events.push({
        type: 'reconcile_overrun',
        level: 'warn',
        item: decl.item,
        base: target.base,
        detail:
          `声明 ${d} 台但物理已下线 ${physicalDone}/${qty} 台，剩余工期 ${Math.round(remainingMinutes)} 分钟` +
          `（时序冲突），拦截挂起，事务原地不动`,
      });
      pushVerdict({
        ...baseVerdict,
        verdict: 'OVERRUN',
        claimedQty: 0,
        remainderQty: qty,
        physicalDoneQty: physicalDone,
        remainingMinutes,
        overrunKind: 'time_conflict',
        detail: '时序冲突拦截',
      });
      continue;
    }

    // ── queued 分支：尚未开工即声明完工 ──
    events.push({
      type: 'reconcile_overrun',
      level: 'warn',
      item: decl.item,
      base: target.base,
      detail: `目标仍在 queued（尚未开工）即声明 ${d} 台下线，拦截挂起，事务原地不动`,
    });
    pushVerdict({
      ...baseVerdict,
      verdict: 'OVERRUN',
      claimedQty: 0,
      remainderQty: qty,
      physicalDoneQty: 0,
      remainingMinutes: target.total_minutes > 0 ? target.total_minutes : undefined,
      overrunKind: 'not_started',
      detail: '未开工拦截',
    });
  }

  const next = { ...state, queues } as S;
  if (tech !== state.tech) (next as ReconcileStateShape).tech = tech;
  if (bases !== state.bases) (next as ReconcileStateShape).bases = bases;
  if (forces !== state.forces) (next as ReconcileStateShape).forces = forces;
  if (space !== state.space) (next as ReconcileStateShape).space = space;
  return { next, events, verdicts };
}

/* ═══════════════ CHRONO 横幅纠偏支持（CTRL-UI-CHRONO-01 · A′ 增补） ═══════════════ */

/** A′ 宽容档带宽：剩余工期 ≤ 此值（1 日）的时序冲突，横幅默认高亮「自动顺延时间」 */
export const AUTO_ADVANCE_TOLERANCE_MINUTES = 1440;

/**
 * 自动顺延分钟数：取所有「时序冲突」OVERRUN 裁决的 max remainingMinutes（无则 0）。
 * 横幅消费口径：返回 >0 才可点「自动顺延时间」；<= AUTO_ADVANCE_TOLERANCE_MINUTES 时默认高亮推荐（A′）。
 * 仅 time_conflict 计入——超产/无在册/未开工/已作废顺延时间也修不好，不纳入。
 */
export function autoAdvanceDeltaFor(verdicts: VerdictRecord[]): number {
  let delta = 0;
  for (const v of verdicts) {
    if (v.verdict !== 'OVERRUN' || v.overrunKind !== 'time_conflict') continue;
    const rem = v.remainingMinutes;
    if (typeof rem === 'number' && Number.isFinite(rem) && rem > 0) delta = Math.max(delta, rem);
  }
  return Math.round(delta);
}

/** forceCommission 入参：目标按 canon(item)（可选基地消歧）唯一命中在册事务 */
export interface ForceCommissionTarget {
  item: string;
  base?: string;
}

export interface ForceCommissionResult<S extends ReconcileStateShape> {
  next: S;
  events: ReconcileEvent[];
  /** 特批后的事务（done 态克隆） */
  commissioned: TransactionItem;
}

/**
 * 🔴 驾驶员逃生舱：强制特批入役（CTRL-UI-CHRONO-01 [强制特批入役] 钮的纯函数本体）。
 *
 * **故意绕过 canTransition 白名单**——queued→done / active→done 在状态机里均非法，
 * 本函数是全系统唯一例外，仅服务「驾驶员明断 LLM 叙事属实、物理校验让位」的场景；
 * 代价是必须留下不可静默的审计痕迹：warn 级 force_commission 事件（→🟡→R23）。
 *
 * 语义：唯一在册（queued/active/settling）目标原地克隆置 done（progress=100、qty_done=qty、
 * total>0 时 spent=total），资产入账复用 MATCH 同一套 applyAssetClaim（研究→tech.done / 建造→运转 /
 * 生产·改装不写 forces）；无候选或候选不唯一 → null（fail-closed，调用方提示需消歧）。
 * 入参零突变；终态（done/cancelled）目标不可特批（铁律4 终态不可逆高于驾驶员逃生舱）。
 */
export function forceCommission<S extends ReconcileStateShape>(
  state: S,
  target: ForceCommissionTarget,
): ForceCommissionResult<S> | null {
  const needle: ProductionDeclaration = { item: target.item, qty: 1, base: target.base, raw: '' };
  const queues = [...state.queues];
  const live = queues
    .map((q, i) => ({ q, i }))
    .filter(
      ({ q }) =>
        (q.status === 'queued' || q.status === 'active' || q.status === 'settling') &&
        declarationMatches(q, needle, state.bases),
    );
  if (live.length !== 1) return null;

  const { q: hit, i: index } = live[0];
  const qty = safeQty(hit);
  const prevStatus = hit.status;
  const prevProgress = Math.round(hit.progress);
  const physicalDone = Math.min(qty, Math.max(0, Math.floor(hit.qty_done)));
  const commissioned: TransactionItem = {
    ...hit,
    status: 'done', // 逃生舱：绕过 canTransition（本模块头诚实边界 1 已注）
    qty_done: qty,
    spent_minutes: hit.total_minutes > 0 ? hit.total_minutes : hit.spent_minutes,
    progress: 100,
  };

  let tech = state.tech;
  let bases = state.bases;
  let forces = state.forces;
  let space = state.space;
  const asset = applyAssetClaim(
    {
      queues,
      tech,
      bases,
      forces,
      space,
      forcesExplicitlyUpdated: state.forcesExplicitlyUpdated,
      itemCategories: state.itemCategories,
      buildingUpgradeSpecs: state.buildingUpgradeSpecs,
    },
    hit,
    qty,
  );
  if (asset.tech) tech = asset.tech;
  if (asset.bases) bases = asset.bases;
  if (asset.forces) forces = asset.forces;
  if (asset.space) space = asset.space;
  queues.splice(index, 1, commissioned);

  const events: ReconcileEvent[] = [
    {
      type: 'force_commission',
      level: 'warn',
      item: hit.item,
      base: hit.base,
      detail:
        `「${hit.item}」原状态 ${prevStatus} / 原进度 ${prevProgress}% / 物理已下线 ${physicalDone}/${qty} 台，` +
        `驾驶员强制特批直接入役（绕过三色门物理校验，审计留痕）` +
        `（资产：${[...asset.notes, ...asset.failures].join('；')}）`,
    },
  ];

  const next = { ...state, queues } as S;
  if (tech !== state.tech) (next as ReconcileStateShape).tech = tech;
  if (bases !== state.bases) (next as ReconcileStateShape).bases = bases;
  if (forces !== state.forces) (next as ReconcileStateShape).forces = forces;
  if (space !== state.space) (next as ReconcileStateShape).space = space;
  return { next, events, commissioned };
}

/* ═══════════════ 事件 → 解析留痕映射（useParse 接缝用） ═══════════════ */

const EVENT_LABELS: Record<ReconcileEvent['type'], string> = {
  reconcile_match: 'MATCH 吻合入役',
  reconcile_underrun: 'UNDERRUN 按实认领',
  reconcile_overrun: 'OVERRUN 拦截挂起',
  reconcile_noop: '对账幂等跳过',
  declaration_rejected: '声明被拒',
  force_commission: '驾驶员强制特批',
};

/** 对账事件 → ParseEvent（warn→🟡，info→🟢；对齐 settleFloor eventToParseEvent 惯例） */
export function reconcileEventToParseEvent(event: ReconcileEvent): ParseEvent {
  return {
    light: event.level === 'warn' ? '🟡' : '🟢',
    layer: 'instruction',
    message: `[对账] ${EVENT_LABELS[event.type]}「${event.item}」${event.detail ? `：${event.detail}` : ''}`,
    path: 'queues',
  };
}

/** 对账事件 → CheckIssue（仅 warn 升 R23；对齐 settleFloor eventToIssue 惯例） */
export function reconcileEventToIssue(event: ReconcileEvent): CheckIssue | null {
  if (event.level !== 'warn') return null;
  return {
    rule: 'R23',
    level: 'warn',
    target: `队列[${event.item}]`,
    message: `${EVENT_LABELS[event.type]}${event.detail ? `：${event.detail}` : ''}`,
  };
}
