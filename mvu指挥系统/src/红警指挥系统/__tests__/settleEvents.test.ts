/**
 * EVT-SETTLE-01 · settleFloor 时序推进与资金链积分接缝 —— 专项单测
 * 真源：《事件系统与资金链状态机总设计案》§3.3（CTRL-EVENT-01）/《MVP 任务包》§3.4·§6
 * 覆盖任务验收四条：
 * 1. 本楼推进 1440 分钟，日额度 600 的资金链准确贡献 +600 credits；
 * 2. 发生断裂事件的链条在本楼即时停止计息（事件先于时钟）；
 * 3. 资金总额累加精确到整数，无浮点数漂移；
 * 4. 生成本楼事件更新快照（chains 回写随本楼落盘 + [资金链] 留痕事件）。
 * 外加：建立入池即计息、受挫即时降效、枯竭封顶锁死、支出链流出、零注入零行为变化、
 *       解析→结算全链路闭环、入参零突变。
 */
import { describe, expect, it } from 'vitest';
import type { ChainEventDecl, EventDeclaration, StatData } from '../parse/parsePipeline';
import { parseMessageText } from '../parse/parsePipeline';
import { settleFloor } from '../engines/settleFloor';
import { IncomeChain, Schema } from '../core/schema';
import type { IncomeChain as IncomeChainT } from '../core/schema';

/* ═══════════════ 工具 ═══════════════ */

const DAY = '<timePast>1 D 0 H 0 M</timePast>';
const HALF_DAY = '<timePast>0 D 12 H 0 M</timePast>';
const TWO_DAYS = '<timePast>2 D 0 H 0 M</timePast>';

function mkChain(over: Partial<IncomeChainT> & Pick<IncomeChainT, 'id' | 'name'>): IncomeChainT {
  return IncomeChain.parse({ rate_daily: 0, ...over });
}

function mkStat(chains: IncomeChainT[], credits = 1000): StatData {
  return Schema.parse({
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 3, location: '锈蚀低壑' },
    economy: { credits, chains },
  });
}

const chainDecl = (
  over: Partial<ChainEventDecl> = {},
  verb: EventDeclaration['verb'] = '资金链建立',
): EventDeclaration => ({
  verb,
  kind: 'chain',
  chain: {
    name: '灵石走私走廊',
    flow: '收入',
    rate_daily: 600,
    base_id: '1号前哨站',
    buildings: ['隐蔽仓库'],
    reason: '与当地修真家族达成私下供货协议',
    ...over,
  },
});

/* ═══════════════ 验收四条 ═══════════════ */

describe('EVT-SETTLE-01 · 任务验收标准', () => {
  it('验收①：本楼推进 1440 分钟，日额度 600 资金链准确贡献 +600 credits', () => {
    const next = mkStat([mkChain({ id: 'c1', name: '灵石走私走廊', rate_daily: 600, status: 'active' })]);
    const r = settleFloor(undefined, next, DAY);
    expect(r.deltaMinutes).toBe(1440);
    expect(r.data.economy.credits).toBe(1600);
    expect(Number.isInteger(r.data.economy.credits)).toBe(true);
    // 快照回写：extracted 累计随本楼落盘
    expect(r.data.economy.chains[0].capacity.extracted).toBe(600);
    expect(r.data.economy.chains[0].status).toBe('active');
  });

  it('验收②：发生断裂事件的链条在本楼即时停止计息（事件先于时钟）', () => {
    const next = mkStat([
      mkChain({ id: 'chain_灵石走私走廊', name: '灵石走私走廊', rate_daily: 600, status: 'active' }),
    ]);
    const r = settleFloor(undefined, next, DAY, {
      eventDeclarations: [chainDecl({ reason: '分拣厂被恶意焚毁' }, '资金链断裂')],
    });
    expect(r.data.economy.credits).toBe(1000); // 断裂当期零计息
    expect(r.data.economy.chains[0].status).toBe('broken');
    expect(r.data.economy.chains[0].eff).toBe(0);
    expect(r.events.some(e => e.message.includes('[资金链] 断裂「灵石走私走廊」'))).toBe(true);
  });

  it('验收③：资金累加精确到整数，无浮点漂移（小数日息四舍五入、多链互补不丢真）', () => {
    const odd = mkStat([mkChain({ id: 'c1', name: '半效走廊', rate_daily: 101, status: 'distressed', eff: 0.5 })]);
    expect(settleFloor(undefined, odd, DAY).data.economy.credits).toBe(1051); // 50.5/日 → 51
    const pair = mkStat([
      mkChain({ id: 'c1', name: 'a', rate_daily: 101, status: 'distressed', eff: 0.5 }),
      mkChain({ id: 'c2', name: 'b', rate_daily: 99, status: 'distressed', eff: 0.5 }),
    ]);
    const r = settleFloor(undefined, pair, DAY);
    expect(r.data.economy.credits).toBe(1100); // 50.5＋49.5＝100，互补无漂移
    expect(Number.isInteger(r.data.economy.credits)).toBe(true);
  });

  it('验收④：生成本楼事件更新快照（chains 回写＋[资金链] 留痕事件齐备）', () => {
    const next = mkStat([
      mkChain({
        id: 'c1',
        name: '灵石矿脉',
        rate_daily: 600,
        status: 'active',
        capacity: { total_yield: 1000, extracted: 0 },
      }),
    ]);
    const r = settleFloor(undefined, next, TWO_DAYS);
    expect(r.data.economy.chains[0].status).toBe('exhausted');
    expect(r.data.economy.chains[0].capacity.extracted).toBe(1000);
    expect(r.data.economy.credits).toBe(2000); // 封顶 1000，绝不超采
    expect(r.events.some(e => e.message.includes('[资金链] 时钟结算') && e.message.includes('+1000'))).toBe(true);
    expect(r.events.some(e => e.message.includes('枯竭「灵石矿脉」'))).toBe(true);
  });
});

/* ═══════════════ 引擎语义细目 ═══════════════ */

describe('EVT-SETTLE-01 · 事件声明与时钟积分语义', () => {
  it('建立声明即时入池参与本期积分（id 由 canon 链名派生）', () => {
    const next = mkStat([]);
    const r = settleFloor(undefined, next, DAY, { eventDeclarations: [chainDecl()] });
    expect(r.data.economy.chains).toHaveLength(1);
    expect(r.data.economy.chains[0].id).toBe('chain_灵石走私走廊');
    expect(r.data.economy.chains[0].status).toBe('active');
    expect(r.data.economy.credits).toBe(1600); // 当期即全额 +600
    expect(r.events.some(e => e.message.includes('[资金链] 建立「灵石走私走廊」'))).toBe(true);
  });

  it('受挫声明即时降效：600 链受挫 eff=0.5，当期只计 +300', () => {
    const next = mkStat([
      mkChain({ id: 'chain_灵石走私走廊', name: '灵石走私走廊', rate_daily: 600, status: 'active' }),
    ]);
    const r = settleFloor(undefined, next, DAY, {
      eventDeclarations: [chainDecl({ reason: '暴风雪封路' }, '资金链受挫')],
    });
    expect(r.data.economy.credits).toBe(1300);
    expect(r.data.economy.chains[0].status).toBe('distressed');
    expect(r.data.economy.chains[0].eff).toBe(0.5);
  });

  it('支出链流出：200/日 支出链半天流出一百', () => {
    const next = mkStat([mkChain({ id: 'c1', name: '佣兵合同', rate_daily: 200, flow: '支出', status: 'active' })]);
    const r = settleFloor(undefined, next, HALF_DAY);
    expect(r.data.economy.credits).toBe(900);
  });

  it('枯竭锁死后续停息：枯竭后下一楼推进恒零贡献', () => {
    const next = mkStat([
      mkChain({
        id: 'c1',
        name: '灵石矿脉',
        rate_daily: 600,
        status: 'active',
        capacity: { total_yield: 500, extracted: 0 },
      }),
    ]);
    const day1 = settleFloor(undefined, next, DAY); // 封顶 +500 并枯竭
    expect(day1.data.economy.credits).toBe(1500);
    const day2 = settleFloor(undefined, day1.data, DAY);
    expect(day2.data.economy.credits).toBe(1500); // 锁死
    expect(day2.data.economy.chains[0].status).toBe('exhausted');
  });

  it('断裂后重建同链：canon 同名 id 幂等命中，覆盖为 active 新参数', () => {
    const next = mkStat([
      mkChain({ id: 'chain_灵石走私走廊', name: '灵石走私走廊', rate_daily: 600, status: 'broken', eff: 0 }),
    ]);
    const r = settleFloor(undefined, next, DAY, { eventDeclarations: [chainDecl({ rate_daily: 500 })] });
    expect(r.data.economy.chains).toHaveLength(1); // 不生分叉
    expect(r.data.economy.chains[0].status).toBe('active');
    expect(r.data.economy.chains[0].rate_daily).toBe(500);
    expect(r.data.economy.credits).toBe(1500); // 重建后当期按新额度计息
  });
});

/* ═══════════════ 护栏与闭环 ═══════════════ */

describe('EVT-SETTLE-01 · 零注入护栏与全链路闭环', () => {
  it('零注入零行为变化：无链条无声明 → 第四齿轮整体跳过（credits 逐字节不变、无 [资金链] 事件）', () => {
    const next = mkStat([]);
    const r = settleFloor(undefined, next, DAY);
    expect(r.data.economy.credits).toBe(1000);
    expect(r.data.economy.chains).toEqual([]);
    expect(r.events.some(e => e.message.includes('[资金链]'))).toBe(false);
  });

  it('有链条但 Δt=0 → 齿轮跳过（无推进不计息不改账）', () => {
    const next = mkStat([mkChain({ id: 'c1', name: '走廊', rate_daily: 600, status: 'active' })]);
    const r = settleFloor(undefined, next, '没有任何时间标签的正文');
    expect(r.deltaMinutes).toBe(0);
    expect(r.data.economy.credits).toBe(1000);
  });

  it('入参零突变：结算前后 nextData 逐值不变（纯函数铁律）', () => {
    const next = mkStat([
      mkChain({
        id: 'c1',
        name: '走廊',
        rate_daily: 600,
        status: 'active',
        capacity: { total_yield: 800, extracted: 100 },
      }),
    ]);
    const snapshot = structuredClone(next);
    settleFloor(undefined, next, DAY, { eventDeclarations: [chainDecl({}, '资金链受挫')] });
    expect(next).toStrictEqual(snapshot);
  });

  it('全链路闭环：<战况>＋<事件> 解析 → 三色门 → settleFloor 第四齿轮 → 账本与链条同楼落定', () => {
    const raw = [
      '<战况>',
      '日期: 2042-03-14',
      '地点: 锈蚀低壑',
      '资金: 5000',
      '</战况>',
      '<事件>',
      '- 类型: 资金链建立',
      '  对象: 灵石走私走廊',
      '  流向: 收入',
      '  额度: 600',
      '  周期: 日',
      '  依赖:',
      '    - 基地: 1号前哨站',
      '    - 设施: 隐蔽仓库',
      '  理由: 与当地修真家族达成私下供货协议',
      '</事件>',
      DAY,
    ].join('\n');
    const parsed = parseMessageText(raw, {});
    expect(parsed.eventDeclarations).toHaveLength(1);
    expect(parsed.applied).toBe(true); // 战况 5000 已入账
    const settled = settleFloor(undefined, parsed.data, raw, {
      eventDeclarations: parsed.eventDeclarations,
    });
    expect(settled.data.economy.credits).toBe(5600); // 5000 ＋ 当期 600
    expect(settled.data.economy.chains).toHaveLength(1);
    expect(settled.data.economy.chains[0].name).toBe('灵石走私走廊');
    expect(settled.data.economy.chains[0].deps.base_id).toBe('1号前哨站');
    expect(settled.events.some(e => e.message.includes('[资金链] 建立'))).toBe(true);
    expect(settled.events.some(e => e.message.includes('[资金链] 时钟结算'))).toBe(true);
  });
});

/* ═══════════════ EVT-OPR-01 × EVT-SETTLE-01 · 电网硬联动与天候衰减端到端闭环 ═══════════════ */

describe('EVT-OPR-01 × EVT-SETTLE-01 · 电网断供/恢复与天候衰减端到端联动', () => {
  function mkStatWithBases(
    chains: IncomeChainT[],
    bases: Array<{ id: string; name: string; gen: number; use: number }>,
    credits = 1000,
  ): StatData {
    return Schema.parse({
      meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 3, location: '锈蚀低壑' },
      economy: { credits, chains },
      bases: bases.map(b => ({
        id: b.id,
        name: b.name,
        power: { gen: b.gen, use: b.use },
      })),
    });
  }

  it('工况联动①：基地电力赤字（gen < use，含按基地 name 与按 id 绑定）时，settleFloor 自动置 eff=0、status=distressed，推进 1440 分钟收益为 0', () => {
    const next = mkStatWithBases(
      [
        mkChain({
          id: 'chain_by_name',
          name: '灵石走私走廊',
          rate_daily: 600,
          status: 'active',
          deps: { base_id: '1号前哨站', buildings: ['隐蔽仓库'], world_resource: '' },
        }),
        mkChain({
          id: 'chain_by_id',
          name: '前沿矿石专线',
          rate_daily: 400,
          status: 'active',
          deps: { base_id: 'base1', buildings: ['矿石精炼厂'], world_resource: '' },
        }),
      ],
      [{ id: 'base1', name: '1号前哨站', gen: 40, use: 100 }],
      1000,
    );

    const r = settleFloor(undefined, next, DAY);
    expect(r.deltaMinutes).toBe(1440);
    expect(r.data.economy.credits).toBe(1000); // 断电期间推进 1440 分钟收益为 0
    for (const c of r.data.economy.chains) {
      expect(c.eff).toBe(0);
      expect(c.status).toBe('distressed');
      expect(c.reason).toContain('电网断供');
      expect(c.capacity.extracted).toBe(0);
    }
    expect(
      r.events.filter(e => e.light === '🟡' && e.path === 'economy.chains' && e.message.includes('[资金链] 电网断供')),
    ).toHaveLength(2);
  });

  it('工况联动②：下一楼基地恢复供电（gen >= use）后，settleFloor 自动恢复 eff=1、status=active，推进 1440 分钟正常产出全额日息', () => {
    const outageState = mkStatWithBases(
      [
        mkChain({
          id: 'chain_by_name',
          name: '灵石走私走廊',
          rate_daily: 600,
          status: 'active',
          deps: { base_id: '1号前哨站', buildings: ['隐蔽仓库'], world_resource: '' },
        }),
        mkChain({
          id: 'chain_by_id',
          name: '前沿矿石专线',
          rate_daily: 400,
          status: 'active',
          deps: { base_id: 'base1', buildings: ['矿石精炼厂'], world_resource: '' },
        }),
      ],
      [{ id: 'base1', name: '1号前哨站', gen: 40, use: 100 }],
      1000,
    );
    const floor1 = settleFloor(undefined, outageState, DAY);
    expect(floor1.data.economy.credits).toBe(1000);

    // 下一楼：基地恢复供电（gen=150 >= use=100）
    const restoredInput: StatData = {
      ...floor1.data,
      meta: { ...floor1.data.meta, date: '2042-03-15', day_count: 4 },
      bases: [{ ...floor1.data.bases[0], power: { gen: 150, use: 100 } }],
    };
    const floor2 = settleFloor(floor1.data, restoredInput, DAY);
    expect(floor2.data.economy.credits).toBe(2000); // 1000 + 600 + 400 全额日息
    for (const c of floor2.data.economy.chains) {
      expect(c.eff).toBe(1);
      expect(c.status).toBe('active');
    }
    expect(
      floor2.events.filter(
        e => e.light === '🟢' && e.path === 'economy.chains' && e.message.includes('[资金链] 电网恢复'),
      ),
    ).toHaveLength(2);
  });

  it('工况联动③：恶劣天候（weather: 暴风雪）下当期收益按 0.5 折算，但落盘 eff 仍保持持久值 1（连续推进两楼不发生 0.5→0.25 复合衰减）', () => {
    const next = mkStatWithBases(
      [
        mkChain({
          id: 'c1',
          name: '灵石走私走廊',
          rate_daily: 600,
          status: 'active',
          eff: 1,
          deps: { base_id: '1号前哨站', buildings: [], world_resource: '' },
        }),
      ],
      [{ id: 'base1', name: '1号前哨站', gen: 120, use: 80 }],
      1000,
    );

    const floor1 = settleFloor(undefined, next, DAY, { weather: '暴风雪' });
    expect(floor1.data.economy.credits).toBe(1300); // 600 * 0.5 = +300
    expect(floor1.data.economy.chains[0].capacity.extracted).toBe(300);
    expect(floor1.data.economy.chains[0].eff).toBe(1); // 持久 eff 保持 1，绝不写为 0.5

    // 连续第二楼同样暴风雪：依旧按持久 eff=1 × 0.5 折算得 +300（而非 0.25 得 +150）
    const floor2 = settleFloor(floor1.data, floor1.data, DAY, { weather: '暴风雪' });
    expect(floor2.data.economy.credits).toBe(1600);
    expect(floor2.data.economy.chains[0].capacity.extracted).toBe(600);
    expect(floor2.data.economy.chains[0].eff).toBe(1);
  });
});
