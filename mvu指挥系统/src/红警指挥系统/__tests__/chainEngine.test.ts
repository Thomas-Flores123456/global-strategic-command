import { describe, it, expect } from 'vitest';
import {
  calcDailyNet,
  calcChainMultiTrackDailySummary,
  settleChainsDeltaT,
  applyChainTransition,
  applyChainEvent,
} from '../engines/chainEngine';
import { settleFloor } from '../engines/settleFloor';
import { Schema, type IncomeChain } from '../core/schema';
import { settleQuestRewards } from '../parse/parseDomainAppliers';
import { newCtx } from '../parse/parseTypesAndCanon';

function makeChain(partial: Partial<IncomeChain> & { id: string }): IncomeChain {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    flow: partial.flow ?? '收入',
    rate_daily: partial.rate_daily ?? 600,
    ...(partial.chain_kind !== undefined ? { chain_kind: partial.chain_kind } : {}),
    ...(partial.wallet_daily !== undefined ? { wallet_daily: partial.wallet_daily } : {}),
    ...(partial.resources_daily !== undefined ? { resources_daily: partial.resources_daily } : {}),
    status: partial.status ?? 'active',
    eff: partial.eff ?? 1,
    deps: partial.deps ?? { base_id: 'b1', buildings: [], world_resource: '' },
    capacity: partial.capacity ?? { total_yield: null, extracted: 0 },
    reason: partial.reason ?? '',
    updated_at_day: partial.updated_at_day ?? 0,
  };
}

describe('chainEngine 纯函数资金链状态机与时钟推进计算器', () => {
  describe('calcDailyNet 标称日均净收益计算', () => {
    it('空链条返回 0', () => {
      expect(calcDailyNet([])).toBe(0);
    });

    it('多链条按流向与效率加权汇总', () => {
      const chains: IncomeChain[] = [
        makeChain({ id: 'c1', rate_daily: 600, eff: 1, flow: '收入' }), // +600
        makeChain({ id: 'c2', rate_daily: 400, eff: 0.5, flow: '收入', status: 'distressed' }), // +200
        makeChain({ id: 'c3', rate_daily: 300, eff: 1, flow: '支出' }), // -300
        makeChain({ id: 'c4', rate_daily: 500, eff: 0, flow: '收入', status: 'broken' }), // 0 (断裂不计)
        makeChain({ id: 'c5', rate_daily: 1000, eff: 0, flow: '收入', status: 'exhausted' }), // 0 (枯竭不计)
      ];

      expect(calcDailyNet(chains)).toBe(500); // 600 + 200 - 300 = 500
    });
  });

  describe('settleChainsDeltaT 游戏时钟 Δt 积分推进', () => {
    it('deltaMinutes <= 0 时不推进也不报错', () => {
      const chains = [makeChain({ id: 'c1', rate_daily: 600 })];
      const res = settleChainsDeltaT(chains, 0);
      expect(res.deltaCredits).toBe(0);
      expect(res.nextChains).toHaveLength(1);
    });

    it('推进 1440 分钟（整 1 天），日额度 600 精确结算 600 credits', () => {
      const chains = [
        makeChain({ id: 'c1', rate_daily: 600, flow: '收入', eff: 1 }),
        makeChain({ id: 'c2', rate_daily: 200, flow: '支出', eff: 1 }),
      ];

      const res = settleChainsDeltaT(chains, 1440, 1);
      expect(res.deltaCredits).toBe(400); // 600 - 200
      expect(res.exhaustedEvents).toHaveLength(0);
    });

    it('推进 720 分钟（半天），收益按比例折半', () => {
      const chains = [makeChain({ id: 'c1', rate_daily: 600, eff: 1 })];
      const res = settleChainsDeltaT(chains, 720);
      expect(res.deltaCredits).toBe(300);
      expect(res.nextChains[0].capacity.extracted).toBe(300);
    });

    it('枯竭守卫：达到储量上限时自动截断、转入 exhausted 并派发枯竭事件', () => {
      const chains = [
        makeChain({
          id: 'ore_vein_1',
          name: '高纯度泰伯利亚矿脉',
          rate_daily: 1000,
          eff: 1,
          capacity: { total_yield: 1200, extracted: 800 }, // 剩余 400
        }),
      ];

      // 推进 1440 分钟（正常产出 1000，但剩余仅 400）
      const res = settleChainsDeltaT(chains, 1440, 5);

      expect(res.deltaCredits).toBe(400); // 截断至剩余 400
      expect(res.exhaustedEvents).toEqual([{ id: 'ore_vein_1', name: '高纯度泰伯利亚矿脉' }]);

      const updated = res.nextChains[0];
      expect(updated.status).toBe('exhausted');
      expect(updated.eff).toBe(0);
      expect(updated.capacity.extracted).toBe(1200);
      expect(updated.updated_at_day).toBe(5);
      expect(updated.reason).toContain('枯竭');
    });

    it('纯函数不修改输入原数组对象（Immutability）', () => {
      const original = [makeChain({ id: 'c1', rate_daily: 600, capacity: { total_yield: null, extracted: 0 } })];
      const deepClone = JSON.parse(JSON.stringify(original));

      settleChainsDeltaT(original, 720);

      expect(original).toEqual(deepClone);
    });
  });

  describe('applyChainTransition 五态跃迁纯函数', () => {
    it('正常状态转移并自动调整 eff 默认值', () => {
      const chain = makeChain({ id: 'c1', status: 'active', eff: 1 });

      const distressed = applyChainTransition(chain, 'distressed', { reason: '遇袭' });
      expect(distressed.status).toBe('distressed');
      expect(distressed.reason).toBe('遇袭');

      const broken = applyChainTransition(distressed, 'broken', { reason: '主管道炸毁' });
      expect(broken.status).toBe('broken');
      expect(broken.eff).toBe(0);
      expect(broken.reason).toBe('主管道炸毁');

      const restored = applyChainTransition(broken, 'active', { reason: '修好' });
      expect(restored.status).toBe('active');
      expect(restored.eff).toBe(1);
    });

    it('枯竭状态为不可逆终态，拒绝普通状态跃迁', () => {
      const exhausted = makeChain({ id: 'c1', status: 'exhausted', eff: 0 });
      const attempt = applyChainTransition(exhausted, 'active', { reason: '尝试重启' });

      expect(attempt.status).toBe('exhausted');
      expect(attempt.eff).toBe(0);
    });
  });

  describe('applyChainEvent 业务事件应用', () => {
    it('支持建立新链条并正确合并', () => {
      const chains: IncomeChain[] = [];
      const next = applyChainEvent(chains, {
        action: '建立',
        id: 'new_trade',
        name: '荒原商贸线',
        rate_daily: 450,
      });

      expect(next).toHaveLength(1);
      expect(next[0].id).toBe('new_trade');
      expect(next[0].status).toBe('active');
      expect(next[0].rate_daily).toBe(450);
    });

    it('支持断裂事件将链条置为 broken', () => {
      const chains = [makeChain({ id: 'trade_1', status: 'active' })];
      const next = applyChainEvent(chains, {
        action: '断裂',
        id: 'trade_1',
        reason: '商队遭伏击全灭',
      });

      expect(next[0].status).toBe('broken');
      expect(next[0].eff).toBe(0);
      expect(next[0].reason).toBe('商队遭伏击全灭');
    });

    it('FIX-P1-04 (09 [P1-4])：同名资金链已处于 exhausted 终态时，忽略重复「建立」覆盖', () => {
      const chains = [
        makeChain({
          id: 'chain_ore',
          name: '枯竭矿脉',
          rate_daily: 800,
          status: 'exhausted',
          eff: 0,
          capacity: { total_yield: 1000, extracted: 1000 },
          reason: '资源储量已采空枯竭',
        }),
      ];
      const next = applyChainEvent(
        chains,
        {
          action: '建立',
          id: 'chain_ore',
          name: '枯竭矿脉',
          rate_daily: 900,
          reason: '试图重复建立',
        },
        10,
      );
      expect(next[0].status).toBe('exhausted');
      expect(next[0].eff).toBe(0);
      expect(next[0].rate_daily).toBe(800);
      expect(next[0].capacity.extracted).toBe(1000);
    });

    it('FIX-P1-04 (09 [P1-4])：同名非枯竭资金链收到「建立」时，合并更新属性并保留已有 capacity.extracted', () => {
      const chains = [
        makeChain({
          id: 'chain_trade',
          name: '荒原商贸线',
          rate_daily: 400,
          status: 'distressed',
          eff: 0.5,
          capacity: { total_yield: 2000, extracted: 650 },
          deps: { base_id: 'b1', buildings: ['贸易站'], world_resource: '' },
        }),
      ];
      const next = applyChainEvent(
        chains,
        {
          action: '建立',
          id: 'chain_trade',
          name: '荒原商贸线',
          rate_daily: 600,
          reason: '扩建商路重签协议',
        },
        8,
      );
      expect(next[0].status).toBe('active');
      expect(next[0].eff).toBe(1);
      expect(next[0].rate_daily).toBe(600);
      expect(next[0].capacity.extracted).toBe(650);
      expect(next[0].capacity.total_yield).toBe(2000);
      expect(next[0].deps.base_id).toBe('b1');
    });

    it('BUG-R2-09：applyChainEvent 支持受挫与恢复携带可选 eff（0~2），未传时默认受挫 0.5、恢复 1', () => {
      const chains = [
        makeChain({
          id: 'chain_oil',
          name: '北疆输油管线',
          rate_daily: 1000,
          status: 'active',
          eff: 1,
        }),
      ];

      // 受挫携带显式 eff = 0.25
      const distressedCustom = applyChainEvent(
        chains,
        { action: '受挫', id: 'chain_oil', eff: 0.25, reason: '加压站轻微破损' },
        5,
      );
      expect(distressedCustom[0].status).toBe('distressed');
      expect(distressedCustom[0].eff).toBe(0.25);

      // 恢复携带显式 eff = 1.25（超额抢修扩能，允许 0~2）
      const recoveredCustom = applyChainEvent(
        distressedCustom,
        { action: '恢复', id: 'chain_oil', eff: 1.25, reason: '双泵并联恢复并扩能' },
        6,
      );
      expect(recoveredCustom[0].status).toBe('active');
      expect(recoveredCustom[0].eff).toBe(1.25);

      // 未携带 eff 时回退默认值（受挫 0.5，恢复 1）
      const distressedDefault = applyChainEvent(
        recoveredCustom,
        { action: '受挫', id: 'chain_oil', reason: '遭遇袭扰' },
        7,
      );
      expect(distressedDefault[0].eff).toBe(0.5);
      const recoveredDefault = applyChainEvent(
        distressedDefault,
        { action: '恢复', id: 'chain_oil', reason: '排除干扰' },
        8,
      );
      expect(recoveredDefault[0].eff).toBe(1);
    });
  });

  describe('FD-51 PKG-A · 多轨物资与外币链网积分及欠料停机守卫', () => {
    it('1. 本土外币商路（rate_daily: 0, wallet_daily: { 欧元: 1200 }）与易货商路（wallet_daily: { 欧元: -400 }, resources_daily: { minerals: { 铁矿石: 200 } }）按 Δt 准确结算 deltaWallet 与 deltaResources', () => {
      const chains: IncomeChain[] = [
        makeChain({
          id: 'trade_euro',
          name: '边境黑市外币商路',
          chain_kind: '本土商路',
          rate_daily: 0,
          wallet_daily: { 欧元: 1200 },
          deps: { base_id: 'b1', buildings: [], faction: '铁道幸存者同盟', world_resource: '' },
        }),
        makeChain({
          id: 'trade_barter',
          name: '铁道同盟原矿易货商路',
          chain_kind: '本土商路',
          rate_daily: 0,
          wallet_daily: { 欧元: -400 },
          resources_daily: { 矿产: { 铁矿石: 200 } },
          deps: { base_id: 'b1', buildings: [], faction: '铁道幸存者同盟', world_resource: '' },
        }),
      ];

      // 推进 720 分钟（半天）：欧元净入 (1200 - 400) * 0.5 = +400，铁矿石净入 200 * 0.5 = +100，Credits = 0
      const res = settleChainsDeltaT(chains, 720, 2, {
        wallet: { 欧元: 500 },
        resources: { minerals: { 铁矿石: null } },
      });

      expect(res.deltaCredits).toBe(0);
      expect(res.deltaWallet).toEqual({ 欧元: 400 });
      expect(res.deltaResources).toEqual({
        minerals: { 铁矿石: 100 },
      });
      expect(res.nextChains[0].status).toBe('active');
      expect(res.nextChains[1].status).toBe('active');

      // 验证 calcChainMultiTrackDailySummary 三轨汇总（含中文六柱键归一）
      const summary = calcChainMultiTrackDailySummary(chains);
      expect(summary).toEqual({
        dailyNetCredits: 0,
        walletDailyNet: { 欧元: 800 },
        resourcesDailyNet: { minerals: { 铁矿石: 200 } },
      });
    });

    it('2. 工业熔炼转化链（resources_daily: { minerals: { 铁矿石: -200 } }, rate_daily: 800）：库存充足正常扣矿产 Credits，库存不足为 0 时自动转为 distressed(eff=0) 且 deltaCredits === 0', () => {
      const smeltChain = makeChain({
        id: 'smelt_iron',
        name: '高炉铁矿精炼转化线',
        chain_kind: '工业转化',
        rate_daily: 800,
        resources_daily: { minerals: { 铁矿石: -200 } },
        deps: { base_id: 'b1', buildings: ['矿石精炼厂'], world_resource: '' },
      });

      // ① 仓库铁矿石充足（300 >= 200）：推进 1440 分钟（1整天），正常扣减铁矿石 -200 并产出 +800 Credits
      const okRes = settleChainsDeltaT([smeltChain], 1440, 3, {
        wallet: {},
        resources: { minerals: { 铁矿石: 300 } },
      });
      expect(okRes.deltaCredits).toBe(800);
      expect(okRes.deltaResources).toEqual({
        minerals: { 铁矿石: -200 },
      });
      expect(okRes.nextChains[0].status).toBe('active');
      expect(okRes.nextChains[0].eff).toBe(1);

      // ② 仓库铁矿石为 0（不足）：推进 1440 分钟，自动转为 distressed (eff=0, reason 含 上游原料/外币不足暂停) 且当轮 deltaCredits === 0
      const emptyRes = settleChainsDeltaT([smeltChain], 1440, 4, {
        wallet: {},
        resources: { minerals: { 铁矿石: 0 } },
      });
      expect(emptyRes.deltaCredits).toBe(0);
      expect(emptyRes.deltaResources).toEqual({});
      expect(emptyRes.nextChains[0].status).toBe('distressed');
      expect(emptyRes.nextChains[0].eff).toBe(0);
      expect(emptyRes.nextChains[0].reason).toContain('上游原料/外币不足暂停');
    });

    it('G6-01 欠料暂停链在库存补足后按原 eff 自动复工，库存仍不足则保持暂停', () => {
      const smelt = makeChain({
        id: 'smelt_boost',
        rate_daily: 800,
        eff: 1.5,
        reason: '参谋调度',
        resources_daily: { minerals: { 铁矿石: -200 } },
      });
      const paused = settleChainsDeltaT([smelt], 1440, 4, { resources: { minerals: { 铁矿石: 0 } } })
        .nextChains[0];
      expect(paused.eff).toBe(0);
      expect(paused.status).toBe('distressed');

      const still = settleChainsDeltaT([paused], 1440, 5, { resources: { minerals: { 铁矿石: 100 } } });
      expect(still.nextChains[0].eff).toBe(0);
      expect(still.deltaCredits).toBe(0);

      const resumed = settleChainsDeltaT([paused], 1440, 6, { resources: { minerals: { 铁矿石: 500 } } });
      expect(resumed.nextChains[0].status).toBe('active');
      expect(resumed.nextChains[0].eff).toBe(1.5);
      expect(resumed.nextChains[0].reason).toBe('参谋调度');
      expect(resumed.deltaCredits).toBe(1200);
      expect(resumed.deltaResources).toEqual({ minerals: { 铁矿石: -300 } });
    });

    it('3. settleFloor 集成：三轨收支落盘解锁 null 小类资源，且欠料停机状态持久保留', () => {
      const state = Schema.parse({
        bases: [
          {
            id: 'b1',
            name: '前沿第一基地',
            status: '运转中',
            power: { gen: 200, use: 50 },
            buildings: [{ name: '矿石精炼厂', state: '运转' }],
          },
        ],
        economy: {
          credits: 1000,
          wallet: { 欧元: 100 },
          resources: {
            minerals: { 铁矿石: null },
          },
          chains: [
            {
              id: 'trade_barter',
              name: '边境原矿采购线',
              chain_kind: '本土商路',
              rate_daily: 0,
              wallet_daily: { 欧元: -100 },
              resources_daily: { minerals: { 铁矿石: 150 } },
            },
            {
              id: 'smelt_empty',
              name: '稀土精炼线',
              chain_kind: '工业转化',
              rate_daily: 1000,
              resources_daily: { minerals: { 稀土矿: -100 } },
            },
          ],
        },
      });

      const settled = settleFloor(state, state, '<timePast>1 D</timePast>');
      // 边境原矿采购线：欧元 100 - 100 = 0，铁矿石从 null 解锁为 150
      expect(settled.data.economy.wallet['欧元']).toBe(0);
      expect(settled.data.economy.resources?.minerals['铁矿石']).toBe(150);
      // 稀土精炼线：因稀土矿为 null (0 < 100)，触发欠料停机，不产出链条 Credits，且 eff 持久为 0
      const pausedChain = settled.data.economy.chains.find(c => c.id === 'smelt_empty');
      expect(pausedChain?.status).toBe('distressed');
      expect(pausedChain?.eff).toBe(0);
      expect(pausedChain?.reason).toContain('上游原料/外币不足暂停');
    });

    it('G6-09 任务奖励命中已枟竭链：未声明容量不复活；声明容量则扩容复活', () => {
      const mk = () =>
        Schema.parse({
          economy: {
            chains: [
              { id: 'mine', name: '青岚矿脉', rate_daily: 300, status: 'exhausted', eff: 0, capacity: { total_yield: 900, extracted: 900 } },
            ],
          },
        });
      const locked = mk();
      settleQuestRewards('复勘', { chains: [{ name: '青岚矿脉', rate_daily: 500 }] } as never, locked, newCtx());
      expect(locked.economy.chains[0]).toMatchObject({ status: 'exhausted', eff: 0, rate_daily: 300 });

      const expanded = mk();
      settleQuestRewards('复勘', { chains: [{ name: '青岚矿脉', rate_daily: 500, capacity: 3000 }] } as never, expanded, newCtx());
      expect(expanded.economy.chains[0]).toMatchObject({ status: 'active', eff: 1, rate_daily: 500 });
      expect(expanded.economy.chains[0].capacity.total_yield).toBe(3900);
    });

    it('G6-03 settleFloor 向电网约束传入势力与载具：贸易势力敌对 / 依赖载具缺席时链条挂起且不产出', () => {
      const state = Schema.parse({
        bases: [{ id: 'b1', name: '前沿第一基地', status: '运转中', power: { gen: 200, use: 50 } }],
        factions: [{ name: '铁道幸存者同盟', attitude: '敌意' }],
        forces: { vehicles: ['多功能步兵战车'] },
        economy: {
          credits: 1000,
          chains: [
            { id: 'trade', name: '铁道互市', rate_daily: 500, deps: { base_id: 'b1', faction: '铁道幸存者同盟' } },
            { id: 'haul', name: '矿场转运', rate_daily: 300, deps: { base_id: 'b1', vehicles: ['重型运输车'] } },
          ],
        },
      });
      const settled = settleFloor(state, state, '<timePast>1 D</timePast>');
      const trade = settled.data.economy.chains.find(c => c.id === 'trade');
      const haul = settled.data.economy.chains.find(c => c.id === 'haul');
      expect(trade).toMatchObject({ status: 'distressed', eff: 0 });
      expect(trade?.reason).toContain('贸易势力敌对断交');
      expect(haul).toMatchObject({ status: 'distressed', eff: 0 });
      expect(haul?.reason).toContain('依赖载具未就位');
      expect(settled.data.economy.credits).toBe(1000);
    });
  });
});

