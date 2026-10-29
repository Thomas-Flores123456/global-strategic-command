/**
 * ConsoleRadarScreen.test.ts —— FD-34 PKG-B 右上角战术雷达屏建筑光点投影与交互单测
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import type { Base } from '../../红警指挥系统/core/schema';
import type { RadarBuildingBlip } from '../console/ConsoleRadarScreen.vue';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const CONSOLE_DIR = join(TEST_DIR, '../console');
const SFC_PATH = join(CONSOLE_DIR, 'ConsoleRadarScreen.vue');
const COMPILED_PATH = join(CONSOLE_DIR, 'ConsoleRadarScreen.__fd34_test__.mts');
const ICON_STUB_PATH = join(CONSOLE_DIR, 'IconStub.__fd34_test__.mts');

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
    id: 'console-radar-screen-fd34-test',
    inlineTemplate: true,
  });

  let js = compiled.content.replace(
    "import Icon from '../../红警指挥系统/ui/Icon.vue';",
    "import Icon from './IconStub.__fd34_test__.mts';",
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

const SAMPLE_BASES: Base[] = [
  {
    id: 'base-north',
    name: '青岚山北坡主基地',
    location: '青岚山北坡',
    status: '隐蔽中',
    power: { gen: 200, use: 110 },
    alerts: [],
    buildings: [
      {
        name: '盟军建造厂',
        state: '运转',
        layer: '地表层',
        coord: { x: 0, y: 0 },
      },
      {
        name: '盟军发电厂',
        state: '运转',
        layer: '地表层',
        coord: { x: -2, y: 1 },
      },
      {
        name: '盟军战车工厂',
        state: '建造中',
        layer: '地表层',
        coord: { x: 4, y: -3 },
      },
      {
        name: '光棱塔',
        state: '受损',
        layer: '地表层',
        coord: { x: 7, y: 5 },
      },
      {
        name: '空军指挥部',
        state: '停机',
        layer: '地表层',
      },
    ],
  },
];

describe('FD-34 PKG-B · ConsoleRadarScreen 战术雷达平面图与建筑光点投影', () => {
  it('渲染 radar-tactical-plot、radar-mcv-origin、radar-building-blip 与默认选中第 1 座非 MCV 建筑简报', async () => {
    const app = createSSRApp(
      defineComponent({
        render: () =>
          h(ConsoleRadarScreenComp, {
            bases: SAMPLE_BASES,
            activeIndex: 0,
          }),
      }),
    );

    const html = await renderToString(app);
    expect(html).toContain('data-test="radar-tactical-plot"');
    expect(html).toContain('data-test="radar-mcv-origin"');
    expect(html).toContain('title="MCV 原点 (0,0)"');
    expect(html).toContain('data-test="radar-building-blip"');
    expect(html).toContain('data-building-name="盟军发电厂"');
    expect(html).toContain('data-ring="inner"');
    expect(html).toContain('data-building-name="盟军战车工厂"');
    expect(html).toContain('data-ring="mid"');
    expect(html).toContain('data-building-name="光棱塔"');
    expect(html).toContain('data-ring="outer"');
    expect(html).toContain('data-test="radar-selected-blip-info"');
    expect(html).toContain('◆ 盟军发电厂 ｜ 西北·220m (-2,+1) ｜ 内环');
  });

  it('精准计算建筑相对坐标映射百分比、四态颜色，且点击不同光点可切换 radar-selected-blip-info 详情展示', () => {
    let exposed: {
      radarBlips: { value: RadarBuildingBlip[] };
      selectedBlipInfo: { value: string };
      selectBlip: (key: string) => void;
    } | null = null;

    const Comp = ConsoleRadarScreenComp as Component & {
      setup?: (
        props: Record<string, unknown>,
        ctx: { expose: (exp: unknown) => void; emit: () => void },
      ) => unknown;
    };

    Comp.setup?.(
      {
        bases: SAMPLE_BASES,
        activeIndex: 0,
        preLaunchLocked: false,
        plannedLocation: '',
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
    expect(blips).toHaveLength(5);

    // 1. 盟军建造厂 (0, 0) -> (50%, 50%), 运转 var(--rac-ok), core
    expect(blips[0].name).toBe('盟军建造厂');
    expect(blips[0].leftPct).toBe(50);
    expect(blips[0].topPct).toBe(50);
    expect(blips[0].color).toBe('var(--rac-ok)');
    expect(blips[0].spatial.ring).toBe('core');

    // 2. 盟军发电厂 (-2, +1) -> left = 50 + (-2/10)*42 = 41.6%, top = 50 - (1/10)*42 = 45.8%, 运转 var(--rac-ok), inner
    expect(blips[1].name).toBe('盟军发电厂');
    expect(blips[1].leftPct).toBe(41.6);
    expect(blips[1].topPct).toBe(45.8);
    expect(blips[1].color).toBe('var(--rac-ok)');
    expect(blips[1].spatial.ring).toBe('inner');

    // 3. 盟军战车工厂 (+4, -3) -> left = 50 + 0.4*42 = 66.8%, top = 50 - (-0.3)*42 = 62.6%, 建造中 var(--rac-warn), mid
    expect(blips[2].name).toBe('盟军战车工厂');
    expect(blips[2].leftPct).toBe(66.8);
    expect(blips[2].topPct).toBe(62.6);
    expect(blips[2].color).toBe('var(--rac-warn)');
    expect(blips[2].spatial.ring).toBe('mid');

    // 4. 光棱塔 (+7, +5) -> 受损 var(--rac-alert), outer
    expect(blips[3].name).toBe('光棱塔');
    expect(blips[3].color).toBe('var(--rac-alert)');
    expect(blips[3].spatial.ring).toBe('outer');

    // 5. 空军指挥部（无显式坐标，确定性自动分配在中环） -> 停机 var(--rac-muted), mid
    expect(blips[4].name).toBe('空军指挥部');
    expect(blips[4].color).toBe('var(--rac-muted)');
    expect(blips[4].spatial.ring).toBe('mid');

    // 默认展示第 1 座非 MCV 建筑（盟军发电厂）
    expect(exposed!.selectedBlipInfo.value).toBe('◆ 盟军发电厂 ｜ 西北·220m (-2,+1) ｜ 内环');

    // 点击切换到盟军战车工厂
    exposed!.selectBlip(blips[2].key);
    expect(exposed!.selectedBlipInfo.value).toBe('◆ 盟军战车工厂 ｜ 东南·500m (+4,-3) ｜ 中环');

    // 点击切换到光棱塔
    exposed!.selectBlip(blips[3].key);
    expect(exposed!.selectedBlipInfo.value).toBe('◆ 光棱塔 ｜ 东北·860m (+7,+5) ｜ 外环');

    // 点击 MCV 原点锚点
    exposed!.selectBlip('__mcv_origin__');
    expect(exposed!.selectedBlipInfo.value).toBe('◆ 盟军建造厂 ｜ MCV原点 (0,0) ｜ 核心');
  });
});
