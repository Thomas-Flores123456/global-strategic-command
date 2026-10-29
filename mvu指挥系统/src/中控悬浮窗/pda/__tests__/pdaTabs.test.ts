/**
 * pdaTabs.test.ts —— PDA-TAB-01/02/03 手持板业务页签三联装与 PdaWindowFrame 主屏装配单测
 *
 * 覆盖：
 * 1. PDA-TAB-01 (PdaTabEvents.vue)：
 *    - 顶栏微型过滤器 [全部]、[🔴 警报]、[🟡 预警]、[🟢 简讯] 渲染与数据过滤；
 *    - 垂直时间轴卡片：事件动词（资金链变动、工况异常、势力接触）、发生楼层/时间、概要描述；
 *    - 未读红点标记与 pdaShell.state.readEventIds 联动；
 *    - 单条点击直达与一键标为已读动作。
 * 2. PDA-TAB-02 (PdaTabChains.vue)：
 *    - 顶栏日均收支总览看板 DailyNet（如 +600 CR/DAY）加权计算与呈现；
 *    - 资金链卡片：流向标识（[收入] 绿 / [支出] 红）、额度（如 800 CR/天）；
 *    - 五态标签（active / distressed / broken / exhausted / establishing）；
 *    - 断电停工醒目告警（带有 reason 说明如“因基地电网断供停产”时黄色/红色警示条突出）；
 *    - 效率百分比指示（eff: 100% / 0%）与有限资源链开采进度条（extracted / total_yield）。
 * 3. PDA-TAB-03 (PdaTabIntel.vue)：
 *    - 世界书落地暂存门（Staging Gate）：陈列 pending_lore 新实体与“采纳落地”按钮回调；
 *    - 战区势力态势简表：势力名称、好感/敌对关系条；
 *    - 指挥官速记备忘录区。
 * 4. PdaWindowFrame.vue 三联页签装配：
 *    - 顶栏下方页签切换条 [ 战况动态 | 资金链网 | 战区情报 ]；
 *    - 响应 shell.state.activeTab ('events' | 'chains' | 'intel') 动态切换对应 Tab。
 */

/* eslint-disable import-x/no-nodejs-modules -- 测试即时编译 SFC 临时产物 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import type { Faction, IncomeChain } from '../../../红警指挥系统/core/schema';
import type { PdaEventItem } from '../PdaTabEvents.vue';
import type { NormalizedPendingLoreItem } from '../PdaTabIntel.vue';
import { createPdaShell, type PdaShell, type Viewport } from '../pdaState';

const VIEWPORT_DESKTOP: Viewport = { width: 1440, height: 900 };

const DIR = fileURLToPath(new URL('..', import.meta.url));
const EVENTS_SFC_PATH = join(DIR, 'PdaTabEvents.vue');
const EVENTS_COMPILED_PATH = join(DIR, 'PdaTabEvents.__ssr__.mts');
const CHAINS_SFC_PATH = join(DIR, 'PdaTabChains.vue');
const CHAINS_COMPILED_PATH = join(DIR, 'PdaTabChains.__ssr__.mts');
const INTEL_SFC_PATH = join(DIR, 'PdaTabIntel.vue');
const INTEL_COMPILED_PATH = join(DIR, 'PdaTabIntel.__ssr__.mts');
const QUESTS_SFC_PATH = join(DIR, 'PdaTabQuests.vue');
const QUESTS_COMPILED_PATH = join(DIR, 'PdaTabQuests.__ssr__.mts');
const FRAME_SFC_PATH = join(DIR, 'PdaWindowFrame.vue');
const FRAME_COMPILED_PATH = join(DIR, 'PdaWindowFrame.__tabs_ssr__.mts');
const TOPNAV_SFC_PATH = join(DIR, '..', 'console/ConsoleTopNav.vue');
const TOPNAV_COMPILED_PATH = join(DIR, '..', 'console/ConsoleTopNav.__pda_ssr__.mts');

function compileSfc(
  sfcPath: string,
  compiledPath: string,
  id: string,
  transformJs?: (code: string) => string,
): Promise<Component> {
  return (async () => {
    const source = readFileSync(sfcPath, 'utf8');
    const { descriptor, errors } = parse(source, { filename: sfcPath });
    if (errors.length > 0) throw new Error(`${sfcPath} 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id,
      inlineTemplate: true,
      templateOptions: { id, scoped: descriptor.styles.some(s => s.scoped) },
    });
    let js = compiled.content
      .replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '')
      .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
    if (transformJs) {
      js = transformJs(js);
    }
    writeFileSync(compiledPath, js, 'utf8');
    const mod = (await import(pathToFileURL(compiledPath).href)) as { default: Component };
    return mod.default;
  })();
}

let eventsPromise: Promise<Component> | undefined;
const loadTabEvents = () => (eventsPromise ??= compileSfc(EVENTS_SFC_PATH, EVENTS_COMPILED_PATH, 'pdatabeventsssr'));

let chainsPromise: Promise<Component> | undefined;
const loadTabChains = () => (chainsPromise ??= compileSfc(CHAINS_SFC_PATH, CHAINS_COMPILED_PATH, 'pdatabchainsssr'));

let intelPromise: Promise<Component> | undefined;
const loadTabIntel = () => (intelPromise ??= compileSfc(INTEL_SFC_PATH, INTEL_COMPILED_PATH, 'pdatabintelssr'));

let questsPromise: Promise<Component> | undefined;
const loadTabQuests = () => (questsPromise ??= compileSfc(QUESTS_SFC_PATH, QUESTS_COMPILED_PATH, 'pdatabquestsssr'));

let topNavPromise: Promise<Component> | undefined;
const loadTopNav = () =>
  (topNavPromise ??= compileSfc(TOPNAV_SFC_PATH, TOPNAV_COMPILED_PATH, 'consoletopnavpdassr', code =>
    code.replace(
      "import Icon from '../红警指挥系统/ui/Icon.vue';",
      "const Icon = { name: 'Icon', props: ['name', 'size'], render() { return null; } };",
    ),
  ));

let framePromise: Promise<Component> | undefined;
const loadWindowFrame = async () => {
  await Promise.all([loadTabEvents(), loadTabChains(), loadTabIntel(), loadTabQuests()]);
  return (framePromise ??= compileSfc(FRAME_SFC_PATH, FRAME_COMPILED_PATH, 'pdaframetabsssr', code =>
    code
      .replace('./PdaTabEvents.vue', './PdaTabEvents.__ssr__.mts')
      .replace('./PdaTabChains.vue', './PdaTabChains.__ssr__.mts')
      .replace('./PdaTabIntel.vue', './PdaTabIntel.__ssr__.mts')
      .replace('./PdaTabQuests.vue', './PdaTabQuests.__ssr__.mts'),
  ));
};

afterAll(() => {
  for (const p of [
    EVENTS_COMPILED_PATH,
    CHAINS_COMPILED_PATH,
    INTEL_COMPILED_PATH,
    QUESTS_COMPILED_PATH,
    FRAME_COMPILED_PATH,
    TOPNAV_COMPILED_PATH,
  ]) {
    try {
      unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
});

function createTestShell(): PdaShell {
  const shell = createPdaShell({
    storage: null,
    viewport: () => VIEWPORT_DESKTOP,
  });
  shell.setCollapsed(false);
  return shell;
}

const SAMPLE_EVENTS: PdaEventItem[] = [
  {
    id: 'ev-power-01',
    level: 'critical',
    verb: '工况异常',
    title: '主反应堆过载 · 精炼厂断电停产',
    summary: '1号前哨站电网负荷突破阈值，矿石精炼厂供电中断。',
    floor: 15,
    time: '14:20',
    targetTab: 'chains',
  },
  {
    id: 'ev-chain-02',
    level: 'warn',
    verb: '资金链变动',
    title: '灵石走私走廊受挫降效',
    summary: '遭遇巡逻队盘查，日均净入由 800 跌至 400 CR/天。',
    floor: 14,
    time: '13:45',
    targetTab: 'chains',
  },
  {
    id: 'ev-faction-03',
    level: 'info',
    verb: '势力接触',
    title: '极光生物科技外围侦察接触',
    summary: '在第三工业区边缘发现该集团轻型外骨骼巡逻分队。',
    floor: 13,
    time: '12:10',
    targetTab: 'intel',
  },
];

const SAMPLE_CHAINS: IncomeChain[] = [
  {
    id: 'chain_ore_01',
    name: '青岚山原矿直销通道',
    flow: '收入',
    rate_daily: 800,
    status: 'active',
    eff: 1,
    deps: { base_id: 'beipo', buildings: ['矿石精炼厂'], world_resource: 'vein_01' },
    capacity: { total_yield: 2000, extracted: 500 },
    reason: '',
    updated_at_day: 10,
  },
  {
    id: 'chain_mercenary_02',
    name: '外围护卫佣兵合同',
    flow: '支出',
    rate_daily: 200,
    status: 'active',
    eff: 1,
    deps: { base_id: 'beipo', buildings: [], world_resource: '' },
    capacity: { total_yield: null, extracted: 0 },
    reason: '',
    updated_at_day: 10,
  },
  {
    id: 'chain_smuggle_03',
    name: '荒原精炼贸易线',
    flow: '收入',
    rate_daily: 400,
    status: 'distressed',
    eff: 0,
    deps: { base_id: 'beipo', buildings: ['货运站'], world_resource: '' },
    capacity: { total_yield: null, extracted: 0 },
    reason: '因基地电网断供停产，精炼分拣线暂停运作',
    updated_at_day: 12,
  },
  {
    id: 'chain_broken_04',
    name: '旧城废料回收线',
    flow: '收入',
    rate_daily: 300,
    status: 'broken',
    eff: 0,
    deps: { base_id: 'beipo', buildings: [], world_resource: '' },
    capacity: { total_yield: null, extracted: 0 },
    reason: '运输通道被治安队彻底封锁切断',
    updated_at_day: 11,
  },
  {
    id: 'chain_exhausted_05',
    name: '浅层碎晶矿坑',
    flow: '收入',
    rate_daily: 500,
    status: 'exhausted',
    eff: 0,
    deps: { base_id: 'beipo', buildings: [], world_resource: '' },
    capacity: { total_yield: 1000, extracted: 1000 },
    reason: '矿脉已完全采空枯竭',
    updated_at_day: 9,
  },
  {
    id: 'chain_est_06',
    name: '地下黑市军火专网',
    flow: '收入',
    rate_daily: 600,
    status: 'establishing',
    eff: 0,
    deps: { base_id: 'beipo', buildings: [], world_resource: '' },
    capacity: { total_yield: null, extracted: 0 },
    reason: '',
    updated_at_day: 12,
  },
];

const SAMPLE_FACTIONS: Faction[] = [
  {
    name: '自由商人联合会',
    attitude: '友善',
    intel: '常年游走于灰区的武装商团，愿意收购高纯精炼矿。',
    risk: '低',
  },
  {
    name: '极光生物科技',
    attitude: '敌意',
    intel: '第三工业区垄断巨头，正悬赏搜捕不明武装力量。',
    risk: '高',
  },
];

const SAMPLE_PENDING_LORE = [
  {
    id: 'lore_铁幕重工残部',
    kind: '势力',
    name: '铁幕重工残部',
    summary: '盘踞在废弃发射井的旧时代重装机械师团体。',
    source_floor: 15,
    source_swipe: 0,
    created_day: 12,
  },
  {
    id: 'lore_纳米相位镀层',
    kind: '科技',
    name: '纳米相位镀层',
    summary: '可大幅降低热成像特征的实验性装甲涂层。',
    source_floor: 15,
    source_swipe: 0,
    created_day: 12,
  },
];

describe('PDA-TAB-01: PdaTabEvents 战地动态流与事件时间轴', () => {
  it('渲染顶栏微型过滤器 [全部]、[🔴 警报]、[🟡 预警]、[🟢 简讯] 与时间轴事件卡片', async () => {
    const Comp = await loadTabEvents();
    const shell = createTestShell();

    const html = await renderToString(
      createSSRApp({
        render: () => h(Comp, { shell, events: SAMPLE_EVENTS }),
      }),
    );

    // 四档微型过滤器
    expect(html).toContain('[全部]');
    expect(html).toContain('[🔴 警报]');
    expect(html).toContain('[🟡 预警]');
    expect(html).toContain('[🟢 简讯]');

    // 三大事件动词、发生楼层/时间与概要描述
    expect(html).toContain('[工况异常]');
    expect(html).toContain('[资金链变动]');
    expect(html).toContain('[势力接触]');
    expect(html).toContain('#15 · 14:20');
    expect(html).toContain('#14 · 13:45');
    expect(html).toContain('#13 · 12:10');
    expect(html).toContain('1号前哨站电网负荷突破阈值');
    expect(html).toContain('未读 3');
  });

  it('支持按严重度等级过滤：切换 filter 为 critical / warn / info 时仅展示对应条目', async () => {
    const Comp = await loadTabEvents();
    const shell = createTestShell();

    // 1. 过滤 critical (🔴 警报)
    const critHtml = await renderToString(
      createSSRApp({
        render: () => h(Comp, { shell, events: SAMPLE_EVENTS, filter: 'critical' }),
      }),
    );
    expect(critHtml).toContain('主反应堆过载 · 精炼厂断电停产');
    expect(critHtml).not.toContain('灵石走私走廊受挫降效');
    expect(critHtml).not.toContain('极光生物科技外围侦察接触');

    // 2. 过滤 warn (🟡 预警)
    const warnHtml = await renderToString(
      createSSRApp({
        render: () => h(Comp, { shell, events: SAMPLE_EVENTS, filter: 'warn' }),
      }),
    );
    expect(warnHtml).toContain('灵石走私走廊受挫降效');
    expect(warnHtml).not.toContain('主反应堆过载 · 精炼厂断电停产');

    // 3. 过滤 info (🟢 简讯)
    const infoHtml = await renderToString(
      createSSRApp({
        render: () => h(Comp, { shell, events: SAMPLE_EVENTS, filter: 'info' }),
      }),
    );
    expect(infoHtml).toContain('极光生物科技外围侦察接触');
    expect(infoHtml).not.toContain('灵石走私走廊受挫降效');
  });

  it('未读红点标记与 pdaShell 联动：已读条目消除红点，一键标为已读清空全部未读', async () => {
    const Comp = await loadTabEvents();
    const shell = createTestShell();

    // 初始 3 条全部未读
    const initHtml = await renderToString(
      createSSRApp({
        render: () => h(Comp, { shell, events: SAMPLE_EVENTS }),
      }),
    );
    expect(initHtml.match(/data-testid="pda-event-unread-dot"/g)?.length).toBe(3);

    // 标记第一条已读
    shell.markEventRead('ev-power-01');
    const afterOneHtml = await renderToString(
      createSSRApp({
        render: () => h(Comp, { shell, events: SAMPLE_EVENTS }),
      }),
    );
    expect(afterOneHtml.match(/data-testid="pda-event-unread-dot"/g)?.length).toBe(2);
    expect(afterOneHtml).toContain('未读 2');

    // 一键全部标为已读
    shell.markAllEventsRead(SAMPLE_EVENTS.map(e => e.id));
    const afterAllHtml = await renderToString(
      createSSRApp({
        render: () => h(Comp, { shell, events: SAMPLE_EVENTS }),
      }),
    );
    expect(afterAllHtml.match(/data-testid="pda-event-unread-dot"/g)).toBeNull();
    expect(afterAllHtml).toContain('data-unread-count="0"');
  });

  it('单条点击直达与一键标为已读方法调用：联动更新 pdaShell.readEventIds 与 highlightEventId / activeTab', async () => {
    const Comp = (await loadTabEvents()) as Component & {
      setup?: (props: Record<string, unknown>, ctx: { expose: (exp: unknown) => void; emit: () => void }) => unknown;
    };
    const shell = createTestShell();
    let exposed: {
      onSelectEvent: (item: { id: string; targetTab: 'events' | 'chains' | 'intel' }) => void;
      markAllAsRead: () => void;
    } | null = null;

    Comp.setup?.(
      { shell, events: SAMPLE_EVENTS, filter: 'all' },
      {
        expose: exp => {
          exposed = exp as typeof exposed;
        },
        emit: () => {},
      },
    );

    expect(exposed).not.toBeNull();
    // 单条点击直达 -> 自动标为已读并跳转到 targetTab ('chains') 且高亮该事件
    exposed!.onSelectEvent({ id: 'ev-power-01', targetTab: 'chains' });
    expect(shell.state.readEventIds).toContain('ev-power-01');
    expect(shell.state.activeTab).toBe('chains');
    expect(shell.state.highlightEventId).toBe('ev-power-01');

    // 一键标为已读 -> 全部事件进入 readEventIds
    exposed!.markAllAsRead();
    expect(shell.state.readEventIds).toEqual(expect.arrayContaining(['ev-power-01', 'ev-chain-02', 'ev-faction-03']));
  });
});

describe('PDA-TAB-02: PdaTabChains 资金链工况与断电告警看板', () => {
  it('顶栏日均收支总览看板正确计算并展示标称日均净收益 (+600 CR/DAY)', async () => {
    const Comp = await loadTabChains();
    // SAMPLE_CHAINS 中：active 收入 800 (eff 1) - active 支出 200 (eff 1) + distressed 收入 400 (eff 0) = +600
    const html = await renderToString(
      createSSRApp({
        render: () => h(Comp, { chains: SAMPLE_CHAINS }),
      }),
    );

    expect(html).toContain('data-daily-net="600"');
    expect(html).toContain('+600 CR/DAY');
    expect(html).toContain('在册链条: 6');
  });

  it('渲染流向标识（[收入]/[支出]）、日额度、五态中文标签与效率百分比 (eff: 100% / 0%)', async () => {
    const Comp = await loadTabChains();
    const html = await renderToString(
      createSSRApp({
        render: () => h(Comp, { chains: SAMPLE_CHAINS }),
      }),
    );

    // 流向与额度
    expect(html).toContain('[收入]');
    expect(html).toContain('[支出]');
    expect(html).toContain('800 CR/天');
    expect(html).toContain('200 CR/天');

    // 五态标签全覆盖
    expect(html).toContain('运转正常');
    expect(html).toContain('运转受挫');
    expect(html).toContain('断裂停摆');
    expect(html).toContain('开采枯竭');
    expect(html).toContain('筹建中');

    // 效率百分比指示
    expect(html).toContain('eff: 100%');
    expect(html).toContain('eff: 0%');
  });

  it('断电停工醒目告警与有限资源链开采进度条 (extracted / total_yield) 渲染', async () => {
    const Comp = await loadTabChains();
    const html = await renderToString(
      createSSRApp({
        render: () => h(Comp, { chains: SAMPLE_CHAINS }),
      }),
    );

    // 断电停工醒目告警条
    expect(html).toContain('data-testid="pda-chain-reason-alert"');
    expect(html).toContain('⚡ 断电/停工告警:');
    expect(html).toContain('因基地电网断供停产，精炼分拣线暂停运作');

    // 有限资源链开采进度条：500 / 2000 (25%) 与 1000 / 1000 (100%)
    expect(html).toContain('data-testid="pda-chain-capacity"');
    expect(html).toContain('500 / 2000 (25%)');
    expect(html).toContain('1000 / 1000 (100%)');
    expect(html).toContain('width:25%');
    expect(html).toContain('width:100%');
  });
});

describe('PDA-TAB-03: PdaTabIntel 战区情报与世界书待确认备忘录', () => {
  it('世界书落地暂存门 (Staging Gate) 陈列 pending_lore 新实体并提供“采纳落地”按钮', async () => {
    const Comp = await loadTabIntel();
    const onAdoptLore = vi.fn<(item: NormalizedPendingLoreItem) => void>();

    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(Comp, {
            factions: SAMPLE_FACTIONS,
            pendingLore: SAMPLE_PENDING_LORE,
            onAdoptLore,
          }),
      }),
    );

    expect(html).toContain('data-testid="pda-staging-gate"');
    expect(html).toContain('待核准: 2');
    expect(html).toContain('[势力]');
    expect(html).toContain('铁幕重工残部');
    expect(html).toContain('[科技]');
    expect(html).toContain('纳米相位镀层');
    expect(html).toContain('收录入档');
    expect(html.match(/data-testid="pda-lore-adopt-btn"/g)?.length).toBe(2);

    // 验证点击“采纳落地”触发回调
    const SetupComp = Comp as Component & {
      setup?: (props: Record<string, unknown>, ctx: { expose: (exp: unknown) => void; emit: () => void }) => unknown;
    };
    let exposed: {
      visiblePendingLore: { value: NormalizedPendingLoreItem[] };
      onAdoptLoreItem: (item: NormalizedPendingLoreItem) => void;
    } | null = null;
    SetupComp.setup?.(
      {
        factions: SAMPLE_FACTIONS,
        pendingLore: SAMPLE_PENDING_LORE,
        memo: '',
        onAdoptLore,
      },
      {
        expose: exp => {
          exposed = exp as typeof exposed;
        },
        emit: () => {},
      },
    );
    expect(exposed).not.toBeNull();
    const firstItem = exposed!.visiblePendingLore.value[0];
    exposed!.onAdoptLoreItem(firstItem);
    expect(onAdoptLore).toHaveBeenCalledTimes(1);
    expect(onAdoptLore).toHaveBeenCalledWith(expect.objectContaining({ id: 'lore_铁幕重工残部', name: '铁幕重工残部' }));
    expect(exposed!.visiblePendingLore.value.length).toBe(1);
  });

  it('战区势力态势简表与好感/敌对关系条、指挥官速记备忘录渲染', async () => {
    const Comp = await loadTabIntel();
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(Comp, {
            factions: SAMPLE_FACTIONS,
            pendingLore: SAMPLE_PENDING_LORE,
            memo: '重点盯防第三工业区东侧排污口',
          }),
      }),
    );

    // 势力名称、态度与关系条
    expect(html).toContain('自由商人联合会');
    expect(html).toContain('友善');
    expect(html).toContain('width:85%');
    expect(html).toContain('极光生物科技');
    expect(html).toContain('敌意');
    expect(html).toContain('width:15%');
    expect(html).toContain('data-testid="pda-faction-relation-bar"');

    // 指挥官速记备忘录
    expect(html).toContain('data-testid="pda-intel-memo-section"');
    expect(html).toContain('data-testid="pda-intel-memo-input"');
    expect(html).toContain('重点盯防第三工业区东侧排污口');
  });
});

describe('PdaWindowFrame 四联页签装配、PdaTabQuests 与 ConsoleTopNav 召回联动 (PDA-QUEST-NAV-01)', () => {
  const SAMPLE_QUESTS = {
    active: [
      {
        name: '夺取第三矿区中继站',
        progress: '推进中 65%',
        note: '需防备铁幕装甲巡逻队侧翼反扑',
        detail: '任务目标：拔除东侧哨塔并架设前线雷达；任务奖励：+1200 CR',
      },
      {
        name: '护送高纯矿石精炼车队',
        progress: '待出发',
        note: '已指派多功能步兵车随行护卫',
        detail: '',
      },
    ],
    done_count: 5,
  };

  it('PdaTabQuests 读取根级 snapshot.quests.active 与 done_count，渲染在途任务卡片与战术备忘录输入框', async () => {
    const QuestsComp = await loadTabQuests();
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(QuestsComp, {
            snapshot: {
              quests: SAMPLE_QUESTS,
            },
            memo: '优先保障北坡精炼厂防空火力',
          }),
      }),
    );

    expect(html).toContain('data-test="pda-tab-quests"');
    expect(html).toContain('在途: 2');
    expect(html).toContain('已达成: 5');
    expect(html).toContain('夺取第三矿区中继站');
    expect(html).toContain('推进中 65%');
    expect(html).toContain('需防备铁幕装甲巡逻队侧翼反扑');
    expect(html).toContain('护送高纯矿石精炼车队');
    expect(html.match(/data-test="pda-quest-card"/g)?.length).toBe(2);
    expect(html).toContain('data-test="pda-quests-memo-input"');
    expect(html).toContain('优先保障北坡精炼厂防空火力');
  });

  it('顶栏下方渲染 [ 战况动态 | 资金链网 | 战区情报 | 作战任务 ] 四联页签条，并随 shell.state.activeTab 切换对应面板', async () => {
    const FrameComp = await loadWindowFrame();
    const shell = createTestShell();

    const mockSnapshot = {
      events: SAMPLE_EVENTS,
      economy: { credits: 3000, credits_daily: 600, wallet: {}, chains: SAMPLE_CHAINS },
      factions: SAMPLE_FACTIONS,
      pending_lore: SAMPLE_PENDING_LORE,
      quests: SAMPLE_QUESTS,
    };

    // 1. 默认 activeTab === 'events' -> 渲染 PdaTabEvents
    expect(shell.state.activeTab).toBe('events');
    const eventsTabHtml = await renderToString(
      createSSRApp({
        render: () => h(FrameComp, { shell, snapshot: mockSnapshot }),
      }),
    );
    expect(eventsTabHtml).toContain('战况动态');
    expect(eventsTabHtml).toContain('资金链网');
    expect(eventsTabHtml).toContain('战区情报');
    expect(eventsTabHtml).toContain('作战任务');
    expect(eventsTabHtml).toContain('data-short-label="任务"');
    expect(eventsTabHtml).toContain('data-active-tab="events"');
    expect(eventsTabHtml).toContain('data-testid="pda-tab-events"');
    expect(eventsTabHtml).toContain('主反应堆过载 · 精炼厂断电停产');

    // 2. 切换至 'chains' -> 渲染 PdaTabChains
    shell.setActiveTab('chains');
    expect(shell.state.activeTab).toBe('chains');
    const chainsTabHtml = await renderToString(
      createSSRApp({
        render: () => h(FrameComp, { shell, snapshot: mockSnapshot }),
      }),
    );
    expect(chainsTabHtml).toContain('data-active-tab="chains"');
    expect(chainsTabHtml).toContain('data-testid="pda-tab-chains"');
    expect(chainsTabHtml).toContain('+600 CR/DAY');
    expect(chainsTabHtml).toContain('青岚山原矿直销通道');

    // 3. 切换至 'intel' -> 渲染 PdaTabIntel
    shell.setActiveTab('intel');
    expect(shell.state.activeTab).toBe('intel');
    const intelTabHtml = await renderToString(
      createSSRApp({
        render: () => h(FrameComp, { shell, snapshot: mockSnapshot }),
      }),
    );
    expect(intelTabHtml).toContain('data-active-tab="intel"');
    expect(intelTabHtml).toContain('data-testid="pda-tab-intel"');
    expect(intelTabHtml).toContain('铁幕重工残部');
    expect(intelTabHtml).toContain('自由商人联合会');

    // 4. 切换至 'quests' -> 渲染 PdaTabQuests
    shell.setActiveTab('quests');
    expect(shell.state.activeTab).toBe('quests');
    const questsTabHtml = await renderToString(
      createSSRApp({
        render: () => h(FrameComp, { shell, snapshot: mockSnapshot }),
      }),
    );
    expect(questsTabHtml).toContain('data-active-tab="quests"');
    expect(questsTabHtml).toContain('data-testid="pda-tab-quests"');
    expect(questsTabHtml).toContain('夺取第三矿区中继站');
    expect(questsTabHtml).toContain('已达成: 5');

    shell.destroy();
  });

  it('ConsoleTopNav 顶栏渲染 [ 📱 PDA ] 召回按钮 (data-test="topnav-pda-recall")，点击触发 recallPdaToCenter 置中并展开', async () => {
    const TopNavComp = await loadTopNav();
    const shell = createPdaShell({
      storage: null,
      viewport: () => VIEWPORT_DESKTOP,
    });
    // 初始为收纳且隐藏在边角
    shell.setCollapsed(true);
    shell.setHidden(true);
    shell.setPosition({ x: 12, y: 12 });

    const navHtml = await renderToString(
      createSSRApp({
        render: () =>
          h(TopNavComp, {
            floorId: 12,
            busy: false,
            activeModal: null,
            pdaShell: shell,
          }),
      }),
    );

    expect(navHtml).toContain('data-test="topnav-pda-recall"');
    expect(navHtml).toContain('📱');
    expect(navHtml).toContain('PDA');

    const onRecall = vi.fn();
    const SetupComp = TopNavComp as Component & {
      setup?: (
        props: Record<string, unknown>,
        ctx: { expose: (exp: unknown) => void; emit: (e: string) => void },
      ) => unknown;
    };
    let exposed: { onRecallPda: () => void } | null = null;
    SetupComp.setup?.(
      {
        floorId: 12,
        busy: false,
        activeModal: null,
        pdaShell: shell,
      },
      {
        expose: exp => {
          exposed = exp as typeof exposed;
        },
        emit: ev => {
          if (ev === 'recall-pda') onRecall();
        },
      },
    );

    expect(exposed).not.toBeNull();
    exposed!.onRecallPda();

    expect(onRecall).toHaveBeenCalledTimes(1);
    expect(shell.state.collapsed).toBe(false);
    expect(shell.state.mode).toBe('expanded');
    expect(shell.state.hidden).toBe(false);
    expect(shell.state.x).toBe(Math.round((VIEWPORT_DESKTOP.width - 320) / 2));
    expect(shell.state.y).toBe(Math.round((VIEWPORT_DESKTOP.height - 440) / 2));

    shell.destroy();
  });
});
