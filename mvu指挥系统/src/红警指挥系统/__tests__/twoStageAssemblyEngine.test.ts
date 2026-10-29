import { describe, expect, it } from 'vitest';
import { calculateOperation } from '../../中控悬浮窗/models/operationEngine';
import { settleTransactions, type TransactionItem } from '../engines/transactionEngine';
import {
  applyNaniteDeduction,
  makeTwoStageEffFor,
  MINUTES_PER_DAY,
  phase2Multiplier,
  phaseSplit,
  rawSpeedup,
  SATISFACTION_CAP,
  settleWithTwoStage,
  WEIGHT_SIMULATION,
  WEIGHT_TENSOR,
  type NanitesDeductedEvent,
  type TwoStageSpec,
} from '../engines/twoStageAssemblyEngine';

/* ═══════════════ 测试工具 ═══════════════ */

/** 造一条 v2 全字段事务（默认 active、工期 1000 分钟，风格对齐 transactionEngine.test.ts） */
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

/** 50/50 分界＋纳米需求 100 的标准装配数据块 */
const SPEC_5050_N100: TwoStageSpec = { t_mat: 500, t_asm: 500, req_nanites: 100 };

function nanitesEvents(events: { type: string }[]): NanitesDeductedEvent[] {
  return events.filter(e => e.type === 'nanites_deducted') as NanitesDeductedEvent[];
}

describe('CTRL-2STAGE-PROD-01 · 阶段分界 phaseSplit（Q1=B）', () => {
  it('按 t_mat/t_asm 比例：300/700 → phase1=0.3', () => {
    expect(phaseSplit({ t_mat: 300, t_asm: 700 })).toEqual({ phase1: 0.3, phase2: 0.7 });
  });

  it('缺声明/非法值退化 50/50（§3.8「从 50% 起跑」即等分特例）', () => {
    expect(phaseSplit(undefined)).toEqual({ phase1: 0.5, phase2: 0.5 });
    expect(phaseSplit({})).toEqual({ phase1: 0.5, phase2: 0.5 });
    expect(phaseSplit({ t_mat: 500 })).toEqual({ phase1: 0.5, phase2: 0.5 });
    expect(phaseSplit({ t_mat: 0, t_asm: 0 })).toEqual({ phase1: 0.5, phase2: 0.5 });
    expect(phaseSplit({ t_mat: -1, t_asm: 500 })).toEqual({ phase1: 0.5, phase2: 0.5 });
  });

  it('单侧为零合法：t_mat=0 → 全程组装（phase1=0）', () => {
    expect(phaseSplit({ t_mat: 0, t_asm: 1 })).toEqual({ phase1: 0, phase2: 1 });
  });
});

describe('CTRL-2STAGE-PROD-01 · 纳米抵扣（Q2=A · 验收一）', () => {
  it('足额（库存≥需求）→ 阶段一全跳：50/50 时从 50% 起跑，扣减事件金额=需求量', () => {
    const state = { queues: [txn()] };
    const { next, events } = settleWithTwoStage(state, 0, {
      assemblyFor: () => SPEC_5050_N100,
      nanitesFor: () => 200,
    });
    expect(next.queues[0].spent_minutes).toBe(500);
    expect(next.queues[0].progress).toBe(50);
    const deducted = nanitesEvents(events);
    expect(deducted).toHaveLength(1);
    expect(deducted[0]).toMatchObject({ item: '测试载具', base: 'alpha', amount: 100, skippedRatio: 1 });
  });

  it('足额＋非等分（t_mat=300/t_asm=700）→ 从 30% 起跑', () => {
    const { next } = settleWithTwoStage({ queues: [txn()] }, 0, {
      assemblyFor: () => ({ t_mat: 300, t_asm: 700, req_nanites: 100 }),
      nanitesFor: () => 100,
    });
    expect(next.queues[0].spent_minutes).toBe(300);
    expect(next.queues[0].progress).toBe(30);
  });

  it('不足 → 按比例抵扣：库存=需求 40% → 阶段一 40% 份额跳过，一次扣完现有库存', () => {
    const { next, events } = settleWithTwoStage({ queues: [txn()] }, 0, {
      assemblyFor: () => ({ t_mat: 400, t_asm: 600, req_nanites: 100 }),
      nanitesFor: () => 40,
    });
    // 阶段一份额 1000×0.4=400 分钟，跳过 40% = 160 分钟
    expect(next.queues[0].spent_minutes).toBe(160);
    expect(next.queues[0].progress).toBe(16);
    const deducted = nanitesEvents(events);
    expect(deducted).toHaveLength(1);
    expect(deducted[0].amount).toBe(40);
    expect(deducted[0].skippedRatio).toBe(0.4);
  });

  it('库存=0 → 零抵扣，全程正常耗时', () => {
    const { next, events } = settleWithTwoStage({ queues: [txn()] }, 250, {
      assemblyFor: () => SPEC_5050_N100,
      nanitesFor: () => 0,
    });
    expect(nanitesEvents(events)).toHaveLength(0);
    expect(next.queues[0].spent_minutes).toBe(250);
    expect(next.queues[0].progress).toBe(25);
  });

  it('库存 null（未探明）视为 0 可用：不抵扣、不报错（Null/0 状态机红线零摩擦）', () => {
    const { next, events } = settleWithTwoStage({ queues: [txn()] }, 250, {
      assemblyFor: () => SPEC_5050_N100,
      nanitesFor: () => null,
    });
    expect(nanitesEvents(events)).toHaveLength(0);
    expect(next.queues[0].spent_minutes).toBe(250);
  });

  it('🔴 已有进度事务不重复抵扣（一次判定窗口随进度永久关闭）', () => {
    const first = settleWithTwoStage({ queues: [txn()] }, 0, {
      assemblyFor: () => SPEC_5050_N100,
      nanitesFor: () => 200,
    });
    expect(nanitesEvents(first.events)).toHaveLength(1);
    // 同一策略再结算（库存仍充足）：不得二次注入
    const second = settleWithTwoStage(first.next, 100, {
      assemblyFor: () => SPEC_5050_N100,
      nanitesFor: () => 200,
    });
    expect(nanitesEvents(second.events)).toHaveLength(0);
    expect(second.next.queues[0].spent_minutes).toBe(600); // 500 注入 + 100 Δt
  });

  it('条目无 req_nanites 声明 → 不吃抵扣', () => {
    const { next, events } = settleWithTwoStage({ queues: [txn()] }, 0, {
      assemblyFor: () => ({ t_mat: 500, t_asm: 500 }),
      nanitesFor: () => 9999,
    });
    expect(nanitesEvents(events)).toHaveLength(0);
    expect(next.queues[0].spent_minutes).toBe(0);
  });

  it('升格楼抵扣：queued 事务经带宽门升格当楼即判定（本楼不吃 Δt，注入份额为下楼起点）', () => {
    const state = { queues: [txn({ status: 'queued' })] };
    const { next, events } = settleWithTwoStage(state, 100, {
      assemblyFor: () => SPEC_5050_N100,
      nanitesFor: () => 100,
    });
    expect(next.queues[0].status).toBe('active');
    // 升格发生在积分之后：本楼 Δt 不参与，spent = 纯注入份额 500
    expect(next.queues[0].spent_minutes).toBe(500);
    expect(nanitesEvents(events)).toHaveLength(1);
    // 下楼正常从阶段二积分
    const after = settleWithTwoStage(next, 100, {
      assemblyFor: () => SPEC_5050_N100,
      nanitesFor: () => 100,
    });
    expect(nanitesEvents(after.events)).toHaveLength(0);
    expect(after.next.queues[0].spent_minutes).toBe(600);
  });

  it('applyNaniteDeduction 纯函数：未触发返回原引用；触发不改入参', () => {
    const base = txn();
    const untouched = applyNaniteDeduction(base, undefined, 100);
    expect(untouched.txn).toBe(base);
    const snapshot = structuredClone(base);
    const triggered = applyNaniteDeduction(base, SPEC_5050_N100, 100);
    expect(base).toStrictEqual(snapshot);
    expect(triggered.txn).not.toBe(base);
    expect(triggered.txn.spent_minutes).toBe(500);
  });
});

describe('CTRL-2STAGE-PROD-01 · 双算力加权（Q3=B · 验收二）', () => {
  it('研究类偏物理仿真 w=0.7/0.3：F 满足、T 半足 → 1+0.7·1+0.3·0.5=1.85', () => {
    expect(WEIGHT_SIMULATION).toEqual({ tflops: 0.7, tops: 0.3 });
    const speedup = rawSpeedup('研究', { tflops: 100, tops: 100 }, { tflops: 100, tops: 50 });
    expect(speedup).toBeCloseTo(1.85, 10);
  });

  it('生产类偏张量控制 w=0.3/0.7：同满足度 → 1+0.3·1+0.7·0.5=1.65', () => {
    expect(WEIGHT_TENSOR).toEqual({ tflops: 0.3, tops: 0.7 });
    const speedup = rawSpeedup('生产', { tflops: 100, tops: 100 }, { tflops: 100, tops: 50 });
    expect(speedup).toBeCloseTo(1.65, 10);
  });

  it('建造走仿真权重、改装走张量权重', () => {
    const spec = { tflops: 100, tops: 100 };
    const budget = { tflops: 100, tops: 0 };
    expect(rawSpeedup('建造', spec, budget)).toBeCloseTo(1.7, 10);
    expect(rawSpeedup('改装', spec, budget)).toBeCloseTo(1.3, 10);
  });

  it('D25：工程投影项沿用改装档张量权重（驾驶员 2026-10-10 授权一行派发）', () => {
    const spec = { tflops: 100, tops: 100 };
    const budgetF = { tflops: 100, tops: 0 };
    const budgetT = { tflops: 0, tops: 100 };
    // 单轨 F 满足：1+0.3 = 1.3；单轨 T 满足：1+0.7 = 1.7（与改装同档）
    expect(rawSpeedup('工程', spec, budgetF)).toBeCloseTo(1.3, 10);
    expect(rawSpeedup('工程', spec, budgetT)).toBeCloseTo(1.7, 10);
  });

  it('满足度封顶 cap=1：超配 100 倍不超加速（上界 = 1+w_f+w_t = 2）', () => {
    expect(SATISFACTION_CAP).toBe(1);
    const capped = rawSpeedup('研究', { tflops: 100, tops: 100 }, { tflops: 10000, tops: 10000 });
    expect(capped).toBeCloseTo(2, 10);
  });

  it('未声明算力需求 → 恒 1（不吃算力加速）', () => {
    expect(rawSpeedup('生产', {}, { tflops: 9999, tops: 9999 })).toBe(1);
    expect(rawSpeedup('生产', undefined, { tflops: 9999, tops: 9999 })).toBe(1);
    expect(rawSpeedup('生产', { tflops: 0, tops: -5 }, { tflops: 9999, tops: 9999 })).toBe(1);
  });

  it('单轨声明只吃单轨：仅 tflops 需求时 tops 预算不参与', () => {
    expect(rawSpeedup('研究', { tflops: 100 }, { tflops: 100, tops: 9999 })).toBeCloseTo(1.7, 10);
  });

  it('加速只作用于阶段二：阶段一 eff 恒为基础工况（配料不吃算力）', () => {
    const effFor = makeTwoStageEffFor({
      assemblyFor: () => ({ t_mat: 500, t_asm: 500, tflops: 10, tops: 10 }),
      computeFor: () => ({ tflops: 10000, tops: 10000 }),
    });
    expect(effFor(txn({ spent_minutes: 0 }))).toBe(1); // 阶段一
    expect(effFor(txn({ spent_minutes: 499 }))).toBe(1); // 阶段一末端
    expect(effFor(txn({ spent_minutes: 500 }))).toBeCloseTo(2, 10); // 阶段二起点（生产权重满配）
  });
});

describe('CTRL-2STAGE-PROD-01 · min_days_lock 锁死（验收三 · 🔴）', () => {
  it('算力拉满时阶段二乘子被钳制：phase2=720 分钟、锁 2 日 → 乘子 0.25（墙钟恰 2 日）', () => {
    const locked = txn({ total_minutes: 1440, min_days_lock: 2 });
    const spec = { t_mat: 500, t_asm: 500, tflops: 1, tops: 1 };
    const multiplier = phase2Multiplier(locked, spec, { tflops: 1e12, tops: 1e12 });
    expect(multiplier).toBe(720 / (2 * MINUTES_PER_DAY)); // = 0.25
  });

  it('结算全程仿真：锁 2 日 + 无限算力，完工墙钟天数仍 ≥ min_days_lock', () => {
    // 全组装条目（phase1=0），标称 1 日工期、锁 2 日 → 乘子 = 1440/2880 = 0.5
    const options = {
      assemblyFor: () => ({ t_mat: 0, t_asm: 1, tflops: 1, tops: 1 }),
      computeFor: () => ({ tflops: 1e12, tops: 1e12 }),
    };
    let state: { queues: TransactionItem[] } = {
      queues: [txn({ total_minutes: 1440, min_days_lock: 2 })],
    };
    let minutesElapsed = 0;
    // 每楼推进 1 日
    for (let floor = 0; floor < 4 && state.queues[0].status === 'active'; floor++) {
      state = settleWithTwoStage(state, MINUTES_PER_DAY, options).next;
      minutesElapsed += MINUTES_PER_DAY;
    }
    expect(state.queues[0].status).toBe('settling');
    expect(minutesElapsed / MINUTES_PER_DAY).toBeGreaterThanOrEqual(2);
    // 精确：第 1 日末进度 50%（乘子 0.5），第 2 日末满
    const oneDay = settleWithTwoStage(
      { queues: [txn({ total_minutes: 1440, min_days_lock: 2 })] },
      MINUTES_PER_DAY,
      options,
    );
    expect(oneDay.next.queues[0].progress).toBe(50);
  });

  it('min_days_lock=0 不钳制；锁短于标称工期不生效（min 语义只防更快）', () => {
    const spec = { t_mat: 0, t_asm: 1, tflops: 1, tops: 1 };
    const budget = { tflops: 1e12, tops: 1e12 };
    expect(phase2Multiplier(txn({ total_minutes: 1440, min_days_lock: 0 }), spec, budget)).toBeCloseTo(2, 10);
    // phase2=14400 分钟（10 日），锁 1 日 → cap=10 不约束 raw=2
    expect(phase2Multiplier(txn({ total_minutes: 14400, min_days_lock: 1 }), spec, budget)).toBeCloseTo(2, 10);
  });

  it('阶段二标称工期短于锁值且无算力 → 乘子 <1 强制减速（§3.8 max(T_min,·) 语义）', () => {
    // 无算力需求声明：raw=1；phase2=720、锁 1 日=1440 → 乘子 0.5
    const multiplier = phase2Multiplier(
      txn({ total_minutes: 1440, min_days_lock: 1 }),
      { t_mat: 500, t_asm: 500 },
      { tflops: 0, tops: 0 },
    );
    expect(multiplier).toBe(0.5);
  });
});

describe('研究路径 · min_days_lock 总工期地板（09 工期约定 · 2026-10-09 裁决 A）', () => {
  const resTxn = (o: Partial<TransactionItem>) => txn({ type: '研究', item: 'X工学', ...o });
  const rspec = { tflops: 100 }; // workload 派生 spec（无 t_mat/t_asm → 50/50 分段）
  const full = { tflops: 1e12, tops: 1e12 };
  // total 10 日=14400：phase1=7200，phase2=7200，raw=1.7（研究权重满配）

  it('lock ≤ 阶段一标称 → 永不钳制：满配 ×1.7 原样生效', () => {
    expect(phase2Multiplier(resTxn({ total_minutes: 14400, min_days_lock: 4 }), rspec, full)).toBeCloseTo(1.7, 10);
  });

  it('lock 落在阶段二区间内 → 部分钳制：lock 9 日 → cap=7200/(12960−7200)=1.25', () => {
    expect(phase2Multiplier(resTxn({ total_minutes: 14400, min_days_lock: 9 }), rspec, full)).toBeCloseTo(1.25, 10);
  });

  it('lock = 总工期（eta=min_days 红规边界）→ 封顶 1：不加速也不减速（旧语义会误减速至 0.5）', () => {
    expect(phase2Multiplier(resTxn({ total_minutes: 14400, min_days_lock: 10 }), rspec, full)).toBe(1);
    expect(phase2Multiplier(resTxn({ total_minutes: 14400, min_days_lock: 10 }), rspec, { tflops: 0, tops: 0 })).toBe(1);
  });

  it('生产路径回归：§3.8 阶段二地板不变（lock 2 日、phase2=720 → 0.25）', () => {
    expect(
      phase2Multiplier(txn({ total_minutes: 1440, min_days_lock: 2 }), { t_mat: 500, t_asm: 500, tflops: 1, tops: 1 }, full),
    ).toBe(0.25);
  });
});

describe('CTRL-2STAGE-PROD-01 · 工况正交叠乘与引擎恒等', () => {
  it('与基础 effFor（工况 0.2）叠乘正交：阶段二 eff = 0.2×2 = 0.4；阶段一 = 0.2', () => {
    const options = {
      effFor: () => 0.2,
      assemblyFor: () => ({ t_mat: 500, t_asm: 500, tflops: 10, tops: 10 }),
      computeFor: () => ({ tflops: 1e6, tops: 1e6 }),
    };
    const phase2 = settleWithTwoStage({ queues: [txn({ spent_minutes: 500, progress: 50 })] }, 100, options);
    expect(phase2.next.queues[0].spent_minutes).toBeCloseTo(540, 10);
    const phase1 = settleWithTwoStage({ queues: [txn({ spent_minutes: 100, progress: 10 })] }, 100, options);
    expect(phase1.next.queues[0].spent_minutes).toBeCloseTo(120, 10);
  });

  it('operationEngine 真实回环：低电 degraded efficiency=0.2 作为基础工况注入（先例对齐）', () => {
    const evaluation = calculateOperation(
      { conditions: [{ trigger: 'low_power', behavior: 'degraded', efficiency: 0.2, desc: '低电降频' }] },
      { is_low_power: true },
      {},
    );
    expect(evaluation.efficiency).toBe(0.2);
    const { next } = settleWithTwoStage({ queues: [txn({ spent_minutes: 500, progress: 50 })] }, 100, {
      effFor: () => evaluation.efficiency,
      assemblyFor: () => ({ t_mat: 500, t_asm: 500, tflops: 10, tops: 10 }),
      computeFor: () => ({ tflops: 1e6, tops: 1e6 }),
    });
    expect(next.queues[0].spent_minutes).toBeCloseTo(540, 10);
  });

  it('🔴 不注入策略回调时与裸 settleTransactions 逐字段恒等（含事件流水）', () => {
    const state = {
      queues: [
        txn({ item: 'a', status: 'active', total_minutes: 100, spent_minutes: 90, progress: 90 }),
        txn({ item: 'b', status: 'queued' }),
        txn({ item: 'c', status: 'queued', hold: true, base: 'beta' }),
        txn({ item: 'd', total_minutes: 5000, qty: 5, spent_minutes: 900, progress: 18 }),
        txn({ item: 'e', total_minutes: 0 }),
      ],
      economy: { credits: 500 },
    };
    const options = {
      orders: [{ item: 'c', verb: '恢复' }],
      effFor: () => 0.5,
      now: '第9天 12:00',
    };
    const bare = settleTransactions(structuredClone(state), 600, options);
    const wrapped = settleWithTwoStage(structuredClone(state), 600, options);
    expect(wrapped.next).toStrictEqual(bare.next);
    expect(wrapped.events).toStrictEqual(bare.events);
  });

  it('引擎零接缝佐证：策略仅经既有 options.effFor 通道生效，调度令/升格门语义原样', () => {
    // 置顶抢占在策略包装下语义不变（进度保留）
    const state = {
      queues: [
        txn({ item: '磁暴步兵', status: 'active', progress: 40, spent_minutes: 400 }),
        txn({ item: '天启坦克', status: 'queued' }),
      ],
    };
    const { next } = settleWithTwoStage(state, 0, { orders: [{ item: '天启坦克', verb: '置顶' }] });
    const trooper = next.queues.find(q => q.item === '磁暴步兵')!;
    expect(trooper.status).toBe('queued');
    expect(trooper.progress).toBe(40);
    expect(trooper.spent_minutes).toBe(400);
  });
});

describe('CTRL-2STAGE-PROD-01 · 纯函数性', () => {
  it('settleWithTwoStage 调用前后入参 state 深比较不变（含抵扣触发场景）', () => {
    const state = {
      queues: [txn(), txn({ item: '排队者', status: 'queued', base: 'beta' })],
      economy: { credits: 42 },
    };
    const snapshot = structuredClone(state);
    settleWithTwoStage(state, 300, {
      assemblyFor: () => SPEC_5050_N100,
      nanitesFor: () => 200,
      computeFor: () => ({ tflops: 100, tops: 100 }),
    });
    expect(state).toStrictEqual(snapshot);
  });

  it('state 其余域原样透传', () => {
    const state = { queues: [txn()], economy: { credits: 42 }, meta: { world_id: 'x' } };
    const { next } = settleWithTwoStage(state, 100, {
      assemblyFor: () => SPEC_5050_N100,
      nanitesFor: () => 100,
    });
    expect(next.economy).toStrictEqual({ credits: 42 });
    expect(next.meta).toStrictEqual({ world_id: 'x' });
  });

  it('FIX-P1-01（REPRO_4）：多台批次纳米跳段仅缩短阶段一备料工时，备料期与刚进组装期不虚增 qty_done', () => {
    const batch = txn({
      item: '犀牛主战坦克',
      qty: 4,
      qty_done: 0,
      total_minutes: 5760,
      spent_minutes: 0,
      progress: 0,
    });
    const spec: TwoStageSpec = { t_mat: 12, t_asm: 12, req_nanites: 200 };
    // 足额跳过阶段一（2880 分钟）+ 推进 1 分钟组装：组装进度仅 1/720 台，qty_done 必须为 0 而非 2
    const after1Min = settleWithTwoStage({ queues: [batch] }, 1, {
      assemblyFor: () => spec,
      nanitesFor: () => 200,
    });
    expect(after1Min.next.queues[0].spent_minutes).toBe(2881);
    expect(after1Min.next.queues[0].qty_done).toBe(0);

    // 再推进 720 分钟组装（累计组装 721 分钟 >= 单台组装 720 分钟）：下线第 1 台
    const after721Min = settleWithTwoStage(after1Min.next, 720, {
      assemblyFor: () => spec,
      nanitesFor: () => 0,
    });
    expect(after721Min.next.queues[0].qty_done).toBe(1);
  });

  it('G01-04：置顶/置底/暂缓重排下不同 qty_done 批次各自完成量连续，不因原位置高完成量任务拔高', () => {
    const spec: TwoStageSpec = { t_mat: 500, t_asm: 500, req_nanites: 100 };
    const highDone = txn({
      item: '高完成量批次',
      qty: 4,
      qty_done: 3,
      total_minutes: 1000,
      spent_minutes: 900,
      progress: 90,
    });
    const lowDone = txn({
      item: '刚入组装批次',
      qty: 4,
      qty_done: 0,
      total_minutes: 1000,
      spent_minutes: 500,
      progress: 50,
    });

    // B 置顶到索引 0 并推进 1 分钟：裸算 floor(501/250)=2，但组装仅 1/125 台，qty_done 必须保持 0（绝不串读旧索引 0 的 3）
    const promoted = settleWithTwoStage(
      { queues: [highDone, lowDone] },
      1,
      {
        assemblyFor: () => spec,
        parallelLimitFor: () => 2,
        orders: [{ item: '刚入组装批次', verb: '置顶' }],
      },
    );
    expect(promoted.next.queues.map(q => [q.item, q.qty_done])).toEqual([
      ['刚入组装批次', 0],
      ['高完成量批次', 3],
    ]);
    expect(promoted.events.filter(e => e.type === 'qty_progress')).toEqual([]);

    // A 置底 / 暂缓退回 queued 后，B 位于索引 0 推进 1 分钟仍保持 0，A 保留 3
    const demoted = settleWithTwoStage(
      { queues: [highDone, lowDone] },
      1,
      {
        assemblyFor: () => spec,
        parallelLimitFor: () => 2,
        orders: [
          { item: '高完成量批次', verb: '暂缓' },
          { item: '高完成量批次', verb: '置底' },
        ],
      },
    );
    expect(demoted.next.queues.map(q => [q.item, q.status, q.qty_done])).toEqual([
      ['刚入组装批次', 'active', 0],
      ['高完成量批次', 'queued', 3],
    ]);
  });

  it('G01-04：跨基地同名批次与同基地多批次不互串 qty_done 或谎报 qty_progress', () => {
    const spec: TwoStageSpec = { t_mat: 500, t_asm: 500, req_nanites: 100 };
    // 1. 跨基地同名：alpha 基地已完成 3 台，beta 基地刚进组装 1 分钟，置顶/推进互不串味
    const crossBase = settleWithTwoStage(
      {
        queues: [
          txn({ item: '犀牛主战坦克', base: 'alpha', qty: 4, qty_done: 3, total_minutes: 1000, spent_minutes: 900, progress: 90 }),
          txn({ item: '犀牛主战坦克', base: 'beta', qty: 4, qty_done: 0, total_minutes: 1000, spent_minutes: 500, progress: 50 }),
        ],
      },
      1,
      {
        assemblyFor: () => spec,
        orders: [{ item: '犀牛主战坦克', base: 'beta', verb: '置顶' }],
      },
    );
    expect(crossBase.next.queues.map(q => [q.base, q.qty_done])).toEqual([
      ['alpha', 3],
      ['beta', 0],
    ]);

    // 2. 同基地同名两批次（第 1 批已 settling/hold 保留 qty_done=3，第 2 批 active 刚过裸 750 分钟边界但组装仅 250/500 即 2 台）：
    //    第 2 批推进 1 分钟从 749->750 时组装为 250 分钟恰完成第 2 台，事件必须报 2/4 而非串读第 1 批的 3/4；
    //    随后从 750->751（不跨裸边界）与从 625->750 前已下线 1 台再跨裸 750 但未满第 2 台时不谎报事件
    const sameBase = settleWithTwoStage(
      {
        queues: [
          txn({ item: '犀牛主战坦克', base: 'alpha', status: 'queued', hold: true, qty: 4, qty_done: 3, total_minutes: 1000, spent_minutes: 900, progress: 90 }),
          txn({ item: '犀牛主战坦克', base: 'alpha', status: 'active', qty: 4, qty_done: 1, total_minutes: 1000, spent_minutes: 749, progress: 74.9 }),
        ],
      },
      1,
      { assemblyFor: () => spec },
    );
    expect(sameBase.next.queues[0].qty_done).toBe(3);
    expect(sameBase.next.queues[1].qty_done).toBe(2);
    expect(sameBase.events.filter(e => e.type === 'qty_progress')).toEqual([
      { type: 'qty_progress', item: '犀牛主战坦克', base: 'alpha', detail: '批次流水 2/4' },
    ]);
  });

  it('G01-05：从阶段一单次长 Δt 跨越阶段分界点时，与在分界点拆成两段结算的 spent_minutes/progress/status/qty_done 完全一致', () => {
    // 1. 算力加速跨界（phase1=500, phase2=500, 阶段二 2x 加速）：从 spent=300 一次推进 Δt=300
    //    前 200 分钟走阶段一 (eff=1 -> +200 至 500)，后 100 分钟走阶段二 (eff=2 -> +200 至 700, progress=70)
    const accelOpts = {
      assemblyFor: () => ({ t_mat: 500, t_asm: 500, tflops: 10, tops: 10 }),
      computeFor: () => ({ tflops: 10, tops: 10 }),
    };
    const startTxn = txn({ total_minutes: 1000, spent_minutes: 300, progress: 30 });
    const oneShotAccel = settleWithTwoStage({ queues: [startTxn] }, 300, accelOpts);
    const step1Accel = settleWithTwoStage({ queues: [startTxn] }, 200, accelOpts);
    const step2Accel = settleWithTwoStage(step1Accel.next, 100, accelOpts);
    expect(oneShotAccel.next.queues[0].spent_minutes).toBeCloseTo(700, 9);
    expect(oneShotAccel.next.queues[0]).toEqual(step2Accel.next.queues[0]);

    // 2. min_days_lock 减速地板跨界（total=1440, 50/50 -> phase1=720, phase2=720, min_days_lock=2 -> 阶段二乘子 0.25）：
    //    从 spent=0 一次推进 Δt=1440：前 720 分钟走完阶段一 (+720)，后 720 分钟按 0.25 走阶段二 (+180)，
    //    累计 spent=900, progress=62.5%，绝不能按起点阶段一 eff=1 直接冲满 1440 进 settling
    const lockOpts = {
      assemblyFor: () => ({ t_mat: 500, t_asm: 500, tflops: 1, tops: 1 }),
      computeFor: () => ({ tflops: 100, tops: 100 }),
    };
    const lockTxn = txn({ total_minutes: 1440, min_days_lock: 2, spent_minutes: 0, progress: 0 });
    const oneShotLock = settleWithTwoStage({ queues: [lockTxn] }, 1440, lockOpts);
    const lockStep1 = settleWithTwoStage({ queues: [lockTxn] }, 720, lockOpts);
    const lockStep2 = settleWithTwoStage(lockStep1.next, 720, lockOpts);
    expect(oneShotLock.next.queues[0].spent_minutes).toBeCloseTo(900, 9);
    expect(oneShotLock.next.queues[0].progress).toBeCloseTo(62.5, 9);
    expect(oneShotLock.next.queues[0].status).toBe('active');
    expect(oneShotLock.next.queues[0]).toEqual(lockStep2.next.queues[0]);

    // 3. 部分纳米抵扣 + 多台批次跨界（qty=4, total=1000, phase1=500, phase2=500, req_nanites=100, 库存=60 -> 跳至 300）：
    //    同楼再推进 Δt=270、阶段二 2x 加速：前 200 分钟走完备料至 500，后 70 分钟组装推进 140 分钟 (>= 单台组装 125 分钟 -> qty_done=1)
    const batchOpts = {
      assemblyFor: () => ({ t_mat: 500, t_asm: 500, req_nanites: 100, tflops: 10, tops: 10 }),
      nanitesFor: () => 60,
      computeFor: () => ({ tflops: 10, tops: 10 }),
    };
    const batchStart = txn({ qty: 4, qty_done: 0, total_minutes: 1000, spent_minutes: 0, progress: 0 });
    const oneShotBatch = settleWithTwoStage({ queues: [batchStart] }, 270, batchOpts);
    const batchStep1 = settleWithTwoStage({ queues: [batchStart] }, 200, batchOpts);
    const batchStep2 = settleWithTwoStage(batchStep1.next, 70, { ...batchOpts, nanitesFor: () => 0 });
    expect(oneShotBatch.next.queues[0].spent_minutes).toBeCloseTo(640, 9);
    expect(oneShotBatch.next.queues[0].qty_done).toBe(1);
    expect(oneShotBatch.next.queues[0]).toEqual(batchStep2.next.queues[0]);
  });
});

