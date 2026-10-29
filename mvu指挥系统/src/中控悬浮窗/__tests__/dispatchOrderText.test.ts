/**
 * dispatchOrderText.test.ts —— CTRL-UI-DISPATCH-01 验收测试
 *
 * 覆盖（对照卡面口径）：
 * ① 指令文本：四动词逐字含「调度: <动词>」（设计案 §2.3.1 报文语法）＋ <队列> 标签口径，
 *   物理队列带基地消歧、研究免基地，非法动词/空项目 fail-closed；
 * ② 按钮视图模型：hold/免疫态（§2.3.2）启用矩阵与禁用理由照实；
 * ③ schedulePanelModel 行模型带 type/base/hold（调度令文本与按钮态同源）；
 * ④ SSR 挂载：队列条目行渲染四动词按钮（基地产线行＋研究槽行），禁用态直证；
 * ⑤ 静态契约：sendAction 走动态 import（toastr/jquery 依赖链仅真机可加载，node/SSR 零触达）。
 *
 * 手法（与 ModalSchedule.test.ts 同规）：vue/compiler-sfc 即时编译 SFC → 临时 .mts →
 * vue/server-renderer renderToString；useCatalogStore 与 Icon.vue 打桩。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读写临时编译产物，不进 bundle */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import type { EffectiveCatalog } from '../../红警指挥系统/core/catalogEffective';
import { Schema, type QueueItem } from '../../红警指挥系统/core/schema';
import { DISPATCH_VERBS } from '../../红警指挥系统/engines/transactionEngine';
import { DISPATCH_ORDER_COPY, dispatchOrderText, dispatchVerbButtonsFor } from '../models/dispatchOrderText';
import { schedulePanelModel, type SchedulePanelInput } from '../models/schedulePanelModel';

/* ═══════════════ 目录桩（与 ModalSchedule.test.ts 同夹具口径） ═══════════════ */

const CATALOG_MOCK = vi.hoisted(() => ({
  researches: [
    { name: '履带工学', line: '陆地载具' },
    { name: '二级履带', line: '陆地载具' },
  ],
  buildings: [{ name: '盟军战车工厂' }, { name: '盟军建造厂核心' }],
  productions: [{ name: '犀牛坦克' }, { name: '灰熊坦克' }, { name: '天启坦克' }],
  retrofits: [],
  factionDefs: [],
}));

const CATALOG = CATALOG_MOCK as unknown as EffectiveCatalog;

vi.mock('../../红警指挥系统/composables/useCatalog', () => ({
  useCatalogStore: () => ({ effectiveCatalog: CATALOG_MOCK }),
}));

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', render: () => hh('span') } };
});

/* ═══════════════ ① 指令文本（§2.3.1 报文语法逐字对齐） ═══════════════ */

describe('dispatchOrderText（sendAction 指令文本生成）', () => {
  it('四动词全覆盖：每动词文本含「调度: <动词>」与 <队列> 标签口径（§2.3.1）', () => {
    for (const verb of DISPATCH_VERBS) {
      const text = dispatchOrderText(verb, { item: '天启坦克', type: '生产', base: 'A' });
      expect(text).toContain(`调度: ${verb}`);
      expect(text).toContain('<队列>');
      expect(text).toContain(`调度令「${verb}」`);
      expect(text).toContain('「天启坦克」');
    }
  });

  it('物理队列（生产/建造/改装）带基地消歧；引擎写入纪律句（不改写进度）在文', () => {
    const text = dispatchOrderText('置顶', { item: '天启坦克', type: '生产', base: 'A' });
    expect(text).toContain('生产项目「天启坦克」');
    expect(text).toContain('基地「A」');
    expect(text).toContain('不改写进度');
    expect(text.startsWith('（指挥指令：')).toBe(true);
    expect(text.endsWith('）')).toBe(true);
  });

  it('研究按 type+item 全局唯一：即使误带 base 也不入文本（parsePipeline 复合身份口径）', () => {
    const text = dispatchOrderText('暂缓', { item: '履带工学', type: '研究', base: 'A' });
    expect(text).toContain('研究项目「履带工学」');
    expect(text).not.toContain('基地');
  });

  it('非法动词 fail-closed 抛 RangeError（非法值进 rejected 的裁决权在引擎，UI 不产出半条指令）', () => {
    expect(() => dispatchOrderText('插队', { item: '天启坦克', type: '生产' })).toThrow(RangeError);
    expect(() => dispatchOrderText('置顶', { item: '  ', type: '生产' })).toThrow(RangeError);
  });
});

/* ═══════════════ ② 按钮视图模型（hold/免疫态启用矩阵） ═══════════════ */

describe('dispatchVerbButtonsFor（四动词按钮态）', () => {
  it('按钮序＝引擎 DISPATCH_VERBS 枚举序（真源只读引用）', () => {
    const buttons = dispatchVerbButtonsFor({ status: 'queued', hold: false });
    expect(buttons.map(b => b.verb)).toEqual([...DISPATCH_VERBS]);
  });

  it('queued/active 未暂缓：置顶/置底/暂缓可用（动词语义提示），恢复禁用并给理由', () => {
    for (const status of ['queued', 'active'] as const) {
      const buttons = dispatchVerbButtonsFor({ status, hold: false });
      const by = (v: string) => buttons.find(b => b.verb === v)!;
      expect(by('置顶').enabled).toBe(true);
      expect(by('置底').enabled).toBe(true);
      expect(by('暂缓').enabled).toBe(true);
      expect(by('暂缓').hint).toBe(DISPATCH_ORDER_COPY.verbHint['暂缓']);
      expect(by('恢复').enabled).toBe(false);
      expect(by('恢复').hint).toBe(DISPATCH_ORDER_COPY.notHeld);
      expect(by('恢复').armed).toBe(false);
    }
  });

  it('已暂缓（hold=true）：暂缓禁用「已暂缓」，恢复可用并 armed 高亮', () => {
    const buttons = dispatchVerbButtonsFor({ status: 'queued', hold: true });
    const by = (v: string) => buttons.find(b => b.verb === v)!;
    expect(by('暂缓').enabled).toBe(false);
    expect(by('暂缓').hint).toBe(DISPATCH_ORDER_COPY.holdAlready);
    expect(by('恢复').enabled).toBe(true);
    expect(by('恢复').armed).toBe(true);
  });

  it('settling/done/cancelled 免疫（§2.3.2 约束 2）：四键全禁，理由照实呈现', () => {
    for (const status of ['settling', 'done', 'cancelled'] as const) {
      const buttons = dispatchVerbButtonsFor({ status });
      expect(buttons.every(b => !b.enabled)).toBe(true);
      expect(buttons.every(b => b.hint === DISPATCH_ORDER_COPY.immune)).toBe(true);
    }
  });
});

/* ═══════════════ ③ 行模型同源（type/base/hold 供文本与按钮态） ═══════════════ */

function q(over: Partial<QueueItem>): QueueItem {
  return {
    type: '生产',
    item: '测试产物',
    base: '基地A',
    status: 'queued',
    progress: 0,
    spent_minutes: 0,
    total_minutes: 600,
    qty: 1,
    qty_done: 0,
    cost_paid: true,
    hold: false,
    eta: '',
    started_at: '',
    ...over,
  } as QueueItem;
}

function stat(over: Partial<SchedulePanelInput> = {}): SchedulePanelInput {
  return {
    bases: [
      {
        id: 'A',
        name: '基地A',
        buildings: [
          { name: '盟军战车工厂', state: '运转', mode: '生产' },
          { name: '盟军建造厂核心', state: '运转' },
        ] as never,
      },
    ],
    queues: [],
    clock: { day: 2, time: '23:00' },
    ...over,
  };
}

describe('schedulePanelModel 行模型调度令字段（CTRL-UI-DISPATCH-01 增量）', () => {
  it('产线行 txns 携带 type/base/hold/status 原值（调度令指令文本与按钮态同源）', () => {
    const m = schedulePanelModel(
      stat({ queues: [q({ item: '犀牛坦克', status: 'active' }), q({ item: '天启坦克', hold: true })] }),
      CATALOG,
    );
    const allTxns = m.bases.flatMap(b => b.lanes).flatMap(l => l.txns);
    const rhino = allTxns.find(t => t.item === '犀牛坦克')!;
    expect(rhino.type).toBe('生产');
    expect(rhino.base).toBe('基地A');
    expect(rhino.hold).toBe(false);
    expect(rhino.status).toBe('active');
    const apoc = allTxns.find(t => t.item === '天启坦克')!;
    expect(apoc.hold).toBe(true);
  });

  it('研究槽行 txns 同带四字段（研究 type 原值；指令文本免基地由 dispatchOrderText 裁决）', () => {
    const m = schedulePanelModel(
      stat({ queues: [q({ item: '履带工学', type: '研究', base: '', status: 'queued' })] }),
      CATALOG,
    );
    const row = m.researchSlots.flatMap(s => s.txns).find(t => t.item === '履带工学')!;
    expect(row.type).toBe('研究');
    expect(row.hold).toBe(false);
  });
});

/* ═══════════════ ④ SSR 挂载：队列条目行四动词按钮直证 ═══════════════ */

const SFC_PATH = join(__dirname, '../modals/ModalSchedule.vue');
// 临时模块取 .mts：FloatingApp.test.ts 源码扫描正则为 /\.(ts|vue)$/，.mts 天然不被误拾
const COMPILED_PATH = join(__dirname, '../modals/ModalSchedule.__dispatch_ssr__.mts');

let componentPromise: Promise<Component> | undefined;

function loadComponent(): Promise<Component> {
  componentPromise ??= (async () => {
    const source = readFileSync(SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'ModalSchedule.vue' });
    if (errors.length > 0) throw new Error(`ModalSchedule.vue 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id: 'modalscheduledispatchssr',
      inlineTemplate: true,
      templateOptions: { id: 'modalscheduledispatchssr', scoped: descriptor.styles.some(s => s.scoped) },
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
    // ignore
  }
});

function mkSnapshot(): Schema {
  const qq = (over: Record<string, unknown>): Record<string, unknown> => ({
    type: '生产',
    base: '基地A',
    status: 'queued',
    total_minutes: 600,
    ...over,
  });
  return Schema.parse({
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1, location: '锈蚀低壑' },
    clock: { day: 2, time: '23:00' },
    bases: [
      {
        id: 'A',
        name: '基地A',
        buildings: [{ name: '盟军战车工厂', mode: '生产' }, { name: '盟军建造厂核心' }],
      },
    ],
    queues: [
      qq({ item: '犀牛坦克', status: 'active', progress: 40, spent_minutes: 240 }),
      qq({ item: '灰熊坦克', status: 'settling', progress: 100, spent_minutes: 600 }),
      qq({ item: '天启坦克', status: 'queued', hold: true }),
      qq({ item: '履带工学', type: '研究', base: '', status: 'queued' }),
    ],
  });
}

async function renderSchedule(): Promise<string> {
  const Comp = await loadComponent();
  return renderToString(createSSRApp({ render: () => h(Comp, { open: true, snapshot: mkSnapshot() }) }));
}

/** 取含指定 aria-label 的 <button> 开标签（SSR 属性序：disabled 先于 aria-label，可一并捕获） */
function buttonTag(html: string, ariaLabel: string): string {
  const m = html.match(new RegExp(`<button\\b[^>]*aria-label="${ariaLabel}"[^>]*>`));
  return m?.[0] ?? '';
}

describe('SSR · 队列条目行四动词按钮（CTRL-UI-DISPATCH-01）', () => {
  it('每个日程条目行渲染四动词按钮组（产线行＋研究槽行；done/cancelled 不上日程自然无按钮）', async () => {
    const html = await renderSchedule();
    for (const item of ['犀牛坦克', '灰熊坦克', '天启坦克', '履带工学']) {
      expect(html).toContain(`aria-label="调度令：${item}"`);
      for (const verb of DISPATCH_VERBS) {
        expect(buttonTag(html, `${verb}「${item}」`)).not.toBe('');
      }
    }
  });

  it('active 条目（犀牛坦克）：置顶/置底/暂缓可用，恢复禁用', async () => {
    const html = await renderSchedule();
    expect(buttonTag(html, '置顶「犀牛坦克」')).not.toContain('disabled');
    expect(buttonTag(html, '置底「犀牛坦克」')).not.toContain('disabled');
    expect(buttonTag(html, '暂缓「犀牛坦克」')).not.toContain('disabled');
    expect(buttonTag(html, '恢复「犀牛坦克」')).toContain('disabled');
  });

  it('queued+hold 条目（天启坦克）：暂缓禁用，恢复可用且 armed 高亮', async () => {
    const html = await renderSchedule();
    expect(buttonTag(html, '暂缓「天启坦克」')).toContain('disabled');
    const resume = buttonTag(html, '恢复「天启坦克」');
    expect(resume).not.toContain('disabled');
    expect(resume).toContain('sch-verb-btn--armed');
  });

  it('settling 条目（灰熊坦克）：四键全禁（免疫理由由 title 照实呈现）', async () => {
    const html = await renderSchedule();
    for (const verb of DISPATCH_VERBS) {
      const tag = buttonTag(html, `${verb}「灰熊坦克」`);
      expect(tag).toContain('disabled');
      expect(tag).toContain(DISPATCH_ORDER_COPY.immune);
    }
  });

  it('可用按钮 title＝动词语义（§2.3.1 表压缩文案）', async () => {
    const html = await renderSchedule();
    expect(buttonTag(html, '置顶「犀牛坦克」')).toContain(DISPATCH_ORDER_COPY.verbHint['置顶']);
  });
});

/* ═══════════════ ⑤ 静态契约（sendAction 动态加载钉死） ═══════════════ */

describe('静态契约 · ModalSchedule.vue 调度令通道钉死', () => {
  const src = readFileSync(SFC_PATH, 'utf8');

  it('sendAction 走动态 import（toastr/jquery 依赖链仅真机可加载，node/SSR 零触达）', () => {
    expect(src).toContain(`await import('../../红警指挥系统/worldbook/send')`);
    expect(src).not.toMatch(/^import\s+[^'"]*['"](?:\.\.\/)?\.\.\/红警指挥系统\/send['"]/m);
  });

  it('指令文本经 dispatchOrderText 生成（组件零自建文案/零自建判定）', () => {
    expect(src).toContain('dispatchOrderText(verb, { item: txn.item, type: txn.type, base: txn.base })');
    expect(src).toContain('dispatchVerbButtonsFor');
  });
});
