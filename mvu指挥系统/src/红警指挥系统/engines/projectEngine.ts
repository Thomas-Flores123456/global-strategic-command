/**
 * projectEngine.ts —— 工程投影引擎与纳米开工门（ENG-PROJ-01 / V2-03）
 *
 * 真源：docs/project/plans/工程玩法MVP任务包.md §3.1/§3.3/§3.5/§6；
 *       docs/project/plans/仓段化V2设计案-草案.md §3.3/§4。
 *
 * 职责（§2.2 分层）：阶段/模块拓扑 ⇄ queue 项映射、纳米开工门、注资记账、里程碑回写、暂停/恢复/取消。
 * 共享类型、读数助手与接缝函数拆至 ./projectEngineHelpers；
 * 仓段化 V2 模块拓扑引擎拆至 ./projectEngineV2Core；本入口保持完整 Re-export。
 */

import type { RetrofitDef } from '../core/catalog';
import { buildCompletedTechAndProtocolSet } from '../core/catalogRuntimeContext';
import { parseUnitTokenNameAndCount } from '../core/prerequisites';
import {
  isProjectV2,
  type Project,
  type ProjectPhase,
  type ProjectV1,
} from '../core/schema';
import { canon } from '../parse/parsePipeline';
import {
  allocateProjectInstanceId,
  availableCredits,
  buildProjection,
  checkPhaseGates,
  checkSlotGate,
  findProjectIndex,
  MAIN_SLOT,
  phaseBase,
  projectionItemName,
  resolveEngineeringQueueIndex,
  resolveRetrofitUpgradeRules,
  type CancelProjectResult,
  type ProjectCommandFailureReason,
  type ProjectCommandResult,
  type ProjectEvent,
  type ProjectStateView as BaseProjectStateView,
  type RetrofitUpgradeRule,
  type StartProjectOptions,
  type SyncProjectsResult,
} from './projectEngineHelpers';
import { checkFreeSlotGate, engagedSlotCount, syncV2Project } from './projectEngineV2Core';
import { engSlotCapacityInBase } from './engineeringSlots';
import { deductEconomyNanites } from './naniteLedger';

export * from './projectEngineHelpers';
export * from './projectEngineV2Core';

/** 扩展工程状态视图（FD-37 · PKG-C：支持全局与分基地 forces.vehicles / troops / equipment 同步升格） */
export interface ProjectStateView extends Omit<BaseProjectStateView, 'bases' | 'forces'> {
  bases?: ReadonlyArray<{
    id?: string;
    name?: string;
    buildings?: ReadonlyArray<{ name: string; state?: string; addons?: readonly string[] }>;
    forces?: {
      troops?: Readonly<Record<string, number>>;
      infantry?: Readonly<Record<string, number>>;
      vehicles?: ReadonlyArray<string>;
      aircraft?: ReadonlyArray<string>;
      equipment?: Readonly<Record<string, number>>;
    } | null;
  }>;
  forces?: {
    troops?: Readonly<Record<string, number>>;
    infantry?: Readonly<Record<string, number>>;
    vehicles?: ReadonlyArray<string>;
    aircraft?: ReadonlyArray<string>;
    equipment?: Readonly<Record<string, number>>;
    girls?: ReadonlyArray<{ name: string; model?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  };
}

/** 精确匹配单位 token（剥离状态/数量后缀后 canon 相等），保留原后缀换名；升格后名不再命中 from，天然防二次叠加 */
function upgradeUnitToken(token: string, rule: RetrofitUpgradeRule): string | null {
  const parsed = parseUnitTokenNameAndCount(token);
  if (!parsed || canon(parsed.strippedName) !== canon(rule.from)) return null;
  const suffix = parsed.rawName.startsWith(parsed.strippedName)
    ? parsed.rawName.slice(parsed.strippedName.length)
    : '';
  return `${rule.to}${suffix}`;
}

function upgradeTokenList(list: ReadonlyArray<string>, rules: readonly RetrofitUpgradeRule[]): string[] | null {
  let changed = false;
  const next = list.map(token => {
    for (const rule of rules) {
      const up = upgradeUnitToken(token, rule);
      if (up !== null) {
        changed = true;
        return up;
      }
    }
    return token;
  });
  return changed ? next : null;
}

function upgradeRecord(
  record: Readonly<Record<string, number>>,
  rules: readonly RetrofitUpgradeRule[],
): Record<string, number> | null {
  let changed = false;
  const next: Record<string, number> = {};
  const add = (key: string, count: number) => {
    const existing = Object.keys(next).find(k => canon(k) === canon(key)) ?? key;
    next[existing] = (next[existing] ?? 0) + count;
  };
  for (const [key, count] of Object.entries(record)) {
    const rule = rules.find(r => canon(r.from) === canon(key));
    if (rule) changed = true;
    add(rule ? rule.to : key, count);
  }
  return changed ? next : null;
}

type ForcesLike = NonNullable<ProjectStateView['forces']>;
type BaseForcesLike = NonNullable<NonNullable<ProjectStateView['bases']>[number]['forces']>;

function upgradeForces<F extends ForcesLike | BaseForcesLike>(forces: F, rules: readonly RetrofitUpgradeRule[]): F {
  const patch: Record<string, unknown> = {};
  for (const key of ['vehicles', 'aircraft'] as const) {
    const list = forces[key];
    if (Array.isArray(list)) {
      const up = upgradeTokenList(list, rules);
      if (up) patch[key] = up;
    }
  }
  for (const key of ['troops', 'infantry', 'equipment'] as const) {
    const rec = forces[key];
    if (rec) {
      const up = upgradeRecord(rec, rules);
      if (up) patch[key] = up;
    }
  }
  const girls = (forces as ForcesLike).girls;
  if (Array.isArray(girls)) {
    let girlsChanged = false;
    const nextGirls = girls.map(g => {
      const rule = rules.find(r => typeof g.model === 'string' && canon(r.from) === canon(g.model));
      if (!rule) return g;
      girlsChanged = true;
      return { ...g, model: rule.to };
    });
    if (girlsChanged) patch.girls = nextGirls;
  }
  return Object.keys(patch).length > 0 ? ({ ...forces, ...patch } as F) : forces;
}

/**
 * 现代化改装完工升格（FD-22）：规则唯一来源 = 世界书 retrofit 条目（resolveRetrofitUpgradeRules）。
 * 单位改装改写全局与各基地 forces；建筑改装仅改写牵头基地母体建筑。
 */
export function applyRetrofitCompletionUpgrade<S extends ProjectStateView>(
  state: S,
  completed: ReadonlyArray<{ def: RetrofitDef; lead_base: string }>,
): S {
  let nextForces = state.forces;
  let nextBases = state.bases;
  for (const { def, lead_base } of completed) {
    const rules = resolveRetrofitUpgradeRules(def);
    const unitRules = rules.filter(r => r.kind === 'unit');
    const buildingRules = rules.filter(r => r.kind === 'building');
    if (unitRules.length > 0 && nextForces) nextForces = upgradeForces(nextForces, unitRules);
    if (nextBases && rules.length > 0) {
      nextBases = nextBases.map(base => {
        let next = base;
        if (unitRules.length > 0 && base.forces) {
          const f = upgradeForces(base.forces, unitRules);
          if (f !== base.forces) next = { ...next, forces: f };
        }
        const isLead = !lead_base || base.id === lead_base || canon(base.name ?? '') === canon(lead_base);
        if (buildingRules.length > 0 && isLead && base.buildings) {
          let bChanged = false;
          const blds = base.buildings.map(bd => {
            const rule = buildingRules.find(r => canon(r.from) === canon(bd.name));
            if (!rule) return bd;
            bChanged = true;
            return { ...bd, name: rule.to };
          });
          if (bChanged) next = { ...next, buildings: blds };
        }
        return next;
      });
    }
  }
  if (nextForces === state.forces && nextBases === state.bases) return state;
  return { ...state, forces: nextForces, bases: nextBases };
}

/* ═══════════════ ① 立项（§3.8 立项令：科技门＋容量门＋首期注资＋纳米开工门） ═══════════════ */

export function startProject<S extends ProjectStateView>(
  state: S,
  def: RetrofitDef,
  options: StartProjectOptions,
): ProjectCommandResult<S> {
  const fail = (reason: ProjectCommandFailureReason, message: string): ProjectCommandResult<S> => ({
    ok: false,
    reason,
    message,
    events: [],
  });

  // 静态定义可展开性
  const phaseDefs = def.phases ?? [];
  if (phaseDefs.length === 0) {
    return fail('no_phases', `工程「${def.name}」静态定义缺 phases[]，无法展开阶段（§3.4 V1 增量未回填）`);
  }

  // 基地参数
  const lead = (options.base ?? '').trim();
  if (!lead) return fail('invalid_bases', `工程「${def.name}」立项缺牵头基地`);
  const scope: Project['scope'] = def.scope ?? 'base';
  const bases =
    scope === 'theater' ? [...new Set((options.bases ?? []).map(b => b.trim()).filter(Boolean))] : [lead];
  if (scope === 'theater' && bases.length < 2) {
    return fail('invalid_bases', `theater 工程「${def.name}」参与基地必须 ≥2（D21），当前 ${bases.length}`);
  }

  // 前置科技/协议门（§3.8 + FIX-P1-02：retrofit.research ∈ tech.done ∪ activeProtocols）
  const completedTechAndProtocols = buildCompletedTechAndProtocolSet(state.tech?.done, state.protocols);
  if (
    def.research &&
    !completedTechAndProtocols.has(canon(def.research)) &&
    !completedTechAndProtocols.has(def.research.trim())
  ) {
    return fail(
      'research_gate',
      `工程「${def.name}」前置科技门未过：需「${def.research}」已研发（tech.done 未收录）——拒立项`,
    );
  }

  // 同 ref+lead 未完结工程去重（裁量：MVP 单实例口径，防账本重影）
  const duplicated = (state.projects ?? []).some(
    p => p.ref === def.name && p.lead_base === lead && p.status !== '完工' && p.status !== '取消',
  );
  if (duplicated) {
    return fail('duplicate', `工程「${def.name}」在基地「${lead}」已有未完结实例——拒重复立项`);
  }

  // 属地工程槽容量门（牵头基地）
  const slotFail = checkSlotGate(state, lead, def.name);
  if (slotFail) return fail(slotFail.reason, slotFail.message);

  // 首期注资双门（裁量 b：立项期门不过＝拒立项，不留半成品）
  const gateFail = checkPhaseGates(state, phaseDefs[0], `${def.name}·${phaseDefs[0].name}`);
  if (gateFail) return fail(gateFail.reason, gateFail.message);

  // ── 通过：扣首期注资＋写工程实例＋首期投影 ──
  const projectId = options.id ?? allocateProjectInstanceId(state.projects ?? [], def.name, lead);
  const queues = [...(state.queues ?? [])];
  const phases: ProjectPhase[] = phaseDefs.map((p, idx) => ({
    idx,
    name: p.name,
    status: idx === 0 ? '进行中' : '未启动',
    queue_index: null,
  }));
  const project: ProjectV1 = {
    id: projectId,
    ref: def.name, // 引用不搬块（§3.1）
    scope,
    bases,
    lead_base: lead,
    grade: def.grade,
    status: '在建',
    phases,
    outcome: { type: 'mark' }, // D13-A 首版产出物占位
    schema_version: 1,
  };
  const projection = buildProjection(project, phases[0], phaseDefs[0]);
  phases[0] = { ...phases[0], queue_index: queues.length };
  queues.push(projection);

  const next = {
    ...state,
    economy: deductEconomyNanites(
      state.economy,
      phaseDefs[0].resources?.nanites ?? 0,
      availableCredits(state) - (phaseDefs[0].cost ?? 0),
    ),
    queues,
    projects: [...(state.projects ?? []), { ...project, phases }],
  } as S;
  const events: ProjectEvent[] = [
    {
      type: 'project_started',
      item: def.name,
      detail: `立项「${projectId}」@「${lead}」（${def.grade}/${scope}，${phases.length} 阶段）；首期「${phaseDefs[0].name}」注资 ${phaseDefs[0].cost ?? 0} 与纳米 ${phaseDefs[0].resources?.nanites ?? 0} 已扣账，投影项 queued 待属地工程槽放票`,
    },
  ];
  return { ok: true, next, events, projectId };
}

/* ═══════════════ ② 阶段启动（注资令） ═══════════════ */

export function startPhase<S extends ProjectStateView>(
  state: S,
  projectId: string,
  phaseIdx: number,
  def: RetrofitDef,
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
  if (isProjectV2(project)) {
    return fail('not_found', `工程实例「${project.id}」为仓段化工程（schema_version 2）——V1 阶段注资通道不适用`);
  }
  if (canon(def.name) !== canon(project.ref)) {
    return fail('def_mismatch', `静态定义「${def.name}」与工程 ref「${project.ref}」不符`);
  }
  if (project.status !== '在建') {
    return fail('bad_status', `工程「${project.ref}」当前「${project.status}」——注资令仅在建状态可受理`);
  }
  const phase = project.phases.find(p => p.idx === phaseIdx);
  const phaseDef = (def.phases ?? [])[phaseIdx];
  if (!phase || !phaseDef) {
    return fail('not_found', `工程「${project.ref}」无阶段 #${phaseIdx}`);
  }
  if (phase.status !== '未启动') {
    return fail('bad_status', `阶段「${phase.name}」当前「${phase.status}」——仅未启动阶段可注资`);
  }
  // 阶段顺序门：前序阶段必须全部完工（串行项目制，D2-A 阶段链）
  const blocking = project.phases.find(p => p.idx < phaseIdx && p.status !== '完工');
  if (blocking) {
    return fail(
      'phase_order',
      `阶段「${phase.name}」不得越级注资：前序阶段「${blocking.name}」（#${blocking.idx}）尚未完工`,
    );
  }

  // 属地工程槽容量门（D21：阶段属地＝theater 轮转基地）
  const base = phaseBase(project, phaseIdx);
  const slotFail = checkSlotGate(state, base, `${project.ref}·${phase.name}`);
  if (slotFail) return fail(slotFail.reason, slotFail.message);

  // 注资双门（资金断＝停摆不暴毙；纳米不足＝开工门 hold，均不改状态）
  const gateFail = checkPhaseGates(state, phaseDef, `${project.ref}·${phase.name}`);
  if (gateFail) return fail(gateFail.reason, gateFail.message);

  // ── 通过：扣账（资金＋纳米）＋投影＋回写阶段 ──
  const phaseNaniteCost = phaseDef.resources?.nanites ?? 0;
  const queues = [...(state.queues ?? [])];
  const projection = buildProjection(project, phase, phaseDef);
  const nextPhase: ProjectPhase = { ...phase, status: '进行中', queue_index: queues.length };
  queues.push(projection);
  const nextProjects: Project[] = projects.map((p, i) =>
    i === projIdx
      ? { ...project, phases: project.phases.map(ph => (ph.idx === phaseIdx ? nextPhase : ph)) }
      : p,
  );
  const next = {
    ...state,
    economy: deductEconomyNanites(state.economy, phaseNaniteCost, availableCredits(state) - (phaseDef.cost ?? 0)),
    queues,
    projects: nextProjects,
  } as S;
  return {
    ok: true,
    next,
    events: [
      {
        type: 'phase_started',
        item: projection.item,
        detail: `阶段 #${phaseIdx} 注资 ${phaseDef.cost ?? 0} 已扣账；纳米 ${phaseNaniteCost} 已扣减；投影项 queued @「${base}」`,
      },
    ],
    projectId: project.id,
  };
}

/* ═══════════════ ③ 里程碑回写（每楼结算后同步；projects[] 缺席零行为变化） ═══════════════ */

export function syncProjects<S extends ProjectStateView>(
  state: S,
  retrofits: readonly RetrofitDef[] = [],
): SyncProjectsResult<S> {
  const projects = state.projects;
  if (!projects || projects.length === 0) return { next: state, events: [] };
  const queues = state.queues ?? [];
  const events: ProjectEvent[] = [];
  const newlyCompleted: { def: RetrofitDef; lead_base: string }[] = [];
  let changed = false;

  const nextProjects = projects.map(project => {
    if (project.status !== '在建' && project.status !== '暂停') return project;
    if (isProjectV2(project)) {
      const synced = syncV2Project(project, queues, events);
      if (synced !== project) changed = true;
      return synced;
    }
    let phasesChanged = false;
    const nextPhases = project.phases.map(phase => {
      if (phase.queue_index === null) return phase;
      const expected = projectionItemName(project.ref, phase.name);
      const resolvedIdx = resolveEngineeringQueueIndex(
        queues,
        phase.queue_index,
        expected,
        phaseBase(project, phase.idx),
        true,
      );
      if (resolvedIdx === null) {
        const rawItem = queues[phase.queue_index];
        events.push({
          type: 'sync_warn',
          item: expected,
          detail: `阶段「${phase.name}」queue_index=${phase.queue_index} 回读身份不符（实读「${rawItem?.item ?? '缺席'}」）——本楼跳过，指针保留`,
        });
        return phase;
      }
      const item = queues[resolvedIdx];
      if (item.status === 'done') {
        phasesChanged = true;
        events.push({
          type: 'phase_milestone',
          item: expected,
          detail: `阶段「${phase.name}」投影项 done → 阶段完工，里程碑回写（queue_index 指针释放）`,
        });
        return { ...phase, status: '完工' as const, queue_index: null };
      }
      if (item.status === 'cancelled') {
        phasesChanged = true;
        events.push({
          type: 'sync_warn',
          item: expected,
          detail: `阶段「${phase.name}」投影项已 cancelled（外部取消路径）→ 阶段置取消；工程保持「${project.status}」，请用取消令走正式结算`,
        });
        return { ...phase, status: '取消' as const, queue_index: null };
      }
      if (resolvedIdx !== phase.queue_index) {
        phasesChanged = true;
        return { ...phase, queue_index: resolvedIdx };
      }
      return phase;
    });
    if (!phasesChanged) return project;
    changed = true;
    if (nextPhases.every(p => p.status === '完工')) {
      const def = retrofits.find(r => canon(r.name) === canon(project.ref));
      if (def) newlyCompleted.push({ def, lead_base: project.lead_base });
      events.push({
        type: 'project_completed',
        item: project.ref,
        detail: `工程「${project.ref}」全部阶段完工 → status=完工，outcome={type:'mark'}（「已改装」标记记账；性能提升由叙事承载，不写 codex）`,
      });
      return { ...project, status: '完工' as const, phases: nextPhases, outcome: { type: 'mark' as const } };
    }
    return { ...project, phases: nextPhases };
  });

  if (!changed) return { next: state, events };
  const nextWithProjects = { ...state, projects: nextProjects } as S;
  const nextWithRetrofitUpgrade = applyRetrofitCompletionUpgrade(nextWithProjects, newlyCompleted);
  return { next: nextWithRetrofitUpgrade, events };
}

/* ═══════════════ ④ 暂停 / 恢复（透传投影项 hold 语义，裁量 e） ═══════════════ */

function setProjectHold<S extends ProjectStateView>(
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
  const expectStatus = hold ? '在建' : '暂停';
  if (isProjectV2(project)) {
    return fail('not_found', `工程实例「${project.id}」为仓段化工程（schema_version 2）——V1 暂停/恢复通道不适用`);
  }
  if (project.status !== expectStatus) {
    return fail(
      'bad_status',
      `工程「${project.ref}」当前「${project.status}」——${hold ? '暂停' : '恢复'}令仅「${expectStatus}」状态可受理`,
    );
  }

  // G4-19：恢复时复验属地工程槽（与 V2 setProjectV2Hold 同口径，复用 checkFreeSlotGate）
  if (!hold) {
    const neededByBase = new Map<string, { count: number; label: string }>();
    for (const ph of project.phases) {
      if (ph.queue_index === null || ph.status !== '暂停') continue;
      const b = phaseBase(project, ph.idx);
      const prev = neededByBase.get(b);
      neededByBase.set(b, { count: (prev?.count ?? 0) + 1, label: prev?.label ?? projectionItemName(project.ref, ph.name) });
    }
    for (const [b, info] of neededByBase) {
      const gateErr = checkFreeSlotGate(state, b, MAIN_SLOT, info.label);
      if (gateErr) return fail(gateErr.reason, gateErr.message);
      const capacity = engSlotCapacityInBase(state, b, MAIN_SLOT) ?? 0;
      const engaged = engagedSlotCount(state, b, MAIN_SLOT.slotId);
      if (engaged + info.count > capacity) {
        return fail('no_slot', `基地「${b}」工程槽容量不足（需 ${info.count} 槽，余 ${capacity - engaged} 槽）——拒恢复`);
      }
    }
  }

  // 投影项 hold 透传（FIX-P1-03：强制校验工程身份并支持下标漂移重定位）
  const rawQueues = state.queues ?? [];
  const resolvedByPhaseIdx = new Map<number, number>();
  const heldIndexes = new Set<number>();
  for (const ph of project.phases) {
    if (ph.queue_index === null) continue;
    const resolved = resolveEngineeringQueueIndex(
      rawQueues,
      ph.queue_index,
      projectionItemName(project.ref, ph.name),
      phaseBase(project, ph.idx),
      false,
    );
    if (resolved !== null) {
      resolvedByPhaseIdx.set(ph.idx, resolved);
      heldIndexes.add(resolved);
    }
  }
  const queues = rawQueues.map((item, idx) => {
    if (!heldIndexes.has(idx)) return item;
    if (item.status !== 'active' && item.status !== 'queued') return item; // settling/done/cancelled 不调度
    if (hold && item.status === 'active') return { ...item, status: 'queued' as const, hold: true };
    return { ...item, hold };
  });
  const nextProjects: Project[] = projects.map((p, i) =>
    i === projIdx
      ? {
          ...project,
          status: (hold ? '暂停' : '在建') as Project['status'],
          phases: project.phases.map(ph => {
            const nextQueueIdx = resolvedByPhaseIdx.get(ph.idx) ?? ph.queue_index;
            if (ph.queue_index !== null && ph.status === (hold ? '进行中' : '暂停')) {
              return {
                ...ph,
                queue_index: nextQueueIdx,
                status: (hold ? '暂停' : '进行中') as ProjectPhase['status'],
              };
            }
            return nextQueueIdx !== ph.queue_index ? { ...ph, queue_index: nextQueueIdx } : ph;
          }),
        }
      : p,
  );
  const next = { ...state, queues, projects: nextProjects } as S;
  return {
    ok: true,
    next,
    events: [
      {
        type: hold ? 'project_paused' : 'project_resumed',
        item: project.ref,
        detail: hold
          ? `工程暂停：在途投影项退回 queued＋hold（进度保留，对齐调度令「暂缓」语义）`
          : `工程恢复：投影项 hold 清除，按数组序重新竞争属地工程槽带宽`,
      },
    ],
    projectId: project.id,
  };
}

export function pauseProject<S extends ProjectStateView>(state: S, projectId: string): ProjectCommandResult<S> {
  return setProjectHold(state, projectId, true);
}

export function resumeProject<S extends ProjectStateView>(state: S, projectId: string): ProjectCommandResult<S> {
  return setProjectHold(state, projectId, false);
}

/* ═══════════════ ⑤ 取消（§3.3 固定结算文案：注资不退、进度作废） ═══════════════ */

export function cancelProject<S extends ProjectStateView>(
  state: S,
  projectId: string,
  def?: RetrofitDef,
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
  if (isProjectV2(project)) {
    return fail('not_found', `工程实例「${project.id}」为仓段化工程（schema_version 2）——V1 取消通道不适用`);
  }
  if (project.status !== '在建' && project.status !== '暂停') {
    return fail('bad_status', `工程「${project.ref}」当前「${project.status}」——取消令仅在建/暂停可受理`);
  }
  if (def && canon(def.name) !== canon(project.ref)) {
    return fail('def_mismatch', `静态定义「${def.name}」与工程 ref「${project.ref}」不符`);
  }

  // 在途投影项 → cancelled（裁量 f + FIX-P1-03 身份核验与漂移重定位）；已完工阶段不动
  const rawQueues = state.queues ?? [];
  const liveIndexes = new Set<number>();
  for (const ph of project.phases) {
    if (ph.queue_index === null) continue;
    const resolved = resolveEngineeringQueueIndex(
      rawQueues,
      ph.queue_index,
      projectionItemName(project.ref, ph.name),
      phaseBase(project, ph.idx),
      false,
    );
    if (resolved !== null) liveIndexes.add(resolved);
  }
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
          phases: project.phases.map(ph =>
            ph.queue_index !== null && (ph.status === '进行中' || ph.status === '暂停')
              ? { ...ph, status: '取消' as const, queue_index: null }
              : ph.queue_index !== null
                ? { ...ph, queue_index: null }
                : ph,
          ),
        }
      : p,
  );
  const next = { ...state, queues, projects: nextProjects } as S;

  // ── §3.3 固定结算文案（UI 确认弹窗复用）：已注资阶段注资不退、在途进度作废 ──
  const fundedPhases = project.phases.filter(
    ph => ph.status === '完工' || ph.status === '进行中' || ph.status === '暂停',
  );
  const names = fundedPhases.map(ph => `「${ph.name}」`).join('、');
  const amounts = def
    ? fundedPhases.map(ph => (def.phases ?? [])[ph.idx]?.cost ?? 0)
    : null;
  const total = amounts ? amounts.reduce((s, v) => s + v, 0) : null;
  const settlementText =
    `工程「${project.ref}」取消结算：已注资 ${fundedPhases.length} 个阶段（${names || '无'}）` +
    (total !== null ? `，注资合计 ${total} 资金` : '，已注资金额') +
    `不予退还；未完成阶段的折算进度全部作废。` +
    `纳米开工门仅为开工校验、从未发生抵扣，纳米库存无变动（D8b/§3.5）。`;

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
