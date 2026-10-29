/**
 * PanelProtocol.test.ts —— PRT-UI-01 双生主厅与阵营院所皮肤骨架单测
 *
 * 覆盖：
 * 1. ModalTechTree 双生主厅顶栏切换（tech ⇄ protocol）、[✨ 新揭示 +K] 脉冲徽标渲染、UTO 观察层零退化；
 * 2. PanelProtocol 苏/盟两套院所子页切换（data-institute-theme="soviet" | "allied"）与专属视觉皮肤样式；
 * 3. 随基地在役建筑从 T1 → T2 → T3 动态晋升院所头衔（含盟军节点不代升苏联 T3、停机/建造中不晋升断言）；
 * 4. 右翼全局算力与通用底座并网栏（基础 0.10 + 主轴 T2/T3 + 跨系 50% + 超算/量子超算点产流速与在役徽标）；
 * 5. 左栏轨道目录 n/N 计数与轨道切换、主视区与右栏详情槽位；
 * 6. ConsoleQuickActions 左键【科技 TECH】可实验协议计数徽标与三宫格不增第 4 钮断言；
 * 7. 零 MVU 直写与零自动发送静态审查。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读写临时编译产物，不进 bundle */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, createSSRApp, h, nextTick, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { Schema } from '../../红警指挥系统/core/schema';
import { computeOverview } from '../../红警指挥系统/engines/researchCompute';

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
  for (const key of Object.keys(catalogFixture) as (keyof typeof catalogFixture)[])
    catalogFixture[key] = key === 'effectiveCatalog' || key === 'dynamicCatalog' ? undefined : [];
});

vi.mock('../../红警指挥系统/composables/store', () => ({
  useDataStore: () => ({ data: null }),
}));

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', render: () => hh('span', { class: 'icon-stub' }) } };
});

vi.mock('../../红警指挥系统/ui/panels/PanelTech.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'PanelTech', render: () => hh('div', { class: 'panel-tech-stub' }) } };
});

/* ═══════════════ SFC 即时编译辅助（SSR + Setup 绑定） ═══════════════ */

const PROTOCOL_SFC_PATH = fileURLToPath(new URL('../panels/PanelProtocol.vue', import.meta.url));
const PROTOCOL_SSR_PATH = fileURLToPath(new URL('../panels/PanelProtocol.__prt_ssr__.mts', import.meta.url));
const PROTOCOL_BIND_PATH = fileURLToPath(new URL('../panels/PanelProtocol.__prt_bind__.mts', import.meta.url));

const MODAL_TECH_SFC_PATH = fileURLToPath(new URL('../modals/ModalTechTree.vue', import.meta.url));
const MODAL_TECH_SSR_PATH = fileURLToPath(new URL('../modals/ModalTechTree.__prt_ssr__.mts', import.meta.url));
const MODAL_TECH_BIND_PATH = fileURLToPath(new URL('../modals/ModalTechTree.__prt_bind__.mts', import.meta.url));

const QUICK_ACTIONS_SFC_PATH = fileURLToPath(new URL('../console/ConsoleQuickActions.vue', import.meta.url));
const QUICK_ACTIONS_SSR_PATH = fileURLToPath(new URL('../console/ConsoleQuickActions.__prt_ssr__.mts', import.meta.url));

let protocolCompPromise: Promise<Component> | undefined;
let modalTechCompPromise: Promise<Component> | undefined;
let quickActionsCompPromise: Promise<Component> | undefined;
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
      id: 'panelprotocolssr',
      inlineTemplate: true,
      templateOptions: { id: 'panelprotocolssr', scoped: descriptor.styles.some(s => s.scoped) },
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
      id: 'modaltechprtssr',
      inlineTemplate: true,
      templateOptions: { id: 'modaltechprtssr', scoped: descriptor.styles.some(s => s.scoped) },
    });
    writeFileSync(MODAL_TECH_SSR_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
    const mod = (await import(pathToFileURL(MODAL_TECH_SSR_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return modalTechCompPromise;
}

function loadQuickActionsComponent(): Promise<Component> {
  quickActionsCompPromise ??= (async () => {
    const source = readFileSync(QUICK_ACTIONS_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'ConsoleQuickActions.vue' });
    if (errors.length > 0) throw new Error(`ConsoleQuickActions.vue 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id: 'quickactionsprtssr',
      inlineTemplate: true,
      templateOptions: { id: 'quickactionsprtssr', scoped: descriptor.styles.some(s => s.scoped) },
    });
    writeFileSync(QUICK_ACTIONS_SSR_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
    const mod = (await import(pathToFileURL(QUICK_ACTIONS_SSR_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return quickActionsCompPromise;
}

async function loadProtocolSetup(props: Record<string, unknown>, emit = vi.fn()): Promise<Record<string, any>> {
  const source = readFileSync(PROTOCOL_SFC_PATH, 'utf8');
  const { descriptor } = parse(source, { filename: 'PanelProtocol.vue' });
  const compiled = compileScript(descriptor, { id: 'panelprotocolbind', inlineTemplate: false });
  writeFileSync(PROTOCOL_BIND_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
  const mod = (await import(`${pathToFileURL(PROTOCOL_BIND_PATH).href}?v=${(bindSeq += 1)}`)) as {
    default: { setup: (p: unknown, ctx: unknown) => Record<string, any> };
  };
  return mod.default.setup(
    { snapshot: undefined, initialInstitute: 'soviet', initialTrack: null, ...props },
    { emit, expose: vi.fn(), attrs: {}, slots: {} },
  );
}

async function loadModalTechSetup(props: Record<string, unknown>, emit = vi.fn()): Promise<Record<string, any>> {
  const source = readFileSync(MODAL_TECH_SFC_PATH, 'utf8');
  const { descriptor } = parse(source, { filename: 'ModalTechTree.vue' });
  const compiled = compileScript(descriptor, { id: 'modaltechbind', inlineTemplate: false });
  writeFileSync(MODAL_TECH_BIND_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
  const mod = (await import(`${pathToFileURL(MODAL_TECH_BIND_PATH).href}?v=${(bindSeq += 1)}`)) as {
    default: { setup: (p: unknown, ctx: unknown) => Record<string, any> };
  };
  return mod.default.setup(
    { open: true, snapshot: undefined, initialHall: 'tech', newlyRevealedCount: undefined, ...props },
    { emit, expose: vi.fn(), attrs: {}, slots: {} },
  );
}

afterAll(() => {
  for (const p of [
    PROTOCOL_SSR_PATH,
    PROTOCOL_BIND_PATH,
    MODAL_TECH_SSR_PATH,
    MODAL_TECH_BIND_PATH,
    QUICK_ACTIONS_SSR_PATH,
  ]) {
    try {
      unlinkSync(p);
    } catch {
      // 忽略文件不存在
    }
  }
});

/* ═══════════════ 1. ConsoleQuickActions 左门复合入口徽标与三宫格红线 ═══════════════ */

describe('PRT-UI-01 · ConsoleQuickActions 左键【科技 TECH】复合入口徽标与工程 DEV 门禁', () => {
  it('生产态默认（!debugState.enabled）隐藏【工程 ENG】按钮（grid-cols-2），开启 DEV 调试模式后显示且严守三宫格不增第 4 钮', async () => {
    const { debugState } = await import('../../红警指挥系统/composables/useDebugMode');
    const QuickActions = await loadQuickActionsComponent();
    const baseSnapshot = Schema.parse({
      bases: [
        {
          id: 'b1',
          name: '红星主基地',
          status: '警戒',
          buildings: [{ name: '红星实验设计局', state: '运转' }],
        },
      ],
    });
    const snapshotWithProtocols = {
      ...baseSnapshot,
      protocol_points: 2,
      economy: { ...baseSnapshot.economy, credits: 5000 },
      protocols: [
        { ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker', status: 'available' },
        { ref: 'sov.research.t2.iron_curtain_emergency_overload', status: 'experimenting', exp: 35, attempts: 1 },
        { ref: 'sov.protocol.ra3.sputnik_one_way_deployment', status: 'active', exp: 100 },
        { ref: 'sov.protocol.ra3.crusher_crane_salvage', status: 'locked' },
      ],
    };

    try {
      // A. 生产环境默认状态（debugState.enabled = false）：隐藏工程按钮，渲染双列科技+军备
      debugState.enabled = false;
      const prodHtml = await renderToString(
        createSSRApp({
          render: () => h(QuickActions, { snapshot: snapshotWithProtocols, activeModal: null }),
        }),
      );
      expect(prodHtml).toContain('data-protocol-ready-count');
      expect(prodHtml).toContain('data-count="2"');
      expect(prodHtml).not.toContain('data-test="quick-action-engineering"');
      const prodButtons = prodHtml.match(/class="ra-action-card\b/g) ?? [];
      expect(prodButtons).toHaveLength(2);
      expect(prodHtml).toContain('grid-cols-2');

      // B. 开启 DEV 调试模式（debugState.enabled = true）：显示工程按钮，严守三宫格红线
      debugState.enabled = true;
      const devHtml = await renderToString(
        createSSRApp({
          render: () => h(QuickActions, { snapshot: snapshotWithProtocols, activeModal: null }),
        }),
      );
      expect(devHtml).toContain('data-test="quick-action-engineering"');
      const devButtons = devHtml.match(/class="ra-action-card\b/g) ?? [];
      expect(devButtons).toHaveLength(3);
      expect(devHtml).toContain('grid-cols-3');
    } finally {
      debugState.enabled = false;
    }
  });

  it('FloatingApp.vue 绑定 debugState.enabled 控制工程入口与 ModalEngineering，并在关闭 debugState.enabled 时自动关闭工程弹窗', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const floatingSrc = fs.readFileSync(
      path.resolve(__dirname, '../console/FloatingApp.vue'),
      'utf8',
    );
    expect(floatingSrc).toContain(':show-engineering="debugState.enabled"');
    expect(
      floatingSrc.includes('v-if="debugState.enabled && activeModal === \'engineering\'"') ||
        floatingSrc.includes('v-if="activeModal === \'engineering\' && debugState.enabled"'),
    ).toBe(true);
    expect(floatingSrc).toContain("if (key === 'engineering' && !debugState.enabled) return;");
    expect(floatingSrc).toContain("if (!enabled && activeModal.value === 'engineering')");
  });

  it('无 available / experimenting 协议时隐藏协议计数徽标', async () => {
    const QuickActions = await loadQuickActionsComponent();
    const baseSnapshot = Schema.parse({});
    const snapshotNoReady = {
      ...baseSnapshot,
      protocols: [
        { ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker', status: 'locked' },
        { ref: 'sov.protocol.ra3.sputnik_one_way_deployment', status: 'active', exp: 100 },
      ],
    };

    const html = await renderToString(
      createSSRApp({
        render: () => h(QuickActions, { snapshot: snapshotNoReady, activeModal: null }),
      }),
    );

    expect(html).not.toContain('data-protocol-ready-count');
  });
});

/* ═══════════════ 2. ModalTechTree 双生主厅顶栏切换、新揭示脉冲徽标与 UTO 零退化 ═══════════════ */

describe('PRT-UI-01 · ModalTechTree 双生主厅顶栏与挂载切换', () => {
  it('默认处于 tech 主厅：渲染双主厅切换器、可实验计数、UTO 11 槽观察层与 PanelTech（100% 零退化）', async () => {
    const ModalTech = await loadModalTechComponent();
    const baseSnapshot = Schema.parse({
      bases: [
        {
          id: 'b1',
          name: '1号基地',
          status: '警戒',
          buildings: [{ name: '盟军建造厂', state: '运转' }],
        },
      ],
    });
    const snapshot = {
      ...baseSnapshot,
      protocol_points: 2,
      economy: { ...baseSnapshot.economy, credits: 5000 },
      protocols: [
        { ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker', status: 'available' },
        { ref: 'sov.protocol.ra3.sputnik_one_way_deployment', status: 'experimenting', exp: 50 },
        { ref: 'sov.protocol.ra3.crusher_crane_salvage', status: 'active', exp: 100, reveals: ['高能磁暴装甲学'] },
      ],
    };

    const html = await renderToString(
      createSSRApp({
        render: () => h(ModalTech, { open: true, snapshot }),
      }),
    );

    // 双主厅切换器与可实验计数
    expect(html).toContain('data-hall-tab="tech"');
    expect(html).toContain('data-hall-tab="protocol"');
    expect(html).toContain('科技研发树 (Tech Tree)');
    expect(html).toContain('统帅部条令 (Protocols · 可攻关 2)');

    // 协议突破揭示科技 → 左厅亮起 [新揭示 +1] 脉冲徽标
    expect(html).toContain('data-newly-revealed-badge');
    expect(html).toContain('新揭示 +1');

    // UTO 观察层与 PanelTech 零退化
    expect(html).toContain('data-uto-tech-summary');
    expect(html).toContain('data-uto-tech-observer');
    const slotMatches = html.match(/data-slot-id="slot\.[^"]+"/g) ?? [];
    expect(slotMatches).toHaveLength(11);
    expect(html).toContain('panel-tech-stub');
  });

  it('切换至 protocol 主厅时挂载 PanelProtocol，并支持跨厅 jump-to-tech 切回 tech 厅', async () => {
    const ModalTech = await loadModalTechComponent();
    const snapshot = {
      ...Schema.parse({}),
      protocol_points: 3.5,
      protocols: [{ ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker', status: 'available' }],
    };

    const html = await renderToString(
      createSSRApp({
        render: () => h(ModalTech, { open: true, snapshot, initialHall: 'protocol', newlyRevealedCount: 3 }),
      }),
    );

    expect(html).toContain('data-active-hall="protocol"');
    expect(html).toContain('data-protocol-panel');
    expect(html).toContain('data-newly-revealed-badge');
    expect(html).toContain('新揭示 +3');
    expect(html).not.toContain('data-uto-tech-observer');

    // 验证 setup 交互状态：selectHall 与 handleJumpToTech
    const emit = vi.fn();
    const state = await loadModalTechSetup({ snapshot, initialHall: 'tech' }, emit);
    expect(state.activeHall.value).toBe('tech');
    state.selectHall('protocol');
    expect(state.activeHall.value).toBe('protocol');

    state.handleJumpToTech('质子撞击炮理论');
    expect(state.activeHall.value).toBe('tech');
    expect(state.lastJumpTarget.value).toBe('质子撞击炮理论');
    expect(emit).toHaveBeenCalledWith('jump-to-tech', '质子撞击炮理论');
  });
});

/* ═══════════════ 3. PanelProtocol 阵营院所子页皮肤与建筑驱动头衔晋升 ═══════════════ */

describe('PRT-UI-01 · PanelProtocol 阵营院所皮肤与 T1→T2→T3 动态晋升头衔', () => {
  it('苏联院所子页随在役建筑从 Stage 0 [T1] → Stage 1 [T2] → Stage 2 [T3] 动态晋升，且盟军节点不代升苏联 T3', async () => {
    const ProtocolComp = await loadProtocolComponent();

    // Stage 0：无实验室（即便盟军联合科研与国家工程组织节点在场，苏联也不得越权升 T2/T3）
    const snapStage0WithAlliedT3 = {
      bases: [
        {
          id: 'b1',
          name: '1号基地',
          status: '警戒',
          buildings: [
            { name: '37·盟军联合科研与国家工程组织节点', state: '运转' },
            { name: '13·盟军战斗实验室', state: '运转' },
            { name: '07·红星实验设计局综合体', state: '建造中' }, // 建造中不生效
            { name: '26·国家战略工程综合体／红星科学城', state: '停机' }, // 停机不生效
          ],
        },
      ],
    };

    const htmlStage0 = await renderToString(
      createSSRApp({
        render: () => h(ProtocolComp, { snapshot: snapStage0WithAlliedT3, initialInstitute: 'soviet' }),
      }),
    );
    expect(htmlStage0).toContain('data-institute-theme="soviet"');
    expect(htmlStage0).toContain('苏联前线参谋部 [T1]');
    expect(htmlStage0).toContain('data-institute-stage="0"');
    expect(htmlStage0).toContain('data-institute-tier="1"');

    // Stage 1：红星实验设计局综合体（或通用战斗实验室）在役 → 晋升 [T2]
    const snapStage1 = {
      bases: [
        {
          id: 'b1',
          name: '1号基地',
          status: '警戒',
          buildings: [{ name: '07·红星实验设计局综合体', state: '运转' }],
        },
      ],
    };
    const htmlStage1 = await renderToString(
      createSSRApp({
        render: () => h(ProtocolComp, { snapshot: snapStage1, initialInstitute: 'soviet' }),
      }),
    );
    expect(htmlStage1).toContain('红星实验设计局综合体 [T2]');
    expect(htmlStage1).toContain('data-institute-stage="1"');
    expect(htmlStage1).toContain('data-institute-tier="2"');

    // Stage 2：国家战略工程综合体 / 红星科学城在役 → 晋升 [T3]
    const snapStage2 = {
      bases: [
        {
          id: 'b1',
          name: '1号基地',
          status: '警戒',
          buildings: [
            { name: '07·红星实验设计局综合体', state: '运转' },
            { name: '26·国家战略工程综合体／红星科学城', state: '运转' },
          ],
        },
      ],
    };
    const htmlStage2 = await renderToString(
      createSSRApp({
        render: () => h(ProtocolComp, { snapshot: snapStage2, initialInstitute: 'soviet' }),
      }),
    );
    expect(htmlStage2).toContain('国家战略工程综合体 · 红星科学城 [T3]');
    expect(htmlStage2).toContain('data-institute-stage="2"');
    expect(htmlStage2).toContain('data-institute-tier="3"');
  });

  it('盟军院所子页切换与 Stage 0 [T1] → Stage 1 [T2] → Stage 2 [T3] 动态晋升（苏联节点不代升盟军）', async () => {
    const state = await loadProtocolSetup({
      snapshot: {
        bases: [
          {
            id: 'b1',
            name: '1号基地',
            status: '警戒',
            buildings: [{ name: '26·国家战略工程综合体／红星科学城', state: '运转' }],
          },
        ],
      },
      initialInstitute: 'soviet',
    });

    // 切换至盟军院所子页：虽有苏联红星科学城，盟军仍为 Stage 0 [T1]
    state.selectInstitute('allied');
    expect(state.activeInstitute.value).toBe('allied');
    expect(state.currentInstituteInfo.value.stage).toBe(0);
    expect(state.currentInstituteInfo.value.tier).toBe(1);
    expect(state.currentInstituteInfo.value.title).toContain('盟军战区联络处 [T1]');

    // 通用战斗实验室在场 → 同时兜底晋升苏/盟至 Stage 1 [T2]
    const stateCommonLab = await loadProtocolSetup({
      snapshot: {
        bases: [{ id: 'b1', name: '1号基地', buildings: [{ name: '07·战斗实验室', state: '运转' }] }],
      },
      initialInstitute: 'allied',
    });
    expect(stateCommonLab.currentInstituteInfo.value.stage).toBe(1);
    expect(stateCommonLab.currentInstituteInfo.value.title).toContain('盟军战斗实验室 [T2]');

    // 盟军联合科研与国家工程组织节点在场 → 盟军晋升 Stage 2 [T3]
    const stateAlliedT3 = await loadProtocolSetup({
      snapshot: {
        bases: [
          {
            id: 'b1',
            name: '1号基地',
            buildings: [{ name: '37·盟军联合科研与国家工程组织节点', state: '运转' }],
          },
        ],
      },
      initialInstitute: 'allied',
    });
    expect(stateAlliedT3.currentInstituteInfo.value.stage).toBe(2);
    expect(stateAlliedT3.currentInstituteInfo.value.tier).toBe(3);
    expect(stateAlliedT3.currentInstituteInfo.value.title).toContain('盟军联合科研与国家工程组织节点 [T3]');
  });

  it('苏/盟两套专属 CSS 视觉皮肤色值令牌齐全（苏维埃暗金赤红 vs 盟军全息电光蓝）', () => {
    const sfc = readFileSync(PROTOCOL_SFC_PATH, 'utf8');
    expect(sfc).toContain(".prt-panel-root[data-institute-theme='soviet']");
    expect(sfc).toContain(".prt-panel-root[data-institute-theme='allied']");
    expect(sfc).toMatch(/--prt-primary|--prt-accent|--rac-accent|hsl\(/);
  });
});

/* ═══════════════ 4. 右翼全局算力与通用底座并网栏（流速公式与在役徽标） ═══════════════ */

describe('PRT-UI-01 · 全局算力与通用底座并网栏及左栏轨道目录 n/N', () => {
  it('严格按 §3.5.1 公式计算协议点日产流速（基础 0.10 + 主轴 T2/T3 同系替代 + 跨系 50% + 超算/量子超算替代）', async () => {
    // 1. 仅战地基础流：0.10 点/日
    const s0 = await loadProtocolSetup({ snapshot: { bases: [], protocol_points: 1.5 } });
    expect(s0.dailyPointRate.value).toBe(0.1);
    expect(s0.formattedDailyRateText.value).toBe('+0.10 点/日');

    // 2. 红星实验设计局(T2 +0.15) + 超算中心(+0.10) = 0.10 + 0.15 + 0.10 = 0.35 点/日
    const sT2Super = await loadProtocolSetup({
      snapshot: {
        protocol_points: 2.4,
        bases: [
          {
            id: 'b1',
            name: '1号基地',
            buildings: [
              { name: '07·红星实验设计局综合体', state: '运转' },
              { name: '25·超算中心', state: '运转' },
            ],
          },
        ],
      },
    });
    expect(sT2Super.dailyPointRate.value).toBe(0.35);
    expect(sT2Super.formattedDailyRateText.value).toBe('+0.35 点/日');

    // 3. 同阵营 T3 替代 T2 + 量子超算替代普通超算：0.10 + 0.30 + 0.25 = 0.65 点/日
    const sT3Quantum = await loadProtocolSetup({
      snapshot: {
        bases: [
          {
            id: 'b1',
            name: '1号基地',
            buildings: [
              { name: '07·红星实验设计局综合体', state: '运转' },
              { name: '26·国家战略工程综合体／红星科学城', state: '运转' },
              { name: '25·超算中心', state: '运转' },
              { name: '26·量子超算中心', state: '运转' },
            ],
          },
        ],
      },
    });
    expect(sT3Quantum.dailyPointRate.value).toBe(0.65);
    expect(sT3Quantum.formattedDailyRateText.value).toBe('+0.65 点/日');

    // 4. 跨阵营并存（苏 T3 0.30 + 盟 T3 0.30*50%=0.15）+ 量子超算 0.25 + 基础 0.10 = 0.80 点/日
    const sCrossT3 = await loadProtocolSetup({
      snapshot: {
        bases: [
          {
            id: 'b1',
            name: '1号基地',
            buildings: [
              { name: '26·国家战略工程综合体／红星科学城', state: '运转' },
              { name: '37·盟军联合科研与国家工程组织节点', state: '运转' },
              { name: '07·战斗实验室', state: '运转' },
              { name: '26·量子超算中心', state: '运转' },
            ],
          },
        ],
      },
    });
    expect(sCrossT3.dailyPointRate.value).toBe(0.8);
    expect(sCrossT3.gridStatus.value.crossFactionSynergy).toBe(true);
    expect(sCrossT3.gridStatus.value.commonBattleLab).toBe(true);
    expect(sCrossT3.gridStatus.value.quantumSupercomputer).toBe(true);

    // 5. 跨阵营并存（苏 T3 0.30 + 盟 T2 0.15*50%=0.075）+ 基础 0.10 = 0.475 点/日
    const sCrossT2 = await loadProtocolSetup({
      snapshot: {
        bases: [
          {
            id: 'b1',
            name: '1号基地',
            buildings: [
              { name: '26·国家战略工程综合体／红星科学城', state: '运转' },
              { name: '13·盟军战斗实验室', state: '运转' },
            ],
          },
        ],
      },
    });
    expect(sCrossT2.dailyPointRate.value).toBe(0.475);
    expect(sCrossT2.preciseDailyRateText.value).toBe('+0.475 点/日');
  });

  it('常驻渲染 07·战斗实验室、25·超算中心、26·量子超算中心与跨系协同并网徽标，以及左栏轨道目录 n/N 切换', async () => {
    const ProtocolComp = await loadProtocolComponent();
    const snapshot = {
      protocol_points: 4,
      bases: [
        {
          id: 'b1',
          name: '1号基地',
          buildings: [
            { name: '07·战斗实验室', state: '运转' },
            { name: '25·超算中心', state: '运转' },
          ],
        },
      ],
      protocols: [
        { ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker', status: 'active', exp: 100 },
        { ref: 'sov.protocol.ra3.sputnik_one_way_deployment', status: 'active', exp: 100 },
        { ref: 'sov.research.t2.iron_curtain_emergency_overload', status: 'experimenting', exp: 35, attempts: 1 },
        { ref: 'all.research.t1.european_defense_agreement', status: 'active', exp: 100 },
      ],
    };

    const html = await renderToString(
      createSSRApp({
        render: () => h(ProtocolComp, { snapshot, initialInstitute: 'soviet' }),
      }),
    );

    // 右翼并网栏与常驻徽标
    expect(html).toContain('data-protocol-global-grid');
    expect(html).toContain('战斗实验室');
    expect(html).toContain('超算中心 (+0.10/日)');
    expect(html).toContain('量子超算中心 (+0.25/日)');
    expect(html).toContain('data-grid-badge="battle_lab" data-in-service="true"');
    expect(html).toContain('data-grid-badge="supercomputer" data-in-service="true"');
    expect(html).toContain('data-grid-badge="quantum_supercomputer" data-in-service="false"');

    // 左栏苏联三大专属轨道与 n/N 进度（第一轨 1/3 已 active，通用协议已抽离至第 4 页签 common）
    expect(html).toContain('data-institute-tab="common"');
    expect(html).toContain('◆ 通用联合条令总署 · COMMON');
    expect(html).toContain('data-protocol-track-list');
    expect(html).toContain('钢铁基干与国家动员');
    expect(html).toContain('过载工程与战区拒止');
    expect(html).toContain('国家战略工程与工业外延');
    expect(html).toContain('data-track-name="钢铁基干与国家动员" data-track-active="true" data-track-progress="1/3"');

    // 三栏骨架槽位齐全
    expect(html).toContain('data-protocol-main-stage');
    expect(html).toContain('data-protocol-detail-slot');

    // 验证轨道切换、盟军三大专属轨道（首轨 1/4）与通用联合条令总署两大轨道（首轨 1/4）
    const state = await loadProtocolSetup({ snapshot, initialInstitute: 'soviet' });
    state.selectTrack('过载工程与战区拒止');
    expect(state.activeTrackName.value).toBe('过载工程与战区拒止');
    expect(state.activeTrack.value.nodes.some((n: any) => n.name === '铁幕紧急过载协议' && n.exp === 35)).toBe(true);

    state.selectInstitute('allied');
    expect(state.currentTracks.value).toHaveLength(3);
    expect(state.currentTracks.value.map((t: any) => t.name)).toEqual([
      '跨国联合防务条约',
      '相干光棱与全谱拟态遮蔽',
      '超时空跃迁与天基气象打击',
    ]);
    expect(state.currentTracks.value[0].activeCount).toBe(1);
    expect(state.currentTracks.value[0].totalCount).toBe(4);

    state.selectInstitute('common');
    expect(state.currentTracks.value).toHaveLength(2);
    expect(state.currentTracks.value.map((t: any) => t.name)).toEqual([
      '通用前沿工程与战时动员',
      '通用战略授权与核常管控',
    ]);
    expect(state.currentTracks.value[0].activeCount).toBe(1);
    expect(state.currentTracks.value[0].totalCount).toBe(4);
    expect(state.currentTracks.value[1].totalCount).toBe(3);
  });
});

/* ═══════════════ 5. 零 MVU 直写与零自动发送静态审查 ═══════════════ */

describe('PRT-UI-01 · 中控台只读红线静态审查', () => {
  it('PanelProtocol.vue / ModalTechTree.vue / ConsoleQuickActions.vue 零 MVU 写接口与零自动发送', () => {
    const bannedWrite =
      /replaceVariables|insertVariables|updateVariablesWith|insertOrAssignVariables|deleteVariable|createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook/;
    const bannedSend = /#send_but|sendMessage|triggerSlash\s*\(\s*['"`]\/send|\bGenerate\s*\(/;

    for (const [label, path] of [
      ['PanelProtocol.vue', PROTOCOL_SFC_PATH],
      ['ModalTechTree.vue', MODAL_TECH_SFC_PATH],
      ['ConsoleQuickActions.vue', QUICK_ACTIONS_SFC_PATH],
    ] as const) {
      const src = readFileSync(path, 'utf8');
      expect(src, `${label} 严禁调用 MVU / 世界书写入接口`).not.toMatch(bannedWrite);
      expect(src, `${label} 严禁包含自动发送调用`).not.toMatch(bannedSend);
    }
  });
});

/* PRT-UI-02: render actual compiled SFC event bindings in a deterministic Vue host. */
interface TestNode {
  type: string;
  props: Record<string, any>;
  children: TestNode[];
  parent?: TestNode;
  text?: string;
}
function mountInTestHost(component: Component, props: Record<string, unknown>) {
  const node = (type: string, text?: string): TestNode => ({ type, text, props: {}, children: [] });
  const renderer = createRenderer<TestNode, TestNode>({
    createElement: tag => node(tag),
    createText: text => node('#text', text),
    createComment: text => node('#comment', text),
    setText: (el, text) => {
      el.text = text;
    },
    setElementText: (el, text) => {
      el.text = text;
      el.children = [];
    },
    parentNode: el => el.parent ?? null,
    nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
    patchProp: (el, key, _prev, value) => {
      el.props[key] = value;
    },
    insert: (el, parent, anchor) => {
      if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
      el.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(index < 0 ? parent.children.length : index, 0, el);
    },
    remove: el => {
      if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
    },
  });
  const root = node('root');
  const app = renderer.createApp(component, props);
  app.mount(root);
  const all = (): TestNode[] => {
    const walk = (el: TestNode): TestNode[] => [el, ...el.children.flatMap(walk)];
    return walk(root);
  };
  return { root, all, app };
}
const track = '钢铁基干与国家动员';
const definition = (id: string, tier = 1, extras = {}) => ({
  id,
  name: id + '条令',
  faction: '苏联',
  track,
  tier,
  desc: '完整条令效果说明',
  ...extras,
});

describe('PRT-UI-02 · 五态链图与协议实验卷宗', () => {
  it('五态节点、机密启封提示、锁定缺口与上游颁布连线均渲染，点击实际卡片调阅完整卷宗', async () => {
    const statuses = ['active', 'undiscovered', 'locked', 'available', 'experimenting'];
    catalogFixture.protocols = statuses.map((status, i) =>
      definition('node' + i, i === 2 ? 3 : 2, { discovery: { kind: 'experiment' }, reveals: ['tech.id'] }),
    );
    catalogFixture.researches = [{ id: 'tech.id', name: '被揭示理论' }];
    catalogFixture.productions = [{ name: '特色装甲', prereqs: ['node4条令'] }];
    catalogFixture.buildings = [{ name: '特色建筑', research: 'node4' }];
    catalogFixture.retrofits = [
      {
        name: '改装工程',
        requirements: { op: 'all', conditions: [{ kind: 'research', name: 'node4条令', scope: 'global' }] },
      },
    ];
    const snapshot = {
      bases: [],
      protocols: statuses.map((status, i) => ({
        ref: 'node' + i,
        status,
        attempts: i === 4 ? 1 : 0,
        exp: i === 4 ? 35 : 0,
        points_spent: i === 4 ? 1 : 0,
        credits_spent: i === 4 ? 1500 : 0,
      })),
    };
    const comp = await loadProtocolComponent();
    const html = await renderToString(createSSRApp({ render: () => h(comp, { snapshot }) }));
    for (const status of statuses) expect(html).toContain('data-protocol-status="' + status + '"');
    expect(html).toContain('data-protocol-chain');
    expect(html.match(/data-protocol-connector/g)).toHaveLength(4);
    expect(html.match(/prt-connector is-energized/g)).toHaveLength(1);
    expect(html).toContain('建成对应实验室后自动解锁');
    expect(html).toContain('需 T3 红星科学城');
    expect(html).toContain('已颁布生效');
    const host = mountInTestHost(comp, { snapshot });
    host
      .all()
      .find(el => el.props['data-protocol-node'] === 'node4')!
      .props.onClick();
    await nextTick();
    const renderedText = host
      .all()
      .map(el => el.text ?? '')
      .join(' ');
    for (const text of [
      'node4条令',
      '完整条令效果说明',
      '累计已投 1 点 / 1500 资金',
      '最多 4 轮硬保底必成',
      '特色装甲',
      '特色建筑',
      '改装工程',
      '被揭示理论',
    ])
      expect(renderedText).toContain(text);
    expect(host.all().filter(el => 'data-protocol-lab-sealed' in el.props)).toHaveLength(2);
    expect(renderedText).toContain('已攒经验 35% 封存保留');
    for (const attr of [
      'data-protocol-unlocks',
      'data-protocol-reveals',
      'data-protocol-actions',
      'data-protocol-detail-slot',
    ])
      expect(host.all().some(el => attr in el.props)).toBe(true);
    expect(snapshot.protocols[4]).toMatchObject({ exp: 35, attempts: 1, points_spent: 1, credits_spent: 1500 });
    host.app.unmount();
  });

  it.each([
    [1, 0, 0, 55],
    [1, 1, 50, 85],
    [1, 2, 90, 100],
    [2, 0, 0, 35],
    [2, 1, 35, 65],
    [2, 2, 70, 90],
    [2, 3, 95, 100],
    [3, 0, 0, 15],
    [3, 1, 25, 35],
    [3, 2, 50, 65],
    [3, 3, 75, 90],
    [3, 4, 95, 100],
  ])('T%i 已试 %i 轮经验 %i%% → 下轮 %i%%，进度条与同源表一致', async (tier, attempts, exp, prob) => {
    catalogFixture.protocols = [definition('experiment', tier)];
    const snapshot = {
      protocols: [{ ref: 'experiment', status: attempts ? 'experimenting' : 'available', attempts, exp }],
      bases: [],
    };
    const comp = await loadProtocolComponent();
    const html = await renderToString(createSSRApp({ render: () => h(comp, { snapshot }) }));
    expect(html).toContain('data-protocol-next-prob="' + prob + '"');
    expect(html).toContain('data-exp-value="' + exp + '" style="width:' + exp + '%;"');
  });
  let awaitedComp: Component;
  // Loaded once through the same SFC compiler as the actual card tests.
  it('初始化概率渲染候选与终态 100% 不受实验室离线影响', async () => {
    awaitedComp = await loadProtocolComponent();
    catalogFixture.protocols = [definition('active', 3)];
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(awaitedComp, { snapshot: { protocols: [{ ref: 'active', status: 'active', exp: 25 }], bases: [] } }),
      }),
    );
    expect(html).toContain('data-exp-value="100"');
    expect(html).toContain('data-protocol-next-prob="100"');
    expect(html).not.toContain('data-protocol-lab-sealed');
  });

  it('reveals 实际点击 → 对象事件 → ModalTechTree 切回科研厅并传入高亮目标，目录 reveals 去重计算徽标', async () => {
    catalogFixture.protocols = [definition('protocol', 1, { reveals: ['tech.id', 'tech.id'] })];
    catalogFixture.researches = [{ id: 'tech.id', name: '被揭示理论' }];
    const snapshot = {
      ...Schema.parse({ command: { unlocked_factions: ['allied', 'soviet'] } }),
      protocols: [{ ref: 'protocol', status: 'active', exp: 100 }],
    };
    const modal = await loadModalTechComponent();
    const host = mountInTestHost(modal, { open: true, snapshot, initialHall: 'protocol' });
    for (let i = 0; i < 10 && !host.all().some(el => el.props['data-reveal-tech-link']); i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      await nextTick();
    }
    expect(host.all().find(el => 'data-newly-revealed-badge' in el.props)?.props['data-revealed-count']).toBe(1);
    const link = host.all().find(el => el.props['data-reveal-tech-link'] === 'tech.id');
    expect(link).toBeDefined();
    link!.props.onClick();
    await nextTick();
    expect(host.all().find(el => 'data-active-hall' in el.props)?.props['data-active-hall']).toBe('tech');
    expect(host.all().some(el => el.props['data-highlighted-tech'] === 'tech.id')).toBe(true);
    expect(host.all().find(el => el.props.class === 'panel-tech-stub')?.props['highlighted-tech-target']).toEqual({
      techId: 'tech.id',
      techName: '被揭示理论',
    });
    host.app.unmount();
    const emit = vi.fn();
    const protocol = await loadProtocolSetup({ snapshot }, emit);
    protocol.jumpToTech('tech.id');
    expect(emit).toHaveBeenCalledWith('jump-to-tech', { techId: 'tech.id', techName: '被揭示理论' });
  });

  it('真实 Pinia effectiveCatalog 第四集合与 dynamicCatalog ID 换算不依赖测试专用 protocols 顶层字段', async () => {
    catalogFixture.effectiveCatalog = { protocols: [definition('real', 2, { reveals: ['raw.tech.id'] })] };
    catalogFixture.dynamicCatalog = { researches: [{ id: 'raw.tech.id', name: '实际原始科技' }] };
    catalogFixture.researches = [{ name: '实际原始科技' }];
    const snapshot = {
      ...Schema.parse({ command: { unlocked_factions: ['allied', 'soviet'] } }),
      protocols: [{ ref: 'real', status: 'active' }],
    };
    const state = await loadProtocolSetup({ snapshot });
    expect(state.activeTrack.value.nodes).toHaveLength(1);
    expect(state.revealTarget('raw.tech.id')).toEqual({ techId: 'raw.tech.id', techName: '实际原始科技' });
    const modal = await loadModalTechSetup({ snapshot });
    expect(modal.effectiveNewlyRevealedCount.value).toBe(1);
    const completed = await loadModalTechSetup({ snapshot: { ...snapshot, tech: { done: ['实际原始科技'] } } });
    expect(completed.effectiveNewlyRevealedCount.value).toBe(0);
  });

  it('缺省 discovery 不伪造启封，奇遇提示、坏数值钳制、终态及动作均只读；提供减弱动效与真实科研定位绑定', async () => {
    catalogFixture.protocols = [definition('event', 2, { discovery: { kind: 'event' } })];
    const comp = await loadProtocolComponent();
    const html = await renderToString(createSSRApp({ render: () => h(comp, { snapshot: { protocols: [] } }) }));
    expect(html).toContain('通过战地特殊事件解锁');
    expect(html).toContain('data-protocol-status="undiscovered"');
    const state = await loadProtocolSetup({
      snapshot: { protocols: [{ ref: 'event', status: 'experimenting', exp: NaN, attempts: Infinity }] },
    });
    expect(state.activeTrack.value.nodes[0]).toMatchObject({ exp: 0, attempts: 0, nextProb: 35 });
    for (const path of [
      PROTOCOL_SFC_PATH,
      MODAL_TECH_SFC_PATH,
      fileURLToPath(new URL('../../红警指挥系统/ui/panels/PanelTech.vue', import.meta.url)),
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain('@media (prefers-reduced-motion: reduce)');
      expect(source).not.toMatch(
        /replaceVariables|insertVariables|updateVariablesWith|insertOrAssignVariables|deleteVariable/,
      );
    }
    const tech = readFileSync(
      fileURLToPath(new URL('../../红警指挥系统/ui/panels/PanelTech.vue', import.meta.url)),
      'utf8',
    );
    for (const marker of ['data-highlighted-tech', 'scrollIntoView', 'isHighlighted', "filterStatus.value = 'all'"])
      expect(tech).toContain(marker);
  });
});

/* ═══════════════ 6. PRT-UI-03 · 同源确定性预判指令拼装、四重守卫、自动实验排程与徽标联动 ═══════════════ */

describe('PRT-UI-03 · 实验指令同源预判拼装、自动实验排程开关与徽标联动', () => {
  it('同源确定性种子预判指令拼装：严格对齐 deterministicRoll / predictExperimentOutcome（阶段经验积累 vs 临界突破定型）', async () => {
    const {
      buildProtocolExperimentCommand,
      deterministicRoll,
      predictExperimentOutcome,
      stageProtocolCommandToTextarea,
    } = await import('../models/protocolCommands');

    const defT2 = {
      id: 'sov.research.t2.iron_curtain_emergency_overload',
      name: '铁幕紧急过载协议',
      faction: '苏联',
      track: '过载工程与战区拒止',
      tier: 2 as const,
      cost_points: 1,
      experiment_cost_credits: 1500,
    };

    // 搜索分别触发 accumulated 与 breakthrough 的确定性 gameDay（第 1 轮 T2 突破阈值 0.35）
    let accumulatedDay = -1;
    let breakthroughDay = -1;
    for (let day = 1; day <= 120; day++) {
      const roll = deterministicRoll(defT2.id, 1, day);
      if (roll >= 0.35 && accumulatedDay < 0) accumulatedDay = day;
      if (roll < 0.35 && breakthroughDay < 0) breakthroughDay = day;
      if (accumulatedDay >= 0 && breakthroughDay >= 0) break;
    }
    expect(accumulatedDay).toBeGreaterThan(0);
    expect(breakthroughDay).toBeGreaterThan(0);

    // 1. 阶段经验积累模板验证
    const accPred = predictExperimentOutcome(defT2, { status: 'available', attempts: 0, exp: 0 }, accumulatedDay);
    expect(accPred.outcome).toBe('accumulated');
    expect(accPred.expAfter).toBe(35);
    const accCmd = buildProtocolExperimentCommand(defT2, { status: 'available', attempts: 0, exp: 0 }, accumulatedDay);
    expect(accCmd.outcome).toBe('accumulated');
    expect(accCmd.nextAttempt).toBe(1);
    expect(accCmd.nextExp).toBe(35);
    expect(accCmd.commandText).toBe(
      '【最高统帅部·协议科研指令】授权调用在役科研院所算力，就《铁幕紧急过载协议》开展第 1 轮专项攻关实验（消耗 1 点协议点与 1500 资金；当前定型经验预计推进至 35%，请叙事呈现实验进展、技术难点与阶段性数据积累，并在 <事件> 中输出 协议实验 声明）。',
    );

    // 2. 临界突破定型模板验证（首轮命中突破）
    const brkPred = predictExperimentOutcome(defT2, { status: 'available', attempts: 0, exp: 0 }, breakthroughDay);
    expect(brkPred.outcome).toBe('breakthrough');
    expect(brkPred.expAfter).toBe(100);
    const brkCmd = buildProtocolExperimentCommand(defT2, { status: 'available', attempts: 0, exp: 0 }, breakthroughDay);
    expect(brkCmd.outcome).toBe('breakthrough');
    expect(brkCmd.nextAttempt).toBe(1);
    expect(brkCmd.nextExp).toBe(100);
    expect(brkCmd.commandText).toBe(
      '【最高统帅部·协议科研指令】授权调用在役科研院所算力，就《铁幕紧急过载协议》开展第 1 轮终试定型攻关（消耗 1 点协议点与 1500 资金；定型经验已达临界突破条件 100%，请叙事呈现协议正式突破定型与条令颁布，并在 <事件> 中输出 协议实验 声明）。',
    );

    // 3. 保底轮次（T2 第 4 轮）无论 gameDay 均必然触发 breakthrough
    const pityCmd = buildProtocolExperimentCommand(
      defT2,
      { status: 'experimenting', attempts: 3, exp: 95 },
      accumulatedDay,
    );
    expect(pityCmd.outcome).toBe('breakthrough');
    expect(pityCmd.guaranteed).toBe(true);
    expect(pityCmd.nextAttempt).toBe(4);
    expect(pityCmd.commandText).toContain('开展第 4 轮终试定型攻关');

    // 4. 宿主 #send_textarea 多行追加、幂等去重与 input/change 事件派发（零自动发送）
    const events: string[] = [];
    let focused = false;
    const fakeTextarea = {
      value: '【工程指令】既有指令',
      ownerDocument: { defaultView: { Event } },
      dispatchEvent: (ev: Event) => {
        events.push(ev.type);
        return true;
      },
      focus: () => {
        focused = true;
      },
    } as unknown as HTMLTextAreaElement;
    const fakeDoc = {
      querySelector: (sel: string) => (sel === '#send_textarea' ? fakeTextarea : null),
    } as unknown as Document;

    const staged1 = stageProtocolCommandToTextarea(accCmd.commandText, { doc: fakeDoc });
    expect(staged1.staged).toBe(true);
    expect(staged1.channel).toBe('textarea');
    expect(fakeTextarea.value).toBe(`【工程指令】既有指令\n${accCmd.commandText}`);
    expect(events).toEqual(['input', 'change']);
    expect(focused).toBe(true);

    // 重复填入同一条指令时保持幂等不重复追加
    const stagedDup = stageProtocolCommandToTextarea(accCmd.commandText, { doc: fakeDoc });
    expect(stagedDup.value).toBe(`【工程指令】既有指令\n${accCmd.commandText}`);
  });

  it('点击【🧪 开展第 k 轮实验】触发 command-staged 事件、展示视觉回执并支持四重守卫禁用态与原因提示', async () => {
    const { deterministicRoll } = await import('../models/protocolCommands');
    const comp = await loadProtocolComponent();

    const targetId = 'sov.research.t2.iron_curtain_emergency_overload';
    let accDay = 1;
    for (let d = 1; d <= 100; d++) {
      if (deterministicRoll(targetId, 2, d) >= 0.65) {
        accDay = d;
        break;
      }
    }

    // 场景 A：四重守卫全满足（experimenting + 红星实验设计局在线 + 点数 2 >= 1 + 资金 5000 >= 1500）
    const readySnapshot = {
      meta: { day_count: accDay },
      protocol_points: 2,
      economy: { credits: 5000 },
      bases: [
        {
          id: 'b1',
          name: '主基地',
          status: '正常',
          buildings: [{ name: '红星实验设计局', state: '运转' }],
        },
      ],
      protocols: [
        {
          ref: 'sov.protocol.ra3.terror_drone_dual_mode',
          status: 'available',
          attempts: 0,
          exp: 0,
        },
        {
          ref: targetId,
          status: 'experimenting',
          attempts: 1,
          exp: 35,
          points_spent: 1,
          credits_spent: 1500,
        },
      ],
    };

    const emit = vi.fn();
    const state = await loadProtocolSetup({ snapshot: readySnapshot, initialTrack: '过载工程与战区拒止' }, emit);
    state.selectNode(targetId);
    expect(state.canExperimentSelected.value).toBe(true);
    expect(state.experimentGuardReason.value).toBe('');

    const payload = state.handleExperimentClick();
    expect(payload).not.toBeNull();
    expect(payload).toMatchObject({
      protocolId: targetId,
      outcome: 'accumulated',
      nextAttempt: 2,
      nextExp: 70,
    });
    expect(emit).toHaveBeenCalledWith(
      'command-staged',
      expect.objectContaining({
        protocolId: targetId,
        outcome: 'accumulated',
        nextAttempt: 2,
        nextExp: 70,
      }),
    );
    expect(state.stagedReceipt.value?.title).toContain('第 2 轮阶段经验积累 → 70%');

    // SSR 渲染检查：实验按钮可点且无禁用原因，点击后渲染 data-protocol-staged-receipt
    const host = mountInTestHost(comp, { snapshot: readySnapshot, initialTrack: '过载工程与战区拒止' });
    host
      .all()
      .find(el => el.props['data-protocol-id'] === targetId)!
      .props.onClick();
    await nextTick();
    const expBtn = host.all().find(el => 'data-protocol-experiment-btn' in el.props);
    expect(expBtn).toBeDefined();
    expect(expBtn!.props.disabled).toBe(false);
    expect(expBtn!.props['data-next-attempt']).toBe(2);
    expBtn!.props.onClick();
    await nextTick();
    const receiptEl = host.all().find(el => 'data-protocol-staged-receipt' in el.props);
    expect(receiptEl).toBeDefined();
    expect(receiptEl!.props['data-staged-outcome']).toBe('accumulated');
    host.app.unmount();

    // 场景 B：四重守卫禁用判定（1. 实验室离线 / 2. 协议点不足 / 3. 资金不足 / 4. locked / 5. active / 6. undiscovered）
    const offlineState = await loadProtocolSetup({
      snapshot: { ...readySnapshot, bases: [] },
      initialTrack: '过载工程与战区拒止',
    });
    offlineState.selectNode(targetId);
    expect(offlineState.canExperimentSelected.value).toBe(false);
    expect(offlineState.selectedExperimentGuard.value.reasonCode).toBe('lab_offline');
    expect(offlineState.experimentGuardReason.value).toContain('对口实验室离线');
    expect(offlineState.handleExperimentClick()).toBeNull();

    const noPointsState = await loadProtocolSetup({
      snapshot: { ...readySnapshot, protocol_points: 0.5 },
      initialTrack: '过载工程与战区拒止',
    });
    noPointsState.selectNode(targetId);
    expect(noPointsState.canExperimentSelected.value).toBe(false);
    expect(noPointsState.selectedExperimentGuard.value.reasonCode).toBe('insufficient_points');
    expect(noPointsState.experimentGuardReason.value).toContain('协议点不足');

    const noCreditsState = await loadProtocolSetup({
      snapshot: { ...readySnapshot, economy: { credits: 800 } },
      initialTrack: '过载工程与战区拒止',
    });
    noCreditsState.selectNode(targetId);
    expect(noCreditsState.canExperimentSelected.value).toBe(false);
    expect(noCreditsState.selectedExperimentGuard.value.reasonCode).toBe('insufficient_credits');
    expect(noCreditsState.experimentGuardReason.value).toContain('实验资金不足');

    const lockedState = await loadProtocolSetup({
      snapshot: {
        ...readySnapshot,
        protocols: [{ ref: targetId, status: 'locked' }],
      },
      initialTrack: '过载工程与战区拒止',
    });
    lockedState.selectNode(targetId);
    expect(lockedState.canExperimentSelected.value).toBe(false);
    expect(lockedState.selectedExperimentGuard.value.reasonCode).toBe('locked');
    expect(lockedState.experimentGuardReason.value).toContain('协议准入未齐');

    const activeProtState = await loadProtocolSetup({
      snapshot: {
        ...readySnapshot,
        protocols: [{ ref: targetId, status: 'active', exp: 100 }],
      },
      initialTrack: '过载工程与战区拒止',
    });
    activeProtState.selectNode(targetId);
    expect(activeProtState.canExperimentSelected.value).toBe(false);
    expect(activeProtState.selectedExperimentGuard.value.reasonCode).toBe('already_active');
    expect(activeProtState.experimentGuardReason.value).toContain('已突破定型并正式颁布生效');

    // SSR 渲染禁用原因标签 [data-protocol-guard-reason]
    const guardHtml = await renderToString(
      createSSRApp({
        render: () =>
          h(comp, {
            snapshot: { ...readySnapshot, protocol_points: 0 },
            initialTrack: '过载工程与战区拒止',
          }),
      }),
    );
    expect(guardHtml).toContain('data-protocol-guard-reason');
    expect(guardHtml).toContain('data-guard-code="insufficient_points"');
    expect(guardHtml).toContain('协议点不足');
  });

  it('【🔄 自动安排实验】开关与候列优先级上移/下移/置顶/暂缓调序交互（只读不改写 snapshot）', async () => {
    const comp = await loadProtocolComponent();
    const p1 = 'sov.protocol.ra3.combat_engineer_prefab_bunker';
    const p2 = 'sov.protocol.ra3.sputnik_one_way_deployment';
    const p3 = 'sov.protocol.ra3.crusher_crane_salvage';

    const snapshot = {
      protocol_points: 3,
      economy: { credits: 6000 },
      bases: [],
      protocols: [
        { ref: p1, status: 'available', auto_queued: true, queue_order: 1 },
        { ref: p2, status: 'experimenting', exp: 50, attempts: 1, auto_queued: true, queue_order: 2 },
        { ref: p3, status: 'locked', auto_queued: false },
      ],
    };

    const emit = vi.fn();
    const state = await loadProtocolSetup({ snapshot }, emit);

    // 初始候列含 p1 (#1) 与 p2 (#2)
    expect(state.autoQueueList.value.map((q: any) => q.id)).toEqual([p1, p2]);

    // 1. 选中 locked 状态的 p3 并开启自动排程 → 入列 #3
    state.selectNode(p3);
    expect(state.canToggleAutoQueue(state.selectedNode.value)).toBe(true);
    const enableRes = state.toggleAutoQueue(p3);
    expect(enableRes?.action).toBe('enable');
    expect(enableRes?.queueOrder).toBe(3);
    expect(state.autoQueueList.value.map((q: any) => q.id)).toEqual([p1, p2, p3]);
    expect(emit).toHaveBeenLastCalledWith(
      'schedule-dispatch',
      expect.objectContaining({
        action: 'enable',
        protocolId: p3,
        autoQueued: true,
        queueOrder: 3,
      }),
    );

    // 2. 将 p3 上移一位 (#3 -> #2)
    const upRes = state.moveAutoQueueItem(p3, 'up');
    expect(upRes?.action).toBe('move_up');
    expect(upRes?.queueOrder).toBe(2);
    expect(state.autoQueueList.value.map((q: any) => q.id)).toEqual([p1, p3, p2]);

    // 3. 将 p2 置顶 (#3 -> #1)
    const topRes = state.moveAutoQueueItem(p2, 'top');
    expect(topRes?.action).toBe('move_top');
    expect(topRes?.queueOrder).toBe(1);
    expect(state.autoQueueList.value.map((q: any) => q.id)).toEqual([p2, p1, p3]);

    // 4. 将 p2 下移一位 (#1 -> #2)
    const downRes = state.moveAutoQueueItem(p2, 'down');
    expect(downRes?.action).toBe('move_down');
    expect(downRes?.queueOrder).toBe(2);
    expect(state.autoQueueList.value.map((q: any) => q.id)).toEqual([p1, p2, p3]);

    // 5. 暂缓 (hold) 与恢复 (resume) p2
    const holdRes = state.toggleAutoQueueHold(p2);
    expect(holdRes?.action).toBe('hold');
    expect(holdRes?.hold).toBe(true);
    expect(state.autoQueueList.value.find((q: any) => q.id === p2)?.hold).toBe(true);

    const resumeRes = state.toggleAutoQueueHold(p2);
    expect(resumeRes?.action).toBe('resume');
    expect(resumeRes?.hold).toBe(false);

    // 6. 取消 p1 的自动排程 → 剩余 [p2, p3] 自动重编为 #1, #2
    const disableRes = state.toggleAutoQueue(p1);
    expect(disableRes?.action).toBe('disable');
    expect(disableRes?.autoQueued).toBe(false);
    expect(state.autoQueueList.value.map((q: any) => [q.id, q.queueOrder])).toEqual([
      [p2, 1],
      [p3, 2],
    ]);

    // 7. 原始传入的 snapshot.protocols 未被直接篡改（严守只读原则）
    expect(snapshot.protocols[0].auto_queued).toBe(true);
    expect(snapshot.protocols[2].auto_queued).toBe(false);

    // 8. SSR 渲染节点自动排程徽标与候列 DOM 结构
    const html = await renderToString(createSSRApp({ render: () => h(comp, { snapshot }) }));
    expect(html).toContain('data-protocol-auto-toggle');
    expect(html).toContain('data-protocol-auto-queue');
    expect(html).toContain('data-protocol-node-auto-badge');
    expect(html).toContain('data-protocol-topbar-auto-badge');
    expect(html).toContain('data-protocol-queue-up');
    expect(html).toContain('data-protocol-queue-down');
  });

  it('顶栏点数、经验条、双主厅徽标与 ConsoleQuickActions 徽标实时响应式联动（含四重守卫过滤）', async () => {
    const { ref: vueRef } = await import('vue');
    const ProtocolComp = await loadProtocolComponent();
    const ModalTech = await loadModalTechComponent();
    const QuickActions = await loadQuickActionsComponent();

    const p1 = 'sov.protocol.ra3.combat_engineer_prefab_bunker'; // Tier 1 (500 资金)
    const p2 = 'sov.research.t2.iron_curtain_emergency_overload'; // Tier 2 (1500 资金，需红星实验设计局)

    const reactiveSnapshot = vueRef<any>({
      ...Schema.parse({}),
      protocol_points: 2.5,
      economy: { credits: 5000, credits_daily: 500, wallet: {} },
      bases: [
        {
          id: 'b1',
          name: '主基地',
          status: '正常',
          buildings: [{ name: '发电厂', state: '运转' }], // 尚未建 T2 实验室
        },
      ],
      tech: { done: [] },
      protocols: [
        { ref: p1, status: 'available', exp: 0, attempts: 0, auto_queued: true, queue_order: 1 },
        { ref: p2, status: 'experimenting', exp: 35, attempts: 1, auto_queued: false },
      ],
    });

    const prtHost = mountInTestHost(ProtocolComp, { snapshot: reactiveSnapshot.value });
    const modalHost = mountInTestHost(ModalTech, { open: true, snapshot: reactiveSnapshot.value });
    const qaHost = mountInTestHost(QuickActions, { snapshot: reactiveSnapshot.value, activeModal: null });

    // 初始态：p1(T1) 可实验，p2(T2) 因缺少红星实验设计局不可立即实验 → 可实验数 = 1，自动排程数 = 1
    expect(qaHost.all().find(el => 'data-protocol-ready-count' in el.props)?.props['data-count']).toBe(1);
    const prtTab0 = modalHost.all().find(el => el.props['data-hall-tab'] === 'protocol');
    expect(prtTab0?.props['data-protocol-ready']).toBe(1);
    expect(prtTab0?.props['data-protocol-auto-queued']).toBe(1);
    expect(prtHost.all().find(el => 'data-protocol-points' in el.props)?.props['data-points']).toBe(2.5);

    // 响应式跃迁：建成红星实验设计局 + p1 突破 active（揭示新科技）+ p2 推进至 exp=70, attempts=2 且加入自动排程 + 点数更新为 4.25
    reactiveSnapshot.value = {
      ...reactiveSnapshot.value,
      protocol_points: 4.25,
      bases: [
        {
          id: 'b1',
          name: '主基地',
          status: '正常',
          buildings: [{ name: '红星实验设计局', state: '运转' }],
        },
      ],
      protocols: [
        {
          ref: p1,
          status: 'active',
          exp: 100,
          attempts: 1,
          auto_queued: false,
          reveals: ['sov.research.t2.urban_combat_doctrine'],
        },
        {
          ref: p2,
          status: 'experimenting',
          exp: 70,
          attempts: 2,
          auto_queued: true,
          queue_order: 1,
        },
      ],
    };

    // 重新挂载或通过响应式 setup 验证实时联动
    prtHost.app.unmount();
    modalHost.app.unmount();
    qaHost.app.unmount();

    const prtHost2 = mountInTestHost(ProtocolComp, {
      snapshot: reactiveSnapshot.value,
      initialTrack: '过载工程与战区拒止',
    });
    const modalHost2 = mountInTestHost(ModalTech, { open: true, snapshot: reactiveSnapshot.value });
    const qaHost2 = mountInTestHost(QuickActions, { snapshot: reactiveSnapshot.value, activeModal: null });

    // 1. PanelProtocol 顶栏点数 4.25、p2 进度条 70%、下次突破率 P(3)=90%、自动排程徽标 #1
    expect(prtHost2.all().find(el => 'data-protocol-points' in el.props)?.props['data-points']).toBe(4.25);
    const p2Card = prtHost2.all().find(el => el.props['data-protocol-id'] === p2);
    expect(p2Card?.props['data-protocol-exp']).toBe(70);
    expect(p2Card?.props['data-protocol-auto-queued']).toBe('true');
    expect(prtHost2.all().some(el => el.props['data-protocol-next-prob'] === 90)).toBe(true);

    // 2. ModalTechTree 左厅 [✨ 新揭示 +1] 徽标与右厅可实验 1 / 自动排程 1 徽标
    expect(modalHost2.all().find(el => 'data-newly-revealed-badge' in el.props)?.props['data-revealed-count']).toBe(1);
    const prtTab2 = modalHost2.all().find(el => el.props['data-hall-tab'] === 'protocol');
    expect(prtTab2?.props['data-protocol-ready']).toBe(1);
    expect(prtTab2?.props['data-protocol-auto-queued']).toBe(1);
    expect(modalHost2.all().find(el => 'data-protocol-auto-badge' in el.props)?.props['data-auto-queued-count']).toBe(
      1,
    );

    // 3. ConsoleQuickActions 左键【科技 TECH】可实验计数为 1；当协议点耗尽 (0) 时立即归零隐藏
    expect(qaHost2.all().find(el => 'data-protocol-ready-count' in el.props)?.props['data-count']).toBe(1);

    prtHost2.app.unmount();
    modalHost2.app.unmount();
    qaHost2.app.unmount();

    const qaEmptyHost = mountInTestHost(QuickActions, {
      snapshot: { ...reactiveSnapshot.value, protocol_points: 0 },
      activeModal: null,
    });
    expect(qaEmptyHost.all().find(el => 'data-protocol-ready-count' in el.props)).toBeUndefined();
    qaEmptyHost.app.unmount();
  });

  it('protocolCommands.ts 零 MVU 写接口、零自动发送且零 Math.random 调用静态审查', () => {
    const bannedWrite =
      /replaceVariables|insertVariables|updateVariablesWith|insertOrAssignVariables|deleteVariable|createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook/;
    const bannedSend = /#send_but|sendMessage|triggerSlash\s*\(\s*['"`]\/send|\bGenerate\s*\(/;
    const cmdPath = fileURLToPath(new URL('../models/protocolCommands.ts', import.meta.url));
    const src = readFileSync(cmdPath, 'utf8');
    expect(src).not.toMatch(bannedWrite);
    expect(src).not.toMatch(bannedSend);
    expect(src).not.toContain('Math.random');
  });

  it('FIX-P1-02：当运行时目录仅含单条动态协议时，以 18 条默认协议为底表合并保留全部内置协议并补齐元数据', async () => {
    const ProtocolComp = await loadProtocolComponent();
    catalogFixture.protocols = [
      {
        kind: 'protocol' as const,
        id: 'all.research.t1.european_defense_agreement',
        name: '欧洲联合防务协议',
        tier: 2 as const,
        cost: 0,
        duration: '——',
        unlocks: '开放欧陆联军特种技术装备与联合实验配额',
        prereq: '——',
        prereqs: [],
        desc: '',
      },
      {
        kind: 'protocol' as const,
        id: 'dlc.protocol.custom_orbital_strike',
        name: '天基动能打击条令',
        faction: '盟军',
        track: '跨国联合防务条约',
        tier: 3 as const,
        cost: 0,
        duration: '——',
        unlocks: '轨道钨棒打击',
        prereq: '——',
        prereqs: [],
        desc: 'DLC 新增协议',
      },
    ];
    const snapshot = {
      ...Schema.parse({
        bases: [
          {
            id: 'b1',
            name: '1号基地',
            status: '警戒',
            buildings: [{ name: '盟军建造厂', state: '运转' }],
          },
        ],
      }),
      protocol_points: 1,
      protocols: [{ ref: 'all.research.t1.european_defense_agreement', status: 'available' }],
    };
    const host = mountInTestHost(ProtocolComp, {
      snapshot,
      initialInstitute: 'allied',
      initialTrack: '跨国联合防务条约',
    });
    const cards = host.all().filter(el => 'data-protocol-id' in el.props);
    const ids = cards.map(c => c.props['data-protocol-id']);
    // 既保留内置协议（且补齐空 desc/track/faction），又合并追加 DLC 动态协议
    expect(ids).toContain('all.research.t1.european_defense_agreement');
    expect(ids).toContain('all.research.t1.pacific_rim_defense_agreement');
    expect(ids).toContain('dlc.protocol.custom_orbital_strike');
    host.app.unmount();
  });

  it('BUG-R2-06：ModalTechTree 复用 30 条规范协议目录、[data-test="tab-protocols"] 可攻关计数同源、排程指令附带 <事件> 协议排程声明、PanelProtocol 日产率计入副官加成', async () => {
    const { buildProtocolScheduleCommand } = await import('../models/protocolCommands');
    const ModalTech = await loadModalTechComponent();

    // 1. 排程指令末尾包含 <事件> 协议排程 声明
    for (const action of ['enable', 'disable', 'move_up', 'move_down', 'move_top', 'hold', 'resume'] as const) {
      const cmd = buildProtocolScheduleCommand({
        action,
        protocolName: '铁幕紧急过载协议',
        queueOrder: 1,
      });
      expect(cmd).toContain('并在 <事件> 中输出 协议排程 声明（标的与排程动作）。');
    }

    // 2. ModalTechTree 复用 30 条规范目录（含尤里协议），顶栏 [data-test="tab-protocols"] 可攻关计数正确
    const yuriSnapshot = {
      ...Schema.parse({
        command: {
          unlocked_factions: ['soviet', 'allied', 'yuri'],
          adjutants: [
            {
              id: 'adj-drill',
              role: 'staff',
              faction: 'common',
              identity: 'mcv_girl',
              name: '百合子',
              title: '条令演训主任',
              buff_preset: 'protocol_drill_director', // +0.12
              upkeep_daily: 0,
              status: 'active',
              note: '',
            },
          ],
        },
        bases: [
          {
            id: 'b-yuri',
            name: '尤里基地',
            status: '运转中',
            buildings: [{ name: '基因测序与心灵谐振研究院', state: '运转' }], // 尤里 T2 院所 (+0.15)
          },
        ],
      }),
      protocol_points: 3,
      economy: { credits: 5000, credits_daily: 0, wallet: {}, chains: [] },
      protocols: [
        { ref: 'yuri.protocol.t2.mastermind_coolant_overclock', status: 'available' },
        { ref: 'yuri.protocol.t3.dominator_biphase_overload', status: 'available' }, // 需 T3 院所，当前仅 T2 不可实验
      ],
    };

    const modalSetup = await loadModalTechSetup({ snapshot: yuriSnapshot });
    expect(modalSetup.mergedCatalogProtocols.value.length).toBe(44);
    expect(modalSetup.protocolReadyCount.value).toBe(1);

    const modalHtml = await renderToString(
      createSSRApp({ render: () => h(ModalTech, { open: true, snapshot: yuriSnapshot }) }),
    );
    expect(modalHtml).toContain('data-test="tab-protocols"');
    expect(modalHtml).toContain('data-protocol-ready="1"');

    // 3. PanelProtocol 日产率计入副官 protocolDailyRateBonus (0.10 基础 + 0.15 尤里T2院所 + 0.12 副官 = 0.37)
    const prtSetup = await loadProtocolSetup({ snapshot: yuriSnapshot, initialInstitute: 'yuri' });
    expect(prtSetup.dailyPointRate.value).toBe(0.37);
    expect(prtSetup.instituteProgressSummary.value.common.total).toBe(7);
    expect(prtSetup.instituteProgressSummary.value.soviet.total).toBe(12);
    expect(prtSetup.instituteProgressSummary.value.allied.total).toBe(12);
    expect(prtSetup.instituteProgressSummary.value.yuri.total).toBe(13);
  });

  it('FD-52 防回退守卫：当酒馆宿主旧世界书缓存仍携带 7 条通用协议的旧「苏联」归属与旧轨道名时，自动纠正至「通用联合条令总署」7 条且苏联保持 12 条', async () => {
    catalogFixture.protocols = [
      {
        id: 'sov.protocol.ra3.sputnik_one_way_deployment',
        name: 'Sputnik一次展开前沿节点协议',
        faction: '苏联',
        track: '钢铁基干与国家动员',
        tier: 1,
      },
      {
        id: 'sov.protocol.ra3.crusher_crane_salvage',
        name: 'Crusher Crane维修—拆件—报废协议',
        faction: '苏联',
        track: '钢铁基干与国家动员',
        tier: 1,
      },
      {
        id: 'sov.protocol.ra3.motorized_mortar_reserve',
        name: '摩托化迫击炮后备分队协议',
        faction: '苏联',
        track: '钢铁基干与国家动员',
        tier: 1,
      },
      {
        id: 'sov.protocol.ra3.mass_production_fold_in',
        name: 'Mass Production工业调度折叠协议',
        faction: '苏联',
        track: '国家战略工程与工业外延',
        tier: 2,
      },
      {
        id: 'sov.research.t2.nuclear_exercise_isolation_notification',
        name: '核演习隔离与通报规程',
        faction: '苏联',
        track: '战略授权与核管控',
        tier: 2,
      },
      {
        id: 'sov.research.t3.conventional_strategic_authorization_isolation',
        name: '常规战略打击授权隔离协议',
        faction: '苏联',
        track: '战略授权与核管控',
        tier: 2,
      },
      {
        id: 'sov.research.t3.nuclear_command_succession_rebuild',
        name: '核指挥接替与态势重建规程',
        faction: '苏联',
        track: '战略授权与核管控',
        tier: 3,
      },
    ];

    const prtSetup = await loadProtocolSetup({ snapshot: Schema.parse({}), initialInstitute: 'common' });
    expect(prtSetup.instituteProgressSummary.value.common.total).toBe(7);
    expect(prtSetup.instituteProgressSummary.value.soviet.total).toBe(12);
    expect(prtSetup.instituteProgressSummary.value.allied.total).toBe(12);
    expect(prtSetup.instituteProgressSummary.value.yuri.total).toBe(13);
    expect(prtSetup.commonTracks.value.map((t: any) => [t.name, t.totalCount])).toEqual([
      ['通用前沿工程与战时动员', 4],
      ['通用战略授权与核常管控', 3],
    ]);
    expect(prtSetup.sovietTracks.value.map((t: any) => [t.name, t.totalCount])).toEqual([
      ['钢铁基干与国家动员', 3],
      ['过载工程与战区拒止', 7],
      ['国家战略工程与工业外延', 2],
    ]);
  });

  it('BUG-R2-16：ModalTechTree 在基地建成「盟军战斗实验室 / 苏联战斗实验室 / 尤里战斗实验室 / 升阳战斗实验室 / 作战实验室」（兼容 state 与 status 字段）时，科研算力 Compute 准确识别算力设施而不再显示「未接入」', async () => {
    const ModalTech = await loadModalTechComponent();

    // 1. 复现 #8 楼「恶土前哨主基地」建成「盟军战斗实验室(state: 运转)」
    const alliedLabSnapshot = Schema.parse({
      command: {
        unlocked_factions: ['allied'],
        primary_faction: 'allied',
      },
      bases: [
        {
          id: 'badlands',
          name: '恶土前哨主基地',
          status: '运转中',
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军战斗实验室', state: '运转' },
          ],
        },
      ],
      tech: { done: ['高级作战实验理论'] },
    });

    const modalSetup = await loadModalTechSetup({ snapshot: alliedLabSnapshot });
    const normSnap = modalSetup.activeSnapshot.value;
    const overview1 = computeOverview(normSnap.bases, normSnap.queues, catalogFixture.buildings, catalogFixture.researches);
    expect(overview1.sources).toHaveLength(1);
    expect(overview1.sources[0]).toMatchObject({
      baseName: '恶土前哨主基地',
      building: '盟军战斗实验室',
      tflops: 50,
      tops: 30,
    });
    expect(overview1.tflops).toBe(50);
    expect(overview1.tops).toBe(30);
    expect(overview1.deficit).toBe(false);

    // 2. 验证切换到统帅部条令主厅时，并网栏「战斗实验室」徽标也显示「在役」
    const prtHtml = await renderToString(
      createSSRApp({
        render: () => h(ModalTech, { open: true, snapshot: alliedLabSnapshot, initialHall: 'protocol' }),
      }),
    );
    expect(prtHtml).toContain('data-grid-badge="battle_lab" data-in-service="true"');

    // 3. 验证兼容升阳战斗实验室 / 作战实验室及 status: '运转' 字段
    const multiLabSnapshot = {
      ...Schema.parse({
        command: {
          unlocked_factions: ['allied', 'soviet', 'yuri'],
          primary_faction: 'allied',
        },
        bases: [
          {
            id: 'b-syn',
            name: '前线科研基地',
            status: '运转中',
            buildings: [],
          },
        ],
      }),
      bases: [
        {
          id: 'b-syn',
          name: '前线科研基地',
          status: '运转中',
          buildings: [
            { name: '升阳战斗实验室', status: '运转' },
            { name: '作战实验室', status: '运转' },
          ],
        },
      ],
    };

    const modalSetup2 = await loadModalTechSetup({ snapshot: multiLabSnapshot });
    const normSnap2 = modalSetup2.activeSnapshot.value;
    expect(normSnap2.bases[0].buildings[0].state).toBe('运转');
    expect(normSnap2.bases[0].buildings[1].state).toBe('运转');

    const overview2 = computeOverview(normSnap2.bases, normSnap2.queues, catalogFixture.buildings, catalogFixture.researches);
    expect(overview2.sources).toHaveLength(2);
    expect(overview2.tflops).toBe(100);
    expect(overview2.tops).toBe(60);
  });
});
