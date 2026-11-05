import { describe, expect, it } from 'vitest';
import { Schema } from '../core/schema';
import {
  parseProductionDeclarations,
  reconcileProduction,
  type ReconcileStateShape,
} from '../engines/productionReconciliation';
import { syncProjects, type ProjectStateView } from '../engines/projectEngine';
import type { TransactionItem } from '../engines/transactionEngine';
import { requestUnitTransfer } from '../engines/unitTransferEngine';
import {
  stripUnitSquadDesignation,
  syncGlobalForcesFloorFromBases,
} from '../parse/parseDomainAppliers';
import { parseMessageText } from '../parse/parsePipeline';

function makeTxn(overrides: Partial<TransactionItem> & Pick<TransactionItem, 'type' | 'item' | 'base'>): TransactionItem {
  return {
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
    ...overrides,
  };
}

describe('FD-37 PKG-C: 分基地产线入驻、母体扩建挂载与现代化改型分基地同步', () => {
  it('1. 生产/改装完工收讫：按 txn.base 自动入驻对应基地 base.forces（步兵/载具/装备），全局总账同步增长且其他基地不受影响', () => {
    const state: ReconcileStateShape = {
      queues: [
        makeTxn({ type: '生产', item: '磁暴步兵', base: 'base_alpha', qty: 5, qty_done: 5 }),
        makeTxn({ type: '生产', item: '犀牛主战坦克', base: 'base_alpha', qty: 2, qty_done: 2 }),
        makeTxn({ type: '改装', item: '单兵铁幕发生器', base: '二号前哨站', qty: 3, qty_done: 3 }),
      ],
      itemCategories: {
        磁暴步兵: 'troops',
        犀牛主战坦克: 'vehicles',
        单兵铁幕发生器: 'equipment',
      },
      forces: {
        troops: { 磁暴步兵: 10, 动员兵: 20 },
        vehicles: ['天启重型坦克'],
        equipment: { 单兵铁幕发生器: 1 },
      },
      bases: [
        {
          id: 'base_alpha',
          name: '一号主基地',
          buildings: [{ name: '苏联兵营', state: '运转' }, { name: '苏联战车工厂', state: '运转' }],
          forces: {
            troops: { 磁暴步兵: 4 },
            vehicles: ['防空履带车'],
            equipment: { 夜视仪: 2 },
          },
        },
        {
          id: 'base_beta',
          name: '二号前哨站',
          buildings: [{ name: '战地维修所', state: '运转' }],
          forces: {
            troops: { 动员兵: 8 },
            vehicles: [],
            equipment: { 单兵铁幕发生器: 1 },
          },
        },
        {
          id: 'base_gamma',
          name: '三号静默基地',
          buildings: [{ name: '雷达站', state: '运转' }],
          forces: {
            troops: { 动员兵: 12 },
            vehicles: ['矿石精炼车'],
          },
        },
      ],
    };

    const parsed = parseProductionDeclarations(
      [
        '<生产>',
        '- 磁暴步兵: 5名',
        '  基地: base_alpha',
        '- 犀牛主战坦克: 2辆',
        '  基地: 一号主基地',
        '- 单兵铁幕发生器: 3套',
        '  基地: 二号前哨站',
        '</生产>',
      ].join('\n'),
    );

    const res = reconcileProduction(state, parsed);
    expect(res.verdicts.map(v => v.verdict)).toEqual(['MATCH', 'MATCH', 'MATCH']);

    // 全局总账同步增长
    expect(res.next.forces).toEqual({
      troops: { 磁暴步兵: 15, 动员兵: 20 },
      vehicles: ['天启重型坦克', '犀牛主战坦克', '犀牛主战坦克'],
      equipment: { 单兵铁幕发生器: 4 },
    });

    // 一号主基地（按 id 命中）仅入驻磁暴步兵 +5 与犀牛主战坦克 +2
    expect(res.next.bases?.[0]?.forces).toEqual({
      troops: { 磁暴步兵: 9 },
      vehicles: ['防空履带车', '犀牛主战坦克', '犀牛主战坦克'],
      equipment: { 夜视仪: 2 },
    });

    // 二号前哨站（按基地名命中）仅入驻单兵铁幕发生器 +3
    expect(res.next.bases?.[1]?.forces).toEqual({
      troops: { 动员兵: 8 },
      vehicles: [],
      equipment: { 单兵铁幕发生器: 4 },
    });

    // 三号静默基地完全不受影响（引用与内容均保持不变）
    expect(res.next.bases?.[2]).toBe(state.bases?.[2]);
    expect(res.next.bases?.[2]?.forces).toEqual({
      troops: { 动员兵: 12 },
      vehicles: ['矿石精炼车'],
    });
  });

  it('2. 建筑 addon 扩建收讫：无论是否预插在建同名项，母体建筑的 addons 列表均自动挂载并去重扩建模块名', () => {
    // 2a. 未预插在建同名项（matches.length === 0）：直接寻址同基地母体建筑并写入 addons
    const stateDirect: ReconcileStateShape = {
      queues: [
        makeTxn({ type: '建造', item: '智能电网调度改造', base: 'base_allied' }),
      ],
      bases: [
        {
          id: 'base_allied',
          name: '盟军主基地',
          buildings: [
            { name: '盟军发电厂', state: '运转' },
            { name: '盟军兵营', state: '运转' },
          ],
        },
        {
          id: 'base_other',
          name: '分基地',
          buildings: [{ name: '盟军发电厂', state: '运转' }],
        },
      ],
    };

    const resDirect = reconcileProduction(
      stateDirect,
      parseProductionDeclarations('<生产>\n- 智能电网调度改造: 1座\n</生产>'),
    );
    expect(resDirect.verdicts[0]?.verdict).toBe('MATCH');
    expect(resDirect.next.bases?.[0]?.buildings?.[0]).toEqual({
      name: '盟军发电厂',
      state: '运转',
      addons: ['智能电网潮流调度中心'],
    });
    expect(resDirect.next.bases?.[0]?.buildings?.[2]).toEqual({
      name: '智能电网潮流调度中心',
      state: '运转',
    });
    // 其他基地同名建筑不受影响
    expect(resDirect.next.bases?.[1]?.buildings?.[0]?.addons).toBeUndefined();

    // 2b. 已预插在建同名项（matches.length === 1）：完工转运转同时挂载至母体建筑 addons，且已有挂件去重
    const statePreInserted: ReconcileStateShape = {
      queues: [
        makeTxn({ type: '建造', item: '天启超重总装跨', base: 'base_sov' }),
      ],
      bases: [
        {
          id: 'base_sov',
          name: '苏联重工基地',
          buildings: [
            { name: '苏联战车工厂', state: '运转', addons: ['数字孪生与柔性生产车间'] },
            { name: '天启超重总装跨', state: '建造中' },
          ],
        },
      ],
    };

    const resPreInserted = reconcileProduction(
      statePreInserted,
      parseProductionDeclarations('<生产>\n- 天启超重总装跨: 1座\n</生产>'),
    );
    expect(resPreInserted.verdicts[0]?.verdict).toBe('MATCH');
    expect(resPreInserted.next.bases?.[0]?.buildings).toEqual([
      {
        name: '苏联战车工厂',
        state: '运转',
        addons: ['数字孪生与柔性生产车间', '天启超重总装跨'],
      },
      {
        name: '天启超重总装跨',
        state: '运转',
      },
    ]);
  });

  it('3. 单位现代化 retrofit 工程完工：全局 forces 与各分基地 base.forces 中的 vehicles / troops / equipment 旧型号同步原位升格（已存在目标键时累加并删旧键）', () => {
    const state: ProjectStateView = {
      queues: [
        {
          type: '工程',
          item: 'M1A2 SEPv3灰熊混动改装工程·全装定型与批量换装',
          base: 'base_alpha',
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
        {
          type: '工程',
          item: '恐怖机器人拆解/磁锁双模改装工程·量产换装',
          base: 'base_beta',
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
        {
          type: '工程',
          item: '赤星天锤3→6枚扩仓改装模块·载荷扩仓联调',
          base: 'base_beta',
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
          bases: ['base_alpha'],
          lead_base: 'base_alpha',
          grade: 'D',
          status: '在建',
          phases: [{ idx: 0, name: '全装定型与批量换装', status: '进行中', queue_index: 0 }],
          outcome: { type: 'mark' },
          schema_version: 1,
        },
        {
          id: 'proj_drone',
          ref: '恐怖机器人拆解/磁锁双模改装工程',
          scope: 'base',
          bases: ['base_beta'],
          lead_base: 'base_beta',
          grade: 'D',
          status: '在建',
          phases: [{ idx: 0, name: '量产换装', status: '进行中', queue_index: 1 }],
          outcome: { type: 'mark' },
          schema_version: 1,
        },
        {
          id: 'proj_hammer',
          ref: '赤星天锤3→6枚扩仓改装模块',
          scope: 'base',
          bases: ['base_beta'],
          lead_base: 'base_beta',
          grade: 'D',
          status: '在建',
          phases: [{ idx: 0, name: '载荷扩仓联调', status: '进行中', queue_index: 2 }],
          outcome: { type: 'mark' },
          schema_version: 1,
        },
      ],
      forces: {
        vehicles: ['M1A1灰熊主战坦克(正常) ×3', '多功能步兵车'],
        troops: {
          '恐怖机器人·拆解爆破型': 6,
          '恐怖机器人·拆解/磁锁双模战备型': 2,
          动员兵: 20,
        },
        equipment: {
          赤星天锤常规战略载荷: 2,
          '赤星天锤常规战略载荷(6枚扩仓型)': 1,
        },
      },
      bases: [
        {
          id: 'base_alpha',
          name: '一号基地',
          forces: {
            vehicles: ['M1A1灰熊主战坦克(正常) ×2', '多功能步兵车'],
            troops: {
              '恐怖机器人·拆解爆破型': 4,
            },
            equipment: {
              赤星天锤常规战略载荷: 1,
            },
          },
        },
        {
          id: 'base_beta',
          name: '二号基地',
          forces: {
            vehicles: ['M1A1灰熊主战坦克'],
            troops: {
              '恐怖机器人·拆解/磁锁双模战备型': 2,
              '恐怖机器人·拆解爆破型': 2,
              动员兵: 10,
            },
            equipment: {
              '赤星天锤常规战略载荷(6枚扩仓型)': 1,
              赤星天锤常规战略载荷: 1,
            },
          },
        },
      ],
    };

    const rf = (name: string, target_unit: string, upgraded_name: string) =>
      ({ kind: 'retrofit' as const, name, research: 'x', grade: '中改' as const, desc: '', target_unit, upgraded_name });
    const synced = syncProjects(state, [
      rf('M1A2 SEPv3灰熊混动改装工程', 'M1A1灰熊主战坦克', 'M1A2 SEPv3混动灰熊主战坦克'),
      rf('恐怖机器人拆解/磁锁双模改装工程', '恐怖机器人·拆解爆破型', '恐怖机器人·拆解/磁锁双模战备型'),
      rf('赤星天锤3→6枚扩仓改装模块', '赤星天锤常规战略载荷', '赤星天锤常规战略载荷(6枚扩仓型)'),
    ]);
    expect(synced.next.projects?.every(p => p.status === '完工')).toBe(true);

    // 全局 forces 原位升格并合并同名新键、删除旧键
    expect(synced.next.forces?.vehicles).toEqual([
      'M1A2 SEPv3混动灰熊主战坦克(正常) ×3',
      '多功能步兵车',
    ]);
    expect(synced.next.forces?.troops).toEqual({
      '恐怖机器人·拆解/磁锁双模战备型': 8,
      动员兵: 20,
    });
    expect(synced.next.forces?.equipment).toEqual({
      '赤星天锤常规战略载荷(6枚扩仓型)': 3,
    });

    // 一号基地 forces 同步升格
    expect(synced.next.bases?.[0]?.forces).toEqual({
      vehicles: ['M1A2 SEPv3混动灰熊主战坦克(正常) ×2', '多功能步兵车'],
      troops: {
        '恐怖机器人·拆解/磁锁双模战备型': 4,
      },
      equipment: {
        '赤星天锤常规战略载荷(6枚扩仓型)': 1,
      },
    });

    // 二号基地 forces 同步升格（已存在的目标键累加数量并删除旧键）
    expect(synced.next.bases?.[1]?.forces).toEqual({
      vehicles: ['M1A2 SEPv3混动灰熊主战坦克'],
      troops: {
        '恐怖机器人·拆解/磁锁双模战备型': 4,
        动员兵: 10,
      },
      equipment: {
        '赤星天锤常规战略载荷(6枚扩仓型)': 2,
      },
    });
  });

  it('4. 暖石防务 #792 真实样例：syncGlobalForcesFloorFromBases 按主兵种对齐且绝不把分基地番号键塞入全局 forces.troops', () => {
    expect(stripUnitSquadDesignation('美国大兵（量产战斗步兵·含徐磊/穆勒/宋蕊/周锐/铁楔子）')).toBe('美国大兵');
    expect(stripUnitSquadDesignation('战斗工兵（白芷筑城班）')).toBe('战斗工兵');
    expect(stripUnitSquadDesignation('赤星天锤常规战略载荷(6枚扩仓型)')).toBe('赤星天锤常规战略载荷(6枚扩仓型)');
    expect(stripUnitSquadDesignation('美国大兵(2名)')).toBe('美国大兵(2名)');

    const data = Schema.parse({
      forces: {
        troops: {
          '美国大兵（量产战斗步兵·含徐磊/穆勒/宋蕊/周锐/铁楔子）': 20,
          '战斗工兵（量产工兵班）': 6,
          '盟军侦察兵（量产侦察班）': 6,
        },
      },
      bases: [
        {
          id: 'base_dark_river',
          name: '暗河地下主基地',
          forces: {
            troops: {
              '美国大兵（突击一班）': 10,
              '盟军侦察兵（外勤侦察班）': 4,
              '战斗工兵（主基地维保组）': 2,
            },
          },
        },
        {
          id: 'base_pit_38',
          name: '三十八号矿坑前哨（道班客栈）',
          forces: {
            troops: {
              '美国大兵（矿坑驻防分队·穆勒领衔）': 5,
              '战斗工兵（白芷筑城班）': 4,
              '盟军侦察兵（外围哨组）': 1,
            },
          },
        },
        {
          id: 'base_rockyridge',
          name: '罗基里奇水泥厂总部（Corp-Bud）',
          forces: {
            troops: {
              '美国大兵（突击二班·徐磊领衔）': 5,
              '盟军侦察兵（公路警戒组）': 1,
            },
          },
        },
      ],
    });

    syncGlobalForcesFloorFromBases(data);

    // 全局总账与分基地之和相等（20 / 6 / 6），不得把分基地带番号的键塞入全局 forces.troops
    expect(data.forces.troops).toEqual({
      '美国大兵（量产战斗步兵·含徐磊/穆勒/宋蕊/周锐/铁楔子）': 20,
      '战斗工兵（量产工兵班）': 6,
      '盟军侦察兵（量产侦察班）': 6,
    });

    // 若全局为空而分基地带括号编制，向上兜底时写入剥离括号后的干净主兵种键
    const dataEmptyGlobal = Schema.parse({
      forces: { troops: {} },
      bases: data.bases,
    });
    syncGlobalForcesFloorFromBases(dataEmptyGlobal);
    expect(dataEmptyGlobal.forces.troops).toEqual({
      美国大兵: 20,
      盟军侦察兵: 6,
      战斗工兵: 6,
    });
  });

  it('5. 跨回合兵力重新编制不残留僵尸键，且支持带括号分队拆分与跨基地按主兵种调配', () => {
    const baseline = Schema.parse({
      forces: {
        troops: {
          '美国大兵（量产战斗步兵·含徐磊/穆勒/宋蕊/周锐/铁楔子）': 20,
          '战斗工兵（量产工兵班）': 6,
        },
      },
      bases: [
        {
          id: 'base_dark_river',
          name: '暗河地下主基地',
          forces: {
            troops: {
              '美国大兵（旧编制）': 10,
              '战斗工兵（主基地维保组）': 2,
            },
          },
        },
        {
          id: 'base_pit_38',
          name: '三十八号矿坑前哨（道班客栈）',
          forces: {
            troops: {
              '美国大兵（矿坑驻防分队·穆勒领衔）': 10,
              '战斗工兵（白芷筑城班）': 4,
            },
          },
        },
      ],
    });

    const rawMsg = `<态势>
基地:
  - 名称: 暗河地下主基地
    驻军:
      兵力:
        美国大兵（突击一班）: 5
        美国大兵（突击二班）: 5
部队:
  兵力:
    美国大兵: 20
</态势>`;

    const parsed = parseMessageText(rawMsg, baseline, {});
    expect(parsed.quarantine).toEqual([]);

    // 分基地内「美国大兵（旧编制）」被自动清理，新拆分的突击一班/二班与未触及的战斗工兵完整保留
    expect(parsed.data.bases[0].forces?.troops).toEqual({
      '战斗工兵（主基地维保组）': 2,
      '美国大兵（突击一班）': 5,
      '美国大兵（突击二班）': 5,
    });

    // 全局内「美国大兵（量产战斗步兵...）」被干净的「美国大兵: 20」替代清理，不残留僵尸键
    expect(parsed.data.forces.troops).toEqual({
      美国大兵: 20,
      '战斗工兵（量产工兵班）': 6,
    });

    // 验证调配引擎：用无括号的「美国大兵」从暗河地下主基地调配 7 人至三十八号矿坑前哨（瞬达）
    const xfer = requestUnitTransfer(parsed.data, {
      unit: '美国大兵',
      qty: 7,
      from_base: '暗河地下主基地',
      to_base: '三十八号矿坑前哨（道班客栈）',
      duration_min: 0,
    });
    expect(xfer.events[0]?.type).toBe('transfer_arrived');
    expect(xfer.events[0]?.qty).toBe(7);
    // 源基地突击一班(5)扣完删除，突击二班(5)扣2剩3
    expect(xfer.next.bases?.[0]?.forces?.troops).toEqual({
      '战斗工兵（主基地维保组）': 2,
      '美国大兵（突击二班）': 3,
    });
    // 目标基地原本 10 名美国大兵，入驻 7 名后变为 17 名，全局总账仍守恒为 20 名
    expect(xfer.next.bases?.[1]?.forces?.troops).toEqual({
      '美国大兵（矿坑驻防分队·穆勒领衔）': 17,
      '战斗工兵（白芷筑城班）': 4,
    });
    expect(xfer.next.forces?.troops?.['美国大兵']).toBe(20);
  });
});
