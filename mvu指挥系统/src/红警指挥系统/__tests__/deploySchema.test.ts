/**
 * E3a schema 挂载测试：pending_deployments optional 挂载（仿 pending_mode_switches 先例）
 * 覆盖：字段结构/默认值兑底/旧档零注入。
 */
import { describe, expect, it } from 'vitest';
import { Schema } from '../core/schema';

describe('E3a · schema pending_deployments 挂载', () => {
  it("完整条目解析：vehicle/action 枚举/base default ''/into/new_base optional/remaining_minutes default 0", () => {
    const data = Schema.parse({
      pending_deployments: [
        { vehicle: '前沿基地建设车', action: '展开', into: '前沿工地' },
        {
          vehicle: 'MCV（盟军）',
          action: '展开',
          base: '灰谷前进基地',
          into: '盟军建造厂',
          new_base: { name: '灰谷前进基地', location: '灰谷东麓' },
          remaining_minutes: 1440,
        },
        { vehicle: '前沿基地建设车', action: '收起', base: '北坡主基地', into: '前沿工地', remaining_minutes: 360 },
      ],
    });
    expect(data.pending_deployments).toHaveLength(3);
    // 默认值兑底：base '' / remaining_minutes 0 / new_base 缺席
    expect(data.pending_deployments![0]).toEqual({
      vehicle: '前沿基地建设车',
      action: '展开',
      base: '',
      into: '前沿工地',
      remaining_minutes: 0,
    });
    expect(data.pending_deployments![0]).not.toHaveProperty('new_base');
    // new_base.location default ''
    expect(
      Schema.parse({ pending_deployments: [{ vehicle: 'v', action: '展开', into: 'b', new_base: { name: 'n' } }] })
        .pending_deployments![0].new_base,
    ).toEqual({ name: 'n', location: '' });
    // action 二值枚举外拒收
    expect(Schema.safeParse({ pending_deployments: [{ vehicle: 'v', action: '部署', into: 'b' }] }).success).toBe(
      false,
    );
  });

  it('旧档零注入：无字段档解析后不出现 pending_deployments 键', () => {
    const legacy = Schema.parse({
      meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1 },
      forces: { vehicles: ['MCV'] },
    });
    expect(legacy.pending_deployments).toBeUndefined();
    expect(Object.keys(legacy)).not.toContain('pending_deployments');
    expect(JSON.stringify(legacy)).not.toContain('pending_deployments');
  });
});
