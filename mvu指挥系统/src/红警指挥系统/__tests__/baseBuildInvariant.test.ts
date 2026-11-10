import { describe, expect, it } from 'vitest';
import { Schema } from '../core/schema';
import { registerOrphanBuildingTransactions } from '../parse/baseBuildInvariant';
import { parseMessageText } from '../parse/parsePipeline';

function baselineWith(bases: unknown[], queues: unknown[] = []) {
  return Schema.parse({ bases, queues });
}

describe('BASE-INV-01 · 建造中建筑 → 建造事务 反向不变量', () => {
  it('本楼 <态势> 新申报建造中建筑且无建造事务时，补登 queued 建造事务（工期留 0 交结算回填）', () => {
    const baseline = baselineWith([
      {
        id: 'base_2',
        name: '北岭前哨',
        location: '北岭',
        status: '运转中',
        buildings: [{ name: '盟军建造厂', state: '运转' }],
      },
    ]);

    const res = parseMessageText(
      `<态势>\n基地:\n  - 名称: 北岭前哨\n    建筑:\n      - 盟军碉堡（建造中）\n      - 盟军碉堡（建造中）\n      - 综合感知塔（建造中）\n</态势>`,
      baseline,
      { floorId: 5 },
    );

    expect(res.quarantine).toHaveLength(0);
    const buildQueues = res.data.queues.filter(q => q.type === '建造');
    expect(buildQueues.map(q => [q.item, q.qty, q.status, q.base, q.total_minutes, q.started_at])).toEqual([
      ['盟军碉堡', 2, 'queued', '北岭前哨', 0, ''],
      ['综合感知塔', 1, 'queued', '北岭前哨', 0, ''],
    ]);
    expect(res.events.filter(e => e.light === '🟢' && /反向不变量补登建造事务/.test(e.message))).toHaveLength(2);
  });

  it('基线已是建造中的存量占位不补登（存量缺口归数据修复，防自激循环）', () => {
    const baseline = baselineWith([
      {
        id: 'base_3',
        name: '西谷哨所',
        location: '西谷',
        status: '运转中',
        buildings: [
          { name: '盟军建造厂', state: '运转' },
          { name: '反装甲炮位', state: '建造中' },
        ],
      },
    ]);

    const res = parseMessageText(
      `<态势>\n基地:\n  - 名称: 西谷哨所\n    建筑:\n      - 反装甲炮位（建造中）\n</态势>`,
      baseline,
      { floorId: 9 },
    );
    expect(res.data.queues.filter(q => q.type === '建造')).toHaveLength(0);
  });

  it('已有非终态建造事务覆盖（含 qty 与 building_delivered_qty 差额）时只补差额', () => {
    const data = baselineWith(
      [
        {
          id: 'base_1',
          name: '主基地',
          status: '运转中',
          buildings: [
            { name: '遥控武器站塔', state: '建造中' },
            { name: '遥控武器站塔', state: '建造中' },
            { name: '遥控武器站塔', state: '建造中' },
          ],
        },
      ],
      [
        {
          type: '建造',
          item: '遥控武器站塔',
          base: 'base_1',
          status: 'active',
          qty: 3,
          building_delivered_qty: 1,
          total_minutes: 2880,
        },
      ],
    );
    const prev = baselineWith([{ id: 'base_1', name: '主基地', status: '运转中', buildings: [] }]);

    const res = registerOrphanBuildingTransactions(data, { prevData: prev });
    expect(res.registeredCount).toBe(1);
    const added = res.data.queues.filter(q => q.type === '建造' && q.status === 'queued');
    expect(added).toHaveLength(1);
    expect(added[0].qty).toBe(1);
  });

  it('首楼与同楼 <排产计划> 已申报的建造名一律让位，零补登', () => {
    const data = baselineWith([
      {
        id: 'base_1',
        name: '主基地',
        status: '运转中',
        buildings: [{ name: '强化掩体', state: '建造中' }],
      },
    ]);
    expect(registerOrphanBuildingTransactions(data, { isFirstFloor: true }).registeredCount).toBe(0);
    const skipped = registerOrphanBuildingTransactions(data, { skipNames: new Set(['强化掩体']) });
    expect(skipped.registeredCount).toBe(0);
    expect(skipped.data).toBe(data);
  });

  it('done/cancelled 终态事务不算覆盖；同名建筑在别的基地的事务也不算覆盖', () => {
    const data = baselineWith(
      [
        { id: 'base_1', name: '主基地', status: '运转中', buildings: [] },
        { id: 'base_2', name: '副基地', status: '运转中', buildings: [{ name: '盟军碉堡', state: '建造中' }] },
      ],
      [
        { type: '建造', item: '盟军碉堡', base: 'base_2', status: 'done', qty: 1 },
        { type: '建造', item: '盟军碉堡', base: 'base_1', status: 'active', qty: 1 },
      ],
    );
    const res = registerOrphanBuildingTransactions(data, { prevData: undefined });
    expect(res.registeredCount).toBe(1);
    const added = res.data.queues.find(q => q.type === '建造' && q.status === 'queued');
    expect(added?.base).toBe('副基地');
  });
});
