import { afterEach, describe, expect, it } from 'vitest';
import {
  buildEntityCredibilityIndex,
  evaluateEntityCredibility,
  getRegisteredStaticEmbeddingTable,
  isSystemCatalogEntity,
  registerStaticEmbeddingTable,
  resolveSystemEntityName,
  type EntityCredibilityCatalogInput,
  type StaticInt8EmbeddingTable,
} from '../core/entityCredibility';
import { alignName, buildAlignIndex } from '../parse/parseTypesAndCanon';

function createWorldbookFixtureCatalog(): EntityCredibilityCatalogInput {
  return {
    researches: [
      {
        id: 'common.tech.stealth',
        name: '低可观测技术工学',
        aliases: ['隐身材料学', 'LO隐身工学'],
        line: '航空与电子',
        prereqs: ['航空工学基础', '电子对抗工学'],
      },
      {
        id: 'common.tech.smr',
        name: '小型模块化核能工学',
        aliases: ['SMR核能工学'],
        line: '能源与工业',
        prereqs: ['化石燃料发电学'],
      },
      {
        id: 'common.tech.fast_breeder',
        name: '钠冷快中子增殖堆工学',
        line: '能源与工业',
      },
      {
        id: 'all.tech.prism',
        name: '光棱聚焦理论',
        faction: '盟军',
        line: '盟军特色',
      },
      {
        id: 'sov.tech.tesla',
        name: '高压磁暴电弧学',
        faction: '苏联',
        line: '苏联特色',
      },
    ],
    buildings: [
      {
        id: 'all.bld.power',
        name: '盟军发电厂',
        faction: '盟军',
        upgraded_name: '盟军高效冷聚变电站',
      },
      {
        id: 'sov.bld.tesla_reactor',
        name: '苏联磁能反应炉',
        faction: '苏联',
      },
      {
        id: 'common.bld.refinery',
        name: '矿石精炼厂',
      },
    ],
    productions: [
      {
        id: 'all.unit.m1a2',
        name: 'M1A2主战坦克',
        aliases: ['艾布拉姆斯主战坦克'],
        faction: '盟军',
      },
      {
        id: 'sov.unit.t80bv',
        name: 'T-80BV主战坦克',
        faction: '苏联',
      },
      {
        id: 'all.unit.f16c',
        name: 'F-16C战隼战斗机',
        faction: '盟军',
      },
    ],
    retrofits: [
      {
        id: 'all.ret.m1a2_sep',
        name: 'M1A2主战坦克现代化改造',
        research: '复合装甲工学',
        target_unit: 'M1A2主战坦克',
        upgraded_name: 'M1A2 SEP v3主战坦克',
      },
      {
        id: 'common.ret.reverse_eng',
        name: '战地逆向工程实现',
        research: '情报分析工学',
      },
      {
        id: 'sov.ret.t80_upgrade',
        name: 'T-80BV反应装甲升级',
        research: '重装甲突击学',
      },
    ],
    projects: [
      {
        id: 'all.project.orbital_shipyard',
        name: '天基轨道船坞工程',
      },
      {
        id: 'sov.project.red_star_array',
        name: '赤星近地轨道投送阵列项目',
      },
    ],
    protocols: [
      {
        id: 'sov.protocol.combat_engineer_bunker',
        name: '战斗工兵—预制战斗碉堡协议',
        faction: '苏联',
      },
    ],
  };
}

describe('entityCredibility · 全系统通用实体语义向量与可信度对齐引擎 (FD-27 PKG-A)', () => {
  afterEach(() => {
    registerStaticEmbeddingTable(null);
  });

  it('L1: 精确匹配、繁简全半角归一与阵营前缀剥离均稳定返回 system_high (score === 1.0)', () => {
    const index = buildEntityCredibilityIndex(createWorldbookFixtureCatalog());

    const exactRes = evaluateEntityCredibility(index, '低可观测技术工学', { domain: 'research' });
    expect(exactRes.verdict).toBe('system_high');
    expect(exactRes.score).toBe(1.0);
    expect(exactRes.stage).toBe('exact');
    expect(exactRes.matchedName).toBe('低可观测技术工学');

    const prefixVariants = [
      '[盟军] 低可观测技术工学',
      '（盟军）低可观测技术工学',
      '(通用) 低可观测技术工学',
      '盟军·低可观测技术工学',
      '低可觀測技術工學',
    ];
    for (const q of prefixVariants) {
      const res = evaluateEntityCredibility(index, q);
      expect(res.verdict).toBe('system_high');
      expect(res.score).toBe(1.0);
      expect(res.matchedName).toBe('低可观测技术工学');
    }
  });

  it('L1: 世界书内置 aliases、玩家自定义 aliases 与升级链 upgraded_name 命中', () => {
    const index = buildEntityCredibilityIndex(createWorldbookFixtureCatalog(), {
      小堆发电科技: '小型模块化核能工学',
    });

    const wbAliasRes = evaluateEntityCredibility(index, 'LO隐身工学');
    expect(wbAliasRes.verdict).toBe('system_high');
    expect(wbAliasRes.stage).toBe('alias');
    expect(wbAliasRes.matchedName).toBe('低可观测技术工学');

    const userAliasRes = evaluateEntityCredibility(index, '小堆发电科技');
    expect(userAliasRes.verdict).toBe('system_high');
    expect(userAliasRes.stage).toBe('alias');
    expect(userAliasRes.matchedName).toBe('小型模块化核能工学');

    const upgRes = evaluateEntityCredibility(index, 'M1A2 SEP v3主战坦克');
    expect(upgRes.verdict).toBe('system_high');
    expect(upgRes.stage).toBe('upgrade_chain');
    expect(upgRes.matchedName).toBe('M1A2主战坦克现代化改造');
  });

  it('L2: 语序调换、壳词替换、同义词簇与工程后缀替换稳定返回 system_high (score >= 0.80)', () => {
    const index = buildEntityCredibilityIndex(createWorldbookFixtureCatalog());

    // 语序调换 + 壳词替换
    const smr1 = evaluateEntityCredibility(index, '模块化小型核能技术', { domain: 'research' });
    expect(smr1.verdict).toBe('system_high');
    expect(smr1.score).toBeGreaterThanOrEqual(0.8);
    expect(smr1.matchedName).toBe('小型模块化核能工学');

    // 同义词簇（核反应堆 <-> 核能）+ 壳词替换（研究 <-> 工学）
    const smr2 = evaluateEntityCredibility(index, '小型模块化核反应堆研究', { domain: 'research' });
    expect(smr2.verdict).toBe('system_high');
    expect(smr2.score).toBeGreaterThanOrEqual(0.8);
    expect(smr2.matchedName).toBe('小型模块化核能工学');

    // 同义前缀叠加 + 壳词替换（隐身低可观测技术 -> 低可观测技术工学）
    const stealth = evaluateEntityCredibility(index, '隐身低可观测技术', { domain: 'research' });
    expect(stealth.verdict).toBe('system_high');
    expect(stealth.score).toBeGreaterThanOrEqual(0.8);
    expect(stealth.matchedName).toBe('低可观测技术工学');

    // 工程后缀替换：实现 <-> 工程
    const eng1 = evaluateEntityCredibility(index, '战地逆向工程', { domain: 'retrofit' });
    expect(eng1.verdict).toBe('system_high');
    expect(eng1.score).toBeGreaterThanOrEqual(0.8);
    expect(eng1.matchedName).toBe('战地逆向工程实现');

    // 工程后缀替换：升级 <-> 现代化改造
    const eng2 = evaluateEntityCredibility(index, 'M1A2主战坦克升级', { domain: 'retrofit' });
    expect(eng2.verdict).toBe('system_high');
    expect(eng2.score).toBeGreaterThanOrEqual(0.8);
    expect(eng2.matchedName).toBe('M1A2主战坦克现代化改造');

    const eng3 = evaluateEntityCredibility(index, 'T-80BV反应装甲现代化改造', { domain: 'retrofit' });
    expect(eng3.verdict).toBe('system_high');
    expect(eng3.score).toBeGreaterThanOrEqual(0.8);
    expect(eng3.matchedName).toBe('T-80BV反应装甲升级');

    // 巨构工程后缀替换：工程 <-> 计划
    const proj = evaluateEntityCredibility(index, '天基轨道船坞计划', { domain: 'project' });
    expect(proj.verdict).toBe('system_high');
    expect(proj.score).toBeGreaterThanOrEqual(0.8);
    expect(proj.matchedName).toBe('天基轨道船坞工程');

    expect(isSystemCatalogEntity(index, '模块化小型核能技术', 'research')).toBe(true);
    expect(resolveSystemEntityName(index, '隐身低可观测技术', 'research')).toBe('低可观测技术工学');
  });

  it('L3: 面对真正全新的 EVA 自创词条返回 novel_eva (score < 0.52, matchedName: null)', () => {
    const index = buildEntityCredibilityIndex(createWorldbookFixtureCatalog());

    const novel1 = evaluateEntityCredibility(index, '幽能裂隙超时空折跃炉');
    expect(novel1.verdict).toBe('novel_eva');
    expect(novel1.score).toBeLessThan(0.52);
    expect(novel1.matchedName).toBeNull();

    const novel2 = evaluateEntityCredibility(index, '泰伯利亚晶化生物装甲学');
    expect(novel2.verdict).toBe('novel_eva');
    expect(novel2.score).toBeLessThan(0.52);
    expect(novel2.matchedName).toBeNull();

    expect(isSystemCatalogEntity(index, '幽能裂隙超时空折跃炉')).toBe(false);
    expect(resolveSystemEntityName(index, '泰伯利亚晶化生物装甲学')).toBeNull();
  });

  it('护栏验证：不同型号代号（T-72 vs T-80）或互斥阵营不得误判为 system_high', () => {
    const index = buildEntityCredibilityIndex(createWorldbookFixtureCatalog());

    const diffModel = evaluateEntityCredibility(index, 'T-72B3反应装甲现代化改造', { domain: 'retrofit' });
    expect(diffModel.verdict).not.toBe('system_high');
    expect(diffModel.score).toBeLessThan(0.52);

    const diffFaction = evaluateEntityCredibility(index, '尤里发电厂', { domain: 'building' });
    expect(diffFaction.verdict).not.toBe('system_high');
  });

  it('支持 StaticInt8EmbeddingTable 注册与余弦融合计算', () => {
    const dims = 8;
    // 构造 2 个高度同向的 Int8 向量（id=0 与 id=1 余弦为 1.0）
    const int8Data = new Int8Array([
      100, 80, 60, 40, 20, 10, 5, 0,
      100, 80, 60, 40, 20, 10, 5, 0,
    ]);
    const scales = new Float32Array([0.01, 0.01]);
    const table: StaticInt8EmbeddingTable = {
      dims,
      vocab: {
        棱镜: 0,
        光棱: 1,
      },
      int8Data,
      scales,
    };

    const catalog = createWorldbookFixtureCatalog();
    const indexWithoutStatic = buildEntityCredibilityIndex(catalog);
    const baselineRes = evaluateEntityCredibility(indexWithoutStatic, '棱镜折光阵列研究', { domain: 'research' });

    registerStaticEmbeddingTable(table);
    expect(getRegisteredStaticEmbeddingTable()).toBe(table);

    const indexWithStatic = buildEntityCredibilityIndex(catalog);
    const fusedRes = evaluateEntityCredibility(indexWithStatic, '棱镜折光阵列研究', { domain: 'research' });
    expect(fusedRes.score).toBeGreaterThanOrEqual(baselineRes.score);
  });

  it('parseTypesAndCanon 集成：alignName 通过 credibilityIndex 对齐高可信变体并放行真自创词条', () => {
    const catalog = createWorldbookFixtureCatalog();
    const credibilityIndex = buildEntityCredibilityIndex(catalog);
    const alignIdx = buildAlignIndex({
      names: catalog.researches!.map(r => r.name),
      aliases: {},
      credibilityIndex,
    });

    expect(alignName('低可观测技术工学', alignIdx)).toEqual({
      name: '低可观测技术工学',
      hit: 'exact',
    });
    expect(alignName('模块化小型核能技术', alignIdx)).toEqual({
      name: '小型模块化核能工学',
      hit: 'fuzzy',
    });
    expect(alignName('小型模块化核反应堆研究', alignIdx)).toEqual({
      name: '小型模块化核能工学',
      hit: 'fuzzy',
    });
    expect(alignName('隐身低可观测技术', alignIdx)).toEqual({
      name: '低可观测技术工学',
      hit: 'fuzzy',
    });
    expect(alignName('幽能裂隙超时空折跃炉', alignIdx)).toEqual({
      name: '幽能裂隙超时空折跃炉',
      hit: 'miss',
    });
  });

  it('性能预算门禁：连续 100 次跨全目录 evaluateEntityCredibility 查询总耗时 < 50ms', () => {
    const index = buildEntityCredibilityIndex(createWorldbookFixtureCatalog());
    const queries = [
      '低可观测技术工学',
      '[盟军] 低可观测技术工学',
      '模块化小型核能技术',
      '小型模块化核反应堆研究',
      '隐身低可观测技术',
      '战地逆向工程',
      'M1A2主战坦克升级',
      '幽能裂隙超时空折跃炉',
      '泰伯利亚晶化生物装甲学',
      '天基轨道船坞计划',
    ];

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const q = queries[i % queries.length];
      evaluateEntityCredibility(index, q);
    }
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(50);
  });
});
