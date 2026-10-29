import { describe, expect, it } from 'vitest';

import { RESEARCHES, deriveResearchableWithContext, type ResearchDef } from '../core/catalog';
import type { PrerequisiteBaseState, PrerequisiteContext } from '../core/prerequisites';

const base = (completed: string[] = []): PrerequisiteBaseState => ({
  existing: new Set(completed),
  completed: new Set(completed),
  running: new Set(completed),
});

const context = (techDone: string[] = [], current: string[] = [], other: string[] = []): PrerequisiteContext => ({
  techDone: new Set(techDone),
  selectedBaseId: 'alpha',
  bases: new Map([
    ['alpha', base(current)],
    ['beta', base(other)],
  ]),
  unitPresent: new Map(),
});

const byName = (name: string): ResearchDef => {
  const item = RESEARCHES.find(entry => entry.name === name);
  if (!item) throw new Error(`catalog 缺少研究：${name}`);
  return item;
};

const isResearchable = (name: string, prerequisiteContext: PrerequisiteContext): boolean =>
  deriveResearchableWithContext(RESEARCHES, prerequisiteContext, []).some(item => item.name === name);

describe('T1/T2 结构化条件数据迁移', () => {
  it('石油精炼学接受石油开采或合成燃料任一研究分支', () => {
    const item = byName('石油精炼学');
    expect(item.prereqs).toEqual([]);
    expect(item.requirements).toEqual({
      op: 'any',
      conditions: [
        { kind: 'research', name: '石油开采学' },
        { kind: 'research', name: '合成燃料学' },
      ],
    });

    expect(isResearchable(item.name, context())).toBe(false);
    expect(isResearchable(item.name, context(['石油开采学']))).toBe(true);
    expect(isResearchable(item.name, context(['合成燃料学']))).toBe(true);
  });

  it('地下工程学接受当前基地的强化地下掩蔽所或战斗实验室，不拼接其他基地', () => {
    const item = byName('地下工程学');
    expect(item.need_buildings).toEqual([]);
    expect(item.requirements).toEqual({
      op: 'any',
      conditions: [
        { kind: 'building', name: '强化地下掩蔽所', scope: 'current', state: 'completed' },
        { kind: 'building', name: '战斗实验室', scope: 'current', state: 'completed' },
      ],
    });

    expect(isResearchable(item.name, context())).toBe(false);
    expect(isResearchable(item.name, context([], ['强化地下掩蔽所']))).toBe(true);
    expect(isResearchable(item.name, context([], ['战斗实验室']))).toBe(true);
    expect(isResearchable(item.name, context([], [], ['战斗实验室']))).toBe(false);
  });

  it('同位素电源工学接受高级理论，或当前基地战斗实验室与建造厂核心同时在场', () => {
    const item = byName('同位素电源工学');
    expect(item.prereqs).toEqual([]);
    expect(item.need_buildings).toEqual([]);
    expect(item.requirements).toEqual({
      op: 'any',
      conditions: [
        { kind: 'research', name: '高级作战实验理论' },
        {
          op: 'all',
          conditions: [
            { kind: 'building', name: '战斗实验室', scope: 'current', state: 'completed' },
            { kind: 'building', name: '建造厂核心', scope: 'current', state: 'completed' },
          ],
        },
      ],
    });

    expect(isResearchable(item.name, context())).toBe(false);
    expect(isResearchable(item.name, context(['高级作战实验理论']))).toBe(true);
    expect(isResearchable(item.name, context([], ['战斗实验室']))).toBe(false);
    expect(isResearchable(item.name, context([], ['战斗实验室', '建造厂核心']))).toBe(true);
    expect(isResearchable(item.name, context([], ['战斗实验室'], ['建造厂核心']))).toBe(false);
  });

  it('修正高级作战实验理论展示漂移，并保留无法无损表达的停止项', () => {
    expect(byName('高级作战实验理论')).toMatchObject({
      prereq: '空军指挥部',
      need_buildings: ['空军指挥部'],
    });

    for (const name of ['化石燃料发电学', '风光发电学', '电力储能学']) {
      expect(byName(name)).toMatchObject({ prereq: '任一发电厂', need_buildings: ['发电厂'] });
      expect(byName(name).requirements).toBeUndefined();
    }
    expect(byName('石油开采学').requirements).toBeUndefined();
    expect(byName('地下掩蔽工学').requirements).toBeUndefined();
    expect(byName('近海护卫舰学').requirements).toBeUndefined();
  });
});
