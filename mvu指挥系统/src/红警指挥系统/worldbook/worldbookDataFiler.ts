/**
 * worldbookDataFiler.ts —— 世界书条目 <数据> 块动态补丁写入器（CTRL-DATA-FILER-01）
 *
 * 对齐任务包 §3.12 动态补丁管线规范：
 * 1. 纯函数 patch 合并（applyPatchToDataBlock）：支持 patch（深度递归合并、标签联合去重、配方按 id upsert、工况按 trigger upsert）与 replace；
 * 2. 差异计算纯函数（calculateDataDiff）：比对原数据与合并预期，生成多层级结构化变更集；
 * 3. 硬性安全红线（validatePatchPayload）：严禁包含 uid、key、keys、order、comment、content、正文、自然叙述等元数据或正文字段；
 * 4. 纯函数无损替换（applyDataPatchToEntries）：精确匹配目标条目，逐字保留元数据与自然叙述，仅原子替换 <数据> 块；
 * 5. 副作用落地层（fileDataPatch）：调用 updateWorldbookWith 落地世界书，并触发 useCatalogStore 响应式热重算；
 * 6. 审核门偏好（Auto-Apply）：本地持久化开关，默认保持关闭（OFF）。
 */

import { canon } from '../parse/parsePipeline';
import { validatePrerequisiteCondition } from '../core/prerequisites';
import type { DataPatch } from '../core/schema';
import { tav } from '../parse/systemCheck';
import type { ThEntry } from './girlFiler';
import { effectiveCatalogSnapshot, resolveActiveWorldbookNames, useCatalogStore } from '../composables/useCatalog';
import type { ChatBookGatewayLike } from './chatBookBinding';
import { chatBookGateway, GuardError } from './chatBookBinding';

/** 查找世界书条目内嵌数据块的标准正则 */
export const DATA_BLOCK_REGEX = /<数据>([\s\S]*?)<\/数据>/;

/** 硬性禁止出现在 patch 载荷中的红线字段（保护条目元数据与正文自然叙述） */
export const FORBIDDEN_PATCH_KEYS = ['uid', 'key', 'keys', 'order', 'comment', 'content', '正文', '自然叙述'] as const;

/**
 * 科技条目护栏（《通用·科技》V1 · D5）：research 类型条目额外禁改的身份/归属字段。
 * 仅对目标条目 type === 'research' 生效；building/production/retrofit 现有行为不变。
 */
export const RESEARCH_FORBIDDEN_PATCH_KEYS = ['id', 'name', 'type', 'aliases', 'pack', 'scope'] as const;

/* ═══════════════ 类型定义 ═══════════════ */

export interface DiffChange {
  path: string;
  type: 'added' | 'modified' | 'deleted';
  oldValue?: unknown;
  newValue?: unknown;
}

export interface DataPatchDiff {
  target: string;
  hasChanges: boolean;
  changes: DiffChange[];
}

/**
 * 隔离原因分类（CTRL-PATCH-UX-01）：
 * - not-found：任何书里都找不到目标；
 * - no-data-block：命中条目，但条目里没有 <数据> 块；
 * - data-corrupt：<数据> 块存在但 JSON 解析失败；
 * - red-line：补丁载荷触犯安全红线字段；
 * - write-error：写入世界书时抛出异常（书不存在、API 报错等）。
 */
export type QuarantineReason = 'not-found' | 'no-data-block' | 'data-corrupt' | 'red-line' | 'write-error';

/** 每类原因的中文标签 */
export const QUARANTINE_LABELS: Record<QuarantineReason, string> = {
  'not-found': '未命中',
  'no-data-block': '命中但无数据块',
  'data-corrupt': '数据块损坏',
  'red-line': '安全红线拦截',
  'write-error': '写入异常',
};

/** 每类原因的去处建议 */
export const QUARANTINE_SUGGESTIONS: Record<QuarantineReason, string> = {
  'not-found': '新实体请走扩展档案通道',
  'no-data-block': '目标条目未结构化，改走机娘档案或人工处理',
  'data-corrupt': '修复条目数据块后重试',
  'red-line': '删除补丁中的禁止字段后重试，或废弃驳回',
  'write-error': '确认目标世界书存在且可写后重试',
};

/** 跨书聚合时的原因优先级：越具体、越接近「命中」的原因越优先报出 */
const QUARANTINE_SEVERITY: Record<QuarantineReason, number> = {
  'not-found': 0,
  'write-error': 1,
  'no-data-block': 2,
  'data-corrupt': 3,
  'red-line': 4,
};

export interface QuarantineCandidate {
  reason: QuarantineReason;
  book: string;
  detail: string;
}

/** 纯函数：从多本书的失败结果中挑出最应报给驾驶员的一条（同级取先出现者） */
export function pickQuarantineCandidate(candidates: QuarantineCandidate[]): QuarantineCandidate | null {
  let best: QuarantineCandidate | null = null;
  for (const c of candidates) {
    if (!best || QUARANTINE_SEVERITY[c.reason] > QUARANTINE_SEVERITY[best.reason]) best = c;
  }
  return best;
}

/** 纯函数：生成规则③隔离提示「[原因] 详情。建议：去处」 */
export function describeQuarantine(
  target: string,
  candidateBooks: string[],
  picked: QuarantineCandidate | null,
): { reason: QuarantineReason; suggestion: string; message: string } {
  const reason: QuarantineReason = picked?.reason ?? 'not-found';
  const suggestion = QUARANTINE_SUGGESTIONS[reason];
  let body: string;
  if (reason === 'not-found') {
    body = `当前聊天档案书与候选全局设定书 [${candidateBooks.join(', ')}] 中均找不到目标 "${target}"`;
  } else {
    body = `《${picked!.book}》：${picked!.detail}`;
  }
  return { reason, suggestion, message: `[${QUARANTINE_LABELS[reason]}] ${body}。建议：${suggestion}` };
}

export interface EntrySnapshot {
  name: string;
  content: string;
  enabled: boolean;
  keys: string[];
}

export interface PatchResult {
  success: boolean;
  target: string;
  action: 'patched' | 'replaced' | 'quarantined';
  entryName?: string;
  bookName?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  diff?: DataPatchDiff;
  beforeEntrySnapshot?: EntrySnapshot;
  afterEntrySnapshot?: EntrySnapshot;
  error?: string;
  /** 隔离时的原因分类 */
  reason?: QuarantineReason;
}

export interface FileDataPatchReceipt {
  patchId: string;
  target: string;
  worldbook: string;
  action: 'patched' | 'replaced' | 'updated' | 'quarantined';
  success: boolean;
  diff?: DataPatchDiff;
  beforeEntrySnapshot?: EntrySnapshot;
  afterEntrySnapshot?: EntrySnapshot;
  error?: string;
  /** 隔离时的原因分类（CTRL-PATCH-UX-01） */
  quarantineReason?: QuarantineReason;
  /** 隔离时的去处建议（CTRL-PATCH-UX-01） */
  suggestion?: string;
}

type UpdateWorldbookWith = (name: string, updater: (entries: ThEntry[]) => ThEntry[]) => Promise<ThEntry[]>;

/* ═══════════════ 安全红线校验（纯函数） ═══════════════ */

/**
 * 校验 patch 载荷是否触犯安全红线（严禁篡改条目元数据或正文）
 */
export function validatePatchPayload(payload: unknown): { valid: boolean; violations: string[] } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, violations: ['载荷必须为键值对象'] };
  }
  const obj = payload as Record<string, unknown>;
  const violations: string[] = [];
  for (const k of Object.keys(obj)) {
    const ck = canon(k);
    if (FORBIDDEN_PATCH_KEYS.some(f => canon(f) === ck)) {
      violations.push(k);
    }
  }
  return {
    valid: violations.length === 0,
    violations,
  };
}

/* ═══════════════ 差异计算引擎（纯函数） ═══════════════ */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

/**
 * 计算原数据块与新数据块之间的深层结构化差异
 */
export function calculateDataDiff(
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
  target = '',
): DataPatchDiff {
  const changes: DiffChange[] = [];

  function walk(oldObj: Record<string, unknown>, newObj: Record<string, unknown>, prefix = '') {
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
    for (const k of allKeys) {
      const currentPath = prefix ? `${prefix}.${k}` : k;
      const hasOld = Object.prototype.hasOwnProperty.call(oldObj, k);
      const hasNew = Object.prototype.hasOwnProperty.call(newObj, k);

      if (!hasOld && hasNew) {
        changes.push({ path: currentPath, type: 'added', newValue: newObj[k] });
      } else if (hasOld && !hasNew) {
        changes.push({ path: currentPath, type: 'deleted', oldValue: oldObj[k] });
      } else {
        const valOld = oldObj[k];
        const valNew = newObj[k];
        if (isPlainObject(valOld) && isPlainObject(valNew)) {
          walk(valOld, valNew, currentPath);
        } else if (!deepEqual(valOld, valNew)) {
          changes.push({ path: currentPath, type: 'modified', oldValue: valOld, newValue: valNew });
        }
      }
    }
  }

  walk(oldData, newData);

  return {
    target,
    hasChanges: changes.length > 0,
    changes,
  };
}

/* ═══════════════ patch 合并引擎（纯函数） ═══════════════ */

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 深度合并数据块：
 * - tags：去重联合合并
 * - recipes：按 recipe.id upsert
 * - conditions：按 condition.trigger upsert
 * - 嵌套对象：递归合并
 * - 基本类型及其他：patch 覆盖
 */
function deepMergeData(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = deepClone(target);
  for (const [key, patchVal] of Object.entries(patch)) {
    if (patchVal === undefined) continue;
    const targetVal = result[key];

    if (Array.isArray(patchVal)) {
      if (key === 'tags' && Array.isArray(targetVal)) {
        // 标签数组去重联合
        const set = new Set<string>();
        for (const t of targetVal) if (typeof t === 'string' && t.trim()) set.add(t.trim());
        for (const t of patchVal) if (typeof t === 'string' && t.trim()) set.add(t.trim());
        result[key] = [...set];
      } else if (key === 'recipes' && Array.isArray(targetVal)) {
        // 配方按 id upsert
        const mergedRecipes = [...targetVal];
        for (const item of patchVal) {
          if (isPlainObject(item) && 'id' in item) {
            const idx = mergedRecipes.findIndex(r => isPlainObject(r) && r.id === item.id);
            if (idx >= 0) {
              mergedRecipes[idx] = deepMergeData(mergedRecipes[idx] as Record<string, unknown>, item);
            } else {
              mergedRecipes.push(deepClone(item));
            }
          } else {
            mergedRecipes.push(deepClone(item));
          }
        }
        result[key] = mergedRecipes;
      } else if (key === 'conditions' && Array.isArray(targetVal)) {
        // 动态工况条件按 trigger upsert
        const mergedConds = [...targetVal];
        for (const item of patchVal) {
          if (isPlainObject(item) && 'trigger' in item) {
            const idx = mergedConds.findIndex(c => isPlainObject(c) && c.trigger === item.trigger);
            if (idx >= 0) {
              mergedConds[idx] = deepMergeData(mergedConds[idx] as Record<string, unknown>, item);
            } else {
              mergedConds.push(deepClone(item));
            }
          } else {
            mergedConds.push(deepClone(item));
          }
        }
        result[key] = mergedConds;
      } else {
        result[key] = deepClone(patchVal);
      }
    } else if (isPlainObject(patchVal)) {
      if (isPlainObject(targetVal)) {
        result[key] = deepMergeData(targetVal, patchVal);
      } else {
        result[key] = deepClone(patchVal);
      }
    } else {
      result[key] = patchVal;
    }
  }
  return result;
}

/**
 * 将 patch 应用到原数据对象上（纯函数）
 * @param originalData 原始条目 <数据> 块 JSON 对象
 * @param patch 待更新载荷
 * @param operation 'patch' (深度合并) | 'replace' (替换非核心属性)
 */
export function applyPatchToDataBlock(
  originalData: Record<string, unknown>,
  patch: Record<string, unknown>,
  operation: 'patch' | 'replace' = 'patch',
): Record<string, unknown> {
  if (operation === 'replace') {
    // replace 时强制保留条目基础身份字段，其余字段由 patch 全量替换
    return {
      schema_version: originalData.schema_version ?? 1,
      type: originalData.type ?? 'building',
      id: originalData.id,
      name: originalData.name,
      ...deepClone(patch),
    };
  }
  return deepMergeData(originalData, patch);
}

/**
 * 渲染标准世界书 <数据>\n{ JSON }\n</数据> 块（对齐 D-CTRL-DATA-TAG-01 契约）
 */
export function renderDataBlock(data: Record<string, unknown>): string {
  return `<数据>\n${JSON.stringify(data, null, 2)}\n</数据>`;
}

/* ═══════════════ 条目定位与原子替换（纯函数） ═══════════════ */

/**
 * 从世界书条目数组中，精准定位匹配 target 的条目及其 <数据> 块
 */
export function findTargetEntry(
  entries: ThEntry[],
  target: string,
): { entry?: ThEntry; dataJson?: Record<string, unknown>; error?: string; reason?: QuarantineReason } {
  const cTarget = canon(target);
  if (!cTarget) return { error: '目标参数为空', reason: 'not-found' };

  let candidateEntry: ThEntry | undefined;
  let candidateDataJson: Record<string, unknown> | undefined;

  /** 读取条目 <数据> 块的 type（损坏/无块返回 null）；供 research 子串命中护栏使用 */
  const entryDataType = (e: ThEntry): string | null => {
    const m = e.content?.match(DATA_BLOCK_REGEX);
    if (!m) return null;
    try {
      const d = JSON.parse(m[1]) as Record<string, unknown>;
      return d && typeof d.type === 'string' ? d.type : null;
    } catch {
      return null;
    }
  };

  // 优先级 1: 扫描内嵌 <数据>.id 或 <数据>.name 精确匹配
  for (const e of entries) {
    if (!e.content) continue;
    const m = e.content.match(DATA_BLOCK_REGEX);
    if (!m) continue;
    try {
      const data = JSON.parse(m[1]) as Record<string, unknown>;
      if (data && typeof data === 'object') {
        const idMatch = data.id && canon(data.id) === cTarget;
        const nameMatch = data.name && canon(data.name) === cTarget;
        if (idMatch || nameMatch) {
          return { entry: e, dataJson: data };
        }
      }
    } catch {
      // 容错忽略单个损坏条目
    }
  }

  // 优先级 2: 匹配条目标题 (name / comment)
  // 科技条目护栏（D5）：research 条目只允许精确名命中，禁用子串 includes（防误改同前缀科技条目）
  for (const e of entries) {
    const entryName = String(e.name || e.comment || '');
    if (canon(entryName) === cTarget) {
      candidateEntry = e;
      break;
    }
    if (entryName.includes(target) && entryDataType(e) !== 'research') {
      candidateEntry = e;
      break;
    }
  }

  // 优先级 3: 匹配条目 keys
  if (!candidateEntry) {
    for (const e of entries) {
      const keys = (e.key || e.keys || (e.strategy && e.strategy.keys)) as unknown;
      if (Array.isArray(keys)) {
        if (keys.some(k => typeof k === 'string' && canon(k) === cTarget)) {
          candidateEntry = e;
          break;
        }
      }
    }
  }

  if (!candidateEntry) {
    return { error: `未能在世界书条目中定位到目标 "${target}"`, reason: 'not-found' };
  }

  if (!candidateEntry.content || !candidateEntry.content.match(DATA_BLOCK_REGEX)) {
    return {
      entry: candidateEntry,
      error: `条目 "${candidateEntry.name || target}" 存在，但未包含标准 <数据> 块`,
      reason: 'no-data-block',
    };
  }

  const m = candidateEntry.content.match(DATA_BLOCK_REGEX)!;
  try {
    candidateDataJson = JSON.parse(m[1]) as Record<string, unknown>;
  } catch (err) {
    return {
      entry: candidateEntry,
      error: `条目 "${candidateEntry.name || target}" 的 <数据> 块 JSON 解析损坏: ${String(err)}`,
      reason: 'data-corrupt',
    };
  }

  return { entry: candidateEntry, dataJson: candidateDataJson };
}

function readEntryKeys(e: ThEntry): string[] {
  const raw = e.strategy?.keys ?? e.key ?? e.keys ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.map(k => String(k ?? '').trim()).filter(Boolean);
}

function snapshotEntry(e: ThEntry): EntrySnapshot {
  return {
    name: e.name || String(e.comment || ''),
    content: e.content || '',
    enabled: e.enabled ?? true,
    keys: [...readEntryKeys(e)],
  };
}

/**
 * 纯函数原子替换：将 patch 应用于世界书条目列表（无副作用）
 * 严格保持元数据与自然叙述逐字不变，仅原子替换 <数据> 块，并幂等同步新名称/别名到触发词
 */
export function applyDataPatchToEntries(
  entries: ThEntry[],
  patch: Pick<DataPatch, 'target' | 'operation' | 'patch'>,
): PatchResult {
  // 1. 安全红线严格校验
  const valRes = validatePatchPayload(patch.patch);
  if (!valRes.valid) {
    return {
      success: false,
      target: patch.target,
      action: 'quarantined',
      error: `安全红线拦截：patch 包含禁止字段 [${valRes.violations.join(', ')}]`,
      reason: 'red-line',
    };
  }

  // 2. 定位目标条目
  const found = findTargetEntry(entries, patch.target);
  if (!found.entry || !found.dataJson) {
    return {
      success: false,
      target: patch.target,
      action: 'quarantined',
      error: found.error || `未命中目标条目 "${patch.target}"`,
      reason: found.reason ?? 'not-found',
    };
  }

  const entry = found.entry;
  const oldData = found.dataJson;

  // 2.5 科技条目护栏（《通用·科技》V1 · D5）：仅对 research 条目生效，其他类型行为不变
  if (oldData.type === 'research') {
    const payload = patch.patch as Record<string, unknown>;
    const identityViolations: string[] = [];
    for (const k of Object.keys(payload)) {
      const ck = canon(k);
      if (RESEARCH_FORBIDDEN_PATCH_KEYS.some(f => canon(f) === ck)) identityViolations.push(k);
    }
    if (identityViolations.length > 0) {
      return {
        success: false,
        target: patch.target,
        action: 'quarantined',
        error: `科技条目护栏拦截：research 条目禁止修改身份/归属字段 [${identityViolations.join(', ')}]`,
        reason: 'red-line',
      };
    }
    // requirements 变更先过前置条件内核校验，失败拒绝（防 AI 写入非法前置形状）
    if (Object.prototype.hasOwnProperty.call(payload, 'requirements')) {
      const diags = validatePrerequisiteCondition(payload.requirements);
      if (diags.length > 0) {
        const first = diags[0];
        return {
          success: false,
          target: patch.target,
          action: 'quarantined',
          error: `科技条目护栏拦截：requirements 未通过前置校验（${first.path}: ${first.message}，共 ${diags.length} 处）`,
          reason: 'red-line',
        };
      }
    }
  }

  const beforeEntrySnapshot = snapshotEntry(entry);

  // 3. 纯函数计算合并结果
  const newData = applyPatchToDataBlock(oldData, patch.patch, patch.operation);
  const diff = calculateDataDiff(oldData, newData, patch.target);

  // 4. 原子替换条目正文中的 <数据>...</数据> 块（其余字符与格式逐字不变）
  const newBlock = renderDataBlock(newData);
  const originalContent = entry.content || '';
  entry.content = originalContent.replace(DATA_BLOCK_REGEX, newBlock);

  // 5. 当 newData 包含新的 name、upgraded_name 或 aliases 时，自动幂等同步进触发词
  const newTriggerKeys: string[] = [];
  if (typeof newData.name === 'string' && newData.name.trim()) {
    newTriggerKeys.push(newData.name.trim());
  }
  if (typeof newData.upgraded_name === 'string' && newData.upgraded_name.trim()) {
    newTriggerKeys.push(newData.upgraded_name.trim());
  }
  if (Array.isArray(newData.aliases)) {
    for (const alias of newData.aliases) {
      if (typeof alias === 'string' && alias.trim()) {
        newTriggerKeys.push(alias.trim());
      }
    }
  }

  if (newTriggerKeys.length > 0) {
    const strategyKeys = Array.isArray(entry.strategy?.keys)
      ? [...entry.strategy.keys]
      : [...readEntryKeys(entry)];
    for (const k of newTriggerKeys) {
      if (!strategyKeys.includes(k)) {
        strategyKeys.push(k);
      }
    }
    entry.strategy = {
      ...(entry.strategy ?? { type: 'selective' }),
      keys: strategyKeys,
    };

    if (Array.isArray(entry.key)) {
      const keyArr = [...entry.key];
      for (const k of newTriggerKeys) {
        if (!keyArr.includes(k)) {
          keyArr.push(k);
        }
      }
      entry.key = keyArr;
    }

    if (Array.isArray(entry.keys)) {
      const keysArr = [...entry.keys];
      for (const k of newTriggerKeys) {
        if (!keysArr.includes(k)) {
          keysArr.push(k);
        }
      }
      entry.keys = keysArr;
    }
  }

  const afterEntrySnapshot = snapshotEntry(entry);

  return {
    success: true,
    target: patch.target,
    action: patch.operation === 'replace' ? 'replaced' : 'patched',
    entryName: entry.name || String(entry.comment || ''),
    oldData,
    newData,
    diff,
    beforeEntrySnapshot,
    afterEntrySnapshot,
  };
}

/* ═══════════════ 副作用落地层（TavernHelper） ═══════════════ */

export interface FileDataPatchOptions {
  worldbookName?: string;
  dryRun?: boolean;
  gateway?: ChatBookGatewayLike;
  /** 17号方案A · SEAM-03：全局设定世界书不再物理写入 updateWb，改为楼层内存叠加态返回 */
  preferTimelineOverlay?: boolean;
}

/**
 * 落地单个数据更新补丁至世界书（副作用层）
 *
 * CTRL-CHATBOOK-02 §3.1 补丁双轨分流三规则：
 * 规则① 目标 ∈ 当前聊天档案书（先查）
 *        → 聊天轨：经 chatBookGateway 三重守卫后写入当前聊天档案书（同名时聊天书条目遮蔽全局条目）；
 *          聊天轨守卫失败 fail-closed，绝不降级写全局书。
 * 规则② 目标 ∈ 全局设定书（后查）
 *        → 全局轨：现行 resolveActiveWorldbookNames 候选链行为原样（Diff 审核门/红线校验/热重算零改动）。
 * 规则③ 两处均未落地
 *        → 不走补丁管线，quarantined 留痕；跨书聚合后按原因给去处建议（CTRL-PATCH-UX-01）：
 *          未命中「新实体请走扩展档案通道」/ 命中但无数据块「目标条目未结构化，改走机娘档案或人工处理」/
 *          数据块损坏「修复条目数据块后重试」。
 *
 * 成功写入后自动触发 useCatalogStore().refresh() 热重算。
 */
export async function fileDataPatch(
  patch: DataPatch,
  options?: FileDataPatchOptions,
  gateway: ChatBookGatewayLike = options?.gateway ?? chatBookGateway,
): Promise<FileDataPatchReceipt> {
  const updateWb = tav<UpdateWorldbookWith>('updateWorldbookWith');
  if (!updateWb && !options?.preferTimelineOverlay) {
    throw new Error('酒馆 API updateWorldbookWith 不可用（独立预览或测试桩环境）');
  }

  let finalReceipt: FileDataPatchReceipt | null = null;
  let lastError = '';
  let lastReason: QuarantineReason | undefined;
  /** 规则③聚合用：记下每本书的失败原因，最终按优先级报出最具体的一条（CTRL-PATCH-UX-01） */
  const misses: QuarantineCandidate[] = [];

  // 1. 若显式指定目标世界书，直接针对该书处理（单测或调试专用）
  if (options?.worldbookName) {
    const book = options.worldbookName;
    let resultForBook: PatchResult | null = null;
    try {
      await updateWb!(book, entries => {
        const res = applyDataPatchToEntries(entries, patch);
        resultForBook = res;
        return res.success && !options?.dryRun ? entries : entries;
      });

      if (resultForBook && (resultForBook as PatchResult).success) {
        finalReceipt = {
          patchId: patch.id,
          target: patch.target,
          worldbook: book,
          action: (resultForBook as PatchResult).action,
          success: true,
          diff: (resultForBook as PatchResult).diff,
          beforeEntrySnapshot: (resultForBook as PatchResult).beforeEntrySnapshot,
          afterEntrySnapshot: (resultForBook as PatchResult).afterEntrySnapshot,
        };
      } else if (resultForBook) {
        lastError = (resultForBook as PatchResult).error || '写入失败';
        lastReason = (resultForBook as PatchResult).reason ?? 'not-found';
      }
    } catch (err) {
      lastError = String(err);
      lastReason = 'write-error';
    }

    if (!finalReceipt) {
      const reason: QuarantineReason = lastReason ?? 'not-found';
      return {
        patchId: patch.id,
        target: patch.target,
        worldbook: book,
        action: 'quarantined',
        success: false,
        error: lastError || `在指定世界书 [${book}] 中未成功匹配并写入目标 "${patch.target}"`,
        quarantineReason: reason,
        suggestion: QUARANTINE_SUGGESTIONS[reason],
      };
    }
  } else {
    // 2. 双轨分流三规则（§3.1）
    // 规则①：先查当前聊天档案书（经 gateway 守卫读书名，目标命中→聊天轨经守卫写入）
    let chatBook: string | null = null;
    try {
      const chatTxn = gateway.begin();
      chatBook = await gateway.guardedBook(chatTxn, { createIfMissing: false });
    } catch (err) {
      if (err instanceof GuardError) {
        if (err.failure.guard === 0 || err.failure.rule === 'binding-missing') {
          // 环境前置不可用（独立预览/单测未注环境）或本聊天尚无档案书，跳过聊天轨进入全局轨
          chatBook = null;
        } else {
          // 守卫①（chat-id-drift）或守卫③（book-missing 孤儿绑定）
          // 聊天身份漂移或绑定损坏，fail-closed 绝不降级写全局书！
          throw err;
        }
      }
    }

    if (chatBook && updateWb) {
      let targetFoundInChat = false;
      let chatResult: PatchResult | null = null;
      await updateWb(chatBook, entries => {
        const found = findTargetEntry(entries, patch.target);
        if (found.entry && !found.error) {
          targetFoundInChat = true;
          const res = applyDataPatchToEntries(entries, patch);
          chatResult = res;
          return res.success && !options?.dryRun ? entries : entries;
        }
        // 未进入聊天轨（路由不变，继续查全局书），但保留原因供规则③聚合
        misses.push({
          reason: found.reason ?? 'not-found',
          book: chatBook!,
          detail: found.error || '未命中',
        });
        return entries;
      });

      if (targetFoundInChat) {
        // 目标命中当前聊天书，聊天轨落地（🔴 绝不降级写全局书；同名时聊天书条目遮蔽全局条目）
        if (chatResult && (chatResult as PatchResult).success) {
          finalReceipt = {
            patchId: patch.id,
            target: patch.target,
            worldbook: chatBook,
            action: (chatResult as PatchResult).action,
            success: true,
            diff: (chatResult as PatchResult).diff,
            beforeEntrySnapshot: (chatResult as PatchResult).beforeEntrySnapshot,
            afterEntrySnapshot: (chatResult as PatchResult).afterEntrySnapshot,
          };
        } else {
          const reason: QuarantineReason = (chatResult as PatchResult | null)?.reason ?? 'write-error';
          finalReceipt = {
            patchId: patch.id,
            target: patch.target,
            worldbook: chatBook,
            action: 'quarantined',
            success: false,
            error: (chatResult as PatchResult | null)?.error || `聊天档案书「${chatBook}」中的目标条目补丁失败`,
            diff: (chatResult as PatchResult | null)?.diff,
            quarantineReason: reason,
            suggestion: QUARANTINE_SUGGESTIONS[reason],
          };
        }
      }
    }

    // 规则②：若聊天轨未命中，后查全局设定书（现行 resolveActiveWorldbookNames 候选链行为逐字节回归）
    if (!finalReceipt) {
      const candidateBooks: string[] = [];
      const active = resolveActiveWorldbookNames();
      if (active.length > 0) {
        candidateBooks.push(...active);
      } else {
        candidateBooks.push('通用·主建筑_世界书', '通用·主建筑');
      }

      if (options?.preferTimelineOverlay === true) {
        const valRes = validatePatchPayload(patch.patch);
        if (!valRes.valid) {
          return {
            patchId: patch.id,
            target: patch.target,
            worldbook: 'TIMELINE_OVERLAY（楼层内存叠加态）',
            action: 'quarantined',
            success: false,
            error: `安全红线拦截：patch 包含禁止字段 [${valRes.violations.join(', ')}]`,
            quarantineReason: 'red-line',
            suggestion: QUARANTINE_SUGGESTIONS['red-line'],
          };
        }

        const getWb = tav<(name: string) => Promise<ThEntry[]>>('getWorldbook');
        if (getWb) {
          for (const book of candidateBooks) {
            try {
              const rawEntries = await getWb(book);
              if (Array.isArray(rawEntries)) {
                const clonedEntries = deepClone(rawEntries);
                const res = applyDataPatchToEntries(clonedEntries, patch);
                if (res.success) {
                  finalReceipt = {
                    patchId: patch.id,
                    target: patch.target,
                    worldbook: 'TIMELINE_OVERLAY（楼层内存叠加态）',
                    action: 'updated',
                    success: true,
                    diff: res.diff,
                    beforeEntrySnapshot: res.beforeEntrySnapshot,
                    afterEntrySnapshot: res.afterEntrySnapshot,
                  };
                  break;
                }
              }
            } catch {
              /* ignore read error, fallback to effectiveCatalog below */
            }
          }
        }

        if (!finalReceipt) {
          const cat = effectiveCatalogSnapshot();
          const allItems = [
            ...cat.buildings,
            ...cat.researches,
            ...cat.productions,
            ...cat.retrofits,
            ...cat.projects,
          ] as unknown as Array<Record<string, unknown>>;
          const targetCanon = canon(patch.target);
          const matchedItem = allItems.find(
            item =>
              (typeof item.name === 'string' && canon(item.name) === targetCanon) ||
              (typeof item.id === 'string' && canon(item.id) === targetCanon),
          );
          const oldData: Record<string, unknown> = matchedItem ? deepClone(matchedItem) : { id: patch.target };
          const newData = applyPatchToDataBlock(oldData, patch.patch, patch.operation);
          const diff = calculateDataDiff(oldData, newData, patch.target);
          finalReceipt = {
            patchId: patch.id,
            target: patch.target,
            worldbook: 'TIMELINE_OVERLAY（楼层内存叠加态）',
            action: 'updated',
            success: true,
            diff,
          };
        }
      } else {
        for (const book of candidateBooks) {
          let resultForBook: PatchResult | null = null;
          try {
            await updateWb!(book, entries => {
              const res = applyDataPatchToEntries(entries, patch);
              resultForBook = res;
              return res.success && !options?.dryRun ? entries : entries;
            });

            if (resultForBook && (resultForBook as PatchResult).success) {
              finalReceipt = {
                patchId: patch.id,
                target: patch.target,
                worldbook: book,
                action: (resultForBook as PatchResult).action,
                success: true,
                diff: (resultForBook as PatchResult).diff,
                beforeEntrySnapshot: (resultForBook as PatchResult).beforeEntrySnapshot,
                afterEntrySnapshot: (resultForBook as PatchResult).afterEntrySnapshot,
              };
              break;
            } else if (resultForBook) {
              const r = resultForBook as PatchResult;
              misses.push({ reason: r.reason ?? 'not-found', book, detail: r.error || '写入失败' });
            }
          } catch (err) {
            misses.push({ reason: 'write-error', book, detail: String(err) });
          }
        }

        // 规则③：两处均未落地 → quarantined 留痕，按跨书聚合后最具体的原因给出去处建议
        //   （修正：旧实现只报最后一本书的 lastError，并一律冠以「均未定位」）
        if (!finalReceipt) {
          const picked = pickQuarantineCandidate(misses);
          const desc = describeQuarantine(patch.target, candidateBooks, picked);
          return {
            patchId: patch.id,
            target: patch.target,
            worldbook: picked && picked.reason !== 'not-found' ? picked.book : candidateBooks[0] || 'unknown',
            action: 'quarantined',
            success: false,
            error: desc.message,
            quarantineReason: desc.reason,
            suggestion: desc.suggestion,
          };
        }
      }
    }
  }

  // 写入成功后触发目录热重算，界面即刻刷新
  try {
    const catalogStore = useCatalogStore();
    if (catalogStore && typeof catalogStore.refresh === 'function') {
      void catalogStore.refresh();
    }
  } catch {
    /* ignore store error */
  }

  return finalReceipt;
}

/* ═══════════════ Auto-Apply 开关偏好管理 ═══════════════ */

export const AUTO_APPLY_KEY = 'rts-data-autofiler';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function getAutoApplyPreference(customStorage?: StorageLike): boolean {
  try {
    const s = customStorage ?? (typeof localStorage !== 'undefined' ? localStorage : (globalThis as any).localStorage);
    return s ? s.getItem(AUTO_APPLY_KEY) === 'on' : false;
  } catch {
    return false;
  }
}

export function setAutoApplyPreference(enabled: boolean, customStorage?: StorageLike): void {
  try {
    const s = customStorage ?? (typeof localStorage !== 'undefined' ? localStorage : (globalThis as any).localStorage);
    s?.setItem(AUTO_APPLY_KEY, enabled ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
}
