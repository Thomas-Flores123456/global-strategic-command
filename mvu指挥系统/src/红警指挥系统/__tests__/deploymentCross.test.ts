/**
 * E3a · R27 展开在途×载具在账交叉校验测试（仿 assetQueueCross R26 冷热双路径版型）
 * 冷路径：checkDeploymentVehicleCross 纯函数；热路径：settleFloor 每楼结算接缝（只警不拦）。
 */
import { describe, expect, it } from 'vitest';
import { Schema } from '../core/schema';
import { settleFloor } from '../engines/settleFloor';
import { checkDeploymentVehicleCross } from '../parse/systemCheck';

describe('checkDeploymentVehicleCross R27（冷路径）', () => {
  it('触发：展开在途×载具不在账 → warn 级 R27', () => {
    const issues = checkDeploymentVehicleCross({
      pendingDeployments: [{ vehicle: '前沿基地建设车', action: '展开' }],
      vehicles: [],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: 'R27', level: 'warn', target: 'pending_deployments[前沿基地建设车]' });
  });

  it('不触发：载具在账（canon 归一比对）', () => {
    const issues = checkDeploymentVehicleCross({
      pendingDeployments: [{ vehicle: '前沿基地建设车', action: '展开' }],
      vehicles: ['前沿基地建设车'],
    });
    expect(issues).toHaveLength(0);
  });

  it('不触发：收起在途载具本就不在 vehicles（翻转才回队，D3 对称语义不属异常）', () => {
    const issues = checkDeploymentVehicleCross({
      pendingDeployments: [{ vehicle: '前沿基地建设车', action: '收起' }],
      vehicles: [],
    });
    expect(issues).toHaveLength(0);
  });
});

describe('settleFloor × R27（热路径接线，只警不拦）', () => {
  const mkStat = (overrides: Record<string, unknown> = {}) =>
    Schema.parse({
      meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1, location: '锈蚀低壑' },
      ...overrides,
    });

  it('触发：pending 展开有车而 vehicles 已无 → issues 含 R27 warn；状态不被改写（只警不拦）', () => {
    const next = mkStat({
      forces: { vehicles: [] },
      pending_deployments: [
        { vehicle: '前沿基地建设车', action: '展开', base: '北坡主基地', into: '前沿工地', remaining_minutes: 300 },
      ],
    });
    const r = settleFloor(mkStat(), next, '无标签正文', { catalog: null }); // Δt=0，在途不结算
    const r27 = r.issues.filter(i => i.rule === 'R27');
    expect(r27).toHaveLength(1);
    expect(r27[0].level).toBe('warn');
    expect(r.data.pending_deployments).toHaveLength(1); // 只警不拦：条目原样保留
  });

  it('不触发：载具在账 → issues 无 R27', () => {
    const next = mkStat({
      forces: { vehicles: ['前沿基地建设车'] },
      pending_deployments: [
        { vehicle: '前沿基地建设车', action: '展开', base: '北坡主基地', into: '前沿工地', remaining_minutes: 300 },
      ],
    });
    const r = settleFloor(mkStat(), next, '无标签正文', { catalog: null });
    expect(r.issues.filter(i => i.rule === 'R27')).toHaveLength(0);
  });
});
