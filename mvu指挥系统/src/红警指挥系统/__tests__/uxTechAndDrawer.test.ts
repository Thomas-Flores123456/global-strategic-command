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
import { closeDetail, detail } from '../composables/useDetail';

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
  effectiveCatalog: undefined as any,
  dynamicCatalog: undefined as any,
}));

vi.mock('../composables/store', () => ({ useDataStore: () => storeFixture }));
vi.mock('../composables/useCatalog', () => ({ useCatalogStore: () => catalogFixture }));
vi.mock('toastr', () => ({
  default: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', render: () => hh('span', { class: 'icon-stub' }) } };
});

const PANEL_TECH_PATH = fileURLToPath(new URL('../ui/panels/PanelTech.vue', import.meta.url));
const PANEL_TECH_SSR_PATH = fileURLToPath(new URL('../ui/panels/PanelTech.__ux_tech_ssr__.mts', import.meta.url));
const PANEL_TECH_BIND_PATH = fileURLToPath(new URL('../ui/panels/PanelTech.__ux_tech_bind__.mts', import.meta.url));

const DRAWER_PATH = fileURLToPath(new URL('../ui/DetailDrawer.vue', import.meta.url));
const DRAWER_SSR_PATH = fileURLToPath(new URL('../ui/DetailDrawer.__ux_tech_ssr__.mts', import.meta.url));
const DRAWER_BIND_PATH = fileURLToPath(new URL('../ui/DetailDrawer.__ux_tech_bind__.mts', import.meta.url));

const MODAL_TECH_PATH = fileURLToPath(new URL('../../中控悬浮窗/modals/ModalTechTree.vue', import.meta.url));
const MODAL_TECH_BIND_PATH = fileURLToPath(new URL('../../中控悬浮窗/modals/ModalTechTree.__ux_tech_bind__.mts', import.meta.url));

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
  for (const p of [
    PANEL_TECH_SSR_PATH,
    PANEL_TECH_BIND_PATH,
    DRAWER_SSR_PATH,
    DRAWER_BIND_PATH,
    MODAL_TECH_BIND_PATH,
  ]) {
    try {
      unlinkSync(p);
    } catch {
      // ignore
    }
  }
});

beforeEach(() => {
  closeDetail();
  catalogFixture.buildings = [];
  catalogFixture.productions = [];
  catalogFixture.researches = [];
  catalogFixture.retrofits = [];
  catalogFixture.projects = [];
  catalogFixture.factionDefs = [...FACTION_DEFS];
  catalogFixture.protocols = [];
  catalogFixture.effectiveCatalog = undefined;
  catalogFixture.dynamicCatalog = undefined;
  storeFixture.data = Schema.parse({
    bases: [
      {
        id: 'base-1',
        name: '北境主基地',
        status: '警戒',
        buildings: [{ name: '苏联建造厂', state: '运转' }],
      },
    ],
  });
});

describe('UX-TECH-01 · 科技树与详情抽屉状态精准化、缺失前置直跳芯片与阵营 T3 徽标', () => {
  it('PanelTech.vue：status === "queued" 的科技显示为排队态（非 locked），展示排队中与位次', async () => {
    catalogFixture.researches = [
      {
        name: '基础步兵训练学',
        cost: 200,
        eta: '约2日',
        line: '主建筑',
        tier: 1,
        unlocks: '兵营',
        prereq: '——',
        prereqs: [],
        desc: '基础步兵理论',
      },
      {
        name: '重型磁暴电容学',
        cost: 800,
        eta: '约4日',
        line: '苏联特色',
        tier: 2,
        unlocks: '磁暴坦克',
        prereq: '基础步兵训练学',
        prereqs: ['基础步兵训练学'],
        desc: '磁暴电容理论',
      },
    ];
    storeFixture.data = {
      ...storeFixture.data,
      queues: [{ type: '研究', item: '重型磁暴电容学', status: 'queued', progress: 0, eta: '4日' }],
    };

    const { setupState } = await compileSfcSetup(PANEL_TECH_PATH, PANEL_TECH_BIND_PATH, 'paneltechbind1');
    const items = setupState.uiResearches.value as any[];
    const readyTech = items.find(r => r.name === '基础步兵训练学');
    const queuedTech = items.find(r => r.name === '重型磁暴电容学');

    expect(setupState.stateOf(readyTech)).toBe('ready');
    expect(setupState.stateOf(queuedTech)).toBe('queued');
    expect(setupState.stateOf(queuedTech)).not.toBe('locked');
    expect(setupState.queuedCountTotal.value).toBe(1);
    expect(setupState.lockedCountTotal.value).toBe(0);

    const mod = await compileSfcComponent(PANEL_TECH_PATH, PANEL_TECH_SSR_PATH, 'paneltechssr1');
    const html = await renderToString(createSSRApp({ render: () => h(mod.default as Component) }));
    expect(html).toContain('data-tech-state="queued"');
    expect(html).toContain('排队中 · 第 1 位');
  });

  it('PanelTech.vue & ModalTechTree.vue：渲染缺失前置芯片 data-test="missing-prereq-chip"，点击协议芯片触发 jump-to-protocol 跨厅跳转', async () => {
    catalogFixture.protocols = [
      {
        id: 'sov.protocol.ra3.tesla_overload_network',
        name: '磁暴过载联锁与高压电容并网协议',
        faction: '苏联',
        track: '过载工程与战区拒止',
        tier: 1,
      },
    ];
    catalogFixture.researches = [
      {
        name: '高能磁暴装甲学',
        cost: 1200,
        eta: '约5日',
        line: '苏联特色',
        tier: 2,
        unlocks: '磁暴装甲',
        prereq: '基础步兵训练学 + 磁暴过载联锁与高压电容并网协议',
        prereqs: ['基础步兵训练学', 'sov.protocol.ra3.tesla_overload_network'],
        need_buildings: ['红星实验设计局综合体'],
        desc: '需要前置科技、协议与设计局建筑',
      },
    ];

    const { setupState, emit } = await compileSfcSetup(PANEL_TECH_PATH, PANEL_TECH_BIND_PATH, 'paneltechbind2');
    const target = (setupState.uiResearches.value as any[]).find(r => r.name === '高能磁暴装甲学');
    expect(setupState.stateOf(target)).toBe('locked');
    expect(target.missingPrereqs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'tech', name: '基础步兵训练学' }),
        expect.objectContaining({ kind: 'protocol', name: '磁暴过载联锁与高压电容并网协议' }),
        expect.objectContaining({ kind: 'building', name: '红星实验设计局综合体' }),
      ]),
    );

    const mod = await compileSfcComponent(PANEL_TECH_PATH, PANEL_TECH_SSR_PATH, 'paneltechssr2');
    const html = await renderToString(createSSRApp({ render: () => h(mod.default as Component) }));
    expect(html).toContain('data-test="missing-prereq-chip"');
    expect(html).toContain('data-prereq-kind="protocol"');
    expect(html).toContain('data-prereq-name="磁暴过载联锁与高压电容并网协议"');

    // 点击协议芯片 → PanelTech emit('jump-to-protocol', prereqName)
    const protocolChip = target.missingPrereqs.find((c: any) => c.kind === 'protocol');
    await setupState.handleMissingPrereqClick(protocolChip);
    expect(emit).toHaveBeenCalledWith('jump-to-protocol', '磁暴过载联锁与高压电容并网协议');

    // 点击科技芯片 → PanelTech 内部高亮目标科技卡片
    const techChip = target.missingPrereqs.find((c: any) => c.kind === 'tech');
    await setupState.handleMissingPrereqClick(techChip);
    expect(setupState.highlightedTechName.value).toBe('基础步兵训练学');
    expect(setupState.isHighlighted('基础步兵训练学')).toBe(true);

    // ModalTechTree 接收 @jump-to-protocol 切换到 protocol 视图并定位目标协议
    const modal = await compileSfcSetup(MODAL_TECH_PATH, MODAL_TECH_BIND_PATH, 'modaltechbind1', {
      open: true,
      initialHall: 'tech',
    });
    expect(modal.setupState.activeHall.value).toBe('tech');
    modal.setupState.handleJumpToProtocol('磁暴过载联锁与高压电容并网协议');
    expect(modal.setupState.activeHall.value).toBe('protocol');
    expect(modal.setupState.highlightedProtocolTarget.value).toMatchObject({
      protocolId: 'sov.protocol.ra3.tesla_overload_network',
      protocolName: '磁暴过载联锁与高压电容并网协议',
    });
    expect(modal.emit).toHaveBeenCalledWith('jump-to-protocol', '磁暴过载联锁与高压电容并网协议');
  });

  it('PanelTech.vue：红星实验设计局综合体与 T3 科学城下阵营层级徽标正确升至 T2 / T3', async () => {
    const mod = await compileSfcComponent(PANEL_TECH_PATH, PANEL_TECH_SSR_PATH, 'paneltechssr3');
    const derivePanelFactionTiers = mod.derivePanelFactionTiers as Function;

    // 1. 红星实验设计局综合体 → T2
    const t2Res = derivePanelFactionTiers(
      FACTION_DEFS,
      [
        { name: '苏联建造厂', state: '运转' },
        { name: '红星实验设计局综合体', state: '运转' },
      ],
      [],
    );
    expect(t2Res.find((f: any) => f.faction === '苏联')?.tier).toBe(2);

    // 2. 红星科学城 / 国家战略工程综合体 → T3
    storeFixture.data = Schema.parse({
      bases: [
        {
          id: 'base-sov',
          name: '红星科学城中枢',
          status: '警戒',
          buildings: [
            { name: '苏联建造厂', state: '运转' },
            { name: '红星实验设计局综合体', state: '运转' },
            { name: '红星科学城', state: '运转' },
          ],
        },
      ],
    });

    const html = await renderToString(createSSRApp({ render: () => h(mod.default as Component) }));
    expect(html).toContain('data-test="faction-tier-badge"');
    expect(html).toContain('data-faction="苏联"');
    expect(html).toContain('data-tier="T3"');
  });

  it('DetailDrawer.vue：在已研发、排队中、缺失前置三种情形下禁用研发按钮并输出 data-test="research-gate-reason"', async () => {
    catalogFixture.researches = [
      {
        name: '质子撞击炮理论',
        cost: 2000,
        eta: '约6日',
        line: '盟军特色',
        tier: 3,
        unlocks: '质子撞击炮',
        prereq: '高能激光导论 + 盟军战斗实验室',
        prereqs: ['高能激光导论'],
        need_buildings: ['盟军战斗实验室'],
        desc: '战略级远程能量轰击理论',
      },
    ];

    const drawerMod = await compileSfcComponent(DRAWER_PATH, DRAWER_SSR_PATH, 'drawerssr1');
    const { setupState } = await compileSfcSetup(DRAWER_PATH, DRAWER_BIND_PATH, 'drawerbind1');

    detail.open = true;
    detail.data = {
      kind: '科技',
      title: '质子撞击炮理论',
      sub: '盟军特色 · T3',
      params: [['造价', '2000']],
      desc: '战略级远程能量轰击理论',
    };

    // 情形 1：已研发完成
    storeFixture.data = {
      ...storeFixture.data,
      tech: { done: ['质子撞击炮理论'], unlock_notes: '' },
      queues: [],
    };
    expect(setupState.researchGate.value).toMatchObject({
      allowed: false,
      canDispatch: false,
      reason: '该科技已研发完成',
    });
    const htmlDone = await renderToString(createSSRApp({ render: () => h(drawerMod.default as Component) }));
    expect(htmlDone).toContain('data-test="research-gate-reason"');
    expect(htmlDone).toContain('该科技已研发完成');
    expect(htmlDone).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?【下达研发指令】/);

    // 情形 2：已在研发或排队序列中
    storeFixture.data = {
      ...storeFixture.data,
      tech: { done: [], unlock_notes: '' },
      queues: [{ type: '研究', item: '质子撞击炮理论', status: 'queued', progress: 0, eta: '6日' }],
    };
    const { setupState: setupQueued } = await compileSfcSetup(DRAWER_PATH, DRAWER_BIND_PATH, 'drawerbind2');
    expect(setupQueued.researchGate.value).toMatchObject({
      allowed: false,
      canDispatch: false,
      reason: '该科技已在研发或排队序列中',
    });
    const htmlQueued = await renderToString(createSSRApp({ render: () => h(drawerMod.default as Component) }));
    expect(htmlQueued).toContain('data-test="research-gate-reason"');
    expect(htmlQueued).toContain('该科技已在研发或排队序列中');
    expect(htmlQueued).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?【下达研发指令】/);

    // 情形 3：缺失前置
    storeFixture.data = {
      ...storeFixture.data,
      tech: { done: [], unlock_notes: '' },
      queues: [],
    };
    const { setupState: setupMissing } = await compileSfcSetup(DRAWER_PATH, DRAWER_BIND_PATH, 'drawerbind3');
    expect(setupMissing.researchGate.value.allowed).toBe(false);
    expect(setupMissing.researchGate.value.reason).toContain('缺失前置：');
    expect(setupMissing.researchGate.value.reason).toContain('高能激光导论');
    const htmlMissing = await renderToString(createSSRApp({ render: () => h(drawerMod.default as Component) }));
    expect(htmlMissing).toContain('data-test="research-gate-reason"');
    expect(htmlMissing).toContain('缺失前置：高能激光导论');
    expect(htmlMissing).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?【下达研发指令】/);
  });

  it('DetailDrawer.vue：HERO-UNIT-01 生产项目数量上限（max_count=1）达限后禁用列装按钮并显示【不可再生产】', async () => {
    catalogFixture.productions = [
      {
        name: '盟军传奇特战员·谭雅',
        aliases: ['谭雅', 'Tanya', '特战女王谭雅'],
        cost: 1500,
        max_count: 1,
        need_building: '兵营',
        need_buildings: ['兵营'],
        prereqs: ['特种作战高级工学'],
        desc: '盟军传奇特战女王，全战区严格限编 1 人。',
      },
    ];

    const drawerMod = await compileSfcComponent(DRAWER_PATH, DRAWER_SSR_PATH, 'drawerssr_hero');

    detail.open = true;
    detail.data = {
      kind: '生产',
      title: '盟军传奇特战员·谭雅',
      params: [
        ['造价', '$1500'],
        ['工期', '标准工期 (战术列装)'],
        ['产地', '兵营'],
        ['数量上限', '1（战区唯一）'],
      ],
      desc: '盟军传奇特战女王，全战区严格限编 1 人。',
    };

    // 情形 A：尚未拥有且未在产 → 允许列装 1 名，剩余配额 1
    storeFixture.data = {
      ...storeFixture.data,
      forces: { troops: {}, vehicles: [], girls: [] },
      queues: [],
    };
    const { setupState: setupAvail } = await compileSfcSetup(DRAWER_PATH, DRAWER_BIND_PATH, 'drawerbind_hero1');
    expect(setupAvail.productionGate.value).toMatchObject({
      allowed: true,
      canDispatch: true,
      isMaxedOut: false,
      maxCount: 1,
      remainingQuota: 1,
      reason: '',
    });
    expect(setupAvail.dispatchBtnText.value).toBe('【列装生产】');

    // 情形 B：已在册拥有（如 forces.troops.谭雅 = 1）→ 达限不可再生产
    storeFixture.data = {
      ...storeFixture.data,
      forces: { troops: { 谭雅: 1 }, vehicles: [], girls: [] },
      queues: [],
    };
    const { setupState: setupMaxed } = await compileSfcSetup(DRAWER_PATH, DRAWER_BIND_PATH, 'drawerbind_hero2');
    expect(setupMaxed.productionGate.value).toMatchObject({
      allowed: false,
      canDispatch: false,
      isMaxedOut: true,
      maxCount: 1,
      remainingQuota: 0,
      reason: '已达数量上限（1/1），不可再生产',
    });
    expect(setupMaxed.dispatchBtnText.value).toBe('【不可再生产】');
    const htmlMaxed = await renderToString(createSSRApp({ render: () => h(drawerMod.default as Component) }));
    expect(htmlMaxed).toContain('data-test="research-gate-reason"');
    expect(htmlMaxed).toContain('已达数量上限（1/1），不可再生产');
    expect(htmlMaxed).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?【不可再生产】/);

    // 情形 C：在产序列中已有 1 名 → 占满数量上限不可再生产
    storeFixture.data = {
      ...storeFixture.data,
      forces: { troops: {}, vehicles: [], girls: [] },
      queues: [{ type: '生产', item: '盟军传奇特战员·谭雅', status: 'active', progress: 40, eta: '3h' }],
    };
    const { setupState: setupQueuedHero } = await compileSfcSetup(DRAWER_PATH, DRAWER_BIND_PATH, 'drawerbind_hero3');
    expect(setupQueuedHero.productionGate.value).toMatchObject({
      allowed: false,
      canDispatch: false,
      isMaxedOut: true,
      maxCount: 1,
      remainingQuota: 0,
      reason: '在产序列已占满数量上限（1/1），不可再生产',
    });
  });

  it('DetailDrawer.vue：FD-49 档案只读查阅模式（readonly=true / 档案附注）与随行人员个人卷宗（如萧栖雪）严禁渲染底部列装生产/投入建造操作栏', async () => {
    const drawerMod = await compileSfcComponent(DRAWER_PATH, DRAWER_SSR_PATH, 'drawerssr_archive_readonly');

    // 场景 1：随行人员个人卷宗（萧栖雪，kind='人员'，含随行渊源/席位任命/性格与口吻，无造价）
    detail.open = true;
    detail.data = {
      kind: '人员',
      title: '萧栖雪',
      params: [
        ['阵营归属', '盟军'],
        ['随行渊源', '旧部亲卫（原世界生死与共的战术班底）'],
        ['开局职务', '战术狙击核心'],
        ['席位任命', '苏联首席副官'],
        ['代号', 'Sophia'],
        ['性格与口吻', '进入交火或战术决策程序后，周身疏离感瞬间转为冰冷果决的统治气场'],
        ['履历与绝活', '拥有极其恐怖的空间大局观与弹道直觉'],
      ],
      desc: '',
      note: '在册卷宗 · 战局人员与设定档案',
      readonly: true,
    };

    const { setupState: setupPerson } = await compileSfcSetup(DRAWER_PATH, DRAWER_BIND_PATH, 'drawerbind_person1');
    expect(setupPerson.isDispatchable.value).toBe(false);
    expect(setupPerson.isProduceKind.value).toBe(false);

    const htmlPerson = await renderToString(createSSRApp({ render: () => h(drawerMod.default as Component) }));
    expect(htmlPerson).toContain('萧栖雪');
    expect(htmlPerson).not.toContain('列装数量');
    expect(htmlPerson).not.toContain('【列装生产】');
    expect(htmlPerson).not.toContain('data-test="dispatch-order-btn"');

    // 场景 2：从【档案】打开科技/载具正史词条（readonly=true 或 note='正史 · ...'）→ 同样隐藏下达操作栏
    detail.data = {
      kind: '载具',
      title: '天启重型坦克',
      params: [['造价', '$1750']],
      desc: '正史设定正文',
      note: '正史 · 《武备·苏联》',
      readonly: true,
    };
    const { setupState: setupArchiveVeh } = await compileSfcSetup(DRAWER_PATH, DRAWER_BIND_PATH, 'drawerbind_archive_veh');
    expect(setupArchiveVeh.isDispatchable.value).toBe(false);
    expect(setupArchiveVeh.isProduceKind.value).toBe(false);
  });
});
