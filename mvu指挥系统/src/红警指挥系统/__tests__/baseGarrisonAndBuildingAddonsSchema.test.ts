import { describe, expect, it } from 'vitest';
import { Base, BaseForces, Building, Schema } from '../core/schema';
import { parseMessageText } from '../parse/parsePipeline';

describe('FD-37 · PKG-B：Base.forces 与 Building.addons Schema 契约及 <战况> 解析补强', () => {
  describe('B1 · Schema 惰性缺省与向后兼容（零新增键红线）', () => {
    it('旧存档对象经过 Building / Base / Schema.parse 后不注入 addons 或 forces 键', () => {
      const legacyBld = Building.parse({ name: '盟军发电厂' });
      expect(legacyBld).not.toHaveProperty('addons');
      expect(Object.keys(legacyBld)).not.toContain('addons');

      const legacyBase = Base.parse({
        id: 'base-1',
        name: '北坡主基地',
        buildings: [{ name: '盟军建造厂' }],
      });
      expect(legacyBase).not.toHaveProperty('forces');
      expect(Object.keys(legacyBase)).not.toContain('forces');
      expect(legacyBase.buildings[0]).not.toHaveProperty('addons');

      const legacyState = Schema.parse({
        bases: [{ id: 'base-1', name: '北坡主基地', buildings: [{ name: '盟军发电厂' }] }],
      });
      expect(legacyState.bases[0]).not.toHaveProperty('forces');
      expect(legacyState.bases[0].buildings[0]).not.toHaveProperty('addons');
    });

    it('显式提供 Building.addons 与 Base.forces 时完整保留驻防与扩建明细', () => {
      const parsedForces = BaseForces.parse({
        troops: { 动员兵: 15, 磁暴步兵: 4 },
        vehicles: ['犀牛主战坦克', '犀牛主战坦克'],
        equipment: { 外骨骼装甲: 10 },
      });
      expect(parsedForces).toEqual({
        troops: { 动员兵: 15, 磁暴步兵: 4 },
        vehicles: ['犀牛主战坦克', '犀牛主战坦克'],
        equipment: { 外骨骼装甲: 10 },
      });

      const state = Schema.parse({
        bases: [
          {
            id: 'alpha',
            name: '一号基地',
            buildings: [
              {
                name: '盟军发电厂',
                state: '运转',
                addons: ['智能电网潮流调度中心'],
              },
            ],
            forces: {
              troops: { 美国大兵: 12 },
              vehicles: ['灰熊主战坦克'],
            },
          },
        ],
      });

      expect(state.bases[0].buildings[0].addons).toEqual(['智能电网潮流调度中心']);
      expect(state.bases[0].forces).toEqual({
        troops: { 美国大兵: 12 },
        vehicles: ['灰熊主战坦克'],
      });
      expect(state.bases[0].forces).not.toHaveProperty('equipment');
    });
  });

  describe('B2.1 · mergeVehicles 修复存量为 1 时纯数字载具漏加 Bug（BUG-ENTITY-02）', () => {
    it('当某型载具在账 1 辆（existingCount === 1）且战报报纯数字 犀牛坦克: 3 时，自动补齐差额至 3 辆', () => {
      const base = Schema.parse({
        forces: {
          vehicles: ['MCV', '犀牛坦克'],
        },
      });
      const r = parseMessageText(
        '<战况>\n部队:\n  载具:\n    MCV: 1\n    犀牛坦克: 3\n</战况>',
        base,
        {},
      );
      expect(r.quarantine).toHaveLength(0);
      expect(r.data.forces.vehicles).toEqual(['MCV', '犀牛坦克', '犀牛坦克', '犀牛坦克']);
    });

    it('当某型载具在账 1 辆且战报带量词后缀 犀牛坦克: "2辆" 时，按目标存量对齐为 2 辆；带变化后缀 "+2辆" 时按增量追加至 3 辆（BUG-R2-03）', () => {
      const base = Schema.parse({
        forces: {
          vehicles: ['犀牛坦克'],
        },
      });
      const rStock = parseMessageText(
        '<战况>\n部队:\n  载具:\n    犀牛坦克: 2辆\n</战况>',
        base,
        {},
      );
      expect(rStock.quarantine).toHaveLength(0);
      expect(rStock.data.forces.vehicles).toEqual(['犀牛坦克', '犀牛坦克']);

      const rDelta = parseMessageText(
        '<战况>\n部队:\n  载具:\n    犀牛坦克变化: "+2辆"\n</战况>',
        base,
        {},
      );
      expect(rDelta.quarantine).toHaveLength(0);
      expect(rDelta.data.forces.vehicles).toEqual(['犀牛坦克', '犀牛坦克', '犀牛坦克']);
    });

    it('账上尚无该型号（hit === -1）且报纯数字 3 时，直接入列 3 辆', () => {
      const base = Schema.parse({
        forces: {
          vehicles: ['MCV'],
        },
      });
      const r = parseMessageText(
        '<战况>\n部队:\n  载具:\n    灰熊坦克: 3\n</战况>',
        base,
        {},
      );
      expect(r.quarantine).toHaveLength(0);
      expect(r.data.forces.vehicles).toEqual(['MCV', '灰熊坦克', '灰熊坦克', '灰熊坦克']);
    });
  });

  describe('B2.2 · mapBuilding 支持解析 addons（扩建/扩建模块/挂件/附属模块/addons）', () => {
    it('支持单字符串与数组形态的扩建模块解析并自动去重，不落入 quarantine', () => {
      const base = Schema.parse({
        bases: [
          {
            id: 'beipo',
            name: '北坡主基地',
            buildings: [{ name: '盟军发电厂', state: '运转' }],
          },
        ],
      });

      const r1 = parseMessageText(
        [
          '<战况>',
          '基地:',
          '  - 名称: 北坡主基地',
          '    建筑:',
          '      - 名称: 盟军发电厂',
          '        状态: 运转',
          '        扩建: 智能电网潮流调度中心',
          '      - 名称: 盟军战车工厂',
          '        状态: 运转',
          '        扩建模块:',
          '          - 模块化维修臂',
          '          - 装甲自动焊接台',
          '          - 模块化维修臂',
          '</战况>',
        ].join('\n'),
        base,
        {},
      );

      expect(r1.quarantine).toHaveLength(0);
      const powerPlant = r1.data.bases[0].buildings.find(b => b.name === '盟军发电厂');
      const warFactory = r1.data.bases[0].buildings.find(b => b.name === '盟军战车工厂');
      expect(powerPlant?.addons).toEqual(['智能电网潮流调度中心']);
      expect(warFactory?.addons).toEqual(['模块化维修臂', '装甲自动焊接台']);

      // 再次通过 挂件 字段增量追加单字符串
      const r2 = parseMessageText(
        [
          '<战况>',
          '基地:',
          '  - 名称: 北坡主基地',
          '    建筑:',
          '      - 名称: 盟军发电厂',
          '        挂件: 超导电容阵列',
          '</战况>',
        ].join('\n'),
        r1.data,
        {},
      );
      expect(r2.quarantine).toHaveLength(0);
      const updatedPlant = r2.data.bases[0].buildings.find(b => b.name === '盟军发电厂');
      expect(updatedPlant?.addons).toEqual(['智能电网潮流调度中心', '超导电容阵列']);
    });
  });

  describe('B2.3 · mapBase 支持解析分基地驻防 forces 并维持全局总账兜底', () => {
    it('支持解析基地级 驻军/部队/兵力/forces（含人员、载具、装备），并自动向上兜底同步全局 forces', () => {
      const base = Schema.parse({
        bases: [
          { id: 'alpha', name: '北坡主基地', buildings: [{ name: '盟军建造厂' }] },
          { id: 'beta', name: '二号前哨站', buildings: [{ name: '盟军兵营' }] },
        ],
        forces: {
          troops: { 动员兵: 5 },
          vehicles: ['MCV'],
          equipment: {},
        },
      });

      const r = parseMessageText(
        [
          '<战况>',
          '基地:',
          '  - 名称: 北坡主基地',
          '    驻军:',
          '      人员:',
          '        动员兵: 10',
          '        工程师: 2',
          '      载具:',
          '        犀牛坦克: 2',
          '      装备:',
          '        脉冲步枪: 8',
          '  - 名称: 二号前哨站',
          '    部队:',
          '      步兵:',
          '        动员兵: 6',
          '      载具: [多功能步兵车]',
          '</战况>',
        ].join('\n'),
        base,
        {},
      );

      expect(r.quarantine).toHaveLength(0);
      expect(r.data.bases[0].forces).toEqual({
        troops: { 动员兵: 10, 工程师: 2 },
        vehicles: ['犀牛坦克', '犀牛坦克'],
        equipment: { 脉冲步枪: 8 },
      });
      expect(r.data.bases[1].forces).toEqual({
        troops: { 动员兵: 6 },
        vehicles: ['多功能步兵车'],
      });
      expect(r.data.bases[1].forces).not.toHaveProperty('equipment');

      // 全局总账自动向上兜底：动员兵 >= 10 + 6 = 16，工程师 = 2，载具含 MCV + 2 犀牛 + 1 步兵车
      expect(r.data.forces.troops).toEqual({
        动员兵: 16,
        工程师: 2,
      });
      expect(r.data.forces.vehicles).toEqual([
        'MCV',
        '犀牛坦克',
        '犀牛坦克',
        '多功能步兵车',
      ]);
      expect(r.data.forces.equipment).toEqual({
        脉冲步枪: 8,
      });
    });
  });
});
