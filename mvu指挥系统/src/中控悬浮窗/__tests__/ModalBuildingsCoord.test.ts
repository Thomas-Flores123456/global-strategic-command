/**
 * ModalBuildingsCoord.test.ts —— FD-34 (PKG-C) 基地建筑总览弹窗 ModalBuildings.vue 建筑相对 MCV 坐标与三环徽章展示单测
 *
 * 覆盖：
 * 1. resolveFacilityCoordBadge 与 coordRingBadgeClass：
 *    - 核心 (core)：MCV / 建造厂恒定为 📍 MCV原点 (0,0)，金色高亮；
 *    - 内环 (inner)：发电厂 / 作战实验室等显示 📍 内环 · {方位}，天蓝 #38bdf8；
 *    - 中环 (mid)：兵营 / 战车工厂 / 矿石精炼厂等显示 📍 中环 · {方位}，翠绿 #4ade80；
 *    - 外环 (outer)：光棱塔 / 磁暴线圈 / 爱国者飞弹等显示 📍 外环 · {方位}，赤橙 #fb923c；
 *    - 优先读取建筑显式 coord / bearing，未携带时走确定性三环自动布防兜底。
 * 2. ModalBuildings.vue 组件挂载渲染：
 *    - 已建建筑列表每张卡片均渲染 [data-test="building-coord-badge"] 及正确的相对 MCV 坐标与防务圈层文案。
 */

/* eslint-disable import-x/no-nodejs-modules -- 测试即时编译 SFC 临时产物 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { Schema } from '../../红警指挥系统/core/schema';
import { buildBuildingOverviewModel } from '../models/buildingSystemModel';
import { coordRingBadgeClass, resolveFacilityCoordBadge } from '../modals/modalBuildingsHelpers';

vi.mock('toastr', () => ({
  default: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../红警指挥系统/composables/useCatalog', () => ({
  useCatalogStore: () => ({
    effectiveCatalog: {
      buildings: [
        { name: '盟军建造厂', cost: 2500, power: 0, desc: '基地核心', tags: ['军工'] },
        { name: '盟军兵营', cost: 500, power: 20, desc: '步兵训练', tags: ['军工'] },
        { name: '盟军战车工厂', cost: 2000, power: 100, desc: '装甲总装', tags: ['军工'] },
        { name: '盟军发电厂', cost: 800, power: -200, desc: '基础供电', tags: ['工业'] },
        { name: '光棱塔', cost: 1200, power: 75, desc: '外环光学防卫', tags: ['防御'] },
      ],
    },
  }),
}));

vi.mock('../../红警指挥系统/composables/store', () => ({
  in_tavern: false,
  useDataStore: () => ({
    data: Schema.parse({}),
  }),
}));

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', props: ['name', 'size'], render: () => hh('span') } };
});

const MODAL_SFC_PATH = join(__dirname, '../modals/ModalBuildings.vue');
const MODAL_COMPILED_PATH = join(__dirname, '../modals/ModalBuildings.__fd34_coord_ssr__.mts');

function stripTypeImports(code: string): string {
  return code
    .replace(/^import\s+type\s[\s\S]*?from\s+['"][^'"]+['"];?[\t ]*$/gm, '')
    .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
}

let modalCompPromise: Promise<Component> | undefined;

function loadModalBuildings(): Promise<Component> {
  modalCompPromise ??= (async () => {
    const source = readFileSync(MODAL_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: MODAL_SFC_PATH });
    if (errors.length > 0) {
      throw new Error(`${MODAL_SFC_PATH} 解析失败：${errors.map(String).join('; ')}`);
    }
    const compiled = compileScript(descriptor, {
      id: 'modalbuildingsfd34coord',
      inlineTemplate: true,
      templateOptions: {
        id: 'modalbuildingsfd34coord',
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

describe('FD-34 PKG-C · ModalBuildings 建筑相对 MCV 坐标与三环防务圈层胶囊', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('1. resolveFacilityCoordBadge：准确识别核心/内环/中环/外环，兼容显式 coord/bearing 与确定性三环兜底', () => {
    const snap = Schema.parse({
      bases: [
        {
          id: 'beipo',
          name: '北坡主基地',
          status: '运转中',
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军发电厂', state: '运转', coord: { x: -2, y: 1 } },
            { name: '盟军兵营', state: '运转', bearing: '正东 400米' },
            { name: '光棱塔', state: '运转' },
          ],
        },
      ],
    });

    const overview = buildBuildingOverviewModel(snap, null, { scope: 'base', activeBaseIndex: 0 });

    // 1) 核心：盟军建造厂 -> ◆ MCV原点 (0,0)
    const conyardFac = overview.systems.military.builtList.find(f => f.name === '盟军建造厂')!;
    const conyardBadge = resolveFacilityCoordBadge(conyardFac, snap);
    expect(conyardBadge.ring).toBe('core');
    expect(conyardBadge.ringLabel).toBe('核心');
    expect(conyardBadge.badgeText).toBe('◆ MCV原点 (0,0)');
    expect(conyardBadge.badgeClass).toBe(coordRingBadgeClass('core'));

    // 2) 内环（显式 coord: {-2, 1}）：盟军发电厂 -> ◆ 内环 · 西北·220m (-2,+1)
    const powerFac = overview.systems.industry.builtList.find(f => f.name === '盟军发电厂')!;
    const powerBadge = resolveFacilityCoordBadge(powerFac, snap);
    expect(powerBadge.ring).toBe('inner');
    expect(powerBadge.ringLabel).toBe('内环');
    expect(powerBadge.badgeText).toBe('◆ 内环 · 西北·220m (-2,+1)');
    expect(powerBadge.badgeClass).toContain('--rac-accent');

    // 3) 中环（显式 bearing: "正东 400米"）：盟军兵营 -> ◆ 中环 · 正东·400m (+4,0)
    const barracksFac = overview.systems.military.builtList.find(f => f.name === '盟军兵营')!;
    const barracksBadge = resolveFacilityCoordBadge(barracksFac, snap);
    expect(barracksBadge.ring).toBe('mid');
    expect(barracksBadge.ringLabel).toBe('中环');
    expect(barracksBadge.badgeText).toContain('◆ 中环 · 正东·400m (+4,0)');
    expect(barracksBadge.badgeClass).toContain('--rac-ok');

    // 4) 外环（确定性自动布防兜底）：光棱塔 -> ◆ 外环 · ...
    const prismFac = overview.systems.defense.builtList.find(f => f.name === '光棱塔')!;
    const prismBadge = resolveFacilityCoordBadge(prismFac, snap);
    expect(prismBadge.ring).toBe('outer');
    expect(prismBadge.ringLabel).toBe('外环');
    expect(prismBadge.badgeText).toMatch(/^◆ 外环 · /);
    expect(prismBadge.badgeClass).toContain('--rac-alert');
  });

  it('2. ModalBuildings.vue 挂载后每座已建建筑卡片均渲染 [data-test="building-coord-badge"] 并展示相对 MCV 坐标与圈层', async () => {
    const ModalComp = await loadModalBuildings();

    const snap = Schema.parse({
      bases: [
        {
          id: 'beipo',
          name: '北坡主基地',
          status: '运转中',
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军兵营', state: '运转', coord: { x: -2, y: 1 } },
            { name: '盟军战车工厂', state: '运转', coord: { x: 4, y: 0 } },
          ],
        },
      ],
    });

    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(ModalComp, {
            snapshot: snap,
            activeBaseIndex: 0,
          }),
      }),
    );

    // 军工生产体系下有 3 座已建建筑（盟军建造厂、盟军兵营、盟军战车工厂），每座均渲染 building-coord-badge
    const badges = html.match(/data-test="building-coord-badge"/g) ?? [];
    expect(badges.length).toBe(3);

    expect(html).toContain('◆ MCV原点 (0,0)');
    expect(html).toContain('◆ 中环 · 西北·220m (-2,+1)');
    expect(html).toContain('◆ 中环 · 正东·400m (+4,0)');
    expect(html).toContain('data-ring="core"');
    expect(html).toContain('data-ring="mid"');
  });
});
