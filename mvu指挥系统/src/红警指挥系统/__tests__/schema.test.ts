import { describe, expect, it } from 'vitest';
import { Girl, Schema } from '../core/schema';

describe('ARM-02 · Schema 轻量向后兼容扩展（Girl.base 与 forces.equipment）', () => {
  it('Girl.base：旧存档缺省默认水合为空串 ""，显式提供时保留驻地归属', () => {
    const legacyGirl = Girl.parse({ name: '凌波', duty: '护卫', hp: '完好' });
    expect(legacyGirl.base).toBe('');

    const assignedGirl = Girl.parse({ name: '赤城', duty: '工程支援', hp: '轻损', base: 'b1' });
    expect(assignedGirl.base).toBe('b1');
  });

  it('forces.equipment：旧存档缺省无损水合为 {}，支持制式装备数值账本与 Girl.base 同存', () => {
    const legacyState = Schema.parse({});
    expect(legacyState.forces.equipment).toEqual({});
    expect(legacyState.forces.girls).toEqual([]);

    const hydrated = Schema.parse({
      forces: {
        girls: [{ name: '白露' }, { name: '夕立', base: 'alpha' }],
        troops: { 动员兵: 20 },
        vehicles: ['犀牛主战坦克'],
        equipment: { 外骨骼装甲: 15, 脉冲步枪: 40 },
      },
    });
    expect(hydrated.forces.girls[0].base).toBe('');
    expect(hydrated.forces.girls[1].base).toBe('alpha');
    expect(hydrated.forces.equipment).toEqual({ 外骨骼装甲: 15, 脉冲步枪: 40 });
  });
});
