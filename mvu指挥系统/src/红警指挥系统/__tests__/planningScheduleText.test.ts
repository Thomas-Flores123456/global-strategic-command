import { describe, expect, it } from 'vitest';
import { SCHEDULE_COPY } from '../planning/scheduleCopy';
import { buildScheduleText, renderPlanningReceiptSection } from '../planning/scheduleText';
import {
  PlanningReceipt,
  PlanningReceiptActionResult,
  PlanningReceiptDiffSummary,
  PlanningReceiptStatus,
  PlanningState,
  Schema,
} from '../core/schema';
import type { TransactionItem } from '../engines/transactionEngine';

function txn(overrides: Partial<TransactionItem> = {}): TransactionItem {
  return {
    type: '生产',
    item: '犀牛主战坦克',
    base: 'b1',
    progress: 25,
    eta: '',
    status: 'active',
    started_at: '',
    total_minutes: 1440,
    spent_minutes: 360,
    qty: 1,
    qty_done: 0,
    cost_paid: true,
    min_days_lock: 0,
    hold: false,
    ...overrides,
  };
}

const BASES = [{ id: 'b1', name: '青岚基地' }];

describe('PLN-SCHED-01 · Schema 排产回执切片与向后兼容', () => {
  it('Schema.parse({}) 100% 向后兼容，planning 默认兑底为空态', () => {
    const parsed = Schema.parse({});
    expect(parsed.planning).toEqual({
      latest_receipt: null,
      pending_plan: null,
      committed_fingerprints: [],
      protected_task_refs: [],
    });
    expect(PlanningReceiptStatus.options).toEqual([
      'advisory_ready',
      'awaiting_approval',
      'committed',
      'rejected',
      'stale_snapshot',
    ]);
    expect(PlanningReceiptActionResult.parse({}).status).toBe('preview');
    expect(PlanningReceiptDiffSummary.parse({})).toEqual({
      added: [],
      promoted: [],
      demoted: [],
      held: [],
      resumed: [],
    });
    expect(PlanningState.parse({}).latest_receipt).toBeNull();
  });
});

describe('PLN-SCHED-01 · <当前工程日程> 参谋排产回执前馈渲染', () => {
  it('无 planningReceipt 或空对象时：renderPlanningReceiptSection 严格返回 []，buildScheduleText 与原输出逐字节恒等', () => {
    expect(renderPlanningReceiptSection({})).toEqual([]);
    expect(renderPlanningReceiptSection({ planningReceipt: null })).toEqual([]);
    expect(renderPlanningReceiptSection({ planningReceipt: PlanningReceipt.parse({}) })).toEqual([]);

    const emptyBaseline = buildScheduleText([]);
    const emptyWithNull = buildScheduleText([], { planningReceipt: null });
    const emptyWithBlank = buildScheduleText([], { planningReceipt: PlanningReceipt.parse({}) });
    expect(emptyWithNull).toBe(emptyBaseline);
    expect(emptyWithBlank).toBe(emptyBaseline);
    expect(emptyWithNull).not.toContain(SCHEDULE_COPY.planningSectionHeader);

    const activeBaseline = buildScheduleText([txn()], { bases: BASES, clock: { day: 3, time: '08:00' } });
    const activeWithNull = buildScheduleText([txn()], {
      bases: BASES,
      clock: { day: 3, time: '08:00' },
      planningReceipt: null,
    });
    expect(activeWithNull).toBe(activeBaseline);
  });

  it('status = committed：渲染「单次委托已核准入列排程」与入队动作明细，严格表述为已入队待产而非已造好入列', () => {
    const receipt = PlanningReceipt.parse({
      request_ref: 'req_01',
      fingerprint: 'fp_01',
      mode: 'delegate_once',
      status: 'committed',
      base_ref: 'b1',
      total_cost_credits: 1800,
      budget_cap_credits: 2000,
      summary: '装甲营补编两辆犀牛主战坦克已排入产线',
      actions: [
        {
          op: 'enqueue',
          target: '犀牛主战坦克',
          base: 'b1',
          quantity: 2,
          cost_credits: 1800,
          est_minutes: 240,
          status: 'accepted',
        },
      ],
      diff_summary: { added: ['犀牛主战坦克×2'] },
    });

    const text = buildScheduleText([txn()], {
      bases: BASES,
      clock: { day: 3, time: '08:00' },
      planningReceipt: receipt,
    });

    expect(text).toContain('◆ 参谋部排产方案与执行回执');
    expect(text).toContain('单次委托已核准入列排程');
    expect(text).toContain('已入队待产，尚未完工入列');
    expect(text).toContain('· [入队] 基地「青岚基地」：犀牛主战坦克 ×2（测算耗资 1800 点；预计工期 4小时）');
    expect(text).not.toContain('已造好入列');
  });

  it('status = advisory_ready：渲染「参谋试排方案已备妥，待指挥官裁决批准」与预览动作明细（全空态队列同样挂载）', () => {
    const receipt = PlanningReceipt.parse({
      request_ref: 'req_02',
      mode: 'advisory',
      status: 'advisory_ready',
      base_ref: '青岚基地',
      total_cost_credits: 1200,
      summary: '防空补强试排方案',
      actions: [
        {
          op: 'enqueue',
          target: '防空履带车',
          base: '青岚基地',
          quantity: 2,
          cost_credits: 1200,
          est_minutes: 120,
          status: 'preview',
        },
      ],
    });

    const text = buildScheduleText([], {
      bases: BASES,
      planningReceipt: receipt,
    });

    expect(text).toContain('当前各基地与科研序列均无在编工程');
    expect(text).toContain('◆ 参谋部排产方案与执行回执');
    expect(text).toContain('参谋试排方案已备妥，待指挥官裁决批准');
    expect(text).toContain('方案待批准');
    expect(text).toContain('· [入队] 基地「青岚基地」：防空履带车 ×2（测算耗资 1200 点；预计工期 2小时）');
    expect(text.endsWith('</当前工程日程>')).toBe(true);
  });

  it('status = awaiting_approval：渲染「委托超出预算或触及保护边界，转为待指挥官复核」及原因与经费上限', () => {
    const receipt = PlanningReceipt.parse({
      request_ref: 'req_03',
      mode: 'delegate_once',
      status: 'awaiting_approval',
      base_ref: 'b1',
      total_cost_credits: 3600,
      budget_cap_credits: 2000,
      reason: '总耗资超出单次委托预算上限 1600 点',
      actions: [
        {
          op: 'enqueue',
          target: 'V3火箭发射车',
          base: 'b1',
          quantity: 3,
          cost_credits: 3600,
          est_minutes: 360,
          status: 'preview',
        },
      ],
    });

    const text = buildScheduleText([txn()], {
      bases: BASES,
      planningReceipt: receipt,
    });

    expect(text).toContain('委托超出预算或触及保护边界，转为待指挥官复核');
    expect(text).toContain('· 核验说明：总耗资超出单次委托预算上限 1600 点');
    expect(text).toContain('· 经费测算：合计耗资 3600 点（预算上限 2000 点）');
    expect(text).toContain('· [入队] 基地「青岚基地」：V3火箭发射车 ×3（测算耗资 3600 点；预计工期 6小时）');
  });

  it('status = rejected & stale_snapshot：渲染「排产方案未通过战备核验，已予驳回」与被拒阻塞原因/建议', () => {
    const rejectedReceipt = PlanningReceipt.parse({
      request_ref: 'req_04',
      status: 'rejected',
      reason: '前置科技建筑未就绪',
      actions: [
        {
          op: 'enqueue',
          target: '天启坦克',
          base: 'b1',
          quantity: 1,
          status: 'rejected',
          blocker_code: 'MISSING_PREREQ',
          blocker_reason: '作战实验室尚未建成',
          next_step: '请先在青岚基地建造作战实验室',
        },
      ],
    });

    const rejectedText = buildScheduleText([txn()], {
      bases: BASES,
      planningReceipt: rejectedReceipt,
    });

    expect(rejectedText).toContain('排产方案未通过战备核验，已予驳回');
    expect(rejectedText).toContain('· [驳回] 天启坦克——原因：作战实验室尚未建成；建议：请先在青岚基地建造作战实验室');
    expect(rejectedText).not.toContain('MISSING_PREREQ');

    const staleReceipt = PlanningReceipt.parse({
      status: 'stale_snapshot',
      reason: '基地队列已在第 8 楼发生变更',
    });
    const staleText = buildScheduleText([], { planningReceipt: staleReceipt });
    expect(staleText).toContain('排产快照已过期，请基于最新战况重新提报');
    expect(staleText).toContain('· 核验说明：基地队列已在第 8 楼发生变更');
  });
});
