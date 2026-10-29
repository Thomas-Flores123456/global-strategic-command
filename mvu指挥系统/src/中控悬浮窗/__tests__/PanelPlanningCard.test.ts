/**
 * PanelPlanningCard.test.ts —— PLAN-UI-01 中控日程面板参谋方案预览卡片单测
 *
 * 覆盖：
 * 1. schedulePanelModel 透传 stat.planning?.latest_receipt → planningReceipt；
 * 2. formatPlanningApprovalOrderText 纯函数输出格式（过滤 rejected 动作、包含 <排产计划> 块且 mode="delegate_once"）；
 * 3. PanelPlanningCard.vue 在 advisory_ready / awaiting_approval / committed / rejected（含 UX-04 blocker_reason & next_step）/ stale_snapshot 下的渲染；
 * 4. 点击「批准方案（填入发送框）」与「暂不采纳 / 收起回执」事件触发；
 * 5. ModalSchedule.vue 挂载 PanelPlanningCard、onApprovePlanning 走 fillHostSendInput 只读红线与 onDismissPlanning 收起逻辑。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读写临时编译产物，不进 bundle */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { extractPlanningIntent } from '../../红警指挥系统/planning/planningParser';
import { PlanningReceipt, Schema } from '../../红警指挥系统/core/schema';
import { formatPlanningApprovalOrderText, schedulePanelModel } from '../models/schedulePanelModel';

/* ═══════════════ 依赖组件与宿主输入桩 ═══════════════ */

const CATALOG = vi.hoisted(() => ({
  researches: [],
  buildings: [{ name: '盟军战车工厂' }, { name: '盟军兵营' }],
  productions: [{ name: '灰熊坦克' }, { name: '多功能步兵车' }, { name: '美国大兵' }],
  retrofits: [],
  projects: [],
  factionDefs: [],
}));

const hostSendStub = vi.hoisted(() => ({
  fill: vi.fn(() => 'textarea' as const),
}));

vi.mock('../../红警指挥系统/composables/useCatalog', () => ({
  useCatalogStore: () => ({ effectiveCatalog: CATALOG }),
}));

vi.mock('../../红警指挥系统/worldbook/hostSendInput', () => ({
  fillHostSendInput: hostSendStub.fill,
}));

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', render: () => hh('span') } };
});

/* ═══════════════ SFC 即时编译辅助（临时 .mts 模块，afterAll 清理） ═══════════════ */

const CARD_SFC_PATH = join(__dirname, '../panels/PanelPlanningCard.vue');
const CARD_SSR_PATH = join(__dirname, '../panels/PanelPlanningCard.__plan_ssr__.mts');
const CARD_BIND_PATH = join(__dirname, '../panels/PanelPlanningCard.__plan_bind__.mts');

const MODAL_SFC_PATH = join(__dirname, '../modals/ModalSchedule.vue');
const MODAL_SSR_PATH = join(__dirname, '../modals/ModalSchedule.__plan_ssr__.mts');
const MODAL_BIND_PATH = join(__dirname, '../modals/ModalSchedule.__plan_bind__.mts');

let cardCompPromise: Promise<Component> | undefined;
let modalCompPromise: Promise<Component> | undefined;
let bindSeq = 0;

function stripTypeImports(code: string): string {
  return code
    .replace(/^import\s+type\s[\s\S]*?from\s+['"][^'"]+['"];?[\t ]*$/gm, '')
    .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
}

function loadCardComponent(): Promise<Component> {
  cardCompPromise ??= (async () => {
    const source = readFileSync(CARD_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'PanelPlanningCard.vue' });
    if (errors.length > 0) throw new Error(`PanelPlanningCard.vue 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id: 'panelplanningcardssr',
      inlineTemplate: true,
      templateOptions: { id: 'panelplanningcardssr', scoped: descriptor.styles.some(s => s.scoped) },
    });
    writeFileSync(CARD_SSR_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
    const mod = (await import(pathToFileURL(CARD_SSR_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return cardCompPromise;
}

vi.mock('../panels/PanelPlanningCard.vue', async () => {
  const Comp = await loadCardComponent();
  return { default: Comp };
});

function loadModalComponent(): Promise<Component> {
  modalCompPromise ??= (async () => {
    const source = readFileSync(MODAL_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'ModalSchedule.vue' });
    if (errors.length > 0) throw new Error(`ModalSchedule.vue 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id: 'modalscheduleplanssr',
      inlineTemplate: true,
      templateOptions: { id: 'modalscheduleplanssr', scoped: descriptor.styles.some(s => s.scoped) },
    });
    writeFileSync(MODAL_SSR_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
    const mod = (await import(pathToFileURL(MODAL_SSR_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return modalCompPromise;
}

async function renderCard(receipt: PlanningReceipt | null): Promise<string> {
  const Comp = await loadCardComponent();
  return renderToString(createSSRApp({ render: () => h(Comp, { receipt }) }));
}

async function loadCardSetup(receipt: PlanningReceipt | null, emit = vi.fn()): Promise<Record<string, any>> {
  const source = readFileSync(CARD_SFC_PATH, 'utf8');
  const { descriptor } = parse(source, { filename: 'PanelPlanningCard.vue' });
  const compiled = compileScript(descriptor, { id: 'panelplanningcardbind', inlineTemplate: false });
  writeFileSync(CARD_BIND_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
  const mod = (await import(`${pathToFileURL(CARD_BIND_PATH).href}?v=${(bindSeq += 1)}`)) as {
    default: { setup: (p: unknown, ctx: unknown) => Record<string, any> };
  };
  return mod.default.setup({ receipt }, { emit, expose: vi.fn(), attrs: {}, slots: {} });
}

async function loadModalSetup(snapshot: Schema | null, emit = vi.fn()): Promise<Record<string, any>> {
  const source = readFileSync(MODAL_SFC_PATH, 'utf8');
  const { descriptor } = parse(source, { filename: 'ModalSchedule.vue' });
  const compiled = compileScript(descriptor, { id: 'modalscheduleplanbind', inlineTemplate: false });
  writeFileSync(MODAL_BIND_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
  const mod = (await import(`${pathToFileURL(MODAL_BIND_PATH).href}?v=${(bindSeq += 1)}`)) as {
    default: { setup: (p: unknown, ctx: unknown) => Record<string, any> };
  };
  return mod.default.setup({ open: true, snapshot }, { emit, expose: vi.fn(), attrs: {}, slots: {} });
}

afterAll(() => {
  for (const p of [CARD_SSR_PATH, CARD_BIND_PATH, MODAL_SSR_PATH, MODAL_BIND_PATH]) {
    try {
      unlinkSync(p);
    } catch {
      // 忽略文件不存在
    }
  }
});

beforeEach(() => {
  hostSendStub.fill.mockClear();
});

/* ═══════════════ 测试夹具 ═══════════════ */

function makeReceipt(overrides: Partial<PlanningReceipt> = {}): PlanningReceipt {
  return PlanningReceipt.parse({
    request_ref: 'req_alpha_01',
    fingerprint: 'plan_abcd1234',
    snapshot_ref: 'floor_12',
    mode: 'advisory',
    status: 'advisory_ready',
    base_ref: '北极星主基地',
    total_cost_credits: 2100,
    budget_cap_credits: 3000,
    summary: '建议补强前线装甲突击群并加急主力坦克排产',
    reason: '当前北翼防线装甲缺口达 3 辆，需优先补充灰熊坦克。',
    actions: [
      {
        op: 'enqueue',
        target: '灰熊坦克',
        base: '北极星主基地',
        quantity: 2,
        cost_credits: 1400,
        est_minutes: 120,
        status: 'preview',
        eta_note: '预计今日 14:00 交付',
      },
      {
        op: 'promote',
        target: '多功能步兵车',
        base: '北极星主基地',
        quantity: 1,
        cost_credits: 700,
        est_minutes: 60,
        status: 'accepted',
      },
      {
        op: 'enqueue',
        target: '光棱坦克',
        base: '北极星主基地',
        quantity: 1,
        cost_credits: 1200,
        est_minutes: 90,
        status: 'rejected',
        blocker_code: 'TECH_LOCKED',
        blocker_reason: '缺少前置科技「光棱传导技术」与作战实验室',
        next_step: '请先在科研中心立项「光棱传导技术」并建造盟军作战实验室',
      },
    ],
    diff_summary: {
      added: ['灰熊坦克×2'],
      promoted: ['多功能步兵车×1'],
      demoted: [],
      held: [],
      resumed: [],
    },
    created_at_floor: 12,
    ...overrides,
  });
}

/* ═══════════════ 1. schedulePanelModel & formatPlanningApprovalOrderText ═══════════════ */

describe('schedulePanelModel · planningReceipt 与批准指令格式化', () => {
  it('透传 stat.planning?.latest_receipt 到 model.planningReceipt，缺省为 null', () => {
    const emptyModel = schedulePanelModel({}, CATALOG as any);
    expect(emptyModel.planningReceipt).toBeNull();

    const receipt = makeReceipt();
    const withReceipt = schedulePanelModel(
      {
        planning: {
          latest_receipt: receipt,
          protected_task_refs: ['灰熊坦克'],
        },
      },
      CATALOG as any,
    );
    expect(withReceipt.planningReceipt).toEqual(receipt);
  });

  it('formatPlanningApprovalOrderText 仅保留非 rejected 动作并输出合法 <排产计划> delegate_once 块', () => {
    const receipt = makeReceipt();
    const orderText = formatPlanningApprovalOrderText(receipt);

    expect(orderText).toContain('【参谋方案核准令】');
    expect(orderText).toContain('req_alpha_01');
    expect(orderText).toContain('北极星主基地');
    expect(orderText).toContain('入队「灰熊坦克」×2');
    expect(orderText).toContain('加急「多功能步兵车」×1');
    expect(orderText).not.toContain('光棱坦克');
    expect(orderText).toContain('<排产计划>');
    expect(orderText).toContain('</排产计划>');
    expect(orderText).toContain('"mode": "delegate_once"');

    // 验证生成的 <排产计划> 块可被 planningParser 无隔离零报错解析还原
    const match = orderText.match(/<排产计划>\s*([\s\S]*?)\s*<\/排产计划>/);
    expect(match).not.toBeNull();
    const parsed = extractPlanningIntent(match![1]);
    expect(parsed.quarantine).toEqual([]);
    expect(parsed.intent).not.toBeNull();
    expect(parsed.intent?.mode).toBe('delegate_once');
    expect(parsed.intent?.request_ref).toBe('req_alpha_01');
    expect(parsed.intent?.actions).toHaveLength(2);
    expect(parsed.intent?.actions[0]).toMatchObject({
      op: 'enqueue',
      catalog_ref: '灰熊坦克',
      base_ref: '北极星主基地',
      quantity: 2,
    });
    expect(parsed.intent?.actions[1]).toMatchObject({
      op: 'promote',
      task_ref: '多功能步兵车',
      base_ref: '北极星主基地',
      quantity: 1,
    });
  });
});

/* ═══════════════ 2. PanelPlanningCard.vue 多状态 SSR 渲染契约 ═══════════════ */

describe('PanelPlanningCard.vue · 多状态渲染与 UX-04 阻塞诊断', () => {
  it('advisory_ready：渲染参谋建议徽章、预算对比、差异摘要、动作动词与批准/暂不采纳按钮', async () => {
    const receipt = makeReceipt({ status: 'advisory_ready' });
    const html = await renderCard(receipt);

    expect(html).toContain('[参谋部排产方案]');
    expect(html).toContain('#req_alpha_01');
    expect(html).toContain('参谋建议·待裁决');
    expect(html).toContain('北极星主基地');
    expect(html).toContain('2100 资金');
    expect(html).toContain('预算上限 3000');
    expect(html).toContain('预算内');
    expect(html).toContain('建议补强前线装甲突击群并加急主力坦克排产');
    expect(html).toContain('当前北翼防线装甲缺口达 3 辆，需优先补充灰熊坦克。');
    expect(html).toContain('新增入列: 灰熊坦克×2');
    expect(html).toContain('加急提序: 多功能步兵车×1');
    expect(html).toContain('入队');
    expect(html).toContain('加急');
    expect(html).toContain('data-test="planning-approve-btn"');
    expect(html).toContain('批准方案（填入发送框）');
    expect(html).toContain('data-test="planning-dismiss-btn"');
    expect(html).toContain('暂不采纳');
  });

  it('awaiting_approval：渲染超限委托·待复核徽章与超预算上限警示，并保留批准与暂不采纳按钮', async () => {
    const receipt = makeReceipt({
      status: 'awaiting_approval',
      mode: 'delegate_once',
      total_cost_credits: 4500,
      budget_cap_credits: 3000,
    });
    const html = await renderCard(receipt);

    expect(html).toContain('超限委托·待复核');
    expect(html).toContain('超预算上限');
    expect(html).toContain('data-test="planning-approve-btn"');
    expect(html).toContain('批准方案（填入发送框）');
    expect(html).toContain('暂不采纳');
  });

  it('committed：渲染已核准入列徽章，隐藏批准按钮并显示收起回执按钮', async () => {
    const receipt = makeReceipt({ status: 'committed' });
    const html = await renderCard(receipt);

    expect(html).toContain('已核准入列');
    expect(html).not.toContain('data-test="planning-approve-btn"');
    expect(html).toContain('收起回执');
  });

  it('rejected：醒目展示 UX-04 阻塞原因（blocker_reason）与下一步建议（next_step），仅提供收起回执按钮', async () => {
    const receipt = makeReceipt({
      status: 'rejected',
      actions: [
        {
          op: 'enqueue',
          target: '光棱坦克',
          base: '北极星主基地',
          quantity: 1,
          cost_credits: 1200,
          est_minutes: 90,
          status: 'rejected',
          blocker_code: 'TECH_LOCKED',
          blocker_reason: '缺少前置科技「光棱传导技术」与作战实验室',
          next_step: '请先在科研中心立项「光棱传导技术」并建造盟军作战实验室',
        },
      ],
    });
    const html = await renderCard(receipt);

    expect(html).toContain('已驳回');
    expect(html).toContain('data-test="planning-action-blocker"');
    expect(html).toContain('TECH_LOCKED');
    expect(html).toContain('缺少前置科技「光棱传导技术」与作战实验室');
    expect(html).toContain('data-test="planning-action-next-step"');
    expect(html).toContain('请先在科研中心立项「光棱传导技术」并建造盟军作战实验室');
    expect(html).not.toContain('data-test="planning-approve-btn"');
    expect(html).toContain('收起回执');
  });
});

/* ═══════════════ 3. PanelPlanningCard.vue 交互事件与 ModalSchedule.vue 挂载接线 ═══════════════ */

describe('PanelPlanningCard & ModalSchedule · 交互事件与只读填栏接线', () => {
  it('点击「批准方案」触发 approve 事件，点击「暂不采纳」触发 dismiss 事件', async () => {
    const receipt = makeReceipt({ status: 'advisory_ready' });
    const emit = vi.fn();
    const bindings = await loadCardSetup(receipt, emit);

    bindings.onApprove();
    expect(emit).toHaveBeenCalledWith('approve', receipt);

    bindings.onDismiss();
    expect(emit).toHaveBeenCalledWith('dismiss', 'req_alpha_01');
  });

  it('ModalSchedule.vue：顶部挂载 PanelPlanningCard，onApprovePlanning 调 fillHostSendInput 填入指令，onDismissPlanning 收起卡片', async () => {
    const receipt = makeReceipt({ status: 'advisory_ready' });
    const snapshot = Schema.parse({
      bases: [{ id: 'base_1', name: '北极星主基地', status: '隐蔽中', buildings: [] }],
      queues: [],
      planning: {
        latest_receipt: receipt,
        protected_task_refs: [],
      },
    });

    const ModalComp = await loadModalComponent();
    const html = await renderToString(
      createSSRApp({ render: () => h(ModalComp, { open: true, snapshot }) }),
    );
    expect(html).toContain('data-test="planning-receipt-card"');
    expect(html).toContain('[参谋部排产方案]');
    expect(html).toContain('批准方案（填入发送框）');

    const modalBindings = await loadModalSetup(snapshot);
    modalBindings.onApprovePlanning(receipt);
    expect(hostSendStub.fill).toHaveBeenCalledTimes(1);
    expect(hostSendStub.fill).toHaveBeenCalledWith(formatPlanningApprovalOrderText(receipt));

    expect(modalBindings.dismissedReceiptRefs.value.has('req_alpha_01')).toBe(false);
    modalBindings.onDismissPlanning('req_alpha_01');
    expect(modalBindings.dismissedReceiptRefs.value.has('req_alpha_01')).toBe(true);
  });
});
