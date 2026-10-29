/**
 * parse/eventDoor.ts —— <事件> 报文三色裁决门动词枚举、辅助取值器与协议目录查找委托（DEC-PARSE-01）
 *
 * 约束：零 IO / 零酒馆 API / 零 Vue 依赖。
 */
import {
  buildProtocolIdIndex,
  normalizeProtocolLookupKey,
  type ProtocolIndexSource as CatalogProtocolIndexSource,
} from '../engines/protocolCatalogIndex';
import type { ChainFlow } from '../core/schema';
import { toSimplified } from './t2s';
import {
  alignName,
  asArray,
  buildAlignIndex,
  canon,
  isUsable,
  toNum,
  type AlignIndex,
} from './parseCommon';

/* ════ 事件报文三色裁决门类型与常量（EVT-PARSE-01 · CTRL-EVENT-PARSE-01，真源 §2.2/§2.3；Q8/Q9） ════ */

/** 事件动词（canon 收口：§2.2 六类标准声明；「资金链受挫」为 §3.3 工况联动动词；PRT-EVT-01 扩充「协议发现」「协议实验」「协议排程」；CMD-PARSE-01 扩充「副官指派」） */
export type EventVerb =
  | '资金链建立'
  | '资金链断裂'
  | '资金链受挫'
  | '资金链恢复'
  | '资金链枯竭'
  | '势力发现'
  | '情报获取'
  | '任务接取'
  | '协议发现'
  | '协议实验'
  | '协议排程'
  | '副官指派'
  | 'MCV展开'
  | 'MCV收起'
  | '单位调配';

/** 实体类别（资金链 / 势力 / 情报 / 任务 / 协议 / 副官 / 部署 / 调配） */
export type EventEntityKind =
  | 'chain'
  | 'faction'
  | 'intel'
  | 'quest'
  | 'protocol'
  | 'adjutant'
  | 'deploy'
  | 'transfer';

/** UNIT-TRANSFER-01：单位调配事件载荷 */
export interface TransferEventDecl {
  unit: string;
  category?: string;
  qty: number;
  from_base?: string;
  to_base: string;
  duration_min: number;
  remaining_min?: number;
  method?: string;
  reason?: string;
}

/** MCV-ENGINE-01：MCV展开 / MCV收起 事件载荷 */
export interface DeployEventDecl {
  action: '展开' | '收起';
  vehicle: string;
  base: string;
  newBaseName?: string;
  location?: string;
  building?: string;
  reason?: string;
}

/** CMD-PARSE-01：副官指派事件载荷 */
export interface AdjutantEventDecl {
  role: 'faction' | 'staff';
  faction: string;
  identity: 'human' | 'mcv_girl' | 'commander_self';
  name: string;
  title: string;
  buff_preset: string;
  buff_name: string;
  upkeep_daily: number;
  penalty_preset?: string;
  penalty_name?: string;
  reason: string;
}

/** PRT-EVT-01：协议事件动作类型 */
export type ProtocolEventAction = 'discover' | 'experiment' | 'schedule';

/** PRT-EVT-01 / FIX-P0-04：协议排程标准动作 */
export type ProtocolScheduleVerb = '加入候列' | '移出候列' | '置顶' | '上移' | '下移' | '暂缓' | '恢复';

/** PRT-EVT-01：协议事件载荷（协议发现 / 协议实验 / 协议排程；解析层只构造、不扣费不掷骰，结转 settleFloor 协议结算齿轮） */
export interface ProtocolEventDecl {
  action: ProtocolEventAction;
  protocolAction: ProtocolEventAction;
  id: string;
  protocolId: string;
  name: string;
  protocolName: string;
  base: string;
  reason: string;
  source: string;
  scheduleAction?: ProtocolScheduleVerb;
  auto_queued?: boolean;
  queue_order?: number;
  hold?: boolean;
}

/** 资金链事件载荷（建立携带全额参数；断裂/受挫仅定位与叙事，额度字段填 0 占位） */
export interface ChainEventDecl {
  name: string;
  flow: ChainFlow;
  rate_daily: number;
  base_id: string;
  buildings: string[];
  reason: string;
}

/** 势力发现载荷（对齐 Faction 字段面；枚举非法值已在本门归一；键缺席时不占位——入账侧「有则更新」增量语义） */
export interface FactionEventDecl {
  name: string;
  attitude?: string;
  risk?: string;
  intel?: string;
}

/** 情报获取载荷（来源缺席按「未知来源」归一；三字段恒在——情报为 append 型入账，无更新语义） */
export interface IntelEventDecl {
  src: string;
  content: string;
  cred: string;
}

/** 任务接取载荷（详情/进度缺席不占位；入账侧对在编任务按「有则更新」增量合并） */
export interface QuestEventDecl {
  name: string;
  detail?: string;
  progress?: string;
}

/** 入库前事件声明（三色门产物；解析层只构造、不执行，结转归 EVT-SETTLE-01/EVT-PARSE-02/PRT-EVT-01 接缝） */
export interface EventDeclaration {
  verb: EventVerb;
  kind: EventEntityKind;
  chain?: ChainEventDecl;
  faction?: FactionEventDecl;
  intel?: IntelEventDecl;
  quest?: QuestEventDecl;
  protocol?: ProtocolEventDecl;
  adjutant?: AdjutantEventDecl;
  deploy?: DeployEventDecl;
  transfer?: TransferEventDecl;
  /** PRT-EVT-01：协议声明顶层便捷字段（与 protocol 子对象同源对齐，供 settleFloor 协议结算齿轮消费） */
  protocolAction?: ProtocolEventAction;
  protocolId?: string;
  protocolName?: string;
  base?: string;
  reason?: string;
  source?: string;
  scheduleAction?: ProtocolScheduleVerb;
  auto_queued?: boolean;
  queue_order?: number;
  hold?: boolean;
}

/** 🟡 黄通道条目：声明本体 + 归一化修复说明（每条一注） */
export interface YellowEventDeclaration {
  declaration: EventDeclaration;
  repairs: string[];
  align?: { from: string; to: string };
}

/** 🔴 隔离条目：原始留痕 + 拒收理由 */
export interface QuarantinedEvent {
  source: string;
  error: string;
  suggestion?: string;
}

/** 三色门产物（纯数据，零 ctx 依赖，可独立单测） */
export interface EventGateResult {
  greenEvents: EventDeclaration[];
  yellowEvents: YellowEventDeclaration[];
  quarantineEvents: QuarantinedEvent[];
  /** 本批实际进入裁决的条目数（Q9 配额跨块累计口径；超额截断不计） */
  admitted: number;
}

/** Q9：单楼事件硬配额（声明序前 5 条进入裁决，第 6 条起整项安全截断隔离） */
export const EVENT_QUOTA_PER_FLOOR = 5;

/** 收口动词表（canon 形态；繁体经 canon→简体自动归一；PRT-EVT-01 新增 协议发现 / 协议实验 / 协议排程） */
export const EVENT_VERBS: readonly EventVerb[] = [
  '资金链建立',
  '资金链断裂',
  '资金链受挫',
  '资金链恢复',
  '资金链枯竭',
  '势力发现',
  '情报获取',
  '任务接取',
  '协议发现',
  '协议实验',
  '协议排程',
  '副官指派',
  'MCV展开',
  'MCV收起',
  '单位调配',
];

/** PRT-EVT-01 / CMD-PARSE-01 / MCV-ENGINE-01 / UNIT-TRANSFER-01：事件动词容错别名映射（命中时归一为标准动词并记 softFix 黄灯留痕） */
export const EVT_PROTOCOL_VERB_ALIASES: Readonly<Record<string, EventVerb>> = {
  协议启封: '协议发现',
  协议攻关: '协议实验',
  协议推演: '协议实验',
  协议激活: '协议实验',
  协议调度: '协议排程',
  任命副官: '副官指派',
  副官任命: '副官指派',
  参谋任命: '副官指派',
  任命参谋: '副官指派',
  参谋指派: '副官指派',
  委任副官: '副官指派',
  副官调任: '副官指派',
  副官就职: '副官指派',
  副官配置: '副官指派',
  adjutant_assign: '副官指派',
  adjutant_appoint: '副官指派',
  appoint_adjutant: '副官指派',
  adjutant: '副官指派',
  mcv展开: 'MCV展开',
  基地展开: 'MCV展开',
  部署mcv: 'MCV展开',
  展开mcv: 'MCV展开',
  基地部署: 'MCV展开',
  载具展开: 'MCV展开',
  前哨展开: 'MCV展开',
  部署基地车: 'MCV展开',
  展开基地车: 'MCV展开',
  mcv收起: 'MCV收起',
  基地收起: 'MCV收起',
  收起mcv: 'MCV收起',
  转移基地: 'MCV收起',
  载具收起: 'MCV收起',
  收起基地车: 'MCV收起',
  部队调动: '单位调配',
  部队调配: '单位调配',
  驻地调动: '单位调配',
  驻地调配: '单位调配',
  驻地迁移: '单位调配',
  单位迁移: '单位调配',
  兵力调拨: '单位调配',
  兵力调配: '单位调配',
  跨基地调配: '单位调配',
  跨基地调动: '单位调配',
  机娘调防: '单位调配',
  调防: '单位调配',
  调配: '单位调配',
  调动: '单位调配',
  unit_transfer: '单位调配',
  transfer: '单位调配',
  redeploy: '单位调配',
};

export const PROTOCOL_SCHEDULE_VERB_MAP: Readonly<Record<string, ProtocolScheduleVerb>> = {
  加入候列: '加入候列',
  加入自动实验候列: '加入候列',
  入列: '加入候列',
  enqueue: '加入候列',
  移出候列: '移出候列',
  移出自动实验候列: '移出候列',
  出列: '移出候列',
  dequeue: '移出候列',
  置顶: '置顶',
  置顶候列: '置顶',
  top: '置顶',
  上移: '上移',
  上移候列顺位: '上移',
  up: '上移',
  下移: '下移',
  下移候列顺位: '下移',
  down: '下移',
  暂缓: '暂缓',
  暂缓自动实验: '暂缓',
  暂停: '暂缓',
  hold: '暂缓',
  恢复: '恢复',
  恢复自动实验: '恢复',
  继续: '恢复',
  resume: '恢复',
};

export function normalizeProtocolScheduleVerb(raw: unknown): ProtocolScheduleVerb | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const direct = PROTOCOL_SCHEDULE_VERB_MAP[trimmed] ?? PROTOCOL_SCHEDULE_VERB_MAP[trimmed.toLowerCase()];
  if (direct) return direct;
  const c = canon(trimmed);
  for (const [k, v] of Object.entries(PROTOCOL_SCHEDULE_VERB_MAP)) {
    if (canon(k) === c) return v;
  }
  return undefined;
}

export function parseOptionalBool(raw: unknown): boolean | undefined {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === '是' || s === '开启') return true;
    if (s === 'false' || s === '0' || s === '否' || s === '关闭') return false;
  }
  return undefined;
}

export const EVT_TYPE_KEYS = ['类型', '动作', 'type', 'verb', 'action'] as const;
/** Q2 越权键：事件通道内出现即整项隔离（LLM 无直接改资金总额及协议点数/定型经验/轮次写权） */
export const EVT_FORBIDDEN_KEYS = [
  'credits',
  'credit',
  '资金',
  '资金总额',
  '全局资金',
  '余额',
  'balance',
  'money',
  '货币',
  'protocol_points',
  'protocolpoints',
  '协议点',
  '协议点数',
  '协议积分',
  'exp',
  '定型经验',
  '经验',
  'attempts',
  '实验轮次',
  '实验次数',
  'points_spent',
  'credits_spent',
] as const;
/** 链条类主名（§2.2 样例用「对象」优先） */
export const EVT_CHAIN_NAME_KEYS = ['对象', '链名', '链条名', 'name'] as const;
/** PRT-EVT-01：协议类目标键（§3.6.1 样例用「对象」优先，兼容 target / 协议 / 项目 / 名称） */
export const EVT_PROTOCOL_TARGET_KEYS = [
  '对象',
  'target',
  '协议',
  '项目',
  '协议名',
  '名称',
  'name',
  'id',
  'protocol',
] as const;
/** PRT-EVT-01：协议实验基地/院所键 */
export const EVT_PROTOCOL_BASE_KEYS = ['基地', 'base', 'base_id', '基地id', '院所', '实验室'] as const;
/** 势力/任务类主名（§2.2 样例用「名称」优先） */
export const EVT_ENTITY_NAME_KEYS = ['名称', '势力名', '任务名', 'name'] as const;
export const EVT_RATE_KEYS = ['额度', '日额度', '日收益', 'rate', 'rate_daily', 'rateDaily'] as const;
export const EVT_FLOW_KEYS = ['流向', 'flow'] as const;
export const EVT_DEPS_KEYS = ['依赖', 'deps'] as const;
export const EVT_REASON_KEYS = ['理由', '原因', 'reason', '说明', '备注'] as const;
export const EVT_CYCLE_KEYS = ['周期', 'period'] as const;
export const EVT_ATTITUDE_KEYS = ['态度', 'attitude'] as const;
export const EVT_RISK_KEYS = ['风险', 'risk'] as const;
export const EVT_FACTION_INTEL_KEYS = ['情报', 'intel'] as const;
export const EVT_SRC_KEYS = ['来源', 'src', '渠道', 'source'] as const;
export const EVT_CONTENT_KEYS = ['内容', 'content'] as const;
export const EVT_CRED_KEYS = ['可信度', 'cred'] as const;
export const EVT_DETAIL_KEYS = ['详情', 'detail'] as const;
export const EVT_PROGRESS_KEYS = ['进度', 'progress'] as const;
export const EVT_DEPLOY_VEHICLE_KEYS = ['载具', 'vehicle', '目标', '对象', 'name'] as const;
export const EVT_DEPLOY_BUILDING_KEYS = ['建筑', 'building', '目标', '对象', 'name'] as const;
export const EVT_DEPLOY_BASE_KEYS = ['基地', 'base', 'base_id', '基地id'] as const;
export const EVT_DEPLOY_NEW_BASE_KEYS = ['新基地', 'new_base', 'newbase', '新建基地'] as const;
export const EVT_DEPLOY_LOCATION_KEYS = ['位置', 'location', '地点'] as const;

export const FACTION_ATTITUDES = ['敌意', '警觉', '中立', '友善', '未接触'] as const;
export const FACTION_RISKS = ['高', '中', '低', '未知'] as const;
export const INTEL_CREDS = ['高', '中', '低'] as const;
export const CHAIN_FLOWS = ['收入', '支出'] as const;

/** 隔离留痕快照（JSON 截断；非可序列化值退 String） */
export function evtSnap(source: unknown): string {
  const s = JSON.stringify(source);
  return (s === undefined ? String(source) : s).slice(0, 200);
}

/** 事件条目取值器：按 canon 别名取首个命中键并标记 consumed */
export function evtTake(source: Record<string, unknown>, consumed: Set<string>, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    const c = canon(alias);
    const key = Object.keys(source).find(k => canon(k) === c);
    if (key !== undefined) {
      consumed.add(key);
      return source[key];
    }
  }
  return undefined;
}

/** 依赖载荷双形态（§2.2 样例为单键映射列表 [{基地:…},{设施:…}]；亦容键值映射形态） */
export function evtDeps(v: unknown): { base_id: string; buildings: string[]; repairs: string[] } {
  const repairs: string[] = [];
  let base_id = '';
  const buildings: string[] = [];
  const absorb = (obj: Record<string, unknown>) => {
    const baseHit = evtTake(obj, new Set<string>(), ['基地', 'base', '基地id']);
    if (baseHit !== undefined) base_id = String(baseHit).trim();
    for (const item of asArray(evtTake(obj, new Set<string>(), ['设施', '建筑', 'buildings']) ?? []))
      buildings.push(String(item).trim());
  };
  if (isUsable(v) && !Array.isArray(v)) absorb(v as Record<string, unknown>);
  else if (Array.isArray(v) && v.every(isUsable)) for (const item of v as Record<string, unknown>[]) absorb(item);
  else if (v !== undefined) repairs.push('依赖形态非法（应为 {基地, 设施} 或其列表），已按空依赖处理');
  return { base_id, buildings: [...new Set(buildings)], repairs };
}

/** 额度归一：纯数字（容 +600/-30/带空格）直取；带文字后缀（“600点”）提取首个数字（🟡修复）；不可解析 null */
export function evtAmount(v: unknown): { value: number | null; repaired: boolean } {
  if (typeof v === 'number') return { value: Number.isFinite(v) ? v : null, repaired: false };
  const s = String(v ?? '').trim();
  if (s === '') return { value: null, repaired: false };
  const direct = toNum(s);
  if (direct !== null) return { value: direct, repaired: false };
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? { value: Number(m[0]), repaired: true } : { value: null, repaired: false };
}

/** 未识别键收集（黄通道轻瑕疵：忽略并留痕，不隔离） */
export function evtLeftoverRepairs(source: Record<string, unknown>, consumed: Set<string>): string[] {
  return Object.keys(source)
    .filter(k => !consumed.has(k))
    .map(k => `未识别键「${k}」已忽略`);
}

/** PRT-EVT-01：协议索引鸭式输入类型（与 catalogEffective.ts ProtocolIndexSource / ProtocolIdIndex 完全兼容，零循环依赖） */
export interface ProtocolEventIndexItem {
  id?: unknown;
  name?: unknown;
  aliases?: unknown;
  [key: string]: unknown;
}

export type ProtocolIndexSource =
  | {
      protocols?: readonly ProtocolEventIndexItem[] | Record<string, ProtocolEventIndexItem> | null;
      resolveProtocolIdByName?: (nameOrAliasOrId: unknown) => string | undefined;
      resolveProtocolNameById?: (idOrAliasOrName: unknown) => string | undefined;
      idToName?: Record<string, string>;
      nameToId?: Record<string, string>;
      aliasToName?: Record<string, string>;
    }
  | readonly ProtocolEventIndexItem[]
  | Record<string, ProtocolEventIndexItem>
  | null
  | undefined;

/** 委托 protocolCatalogIndex.normalizeProtocolLookupKey 并前置繁简归一 */
export function normalizeProtocolEventLookupKey(raw: string): string {
  return normalizeProtocolLookupKey(toSimplified(String(raw ?? '')));
}

/** 委托 protocolCatalogIndex.buildProtocolIdIndex 构建协议事件双向查找表（兼容繁简输入） */
export function buildProtocolLookupForEvents(source?: ProtocolIndexSource): {
  idToName: Record<string, string>;
  nameToId: Record<string, string>;
  aliasToName: Record<string, string>;
  resolveProtocolIdByName: (v: unknown) => string | undefined;
  resolveProtocolNameById: (v: unknown) => string | undefined;
} {
  if (
    source &&
    !Array.isArray(source) &&
    typeof source === 'object' &&
    typeof (source as { resolveProtocolIdByName?: unknown }).resolveProtocolIdByName === 'function' &&
    typeof (source as { resolveProtocolNameById?: unknown }).resolveProtocolNameById === 'function'
  ) {
    const idx = source as {
      idToName?: Record<string, string>;
      nameToId?: Record<string, string>;
      aliasToName?: Record<string, string>;
      resolveProtocolIdByName: (v: unknown) => string | undefined;
      resolveProtocolNameById: (v: unknown) => string | undefined;
    };
    return {
      idToName: idx.idToName ?? {},
      nameToId: idx.nameToId ?? {},
      aliasToName: idx.aliasToName ?? {},
      resolveProtocolIdByName: idx.resolveProtocolIdByName,
      resolveProtocolNameById: idx.resolveProtocolNameById,
    };
  }

  const baseIdx = buildProtocolIdIndex(source as CatalogProtocolIndexSource);

  const resolveProtocolIdByName = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    const direct = baseIdx.resolveProtocolIdByName(trimmed);
    if (direct !== undefined) return direct;
    const simplified = toSimplified(trimmed);
    if (simplified !== trimmed) {
      const hitSimplified = baseIdx.resolveProtocolIdByName(simplified);
      if (hitSimplified !== undefined) return hitSimplified;
    }
    const norm = normalizeProtocolEventLookupKey(trimmed);
    return norm ? baseIdx.resolveProtocolIdByName(norm) : undefined;
  };

  const resolveProtocolNameById = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    const direct = baseIdx.resolveProtocolNameById(trimmed);
    if (direct !== undefined) return direct;
    const simplified = toSimplified(trimmed);
    if (simplified !== trimmed) {
      const hitSimplified = baseIdx.resolveProtocolNameById(simplified);
      if (hitSimplified !== undefined) return hitSimplified;
    }
    const norm = normalizeProtocolEventLookupKey(trimmed);
    return norm ? baseIdx.resolveProtocolNameById(norm) : undefined;
  };

  return {
    idToName: baseIdx.idToName,
    nameToId: baseIdx.nameToId,
    aliasToName: baseIdx.aliasToName,
    resolveProtocolIdByName,
    resolveProtocolNameById,
  };
}

/** PRT-EVT-01：协议事件目标名称/ID 对齐与校验（结合目录协议索引、18 条 LEGACY_PROTOCOL_DEFINITIONS 与 alignName） */
export function resolveProtocolEventTarget(
  rawTarget: string,
  opts: { catalog?: ProtocolIndexSource; align?: AlignIndex },
): { ok: true; protocolId: string; protocolName: string; aligned: boolean } | { ok: false; error: string } {
  const trimmed = rawTarget.trim();
  const protocolIndex = buildProtocolLookupForEvents(opts.catalog);

  // 1. 精确命中权威协议名（零修复绿灯）
  if (Object.prototype.hasOwnProperty.call(protocolIndex.nameToId, trimmed)) {
    const id = protocolIndex.nameToId[trimmed];
    return { ok: true, protocolId: id, protocolName: trimmed, aligned: false };
  }

  // 2. 若注入了外部 authority AlignIndex，优先尝试 alignName 映射后再查协议索引
  if (opts.align) {
    const authHit = alignName(trimmed, opts.align);
    if (authHit.hit !== 'miss') {
      const idByAuth = protocolIndex.resolveProtocolIdByName(authHit.name);
      if (idByAuth) {
        const canonicalName = protocolIndex.resolveProtocolNameById(idByAuth) ?? authHit.name;
        return {
          ok: true,
          protocolId: idByAuth,
          protocolName: canonicalName,
          aligned: trimmed !== canonicalName,
        };
      }
    }
  }

  // 3. 通过 catalogEffective 协议索引（含 18 条 LEGACY 协议、别名词典、半全角破折号/斜杠/书名号/序号前缀归一化）解析
  const directId = protocolIndex.resolveProtocolIdByName(trimmed);
  if (directId) {
    const canonicalName = protocolIndex.resolveProtocolNameById(directId) ?? trimmed;
    return {
      ok: true,
      protocolId: directId,
      protocolName: canonicalName,
      aligned: trimmed !== canonicalName,
    };
  }

  // 4. 通过协议专属 AlignIndex（canon / alias / fuzzy 唯一包含或编辑距离≤2）容错对齐
  const protoAlign = buildAlignIndex({
    names: Object.values(protocolIndex.idToName),
    aliases: protocolIndex.aliasToName,
  });
  const fuzzyHit = alignName(trimmed, protoAlign);
  if (fuzzyHit.hit !== 'miss') {
    const fuzzyId = protocolIndex.resolveProtocolIdByName(fuzzyHit.name);
    if (fuzzyId) {
      const canonicalName = protocolIndex.resolveProtocolNameById(fuzzyId) ?? fuzzyHit.name;
      return {
        ok: true,
        protocolId: fuzzyId,
        protocolName: canonicalName,
        aligned: trimmed !== canonicalName,
      };
    }
  }

  return {
    ok: false,
    error: `未知协议「${trimmed}」：未命中权威协议目录或 18 条存量协议定义`,
  };
}
