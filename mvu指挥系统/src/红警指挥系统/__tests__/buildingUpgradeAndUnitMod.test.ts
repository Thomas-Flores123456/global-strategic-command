import { describe, expect, it } from 'vitest';
import {
  evaluateBuildingUnlock,
  evaluateProductionUnlock,
  resolveUnitPresentCount,
  setHasEquivalentBuilding,
  UPGRADE_DESCENDANTS_MAP,
} from '../core/prerequisites';
import { LANE_REGISTRY, laneCapacityInBase } from '../engines/productionLanes';
import {
  parseProductionDeclarations,
  reconcileProduction,
  type ReconcileStateShape,
} from '../engines/productionReconciliation';
import { syncProjects, type ProjectStateView } from '../engines/projectEngine';
import type { TransactionItem } from '../engines/transactionEngine';

function makeBuildingTxn(item: string, base = 'base_main'): TransactionItem {
  return {
    type: '建造',
    item,
    base,
    qty: 1,
    qty_done: 1,
    total_minutes: 60,
    spent_minutes: 60,
    progress: 100,
    eta: '已完成',
    status: 'settling',
    started_at: '1972-05-01T08:00',
    cost_paid: true,
    min_days_lock: 0,
    hold: false,
  };
}

describe('FD-22 Track B (BLD-MOD-CORE-01): 建筑单向向下兼容、产线继承、原位升级与改装更名', () => {
  it('1. UPGRADE_DESCENDANTS_MAP 单向向下兼容：高阶建筑满足低阶母体前置，但低阶绝不反向满足高阶', () => {
    const highTierSet = new Set(['全自动军工综合体', '量子超算中心', '先进光棱塔']);
    expect(setHasEquivalentBuilding(highTierSet, '战车工厂')).toBe(true);
    expect(setHasEquivalentBuilding(highTierSet, '盟军战车工厂')).toBe(true);
    expect(setHasEquivalentBuilding(highTierSet, '扩大版自动化战车工厂')).toBe(true);
    expect(setHasEquivalentBuilding(highTierSet, '超算中心')).toBe(true);
    expect(setHasEquivalentBuilding(highTierSet, '光棱塔')).toBe(true);

    // 严禁反向满足：仅有低阶建筑时，高阶建筑前置必须为 false
    const lowTierSet = new Set(['战车工厂', '超算中心', '光棱塔']);
    expect(setHasEquivalentBuilding(lowTierSet, '扩大版自动化战车工厂')).toBe(false);
    expect(setHasEquivalentBuilding(lowTierSet, '全自动军工综合体')).toBe(false);
    expect(setHasEquivalentBuilding(lowTierSet, '量子超算中心')).toBe(false);
    expect(setHasEquivalentBuilding(lowTierSet, '先进光棱塔')).toBe(false);
    expect(UPGRADE_DESCENDANTS_MAP['战车工厂']).toContain('扩大版自动化战车工厂');

    // 生产前置联动：基地升级为「扩大版自动化战车工厂」后，仍可生产要求「盟军战车工厂」的基础坦克
    const evalRes = evaluateProductionUnlock(
      {
        name: 'M1A1灰熊主战坦克',
        need_building: '盟军战车工厂',
      },
      {
        selectedBaseBuildings: ['扩大版自动化战车工厂'],
      },
    );
    expect(evalRes.unlocked).toBe(true);

    // 建筑前置反向守卫：基地仅有「超算中心」时，要求「量子超算中心」的建筑不可解锁
    const reverseEval = evaluateBuildingUnlock(
      {
        name: '未来量子中枢测试项',
        need_building: '量子超算中心',
      },
      {
        selectedBaseBuildings: ['超算中心'],
      },
    );
    expect(reverseEval.unlocked).toBe(false);
    expect(reverseEval.missingBuildings).toContain('量子超算中心');
  });

  it('2. UNIT_EQUIVALENT_GROUPS 同族双向等价：基础型号与现代改型号共享在役计数与 unit_present 判定', () => {
    const unitMap = new Map<string, number>([['M1A2 SEPv3混动灰熊主战坦克', 3]]);
    expect(resolveUnitPresentCount(unitMap, 'M1A1灰熊主战坦克')).toBe(3);
    expect(resolveUnitPresentCount(unitMap, 'M1A2 SEPv3混动灰熊主战坦克')).toBe(3);

    const sovUnitMap = new Map<string, number>([['天启重型坦克', 2], ['天启决战型重型坦克', 1]]);
    expect(resolveUnitPresentCount(sovUnitMap, '天启重型坦克')).toBe(3);
    expect(resolveUnitPresentCount(sovUnitMap, '天启决战型重型坦克')).toBe(3);
  });

  it('3. productionLanes 产线槽位继承：升级为高阶综合体后产线容量不归零', () => {
    const landDef = LANE_REGISTRY.find(l => l.laneId === 'lane.vehicle_land')!;
    const airDef = LANE_REGISTRY.find(l => l.laneId === 'lane.vehicle_air')!;
    const navalDef = LANE_REGISTRY.find(l => l.laneId === 'lane.vehicle_naval')!;

    const state = {
      bases: [
        {
          id: 'base_main',
          name: '主基地',
          buildings: [
            { name: '全自动军工综合体', state: '运转' },
            { name: '空天飞机维护综合体', state: '运转' },
            { name: '超级造船综合体', state: '运转' },
          ],
        },
      ],
    };

    expect(laneCapacityInBase(state, 'base_main', landDef)).toBe(1);
    expect(laneCapacityInBase(state, 'base_main', airDef)).toBe(1);
    expect(laneCapacityInBase(state, 'base_main', navalDef)).toBe(1);
  });

  it('4. productionReconciliation 建造完工结算：支持 replace 原位替换更名与 addon 挂件并存', () => {
    // 4a. standalone: false + upgrade_mode: 'replace'（先进光棱塔升级 ➔ 原位替换 光棱塔 为 先进光棱塔）
    const stateReplace: ReconcileStateShape = {
      queues: [makeBuildingTxn('先进光棱塔升级', 'base_main')],
      bases: [
        {
          id: 'base_main',
          name: '主基地',
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '光棱塔', state: '运转' },
          ],
        },
      ],
    };
    const resReplace = reconcileProduction(
      stateReplace,
      parseProductionDeclarations('<生产>\n- 先进光棱塔升级: 1座\n</生产>'),
    );
    expect(resReplace.verdicts[0]?.verdict).toBe('MATCH');
    expect(resReplace.next.bases?.[0]?.buildings).toEqual([
      { name: '盟军建造厂', state: '运转' },
      { name: '先进光棱塔', state: '运转' },
    ]);

    // 4b. standalone: false + upgrade_mode: 'addon'（天启超重总装跨 ➔ 保留 苏联战车工厂 并挂载运转）
    const stateAddon: ReconcileStateShape = {
      queues: [makeBuildingTxn('天启超重总装跨', 'base_sov')],
      bases: [
        {
          id: 'base_sov',
          name: '第一机械化基地',
          buildings: [{ name: '苏联战车工厂', state: '运转' }],
        },
      ],
    };
    const resAddon = reconcileProduction(
      stateAddon,
      parseProductionDeclarations('<生产>\n- 天启超重总装跨: 1座\n</生产>'),
    );
    expect(resAddon.verdicts[0]?.verdict).toBe('MATCH');
    expect(resAddon.next.bases?.[0]?.buildings).toEqual([
      { name: '苏联战车工厂', state: '运转', addons: ['天启超重总装跨'] },
      { name: '天启超重总装跨', state: '运转' },
    ]);
  });

  it('5. projectEngine.syncProjects：现代化改装工程完工时自动将在役存量单位与建筑原位升格为 upgraded_name', () => {
    const state: ProjectStateView = {
      queues: [
        {
          type: '工程',
          item: 'M1A2 SEPv3灰熊混动改装工程·全装定型与批量换装',
          base: 'base_main',
          progress: 100,
          eta: '已完成',
          status: 'done',
          started_at: '1972-05-01T08:00',
          total_minutes: 1440,
          spent_minutes: 1440,
          qty: 1,
          qty_done: 1,
          cost_paid: true,
          min_days_lock: 1,
          hold: false,
        },
      ],
      projects: [
        {
          id: 'proj_m1a2',
          ref: 'M1A2 SEPv3灰熊混动改装工程',
          scope: 'base',
          bases: ['base_main'],
          lead_base: 'base_main',
          grade: 'D',
          status: '在建',
          phases: [
            {
              idx: 0,
              name: '全装定型与批量换装',
              status: '进行中',
              queue_index: 0,
            },
          ],
          outcome: { type: 'mark' },
          schema_version: 1,
        },
      ],
      forces: {
        vehicles: ['M1A1灰熊主战坦克(正常) ×3', '多功能步兵车(正常) ×2'],
        girls: [{ name: '爱丽丝', model: 'M1A1灰熊主战坦克' }],
      },
      bases: [
        {
          id: 'base_main',
          name: '主基地',
          buildings: [{ name: '盟军战车工厂', state: '运转' }],
          forces: {
            vehicles: ['M1A1灰熊主战坦克(正常) ×3'],
          },
        },
      ],
    };

    const synced = syncProjects(state);
    expect(synced.next.projects?.[0]?.status).toBe('完工');
    expect(synced.next.forces?.vehicles).toEqual([
      'M1A2 SEPv3混动灰熊主战坦克(正常) ×3',
      '多功能步兵车(正常) ×2',
    ]);
    expect(synced.next.forces?.girls?.[0]?.model).toBe('M1A2 SEPv3混动灰熊主战坦克');
    expect(synced.next.bases?.[0]?.forces?.vehicles).toEqual([
      'M1A2 SEPv3混动灰熊主战坦克(正常) ×3',
    ]);
  });
});
