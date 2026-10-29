/**
 * floorCardExtraParsers.ts —— 7 类扩展协议标签容错解析器
 * （<图鉴> / <事件> / <工程> / <排产计划> / <扩展档案> / <数据更新> / <timePast>）
 */
import * as YAML from 'yaml';
import {
  resolveExposureLevel,
  resolveMoraleStage,
} from '../../红警指挥系统/engines/exposureMoraleEngine';

export interface CodexEntryItem {
  name: string;
  category: string;
  code: 'BLD' | 'TECH' | 'INF' | 'VEH' | 'AIR' | 'NAV' | 'SYS';
  accentColor: string;
  summary: string;
  tags: string[];
  extraFields: Array<{ label: string; value: string }>;
}

export interface ParsedCodexCard {
  items: CodexEntryItem[];
  compactSummary: string;
}

export interface TacticalEventItem {
  title: string;
  location: string;
  subject: string;
  level: 'FLASH' | 'WARN' | 'INFO';
  summary: string;
  fields: Array<{ label: string; value: string }>;
}

export interface ParsedTacticalEventCard {
  items: TacticalEventItem[];
  compactSummary: string;
}

export interface EngineeringOrderItem {
  name: string;
  base: string;
  status: string;
  duration: string;
  cost: string;
  effect: string;
  fields: Array<{ label: string; value: string }>;
}

export interface ParsedEngineeringOrderCard {
  items: EngineeringOrderItem[];
  compactSummary: string;
}

export interface ProductionBatchItem {
  unit: string;
  count: string;
  base: string;
  line: string;
  eta: string;
  status: string;
}

export interface ParsedProductionScheduleCard {
  items: ProductionBatchItem[];
  compactSummary: string;
}

export interface IntelDossierItem {
  name: string;
  kind: string;
  affiliation: string;
  threat: string;
  summary: string;
  fields: Array<{ label: string; value: string }>;
}

export interface ParsedIntelDossierCard {
  items: IntelDossierItem[];
  compactSummary: string;
}

export interface ParsedExpansionDossierItem {
  name: string;
  kind: string; // '人物' | '科技' | '建筑' | '载具' | '人员' | '装备' | '其他'
  desc: string;
  detail: string;
  params: Record<string, string>;
  keys: string[];
  // 人物专属立体与动态字段（FD-32）
  title: string;
  faction: string;
  role: string;
  attitude: string;
  trust?: number;
  trustDelta: string;
  status: string;
  appearance: string;
  personality: string;
  skills: string;
  background: string;
  recentNote: string;
}

export interface ParsedExpansionDossierCard {
  items: ParsedExpansionDossierItem[];
  hasNpc: boolean;
  hasOther: boolean;
  compactSummary: string;
}

export type TacticalIntelSrcKind =
  | '雷达侦察'
  | '渗透内线'
  | '暗网流言'
  | '电讯截获'
  | '前线目视'
  | '宏观广播';

export type WorldEvoDomain =
  | '远方地缘'
  | '位面异象'
  | '暗流科技'
  | '社会黑市';

export type WorldEvoStage = '萌芽' | '发酵' | '高潮' | '平息';

export interface ParsedTacticalIntelItem {
  title: string;
  scope: 'tactical' | 'world';
  src: string;
  srcKind: TacticalIntelSrcKind;
  cred: '高' | '中' | '低';
  status: '待核实' | '已证实' | '已证伪' | '演进中';
  evolvesFrom: string;
  chain?: string;
  chainStep?: string;
  nextLead?: string;
  evoDomain: WorldEvoDomain;
  stage: WorldEvoStage;
  ttlFloors: number;
  hook: string;
  content: string;
  date: string;
}

export interface ParsedTacticalIntelCard {
  items: ParsedTacticalIntelItem[];
  hasTactical: boolean;
  hasWorld: boolean;
  compactSummary: string;
}

export interface DataPatchItem {
  target: string;
  book: string;
  op: string;
  changes: Array<{ field: string; value: string }>;
}

export interface ParsedDataPatchCard {
  items: DataPatchItem[];
  compactSummary: string;
}

export interface ParsedChronoStepCard {
  raw: string;
  days: number;
  hours: number;
  minutes: number;
  formattedCode: string;
  humanLabel: string;
}

export interface TacticalStaffAdviceItem {
  advisor: string;      // 如 '白凌' | '凛冬妮娅' | '薇拉' | '联席参谋部'
  focus: string;        // 如 '产线扩建' | '新兵种列装' | '战术推进'（缺省 '战术建议'）
  advice: string;       // 建议正文
  commandText: string;  // 点击「▶ 采纳指令」填入输入框的文本
}

export interface ParsedTacticalSituationCard {
  date: string;
  location: string;
  weather: string;
  exposureDelta: string;
  exposureValue?: number;
  exposureFloor?: number;
  exposureLevel: string;
  morale?: number;
  moraleDelta: string;
  moraleStage: string;
  moraleTrend: string;
  moraleEvent: string;
  fields: Array<{ label: string; value: string }>;
  staffAdvice: TacticalStaffAdviceItem[];
  compactSummary: string;
}

export type TacticalSituationPayload = ParsedTacticalSituationCard;

export interface TacticalOptionCardItem {
  text: string;
  tag: string;
  cost: string;
}

export interface ParsedTacticalOptionsCard {
  items: TacticalOptionCardItem[];
  compactSummary: string;
}

export interface TacticalQuestCardItem {
  name: string;
  category: string; // 主线 | 支线 | 紧急 | 日常 | 指令
  status: string; // 进行中 | 已完成 | 已失败 | 已取消
  issuer: string;
  series?: string;
  chainStep?: string;
  nextQuest?: string;
  progress: string;
  note: string;
  detail: string;
  rewardSummary: string;
  rewardBadges: string[];
}

export interface ParsedTacticalQuestCard {
  items: TacticalQuestCardItem[];
  compactSummary: string;
}

export interface DeploymentOrderItem {
  action: string;
  unit: string;
  base: string;
  location: string;
  status: string;
  sectors: string[];
  buildings: string[];
  summary: string;
  fields: Array<{ label: string; value: string }>;
}

export interface DeploymentOrderCardPayload {
  items: DeploymentOrderItem[];
  lineCount: number;
  compactSummary: string;
}

export type ParsedDeploymentOrderCard = DeploymentOrderCardPayload;

export interface EconomyChainCardItem {
  name: string;
  status: string;
  flow: string;
  dailyRate: string;
  efficiency: string;
  capacity: string;
  base: string;
  desc: string;
  fields: Array<{ label: string; value: string }>;
}

export interface EconomyChainsCardPayload {
  items: EconomyChainCardItem[];
  compactSummary: string;
}

export type ParsedEconomyChainsCard = EconomyChainsCardPayload;

export interface WorldEvolutionCardItem {
  id: string;
  title: string;
  domain: WorldEvoDomain;
  stage: WorldEvoStage;
  region: string;
  situation: string;
  hook: string;
  ttlFloors: number;
}

export interface WorldEvolutionCardPayload {
  items: WorldEvolutionCardItem[];
  compactSummary: string;
}

export type ParsedWorldEvolutionCard = WorldEvolutionCardPayload;

function stripOuterTag(raw: string, tagNames: string[]): string {
  let text = raw.trim();
  for (const tag of tagNames) {
    const openRe = new RegExp(`^<${tag}(?:\\s+[^>]*)?>\\s*`, 'i');
    const closeRe = new RegExp(`\\s*<\\/${tag}>$`, 'i');
    text = text.replace(openRe, '').replace(closeRe, '').trim();
  }
  return text
    .replace(/^```(?:yaml|yml|json|text)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function parseFlexibleRecords(
  input: unknown,
  tagNames: string[],
  primaryKeys: string[],
): Array<Record<string, unknown>> {
  if (Array.isArray(input)) {
    return input.filter(x => x && typeof x === 'object') as Array<Record<string, unknown>>;
  }
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    for (const k of ['items', 'list', 'entries', 'actions', '列表', '条目', '动作', '计划', ...tagNames]) {
      if (Array.isArray(obj[k])) {
        return (obj[k] as unknown[]).filter(x => x && typeof x === 'object') as Array<
          Record<string, unknown>
        >;
      }
    }
    return [obj];
  }
  if (typeof input !== 'string') return [];

  const cleaned = stripOuterTag(input, tagNames);
  if (!cleaned) return [];

  // 1. 尝试 JSON / YAML 解析
  try {
    const parsed = YAML.parse(cleaned);
    if (Array.isArray(parsed)) {
      const objs = parsed.filter(x => x && typeof x === 'object') as Array<Record<string, unknown>>;
      if (objs.length > 0) return objs;
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      for (const k of ['items', 'list', 'entries', 'actions', '列表', '条目', '动作', '计划', ...tagNames]) {
        if (Array.isArray(obj[k])) {
          const arr = (obj[k] as unknown[]).filter(x => x && typeof x === 'object') as Array<
            Record<string, unknown>
          >;
          if (arr.length > 0) return arr;
        }
      }
      // 检查是否是键值对映射（如 排产计划: { 美国大兵: 2, 战斗工兵: 1 }）
      const keys = Object.keys(obj);
      const hasPrimary = keys.some(k => primaryKeys.includes(k));
      if (hasPrimary) {
        return [obj];
      }
      const nestedObjs = keys
        .map(k => {
          const val = obj[k];
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            return { 名称: k, ...(val as Record<string, unknown>) };
          }
          return null;
        })
        .filter(Boolean) as Array<Record<string, unknown>>;
      if (nestedObjs.length > 0) return nestedObjs;
      return [obj];
    }
  } catch {
    /* fallback to line block parser */
  }

  // 2. 行级多段键值块解析（支持重复出现“名称：...”分段）
  const records: Array<Record<string, unknown>> = [];
  let current: Record<string, unknown> = {};

  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const isBullet = /^[-*•]\s+/.test(line);
    const stripped = line.replace(/^[-*•]\s+/, '').trim();
    const match = stripped.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (!match) {
      if (isBullet && stripped) {
        if (Object.keys(current).length > 0) {
          records.push(current);
          current = {};
        }
        records.push({ 名称: stripped });
      }
      continue;
    }
    const key = match[1].trim();
    const val = match[2].trim().replace(/^['"]|['"]$/g, '');
    if (
      (isBullet && Object.keys(current).length > 0 && primaryKeys.includes(key)) ||
      (primaryKeys.includes(key) && key in current)
    ) {
      records.push(current);
      current = {};
    }
    current[key] = val;
  }
  if (Object.keys(current).length > 0) {
    records.push(current);
  }
  return records;
}

function pickStr(rec: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const k of keys) {
    const v = rec[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return fallback;
}

function resolveCodexCategoryMeta(rawCat: string): {
  code: CodexEntryItem['code'];
  accentColor: string;
} {
  const c = rawCat.trim();
  if (/建筑|设施|防御|基建|building/i.test(c)) {
    return { code: 'BLD', accentColor: '#f59e0b' };
  }
  if (/科技|研究|技术|学说|tech/i.test(c)) {
    return { code: 'TECH', accentColor: '#38bdf8' };
  }
  if (/人员|步兵|士兵|特工|infantry/i.test(c)) {
    return { code: 'INF', accentColor: '#4ade80' };
  }
  if (/载具|装甲|战车|坦克|vehicle/i.test(c)) {
    return { code: 'VEH', accentColor: '#f97316' };
  }
  if (/航空|空军|飞行器|战机|航天|air/i.test(c)) {
    return { code: 'AIR', accentColor: '#a855f7' };
  }
  if (/舰船|海军|潜艇|舰艇|naval/i.test(c)) {
    return { code: 'NAV', accentColor: '#06b6d4' };
  }
  if (/地点|区域|地区|据点|场所|聚落|地标|location|place|site/i.test(c)) {
    return { code: 'BLD', accentColor: '#10b981' };
  }
  return { code: 'SYS', accentColor: '#94a3b8' };
}

const EXTRA_PARSE_CACHE_LIMIT = 256;
const extraParserCache = new Map<string, unknown>();

function cloneExtraCached<T>(val: T): T {
  if (val === null || val === undefined || typeof val !== 'object') return val;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(val);
    } catch {
      /* fallback to JSON clone */
    }
  }
  return JSON.parse(JSON.stringify(val)) as T;
}

function getExtraCache<T>(prefix: string, input: unknown): { hit: true; value: T } | { hit: false } {
  if (typeof input !== 'string') return { hit: false };
  const key = `${prefix}::${input}`;
  if (!extraParserCache.has(key)) return { hit: false };
  const cached = extraParserCache.get(key) as T;
  extraParserCache.delete(key);
  extraParserCache.set(key, cached);
  return { hit: true, value: cloneExtraCached(cached) };
}

function setExtraCache<T>(prefix: string, input: unknown, value: T): T {
  if (typeof input !== 'string') return value;
  const key = `${prefix}::${input}`;
  if (extraParserCache.has(key)) {
    extraParserCache.delete(key);
  } else if (extraParserCache.size >= EXTRA_PARSE_CACHE_LIMIT) {
    const oldestKey = extraParserCache.keys().next().value;
    if (oldestKey !== undefined) {
      extraParserCache.delete(oldestKey);
    }
  }
  extraParserCache.set(key, cloneExtraCached(value));
  return value;
}

/**
 * 1. 解析 `<图鉴>` 载荷
 */
export function parseCodexEntryPayload(input: unknown): ParsedCodexCard {
  const cached = getExtraCache<ParsedCodexCard>('codex-entry', input);
  if (cached.hit) return cached.value;
  const records = parseFlexibleRecords(input, ['图鉴', 'codex'], [
    'name',
    'title',
    '名称',
    '词条',
    '条目',
  ]);
  const items: CodexEntryItem[] = [];

  for (const rec of records) {
    const name = pickStr(rec, ['name', 'title', '名称', '词条', '条目'], '未命名图鉴条目');
    const category = pickStr(
      rec,
      ['category', 'type', 'kind', '类别', '分类', '类型', '种类', '归类'],
      '战术条目',
    );
    const summary = pickStr(
      rec,
      ['summary', 'desc', 'description', 'intro', '简介', '描述', '说明', '效果'],
      '已收录至战区中央战术数据库。',
    );
    const rawTags = rec.tags ?? rec['标签'] ?? rec['定位'];
    const tags = Array.isArray(rawTags)
      ? rawTags.map(t => String(t).trim()).filter(Boolean)
      : typeof rawTags === 'string'
        ? rawTags
            .split(/[,，/｜|、\s]+/)
            .map(s => s.trim())
            .filter(Boolean)
        : [];

    const reserved = new Set([
      'name',
      'title',
      '名称',
      '词条',
      '条目',
      'category',
      'type',
      'kind',
      '类别',
      '分类',
      '类型',
      '种类',
      '归类',
      'summary',
      'desc',
      'description',
      'intro',
      '简介',
      '描述',
      '说明',
      '效果',
      'tags',
      '标签',
      '定位',
    ]);
    const extraFields: Array<{ label: string; value: string }> = [];
    for (const [k, v] of Object.entries(rec)) {
      if (reserved.has(k) || v === undefined || v === null || typeof v === 'object') continue;
      const valStr = String(v).trim();
      if (valStr) extraFields.push({ label: k, value: valStr });
    }

    const meta = resolveCodexCategoryMeta(category);
    items.push({
      name,
      category,
      code: meta.code,
      accentColor: meta.accentColor,
      summary,
      tags,
      extraFields,
    });
  }

  if (items.length === 0) {
    items.push({
      name: '战区标准图鉴归档',
      category: '系统归档',
      code: 'SYS',
      accentColor: '#38bdf8',
      summary: '已完成新解锁装备与科技的数据库索引同步。',
      tags: [],
      extraFields: [],
    });
  }

  const previewNames = items
    .slice(0, 3)
    .map(i => `${i.name}(${i.category})`)
    .join(' / ');
  const suffix = items.length > 3 ? ` 等 ${items.length} 项` : ` 共 ${items.length} 项`;

  return setExtraCache('codex-entry', input, {
    items,
    compactSummary: `${previewNames} ·${suffix}`,
  });
}

export const parseCodexPayload = parseCodexEntryPayload;

/**
 * 2. 解析 `<事件>` 载荷
 */
export function parseTacticalEventPayload(input: unknown): ParsedTacticalEventCard {
  const cached = getExtraCache<ParsedTacticalEventCard>('tactical-event', input);
  if (cached.hit) return cached.value;
  const records = parseFlexibleRecords(input, ['事件', 'event'], [
    'event',
    'title',
    'name',
    'type',
    '事件',
    '事件名称',
    '标题',
    '类型',
  ]);
  const items: TacticalEventItem[] = [];

  for (const rec of records) {
    let title = pickStr(rec, ['event', 'title', 'name', 'type', '事件', '事件名称', '标题', '类型']);
    const location = pickStr(rec, ['base', 'location', 'site', '基地', '地点', '阵位', '战区'], '战区前线');
    const subject = pickStr(
      rec,
      ['unit', 'vehicle', 'target', 'actor', '载具', '单位', '涉事单位', '目标', '主体'],
      '前线指挥部',
    );
    const summary = pickStr(
      rec,
      ['summary', 'result', 'desc', 'detail', '结果', '说明', '详情', '描述', '态势'],
      '',
    );

    const fields: Array<{ label: string; value: string }> = [];
    for (const [k, v] of Object.entries(rec)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'object' && !Array.isArray(v)) {
        if (!title) title = k;
        for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
          if (sv !== undefined && sv !== null && String(sv).trim()) {
            fields.push({ label: sk, value: String(sv).trim() });
          }
        }
      } else {
        const s = String(v).trim();
        if (s) fields.push({ label: k, value: s });
      }
    }
    if (!title) {
      title = fields[0]?.value || '战区突发态势通报';
    }

    const fullText = `${title} ${summary}`;
    const level: TacticalEventItem['level'] = /袭击|警报|超武|受损|交火|危机|敌/i.test(fullText)
      ? 'FLASH'
      : /展开|启封|完工|警告|变更/i.test(fullText)
        ? 'WARN'
        : 'INFO';

    items.push({
      title,
      location,
      subject,
      level,
      summary: summary || fields.map(f => `${f.label}: ${f.value}`).join(' ｜ '),
      fields,
    });
  }

  if (items.length === 0) {
    items.push({
      title: '战区态势电报同步',
      location: '前沿第一基地',
      subject: '参谋部电传室',
      level: 'INFO',
      summary: '本回合战区事件记录已归档入册。',
      fields: [{ label: '状态', value: '已归档' }],
    });
  }

  const first = items[0];
  return setExtraCache('tactical-event', input, {
    items,
    compactSummary: `${first.title} · 阵位:${first.location}${items.length > 1 ? ` (+${items.length - 1}封)` : ''}`,
  });
}

/**
 * 3. 解析 `<工程>` 载荷
 */
export function parseEngineeringOrderPayload(input: unknown): ParsedEngineeringOrderCard {
  const cached = getExtraCache<ParsedEngineeringOrderCard>('engineering-order', input);
  if (cached.hit) return cached.value;
  const records = parseFlexibleRecords(input, ['工程', 'engineering'], [
    'name',
    'project',
    'title',
    '名称',
    '工程',
    '工程名称',
    '项目',
  ]);
  const items: EngineeringOrderItem[] = [];

  for (const rec of records) {
    const name = pickStr(rec, ['name', 'project', 'title', '名称', '工程', '工程名称', '项目'], '战区基建工程');
    const base = pickStr(rec, ['base', 'location', '基地', '所属基地', '地点', '阵位'], '前沿第一基地');
    const status = pickStr(rec, ['status', 'stage', '状态', '阶段', '进度'], '施工推进中');
    const duration = pickStr(rec, ['duration', 'eta', 'time', '耗时', '工期', '预计耗时', '剩余时间'], '常规工期');
    const cost = pickStr(rec, ['cost', 'budget', 'power', '资金', '造价', '消耗', '投入'], '标准预算');
    const effect = pickStr(rec, ['effect', 'desc', 'summary', '效果', '说明', '简介', '产出'], '提升战区基础设施保障能级');

    const fields: Array<{ label: string; value: string }> = [];
    for (const [k, v] of Object.entries(rec)) {
      if (v !== undefined && v !== null && typeof v !== 'object' && String(v).trim()) {
        fields.push({ label: k, value: String(v).trim() });
      }
    }

    items.push({ name, base, status, duration, cost, effect, fields });
  }

  if (items.length === 0) {
    items.push({
      name: '战区基建整備工程',
      base: '前沿第一基地',
      status: '立项执行',
      duration: '进行中',
      cost: '常规配给',
      effect: '已纳入总参工程局施工序列。',
      fields: [],
    });
  }

  const first = items[0];
  return setExtraCache('engineering-order', input, {
    items,
    compactSummary: `${first.name} (${first.base} · ${first.status})${items.length > 1 ? ` 等${items.length}项` : ''}`,
  });
}

/**
 * 4. 解析 `<排产计划>` 与 `<生产>` 特批交割载荷
 */
export function parseProductionSchedulePayload(input: unknown): ParsedProductionScheduleCard {
  const cached = getExtraCache<ParsedProductionScheduleCard>('production-schedule', input);
  if (cached.hit) return cached.value;
  const isDeliveryTag = typeof input === 'string' && /^\s*<生产(?:\s|>)/i.test(input);
  const PRIMARY_UNIT_KEYS = [
    'unit',
    'name',
    'item',
    'catalog_ref',
    'task_ref',
    'target',
    '标的',
    '单位',
    '名称',
    '型号',
    '装备',
    '建筑',
    '科技',
    '项目',
    '条目',
    '目标',
    '产物',
    '收讫',
    '交付',
  ];
  const records = parseFlexibleRecords(
    input,
    ['排产计划', '生产', '排产', 'production', 'delivery'],
    PRIMARY_UNIT_KEYS,
  );
  const items: ProductionBatchItem[] = [];

  const pushNormalizedRec = (rec: Record<string, unknown>, fallbackCategory?: string) => {
    const unit = pickStr(rec, PRIMARY_UNIT_KEYS, '制式作战单元');
    const count = pickStr(rec, ['count', 'qty', 'quantity', 'amount', '数量', '批次', '规模', '台数', '人数'], 'x1');
    const base = pickStr(
      rec,
      ['base', 'base_ref', 'location', '基地', '所属基地', '产地', '交付基地', '阵位'],
      '前沿第一基地',
    );
    const line = pickStr(
      rec,
      ['line', 'facility', 'producer', 'slot', 'building', '产线', '承建建筑', '工厂', '母体', '槽位', '类别', '类型'],
      fallbackCategory || (isDeliveryTag ? '战地特批交割' : '标准军工产线'),
    );
    const eta = pickStr(
      rec,
      ['eta', 'duration', 'time', '工期', '耗时', '周期', '预计完工', '进度'],
      isDeliveryTag ? '已交付入库' : '常规周期',
    );
    const status = pickStr(
      rec,
      ['status', 'mode', 'state', 'action', '状态', '模式', '动作', '结果'],
      isDeliveryTag ? '完工交割' : '排产中',
    );

    items.push({
      unit,
      count: /^\d+$/.test(count) ? `×${count}` : count,
      base,
      line,
      eta,
      status,
    });
  };

  for (const rec of records) {
    const hasExplicitUnit = PRIMARY_UNIT_KEYS.some(k => k in rec && typeof rec[k] !== 'object');
    if (!hasExplicitUnit && Object.keys(rec).length > 0) {
      let handledGroup = false;
      for (const [k, v] of Object.entries(rec)) {
        if (Array.isArray(v)) {
          handledGroup = true;
          for (const elem of v) {
            if (elem && typeof elem === 'object' && !Array.isArray(elem)) {
              pushNormalizedRec(elem as Record<string, unknown>, k.trim());
            } else if (elem !== undefined && elem !== null && String(elem).trim()) {
              items.push({
                unit: String(elem).trim(),
                count: '×1',
                base: '前沿第一基地',
                line: k.trim() || (isDeliveryTag ? '战地特批交割' : '军工总装线'),
                eta: isDeliveryTag ? '已交付入库' : '本轮批次',
                status: isDeliveryTag ? '完工交割' : '排产列装',
              });
            }
          }
        } else if (v && typeof v === 'object') {
          handledGroup = true;
          pushNormalizedRec({ 名称: k.trim(), ...(v as Record<string, unknown>) }, k.trim());
        }
      }
      if (handledGroup) continue;

      // 处理形如 { 美国大兵: 2, 犀牛坦克: 3 } 的简写映射
      for (const [k, v] of Object.entries(rec)) {
        if (v !== undefined && v !== null && typeof v !== 'object') {
          const valStr = String(v).trim();
          items.push({
            unit: k.trim(),
            count: /^\d+$/.test(valStr) ? `×${valStr}` : valStr || '×1',
            base: '前沿第一基地',
            line: isDeliveryTag ? '战地特批交割' : '军工总装线',
            eta: isDeliveryTag ? '已交付入库' : '本轮批次',
            status: isDeliveryTag ? '完工交割' : '排产列装',
          });
        }
      }
      continue;
    }

    pushNormalizedRec(rec);
  }

  if (items.length === 0) {
    items.push({
      unit: '常规战备批次',
      count: '×1',
      base: '前沿第一基地',
      line: '主力产线',
      eta: '准时交付',
      status: isDeliveryTag ? '完工交割' : '已下达',
    });
  }

  const preview = items
    .slice(0, 3)
    .map(i => `${i.unit}${i.count}`)
    .join(' / ');

  return setExtraCache('production-schedule', input, {
    items,
    compactSummary: `${preview}${items.length > 3 ? ` 等 ${items.length} 批` : ''}`,
  });
}

/**
 * 5. 解析 `<扩展档案>` 载荷
 */
export function parseIntelDossierPayload(input: unknown): ParsedIntelDossierCard {
  const cached = getExtraCache<ParsedIntelDossierCard>('intel-dossier', input);
  if (cached.hit) return cached.value;
  const records = parseFlexibleRecords(input, ['扩展档案', 'intel'], [
    'name',
    'title',
    'codename',
    '名称',
    '代号',
    '姓名',
    '目标',
  ]);
  const items: IntelDossierItem[] = [];

  for (const rec of records) {
    const name = pickStr(rec, ['name', 'title', 'codename', '名称', '代号', '姓名', '目标'], '未知情报目标');
    const kind = pickStr(rec, ['kind', 'type', 'category', '分类', '类型', '类别'], '人物/势力卷宗');
    const affiliation = pickStr(rec, ['affiliation', 'faction', 'org', '归属', '阵营', '势力', '所属'], '中立/待甄别');
    const threat = pickStr(rec, ['threat', 'stance', 'attitude', 'level', '威胁度', '态度', '立场', '等级'], '持续监控');
    const summary = pickStr(
      rec,
      ['summary', 'bio', 'desc', 'background', '简介', '背景', '描述', '情报摘要', '说明'],
      '战区情报局已建立专项追踪卷宗。',
    );

    const fields: Array<{ label: string; value: string }> = [];
    for (const [k, v] of Object.entries(rec)) {
      if (v !== undefined && v !== null && typeof v !== 'object' && String(v).trim()) {
        fields.push({ label: k, value: String(v).trim() });
      }
    }

    items.push({ name, kind, affiliation, threat, summary, fields });
  }

  if (items.length === 0) {
    items.push({
      name: '战区加密情报档案',
      kind: '机密卷宗',
      affiliation: '待核实',
      threat: 'LEVEL-2',
      summary: '情报摘要已加密录入参谋部终端。',
      fields: [],
    });
  }

  const first = items[0];
  return setExtraCache('intel-dossier', input, {
    items,
    compactSummary: `${first.name} [${first.kind} · ${first.affiliation}]${items.length > 1 ? ` +${items.length - 1}份` : ''}`,
  });
}

/**
 * 6. 解析 `<数据更新>` 载荷
 */
export function parseDataPatchPayload(input: unknown): ParsedDataPatchCard {
  const cached = getExtraCache<ParsedDataPatchCard>('data-patch', input);
  if (cached.hit) return cached.value;
  const records = parseFlexibleRecords(input, ['数据更新', 'dataPatch'], [
    'target',
    'entry',
    'name',
    '目标条目',
    '更新目标',
    '目标',
    '词条',
    '名称',
    '条目',
  ]);
  const items: DataPatchItem[] = [];

  for (const rec of records) {
    const target = pickStr(
      rec,
      ['target', 'entry', 'name', '目标条目', '更新目标', '目标', '词条', '名称', '条目'],
      '世界书量化词条',
    );
    const book = pickStr(rec, ['book', 'category', 'worldbook', '世界书', '分类', '所属书'], '核心参数库');
    const op = pickStr(rec, ['op', 'action', 'mode', '操作', '类型', '状态'], 'PATCH // 热更新');

    const reserved = new Set([
      'target',
      'entry',
      'name',
      '目标条目',
      '更新目标',
      '目标',
      '词条',
      '名称',
      '条目',
      'book',
      'category',
      'worldbook',
      '世界书',
      '分类',
      '所属书',
      'op',
      'action',
      'mode',
      '操作',
      '类型',
      '状态',
    ]);
    const changes: Array<{ field: string; value: string }> = [];
    for (const [k, v] of Object.entries(rec)) {
      if (reserved.has(k) || v === undefined || v === null) continue;
      const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v).trim();
      if (valStr) changes.push({ field: k, value: valStr });
    }
    if (changes.length === 0) {
      changes.push({ field: '量化载荷', value: '已同步最新纳米底层参数' });
    }

    items.push({ target, book, op, changes });
  }

  if (items.length === 0) {
    items.push({
      target: '系统底层量化表',
      book: '世界书数据库',
      op: 'PATCH // 同步',
      changes: [{ field: '状态', value: '热补丁编译完成' }],
    });
  }

  const preview = items
    .slice(0, 2)
    .map(i => `${i.target}(${i.changes.length}项变更)`)
    .join(' / ');

  return setExtraCache('data-patch', input, {
    items,
    compactSummary: `${preview}${items.length > 2 ? ` 等 ${items.length} 条补丁` : ''}`,
  });
}

/**
 * 7. 解析 `<timePast>` 载荷
 */
export function parseChronoStepPayload(input: unknown): ParsedChronoStepCard {
  const cached = getExtraCache<ParsedChronoStepCard>('chrono-step', input);
  if (cached.hit) return cached.value;
  const raw = typeof input === 'string' ? stripOuterTag(input, ['timePast']) : String(input ?? '');
  let days = 0;
  let hours = 0;
  let minutes = 0;

  const dMatch = raw.match(/(\d+)\s*(?:D|d|天|日)/);
  const hMatch = raw.match(/(\d+)\s*(?:H|h|小时|时)/);
  const mMatch = raw.match(/(\d+)\s*(?:M|m|分钟|分)/);

  if (dMatch || hMatch || mMatch) {
    days = dMatch ? Number(dMatch[1]) || 0 : 0;
    hours = hMatch ? Number(hMatch[1]) || 0 : 0;
    minutes = mMatch ? Number(mMatch[1]) || 0 : 0;
  } else {
    const colonMatch = raw.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (colonMatch) {
      hours = Number(colonMatch[1]) || 0;
      minutes = Number(colonMatch[2]) || 0;
    } else {
      const numMatch = raw.match(/(\d+)/);
      if (numMatch) {
        minutes = Number(numMatch[1]) || 0;
      }
    }
  }

  const pad2 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
  const formattedCode = `+${pad2(days)}D ${pad2(hours)}H ${pad2(minutes)}M`;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}分钟`);

  return setExtraCache('chrono-step', input, {
    raw: raw || '0 D 0 H 0 M',
    days,
    hours,
    minutes,
    formattedCode,
    humanLabel: `战区时钟推进 ${parts.join(' ')}`,
  });
}

const STAFF_ADVICE_FIELD_KEYS = [
  '参谋建议',
  '副官建议',
  '白凌建议',
  '战术建议',
  '建议',
  'staff_advice',
  'staffAdvice',
  'advisory',
  'advice',
] as const;

function extractStaffAdviceItems(rec: Record<string, unknown>): TacticalStaffAdviceItem[] {
  const items: TacticalStaffAdviceItem[] = [];
  const pushAdvice = (
    advisorRaw: string,
    focusRaw: string,
    adviceRaw: string,
    cmdRaw?: string,
  ): void => {
    const advice = adviceRaw.trim().replace(/^['"]|['"]$/g, '');
    if (!advice) return;
    const advisor = (advisorRaw || '白凌').trim() || '白凌';
    const focus = (focusRaw || '战术建议').trim() || '战术建议';
    const cleanCmd = (cmdRaw ?? '').trim().replace(/^['"]|['"]$/g, '');
    const commandText = cleanCmd || `采纳${advisor}参谋建议：${advice}`;
    items.push({ advisor, focus, advice, commandText });
  };

  const parseAdviceString = (rawStr: string, defaultAdvisor = '白凌'): void => {
    const trimmed = rawStr.trim().replace(/^[-*•]\s+/, '').trim();
    if (!trimmed) return;
    const prefixMatch = trimmed.match(
      /^([^\s:：()（）\[\]【】]{1,12}?)(?:[（(\[【]([^)）\]】]+)[)）\]】])?\s*[:：]\s*(.+)$/,
    );
    if (
      prefixMatch &&
      !/^(建议|内容|指令|行动|焦点|类型|领域|advice|text|command|focus)$/i.test(prefixMatch[1].trim())
    ) {
      pushAdvice(
        prefixMatch[1].trim() || defaultAdvisor,
        (prefixMatch[2] ?? '').trim() || '战术建议',
        prefixMatch[3].trim(),
      );
      return;
    }
    pushAdvice(defaultAdvisor, '战术建议', trimmed);
  };

  const parseAdviceEntry = (val: unknown, fallbackAdvisor = '白凌'): void => {
    if (val === undefined || val === null) return;
    if (typeof val === 'string') {
      const lines = val
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);
      if (lines.length > 1 && lines.every(l => /^[-*•]\s+/.test(l) || /^[^:：]{1,14}[:：]/.test(l))) {
        for (const l of lines) {
          parseAdviceString(l, fallbackAdvisor);
        }
      } else {
        parseAdviceString(val, fallbackAdvisor);
      }
      return;
    }
    if (Array.isArray(val)) {
      for (const entry of val) {
        parseAdviceEntry(entry, fallbackAdvisor);
      }
      return;
    }
    if (typeof val === 'object') {
      const obj = val as Record<string, unknown>;
      const advisor = pickStr(
        obj,
        ['参谋', '机娘', '副官', '献策人', '姓名', '角色', 'advisor', 'girl', 'speaker', 'author', 'name'],
        fallbackAdvisor,
      );
      const focus = pickStr(
        obj,
        ['焦点', '类型', '领域', '方向', '标签', '专题', 'focus', 'domain', 'category', 'tag', 'type'],
        '战术建议',
      );
      const advice = pickStr(
        obj,
        ['建议', '内容', '献策', '正文', '说明', '详情', 'advice', 'text', 'content', 'summary', 'desc'],
        '',
      );
      const cmd = pickStr(
        obj,
        ['指令', '行动', '执行指令', '采纳指令', 'command', 'cmd', 'action', 'directive', 'order'],
        '',
      );
      if (advice) {
        pushAdvice(advisor, focus, advice, cmd);
        return;
      }

      // 字典映射形态：{ 白凌: '建议...', 凛冬妮娅: '建议...' }
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined || v === null) continue;
        const keyMatch = k.trim().match(/^([^()（）\[\]【】]+?)(?:[（(\[【]([^)）\]】]+)[)）\]】])?$/);
        const keyAdvisor = keyMatch ? keyMatch[1].trim() : k.trim();
        const keyFocus = keyMatch && keyMatch[2] ? keyMatch[2].trim() : '战术建议';
        if (typeof v === 'string') {
          pushAdvice(keyAdvisor, keyFocus, v);
        } else if (typeof v === 'object') {
          parseAdviceEntry(v, keyAdvisor);
        }
      }
    }
  };

  for (const key of STAFF_ADVICE_FIELD_KEYS) {
    if (key in rec && rec[key] !== undefined && rec[key] !== null) {
      const defaultAdv = key === '白凌建议' ? '白凌' : '白凌';
      parseAdviceEntry(rec[key], defaultAdv);
    }
  }

  return items;
}

const SITUATION_EXPOSURE_MORALE_KEYS = [
  'exposure',
  'exposure_value',
  'exposure_delta',
  'exposureDelta',
  'exposure_level',
  'exposureLevel',
  'exposure_floor',
  'exposureFloor',
  '暴露度',
  '当前暴露度',
  '暴露值',
  '暴露度变化',
  '暴露变化',
  '隐蔽度变化',
  '暴露等级',
  '暴露档位',
  '暴露分级',
  '暴露底线',
  '常驻暴露底线',
  'morale',
  'morale_value',
  'morale_delta',
  'moraleDelta',
  'morale_trend',
  'moraleTrend',
  'morale_event',
  'moraleEvent',
  '民心',
  '民心指数',
  '当前民心',
  '民心变化',
  '民心增量',
  '民心变动',
  '民心趋势',
  '民心走向',
  '民心事件',
  '民心原因',
  '民心说明',
] as const;

function parseSignedDeltaStr(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const m = s.match(/^([+＋-])?\s*(\d+(?:\.\d+)?)/);
  if (!m) return s;
  const sign = m[1] === '-' ? '-' : '+';
  const num = Number(m[2]);
  if (!Number.isFinite(num)) return s;
  if (num === 0) return '0.0';
  return `${sign}${num}`;
}

function normalizeExplicitExposureLevel(raw: string, fallbackValue: number): string {
  const s = raw.trim();
  if (/EL-4|位面出圈/i.test(s)) return 'EL-4 位面出圈';
  if (/EL-3|大势震动/i.test(s)) return 'EL-3 大势震动';
  if (/EL-2|战区警觉/i.test(s)) return 'EL-2 战区警觉';
  if (/EL-1|轻微可疑/i.test(s)) return 'EL-1 轻微可疑';
  if (/EL-0|日常隐蔽/i.test(s)) return 'EL-0 日常隐蔽';
  const info = resolveExposureLevel(fallbackValue);
  return `${info.code} ${info.shortName}`;
}

/**
 * 8. 解析 `<态势>` 载荷（含 FD-31 参谋席建议与 FD-36 暴露度 EL 等级 / 民心五阶）
 */
export function parseTacticalSituationPayload(input: unknown): ParsedTacticalSituationCard {
  const cached = getExtraCache<ParsedTacticalSituationCard>('tactical-situation', input);
  if (cached.hit) return cached.value;

  const records = parseFlexibleRecords(input, ['态势', '战况', 'situation'], [
    'date',
    'location',
    'weather',
    '日期',
    '地点',
    '天气',
    ...SITUATION_EXPOSURE_MORALE_KEYS,
    ...STAFF_ADVICE_FIELD_KEYS,
  ]);
  const rec = records[0] ?? {};

  const date = pickStr(rec, ['date', '日期', '时间', '日程'], '当前战区日');
  const location = pickStr(rec, ['location', '地点', '战区', '位置', '基地'], '前沿战区');
  const weather = pickStr(rec, ['weather', '天气', '气象', '气候'], '平稳');

  const rawExposureVal = pickStr(
    rec,
    ['exposure', 'exposure_value', '暴露度', '当前暴露度', '暴露值'],
    '',
  );
  const rawExposureDelta = pickStr(
    rec,
    ['exposure_delta', 'exposureDelta', '暴露度变化', '暴露变化', '隐蔽度变化'],
    '',
  );
  const rawExposureLevel = pickStr(
    rec,
    ['exposure_level', 'exposureLevel', '暴露等级', '暴露档位', '暴露分级'],
    '',
  );
  const rawExposureFloor = pickStr(
    rec,
    ['exposure_floor', 'exposureFloor', '暴露底线', '常驻暴露底线'],
    '',
  );

  let exposureValue: number | undefined;
  if (rawExposureVal) {
    const m = rawExposureVal.match(/-?\d+(?:\.\d+)?/);
    if (m) exposureValue = Math.max(0, Math.min(10, Number(m[0])));
  }

  let exposureFloor: number | undefined;
  if (rawExposureFloor) {
    const m = rawExposureFloor.match(/-?\d+(?:\.\d+)?/);
    if (m) exposureFloor = Math.max(0, Math.min(9, Number(m[0])));
  }

  const exposureDelta = rawExposureDelta
    ? parseSignedDeltaStr(rawExposureDelta)
    : rawExposureVal
      ? String(exposureValue ?? rawExposureVal)
      : '0.0';

  const deltaNumMatch = exposureDelta.match(/([+-]?\d+(?:\.\d+)?)/);
  const deltaNum = deltaNumMatch ? Number(deltaNumMatch[1]) : 0;
  const inferredExpForLevel =
    exposureValue !== undefined
      ? exposureValue
      : deltaNum >= 2.0
        ? deltaNum
        : deltaNum > 0
          ? 2.0 + deltaNum
          : 0;
  const exposureLevel = normalizeExplicitExposureLevel(rawExposureLevel, inferredExpForLevel);

  // 民心解析（FD-36）
  const rawMorale = pickStr(rec, ['morale', 'morale_value', '民心', '民心指数', '当前民心'], '');
  const rawMoraleDelta = pickStr(
    rec,
    ['morale_delta', 'moraleDelta', '民心变化', '民心增量', '民心变动'],
    '',
  );
  const moraleTrend = pickStr(rec, ['morale_trend', 'moraleTrend', '民心趋势', '民心走向'], '');
  const moraleEvent = pickStr(
    rec,
    ['morale_event', 'moraleEvent', 'morale_note', '民心事件', '民心原因', '民心说明'],
    '',
  );

  let morale: number | undefined;
  if (rawMorale) {
    const m = rawMorale.match(/-?\d+(?:\.\d+)?/);
    if (m) {
      morale = Math.max(0, Math.min(10, Number(m[0])));
    }
  }
  const moraleDelta = rawMoraleDelta ? parseSignedDeltaStr(rawMoraleDelta) : '';
  const moraleDeltaNumMatch = moraleDelta.match(/([+-]?\d+(?:\.\d+)?)/);
  const moraleDeltaNum = moraleDeltaNumMatch ? Number(moraleDeltaNumMatch[1]) : 0;

  let moraleStage = '';
  const stageHintText = `${rawMorale} ${moraleTrend} ${moraleEvent}`;
  if (/万众一心/.test(stageHintText)) moraleStage = '万众一心';
  else if (/安居归心/.test(stageHintText)) moraleStage = '安居归心';
  else if (/观望顺从/.test(stageHintText)) moraleStage = '观望顺从';
  else if (/人心惶惶/.test(stageHintText)) moraleStage = '人心惶惶';
  else if (/沸反盈天/.test(stageHintText)) moraleStage = '沸反盈天';
  else if (morale !== undefined) {
    moraleStage = resolveMoraleStage(morale).stage;
  } else if (moraleDelta) {
    moraleStage = resolveMoraleStage(5.0 + moraleDeltaNum).stage;
  }

  const staffAdvice = extractStaffAdviceItems(rec);

  const reserved = new Set<string>([
    'date',
    '日期',
    '时间',
    '日程',
    'location',
    '地点',
    '战区',
    '位置',
    '基地',
    'weather',
    '天气',
    '气象',
    '气候',
    ...SITUATION_EXPOSURE_MORALE_KEYS,
    ...STAFF_ADVICE_FIELD_KEYS,
  ]);

  const fields: Array<{ label: string; value: string }> = [
    { label: '战区日期', value: date },
    { label: '当前坐标', value: location },
    { label: '气象条件', value: weather },
    { label: '暴露增量', value: `${exposureDelta} · ${exposureLevel}` },
  ];

  if (morale !== undefined || moraleDelta || moraleEvent) {
    const moraleFieldParts: string[] = [];
    if (morale !== undefined) moraleFieldParts.push(`${morale}/10`);
    if (moraleDelta) moraleFieldParts.push(`(${moraleDelta})`);
    if (moraleStage) moraleFieldParts.push(moraleStage);
    if (moraleEvent) moraleFieldParts.push(moraleEvent);
    fields.push({ label: '战区民心', value: moraleFieldParts.join(' · ') });
  }

  for (const [k, v] of Object.entries(rec)) {
    if (reserved.has(k) || v === undefined || v === null) continue;
    const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v).trim();
    if (valStr) fields.push({ label: k, value: valStr });
  }

  const moraleSummarySuffix =
    morale !== undefined
      ? ` · 民心:${morale}/10(${moraleStage})`
      : moraleDelta
        ? ` · 民心Δ${moraleDelta}`
        : '';
  const adviceSummarySuffix =
    staffAdvice.length > 0 ? ` · 参谋建议:${staffAdvice.length}条` : '';
  const compactSummary = `${date} · ${location} · 天气:${weather} · 暴露Δ${exposureDelta}(${exposureLevel.split(' ')[0]})${moraleSummarySuffix}${adviceSummarySuffix}`;

  return setExtraCache('tactical-situation', input, {
    date,
    location,
    weather,
    exposureDelta,
    exposureValue,
    exposureFloor,
    exposureLevel,
    morale,
    moraleDelta,
    moraleStage,
    moraleTrend,
    moraleEvent,
    fields,
    staffAdvice,
    compactSummary,
  });
}

export const parseTacticalSituationRaw = parseTacticalSituationPayload;

/**
 * 9. 解析 `<选项>` 载荷
 */
export function parseTacticalOptionsPayload(input: unknown): ParsedTacticalOptionsCard {
  const cached = getExtraCache<ParsedTacticalOptionsCard>('tactical-options', input);
  if (cached.hit) return cached.value;

  const records = parseFlexibleRecords(input, ['选项', 'options'], [
    'text',
    '文本',
    '内容',
    '描述',
    '行动',
  ]);

  const items: TacticalOptionCardItem[] = [];
  for (const rec of records) {
    const text = pickStr(rec, ['text', '文本', '内容', '描述', '行动', '指令', '名称'], '');
    if (!text) continue;
    const tag = pickStr(rec, ['tag', '标记', '标签', '类型', '分类'], '战术行动');
    const cost = pickStr(rec, ['cost', '代价', '消耗', '成本', '风险'], '');
    items.push({ text, tag, cost });
  }

  const preview = items
    .slice(0, 2)
    .map(i => `${i.tag}:${i.text.slice(0, 12)}`)
    .join(' / ');
  const compactSummary =
    items.length > 0
      ? `${preview}${items.length > 2 ? ` 等 ${items.length} 项决策` : ` 共 ${items.length} 项决策`}`
      : '战术决策待命';

  return setExtraCache('tactical-options', input, {
    items,
    compactSummary,
  });
}

function normalizeQuestCategory(raw: string): string {
  const s = raw.trim();
  if (!s) return '支线';
  if (/主线|main|core|primary/i.test(s)) return '主线';
  if (/紧急|urgent|emergency|flash|限时/i.test(s)) return '紧急';
  if (/日常|daily|routine/i.test(s)) return '日常';
  if (/指令|order|directive|command/i.test(s)) return '指令';
  if (/支线|side|sub|secondary/i.test(s)) return '支线';
  return s;
}

function normalizeQuestStatus(raw: string): string {
  const s = raw.trim();
  if (!s) return '进行中';
  if (/已完成|达成|完成|完结|交割|completed|done|success/i.test(s)) return '已完成';
  if (/已失败|失败|超时|溃败|failed|fail/i.test(s)) return '已失败';
  if (/已取消|取消|终止|放弃|aborted|cancelled|canceled/i.test(s)) return '已取消';
  if (/进行中|发布|接取|新增|推进|更新|active|in_progress|ongoing/i.test(s)) return '进行中';
  return s;
}

function extractQuestRewards(
  rawReward: unknown,
  rec: Record<string, unknown>,
): { rewardBadges: string[]; rewardSummary: string } {
  const badges: string[] = [];
  const pushBadge = (text: string) => {
    const cleaned = text.trim();
    if (cleaned && !badges.includes(cleaned)) {
      badges.push(cleaned);
    }
  };

  const formatAmountBadge = (label: string, val: unknown): void => {
    if (val === undefined || val === null || val === '') return;
    if (typeof val === 'number') {
      if (!Number.isFinite(val) || val === 0) return;
      pushBadge(`${label} ${val > 0 ? `+${val}` : `${val}`}`);
      return;
    }
    const str = String(val).trim();
    if (!str) return;
    const numMatch = str.match(/^[+＋]?\s*(-?\d+(?:\.\d+)?)$/);
    if (numMatch) {
      const n = Number(numMatch[1]);
      if (!Number.isFinite(n) || n === 0) return;
      pushBadge(`${label} ${n > 0 ? `+${n}` : `${n}`}`);
      return;
    }
    pushBadge(`${label} ${str}`);
  };

  const parseRewardString = (text: string): void => {
    const segments = text
      .split(/[,，、;；\r\n]+/)
      .map(s => s.trim())
      .filter(Boolean);
    for (const seg of segments) {
      const plusMatch = seg.match(/^([^\d+＋:：]+?)\s*[+＋]\s*(\d+(?:\.\d+)?)$/);
      if (plusMatch) {
        pushBadge(`${plusMatch[1].trim()} +${plusMatch[2]}`);
        continue;
      }
      const colonMatch = seg.match(/^([^\d+＋:：]+?)\s*[:：]\s*[+＋]?\s*(\d+(?:\.\d+)?)$/);
      if (colonMatch) {
        pushBadge(`${colonMatch[1].trim()} +${colonMatch[2]}`);
        continue;
      }
      const directMatch = seg.match(
        /^(资金|经费|机密点|战略机密点|情报点|钢材|水泥|高纯硅晶|军用柴油|航空燃油|高能电池|弹药|医疗包|口粮)\s*(\d+(?:\.\d+)?)$/,
      );
      if (directMatch) {
        pushBadge(`${directMatch[1].trim()} +${directMatch[2]}`);
        continue;
      }
      pushBadge(seg);
    }
  };

  const handleRewardValue = (val: unknown): void => {
    if (val === undefined || val === null) return;
    if (typeof val === 'string') {
      parseRewardString(val);
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') {
          parseRewardString(item);
        } else if (item && typeof item === 'object') {
          handleRewardValue(item);
        }
      }
      return;
    }
    if (typeof val === 'object') {
      const obj = val as Record<string, unknown>;
      const creditVal = obj.credits ?? obj['资金'] ?? obj['经费'] ?? obj['金钱'];
      if (creditVal !== undefined) {
        formatAmountBadge('资金', creditVal);
      }

      const intelVal =
        obj.intel_points ??
        obj.intelPoints ??
        obj.intel ??
        obj['机密点'] ??
        obj['战略机密点'] ??
        obj['情报点'];
      if (intelVal !== undefined) {
        formatAmountBadge('机密点', intelVal);
      }

      const resVal = obj.resources ?? obj['资源'] ?? obj['物资'];
      if (resVal && typeof resVal === 'object' && !Array.isArray(resVal)) {
        for (const [rk, rv] of Object.entries(resVal as Record<string, unknown>)) {
          if (rv && typeof rv === 'object' && !Array.isArray(rv)) {
            for (const [subK, subV] of Object.entries(rv as Record<string, unknown>)) {
              formatAmountBadge(subK.trim(), subV);
            }
          } else {
            formatAmountBadge(rk.trim(), rv);
          }
        }
      }

      const itemsVal =
        obj.items ?? obj.loot ?? obj['战利品'] ?? obj['物品'] ?? obj['权限'] ?? obj['特殊奖励'];
      if (Array.isArray(itemsVal)) {
        for (const it of itemsVal) {
          if (it !== undefined && it !== null) {
            pushBadge(String(it));
          }
        }
      } else if (typeof itemsVal === 'string') {
        parseRewardString(itemsVal);
      }

      // FD-30 Tier S: 解锁阵营 / unlock_factions
      const unlockFactionsVal =
        obj.unlock_factions ?? obj.unlockFactions ?? obj['解锁阵营'] ?? obj['阵营解锁'];
      if (unlockFactionsVal !== undefined && unlockFactionsVal !== null) {
        const facList = Array.isArray(unlockFactionsVal)
          ? unlockFactionsVal
          : typeof unlockFactionsVal === 'string'
            ? unlockFactionsVal.split(/[,，、;；]+/)
            : [unlockFactionsVal];
        for (const f of facList) {
          if (!f) continue;
          const fName =
            typeof f === 'object'
              ? pickStr(f as Record<string, unknown>, ['name', 'faction', '名称', '阵营'], '')
              : String(f).trim();
          if (fName) {
            pushBadge(`🎖️ 阵营启封: ${fName}`);
          }
        }
      }

      // FD-30 Tier A: 解锁蓝图 / 解锁单位 / 新单位 / unlock_units
      const unlockUnitsVal =
        obj.unlock_units ??
        obj.unlockUnits ??
        obj['解锁蓝图'] ??
        obj['解锁单位'] ??
        obj['新单位'] ??
        obj['蓝图解锁'];
      if (unlockUnitsVal !== undefined && unlockUnitsVal !== null) {
        const unitList = Array.isArray(unlockUnitsVal) ? unlockUnitsVal : [unlockUnitsVal];
        for (const u of unitList) {
          if (!u) continue;
          if (typeof u === 'string') {
            const trimmed = u.trim();
            if (!trimmed) continue;
            const colonIdx = trimmed.search(/[:：]/);
            if (colonIdx > 0) {
              const prod = trimmed.slice(0, colonIdx).trim();
              const uName = trimmed.slice(colonIdx + 1).trim();
              pushBadge(`🏭 ${prod}解锁: ${uName}`);
            } else {
              const inferredProd = /步兵|工程师|士兵|特工|狙击|动员兵|兵/.test(trimmed) && !/车|坦克|艇|船|机/.test(trimmed)
                ? '兵营'
                : '战车工厂';
              pushBadge(`🏭 ${inferredProd}解锁: ${trimmed}`);
            }
          } else if (typeof u === 'object') {
            const uRec = u as Record<string, unknown>;
            const uName = pickStr(
              uRec,
              ['name', 'unit', 'title', '名称', '单位', '型号', '蓝图'],
              '',
            );
            if (!uName) continue;
            let producer = pickStr(
              uRec,
              ['producer', 'building', 'facility', '生产建筑', '产线', '母体', '建筑'],
              '',
            );
            if (!producer) {
              const kind = pickStr(
                uRec,
                ['kind', 'category', 'type', '类别', '类型', '分类'],
                '',
              );
              if (/人员|步兵|士兵|特工|infantry/i.test(kind)) {
                producer = '兵营';
              } else if (/空军|航空|战机|飞行器|air/i.test(kind)) {
                producer = '空军指挥部';
              } else if (/海军|舰船|潜艇|naval/i.test(kind)) {
                producer = '海军造船厂';
              } else if (/装备|武器|单兵|gear|equip/i.test(kind)) {
                producer = '个人装备制造所';
              } else {
                producer = '战车工厂';
              }
            }
            pushBadge(`🏭 ${producer}解锁: ${uName}`);
          }
        }
      }

      // FD-30 Tier B: 收编兵力 / troops
      const troopsVal =
        obj.troops ?? obj['收编兵力'] ?? obj['奖励兵力'] ?? obj['补充兵力'];
      if (troopsVal !== undefined && troopsVal !== null) {
        if (typeof troopsVal === 'string') {
          const segments = troopsVal.split(/[,，、;；]+/).map(s => s.trim()).filter(Boolean);
          for (const seg of segments) {
            const m = seg.match(/^(.+?)\s*(?:[:：x×*]\s*|[+＋]\s*)(\d+)$/);
            if (m) {
              pushBadge(`🪖 兵营整备: ${m[1].trim()} +${m[2]}`);
            } else {
              pushBadge(`🪖 兵营整备: ${seg}`);
            }
          }
        } else if (Array.isArray(troopsVal)) {
          for (const t of troopsVal) {
            if (!t) continue;
            if (typeof t === 'string') {
              const m = t.trim().match(/^(.+?)\s*(?:[:：x×*]\s*|[+＋]\s*)(\d+)$/);
              if (m) {
                pushBadge(`🪖 兵营整备: ${m[1].trim()} +${m[2]}`);
              } else {
                pushBadge(`🪖 兵营整备: ${t.trim()}`);
              }
            } else if (typeof t === 'object') {
              const tRec = t as Record<string, unknown>;
              const tName = pickStr(tRec, ['name', 'unit', '名称', '兵种', '单位'], '');
              const tCount = tRec.count ?? tRec.qty ?? tRec['数量'] ?? tRec['人数'] ?? 1;
              if (tName) {
                const n = Number(String(tCount).replace(/^[+＋x×]/, ''));
                const suffix = Number.isFinite(n) && n > 0 ? ` +${n}` : '';
                pushBadge(`🪖 兵营整备: ${tName}${suffix}`);
              }
            }
          }
        } else if (typeof troopsVal === 'object') {
          for (const [tk, tv] of Object.entries(troopsVal as Record<string, unknown>)) {
            if (tv === undefined || tv === null) continue;
            const n = Number(String(tv).replace(/^[+＋x×]/, ''));
            const suffix = Number.isFinite(n) && n > 0 ? ` +${n}` : ` ${String(tv).trim()}`;
            pushBadge(`🪖 兵营整备: ${tk.trim()}${suffix}`);
          }
        }
      }

      // FD-30 Tier B: 缴获载具 / 奖励载具 / vehicles
      const vehiclesVal =
        obj.vehicles ?? obj['缴获载具'] ?? obj['奖励载具'] ?? obj['收编载具'];
      if (vehiclesVal !== undefined && vehiclesVal !== null) {
        if (typeof vehiclesVal === 'string') {
          const segments = vehiclesVal.split(/[,，、;；]+/).map(s => s.trim()).filter(Boolean);
          for (const seg of segments) {
            pushBadge(`🚜 车厂整备: ${seg}`);
          }
        } else if (Array.isArray(vehiclesVal)) {
          for (const v of vehiclesVal) {
            if (!v) continue;
            if (typeof v === 'string') {
              pushBadge(`🚜 车厂整备: ${v.trim()}`);
            } else if (typeof v === 'object') {
              const vRec = v as Record<string, unknown>;
              const vName = pickStr(vRec, ['name', 'unit', 'vehicle', '名称', '载具', '型号'], '');
              const vCount = vRec.count ?? vRec.qty ?? vRec['数量'];
              if (vName) {
                const n = vCount !== undefined ? Number(String(vCount).replace(/^[+＋x×]/, '')) : 1;
                const suffix = Number.isFinite(n) && n > 1 ? ` +${n}` : '';
                pushBadge(`🚜 车厂整备: ${vName}${suffix}`);
              }
            }
          }
        } else if (typeof vehiclesVal === 'object') {
          for (const [vk, vv] of Object.entries(vehiclesVal as Record<string, unknown>)) {
            if (vv === undefined || vv === null) continue;
            const n = Number(String(vv).replace(/^[+＋x×]/, ''));
            const suffix = Number.isFinite(n) && n > 1 ? ` +${n}` : '';
            pushBadge(`🚜 车厂整备: ${vk.trim()}${suffix}`);
          }
        }
      }

      // FD-30: 资金链 / chains
      const chainsVal = obj.chains ?? obj['资金链'] ?? obj['收入链'];
      if (chainsVal !== undefined && chainsVal !== null) {
        const chainList = Array.isArray(chainsVal) ? chainsVal : [chainsVal];
        for (const c of chainList) {
          if (!c) continue;
          if (typeof c === 'string') {
            pushBadge(`💰 资金链: ${c.trim()}`);
          } else if (typeof c === 'object') {
            const cRec = c as Record<string, unknown>;
            const cName = pickStr(cRec, ['name', 'title', '名称', '项目', '资金链'], '');
            const rateRaw =
              cRec.rate_daily ?? cRec.daily ?? cRec.rate ?? cRec['日收益'] ?? cRec['每日收益'] ?? cRec['收益'];
            if (cName) {
              if (rateRaw !== undefined && rateRaw !== null && String(rateRaw).trim() !== '') {
                const cleanRate = String(rateRaw).trim().replace(/^[+＋]/, '');
                pushBadge(`💰 资金链: ${cName}(+${cleanRate}/日)`);
              } else {
                pushBadge(`💰 资金链: ${cName}`);
              }
            } else {
              for (const [ck, cv] of Object.entries(cRec)) {
                if (cv === undefined || cv === null) continue;
                const cleanRate = String(cv).trim().replace(/^[+＋]/, '');
                pushBadge(`💰 资金链: ${ck.trim()}(+${cleanRate}/日)`);
              }
            }
          }
        }
      }

      // FD-30: 协议线索 / 解锁协议 / protocols
      const protocolsVal =
        obj.protocols ?? obj['协议线索'] ?? obj['解锁协议'] ?? obj['战略协议'];
      if (protocolsVal !== undefined && protocolsVal !== null) {
        const protoList = Array.isArray(protocolsVal)
          ? protocolsVal
          : typeof protocolsVal === 'string'
            ? protocolsVal.split(/[,，、;；]+/)
            : [protocolsVal];
        for (const p of protoList) {
          if (!p) continue;
          const pName =
            typeof p === 'object'
              ? pickStr(p as Record<string, unknown>, ['name', 'protocol', '名称', '协议'], '')
              : String(p).trim();
          if (pName) {
            pushBadge(`📡 协议线索: ${pName}`);
          }
        }
      }

      // FD-30: 势力 / factions
      const factionsVal =
        obj.factions ?? obj['势力'] ?? obj['势力关系'] ?? obj['势力态度'];
      if (factionsVal !== undefined && factionsVal !== null) {
        const facList = Array.isArray(factionsVal) ? factionsVal : [factionsVal];
        for (const f of facList) {
          if (!f) continue;
          if (typeof f === 'string') {
            pushBadge(`🤝 势力: ${f.trim()}`);
          } else if (typeof f === 'object') {
            const fRec = f as Record<string, unknown>;
            const fName = pickStr(fRec, ['name', 'faction', '名称', '势力', '组织'], '');
            const attitude = pickStr(
              fRec,
              ['attitude', 'stance', 'status', '态度', '关系', '立场'],
              '',
            );
            if (fName) {
              pushBadge(attitude ? `🤝 势力: ${fName}(${attitude})` : `🤝 势力: ${fName}`);
            } else {
              for (const [fk, fv] of Object.entries(fRec)) {
                if (fv === undefined || fv === null) continue;
                pushBadge(`🤝 势力: ${fk.trim()}(${String(fv).trim()})`);
              }
            }
          }
        }
      }

      // FD-30: 钱袋 / 外币 / wallet
      const walletVal = obj.wallet ?? obj['钱袋'] ?? obj['外币'] ?? obj['本地货币'];
      if (walletVal !== undefined && walletVal !== null) {
        if (typeof walletVal === 'string') {
          const segments = walletVal.split(/[,，、;；]+/).map(s => s.trim()).filter(Boolean);
          for (const seg of segments) {
            const m = seg.match(/^([^\d+＋:：]+?)\s*[:：]?\s*[+＋]?\s*(\d+(?:\.\d+)?)$/);
            if (m) {
              pushBadge(`🪙 ${m[1].trim()} +${m[2]}`);
            } else {
              pushBadge(`🪙 ${seg}`);
            }
          }
        } else if (Array.isArray(walletVal)) {
          for (const w of walletVal) {
            if (!w || typeof w !== 'object') continue;
            const wRec = w as Record<string, unknown>;
            const curr = pickStr(wRec, ['currency', 'name', '币种', '名称'], '');
            const amt = wRec.amount ?? wRec.value ?? wRec['数量'] ?? wRec['金额'];
            if (curr && amt !== undefined) {
              const cleanAmt = String(amt).trim().replace(/^[+＋]/, '');
              pushBadge(`🪙 ${curr} +${cleanAmt}`);
            }
          }
        } else if (typeof walletVal === 'object') {
          for (const [wk, wv] of Object.entries(walletVal as Record<string, unknown>)) {
            if (wv === undefined || wv === null) continue;
            const cleanAmt = String(wv).trim().replace(/^[+＋]/, '');
            pushBadge(`🪙 ${wk.trim()} +${cleanAmt}`);
          }
        }
      }

      // FD-30: 机娘奖励 / girl_rewards
      const girlRewardsVal =
        obj.girl_rewards ?? obj.girlRewards ?? obj['机娘奖励'] ?? obj['机娘'];
      if (girlRewardsVal !== undefined && girlRewardsVal !== null) {
        const girlList = Array.isArray(girlRewardsVal) ? girlRewardsVal : [girlRewardsVal];
        for (const g of girlList) {
          if (!g) continue;
          if (typeof g === 'string') {
            pushBadge(`💖 ${g.trim()}`);
          } else if (typeof g === 'object') {
            const gRec = g as Record<string, unknown>;
            const gName = pickStr(gRec, ['name', 'girl', '名称', '机娘', '姓名', '对象'], '');
            if (!gName) continue;
            const parts: string[] = [];
            const affRaw =
              gRec.affection_delta ?? gRec.affection ?? gRec['好感变化'] ?? gRec['好感'] ?? gRec['好感度'];
            if (affRaw !== undefined && affRaw !== null && String(affRaw).trim() !== '') {
              const n = Number(String(affRaw).trim().replace(/^[+＋]/, ''));
              if (Number.isFinite(n) && n !== 0) {
                parts.push(`好感${n > 0 ? `+${n}` : `${n}`}`);
              } else {
                parts.push(`好感${String(affRaw).trim()}`);
              }
            }
            const obeRaw =
              gRec.obedience_delta ?? gRec.obedience ?? gRec['服从变化'] ?? gRec['服从'] ?? gRec['服从度'];
            if (obeRaw !== undefined && obeRaw !== null && String(obeRaw).trim() !== '') {
              const n = Number(String(obeRaw).trim().replace(/^[+＋]/, ''));
              if (Number.isFinite(n) && n !== 0) {
                parts.push(`服从${n > 0 ? `+${n}` : `${n}`}`);
              } else {
                parts.push(`服从${String(obeRaw).trim()}`);
              }
            }
            const traitsRaw =
              gRec.traits ?? gRec.trait ?? gRec['特质'] ?? gRec['新特质'] ?? gRec['词条'];
            if (Array.isArray(traitsRaw)) {
              for (const tr of traitsRaw) {
                const trStr = String(tr ?? '').trim().replace(/^\[|\]$/g, '');
                if (trStr) parts.push(`[${trStr}]`);
              }
            } else if (typeof traitsRaw === 'string' && traitsRaw.trim()) {
              for (const tr of traitsRaw.split(/[,，、;；]+/)) {
                const trStr = tr.trim().replace(/^\[|\]$/g, '');
                if (trStr) parts.push(`[${trStr}]`);
              }
            }
            pushBadge(parts.length > 0 ? `💖 ${gName}: ${parts.join(' · ')}` : `💖 ${gName}`);
          }
        }
      }

      // FD-30: 科研助力 / tech_boost
      const techBoostVal =
        obj.tech_boost ?? obj.techBoost ?? obj['科研助力'] ?? obj['科技加速'] ?? obj['研发助力'];
      if (techBoostVal !== undefined && techBoostVal !== null) {
        const boostList = Array.isArray(techBoostVal) ? techBoostVal : [techBoostVal];
        for (const tb of boostList) {
          if (!tb) continue;
          if (typeof tb === 'string') {
            pushBadge(`🔬 科研助力: ${tb.trim()}`);
          } else if (typeof tb === 'object') {
            const tbRec = tb as Record<string, unknown>;
            const tbName = pickStr(
              tbRec,
              ['name', 'project', 'tech', 'title', '项目', '科技', '名称', '目标'],
              '',
            );
            const deltaRaw =
              tbRec.progress_delta ??
              tbRec.progress ??
              tbRec.delta ??
              tbRec.boost ??
              tbRec['进度变化'] ??
              tbRec['进度'] ??
              tbRec['加速'] ??
              tbRec['增量'];
            if (tbName) {
              if (deltaRaw !== undefined && deltaRaw !== null && String(deltaRaw).trim() !== '') {
                const cleanDelta = String(deltaRaw).trim().replace(/^[+＋]/, '').replace(/%$/, '');
                pushBadge(`🔬 科研助力: ${tbName} +${cleanDelta}%`);
              } else {
                pushBadge(`🔬 科研助力: ${tbName}`);
              }
            } else {
              for (const [tk, tv] of Object.entries(tbRec)) {
                if (tv === undefined || tv === null) continue;
                const cleanDelta = String(tv).trim().replace(/^[+＋]/, '').replace(/%$/, '');
                pushBadge(`🔬 科研助力: ${tk.trim()} +${cleanDelta}%`);
              }
            }
          }
        }
      }

      const textVal = obj.text ?? obj['说明'] ?? obj['备注'] ?? obj['描述'];
      if (typeof textVal === 'string' && textVal.trim()) {
        parseRewardString(textVal);
      }

      const reservedKeys = new Set([
        'credits',
        '资金',
        '经费',
        '金钱',
        'intel_points',
        'intelPoints',
        'intel',
        '机密点',
        '战略机密点',
        '情报点',
        'resources',
        '资源',
        '物资',
        'items',
        'loot',
        '战利品',
        '物品',
        '权限',
        '特殊奖励',
        'unlock_factions',
        'unlockFactions',
        '解锁阵营',
        '阵营解锁',
        'unlock_units',
        'unlockUnits',
        '解锁蓝图',
        '解锁单位',
        '新单位',
        '蓝图解锁',
        'troops',
        '收编兵力',
        '奖励兵力',
        '补充兵力',
        'vehicles',
        '缴获载具',
        '奖励载具',
        '收编载具',
        'chains',
        '资金链',
        '收入链',
        'protocols',
        '协议线索',
        '解锁协议',
        '战略协议',
        'factions',
        '势力',
        '势力关系',
        '势力态度',
        'wallet',
        '钱袋',
        '外币',
        '本地货币',
        'girl_rewards',
        'girlRewards',
        '机娘奖励',
        '机娘',
        'tech_boost',
        'techBoost',
        '科研助力',
        '科技加速',
        '研发助力',
        'text',
        '说明',
        '备注',
        '描述',
        'series',
        'chain',
        'quest_chain',
        'arc',
        '系列',
        '任务链',
        '系列任务',
        '所属系列',
        '战役',
        '篇章',
        'chain_step',
        'step_index',
        'chain_progress',
        '环数',
        '阶段环',
        '系列进度',
        '幕次',
        '环',
        '章节',
        'next_quest',
        'next_step',
        'followup_quest',
        '后续任务',
        '下一环',
        '后续线索',
        '下一阶段任务',
        '演进任务',
      ]);
      for (const [k, v] of Object.entries(obj)) {
        if (reservedKeys.has(k) || v === undefined || v === null) continue;
        if (typeof v === 'number' || typeof v === 'string') {
          formatAmountBadge(k.trim(), v);
        }
      }
    }
  };

  const targetReward =
    rawReward ?? rec['奖励'] ?? rec['悬赏'] ?? rec.rewards ?? rec.reward;
  if (targetReward !== undefined && targetReward !== null) {
    handleRewardValue(targetReward);
  }
  handleRewardValue({
    credits: rec.credits ?? rec['资金'],
    intel_points: rec.intel_points ?? rec['机密点'],
    resources: rec.resources ?? rec['资源'],
    items: rec.items ?? rec['战利品'],
    unlock_factions: rec.unlock_factions ?? rec.unlockFactions ?? rec['解锁阵营'] ?? rec['阵营解锁'],
    unlock_units:
      rec.unlock_units ?? rec.unlockUnits ?? rec['解锁蓝图'] ?? rec['解锁单位'] ?? rec['新单位'],
    troops: rec.troops ?? rec['收编兵力'] ?? rec['奖励兵力'],
    vehicles: rec.vehicles ?? rec['缴获载具'] ?? rec['奖励载具'],
    chains: rec.chains ?? rec['资金链'],
    protocols: rec.protocols ?? rec['协议线索'] ?? rec['解锁协议'],
    factions: rec.factions ?? rec['势力'],
    wallet: rec.wallet ?? rec['钱袋'] ?? rec['外币'],
    girl_rewards: rec.girl_rewards ?? rec.girlRewards ?? rec['机娘奖励'],
    tech_boost: rec.tech_boost ?? rec.techBoost ?? rec['科研助力'],
  });

  return {
    rewardBadges: badges,
    rewardSummary: badges.join(' · '),
  };
}

/**
 * 10. 解析 `<任务>` 载荷（FD-29）
 */
export function parseTacticalQuestPayload(input: unknown): ParsedTacticalQuestCard {
  const cached = getExtraCache<ParsedTacticalQuestCard>('tactical-quest', input);
  if (cached.hit) return cached.value;

  const PRIMARY_QUEST_KEYS = ['name', 'title', '名称', '任务名', '标题', '任务'];
  const records = parseFlexibleRecords(input, ['任务', 'quest', 'quests'], PRIMARY_QUEST_KEYS);

  const items: TacticalQuestCardItem[] = [];
  for (const rec of records) {
    const name = pickStr(rec, PRIMARY_QUEST_KEYS, '');
    if (!name) continue;
    const category = normalizeQuestCategory(
      pickStr(rec, ['category', 'type', 'kind', '类别', '类型', '分类', '级别'], '支线'),
    );
    const status = normalizeQuestStatus(
      pickStr(rec, ['status', 'state', '状态', '阶段', '结果'], '进行中'),
    );
    const issuer = pickStr(
      rec,
      ['issuer', 'sender', 'from', '发包方', '发布方', '委托人', '委托方', '下达方'],
      '',
    );
    const series = pickStr(
      rec,
      ['series', 'chain', 'quest_chain', 'arc', '系列', '任务链', '系列任务', '所属系列', '战役', '篇章'],
      '',
    );
    const chainStep = pickStr(
      rec,
      ['chain_step', 'step_index', 'chain_progress', '环数', '阶段环', '系列进度', '幕次', '环', '章节'],
      '',
    );
    const nextQuest = pickStr(
      rec,
      ['next_quest', 'next_step', 'followup_quest', '后续任务', '下一环', '后续线索', '下一阶段任务', '演进任务'],
      '',
    );
    const progress = pickStr(rec, ['progress', 'step', 'stage', '进度', '当前进度', '阶段'], '');
    const note = pickStr(
      rec,
      ['note', 'summary', 'point', 'brief', '要点', '任务要点', '备注', '简述', '目标'],
      '',
    );
    const detail = pickStr(
      rec,
      ['detail', 'desc', 'description', 'content', '详情', '任务详情', '描述', '说明', '背景'],
      '',
    );

    const { rewardBadges, rewardSummary } = extractQuestRewards(undefined, rec);

    items.push({
      name,
      category,
      status,
      issuer,
      series,
      chainStep,
      nextQuest,
      progress,
      note,
      detail,
      rewardSummary,
      rewardBadges,
    });
  }

  if (items.length === 0 && typeof input === 'string') {
    const cleaned = stripOuterTag(input, ['任务', 'quest', 'quests']);
    if (cleaned) {
      const firstLine = cleaned
        .split(/\r?\n/)
        .map(l => l.replace(/^[-*•]\s+/, '').trim())
        .find(Boolean);
      if (firstLine) {
        items.push({
          name: firstLine,
          category: '支线',
          status: '进行中',
          issuer: '',
          series: '',
          chainStep: '',
          nextQuest: '',
          progress: '',
          note: '',
          detail: '',
          rewardSummary: '',
          rewardBadges: [],
        });
      }
    }
  }

  const preview = items
    .slice(0, 2)
    .map(i => `[${i.category}] ${i.name}(${i.status})`)
    .join(' / ');
  const compactSummary =
    items.length > 0 ? `${preview} · 共 ${items.length} 项任务` : '暂无作战任务指令';

  return setExtraCache('tactical-quest', input, {
    items,
    compactSummary,
  });
}

function pickFromRecOrParams(
  rec: Record<string, unknown>,
  paramsObj: Record<string, unknown>,
  keys: string[],
  fallback = '',
): string {
  const fromRec = pickStr(rec, keys, '');
  if (fromRec) return fromRec;
  return pickStr(paramsObj, keys, fallback);
}

function normalizeExpansionKind(
  rawKind: string,
  hasNpcSpecificFields: boolean,
): string {
  const s = rawKind.trim();
  if (/^(人物|NPC|npc|重要人物|角色|人物档案|NPC档案|核心人物|剧情人物)$/i.test(s) || /人物|NPC|角色/i.test(s)) {
    return '人物';
  }
  if (/^(人员|步兵|兵种|作战编制|士兵|infantry)$/i.test(s)) return '人员';
  if (/建筑|设施|基建|防御|building/i.test(s)) return '建筑';
  if (/载具|战车|装甲|坦克|飞行器|舰艇|vehicle/i.test(s)) return '载具';
  if (/装备|武器|单兵装备|插件|equipment|gear/i.test(s)) return '装备';
  if (/科技|技术|研究|学说|tech/i.test(s)) return '科技';
  if (/地点|地区|区域|场所|聚落|据点|地标|location|place|site/i.test(s)) return '地点';
  if (/阵营|势力|组织|派系|集团|faction/i.test(s)) return '阵营';
  if (!s && hasNpcSpecificFields) return '人物';
  return s || '科技';
}

function normalizeNpcAttitude(raw: string): string {
  const s = raw.trim();
  if (!s) return '中立';
  if (/效忠|死忠|绝对忠诚|誓死/i.test(s)) return '效忠';
  if (/友善|友好|亲近|敬重|信赖/i.test(s)) return '友善';
  if (/合作|盟友|互利|协定/i.test(s)) return '合作';
  if (/警觉|戒备|怀疑|猜忌|警惕|防备/i.test(s)) return '警觉';
  if (/敌对|敌意|仇视|死敌|敌视|交战/i.test(s)) return '敌对';
  if (/中立|观望|待甄别|未知/i.test(s)) return '中立';
  return s;
}

function mapAttitudeToDefaultTrust(attitude: string): number {
  switch (attitude) {
    case '效忠':
      return 90;
    case '友善':
      return 75;
    case '合作':
      return 65;
    case '警觉':
      return 30;
    case '敌对':
      return 10;
    case '中立':
    default:
      return 50;
  }
}

/**
 * 11. 解析 `<扩展档案>` 载荷（FD-32：支持 `类别: 人物` 立体 NPC 档案与常规扩展设定档案双分支）
 */
export function parseExpansionDossierPayload(rawContent: unknown): ParsedExpansionDossierCard {
  const cached = getExtraCache<ParsedExpansionDossierCard>('expansion-dossier', rawContent);
  if (cached.hit) return cached.value;

  const PRIMARY_EXP_KEYS = ['name', 'title', 'codename', '名称', '姓名', '代号', '目标', '条目'];
  const records = parseFlexibleRecords(
    rawContent,
    ['扩展档案', 'expansion', 'expansions', 'intel'],
    PRIMARY_EXP_KEYS,
  );

  const items: ParsedExpansionDossierItem[] = [];

  for (const rec of records) {
    const rawParams = rec.params ?? rec['参数'] ?? rec['属性'] ?? rec['数据'];
    const paramsObj: Record<string, unknown> =
      rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)
        ? (rawParams as Record<string, unknown>)
        : {};

    const name = pickFromRecOrParams(
      rec,
      paramsObj,
      ['name', '名称', '姓名', '条目', '目标', '代号'],
      '',
    );
    if (!name) continue;

    const title = pickFromRecOrParams(
      rec,
      paramsObj,
      ['title', 'callsign', '代号', '头衔', '称号', '绰号'],
      '',
    );
    const faction = pickFromRecOrParams(
      rec,
      paramsObj,
      ['faction', 'affiliation', 'org', '所属势力', '势力', '阵营', '所属阵营', '归属', '所属'],
      '',
    );
    const role = pickFromRecOrParams(
      rec,
      paramsObj,
      ['role', 'duty', 'position', '身份', '职务', '职位', '开局职务', '席位任命'],
      '',
    );
    const rawAttitude = pickFromRecOrParams(
      rec,
      paramsObj,
      ['attitude', 'stance', 'relation', '态度', '立场', '关系', '倾向'],
      '',
    );
    const rawTrust =
      rec.trust ??
      rec['信任度'] ??
      rec['好感'] ??
      rec['好感度'] ??
      rec['信任'] ??
      paramsObj.trust ??
      paramsObj['信任度'] ??
      paramsObj['好感'] ??
      paramsObj['好感度'] ??
      paramsObj['信任'];
    const rawTrustDelta = pickFromRecOrParams(
      rec,
      paramsObj,
      ['trust_delta', 'trustDelta', '信任变化', '好感变化', '信任增量'],
      '',
    );
    const status = pickFromRecOrParams(
      rec,
      paramsObj,
      ['status', 'location', '状态', '当前状态', '驻地', '所在地', '动向'],
      '',
    );
    const appearance = pickFromRecOrParams(
      rec,
      paramsObj,
      ['appearance', '外貌特征', '外貌', '外观', '着装', '外貌着装'],
      '',
    );
    const personality = pickFromRecOrParams(
      rec,
      paramsObj,
      ['personality', '性格与口吻', '性格', '口吻', '言行特征'],
      '',
    );
    const skills = pickFromRecOrParams(
      rec,
      paramsObj,
      ['skills', 'ability', '能力', '专长', '技能', '特长', '能力专长'],
      '',
    );
    const background = pickFromRecOrParams(
      rec,
      paramsObj,
      ['background', 'history', '背景', '履历', '渊源', '随行渊源', '背景履历'],
      '',
    );
    const recentNote = pickFromRecOrParams(
      rec,
      paramsObj,
      ['recent_note', 'recentNote', '近期交集', '事迹', '备注', '近期动向'],
      '',
    );

    const hasNpcSignals = Boolean(
      title ||
        role ||
        rawAttitude ||
        rawTrust !== undefined ||
        rawTrustDelta ||
        appearance ||
        personality ||
        recentNote,
    );

    const rawKind = pickFromRecOrParams(
      rec,
      paramsObj,
      ['kind', 'category', 'type', '类别', '分类', '类型', '种类', '归类'],
      '',
    );
    const kind = normalizeExpansionKind(rawKind, hasNpcSignals);

    const desc = pickFromRecOrParams(
      rec,
      paramsObj,
      ['desc', 'summary', 'bio', 'intro', '简介', '摘要', '概述', '简述', '情报摘要'],
      '',
    );
    const detail = pickFromRecOrParams(
      rec,
      paramsObj,
      ['detail', 'content', 'lore', 'setting', '设定', '详情', '详细设定', '正文', '说明', '描述'],
      '',
    );

    const rawKeys =
      rec.keys ??
      rec['触发词'] ??
      rec['关键词'] ??
      rec['标签'] ??
      paramsObj.keys ??
      paramsObj['触发词'] ??
      paramsObj['关键词'];
    const keys: string[] = Array.isArray(rawKeys)
      ? rawKeys.map(k => String(k).trim()).filter(Boolean)
      : typeof rawKeys === 'string'
        ? rawKeys
            .split(/[,，、;；\s]+/)
            .map(s => s.trim())
            .filter(Boolean)
        : [];

    const attitude = kind === '人物' ? normalizeNpcAttitude(rawAttitude) : rawAttitude.trim();

    let trust: number | undefined;
    if (rawTrust !== undefined && rawTrust !== null && String(rawTrust).trim() !== '') {
      const m = String(rawTrust).match(/-?\d+(?:\.\d+)?/);
      if (m) {
        trust = Math.max(0, Math.min(100, Math.round(Number(m[0]))));
      }
    } else if (kind === '人物') {
      trust = mapAttitudeToDefaultTrust(attitude);
    }

    let trustDelta = '';
    if (rawTrustDelta) {
      const n = Number(rawTrustDelta.replace(/^[+＋]/, ''));
      if (Number.isFinite(n) && n !== 0) {
        trustDelta = n > 0 ? `+${n}` : `${n}`;
      } else {
        trustDelta = rawTrustDelta;
      }
    }

    const params: Record<string, string> = {};
    for (const [pk, pv] of Object.entries(paramsObj)) {
      if (pv !== undefined && pv !== null && typeof pv !== 'object') {
        const s = String(pv).trim();
        if (s) params[pk.trim()] = s;
      }
    }

    const topReserved = new Set([
      'name',
      '名称',
      '姓名',
      '条目',
      '目标',
      'kind',
      'category',
      'type',
      '类别',
      '分类',
      '类型',
      'desc',
      'summary',
      'bio',
      'intro',
      '简介',
      '摘要',
      '概述',
      '简述',
      '情报摘要',
      'detail',
      'content',
      'lore',
      'setting',
      '设定',
      '详情',
      '详细设定',
      '正文',
      '说明',
      '描述',
      'params',
      '参数',
      '属性',
      '数据',
      'keys',
      '触发词',
      '关键词',
      '标签',
    ]);
    for (const [rk, rv] of Object.entries(rec)) {
      if (topReserved.has(rk) || rv === undefined || rv === null || typeof rv === 'object') continue;
      const s = String(rv).trim();
      if (s && !(rk in params)) {
        params[rk.trim()] = s;
      }
    }

    items.push({
      name,
      kind,
      desc: desc || (kind === '人物' ? '战区重要人物建档记录。' : '战区扩展设定建档记录。'),
      detail,
      params,
      keys,
      title: title === name ? '' : title,
      faction: faction || (kind === '人物' ? '独立/待甄别' : ''),
      role,
      attitude,
      trust,
      trustDelta,
      status,
      appearance,
      personality,
      skills,
      background,
      recentNote,
    });
  }

  if (items.length === 0) {
    items.push({
      name: '战区扩展建档卷宗',
      kind: '其他',
      desc: '扩展档案已同步录入战区中央档案库。',
      detail: '',
      params: {},
      keys: [],
      title: '',
      faction: '',
      role: '',
      attitude: '',
      trust: undefined,
      trustDelta: '',
      status: '',
      appearance: '',
      personality: '',
      skills: '',
      background: '',
      recentNote: '',
    });
  }

  const hasNpc = items.some(i => i.kind === '人物');
  const hasOther = items.some(i => i.kind !== '人物');
  const first = items[0];
  const firstTag =
    first.kind === '人物'
      ? `[人物] ${first.name}${first.faction ? ` · ${first.faction}` : ''}${first.attitude ? `(${first.attitude})` : ''}`
      : `[${first.kind}] ${first.name}`;
  const compactSummary = `${firstTag}${items.length > 1 ? ` 等 ${items.length} 份档案` : ''}`;

  return setExtraCache('expansion-dossier', rawContent, {
    items,
    hasNpc,
    hasOther,
    compactSummary,
  });
}

function normalizeIntelSrcKind(
  rawKindOrSrc: string,
  scope: 'tactical' | 'world',
): TacticalIntelSrcKind {
  const s = rawKindOrSrc.trim();
  if (/雷达|卫星|预警|天基|侦察机|radar|satellite/i.test(s)) return '雷达侦察';
  if (/渗透|内线|间谍|特工|密报|卧底|眼线|spy|agent|insider/i.test(s)) return '渗透内线';
  if (/暗网|黑市|流言|传闻|商团|匿名|darknet|rumor/i.test(s)) return '暗网流言';
  if (/电讯|通信|通讯|截获|破译|监听|心灵感应|频段|signal|radio|intercept/i.test(s)) {
    return '电讯截获';
  }
  if (/目视|巡逻|侦察兵|战俘|审讯|前线|观察|哨所|visual|patrol/i.test(s)) return '前线目视';
  if (/宏观|广播|公报|国际|位面|世界|电台|大陆|broadcast|world|global/i.test(s)) return '宏观广播';
  return scope === 'world' ? '宏观广播' : '前线目视';
}

function normalizeIntelCred(rawCred: string): '高' | '中' | '低' {
  const s = rawCred.trim();
  if (/高|确凿|证实|high|confirmed/i.test(s)) return '高';
  if (/低|存疑|流言|伪|low|rumor/i.test(s)) return '低';
  return '中';
}

function normalizeIntelStatus(
  rawStatus: string,
  cred: '高' | '中' | '低',
): '待核实' | '已证实' | '已证伪' | '演进中' {
  const s = rawStatus.trim();
  if (/已证伪|证伪|虚假|排除|辟谣|falsified|debunked|false/i.test(s)) return '已证伪';
  if (/已证实|证实|确认|确凿|confirmed|verified/i.test(s)) return '已证实';
  if (/演进中|演进|发酵|升级|持续|evolving|ongoing/i.test(s)) return '演进中';
  if (/待核实|未核实|待查|存疑|pending|unverified/i.test(s)) return '待核实';
  return cred === '高' ? '已证实' : '待核实';
}

function normalizeWorldEvoDomain(rawDomain: string): WorldEvoDomain {
  const s = rawDomain.trim();
  if (/异象|环境|位面|潮汐|天灾|气候|风暴|anomaly|planar/i.test(s)) return '位面异象';
  if (/科技|奇物|研究|实验|武装|技术|原型|tech|artifact/i.test(s)) return '暗流科技';
  if (/社会|民生|黑市|商路|经济|物价|难民|思潮|market|society/i.test(s)) return '社会黑市';
  return '远方地缘';
}

function normalizeWorldEvoStage(rawStage: string): WorldEvoStage {
  const s = rawStage.trim();
  if (/平息|落幕|消退|终结|subside|ended/i.test(s)) return '平息';
  if (/高潮|爆发|临界|白热化|climax|peak/i.test(s)) return '高潮';
  if (/发酵|扩散|升温|酝酿|蔓延|ferment|growing/i.test(s)) return '发酵';
  return '萌芽';
}

/**
 * 12. 解析 `<情报>` 与 `<世界演变>` 载荷（FD-33：战区情报六源演进与世界演变五维引擎）
 */
export function parseTacticalIntelPayload(
  rawContent: unknown,
  defaultScope?: 'tactical' | 'world',
): ParsedTacticalIntelCard {
  const cacheKey = `tactical-intel::${defaultScope ?? 'auto'}`;
  const cached = getExtraCache<ParsedTacticalIntelCard>(cacheKey, rawContent);
  if (cached.hit) return cached.value;

  const isOuterWorldTag =
    typeof rawContent === 'string' && /^\s*<世界演变>[\s\S]*<\/世界演变>\s*$/i.test(rawContent);
  const effectiveDefaultScope: 'tactical' | 'world' =
    defaultScope ?? (isOuterWorldTag ? 'world' : 'tactical');

  const PRIMARY_INTEL_KEYS = [
    'title',
    'name',
    'subject',
    'topic',
    'trend',
    '标题',
    '名称',
    '主题',
    '动向',
    '事件',
    '条目',
    '内容',
    'content',
  ];

  const records = parseFlexibleRecords(
    rawContent,
    ['情报', '世界演变', 'intel', 'world_evolution', 'worldEvolution'],
    PRIMARY_INTEL_KEYS,
  );

  const items: ParsedTacticalIntelItem[] = [];

  for (const rec of records) {
    const contentText = pickStr(
      rec,
      ['content', 'detail', 'summary', 'desc', 'text', '内容', '详情', '摘要', '描述', '正文', '说明', '情报'],
      '',
    );
    let title = pickStr(
      rec,
      ['title', 'name', 'subject', 'topic', 'trend', '标题', '名称', '主题', '动向', '事件', '条目'],
      '',
    );
    if (!title && contentText) {
      title = contentText.slice(0, 22);
    }
    if (!title && !contentText) continue;

    const rawScope = pickStr(
      rec,
      ['scope', 'category', 'type', 'kind', '范畴', '分类', '类别', '类型'],
      '',
    );
    const hasWorldSignals = Boolean(
      rec['象限'] ??
        rec['演化象限'] ??
        rec.evo_domain ??
        rec.evoDomain ??
        rec['阶段'] ??
        rec['演化阶段'] ??
        rec.stage ??
        rec['伏笔'] ??
        rec['切入点'] ??
        rec['潜在切入点'] ??
        rec['影响评估'] ??
        rec.hook ??
        rec.ttl_floors ??
        rec.ttlFloors ??
        rec['剩余热度'] ??
        rec['热度余量'],
    );

    const isExplicitTactical = /战区情报|战术情报|tactical/i.test(rawScope);
    const isExplicitWorld = /世界演变|世界暗流|宏观|world/i.test(rawScope);
    const scope: 'tactical' | 'world' = isExplicitWorld
      ? 'world'
      : isExplicitTactical
        ? 'tactical'
        : hasWorldSignals
          ? 'world'
          : effectiveDefaultScope;

    const src = pickStr(
      rec,
      ['src', 'source', 'from', 'sender', '来源', '信源', '出处', '发布方'],
      '',
    );
    const rawSrcKind = pickStr(
      rec,
      ['src_kind', 'srcKind', 'channel', '渠道', '来源类型', '来源渠道'],
      '',
    );
    const srcKind = normalizeIntelSrcKind(rawSrcKind || src || rawScope, scope);

    const rawCred = pickStr(
      rec,
      ['cred', 'credibility', 'confidence', '可信度', '置信度', '可靠度', '等级'],
      '',
    );
    const cred = normalizeIntelCred(rawCred);

    const rawStatus = pickStr(
      rec,
      ['status', 'state', '状态', '核实状态', '结果'],
      '',
    );
    const status = normalizeIntelStatus(rawStatus, cred);

    const evolvesFrom = pickStr(
      rec,
      ['evolves_from', 'evolvesFrom', 'parent', 'from_intel', '演进自', '关联情报', '证实自', '证伪自', '前序情报', '源自'],
      '',
    );

    const chain = pickStr(
      rec,
      ['chain', 'intel_chain', 'series', '情报链', '侦察链', '溯源链', '线索链', '案卷', '系列', '所属情报链'],
      '',
    );
    const chainStep = pickStr(
      rec,
      ['chain_step', 'chainStep', 'intel_step', 'step', '阶数', '侦察阶数', '溯源进度', '调查阶段', '环数', '阶段环', '阶'],
      '',
    );
    let nextLead = pickStr(
      rec,
      ['next_lead', 'nextLead', 'next_hook', 'quest_hint', 'lead', '下一阶线索', '下一步核查', '后续线索', '核查方向', '派生任务线索', '任务钩子', '任务线索', '行动线索'],
      '',
    );

    const rawEvoDomain = pickStr(
      rec,
      ['evo_domain', 'evoDomain', 'domain', 'quadrant', '象限', '演化象限', '领域', '方向'],
      '',
    );
    const evoDomain = normalizeWorldEvoDomain(rawEvoDomain || title || contentText);

    const rawStage = pickStr(
      rec,
      ['stage', 'phase', '阶段', '演化阶段', '态势阶段'],
      '',
    );
    const stage = normalizeWorldEvoStage(rawStage);

    const rawTtl =
      rec.ttl_floors ??
      rec.ttlFloors ??
      rec.ttl ??
      rec['剩余热度'] ??
      rec['热度余量'] ??
      rec['热度'] ??
      rec['轮数'];
    let ttlFloors = 5;
    if (rawTtl !== undefined && rawTtl !== null && String(rawTtl).trim() !== '') {
      const m = String(rawTtl).match(/\d+/);
      if (m) {
        ttlFloors = Math.max(0, Math.min(10, Number(m[0])));
      }
    }

    let hook = pickStr(
      rec,
      ['hook', 'entry_point', 'impact', '伏笔', '切入点', '潜在切入点', '影响评估', '介入方向'],
      '',
    );
    if (scope === 'tactical') {
      if (nextLead && !hook) {
        hook = nextLead;
      } else if (hook && !nextLead) {
        nextLead = hook;
      }
    }
    const date = pickStr(rec, ['date', 'time', '日期', '时间'], '');

    items.push({
      title: title || '战区加密线报',
      scope,
      src: src || srcKind,
      srcKind,
      cred,
      status,
      evolvesFrom,
      chain,
      chainStep,
      nextLead,
      evoDomain,
      stage,
      ttlFloors,
      hook,
      content: contentText || title,
      date,
    });
  }

  if (items.length === 0 && typeof rawContent === 'string') {
    const cleaned = stripOuterTag(rawContent, ['情报', '世界演变', 'intel']);
    if (cleaned) {
      const firstLine = cleaned
        .split(/\r?\n/)
        .map(l => l.replace(/^[-*•]\s+/, '').trim())
        .find(Boolean);
      if (firstLine) {
        items.push({
          title: firstLine.slice(0, 22),
          scope: effectiveDefaultScope,
          src: effectiveDefaultScope === 'world' ? '宏观广播' : '前线目视',
          srcKind: effectiveDefaultScope === 'world' ? '宏观广播' : '前线目视',
          cred: '中',
          status: '待核实',
          evolvesFrom: '',
          chain: '',
          chainStep: '',
          nextLead: '',
          evoDomain: '远方地缘',
          stage: '萌芽',
          ttlFloors: 5,
          hook: '',
          content: firstLine,
          date: '',
        });
      }
    }
  }

  const hasTactical = items.some(i => i.scope === 'tactical');
  const hasWorld = items.some(i => i.scope === 'world');
  const preview = items
    .slice(0, 2)
    .map(i =>
      i.scope === 'world'
        ? `[🌍${i.evoDomain}·${i.stage}] ${i.title}`
        : `[${i.srcKind}·${i.cred}${i.chain || i.chainStep ? `·${i.chain || '情报链'}${i.chainStep ? `(${i.chainStep})` : ''}` : ''}] ${i.title}`,
    )
    .join(' / ');
  const compactSummary =
    items.length > 0 ? `${preview} · 共 ${items.length} 条电讯` : '暂无情报与世界暗流';

  return setExtraCache(cacheKey, rawContent, {
    items,
    hasTactical,
    hasWorld,
    compactSummary,
  });
}

export type ParsedTacticalIntelRawResult = ParsedTacticalIntelItem[] & {
  items: ParsedTacticalIntelItem[];
  hasTactical: boolean;
  hasWorld: boolean;
  compactSummary: string;
};

/**
 * 解析 `<情报>` 或 `<世界演变>` 原始文本并返回条目列表（同时挂载 .items 属性兼容对象访问）
 */
export function parseTacticalIntelRaw(
  rawText: unknown,
  defaultScope: 'tactical' | 'world' = 'world',
): ParsedTacticalIntelRawResult {
  if (typeof rawText === 'string') {
    const stripped = stripOuterTag(rawText, ['情报', '世界演变', 'intel']);
    if (!stripped.trim()) {
      const emptyArr = [] as unknown as ParsedTacticalIntelRawResult;
      emptyArr.items = [];
      emptyArr.hasTactical = false;
      emptyArr.hasWorld = false;
      emptyArr.compactSummary = '暂无情报与世界暗流';
      return emptyArr;
    }
  }
  const card = parseTacticalIntelPayload(rawText, defaultScope);
  const arr = [...card.items] as unknown as ParsedTacticalIntelRawResult;
  arr.items = card.items;
  arr.hasTactical = card.hasTactical;
  arr.hasWorld = card.hasWorld;
  arr.compactSummary = card.compactSummary;
  return arr;
}

function extractStringListFromUnknown(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) {
    const out: string[] = [];
    for (const item of val) {
      if (typeof item === 'string' && item.trim()) {
        out.push(item.trim());
      } else if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        const name = pickStr(rec, ['name', 'title', '名称', '标题', '标的', '单位', '建筑'], '');
        const state = pickStr(rec, ['state', 'status', 'layer', '状态', '层级', '坐标'], '');
        if (name) {
          out.push(state ? `${name}(${state})` : name);
        }
      }
    }
    return out;
  }
  if (typeof val === 'string') {
    return val
      .split(/[,，、;；\n]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  if (typeof val === 'object') {
    const rec = val as Record<string, unknown>;
    const name = pickStr(rec, ['name', 'title', '名称', '标题'], '');
    if (name) return [name];
    return Object.entries(rec)
      .map(([k, v]) => `${k}:${typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}`)
      .filter(Boolean);
  }
  return [];
}

/**
 * 13. 解析 `<部署>` / `<展开>` / `<deploy>` 战区部署与基地展开载荷
 */
export function parseDeploymentOrderPayload(rawContent: unknown): DeploymentOrderCardPayload {
  const cached = getExtraCache<DeploymentOrderCardPayload>('deployment-order', rawContent);
  if (cached.hit) return cached.value;

  const rawText = typeof rawContent === 'string' ? rawContent : '';
  const stripped = stripOuterTag(rawText, ['部署', '展开', 'deploy', 'deployment']);
  const lineCount = stripped
    ? stripped
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean).length
    : 0;

  const PRIMARY_DEPLOY_KEYS = [
    'action',
    'op',
    'type',
    'mode',
    'unit',
    'vehicle',
    'target',
    'base',
    'new_base',
    'name',
    'title',
    '行动',
    '动作',
    '指令',
    '类型',
    '模式',
    '单位',
    '车辆',
    '载具',
    '标的',
    '基地',
    '新基地',
    '目标基地',
    '所属基地',
    '名称',
  ];

  const records = parseFlexibleRecords(
    rawContent,
    ['部署', '展开', 'deploy', 'deployment'],
    PRIMARY_DEPLOY_KEYS,
  );

  const items: DeploymentOrderItem[] = [];

  for (const rec of records) {
    const action = pickStr(
      rec,
      ['action', 'op', 'type', 'directive', '行动', '动作', '指令', '类型', '操作', '状态'],
      /^<展开/i.test(rawText.trim()) ? '基地展开' : '战术部署',
    );
    const unit = pickStr(
      rec,
      ['unit', 'vehicle', 'target', 'model', '单位', '车辆', '载具', '标的', '部队', '设施', '型号'],
      '机动建设车 (MCV)',
    );
    const base = pickStr(
      rec,
      ['base', 'new_base', 'target_base', 'base_name', '基地', '新基地', '目标基地', '所属基地', '阵位', '名称', 'name'],
      '前沿主基地',
    );
    const location = pickStr(
      rec,
      ['location', 'site', 'coord', 'position', '位置', '选址', '地点', '坐标', '方位', '区域'],
      '',
    );
    const status = pickStr(
      rec,
      ['status', 'state', 'mode', '状态', '模式', '结果', '阶段'],
      /收起|拔营|撤收|pack/i.test(action)
        ? '已收起待命'
        : /切换|mode/i.test(action)
          ? '模式已切换'
          : '已展开并网',
    );

    const sectors = extractStringListFromUnknown(
      rec.sectors ?? rec['防区'] ?? rec['防区工程'] ?? rec['工事'],
    );
    const buildings = extractStringListFromUnknown(
      rec.buildings ?? rec['建筑'] ?? rec['设施'] ?? rec['初始建筑'] ?? rec['展开建筑'],
    );

    const summary = pickStr(
      rec,
      ['summary', 'desc', 'detail', 'note', 'effect', '说明', '描述', '详情', '备注', '结果', '效果'],
      '',
    );

    const fields: Array<{ label: string; value: string }> = [];
    for (const [k, v] of Object.entries(rec)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) || typeof v === 'object') {
        const listStr = extractStringListFromUnknown(v).join('、');
        if (listStr) fields.push({ label: k, value: listStr });
      } else {
        const s = String(v).trim();
        if (s) fields.push({ label: k, value: s });
      }
    }

    items.push({
      action,
      unit,
      base,
      location,
      status,
      sectors,
      buildings,
      summary:
        summary ||
        `${unit}于「${base}」${location ? `（${location}）` : ''}执行【${action}】· ${status}`,
      fields,
    });
  }

  if (items.length === 0) {
    const firstLine = stripped
      .split(/\r?\n/)
      .map(l => l.replace(/^[-*•]\s+/, '').trim())
      .find(Boolean);
    items.push({
      action: /^<展开/i.test(rawText.trim()) ? '基地展开' : '战术部署',
      unit: '机动建设车 (MCV)',
      base: '前沿主基地',
      location: '',
      status: '已就位',
      sectors: [],
      buildings: [],
      summary: firstLine || '战区机动部署与阵地展开指令已执行。',
      fields: firstLine ? [{ label: '部署纪要', value: firstLine }] : [],
    });
  }

  const first = items[0];
  const locPart = first.location ? ` @ ${first.location}` : '';
  const compactSummary = `${first.action} · ${first.unit} ➔ ${first.base}${locPart}${items.length > 1 ? ` (+${items.length - 1}项)` : ''}`;

  return setExtraCache('deployment-order', rawContent, {
    items,
    lineCount: Math.max(lineCount, items.length),
    compactSummary,
  });
}

/**
 * 14. 解析 `<资金链>` 战区多元资金链态势载荷
 */
export function parseEconomyChainsPayload(rawContent: unknown): EconomyChainsCardPayload {
  const cached = getExtraCache<EconomyChainsCardPayload>('economy-chains', rawContent);
  if (cached.hit) return cached.value;

  const PRIMARY_CHAIN_KEYS = [
    'name',
    'chain',
    'title',
    'id',
    '名称',
    '链条',
    '资金链',
    '项目',
    '渠道',
    '标题',
  ];

  const records = parseFlexibleRecords(
    rawContent,
    ['资金链', '经济链', 'chains', 'economy_chains', 'economyChains'],
    PRIMARY_CHAIN_KEYS,
  );

  const items: EconomyChainCardItem[] = [];

  for (const rec of records) {
    const name = pickStr(rec, PRIMARY_CHAIN_KEYS, '战区贸易与资源资金链');
    const status = pickStr(
      rec,
      ['status', 'state', '状态', '运转状态', '阶段'],
      '运转中',
    );
    const flow = pickStr(
      rec,
      ['flow', 'direction', 'type', '流向', '收支', '类型', '方向'],
      '收入',
    );
    const rawRate = pickStr(
      rec,
      [
        'rate_daily',
        'daily_rate',
        'rate',
        'income',
        'base_rate',
        '日收益',
        '基础日收',
        '日产',
        '日净流',
        '日流',
        '收益',
        '金额',
      ],
      '',
    );
    let dailyRate = rawRate || '+300/日';
    if (rawRate && /^-?\d+(?:\.\d+)?$/.test(rawRate)) {
      const num = Number(rawRate);
      const sign = /支出|expense|out/i.test(flow) && num > 0 ? '-' : num >= 0 ? '+' : '';
      dailyRate = `${sign}${num}/日`;
    } else if (rawRate && !/\/日|\/d|每日/i.test(rawRate) && /\d/.test(rawRate)) {
      dailyRate = `${rawRate}/日`;
    }

    const rawEff = pickStr(
      rec,
      ['efficiency', 'eff', 'multiplier', '效率', '运转效率', '倍率', '产能效率'],
      '100%',
    );
    const efficiency = /^\d+(?:\.\d+)?$/.test(rawEff)
      ? Number(rawEff) <= 2
        ? `${Math.round(Number(rawEff) * 100)}%`
        : `${rawEff}%`
      : rawEff;

    const capacity = pickStr(
      rec,
      ['capacity', 'remaining', 'reserve', 'pool', '容量', '剩余容量', '储量', '总额度', '上限'],
      '持续供给',
    );
    const base = pickStr(
      rec,
      ['base', 'location', 'region', '基地', '所属基地', '挂靠基地', '地点', '区域'],
      '主基地',
    );
    const desc = pickStr(
      rec,
      ['desc', 'reason', 'summary', 'note', 'detail', '描述', '原因', '说明', '备注', '详情'],
      '',
    );

    const fields: Array<{ label: string; value: string }> = [];
    for (const [k, v] of Object.entries(rec)) {
      if (v !== undefined && v !== null && typeof v !== 'object' && String(v).trim()) {
        fields.push({ label: k, value: String(v).trim() });
      }
    }

    items.push({
      name,
      status,
      flow,
      dailyRate,
      efficiency,
      capacity,
      base,
      desc,
      fields,
    });
  }

  if (items.length === 0) {
    items.push({
      name: '战区军工与矿脉资金链',
      status: 'active',
      flow: '收入',
      dailyRate: '+500/日',
      efficiency: '100%',
      capacity: '持续运转',
      base: '主基地',
      desc: '战区多元资金链已并入后勤财务账本。',
      fields: [],
    });
  }

  const preview = items
    .slice(0, 2)
    .map(c => `${c.name}(${c.dailyRate} · ${c.status})`)
    .join(' / ');

  return setExtraCache('economy-chains', rawContent, {
    items,
    compactSummary: `${preview}${items.length > 2 ? ` 等 ${items.length} 条资金链` : ''}`,
  });
}

/**
 * 15. 解析 `<世界演变>` 宏观世界演变暗流载荷（支持显化/隐藏双模水合）
 */
export function parseWorldEvolutionPayload(rawContent: unknown): WorldEvolutionCardPayload {
  const cached = getExtraCache<WorldEvolutionCardPayload>('world-evolution', rawContent);
  if (cached.hit) return cached.value;

  const PRIMARY_WEVO_KEYS = [
    'id',
    'title',
    'name',
    '编号',
    '标题',
    '名称',
    '事件',
    '动向',
    '主题',
  ];

  const records = parseFlexibleRecords(
    rawContent,
    ['世界演变', 'world_evolution', 'worldEvolution'],
    PRIMARY_WEVO_KEYS,
  );

  const items: WorldEvolutionCardItem[] = [];

  for (let idx = 0; idx < records.length; idx++) {
    const rec = records[idx];
    const id = pickStr(rec, ['id', 'code', '编号', '代号'], `WEVO-0${idx + 1}`);
    const situation = pickStr(
      rec,
      ['situation', 'content', 'summary', 'desc', 'detail', '态势', '内容', '摘要', '描述', '详情', '动向'],
      '',
    );
    let title = pickStr(
      rec,
      ['title', 'name', 'subject', 'topic', '标题', '名称', '主题', '事件'],
      '',
    );
    if (!title && situation) {
      title = situation.slice(0, 22);
    }
    if (!title && !situation) continue;

    const rawDomain = pickStr(
      rec,
      ['domain', 'evo_domain', 'evoDomain', 'quadrant', 'category', '象限', '演化象限', '领域', '类别'],
      '',
    );
    const domain = normalizeWorldEvoDomain(rawDomain || title || situation);

    const rawStage = pickStr(
      rec,
      ['stage', 'phase', 'status', '阶段', '演化阶段', '状态'],
      '',
    );
    const stage = normalizeWorldEvoStage(rawStage);

    const region = pickStr(
      rec,
      ['region', 'area', 'location', 'scope_area', '影响区域', '区域', '地点', '范围', '波及区域'],
      '宏观战区外围',
    );
    const hook = pickStr(
      rec,
      ['hook', 'entry_point', 'impact', '伏笔', '潜在切入点', '切入点', '影响评估'],
      '',
    );

    const rawTtl =
      rec.ttl_floors ?? rec.ttlFloors ?? rec.ttl ?? rec['剩余热度'] ?? rec['热度余量'] ?? rec['轮数'];
    let ttlFloors = 5;
    if (rawTtl !== undefined && rawTtl !== null && String(rawTtl).trim() !== '') {
      const m = String(rawTtl).match(/\d+/);
      if (m) {
        ttlFloors = Math.max(0, Math.min(10, Number(m[0])));
      }
    }

    items.push({
      id,
      title: title || '宏观世界暗流演进',
      domain,
      stage,
      region,
      situation: situation || title,
      hook,
      ttlFloors,
    });
  }

  if (items.length === 0) {
    const intelFallback = parseTacticalIntelPayload(rawContent, 'world');
    for (let idx = 0; idx < intelFallback.items.length; idx++) {
      const it = intelFallback.items[idx];
      items.push({
        id: `WEVO-0${idx + 1}`,
        title: it.title,
        domain: it.evoDomain,
        stage: it.stage,
        region: '宏观战区外围',
        situation: it.content,
        hook: it.hook,
        ttlFloors: it.ttlFloors,
      });
    }
  }

  const preview = items
    .slice(0, 2)
    .map(i => `[${i.domain}·${i.stage}] ${i.title}`)
    .join(' / ');

  return setExtraCache('world-evolution', rawContent, {
    items,
    compactSummary: items.length > 0 ? `${preview} (${items.length}道暗流)` : '暂无世界演变暗流',
  });
}

