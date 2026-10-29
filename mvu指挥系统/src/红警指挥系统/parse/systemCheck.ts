/**
 * 内容体检引擎（DLC设计.md §8 R1-R13 的可执行落地）
 * 三维：世界书（需酒馆 API）/ 变量（预览也可跑）/ 对账（需酒馆 API）。
 * 纯函数 + 显式数据入参，便于测试；酒馆全局函数经 tav() 探测获取，缺失即降级。
 * 批2 为只读体检；R11（takeover 对账）待批3 有安装数据后启用。
 */
import type { ResearchDef } from '../core/catalog';
import { canon } from './parseTypesAndCanon';
import { validateLegacyRequirementFields, validatePrerequisiteCondition } from '../core/prerequisites';
import type { DlcOverlay } from '../composables/useCatalog';

export interface CheckIssue {
  rule: string;
  level: 'error' | 'warn' | 'info';
  target: string;
  message: string;
}

/** 酒馆助手全局函数探测（iframe 注入；独立预览为 undefined） */
export function tav<T = (...args: never[]) => unknown>(name: string): T | undefined {
  const fn = (globalThis as Record<string, unknown>)[name];
  return typeof fn === 'function' ? (fn as T) : undefined;
}

/** 环境状态：运行模式 + 关键 API 可用性 */
export function checkEnv(inTavern: boolean): { inTavern: boolean; apis: { name: string; ok: boolean }[] } {
  const names = [
    'getVariables',
    'updateVariablesWith',
    'getWorldbookNames',
    'getWorldbook',
    'createWorldbook',
    'deleteWorldbook',
    'getCharWorldbookNames',
    'rebindCharWorldbooks',
  ];
  return { inTavern, apis: names.map(name => ({ name, ok: !!tav(name) })) };
}

/* ═══════════════ 变量维度（同步，独立预览可用） ═══════════════ */

interface CodexLike {
  name: string;
  kind: string;
  params: Record<string, string>;
}

export function checkVariables(input: {
  codex: CodexLike[];
  techDone: string[];
  overlays: DlcOverlay[];
  baseResearches: ResearchDef[];
  mergedResearchNames: string[];
  /** 《通用·科技》V1：可选。世界书 v2 研究别名集合——R13b 孤儿判定中别名也算命中（减少改名残留误报） */
  researchAliases?: string[];
  /** CTRL-RETIRE-01：可选。在册基地清单（只读），用于列出退役实体 */
  bases?: { id: string; name: string; status: string }[];
}): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const { codex, techDone, overlays, baseResearches, mergedResearchNames } = input;

  // R23 退役实体清单（CTRL-RETIRE-01 · 方案 A 状态机退役）：只读列出在册退役基地，不提供自动删除
  for (const base of input.bases ?? []) {
    if (base.status === '废弃') {
      issues.push({
        rule: 'R23',
        level: 'info',
        target: base.name,
        message: `退役基地在册（id: ${base.id}）——数据保留可审计，UI 默认折叠；如需清理由驾驶员人工裁决`,
      });
    }
  }

  // R13a codex 结构
  for (const c of codex) {
    if (!c.name) issues.push({ rule: 'R13', level: 'error', target: '(codex)', message: '存在缺 name 的 codex 条目' });
    if (!c.kind) issues.push({ rule: 'R13', level: 'warn', target: c.name, message: 'codex 条目缺 kind，无法归类' });
    if (c.kind === '科技' && !c.params['层级'])
      issues.push({
        rule: 'R13',
        level: 'info',
        target: c.name,
        message: 'codex 科技缺"层级"参数，列表不显示 T 徽章（可请 EVA 补录）',
      });
    if (c.kind === '科技' && !c.params['科技线'])
      issues.push({
        rule: 'R13',
        level: 'info',
        target: c.name,
        message: 'codex 科技缺"科技线"参数，将归入"动态研究线"',
      });
    if (c.kind === '阵营' && (!c.params['MCV'] || !c.params['实验室']))
      issues.push({
        rule: 'R13',
        level: 'warn',
        target: c.name,
        message: 'codex 阵营缺 MCV/实验室 参数，层级卡不会显示该阵营',
      });
  }

  // R13b tech.done 孤儿名（合并目录 + codex + 世界书 v2 别名均查无此名）
  const codexNames = new Set(codex.map(c => c.name));
  const known = new Set(mergedResearchNames);
  const aliasKnown = new Set(input.researchAliases ?? []);
  for (const name of techDone) {
    if (!known.has(name) && !codexNames.has(name) && !aliasKnown.has(name)) {
      issues.push({
        rule: 'R13',
        level: 'warn',
        target: name,
        message: 'tech.done 孤儿：目录与 codex 均无此研究（改名残留或未注册 DLC 内容？）',
      });
    }
  }

  // R16 DLC 种子对账：$dlc.codexSeeds 登记但 codex 已无（删楼回滚到安装前楼层→种子随 message 变量丢失）
  // UI 不受影响（$dlc.faction 兜底），但 AI 变量视角丢失阵营注册；种子是机器数据可安全重放（DLC 管理区“补种子”）
  for (const candidate of overlays) {
    const overlay: Record<string, unknown> = isPlainRecord(candidate) ? candidate : {};
    const overlayId = typeof overlay.id === 'string' && overlay.id.trim() ? overlay.id : '(overlay)';
    const seeds = Array.isArray(overlay.codexSeeds)
      ? overlay.codexSeeds.filter((seed: unknown): seed is string => typeof seed === 'string')
      : [];
    for (const seed of seeds) {
      if (!codexNames.has(seed)) {
        issues.push({
          rule: 'R16',
          level: 'warn',
          target: seed,
          message: `DLC[${overlayId}] 种子丢失（楼层回滚？）——DLC 管理区可一键补种子`,
        });
      }
    }
  }

  // R1/R2/R3 overlay 硬性键值（$dlc.data 复检，与导入预检共用 checkOverlayData）
  const baseNames = new Set(baseResearches.map(r => r.name));
  for (const overlay of overlays) issues.push(...checkOverlayData(overlay, baseNames));

  // R12 多包冲突：overlay 之间。损坏集合/条目已由 checkOverlayData 报 R3，此处只读取安全名称。
  const seen = new Map<string, string>();
  for (const candidate of overlays) {
    const overlay: Record<string, unknown> = isPlainRecord(candidate) ? candidate : {};
    const overlayId = typeof overlay.id === 'string' && overlay.id.trim() ? overlay.id : '(overlay)';
    const researches: unknown[] = Array.isArray(overlay.researches) ? overlay.researches : [];
    for (const research of researches) {
      if (
        !isPlainRecord(research) ||
        typeof research.name !== 'string' ||
        !research.name.trim() ||
        research.name !== research.name.trim()
      ) {
        continue;
      }
      const prev = seen.get(research.name);
      if (prev && prev !== overlayId) {
        issues.push({
          rule: 'R12',
          level: 'error',
          target: research.name,
          message: `多包冲突：${prev} 与 ${overlayId} 均定义此科技，按安装序 ${overlayId} 生效`,
        });
      }
      seen.set(research.name, overlayId);
    }
  }
  return issues;
}

/* ═══ R26 资产在账×队列存活交叉校验（CTRL-FIX-LEDGER-01 · O-A6-4 防线） ═══
 * LLM 绕过事务生命周期直写资产键时：资产已在账（tech.done/forces.troops/基地建筑/forces.vehicles），
 * 但对应 queues 条目仍存活（active/queued，未达 settling）——事务永远收不了尾、滞留队列。
 * R 级只警不拦：只产出 warn 体检/告警记录，不改变结算行为、不拦截、不改状态机。
 * 纯函数 + 显式数据入参；冷路径（体检）与热路径（settleFloor 每楼结算）共用同一口径。 */

export interface AssetQueueCrossInput {
  queues: readonly { type: string; item: string; base?: string; status?: string }[];
  techDone: readonly string[];
  troops: Record<string, number>;
  bases: readonly { id?: string; name: string; buildings?: readonly { name: string; state?: string }[] }[];
  vehicles?: readonly string[];
  /** 可选：上一楼/基线兵力快照（用于识别从 >0 存量起步的步兵补产，仅在从 0 新增且无历史完成记录时告警，FIX-P1-01） */
  prevTroops?: Readonly<Record<string, number>>;
  /** 可选：上一楼/基线基地快照（用于识别从已有非建造中建筑起步的同名建筑扩建，FIX-P1-01） */
  prevBases?: readonly { id?: string; name: string; buildings?: readonly { name: string; state?: string }[] }[];
}

/** R26：研究→tech.done / 生产→forces.troops(数量>0) / 建造→基地建筑非「建造中」 / 改装→forces.vehicles（canon 名归一比对） */
export function checkAssetQueueCross(input: AssetQueueCrossInput): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const doneTech = new Set(input.techDone.map(canon));
  const troopCounts = new Map<string, number>();
  for (const [name, n] of Object.entries(input.troops ?? {})) {
    if (typeof n === 'number' && n > 0) {
      const c = canon(name);
      troopCounts.set(c, (troopCounts.get(c) ?? 0) + n);
    }
  }
  const prevTroopCounts =
    input.prevTroops !== undefined
      ? (() => {
          const m = new Map<string, number>();
          for (const [name, n] of Object.entries(input.prevTroops)) {
            if (typeof n === 'number' && n > 0) {
              const c = canon(name);
              m.set(c, (m.get(c) ?? 0) + n);
            }
          }
          return m;
        })()
      : null;
  const vehicleNames = new Set((input.vehicles ?? []).map(canon));
  // 历史已完结（done）记录集合：若同类型同项目已有历史完成记录，说明当前存活队列为补产或同名扩建，不报 R26（FIX-P1-01）
  const doneHistory = new Set<string>();
  for (const q of input.queues) {
    if (q && q.status === 'done' && typeof q.item === 'string' && q.item.trim()) {
      doneHistory.add(`${q.type}\u0000${canon(q.item)}`);
    }
  }
  // 建筑在账=同基地（base 消歧优先，缺席/查无基地时全域兜底）内状态非「建造中」（state 缺席按 schema 默认「运转」）
  const countBuiltInPool = (
    basesPool: readonly { id?: string; name: string; buildings?: readonly { name: string; state?: string }[] }[],
    baseKey: string,
    itemCanon: string,
  ): { count: number; hitLabel: string | null } => {
    const key = canon(baseKey);
    const scoped = key ? basesPool.filter(b => canon(b.id ?? '') === key || canon(b.name) === key) : [];
    const pool = scoped.length > 0 ? scoped : basesPool;
    let count = 0;
    let hitLabel: string | null = null;
    for (const b of pool) {
      for (const bd of b.buildings ?? []) {
        const state = bd.state ?? '运转';
        if (canon(bd.name) === itemCanon && state !== '建造中') {
          count += 1;
          if (!hitLabel) hitLabel = `基地「${b.name}」建筑状态=${state}`;
        }
      }
    }
    return { count, hitLabel };
  };
  for (const q of input.queues) {
    if (!q || typeof q.item !== 'string' || !q.item.trim()) continue;
    if (q.status !== 'active' && q.status !== 'queued') continue; // settling/done/cancelled 不属「存活未就绪」
    const c = canon(q.item);
    let ledger: string | null = null;
    if (q.type === '研究' && doneTech.has(c)) {
      ledger = '已研科技在账';
    } else if (q.type === '生产') {
      if (doneHistory.has(`生产\u0000${c}`)) continue;
      if (prevTroopCounts === null) continue; // 无前楼对比基线时不把既有存量误判为本楼直写增量（05 [P2-2]）
      const currCount = troopCounts.get(c) ?? 0;
      const prevCount = prevTroopCounts.get(c) ?? 0;
      if (currCount > prevCount) {
        ledger = '部队在账';
      }
    } else if (q.type === '改装') {
      if (doneHistory.has(`改装\u0000${c}`)) continue;
      if (vehicleNames.has(c)) ledger = '载具在账';
    } else if (q.type === '建造') {
      if (doneHistory.has(`建造\u0000${c}`)) continue;
      const currBuilt = countBuiltInPool(input.bases, q.base ?? '', c);
      if (currBuilt.count > 0 && currBuilt.hitLabel) {
        if (input.prevBases !== undefined) {
          const prevBuilt = countBuiltInPool(input.prevBases, q.base ?? '', c);
          if (prevBuilt.count > 0) continue; // 已有建成同名建筑扩建第 2 座不误报
        }
        ledger = `建筑在账（${currBuilt.hitLabel}）`;
      }
    }
    if (!ledger) continue;
    issues.push({
      rule: 'R26',
      level: 'warn',
      target: `队列[${q.item}]`,
      message: `资产在账×队列存活：${ledger}，但事务仍为「${q.status}」（未达 settling）——疑似绕过事务收尾直写资产键，事务将无法收尾；引擎只警不拦，请人工核对（先写时间推进使事务就绪→收讫，或驾驶员裁决）`,
    });
  }
  return issues;
}

/* ═══ R27 展开在途×载具在账交叉校验（E3a · 仿 R26 只警不拦/冷热双路径） ═══
 * D3 裁定：展开中载具保留在 forces.vehicles 直至翻转。叙事炸车/直写漂移把车弄丢时，
 * pending_deployments 仍有展开指令而 vehicles 已无该车——翻转将永远 orphan。
 * R 级只警不拦：只产出 warn 体检/告警记录，不改变结算行为、不拦截、不改状态机。
 * 纯函数 + 显式数据入参；冷路径（体检）与热路径（settleFloor 每楼结算）共用同一口径。 */

export interface DeploymentVehicleCrossInput {
  pendingDeployments: readonly { vehicle: string; action?: string }[];
  vehicles: readonly string[];
}

/** R27：仅查 action='展开'（收起在途载具本就不在 vehicles，翻转才回队，不属异常；canon 名归一比对） */
export function checkDeploymentVehicleCross(input: DeploymentVehicleCrossInput): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const vehicleNames = new Set((input.vehicles ?? []).map(canon));
  for (const p of input.pendingDeployments ?? []) {
    if (!p || typeof p.vehicle !== 'string' || !p.vehicle.trim()) continue;
    if (p.action !== '展开') continue;
    if (vehicleNames.has(canon(p.vehicle))) continue;
    issues.push({
      rule: 'R27',
      level: 'warn',
      target: `pending_deployments[${p.vehicle}]`,
      message: `展开在途×载具在账：pending_deployments 有「${p.vehicle}」展开指令，但 forces.vehicles 已无该车（叙事炸车/直写漂移？）——结算将 orphan 出账；引擎只警不拦，请人工核对`,
    });
  }
  return issues;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** R1/R2/R3/R12(覆盖base)：单个 overlay 数据块硬校验——体检与导入预检共用 */
export function checkOverlayData(o: unknown, baseNames: Set<string>): CheckIssue[] {
  const issues: CheckIssue[] = [];
  if (!isPlainRecord(o)) {
    return [{ rule: 'R3', level: 'error', target: '(overlay)', message: 'overlay 数据必须是对象' }];
  }
  const overlay = o;
  const overlayId =
    typeof overlay.id === 'string' && overlay.id.trim() && overlay.id === overlay.id.trim() ? overlay.id : '(overlay)';
  if (overlayId === '(overlay)') {
    issues.push({ rule: 'R3', level: 'error', target: overlayId, message: 'overlay.id 必须是无首尾空白的非空字符串' });
  }
  if (overlay.dataError !== undefined) {
    issues.push({ rule: 'R3', level: 'error', target: overlayId, message: String(overlay.dataError) });
  }
  if (overlay.faction !== undefined) {
    if (!isPlainRecord(overlay.faction)) {
      issues.push({ rule: 'R3', level: 'error', target: overlayId, message: 'overlay.faction 必须是对象' });
    } else {
      for (const field of ['mcv', 'lab'] as const) {
        const value = overlay.faction[field];
        if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
          issues.push({ rule: 'R3', level: 'error', target: overlayId, message: `overlay.faction.${field} 非法` });
        }
      }
      if (
        overlay.faction.name !== undefined &&
        (typeof overlay.faction.name !== 'string' ||
          !overlay.faction.name.trim() ||
          overlay.faction.name !== overlay.faction.name.trim())
      ) {
        issues.push({ rule: 'R3', level: 'error', target: overlayId, message: 'overlay.faction.name 非法' });
      }
      if (
        overlay.faction.labResearch !== undefined &&
        overlay.faction.labResearch !== null &&
        (typeof overlay.faction.labResearch !== 'string' ||
          !overlay.faction.labResearch.trim() ||
          overlay.faction.labResearch !== overlay.faction.labResearch.trim())
      ) {
        issues.push({ rule: 'R3', level: 'error', target: overlayId, message: 'overlay.faction.labResearch 非法' });
      }
    }
  }
  const readItems = (field: 'researches' | 'buildings' | 'productions', kind: string) => {
    const value = overlay[field];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      issues.push({ rule: 'R3', level: 'error', target: overlayId, message: `${kind}集合必须是数组` });
      return [];
    }
    const items: Record<string, unknown>[] = [];
    value.forEach((item, index) => {
      if (!isPlainRecord(item)) {
        issues.push({ rule: 'R3', level: 'error', target: overlayId, message: `${kind}[${index}] 必须是对象` });
        return;
      }
      items.push(item);
    });
    return items;
  };
  const readName = (kind: string, item: Record<string, unknown>): string | undefined => {
    const name = item.name;
    if (typeof name !== 'string' || !name.trim()) {
      issues.push({ rule: 'R3', level: 'error', target: overlayId, message: `${kind}缺少有效 name` });
      return undefined;
    }
    if (name !== name.trim()) {
      issues.push({ rule: 'R3', level: 'error', target: overlayId, message: `${kind} name 不能含首尾空白：${name}` });
      return undefined;
    }
    return name;
  };
  const requireString = (kind: string, name: string, item: Record<string, unknown>, field: string) => {
    if (typeof item[field] !== 'string') {
      issues.push({ rule: 'R3', level: 'error', target: name, message: `${kind}.${field} 缺失或不是字符串` });
    }
  };
  const requireFiniteNumber = (kind: string, name: string, item: Record<string, unknown>, field: string) => {
    const value = item[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ rule: 'R3', level: 'error', target: name, message: `${kind}.${field} 缺失或不是有限数值` });
    }
  };
  const requireStringArray = (kind: string, name: string, item: Record<string, unknown>, field: string) => {
    if (!Array.isArray(item[field])) {
      issues.push({ rule: 'R3', level: 'error', target: name, message: `${kind}.${field} 缺失或不是字符串数组` });
    }
  };
  const checkRequirements = (kind: string, name: string, requirements: unknown) => {
    if (requirements === undefined) return;
    for (const diagnostic of validatePrerequisiteCondition(requirements)) {
      issues.push({
        rule: 'R3',
        level: 'error',
        target: name || overlayId,
        message: `${kind} requirements 非法（${diagnostic.path}）：${diagnostic.message}`,
      });
    }
  };
  const checkLegacyRequirements = (kind: string, name: string, value: unknown) => {
    for (const diagnostic of validateLegacyRequirementFields(value)) {
      issues.push({
        rule: 'R3',
        level: 'error',
        target: name || overlayId,
        message: `${kind}旧前置字段非法（${diagnostic.path}）：${diagnostic.message}`,
      });
    }
  };
  const researches = readItems('researches', '研究');
  const buildings = readItems('buildings', '建筑');
  const productions = readItems('productions', '生产');
  if (overlay.codex !== undefined) {
    if (!Array.isArray(overlay.codex)) {
      issues.push({ rule: 'R3', level: 'error', target: overlayId, message: 'codex 集合必须是数组' });
    } else {
      overlay.codex.forEach((seed, index) => {
        if (!isPlainRecord(seed)) {
          issues.push({ rule: 'R3', level: 'error', target: overlayId, message: `codex[${index}] 必须是对象` });
          return;
        }
        if (
          typeof seed.name !== 'string' ||
          !seed.name.trim() ||
          seed.name !== seed.name.trim() ||
          typeof seed.kind !== 'string' ||
          !seed.kind.trim() ||
          seed.kind !== seed.kind.trim() ||
          typeof seed.desc !== 'string' ||
          !isPlainRecord(seed.params) ||
          Object.values(seed.params).some(value => typeof value !== 'string')
        ) {
          issues.push({
            rule: 'R3',
            level: 'error',
            target: overlayId,
            message: `codex[${index}] 的 name/kind/desc/params 非法`,
          });
        }
      });
    }
  }
  for (const research of researches) {
    const name = readName('研究', research);
    if (!name) continue;
    if (research.tier !== 1 && research.tier !== 2 && research.tier !== 3) {
      issues.push({
        rule: 'R1',
        level: 'error',
        target: name,
        message: `tier 缺失或非法（${String(research.tier)}）——层级必须显式声明 1/2/3`,
      });
    }
    requireFiniteNumber('研究', name, research, 'cost');
    requireString('研究', name, research, 'eta');
    requireString('研究', name, research, 'line');
    requireString('研究', name, research, 'unlocks');
    requireString('研究', name, research, 'prereq');
    requireStringArray('研究', name, research, 'prereqs');
    requireString('研究', name, research, 'desc');
    checkLegacyRequirements('研究', name, research);
    checkRequirements('研究', name, research.requirements);
    if (baseNames.has(name))
      issues.push({
        rule: 'R12',
        level: 'info',
        target: name,
        message: `${overlayId} 覆盖了原生科技（patch 行为，同名后装胜）`,
      });
  }
  for (const building of buildings) {
    const name = readName('建筑', building);
    if (!name) continue;
    requireFiniteNumber('建筑', name, building, 'cost');
    requireFiniteNumber('建筑', name, building, 'power');
    if (building.research !== null && typeof building.research !== 'string') {
      issues.push({ rule: 'R3', level: 'error', target: name, message: '建筑.research 必须是字符串或 null' });
    }
    requireStringArray('建筑', name, building, 'prereqs');
    requireStringArray('建筑', name, building, 'need_buildings');
    requireString('建筑', name, building, 'desc');
    checkLegacyRequirements('建筑', name, building);
    checkRequirements('建筑', name, building.requirements);
  }
  for (const production of productions) {
    const name = readName('生产', production);
    if (!name) continue;
    requireFiniteNumber('生产', name, production, 'cost');
    requireString('生产', name, production, 'need_building');
    requireStringArray('生产', name, production, 'need_buildings');
    requireString('生产', name, production, 'desc');
    checkLegacyRequirements('生产', name, production);
    checkRequirements('生产', name, production.requirements);
  }
  const faction = isPlainRecord(overlay.faction) ? overlay.faction : undefined;
  const hasT2 = researches.some(research => research.tier === 2);
  if (hasT2 && !faction?.lab)
    issues.push({
      rule: 'R2',
      level: 'error',
      target: overlayId,
      message: '声明了 T2 科技但 faction.lab（实验室）未声明——层级门槛无法推导',
    });
  const hasT3 = researches.some(research => research.tier === 3);
  if (hasT3)
    issues.push({
      rule: 'R2',
      level: 'error',
      target: overlayId,
      message: '声明了 T3 科技但 T3 开放条件未定义（当前推导上限 T2）',
    });
  return issues;
}

/** 世界书条目文本 lint（R5/R7）：对包内/已装书内容通用 */
export function lintBookContent(bookName: string, entryName: string, content: string): CheckIssue[] {
  const issues: CheckIssue[] = [];
  if (BOOK_PREFIX.test(bookName) && !/^\[[^\]|]+ \| [^\]]+\]/.test(content.trim())) {
    issues.push({
      rule: 'R5',
      level: 'warn',
      target: `${bookName}/${entryName}`,
      message: '正文首行不符合 [书名 | 分类] 标头体例',
    });
  }
  if (/预告[:：]|未解锁不展开/.test(content)) {
    issues.push({
      rule: 'R7',
      level: 'error',
      target: `${bookName}/${entryName}`,
      message: '含预告式剧透文案（"预告："/"未解锁不展开"）——违反随机性红线',
    });
  }
  return issues;
}

/* ═══════════════ 世界书维度（async，需酒馆 API） ═══════════════ */

interface WbEntryLike {
  name: string;
  enabled: boolean;
  strategy: { type: string };
  content: string;
}

/** 项目书体例约定：R5/R6 仅对匹配前缀的书严格执行（补上「特色建筑·」，与 useCatalog.ts resolveActiveWorldbookNames 前缀对齐——既有不一致修复） */
const BOOK_PREFIX = /^(通用·|特色科技·|特色建筑·|武备·)/;

export async function checkWorldbooks(): Promise<{ issues: CheckIssue[]; scanned: string[] }> {
  const issues: CheckIssue[] = [];
  const getNames = tav<(target?: string) => { primary: string | null; additional: string[] }>('getCharWorldbookNames');
  const getBook = tav<(n: string) => Promise<WbEntryLike[]>>('getWorldbook');
  if (!getNames || !getBook)
    return {
      issues: [{ rule: 'ENV', level: 'info', target: '世界书', message: '独立预览环境无世界书 API，本维度跳过' }],
      scanned: [],
    };

  let bound: string[];
  try {
    const cw = getNames('current');
    bound = [cw.primary, ...cw.additional].filter((x): x is string => !!x);
  } catch {
    return {
      issues: [{ rule: 'ENV', level: 'warn', target: '世界书', message: '读取角色卡绑定世界书失败' }],
      scanned: [],
    };
  }

  for (const bookName of bound) {
    let entries: WbEntryLike[];
    try {
      entries = await getBook(bookName);
    } catch {
      issues.push({ rule: 'R10', level: 'error', target: bookName, message: '绑定中的世界书拉取失败（不存在？）' });
      continue;
    }
    let constCount = 0;
    let constChars = 0;
    for (const e of entries) {
      if (!e.enabled) continue;
      issues.push(...lintBookContent(bookName, e.name, e.content));
      if (e.strategy.type === 'constant') {
        constCount++;
        constChars += e.content.length;
      }
    }
    // R6 MCV 铁律（特色科技书）
    if (bookName.startsWith('特色科技·') && !entries.some(e => e.enabled && /MCV|建造厂核心/.test(e.content))) {
      issues.push({
        rule: 'R6',
        level: 'error',
        target: bookName,
        message: '特色科技书未见 MCV 铁律表述（"MCV"/"建造厂核心"）',
      });
    }
    // R9 常驻预算（字符近似 token，粗估）
    if (constCount > 10 || constChars > 8000) {
      issues.push({
        rule: 'R9',
        level: 'warn',
        target: bookName,
        message: `常驻压力：蓝灯 ${constCount} 条 / ≈${constChars} 字（阈值 10 条 / 8000 字）`,
      });
    } else if (constCount > 0) {
      issues.push({
        rule: 'R9',
        level: 'info',
        target: bookName,
        message: `常驻：蓝灯 ${constCount} 条 / ≈${constChars} 字`,
      });
    }
  }
  return { issues, scanned: bound };
}

/* ═══════════════ 对账维度（async，需酒馆 API） ═══════════════ */

export async function checkLedger(overlays: DlcOverlay[], factionNames: string[]): Promise<CheckIssue[]> {
  const issues: CheckIssue[] = [];
  const getAllNames = tav<() => string[]>('getWorldbookNames');
  if (!getAllNames)
    return [{ rule: 'ENV', level: 'info', target: '对账', message: '独立预览环境无世界书 API，本维度跳过' }];

  let all: string[];
  try {
    all = getAllNames();
  } catch {
    return [{ rule: 'ENV', level: 'warn', target: '对账', message: '获取世界书名称列表失败' }];
  }
  const allSet = new Set(all);

  // R10a 册在书不在：$dlc 声称安装的书实际不存在
  for (const o of overlays) {
    const books = (o as DlcOverlay & { books?: string[] }).books ?? [];
    for (const b of books) {
      if (!allSet.has(b))
        issues.push({
          rule: 'R10',
          level: 'error',
          target: b,
          message: `$dlc[${o.id}] 登记的世界书不存在（手工删除？请卸载重装）`,
        });
    }
  }
  // R10b 书在册不在：阵营书存在但阵营不在注册清单（手工导入未走安装器）
  const known = new Set(factionNames);
  for (const name of all) {
    const m = name.match(/^(?:特色科技|武备)·(.+?)(?:_世界书)?$/);
    if (m && !known.has(m[1])) {
      issues.push({
        rule: 'R10',
        level: 'warn',
        target: name,
        message: `阵营书存在但"${m[1]}"未在注册清单（手工导入？前端 overlay 不会生效）`,
      });
    }
  }
  // R11 takeover 对账：批3 引入安装数据后启用
  return issues;
}

/* ═══════════════ 动态归档对账（变量↔世界书两真相源）═══════════════
 * MVU 延迟注入 = 草稿态/正史态闸门：codex（楼层变量）是暂存区，
 * 驾驶员确认后晋升进《EVA·动态档案》（全局正史），$archive（chat 变量，AI 不可见）为注册表。
 * 不做自动双向同步：漂移只检测、单向收敛、人裁决。 */

export const ARCHIVE_BOOK = 'EVA·动态档案';

export interface ArchiveRecord {
  kind: string;
  desc: string;
  params: Record<string, string>;
  archivedAt: string;
}

/** 读 $archive 注册表；预览/异常返回 null（降级） */
export async function readArchive(): Promise<Record<string, ArchiveRecord> | null> {
  const gv = tav<(o: { type: string }) => Record<string, unknown> | Promise<Record<string, unknown>>>('getVariables');
  if (!gv) return null;
  try {
    const v = await gv({ type: 'chat' });
    return ((v as Record<string, unknown>)?.$archive ?? {}) as Record<string, ArchiveRecord>;
  } catch {
    return null;
  }
}

/** R14 未归档 / R15 回溯孤儿；并入对账维度展示 */
export async function checkArchiveSync(codex: { name: string; kind: string }[]): Promise<CheckIssue[]> {
  const arch = await readArchive();
  if (arch === null) return [];
  const issues: CheckIssue[] = [];
  const codexNames = new Set(codex.map(c => c.name));
  // R14：codex 有（非阵营注册）+ 未入册 → 待归档
  for (const c of codex) {
    if (c.kind !== '阵营' && !(c.name in arch)) {
      issues.push({
        rule: 'R14',
        level: 'info',
        target: c.name,
        message: '动态内容未归档——楼层定格后可在下方归档区晋升进《EVA·动态档案》',
      });
    }
  }
  // R15：入册正史 + codex 已无 → 回溯孤儿（删楼/回档后变量回滚）
  for (const name of Object.keys(arch)) {
    if (!codexNames.has(name)) {
      issues.push({
        rule: 'R15',
        level: 'warn',
        target: name,
        message: '回溯孤儿：正史条目失去变量对应（楼层回滚？）——归档区可补录变量或删除条目',
      });
    }
  }
  return issues;
}
