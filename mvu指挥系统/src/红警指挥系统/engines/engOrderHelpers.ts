/**
 * engOrderHelpers.ts —— 工程与科研观察者投影、指令校验与调度总线动词对齐辅助（UTO-UI-DOMAIN-01）
 *
 * 从 engOrderBridge.ts 拆出：
 * - 工程事件转 ParseEvent 格式化辅助（projectEventToParseEvent）
 * - 工程车间（ModalEngineering）与科技树（ModalTechTree）UTO 只读观察者投影视图
 * - 工程面板动作与 UnifiedDispatchBus 动词对齐及指令文本拼装校验
 */

import type { BuildingDef, FactionDef, ProductionDef, ProjectDef, ResearchDef, RetrofitDef } from '../core/catalog';
import type { EffectiveCatalog } from '../core/catalogEffective';
import type { Project } from '../core/schema';
import { canon, type EngOrder, type ParseEvent } from '../parse/parsePipeline';
import {
  fromEngineeringOrder,
  toEngineeringCommandText,
  toEngineeringOrder,
  type EngineeringDispatchOrderInput,
  type UnifiedCommand,
  type UnifiedCommandType,
} from './dispatchBus';
import {
  createLaneRegistryHub,
  EngineeringLaneProvider,
  ResearchLaneProvider,
  type LaneRegistryHub,
} from './laneProviders';
import {
  type LaneResolveEnv,
  type LaneStationView,
  type TaskDomain,
  type TaskStatus,
  type UnifiedTask,
} from './taskOrchestrator';
import { toUnifiedTasks, type ProjectionStateInput } from './taskProjectionAdapter';

/** projectEngine ProjectEvent → ParseEvent（镜像 settleFloor ④‴ 里程碑回写映射口径） */
export function projectEventToParseEvent(e: { type: string; item: string; detail?: string }): ParseEvent {
  return {
    light: e.type === 'sync_warn' ? '🟡' : '🟢',
    layer: 'instruction',
    message: `[工程] ${e.type}「${e.item}」${e.detail ? `：${e.detail}` : ''}`,
    path: 'projects',
  };
}

/* ═══════════════ UTO-UI-DOMAIN-01 · 工程与科研观察者投影及指令发起对齐 ═══════════════ */

/** 领域观察者共享只读工位注册中心（封装制造 9 产线 + 科研 11 序列 + 工程双槽） */
export const domainLaneRegistryHub: LaneRegistryHub = createLaneRegistryHub();

/** 工程工位专用提供者实例 */
export const defaultEngineeringLaneProvider = new EngineeringLaneProvider();

/** 科研序列工位专用提供者实例 */
export const defaultResearchLaneProvider = new ResearchLaneProvider();

/** 观察者投影输入的最小状态快照（兼容 Schema、SchedulePanelInput 与双账本） */
export interface DomainObserverStateInput {
  bases?: ReadonlyArray<{
    id?: string;
    name?: string;
    status?: string;
    buildings?: ReadonlyArray<{ name?: string; state?: string; mode?: string }>;
  }>;
  queues?: ProjectionStateInput['queues'];
  projects?: ReadonlyArray<Project>;
}

/** 观察者投影输入的目录快照（允许部分目录传入，缺省字段自动补空数组） */
export interface DomainObserverCatalogInput {
  buildings?: ReadonlyArray<BuildingDef>;
  productions?: ReadonlyArray<ProductionDef>;
  researches?: ReadonlyArray<ResearchDef>;
  retrofits?: ReadonlyArray<RetrofitDef>;
  projects?: ReadonlyArray<ProjectDef>;
  factionDefs?: ReadonlyArray<FactionDef>;
}

/** 单个 UnifiedTask 的观察者派生指标（与 schedulePanelModel 100% 同源） */
export interface UtoTaskObserverMetrics {
  taskId: string;
  name: string;
  domain: TaskDomain;
  laneKey: string;
  status: TaskStatus;
  spentMinutes: number;
  totalMinutes: number;
  progressPct: number;
  held: boolean;
  settling: boolean;
  draft: boolean;
  leadBaseId?: string;
  eta?: string;
  dependsOn: string[];
  queueIndex?: number;
  projectId?: string;
  phaseIdx?: number;
  moduleId?: string;
  sourceKind?: string;
}

/** 工程车间（ModalEngineering）UTO 只读观察者投影视图 */
export interface EngineeringObserverView {
  /** 属地工程工位快照（eng.main 通用工程槽 / eng.orbital 轨道组装泊位） */
  stations: LaneStationView[];
  /** 全量 UTO 任务投影 */
  allTasks: UnifiedTask[];
  /** 工程领域任务投影（含 project_root / project_phase / project_module） */
  engineeringTasks: UnifiedTask[];
  /** 在途/候列/暂缓/待收讫工程任务（active / queued / held / settling，与 schedulePanelModel 同源） */
  scheduledEngineeringTasks: UnifiedTask[];
  /** 规划态未启动工程子任务（status === 'draft'，含 dependsOn 拓扑链） */
  draftEngineeringTasks: UnifiedTask[];
  /** 按 taskId 索引的观察者指标 */
  metricsById: Record<string, UtoTaskObserverMetrics>;
  /** 按 `${projectId}:phase:${phaseIdx}` 索引的 V1 阶段观察者指标 */
  phaseMetricsByKey: Record<string, UtoTaskObserverMetrics>;
  /** 按 `${projectId}:mod:${moduleId}` 索引的 V2 模块观察者指标 */
  moduleMetricsByKey: Record<string, UtoTaskObserverMetrics>;
}

/** 科技树（ModalTechTree）单科研序列观察行 */
export interface TechSlotObserverRow {
  laneKey: string;
  slotId: string;
  displayName: string;
  unlocked: boolean;
  capacity: number;
  globalLimit: number;
  lockedReason?: string;
  station: LaneStationView;
  tasks: UtoTaskObserverMetrics[];
  activeCount: number;
  queuedCount: number;
  heldCount: number;
  settlingCount: number;
}

/** 科技树（ModalTechTree）UTO 只读观察者投影视图 */
export interface TechTreeObserverView {
  /** 11 大科研序列工位快照（ResearchLaneProvider 输出） */
  stations: LaneStationView[];
  /** 11 大科研序列观察者聚合行 */
  slots: TechSlotObserverRow[];
  /** 科研领域全量 UnifiedTask 投影 */
  researchTasks: UnifiedTask[];
  /** 在途/候列/暂缓/待收讫科研任务指标（与 schedulePanelModel.researchSlots 同源） */
  scheduledResearchTasks: UtoTaskObserverMetrics[];
  /** 按课题名称（canon 归一与原名双键）索引的科研任务观察者指标 */
  taskByResearchName: Record<string, UtoTaskObserverMetrics>;
}

function toEffectiveCatalogView(catalog?: DomainObserverCatalogInput | EffectiveCatalog | null): EffectiveCatalog {
  return {
    buildings: [...(catalog?.buildings ?? [])],
    productions: [...(catalog?.productions ?? [])],
    researches: [...(catalog?.researches ?? [])],
    retrofits: [...(catalog?.retrofits ?? [])],
    projects: [...(catalog?.projects ?? [])],
    factionDefs: [...(catalog?.factionDefs ?? [])],
    protocols: [...(catalog && 'protocols' in catalog && Array.isArray(catalog.protocols) ? catalog.protocols : [])],
  };
}

function toNormalizedBases(bases: DomainObserverStateInput['bases']): LaneResolveEnv['bases'] {
  return (bases ?? []).map(b => ({
    id: b.id,
    name: b.name,
    status: b.status,
    buildings: (b.buildings ?? []).map(bd => ({
      name: bd.name ?? '',
      state: bd.state,
      mode: bd.mode,
    })),
  }));
}

function toNormalizedQueues(queues: DomainObserverStateInput['queues']): NonNullable<ProjectionStateInput['queues']> {
  return (queues ?? []).map(q => {
    const raw = q as unknown as Record<string, unknown>;
    const item = typeof raw.item === 'string' ? raw.item : typeof raw.name === 'string' ? raw.name : '';
    return {
      ...(q as NonNullable<ProjectionStateInput['queues']>[number]),
      item,
    };
  });
}

function isScheduledTask(task: UnifiedTask): boolean {
  if (task.metadata?.sourceKind === 'project_root') return false;
  if (task.metadata?.syncWarn === true && task.metadata?.queueIndex === undefined) return false;
  return task.status === 'active' || task.status === 'settling' || task.status === 'queued' || task.status === 'held';
}

/**
 * 将单个 `UnifiedTask` 转换为前端观察者指标（纯函数，零副作用）。
 */
export function toTaskObserverMetrics(task: UnifiedTask): UtoTaskObserverMetrics {
  const spentMinutes = task.workload.spentMinutes;
  const totalMinutes = task.workload.totalMinutes;
  const progressPct =
    task.status === 'completed' || task.status === 'settling'
      ? 100
      : totalMinutes > 0
        ? Math.min(100, Math.max(0, Math.round((spentMinutes / totalMinutes) * 100)))
        : 0;

  return {
    taskId: task.id,
    name: task.name,
    domain: task.domain,
    laneKey: task.laneKey,
    status: task.status,
    spentMinutes,
    totalMinutes,
    progressPct,
    held: task.status === 'held',
    settling: task.status === 'settling',
    draft: task.status === 'draft',
    ...(task.leadBaseId !== undefined ? { leadBaseId: task.leadBaseId } : {}),
    ...(typeof task.metadata?.eta === 'string' && task.metadata.eta.length > 0 ? { eta: task.metadata.eta } : {}),
    dependsOn: [...(task.topology?.dependsOn ?? [])],
    ...(typeof task.metadata?.queueIndex === 'number' ? { queueIndex: task.metadata.queueIndex } : {}),
    ...(typeof task.metadata?.projectId === 'string' ? { projectId: task.metadata.projectId } : {}),
    ...(typeof task.metadata?.phaseIdx === 'number' ? { phaseIdx: task.metadata.phaseIdx } : {}),
    ...(typeof task.metadata?.moduleId === 'string' ? { moduleId: task.metadata.moduleId } : {}),
    ...(typeof task.metadata?.sourceKind === 'string' ? { sourceKind: task.metadata.sourceKind } : {}),
  };
}

/**
 * 构建工程车间（ModalEngineering）的 UTO 只读观察者投影视图：
 * - 通过 `EngineeringLaneProvider` / `LaneRegistryHub` 派生各基地 `eng.main` 与 `eng.orbital` 工位快照；
 * - 通过 `toUnifiedTasks` 单向只读投影归一化 `queues[]` 与 `projects[]`（V1 阶段＋V2 模块）；
 * - 产出的 `spentMinutes / totalMinutes / status / held / settling / draft` 与 `schedulePanelModel` 100% 同源。
 */
export function projectEngineeringObserverView(
  state: DomainObserverStateInput | null | undefined,
  catalog?: DomainObserverCatalogInput | EffectiveCatalog | null,
): EngineeringObserverView {
  const safeState = state ?? {};
  const effectiveCat = toEffectiveCatalogView(catalog);
  const normalizedBases = toNormalizedBases(safeState.bases);
  const normalizedQueues = toNormalizedQueues(safeState.queues);
  const env: LaneResolveEnv = {
    bases: normalizedBases,
    queues: normalizedQueues as LaneResolveEnv['queues'],
    catalog: effectiveCat,
  };

  const allStations = domainLaneRegistryHub.resolveAllLanes(env);
  const stations = defaultEngineeringLaneProvider.resolveLanes(env);
  const allTasks = toUnifiedTasks(
    {
      bases: normalizedBases,
      queues: normalizedQueues,
      projects: safeState.projects,
    },
    effectiveCat,
    allStations,
  );

  const engineeringTasks = allTasks.filter(
    t =>
      t.domain === 'megastructure' ||
      (t.domain === 'retrofit' &&
        (t.metadata?.sourceKind === 'project_root' ||
          t.metadata?.sourceKind === 'project_phase' ||
          t.metadata?.sourceKind === 'project_module' ||
          t.metadata?.rawType === '工程' ||
          t.laneKey.includes('eng:'))),
  );

  const scheduledEngineeringTasks = engineeringTasks.filter(isScheduledTask);
  const draftEngineeringTasks = engineeringTasks.filter(
    t => t.metadata?.sourceKind !== 'project_root' && t.status === 'draft',
  );

  const metricsById: Record<string, UtoTaskObserverMetrics> = {};
  const phaseMetricsByKey: Record<string, UtoTaskObserverMetrics> = {};
  const moduleMetricsByKey: Record<string, UtoTaskObserverMetrics> = {};

  for (const task of allTasks) {
    const m = toTaskObserverMetrics(task);
    metricsById[task.id] = m;
    if (m.projectId !== undefined && m.phaseIdx !== undefined) {
      phaseMetricsByKey[`${m.projectId}:phase:${m.phaseIdx}`] = m;
    }
    if (m.projectId !== undefined && m.moduleId !== undefined) {
      moduleMetricsByKey[`${m.projectId}:mod:${m.moduleId}`] = m;
    }
  }

  return {
    stations,
    allTasks,
    engineeringTasks,
    scheduledEngineeringTasks,
    draftEngineeringTasks,
    metricsById,
    phaseMetricsByKey,
    moduleMetricsByKey,
  };
}

/** 查询指定 V1 工程阶段的 UTO 观察者指标 */
export function findPhaseObserverMetrics(
  view: EngineeringObserverView,
  projectId: string,
  phaseIdx: number,
): UtoTaskObserverMetrics | null {
  return (
    view.phaseMetricsByKey[`${projectId}:phase:${phaseIdx}`] ??
    view.metricsById[`task:proj:${projectId}:phase:${phaseIdx}`] ??
    null
  );
}

/** 查询指定 V2 工程模块的 UTO 观察者指标 */
export function findModuleObserverMetrics(
  view: EngineeringObserverView,
  projectId: string,
  moduleId: string,
): UtoTaskObserverMetrics | null {
  return (
    view.moduleMetricsByKey[`${projectId}:mod:${moduleId}`] ??
    view.metricsById[`task:proj:${projectId}:mod:${moduleId}`] ??
    null
  );
}

/**
 * 构建科技树面板（ModalTechTree）的 UTO 只读观察者投影视图：
 * - 通过 `ResearchLaneProvider` / `LaneRegistryHub` 派生 11 大科研序列工位快照；
 * - 通过 `toUnifiedTasks` 提取在研课题的 `UnifiedTask` 投影（进度、`held`、`settling` 同源对齐）。
 */
export function projectTechTreeObserverView(
  state: DomainObserverStateInput | null | undefined,
  catalog?: DomainObserverCatalogInput | EffectiveCatalog | null,
): TechTreeObserverView {
  const safeState = state ?? {};
  const effectiveCat = toEffectiveCatalogView(catalog);
  const normalizedBases = toNormalizedBases(safeState.bases);
  const normalizedQueues = toNormalizedQueues(safeState.queues);
  const env: LaneResolveEnv = {
    bases: normalizedBases,
    queues: normalizedQueues as LaneResolveEnv['queues'],
    catalog: effectiveCat,
  };

  const allStations = domainLaneRegistryHub.resolveAllLanes(env);
  const stations = defaultResearchLaneProvider.resolveLanes(env);
  const allTasks = toUnifiedTasks(
    {
      bases: normalizedBases,
      queues: normalizedQueues,
      projects: safeState.projects,
    },
    effectiveCat,
    allStations,
  );

  const researchTasks = allTasks.filter(t => t.domain === 'research');
  const scheduledTasks = researchTasks.filter(isScheduledTask);

  const scheduledResearchTasks: UtoTaskObserverMetrics[] = [];
  const taskByResearchName: Record<string, UtoTaskObserverMetrics> = {};
  const byLaneKey = new Map<string, UtoTaskObserverMetrics[]>();

  // 按 active/settling 在前、queued/held 在后排序（与 schedulePanelModel 严格同序）
  const orderedScheduled = [
    ...scheduledTasks.filter(t => t.status === 'active' || t.status === 'settling'),
    ...scheduledTasks.filter(t => t.status === 'queued' || t.status === 'held'),
  ];

  for (const task of orderedScheduled) {
    const metrics = toTaskObserverMetrics(task);
    scheduledResearchTasks.push(metrics);
    taskByResearchName[task.name] = metrics;
    taskByResearchName[canon(task.name)] = metrics;
    const bucket = byLaneKey.get(task.laneKey) ?? [];
    bucket.push(metrics);
    byLaneKey.set(task.laneKey, bucket);
  }

  const slots: TechSlotObserverRow[] = stations.map(station => {
    const slotId = station.laneKey.replace(/^research:/, '');
    const unlocked = !station.locked && station.capacity > 0;
    const slotTasks = byLaneKey.get(station.laneKey) ?? [];
    const activeCount = slotTasks.filter(t => t.status === 'active' || t.status === 'settling').length;
    const queuedCount = slotTasks.filter(t => t.status === 'queued' || t.status === 'held').length;
    const heldCount = slotTasks.filter(t => t.held).length;
    const settlingCount = slotTasks.filter(t => t.settling).length;

    return {
      laneKey: station.laneKey,
      slotId,
      displayName: station.displayName,
      unlocked,
      capacity: unlocked ? station.capacity : 0,
      globalLimit: station.globalLimit ?? Number.POSITIVE_INFINITY,
      ...(unlocked ? {} : { lockedReason: station.lockedReason }),
      station,
      tasks: slotTasks,
      activeCount,
      queuedCount,
      heldCount,
      settlingCount,
    };
  });

  return {
    stations,
    slots,
    researchTasks,
    scheduledResearchTasks,
    taskByResearchName,
  };
}

/** 工程面板动作动词（覆盖暂停/恢复/取消/注资/基地指派） */
export type EngDispatchActionVerb = '暂停' | '恢复' | '取消' | '注资' | '指派' | '分配';

/** 工程面板动作向 UnifiedDispatchBus 对齐的输入参数 */
export interface EngDispatchActionInput {
  verb: EngDispatchActionVerb;
  /** 工程实例 ID（如 "proj:空间站仓段化工程@beipo"） */
  projectId: string;
  /** V1 阶段序号（阶段级注资时传入；null 表示工程级操作） */
  phaseIdx?: number | null;
  /** V2 模块 ID（模块级操作时传入） */
  moduleId?: string;
  /** V2 模块显示名（对人友好的自然语言模板定位名） */
  moduleName?: string;
  /** 目标承建基地（Allocate 基地指派时传入） */
  baseId?: string;
  /** 是否属于 V2 工程级入口（为 true 时工程级注资按契约抛 RangeError） */
  isV2ProjectLevel?: boolean;
}

/** 工程动作与 UnifiedDispatchBus 动词对齐产物 */
export interface EngDispatchActionAlignment {
  /** 映射后的 UnifiedDispatchBus 标准动词类型（Hold / Resume / Cancel / Allocate） */
  commandType: UnifiedCommandType;
  /** 经 dispatchBus.fromEngineeringOrder 映射的统一调度命令集 */
  commands: UnifiedCommand[];
  /** 反向转译的结构化 EngOrder */
  engOrder: EngOrder;
  /** 拼装出的标准战术指令文本（回填 #send_textarea） */
  commandText: string;
}

/** 校验指令单行 token（与 engCommands.ts fail-closed 规则一致） */
export function assertSafeCommandToken(kind: string, raw: string, extraForbidden: RegExp | null = null): string {
  const v = (raw ?? '').trim();
  if (!v) throw new RangeError(`${kind}不能为空`);
  if (/\s/.test(v)) throw new RangeError(`${kind}含空白字符，会破坏指令分词：「${v}」`);
  // eslint-disable-next-line no-control-regex -- 显式拦截控制字符（fail-closed）
  if (/[\0-\x1f\x7f]/.test(v)) throw new RangeError(`${kind}含控制字符：「${v}」`);
  if (extraForbidden && extraForbidden.test(v)) throw new RangeError(`${kind}含非法字符：「${v}」`);
  return v;
}

/**
 * 将工程操作动词映射为 `UnifiedDispatchBus` 标准动词类型（`Hold / Resume / Cancel / Allocate`）。
 */
export function engVerbToUnifiedCommandType(verb: EngDispatchActionVerb): UnifiedCommandType {
  switch (verb) {
    case '暂停':
      return 'Hold';
    case '恢复':
      return 'Resume';
    case '取消':
      return 'Cancel';
    case '注资':
    case '指派':
    case '分配':
      return 'Allocate';
  }
}

/**
 * 将工程车间动作（暂停 / 恢复 / 取消 / 模块注资 / 基地指派）与 `UnifiedDispatchBus` 动词严格对齐：
 * - 复用 `dispatchBus.ts` 的 `fromEngineeringOrder`、`toEngineeringOrder` 与 `toEngineeringCommandText`；
 * - 保证暂停 → `Hold`、恢复 → `Resume`、取消 → `Cancel`、基地指派/模块准入 → `Allocate`；
 * - 产出标准 `【工程指令】...` 战术指令文本，100% 兼容 `engCommands.ts` 模板与 fail-closed 校验。
 */
export function alignEngineeringActionWithDispatchBus(
  input: EngDispatchActionInput,
  tasks: readonly UnifiedTask[] = [],
): EngDispatchActionAlignment {
  if (input.isV2ProjectLevel && input.verb === '注资') {
    throw new RangeError('仓段化工程注资是模块级指令——请用 buildOrderForV2ModuleButton（模块名定位）');
  }

  const projectId = assertSafeCommandToken('工程实例名', input.projectId);
  const commandType = engVerbToUnifiedCommandType(input.verb);

  const hasModule = input.moduleName !== undefined || input.moduleId !== undefined;
  const moduleName =
    input.moduleName !== undefined
      ? assertSafeCommandToken('模块名', input.moduleName, /[「」@]/)
      : input.moduleId !== undefined
        ? assertSafeCommandToken('模块名', input.moduleId, /[「」@]/)
        : undefined;
  const moduleKey = input.moduleId?.trim() || moduleName;

  const hasPhase = input.phaseIdx !== undefined && input.phaseIdx !== null;
  if (hasPhase) {
    if (!Number.isInteger(input.phaseIdx) || (input.phaseIdx ?? -1) < 0) {
      throw new RangeError(`阶段号必须为 ≥0 的整数（ProjectPhase.idx 口径），收到：${input.phaseIdx}`);
    }
  }

  const baseId = input.baseId !== undefined ? assertSafeCommandToken('基地', input.baseId) : undefined;

  // 1. 构造 EngineeringDispatchOrderInput 并经 dispatchBus.fromEngineeringOrder 生成 UnifiedCommand[]
  const dispatchInput: EngineeringDispatchOrderInput = {
    verb: input.verb,
    id: projectId,
    ...(moduleKey !== undefined ? { module: moduleKey } : {}),
    ...(hasPhase ? { phase: input.phaseIdx as number } : {}),
    ...(baseId !== undefined ? { base: baseId } : {}),
  };

  let commands = fromEngineeringOrder(dispatchInput, tasks);
  if (commands.length === 0) {
    const fallbackTaskId =
      moduleKey !== undefined
        ? `task:proj:${projectId}:mod:${moduleKey}`
        : hasPhase
          ? `task:proj:${projectId}:phase:${input.phaseIdx}`
          : `task:proj:${projectId}`;
    commands = [
      commandType === 'Allocate'
        ? { type: 'Allocate', taskId: fallbackTaskId, baseId: baseId ?? '' }
        : { type: commandType, taskId: fallbackTaskId },
    ];
  }

  // 2. 经 dispatchBus.toEngineeringOrder 反向核验或生成结构化 EngOrder
  const busOrder = commands[0] ? toEngineeringOrder(commands[0], tasks) : null;
  const engOrder: EngOrder = busOrder ?? {
    verb: input.verb === '指派' || input.verb === '分配' ? '注资' : input.verb,
    id: projectId,
    ...(moduleKey !== undefined ? { module: moduleKey } : {}),
    ...(hasPhase ? { phase: input.phaseIdx as number } : {}),
    ...(baseId !== undefined ? { base: baseId } : {}),
  };

  // 3. 拼装标准战术指令文本（优先对齐 dispatchBus.toEngineeringCommandText 并保证模块显示名与阶段格式逐字精确）
  let commandText: string;
  if (hasModule && moduleName !== undefined) {
    if (input.verb === '指派' || input.verb === '分配' || (input.verb === '注资' && baseId !== undefined)) {
      if (!baseId) throw new RangeError('基地指派令缺少目标基地');
      commandText = `【工程指令】指派「${projectId}」${moduleName}，承建基地：${baseId}`;
    } else if (input.verb === '注资') {
      commandText = `【工程指令】注资「${projectId}」${moduleName}`;
    } else if (input.verb === '暂停') {
      commandText = `【工程指令】暂停「${projectId}」${moduleName}`;
    } else if (input.verb === '恢复') {
      commandText = `【工程指令】恢复「${projectId}」${moduleName}`;
    } else {
      commandText = `【工程指令】取消「${projectId}」`;
    }
  } else if (hasPhase) {
    if (input.verb === '注资') {
      commandText = `【工程指令】注资「${projectId}」第 ${input.phaseIdx} 阶段`;
    } else if (input.verb === '暂停') {
      commandText =
        (commands[0] ? toEngineeringCommandText(commands[0], tasks, { moduleLevel: false }) : null) ??
        `【工程指令】暂停「${projectId}」`;
    } else if (input.verb === '恢复') {
      commandText =
        (commands[0] ? toEngineeringCommandText(commands[0], tasks, { moduleLevel: false }) : null) ??
        `【工程指令】恢复「${projectId}」`;
    } else {
      commandText = `【工程指令】取消「${projectId}」`;
    }
  } else {
    if (input.verb === '注资') {
      throw new RangeError('注资令缺目标阶段号或模块名');
    }
    if (input.verb === '指派' || input.verb === '分配') {
      if (!baseId) throw new RangeError('基地指派令缺少目标基地');
      const fromBus = commands[0] ? toEngineeringCommandText(commands[0], tasks, { moduleLevel: false }) : null;
      commandText = fromBus ?? `【工程指令】指派「${projectId}」，承建基地：${baseId}`;
    } else {
      const fromBus = commands[0] ? toEngineeringCommandText(commands[0], tasks, { moduleLevel: false }) : null;
      commandText =
        fromBus ??
        (input.verb === '暂停'
          ? `【工程指令】暂停「${projectId}」`
          : input.verb === '恢复'
            ? `【工程指令】恢复「${projectId}」`
            : `【工程指令】取消「${projectId}」`);
    }
  }

  return {
    commandType,
    commands,
    engOrder,
    commandText,
  };
}
