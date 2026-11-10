/**
 * PLAN-AUTH-01 · 排产规划层基地权限与跨基地母体规则
 * 1. 建造厂核心等根核心已存在时不再作为可建候选，沙盒点名应返回 already_present；
 * 2. 普通建筑的母体前置默认共享全战区运转中建筑（主基地兵营/战车工厂可支撑副基地野战医疗站/战地维修所）；
 * 3. 建造中、排队中的母体不算运转，不能共享；
 * 4. 显式 local_only / scope:'current' 条目仍只看本地；
 * 5. FCV 副基地仍受建造权限限制，不能借此获得主基地专属军工厂权限。
 */
import { describe, expect, it } from 'vitest';
import type { EffectiveCatalog } from '../core/catalogEffective';
import { FACTION_DEFS } from '../core/catalog';
import { Schema, type StatData } from '../core/schema';
import { buildPlanningContext } from '../planning/planningContext';
import { computePlanFingerprint, type ParsedPlanningIntent } from '../planning/planningParser';
import { runPlanningSandbox } from '../planning/planningSandbox';

function createCatalog(): EffectiveCatalog {
  return {
    researches: [],
    buildings: [
      { name: '建造厂核心', cost: 0, power: 0, research: null, prereqs: [], need_buildings: [], desc: '根核心' },
      { name: '发电厂', cost: 800, power: 200, research: null, prereqs: [], need_buildings: [], tags: ['电力设施'], desc: '基础电力' },
      { name: '野战医疗站', cost: 600, power: -10, research: null, prereqs: [], need_buildings: ['兵营'], tags: ['公共设施'], desc: '医疗' },
      { name: '战地维修所', cost: 700, power: -15, research: null, prereqs: [], need_buildings: ['战车工厂'], tags: ['物流仓储'], desc: '维修' },
      { name: '机要档案库', cost: 500, power: -5, research: null, prereqs: [], need_buildings: ['兵营'], tags: ['公共设施'], desc: '本地机要', local_only: true } as unknown as EffectiveCatalog['buildings'][number],
      { name: '战车工厂', cost: 2000, power: -50, research: null, prereqs: [], need_buildings: ['发电厂'], tags: ['载具建造'], desc: '军工主厂' },
    ],
    productions: [],
    retrofits: [],
    projects: [],
    protocols: [],
    factionDefs: FACTION_DEFS,
  } as unknown as EffectiveCatalog;
}

function createState(opts?: { mainBarracksState?: string; mainFactoryState?: string }): StatData {
  return Schema.parse({
    economy: { credits: 50000, credits_daily: 1000 },
    command: { unlocked_factions: ['allied'], primary_faction: 'allied' },
    bases: [
      {
        id: 'base_1',
        name: '主基地',
        status: '隐蔽中',
        buildings: [
          { name: '建造厂核心', state: '运转' },
          { name: '发电厂', state: '运转' },
          { name: '兵营', state: opts?.mainBarracksState ?? '运转' },
          { name: '战车工厂', state: opts?.mainFactoryState ?? '运转' },
        ],
      },
      {
        id: 'base_2',
        name: '前哨',
        status: '警戒',
        buildings: [
          { name: '前沿工地', state: '运转' },
          { name: '发电厂', state: '运转' },
        ],
      },
    ],
    tech: { done: [] },
  });
}

function intent(actions: ParsedPlanningIntent['actions']): ParsedPlanningIntent {
  const mode = 'delegate_once' as const;
  return {
    version: 1,
    request_ref: 'req-auth',
    mode,
    actions,
    fingerprint: computePlanFingerprint({ mode, actions }),
    raw: '<排产计划></排产计划>',
  };
}

describe('PLAN-AUTH-01 · 规划层基地权限与跨基地母体规则', () => {
  it('主基地已有建造厂核心时，建造厂核心不再是可建候选，沙盒点名返回 already_present', () => {
    const catalog = createCatalog();
    const state = createState();
    const ctx = buildPlanningContext(state, catalog, { targetBaseRef: 'base_1' })!;
    expect(ctx.produceableItems.map(i => i.name)).not.toContain('建造厂核心');
    const blocked = ctx.blockedCatalogItems!.find(i => i.name === '建造厂核心');
    expect(blocked?.blocked?.code).toBe('already_present');

    const res = runPlanningSandbox(
      state,
      intent([{ op: 'enqueue', base_ref: 'base_1', catalog_ref: '建造厂核心', quantity: 1, kind: '建造' }]),
      catalog,
    );
    const action = res.receipt.actions.find(a => a.target === '建造厂核心');
    expect(action?.status).toBe('rejected');
    expect(action?.blocker_code).toBe('already_present');
    expect(res.sandboxState.queues.filter(q => q.item === '建造厂核心')).toHaveLength(0);
  });

  it('副基地借用主基地运转中的兵营/战车工厂：野战医疗站与战地维修所可在 base_2 获批', () => {
    const catalog = createCatalog();
    const state = createState();
    const ctx = buildPlanningContext(state, catalog, { targetBaseRef: 'base_2' })!;
    const names = ctx.produceableItems.map(i => i.name);
    expect(names).toContain('野战医疗站');
    expect(names).toContain('战地维修所');

    const res = runPlanningSandbox(
      state,
      intent([
        { op: 'enqueue', base_ref: 'base_2', catalog_ref: '野战医疗站', quantity: 1, kind: '建造' },
        { op: 'enqueue', base_ref: 'base_2', catalog_ref: '战地维修所', quantity: 1, kind: '建造' },
      ]),
      catalog,
    );
    expect(res.receipt.actions.map(a => [a.target, a.status])).toEqual([
      ['野战医疗站', 'accepted'],
      ['战地维修所', 'accepted'],
    ]);
  });

  it('主基地母体仅在建/停机时不可共享：base_2 的野战医疗站与战地维修所被 missing_building 阻塞', () => {
    const catalog = createCatalog();
    const state = createState({ mainBarracksState: '建造中', mainFactoryState: '停机' });
    const ctx = buildPlanningContext(state, catalog, { targetBaseRef: 'base_2' })!;
    const names = ctx.produceableItems.map(i => i.name);
    expect(names).not.toContain('野战医疗站');
    expect(names).not.toContain('战地维修所');
    const medical = ctx.blockedCatalogItems!.find(i => i.name === '野战医疗站');
    expect(medical?.blocked?.code).toBe('missing_building');
    expect(medical?.blocked?.missingItems).toContain('兵营');
  });

  it('local_only 条目仍只看本地：机要档案库在 base_2 因缺少本地兵营被阻塞，在 base_1 可建', () => {
    const catalog = createCatalog();
    const state = createState();
    const ctxOutpost = buildPlanningContext(state, catalog, { targetBaseRef: 'base_2' })!;
    expect(ctxOutpost.produceableItems.map(i => i.name)).not.toContain('机要档案库');
    const ctxMain = buildPlanningContext(state, catalog, { targetBaseRef: 'base_1' })!;
    expect(ctxMain.produceableItems.map(i => i.name)).toContain('机要档案库');
  });

  it('FCV 副基地不因共享母体而越权：战车工厂等军工主厂在 base_2 不可建，在 base_1 可建', () => {
    const catalog = createCatalog();
    const state = createState();
    const ctxOutpost = buildPlanningContext(state, catalog, { targetBaseRef: 'base_2' })!;
    expect(ctxOutpost.produceableItems.map(i => i.name)).not.toContain('战车工厂');
    const ctxMain = buildPlanningContext(state, catalog, { targetBaseRef: 'base_1' })!;
    expect(ctxMain.produceableItems.map(i => i.name)).toContain('战车工厂');
  });
});
