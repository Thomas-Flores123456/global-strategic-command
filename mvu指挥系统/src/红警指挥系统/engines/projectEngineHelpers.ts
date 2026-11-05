/**
 * projectEngineHelpers.ts —— 工程投影引擎共享类型、读数助手与接缝函数
 *
 * 从 projectEngine.ts 拆出：
 * - V1 / V2 工程共享状态视图、结果类型、事件类型与模块拓扑定义接口
 * - 纳米与资金读数/扣减助手（availableNanites / deductEconomyNanites / availableCredits）
 * - 队列寻址、投影命名、阶段属地与实例 ID 分配（resolveEngineeringQueueIndex / projectionItemName / phaseBase / findProjectIndex / allocateProjectInstanceId）
 * - V1 阶段门校验与投影构建（checkPhaseGates / checkSlotGate / buildProjection）
 * - 工程 workload 映射接缝（engAssemblySpecFor）与赤星天锤轨道载荷计算（evaluateRedStarHammerPayload）
 */

import type { RetrofitDef } from '../core/catalog';
import type { RuntimeProtocolsInput } from '../core/catalogRuntimeContext';
import type { Project, ProjectModule, ProjectPhase, ProjectV2 } from '../core/schema';
import { canon } from '../parse/parsePipeline';
import type { RetrofitPhase } from '../../中控悬浮窗/models/worldbookCatalogParser';
import {
  ENGINEERING_SLOT_REGISTRY,
  engSlotCapacityInBase,
  type EngineeringSlotDef,
} from './engineeringSlots';

/* ═══════════════ 最小结构视图（零依赖，与 schema.ts 输出结构兼容） ═══════════════ */

/** 投影 queue 项结构视图（QueueItem v2 输出 + §3.3 可选 lane；本模块不 import schema 运行时） */
export interface ProjectQueueItem {
  type: string;
  item: string;
  base: string;
  progress: number;
  eta: string;
  status: 'queued' | 'active' | 'settling' | 'done' | 'cancelled';
  started_at: string;
  total_minutes: number;
  spent_minutes: number;
  qty: number;
  qty_done: number;
  cost_paid: boolean;
  min_days_lock: number;
  hold: boolean;
  lane?: string;
}

/** 本模块消费的最小状态视图（StatData 结构子集） */
export interface ProjectStateView {
  tech?: { done?: readonly string[] };
  protocols?: RuntimeProtocolsInput;
  economy?: {
    credits?: number;
    resources?: { nanites?: Readonly<Record<string, number | null>> };
  };
  bases?: ReadonlyArray<{
    id?: string;
    name?: string;
    buildings?: ReadonlyArray<{ name: string; state?: string }>;
    forces?: {
      troops?: Readonly<Record<string, number>>;
      infantry?: Readonly<Record<string, number>>;
      vehicles?: ReadonlyArray<string>;
      aircraft?: ReadonlyArray<string>;
    } | null;
  }>;
  forces?: {
    troops?: Readonly<Record<string, number>>;
    infantry?: Readonly<Record<string, number>>;
    vehicles?: ReadonlyArray<string>;
    aircraft?: ReadonlyArray<string>;
    girls?: ReadonlyArray<{ name: string; model?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  };
  queues?: ProjectQueueItem[];
  projects?: Project[];
}

/**
 * 工程队列项安全寻址与漂移重定位（FIX-P1-03 · 08 [P1-2]）：
 * 优先校验 rawIndex 处是否满足 type === '工程' && canon(item) === canon(expectedItem) 且状态合法；
 * 若队列发生前置剔除/重排导致下标漂移，则按 (type === '工程', base, canon(item)) 自动重定位。
 */
export function resolveEngineeringQueueIndex(
  queues: readonly ProjectQueueItem[],
  rawIndex: number | null,
  expectedItem: string,
  expectedBase?: string,
  allowTerminal = false,
): number | null {
  const targetCanon = canon(expectedItem);
  const baseNorm = (expectedBase ?? '').trim();
  const matchesItem = (q: ProjectQueueItem) =>
    q.type === '工程' &&
    (!baseNorm || q.base.trim() === baseNorm) &&
    (allowTerminal || (q.status !== 'done' && q.status !== 'cancelled')) &&
    canon(q.item) === targetCanon;

  if (rawIndex !== null && rawIndex >= 0 && rawIndex < queues.length) {
    if (matchesItem(queues[rawIndex])) {
      return rawIndex;
    }
  }

  let resolvedIndex: number | null = null;
  for (let i = 0; i < queues.length; i++) {
    if (i === rawIndex || !matchesItem(queues[i])) continue;
    if (resolvedIndex !== null) return null;
    resolvedIndex = i;
  }
  return resolvedIndex;
}

/** 工程事件（结构化留痕，供 settleFloor 落 events / UI 消费；不 console） */
export interface ProjectEvent {
  type:
    | 'project_started' // 立项成功（含首期注资与首期投影）
    | 'phase_started' // 注资令通过，阶段投影
    | 'phase_milestone' // 投影项 done → 阶段完工回写（V1）
    | 'module_started' // V2：模块注资令通过，模块投影
    | 'module_allocated' // V2：跨基地模块承建指派（UTO-ALLOC-01）
    | 'module_milestone' // V2：模块投影项 done → 模块完工回写
    | 'module_paused' // V2：模块级暂停（hold 单模块）
    | 'module_resumed' // V2：模块级恢复
    | 'project_completed' // 全部完工 → 工程完工＋outcome mark（V1=末阶段链 / V2=模块拓扑）
    | 'project_paused'
    | 'project_resumed'
    | 'project_cancelled'
    | 'sync_warn'; // 里程碑回读异常（索引漂移/身份不符），fail-open 跳过
  item: string; // 工程 ref 或投影项名
  detail?: string;
}

/** 指令失败原因（机器可判；message 为人读说明，UI 确认文案复用） */
export type ProjectCommandFailureReason =
  | 'research_gate' // 前置科技门：retrofit.research ∉ tech.done
  | 'no_slot' // 属地工程槽容量为 0（无可运转锚定建筑）
  | 'no_phases' // 静态定义缺 phases[]，无法展开阶段
  | 'invalid_bases' // 基地参数非法（空 lead / theater bases<2）
  | 'duplicate' // 同 ref+lead_base 已有未完结工程
  | 'funds' // 阶段资金不足（D8：停摆不暴毙）
  | 'nanites_gate' // 纳米开工门不足（D8b：门槛非抵扣）
  | 'not_found'
  | 'def_mismatch' // 传入静态定义与 project.ref 不符
  | 'bad_status'
  | 'phase_order' // 前序阶段未完工，不得越级注资（V1）
  | 'no_modules' // V2：静态定义缺 modules[]，无法展开仓段（no_phases 的 V2 对位）
  | 'bad_topology' // V2：模块拓扑非法（重复 id / prereqs 引用缺失 / 闭包成环）
  | 'module_order'; // V2：前置模块未全部完工，不得注资（phase_order 的拓扑版）

export type ProjectCommandResult<S> =
  | { ok: true; next: S; events: ProjectEvent[]; projectId: string }
  | { ok: false; reason: ProjectCommandFailureReason; message: string; events: ProjectEvent[] };

/** 取消结算（settlementText 为 §3.3 固定文案，供 UI 确认弹窗复用） */
export type CancelProjectResult<S> =
  | { ok: true; next: S; events: ProjectEvent[]; projectId: string; settlementText: string }
  | { ok: false; reason: ProjectCommandFailureReason; message: string; events: ProjectEvent[] };

/** 里程碑回写结果 */
export interface SyncProjectsResult<S> {
  next: S;
  events: ProjectEvent[];
}

export interface StartProjectOptions {
  /** 牵头基地（Base.id 或名） */
  base: string;
  /** theater 工程参与基地清单（≥2，含牵头基地；scope='base' 时忽略） */
  bases?: readonly string[];
  /** 显式实例 id（缺省 `proj:${def.name}@${base}`） */
  id?: string;
}

/* ═══════════════ V2 静态定义与跨基地指派类型 ═══════════════ */

/** V2 模块工作量（字段口径对齐 RetrofitPhaseWorkload；days/min_days 进投影，tflops/tops 留接缝） */
export interface ProjectV2ModuleWorkload {
  days: number;
  min_days: number;
  tflops?: number;
  tops?: number;
}

/** V2 模块静态定义（设计案 §3.1 modules[] 元素；D-C1 模块≈带身份的单阶段） */
export interface ProjectV2ModuleDef {
  id: string; // 模块 id（工程内唯一；prereqs 拓扑边引用键）
  name: string; // 模块名（投影命名合同 `ref·模块名` 第二元，裁量 j）
  cost?: number; // 模块注资额（D8 分模块注资：断链=模块停摆非工程暴毙）
  workload?: ProjectV2ModuleWorkload;
  resources?: { nanites?: number }; // 模块级纳米开工门（D8b 门槛非抵扣）
  prereqs: readonly string[]; // 前置模块 id 集（拓扑边）；空集=根模块
}

/** V2 工程资格需求（§3.1 requirements） */
export interface ProjectV2Requirements {
  research?: string; // 前置科技 ∈ tech.done（三门之一：资格门）
  building?: string; // 锚定建筑声明位（机器门=工程槽属地容量，D-C4）
  credits?: number; // 造价声明位（机器扣款按模块注资额；D12 对账门 V2-11）
  nanites?: number; // 纳米声明位（机器门按模块开工门，D8b）
}

/** V2 工程静态定义 */
export interface ProjectV2Def {
  id: string; // 世界书 project 块 id
  name: string; // 工程名（运行时 ref=V1 `ref: def.name` 同口径，裁量 j）
  grade?: Project['grade']; // 缺省「巨构」（D-C2 V2 档）
  scope?: 'base' | 'theater'; // 缺省 base（D-C3 不强制多基地）
  requirements?: ProjectV2Requirements;
  modules: readonly ProjectV2ModuleDef[]; // ≥1（模块拓扑）
}

/** investModule 可选项 */
export interface InvestModuleOptions {
  /** 模块级承建基地指派（Base.id 或名；缺省=已指派 base 或 theater 模块序轮转/lead_base，同 V1 属地口径） */
  base?: string;
}

export type ProjectInstance = Project;
export type ProjectModuleState = ProjectModule & { assigned_base?: string };

export interface AssignModuleBaseParams {
  projectRef: string;
  moduleId: string;
  targetBase: string;
  reason?: string;
}

export interface AssignModuleBaseResult<S extends ProjectStateView = ProjectStateView> {
  ok: boolean;
  error?: string;
  reason?: ProjectCommandFailureReason;
  message?: string;
  next?: S;
  events: ProjectEvent[];
  projectId?: string;
  project?: ProjectV2;
  module?: ProjectModuleState;
}

/** 游戏内一日分钟数（本地常量，避免反向依赖冻结引擎文件） */
export const MINUTES_PER_DAY = 1440;

/** 首版唯一工程槽（注册表首条；槽开通判定对齐立项/注资门） */
export const MAIN_SLOT = ENGINEERING_SLOT_REGISTRY[0];

/**
 * V2 专属工程槽（D-C4/§4）：注册表中「只接 project」的首个槽（现=eng.orbital 轨道组装泊位）。
 * 数据驱动解析：注册表追加 project-only 槽不改本行；注册表倒退（无 project-only 槽）兜底首槽 fail-open。
 */
export const V2_PROJECT_SLOT: EngineeringSlotDef =
  ENGINEERING_SLOT_REGISTRY.find(s => s.accepts.includes('project') && !s.accepts.includes('retrofit')) ??
  MAIN_SLOT;

/* ═══════════════ 读数助手 ═══════════════ */

/** 纳米读数/扣减已下沉至零依赖叶子模块 naniteLedger（供 spaceEngine 共用且不引入 parse 链循环） */
import { availableNanites, deductEconomyNanites } from './naniteLedger';
export { availableNanites, deductEconomyNanites };


/** 系统资金（缺席按 0） */
export function availableCredits(state: ProjectStateView): number {
  const credits = state.economy?.credits;
  return typeof credits === 'number' && Number.isFinite(credits) ? credits : 0;
}

/** 投影项命名合同（裁量 a）：`${ref}·${phaseName}` */
export function projectionItemName(ref: string, phaseName: string): string {
  return `${ref}·${phaseName}`;
}

/** 阶段属地基地（裁量 c：theater 轮转 / base 恒 lead_base） */
export function phaseBase(project: Pick<Project, 'scope' | 'bases' | 'lead_base'>, phaseIdx: number): string {
  if (project.scope === 'theater' && project.bases.length > 0) {
    return project.bases[phaseIdx % project.bases.length];
  }
  return project.lead_base;
}

/** 按 id（优先）或 ref 定位工程下标；未命中 -1。
 *  D-TH-1 修复（工程玩法MVP任务包 §9.2 僵尸陷阱 / P2-⑧）：同 id/ref 多实例按
 *  「非终态优先、最新在前」匹配——旧终态（完工/取消）实例不再劫持指令。 */
export function findProjectIndex(state: ProjectStateView, projectId: string): number {
  const projects = state.projects ?? [];
  const isTerminal = (p: Project): boolean => p.status === '完工' || p.status === '取消';
  const pickAmong = (candidates: readonly number[]): number => {
    let latestLive = -1;
    for (const i of candidates) if (!isTerminal(projects[i])) latestLive = i;
    return latestLive >= 0 ? latestLive : candidates[candidates.length - 1];
  };
  const byId = projects.reduce<number[]>((acc, p, i) => (p.id === projectId ? (acc.push(i), acc) : acc), []);
  if (byId.length > 0) return pickAmong(byId);
  const byRef = projects.reduce<number[]>((acc, p, i) => (p.ref === projectId ? (acc.push(i), acc) : acc), []);
  if (byRef.length > 0) return pickAmong(byRef);
  return -1;
}

/**
 * 同名工程重立 ID 期次后缀分配（UX-SCHED-01 · D-TH-1 / P2-⑧）：
 * - 基础 ID 为 `proj:${defName}@${leadBase}`；
 * - 若 `projects` 中尚未存在 `id === baseId` 的实例，返回 `baseId`；
 * - 若已存在（如先前同基地同名工程已取消或完工），则分配下一个未占用的期次 ID：`proj:${defName}@${leadBase}#2`、`#3` 等。
 */
export function allocateProjectInstanceId(
  projects: readonly { id: string; ref?: string; lead_base?: string }[] | undefined,
  defName: string,
  leadBase: string,
): string {
  const baseId = `proj:${defName}@${leadBase}`;
  const list = projects ?? [];
  const usedIds = new Set(list.map(p => p.id));
  if (!usedIds.has(baseId)) {
    return baseId;
  }
  let seq = 2;
  while (usedIds.has(`${baseId}#${seq}`)) {
    seq += 1;
  }
  return `${baseId}#${seq}`;
}

/** 阶段注资双门（D8 资金 / D8b 纳米开工门）；通过返回 null，否则返回失败负载 */
export function checkPhaseGates(
  state: ProjectStateView,
  phaseDef: RetrofitPhase,
  phaseLabel: string,
): { reason: ProjectCommandFailureReason; message: string } | null {
  const cost = phaseDef.cost ?? 0;
  const credits = availableCredits(state);
  if (cost > credits) {
    return {
      reason: 'funds',
      message: `阶段「${phaseLabel}」注资 ${cost} 超出可用资金 ${credits}——注资令搁置，阶段保持未启动（资金断链＝阶段停摆，工程不暴毙，D8）；补足资金后重发注资令即可`,
    };
  }
  const need = phaseDef.resources?.nanites ?? 0;
  const stock = availableNanites(state);
  if (need > stock) {
    return {
      reason: 'nanites_gate',
      message: `阶段「${phaseLabel}」纳米开工门未过：需求 ${need} ＞ 可用纳米库存 ${stock}——开工将实扣纳米，库存不足时不扣；阶段保持未启动、工程保持在建，备齐纳米后重发注资令`,
    };
  }
  return null;
}

/** 属地工程槽容量门：属地可运转锚定建筑数 ≥1（基地不可解析按 0 → 拒，对齐「有队无道」开通门语义） */
export function checkSlotGate(
  state: ProjectStateView,
  base: string,
  phaseLabel: string,
): { reason: ProjectCommandFailureReason; message: string } | null {
  const capacity = engSlotCapacityInBase(state, base, MAIN_SLOT) ?? 0;
  if (capacity < 1) {
    return {
      reason: 'no_slot',
      message: `基地「${base}」无可用工程槽（锚定建筑 ${MAIN_SLOT.anchor} 均不在场/建造中）——「${phaseLabel}」不得开工（§3.2 锚定建筑门）`,
    };
  }
  return null;
}

/** 构造一条阶段投影 QueueItem（裁量 d：queued 入场等带宽门放票；裁量 h：工期/锁值投影时刻写入） */
export function buildProjection(
  project: Pick<Project, 'ref' | 'scope' | 'bases' | 'lead_base'>,
  phase: ProjectPhase,
  phaseDef: RetrofitPhase,
): ProjectQueueItem {
  const workload = phaseDef.workload;
  return {
    type: '工程',
    item: projectionItemName(project.ref, phase.name),
    base: phaseBase(project, phase.idx),
    progress: 0,
    eta: '',
    status: 'queued',
    started_at: '',
    total_minutes: workload && workload.days > 0 ? workload.days * MINUTES_PER_DAY : 0,
    spent_minutes: 0,
    qty: 1,
    qty_done: 0,
    cost_paid: true, // 注资记账：立项/注资令通过即扣账，投影项标记已付
    min_days_lock: workload && workload.min_days > 0 ? workload.min_days : 0,
    hold: false,
    lane: `eng:${MAIN_SLOT.slotId}`, // §3.3 显式槽位入口
  };
}

/* ═══════════════ ⑦ workload 映射接缝（喂 settleFloor assemblyFor，任务卡第 7 条） ═══════════════ */

/**
 * '工程' workload 映射源（V2-04 接缝扩展）：V1 retrofit 静态 phases 与 V2 project 静态 modules
 * 同形异构——段名（阶段名/模块名）与 workload 字段口径刻意同构（RetrofitPhaseWorkload ≡
 * ProjectV2ModuleWorkload），接缝函数按「有 phases 走 V1、有 modules 走 V2」分流，不改调用方两池语义。
 */
export type EngAssemblyDefSource =
  | Pick<RetrofitDef, 'name' | 'phases'>
  | Pick<ProjectV2Def, 'name' | 'modules'>;

/**
 * '工程' 投影项 → TwoStageSpec{tflops,tops}（需求侧声明，§3.5 算力永不作前置）：
 * 按投影项命名合同 `ref·段名` 解析静态段定义——V1 段=retrofit phase、V2 段=project module。
 */
export function engAssemblySpecFor(
  defs: ReadonlyArray<EngAssemblyDefSource>,
  txn: { type: string; item: string },
): { tflops?: number; tops?: number } | undefined {
  if (txn.type !== '工程') return undefined;
  const sep = txn.item.indexOf('·');
  if (sep <= 0 || sep === txn.item.length - 1) return undefined;
  const ref = txn.item.slice(0, sep);
  const partName = txn.item.slice(sep + 1);
  const def = Array.isArray(defs) ? defs.find(d => canon(d.name) === canon(ref)) : undefined;
  // V1 phases / V2 modules 同命名合同，统一按段名匹配取 workload（prereqs 拓扑边不参与匹配）
  const workload =
    def && 'phases' in def
      ? def.phases?.find((p: { name: string }) => canon(p.name) === canon(partName))?.workload
      : def && 'modules' in def
        ? def.modules.find((m: { name: string }) => canon(m.name) === canon(partName))?.workload
        : undefined;
  if (!workload) return undefined;
  const spec: { tflops?: number; tops?: number } = {};
  if (typeof workload.tflops === 'number' && workload.tflops > 0) spec.tflops = workload.tflops;
  if (typeof workload.tops === 'number' && workload.tops > 0) spec.tops = workload.tops;
  return spec.tflops !== undefined || spec.tops !== undefined ? spec : undefined;
}

/* ═══════════════ ⑧ 赤星天锤 3→6 轨道载荷扩容与补给计算（SOV-CODE-CAP-01） ═══════════════ */

export interface RedStarHammerPayloadOptions {
  /** 是否已完成扩仓改装模块（默认 false 为 3 枚上限，true 提升为 6 枚上限） */
  expanded?: boolean;
  /** 当前在轨弹药数量（缺省 0） */
  currentShells?: number;
  /** 本次补给/消耗变动量（正数为补弹，负数为消耗，缺省 0） */
  resupplyDelta?: number;
}

export interface RedStarHammerPayloadEvaluation {
  expanded: boolean;
  maxShells: 3 | 6;
  currentShells: number;
  nextShells: number;
  remainingCapacity: number;
}

export function evaluateRedStarHammerPayload(
  options: RedStarHammerPayloadOptions = {},
): RedStarHammerPayloadEvaluation {
  const expanded = Boolean(options.expanded);
  const maxShells: 3 | 6 = expanded ? 6 : 3;
  const clampedCurrent = Math.max(0, Math.min(maxShells, Math.trunc(options.currentShells ?? 0)));
  const delta = Math.trunc(options.resupplyDelta ?? 0);
  const nextShells = Math.max(0, Math.min(maxShells, clampedCurrent + delta));
  const remainingCapacity = maxShells - nextShells;

  return {
    expanded,
    maxShells,
    currentShells: clampedCurrent,
    nextShells,
    remainingCapacity,
  };
}

/* ═══════════════ ⑨ FD-22 现代化改装工程完工 ➔ 在役存量单位/建筑原位更名 ═══════════════ */

/** 单条升格规则：from（在役旧型号/母体建筑）→ to（upgraded_name） */
export interface RetrofitUpgradeRule {
  kind: 'unit' | 'building';
  from: string;
  to: string;
}

function toNameList(raw: string | readonly string[] | undefined): string[] {
  const list = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
  return list.map(s => s.trim()).filter(Boolean);
}

/**
 * 升格规则唯一来源：世界书 retrofit 条目自身的 target_unit / host_building / upgraded_name。
 * - 有 target_unit：单位改装（host_building 此时是施工厂房，不更名）；
 * - 仅 host_building：建筑改装；
 * - upgraded_name 为字符串时作用于全部目标，为映射表时按目标名取值（缺项不升格）。
 * 引擎（applyRetrofitCompletionUpgrade）与 UI 预览共用本函数。
 */
export function resolveRetrofitUpgradeRules(
  def: Pick<RetrofitDef, 'target_unit' | 'host_building' | 'upgraded_name'> | null | undefined,
): RetrofitUpgradeRule[] {
  if (!def || !def.upgraded_name) return [];
  const units = toNameList(def.target_unit);
  const kind: RetrofitUpgradeRule['kind'] = units.length > 0 ? 'unit' : 'building';
  const froms = units.length > 0 ? units : toNameList(def.host_building);
  const upgraded = def.upgraded_name;
  const rules: RetrofitUpgradeRule[] = [];
  for (const from of froms) {
    const to = (typeof upgraded === 'string' ? upgraded : (upgraded[from] ?? '')).trim();
    if (to && canon(to) !== canon(from)) rules.push({ kind, from, to });
  }
  return rules;
}
