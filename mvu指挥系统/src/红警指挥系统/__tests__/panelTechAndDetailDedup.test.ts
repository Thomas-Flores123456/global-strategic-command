/* eslint-disable import-x/no-nodejs-modules -- 测试内即时编译 SFC 并在 afterAll 清理临时模块 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { FACTION_DEFS } from '../core/catalog';
import { Schema } from '../core/schema';
import { closeDetail, detail, openLookup, useDetail } from '../composables/useDetail';
import { filterDynamicCodexResearches } from '../ui/panels/panelTechHelpers';

const storeFixture = vi.hoisted(() => ({
  data: null as any,
}));

const catalogFixture = vi.hoisted(() => ({
  buildings: [] as any[],
  productions: [] as any[],
  researches: [] as any[],
  retrofits: [] as any[],
  projects: [] as any[],
  factionDefs: [] as any[],
  protocols: [] as any[],
  overlays: [] as any[],
  effectiveCatalog: undefined as any,
  dynamicCatalog: undefined as any,
}));

vi.mock('../composables/store', () => ({
  in_tavern: false,
  useDataStore: () => storeFixture,
}));
vi.mock('../composables/useCatalog', () => ({
  useCatalogStore: () => catalogFixture,
  dynamicCatalogSnapshot: () => catalogFixture.dynamicCatalog ?? null,
}));
vi.mock('toastr', () => ({
  default: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', render: () => hh('span', { class: 'icon-stub' }) } };
});

const PANEL_TECH_PATH = fileURLToPath(new URL('../ui/panels/PanelTech.vue', import.meta.url));
const PANEL_TECH_SSR_PATH = fileURLToPath(new URL('../ui/panels/PanelTech.__pkgc_dedup_ssr__.mts', import.meta.url));
const PANEL_TECH_BIND_PATH = fileURLToPath(new URL('../ui/panels/PanelTech.__pkgc_dedup_bind__.mts', import.meta.url));

const MODAL_TECH_PATH = fileURLToPath(new URL('../../中控悬浮窗/modals/ModalTechTree.vue', import.meta.url));
const MODAL_TECH_BIND_PATH = fileURLToPath(
  new URL('../../中控悬浮窗/modals/ModalTechTree.__pkgc_dedup_bind__.mts', import.meta.url),
);

const CONSOLE_BUILD_GRID_PATH = fileURLToPath(
  new URL('../../中控悬浮窗/console/ConsoleBuildGrid.vue', import.meta.url),
);
const PANEL_INTEGRITY_PATH = fileURLToPath(
  new URL('../../中控悬浮窗/panels/PanelIntegrityCheck.vue', import.meta.url),
);
const STEP2_RESOURCES_PATH = fileURLToPath(
  new URL('../../开场启动器/steps/Step2Resources.vue', import.meta.url),
);

let bindSeq = 0;

function stripTypeImports(code: string): string {
  return code
    .replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '')
    .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '')
    .replace(
      /import\s+PanelTech\s+from\s+['"][^'"]*PanelTech\.vue['"];?/,
      'const PanelTech = { name: "PanelTech", render: () => null };',
    );
}

async function compileSfcComponent(sfcPath: string, outPath: string, id: string): Promise<Record<string, any>> {
  const source = readFileSync(sfcPath, 'utf8');
  const { descriptor, errors } = parse(source, { filename: sfcPath });
  if (errors.length > 0) throw new Error(`SFC 解析失败：${errors.map(String).join('; ')}`);
  const compiled = compileScript(descriptor, {
    id,
    inlineTemplate: true,
    templateOptions: { id, scoped: descriptor.styles.some(s => s.scoped) },
  });
  writeFileSync(outPath, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
  return import(`${pathToFileURL(outPath).href}?v=${(bindSeq += 1)}`);
}

async function compileSfcSetup(
  sfcPath: string,
  outPath: string,
  id: string,
  props: Record<string, unknown> = {},
  emit = vi.fn(),
): Promise<{ mod: Record<string, any>; setupState: Record<string, any>; emit: ReturnType<typeof vi.fn> }> {
  const source = readFileSync(sfcPath, 'utf8');
  const { descriptor, errors } = parse(source, { filename: sfcPath });
  if (errors.length > 0) throw new Error(`SFC 解析失败：${errors.map(String).join('; ')}`);
  const compiled = compileScript(descriptor, { id, inlineTemplate: false });
  writeFileSync(outPath, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
  const mod = (await import(`${pathToFileURL(outPath).href}?v=${(bindSeq += 1)}`)) as Record<string, any>;
  const setupState = mod.default.setup(props, { emit, expose: vi.fn(), attrs: {}, slots: {} });
  return { mod, setupState, emit };
}

afterAll(() => {
  for (const p of [PANEL_TECH_SSR_PATH, PANEL_TECH_BIND_PATH, MODAL_TECH_BIND_PATH]) {
    try {
      unlinkSync(p);
    } catch {
      // ignore
    }
  }
});

const WORLDBOOK_RESEARCH_FIXTURES = [
  {
    id: 'common.research.t2.low_observable',
    name: '低可观测技术工学',
    cost: 1200,
    eta: '约4日',
    line: '航空',
    tier: 2 as const,
    unlocks: 'F-117A夜鹰隐身攻击机、B-2A幽灵战略轰炸机',
    prereq: '现代航空空气动力学 + 雷达吸波涂层工艺',
    prereqs: ['现代航空空气动力学', '雷达吸波涂层工艺'],
    desc: '通过多面体气动外形与宽频雷达吸波材料显著降低雷达散射截面积（RCS）。',
  },
  {
    id: 'common.research.t2.smr_nuclear',
    name: '小型模块化核能工学',
    cost: 1500,
    eta: '约5日',
    line: '能源',
    tier: 2 as const,
    unlocks: '小型模块化核反应堆',
    prereq: '基础电力学',
    prereqs: ['基础电力学'],
    desc: '工厂预制、模块化拼装的紧凑型裂变反应堆工程理论。',
  },
];

const POLLUTED_CODEX_FIXTURES = [
  {
    name: '低可观测技术工学',
    kind: '科技',
    desc: 'LLM 误输出的同名污染图鉴',
    params: { 科技线: '动态研究', 层级: 'T2', 造价: '1200', 工期: '4日' },
  },
  {
    name: '模块化小型核能技术',
    kind: '科技',
    desc: 'LLM 语序调换+壳词替换的高可信变体污染项',
    params: { 科技线: '动态研究', 层级: 'T2', 造价: '1500', 工期: '5日' },
  },
  {
    name: '幽能裂隙超时空折跃炉',
    kind: '科技',
    desc: 'EVA 真正自创的跨位面折跃能源科技',
    params: { 科技线: '异界科学', 层级: 'T3', 造价: '3000', 工期: '7日', 前置: '低可观测技术工学' },
  },
];

beforeEach(() => {
  closeDetail();
  catalogFixture.buildings = [];
  catalogFixture.productions = [];
  catalogFixture.researches = [...WORLDBOOK_RESEARCH_FIXTURES];
  catalogFixture.retrofits = [];
  catalogFixture.projects = [];
  catalogFixture.factionDefs = [...FACTION_DEFS];
  catalogFixture.protocols = [];
  catalogFixture.overlays = [];
  catalogFixture.effectiveCatalog = undefined;
  catalogFixture.dynamicCatalog = { researches: [...WORLDBOOK_RESEARCH_FIXTURES] };
  storeFixture.data = Schema.parse({
    bases: [
      {
        id: 'base-1',
        name: '第一基地',
        status: '警戒',
        buildings: [{ name: '盟军建造厂', state: '运转' }],
      },
    ],
    codex: [...POLLUTED_CODEX_FIXTURES],
  });
});

describe('PKG-C · 科技面板、详情抽屉、建造网格、体检面板与开场启动器世界书同源去重及优先级翻转', () => {
  it('1. filterDynamicCodexResearches：剔除世界书同名（低可观测技术工学）与高可信变体（模块化小型核能技术），保留真 EVA 自创科技', () => {
    const filtered = filterDynamicCodexResearches(POLLUTED_CODEX_FIXTURES, WORLDBOOK_RESEARCH_FIXTURES);
    expect(filtered.map(c => c.name)).toEqual(['幽能裂隙超时空折跃炉']);
    expect(filtered.some(c => c.name === '低可观测技术工学')).toBe(false);
    expect(filtered.some(c => c.name === '模块化小型核能技术')).toBe(false);
  });

  it('2. PanelTech.vue & ModalTechTree.vue：世界书自有科技在污染 codex 下仅出现 1 次且 dynamic === false（无 EVA 增补徽标），真自创科技保留 dynamic === true', async () => {
    const { setupState } = await compileSfcSetup(PANEL_TECH_PATH, PANEL_TECH_BIND_PATH, 'pkgc_paneltech_bind');
    const items = setupState.uiResearches.value as Array<{ name: string; dynamic?: boolean; line: string }>;

    const lowObsMatches = items.filter(r => r.name === '低可观测技术工学');
    expect(lowObsMatches).toHaveLength(1);
    expect(lowObsMatches[0].dynamic).toBe(false);
    expect(lowObsMatches[0].line).toBe('航空');

    const smrMatches = items.filter(r => r.name === '小型模块化核能工学' || r.name === '模块化小型核能技术');
    expect(smrMatches).toHaveLength(1);
    expect(smrMatches[0].name).toBe('小型模块化核能工学');
    expect(smrMatches[0].dynamic).toBe(false);

    const novelMatches = items.filter(r => r.name === '幽能裂隙超时空折跃炉');
    expect(novelMatches).toHaveLength(1);
    expect(novelMatches[0].dynamic).toBe(true);
    expect(novelMatches[0].line).toBe('异界科学');

    // SSR 渲染验证：仅幽能裂隙超时空折跃炉渲染 EVA 增补徽标
    const mod = await compileSfcComponent(PANEL_TECH_PATH, PANEL_TECH_SSR_PATH, 'pkgc_paneltech_ssr');
    const html = await renderToString(createSSRApp({ render: () => h(mod.default as Component) }));
    const evaBadgeCount = (html.match(/EVA 增补/g) ?? []).length;
    expect(evaBadgeCount).toBe(1);
    expect(html).not.toContain('模块化小型核能技术');

    // ModalTechTree.vue activeSnapshot 同步过滤世界书同源科技污染
    const modal = await compileSfcSetup(MODAL_TECH_PATH, MODAL_TECH_BIND_PATH, 'pkgc_modaltech_bind', {
      open: true,
      initialHall: 'tech',
    });
    const snapCodex = modal.setupState.activeSnapshot.value.codex as Array<{ name: string; kind: string }>;
    expect(snapCodex.map(c => c.name)).toEqual(['幽能裂隙超时空折跃炉']);
  });

  it('3. useDetail().openLookup：彻底翻转优先级，优先返回世界书标准科技详情（note 为科技线与 Tier 信息，绝非「动态档案 · 由 EVA 增补」）', () => {
    // 精确同名且 codex 存在污染项
    const resExact = useDetail().openLookup('低可观测技术工学', POLLUTED_CODEX_FIXTURES);
    expect(resExact.title).toBe('低可观测技术工学');
    expect(resExact.kind).toBe('科技');
    expect(resExact.note).toBe('航空线 · T2');
    expect(resExact.note).not.toContain('动态档案 · 由 EVA 增补');
    expect(resExact.params).toContainEqual(['科技线', '航空线']);
    expect(resExact.params).toContainEqual(['层级', 'T2']);
    expect(resExact.params).toContainEqual(['前置', '现代航空空气动力学 + 雷达吸波涂层工艺']);
    expect(detail.data?.note).toBe('航空线 · T2');

    // 高可信变体名（模块化小型核能技术 -> 小型模块化核能工学）且 codex 存在同名污染项
    const resVariant = openLookup('模块化小型核能技术', POLLUTED_CODEX_FIXTURES);
    expect(resVariant.title).toBe('小型模块化核能工学');
    expect(resVariant.kind).toBe('科技');
    expect(resVariant.note).toBe('能源线 · T2');
    expect(resVariant.note).not.toContain('动态档案 · 由 EVA 增补');

    // 真正的 EVA 自创科技回退查 codex，保留「动态档案 · 由 EVA 增补」
    const resNovel = openLookup('幽能裂隙超时空折跃炉', POLLUTED_CODEX_FIXTURES);
    expect(resNovel.title).toBe('幽能裂隙超时空折跃炉');
    expect(resNovel.kind).toBe('科技');
    expect(resNovel.note).toBe('动态档案 · 由 EVA 增补');
  });

  it('4. ConsoleBuildGrid & 体检面板 & Step2Resources：接入可信度去重并退役 RESEARCHES 空数组硬编码依赖', () => {
    const buildGridSfc = readFileSync(CONSOLE_BUILD_GRID_PATH, 'utf8');
    expect(buildGridSfc).toContain('isSystemCatalogEntity');
    expect(buildGridSfc).toContain('buildEntityCredibilityIndex');

    const integritySfc = readFileSync(PANEL_INTEGRITY_PATH, 'utf8');
    expect(integritySfc).toContain('dynamicCatalogSnapshot');
    expect(integritySfc).toMatch(/RESEARCHES\.length\s*>\s*0/);

    const step2Sfc = readFileSync(STEP2_RESOURCES_PATH, 'utf8');
    expect(step2Sfc).toContain('useCatalogStore');
    expect(step2Sfc).toMatch(/storeResearches\.filter\(r\s*=>\s*r\.tier\s*===\s*1\)/);
  });
});
