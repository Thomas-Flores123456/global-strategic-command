/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { Schema } from '../../../红警指挥系统/core/schema';
import {
  buildActiveQueueCountMap,
  buildBaseBuildingLiveStatsMap,
  buildQueueMap,
  formatBuildCardTitle,
  type ConsoleBuildItem,
} from '../consoleBuildGridHelpers';

const SFC = readFileSync(join(__dirname, '..', 'ConsoleBuildGrid.vue'), 'utf8');

describe('FD-39 PKG-C: ConsoleBuildGrid 本基地实况微胶囊与同名多座队列合并', () => {
  it('1. buildBaseBuildingLiveStatsMap：准确统计同名多座建筑、在建实体、受损/停机、双模加速、实例级 addons 与目录级扩建模块', () => {
    const snap = Schema.parse({
      bases: [
        {
          id: 'base_1',
          name: '1号主基地',
          status: '运转中',
          buildings: [
            { name: '盟军建造厂', state: '运转', layer: '地表层' },
            { name: '盟军发电厂', state: '运转', layer: '地下层', addons: ['智能电网潮流调度中心'] },
            { name: '盟军发电厂', state: '受损', layer: '地表层' },
            { name: '盟军发电厂', state: '建造中', progress: 45, eta: '余2小时', layer: '地下层' },
            { name: '盟军战车工厂', state: '运转', mode: '加速', layer: '地表层' },
            // 目录级独立 addon 建筑（upgrade_mode === 'addon'，母体包含 盟军战车工厂 / 战车工厂）
            { name: '数字孪生与柔性生产车间', state: '运转', layer: '地表层' },
            { name: '光棱塔', state: '停机', layer: '外环防线' },
          ],
        },
        {
          id: 'base_2',
          name: '2号分基地',
          status: '运转中',
          buildings: [{ name: '苏联发电厂', state: '运转', layer: '地表层' }],
        },
      ],
    });

    const statsMap0 = buildBaseBuildingLiveStatsMap(snap, 0);

    // 盟军发电厂 & 剥离前缀名 发电厂 双向统计：2座已建（1运转+1受损）+ 1座在建 + 1项实例挂件
    const ppStats = statsMap0.get('盟军发电厂');
    expect(ppStats).toBeDefined();
    expect(ppStats).toEqual({
      builtCount: 2,
      runningCount: 1,
      underConstructionCount: 1,
      damagedCount: 1,
      stoppedCount: 0,
      accelCount: 0,
      mountedAddonCount: 1,
      layers: ['地下层', '地表层'],
    });
    expect(statsMap0.get('发电厂')).toEqual(ppStats);

    // 盟军战车工厂：1座运转 + 1座加速 + 命中目录级扩建模块「数字孪生与柔性生产车间」累加 mountedAddonCount
    const wfStats = statsMap0.get('盟军战车工厂');
    expect(wfStats).toBeDefined();
    expect(wfStats?.builtCount).toBe(1);
    expect(wfStats?.runningCount).toBe(1);
    expect(wfStats?.accelCount).toBe(1);
    expect(wfStats?.mountedAddonCount).toBe(1);
    expect(statsMap0.get('战车工厂')?.accelCount).toBe(1);
    expect(statsMap0.get('战车工厂')?.mountedAddonCount).toBe(1);

    // 光棱塔：停机状态统计
    const prismStats = statsMap0.get('光棱塔');
    expect(prismStats?.builtCount).toBe(1);
    expect(prismStats?.stoppedCount).toBe(1);

    // 切换至 2号分基地（activeBaseIndex = 1）：与 1号主基地严格隔离
    const statsMap1 = buildBaseBuildingLiveStatsMap(snap, 1);
    expect(statsMap1.get('盟军发电厂')).toBeUndefined();
    expect(statsMap1.get('苏联发电厂')?.builtCount).toBe(1);
    expect(statsMap1.get('发电厂')?.builtCount).toBe(1);
  });

  it('2. buildActiveQueueCountMap & buildQueueMap：同名多座在建/排产队列累加计数，且优先展示 active 状态项', () => {
    const snap = Schema.parse({
      bases: [
        { id: 'base_1', name: '1号主基地', status: '运转中', buildings: [] },
        { id: 'base_2', name: '2号分基地', status: '运转中', buildings: [] },
      ],
      queues: [
        {
          type: '建造',
          item: '盟军发电厂',
          base: 'base_1',
          status: 'active',
          progress: 65,
          eta: '余1小时',
          qty: 1,
          qty_done: 0,
        },
        {
          type: '建造',
          item: '盟军发电厂',
          base: 'base_1',
          status: 'queued',
          progress: 0,
          eta: '待建',
          qty: 2,
          qty_done: 0,
        },
        {
          type: '建造',
          item: '盟军发电厂',
          base: 'base_1',
          status: 'done',
          progress: 100,
          qty: 1,
          qty_done: 1,
        },
        {
          type: '建造',
          item: '盟军发电厂',
          base: 'base_2',
          status: 'active',
          progress: 20,
          qty: 1,
          qty_done: 0,
        },
        {
          type: '生产',
          item: '美国大兵（量产体）',
          base: 'base_1',
          status: 'active',
          progress: 50,
          qty: 3,
          qty_done: 1,
        },
      ],
    });

    const countMap0 = buildActiveQueueCountMap(snap, 0);
    // 1号主基地：active (1座) + queued (2座) = 3座（done 与 base_2 不计入）
    expect(countMap0.get('盟军发电厂')).toBe(3);
    expect(countMap0.get('发电厂')).toBe(3);
    // 生产项去除量产体后缀同样命中剩余在途数量 (3 - 1 = 2)
    expect(countMap0.get('美国大兵（量产体）')).toBe(2);
    expect(countMap0.get('美国大兵')).toBe(2);

    // 2号分基地：仅 1 座在建
    const countMap1 = buildActiveQueueCountMap(snap, 1);
    expect(countMap1.get('盟军发电厂')).toBe(1);

    // buildQueueMap 在多条同名队列项并存时优先保留 active（避免被排在后面的 queued/done 覆盖）
    const qMap = buildQueueMap(snap);
    expect(qMap.get('盟军发电厂')?.status).toBe('active');
    expect(qMap.get('盟军发电厂')?.progress).toBe(65);
  });

  it('3. formatBuildCardTitle：存在 liveStats 时在悬停提示中追加本基地实况摘要', () => {
    const item: ConsoleBuildItem = {
      id: 'bld-盟军发电厂',
      name: '盟军发电厂',
      category: '基建',
      subCategory: '电力设施',
      cost: 800,
      builtCount: 2,
      liveStats: {
        builtCount: 2,
        runningCount: 2,
        underConstructionCount: 1,
        damagedCount: 0,
        stoppedCount: 0,
        accelCount: 1,
        mountedAddonCount: 1,
        layers: ['地下层'],
      },
    };

    const title = formatBuildCardTitle(item, '电力设施');
    expect(title).toContain('点击查阅【盟军发电厂】战术详情 · 标签: 电力设施');
    expect(title).toContain(
      '本基地已建: 2座 (运转2) | 在建: 1座 | 加速模式: 1座 | 扩建挂件: 1项 | 层位: 地下层',
    );
  });

  it('4. ConsoleBuildGrid.vue 模板契约：包含队列合并徽标与已建/在建/加速/受损/扩建实况微胶囊及 v-memo 响应式依赖', () => {
    expect(SFC).toMatch(/data-test="build-card-queue-badge"/);
    expect(SFC).toMatch(/data-test="build-card-built-pill"/);
    expect(SFC).toMatch(/data-test="build-card-constructing-pill"/);
    expect(SFC).toMatch(/data-test="build-card-accel-pill"/);
    expect(SFC).toMatch(/data-test="build-card-damaged-pill"/);
    expect(SFC).toMatch(/data-test="build-card-addon-pill"/);
    expect(SFC).toMatch(/item\.liveStats\?\.builtCount/);
    expect(SFC).toMatch(/item\.liveStats\?\.underConstructionCount/);
    expect(SFC).toMatch(/item\.liveStats\?\.damagedCount/);
    expect(SFC).toMatch(/item\.liveStats\?\.accelCount/);
    expect(SFC).toMatch(/item\.liveStats\?\.mountedAddonCount/);
    expect(SFC).toMatch(/item\.activeQueueCount/);
  });

  it('5. 当目录同时存在阵营专属卡（盟军发电厂）与通用槽位卡（发电厂）时，传入 distinctCatalogBuildingNames 不跨卡污染在建计数', () => {
    const snap = Schema.parse({
      bases: [
        {
          id: 'base_1',
          name: '1号主基地',
          status: '运转中',
          buildings: [
            { name: '盟军建造厂', state: '运转', layer: '地表层' },
            { name: '盟军发电厂', state: '建造中', layer: '地下层' },
            { name: '盟军兵营', state: '建造中', layer: '地表层' },
          ],
        },
      ],
      queues: [
        {
          type: '建造',
          item: '盟军发电厂',
          base: '1号主基地',
          status: 'active',
          progress: 0,
          qty: 1,
          qty_done: 0,
        },
      ],
    });
    const distinctCatalog = new Set(['盟军发电厂', '发电厂', '兵营']);
    const statsMap = buildBaseBuildingLiveStatsMap(snap, 0, distinctCatalog);
    const qCountMap = buildActiveQueueCountMap(snap, 0, distinctCatalog);

    // 盟军发电厂与发电厂同在目录中作为独立卡片存在：盟军发电厂在建 1 座，通用发电厂不被动承接在建计数
    expect(statsMap.get('盟军发电厂')?.underConstructionCount).toBe(1);
    expect(statsMap.get('发电厂')).toBeUndefined();
    expect(qCountMap.get('盟军发电厂')).toBe(1);
    expect(qCountMap.get('发电厂')).toBeUndefined();

    // 盟军兵营不在目录中，仅通用「兵营」在目录中：继续通过剥离前缀双向映射
    expect(statsMap.get('兵营')?.underConstructionCount).toBe(1);
  });
});
