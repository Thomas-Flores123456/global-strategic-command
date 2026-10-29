/**
 * casualtyAndForceSync.test.ts —— 实机 #22 楼载具/步兵战损与分基地驻军同步回归测试
 *
 * 重点覆盖：
 * 1. 当 authority / credibilityIndex（真实世界书 canon 对齐索引）非空时，
 *    解析 `<态势> 战损: 载具: M1A1灰熊主战坦克: -1` 触发
 *    `applyCasualties -> syncGlobalForceReductionsToBases -> syncBasesVehiclesAfterGlobalForces`，
 *    走入 `ctx.align ? alignName(...)` 非空分支，严禁抛出 `ReferenceError: alignName is not defined`。
 * 2. 战损（正数、负数、带量词字符串、括号数量数组项）在非空 canon 下同步核减
 *    `data.forces` 与 `data.bases[i].forces`，且后续楼层不会因 `syncGlobalForcesFloorFromBases` 复活阵亡单位。
 */
import { describe, expect, it } from 'vitest';
import { buildEntityCredibilityIndex } from '../core/entityCredibility';
import { Schema } from '../core/schema';
import { parseMessageText } from '../parse/parsePipeline';

describe('#22 楼实机回归 · 非空 canon/authority 下载具与步兵战损同步（casualtyAndForceSync）', () => {
  const nonEmptyCanonAuthority = {
    names: ['M1A1灰熊主战坦克', '多功能步兵车', '美国大兵', '重装大兵', '工程兵', '盟军战车工厂'],
    aliases: {
      灰熊主战坦克: 'M1A1灰熊主战坦克',
      灰熊坦克: 'M1A1灰熊主战坦克',
      大兵: '美国大兵',
    },
  };

  const nonEmptyCredibilityIndex = buildEntityCredibilityIndex({
    buildings: [{ name: '盟军战车工厂' }, { name: '盟军兵营' }],
    productions: [
      { name: 'M1A1灰熊主战坦克', category: 'vehicle' },
      { name: '多功能步兵车', category: 'vehicle' },
      { name: '美国大兵', category: 'infantry' },
      { name: '重装大兵', category: 'infantry' },
      { name: '工程兵', category: 'infantry' },
    ],
    researches: [],
    protocols: [],
  });

  it('1. 实机 #22 楼复现：非空 authority + credibilityIndex 下解析 `<态势> 战损: 载具: M1A1灰熊主战坦克: -1` 不抛 ReferenceError 且同步扣减 base.forces.vehicles', () => {
    const baseline21 = Schema.parse({
      meta: { world_id: 'ra2_soviet', date: '1972-05-05', time_of_day: '15:00', day_count: 5 },
      bases: [
        {
          id: 'base_red_peak',
          name: '红峰矿道前哨分基地',
          location: '红峰矿道',
          status: '暴露',
          buildings: [
            { name: '盟军兵营', state: '运转' },
            { name: '盟军战车工厂', state: '运转' },
          ],
          forces: {
            troops: { 美国大兵: 10, 重装大兵: 4, 工程兵: 2 },
            vehicles: ['M1A1灰熊主战坦克', 'M1A1灰熊主战坦克', '多功能步兵车'],
            equipment: {},
          },
        },
      ],
      forces: {
        troops: { 美国大兵: 10, 重装大兵: 4, 工程兵: 2 },
        vehicles: ['M1A1灰熊主战坦克', 'M1A1灰熊主战坦克', '多功能步兵车'],
        equipment: {},
      },
    });

    const rawFloor22 = `<态势>
战损:
  载具:
    M1A1灰熊主战坦克: -1
  步兵:
    美国大兵: -2
</态势>`;

    const r22 = parseMessageText(rawFloor22, baseline21, {
      floorId: 22,
      authority: nonEmptyCanonAuthority,
      credibilityIndex: nonEmptyCredibilityIndex,
    });

    expect(r22.quarantine).toHaveLength(0);
    expect(r22.data.forces.vehicles).toEqual(['M1A1灰熊主战坦克', '多功能步兵车']);
    expect(r22.data.bases[0].forces.vehicles).toEqual(['M1A1灰熊主战坦克', '多功能步兵车']);
    expect(r22.data.forces.troops['美国大兵']).toBe(8);
    expect(r22.data.bases[0].forces.troops['美国大兵']).toBe(8);

    // 验证 #23 楼继续解析部队动态时，阵亡的 1 辆灰熊坦克与 2 名美国大兵不会被基地驻军底线复活
    const rawFloor23 = `<态势>
部队:
  步兵:
    工程兵: 2
</态势>`;
    const r23 = parseMessageText(rawFloor23, r22.data, {
      floorId: 23,
      authority: nonEmptyCanonAuthority,
      credibilityIndex: nonEmptyCredibilityIndex,
    });
    expect(r23.quarantine).toHaveLength(0);
    expect(r23.data.forces.vehicles).toEqual(['M1A1灰熊主战坦克', '多功能步兵车']);
    expect(r23.data.forces.troops['美国大兵']).toBe(8);
  });

  it('2. 非空 canon 别名对齐与括号数组形战损：写别名「灰熊坦克: "1辆"」或数组项「M1A1灰熊主战坦克(1)」均对齐并同步核减基地载具', () => {
    const baseline = Schema.parse({
      meta: { world_id: 'ra2_soviet', date: '1972-05-05', time_of_day: '16:00', day_count: 5 },
      bases: [
        {
          id: 'base_red_peak',
          name: '红峰矿道前哨分基地',
          location: '红峰矿道',
          status: '警戒',
          buildings: [{ name: '盟军战车工厂', state: '运转' }],
          forces: {
            troops: { 美国大兵: 6 },
            vehicles: ['M1A1灰熊主战坦克', 'M1A1灰熊主战坦克'],
            equipment: {},
          },
        },
      ],
      forces: {
        troops: { 美国大兵: 6 },
        vehicles: ['M1A1灰熊主战坦克', 'M1A1灰熊主战坦克'],
        equipment: {},
      },
    });

    const rAlias = parseMessageText(
      `<态势>
战损:
  载具:
    灰熊坦克: "1辆"
  步兵:
    - 美国大兵(2)
</态势>`,
      baseline,
      {
        authority: nonEmptyCanonAuthority,
        credibilityIndex: nonEmptyCredibilityIndex,
      },
    );

    expect(rAlias.quarantine).toHaveLength(0);
    expect(rAlias.data.forces.vehicles).toEqual(['M1A1灰熊主战坦克']);
    expect(rAlias.data.bases[0].forces.vehicles).toEqual(['M1A1灰熊主战坦克']);
    expect(rAlias.data.forces.troops['美国大兵']).toBe(4);
    expect(rAlias.data.bases[0].forces.troops['美国大兵']).toBe(4);
  });
});
