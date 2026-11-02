import { describe, expect, it } from 'vitest';
import { Schema, SCHEMA_VERSION } from '../core/schema';
import {
  CIVIC_FACILITY_CATALOG,
  computeExposureFloor,
  evaluateCivicFacilities,
  explainExposureFloor,
  matchCivicFacilityDef,
  resolveExposureLevel,
  resolveMoraleStage,
  settleExposureAndMorale,
} from '../engines/exposureMoraleEngine';
import { parseMessageText } from '../parse/parsePipeline';
import { deriveStrategicFeedforward, formatStrategicFeedforwardPrompt } from '../planning/strategicFeedforward';

describe('FD-36 PKG-A: 暴露度双驱更新引擎 (EL-0~EL-4 / 常驻底线 / 自然衰减) 与民心五阶数值系统 (0~10)', () => {
  it('1. resolveExposureLevel 与 resolveMoraleStage 精确映射五级法定暴露状态与五阶民心效应', () => {
    expect(resolveExposureLevel(1.2).canonicalLabel).toBe('日常隐蔽（EL-0）');
    expect(resolveExposureLevel(3.0).canonicalLabel).toBe('轻微可疑（EL-1）');
    expect(resolveExposureLevel(5.5).canonicalLabel).toBe('战区警觉（EL-2）');
    expect(resolveExposureLevel(8.0).canonicalLabel).toBe('大势震动（EL-3）');
    expect(resolveExposureLevel(9.5).canonicalLabel).toBe('位面出圈（EL-4）');
    expect(resolveExposureLevel(9.5).irreversibleLock).toBe(true);

    expect(resolveMoraleStage(1.5).stage).toBe('沸反盈天');
    expect(resolveMoraleStage(1.5).chainMultiplier).toBe(0.75);
    expect(resolveMoraleStage(3.2).stage).toBe('人心惶惶');
    expect(resolveMoraleStage(5.0, { engaged: false, exposureValue: 1.0 }).stage).toBe('无人在意');
    expect(resolveMoraleStage(5.0, { engaged: false, exposureValue: 5.0 }).stage).toBe('观望顺从');
    expect(resolveMoraleStage(5.0).stage).toBe('观望顺从');
    expect(resolveMoraleStage(7.2).stage).toBe('安居归心');
    expect(resolveMoraleStage(7.2).exposureDriftPerTurn).toBe(-0.08);
    expect(resolveMoraleStage(9.0).stage).toBe('万众一心');
    expect(resolveMoraleStage(9.0).chainMultiplier).toBe(1.2);
  });

  it('2. computeExposureFloor 与 settleExposureAndMorale 支持多阵营/超武暴露底线、单轮增量安全钳制与自然冷却', () => {
    const state = {
      exposure: { value: 2.5 },
      morale: { value: 7.5 },
      bases: [
        {
          status: '运转中',
          buildings: [
            { name: '盟军建造厂', state: '运转', layer: '地表层' },
            { name: '苏联战车工厂', state: '运转', layer: '地表层' },
            { name: '天气控制机', state: '运转', layer: '地表层' },
          ],
        },
      ],
    };

    const floor = computeExposureFloor(state);
    // 盟军+苏联双阵营混建 (+0.4) + 天气控制机 (+0.6) = 1.0
    expect(floor).toBe(1.0);

    // 增量超限钳制测试：暴露度变化 +5.0 钳制为 +2.0，民心变化 +4.0 钳制为 +1.5
    const clampedRes = settleExposureAndMorale(state, {
      deltaExposure: 5.0,
      deltaMorale: 4.0,
    });
    expect(clampedRes.clampedExposureDelta).toBe(true);
    expect(clampedRes.exposure.value).toBe(4.5);
    expect(clampedRes.clampedMoraleDelta).toBe(true);
    expect(clampedRes.morale.value).toBe(9.0);
    expect(clampedRes.morale.level).toBe('万众一心');

    // 自然冷却测试：在安居归心 (7.5) 下，无暴露冲击时 EL-1 暴露度自动按 -0.08 冷却
    const coolRes = settleExposureAndMorale(state, { enableNaturalDrift: true });
    expect(coolRes.exposure.value).toBe(2.42);
  });

  it('3. <态势> 解析支持 暴露度变化 与 民心变化，并注入 strategicFeedforward', () => {
    const initial = Schema.parse({
      exposure: { value: 1.5 },
      morale: { value: 6.0, level: '观望顺从' },
    });

    const raw = `
<态势>
日期: 1972年11月10日 12:00
暴露度变化: +0.8
暴露事件: 东翼高地防空炮试射火光引起远方商队注意
民心变化: +1.2
民心事件: 向北坡周边流民聚落发放御寒物资与医疗药品
</态势>
`;
    const res = parseMessageText(raw, initial);
    expect(res.quarantine).toHaveLength(0);
    expect(res.data.exposure.value).toBe(2.3);
    expect(res.data.exposure.level).toBe('轻微可疑（EL-1）');
    expect(res.data.morale.value).toBe(7.2);
    expect(res.data.morale.level).toBe('安居归心');
    expect(res.data.morale.last_change).toContain('发放御寒物资');

    const feed = deriveStrategicFeedforward({ floorId: 20, schemaVersion: SCHEMA_VERSION, data: res.data }, []);
    const prompt = formatStrategicFeedforwardPrompt(feed!);
    expect(prompt).toContain('轻微可疑（EL-1）');
    expect(prompt).toContain('民心指数：7.2/10（安居归心');
  });

  it('4. FD-55: evaluateCivicFacilities 支持 8 类民生设施识别、正常供电滋养、缺电断供反噬与民间眼线解锁', () => {
    expect(CIVIC_FACILITY_CATALOG).toHaveLength(8);
    expect(matchCivicFacilityDef('净水与供水站')?.id).toBe('water_supply');
    expect(matchCivicFacilityDef('生态公园')?.id).toBe('eco_park');
    expect(matchCivicFacilityDef('社区环卫服务站')?.id).toBe('public_sanitation');
    expect(matchCivicFacilityDef('基础废物分拣站')?.id).toBe('waste_sorting');
    expect(matchCivicFacilityDef('生活污水处理站')?.id).toBe('domestic_wastewater');
    expect(matchCivicFacilityDef('深井泵站')?.id).toBe('deep_well_pump');
    expect(matchCivicFacilityDef('生态修复站')?.id).toBe('site_remediation');
    expect(matchCivicFacilityDef('环境监测站')?.id).toBe('env_monitoring');

    // 正常供电下：净水站 (+0.15/月) + 分拣站 (+0.10/月) + 生态公园 (+0.12/月) = +0.37/月
    const normalEval = evaluateCivicFacilities([
      {
        id: 'base-1',
        name: '北坡主基地',
        status: '运转中',
        power: { gen: 200, use: 120 },
        buildings: [
          { name: '净水与供水站', state: '运转' },
          { name: '基础废物分拣站', state: '运转' },
          { name: '生态公园与绿化设施', state: '运转' },
        ],
      },
    ]);
    expect(normalEval.installedFacilities).toHaveLength(3);
    expect(normalEval.totalMonthlyBonus).toBe(0.37);
    expect(normalEval.effectiveDailyBonus).toBe(0.0123);
    expect(normalEval.hasWaterOrSewageOutage).toBe(false);
    expect(normalEval.unlocksCivilInformantChannel).toBe(true);
    expect(normalEval.missingRecommendations.map(d => d.id)).toContain('public_sanitation');

    // 主电网赤字下：净水站触发断水告警 (-0.05/日)，生态公园保留 80%，分拣站保留 50%
    const deficitEval = evaluateCivicFacilities([
      {
        id: 'base-1',
        name: '北坡主基地',
        status: '运转中',
        power: { gen: 50, use: 120 },
        buildings: [
          { name: '净水与供水站', state: '运转' },
          { name: '基础废物分拣站', state: '运转' },
          { name: '生态公园与绿化设施', state: '运转' },
        ],
      },
    ]);
    expect(deficitEval.hasWaterOrSewageOutage).toBe(true);
    expect(deficitEval.powerOutagePenaltyDaily).toBe(0.05);
    expect(deficitEval.installedFacilities.find(f => f.defId === 'eco_park')?.effectiveMonthlyBonus).toBeCloseTo(
      0.096,
      4,
    );
    expect(
      deficitEval.installedFacilities.find(f => f.defId === 'waste_sorting')?.effectiveMonthlyBonus,
    ).toBeCloseTo(0.05, 4);
  });

  it('5. FD-55: explainExposureFloor 分基地混建/超武/伪装拆解及紧凑摘要生成', () => {
    const state = {
      exposure: { value: 3.0 },
      bases: [
        {
          id: 'b-main',
          name: '北坡主基地',
          status: '运转中',
          site_type: 'inland_canyon',
          buildings: [
            { name: '盟军建造厂', state: '运转', layer: '地表层' },
            { name: '苏联战车工厂', state: '运转', layer: '地表层' },
            { name: '天气控制机', state: '运转', layer: '地表层' },
            { name: '裂缝产生器', state: '运转', layer: '地表层' },
          ],
        },
      ],
    };

    const expExplain = explainExposureFloor(state);
    expect(expExplain.irreversibleLocked).toBe(false);
    expect(expExplain.baseBreakdowns).toHaveLength(1);
    const b0 = expExplain.baseBreakdowns[0];
    expect(b0.factionsInBase).toEqual(['盟军', '苏联']);
    expect(b0.factionMixPenalty).toBe(0.4);
    expect(b0.heavyBeacons).toEqual(['天气控制机']);
    expect(b0.heavyBeaconPenalty).toBe(0.6);
    expect(b0.stealthShields).toEqual(['裂缝产生器']);
    expect(b0.stealthShieldOffset).toBe(-0.35);
    expect(b0.siteModifier).toBe(-0.15);
    expect(b0.netBaseFloor).toBe(0.5);
    expect(expExplain.totalFloor).toBe(0.5);
    expect(expExplain.compactSummary).toBe('混建+0.4｜超武+0.6｜伪装-0.35｜选址-0.15');

    // EL-4 永久锁定测试
    const lockedExplain = explainExposureFloor({ exposure: { value: 9.2 }, bases: [] });
    expect(lockedExplain.irreversibleLocked).toBe(true);
    expect(lockedExplain.totalFloor).toBe(9.0);
    expect(lockedExplain.compactSummary).toBe('EL-4永久出圈锁定(>=9.0)');
  });

  it('6. FD-55: 平静轮次 <态势> 自然冷却与民心漂移生效，且支持解析基地局部民心 base.morale 与 Δt 民生滋养', () => {
    const initial = Schema.parse({
      exposure: { value: 3.0, level: '轻微可疑（EL-1）' },
      morale: { value: 7.5, level: '安居归心', engaged: true },
      bases: [
        {
          id: '北坡主基地',
          name: '北坡主基地',
          status: '运转中',
          power: { gen: 200, use: 100 },
          buildings: [{ name: '净水与供水站', state: '运转' }],
        },
      ],
    });

    // 平静轮次：<态势> 仅更新日期和基地局部民心，无显式暴露/民心变化，应自动触发 EL-1 自然冷却 + 人民掩护 (-0.08)
    const raw = `
<态势>
日期: 1972年11月12日 12:00
基地:
  - 名称: 北坡主基地
    民心: 7.8
</态势>
`;
    const res = parseMessageText(raw, initial);
    expect(res.quarantine).toHaveLength(0);
    expect(res.data.exposure.value).toBe(2.92);
    expect(res.data.bases[0].morale).toBe(7.8);

    // Δt 民生滋养测试：推进 30 天（43200 分钟），净水站 +0.15/月 滋养使民心从 7.5 升至 7.65
    const settledMonth = settleExposureAndMorale(initial, {
      deltaMinutes: 43200,
    });
    expect(settledMonth.morale.value).toBe(7.65);

    // 断水反噬测试：主电网赤字下推进 2 天（2880 分钟），净水站 -0.05/日 扣除 -0.10
    const outageState = {
      ...initial,
      bases: [
        {
          ...initial.bases[0],
          power: { gen: 50, use: 150 },
        },
      ],
    };
    const settledOutage = settleExposureAndMorale(outageState, {
      deltaMinutes: 2880,
    });
    expect(settledOutage.morale.value).toBe(7.4);
  });
});
