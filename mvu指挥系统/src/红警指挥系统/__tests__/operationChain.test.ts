/**
 * EVT-OPR-01 · operationEngine 工况硬联动 —— 专项单测
 * 真源：《事件系统与资金链状态机总设计案》§6.3（CTRL-EVENT-01）＋Q7 /《MVP 任务包》§3.4·§6
 * 覆盖任务验收三条：
 * 1. 基地电力赤字断供 → 依赖链条 eff 强制 0、状态 distressed、工况 reason 留痕；
 * 2. 电网恢复 → 工况钳制链自动复原标称效率（eff=1、active）；
 * 3. 断电期间无论时间如何快进（settleChainsDeltaT/calcDailyNet 双证），收益恒 0。
 * 外加：无基地依赖链不受钳制、非计息链零改写、叙事受挫链防误复原、
 *       天候衰减视图幂等零持久化、纯函数不可变性与确定性。
 */
import { describe, expect, it } from 'vitest';
import { calcDailyNet, settleChainsDeltaT } from '../engines/chainEngine';
import { IncomeChain } from '../core/schema';
import type { IncomeChain as IncomeChainT } from '../core/schema';
import {
  applyGridConstraints,
  gridStatusOf,
  GRID_OUTAGE_MARKER,
  GRID_RESTORE_NOTE,
  weatherDecayOf,
  withWeatherView,
  type BasePowerView,
} from '../engines/operationEngine';
import { extractEvents } from '../parse/parseEventsAndPatches';
import { parseMessageText } from '../parse/parsePipeline';

/* ═══════════════ 工具 ═══════════════ */

function mkChain(over: Partial<IncomeChainT> & Pick<IncomeChainT, 'id' | 'name'>): IncomeChainT {
  return IncomeChain.parse({ rate_daily: 0, ...over });
}

const mkBase = (id: string, gen: number, use: number): BasePowerView => ({ id, power: { gen, use } });

/** 完整 deps 字面量（IncomeChain 输出型 base_id/buildings/world_resource 三键必填） */
const deps = (base_id: string, buildings: string[] = []): IncomeChainT['deps'] => ({
  base_id,
  buildings,
  world_resource: '',
});

/** 深度冻结（不可变性断言用） */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const corridor = () =>
  mkChain({
    id: 'chain_corridor',
    name: '灵石走私走廊',
    rate_daily: 600,
    status: 'active',
    deps: deps('b1', ['隐蔽仓库']),
  });

/* ═══════════════ 验收①：电网赤字判定与断供钳制 ═══════════════ */

describe('EVT-OPR-01 · 电网工况判定 gridStatusOf', () => {
  it('净余=发电-耗电：盈余不断供、赤字断供、平衡不断供（§6.3 派生判定）', () => {
    expect(gridStatusOf(mkBase('b1', 100, 40))).toEqual({ outage: false, net: 60 });
    expect(gridStatusOf(mkBase('b1', 40, 100))).toEqual({ outage: true, net: -60 });
    expect(gridStatusOf(mkBase('b1', 80, 80))).toEqual({ outage: false, net: 0 });
  });

  it('非法数字容错按 0 处理（防御：不炸整组结算）', () => {
    expect(gridStatusOf({ id: 'b1', power: { gen: Number.NaN, use: 10 } })).toEqual({ outage: true, net: -10 });
  });
});

describe('EVT-OPR-01 · 验收①：断供钳制 eff→0 + distressed + 工况留痕', () => {
  it('依赖赤字基地的计息链：eff 强制 0、状态 distressed、reason 含工况说明、事件留痕', () => {
    const r = applyGridConstraints({ chains: [corridor()], bases: [mkBase('b1', 40, 100)], nowDay: 7 });
    expect(r.chains[0].eff).toBe(0);
    expect(r.chains[0].status).toBe('distressed');
    expect(r.chains[0].reason).toContain(GRID_OUTAGE_MARKER);
    expect(r.chains[0].reason).toContain('设施停机停产');
    expect(r.chains[0].updated_at_day).toBe(7);
    expect(r.events).toEqual([expect.objectContaining({ id: 'chain_corridor', kind: 'grid_outage' })]);
  });

  it('无基地依赖（deps.base_id 空）与依托正常基地的链条：原样引用不受钳制', () => {
    const free = mkChain({ id: 'c2', name: '无根合约', rate_daily: 300, status: 'active' });
    const otherBase = mkChain({
      id: 'c3',
      name: '北坡矿线',
      rate_daily: 400,
      status: 'active',
      deps: deps('b2'),
    });
    const r = applyGridConstraints({ chains: [free, otherBase], bases: [mkBase('b1', 0, 100), mkBase('b2', 100, 0)] });
    expect(r.chains[0]).toBe(free);
    expect(r.chains[1]).toBe(otherBase);
    expect(r.events).toEqual([]);
  });

  it('非计息链（establishing/broken/exhausted）在断供基地：零改写原样引用（收益本就恒 0）', () => {
    const building = mkChain({ id: 'c1', name: '铺设中', rate_daily: 500, status: 'establishing', deps: deps('b1') });
    const broken = mkChain({ id: 'c2', name: '断裂线', rate_daily: 700, status: 'broken', deps: deps('b1') });
    const r = applyGridConstraints({ chains: [building, broken], bases: [mkBase('b1', 0, 10)] });
    expect(r.chains[0]).toBe(building);
    expect(r.chains[1]).toBe(broken);
    expect(r.events).toEqual([]);
  });

  it('幂等重放：对已钳制产物再跑一次 → 零事件、逐元素同引用', () => {
    const day1 = applyGridConstraints({ chains: [corridor()], bases: [mkBase('b1', 0, 100)] });
    const day2 = applyGridConstraints({ chains: day1.chains, bases: [mkBase('b1', 0, 100)] });
    expect(day2.events).toEqual([]);
    expect(day2.chains[0]).toBe(day1.chains[0]);
  });
});

/* ═══════════════ 验收③：断电期间收益恒 0（时钟快进双证） ═══════════════ */

describe('EVT-OPR-01 · 验收③：断电期间无论时间如何快进，收益恒 0', () => {
  it('钳制后任意 Δt 结算恒 0（settleChainsDeltaT 与 calcDailyNet 双证）', () => {
    const clamped = applyGridConstraints({ chains: [corridor()], bases: [mkBase('b1', 0, 999)] });
    for (const minutes of [60, 720, 1440, 10080, 525600]) {
      expect(settleChainsDeltaT(clamped.chains, minutes, 1).deltaCredits).toBe(0);
    }
    expect(calcDailyNet(clamped.chains)).toBe(0);
    // 对照：同链未断电时全额计息（证明 0 来自工况钳制而非链参数）
    expect(settleChainsDeltaT([corridor()], 1440, 1).deltaCredits).toBe(600);
  });
});

/* ═══════════════ 验收②：电网恢复自动复原标称效率 ═══════════════ */

describe('EVT-OPR-01 · 验收②：电网恢复后自动恢复标称效率', () => {
  it('钳制→基地恢复（赤字消除）→ eff=1、active、复原说明、事件留痕', () => {
    const day1 = applyGridConstraints({ chains: [corridor()], bases: [mkBase('b1', 40, 100)], nowDay: 7 });
    const day2 = applyGridConstraints({ chains: day1.chains, bases: [mkBase('b1', 200, 100)], nowDay: 9 });
    expect(day2.chains[0].eff).toBe(1);
    expect(day2.chains[0].status).toBe('active');
    expect(day2.chains[0].reason).toBe(GRID_RESTORE_NOTE);
    expect(day2.chains[0].updated_at_day).toBe(9);
    expect(day2.events).toEqual([expect.objectContaining({ id: 'chain_corridor', kind: 'grid_restore' })]);
    // 复原后回到全额计息
    expect(settleChainsDeltaT(day2.chains, 1440, 9).deltaCredits).toBe(600);
  });

  it('叙事受挫链防误复原：无工况标记的 distressed 链在电网正常波动中原样引用', () => {
    const narrative = mkChain({
      id: 'c1',
      name: '暴雪封路走廊',
      rate_daily: 600,
      status: 'distressed',
      eff: 0.5,
      reason: '因暴风雪封路，货运暂缓',
      deps: deps('b1'),
    });
    const r = applyGridConstraints({ chains: [narrative], bases: [mkBase('b1', 100, 0)] });
    expect(r.chains[0]).toBe(narrative); // 无标记 → 不复原
    expect(calcDailyNet(r.chains)).toBe(300); // 叙事降效保持
  });

  it('复原幂等：复原产物再跑（reason 已无断供标记）→ 零事件同引用', () => {
    const day1 = applyGridConstraints({ chains: [corridor()], bases: [mkBase('b1', 0, 100)] });
    const day2 = applyGridConstraints({ chains: day1.chains, bases: [mkBase('b1', 100, 0)] });
    const day3 = applyGridConstraints({ chains: day2.chains, bases: [mkBase('b1', 100, 0)] });
    expect(day3.events).toEqual([]);
    expect(day3.chains[0]).toBe(day2.chains[0]);
  });
});

/* ═══════════════ 天候衰减（结算视图，幂等零持久化） ═══════════════ */

describe('EVT-OPR-01 · 天候衰减视图 withWeatherView', () => {
  it('辐射风暴 0.5：600 链视图 eff=0.5，全天结算 +300', () => {
    const view = withWeatherView([corridor()], '辐射风暴');
    expect(view[0].eff).toBe(0.5);
    expect(settleChainsDeltaT(view, 1440, 1).deltaCredits).toBe(300);
  });

  it('系数读取：未登记天候/空值 → 1 不衰减；非法系数钳制或回退', () => {
    expect(weatherDecayOf(undefined)).toBe(1);
    expect(weatherDecayOf('晴朗')).toBe(1);
    expect(weatherDecayOf('暴风雪')).toBe(0.5);
    expect(weatherDecayOf('怪天', { 怪天: Number.NaN })).toBe(1);
    expect(weatherDecayOf('怪天', { 怪天: 1.7 })).toBe(1); // >1 拒绝放大
  });

  it('派生幂等零复合：从持久链条重复派生恒等；视图零回写（原链 eff 不变）；契约禁视图套视图', () => {
    const chains = [corridor()];
    const snapshot = structuredClone(chains);
    const once = withWeatherView(chains, '暴风雪');
    const onceAgain = withWeatherView(chains, '暴风雪'); // 每楼从持久链条重新派生
    expect(onceAgain).toStrictEqual(once); // 派生幂等：重复派生不复合
    expect(chains).toStrictEqual(snapshot); // 视图零回写：原链 eff 仍 1
    expect(once[0].eff).toBe(0.5);
    expect(withWeatherView(once, '暴风雪')[0].eff).toBe(0.25); // view-of-view 会复合：契约禁用形态的哨兵断言（防止后来者误当幂等 API）
  });

  it('晴天/未登记天候：原数组同引用返回', () => {
    const chains = [corridor()];
    expect(withWeatherView(chains, undefined)).toBe(chains);
    expect(withWeatherView(chains, '晴朗')).toBe(chains);
  });

  it('与电网钳制正交组合：断供链（eff=0）叠加风暴视图仍恒 0', () => {
    const clamped = applyGridConstraints({ chains: [corridor()], bases: [mkBase('b1', 0, 999)] });
    const view = withWeatherView(clamped.chains, '辐射风暴');
    expect(settleChainsDeltaT(view, 1440, 1).deltaCredits).toBe(0);
  });
});

/* ═══════════════ 纯函数不可变性与确定性 ═══════════════ */

describe('EVT-OPR-01 · 纯函数铁律', () => {
  it('deep-frozen 输入不抛错；入参零突变；未变元素原样引用', () => {
    const chains = deepFreeze([
      corridor(),
      mkChain({ id: 'c9', name: '旁路', rate_daily: 100, status: 'active', deps: deps('b9') }),
    ]);
    const snapshot = structuredClone(chains as unknown as IncomeChainT[]);
    const r = applyGridConstraints({ chains, bases: deepFreeze([mkBase('b1', 0, 100)]) });
    expect(chains).toStrictEqual(snapshot);
    expect(r.chains[0]).not.toBe(chains[0]); // 钳制元素新引用
    expect(r.chains[1]).toBe(chains[1]); // 未变元素结构共享
  });

  it('确定性：同输入两次结算 toStrictEqual 恒等', () => {
    const input = { chains: [corridor()], bases: [mkBase('b1', 0, 100)], nowDay: 3 };
    expect(applyGridConstraints(input)).toStrictEqual(applyGridConstraints(input));
  });
});

/* ═══════════════ FD-51 · PKG-B：物理三要素动态钳制与多轨资金链建立/商路软修正守卫 ═══════════════ */

describe('FD-51 · PKG-B：物理三要素动态钳制升级与多轨资金链解析', () => {
  it('① 采矿精炼链在基地有精炼厂但 vehicles: []（无采矿车）时钳制为 distressed (eff=0, 依赖载具未就位)，补充武装采矿车后自动恢复 active (eff=1)', () => {
    const miningChain = mkChain({
      id: 'chain_north_mine',
      name: '北坡富铁矿采掘线',
      chain_kind: '采矿精炼',
      rate_daily: 1200,
      resources_daily: { 矿产: { 铁矿石: 150 } },
      status: 'active',
      eff: 1,
      reason: '北坡精炼厂投产',
      deps: {
        base_id: 'b1',
        buildings: [], // 未显式填建筑时，采矿精炼默认要求矿石精炼厂
        world_resource: '北坡露天铁矿脉',
      },
    });

    const baseWithRefinery: BasePowerView = {
      id: 'b1',
      power: { gen: 200, use: 100 },
      buildings: [{ name: '苏联矿石精炼厂', state: '运转' }],
    };

    // 1. 基地有精炼厂且电力充足，但战区无采矿车（vehicles: []）→ 钳制挂起
    const step1 = applyGridConstraints({
      chains: [miningChain],
      bases: [baseWithRefinery],
      vehicles: [],
      nowDay: 5,
    });
    expect(step1.chains[0].status).toBe('distressed');
    expect(step1.chains[0].eff).toBe(0);
    expect(step1.chains[0].reason).toContain('依赖载具未就位(采矿车)');
    expect(step1.chains[0].reason).toContain('[原状态:active,eff:1]');
    expect(step1.events).toHaveLength(1);
    expect(step1.events[0].kind).toBe('grid_outage');

    // 2. 补充武装采矿车入列 → 自动恢复 active (eff=1) 与原 reason
    const step2 = applyGridConstraints({
      chains: step1.chains,
      bases: [baseWithRefinery],
      vehicles: ['武装采矿车'],
      nowDay: 6,
    });
    expect(step2.chains[0].status).toBe('active');
    expect(step2.chains[0].eff).toBe(1);
    expect(step2.chains[0].reason).toBe('北坡精炼厂投产');
    expect(step2.events).toHaveLength(1);
    expect(step2.events[0].kind).toBe('grid_restore');
  });

  it('② 本土商路链在关联势力变为「敌意」时自动挂起停摆，恢复「中立/友善」后自动恢复', () => {
    const tradeChain = mkChain({
      id: 'chain_rail_trade',
      name: '北郊铁道互市商路',
      chain_kind: '本土商路',
      rate_daily: 0,
      wallet_daily: { 金圆券: -1500 },
      resources_daily: { 建材: { 高强工程钢材: 120 }, 燃油: { 精炼柴油: 80 } },
      status: 'active',
      eff: 1,
      reason: '与铁道幸存者同盟签订互市协定',
      deps: {
        base_id: 'b1',
        buildings: [],
        faction: '铁道幸存者同盟',
        world_resource: '',
      },
    });

    const baseNormal = mkBase('b1', 150, 80);

    // 1. 关联势力变为敌意 → 自动挂起停摆
    const step1 = applyGridConstraints({
      chains: [tradeChain],
      bases: [baseNormal],
      factions: [{ name: '铁道幸存者同盟', attitude: '敌意' }],
      nowDay: 10,
    });
    expect(step1.chains[0].status).toBe('distressed');
    expect(step1.chains[0].eff).toBe(0);
    expect(step1.chains[0].reason).toContain('贸易势力敌对断交(铁道幸存者同盟)');
    expect(step1.chains[0].reason).toContain('[原状态:active,eff:1]');

    // 2. 关联势力恢复中立/友善 → 自动恢复 active (eff=1)
    const step2 = applyGridConstraints({
      chains: step1.chains,
      bases: [baseNormal],
      factions: [{ name: '铁道幸存者同盟', attitude: '友善' }],
      nowDay: 12,
    });
    expect(step2.chains[0].status).toBe('active');
    expect(step2.chains[0].eff).toBe(1);
    expect(step2.chains[0].reason).toBe('与铁道幸存者同盟签订互市协定');
  });

  it('③ <事件> 资金链建立：黑市走私商路误写日额度: 1500 时软修正为外币钱袋收入并记黄灯留痕；外币日收支与货物日收支准确解析', () => {
    // 1. 商路防串轨软修正守卫（D-CHAIN-NET-02）
    const rawMsg = `
<事件>
- 类型: 资金链建立
  对象: 黑市走私商路
  日额度: 1500
  贸易对象: 荒坂财团
  说明: 借地方黑市走私工业品
- 类型: 资金链建立
  对象: 北郊铁道大宗易货商路
  链条类型: 本土商路
  依赖势力: 铁道幸存者同盟
  外币日收支:
    金圆券: -1500
  货物日收支:
    建材:
      高强工程钢材: 120
    燃油:
      精炼柴油: 80
  说明: 以本地金圆券换取钢材与柴油
</事件>
`;

    const gate = extractEvents(
      rawMsg.replace(/<\/?事件>/g, '').trim(),
    );
    expect(gate.quarantineEvents).toEqual([]);
    expect(gate.acceptedEvents).toHaveLength(2);

    // 第一条：黑市走私商路被自动软修正为 rate_daily: 0, wallet_daily: { 本地通用货币: 1500 } 并进入黄灯
    const tradeDecl = gate.acceptedEvents[0].declaration.chain!;
    expect(tradeDecl.name).toBe('黑市走私商路');
    expect(tradeDecl.chain_kind).toBe('本土商路');
    expect(tradeDecl.rate_daily).toBe(0);
    expect(tradeDecl.wallet_daily).toEqual({ 本地通用货币: 1500 });
    expect(tradeDecl.deps?.faction).toBe('荒坂财团');
    expect(gate.yellowEvents).toHaveLength(1);
    expect(gate.yellowEvents[0].repairs.join('；')).toContain(
      '本土商路「黑市走私商路」不可直接产出系统资金 Credits，已自动转为本地外币钱袋收入',
    );

    // 第二条：纯外币+货物商路（无日额度/rate_daily=0）合法通过绿灯并准确解析外币日收支与货物日收支
    const barterDecl = gate.acceptedEvents[1].declaration.chain!;
    expect(barterDecl.name).toBe('北郊铁道大宗易货商路');
    expect(barterDecl.chain_kind).toBe('本土商路');
    expect(barterDecl.rate_daily).toBe(0);
    expect(barterDecl.wallet_daily).toEqual({ 金圆券: -1500 });
    expect(barterDecl.resources_daily).toEqual({
      建材: { 高强工程钢材: 120 },
      燃油: { 精炼柴油: 80 },
    });
    expect(barterDecl.deps?.faction).toBe('铁道幸存者同盟');

    // 验证经 parseMessageText 走完整解析管线时产生 🟡 黄灯事件留痕且 <任务> 奖励 chains 同步支持透传
    const fullParse = parseMessageText(
      `${rawMsg}
<任务>
- 名称: 打通北坡铁道商路
  类别: 支线
  状态: 已完成
  奖励:
    资金链:
      - 名称: 铁道军需补给商路
        链条类型: 本土商路
        依赖势力: 铁道幸存者同盟
        外币日收支:
          新日元: 800
        货物日收支:
          后勤:
            战备副食与口粮: 60
</任务>`,
    );
    expect(
      fullParse.events.some(
        e => e.light === '🟡' && e.message.includes('本土商路「黑市走私商路」不可直接产出系统资金 Credits'),
      ),
    ).toBe(true);
    const questChain = fullParse.data.economy.chains.find(c => c.name === '铁道军需补给商路');
    expect(questChain).toBeDefined();
    expect(questChain?.chain_kind).toBe('本土商路');
    expect(questChain?.rate_daily).toBe(0);
    expect(questChain?.wallet_daily).toEqual({ 新日元: 800 });
    expect(questChain?.resources_daily).toEqual({ 后勤: { 战备副食与口粮: 60 } });
    expect(questChain?.deps?.faction).toBe('铁道幸存者同盟');
  });
});

