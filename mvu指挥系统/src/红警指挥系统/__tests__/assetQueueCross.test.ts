/**
 * R26 资产在账×队列存活交叉校验测试（CTRL-FIX-LEDGER-01 · O-A6-4 防线）
 *
 * 钉住两态：
 * - 触发：资产已在账（tech.done/forces.troops>0/基地建筑非建造中/forces.vehicles）
 *   × 对应 queues 条目仍存活（active/queued，未达 settling）→ warn 级 R26；
 * - 不触发：资产不在账 / 条目已达 settling·done·cancelled /  troops 数量 0 / 建筑建造中；
 * - 只警不拦：settleFloor 集成面钉住「结算行为零变化」（状态/进度不被 warn 改动）。
 */
import { describe, expect, it } from 'vitest';
import { Schema } from '../core/schema';
import { settleFloor } from '../engines/settleFloor';
import { checkAssetQueueCross, type AssetQueueCrossInput } from '../parse/systemCheck';

/* ═══════════════ 工具 ═══════════════ */

function mkInput(overrides: Partial<AssetQueueCrossInput> = {}): AssetQueueCrossInput {
  return { queues: [], techDone: [], troops: {}, bases: [], ...overrides };
}

function mkQueue(partial: Partial<AssetQueueCrossInput['queues'][number]> & { type: string; item: string }) {
  return { base: '', status: 'active', ...partial };
}

function mkStat(overrides: Record<string, unknown> = {}) {
  return Schema.parse({
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1, location: '锈蚀低壑' },
    ...overrides,
  });
}

/* ═══════════════ 单元：触发态 ═══════════════ */

describe('checkAssetQueueCross R26（触发态）', () => {
  it('研究：tech.done 在账 × 队列 active → warn', () => {
    const issues = checkAssetQueueCross(
      mkInput({
        queues: [mkQueue({ type: '研究', item: '低可观测技术工学' })],
        techDone: ['低可观测技术工学'],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: 'R26', level: 'warn', target: '队列[低可观测技术工学]' });
    expect(issues[0].message).toContain('active');
  });

  it('生产：forces.troops 数量>0 在账 × 队列 queued → warn', () => {
    const issues = checkAssetQueueCross(
      mkInput({
        queues: [mkQueue({ type: '生产', item: '美国大兵', status: 'queued' })],
        troops: { 美国大兵: 10 },
        prevTroops: { 美国大兵: 0 },
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: 'R26', level: 'warn' });
    expect(issues[0].message).toContain('queued');
  });

  it('建造：同基地建筑「运转」在账 × 队列 active → warn（base 消歧优先）', () => {
    const issues = checkAssetQueueCross(
      mkInput({
        queues: [mkQueue({ type: '建造', item: '发电厂', base: '北坡主基地' })],
        bases: [
          { name: '北坡主基地', buildings: [{ name: '发电厂', state: '运转' }] },
          { name: '备用基地', buildings: [] },
        ],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('北坡主基地');
  });

  it('建造：base 缺席时全域兜底也能命中', () => {
    const issues = checkAssetQueueCross(
      mkInput({
        queues: [mkQueue({ type: '建造', item: '发电厂' })],
        bases: [{ name: '某基地', buildings: [{ name: '发电厂', state: '停机' }] }],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('停机');
  });

  it('改装：forces.vehicles 在账 × 队列 active → warn', () => {
    const issues = checkAssetQueueCross(
      mkInput({
        queues: [mkQueue({ type: '改装', item: '灰熊坦克' })],
        vehicles: ['灰熊坦克'],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('载具在账');
  });

  it('canon 归一：空白/繁简差异不误判（「低可观测 技术工学」≡「低可观测技术工学」）', () => {
    const issues = checkAssetQueueCross(
      mkInput({
        queues: [mkQueue({ type: '研究', item: '低可观测 技术工学' })],
        techDone: ['低可观测技术工学'],
      }),
    );
    expect(issues).toHaveLength(1);
  });

  it('多条存活事务各出一条 warn', () => {
    const issues = checkAssetQueueCross(
      mkInput({
        queues: [mkQueue({ type: '研究', item: '甲科技' }), mkQueue({ type: '生产', item: '美国大兵' })],
        techDone: ['甲科技'],
        troops: { 美国大兵: 3 },
        prevTroops: { 美国大兵: 0 },
      }),
    );
    expect(issues).toHaveLength(2);
  });
});

/* ═══════════════ 单元：不触发态 ═══════════════ */

describe('checkAssetQueueCross R26（不触发态）', () => {
  it('资产不在账 → 无 warn', () => {
    const issues = checkAssetQueueCross(
      mkInput({
        queues: [mkQueue({ type: '研究', item: '低可观测技术工学' })],
        techDone: [],
      }),
    );
    expect(issues).toEqual([]);
  });

  it('事务已达 settling/done/cancelled → 不属「存活未就绪」，无 warn', () => {
    for (const status of ['settling', 'done', 'cancelled']) {
      const issues = checkAssetQueueCross(
        mkInput({
          queues: [mkQueue({ type: '研究', item: '甲科技', status })],
          techDone: ['甲科技'],
        }),
      );
      expect(issues).toEqual([]);
    }
  });

  it('troops 数量为 0 → 不算在账，无 warn', () => {
    const issues = checkAssetQueueCross(
      mkInput({
        queues: [mkQueue({ type: '生产', item: '美国大兵' })],
        troops: { 美国大兵: 0 },
      }),
    );
    expect(issues).toEqual([]);
  });

  it('建筑仍「建造中」→ 未落账，无 warn', () => {
    const issues = checkAssetQueueCross(
      mkInput({
        queues: [mkQueue({ type: '建造', item: '发电厂' })],
        bases: [{ name: '某基地', buildings: [{ name: '发电厂', state: '建造中' }] }],
      }),
    );
    expect(issues).toEqual([]);
  });

  it('建筑同名但在别的基地「建造中」，本基地无此建筑 → 无 warn（base 消歧隔离）', () => {
    const issues = checkAssetQueueCross(
      mkInput({
        queues: [mkQueue({ type: '建造', item: '发电厂', base: '北坡主基地' })],
        bases: [
          { name: '北坡主基地', buildings: [] },
          { name: '备用基地', buildings: [{ name: '发电厂', state: '运转' }] },
        ],
      }),
    );
    expect(issues).toEqual([]);
  });

  it('空输入 → 零 issue', () => {
    expect(checkAssetQueueCross(mkInput())).toEqual([]);
  });
});

/* ═══════════════ 集成：settleFloor 热路径接线（只警不拦） ═══════════════ */

describe('settleFloor × R26（热路径接线，只警不拦）', () => {
  const prev = mkStat();
  const bypassed = mkStat({
    queues: [
      {
        type: '研究',
        item: '低可观测技术工学',
        base: '北坡主基地',
        progress: 45,
        status: 'active',
      },
    ],
    tech: { done: ['低可观测技术工学'] },
  });

  it('触发：资产在账×队列存活 → issues 含 R26 warn', () => {
    const r = settleFloor(prev, bypassed, '无时间推进标签');
    const r26 = r.issues.filter(i => i.rule === 'R26');
    expect(r26).toHaveLength(1);
    expect(r26[0]).toMatchObject({ level: 'warn', target: '队列[低可观测技术工学]' });
  });

  it('只警不拦：结算行为零变化（队列原样保留、状态不被 warn 改动）', () => {
    const r = settleFloor(prev, bypassed, '无时间推进标签');
    expect(r.data.queues).toHaveLength(1);
    expect(r.data.queues[0].status).toBe('active');
    expect(r.data.queues[0].progress).toBe(45);
    expect(r.data.tech.done).toEqual(['低可观测技术工学']);
  });

  it('不触发：资产不在账 → issues 无 R26', () => {
    const clean = mkStat({
      queues: [{ type: '研究', item: '低可观测技术工学', status: 'active' }],
    });
    const r = settleFloor(prev, clean, '无时间推进标签');
    expect(r.issues.some(i => i.rule === 'R26')).toBe(false);
  });

  it('不触发：事务已 settling → issues 无 R26', () => {
    const settling = mkStat({
      queues: [{ type: '研究', item: '低可观测技术工学', status: 'settling', progress: 100 }],
      tech: { done: ['低可观测技术工学'] },
    });
    const r = settleFloor(prev, settling, '无时间推进标签');
    expect(r.issues.some(i => i.rule === 'R26')).toBe(false);
  });
});
