/**
 * modalEngineeringHelpers.ts —— 工程车间弹窗（ModalEngineering.vue）纯数据派生、演示常量与详情载荷辅助
 *
 * 职责：
 * 1. 承载骨架期演示实例常量 MOCK_PROJECTS（MOCK-ENG-UI-01 / MOCK-ENG-V2-07）与筛选/阶段模板常量；
 * 2. 提供目录合并、兵种分类过滤、状态尾标、三态实例分组、阶段阶梯状态、工位解锁提示、立项三门核验清单等纯函数；
 * 3. 构建热点详情与 V1/V2 工程档案详情抽屉（DetailDrawer）只读载荷及指令派发辅助。
 */

import type { ProjectDef, RetrofitDef } from '../../红警指挥系统/core/catalog';
import {
  buildCompletedTechAndProtocolSet,
  type RuntimeProtocolsInput,
} from '../../红警指挥系统/core/catalogRuntimeContext';
import { isDebugBypassPrerequisitesActive } from '../../红警指挥系统/composables/useDebugMode';
import { setHasEquivalentBuilding } from '../../红警指挥系统/core/prerequisites';
import { isProjectV1, isProjectV2, type Project, type ProjectV2, type Schema } from '../../红警指挥系统/core/schema';
import { alignEngineeringActionWithDispatchBus } from '../../红警指挥系统/engines/engOrderBridge';
import { BUILTIN_RETROFIT_UPGRADE_SPECS } from '../../红警指挥系统/engines/projectEngineHelpers';
import type { UnifiedTask } from '../../红警指挥系统/engines/taskOrchestrator';
import {
  ENG_COMMAND_COPY,
  buildAllocateModuleOrder,
  buildInitiateOrder,
  buildOrderForButton,
  buildOrderForV2ModuleButton,
  buildOrderForV2ProjectButton,
  type EngCommandButton,
  type EngModuleCommandButton,
} from '../models/engCommands';
import type { EngSceneHotspotEvent } from '../models/engScene';

export const SHORT_GRADE_FILTERS = [
  { key: 'all' as const, label: '全部' },
  { key: '大改' as const, label: '大改' },
  { key: '中改' as const, label: '中改' },
  { key: '小改' as const, label: '小改' },
] as const;

export type RetrofitCategoryKey = 'all' | 'land' | 'air' | 'naval' | 'facility';

export const SHORT_CATEGORY_FILTERS = [
  { key: 'all' as const, label: '全部' },
  { key: 'land' as const, label: '陆战' },
  { key: 'air' as const, label: '空军' },
  { key: 'naval' as const, label: '海军' },
  { key: 'facility' as const, label: '设施' },
] as const;

export const DEFAULT_PHASE_NAMES_BY_COUNT: Record<number, readonly string[]> = {
  1: ['模块化总成改装'],
  2: ['核心系统换装', '全系统联调验收'],
  3: ['核心总成换装', '信息化火控升级', '整机联调验收'],
  4: ['底盘结构检修', '核心动力换装', '火控防御集成', '整机出厂验收'],
  5: ['底盘拆解检修', '核心动力换装', '武器防御集成', '车际总线联调', '整车出厂验收'],
};

export const SCENE_STATE_LABEL: Record<string, string> = {
  idle: '待命',
  pending: '未启动',
  active: '进行中',
  paused: '暂停',
  done: '完工',
};

// MOCK-ENG-UI-01：骨架期演示常量，快照 projects[] 实装（ENG-PROJ-01）后删除本块与 usingMock 分支
export const MOCK_PROJECTS: Project[] = [
  {
    id: 'proj:mock-grizzly',
    ref: '灰熊坦克现代化改装工程',
    scope: 'base',
    bases: ['beipo'],
    lead_base: 'beipo',
    grade: '大改',
    status: '在建',
    phases: [
      { idx: 0, name: '底盘拆解', status: '完工', queue_index: null },
      { idx: 1, name: '混动APU换装', status: '完工', queue_index: null },
      { idx: 2, name: '主动防御集成', status: '进行中', queue_index: null },
      { idx: 3, name: '车际网络联调', status: '未启动', queue_index: null },
      { idx: 4, name: '出厂验收', status: '未启动', queue_index: null },
    ],
    outcome: { type: 'mark' },
    schema_version: 1,
  },
  {
    id: 'proj:mock-bradley',
    ref: '布拉德利现代化改装工程',
    scope: 'base',
    bases: ['beipo'],
    lead_base: 'beipo',
    grade: '中改',
    status: '规划中',
    phases: [
      { idx: 0, name: '动力包换装', status: '未启动', queue_index: null },
      { idx: 1, name: '全车数字化', status: '未启动', queue_index: null },
      { idx: 2, name: '归族同批验收', status: '未启动', queue_index: null },
    ],
    outcome: { type: 'mark' },
    schema_version: 1,
  },
  {
    id: 'proj:mock-ifv',
    ref: '多功能步兵车现代化改装工程',
    scope: 'base',
    bases: ['yunxi'],
    lead_base: 'yunxi',
    grade: '小改',
    status: '完工',
    phases: [{ idx: 0, name: '模块化接口升级', status: '完工', queue_index: null }],
    outcome: { type: 'mark' },
    schema_version: 1,
  },
  // MOCK-ENG-V2-07：骨架期仓段化 V2 演示实例（五模块五态齐演示；ref 同名 V2 def 时驱动模块网格）
  {
    id: 'proj:空间站仓段化工程@beipo',
    ref: '空间站仓段化工程',
    scope: 'base',
    bases: ['beipo'],
    lead_base: 'beipo',
    grade: '巨构',
    status: '在建',
    modules: [
      { id: 'core', name: '核心舱', status: '完工', base: 'beipo', queue_index: null },
      { id: 'hab', name: '居住舱', status: '进行中', base: 'beipo', queue_index: 0 },
      { id: 'dock', name: '对接舱段', status: '未启动', base: '', queue_index: null },
      { id: 'solar', name: '太阳能翼', status: '暂停', base: 'beipo', queue_index: 1 },
      { id: 'truss', name: '桁架段', status: '取消', base: '', queue_index: null },
    ],
    outcome: { type: 'mark' },
    schema_version: 2,
  },
];

export interface ProjectGroup {
  key: string;
  label: string;
  toneClass: string;
  items: Project[];
}

export interface EngToastChannel {
  success: (msg: string, title: string) => void;
  warning: (msg: string, title: string) => void;
}

export interface CatalogItemBadge {
  text: string;
  tone: 'active' | 'paused' | 'done' | 'ready' | 'locked' | 'neutral';
}

export interface EngineeringGateCheckItem {
  key: 'research' | 'station' | 'budget';
  label: string;
  value: string;
  statusText: string;
  ok: boolean;
  warn: boolean;
}

/** 预载不可用时的 console 降级通知器（无 toast 也能留痕：成功 info / 警示 warn） */
export function consoleToast(): EngToastChannel {
  return {
    success: (msg, title) => console.info(`[${title}] ${msg}`),
    warning: (msg, title) => console.warn(`[${title}] ${msg}`),
  };
}

/** grade 徽标口径：V1 retrofit 必填；V2 project 缺省「巨构」（D-C2，引擎 startProjectV2 同兑底） */
export function defGrade(def: RetrofitDef | ProjectDef): '小改' | '中改' | '大改' | '巨构' {
  return def.kind === 'project' ? (def.grade ?? '巨构') : def.grade;
}

/** D2-A 阶段数：小改 1 / 中改 2~3（取 3 上限演示）/ 大改 4~5（取 5 上限演示）；巨构走 V2 模块网格不进阶梯 */
export function phaseCount(grade: RetrofitDef['grade']): number {
  return grade === '小改' ? 1 : grade === '中改' ? 3 : 5;
}

export function gradeClass(grade: '小改' | '中改' | '大改' | '巨构'): string {
  return grade === '大改'
    ? 'eng-grade-badge--major'
    : grade === '中改'
      ? 'eng-grade-badge--mid'
      : grade === '巨构'
        ? 'eng-grade-badge--mega'
        : 'eng-grade-badge--minor';
}

export function formatNaniteRequirement(nanites: number | undefined): string {
  if (nanites == null || nanites <= 0) return '无需纳米';
  return `${nanites}`;
}

/**
 * 识别改装工程所属兵种/领域分类（陆战 / 空军 / 海军 / 设施）
 */
export function resolveRetrofitCategory(
  def: RetrofitDef | ProjectDef,
): Exclude<RetrofitCategoryKey, 'all'> {
  const preview = resolveRetrofitTargetPreview(def);
  if (preview?.isBuildingRetrofit) return 'facility';

  const builtin =
    BUILTIN_RETROFIT_UPGRADE_SPECS[def.name] ?? BUILTIN_RETROFIT_UPGRADE_SPECS[def.name.trim()];
  const rawTargets =
    def.kind === 'retrofit' ? (def.target_unit ?? builtin?.target_unit) : undefined;
  const rawHosts =
    def.kind === 'retrofit' ? (def.host_building ?? builtin?.host_building) : undefined;
  const targetStr = Array.isArray(rawTargets) ? rawTargets.join(' ') : String(rawTargets ?? '');
  const hostStr = Array.isArray(rawHosts) ? rawHosts.join(' ') : String(rawHosts ?? '');
  const combined = `${def.name} ${targetStr} ${hostStr} ${def.desc ?? ''}`;

  if (
    /阵地|干扰站|发射井|建筑|电站|船坞|防空阵地/.test(combined) ||
    (combined.includes('雷达') &&
      !combined.includes('雷达车') &&
      !/战机|战斗机|轰炸机|驱逐舰|巡洋舰|潜艇|航母|直升机|旋翼/.test(combined))
  ) {
    return 'facility';
  }

  if (
    !/空艇/.test(combined) &&
    /驱逐舰|巡洋舰|潜艇|核潜艇|航母|航空母舰|护卫舰|两栖攻击舰|导弹舰|支援舰|快艇|舰艇|战舰|伯克级|提康德罗加级|洛杉矶级|黄蜂级|小鹰级|尼米兹级|基洛夫级|无畏级|华沙女人/.test(
      combined,
    )
  ) {
    return 'naval';
  }

  if (
    /F-16|F-15|黑鹰|攻击鹰|阵风|阿帕奇|死神|女武神|支奴干|B-52|米格|MiG-|苏-|Su-|图-|Tu-|Ka-52|Mi-28|基洛夫|空艇|直升机|旋翼|战机|战斗机|轰炸机|运输机|截击机|无人机|飞行器|僚机|海雕/i.test(
      combined,
    )
  ) {
    return 'air';
  }

  return 'land';
}

/**
 * 判断 ProjectDef 是否属于天基航天域（空间站 / 轨道 / 天基巨构）
 */
export function isAerospaceProjectDef(def: ProjectDef): boolean {
  const id = (def as { id?: string }).id ?? '';
  const name = def.name ?? '';
  const scene = def.scene ?? '';
  return (
    id === 'common.project.orbital_station' ||
    id === 'common.project.orbital_space_station' ||
    name === '轨道空间站' ||
    name === '空间站' ||
    name.includes('空间站') ||
    name.includes('轨道') ||
    name.includes('天基') ||
    name.includes('月球') ||
    name.includes('月面') ||
    scene.includes('station') ||
    scene.includes('aerospace')
  );
}

/**
 * 过滤掉《通用·航天工业_世界书.json》uid=35 遗留的旧版 3 舱段「空间站」（common.project.orbital_space_station），
 * 统一归一到《工程·通用_世界书.json》uid=1 正式版 5 舱段「轨道空间站」（common.project.orbital_station）
 */
export function deduplicateSpaceStationCatalog(defs: readonly ProjectDef[]): ProjectDef[] {
  const hasCanonicalOrbitalStation = defs.some(
    d => (d as { id?: string }).id === 'common.project.orbital_station' || d.name === '轨道空间站',
  );
  if (!hasCanonicalOrbitalStation) return [...defs];
  return defs.filter(
    d => (d as { id?: string }).id !== 'common.project.orbital_space_station' && d.name !== '空间站',
  );
}

/** V2 仓段化静态目录（worldbookCatalogParser projects 桶 + 实时在建 V2 动态实例补齐 + 空间站双条目去重） */
export function buildDynamicProjectCatalog(
  catalogProjects: readonly ProjectDef[] | undefined,
  catalogRetrofits: readonly RetrofitDef[],
  snapshotProjects: readonly Project[] | undefined,
): ProjectDef[] {
  const baseList = deduplicateSpaceStationCatalog(catalogProjects ?? []);
  const hasCanonicalOrbitalStation = baseList.some(
    d => (d as { id?: string }).id === 'common.project.orbital_station' || d.name === '轨道空间站',
  );
  const knownNames = new Set<string>([
    ...baseList.map(d => d.name),
    ...catalogRetrofits.map(d => d.name),
  ]);
  if (hasCanonicalOrbitalStation) {
    knownNames.add('空间站');
  }
  for (const p of snapshotProjects ?? []) {
    if (!knownNames.has(p.ref) && (isProjectV2(p) || p.grade === '巨构')) {
      knownNames.add(p.ref);
      baseList.push({
        kind: 'project',
        name: p.ref,
        grade: p.grade ?? '巨构',
        scope: p.scope,
        desc: `战区在途战略工程「${p.ref}」（实时战局实例同步）。`,
        modules: isProjectV2(p)
          ? p.modules.map(m => ({ id: m.id, name: m.name || m.id, cost: 0, prereqs: [] }))
          : [{ id: 'core', name: '核心模块', cost: 0, prereqs: [] }],
      } as unknown as ProjectDef);
    }
  }
  return baseList;
}

export function filterShortCatalogDefs(
  shortCatalog: readonly (RetrofitDef | ProjectDef)[],
  gradeFilter: 'all' | '大改' | '中改' | '小改',
  rawQuery: string,
  categoryFilter: RetrofitCategoryKey = 'all',
): (RetrofitDef | ProjectDef)[] {
  const q = rawQuery.toLowerCase();
  return shortCatalog.filter(def => {
    if (gradeFilter !== 'all' && defGrade(def) !== gradeFilter) return false;
    if (categoryFilter !== 'all' && resolveRetrofitCategory(def) !== categoryFilter) return false;
    if (!q) return true;
    const research = def.kind === 'project' ? (def.requirements?.research ?? '') : def.research;
    return def.name.toLowerCase().includes(q) || research.toLowerCase().includes(q);
  });
}

export function filterLongProjectCatalogDefs(
  longProjectCatalog: readonly ProjectDef[],
  rawQuery: string,
): ProjectDef[] {
  const q = rawQuery.toLowerCase();
  if (!q) return [...longProjectCatalog];
  return longProjectCatalog.filter(def => {
    const research = def.requirements?.research ?? '';
    return def.name.toLowerCase().includes(q) || research.toLowerCase().includes(q);
  });
}

export function resolveSelectedCatalogDef(
  selectedName: string | null,
  effectiveScopeTab: 'short' | 'long' | 'space',
  shortCatalog: readonly (RetrofitDef | ProjectDef)[],
  longProjectCatalog: readonly ProjectDef[],
  spaceProjectCatalog: readonly ProjectDef[] = [],
): RetrofitDef | ProjectDef | null {
  const allSelectable = [...shortCatalog, ...longProjectCatalog, ...spaceProjectCatalog];
  if (selectedName) {
    const exact = allSelectable.find(d => d.name === selectedName);
    if (exact) return exact;
  }
  const list =
    effectiveScopeTab === 'short'
      ? shortCatalog
      : effectiveScopeTab === 'space'
        ? spaceProjectCatalog
        : longProjectCatalog;
  return list[0] ?? allSelectable[0] ?? null;
}

export function computeEngProgressPair(
  selectedIsV2: boolean,
  selectedDef: RetrofitDef | ProjectDef | null,
  usingMock: boolean,
  v1DoneCount: number,
  v1TotalCount: number,
  v2DoneCount: number,
  v2TotalCount: number,
): { now: number; pct: string } {
  if (!selectedIsV2) {
    if (!selectedDef || usingMock) return { now: 0, pct: '0%' };
    const pct = v1TotalCount > 0 ? Math.round((v1DoneCount / v1TotalCount) * 100) : 0;
    return { now: pct, pct: `${pct}%` };
  }
  const pct = v2TotalCount > 0 ? Math.round((v2DoneCount / v2TotalCount) * 100) : 0;
  return { now: pct, pct: `${pct}%` };
}

/**
 * FIX-P1-03（08 [P1-4]）：判定当前快照是否包含实时战局状态
 */
export function checkHasLiveRuntimeState(snap: Schema | null | undefined): boolean {
  if (!snap) return false;
  return Boolean(
    snap.meta?.world_id ||
      (snap.queues && snap.queues.length > 0) ||
      (snap.tech?.done && snap.tech.done.length > 0) ||
      (snap.economy?.credits && snap.economy.credits > 0) ||
      Object.keys(snap.protocols ?? {}).length > 0,
  );
}

export function resolveUsingMock(
  demoMode: boolean | 'auto' | undefined,
  realProjectsCount: number,
  hasLiveState: boolean,
): boolean {
  if (demoMode === true) return true;
  if (demoMode === false) return false;
  if (realProjectsCount > 0) return false;
  return !hasLiveState;
}

export function buildProjectGroups(list: readonly Project[]): ProjectGroup[] {
  return [
    { key: 'active', label: '进行中', toneClass: 'eng-tone--run', items: list.filter(p => p.status === '在建') },
    {
      key: 'planning',
      label: '规划中',
      toneClass: 'eng-tone--idle',
      items: list.filter(p => p.status === '规划中' || p.status === '暂停'),
    },
    {
      key: 'done',
      label: '已完工',
      toneClass: 'eng-tone--ok',
      items: list.filter(p => p.status === '完工' || p.status === '取消'),
    },
  ];
}

export function resolveProjectDisplayName(
  p: Project,
  retrofits: readonly RetrofitDef[],
  projects: readonly ProjectDef[] | undefined,
): string {
  const projList = projects ?? [];
  return retrofits.find(d => d.name === p.ref)?.name ?? projList.find(d => d.name === p.ref)?.name ?? p.ref;
}

/** 实例卡概要：V1 线性=阶段 x/y；V2 仓段化=模块 x/y（isProjectV1/isProjectV2 分支，V2-07） */
export function formatPhaseSummary(p: Project): string {
  if (isProjectV2(p)) {
    const done = p.modules.filter(m => m.status === '完工').length;
    return `模块 ${done}/${p.modules.length}`;
  }
  if (!isProjectV1(p)) return '——';
  const done = p.phases.filter(ph => ph.status === '完工').length;
  return `阶段 ${done}/${p.phases.length}`;
}

export function resolvePhaseStepName(
  def: RetrofitDef | ProjectDef,
  phaseIdx: number,
  totalPhases: number,
  activeV1Proj: Project | null,
): string {
  if (activeV1Proj && isProjectV1(activeV1Proj) && activeV1Proj.phases[phaseIdx]?.name) {
    return activeV1Proj.phases[phaseIdx].name;
  }
  if (def.kind === 'retrofit' && def.phases?.[phaseIdx]?.name) {
    return def.phases[phaseIdx].name;
  }
  const template = DEFAULT_PHASE_NAMES_BY_COUNT[totalPhases] ?? DEFAULT_PHASE_NAMES_BY_COUNT[5];
  return template[phaseIdx] ?? `阶段 #${phaseIdx + 1}`;
}

export function resolvePhaseStepClass(phaseIdx: number, activeV1Proj: Project | null): Record<string, boolean> {
  const st = activeV1Proj && isProjectV1(activeV1Proj) ? activeV1Proj.phases[phaseIdx]?.status : undefined;
  return {
    'eng-phase-step--done': st === '完工',
    'eng-phase-step--active': st === '进行中',
    'eng-phase-step--paused': st === '暂停',
    'eng-phase-step--pending': !st || st === '未启动' || st === '取消',
  };
}

export function resolvePhaseStepStateText(phaseIdx: number, activeV1Proj: Project | null): string {
  const st = activeV1Proj && isProjectV1(activeV1Proj) ? activeV1Proj.phases[phaseIdx]?.status : undefined;
  if (!st || st === '未启动') return '';
  return st;
}

export interface CatalogUnlockPrecomputed {
  completedTechSet?: ReadonlySet<string>;
  completedBuildingsSet?: ReadonlySet<string>;
  projectByRef?: ReadonlyMap<string, Project>;
}

const completedBuildingsCache = new WeakMap<object, Set<string>>();
const projectsByRefCache = new WeakMap<object, Map<string, Project>>();

export function buildCompletedBuildingsSet(
  bases?: ReadonlyArray<{ buildings?: ReadonlyArray<{ name: string; state?: string }> }>,
): Set<string> {
  if (!bases || bases.length === 0) return new Set<string>();
  const cached = completedBuildingsCache.get(bases);
  if (cached) return cached;
  const completedBuildings = new Set<string>();
  for (const base of bases) {
    for (const b of base?.buildings ?? []) {
      const name = b?.name?.trim();
      if (!name || b.state === '建造中' || b.state === '损毁' || b.state === '被毁') continue;
      completedBuildings.add(name);
      const m = /^(?:盟军|苏联|苏军|苏维埃|尤里)(.+)$/.exec(name);
      const stripped = m?.[1]?.trim();
      if (stripped && stripped.length >= 2) completedBuildings.add(stripped);
    }
  }
  completedBuildingsCache.set(bases, completedBuildings);
  return completedBuildings;
}

function getProjectsByRefMap(projects: readonly Project[]): Map<string, Project> {
  const cached = projectsByRefCache.get(projects);
  if (cached) return cached;
  const map = new Map<string, Project>();
  for (const p of projects) {
    if (p?.ref && !map.has(p.ref)) {
      map.set(p.ref, p);
    }
  }
  projectsByRefCache.set(projects, map);
  return map;
}

export function buildCatalogUnlockPrecomputed(
  projects: readonly Project[],
  doneTech?: readonly string[],
  protocols?: unknown,
  bases?: ReadonlyArray<{ buildings?: ReadonlyArray<{ name: string; state?: string }> }>,
): CatalogUnlockPrecomputed {
  return {
    completedTechSet: buildCompletedTechAndProtocolSet(doneTech ?? [], protocols as RuntimeProtocolsInput),
    completedBuildingsSet: buildCompletedBuildingsSet(bases),
    projectByRef: getProjectsByRefMap(projects),
  };
}

export function checkIsResearchUnlocked(
  research: string | undefined,
  doneList: readonly string[] | undefined,
  protocols?: unknown,
  precomputed?: CatalogUnlockPrecomputed,
): boolean {
  if (isDebugBypassPrerequisitesActive()) return true;
  const req = research?.trim();
  if (!req) return true;
  const completedSet =
    precomputed?.completedTechSet ??
    buildCompletedTechAndProtocolSet(doneList ?? [], protocols as RuntimeProtocolsInput);
  return completedSet.has(req);
}

function checkHasRequiredRetrofitBuilding(
  needBuilding: string | undefined,
  bases?: ReadonlyArray<{ buildings?: ReadonlyArray<{ name: string; state?: string }> }>,
  precomputed?: CatalogUnlockPrecomputed,
): boolean {
  if (isDebugBypassPrerequisitesActive()) return true;
  const req = needBuilding?.trim();
  if (!req || !bases || bases.length === 0) return true;
  const completedBuildings = precomputed?.completedBuildingsSet ?? buildCompletedBuildingsSet(bases);
  return setHasEquivalentBuilding(completedBuildings as Set<string>, req);
}

export function resolveCatalogItemDotClass(
  def: RetrofitDef | ProjectDef,
  projects: readonly Project[],
  hasLiveState: boolean,
  doneTech: readonly string[] | undefined,
  protocols?: unknown,
  bases?: ReadonlyArray<{ buildings?: ReadonlyArray<{ name: string; state?: string }> }>,
  precomputed?: CatalogUnlockPrecomputed,
): string {
  const inst = (precomputed?.projectByRef ?? getProjectsByRefMap(projects)).get(def.name);
  if (inst?.status === '在建') return 'eng-item-dot--active';
  if (inst?.status === '完工') return 'eng-item-dot--done';
  if (inst?.status === '暂停' || inst?.status === '规划中') return 'eng-item-dot--paused';
  const reqTech = def.kind === 'project' ? def.requirements?.research : def.research;
  if (hasLiveState && reqTech && !checkIsResearchUnlocked(reqTech, doneTech, protocols, precomputed)) {
    return 'eng-item-dot--locked';
  }
  const needBld = (def as { need_building?: string }).need_building;
  if (hasLiveState && def.kind === 'retrofit' && needBld && !checkHasRequiredRetrofitBuilding(needBld, bases, precomputed)) {
    return 'eng-item-dot--locked';
  }
  return 'eng-item-dot--ready';
}

export function resolveCatalogItemBadge(
  def: RetrofitDef | ProjectDef,
  projects: readonly Project[],
  hasLiveState: boolean,
  doneTech?: readonly string[],
  protocols?: unknown,
  bases?: ReadonlyArray<{ buildings?: ReadonlyArray<{ name: string; state?: string }> }>,
  precomputed?: CatalogUnlockPrecomputed,
): CatalogItemBadge {
  const inst = (precomputed?.projectByRef ?? getProjectsByRefMap(projects)).get(def.name);
  if (inst?.status === '在建') return { text: '施工中', tone: 'active' };
  if (inst?.status === '暂停' || inst?.status === '规划中') return { text: '已暂停', tone: 'paused' };
  if (inst?.status === '完工') return { text: '已完工', tone: 'done' };
  if (hasLiveState) {
    const reqTech = def.kind === 'project' ? def.requirements?.research : def.research;
    if (reqTech && !checkIsResearchUnlocked(reqTech, doneTech, protocols, precomputed)) {
      return { text: '缺理论', tone: 'locked' };
    }
    const needBld = (def as { need_building?: string }).need_building;
    if (def.kind === 'retrofit' && needBld && !checkHasRequiredRetrofitBuilding(needBld, bases, precomputed)) {
      return { text: '缺理论', tone: 'locked' };
    }
    return { text: '可立项', tone: 'ready' };
  }
  return { text: '待命', tone: 'neutral' };
}

export function resolveCatalogItemStatusTitle(
  def: RetrofitDef | ProjectDef,
  projects: readonly Project[],
  hasLiveState: boolean,
  doneTech: readonly string[] | undefined,
  protocols?: unknown,
  bases?: ReadonlyArray<{ buildings?: ReadonlyArray<{ name: string; state?: string }> }>,
  precomputed?: CatalogUnlockPrecomputed,
): string {
  const inst = (precomputed?.projectByRef ?? getProjectsByRefMap(projects)).get(def.name);
  if (inst) return `实例状态：${inst.status}`;
  const reqTech = def.kind === 'project' ? def.requirements?.research : def.research;
  if (hasLiveState && reqTech && !checkIsResearchUnlocked(reqTech, doneTech, protocols, precomputed)) {
    return `待解锁前置理论：${reqTech}`;
  }
  const needBld = (def as { need_building?: string }).need_building;
  if (hasLiveState && def.kind === 'retrofit' && needBld && !checkHasRequiredRetrofitBuilding(needBld, bases, precomputed)) {
    return `待部署前置建筑：${needBld}`;
  }
  return '具备立项条件';
}

export function isOrbitalStation(st: { domain?: string; laneKey?: string; displayName?: string }): boolean {
  return Boolean(
    st.domain === 'eng.orbital' ||
      st.laneKey?.includes('eng.orbital') ||
      st.displayName?.includes('轨道'),
  );
}

export function resolveStationUnlockHint(st: { domain?: string; laneKey?: string; displayName?: string }): string {
  if (isOrbitalStation(st)) return '太空指挥中心 / 航天发射场';
  return '维修车间 / 工程船坞';
}

export function resolveBaseDisplayNameFromList(
  baseId: string,
  bases: ReadonlyArray<{ id?: string; name?: string }> | undefined,
): string {
  if (!baseId) return '';
  return bases?.find(b => b.id === baseId)?.name ?? baseId;
}

export function resolveUtoActiveEtaText(
  proj: Project | null,
  usingMock: boolean,
  scheduledTasks: readonly UnifiedTask[],
): string {
  if (!proj || usingMock) return '—';
  const task = scheduledTasks.find(t => t.metadata?.projectId === proj.id);
  if (!task) return '—';
  const eta = typeof task.metadata?.eta === 'string' && task.metadata.eta.trim().length > 0 ? task.metadata.eta : null;
  return eta ?? '—';
}

export function resolveInitiateHints(target: { enabled: boolean; base: string; hint: string }) {
  return {
    v2InitiateHint: target.enabled ? ENG_COMMAND_COPY.v2.hint.initiate(target.base) : target.hint,
    friendlyInitiateHint: target.enabled
      ? `立项核准：校验前置理论、首阶段资金与车间工位 · 牵头基地「${target.base}」（指令将填入下方输入框）`
      : target.hint,
    friendlyV2InitiateHint: target.enabled
      ? `巨构立项条件（前置理论 / 首期资金 / 轨道泊位）已满足 · 牵头基地「${target.base}」`
      : target.hint,
  };
}

/**
 * 构建右侧【立项三门核验清单】结构化条目（前置理论 / 工程工位 / 资金与纳米预算）
 */
export function buildEngineeringGateChecklist(
  def: RetrofitDef | ProjectDef | null | undefined,
  snapshot: Schema | null | undefined,
  hasLiveState: boolean,
  initiateTarget: { enabled: boolean; base: string; hint: string },
): EngineeringGateCheckItem[] {
  const reqResearch =
    def?.kind === 'project' ? (def.requirements?.research ?? '') : (def?.research ?? '');
  const researchUnlocked =
    !reqResearch ||
    checkIsResearchUnlocked(reqResearch, snapshot?.tech?.done, snapshot?.protocols);
  const researchOk = hasLiveState ? researchUnlocked : true;
  const researchWarn = hasLiveState && Boolean(reqResearch) && !researchUnlocked;
  const researchStatusText = !reqResearch
    ? '✓ 免前置'
    : hasLiveState
      ? researchUnlocked
        ? '✓ 已掌握'
        : '⚠ 未研发'
      : '待核验';

  const stationOk = initiateTarget.enabled || !hasLiveState;
  const stationWarn = hasLiveState && !initiateTarget.enabled;
  const stationValue =
    initiateTarget.enabled && initiateTarget.base
      ? `牵头基地 · ${initiateTarget.base}`
      : def?.kind === 'project'
        ? (def.requirements?.building ?? '轨道组装泊位')
        : '属地工程车间';
  const stationStatusText = initiateTarget.enabled
    ? '✓ 工位就绪'
    : hasLiveState
      ? '⚠ 缺可用基地'
      : '待指派';

  const cost = def?.cost;
  const nanites =
    def?.kind === 'project' ? def.requirements?.nanites : def?.resources?.nanites;
  const costText = cost != null ? `$${cost}` : '待勘测';
  const naniteText = formatNaniteRequirement(nanites);
  const credits = snapshot?.economy?.credits;
  const enoughCredits =
    !hasLiveState || cost == null || (typeof credits === 'number' && credits >= cost);
  const budgetOk = enoughCredits;
  const budgetWarn = hasLiveState && !enoughCredits;
  const budgetStatusText = !hasLiveState
    ? '定额标准'
    : enoughCredits
      ? '✓ 预算充足'
      : `⚠ 资金不足（当前 $${credits ?? 0}）`;

  return [
    {
      key: 'research',
      label: '前置理论',
      value: reqResearch || '无前置要求',
      statusText: researchStatusText,
      ok: researchOk,
      warn: researchWarn,
    },
    {
      key: 'station',
      label: '工程工位',
      value: stationValue,
      statusText: stationStatusText,
      ok: stationOk,
      warn: stationWarn,
    },
    {
      key: 'budget',
      label: '资金与纳米预算',
      value: `资金 ${costText} · 纳米 ${naniteText}`,
      statusText: budgetStatusText,
      ok: budgetOk,
      warn: budgetWarn,
    },
  ];
}

/** 构造各类工程指令文本并通过宿主输入通道下发 */
export function dispatchEngOrderWithToast(
  buildText: () => string,
  channelFn: (text: string) => string,
  loadedToast: EngToastChannel | null,
  toastTitle: string,
  successPrefix: string,
): void {
  const toastr: EngToastChannel = loadedToast ?? consoleToast();
  try {
    const orderText = buildText();
    if (channelFn(orderText) === 'failed') {
      toastr.warning('宿主输入栏与 /setinput 均不可达，指令未载入', toastTitle);
      return;
    }
    toastr.success(`${successPrefix}：${orderText}`, toastTitle);
  } catch (err) {
    toastr.warning(String(err), '工程指令拼装失败');
  }
}

export function buildInitiateOrderText(defName: string, baseId: string): string {
  return buildInitiateOrder(defName, baseId);
}

export function buildV1ProjectOrderText(
  btn: EngCommandButton,
  projectId: string,
  utoTasks: readonly UnifiedTask[],
): string {
  const aligned = alignEngineeringActionWithDispatchBus(
    { verb: btn.verb, projectId, phaseIdx: btn.phaseIdx ?? undefined },
    utoTasks,
  );
  return buildOrderForButton(btn, projectId) || aligned.commandText;
}

export function buildV2ProjectOrderText(
  btn: EngCommandButton,
  projectId: string,
  utoTasks: readonly UnifiedTask[],
): string {
  const aligned = alignEngineeringActionWithDispatchBus(
    { verb: btn.verb, projectId, isV2ProjectLevel: true },
    utoTasks,
  );
  return buildOrderForV2ProjectButton(btn, projectId) || aligned.commandText;
}

export function buildV2ModuleOrderText(
  btn: EngModuleCommandButton,
  projectId: string,
  utoTasks: readonly UnifiedTask[],
): string {
  const aligned = alignEngineeringActionWithDispatchBus(
    { verb: btn.verb, projectId, moduleId: btn.moduleId, moduleName: btn.moduleName },
    utoTasks,
  );
  return buildOrderForV2ModuleButton(btn, projectId) || aligned.commandText;
}

export function buildV2AllocateOrderText(
  projectId: string,
  moduleId: string,
  moduleName: string,
  baseTarget: string,
  utoTasks: readonly UnifiedTask[],
): string {
  const aligned = alignEngineeringActionWithDispatchBus(
    { verb: '指派', projectId, moduleId, moduleName, baseId: baseTarget },
    utoTasks,
  );
  return buildAllocateModuleOrder(projectId, moduleName, baseTarget) || aligned.commandText;
}

/** 热点点击 → DetailDrawer 纯读取信息载荷 */
export function buildSceneHotspotDetailPayload(h: EngSceneHotspotEvent, projectName: string | undefined) {
  return {
    title: h.label,
    kind: '工程场景热点',
    params: [
      ['改装部位', h.label],
      ['阶段状态', SCENE_STATE_LABEL[h.state] ?? h.state],
      ['所属工程', projectName ?? '——'],
    ] as [string, string][],
    desc: h.desc || '——',
    note: '车间总成工位 · 实时工况（生产调度与改装条令由总参指令闭环下达）',
  };
}

/** V1 单工程详情抽屉只读载荷 */
export interface RetrofitTargetPreview {
  targetLabel: string;
  upgradedLabel: string;
  isBuildingRetrofit: boolean;
  inServiceCount?: number;
}

function countMatchingTokens(tokens: readonly string[] | undefined, targets: readonly string[]): number {
  if (!Array.isArray(tokens) || targets.length === 0) return 0;
  let total = 0;
  for (const raw of tokens) {
    const token = String(raw ?? '').trim();
    if (!token) continue;
    const matched = targets.some(t => {
      const target = t.trim();
      if (!target) return false;
      if (token === target) return true;
      if (token.startsWith(target)) {
        const rest = token.slice(target.length);
        return !rest || /^[\s(（×xX*]/.test(rest);
      }
      return false;
    });
    if (matched) {
      const multMatch = /[×xX*]\s*(\d+)/.exec(token);
      total += multMatch ? Math.max(1, Number(multMatch[1]) || 1) : 1;
    }
  }
  return total;
}

function countMatchingRecord(
  rec: Readonly<Record<string, number>> | undefined,
  targets: readonly string[],
): number {
  if (!rec || targets.length === 0) return 0;
  let total = 0;
  for (const [k, v] of Object.entries(rec)) {
    const key = k.trim();
    if (targets.some(t => t.trim() === key)) {
      total += Math.max(0, Number(v) || 0);
    }
  }
  return total;
}

function computeInServiceTargetCount(
  snapshot: Schema | null | undefined,
  targets: readonly string[],
  isBuildingRetrofit: boolean,
): number {
  if (!snapshot || targets.length === 0) return 0;
  let count = 0;
  if (isBuildingRetrofit) {
    for (const base of snapshot.bases ?? []) {
      if (!base || base.status === '废弃') continue;
      for (const bld of base.buildings ?? []) {
        const bldName = bld?.name?.trim() ?? '';
        if (bldName && targets.some(t => t.trim() === bldName)) {
          count += 1;
        }
      }
    }
    return count;
  }

  const topForces = snapshot.forces as
    | {
        troops?: Readonly<Record<string, number>>;
        infantry?: Readonly<Record<string, number>>;
        vehicles?: readonly string[];
        aircraft?: readonly string[];
      }
    | undefined;
  if (topForces) {
    count += countMatchingRecord(topForces.troops, targets);
    count += countMatchingRecord(topForces.infantry, targets);
    count += countMatchingTokens(topForces.vehicles, targets);
    count += countMatchingTokens(topForces.aircraft, targets);
  }

  for (const base of snapshot.bases ?? []) {
    if (!base || base.status === '废弃') continue;
    const baseForces = (base as unknown as {
      forces?: {
        troops?: Readonly<Record<string, number>>;
        infantry?: Readonly<Record<string, number>>;
        vehicles?: readonly string[];
        aircraft?: readonly string[];
      };
    }).forces;
    if (baseForces) {
      count += countMatchingRecord(baseForces.troops, targets);
      count += countMatchingRecord(baseForces.infantry, targets);
      count += countMatchingTokens(baseForces.vehicles, targets);
      count += countMatchingTokens(baseForces.aircraft, targets);
    }
  }
  return count;
}

/**
 * FD-22：解析 V1 现代化改装工程的改装对象（target_unit / host_building）、完工后高级型号（upgraded_name）及当前存档在役数量
 */
export function resolveRetrofitTargetPreview(
  def: RetrofitDef | ProjectDef | null | undefined,
  snapshot?: Schema | null,
): RetrofitTargetPreview | null {
  if (!def || def.kind === 'project') return null;
  const builtin = BUILTIN_RETROFIT_UPGRADE_SPECS[def.name] ?? BUILTIN_RETROFIT_UPGRADE_SPECS[def.name.trim()];
  const rawTargets = def.target_unit ?? builtin?.target_unit;
  const rawHosts = def.host_building ?? builtin?.host_building;
  const targetList =
    typeof rawTargets === 'string'
      ? [rawTargets]
      : Array.isArray(rawTargets)
        ? rawTargets
        : [];
  const hostList =
    typeof rawHosts === 'string'
      ? [rawHosts]
      : Array.isArray(rawHosts)
        ? rawHosts
        : [];
  const isBuildingRetrofit = hostList.length > 0 && targetList.length === 0;
  const effectiveTargets = targetList.length > 0 ? targetList : hostList;
  if (effectiveTargets.length === 0) return null;

  let upgradedLabel = '';
  if (typeof def.upgraded_name === 'string') {
    upgradedLabel = def.upgraded_name.trim();
  } else if (def.upgraded_name && typeof def.upgraded_name === 'object') {
    upgradedLabel = Object.values(def.upgraded_name).join(' / ');
  } else if (builtin?.upgraded_name) {
    upgradedLabel = builtin.upgraded_name;
  }
  if (!upgradedLabel) return null;

  if (snapshot === undefined) {
    return {
      targetLabel: effectiveTargets.join(' / '),
      upgradedLabel,
      isBuildingRetrofit,
    };
  }

  const inServiceCount = computeInServiceTargetCount(snapshot, effectiveTargets, isBuildingRetrofit);

  return {
    targetLabel: effectiveTargets.join(' / '),
    upgradedLabel,
    isBuildingRetrofit,
    inServiceCount,
  };
}

export function buildProjectDetailPayload(
  p: Project,
  title: string,
  def: RetrofitDef | undefined,
  bases: ReadonlyArray<{ id?: string; name?: string }> | undefined,
) {
  const baseName = (id: string) => bases?.find(b => b.id === id)?.name ?? id;
  const preview = resolveRetrofitTargetPreview(def);
  const params: [string, string][] = [
    ['状态', p.status],
    ['等级', `${p.grade} · ${p.scope === 'theater' ? '长期多基地' : '短期单基地'}`],
    ['阶段', formatPhaseSummary(p)],
    ['牵头基地', p.lead_base ? baseName(p.lead_base) : '——'],
    ['参与基地', p.bases.length > 0 ? p.bases.map(baseName).join('、') : '——'],
    ['资金占用', def?.cost != null ? `$${def.cost}` : '待勘测'],
    ['纳米占用', String(def?.resources?.nanites ?? '待勘测')],
  ];
  if (preview) {
    params.push([preview.isBuildingRetrofit ? '改装设施' : '改装对象', preview.targetLabel]);
    params.push(['升级后型号', preview.upgradedLabel]);
  }
  return {
    title,
    kind: '工程',
    params,
    desc: def?.desc ?? '——',
    note: '战区改装总成档案 · 制造产线工况核准快照（立项与调度条令由指挥中枢统发）',
    eng: { project: p, def: def ?? null },
  };
}

/** V2 仓段化工程详情抽屉只读载荷 */
export function buildProjectDetailV2Payload(
  p: ProjectV2,
  title: string,
  def: ProjectDef | undefined,
  bases: ReadonlyArray<{ id?: string; name?: string }> | undefined,
) {
  const baseName = (id: string) => bases?.find(b => b.id === id)?.name ?? id;
  return {
    title,
    kind: '工程',
    params: [
      ['状态', p.status],
      ['等级', `${p.grade} · ${p.scope === 'theater' ? '长期多基地' : '短期单基地'} · 仓段化`],
      ['模块', formatPhaseSummary(p)],
      ['牵头基地', p.lead_base ? baseName(p.lead_base) : '——'],
      ['参与基地', p.bases.length > 0 ? p.bases.map(baseName).join('、') : '——'],
      ['资金占用', def?.cost != null ? `$${def.cost}` : '待勘测'],
      ['纳米占用', String(def?.requirements?.nanites ?? '待勘测')],
      ['模块拓扑', p.modules.map(m => `${m.name || m.id}·${m.status}`).join('、')],
    ] as [string, string][],
    desc: def?.desc ?? '——',
    note: '仓段化重工巨构档案 · 模块拓扑装配工况快照（分体注资与战区排产条令在模块网格下达）',
  };
}
