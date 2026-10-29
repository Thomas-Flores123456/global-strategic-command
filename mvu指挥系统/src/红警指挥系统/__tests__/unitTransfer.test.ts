import { describe, expect, it } from 'vitest';
import { Schema } from '../core/schema';
import { parseMessageText } from '../parse/parsePipeline';
import { settleFloor } from '../engines/settleFloor';
import { buildScheduleText } from '../planning/scheduleText';
import { buildArmoryViewModel } from '../../中控悬浮窗/models/armoryPanelModel';
import { schedulePanelModel } from '../../中控悬浮窗/models/schedulePanelModel';

describe('UNIT-TRANSFER-01 · 跨基地单位调配协议、倒计时结算与双面板视图', () => {
  it('1. Schema 契约：旧档零注入，在途调配完结后自动销号不留空数组', () => {
    const legacy = Schema.parse({});
    expect(legacy.pending_transfers).toBeUndefined();
    expect(Object.keys(legacy)).not.toContain('pending_transfers');

    const withTransfer = Schema.parse({
      pending_transfers: [
        {
          id: 'xfer:1',
          unit: '灰熊坦克',
          category: 'vehicles',
          qty: 2,
          from_base: '1号基地',
          to_base: '2号基地',
          total_minutes: 120,
          remaining_minutes: 60,
          method: '铁路转运',
        },
      ],
    });
    expect(withTransfer.pending_transfers).toHaveLength(1);
    expect(withTransfer.pending_transfers?.[0].remaining_minutes).toBe(60);
  });

  it('2. 解析管线：支持 <事件> 单位调配 / 部队调动 及顶层 <调配> 兜底标签', () => {
    const raw = [
      '<事件>',
      '- 类型: 单位调配',
      '  单位: 灰熊坦克',
      '  数量: 3',
      '  出发地: 1号主基地',
      '  目的地: 2号前哨基地',
      '  耗时: 4 H 0 M',
      '  方式: 1520mm战略铁路转运',
      '  理由: 增援北翼防线',
      '- 类型: 部队调动',
      '  单位: 白凌',
      '  类别: 机娘',
      '  目的地: 2号前哨基地',
      '  耗时: 1 H 30 M',
      '</事件>',
    ].join('\n');

    const parsed = parseMessageText(raw, {});
    expect(parsed.quarantine).toHaveLength(0);
    expect(parsed.eventDeclarations).toHaveLength(2);
    expect(parsed.eventDeclarations[0]).toMatchObject({
      verb: '单位调配',
      kind: 'transfer',
      transfer: {
        unit: '灰熊坦克',
        qty: 3,
        from_base: '1号主基地',
        to_base: '2号前哨基地',
        duration_min: 240,
        method: '1520mm战略铁路转运',
        reason: '增援北翼防线',
      },
    });
    expect(parsed.eventDeclarations[1]).toMatchObject({
      verb: '单位调配',
      kind: 'transfer',
      transfer: {
        unit: '白凌',
        category: '机娘',
        qty: 1,
        to_base: '2号前哨基地',
        duration_min: 90,
      },
    });

    // 顶层 <调配> 块且省略 类型 键、单位带内联数量 ×2
    const standaloneRaw = [
      '<调配>',
      '- 单位: 重装大兵×2',
      '  出发地: 1号主基地',
      '  目的地: 2号前哨基地',
      '  耗时: 2 H 0 M',
      '</调配>',
    ].join('\n');
    const standaloneParsed = parseMessageText(standaloneRaw, {});
    expect(standaloneParsed.quarantine).toHaveLength(0);
    expect(standaloneParsed.eventDeclarations).toHaveLength(1);
    expect(standaloneParsed.eventDeclarations[0].transfer).toMatchObject({
      unit: '重装大兵',
      qty: 2,
      from_base: '1号主基地',
      to_base: '2号前哨基地',
      duration_min: 120,
    });
  });

  it('3. 跨楼倒计时与守恒交割：载具、步兵、装备、机娘在途推进与到站入库', () => {
    const seed = Schema.parse({
      meta: { date: '2042-05-01 08:00', day_count: 1 },
      bases: [
        {
          id: 'base1',
          name: '1号主基地',
          status: '运转中',
          forces: {
            troops: { 美国大兵: 10 },
            vehicles: ['灰熊坦克×4', '多功能步兵车'],
            equipment: { 单兵动力外骨骼: 6 },
          },
        },
        {
          id: 'base2',
          name: '2号前哨基地',
          status: '运转中',
          forces: {
            troops: { 美国大兵: 2 },
            vehicles: ['灰熊坦克'],
            equipment: {},
          },
        },
      ],
      forces: {
        girls: [
          {
            name: '白凌',
            model: 'MCV-A01',
            base: '1号主基地',
            hp: '完好',
          },
        ],
        troops: { 美国大兵: 15 }, // 10 + 2 = 12 已驻防，剩余 3 在战区机动直属
        vehicles: ['灰熊坦克×5', '多功能步兵车'],
        equipment: { 单兵动力外骨骼: 6 },
      },
    });

    // 第 1 楼：下达调配（灰熊坦克×3 耗时 4h，白凌 耗时 2h，美国大兵×3 从战区机动直属耗时 0m 超时空瞬达）
    const floor1Raw = [
      '<timePast>0 D 1 H 0 M</timePast>',
      '<事件>',
      '- 类型: 单位调配',
      '  单位: 灰熊坦克',
      '  数量: 3',
      '  出发地: 1号主基地',
      '  目的地: 2号前哨基地',
      '  耗时: 4 H 0 M',
      '  方式: 1520mm战略铁路',
      '- 类型: 单位调配',
      '  单位: 白凌',
      '  目的地: 2号前哨基地',
      '  耗时: 2 H 0 M',
      '  方式: 夜鹰直升机专机',
      '- 类型: 单位调配',
      '  单位: 美国大兵',
      '  数量: 3',
      '  出发地: 战区机动直属',
      '  目的地: 2号前哨基地',
      '  耗时: 0 M',
      '  方式: 超时空传送',
      '</事件>',
    ].join('\n');

    const p1 = parseMessageText(floor1Raw, seed);
    const s1 = settleFloor(seed, p1.data, floor1Raw, { eventDeclarations: p1.eventDeclarations });

    // 耗时 0M 的美国大兵当楼瞬达：2号基地由 2 增至 5，全局仍为 15（守恒）
    expect(s1.data.bases[1].forces?.troops?.['美国大兵']).toBe(5);
    expect(s1.data.forces.troops['美国大兵']).toBe(15);

    // 灰熊坦克与白凌在途登记（当楼保留完整 240 分钟与 120 分钟剩余时间供 UI 展示）
    expect(s1.data.pending_transfers).toHaveLength(2);
    expect(s1.data.pending_transfers?.[0]).toMatchObject({
      unit: '灰熊坦克',
      category: 'vehicles',
      qty: 3,
      from_base: '1号主基地',
      to_base: '2号前哨基地',
      total_minutes: 240,
      remaining_minutes: 240,
      method: '1520mm战略铁路',
    });
    expect(s1.data.pending_transfers?.[1]).toMatchObject({
      unit: '白凌',
      category: 'girls',
      qty: 1,
      from_base: '1号主基地',
      to_base: '2号前哨基地',
      total_minutes: 120,
      remaining_minutes: 120,
      method: '夜鹰直升机专机',
    });

    // 验证前端视图模型在途进度与剩余时间展示
    const armoryVm1 = buildArmoryViewModel(s1.data, 'ALL');
    expect(armoryVm1.pendingTransfers).toHaveLength(2);
    expect(armoryVm1.pendingTransfers[0].etaText).toBe('4小时');
    expect(armoryVm1.girls.items[0].activeTransfer).toMatchObject({
      toBase: '2号前哨基地',
      etaText: '2小时',
    });

    const schedVm1 = schedulePanelModel(s1.data);
    expect(schedVm1.allEmpty).toBe(false);
    expect(schedVm1.pendingTransfers).toHaveLength(2);

    const schedText1 = buildScheduleText(s1.data.queues, {
      bases: s1.data.bases,
      pendingTransfers: s1.data.pending_transfers,
    });
    expect(schedText1).toContain('[跨基地单位调配在途]');
    expect(schedText1).toContain('灰熊坦克 ×3：1号主基地 → 2号前哨基地（调配进行中，方式：1520mm战略铁路，预计还需4小时）');

    // 第 2 楼：推进 2 小时 -> 白凌抵达 2号前哨基地，灰熊坦克还剩 2 小时（进度 50%）
    const floor2Raw = '<timePast>0 D 2 H 0 M</timePast>\n<态势>\n日期: 2042-05-01 11:00\n</态势>';
    const p2 = parseMessageText(floor2Raw, s1.data);
    const s2 = settleFloor(s1.data, p2.data, floor2Raw, { eventDeclarations: p2.eventDeclarations });

    expect(s2.data.forces.girls[0].base).toBe('2号前哨基地');
    expect(s2.data.pending_transfers).toHaveLength(1);
    expect(s2.data.pending_transfers?.[0].remaining_minutes).toBe(120);

    const armoryVm2 = buildArmoryViewModel(s2.data, '2号前哨基地');
    expect(armoryVm2.pendingTransfers).toHaveLength(1);
    expect(armoryVm2.pendingTransfers[0].progress).toBe(50);
    expect(armoryVm2.pendingTransfers[0].etaText).toBe('2小时');

    // 第 3 楼：再推进 2 小时 -> 灰熊坦克×3 抵达 2号前哨基地，pending_transfers 自动销号清空
    const floor3Raw = '<timePast>0 D 2 H 0 M</timePast>\n<态势>\n日期: 2042-05-01 13:00\n</态势>';
    const p3 = parseMessageText(floor3Raw, s2.data);
    const s3 = settleFloor(s2.data, p3.data, floor3Raw, { eventDeclarations: p3.eventDeclarations });

    expect(s3.data.pending_transfers).toBeUndefined();
    const armoryVm3 = buildArmoryViewModel(s3.data, 'ALL');
    const grizzlyGroup = armoryVm3.vehicles.groups.find(g => g.model === '灰熊坦克');
    expect(grizzlyGroup?.total).toBe(5); // 战区总账严格守恒 = 5
    expect(grizzlyGroup?.byBase).toEqual([
      { base: '1号主基地', count: 1, intact: 1, damaged: 0 },
      { base: '2号前哨基地', count: 4, intact: 4, damaged: 0 },
    ]);
  });

  it('4. 边界守卫：源基地库存不足时自动钳制为可用量，无库存或未知基地时安全拒收', () => {
    const seed = Schema.parse({
      bases: [
        {
          id: 'b1',
          name: '一号基地',
          forces: { equipment: { 光棱步枪: 2 } },
        },
        {
          id: 'b2',
          name: '二号基地',
          forces: { equipment: {} },
        },
      ],
      forces: {
        equipment: { 光棱步枪: 2 },
      },
    });

    const raw = [
      '<事件>',
      '- 类型: 单位调配',
      '  单位: 光棱步枪',
      '  数量: 5',
      '  出发地: 一号基地',
      '  目的地: 二号基地',
      '  耗时: 0 M',
      '- 类型: 单位调配',
      '  单位: 幻影坦克',
      '  数量: 2',
      '  出发地: 一号基地',
      '  目的地: 二号基地',
      '  耗时: 1 H 0 M',
      '</事件>',
    ].join('\n');

    const parsed = parseMessageText(raw, seed);
    const settled = settleFloor(seed, parsed.data, raw, { eventDeclarations: parsed.eventDeclarations });

    // 光棱步枪请求 5 件但只有 2 件，钳制转移 2 件，一号基地清零，二号基地 +2，总账仍为 2
    expect(settled.data.bases[0].forces?.equipment?.['光棱步枪']).toBeUndefined();
    expect(settled.data.bases[1].forces?.equipment?.['光棱步枪']).toBe(2);
    expect(settled.data.forces.equipment['光棱步枪']).toBe(2);
    // 幻影坦克无库存被拒收，不产生 pending_transfers
    expect(settled.data.pending_transfers).toBeUndefined();
  });
});
