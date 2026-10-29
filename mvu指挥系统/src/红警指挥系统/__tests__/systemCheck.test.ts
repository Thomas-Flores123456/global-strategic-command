import { describe, expect, it } from 'vitest';
import { checkAssetQueueCross } from '../parse/systemCheck';

describe('systemCheck · R26 checkAssetQueueCross（FIX-P1-01 消除补产与同名建筑扩建误报）', () => {
  it('已有历史 done 记录或存量 >0 时，步兵补产与同名建筑扩建不报 R26', () => {
    // 1. 队列中已有同类型同名 done 历史记录 → 补产/扩建不误报
    const withDoneHistory = checkAssetQueueCross({
      queues: [
        { type: '生产', item: '动员兵', base: 'beipo', status: 'done' },
        { type: '生产', item: '动员兵', base: 'beipo', status: 'queued' },
        { type: '建造', item: '兵营', base: 'beipo', status: 'done' },
        { type: '建造', item: '兵营', base: 'beipo', status: 'active' },
      ],
      techDone: [],
      troops: { 动员兵: 5 },
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '兵营', state: '运转' }] }],
    });
    expect(withDoneHistory).toEqual([]);

    // 2. prevTroops / prevBases 已存在存量 → 补产/扩建不误报
    const withPrevStock = checkAssetQueueCross({
      queues: [
        { type: '生产', item: '动员兵', base: 'beipo', status: 'active' },
        { type: '建造', item: '兵营', base: 'beipo', status: 'queued' },
      ],
      techDone: [],
      troops: { 动员兵: 5 },
      prevTroops: { 动员兵: 5 },
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '兵营', state: '运转' }] }],
      prevBases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '兵营', state: '运转' }] }],
    });
    expect(withPrevStock).toEqual([]);
  });

  it('资产从 0 新增且无历史完成记录时，正常触发 R26 warn', () => {
    const issues = checkAssetQueueCross({
      queues: [
        { type: '生产', item: '动员兵', base: 'beipo', status: 'active' },
        { type: '建造', item: '兵营', base: 'beipo', status: 'active' },
      ],
      techDone: [],
      troops: { 动员兵: 5 },
      prevTroops: {},
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '兵营', state: '运转' }] }],
      prevBases: [{ id: 'beipo', name: '北坡基地', buildings: [] }],
    });
    expect(issues).toHaveLength(2);
    expect(issues.every(i => i.rule === 'R26' && i.level === 'warn')).toBe(true);
  });
});
