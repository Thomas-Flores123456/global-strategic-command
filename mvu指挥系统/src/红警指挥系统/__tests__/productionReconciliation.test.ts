import { describe, expect, it } from 'vitest';
import type { OperationCompletion } from '../parse/parsePipeline';
import { settleTransactions, type TransactionItem } from '../engines/transactionEngine';
import {
  AUTO_ADVANCE_TOLERANCE_MINUTES,
  autoAdvanceDeltaFor,
  buildItemCategoriesFromCatalog,
  forceCommission,
  operationCompletionsToDeclarations,
  parseProductionDeclarations,
  reconcileEventToIssue,
  reconcileEventToParseEvent,
  reconcileProduction,
  type ProductionParseResult,
  type ReconcileBaseLike,
  type ReconcileStateShape,
  type VerdictRecord,
} from '../engines/productionReconciliation';

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

interface TestState extends ReconcileStateShape {
  forces?: { troops: Record<string, number>; vehicles: string[] };
}

function stateWith(queues: TransactionItem[], extra: Partial<TestState> = {}): TestState {
  return { queues, ...extra };
}

const BASES: ReconcileBaseLike[] = [{ id: 'b1', name: '青岚基地', buildings: [{ name: '战车工厂', state: '建造中' }] }];

function noDecl(): ProductionParseResult {
  return { found: false, declarations: [], rejected: [] };
}

function declsOf(raw: string): ProductionParseResult {
  const parsed = parseProductionDeclarations(raw);
  expect(parsed.found).toBe(true);
  expect(parsed.rejected).toEqual([]);
  return parsed;
}

/* ═══════════════ ① <生产> 声明块解析 ═══════════════ */

describe('CTRL-RECONCILE-01 · ① parseProductionDeclarations', () => {
  it('标准夹具格式（timePastParser 既有夹具同源）：- 犀牛主战坦克: 1台', () => {
    const r = parseProductionDeclarations('<生产>\n- 犀牛主战坦克: 1台\n</生产>');
    expect(r.found).toBe(true);
    expect(r.rejected).toEqual([]);
    expect(r.declarations).toEqual([{ item: '犀牛主战坦克', qty: 1, raw: '- 犀牛主战坦克: 1台' }]);
  });

  it('全角冒号＋量词容忍：- 天启坦克：2辆', () => {
    const r = parseProductionDeclarations('<生产>\n- 天启坦克：2辆\n</生产>');
    expect(r.declarations).toEqual([{ item: '天启坦克', qty: 2, raw: '- 天启坦克：2辆' }]);
  });

  it('多行与多个 <生产> 块全部解析', () => {
    const raw = '<生产>\n- 犀牛主战坦克: 1台\n- 磁暴步兵: 5个\n</生产>\n叙述……\n<生产>\n- 天启坦克: 2辆\n</生产>';
    const r = parseProductionDeclarations(raw);
    expect(r.declarations.map(d => `${d.item}x${d.qty}`)).toEqual(['犀牛主战坦克x1', '磁暴步兵x5', '天启坦克x2']);
  });

  it('缩进 基地/类型 消歧行挂到上一声明', () => {
    const raw = '<生产>\n- 犀牛主战坦克: 1台\n  基地: 青岚基地\n  类型: 生产\n</生产>';
    const r = parseProductionDeclarations(raw);
    expect(r.declarations).toEqual([
      { item: '犀牛主战坦克', qty: 1, base: '青岚基地', type: '生产', raw: '- 犀牛主战坦克: 1台' },
    ]);
  });

  it('无冒号畸行进 rejected（malformed_line），不静默丢弃', () => {
    const r = parseProductionDeclarations('<生产>\n- 犀牛主战坦克 一台\n</生产>');
    expect(r.declarations).toEqual([]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toBe('malformed_line');
  });

  it('数量非法进 rejected（invalid_qty）：0 与小数', () => {
    const r = parseProductionDeclarations('<生产>\n- 犀牛: 0台\n- 天启: 2.5辆\n</生产>');
    expect(r.declarations).toEqual([]);
    expect(r.rejected.map(x => x.reason)).toEqual(['invalid_qty', 'invalid_qty']);
  });

  it('无 <生产> 块 → found=false 空结果（门零成本跳过口径）', () => {
    const r = parseProductionDeclarations('纯叙述正文，没有任何标签。');
    expect(r).toEqual({ found: false, declarations: [], rejected: [] });
  });

  it('非字符串输入安全返回空结果', () => {
    expect(parseProductionDeclarations(null)).toEqual({ found: false, declarations: [], rejected: [] });
    expect(parseProductionDeclarations(undefined)).toEqual({ found: false, declarations: [], rejected: [] });
    expect(parseProductionDeclarations(42)).toEqual({ found: false, declarations: [], rejected: [] });
  });
});

/* ═══════════════ ② 前馈工程日程生成 → 已随 buildScheduleText 迁至 scheduleText.test.ts ═══════════════
   （CTRL-RECONCILE-01 标准①：§4.1.1 两级分组条令体改版，原 7 例逐例改写对照见任务回执） */

/* ═══════════════ ③ 三色裁决门 ═══════════════ */

describe('CTRL-RECONCILE-01 · ③ 三色裁决门 · MATCH', () => {
  it('settling qty=1 声明吻合 → done，事件 reconcile_match，裁决 claimed=1', () => {
    const state = stateWith([
      txn({ item: '犀牛主战坦克', status: 'settling', progress: 100, spent_minutes: 1000, qty_done: 1 }),
    ]);
    const rec = reconcileProduction(state, declsOf('<生产>\n- 犀牛主战坦克: 1台\n</生产>'));
    const out = rec.next.queues[0];
    expect(out.status).toBe('done');
    expect(out.qty_done).toBe(1);
    expect(rec.events).toHaveLength(1);
    expect(rec.events[0].type).toBe('reconcile_match');
    expect(rec.events[0].level).toBe('info');
    expect(rec.verdicts[0]).toMatchObject({ verdict: 'MATCH', claimedQty: 1, remainderQty: 0 });
  });

  it('MATCH 研究 → tech.done 入账；重复声明 canon 幂等不重复入', () => {
    const research = txn({
      type: '研究',
      item: '装甲载具工学',
      status: 'settling',
      progress: 100,
      spent_minutes: 1000,
    });
    const state = stateWith([research], { tech: { done: [] } });
    const parsed = declsOf('<生产>\n- 装甲载具工学: 1项\n</生产>');
    const rec = reconcileProduction(state, parsed);
    expect(rec.next.queues[0].status).toBe('done');
    expect(rec.next.tech?.done).toEqual(['装甲载具工学']);
    // 二次对账（重解析口径）：命中 done → NOOP，tech.done 不重复
    const rec2 = reconcileProduction(rec.next, parsed);
    expect(rec2.next.tech?.done).toEqual(['装甲载具工学']);
    expect(rec2.events[0].type).toBe('reconcile_noop');
    expect(rec2.verdicts[0].verdict).toBe('NOOP');
  });

  it('MATCH 建造 → 目标基地建筑 state=运转；入参 bases 零突变', () => {
    const build = txn({
      type: '建造',
      item: '战车工厂',
      base: 'b1',
      status: 'settling',
      progress: 100,
      spent_minutes: 1000,
    });
    const bases = structuredClone(BASES);
    const state = stateWith([build], { bases });
    const rec = reconcileProduction(state, declsOf('<生产>\n- 战车工厂: 1座\n</生产>'));
    expect(rec.next.queues[0].status).toBe('done');
    expect(rec.next.bases?.[0].buildings?.[0].state).toBe('运转');
    expect(rec.events[0].detail).toContain('目标基地建筑运转');
    // 结构共享纪律：原 bases 引用链零突变
    expect(bases[0].buildings?.[0].state).toBe('建造中');
  });

  it('MATCH 生产 → 不推断单位分类：forces 引用零触碰（🔴 红线2）', () => {
    const forces = { troops: { 步兵: 10 }, vehicles: ['旧车'] };
    const state = stateWith(
      [txn({ item: '犀牛主战坦克', status: 'settling', progress: 100, spent_minutes: 1000, qty_done: 1 })],
      { forces },
    );
    const rec = reconcileProduction(state, declsOf('<生产>\n- 犀牛主战坦克: 1台\n</生产>'));
    expect(rec.next.forces).toBe(forces);
    expect(rec.events[0].detail).toContain('不推断单位分类');
  });

  it('MATCH 建造但建筑不唯一 → 事务照 done，事件升 warn 备注降级', () => {
    const dupBases: ReconcileBaseLike[] = [
      { id: 'b1', name: '青岚基地', buildings: [{ name: '战车工厂' }, { name: '战车工厂' }] },
    ];
    const build = txn({
      type: '建造',
      item: '战车工厂',
      base: 'b1',
      status: 'settling',
      progress: 100,
      spent_minutes: 1000,
    });
    const rec = reconcileProduction(
      stateWith([build], { bases: dupBases }),
      declsOf('<生产>\n- 战车工厂: 1座\n</生产>'),
    );
    expect(rec.next.queues[0].status).toBe('done');
    expect(rec.events[0].level).toBe('warn');
    expect(rec.events[0].detail).toContain('不唯一');
    expect(rec.next.bases?.[0].buildings?.every(b => b.state !== '运转')).toBe(true);
  });
});

describe('CTRL-RECONCILE-01 · ③ 三色裁决门 · UNDERRUN', () => {
  it('settling 批次 3/5（FIX-P1-01 / REPRO_3）：按余量比例保留剩余工时与进度，原位更新 qty=2 退回 active，不拆双同名记录', () => {
    const q = txn({
      item: '犀牛主战坦克',
      status: 'settling',
      total_minutes: 1000,
      spent_minutes: 1000,
      progress: 100,
      qty: 5,
      qty_done: 5,
    });
    const rec = reconcileProduction(stateWith([q]), declsOf('<生产>\n- 犀牛主战坦克: 3台\n</生产>'));
    expect(rec.next.queues).toHaveLength(1);
    // 余量原位保留剩余进度与工时（remainingRatio = 2/5 = 0.4），不再归零重造或拆出冲突记录
    expect(rec.next.queues[0]).toMatchObject({
      status: 'active',
      qty: 2,
      qty_done: 2,
      total_minutes: 400,
      spent_minutes: 400,
      progress: 40,
    });
    expect(rec.events[0].type).toBe('reconcile_underrun');
    expect(rec.verdicts[0]).toMatchObject({ verdict: 'UNDERRUN', claimedQty: 3, remainderQty: 2 });
  });

  it('active 批次认领已下线（qty_done=2 声明 2）：拆分后续跑，账目一致', () => {
    const q = txn({ item: '犀牛主战坦克', total_minutes: 1000, spent_minutes: 450, progress: 45, qty: 5, qty_done: 2 });
    const rec = reconcileProduction(stateWith([q]), declsOf('<生产>\n- 犀牛主战坦克: 2台\n</生产>'));
    expect(rec.next.queues).toHaveLength(2);
    expect(rec.next.queues[0]).toMatchObject({
      status: 'active',
      qty: 3,
      qty_done: 0,
      total_minutes: 600,
      spent_minutes: 50,
    });
    expect(rec.next.queues[0].progress).toBeCloseTo((50 / 600) * 100, 6);
    expect(rec.next.queues[1]).toMatchObject({
      status: 'done',
      qty: 2,
      qty_done: 2,
      total_minutes: 400,
      spent_minutes: 400,
    });
    expect(rec.events[0].detail).toContain('已下线台数');
  });
});

describe('CTRL-RECONCILE-01 · ③ 三色裁决门 · OVERRUN', () => {
  it('settling 超产（声明 6 > qty 5）：事务原地不动＋warn 事件＋差异数据', () => {
    const q = txn({
      item: '犀牛主战坦克',
      status: 'settling',
      progress: 100,
      spent_minutes: 5000,
      total_minutes: 5000,
      qty: 5,
      qty_done: 5,
    });
    const state = stateWith([q]);
    const rec = reconcileProduction(state, declsOf('<生产>\n- 犀牛主战坦克: 6台\n</生产>'));
    expect(rec.next).toStrictEqual(state);
    expect(rec.events[0]).toMatchObject({ type: 'reconcile_overrun', level: 'warn' });
    expect(rec.events[0].detail).toContain('超出在册批次 5 台');
    expect(rec.verdicts[0]).toMatchObject({ verdict: 'OVERRUN', claimedQty: 0, remainderQty: 5, physicalDoneQty: 5 });
  });

  it('active 时序冲突（声明 1 > qty_done 0）：原地不动＋remainingMinutes 差距数据', () => {
    const q = txn({ item: '战车工厂', type: '建造', total_minutes: 1440, spent_minutes: 360, progress: 25 });
    const state = stateWith([q]);
    const rec = reconcileProduction(state, declsOf('<生产>\n- 战车工厂: 1座\n</生产>'));
    expect(rec.next).toStrictEqual(state);
    expect(rec.events[0].type).toBe('reconcile_overrun');
    expect(rec.events[0].detail).toContain('剩余工期 1080 分钟');
    expect(rec.verdicts[0]).toMatchObject({ verdict: 'OVERRUN', physicalDoneQty: 0, remainingMinutes: 1080 });
  });

  it('无在册事务：原地不动＋warn（可能已结项或从未立项）', () => {
    const state = stateWith([txn({ item: '别的项目' })]);
    const rec = reconcileProduction(state, declsOf('<生产>\n- 犀牛主战坦克: 1台\n</生产>'));
    expect(rec.next).toStrictEqual(state);
    expect(rec.events[0].detail).toContain('无在册事务');
    expect(rec.verdicts[0].verdict).toBe('OVERRUN');
  });

  it('queued 目标：尚未开工即声明完工 → 拦截原地不动', () => {
    const q = txn({ item: '犀牛主战坦克', status: 'queued' });
    const state = stateWith([q]);
    const rec = reconcileProduction(state, declsOf('<生产>\n- 犀牛主战坦克: 1台\n</生产>'));
    expect(rec.next).toStrictEqual(state);
    expect(rec.events[0].detail).toContain('尚未开工');
  });

  it('仅 cancelled 候选：声明与账本冲突 → OVERRUN 原地不动', () => {
    const q = txn({ item: '犀牛主战坦克', status: 'cancelled' });
    const state = stateWith([q]);
    const rec = reconcileProduction(state, declsOf('<生产>\n- 犀牛主战坦克: 1台\n</生产>'));
    expect(rec.next).toStrictEqual(state);
    expect(rec.events[0].detail).toContain('cancelled');
    expect(rec.verdicts[0].verdict).toBe('OVERRUN');
  });
});

describe('CTRL-RECONCILE-01 · ③ 三色裁决门 · 安全出口与聚合', () => {
  it('多个在册候选（同名跨基地）：declaration_rejected，原地不动', () => {
    const state = stateWith(
      [
        txn({ item: '犀牛主战坦克', base: 'b1', status: 'settling', progress: 100, spent_minutes: 1000, qty_done: 1 }),
        txn({ item: '犀牛主战坦克', base: 'b2', status: 'settling', progress: 100, spent_minutes: 1000, qty_done: 1 }),
      ],
      {
        bases: [
          { id: 'b1', name: '青岚基地' },
          { id: 'b2', name: '北坡基地' },
        ],
      },
    );
    const rec = reconcileProduction(state, declsOf('<生产>\n- 犀牛主战坦克: 1台\n</生产>'));
    expect(rec.next).toStrictEqual(state);
    expect(rec.events[0].type).toBe('declaration_rejected');
    expect(rec.events[0].detail).toContain('候选不唯一');
  });

  it('基地消歧行（基地名经 bases 名↔id 互解）→ 精确命中单条 MATCH', () => {
    const state = stateWith(
      [
        txn({ item: '犀牛主战坦克', base: 'b1', status: 'settling', progress: 100, spent_minutes: 1000, qty_done: 1 }),
        txn({ item: '犀牛主战坦克', base: 'b2', status: 'settling', progress: 100, spent_minutes: 1000, qty_done: 1 }),
      ],
      {
        bases: [
          { id: 'b1', name: '青岚基地' },
          { id: 'b2', name: '北坡基地' },
        ],
      },
    );
    const rec = reconcileProduction(state, declsOf('<生产>\n- 犀牛主战坦克: 1台\n  基地: 北坡基地\n</生产>'));
    expect(rec.next.queues[0].status).toBe('settling');
    expect(rec.next.queues[1].status).toBe('done');
  });

  it('同键声明聚合求和：2台＋1台 vs settling qty=3 → MATCH', () => {
    const q = txn({
      item: '犀牛主战坦克',
      status: 'settling',
      total_minutes: 600,
      spent_minutes: 600,
      progress: 100,
      qty: 3,
      qty_done: 3,
    });
    const rec = reconcileProduction(
      stateWith([q]),
      declsOf('<生产>\n- 犀牛主战坦克: 2台\n- 犀牛主战坦克: 1台\n</生产>'),
    );
    expect(rec.next.queues[0].status).toBe('done');
    expect(rec.verdicts).toHaveLength(1);
    expect(rec.verdicts[0]).toMatchObject({ verdict: 'MATCH', declaredQty: 3, claimedQty: 3 });
  });

  it('被拒报文行流过为 declaration_rejected 事件（不动账本）', () => {
    const state = stateWith([txn({ item: '犀牛主战坦克' })]);
    const parsed = parseProductionDeclarations('<生产>\n- 犀牛主战坦克 一台\n</生产>');
    const rec = reconcileProduction(state, parsed);
    expect(rec.next).toStrictEqual(state);
    expect(rec.events[0]).toMatchObject({ type: 'declaration_rejected', level: 'warn' });
    expect(rec.verdicts[0].verdict).toBe('REJECTED');
  });

  it('found=false（无 <生产> 块）：事件为空、settling 原地等待（唯一通道语义）', () => {
    const q = txn({ item: '犀牛主战坦克', status: 'settling', progress: 100, spent_minutes: 1000, qty_done: 1 });
    const rec = reconcileProduction(stateWith([q]), noDecl());
    expect(rec.events).toEqual([]);
    expect(rec.verdicts).toEqual([]);
    expect(rec.next.queues[0].status).toBe('settling');
  });

  it('纯函数：混合战况下入参 state 零突变（toStrictEqual 快照钉死）', () => {
    const state = stateWith(
      [
        txn({ item: '犀牛主战坦克', status: 'settling', progress: 100, spent_minutes: 1000, qty: 2, qty_done: 2 }),
        txn({ item: '天启坦克', total_minutes: 2000, spent_minutes: 100, qty: 2, qty_done: 0 }),
      ],
      { tech: { done: [] }, bases: structuredClone(BASES), forces: { troops: {}, vehicles: [] } },
    );
    const snapshot = structuredClone(state);
    reconcileProduction(state, declsOf('<生产>\n- 犀牛主战坦克: 1台\n- 天启坦克: 2辆\n</生产>'));
    expect(state).toStrictEqual(snapshot);
  });
});

/* ═══════════════ 引擎目标接续回环 ═══════════════ */

describe('CTRL-RECONCILE-01 · 与 settleTransactions 目标接续（唯一通道证明）', () => {
  it('settleTransactions 推满 → settling 原地等门；<生产> 声明 → MATCH done（最小接缝回环）', () => {
    const s0 = stateWith([txn({ item: '犀牛主战坦克', total_minutes: 100, spent_minutes: 0 })]);
    const settled = settleTransactions(s0, 200);
    expect(settled.next.queues[0].status).toBe('settling');
    expect(settled.events.some(e => e.type === 'enter_settling')).toBe(true);

    // 无声明：门不动账本，settling 保持（done 唯一通道＝三色门）
    const idle = reconcileProduction(settled.next, noDecl());
    expect(idle.next.queues[0].status).toBe('settling');

    // 有声明：MATCH 入役
    const rec = reconcileProduction(
      settled.next,
      parseProductionDeclarations('<timePast>3 D</timePast>\n<生产>\n- 犀牛主战坦克: 1台\n</生产>\n晨光破晓。'),
    );
    expect(rec.next.queues[0].status).toBe('done');
    expect(rec.events[0].type).toBe('reconcile_match');
  });
});

/* ═══════════════ 事件映射（useParse 接缝） ═══════════════ */

describe('CTRL-RECONCILE-01 · 事件 → 解析留痕映射', () => {
  it('reconcileEventToParseEvent：warn→🟡、info→🟢，layer/path 对齐结算惯例', () => {
    const warn = reconcileEventToParseEvent({
      type: 'reconcile_overrun',
      level: 'warn',
      item: 'X',
      base: 'b',
      detail: '超产',
    });
    expect(warn.light).toBe('🟡');
    expect(warn.layer).toBe('instruction');
    expect(warn.path).toBe('queues');
    expect(warn.message).toContain('[对账] OVERRUN 拦截挂起「X」：超产');
    const info = reconcileEventToParseEvent({ type: 'reconcile_match', level: 'info', item: 'Y', base: 'b' });
    expect(info.light).toBe('🟢');
  });

  it('reconcileEventToIssue：仅 warn 升 R23，info 返回 null', () => {
    const issue = reconcileEventToIssue({
      type: 'declaration_rejected',
      level: 'warn',
      item: 'X',
      base: '',
      detail: '候选不唯一',
    });
    expect(issue).toMatchObject({ rule: 'R23', level: 'warn', target: '队列[X]' });
    expect(reconcileEventToIssue({ type: 'reconcile_match', level: 'info', item: 'X', base: '' })).toBeNull();
  });
});

/* ═══════════════ CHRONO 横幅纠偏支持（CTRL-UI-CHRONO-01 · A′ 增补） ═══════════════ */

describe('CTRL-UI-CHRONO-01 · OVERRUN 细分类型标记（overrunKind）', () => {
  it('五种 OVERRUN 分支各自携带 overrunKind', () => {
    const state = stateWith([
      txn({ item: '超产车', status: 'settling', progress: 100, spent_minutes: 1000, qty: 2, qty_done: 2 }),
      txn({ item: '半成品', total_minutes: 1000, spent_minutes: 400, qty: 2, qty_done: 0 }),
      txn({ item: '排队车', status: 'queued', total_minutes: 800 }),
      txn({ item: '报废车', status: 'cancelled' }),
    ]);
    const rec = reconcileProduction(
      state,
      declsOf('<生产>\n- 超产车: 3台\n- 半成品: 1台\n- 排队车: 1台\n- 报废车: 1台\n- 幽灵车: 1台\n</生产>'),
    );
    const kinds = Object.fromEntries(rec.verdicts.map(v => [v.item, v.overrunKind]));
    expect(kinds).toEqual({
      超产车: 'over_qty',
      半成品: 'time_conflict',
      排队车: 'not_started',
      报废车: 'cancelled',
      幽灵车: 'no_txn',
    });
    // 非 OVERRUN 裁决不携带 overrunKind
    const ok = reconcileProduction(
      stateWith([txn({ item: '犀牛', status: 'settling', progress: 100, spent_minutes: 1000, qty_done: 1 })]),
      declsOf('<生产>\n- 犀牛: 1台\n</生产>'),
    );
    expect(ok.verdicts[0].verdict).toBe('MATCH');
    expect(ok.verdicts[0].overrunKind).toBeUndefined();
  });
});

describe('CTRL-UI-CHRONO-01 · autoAdvanceDeltaFor（A′ 顺延分钟数）', () => {
  const v = (over: Partial<VerdictRecord>): VerdictRecord => ({
    item: 'X',
    declaredQty: 1,
    verdict: 'OVERRUN',
    claimedQty: 0,
    remainderQty: 1,
    detail: '',
    ...over,
  });

  it('取 time_conflict 的 max remainingMinutes；其余类型与非 OVERRUN 忽略', () => {
    const delta = autoAdvanceDeltaFor([
      v({ overrunKind: 'time_conflict', remainingMinutes: 300 }),
      v({ overrunKind: 'time_conflict', remainingMinutes: 1080.4 }),
      v({ overrunKind: 'over_qty', remainingMinutes: 0 }),
      v({ overrunKind: 'not_started', remainingMinutes: 99999 }), // 未开工不算（升格不保证完工）
      v({ verdict: 'MATCH', remainingMinutes: 500 }),
    ]);
    expect(delta).toBe(1080);
  });

  it('无时序冲突 → 0（横幅禁用顺延钮口径）', () => {
    expect(autoAdvanceDeltaFor([])).toBe(0);
    expect(autoAdvanceDeltaFor([v({ overrunKind: 'over_qty', remainingMinutes: 0 })])).toBe(0);
    expect(autoAdvanceDeltaFor([v({ overrunKind: 'no_txn' })])).toBe(0);
  });

  it('宽容档带宽常量钉死 1440（1 日，A′ 定案）', () => {
    expect(AUTO_ADVANCE_TOLERANCE_MINUTES).toBe(1440);
  });
});

describe('CTRL-UI-CHRONO-01 · forceCommission（驾驶员逃生舱）', () => {
  it('active 半成品特批：绕过白名单直接 done，qty_done=qty、spent=total、progress=100', () => {
    const q = txn({ item: '犀牛主战坦克', total_minutes: 1000, spent_minutes: 400, progress: 40, qty: 2 });
    const res = forceCommission(stateWith([q]), { item: '犀牛主战坦克' });
    expect(res).not.toBeNull();
    expect(res!.next.queues[0]).toMatchObject({
      status: 'done',
      qty_done: 2,
      spent_minutes: 1000,
      progress: 100,
    });
    expect(res!.commissioned.item).toBe('犀牛主战坦克');
    expect(res!.events[0]).toMatchObject({ type: 'force_commission', level: 'warn' });
    expect(res!.events[0].detail).toContain('原状态 active');
    // 审计事件可入报告流水/R23（warn → 🟡 → R23）
    expect(reconcileEventToParseEvent(res!.events[0]).light).toBe('🟡');
    expect(reconcileEventToIssue(res!.events[0])).toMatchObject({ rule: 'R23', level: 'warn' });
  });

  it('queued 未开工特批（逃生舱唯一例外场景），settling 同样可批', () => {
    const queued = forceCommission(stateWith([txn({ item: 'A', status: 'queued' })]), { item: 'A' });
    expect(queued!.next.queues[0].status).toBe('done');
    const settling = forceCommission(
      stateWith([txn({ item: 'B', status: 'settling', progress: 100, spent_minutes: 1000, qty_done: 1 })]),
      { item: 'B' },
    );
    expect(settling!.next.queues[0].status).toBe('done');
  });

  it('终态（done/cancelled）不可特批：铁律4 终态不可逆高于逃生舱 → null', () => {
    expect(forceCommission(stateWith([txn({ item: 'X', status: 'done', progress: 100 })]), { item: 'X' })).toBeNull();
    expect(forceCommission(stateWith([txn({ item: 'X', status: 'cancelled' })]), { item: 'X' })).toBeNull();
  });

  it('无候选/候选不唯一 → null（fail-closed）；基地消歧后唯一命中可批', () => {
    expect(forceCommission(stateWith([]), { item: '幽灵' })).toBeNull();
    const dup = stateWith([txn({ item: '犀牛', base: 'alpha' }), txn({ item: '犀牛', base: 'beta' })]);
    expect(forceCommission(dup, { item: '犀牛' })).toBeNull();
    const picked = forceCommission(dup, { item: '犀牛', base: 'beta' });
    expect(picked).not.toBeNull();
    expect(picked!.next.queues[0].status).toBe('active'); // alpha 未动
    expect(picked!.next.queues[1]).toMatchObject({ status: 'done', base: 'beta' });
  });

  it('研究特批入 tech.done；建造特批目标建筑运转（复用 MATCH 入账语义）', () => {
    const res = forceCommission(stateWith([txn({ item: '装甲研究', type: '研究' })], { tech: { done: [] } }), {
      item: '装甲研究',
    });
    expect(res!.next.tech!.done).toEqual(['装甲研究']);
    const built = forceCommission(
      stateWith([txn({ item: '战车工厂', type: '建造', base: 'b1' })], { bases: structuredClone(BASES) }),
      { item: '战车工厂', base: 'b1' },
    );
    expect(built!.next.bases![0].buildings![0].state).toBe('运转');
  });

  it('生产/改装特批不写 forces（红线2）；入参零突变', () => {
    const state = stateWith([txn({ item: '犀牛主战坦克' })], {
      forces: { troops: { 步兵: 5 }, vehicles: ['旧车'] },
    });
    const snapshot = structuredClone(state);
    const res = forceCommission(state, { item: '犀牛主战坦克' });
    expect(res!.next.forces).toEqual({ troops: { 步兵: 5 }, vehicles: ['旧车'] });
    expect(state).toStrictEqual(snapshot);
  });
});

/* ═══════════════ F2-乙 · 收讫通道归一适配器 ═══════════════ */

describe('F2-乙 · operationCompletionsToDeclarations ＋ 门内统一裁决', () => {
  const op = (overrides: Partial<OperationCompletion> = {}): OperationCompletion => ({
    item: '测试载具',
    raw: '{"完成":"测试载具"}',
    ...overrides,
  });
  const adjudicate = (state: TestState, ops: OperationCompletion[]) =>
    reconcileProduction(state, {
      found: true,
      declarations: operationCompletionsToDeclarations(state, ops),
      rejected: [],
    });

  it('qty 映射：唯一在册候选整批认领（批次 qty=3 → 声明 qty=3），settling 全批 MATCH', () => {
    const state = stateWith([
      txn({
        item: '犀牛坦克',
        status: 'settling',
        progress: 100,
        qty: 3,
        qty_done: 3,
        total_minutes: 3000,
        spent_minutes: 3000,
      }),
    ]);
    const decls = operationCompletionsToDeclarations(state, [op({ item: '犀牛坦克' })]);
    expect(decls).toEqual([expect.objectContaining({ item: '犀牛坦克', qty: 3 })]);
    const res = adjudicate(state, [op({ item: '犀牛坦克' })]);
    expect(res.verdicts[0]).toMatchObject({ verdict: 'MATCH', claimedQty: 3, remainderQty: 0 });
    expect(res.next.queues[0].status).toBe('done');
  });

  it('settling 研究 → MATCH→done ＋ tech.done 入账（幂等去重）——L3 关卡4 场景复刻', () => {
    const state = stateWith(
      [txn({ type: '研究', item: '基础步兵训练学', base: '', status: 'settling', progress: 100 })],
      { tech: { done: [] } },
    );
    const res = adjudicate(state, [op({ item: '基础步兵训练学' })]);
    expect(res.verdicts[0].verdict).toBe('MATCH');
    expect(res.next.queues[0].status).toBe('done');
    expect(res.next.tech!.done).toEqual(['基础步兵训练学']);
    // 重复声明 → NOOP 幂等（不重复入账）
    const again = adjudicate(res.next, [op({ item: '基础步兵训练学' })]);
    expect(again.verdicts[0].verdict).toBe('NOOP');
    expect(again.next.tech!.done).toEqual(['基础步兵训练学']);
  });

  it('settling 建造 → MATCH ＋ 目标基地建筑运转（id↔名 互解）', () => {
    const state = stateWith([txn({ type: '建造', item: '战车工厂', base: 'b1', status: 'settling', progress: 100 })], {
      bases: structuredClone(BASES),
    });
    const res = adjudicate(state, [op({ item: '战车工厂' })]);
    expect(res.verdicts[0].verdict).toBe('MATCH');
    expect(res.next.bases![0].buildings![0].state).toBe('运转');
  });

  it('settling 生产 → MATCH 仅结项，forces 零触碰（红线2）', () => {
    const state = stateWith([txn({ status: 'settling', progress: 100, spent_minutes: 1000 })], {
      forces: { troops: { 步兵: 5 }, vehicles: ['旧车'] },
    });
    const res = adjudicate(state, [op()]);
    expect(res.verdicts[0].verdict).toBe('MATCH');
    expect(res.next.queues[0].status).toBe('done');
    expect(res.next.forces).toEqual({ troops: { 步兵: 5 }, vehicles: ['旧车'] });
  });

  it('active 物理未完工 → OVERRUN time_conflict 拦截，事务原地不动（旧通道直结被闸机挡下）', () => {
    const state = stateWith([txn({ status: 'active', progress: 40, spent_minutes: 400 })]);
    const res = adjudicate(state, [op()]);
    expect(res.verdicts[0]).toMatchObject({ verdict: 'OVERRUN', overrunKind: 'time_conflict', claimedQty: 0 });
    expect(res.next.queues[0]).toMatchObject({ status: 'active', progress: 40, spent_minutes: 400 });
  });

  it('queued 未开工 → OVERRUN not_started 拦截', () => {
    const state = stateWith([txn({ status: 'queued' })]);
    const res = adjudicate(state, [op()]);
    expect(res.verdicts[0]).toMatchObject({ verdict: 'OVERRUN', overrunKind: 'not_started' });
    expect(res.next.queues[0].status).toBe('queued');
  });

  it('无在册候选 → OVERRUN no_txn（声明 qty=1 兜底，适配器不越权裁决）', () => {
    const state = stateWith([]);
    const decls = operationCompletionsToDeclarations(state, [op()]);
    expect(decls[0].qty).toBe(1);
    const res = adjudicate(state, [op()]);
    expect(res.verdicts[0]).toMatchObject({ verdict: 'OVERRUN', overrunKind: 'no_txn' });
  });

  it('多个在册候选 → REJECTED 候选不唯一（fail-closed）；显式基地消歧后 MATCH', () => {
    const state = stateWith([
      txn({ item: '战车工厂', type: '建造', base: 'alpha', status: 'settling', progress: 100 }),
      txn({ item: '战车工厂', type: '建造', base: 'beta', status: 'settling', progress: 100 }),
    ]);
    const res = adjudicate(state, [op({ item: '战车工厂' })]);
    expect(res.verdicts[0].verdict).toBe('REJECTED');
    expect(res.next.queues.map(q => q.status)).toEqual(['settling', 'settling']);
    const disambiguated = adjudicate(state, [op({ item: '战车工厂', base: 'beta' })]);
    expect(disambiguated.verdicts[0].verdict).toBe('MATCH');
    expect(disambiguated.next.queues[1].status).toBe('done');
  });

  it('仅 done 候选 → NOOP；仅 cancelled 候选 → OVERRUN cancelled', () => {
    const doneState = stateWith([txn({ status: 'done', progress: 100 })]);
    expect(adjudicate(doneState, [op()]).verdicts[0].verdict).toBe('NOOP');
    const cancelledState = stateWith([txn({ status: 'cancelled' })]);
    expect(adjudicate(cancelledState, [op()]).verdicts[0]).toMatchObject({
      verdict: 'OVERRUN',
      overrunKind: 'cancelled',
    });
  });

  it('显式类型/基地消歧字段直通声明（type/base 随 op 携带）', () => {
    const state = stateWith([txn({ type: '研究', item: '装甲研究', base: '', status: 'settling', progress: 100 })], {
      tech: { done: [] },
    });
    const decls = operationCompletionsToDeclarations(state, [op({ item: '装甲研究', type: '研究', base: 'b1' })]);
    expect(decls[0]).toMatchObject({ item: '装甲研究', type: '研究', base: 'b1', qty: 1 });
  });

  it('ARM-02：当 forces.equipment 在场且同楼未通过 <兵力> 显式覆盖时，生产/改装完结幂等记入 forces.equipment 或已登记 troops；显式覆盖时跳过防双计', () => {
    const state = stateWith(
      [
        txn({
          type: '生产',
          item: '外骨骼装甲',
          status: 'settling',
          progress: 100,
          spent_minutes: 1000,
          qty: 3,
          qty_done: 3,
        }),
        txn({
          type: '生产',
          item: '动员兵',
          status: 'settling',
          progress: 100,
          spent_minutes: 500,
          qty: 5,
          qty_done: 5,
        }),
      ],
      {
        forces: {
          troops: { 动员兵: 10 },
          vehicles: [],
          equipment: { 外骨骼装甲: 2 },
        },
      },
    );

    const parsed = declsOf('<生产>\n- 外骨骼装甲: 3件\n- 动员兵: 5名\n</生产>');
    const rec = reconcileProduction(state, parsed);
    expect(rec.next.forces?.equipment).toEqual({ 外骨骼装甲: 5 });
    expect(rec.next.forces?.troops).toEqual({ 动员兵: 15 });

    // 重复对账命中 done → NOOP 幂等跳过，不重复记账
    const recAgain = reconcileProduction(rec.next, parsed);
    expect(recAgain.next.forces?.equipment).toEqual({ 外骨骼装甲: 5 });
    expect(recAgain.next.forces?.troops).toEqual({ 动员兵: 15 });

    // 当同楼已通过 <部队>/<兵力> 显式覆盖（forcesExplicitlyUpdated = true）时，跳过自动落账防双计
    const explicitState = { ...state, forcesExplicitlyUpdated: true };
    const recSkipped = reconcileProduction(explicitState, parsed);
    expect(recSkipped.next.forces).toBe(state.forces);
  });

  it('BUG-LIVE-04 & BUG-LIVE-05：parseProductionDeclarations 剥离 <thinking> 防跨段吞噬；buildItemCategoriesFromCatalog 精确分流步兵/载具/装备', () => {
    const rawWithThinking = `<thinking>
先考虑一下 <生产> 标签怎么写：
- 假想敌坦克: 99辆
这里还不闭合，等正文再写 </生产> 演示。
</thinking>
<正文>
本轮产线顺利下线。
</正文>
<生产>
- 美国大兵: 2名
- M2A3布拉德利步兵战车: 1辆
</生产>`;
    const parsed = parseProductionDeclarations(rawWithThinking);
    expect(parsed.found).toBe(true);
    expect(parsed.declarations.map(d => ({ item: d.item, qty: d.qty }))).toEqual([
      { item: '美国大兵', qty: 2 },
      { item: 'M2A3布拉德利步兵战车', qty: 1 },
    ]);

    const itemCategories = buildItemCategoriesFromCatalog({
      productions: [
        { name: '美国大兵', category: 'infantry', need_buildings: ['兵营'] },
        { name: 'M2A3布拉德利步兵战车', category: 'vehicle', need_buildings: ['战车工厂'] },
        { name: '单兵夜视仪', category: 'equipment', need_buildings: ['个人装备制造所'] },
      ],
    });
    expect(itemCategories['美国大兵']).toBe('troops');
    expect(itemCategories['M2A3布拉德利步兵战车']).toBe('vehicles');
    expect(itemCategories['单兵夜视仪']).toBe('equipment');

    const state: ReconcileStateShape = {
      bases: [{ id: 'b1', name: '恶土前哨主基地', forces: { troops: {}, vehicles: [] } }],
      forces: { troops: {}, vehicles: [], equipment: {} },
      itemCategories,
      queues: [
        txn({
          type: '生产',
          item: '美国大兵',
          base: 'b1',
          status: 'settling',
          qty: 2,
          qty_done: 2,
          progress: 100,
          spent_minutes: 1000,
        }),
        txn({
          type: '生产',
          item: 'M2A3布拉德利步兵战车',
          base: 'b1',
          status: 'settling',
          qty: 1,
          qty_done: 1,
          progress: 100,
          spent_minutes: 1000,
        }),
      ],
    };
    const reconciled = reconcileProduction(state, parsed);
    expect(reconciled.next.forces?.troops).toEqual({ 美国大兵: 2 });
    expect(reconciled.next.forces?.vehicles).toEqual(['M2A3布拉德利步兵战车']);
    expect(reconciled.next.forces?.equipment).toEqual({});
  });

  it('BUG-LIVE-24a（#72楼实机复现）：当声明完工的研究课题早已在 state.tech.done 中，且队列残留 queued/active 副本或已清理时，幂等返回 NOOP 并同步归档残留队列，绝不误报 OVERRUN', () => {
    const raw72 = `<生产>
- 增强现实战场系统工学: 1项, 基地: 恶土前哨主基地, 类型: 研究
</生产>`;
    const parsed = parseProductionDeclarations(raw72);
    expect(parsed.found).toBe(true);

    const stateWithQueuedResidual: ReconcileStateShape = {
      tech: { done: ['光学瞄准工学', '增强现实战场系统工学'] },
      bases: [{ id: '恶土前哨主基地', name: '恶土前哨主基地' }],
      queues: [
        txn({
          type: '研究',
          item: '增强现实战场系统工学',
          base: '恶土前哨主基地',
          status: 'queued',
          total_minutes: 8640,
          spent_minutes: 0,
        }),
      ],
    };

    const res = reconcileProduction(stateWithQueuedResidual, parsed);
    expect(res.verdicts).toHaveLength(1);
    expect(res.verdicts[0].verdict).toBe('NOOP');
    expect(res.events.some(e => e.type === 'reconcile_overrun')).toBe(false);
    expect(res.next.queues[0].status).toBe('done');
    expect(res.next.queues[0].progress).toBe(100);
  });

  it('BUG-R2-17（#9/#10/#12楼实机复现）：工程兵/医疗兵/侦察兵等人员单位完工对账时 100% 归入 forces.troops 与 base.forces.troops，绝不误入 equipment（且自动清理 equipment 残留）', () => {
    const itemCategories = buildItemCategoriesFromCatalog({
      productions: [
        { name: '工程兵', subcategory: '人员相关', need_buildings: ['兵营'] } as never,
        { name: '战地医疗兵', lane: 'lane.personnel' } as never,
        { name: '单兵战术外骨骼', need_buildings: ['个人装备制造所'] } as never,
      ],
    });
    expect(itemCategories['工程兵']).toBe('troops');
    expect(itemCategories['战地医疗兵']).toBe('troops');
    expect(itemCategories['单兵战术外骨骼']).toBe('equipment');

    // 即使未注入 itemCategories（空目录兜底），工程兵/侦察兵也由 inferUnitCategoryFromItemName 精确归入 troops
    const state12: ReconcileStateShape = {
      bases: [
        {
          id: '恶土前哨主基地',
          name: '恶土前哨主基地',
          forces: { troops: { 美国大兵: 4 }, vehicles: [], equipment: { 工程兵: 1 } },
        },
      ],
      forces: {
        troops: { 美国大兵: 4 },
        vehicles: [],
        equipment: { 工程兵: 1 },
      },
      queues: [
        txn({
          type: '生产',
          item: '工程兵',
          base: '恶土前哨主基地',
          status: 'settling',
          progress: 100,
          total_minutes: 60,
          spent_minutes: 60,
          qty: 2,
          qty_done: 2,
        }),
      ],
    };

    const parsed12 = parseProductionDeclarations('<生产>\n- 工程兵: 2名\n</生产>');
    const rec12 = reconcileProduction(state12, parsed12);
    expect(rec12.verdicts[0]?.verdict).toBe('MATCH');
    expect(rec12.next.forces?.troops).toEqual({ 美国大兵: 4, 工程兵: 2 });
    expect(rec12.next.forces?.equipment).toEqual({});
    expect(rec12.next.bases?.[0]?.forces?.troops).toEqual({ 美国大兵: 4, 工程兵: 2 });
    expect((rec12.next.bases?.[0]?.forces as { equipment?: Record<string, number> })?.equipment).toEqual({});
  });
});

