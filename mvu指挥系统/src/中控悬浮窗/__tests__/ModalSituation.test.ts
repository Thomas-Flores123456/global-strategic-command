/**
 * ModalSituation.test.ts —— FD-55 (PKG-C) 态势总控面板数据模型与双页签弹窗单测
 *
 * 覆盖：
 * 1. 未破冰「无人在意」基线态、破冰条件提示与五阶刻度尺默认态；
 * 2. 已破冰五阶刻度尺高亮、正向资金链民心乘数折算日增减收、暴露漂移与危机阈值；
 * 3. 驻地 8 类民生与环保公共设施盘点、民间眼线解锁、主电网赤字断供高危预警与待建推荐；
 * 4. 分基地辖区民心（含独立覆写 vs 全局回退）与地方势力态度及关联商路对照；
 * 5. 暴露等级 EL-0~EL-4 标尺、各基地常驻暴露底线物理成因拆解与平静轮次净漂移核算；
 * 6. ModalSituation.vue 双页签切换、前往建造跳转事件、快捷指令填入/复制反馈及 Oblivion 样式门禁合规。
 */

/* eslint-disable import-x/no-nodejs-modules -- 测试即时编译 SFC 临时产物 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { buildSituationPanelModel } from '../models/situationPanelModel';

const mockHostSendFill = vi.fn(() => 'dom');

vi.mock('../../红警指挥系统/worldbook/hostSendInput', () => ({
  fillHostSendInput: (text: string) => mockHostSendFill(text),
}));

vi.mock('../../红警指挥系统/composables/store', () => ({
  in_tavern: false,
  useDataStore: () => ({ stat: {} }),
}));

vi.mock('../../红警指挥系统/composables/useFloatingStore', () => ({
  useFloatingStore: () => ({ snapshot: null }),
}));

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', props: ['name', 'size'], render: () => hh('span') } };
});

const DIR = join(__dirname, '..');
const MODAL_SFC_PATH = join(DIR, 'modals/ModalSituation.vue');
const MODAL_COMPILED_PATH = join(DIR, 'modals/ModalSituation.__fd55_situation__.mts');
const MODEL_PATH = join(DIR, 'models/situationPanelModel.ts');

function stripTypeImports(code: string): string {
  return code
    .replace(/^import\s+type\s[\s\S]*?from\s+['"][^'"]+['"];?[\t ]*$/gm, '')
    .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
}

let modalCompPromise: Promise<Component> | undefined;

function loadModalSituation(): Promise<Component> {
  modalCompPromise ??= (async () => {
    const source = readFileSync(MODAL_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: MODAL_SFC_PATH });
    if (errors.length > 0) {
      throw new Error(`${MODAL_SFC_PATH} 解析失败：${errors.map(String).join('; ')}`);
    }
    const compiled = compileScript(descriptor, {
      id: 'modalsituationfd55',
      inlineTemplate: true,
      templateOptions: {
        id: 'modalsituationfd55',
        scoped: descriptor.styles.some(s => s.scoped),
      },
    });
    writeFileSync(MODAL_COMPILED_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
    const mod = (await import(pathToFileURL(MODAL_COMPILED_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return modalCompPromise;
}

afterAll(() => {
  try {
    unlinkSync(MODAL_COMPILED_PATH);
  } catch {
    /* ignore */
  }
});

interface VElement {
  kind: 'element';
  tag: string;
  attrs: Record<string, string>;
  listeners: Record<string, (...args: unknown[]) => void>;
  children: VNodeItem[];
  parent: VElement | null;
}
interface VText {
  kind: 'text';
  text: string;
  parent: VElement | null;
}
type VNodeItem = VElement | VText;

function makeElement(tag: string): VElement {
  return { kind: 'element', tag, attrs: {}, listeners: {}, children: [], parent: null };
}

function getText(node: VNodeItem): string {
  if (node.kind === 'text') return node.text;
  return node.children.map(getText).join('');
}

function findByDataTest(root: VElement, dataTest: string): VElement | undefined {
  let found: VElement | undefined;
  const walk = (el: VElement) => {
    if (found) return;
    if (el.attrs['data-test'] === dataTest || el.attrs['data-testid'] === dataTest) {
      found = el;
      return;
    }
    for (const c of el.children) {
      if (c.kind === 'element') walk(c);
    }
  };
  walk(root);
  return found;
}

function findAllByDataTest(root: VElement, dataTest: string): VElement[] {
  const list: VElement[] = [];
  const walk = (el: VElement) => {
    if (el.attrs['data-test'] === dataTest || el.attrs['data-testid'] === dataTest) {
      list.push(el);
    }
    for (const c of el.children) {
      if (c.kind === 'element') walk(c);
    }
  };
  walk(root);
  return list;
}

function mountModal(Comp: Component, props: Record<string, unknown> = {}) {
  const renderer = createRenderer<VNodeItem, VElement>({
    createElement: tag => makeElement(tag),
    createText: text => ({ kind: 'text', text, parent: null }),
    createComment: text => ({ kind: 'text', text: `<!--${text}-->`, parent: null }),
    setText: (node, text) => {
      if (node.kind === 'text') node.text = text;
    },
    setElementText: (el, text) => {
      el.children = [{ kind: 'text', text, parent: el }];
    },
    insert: (child, parent, anchor) => {
      child.parent = parent;
      const idx = anchor ? parent.children.indexOf(anchor) : -1;
      if (idx >= 0) parent.children.splice(idx, 0, child);
      else parent.children.push(child);
    },
    remove: child => {
      if (!child.parent) return;
      const idx = child.parent.children.indexOf(child);
      if (idx >= 0) child.parent.children.splice(idx, 1);
      child.parent = null;
    },
    parentNode: node => node.parent,
    nextSibling: node => {
      if (!node.parent) return null;
      const idx = node.parent.children.indexOf(node);
      return node.parent.children[idx + 1] ?? null;
    },
    patchProp: (el, key, _prev, next) => {
      if (key.startsWith('on') && key.length > 2) {
        if (typeof next === 'function') {
          el.listeners[key] = next as (...args: unknown[]) => void;
        } else {
          delete el.listeners[key];
        }
        return;
      }
      if (next === null || next === undefined || next === false) {
        delete el.attrs[key];
      } else {
        el.attrs[key] = String(next);
      }
    },
  });

  const root = makeElement('div');
  const app = renderer.createApp({
    render: () => h(Comp, props),
  });
  app.mount(root);
  return { root, app };
}

describe('FD-55 PKG-C · buildSituationPanelModel 与 ModalSituation 双页签弹窗单测', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockHostSendFill.mockClear();
  });

  it('1. 未破冰基线态：默认处于第 0 态「无人在意」，资金链乘数 1.0，五阶刻度尺全未激活并提示破冰条件', () => {
    const vm = buildSituationPanelModel({});
    expect(vm.moraleTab.header.engaged).toBe(false);
    expect(vm.moraleTab.header.stage).toBe('无人在意');
    expect(vm.moraleTab.header.trendText).toBe('隐蔽潜伏');
    expect(vm.moraleTab.header.nextStageHint).toContain('4.5（EL-2 战区警觉）');
    expect(vm.moraleTab.stageLadder).toHaveLength(5);
    expect(vm.moraleTab.stageLadder.every(item => !item.active)).toBe(true);
    expect(vm.moraleTab.activeEffects.chainMultiplier).toBe(1.0);
    expect(vm.moraleTab.activeEffects.moraleDailyCreditsDelta).toBe(0);
    expect(vm.moraleTab.activeEffects.informantChannelUnlocked).toBe(false);
    expect(vm.moraleTab.activeEffects.crisisQuestTriggered).toBe(false);
  });

  it('2. 已破冰五阶刻度尺与跨系统算力板：准确核算正向资金链民心增减收、暴露联动漂移与 <4.2 危机阈值', () => {
    const vmGood = buildSituationPanelModel({
      morale: {
        value: 7.4,
        engaged: true,
        trend: '上升',
        last_change: '净水站通水惠及周边聚落',
      },
      economy: {
        chains: [
          { id: 'c1', name: '北坡矿砂商路', flow: '收入', rate_daily: 1200, status: 'active', eff: 1 },
          { id: 'c2', name: '前哨军费支出', flow: '支出', rate_daily: 300, status: 'active', eff: 1 },
        ],
      },
    });

    expect(vmGood.moraleTab.header.engaged).toBe(true);
    expect(vmGood.moraleTab.header.stage).toBe('安居归心');
    expect(vmGood.moraleTab.header.trendText).toBe('▲ 上升');
    expect(vmGood.moraleTab.stageLadder.find(s => s.stage === '安居归心')?.active).toBe(true);
    expect(vmGood.moraleTab.activeEffects.chainMultiplier).toBe(1.1);
    expect(vmGood.moraleTab.activeEffects.baseDailyPositiveCredits).toBe(1200);
    expect(vmGood.moraleTab.activeEffects.moraleDailyCreditsDelta).toBe(120);
    expect(vmGood.moraleTab.activeEffects.moraleDailyCreditsDeltaText).toBe('+120 / 日');
    expect(vmGood.moraleTab.activeEffects.exposureDriftPerTurn).toBe(-0.08);
    expect(vmGood.moraleTab.activeEffects.informantChannelUnlocked).toBe(true);
    expect(vmGood.moraleTab.activeEffects.crisisQuestTriggered).toBe(false);

    // 沸反盈天危机态 (1.5)
    const vmCrisis = buildSituationPanelModel({
      morale: { value: 1.5, engaged: true, trend: '下降' },
      economy: {
        chains: [{ id: 'c1', name: '北坡矿砂商路', flow: '收入', rate_daily: 600, status: 'active', eff: 1 }],
      },
    });
    expect(vmCrisis.moraleTab.header.stage).toBe('沸反盈天');
    expect(vmCrisis.moraleTab.activeEffects.chainMultiplier).toBe(0.75);
    expect(vmCrisis.moraleTab.activeEffects.moraleDailyCreditsDelta).toBe(-150);
    expect(vmCrisis.moraleTab.activeEffects.moraleDailyCreditsDeltaText).toBe('-150 / 日');
    expect(vmCrisis.moraleTab.activeEffects.crisisQuestTriggered).toBe(true);
  });

  it('3. 驻地民生设施盘点与断电高危预警：识别 8 类民生设施、核算月度滋养、检测电网赤字断供并生成待建推荐', () => {
    const vm = buildSituationPanelModel({
      morale: { value: 5.2, engaged: true },
      bases: [
        {
          id: 'base_alpha',
          name: '一号主基地',
          location: '青岚山北坡',
          status: '运转中',
          power: { gen: 200, use: 150 },
          buildings: [
            { name: '基础废物分拣站', state: '运转' },
            { name: '生态公园与绿化设施', state: '运转' },
          ],
        },
        {
          id: 'base_beta',
          name: '二号前哨基地',
          location: '黑水河谷',
          status: '运转中',
          morale: 3.6,
          power: { gen: 80, use: 140 }, // 主电网赤字
          buildings: [{ name: '净水与供水站', state: '运转' }],
        },
      ],
      factions: [
        {
          name: '铁道幸存者同盟',
          attitude: '友善',
          risk: '低',
          intel: '控制北郊旧干线枢纽',
        },
      ],
      economy: {
        chains: [
          {
            id: 'chain_rail',
            name: '铁道煤炭联运线',
            flow: '收入',
            rate_daily: 500,
            status: 'active',
            deps: { faction: '铁道幸存者同盟' },
          },
        ],
      },
    });

    // 一号基地分拣站 (+0.10) + 生态公园 (+0.12) = +0.22 / 月；二号基地净水站因缺电暂停滋养且触发高危断供预警
    expect(vm.moraleTab.civicMatrix.installed).toHaveLength(3);
    expect(vm.moraleTab.civicMatrix.totalMonthlyBonus).toBe(0.22);
    expect(vm.moraleTab.civicMatrix.totalMonthlyBonusText).toBe('+0.22 / 月');
    expect(vm.moraleTab.civicMatrix.hasPowerOutageAlert).toBe(true);
    expect(vm.moraleTab.activeEffects.informantChannelUnlocked).toBe(true);

    const waterStation = vm.moraleTab.civicMatrix.installed.find(i => i.standardName === '净水与供水站')!;
    expect(waterStation.isOperational).toBe(false);
    expect(waterStation.basePowerDeficit).toBe(true);
    expect(waterStation.tone).toBe('alert');

    // 待建推荐最多 4 项，且不包含已建的净水站、分拣站、生态公园
    expect(vm.moraleTab.civicMatrix.missingRecommendations).toHaveLength(4);
    expect(vm.moraleTab.civicMatrix.missingRecommendations.map(r => r.name)).not.toContain('净水与供水站');
    expect(vm.moraleTab.civicMatrix.missingRecommendations[0].name).toBe('社区环卫服务站');

    // 分基地辖区民心与地方势力关联商路
    expect(vm.moraleTab.regionalOverview.bases).toHaveLength(2);
    expect(vm.moraleTab.regionalOverview.bases[0].isLocalOverride).toBe(false);
    expect(vm.moraleTab.regionalOverview.bases[0].localMorale).toBe(5.2);
    expect(vm.moraleTab.regionalOverview.bases[1].isLocalOverride).toBe(true);
    expect(vm.moraleTab.regionalOverview.bases[1].localMorale).toBe(3.6);
    expect(vm.moraleTab.regionalOverview.bases[1].localStage).toBe('人心惶惶');

    expect(vm.moraleTab.regionalOverview.factions).toHaveLength(1);
    expect(vm.moraleTab.regionalOverview.factions[0].linkedChains).toEqual(['铁道煤炭联运线']);
  });

  it('4. 暴露等级与常驻底线物理成因拆解：准确拆解多阵营混建、地表超武信标、伪装屏障与地形修正', () => {
    const vm = buildSituationPanelModel({
      exposure: {
        value: 5.4,
        trend: '下降',
        last_change: '夜间电磁静默降低侦察热度',
      },
      morale: {
        value: 7.0,
        engaged: true,
      },
      bases: [
        {
          id: 'b1',
          name: '北坡核心要塞',
          site_type: 'inland_canyon',
          status: '运转中',
          buildings: [
            { name: '盟军光棱塔', layer: '地表层', state: '运转' },
            { name: '苏联磁暴线圈', layer: '地表层', state: '运转' },
            { name: '天气控制机', layer: '地表层', state: '运转' },
            { name: '裂缝产生器', layer: '地表层', state: '运转' },
          ],
        },
      ],
    });

    expect(vm.exposureTab.header.code).toBe('EL-2');
    expect(vm.exposureTab.header.canonicalLabel).toBe('战区警觉（EL-2）');
    expect(vm.exposureTab.levelLadder.find(l => l.code === 'EL-2')?.active).toBe(true);

    const b0 = vm.exposureTab.floorBreakdown.bases[0];
    expect(b0.factionMixPenalty).toBe(0.4);
    expect(b0.heavyBeaconPenalty).toBe(0.6);
    expect(b0.stealthShieldOffset).toBe(-0.35);
    expect(b0.siteModifier).toBe(-0.15);
    // 0.4 + 0.6 - 0.35 - 0.15 = 0.50
    expect(b0.netBaseFloor).toBe(0.5);
    expect(vm.exposureTab.floorBreakdown.totalFloor).toBe(0.5);

    // EL-2 基础冷却 -0.03 与安居归心 -0.08 取优合成 -> -0.08
    expect(vm.exposureTab.driftSummary.baseNaturalCoolPerTurn).toBe(-0.03);
    expect(vm.exposureTab.driftSummary.moraleDriftPerTurn).toBe(-0.08);
    expect(vm.exposureTab.driftSummary.netDriftPerTurn).toBe(-0.08);
  });

  it('5. ModalSituation.vue 组件交互：支持 initialTab 定位、双页签切换、前往建造跳转与快捷指令填入反馈', async () => {
    const Comp = await loadModalSituation();
    const state = reactive({
      open: true,
      initialTab: 'exposure' as 'morale' | 'exposure',
      snapshot: {
        exposure: { value: 4.8, floor: 0.6, last_change: '外围侦察机掠过' },
        morale: { value: 6.8, engaged: true, last_change: '义诊发放净水' },
        bases: [
          {
            id: 'b1',
            name: '首尔前哨',
            location: '北郊',
            status: '运转中',
            power: { gen: 100, use: 60 },
            buildings: [{ name: '基础废物分拣站', state: '运转' }],
          },
        ],
      },
    });

    let closedCount = 0;
    const jumpedBuildings: Array<string | undefined> = [];

    const { root } = mountModal(Comp, {
      get open() {
        return state.open;
      },
      get initialTab() {
        return state.initialTab;
      },
      get snapshot() {
        return state.snapshot;
      },
      onClose: () => {
        closedCount++;
      },
      onJumpToBuild: (bName?: string) => {
        jumpedBuildings.push(bName);
      },
    });

    // 初始为 exposure 页签
    expect(findByDataTest(root, 'panel-exposure')).toBeDefined();
    expect(findByDataTest(root, 'panel-morale')).toBeUndefined();
    expect(getText(findByDataTest(root, 'exposure-header-code')!)).toContain('战区警觉（EL-2）');

    // 点击切回 morale 页签
    findByDataTest(root, 'tab-morale')!.listeners.onClick?.(new Event('click'));
    await nextTick();
    expect(findByDataTest(root, 'panel-morale')).toBeDefined();
    expect(getText(findByDataTest(root, 'morale-header-stage')!)).toBe('安居归心');

    // 点击快捷抚民指令芯片
    const chips = findAllByDataTest(root, 'quick-action-chip');
    expect(chips.length).toBeGreaterThanOrEqual(3);
    chips[0].listeners.onClick?.(new Event('click'));
    await nextTick();
    expect(mockHostSendFill).toHaveBeenCalledTimes(1);
    expect(findByDataTest(root, 'quick-action-feedback')).toBeDefined();

    // 点击待建民生短板的 [前往建造] 按钮
    const jumpBtns = findAllByDataTest(root, 'jump-build-civic-btn');
    expect(jumpBtns.length).toBeGreaterThan(0);
    jumpBtns[0].listeners.onClick?.(new Event('click'));
    expect(jumpedBuildings).toEqual(['净水与供水站']);
    expect(closedCount).toBe(1);
  });

  it('6. 门禁合规：situationPanelModel.ts 与 ModalSituation.vue 零机器黑话、零裸 hex/彩色 rgba/调色板类/Emoji', () => {
    const modelSrc = readFileSync(MODEL_PATH, 'utf8');
    const modalSrc = readFileSync(MODAL_SFC_PATH, 'utf8');
    const bannedJargon = /六柱|战略柱|协议轨道|X\s*轨|同源面板|零注入语义|stat_data/;
    const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
    const twPaletteRe =
      /\b(?:text|bg|border|ring|fill|stroke|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
    const smallFontRe =
      /text-\[(?:[0-9]|10)(?:\.\d+)?px\]|font-size:\s*(?:[0-9]|10)(?:\.\d+)?px/g;
    const emojiRe = /(?![◆◇▲▼●○▸▾★])(?:\p{Extended_Pictographic}|[\u2600-\u27BF])/gu;

    for (const [name, src] of [
      ['situationPanelModel.ts', modelSrc],
      ['ModalSituation.vue', modalSrc],
    ] as const) {
      expect(src, `${name} 含禁用黑话`).not.toMatch(bannedJargon);
      expect(src.match(hexRe) ?? [], `${name} 含裸 hex`).toEqual([]);
      expect(src.match(twPaletteRe) ?? [], `${name} 含 Tailwind 调色板类`).toEqual([]);
      expect(src.match(smallFontRe) ?? [], `${name} 含 <11px 字号`).toEqual([]);
      expect(src.match(emojiRe) ?? [], `${name} 含禁用 Emoji`).toEqual([]);
    }
  });
});
