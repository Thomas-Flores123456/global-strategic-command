/**
 * parse/parseEventsAndPatches.ts —— <数据更新> 补丁管线、<事件> 三色裁决门与协议查找、事件实体标准化入账
 *
 * 约束：零 IO / 零酒馆 API / 零 Vue 依赖。
 */
import { parseString } from '@util/common';
import {
  HUMAN_ADJUTANT_DAILY_UPKEEP,
  normalizeFactionId,
  resolveAdjutantBuffPreset,
  resolveFactionPenaltyPreset,
  resolveStarterMcvInfo,
} from '../core/commandPresets';
import {
  type ChainFlow,
  DataPatch,
  Faction,
  IntelItem,
  LEGACY_PROTOCOL_DEFINITIONS,
  resolveLegacyProtocolId,
  resolveLegacyProtocolName,
} from '../core/schema';
import { registerParsedChainEventEff } from '../engines/chainEngine';
import { deployBlockIndexFromCatalog, resolveMcvVehicleAliases } from '../engines/deploymentEngine';
import { normalizeProtocolLookupKey as sharedNormalizeProtocolLookupKey } from '../engines/protocolCatalogIndex';
import {
  normalizeBaseSiteType,
  normalizeCanonicalWeather,
  parseTimezoneOffset,
} from '../engines/timezoneWeatherEngine';
import {
  resolveDeployOrder,
  resolveExistingBaseForDeploy,
  stripBaseLocationModifier,
} from './engAndDeployOrders';
import type { RuntimeBaseLike } from '../core/catalogRuntimeContext';
import { applyQuestBlock, syncEconomyChainDailySummary } from './parseDomainAppliers';
import {
  alignName,
  applyAlign,
  asArray,
  buildAlignIndex,
  canon,
  errText,
  EVENT_QUOTA_PER_FLOOR,
  green,
  isUsable,
  keyIndex,
  preprocess,
  stripFences,
  take,
  toNum,
  yellow,
  type AdjutantEventDecl,
  type AlignIndex,
  type AuthorityInput,
  type ChainEventDecl,
  type ChainEventDeclaration,
  type ChainKindLiteral,
  type Ctx,
  type DeployDecl,
  type DeployEventDecl,
  type EventDeclaration,
  type EventGateResult,
  type EventVerb,
  type FactionEventDecl,
  type IntelEventDecl,
  type ProtocolEventAction,
  type ProtocolEventDecl,
  type ProtocolEventIndexItem,
  type ProtocolIndexSource,
  type ProtocolScheduleVerb,
  type QuarantinedEvent,
  type QuestEventDecl,
  type StatData,
  type YellowEventDeclaration,
} from './parseTypesAndCanon';
import { toSimplified } from './t2s';

export type { ChainEventDecl, ChainEventDeclaration, ChainKindLiteral };

declare module './parseTypesAndCanon' {
  interface DeployEventDecl {
    tz_offset?: number;
    weather?: string;
    site_type?: string;
    mode?: string;
  }
  interface AdjutantEventDecl {
    base?: string;
  }
  interface ChainEventDecl {
    eff?: number;
  }
}

/**
 * <数据更新> → pending_data_patches（§3.12 动态补丁管线）
 * - 精准提取 target (目标/id/name), operation (操作: patch/replace), patch (更新/update/payload), reason (理由/说明)
 * - 安全红线拦截：patch 载荷严禁包含 uid / key / keys / order / comment / content / 正文 / 自然叙述
 * - Zod 校验非法负载即刻隔离入 ctx.quarantine
 * - 有效 patch 暂存至 stat_data.pending_data_patches[]
 */
export function upsertDataPatches(arr: Record<string, unknown>[], items: unknown, ctx: Ctx): void {
  for (const rawItem of asArray(items)) {
    if (!isUsable(rawItem) || Array.isArray(rawItem)) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '数据更新',
        path: '数据更新',
        raw: JSON.stringify(rawItem),
        error: '数据更新元素非对象',
      });
      continue;
    }
    const src = rawItem as Record<string, unknown>;
    const idx = keyIndex(src);
    const consumed = new Set<string>();

    // 1. 目标（target / id / name / 目标 / 建筑 / 载具 / 实体）
    const locTarget = take(src, idx, consumed, ['目标', 'target', 'id', 'name', '建筑', '载具', '实体']);
    const rawTarget = locTarget && locTarget.value != null ? String(locTarget.value).trim() : '';
    if (!rawTarget) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '数据更新',
        path: '数据更新',
        raw: JSON.stringify(src).slice(0, 200),
        error: '缺少目标（target/目标）',
        suggestion: '补充 目标: <建筑/载具名称或ID>',
      });
      ctx.issues.push({
        rule: 'R18',
        level: 'warn',
        target: '数据更新',
        message: '数据更新缺少目标字段，已隔离',
      });
      continue;
    }
    const target = applyAlign(rawTarget, ctx, `数据更新[${rawTarget}]`, 'entity');

    // 2. 操作（operation / op / 操作），默认 'patch'
    const locOp = take(src, idx, consumed, ['操作', 'operation', 'op']);
    let operation: 'patch' | 'replace' = 'patch';
    if (locOp && locOp.value != null) {
      const opStr = String(locOp.value).trim().toLowerCase();
      if (opStr === 'replace' || opStr === '替换' || opStr === '全量替换') {
        operation = 'replace';
      } else if (opStr === 'patch' || opStr === '更新' || opStr === '合并') {
        operation = 'patch';
      } else {
        yellow(ctx, {
          layer: 'L1',
          path: `数据更新[${target}].operation`,
          message: `未识别的操作类型 "${opStr}"，自动降级为 patch`,
        });
      }
    }

    // 3. 更新载荷（patch / update / 更新 / 载荷 / payload / data / 内容）
    const locPatch = take(src, idx, consumed, ['更新', 'patch', 'update', '载荷', 'payload', 'data', '内容']);
    if (!locPatch || !locPatch.value || typeof locPatch.value !== 'object' || Array.isArray(locPatch.value)) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '数据更新',
        path: `数据更新[${target}].patch`,
        raw: JSON.stringify(src).slice(0, 200),
        error: '更新载荷（patch/更新）必须为键值映射对象',
        suggestion: '更新: 后面请提供键值映射',
      });
      ctx.issues.push({
        rule: 'R18',
        level: 'warn',
        target: `数据更新[${target}]`,
        message: '数据更新载荷非对象，已隔离',
      });
      continue;
    }
    const patchPayload = locPatch.value as Record<string, unknown>;

    // 4. 硬性安全红线检测（§3.12）：严禁注入元数据与正文自然叙述
    const FORBIDDEN_KEYS = ['uid', 'key', 'keys', 'order', 'comment', 'content', '正文', '自然叙述'];
    const violatedKeys = Object.keys(patchPayload).filter(k => FORBIDDEN_KEYS.includes(canon(k)));
    if (violatedKeys.length > 0) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '数据更新',
        path: `数据更新[${target}].patch`,
        raw: JSON.stringify(patchPayload).slice(0, 200),
        error: `安全红线拦截：patch 载荷禁止包含元数据/正文字段 [${violatedKeys.join(', ')}]`,
        suggestion: '移除元数据字段，仅修改 <数据> 块内 Schema 字段',
      });
      ctx.issues.push({
        rule: 'R18',
        level: 'error',
        target: `数据更新[${target}]`,
        message: `安全红线拦截：非法元数据字段 [${violatedKeys.join(', ')}]`,
      });
      continue;
    }

    // 5. 理由（reason / 理由 / 原因 / 说明 / desc / description）
    const locReason = take(src, idx, consumed, ['理由', 'reason', '原因', '说明', 'desc', 'description']);
    const reason = locReason && locReason.value != null ? String(locReason.value).trim() : '';

    // 6. 构造 DataPatch 候选对象并经 Zod 校验
    const candidate = {
      id: `patch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      target,
      operation,
      patch: patchPayload,
      reason,
      timestamp: Date.now(),
      status: 'pending' as const,
    };

    const parsed = DataPatch.safeParse(candidate);
    if (!parsed.success) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '数据更新',
        path: `数据更新[${target}]`,
        raw: JSON.stringify(candidate).slice(0, 200),
        error: `DataPatch 校验失败：${errText(parsed.error)}`,
      });
      continue;
    }

    // 7. 暂存与幂等去重（同 target 且同 patch 内容时幂等更新）
    const dupIndex = arr.findIndex(
      p => canon(p.target) === canon(target) && JSON.stringify(p.patch) === JSON.stringify(patchPayload),
    );
    if (dupIndex >= 0) {
      arr[dupIndex] = parsed.data as Record<string, unknown>;
      green(ctx, {
        layer: 'L2',
        path: `pending_data_patches[${target}]`,
        message: `幂等更新 <数据更新> 补丁：目标 "${target}"`,
        after: parsed.data,
      });
    } else {
      arr.push(parsed.data as Record<string, unknown>);
      ctx.appliedCount++;
      green(ctx, {
        layer: 'L2',
        path: `pending_data_patches[${target}]`,
        message: `捕获 <数据更新> 补丁：目标 "${target}"，操作 "${operation}"`,
        after: parsed.data,
      });
    }
  }
}

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
];

/** PRT-EVT-01 / CMD-PARSE-01 / MCV-ENGINE-01：事件动词容错别名映射（命中时归一为标准动词并记 softFix 黄灯留痕） */
export const EVT_PROTOCOL_VERB_ALIASES: Readonly<Record<string, EventVerb>> = {
  资金链新立: '资金链建立',
  资金链新增: '资金链建立',
  资金链开通: '资金链建立',
  资金链投产: '资金链建立',
  资金链启用: '资金链建立',
  资金链激活: '资金链建立',
  资金链生效: '资金链建立',
  开通资金链: '资金链建立',
  投产资金链: '资金链建立',
  启用资金链: '资金链建立',
  建立资金链: '资金链建立',
  新立资金链: '资金链建立',
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

const EVT_TYPE_KEYS = ['类型', '动作', '动词', '事件类型', 'type', 'verb', 'action'] as const;
/** Q2 越权键：事件通道内出现即整项隔离（LLM 无直接改资金总额及协议点数/定型经验/轮次写权） */
const EVT_FORBIDDEN_KEYS = [
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
const EVT_CHAIN_NAME_KEYS = ['对象', '链名', '链条名', '名称', 'name', 'id'] as const;
/** PRT-EVT-01：协议类目标键（§3.6.1 样例用「对象」优先，兼容 target / 协议 / 项目 / 名称） */
const EVT_PROTOCOL_TARGET_KEYS = [
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
const EVT_PROTOCOL_BASE_KEYS = ['基地', 'base', 'base_id', '基地id', '院所', '实验室'] as const;
/** PRT-EVT-01：协议声明常见叙事附加字段（仅消费消噪，不直接改写账本） */
const EVT_PROTOCOL_META_KEYS = [
  '派系',
  '阵营',
  'faction',
  '层级',
  '阶位',
  '档位',
  'tier',
  '轨道',
  'track',
  '消耗',
  '消耗协议点',
  '耗点',
  'cost',
  '结果',
  '实验结果',
  'outcome',
  'result',
  '进度',
  'progress',
  '阶段',
  '轮次',
] as const;
/** 势力/任务类主名（§2.2 样例用「名称」优先） */
const EVT_ENTITY_NAME_KEYS = ['名称', '势力名', '任务名', 'name'] as const;
const EVT_RATE_KEYS = [
  '额度',
  '日额度',
  '日额',
  '日产',
  '日产量',
  '日产出',
  '每日产出',
  '日收益',
  '日速率',
  '每日收益',
  '日净入',
  '日入',
  '产出',
  '收益',
  '金额',
  '每日额度',
  'rate',
  'rate_daily',
  'rateDaily',
  'daily_rate',
  'amount',
] as const;
const EVT_FLOW_KEYS = ['流向', 'flow'] as const;
const EVT_DEPS_KEYS = ['依赖', 'deps'] as const;
const EVT_CHAIN_BASE_KEYS = ['依赖基地', '基地', '基地id', 'base_id', 'base'] as const;
const EVT_CHAIN_BLD_KEYS = ['依赖建筑', '依赖设施', '建筑', '设施', 'buildings'] as const;
const EVT_CHAIN_KIND_KEYS = [
  '链条类型',
  '类别',
  '物理分类',
  '分类',
  'chain_kind',
  'chainKind',
  'kind',
] as const;
const EVT_CHAIN_WALLET_KEYS = [
  '外币日收支',
  '外币',
  '钱袋日收支',
  '外币收益',
  '本地外币',
  '钱袋',
  'wallet_daily',
  'walletDaily',
  'wallet',
] as const;
const EVT_CHAIN_RESOURCES_KEYS = [
  '货物日收支',
  '资源日收支',
  '物资日收支',
  '实物日收支',
  '六柱日收支',
  'resources_daily',
  'resourcesDaily',
  'resources',
] as const;
const EVT_CHAIN_VEHICLES_KEYS = [
  '依赖载具',
  '矿车',
  '依托载具',
  '载具',
  '车辆',
  'vehicles',
] as const;
const EVT_CHAIN_FACTION_KEYS = [
  '依赖势力',
  '贸易对象',
  '关联势力',
  '合作势力',
  '所属势力',
  'faction',
] as const;
const EVT_CHAIN_WORLD_RES_KEYS = [
  '依赖资源',
  '依托资源',
  '矿脉',
  '资源点',
  'world_resource',
  'worldResource',
] as const;
const EVT_CHAIN_CAPACITY_KEYS = [
  '总储量',
  '储量',
  '容量',
  '总蕴藏',
  '总额度',
  'total_yield',
  'totalYield',
  'capacity',
] as const;
const EVT_CHAIN_META_KEYS = ['状态', 'status', '效率', 'eff'] as const;
const EVT_REASON_KEYS = ['理由', '原因', 'reason', '说明', '备注', '详情', '描述', '内容', '摘要', 'detail', 'desc', 'description', 'note'] as const;
const EVT_CYCLE_KEYS = ['周期', 'period'] as const;
const EVT_ATTITUDE_KEYS = ['态度', 'attitude'] as const;
const EVT_RISK_KEYS = ['风险', 'risk'] as const;
const EVT_FACTION_INTEL_KEYS = ['情报', 'intel'] as const;
const EVT_SRC_KEYS = ['来源', 'src', '渠道', 'source'] as const;
const EVT_CONTENT_KEYS = ['内容', 'content'] as const;
const EVT_CRED_KEYS = ['可信度', 'cred'] as const;
const EVT_DETAIL_KEYS = ['详情', 'detail'] as const;
const EVT_PROGRESS_KEYS = ['进度', 'progress'] as const;

const FACTION_ATTITUDES = ['敌意', '警觉', '中立', '友善', '未接触'] as const;
const FACTION_RISKS = ['高', '中', '低', '未知'] as const;
const INTEL_CREDS = ['高', '中', '低'] as const;
const CHAIN_FLOWS = ['收入', '支出'] as const;
const CHAIN_KINDS: readonly ChainKindLiteral[] = [
  '采矿精炼',
  '废料回收',
  '油气化工',
  '本土商路',
  '工业转化',
  '后勤维护',
] as const;
const CREDITS_MINTING_BLD_RE =
  /矿石精炼厂|精炼厂|回收处理厂|回收厂|超维暗网中继站|暗网中继站|科技钻井油田|钻井油田/;
const TRADE_ROUTE_NAME_RE = /商路|贸易|走私|互市|商队/;
const MINING_HINT_RE = /采矿|精炼厂|矿脉|原矿|矿场|矿区/;

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

/** 依赖载荷双形态（§2.2 样例为单键映射列表 [{基地:…},{设施:…}]；亦容键值映射形态；FD-51 扩展载具/势力/矿脉） */
export function evtDeps(v: unknown): {
  base_id: string;
  buildings: string[];
  vehicles: string[];
  faction: string;
  world_resource: string;
  repairs: string[];
} {
  const repairs: string[] = [];
  let base_id = '';
  const buildings: string[] = [];
  const vehicles: string[] = [];
  let faction = '';
  let world_resource = '';
  const absorb = (obj: Record<string, unknown>) => {
    const baseHit = evtTake(obj, new Set<string>(), ['基地', 'base', 'base_id', '基地id']);
    if (baseHit !== undefined) base_id = String(baseHit).trim();
    for (const item of asArray(evtTake(obj, new Set<string>(), ['设施', '建筑', 'buildings']) ?? [])) {
      const s = String(item).trim();
      if (s) buildings.push(s);
    }
    for (const item of asArray(evtTake(obj, new Set<string>(), EVT_CHAIN_VEHICLES_KEYS) ?? [])) {
      const s = String(item).trim();
      if (s) vehicles.push(s);
    }
    const facHit = evtTake(obj, new Set<string>(), ['势力', ...EVT_CHAIN_FACTION_KEYS]);
    if (facHit !== undefined && String(facHit).trim()) faction = String(facHit).trim();
    const resHit = evtTake(obj, new Set<string>(), ['资源', ...EVT_CHAIN_WORLD_RES_KEYS]);
    if (resHit !== undefined && String(resHit).trim()) world_resource = String(resHit).trim();
  };
  if (isUsable(v) && !Array.isArray(v)) absorb(v as Record<string, unknown>);
  else if (Array.isArray(v) && v.every(isUsable)) for (const item of v as Record<string, unknown>[]) absorb(item);
  else if (v !== undefined) repairs.push('依赖形态非法（应为 {基地, 设施} 或其列表），已按空依赖处理');
  return {
    base_id,
    buildings: [...new Set(buildings)],
    vehicles: [...new Set(vehicles)],
    faction,
    world_resource,
    repairs,
  };
}

/** FD-51：链条物理分类归一与自动推断 */
export function normalizeChainKind(raw: unknown): ChainKindLiteral | undefined {
  if (raw === undefined || raw === null) return undefined;
  const text = String(raw).trim();
  if (!text) return undefined;
  const direct = CHAIN_KINDS.find(k => canon(k) === canon(text));
  if (direct) return direct;
  if (/商路|贸易|走私|互市|商队/.test(text)) return '本土商路';
  if (/采矿|精炼|原矿/.test(text)) return '采矿精炼';
  if (/废料|回收/.test(text)) return '废料回收';
  if (/油气|化工|油田|钻井|油井/.test(text)) return '油气化工';
  if (/工业|转化|加工/.test(text)) return '工业转化';
  if (/后勤|维护|补给/.test(text)) return '后勤维护';
  return undefined;
}

export function inferChainKind(input: {
  explicitKind?: ChainKindLiteral;
  name: string;
  buildings: readonly string[];
  vehicles?: readonly string[];
  faction?: string;
  world_resource?: string;
}): ChainKindLiteral | undefined {
  if (input.explicitKind) return input.explicitKind;
  const hasMintingBuilding = input.buildings.some(b => CREDITS_MINTING_BLD_RE.test(b));
  if (TRADE_ROUTE_NAME_RE.test(input.name) && !hasMintingBuilding) {
    return '本土商路';
  }
  const combinedText = [
    input.name,
    ...input.buildings,
    ...(input.vehicles ?? []),
    input.world_resource ?? '',
  ].join(' ');
  if (MINING_HINT_RE.test(combinedText) && !TRADE_ROUTE_NAME_RE.test(input.name)) {
    return '采矿精炼';
  }
  if (input.buildings.some(b => /回收处理厂|回收厂/.test(b))) {
    return '废料回收';
  }
  if (input.buildings.some(b => /钻井油田|油井/.test(b))) {
    return '油气化工';
  }
  if (input.faction && !hasMintingBuilding) {
    return '本土商路';
  }
  return undefined;
}

/** FD-51：解析外币日收支映射（支持键值对象或字符串简写，保留正负号） */
export function parseChainWalletDaily(raw: unknown): Record<string, number> | undefined {
  if (raw === undefined || raw === null) return undefined;
  const out: Record<string, number> = {};
  if (isUsable(raw) && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const curr = k.trim();
      if (!curr) continue;
      const amt = evtAmount(v).value;
      if (amt !== null && Number.isFinite(amt) && amt !== 0) {
        out[curr] = amt;
      }
    }
  } else if (typeof raw === 'string') {
    for (const seg of raw.split(/[,，、;；]+/)) {
      const m = seg.trim().match(/^([^:：+\-\d]+?)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)/);
      if (m) {
        const curr = m[1].trim();
        const n = Number(m[2]);
        if (curr && Number.isFinite(n) && n !== 0) out[curr] = n;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** FD-51：解析六柱战略资源货物日收支映射（支持两层 {柱名: {小类: 数量}} 或单层 {小类: 数量}，保留正负号） */
export function parseChainResourcesDaily(
  raw: unknown,
): Record<string, Record<string, number>> | undefined {
  if (!isUsable(raw) || Array.isArray(raw)) return undefined;
  const out: Record<string, Record<string, number>> = {};
  for (const [outerKey, outerVal] of Object.entries(raw as Record<string, unknown>)) {
    const pKey = outerKey.trim();
    if (!pKey) continue;
    if (isUsable(outerVal) && !Array.isArray(outerVal)) {
      for (const [subKey, subVal] of Object.entries(outerVal as Record<string, unknown>)) {
        const sKey = subKey.trim();
        if (!sKey) continue;
        const amt = evtAmount(subVal).value;
        if (amt !== null && Number.isFinite(amt) && amt !== 0) {
          (out[pKey] ??= {})[sKey] = amt;
        }
      }
    } else {
      const amt = evtAmount(outerVal).value;
      if (amt !== null && Number.isFinite(amt) && amt !== 0) {
        const fallbackPillar =
          /柴油|汽油|原油|煤油|燃油|燃料/.test(pKey)
            ? '燃油'
            : /弹药|炮弹|导弹|火药|军械/.test(pKey)
              ? '军械'
              : /净水|口粮|粮食|医药|备件|后勤/.test(pKey)
                ? '后勤'
                : /钢材|水泥|塑料|化工|建材/.test(pKey)
                  ? '建材'
                  : '矿产';
        (out[fallbackPillar] ??= {})[pKey] = amt;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
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

export function normalizeProtocolEventLookupKey(raw: string): string {
  return sharedNormalizeProtocolLookupKey(toSimplified(raw));
}

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

  const idToName: Record<string, string> = {};
  const nameToId: Record<string, string> = {};
  const aliasToName: Record<string, string> = {};
  const normalizedToId = new Map<string, string>();
  const normalizedToName = new Map<string, string>();

  const registerEntry = (id: string, name: string, aliases: readonly unknown[]) => {
    if (!id || !name) return;
    if (!(id in idToName)) idToName[id] = name;
    if (!(name in nameToId)) nameToId[name] = id;
    const normId = normalizeProtocolEventLookupKey(id);
    const normName = normalizeProtocolEventLookupKey(name);
    if (normId && !normalizedToId.has(normId)) {
      normalizedToId.set(normId, id);
      normalizedToName.set(normId, name);
    }
    if (normName && !normalizedToId.has(normName)) {
      normalizedToId.set(normName, id);
      normalizedToName.set(normName, name);
    }
    for (const rawAlias of aliases) {
      if (typeof rawAlias !== 'string') continue;
      const alias = rawAlias.trim();
      if (!alias) continue;
      if (alias !== name && !(alias in aliasToName)) {
        aliasToName[alias] = name;
      }
      const normAlias = normalizeProtocolEventLookupKey(alias);
      if (normAlias && !normalizedToId.has(normAlias)) {
        normalizedToId.set(normAlias, id);
        normalizedToName.set(normAlias, name);
      }
    }
  };

  let rawItems: ProtocolEventIndexItem[] = [];
  if (Array.isArray(source)) {
    rawItems = source;
  } else if (source && typeof source === 'object') {
    if ('protocols' in source && source.protocols) {
      rawItems = Array.isArray(source.protocols)
        ? [...source.protocols]
        : Object.values(source.protocols as Record<string, ProtocolEventIndexItem>);
    } else {
      rawItems = Object.values(source as Record<string, ProtocolEventIndexItem>);
    }
  }

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const rawName = typeof item.name === 'string' ? item.name.trim() : '';
    const rawId = typeof item.id === 'string' ? item.id.trim() : '';
    const id = rawId || resolveLegacyProtocolId(rawName) || '';
    const name = rawName || resolveLegacyProtocolName(id) || '';
    const aliases = Array.isArray(item.aliases) ? item.aliases : [];
    registerEntry(id, name, aliases);
  }

  for (const def of LEGACY_PROTOCOL_DEFINITIONS) {
    registerEntry(def.id, def.name, def.aliases);
  }

  const resolveProtocolIdByName = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    if (Object.prototype.hasOwnProperty.call(nameToId, trimmed)) return nameToId[trimmed];
    if (Object.prototype.hasOwnProperty.call(idToName, trimmed)) return trimmed;
    const norm = normalizeProtocolEventLookupKey(trimmed);
    return normalizedToId.get(norm) ?? resolveLegacyProtocolId(trimmed);
  };

  const resolveProtocolNameById = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    if (Object.prototype.hasOwnProperty.call(idToName, trimmed)) return idToName[trimmed];
    if (Object.prototype.hasOwnProperty.call(nameToId, trimmed)) return trimmed;
    const norm = normalizeProtocolEventLookupKey(trimmed);
    return normalizedToName.get(norm) ?? resolveLegacyProtocolName(trimmed);
  };

  return {
    idToName,
    nameToId,
    aliasToName,
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

/** 单条事件三色裁决（🟢零修复入库 / 🟡归一化入库 / 🔴隔离；纯函数） */
type EntryJudge =
  | { ok: true; declaration: EventDeclaration; repairs: string[]; align?: { from: string; to: string } }
  | { ok: false; error: string; suggestion?: string };

export function judgeEventEntry(entry: unknown, opts: { catalog?: ProtocolIndexSource; align?: AlignIndex } = {}): EntryJudge {
  if (!isUsable(entry) || Array.isArray(entry)) {
    return {
      ok: false,
      error: '事件条目非键值映射（应为 {类型: …} 对象）',
      suggestion: '示例：\n- 类型: 资金链建立\n  对象: 灵石走私走廊',
    };
  }
  const source = entry as Record<string, unknown>;
  const consumed = new Set<string>();

  // 🔴 越权扫描（Q2）：事件通道严禁直接改资金总额或协议点数/经验——命中即整项隔离，先于动词裁决
  const forbidden = Object.keys(source).find(k => EVT_FORBIDDEN_KEYS.some(f => canon(k) === canon(f)));
  if (forbidden !== undefined) {
    return {
      ok: false,
      error: `越权键「${forbidden}」：事件通道严禁直接写资金总额或协议点数/经验（Q2 剥权）`,
      suggestion: '资金与协议变动只能经标准事件动词声明，由引擎结算齿轮统一扣费与演算',
    };
  }

  // 动词收口（canon：容繁体/变体归一 + PRT-EVT-01 协议动词别名归一）
  const typeRaw = evtTake(source, consumed, EVT_TYPE_KEYS);
  if (typeRaw === undefined) {
    return { ok: false, error: '缺「类型」键（动词收口）', suggestion: `合法动词：${EVENT_VERBS.join(' / ')}` };
  }
  const typeText = String(typeRaw).trim();
  const directVerb = EVENT_VERBS.find(v => canon(v) === canon(typeText));
  const aliasVerbEntry =
    directVerb === undefined
      ? Object.entries(EVT_PROTOCOL_VERB_ALIASES).find(([alias]) => canon(alias) === canon(typeText))
      : undefined;
  const directScheduleFromType =
    directVerb === undefined && aliasVerbEntry === undefined ? normalizeProtocolScheduleVerb(typeText) : undefined;
  const verb: EventVerb | undefined =
    directVerb ?? aliasVerbEntry?.[1] ?? (directScheduleFromType ? '协议排程' : undefined);
  if (!verb) {
    const authorityHint = /资金|credit|余额|协议点|protocol_point/i.test(canon(typeText))
      ? '（疑似越权改资金，100% 拒收）'
      : '';
    return {
      ok: false,
      error: `未知事件动词「${typeText}」${authorityHint}`,
      suggestion: `合法动词：${EVENT_VERBS.join(' / ')}`,
    };
  }
  const repairs: string[] = [];
  if (typeText !== verb && !directScheduleFromType) repairs.push(`动词「${typeText}」已归一为「${verb}」`);

  const str = (aliases: readonly string[]): string => String(evtTake(source, consumed, aliases) ?? '').trim();

  // ── MCV展开 / MCV收起（MCV-ENGINE-01）──
  if (verb === 'MCV展开' || verb === 'MCV收起') {
    const action: '展开' | '收起' = verb === 'MCV展开' ? '展开' : '收起';
    let vehicle = '';
    let building = '';
    if (action === '展开') {
      vehicle = str(['载具', 'vehicle', '目标', '对象', 'name']) || 'MCV';
      building = str(['建筑', 'building', 'into']);
    } else {
      building = str(['建筑', 'building', '目标', '对象', 'name']) || '建造厂';
      vehicle = str(['载具', 'vehicle']);
    }
    const base = str(['基地', 'base', 'base_id', '基地id']);
    const newBaseName = str(['新基地', 'new_base', 'newbase', '新建基地']);
    const location = str(['位置', 'location', '地点']);
    const mode = str(['模式', '展开模式', '部署模式', 'mode']);
    const rawTz = evtTake(source, consumed, ['时区', '标准时差', '时差', 'tz_offset', 'timezone']);
    const rawWeather = evtTake(source, consumed, ['天气', '局部天气', '气象', '天候', 'weather']);
    const rawSite = evtTake(source, consumed, ['选址', '地形', '环境', 'site_type', 'terrain']);
    const tz_offset =
      rawTz !== undefined && String(rawTz).trim() !== '' ? parseTimezoneOffset(rawTz, false) : undefined;
    const weather =
      rawWeather !== undefined && String(rawWeather).trim() !== ''
        ? normalizeCanonicalWeather(rawWeather) || undefined
        : undefined;
    const site_type =
      rawSite !== undefined && String(rawSite).trim() !== ''
        ? normalizeBaseSiteType(rawSite) || String(rawSite).trim()
        : undefined;
    const reason = str(EVT_REASON_KEYS);
    repairs.push(...evtLeftoverRepairs(source, consumed));
    const deployPayload: DeployEventDecl = {
      action,
      vehicle,
      base,
      ...(newBaseName ? { newBaseName } : {}),
      ...(location ? { location } : {}),
      ...(building ? { building } : {}),
      ...(tz_offset !== undefined ? { tz_offset } : {}),
      ...(weather ? { weather } : {}),
      ...(site_type ? { site_type } : {}),
      ...(mode ? { mode } : {}),
      ...(reason ? { reason } : {}),
    };
    return {
      ok: true,
      declaration: {
        verb,
        kind: 'deploy',
        deploy: deployPayload,
        ...(base ? { base } : {}),
        ...(reason ? { reason } : {}),
      },
      repairs,
    };
  }

  // ── 副官指派（CMD-PARSE-01）──
  if (verb === '副官指派') {
    const FORBIDDEN_ADJUTANT_KEYS = new Set([
      'credits',
      '资金',
      '余额',
      '额度',
      'rate_daily',
      'ratedaily',
      '倍率',
      '加成比例',
      'magnitude',
      'upkeep_daily',
      'upkeepdaily',
      '日薪',
    ]);
    for (const rawKey of Object.keys(source)) {
      const kTrim = rawKey.trim();
      const kNorm = kTrim.toLowerCase().replace(/[\s_-]+/g, '');
      if (FORBIDDEN_ADJUTANT_KEYS.has(kTrim) || FORBIDDEN_ADJUTANT_KEYS.has(kNorm)) {
        return {
          ok: false,
          error: `「副官指派」含越权数值/资金篡改字段「${kTrim}」，已拦截`,
          suggestion: '副官专长倍率与日薪维持费由引擎白名单预设锁定，严禁手写资金、倍率或日薪字段',
        };
      }
    }

    const rawRole = str(['席位类型', 'role', '席位', '岗位类型', '职位类型', '岗位', '职位']);
    let role: 'faction' | 'staff' = 'faction';
    if (rawRole) {
      const rNorm = rawRole.toLowerCase();
      if (
        rNorm === 'staff' ||
        rawRole === '参谋增益' ||
        rawRole === '参谋' ||
        rawRole.includes('参谋')
      ) {
        role = 'staff';
      } else if (
        rNorm === 'faction' ||
        rawRole === '阵营主责' ||
        rawRole === '阵营' ||
        rawRole.includes('阵营') ||
        rawRole.includes('主责')
      ) {
        role = 'faction';
      } else {
        return {
          ok: false,
          error: `「副官指派」席位类型「${rawRole}」不合法`,
          suggestion: '合法席位类型：阵营主责（faction） / 参谋增益（staff）',
        };
      }
    }

    const rawFaction = str(['所属阵营', '阵营', 'faction', 'factionId', 'faction_id']);
    const rawIdentity = str(['副官身份', '身份', 'identity']);
    const rawName = str(['副官姓名', '姓名', '对象', 'name', '目标', '人选']);
    const rawTitle = str(['副官头衔', '头衔', 'title', '职务', '职衔']);
    const rawBuff = str(['专长预设', '专长', '加成预设', '加成', 'buff_preset', 'buffPreset', 'buff']);
    const rawPenalty = str(['代价预设', '磨合代价', 'penalty_preset', 'penaltyPreset', 'penalty', '代价']);
    const rawBase = str(['基地', '驻地', '所属基地', 'base', 'base_id']);
    const reason = str(EVT_REASON_KEYS);

    const starterFromGirl = resolveStarterMcvInfo(rawName);
    const normFaction = normalizeFactionId(rawFaction) || (starterFromGirl ? starterFromGirl.factionId : '');

    let identity: 'human' | 'mcv_girl' | 'commander_self' = 'human';
    if (rawIdentity) {
      const idNorm = rawIdentity.toLowerCase();
      if (idNorm === 'human' || rawIdentity === '人类' || rawIdentity.includes('人类')) {
        identity = 'human';
      } else if (
        idNorm === 'mcv_girl' ||
        idNorm === 'mcvgirl' ||
        idNorm === 'mcv' ||
        rawIdentity === 'MCV机娘' ||
        rawIdentity === '机娘' ||
        rawIdentity.includes('机娘')
      ) {
        identity = 'mcv_girl';
      } else if (
        idNorm === 'commander_self' ||
        idNorm === 'commanderself' ||
        idNorm === 'self' ||
        rawIdentity === '主指挥官兼任' ||
        rawIdentity === '主官兼任' ||
        rawIdentity === '直辖' ||
        rawIdentity.includes('兼任') ||
        rawIdentity.includes('直辖')
      ) {
        identity = 'commander_self';
      } else {
        return {
          ok: false,
          error: `「副官指派」未知副官身份「${rawIdentity}」`,
          suggestion: '合法身份：人类（human） / MCV机娘（mcv_girl） / 主指挥官兼任（commander_self）',
        };
      }
    } else if (starterFromGirl) {
      identity = 'mcv_girl';
    } else if (rawName.includes('兼任') || rawName.includes('直辖')) {
      identity = 'commander_self';
    }

    const starterInfo = starterFromGirl ?? resolveStarterMcvInfo(normFaction);
    const name =
      rawName ||
      (identity === 'commander_self'
        ? '主指挥官兼任'
        : identity === 'mcv_girl' && starterInfo
          ? starterInfo.girlName
          : '');
    if (!name) {
      return {
        ok: false,
        error: '「副官指派」缺副官姓名（副官姓名/姓名/对象）',
        suggestion: '示例：副官姓名: 喀秋莎',
      };
    }

    const title =
      rawTitle ||
      (identity === 'commander_self'
        ? '主指挥官直辖兼任'
        : identity === 'mcv_girl' && starterInfo
          ? starterInfo.girlDuty
          : role === 'staff'
            ? '随行参谋'
            : '阵营主责副官');

    let buff_preset = '';
    let buff_name = '';
    const isBuffEmptyOrNone =
      !rawBuff || rawBuff === '无' || rawBuff === '无专长' || rawBuff.toLowerCase() === 'none';

    if (!isBuffEmptyOrNone) {
      const resolvedBuff = resolveAdjutantBuffPreset(rawBuff);
      if (!resolvedBuff) {
        return {
          ok: false,
          error: `「副官指派」未知专长预设「${rawBuff}」`,
          suggestion: '请使用标准专长预设（如：重工催产督导 / 高压电网调谐 / 战区后勤精算 / 条令演训主任 / 反侦察电磁欺骗 / 机甲军械总长）',
        };
      }
      buff_preset = resolvedBuff.id;
      buff_name = resolvedBuff.name;
      if (rawBuff !== resolvedBuff.id && rawBuff !== resolvedBuff.name) {
        repairs.push(`专长预设「${rawBuff}」已归一为「${resolvedBuff.name}」（${resolvedBuff.id}）`);
      }
    } else if (identity === 'commander_self') {
      buff_preset = '';
      buff_name = '';
    } else if (identity === 'mcv_girl' && starterInfo) {
      const defaultBuff = resolveAdjutantBuffPreset(starterInfo.defaultBuffPreset);
      if (defaultBuff) {
        buff_preset = defaultBuff.id;
        buff_name = defaultBuff.name;
      }
    } else {
      return {
        ok: false,
        error: '「副官指派」缺有效专长预设（专长预设/buff_preset）',
        suggestion: '非主指挥官兼任的副官必须指定白名单专长预设',
      };
    }

    let penalty_preset: string | undefined;
    let penalty_name: string | undefined;
    if (rawPenalty && rawPenalty !== '无' && rawPenalty.toLowerCase() !== 'none') {
      const resolvedPenalty = resolveFactionPenaltyPreset(rawPenalty, normFaction);
      if (!resolvedPenalty) {
        return {
          ok: false,
          error: `「副官指派」未知磨合代价预设「${rawPenalty}」`,
          suggestion: '请使用 8 项标准阵营磨合代价预设（如：苏式电网谐振不稳 / 盟军精密洁净室维护费 等）',
        };
      }
      penalty_preset = resolvedPenalty.id;
      penalty_name = resolvedPenalty.name;
      if (
        rawPenalty !== resolvedPenalty.id &&
        rawPenalty !== resolvedPenalty.name &&
        rawPenalty !== '默认' &&
        rawPenalty.toLowerCase() !== 'default'
      ) {
        repairs.push(`代价预设「${rawPenalty}」已归一为「${resolvedPenalty.name}」（${resolvedPenalty.id}）`);
      }
    }

    const upkeep_daily = identity === 'human' ? HUMAN_ADJUTANT_DAILY_UPKEEP : 0;
    repairs.push(...evtLeftoverRepairs(source, consumed));

    const adjutantDecl: AdjutantEventDecl = {
      role,
      faction: normFaction || 'common',
      identity,
      name,
      title,
      buff_preset,
      buff_name,
      upkeep_daily,
      ...(penalty_preset !== undefined ? { penalty_preset, penalty_name } : {}),
      ...(rawBase ? { base: rawBase } : {}),
      reason,
    };

    return {
      ok: true,
      declaration: {
        verb,
        kind: 'adjutant',
        adjutant: adjutantDecl,
        reason,
      },
      repairs,
    };
  }

  // ── 协议三动词（PRT-EVT-01 / FIX-P0-04：协议发现 / 协议实验 / 协议排程）──
  if (verb === '协议发现' || verb === '协议实验' || verb === '协议排程') {
    const rawTarget = str(EVT_PROTOCOL_TARGET_KEYS);
    if (!rawTarget) {
      return {
        ok: false,
        error: `「${verb}」缺目标协议名（对象）`,
        suggestion: '示例：对象: 铁幕紧急过载协议',
      };
    }
    const resolved = resolveProtocolEventTarget(rawTarget, opts);
    if (!resolved.ok) {
      return {
        ok: false,
        error: resolved.error,
        suggestion: '请使用标准协议名称（如：铁幕紧急过载协议 / 战斗工兵—预制战斗碉堡协议）',
      };
    }
    let alignPair: { from: string; to: string } | undefined;
    if (resolved.aligned) {
      repairs.push(`协议名「${rawTarget}」已对齐为「${resolved.protocolName}」（${resolved.protocolId}）`);
      alignPair = { from: rawTarget, to: resolved.protocolName };
    }
    const base = str(EVT_PROTOCOL_BASE_KEYS);
    const reason = str(EVT_REASON_KEYS);
    const sourceText = str(EVT_SRC_KEYS);
    const rawScheduleVerb = evtTake(source, consumed, [
      '排程',
      '调度',
      '方向',
      '操作',
      '动作',
      'action',
      'schedule',
      'schedule_action',
    ]);
    const scheduleAction = normalizeProtocolScheduleVerb(rawScheduleVerb) ?? directScheduleFromType;
    const rawAutoQueued = evtTake(source, consumed, ['auto_queued', 'autoQueued', '自动排程', '自动候列']);
    const auto_queued = parseOptionalBool(rawAutoQueued);
    const rawQueueOrder = evtTake(source, consumed, ['queue_order', 'queueOrder', '顺位', '候列顺位', '排序']);
    const parsedOrder =
      rawQueueOrder !== undefined && String(rawQueueOrder).trim() !== '' ? toNum(rawQueueOrder) : null;
    const queue_order =
      parsedOrder != null && Number.isFinite(parsedOrder) && parsedOrder >= 0 ? Math.floor(parsedOrder) : undefined;
    const rawHold = evtTake(source, consumed, ['hold', '挂起']);
    const hold = parseOptionalBool(rawHold);
    if (
      verb === '协议排程' &&
      scheduleAction === undefined &&
      auto_queued === undefined &&
      queue_order === undefined &&
      hold === undefined
    ) {
      return {
        ok: false,
        error: '「协议排程」缺有效排程动作或排程字段',
        suggestion: '合法排程动作：加入候列 / 移出候列 / 置顶 / 上移 / 下移 / 暂缓 / 恢复',
      };
    }
    for (const metaKey of EVT_PROTOCOL_META_KEYS) {
      evtTake(source, consumed, [metaKey]);
    }
    repairs.push(...evtLeftoverRepairs(source, consumed));
    const protocolAction: ProtocolEventAction =
      verb === '协议发现' ? 'discover' : verb === '协议排程' ? 'schedule' : 'experiment';
    const scheduleFields = {
      ...(scheduleAction !== undefined ? { scheduleAction } : {}),
      ...(auto_queued !== undefined ? { auto_queued } : {}),
      ...(queue_order !== undefined ? { queue_order } : {}),
      ...(hold !== undefined ? { hold } : {}),
    };
    const protocolDecl: ProtocolEventDecl = {
      action: protocolAction,
      protocolAction,
      id: resolved.protocolId,
      protocolId: resolved.protocolId,
      name: resolved.protocolName,
      protocolName: resolved.protocolName,
      base,
      reason,
      source: sourceText,
      ...scheduleFields,
    };
    return {
      ok: true,
      declaration: {
        verb,
        kind: 'protocol',
        protocol: protocolDecl,
        protocolAction,
        protocolId: resolved.protocolId,
        protocolName: resolved.protocolName,
        base,
        reason,
        source: sourceText,
        ...scheduleFields,
      },
      repairs,
      ...(alignPair ? { align: alignPair } : {}),
    };
  }

  // ── 资金链五动词 ──
  if (
    verb === '资金链建立' ||
    verb === '资金链断裂' ||
    verb === '资金链受挫' ||
    verb === '资金链恢复' ||
    verb === '资金链枯竭'
  ) {
    const name = str(EVT_CHAIN_NAME_KEYS);
    if (!name) return { ok: false, error: `「${verb}」缺链条名（对象）`, suggestion: '示例：对象: 灵石走私走廊' };
    if (verb === '资金链建立') {
      const rawChainKind = evtTake(source, consumed, EVT_CHAIN_KIND_KEYS);
      const explicitKind = normalizeChainKind(rawChainKind);
      if (rawChainKind !== undefined && String(rawChainKind).trim() && !explicitKind) {
        repairs.push(`链条类型「${String(rawChainKind).trim()}」未识别，已按依赖与名称自动推断`);
      }
      const rawWalletDaily = evtTake(source, consumed, EVT_CHAIN_WALLET_KEYS);
      let walletDaily = parseChainWalletDaily(rawWalletDaily);
      const rawResourcesDaily = evtTake(source, consumed, EVT_CHAIN_RESOURCES_KEYS);
      const resourcesDaily = parseChainResourcesDaily(rawResourcesDaily);

      const rateRaw = evtTake(source, consumed, EVT_RATE_KEYS);
      const isActivationAlias = [
        '资金链开通',
        '资金链投产',
        '资金链启用',
        '资金链激活',
        '资金链生效',
        '开通资金链',
        '投产资金链',
        '启用资金链',
      ].some(a => canon(a) === canon(typeText));
      const hasMultiTrackYield = Boolean(
        (walletDaily && Object.keys(walletDaily).length > 0) ||
          (resourcesDaily && Object.keys(resourcesDaily).length > 0),
      );
      const hasOtherChainKeys = Object.keys(source).some(k => !consumed.has(k));
      let rateDaily = 0;
      if (rateRaw === undefined) {
        if (!isActivationAlias && !hasOtherChainKeys && !hasMultiTrackYield) {
          return { ok: false, error: '「资金链建立」缺「额度」（日额度，credits/日）', suggestion: '示例：额度: 600' };
        }
      } else {
        const amount = evtAmount(rateRaw);
        if (amount.value === null) return { ok: false, error: `额度「${String(rateRaw).trim()}」不可解析为数字` };
        if (amount.value < 0) return { ok: false, error: `额度「${amount.value}」为负（rate_daily ≥ 0）` };
        if (amount.repaired) repairs.push(`额度「${String(rateRaw).trim()}」归一为 ${amount.value}`);
        rateDaily = amount.value;
      }
      let flow: ChainFlow = '收入';
      const flowRaw = evtTake(source, consumed, EVT_FLOW_KEYS);
      if (flowRaw !== undefined) {
        const f = CHAIN_FLOWS.find(x => canon(x) === canon(String(flowRaw)));
        if (!f) return { ok: false, error: `流向「${String(flowRaw).trim()}」非法（仅 收入/支出）` };
        if (String(flowRaw).trim() !== f) repairs.push(`流向「${String(flowRaw).trim()}」已归一为「${f}」`);
        flow = f;
      }
      const depsRaw = evtTake(source, consumed, EVT_DEPS_KEYS);
      const deps =
        depsRaw === undefined
          ? { base_id: '', buildings: [], vehicles: [], faction: '', world_resource: '', repairs: [] }
          : evtDeps(depsRaw);
      const topBaseRaw = evtTake(source, consumed, EVT_CHAIN_BASE_KEYS);
      if (!deps.base_id && topBaseRaw !== undefined && String(topBaseRaw).trim()) {
        deps.base_id = String(topBaseRaw).trim();
      }
      const topBldsRaw = evtTake(source, consumed, EVT_CHAIN_BLD_KEYS);
      if (topBldsRaw !== undefined) {
        for (const item of asArray(topBldsRaw)) {
          const s = String(item).trim();
          if (s && !deps.buildings.includes(s)) deps.buildings.push(s);
        }
      }
      const topVehiclesRaw = evtTake(source, consumed, EVT_CHAIN_VEHICLES_KEYS);
      if (topVehiclesRaw !== undefined) {
        for (const item of asArray(topVehiclesRaw)) {
          const s = String(item).trim();
          if (s && !deps.vehicles.includes(s)) deps.vehicles.push(s);
        }
      }
      const topFactionRaw = evtTake(source, consumed, EVT_CHAIN_FACTION_KEYS);
      if (!deps.faction && topFactionRaw !== undefined && String(topFactionRaw).trim()) {
        deps.faction = String(topFactionRaw).trim();
      }
      const topWorldResRaw = evtTake(source, consumed, EVT_CHAIN_WORLD_RES_KEYS);
      if (!deps.world_resource && topWorldResRaw !== undefined && String(topWorldResRaw).trim()) {
        deps.world_resource = String(topWorldResRaw).trim();
      }
      const rawCapacity = evtTake(source, consumed, EVT_CHAIN_CAPACITY_KEYS);
      let capacityTotalYield: number | null | undefined;
      if (rawCapacity !== undefined) {
        if (isUsable(rawCapacity) && !Array.isArray(rawCapacity)) {
          const capObj = rawCapacity as Record<string, unknown>;
          const rawTotal = capObj.total_yield ?? capObj.total ?? capObj.储量 ?? capObj.总储量 ?? capObj.容量;
          const capAmt = evtAmount(rawTotal);
          if (capAmt.value !== null && capAmt.value > 0) capacityTotalYield = capAmt.value;
        } else {
          const capAmt = evtAmount(rawCapacity);
          if (capAmt.value !== null && capAmt.value > 0) capacityTotalYield = capAmt.value;
        }
      }
      for (const metaKey of EVT_CHAIN_META_KEYS) {
        evtTake(source, consumed, [metaKey]);
      }
      repairs.push(...deps.repairs);
      const cycleRaw = evtTake(source, consumed, EVT_CYCLE_KEYS);
      if (cycleRaw !== undefined && canon(String(cycleRaw)) !== '日')
        repairs.push(`周期「${String(cycleRaw).trim()}」仅支持「日」，已按日额度折算`);
      const reason = str(EVT_REASON_KEYS);

      let chainKind = inferChainKind({
        explicitKind,
        name,
        buildings: deps.buildings,
        vehicles: deps.vehicles,
        faction: deps.faction,
        world_resource: deps.world_resource,
      });

      // 🔴 商路防串轨软修正守卫（D-CHAIN-NET-02）：
      // 本土商路（显式或名称含商路/贸易/走私/互市/商队且未绑定精炼厂/回收厂/暗网中继站）若声明 rate_daily > 0 且未声明外币/货物日收支，
      // 自动将该 rate_daily 转为 wallet_daily: { 本地通用货币: rate_daily }，rate_daily 归零并记黄灯留痕
      const hasMintingBuilding = deps.buildings.some(b => CREDITS_MINTING_BLD_RE.test(b));
      const isTradeRoute =
        chainKind === '本土商路' ||
        (!chainKind && TRADE_ROUTE_NAME_RE.test(name) && !hasMintingBuilding);
      const hasWalletDaily = Boolean(walletDaily && Object.keys(walletDaily).length > 0);
      const hasResourcesDaily = Boolean(resourcesDaily && Object.keys(resourcesDaily).length > 0);
      if (isTradeRoute && !hasMintingBuilding && rateDaily > 0 && !hasWalletDaily && !hasResourcesDaily) {
        walletDaily = { 本地通用货币: rateDaily };
        rateDaily = 0;
        if (!chainKind) chainKind = '本土商路';
        repairs.push(
          `本土商路「${name}」不可直接产出系统资金 Credits，已自动转为本地外币钱袋收入`,
        );
      }

      repairs.push(...evtLeftoverRepairs(source, consumed));
      const hasExtraDeps = Boolean(
        deps.base_id ||
          deps.buildings.length > 0 ||
          deps.vehicles.length > 0 ||
          deps.faction ||
          deps.world_resource,
      );
      return {
        ok: true,
        declaration: {
          verb,
          kind: 'chain',
          chain: {
            name,
            flow,
            rate_daily: rateDaily,
            base_id: deps.base_id,
            buildings: deps.buildings,
            reason,
            ...(chainKind ? { chain_kind: chainKind } : {}),
            ...(walletDaily ? { wallet_daily: walletDaily } : {}),
            ...(resourcesDaily ? { resources_daily: resourcesDaily } : {}),
            ...(deps.vehicles.length > 0 ? { vehicles: deps.vehicles } : {}),
            ...(deps.faction ? { faction: deps.faction } : {}),
            ...(hasExtraDeps
              ? {
                  deps: {
                    ...(deps.base_id ? { base_id: deps.base_id } : {}),
                    ...(deps.buildings.length > 0 ? { buildings: deps.buildings } : {}),
                    ...(deps.vehicles.length > 0 ? { vehicles: deps.vehicles } : {}),
                    ...(deps.faction ? { faction: deps.faction } : {}),
                    ...(deps.world_resource ? { world_resource: deps.world_resource } : {}),
                  },
                }
              : {}),
            ...(capacityTotalYield !== undefined
              ? { capacity: { total_yield: capacityTotalYield, extracted: 0 } }
              : {}),
          },
        },
        repairs,
      };
    }
    // 断裂/受挫/恢复/枯竭：定位与叙事，受挫与恢复支持可选 效率/eff (0~2)
    let eff: number | undefined;
    if (verb === '资金链受挫' || verb === '资金链恢复') {
      evtTake(source, consumed, ['状态', 'status']);
      const effRaw = evtTake(source, consumed, ['效率', 'eff', '履约率', 'efficiency']);
      if (effRaw !== undefined) {
        const s = String(effRaw).trim();
        const pctMatch = s.match(/^([+-]?\d+(?:\.\d+)?)\s*%$/);
        const parsedEff = pctMatch ? Number(pctMatch[1]) / 100 : evtAmount(effRaw).value;
        if (parsedEff !== null && Number.isFinite(parsedEff) && parsedEff >= 0 && parsedEff <= 2) {
          eff = parsedEff;
        }
      }
      registerParsedChainEventEff(
        `chain_${canon(name)}`,
        verb === '资金链受挫' ? '受挫' : '恢复',
        eff,
      );
    }
    const reason = str(EVT_REASON_KEYS);
    repairs.push(...evtLeftoverRepairs(source, consumed));
    return {
      ok: true,
      declaration: {
        verb,
        kind: 'chain',
        chain: {
          name,
          flow: '收入',
          rate_daily: 0,
          base_id: '',
          buildings: [],
          reason,
          ...(eff !== undefined ? { eff } : {}),
        },
      },
      repairs,
    };
  }

  // ── 势力发现（EVT-PARSE-02：键缺席不占位，入账侧「有则更新」；非法值仍归一为兑底并留痕）──
  if (verb === '势力发现') {
    const name = str(EVT_ENTITY_NAME_KEYS);
    if (!name) return { ok: false, error: '「势力发现」缺「名称」', suggestion: '示例：名称: 极光生物科技' };
    const normEnum = (
      aliases: readonly string[],
      legal: readonly string[],
      fallback: string,
      label: string,
    ): string | undefined => {
      const raw = evtTake(source, consumed, aliases);
      if (raw === undefined) return undefined;
      const text = String(raw).trim();
      const hit = legal.find(x => canon(x) === canon(text));
      if (hit) {
        if (text !== hit) repairs.push(`${label}「${text}」已归一为「${hit}」`);
        return hit;
      }
      repairs.push(`${label}「${text}」非法，归一为「${fallback}」`);
      return fallback;
    };
    const attitude = normEnum(EVT_ATTITUDE_KEYS, FACTION_ATTITUDES, '未接触', '态度');
    const risk = normEnum(EVT_RISK_KEYS, FACTION_RISKS, '未知', '风险');
    const intelRaw = evtTake(source, consumed, EVT_FACTION_INTEL_KEYS);
    const intel = intelRaw === undefined ? undefined : String(intelRaw).trim();
    repairs.push(...evtLeftoverRepairs(source, consumed));
    return {
      ok: true,
      declaration: {
        verb,
        kind: 'faction',
        faction: {
          name,
          ...(attitude !== undefined ? { attitude } : {}),
          ...(risk !== undefined ? { risk } : {}),
          ...(intel ? { intel } : {}),
        },
      },
      repairs,
    };
  }

  // ── 情报获取 ──
  if (verb === '情报获取') {
    const explicitContent = str(EVT_CONTENT_KEYS);
    const targetText = str(['目标', '对象', 'target', '主题', '标题']);
    const fallbackDesc = str([
      '摘要',
      '详情',
      '描述',
      '情报',
      '原因',
      '理由',
      '说明',
      'detail',
      'summary',
      'description',
      'reason',
    ]);
    const content =
      explicitContent ||
      (targetText && fallbackDesc ? `${targetText}：${fallbackDesc}` : fallbackDesc || targetText);
    if (!content) return { ok: false, error: '「情报获取」缺「内容」', suggestion: '示例：内容: 敌方将于三日后空袭' };
    let src = str(EVT_SRC_KEYS);
    if (!src) {
      src = '未知来源';
      repairs.push('来源未注名，按「未知来源」折算（§2.3 黄例）');
    }
    let cred = '中';
    const credRaw =
      evtTake(source, consumed, EVT_CRED_KEYS) ??
      evtTake(source, consumed, ['价值', '等级', '级别', 'value', 'level']);
    evtTake(source, consumed, ['价值', '等级', '级别', 'value', 'level']);
    if (credRaw !== undefined) {
      const hit = INTEL_CREDS.find(x => canon(x) === canon(String(credRaw)));
      if (hit) cred = hit;
      else repairs.push(`可信度「${String(credRaw).trim()}」非法，归一为「中」`);
    }
    repairs.push(...evtLeftoverRepairs(source, consumed));
    return { ok: true, declaration: { verb, kind: 'intel', intel: { src, content, cred } }, repairs };
  }

  // ── 任务接取（EVT-PARSE-02：详情/进度缺席不占位，在编任务按「有则更新」增量合并）──
  const name = str(EVT_ENTITY_NAME_KEYS);
  if (!name) return { ok: false, error: '「任务接取」缺「名称」', suggestion: '示例：名称: 猎取高纯微晶样本' };
  const detail = str(EVT_DETAIL_KEYS);
  const progress = str(EVT_PROGRESS_KEYS);
  repairs.push(...evtLeftoverRepairs(source, consumed));
  return {
    ok: true,
    declaration: {
      verb,
      kind: 'quest',
      quest: { name, ...(detail ? { detail } : {}), ...(progress ? { progress } : {}) },
    },
    repairs,
  };
}

interface OrderedEventGateResult extends EventGateResult {
  /** 原文扫描时直接保序；绿/黄分组仅保留为裁决报告。 */
  acceptedEvents: YellowEventDeclaration[];
}

/**
 * extractEvents(text) —— <事件> 块内容 → 三色裁决（纯函数，零 ctx 依赖，可独立单测）。
 * @param text 块内原文（YAML 事件数组；容忍围栏/全角标点/中英引号，两级容错后仍失败 → 整块隔离）
 * @param opts.admitted 本楼已占配额（多 <事件> 块跨块累计；缺省 0）
 */
export function extractEvents(
  text: string,
  opts: { admitted?: number; catalog?: ProtocolIndexSource; authority?: AuthorityInput; align?: AlignIndex } = {},
): OrderedEventGateResult {
  const acceptedEvents: YellowEventDeclaration[] = [];
  const greenEvents: EventDeclaration[] = [];
  const yellowEvents: YellowEventDeclaration[] = [];
  const quarantineEvents: QuarantinedEvent[] = [];
  const used =
    typeof opts.admitted === 'number' && Number.isFinite(opts.admitted) && opts.admitted > 0 ? opts.admitted : 0;
  const effectiveAlign = opts.align ?? (opts.authority ? buildAlignIndex(opts.authority) : undefined);

  let root: unknown;
  try {
    const first = parseString(stripFences(text));
    root = Array.isArray(first) ? first : undefined; // 映射/标量形态 → 交预处理重试
  } catch {
    root = undefined;
  }
  if (root === undefined) {
    try {
      root = parseString(preprocess(text));
    } catch (e) {
      return {
        acceptedEvents,
        greenEvents,
        yellowEvents,
        quarantineEvents: [
          {
            source: text.trim().slice(0, 200),
            error: `YAML 解析失败：${errText(e)}`,
            suggestion: '示例：\n- 类型: 资金链建立\n  对象: 链条名\n  额度: 600',
          },
        ],
        admitted: 0,
      };
    }
  }
  if (!Array.isArray(root)) {
    return {
      acceptedEvents,
      greenEvents,
      yellowEvents,
      quarantineEvents: [
        {
          source: text.trim().slice(0, 200),
          error: '<事件> 期望 YAML 数组（“- 类型: …” 列表），得到非数组形态',
          suggestion: '每条事件一个 “-” 列表项',
        },
      ],
      admitted: 0,
    };
  }

  let admitted = 0;
  root.forEach((entry: unknown) => {
    // Q9 硬配额：声明序前 5 条进入裁决（跨块累计），第 6 条起安全截断
    if (used + admitted >= EVENT_QUOTA_PER_FLOOR) {
      quarantineEvents.push({
        source: evtSnap(entry),
        error: `单楼事件配额超限（Q9 上限 ${EVENT_QUOTA_PER_FLOOR} 条），超出条目安全截断`,
        suggestion: '拆楼叙事或削减事件条数',
      });
      return;
    }
    admitted += 1;
    const judge = judgeEventEntry(entry, { catalog: opts.catalog, align: effectiveAlign });
    if (judge.ok) {
      const accepted = {
        declaration: judge.declaration,
        repairs: judge.repairs,
        ...(judge.align ? { align: judge.align } : {}),
      };
      acceptedEvents.push(accepted);
      if (judge.repairs.length > 0) {
        yellowEvents.push(accepted);
      } else {
        greenEvents.push(judge.declaration);
      }
    } else {
      quarantineEvents.push({
        source: evtSnap(entry),
        error: judge.error,
        ...(judge.suggestion !== undefined ? { suggestion: judge.suggestion } : {}),
      });
    }
  });
  return { acceptedEvents, greenEvents, yellowEvents, quarantineEvents, admitted };
}

/** 声明主名（留痕用） */
export function eventDeclName(declaration: EventDeclaration): string {
  if (declaration.chain) return declaration.chain.name;
  if (declaration.faction) return declaration.faction.name;
  if (declaration.intel) return declaration.intel.content.slice(0, 12);
  if (declaration.protocol) return declaration.protocol.protocolName;
  if (declaration.protocolName) return declaration.protocolName;
  if (declaration.adjutant) return declaration.adjutant.name;
  if (declaration.deploy) {
    return declaration.deploy.action === '展开'
      ? declaration.deploy.vehicle || 'MCV'
      : declaration.deploy.building || '建造厂';
  }
  return declaration.quest?.name ?? '';
}

export function resolveEventDeployDeclaration(deploy: DeployEventDecl, data: StatData, ctx: Ctx): void {
  const savedIndex = ctx.deployIndex;
  if (!ctx.deployIndex) {
    ctx.deployIndex = deployBlockIndexFromCatalog({});
  }
  try {
    let base = deploy.base?.trim() ?? '';
    let newBaseName = deploy.newBaseName?.trim() ?? '';
    const mode = deploy.mode?.trim() ?? '';
    const isExplicitNewOutpost = Boolean(mode && /新辟|分基地|新建|异地/i.test(mode));
    const isExplicitCoLocate = Boolean(mode && /合署|同址|并入|扩建/i.test(mode) && !isExplicitNewOutpost);

    if (base && newBaseName) {
      if (
        canon(base) === canon(newBaseName) ||
        canon(stripBaseLocationModifier(base)) === canon(stripBaseLocationModifier(newBaseName))
      ) {
        const existingHit = resolveExistingBaseForDeploy(data.bases as RuntimeBaseLike[], base);
        if (existingHit.status === 'resolved' && !isExplicitNewOutpost) {
          base = existingHit.baseId;
          newBaseName = '';
        } else {
          newBaseName = '';
        }
      }
    }

    if (base && !newBaseName && deploy.action === '展开') {
      const existingHit = resolveExistingBaseForDeploy(data.bases as RuntimeBaseLike[], base);
      if (existingHit.status === 'resolved' && !isExplicitNewOutpost) {
        base = existingHit.baseId;
      } else if (isExplicitCoLocate && data.bases.length === 1) {
        base = data.bases[0].id || data.bases[0].name;
      }
    }

    if (!base && !newBaseName) {
      if (data.bases.length > 0 && !isExplicitNewOutpost) {
        base = data.bases[0].id || data.bases[0].name;
      } else if (deploy.action === '展开') {
        newBaseName = '前沿第一基地';
      }
    }

    if (deploy.action === '展开') {
      const rawVehicle = deploy.vehicle?.trim() || 'MCV';
      let targetVehicle = rawVehicle;
      const aliases = resolveMcvVehicleAliases(rawVehicle);
      if (aliases.length > 0) {
        const matched = data.forces.vehicles.find(v => aliases.some(a => canon(v) === canon(a)));
        if (matched) targetVehicle = matched;
      }
      const effectiveLocation = deploy.location?.trim() || data.meta.location?.trim() || '';
      const decl: DeployDecl = {
        verb: '展开',
        target: targetVehicle,
        ...(base ? { base } : {}),
        ...(newBaseName ? { newBaseName } : {}),
        ...(effectiveLocation ? { location: effectiveLocation } : {}),
        ...(deploy.tz_offset !== undefined ? { tz_offset: deploy.tz_offset } : {}),
        ...(deploy.weather ? { weather: deploy.weather } : {}),
        ...(deploy.site_type ? { site_type: deploy.site_type } : {}),
        ...(mode ? { mode } : {}),
        raw: JSON.stringify(deploy),
        path: `事件[MCV展开·${targetVehicle}]`,
      };
      resolveDeployOrder(decl, data, ctx);
    } else {
      const targetBuilding = deploy.building?.trim() || '建造厂';
      const decl: DeployDecl = {
        verb: '收起',
        target: targetBuilding,
        ...(base ? { base } : {}),
        raw: JSON.stringify(deploy),
        path: `事件[MCV收起·${targetBuilding}]`,
      };
      resolveDeployOrder(decl, data, ctx);
    }
  } finally {
    ctx.deployIndex = savedIndex;
  }
}

/**
 * 三色门产物落 ctx（留痕形制对齐 collectEngOrders：🟢🟡 走 events+issues 留痕、🔴 走 quarantine+issue，
 * 均不动账本、不计 appliedCount；配额计数跨块累计）。
 */
export function applyEventGate(gate: OrderedEventGateResult, ctx: Ctx): void {
  for (const item of gate.acceptedEvents) {
    const { declaration, repairs, align } = item;
    ctx.eventDeclarations.push(declaration);
    if (repairs.length > 0) {
      yellow(
        ctx,
        {
          layer: 'L2',
          path: '事件',
          message: `[事件] 「${declaration.verb}·${eventDeclName(declaration)}」归一化入库：${repairs.join('；')}`,
          ...(align ? { align } : {}),
        },
        {
          rule: 'R18',
          target: '事件',
          message: `事件「${declaration.verb}」容错归一化（${repairs.length} 处修复）`,
        },
      );
      continue;
    }
    const deferredToSettle =
      declaration.kind === 'chain' ||
      declaration.kind === 'protocol' ||
      declaration.kind === 'adjutant' ||
      declaration.kind === 'deploy';
    green(
      ctx,
      {
        layer: 'instruction',
        path: '事件',
        message: `[事件] 「${declaration.verb}·${eventDeclName(declaration)}」已解析（🟢），${
          deferredToSettle ? '随本楼结算接缝结转' : '已标准化入账（EVT-PARSE-02）'
        }`,
      },
      {
        rule: 'R18',
        target: '事件',
        message: `事件「${declaration.verb}」已入库${deferredToSettle ? '待结转' : '入账'}`,
      },
    );
  }
  for (const item of gate.quarantineEvents) {
    ctx.quarantine.push({
      scope: 'element',
      tag: '事件',
      raw: item.source,
      error: item.error,
      ...(item.suggestion !== undefined ? { suggestion: item.suggestion } : {}),
    });
    ctx.issues.push({ rule: 'R17', level: 'error', target: '事件', message: `事件条目已隔离：${item.error}` });
  }
  ctx.eventsAdmitted += gate.admitted;
}

/* ════ EVT-PARSE-02 · 势力/情报/任务标准化入账（真源 §5.1/§6.1、Q4；解析时点入账） ════ */

/**
 * 非链类事件声明入账（纯数据变换，仍属解析层；链类声明不在此入账——结转 settleFloor 第四齿轮）。
 *
 * 入账时点选择：势力/情报/任务是认知账本增量（非 Δt 派生），与 <战况> 同样在解析层入账；
 * 且暂存门（EVT-STAGE-01）的防线①就是「解析产生的新实体只写 Message 槽位 stat_data.pending_lore」。
 * - 势力：名称先过 applyAlign 权威对齐（§6.1.3 模糊匹配，防变体名分裂多生）；在册→按需增量更新
 *   态势字段，新势力→注册入 factions 并同步产出 pending_lore 暂存门结构实体（Q4 延迟确认，
 *   确认入册归 pendingLoreGate 途径 A/B，解析层零世界书调用）；
 * - 情报：canon(content) 判重后 append 标准情报快照（IntelItem 字段面；content 即快照身份）；
 * - 任务：对齐后 upsert quests.active（在编即 active 态；有则更新进度/详情，无则接取入编）。
 *
 * 暂存条目时空锚：解析层无楼层/分支上下文，source_floor/source_swipe 按读回侧同构的
 * 「未知」哨兵 -1 落笔（pendingLoreGate.readPendingLore 对缺失同样归一为 -1，两侧口径一致）。
 */
export function bookEventEntities(gate: OrderedEventGateResult, data: StatData, ctx: Ctx): void {
  for (const { declaration: decl } of gate.acceptedEvents) {
    if (decl.kind === 'faction' && decl.faction) {
      bookFactionDeclaration(decl.faction, data, ctx);
    } else if (decl.kind === 'intel' && decl.intel) {
      bookIntelDeclaration(decl.intel, data, ctx);
    } else if (decl.kind === 'quest' && decl.quest) {
      bookQuestDeclaration(decl.quest, data, ctx);
    } else if (decl.kind === 'chain' && decl.verb === '资金链建立' && decl.chain) {
      const chainsArr = data.economy?.chains;
      if (Array.isArray(chainsArr) && chainsArr.length > 0) {
        const cName = canon(decl.chain.name);
        const cId = `chain_${cName}`;
        const existing = chainsArr.find(
          c => c.status === 'establishing' && (canon(c.name) === cName || canon(c.id) === cId),
        );
        if (existing) {
          const extExisting = existing as Record<string, unknown>;
          existing.status = 'active';
          existing.eff = 1;
          if (decl.chain.rate_daily > 0 || decl.chain.wallet_daily || decl.chain.resources_daily) {
            existing.rate_daily = decl.chain.rate_daily;
          }
          if (decl.chain.chain_kind) {
            extExisting.chain_kind = decl.chain.chain_kind;
          }
          if (decl.chain.wallet_daily) {
            extExisting.wallet_daily = { ...decl.chain.wallet_daily };
          }
          if (decl.chain.resources_daily) {
            extExisting.resources_daily = { ...decl.chain.resources_daily };
          }
          if (decl.chain.deps) {
            const curDeps = (existing.deps ??= { base_id: '', buildings: [], world_resource: '' }) as Record<
              string,
              unknown
            >;
            if (decl.chain.deps.base_id) curDeps.base_id = decl.chain.deps.base_id;
            if (decl.chain.deps.buildings && decl.chain.deps.buildings.length > 0) {
              curDeps.buildings = [...decl.chain.deps.buildings];
            }
            if (decl.chain.deps.vehicles && decl.chain.deps.vehicles.length > 0) {
              curDeps.vehicles = [...decl.chain.deps.vehicles];
            }
            if (decl.chain.deps.faction) curDeps.faction = decl.chain.deps.faction;
            if (decl.chain.deps.world_resource) curDeps.world_resource = decl.chain.deps.world_resource;
          }
          if (decl.chain.reason) {
            existing.reason = decl.chain.reason;
          }
          syncEconomyChainDailySummary(data);
          ctx.appliedCount++;
        }
      }
    }
    // kind === 'chain' / 'protocol'：新建链与结算推进结转 settleFloor 资金链与协议结算齿轮（EVT-SETTLE-01/PRT-EVT-01 接缝）
  }
}

/** 势力发现入账：权威对齐 → 在册增量更新 / 新势力注册＋Q4 暂存门 */
export function bookFactionDeclaration(info: FactionEventDecl, data: StatData, ctx: Ctx): void {
  const name = applyAlign(info.name, ctx, `事件[势力发现·${info.name}]`, 'entity');
  const arr = data.factions as Record<string, unknown>[];
  const existing = arr.find(e => canon(e.name) === canon(name));
  if (existing) {
    if (info.attitude !== undefined) existing.attitude = info.attitude;
    if (info.risk !== undefined) existing.risk = info.risk;
    if (info.intel !== undefined && info.intel !== '') existing.intel = info.intel;
    ctx.appliedCount++;
    green(
      ctx,
      {
        layer: 'L2',
        path: `factions[${name}]`,
        message: `[事件] 势力「${name}」态势已更新（${
          [
            info.attitude !== undefined ? `态度:${info.attitude}` : '',
            info.risk !== undefined ? `风险:${info.risk}` : '',
            info.intel ? '情报' : '',
          ]
            .filter(Boolean)
            .join('／') || '无字段变更'
        }）`,
      },
      { rule: 'R18', target: '事件', message: `事件势力「${name}」已入账（在册更新）` },
    );
    return;
  }
  const candidate = {
    name,
    attitude: info.attitude ?? '未接触',
    risk: info.risk ?? '未知',
    intel: info.intel ?? '',
  };
  const parsed = Faction.safeParse(candidate);
  if (!parsed.success) {
    // 三色门已归一枚举，这里只是保险网（防御性隔离，不留脏数据）
    ctx.quarantine.push({
      scope: 'element',
      tag: '事件',
      path: `factions[${name}]`,
      raw: JSON.stringify(info).slice(0, 200),
      error: `势力声明「${name}」未通过实体校验`,
      suggestion: parsed.error.issues.map(i => i.message).join('; '),
    });
    return;
  }
  arr.push(parsed.data as Record<string, unknown>);
  ctx.appliedCount++;
  // Q4 延迟确认门：新势力同步产出 pending_lore 暂存门结构实体（世界书入档归确认门，解析层零写入 API）
  (data.pending_lore as unknown[]).push({
    id: `lore_${canon(name)}`,
    kind: '势力',
    name,
    summary: info.intel || `新发现势力（态度:${candidate.attitude} 风险:${candidate.risk}）`,
    is_new: true,
    source_floor: -1,
    source_swipe: -1,
    created_day: Number.isFinite(data.meta.day_count) ? data.meta.day_count : 0,
    raw: { verb: '势力发现', kind: 'faction', faction: info },
  });
  green(
    ctx,
    {
      layer: 'L2',
      path: `factions[${name}]`,
      message: `[事件] 新势力「${name}」已注册并入世界书暂存门（pending_lore，待确认入册）`,
    },
    { rule: 'R18', target: '事件', message: `新势力「${name}」已进暂存门（Q4 延迟确认）` },
  );
}

/** 情报获取入账：canon(content) 判重 → append 标准情报快照（IntelItem 字段面） */
export function bookIntelDeclaration(info: IntelEventDecl, data: StatData, ctx: Ctx): void {
  const arr = data.intel as Record<string, unknown>[];
  if (arr.some(e => canon(e.content) === canon(info.content))) return; // 同 appendIntel：重复情报静默去重
  const parsed = IntelItem.safeParse({
    src: info.src,
    content: info.content,
    date: data.meta.date || '',
    cred: info.cred,
    read: false,
    pinned: false,
  });
  if (!parsed.success) {
    ctx.quarantine.push({
      scope: 'element',
      tag: '事件',
      path: '情报',
      raw: JSON.stringify(info).slice(0, 200),
      error: '情报声明未通过快照校验',
      suggestion: parsed.error.issues.map(i => i.message).join('; '),
    });
    return;
  }
  arr.push(parsed.data as Record<string, unknown>);
  ctx.appliedCount++;
  green(
    ctx,
    {
      layer: 'L2',
      path: '情报',
      message: `[事件] 情报已入流水（来源:${info.src} 可信度:${info.cred}）`,
    },
    { rule: 'R18', target: '事件', message: '事件情报已入认知流水' },
  );
}

/** 任务接取入账：对齐 → 统一收口至 applyQuestBlock（在编即 active；有则更新、无则接取） */
export function bookQuestDeclaration(info: QuestEventDecl, data: StatData, ctx: Ctx): void {
  applyQuestBlock([info], data, ctx, { fromEvent: true });
}