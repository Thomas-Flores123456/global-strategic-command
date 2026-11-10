import { describe, expect, it } from 'vitest';
import { durationFromEntry } from '../engines/settleFloorHelpers';
import { predicateFor } from '../planning/scheduleText';
import type { TransactionItem } from '../engines/transactionEngine';

/** 个人装备四档工期（2h/4h/8h/12h）经 workload.days 分数日进入引擎后的落地口径探针 */
describe('个人装备小时级工期 · 引擎落地探针', () => {
  it('workload.days=0.166667（4h）→ totalMinutes≈240；×12 批次 → 全批 48h，节拍 4h，ETA 跨日正确', () => {
    const e = {
      type: 'production',
      name: '便携反装甲系统',
      cost: 150,
      need_building: '个人装备制造所',
      eta: '约4小时',
      workload: { days: 0.166667, min_days: 0.166667 },
    };
    const d = durationFromEntry(e)!;
    expect(d.source).toBe('显式工期');
    expect(Math.round(d.totalMinutes)).toBe(240);
    expect(d.minDaysLock).toBeCloseTo(0.166667, 5);

    const txn: TransactionItem = {
      type: '生产',
      item: '便携反装甲系统',
      base: 'b',
      progress: 0,
      eta: '',
      status: 'active',
      started_at: '',
      total_minutes: d.totalMinutes * 12,
      spent_minutes: 0,
      qty: 12,
      qty_done: 0,
      cost_paid: true,
      min_days_lock: d.minDaysLock,
      hold: false,
    };
    const line = predicateFor(txn, undefined, () => 1, { day: 3, time: '14:20' });
    expect(line).toContain('节拍 4小时');
    expect(line).toContain('全批尚需 2天');
    expect(line).toContain('预计全批完工：第 5 日 14:20');
  });

  it('2h 档 (days=0.083333) → 120 分钟', () => {
    const d = durationFromEntry({
      type: 'production',
      name: 'x',
      cost: 25,
      workload: { days: 0.083333, min_days: 0.083333 },
    })!;
    expect(Math.round(d.totalMinutes)).toBe(120);
  });
});
