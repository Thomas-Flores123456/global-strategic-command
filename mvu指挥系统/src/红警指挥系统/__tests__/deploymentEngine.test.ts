/**
 * E3a · deploymentEngine 测试（版型仿 productionLanes.test.ts 模式切换事务段）
 * 覆盖：deployBlockIndexFromCatalog 工厂容错；requestDeployment 入账/替换/幂等/护栏拒收；
 * settleDeployments Δt 递减/展开翻转/收起翻转/new_base 诞生/orphan 留痕/空基地废弃/幂等。
 */
import { describe, expect, it } from 'vitest';
import {
  deployBlockIndexFromCatalog,
  requestDeployment,
  settleDeployments,
  type DeploymentWarn,
} from '../engines/deploymentEngine';

const POOLS = {
  productions: [
    {
      name: '前沿基地建设车',
      deploy: {
        into: '前沿工地',
        capabilities: ['build.whitelist'],
        duration_min: 360,
        reverse: true,
        capacity_ratio: 0.5,
        deploy_limit: 1,
      },
    },
  ],
};

const INDEX = deployBlockIndexFromCatalog(POOLS);

const mkBase = (buildings: { name: string; state?: string }[] = []) => ({
  id: '北坡主基地',
  name: '北坡主基地',
  location: '青岚山北坡',
  status: '隐蔽中',
  power: { gen: 100, use: 40 },
  buildings,
  alerts: [],
});

const mkState = (overrides: Record<string, unknown> = {}) => ({
  bases: [mkBase([{ name: '盟军发电站', state: '运转' }])],
  forces: { vehicles: ['前沿基地建设车'] },
  ...overrides,
});

const EXPAND_REQ = { vehicle: '前沿基地建设车', action: '展开' as const, base: '北坡主基地', into: '前沿工地' };
const FOLD_REQ = { vehicle: '前沿基地建设车', action: '收起' as const, base: '北坡主基地', into: '前沿工地' };

describe('deployBlockIndexFromCatalog（索引工厂）', () => {
  it('byVehicle/byInto 正查反查；脏块（缺 into/坏类型）跳过即空命中；byInto 同名先注册胜', () => {
    expect(INDEX.byVehicle('前沿基地建设车')?.into).toBe('前沿工地');
    expect(INDEX.byVehicle('不存在的车')).toBeUndefined();
    expect(INDEX.byInto('前沿工地')?.vehicle).toBe('前沿基地建设车');
    const dirty = deployBlockIndexFromCatalog({
      productions: [
        { name: '坏车A', deploy: { duration_min: 10 } }, // 缺 into
        { name: '坏车B', deploy: 'not-an-object' },
        { name: '  ', deploy: { into: 'x' } }, // 空名
      ],
    });
    expect(dirty.byVehicle('坏车A')).toBeUndefined();
    expect(dirty.byVehicle('坏车B')).toBeUndefined();
    const dup = deployBlockIndexFromCatalog({
      productions: [
        { name: '车一', deploy: { into: '同名场' } },
        { name: '车二', deploy: { into: '同名场' } },
      ],
    });
    expect(dup.byInto('同名场')?.vehicle).toBe('车一');
  });
});

describe('requestDeployment（入账：替换/幂等/护栏）', () => {
  it('入账 remaining=duration_min；同 vehicle 在途旧指令被新指令替换', () => {
    const s0 = mkState();
    const s1 = requestDeployment(s0, EXPAND_REQ, undefined, { deploy: INDEX });
    expect(s1.pending_deployments).toEqual([{ ...EXPAND_REQ, remaining_minutes: 360 }]);
    const s2 = requestDeployment(s1, FOLD_REQ, undefined, { deploy: INDEX });
    expect(s2.pending_deployments).toEqual([{ ...FOLD_REQ, remaining_minutes: 360 }]);
  });

  it('幂等：同参重复不入账（返回原状态引用）', () => {
    const s1 = requestDeployment(mkState(), EXPAND_REQ, undefined, { deploy: INDEX });
    const s2 = requestDeployment(s1, EXPAND_REQ, undefined, { deploy: INDEX });
    expect(s2).toBe(s1);
    expect(s2.pending_deployments).toHaveLength(1);
  });

  it('冲突护栏：同建筑有模式切换在途 → warn 拒收、状态原样', () => {
    const warns: DeploymentWarn[] = [];
    const s0 = mkState({
      pending_mode_switches: [
        { base: '北坡主基地', building: '前沿工地', target_mode: '加速', remaining_minutes: 720 },
      ],
    });
    const s1 = requestDeployment(s0, FOLD_REQ, w => warns.push(w), { deploy: INDEX });
    expect(s1).toBe(s0);
    expect(warns[0]).toMatchObject({ type: 'deployment_rejected', reason: 'mode_switch_in_flight' });
  });

  it('catalog 护栏：无 deploy 块 / reverse=false / deploy_limit 满 / capacity_ratio 满 → 各拒收', () => {
    const s0 = mkState();
    const reasons: string[] = [];
    const sink = (w: DeploymentWarn) => reasons.push(w.reason);
    expect(requestDeployment(s0, { ...EXPAND_REQ, vehicle: '无块车' }, sink, { deploy: INDEX })).toBe(s0);
    const noReverse = deployBlockIndexFromCatalog({
      productions: [{ name: '前沿基地建设车', deploy: { into: '前沿工地', reverse: false } }],
    });
    expect(requestDeployment(s0, FOLD_REQ, sink, { deploy: noReverse })).toBe(s0);
    const fullLimit = mkState({ bases: [mkBase([{ name: '前沿工地', state: '运转' }])] });
    expect(requestDeployment(fullLimit, EXPAND_REQ, sink, { deploy: INDEX })).toBe(fullLimit);
    const ratioIndex = deployBlockIndexFromCatalog({
      productions: [
        { name: '前沿基地建设车', deploy: { into: '前沿工地', capacity_ratio: 0.5, duration_min: 360, reverse: true } },
        { name: '机动科研车', deploy: { into: '机动科研前哨', capacity_ratio: 0.7 } },
      ],
    });
    const ratioFull = mkState({ bases: [mkBase([{ name: '机动科研前哨', state: '运转' }])] });
    expect(requestDeployment(ratioFull, EXPAND_REQ, sink, { deploy: ratioIndex })).toBe(ratioFull);
    expect(reasons).toEqual(['no_deploy_block', 'not_reversible', 'deploy_limit_full', 'capacity_ratio_full']);
  });

  it('索引缺席时护栏整体跳过（fail-open 入账，仿 catalog 缺失退默认）；duration 取 req.duration_min', () => {
    const s1 = requestDeployment(mkState(), { ...EXPAND_REQ, duration_min: 120 });
    expect(s1.pending_deployments?.[0]).toMatchObject({ remaining_minutes: 120 });
  });
});

describe('settleDeployments（Δt 递减→翻转）', () => {
  const pendingExpand = { ...EXPAND_REQ, remaining_minutes: 300 };
  const pendingFold = { ...FOLD_REQ, remaining_minutes: 300 };

  it('Δt≤0 不推进；未到期只递减 remaining', () => {
    const s0 = mkState({ pending_deployments: [pendingExpand] });
    expect(settleDeployments(s0, 0)).toEqual({ next: s0, events: [] });
    const r = settleDeployments(s0, 100);
    expect(r.next.pending_deployments).toEqual([{ ...pendingExpand, remaining_minutes: 200 }]);
    expect(r.next.forces.vehicles).toContain('前沿基地建设车'); // D3：展开中载具保留至翻转
    expect(r.events).toHaveLength(0);
  });

  it('展开翻转：vehicles 删 1 个该名（同名两辆只动一辆）→ buildings push 运转；done 🟢', () => {
    const s0 = mkState({
      forces: { vehicles: ['前沿基地建设车', '前沿基地建设车'] },
      pending_deployments: [pendingExpand],
    });
    const r = settleDeployments(s0, 300);
    expect(r.next.forces.vehicles).toEqual(['前沿基地建设车']);
    const base = r.next.bases![0];
    expect(base.buildings).toContainEqual({ name: '前沿工地', layer: '', state: '运转' });
    expect(base.buildings!.filter(b => b.name === '盟军发电站')).toHaveLength(1); // 既有建筑不动
    expect(r.next.pending_deployments).toEqual([]);
    expect(r.events.some(e => e.type === 'deployment_done' && e.light === '🟢')).toBe(true);
  });

  it('new_base 诞生：Base 字段齐（id=中文名/隐蔽中/alerts []）；电力采 catalog 定义 🟢', () => {
    const s0 = mkState({
      pending_deployments: [
        {
          ...EXPAND_REQ,
          base: '灰谷前进基地',
          new_base: { name: '灰谷前进基地', location: '灰谷东麓' },
          remaining_minutes: 60,
        },
      ],
    });
    const r = settleDeployments(s0, 60, { basePowerFor: () => ({ gen: 50, use: 10 }) });
    const created = r.next.bases!.find(b => b.name === '灰谷前进基地');
    expect(created).toMatchObject({
      id: '灰谷前进基地',
      name: '灰谷前进基地',
      location: '灰谷东麓',
      status: '隐蔽中',
      power: { gen: 50, use: 10 },
      alerts: [],
    });
    expect(created!.buildings).toContainEqual({ name: '前沿工地', layer: '', state: '运转' });
    expect(r.events.some(e => e.type === 'deployment_new_base' && e.light === '🟢')).toBe(true);
  });

  it('new_base 电力 catalog 无定义 → {0,0}＋🟡 警示（D4）；同名基地已存在 → 合并不另建', () => {
    const s0 = mkState({
      pending_deployments: [
        { ...EXPAND_REQ, base: '灰谷前进基地', new_base: { name: '灰谷前进基地' }, remaining_minutes: 60 },
      ],
    });
    const r = settleDeployments(s0, 60);
    const created = r.next.bases!.find(b => b.name === '灰谷前进基地');
    expect(created!.power).toEqual({ gen: 0, use: 0 });
    expect(r.events.some(e => e.type === 'deployment_new_base' && e.light === '🟡')).toBe(true);
    // 合并路径：同名基地已存在 → 不另建，直接部署进既有基地
    const s1 = mkState({
      bases: [mkBase([])],
      pending_deployments: [
        { ...EXPAND_REQ, base: '北坡主基地', new_base: { name: '北坡主基地' }, remaining_minutes: 60 },
      ],
    });
    const r1 = settleDeployments(s1, 60);
    expect(r1.next.bases).toHaveLength(1);
    expect(r1.next.bases![0].buildings).toContainEqual({ name: '前沿工地', layer: '', state: '运转' });
  });

  it('收起翻转：buildings 删该建筑 → vehicles 回载具原名；同基地其他建筑一概不动', () => {
    const s0 = mkState({
      bases: [
        mkBase([
          { name: '前沿工地', state: '运转' },
          { name: '盟军发电站', state: '运转' },
        ]),
      ],
      forces: { vehicles: [] },
      pending_deployments: [pendingFold],
    });
    const r = settleDeployments(s0, 300);
    const names = r.next.bases![0].buildings!.map(b => b.name);
    expect(names).toEqual(['盟军发电站']);
    expect(r.next.forces.vehicles).toEqual(['前沿基地建设车']);
    expect(r.next.bases![0].status).toBe('隐蔽中'); // 非空基地不动状态
    expect(r.events.some(e => e.type === 'deployment_done' && e.light === '🟢')).toBe(true);
  });

  it('空基地处置：收起翻转后 buildings 空 → status=废弃＋🟡（退役不删，实体保留，D8）', () => {
    const s0 = mkState({
      bases: [mkBase([{ name: '前沿工地', state: '运转' }])],
      forces: { vehicles: [] },
      pending_deployments: [pendingFold],
    });
    const r = settleDeployments(s0, 300);
    expect(r.next.bases).toHaveLength(1); // 退役不删
    expect(r.next.bases![0].status).toBe('废弃');
    expect(r.events.some(e => e.type === 'deployment_base_abandoned' && e.light === '🟡')).toBe(true);
  });

  it('orphan：车/基地/建筑中途消失 → 🟡 出账留痕、不阻塞其余条目', () => {
    const goneVehicle = mkState({
      forces: { vehicles: [] },
      pending_deployments: [
        pendingExpand,
        {
          vehicle: '机动科研车',
          action: '展开' as const,
          base: '北坡主基地',
          into: '机动科研前哨',
          remaining_minutes: 100,
        },
      ],
    });
    const r = settleDeployments(goneVehicle, 500);
    expect(r.events.filter(e => e.type === 'deployment_orphan')).toHaveLength(2);
    expect(r.next.pending_deployments).toEqual([]);
    const goneBase = mkState({ bases: [], pending_deployments: [pendingExpand] });
    expect(settleDeployments(goneBase, 500).events[0].type).toBe('deployment_orphan');
    const goneBuilding = mkState({ forces: { vehicles: [] }, pending_deployments: [pendingFold] });
    expect(settleDeployments(goneBuilding, 500).events[0].type).toBe('deployment_orphan');
  });

  it('翻转幂等：into 建筑已在场 → 不重复 push，done 事件注记幂等', () => {
    const s0 = mkState({
      bases: [mkBase([{ name: '前沿工地', state: '运转' }])],
      pending_deployments: [pendingExpand],
    });
    const r = settleDeployments(s0, 300);
    expect(r.next.bases![0].buildings!.filter(b => b.name === '前沿工地')).toHaveLength(1);
    expect(r.events.find(e => e.type === 'deployment_done')!.detail).toContain('幂等');
    expect(r.next.forces.vehicles).toEqual([]); // 幂等翻转仍离列（指令已生效）
  });
});
