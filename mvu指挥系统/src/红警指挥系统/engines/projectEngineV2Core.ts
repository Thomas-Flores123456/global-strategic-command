/**
 * projectEngineV2Core.ts —— 仓段化 V2 工程引擎（V2-03 · 模块拓扑取代线性阶段链）
 *
 * 从 projectEngine.ts 拆出：
 * - 模块拓扑校验与属地解析（validateModuleTopology / moduleBase）
 * - V2 工程槽占用、门控与投影（engagedSlotCount / checkFreeSlotGate / checkModuleGates / buildModuleProjection / isProjectV2Complete）
 * - V2 立项、跨基地模块指派与模块注资（startProjectV2 / assignModuleBase / investModule）
 * - V2 里程碑回写、模块级与工程级暂停/恢复、取消（syncV2Project / pauseModule / resumeModule / pauseProjectV2 / resumeProjectV2 / cancelProjectV2）
 */

import { buildCompletedTechAndProtocolSet } from '../core/catalogRuntimeContext';
import {
  isProjectV2,
  PROJECT_SCHEMA_VERSION_V2,
  type Project,
  type ProjectModule,
  type ProjectV2,
} from '../core/schema';
import { canon } from '../parse/parsePipeline';
import {
  engSlotCapacityInBase,
  engSlotFor,
  type EngineeringSlotDef,
} from './engineeringSlots';
import {
  allocateProjectInstanceId,
  availableCredits,
  availableNanites,
  deductEconomyNanites,
  findProjectIndex,
  MINUTES_PER_DAY,
  projectionItemName,
  resolveEngineeringQueueIndex,
  V2_PROJECT_SLOT,
  type AssignModuleBaseParams,
  type AssignModuleBaseResult,
  type CancelProjectResult,
  type InvestModuleOptions,
  type ProjectCommandFailureReason,
  type ProjectCommandResult,
  type ProjectEvent,
  type ProjectModuleState,
  type ProjectQueueItem,
  type ProjectStateView,
  type ProjectV2Def,
  type ProjectV2ModuleDef,
  type StartProjectOptions,
} from './projectEngineHelpers';

/**
 * 拓扑校验（§3.3 立项前置）：重复模块 id / prereqs 引用缺失 / prereqs 闭包成环 → 结构化失败信息。
 * DAG 保证根模块（prereqs 空集）必存在；导出供 V2-04 parser 复用同一校验口径。
 */
export function validateModuleTopology(
  modules: readonly ProjectV2ModuleDef[],
): { ok: true } | { ok: false; detail: string } {
  const seen = new Set<string>();
  for (const m of modules) {
    if (seen.has(m.id)) return { ok: false, detail: `重复模块 id「${m.id}」（拓扑边引用键必须工程内唯一）` };
    seen.add(m.id);
  }
  const byId = new Map(modules.map(m => [m.id, m] as const));
  for (const m of modules) {
    for (const dep of m.prereqs) {
      if (!byId.has(dep)) return { ok: false, detail: `模块「${m.id}」prereqs 引用不存在模块「${dep}」` };
    }
  }
  // 闭包无环：三色 DFS（灰→灰 = 背边 = 环）
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  let cycleAt = '';
  const visit = (id: string): boolean => {
    color.set(id, GRAY);
    for (const dep of byId.get(id)!.prereqs) {
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        cycleAt = dep;
        return true;
      }
      if (c === WHITE && visit(dep)) return true;
    }
    color.set(id, BLACK);
    return false;
  };
  for (const m of modules) {
    if ((color.get(m.id) ?? WHITE) === WHITE && visit(m.id)) {
      return { ok: false, detail: `prereqs 闭包成环（环上模块「${cycleAt}」）——仓段拓扑必须是 DAG` };
    }
  }
  return { ok: true };
}

/** 模块属地基地（V1 phaseBase 的 V2 版）：显式指派 module.base 优先；缺省 theater 按模块序轮转
 *  （首个根模块通常 idx=0 → bases[0]，与 V1「phase0=bases[0]」逐字节对齐）/ base 恒 lead_base。 */
export function moduleBase(
  project: Pick<ProjectV2, 'scope' | 'bases' | 'lead_base'>,
  module: Pick<ProjectModule, 'base'> & { assigned_base?: string },
  moduleIdx: number,
): string {
  const assigned = (module.base || module.assigned_base || '').trim();
  if (assigned) return assigned;
  if (project.scope === 'theater' && project.bases.length > 0) {
    return project.bases[moduleIdx % project.bases.length];
  }
  return project.lead_base;
}

/**
 * D-C7 在队占槽计数：该 (base × slot) 上未终态（queued/active/settling）工程队列项数。
 * 跨工程合计（槽位是 parallelism 资源，非单工程私有）；lane 经 engSlotFor 显式入口裁决
 * （未显式 lane 的旧式工程项兜底归首槽，不与 V2 专属槽互挤）。
 */
export function engagedSlotCount(state: ProjectStateView, base: string, slotId: string): number {
  return (state.queues ?? []).filter(q => {
    if (q.type !== '工程') return false;
    if (q.status === 'done' || q.status === 'cancelled') return false;
    if (q.hold) return false;
    if ((q.base ?? '') !== base) return false;
    return engSlotFor({ type: q.type, item: q.item, base: q.base, lane: q.lane }).slotId === slotId;
  }).length;
}

/** D-C7 空余槽门：容量 ≥1（V1 checkSlotGate 口径）且在队占槽数 ＜ 容量（每在队模块各占一槽） */
export function checkFreeSlotGate(
  state: ProjectStateView,
  base: string,
  slot: EngineeringSlotDef,
  moduleLabel: string,
): { reason: ProjectCommandFailureReason; message: string } | null {
  const capacity = engSlotCapacityInBase(state, base, slot) ?? 0;
  if (capacity < 1) {
    return {
      reason: 'no_slot',
      message: `基地「${base}」无可用工程槽（锚定建筑 ${slot.anchor} 均不在场/建造中）——「${moduleLabel}」不得开工（§3.2 锚定建筑门）`,
    };
  }
  const engaged = engagedSlotCount(state, base, slot.slotId);
  if (engaged >= capacity) {
    return {
      reason: 'no_slot',
      message: `基地「${base}」${slot.name}（${slot.slotId}）容量 ${capacity} 已被 ${engaged} 个在队模块占满（D-C7 每在队模块各占一槽）——「${moduleLabel}」注资搁置，腾槽（完工/取消）或改指派其他基地后重发注资令`,
    };
  }
  return null;
}

/** 模块注资双门（D8 资金 / D8b 纳米开工门的模块版；文案口径对齐 checkPhaseGates） */
export function checkModuleGates(
  state: ProjectStateView,
  moduleDef: ProjectV2ModuleDef,
  moduleLabel: string,
): { reason: ProjectCommandFailureReason; message: string } | null {
  const cost = moduleDef.cost ?? 0;
  const credits = availableCredits(state);
  if (cost > credits) {
    return {
      reason: 'funds',
      message: `模块「${moduleLabel}」注资 ${cost} 超出可用资金 ${credits}——注资令搁置，模块保持未启动（资金断链＝模块停摆，工程不暴毙，D8）；补足资金后重发注资令即可`,
    };
  }
  const need = moduleDef.resources?.nanites ?? 0;
  const stock = availableNanites(state);
  if (need > stock) {
    return {
      reason: 'nanites_gate',
      message: `模块「${moduleLabel}」纳米开工门未过：需求 ${need} ＞ 可用纳米库存 ${stock}——本次未发生扣款扣料，库存不会被扣减；模块保持未启动、工程保持在建，备齐纳米后重发注资令`,
    };
  }
  return null;
}

/** 构造一条模块投影 QueueItem（命名合同 `ref·模块名`（§3.3/裁量 j）；lane=V2 专属槽（D-C4）） */
export function buildModuleProjection(
  project: Pick<ProjectV2, 'ref' | 'scope' | 'bases' | 'lead_base'>,
  module: ProjectModule,
  moduleIdx: number,
  moduleDef: ProjectV2ModuleDef,
): ProjectQueueItem {
  const workload = moduleDef.workload;
  return {
    type: '工程',
    item: projectionItemName(project.ref, module.name),
    base: moduleBase(project, module, moduleIdx),
    progress: 0,
    eta: '',
    status: 'queued',
    started_at: '',
    total_minutes: workload && workload.days > 0 ? workload.days * MINUTES_PER_DAY : 0,
    spent_minutes: 0,
    qty: 1,
    qty_done: 0,
    cost_paid: true, // 注资记账：注资令通过即扣账，投影项标记已付（V1 同口径）
    min_days_lock: workload && workload.min_days > 0 ? workload.min_days : 0,
    hold: false,
    lane: `eng:${V2_PROJECT_SLOT.slotId}`, // §4/D-C4：V2 投影显式专属槽
  };
}

/** 拓扑完工判定（§3.3）：全部模块状态=完工（DAG 全汇点到达）→ 工程完工判据；
 *  V1 工程恒 false（V1 完工判据=全阶段完工，归 V1 路径）。 */
export function isProjectV2Complete(project: Project): boolean {
  if (!isProjectV2(project)) return false;
  return project.modules.length > 0 && project.modules.every(m => m.status === '完工');
}

/* ── V2 立项（§3.3：三门校验＋拓扑校验＋根模块开工） ── */

/**
 * 仓段化工程立项：三门校验沿用 V1 startProject 口径（资格=def.requirements 前置科技；
 * 槽=V2 专属槽 eng.orbital 属地容量 ≥1；纳米开工门=校验零抵扣）＋拓扑校验（validateModuleTopology）
 * ＋第一个根模块（定义序首个 prereqs 空集模块）立即注资入队。
 */
export function startProjectV2<S extends ProjectStateView>(
  state: S,
  def: ProjectV2Def,
  options: StartProjectOptions,
): ProjectCommandResult<S> {
  const fail = (reason: ProjectCommandFailureReason, message: string): ProjectCommandResult<S> => ({
    ok: false,
    reason,
    message,
    events: [],
  });

  // 静态定义可展开性（V2 版 no_phases 对位）
  const moduleDefs = def.modules ?? [];
  if (moduleDefs.length === 0) {
    return fail('no_modules', `工程「${def.name}」静态定义缺 modules[]，无法展开仓段（§3.1 V2 project 块）`);
  }
  // 拓扑校验：重复 id / 引用缺失 / 闭环 → 拒立项不留半成品
  const topo = validateModuleTopology(moduleDefs);
  if (!topo.ok) {
    return fail('bad_topology', `工程「${def.name}」模块拓扑非法：${topo.detail}——拒立项`);
  }

  // 基地参数（V1 initiate 口径：lead 必填；theater bases≥2 D21；D-C3 不强制多基地）
  const lead = (options.base ?? '').trim();
  if (!lead) return fail('invalid_bases', `工程「${def.name}」立项缺牵头基地`);
  const scope: Project['scope'] = def.scope ?? 'base';
  const bases =
    scope === 'theater' ? [...new Set((options.bases ?? []).map(b => b.trim()).filter(Boolean))] : [lead];
  if (scope === 'theater' && bases.length < 2) {
    return fail('invalid_bases', `theater 工程「${def.name}」参与基地必须 ≥2（D21），当前 ${bases.length}`);
  }

  // 三门之一·资格门：requirements.research ∈ tech.done ∪ activeProtocols（V1 §3.8 + FIX-P1-02 同口径）
  const completedTechAndProtocols = buildCompletedTechAndProtocolSet(state.tech?.done, state.protocols);
  const research = def.requirements?.research;
  if (
    research &&
    !completedTechAndProtocols.has(canon(research)) &&
    !completedTechAndProtocols.has(research.trim())
  ) {
    return fail(
      'research_gate',
      `工程「${def.name}」前置科技门未过：需「${research}」已研发（tech.done 未收录）——拒立项`,
    );
  }

  // 同 ref+lead 未完结工程去重（V1 口径，跨 V1/V2 实例同账本生效）
  const duplicated = (state.projects ?? []).some(
    p => p.ref === def.name && p.lead_base === lead && p.status !== '完工' && p.status !== '取消',
  );
  if (duplicated) {
    return fail('duplicate', `工程「${def.name}」在基地「${lead}」已有未完结实例——拒重复立项`);
  }

  // 根模块开工（定义序首个 prereqs 空集模块；DAG 保证存在，防御性兜底）
  const rootIdx = moduleDefs.findIndex(m => m.prereqs.length === 0);
  if (rootIdx < 0) {
    return fail('bad_topology', `工程「${def.name}」无根模块（prereqs 空集缺席）——拒立项`);
  }
  const rootDef = moduleDefs[rootIdx];
  const draft: ProjectV2 = {
    id: '',
    ref: def.name, // 引用不搬块（§3.1）；ref=def.name=V1 同口径（裁量 j）
    scope,
    bases,
    lead_base: lead,
    grade: def.grade ?? '巨构', // D-C2：V2 缺省档
    status: '在建',
    modules: [],
    outcome: { type: 'mark' }, // D13-A 占位；def 驱动 outcome 类型=裁量 m（V2-04/V2-11）
    schema_version: PROJECT_SCHEMA_VERSION_V2,
  };
  const rootBase = moduleBase(draft, { base: '' }, rootIdx);

  // 三门之二·槽门：V2 专属槽属地容量 ≥1（V1 checkSlotGate 口径；D-C4）
  const slotFail = checkFreeSlotGate(state, rootBase, V2_PROJECT_SLOT, `${def.name}·${rootDef.name}`);
  if (slotFail) return fail(slotFail.reason, slotFail.message);

  // 三门之三·首根注资双门（资金＋纳米门校验；SIM-NANITE-01 真实扣减纳米库存）
  const rootNaniteCost =
    (rootDef.resources?.nanites ?? 0) ||
    ((def as { requirements?: { nanites?: number }; naniteCost?: number }).requirements?.nanites ??
      (def as { naniteCost?: number }).naniteCost ??
      0);
  const effectiveRootDef =
    rootNaniteCost > 0 && !(rootDef.resources?.nanites && rootDef.resources.nanites > 0)
      ? { ...rootDef, resources: { ...(rootDef.resources ?? {}), nanites: rootNaniteCost } }
      : rootDef;
  const gateFail = checkModuleGates(state, effectiveRootDef, `${def.name}·${rootDef.name}`);
  if (gateFail) return fail(gateFail.reason, gateFail.message);

  // ── 通过：写工程实例＋首根注资扣账（资金＋纳米真实扣减）＋首根投影 ──
  const projectId = options.id ?? allocateProjectInstanceId(state.projects ?? [], def.name, lead);
  const queues = [...(state.queues ?? [])];
  const modules: ProjectModule[] = moduleDefs.map((m, idx) => ({
    id: m.id,
    name: m.name,
    status: idx === rootIdx ? '进行中' : '未启动',
    base: idx === rootIdx ? rootBase : '', // 其余模块承建基地在注资时刻指派（模块级指派=D-C3/D21）
    queue_index: null,
  }));
  const project: ProjectV2 = { ...draft, id: projectId, modules };
  const projection = buildModuleProjection(project, modules[rootIdx], rootIdx, rootDef);
  modules[rootIdx] = { ...modules[rootIdx], queue_index: queues.length };
  queues.push(projection);

  const next = {
    ...state,
    economy: deductEconomyNanites(state.economy, rootNaniteCost, availableCredits(state) - (rootDef.cost ?? 0)),
    queues,
    projects: [...(state.projects ?? []), { ...project, modules }],
  } as S;
  const events: ProjectEvent[] = [
    {
      type: 'project_started',
      item: def.name,
      detail: `立项「${projectId}」@「${lead}」（${project.grade}/${scope}，${modules.length} 模块仓段化 V2）；根模块「${rootDef.name}」注资 ${rootDef.cost ?? 0} 已扣账，${rootNaniteCost > 0 ? `纳米已扣减 ${rootNaniteCost}` : '未消耗纳米'}；投影项 queued @「${rootBase}」待 ${V2_PROJECT_SLOT.name} 放票（V1「立项即注资 phase0」同语义）`,
    },
  ];
  return { ok: true, next, events, projectId };
}

/* ── V2 跨基地模块承建指派（UTO-ALLOC-01 · 08 [P1-5]） ── */

/** ID 优先、名称唯一兜底；null 为多义，undefined 为未命中。桥接与直接指派共用。 */
export function resolveEngModuleIndex(project: ProjectV2, raw: string): number | null | undefined {
  const key = canon(raw);
  let byId: number | undefined;
  let byName: number | null | undefined;
  for (let i = 0; i < project.modules.length; i++) {
    const module = project.modules[i];
    if (canon(module.id) === key) {
      if (byId !== undefined) return null;
      byId = i;
    } else if (byId === undefined && canon(module.name) === key) {
      byName = byName === undefined ? i : null;
    }
  }
  return byId ?? byName;
}

/**
 * V2 巨构跨基地模块承建基地指派（UTO-ALLOC-01）：
 * - 定位 V2 工程实例（findProjectIndex）；
 * - 校验 `project.scope === 'theater'` 且 `(project.bases?.length ?? 0) >= 2` 且 `project.bases` 包含 `targetBase`；
 * - 定位目标模块（按 id 或 name），校验模块当前处于 `'未启动'`，将 `mod.base` 与 `mod.assigned_base` 设为 `targetBase`。
 */
export function assignModuleBase<S extends ProjectStateView>(
  data: S,
  params: AssignModuleBaseParams,
): AssignModuleBaseResult<S> {
  const fail = (reason: ProjectCommandFailureReason, message: string): AssignModuleBaseResult<S> => ({
    ok: false,
    error: message,
    reason,
    message,
    events: [],
  });

  const projectRef = (params?.projectRef ?? '').trim();
  const moduleKey = (params?.moduleId ?? '').trim();
  const rawTargetBase = (params?.targetBase ?? '').trim();

  if (!projectRef) {
    return fail('not_found', '跨基地模块指派缺少工程实例引用（projectRef 不能为空）');
  }
  const projects = data.projects ?? [];
  const projIdx = findProjectIndex(data, projectRef);
  if (projIdx < 0) {
    return fail('not_found', `工程实例「${projectRef}」不存在`);
  }
  const project = projects[projIdx];
  if (!isProjectV2(project)) {
    return fail(
      'not_found',
      `工程实例「${project.id}」为 V1 线性阶段工程（schema_version 1）——跨基地模块指派仅适用 V2 仓段化工程`,
    );
  }
  if (project.status === '完工' || project.status === '取消') {
    return fail('bad_status', `工程「${project.ref}」当前「${project.status}」——终态工程不可指派模块基地`);
  }
  if (project.scope !== 'theater' || (project.bases?.length ?? 0) < 2) {
    return fail(
      'invalid_bases',
      `工程「${project.ref}」scope 为 '${project.scope}'（联建基地数 ${project.bases?.length ?? 0}）——跨基地模块指派仅限 scope === 'theater' 且联建基地 ≥2 的工程`,
    );
  }
  if (!rawTargetBase) {
    return fail('invalid_bases', `工程「${project.ref}」跨基地模块指派缺少目标承建基地`);
  }
  const matchedBase = project.bases.find(b => b === rawTargetBase || canon(b) === canon(rawTargetBase));
  if (!matchedBase) {
    return fail(
      'invalid_bases',
      `目标基地「${rawTargetBase}」不在工程「${project.ref}」联建基地列表（${project.bases.join('、')}）中——拒指派`,
    );
  }

  const modIdx = resolveEngModuleIndex(project, moduleKey);
  if (modIdx === null) {
    return fail('not_found', `工程「${project.ref}」模块「${moduleKey}」匹配多个模块，请改用模块 id`);
  }
  if (modIdx === undefined) {
    return fail('not_found', `工程「${project.ref}」无模块「${moduleKey}」`);
  }
  const mod = project.modules[modIdx];
  if (mod.status !== '未启动') {
    return fail(
      'bad_status',
      `模块「${mod.name}」（${mod.id}）当前「${mod.status}」——仅未启动模块可指派承建基地`,
    );
  }

  const updatedMod: ProjectModuleState = {
    ...mod,
    base: matchedBase,
    assigned_base: matchedBase,
  };
  if (!Object.isFrozen(mod)) {
    try {
      mod.base = matchedBase;
      (mod as ProjectModuleState).assigned_base = matchedBase;
    } catch {
      // ignore if readonly
    }
  }

  const updatedProject: ProjectV2 = {
    ...project,
    modules: project.modules.map((m, idx) => (idx === modIdx ? updatedMod : m)),
  };
  const nextProjects: Project[] = projects.map((p, idx) => (idx === projIdx ? updatedProject : p));
  const nextState = {
    ...data,
    projects: nextProjects,
  } as S;
  const events: ProjectEvent[] = [
    {
      type: 'module_allocated',
      item: projectionItemName(project.ref, mod.name || mod.id),
      detail: `模块「${mod.name}」（${mod.id}）承建基地指派为「${matchedBase}」${params.reason ? `（${params.reason}）` : ''}`,
    },
  ];

  return {
    ok: true,
    next: nextState,
    events,
    projectId: updatedProject.id,
    project: updatedProject,
    module: updatedMod,
  };
}

/* ── V2 模块注资（§3.3：investModule，startPhase 的拓扑版） ── */

/**
 * 模块注资：前置完工门（phase_order 的拓扑版——所有 prereqs 模块完工才放行）＋
 * 槽位门（D-C7：每在队模块各占一槽，查属地空余容量）＋注资扣款＋模块入队投影＋min_days_lock 物理周期（D12）。
 */
export function investModule<S extends ProjectStateView>(
  state: S,
  projectId: string,
  moduleId: string,
  def: ProjectV2Def,
  options: InvestModuleOptions = {},
): ProjectCommandResult<S> {
  const fail = (reason: ProjectCommandFailureReason, message: string): ProjectCommandResult<S> => ({
    ok: false,
    reason,
    message,
    events: [],
  });

  const projects = state.projects ?? [];
  const projIdx = findProjectIndex(state, projectId);
  if (projIdx < 0) return fail('not_found', `工程实例「${projectId}」不存在`);
  const project = projects[projIdx];
  if (!isProjectV2(project)) {
    return fail('not_found', `工程实例「${project.id}」为 V1 线性阶段工程（schema_version 1）——模块注资通道不适用`);
  }
  if (canon(def.name) !== canon(project.ref)) {
    return fail('def_mismatch', `静态定义「${def.name}」与工程 ref「${project.ref}」不符`);
  }
  if (project.status !== '在建') {
    return fail(
      'bad_status',
      `工程「${project.ref}」当前「${project.status}」——模块注资令仅在建状态可受理（工程级暂停请先整体恢复）`,
    );
  }
  const moduleIdx = project.modules.findIndex(m => m.id === moduleId);
  const module = moduleIdx >= 0 ? project.modules[moduleIdx] : undefined;
  const moduleDef = def.modules.find(m => m.id === moduleId);
  if (!module || !moduleDef) {
    return fail('not_found', `工程「${project.ref}」无模块「${moduleId}」`);
  }
  if (module.status !== '未启动') {
    return fail('bad_status', `模块「${module.name}」（${module.id}）当前「${module.status}」——仅未启动模块可注资`);
  }
  // 前置完工门（拓扑版 phase_order）：所有 prereqs 模块完工才放行
  const statusOf = (id: string) => project.modules.find(m => m.id === id)?.status;
  const blockingId = moduleDef.prereqs.find(dep => statusOf(dep) !== '完工');
  if (blockingId !== undefined) {
    return fail(
      'module_order',
      `模块「${module.name}」（${module.id}）不得注资：前置模块「${blockingId}」尚未完工（拓扑版阶段顺序门——全部前置完工才放行）`,
    );
  }

  // 属地与槽位门（D-C7）：显式指派基地优先（options.base → 既有指派 → theater 轮转/lead_base）
  const stagedModule: ProjectModule = {
    ...module,
    base: (options.base ?? '').trim() || module.base,
  };
  const base = moduleBase(project, stagedModule, moduleIdx);
  const slotFail = checkFreeSlotGate(state, base, V2_PROJECT_SLOT, `${project.ref}·${module.name}`);
  if (slotFail) return fail(slotFail.reason, slotFail.message);

  // 注资双门（资金断=模块停摆不暴毙；纳米不足=开工门 hold，均不改状态）
  const gateFail = checkModuleGates(state, moduleDef, `${project.ref}·${module.name}`);
  if (gateFail) return fail(gateFail.reason, gateFail.message);

  // ── 通过：扣账＋投影＋回写模块 ──
  const queues = [...(state.queues ?? [])];
  const projection = buildModuleProjection(project, stagedModule, moduleIdx, moduleDef);
  const written: ProjectModule = { ...stagedModule, status: '进行中', base, queue_index: queues.length };
  queues.push(projection);
  const nextProjects: Project[] = projects.map((p, i) =>
    i === projIdx
      ? { ...project, modules: project.modules.map((m, j) => (j === moduleIdx ? written : m)) }
      : p,
  );
  const moduleNaniteCost = moduleDef.resources?.nanites ?? 0;
  const next = {
    ...state,
    economy: deductEconomyNanites(state.economy, moduleNaniteCost, availableCredits(state) - (moduleDef.cost ?? 0)),
    queues,
    projects: nextProjects,
  } as S;
  return {
    ok: true,
    next,
    events: [
      {
        type: 'module_started',
        item: projection.item,
        detail: `模块「${module.name}」（${module.id}）注资 ${moduleDef.cost ?? 0} 已扣账；${moduleNaniteCost > 0 ? `纳米已扣减 ${moduleNaniteCost}` : '未消耗纳米'}；投影项 queued @「${base}」（lane=${projection.lane}）`,
      },
    ],
    projectId: project.id,
  };
}

/* ── V2 里程碑回写（syncProjects 的 V2 分支体） ── */

/**
 * V2 模块里程碑回写（镜像 V1 phases 回写口径；queue_index 寻址加 module 维度）：
 * 投影项 done → 模块完工＋queue_index 释放；cancelled → 模块取消（外部取消路径，warn 留痕）；
 * 全部模块完工 → isProjectV2Complete → 工程完工＋outcome mark。
 */
export function syncV2Project(
  project: ProjectV2,
  queues: readonly ProjectQueueItem[],
  events: ProjectEvent[],
): ProjectV2 {
  let modulesChanged = false;
  const nextModules = project.modules.map((module, moduleIdx) => {
    if (module.queue_index === null) return module;
    const expected = projectionItemName(project.ref, module.name);
    const resolvedIdx = resolveEngineeringQueueIndex(
      queues,
      module.queue_index,
      expected,
      moduleBase(project, module, moduleIdx),
      true,
    );
    // 身份校验（裁量 a + FIX-P1-03 漂移重定位）：原下标不符且无法重定位 → warn 跳过，不清指针
    if (resolvedIdx === null) {
      const rawItem = queues[module.queue_index];
      events.push({
        type: 'sync_warn',
        item: expected,
        detail: `模块「${module.name}」（${module.id}）queue_index=${module.queue_index} 回读身份不符（实读「${rawItem?.item ?? '缺席'}」）——本楼跳过，指针保留`,
      });
      return module;
    }
    const item = queues[resolvedIdx];
    if (item.status === 'done') {
      modulesChanged = true;
      events.push({
        type: 'module_milestone',
        item: expected,
        detail: `模块「${module.name}」（${module.id}）投影项 done → 模块完工，里程碑回写（queue_index 指针释放）`,
      });
      return { ...module, status: '完工' as const, queue_index: null };
    }
    if (item.status === 'cancelled') {
      modulesChanged = true;
      events.push({
        type: 'sync_warn',
        item: expected,
        detail: `模块「${module.name}」（${module.id}）投影项已 cancelled（外部取消路径）→ 模块置取消；工程保持「${project.status}」，请用取消令走正式结算`,
      });
      return { ...module, status: '取消' as const, queue_index: null };
    }
    if (resolvedIdx !== module.queue_index) {
      modulesChanged = true;
      return { ...module, queue_index: resolvedIdx };
    }
    return module;
  });
  if (!modulesChanged) return project;
  if (isProjectV2Complete({ ...project, modules: nextModules })) {
    events.push({
      type: 'project_completed',
      item: project.ref,
      detail: `仓段化工程「${project.ref}」全部 ${nextModules.length} 模块拓扑完工 → status=完工，outcome={type:'mark'}（D13-A 口径；def 驱动 outcome 类型与 variant 档归 V2-04/V2-11）`,
    });
    return { ...project, status: '完工' as const, modules: nextModules, outcome: { type: 'mark' as const } };
  }
  return { ...project, modules: nextModules };
}

/* ── V2 模块级暂停/恢复（hold 单模块） ── */

function setModuleHold<S extends ProjectStateView>(
  state: S,
  projectId: string,
  moduleId: string,
  hold: boolean,
): ProjectCommandResult<S> {
  const fail = (reason: ProjectCommandFailureReason, message: string): ProjectCommandResult<S> => ({
    ok: false,
    reason,
    message,
    events: [],
  });
  const projects = state.projects ?? [];
  const projIdx = findProjectIndex(state, projectId);
  if (projIdx < 0) return fail('not_found', `工程实例「${projectId}」不存在`);
  const project = projects[projIdx];
  if (!isProjectV2(project)) {
    return fail('not_found', `工程实例「${project.id}」为 V1 线性阶段工程——模块级暂停/恢复不适用（V2-03 判别边界）`);
  }
  if (project.status !== '在建') {
    return fail(
      'bad_status',
      `工程「${project.ref}」当前「${project.status}」——模块级${hold ? '暂停' : '恢复'}仅工程在建时可受理（工程级暂停请先整体恢复）`,
    );
  }
  const moduleIdx = project.modules.findIndex(m => m.id === moduleId);
  if (moduleIdx < 0) return fail('not_found', `工程「${project.ref}」无模块「${moduleId}」`);
  const module = project.modules[moduleIdx];
  const expectStatus = hold ? '进行中' : '暂停';
  if (module.status !== expectStatus) {
    return fail(
      'bad_status',
      `模块「${module.name}」（${module.id}）当前「${module.status}」——${hold ? '暂停' : '恢复'}令仅「${expectStatus}」模块可受理`,
    );
  }

  // FIX-P1-03：恢复（hold=false）时复验属地工程槽剩余可用容量
  const mBase = moduleBase(project, module, moduleIdx);
  const expectedName = projectionItemName(project.ref, module.name);
  if (!hold) {
    const slotFail = checkFreeSlotGate(state, mBase, V2_PROJECT_SLOT, expectedName);
    if (slotFail) return fail(slotFail.reason, slotFail.message);
  }

  // 投影项 hold 透传（FIX-P1-03：强制校验工程身份并支持下标漂移重定位）
  const rawQueues = state.queues ?? [];
  const targetQueueIdx = resolveEngineeringQueueIndex(
    rawQueues,
    module.queue_index,
    expectedName,
    mBase,
    false,
  );
  const queues = rawQueues.map((item, idx) => {
    if (targetQueueIdx === null || idx !== targetQueueIdx) return item;
    if (item.status !== 'active' && item.status !== 'queued') return item; // settling/done/cancelled 不调度
    if (hold && item.status === 'active') return { ...item, status: 'queued' as const, hold: true };
    return { ...item, hold };
  });
  const nextProjects: Project[] = projects.map((p, i) =>
    i === projIdx
      ? {
          ...project,
          modules: project.modules.map((m, j) =>
            j === moduleIdx
              ? {
                  ...m,
                  queue_index: targetQueueIdx ?? m.queue_index,
                  status: (hold ? '暂停' : '进行中') as ProjectModule['status'],
                }
              : m,
          ),
        }
      : p,
  );
  const next = { ...state, queues, projects: nextProjects } as S;
  return {
    ok: true,
    next,
    events: [
      {
        type: hold ? 'module_paused' : 'module_resumed',
        item: projectionItemName(project.ref, module.name),
        detail: hold
          ? `模块暂停：在途投影项退回 queued＋hold（进度保留，单模块粒度，工程保持在建）`
          : `模块恢复：投影项 hold 清除，重新竞争属地工程槽带宽（单模块粒度）`,
      },
    ],
    projectId: project.id,
  };
}

/** 模块级暂停（hold 单模块；工程保持在建） */
export function pauseModule<S extends ProjectStateView>(
  state: S,
  projectId: string,
  moduleId: string,
): ProjectCommandResult<S> {
  return setModuleHold(state, projectId, moduleId, true);
}

/** 模块级恢复 */
export function resumeModule<S extends ProjectStateView>(
  state: S,
  projectId: string,
  moduleId: string,
): ProjectCommandResult<S> {
  return setModuleHold(state, projectId, moduleId, false);
}

/* ── V2 工程级暂停/恢复（联动全部未完工模块；V1 setProjectHold 的模块版镜像） ── */

function setProjectV2Hold<S extends ProjectStateView>(
  state: S,
  projectId: string,
  hold: boolean,
): ProjectCommandResult<S> {
  const fail = (reason: ProjectCommandFailureReason, message: string): ProjectCommandResult<S> => ({
    ok: false,
    reason,
    message,
    events: [],
  });
  const projects = state.projects ?? [];
  const projIdx = findProjectIndex(state, projectId);
  if (projIdx < 0) return fail('not_found', `工程实例「${projectId}」不存在`);
  const project = projects[projIdx];
  if (!isProjectV2(project)) {
    return fail('not_found', `工程实例「${project.id}」为 V1 线性阶段工程——V2 工程${hold ? '暂停' : '恢复'}通道不适用`);
  }
  const expectStatus = hold ? '在建' : '暂停';
  if (project.status !== expectStatus) {
    return fail(
      'bad_status',
      `工程「${project.ref}」当前「${project.status}」——${hold ? '暂停' : '恢复'}令仅「${expectStatus}」状态可受理`,
    );
  }

  // FIX-P1-03：工程级恢复（hold=false）时复验各属地工程槽可用容量
  if (!hold) {
    const slot = V2_PROJECT_SLOT;
    const neededByBase = new Map<string, { count: number; label: string }>();
    project.modules.forEach((m, idx) => {
      if (m.queue_index !== null && m.status === '暂停') {
        const b = moduleBase(project, m, idx);
        const prev = neededByBase.get(b);
        neededByBase.set(b, {
          count: (prev?.count ?? 0) + 1,
          label: prev?.label ?? projectionItemName(project.ref, m.name),
        });
      }
    });
    for (const [b, info] of neededByBase.entries()) {
      const capacity = engSlotCapacityInBase(state, b, slot) ?? 0;
      const engaged = engagedSlotCount(state, b, slot.slotId);
      if (capacity < 1 || engaged + info.count > capacity) {
        const gateErr = checkFreeSlotGate(state, b, slot, info.label);
        return fail(
          gateErr?.reason ?? 'no_slot',
          gateErr?.message ??
            `基地「${b}」工程槽容量不足（需 ${info.count} 槽，余 ${Math.max(0, capacity - engaged)} 槽）——拒恢复`,
        );
      }
    }
  }

  // 投影项 hold 透传（FIX-P1-03：强制校验工程身份并支持下标漂移重定位）
  const rawQueues = state.queues ?? [];
  const resolvedByModuleIdx = new Map<number, number>();
  const heldIndexes = new Set<number>();
  project.modules.forEach((m, idx) => {
    if (m.queue_index === null) return;
    const resolved = resolveEngineeringQueueIndex(
      rawQueues,
      m.queue_index,
      projectionItemName(project.ref, m.name),
      moduleBase(project, m, idx),
      false,
    );
    if (resolved !== null) {
      resolvedByModuleIdx.set(idx, resolved);
      heldIndexes.add(resolved);
    }
  });
  const queues = rawQueues.map((item, idx) => {
    if (!heldIndexes.has(idx)) return item;
    if (item.status !== 'active' && item.status !== 'queued') return item;
    if (hold && item.status === 'active') return { ...item, status: 'queued' as const, hold: true };
    return { ...item, hold };
  });
  const nextProjects: Project[] = projects.map((p, i) =>
    i === projIdx
      ? {
          ...project,
          status: (hold ? '暂停' : '在建') as Project['status'],
          modules: project.modules.map((m, idx) => {
            const nextQueueIdx = resolvedByModuleIdx.get(idx) ?? m.queue_index;
            if (m.queue_index !== null && m.status === (hold ? '进行中' : '暂停')) {
              return {
                ...m,
                queue_index: nextQueueIdx,
                status: (hold ? '暂停' : '进行中') as ProjectModule['status'],
              };
            }
            return nextQueueIdx !== m.queue_index ? { ...m, queue_index: nextQueueIdx } : m;
          }),
        }
      : p,
  );
  const next = { ...state, queues, projects: nextProjects } as S;
  const liveCount = project.modules.filter(m => m.status === '进行中' || m.status === '暂停').length;
  return {
    ok: true,
    next,
    events: [
      {
        type: hold ? 'project_paused' : 'project_resumed',
        item: project.ref,
        detail: hold
          ? `仓段化工程暂停：全部 ${liveCount} 个未完工在途模块投影退回 queued＋hold（进度保留，联动整工程）`
          : `仓段化工程恢复：全部在途模块投影 hold 清除，按队列序重新竞争属地工程槽带宽`,
      },
    ],
    projectId: project.id,
  };
}

/** 工程级暂停（联动全部未完工模块） */
export function pauseProjectV2<S extends ProjectStateView>(
  state: S,
  projectId: string,
): ProjectCommandResult<S> {
  return setProjectV2Hold(state, projectId, true);
}

/** 工程级恢复 */
export function resumeProjectV2<S extends ProjectStateView>(
  state: S,
  projectId: string,
): ProjectCommandResult<S> {
  return setProjectV2Hold(state, projectId, false);
}

/* ── V2 取消（结算口径对齐 V1 cancelProject：已注资不退、折算作废、纳米零抵扣） ── */

/**
 * 仓段化工程取消：在途模块投影 cancelled、进行中/暂停模块置取消释放指针、未启动保持、完工保留不回滚；
 * 结算文案=§3.3 固定口径的模块版（已注资模块点名＋金额合计不退＋折算进度作废＋纳米无变动）。
 */
export function cancelProjectV2<S extends ProjectStateView>(
  state: S,
  projectId: string,
  def?: ProjectV2Def,
): CancelProjectResult<S> {
  const fail = (reason: ProjectCommandFailureReason, message: string): CancelProjectResult<S> => ({
    ok: false,
    reason,
    message,
    events: [],
  });
  const projects = state.projects ?? [];
  const projIdx = findProjectIndex(state, projectId);
  if (projIdx < 0) return fail('not_found', `工程实例「${projectId}」不存在`);
  const project = projects[projIdx];
  if (!isProjectV2(project)) {
    return fail('not_found', `工程实例「${project.id}」为 V1 线性阶段工程——V2 取消通道不适用`);
  }
  if (project.status !== '在建' && project.status !== '暂停') {
    return fail('bad_status', `工程「${project.ref}」当前「${project.status}」——取消令仅在建/暂停可受理`);
  }
  if (def && canon(def.name) !== canon(project.ref)) {
    return fail('def_mismatch', `静态定义「${def.name}」与工程 ref「${project.ref}」不符`);
  }

  // 在途模块投影项 → cancelled（裁量 f + FIX-P1-03 身份核验与漂移重定位）；已完工模块不动
  const rawQueues = state.queues ?? [];
  const liveIndexes = new Set<number>();
  project.modules.forEach((m, idx) => {
    if (m.queue_index === null) return;
    const resolved = resolveEngineeringQueueIndex(
      rawQueues,
      m.queue_index,
      projectionItemName(project.ref, m.name),
      moduleBase(project, m, idx),
      false,
    );
    if (resolved !== null) liveIndexes.add(resolved);
  });
  const queues = rawQueues.map((item, idx) =>
    liveIndexes.has(idx) && item.status !== 'done' && item.status !== 'cancelled'
      ? { ...item, status: 'cancelled' as const }
      : item,
  );
  const nextProjects: Project[] = projects.map((p, i) =>
    i === projIdx
      ? {
          ...project,
          status: '取消' as const,
          modules: project.modules.map(m =>
            m.queue_index !== null && (m.status === '进行中' || m.status === '暂停')
              ? { ...m, status: '取消' as const, queue_index: null }
              : m.queue_index !== null
                ? { ...m, queue_index: null }
                : m,
          ),
        }
      : p,
  );
  const next = { ...state, queues, projects: nextProjects } as S;

  // ── §3.3 固定结算文案（模块版，UI 确认弹窗复用）：已注资模块注资不退、在途进度作废 ──
  const fundedModules = project.modules.filter(
    m => m.status === '完工' || m.status === '进行中' || m.status === '暂停',
  );
  const names = fundedModules.map(m => `「${m.name}」`).join('、');
  const amounts = def
    ? fundedModules.map(m => def.modules.find(d => d.id === m.id)?.cost ?? 0)
    : null;
  const total = amounts ? amounts.reduce((s, v) => s + v, 0) : null;
  const settlementText =
    `仓段化工程「${project.ref}」取消结算：已注资 ${fundedModules.length} 个模块（${names || '无'}）` +
    (total !== null ? `，注资合计 ${total} 资金` : '，已注资金额') +
    `不予退还；未完成模块的折算进度全部作废。` +
    `已消耗纳米不予退还，取消操作不再扣减纳米库存。`;

  return {
    ok: true,
    next,
    events: [
      {
        type: 'project_cancelled',
        item: project.ref,
        detail: settlementText,
      },
    ],
    projectId: project.id,
    settlementText,
  };
}
