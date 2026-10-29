import YAML from 'yaml';
import {
  extractConceptCanonicalStem,
  extractCoreStem,
  resolveSystemEntityName,
  type EntityCredibilityIndex,
} from '../core/entityCredibility';
import { parseRelativeBuildingCoord } from '../engines/buildingCoordEngine';

export type PlanningMode = 'advisory' | 'delegate_once';
export type PlanningActionOp = 'enqueue' | 'promote' | 'demote' | 'hold' | 'resume';
export type PlanningActionKind = '生产' | '建造' | '研究';

export interface PlanningActionItem {
  op: PlanningActionOp;
  base_ref?: string;
  catalog_ref?: string; // enqueue 必填
  task_ref?: string;    // promote/demote/hold/resume 必填（若只填了 catalog_ref 也可兼容归一到 task_ref）
  quantity: number;     // 默认 1，仅正整数 1..999
  kind?: PlanningActionKind;
  /** FD-38：建造立项时可选携带相对 MCV 坐标、方位描述与空间层级 */
  coord?: { x: number; y: number };
  bearing?: string;
  layer?: string;
}

export interface ParsedPlanningIntent {
  version: 1;
  request_ref: string;
  snapshot_ref?: string;
  mode: PlanningMode;
  budget_cap_credits?: number;
  protected_task_refs?: string[];
  actions: PlanningActionItem[];
  reason?: string;
  fingerprint: string;
  conflict_with_legacy_queue?: boolean;
  raw: string;
}

export interface PlanningQuarantineItem {
  scope: 'block' | 'item' | 'field';
  tag?: string;
  path?: string;
  raw: string;
  error: string;
  suggestion?: string;
}

export type PlanningAlignInput =
  | ((name: string) => string)
  | { align?: (name: string) => string; resolve?: (name: string) => string; [k: string]: unknown }
  | EntityCredibilityIndex
  | undefined;

export interface ExtractPlanningOptions {
  align?: PlanningAlignInput;
  legacyQueueItems?: ReadonlyArray<{ item?: string; base?: string; [k: string]: unknown }>;
  legacyOrders?: ReadonlyArray<{ target?: string; base?: string }>;
}

export interface ExtractPlanningResult {
  intent: ParsedPlanningIntent | null;
  quarantine: PlanningQuarantineItem[];
}

/** 越权写账红线字段集（全部小写） */
const FORBIDDEN_LEDGER_KEYS = new Set<string>([
  'spent_minutes',
  '已耗时',
  'total_minutes',
  '总耗时',
  'status',
  '状态',
  'done',
  'qty_done',
  'credits',
  '资金',
  '余额',
  'approved',
  '已批准',
]);

/** 模式同义词映射（全部小写） */
const MODE_MAP: Record<string, PlanningMode> = {
  advisory: 'advisory',
  建议: 'advisory',
  参谋建议: 'advisory',
  待批准: 'advisory',
  待审: 'advisory',
  delegate_once: 'delegate_once',
  委托: 'delegate_once',
  单次委托: 'delegate_once',
  已批准: 'delegate_once',
  批准: 'delegate_once',
  生效: 'delegate_once',
  执行: 'delegate_once',
  执行中: 'delegate_once',
  进行中: 'delegate_once',
  已立项: 'delegate_once',
  生产中: 'delegate_once',
  建造中: 'delegate_once',
  研发中: 'delegate_once',
  排产: 'delegate_once',
  立项: 'delegate_once',
  正式下达: 'delegate_once',
  approved: 'delegate_once',
};

/** 动作动词同义词映射（全部小写） */
const OP_MAP: Record<string, PlanningActionOp> = {
  enqueue: 'enqueue',
  入队: 'enqueue',
  排产: 'enqueue',
  立项: 'enqueue',
  生产: 'enqueue',
  建造: 'enqueue',
  研究: 'enqueue',
  科研: 'enqueue',
  研发: 'enqueue',
  科技: 'enqueue',
  research: 'enqueue',
  promote: 'promote',
  置顶: 'promote',
  加急: 'promote',
  demote: 'demote',
  后置: 'demote',
  降级: 'demote',
  hold: 'hold',
  暂缓: 'hold',
  挂起: 'hold',
  暂停: 'hold',
  resume: 'resume',
  恢复: 'resume',
  继续: 'resume',
};

/** 归一化排产动作类别（支持 生产 / 建造 / 研究 及其常见同义词） */
export function normalizeActionKind(raw: unknown): PlanningActionKind | undefined {
  if (raw == null) return undefined;
  const token = String(raw).trim().toLowerCase();
  if (!token) return undefined;
  if (
    token === '生产' ||
    token === '制造' ||
    token === '训练' ||
    token === 'produce' ||
    token === 'production'
  ) {
    return '生产';
  }
  if (
    token === '建造' ||
    token === '建厂' ||
    token === '扩建' ||
    token === '建筑' ||
    token === '基建' ||
    token === 'build' ||
    token === 'building'
  ) {
    return '建造';
  }
  if (
    token === '研究' ||
    token === '科研' ||
    token === '研发' ||
    token === '科技' ||
    token === 'research' ||
    token === 'tech'
  ) {
    return '研究';
  }
  return undefined;
}

/** 剥除首尾及散落代码围栏 */
function stripCodeFences(raw: string): string {
  return raw
    .replace(/^\s*```[^\r\n]*\r?\n?/, '')
    .replace(/\r?\n?\s*```\s*$/, '')
    .replace(/^\s*```[^\r\n]*$/gm, '')
    .trim();
}

/** 规范化引用键（去空白 + 小写） */
function normalizeToken(val: unknown): string {
  if (val == null) return '';
  return String(val).replace(/\s+/g, '').toLowerCase();
}

/** 32-bit FNV-1a 哈希转 8 位 16 进制 */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 计算排产意图确定性幂等指纹（规范化 mode、budget_cap_credits 与 actions）
 */
export function computePlanFingerprint(intent: {
  mode: PlanningMode;
  budget_cap_credits?: number;
  actions: readonly PlanningActionItem[];
}): string {
  const modeNorm = normalizeToken(MODE_MAP[normalizeToken(intent.mode)] ?? intent.mode);
  const budgetNorm =
    intent.budget_cap_credits != null && Number.isFinite(intent.budget_cap_credits)
      ? String(Math.trunc(intent.budget_cap_credits))
      : '';

  const actionsNorm = intent.actions
    .map(a => {
      const opNorm = normalizeToken(OP_MAP[normalizeToken(a.op)] ?? a.op);
      const baseNorm = normalizeToken(a.base_ref);
      const catalogNorm = opNorm === 'enqueue' ? normalizeToken(a.catalog_ref ?? a.task_ref) : '';
      const taskNorm = opNorm !== 'enqueue' ? normalizeToken(a.task_ref ?? a.catalog_ref) : '';
      const qtyNorm = String(a.quantity ?? 1);
      const kindNorm = normalizeToken(normalizeActionKind(a.kind) ?? a.kind);
      return `${opNorm}:${baseNorm}:${catalogNorm}:${taskNorm}:${qtyNorm}:${kindNorm}`;
    })
    .join('|');

  const payload = `v1|mode=${modeNorm}|budget=${budgetNorm}|actions=${actionsNorm}`;
  return `plan_${fnv1aHex(payload)}`;
}

/** 解析对齐函数（兼容函数、AlignIndex 对象或 EntityCredibilityIndex） */
function toAlignFn(alignInput: PlanningAlignInput): (name: string) => string {
  if (typeof alignInput === 'function') {
    return (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return '';
      try {
        return alignInput(trimmed) || trimmed;
      } catch {
        return trimmed;
      }
    };
  }
  if (alignInput && typeof alignInput === 'object') {
    const obj = alignInput as Record<string, unknown>;
    const fn =
      typeof obj.align === 'function'
        ? (obj.align as (name: string) => string).bind(alignInput)
        : typeof obj.resolve === 'function'
          ? (obj.resolve as (name: string) => string).bind(alignInput)
          : null;
    if (fn) {
      return (name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return '';
        try {
          return fn(trimmed) || trimmed;
        } catch {
          return trimmed;
        }
      };
    }
    if (Array.isArray(obj.records) && obj.byDomain && typeof obj.byDomain === 'object') {
      const credIdx = alignInput as EntityCredibilityIndex;
      return (name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return '';
        return resolveSystemEntityName(credIdx, trimmed, 'any') ?? trimmed;
      };
    }
  }
  return (name: string) => name.trim();
}

/** 从对象中按候选键名（大小写不敏感，并兼容全半角括号带注键名如「基地（目标基地）」）读取首个非 undefined 值 */
function pickField(obj: Record<string, unknown>, candidates: readonly string[]): unknown {
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined) {
      return obj[key];
    }
  }
  const lowerMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      const trimmed = k.trim().toLowerCase();
      lowerMap.set(trimmed, v);
      const strippedParen = trimmed.replace(/\s*[（(][^）)]*[）)]\s*$/g, '').trim();
      if (strippedParen && !lowerMap.has(strippedParen)) {
        lowerMap.set(strippedParen, v);
      }
    }
  }
  for (const key of candidates) {
    const hit = lowerMap.get(key.toLowerCase());
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** 检查对象是否包含越权写账字段，返回命中的原始键名列表 */
function findForbiddenLedgerKeys(obj: Record<string, unknown>): string[] {
  const hits: string[] = [];
  for (const key of Object.keys(obj)) {
    const norm = key.trim().toLowerCase();
    if (!FORBIDDEN_LEDGER_KEYS.has(norm)) continue;
    // 特例容错：LLM 在战报 <排产计划> 中常附带描述性状态（如「状态: 建造中 / 候列中 / 排产中 / 进行中」），
    // 仅当试图越权伪造完工态（如「已完成 / 完成 / done / completed」）时才作为越权写账拦截。
    if (norm === '状态' || norm === 'status') {
      const valStr = String(obj[key] ?? '').trim().toLowerCase();
      const isForgedDone =
        valStr === '已完成' ||
        valStr === '完成' ||
        valStr === '已完工' ||
        valStr === '完工' ||
        valStr === 'done' ||
        valStr === 'completed' ||
        valStr === 'finished';
      if (!isForgedDone) {
        continue;
      }
    }
    hits.push(key);
  }
  return hits;
}

/** 校验并解析正整数数量（1..999） */
function parsePositiveIntQuantity(rawQty: unknown): number | null {
  if (rawQty === undefined) return 1;
  if (typeof rawQty === 'boolean' || rawQty === null || typeof rawQty === 'object') return null;
  if (typeof rawQty === 'number') {
    if (!Number.isInteger(rawQty) || rawQty < 1 || rawQty > 999) return null;
    return rawQty;
  }
  if (typeof rawQty === 'string') {
    const trimmed = rawQty.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (!Number.isInteger(num) || num < 1 || num > 999) return null;
    return num;
  }
  return null;
}

/**
 * 解析 <排产计划> 内部文本（支持 JSON / YAML、中英文键名归一、越权写账拦截與幂等指纹）
 */
export function extractPlanningIntent(
  inner: string,
  options?: ExtractPlanningOptions
): ExtractPlanningResult {
  const quarantine: PlanningQuarantineItem[] = [];
  const rawTrimmed = (inner ?? '').trim();
  const stripped = stripCodeFences(rawTrimmed);

  if (!stripped) {
    quarantine.push({
      scope: 'block',
      tag: '排产计划',
      raw: rawTrimmed.slice(0, 200),
      error: '<排产计划> 内容为空',
    });
    return { intent: null, quarantine };
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(stripped);
  } catch {
    try {
      parsedUnknown = YAML.parse(stripped);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      quarantine.push({
        scope: 'block',
        tag: '排产计划',
        raw: stripped.slice(0, 200),
        error: `<排产计划> JSON/YAML 解析失败：${msg}`,
      });
      return { intent: null, quarantine };
    }
  }

  if (
    Array.isArray(parsedUnknown) &&
    parsedUnknown.length > 0 &&
    parsedUnknown.every(item => item && typeof item === 'object' && !Array.isArray(item))
  ) {
    parsedUnknown = { mode: 'delegate_once', actions: parsedUnknown };
  }

  if (!parsedUnknown || typeof parsedUnknown !== 'object' || Array.isArray(parsedUnknown)) {
    quarantine.push({
      scope: 'block',
      tag: '排产计划',
      raw: stripped.slice(0, 200),
      error: '<排产计划> 顶层结构必须为键值对象',
    });
    return { intent: null, quarantine };
  }

  const rootObj = parsedUnknown as Record<string, unknown>;
  const align = toAlignFn(options?.align);

  // 1. 顶层越权写账字段拦截
  const rootForbidden = findForbiddenLedgerKeys(rootObj);
  if (rootForbidden.length > 0) {
    for (const badKey of rootForbidden) {
      quarantine.push({
        scope: 'field',
        tag: '排产计划',
        path: badKey,
        raw: JSON.stringify({ [badKey]: rootObj[badKey] }).slice(0, 200),
        error: `<排产计划> 越权写账拦截：禁止在排产计划顶层直接修改或声明账本字段 "${badKey}"`,
      });
    }
  }

  // 2. 解析 mode（兼容 批准状态 / 审批状态 / 状态）
  const rawMode =
    pickField(rootObj, ['mode', '模式']) ??
    pickField(rootObj, ['批准状态', '审批状态', 'approval_status', '状态', 'status']);
  let mode: PlanningMode = 'advisory';
  if (rawMode !== undefined && rawMode !== null && String(rawMode).trim() !== '') {
    const modeKey = String(rawMode).trim().toLowerCase();
    const mappedMode = MODE_MAP[modeKey];
    if (mappedMode) {
      mode = mappedMode;
    } else if (pickField(rootObj, ['mode', '模式']) !== undefined) {
      quarantine.push({
        scope: 'field',
        tag: '排产计划',
        path: 'mode',
        raw: String(rawMode).slice(0, 100),
        error: `<排产计划> 未知模式 "${String(rawMode)}"，已回退为 advisory`,
      });
      mode = 'advisory';
    }
  }

  // 3. 解析 budget_cap_credits
  const rawBudget = pickField(rootObj, ['budget_cap_credits', '预算上限', '预算']);
  let budgetCapCredits: number | undefined;
  if (rawBudget !== undefined && rawBudget !== null && String(rawBudget).trim() !== '') {
    const numBudget = typeof rawBudget === 'number' ? rawBudget : Number(String(rawBudget).trim());
    if (Number.isFinite(numBudget) && numBudget >= 0) {
      budgetCapCredits = numBudget;
    } else {
      quarantine.push({
        scope: 'field',
        tag: '排产计划',
        path: 'budget_cap_credits',
        raw: String(rawBudget).slice(0, 100),
        error: `<排产计划> 预算上限必须为非负数值，收到 "${String(rawBudget)}"`,
      });
    }
  }

  // 4. 解析 protected_task_refs
  const rawProtected = pickField(rootObj, ['protected_task_refs', '保护任务']);
  let protectedTaskRefs: string[] | undefined;
  if (Array.isArray(rawProtected)) {
    const list = rawProtected
      .map(item => (item == null ? '' : align(String(item))))
      .filter(Boolean);
    if (list.length > 0) protectedTaskRefs = list;
  } else if (typeof rawProtected === 'string' && rawProtected.trim()) {
    const list = rawProtected
      .split(/[,，、;；]+/)
      .map(s => align(s))
      .filter(Boolean);
    if (list.length > 0) protectedTaskRefs = list;
  }

  // 5. 解析 actions 列表（兼容分域子队列：建筑队列 / 作战单位队列 / 研究队列）
  const CATALOG_FIELD_CANDIDATES = [
    'catalog_ref',
    'item',
    '项目',
    '条目',
    '名称',
    '对象',
    '单位',
    '建筑',
    '科技',
    '课题',
    'name',
    'unit',
    'building',
    'tech',
  ] as const;
  const SUB_QUEUE_GROUPS: ReadonlyArray<{ keys: readonly string[]; kind: PlanningActionKind }> = [
    {
      keys: ['建筑队列', '基建队列', '建造队列', '建筑', 'build_queue', 'building_queue', 'buildings'],
      kind: '建造',
    },
    {
      keys: [
        '作战单位队列',
        '部队队列',
        '单位队列',
        '生产队列',
        '作战单位',
        '载具队列',
        '步兵队列',
        'production_queue',
        'unit_queue',
        'units',
      ],
      kind: '生产',
    },
    {
      keys: ['研究队列', '科研队列', '科技队列', '研发队列', '研究', '科研', 'research_queue', 'tech_queue'],
      kind: '研究',
    },
    {
      keys: ['工程队列', '改装队列', 'engineering_queue'],
      kind: '建造',
    },
  ];

  const rawActionsField = pickField(rootObj, ['actions', '动作', '动作列表', '计划', '计划列表']);
  let rawActionList: unknown[] = [];
  let hasSubQueueField = false;

  if (Array.isArray(rawActionsField)) {
    rawActionList = rawActionsField;
  } else if (rawActionsField !== undefined) {
    quarantine.push({
      scope: 'field',
      tag: '排产计划',
      path: 'actions',
      raw: JSON.stringify(rawActionsField).slice(0, 200),
      error: '<排产计划> actions/动作/计划 字段必须为数组',
    });
    return { intent: null, quarantine };
  } else {
    for (const group of SUB_QUEUE_GROUPS) {
      const subVal = pickField(rootObj, group.keys);
      if (subVal === undefined || subVal === null) continue;
      hasSubQueueField = true;
      const items = Array.isArray(subVal) ? subVal : [subVal];
      for (const entry of items) {
        if (typeof entry === 'string' && entry.trim()) {
          rawActionList.push({ op: 'enqueue', catalog_ref: entry.trim(), kind: group.kind, quantity: 1 });
        } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          const entryObj = entry as Record<string, unknown>;
          const existingKind = pickField(entryObj, ['kind', '类型', '类别']);
          rawActionList.push(existingKind !== undefined ? entryObj : { ...entryObj, kind: group.kind });
        }
      }
    }

    if (!hasSubQueueField) {
      if (
        pickField(rootObj, ['op', '操作', '动作']) !== undefined ||
        pickField(rootObj, ['kind', '类型', '类别']) !== undefined ||
        pickField(rootObj, CATALOG_FIELD_CANDIDATES) !== undefined
      ) {
        // 兼容单条动作平铺简写
        rawActionList = [rootObj];
      } else {
        if (rootForbidden.length === 0) {
          quarantine.push({
            scope: 'block',
            tag: '排产计划',
            raw: stripped.slice(0, 200),
            error: '<排产计划> 缺少有效的 actions / 动作 / 计划 数组',
          });
        }
        return { intent: null, quarantine };
      }
    }
  }

  const validActions: PlanningActionItem[] = [];

  for (let i = 0; i < rawActionList.length; i++) {
    const rawItem = rawActionList[i];
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      quarantine.push({
        scope: 'field',
        tag: '排产计划',
        path: `actions[${i}]`,
        raw: JSON.stringify(rawItem).slice(0, 200),
        error: `<排产计划> 动作项 [${i}] 必须为对象`,
      });
      continue;
    }

    const itemObj = rawItem as Record<string, unknown>;

    // 5.1 动作级越权写账字段红线拦截
    const itemForbidden = findForbiddenLedgerKeys(itemObj);
    if (itemForbidden.length > 0) {
      quarantine.push({
        scope: 'field',
        tag: '排产计划',
        path: `actions[${i}].${itemForbidden[0]}`,
        raw: JSON.stringify(itemObj).slice(0, 200),
        error: `<排产计划> 越权写账拦截：动作项 [${i}] 含禁止字段 "${itemForbidden.join(', ')}"`,
      });
      continue;
    }

    // 5.2 动词与类别解析与校验
    const rawOp = pickField(itemObj, ['op', '操作', '动作']);
    const rawOpStr = rawOp == null ? '' : String(rawOp).trim();
    const rawKind = pickField(itemObj, ['kind', '类型', '类别']);
    const inferredFieldKind: PlanningActionKind | undefined =
      pickField(itemObj, ['单位', 'unit']) !== undefined
        ? '生产'
        : pickField(itemObj, ['建筑', 'building']) !== undefined
          ? '建造'
          : pickField(itemObj, ['科技', '课题', 'tech']) !== undefined
            ? '研究'
            : undefined;
    const kind = normalizeActionKind(rawKind) ?? normalizeActionKind(rawOpStr) ?? inferredFieldKind;
    const hasCatalogField = pickField(itemObj, CATALOG_FIELD_CANDIDATES) !== undefined;
    const mappedOp =
      OP_MAP[rawOpStr.toLowerCase()] ??
      (rawOpStr === '' && (kind !== undefined || hasCatalogField) ? 'enqueue' : undefined);
    if (!mappedOp) {
      quarantine.push({
        scope: 'field',
        tag: '排产计划',
        path: `actions[${i}].op`,
        raw: JSON.stringify(itemObj).slice(0, 200),
        error: `<排产计划> 非法或未知的动作动词 "${rawOpStr}"`,
      });
      continue;
    }

    // 5.3 数量校验（1..999 正整数；enqueue 未写数量时默认补 1）
    const rawQty = pickField(itemObj, ['quantity', 'qty', 'count', '数量']);
    const effectiveRawQty =
      mappedOp === 'enqueue' &&
      (rawQty === undefined || rawQty === null || (typeof rawQty === 'string' && !rawQty.trim()))
        ? 1
        : rawQty;
    const parsedQty = parsePositiveIntQuantity(effectiveRawQty);
    if (parsedQty === null) {
      quarantine.push({
        scope: 'field',
        tag: '排产计划',
        path: `actions[${i}].quantity`,
        raw: JSON.stringify(itemObj).slice(0, 200),
        error: `<排产计划> 非法数量 "${String(rawQty)}"：必须为 1..999 的正整数`,
      });
      continue;
    }

    // 5.4 引用字段提取与对齐
    const rawBase = pickField(itemObj, ['base_ref', 'base', '基地', '所属基地', '归属基地']);
    const rawCatalog = pickField(itemObj, CATALOG_FIELD_CANDIDATES);
    const rawTask = pickField(itemObj, ['task_ref', 'target', '任务', '目标']);

    const baseRef =
      rawBase != null && String(rawBase).trim() !== '' ? align(String(rawBase)) : undefined;
    const catalogRef =
      rawCatalog != null && String(rawCatalog).trim() !== ''
        ? align(String(rawCatalog))
        : undefined;
    const taskRef =
      rawTask != null && String(rawTask).trim() !== '' ? align(String(rawTask)) : undefined;

    // 5.5 FD-38 空间锚点字段提取（坐标 / 方位 / 层级）
    const rawCoord = pickField(itemObj, ['坐标', '相对坐标', 'coord', 'xy']);
    const rawBearing = pickField(itemObj, ['方位', '相对方位', '位置', '选址方位', 'bearing']);
    const rawLayer = pickField(itemObj, ['层级', '层位', '所在层', 'layer']);
    const targetNameHint = catalogRef ?? taskRef ?? '';

    let parsedCoord: { x: number; y: number } | undefined;
    if (rawCoord !== undefined && rawCoord !== null) {
      const cRes = parseRelativeBuildingCoord(rawCoord, targetNameHint);
      if (cRes) {
        parsedCoord = cRes.coord;
      }
    }

    const parsedBearing =
      rawBearing != null && String(rawBearing).trim() !== ''
        ? String(rawBearing).trim()
        : undefined;
    if (!parsedCoord && parsedBearing) {
      const bRes = parseRelativeBuildingCoord(parsedBearing, targetNameHint);
      if (bRes) {
        parsedCoord = bRes.coord;
      }
    }

    const parsedLayer =
      rawLayer != null && String(rawLayer).trim() !== ''
        ? String(rawLayer).trim()
        : undefined;

    if (mappedOp === 'enqueue') {
      const effectiveCatalog = catalogRef ?? taskRef;
      if (!effectiveCatalog) {
        quarantine.push({
          scope: 'field',
          tag: '排产计划',
          path: `actions[${i}].catalog_ref`,
          raw: JSON.stringify(itemObj).slice(0, 200),
          error: `<排产计划> enqueue 动作缺少必填的 catalog_ref / item / 项目 / 条目`,
        });
        continue;
      }
      const actionItem: PlanningActionItem = {
        op: 'enqueue',
        catalog_ref: effectiveCatalog,
        quantity: parsedQty,
      };
      if (baseRef) actionItem.base_ref = baseRef;
      if (kind) actionItem.kind = kind;
      if (parsedCoord) actionItem.coord = parsedCoord;
      if (parsedBearing) actionItem.bearing = parsedBearing;
      if (parsedLayer) actionItem.layer = parsedLayer;
      validActions.push(actionItem);
    } else {
      const effectiveTask = taskRef ?? catalogRef;
      if (!effectiveTask) {
        quarantine.push({
          scope: 'field',
          tag: '排产计划',
          path: `actions[${i}].task_ref`,
          raw: JSON.stringify(itemObj).slice(0, 200),
          error: `<排产计划> ${mappedOp} 动作缺少必填的 task_ref / target / 任务 / 目标（或 catalog_ref）`,
        });
        continue;
      }
      const actionItem: PlanningActionItem = {
        op: mappedOp,
        task_ref: effectiveTask,
        quantity: parsedQty,
      };
      if (baseRef) actionItem.base_ref = baseRef;
      if (catalogRef && taskRef) actionItem.catalog_ref = catalogRef;
      if (kind) actionItem.kind = kind;
      if (parsedCoord) actionItem.coord = parsedCoord;
      if (parsedBearing) actionItem.bearing = parsedBearing;
      if (parsedLayer) actionItem.layer = parsedLayer;
      validActions.push(actionItem);
    }
  }

  // 若顶层存在越权写账字段或没有任何有效动作，不生成有效排产意图
  if (rootForbidden.length > 0 || validActions.length === 0) {
    return { intent: null, quarantine };
  }

  const fingerprint = computePlanFingerprint({
    mode,
    budget_cap_credits: budgetCapCredits,
    actions: validActions,
  });

  const rawReqRef = pickField(rootObj, ['request_ref', '请求号', '请求编号', 'id']);
  const requestRef =
    rawReqRef != null && String(rawReqRef).trim() !== ''
      ? String(rawReqRef).trim()
      : `req_${fingerprint.replace(/^plan_/, '')}`;

  const rawSnapshotRef = pickField(rootObj, ['snapshot_ref', '快照']);
  const snapshotRef =
    rawSnapshotRef != null && String(rawSnapshotRef).trim() !== ''
      ? String(rawSnapshotRef).trim()
      : undefined;

  const rawReason = pickField(rootObj, ['reason', '理由', '说明']);
  const reason =
    rawReason != null && String(rawReason).trim() !== '' ? String(rawReason).trim() : undefined;

  const intent: ParsedPlanningIntent = {
    version: 1,
    request_ref: requestRef,
    mode,
    actions: validActions,
    fingerprint,
    raw: rawTrimmed,
  };

  if (snapshotRef !== undefined) intent.snapshot_ref = snapshotRef;
  if (budgetCapCredits !== undefined) intent.budget_cap_credits = budgetCapCredits;
  if (protectedTaskRefs !== undefined) intent.protected_task_refs = protectedTaskRefs;
  if (reason !== undefined) intent.reason = reason;

  if (
    (options?.legacyQueueItems && options.legacyQueueItems.length > 0) ||
    (options?.legacyOrders && options.legacyOrders.length > 0)
  ) {
    if (
      detectLegacyQueueConflict(
        intent,
        (options?.legacyQueueItems ?? []) as ReadonlyArray<Record<string, unknown>>,
        options?.legacyOrders ?? []
      )
    ) {
      intent.conflict_with_legacy_queue = true;
    }
  }

  return { intent, quarantine };
}

/**
 * 检测同楼是否已通过旧 <队列> 或 orders 申报了同一项目
 */
export function detectLegacyQueueConflict(
  intent: ParsedPlanningIntent,
  dataQueues: ReadonlyArray<Record<string, unknown>>,
  orders: ReadonlyArray<{ target?: string; base?: string }>
): boolean {
  if (!intent || !Array.isArray(intent.actions) || intent.actions.length === 0) {
    return false;
  }

  const actionRefs = intent.actions
    .map(a => {
      const rawPrimary = String(a.catalog_ref ?? a.task_ref ?? '');
      return {
        name: normalizeToken(a.catalog_ref ?? a.task_ref),
        altName: normalizeToken(a.task_ref ?? a.catalog_ref),
        coreStem: extractCoreStem(rawPrimary),
        conceptStem: extractConceptCanonicalStem(rawPrimary),
        kind: a.kind,
        base: normalizeToken(a.base_ref),
      };
    })
    .filter(r => r.name !== '' || r.altName !== '');

  if (actionRefs.length === 0) return false;

  const matchesAction = (
    candidateName: string,
    candidateBase: string,
    candidateType?: string
  ): boolean => {
    const normCandidate = normalizeToken(candidateName);
    if (!normCandidate) return false;
    const normCandBase = normalizeToken(candidateBase);
    const candCoreStem = extractCoreStem(candidateName);
    const candConceptStem = extractConceptCanonicalStem(candidateName);
    const candKind = normalizeActionKind(candidateType);
    for (const ref of actionRefs) {
      const nameHit =
        normCandidate === ref.name ||
        normCandidate === ref.altName ||
        (ref.name !== '' && normCandidate.includes(ref.name)) ||
        (ref.altName !== '' && normCandidate.includes(ref.altName)) ||
        (ref.coreStem.length >= 2 && candCoreStem === ref.coreStem) ||
        (ref.conceptStem.length >= 4 && candConceptStem === ref.conceptStem);
      if (!nameHit) continue;
      const isResearch = ref.kind === '研究' || candKind === '研究';
      if (!isResearch && ref.base && normCandBase && ref.base !== normCandBase) {
        continue;
      }
      return true;
    }
    return false;
  };

  for (const q of dataQueues ?? []) {
    if (!q || typeof q !== 'object') continue;
    const rawName = pickField(q, [
      'item',
      'catalog_ref',
      'task_ref',
      'name',
      'target',
      'unit',
      '项目',
      '条目',
      '名称',
      '目标',
      '任务',
      'id',
    ]);
    const rawBase = pickField(q, ['base', 'base_ref', '基地', '归属基地', '所属基地']);
    const rawType = pickField(q, ['type', 'kind', '类型', '类别']);
    if (
      rawName != null &&
      matchesAction(
        String(rawName),
        rawBase != null ? String(rawBase) : '',
        rawType != null ? String(rawType) : undefined
      )
    ) {
      intent.conflict_with_legacy_queue = true;
      return true;
    }
  }

  for (const ord of orders ?? []) {
    if (!ord || typeof ord !== 'object') continue;
    if (ord.target && matchesAction(ord.target, ord.base ?? '')) {
      intent.conflict_with_legacy_queue = true;
      return true;
    }
  }

  return false;
}

/**
 * 从 <战况> 解析树或状态树中提取本楼显式声明的旧队列条目（供 parsePipeline 冲突检测使用）
 */
export function extractWarStatQueueItems(
  node: unknown,
  inheritedBase?: string
): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  if (!node || typeof node !== 'object') return results;

  const QUEUE_KEYS = new Set([
    '队列',
    '生产队列',
    '建造队列',
    '研究队列',
    '科研队列',
    'queue',
    'queues',
    'production_queue',
    'build_queue',
    'research_queue',
  ]);

  const collectFromQueueValue = (val: unknown, baseHint?: string) => {
    if (Array.isArray(val)) {
      for (const entry of val) {
        if (typeof entry === 'string' && entry.trim()) {
          results.push({ item: entry.trim(), ...(baseHint ? { base: baseHint } : {}) });
        } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          const obj = entry as Record<string, unknown>;
          results.push(baseHint && obj.base === undefined && obj['基地'] === undefined ? { ...obj, base: baseHint } : obj);
        }
      }
    } else if (val && typeof val === 'object') {
      for (const [subKey, subVal] of Object.entries(val as Record<string, unknown>)) {
        if (Array.isArray(subVal)) {
          collectFromQueueValue(subVal, baseHint ?? subKey);
        } else if (subVal && typeof subVal === 'object') {
          const subObj = subVal as Record<string, unknown>;
          const hasItemKey =
            pickField(subObj, ['item', 'name', '项目', '条目', '名称', 'target']) !== undefined;
          if (hasItemKey) {
            results.push(
              baseHint && subObj.base === undefined && subObj['基地'] === undefined
                ? { ...subObj, base: baseHint }
                : subObj
            );
          } else {
            collectFromQueueValue(subObj, baseHint ?? subKey);
          }
        }
      }
    }
  };

  if (Array.isArray(node)) {
    for (const child of node) {
      results.push(...extractWarStatQueueItems(child, inheritedBase));
    }
    return results;
  }

  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    const normKey = key.trim().toLowerCase();
    if (QUEUE_KEYS.has(normKey)) {
      collectFromQueueValue(value, inheritedBase);
    } else if (value && typeof value === 'object') {
      const nextBase =
        normKey === 'bases' || normKey === '基地' || normKey === '分基地' || normKey === '战区'
          ? inheritedBase
          : inheritedBase ?? key.trim();
      results.push(...extractWarStatQueueItems(value, nextBase));
    }
  }

  return results;
}
