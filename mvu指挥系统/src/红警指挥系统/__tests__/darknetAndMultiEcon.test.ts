import { describe, expect, it } from 'vitest';
import {
  DarknetAuctionItem,
  DarknetBountyItem,
  DarknetMarketItem,
  DarknetResourceMap,
  DarknetSettlementRecord,
  DarknetState,
  EconomyChannelDaily,
  Schema,
} from '../core/schema';
import {
  applyDarknetBlockToState,
  computeBuildingPassiveDailyCredits,
  extractDarknetBlocks,
  parseAuctionCountdownMinutes,
  tickDarknetAndPassiveEconomy,
} from '../engines/darknetEngine';
import { settleFloor } from '../engines/settleFloor';
import { parseMessageText } from '../parse/parsePipeline';

describe('DARKNET-CORE-01 · 暗网 Schema、解析门与多元经济结算引擎', () => {
  describe('1. 旧档向后兼容与 Schema 默认值契约', () => {
    it('Schema.parse({}) 零报错向后兼容，且归零态不注入冗余可选键', () => {
      const zero = Schema.parse({});
      expect(zero.economy).toStrictEqual({
        credits: 0,
        credits_daily: 0,
        wallet: {},
        chains: [],
      });
      expect(zero.economy.darknet).toBeUndefined();
      expect(zero.economy.channel_daily).toBeUndefined();
    });

    it('各子 Schema 全部具备默认值，支持空对象 parse({})', () => {
      expect(DarknetResourceMap.parse({})).toEqual({ pillar: '', key: '', qty: 0 });
      expect(DarknetMarketItem.parse({})).toEqual({
        id: '',
        name: '',
        category: '战略物资',
        price: 0,
        stock: 1,
        desc: '',
      });
      expect(DarknetBountyItem.parse({})).toEqual({
        id: '',
        target: '',
        category: '情报数据',
        reward_credits: 0,
        status: 'open',
        deadline_text: '',
        desc: '',
      });
      expect(DarknetAuctionItem.parse({})).toEqual({
        id: '',
        name: '',
        seller: '跨维匿名卖方',
        start_price: 0,
        current_price: 0,
        leader: '暂无出价',
        round_text: '第1轮',
        status: 'bidding',
        desc: '',
      });
      expect(DarknetSettlementRecord.parse({})).toEqual({
        id: '',
        action: '',
        target: '',
        credits_delta: 0,
        note: '',
        at_day: 0,
      });
      expect(DarknetState.parse({})).toEqual({
        market_status: '未接入',
        auction_status: 'closed',
        next_auction_in_minutes: 10080,
        items: [],
        bounties: [],
        auctions: [],
        sold_intel_ids: [],
        completed_bounty_ids: [],
        settled_auction_ids: [],
        ledger: [],
      });
      expect(EconomyChannelDaily.parse({})).toEqual({
        refining: 0,
        recycling: 0,
        petrochemical: 0,
        chains: 0,
        total: 0,
      });
    });
  });

  describe('2. <暗网> 完整 YAML 解析：商品、悬赏、拍卖与倒计时归一', () => {
    it('正确解析在售商品、求购悬赏、当期拍卖、市场状态与倒计时文本', () => {
      expect(parseAuctionCountdownMinutes('12h')).toBe(720);
      expect(parseAuctionCountdownMinutes('3d')).toBe(4320);
      expect(parseAuctionCountdownMinutes('余3日')).toBe(4320);
      expect(parseAuctionCountdownMinutes(360)).toBe(360);

      const rawFloor = `
<正文>
指挥官接入超维暗网中继站终端，浏览当期黑市货架与专场拍卖清单。
</正文>

<暗网>
市场状态: 正常连接
拍卖状态: 开启中
距离下次拍卖: 12h
在售商品:
  - 编号: dn_item_01
    名称: 高纯度构造型纳米母液（50单位）
    类别: 战略资源
    价格: 2200
    库存: 2
    简介: 跨位面军工剩余产能封装，购入后直接注入基地纳米储罐。
    资源映射: {柱: nanites, 键: 高精构造型纳米, 数量: 50}
求购悬赏:
  - 编号: dn_bounty_01
    目标: 筑基期妖兽完整灵核或高阶精神力结晶
    类别: 异界样本
    悬赏金: 3800
    状态: 待交割
    时限: 余3日
    简介: 编号774生物机械学派高价求购活体精神传导介质。
当期拍卖:
  - 编号: dn_auc_01
    拍品: 废弃天基动能武器火控黑匣子
    卖方: 跨维流亡军工署
    起拍价: 6000
    当前最高价: 8000
    领先方: 铁幕残党
    轮次: 第1轮叫价
    状态: 竞价中
    简介: 内含残缺轨道火控解算参数。
</暗网>
`;

      const blocks = extractDarknetBlocks(rawFloor);
      expect(blocks).toHaveLength(1);

      const parsed = parseMessageText(rawFloor, { economy: { credits: 5000 } });
      expect(parsed.applied).toBe(true);
      expect(parsed.quarantine).toHaveLength(0);

      const dn = parsed.data.economy.darknet!;
      expect(dn).toBeDefined();
      expect(dn.market_status).toBe('正常连接');
      expect(dn.auction_status).toBe('bidding');
      expect(dn.next_auction_in_minutes).toBe(720);

      expect(dn.items).toHaveLength(1);
      expect(dn.items[0]).toMatchObject({
        id: 'dn_item_01',
        name: '高纯度构造型纳米母液（50单位）',
        category: '战略资源',
        price: 2200,
        stock: 2,
        resource_map: { pillar: 'nanites', key: '高精构造型纳米', qty: 50 },
      });

      expect(dn.bounties).toHaveLength(1);
      expect(dn.bounties[0]).toMatchObject({
        id: 'dn_bounty_01',
        target: '筑基期妖兽完整灵核或高阶精神力结晶',
        reward_credits: 3800,
        status: 'open',
        deadline_text: '余3日',
      });

      expect(dn.auctions).toHaveLength(1);
      expect(dn.auctions[0]).toMatchObject({
        id: 'dn_auc_01',
        name: '废弃天基动能武器火控黑匣子',
        seller: '跨维流亡军工署',
        start_price: 6000,
        current_price: 8000,
        leader: '铁幕残党',
        round_text: '第1轮叫价',
        status: 'bidding',
      });
    });
  });

  describe('3. 售出实物：六柱库存扣减与不足刚性阻断', () => {
    it('六柱库存充足时正常扣减库存并增加 credits，库存不足时阻断交割（绝不扣成负数或凭空加钱）', () => {
      const base = Schema.parse({
        economy: {
          credits: 1000,
          resources: {
            munitions: { 步兵制式弹药: 25 },
            minerals: { 灵石原矿: 5 },
          },
        },
      });

      const raw = `
<暗网>
市场状态: 正常连接
本轮交割:
  - 动作: 售出实物
    标的: 缴获制式步兵弹药箱
    资源扣减: {柱: 军械, 键: 步兵制式弹药, 数量: 20}
    资金变动: "+600系统资金"
    说明: 经超维暗网中继站传质舱解构投递完成。
  - 动作: 售出实物
    标的: 超额灵石原矿投递
    资源扣减: {柱: minerals, 键: 灵石原矿, 数量: 10}
    资金变动: +2000
    说明: 试图投递超出库存的灵石。
</暗网>
`;

      const res = parseMessageText(raw, base);
      // 第一笔成功：25 - 20 = 5，credits = 1000 + 600 = 1600
      expect(res.data.economy.resources?.munitions['步兵制式弹药']).toBe(5);
      // 第二笔库存不足被阻断：灵石原矿保持 5，不扣成 -5，也不加 2000 credits
      expect(res.data.economy.resources?.minerals['灵石原矿']).toBe(5);
      expect(res.data.economy.credits).toBe(1600);
      expect(res.data.economy.darknet?.ledger).toHaveLength(1);
      expect(res.data.economy.darknet?.ledger[0]).toMatchObject({
        action: '售出实物',
        target: '缴获制式步兵弹药箱',
        credits_delta: 600,
      });
      // 存在单位剥离与库存不足的 🟡 留痕
      expect(res.events.some(e => e.light === '🟡' && e.message.includes('库存不足'))).toBe(true);
    });
  });

  describe('4. 售出信息与 sold_intel_ids 唯一性查重锁', () => {
    it('首次上传情报正常增加 credits 并记录查重键，第二次上传同键或同名情报被拦截归零', () => {
      const floor1Raw = `
<暗网>
本轮交割:
  - 动作: 售出信息
    标的: 北坡矿区灵脉分布与护山阵眼详图
    查重键: intel_beipo_spirit_vein_map
    资金变动: +1500
    说明: 首次上传跨位面灵脉测绘数据。
</暗网>
`;
      const floor1 = parseMessageText(floor1Raw, { economy: { credits: 500 } });
      expect(floor1.data.economy.credits).toBe(2000);
      expect(floor1.data.economy.darknet?.sold_intel_ids).toContain('intel_beipo_spirit_vein_map');

      // 第二楼尝试重复售出同一查重键情报，以及不带查重键但同名重复的情报
      const floor2Raw = `
<暗网>
本轮交割:
  - 动作: 上传情报
    标的: 北坡矿区灵脉分布重制版
    查重键: intel_beipo_spirit_vein_map
    资金变动: +1500
  - 动作: 售出数据
    标的: 青岚宗护山大阵频谱分析
    资金变动: +800
  - 动作: 售出信息
    标的: 青岚宗护山大阵频谱分析
    资金变动: +800
</暗网>
`;
      const floor2 = parseMessageText(floor2Raw, floor1.data);
      // 第一条被 intel_beipo_spirit_vein_map 拦截 (+0)，第二条首次通过 (+800)，第三条按归一化标的名拦截 (+0)
      expect(floor2.data.economy.credits).toBe(2800);
      expect(
        floor2.events.filter(e => e.light === '🟡' && e.message.includes('暗网查重拦截')),
      ).toHaveLength(2);
      const lastLedger = floor2.data.economy.darknet!.ledger.at(-1)!;
      expect(lastLedger.credits_delta).toBe(0);
    });
  });

  describe('5. 多轮慢节奏拍卖会、黑市直购与求购悬赏闭环', () => {
    it('竞拍出价只更新价格/领先方/轮次而不扣款；拍卖竞得落槌一次性扣款并入库 resource_map；拍卖送拍成交正常收款', () => {
      const init = Schema.parse({
        economy: {
          credits: 12000,
          resources: {
            minerals: { 紫幽玄铁: 3 },
          },
          darknet: {
            market_status: '正常连接',
            auction_status: 'bidding',
            items: [
              {
                id: 'dn_item_01',
                name: '高纯度构造型纳米母液',
                price: 2000,
                stock: 1,
                resource_map: { pillar: 'nanites', key: '高精构造型纳米', qty: 50 },
              },
            ],
            bounties: [
              {
                id: 'dn_bounty_01',
                target: '筑基期妖兽完整灵核',
                reward_credits: 3000,
                status: 'open',
              },
            ],
            auctions: [
              {
                id: 'dn_auc_01',
                name: '天基动能火控黑匣子',
                seller: '跨维流亡军工署',
                start_price: 6000,
                current_price: 7500,
                leader: '铁幕残党',
                round_text: '第1轮',
                status: 'bidding',
                resource_map: { pillar: 'nanites', key: '标准纳米工料', qty: 120 },
              },
            ],
          },
        },
      });

      // 第 1 轮：我方竞拍出价 + 上架送拍战利品（竞拍过程不扣减 credits）
      const round1Raw = `
<暗网>
本轮交割:
  - 动作: 竞拍出价
    编号: dn_auc_01
    标的: 天基动能火控黑匣子
    出价: 9500
    领先方: 我方指挥部
    轮次: 第2轮叫价
  - 动作: 上架送拍
    编号: dn_auc_02
    标的: 极品紫幽玄铁精粹
    起拍价: 4000
    资源扣减: {柱: minerals, 键: 紫幽玄铁, 数量: 2}
</暗网>
`;
      const afterRound1 = parseMessageText(round1Raw, init);
      expect(afterRound1.data.economy.credits).toBe(12000); // 竞拍出价绝不提前扣款
      expect(afterRound1.data.economy.resources?.minerals['紫幽玄铁']).toBe(1); // 送拍实物已锁定扣除
      const auc1 = afterRound1.data.economy.darknet!.auctions.find(a => a.id === 'dn_auc_01')!;
      expect(auc1.current_price).toBe(9500);
      expect(auc1.leader).toBe('我方指挥部');
      expect(auc1.round_text).toBe('第2轮叫价');
      expect(auc1.status).toBe('bidding');

      // 第 2 轮：落槌结算（竞得 dn_auc_01 + 我方送拍 dn_auc_02 成交 + 购买商品 + 完成悬赏）
      const round2Raw = `
<暗网>
本轮交割:
  - 动作: 拍卖竞得落槌
    编号: dn_auc_01
    标的: 天基动能火控黑匣子
    出价: 9500
  - 动作: 拍卖送拍成交
    编号: dn_auc_02
    标的: 极品紫幽玄铁精粹
    资金变动: +6800
    领先方: 星界机械教团
  - 动作: 购买商品
    编号: dn_item_01
    标的: 高纯度构造型纳米母液
  - 动作: 完成悬赏
    编号: dn_bounty_01
    标的: 筑基期妖兽完整灵核
</暗网>
`;
      const afterRound2 = parseMessageText(round2Raw, afterRound1.data);
      // 资金计算：12000 - 9500(竞得) + 6800(送拍收款) - 2000(直购) + 3000(悬赏) = 10300
      expect(afterRound2.data.economy.credits).toBe(10300);
      // 竞得拍品与直购商品的 resource_map 自动解锁入库
      expect(afterRound2.data.economy.resources?.nanites['标准纳米工料']).toBe(120);
      expect(afterRound2.data.economy.resources?.nanites['高精构造型纳米']).toBe(50);
      // 状态变更检查
      expect(afterRound2.data.economy.darknet!.auctions.find(a => a.id === 'dn_auc_01')!.status).toBe('sold');
      expect(afterRound2.data.economy.darknet!.auctions.find(a => a.id === 'dn_auc_02')!.status).toBe('sold');
      expect(afterRound2.data.economy.darknet!.items[0].stock).toBe(0);
      expect(afterRound2.data.economy.darknet!.bounties[0].status).toBe('completed');
    });
  });

  describe('G10-F03 同块终态声明不能锁死失败交割重试', () => {
    it('sold 拍品余额不足不落账，补足后同块终态落槌成功且仅交割一次', () => {
      const raw = `<暗网>
当期拍卖:
  - 编号: retry_auc
    拍品: 火控黑匣子
    状态: 已成交
    当前最高价: 1000
    资源映射: {柱: materials, 键: 黑匣子, 数量: 1}
本轮交割:
  - 动作: 拍卖竞得落槌
    编号: retry_auc
</暗网>`;
      const failed = parseMessageText(raw, Schema.parse({
        economy: { credits: 500, resources: { materials: { 黑匣子: 0 } } },
      }));
      expect(failed.data.economy.credits).toBe(500);
      expect(failed.data.economy.resources!.materials['黑匣子']).toBe(0);
      expect(failed.data.economy.darknet!.ledger).toHaveLength(0);
      expect(failed.data.economy.darknet!.auctions[0].status).toBe('bidding');

      failed.data.economy.credits = 1500; // 下一楼结算前已补足资金
      const retried = parseMessageText(raw, failed.data);
      expect(retried.data.economy.credits).toBe(500);
      expect(retried.data.economy.resources!.materials['黑匣子']).toBe(1);
      expect(retried.data.economy.darknet!.auctions[0].status).toBe('sold');
      expect(retried.data.economy.darknet!.ledger).toHaveLength(1);
      const repeated = parseMessageText(raw, retried.data);
      expect(repeated.data.economy.credits).toBe(500);
      expect(repeated.data.economy.resources!.materials['黑匣子']).toBe(1);
      expect(repeated.data.economy.darknet!.ledger).toHaveLength(1);
    });

    it('completed 悬赏库存不足不落账，补货后同块终态交赏成功且仅交割一次', () => {
      const raw = `<暗网>
求购悬赏:
  - 编号: retry_bounty
    目标: 样本交付
    状态: 已完成
    悬赏金: 1000
本轮交割:
  - 动作: 完成悬赏
    编号: retry_bounty
    资源扣减: {柱: materials, 键: 样本, 数量: 2}
</暗网>`;
      const failed = parseMessageText(raw, Schema.parse({
        economy: { credits: 500, resources: { materials: { 样本: 1 } } },
      }));
      expect(failed.data.economy.credits).toBe(500);
      expect(failed.data.economy.resources!.materials['样本']).toBe(1);
      expect(failed.data.economy.darknet!.ledger).toHaveLength(0);
      expect(failed.data.economy.darknet!.bounties[0].status).toBe('open');

      failed.data.economy.resources!.materials['样本'] = 3; // 下一楼结算前已补货
      const retried = parseMessageText(raw, failed.data);
      expect(retried.data.economy.credits).toBe(1500);
      expect(retried.data.economy.resources!.materials['样本']).toBe(1);
      expect(retried.data.economy.darknet!.bounties[0].status).toBe('completed');
      expect(retried.data.economy.darknet!.ledger).toHaveLength(1);
      const repeated = parseMessageText(raw, retried.data);
      expect(repeated.data.economy.credits).toBe(1500);
      expect(repeated.data.economy.resources!.materials['样本']).toBe(1);
      expect(repeated.data.economy.darknet!.ledger).toHaveLength(1);
    });
  });

  describe('G10-F04 送拍库存只在新建挂单时托管', () => {
    it('同ID同块与跨楼重复上架只扣一次，仍可更新起拍价', () => {
      const raw = `<暗网>
本轮交割:
  - 动作: 上架送拍
    编号: consign_1
    标的: 玄铁
    起拍价: 100
    资源扣减: {柱: minerals, 键: 玄铁, 数量: 3}
  - 动作: 上架送拍
    编号: consign_1
    标的: 玄铁
    起拍价: 200
    资源扣减: {柱: minerals, 键: 玄铁, 数量: 3}
</暗网>`;
      const first = parseMessageText(raw, Schema.parse({
        economy: { credits: 500, resources: { minerals: { 玄铁: 10 } } },
      }));
      expect(first.data.economy.resources!.minerals['玄铁']).toBe(7);
      const repeated = parseMessageText(raw, first.data);
      expect(repeated.data.economy.resources!.minerals['玄铁']).toBe(7);
      expect(repeated.data.economy.credits).toBe(500);
      expect(repeated.data.economy.darknet!.auctions).toHaveLength(1);
      expect(repeated.data.economy.darknet!.auctions[0].start_price).toBe(200);
    });

    it('不同ID的同名拍品分别创建挂单并各扣一次库存', () => {
      const result = parseMessageText(`<暗网>
本轮交割:
  - {动作: 上架送拍, 编号: consign_1, 标的: 玄铁, 资源扣减: {柱: minerals, 键: 玄铁, 数量: 3}}
  - {动作: 上架送拍, 编号: consign_2, 标的: 玄铁, 资源扣减: {柱: minerals, 键: 玄铁, 数量: 3}}
</暗网>`, Schema.parse({
        economy: { resources: { minerals: { 玄铁: 10 } } },
      }));
      expect(result.data.economy.resources!.minerals['玄铁']).toBe(4);
      expect(result.data.economy.darknet!.auctions.map(a => a.id)).toEqual(['consign_1', 'consign_2']);
    });

    it('新挂单库存不足时不扣库存、不创建拍品或成功流水', () => {
      const result = parseMessageText(`<暗网>
本轮交割:
  - {动作: 上架送拍, 编号: consign_1, 标的: 玄铁, 资源扣减: {柱: minerals, 键: 玄铁, 数量: 3}}
</暗网>`, Schema.parse({
        economy: { credits: 500, resources: { minerals: { 玄铁: 2 } } },
      }));
      expect(result.data.economy.resources!.minerals['玄铁']).toBe(2);
      expect(result.data.economy.credits).toBe(500);
      expect(result.data.economy.darknet!.auctions).toHaveLength(0);
      expect(result.data.economy.darknet!.ledger).toHaveLength(0);
      expect(result.events.some(e => e.message.includes('[暗网送拍阻断]'))).toBe(true);
    });
  });

  describe('G10-F05 显式入库映射无效时拒收且不发生扣款或终态变更', () => {
    it('直购与落槌含非法资源柱、非正数量或空显式映射时拒收，余额、库存、拍品状态与流水均不变', () => {
      const init = Schema.parse({
        economy: {
          credits: 5000,
          resources: {
            materials: { 高强钢材: 10 },
          },
          darknet: {
            market_status: '正常连接',
            auction_status: 'bidding',
            items: [
              { id: 'item_valid_stock', name: '装甲钢板包', price: 1000, stock: 2 },
            ],
            auctions: [
              {
                id: 'auc_bidding',
                name: '特种合金锭批件',
                start_price: 1200,
                current_price: 1500,
                leader: '我方指挥部',
                status: 'bidding',
              },
            ],
          },
        },
      });

      const invalidRaw = `<暗网>
当期拍卖:
  - 编号: auc_bidding
    拍品: 特种合金锭批件
    当前最高价: 1500
    状态: 已成交
本轮交割:
  - 动作: 购买商品
    编号: item_valid_stock
    标的: 装甲钢板包
    入库物资: {柱: unknown_pillar, 键: 高强钢材, 数量: 5}
  - 动作: 购买商品
    编号: item_valid_stock
    标的: 装甲钢板包
    获得物资: {柱: materials, 键: 高强钢材, 数量: 0}
  - 动作: 拍卖竞得落槌
    编号: auc_bidding
    标的: 特种合金锭批件
    resource_credit: {}
</暗网>`;

      const afterInvalid = parseMessageText(invalidRaw, init);
      expect(afterInvalid.data.economy.credits).toBe(5000);
      expect(afterInvalid.data.economy.resources!.materials['高强钢材']).toBe(10);
      expect(afterInvalid.data.economy.darknet!.items[0].stock).toBe(2);
      expect(afterInvalid.data.economy.darknet!.auctions[0].status).toBe('bidding');
      expect(afterInvalid.data.economy.darknet!.ledger).toHaveLength(0);
      expect(afterInvalid.events.filter(e => e.light === '🟡' && e.message.includes('入库映射无效'))).toHaveLength(3);
    });

    it('合法显式入库映射与无显式映射的奇物/装备交割均正常成功', () => {
      const init = Schema.parse({
        economy: {
          credits: 5000,
          resources: {
            materials: { 高强钢材: 10 },
          },
          darknet: {
            market_status: '正常连接',
            auction_status: 'bidding',
            items: [
              { id: 'item_steel', name: '装甲钢板包', price: 1000, stock: 2 },
            ],
            auctions: [
              {
                id: 'auc_curio',
                name: '轨道火控黑匣子（奇物）',
                start_price: 1200,
                current_price: 1500,
                leader: '我方指挥部',
                status: 'bidding',
              },
            ],
          },
        },
      });

      const validRaw = `<暗网>
本轮交割:
  - 动作: 购买商品
    编号: item_steel
    标的: 装甲钢板包
    入库物资: {柱: materials, 键: 高强钢材, 数量: 5}
  - 动作: 拍卖竞得落槌
    编号: auc_curio
    标的: 轨道火控黑匣子（奇物）
    出价: 1500
</暗网>`;

      const afterValid = parseMessageText(validRaw, init);
      expect(afterValid.data.economy.credits).toBe(2500);
      expect(afterValid.data.economy.resources!.materials['高强钢材']).toBe(15);
      expect(afterValid.data.economy.darknet!.items[0].stock).toBe(1);
      expect(afterValid.data.economy.darknet!.auctions[0].status).toBe('sold');
      expect(afterValid.data.economy.darknet!.ledger).toHaveLength(2);
    });
  });

  describe('G10-F02 跨目录刷新持久交割防重与终态防复活', () => {
    it('悬赏/拍品结清后即使被新目录清空且超过20条流水，重传同ID仍拒收；同名不同ID新实例合法成交', () => {
      const floor1 = parseMessageText(`<暗网>
求购悬赏:
  - 编号: b_settled_01
    目标: 高阶妖兽灵核
    悬赏金: 1000
当期拍卖:
  - 编号: a_won_01
    拍品: 轨道火控黑匣子
    当前最高价: 2000
  - 编号: a_sold_01
    拍品: 紫幽玄铁精粹
    卖方: 我方指挥部
    当前最高价: 1500
本轮交割:
  - {动作: 完成悬赏, 编号: b_settled_01, 标的: 高阶妖兽灵核}
  - {动作: 拍卖竞得落槌, 编号: a_won_01, 标的: 轨道火控黑匣子, 出价: 2000}
  - {动作: 拍卖送拍成交, 编号: a_sold_01, 标的: 紫幽玄铁精粹, 资金变动: +1500}
</暗网>`, Schema.parse({ economy: { credits: 5000 } }));

      // 5000 + 1000 - 2000 + 1500 = 5500
      expect(floor1.data.economy.credits).toBe(5500);

      // 第二楼清空悬赏与拍卖目录，并刷入 22 笔普通交易使 ledger 滚动截断超过 20 条上限
      const fillerLines = Array.from(
        { length: 22 },
        (_, i) => `  - {动作: 售出实物, 编号: tx_fill_${i}, 标的: 零散废铁_${i}, 资金变动: +10}`,
      ).join('\n');
      const floor2 = parseMessageText(`<暗网>
求购悬赏: []
当期拍卖: []
本轮交割:
${fillerLines}
</暗网>`, floor1.data);
      expect(floor2.data.economy.credits).toBe(5720);
      expect(floor2.data.economy.darknet!.bounties).toHaveLength(0);
      expect(floor2.data.economy.darknet!.auctions).toHaveLength(0);
      expect(floor2.data.economy.darknet!.ledger).toHaveLength(20);

      // 第三楼重传已结清的同 ID 悬赏与拍品交割，必须全部幂等拦截；同时提交同名但不同 ID 的新实例，应合法成交
      const floor3 = parseMessageText(`<暗网>
本轮交割:
  - {动作: 完成悬赏, 编号: b_settled_01, 标的: 高阶妖兽灵核, 资金变动: +1000}
  - {动作: 拍卖竞得落槌, 编号: a_won_01, 标的: 轨道火控黑匣子, 出价: 2000}
  - {动作: 拍卖送拍成交, 编号: a_sold_01, 标的: 紫幽玄铁精粹, 资金变动: +1500}
  - {动作: 完成悬赏, 编号: b_settled_02, 标的: 高阶妖兽灵核, 资金变动: +800}
  - {动作: 拍卖竞得落槌, 编号: a_won_02, 标的: 轨道火控黑匣子, 出价: 1200}
</暗网>`, floor2.data);

      // 仅 b_settled_02 (+800) 与 a_won_02 (-1200) 生效：5720 + 800 - 1200 = 5320
      expect(floor3.data.economy.credits).toBe(5320);
    });

    it('已进入 sold/expired 终态的拍品与已 completed/expired 的悬赏在列表刷新或竞拍出价时不会复活', () => {
      const init = Schema.parse({
        economy: {
          credits: 5000,
          darknet: {
            market_status: '正常连接',
            auction_status: 'bidding',
            bounties: [
              { id: 'b_done', target: '已交割情报', reward_credits: 1000, status: 'completed' },
              { id: 'b_exp', target: '过期求购单', reward_credits: 1000, status: 'expired' },
            ],
            auctions: [
              {
                id: 'a_done',
                name: '已落槌黑匣子',
                start_price: 1000,
                current_price: 2000,
                leader: '我方指挥部',
                status: 'sold',
              },
              {
                id: 'a_exp',
                name: '流拍过期残骸',
                start_price: 1000,
                current_price: 1000,
                leader: '暂无出价',
                status: 'passed',
              },
            ],
          },
        },
      });

      const res = parseMessageText(`<暗网>
求购悬赏:
  - {编号: b_done, 目标: 已交割情报, 悬赏金: 1000, 状态: 待交割}
  - {编号: b_exp, 目标: 过期求购单, 悬赏金: 1000, 状态: 待交割}
当期拍卖:
  - {编号: a_done, 拍品: 已落槌黑匣子, 当前最高价: 2000, 状态: 竞价中}
  - {编号: a_exp, 拍品: 流拍过期残骸, 当前最高价: 1000, 状态: 竞价中}
本轮交割:
  - {动作: 竞拍出价, 编号: a_done, 标的: 已落槌黑匣子, 出价: 3000}
  - {动作: 参与竞拍, 编号: a_exp, 标的: 流拍过期残骸, 出价: 1500}
  - {动作: 完成悬赏, 编号: b_exp, 标的: 过期求购单, 资金变动: +1000}
</暗网>`, init);

      expect(res.data.economy.credits).toBe(5000);
      expect(res.data.economy.darknet!.bounties.find(b => b.id === 'b_done')!.status).toBe('completed');
      expect(res.data.economy.darknet!.bounties.find(b => b.id === 'b_exp')!.status).toBe('expired');
      const aDone = res.data.economy.darknet!.auctions.find(a => a.id === 'a_done')!;
      const aExp = res.data.economy.darknet!.auctions.find(a => a.id === 'a_exp')!;
      expect(aDone.status).toBe('sold');
      expect(aDone.current_price).toBe(2000);
      expect(aExp.status).toBe('passed');
      expect(aExp.current_price).toBe(1000);
      expect(res.data.economy.darknet!.ledger).toHaveLength(0);
    });
  });

  describe('6. 多元建筑被动现金流汇总与拍卖倒计时推进', () => {
    it('无矿石精炼厂时，凭回收处理厂 + 抽油机 + 炼油厂 + 矿石精炼器(+25%) 正确计算 channel_daily 并推进拍卖倒计时', () => {
      const state = Schema.parse({
        bases: [
          {
            id: 'base_urban',
            name: '赛博都市潜伏站',
            status: '隐蔽中',
            power: { gen: 200, use: 150 },
            buildings: [
              { name: '发电厂', state: '运转' },
              { name: '超维暗网中继站', state: '运转' },
              { name: '废弃电子产品回收处理厂', state: '运转' }, // +1200 recycling
              { name: '抽油机', state: '运转' }, // +800 petrochemical
              { name: '炼油厂', state: '运转' }, // +1500 petrochemical
              { name: '矿石精炼器', state: '运转' }, // 同基地 +25% 增幅
              { name: '化工合成厂', state: '建造中' }, // 建造中不计入
            ],
          },
        ],
        economy: {
          credits: 3000,
          chains: [
            {
              id: 'chain_01',
              name: '地下芯片走私线',
              flow: '收入',
              rate_daily: 500,
              status: 'active',
              eff: 1,
            },
          ],
          darknet: {
            market_status: '正常连接',
            auction_status: 'closed',
            next_auction_in_minutes: 600,
          },
        },
      });

      const passive = computeBuildingPassiveDailyCredits(state);
      // recycling: 1200 * 1.25 = 1500
      // petrochemical: (800 + 1500) * 1.25 = 2875
      // chains: 500
      // total: 0 + 1500 + 2875 + 500 = 4875
      expect(passive.hasActiveDarknetRelay).toBe(true);
      expect(passive.channelDaily).toEqual({
        refining: 0,
        recycling: 1500,
        petrochemical: 2875,
        chains: 500,
        total: 4875,
      });

      // 通过 settleFloor 推进 720 分钟（12小时）：拍卖倒计时 600 -> 0，自动切换为 bidding
      const settled = settleFloor(
        state,
        state,
        '<timePast>12h</timePast>',
      );
      expect(settled.data.economy.channel_daily).toEqual({
        refining: 0,
        recycling: 1500,
        petrochemical: 2875,
        chains: 500,
        total: 4875,
      });
      // G10-F01：推进 12h（720m）时，chains 结算 +250，建筑被动（1500+2875=4375/日）结算 +2188，总余额 = 3000 + 250 + 2188 = 5438
      expect(settled.data.economy.credits).toBe(5438);
      expect(settled.data.economy.credits_daily).toBe(4875);
      expect(settled.data.economy.darknet?.next_auction_in_minutes).toBe(0);
      expect(settled.data.economy.darknet?.auction_status).toBe('bidding');
    });

    it('G10-F01：仅有基地运转抽油机（无资金链）推进1天真实增加 +800 credits；断电/停工/Δt=0 不产钱；已被资金链 deps.buildings 绑定的建筑不双重计费', () => {
      // 1. 单座运转抽油机、无资金链、余额 1000，推进 1 天 -> 余额 1800，credits_daily 800
      const oilOnly = Schema.parse({
        bases: [
          {
            id: 'base_oil',
            name: '荒原钻采站',
            status: '运转中',
            power: { gen: 100, use: 50 },
            buildings: [{ name: '抽油机', state: '运转' }],
          },
        ],
        economy: { credits: 1000, chains: [] },
      });
      const after1d = settleFloor(oilOnly, oilOnly, '<timePast>1d</timePast>');
      expect(after1d.data.economy.credits).toBe(1800);
      expect(after1d.data.economy.credits_daily).toBe(800);
      expect(after1d.data.economy.channel_daily).toEqual({
        refining: 0,
        recycling: 0,
        petrochemical: 800,
        chains: 0,
        total: 800,
      });

      // 2. Δt = 0、断电（use > gen）或建筑停工时不产生建筑被动收入
      const zeroDt = settleFloor(oilOnly, oilOnly, '<timePast>0m</timePast>');
      expect(zeroDt.data.economy.credits).toBe(1000);

      const unpowered = Schema.parse({
        bases: [
          {
            id: 'base_oil',
            name: '荒原钻采站',
            status: '运转中',
            power: { gen: 20, use: 50 },
            buildings: [{ name: '抽油机', state: '运转' }],
          },
        ],
        economy: { credits: 1000, chains: [] },
      });
      expect(settleFloor(unpowered, unpowered, '<timePast>1d</timePast>').data.economy.credits).toBe(1000);

      // 3. 同一座矿石精炼厂已由 economy.chains 的 deps.buildings 显式绑定，推进 1 天只按该链条结算一次，加上未绑定的抽油机被动收入
      const boundAndPassive = Schema.parse({
        bases: [
          {
            id: 'B1',
            name: '北坡基地',
            status: '运转中',
            power: { gen: 200, use: 80 },
            buildings: [
              { name: '矿石精炼厂', state: '运转' },
              { name: '抽油机', state: '运转' },
            ],
          },
        ],
        economy: {
          credits: 1000,
          chains: [
            {
              id: 'c_refinery',
              name: '北坡精炼线',
              flow: '收入',
              rate_daily: 800,
              status: 'active',
              eff: 1,
              deps: { base_id: 'B1', buildings: ['矿石精炼厂'], world_resource: '' },
            },
          ],
        },
      });
      const settledBound = settleFloor(boundAndPassive, boundAndPassive, '<timePast>1d</timePast>');
      // 1000 + 800(已绑定矿石精炼厂链条) + 800(未绑定抽油机被动) = 2600（绝不额外重复加 5000）
      expect(settledBound.data.economy.credits).toBe(2600);
      expect(settledBound.data.economy.credits_daily).toBe(1600);

      // 4. BUG-LIVE-06：断链（broken/exhausted）或小额走私/黑市支线（rate_daily < 500 或含走私关键词）不吞没矿石精炼厂 +5000/日 主渠道基载
      const smugglingAndBroken = Schema.parse({
        bases: [
          {
            id: 'B1',
            name: '恶土前哨主基地',
            status: '运转中',
            power: { gen: 200, use: 80 },
            buildings: [{ name: '矿石精炼厂', state: '运转' }],
          },
        ],
        economy: {
          credits: 1000,
          chains: [
            {
              id: 'c_smuggle',
              name: '黑市走私支线',
              flow: '收入',
              rate_daily: 300,
              status: 'active',
              eff: 1,
              deps: { base_id: 'B1', buildings: ['矿石精炼厂'], world_resource: '' },
            },
            {
              id: 'c_broken',
              name: '旧矿脉输送线',
              flow: '收入',
              rate_daily: 2000,
              status: 'broken',
              eff: 0,
              deps: { base_id: 'B1', buildings: ['矿石精炼厂'], world_resource: '' },
            },
          ],
        },
      });
      const settledSmuggle = settleFloor(smugglingAndBroken, smugglingAndBroken, '<timePast>1d</timePast>');
      // 1000 + 300(走私支线) + 5000(矿石精炼厂本体基载不被吞没) = 6300
      expect(settledSmuggle.data.economy.credits).toBe(6300);
      expect(settledSmuggle.data.economy.credits_daily).toBe(5300);
    });

    it('BUG-LIVE-09：当期拍卖整表刷新后，对已托管的同 ID 我方送拍品再次执行「上架送拍」改价不二次扣减六柱实物库存', () => {
      const state = Schema.parse({
        economy: {
          credits: 5000,
          resources: {
            materials: { 高纯硅晶圆: 200 },
          },
        },
      });

      // 第 1 次上架送拍：扣减 100 硅晶圆（200 -> 100）
      const block1 = `<暗网>
本轮交割:
  - 动作: 上架送拍
    id: auc_consign_34
    标的: 高纯硅晶圆批次
    起拍价: 2000
    资源映射:
      大类: materials
      小类: 高纯硅晶圆
      数量: 100
</暗网>`;
      applyDarknetBlockToState(extractDarknetBlocks(block1)[0], state, { currentDay: 10 });
      expect(state.economy.resources?.materials?.['高纯硅晶圆']).toBe(100);
      expect(state.economy.darknet?.auctions.find(a => a.id === 'auc_consign_34')?.start_price).toBe(2000);

      // 第 2 次：同块既带「当期拍卖」列表（漏列 auc_consign_34），又在「本轮交割」中对 auc_consign_34 再次上架送拍改价为 1800
      const block2 = `<暗网>
当期拍卖:
  - id: auc_other_1
    拍品: 军用加密芯片
    起拍价: 1500
    当前最高价: 1600
    状态: 竞价中
本轮交割:
  - 动作: 上架送拍
    id: auc_consign_34
    标的: 高纯硅晶圆批次
    起拍价: 1800
    资源映射:
      大类: materials
      小类: 高纯硅晶圆
      数量: 100
</暗网>`;
      applyDarknetBlockToState(extractDarknetBlocks(block2)[0], state, { currentDay: 11 });
      // 实物库存保持 100 绝不二次扣成 0，且拍品恢复在册并更新价格为 1800
      expect(state.economy.resources?.materials?.['高纯硅晶圆']).toBe(100);
      const restored = state.economy.darknet?.auctions.find(a => a.id === 'auc_consign_34');
      expect(restored).toBeDefined();
      expect(restored?.start_price).toBe(1800);
      expect(restored?.current_price).toBe(1800);
    });

    it('BUG-LIVE-20b（#58楼实机复现）：支持 <暗网订单>/<暗网采购>/<黑市订单> 顶层块与列表直采结构，按幂等 ID 扣减 credits、入账高能纳米工料并记入 ledger', () => {
      const base58 = Schema.parse({
        economy: {
          credits: 50000,
          resources: {
            nanites: { 高能纳米工料: 2000 },
          },
        },
      });

      const raw58 = `
<暗网订单>
- id: dn_ord_58
  名称: 荒坂军用级超导磁暴电容整箱直采
  类型: 采购
  金额: 15000
  获得物资:
    高能纳米工料: 5000
  状态: 已交割
</暗网订单>`;

      const res58 = parseMessageText(raw58, base58);
      expect(res58.quarantine).toEqual([]);
      expect(res58.data.economy.credits).toBe(35000);
      expect(res58.data.economy.resources?.nanites['高能纳米工料']).toBe(7000);
      expect(res58.data.economy.nanites?.['高能纳米工料']).toBe(7000);
      expect(res58.data.economy.darknet?.ledger).toHaveLength(1);
      expect(res58.data.economy.darknet?.ledger[0]).toMatchObject({
        id: 'dn_ord_58',
        action: '购买商品',
        target: '荒坂军用级超导磁暴电容整箱直采',
        credits_delta: -15000,
      });

      // 同 ID 重复重放幂等拦截：不重复扣减 15000，也不重复入账 5000 高能纳米工料
      const replay58 = parseMessageText(raw58, res58.data);
      expect(replay58.quarantine).toEqual([]);
      expect(replay58.data.economy.credits).toBe(35000);
      expect(replay58.data.economy.resources?.nanites['高能纳米工料']).toBe(7000);
      expect(replay58.data.economy.darknet?.ledger).toHaveLength(1);
    });

    it('BUG-R2-10：① 主动撤拍与当期拍卖流拍/下架自动退回我方托管库存且防重复退还；② 防低价出价篡改最高价与领先方；③ 防 NPC 抬价误报验资预警；④ 卖方成交归属校验拦截非我方拍品', () => {
      const init = Schema.parse({
        economy: {
          credits: 5000,
          resources: {
            minerals: { 紫幽玄铁: 10 },
            materials: { 高纯硅晶圆: 20 },
          },
        },
      });

      // Step 1：我方上架两件送拍品（auc_my_1 扣 4 单位紫幽玄铁，auc_my_2 扣 8 单位高纯硅晶圆），同时存在一件 NPC 拍品 auc_npc_1
      const step1Raw = `<暗网>
当期拍卖:
  - 编号: auc_npc_1
    拍品: 轨道电磁炮残件
    卖方: 跨维流亡军工署
    起拍价: 6000
    当前最高价: 8000
    领先方: 铁幕残党
    状态: 竞价中
本轮交割:
  - 动作: 上架送拍
    编号: auc_my_1
    标的: 紫幽玄铁锭批次
    起拍价: 3000
    资源扣减: {柱: minerals, 键: 紫幽玄铁, 数量: 4}
  - 动作: 上架送拍
    编号: auc_my_2
    标的: 高纯硅晶圆整箱
    起拍价: 2500
    资源扣减: {柱: materials, 键: 高纯硅晶圆, 数量: 8}
</暗网>`;
      const s1 = parseMessageText(step1Raw, init);
      expect(s1.data.economy.resources?.minerals['紫幽玄铁']).toBe(6);
      expect(s1.data.economy.resources?.materials['高纯硅晶圆']).toBe(12);

      // Step 2：
      // - 对 auc_npc_1 低价出价 6500 (< 8000) 且领先方写“荒原拾荒团” → 仅告警，最高价保持 8000，leader 保持“铁幕残党”
      // - 对 auc_npc_1 由 NPC “星界财团” 抬价至 12000 (> 我方 credits 5000) → 正常更新为 12000 / 星界财团，但绝不触发 [暗网验资预警]
      // - 误对 NPC 拍品 auc_npc_1 发送「拍卖送拍成交」→ 被卖方归属校验拦截，不给玩家加钱
      // - 对我方拍品 auc_my_1 执行「取消送拍」（撤拍别名）→ 退回 4 单位紫幽玄铁（6 -> 10），状态置为 passed，记录流水
      const step2Raw = `<暗网>
本轮交割:
  - 动作: 竞拍出价
    编号: auc_npc_1
    标的: 轨道电磁炮残件
    出价: 6500
    领先方: 荒原拾荒团
  - 动作: 竞拍出价
    编号: auc_npc_1
    标的: 轨道电磁炮残件
    出价: 12000
    领先方: 星界财团
  - 动作: 拍卖送拍成交
    编号: auc_npc_1
    标的: 轨道电磁炮残件
    资金变动: +12000
  - 动作: 取消送拍
    编号: auc_my_1
    标的: 紫幽玄铁锭批次
</暗网>`;
      const s2 = parseMessageText(step2Raw, s1.data);
      const npcAuc = s2.data.economy.darknet!.auctions.find(a => a.id === 'auc_npc_1')!;
      expect(npcAuc.current_price).toBe(12000);
      expect(npcAuc.leader).toBe('星界财团');
      expect(npcAuc.status).toBe('bidding');
      // 玩家余额保持 5000（NPC 拍品误报送拍成交被拦截）
      expect(s2.data.economy.credits).toBe(5000);
      expect(
        s2.events.some(e => e.light === '🟡' && e.message.includes('非我方指挥部') && e.message.includes('禁止按我方送拍成交收款')),
      ).toBe(true);
      // NPC 抬价至 12000 不触发 [暗网验资预警]
      expect(s2.events.some(e => e.message.includes('[暗网验资预警]'))).toBe(false);
      // 我方撤拍 auc_my_1 退回 4 单位紫幽玄铁（6 + 4 = 10），重复撤拍拦截
      expect(s2.data.economy.resources?.minerals['紫幽玄铁']).toBe(10);
      expect(s2.data.economy.darknet!.auctions.find(a => a.id === 'auc_my_1')?.status).toBe('cancelled');
      expect(s2.data.economy.darknet!.ledger.some(l => l.action === '撤拍' && l.target === '紫幽玄铁锭批次')).toBe(true);

      // Step 3：
      // - 当期拍卖列表中 auc_my_2 状态变为「流拍」（或「已下架」），自动退回 8 单位高纯硅晶圆（12 + 8 = 20）
      // - 再次对 auc_my_1 重复撤拍被幂等拦截，紫幽玄铁不会二次退成 14
      const step3Raw = `<暗网>
当期拍卖:
  - 编号: auc_my_2
    拍品: 高纯硅晶圆整箱
    卖方: 我方指挥部
    起拍价: 2500
    当前最高价: 2500
    状态: 流拍
本轮交割:
  - 动作: 撤拍
    编号: auc_my_1
    标的: 紫幽玄铁锭批次
</暗网>`;
      const s3 = parseMessageText(step3Raw, s2.data);
      expect(s3.data.economy.resources?.materials['高纯硅晶圆']).toBe(20);
      expect(s3.data.economy.resources?.minerals['紫幽玄铁']).toBe(10);
      expect(s3.data.economy.darknet!.auctions.find(a => a.id === 'auc_my_2')?.status).toBe('passed');

      // Step 4：下一楼当期拍卖继续展示 auc_my_2 为流拍，不会重复退还高纯硅晶圆
      const s4 = parseMessageText(step3Raw, s3.data);
      expect(s4.data.economy.resources?.materials['高纯硅晶圆']).toBe(20);
    });

    it('BUG-R2-22 & BUG-R2-23（#48~#50楼实机复现）：① IncomeChain.eff=1.2 基线通过 Schema 校验；② <暗网> 行情/悬赏/拍卖顶层与子项中文同义键映射；③ 我方寄售拍品自动实扣库存及后续送拍成交/外部竞得入库/流拍撤拍退回双路径闭环', () => {
      // #48 楼基线：含 eff: 1.2 的超负荷资金链，以及特种合金 500、电子元件 500
      const baseline48 = {
        economy: {
          credits: 10000,
          chains: [
            {
              id: 'chain_红峰高品位赤铁伴生矿脉',
              name: '红峰高品位赤铁伴生矿脉',
              flow: '收入',
              rate_daily: 5000,
              status: 'active',
              eff: 1.2,
              deps: { base_id: 'B1', buildings: ['矿石精炼厂'], world_resource: '' },
              capacity: { total_yield: null, extracted: 0 },
              reason: '技术升级超负荷运转',
              updated_at_day: 5,
            },
          ],
          resources: {
            materials: {
              特种合金: 500,
              电子元件: 500,
            },
          },
        },
      };

      // #50 楼实机报文
      const floor50Raw = `<暗网>
行情:
  - 编号: MK-01
    名称: 高纯度钛合金装甲板
    类别: 工业材料
    价格: 1200
    库存: 5
    卖家: 自由港黑市商团
    描述: 军用级复合装甲板材
悬赏:
  - 编号: BTY-01
    标题: 清剿恶土荒坂残党巡逻队
    委托方: 恶土游牧民同盟
    报酬: 4000
    状态: 可接取
    难度: 中
    详情: 歼灭红峰南麓的荒坂外围巡逻小队并缴获其通讯密匙
拍卖:
  - 编号: LOT-C01
    名称: 高纯度特种合金批次
    类别: 工业材料
    卖家: 我方
    起拍价: 3000
    当前价: 3000
    一口价: 6000
    状态: 竞拍中
    剩余轮次: 3
    领先者: 暂无
    资源映射:
      工业材料:
        特种合金: 200
  - 编号: LOT-C02
    名称: 军规抗辐射电子元件批次
    类别: 工业材料
    卖家: 我方
    起拍价: 2500
    当前价: 2500
    一口价: 5000
    状态: 竞拍中
    剩余轮次: 3
    领先者: 暂无
    资源映射:
      工业材料:
        电子元件: 150
  - 编号: LOT-B01
    名称: 旧时代军用级量子协处理器
    类别: 装备
    卖家: 夜之城地下极客公社
    起拍价: 4000
    当前价: 4000
    一口价: 8000
    状态: 竞拍中
    剩余轮次: 3
    领先者: 夜之城数据掮客
</暗网>`;

      const res50 = parseMessageText(floor50Raw, baseline48);
      expect(res50.quarantine).toEqual([]);
      expect(res50.data.economy.chains[0].eff).toBe(1.2);

      const dn50 = res50.data.economy.darknet!;
      expect(dn50.auction_status).toBe('bidding');
      expect(dn50.items).toHaveLength(1);
      expect(dn50.items[0]).toMatchObject({
        id: 'MK-01',
        name: '高纯度钛合金装甲板',
        category: '工业材料',
        price: 1200,
        stock: 5,
        seller: '自由港黑市商团',
        desc: '军用级复合装甲板材',
      });

      expect(dn50.bounties).toHaveLength(1);
      expect(dn50.bounties[0]).toMatchObject({
        id: 'BTY-01',
        target: '清剿恶土荒坂残党巡逻队',
        client: '恶土游牧民同盟',
        reward_credits: 4000,
        status: 'open',
        difficulty: '中',
        desc: '歼灭红峰南麓的荒坂外围巡逻小队并缴获其通讯密匙',
      });

      expect(dn50.auctions).toHaveLength(3);
      const lotC01 = dn50.auctions.find(a => a.id === 'LOT-C01')!;
      const lotC02 = dn50.auctions.find(a => a.id === 'LOT-C02')!;
      const lotB01 = dn50.auctions.find(a => a.id === 'LOT-B01')!;
      expect(lotC01).toMatchObject({
        id: 'LOT-C01',
        name: '高纯度特种合金批次',
        category: '工业材料',
        seller: '我方',
        start_price: 3000,
        current_price: 3000,
        buyout_price: 6000,
        status: 'bidding',
        rounds_left: 3,
        leader: '',
        consign_deducted: true,
        resource_map: { pillar: 'materials', key: '特种合金', qty: 200 },
      });
      expect(lotC02.consign_deducted).toBe(true);
      expect(lotB01.category).toBe('装备');

      // 我方寄售库存已在 #50 楼实扣：特种合金 500 -> 300，电子元件 500 -> 350
      expect(res50.data.economy.resources?.materials['特种合金']).toBe(300);
      expect(res50.data.economy.resources?.materials['电子元件']).toBe(350);

      // #51 楼：通过 <暗网> 交割 + 拍卖列表双路径推进：
      // - LOT-C01 送拍成交（+4500 Credits）
      // - LOT-C02 在拍卖列表中更新为 状态: 撤拍（自动退回电子元件 150：350 -> 500）
      // - LOT-B01 我方竞得落槌（-5200 Credits，无 resource_map 按类别“装备”入库 forces.equipment['旧时代军用级量子协处理器'] = 1）
      const floor51Raw = `<暗网>
拍卖:
  - 编号: LOT-C02
    状态: 撤拍
交割:
  - 动作: 送拍成交
    编号: LOT-C01
    成交价: 4500
  - 动作: 竞得落槌
    编号: LOT-B01
    成交价: 5200
</暗网>`;

      const res51 = parseMessageText(floor51Raw, res50.data);
      expect(res51.quarantine).toEqual([]);
      // 资金：10000 + 4500 (LOT-C01 送拍成交) - 5200 (LOT-B01 竞得落槌) = 9300
      expect(res51.data.economy.credits).toBe(9300);
      // 库存：LOT-C01 已成交保持 300，LOT-C02 撤拍退回 150 恢复为 500
      expect(res51.data.economy.resources?.materials['特种合金']).toBe(300);
      expect(res51.data.economy.resources?.materials['电子元件']).toBe(500);
      // 装备入库：旧时代军用级量子协处理器 +1
      expect(res51.data.forces.equipment['旧时代军用级量子协处理器']).toBe(1);
      expect(res51.data.economy.darknet!.auctions.find(a => a.id === 'LOT-C01')?.status).toBe('sold');
      expect(res51.data.economy.darknet!.auctions.find(a => a.id === 'LOT-C02')?.status).toBe('cancelled');
      expect(res51.data.economy.darknet!.auctions.find(a => a.id === 'LOT-B01')?.status).toBe('sold');

      // BUG-R2-24(2)：#52 & #58 楼：
      // 1) 竞拍出价支持 出价者 字段识别（不误设为 我方指挥部）
      // 2) 交割支持 悬赏交割 -> 完成悬赏、变现 -> 售出实物（直接按 名称+数量 从六柱查找同名资源扣减并入账金额）、售出情报 -> 售出信息
      const baseline52 = Schema.parse({
        ...res50.data,
        economy: {
          ...res50.data.economy,
          credits: 10000,
          resources: {
            ...res50.data.economy.resources,
            minerals: { 铁矿: 500 },
          },
        },
      });

      const floor52And58Raw = `<暗网>
交割:
  - 动作: 竞拍出价
    编号: LOT-C01
    出价: 4500
    出价者: 自由港军火商
  - 动作: 悬赏交割
    编号: BTY-01
    金额: 4000
  - 动作: 变现
    名称: 铁矿
    数量: 200
    金额: 1600
  - 动作: 售出情报
    名称: 荒坂南麓巡逻队密匙样本
    金额: 1200
</暗网>`;

      const res58 = parseMessageText(floor52And58Raw, baseline52);
      expect(res58.quarantine).toEqual([]);

      const dn58 = res58.data.economy.darknet!;
      // LOT-C01 的 leader 必须为“自由港军火商”而非“我方指挥部”
      const lotC01AfterBid = dn58.auctions.find(a => a.id === 'LOT-C01')!;
      expect(lotC01AfterBid.current_price).toBe(4500);
      expect(lotC01AfterBid.leader).toBe('自由港军火商');

      // BTY-01 悬赏交割完成（+4000 Credits）
      const bty01After = dn58.bounties.find(b => b.id === 'BTY-01')!;
      expect(bty01After.status).toBe('completed');

      // 变现：铁矿自动从 minerals.铁矿 扣减 200（500 -> 300），入账 +1600 Credits
      expect(res58.data.economy.resources?.minerals['铁矿']).toBe(300);

      // 售出情报：入账 +1200 Credits 且写入 sold_intel_ids
      expect(dn58.sold_intel_ids.length).toBeGreaterThanOrEqual(1);

      // 总资金：10000 + 4000 (悬赏交割) + 1600 (变现) + 1200 (售出情报) = 16800
      expect(res58.data.economy.credits).toBe(16800);
    });
  });
});

