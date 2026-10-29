/**
 * 批 E3b·F1 载具账目腐化修复测试（案A·修解析面）
 * 覆盖：映射形增量合并（新车入队存量保留/值0离队/幂等/canon 消歧/带注记值隔离）、
 * 数组形全量覆盖零回归、数组非字符串元素隔离、裸值畸形隔离不静默、
 * 与部署令联动（映射形入队后同楼 <部署> 展开令成功）。
 * 既有数组形覆盖断言见 parsePipeline.test.ts（载具: [MH-6轻型直升机] → toEqual(['MH-6轻型直升机'])），保持绿。
 */
import { describe, expect, it } from 'vitest';
import { parseMessageText, type DeployCatalogIndexLike } from '../parse/parsePipeline';
import { Schema } from '../core/schema';

const mkBaseline = (vehicles: string[] = ['MCV']) =>
  Schema.parse({
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1 },
    bases: [{ id: '北坡主基地', name: '北坡主基地', location: '青岚山北坡', buildings: [{ name: '盟军建造厂' }] }],
    forces: { vehicles },
  });

const war = (inner: string) => `<战况>\n${inner}\n</战况>`;

const VEHICLE_BLOCK = { into: '前沿工地', duration_min: 360, reverse: true };
const mkIndex = (): DeployCatalogIndexLike => ({
  byVehicle: name => (name === '前沿基地建设车' ? VEHICLE_BLOCK : undefined),
  byInto: name => (name === '前沿工地' ? { vehicle: '前沿基地建设车', block: VEHICLE_BLOCK } : undefined),
});

describe('E3b·F1 · 载具映射形增量合并', () => {
  it('映射形入队：新车入列＋存量 MCV 保留，零隔离', () => {
    const r = parseMessageText(war('部队:\n  载具: {前沿基地建设车: 1}'), mkBaseline(), {});
    expect(r.data.forces.vehicles).toEqual(['MCV', '前沿基地建设车']);
    expect(r.quarantine).toEqual([]);
  });

  it('映射形离队：值 0 离队；值负数离队；不在队者无事发生（均不隔离）', () => {
    const r = parseMessageText(
      war('部队:\n  载具:\n    MCV: 0\n    灰熊坦克: -1\n    幻影坦克: 0'),
      mkBaseline(['MCV', '灰熊坦克']),
      {},
    );
    expect(r.data.forces.vehicles).toEqual([]);
    expect(r.quarantine).toEqual([]);
  });

  it('映射形重复入队幂等：canon 消歧（大小写变体不重复入账）', () => {
    const r = parseMessageText(war('部队:\n  载具: {mcv: 1}'), mkBaseline(['MCV']), {});
    expect(r.data.forces.vehicles).toEqual(['MCV']);
    expect(r.quarantine).toEqual([]);
  });

  it('带注记值（1（已展开））→ 键级隔离留痕不静默，该车不入队', () => {
    const r = parseMessageText(war('部队:\n  载具: {多功能步兵车: "1（已展开）"}'), mkBaseline(), {});
    expect(r.data.forces.vehicles).toEqual(['MCV']);
    expect(r.quarantine).toEqual([expect.objectContaining({ scope: 'key', path: '部队.载具.多功能步兵车' })]);
  });
});

describe('E3b·F1 · 载具数组形与畸形值', () => {
  it('数组形全量覆盖零回归：存量被花名册整体重写', () => {
    const r = parseMessageText(war('部队:\n  载具: [犀牛坦克, 幻影坦克]'), mkBaseline(['MCV']), {});
    expect(r.data.forces.vehicles).toEqual(['犀牛坦克', '幻影坦克']);
    expect(r.quarantine).toEqual([]);
  });

  it('数组形非字符串元素 → 元素级隔离不静默，合法字符串元素照常覆盖入账', () => {
    const r = parseMessageText(war('部队:\n  载具:\n    - 犀牛坦克\n    - 坏元素: 1'), mkBaseline(['MCV']), {});
    expect(r.data.forces.vehicles).toEqual(['犀牛坦克']);
    expect(r.quarantine).toEqual([
      expect.objectContaining({ scope: 'element', path: '部队.载具', error: '载具数组元素非字符串' }),
    ]);
  });

  it('裸字符串/数字值 → 键级隔离留痕不静默，车队账不动', () => {
    for (const raw of ['载具: 犀牛坦克', '载具: 5']) {
      const r = parseMessageText(war(`部队:\n  ${raw}`), mkBaseline(['MCV']), {});
      expect(r.data.forces.vehicles).toEqual(['MCV']);
      expect(r.quarantine).toEqual([expect.objectContaining({ scope: 'key', path: '部队.载具' })]);
    }
  });
});

describe('E3b·F1 · 载具映射形与部署令联动', () => {
  it('映射形入队后同楼 <部署> 展开令成功（段二基于增量后车队账解析）', () => {
    const r = parseMessageText(
      war('部队:\n  载具: {前沿基地建设车: 1}\n<部署>\n展开: 前沿基地建设车 | 基地: 北坡主基地\n</部署>'),
      mkBaseline(),
      { deployIndex: mkIndex() },
    );
    expect(r.data.forces.vehicles).toEqual(['MCV', '前沿基地建设车']);
    expect(r.deployOrders).toEqual([
      { vehicle: '前沿基地建设车', action: '展开', base: '北坡主基地', into: '前沿工地', duration_min: 360 },
    ]);
    expect(r.quarantine).toEqual([]);
  });
});

describe('BUG-R2-03 · 战损扣减缺陷与分基地驻军反向复活修复', () => {
  it('问题 A：mergeNumRecord 字典分支对齐同义/阵营前缀键并钳制非负（绝不新建负数键）', () => {
    const base = Schema.parse({
      forces: {
        troops: { 动员兵: 10, 工程师: 2 },
        equipment: { 重型防弹衣: 5 },
      },
    });
    const r = parseMessageText(
      war(
        [
          '部队:',
          '  人员:',
          '    苏军·动员兵变化: -4',
          '    工程师损耗: 5',
          '    未知游击队变化: -3',
          '  装备:',
          '    重型防弹衣: -2',
        ].join('\n'),
      ),
      base,
      {},
    );
    expect(r.data.forces.troops['动员兵']).toBe(6);
    expect(r.data.forces.troops['苏军·动员兵']).toBeUndefined();
    expect(r.data.forces.troops['工程师']).toBe(0);
    expect(r.data.forces.troops['未知游击队']).toBe(0);
    expect(r.data.forces.equipment['重型防弹衣']).toBe(0);
  });

  it('问题 B：mergeVehicles 字典形态支持增量扣减（仅移除 k 台且优先移除无固定 id 量产车）、归零全清与正数存量缩减', () => {
    const base = Schema.parse({
      forces: {
        vehicles: ['犀牛坦克#01', '犀牛坦克', '犀牛坦克', '灰熊坦克', '灰熊坦克', '灰熊坦克', '幻影坦克', '幻影坦克'],
      },
    });
    const r = parseMessageText(
      war(
        [
          '部队:',
          '  载具:',
          '    犀牛坦克变化: -1',
          '    灰熊坦克: 2辆',
          '    幻影坦克: 0',
        ].join('\n'),
      ),
      base,
      {},
    );
    // 犀牛坦克原本 3 台（含 #01 编号车 1 台 + 量产无编号车 2 台），扣减 1 台后保留 #01 车与 1 台量产车
    expect(r.data.forces.vehicles.filter(v => v.startsWith('犀牛坦克'))).toEqual(['犀牛坦克#01', '犀牛坦克']);
    // 灰熊坦克原本 3 台，报正数 "2辆" 作为目标存量缩减为 2 台
    expect(r.data.forces.vehicles.filter(v => v === '灰熊坦克')).toHaveLength(2);
    // 幻影坦克显式报 0 清空全部同名载具
    expect(r.data.forces.vehicles.filter(v => v === '幻影坦克')).toHaveLength(0);
  });

  it('问题 C：顶层 <战况> 扣减全局兵力/装备/载具时同步核减分基地 base.forces，防止 syncGlobalForcesFloorFromBases 把战损原地复活', () => {
    const base = Schema.parse({
      bases: [
        {
          id: 'base_1',
          name: '北坡主基地',
          forces: {
            troops: { 动员兵: 20 },
            equipment: { 单兵外骨骼: 10 },
            vehicles: ['犀牛坦克#01', '犀牛坦克', '犀牛坦克'],
          },
        },
        {
          id: 'base_2',
          name: '南岭前哨站',
          forces: {
            troops: { 动员兵: 10 },
            equipment: { 单兵外骨骼: 5 },
            vehicles: ['犀牛坦克'],
          },
        },
      ],
      forces: {
        troops: { 动员兵: 30 },
        equipment: { 单兵外骨骼: 15 },
        vehicles: ['犀牛坦克#01', '犀牛坦克', '犀牛坦克', '犀牛坦克'],
      },
    });

    const r = parseMessageText(
      war(
        [
          '部队:',
          '  人员:',
          '    动员兵变化: -12',
          '  装备:',
          '    单兵外骨骼: 8',
          '  载具:',
          '    犀牛坦克战损: 2',
        ].join('\n'),
      ),
      base,
      {},
    );

    // 全局扣减后绝不被分基地旧账反向拉回 30 / 15 / 4
    expect(r.data.forces.troops['动员兵']).toBe(18);
    expect(r.data.forces.equipment['单兵外骨骼']).toBe(8);
    expect(r.data.forces.vehicles).toEqual(['犀牛坦克#01', '犀牛坦克']);

    // 分基地驻军之和已同步核减至与全局一致（18 / 8 / 2）
    const baseTroopSum =
      (r.data.bases[0].forces?.troops['动员兵'] ?? 0) + (r.data.bases[1].forces?.troops['动员兵'] ?? 0);
    const baseEquipSum =
      (r.data.bases[0].forces?.equipment?.['单兵外骨骼'] ?? 0) +
      (r.data.bases[1].forces?.equipment?.['单兵外骨骼'] ?? 0);
    const baseVehCount =
      (r.data.bases[0].forces?.vehicles.length ?? 0) + (r.data.bases[1].forces?.vehicles.length ?? 0);

    expect(baseTroopSum).toBe(18);
    expect(baseEquipSum).toBe(8);
    expect(baseVehCount).toBe(2);
  });
});

