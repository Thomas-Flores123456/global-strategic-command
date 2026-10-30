/**
 * ModalSchedule.test.ts —— B1 接线回归：工程日程面板 snapshot 直传（禁 .stat_data 层级）
 *
 * 背景：ModalSchedule.vue 曾误取 props.snapshot?.stat_data（useFloatingStore 水合后 snapshot
 * 即 stat_data 本体，Schema 无 stat_data 层级）→ 恒 undefined → 面板恒显全空态。
 * 本套件 SSR 挂载直证接线：snapshot 本体（bases/queues/clock）直达 schedulePanelModel。
 *
 * 手法（零新增依赖、零新增抽象层）：
 * - vitest 管道无 .vue 插件（vitest.config.mts 为纯 node 环境），故测试内用
 *   vue/compiler-sfc（vue 既有依赖的官方子路径导出）把 SFC 即时编译为临时 ESM 模块
 *  （inlineTemplate 内联 render），再以 vue/server-renderer renderToString 挂载；
 *   临时模块写在组件旁（相对导入原样解析），afterAll 即清除；
 * - useCatalogStore 与 Icon.vue 经 vi.mock 打桩（按解析后绝对路径生效）。
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
import { Base, Building, Project, QueueItem, Schema } from '../../红警指挥系统/core/schema';
import { SCHEDULE_COPY } from '../../红警指挥系统/planning/scheduleCopy';

/* ═══════════════ 目录桩（与 schedulePanelModel.test.ts 同夹具口径） ═══════════════ */

const CATALOG = vi.hoisted(() => ({
  researches: [
    { name: '履带工学', line: '陆地载具' },
    { name: '二级履带', line: '陆地载具' },
  ],
  buildings: [{ name: '盟军战车工厂' }, { name: '盟军建造厂核心' }, { name: '航天发射中心' }],
  productions: [{ name: '犀牛坦克' }, { name: '灰熊坦克' }, { name: '天启坦克' }],
  retrofits: [],
  projects: [],
  factionDefs: [],
}));

vi.mock('../../红警指挥系统/composables/useCatalog', () => ({
  useCatalogStore: () => ({ effectiveCatalog: CATALOG }),
}));

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', render: () => hh('span') } };
});

/* ═══════════════ SFC 即时编译（临时模块：组件旁写入，套件末清除） ═══════════════ */

const SFC_PATH = join(__dirname, '../modals/ModalSchedule.vue');

let componentPromise: Promise<Component> | undefined;

function loadComponent(): Promise<Component> {
  componentPromise ??= import('../modals/ModalSchedule.vue').then(m => m.default as Component);
  return componentPromise;
}

/** SSR 挂载（renderToString 静态标记，等价首帧渲染文本） */
async function renderSchedule(snapshot: Schema | null): Promise<string> {
  const Comp = await loadComponent();
  return renderToString(createSSRApp({ render: () => h(Comp, { open: true, snapshot }) }));
}

/* ═══════════════ 夹具（Schema.parse 全形状，同 chronoBanner.test.ts mkStat 惯例） ═══════════════ */

function q(over: Record<string, unknown>): Record<string, unknown> {
  return { type: '生产', base: '基地A', status: 'queued', total_minutes: 600, ...over };
}

function mkSnapshot(): Schema {
  return Schema.parse({
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1, location: '锈蚀低壑' },
    clock: { day: 2, time: '23:00' },
    bases: [
      {
        id: 'A',
        name: '基地A',
        buildings: [{ name: '盟军战车工厂', mode: '生产' }, { name: '盟军建造厂核心' }],
      },
      { id: 'B', name: '基地B' },
    ],
    queues: [
      q({ item: '犀牛坦克', status: 'active', progress: 40, spent_minutes: 240 }),
      q({ item: '灰熊坦克', status: 'settling', progress: 100, spent_minutes: 600 }),
      q({ item: '天启坦克', status: 'queued' }),
      q({ item: '报废样车', status: 'done', progress: 100, spent_minutes: 600 }),
      q({ item: '撤销样车', status: 'cancelled' }),
    ],
  });
}

/* ═══════════════ ① SSR 挂载接线直证 ═══════════════ */

describe('B1 接线回归 · ModalSchedule snapshot 直传（SSR 挂载）', () => {
  it('时钟行渲染且与 SCHEDULE_COPY.clockLine 逐字一致（B1 前 .stat_data 恒 undefined → 无时钟）', async () => {
    const html = await renderSchedule(mkSnapshot());
    expect(html).toContain(SCHEDULE_COPY.clockLine(2, '23:00'));
  });

  it('有在编事务时不出现全空态文案（B1 前面板恒显全空态）', async () => {
    const html = await renderSchedule(mkSnapshot());
    expect(html).not.toContain(SCHEDULE_COPY.allEmpty);
  });

  it('基地 → 产线板渲染（基地A / 陆地载具生产线，laneBoard 直呈）', async () => {
    const html = await renderSchedule(mkSnapshot());
    expect(html).toContain('基地A');
    expect(html).toContain('陆地载具生产线');
  });

  it('收录口径接线直证：active/settling/queued 条目渲染，done/cancelled 不渲染', async () => {
    const html = await renderSchedule(mkSnapshot());
    expect(html).toContain('犀牛坦克'); // active
    expect(html).toContain('灰熊坦克'); // settling
    expect(html).toContain('天启坦克'); // queued
    expect(html).not.toContain('报废样车'); // done 不上日程
    expect(html).not.toContain('撤销样车'); // cancelled 不上日程
  });

  it('snapshot=null 兜底：不抛错，渲染全空态文案', async () => {
    const html = await renderSchedule(null);
    expect(html).toContain(SCHEDULE_COPY.allEmpty);
  });

  it('废弃基地默认隐藏（CTRL-RETIRE-01）：名称不出看板与Tab，仅显隐开关携计数；在册基地照常渲染', async () => {
    const snap = mkSnapshot();
    snap.bases.push(Base.parse({ id: 'C', name: '旧商坞基地', status: '废弃' }));
    const html = await renderSchedule(snap);
    // 废弃基地整体不出现在看板/Tab（默认 showRetired=false）
    expect(html).not.toContain('旧商坞基地');
    // 显隐开关照实携带计数（实体保留可审计，可切换检阅）
    expect(html).toContain('显示废弃基地 (1)');
    // 在册基地与产线不受废弃基地干扰
    expect(html).toContain('基地A');
    expect(html).toContain('陆地载具生产线');
  });

  it('UTO-UI-SCHED-01：制造产线、科研序列与工程工位（V1 阶段 + V2 仓段）同源 SSR 渲染且过滤 draft 节点', async () => {
    const snap = mkSnapshot();
    snap.bases[0].buildings.push(Building.parse({ name: '航天发射中心', state: '运转', mode: '生产' }));
    snap.queues.push(
      QueueItem.parse({
        type: '工程',
        item: '灰熊坦克现代化改装工程·火控换装',
        base: '基地A',
        lane: 'eng:eng.main',
        status: 'active',
        progress: 50,
        spent_minutes: 720,
        total_minutes: 1440,
      }),
      QueueItem.parse({
        type: '工程',
        item: '天穹轨道船坞·核心舱',
        base: '基地A',
        lane: 'eng:eng.orbital',
        status: 'queued',
        hold: true,
        progress: 20,
        spent_minutes: 576,
        total_minutes: 2880,
      }),
    );
    snap.projects = [
      Project.parse({
        id: 'proj:v1_01',
        schema_version: 1,
        ref: '灰熊坦克现代化改装工程',
        grade: '中改',
        scope: 'base',
        lead_base: '基地A',
        bases: ['基地A'],
        status: '在建',
        phases: [
          { idx: 0, name: '火控换装', status: '进行中', queue_index: 5 },
          { idx: 1, name: '反应装甲披挂', status: '未启动', queue_index: null },
        ],
      }),
      Project.parse({
        id: 'proj:v2_01',
        schema_version: 2,
        ref: '天穹轨道船坞',
        grade: '巨构',
        scope: 'theater',
        lead_base: '基地A',
        bases: ['基地A', '基地B'],
        status: '在建',
        modules: [
          { id: 'core', name: '核心舱', base: '基地A', status: '暂停', queue_index: 6 },
          { id: 'dock', name: '装配船台', base: '基地A', status: '未启动', queue_index: null },
        ],
      }),
    ];

    const html = await renderSchedule(snap);
    // 工程双工位与在途阶段/模块同源呈现
    expect(html).toContain('通用工程槽');
    expect(html).toContain('轨道组装泊位');
    expect(html).toContain('灰熊坦克现代化改装工程·火控换装');
    expect(html).toContain('天穹轨道船坞·核心舱');
    expect(html).toContain('data-task-id="task:proj:proj:v1_01:phase:0"');
    expect(html).toContain('data-task-id="task:proj:proj:v2_01:mod:core"');
    // 行内四动词按钮 aria-label 完整绑定
    expect(html).toContain('置顶「灰熊坦克现代化改装工程·火控换装」');
    expect(html).toContain('恢复「天穹轨道船坞·核心舱」');
    // 未启动 draft 拓扑节点不混入工位执行行
    expect(html).not.toContain('灰熊坦克现代化改装工程·反应装甲披挂');
    expect(html).not.toContain('天穹轨道船坞·装配船台');
  });

  it('PKG-C v2 五大区域与三视图锚点直证：即时编排开关、KPI仪表带、三视图胶囊、时间尺、双模舱、多轨甘特与底部工单调度台完整渲染', async () => {
    const snap = mkSnapshot();
    snap.bases[0].buildings.push(Building.parse({ name: '盟军战车工厂', state: '运转', mode: '加速' }));
    const html = await renderSchedule(snap);

    // 区域 1 & 2：顶栏模式控制与 KPI 仪表带
    expect(html).toContain('data-test="schedule-mode-instant-toggle"');
    expect(html).toContain('即时编排: 开启');
    expect(html).toContain('data-test="schedule-tray-toggle"');
    expect(html).toContain('指令托盘 (0)');
    expect(html).toContain('data-test="schedule-kpi-ribbon"');
    expect(html).toContain('运转工位:');
    expect(html).toContain('并联加速产线:');

    // 区域 3：三视图切换、时间标尺与后续阶段开关
    expect(html).toContain('data-test="schedule-view-switch"');
    expect(html).toContain('基地工位甘特');
    expect(html).toContain('五大领域汇总');
    expect(html).toContain('紧凑工单表');
    expect(html).toContain('data-test="schedule-horizon-switch"');
    expect(html).toContain('data-test="schedule-draft-toggle"');

    // 区域 4：产线内嵌双模舱、多轨甘特排程与五大领域/工单表容器
    expect(html).toContain('data-test="schedule-lane-dualmode"');
    expect(html).toContain('生产×1 · 加速×1');
    expect(html).toContain('加速 1.50x');
    expect(html).toContain('data-test="schedule-dualmode-btn"');
    expect(html).toContain('data-test="schedule-gantt-track-lane"');
    expect(html).toContain('data-test="schedule-gantt-axis-header"');
    expect(html).toContain('data-test="schedule-gantt-subtrack"');
    expect(html).toContain('data-test="schedule-gantt-gridline"');
    expect(html).toContain('data-test="schedule-gantt-hatch"');
    expect(html).toContain('data-test="schedule-gantt-block"');
    expect(html).toContain('data-test="schedule-gantt-legend"');
    expect(html).toContain('工位 #1');
    expect(html).toContain('data-test="schedule-domain-view"');
    expect(html).toContain('data-test="schedule-table-view"');

    // 区域 5：底部选中工单调度台与六动词按钮
    expect(html).toContain('data-test="schedule-task-inspector"');
    expect(html).toContain('工单调度台');
    expect(html).toContain('data-test="inspector-verb-置顶"');
    expect(html).toContain('data-test="inspector-verb-撤销"');
    expect(html).toContain('data-test="inspector-verb-指派"');
    expect(html).toContain('data-test="inspector-allocate-select"');
  });
});

/* ═══════════════ ② 静态契约（接线源码钉死，双保险） ═══════════════ */

describe('B1 静态契约 · ModalSchedule.vue 接线钉死', () => {
  const src = readFileSync(SFC_PATH, 'utf8');

  it('computed 直传 props.snapshot ?? {}：零 .stat_data 层级、零 as never 断言', () => {
    expect(src).toContain('schedulePanelModel(props.snapshot ?? {}, catalog.effectiveCatalog)');
    expect(src).not.toContain('.stat_data');
    expect(src).not.toContain('as never');
  });

  it('废弃显隐与折叠接线钉死：showRetired 默认 false＋visibleBases 同源过滤；collapsedBases 默认空集（全展开）', () => {
    expect(src).toContain('const showRetired = ref(false)');
    expect(src).toContain('b => !b.retired');
    expect(src).toContain('collapsedBases');
    expect(src).toContain('aria-expanded');
  });

  it('UTO-UI-SCHED-01 只读观察者与指令回填契约：ModalSchedule.vue 与 schedulePanelModel.ts 零 MVU 变量直写，四动词走 dispatchOrderText + sendAction', () => {
    const modelSrc = readFileSync(join(__dirname, '../models/schedulePanelModel.ts'), 'utf8');
    expect(src).toContain('dispatchOrderText');
    expect(src).toContain('sendAction');
    expect(src).not.toMatch(/replaceVariables|insertOrAssignVariables|updateVariablesWith|deleteVariable/);
    expect(modelSrc).toContain('createLaneRegistryHub');
    expect(modelSrc).toContain('toUnifiedTasks');
    expect(modelSrc).not.toMatch(/replaceVariables|insertOrAssignVariables|updateVariablesWith|deleteVariable/);
  });
});
