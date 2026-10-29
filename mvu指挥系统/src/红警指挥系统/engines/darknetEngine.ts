/**
 * engines/darknetEngine.ts —— 跨维暗网解析门、确定性交割账本与多元被动经济引擎（DARKNET-CORE-01）
 *
 * 职责：
 * 1. 提取并解析文末顶层 <暗网>...</暗网> YAML 块，支持中英文同义键名与三色容错门；
 * 2. 确定性执行「本轮交割」八大标准动作（售出实物、售出信息、完成悬赏、购买商品、竞拍出价、拍卖竞得落槌、拍卖送拍成交、上架送拍）；
 * 3. 实物六柱库存不足刚性阻断（防负库存与凭空刷钱）、sold_intel_ids 情报唯一性防刷锁、跨楼层多轮慢节奏拍卖（未落槌不扣款）；
 * 4. 推进定期拍卖所倒计时时钟，并汇总基地多元被动现金流建筑（精炼/独立回收/油气重化 + 矿石精炼器 +25% 乘区）。
 *
 * 约束：纯函数模块——零宿主 API / 零 Pinia / 零 Vue 依赖。
 */

import { parseString } from '@util/common';
import {
  DarknetAuctionItem,
  DarknetBountyItem,
  DarknetMarketItem,
  DarknetResourceMap,
  DarknetSettlementRecord,
  DarknetState,
  EconomyChannelDaily,
  EconomyResources,
} from '../core/schema';
import {
  asArray,
  canon,
  errText,
  isUsable,
  keyIndex,
  preprocess,
  take,
  type ParseEvent,
  type QuarantineItem,
  type StatData,
} from '../parse/parseCommon';
import { RESOURCE_PILLAR_ALIASES, type ResourcePillarKey } from '../parse/resourceMerge';
import { setHasEquivalentBuilding } from '../core/prerequisitesHelpers';
import { calcDailyNet } from './chainEngine';

const DARKNET_TAG_NAMES = '暗网|暗网订单|暗网采购|暗网交易|黑市|黑市订单|黑市交易';
const DARKNET_BLOCK_RE = new RegExp(
  `[<\\uFF1C]\\s*(?:${DARKNET_TAG_NAMES})\\s*[>\\uFF1E]([\\s\\S]*?)[<\\uFF1C]\\s*\\/\\s*(?:${DARKNET_TAG_NAMES})\\s*[>\\uFF1E]`,
  'g',
);

const MAX_LEDGER_RECORDS = 20;
const DEFAULT_AUCTION_INTERVAL_MINUTES = 10080; // 7日

export interface ApplyDarknetResult {
  events: ParseEvent[];
  quarantine: QuarantineItem[];
  appliedCount: number;
}

export interface TickDarknetResult {
  next: StatData;
  data: StatData;
  events: ParseEvent[];
  channelDaily: EconomyChannelDaily;
}

/**
 * 从楼层原文中提取所有 <暗网>...</暗网> 块内部文本
 */
export function extractDarknetBlocks(raw: string): string[] {
  if (!raw || (!raw.includes('暗网') && !raw.includes('黑市'))) return [];
  const blocks: string[] = [];
  const re = new RegExp(DARKNET_BLOCK_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const inner = m[1].trim();
    if (inner) blocks.push(inner);
  }
  return blocks;
}

/**
 * 剥离原文中的所有 <暗网>...</暗网> 等暗网/黑市块（供 parsePipeline L0 块提取前消音）
 */
export function stripDarknetBlocks(raw: string): string {
  if (!raw || (!raw.includes('暗网') && !raw.includes('黑市'))) return raw;
  return raw.replace(new RegExp(DARKNET_BLOCK_RE.source, 'g'), '');
}

/**
 * 归一化资源柱名（支持中文主名、短称与英文键）
 */
export function normalizeResourcePillar(rawPillar: unknown): ResourcePillarKey | null {
  const c = canon(rawPillar);
  if (!c) return null;
  for (const [pillar, aliases] of Object.entries(RESOURCE_PILLAR_ALIASES)) {
    if (canon(pillar) === c || aliases.some(a => canon(a) === c)) {
      return pillar as ResourcePillarKey;
    }
  }
  return null;
}

/**
 * 解析带可选单位后缀的数字（返回数值与是否发生单位剥离修复）
 */
function parseFlexibleNumber(raw: unknown): { value: number | null; hadUnitSuffix: boolean } {
  if (typeof raw === 'number') {
    return { value: Number.isFinite(raw) ? raw : null, hadUnitSuffix: false };
  }
  if (raw === null || raw === undefined || typeof raw === 'boolean') {
    return { value: null, hadUnitSuffix: false };
  }
  const str = String(raw).trim();
  if (!str) return { value: null, hadUnitSuffix: false };

  const cleanCommas = str.replace(/,/g, '').trim();
  const direct = Number(cleanCommas);
  if (Number.isFinite(direct)) {
    return { value: direct, hadUnitSuffix: false };
  }

  const m = /^([+-]?\d+(?:\.\d+)?)\s*(.*)$/.exec(cleanCommas);
  if (!m) return { value: null, hadUnitSuffix: false };
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return { value: null, hadUnitSuffix: false };
  return { value: n, hadUnitSuffix: m[2].trim().length > 0 };
}

/**
 * 解析拍卖倒计时文本或数字为分钟数：
 * 支持 "12h" -> 720, "3d" / "余3日" / "3天" -> 4320, "45m" -> 45, 数字直转
 */
export function parseAuctionCountdownMinutes(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.round(raw));
  }
  const s = String(raw ?? '')
    .trim()
    .replace(/^[余剩约]+\s*/, '')
    .trim();
  if (!s) return null;

  const direct = Number(s);
  if (Number.isFinite(direct)) {
    return Math.max(0, Math.round(direct));
  }

  let totalMinutes = 0;
  let matched = false;

  const dayRe = /(\d+(?:\.\d+)?)\s*(?:d|day|days|天|日)/gi;
  let dm: RegExpExecArray | null;
  while ((dm = dayRe.exec(s)) !== null) {
    totalMinutes += Number(dm[1]) * 1440;
    matched = true;
  }

  const hourRe = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|小时|时)/gi;
  let hm: RegExpExecArray | null;
  while ((hm = hourRe.exec(s)) !== null) {
    totalMinutes += Number(hm[1]) * 60;
    matched = true;
  }

  const minRe = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes|分钟|分)(?!钟?后)/gi;
  let mm: RegExpExecArray | null;
  while ((mm = minRe.exec(s)) !== null) {
    totalMinutes += Number(mm[1]);
    matched = true;
  }

  if (matched) {
    return Math.max(0, Math.round(totalMinutes));
  }
  return null;
}

function normalizeAuctionGlobalStatus(raw: unknown): 'closed' | 'bidding' | 'open' | 'settled' {
  const c = canon(raw);
  if (['开启中', '开启', '竞拍中', '竞价中', '进行中', '拍卖中', '热拍中', '开放', 'bidding', 'open', 'active'].includes(c)) {
    return 'bidding';
  }
  if (['已落槌', '已结束', '已结算', '落槌', 'settled', 'finished', 'done'].includes(c)) {
    return 'settled';
  }
  return 'closed';
}

function normalizeBountyStatus(raw: unknown): 'open' | 'completed' | 'expired' {
  const c = canon(raw);
  if (['已完成', '已交割', '已结清', '已交付', 'completed', 'done'].includes(c)) {
    return 'completed';
  }
  if (['已过期', '已失效', '过期', 'expired'].includes(c)) {
    return 'expired';
  }
  return 'open';
}

function normalizeAuctionItemStatus(raw: unknown): 'bidding' | 'sold' | 'passed' | 'cancelled' {
  const c = canon(raw);
  if (['已成交', '落槌', '已落槌', '成交', '已拍出', 'sold', 'settled'].includes(c)) {
    return 'sold';
  }
  if (['流拍', '已流拍', '无人出价', '已过期', '已失效', '过期', 'passed', 'unsold', 'expired'].includes(c)) {
    return 'passed';
  }
  if (
    [
      '取消',
      '已取消',
      '下架',
      '已下架',
      '撤拍',
      '已撤拍',
      '撤回',
      '已撤回',
      '取消/下架',
      'cancelled',
      'canceled',
      'withdrawn',
    ].includes(c)
  ) {
    return 'cancelled';
  }
  return 'bidding';
}

function isPlayerParty(raw: unknown): boolean {
  const c = canon(raw);
  if (!c) return false;
  return [
    '我方',
    '我方指挥部',
    '指挥部',
    '统帅部',
    '指挥官',
    '玩家',
    '本方',
    '己方',
    'player',
    'self',
    'our',
    'ours',
  ].some(alias => canon(alias) === c);
}

function creditNonResourceItem(data: StatData, itemName: string, category?: string): void {
  const name = itemName.trim();
  if (!name) return;
  const cat = String(category ?? '').trim();
  if (/载具|战车|坦克|飞机|舰艇|vehicle/i.test(cat)) {
    if (!Array.isArray(data.forces.vehicles)) data.forces.vehicles = [];
    data.forces.vehicles.push(name);
    return;
  }
  if (/人员|步兵|兵力|troop/i.test(cat)) {
    const troops = (data.forces.troops ??= {});
    troops[name] = (troops[name] ?? 0) + 1;
    return;
  }
  const equip = (data.forces.equipment ??= {});
  equip[name] = (equip[name] ?? 0) + 1;
}

const RESOURCE_MAP_ALIASES = [
  '资源映射',
  '实物映射',
  '寄售物资',
  '托管物资',
  '寄售资源',
  '拍品映射',
  '入库映射',
  '入库物资',
  '获得物资',
  '收获物资',
  '交付物资',
  '物资',
  '资源',
  '奖励',
  'resource_map',
  'resourceMap',
  'resource_credit',
  'resourceCredit',
  'resources',
];

const NANITE_SUBKEY_ALIASES: Readonly<Record<string, string>> = {
  通用纳米: '通用纳米工料',
  通用纳米工料: '通用纳米工料',
  军工纳米: '军工纳米工料',
  军工纳米工料: '军工纳米工料',
  特种纳米: '特种纳米工料',
  特种纳米工料: '特种纳米工料',
  高能纳米: '高能纳米工料',
  高能纳米工料: '高能纳米工料',
  标准纳米: '标准纳米工料',
  标准纳米工料: '标准纳米工料',
  高精纳米: '高精构造型纳米',
  高精构型纳米: '高精构造型纳米',
  高精构造型纳米: '高精构造型纳米',
  修复凝胶: '机娘修复凝胶',
  机娘修复凝胶: '机娘修复凝胶',
};

function inferResourcePillarAndKey(rawKey: string): { pillar: ResourcePillarKey; key: string } {
  const trimmed = rawKey.trim();
  const c = canon(trimmed);
  if (NANITE_SUBKEY_ALIASES[c]) {
    return { pillar: 'nanites', key: NANITE_SUBKEY_ALIASES[c] };
  }
  if (/纳米|凝胶/.test(trimmed)) {
    return { pillar: 'nanites', key: trimmed };
  }
  const zeroRes = EconomyResources.parse({});
  for (const pillar of ['nanites', 'minerals', 'materials', 'fuel', 'munitions', 'logistics'] as const) {
    const map = zeroRes[pillar];
    const hit = Object.keys(map).find(k => canon(k) === c);
    if (hit) {
      return { pillar, key: hit };
    }
  }
  if (/矿|煤|铁|铜|铝|钛|晶|石/.test(trimmed)) return { pillar: 'minerals', key: trimmed };
  if (/油|燃料|氢|重水|电池/.test(trimmed)) return { pillar: 'fuel', key: trimmed };
  if (/弹药|炮弹|导弹|炸药|火箭弹/.test(trimmed)) return { pillar: 'munitions', key: trimmed };
  if (/口粮|食品|医疗|药品|淡水|备件/.test(trimmed)) return { pillar: 'logistics', key: trimmed };
  return { pillar: 'materials', key: trimmed };
}

function parseResourceMapList(raw: unknown): DarknetResourceMap[] {
  if (!isUsable(raw) || Array.isArray(raw)) {
    return [DarknetResourceMap.parse({})];
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return [DarknetResourceMap.parse({})];
  }
  const idx = keyIndex(obj);
  const consumed = new Set<string>();
  const pillarTaken = take(obj, idx, consumed, ['柱', '资源柱', '大类', '类别', 'pillar']);
  const keyTaken = take(obj, idx, consumed, ['键', '小类', '名称', '物资', 'key', 'name']);
  const qtyTaken = take(obj, idx, consumed, ['数量', '份额', '数额', 'qty', 'amount', 'count']);

  if (pillarTaken || keyTaken || qtyTaken) {
    const keyStr = String(keyTaken?.value ?? '').trim();
    const inferred = keyStr ? inferResourcePillarAndKey(keyStr) : null;
    const normalizedPillar =
      pillarTaken !== null
        ? (normalizeResourcePillar(pillarTaken.value) ?? String(pillarTaken.value ?? '').trim())
        : (inferred?.pillar ?? '');
    const finalKey = pillarTaken !== null ? keyStr : (inferred?.key ?? keyStr);
    const qtyNum = parseFlexibleNumber(qtyTaken?.value).value ?? 0;
    return [
      DarknetResourceMap.parse({
        pillar: normalizedPillar,
        key: finalKey,
        qty: Math.max(0, qtyNum),
      }),
    ];
  }

  const list: DarknetResourceMap[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (isUsable(v) && !Array.isArray(v)) {
      const explicitPillar = normalizeResourcePillar(k) ?? k.trim();
      for (const [subK, subV] of Object.entries(v as Record<string, unknown>)) {
        const inferred = inferResourcePillarAndKey(subK);
        const qtyNum = parseFlexibleNumber(subV).value ?? 0;
        list.push(
          DarknetResourceMap.parse({
            pillar: explicitPillar,
            key: explicitPillar === 'nanites' ? inferred.key : subK.trim(),
            qty: Math.max(0, qtyNum),
          }),
        );
      }
    } else {
      const inferred = inferResourcePillarAndKey(k);
      const qtyNum = parseFlexibleNumber(v).value ?? 0;
      list.push(
        DarknetResourceMap.parse({
          pillar: inferred.pillar,
          key: inferred.key,
          qty: Math.max(0, qtyNum),
        }),
      );
    }
  }
  return list.length > 0 ? list : [DarknetResourceMap.parse({})];
}

function parseResourceMap(raw: unknown): DarknetResourceMap {
  return parseResourceMapList(raw)[0] ?? DarknetResourceMap.parse({});
}

function mapMarketItem(raw: unknown, index: number): DarknetMarketItem | null {
  if (!isUsable(raw) || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const idx = keyIndex(obj);
  const consumed = new Set<string>();

  const idT = take(obj, idx, consumed, ['编号', '商品编号', 'id']);
  const nameT = take(obj, idx, consumed, ['名称', '标题', '商品', '商品名', '标的', 'name', 'title']);
  const catT = take(obj, idx, consumed, ['类别', '分类', '类型', 'category']);
  const priceT = take(obj, idx, consumed, ['价格', '单价', '售价', '报价', '金额', 'price', 'cost']);
  const stockT = take(obj, idx, consumed, ['库存', '数量', '余量', '剩余', 'stock', 'qty', 'count']);
  const sellerT = take(obj, idx, consumed, ['卖家', '卖方', '商团', '来源', '供货方', 'seller', 'vendor']);
  const descT = take(obj, idx, consumed, ['简介', '描述', '详情', '说明', '备注', '内容', 'desc', 'description', 'detail']);
  const resMapT = take(obj, idx, consumed, RESOURCE_MAP_ALIASES);

  const name = String(nameT?.value ?? '').trim();
  const id = String(idT?.value ?? '').trim() || (name ? `dn_item_${index + 1}` : '');
  if (!id && !name) return null;

  const price = Math.max(0, parseFlexibleNumber(priceT?.value).value ?? 0);
  const stock = Math.max(0, parseFlexibleNumber(stockT?.value).value ?? 1);
  const seller = sellerT?.value != null ? String(sellerT.value).trim() : '';
  const resource_map = resMapT ? parseResourceMap(resMapT.value) : undefined;

  return DarknetMarketItem.parse({
    id,
    name: name || id,
    category: String(catT?.value ?? '战略物资').trim() || '战略物资',
    price,
    stock,
    ...(seller ? { seller } : {}),
    desc: String(descT?.value ?? '').trim(),
    ...(resource_map ? { resource_map } : {}),
  });
}

function mapBountyItem(raw: unknown, index: number): DarknetBountyItem | null {
  if (!isUsable(raw) || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const idx = keyIndex(obj);
  const consumed = new Set<string>();

  const idT = take(obj, idx, consumed, ['编号', '悬赏编号', 'id']);
  const targetT = take(obj, idx, consumed, [
    '目标',
    '标题',
    '名称',
    '悬赏目标',
    '标的',
    '求购标的',
    '任务',
    'target',
    'title',
    'name',
  ]);
  const catT = take(obj, idx, consumed, ['类别', '分类', '类型', 'category']);
  const rewardT = take(obj, idx, consumed, [
    '悬赏金',
    '奖励',
    '报酬',
    '赏金',
    '金额',
    '酬金',
    'reward_credits',
    'reward',
    'price',
    'amount',
  ]);
  const clientT = take(obj, idx, consumed, ['委托方', '发布方', '雇主', '发起方', 'client', 'issuer']);
  const diffT = take(obj, idx, consumed, ['难度', '危险度', '风险', 'difficulty', 'risk']);
  const statusT = take(obj, idx, consumed, ['状态', 'status']);
  const deadlineT = take(obj, idx, consumed, ['时限', '期限', '截止', '剩余时间', 'deadline_text', 'deadline']);
  const descT = take(obj, idx, consumed, [
    '简介',
    '描述',
    '详情',
    '内容',
    '说明',
    '要求',
    '备注',
    'desc',
    'description',
    'detail',
    'content',
  ]);

  const target = String(targetT?.value ?? '').trim();
  const id = String(idT?.value ?? '').trim() || (target ? `dn_bounty_${index + 1}` : '');
  if (!id && !target) return null;

  const reward_credits = Math.max(0, parseFlexibleNumber(rewardT?.value).value ?? 0);
  const client = clientT?.value != null ? String(clientT.value).trim() : '';
  const difficulty = diffT?.value != null ? String(diffT.value).trim() : '';

  return DarknetBountyItem.parse({
    id,
    target: target || id,
    category: String(catT?.value ?? '情报数据').trim() || '情报数据',
    reward_credits,
    status: statusT ? normalizeBountyStatus(statusT.value) : 'open',
    ...(client ? { client } : {}),
    ...(difficulty ? { difficulty } : {}),
    deadline_text: String(deadlineT?.value ?? '').trim(),
    desc: String(descT?.value ?? '').trim(),
  });
}

function mapAuctionItem(raw: unknown, index: number): DarknetAuctionItem | null {
  if (!isUsable(raw) || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const idx = keyIndex(obj);
  const consumed = new Set<string>();

  const idT = take(obj, idx, consumed, ['编号', '拍品编号', 'id']);
  const nameT = take(obj, idx, consumed, ['拍品', '名称', '标题', '标的', '拍品名称', 'name', 'title', 'target']);
  const catT = take(obj, idx, consumed, ['类别', '分类', '类型', 'category']);
  const sellerT = take(obj, idx, consumed, ['卖方', '卖家', '委托方', '寄售方', '送拍方', 'seller', 'owner']);
  const startPriceT = take(obj, idx, consumed, ['起拍价', '底价', '初始价', 'start_price', 'startPrice']);
  const curPriceT = take(obj, idx, consumed, [
    '当前最高价',
    '当前估价',
    '当前价',
    '现价',
    '最高价',
    '成交价',
    'current_price',
    'currentPrice',
    'price',
  ]);
  const buyoutPriceT = take(obj, idx, consumed, ['一口价', '买断价', 'buyout_price', 'buyoutPrice', 'buyout']);
  const roundsLeftT = take(obj, idx, consumed, ['剩余轮次', '剩余回合', 'rounds_left', 'roundsLeft']);
  const leaderT = take(obj, idx, consumed, [
    '领先者',
    '领先方',
    '当前领先',
    '最高出价者',
    '出价者',
    '竞拍者',
    '竞价方',
    '竞买人',
    '出价方',
    '竞得方',
    '买方',
    'bidder',
    'leader',
  ]);
  const roundT = take(obj, idx, consumed, ['轮次', '当前轮次', '叫价轮次', 'round_text', 'round']);
  const statusT = take(obj, idx, consumed, ['状态', 'status']);
  const descT = take(obj, idx, consumed, ['简介', '描述', '详情', '说明', '备注', '内容', 'desc', 'description', 'detail']);
  const resMapT = take(obj, idx, consumed, RESOURCE_MAP_ALIASES);
  const consignDeductedT = take(obj, idx, consumed, ['consign_deducted', '已扣库存']);
  const refundedT = take(obj, idx, consumed, ['refunded', '已退回']);

  const name = String(nameT?.value ?? '').trim();
  const id = String(idT?.value ?? '').trim() || (name ? `dn_auc_${index + 1}` : '');
  if (!id && !name) return null;

  const start_price = Math.max(0, parseFlexibleNumber(startPriceT?.value).value ?? 0);
  const current_price = Math.max(0, parseFlexibleNumber(curPriceT?.value).value ?? start_price);
  const buyoutParsed = buyoutPriceT ? parseFlexibleNumber(buyoutPriceT.value).value : null;
  const buyout_price = buyoutParsed !== null && buyoutParsed >= 0 ? buyoutParsed : undefined;
  const roundsLeftParsed = roundsLeftT ? parseFlexibleNumber(roundsLeftT.value).value : null;
  const rounds_left = roundsLeftParsed !== null && roundsLeftParsed >= 0 ? Math.round(roundsLeftParsed) : undefined;
  const category = catT?.value != null ? String(catT.value).trim() : '';

  let leader = '暂无出价';
  if (leaderT && leaderT.value != null) {
    const rawLeader = String(leaderT.value).trim();
    leader = ['暂无', '无', 'none', '-', 'null', '空'].includes(canon(rawLeader)) ? '' : rawLeader;
  }

  let round_text = '第1轮';
  if (roundT && roundT.value != null && String(roundT.value).trim()) {
    round_text = String(roundT.value).trim();
  } else if (rounds_left !== undefined) {
    round_text = `剩余${rounds_left}轮`;
  }

  const resource_map = resMapT ? parseResourceMap(resMapT.value) : undefined;

  return DarknetAuctionItem.parse({
    id,
    name: name || id,
    ...(category ? { category } : {}),
    seller: String(sellerT?.value ?? '跨维匿名卖方').trim() || '跨维匿名卖方',
    start_price,
    current_price,
    ...(buyout_price !== undefined ? { buyout_price } : {}),
    leader,
    round_text,
    ...(rounds_left !== undefined ? { rounds_left } : {}),
    status: statusT ? normalizeAuctionItemStatus(statusT.value) : 'bidding',
    desc: String(descT?.value ?? '').trim(),
    ...(resource_map ? { resource_map } : {}),
    ...(typeof consignDeductedT?.value === 'boolean' ? { consign_deducted: consignDeductedT.value } : {}),
    ...(typeof refundedT?.value === 'boolean' ? { refunded: refundedT.value } : {}),
  });
}

export type CanonicalSettlementAction =
  | '售出实物'
  | '售出信息'
  | '完成悬赏'
  | '购买商品'
  | '竞拍出价'
  | '拍卖竞得落槌'
  | '拍卖送拍成交'
  | '上架送拍'
  | '撤拍';

export const SETTLEMENT_ACTION_ALIASES: Readonly<Record<CanonicalSettlementAction, readonly string[]>> = {
  售出实物: [
    '售出实物',
    '投递实物',
    '出售物资',
    '变卖实物',
    '出售实物',
    '变现',
    '资源变现',
    '传质变现',
    '投递变现',
    '物资变现',
    'sell_item',
    'sell_physical',
  ],
  售出信息: ['售出信息', '上传情报', '售出数据', '出售情报', '售出情报', '情报变现', 'sell_intel', 'upload_intel'],
  完成悬赏: ['完成悬赏', '交割悬赏', '悬赏交割', '交付悬赏', '悬赏完成', '提交悬赏', '领赏', 'complete_bounty'],
  购买商品: [
    '购买商品',
    '直购商品',
    '买入商品',
    '黑市采购',
    '暗网采购',
    '暗网直采',
    '黑市直采',
    '购买物资',
    '采购商品',
    '采购物资',
    '直采',
    '直购',
    '采购',
    '购买',
    '买入',
    'buy_item',
    'purchase',
    'buy',
  ],
  竞拍出价: ['竞拍出价', '参与竞拍', '加价', '举牌竞价', '叫价', '出价', '竞价', '竞拍', 'bid', 'place_bid'],
  拍卖竞得落槌: [
    '拍卖竞得落槌',
    '竞得落槌',
    '竞拍成交',
    '竞得拍品',
    '拍卖成交',
    '竞拍落槌',
    '竞得',
    '拍下',
    '一口价买断',
    'auction_won',
    'auction_buy_settle',
  ],
  拍卖送拍成交: [
    '拍卖送拍成交',
    '送拍落槌',
    '送拍结算',
    '委托成交',
    '送拍成交',
    '寄售成交',
    '我方拍品成交',
    'auction_sold',
    'consignment_settle',
  ],
  上架送拍: ['上架送拍', '委托送拍', '送拍上架', '寄售送拍', '送拍', '寄售', 'list_auction', 'consign_auction'],
  撤拍: [
    '撤拍',
    '取消送拍',
    '主动撤拍',
    '撤回拍品',
    '下架拍品',
    '撤回送拍',
    '取消拍卖',
    '下架送拍',
    '流拍',
    '拍品流拍',
    '拍卖流拍',
    '下架',
    '取消',
    '撤回',
    'cancel_auction',
    'withdraw_auction',
    'pass_auction',
  ],
};

function resolveSettlementAction(raw: unknown): CanonicalSettlementAction | null {
  const c = canon(raw);
  if (!c) return null;
  for (const [canonicalAction, aliases] of Object.entries(SETTLEMENT_ACTION_ALIASES) as Array<
    [CanonicalSettlementAction, readonly string[]]
  >) {
    if (aliases.some(alias => canon(alias) === c)) {
      return canonicalAction;
    }
  }
  return null;
}

/**
 * 根据资源名称与数量，优先在 data.economy.resources 六柱既有键中匹配同名资源，否则按名称语义推断柱位
 */
function resolveResourceDeductByNameAndQty(
  data: StatData,
  rawName: string,
  qty: number,
): DarknetResourceMap | null {
  const cleanName = String(rawName ?? '')
    .trim()
    .replace(/\s*[×xX*]\s*\d+(?:\.\d+)?\s*$/, '')
    .trim();
  if (!cleanName || !(qty > 0)) return null;

  const res = data.economy.resources;
  const pillars: CanonicalResourcePillar[] = [
    'minerals',
    'energy',
    'materials',
    'nanites',
    'munitions',
    'logistics',
    'fuel',
  ];
  if (res) {
    for (const pillar of pillars) {
      const pMap = res[pillar];
      if (!pMap || typeof pMap !== 'object') continue;
      if (Object.prototype.hasOwnProperty.call(pMap, cleanName)) {
        return DarknetResourceMap.parse({ pillar, key: cleanName, qty: Math.round(qty) });
      }
      const matchedKey = Object.keys(pMap).find(k => canon(k) === canon(cleanName));
      if (matchedKey) {
        return DarknetResourceMap.parse({ pillar, key: matchedKey, qty: Math.round(qty) });
      }
    }
  }
  const inferred = inferResourcePillarAndKey(cleanName);
  return DarknetResourceMap.parse({
    pillar: inferred.pillar,
    key: inferred.key,
    qty: Math.round(qty),
  });
}

/**
 * 尝试从 economy.resources 扣减指定六柱资源；
 * 若库存不足（或为 null / undefined / 0），返回 ok: false，绝不修改库存！
 */
function tryDeductResource(
  data: StatData,
  deduct: DarknetResourceMap,
): { ok: boolean; reason?: string; actualKey?: string; before?: number | null; after?: number } {
  const pillar = normalizeResourcePillar(deduct.pillar);
  if (!pillar) {
    return { ok: false, reason: `未知的资源柱「${deduct.pillar}」` };
  }
  const qty = Math.max(0, deduct.qty);
  if (qty === 0) return { ok: true };

  const res = data.economy.resources;
  if (!res || !res[pillar]) {
    return { ok: false, reason: `六柱资源「${pillar}.${deduct.key}」尚未探明解锁（null），无法扣减 ${qty}` };
  }
  const pillarMap = res[pillar];
  const matchedKey =
    Object.prototype.hasOwnProperty.call(pillarMap, deduct.key)
      ? deduct.key
      : Object.keys(pillarMap).find(k => canon(k) === canon(deduct.key)) ?? deduct.key;

  const currentVal = pillarMap[matchedKey];
  if (currentVal === null || currentVal === undefined || !Number.isFinite(currentVal) || currentVal < qty) {
    return {
      ok: false,
      actualKey: matchedKey,
      before: currentVal ?? null,
      reason: `六柱库存不足：「${pillar}.${matchedKey}」当前为 ${currentVal ?? 'null'}，不足以扣减 ${qty}`,
    };
  }

  const nextVal = currentVal - qty;
  pillarMap[matchedKey] = nextVal;
  return { ok: true, actualKey: matchedKey, before: currentVal, after: nextVal };
}

/**
 * 向 economy.resources 充入指定六柱资源（若原为 null / undefined 则自动解锁并置为 qty）
 */
function creditResourceMap(
  data: StatData,
  map: DarknetResourceMap,
): { ok: boolean; reason?: string } {
  const pillar = normalizeResourcePillar(map.pillar);
  if (!pillar) {
    return { ok: false, reason: `未知或缺失的资源柱「${map.pillar || '空'}」` };
  }
  if (!map.key) {
    return { ok: false, reason: `六柱资源「${pillar}」缺少具体物资键名` };
  }
  if (!(map.qty > 0)) {
    return { ok: false, reason: `六柱资源「${pillar}.${map.key}」入库数量必须为正数（当前: ${map.qty}）` };
  }

  if (!data.economy.resources) {
    data.economy.resources = EconomyResources.parse({});
  }
  const pillarMap = data.economy.resources[pillar];
  const matchedKey =
    Object.prototype.hasOwnProperty.call(pillarMap, map.key)
      ? map.key
      : Object.keys(pillarMap).find(k => canon(k) === canon(map.key)) ?? map.key;

  const cur = pillarMap[matchedKey];
  const baseVal = typeof cur === 'number' && Number.isFinite(cur) ? cur : 0;
  pillarMap[matchedKey] = baseVal + map.qty;
  if (pillar === 'nanites') {
    (data.economy as unknown as Record<string, unknown>).nanites = pillarMap;
  }
  return { ok: true };
}

function appendLedgerRecord(darknet: DarknetState, rec: DarknetSettlementRecord): void {
  darknet.ledger.push(DarknetSettlementRecord.parse(rec));
  if (darknet.ledger.length > MAX_LEDGER_RECORDS) {
    darknet.ledger = darknet.ledger.slice(-MAX_LEDGER_RECORDS);
  }
}

function recordSettleKeys(store: string[], id: string, label: string, prefix: 'target' | 'name'): void {
  const idKey = id ? `id:${canon(id)}` : '';
  const labelKey = label ? `${prefix}:${canon(label)}` : '';
  if (idKey && !store.includes(idKey)) store.push(idKey);
  if (labelKey && !store.includes(labelKey)) store.push(labelKey);
}

function isSettledKey(store: readonly string[], id: string, label: string, prefix: 'target' | 'name'): boolean {
  return id ? store.includes(`id:${canon(id)}`) : Boolean(label && store.includes(`${prefix}:${canon(label)}`));
}

/**
 * 解析单个 <暗网> 块并作用到 StatData（纯确定性三色门 + 账本交割）
 */
export function applyDarknetBlockToState(
  rawBlock: string,
  data: StatData,
  options: { currentDay?: number } = {},
): ApplyDarknetResult {
  const events: ParseEvent[] = [];
  const quarantine: QuarantineItem[] = [];
  let appliedCount = 0;

  const inner = String(rawBlock ?? '')
    .replace(new RegExp(`^\\s*[<\\uFF1C]\\s*(?:${DARKNET_TAG_NAMES})\\s*[>\\uFF1E]`), '')
    .replace(new RegExp(`[<\\uFF1C]\\s*\\/\\s*(?:${DARKNET_TAG_NAMES})\\s*[>\\uFF1E]\\s*$`), '')
    .trim();

  if (!inner) {
    return { events, quarantine, appliedCount };
  }

  let parsedObj: unknown;
  try {
    parsedObj = parseString(preprocess(inner));
  } catch (e) {
    quarantine.push({
      scope: 'block',
      tag: '暗网',
      raw: inner,
      error: errText(e),
      suggestion: '检查 <暗网> 块内 YAML 缩进与冒号格式',
    });
    return { events, quarantine, appliedCount };
  }

  if (Array.isArray(parsedObj)) {
    parsedObj = { 本轮交割: parsedObj };
  } else if (isUsable(parsedObj)) {
    const rawMap = parsedObj as Record<string, unknown>;
    const topCategories = [
      '市场状态', '连接状态', '信道状态', 'market_status',
      '拍卖状态', '拍卖会状态', 'auction_status',
      '距离下次拍卖', '下次拍卖倒计时', '下次拍卖', '拍卖倒计时', 'next_auction_in_minutes',
      '在售商品', '市场商品', '黑市商品', '货架商品', '货架', '商品', '黑市', '直购', '行情', '市场', '物品', 'items', 'market',
      '求购悬赏', '悬赏单', '悬赏列表', '悬赏', '求购', '悬赏榜', '赏金', 'bounties',
      '当期拍卖', '拍卖行', '拍卖列表', '专场拍卖', '拍品', '拍卖', '拍卖厅', '拍卖会', '竞拍', 'auctions',
      '本轮交割', '本轮操作', '交割记录', '交易结算', '订单列表', '订单', '交割', '交易', '结算', 'orders', 'settlements', 'deliveries', 'transactions',
    ].map(k => canon(k));
    const hasTopCategory =
      Object.keys(rawMap).some(k => topCategories.includes(canon(k))) ||
      Object.entries(rawMap).some(([k, v]) => canon(k) === canon('动作') && Array.isArray(v));
    if (!hasTopCategory) {
      const directOrderKeys = [
        '动作', '类型', '操作', 'action', 'type',
        '编号', '商品编号', 'id',
        '标的', '名称', '目标', '商品', 'target', 'name',
        ...RESOURCE_MAP_ALIASES,
      ].map(k => canon(k));
      if (Object.keys(rawMap).some(k => directOrderKeys.includes(canon(k)))) {
        parsedObj = { 本轮交割: [rawMap] };
      }
    }
  }

  if (!isUsable(parsedObj) || Array.isArray(parsedObj)) {
    quarantine.push({
      scope: 'block',
      tag: '暗网',
      raw: inner,
      error: '<暗网> 块解析结果必须为键值映射对象',
      suggestion: '顶层应包含 市场状态 / 在售商品 / 求购悬赏 / 当期拍卖 / 本轮交割 等键',
    });
    return { events, quarantine, appliedCount };
  }

  const src = parsedObj as Record<string, unknown>;
  const idx = keyIndex(src);
  const consumed = new Set<string>();

  const darknet: DarknetState = DarknetState.parse(data.economy.darknet ?? {});
  data.economy.darknet = darknet;

  // 同步本块生效前已处于终态的悬赏与拍品至持久查重集，防目录刷新或超出20条流水后重复交割及终态复活，
  // 同时允许同一 <暗网> 块既在列表标「已完成/已成交」又在「本轮交割」执行当期结算。
  const expiredBountyKeys = new Set<string>();
  for (const b of darknet.bounties) {
    if (b.status === 'completed') {
      recordSettleKeys(darknet.completed_bounty_ids, b.id, b.target, 'target');
    } else if (b.status === 'expired') {
      expiredBountyKeys.add(b.id ? `id:${canon(b.id)}` : `target:${canon(b.target)}`);
    }
  }
  const passedAuctionKeys = new Set<string>();
  for (const a of darknet.auctions) {
    if (a.status === 'sold') {
      recordSettleKeys(darknet.settled_auction_ids, a.id, a.name, 'name');
    } else if (a.status === 'passed' || a.status === 'cancelled') {
      passedAuctionKeys.add(a.id ? `id:${canon(a.id)}` : `name:${canon(a.name)}`);
    }
  }

  // 1. 市场状态
  const marketStatusT = take(src, idx, consumed, ['市场状态', '连接状态', '信道状态', 'market_status']);
  if (marketStatusT && marketStatusT.value != null) {
    const ms = String(marketStatusT.value).trim();
    if (ms) {
      darknet.market_status = ms;
      appliedCount++;
    }
  } else if (darknet.market_status === '未接入') {
    darknet.market_status = '正常连接';
  }

  // 2. 拍卖状态
  const auctionStatusT = take(src, idx, consumed, ['拍卖状态', '拍卖会状态', 'auction_status']);
  let explicitAuctionStatus: 'closed' | 'bidding' | 'open' | 'settled' | null = null;
  if (auctionStatusT && auctionStatusT.value != null) {
    explicitAuctionStatus = normalizeAuctionGlobalStatus(auctionStatusT.value);
    darknet.auction_status = explicitAuctionStatus;
    appliedCount++;
  }

  // 3. 距离下次拍卖
  const nextAuctionT = take(src, idx, consumed, [
    '距离下次拍卖',
    '下次拍卖倒计时',
    '下次拍卖',
    '拍卖倒计时',
    'next_auction_in_minutes',
  ]);
  if (nextAuctionT && nextAuctionT.value != null) {
    const mins = parseAuctionCountdownMinutes(nextAuctionT.value);
    if (mins !== null) {
      darknet.next_auction_in_minutes = mins;
      if (mins === 0 && explicitAuctionStatus === null) {
        darknet.auction_status = 'bidding';
      }
      appliedCount++;
    }
  }

  // 4. 在售商品
  const itemsT = take(src, idx, consumed, [
    '在售商品',
    '市场商品',
    '黑市商品',
    '货架商品',
    '货架',
    '商品',
    '黑市',
    '直购',
    '行情',
    '市场',
    '物品',
    'items',
    'market',
  ]);
  if (itemsT) {
    const mappedItems: DarknetMarketItem[] = [];
    for (const [i, rawItem] of asArray(itemsT.value).entries()) {
      const item = mapMarketItem(rawItem, i);
      if (item) mappedItems.push(item);
    }
    darknet.items = mappedItems;
    appliedCount++;
  }

  // 5. 求购悬赏
  const bountiesT = take(src, idx, consumed, [
    '求购悬赏',
    '悬赏单',
    '悬赏列表',
    '悬赏',
    '求购',
    '悬赏榜',
    '赏金',
    'bounties',
  ]);
  if (bountiesT) {
    const mappedBounties: DarknetBountyItem[] = [];
    for (const [i, rawBounty] of asArray(bountiesT.value).entries()) {
      const b = mapBountyItem(rawBounty, i);
      if (!b) continue;
      if (isSettledKey(darknet.completed_bounty_ids, b.id, b.target, 'target')) {
        b.status = 'completed';
      } else if (expiredBountyKeys.has(b.id ? `id:${canon(b.id)}` : `target:${canon(b.target)}`)) {
        b.status = 'expired';
      }
      mappedBounties.push(b);
    }
    darknet.bounties = mappedBounties;
    appliedCount++;
  }

  // 6. 当期拍卖
  const prevAuctions = Array.isArray(darknet.auctions) ? [...darknet.auctions] : [];
  const refundedInBlockAuctionKeys = new Set<string>();
  const auctionsT = take(src, idx, consumed, [
    '当期拍卖',
    '拍卖行',
    '拍卖列表',
    '专场拍卖',
    '拍品',
    '拍卖',
    '拍卖厅',
    '拍卖会',
    '竞拍',
    'auctions',
  ]);
  if (auctionsT) {
    const mappedAuctions: DarknetAuctionItem[] = [];
    let allMatchedPrev = true;
    for (const [i, rawAuc] of asArray(auctionsT.value).entries()) {
      const a = mapAuctionItem(rawAuc, i);
      if (!a) continue;
      const prevMatched = prevAuctions.find(
        pa => pa && (a.id && pa.id ? canon(pa.id) === canon(a.id) : canon(pa.name) === canon(a.name)),
      );
      if (!prevMatched) {
        allMatchedPrev = false;
      } else {
        if (a.name === a.id && prevMatched.name && prevMatched.name !== prevMatched.id) {
          a.name = prevMatched.name;
        }
        if (prevMatched.category && !a.category) {
          a.category = prevMatched.category;
        }
        if (prevMatched.resource_map && !a.resource_map) {
          a.resource_map = prevMatched.resource_map;
        }
        if (isPlayerParty(prevMatched.seller) && a.seller === '跨维匿名卖方') {
          a.seller = prevMatched.seller;
        } else if (prevMatched.seller && a.seller === '跨维匿名卖方') {
          a.seller = prevMatched.seller;
        }
        if (a.start_price === 0 && prevMatched.start_price > 0) {
          a.start_price = prevMatched.start_price;
        }
        if (a.current_price === 0 && prevMatched.current_price > 0) {
          a.current_price = prevMatched.current_price;
        }
        if (prevMatched.buyout_price !== undefined && a.buyout_price === undefined) {
          a.buyout_price = prevMatched.buyout_price;
        }
        if (prevMatched.consign_deducted && a.consign_deducted === undefined) {
          a.consign_deducted = true;
        }
        if (prevMatched.refunded && a.refunded === undefined) {
          a.refunded = true;
        }
      }
      const aucKey = a.id ? `id:${canon(a.id)}` : `name:${canon(a.name)}`;
      const alreadySettled = isSettledKey(darknet.settled_auction_ids, a.id, a.name, 'name');
      const alreadyPassed = passedAuctionKeys.has(aucKey);

      if (alreadyPassed) {
        if (prevMatched?.status === 'cancelled') {
          a.status = 'cancelled';
        } else if (a.status !== 'cancelled') {
          a.status = 'passed';
        }
      } else if (alreadySettled) {
        a.status = 'sold';
      } else if (
        a.status === 'bidding' &&
        isPlayerParty(a.seller) &&
        !a.consign_deducted &&
        a.resource_map &&
        a.resource_map.qty > 0
      ) {
        // BUG-R2-23：我方在 <暗网> 拍卖列表中直接挂出竞拍中寄售拍品且尚未扣减库存时，自动从 economy.resources 实扣托管库存并标记 consign_deducted
        const deductRes = tryDeductResource(data, a.resource_map);
        if (deductRes.ok) {
          a.consign_deducted = true;
          events.push({
            light: '🟢',
            layer: 'instruction',
            path: 'economy.darknet.auctions',
            message: `[暗网寄售扣库] 我方送拍品「${a.name}」上架托管，已扣减库存（${a.resource_map.key} ×${a.resource_map.qty}）`,
          });
        } else {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.resources',
            message: `[暗网送拍阻断] 送拍品「${a.name}」库存扣减失败：${deductRes.reason}`,
          });
        }
      } else if (
        (a.status === 'passed' || a.status === 'cancelled') &&
        !a.refunded &&
        (prevMatched ? prevMatched.status === 'bidding' : true) &&
        isPlayerParty(a.seller) &&
        a.resource_map &&
        a.resource_map.qty > 0
      ) {
        // BUG-R2-10 / BUG-R2-23：我方在拍送拍品在当期拍卖列表中变为流拍/撤拍/下架（passed/cancelled）且未退回过时，自动退还托管库存并登记防重
        const creditRes = creditResourceMap(data, a.resource_map);
        if (creditRes.ok) {
          a.refunded = true;
          recordSettleKeys(darknet.settled_auction_ids, a.id, a.name, 'name');
          passedAuctionKeys.add(aucKey);
          refundedInBlockAuctionKeys.add(aucKey);
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.darknet.auctions',
            message: `[暗网拍卖退回] 我方送拍品「${a.name}」流拍/下架，已自动退回托管库存（${a.resource_map.key} ×${a.resource_map.qty}）`,
          });
        }
      }
      mappedAuctions.push(a);
    }
    if (mappedAuctions.length > 0 && allMatchedPrev && mappedAuctions.length < prevAuctions.length) {
      for (const prevLot of prevAuctions) {
        const existsInMapped = mappedAuctions.some(
          ma => (ma.id && prevLot.id ? canon(ma.id) === canon(prevLot.id) : canon(ma.name) === canon(prevLot.name)),
        );
        if (!existsInMapped) {
          mappedAuctions.push(prevLot);
        }
      }
    }
    darknet.auctions = mappedAuctions;
    if (mappedAuctions.length > 0 && explicitAuctionStatus === null) {
      darknet.auction_status = mappedAuctions.some(a => a.status === 'bidding') ? 'bidding' : 'settled';
    }
    appliedCount++;
  }

  // 7. 本轮交割
  const settlementsT = take(src, idx, consumed, [
    '本轮交割',
    '本轮操作',
    '交割记录',
    '交易结算',
    '订单列表',
    '订单',
    '交割',
    '交易',
    '结算',
    '动作',
    'orders',
    'settlements',
    'deliveries',
    'transactions',
  ]);
  const currentDay = options.currentDay ?? data.clock?.day ?? data.meta?.day_count ?? 0;
  const handledByExplicitSettlementKeys = new Set<string>();

  if (settlementsT) {
    for (const [sIdx, rawSettle] of asArray(settlementsT.value).entries()) {
      if (!isUsable(rawSettle) || Array.isArray(rawSettle)) {
        quarantine.push({
          scope: 'element',
          tag: '暗网',
          path: `暗网.本轮交割[${sIdx}]`,
          raw: JSON.stringify(rawSettle),
          error: '本轮交割条目必须为对象',
        });
        continue;
      }

      const sObj = rawSettle as Record<string, unknown>;
      const sKeyIdx = keyIndex(sObj);
      const sConsumed = new Set<string>();

      const actionT = take(sObj, sKeyIdx, sConsumed, ['动作', '类型', '操作', 'action', 'type']);
      const idT = take(sObj, sKeyIdx, sConsumed, ['编号', '拍品编号', '商品编号', '悬赏编号', '订单编号', 'id']);
      const targetT = take(sObj, sKeyIdx, sConsumed, ['标的', '名称', '目标', '拍品', '商品', 'target', 'name']);
      const deltaT = take(sObj, sKeyIdx, sConsumed, [
        '资金变动',
        '结算资金',
        '金额',
        '花费',
        '总价',
        '费用',
        '报酬',
        '赏金',
        '收益',
        'credits_delta',
        'delta',
        'cost',
        'amount',
      ]);
      const bidT = take(sObj, sKeyIdx, sConsumed, ['出价', '竞拍价', '价格', '成交价', 'bid', 'price']);
      const startPriceT = take(sObj, sKeyIdx, sConsumed, ['起拍价', '底价', 'start_price']);
      const leaderT = take(sObj, sKeyIdx, sConsumed, [
        '领先方',
        '领先者',
        '当前领先',
        '出价者',
        '竞拍者',
        '竞价方',
        '竞买人',
        '出价方',
        '买方',
        'bidder',
        'leader',
      ]);
      const qtyT = take(sObj, sKeyIdx, sConsumed, ['数量', '份额', '数额', 'qty', 'count', 'quantity']);
      const roundT = take(sObj, sKeyIdx, sConsumed, ['轮次', '当前轮次', 'round_text', 'round']);
      const dedupeT = take(sObj, sKeyIdx, sConsumed, ['查重键', '情报编号', '唯一键', 'dedupe_key', 'intel_id']);
      const deductT = take(sObj, sKeyIdx, sConsumed, [
        '资源扣减',
        '扣减资源',
        '实物扣减',
        'resource_deduct',
        'resourceDeduct',
      ]);
      const resMapT = take(sObj, sKeyIdx, sConsumed, RESOURCE_MAP_ALIASES);
      const statusT = take(sObj, sKeyIdx, sConsumed, ['状态', '交割状态', '订单状态', 'status']);
      const noteT = take(sObj, sKeyIdx, sConsumed, ['说明', '备注', '摘要', 'note', 'desc']);

      const action =
        resolveSettlementAction(actionT?.value) ??
        (!actionT && resMapT && (deltaT || bidT) ? '购买商品' : null);

      if (
        action !== '撤拍' &&
        statusT &&
        ['待交割', '未交割', '进行中', '运输中', '待付款', '已取消', 'pending', 'open', 'cancelled'].includes(
          canon(statusT.value),
        )
      ) {
        continue;
      }

      const idStr = String(idT?.value ?? '').trim();
      const targetStr = String(targetT?.value ?? '').trim() || idStr;

      if (!action || !targetStr) {
        quarantine.push({
          scope: 'element',
          tag: '暗网',
          path: `暗网.本轮交割[${sIdx}]`,
          raw: JSON.stringify(sObj),
          error: !action ? `未知或缺失的交割动作「${String(actionT?.value ?? '')}」` : '交割条目缺少标的或编号',
          suggestion:
            '标准动作：售出实物 | 售出信息 | 完成悬赏 | 购买商品 | 竞拍出价 | 拍卖竞得落槌 | 拍卖送拍成交 | 上架送拍 | 撤拍',
        });
        continue;
      }

      const parsedDelta = parseFlexibleNumber(deltaT?.value);
      const parsedBid = parseFlexibleNumber(bidT?.value);
      if (parsedDelta.hadUnitSuffix) {
        events.push({
          light: '🟡',
          layer: 'L2',
          path: `暗网.本轮交割[${sIdx}].资金变动`,
          message: `[暗网] 资金变动「${String(deltaT?.value)}」含单位后缀，已剥离归一为 ${parsedDelta.value}`,
          before: deltaT?.value,
          after: parsedDelta.value,
        });
      }
      if (parsedBid.hadUnitSuffix) {
        events.push({
          light: '🟡',
          layer: 'L2',
          path: `暗网.本轮交割[${sIdx}].出价`,
          message: `[暗网] 出价「${String(bidT?.value)}」含单位后缀，已剥离归一为 ${parsedBid.value}`,
          before: bidT?.value,
          after: parsedBid.value,
        });
      }

      const rawCreditsDelta = parsedDelta.value ?? 0;
      const bidValue = parsedBid.value;
      const noteStr = String(noteT?.value ?? '').trim();
      const recordId = idStr || `dn_tx_${currentDay}_${darknet.ledger.length + 1}`;
      const resourceDeductList = deductT ? parseResourceMapList(deductT.value) : undefined;
      const resourceDeduct = resourceDeductList?.[0] ?? (deductT ? parseResourceMap(deductT.value) : undefined);
      const resourceMapList = resMapT ? parseResourceMapList(resMapT.value) : undefined;
      const resourceMap = resourceMapList?.[0];
      const parsedQty = qtyT ? parseFlexibleNumber(qtyT.value).value : null;

      if (action === '售出实物') {
        const deductTargets: DarknetResourceMap[] =
          resourceDeductList && resourceDeductList.length > 0
            ? resourceDeductList
            : resourceDeduct && resourceDeduct.qty > 0
              ? [resourceDeduct]
              : resourceMapList && resourceMapList.length > 0
                ? resourceMapList
                : parsedQty !== null && parsedQty > 0
                  ? (() => {
                      const byName = resolveResourceDeductByNameAndQty(data, targetStr, parsedQty);
                      return byName ? [byName] : [];
                    })()
                  : [];

        let deductFailedReason: string | undefined;
        for (const dt of deductTargets) {
          if (dt.qty > 0) {
            const check = tryDeductResource(data, dt);
            if (!check.ok) {
              deductFailedReason = check.reason;
              break;
            }
          }
        }
        if (deductFailedReason) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.resources',
            message: `[暗网交割阻断] 售出实物「${targetStr}」失败：${deductFailedReason}（未扣库存、未加资金）`,
          });
          continue;
        }
        const gain = Math.max(0, Math.round(Math.abs(rawCreditsDelta || (bidValue ?? 0))));
        data.economy.credits = Math.round((data.economy.credits ?? 0) + gain);
        appendLedgerRecord(darknet, {
          id: recordId,
          action: '售出实物',
          target: targetStr,
          credits_delta: gain,
          note: noteStr || '实物投递变现完成',
          at_day: currentDay,
        });
        events.push({
          light: '🟢',
          layer: 'instruction',
          path: 'economy.darknet',
          message: `[暗网交割] 售出实物「${targetStr}」：+${gain} Credits`,
        });
        appliedCount++;
        continue;
      }

      if (action === '售出信息') {
        const rawDedupe = String(dedupeT?.value ?? '').trim();
        const dedupeKey = rawDedupe || canon(targetStr);
        const alreadySold = darknet.sold_intel_ids.some(existing => canon(existing) === canon(dedupeKey));
        if (alreadySold) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.darknet.sold_intel_ids',
            message: `[暗网查重拦截] 情报「${targetStr}」（查重键: ${dedupeKey}）已存在售出记录，重复上传收益强制归 0`,
          });
          appendLedgerRecord(darknet, {
            id: recordId,
            action: '售出信息',
            target: targetStr,
            credits_delta: 0,
            note: `重复情报查重拦截（${dedupeKey}），收益归零`,
            at_day: currentDay,
          });
          appliedCount++;
          continue;
        }
        darknet.sold_intel_ids.push(dedupeKey);
        const gain = Math.max(0, Math.round(Math.abs(rawCreditsDelta || (bidValue ?? 0))));
        data.economy.credits = Math.round((data.economy.credits ?? 0) + gain);
        appendLedgerRecord(darknet, {
          id: recordId,
          action: '售出信息',
          target: targetStr,
          credits_delta: gain,
          note: noteStr || `首次上传唯一性情报（${dedupeKey}）`,
          at_day: currentDay,
        });
        events.push({
          light: '🟢',
          layer: 'instruction',
          path: 'economy.darknet',
          message: `[暗网交割] 售出信息「${targetStr}」（${dedupeKey}）：+${gain} Credits`,
        });
        appliedCount++;
        continue;
      }

      if (action === '完成悬赏') {
        const matchedBounty = darknet.bounties.find(
          b => (idStr ? canon(b.id) === canon(idStr) : canon(b.target) === canon(targetStr)),
        );
        const bountyId = idStr || matchedBounty?.id || '';
        const bountyTarget = matchedBounty?.target ?? targetStr;

        if (
          isSettledKey(darknet.completed_bounty_ids, bountyId, bountyTarget, 'target') ||
          matchedBounty?.status === 'expired' ||
          expiredBountyKeys.has(bountyId ? `id:${canon(bountyId)}` : `target:${canon(bountyTarget)}`)
        ) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.darknet.bounties',
            message: `[暗网悬赏拦截] 悬赏「${targetStr}」已完成交割，禁止重复领赏`,
          });
          continue;
        }

        if (resourceDeduct && resourceDeduct.qty > 0) {
          const check = tryDeductResource(data, resourceDeduct);
          if (!check.ok) {
            events.push({
              light: '🟡',
              layer: 'instruction',
              path: 'economy.resources',
              message: `[暗网交割阻断] 完成悬赏「${targetStr}」实物扣减失败：${check.reason}`,
            });
            // 既往成功交割已在上游拦截；撤销本块列表预报的完成态，允许补货重试。
            if (matchedBounty?.status === 'completed') matchedBounty.status = 'open';
            continue;
          }
        }

        if (matchedBounty) {
          matchedBounty.status = 'completed';
        }
        recordSettleKeys(darknet.completed_bounty_ids, bountyId, bountyTarget, 'target');

        const reward = Math.max(
          0,
          Math.round(Math.abs(rawCreditsDelta !== 0 ? rawCreditsDelta : (matchedBounty?.reward_credits ?? bidValue ?? 0))),
        );
        data.economy.credits = Math.round((data.economy.credits ?? 0) + reward);
        appendLedgerRecord(darknet, {
          id: recordId,
          action: '完成悬赏',
          target: matchedBounty?.target ?? targetStr,
          credits_delta: reward,
          note: noteStr || '求购悬赏交割完成',
          at_day: currentDay,
        });
        events.push({
          light: '🟢',
          layer: 'instruction',
          path: 'economy.darknet.bounties',
          message: `[暗网交割] 完成悬赏「${matchedBounty?.target ?? targetStr}」：+${reward} Credits`,
        });
        appliedCount++;
        continue;
      }

      if (action === '购买商品') {
        if (idStr && darknet.ledger.some(r => r.id && canon(r.id) === canon(idStr) && r.action === '购买商品')) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.darknet.ledger',
            message: `[暗网采购拦截] 订单「${targetStr}」（${idStr}）已完成交割入账，防重复扣款与入库`,
          });
          continue;
        }
        const matchedItem = darknet.items.find(
          item => (idStr && canon(item.id) === canon(idStr)) || canon(item.name) === canon(targetStr),
        );
        const cost = Math.max(
          0,
          Math.round(Math.abs(rawCreditsDelta !== 0 ? rawCreditsDelta : (bidValue ?? matchedItem?.price ?? 0))),
        );
        if (matchedItem && matchedItem.stock <= 0) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.darknet.items',
            message: `[暗网采购阻断] 商品「${targetStr}」库存已售罄（stock=0）`,
          });
          continue;
        }
        if ((data.economy.credits ?? 0) < cost) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.credits',
            message: `[暗网采购阻断] 购买「${targetStr}」需 ${cost} Credits，当前余额 ${data.economy.credits ?? 0} 不足`,
          });
          continue;
        }

        const effectiveResMaps =
          resourceMapList && resourceMapList.length > 0
            ? resourceMapList
            : matchedItem?.resource_map
              ? [matchedItem.resource_map]
              : [];
        let invalidResReason: string | undefined;
        for (const rm of effectiveResMaps) {
          const pillar = normalizeResourcePillar(rm.pillar);
          if (!pillar) {
            invalidResReason = `未知或缺失的资源柱「${rm.pillar || '空'}」`;
            break;
          }
          if (!rm.key) {
            invalidResReason = `六柱资源「${pillar}」缺少具体物资键名`;
            break;
          }
          if (!(rm.qty > 0)) {
            invalidResReason = `六柱资源「${pillar}.${rm.key}」入库数量必须为正数（当前: ${rm.qty}）`;
            break;
          }
        }
        if (invalidResReason) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.resources',
            message: `[暗网采购阻断] 购买「${targetStr}」入库映射无效：${invalidResReason}`,
          });
          continue;
        }
        for (const rm of effectiveResMaps) {
          creditResourceMap(data, rm);
        }
        data.economy.credits = Math.round((data.economy.credits ?? 0) - cost);
        if (matchedItem) {
          matchedItem.stock = Math.max(0, matchedItem.stock - 1);
        }
        appendLedgerRecord(darknet, {
          id: recordId,
          action: '购买商品',
          target: matchedItem?.name ?? targetStr,
          credits_delta: -cost,
          note: noteStr || '暗网黑市直购入库',
          at_day: currentDay,
        });
        events.push({
          light: '🟢',
          layer: 'instruction',
          path: 'economy.darknet.items',
          message: `[暗网交割] 购买商品「${matchedItem?.name ?? targetStr}」：-${cost} Credits`,
        });
        appliedCount++;
        continue;
      }

      if (action === '竞拍出价') {
        let matchedAuction = darknet.auctions.find(
          a => (idStr ? canon(a.id) === canon(idStr) : canon(a.name) === canon(targetStr)),
        );
        const aucId = idStr || matchedAuction?.id || '';
        const aucName = matchedAuction?.name ?? targetStr;
        if (
          isSettledKey(darknet.settled_auction_ids, aucId, aucName, 'name') ||
          matchedAuction?.status === 'sold' ||
          matchedAuction?.status === 'passed' ||
          matchedAuction?.status === 'cancelled' ||
          passedAuctionKeys.has(aucId ? `id:${canon(aucId)}` : `name:${canon(aucName)}`)
        ) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.darknet.auctions',
            message: `[暗网拍卖拦截] 拍品「${aucName}」已结束竞拍，禁止重新出价`,
          });
          continue;
        }
        const bidAmount = Math.max(0, Math.round(Math.abs(bidValue ?? rawCreditsDelta)));
        const leaderName = String(leaderT?.value ?? '我方指挥部').trim() || '我方指挥部';
        const roundName = String(roundT?.value ?? '').trim();

        if (!matchedAuction) {
          matchedAuction = DarknetAuctionItem.parse({
            id: idStr || `dn_auc_${darknet.auctions.length + 1}`,
            name: targetStr,
            seller: '跨维匿名卖方',
            start_price: bidAmount,
            current_price: bidAmount,
            leader: leaderName,
            round_text: roundName || '第1轮',
            status: 'bidding',
            desc: noteStr,
            ...(resourceMap ? { resource_map: resourceMap } : {}),
          });
          darknet.auctions.push(matchedAuction);
        } else {
          // BUG-R2-10：当 bidAmount < matchedAuction.current_price 时仅发出 warning，不降低最高价，也不覆盖 leader
          if (bidAmount < matchedAuction.current_price) {
            events.push({
              light: '🟡',
              layer: 'instruction',
              path: 'economy.darknet.auctions',
              message: `[暗网竞拍提示] 拍品「${matchedAuction.name}」出价 ${bidAmount} 低于原最高价 ${matchedAuction.current_price}`,
            });
            matchedAuction.current_price = Math.max(matchedAuction.current_price, bidAmount);
          } else {
            if (bidAmount > 0) {
              matchedAuction.current_price = Math.max(matchedAuction.current_price, bidAmount);
            }
            matchedAuction.leader = leaderName;
          }
          if (roundName) matchedAuction.round_text = roundName;
          matchedAuction.status = 'bidding';
        }

        // BUG-R2-10：仅当出价领先方为我方且叫价超出我方余额时才发验资预警，防 NPC 抬价误报
        if (isPlayerParty(leaderName) && bidAmount > (data.economy.credits ?? 0)) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.darknet.auctions',
            message: `[暗网验资预警] 拍品「${matchedAuction.name}」当前叫价 ${bidAmount} 超出指挥部现有系统资金（${data.economy.credits ?? 0}）`,
          });
        }

        darknet.auction_status = 'bidding';
        appendLedgerRecord(darknet, {
          id: recordId,
          action: '竞拍出价',
          target: matchedAuction.name,
          credits_delta: 0,
          note: noteStr || `出价 ${matchedAuction.current_price}（领先方：${matchedAuction.leader}，落槌前不扣款）`,
          at_day: currentDay,
        });
        events.push({
          light: '🟢',
          layer: 'instruction',
          path: 'economy.darknet.auctions',
          message: `[暗网拍卖] 拍品「${matchedAuction.name}」更新叫价至 ${matchedAuction.current_price}（${matchedAuction.leader}，未落槌不扣款）`,
        });
        appliedCount++;
        continue;
      }

      if (action === '拍卖竞得落槌') {
        let matchedAuction = darknet.auctions.find(
          a => (idStr ? canon(a.id) === canon(idStr) : canon(a.name) === canon(targetStr)),
        );
        if (!matchedAuction) {
          matchedAuction = prevAuctions.find(
            a => a && (idStr ? canon(a.id) === canon(idStr) : canon(a.name) === canon(targetStr)),
          );
          if (matchedAuction) {
            darknet.auctions.push(matchedAuction);
          }
        }
        const aucId = idStr || matchedAuction?.id || '';
        const aucName = matchedAuction?.name ?? targetStr;
        const aucKey = aucId ? `id:${canon(aucId)}` : `name:${canon(aucName)}`;
        handledByExplicitSettlementKeys.add(aucKey);

        if (
          isSettledKey(darknet.settled_auction_ids, aucId, aucName, 'name') ||
          matchedAuction?.status === 'passed' ||
          matchedAuction?.status === 'cancelled' ||
          passedAuctionKeys.has(aucKey)
        ) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.darknet.auctions',
            message: `[暗网拍卖拦截] 拍品「${targetStr}」已落槌结算，防重复扣款`,
          });
          continue;
        }

        const price = Math.max(
          0,
          Math.round(
            Math.abs(
              rawCreditsDelta !== 0
                ? rawCreditsDelta
                : (bidValue ?? matchedAuction?.current_price ?? matchedAuction?.start_price ?? 0),
            ),
          ),
        );

        if ((data.economy.credits ?? 0) < price) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.credits',
            message: `[暗网落槌阻断] 竞得拍品「${targetStr}」需支付 ${price} Credits，当前余额 ${data.economy.credits ?? 0} 不足`,
          });
          // 既往成功落槌已在上游拦截；撤销本块列表预报的成交态，允许补款重试。
          if (matchedAuction?.status === 'sold') matchedAuction.status = 'bidding';
          continue;
        }

        const effectiveResMap = resourceMap ?? matchedAuction?.resource_map;
        if (effectiveResMap) {
          const creditCheck = creditResourceMap(data, effectiveResMap);
          if (!creditCheck.ok) {
            events.push({
              light: '🟡',
              layer: 'instruction',
              path: 'economy.resources',
              message: `[暗网落槌阻断] 竞得拍品「${targetStr}」入库映射无效：${creditCheck.reason}`,
            });
            if (matchedAuction?.status === 'sold') matchedAuction.status = 'bidding';
            continue;
          }
        } else {
          creditNonResourceItem(data, matchedAuction?.name ?? targetStr, matchedAuction?.category);
        }

        data.economy.credits = Math.round((data.economy.credits ?? 0) - price);
        if (!matchedAuction) {
          matchedAuction = DarknetAuctionItem.parse({
            id: idStr || `dn_auc_${darknet.auctions.length + 1}`,
            name: targetStr,
            seller: '跨维匿名卖方',
            start_price: price,
            current_price: price,
            leader: '我方指挥部',
            round_text: String(roundT?.value ?? '最终落槌').trim() || '最终落槌',
            status: 'sold',
            desc: noteStr,
            ...(resourceMap ? { resource_map: resourceMap } : {}),
          });
          darknet.auctions.push(matchedAuction);
        } else {
          matchedAuction.status = 'sold';
          matchedAuction.leader = '我方指挥部';
          if (price > 0) matchedAuction.current_price = price;
          if (roundT?.value) matchedAuction.round_text = String(roundT.value).trim();
        }

        recordSettleKeys(darknet.settled_auction_ids, idStr || matchedAuction.id, matchedAuction.name, 'name');

        appendLedgerRecord(darknet, {
          id: recordId,
          action: '拍卖竞得落槌',
          target: matchedAuction.name,
          credits_delta: -price,
          note: noteStr || '拍卖竞得落槌交割完成',
          at_day: currentDay,
        });
        events.push({
          light: '🟢',
          layer: 'instruction',
          path: 'economy.darknet.auctions',
          message: `[暗网拍卖] 竞得拍品「${matchedAuction.name}」落槌结算：-${price} Credits`,
        });
        appliedCount++;
        continue;
      }

      if (action === '拍卖送拍成交') {
        let matchedAuction = darknet.auctions.find(
          a => (idStr ? canon(a.id) === canon(idStr) : canon(a.name) === canon(targetStr)),
        );
        if (!matchedAuction) {
          matchedAuction = prevAuctions.find(
            a => a && (idStr ? canon(a.id) === canon(idStr) : canon(a.name) === canon(targetStr)),
          );
          if (matchedAuction) {
            darknet.auctions.push(matchedAuction);
          }
        }
        const aucId = idStr || matchedAuction?.id || '';
        const aucName = matchedAuction?.name ?? targetStr;
        const aucKey = aucId ? `id:${canon(aucId)}` : `name:${canon(aucName)}`;
        handledByExplicitSettlementKeys.add(aucKey);

        if (
          isSettledKey(darknet.settled_auction_ids, aucId, aucName, 'name') ||
          matchedAuction?.status === 'passed' ||
          matchedAuction?.status === 'cancelled' ||
          passedAuctionKeys.has(aucKey)
        ) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.darknet.auctions',
            message: `[暗网拍卖拦截] 送拍品「${targetStr}」已落槌入账，防重复收款`,
          });
          continue;
        }

        // BUG-R2-10 / BUG-R2-23：卖方成交归属校验——若 matchedAuction 存在且 seller 明确非空且不是我方，拦截并报警，防误给玩家加钱
        if (
          matchedAuction &&
          matchedAuction.seller.trim() !== '' &&
          !isPlayerParty(matchedAuction.seller)
        ) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.darknet.auctions',
            message: `[暗网拍卖拦截] 拍品「${matchedAuction.name}」卖方为「${matchedAuction.seller}」（非我方指挥部），禁止按我方送拍成交收款`,
          });
          continue;
        }

        const income = Math.max(
          0,
          Math.round(
            Math.abs(
              rawCreditsDelta !== 0
                ? rawCreditsDelta
                : (bidValue ?? matchedAuction?.current_price ?? matchedAuction?.start_price ?? 0),
            ),
          ),
        );

        data.economy.credits = Math.round((data.economy.credits ?? 0) + income);
        if (!matchedAuction) {
          matchedAuction = DarknetAuctionItem.parse({
            id: idStr || `dn_auc_${darknet.auctions.length + 1}`,
            name: targetStr,
            seller: '我方指挥部',
            start_price: income,
            current_price: income,
            leader: String(leaderT?.value ?? '跨维匿名买方').trim() || '跨维匿名买方',
            round_text: String(roundT?.value ?? '最终落槌').trim() || '最终落槌',
            status: 'sold',
            desc: noteStr,
          });
          darknet.auctions.push(matchedAuction);
        } else {
          matchedAuction.status = 'sold';
          if (leaderT?.value) matchedAuction.leader = String(leaderT.value).trim();
          if (income > 0 && rawCreditsDelta === 0) matchedAuction.current_price = income;
        }

        recordSettleKeys(darknet.settled_auction_ids, idStr || matchedAuction.id, matchedAuction.name, 'name');

        appendLedgerRecord(darknet, {
          id: recordId,
          action: '拍卖送拍成交',
          target: matchedAuction.name,
          credits_delta: income,
          note: noteStr || '我方送拍拍品落槌收款',
          at_day: currentDay,
        });
        events.push({
          light: '🟢',
          layer: 'instruction',
          path: 'economy.darknet.auctions',
          message: `[暗网拍卖] 我方送拍「${matchedAuction.name}」落槌成交：+${income} Credits`,
        });
        appliedCount++;
        continue;
      }

      if (action === '撤拍') {
        let matchedAuction = darknet.auctions.find(
          a => (idStr ? canon(a.id) === canon(idStr) : canon(a.name) === canon(targetStr)),
        );
        if (!matchedAuction) {
          matchedAuction = prevAuctions.find(
            a => a && (idStr ? canon(a.id) === canon(idStr) : canon(a.name) === canon(targetStr)),
          );
          if (matchedAuction) {
            darknet.auctions.push(matchedAuction);
          }
        }
        const aucId = idStr || matchedAuction?.id || '';
        const aucName = matchedAuction?.name ?? targetStr;
        const aucKey = aucId ? `id:${canon(aucId)}` : `name:${canon(aucName)}`;
        handledByExplicitSettlementKeys.add(aucKey);

        if (!matchedAuction || !isPlayerParty(matchedAuction.seller)) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.darknet.auctions',
            message: matchedAuction
              ? `[暗网撤拍拦截] 拍品「${matchedAuction.name}」卖方为「${matchedAuction.seller}」（非我方指挥部），无法撤拍`
              : `[暗网撤拍拦截] 未找到我方在拍拍品「${targetStr}」`,
          });
          continue;
        }

        const alreadyRefundedInThisBlock = refundedInBlockAuctionKeys.has(aucKey);
        if (
          !alreadyRefundedInThisBlock &&
          (matchedAuction.refunded ||
            isSettledKey(darknet.settled_auction_ids, aucId, aucName, 'name') ||
            matchedAuction.status === 'sold' ||
            passedAuctionKeys.has(aucKey))
        ) {
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.darknet.auctions',
            message: `[暗网撤拍拦截] 拍品「${matchedAuction.name}」已结算或已撤拍退回，禁止重复退还库存`,
          });
          continue;
        }

        const effectiveResMap = matchedAuction.resource_map ?? resourceMap ?? resourceDeduct;
        if (!alreadyRefundedInThisBlock && effectiveResMap && effectiveResMap.qty > 0) {
          creditResourceMap(data, effectiveResMap);
        }

        const isPassedAction = /流拍|pass|unsold|expire/i.test(String(actionT?.value ?? ''));
        matchedAuction.status = isPassedAction ? 'passed' : 'cancelled';
        matchedAuction.refunded = true;
        recordSettleKeys(darknet.settled_auction_ids, aucId, aucName, 'name');
        passedAuctionKeys.add(aucKey);

        appendLedgerRecord(darknet, {
          id: recordId,
          action: '撤拍',
          target: matchedAuction.name,
          credits_delta: 0,
          note: noteStr || '我方主动撤拍并退回托管实物',
          at_day: currentDay,
        });
        events.push({
          light: '🟢',
          layer: 'instruction',
          path: 'economy.darknet.auctions',
          message: `[暗网拍卖] 我方主动撤拍「${matchedAuction.name}」，实物库存已退回`,
        });
        appliedCount++;
        continue;
      }

      if (action === '上架送拍') {
        const startPrice = Math.max(
          0,
          Math.round(Math.abs(parseFlexibleNumber(startPriceT?.value).value ?? bidValue ?? rawCreditsDelta)),
        );
        let existingAuction = darknet.auctions.find(
          a => (idStr ? canon(a.id) === canon(idStr) : canon(a.name) === canon(targetStr)),
        );
        if (!existingAuction) {
          const prevEscrowed = prevAuctions.find(
            a =>
              a &&
              a.status === 'bidding' &&
              isPlayerParty(a.seller) &&
              (idStr ? canon(a.id) === canon(idStr) : canon(a.name) === canon(targetStr)),
          );
          if (prevEscrowed) {
            existingAuction = prevEscrowed;
            darknet.auctions.push(existingAuction);
          }
        }
        if (existingAuction) {
          if (!isPlayerParty(existingAuction.seller)) {
            existingAuction.seller = '我方指挥部';
          }
          existingAuction.status = 'bidding';
          existingAuction.consign_deducted = true;
          if (startPrice > 0) {
            existingAuction.start_price = startPrice;
            if (
              existingAuction.leader === '等待叫价' ||
              existingAuction.leader === '' ||
              existingAuction.current_price < startPrice
            ) {
              existingAuction.current_price = startPrice;
            }
          }
          const nextRoundText = String(roundT?.value ?? '').trim();
          if (nextRoundText) existingAuction.round_text = nextRoundText;
          if (noteStr) existingAuction.desc = noteStr;
          if (resourceMap && !existingAuction.resource_map) {
            existingAuction.resource_map = resourceMap;
          }
        } else {
          const effectiveDeduct =
            resourceDeduct && resourceDeduct.qty > 0
              ? resourceDeduct
              : resourceMap && resourceMap.qty > 0
                ? resourceMap
                : undefined;
          const effectiveResourceMap = resourceMap ?? resourceDeduct;
          if (effectiveDeduct) {
            const check = tryDeductResource(data, effectiveDeduct);
            if (!check.ok) {
              events.push({
                light: '🟡',
                layer: 'instruction',
                path: 'economy.resources',
                message: `[暗网送拍阻断] 上架送拍「${targetStr}」失败：${check.reason}`,
              });
              continue;
            }
          }
          darknet.auctions.push(
            DarknetAuctionItem.parse({
              id: idStr || `dn_auc_${darknet.auctions.length + 1}`,
              name: targetStr,
              seller: '我方指挥部',
              start_price: startPrice,
              current_price: startPrice,
              leader: '等待叫价',
              round_text: String(roundT?.value ?? '待开拍').trim() || '待开拍',
              status: 'bidding',
              desc: noteStr,
              ...(effectiveResourceMap ? { resource_map: effectiveResourceMap } : {}),
              consign_deducted: true,
            }),
          );
        }

        appendLedgerRecord(darknet, {
          id: recordId,
          action: '上架送拍',
          target: targetStr,
          credits_delta: 0,
          note: noteStr || `委托送拍上架（起拍价 ${startPrice}）`,
          at_day: currentDay,
        });
        events.push({
          light: '🟢',
          layer: 'instruction',
          path: 'economy.darknet.auctions',
          message: `[暗网拍卖] 已上架我方送拍品「${targetStr}」（起拍价 ${startPrice} Credits）`,
        });
        appliedCount++;
      }
    }
  }

  // 8. BUG-R2-23：对通过 <暗网> 拍卖列表直接声明 状态: 成交（且未在同块 交割 列表中单独结算）的拍品执行自动资金/实物交割
  for (const a of darknet.auctions) {
    if (a.status !== 'sold') continue;
    const aucKey = a.id ? `id:${canon(a.id)}` : `name:${canon(a.name)}`;
    if (
      handledByExplicitSettlementKeys.has(aucKey) ||
      isSettledKey(darknet.settled_auction_ids, a.id, a.name, 'name') ||
      passedAuctionKeys.has(aucKey)
    ) {
      continue;
    }
    const dealPrice = Math.max(0, Math.round(a.current_price || a.start_price || 0));
    if (isPlayerParty(a.seller)) {
      data.economy.credits = Math.round((data.economy.credits ?? 0) + dealPrice);
      recordSettleKeys(darknet.settled_auction_ids, a.id, a.name, 'name');
      appendLedgerRecord(darknet, {
        id: a.id || `dn_tx_${currentDay}_${darknet.ledger.length + 1}`,
        action: '拍卖送拍成交',
        target: a.name,
        credits_delta: dealPrice,
        note: '我方送拍拍品落槌收款',
        at_day: currentDay,
      });
      events.push({
        light: '🟢',
        layer: 'instruction',
        path: 'economy.darknet.auctions',
        message: `[暗网拍卖] 我方送拍「${a.name}」落槌成交：+${dealPrice} Credits`,
      });
      appliedCount++;
    } else if (isPlayerParty(a.leader)) {
      if ((data.economy.credits ?? 0) < dealPrice) {
        a.status = 'bidding';
        events.push({
          light: '🟡',
          layer: 'instruction',
          path: 'economy.credits',
          message: `[暗网落槌阻断] 竞得拍品「${a.name}」需支付 ${dealPrice} Credits，当前余额 ${data.economy.credits ?? 0} 不足`,
        });
        continue;
      }
      if (a.resource_map && a.resource_map.qty > 0) {
        const creditCheck = creditResourceMap(data, a.resource_map);
        if (!creditCheck.ok) {
          a.status = 'bidding';
          events.push({
            light: '🟡',
            layer: 'instruction',
            path: 'economy.resources',
            message: `[暗网落槌阻断] 竞得拍品「${a.name}」入库映射无效：${creditCheck.reason}`,
          });
          continue;
        }
      } else {
        creditNonResourceItem(data, a.name, a.category);
      }
      data.economy.credits = Math.round((data.economy.credits ?? 0) - dealPrice);
      recordSettleKeys(darknet.settled_auction_ids, a.id, a.name, 'name');
      appendLedgerRecord(darknet, {
        id: a.id || `dn_tx_${currentDay}_${darknet.ledger.length + 1}`,
        action: '拍卖竞得落槌',
        target: a.name,
        credits_delta: -dealPrice,
        note: '拍卖竞得落槌交割完成',
        at_day: currentDay,
      });
      events.push({
        light: '🟢',
        layer: 'instruction',
        path: 'economy.darknet.auctions',
        message: `[暗网拍卖] 竞得拍品「${a.name}」落槌结算：-${dealPrice} Credits`,
      });
      appliedCount++;
    }
  }

  return { events, quarantine, appliedCount };
}

function isBuildingActive(stateRaw: unknown): boolean {
  const s = String(stateRaw ?? '运转').trim();
  if (!s) return true;
  return s === '运转' || s === '正常' || s === '运行' || s === '运转中';
}

function isBaseOperationalAndPowered(base: {
  status?: string;
  power?: { gen?: number; use?: number };
}): boolean {
  const status = String(base.status ?? '').trim();
  if (status === '失守' || status === '废弃') return false;
  const gen = Number(base.power?.gen ?? 0);
  const use = Number(base.power?.use ?? 0);
  return use <= gen;
}

/**
 * 扫描各运转且未断电基地的多元被动产钱建筑（修复唯精炼厂单点）与贸易链净入：
 * - 矿石精炼厂：+5000 / 座 (refining)
 * - 巨型自动化矿业综合体：+80000 / 座 (refining)
 * - 废弃电子产品回收处理厂：+1200 / 座 (recycling)
 * - 抽油机：+800 / 座 (petrochemical)
 * - 炼油厂：+1500 / 座 (petrochemical)
 * - 化工合成厂：+1200 / 座 (petrochemical)
 * - 合成燃料工坊：+1000 / 座 (petrochemical)
 * - 同基地存在运转中的「矿石精炼器」：该基地 refining / recycling / petrochemical 乘以 1.25（+25%）
 */
export function computeBuildingPassiveDailyCredits(data: StatData): {
  channelDaily: EconomyChannelDaily;
  hasActiveDarknetRelay: boolean;
} {
  let refining = 0;
  let recycling = 0;
  let petrochemical = 0;
  let hasActiveDarknetRelay = false;

  const chainsList = Array.isArray(data?.economy?.chains) ? data.economy.chains : [];
  const bases = Array.isArray(data?.bases) ? data.bases : [];
  for (const base of bases) {
    if (!base || !isBaseOperationalAndPowered(base)) continue;
    let baseRefining = 0;
    let baseRecycling = 0;
    let basePetrochemical = 0;
    let hasOrePurifier = false;

    const buildings = Array.isArray(base.buildings) ? base.buildings : [];
    for (const b of buildings) {
      if (!b || !isBuildingActive(b.state)) continue;
      const cName = canon(b.name);
      if (!cName) continue;

      if (cName.includes(canon('超维暗网中继站')) || cName.includes(canon('暗网中继站'))) {
        hasActiveDarknetRelay = true;
      }
      if (cName.includes(canon('矿石精炼器'))) {
        hasOrePurifier = true;
      }
      // 已由在册有效主资金链 deps.buildings 显式绑定的建筑，其产出已在 chains 渠道计息，跳过避免重复计费
      // （BUG-LIVE-06：排除断链/枯竭/零效率链条，且排除小额走私/黑市/副产支线，避免吞没建筑本体基载产出）
      const isCoveredByChain = chainsList.some(
        c =>
          c &&
          c.flow !== '支出' &&
          c.status !== 'broken' &&
          c.status !== 'exhausted' &&
          (c.status as string) !== 'depleted' &&
          Number(c.eff ?? 1) > 0 &&
          Number(c.rate_daily ?? 0) >= 500 &&
          !/走私|黑市|暗网|倒卖|副产|支线|边贸/.test(String(c.name ?? '')) &&
          (!c.deps?.base_id ||
            c.deps.base_id === base.id ||
            canon(c.deps.base_id) === canon(base.id ?? '') ||
            canon(c.deps.base_id) === canon(base.name ?? '')) &&
          Array.isArray(c.deps?.buildings) &&
          c.deps.buildings.some(dep => setHasEquivalentBuilding(new Set([b.name]), dep)),
      );
      if (isCoveredByChain) continue;

      if (cName.includes(canon('巨型自动化矿业综合体'))) {
        baseRefining += 80000;
      } else if (cName.includes(canon('矿石精炼厂')) || cName.includes(canon('奴隶矿场'))) {
        baseRefining += 5000;
      }
      if (
        cName.includes(canon('废弃电子产品回收处理厂')) ||
        cName.includes(canon('电子产品回收处理厂'))
      ) {
        baseRecycling += 1200;
      }
      if (cName.includes(canon('抽油机')) || cName.includes(canon('科技钻油井'))) {
        basePetrochemical += 800;
      } else if (cName.includes(canon('炼油厂'))) {
        basePetrochemical += 1500;
      } else if (cName.includes(canon('化工合成厂'))) {
        basePetrochemical += 1200;
      } else if (cName.includes(canon('合成燃料工坊'))) {
        basePetrochemical += 1000;
      }
    }

    if (hasOrePurifier) {
      baseRefining = Math.round(baseRefining * 1.25);
      baseRecycling = Math.round(baseRecycling * 1.25);
      basePetrochemical = Math.round(basePetrochemical * 1.25);
    }

    refining += baseRefining;
    recycling += baseRecycling;
    petrochemical += basePetrochemical;
  }

  const chains = calcDailyNet(chainsList);
  const total = refining + recycling + petrochemical + chains;

  const channelDaily = EconomyChannelDaily.parse({
    refining,
    recycling,
    petrochemical,
    chains,
    total,
  });

  return { channelDaily, hasActiveDarknetRelay };
}

/**
 * 周期时钟与多元建筑被动现金流结算函数：
 * 1. 若基地存在运转中的「超维暗网中继站」或 data.economy.darknet 已存在，推进拍卖倒计时；
 * 2. 汇总五大渠道日现金流写入 data.economy.channel_daily。
 */
export function tickDarknetAndPassiveEconomy(
  data: StatData,
  deltaMinutes: number,
  _currentDay?: number,
): TickDarknetResult {
  const events: ParseEvent[] = [];
  const { channelDaily, hasActiveDarknetRelay } = computeBuildingPassiveDailyCredits(data);

  data.economy.channel_daily = channelDaily;
  const passiveBuildingDaily = channelDaily.refining + channelDaily.recycling + channelDaily.petrochemical;
  if (passiveBuildingDaily > 0) {
    data.economy.credits_daily = channelDaily.total;
    if (deltaMinutes > 0) {
      const deltaPassiveCredits = Math.round((passiveBuildingDaily * deltaMinutes) / 1440);
      if (deltaPassiveCredits !== 0) {
        data.economy.credits = Math.round(
          (Number.isFinite(data.economy.credits) ? data.economy.credits : 0) + deltaPassiveCredits,
        );
        events.push({
          light: '🟢',
          layer: 'instruction',
          path: 'economy.credits',
          message: `[多元经济] 建筑被动并网结算 Δt=${deltaMinutes} 分钟：+${deltaPassiveCredits} credits（日净入 ${passiveBuildingDaily}/日）`,
        });
      }
    }
  }

  if (hasActiveDarknetRelay || data.economy.darknet !== undefined) {
    const darknet = DarknetState.parse(data.economy.darknet ?? {});
    if (hasActiveDarknetRelay && darknet.market_status === '未接入') {
      darknet.market_status = '正常连接';
    }
    if (deltaMinutes > 0 && darknet.auction_status === 'closed') {
      darknet.next_auction_in_minutes = Math.max(0, darknet.next_auction_in_minutes - deltaMinutes);
      if (darknet.next_auction_in_minutes === 0) {
        darknet.auction_status = 'bidding';
        events.push({
          light: '🟢',
          layer: 'instruction',
          path: 'economy.darknet.auction_status',
          message: '[跨维暗网] 定期专场拍卖会倒计时归零，拍卖厅已开启（bidding）',
        });
      }
    } else if (deltaMinutes > 0 && darknet.auction_status === 'settled') {
      darknet.auction_status = 'closed';
      darknet.next_auction_in_minutes = Math.max(0, DEFAULT_AUCTION_INTERVAL_MINUTES - deltaMinutes);
    }
    data.economy.darknet = darknet;
  }

  return {
    next: data,
    data,
    events,
    channelDaily,
  };
}
