/**
 * ModalBuildingsLiveSandbox.test.ts —— FD-39 (PKG-B) 基地建筑体系 2.0 实况三环/分层沙盘、多实例展开、电网账本与防区看板单测
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
import {
  applyBuildingInstanceMutationToVars,
  recalculateBasePower,
  toggleBuildingInstanceMode,
  toggleBuildingInstanceState,
} from '../modals/modalBuildingsHelpers';
import type { BuiltBuildingInstanceRef } from '../models/buildingSystemModel';

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
        { name: '盟军建造厂', cost: 2500, power: 0, desc: '盟军核心', tags: ['军工'] },
        { name: '苏联建造厂', cost: 2500, power: 0, desc: '苏联核心', tags: ['军工'] },
        { name: '盟军兵营', cost: 500, power: 20, desc: '步兵训练', tags: ['军工'] },
        { name: '盟军战车工厂', cost: 2000, power: 100, desc: '装甲总装', tags: ['军工'] },
        { name: '苏联战车工厂', cost: 2000, power: 100, desc: '重装总装', tags: ['军工'] },
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
const MODAL_COMPILED_PATH = join(__dirname, '../modals/ModalBuildings.__fd39_live_sandbox_ssr__.mts');

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
      id: 'modalbuildingsfd39livesandbox',
      inlineTemplate: true,
      templateOptions: {
        id: 'modalbuildingsfd39livesandbox',
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

describe('FD-39 PKG-B · ModalBuildings 基地实况三环/分层沙盘、多实例与防区看板', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('1. 默认 split 挂载时同屏渲染顶栏视图切换器、基地实况沙盘四分面板与五大体系蓝图', async () => {
    const ModalComp = await loadModalBuildings();
    const snap = Schema.parse({
      bases: [
        {
          id: 'beipo',
          name: '北坡主基地',
          status: '运转中',
          buildings: [
            { name: '盟军建造厂', state: '运转', layer: '地表层' },
            { name: '盟军发电厂', state: '运转', layer: '地表层', coord: { x: -2, y: 1 } },
          ],
          sectors: [
            {
              name: '洞口防红外伪装网',
              layer: '地表层',
              status: '正常',
              desc: '全频段热信号遮蔽与光学迷彩覆盖',
            },
          ],
        },
      ],
    });

    const html = await renderToString(
      createSSRApp({
        render: () => h(ModalComp, { snapshot: snap, activeBaseIndex: 0 }),
      }),
    );

    expect(html).toContain('data-test="building-primary-view-switch"');
    expect(html).toContain('data-test="building-view-btn-split"');
    expect(html).toContain('data-test="building-view-btn-live"');
    expect(html).toContain('data-test="building-view-btn-blueprint"');
    expect(html).toContain('data-test="building-live-sandbox-section"');
    expect(html).toContain('data-test="live-tactical-sandbox-plot"');
    expect(html).toContain('data-test="live-base-instances-panel"');
    expect(html).toContain('data-test="live-power-ledger-panel"');
    expect(html).toContain('data-test="live-sectors-board"');
    expect(html).toContain('data-test="building-blueprint-svg-wrap"');
  });

  it('2. 完整渲染多座同名建筑(#1/#2)各自坐标、在建建筑进度/ETA、多台合署 MCV、实例 addons 与电网收支明细', async () => {
    const ModalComp = await loadModalBuildings();
    const snap = Schema.parse({
      bases: [
        {
          id: 'beipo',
          name: '北坡主基地',
          status: '运转中',
          buildings: [
            { name: '盟军建造厂', state: '运转', layer: '地表层' },
            { name: '苏联建造厂', state: '运转', layer: '地表层' },
            { name: '盟军发电厂', state: '运转', layer: '地表层', coord: { x: -2, y: 1 } },
            { name: '盟军发电厂', state: '运转', layer: '地下层', coord: { x: 2, y: -1 } },
            {
              name: '苏联战车工厂',
              state: '运转',
              layer: '地表层',
              coord: { x: -4, y: 0 },
              addons: ['天启超重总装跨'],
            },
            {
              name: '盟军战车工厂',
              state: '建造中',
              layer: '地表层',
              coord: { x: 4, y: 0 },
              progress: 45,
              eta: '余1日',
            },
          ],
          sectors: [
            {
              name: '北翼地下排风竖井',
              layer: '地下层',
              status: '受损',
              desc: '深层核生化过滤与余热排放通道，东侧风门受震波轻微变形',
            },
          ],
        },
      ],
    });

    const html = await renderToString(
      createSSRApp({
        render: () => h(ModalComp, { snapshot: snap, activeBaseIndex: 0 }),
      }),
    );

    // 多 MCV 合署中枢展示
    expect(html).toContain('data-test="live-conyard-hubs"');
    expect(html).toContain('多中枢合署 ×2');
    expect(html).toContain('◆ 盟军建造厂 · 核心(0,0) · +50W');
    expect(html).toContain('◆ 苏联建造厂 · 核心(0,0) · +50W');

    // 同名 2 座盟军发电厂 (#1 / #2) 各自坐标与电网明细
    expect(html).toContain('盟军发电厂 #1');
    expect(html).toContain('盟军发电厂 #2');
    expect(html).toContain('◆ 内环 · 西北·220m (-2,+1)');
    expect(html).toContain('◆ 内环 · 东南·220m (+2,-1)');

    // 在建建筑（state: '建造中'）进度与 ETA
    expect(html).toContain('◆ 建造中 45% · 余1日');
    expect(html).toContain('data-state="建造中"');

    // 实例级 addons 扩建模块展示
    expect(html).toContain('+ 天启超重总装跨');

    // 防区看板完整渲染 name / layer / status / desc 全文 / 同层建筑与抢修按钮
    expect(html).toContain('北翼地下排风竖井');
    expect(html).toContain('[地下层]');
    expect(html).toContain('深层核生化过滤与余热排放通道，东侧风门受震波轻微变形');
    expect(html).toContain('data-test="sector-reinforce-btn"');
    expect(html).toContain('data-test="sector-repair-btn"');
    expect(html).toContain('data-test="live-sector-create-btn"');
  });

  it('3. builtList 卡片在同类建筑 > 1 座时渲染每座实例独立的 facility-instance-coord-badge 且不污染 building-coord-badge 计数', async () => {
    const ModalComp = await loadModalBuildings();
    const snap = Schema.parse({
      bases: [
        {
          id: 'beipo',
          name: '北坡主基地',
          status: '运转中',
          buildings: [
            { name: '盟军建造厂', state: '运转', layer: '地表层' },
            { name: '盟军兵营', state: '运转', layer: '地表层', coord: { x: -2, y: 1 } },
            { name: '盟军兵营', state: '运转', layer: '地下层', coord: { x: 3, y: -2 } },
          ],
        },
      ],
    });

    const html = await renderToString(
      createSSRApp({
        render: () => h(ModalComp, { snapshot: snap, activeBaseIndex: 0 }),
      }),
    );

    // 军工体系下有 2 类建筑（盟军建造厂 ×1、盟军兵营 ×2），主卡片 building-coord-badge 保持 2 个
    const mainBadges = html.match(/data-test="building-coord-badge"/g) ?? [];
    expect(mainBadges.length).toBe(2);

    // 盟军兵营因有 2 座实例，展开渲染 2 个 facility-instance-coord-badge
    const instBadges = html.match(/data-test="facility-instance-coord-badge"/g) ?? [];
    expect(instBadges.length).toBe(2);
    expect(html).toContain('◆ 中环 · 西北·220m (-2,+1)');
    expect(html).toContain('◆ 中环 · 东南·360m (+3,-2)');
  });

  it('4. BUG-R2-01b：即时拉闸停机/恢复运转与切换加速模式时，立即重算基地 power.gen / power.use 并随 bases 一同持久化落盘', async () => {
    const catalog = {
      buildings: [
        { name: '盟军建造厂', power: 0 },
        { name: '兵营', power: 20 },
        { name: '矿石精炼厂', power: 50 },
        { name: '空军指挥部', power: 40 },
        {
          name: '战车工厂',
          power: 50,
          operation: {
            conditions: [{ trigger: 'overclock', power: 80 }],
          },
        },
      ],
    };

    const snap = Schema.parse({
      bases: [
        {
          id: 'badlands',
          name: '恶土前哨主基地',
          status: '运转中',
          power: { gen: 50, use: 160 },
          buildings: [
            { name: '盟军建造厂', state: '运转', mode: '生产', layer: '地面' },
            { name: '盟军兵营', state: '运转', mode: '生产', layer: '地面' },
            { name: '盟军矿石精炼厂', state: '运转', mode: '生产', layer: '地面' },
            { name: '空军指挥部', state: '运转', mode: '生产', layer: '地面' },
            { name: '盟军战车工厂', state: '运转', mode: '生产', layer: '地面' },
          ],
        },
      ],
    });
    const storeData = structuredClone(snap);
    const vars: Record<string, unknown> = { stat_data: structuredClone(snap) };
    const updateFloorVars = vi.fn(async (_floorId: number, updater: (v: Record<string, unknown>) => Record<string, unknown>) => {
      const next = updater(vars);
      vars.stat_data = next.stat_data;
      return next;
    });
    const refresh = vi.fn();
    const onTick = vi.fn();

    const conyardInst: BuiltBuildingInstanceRef = {
      baseIndex: 0,
      baseId: 'badlands',
      baseName: '恶土前哨主基地',
      buildingIndex: 0,
      name: '盟军建造厂',
      instanceOrdinal: 1,
      state: '运转',
      mode: '生产',
      accelScope: 'global',
      layer: '地面',
      dualModeCapable: true,
    };

    const ctx = {
      snapshot: snap,
      dataStore: { data: storeData },
      floating: { floorId: 10, refresh },
      updateFloorVars: updateFloorVars as any,
      catalog,
      onTick,
    };

    // 1. 拉闸停机「盟军建造厂」→ state 变停机，且基地 power.gen 从 50 降为 0，power.use 保持 160
    await toggleBuildingInstanceState(conyardInst, ctx);
    expect(snap.bases[0].buildings[0].state).toBe('停机');
    expect(snap.bases[0].power).toEqual({ gen: 0, use: 160 });
    expect(storeData.bases[0].power).toEqual({ gen: 0, use: 160 });
    expect(((vars.stat_data as any).bases[0] as any).power).toEqual({ gen: 0, use: 160 });

    // 2. 恢复运转「盟军建造厂」→ state 恢复运转，power.gen 立即回到 50
    await toggleBuildingInstanceState({ ...conyardInst, state: '停机' }, ctx);
    expect(snap.bases[0].buildings[0].state).toBe('运转');
    expect(snap.bases[0].power).toEqual({ gen: 50, use: 160 });
    expect(((vars.stat_data as any).bases[0] as any).power).toEqual({ gen: 50, use: 160 });

    // 3. 切换「盟军战车工厂」为加速模式（命中 overclock 功耗 80）→ power.use 从 160 升至 190
    const warFactoryInst: BuiltBuildingInstanceRef = {
      baseIndex: 0,
      baseId: 'badlands',
      baseName: '恶土前哨主基地',
      buildingIndex: 4,
      name: '盟军战车工厂',
      instanceOrdinal: 1,
      state: '运转',
      mode: '生产',
      accelScope: 'global',
      layer: '地面',
      dualModeCapable: true,
    };
    await toggleBuildingInstanceMode(warFactoryInst, ctx);
    expect(snap.bases[0].buildings[4].mode).toBe('加速');
    expect(snap.bases[0].power).toEqual({ gen: 50, use: 190 });
    expect(((vars.stat_data as any).bases[0] as any).power).toEqual({ gen: 50, use: 190 });

    // 4. 验证 count/quantity 多数量建筑电力汇总
    const multiPower = recalculateBasePower(
      [
        { name: '盟军发电厂', state: '运转', count: 2 },
        { name: '盟军兵营', state: '运转', quantity: 3 },
        { name: '光棱塔', state: '停机', count: 2 },
      ],
      {
        buildings: [
          { name: '发电厂', power: -200 },
          { name: '兵营', power: 20 },
          { name: '光棱塔', power: 75 },
        ],
      },
    );
    expect(multiPower).toEqual({ gen: 400, use: 60 });
    expect(applyBuildingInstanceMutationToVars).toBeTypeOf('function');
  });
});
