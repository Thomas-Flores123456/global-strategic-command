/**
 * PanelDataFlowInspector.test.ts —— DBG41-08 四镜片数据流监控主面板与双栖弹窗/Mini HUD 组件单测
 *
 * 覆盖：
 * 1. PanelDataFlowInspector.vue 真实挂载：
 *    - 注入七阶 Trace（含 S2_SETTLE 内嵌 S2a..S2i 子阶段）后，顶部环形缓冲计数、子页 1 [🔭 七阶瀑布流] 阶段行、S2 子齿轮展开/折叠与右侧阶段 Diff 明细表（正负 numericDelta）渲染；
 *    - 子页 2 [🧬 状态Diff与溯源]：快捷芯片筛选（如 credits）、关键词搜索、traceFieldMutations 阶段修改链与「整楼总 Diff」模式切换；
 *    - 子页 3 [✈️ 异步飞行记录]：注入 ok 与 blocked 记录，验证类别过滤与状态过滤；
 *    - 子页 4 [🧪 干跑与排障包]：预设模板填充、点击「⚡ 免落盘干跑试算」自动新增 dry_run Trace 且零污染 floating.snapshot 原对象、点击「📋 生成并复制 AI 排障复现包」生成包含 tavernweave.ra.repro_bundle.v1 的 JSON。
 * 2. ModalDataFlowInspector.vue 真实挂载：
 *    - open=true 且 debugState.miniHudOpen=false 时渲染完整弹窗 [data-test="modal-dataflow-full"]；
 *    - 点击「🗕 折叠为实时监视条 (Mini HUD)」后切换为右下角非阻挡胶囊 [data-test="modal-dataflow-minihud"]，再点击「🗖 展开监控台」恢复完整弹窗。
 */
import { klona } from 'klona';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as VueRuntime from 'vue';
import { createRenderer, h, nextTick, ssrContextKey, type Component } from 'vue';
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc';
import { debugState } from '../../红警指挥系统/composables/useDebugMode';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { Schema } from '../../红警指挥系统/core/schema';
import {
  beginFloorTrace,
  buildSubstageRecord,
  clearDataFlowTraces,
  clearFlightLogs,
  dataFlowDebugState,
  finishFloorTrace,
  recordFlightLog,
  recordTraceStage,
} from '../../红警指挥系统/debug/dataFlowTracer';
import ModalDataFlowInspector from '../modals/ModalDataFlowInspector.vue';
import modalSfcRaw from '../modals/ModalDataFlowInspector.vue?raw';
import PanelDataFlowInspector from '../panels/PanelDataFlowInspector.vue';
import panelSfcRaw from '../panels/PanelDataFlowInspector.vue?raw';

const customVModel = {
  created(el: VElement, binding: { value: unknown }, vnode: { props?: Record<string, unknown> | null }) {
    el._assign = vnode.props?.['onUpdate:modelValue'] as ((val: unknown) => void) | undefined;
    el.value = binding.value == null ? '' : String(binding.value);
    el.attrs.value = el.value;
  },
  updated(el: VElement, binding: { value: unknown }) {
    el.value = binding.value == null ? '' : String(binding.value);
    el.attrs.value = el.value;
  },
};

const TestVueRuntime = {
  ...VueRuntime,
  Transition: (_: unknown, { slots }: { slots: { default?: () => unknown } }) => slots.default?.(),
  vModelText: customVModel,
  vModelSelect: customVModel,
  vModelDynamic: customVModel,
};

function ensureClientRender(comp: Component, sfcRaw: string, id: string): void {
  const rec = comp as Record<string, unknown>;
  if (typeof rec.render === 'function') return;
  const { descriptor } = parse(sfcRaw, { filename: `${id}.vue` });
  if (!descriptor.template) return;
  const scriptBlock = compileScript(descriptor, { id });
  const tpl = compileTemplate({
    id,
    filename: `${id}.vue`,
    source: descriptor.template.content,
    ssr: false,
    compilerOptions: {
      bindingMetadata: scriptBlock.bindings,
      hoistStatic: false,
    },
  });
  const body = tpl.code
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"]\s*;?/g, (_, imports: string) => {
      const mapped = imports
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => s.replace(/\s+as\s+/g, ': '))
        .join(', ');
      return `const { ${mapped} } = Vue;`;
    })
    .replace(/\s+as\s+HTMLSelectElement/g, '')
    .replace(/export\s+function\s+render/, 'return function render');
  rec.render = new Function('Vue', body)(TestVueRuntime);
}

ensureClientRender(PanelDataFlowInspector, panelSfcRaw, 'panel-dataflow');
ensureClientRender(ModalDataFlowInspector, modalSfcRaw, 'modal-dataflow');

interface VElement {
  kind: 'element';
  tag: string;
  value: string;
  options: never[];
  _assign?: (val: unknown) => void;
  attrs: Record<string, string>;
  listeners: Record<string, ((...args: unknown[]) => unknown) | Array<(...args: unknown[]) => unknown>>;
  children: VNodeItem[];
  parent: VElement | null;
  addEventListener: (evt: string, fn: (...args: unknown[]) => unknown) => void;
  removeEventListener: (evt: string, fn: (...args: unknown[]) => unknown) => void;
}

interface VText {
  kind: 'text';
  text: string;
  parent: VElement | null;
}

type VNodeItem = VElement | VText;

function makeElement(tag: string): VElement {
  const el: VElement = {
    kind: 'element',
    tag,
    value: '',
    options: [],
    attrs: {},
    listeners: {},
    children: [],
    parent: null,
    addEventListener(evt, fn) {
      const existing = el.listeners[evt];
      if (!existing) {
        el.listeners[evt] = fn;
      } else if (Array.isArray(existing)) {
        existing.push(fn);
      } else {
        el.listeners[evt] = [existing, fn];
      }
    },
    removeEventListener(evt, fn) {
      const existing = el.listeners[evt];
      if (!existing) return;
      if (Array.isArray(existing)) {
        el.listeners[evt] = existing.filter(item => item !== fn);
      } else if (existing === fn) {
        delete el.listeners[evt];
      }
    },
  };
  return el;
}

function getText(node: VNodeItem): string {
  if (node.kind === 'text') return node.text;
  return node.children.map(getText).join('');
}

function findByDataTest(root: VElement, dataTest: string): VElement | undefined {
  let found: VElement | undefined;
  const walk = (el: VElement) => {
    if (found) return;
    if (el.attrs['data-test'] === dataTest) {
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

function queryAllByDataTestPrefix(root: VElement, prefix: string): VElement[] {
  const result: VElement[] = [];
  const walk = (el: VElement) => {
    if (el.attrs['data-test']?.startsWith(prefix)) {
      result.push(el);
    }
    for (const c of el.children) {
      if (c.kind === 'element') walk(c);
    }
  };
  walk(root);
  return result;
}

async function clickEl(el: VElement | undefined): Promise<void> {
  if (!el) throw new Error('Target element for click not found');
  const fn = el.listeners.click;
  const fakeEvent = { stopPropagation: () => {}, preventDefault: () => {}, target: el };
  if (Array.isArray(fn)) {
    for (const f of fn) await f(fakeEvent);
  } else if (typeof fn === 'function') {
    await fn(fakeEvent);
  }
  await nextTick();
}

async function setModelValue(el: VElement | undefined, val: string): Promise<void> {
  if (!el) throw new Error('Target element for setModelValue not found');
  el.value = val;
  el.attrs.value = val;
  if (typeof el._assign === 'function') {
    el._assign(val);
  } else {
    const fn = el.listeners.change ?? el.listeners.input;
    const fakeEvent = { target: el, stopPropagation: () => {}, preventDefault: () => {} };
    if (Array.isArray(fn)) {
      for (const f of fn) await f(fakeEvent);
    } else if (typeof fn === 'function') {
      await fn(fakeEvent);
    }
  }
  await nextTick();
}

function mountComponent(Comp: Component, props: Record<string, unknown> = {}) {
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
      if (key === 'value') {
        el.value = next == null ? '' : String(next);
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
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(root);
  return { root, app };
}

describe('DBG41-08 · PanelDataFlowInspector 四镜片面板与 ModalDataFlowInspector 双栖容器单测', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    clearDataFlowTraces();
    clearFlightLogs();
    debugState.enabled = true;
    debugState.miniHudOpen = false;
  });

  it('挂载 PanelDataFlowInspector：注入七阶 Trace（含 S2a..S2i 子阶段）后，四子页签切换、字段反向溯源、飞行日志过滤与免落盘干跑/排障包导出全闭环', async () => {
    const floating = useFloatingStore();
    const baseSnap = Schema.parse({
      economy: {
        credits: 5000,
        credits_daily: 0,
        resources: {
          nanites: { 工业纳米机械: 200 },
        },
      },
      bases: [
        {
          id: 'base-1',
          name: '主基地',
          status: '运转中',
          power: { gen: 200, use: 80 },
          buildings: [{ name: '盟军建造厂', state: '运转' }],
        },
      ],
    });
    floating.snapshot = klona(baseSnap);
    floating.floorId = 12;
    const snapshotBeforeDryRun = klona(floating.snapshot);

    // 注入一条含 S2 子齿轮的真实结构 Trace
    const afterParseSnap = klona(baseSnap);
    afterParseSnap.economy.credits = 6500;
    const afterSettleSnap = klona(afterParseSnap);
    afterSettleSnap.economy.credits = 6100;
    afterSettleSnap.economy.resources.nanites['工业纳米机械'] = 150;

    const traceId = beginFloorTrace(
      {
        chatId: 'chat-alpha',
        floorId: 12,
        swipeId: 0,
        source: 'live',
      },
      baseSnap,
    );
    recordTraceStage(traceId, 'S0_BASELINE', {
      beforeSnap: baseSnap,
      afterSnap: baseSnap,
      durationMs: 0.4,
      status: 'ok',
      summary: '基线扫描命中 #11 楼',
    });
    recordTraceStage(traceId, 'S1_PARSE', {
      beforeSnap: baseSnap,
      afterSnap: afterParseSnap,
      durationMs: 1.8,
      status: 'ok',
      summary: '标签提取完成 (+1500 资金)',
    });
    const sub2a = buildSubstageRecord('S2a_COMMAND', afterParseSnap, afterParseSnap, {
      durationMs: 0.3,
      summary: '副官加成无变更',
    });
    const sub2f = buildSubstageRecord('S2f_CHAINS_GRID', afterParseSnap, afterSettleSnap, {
      durationMs: 1.1,
      summary: '资金链维护扣费 -400 & 纳米消耗 -50',
    });
    recordTraceStage(traceId, 'S2_SETTLE', {
      beforeSnap: afterParseSnap,
      afterSnap: afterSettleSnap,
      durationMs: 2.5,
      status: 'ok',
      summary: '九大玩法结算完成',
      substages: [sub2a, sub2f],
    });
    finishFloorTrace(traceId, {
      outcome: 'ok',
      finalSnap: afterSettleSnap,
      totalDurationMs: 4.7,
      events: [{ domain: 'economy', msg: '战区补给入账 +1500' }],
      issues: [{ level: 'warn', code: 'R26', message: '产线负载接近上限' }],
      quarantine: [{ blockType: '工程', reason: '未知改装型号' }],
    });

    const { root } = mountComponent(PanelDataFlowInspector);

    // 1. 顶栏环形缓冲计数与默认子页 1 [🔭 七阶瀑布流]
    expect(getText(findByDataTest(root, 'buffer-traces-count')!)).toContain('已捕获楼层链路 1/5');
    expect(findByDataTest(root, 'view-waterfall')).toBeDefined();
    expect(findByDataTest(root, 'stage-row-S1_PARSE')).toBeDefined();
    expect(findByDataTest(root, 's2-substages-list')).toBeDefined();
    expect(findByDataTest(root, 'stage-row-S2f_CHAINS_GRID')).toBeDefined();

    // 点击 S1_PARSE 查看正数 numericDelta (+1500)，再点击 S2f_CHAINS_GRID 查看负数 numericDelta (-400)
    await clickEl(findByDataTest(root, 'stage-row-S1_PARSE'));
    expect(getText(findByDataTest(root, 'view-waterfall')!)).toContain('economy.credits');
    expect(getText(findByDataTest(root, 'view-waterfall')!)).toContain('+1500');

    await clickEl(findByDataTest(root, 'stage-row-S2f_CHAINS_GRID'));
    expect(getText(findByDataTest(root, 'view-waterfall')!)).toContain('-400');

    // 验证折叠/展开 S2 子齿轮
    await clickEl(findByDataTest(root, 'toggle-s2-substages'));
    expect(findByDataTest(root, 's2-substages-list')).toBeUndefined();
    await clickEl(findByDataTest(root, 'toggle-s2-substages'));
    expect(findByDataTest(root, 's2-substages-list')).toBeDefined();

    // 2. 切换到子页 2 [🧬 状态Diff与溯源]
    await clickEl(findByDataTest(root, 'tab-diff'));
    expect(findByDataTest(root, 'view-diff')).toBeDefined();

    // 点击快捷筛选芯片 credits，验证仅命中修改过 credits 的 S1_PARSE 与 S2f_CHAINS_GRID
    await clickEl(findByDataTest(root, 'field-chip-credits'));
    const chainText = getText(findByDataTest(root, 'mutation-chain-list')!);
    expect(chainText).toContain('S1_PARSE');
    expect(chainText).toContain('S2f_CHAINS_GRID');
    expect(chainText).toContain('+1500');
    expect(chainText).toContain('-400');

    // 切换到「整楼总 Diff」模式，验证基线 5000 -> 6100 (+1100)
    await clickEl(findByDataTest(root, 'diff-mode-total'));
    const totalDiffText = getText(findByDataTest(root, 'total-diffs-table')!);
    expect(totalDiffText).toContain('economy.credits');
    expect(totalDiffText).toContain('+1100');

    // 3. 切换到子页 3 [✈️ 异步飞行记录]
    recordFlightLog({
      category: 'host_event',
      status: 'ok',
      chatId: 'chat-alpha',
      floorId: 12,
      swipeId: 0,
      title: 'MESSAGE_RECEIVED #12',
      detail: '收到宿主消息事件',
    });
    recordFlightLog({
      category: 'wb_gateway',
      status: 'blocked',
      chatId: 'chat-alpha',
      floorId: 12,
      swipeId: 1,
      title: 'GuardError: CHAT_MISMATCH',
      detail: '期望 chat-alpha 实测 chat-beta，拦截写入',
    });

    await clickEl(findByDataTest(root, 'tab-flight'));
    expect(findByDataTest(root, 'view-flight')).toBeDefined();
    expect(queryAllByDataTestPrefix(root, 'flight-row-').length).toBe(2);

    // 按状态过滤 blocked，仅剩 1 条 GuardError
    await setModelValue(findByDataTest(root, 'flight-status-filter'), 'blocked');
    const blockedRows = queryAllByDataTestPrefix(root, 'flight-row-');
    expect(blockedRows.length).toBe(1);
    expect(getText(blockedRows[0])).toContain('GuardError: CHAT_MISMATCH');

    // 按类别过滤 host_event + 状态 all，仅剩 1 条 MESSAGE_RECEIVED
    await setModelValue(findByDataTest(root, 'flight-status-filter'), 'all');
    await setModelValue(findByDataTest(root, 'flight-category-filter'), 'host_event');
    const hostRows = queryAllByDataTestPrefix(root, 'flight-row-');
    expect(hostRows.length).toBe(1);
    expect(getText(hostRows[0])).toContain('MESSAGE_RECEIVED #12');

    // 4. 切换到子页 4 [🧪 干跑与排障包]
    await clickEl(findByDataTest(root, 'tab-dryrun'));
    expect(findByDataTest(root, 'view-dryrun')).toBeDefined();

    // 点击预设模板填充按钮（事件/资金链测试报文）
    await clickEl(findByDataTest(root, 'tpl-events'));
    expect(findByDataTest(root, 'dryrun-textarea')?.value).toContain('<事件>');

    // 点击「⚡ 免落盘干跑试算」
    await clickEl(findByDataTest(root, 'run-dryrun-btn'));
    expect(dataFlowDebugState.traces.length).toBe(2);
    expect(dataFlowDebugState.traces[0].meta.source).toBe('dry_run');
    expect(getText(findByDataTest(root, 'dryrun-notice')!)).toContain('干跑完成');
    // 验证原 floating.snapshot 绝对零副作用
    expect(floating.snapshot).toStrictEqual(snapshotBeforeDryRun);

    // 点击「📋 生成并复制 AI 排障复现包」
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextMock } });

    await clickEl(findByDataTest(root, 'build-repro-btn'));
    const previewEl = findByDataTest(root, 'repro-bundle-preview');
    expect(previewEl).toBeDefined();
    expect(previewEl!.value).toContain('tavernweave.ra.repro_bundle.v1');
    expect(writeTextMock).toHaveBeenCalledTimes(1);
  });

  it('挂载 ModalDataFlowInspector：验证完整弹窗与右下角 Mini HUD 实时监视胶囊状态切换', async () => {
    let closeCount = 0;
    let openFullCount = 0;
    const { root } = mountComponent(ModalDataFlowInspector, {
      open: true,
      onClose: () => {
        closeCount += 1;
      },
      onOpenFull: () => {
        openFullCount += 1;
      },
    });

    // 初始 open=true, miniHudOpen=false -> 渲染完整弹窗，不渲染 Mini HUD
    expect(findByDataTest(root, 'modal-dataflow-full')).toBeDefined();
    expect(findByDataTest(root, 'modal-dataflow-minihud')).toBeUndefined();

    // 点击「🗕 折叠为实时监视条 (Mini HUD)」 -> miniHudOpen=true，切换为右下角胶囊
    await clickEl(findByDataTest(root, 'dataflow-collapse-hud-btn'));
    expect(debugState.miniHudOpen).toBe(true);
    expect(findByDataTest(root, 'modal-dataflow-full')).toBeUndefined();
    expect(findByDataTest(root, 'modal-dataflow-minihud')).toBeDefined();

    // 点击「🗖 展开监控台」 -> miniHudOpen=false，恢复完整弹窗
    await clickEl(findByDataTest(root, 'dataflow-expand-full-btn'));
    expect(debugState.miniHudOpen).toBe(false);
    expect(findByDataTest(root, 'modal-dataflow-full')).toBeDefined();
    expect(findByDataTest(root, 'modal-dataflow-minihud')).toBeUndefined();
    expect(openFullCount).toBe(0); // open 本身为 true 时无需重复触发 open-full

    // 再次折叠后点击「✕ 关闭 HUD」
    await clickEl(findByDataTest(root, 'dataflow-collapse-hud-btn'));
    await clickEl(findByDataTest(root, 'dataflow-close-hud-btn'));
    expect(debugState.miniHudOpen).toBe(false);
    expect(closeCount).toBe(1);
  });
});
