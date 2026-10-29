/**
 * resourcePanelModel.ts —— 资源六柱、多元分渠道日流与跨维暗网终端视图模型
 * （CTRL-UI-RES-01 · Phase 8.5 串行第 3 / FD-21 Track D · DARKNET-UI-01）
 *
 * 真源与纪律：
 * - 只读消费 stat_data.economy（credits/credits_daily/resources/channel_daily/darknet）及 bases 建筑列表，零写路径；
 *   消费 RES-SCHEMA-01（schema.ts EconomyResources）既有数据與 21 号任务包暗网经济扩展契约。
 * - 三态语义钉死（schema.ts 状态机，resourceSchema.test.ts 语义锚点）：
 *   null＝未探明/未建仓（前端横杠＋「未解锁」，严禁降级显示为 0）；
 *   0＝已解锁产线库存告罄（标红「告罄」）；>0＝实物流转（数值直呈）。
 * - 显示名同源优先序：小类名＝schema 数据键直呈（含 LLM 动态新增键，如「紫幽玄铁」）；
 *   柱名/柱副标＝schema.ts 六柱注释主名与括注；
 *   「系统资金」「日均净入」＝schema.ts 字段注释直引。
 * - 流水摘要向后兼容：当既无 darknet.ledger（或为空）也无非零 channel_daily 时，
 *   ledger.available 保持 false 且 note 原文不变；当存在逐笔流水或分渠道净入时，
 *   ledger.available=true 并提供 channelBreakdown（精炼基载/废料拆解/油化并网/贸易资金链）与 recentLedger。
 * - 🔴 纯函数：零 IO / 零 DOM / 零 vue·pinia / 零酒馆 API；不原地修改入参。
 */
import type { EconomyResources } from '../../红警指挥系统/core/schema';

/* ═══════════════ 六柱注册表（schema 声明序；名/副标＝schema.ts 注释同源，实现裁量登记） ═══════════════ */

export type ResourcePillarKey = keyof EconomyResources;

export interface ResourcePillarDef {
  key: ResourcePillarKey;
  /** 柱显示名（schema.ts 注释主名） */
  name: string;
  /** 柱副标（schema.ts 注释括注） */
  desc: string;
}

export const RESOURCE_PILLARS: readonly ResourcePillarDef[] = [
  { key: 'nanites', name: '纳米机械储备', desc: '核心建造材料 · 由建造厂或纳米工坊产出' },
  { key: 'minerals', name: '矿产与金属', desc: '矿车采集 · 精炼厂与回收厂提纯' },
  { key: 'materials', name: '常规建材与化工品', desc: '基建扩建与重工业消耗' },
  { key: 'fuel', name: '燃油与能源介质', desc: '装甲部队出击与设施供能' },
  { key: 'munitions', name: '军械与弹药', desc: '弹药厂标准战备配给' },
  { key: 'logistics', name: '维生与后勤给养', desc: '驻军日常消耗与基地维持' },
];

/* ═══════════════ 文案（同源出处见各注；无同源出口者为实现裁量登记） ═══════════════ */

export const RESOURCE_COPY = {
  /** schema.ts L337 注释直引 */
  creditsLabel: '战备资金',
  /** schema.ts L338 注释直引 */
  creditsDailyLabel: '每日净收支',
  /** schema.ts L264「前端显示横杠/未解锁」同源 */
  lockedTag: '未解锁',
  /** schema.ts L265「已建产线但当前库存告罄（DEPLETED）——前端标红告警」同源 */
  depletedTag: '告罄',
  /** null 三态横杠（schema.ts L264 同源） */
  lockedValueText: '—',
  /** 整体未探明降级说明 */
  unsurveyedText: '尚未建立物资仓库。在基地完成勘探或建仓后，各类物资库存会自动汇总至此。',
  /** 流水摘要降级说明 */
  ledgerNote: '当前按日统计总资金与每日净收支。',
  /** 多元分渠道与暗网流水激活说明 */
  ledgerActiveNote: '分渠道日常收支与暗网交易记录已同步。',
} as const;

/* ═══════════════ Track B 对齐契约：跨维暗网与分渠道日流视图类型 ═══════════════ */

export interface DarknetResourceMapView {
  pillar?: string;
  key?: string;
  qty?: number;
}

export interface DarknetMarketItemView {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  desc: string;
  resource_map?: DarknetResourceMapView;
}

export interface DarknetBountyItemView {
  id: string;
  target: string;
  category: string;
  reward_credits: number;
  status: 'open' | 'completed' | 'expired';
  deadline_text: string;
  desc: string;
}

export interface DarknetAuctionItemView {
  id: string;
  name: string;
  seller: string;
  start_price: number;
  current_price: number;
  leader: string;
  round_text: string;
  status: 'bidding' | 'sold' | 'passed';
  desc: string;
  resource_map?: DarknetResourceMapView;
}

export interface DarknetSettlementRecordView {
  id: string;
  action: string;
  target: string;
  credits_delta: number;
  note: string;
  at_day: number;
}

export interface EconomyChannelDailyView {
  refining: number;
  recycling: number;
  petrochemical: number;
  chains: number;
  total: number;
}

export interface EconomyDarknetLike {
  market_status?: string;
  auction_status?: 'closed' | 'bidding' | 'settled';
  next_auction_in_minutes?: number;
  items?: ReadonlyArray<DarknetMarketItemView>;
  bounties?: ReadonlyArray<DarknetBountyItemView>;
  auctions?: ReadonlyArray<DarknetAuctionItemView>;
  sold_intel_ids?: ReadonlyArray<string>;
  ledger?: ReadonlyArray<DarknetSettlementRecordView>;
}

export interface DarknetBaseBuildingLike {
  name?: string;
  state?: string;
}

export interface DarknetBaseLike {
  id?: string;
  name?: string;
  status?: string;
  buildings?: ReadonlyArray<DarknetBaseBuildingLike>;
}

export interface EconomyWithDarknetLike {
  credits?: number;
  credits_daily?: number;
  resources?: Partial<Record<ResourcePillarKey, Record<string, number | null>>>;
  channel_daily?: Partial<EconomyChannelDailyView> | null;
  darknet?: EconomyDarknetLike | null;
  /** 可选内联 bases 引用（兼容单参传入或通过 options.bases 传入） */
  bases?: ReadonlyArray<DarknetBaseLike> | Record<string, DarknetBaseLike> | null;
}

export interface ChannelBreakdownItem {
  key: 'refining' | 'recycling' | 'petrochemical' | 'chains';
  /** 完整渠道名（精炼基载 / 废料拆解 / 油化并网 / 贸易资金链） */
  label: string;
  /** 顶栏紧凑芯片简称（精炼 / 回收 / 油化 / 商路） */
  shortLabel: string;
  value: number;
  valueText: string;
}

export interface DarknetPanelView {
  unlocked: boolean;
  relayBuildingPresent: boolean;
  marketStatusText: string;
  auctionStatus: 'closed' | 'bidding' | 'settled';
  auctionBadgeText: string;
  items: DarknetMarketItemView[];
  bounties: DarknetBountyItemView[];
  auctions: DarknetAuctionItemView[];
  soldIntelCount: number;
  recentLedger: DarknetSettlementRecordView[];
  channelDaily: EconomyChannelDailyView;
}

export interface ResourceLedgerView {
  available: boolean;
  note: string;
  channelDaily: EconomyChannelDailyView;
  channelBreakdown: ChannelBreakdownItem[];
  recentLedger: DarknetSettlementRecordView[];
}

/* ═══════════════ 视图模型类型 ═══════════════ */

/** 三态色调：flow＝实物流转｜depleted＝告罄标红｜locked＝未解锁横杠 */
export type ResourceTone = 'flow' | 'depleted' | 'locked';

export interface ResourceItemRow {
  /** 小类名＝schema 数据键直呈（含动态新增键） */
  name: string;
  /** 原始值直呈（null 保真，不降级为 0） */
  value: number | null;
  tone: ResourceTone;
  /** 显示文本：null→横杠；0/>0→数值直呈 */
  valueText: string;
  /** 状态标签：locked→「未解锁」｜depleted→「告罄」｜flow→无 */
  tag?: string;
}

export interface ResourcePillarRow {
  /** 柱数据键直呈（nanites 等） */
  key: ResourcePillarKey;
  name: string;
  desc: string;
  items: ResourceItemRow[];
  totalCount: number;
  /** 已解锁小类数（value !== null） */
  unlockedCount: number;
  /** 告罄小类数（value === 0） */
  depletedCount: number;
  /** 全柱 null 或无小类 → 整柱未解锁态 */
  allLocked: boolean;
}

/** 日均净入色调：surplus＝净盈余｜deficit＝净亏损｜balance＝收支平衡（实现裁量登记） */
export type CreditsDailyTone = 'surplus' | 'deficit' | 'balance';

export interface CreditsBarModel {
  creditsLabel: string;
  /** stat_data.economy.credits 直呈（缺省 0，schema 默认语义） */
  credits: number;
  creditsText: string;
  creditsDailyLabel: string;
  /** stat_data.economy.credits_daily 直呈（缺省 0） */
  creditsDaily: number;
  /** 符号化文本：正值补「+」，负值/零原文（实现裁量登记） */
  creditsDailyText: string;
  dailyTone: CreditsDailyTone;
}

export interface ResourcePanelModel {
  /** economy.resources 在场＝已探明；整体缺席＝未探明降级态（pillars 为空数组） */
  surveyed: boolean;
  unsurveyedText: string;
  /** 六柱（RESOURCE_PILLARS 注册表序＝schema 声明序） */
  pillars: ResourcePillarRow[];
  creditsBar: CreditsBarModel;
  /** 流水摘要可得性（无分渠道与暗网流水时 available=false 降级；存在时提供 channelBreakdown 与 recentLedger） */
  ledger: ResourceLedgerView;
  /** 跨维暗网终端与分渠道日流视图 */
  darknet: DarknetPanelView;
}

/** 面板消费的 economy 最小切片（与 Schema['economy'] 及暗网扩展结构化兼容；resources 允许缺柱防御） */
export type ResourcePanelInput = EconomyWithDarknetLike;

export interface ResourcePanelOptions {
  bases?: ReadonlyArray<DarknetBaseLike> | Record<string, DarknetBaseLike> | null;
}

/* ═══════════════ 内部纯函数辅助 ═══════════════ */

const DARKNET_BUILDING_KEYWORDS = ['超维暗网中继站', '暗网中继站', '暗网终端'] as const;
const DEFAULT_NEXT_AUCTION_MINUTES = 7 * 1440; // 7日0h

function itemRow(name: string, value: number | null): ResourceItemRow {
  if (value === null) {
    return { name, value, tone: 'locked', valueText: RESOURCE_COPY.lockedValueText, tag: RESOURCE_COPY.lockedTag };
  }
  const safeVal = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safeVal === 0) {
    return { name, value: 0, tone: 'depleted', valueText: '0', tag: RESOURCE_COPY.depletedTag };
  }
  return { name, value: safeVal, tone: 'flow', valueText: String(safeVal) };
}

function toFiniteNumber(val: unknown, fallback = 0): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

function formatSignedNumber(val: number): string {
  return val >= 0 ? `+${val}` : String(val);
}

function normalizeBaseList(
  rawBases?: ReadonlyArray<DarknetBaseLike> | Record<string, DarknetBaseLike> | null,
): DarknetBaseLike[] {
  if (!rawBases) return [];
  if (Array.isArray(rawBases)) return [...rawBases];
  if (typeof rawBases === 'object') return Object.values(rawBases);
  return [];
}

function detectDarknetBuildings(bases: DarknetBaseLike[]): {
  anyDarknetBuilding: boolean;
  relayBuildingPresent: boolean;
} {
  let anyDarknetBuilding = false;
  let relayBuildingPresent = false;
  for (const base of bases) {
    if (!base || base.status === '废弃') continue;
    const buildings = Array.isArray(base.buildings) ? base.buildings : [];
    for (const bld of buildings) {
      const name = typeof bld?.name === 'string' ? bld.name.trim() : '';
      if (!name) continue;
      const matchesKeyword = DARKNET_BUILDING_KEYWORDS.some(kw => name.includes(kw));
      if (matchesKeyword) {
        anyDarknetBuilding = true;
        if (bld.state !== '建造中' && bld.state !== '停机') {
          relayBuildingPresent = true;
        }
      }
    }
  }
  return { anyDarknetBuilding, relayBuildingPresent };
}

function normalizeChannelDaily(raw?: Partial<EconomyChannelDailyView> | null): EconomyChannelDailyView {
  const refining = toFiniteNumber(raw?.refining, 0);
  const recycling = toFiniteNumber(raw?.recycling, 0);
  const petrochemical = toFiniteNumber(raw?.petrochemical, 0);
  const chains = toFiniteNumber(raw?.chains, 0);
  const sum = refining + recycling + petrochemical + chains;
  const explicitTotal = toFiniteNumber(raw?.total, 0);
  const total = explicitTotal !== 0 || sum === 0 ? explicitTotal : sum;
  return {
    refining,
    recycling,
    petrochemical,
    chains,
    total,
  };
}

function buildChannelBreakdown(channelDaily: EconomyChannelDailyView): ChannelBreakdownItem[] {
  return [
    {
      key: 'refining',
      label: '矿石精炼',
      shortLabel: '精炼',
      value: channelDaily.refining,
      valueText: formatSignedNumber(channelDaily.refining),
    },
    {
      key: 'recycling',
      label: '废料回收',
      shortLabel: '回收',
      value: channelDaily.recycling,
      valueText: formatSignedNumber(channelDaily.recycling),
    },
    {
      key: 'petrochemical',
      label: '油田炼化',
      shortLabel: '油化',
      value: channelDaily.petrochemical,
      valueText: formatSignedNumber(channelDaily.petrochemical),
    },
    {
      key: 'chains',
      label: '贸易收支',
      shortLabel: '商路',
      value: channelDaily.chains,
      valueText: formatSignedNumber(channelDaily.chains),
    },
  ];
}

function formatAuctionCountdown(minutesInput?: number): string {
  const safeMinutes = Math.max(0, Math.floor(toFiniteNumber(minutesInput, DEFAULT_NEXT_AUCTION_MINUTES)));
  const days = Math.floor(safeMinutes / 1440);
  const hours = Math.floor((safeMinutes % 1440) / 60);
  return `${days}日${hours}h`;
}

function buildAuctionBadgeText(
  auctionStatus: 'closed' | 'bidding' | 'settled',
  nextAuctionInMinutes?: number,
): string {
  if (auctionStatus === 'bidding') {
    return '🔥 专场拍卖竞价中';
  }
  const countdown = formatAuctionCountdown(nextAuctionInMinutes);
  if (auctionStatus === 'settled') {
    return `✅ 本期拍卖已交割 · ⏳ 距下次开启 ${countdown}`;
  }
  return `⏳ 距下次开启 ${countdown}`;
}

function cloneResourceMap(rm?: DarknetResourceMapView): DarknetResourceMapView | undefined {
  if (!rm || typeof rm !== 'object') return undefined;
  return {
    ...(rm.pillar !== undefined ? { pillar: rm.pillar } : {}),
    ...(rm.key !== undefined ? { key: rm.key } : {}),
    ...(rm.qty !== undefined ? { qty: rm.qty } : {}),
  };
}

/* ═══════════════ 视图模型（纯函数） ═══════════════ */

/**
 * 资源面板视图模型（纯函数）。
 * 输入＝stat_data.economy 切片（及可选 bases 列表）；
 * 输出＝六柱渲染模型（三态 tone）＋资金条模型＋分渠道流水摘要＋跨维暗网视图模型。
 */
export function resourcePanelModel(
  economy: ResourcePanelInput = {},
  options?: ResourcePanelOptions,
): ResourcePanelModel {
  const safeEconomy = economy ?? {};
  const credits = safeEconomy.credits ?? 0;
  const creditsDaily = safeEconomy.credits_daily ?? 0;
  const res = safeEconomy.resources;

  const pillars: ResourcePillarRow[] = !res
    ? []
    : RESOURCE_PILLARS.map(def => {
        const record = res[def.key] ?? {}; // 缺柱防御：parse 后恒在，未过 parse 的粗输入降级为空柱
        const items = Object.keys(record).map(name => itemRow(name, record[name]));
        const unlockedCount = items.filter(i => i.value !== null).length;
        const depletedCount = items.filter(i => i.value === 0).length;
        return {
          key: def.key,
          name: def.name,
          desc: def.desc,
          items,
          totalCount: items.length,
          unlockedCount,
          depletedCount,
          allLocked: unlockedCount === 0,
        };
      });

  const channelDaily = normalizeChannelDaily(safeEconomy.channel_daily);
  const channelBreakdown = buildChannelBreakdown(channelDaily);

  const rawDarknet = safeEconomy.darknet ?? undefined;
  const items: DarknetMarketItemView[] = Array.isArray(rawDarknet?.items)
    ? rawDarknet.items.map(it => ({
        id: String(it.id ?? ''),
        name: String(it.name ?? ''),
        category: String(it.category ?? '常规黑市'),
        price: toFiniteNumber(it.price, 0),
        stock: toFiniteNumber(it.stock, 0),
        desc: String(it.desc ?? ''),
        ...(it.resource_map ? { resource_map: cloneResourceMap(it.resource_map) } : {}),
      }))
    : [];

  const bounties: DarknetBountyItemView[] = Array.isArray(rawDarknet?.bounties)
    ? rawDarknet.bounties.map(b => ({
        id: String(b.id ?? ''),
        target: String(b.target ?? ''),
        category: String(b.category ?? '物资悬赏'),
        reward_credits: toFiniteNumber(b.reward_credits, 0),
        status: b.status === 'completed' || b.status === 'expired' ? b.status : 'open',
        deadline_text: String(b.deadline_text ?? ''),
        desc: String(b.desc ?? ''),
      }))
    : [];

  const auctions: DarknetAuctionItemView[] = Array.isArray(rawDarknet?.auctions)
    ? rawDarknet.auctions.map(a => ({
        id: String(a.id ?? ''),
        name: String(a.name ?? ''),
        seller: String(a.seller ?? '匿名跨维卖家'),
        start_price: toFiniteNumber(a.start_price, 0),
        current_price: toFiniteNumber(a.current_price, toFiniteNumber(a.start_price, 0)),
        leader: String(a.leader ?? '暂无出价'),
        round_text: String(a.round_text ?? '首轮挂牌'),
        status: a.status === 'sold' || a.status === 'passed' ? a.status : 'bidding',
        desc: String(a.desc ?? ''),
        ...(a.resource_map ? { resource_map: cloneResourceMap(a.resource_map) } : {}),
      }))
    : [];

  const recentLedger: DarknetSettlementRecordView[] = Array.isArray(rawDarknet?.ledger)
    ? rawDarknet.ledger.map(rec => ({
        id: String(rec.id ?? ''),
        action: String(rec.action ?? '交割'),
        target: String(rec.target ?? ''),
        credits_delta: toFiniteNumber(rec.credits_delta, 0),
        note: String(rec.note ?? ''),
        at_day: toFiniteNumber(rec.at_day, 0),
      }))
    : [];

  const soldIntelCount = Array.isArray(rawDarknet?.sold_intel_ids) ? rawDarknet.sold_intel_ids.length : 0;

  const bases = normalizeBaseList(options?.bases ?? safeEconomy.bases);
  const { anyDarknetBuilding, relayBuildingPresent } = detectDarknetBuildings(bases);

  const rawMarketStatus = typeof rawDarknet?.market_status === 'string' ? rawDarknet.market_status.trim() : '';
  const hasDarknetActivity =
    items.length > 0 || bounties.length > 0 || auctions.length > 0 || recentLedger.length > 0;
  const unlocked =
    anyDarknetBuilding || relayBuildingPresent || hasDarknetActivity || rawMarketStatus === '正常连接';

  const marketStatusText = unlocked
    ? rawMarketStatus && rawMarketStatus !== '未连接' && rawMarketStatus !== '待建超维暗网中继站'
      ? rawMarketStatus
      : '正常连接'
    : rawMarketStatus && rawMarketStatus !== '未连接'
      ? rawMarketStatus
      : '待建超维暗网中继站';

  const rawAuctionStatus = rawDarknet?.auction_status;
  const auctionStatus: 'closed' | 'bidding' | 'settled' =
    rawAuctionStatus === 'bidding'
      ? 'bidding'
      : rawAuctionStatus === 'settled'
        ? 'settled'
        : auctions.some(a => a.status === 'bidding')
          ? 'bidding'
          : 'closed';

  const auctionBadgeText = buildAuctionBadgeText(auctionStatus, rawDarknet?.next_auction_in_minutes);

  const hasChannelDaily =
    channelDaily.total > 0 ||
    channelDaily.refining !== 0 ||
    channelDaily.recycling !== 0 ||
    channelDaily.petrochemical !== 0 ||
    channelDaily.chains !== 0;
  const ledgerAvailable = recentLedger.length > 0 || hasChannelDaily;

  return {
    surveyed: res !== undefined && res !== null,
    unsurveyedText: RESOURCE_COPY.unsurveyedText,
    pillars,
    creditsBar: {
      creditsLabel: RESOURCE_COPY.creditsLabel,
      credits,
      creditsText: String(credits),
      creditsDailyLabel: RESOURCE_COPY.creditsDailyLabel,
      creditsDaily,
      creditsDailyText: creditsDaily > 0 ? `+${creditsDaily}` : String(creditsDaily),
      dailyTone: creditsDaily > 0 ? 'surplus' : creditsDaily < 0 ? 'deficit' : 'balance',
    },
    ledger: {
      available: ledgerAvailable,
      note: ledgerAvailable ? RESOURCE_COPY.ledgerActiveNote : RESOURCE_COPY.ledgerNote,
      channelDaily,
      channelBreakdown,
      recentLedger,
    },
    darknet: {
      unlocked,
      relayBuildingPresent,
      marketStatusText,
      auctionStatus,
      auctionBadgeText,
      items,
      bounties,
      auctions,
      soldIntelCount,
      recentLedger,
      channelDaily,
    },
  };
}

/* ═══════════════ 跨维暗网指令构建器（纯函数） ═══════════════ */

export type DarknetOrderKind = 'buy' | 'sell_resource' | 'sell_intel' | 'bounty' | 'bid' | 'consign';

export interface DarknetOrderPromptIntent {
  kind: DarknetOrderKind;
  targetName: string;
  priceOrQty?: number;
  extraNote?: string;
}

/**
 * 构建跨维暗网自然语言战术指令（纯函数）。
 * 生成可直接填入酒馆聊天框、引导 LLM 在剧情中执行并在文末输出 `<暗网>` 标签的指令文本。
 */
export function buildDarknetOrderPrompt(intent: DarknetOrderPromptIntent): string {
  const targetName = (intent.targetName ?? '').trim() || '未命名标的';
  const extra = (intent.extraNote ?? '').trim();
  const extraSuffix = extra ? `（补充说明：${extra}）` : '';

  switch (intent.kind) {
    case 'buy':
      return `【超维暗网指令】通过超维暗网中继站选购在售标的「${targetName}」，请推进交割并在文末输出 <暗网> 更新库存与资金。${extraSuffix}`;
    case 'sell_resource':
      return `【超维暗网指令】将基地库存中的「${targetName}」投入超维暗网中继站传质舱变现，请估算系统资金并在文末输出 <暗网> 本轮交割。${extraSuffix}`;
    case 'sell_intel':
      return `【超维暗网指令】通过超维暗网中继站量子信道上传情报/数据「${targetName}」换取系统资金，请核验首发唯一性并在文末输出 <暗网> 本轮交割。${extraSuffix}`;
    case 'bounty':
      return `【超维暗网指令】向超维暗网提交求购悬赏「${targetName}」所需标的完成交割，请结算悬赏金并在文末输出 <暗网>。${extraSuffix}`;
    case 'bid': {
      const bidPrice =
        typeof intent.priceOrQty === 'number' && Number.isFinite(intent.priceOrQty)
          ? intent.priceOrQty
          : 0;
      return `【超维暗网指令】进入超维暗网拍卖厅，针对拍品「${targetName}」跟牌加价（目标出价：${bidPrice} 系统资金），请描写竞拍博弈并在文末输出 <暗网> 更新拍卖状态。${extraSuffix}`;
    }
    case 'consign':
      return `【超维暗网指令】将我方高价值标的「${targetName}」委托送拍至超维暗网拍卖所，请安排跨维买主竞价并在文末输出 <暗网>。${extraSuffix}`;
  }
}

/** 构建【超维暗网中继站】立项建造指令（锁定引导框快捷按钮） */
export function buildDarknetRelayBuildPrompt(baseName?: string): string {
  const resolvedBase = (baseName ?? '').trim() || '当前主力基地';
  return `【建造指令】在「${resolvedBase}」立项建造 T1 通用建筑「超维暗网中继站」（造价 1,200 资金 · 耗电 30 · 前置发电厂），接通跨维度黑市撮合系统并在文末输出 <队列> 或更新建筑状态。`;
}

/** 构建跨维暗网行情探测刷新指令 */
export function buildDarknetRefreshMarketPrompt(): string {
  return '【超维暗网指令】通过超维暗网中继站扫描刷新当期黑市直购货架、求购悬赏与拍卖厅行情，请在文末输出 <暗网> 同步最新标的数据。';
}
