/**
 * ModalEngineering.test.ts —— ENG-UI-01 模态骨架最小冒烟（SSR 挂载 + 静态契约）
 *
 * 手法与 ModalSchedule.test.ts 同管道：vitest 纯 node 环境无 .vue 插件，
 * 用 vue/compiler-sfc 即时编译为临时 .mts 模块（组件旁写入，afterAll 清除），
 * vue/server-renderer renderToString 取首帧标记；useCatalogStore / Icon.vue 打桩。
 *
 * 覆盖：① 短期目录选中态渲染；② 三态分组（mock 演示 + 真快照覆盖）；③ 长期锁定态/场景槽/零写入静态钉死；
 * ④ V2-07 仓段化 V2 工程卡（模块网格五态/前置置灰/承建基地/queue 投影名/按钮禁用态）+ V1 零回归；
 * ⑤ SU-03 修复卡：观察a 阶梯读 def.phases（2 阶段→0/2）；D-SU-RM-2 预载悬挂/拒绝 → 注入主链不阻断。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读写临时编译产物，不进 bundle */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { Schema } from '../../红警指挥系统/core/schema';
import { schedulePanelModel } from '../models/schedulePanelModel';

/* ═══════════════ 目录桩（retrofits 与 mock 实例 ref 同名，displayName 直达；projects 为 V2-07 可变桶） ═══════════════ */

const CATALOG = vi.hoisted(() => ({
  retrofits: [
    {
      kind: 'retrofit',
      name: '灰熊坦克现代化改装工程',
      research: '混合动力装甲工学',
      grade: '大改',
      desc: '混动APU+主动防御系统+车际数据网络。',
    },
    {
      kind: 'retrofit',
      name: '布拉德利现代化改装工程',
      research: '混合动力装甲工学',
      grade: '中改',
      desc: 'A4级动力与全车数字化。',
    },
    {
      kind: 'retrofit',
      name: '多功能步兵车现代化改装工程',
      research: '混合动力装甲工学',
      grade: '小改',
      desc: '模块化接口升级。',
    },
  ],
  projects: [] as Record<string, unknown>[],
}));

vi.mock('../../红警指挥系统/composables/useCatalog', () => ({
  useCatalogStore: () => ({ retrofits: CATALOG.retrofits, projects: CATALOG.projects }),
}));

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', render: () => hh('span') } };
});

/* ENG-UI-02：eng-scene-slot 挂载的场景引擎组件打桩（.vue 直导在 node 管道不可解析；交互由 engScene.test.ts 覆盖） */
vi.mock('../panels/EngSceneView.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'EngSceneView', render: () => hh('div', { class: 'eng-scene-view-stub' }) } };
});

/* FD-25 PKG-C：SpaceBlueprintCanvas 画布组件打桩（node 管道下 .vue 直导不可解析；画布内部逻辑由 SpaceBlueprintCanvas.test.ts 覆盖） */
vi.mock('../panels/SpaceBlueprintCanvas.vue', async () => {
  const { h: hh } = await import('vue');
  return {
    default: {
      name: 'SpaceBlueprintCanvas',
      props: ['domain', 'snapshot', 'selectedBaseName'],
      render(this: { domain?: string; selectedBaseName?: string }) {
        return hh('div', {
          class: 'space-blueprint-canvas-stub',
          'data-test': 'space-blueprint-canvas',
          'data-domain': this.domain ?? '',
          'data-selected-base': this.selectedBaseName ?? '',
        });
      },
    },
  };
});

/* UTO-UI-DOMAIN-01：ModalTechTree 内部 PanelTech.vue 与 store 打桩（SSR 观察者投影测试用） */
vi.mock('../../红警指挥系统/ui/panels/PanelTech.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'PanelTech', render: () => hh('div', { class: 'panel-tech-stub' }) } };
});

vi.mock('../../红警指挥系统/composables/store', () => ({
  useDataStore: () => ({ data: null }),
}));

/* ═══════════════ D-SU-RM-2 · handleInitiate 预载失败路径桩（悬挂/拒绝 → textarea 注入主链仍走通） ═══════════════ */

// 注入主链唯一写通道打桩：fillHostSendInput 被调 = textarea 注入发生（SSR 用例不触发，仅失败路径用例消费）
const hostSendStub = vi.hoisted(() => ({ fill: vi.fn(() => 'textarea' as const) }));
vi.mock('../../红警指挥系统/worldbook/hostSendInput', () => ({ fillHostSendInput: hostSendStub.fill }));

// toastr 桩：ok 模式成功/警示记录器；hang/reject 模式由每测内 vi.doMock 工厂按 holder 当前值出行为
const toastrStubs = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }));
const toastrMode = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'hang' | 'reject' }));

/* ═══════════════ SFC 即时编译（临时模块：组件旁写入，套件末清除） ═══════════════ */

const SFC_PATH = join(__dirname, '../modals/ModalEngineering.vue');
const COMPILED_PATH = join(__dirname, '../modals/ModalEngineering.__ssr__.mts');

let componentPromise: Promise<Component> | undefined;

function loadComponent(): Promise<Component> {
  componentPromise ??= (async () => {
    const source = readFileSync(SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'ModalEngineering.vue' });
    if (errors.length > 0) throw new Error(`ModalEngineering.vue 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id: 'modalengineeringssr',
      inlineTemplate: true,
      templateOptions: { id: 'modalengineeringssr', scoped: descriptor.styles.some(s => s.scoped) },
    });
    const js = `// @ts-nocheck\n${compiled.content.replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '')}`;
    writeFileSync(COMPILED_PATH, js, 'utf8');
    try {
      const mod = (await import(pathToFileURL(COMPILED_PATH).href)) as { default: Component };
      return mod.default;
    } finally {
      try {
        unlinkSync(COMPILED_PATH);
      } catch {
        /* ignore */
      }
    }
  })();
  return componentPromise;
}

function cleanupCompiledMts(): void {
  try {
    unlinkSync(COMPILED_PATH);
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(BINDINGS_PATH);
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(TECH_COMPILED_PATH);
  } catch {
    /* ignore */
  }
}

afterAll(cleanupCompiledMts);

const TECH_SFC_PATH = SFC_PATH.replace('ModalEngineering.vue', 'ModalTechTree.vue');
const TECH_COMPILED_PATH = COMPILED_PATH.replace('ModalEngineering.__ssr__.mts', 'ModalTechTree.__ssr__.mts');
let techComponentPromise: Promise<Component> | undefined;

function loadTechComponent(): Promise<Component> {
  techComponentPromise ??= (async () => {
    const source = readFileSync(TECH_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'ModalTechTree.vue' });
    if (errors.length > 0) throw new Error(`ModalTechTree.vue 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id: 'modaltechtreessr',
      inlineTemplate: true,
      templateOptions: { id: 'modaltechtreessr', scoped: descriptor.styles.some(s => s.scoped) },
    });
    const js = `// @ts-nocheck\n${compiled.content.replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '')}`;
    writeFileSync(TECH_COMPILED_PATH, js, 'utf8');
    try {
      const mod = (await import(pathToFileURL(TECH_COMPILED_PATH).href)) as { default: Component };
      return mod.default;
    } finally {
      try {
        unlinkSync(TECH_COMPILED_PATH);
      } catch {
        /* ignore */
      }
    }
  })();
  return techComponentPromise;
}

async function renderTechTree(snapshot: Schema | null): Promise<string> {
  const Comp = await loadTechComponent();
  return renderToString(createSSRApp({ render: () => h(Comp, { open: true, snapshot }) }));
}

async function renderEngineering(snapshot: Schema | null): Promise<string> {
  const Comp = await loadComponent();
  return renderToString(createSSRApp({ render: () => h(Comp, { open: true, snapshot }) }));
}

/* SFC 二次编译（inlineTemplate:false → setup 直接返回绑定对象）：不开 DOM 即可直调 handleInitiate 等
 * 处理器，验证 D-SU-RM-02 失败路径行为；?v= 序号鞋底缓存确保 vi.resetModules 后每测拿到新鲜模块。
 * 注：路径由 COMPILED_PATH 推导（不新增 __dirname 引用——tsc 基线零新增红线） */
const BINDINGS_PATH = COMPILED_PATH.replace('ModalEngineering.__ssr__.mts', 'ModalEngineering.__bindings__.mts');
let bindingsJsCache: string | null = null;
let bindingsSeq = 0;

async function loadSetupState(snapshot: Schema | null): Promise<Record<string, unknown>> {
  if (bindingsJsCache === null) {
    const source = readFileSync(SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'ModalEngineering.vue' });
    if (errors.length > 0) throw new Error(`ModalEngineering.vue 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, { id: 'modalengbindings', inlineTemplate: false });
    bindingsJsCache = `// @ts-nocheck\n${compiled.content.replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '')}`;
  }
  writeFileSync(BINDINGS_PATH, bindingsJsCache, 'utf8');
  try {
    const mod = (await import(`${pathToFileURL(BINDINGS_PATH).href}?v=${(bindingsSeq += 1)}`)) as {
      default: { setup: (props: unknown, ctx: unknown) => Record<string, unknown> };
    };
    return mod.default.setup({ open: true, snapshot }, { emit: vi.fn(), expose: vi.fn(), attrs: {}, slots: {} });
  } finally {
    try {
      unlinkSync(BINDINGS_PATH);
    } catch {
      /* ignore */
    }
  }
}

/* ═══════════════ ① SSR 冒烟 ═══════════════ */

describe('ENG-UI-01 · ModalEngineering 骨架（SSR 冒烟）', () => {
  it('短期目录渲染 retrofit 条目，默认选中首条并展示信息容器（grade 徽标 + 前置理论）', async () => {
    const html = await renderEngineering(null);
    expect(html).toContain('灰熊坦克现代化改装工程');
    expect(html).toContain('布拉德利现代化改装工程');
    expect(html).toContain('大改'); // 默认选中首条 grade 徽标
    expect(html).toContain('混合动力装甲工学'); // 前置理论位
  });

  it('快照无 projects → mock 演示三态分组（进行中/规划中/已完工）+ 演示注记', async () => {
    const html = await renderEngineering(null);
    expect(html).toContain('进行中');
    expect(html).toContain('规划中');
    expect(html).toContain('已完工');
    expect(html).toContain('预览模式 · 当前展示示例工程数据');
    expect(html).toContain('灰熊坦克现代化改装工程'); // mock 在建实例卡片
  });

  it('真快照 projects 覆盖 mock：演示注记消失，实例名渲染', async () => {
    const snapshot = Schema.parse({
      projects: [
        {
          id: 'proj:real-01',
          ref: '灰熊坦克现代化改装工程',
          scope: 'base',
          bases: ['A'],
          lead_base: 'A',
          grade: '大改',
          status: '在建',
          phases: [{ idx: 0, name: '拆解', status: '进行中', queue_index: null }],
          outcome: { type: 'mark' },
          schema_version: 1,
        },
      ],
    });
    const html = await renderEngineering(snapshot);
    expect(html).not.toContain('预览模式 · 当前展示示例工程数据');
    expect(html).toContain('在建 1'); // 头部计数徽标
    expect(html).toContain('阶段 0/1');
  });

  it('短期工程不渲染 SVG 场景槽 eng-scene-slot，改以具名工序步进条与「无需纳米」展示（长期/仓段工程由 V2-07 挂载 eng-scene-slot）', async () => {
    const html = await renderEngineering(null);
    expect(html).not.toContain('eng-scene-slot');
    expect(html).toContain('eng-phase-step-name');
    expect(html).toContain('无需纳米');
  });
});

/* ═══════════════ 观察a（ENG-SU-RM-01 §五a）· V1 阶段阶梯档位读 def.phases ═══════════════ */

describe('ENG-SU-RM-01 §五a · 阶段阶梯档位读 def.phases（观察a修复）', () => {
  // 独占目录桶（renderV2 同先例）：换入单条 fixture → 默认选中首条，阶梯位即被 fixture 驱动；finally 复位
  async function renderWithRetrofits(list: unknown[]): Promise<string> {
    const saved = CATALOG.retrofits;
    CATALOG.retrofits = list as unknown as typeof saved;
    try {
      return await renderEngineering(null);
    } finally {
      CATALOG.retrofits = saved;
    }
  }

  it('2 阶段 def（2S19 中改同型：真机应显 0/2 而非 0/3）→ 阶梯 0/2 + 共 2 阶段 aria', async () => {
    const html = await renderWithRetrofits([
      {
        kind: 'retrofit',
        name: '2S19 M1／M2数字化炮兵升级工程',
        research: '数字炮兵火力网工学·苏联实现',
        grade: '中改',
        desc: '数字火控与导航换装＋全炮数字化联调。',
        phases: [{ name: '数字火控与导航换装' }, { name: '全炮数字化联调验收' }],
      },
    ]);
    expect(html).toContain('aria-label="共 2 阶段"');
    expect(html).toContain('>0/2</span>');
    expect(html).not.toContain('aria-label="共 3 阶段"'); // 旧缺陷：中改 grade 模板硬出 3 档
  });

  it('3 阶段 def → 阶梯 0/3（档位数与 grade 模板脱钩，以 def.phases 为准）', async () => {
    const html = await renderWithRetrofits([
      {
        kind: 'retrofit',
        name: '三阶段演示工程',
        research: '混合动力装甲工学',
        grade: '小改', // 刻意错档：grade 模板会出 1 档，def 声明 3 阶段 → 必须出 3
        desc: '演示 def.phases 优先于 grade 档位模板。',
        phases: [{ name: '甲' }, { name: '乙' }, { name: '丙' }],
      },
    ]);
    expect(html).toContain('aria-label="共 3 阶段"');
    expect(html).toContain('>0/3</span>');
    expect(html).not.toContain('aria-label="共 1 阶段"');
  });

  it('静态基线 def 不声明 phases → grade 档位模板兑底零回归（大改 0/5）', async () => {
    const html = await renderEngineering(null); // 默认 CATALOG：灰熊大改无 phases
    expect(html).toContain('aria-label="共 5 阶段"');
    expect(html).toContain('>0/5</span>');
  });
});

/** V2-07 目录夹具：仓段化 V2 def（与组件 MOCK_PROJECTS 的 V2 演示实例 ref 同名 → 模块网格被实例驱动） */
const V2_DEF: Record<string, unknown> = {
  kind: 'project',
  name: '空间站仓段化工程',
  desc: '近地轨道模块化空间站，仓段分模块注资承建。',
  grade: '巨构',
  cost: 8000,
  requirements: { research: '轨道工程学', nanites: 120 },
  modules: [
    { id: 'core', name: '核心舱', cost: 2000, prereqs: [] },
    { id: 'hab', name: '居住舱', cost: 1800, prereqs: ['core'] },
    { id: 'dock', name: '对接舱段', cost: 1200, prereqs: ['core', 'hab'] },
    { id: 'solar', name: '太阳能翼', cost: 900, prereqs: ['core'] },
    { id: 'truss', name: '桁架段', cost: 600, prereqs: ['core', 'hab'] },
  ],
};

/* ═══════════════ ④ V2-07 仓段化 V2 工程卡（SSR 冒烟） ═══════════════ */

describe('ENG-V2-07 · V2 工程卡：模块网格替代阶段阶梯（SSR 冒烟）', () => {
  // 独占目录桶：retrofits 清空 + projects 只留 V2 def → 默认选中即 V2，触发 selectedIsV2 分支；finally 复位保 V1 用例互不干扰
  async function renderV2(snapshot: Schema | null): Promise<string> {
    const savedRetrofits = CATALOG.retrofits;
    const savedProjects = CATALOG.projects;
    CATALOG.retrofits = [];
    CATALOG.projects = [V2_DEF];
    try {
      return await renderEngineering(snapshot);
    } finally {
      CATALOG.retrofits = savedRetrofits;
      CATALOG.projects = savedProjects;
    }
  }

  it('模块网格五态卡片：id/名/状态色板/承建基地/queue 投影名；阶段阶梯退场；巨构徽标', async () => {
    const snapshot = Schema.parse({ bases: [{ id: 'beipo', name: '北坡主基地' }] });
    const html = await renderV2(snapshot);
    // V2 分支生效：模块网格进、V1 阶段阶梯 DOM 退场（SSR 渲染 HTML 注释，断言只认类名不认注释文本）；目录仓段标 + 巨构徽标
    expect(html).toContain('舱段模块');
    expect(html).toContain('eng-modgrid');
    expect(html).not.toContain('eng-phase-ladder');
    expect(html).not.toContain('eng-phase-dot');
    expect(html).toContain('仓段');
    expect(html).toContain('巨构');
    // 五模块五态（mock 实例驱动：core完工/hab进行中/dock未启动/solar暂停/truss取消）
    expect(html).toContain('核心舱');
    expect(html).toContain('居住舱');
    expect(html).toContain('对接舱段');
    expect(html).toContain('太阳能翼');
    expect(html).toContain('桁架段');
    expect(html).toContain('data-module-id="core"');
    expect(html).toContain('data-module-state="done"');
    expect(html).toContain('data-module-state="active"');
    expect(html).toContain('data-module-state="pending"');
    expect(html).toContain('data-module-state="paused"');
    expect(html).toContain('data-module-state="cancelled"');
    // 承建基地：实例解析名（beipo → 北坡主基地）；未指派 → 待指派
    expect(html).toContain('承建 · 北坡主基地');
    expect(html).toContain('待指派');
    // queue 投影名（`ref·模块名` 命名合同，projectEngine projectionItemName 唯一真源）
    expect(html).toContain('排产于 空间站仓段化工程·居住舱');
    expect(html).toContain('排产于 空间站仓段化工程·太阳能翼');
    expect(html).toContain('未排产');
    // 前置置灰：dock（prereqs core✓+hab✗）→ data-locked + 前置标注
    expect(html).toContain('data-locked="true"');
    expect(html).toContain('前置 · 居住舱');
    // 概要与进度：模块 1/5 → 20%
    expect(html).toContain('模块 1/5');
    expect(html).toContain('aria-valuenow="20"');
    // 场景槽对 V2 def 同样挂载（EngSceneView 打桩，V2-06 def 联合接通验证）
    expect(html).toContain('eng-scene-slot');
    // requirements 声明位：资金/纳米/前置理论
    expect(html).toContain('$8000');
    expect(html).toContain('前置理论 · 轨道工程学');
  });

  it('V2 指令区：工程级按钮组（在建→暂停/取消可用、恢复禁用）+ 模块级三令（终态模块默认选中全禁）+ 演示数据注记', async () => {
    const snapshot = Schema.parse({ bases: [{ id: 'beipo', name: '北坡主基地' }] });
    const html = await renderV2(snapshot);
    expect(html).toContain('【下达立项指令】');
    expect(html).toContain('三门校验'); // V2 立项 hint（startProjectV2 语义）
    // 工程级：恢复禁用、暂停/取消可用
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*恢复工程/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>\s*暂停工程/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>\s*取消工程/);
    // 模块级：默认选中首模块 core（完工终态）→ 三令全禁
    expect(html).toContain('选中模块「核心舱」');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*注资此模块/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*暂停此模块/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*恢复此模块/);
    // V2 演示数据占位（MOCK-ENG-V2-07，与 MOCK-ENG-UI-01 同退场条件）
    expect(html).toContain('预览模式 · 当前展示示例工程数据');
  });

  it('V1 零回归（静态契约）：阶段阶梯分支保留 + isProjectV1/isProjectV2 守卫 + V2 场景槽透传', () => {
    const src = readFileSync(SFC_PATH, 'utf8');
    expect(src).toContain('v-if="!selectedIsV2"'); // V1 阶段阶梯分支位保留
    expect(src).toContain('施工阶段');
    expect(src).toContain('isProjectV2');
    expect(src).toContain('isProjectV1');
    expect(src).toContain('eng-modgrid'); // V2 模块网格并存
    expect(src).toContain(':def="selectedDef"'); // 场景槽 def 透传（V2-06 def 联合接通）
    expect(src).toContain('MOCK-ENG-V2-07'); // V2 演示实例带移除标记
  });
});

/* ═══════════════ ② 静态契约钉死 ═══════════════ */

describe('ENG-UI-01 静态契约 · ModalEngineering.vue', () => {
  const src = readFileSync(SFC_PATH, 'utf8');

  it('长期页锁定态：「后续版本」徽章 + 锁定条目不可点（aria-disabled）', () => {
    expect(src).toContain('后续版本');
    expect(src).toContain('eng-catalog-item--locked');
    expect(src).toContain("scope === 'theater'");
  });

  it('mock 常量带 MOCK-ENG-UI-01 移除标记', () => {
    expect(src).toContain('MOCK-ENG-UI-01');
  });

  it('零 MVU 写操作 / 零宿主写入 API（只读红线自证）', () => {
    const banned =
      /replaceVariables|insertVariables|updateVariablesWith|insertOrAssignVariables|deleteVariable|createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook/;
    expect(src).not.toMatch(banned);
  });

  it('详情抽屉参数刻意回避「造价/费用」键名（不触发 DetailDrawer 部署指令页脚，四令归 ENG-UI-03）', () => {
    expect(src).not.toContain("['造价'");
    expect(src).not.toContain("['费用'");
  });

  it('D-SU-RM-2 同构隐患清零：预载唯一入口=loadToastrSafe，四处指令处理器全部走安全通道', () => {
    // 唯一动态预载点收敛在 loadToastrSafe 内；旧「裸 await import 在 try 外」形态绝迹
    expect((src.match(/import\('toastr'\)\.then/g) ?? []).length).toBe(1);
    expect(src).not.toMatch(/const \{ default: toastr \} = await import\('toastr'\)/);
    // handleInitiate + V2 工程级/取消确认/模块级 四处全部经安全通道
    expect((src.match(/\(await loadToastrSafe\(\)\)/g) ?? []).length).toBe(4);
  });

  it('观察a 修复钉住：阶梯位读 defPhaseCount（def.phases 优先），不再直读 phaseCount(grade)', () => {
    expect(src).toContain('defPhaseCount(selectedDef)');
    expect(src).not.toContain('phaseCount(selectedDef.grade)');
    expect(src).toContain('def.phases?.length ?? phaseCount(def.grade)'); // 无 phases 兑底保留
  });
});

/* ═══════════════ D-SU-RM-2 · handleInitiate 预载失败路径（textarea 注入主链不阻断） ═══════════════ */

describe('D-SU-RM-2 · handleInitiate：toastr 预载悬挂/拒绝 → 注入主链仍走通', () => {
  const SNAPSHOT = () => Schema.parse({ bases: [{ id: 'beipo', name: '北坡主基地' }] });
  const EXPECTED_ORDER = '【工程指令】立项「灰熊坦克现代化改装工程」，牵头基地：北坡主基地';

  /** 注册 toastr 桩并重置模块缓存：doMock 工厂在处理器 import('toastr') 时按 holder 当前 mode 出行为 */
  function registerToastrMock() {
    vi.doMock('toastr', () => {
      if (toastrMode.mode === 'hang') return new Promise<never>(() => {}); // __vitePreload 悬挂假说复刻：永不决断
      if (toastrMode.mode === 'reject') return Promise.reject(new Error('toastr 预载拒绝（D-SU-RM-2 桩）'));
      return { default: { success: toastrStubs.success, warning: toastrStubs.warning } };
    });
    vi.resetModules();
  }

  afterEach(() => {
    hostSendStub.fill.mockClear();
    toastrStubs.success.mockClear();
    toastrStubs.warning.mockClear();
    toastrMode.mode = 'ok';
    vi.doUnmock('toastr');
  });

  afterAll(cleanupCompiledMts);

  it('预载悬挂（真机 __vitePreload 假说）→ 3s 超时降级：无 toast，textarea 注入照常完成', async () => {
    toastrMode.mode = 'hang';
    registerToastrMock();
    const state = await loadSetupState(SNAPSHOT());
    vi.useFakeTimers();
    try {
      const pending = (state.handleInitiate as () => Promise<void>)();
      // 兑底定时器未到点：注入不得发生（旧缺陷症候=永阻无回执）
      expect(hostSendStub.fill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(3000); // 3s 兑底到点 → 注入主链继续
      await pending;
      expect(hostSendStub.fill).toHaveBeenCalledTimes(1);
      expect(hostSendStub.fill).toHaveBeenCalledWith(EXPECTED_ORDER);
      expect(toastrStubs.success).not.toHaveBeenCalled(); // 降级=无 toast（console 兑底）
    } finally {
      vi.useRealTimers();
    }
  });

  it('预载拒绝 → loadToastrSafe 吞降级：注入照常完成，handler 不抛出（无未处理 rejection）', async () => {
    toastrMode.mode = 'reject';
    registerToastrMock();
    const state = await loadSetupState(SNAPSHOT());
    await (state.handleInitiate as () => Promise<void>)(); // 若拒绝未被吞，此处直接 reject 测试即红
    expect(hostSendStub.fill).toHaveBeenCalledTimes(1);
    expect(hostSendStub.fill).toHaveBeenCalledWith(EXPECTED_ORDER);
    expect(toastrStubs.success).not.toHaveBeenCalled();
  });

  it('预载正常（零回归锚点）：注入 + toast 成功回执均发生', async () => {
    toastrMode.mode = 'ok';
    registerToastrMock();
    const state = await loadSetupState(SNAPSHOT());
    await (state.handleInitiate as () => Promise<void>)();
    expect(hostSendStub.fill).toHaveBeenCalledTimes(1);
    expect(hostSendStub.fill).toHaveBeenCalledWith(EXPECTED_ORDER);
    expect(toastrStubs.success).toHaveBeenCalledTimes(1);
    expect(toastrStubs.success).toHaveBeenCalledWith(`工程指令已载入输入栏：${EXPECTED_ORDER}`, '工程立项令');
  });
});

/* ═══════════════ UTO-UI-DOMAIN-01 · 观察者投影同源对齐与指令发起对齐 ═══════════════ */

describe('UTO-UI-DOMAIN-01 · ModalEngineering / ModalTechTree 观察者投影及指令发起对齐', () => {
  const UTO_V2_DEF = {
    kind: 'project',
    name: '空间站仓段化工程',
    grade: '巨构',
    cost: 4200,
    requirements: { research: '轨道工程学', building: '轨道通讯站', nanites: 50 },
    modules: [
      { id: 'core', name: '核心舱', cost: 2000, duration: 2, prereqs: [] },
      { id: 'hab', name: '居住舱', cost: 1800, duration: 2, prereqs: ['core'] },
      { id: 'solar', name: '太阳能翼', cost: 900, duration: 1, prereqs: ['core'] },
      { id: 'lab', name: '实验舱', cost: 500, duration: 1, prereqs: ['core'] },
    ],
    outcome: { type: 'mark' },
    desc: '轨道仓段拓扑化施工工程。',
  };

  afterEach(() => {
    CATALOG.projects = [];
    hostSendStub.fill.mockClear();
  });

  function buildUtoSharedSnapshot() {
    return Schema.parse({
      bases: [
        {
          id: 'beipo',
          name: '北坡主基地',
          status: '警戒',
          buildings: [
            { name: '盟军建造厂', state: '运转', mode: '生产' },
            { name: '航天发射中心', state: '运转', mode: '生产' },
          ],
        },
      ],
      queues: [
        {
          type: '工程',
          item: '空间站仓段化工程·居住舱',
          base: 'beipo',
          status: 'settling',
          total_minutes: 200,
          spent_minutes: 200,
          eta: '1937-08-15 18:00',
        },
        {
          type: '工程',
          item: '空间站仓段化工程·太阳能翼',
          base: 'beipo',
          status: 'queued',
          hold: true,
          total_minutes: 120,
          spent_minutes: 30,
        },
        {
          type: '研究',
          item: '高能激光导论',
          base: 'beipo',
          status: 'active',
          total_minutes: 180,
          spent_minutes: 90,
          eta: '1937-08-16 08:00',
        },
        {
          type: '研究',
          item: '超导储能',
          base: 'beipo',
          status: 'queued',
          hold: true,
          total_minutes: 150,
          spent_minutes: 60,
        },
      ],
      projects: [
        {
          id: 'proj:空间站仓段化工程@beipo',
          ref: '空间站仓段化工程',
          scope: 'base',
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '巨构',
          status: '在建',
          schema_version: 2,
          outcome: { type: 'mark' },
          modules: [
            { id: 'core', name: '核心舱', status: '完工', base: 'beipo', queue_index: null },
            { id: 'hab', name: '居住舱', status: '进行中', base: 'beipo', queue_index: 0 },
            { id: 'solar', name: '太阳能翼', status: '暂停', base: 'beipo', queue_index: 1 },
            { id: 'lab', name: '实验舱', status: '未启动', base: '', queue_index: null },
          ],
        },
      ],
    });
  }

  it('工程车间视图与日程面板（schedulePanelModel）对同一在途工程任务的进度、held、settling、draft 态 100% 一致', async () => {
    const prev = [...CATALOG.retrofits];
    CATALOG.retrofits = [];
    CATALOG.projects = [UTO_V2_DEF];
    try {
      const snapshot = buildUtoSharedSnapshot();
      const html = await renderEngineering(snapshot);
      const scheduleVm = schedulePanelModel(snapshot, {
        buildings: [],
        productions: [],
        researches: [],
        retrofits: [],
        projects: [UTO_V2_DEF as unknown as import('../../红警指挥系统/core/catalog').ProjectDef],
        factionDefs: [],
      });

      // 1. 属地工程工位快照：eng.main 与 eng.orbital
      expect(html).toContain('data-uto-eng-observer');
      expect(html).toContain('data-lane-key="beipo eng:eng.main"');
      expect(html).toContain('data-lane-key="beipo eng:eng.orbital"');

      // 2. 模块网格 DOM 绑定的 UTO 任务状态与进度与 schedulePanelModel 逐项一致
      const habSched = scheduleVm.scheduledTasks.find(t => t.id === 'task:proj:proj:空间站仓段化工程@beipo:mod:hab')!;
      const solarSched = scheduleVm.scheduledTasks.find(
        t => t.id === 'task:proj:proj:空间站仓段化工程@beipo:mod:solar',
      )!;
      const labDraft = scheduleVm.draftTasks.find(t => t.id === 'task:proj:proj:空间站仓段化工程@beipo:mod:lab')!;

      expect(habSched.status).toBe('settling');
      expect(habSched.workload).toMatchObject({ spentMinutes: 200, totalMinutes: 200 });
      expect(html).toMatch(
        /data-module-id="hab"[^>]*data-task-status="settling"[^>]*data-task-settling="true"[^>]*data-spent-minutes="200"[^>]*data-total-minutes="200"/,
      );

      expect(solarSched.status).toBe('held');
      expect(solarSched.workload).toMatchObject({ spentMinutes: 30, totalMinutes: 120 });
      expect(html).toMatch(
        /data-module-id="solar"[^>]*data-task-status="held"[^>]*data-task-held="true"[^>]*data-spent-minutes="30"[^>]*data-total-minutes="120"/,
      );

      expect(labDraft.status).toBe('draft');
      expect(html).toMatch(/data-module-id="lab"[^>]*data-task-status="draft"[^>]*data-task-draft="true"/);

      // 3. 指令区按钮标记了 UnifiedDispatchBus 动词（Hold / Resume / Cancel / Allocate）
      expect(html).toContain('data-dispatch-verb="Hold"');
      expect(html).toContain('data-dispatch-verb="Resume"');
      expect(html).toContain('data-dispatch-verb="Cancel"');
      expect(html).toContain('data-dispatch-verb="Allocate"');
    } finally {
      CATALOG.retrofits = prev;
    }
  });

  it('ModalTechTree.vue 接入 11 大科研序列工位快照与在研课题 UnifiedTask 投影，与 schedulePanelModel 100% 一致', async () => {
    const snapshot = buildUtoSharedSnapshot();
    const html = await renderTechTree(snapshot);
    const scheduleVm = schedulePanelModel(snapshot, {
      buildings: [],
      productions: [],
      researches: [],
      retrofits: [],
      projects: [],
      factionDefs: [],
    });

    expect(html).toContain('data-uto-tech-observer');
    // 11 大科研序列工位快照全量渲染
    const slotMatches = html.match(/data-slot-id="slot\.[^"]+"/g) ?? [];
    expect(slotMatches).toHaveLength(11);
    expect(scheduleVm.researchSlots).toHaveLength(11);
    expect(html).toContain('data-slot-id="slot.main" data-unlocked="true"');
    expect(html).toContain('data-slot-id="slot.mecha" data-unlocked="false"');

    // 在研课题（active + held）进度与状态与日程面板同源
    expect(html).toMatch(
      /data-task-name="高能激光导论"[^>]*data-task-status="active"[^>]*data-spent-minutes="90"[^>]*data-total-minutes="180"/,
    );
    expect(html).toContain('90/180m (50%)');
    expect(html).toMatch(
      /data-task-name="超导储能"[^>]*data-task-status="held"[^>]*data-task-held="true"[^>]*data-spent-minutes="60"[^>]*data-total-minutes="150"/,
    );
    expect(html).toContain('60/150m (40%)');
  });

  it('工程暂停(Hold)/恢复(Resume)/取消(Cancel)/基地指派(Allocate)动作严格映射 UnifiedDispatchBus 并回填 #send_textarea', async () => {
    const prev = [...CATALOG.retrofits];
    CATALOG.retrofits = [];
    CATALOG.projects = [UTO_V2_DEF];
    try {
      const snapshot = buildUtoSharedSnapshot();
      const state = await loadSetupState(snapshot);

      // 1. 工程级暂停（Hold）
      await (state.handleV2ProjectOrder as (btn: unknown) => Promise<void>)({
        verb: '暂停',
        label: '暂停工程',
        enabled: true,
        hint: '',
        phaseIdx: null,
      });
      expect(hostSendStub.fill).toHaveBeenLastCalledWith('【工程指令】暂停「proj:空间站仓段化工程@beipo」');

      // 2. 工程级取消确认（Cancel）
      await (state.handleV2CancelAffirm as () => Promise<void>)();
      expect(hostSendStub.fill).toHaveBeenLastCalledWith('【工程指令】取消「proj:空间站仓段化工程@beipo」');

      // 3. 模块级恢复（Resume）
      await (state.handleV2ModuleOrder as (btn: unknown) => Promise<void>)({
        verb: '恢复',
        label: '恢复此模块',
        enabled: true,
        hint: '',
        moduleId: 'solar',
        moduleName: '太阳能翼',
      });
      expect(hostSendStub.fill).toHaveBeenLastCalledWith('【工程指令】恢复「proj:空间站仓段化工程@beipo」太阳能翼');

      // 4. 跨基地模块指派（Allocate）
      (state.selectModule as (id: string) => void)('lab');
      await (state.handleV2AllocateOrder as (base?: string) => Promise<void>)('北坡主基地');
      expect(hostSendStub.fill).toHaveBeenLastCalledWith(
        '【工程指令】指派「proj:空间站仓段化工程@beipo」实验舱，承建基地：北坡主基地',
      );
    } finally {
      CATALOG.retrofits = prev;
    }
  });

  it('FIX-P1-03：真实战局快照 projects 为空数组 [] 时直接渲染空态，不回退 MOCK_PROJECTS 演示数据', async () => {
    const liveEmptyProjectsSnapshot = Schema.parse({
      meta: { world_id: 'ra-live-world', turn: 3 },
      economy: { credits: 2500 },
      bases: [{ id: 'beipo', name: '北坡主基地', buildings: [{ name: '盟军建造厂', state: '运转' }] }],
      projects: [],
    });
    const html = await renderEngineering(liveEmptyProjectsSnapshot);
    expect(html).not.toContain('预览模式 · 当前展示示例工程数据');
    expect(html).toContain('暂无进行中工程');
    expect(html).toContain('暂无规划中工程');
    expect(html).toContain('暂无已完工工程');
  });

  it('PKG-B · 三域 Tab 导航、兵种分类筛选条与立项三门核验清单渲染正确，短期改装页不渲染 #eng-scene-slot', async () => {
    const html = await renderEngineering(null);
    expect(html).toContain('data-test="eng-tab-short"');
    expect(html).toContain('data-test="eng-tab-long"');
    expect(html).toContain('data-test="eng-tab-space"');
    expect(html).toContain('data-test="eng-cat-filter"');
    expect(html).toContain('data-test="eng-gate-checklist"');
    expect(html).toContain('eng-item-state-badge');
    // 红线 1：短期改装页隐藏 EngSceneView
    expect(html).not.toContain('id="eng-scene-slot"');
  });

  it('PKG-B · 切换至天基航天 Tab 渲染 #eng-scene-slot 与合同拟定器，且签发与点火均只通过 fillHostSendInput 下发', async () => {
    const spaceSnapshot = Schema.parse({
      meta: { world_id: 'ra-space-world', turn: 5, weather: '晴' },
      economy: { credits: 6000 },
      bases: [
        {
          id: 'beipo',
          name: '北坡主基地',
          buildings: [{ name: '航天发射中心', state: '运转' }],
        },
      ],
      space: {
        reusable_boosters: 2,
        orbital_assets: [
          {
            id: 'orb:recon:1',
            name: '高分光学合成孔径侦察卫星',
            kind: 'recon',
            orbit: 'SSO',
            status: 'active',
            launched_at_day: 2,
          },
        ],
        contracts: [
          {
            id: 'sc-pending-01',
            title: '量子加密宽带通信中继卫星发射任务',
            kind: 'comm',
            rocket: '重型低温无毒运载火箭',
            payload: '量子加密宽带通信中继卫星',
            base: '北坡主基地',
            reward_credits: 1600,
            recover_booster: true,
            status: 'pending',
          },
        ],
      },
    });
    const state = await loadSetupState(spaceSnapshot);
    (state.switchScopeTab as (tab: 'short' | 'long' | 'space') => void)('space');
    expect((state.effectiveScopeTab as { value: string }).value).toBe('space');
    expect((state.spaceSceneDef as { value: { scene: string } }).value.scene).toBe('scene.aerospace.mcc');
    expect((state.launchReadiness as { value: { bannerTone: string } }).value.bannerTone).toBe('ready');

    await (state.handleSubmitSpaceContract as () => Promise<void>)();
    expect(hostSendStub.fill).toHaveBeenCalledTimes(1);
    const draftedCmd = String(hostSendStub.fill.mock.calls[0][0]);
    expect(draftedCmd).toContain('【天基航天指令】拟定并签发发射合同');
    expect(draftedCmd).toContain('<航天合同>');

    await (state.handleLaunchExistingContract as (c: unknown) => Promise<void>)(
      spaceSnapshot.space.contracts[0],
    );
    expect(hostSendStub.fill).toHaveBeenCalledTimes(2);
    const launchCmd = String(hostSendStub.fill.mock.calls[1][0]);
    expect(launchCmd).toContain('【天基航天指令】点火执行发射合同「量子加密宽带通信中继卫星发射任务」');
    expect(launchCmd).toContain('<航天合同>');
  });

  it('PKG-B · 双空间站条目（轨道空间站 + 旧版空间站）自动去重为唯一「轨道空间站」，且「长期巨构」不再包含空间站（专属归入天基航天）', async () => {
    CATALOG.projects = [
      {
        kind: 'project',
        id: 'common.project.orbital_station',
        name: '轨道空间站',
        grade: '巨构',
        cost: 600000,
        scene: 'scene.station.orbital',
        requirements: { research: '空间站建造工学', credits: 600000, nanites: 20000 },
        modules: [{ id: 'core', name: '核心舱', cost: 200000, prereqs: [] }],
      },
      {
        kind: 'project',
        id: 'common.project.orbital_space_station',
        name: '空间站',
        grade: '巨构',
        cost: 35000,
        requirements: { research: '空间站建造工学', credits: 35000, nanites: 200 },
        modules: [{ id: 'core_cabin', name: '核心控制舱', cost: 10000, prereqs: [] }],
      },
    ];
    const state = await loadSetupState(null);
    const longCat = (state.longProjectCatalog as { value: Array<{ name: string }> }).value;
    const spaceCat = (state.spaceProjectCatalog as { value: Array<{ name: string }> }).value;
    // 长期巨构中不再包含任何空间站
    expect(longCat.map(d => d.name)).toEqual([]);
    // 天基航天中去重只保留唯一 1 个正式版「轨道空间站」
    expect(spaceCat.map(d => d.name)).toEqual(['轨道空间站']);
    // 在天基航天中点击「轨道空间站」可切换到该 V2 工程工作台
    (state.switchScopeTab as (tab: 'short' | 'long' | 'space') => void)('space');
    (state.selectSpaceProject as (name: string | null) => void)('轨道空间站');
    expect((state.selectedDef as { value: { name: string } | null }).value?.name).toBe('轨道空间站');
    expect((state.spaceSubView as { value: string }).value).toBe('station');
  });

  it('PKG-C · 天基航天 4 子视图（mcc / constellation / station / lunar）切换与 selectSpaceProject 映射正常，SSR 挂载 SpaceBlueprintCanvas', async () => {
    const prevRetrofits = [...CATALOG.retrofits];
    CATALOG.retrofits = [];
    CATALOG.projects = [
      {
        kind: 'project',
        id: 'common.project.orbital_station',
        name: '轨道空间站',
        grade: '巨构',
        cost: 600000,
        scene: 'scene.station.orbital',
        requirements: { research: '空间站建造工学', credits: 600000, nanites: 20000 },
        modules: [{ id: 'core', name: '核心舱', cost: 200000, prereqs: [] }],
      },
    ];
    try {
      const snapshot = Schema.parse({
        bases: [{ id: 'beipo', name: '北坡主基地', buildings: [{ name: '航天发射中心', state: '运转' }] }],
      });
      const state = await loadSetupState(snapshot);
      (state.switchScopeTab as (tab: 'short' | 'long' | 'space') => void)('space');
      expect((state.spaceSubView as { value: string }).value).toBe('mcc');

      (state.switchSpaceSubView as (v: 'mcc' | 'constellation' | 'station' | 'lunar') => void)('constellation');
      expect((state.spaceSubView as { value: string }).value).toBe('constellation');

      (state.switchSpaceSubView as (v: 'mcc' | 'constellation' | 'station' | 'lunar') => void)('station');
      expect((state.spaceSubView as { value: string }).value).toBe('station');

      (state.switchSpaceSubView as (v: 'mcc' | 'constellation' | 'station' | 'lunar') => void)('lunar');
      expect((state.spaceSubView as { value: string }).value).toBe('lunar');

      // selectSpaceProject 兼容映射规则
      (state.selectSpaceProject as (name: string | null) => void)(null);
      expect((state.spaceSubView as { value: string }).value).toBe('mcc');
      (state.selectSpaceProject as (name: string | null) => void)('轨道空间站');
      expect((state.spaceSubView as { value: string }).value).toBe('station');
      (state.selectSpaceProject as (name: string | null) => void)('沙克尔顿月球基地');
      expect((state.spaceSubView as { value: string }).value).toBe('lunar');

      // SSR 渲染验证：天基航天下渲染 4 个子视图切换按钮与 SpaceBlueprintCanvas
      const html = await renderEngineering(snapshot);
      expect(html).toContain('data-test="space-subview-mcc"');
      expect(html).toContain('data-test="space-subview-constellation"');
      expect(html).toContain('data-test="space-subview-station"');
      expect(html).toContain('data-test="space-subview-lunar"');
      expect(html).toContain('data-test="space-blueprint-canvas"');
      expect(html).toContain('data-domain="station"');
      expect(html).toContain('data-selected-base="北坡主基地"');
    } finally {
      CATALOG.retrofits = prevRetrofits;
    }
  });

  it('PKG-C · 画布事件联动：handleCommitSpaceCanvasBlueprint 与 handleLaunchSpaceCanvasNode 自动预填 spaceDraft 并通过 fillHostSendInput 填入 #send_textarea', async () => {
    const snapshot = Schema.parse({
      bases: [{ id: 'beipo', name: '北坡主基地', buildings: [{ name: '航天发射中心', state: '运转' }] }],
    });
    const state = await loadSetupState(snapshot);
    (state.switchScopeTab as (tab: 'short' | 'long' | 'space') => void)('space');

    const blueprintOrder = '【天基蓝图规划令】定下「轨道空间站」总体建造蓝图（共 4 个节点）';
    await (state.handleCommitSpaceCanvasBlueprint as (text: string) => Promise<void>)(blueprintOrder);
    expect(hostSendStub.fill).toHaveBeenCalledTimes(1);
    expect(hostSendStub.fill).toHaveBeenLastCalledWith(blueprintOrder);

    const launchPayload = {
      domain: 'station' as const,
      slotId: 'st_truss_up_L',
      assetId: 'asset.st.solar',
      orderText: '【天基节点建造与发射令】发射并对接「标准太阳翼与供配电组件」至插槽 st_truss_up_L',
      contractPreset: {
        title: '标准太阳翼在轨拼装发射任务',
        kind: 'station_module' as const,
        payload: '标准太阳翼与供配电组件',
        rocket: '重型低温无毒运载火箭',
        rewardCredits: 2200,
        recoverBooster: true,
      },
    };
    await (state.handleLaunchSpaceCanvasNode as (p: unknown) => Promise<void>)(launchPayload);
    expect(hostSendStub.fill).toHaveBeenCalledTimes(2);
    expect(hostSendStub.fill).toHaveBeenLastCalledWith(launchPayload.orderText);

    const draft = (state.spaceDraft as { value: Record<string, unknown> }).value;
    expect(draft.title).toBe('标准太阳翼在轨拼装发射任务');
    expect(draft.kind).toBe('station_module');
    expect(draft.payload).toBe('标准太阳翼与供配电组件');
    expect(draft.rocket).toBe('重型低温无毒运载火箭');
    expect(draft.rewardCredits).toBe(2200);
    expect(draft.recoverBooster).toBe(true);
    expect(draft.base).toBe('北坡主基地');
  });

  it('FD-27 · 天地月多发射中心切换栏、左右两栏工作台、14 项航天装备排产与 D7-B 商业订单红线闭环', async () => {
    const prevRetrofits = [...CATALOG.retrofits];
    const prevProjects = [...CATALOG.projects];
    CATALOG.retrofits = [];
    CATALOG.projects = [];
    try {
      const baseParsed = Schema.parse({
        meta: {
          date: '14:00',
        },
        bases: [
          {
            id: 'base-canyon',
            name: '太行深谷主基地',
            location: '内陆深谷',
            buildings: [
              { name: '航天发射台与测控中心' },
              { name: '火箭制造厂' },
              { name: '卫星制造中心' },
            ],
          },
          {
            id: 'base-coastal',
            name: '南海文昌滨海分基地',
            location: '赤道滨海',
            buildings: [
              { name: '航天发射台与测控中心' },
              { name: '大型航天器与舱段总装中心' },
            ],
          },
          {
            id: 'base-polar',
            name: '北疆高纬前哨基地',
            location: '高纬苔原',
            buildings: [{ name: '发电厂' }],
          },
        ],
      });
      const snapshot = Object.assign(baseParsed, {
        meta: {
          ...baseParsed.meta,
          clock: '14:00',
          weather: '晴朗',
        },
        bases: [
          {
            ...baseParsed.bases[0],
            site_type: 'inland_canyon',
            tz_offset: 8,
            weather: '多云',
          },
          {
            ...baseParsed.bases[1],
            site_type: 'equatorial_coastal',
            tz_offset: 10,
            weather: '雷暴',
          },
          {
            ...baseParsed.bases[2],
            site_type: 'high_latitude',
            tz_offset: 6,
            weather: '暴雪',
          },
        ],
        space: {
          ...baseParsed.space,
          launch_centers: [
            {
              id: 'lc-canyon-1',
              base: '太行深谷主基地',
              name: '太行一号内陆深谷发射中心',
              site_type: 'inland_canyon',
              tier: 1 as const,
              status: '运转',
              mounted_slots: {
                lc_pad_1: 'common.space.lc_pad_std',
                lc_mcc_core: 'common.space.lc_mcc_command',
              },
            },
            {
              id: 'lc-coastal-2',
              base: '南海文昌滨海分基地',
              name: '文昌赤道滨海重型发射中心',
              site_type: 'equatorial_coastal',
              tier: 3 as const,
              status: '运转',
              mounted_slots: {
                lc_pad_1: 'common.space.lc_pad_std',
                lc_vab_1: 'common.space.lc_vab_std',
                lc_underground_fab: 'common.space.lc_underground_spinner',
                lc_crawler_1: 'common.space.lc_crawler_umbilical',
                lc_telemetry_1: 'common.space.lc_cleanroom_integration',
                lc_cryo_plant: 'common.space.lc_cryo_methalox_plant',
              },
            },
          ],
          equipment_stock: {
            'common.unit.aero.sea_level_kerolox_engine': 3,
            'common.unit.aero.leo_recon_sat_payload': 2,
          },
          commercial_orders: [],
        },
      }) as unknown as Schema;

      // 1. SSR 渲染验证：默认进入 space 域 mcc 视图（因为 retrofits 和 projects 为空）
      const html = await renderEngineering(snapshot);
      expect(html).toContain('data-test="eng-mcc-center-bar"');
      expect(html).toContain('data-test="eng-mcc-workbench"');
      expect(html).toContain('data-test="eng-mcc-workbench-left"');
      expect(html).toContain('data-test="eng-mcc-workbench-right"');
      expect(html).toContain('data-test="mcc-tab-expand"');
      expect(html).toContain('data-test="mcc-tab-manufacture"');
      expect(html).toContain('data-test="mcc-tab-contract"');
      // 检验时区显示（首基地 标准时，分基地 标准+2h）与局部天气
      expect(html).toContain('☀️ 14:00 (标准时)');
      expect(html).toContain('☀️ 16:00 (标准+2h)');
      expect(html).toContain('🌤️ 多云');
      expect(html).toContain('🌤️ 雷暴');
      // 检验 D7-B 红线空状态提示文案
      expect(html).toContain('data-test="mcc-commercial-orders-empty"');
      expect(html).toContain(
        '暂无外部商业委托载荷（前端严禁伪造商业单，仅接收 LLM 在剧情 &lt;航天合同&gt; 中下发的商业委托）',
      );

      // 2. Setup 状态交互检验
      const state = await loadSetupState(snapshot);
      (state.switchScopeTab as (tab: 'short' | 'long' | 'space') => void)('space');

      const centers = (state.launchCenterCards as { value: Array<{ id: string; isSpaceportCity: boolean; maxPayloadTons: number }> }).value;
      expect(centers).toHaveLength(2);
      expect(centers[0].id).toBe('lc-canyon-1');
      expect(centers[0].isSpaceportCity).toBe(false);
      expect(centers[1].id).toBe('lc-coastal-2');
      // 文昌中心集齐 VAB + 地下暗厂 + 超净中心 + 深冷化工厂，激活国家航天城
      expect(centers[1].isSpaceportCity).toBe(true);

      // 切换到文昌赤道滨海重型发射中心
      (state.selectLaunchCenter as (id: string) => void)('lc-coastal-2');
      expect((state.activeLaunchCenter as { value: { id: string; base: string } }).value.id).toBe('lc-coastal-2');
      expect((state.spaceDraft as { value: { base: string } }).value.base).toBe('南海文昌滨海分基地');

      // 四大品类 14 项航天装备完整对齐
      const groups = (
        state.aeroEquipmentGroups as {
          value: Array<{ categoryKey: string; items: Array<{ id: string; name: string; stock: number }> }>;
        }
      ).value;
      expect(groups).toHaveLength(4);
      const allItems = groups.flatMap(g => g.items);
      expect(allItems).toHaveLength(14);
      expect(allItems.find(i => i.id === 'common.unit.aero.sea_level_kerolox_engine')?.stock).toBe(3);

      // 点击 +1 排产 与 +4 批量流水线排产 填入指令栏（输出结构化 <排产计划>）
      const engineItem = allItems.find(i => i.id === 'common.unit.aero.sea_level_kerolox_engine')!;
      await (state.handleScheduleAeroEquipment as (item: unknown, batch: 1 | 4) => Promise<void>)(engineItem, 1);
      expect(hostSendStub.fill).toHaveBeenLastCalledWith(
        expect.stringContaining('【航天装备排产令】'),
      );
      expect(hostSendStub.fill).toHaveBeenLastCalledWith(
        expect.stringContaining('<排产计划>'),
      );

      await (state.handleScheduleAeroEquipment as (item: unknown, batch: 1 | 4) => Promise<void>)(engineItem, 4);
      expect(hostSendStub.fill).toHaveBeenLastCalledWith(
        expect.stringContaining('数量: 4'),
      );

      // 点击建造航天工业设施 → 输出结构化 <排产计划>
      await (state.handleBuildAeroFacility as (fac: { name: string }) => Promise<void>)({ name: '火箭制造厂' });
      expect(hostSendStub.fill).toHaveBeenLastCalledWith(
        expect.stringContaining('【航天基建营建令】'),
      );
      expect(hostSendStub.fill).toHaveBeenLastCalledWith(
        expect.stringContaining('类别: 建造'),
      );

      // 为尚未建发射中心的「北疆高纬前哨基地」下达新建航天发射中心指令
      await (state.handlePlanNewLaunchCenter as (baseName: string) => Promise<void>)('北疆高纬前哨基地');
      expect(hostSendStub.fill).toHaveBeenLastCalledWith(
        expect.stringContaining('在「北疆高纬前哨基地」规划新建【航天发射台与测控中心】'),
      );

      // BUG-R2-08：扁平数组 snapshot.queues 下 aeroFacilityStatuses 在建状态与 activeAeroProductionQueues 进度读取
      const flatQueueSnap = Schema.parse({
        bases: [
          {
            id: 'b-wenchang',
            name: '南海文昌滨海分基地',
            buildings: [{ name: '航天发射中心', state: '运转' }],
          },
        ],
        queues: [
          {
            base: '南海文昌滨海分基地',
            type: '建造',
            item: '卫星制造中心',
            progress: 40,
            eta: '2d',
            status: 'active',
          },
          {
            base: '南海文昌滨海分基地',
            type: '生产',
            item: '海平面大推力液氧煤油发动机组',
            qty: 4,
            qty_done: 1,
            progress: 75,
            eta: '1d',
            status: 'active',
          },
          {
            base: '南海文昌滨海分基地',
            type: '生产',
            item: '并联可回收助推器总成',
            qty: 1,
            qty_done: 1,
            progress: 100,
            eta: '0d',
            status: 'done',
          },
        ],
      });
      const flatState = await loadSetupState(flatQueueSnap);
      const flatFacs = (
        flatState.aeroFacilityStatuses as {
          value: Array<{ key: string; name: string; built: boolean; inQueue: boolean }>;
        }
      ).value;
      expect(flatFacs.find(f => f.key === 'sat_center')?.inQueue).toBe(true);
      expect(flatFacs.find(f => f.key === 'sat_center')?.built).toBe(false);
      const flatActiveQueues = (
        flatState.activeAeroProductionQueues as {
          value: Array<{ item: string; progress: number; qty: number; qtyDone: number }>;
        }
      ).value;
      expect(flatActiveQueues).toHaveLength(1);
      expect(flatActiveQueues[0]).toMatchObject({
        item: '海平面大推力液氧煤油发动机组',
        progress: 75,
        qty: 4,
        qtyDone: 1,
      });

      // BUG-R2-18 & BUG-R2-19：大型航天发射综合体(运转)识别、#34 楼规范名/展示名双向库存读取与规范名 <排产计划> 生成
      const floor34Snap = Schema.parse({
        meta: { weather: '晴' },
        bases: [
          {
            id: 'b-badlands',
            name: '恶土前哨主基地',
            buildings: [
              { name: '大型航天发射综合体', state: '运转' },
              { name: '火箭制造厂', state: '运转' },
              { name: '卫星制造中心', state: '运转' },
            ],
          },
        ],
        forces: {
          equipment: {
            海平面大推力液氧煤油发动机组: 2,
            通用捆绑式助推器: 2,
            标准运载火箭芯一级: 2,
            高空入轨真空芯二级: 2,
            低轨高分光学侦察卫星载荷: 1,
            高轨红外预警与通信卫星载荷: 1,
          },
        },
        space: {
          equipment_stock: {
            海平面大推力液氧煤油发动机组: 2,
            通用捆绑式助推器: 2,
            标准运载火箭芯一级: 2,
            高空入轨真空芯二级: 2,
            低轨高分光学侦察卫星载荷: 1,
            高轨红外预警与通信卫星载荷: 1,
          },
        },
      });
      const floor34State = await loadSetupState(floor34Snap);
      (floor34State.switchScopeTab as (tab: 'short' | 'long' | 'space') => void)('space');

      // BUG-R2-18：大型航天发射综合体被识别为有效运转态发射中心（Tier-3）且不报红字警告
      const readiness34 = (
        floor34State.launchReadiness as {
          value: { launchpadReady: boolean; overallReady: boolean; bannerTone: string };
        }
      ).value;
      expect(readiness34.launchpadReady).toBe(true);
      expect(readiness34.overallReady).toBe(true);
      expect(readiness34.bannerTone).toBe('ready');
      const centerCards34 = (
        floor34State.launchCenterCards as {
          value: Array<{ base: string; isBuilt: boolean; tier: number }>;
        }
      ).value;
      expect(centerCards34[0]).toMatchObject({
        base: '恶土前哨主基地',
        isBuilt: true,
        tier: 3,
      });

      // BUG-R2-19：四大品类航天装备库存与自产载荷候选列表准确显示 2/2/2/2/1/1 库存
      const groups34 = (
        floor34State.aeroEquipmentGroups as {
          value: Array<{ items: Array<{ id: string; name: string; stock: number }> }>;
        }
      ).value;
      const items34 = groups34.flatMap(g => g.items);
      expect(items34.find(i => i.id === 'common.unit.aero.sea_level_kerolox_engine')?.stock).toBe(2);
      expect(items34.find(i => i.id === 'common.unit.aero.strap_on_booster')).toMatchObject({
        name: '通用捆绑式助推器',
        stock: 2,
      });
      expect(items34.find(i => i.id === 'common.unit.aero.core_first_stage')?.stock).toBe(2);
      expect(items34.find(i => i.id === 'common.unit.aero.vacuum_second_stage')?.stock).toBe(2);
      expect(items34.find(i => i.id === 'common.unit.aero.leo_recon_sat_payload')).toMatchObject({
        name: '低轨高分光学侦察卫星载荷',
        stock: 1,
      });
      expect(items34.find(i => i.id === 'common.unit.aero.geo_ew_comm_sat_payload')).toMatchObject({
        name: '高轨红外预警与通信卫星载荷',
        stock: 1,
      });

      const domesticPayloads34 = (
        floor34State.domesticPayloadOptions as {
          value: Array<{ id: string; name: string; stock: number }>;
        }
      ).value;
      expect(
        domesticPayloads34.find(p => p.id === 'common.unit.aero.leo_recon_sat_payload')?.stock,
      ).toBe(1);
      expect(
        domesticPayloads34.find(p => p.id === 'common.unit.aero.geo_ew_comm_sat_payload')?.stock,
      ).toBe(1);

      // 排产按钮填入规范名称 <排产计划>
      const strapBoosterItem = items34.find(i => i.id === 'common.unit.aero.strap_on_booster')!;
      await (floor34State.handleScheduleAeroEquipment as (item: unknown, batch: 1 | 4) => Promise<void>)(
        strapBoosterItem,
        1,
      );
      expect(hostSendStub.fill).toHaveBeenLastCalledWith(
        expect.stringContaining('标的: 通用捆绑式助推器'),
      );

      const leoSatItem = items34.find(i => i.id === 'common.unit.aero.leo_recon_sat_payload')!;
      await (floor34State.handleScheduleAeroEquipment as (item: unknown, batch: 1 | 4) => Promise<void>)(
        leoSatItem,
        1,
      );
      expect(hostSendStub.fill).toHaveBeenLastCalledWith(
        expect.stringContaining('标的: 低轨高分光学侦察卫星载荷'),
      );
    } finally {
      CATALOG.retrofits = prevRetrofits;
      CATALOG.projects = prevProjects;
    }
  });

  afterAll(cleanupCompiledMts);
});
