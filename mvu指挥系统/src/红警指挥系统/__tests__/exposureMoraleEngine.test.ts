import { describe, expect, it } from 'vitest';
import { Schema, SCHEMA_VERSION } from '../core/schema';
import {
  computeExposureFloor,
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
});
