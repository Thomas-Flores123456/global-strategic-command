import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dynamicCatalogSnapshot,
  effectiveCatalogNames,
  effectiveCatalogSnapshot,
  ensureWorldbookCatalogLoaded,
  setCachedDynamicCatalog,
} from '../composables/useCatalog';
import { buildAuthority, runParseFor } from '../composables/useParse';
import { BUILDINGS, PRODUCTIONS, PROJECTS, PROTOCOLS, RESEARCHES, RETROFITS } from '../core/catalog';
import { dataPatchesToDlcOverlay, mergeEffectiveCatalog } from '../core/catalogEffective';
import { evaluateEntityCredibility } from '../core/entityCredibility';
import { Schema } from '../core/schema';
import { installCatalogFixtures } from '../fixtures/catalogFixtures';

function makeWorldbookEntriesFixture() {
  return [
    {
      uid: 1,
      name: '01·低可观测技术工学',
      enabled: true,
      content: `低可观测与隐身涂层的核心理论。\n<数据>\n${JSON.stringify({
        type: 'research',
        id: 'common.tech.stealth',
        name: '低可观测技术工学',
        cost: 1200,
        tier: 2,
        line: '航空与电子',
        aliases: ['LO隐身工学', '隐身涂层理论'],
      })}\n</数据>`,
    },
    {
      uid: 2,
      name: '02·小型模块化核能工学',
      enabled: true,
      content: `模块化核裂变供能理论。\n<数据>\n${JSON.stringify({
        type: 'research',
        id: 'common.tech.smr',
        name: '小型模块化核能工学',
        cost: 1500,
        tier: 2,
        line: '能源与工业',
        aliases: ['SMR核能工学'],
      })}\n</数据>`,
    },
    {
      uid: 3,
      name: '03·盟军发电厂',
      enabled: true,
      content: `盟军标准发电设施。\n<数据>\n${JSON.stringify({
        type: 'building',
        id: 'all.bld.power_plant',
        name: '盟军发电厂',
        cost: 800,
        power: -200,
        aliases: ['盟军基础电站'],
      })}\n</数据>`,
    },
    {
      uid: 4,
      name: '04·M1A2主战坦克',
      enabled: true,
      content: `盟军主力装甲载具。\n<数据>\n${JSON.stringify({
        type: 'production',
        id: 'all.unit.m1a2',
        name: 'M1A2主战坦克',
        cost: 1200,
        need_building: '盟军战车工厂',
        need_buildings: ['盟军战车工厂'],
        aliases: ['艾布拉姆斯主战坦克'],
      })}\n</数据>`,
    },
    {
      uid: 5,
      name: '05·M1A2主战坦克现代化改造',
      enabled: true,
      content: `主战坦克信息化升级工程。\n<数据>\n${JSON.stringify({
        type: 'retrofit',
        id: 'all.ret.m1a2_sep',
        name: 'M1A2主战坦克现代化改造',
        cost: 500,
        research: '低可观测技术工学',
        grade: '中改',
        upgraded_name: 'M1A2 SEP v3主战坦克',
      })}\n</数据>`,
    },
    {
      uid: 6,
      name: '06·天基轨道船坞工程',
      enabled: true,
      content: `近地轨道大型船坞建设。\n<数据>\n${JSON.stringify({
        schema_version: 2,
        type: 'project',
        id: 'all.project.orbital_shipyard',
        name: '天基轨道船坞工程',
        cost: 5000,
        grade: '巨构',
        modules: [
          {
            id: 'mod.core',
            name: '核心桁架舱段',
            cost: 2500,
            workload: { days: 10, min_days: 5 },
            prereqs: [],
          },
        ],
      })}\n</数据>`,
    },
    {
      uid: 7,
      name: '07·战斗工兵—预制战斗碉堡协议',
      enabled: true,
      content: `前线快速筑城条令。\n<数据>\n${JSON.stringify({
        schema_version: 2,
        type: 'protocol',
        id: 'sov.protocol.combat_engineer_bunker',
        name: '战斗工兵—预制战斗碉堡协议',
        faction: '苏联',
        track: '筑城学说',
        tier: 1,
        aliases: ['预制碉堡条令'],
      })}\n</数据>`,
    },
  ];
}

describe('worldbookSsotAndAuthority · 世界书唯一事实源 (SSOT) 预热与权威索引测试 (FD-27 PKG-A)', () => {
  const g = globalThis as Record<string, unknown>;
  let savedGlobals: Record<string, unknown> = {};

  beforeEach(() => {
    savedGlobals = {
      getGlobalWorldbookNames: g.getGlobalWorldbookNames,
      getCharWorldbookNames: g.getCharWorldbookNames,
      getChatWorldbookName: g.getChatWorldbookName,
      getWorldbook: g.getWorldbook,
      getChatMessages: g.getChatMessages,
      getVariables: g.getVariables,
      updateVariablesWith: g.updateVariablesWith,
      SillyTavern: g.SillyTavern,
    };
    setCachedDynamicCatalog(null);
    // 模拟生产纯化态（清空 Vitest setup 注入的静态测试夹具）
    RESEARCHES.length = 0;
    BUILDINGS.length = 0;
    PRODUCTIONS.length = 0;
    RETROFITS.length = 0;
    PROJECTS.length = 0;
    PROTOCOLS.length = 0;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedGlobals)) {
      if (v === undefined) {
        delete g[k];
      } else {
        g[k] = v;
      }
    }
    setCachedDynamicCatalog(null);
    installCatalogFixtures();
  });

  it('静态 catalog.ts 保持为空数组，ensureWorldbookCatalogLoaded 与 buildAuthority 冷启动自动解析全六大域 <数据> 块', async () => {
    expect(RESEARCHES).toHaveLength(0);
    expect(BUILDINGS).toHaveLength(0);
    expect(PRODUCTIONS).toHaveLength(0);
    expect(RETROFITS).toHaveLength(0);
    expect(PROJECTS).toHaveLength(0);
    expect(PROTOCOLS).toHaveLength(0);
    expect(dynamicCatalogSnapshot()).toBeNull();

    const entries = makeWorldbookEntriesFixture();
    g.getGlobalWorldbookNames = () => ['通用·科技_世界书'];
    g.getCharWorldbookNames = () => ({ primary: '特色武备_世界书', additional: [] });
    g.getChatWorldbookName = () => null;
    g.getWorldbook = vi.fn(async (bookName: string) => {
      if (bookName.includes('通用·科技')) return entries.slice(0, 2);
      return entries.slice(2);
    });

    // 在 cachedDynamicCatalog === null 时调用 buildAuthority，传入 extraNames 模拟存量 codex 自创项
    const auth = await buildAuthority(['幽能裂隙超时空折跃炉']);

    // 1. 缓存已被预热
    expect(dynamicCatalogSnapshot()).not.toBeNull();

    // 2. effectiveCatalogNames 完整收录六大域（含新增补齐的 projects 和 protocols）
    const catNames = effectiveCatalogNames();
    expect(catNames).toContain('低可观测技术工学');
    expect(catNames).toContain('小型模块化核能工学');
    expect(catNames).toContain('盟军发电厂');
    expect(catNames).toContain('M1A2主战坦克');
    expect(catNames).toContain('M1A2主战坦克现代化改造');
    expect(catNames).toContain('天基轨道船坞工程');
    expect(catNames).toContain('战斗工兵—预制战斗碉堡协议');

    // 3. auth.names 与 auth.aliases 收录全六大域别名
    expect(auth.names).toContain('LO隐身工学');
    expect(auth.names).toContain('艾布拉姆斯主战坦克');
    expect(auth.names).toContain('预制碉堡条令');
    expect(auth.names).toContain('幽能裂隙超时空折跃炉');
    expect(auth.aliases['LO隐身工学']).toBe('低可观测技术工学');
    expect(auth.aliases['艾布拉姆斯主战坦克']).toBe('M1A2主战坦克');
    expect(auth.aliases['预制碉堡条令']).toBe('战斗工兵—预制战斗碉堡协议');

    // 4. auth.credibilityIndex 仅包含纯世界书系统目录（不含 extraNames 动态自创项）
    expect(auth.credibilityIndex).toBeDefined();
    const sysHit = evaluateEntityCredibility(auth.credibilityIndex, '模块化小型核能技术');
    expect(sysHit.verdict).toBe('system_high');
    expect(sysHit.matchedName).toBe('小型模块化核能工学');

    const evaHit = evaluateEntityCredibility(auth.credibilityIndex, '幽能裂隙超时空折跃炉');
    expect(evaHit.verdict).toBe('novel_eva');
    expect(evaHit.matchedName).toBeNull();
  });

  it('runParseFor 在冷启动（cachedDynamicCatalog === null）时自动预热世界书目录并完成变体名对齐', async () => {
    const entries = makeWorldbookEntriesFixture();
    g.getGlobalWorldbookNames = () => ['通用·科技_世界书'];
    g.getWorldbook = vi.fn(async () => entries);

    const baselineStat = Schema.parse({
      meta: { world_id: 'ra_test', date: '2042-05-01', day_count: 1 },
      economy: { credits: 5000 },
      bases: [{ id: 'base_1', name: '主基地', location: '一区', buildings: [{ name: '盟军发电厂' }] }],
    });

    const floor1Text = `<战况>\n已研科技:\n  - 模块化小型核能技术\n队列:\n  - 类型: 研究\n    项目: 隐身低可观测技术\n    基地: 主基地\n    进度: 20\n</战况>`;
    const uvwMock = vi.fn(async (updater: (v: Record<string, unknown>) => Record<string, unknown>) => updater({}));

    g.getChatMessages = (id: number) =>
      id === 1
        ? [{ message_id: 1, role: 'assistant', is_hidden: false, message: floor1Text, swipe_id: 0 }]
        : [{ message_id: 0, role: 'assistant', is_hidden: false, message: '', swipe_id: 0 }];
    g.getVariables = (o: { type: string; message_id?: number }) =>
      o.type === 'message' && o.message_id === 0 ? { stat_data: baselineStat } : {};
    g.updateVariablesWith = uvwMock;
    delete g.SillyTavern;

    expect(dynamicCatalogSnapshot()).toBeNull();
    const outcome = await runParseFor(1, { force: true });
    expect(outcome).toBe('parsed');
    expect(dynamicCatalogSnapshot()).not.toBeNull();

    const firstWrite = (await uvwMock.mock.results[0].value) as Record<string, unknown>;
    const writtenStat = firstWrite.stat_data as {
      tech: { done: string[] };
      queues: Array<{ item: string }>;
    };
    expect(writtenStat.tech.done).toContain('小型模块化核能工学');
    expect(writtenStat.queues.some(q => q.item === '低可观测技术工学')).toBe(true);
  });

  it('dataPatchesToDlcOverlay 与 mergeEffectiveCatalog 基于世界书基准目录应用 <数据更新> 补丁', async () => {
    const entries = makeWorldbookEntriesFixture();
    await ensureWorldbookCatalogLoaded({ entries, force: true });
    const wbCatalog = effectiveCatalogSnapshot();

    const patches = [
      {
        id: 'patch_1',
        target: '低可观测技术工学',
        category: 'research',
        changes: { cost: 950, desc: '补丁降价后的隐身工学' },
      },
      {
        id: 'patch_2',
        target: 'all.bld.power_plant',
        category: 'building',
        changes: { power: -300 },
      },
      {
        id: 'patch_3',
        target: 'M1A2主战坦克',
        category: 'production',
        changes: { cost: 1050 },
      },
      {
        id: 'patch_4',
        target: 'M1A2主战坦克现代化改造',
        category: 'retrofit',
        changes: { cost: 420 },
      },
    ];

    const overlay = dataPatchesToDlcOverlay(patches, wbCatalog);
    expect(overlay).not.toBeNull();
    expect(overlay?.researches?.[0]?.cost).toBe(950);
    expect(overlay?.buildings?.[0]?.power).toBe(-300);
    expect(overlay?.productions?.[0]?.cost).toBe(1050);

    const merged = mergeEffectiveCatalog([], dynamicCatalogSnapshot(), undefined, patches);
    expect(merged.researches.find(r => r.name === '低可观测技术工学')?.cost).toBe(950);
    expect(merged.buildings.find(b => b.name === '盟军发电厂')?.power).toBe(-300);
    expect(merged.productions.find(p => p.name === 'M1A2主战坦克')?.cost).toBe(1050);
    expect(merged.retrofits.find(t => t.name === 'M1A2主战坦克现代化改造')?.cost).toBe(420);
  });
});
