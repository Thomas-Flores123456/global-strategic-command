import { describe, expect, it } from 'vitest';
import { Schema, SCHEMA_VERSION } from '../core/schema';
import {
  classifyBuildingRing,
  parseRelativeBuildingCoord,
  resolveBuildingRelativeCoord,
} from '../engines/buildingCoordEngine';
import { parseMessageText } from '../parse/parsePipeline';
import { deriveStrategicFeedforward, formatStrategicFeedforwardPrompt } from '../planning/strategicFeedforward';

describe('FD-34 PKG-A: 基地建筑相对于 MCV 原点 (0,0) 的双模坐标与三环自动布防引擎', () => {
  it('1. parseRelativeBuildingCoord 支持数组、对象、米制字符串与自然语言战术方位双向折算', () => {
    const fromArr = parseRelativeBuildingCoord([-2, 3], '盟军矿石精炼厂');
    expect(fromArr?.coord).toEqual({ x: -2, y: 3 });
    expect(fromArr?.bearing).toContain('西北');
    expect(fromArr?.bearing).toContain('(-2,+3)');

    const fromMeters = parseRelativeBuildingCoord('+200m, -100m', '盟军兵营');
    expect(fromMeters?.coord).toEqual({ x: 2, y: -1 });
    expect(fromMeters?.bearing).toContain('(+2,-1)');

    const fromCompass = parseRelativeBuildingCoord('西北侧 300米', '盟军发电厂');
    expect(fromCompass).not.toBeNull();
    expect(fromCompass!.coord.x).toBeLessThan(0);
    expect(fromCompass!.coord.y).toBeGreaterThan(0);
    expect(fromCompass!.bearing).toContain('西北');

    const fromCore = parseRelativeBuildingCoord('MCV原点', '盟军建造厂');
    expect(fromCore?.coord).toEqual({ x: 0, y: 0 });
    expect(fromCore?.bearing).toBe('MCV原点 (0,0)');
  });

  it('2. classifyBuildingRing 与 resolveBuildingRelativeCoord 按核心/内环/中环/外环确定性分配坐标', () => {
    expect(classifyBuildingRing('盟军建造厂')).toBe('core');
    expect(classifyBuildingRing('盟军发电厂')).toBe('inner');
    expect(classifyBuildingRing('超维暗网中继站')).toBe('inner');
    expect(classifyBuildingRing('盟军战车工厂')).toBe('mid');
    expect(classifyBuildingRing('爱国者飞弹')).toBe('outer');

    const mcv = resolveBuildingRelativeCoord({ name: '盟军建造厂' }, 0, 'base-north');
    expect(mcv.coord).toEqual({ x: 0, y: 0 });
    expect(mcv.ring).toBe('core');

    const pwr1 = resolveBuildingRelativeCoord({ name: '盟军发电厂' }, 1, 'base-north');
    const pwr1Repeat = resolveBuildingRelativeCoord({ name: '盟军发电厂' }, 1, 'base-north');
    expect(pwr1.coord).toEqual(pwr1Repeat.coord);
    expect(pwr1.ring).toBe('inner');
    expect(pwr1.distanceMeters).toBeGreaterThanOrEqual(150);
    expect(pwr1.distanceMeters).toBeLessThanOrEqual(350);

    const def1 = resolveBuildingRelativeCoord({ name: '爱国者飞弹' }, 4, 'base-north');
    expect(def1.ring).toBe('outer');
    expect(def1.distanceMeters).toBeGreaterThanOrEqual(600);
  });

  it('3. <态势> 基地.建筑 解析支持 坐标 / 方位 字段并写入 Building.coord 与 bearing，strategicFeedforward 输出相对坐标', () => {
    const initial = Schema.parse({
      bases: [
        {
          id: 'base-north',
          name: '北坡主基地',
          status: '运转中',
          buildings: [{ name: '盟军建造厂', state: '运转' }],
        },
      ],
    });

    const raw = `
<态势>
基地:
  - 名称: 北坡主基地
    建筑:
      - 名称: 盟军建造厂
        状态: 运转
        坐标: [0, 0]
      - 名称: 盟军发电厂
        状态: 运转
        方位: 西北侧 200米
      - 名称: 爱国者飞弹
        状态: 运转
        坐标: [6, -4]
</态势>
`;
    const res = parseMessageText(raw, initial);
    expect(res.quarantine).toHaveLength(0);
    const blds = res.data.bases[0]!.buildings;
    const pwr = blds.find(b => b.name === '盟军发电厂')!;
    expect(pwr.coord).toBeDefined();
    expect(pwr.bearing).toContain('西北');

    const pat = blds.find(b => b.name === '爱国者飞弹')!;
    expect(pat.coord).toEqual({ x: 6, y: -4 });
    expect(pat.bearing).toContain('(+6,-4)');

    const feed = deriveStrategicFeedforward({ floorId: 18, schemaVersion: SCHEMA_VERSION, data: res.data }, []);
    const prompt = formatStrategicFeedforwardPrompt(feed!);
    expect(prompt).toContain('盟军建造厂[运转｜MCV原点(0,0)]');
    expect(prompt).toContain('爱国者飞弹[运转｜外环·');
  });

  it('4. BUG-LIVE-12 (#40楼实机回归)：0.1格(10m)坐标精度不截断 [2.2, -2.2]，同批次多座同名盟军发电厂独立追加且顶层<态势>天气同步刷新 base.weather', () => {
    const initial = Schema.parse({
      meta: {
        date: '1972-05-15',
        weather: '晴',
        day_count: 15,
      },
      bases: [
        {
          id: '恶土前哨主基地',
          name: '恶土前哨主基地',
          status: '运转中',
          weather: '晴',
          power: { gen: 250, use: 285 },
          buildings: [
            { name: '盟军建造厂', layer: '核心区', state: '运转', coord: { x: 0, y: 0 }, bearing: 'MCV原点 (0,0)' },
            {
              name: '盟军发电厂',
              layer: '内环·东南280m',
              state: '运转',
              coord: { x: 2, y: -2 },
              bearing: '东南·280m (+2,-2)',
            },
          ],
        },
      ],
    });

    const raw40 = `<态势>
天气: 雷暴
基地:
  - 名称: 恶土前哨主基地
    建筑:
      - 名称: 盟军发电厂
        层级: 内环·东南280m
        坐标: [2, -2]
        状态: 运转
      - 名称: 盟军发电厂
        层级: 内环·东南310m
        坐标: [2.2, -2.2]
        状态: 运转
      - 名称: 航天发射中心
        层级: 东侧深谷隐蔽发射坪
        坐标: [5, 2]
        状态: 运转
</态势>`;

    const res = parseMessageText(raw40, initial);
    expect(res.quarantine).toHaveLength(0);
    expect(res.data.meta.weather).toBe('雷暴');
    const base = res.data.bases[0]!;
    expect(base.weather).toBe('雷暴');

    const powerPlants = base.buildings.filter(b => b.name === '盟军发电厂');
    expect(powerPlants).toHaveLength(2);
    expect(powerPlants[0]!.coord).toEqual({ x: 2, y: -2 });
    expect(powerPlants[1]!.coord).toEqual({ x: 2.2, y: -2.2 });
    expect(powerPlants[1]!.layer).toBe('内环·东南310m');
  });
});
