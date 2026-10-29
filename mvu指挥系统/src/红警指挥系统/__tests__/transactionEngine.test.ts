import { describe, expect, it } from 'vitest';
import { calculateOperation } from '../../中控悬浮窗/models/operationEngine';
import { migrateV1toV2, QueueItem, Schema } from '../core/schema';
import {
  applyDispatchOrders,
  canTransition,
  settleTransactions,
  type TransactionItem,
  type TransactionStatus,
} from '../engines/transactionEngine';

/* ═══════════════ 测试工具 ═══════════════ */

/** 造一条 v2 全字段事务（默认 active、工期 1000 分钟） */
function txn(overrides: Partial<TransactionItem> = {}): TransactionItem {
  return {
    type: '生产',
    item: '测试载具',
    base: 'alpha',
    progress: 0,
    eta: '',
    status: 'active',
    started_at: '',
    total_minutes: 1000,
    spent_minutes: 0,
    qty: 1,
    qty_done: 0,
    cost_paid: true,
    min_days_lock: 0,
    hold: false,
    ...overrides,
  };
}

/** #0 楼归零态钉死对象（toStrictEqual 用，clock/resources/protocols 必须缺席；chains:[]＝EVT-SCHEMA-01、protocol_points:0＝PRT-SCHEMA-01 default 兑底） */
const ZERO_STATE = {
  schema_version: 2,
  meta: { world_id: '', date: '', day_count: 0, location: '' },
  economy: { credits: 0, credits_daily: 0, wallet: {}, chains: [] },
  exposure: { value: 0, trend: '', last_change: '' },
  bases: [],
  queues: [],
  protocol_points: 0,
  tech: { done: [] },
  forces: { girls: [], troops: {}, command_cap: '', vehicles: [], ammo: {}, equipment: {} },
  factions: [],
  intel: [],
  intel_archived: [],
  codex: [],
  pending_lore: [],
  pending_data_patches: [],
  pending_expansions: [],
  pending_summaries: [],
  quests: { active: [], done_count: 0 },
  options: [],
};

describe('CTRL-TXN-SCHEMA-01 · QueueItem v2 schema 迁移链', () => {
  it('旧五字段 QueueItem 过 v2 schema 零报错，新字段全 default 兑底', () => {
    const legacy = { type: '生产', item: '测试载具', base: 'beipo', progress: 20, eta: '余2日' };
    const parsed = QueueItem.parse(legacy);
    expect(parsed).toStrictEqual({
      type: '生产',
      item: '测试载具',
      base: 'beipo',
      progress: 20,
      eta: '余2日',
      status: 'active',
      started_at: '',
      total_minutes: 0,
      spent_minutes: 0,
      qty: 1,
      qty_done: 0,
      cost_paid: true,
      min_days_lock: 0,
      hold: false,
    });
  });

  it('type 枚举扩「改装」；非法 type 仍拒收', () => {
    expect(QueueItem.parse({ type: '改装', item: '灰熊坦克装甲升级' }).type).toBe('改装');
    expect(() => QueueItem.parse({ type: '维修', item: 'x' })).toThrow();
  });

  it('#0 楼归零态 toStrictEqual 钉死：clock 与 resources 不凭空注入', () => {
    const z0 = Schema.parse({});
    expect(z0).toStrictEqual({
      ...ZERO_STATE,
      applied_data_patches: [],
      planning: z0.planning,
      command: z0.command,
      space: z0.space,
      morale: z0.morale,
    });
    expect('clock' in z0).toBe(false);
  });

  it('旧档（v1 迁移）解析结果零注入：clock 缺席，队列旧字段保真', () => {
    const v1 = {
      schema_version: 1,
      meta: { date: '秋·九月十八' },
      economy: { wallet: { copper: 12 } },
      queues: [{ type: '生产', item: '测试载具', base: 'beipo', progress: 20 }],
    };
    const migrated = Schema.parse(migrateV1toV2(structuredClone(v1)));
    expect('clock' in migrated).toBe(false);
    expect(migrated.queues[0]).toMatchObject({
      type: '生产',
      item: '测试载具',
      base: 'beipo',
      progress: 20,
      status: 'active',
      hold: false,
    });
  });

  it('clock 显式写入时正常解析并保真；脏形态拒收', () => {
    const withClock = Schema.parse({ clock: { day: 47, time: '08:30' } });
    expect(withClock.clock).toStrictEqual({ day: 47, time: '08:30' });
    expect(() => Schema.parse({ clock: { day: '第47天', time: '08:30' } })).toThrow();
    expect(() => Schema.parse({ clock: { day: 47 } })).toThrow();
  });

  it('v2 新字段显式写入保真（status/qty/hold 等不被 default 覆盖）', () => {
    const parsed = QueueItem.parse({
      type: '生产',
      item: '天启坦克',
      base: 'alpha',
      status: 'queued',
      total_minutes: 2880,
      spent_minutes: 600,
      qty: 5,
      qty_done: 1,
      cost_paid: false,
      min_days_lock: 2,
      hold: true,
    });
    expect(parsed.status).toBe('queued');
    expect(parsed.total_minutes).toBe(2880);
    expect(parsed.spent_minutes).toBe(600);
    expect(parsed.qty).toBe(5);
    expect(parsed.qty_done).toBe(1);
    expect(parsed.cost_paid).toBe(false);
    expect(parsed.min_days_lock).toBe(2);
    expect(parsed.hold).toBe(true);
    expect(() => QueueItem.parse({ type: '生产', item: 'x', status: 'paused' })).toThrow();
  });
});

describe('CTRL-TXN-SCHEMA-01 · 状态机守卫 canTransition', () => {
  const ALL: TransactionStatus[] = ['queued', 'active', 'settling', 'done', 'cancelled'];
  const LEGAL = new Set([
    'queued→active',
    'active→settling',
    'active→queued',
    'settling→done',
    'settling→active',
    'queued→cancelled',
    'active→cancelled',
  ]);

  it('合法迁移白名单全通过', () => {
    for (const pair of LEGAL) {
      const [from, to] = pair.split('→') as [TransactionStatus, TransactionStatus];
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('白名单之外全拒（done→active、cancelled→*、queued→settling、自迁移等）', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        expect(canTransition(from, to)).toBe(LEGAL.has(`${from}→${to}`));
      }
    }
    // 显式钉死任务验收点名的非法迁移
    expect(canTransition('done', 'active')).toBe(false);
    expect(canTransition('cancelled', 'queued')).toBe(false);
    expect(canTransition('cancelled', 'active')).toBe(false);
    expect(canTransition('queued', 'settling')).toBe(false);
    expect(canTransition('settling', 'cancelled')).toBe(false);
    expect(canTransition('done', 'done')).toBe(false);
  });
});

describe('CTRL-TXN-SCHEMA-01 · settleTransactions 进度积分', () => {
  it('铁律2：Δt=0 时任何事务进度不变（时间是唯一燃料）', () => {
    const state = {
      queues: [txn({ spent_minutes: 300, progress: 30 }), txn({ item: '第二辆', progress: 55, spent_minutes: 550 })],
    };
    const { next } = settleTransactions(state, 0);
    expect(next.queues[0].progress).toBe(30);
    expect(next.queues[0].spent_minutes).toBe(300);
    expect(next.queues[1].progress).toBe(55);
    expect(next.queues[1].spent_minutes).toBe(550);
  });

  it('Δt×eff 积分：eff 缺省恒 1，progress = spent/total×100', () => {
    const state = { queues: [txn({ total_minutes: 1000 })] };
    const { next } = settleTransactions(state, 250);
    expect(next.queues[0].spent_minutes).toBe(250);
    expect(next.queues[0].progress).toBe(25);
  });

  it('工况联动：eff 回调返回 0.2 时进度按 0.2 缩放', () => {
    const state = { queues: [txn({ total_minutes: 1000 })] };
    const { next } = settleTransactions(state, 500, { effFor: () => 0.2 });
    expect(next.queues[0].spent_minutes).toBe(100);
    expect(next.queues[0].progress).toBe(10);
  });

  it('operationEngine 真实回环：低电 degraded efficiency=0.2 注入 eff 回调', () => {
    const evaluation = calculateOperation(
      { conditions: [{ trigger: 'low_power', behavior: 'degraded', efficiency: 0.2, desc: '低电降频' }] },
      { is_low_power: true },
      {},
    );
    expect(evaluation.efficiency).toBe(0.2);
    const state = { queues: [txn({ total_minutes: 1000 })] };
    const { next } = settleTransactions(state, 500, { effFor: () => evaluation.efficiency });
    expect(next.queues[0].spent_minutes).toBe(100);
    expect(next.queues[0].progress).toBe(10);
  });

  it('progress≥100 → settling，且封顶 100（settling→done 不在本引擎发生）', () => {
    const state = { queues: [txn({ total_minutes: 100, spent_minutes: 90, progress: 90 })] };
    const { next, events } = settleTransactions(state, 60);
    expect(next.queues[0].status).toBe('settling');
    expect(next.queues[0].progress).toBe(100);
    expect(events.some(e => e.type === 'enter_settling')).toBe(true);
    // settling 后再结算不推进也不 done
    const again = settleTransactions(next, 500);
    expect(again.next.queues[0].status).toBe('settling');
    expect(again.next.queues[0].spent_minutes).toBe(next.queues[0].spent_minutes);
  });

  it('total_minutes<=0（未知工期）不推进不报错，产出 unknown_duration 事件', () => {
    const state = { queues: [txn({ total_minutes: 0, progress: 15, spent_minutes: 0 })] };
    const { next, events } = settleTransactions(state, 300);
    expect(next.queues[0].progress).toBe(15);
    expect(next.queues[0].spent_minutes).toBe(0);
    expect(next.queues[0].status).toBe('active');
    expect(events.filter(e => e.type === 'unknown_duration')).toHaveLength(1);
  });

  it('settling/done/cancelled/queued 事务不吃 Δt', () => {
    const state = {
      queues: [
        txn({ item: 'a', status: 'settling', progress: 100, spent_minutes: 1000 }),
        txn({ item: 'b', status: 'done', progress: 100, spent_minutes: 1000 }),
        txn({ item: 'c', status: 'cancelled', progress: 40, spent_minutes: 400 }),
        txn({ item: 'd', status: 'queued', progress: 10, spent_minutes: 100, hold: true }),
      ],
    };
    const { next } = settleTransactions(state, 500);
    expect(next.queues.map(q => q.spent_minutes)).toEqual([1000, 1000, 400, 100]);
    expect(next.queues.map(q => q.progress)).toEqual([100, 100, 40, 10]);
  });
});

describe('CTRL-TXN-SCHEMA-01 · 批次流水（qty>1 生产事务）', () => {
  it('qty=5、足量 Δt 下 qty_done 阶梯式 0→1→…→5', () => {
    // 总工期 5000 分钟，单件 1000 分钟
    let state = { queues: [txn({ total_minutes: 5000, qty: 5 })] };
    const ladder: number[] = [state.queues[0].qty_done];
    for (let step = 0; step < 5; step++) {
      state = settleTransactions(state, 1000).next;
      ladder.push(state.queues[0].qty_done);
    }
    expect(ladder).toEqual([0, 1, 2, 3, 4, 5]);
    expect(state.queues[0].status).toBe('settling');
    expect(state.queues[0].progress).toBe(100);
  });

  it('半件不下线：spent 未跨单件工期整数倍时 qty_done 不动', () => {
    const state = { queues: [txn({ total_minutes: 5000, qty: 5 })] };
    const { next } = settleTransactions(state, 999);
    expect(next.queues[0].qty_done).toBe(0);
    const after = settleTransactions(next, 1).next;
    expect(after.queues[0].qty_done).toBe(1);
  });

  it('qty_done 封顶 qty（超量 Δt 不溢出）', () => {
    const state = { queues: [txn({ total_minutes: 5000, qty: 5 })] };
    const { next } = settleTransactions(state, 99999);
    expect(next.queues[0].qty_done).toBe(5);
    expect(next.queues[0].progress).toBe(100);
  });
});

describe('CTRL-TXN-SCHEMA-01 · queued 升格带宽门', () => {
  it('并行上限 default 1：产线空则数组序第一条 queued 升格并补记 started_at', () => {
    const state = {
      queues: [txn({ item: '一号', status: 'queued' }), txn({ item: '二号', status: 'queued' })],
    };
    const { next, events } = settleTransactions(state, 0, { now: '第3天 09:00' });
    expect(next.queues[0].status).toBe('active');
    expect(next.queues[0].started_at).toBe('第3天 09:00');
    expect(next.queues[1].status).toBe('queued');
    expect(events.filter(e => e.type === 'promoted')).toHaveLength(1);
  });

  it('并行上限经 options 注入：limit=2 时同产线可双开', () => {
    const state = {
      queues: [
        txn({ item: '一号', status: 'queued' }),
        txn({ item: '二号', status: 'queued' }),
        txn({ item: '三号', status: 'queued' }),
      ],
    };
    const { next } = settleTransactions(state, 0, { parallelLimitFor: () => 2 });
    expect(next.queues.map(q => q.status)).toEqual(['active', 'active', 'queued']);
  });

  it('hold=true 被升格跳过，后位非 hold 事务递补', () => {
    const state = {
      queues: [txn({ item: '暂缓中', status: 'queued', hold: true }), txn({ item: '正常排队', status: 'queued' })],
    };
    const { next } = settleTransactions(state, 0);
    expect(next.queues[0].status).toBe('queued');
    expect(next.queues[1].status).toBe('active');
  });

  it('不同 base / 不同 type 各自独立产线，互不占用带宽', () => {
    const state = {
      queues: [
        txn({ item: 'a', base: 'alpha', type: '生产', status: 'queued' }),
        txn({ item: 'b', base: 'beta', type: '生产', status: 'queued' }),
        txn({ item: 'c', base: 'alpha', type: '建造', status: 'queued' }),
      ],
    };
    const { next } = settleTransactions(state, 0);
    expect(next.queues.map(q => q.status)).toEqual(['active', 'active', 'active']);
  });
});

describe('CTRL-TXN-SCHEMA-01 · 调度令执行器 applyDispatchOrders', () => {
  it('置顶抢占：产线满时最后升格的 active 退回 queued，progress/spent_minutes 保留', () => {
    const queues = [
      txn({ item: '磁暴步兵', status: 'active', progress: 40, spent_minutes: 400 }),
      txn({ item: '天启坦克', status: 'queued', progress: 10, spent_minutes: 100 }),
    ];
    const { next, rejected } = applyDispatchOrders(queues, [{ item: '天启坦克', verb: '置顶' }]);
    expect(rejected).toHaveLength(0);
    const victim = next.find(q => q.item === '磁暴步兵')!;
    expect(victim.status).toBe('queued');
    expect(victim.progress).toBe(40);
    expect(victim.spent_minutes).toBe(400);
    // 天启坦克顶到产线首位
    expect(next[0].item).toBe('天启坦克');
    expect(next[0].progress).toBe(10);
    expect(next[0].spent_minutes).toBe(100);
  });

  it('置顶抢占＋随楼结算：抢占者经带宽门升格，被抢占者原进度续存', () => {
    const state = {
      queues: [
        txn({ item: '磁暴步兵', status: 'active', progress: 40, spent_minutes: 400 }),
        txn({ item: '天启坦克', status: 'queued' }),
      ],
    };
    const { next } = settleTransactions(state, 0, { orders: [{ item: '天启坦克', verb: '置顶' }] });
    const tank = next.queues.find(q => q.item === '天启坦克')!;
    const trooper = next.queues.find(q => q.item === '磁暴步兵')!;
    expect(tank.status).toBe('active');
    expect(trooper.status).toBe('queued');
    expect(trooper.progress).toBe(40);
    expect(trooper.spent_minutes).toBe(400);
  });

  it('置底：active 退回 queued（进度保留）挪到产线末位', () => {
    const queues = [
      txn({ item: '在造', status: 'active', progress: 60, spent_minutes: 600 }),
      txn({ item: '排队甲', status: 'queued' }),
      txn({ item: '排队乙', status: 'queued' }),
    ];
    const { next } = applyDispatchOrders(queues, [{ item: '在造', verb: '置底' }]);
    expect(next.map(q => q.item)).toEqual(['排队甲', '排队乙', '在造']);
    expect(next[2].status).toBe('queued');
    expect(next[2].progress).toBe(60);
    expect(next[2].spent_minutes).toBe(600);
  });

  it('暂缓：queued 打 hold；active 退回 queued＋hold（进度保留）', () => {
    const queues = [
      txn({ item: '排队中', status: 'queued' }),
      txn({ item: '在造中', status: 'active', progress: 30, spent_minutes: 300, base: 'beta' }),
    ];
    const { next } = applyDispatchOrders(queues, [
      { item: '排队中', verb: '暂缓' },
      { item: '在造中', verb: '暂缓' },
    ]);
    expect(next[0]).toMatchObject({ status: 'queued', hold: true });
    expect(next[1]).toMatchObject({ status: 'queued', hold: true, progress: 30, spent_minutes: 300 });
  });

  it('恢复：清 hold，随后结算按当前位置正常竞争带宽', () => {
    const queues = [txn({ item: '解冻目标', status: 'queued', hold: true })];
    const { next } = applyDispatchOrders(queues, [{ item: '解冻目标', verb: '恢复' }]);
    expect(next[0].hold).toBe(false);
    const settled = settleTransactions({ queues: next }, 0);
    expect(settled.next.queues[0].status).toBe('active');
  });

  it('非法动词进 rejected（含原因）', () => {
    const queues = [txn({ item: '目标', status: 'queued' })];
    const { next, rejected } = applyDispatchOrders(queues, [{ item: '目标', verb: '插队' }]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBe('invalid_verb');
    expect(next).toStrictEqual(queues);
  });

  it('作用于 settling/done/cancelled 的调度令进 rejected（§2.3.2 免疫区）', () => {
    const queues = [
      txn({ item: '待对账', status: 'settling', progress: 100 }),
      txn({ item: '已完成', status: 'done', progress: 100, base: 'beta' }),
      txn({ item: '已作废', status: 'cancelled', base: 'gamma' }),
    ];
    const { next, rejected } = applyDispatchOrders(queues, [
      { item: '待对账', verb: '置顶' },
      { item: '已完成', verb: '置底' },
      { item: '已作废', verb: '恢复' },
    ]);
    expect(rejected).toHaveLength(3);
    expect(rejected.every(r => r.reason === 'invalid_target_status')).toBe(true);
    expect(next).toStrictEqual(queues);
  });

  it('目标不存在进 rejected；调度令 🔴 永不修改任何事务的 progress/spent_minutes', () => {
    const queues = [txn({ item: '真实存在', status: 'active', progress: 77, spent_minutes: 770 })];
    const { next, rejected } = applyDispatchOrders(queues, [
      { item: '幽灵项目', verb: '置顶' },
      { item: '真实存在', verb: '置底' },
      { item: '真实存在', verb: '恢复' },
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBe('target_not_found');
    for (const q of next) {
      expect(q.progress).toBe(77);
      expect(q.spent_minutes).toBe(770);
    }
  });

  it('settleTransactions 内被拒调度令以 dispatch_rejected 事件留痕', () => {
    const state = { queues: [txn({ item: '待对账', status: 'settling', progress: 100 })] };
    const { events } = settleTransactions(state, 0, { orders: [{ item: '待对账', verb: '置顶' }] });
    expect(events.some(e => e.type === 'dispatch_rejected' && e.item === '待对账')).toBe(true);
  });
});

describe('CTRL-TXN-SCHEMA-01 · 纯函数性', () => {
  it('settleTransactions 调用前后入参 state 深比较不变', () => {
    const state = {
      queues: [
        txn({ item: 'a', status: 'active', total_minutes: 100, spent_minutes: 90, progress: 90 }),
        txn({ item: 'b', status: 'queued' }),
        txn({ item: 'c', status: 'queued', hold: true, base: 'beta' }),
      ],
      economy: { credits: 500 },
    };
    const snapshot = structuredClone(state);
    settleTransactions(state, 600, {
      orders: [{ item: 'c', verb: '恢复' }],
      effFor: () => 0.5,
      now: '第9天 12:00',
    });
    expect(state).toStrictEqual(snapshot);
  });

  it('applyDispatchOrders 调用前后入参 queues/orders 深比较不变', () => {
    const queues = [txn({ item: 'a', status: 'active' }), txn({ item: 'b', status: 'queued' })];
    const orders = [{ item: 'b', verb: '置顶' }];
    const queuesSnap = structuredClone(queues);
    const ordersSnap = structuredClone(orders);
    applyDispatchOrders(queues, orders);
    expect(queues).toStrictEqual(queuesSnap);
    expect(orders).toStrictEqual(ordersSnap);
  });

  it('settleTransactions 保留 state 其余域（非 queues 键原样透传）', () => {
    const state = { queues: [txn()], economy: { credits: 42 }, meta: { world_id: 'x' } };
    const { next } = settleTransactions(state, 100);
    expect(next.economy).toStrictEqual({ credits: 42 });
    expect(next.meta).toStrictEqual({ world_id: 'x' });
  });
});

/* ═══════════════ F7 回归 · 出生即 queued ＋ active 回检（CTRL-RSLOT 复跑前置） ═══════════════ */

describe('F7 · 升格门③′回检：既成 active 不再绕过 lane/tier 双重上限', () => {
  it('未开通槽（limit=0）的既成 active：降格 queued＋进度保留＋demoted 留痕，且本楼不再白嫖 Δt 积分', () => {
    const s = { queues: [txn({ type: '研究', item: '未开通研究', progress: 10, spent_minutes: 100 })] };
    const r = settleTransactions(s, 60, { parallelLimitFor: () => 0 });
    expect(r.next.queues[0].status).toBe('queued');
    expect(r.next.queues[0].progress).toBe(10);
    expect(r.next.queues[0].spent_minutes).toBe(100); // BUG-R2-07：limit<=0 时跳过步骤② Δt 积分，严禁失锚当楼白嫖进度
    const demotes = r.events.filter(e => e.type === 'demoted');
    expect(demotes).toHaveLength(1);
    expect(demotes[0].detail).toContain('gate_recheck');
    // 下一楼：已 queued 的事务不再积分，也不再重复降格
    const r2 = settleTransactions(r.next, 60, { parallelLimitFor: () => 0 });
    expect(r2.next.queues[0].spent_minutes).toBe(100); // 已 queued：limit=0 永不升格，不再积分
    expect(r2.events.filter(e => e.type === 'demoted')).toHaveLength(0);
  });

  it('同产线超编（limit=1）：数组序靠后的 active 降格，靠前者保留', () => {
    const s = { queues: [txn({ item: 'A' }), txn({ item: 'B' })] }; // 同 base+type → 同 lane
    const r = settleTransactions(s, 0, {});
    expect(r.next.queues.map(t => t.status)).toEqual(['active', 'queued']);
    expect(r.events.filter(e => e.type === 'demoted').map(e => e.item)).toEqual(['B']);
  });

  it('全局 type 上限超越产线独立时：第三台同 type 降格', () => {
    const s = {
      queues: [txn({ item: 'A', base: 'b1' }), txn({ item: 'B', base: 'b2' }), txn({ item: 'C', base: 'b3' })],
    };
    const r = settleTransactions(s, 0, { parallelLimitFor: () => 1, globalLimitFor: () => 2 });
    expect(r.next.queues.map(t => t.status)).toEqual(['active', 'active', 'queued']);
  });

  it('v1 语义零缺省变化：仅一条 active 且无超限时不产 demoted 事件（原有测试不受拉锯）', () => {
    const r = settleTransactions({ queues: [txn()] }, 100, {});
    expect(r.events.some(e => e.type === 'demoted')).toBe(false);
  });

  it('hold/queued/settling/done/cancelled 不被回检波及', () => {
    const s = {
      queues: [
        txn({ item: 'q', status: 'queued' }),
        txn({ item: 'h', status: 'queued', hold: true }),
        txn({ item: 's', status: 'settling' }),
        txn({ item: 'd', status: 'done' }),
        txn({ item: 'c', status: 'cancelled' }),
      ],
    };
    const r = settleTransactions(s, 60, { parallelLimitFor: () => 0 });
    expect(r.next.queues.map(t => t.status)).toEqual(['queued', 'queued', 'settling', 'done', 'cancelled']);
    expect(r.events.filter(e => e.type === 'demoted')).toHaveLength(0);
    // 但 limit=0 时 queued 不升格（既有语义保持）
    expect(r.events.filter(e => e.type === 'promoted')).toHaveLength(0);
  });

  it('G02-03：研究/改装队列在最后一分钟满工时但失去研发所/槽容量归零或超编时，回退 queued 保留进度而不转 settling；槽位正常在线时正常转 settling', () => {
    const lostSlotState = {
      queues: [
        txn({ type: '研究', item: '失锚研究', total_minutes: 1000, spent_minutes: 999, progress: 99.9 }),
        txn({ type: '改装', item: '失锚改装', total_minutes: 1000, spent_minutes: 999, progress: 99.9 }),
      ],
    };
    const rLost = settleTransactions(lostSlotState, 1, { parallelLimitFor: () => 0 });
    expect(rLost.next.queues.map(q => q.status)).toEqual(['queued', 'queued']);
    expect(rLost.next.queues.map(q => q.progress)).toEqual([99.9, 99.9]);
    expect(rLost.next.queues.map(q => q.spent_minutes)).toEqual([999, 999]);
    expect(rLost.events.filter(e => e.type === 'enter_settling')).toHaveLength(0);
    expect(rLost.events.filter(e => e.type === 'demoted' && e.detail.includes('gate_recheck'))).toHaveLength(2);

    // 槽位正常在线（limit=1）：满工时正常转 settling，且失锚恢复后升格并转 settling
    const onlineState = {
      queues: [
        txn({ type: '研究', item: '在线研究', total_minutes: 1000, spent_minutes: 999, progress: 99.9 }),
        txn({ type: '改装', item: '在线改装', total_minutes: 1000, spent_minutes: 999, progress: 99.9 }),
      ],
    };
    const rOnline = settleTransactions(onlineState, 1, { parallelLimitFor: () => 1 });
    expect(rOnline.next.queues.map(q => q.status)).toEqual(['settling', 'settling']);
    expect(rOnline.events.filter(e => e.type === 'enter_settling')).toHaveLength(2);
    expect(rOnline.events.filter(e => e.type === 'demoted')).toHaveLength(0);
  });
});

describe('F7 · 解析层出生即 queued（schema QueueItem.status 默认值保 active 不动旧档）', () => {
  it('schema 默认值仍是 active（v2 旧档兑底不改）', () => {
    expect(QueueItem.parse({ item: 'x', type: '研究', base: 'b', progress: 0, eta: '' }).status).toBe('active');
  });
});
