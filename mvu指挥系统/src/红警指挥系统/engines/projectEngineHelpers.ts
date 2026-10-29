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

/** 可用纳米库存（裁量 g：全小类有限数求和，兼容数值型 nanites；null=未探明按 0，不降级） */
export function availableNanites(state: ProjectStateView): number {
  const nanites = state.economy?.resources?.nanites as unknown;
  if (typeof nanites === 'number') {
    return Number.isFinite(nanites) ? Math.max(0, nanites) : 0;
  }
  if (!nanites || typeof nanites !== 'object') return 0;
  return Object.values(nanites as Record<string, unknown>).reduce<number>(
    (sum, v) => sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0),
    0,
  );
}

const NANITE_DEDUCT_PRIORITY: readonly string[] = [
  '通用纳米工料',
  '标准纳米工料',
  '军工纳米工料',
  '特种纳米工料',
  '高精构造型纳米',
  '高能纳米工料',
  '机娘修复凝胶',
];

/** 真实从 economy.resources.nanites 扣减指定纳米数（SIM-NANITE-01，兼容数值与分小类对象，按低阶→高阶优先级扣减，绝不扣至负数） */
export function deductEconomyNanites(
  economy: ProjectStateView['economy'],
  naniteCost: number,
  nextCredits: number,
): NonNullable<ProjectStateView['economy']> {
  const baseEconomy = { ...(economy ?? {}), credits: nextCredits };
  if (!Number.isFinite(naniteCost) || naniteCost <= 0 || !baseEconomy.resources) {
    return baseEconomy;
  }
  const rawNanites = baseEconomy.resources.nanites as unknown;
  if (typeof rawNanites === 'number' && Number.isFinite(rawNanites)) {
    return {
      ...baseEconomy,
      resources: {
        ...baseEconomy.resources,
        nanites: Math.max(0, rawNanites - naniteCost) as unknown as NonNullable<
          NonNullable<ProjectStateView['economy']>['resources']
        >['nanites'],
      },
    };
  }
  if (!rawNanites || typeof rawNanites !== 'object') {
    return baseEconomy;
  }
  const nextNanites: Record<string, number | null | undefined> = {
    ...(rawNanites as Record<string, number | null | undefined>),
  };
  const prioritySet = new Set(NANITE_DEDUCT_PRIORITY);
  const orderedKeys = [
    ...NANITE_DEDUCT_PRIORITY.filter(k => Object.prototype.hasOwnProperty.call(nextNanites, k)),
    ...Object.keys(nextNanites).filter(k => !prioritySet.has(k)),
  ];
  let remaining = naniteCost;
  for (const k of orderedKeys) {
    if (remaining <= 0) break;
    const v = nextNanites[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      const take = Math.min(v, remaining);
      nextNanites[k] = Math.max(0, v - take);
      remaining -= take;
    }
  }
  return {
    ...baseEconomy,
    resources: {
      ...baseEconomy.resources,
      nanites: nextNanites as Record<string, number | null>,
    },
  };
}

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
      message: `阶段「${phaseLabel}」纳米开工门未过：需求 ${need} ＞ 可用纳米库存 ${stock}——开工门是门槛不是抵扣（D8b/§3.5），库存不会被扣减；阶段保持未启动、工程保持在建，备齐纳米后重发注资令`,
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

export interface RetrofitUpgradeSpec {
  research: string;
  target_unit?: readonly string[];
  host_building?: readonly string[];
  upgraded_name: string;
}

/** FD-22 内置 48 条现代化改装工程（46 条单位改装 + 2 条建筑改装）规格映射 */
export const BUILTIN_RETROFIT_UPGRADE_SPECS: Readonly<Record<string, RetrofitUpgradeSpec>> = {
  // ── 盟军 21 条单位现代化改装 + 2 条建筑改装 ──
  'M1A2 SEPv3灰熊混动改装工程': { research: 'M1A2 SEPv3灰熊混动改装包', target_unit: ['M1A1灰熊主战坦克'], upgraded_name: 'M1A2 SEPv3混动灰熊主战坦克' },
  M2A4布拉德利数字化改装工程: { research: 'M2A4布拉德利数字化改装包', target_unit: ['M2A3布拉德利步兵战车'], upgraded_name: 'M2A4布拉德利步兵战车' },
  M3A4布拉德利CFV侦察强化工程: { research: 'M3A4布拉德利CFV侦察强化包', target_unit: ['M3布拉德利CFV装甲侦察车'], upgraded_name: 'M3A4布拉德利CFV装甲侦察车' },
  M109A7帕拉丁自动化火炮改装工程: { research: 'M109A7帕拉丁自动化火炮改装包', target_unit: ['M109A6帕拉丁自行榴弹炮', 'M109A6帕拉丁自行火炮'], upgraded_name: 'M109A7帕拉丁自行榴弹炮' },
  M1130A1斯特赖克数字指挥车改装工程: { research: 'M1130A1斯特赖克数字指挥车改装包', target_unit: ['M1130斯特赖克指挥车'], upgraded_name: 'M1130A1斯特赖克数字指挥车' },
  M142海马斯增程火箭炮升级工程: { research: 'M142海马斯增程火箭炮升级包', target_unit: ['M142海马斯多管火箭车'], upgraded_name: 'M142海马斯增程多管火箭车' },
  有源相控阵机动雷达车改装工程: { research: '有源相控阵机动雷达车改装包', target_unit: ['机动雷达车'], upgraded_name: '有源相控阵机动雷达车' },
  'UH-60V黑鹰数字座舱改装工程': { research: 'UH-60V黑鹰数字座舱改装包', target_unit: ['UH-60M黑鹰通用直升机'], upgraded_name: 'UH-60V黑鹰数字化通用直升机' },
  'F-16V战隼航电武器升级工程': { research: 'F-16V战隼航电武器升级包', target_unit: ['F-16C战隼多用途战斗机', 'F-16C战隼'], upgraded_name: 'F-16V战隼多用途战斗机' },
  'F-15EX攻击鹰深度现代化改装工程': { research: 'F-15EX攻击鹰深度现代化改装包', target_unit: ['F-15E攻击鹰制空战斗轰炸机'], upgraded_name: 'F-15EX先进攻击鹰战斗轰炸机' },
  阵风F4标准升级工程: { research: '阵风F4标准升级包', target_unit: ['阵风多用途战斗机'], upgraded_name: '阵风F4多用途战斗机' },
  'AH-64E阿帕奇卫士升级工程': { research: 'AH-64E阿帕奇卫士升级包', target_unit: ['AH-64D阿帕奇长弓武装直升机'], upgraded_name: 'AH-64E阿帕奇卫士武装直升机' },
  'MQ-9B死神蜂群协同改装工程': { research: 'MQ-9B死神蜂群协同改装包', target_unit: ['MQ-9B死神战略侦察打击无人机'], upgraded_name: 'MQ-9B死神协同蜂群指挥无人机' },
  'XQ-58B女武神忠诚僚机升级工程': { research: 'XQ-58B女武神忠诚僚机升级包', target_unit: ['XQ-58A女武神无人协同战斗飞行器'], upgraded_name: 'XQ-58B女武神忠诚僚机' },
  'CH-47F Block II支奴干升级工程': { research: 'CH-47F Block II支奴干升级包', target_unit: ['CH-47F支奴干重型战术运输直升机'], upgraded_name: 'CH-47F Block II支奴干重型运输直升机' },
  'B-52J同温层堡垒延寿换发工程': { research: 'B-52J同温层堡垒延寿换发包', target_unit: ['B-52H同温层堡垒战略轰炸机'], upgraded_name: 'B-52J同温层堡垒战略轰炸机' },
  'DDG-51阿利·伯克级SPY-6升级工程': { research: 'DDG-51阿利·伯克级SPY-6升级包', target_unit: ['DDG-51阿利·伯克级宙斯盾驱逐舰'], upgraded_name: 'DDG-51阿利·伯克级驱逐舰(SPY-6现代改)' },
  'CG-47提康德罗加级宙斯盾基线9升级工程': { research: 'CG-47提康德罗加级宙斯盾基线9升级包', target_unit: ['CG-47提康德罗加级导弹巡洋舰'], upgraded_name: 'CG-47提康德罗加级巡洋舰(宙斯盾基线9)' },
  'SSN-688I改进型洛杉矶级静音升级工程': { research: 'SSN-688I改进型洛杉矶级静音升级包', target_unit: ['SSN-688洛杉矶级核动力攻击潜艇'], upgraded_name: 'SSN-688I改进型洛杉矶级攻击核潜艇' },
  'LHD-1黄蜂级F-35B甲板耐热改造工程': { research: 'LHD-1黄蜂级F-35B甲板耐热改造包', target_unit: ['LHD-1黄蜂级两栖攻击舰'], upgraded_name: 'LHD-1黄蜂级闪电航母(F-35B适配型)' },
  爱国者阵地增强改装工程: { research: '爱国者阵地增强改装', host_building: ['爱国者防空阵地', '爱国者导弹阵地'], upgraded_name: '爱国者PAC-3增强防空阵地' },
  电子战干扰站正式化改装工程: { research: '电子战体系研发', host_building: ['电子战干扰站'], upgraded_name: '全频谱电子战干扰站' },
  '小鹰级／尼米兹级电磁弹射现代化改装工程': { research: '航母电磁弹射改装工程研发', target_unit: ['CV-63小鹰级常规动力航空母舰', 'CVN-68尼米兹级核动力航空母舰'], upgraded_name: 'CVN-68尼米兹级核动力航母(电弹现代改)' },
  // ── 苏联 25 条单位现代化改装 ──
  犀牛坦克现代改装套件工程: { research: '犀牛坦克现代改装套件研发', target_unit: ['犀牛主战坦克族'], upgraded_name: '犀牛主战坦克·接触-5现代改' },
  天启坦克现代改装套件工程: { research: '天启坦克现代改装套件研发', target_unit: ['天启重型坦克'], upgraded_name: '天启决战型重型坦克' },
  基洛夫空艇重装现代改装工程: { research: '基洛夫空艇重装现代改装研发', target_unit: ['基洛夫空中无人机武库母舰'], upgraded_name: '基洛夫重装蜂群武库母舰' },
  无畏级导弹舰现代改装工程: { research: '无畏级导弹舰现代改装研发', target_unit: ['无畏级重型导弹支援舰'], upgraded_name: '无畏级重型通用垂发支援舰' },
  '11442M基洛夫级巡洋舰现代改装工程': { research: '11442M基洛夫级巡洋舰现代改装研发', target_unit: ['基洛夫级核动力导弹巡洋舰'], upgraded_name: '11442M基洛夫级核动力导弹巡洋舰' },
  '2S19M2自行火炮数字化改装工程': { research: '2S19M2自行火炮数字化改装研发', target_unit: ['2S3／2S19 Msta自行榴弹炮族'], upgraded_name: '2S19M2「姆斯塔-SM2」数字化自行榴弹炮' },
  'T-72B3M重装反应装甲改装工程': { research: 'T-72B3M重装反应装甲改装研发', target_unit: ['T-72B3M主战坦克'], upgraded_name: 'T-72B3M重装反应装甲型主战坦克' },
  'T-90M2主战坦克决战改装工程': { research: 'T-90M2主战坦克决战改装研发', target_unit: ['T-90M主战坦克'], upgraded_name: 'T-90M2「突破-3」决战主战坦克' },
  'T-80BVM寒区突击改装工程': { research: 'T-80BVM寒区突击改装研发', target_unit: ['T-80BVM主战坦克', '寒区突击坦克族'], upgraded_name: 'T-80BVM改进型寒区突击主战坦克' },
  'BMP-3M数字化步兵战车改装工程': { research: 'BMP-3M数字化步兵战车改装研发', target_unit: ['履带步兵战车族'], upgraded_name: 'BMP-3M「德拉贡」数字化步兵战车族' },
  'BTR-EW全谱网电装甲车改装工程': { research: 'BTR-EW全谱网电装甲车改装研发', target_unit: ['BTR-EW战术网电装甲车'], upgraded_name: 'BTR-EW「火花-M」全谱网电装甲车' },
  'TOS-1AM热压攻坚重装改装工程': { research: 'TOS-1AM热压攻坚重装改装研发', target_unit: ['TOS热压攻坚族（TOS-1A／TOS-2）'], upgraded_name: 'TOS-1AM重装甲热压攻坚族' },
  'Su-30SM2航电火控升级工程': { research: 'Su-30SM2航电火控升级研发', target_unit: ['Su-30SM多任务战斗机'], upgraded_name: 'Su-30SM2多任务战斗机' },
  'Su-34M防区外打击升级工程': { research: 'Su-34M防区外打击升级研发', target_unit: ['Su-34防区外打击战斗轰炸机'], upgraded_name: 'Su-34M防区外打击战斗轰炸机' },
  'MiG-31BSM远程截击升级工程': { research: 'MiG-31BSM远程截击升级研发', target_unit: ['MiG-31BM高速截击机'], upgraded_name: 'MiG-31BSM数字化高速截击机' },
  'Ka-52M／Mi-28NM旋翼机光电升级工程': { research: 'Ka-52M／Mi-28NM旋翼机光电升级研发', target_unit: ['旋翼机族'], upgraded_name: 'Ka-52M／Mi-28NM光电增强旋翼机族' },
  '1155M型驱逐舰多用途改装工程': { research: '1155M型驱逐舰多用途改装研发', target_unit: ['1155M型反潜驱逐舰'], upgraded_name: '1155M「沙波什尼科夫元帅」级多用途驱逐舰' },
  '971M型核潜艇静音与巡航导弹改装工程': { research: '971M型核潜艇静音与巡航导弹改装研发', target_unit: ['971型攻击核潜艇'], upgraded_name: '971M「猎豹」级静音多用途攻击核潜艇' },
  '铠甲-SM／道尔-M2U伴随防空升级工程': { research: '铠甲-SM／道尔-M2U伴随防空升级研发', target_unit: ['战区机动与末端伴随防空族'], upgraded_name: '铠甲-SM／道尔-M2U自主伴随防空族' },
  'BTR-82AT轮式装甲输送车数字化改装工程': { research: 'BTR-82AT轮式装甲输送车数字化改装研发', target_unit: ['轮式装甲输送车族'], upgraded_name: 'BTR-82AT数字化轮式步兵战车族' },
  'Tornado-G火箭炮自动火控改装工程': { research: 'Tornado-G火箭炮自动火控改装研发', target_unit: ['Tornado-G火箭炮'], upgraded_name: 'Tornado-G自动火控模块化火箭炮' },
  '恐怖机器人拆解/磁锁双模改装工程': { research: '恐怖机器人拆解/磁锁双模改装研发', target_unit: ['恐怖机器人·拆解爆破型'], upgraded_name: '恐怖机器人·拆解/磁锁双模战备型' },
  '877型潜艇636.3静音与口径改装工程': { research: '877型潜艇636.3静音与口径改装研发', target_unit: ['877型常规潜艇'], upgraded_name: '636.3「华沙女人」级改进型静音潜艇' },
  '海雕-10／30无人侦察体系数字升级工程': { research: '海雕-10／30无人侦察体系数字升级研发', target_unit: ['无人航空体系族'], upgraded_name: '海雕-30M数字火控校射无人机体系族' },
  '赤星天锤3→6枚扩仓改装模块': { research: '常规轨道动能打击系统研发', target_unit: ['赤星天锤常规战略载荷'], upgraded_name: '赤星天锤常规战略载荷(6枚扩仓型)' },
};

function resolveUpgradedUnitNameForTarget(spec: RetrofitUpgradeSpec, matchedTarget: string): string {
  if (
    spec.research === '航母电磁弹射改装工程研发' &&
    canon(matchedTarget) === canon('CV-63小鹰级常规动力航空母舰')
  ) {
    return 'CV-63小鹰级航空母舰(电弹现代改)';
  }
  return spec.upgraded_name;
}

function upgradeUnitTokenList(
  list: ReadonlyArray<string> | undefined,
  spec: RetrofitUpgradeSpec,
): { list: string[]; changed: boolean } {
  if (!list || !spec.target_unit?.length) return { list: list ? [...list] : [], changed: false };
  let changed = false;
  const next = list.map(token => {
    const trimmed = token.trim();
    for (const target of spec.target_unit!) {
      if (canon(trimmed) === canon(target)) {
        changed = true;
        return resolveUpgradedUnitNameForTarget(spec, target);
      }
      if (trimmed.startsWith(target)) {
        const rest = trimmed.slice(target.length);
        if (!rest || /^[\s(（×xX*]/.test(rest)) {
          changed = true;
          return `${resolveUpgradedUnitNameForTarget(spec, target)}${rest}`;
        }
      }
    }
    return token;
  });
  return { list: next, changed };
}

function upgradeUnitRecord(
  record: Readonly<Record<string, number>> | undefined,
  spec: RetrofitUpgradeSpec,
): { record: Record<string, number>; changed: boolean } {
  if (!record || !spec.target_unit?.length) return { record: record ? { ...record } : {}, changed: false };
  let changed = false;
  const next: Record<string, number> = {};
  for (const [k, count] of Object.entries(record)) {
    const matched = spec.target_unit.find(t => canon(t) === canon(k));
    if (matched) {
      changed = true;
      const newKey = resolveUpgradedUnitNameForTarget(spec, matched);
      next[newKey] = (next[newKey] ?? 0) + count;
    } else {
      next[k] = (next[k] ?? 0) + count;
    }
  }
  return { record: next, changed };
}

/**
 * 当现代化改装工程（ProjectV1）完工时，自动将 state.forces、state.bases[].forces 与 state.bases[].buildings
 * 中的存量旧型号单位/母体建筑原位更名为 upgraded_name（FD-22 · D-UNIT-MOD-02）。
 */
export function applyRetrofitCompletionUpgrade<S extends ProjectStateView>(
  state: S,
  completedRefs: ReadonlyArray<{ ref: string; lead_base: string }>,
): S {
  if (!completedRefs.length) return state;
  let nextForces = state.forces;
  let nextBases = state.bases;

  for (const { ref, lead_base } of completedRefs) {
    const spec = BUILTIN_RETROFIT_UPGRADE_SPECS[ref] ?? BUILTIN_RETROFIT_UPGRADE_SPECS[ref.trim()];
    if (!spec) continue;

    // 1. 升级全局 forces 中的在役存量单位
    if (nextForces && spec.target_unit?.length) {
      let forcesChanged = false;
      const updatedForces: Record<string, unknown> = { ...nextForces };

      if (Array.isArray(nextForces.vehicles)) {
        const res = upgradeUnitTokenList(nextForces.vehicles, spec);
        if (res.changed) {
          updatedForces.vehicles = res.list;
          forcesChanged = true;
        }
      }
      if (Array.isArray(nextForces.aircraft)) {
        const res = upgradeUnitTokenList(nextForces.aircraft, spec);
        if (res.changed) {
          updatedForces.aircraft = res.list;
          forcesChanged = true;
        }
      }
      if (nextForces.troops) {
        const res = upgradeUnitRecord(nextForces.troops, spec);
        if (res.changed) {
          updatedForces.troops = res.record;
          forcesChanged = true;
        }
      }
      if (nextForces.infantry) {
        const res = upgradeUnitRecord(nextForces.infantry, spec);
        if (res.changed) {
          updatedForces.infantry = res.record;
          forcesChanged = true;
        }
      }
      if (Array.isArray(nextForces.girls)) {
        let girlsChanged = false;
        const nextGirls = nextForces.girls.map(g => {
          const model = typeof g.model === 'string' ? g.model.trim() : '';
          const matched = spec.target_unit?.find(t => canon(t) === canon(model));
          if (matched) {
            girlsChanged = true;
            return { ...g, model: resolveUpgradedUnitNameForTarget(spec, matched) };
          }
          return g;
        });
        if (girlsChanged) {
          updatedForces.girls = nextGirls;
          forcesChanged = true;
        }
      }
      if (forcesChanged) {
        nextForces = updatedForces as S['forces'];
      }
    }

    // 2. 升级各基地驻军 forces 与建筑改装目标（如爱国者阵地增强改装工程、电子战干扰站正式化改装工程）
    if (nextBases) {
      let basesChanged = false;
      const updatedBases = nextBases.map(base => {
        let baseChanged = false;
        let bBuildings = base.buildings;
        let bForces = base.forces;

        if (
          spec.host_building?.length &&
          bBuildings &&
          (!lead_base || base.id === lead_base || canon(base.name ?? '') === canon(lead_base))
        ) {
          const nextBlds = bBuildings.map(bd => {
            if (spec.host_building!.some(h => canon(h) === canon(bd.name))) {
              baseChanged = true;
              return { ...bd, name: spec.upgraded_name };
            }
            return bd;
          });
          if (baseChanged) bBuildings = nextBlds;
        }

        if (bForces && spec.target_unit?.length) {
          let bfChanged = false;
          const nextBf = { ...bForces };
          if (Array.isArray(bForces.vehicles)) {
            const res = upgradeUnitTokenList(bForces.vehicles, spec);
            if (res.changed) {
              nextBf.vehicles = res.list;
              bfChanged = true;
            }
          }
          if (Array.isArray(bForces.aircraft)) {
            const res = upgradeUnitTokenList(bForces.aircraft, spec);
            if (res.changed) {
              nextBf.aircraft = res.list;
              bfChanged = true;
            }
          }
          if (bForces.troops) {
            const res = upgradeUnitRecord(bForces.troops, spec);
            if (res.changed) {
              nextBf.troops = res.record;
              bfChanged = true;
            }
          }
          if (bForces.infantry) {
            const res = upgradeUnitRecord(bForces.infantry, spec);
            if (res.changed) {
              nextBf.infantry = res.record;
              bfChanged = true;
            }
          }
          if (bfChanged) {
            bForces = nextBf;
            baseChanged = true;
          }
        }

        if (!baseChanged) return base;
        basesChanged = true;
        return {
          ...base,
          ...(bBuildings !== base.buildings ? { buildings: bBuildings } : {}),
          ...(bForces !== base.forces ? { forces: bForces } : {}),
        };
      });
      if (basesChanged) nextBases = updatedBases;
    }
  }

  if (nextForces === state.forces && nextBases === state.bases) return state;
  return {
    ...state,
    ...(nextForces !== state.forces ? { forces: nextForces } : {}),
    ...(nextBases !== state.bases ? { bases: nextBases } : {}),
  };
}

