/**
 * multiMcvCoLocateAndOutpostExpand.test.ts —— FD-38 · PKG-C 专项单元测试
 *
 * 覆盖：
 * 1. 同基地多 MCV 合署扩建（如 1号主基地 已有 盟军建造厂 50W，依次展开 MCV（苏联）与 MCV（尤里））：
 *    - 支持直接命中基地名「1号主基地」以及剥离括号/圆点位置修饰（「1号主基地（大厅西侧）」「1号主基地·地下大厅」）；
 *    - bases.length 保持为 1，绝不误建双胞胎空壳基地；
 *    - 1号主基地.buildings 累加包含 盟军建造厂 + 苏联建造厂 + 尤里建造厂；
 *    - 1号主基地.power.gen 从 50W 累加为 100W，再累加为 150W。
 * 2. 异地开辟分基地（声明「基地: 2号矿区前哨基地, 位置: 恶土·东侧矿脉裂隙」或「新基地: 2号矿区前哨基地」）：
 *    - 准确新建第 2 座独立基地（bases.length === 2）；
 *    - 两座基地各自独立持有 50W 建造厂基础发电，不重复双加。
 */
import { describe, expect, it } from 'vitest';
import { Schema } from '../core/schema';
import { deployBlockIndexFromCatalog } from '../engines/deploymentEngine';
import { settleFloor } from '../engines/settleFloor';
import {
  applyDeployments,
  resolveExistingBaseForDeploy,
  stripBaseLocationModifier,
} from '../parse/engAndDeployOrders';
import { newCtx } from '../parse/parseTypesAndCanon';
import { parseMessageText } from '../parse/parsePipeline';

const mkAlliedMainBaseState = (vehicles: string[] = ['MCV（苏联）', 'MCV（尤里）']) =>
  Schema.parse({
    meta: {
      world_id: 'cyber2077',
      date: '2042-06-16',
      day_count: 2,
      location: '恶土·东侧裂隙地下转运库大厅',
    },
    bases: [
      {
        id: '1号主基地',
        name: '1号主基地',
        location: '恶土·东侧裂隙地下转运库大厅',
        status: '运转中',
        power: { gen: 50, use: 0 },
        buildings: [{ name: '盟军建造厂', layer: '地下层', state: '运转' }],
        alerts: [],
      },
    ],
    forces: {
      vehicles,
    },
  });

describe('FD-38 · PKG-C：多 MCV 同址合署扩建 vs 异地开辟分基地消歧与多建造厂发电叠加', () => {
  it('1. stripBaseLocationModifier & resolveExistingBaseForDeploy：准确剥离括号与圆点位置修饰匹配既有基地，全新基地名返回 missing', () => {
    expect(stripBaseLocationModifier('1号主基地（大厅西侧）')).toBe('1号主基地');
    expect(stripBaseLocationModifier('1号主基地(西侧大厅)')).toBe('1号主基地');
    expect(stripBaseLocationModifier('1号主基地·地下大厅')).toBe('1号主基地');
    expect(stripBaseLocationModifier('2号矿区前哨基地')).toBe('2号矿区前哨基地');

    const bases = [{ id: '1号主基地', name: '1号主基地', buildings: [] }];
    expect(resolveExistingBaseForDeploy(bases, '1号主基地')).toEqual({
      status: 'resolved',
      baseId: '1号主基地',
    });
    expect(resolveExistingBaseForDeploy(bases, '1号主基地（大厅西侧）')).toEqual({
      status: 'resolved',
      baseId: '1号主基地',
    });
    expect(resolveExistingBaseForDeploy(bases, '1号主基地·地下大厅')).toEqual({
      status: 'resolved',
      baseId: '1号主基地',
    });
    expect(resolveExistingBaseForDeploy(bases, '2号矿区前哨基地').status).toBe('missing');
  });

  it('2. 同基地多 MCV 合署展开（含括号位置修饰「1号主基地（大厅西侧）」与圆点修饰「1号主基地·东翼」）：bases.length 保持为 1，发电 50 -> 100 -> 150', () => {
    const state1 = mkAlliedMainBaseState(['MCV（苏联）', 'MCV（尤里）']);

    // 第一步：在 1号主基地（大厅西侧）展开 MCV（苏联）
    const floor1Text = [
      '<事件>',
      '- 类型: MCV展开',
      '  载具: MCV（苏联）',
      '  基地: 1号主基地（大厅西侧）',
      '  理由: 喀秋莎在1号主基地地下大厅西侧就地合署展开苏联建造厂',
      '</事件>',
    ].join('\n');

    const parsed1 = parseMessageText(floor1Text, state1);
    expect(parsed1.deployOrders).toEqual([
      {
        vehicle: 'MCV（苏联）',
        action: '展开',
        base: '1号主基地',
        into: '苏联建造厂',
        duration_min: 0,
      },
    ]);

    const settled1 = settleFloor(state1, parsed1.data, floor1Text, {
      deployOrders: parsed1.deployOrders,
      eventDeclarations: parsed1.eventDeclarations,
    });

    expect(settled1.data.bases).toHaveLength(1);
    expect(settled1.data.bases[0].name).toBe('1号主基地');
    expect(settled1.data.bases[0].buildings.map(b => b.name)).toEqual(['盟军建造厂', '苏联建造厂']);
    expect(settled1.data.bases[0].power.gen).toBe(100);
    expect(settled1.data.forces.vehicles).toEqual(['MCV（尤里）']);

    // 第二步：继续在 1号主基地·东翼 展开 MCV（尤里）
    const floor2Text = [
      '<事件>',
      '- 类型: MCV展开',
      '  载具: MCV（尤里）',
      '  基地: 1号主基地·东翼',
      '  理由: 百合子在1号主基地东翼合署展开尤里建造厂',
      '</事件>',
    ].join('\n');

    const parsed2 = parseMessageText(floor2Text, settled1.data);
    const settled2 = settleFloor(settled1.data, parsed2.data, floor2Text, {
      deployOrders: parsed2.deployOrders,
      eventDeclarations: parsed2.eventDeclarations,
    });

    expect(settled2.data.bases).toHaveLength(1);
    expect(settled2.data.bases[0].buildings.map(b => b.name)).toEqual([
      '盟军建造厂',
      '苏联建造厂',
      '尤里建造厂',
    ]);
    expect(settled2.data.bases[0].power.gen).toBe(150);
    expect(settled2.data.forces.vehicles).toEqual([]);
  });

  it('3. engAndDeployOrders.applyDeployments 与 <部署> 标签块同基地合署展开：剥离括号修饰并累加发电量为 100W', () => {
    const state1 = mkAlliedMainBaseState(['MCV（苏联）']);
    const deployIndex = deployBlockIndexFromCatalog({});

    // 直接验证 engAndDeployOrders.applyDeployments 剥离「1号主基地（西侧大厅）」修饰词
    const ctx = { ...newCtx(), deployIndex };
    applyDeployments([{ 展开: 'MCV（苏联）', 基地: '1号主基地（西侧大厅）' }], structuredClone(state1), ctx);
    expect(ctx.deployOrders).toHaveLength(1);
    expect(ctx.deployOrders[0]).toMatchObject({
      vehicle: 'MCV（苏联）',
      action: '展开',
      base: '1号主基地',
      into: '苏联建造厂',
    });
    expect(ctx.deployOrders[0].new_base).toBeUndefined();

    // 验证 <部署> 标签块 + settleFloor 发电量累加为 100W
    const rawText = '<战况>\n<部署>\n展开: MCV（苏联） | 基地: 1号主基地\n</部署>\n</战况>';
    const parsed = parseMessageText(rawText, state1, { deployIndex });
    expect(parsed.deployOrders).toHaveLength(1);

    const settled = settleFloor(state1, parsed.data, rawText, {
      deployOrders: parsed.deployOrders,
    });
    expect(settled.data.bases).toHaveLength(1);
    expect(settled.data.bases[0].buildings.map(b => b.name)).toEqual(['盟军建造厂', '苏联建造厂']);
    expect(settled.data.bases[0].power.gen).toBe(100);
  });

  it('4. 异地开辟分基地：声明「基地: 2号矿区前哨基地, 位置: 恶土·东侧矿脉裂隙」或「新基地: 北坡二号基地」准确创建独立第 2/3 座基地且各享 50W 发电', () => {
    const state1 = mkAlliedMainBaseState(['MCV（苏联）', 'MCV（尤里）']);

    // 方式 A：在 <事件> MCV展开 中写全新基地名「基地: 2号矿区前哨基地, 位置: 恶土·东侧矿脉裂隙」
    const outpost1Text = [
      '<事件>',
      '- 类型: MCV展开',
      '  载具: MCV（苏联）',
      '  基地: 2号矿区前哨基地',
      '  位置: 恶土·东侧矿脉裂隙',
      '  理由: 派喀秋莎前往东侧矿脉裂隙开辟2号矿区前哨基地',
      '</事件>',
    ].join('\n');

    const parsed1 = parseMessageText(outpost1Text, state1);
    expect(parsed1.deployOrders).toHaveLength(1);
    expect(parsed1.deployOrders[0]).toMatchObject({
      vehicle: 'MCV（苏联）',
      action: '展开',
      base: '2号矿区前哨基地',
      into: '苏联建造厂',
      new_base: {
        name: '2号矿区前哨基地',
        location: '恶土·东侧矿脉裂隙',
      },
    });

    const settled1 = settleFloor(state1, parsed1.data, outpost1Text, {
      deployOrders: parsed1.deployOrders,
      eventDeclarations: parsed1.eventDeclarations,
    });

    expect(settled1.data.bases).toHaveLength(2);
    expect(settled1.data.bases[0].name).toBe('1号主基地');
    expect(settled1.data.bases[0].power.gen).toBe(50);
    expect(settled1.data.bases[0].buildings.map(b => b.name)).toEqual(['盟军建造厂']);

    expect(settled1.data.bases[1].name).toBe('2号矿区前哨基地');
    expect(settled1.data.bases[1].location).toBe('恶土·东侧矿脉裂隙');
    expect(settled1.data.bases[1].status).toBe('运转中');
    expect(settled1.data.bases[1].power.gen).toBe(50);
    expect(settled1.data.bases[1].buildings.map(b => b.name)).toEqual(['苏联建造厂']);

    // 方式 B：显式声明「新基地: 北坡三号基地」开辟第 3 座分基地
    const outpost2Text = [
      '<事件>',
      '- 类型: MCV展开',
      '  载具: MCV（尤里）',
      '  新基地: 北坡三号基地',
      '  位置: 恶土·北坡高地',
      '  理由: 在北坡高地建立第三座分基地',
      '</事件>',
    ].join('\n');

    const parsed2 = parseMessageText(outpost2Text, settled1.data);
    const settled2 = settleFloor(settled1.data, parsed2.data, outpost2Text, {
      deployOrders: parsed2.deployOrders,
      eventDeclarations: parsed2.eventDeclarations,
    });

    expect(settled2.data.bases).toHaveLength(3);
    expect(settled2.data.bases[2].name).toBe('北坡三号基地');
    expect(settled2.data.bases[2].power.gen).toBe(50);
    expect(settled2.data.bases[2].buildings.map(b => b.name)).toEqual(['尤里建造厂']);
  });
});
