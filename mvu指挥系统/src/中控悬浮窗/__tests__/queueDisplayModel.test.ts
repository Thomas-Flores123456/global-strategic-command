/**
 * queueDisplayModel.test.ts —— CTRL-UI-QUEUE-01 验收测试
 *
 * 覆盖：① 五态分色/分标可区分；② done/cancelled 不播在建动画；③ queued（含 hold）与 active 可区分；
 * ④ v2 字段消费（started_at/spent/total/eta/hold/qty/qty_done）；⑤ 批次三段式同源；
 * ⑥ settling 待收讫短标＋同源提示原文；⑦ 谓语与 scheduleText.predicateFor 字面同源；⑧ 边界钳制。
 */
import { describe, expect, it } from 'vitest';
import { QUEUE_DISPLAY_COPY, queueDisplayModel } from '../models/queueDisplayModel';
import { predicateFor } from '../../红警指挥系统/planning/scheduleText';
import { SCHEDULE_COPY } from '../../红警指挥系统/planning/scheduleCopy';
import type { QueueItem } from '../../红警指挥系统/core/schema';
import type { TransactionItem } from '../../红警指挥系统/engines/transactionEngine';

function q(over: Partial<QueueItem>): QueueItem {
  return {
    type: '生产',
    item: '测试犀牛坦克',
    base: '基地A',
    status: 'active',
    progress: 0,
    spent_minutes: 0,
    total_minutes: 600,
    qty: 1,
    qty_done: 0,
    cost_paid: true,
    hold: false,
    eta: '',
    started_at: '',
    ...over,
  } as QueueItem;
}

describe('queueDisplayModel 五态分色/分标（CTRL-UI-QUEUE-01 ①）', () => {
  it('五态 badge/tone/pulsing 互不相同且语义正确', () => {
    const models = (['queued', 'active', 'settling', 'done', 'cancelled'] as const).map(status =>
      queueDisplayModel(q({ status })),
    );
    expect(new Set(models.map(m => m.badge)).size).toBe(5);
    expect(new Set(models.map(m => m.tone)).size).toBe(5);
    const [queued, active, settling, done, cancelled] = models;
    expect(queued.tone).toBe('idle');
    expect(active.tone).toBe('run');
    expect(settling.tone).toBe('ready');
    expect(done.tone).toBe('ok');
    expect(cancelled.tone).toBe('dead');
    expect(active.pulsing).toBe(true);
  });

  it('done/cancelled 不播在建动画；done 光条恒 100；cancelled 光条照实静态', () => {
    const done = queueDisplayModel(q({ status: 'done', progress: 100 }));
    expect(done.pulsing).toBe(false);
    expect(done.progress).toBe(100);
    expect(done.badge).toBe(QUEUE_DISPLAY_COPY.doneBadge);
    const cancelled = queueDisplayModel(q({ status: 'cancelled', progress: 37 }));
    expect(cancelled.pulsing).toBe(false);
    expect(cancelled.progress).toBe(37);
    expect(cancelled.badge).toBe(QUEUE_DISPLAY_COPY.cancelledBadge);
  });

  it('queued（含 hold）与 active 可区分：暂缓双因子（徽标前缀＋独立 tone）', () => {
    const active = queueDisplayModel(q({ status: 'active' }));
    const queued = queueDisplayModel(q({ status: 'queued' }));
    const held = queueDisplayModel(q({ status: 'queued', hold: true }));
    expect(queued.badge).toBe('待产');
    expect(held.badge).toBe('暂缓·待产');
    expect(held.tone).toBe('hold');
    expect(held.tone).not.toBe(active.tone);
    expect(held.pulsing).toBe(false);
    expect(queued.predicate).not.toBe(active.predicate);
  });
});

describe('queueDisplayModel v2 字段消费与谓语同源（②④⑦）', () => {
  it('active 单台：spent/total → 「进度X%；尚需T」与 predicateFor(eff=1) 字面同源', () => {
    const item = q({ status: 'active', progress: 40, spent_minutes: 240, total_minutes: 600 });
    const m = queueDisplayModel(item);
    expect(m.predicate).toBe('进度 40%；尚需 6小时');
    expect(m.predicate).toBe(predicateFor(item as unknown as TransactionItem, undefined, () => 1));
  });

  it('active 批次：qty_done/qty＋单位节拍三段式（同源 activeBatch 句式）', () => {
    const m = queueDisplayModel(
      q({ status: 'active', progress: 50, spent_minutes: 500, total_minutes: 1000, qty: 5, qty_done: 2 }),
    );
    expect(m.predicate).toContain('已下线 2/5 台');
    expect(m.predicate).toContain('节拍 3小时20分');
    expect(m.predicate).toContain('进度 50%');
  });

  it('settling：待收讫短标＋SCHEDULE_COPY.settling 原文提示；批次走 settlingBatch 同源句式', () => {
    const single = queueDisplayModel(q({ status: 'settling', progress: 100 }));
    expect(single.badge).toBe('待收讫');
    expect(single.settlingHint).toBe(SCHEDULE_COPY.settling);
    expect(single.predicate).toBe(SCHEDULE_COPY.settling);
    const batch = queueDisplayModel(q({ status: 'settling', progress: 100, qty: 3, qty_done: 3, total_minutes: 300 }));
    expect(batch.predicate).toBe(SCHEDULE_COPY.settlingBatch(3, 3));
  });

  it('queued：已立项待X 谓语；hold 追加「；奉令暂缓」（holdSuffix 同源）', () => {
    const m = queueDisplayModel(q({ status: 'queued' }));
    expect(m.predicate).toBe(SCHEDULE_COPY.queued('待产'));
    const held = queueDisplayModel(q({ status: 'queued', hold: true }));
    expect(held.predicate).toBe(`${SCHEDULE_COPY.queued('待产')}${SCHEDULE_COPY.holdSuffix}`);
  });

  it('started_at/eta/laneName 有值才出；空串不污染展示', () => {
    const bare = queueDisplayModel(q({}));
    expect(bare.startedAt).toBeUndefined();
    expect(bare.eta).toBeUndefined();
    expect(bare.laneName).toBeUndefined();
    const full = queueDisplayModel(q({ started_at: '第2日 08:00', eta: '余3日' }), { laneName: '陆地载具生产线' });
    expect(full.startedAt).toBe('第2日 08:00');
    expect(full.eta).toBe('余3日');
    expect(full.laneName).toBe('陆地载具生产线');
  });

  it('工期未核定（total_minutes=0）：不出倒计时数字（unknownDuration 同源）', () => {
    const m = queueDisplayModel(q({ status: 'active', progress: 0, total_minutes: 0 }));
    expect(m.predicate).toBe(SCHEDULE_COPY.unknownDuration(0));
  });

  it('研究/建造/改装类型徽标动词跟随（待研/待建/在研/在建）', () => {
    expect(queueDisplayModel(q({ type: '研究', status: 'queued' })).badge).toBe('待研');
    expect(queueDisplayModel(q({ type: '建造', status: 'queued' })).badge).toBe('待建');
    expect(queueDisplayModel(q({ type: '研究', status: 'active' })).badge).toBe('在研');
    expect(queueDisplayModel(q({ type: '建造', status: 'active' })).badge).toBe('在建');
  });
});

describe('queueDisplayModel 边界钳制（⑧）', () => {
  it('progress 超界钳制 [0,100]；非法 status 按 queued 兜底展示', () => {
    expect(queueDisplayModel(q({ progress: 130 })).progress).toBe(100);
    expect(queueDisplayModel(q({ progress: -5 })).progress).toBe(0);
    const weird = queueDisplayModel(q({ status: 'bogus' as QueueItem['status'] }));
    expect(weird.status).toBe('queued');
    expect(weird.badge).toBe('待产');
  });
});
