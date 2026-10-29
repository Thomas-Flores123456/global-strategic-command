/**
 * modalScheduleHelpers.ts
 * 战区工务与产能调度中枢（ModalSchedule.vue）六动词即时编排与产线双模切换辅助模块
 *
 * 纪律与红线：
 * - 纯函数数据变换不原地修改入参，永不篡改 spent_minutes 与 progress；
 * - 变量落盘唯一通过注入的 updateFloorVars 执行，组件与辅助层零宿主直写调用；
 * - 全部回执文案采用干练军事指挥官视角。
 */
import type { updateFloorVars as UpdateFloorVarsFn } from '../host/floorVarWrite';
import type { ExtendedScheduleVerb } from '../models/dispatchOrderText';

function notifyToastSuccess(msg: string, title: string): void {
  const hostToastr = (
    globalThis as { toastr?: { success?: (message: string, header?: string) => void } }
  ).toastr;
  hostToastr?.success?.(msg, title);
}

export interface ScheduleCatalogItemLike {
  id?: string;
  name: string;
  cost?: number;
  aliases?: readonly string[];
  phases?: ReadonlyArray<{ name: string; cost?: number }>;
  modules?: ReadonlyArray<{ id?: string; name: string; cost?: number }>;
}

export interface ScheduleCatalogLike {
  buildings?: readonly ScheduleCatalogItemLike[];
  productions?: readonly ScheduleCatalogItemLike[];
  researches?: readonly ScheduleCatalogItemLike[];
  retrofits?: readonly ScheduleCatalogItemLike[];
  projects?: readonly ScheduleCatalogItemLike[];
}

export interface ScheduleMutationContext {
  snapshot?: Record<string, unknown> | null;
  dataStore?: { data?: unknown };
  floating?: { floorId: number | null | undefined; refresh: () => Promise<unknown> | unknown };
  catalog?: ScheduleCatalogLike | null;
  updateFloorVars: typeof UpdateFloorVarsFn;
  onTick?: () => void;
}

export interface QueueScheduleMutationAction {
  verb: ExtendedScheduleVerb;
  item: string;
  type?: string;
  base?: string;
  taskId?: string;
  queueIndex?: number;
  allocateBase?: string;
  capacity?: number;
}

export interface ScheduleLaneBuildingInstanceRef {
  baseIndex: number;
  buildingIndex: number;
  name: string;
  mode: '生产' | '加速';
  accelScope?: 'global' | 'base';
}

type RawRecord = Record<string, unknown>;

function isImmuneStatus(status: unknown): boolean {
  return status === 'settling' || status === 'done' || status === 'cancelled';
}

const PROD_SUBLANE_NAME_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/战机|飞机|飞艇|空艇|基洛夫|直升机|无人机|侦察机|轰炸机|运输机|飞行器|入侵者|黑鹰|夜鹰|米格|苏霍伊|幽浮|飞碟/, 'lane.vehicle_air'],
  [/潜艇|航母|驱逐舰|巡洋舰|护卫舰|战列舰|无畏|神盾|海豚|乌贼|海蝎|气垫船|登陆艇|快艇|舰|船|艇/, 'lane.vehicle_naval'],
  [
    /坦克|装甲|机甲|战车|履带|基地车|MCV|采矿车|矿车|天启|犀牛|灰熊|光棱|幻影|磁能|V3|火箭发射车|防空车|步兵车|IFV|蜘蛛|恐怖机器人|自爆卡车|卡车|吉普|摩托|火炮|机动平台|突击车|控制车|磁电|盖特/i,
    'lane.vehicle_land',
  ],
  [
    /步兵|动员兵|大兵|工程兵|工程师|间谍|狙击|军犬|警犬|尤里新兵|新兵|复制人|士兵|军官|机娘|突击队|医疗|兵种|飞行兵|火箭飞行兵|海豹|谭雅|鲍里斯|伊文|恐怖分子|辐射工兵|防空步兵|磁暴步兵|心灵突击|精神突击|尤里X/,
    'lane.personnel',
  ],
  [/装备|武器|枪械|弹药|瞄准|外骨骼|军服|护具|防具|动力甲/, 'lane.equipment'],
];

function inferProductionSubLane(q: RawRecord): string {
  const rawCat =
    typeof q.category === 'string' && q.category.trim()
      ? q.category.trim().toLowerCase()
      : typeof q.kind === 'string' && q.kind.trim()
        ? q.kind.trim().toLowerCase()
        : '';
  if (rawCat) {
    if (/infantry|personnel|步兵|人员/.test(rawCat)) return 'lane.personnel';
    if (/aircraft|air|空军|空中/.test(rawCat)) return 'lane.vehicle_air';
    if (/naval|ship|海军|舰艇|水面/.test(rawCat)) return 'lane.vehicle_naval';
    if (/vehicle|armor|战车|载具|陆地/.test(rawCat)) return 'lane.vehicle_land';
    if (/equipment|装备/.test(rawCat)) return 'lane.equipment';
  }
  const item = typeof q.item === 'string' ? q.item.trim() : '';
  if (item) {
    for (const [pattern, subLane] of PROD_SUBLANE_NAME_PATTERNS) {
      if (pattern.test(item)) return subLane;
    }
  }
  return '生产';
}

/**
 * 同产线分组键判定：
 * - 研究类全局唯一（按 lane 或 '研究'）；
 * - 生产类在未显式指定 lane 时按名称/类别推断子车道（步兵/战车/空军/海军/装备），防止跨车间挤占；
 * - 其余类型按同一 base + 同一 lane（若无 lane 则同一 type）归组。
 */
export function resolveQueueGroupKey(q: RawRecord): string {
  const type = typeof q.type === 'string' ? q.type.trim() : '';
  const lane = typeof q.lane === 'string' && q.lane.trim() ? q.lane.trim() : '';
  if (type === '研究') {
    return `research::${lane || '研究'}`;
  }
  const base = typeof q.base === 'string' ? q.base.trim() : '';
  const effectiveLane = lane || (type === '生产' ? inferProductionSubLane(q) : type);
  return `${base}::${effectiveLane}`;
}

/**
 * 在 queues 中定位目标工单下标：
 * 1. 优先匹配有效 action.queueIndex（若 item 一致或未限定 item）；
 * 2. 否则按 item + base + type 优先匹配非免疫态项，再回退匹配同名项。
 */
function findTargetQueueIndex(queues: RawRecord[], action: QueueScheduleMutationAction): number {
  const wantedItem = action.item.trim();
  if (
    typeof action.queueIndex === 'number' &&
    Number.isInteger(action.queueIndex) &&
    action.queueIndex >= 0 &&
    action.queueIndex < queues.length
  ) {
    const candidate = queues[action.queueIndex];
    if (candidate && (!wantedItem || String(candidate.item ?? '').trim() === wantedItem)) {
      return action.queueIndex;
    }
  }

  if (!wantedItem) return -1;
  const wantedType = action.type?.trim() ?? '';
  const wantedBase = wantedType === '研究' ? '' : (action.base?.trim() ?? '');

  let strictImmuneIdx = -1;
  for (let i = 0; i < queues.length; i++) {
    const q = queues[i];
    if (String(q.item ?? '').trim() !== wantedItem) continue;
    if (wantedType && String(q.type ?? '').trim() !== wantedType) continue;
    if (wantedBase && String(q.base ?? '').trim() !== wantedBase) continue;
    if (!isImmuneStatus(q.status)) return i;
    if (strictImmuneIdx === -1) strictImmuneIdx = i;
  }
  if (strictImmuneIdx !== -1) return strictImmuneIdx;

  // 放宽匹配：仅按 item + type 或仅按 item 查找
  let looseImmuneIdx = -1;
  for (let i = 0; i < queues.length; i++) {
    const q = queues[i];
    if (String(q.item ?? '').trim() !== wantedItem) continue;
    if (wantedType && String(q.type ?? '').trim() !== wantedType) continue;
    if (!isImmuneStatus(q.status)) return i;
    if (looseImmuneIdx === -1) looseImmuneIdx = i;
  }
  return looseImmuneIdx;
}

/**
 * 深克隆 projects 数组，保持不可变性
 */
function cloneProjects(rawProjects: unknown): RawRecord[] | undefined {
  if (!Array.isArray(rawProjects)) return undefined;
  return rawProjects.map(proj => {
    if (!proj || typeof proj !== 'object') return proj as RawRecord;
    const p = { ...(proj as RawRecord) };
    if (Array.isArray(p.phases)) {
      p.phases = p.phases.map(ph => (ph && typeof ph === 'object' ? { ...(ph as RawRecord) } : ph));
    }
    if (Array.isArray(p.modules)) {
      p.modules = p.modules.map(mod => (mod && typeof mod === 'object' ? { ...(mod as RawRecord) } : mod));
    }
    return p;
  });
}

/**
 * 判断某个工程阶段或仓段模块是否关联到目标队列工单
 */
function isLinkedProjectSubItem(
  proj: RawRecord,
  sub: RawRecord,
  subKind: 'phase' | 'module',
  originalQueueIndex: number,
  targetItemName: string,
  taskId?: string,
): boolean {
  if (originalQueueIndex >= 0 && sub.queue_index === originalQueueIndex) {
    return true;
  }
  const projId = typeof proj.id === 'string' ? proj.id : '';
  if (taskId && projId) {
    if (subKind === 'phase' && typeof sub.idx === 'number' && taskId === `task:proj:${projId}:phase:${sub.idx}`) {
      return true;
    }
    if (subKind === 'module' && typeof sub.id === 'string' && taskId === `task:proj:${projId}:mod:${sub.id}`) {
      return true;
    }
  }
  const projRef = typeof proj.ref === 'string' ? proj.ref.trim() : '';
  const subName = typeof sub.name === 'string' ? sub.name.trim() : '';
  if (targetItemName && subName) {
    if (projRef && `${projRef}·${subName}` === targetItemName) return true;
    if (subName === targetItemName) return true;
  }
  return false;
}

/**
 * 同步更新关联的 projects 阶段/模块状态及重排后的 queue_index 指针
 */
function syncProjectsAfterQueueMutation(
  projects: RawRecord[] | undefined,
  action: QueueScheduleMutationAction,
  originalTargetIdx: number,
  targetItemName: string,
  indexRemap: Map<number, number | null>,
): RawRecord[] | undefined {
  if (!projects) return undefined;

  for (const proj of projects) {
    if (Array.isArray(proj.phases)) {
      for (const phase of proj.phases as RawRecord[]) {
        const linked = isLinkedProjectSubItem(
          proj,
          phase,
          'phase',
          originalTargetIdx,
          targetItemName,
          action.taskId,
        );
        if (linked) {
          if (action.verb === '暂缓') {
            phase.status = '暂停';
          } else if (action.verb === '恢复') {
            phase.status = '进行中';
          } else if (action.verb === '撤销') {
            phase.status = '已取消';
            phase.queue_index = null;
          }
        }
        if (action.verb !== '撤销' || !linked) {
          if (typeof phase.queue_index === 'number' && indexRemap.has(phase.queue_index)) {
            phase.queue_index = indexRemap.get(phase.queue_index) ?? null;
          }
        }
      }
    }

    if (Array.isArray(proj.modules)) {
      for (const mod of proj.modules as RawRecord[]) {
        const linked = isLinkedProjectSubItem(
          proj,
          mod,
          'module',
          originalTargetIdx,
          targetItemName,
          action.taskId,
        );
        if (linked) {
          if (action.verb === '暂缓') {
            mod.status = '暂停';
          } else if (action.verb === '恢复') {
            mod.status = '进行中';
          } else if (action.verb === '撤销') {
            mod.status = '已取消';
            mod.queue_index = null;
          } else if (action.verb === '指派' && action.allocateBase?.trim()) {
            mod.base = action.allocateBase.trim();
          }
        }
        if (action.verb !== '撤销' || !linked) {
          if (typeof mod.queue_index === 'number' && indexRemap.has(mod.queue_index)) {
            mod.queue_index = indexRemap.get(mod.queue_index) ?? null;
          }
        }
      }
    }
  }

  return projects;
}

/**
 * 将同组首个非暂缓 queued 项递补升格为 active（不改动 spent_minutes 与 progress）
 */
function promoteFirstEligibleQueuedInGroup(
  queues: RawRecord[],
  groupKey: string,
  cap: number,
  excludeItem?: RawRecord,
): void {
  const activeCount = queues.filter(
    q => !isImmuneStatus(q.status) && resolveQueueGroupKey(q) === groupKey && q.status === 'active',
  ).length;
  if (activeCount >= cap) return;

  for (const q of queues) {
    if (q === excludeItem) continue;
    if (isImmuneStatus(q.status)) continue;
    if (resolveQueueGroupKey(q) !== groupKey) continue;
    if (q.status === 'queued' && q.hold !== true) {
      q.status = 'active';
      break;
    }
  }
}

const FALLBACK_UNIT_COST_BY_NAME: Readonly<Record<string, number>> = {
  超时空采矿车: 1400,
  武装采矿车: 1400,
  机动熔炼采矿母车: 1400,
  采矿车: 1400,
  M1A1灰熊主战坦克: 700,
  灰熊坦克: 700,
  犀牛坦克: 900,
  犀牛重型坦克: 900,
  天启坦克: 1750,
  光棱坦克: 1200,
  幻影坦克: 1000,
  多功能步兵车: 600,
  基洛夫空艇: 2000,
  入侵者战机: 1200,
  黑鹰战机: 1200,
  美国大兵: 200,
  动员兵: 100,
  重装大兵: 400,
  防空步兵: 300,
  磁暴步兵: 500,
  火箭飞行兵: 600,
  工程师: 500,
  战斗工程师: 500,
  海豹部队: 1000,
  谭雅: 1500,
  鲍里斯: 1500,
  尤里新兵: 200,
  狂风坦克: 800,
  盖特坦克: 600,
  精神控制车: 1750,
  镭射幽浮: 1500,
  发电厂: 800,
  盟军发电厂: 800,
  燃煤电厂: 800,
  磁能反应炉: 600,
  矿石精炼厂: 2000,
  盟军矿石精炼厂: 2000,
  苏联矿石精炼厂: 2000,
  兵营: 500,
  盟军兵营: 500,
  苏联兵营: 500,
  尤里克隆与新兵训导营: 500,
  战车工厂: 2000,
  盟军战车工厂: 2000,
  苏联战车工厂: 2000,
  尤里生物机电战车总装厂: 2000,
  空军指挥部: 1500,
  海军造船厂: 1800,
  战斗实验室: 2500,
  盟军战斗实验室: 2500,
  苏联战斗实验室: 2500,
  红星实验设计局综合体: 2500,
  尤里战斗实验室: 2500,
  基因测序与心灵谐振研究院: 2500,
  超算中心: 4000,
  量子超算中心: 15000,
  光棱塔: 1200,
  磁暴线圈: 1500,
  爱国者防空导弹: 1000,
  心灵控制塔: 1500,
  盖特机炮塔: 800,
};

function normalizeScheduleItemName(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s*[（(](?:量产体|量产型步兵)[）)]\s*$/u, '')
    .trim();
}

function stripFactionPrefixForLookup(raw: string): string {
  return raw.replace(/^(?:盟军|苏联|苏军|苏维埃|尤里|厄普西隆|升阳|旭日|焚风)/u, '').trim();
}

export function resolveCatalogItemUnitCost(
  rawItemName: string,
  queueType?: string,
  catalog?: ScheduleCatalogLike | null,
): number {
  const clean = normalizeScheduleItemName(rawItemName);
  if (!clean) return 0;
  const stripped = stripFactionPrefixForLookup(clean);

  if (catalog && typeof catalog === 'object') {
    const poolsByType: ReadonlyArray<readonly ScheduleCatalogItemLike[] | undefined> =
      queueType === '建造'
        ? [catalog.buildings, catalog.productions, catalog.researches, catalog.retrofits, catalog.projects]
        : queueType === '研究'
          ? [catalog.researches, catalog.buildings, catalog.productions, catalog.retrofits, catalog.projects]
          : queueType === '工程'
            ? [catalog.retrofits, catalog.projects, catalog.buildings, catalog.productions, catalog.researches]
            : [catalog.productions, catalog.buildings, catalog.researches, catalog.retrofits, catalog.projects];

    // 先检查工程阶段或模块子项（如 `灰熊改装·火控换装` 或 `天穹轨道船坞·机械臂A`）
    if (clean.includes('·')) {
      const [refPart, subPart] = clean.split('·').map(s => s.trim());
      if (refPart && subPart) {
        for (const r of catalog.retrofits ?? []) {
          if (normalizeScheduleItemName(r.name) === refPart || r.id === refPart) {
            const ph = r.phases?.find(p => normalizeScheduleItemName(p.name) === subPart);
            if (ph && typeof ph.cost === 'number' && Number.isFinite(ph.cost) && ph.cost > 0) {
              return ph.cost;
            }
          }
        }
        for (const p of catalog.projects ?? []) {
          if (normalizeScheduleItemName(p.name) === refPart || p.id === refPart) {
            const mod = p.modules?.find(
              m => normalizeScheduleItemName(m.name) === subPart || m.id === subPart,
            );
            if (mod && typeof mod.cost === 'number' && Number.isFinite(mod.cost) && mod.cost > 0) {
              return mod.cost;
            }
          }
        }
      }
    }

    for (const pool of poolsByType) {
      if (!Array.isArray(pool)) continue;
      const exact = pool.find(entry => {
        if (!entry) return false;
        const eName = normalizeScheduleItemName(entry.name);
        if (eName === clean || entry.id === clean) return true;
        return Array.isArray(entry.aliases) && entry.aliases.some(a => normalizeScheduleItemName(a) === clean);
      });
      if (exact && typeof exact.cost === 'number' && Number.isFinite(exact.cost) && exact.cost > 0) {
        return exact.cost;
      }
      if (stripped && stripped !== clean) {
        const byStripped = pool.find(entry => {
          if (!entry) return false;
          const eStripped = stripFactionPrefixForLookup(normalizeScheduleItemName(entry.name));
          return eStripped === stripped;
        });
        if (
          byStripped &&
          typeof byStripped.cost === 'number' &&
          Number.isFinite(byStripped.cost) &&
          byStripped.cost > 0
        ) {
          return byStripped.cost;
        }
      }
    }
  }

  return 0;
}

export function resolveScheduleCancelRefund(
  target: RawRecord,
  sd: RawRecord,
  catalog?: ScheduleCatalogLike | null,
): number {
  if (target.cost_paid === false) return 0;

  const totalQty =
    typeof target.qty === 'number' && Number.isFinite(target.qty) && target.qty > 0 ? target.qty : 1;
  const doneQty =
    typeof target.qty_done === 'number' && Number.isFinite(target.qty_done) && target.qty_done >= 0
      ? target.qty_done
      : 0;
  const remainingQty = Math.max(0, totalQty - doneQty);
  if (remainingQty <= 0) return 0;
  const remainingRatio = remainingQty / totalQty;

  // 1. 优先级 1：队列项自身带有 cost_credits / paid_credits / prepaid_credits / cost
  const directTotalCost =
    typeof target.cost_credits === 'number' && Number.isFinite(target.cost_credits) && target.cost_credits > 0
      ? target.cost_credits
      : typeof target.paid_credits === 'number' && Number.isFinite(target.paid_credits) && target.paid_credits > 0
        ? target.paid_credits
        : typeof target.prepaid_credits === 'number' &&
            Number.isFinite(target.prepaid_credits) &&
            target.prepaid_credits > 0
          ? target.prepaid_credits
          : typeof target.cost === 'number' && Number.isFinite(target.cost) && target.cost > 0
            ? target.cost
            : 0;
  if (directTotalCost > 0) {
    return Math.round(directTotalCost * remainingRatio);
  }

  // 2. 优先级 2：从 state.planning.latest_receipt.actions 查找同名 target 的 cost_credits / quantity * remainingQty
  const itemKey = normalizeScheduleItemName(target.item);
  const itemBase = typeof target.base === 'string' ? target.base.trim() : '';
  const planning = sd.planning && typeof sd.planning === 'object' ? (sd.planning as RawRecord) : undefined;
  const latestReceipt =
    planning?.latest_receipt && typeof planning.latest_receipt === 'object'
      ? (planning.latest_receipt as RawRecord)
      : undefined;
  const receiptActions = Array.isArray(latestReceipt?.actions)
    ? (latestReceipt.actions as RawRecord[])
    : [];
  if (itemKey && receiptActions.length > 0) {
    const matchedAction =
      receiptActions.find(
        a =>
          a &&
          normalizeScheduleItemName(a.target) === itemKey &&
          (!itemBase || !a.base || String(a.base).trim() === itemBase) &&
          typeof a.cost_credits === 'number' &&
          Number.isFinite(a.cost_credits) &&
          a.cost_credits > 0,
      ) ??
      receiptActions.find(
        a =>
          a &&
          normalizeScheduleItemName(a.target) === itemKey &&
          typeof a.cost_credits === 'number' &&
          Number.isFinite(a.cost_credits) &&
          a.cost_credits > 0,
      );
    if (matchedAction && typeof matchedAction.cost_credits === 'number') {
      const actQty =
        typeof matchedAction.quantity === 'number' &&
        Number.isFinite(matchedAction.quantity) &&
        matchedAction.quantity > 0
          ? matchedAction.quantity
          : 1;
      return Math.round((matchedAction.cost_credits / actQty) * remainingQty);
    }
  }

  // 3. 优先级 3：从传入的 catalog 查找单价 unitCost * remainingQty（若 cost_paid === true 或提供了 catalog 则进一步支持基准单价表兜底）
  const queueType = typeof target.type === 'string' ? target.type.trim() : undefined;
  const catalogUnitCost = resolveCatalogItemUnitCost(itemKey, queueType, catalog);
  if (catalogUnitCost > 0) {
    return Math.round(catalogUnitCost * remainingQty);
  }

  if (target.cost_paid === true || catalog) {
    const stripped = stripFactionPrefixForLookup(itemKey);
    const fallbackUnitCost =
      FALLBACK_UNIT_COST_BY_NAME[itemKey] ?? (stripped ? FALLBACK_UNIT_COST_BY_NAME[stripped] : 0) ?? 0;
    if (fallbackUnitCost > 0) {
      return Math.round(fallbackUnitCost * remainingQty);
    }
  }

  return 0;
}

/**
 * 对 vars.stat_data.queues 与 vars.stat_data.projects 应用六动词调度变更（纯函数）。
 * 严守铁律：绝不修改 spent_minutes 与 progress，绝不直接将任务置为 done。
 */
export function applyQueueScheduleMutationToVars(
  vars: Record<string, unknown>,
  action: QueueScheduleMutationAction,
  catalog?: ScheduleCatalogLike | null,
): Record<string, unknown> {
  const sd = (vars.stat_data ?? {}) as RawRecord;
  const rawQueues = Array.isArray(sd.queues) ? (sd.queues as RawRecord[]) : [];
  const queues = rawQueues.map(q => ({ ...q }));
  const itemOriginIdx = new Map<RawRecord, number>();
  queues.forEach((q, idx) => itemOriginIdx.set(q, idx));

  const targetIdx = findTargetQueueIndex(queues, action);
  const clonedProjects = cloneProjects(sd.projects);

  // 若队列中未找到，但属于对 V2 未入列模块的跨基地指派，允许仅同步更新 projects
  if (targetIdx === -1) {
    if (action.verb === '指派' && action.allocateBase?.trim() && clonedProjects) {
      syncProjectsAfterQueueMutation(clonedProjects, action, -1, action.item.trim(), new Map());
      return {
        ...vars,
        stat_data: {
          ...sd,
          projects: clonedProjects,
        },
      };
    }
    return vars;
  }

  const target = queues[targetIdx];
  // 免疫态保护：settling / done / cancelled 原样返回不修改
  if (isImmuneStatus(target.status)) {
    return vars;
  }

  const groupKey = resolveQueueGroupKey(target);
  const cap = Math.max(1, action.capacity ?? 1);
  const targetItemName = String(target.item ?? action.item ?? '').trim();

  let nextQueues = queues;

  switch (action.verb) {
    case '置顶': {
      // 挪到同组第 1 个非终态元素之前
      const rest = nextQueues.filter((_, i) => i !== targetIdx);
      const firstGroupIdx = rest.findIndex(
        q => !isImmuneStatus(q.status) && resolveQueueGroupKey(q) === groupKey,
      );
      const insertAt = firstGroupIdx === -1 ? targetIdx : firstGroupIdx;
      nextQueues = [...rest.slice(0, insertAt), target, ...rest.slice(insertAt)];

      if (target.status === 'queued' && target.hold !== true) {
        target.status = 'active';
        const activeInGroup = nextQueues.filter(
          q => !isImmuneStatus(q.status) && resolveQueueGroupKey(q) === groupKey && q.status === 'active',
        );
        if (activeInGroup.length > cap) {
          // 将同组最后一个原 active 项降为 queued（保留 spent_minutes 与 progress）
          for (let i = nextQueues.length - 1; i >= 0; i--) {
            const candidate = nextQueues[i];
            if (
              candidate !== target &&
              !isImmuneStatus(candidate.status) &&
              resolveQueueGroupKey(candidate) === groupKey &&
              candidate.status === 'active'
            ) {
              candidate.status = 'queued';
              break;
            }
          }
        }
      }
      break;
    }

    case '置底': {
      // 挪到同组最后一个非终态元素之后
      const rest = nextQueues.filter((_, i) => i !== targetIdx);
      let lastGroupIdx = -1;
      for (let i = 0; i < rest.length; i++) {
        if (!isImmuneStatus(rest[i].status) && resolveQueueGroupKey(rest[i]) === groupKey) {
          lastGroupIdx = i;
        }
      }
      const insertAt = lastGroupIdx === -1 ? targetIdx : lastGroupIdx + 1;
      nextQueues = [...rest.slice(0, insertAt), target, ...rest.slice(insertAt)];

      if (target.status === 'active') {
        target.status = 'queued';
        promoteFirstEligibleQueuedInGroup(nextQueues, groupKey, cap, target);
      }
      break;
    }

    case '暂缓': {
      const wasActive = target.status === 'active';
      target.hold = true;
      if (wasActive) {
        target.status = 'queued';
        promoteFirstEligibleQueuedInGroup(nextQueues, groupKey, cap, target);
      }
      break;
    }

    case '恢复': {
      target.hold = false;
      const activeCount = nextQueues.filter(
        q => !isImmuneStatus(q.status) && resolveQueueGroupKey(q) === groupKey && q.status === 'active',
      ).length;
      if (target.status === 'queued' && activeCount < cap) {
        target.status = 'active';
      }
      break;
    }

    case '撤销': {
      target.status = 'cancelled';
      target.hold = false;
      promoteFirstEligibleQueuedInGroup(nextQueues, groupKey, cap, target);
      break;
    }

    case '指派': {
      const nextBase = action.allocateBase?.trim();
      if (nextBase) {
        target.base = nextBase;
      }
      break;
    }
  }

  let refundCredits = 0;
  if (action.verb === '撤销') {
    refundCredits = resolveScheduleCancelRefund(target, sd, catalog);
    if (refundCredits > 0) {
      target.cost_paid = false;
    }
  }

  const indexRemap = new Map<number, number | null>();
  nextQueues.forEach((q, newIdx) => {
    const oldIdx = itemOriginIdx.get(q);
    if (oldIdx !== undefined) {
      indexRemap.set(oldIdx, q.status === 'cancelled' && oldIdx === targetIdx ? null : newIdx);
    }
  });

  const nextProjects = syncProjectsAfterQueueMutation(
    clonedProjects,
    action,
    targetIdx,
    targetItemName,
    indexRemap,
  );

  const nextStatData: RawRecord = {
    ...sd,
    queues: nextQueues,
  };
  if (nextProjects !== undefined) {
    nextStatData.projects = nextProjects;
  }
  if (refundCredits > 0) {
    const rawEconomy = sd.economy && typeof sd.economy === 'object' ? (sd.economy as RawRecord) : {};
    const currentCredits =
      typeof rawEconomy.credits === 'number' && Number.isFinite(rawEconomy.credits) ? rawEconomy.credits : 0;
    nextStatData.economy = {
      ...rawEconomy,
      credits: currentCredits + refundCredits,
    };
  }

  return {
    ...vars,
    stat_data: nextStatData,
  };
}

function buildScheduleMutationToast(action: QueueScheduleMutationAction): string {
  const item = action.item.trim() || '目标项目';
  switch (action.verb) {
    case '置顶':
      return `已置顶「${item}」并调入工位`;
    case '置底':
      return `已将「${item}」移至候列末位`;
    case '暂缓':
      return `已暂缓「${item}」`;
    case '恢复':
      return `已恢复「${item}」工务推进`;
    case '撤销':
      return `已撤销「${item}」并释放工位`;
    case '指派': {
      const dest = action.allocateBase?.trim() || action.base?.trim() || '主基地';
      return `已将「${item}」改派至「${dest}」承建`;
    }
  }
}

function syncLocalStatDataTarget(
  target: RawRecord | null | undefined,
  nextStatData: RawRecord,
): void {
  if (!target || typeof target !== 'object') return;
  if ('queues' in nextStatData) {
    target.queues = nextStatData.queues;
  }
  if ('projects' in nextStatData) {
    target.projects = nextStatData.projects;
  }
  if ('bases' in nextStatData) {
    target.bases = nextStatData.bases;
  }
  if ('economy' in nextStatData) {
    target.economy = nextStatData.economy;
  }
}

/**
 * 即时执行工单六动词变更：同步更新本地 snapshot / dataStore，并经 updateFloorVars 落盘刷新。
 */
export async function executeInstantScheduleMutation(
  action: QueueScheduleMutationAction,
  ctx: ScheduleMutationContext,
): Promise<string> {
  if (ctx.snapshot && typeof ctx.snapshot === 'object') {
    const mutated = applyQueueScheduleMutationToVars({ stat_data: ctx.snapshot }, action, ctx.catalog);
    const nextSd = (mutated.stat_data ?? {}) as RawRecord;
    syncLocalStatDataTarget(ctx.snapshot, nextSd);
    const storeData = ctx.dataStore?.data as RawRecord | null | undefined;
    if (storeData && storeData !== ctx.snapshot) {
      syncLocalStatDataTarget(storeData, nextSd);
    }
  } else if (ctx.dataStore?.data && typeof ctx.dataStore.data === 'object') {
    const storeData = ctx.dataStore.data as RawRecord;
    const mutated = applyQueueScheduleMutationToVars({ stat_data: storeData }, action, ctx.catalog);
    const nextSd = (mutated.stat_data ?? {}) as RawRecord;
    syncLocalStatDataTarget(storeData, nextSd);
  }

  ctx.onTick?.();

  if (ctx.floating?.floorId !== null && ctx.floating?.floorId !== undefined) {
    await ctx.updateFloorVars(ctx.floating.floorId, vars =>
      applyQueueScheduleMutationToVars(vars, action, ctx.catalog),
    );
    await ctx.floating.refresh();
  }

  const toastMsg = buildScheduleMutationToast(action);
  notifyToastSuccess(toastMsg, '战区工务调度');
  return toastMsg;
}

/**
 * 修改指定基地建筑实例的产线双模（生产/加速）或加速范围（global/base）——纯函数。
 */
export function applyScheduleLaneDualModeToVars(
  vars: Record<string, unknown>,
  target: {
    baseIndex: number;
    buildingIndex: number;
    nextMode?: '生产' | '加速';
    nextScope?: 'global' | 'base';
  },
): Record<string, unknown> {
  const sd = (vars.stat_data ?? {}) as RawRecord;
  const rawBases = Array.isArray(sd.bases) ? [...(sd.bases as RawRecord[])] : [];
  const targetBase = rawBases[target.baseIndex];
  if (!targetBase || typeof targetBase !== 'object') return vars;

  const rawBuildings = Array.isArray(targetBase.buildings)
    ? [...(targetBase.buildings as RawRecord[])]
    : [];
  const targetBld = rawBuildings[target.buildingIndex];
  if (!targetBld || typeof targetBld !== 'object') return vars;

  const clonedBld: RawRecord = { ...targetBld };
  if (target.nextMode !== undefined) {
    clonedBld.mode = target.nextMode;
    if (target.nextMode === '加速' && !clonedBld.accel_scope) {
      clonedBld.accel_scope = 'global';
    }
  }
  if (target.nextScope !== undefined) {
    clonedBld.accel_scope = target.nextScope;
  }

  rawBuildings[target.buildingIndex] = clonedBld;
  rawBases[target.baseIndex] = {
    ...targetBase,
    buildings: rawBuildings,
  };

  return {
    ...vars,
    stat_data: {
      ...sd,
      bases: rawBases,
    },
  };
}

/**
 * 产线内嵌双模切换器：切换指定建筑【生产 ⇄ 加速】模式并落盘刷新。
 */
export async function toggleScheduleLaneBuildingMode(
  inst: ScheduleLaneBuildingInstanceRef,
  ctx: ScheduleMutationContext,
): Promise<string> {
  const nextMode: '生产' | '加速' = inst.mode === '加速' ? '生产' : '加速';
  const mutationTarget = {
    baseIndex: inst.baseIndex,
    buildingIndex: inst.buildingIndex,
    nextMode,
  };

  if (ctx.snapshot && typeof ctx.snapshot === 'object') {
    const mutated = applyScheduleLaneDualModeToVars({ stat_data: ctx.snapshot }, mutationTarget);
    const nextSd = (mutated.stat_data ?? {}) as RawRecord;
    syncLocalStatDataTarget(ctx.snapshot, nextSd);
    const storeData = ctx.dataStore?.data as RawRecord | null | undefined;
    if (storeData && storeData !== ctx.snapshot) {
      syncLocalStatDataTarget(storeData, nextSd);
    }
  } else if (ctx.dataStore?.data && typeof ctx.dataStore.data === 'object') {
    const storeData = ctx.dataStore.data as RawRecord;
    const mutated = applyScheduleLaneDualModeToVars({ stat_data: storeData }, mutationTarget);
    const nextSd = (mutated.stat_data ?? {}) as RawRecord;
    syncLocalStatDataTarget(storeData, nextSd);
  }

  ctx.onTick?.();

  if (ctx.floating?.floorId !== null && ctx.floating?.floorId !== undefined) {
    await ctx.updateFloorVars(ctx.floating.floorId, vars =>
      applyScheduleLaneDualModeToVars(vars, mutationTarget),
    );
    await ctx.floating.refresh();
  }

  const toastMsg = `「${inst.name}」已切换为【${nextMode}】模式`;
  notifyToastSuccess(toastMsg, '产线双模调度');
  return toastMsg;
}

/**
 * 产线内嵌加速范围切换器：切换指定建筑【战区全局 ⇄ 仅本基地】并落盘刷新。
 */
export async function toggleScheduleLaneBuildingScope(
  inst: ScheduleLaneBuildingInstanceRef,
  ctx: ScheduleMutationContext,
): Promise<string> {
  const nextScope: 'global' | 'base' = inst.accelScope === 'base' ? 'global' : 'base';
  const mutationTarget = {
    baseIndex: inst.baseIndex,
    buildingIndex: inst.buildingIndex,
    nextScope,
  };

  if (ctx.snapshot && typeof ctx.snapshot === 'object') {
    const mutated = applyScheduleLaneDualModeToVars({ stat_data: ctx.snapshot }, mutationTarget);
    const nextSd = (mutated.stat_data ?? {}) as RawRecord;
    syncLocalStatDataTarget(ctx.snapshot, nextSd);
    const storeData = ctx.dataStore?.data as RawRecord | null | undefined;
    if (storeData && storeData !== ctx.snapshot) {
      syncLocalStatDataTarget(storeData, nextSd);
    }
  } else if (ctx.dataStore?.data && typeof ctx.dataStore.data === 'object') {
    const storeData = ctx.dataStore.data as RawRecord;
    const mutated = applyScheduleLaneDualModeToVars({ stat_data: storeData }, mutationTarget);
    const nextSd = (mutated.stat_data ?? {}) as RawRecord;
    syncLocalStatDataTarget(storeData, nextSd);
  }

  ctx.onTick?.();

  if (ctx.floating?.floorId !== null && ctx.floating?.floorId !== undefined) {
    await ctx.updateFloorVars(ctx.floating.floorId, vars =>
      applyScheduleLaneDualModeToVars(vars, mutationTarget),
    );
    await ctx.floating.refresh();
  }

  const scopeLabel = nextScope === 'base' ? '仅本基地' : '战区全局';
  const toastMsg = `「${inst.name}」加速范围已切换为【${scopeLabel}】`;
  notifyToastSuccess(toastMsg, '产线双模调度');
  return toastMsg;
}
