/**
 * catalogEffective 纯合并模块回归（RAC-SHARED-01）
 * 覆盖：空 $dlc、损坏 overlay 排除、安装序、后装胜前装、base 不被 overlay 删除、$dlc 参数注入（不触酒馆变量）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BUILDINGS,
  FACTION_DEFS,
  PRODUCTIONS,
  PROJECTS,
  PROTOCOLS,
  protocols as STATIC_PROTOCOLS,
  RESEARCHES,
  RETROFITS,
} from '../core/catalog';
import type { BuildingDef, ProductionDef, ProtocolCatalogItem, ResearchDef } from '../core/catalog';
import {
  buildProtocolIdIndex,
  buildRevealedByProtocolMap,
  computeHiddenTechIds,
  filterVisibleResearches,
  isCatalogOverlayUsable,
  mergeByName,
  mergeEffectiveCatalog,
  normalizeWbProtocols,
  readDlcOverlaysFromRegistry,
  resolveProtocolIdByName,
  resolveProtocolNameById,
  worldbookProtocolToDef,
  type DlcOverlay,
} from '../core/catalogEffective';
import { LEGACY_PROTOCOL_DEFINITIONS } from '../core/schema';
import { useDataStore } from '../composables/store';
import { setCachedDynamicCatalog, useCatalogStore } from '../composables/useCatalog';

const research = (name: string, cost = 100): ResearchDef => ({
  name,
  cost,
  eta: '约1日',
  line: '测试线',
  tier: 1,
  unlocks: '测试物',
  prereq: '——',
  prereqs: [],
  desc: `${name} 测试研究`,
});

const building = (name: string, cost = 500): BuildingDef => ({
  name,
  cost,
  power: -50,
  research: null,
  prereqs: [],
  need_buildings: [],
  desc: `${name} 测试建筑`,
});

const production = (name: string, cost = 300): ProductionDef => ({
  name,
  cost,
  need_building: '测试兵营',
  need_buildings: ['测试兵营'],
  desc: `${name} 测试单位`,
});

const names = <T extends { name: string }>(items: T[]) => items.map(item => item.name);

afterEach(() => {
  delete (globalThis as Record<string, unknown>).getVariables;
});

describe('readDlcOverlaysFromRegistry：$dlc 参数注入', () => {
  it('空/非对象注册表 → 空 overlay 列表', () => {
    expect(readDlcOverlaysFromRegistry(undefined)).toEqual([]);
    expect(readDlcOverlaysFromRegistry(null)).toEqual([]);
    expect(readDlcOverlaysFromRegistry({})).toEqual([]);
    expect(readDlcOverlaysFromRegistry([])).toEqual([]);
    expect(readDlcOverlaysFromRegistry('bad')).toEqual([]);
  });

  it('不调用 getVariables，只消费注入的注册表对象', () => {
    const gv = vi.fn(() => ({ $dlc: { fromHost: { installedAt: '1', data: {} } } }));
    (globalThis as Record<string, unknown>).getVariables = gv;
    const overlays = readDlcOverlaysFromRegistry({ injected: { installedAt: '1', data: {} } });
    expect(gv).not.toHaveBeenCalled();
    expect(overlays.map(o => o.id)).toEqual(['injected']);
  });

  it('按 installedAt 安装序排序（对象键序不算数）', () => {
    const overlays = readDlcOverlaysFromRegistry({
      later: { installedAt: '2026-09-03T00:00:00Z', data: {} },
      earliest: { installedAt: '2026-09-01T00:00:00Z', data: {} },
      middle: { installedAt: '2026-09-02T00:00:00Z', data: {} },
    });
    expect(overlays.map(o => o.id)).toEqual(['earliest', 'middle', 'later']);
  });

  it('损坏条目保留并打上 dataError，但不可进入有效目录', () => {
    const overlays = readDlcOverlaysFromRegistry({
      notObject: 'oops',
      badData: { installedAt: '1', data: 'oops' },
      ok: { installedAt: '2', data: { researches: [research('注入研究')] }, books: ['书', 3], codexSeeds: ['种子'] },
    });
    const byId = Object.fromEntries(overlays.map(o => [o.id, o]));
    expect(byId.notObject.dataError).toBe('注册表条目必须是对象');
    expect(byId.badData.dataError).toBe('注册表 data 必须是对象');
    expect(byId.ok.dataError).toBeUndefined();
    expect(byId.ok.books).toEqual(['书']);
    expect(byId.ok.codexSeeds).toEqual(['种子']);
    expect(isCatalogOverlayUsable(byId.notObject)).toBe(false);
    expect(isCatalogOverlayUsable(byId.badData)).toBe(false);
    expect(isCatalogOverlayUsable(byId.ok)).toBe(true);
  });
});

describe('mergeByName：按 name 键覆盖/追加', () => {
  it('同名覆盖保留 base 原位，新名追加到尾部，后装胜前装', () => {
    const base = [research('甲', 1), research('乙', 1)];
    const merged = mergeByName(base, [[research('乙', 2), research('丙', 2)], undefined, [research('丙', 3)]]);
    expect(names(merged)).toEqual(['甲', '乙', '丙']);
    expect(merged[1].cost).toBe(2);
    expect(merged[2].cost).toBe(3);
    expect(base[1].cost).toBe(1); // 不改写输入
  });
});

describe('mergeEffectiveCatalog：有效目录合并', () => {
  it('空 $dlc → 有效目录等于 base 目录', () => {
    const catalog = mergeEffectiveCatalog(readDlcOverlaysFromRegistry(undefined));
    expect(names(catalog.researches)).toEqual(names(RESEARCHES));
    expect(names(catalog.buildings)).toEqual(names(BUILDINGS));
    expect(names(catalog.productions)).toEqual(names(PRODUCTIONS));
    expect(catalog.retrofits).toBe(RETROFITS);
    expect(catalog.projects).toBe(PROJECTS);
    expect(catalog.protocols).toBe(PROTOCOLS);
    expect(catalog.factionDefs).toEqual(FACTION_DEFS);
  });

  it('损坏 overlay 被排除，合法 overlay 正常并入', () => {
    const overlays = [
      { id: 'bad-registry', dataError: '注册表条目必须是对象' },
      { id: 'bad-shape', researches: {}, buildings: [null] },
      { id: 'bad-faction', faction: { mcv: 'MCV', lab: '实验室', labResearch: { bad: true } } },
      {
        id: 'good',
        researches: [research('好研究')],
        buildings: [building('好建筑')],
        productions: [production('好单位')],
      },
    ] as unknown as DlcOverlay[];
    const catalog = mergeEffectiveCatalog(overlays);
    expect(names(catalog.researches)).toEqual([...names(RESEARCHES), '好研究']);
    expect(names(catalog.buildings)).toEqual([...names(BUILDINGS), '好建筑']);
    expect(names(catalog.productions)).toEqual([...names(PRODUCTIONS), '好单位']);
    expect(catalog.factionDefs.map(f => f.faction)).toEqual(FACTION_DEFS.map(f => f.faction));
  });

  it('安装序决定覆盖顺序：后装包胜前装包', () => {
    const shared = '共享科技';
    const registry = {
      second: { installedAt: '2026-09-02T00:00:00Z', data: { researches: [research(shared, 200)] } },
      first: { installedAt: '2026-09-01T00:00:00Z', data: { researches: [research(shared, 100)] } },
    };
    const catalog = mergeEffectiveCatalog(readDlcOverlaysFromRegistry(registry));
    const hit = catalog.researches.filter(r => r.name === shared);
    expect(hit).toHaveLength(1);
    expect(hit[0].cost).toBe(200);
  });

  it('overlay 覆盖 base 同名项时替换内容但保留原位；base 项不会被 overlay 删除', () => {
    const baseName = RESEARCHES[0].name;
    const overlays: DlcOverlay[] = [
      { id: 'patch', researches: [research(baseName, 9999)], buildings: [], productions: [] },
      { id: 'empty' },
    ];
    const catalog = mergeEffectiveCatalog(overlays);
    expect(catalog.researches).toHaveLength(RESEARCHES.length);
    expect(names(catalog.researches)).toEqual(names(RESEARCHES));
    expect(catalog.researches[0].cost).toBe(9999);
    expect(RESEARCHES[0].cost).not.toBe(9999); // base 数据层零变化
    expect(names(catalog.buildings)).toEqual(names(BUILDINGS));
    expect(names(catalog.productions)).toEqual(names(PRODUCTIONS));
  });

  it('阵营：内置不可覆盖，DLC 阵营先到先得，缺 name 时回退 overlay id', () => {
    const overlays: DlcOverlay[] = [
      { id: 'fake-allied', faction: { name: '盟军', mcv: '假建造厂', lab: '假实验室' } },
      { id: 'foehn-a', faction: { name: '焚风', mcv: '焚风建造厂核心', lab: '焚风实验室', labResearch: null } },
      { id: 'foehn-b', faction: { name: '焚风', mcv: '另一个建造厂', lab: '另一个实验室' } },
      { id: 'no-name', faction: { mcv: '无名建造厂', lab: '无名实验室' } },
    ];
    const catalog = mergeEffectiveCatalog(overlays);
    expect(catalog.factionDefs.map(f => f.faction)).toEqual([...FACTION_DEFS.map(f => f.faction), '焚风', 'no-name']);
    expect(catalog.factionDefs.find(f => f.faction === '盟军')).toEqual(FACTION_DEFS[0]);
    expect(catalog.factionDefs.find(f => f.faction === '焚风')?.mcv).toBe('焚风建造厂核心');
    expect(catalog.factionDefs.find(f => f.faction === 'no-name')?.labResearch).toBeNull();
  });
});

describe('PRT-PARSE-01：protocols 第四集合归一化、合并优先级与协议名↔ID 双向索引', () => {
  afterEach(() => {
    for (const key of Object.keys(STATIC_PROTOCOLS)) {
      delete STATIC_PROTOCOLS[key];
    }
    PROTOCOLS.length = 0;
  });

  it('静态基线 protocols 默认为空集合 {}（PROTOCOLS 为 []），存量集合保持不变', () => {
    expect(STATIC_PROTOCOLS).toEqual({});
    expect(PROTOCOLS).toEqual([]);
    expect(RESEARCHES.length).toBeGreaterThan(0);
    expect(BUILDINGS.length).toBeGreaterThan(0);
    expect(PRODUCTIONS.length).toBeGreaterThan(0);
    expect(RETROFITS.length).toBeGreaterThan(0);
  });

  it('normalizeWbProtocols：自动补齐 cost_points=1、按 Tier 缺省 experiment_cost_credits=500/1500/4000、reveals=[]、exclusive_with=[]', () => {
    const normalized = normalizeWbProtocols([
      {
        id: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
        track: '钢铁基干与国家动员',
        tier: 1,
      },
      {
        id: 'all.research.t1.european_defense_agreement',
        track: '跨国联合防务条约',
        tier: 2,
        reveals: ['all.research.t2.eu_joint_armor'],
      },
      {
        id: 'sov.research.t3.nuclear_command_succession_rebuild',
        track: '战略授权与核管控',
        tier: 3,
        cost_points: 2,
        experiment_cost_credits: 5000,
        discovery: {
          kind: 'experiment',
          building_any: ['国家战略工程综合体／红星科学城'],
          research_all: ['战略核打击指挥学'],
        },
      },
    ]);

    expect(normalized).toHaveLength(3);
    expect(normalized[0]).toMatchObject({
      type: 'protocol',
      schema_version: 2,
      id: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
      name: '战斗工兵—预制战斗碉堡协议',
      faction: '苏联',
      track: '钢铁基干与国家动员',
      tier: 1,
      cost_points: 1,
      experiment_cost_credits: 500,
      reveals: [],
      exclusive_with: [],
    });
    expect(normalized[1]).toMatchObject({
      id: 'all.research.t1.european_defense_agreement',
      name: '欧洲联合防务协议',
      faction: '盟军',
      tier: 2,
      cost_points: 1,
      experiment_cost_credits: 1500,
      reveals: ['all.research.t2.eu_joint_armor'],
      exclusive_with: [],
    });
    expect(normalized[2]).toMatchObject({
      id: 'sov.research.t3.nuclear_command_succession_rebuild',
      name: '核指挥接替与态势重建规程',
      faction: '苏联',
      tier: 3,
      cost_points: 2,
      experiment_cost_credits: 5000,
      discovery: {
        kind: 'experiment',
        building_any: ['国家战略工程综合体／红星科学城'],
        research_all: ['战略核打击指挥学'],
      },
    });
  });

  it('mergeEffectiveCatalog 第四集合合并：遵循 世界书动态条目 > 静态 catalog > DLC 优先级', () => {
    const sharedId = 'sov.protocol.ra3.combat_engineer_prefab_bunker';
    const sharedName = '战斗工兵—预制战斗碉堡协议';

    // 1. 填充静态 catalog 与 DLC overlay，验证 静态 catalog > DLC
    STATIC_PROTOCOLS[sharedId] = worldbookProtocolToDef({
      id: sharedId,
      name: sharedName,
      faction: '苏联',
      track: '钢铁基干与国家动员',
      tier: 1,
      experiment_cost_credits: 600,
      desc: '静态基线版本',
    });

    const dlcOverlays: DlcOverlay[] = [
      {
        id: 'dlc-proto',
        protocols: [
          {
            id: sharedId,
            name: sharedName,
            faction: '苏联',
            track: '钢铁基干与国家动员',
            tier: 1,
            experiment_cost_credits: 900,
            desc: 'DLC覆盖版本',
          },
          {
            id: 'foehn.protocol.turbulence_shield',
            name: '湍流护盾过载协议',
            faction: '焚风',
            track: '大气湍流控制',
            tier: 2,
            desc: 'DLC新增专属协议',
          },
        ],
      },
    ];

    const effStaticOverDlc = mergeEffectiveCatalog(dlcOverlays);
    expect(effStaticOverDlc.protocols).toHaveLength(2);
    const staticWinner = effStaticOverDlc.protocols.find(p => p.id === sharedId);
    expect(staticWinner?.experiment_cost_credits).toBe(600);
    expect(staticWinner?.desc).toBe('静态基线版本');
    const dlcExtra = effStaticOverDlc.protocols.find(p => p.id === 'foehn.protocol.turbulence_shield');
    expect(dlcExtra?.experiment_cost_credits).toBe(1500);

    // 2. 注入世界书动态条目，验证 世界书动态条目 > 静态 catalog > DLC
    const effWbOverAll = mergeEffectiveCatalog(dlcOverlays, {
      protocols: [
        {
          id: sharedId,
          name: sharedName,
          faction: '苏联',
          track: '钢铁基干与国家动员',
          tier: 1,
          experiment_cost_credits: 500,
          reveals: ['sov.research.t1.bunker_upgrade'],
          desc: '世界书动态权威版本',
        },
      ],
    });
    expect(effWbOverAll.protocols).toHaveLength(2);
    const wbWinner = effWbOverAll.protocols.find(p => p.id === sharedId);
    expect(wbWinner?.experiment_cost_credits).toBe(500);
    expect(wbWinner?.reveals).toEqual(['sov.research.t1.bunker_upgrade']);
    expect(wbWinner?.desc).toBe('世界书动态权威版本');
    // 同时支持按 id / name 下标访问
    expect((effWbOverAll.protocols as unknown as Record<string, ProtocolCatalogItem>)[sharedId]).toEqual(wbWinner);
    expect((effWbOverAll.protocols as unknown as Record<string, ProtocolCatalogItem>)[sharedName]).toEqual(wbWinner);
  });

  it('buildProtocolIdIndex：双向索引 id ↔ name，完整覆盖动态目录与 LEGACY_PROTOCOL_DEFINITIONS 18 条兜底', () => {
    const catalog = mergeEffectiveCatalog([], {
      protocols: [
        {
          id: 'sov.protocol.custom.arctic_convoy',
          name: '北极航线破冰护航协议',
          faction: '苏联',
          track: '钢铁基干与国家动员',
          tier: 2,
          aliases: ['北极破冰护航协议', '201·北极航线破冰护航协议'],
        },
      ],
    });

    const idx = buildProtocolIdIndex(catalog);

    // 1. 动态目录新增协议双向解析与别名解析
    expect(idx.nameToId['北极航线破冰护航协议']).toBe('sov.protocol.custom.arctic_convoy');
    expect(idx.idToName['sov.protocol.custom.arctic_convoy']).toBe('北极航线破冰护航协议');
    expect(idx.resolveProtocolIdByName('北极破冰护航协议')).toBe('sov.protocol.custom.arctic_convoy');
    expect(idx.resolveProtocolIdByName('《201·北极航线破冰护航协议》')).toBe('sov.protocol.custom.arctic_convoy');
    expect(idx.resolveProtocolNameById('sov.protocol.custom.arctic_convoy')).toBe('北极航线破冰护航协议');

    // 2. LEGACY_PROTOCOL_DEFINITIONS 18 条存量协议兜底全覆盖
    expect(LEGACY_PROTOCOL_DEFINITIONS).toHaveLength(18);
    for (const def of LEGACY_PROTOCOL_DEFINITIONS) {
      expect(idx.nameToId[def.name]).toBe(def.id);
      expect(idx.idToName[def.id]).toBe(def.name);
      expect(idx.resolveProtocolIdByName(def.name)).toBe(def.id);
      expect(idx.resolveProtocolNameById(def.id)).toBe(def.name);
      for (const alias of def.aliases) {
        expect(idx.resolveProtocolIdByName(alias)).toBe(def.id);
        expect(idx.resolveProtocolNameById(alias)).toBe(def.name);
      }
    }

    // 3. 顶层导出辅助函数 resolveProtocolIdByName / resolveProtocolNameById 双入参顺序与空参兜底
    expect(resolveProtocolIdByName('战斗工兵—预制战斗碉堡协议')).toBe('sov.protocol.ra3.combat_engineer_prefab_bunker');
    expect(resolveProtocolIdByName('欧盟防务协议')).toBe('all.research.t1.european_defense_agreement');
    expect(resolveProtocolIdByName('日韩防务协议')).toBe('all.research.t1.pacific_rim_defense_agreement');
    expect(resolveProtocolIdByName('北极航线破冰护航协议', catalog)).toBe('sov.protocol.custom.arctic_convoy');
    expect(resolveProtocolIdByName(catalog, '北极航线破冰护航协议')).toBe('sov.protocol.custom.arctic_convoy');

    expect(resolveProtocolNameById('sov.protocol.ra3.combat_engineer_prefab_bunker')).toBe('战斗工兵—预制战斗碉堡协议');
    expect(resolveProtocolNameById('all.research.european_defense_pact')).toBe('欧洲联合防务协议');
    expect(resolveProtocolNameById('sov.protocol.custom.arctic_convoy', idx)).toBe('北极航线破冰护航协议');
    expect(resolveProtocolNameById(idx, 'sov.protocol.custom.arctic_convoy')).toBe('北极航线破冰护航协议');

    // 4. 未知标识符返回 undefined
    expect(resolveProtocolIdByName('不存在的协议')).toBeUndefined();
    expect(resolveProtocolNameById('sov.protocol.non_existent')).toBeUndefined();
    expect(resolveProtocolIdByName('')).toBeUndefined();
    expect(resolveProtocolNameById(null)).toBeUndefined();
  });

  // ── PRT-VIS-01：reveals 单向隐藏表与科技可见性过滤（任务包 §3.3.1 / §6 PRT-VIS-01） ──
  it('黄金对照断言：当全部协议 reveals 为空数组 [] 时，researches / buildings / productions / retrofits / projects 与基线 100% 逐项相等', () => {
    const baseline = mergeEffectiveCatalog([], null);
    const withEmptyRevealProtocols = mergeEffectiveCatalog([], {
      protocols: LEGACY_PROTOCOL_DEFINITIONS.map((def, idx) => ({
        id: def.id,
        name: def.name,
        faction: def.faction,
        track: def.faction === '苏联' ? '苏联测试轨道' : '盟军测试轨道',
        tier: def.tier,
        order: idx + 1,
        reveals: [],
        aliases: [...def.aliases],
      })),
    });

    expect(withEmptyRevealProtocols.researches).toEqual(baseline.researches);
    expect(withEmptyRevealProtocols.buildings).toEqual(baseline.buildings);
    expect(withEmptyRevealProtocols.productions).toEqual(baseline.productions);
    expect(withEmptyRevealProtocols.retrofits).toEqual(baseline.retrofits);
    expect(withEmptyRevealProtocols.projects).toEqual(baseline.projects);
    expect(computeHiddenTechIds(withEmptyRevealProtocols.protocols, []).size).toBe(0);
  });

  it('reveals 单向隐藏与激活显现：协议未 active 时隐藏目标科技，任一关联协议 active 后立即显现', () => {
    const secretTech: ResearchDef = {
      name: '奇点反应堆理论',
      cost: 2400,
      eta: '约12日',
      line: '能量武器',
      tier: 3,
      unlocks: '奇点反应堆',
      prereq: '无',
      prereqs: [],
      desc: '机密奇点压制与能级跃迁理论。',
    };
    (secretTech as ResearchDef & { id?: string }).id = 'sov.research.t3.test_secret';

    const normalTech: ResearchDef = {
      name: '常规火控增补理论',
      cost: 400,
      eta: '约2日',
      line: '基础工业',
      tier: 1,
      unlocks: '常规火控站',
      prereq: '无',
      prereqs: [],
      desc: '常规公开理论。',
    };
    (normalTech as ResearchDef & { id?: string }).id = 'sov.research.t1.normal_fire_control';

    const dynamicWb = {
      researches: [secretTech, normalTech],
      protocols: [
        {
          id: 'sov.protocol.ra3.anchored_magnetic_lock',
          name: '地锚式磁锁／局部奇点压制区协议',
          faction: '苏联',
          track: '过载工程与战区拒止',
          tier: 2 as const,
          order: 1,
          reveals: ['sov.research.t3.test_secret'],
        },
        {
          id: 'sov.protocol.custom.backup_revealer',
          name: '备用奇点揭示协议',
          faction: '苏联',
          track: '过载工程与战区拒止',
          tier: 3 as const,
          order: 2,
          reveals: ['奇点反应堆理论'],
        },
      ],
    };

    // 1. revealedByMap 记录双向键（科技 id 与科技 name）到关联协议集合
    const revealedByMap = buildRevealedByProtocolMap(dynamicWb.protocols, dynamicWb.researches);
    expect(revealedByMap.get('sov.research.t3.test_secret')).toEqual(
      new Set(['sov.protocol.ra3.anchored_magnetic_lock', 'sov.protocol.custom.backup_revealer']),
    );
    expect(revealedByMap.get('奇点反应堆理论')).toEqual(
      new Set(['sov.protocol.ra3.anchored_magnetic_lock', 'sov.protocol.custom.backup_revealer']),
    );

    // 2. 协议均未 active（空集合或 status='experimenting'）：机密科技被过滤隐藏，常规科技正常保留
    const catalogBeforeActive = mergeEffectiveCatalog([], dynamicWb, [
      { ref: 'sov.protocol.ra3.anchored_magnetic_lock', status: 'experimenting' },
    ]);
    expect(catalogBeforeActive.researches.some(r => r.name === '奇点反应堆理论')).toBe(false);
    expect(catalogBeforeActive.researches.some(r => r.name === '常规火控增补理论')).toBe(true);

    // 3. 关联协议之一升为 active（传协议 ID、中文名或 ProtocolInstance(status='active')）：机密科技立即显现
    const catalogActiveById = mergeEffectiveCatalog([], dynamicWb, ['sov.protocol.ra3.anchored_magnetic_lock']);
    expect(catalogActiveById.researches.some(r => r.name === '奇点反应堆理论')).toBe(true);

    const catalogActiveByName = mergeEffectiveCatalog([], dynamicWb, ['地锚式磁锁／局部奇点压制区协议']);
    expect(catalogActiveByName.researches.some(r => r.name === '奇点反应堆理论')).toBe(true);

    const catalogActiveByInstance = mergeEffectiveCatalog([], dynamicWb, [
      { ref: 'sov.protocol.custom.backup_revealer', status: 'active' },
    ]);
    expect(catalogActiveByInstance.researches.some(r => r.name === '奇点反应堆理论')).toBe(true);

    // 4. filterVisibleResearches 直接调用同样遵循单向隐藏表规则
    const filteredLocked = filterVisibleResearches(dynamicWb.researches, dynamicWb.protocols, []);
    expect(filteredLocked.map(r => r.name)).toEqual(['常规火控增补理论']);
    const filteredUnlocked = filterVisibleResearches(dynamicWb.researches, dynamicWb.protocols, [
      'sov.protocol.ra3.anchored_magnetic_lock',
    ]);
    expect(filteredUnlocked.map(r => r.name)).toEqual(['奇点反应堆理论', '常规火控增补理论']);
  });

  it('useCatalogStore 接缝联动：根据 dataStore.data.protocols 中 status === "active" 响应式过滤 reveals 科技，同时保留 dynamicCatalog.researches 原始未过滤列表', async () => {
    (globalThis as Record<string, unknown>).window ??= globalThis;
    ((globalThis as Record<string, unknown>).window as Record<string, unknown>).location ??= { search: '' };
    setActivePinia(createPinia());
    setCachedDynamicCatalog(null);
    const dataStore = useDataStore();
    const catalogStore = useCatalogStore();

    await catalogStore.init({
      dynamicCatalog: {
        researches: [
          {
            type: 'research',
            id: 'sov.research.t3.test_secret',
            name: '奇点反应堆理论',
            cost: 2400,
            eta: '约12日',
            line: '能量武器',
            tier: 3,
            unlocks: '奇点反应堆',
            prereq: '无',
            prereqs: [],
            need_buildings: [],
            desc: '机密奇点压制理论。',
          },
          {
            type: 'research',
            id: 'sov.research.t1.normal_fire_control',
            name: '常规火控增补理论',
            cost: 400,
            eta: '约2日',
            line: '基础工业',
            tier: 1,
            unlocks: '常规火控站',
            prereq: '无',
            prereqs: [],
            need_buildings: [],
            desc: '常规公开理论。',
          },
        ],
        buildings: [],
        productions: [],
        retrofits: [],
        projects: [],
        protocols: [
          {
            type: 'protocol',
            id: 'sov.protocol.ra3.anchored_magnetic_lock',
            name: '地锚式磁锁／局部奇点压制区协议',
            faction: '苏联',
            track: '过载工程与战区拒止',
            tier: 2,
            order: 1,
            cost_points: 1,
            experiment_cost_credits: 1500,
            reveals: ['sov.research.t3.test_secret'],
            exclusive_with: [],
            aliases: [],
          },
        ],
        errors: [],
      },
    });

    // 1. 协议未激活时：catalogStore.researches 隐藏奇点反应堆理论，但 dynamicCatalog.researches 保留原始未过滤列表
    dataStore.data.protocols = [
      {
        ref: 'sov.protocol.ra3.anchored_magnetic_lock',
        status: 'experimenting',
        attempts: 1,
        exp: 40,
        points_spent: 1,
        credits_spent: 1500,
        auto_queued: false,
        hold: false,
        updated_at_day: 2,
        schema_version: 1,
      },
    ];
    expect(catalogStore.researches.some(r => r.name === '奇点反应堆理论')).toBe(false);
    expect(catalogStore.researches.some(r => r.name === '常规火控增补理论')).toBe(true);
    expect(catalogStore.dynamicCatalog?.researches.some(r => r.name === '奇点反应堆理论')).toBe(true);
    expect(catalogStore.protocols).toHaveLength(1);

    // 2. 协议升为 active 后：catalogStore.researches 立即显现奇点反应堆理论
    dataStore.data.protocols = [
      {
        ref: 'sov.protocol.ra3.anchored_magnetic_lock',
        status: 'active',
        attempts: 2,
        exp: 100,
        points_spent: 2,
        credits_spent: 3000,
        auto_queued: false,
        hold: false,
        updated_at_day: 3,
        schema_version: 1,
      },
    ];
    expect(catalogStore.researches.some(r => r.name === '奇点反应堆理论')).toBe(true);
    setCachedDynamicCatalog(null);
  });
});
