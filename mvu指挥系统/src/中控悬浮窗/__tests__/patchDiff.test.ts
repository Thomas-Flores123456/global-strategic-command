/**
 * patchDiff.test.ts —— FIX-WB-01：patchDiff 全域目录检索与动态字段对比 & 入档/提升后 CatalogStore 热刷新契约
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { buildPatchDiffList, type PatchDiffCatalog } from '../models/patchDiff';

const DIR = join(__dirname, '..');
const AUTO_FILER_SRC = readFileSync(join(DIR, 'host/expansionAutoFiler.ts'), 'utf8');
const EXP_PANEL_SFC = readFileSync(join(DIR, 'panels/PanelExpansionFiling.vue'), 'utf8');

describe('FIX-WB-01 · buildPatchDiffList 全域目录与动态字段对比', () => {
  const catalog: PatchDiffCatalog = {
    buildings: [{ name: '发电厂', cost: 800, power: -200 }] as never,
    researches: [{ name: '高能激光武器', cost: 1200, eta: '3回合', prereq: '作战实验室', tier: 3 }] as never,
    productions: [{ name: '犀牛坦克', cost: 900, hp: 400, armor: 'heavy', need_building: '战车工厂' }] as never,
    retrofits: [{ name: '反应装甲改装', cost: 300, duration: '1回合' }] as never,
    projects: [{ name: '超时空传送仪工程', cost: 2500, stage: 1 }] as never,
    protocols: [{ name: '铁幕充能协议', cost: 500, cooldown: 3 }] as never,
    units: [{ name: '磁暴步兵', cost: 500, hp: 130, range: 6 }] as never,
    defenses: [{ name: '爱国者导弹', cost: 1000, power: 50, range: 12 }] as never,
  };

  it('检索 productions / retrofits / projects / protocols 并对非硬编码字段产出 modified 而非 added', () => {
    const prodDiff = buildPatchDiffList(catalog, {
      target: '犀牛坦克',
      patch: { hp: 480, armor: 'reactive' },
    });
    expect(prodDiff).toEqual([
      { path: 'hp', type: 'modified', oldValue: 400, newValue: 480 },
      { path: 'armor', type: 'modified', oldValue: 'heavy', newValue: 'reactive' },
    ]);

    const researchDiff = buildPatchDiffList(catalog, {
      target: '高能激光武器',
      patch: { eta: '2回合', prereq: '雷达站' },
    });
    expect(researchDiff).toEqual([
      { path: 'eta', type: 'modified', oldValue: '3回合', newValue: '2回合' },
      { path: 'prereq', type: 'modified', oldValue: '作战实验室', newValue: '雷达站' },
    ]);

    const retrofitDiff = buildPatchDiffList(catalog, {
      target: '反应装甲改装',
      patch: { duration: '即时' },
    });
    expect(retrofitDiff).toEqual([{ path: 'duration', type: 'modified', oldValue: '1回合', newValue: '即时' }]);

    const projectDiff = buildPatchDiffList(catalog, {
      target: '超时空传送仪工程',
      patch: { stage: 2 },
    });
    expect(projectDiff).toEqual([{ path: 'stage', type: 'modified', oldValue: 1, newValue: 2 }]);

    const protocolDiff = buildPatchDiffList(catalog, {
      target: '铁幕充能协议',
      patch: { cooldown: 2 },
    });
    expect(protocolDiff).toEqual([{ path: 'cooldown', type: 'modified', oldValue: 3, newValue: 2 }]);
  });

  it('支持 catalog.units 与 catalog.defenses 检索，同时兼容 patch.changes 载荷键名', () => {
    const unitDiff = buildPatchDiffList(catalog, {
      target: '磁暴步兵',
      changes: { hp: 160, range: 8 },
    });
    expect(unitDiff).toEqual([
      { path: 'hp', type: 'modified', oldValue: 130, newValue: 160 },
      { path: 'range', type: 'modified', oldValue: 6, newValue: 8 },
    ]);

    const defenseDiff = buildPatchDiffList(catalog, {
      target: '爱国者导弹',
      patch: { range: 15, antiAir: true },
    });
    expect(defenseDiff).toEqual([
      { path: 'range', type: 'modified', oldValue: 12, newValue: 15 },
      { path: 'antiAir', type: 'added', newValue: true },
    ]);
  });
});

describe('FIX-WB-01 · 入档与提升后热刷新 CatalogStore 契约', () => {
  it('expansionAutoFiler.ts 在入档成功后调用 useCatalogStore().refresh() 并捕获异常', () => {
    expect(AUTO_FILER_SRC).toMatch(/import\s*\{\s*useCatalogStore\s*\}\s*from\s*['"](?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useCatalog['"]/);
    expect(AUTO_FILER_SRC).toMatch(/await\s+useCatalogStore\(\)\.refresh\(\)/);
  });

  it('PanelExpansionFiling.vue 在手动入档与提升成功后调用 catalogStore.refresh() 并捕获异常', () => {
    expect(EXP_PANEL_SFC).toMatch(/import\s*\{\s*useCatalogStore\s*\}\s*from\s*['"](?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useCatalog['"]/);
    expect(EXP_PANEL_SFC).toMatch(/const\s+catalogStore\s*=\s*useCatalogStore\(\)/);
    expect(EXP_PANEL_SFC.match(/await\s+catalogStore\.refresh\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
