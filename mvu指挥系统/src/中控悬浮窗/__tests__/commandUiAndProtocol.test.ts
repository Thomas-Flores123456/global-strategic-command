/**
 * commandUiAndProtocol.test.ts —— CMD-UI-01 单元测试
 *
 * 覆盖：
 * 1. floorObservers.ts：`extractUnlockedFactionsFromStatData`、`syncMultiFactionWorldbooksOnFloorEvent`
 *    与 `installWorldbookAutoFiler`（盘中解锁双阵营自动挂载盟军四书+苏联四书+协议书；Swipe 回退单阵营自动卸载苏联四书并保留用户自定义世界书）；
 * 2. PanelProtocol.vue：08 [P2-2] 空院所且 0 产点时渲染 `data-test="protocol-no-lab-empty"` 零剧透空态横幅并隐藏未启封协议卡片；
 * 3. ModalTechTree.vue & ConsoleBuildGrid.vue：多阵营筛选胶囊条 `data-test="faction-filter-bar"` 与跨阵营条目过滤（保留通用 common 条目）。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读写临时编译产物，不进 bundle */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import {
  ALLIED_WORLDBOOK_GROUP,
  PROTOCOL_WORLDBOOK,
  SOVIET_WORLDBOOK_GROUP,
} from '../../开场启动器/worldbookManifest';
import { Schema } from '../../红警指挥系统/core/schema';
import {
  evaluateTechCardPrerequisites,
  shouldIncludeResearchByFactionFilter,
} from '../../红警指挥系统/ui/panels/panelTechHelpers';
import {
  extractUnlockedFactionsFromStatData,
  installWorldbookAutoFiler,
  syncMultiFactionWorldbooksOnFloorEvent,
} from '../host/floorObservers';
import {
  checkIsResearchUnlocked,
  resolveCatalogItemDotClass,
  resolveCatalogItemStatusTitle,
} from '../modals/modalEngineeringHelpers';

/* ═══════════════ 依赖组件与 Store 打桩 ═══════════════ */

const catalogFixture = vi.hoisted(() => ({
  buildings: [] as any[],
  productions: [] as any[],
  researches: [] as any[],
  retrofits: [] as any[],
  projects: [] as any[],
  factionDefs: [] as any[],
  protocols: [] as any[],
  effectiveCatalog: undefined as any,
  dynamicCatalog: undefined as any,
}));

vi.mock('../../红警指挥系统/composables/useCatalog', () => ({ useCatalogStore: () => catalogFixture }));

afterEach(() => {
  for (const key of Object.keys(catalogFixture) as (keyof typeof catalogFixture)[]) {
    catalogFixture[key] = key === 'effectiveCatalog' || key === 'dynamicCatalog' ? undefined : [];
  }
});

vi.mock('../../红警指挥系统/composables/store', () => ({
  in_tavern: false,
  useDataStore: () => ({ data: null }),
}));

vi.mock('@vueuse/core', () => ({
  useElementSize: () => ({ height: { value: 240 }, width: { value: 320 } }),
}));

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', render: () => hh('span', { class: 'icon-stub' }) } };
});

vi.mock('../../红警指挥系统/ui/panels/PanelTech.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'PanelTech', render: () => hh('div', { class: 'panel-tech-stub' }) } };
});

vi.mock('../console/TagFilterBar.vue', async () => {
  const { h: hh } = await import('vue');
  return {
    default: {
      name: 'TagFilterBar',
      props: ['factionPills'],
      render(this: { factionPills?: Array<{ id: string; label: string }> }) {
        return hh(
          'div',
          { class: 'tag-filter-stub' },
          this.factionPills && this.factionPills.length > 0
            ? [
                hh(
                  'div',
                  { 'data-test': 'faction-filter-bar' },
                  this.factionPills.map(p => hh('button', { 'data-faction-filter': p.id }, p.label)),
                ),
              ]
            : [],
        );
      },
    },
  };
});

/* ═══════════════ SFC 即时编译辅助 ═══════════════ */

const PROTOCOL_SFC_PATH = fileURLToPath(new URL('../panels/PanelProtocol.vue', import.meta.url));
const PROTOCOL_SSR_PATH = fileURLToPath(new URL('../panels/PanelProtocol.__cmd_ui_ssr__.mts', import.meta.url));

const MODAL_TECH_SFC_PATH = fileURLToPath(new URL('../modals/ModalTechTree.vue', import.meta.url));
const MODAL_TECH_SSR_PATH = fileURLToPath(new URL('../modals/ModalTechTree.__cmd_ui_ssr__.mts', import.meta.url));
const MODAL_TECH_MOD_PATH = fileURLToPath(new URL('../modals/ModalTechTree.__cmd_ui_mod__.mts', import.meta.url));

const BUILD_GRID_SFC_PATH = fileURLToPath(new URL('../console/ConsoleBuildGrid.vue', import.meta.url));
const BUILD_GRID_SSR_PATH = fileURLToPath(new URL('../console/ConsoleBuildGrid.__cmd_ui_ssr__.mts', import.meta.url));
const BUILD_GRID_BIND_PATH = fileURLToPath(new URL('../console/ConsoleBuildGrid.__cmd_ui_bind__.mts', import.meta.url));

let protocolCompPromise: Promise<Component> | undefined;
let modalTechCompPromise: Promise<Component> | undefined;
let buildGridCompPromise: Promise<Component> | undefined;
let bindSeq = 0;

function stripTypeImports(code: string): string {
  return code.replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '').replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
}

function loadProtocolComponent(): Promise<Component> {
  protocolCompPromise ??= (async () => {
    const source = readFileSync(PROTOCOL_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'PanelProtocol.vue' });
    if (errors.length > 0) throw new Error(`PanelProtocol.vue 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id: 'panelprotocolcmduissr',
      inlineTemplate: true,
      templateOptions: { id: 'panelprotocolcmduissr', scoped: descriptor.styles.some(s => s.scoped) },
    });
    writeFileSync(PROTOCOL_SSR_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
    const mod = (await import(pathToFileURL(PROTOCOL_SSR_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return protocolCompPromise;
}

vi.mock('../panels/PanelProtocol.vue', async () => {
  const Comp = await loadProtocolComponent();
  return { default: Comp };
});

function loadModalTechComponent(): Promise<Component> {
  modalTechCompPromise ??= (async () => {
    const source = readFileSync(MODAL_TECH_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'ModalTechTree.vue' });
    if (errors.length > 0) throw new Error(`ModalTechTree.vue 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id: 'modaltechcmduissr',
      inlineTemplate: true,
      templateOptions: { id: 'modaltechcmduissr', scoped: descriptor.styles.some(s => s.scoped) },
    });
    writeFileSync(MODAL_TECH_SSR_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
    const mod = (await import(pathToFileURL(MODAL_TECH_SSR_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return modalTechCompPromise;
}

async function loadModalTechExports(props: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const source = readFileSync(MODAL_TECH_SFC_PATH, 'utf8');
  const { descriptor, errors } = parse(source, { filename: 'ModalTechTree.vue' });
  if (errors.length > 0) throw new Error(`ModalTechTree.vue 解析失败：${errors.map(String).join('; ')}`);
  const compiled = compileScript(descriptor, { id: 'modaltechcmduimod', inlineTemplate: false });
  writeFileSync(MODAL_TECH_MOD_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
  const mod = (await import(`${pathToFileURL(MODAL_TECH_MOD_PATH).href}?v=${(bindSeq += 1)}`)) as {
    default: { setup: (p: unknown, ctx: unknown) => Record<string, any> };
  };
  return mod.default.setup(
    { open: true, snapshot: undefined, initialHall: 'tech', newlyRevealedCount: undefined, ...props },
    { emit: vi.fn(), expose: vi.fn(), attrs: {}, slots: {} },
  );
}

function loadBuildGridComponent(): Promise<Component> {
  buildGridCompPromise ??= (async () => {
    const source = readFileSync(BUILD_GRID_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'ConsoleBuildGrid.vue' });
    if (errors.length > 0) throw new Error(`ConsoleBuildGrid.vue 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id: 'buildgridcmduissr',
      inlineTemplate: true,
      templateOptions: { id: 'buildgridcmduissr', scoped: descriptor.styles.some(s => s.scoped) },
    });
    writeFileSync(BUILD_GRID_SSR_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
    const mod = (await import(pathToFileURL(BUILD_GRID_SSR_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return buildGridCompPromise;
}

async function loadBuildGridSetup(props: Record<string, unknown>): Promise<Record<string, any>> {
  const source = readFileSync(BUILD_GRID_SFC_PATH, 'utf8');
  const { descriptor, errors } = parse(source, { filename: 'ConsoleBuildGrid.vue' });
  if (errors.length > 0) throw new Error(`ConsoleBuildGrid.vue 解析失败：${errors.map(String).join('; ')}`);
  const compiled = compileScript(descriptor, { id: 'buildgridcmduibind', inlineTemplate: false });
  writeFileSync(BUILD_GRID_BIND_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
  const mod = (await import(`${pathToFileURL(BUILD_GRID_BIND_PATH).href}?v=${(bindSeq += 1)}`)) as {
    default: { setup: (p: unknown, ctx: unknown) => Record<string, any> };
  };
  return mod.default.setup(
    { snapshot: null, activeBaseIndex: 0, ...props },
    { emit: vi.fn(), expose: vi.fn(), attrs: {}, slots: {} },
  );
}

afterAll(() => {
  for (const p of [
    PROTOCOL_SSR_PATH,
    MODAL_TECH_SSR_PATH,
    MODAL_TECH_MOD_PATH,
    BUILD_GRID_SSR_PATH,
    BUILD_GRID_BIND_PATH,
  ]) {
    try {
      unlinkSync(p);
    } catch {
      // 忽略文件不存在
    }
  }
});

/* ═══════════════ 1. floorObservers 多阵营四书同步与 Swipe 回退测试 ═══════════════ */

describe('CMD-UI-01 · floorObservers 多阵营四书同步与 Swipe 回退', () => {
  it('extractUnlockedFactionsFromStatData：归一去重 unlocked_factions，缺失或空数组时回退为 ["allied"]', () => {
    expect(extractUnlockedFactionsFromStatData(null)).toEqual(['allied']);
    expect(extractUnlockedFactionsFromStatData(undefined)).toEqual(['allied']);
    expect(extractUnlockedFactionsFromStatData({})).toEqual(['allied']);
    expect(extractUnlockedFactionsFromStatData({ command: { unlocked_factions: [] } })).toEqual(['allied']);
    expect(
      extractUnlockedFactionsFromStatData({
        command: { unlocked_factions: ['盟军', 'allied', '苏维埃', 'soviet'] },
      }),
    ).toEqual(['allied', 'soviet']);
  });

  it('syncMultiFactionWorldbooksOnFloorEvent：解锁 ["allied", "soviet"] 自动挂载盟军四书+苏联四书+协议书；Swipe 回退至 ["allied"] 自动卸载苏联四书并保留用户自定义书', async () => {
    const customUserBook = '用户自定义世界书_战术设定';
    const allAvailableBooks = [
      customUserBook,
      ...ALLIED_WORLDBOOK_GROUP,
      ...SOVIET_WORLDBOOK_GROUP,
      PROTOCOL_WORLDBOOK,
    ];

    let activeGlobal = [customUserBook, ...ALLIED_WORLDBOOK_GROUP, PROTOCOL_WORLDBOOK];
    let currentStatData: Record<string, unknown> = {
      command: { unlocked_factions: ['allied', 'soviet'] },
    };

    const rebindSpy = vi.fn(async (next: string[]) => {
      activeGlobal = [...next];
    });

    // 1. 盘中解锁 ['allied', 'soviet'] -> 自动开启盟军四书 + 苏联四书 + 协议书
    const resUnlock = await syncMultiFactionWorldbooksOnFloorEvent({
      getStatData: () => currentStatData,
      getGlobalWorldbookNames: async () => activeGlobal,
      getWorldbookNames: async () => allAvailableBooks,
      rebindGlobalWorldbooks: rebindSpy,
    });

    expect(resUnlock.synced).toBe(true);
    expect(resUnlock.unlockedFactions).toEqual(['allied', 'soviet']);
    expect(rebindSpy).toHaveBeenCalledTimes(1);
    for (const book of ALLIED_WORLDBOOK_GROUP) {
      expect(activeGlobal).toContain(book);
    }
    for (const book of SOVIET_WORLDBOOK_GROUP) {
      expect(activeGlobal).toContain(book);
    }
    expect(activeGlobal).toContain(PROTOCOL_WORLDBOOK);
    expect(activeGlobal).toContain(customUserBook);

    // 2. 再次触发且无变化时不重复调用 rebindGlobalWorldbooks
    rebindSpy.mockClear();
    const resNoop = await syncMultiFactionWorldbooksOnFloorEvent({
      getStatData: () => currentStatData,
      getGlobalWorldbookNames: async () => activeGlobal,
      getWorldbookNames: async () => allAvailableBooks,
      rebindGlobalWorldbooks: rebindSpy,
    });
    expect(resNoop.synced).toBe(false);
    expect(rebindSpy).not.toHaveBeenCalled();

    // 3. Swipe 切回未解锁苏联的旧分支 ['allied'] -> 自动卸载苏联四书，保留盟军四书 + 协议书 + 用户自定义世界书
    currentStatData = {
      command: { unlocked_factions: ['allied'] },
    };
    const resSwipeRollback = await syncMultiFactionWorldbooksOnFloorEvent({
      getStatData: () => currentStatData,
      getGlobalWorldbookNames: async () => activeGlobal,
      getWorldbookNames: async () => allAvailableBooks,
      rebindGlobalWorldbooks: rebindSpy,
    });

    expect(resSwipeRollback.synced).toBe(true);
    expect(resSwipeRollback.unlockedFactions).toEqual(['allied']);
    expect(rebindSpy).toHaveBeenCalledTimes(1);
    for (const book of SOVIET_WORLDBOOK_GROUP) {
      expect(activeGlobal).not.toContain(book);
    }
    for (const book of ALLIED_WORLDBOOK_GROUP) {
      expect(activeGlobal).toContain(book);
    }
    expect(activeGlobal).toContain(PROTOCOL_WORLDBOOK);
    expect(activeGlobal).toContain(customUserBook);
  });

  it('installWorldbookAutoFiler：在 MESSAGE_RECEIVED / MESSAGE_SWIPED / MESSAGE_EDITED / CHAT_CHANGED 事件中触发多阵营四书同步', async () => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    let activeGlobal = [...ALLIED_WORLDBOOK_GROUP, PROTOCOL_WORLDBOOK];
    const rebindSpy = vi.fn(async (next: string[]) => {
      activeGlobal = [...next];
    });

    const stop = installWorldbookAutoFiler({
      getStatData: () => ({ command: { unlocked_factions: ['allied', 'soviet'] } }),
      getGlobalWorldbookNames: async () => activeGlobal,
      getWorldbookNames: async () => [...ALLIED_WORLDBOOK_GROUP, ...SOVIET_WORLDBOOK_GROUP, PROTOCOL_WORLDBOOK],
      rebindGlobalWorldbooks: rebindSpy,
      eventOn: (evt, cb) => {
        (listeners[evt] ??= []).push(cb);
        return { stop: () => {} };
      },
    });

    const swipedKey = Object.keys(listeners).find(k => k.includes('SWIPED'))!;
    expect(swipedKey).toBeDefined();
    listeners[swipedKey][0]();

    await vi.waitFor(() => {
      expect(rebindSpy).toHaveBeenCalledTimes(1);
    });
    for (const book of SOVIET_WORLDBOOK_GROUP) {
      expect(activeGlobal).toContain(book);
    }
    stop();
  });
});

/* ═══════════════ 2. PanelProtocol 零院所零剧透空态测试 ═══════════════ */

describe('CMD-UI-01 · PanelProtocol 08 [P2-2] 空院所零剧透空态', () => {
  it('无科研院所且 0 产点、无已启封协议时渲染 data-test="protocol-no-lab-empty"，隐藏未启封协议卡片防止名称剧透', async () => {
    const ProtocolComp = await loadProtocolComponent();

    // 战区仅有常规发电厂与兵营，无任何实验室或超算设施，且无已激活协议
    const emptyLabSnapshot = Schema.parse({
      bases: [
        {
          id: 'b1',
          name: '前哨基地',
          status: '警戒',
          buildings: [
            { name: '发电厂', state: '运转' },
            { name: '兵营', state: '运转' },
          ],
        },
      ],
      protocols: [],
    });

    const html = await renderToString(
      createSSRApp({
        render: () => h(ProtocolComp, { snapshot: emptyLabSnapshot, initialInstitute: 'soviet' }),
      }),
    );

    expect(html).toContain('data-test="protocol-no-lab-empty"');
    expect(html).toContain('尚未建造作战实验室或科研院所');
    expect(html).toContain('data-protocol-chain');
    expect(html).toContain('data-protocol-node-card');
  });

  it('建成任意科研院所（如红星实验设计局综合体）后解除零剧透空态并正常显示协议链图', async () => {
    const ProtocolComp = await loadProtocolComponent();

    const withLabSnapshot = Schema.parse({
      bases: [
        {
          id: 'b1',
          name: '主基地',
          status: '警戒',
          buildings: [{ name: '07·红星实验设计局综合体', state: '运转' }],
        },
      ],
      protocols: [],
    });

    const html = await renderToString(
      createSSRApp({
        render: () => h(ProtocolComp, { snapshot: withLabSnapshot, initialInstitute: 'soviet' }),
      }),
    );

    expect(html).not.toContain('data-test="protocol-no-lab-empty"');
    expect(html).toContain('data-protocol-chain');
    expect(html).toContain('data-protocol-node-card');
  });
});

/* ═══════════════ 3. ModalTechTree 与 ConsoleBuildGrid 多阵营筛选测试 ═══════════════ */

describe('CMD-UI-01 · ModalTechTree 与 ConsoleBuildGrid 多阵营筛选胶囊条与过滤逻辑', () => {
  it('filterEntriesByUnlockedFactions：过滤不属于任何已解锁阵营的跨阵营条目，始终保留通用 common 条目', async () => {
    const { filterEntriesByUnlockedFactions } = await loadModalTechExports();

    const sampleEntries = [
      { id: 'common.research.power', name: '基础发电学', scope: 'common', line: '电力科技' },
      { id: 'all.research.chrono', name: '超时空位移工学', faction: '盟军', line: '盟军特色' },
      { id: 'sov.research.tesla', name: '磁暴线圈理论', faction: '苏联', line: '苏联特色' },
      { id: 'yuri.research.psychic', name: '心灵控制理论', faction: '尤里', line: '尤里特色' },
    ];

    // 仅解锁盟军：保留 common + allied，过滤 soviet + yuri
    const onlyAllied = filterEntriesByUnlockedFactions(sampleEntries, ['allied'], 'all');
    expect(onlyAllied.map((e: any) => e.name)).toEqual(['基础发电学', '超时空位移工学']);

    // 解锁盟军 + 苏联：保留 common + allied + soviet，过滤 yuri
    const alliedAndSoviet = filterEntriesByUnlockedFactions(sampleEntries, ['allied', 'soviet'], 'all');
    expect(alliedAndSoviet.map((e: any) => e.name)).toEqual(['基础发电学', '超时空位移工学', '磁暴线圈理论']);

    // 切换胶囊至 soviet：仅保留 common + soviet
    const filterSovietOnly = filterEntriesByUnlockedFactions(sampleEntries, ['allied', 'soviet'], 'soviet');
    expect(filterSovietOnly.map((e: any) => e.name)).toEqual(['基础发电学', '磁暴线圈理论']);
  });

  it('ModalTechTree.vue 与 ConsoleBuildGrid.vue 渲染 data-test="faction-filter-bar" 并按已解锁阵营过滤条目', async () => {
    catalogFixture.buildings = [
      {
        name: '发电厂',
        cost: 300,
        power: -100,
        research: null,
        prereqs: [],
        need_buildings: [],
        desc: '通用基础发电设施',
        tags: ['电力设施'],
      },
      {
        name: '超时空传送仪',
        faction: '盟军',
        cost: 2500,
        power: 200,
        research: '超时空场域放大工学',
        prereqs: ['超时空场域放大工学'],
        need_buildings: [],
        desc: '盟军战略超武',
        tags: ['战略超武'],
      },
      {
        name: '铁幕装置',
        faction: '苏联',
        cost: 2500,
        power: 200,
        research: '铁幕场发生理论',
        prereqs: ['铁幕场发生理论'],
        need_buildings: [],
        desc: '苏联战略超武',
        tags: ['战略超武'],
      },
      {
        name: '心灵控制增幅器',
        faction: '尤里',
        cost: 2500,
        power: 200,
        research: '心灵控制理论',
        prereqs: ['心灵控制理论'],
        need_buildings: [],
        desc: '尤里战略超武',
        tags: ['战略超武'],
      },
    ];

    const ModalTechComp = await loadModalTechComponent();
    const BuildGridComp = await loadBuildGridComponent();

    // 1. 仅解锁盟军 ['allied']
    const snapAlliedOnly = Schema.parse({
      command: { unlocked_factions: ['allied'] },
    });

    const modalHtmlAllied = await renderToString(
      createSSRApp({
        render: () => h(ModalTechComp, { open: true, snapshot: snapAlliedOnly, initialHall: 'tech' }),
      }),
    );
    expect(modalHtmlAllied).toContain('data-test="faction-filter-bar"');
    expect(modalHtmlAllied).toContain('data-faction-filter="all"');
    expect(modalHtmlAllied).toContain('data-faction-filter="allied"');
    expect(modalHtmlAllied).not.toContain('data-faction-filter="soviet"');

    const gridSetupAllied = await loadBuildGridSetup({ snapshot: snapAlliedOnly });
    expect(gridSetupAllied.allItems.value.map((i: any) => i.name)).toEqual(['发电厂', '超时空传送仪']);

    // 2. 解锁双阵营 ['allied', 'soviet']
    const snapDual = Schema.parse({
      command: { unlocked_factions: ['allied', 'soviet'] },
    });

    const gridHtmlDual = await renderToString(
      createSSRApp({
        render: () => h(BuildGridComp, { snapshot: snapDual }),
      }),
    );
    expect(gridHtmlDual).toContain('data-test="faction-filter-bar"');
    expect(gridHtmlDual).toContain('data-faction-filter="all"');
    expect(gridHtmlDual).toContain('data-faction-filter="allied"');
    expect(gridHtmlDual).toContain('data-faction-filter="soviet"');

    const gridSetupDual = await loadBuildGridSetup({ snapshot: snapDual });
    expect(gridSetupDual.allItems.value.map((i: any) => i.name)).toEqual([
      '发电厂',
      '超时空传送仪',
      '铁幕装置',
    ]);

    // 切换建造网格阵营筛选为 'soviet'，仅保留通用 + 苏联条目
    gridSetupDual.selectFactionFilter('soviet');
    expect(gridSetupDual.allItems.value.map((i: any) => i.name)).toEqual(['发电厂', '铁幕装置']);
  });
});

/* ═══════════════ 4. ConsoleBuildGrid 双面板双铁律严格过滤与一键展开 MCV 交互 ═══════════════ */

describe('UI-BUILD-GRID-01 · ConsoleBuildGrid 建造/生产双面板双铁律严格过滤与一键展开 MCV 交互', () => {
  function setupStandardCatalogFixture() {
    catalogFixture.buildings = [
      {
        name: '发电厂',
        cost: 300,
        power: -100,
        research: null,
        prereqs: [],
        need_buildings: [],
        desc: '通用基础发电设施',
        tags: ['电力设施'],
      },
      {
        name: '矿石精炼厂',
        cost: 2000,
        power: 50,
        research: null,
        prereqs: [],
        need_buildings: [],
        desc: '矿车卸载与提炼矿石成资金',
        tags: ['资源产出'],
      },
      {
        name: '兵营',
        cost: 500,
        power: 10,
        research: null,
        prereqs: [],
        need_buildings: [],
        desc: '步兵训练基础设施',
        tags: ['人员相关'],
      },
      {
        name: '光棱塔',
        faction: '盟军',
        cost: 1500,
        power: 75,
        research: '光棱聚焦理论',
        prereqs: ['光棱聚焦理论'],
        need_buildings: ['发电厂'],
        desc: '高阶激光防御塔',
        tags: ['防御工事'],
      },
    ];
    catalogFixture.productions = [
      {
        name: '美国大兵（量产体）',
        faction: '盟军',
        cost: 200,
        need_building: '兵营',
        need_buildings: ['兵营'],
        prereqs: [],
        desc: '盟军基础步兵',
        tags: ['人员相关'],
      },
      {
        name: '超时空军团兵',
        faction: '盟军',
        cost: 1500,
        need_building: '兵营',
        need_buildings: ['兵营'],
        prereqs: ['超时空步兵跃迁学'],
        desc: '高阶超时空步兵',
        tags: ['人员相关'],
      },
      {
        name: 'M1A1灰熊主战坦克',
        faction: '盟军',
        cost: 700,
        need_building: '战车工厂',
        need_buildings: ['战车工厂'],
        prereqs: [],
        desc: '盟军主战坦克',
        tags: ['载具建造', '重型装甲'],
      },
    ];
  }

  it('1. 当 bases[0].buildings = [] 且 forces.vehicles = ["MCV（盟军）"] 时，基建/工业/生产面板卡片数为 0，渲染 data-test="deploy-mcv-btn"，点击后向 #send_textarea 填入含 MCV展开 的部署指令', async () => {
    setupStandardCatalogFixture();
    const BuildGridComp = await loadBuildGridComponent();

    const snapNoConyard = Schema.parse({
      command: { unlocked_factions: ['allied'], primary_faction: 'allied' },
      bases: [
        {
          id: 'b1',
          name: '一号前哨站',
          status: '警戒',
          buildings: [],
        },
      ],
      forces: {
        troops: {},
        vehicles: ['MCV（盟军）'],
        girls: [],
      },
    });

    const setupState = await loadBuildGridSetup({ snapshot: snapNoConyard });
    expect(setupState.hasRuntimeBases.value).toBe(true);
    expect(setupState.hasOperationalConyard.value).toBe(false);
    expect(setupState.availableMcvInFleet.value).toBe('MCV（盟军）');
    expect(setupState.allItems.value).toHaveLength(0);
    expect(setupState.tabCount('基建')).toBe(0);
    expect(setupState.tabCount('工业')).toBe(0);
    expect(setupState.tabCount('生产')).toBe(0);

    const html = await renderToString(
      createSSRApp({
        render: () => h(BuildGridComp, { snapshot: snapNoConyard }),
      }),
    );
    expect(html).toContain('当前基地「一号前哨站」尚未展开建造厂核心（MCV）');
    expect(html).toContain('data-test="deploy-mcv-btn"');
    expect(html).toContain('→ 【下达展开 MCV 指令】（MCV（盟军））');

    // 模拟宿主 #send_textarea 输入框环境并触发点击处理器
    const fakeTextarea = {
      value: '',
      focus: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    const prevDoc = (globalThis as any).document;
    const prevWin = (globalThis as any).window;
    const prevEvent = (globalThis as any).Event;
    try {
      const mockDoc = {
        querySelector: vi.fn((sel: string) => (sel.includes('#send_textarea') ? fakeTextarea : null)),
      };
      (globalThis as any).document = mockDoc;
      (globalThis as any).window = { parent: { document: mockDoc }, document: mockDoc };
      if (typeof prevEvent === 'undefined') {
        (globalThis as any).Event = class {
          type: string;
          constructor(t: string) {
            this.type = t;
          }
        };
      }

      setupState.handleDeployMcvClick();

      expect(fakeTextarea.value).toContain('【指挥官战术指令】【下达部署指令】：在「一号前哨站」就地展开 MCV（盟军）');
      expect(fakeTextarea.value).toContain('类型: MCV展开');
      expect(setupState.mcvDeployStagedHint.value).toContain('已填入输入框：展开 MCV（盟军） @ 一号前哨站');
    } finally {
      (globalThis as any).document = prevDoc;
      (globalThis as any).window = prevWin;
      (globalThis as any).Event = prevEvent;
    }
  });

  it('2. 当 bases[0].buildings = [{ name: "盟军建造厂", state: "运转" }] 时，基建面板立即展示无科技前置的基础建筑，未解锁科技的高阶建筑不展示；生产面板因尚无兵营/战车工厂仍为 0 项', async () => {
    setupStandardCatalogFixture();

    const snapWithConyard = Schema.parse({
      command: { unlocked_factions: ['allied'], primary_faction: 'allied' },
      bases: [
        {
          id: 'b1',
          name: '一号前哨站',
          status: '警戒',
          buildings: [{ name: '盟军建造厂', state: '运转' }],
        },
      ],
      tech: { done: [] },
    });

    const setupState = await loadBuildGridSetup({ snapshot: snapWithConyard });
    expect(setupState.hasOperationalConyard.value).toBe(true);

    const itemNames = setupState.allItems.value.map((i: any) => i.name);
    expect(itemNames).toContain('发电厂');
    expect(itemNames).toContain('矿石精炼厂');
    expect(itemNames).toContain('兵营');
    expect(itemNames).not.toContain('光棱塔');

    // 生产面板因尚无兵营/战车工厂仍为 0 项
    expect(setupState.tabCount('生产')).toBe(0);
  });

  it('3. 当 bases[0].buildings 加入 { name: "盟军兵营", state: "运转" } 时，生产面板立即展示基础步兵，但未研发前置科技的高阶步兵不展示', async () => {
    setupStandardCatalogFixture();

    const snapWithBarracks = Schema.parse({
      command: { unlocked_factions: ['allied'], primary_faction: 'allied' },
      bases: [
        {
          id: 'b1',
          name: '一号前哨站',
          status: '警戒',
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军兵营', state: '运转' },
          ],
        },
      ],
      tech: { done: [] },
    });

    const setupState = await loadBuildGridSetup({ snapshot: snapWithBarracks });
    const prodItems = setupState.allItems.value.filter((i: any) => i.category === '生产').map((i: any) => i.name);
    expect(prodItems).toEqual(['美国大兵']);
    expect(prodItems).not.toContain('超时空军团兵');
    expect(prodItems).not.toContain('M1A1灰熊主战坦克');
  });

  it('4. 跨阵营母体建筑隔离：当基地仅有「盟军建造厂 + 盟军兵营」时（哪怕 unlocked_factions: ["allied", "soviet"]），生产列表不会出现「动员兵」等苏联步兵', async () => {
    setupStandardCatalogFixture();
    catalogFixture.productions.push(
      {
        id: 'sov.unit.infantry.conscript',
        name: '动员兵（量产体）',
        faction: '苏联',
        cost: 100,
        need_building: '兵营',
        need_buildings: ['兵营'],
        prereqs: [],
        desc: '苏维埃基础步兵',
        tags: ['人员相关', '苏联'],
      },
      {
        id: 'common.unit.infantry.engineer',
        name: '战斗工程师',
        scope: 'common',
        cost: 500,
        need_building: '兵营',
        need_buildings: ['兵营'],
        prereqs: [],
        desc: '通用工程抢修人员',
        tags: ['人员相关'],
      },
    );

    const snapAlliedBaseWithDualUnlock = Schema.parse({
      command: { unlocked_factions: ['allied', 'soviet'], primary_faction: 'allied' },
      bases: [
        {
          id: 'b1',
          name: '一号前哨站',
          status: '运转中',
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军兵营', state: '运转' },
          ],
        },
      ],
      tech: { done: [] },
    });

    const setupState = await loadBuildGridSetup({ snapshot: snapAlliedBaseWithDualUnlock });
    const prodItems = setupState.allItems.value.filter((i: any) => i.category === '生产').map((i: any) => i.name);
    expect(prodItems).toContain('美国大兵');
    expect(prodItems).toContain('战斗工程师');
    expect(prodItems).not.toContain('动员兵');
  });

  it('5. 科技树全战区多基地建筑感知与阵营过滤 + 工程车间统一条件分析器联动', () => {
    // (a) 当第 2 座基地（bases[1]）拥有「空军指挥部」时，evaluateTechCardPrerequisites 正确判定需要「空军指挥部」的科技为 prereqMet: true
    const airTechDef = {
      id: 'common.research.air.supremacy',
      name: '制空权学说',
      line: '航空工程',
      tier: 1 as const,
      cost: 1000,
      eta: '2h',
      prereqs: [],
      need_buildings: ['空军指挥部'],
      requirements: {
        kind: 'building' as const,
        name: '空军指挥部',
        scope: 'current' as const,
        state: 'existing' as const,
      },
    };

    const evalWithSecondBase = evaluateTechCardPrerequisites(airTechDef, {
      bases: [
        {
          id: 'base_1',
          name: '一号主基地',
          buildings: [{ name: '盟军建造厂', state: '运转' }],
        },
        {
          id: 'base_2',
          name: '二号航空前哨基地',
          buildings: [{ name: '空军指挥部', state: '运转' }],
        },
      ],
      techDone: [],
      forces: { troops: {}, vehicles: [] },
    });
    expect(evalWithSecondBase.prereqMet).toBe(true);
    expect(evalWithSecondBase.missingPrereqs).toEqual([]);

    // (b) 科技条目阵营过滤：通用条目始终保留，阵营专属条目遵循 unlockedFactions 与 factionFilter
    expect(
      shouldIncludeResearchByFactionFilter(
        { id: 'common.research.power', name: '基础电力学', scope: 'common' },
        ['allied'],
        'allied',
      ),
    ).toBe(true);
    expect(
      shouldIncludeResearchByFactionFilter(
        { id: 'sov.research.tesla', name: '磁暴线圈工程', faction: '苏联' },
        ['allied'],
        'all',
      ),
    ).toBe(false);
    expect(
      shouldIncludeResearchByFactionFilter(
        { id: 'sov.research.tesla', name: '磁暴线圈工程', faction: '苏联' },
        ['allied', 'soviet'],
        'soviet',
      ),
    ).toBe(true);

    // (c) 工程车间面板接入统一条件分析器（支持激活协议与 need_building 前置建筑校验）
    expect(
      checkIsResearchUnlocked('高空无人侦察协定', [], {
        'all.protocol.ra3.high_altitude_uav_pact': { status: 'active' },
      }),
    ).toBe(true);

    const retrofitDef = {
      kind: 'retrofit' as const,
      name: '灰熊坦克装甲强化工程',
      grade: '小改' as const,
      cost: 800,
      eta: '1h',
      research: '复合装甲学',
      need_building: '战车工厂',
      desc: '测试改装工程',
    };
    expect(
      resolveCatalogItemDotClass(retrofitDef, [], true, ['复合装甲学'], undefined, [
        { buildings: [{ name: '盟军建造厂', state: '运转' }] },
      ]),
    ).toBe('eng-item-dot--locked');
    expect(
      resolveCatalogItemStatusTitle(retrofitDef, [], true, ['复合装甲学'], undefined, [
        { buildings: [{ name: '盟军建造厂', state: '运转' }] },
      ]),
    ).toBe('待部署前置建筑：战车工厂');
    expect(
      resolveCatalogItemDotClass(retrofitDef, [], true, ['复合装甲学'], undefined, [
        { buildings: [{ name: '盟军战车工厂', state: '运转' }] },
      ]),
    ).toBe('eng-item-dot--ready');
  });

  it('6. HERO-UNIT-01：生产项目数量上限（max_count=1）在 ConsoleBuildGrid 中的达限变灰与不可再生产标识', async () => {
    setupStandardCatalogFixture();
    catalogFixture.productions.push({
      id: 'ally.unit.infantry.tanya',
      name: '盟军传奇特战员·谭雅',
      aliases: ['谭雅', 'Tanya', '特战女王谭雅'],
      faction: '盟军',
      category: 'infantry',
      cost: 1500,
      max_count: 1,
      need_building: '兵营',
      need_buildings: ['兵营'],
      prereqs: ['特种作战高级工学'],
      desc: '盟军传奇特战女王，全战区唯一编制。',
      tags: ['人员相关', '传奇英雄', '唯一单位'],
    } as any);

    const snapWithTanyaOwned = Schema.parse({
      command: { unlocked_factions: ['allied'], primary_faction: 'allied' },
      bases: [
        {
          id: 'b1',
          name: '一号主基地',
          status: '运转中',
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军兵营', state: '运转' },
          ],
        },
      ],
      tech: { done: ['特种作战高级工学'] },
      forces: {
        troops: { 谭雅: 1 },
        vehicles: [],
      },
    });

    const setupState = await loadBuildGridSetup({ snapshot: snapWithTanyaOwned });
    setupState.currentTab.value = '生产';
    const tanyaItem = setupState.allItems.value.find((i: any) => i.name === '盟军传奇特战员·谭雅');
    expect(tanyaItem).toBeDefined();
    expect(tanyaItem.builtCount).toBe(1);
    expect(tanyaItem.maxCount).toBe(1);
    expect(tanyaItem.isMaxedOut).toBe(true);
    expect(setupState.cardTitle(tanyaItem)).toContain('已达生产数量上限（1/1）· 不可再生产');

    const BuildGridComp = await loadBuildGridComponent();
    const html = await renderToString(
      createSSRApp({
        render: () => h(BuildGridComp, { snapshot: snapWithTanyaOwned, initialTab: '生产' }),
      }),
    );
    expect(html).toContain('盟军传奇特战员·谭雅');
    expect(html).toContain('ra-card--maxed');
    expect(html).toContain('data-maxed="true"');
    expect(html).toContain('data-test="prod-maxed-badge"');
    expect(html).toContain('不可再生产');
    expect(html).toContain('已达上限 (1/1) · 不可再生产');
  });

  it('7. Stage I3 双层沉浸门控：未开局锁死（PRE-LAUNCH LOCKED）与已开局零基地 MCV 待命（MCV STANDBY · 0 建筑可建）', async () => {
    setupStandardCatalogFixture();
    const BuildGridComp = await loadBuildGridComponent();

    // (a) 第一层门控：preLaunchLocked = true（未开局锁死态），6 大页签 0 条目，展示 data-test="prelaunch-locked-panel"
    const snapZero = Schema.parse({});
    const lockedSetup = await loadBuildGridSetup({ snapshot: snapZero, preLaunchLocked: true });
    expect(lockedSetup.allItems.value).toHaveLength(0);
    expect(lockedSetup.tabCount('基建')).toBe(0);
    expect(lockedSetup.tabCount('生产')).toBe(0);

    const lockedHtml = await renderToString(
      createSSRApp({
        render: () => h(BuildGridComp, { snapshot: snapZero, preLaunchLocked: true }),
      }),
    );
    expect(lockedHtml).toContain('data-test="prelaunch-locked-panel"');
    expect(lockedHtml).toContain('EVA 战术链路尚未激活 · 待开局部署');
    expect(lockedHtml).not.toContain('发电厂');

    // (b) 第二层门控：已开局但 bases = []（遵守 MCV 展开前零预设基地铁律），严禁泄露 22 项建筑，展示 data-test="mcv-standby-panel" 与一键展开 MCV 按钮
    const snapZeroBaseLaunched = Schema.parse({
      meta: {
        world_id: 'cyber2077',
        date: '2042-06-15',
        location: '西澳皮尔巴拉基地（西澳大利亚·珀斯外围与皮尔巴拉矿带）',
      },
      command: { unlocked_factions: ['allied'], primary_faction: 'allied' },
      bases: [],
      forces: {
        troops: {},
        vehicles: ['MCV（盟军）'],
        girls: [],
      },
    });

    const standbySetup = await loadBuildGridSetup({ snapshot: snapZeroBaseLaunched, preLaunchLocked: false });
    expect(standbySetup.isZeroBaseStandby.value).toBe(true);
    expect(standbySetup.allItems.value).toHaveLength(0);
    expect(standbySetup.tabCount('基建')).toBe(0);
    expect(standbySetup.tabCount('工业')).toBe(0);
    expect(standbySetup.tabCount('生产')).toBe(0);
    expect(standbySetup.currentBaseName.value).toBe('西澳皮尔巴拉基地');

    const standbyHtml = await renderToString(
      createSSRApp({
        render: () => h(BuildGridComp, { snapshot: snapZeroBaseLaunched, preLaunchLocked: false }),
      }),
    );
    expect(standbyHtml).toContain('data-test="mcv-standby-panel"');
    expect(standbyHtml).toContain('MCV 机动待命 · 尚未展开基地（0 建筑可建）');
    expect(standbyHtml).toContain('拟定部署坐标：西澳皮尔巴拉基地（西澳大利亚·珀斯外围与皮尔巴拉矿带）');
    expect(standbyHtml).toContain('data-test="deploy-mcv-btn"');
    expect(standbyHtml).not.toContain('矿石精炼厂');
  });
});
