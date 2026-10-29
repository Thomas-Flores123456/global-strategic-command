/**
 * floorCardDarknet.ts —— <暗网> 超维暗网中继终端楼层卡片解析器与 DOM 渲染器 (DARKNET-CARD-01)
 */
import * as YAML from 'yaml';
import { ensureCardStyleInDoc } from './floorCardStyles';

export interface DarknetCardSettlementItem {
  action: string;
  target: string;
  creditsDelta: number;
  creditsDeltaText: string;
  bidPrice?: number;
  dedupeKey?: string;
  note: string;
}

export interface DarknetCardAuctionItem {
  id: string;
  name: string;
  seller: string;
  startPrice: number;
  currentPrice: number;
  leader: string;
  round: string;
  status: string;
  desc: string;
}

export interface DarknetCardMarketItem {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  desc: string;
}

export interface DarknetCardBountyItem {
  id: string;
  target: string;
  category: string;
  rewardCredits: number;
  status: string;
  desc: string;
}

export interface ParsedDarknetTerminalCard {
  marketStatus: string;
  auctionStatus: string;
  nextAuction: string;
  isAuctionBidding: boolean;
  settlements: DarknetCardSettlementItem[];
  auctions: DarknetCardAuctionItem[];
  items: DarknetCardMarketItem[];
  bounties: DarknetCardBountyItem[];
  compactSummary: string;
}

export const DARKNET_TERMINAL_CARD_CSS = `
/* ═══ 超维暗网中继终端 · SUBSPACE DARKNET BROKER (暗金 #f59e0b + 阵营终端色联动 + 深邃黑底) ═══ */
.tw-darknet-terminal-card {
  position: relative;
  background-color: var(--tw-theme-bg, var(--rac-bg, #050811));
  background-image:
    radial-gradient(circle at 92% 8%, rgba(245, 158, 11, 0.08), transparent 40%),
    radial-gradient(circle at 8% 90%, color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 10%, transparent), transparent 42%),
    repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.012) 0px,
      rgba(255, 255, 255, 0.012) 1px,
      transparent 1px,
      transparent 3px
    );
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-left: 3px solid #f59e0b;
  border-radius: 0;
  color: #e2e8f0;
  font-family: 'JetBrains Mono', 'Share Tech Mono', 'Noto Sans SC', 'Microsoft YaHei', monospace;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.65);
  overflow: hidden;
  transition: background-color 180ms ease, border-color 180ms ease;
}
.tw-darknet-telemetry-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: #f59e0b;
  background: color-mix(in srgb, var(--tw-theme-bg, #0a0e1a) 90%, #000000);
  border-bottom: 1px solid rgba(245, 158, 11, 0.22);
  text-transform: uppercase;
}
.tw-darknet-telemetry-strip span:last-child {
  color: var(--tw-theme-accent, var(--rac-accent, #38bdf8));
}
.tw-darknet-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--tw-theme-panel, #0f172a) 92%, #000000) 0%, color-mix(in srgb, var(--tw-theme-bg, #0c1220) 85%, #000000) 100%);
  border-bottom: 1px solid color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 22%, transparent);
}
.tw-darknet-title {
  margin: 0;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0.06em;
  color: #fef3c7;
}
.tw-darknet-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
}
.tw-darknet-market-badge {
  padding: 2px 8px;
  color: var(--tw-theme-accent, var(--rac-accent, #38bdf8));
  background: color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 42%, transparent);
  font-weight: 700;
}
.tw-darknet-auction-badge {
  padding: 2px 9px;
  color: #cbd5e1;
  background: rgba(30, 41, 59, 0.65);
  border: 1px solid rgba(148, 163, 184, 0.3);
  font-weight: 700;
}
.tw-darknet-auction-badge.is-bidding {
  color: #fef3c7;
  background: rgba(217, 119, 6, 0.28);
  border: 1px solid #f59e0b;
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.28);
}
.tw-darknet-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 14px;
}
.tw-darknet-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tw-darknet-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #f59e0b;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(245, 158, 11, 0.2);
}
.tw-darknet-settlement-list,
.tw-darknet-auction-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tw-darknet-settlement-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--tw-theme-panel, #0a101d) 92%, #050811);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 20%, transparent);
  border-left: 2px solid var(--tw-theme-accent, var(--rac-accent, #38bdf8));
}
.tw-darknet-settlement-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tw-darknet-settlement-left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.tw-darknet-action-tag {
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 800;
  color: #0f172a;
  background: #f59e0b;
}
.tw-darknet-target-name {
  font-size: 12px;
  font-weight: 700;
  color: #f8fafc;
}
.tw-darknet-dedupe-tag {
  padding: 1px 6px;
  font-size: 9.5px;
  color: var(--tw-theme-accent, var(--rac-accent, #38bdf8));
  background: color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 32%, transparent);
}
.tw-darknet-delta {
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.04em;
}
.tw-darknet-delta.is-positive {
  color: #4ade80;
}
.tw-darknet-delta.is-negative {
  color: #fb7185;
}
.tw-darknet-delta.is-neutral {
  color: var(--tw-theme-accent, var(--rac-accent, #38bdf8));
}
.tw-darknet-note {
  margin: 0;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.45;
}
.tw-darknet-auction-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 10px;
  background: rgba(13, 18, 30, 0.94);
  border: 1px solid rgba(245, 158, 11, 0.28);
  border-left: 2px solid #f59e0b;
}
.tw-darknet-auction-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tw-darknet-auction-name {
  font-size: 12.5px;
  font-weight: 800;
  color: #fef3c7;
}
.tw-darknet-auction-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: #cbd5e1;
}
.tw-darknet-auction-price {
  font-weight: 900;
  color: #f59e0b;
}
.tw-darknet-auction-leader {
  font-weight: 700;
  color: var(--tw-theme-accent, var(--rac-accent, #38bdf8));
}
.tw-darknet-accordion {
  border-top: 1px solid rgba(148, 163, 184, 0.16);
  background: color-mix(in srgb, var(--tw-theme-bg, #070b14) 94%, #000000);
}
.tw-darknet-accordion-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  color: var(--tw-theme-accent, var(--rac-accent, #38bdf8));
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}
.tw-darknet-accordion-toggle:hover {
  background: rgba(14, 116, 144, 0.12);
}
.tw-darknet-accordion-body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 8px;
  padding: 6px 14px 12px;
}
.tw-darknet-shelf-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 10px;
  background: rgba(11, 17, 30, 0.92);
  border: 1px solid rgba(148, 163, 184, 0.2);
}
.tw-darknet-shelf-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 700;
  color: #e2e8f0;
}
.tw-darknet-shelf-price {
  font-size: 11px;
  font-weight: 800;
  color: #f59e0b;
}
`;

function stripDarknetOuterTag(raw: string): string {
  return raw
    .trim()
    .replace(/^<暗网>\s*/i, '')
    .replace(/\s*<\/暗网>$/i, '')
    .replace(/^```(?:yaml|yml|json|text)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function toSafeString(val: unknown, fallback = ''): string {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') return val.trim() || fallback;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return fallback;
}

function parseNumericValue(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val !== 'string') return fallback;
  const cleaned = val.replace(/[,，_\s]/g, '');
  const match = cleaned.match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return fallback;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : fallback;
}

function pickArray(obj: Record<string, unknown>, keys: string[]): Array<Record<string, unknown>> {
  for (const key of keys) {
    const val = obj[key];
    if (Array.isArray(val)) {
      return val.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function formatCreditsDelta(delta: number, action: string, bidPrice?: number): string {
  if (delta > 0) return `+${delta} CREDITS`;
  if (delta < 0) return `${delta} CREDITS`;
  if (bidPrice !== undefined && bidPrice > 0 && (action.includes('竞拍') || action.includes('出价'))) {
    return `出价 ${bidPrice} CREDITS (未落槌不扣款)`;
  }
  return '0 CREDITS';
}

/**
 * 解析 `<暗网>` YAML 载荷为结构化终端卡片模型
 */
export function parseDarknetTerminalPayload(raw: unknown): ParsedDarknetTerminalCard | null {
  let rootObj: Record<string, unknown> | null = null;

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    rootObj = raw as Record<string, unknown>;
  } else if (typeof raw === 'string') {
    const cleaned = stripDarknetOuterTag(raw);
    if (!cleaned) return null;

    try {
      const parsed = YAML.parse(cleaned);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rootObj = parsed as Record<string, unknown>;
      }
    } catch {
      rootObj = null;
    }

    if (!rootObj) {
      // 宽松行级回退解析
      const fallbackObj: Record<string, unknown> = {};
      for (const rawLine of cleaned.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith('-')) continue;
        const m = line.match(/^([^:：]+)[:：]\s*(.*)$/);
        if (m) {
          fallbackObj[m[1].trim()] = m[2].trim();
        }
      }
      if (Object.keys(fallbackObj).length === 0) return null;
      rootObj = fallbackObj;
    }
  } else {
    return null;
  }

  if (rootObj['暗网'] && typeof rootObj['暗网'] === 'object' && !Array.isArray(rootObj['暗网'])) {
    rootObj = rootObj['暗网'] as Record<string, unknown>;
  }

  const rawSettlements = pickArray(rootObj, [
    '本轮交割',
    '本轮操作',
    '交割记录',
    'settlements',
    'ledger',
  ]);
  const settlements: DarknetCardSettlementItem[] = rawSettlements.map(item => {
    const action = toSafeString(item['动作'] ?? item['操作'] ?? item['类型'] ?? item['action'], '交割记录');
    const target = toSafeString(
      item['标的'] ?? item['名称'] ?? item['目标'] ?? item['拍品'] ?? item['target'] ?? item['name'],
      '未知标的',
    );
    const creditsDelta = parseNumericValue(
      item['资金变动'] ?? item['金额变动'] ?? item['收益'] ?? item['credits_delta'] ?? item['creditsDelta'] ?? item['delta'],
      0,
    );
    const rawBid = item['出价'] ?? item['竞拍价'] ?? item['bid_price'] ?? item['bidPrice'];
    const bidPrice = rawBid !== undefined ? parseNumericValue(rawBid, 0) : undefined;
    const dedupeKey = toSafeString(item['查重键'] ?? item['dedupe_key'] ?? item['dedupeKey'], '') || undefined;
    const note = toSafeString(item['说明'] ?? item['备注'] ?? item['详情'] ?? item['note'] ?? item['desc'], '');

    return {
      action,
      target,
      creditsDelta,
      creditsDeltaText: formatCreditsDelta(creditsDelta, action, bidPrice),
      bidPrice,
      dedupeKey,
      note,
    };
  });

  const rawAuctions = pickArray(rootObj, ['当期拍卖', '拍卖行', '拍卖列表', 'auctions']);
  const auctions: DarknetCardAuctionItem[] = rawAuctions.map((item, idx) => {
    const startPrice = parseNumericValue(item['起拍价'] ?? item['底价'] ?? item['start_price'] ?? item['startPrice'], 0);
    const currentPrice = parseNumericValue(
      item['当前最高价'] ?? item['最高价'] ?? item['当前价'] ?? item['current_price'] ?? item['currentPrice'],
      startPrice,
    );
    return {
      id: toSafeString(item['编号'] ?? item['id'], `dn_auc_${idx + 1}`),
      name: toSafeString(item['拍品'] ?? item['名称'] ?? item['标的'] ?? item['name'], '未命名拍品'),
      seller: toSafeString(item['卖方'] ?? item['卖家'] ?? item['委托方'] ?? item['seller'], '匿名跨维卖家'),
      startPrice,
      currentPrice,
      leader: toSafeString(item['领先方'] ?? item['最高出价者'] ?? item['当前领先'] ?? item['leader'], '暂无出价'),
      round: toSafeString(item['轮次'] ?? item['叫价轮次'] ?? item['round_text'] ?? item['round'], '第1轮叫价'),
      status: toSafeString(item['状态'] ?? item['status'], '竞价中'),
      desc: toSafeString(item['简介'] ?? item['说明'] ?? item['描述'] ?? item['desc'], ''),
    };
  });

  const rawItems = pickArray(rootObj, ['在售商品', '市场商品', '黑市商品', 'items']);
  const items: DarknetCardMarketItem[] = rawItems.map((item, idx) => ({
    id: toSafeString(item['编号'] ?? item['id'], `dn_item_${idx + 1}`),
    name: toSafeString(item['名称'] ?? item['商品'] ?? item['标的'] ?? item['name'], '未知黑市商品'),
    category: toSafeString(item['类别'] ?? item['分类'] ?? item['category'], '战略物资'),
    price: parseNumericValue(item['价格'] ?? item['售价'] ?? item['单价'] ?? item['price'], 0),
    stock: parseNumericValue(item['库存'] ?? item['数量'] ?? item['stock'], 1),
    desc: toSafeString(item['简介'] ?? item['说明'] ?? item['描述'] ?? item['desc'], ''),
  }));

  const rawBounties = pickArray(rootObj, ['求购悬赏', '悬赏单', '悬赏列表', 'bounties']);
  const bounties: DarknetCardBountyItem[] = rawBounties.map((item, idx) => ({
    id: toSafeString(item['编号'] ?? item['id'], `dn_bounty_${idx + 1}`),
    target: toSafeString(item['目标'] ?? item['名称'] ?? item['求购标的'] ?? item['target'] ?? item['name'], '未知悬赏目标'),
    category: toSafeString(item['类别'] ?? item['分类'] ?? item['category'], '情报数据'),
    rewardCredits: parseNumericValue(
      item['悬赏金'] ?? item['报酬'] ?? item['赏金'] ?? item['reward_credits'] ?? item['rewardCredits'] ?? item['reward'],
      0,
    ),
    status: toSafeString(item['状态'] ?? item['status'], '待交割'),
    desc: toSafeString(item['简介'] ?? item['说明'] ?? item['描述'] ?? item['desc'], ''),
  }));

  const marketStatus = toSafeString(
    rootObj['市场状态'] ?? rootObj['market_status'] ?? rootObj['marketStatus'] ?? rootObj['状态'],
    '正常连接',
  );
  const auctionStatus = toSafeString(
    rootObj['拍卖状态'] ?? rootObj['auction_status'] ?? rootObj['auctionStatus'],
    auctions.some(a => a.status.includes('竞价') || a.status === 'bidding') ? '竞价中' : '休市待启',
  );
  const nextAuction = toSafeString(
    rootObj['距离下次拍卖'] ?? rootObj['下次拍卖'] ?? rootObj['next_auction'] ?? rootObj['nextAuction'],
    '7d',
  );

  const isAuctionBidding =
    auctionStatus.includes('竞价') ||
    auctionStatus.includes('开启') ||
    auctionStatus.toLowerCase() === 'bidding' ||
    auctions.some(a => a.status.includes('竞价') || a.status.toLowerCase() === 'bidding');

  const compactSummary = `交割 ${settlements.length} 笔 · 拍品 ${auctions.length} 件 · 货架/悬赏 ${items.length + bounties.length} 项`;

  return {
    marketStatus,
    auctionStatus,
    nextAuction,
    isAuctionBidding,
    settlements,
    auctions,
    items,
    bounties,
    compactSummary,
  };
}

/**
 * 构建【超维暗网中继终端 · SUBSPACE DARKNET BROKER】DOM 节点
 */
export function buildDarknetTerminalCardDom(
  doc: Document,
  parsed: ParsedDarknetTerminalCard,
  onResize?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-darknet-terminal-card-styles', DARKNET_TERMINAL_CARD_CSS);

  const root = doc.createElement('section');
  root.className = 'tw-darknet-terminal-card';
  root.setAttribute('data-test', 'darknet-terminal-card');

  // 1. 顶部加密遥测条
  const telemetry = doc.createElement('div');
  telemetry.className = 'tw-darknet-telemetry-strip';
  telemetry.setAttribute('data-test', 'darknet-telemetry-strip');

  const teleLeft = doc.createElement('span');
  teleLeft.textContent = 'SUBSPACE DARKNET BROKER // QUANTUM RELAY TERMINAL';
  const teleRight = doc.createElement('span');
  teleRight.textContent = `NEXT AUCTION: ${parsed.nextAuction}`;
  telemetry.appendChild(teleLeft);
  telemetry.appendChild(teleRight);
  root.appendChild(telemetry);

  // 2. 顶栏：标题 + 市场连接状态徽标 + 拍卖状态徽标
  const header = doc.createElement('header');
  header.className = 'tw-darknet-header';
  header.setAttribute('data-test', 'darknet-header');

  const titleEl = doc.createElement('h3');
  titleEl.className = 'tw-darknet-title';
  titleEl.setAttribute('data-test', 'darknet-title');
  titleEl.textContent = '🕶️ 超维暗网中继终端';

  const badges = doc.createElement('div');
  badges.className = 'tw-darknet-badges';

  const marketBadge = doc.createElement('span');
  marketBadge.className = 'tw-darknet-market-badge';
  marketBadge.setAttribute('data-test', 'darknet-market-status');
  marketBadge.textContent = `市场 · ${parsed.marketStatus}`;

  const auctionBadge = doc.createElement('span');
  auctionBadge.className = `tw-darknet-auction-badge${parsed.isAuctionBidding ? ' is-bidding' : ''}`;
  auctionBadge.setAttribute('data-test', 'darknet-auction-status');
  auctionBadge.textContent = parsed.isAuctionBidding
    ? `🔥 拍卖竞价中 (${parsed.auctionStatus})`
    : `拍卖 · ${parsed.auctionStatus}`;

  badges.appendChild(marketBadge);
  badges.appendChild(auctionBadge);
  header.appendChild(titleEl);
  header.appendChild(badges);
  root.appendChild(header);

  // 3. 主体区：本轮交割回执 + 超维拍卖厅实时叫价榜
  const body = doc.createElement('div');
  body.className = 'tw-darknet-body';

  // 3.1 本轮交割回执
  const settlementSection = doc.createElement('div');
  settlementSection.className = 'tw-darknet-section';
  settlementSection.setAttribute('data-test', 'darknet-settlements-section');

  const settlementTitle = doc.createElement('div');
  settlementTitle.className = 'tw-darknet-section-title';
  settlementTitle.textContent = `⚡ 本轮交割回执 (${parsed.settlements.length})`;
  settlementSection.appendChild(settlementTitle);

  const settlementList = doc.createElement('div');
  settlementList.className = 'tw-darknet-settlement-list';

  if (parsed.settlements.length === 0) {
    const emptySettlement = doc.createElement('div');
    emptySettlement.className = 'tw-darknet-note';
    emptySettlement.textContent = '本轮暂无暗网实物或情报交割记录。';
    settlementList.appendChild(emptySettlement);
  } else {
    for (const item of parsed.settlements) {
      const row = doc.createElement('div');
      row.className = 'tw-darknet-settlement-item';
      row.setAttribute('data-test', 'darknet-settlement-item');

      const top = doc.createElement('div');
      top.className = 'tw-darknet-settlement-top';

      const left = doc.createElement('div');
      left.className = 'tw-darknet-settlement-left';

      const actionTag = doc.createElement('span');
      actionTag.className = 'tw-darknet-action-tag';
      actionTag.setAttribute('data-test', 'darknet-settlement-action');
      actionTag.textContent = item.action;

      const targetName = doc.createElement('span');
      targetName.className = 'tw-darknet-target-name';
      targetName.setAttribute('data-test', 'darknet-settlement-target');
      targetName.textContent = item.target;

      left.appendChild(actionTag);
      left.appendChild(targetName);

      if (item.dedupeKey) {
        const dedupeTag = doc.createElement('span');
        dedupeTag.className = 'tw-darknet-dedupe-tag';
        dedupeTag.setAttribute('data-test', 'darknet-settlement-dedupe');
        dedupeTag.textContent = `交易单号: ${item.dedupeKey}`;
        left.appendChild(dedupeTag);
      }

      const deltaEl = doc.createElement('span');
      const deltaTone =
        item.creditsDelta > 0 ? 'is-positive' : item.creditsDelta < 0 ? 'is-negative' : 'is-neutral';
      deltaEl.className = `tw-darknet-delta ${deltaTone}`;
      deltaEl.setAttribute('data-test', 'darknet-settlement-delta');
      deltaEl.textContent = item.creditsDeltaText;

      top.appendChild(left);
      top.appendChild(deltaEl);
      row.appendChild(top);

      if (item.note) {
        const noteEl = doc.createElement('p');
        noteEl.className = 'tw-darknet-note';
        noteEl.setAttribute('data-test', 'darknet-settlement-note');
        noteEl.textContent = item.note;
        row.appendChild(noteEl);
      }

      settlementList.appendChild(row);
    }
  }

  settlementSection.appendChild(settlementList);
  body.appendChild(settlementSection);

  // 3.2 超维拍卖厅实时叫价榜
  const auctionSection = doc.createElement('div');
  auctionSection.className = 'tw-darknet-section';
  auctionSection.setAttribute('data-test', 'darknet-auctions-section');

  const auctionTitle = doc.createElement('div');
  auctionTitle.className = 'tw-darknet-section-title';
  auctionTitle.textContent = `🏛️ 超维拍卖厅实时叫价榜 (${parsed.auctions.length})`;
  auctionSection.appendChild(auctionTitle);

  const auctionList = doc.createElement('div');
  auctionList.className = 'tw-darknet-auction-list';

  if (parsed.auctions.length === 0) {
    const emptyAuction = doc.createElement('div');
    emptyAuction.className = 'tw-darknet-note';
    emptyAuction.textContent = `当期拍卖厅休市中 · 距离下场专场开启: ${parsed.nextAuction}`;
    auctionList.appendChild(emptyAuction);
  } else {
    for (const auc of parsed.auctions) {
      const card = doc.createElement('div');
      card.className = 'tw-darknet-auction-item';
      card.setAttribute('data-test', 'darknet-auction-item');

      const top = doc.createElement('div');
      top.className = 'tw-darknet-auction-top';

      const nameEl = doc.createElement('span');
      nameEl.className = 'tw-darknet-auction-name';
      nameEl.setAttribute('data-test', 'darknet-auction-name');
      nameEl.textContent = auc.name;

      const statusEl = doc.createElement('span');
      statusEl.className = 'tw-darknet-dedupe-tag';
      statusEl.setAttribute('data-test', 'darknet-auction-lot-status');
      statusEl.textContent = `${auc.status} · 卖方: ${auc.seller}`;

      top.appendChild(nameEl);
      top.appendChild(statusEl);
      card.appendChild(top);

      const meta = doc.createElement('div');
      meta.className = 'tw-darknet-auction-meta';

      const startEl = doc.createElement('span');
      startEl.textContent = `起拍价: ${auc.startPrice} CREDITS`;

      const priceEl = doc.createElement('span');
      priceEl.className = 'tw-darknet-auction-price';
      priceEl.setAttribute('data-test', 'darknet-auction-price');
      priceEl.textContent = `当前最高价: ${auc.currentPrice} CREDITS`;

      const leaderEl = doc.createElement('span');
      leaderEl.className = 'tw-darknet-auction-leader';
      leaderEl.setAttribute('data-test', 'darknet-auction-leader');
      leaderEl.textContent = `领先方: ${auc.leader}`;

      const roundEl = doc.createElement('span');
      roundEl.setAttribute('data-test', 'darknet-auction-round');
      roundEl.textContent = `轮次: ${auc.round}`;

      meta.appendChild(startEl);
      meta.appendChild(priceEl);
      meta.appendChild(leaderEl);
      meta.appendChild(roundEl);
      card.appendChild(meta);

      if (auc.desc) {
        const descEl = doc.createElement('p');
        descEl.className = 'tw-darknet-note';
        descEl.textContent = auc.desc;
        card.appendChild(descEl);
      }

      auctionList.appendChild(card);
    }
  }

  auctionSection.appendChild(auctionList);
  body.appendChild(auctionSection);
  root.appendChild(body);

  // 4. 底部手风琴折叠区：当期黑市货架与求购悬赏 (N)
  const shelfTotal = parsed.items.length + parsed.bounties.length;
  const accordion = doc.createElement('div');
  accordion.className = 'tw-darknet-accordion';
  accordion.setAttribute('data-test', 'darknet-shelf-accordion');
  accordion.setAttribute('data-expanded', 'false');

  const toggleBtn = doc.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'tw-darknet-accordion-toggle';
  toggleBtn.setAttribute('data-test', 'darknet-accordion-toggle');
  toggleBtn.setAttribute('aria-expanded', 'false');
  toggleBtn.textContent = `▶ 当期黑市货架与求购悬赏 (${shelfTotal})`;

  const accordionBody = doc.createElement('div');
  accordionBody.className = 'tw-darknet-accordion-body';
  accordionBody.setAttribute('data-test', 'darknet-accordion-body');
  accordionBody.style.display = 'none';

  for (const item of parsed.items) {
    const itemCard = doc.createElement('div');
    itemCard.className = 'tw-darknet-shelf-card';
    itemCard.setAttribute('data-test', 'darknet-market-item');

    const itemHeader = doc.createElement('div');
    itemHeader.className = 'tw-darknet-shelf-header';

    const itemName = doc.createElement('span');
    itemName.textContent = `[黑市] ${item.name}`;

    const itemPrice = doc.createElement('span');
    itemPrice.className = 'tw-darknet-shelf-price';
    itemPrice.textContent = `${item.price} CREDITS (库存 ${item.stock})`;

    itemHeader.appendChild(itemName);
    itemHeader.appendChild(itemPrice);
    itemCard.appendChild(itemHeader);

    if (item.desc) {
      const itemDesc = doc.createElement('p');
      itemDesc.className = 'tw-darknet-note';
      itemDesc.textContent = `${item.category} · ${item.desc}`;
      itemCard.appendChild(itemDesc);
    }

    accordionBody.appendChild(itemCard);
  }

  for (const bounty of parsed.bounties) {
    const bountyCard = doc.createElement('div');
    bountyCard.className = 'tw-darknet-shelf-card';
    bountyCard.setAttribute('data-test', 'darknet-bounty-item');

    const bountyHeader = doc.createElement('div');
    bountyHeader.className = 'tw-darknet-shelf-header';

    const bountyTarget = doc.createElement('span');
    bountyTarget.textContent = `[悬赏] ${bounty.target}`;

    const bountyReward = doc.createElement('span');
    bountyReward.className = 'tw-darknet-shelf-price';
    bountyReward.textContent = `+${bounty.rewardCredits} CREDITS (${bounty.status})`;

    bountyHeader.appendChild(bountyTarget);
    bountyHeader.appendChild(bountyReward);
    bountyCard.appendChild(bountyHeader);

    if (bounty.desc) {
      const bountyDesc = doc.createElement('p');
      bountyDesc.className = 'tw-darknet-note';
      bountyDesc.textContent = `${bounty.category} · ${bounty.desc}`;
      bountyCard.appendChild(bountyDesc);
    }

    accordionBody.appendChild(bountyCard);
  }

  let expanded = false;
  toggleBtn.addEventListener('click', () => {
    expanded = !expanded;
    accordion.setAttribute('data-expanded', expanded ? 'true' : 'false');
    toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggleBtn.textContent = `${expanded ? '▴' : '▶'} 当期黑市货架与求购悬赏 (${shelfTotal})`;
    accordionBody.style.display = expanded ? 'grid' : 'none';
    onResize?.();
  });

  accordion.appendChild(toggleBtn);
  accordion.appendChild(accordionBody);
  root.appendChild(accordion);

  return root;
}
