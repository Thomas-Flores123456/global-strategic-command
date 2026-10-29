import { describe, expect, it } from 'vitest';
import {
  getTechLinePriority,
  parseTechMetaCost,
  sortTechByLineGroups,
  sortTechResearches,
  type TechCardState,
  type UiResearch,
} from '../ui/panels/panelTechHelpers';

function makeResearch(overrides: Partial<UiResearch> & { name: string; line: string }): UiResearch {
  return {
    name: overrides.name,
    line: overrides.line,
    tier: overrides.tier ?? 1,
    meta: overrides.meta ?? '300 · 约3日',
    dynamic: overrides.dynamic ?? false,
    prereqMet: overrides.prereqMet ?? true,
    missingPrereqs: overrides.missingPrereqs ?? [],
  };
}

describe('panelTechHelpers · 科技领域战略主次与卡片多维智能排序', () => {
  it('getTechLinePriority 将通用、主建筑、工业基础与军事主战领域排在环保与市政设施之前', () => {
    expect(getTechLinePriority('通用')).toBeLessThan(getTechLinePriority('主建筑'));
    expect(getTechLinePriority('主建筑')).toBeLessThan(getTechLinePriority('工业基础'));
    expect(getTechLinePriority('工业基础')).toBeLessThan(getTechLinePriority('人员'));
    expect(getTechLinePriority('人员')).toBeLessThan(getTechLinePriority('陆地载具'));
    expect(getTechLinePriority('陆地载具')).toBeLessThan(getTechLinePriority('盟军特色'));
    expect(getTechLinePriority('盟军特色')).toBeLessThan(getTechLinePriority('环保与公共设施'));
    expect(getTechLinePriority('环保与公共设施')).toBeLessThan(getTechLinePriority('动态研究'));
  });

  it('sortTechByLineGroups 修复世界书环保优先顺序，确保左侧导航栏按战略主次排列', () => {
    const rawItems: UiResearch[] = [
      makeResearch({ name: '生活污水处理工学', line: '环保与公共设施', prereqMet: false }),
      makeResearch({ name: '基础步兵训练学', line: '通用', prereqMet: true }),
      makeResearch({ name: '矿石精炼增效学', line: '工业基础', prereqMet: true }),
      makeResearch({ name: '相变微流道散热工学', line: '机娘保障工程', prereqMet: false }),
    ];
    const grouped = sortTechByLineGroups(rawItems, r => (r.prereqMet ? 'ready' : 'locked'), 'tactical');
    expect(Object.keys(grouped)).toEqual(['通用', '工业基础', '机娘保障工程', '环保与公共设施']);
  });

  it('sortTechResearches (tactical 默认模式) 按 active -> queued -> ready -> locked(缺最少前置优先) -> done 排序', () => {
    const items: UiResearch[] = [
      makeResearch({
        name: '碳捕集与利用工学',
        line: '环保与公共设施',
        tier: 2,
        meta: '800 · 约6日',
        prereqMet: false,
        missingPrereqs: [
          { name: '大气监测与治理工学', kind: 'tech' },
          { name: '危险废物安全处置工学', kind: 'tech' },
          { name: '战斗实验室', kind: 'building' },
        ],
      }),
      makeResearch({
        name: '生活污水处理工学',
        line: '环保与公共设施',
        tier: 1,
        meta: '400 · 约3日',
        prereqMet: false,
        missingPrereqs: [
          { name: '基础环境工程学', kind: 'tech' },
          { name: '基础废物分拣站', kind: 'building' },
        ],
      }),
      makeResearch({
        name: '基础环境工程学',
        line: '环保与公共设施',
        tier: 1,
        meta: '300 · 约3日',
        prereqMet: true,
      }),
      makeResearch({
        name: '基础步兵训练学',
        line: '通用',
        tier: 1,
        meta: '200 · 约2日',
        prereqMet: true,
      }),
      makeResearch({
        name: '制式步枪工艺',
        line: '人员',
        tier: 1,
        meta: '250 · 约2日',
        prereqMet: false,
        missingPrereqs: [{ name: '兵营', kind: 'building' }],
      }),
      makeResearch({
        name: '装甲载具工学',
        line: '通用',
        tier: 1,
        meta: '300 · 约3日',
        prereqMet: true,
      }),
      makeResearch({
        name: '早期已攻克科技',
        line: '通用',
        tier: 1,
        meta: '100 · 约1日',
        prereqMet: true,
      }),
    ];

    const stateMap: Record<string, TechCardState> = {
      碳捕集与利用工学: 'locked',
      生活污水处理工学: 'locked',
      基础环境工程学: 'ready',
      基础步兵训练学: 'ready',
      制式步枪工艺: 'locked',
      装甲载具工学: 'active',
      早期已攻克科技: 'done',
    };

    const sorted = sortTechResearches(items, r => stateMap[r.name] ?? 'locked', 'tactical');
    expect(sorted.map(r => r.name)).toEqual([
      '装甲载具工学', // 1. active 攻关中永远置顶
      '基础步兵训练学', // 2. ready 可立项（通用 优先级高于 环保）
      '基础环境工程学', // 3. ready 可立项（环保）
      '制式步枪工艺', // 4. locked 待研制 T1（仅缺 1 项前置，排在缺 2 项前置的前面）
      '生活污水处理工学', // 5. locked 待研制 T1（缺 2 项前置）
      '碳捕集与利用工学', // 6. locked 待研制 T2（代际更高且缺 3 项前置）
      '早期已攻克科技', // 7. done 已攻克自动沉底，不占首屏操作位
    ]);
  });

  it('sortTechResearches 支持 tier（代际梯度）与 line（领域归类）排序切换', () => {
    const items: UiResearch[] = [
      makeResearch({ name: 'T2通用科技', line: '通用', tier: 2, meta: '500 · 约4日', prereqMet: false }),
      makeResearch({ name: 'T1环保科技', line: '环保与公共设施', tier: 1, meta: '300 · 约3日', prereqMet: true }),
      makeResearch({ name: 'T1通用科技', line: '通用', tier: 1, meta: '200 · 约2日', prereqMet: true }),
    ];
    const stateOf = (r: UiResearch): TechCardState => (r.prereqMet ? 'ready' : 'locked');

    const byTier = sortTechResearches(items, stateOf, 'tier');
    expect(byTier.map(r => r.name)).toEqual(['T1通用科技', 'T1环保科技', 'T2通用科技']);

    const byLine = sortTechResearches(items, stateOf, 'line');
    expect(byLine.map(r => r.name)).toEqual(['T1通用科技', 'T2通用科技', 'T1环保科技']);
    expect(parseTechMetaCost('350 · 约3日')).toBe(350);
  });
});
