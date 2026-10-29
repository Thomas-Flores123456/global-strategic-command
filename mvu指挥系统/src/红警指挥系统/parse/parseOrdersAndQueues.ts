/**
 * parse/parseOrdersAndQueues.ts —— 操作指令联动、队列挂载与调度令、部署标签预提取与部署令、工程令收集槽
 *
 * 约束：零 IO / 零酒馆 API / 零 Vue 依赖。
 */
import { parseString } from '@util/common';
import { resolveBaseReference, type RuntimeBaseLike } from '../core/catalogRuntimeContext';
import { QueueItem } from '../core/schema';
import { resolveMcvVehicleAliases } from '../engines/deploymentEngine';
import type { DispatchOrder } from '../engines/transactionEngine';
import { normalizeEngBlockPayload } from './engAndDeployOrders';
import { mapQueue } from './parseDomainAppliers';

export { normalizeEngBlockPayload };
import {
  applyAlign,
  asArray,
  canon,
  ENG_VERBS,
  ENUM_QUEUE_TYPE,
  green,
  isUsable,
  keyIndex,
  newCtx,
  preprocess,
  quarantineLeftovers,
  resolveEnum,
  toNum,
  yellow,
  type Ctx,
  type DeployBlockLike,
  type DeployCatalogIndexLike,
  type DeployDecl,
  type DeployOrder,
  type EngOrder,
  type EngOrderVerb,
  type StatData,
} from './parseTypesAndCanon';

/** 指令联动：操作:列表（完成/取消；可选 类型+基地 ID 消歧） */
export function applyOperations(ops: unknown, data: StatData, ctx: Ctx): void {
  for (const raw of asArray(ops)) {
    if (!isUsable(raw) || Array.isArray(raw)) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '操作',
        path: '操作',
        raw: JSON.stringify(raw),
        error: '操作元素非对象',
      });
      continue;
    }
    const operation = raw as Record<string, unknown>;
    const index = keyIndex(operation);
    let verb: '完成' | '取消' | null = null;
    let target = '';
    if (index.has(canon('完成'))) {
      verb = '完成';
      target = String(operation[index.get(canon('完成'))!] ?? '').trim();
    } else if (index.has(canon('取消'))) {
      verb = '取消';
      target = String(operation[index.get(canon('取消'))!] ?? '').trim();
    }
    if (!verb || !target) {
      ctx.quarantine.push({
        scope: 'key',
        path: '操作',
        raw: JSON.stringify(operation),
        error: '未知指令动词（仅支持 完成/取消）',
      });
      continue;
    }
    target = applyAlign(target, ctx, `操作.${verb}[${target}]`, 'tech');

    const rawType = readAliasValue(operation, index, ['类型', 'type']);
    const typeResult = rawType === undefined ? null : resolveEnum(rawType, ENUM_QUEUE_TYPE);
    if (typeResult && typeResult.value == null) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '操作',
        path: `操作.${verb}[${target}]`,
        raw: JSON.stringify(operation),
        error: `队列类型「${String(rawType)}」非法`,
      });
      continue;
    }
    const providedType = typeResult?.value ?? '';
    const rawBase = readAliasValue(operation, index, ['基地', 'base']);
    const providedBase = rawBase === undefined ? null : resolveBaseReference(data.bases as RuntimeBaseLike[], rawBase);
    if (providedBase && providedBase.status !== 'resolved') {
      ctx.quarantine.push({
        scope: 'element',
        tag: '操作',
        path: `操作.${verb}[${target}]`,
        raw: JSON.stringify(operation),
        error:
          providedBase.status === 'ambiguous'
            ? `基地引用「${providedBase.reference}」不唯一`
            : `基地引用「${providedBase.reference}」不存在`,
      });
      continue;
    }

    // F2-乙 收讫通道归一：操作.完成 不再直达账本（旧通道 splice/写 tech.done/置建筑运转全撤），
    // 映射为收讫声明移交三色对账门（useParse 接缝喂 reconcileProduction）——三色门仍是唯一裁决点。
    // 目标存在性/唯一性/物理完工校验全部归门（no_txn OVERRUN / REJECTED / time_conflict OVERRUN）。
    if (verb === '完成') {
      ctx.operationCompletions.push({
        item: target,
        type: providedType || undefined,
        base: providedBase?.status === 'resolved' ? providedBase.baseId : undefined,
        raw: JSON.stringify(operation),
      });
      green(ctx, { layer: 'instruction', message: `操作 "完成: ${target}" 收讫声明已归三色对账门统一裁决` });
      continue;
    }

    const queues = data.queues as Record<string, unknown>[];
    const candidateIndexes = queues
      .map((queue, queueIndex) => ({ queue, queueIndex }))
      .filter(({ queue }) => queue.status !== 'done' && queue.status !== 'cancelled')
      .filter(({ queue }) => canon(queue.item) === canon(target))
      .filter(({ queue }) => !providedType || canon(queue.type) === canon(providedType))
      .filter(({ queue }) => {
        if (!providedBase || providedBase.status !== 'resolved' || String(queue.type) === '研究') return true;
        const resolved = normalizeQueueBase(data, queue.base, String(queue.type));
        if (resolved.ok) return resolved.baseId === providedBase.baseId;
        // 多基地旧空 base 仅允许在 type+item 候选唯一，且输入精确携带 Base.id 时一次性消歧；基地名称不授予迁移权。
        const sameIdentity = queues.filter(
          candidate =>
            candidate.status !== 'done' &&
            candidate.status !== 'cancelled' &&
            canon(candidate.item) === canon(target) &&
            (!providedType || canon(candidate.type) === canon(providedType)),
        );
        return (
          !String(queue.base ?? '').trim() &&
          sameIdentity.length === 1 &&
          String(rawBase ?? '').trim() === providedBase.baseId
        );
      });
    if (candidateIndexes.length === 0) {
      yellow(
        ctx,
        { layer: 'instruction', message: `操作 "${verb}: ${target}" 目标不在队列中，已忽略` },
        { rule: 'R18', target, message: `指令目标不存在（${verb}）` },
      );
      continue;
    }
    if (candidateIndexes.length > 1) {
      yellow(
        ctx,
        { layer: 'instruction', message: `操作 "${verb}: ${target}" 命中多个队列，未执行` },
        { rule: 'R18', target, message: '指令目标不唯一，需补充类型与基地 ID' },
      );
      continue;
    }

    const { queue, queueIndex } = candidateIndexes[0];
    const type = String(queue.type);
    if (verb === '取消') {
      if (type !== '研究') {
        const storedBase = normalizeQueueBase(data, queue.base, type);
        const canExplicitlyResolveLegacy =
          !storedBase.ok &&
          !String(queue.base ?? '').trim() &&
          providedBase?.status === 'resolved' &&
          String(rawBase ?? '').trim() === providedBase.baseId;
        if (!storedBase.ok && !canExplicitlyResolveLegacy) {
          ctx.quarantine.push({
            scope: 'element',
            tag: '操作',
            path: `操作.${verb}[${target}]`,
            raw: JSON.stringify(operation),
            error: '旧空或无效基地队列必须先用显式 Base.id 消歧',
          });
          continue;
        }
      }
      queues.splice(queueIndex, 1);
      green(ctx, { layer: 'instruction', message: `取消队列 "${target}"` });
      ctx.appliedCount++;
      continue;
    }
  }
}

export function readAliasValue(
  source: Record<string, unknown>,
  index: Map<string, string>,
  aliases: readonly string[],
): unknown {
  for (const alias of aliases) {
    const key = index.get(canon(alias));
    if (key !== undefined) return source[key];
  }
  return undefined;
}

export function normalizeQueueBase(
  data: StatData,
  rawBase: unknown,
  queueType: string,
): { ok: true; baseId: string } | { ok: false; reason: string } {
  const reference = String(rawBase ?? '').trim();
  if (!reference) {
    if (queueType === '研究' || data.bases.length === 0) return { ok: true, baseId: '' };
    if (data.bases.length === 1 && String(data.bases[0].id).trim()) {
      return { ok: true, baseId: String(data.bases[0].id).trim() };
    }
    return { ok: false, reason: `${queueType || '物理'}队列缺少基地 ID` };
  }
  const resolved = resolveBaseReference(data.bases as RuntimeBaseLike[], reference);
  if (resolved.status === 'resolved') return { ok: true, baseId: resolved.baseId };
  return {
    ok: false,
    reason: resolved.status === 'ambiguous' ? `基地引用「${reference}」不唯一` : `基地引用「${reference}」不存在`,
  };
}

/** 调度令扩展字段别名（§2.3.1：「调度: <动词>」） */
export const DISPATCH_ALIASES = ['调度', 'dispatch'] as const;

/** 调度令声明（解析第一遍收集，第二遍基于队列增量后状态解析复合身份） */
export interface DispatchDecl {
  /** 对齐后的目标项目名 */
  item: string;
  /** 原样动词（宽进：枚举不收口，非法值由引擎拒 invalid_verb） */
  verb: string;
  /** LLM 提供的类型（原样，不枚举收口） */
  type?: string;
  /** LLM 提供的基地引用（原样） */
  base?: string;
  raw: string;
  path: string;
}

/**
 * 队列专用复合身份 upsert：研究按 type+item 全局唯一；建造/生产按 type+item+Base.id。
 * 旧基地名称只在唯一匹配时归一为 ID，歧义输入不修改任何既有队列。
 * CTRL-DISPATCH-PARSE-01：带「调度」键的条目为纯调度令声明（§2.3.1），不走队列 upsert
 * （防止对不存在目标的调度令反向创建幻影事务），第二遍统一解析为 DispatchOrder。
 */
export function upsertQueues(arr: Record<string, unknown>[], items: unknown, data: StatData, ctx: Ctx): void {
  const dispatchDecls: DispatchDecl[] = [];
  for (const rawItem of asArray(items)) {
    if (!isUsable(rawItem) || Array.isArray(rawItem)) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '队列',
        path: '队列',
        raw: JSON.stringify(rawItem),
        error: '数组元素非对象',
      });
      continue;
    }
    const source = rawItem as Record<string, unknown>;
    const index = keyIndex(source);
    const consumed = new Set<string>();
    const rawItemName = String(readAliasValue(source, index, ['项目', 'item', '名称']) ?? '').trim();
    if (!rawItemName) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '队列',
        path: '队列',
        raw: JSON.stringify(source),
        error: '缺少定位键(项目)',
      });
      continue;
    }
    const itemName = applyAlign(rawItemName, ctx, `队列[${rawItemName}]`, 'tech');

    // CTRL-DISPATCH-PARSE-01：调度令声明条目（纯指令，不 upsert 账本）——
    // 消费身份键后进 leftovers 体检；声明收集待第二遍基于队列增量后状态解析。
    const rawDispatch = readAliasValue(source, index, DISPATCH_ALIASES);
    if (rawDispatch !== undefined) {
      for (const alias of ['项目', 'item', '名称', '类型', 'type', '基地', 'base', ...DISPATCH_ALIASES]) {
        const key = index.get(canon(alias));
        if (key !== undefined) consumed.add(key);
      }
      const rawDispatchType = readAliasValue(source, index, ['类型', 'type']);
      const rawDispatchBase = readAliasValue(source, index, ['基地', 'base']);
      dispatchDecls.push({
        item: itemName,
        verb: String(rawDispatch ?? '').trim(),
        type: rawDispatchType === undefined ? undefined : String(rawDispatchType).trim(),
        base: rawDispatchBase === undefined ? undefined : String(rawDispatchBase).trim(),
        raw: JSON.stringify(source),
        path: `队列[${itemName}]`,
      });
      quarantineLeftovers(source, consumed, ctx, `队列[${itemName}]`);
      continue;
    }

    const rawType = readAliasValue(source, index, ['类型', 'type']);
    const typeResult = rawType === undefined ? null : resolveEnum(rawType, ENUM_QUEUE_TYPE);
    if (typeResult && typeResult.value == null) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '队列',
        path: `队列[${itemName}]`,
        raw: JSON.stringify(source),
        error: `队列类型「${String(rawType)}」非法`,
      });
      continue;
    }
    const providedType = typeResult?.value ?? '';
    const rawBase = readAliasValue(source, index, ['基地', 'base']);
    const providedBase = rawBase === undefined ? null : normalizeQueueBase(data, rawBase, providedType);
    if (providedBase && !providedBase.ok) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '队列',
        path: `队列[${itemName}]`,
        raw: JSON.stringify(source),
        error: providedBase.reason,
      });
      continue;
    }

    let candidates = arr.filter(
      queue => queue.status !== 'done' && queue.status !== 'cancelled' && canon(queue.item) === canon(itemName),
    );
    if (providedType) candidates = candidates.filter(queue => canon(queue.type) === canon(providedType));
    if (providedBase?.ok && providedType !== '研究') {
      const exact = candidates.filter(queue => {
        const normalized = normalizeQueueBase(data, queue.base, String(queue.type));
        return normalized.ok && normalized.baseId === providedBase.baseId;
      });
      const migratableLegacy =
        candidates.length === 1 &&
        !String(candidates[0].base ?? '').trim() &&
        String(rawBase ?? '').trim() === providedBase.baseId
          ? candidates
          : [];
      candidates = exact.length ? exact : migratableLegacy;
    }
    if (candidates.length > 1) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '队列',
        path: `队列[${itemName}]`,
        raw: JSON.stringify(source),
        error: '队列定位不唯一，请同时提供类型与基地 ID',
      });
      continue;
    }

    const existing = candidates[0];
    const draft: Record<string, unknown> = existing
      ? structuredClone(existing)
      : { item: itemName, type: '', base: '', progress: 0, eta: '' };
    const draftContext = newCtx();
    draftContext.align = ctx.align;
    mapQueue(draft, source, index, consumed, !existing, `队列[${itemName}]`, draftContext);
    draft.item = itemName;
    // F7：新建队列事务出生即排队——升格带宽门（settleTransactions 第④步/③′回检）统一放行。
    // 既有事务的 status 不改（含旧档默认 active 兑底），由 ③′回检对既成 active 做双上限裁决。
    if (!existing) draft.status = 'queued';
    if (!existing && !String(draft.base ?? '').trim()) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '队列',
        path: `队列[${itemName}]`,
        raw: JSON.stringify(source),
        error: '新队列必须显式提供可解析的基地 ID',
      });
      continue;
    }
    const normalizedBase = normalizeQueueBase(data, draft.base, String(draft.type));
    if (!normalizedBase.ok) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '队列',
        path: `队列[${itemName}]`,
        raw: JSON.stringify(source),
        error: normalizedBase.reason,
      });
      continue;
    }
    draft.base = normalizedBase.baseId;
    const parsed = QueueItem.safeParse(draft);
    if (!parsed.success) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '队列',
        path: `队列[${itemName}]`,
        raw: JSON.stringify(source),
        error: '队列元素未通过 schema 校验',
        suggestion: parsed.error.issues.map(issue => issue.message).join('; '),
      });
      continue;
    }
    if (existing) Object.assign(existing, parsed.data);
    else arr.push(parsed.data as Record<string, unknown>);
    // E3c 案甲：新建建造队列挂载 × 前沿工地 build.whitelist 校验点（R28 只警不拦；既有队列更新不追溯）
    if (!existing) checkBuildWhitelistOnMount(parsed.data as Record<string, unknown>, data, ctx);
    ctx.events.push(...draftContext.events);
    ctx.issues.push(...draftContext.issues);
    ctx.quarantine.push(...draftContext.quarantine);
    quarantineLeftovers(source, consumed, ctx, `队列[${itemName}]`);
    ctx.appliedCount += Math.max(1, draftContext.appliedCount);
  }

  // 第二遍：基于队列增量后状态解析调度令复合身份（同楼新建条目亦可被本楼调度）
  for (const decl of dispatchDecls) resolveDispatchOrder(decl, arr, data, ctx);
}

/* ═════ E3c 案甲：前沿工地 build.whitelist 挂载校验点（R28 只警不拦） ═════ */

/**
 * 正规建造厂锚定（豁免口径，复用 productionLanes lane.main 双通道先例，本地实现不引产线耦合）：
 * - 通道A：建筑名 includes 建造厂/MCV（productionLanes lane.main anchorNames=['建造厂','MCV'] 的放宽包含匹配；
 *   跨阵营误中在此无害——苏联建造厂同为正规建造厂，豁免语义不受影响）；
 * - 通道B：建筑为 deploy 产物且被授予能力面覆盖 'build.full'
 *   （LANE_DEPLOY_CAPABILITY['lane.main']＋capabilityCovers 语义：精确相等或 `xxx.*` 通配前缀）。
 */
export const MAINLINE_YARD_ANCHORS = ['建造厂', 'MCV'] as const;

export function grantedCoversBuildFull(granted: readonly string[] | undefined): boolean {
  for (const g of granted ?? []) {
    if (g === 'build.full') return true;
    if (g.endsWith('.*') && 'build.full'.startsWith(g.slice(0, -1))) return true;
  }
  return false;
}

export function baseHasMainlineYard(buildings: { name: string }[], deployIndex: DeployCatalogIndexLike): boolean {
  for (const b of buildings) {
    if (MAINLINE_YARD_ANCHORS.some(anchor => b.name.includes(anchor))) return true;
    const hit = deployIndex.byInto(b.name);
    if (hit && grantedCoversBuildFull(hit.block.capabilities)) return true;
  }
  return false;
}

/**
 * E3c 案甲·挂载校验点（设计稿§六，R28 只警不拦）：新建建造队列挂载时——
 * - 目标基地含正规建造厂（baseHasMainlineYard）→ 豁免；
 * - 基地在场前沿工地（deploy 产物经 byInto 反查命中且 capabilities 含 'build.whitelist'）声明了 whitelist
 *   → 校验项目名 ∈ whitelist（canon 消歧，同全库比对惯例）；不在 → 🟡 事件＋R28 warn，队列照常挂载；
 * - 多工地口径：同基地多个 build.whitelist 工地名单取并集（各工地授权各名单，并集放行）；
 * - 向后兼容：whitelist 缺席（旧数据）不校验不警示；deployIndex 缺席 → fail-closed 不校验（与部署段同纪律）。
 */
export function checkBuildWhitelistOnMount(queue: Record<string, unknown>, data: StatData, ctx: Ctx): void {
  if (String(queue.type ?? '') !== '建造') return; // 仅建造类（ENUM_QUEUE_TYPE 既有口径）
  const deployIndex = ctx.deployIndex;
  if (!deployIndex) return; // fail-closed：索引缺席不校验（同 resolveDeployOrder 纪律）
  const baseId = String(queue.base ?? '').trim();
  if (!baseId) return;
  const base = data.bases.find(b => b.id === baseId || b.name === baseId);
  const buildings = (base?.buildings ?? []) as { name: string }[];
  if (!buildings.length) return;
  if (baseHasMainlineYard(buildings, deployIndex)) return;
  let allowed: string[] | null = null;
  for (const b of buildings) {
    const hit = deployIndex.byInto(b.name);
    if (!hit || !(hit.block.capabilities ?? []).includes('build.whitelist')) continue;
    if (hit.block.whitelist === undefined) continue; // 旧数据：whitelist 缺席 → 该工地不启用校验
    allowed = allowed ? [...allowed, ...hit.block.whitelist] : [...hit.block.whitelist];
  }
  if (allowed === null) return; // 无启用校验的前沿工地
  const item = String(queue.item ?? '');
  if (allowed.some(w => canon(w) === canon(item))) return;
  const summary = allowed.length > 4 ? `${allowed.slice(0, 4).join('、')} 等 ${allowed.length} 项` : allowed.join('、');
  const baseName = String(base?.name ?? baseId);
  yellow(
    ctx,
    {
      layer: 'instruction',
      path: `队列[${item}]`,
      message: `建造项目「${item}」不在前沿工地「${baseName}」白名单内（白名单：${summary}），队列已挂载但请复核（工地仅获 build.whitelist 授权，R28 只警不拦）`,
    },
    {
      rule: 'R28',
      target: `队列[${item}]`,
      message: `建造「${item}」@「${baseName}」不在前沿工地白名单（${summary}），只警不拦`,
    },
  );
}

/**
 * 调度令声明 → DispatchOrder（CTRL-DISPATCH-PARSE-01 · 宽进严出，§2.3.1/§2.3.2）：
 * - 唯一命中：按复合身份构造——研究 type+item 全局唯一（免基地）；建造/生产/改装
 *   type+item+base（携带队列存储的归一 Base.id，引擎 findOrderTarget 为严格相等匹配）；
 * - 零命中（目标缺失/基地引用不可解析/类型非法）：如实构造并携带所供身份，
 *   由引擎裁决层拒 target_not_found（解析层不越权预拒）；
 * - 多义命中：解析层隔离（复用 upsertQueues「定位不唯一」先例——引擎匹配语义为
 *   数组序取首条非免疫态，无法代为裁决歧义，静默取首条违背宽进严出）；
 * - 动词不枚举收口（宽进）：非法值照实携带，由引擎拒 invalid_verb。
 */
export function resolveDispatchOrder(decl: DispatchDecl, arr: Record<string, unknown>[], data: StatData, ctx: Ctx): void {
  // 基地消歧（研究免基地；不可解析引用照实携带原串——匹配不上归一 ID，引擎按 target_not_found 拒令）
  let baseId: string | undefined;
  if (decl.base !== undefined && decl.type !== '研究') {
    const resolved = normalizeQueueBase(data, decl.base, decl.type ?? '');
    baseId = resolved.ok ? resolved.baseId : decl.base;
  }
  let candidates = arr.filter(
    queue => queue.status !== 'done' && queue.status !== 'cancelled' && canon(queue.item) === canon(decl.item),
  );
  if (decl.type) candidates = candidates.filter(queue => canon(queue.type) === canon(decl.type));
  if (baseId !== undefined) candidates = candidates.filter(queue => String(queue.base ?? '') === baseId);
  if (candidates.length > 1) {
    ctx.quarantine.push({
      scope: 'element',
      tag: '队列',
      path: `${decl.path}.调度`,
      raw: decl.raw,
      error: '调度令目标不唯一，请同时提供类型与基地 ID（违令进隔离区，§2.3.2）',
    });
    return;
  }

  const hit = candidates[0];
  const order: DispatchOrder = { item: hit ? String(hit.item) : decl.item, verb: decl.verb };
  if (hit) {
    const hitType = String(hit.type ?? '').trim();
    if (hitType) {
      order.type = hitType;
      if (hitType !== '研究') order.base = String(hit.base ?? '');
    } else if (String(hit.base ?? '').trim()) {
      order.base = String(hit.base);
    }
  } else {
    if (decl.type) order.type = decl.type;
    if (baseId !== undefined) order.base = baseId;
  }
  ctx.orders.push(order);
  green(ctx, {
    layer: 'instruction',
    path: 'queues',
    message: `调度令「${decl.verb}」→「${order.item}」已解析（${order.type ?? '未指类型'}${order.base !== undefined ? ` @ ${order.base}` : ''}），随本楼结算由引擎裁决执行`,
  });
}

export const DEPLOY_EXPAND_KEYS = ['展开', 'deploy'] as const;
export const DEPLOY_FOLD_KEYS = ['收起', 'undeploy'] as const;
export const DEPLOY_BASE_KEYS = ['基地', 'base'] as const;
export const DEPLOY_NEW_BASE_KEYS = ['新基地', 'new_base', 'newbase'] as const;
export const DEPLOY_LOCATION_KEYS = ['位置', 'location'] as const;

/* ═══════════════ E3b · <部署> 标签块预提取（设计稿§三） ═══════════════ */

/** <部署> 标签块名别名（canon 比对，大小写/全半角按既有惯例；与段一 YAML 键别名同源） */
export const DEPLOY_TAG_NAMES = ['部署', '展开', 'deploy'] as const;

/** 行级标签识别：独占一行的 <部署> / ＜deploy＞ / </部署>（容忍全角括号/斜杠/空白/属性垃圾）；非部署标签返回 null */
export function matchDeployTagLine(line: string): { close: boolean } | null {
  const m = /^[<\uFF1C]\s*([/\uFF0F])?\s*([^\s<>\uFF1C\uFF1E|=/]+)(?:[\s|=/][^<>\uFF1C\uFF1E]*)?[>\uFF1E]\s*$/.exec(
    line.trim(),
  );
  if (!m) return null;
  if (!DEPLOY_TAG_NAMES.some(n => canon(n) === canon(m[2]))) return null;
  return { close: !!m[1] };
}

/** 「键: 值」切分（首个半/全角冒号；值可含冒号）；无冒号或空键返回 null */
export function splitTagField(seg: string): { key: string; value: string } | null {
  const m = /^([^:：]+)[:：](.*)$/.exec(seg);
  if (!m || !m[1].trim()) return null;
  return { key: m[1].trim(), value: m[2].trim() };
}

/**
 * 块内按行解析声明：首字段为动词（展开/收起，别名同 DEPLOY_EXPAND_KEYS/DEPLOY_FOLD_KEYS），
 * 管道「|/｜」切分后续字段（基地/新基地/位置，别名同既有 *_KEYS 表）。
 * 产出与段一 YAML 键形完全同形的记录（原样保留键名拼写）：
 * 残键（如 LLM 重复申报的 耗时）原样带入，由 applyDeployments 既有 leftovers 纪律隔离；
 * 畸形行/未知动词不静默吞——逐条键级隔离留痕，不拖累同块其余声明。
 */
const DEPLOY_ACTION_KEYS = ['动作', '类型', '指令', '操作', '动词', 'action', 'type', 'op', 'verb'] as const;
const DEPLOY_VEHICLE_TARGET_KEYS = [
  '车辆',
  '载具',
  '单位',
  '目标',
  '名称',
  '对象',
  'vehicle',
  'unit',
  'target',
  'name',
] as const;
const DEPLOY_BUILDING_TARGET_KEYS = [
  '建筑',
  '目标',
  '设施',
  '车辆',
  '载具',
  '单位',
  '名称',
  '对象',
  'building',
  'into',
  'target',
  'vehicle',
  'unit',
  'name',
] as const;

function inferMcvDeployBlock(vehicleOrTarget: string): DeployBlockLike | undefined {
  const s = String(vehicleOrTarget ?? '').trim();
  if (!s) return undefined;
  if (resolveMcvVehicleAliases(s).length <= 1 && !/mcv|基地车/i.test(s)) return undefined;
  if (/苏联|苏军|soviet/i.test(s)) return { into: '苏联建造厂', duration_min: 0, reverse: true };
  if (/尤里|yuri/i.test(s)) return { into: '尤里建造厂', duration_min: 0, reverse: true };
  return { into: '盟军建造厂', duration_min: 0, reverse: true };
}

function inferConyardFoldHit(buildingName: string): { vehicle: string; block: DeployBlockLike } | undefined {
  const b = String(buildingName ?? '').trim();
  if (!b) return undefined;
  if (b === '苏联建造厂') return { vehicle: 'MCV（苏联）', block: { into: '苏联建造厂', duration_min: 0, reverse: true } };
  if (b === '尤里建造厂') return { vehicle: 'MCV（尤里）', block: { into: '尤里建造厂', duration_min: 0, reverse: true } };
  if (b === '盟军建造厂' || b === '建造厂') {
    return { vehicle: 'MCV（盟军）', block: { into: b, duration_min: 0, reverse: true } };
  }
  return undefined;
}

export function parseDeployTagBody(body: string[], decls: Record<string, unknown>[], ctx: Ctx): void {
  const lines = body.map(l => l.trim()).filter(l => l.length > 0);
  if (!lines.length) {
    ctx.quarantine.push({
      scope: 'block',
      tag: '部署',
      raw: '(空块)',
      error: '部署标签块为空（无声明行）',
      suggestion: '块内每行应为「展开/收起: 目标 | 基地/新基地/位置: 值」',
    });
    return;
  }
  const hasPipe = lines.some(l => /[|\uFF5C]/.test(l));
  const hasInlineCommaKv = lines.some(l => !/[|\uFF5C]/.test(l) && /[,，]\s*[^\s:：,，]+\s*[:：]/.test(l));
  const looksLikeYaml = lines.some(l => /^-\s+/.test(l)) || hasInlineCommaKv || (!hasPipe && lines.length > 1);
  if (looksLikeYaml) {
    try {
      const normalizedYamlLines = body.map(rawLine => {
        if (/[|\uFF5C]/.test(rawLine) || !/[,，]\s*[^\s:：,，]+\s*[:：]/.test(rawLine)) {
          return rawLine;
        }
        const trimmed = rawLine.trim();
        const isListItem = /^-\s+/.test(trimmed);
        const content = isListItem ? trimmed.replace(/^-\s+/, '') : trimmed;
        const parts = content
          .split(/[,，](?=\s*[^\s:：,，]+\s*[:：])/)
          .map(p => p.trim())
          .filter(Boolean);
        if (parts.length <= 1) return rawLine;
        return `- ${parts[0]}\n  ${parts.slice(1).join('\n  ')}`;
      });
      const parsedYaml = parseString(preprocess(normalizedYamlLines.join('\n')));
      if (Array.isArray(parsedYaml)) {
        for (const item of parsedYaml) {
          if (isUsable(item) && !Array.isArray(item)) {
            decls.push(item as Record<string, unknown>);
          }
        }
        if (decls.length > 0) return;
      } else if (isUsable(parsedYaml) && !Array.isArray(parsedYaml)) {
        decls.push(parsedYaml as Record<string, unknown>);
        return;
      }
    } catch {
      // fall through to line-by-line parser
    }
  }
  for (const line of lines) {
    const segments = line
      .split(/[|\uFF5C]/)
      .map(s => s.trim())
      .filter(Boolean);
    const first = segments.length ? splitTagField(segments[0]) : null;
    if (!first) {
      ctx.quarantine.push({ scope: 'key', path: '部署', raw: line, error: '声明行畸形（缺「动词: 目标」首字段）' });
      continue;
    }
    const verbCanon = canon(first.key);
    const isVerb =
      DEPLOY_EXPAND_KEYS.some(k => canon(k) === verbCanon) || DEPLOY_FOLD_KEYS.some(k => canon(k) === verbCanon);
    if (!isVerb) {
      ctx.quarantine.push({ scope: 'key', path: '部署', raw: line, error: '未知部署动词（仅支持 展开/收起）' });
      continue;
    }
    const source: Record<string, unknown> = { [first.key]: first.value };
    let malformed = false;
    for (const seg of segments.slice(1)) {
      const kv = splitTagField(seg);
      if (!kv) {
        ctx.quarantine.push({ scope: 'key', path: '部署', raw: line, error: `字段「${seg}」畸形（应为 键: 值）` });
        malformed = true;
        break;
      }
      source[kv.key] = kv.value;
    }
    if (!malformed) decls.push(source);
  }
}

/**
 * E3b · 段一前标签块预提取：从战况/初始状态原始文本（YAML 预处理之前）剥离 <部署>…</部署> 块，
 * 声明与 take 认领的 YAML 键形两路并存、汇入同一 deployDecls 流进既有段二（宽进严出零改动）；
 * 剥离后的文本才进 YAML 预处理，防标签行被绞成「战况.<部署> 展开」垃圾键误隔离；
 * 只认独占一行的标签（同 L0 行首纪律），非部署标签与正文一律不动；
 * 未闭合块黄灯留痕且原文保留（交 YAML 路径隔离），不静默吞。
 */
export function extractDeployTagBlocks(inner: string, ctx: Ctx): { cleaned: string; decls: Record<string, unknown>[] } {
  if (!/[<\uFF1C]/.test(inner)) return { cleaned: inner, decls: [] };
  const decls: Record<string, unknown>[] = [];
  const out: string[] = [];
  const lines = inner.split('\n');
  let i = 0;
  while (i < lines.length) {
    const open = matchDeployTagLine(lines[i]);
    if (!open || open.close) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const body: string[] = [];
    let j = i + 1;
    let closed = false;
    while (j < lines.length) {
      const t = matchDeployTagLine(lines[j]);
      if (t) {
        closed = t.close;
        break;
      }
      body.push(lines[j]);
      j++;
    }
    if (!closed) {
      yellow(
        ctx,
        { layer: 'L1', message: '<部署> 标签块未闭合，原文保留交由 YAML 路径隔离', snippet: lines[i].trim() },
        { rule: 'R17', target: '部署', message: '<部署> 标签块未闭合，未预提取' },
      );
      out.push(lines[i]);
      i++;
      continue;
    }
    parseDeployTagBody(body, decls, ctx);
    i = j + 1;
  }
  return { cleaned: out.join('\n'), decls };
}

/** 部署令拒收（宽进严出：🟡 事件＋R18 warn，声明不进 deployOrders 槽） */
export function rejectDeploy(ctx: Ctx, decl: DeployDecl, reason: string): void {
  yellow(
    ctx,
    { layer: 'instruction', path: decl.path, message: `部署令「${decl.verb}: ${decl.target}」拒收：${reason}` },
    { rule: 'R18', target: decl.path, message: `部署令拒收（${reason}）` },
  );
}

/**
 * 段一·声明收集：战况「部署/展开/deploy」键 → deployDecls[]（跳过账本直写）；
 * 段二·延迟解析：逐条 resolveDeployOrder（基于战况增量后状态，同楼新建基地亦可被本楼部署）。
 */
export function applyDeployments(deploys: unknown, data: StatData, ctx: Ctx): void {
  const deployDecls: DeployDecl[] = [];
  for (const rawItem of asArray(deploys)) {
    if (!isUsable(rawItem) || Array.isArray(rawItem)) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '部署',
        path: '部署',
        raw: JSON.stringify(rawItem),
        error: '部署元素非对象',
      });
      continue;
    }
    const source = rawItem as Record<string, unknown>;
    const index = keyIndex(source);
    const consumed = new Set<string>();
    const markKeys = (aliases: readonly string[]) => {
      for (const alias of aliases) {
        const key = index.get(canon(alias));
        if (key !== undefined) consumed.add(key);
      }
    };
    const expandRaw = readAliasValue(source, index, [...DEPLOY_EXPAND_KEYS]);
    const foldRaw = readAliasValue(source, index, [...DEPLOY_FOLD_KEYS]);
    const actionRaw = readAliasValue(source, index, [...DEPLOY_ACTION_KEYS]);
    let verb: '展开' | '收起' | null = null;
    let target = '';
    if (actionRaw !== undefined && String(actionRaw ?? '').trim()) {
      const actToken = canon(String(actionRaw).trim());
      markKeys(DEPLOY_ACTION_KEYS);
      if (DEPLOY_EXPAND_KEYS.some(k => canon(k) === actToken)) {
        verb = '展开';
        const tRaw = readAliasValue(source, index, [...DEPLOY_VEHICLE_TARGET_KEYS]);
        markKeys(DEPLOY_VEHICLE_TARGET_KEYS);
        target = tRaw !== undefined && String(tRaw ?? '').trim() ? String(tRaw).trim() : 'MCV';
      } else if (DEPLOY_FOLD_KEYS.some(k => canon(k) === actToken) || actToken === '撤收' || actToken === '转移') {
        verb = '收起';
        const tRaw = readAliasValue(source, index, [...DEPLOY_BUILDING_TARGET_KEYS]);
        markKeys(DEPLOY_BUILDING_TARGET_KEYS);
        target = tRaw !== undefined && String(tRaw ?? '').trim() ? String(tRaw).trim() : '建造厂';
      }
    } else if (expandRaw !== undefined && String(expandRaw ?? '').trim()) {
      verb = '展开';
      target = String(expandRaw).trim();
      markKeys(DEPLOY_EXPAND_KEYS);
    } else if (foldRaw !== undefined && String(foldRaw ?? '').trim()) {
      verb = '收起';
      target = String(foldRaw).trim();
      markKeys(DEPLOY_FOLD_KEYS);
    }
    if (!verb) {
      ctx.quarantine.push({
        scope: 'key',
        path: '部署',
        raw: JSON.stringify(source),
        error: '未知部署动词（仅支持 展开/收起）',
      });
      continue;
    }
    const baseRaw = readAliasValue(source, index, [...DEPLOY_BASE_KEYS]);
    const newBaseRaw = readAliasValue(source, index, [...DEPLOY_NEW_BASE_KEYS]);
    const locationRaw = readAliasValue(source, index, [...DEPLOY_LOCATION_KEYS]);
    markKeys(DEPLOY_BASE_KEYS);
    markKeys(DEPLOY_NEW_BASE_KEYS);
    markKeys(DEPLOY_LOCATION_KEYS);
    const decl: DeployDecl = { verb, target, raw: JSON.stringify(source), path: `部署[${target}]` };
    if (actionRaw !== undefined && String(actionRaw ?? '').trim()) decl.hasExplicitActionKey = true;
    if (baseRaw !== undefined && String(baseRaw).trim()) decl.base = String(baseRaw).trim();
    if (newBaseRaw !== undefined && String(newBaseRaw).trim()) decl.newBaseName = String(newBaseRaw).trim();
    if (locationRaw !== undefined && String(locationRaw).trim()) decl.location = String(locationRaw).trim();
    deployDecls.push(decl);
    quarantineLeftovers(source, consumed, ctx, `部署[${target}]`);
  }

  // 段二：延迟解析（宽进严出）
  for (const decl of deployDecls) resolveDeployOrder(decl, data, ctx);
}

/**
 * 部署声明 → DeployOrder（E3a · 宽进严出，设计稿§四）：
 * - deploy 目录索引未注入 → fail-closed 拒收（防幻影建筑/幻影载具；注入接线归 E3b 指令面批）；
 * - 展开：车 ∈ vehicles（canon 比对采账本原文）；catalog 存在以该车为 production 的 deploy 块；
 *   基地存在（resolveBaseReference）或 new_base 字段齐（两者同时申报/均缺席 → 拒收）；
 *   deploy_limit / capacity_ratio 满 → 拒收（只约束在场部署建筑，既有完工建筑不占容量）；
 * - 收起：基地存在＋建筑在场；反查 deploy.into 命中 → 回填载具原名；reverse=false → 拒收；
 * - 接受 → deployOrders 槽＋🟢 事件（解析层只构造，执行归引擎）。
 */
export function resolveDeployOrder(decl: DeployDecl, data: StatData, ctx: Ctx): void {
  const deployIndex = ctx.deployIndex;
  const allowMcvFallback = Boolean(decl.hasExplicitActionKey);
  if (!deployIndex && !allowMcvFallback) {
    rejectDeploy(ctx, decl, 'deploy 目录索引未注入，无法校验/解析（fail-closed 防幻影）');
    return;
  }

  // 基地引用消歧（收起必需；展开二选一）
  const resolveBase = (): { ok: true; baseId: string } | { ok: false } => {
    if (!decl.base) return { ok: false };
    const resolved = resolveBaseReference(data.bases as RuntimeBaseLike[], decl.base);
    if (resolved.status === 'resolved') return { ok: true, baseId: resolved.baseId };
    rejectDeploy(
      ctx,
      decl,
      resolved.status === 'ambiguous' ? `基地引用「${decl.base}」不唯一` : `基地引用「${decl.base}」不存在`,
    );
    return { ok: false };
  };

  if (decl.verb === '展开') {
    let vehicle = data.forces.vehicles.find(v => canon(v) === canon(decl.target));
    if (!vehicle) {
      const aliases = resolveMcvVehicleAliases(decl.target);
      if (aliases.length > 1) {
        vehicle = data.forces.vehicles.find(v => aliases.some(a => canon(v) === canon(a)));
      }
    }
    if (!vehicle) {
      rejectDeploy(ctx, decl, `载具「${decl.target}」不在车队（vehicles）`);
      return;
    }
    let block = deployIndex?.byVehicle(vehicle) ?? deployIndex?.byVehicle(decl.target);
    if (!block && deployIndex) {
      for (const alias of resolveMcvVehicleAliases(vehicle)) {
        block = deployIndex.byVehicle(alias);
        if (block) break;
      }
    }
    if (!block && allowMcvFallback) {
      block = inferMcvDeployBlock(vehicle) ?? inferMcvDeployBlock(decl.target);
    }
    if (!block) {
      rejectDeploy(ctx, decl, `catalog 无以「${vehicle}」为 production 的 deploy 块`);
      return;
    }
    if (decl.base && decl.newBaseName) {
      rejectDeploy(ctx, decl, '基地与新基地同时申报，目标歧义');
      return;
    }
    if (!decl.base && !decl.newBaseName) {
      rejectDeploy(ctx, decl, '缺少目标（基地 或 新基地 二选一）');
      return;
    }
    const isMcvExpand =
      block.into.includes('建造厂') || (block.capabilities ?? []).includes('build.conyard');
    let order: DeployOrder;
    if (decl.newBaseName) {
      order = {
        vehicle,
        action: '展开',
        base: decl.newBaseName,
        into: block.into,
        new_base: { name: decl.newBaseName, location: decl.location ?? '' },
        duration_min: block.duration_min ?? 0,
      };
    } else {
      const preCheck = decl.base
        ? resolveBaseReference(data.bases as RuntimeBaseLike[], decl.base)
        : ({ status: 'missing' as const } as ReturnType<typeof resolveBaseReference>);
      if (preCheck.status === 'missing' && decl.base && (data.bases.length === 0 || isMcvExpand)) {
        order = {
          vehicle,
          action: '展开',
          base: decl.base,
          into: block.into,
          new_base: { name: decl.base, location: decl.location ?? '' },
          duration_min: block.duration_min ?? 0,
        };
      } else {
        const resolved = resolveBase();
        if (!resolved.ok) return;
        const base = data.bases.find(b => b.id === resolved.baseId);
        // 容量护栏（只约束在场部署建筑；经建造队列完工移交的建筑不占部署容量，§五）
        if (base && block.deploy_limit !== undefined) {
          const count = base.buildings.filter(b => canon(b.name) === canon(block.into)).length;
          if (count >= block.deploy_limit) {
            rejectDeploy(ctx, decl, `基地「${decl.base}」在场「${block.into}」已达 deploy_limit=${block.deploy_limit}`);
            return;
          }
        }
        if (base && block.capacity_ratio !== undefined) {
          let used = 0;
          for (const b of base.buildings) used += deployIndex?.byInto(b.name)?.block.capacity_ratio ?? 0;
          if (used + block.capacity_ratio > 1) {
            rejectDeploy(ctx, decl, `基地「${decl.base}」部署容量占比 ${used}+${block.capacity_ratio}>1 已满`);
            return;
          }
        }
        order = {
          vehicle,
          action: '展开',
          base: resolved.baseId,
          into: block.into,
          duration_min: block.duration_min ?? 0,
        };
      }
    }
    ctx.deployOrders.push(order);
    if (decl.hasExplicitActionKey) {
      const pending = [...(data.pending_deployments ?? [])].filter(p => p.vehicle !== order.vehicle);
      pending.push({
        vehicle: order.vehicle,
        action: order.action,
        base: order.base,
        into: order.into,
        remaining_minutes: order.duration_min,
        ...(order.new_base ? { new_base: order.new_base } : {}),
      });
      data.pending_deployments = pending;
    }
    green(ctx, {
      layer: 'instruction',
      path: 'pending_deployments',
      message: `部署令「展开」→「${order.vehicle}」@ ${order.base} 已解析（目标建筑 ${order.into}，耗时 ${order.duration_min} 分钟），随本楼结算由引擎裁决执行`,
    });
    return;
  }

  // 收起：LLM 写建筑名，反查 deploy.into 命中 → 回填载具原名
  if (decl.newBaseName) {
    rejectDeploy(ctx, decl, '收起不支持新基地字段');
    return;
  }
  const resolved = resolveBase();
  if (!resolved.ok) return;
  const base = data.bases.find(b => b.id === resolved.baseId);
  let building = base?.buildings.find(b => canon(b.name) === canon(decl.target));
  if (!building && base) {
    const conyardAliases = ['盟军建造厂', '苏联建造厂', '尤里建造厂', '建造厂'];
    if (
      conyardAliases.some(c => canon(c) === canon(decl.target)) ||
      resolveMcvVehicleAliases(decl.target).length > 1 ||
      /mcv|基地车/i.test(decl.target)
    ) {
      building = base.buildings.find(b => conyardAliases.some(c => canon(b.name) === canon(c)));
    }
  }
  if (!base || !building) {
    rejectDeploy(ctx, decl, `建筑「${decl.target}」不在基地「${decl.base}」在场清单`);
    return;
  }
  const hit =
    deployIndex?.byInto(building.name) ??
    deployIndex?.byInto(decl.target) ??
    (allowMcvFallback ? inferConyardFoldHit(building.name) ?? inferConyardFoldHit(decl.target) : undefined);
  if (!hit) {
    rejectDeploy(ctx, decl, `建筑「${building.name}」非任何载具的 deploy.into，无法反查载具`);
    return;
  }
  if (hit.block.reverse !== true) {
    rejectDeploy(ctx, decl, `「${building.name}」deploy.reverse=false，不支持收起`);
    return;
  }
  const order: DeployOrder = {
    vehicle: hit.vehicle,
    action: '收起',
    base: resolved.baseId,
    into: building.name,
    duration_min: hit.block.duration_min ?? 0, // D6：收起耗时＝同块 duration_min
  };
  ctx.deployOrders.push(order);
  if (decl.hasExplicitActionKey) {
    const pending = [...(data.pending_deployments ?? [])].filter(p => p.vehicle !== order.vehicle);
    pending.push({
      vehicle: order.vehicle,
      action: order.action,
      base: order.base,
      into: order.into,
      remaining_minutes: order.duration_min,
    });
    data.pending_deployments = pending;
  }
  green(ctx, {
    layer: 'instruction',
    path: 'pending_deployments',
    message: `部署令「收起」→「${order.into}」@ ${order.base} 已解析（回填载具 ${order.vehicle}，耗时 ${order.duration_min} 分钟），随本楼结算由引擎裁决执行`,
  });
}

const ENG_NAME_KEYS = [
  'name',
  '名称',
  '工程名',
  '工程',
  '项目',
  '工程项目',
  'project',
  'project_name',
  'projectName',
  '目标',
  'target',
  'ref',
] as const;
const ENG_BASE_KEYS = ['base', '基地', '牵头基地'] as const;
const ENG_ID_KEYS = ['id', '实例', '实例id', 'instance_id', 'instanceId', 'projectRef', 'project_ref'] as const;
const ENG_PHASE_KEYS = ['phase', '阶段', '阶段号'] as const;
/** V2-05：模块定位键（仓段化 module 维度；与 phase 同构的 canon 别名收集） */
const ENG_MODULE_KEYS = ['module', 'module_id', 'moduleId', '模块', '模块id', '模块名', '仓段', '舱段'] as const;
const ENG_REASON_KEYS = ['reason', '理由', '原因'] as const;
/** UTO-ALLOC-01：指派令兼容键名 */
const ENG_ASSIGN_TARGET_KEYS = [
  'id',
  '实例',
  '实例id',
  'instance_id',
  'instanceId',
  'projectRef',
  'project_ref',
  '项目',
  '工程项目',
  '工程',
  '工程名',
  '名称',
  'name',
  'project',
  'project_name',
  'projectName',
  '指派',
  '目标',
  'target',
  'ref',
] as const;
const ENG_ASSIGN_MODULE_KEYS = [
  '模块',
  'module',
  'module_id',
  'moduleId',
  '模块id',
  '模块名',
  '仓段',
  '舱段',
  '目标模块',
] as const;
const ENG_ASSIGN_BASE_KEYS = [
  '基地',
  'base',
  'target_base',
  'targetBase',
  '承建基地',
  '目标基地',
  '牵头基地',
] as const;
const ENG_ACTION_KEYS = ['动作', 'action', 'verb', '操作', '指令', 'op'] as const;
const ENG_VERB_ALIASES: Readonly<Record<string, EngOrderVerb>> = {
  分配: '指派',
  allocate: '指派',
  assign: '指派',
  指派模块: '指派',
  模块指派: '指派',
  分配模块: '指派',
  模块分配: '指派',
  assignmodule: '指派',
  assign_module: '指派',
  allocatemodule: '指派',
  allocate_module: '指派',
  立项工程: '立项',
  工程立项: '立项',
  启动: '立项',
  启动工程: '立项',
  注资模块: '注资',
  模块注资: '注资',
  注资阶段: '注资',
  阶段注资: '注资',
  暂停模块: '暂停',
  模块暂停: '暂停',
  暂停工程: '暂停',
  恢复模块: '恢复',
  模块恢复: '恢复',
  恢复工程: '恢复',
  继续: '恢复',
  继续工程: '恢复',
  继续模块: '恢复',
  继续施工: '恢复',
  施工继续: '恢复',
  复工: '恢复',
  恢复施工: '恢复',
  重新启动: '恢复',
  停工: '暂停',
  暂停施工: '暂停',
  取消工程: '取消',
  工程取消: '取消',
  驳回工程: '驳回',
};

function parseAllocateShorthand(raw: string): { target: string; module: string; base: string } | null {
  const s = raw.trim();
  if (!s) return null;
  // 形态 1：target | module -> base 或 target / module @ base 或 target:module@base
  const arrowOrAt = s.match(/^([^|/:@#->,，]+?)\s*(?:[|/:>#]|->)\s*([^|/:@#->,，]+?)\s*(?:[@|]|->|=>)\s*(.+)$/);
  if (arrowOrAt) {
    const target = arrowOrAt[1].trim();
    const module = arrowOrAt[2].trim();
    const base = arrowOrAt[3].trim();
    if (target && module && base) return { target, module, base };
  }
  return null;
}

/** 工程令载荷隔离（fail-closed：畸形/缺字段/歧义载荷绝不动账本） */
export function quarantineEngElement(ctx: Ctx, path: string, source: unknown, error: string, suggestion?: string): void {
  ctx.quarantine.push({
    scope: 'element',
    tag: '工程',
    path,
    raw: JSON.stringify(source),
    error,
    ...(suggestion !== undefined ? { suggestion } : {}),
  });
}

/**
 * 实例标识双通道（DIR-9 D-R9-b）：proj:* 实例 id 直通（存在性由引擎裁决 not_found）；
 * 工程名 canon 唯一匹配归一为实例 id；多义 → null（调用方隔离）；零命中原样携带（引擎拒 not_found）。
 */
export function resolveEngInstanceId(data: StatData, raw: string): { id: string } | null {
  const trimmed = raw.trim();
  if (/^proj:/i.test(trimmed)) return { id: trimmed };
  const projects = (data.projects ?? []) as readonly { id?: unknown; ref?: unknown }[];
  const hits = projects.filter(p => canon(p.ref) === canon(trimmed));
  if (hits.length > 1) return null;
  if (hits.length === 1) return { id: String(hits[0].id ?? '').trim() || trimmed };
  return { id: trimmed };
}

/**
 * <工程> 块 → EngOrder 收集槽（CTRL-ENG-PROTO-01；V2-05 增 module 维度）：
 * 块内容为 YAML 键值映射，顶层键＝动词（立项/注资/暂停/恢复/取消/驳回），值＝载荷对象或载荷数组；
 * 只构造不执行（账本零写入、不计 appliedCount，对齐调度令/部署令收集槽先例）；
 * 畸形/缺字段/歧义 → 元素级隔离 fail-closed；未知顶层键归 leftovers 纪律。
 * module 键（V2-05）：注资/暂停/恢复合法定位维度（与 phase 互斥）；立项/取消不认（出现即整令隔离）。
 */
export function collectEngOrders(w: Record<string, unknown>, data: StatData, ctx: Ctx): void {
  const consumed = new Set<string>();
  const topIdx = keyIndex(w);
  const hasTopAssignSibling =
    ENG_ASSIGN_MODULE_KEYS.some(a => topIdx.has(canon(a))) ||
    ENG_ASSIGN_BASE_KEYS.some(a => topIdx.has(canon(a)));
  const topActionKey = ENG_ACTION_KEYS.map(a => topIdx.get(canon(a))).find(k => k !== undefined);
  const topActionCanon = topActionKey !== undefined ? canon(w[topActionKey]) : '';
  const topAssignKey =
    topIdx.get(canon('指派')) ?? topIdx.get(canon('分配')) ?? topIdx.get(canon('allocate'));
  const isFlatTopAllocate =
    topActionCanon === canon('指派') ||
    topActionCanon === canon('分配') ||
    topActionCanon === canon('allocate') ||
    (topAssignKey !== undefined && typeof w[topAssignKey] === 'string' && hasTopAssignSibling);

  const entries: [string, unknown][] = isFlatTopAllocate ? [['指派', [w]]] : Object.entries(w);

  for (const [key, value] of entries) {
    const verb = ENG_VERBS.find(v => canon(v) === canon(key)) ?? ENG_VERB_ALIASES[canon(key)];
    if (!verb) continue; // 未知键不消费，归块尾 leftovers 隔离
    if (!isFlatTopAllocate) consumed.add(key);
    const path = `工程.${verb}`;
    for (const rawElement of asArray(value)) {
      let element: unknown = rawElement;
      if (verb === '指派' && typeof rawElement === 'string') {
        const short = parseAllocateShorthand(rawElement);
        if (short) {
          element = { 指派: short.target, 模块: short.module, 基地: short.base };
        }
      } else if (
        Array.isArray(value) &&
        (verb === '暂停' || verb === '恢复' || verb === '取消' || verb === '注资') &&
        (typeof rawElement === 'string' || typeof rawElement === 'number') &&
        String(rawElement).trim() !== ''
      ) {
        element = { id: String(rawElement).trim() };
      }
      if (!isUsable(element) || Array.isArray(element)) {
        quarantineEngElement(
          ctx,
          path,
          element,
          `工程令「${verb}」载荷非对象（应为 {…} 键值映射）`,
          '示例：注资: {id: proj:xxx, phase: 1}',
        );
        continue;
      }
      const source = element as Record<string, unknown>;
      const index = keyIndex(source);
      const elemConsumed = isFlatTopAllocate && source === w ? consumed : new Set<string>();
      const takeField = (aliases: readonly string[]): unknown => {
        for (const alias of aliases) {
          const k = index.get(canon(alias));
          if (k !== undefined) {
            elemConsumed.add(k);
            return source[k];
          }
        }
        return undefined;
      };

      if (verb === '立项') {
        const name = String(takeField(ENG_NAME_KEYS) ?? '').trim();
        const baseText = String(takeField(ENG_BASE_KEYS) ?? '').trim();
        // V2-05：立项不认 module 键（工程级操作；出现即整令隔离，防模块粒度意图被误当工程级执行）
        if (takeField(ENG_MODULE_KEYS) !== undefined) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '立项令不认 module 键（立项是工程级操作，模块在注资/暂停/恢复令上定位）',
            '示例：立项: {name: <工程名>, base: <牵头基地>}；仓段化工程立项后由系统注资首个根模块，后续模块用 注资: {id, module: <模块>}',
          );
          continue;
        }
        if (!name || !baseText) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '立项令缺必填字段（name/base）',
            '示例：立项: {name: <工程名>, base: <牵头基地>}',
          );
          continue;
        }
        const aligned = applyAlign(name, ctx, `工程.立项[${name}]`, 'tech');
        const resolvedBase = resolveBaseReference(data.bases as RuntimeBaseLike[], baseText);
        if (resolvedBase.status === 'ambiguous') {
          quarantineEngElement(ctx, path, source, `立项令基地引用「${baseText}」不唯一，请改用 Base.id`);
          continue;
        }
        // 不可解析基地引用原样携带（宽进严出：引擎侧 id/name 双通道再匹配，失败由容量门拒收留痕）
        const order: EngOrder = {
          verb,
          name: aligned,
          base: resolvedBase.status === 'resolved' ? resolvedBase.baseId : baseText,
        };
        quarantineLeftovers(source, elemConsumed, ctx, `工程.立项[${aligned}]`);
        ctx.engOrders.push(order);
        green(ctx, {
          layer: 'instruction',
          path: 'projects',
          message: `工程令「立项」→「${order.name}」@ ${order.base} 已解析，由接缝结转 projectEngine.startProject（解析层不动账本）`,
        });
        continue;
      }

      if (verb === '驳回') {
        const idText = String(takeField(ENG_ID_KEYS) ?? takeField(ENG_NAME_KEYS) ?? '').trim();
        const reason = String(takeField(ENG_REASON_KEYS) ?? '').trim();
        if (!reason) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '驳回令缺叙事理由（reason 必填，DIR-9 D-R9-d）',
            '示例：驳回: {id: proj:xxx, reason: 预算不足}',
          );
          continue;
        }
        const order: EngOrder = { verb, reason };
        if (idText) {
          const resolved = resolveEngInstanceId(data, idText);
          if (resolved === null) {
            quarantineEngElement(ctx, path, source, `驳回令工程名「${idText}」匹配多个实例，请改用 proj:* 实例 id`);
            continue;
          }
          order.id = resolved.id;
        }
        quarantineLeftovers(source, elemConsumed, ctx, '工程.驳回');
        ctx.engOrders.push(order);
        green(ctx, {
          layer: 'instruction',
          path: 'projects',
          message: `工程令「驳回」${order.id !== undefined ? `→「${order.id}」` : ''}已解析（理由：${reason}；账本不动，仅登记回执）`,
        });
        continue;
      }

      if (verb === '指派') {
        takeField(ENG_ACTION_KEYS);
        const idText = String(takeField(ENG_ASSIGN_TARGET_KEYS) ?? '').trim();
        if (!idText) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '工程令「指派」缺实例定位（id / 项目 / 工程名 必填）',
            '示例：指派: {项目: 太阳帆阵列, 模块: 反射镜面A, 基地: 北极基地}',
          );
          continue;
        }
        const resolved = resolveEngInstanceId(data, idText);
        if (resolved === null) {
          quarantineEngElement(
            ctx,
            path,
            source,
            `工程令「指派」工程名「${idText}」匹配多个实例，请改用 proj:* 实例 id（歧义违令进隔离区）`,
          );
          continue;
        }
        if (takeField(ENG_PHASE_KEYS) !== undefined) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '指派令不认 phase 键（跨基地承建指派仅适用于仓段化工程模块 module）',
          );
          continue;
        }
        const moduleRaw = takeField(ENG_ASSIGN_MODULE_KEYS);
        const moduleText = moduleRaw === undefined ? '' : String(moduleRaw).trim();
        if (!moduleText) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '指派令缺模块定位（模块 / module 必填，应为模块 id 或模块名非空字符串）',
            '示例：指派: {项目: 太阳帆阵列, 模块: 反射镜面A, 基地: 北极基地}',
          );
          continue;
        }
        const baseRaw = takeField(ENG_ASSIGN_BASE_KEYS);
        const baseText = baseRaw === undefined ? '' : String(baseRaw).trim();
        if (!baseText) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '指派令缺目标承建基地（基地 / base / 承建基地 必填）',
            '示例：指派: {项目: 太阳帆阵列, 模块: 反射镜面A, 基地: 北极基地}',
          );
          continue;
        }
        const resolvedBase = resolveBaseReference(data.bases as RuntimeBaseLike[], baseText);
        if (resolvedBase.status === 'ambiguous') {
          quarantineEngElement(ctx, path, source, `指派令基地引用「${baseText}」不唯一，请改用 Base.id`);
          continue;
        }
        const reasonRaw = takeField(ENG_REASON_KEYS);
        const reasonText = reasonRaw === undefined ? '' : String(reasonRaw).trim();
        const finalBase = resolvedBase.status === 'resolved' ? resolvedBase.baseId : baseText;
        const order: EngOrder = {
          verb: '指派',
          action: 'allocate',
          id: resolved.id,
          instanceId: resolved.id,
          rawName: idText,
          module: moduleText,
          base: finalBase,
          ...(reasonText ? { reason: reasonText } : {}),
        };
        if (!(isFlatTopAllocate && source === w)) {
          quarantineLeftovers(source, elemConsumed, ctx, `工程.指派[${order.id}]`);
        }
        ctx.engOrders.push(order);
        green(ctx, {
          layer: 'instruction',
          path: 'projects',
          message: `工程令「指派」→「${order.id}」模块「${order.module}」@ ${order.base} 已解析，由接缝结转 projectEngine.assignModuleBase（解析层不动账本）`,
        });
        continue;
      }

      // 注资 / 暂停 / 恢复 / 取消：实例定位必填（兼容 ENG_NAME_KEYS 工程名兜底）
      const idText = String(takeField(ENG_ID_KEYS) ?? takeField(ENG_NAME_KEYS) ?? '').trim();
      if (!idText) {
        quarantineEngElement(
          ctx,
          path,
          source,
          `工程令「${verb}」缺实例定位（id 必填）`,
          '实例 id 形如 proj:<工程名>@<基地>，或写唯一工程名兜底',
        );
        continue;
      }
      const resolved = resolveEngInstanceId(data, idText);
      if (resolved === null) {
        quarantineEngElement(
          ctx,
          path,
          source,
          `工程令「${verb}」工程名「${idText}」匹配多个实例，请改用 proj:* 实例 id（歧义违令进隔离区）`,
        );
        continue;
      }
      const order: EngOrder = { verb, id: resolved.id };
      // V2-05：module 键收集（字符串，模块 id 或模块名原样携带；接缝按实例版本分流解析）
      const moduleRaw = takeField(ENG_MODULE_KEYS);
      const moduleText = moduleRaw === undefined ? '' : String(moduleRaw).trim();
      if (verb === '取消') {
        // 取消恒工程级：不认 module 键（V2-05；模块级取消不存在，出现即整令隔离）
        if (moduleRaw !== undefined) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '取消令不认 module 键（取消是工程级操作；模块级停工请用 暂停: {id, module: <模块>}）',
          );
          continue;
        }
      } else if (moduleRaw !== undefined && moduleText === '') {
        // module 键在场但空值：模块粒度意图明确却无法定位，fail-closed 整令隔离
        quarantineEngElement(ctx, path, source, `工程令「${verb}」module 键为空（应为模块 id 或模块名非空字符串）`);
        continue;
      } else if (moduleText !== '') {
        order.module = moduleText;
      }
      if (verb === '注资') {
        const baseRaw = takeField(ENG_BASE_KEYS);
        const baseText = baseRaw === undefined ? '' : String(baseRaw).trim();
        if (baseText) {
          const resolvedBase = resolveBaseReference(data.bases as RuntimeBaseLike[], baseText);
          if (resolvedBase.status === 'ambiguous') {
            quarantineEngElement(ctx, path, source, `注资令基地引用「${baseText}」不唯一，请改用 Base.id`);
            continue;
          }
          order.base = resolvedBase.status === 'resolved' ? resolvedBase.baseId : baseText;
        }
        const phaseRaw = takeField(ENG_PHASE_KEYS);
        // V2-05：phase 与 module 互斥（V1 线性阶段 vs V2 仓段模块；同现即整令隔离）
        if (phaseRaw !== undefined && moduleRaw !== undefined) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '注资令同时携带 phase 与 module（两者互斥：V1 线性工程用 phase，V2 仓段化工程用 module，只能取一）',
          );
          continue;
        }
        if (moduleRaw === undefined && phaseRaw !== undefined) {
          // 显式携带 phase 时校验非负整数；若 phase 与 module 均省略，结转至 engOrderBridge 自动推导（BUG-LIVE-20a）
          const phaseNum = String(phaseRaw ?? '').trim() === '' ? null : toNum(phaseRaw);
          if (phaseNum === null || !Number.isInteger(phaseNum) || phaseNum < 0) {
            quarantineEngElement(
              ctx,
              path,
              source,
              `注资令阶段号非法（应为 ≥0 整数，ProjectPhase.idx 口径），收到 ${JSON.stringify(phaseRaw)}`,
            );
            continue;
          }
          order.phase = phaseNum;
        }
      }
      quarantineLeftovers(source, elemConsumed, ctx, `工程.${verb}[${order.id}]`);
      ctx.engOrders.push(order);
      green(ctx, {
        layer: 'instruction',
        path: 'projects',
        message:
          `工程令「${verb}」→「${order.id}」` +
          `${order.phase !== undefined ? ` 阶段 #${order.phase}` : ''}` +
          `${order.module !== undefined ? ` 模块「${order.module}」` : ''}` +
          ' 已解析，由接缝结转 projectEngine（解析层不动账本）',
      });
    }
  }
  quarantineLeftovers(w, consumed, ctx, '工程');
}