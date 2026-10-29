/**
 * ModalResources.test.ts —— CTRL-UI-RES-01 接线回归 + FD-21 Track D (DARKNET-UI-01) 双页签与跨维暗网终端单测
 *
 * 手法与 ModalSchedule.test.ts / ModalEngineering.test.ts 同构（零新增依赖、零新增抽象层）：
 * - vitest 管道无 .vue 插件，测试内用 vue/compiler-sfc 即时编译 SFC 为临时 ESM 模块
 *  （inlineTemplate 内联 render），vue/server-renderer renderToString 挂载；
 *   临时模块写在组件旁，afterAll 即清除；
 * - Icon.vue 与 fillHostSendInput 经 vi.mock 打桩。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读写临时编译产物，不进 bundle */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component, type Ref } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { Schema } from '../../红警指挥系统/core/schema';
import {
  buildDarknetOrderPrompt,
  RESOURCE_COPY,
  resourcePanelModel,
  type EconomyWithDarknetLike,
} from '../models/resourcePanelModel';

const hostSendStub = vi.hoisted(() => ({
  fill: vi.fn((_text: string) => 'textarea' as const),
}));

vi.mock('../../红警指挥系统/worldbook/hostSendInput', () => ({
  fillHostSendInput: hostSendStub.fill,
}));

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', render: () => hh('span') } };
});

/* ═══════════════ SFC 即时编译（临时模块：组件旁写入，套件末清除） ═══════════════ */

const SFC_PATH = join(__dirname, '../modals/ModalResources.vue');
// 临时模块取 .mts：vite 走 TS 变换剥除类型标注；FloatingApp.test.ts 扫描正则为 /\.(ts|vue)$/，.mts 不被误拾
const COMPILED_PATH = join(__dirname, '../modals/ModalResources.__ssr__.mts');

let componentPromise: Promise<Component> | undefined;

function loadComponent(): Promise<Component> {
  componentPromise ??= (async () => {
    const source = readFileSync(SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'ModalResources.vue' });
    if (errors.length > 0) throw new Error(`ModalResources.vue 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id: 'modalresourcesssr',
      inlineTemplate: true,
      templateOptions: { id: 'modalresourcesssr', scoped: descriptor.styles.some(s => s.scoped) },
    });
    const js = compiled.content.replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '');
    writeFileSync(COMPILED_PATH, js, 'utf8');
    const mod = (await import(pathToFileURL(COMPILED_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return componentPromise;
}

afterAll(() => {
  try {
    unlinkSync(COMPILED_PATH);
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  hostSendStub.fill.mockClear();
});

/** SSR 挂载（renderToString 静态标记，支持指定 initialTab） */
async function renderResources(
  snapshot: (Schema & { economy?: EconomyWithDarknetLike }) | null,
  initialTab: 'pillars' | 'darknet' = 'pillars',
): Promise<string> {
  const Comp = await loadComponent();
  return renderToString(
    createSSRApp({
      render: () => h(Comp, { open: true, snapshot, initialTab }),
    }),
  );
}

interface ExposedResourcesApi {
  activeTab: Ref<'pillars' | 'darknet'>;
  switchTab: (tab: 'pillars' | 'darknet') => void;
  customLootName: Ref<string>;
  lastOrderPrompt: Ref<string>;
  lastOrderFeedback: Ref<string>;
  handleBuildRelay: () => string;
  handleRefreshMarket: () => string;
  handleBuyItem: (item: { name: string; price: number }) => string;
  handleClaimBounty: (bounty: { target: string; reward_credits: number }) => string;
  handleBidAuction: (
    auction: { name: string; current_price: number; start_price: number },
    overrideBid?: number,
  ) => string;
  handleSellResource: (resourceName: string) => string;
  handleSellIntel: (intelTitle: string) => string;
  handleConsignCustom: (customName?: string) => string;
  handleSellCustomResource: (customName?: string) => string;
}

async function setupResourcesInstance(
  snapshot: (Schema & { economy?: EconomyWithDarknetLike }) | null,
  initialTab: 'pillars' | 'darknet' = 'pillars',
): Promise<ExposedResourcesApi> {
  const Comp = (await loadComponent()) as Component & {
    setup?: (
      props: Record<string, unknown>,
      ctx: { expose: (exp: unknown) => void; emit: () => void; attrs: Record<string, unknown>; slots: Record<string, unknown> },
    ) => unknown;
  };
  let exposed: ExposedResourcesApi | null = null;
  Comp.setup?.(
    { open: true, snapshot, initialTab },
    {
      expose: exp => {
        exposed = exp as ExposedResourcesApi;
      },
      emit: () => {},
      attrs: {},
      slots: {},
    },
  );
  if (!exposed) throw new Error('ModalResources defineExpose 未返回交互句柄');
  return exposed;
}

/* ═══════════════ 夹具（Schema.parse 全形状 + 暗网扩展字段） ═══════════════ */

function mkSnapshot(): Schema {
  return Schema.parse({
    economy: {
      credits: 1500,
      credits_daily: 120,
      resources: {
        nanites: { 标准纳米工料: 120, 机娘修复凝胶: 0 },
        minerals: { 铁矿石: 25, 铜矿砂: null, 紫幽玄铁: 100 },
        munitions: { 步兵制式弹药: 4000 },
      },
    },
  });
}

function mkDarknetSnapshot(unlockedByRelay = true): Schema & { economy: EconomyWithDarknetLike } {
  const base = Schema.parse({
    bases: [
      {
        id: 'base_alpha',
        name: '北坡一号主基地',
        status: '运转中',
        buildings: unlockedByRelay
          ? [
              { name: '盟军建造厂', state: '运转' },
              { name: '超维暗网中继站', state: '运转' },
            ]
          : [{ name: '盟军建造厂', state: '运转' }],
      },
    ],
    intel: [
      {
        src: '电子监听',
        content: '铁幕重工残部在黑石峡谷秘密转运浓缩铀燃料棒',
        cred: '高',
      },
    ],
    economy: {
      credits: 4800,
      credits_daily: 650,
      resources: {
        nanites: { 标准纳米工料: 120, 机娘修复凝胶: 0 },
        minerals: { 铁矿石: 40, 紫幽玄铁: 85 },
        munitions: { 步兵制式弹药: 3000 },
      },
    },
  }) as Schema & { economy: EconomyWithDarknetLike };

  base.economy.channel_daily = {
    refining: 300,
    recycling: 80,
    petrochemical: 120,
    chains: 150,
    total: 650,
  };

  if (unlockedByRelay) {
    base.economy.darknet = {
      market_status: '正常连接',
      auction_status: 'bidding',
      next_auction_in_minutes: 10080,
      items: [
        {
          id: 'item_nanite_pack',
          name: '军规高纯纳米原液箱',
          category: '纳米工业',
          price: 600,
          stock: 3,
          desc: '跨维走私标准纳米补充包，可直接注入基地纳米池。',
          resource_map: { pillar: 'nanites', key: '标准纳米工料', qty: 50 },
        },
      ],
      bounties: [
        {
          id: 'bounty_purple_iron',
          target: '紫幽玄铁 ×30',
          category: '异界稀有矿藏',
          reward_credits: 1200,
          status: 'open',
          deadline_text: '剩余 48h',
          desc: '星界铸造师急需玄铁矿样，高溢价现结。',
        },
      ],
      auctions: [
        {
          id: 'auc_chrono_core',
          name: '原型超时空谐振晶核',
          seller: '第7象限流亡科学院',
          start_price: 1500,
          current_price: 2200,
          leader: '废土军阀·黑曜',
          round_text: '第 2/3 轮竞价',
          status: 'bidding',
          desc: '可用于高阶超时空工程与特种载具改装的孤品核心。',
        },
      ],
      sold_intel_ids: ['intel_old_01', 'intel_old_02'],
      ledger: [
        {
          id: 'led_01',
          action: '悬赏交割',
          target: '灵沁原油样本',
          credits_delta: 950,
          note: '跨维炼金行会验收通过',
          at_day: 12,
        },
        {
          id: 'led_02',
          action: '黑市直购',
          target: '高强工程钢材批次',
          credits_delta: -400,
          note: '传质舱已入库',
          at_day: 11,
        },
      ],
    };
  }

  return base;
}

/* ═══════════════ ① SSR 挂载接线直证（存量六柱库存页签 100% 兼容） ═══════════════ */

describe('接线回归 · ModalResources snapshot.economy 直传（SSR 挂载）', () => {
  it('默认激活「📦 战备物资库」页签，同时渲染「🕶️ 跨维暗网终端」二级页签切换钮', async () => {
    const html = await renderResources(mkSnapshot());
    expect(html).toContain('data-test="tab-pillars"');
    expect(html).toContain('📦 战备物资库');
    expect(html).toContain('data-test="tab-darknet"');
    expect(html).toContain('🕶️ 跨维暗网终端');
  });

  it('资金条渲染：战备资金现值与每日净收支（schema 注释标签同源）', async () => {
    const html = await renderResources(mkSnapshot());
    expect(html).toContain('战备资金');
    expect(html).toContain('1500');
    expect(html).toContain('每日净收支');
    expect(html).toContain('+120');
  });

  it('六柱渲染：柱名同源 schema 注释＋数据键直呈', async () => {
    const html = await renderResources(mkSnapshot());
    for (const name of [
      '纳米机械储备',
      '矿产与金属',
      '常规建材与化工品',
      '燃油与能源介质',
      '军械与弹药',
      '维生与后勤给养',
    ]) {
      expect(html).toContain(name);
    }
    for (const key of ['nanites', 'minerals', 'materials', 'fuel', 'munitions', 'logistics']) {
      expect(html).toContain(key);
    }
  });

  it('三态呈现接线直证：null 横杠「未解锁」/ 0「告罄」/ >0 数值与动态键直呈', async () => {
    const html = await renderResources(mkSnapshot());
    expect(html).toContain('机娘修复凝胶'); // 0 告罄
    expect(html).toContain('告罄');
    expect(html).toContain('铜矿砂'); // null 未解锁
    expect(html).toContain('未解锁');
    expect(html).toContain('紫幽玄铁'); // 动态键直呈
    expect(html).toContain('4000'); // >0 数值直呈
    expect(html).toContain('—');
  });

  it('流水摘要降级说明在场（既无 darknet.ledger 也无非零 channel_daily 时保持原 note）', async () => {
    const html = await renderResources(mkSnapshot());
    expect(html).toContain(RESOURCE_COPY.ledgerNote);
  });

  it('snapshot=null 兜底：不抛错，渲染未探明降级文案', async () => {
    const html = await renderResources(null);
    expect(html).toContain(RESOURCE_COPY.unsurveyedText);
  });

  it('战备指标与快筛条渲染：实物流转/库存告罄指标在场，分类药丸与状态快筛在场', async () => {
    const html = await renderResources(mkSnapshot());
    expect(html).toContain('实物流转:');
    expect(html).toContain('库存告罄:');
    expect(html).toContain('仅看告罄 (1)');
    expect(html).toContain('仅看流转 (4)');
    expect(html).toContain('全部类别');
    expect(html).toContain('收起全部类别');
  });

  it('双列卡片看板与折叠无障碍契约：柱头折叠钮携带 aria-expanded', async () => {
    const html = await renderResources(mkSnapshot());
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('res-pillar-card');
  });
});

/* ═══════════════ ② Track D · DARKNET-UI-01 跨维暗网终端与分渠道日流测试 ═══════════════ */

describe('DARKNET-UI-01 · 跨维暗网终端页签、锁定引导与五大区块挂载', () => {
  it('顶栏多元资金日流芯片组：channelDaily.total > 0 时展示「精炼 +X | 回收 +Y | 油化 +Z | 商路 +W」', async () => {
    const snap = mkDarknetSnapshot(true);
    const html = await renderResources(snap, 'pillars');
    expect(html).toContain('data-test="channel-daily-chips"');
    expect(html).toContain('精炼 +300 | 回收 +80 | 油化 +120 | 商路 +150');
    expect(html).toContain('🔥 拍卖中');
  });

  it('切换到「🕶️ 跨维暗网终端」页签：未建【超维暗网中继站】且无暗网数据时显示红警战术锁定引导横幅', async () => {
    const lockedSnap = mkDarknetSnapshot(false);
    const html = await renderResources(lockedSnap, 'darknet');
    expect(html).toContain('data-test="darknet-locked-banner"');
    expect(html).toContain('【超维暗网中继站】');
    expect(html).toContain('造价 1,200 资金 · 耗电 30 · 前置发电厂');
    expect(html).toContain('🛠️ 填入建造超维暗网中继站指令');
    expect(html).toContain('📡 刷新暗网行情');
  });

  it('建成【超维暗网中继站】或有暗网数据后：隐藏锁定横幅，完整渲染投递台/直购货架/求购悬赏/拍卖厅/交割流水', async () => {
    const unlockedSnap = mkDarknetSnapshot(true);
    const html = await renderResources(unlockedSnap, 'darknet');

    // 已解锁：不渲染锁定横幅
    expect(html).not.toContain('data-test="darknet-locked-banner"');
    expect(html).toContain('信道: 正常连接');

    // A. 快速实物与情报投递台（含 >0 流转六柱物资与在册情报）
    expect(html).toContain('data-test="darknet-section-delivery"');
    expect(html).toContain('标准纳米工料');
    expect(html).toContain('铁幕重工残部在黑石峡谷秘密转运浓缩铀燃料棒');
    expect(html).toContain('投递变现');
    expect(html).toContain('委托送拍');
    expect(html).toContain('投递出售');

    // B. 当期黑市直购货架
    expect(html).toContain('data-test="darknet-section-market"');
    expect(html).toContain('军规高纯纳米原液箱');
    expect(html).toContain('600 资金');
    expect(html).toContain('库存 3');
    expect(html).toContain('填入采购令');

    // C. 跨维高价求购悬赏
    expect(html).toContain('data-test="darknet-section-bounties"');
    expect(html).toContain('紫幽玄铁 ×30');
    expect(html).toContain('+1200 资金');
    expect(html).toContain('剩余 48h');
    expect(html).toContain('交割领赏');

    // D. 超维暗网拍卖厅
    expect(html).toContain('data-test="darknet-section-auctions"');
    expect(html).toContain('🔥 专场拍卖竞价中');
    expect(html).toContain('原型超时空谐振晶核');
    expect(html).toContain('卖方: 第7象限流亡科学院');
    expect(html).toContain('起拍价: 1500');
    expect(html).toContain('当前最高价: 2200');
    expect(html).toContain('领先方: 废土军阀·黑曜');
    expect(html).toContain('第 2/3 轮竞价');
    expect(html).toContain('跟牌加价');

    // E. 最近交割流水账本
    expect(html).toContain('data-test="darknet-section-ledger"');
    expect(html).toContain('悬赏交割');
    expect(html).toContain('灵沁原油样本');
    expect(html).toContain('+950');
    expect(html).toContain('黑市直购');
    expect(html).toContain('-400');
  });

  it('快捷操作按钮交互：选购填框 / 交割领赏 / 跟牌加价 / 投递变现 / 委托送拍 正确生成 <暗网> 指令并调用 fillHostSendInput', async () => {
    const snap = mkDarknetSnapshot(true);
    const api = await setupResourcesInstance(snap, 'pillars');

    // 切换页签至暗网终端
    expect(api.activeTab.value).toBe('pillars');
    api.switchTab('darknet');
    expect(api.activeTab.value).toBe('darknet');

    // 1. 点击 [选购填框]
    const buyPrompt = api.handleBuyItem({ name: '军规高纯纳米原液箱', price: 600 });
    expect(buyPrompt).toBe(
      '【超维暗网指令】通过超维暗网中继站选购在售标的「军规高纯纳米原液箱」，请推进交割并在文末输出 <暗网> 更新库存与资金。',
    );
    expect(hostSendStub.fill).toHaveBeenLastCalledWith(buyPrompt);
    expect(api.lastOrderPrompt.value).toBe(buyPrompt);
    expect(api.lastOrderFeedback.value).toContain('已填入酒馆聊天框');

    // 2. 点击 [交割领赏]
    const bountyPrompt = api.handleClaimBounty({ target: '紫幽玄铁 ×30', reward_credits: 1200 });
    expect(bountyPrompt).toBe(
      '【超维暗网指令】向超维暗网提交求购悬赏「紫幽玄铁 ×30」所需标的完成交割，请结算悬赏金并在文末输出 <暗网>。',
    );
    expect(hostSendStub.fill).toHaveBeenLastCalledWith(bountyPrompt);

    // 3. 点击 [跟牌加价]
    const bidPrompt = api.handleBidAuction(
      { name: '原型超时空谐振晶核', start_price: 1500, current_price: 2200 },
      2500,
    );
    expect(bidPrompt).toBe(
      '【超维暗网指令】进入超维暗网拍卖厅，针对拍品「原型超时空谐振晶核」跟牌加价（目标出价：2500 系统资金），请描写竞拍博弈并在文末输出 <暗网> 更新拍卖状态。',
    );
    expect(hostSendStub.fill).toHaveBeenLastCalledWith(bidPrompt);

    // 4. 点击实物物资 [投递变现]
    const sellResPrompt = api.handleSellResource('标准纳米工料');
    expect(sellResPrompt).toBe(
      '【超维暗网指令】将基地库存中的「标准纳米工料」投入超维暗网中继站传质舱变现，请估算系统资金并在文末输出 <暗网> 本轮交割。',
    );
    expect(hostSendStub.fill).toHaveBeenLastCalledWith(sellResPrompt);

    // 5. 点击情报 [投递变现]
    const sellIntelPrompt = api.handleSellIntel('电子监听：铁幕重工残部在黑石峡谷秘密转运浓缩铀燃料棒');
    expect(sellIntelPrompt).toBe(
      '【超维暗网指令】通过超维暗网中继站量子信道上传情报/数据「电子监听：铁幕重工残部在黑石峡谷秘密转运浓缩铀燃料棒」换取系统资金，请核验首发唯一性并在文末输出 <暗网> 本轮交割。',
    );
    expect(hostSendStub.fill).toHaveBeenLastCalledWith(sellIntelPrompt);

    // 6. 自定义战利品 [委托送拍]
    api.customLootName.value = '苏军铁幕发生器残骸';
    const consignPrompt = api.handleConsignCustom();
    expect(consignPrompt).toBe(
      '【超维暗网指令】将我方高价值标的「苏军铁幕发生器残骸」委托送拍至超维暗网拍卖所，请安排跨维买主竞价并在文末输出 <暗网>。',
    );
    expect(hostSendStub.fill).toHaveBeenLastCalledWith(consignPrompt);

    // 7. 锁定态点击 [🛠️ 填入建造超维暗网中继站指令]
    const buildRelayPrompt = api.handleBuildRelay();
    expect(buildRelayPrompt).toContain('超维暗网中继站');
    expect(hostSendStub.fill).toHaveBeenLastCalledWith(buildRelayPrompt);
  });

  it('resourcePanelModel 纯函数：channelBreakdown 四渠道拆解、暗网解锁判定与 buildDarknetOrderPrompt 六类指令完备', () => {
    const snap = mkDarknetSnapshot(true);
    const m = resourcePanelModel(snap.economy, { bases: snap.bases });

    expect(m.darknet.unlocked).toBe(true);
    expect(m.darknet.relayBuildingPresent).toBe(true);
    expect(m.darknet.auctionStatus).toBe('bidding');
    expect(m.darknet.auctionBadgeText).toBe('🔥 专场拍卖竞价中');
    expect(m.darknet.soldIntelCount).toBe(2);

    expect(m.ledger.available).toBe(true);
    expect(m.ledger.channelBreakdown.map(c => c.label)).toEqual([
      '矿石精炼',
      '废料回收',
      '油田炼化',
      '贸易收支',
    ]);
    expect(m.ledger.recentLedger.length).toBe(2);

    // 休拍态倒计时徽标验证（10080 分钟 = 7日0h）
    const closedModel = resourcePanelModel({
      darknet: { auction_status: 'closed', next_auction_in_minutes: 10080 },
    });
    expect(closedModel.darknet.unlocked).toBe(false);
    expect(closedModel.darknet.marketStatusText).toBe('待建超维暗网中继站');
    expect(closedModel.darknet.auctionBadgeText).toBe('⏳ 距下次开启 7日0h');

    // 六类指令纯函数抽验
    expect(buildDarknetOrderPrompt({ kind: 'buy', targetName: '脉冲电池' })).toContain('<暗网>');
    expect(buildDarknetOrderPrompt({ kind: 'sell_resource', targetName: '铁矿石' })).toContain('<暗网>');
    expect(buildDarknetOrderPrompt({ kind: 'sell_intel', targetName: '北境布防图' })).toContain('<暗网>');
    expect(buildDarknetOrderPrompt({ kind: 'bounty', targetName: '高纯钛合金' })).toContain('<暗网>');
    expect(buildDarknetOrderPrompt({ kind: 'bid', targetName: '天启蓝图', priceOrQty: 3000 })).toContain('3000 系统资金');
    expect(buildDarknetOrderPrompt({ kind: 'consign', targetName: '古神核心' })).toContain('<暗网>');
  });
});

/* ═══════════════ ③ 静态契约（接线源码钉死，双保险） ═══════════════ */

describe('静态契约 · ModalResources.vue 接线钉死', () => {
  const src = readFileSync(SFC_PATH, 'utf8');

  it('computed 直传 props.snapshot?.economy ?? {}：零 .stat_data 层级、零断言', () => {
    expect(src).toContain('resourcePanelModel(props.snapshot?.economy ?? {})');
    expect(src).not.toContain('.stat_data');
    expect(src).not.toContain('as never');
  });

  it('高密度交互接线钉死：支持双页签切换、柱域快筛、状态过滤、卡片折叠与暗网填框', () => {
    expect(src).toContain('activeTab');
    expect(src).toContain('activePillarKey');
    expect(src).toContain('statusFilter');
    expect(src).toContain('collapsedPillars');
    expect(src).toContain('togglePillar');
    expect(src).toContain('toggleCollapseAll');
    expect(src).toContain('fillHostSendInput');
    expect(src).toContain('buildDarknetOrderPrompt');
  });
});
