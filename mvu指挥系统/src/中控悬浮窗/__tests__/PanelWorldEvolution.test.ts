/**
 * PanelWorldEvolution.test.ts —— FD-35 (PKG-B) 中控设置面板「世界演变」专属分组与双子页单测
 *
 * 覆盖：
 * 1. ModalSettings.vue 挂载契约：groups 新增 key='world-evo'（活跃暗流演进 L1 / 历史平息归档 L2·L3）及对应具名 slot；
 * 2. PanelWorldEvolution.vue 顶部控制栏：五维监控概览与聊天楼层 <世界演变> 显示策略切换器（wevo-floor-mode-hidden / wevo-floor-mode-pulse）；
 * 3. page="active"：四象限筛选（wevo-domain-filter）、导演级监控卡片（wevo-active-card）、置顶锁 TTL（wevo-pin-btn）、沉淀入世界书 L3（wevo-archive-wb-btn）、转化为前线侦察指令填入 #send_textarea（wevo-act-btn）；
 * 4. page="archived"：历史平息归档列表（wevo-archived-card）渲染与一键标记沉淀入世界书（wevo-archived-to-wb-btn）。
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

const mockStoreState = reactive<{
  stat: {
    intel: {
      world_evolutions: Array<Record<string, unknown>>;
      intel_archived: Array<Record<string, unknown>>;
    };
    pending_lore?: Array<Record<string, unknown>>;
  };
}>({
  stat: {
    intel: {
      world_evolutions: [],
      intel_archived: [],
    },
    pending_lore: [],
  },
});

const mockFloorVarCalls: Array<{
  floorId: number;
  resultVars: Record<string, unknown>;
}> = [];

vi.mock('../host/floorVarWrite', () => ({
  updateFloorVars: vi.fn(async (floorId: number, updater: (vars: Record<string, unknown>) => Record<string, unknown>) => {
    const initialVars: Record<string, unknown> = {
      stat_data: {
        intel: {
          world_evolutions: [...mockStoreState.stat.intel.world_evolutions],
          intel_archived: [...mockStoreState.stat.intel.intel_archived],
        },
        pending_lore: [...(mockStoreState.stat.pending_lore ?? [])],
      },
    };
    const resultVars = updater(initialVars);
    mockFloorVarCalls.push({ floorId, resultVars });
  }),
}));

vi.mock('../../红警指挥系统/composables/store', () => ({
  in_tavern: false,
  useDataStore: () => mockStoreState,
}));

vi.mock('../../红警指挥系统/composables/useFloatingStore', () => ({
  useFloatingStore: () => ({
    floorId: { value: 12 },
    snapshot: null,
  }),
}));

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', props: ['name', 'size'], render: () => hh('span') } };
});

const DIR = join(__dirname, '..');
const MODAL_SETTINGS_PATH = join(DIR, 'modals/ModalSettings.vue');
const PANEL_SFC_PATH = join(DIR, 'panels/PanelWorldEvolution.vue');
const PANEL_COMPILED_PATH = join(DIR, 'panels/PanelWorldEvolution.__fd35_test__.mts');

function stripTypeImports(code: string): string {
  return code
    .replace(/^import\s+type\s[\s\S]*?from\s+['"][^'"]+['"];?[\t ]*$/gm, '')
    .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
}

let panelCompPromise: Promise<Component> | undefined;

function loadPanelWorldEvolution(): Promise<Component> {
  panelCompPromise ??= (async () => {
    const source = readFileSync(PANEL_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: PANEL_SFC_PATH });
    if (errors.length > 0) {
      throw new Error(`${PANEL_SFC_PATH} 解析失败：${errors.map(String).join('; ')}`);
    }
    const compiled = compileScript(descriptor, {
      id: 'panelworldevofd35',
      inlineTemplate: true,
      templateOptions: {
        id: 'panelworldevofd35',
        scoped: descriptor.styles.some(s => s.scoped),
      },
    });
    writeFileSync(PANEL_COMPILED_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
    const mod = (await import(pathToFileURL(PANEL_COMPILED_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return panelCompPromise;
}

afterAll(() => {
  try {
    unlinkSync(PANEL_COMPILED_PATH);
  } catch {
    /* ignore */
  }
});

// ─── 轻量虚拟 DOM 渲染器（支持属性查询与 click 事件交互） ───
interface VElement {
  kind: 'element';
  tag: string;
  attrs: Record<string, string>;
  listeners: Record<string, ((...args: unknown[]) => unknown) | Array<(...args: unknown[]) => unknown>>;
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

function queryAllByDataTest(root: VElement, dataTest: string): VElement[] {
  const result: VElement[] = [];
  const walk = (el: VElement) => {
    if (el.attrs['data-test'] === dataTest || el.attrs['data-testid'] === dataTest) {
      result.push(el);
    }
    for (const c of el.children) {
      if (c.kind === 'element') walk(c);
    }
  };
  walk(root);
  return result;
}

async function clickEl(el: VElement): Promise<void> {
  const fn = el.listeners.click;
  const fakeEvent = { stopPropagation: () => {}, preventDefault: () => {} };
  if (Array.isArray(fn)) {
    for (const f of fn) await f(fakeEvent);
  } else if (typeof fn === 'function') {
    await fn(fakeEvent);
  }
  await nextTick();
}

function mountPanel(Comp: Component, props: Record<string, unknown> = {}) {
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
        const evt = key.slice(2).toLowerCase();
        if (next) el.listeners[evt] = next as (...args: unknown[]) => unknown;
        else delete el.listeners[evt];
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

describe('FD-35 PKG-B · ModalSettings 世界演变分组与 PanelWorldEvolution 双子页单测', () => {
  let storageMap: Map<string, string>;
  let stealthHosts: Array<{
    attrs: Record<string, string>;
    style: { display: string };
    setAttribute: (k: string, v: string) => void;
  }>;
  let mockTextarea: {
    value: string;
    events: string[];
    dispatchEvent: (ev: { type?: string }) => boolean;
    focus: () => void;
    ownerDocument?: { defaultView?: { Event?: typeof Event } };
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    mockFloorVarCalls.length = 0;
    mockStoreState.stat.pending_lore = [];
    storageMap = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storageMap.set(k, String(v));
      },
      removeItem: (k: string) => {
        storageMap.delete(k);
      },
    });

    stealthHosts = [
      {
        attrs: { 'data-card-type': 'world-evolution-stealth' },
        style: { display: '' },
        setAttribute(k: string, v: string) {
          this.attrs[k] = v;
        },
      },
    ];

    mockTextarea = {
      value: '',
      events: [],
      dispatchEvent(ev: { type?: string }) {
        if (ev?.type) this.events.push(ev.type);
        return true;
      },
      focus: vi.fn(),
    };

    const fakeDoc = {
      querySelector: (sel: string) => (sel === '#send_textarea' ? mockTextarea : null),
      querySelectorAll: (sel: string) =>
        sel.includes('world-evolution-stealth') ? stealthHosts : [],
    };
    vi.stubGlobal('document', fakeDoc);
    vi.stubGlobal('window', {
      location: { search: '' },
      parent: { document: fakeDoc },
    });

    mockStoreState.stat.intel.world_evolutions = [
      {
        id: 'wevo_1',
        title: '远东冻土裂缝异常扩张',
        domain: '位面异象',
        stage: '高潮',
        ttl_floors: 4,
        tension: 88,
        evolves_from: '北极光磁暴初现',
        summary: '冻土带深处出现高浓度灵能裂缝，多支巡逻队失联。',
        trend: '预计 2 轮内向南蔓延至外围警戒线。',
        pinned: false,
      },
      {
        id: 'wevo_2',
        title: '地下黑市超时空元件走私潮',
        domain: '社会黑市',
        stage: '发酵',
        ttl_floors: 3,
        tension: 62,
        summary: '残存盟军实验所流出的超时空电容在灰市被高价竞拍。',
        trend: '可能催生野生改装载具武装。',
        pinned: false,
      },
    ];

    mockStoreState.stat.intel.intel_archived = [
      {
        id: 'wevo_arc_1',
        title: '极北气象站失联事件',
        domain: '远方地缘',
        stage: '平息',
        kind: 'world',
        summary: '极北无人气象站恢复离线信标，暂未发现后续敌情。',
        archived_to_wb: false,
      },
      {
        id: 'tac_arc_ignore',
        title: '普通前线巡逻简报',
        src: '前线目视',
        content: '不属于世界演变的普通战术流水',
      },
    ];
  });

  it('1. ModalSettings.vue 静态契约：声明 world-evo 分组（活跃暗流演进 L1 / 历史平息归档 L2·L3）并挂载双具名 slot', () => {
    const sfc = readFileSync(MODAL_SETTINGS_PATH, 'utf8');
    expect(sfc).toContain("import PanelWorldEvolution from '../panels/PanelWorldEvolution.vue'");
    expect(sfc).toContain("key: 'world-evo'");
    expect(sfc).toContain("label: '世界演变'");
    expect(sfc).toContain("icon: 'globe'");
    expect(sfc).toContain("{ key: 'active', label: '活跃暗流演进 (L1)' }");
    expect(sfc).toContain("{ key: 'archived', label: '历史平息归档 (L2·L3)' }");
    expect(sfc).toContain('<template #panel-world-evo-active>');
    expect(sfc).toContain('<PanelWorldEvolution page="active" />');
    expect(sfc).toContain('<template #panel-world-evo-archived>');
    expect(sfc).toContain('<PanelWorldEvolution page="archived" />');
  });

  it('2. PanelWorldEvolution (page="active")：渲染五维概览、楼层隐藏模式切换器、四象限过滤与活跃暗流卡片', async () => {
    const Comp = await loadPanelWorldEvolution();
    const { root } = mountPanel(Comp, { page: 'active' });

    // 顶部概览指标：活跃 2、归档 1（过滤掉非世界演变普通流水）、高潮 1
    expect(getText(queryAllByDataTest(root, 'wevo-metric-active')[0]!)).toBe('2');
    expect(getText(queryAllByDataTest(root, 'wevo-metric-archived')[0]!)).toBe('1');
    expect(getText(queryAllByDataTest(root, 'wevo-metric-climax')[0]!)).toBe('1');

    // 默认楼层显示策略为 hidden，且同步隐藏 DOM 宿主节点
    expect(stealthHosts[0]!.style.display).toBe('none');
    const pulseBtn = queryAllByDataTest(root, 'wevo-floor-mode-pulse')[0]!;
    const hiddenBtn = queryAllByDataTest(root, 'wevo-floor-mode-hidden')[0]!;
    expect(getText(hiddenBtn)).toContain('彻底无痕全隐 (默认)');
    expect(getText(pulseBtn)).toContain('仅露加密脉冲微标');

    // 切换为 pulse 模式
    await clickEl(pulseBtn);
    expect(storageMap.get('rac_world_evo_floor_mode_v1')).toBe('pulse');
    expect(stealthHosts[0]!.attrs['data-stealth-mode']).toBe('pulse');
    expect(stealthHosts[0]!.style.display).toBe('');

    // 切回 hidden 模式
    await clickEl(hiddenBtn);
    expect(storageMap.get('rac_world_evo_floor_mode_v1')).toBe('hidden');
    expect(stealthHosts[0]!.style.display).toBe('none');

    // 四象限过滤按钮（5 个：全部 + 四象限）
    const domainBtns = queryAllByDataTest(root, 'wevo-domain-filter');
    expect(domainBtns.length).toBe(5);
    expect(queryAllByDataTest(root, 'wevo-active-card').length).toBe(2);

    // 点击「社会黑市」象限过滤
    const blackMarketBtn = domainBtns.find(b => b.attrs['data-domain'] === '社会黑市')!;
    await clickEl(blackMarketBtn);
    const filteredCards = queryAllByDataTest(root, 'wevo-active-card');
    expect(filteredCards.length).toBe(1);
    expect(filteredCards[0]!.attrs['data-evo-id']).toBe('wevo_2');

    // 点回「全部」
    const allBtn = domainBtns.find(b => b.attrs['data-domain'] === 'all')!;
    await clickEl(allBtn);
    expect(queryAllByDataTest(root, 'wevo-active-card').length).toBe(2);
  });

  it('3. PanelWorldEvolution (page="active")：三合一操作（置顶锁 TTL、转化为前线侦察指令、沉淀入世界书 L3）', async () => {
    const Comp = await loadPanelWorldEvolution();
    const { root } = mountPanel(Comp, { page: 'active' });

    // 1) 置顶锁 TTL：点击第 1 张卡的 wevo-pin-btn
    const pinBtns = queryAllByDataTest(root, 'wevo-pin-btn');
    expect(getText(queryAllByDataTest(root, 'wevo-ttl-badge')[0]!)).toContain('◇ TTL 4 轮');
    await clickEl(pinBtns[0]!);
    expect(mockStoreState.stat.intel.world_evolutions[0]!.pinned).toBe(true);
    expect(getText(queryAllByDataTest(root, 'wevo-ttl-badge')[0]!)).toContain('◆ 已锁定常驻');

    // 2) 转化为前线侦察指令：点击第 1 张卡的 wevo-act-btn，验证写入 #send_textarea 且不自动发送
    const actBtns = queryAllByDataTest(root, 'wevo-act-btn');
    await clickEl(actBtns[0]!);
    expect(mockTextarea.value).toBe(
      '【暗流侦察】针对宏观暗流「远东冻土裂缝异常扩张」（位面异象·高潮），立即派遣侦察力量核实其对我方战区的潜在波及！',
    );
    expect(mockTextarea.events).toContain('input');
    expect(mockTextarea.events).toContain('change');

    // 3) 沉淀入世界书 L3：点击第 1 张卡的 wevo-archive-wb-btn，从活跃列表移入 intel_archived 并标记 archived_to_wb = true，同时写入 pending_lore 并调用 updateFloorVars 落盘（BUG-R2-09）
    const archiveWbBtns = queryAllByDataTest(root, 'wevo-archive-wb-btn');
    await clickEl(archiveWbBtns[0]!);
    expect(queryAllByDataTest(root, 'wevo-active-card').length).toBe(1);
    const movedRecord = mockStoreState.stat.intel.intel_archived.find(x => x.id === 'wevo_1');
    expect(movedRecord).toBeDefined();
    expect(movedRecord?.archived_to_wb).toBe(true);
    expect(mockStoreState.stat.pending_lore).toHaveLength(1);
    expect(mockStoreState.stat.pending_lore?.[0]).toMatchObject({
      id: 'lore_wevo_wevo_1',
      name: '远东冻土裂缝异常扩张',
      source_floor: 12,
    });
    expect(mockFloorVarCalls.length).toBeGreaterThanOrEqual(1);
    const lastPersist = mockFloorVarCalls[mockFloorVarCalls.length - 1]!;
    expect(lastPersist.floorId).toBe(12);
    const persistedSd = lastPersist.resultVars.stat_data as Record<string, unknown>;
    expect(Array.isArray(persistedSd.pending_lore)).toBe(true);
    expect((persistedSd.pending_lore as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 'lore_wevo_wevo_1',
      name: '远东冻土裂缝异常扩张',
    });
  });

  it('4. PanelWorldEvolution (page="archived")：渲染历史平息归档卡片并支持一键标记沉淀入世界书 L3（同步持久化 pending_lore 与 updateFloorVars，BUG-R2-09）', async () => {
    const Comp = await loadPanelWorldEvolution();
    const { root } = mountPanel(Comp, { page: 'archived' });

    const archivedCards = queryAllByDataTest(root, 'wevo-archived-card');
    expect(archivedCards.length).toBe(1);
    expect(archivedCards[0]!.attrs['data-evo-id']).toBe('wevo_arc_1');
    expect(getText(archivedCards[0]!)).toContain('极北气象站失联事件');
    expect(getText(queryAllByDataTest(root, 'wevo-archived-wb-status')[0]!)).toContain('◇ L3 世界书待入档');

    const toWbBtn = queryAllByDataTest(root, 'wevo-archived-to-wb-btn')[0]!;
    await clickEl(toWbBtn);
    expect(mockStoreState.stat.intel.intel_archived[0]!.archived_to_wb).toBe(true);
    expect(getText(queryAllByDataTest(root, 'wevo-archived-wb-status')[0]!)).toContain('◆ L3 世界书已入档');
    expect(mockStoreState.stat.pending_lore).toHaveLength(1);
    expect(mockStoreState.stat.pending_lore?.[0]).toMatchObject({
      id: 'lore_wevo_wevo_arc_1',
      name: '极北气象站失联事件',
      source_floor: 12,
    });
    expect(mockFloorVarCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('5. BUG-R2-24(1)：PanelWorldEvolution 支持 stage: "显化" 正常渲染、计入高潮指标并支持 wevo-pin-btn / wevo-archive-wb-btn 操作', async () => {
    mockStoreState.stat.intel.world_evolutions.push({
      id: 'WEVO-03',
      title: '太平洋远东升阳帝国介入北美西海岸战局',
      domain: '远方地缘',
      stage: '显化',
      ttl_floors: 8,
      summary: '第四阵营升阳帝国的变形载具与波能科技即将进入战场',
      trend: '升级',
      pinned: false,
      kind: 'world',
    });

    const Comp = await loadPanelWorldEvolution();
    const { root } = mountPanel(Comp, { page: 'active' });

    expect(getText(queryAllByDataTest(root, 'wevo-metric-active')[0]!)).toBe('3');
    // wevo_1 (高潮) + WEVO-03 (显化) = 2
    expect(getText(queryAllByDataTest(root, 'wevo-metric-climax')[0]!)).toBe('2');

    const wevo03Card = queryAllByDataTest(root, 'wevo-active-card').find(
      c => c.attrs['data-evo-id'] === 'WEVO-03',
    )!;
    expect(wevo03Card).toBeDefined();
    expect(wevo03Card.attrs['data-stage']).toBe('显化');
  });
});
