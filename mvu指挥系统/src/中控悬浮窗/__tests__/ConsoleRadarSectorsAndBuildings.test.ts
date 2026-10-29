/**
 * ConsoleRadarSectorsAndBuildings.test.ts —— FD-38 PKG-D 专项单测
 *
 * 覆盖：
 * 1. ConsoleRadarScreen.vue 渲染 sectors 防区胶囊（[data-test="radar-base-sectors"]）与悬停 title；
 * 2. ConsoleRadarScreen.vue 对 queues 中历史在建建筑的自动黄点投影兜底与防重；
 * 3. ModalBuildings.vue 顶部基地防区标签列表（[data-test="modal-buildings-sectors"]）；
 * 4. strategicFeedforward.ts 基地防区摘要（防区工程：...）输出；
 * 5. worldbooks/全域战略指挥系统_世界书.json 的 uid=18 与 uid=19 基地增量及防区规约校验。
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { Schema, type Base } from '../../红警指挥系统/core/schema';
import {
  buildStrategicFeedforwardText,
  formatBaseSectorsSummary,
} from '../../红警指挥系统/worldbook/strategicFeedforward';
import type { RadarBuildingBlip } from '../console/ConsoleRadarScreen.vue';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const CONSOLE_DIR = join(TEST_DIR, '../console');
const MODALS_DIR = join(TEST_DIR, '../modals');
const SFC_PATH = join(CONSOLE_DIR, 'ConsoleRadarScreen.vue');
const MODAL_BLD_PATH = join(MODALS_DIR, 'ModalBuildings.vue');
const COMPILED_PATH = join(CONSOLE_DIR, 'ConsoleRadarScreen.__fd38_test__.mts');
const ICON_STUB_PATH = join(CONSOLE_DIR, 'IconStub.__fd38_test__.mts');

let ConsoleRadarScreenComp: Component;

beforeAll(async () => {
  writeFileSync(
    ICON_STUB_PATH,
    `import { defineComponent, h } from 'vue';
export default defineComponent({
  name: 'Icon',
  props: { name: String, size: Number },
  setup(props) {
    return () => h('i', { 'data-icon': props.name });
  },
});
`,
    'utf8',
  );

  const src = readFileSync(SFC_PATH, 'utf8');
  const { descriptor } = parse(src, { filename: SFC_PATH });
  const compiled = compileScript(descriptor, {
    id: 'console-radar-screen-fd38-test',
    inlineTemplate: true,
  });

  const js = compiled.content.replace(
    "import Icon from '../../红警指挥系统/ui/Icon.vue';",
    "import Icon from './IconStub.__fd38_test__.mts';",
  );
  writeFileSync(COMPILED_PATH, js, 'utf8');
  const mod = (await import(pathToFileURL(COMPILED_PATH).href)) as { default: Component };
  ConsoleRadarScreenComp = mod.default;
});

afterAll(() => {
  for (const p of [COMPILED_PATH, ICON_STUB_PATH]) {
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        // ignore cleanup race
      }
    }
  }
});

describe('FD-38 PKG-D · 雷达屏防区去重（移交建筑面板）、在建建筑自动投影、战略前馈与世界书 uid=18/19 规约', () => {
  it('1. ConsoleRadarScreen 侧栏雷达屏不再重复渲染 [data-test="radar-base-sectors"] 防区胶囊（防区详情统一由 ModalBuildings 承载），且设施态势概要紧凑内聚于雷达圆盘右侧列', async () => {
    const basesWithSectors = [
      {
        id: '1号主基地',
        name: '1号主基地',
        location: '恶土·东侧裂隙地下转运库大厅',
        status: '警戒',
        power: { gen: 50, use: 10 },
        alerts: ['外围震动探针触发微弱读数'],
        buildings: [
          {
            name: '盟军建造厂',
            layer: '地下层',
            state: '运转',
            coord: { x: 0, y: 0 },
          },
        ],
        sectors: [
          {
            name: '洞口防红外伪装与震动探针阵线',
            layer: '掩体入口',
            status: '正常',
            desc: '隔绝热辐射并监测半径500米地面震动',
          },
          {
            name: '半山腰通风竖井管网',
            layer: '地下层',
            status: '正常',
            desc: '',
          },
        ],
      },
    ] as unknown as Base[];

    const app = createSSRApp(
      defineComponent({
        render: () =>
          h(ConsoleRadarScreenComp, {
            bases: basesWithSectors,
            activeIndex: 0,
          }),
      }),
    );

    const html = await renderToString(app);
    expect(html).not.toContain('data-test="radar-base-sectors"');
    expect(html).not.toContain('洞口防红外伪装与震动探针阵线');
    expect(html).toContain('设施: 1 座');
    expect(html).toContain('运转就绪');
  });

  it('2. ConsoleRadarScreen 对 props.queues 中尚未挂入 buildings 的在建建筑自动派生黄点投影且不重复叠加', async () => {
    const baseOnlyConyard: Base[] = [
      {
        id: '1号主基地',
        name: '1号主基地',
        location: '恶土·东侧裂隙',
        status: '运转中',
        power: { gen: 50, use: 0 },
        alerts: [],
        buildings: [
          {
            name: '盟军建造厂',
            layer: '地下层',
            state: '运转',
            coord: { x: 0, y: 0 },
          },
        ],
      },
    ];

    const queuesSample = [
      {
        type: '建造',
        item: '盟军发电厂',
        base: '1号主基地',
        status: 'active',
        progress: 40,
      },
      {
        type: '研究',
        item: '小型模块化核能工学',
        base: '1号主基地',
        status: 'active',
        progress: 20,
      },
    ];

    const app = createSSRApp(
      defineComponent({
        render: () =>
          h(ConsoleRadarScreenComp, {
            bases: baseOnlyConyard,
            activeIndex: 0,
            queues: queuesSample,
          }),
      }),
    );

    const html = await renderToString(app);
    expect(html).toContain('设施: 2 座');
    expect(html).toContain('建造中: 1');
    expect(html).toContain('data-building-name="盟军发电厂"');
    expect(html).toContain('data-state="建造中"');

    let exposed: {
      radarBlips: { value: RadarBuildingBlip[] };
    } | null = null;

    const Comp = ConsoleRadarScreenComp as Component & {
      setup?: (
        props: Record<string, unknown>,
        ctx: { expose: (exp: unknown) => void; emit: () => void },
      ) => unknown;
    };

    Comp.setup?.(
      {
        bases: baseOnlyConyard,
        activeIndex: 0,
        preLaunchLocked: false,
        plannedLocation: '',
        queues: queuesSample,
      },
      {
        expose: exp => {
          exposed = exp as typeof exposed;
        },
        emit: () => {},
      },
    );

    expect(exposed).not.toBeNull();
    const blips = exposed!.radarBlips.value;
    expect(blips).toHaveLength(2);
    const powerPlantBlip = blips.find(b => b.name === '盟军发电厂');
    expect(powerPlantBlip).toBeDefined();
    expect(powerPlantBlip?.state).toBe('建造中');
    expect(powerPlantBlip?.color).toBe('var(--rac-warn)');
  });

  it('3. ModalBuildings.vue 顶部基地信息区支持渲染 [data-test="modal-buildings-sectors"]', () => {
    const modalSrc = readFileSync(MODAL_BLD_PATH, 'utf8');
    expect(modalSrc).toContain('data-test="modal-buildings-sectors"');
    expect(modalSrc).toContain('activeBaseSectors');
    expect(modalSrc).toContain('防区与环境工程:');
  });

  it('4. strategicFeedforward 输出基地防区与环境工程摘要（防区工程：...）', () => {
    const summary = formatBaseSectorsSummary({
      sectors: [
        { name: '洞口防红外伪装网', layer: '地表层', status: '正常' },
        { name: '半山腰通风竖井管网', layer: '地下层', status: '正常' },
      ],
    });
    expect(summary).toBe('防区工程：洞口防红外伪装网、半山腰通风竖井管网');

    const stat = Schema.parse({
      meta: { date: '2087-04-02', location: '恶土东裂隙', weather: '晴' },
      clock: { day: 3, time: '14:00' },
      bases: [
        {
          id: '1号主基地',
          name: '1号主基地',
          location: '恶土东裂隙',
          status: '警戒',
          power: { gen: 50, use: 0 },
          buildings: [{ name: '盟军建造厂', layer: '地下层', state: '运转' }],
          alerts: [],
        },
      ],
    });
    (stat.bases[0] as unknown as { sectors: unknown[] }).sectors = [
      { name: '洞口防红外伪装网', layer: '掩体入口', status: '正常', desc: '' },
      { name: '半山腰通风竖井管网', layer: '地下层', status: '正常', desc: '' },
    ];

    const promptText = buildStrategicFeedforwardText(stat);
    expect(promptText).toContain('防区工程：洞口防红外伪装网、半山腰通风竖井管网');
  });

  it('5. 世界书 uid=18 与 uid=19 包含 <态势> 基地按需增量更新、防区工程及多 MCV 合署/分基地规约', () => {
    const wbPath = resolve(TEST_DIR, '../../../../worldbooks/全域战略指挥系统_世界书.json');
    const wb = JSON.parse(readFileSync(wbPath, 'utf8')) as {
      entries: Record<string, { uid: number; comment: string; content: string }>;
    };
    const uid18 = wb.entries['18'] ?? Object.values(wb.entries).find(e => e.uid === 18);
    const uid19 = wb.entries['19'] ?? Object.values(wb.entries).find(e => e.uid === 19);

    expect(uid18).toBeDefined();
    expect(uid18.content).toContain('严禁每轮复读未变化的建筑与部队列表；MCV未展开前严禁输出 基地: 字段');
    expect(uid18.content).toContain('MCV 正式展开后，当发生 ① 基地正式命名/改名、状态或局部天气变更');
    expect(uid18.content).toContain('防区');
    expect(uid18.content).toContain('坐标 / 方位 / 层级');

    expect(uid19).toBeDefined();
    expect(uid19.content).toContain('运转中');
    expect(uid19.content).toContain('同基地合署扩建 vs 异地新辟分基地');
    expect(uid19.content).toContain('基地.防区（sectors');
  });
});
