/**
 * researchUnlocks 单测：反向推导作为「解锁了什么」的单一真源。
 * 背景：世界书 79 项研究 unlocks 写「无（研究线终点）」但实际有下游（如 便携反装甲系统工学 →
 * 便携反装甲系统 / 盟军反装甲重装步兵 / RPO-A）。面板、前馈、DLC 数据卡须同口径。
 */
import { describe, expect, it } from 'vitest';
import {
  flattenResearchUnlocks,
  formatResearchUnlocks,
  resolveResearchUnlocks,
  resolveResearchUnlocksText,
  type ResearchUnlockCatalogLike,
} from '../core/researchUnlocks';

const CATALOG: ResearchUnlockCatalogLike = {
  researches: [
    { name: '反装甲战术学', prereqs: [] },
    { name: '便携反装甲系统工学', prereqs: ['反装甲战术学'] },
    { name: '特种作战高级工学', prereqs: ['反装甲战术学'] },
    // requirements 树形前置（新式写法）
    {
      name: '智能反装甲弹药学',
      prereqs: [],
      requirements: {
        op: 'all',
        conditions: [
          { kind: 'research', name: '便携反装甲系统工学' },
          { kind: 'building', name: '战斗实验室', scope: 'current', state: 'completed' },
        ],
      },
    },
  ],
  productions: [
    { name: '便携反装甲系统', prereqs: ['便携反装甲系统工学', '反装甲战术学'] },
    { name: '盟军反装甲重装步兵', prereqs: ['反装甲战术学', '便携反装甲系统工学', '便携防空系统工学'] },
    { name: 'RPO-A“大黄蜂”单兵云爆火箭筒组', prereqs: ['单兵爆破器材工学', '便携反装甲系统工学'] },
    { name: '美国大兵', prereqs: ['基础步兵训练学'] },
    // 全半角/空格差异也要匹配（canon 双侧）
    { name: '标枪发射器套件', prereqs: ['便携 反装甲系统工学'] },
  ],
  buildings: [
    { name: '反坦克掩体', research: '便携反装甲系统工学', prereqs: [] },
    { name: '兵营', research: null, prereqs: [] },
  ],
  retrofits: [{ name: '步兵班反装甲现代化', research: '便携反装甲系统工学' }],
  protocols: [{ name: '伏击反装甲条令', prereqs: ['便携反装甲系统工学'] }],
};

describe('resolveResearchUnlocks · 反向推导', () => {
  it('按集合分组收齐全部下游（prereqs / research / requirements 原子三种引用形态）', () => {
    const u = resolveResearchUnlocks('便携反装甲系统工学', CATALOG);
    expect(u.hasDownstream).toBe(true);
    expect(u.productions).toEqual([
      '便携反装甲系统',
      '盟军反装甲重装步兵',
      'RPO-A“大黄蜂”单兵云爆火箭筒组',
      '标枪发射器套件',
    ]);
    expect(u.buildings).toEqual(['反坦克掩体']);
    expect(u.researches).toEqual(['智能反装甲弹药学']);
    expect(u.retrofits).toEqual(['步兵班反装甲现代化']);
    expect(u.protocols).toEqual(['伏击反装甲条令']);
  });

  it('接受 name/id 多键；自引用不算下游；真终点 hasDownstream=false', () => {
    const byId = resolveResearchUnlocks(['不存在的名字', '便携反装甲系统工学'], CATALOG);
    expect(byId.productions.length).toBe(4);

    const dead = resolveResearchUnlocks('智能反装甲弹药学', CATALOG);
    expect(dead.hasDownstream).toBe(false);
    expect(flattenResearchUnlocks(dead)).toEqual([]);
  });

  it('空键 / 空目录不炸', () => {
    expect(resolveResearchUnlocks('', CATALOG).hasDownstream).toBe(false);
    expect(resolveResearchUnlocks('x', null).hasDownstream).toBe(false);
    expect(resolveResearchUnlocks('x', {}).hasDownstream).toBe(false);
  });

  it('formatResearchUnlocks 条令体句式；flatten 序 = 生产→建筑→改装→协议→后续科技', () => {
    const u = resolveResearchUnlocks('便携反装甲系统工学', CATALOG);
    expect(formatResearchUnlocks(u)).toBe(
      '可生产：便携反装甲系统、盟军反装甲重装步兵、RPO-A“大黄蜂”单兵云爆火箭筒组、标枪发射器套件；' +
        '可建造：反坦克掩体；可改装：步兵班反装甲现代化；可攻关协议：伏击反装甲条令；后续科技：智能反装甲弹药学',
    );
    expect(flattenResearchUnlocks(u).slice(0, 6)).toEqual([
      '便携反装甲系统',
      '盟军反装甲重装步兵',
      'RPO-A“大黄蜂”单兵云爆火箭筒组',
      '标枪发射器套件',
      '反坦克掩体',
      '步兵班反装甲现代化',
    ]);
  });
});

describe('resolveResearchUnlocksText · 面板/数据卡文本', () => {
  it('有下游 → 反向推导覆盖手写「无（研究线终点）」', () => {
    const txt = resolveResearchUnlocksText({ name: '便携反装甲系统工学', unlocks: '无（研究线终点）' }, CATALOG);
    expect(txt.startsWith('可生产：便携反装甲系统')).toBe(true);
    expect(txt).not.toContain('无（研究线终点）');
  });

  it('零下游 → 回退作者手写叙事型解锁；手写为「无…」或空 → 返回空串', () => {
    expect(
      resolveResearchUnlocksText({ name: '智能反装甲弹药学', unlocks: '战区：全班组反装甲弹药升级' }, CATALOG),
    ).toBe('战区：全班组反装甲弹药升级');
    expect(resolveResearchUnlocksText({ name: '智能反装甲弹药学', unlocks: '无（研究线终点）' }, CATALOG)).toBe('');
    expect(resolveResearchUnlocksText({ name: '智能反装甲弹药学', unlocks: '' }, CATALOG)).toBe('');
  });
});
