import { describe, expect, it } from 'vitest';
import {
  allWorldExclusiveBooks,
  getWorldManifest,
  isLegalCurrency,
  WORLD_IDS,
  WORLD_MANIFESTS,
} from '../../红警指挥系统/core/worlds';
import {
  buildStatData,
  composeLaunchMessage,
  createMockHostAdapter,
  resolveLaunchLocation,
  syncWorldbooksForWorld,
} from '../pipeline';
import {
  CYBER2077_ERA_PRESETS,
  CYBER2077_LOCATIONS,
  DEFAULT_CYBER2077_DATE,
  defaultChoices,
  defaultRecommendedChoices,
  eraPresetsForWorld,
  findEraPreset,
  locationsForWorld,
  RECOMMENDED_WORLD_ID,
  resolveEraDirectiveForChoices,
} from '../presets';

describe('cyber2077 · 具象世界契约、全球战区部署与 2042 默认纪年', () => {
  it('WORLD_MANIFESTS 注册 cyber2077 为具象世界且标记 recommended', () => {
    expect(WORLD_IDS).toContain('cyber2077');
    expect(RECOMMENDED_WORLD_ID).toBe('cyber2077');
    const manifest = getWorldManifest('cyber2077');
    expect(manifest).toBeDefined();
    expect(manifest?.display_name).toBe('具象世界·赛博朋克2077');
    expect(manifest?.category).toBe('concrete');
    expect(manifest?.recommended).toBe(true);
    expect(manifest?.currencies).toEqual(['欧元', '标准信用币', '加密币']);
    expect(isLegalCurrency('cyber2077', '欧元')).toBe(true);
    expect(isLegalCurrency('cyber2077', '下品灵石')).toBe(false);

    const bookNames = manifest!.worldbook_group.map(b => b.name);
    expect(bookNames).toContain('具象世界·赛博朋克2077');
    expect(bookNames).not.toContain('赛博朋克2042·世界适配');
    expect(bookNames).not.toContain('修真·世界适配');
  });

  it('defaultRecommendedChoices 默认落入 cyber2077 · 恶土深处 · 2042-06-15', () => {
    const rec = defaultRecommendedChoices();
    expect(rec.worldId).toBe('cyber2077');
    expect(rec.locationId).toBe('badlands_deep');
    expect(rec.eraPresetId).toBe('2042');
    expect(rec.date).toBe(DEFAULT_CYBER2077_DATE);
    // 无参 defaultChoices() 保持修真基线兼容旧单测
    expect(defaultChoices().worldId).toBe('xiuzhen');
  });

  it('cyber2077 部署地点矩阵覆盖恶土、西澳、中东、东亚、南亚、非洲、中南美、两极与自定义', () => {
    const ids = locationsForWorld('cyber2077').map(loc => loc.id);
    expect(ids).toEqual([
      'badlands_deep',
      'west_australia',
      'mideast_meltdown',
      'nc_combat_zone',
      'pacifica_coast',
      'siberia_frontier',
      'east_asia_ghost_sea',
      'south_asia_monsoon',
      'africa_kilimanjaro',
      'latam_panama_amazon',
      'polar_antarctica_arctic',
      'custom',
    ]);
    expect(CYBER2077_LOCATIONS[0].recommended).toBe(true);
    expect(CYBER2077_LOCATIONS.at(-1)?.isCustom).toBe(true);
  });

  it('西澳大利亚（west_australia）与自定义地点（custom）正确写入 stat_data 与首楼报文（遵守 MCV 展开前零预设基地铁律 bases: []）', () => {
    const westAusChoices = {
      ...defaultRecommendedChoices(),
      locationId: 'west_australia',
    };
    const westAusStat = buildStatData(westAusChoices);
    expect(westAusStat.meta.world_id).toBe('cyber2077');
    expect(westAusStat.meta.location).toBe('西澳大利亚·珀斯外围与皮尔巴拉矿带');
    expect(westAusStat.bases).toEqual([]);
    expect(westAusStat.forces.vehicles).toEqual(['MCV（盟军）']);
    expect(westAusStat.economy.wallet).toEqual({ 欧元: 0, 标准信用币: 0, 加密币: 0 });

    const customChoices = {
      ...defaultRecommendedChoices(),
      locationId: 'custom',
      customLocationName: '南极第7深井前哨',
      customLocationRegion: '南极洲·麦克默多解冻工业谷地',
      customLocationFlavor: '依托废弃极地地热钻井掩护，周边存在企业黑科技实验室巡逻队',
    };
    const resolvedLoc = resolveLaunchLocation(customChoices);
    expect(resolvedLoc).toMatchObject({
      id: 'custom',
      name: '南极第7深井前哨',
      location: '南极洲·麦克默多解冻工业谷地',
      isCustom: true,
    });
    const customStat = buildStatData(customChoices);
    expect(customStat.bases).toEqual([]);
    expect(customStat.meta.location).toBe('南极洲·麦克默多解冻工业谷地');
    const msg = composeLaunchMessage(customChoices);
    expect(msg).toContain('- 部署地点：南极第7深井前哨（南极洲·麦克默多解冻工业谷地）');
    expect(msg).toContain('【自定义部署点环境】依托废弃极地地热钻井掩护，周边存在企业黑科技实验室巡逻队');
  });

  it('纪年预设（2042 默认 / 2045 / 2069 / 2077）与自由年份在首楼报文注入对应双轨锚点指令', () => {
    expect(eraPresetsForWorld('cyber2077')).toHaveLength(4);
    expect(CYBER2077_ERA_PRESETS[0].id).toBe('2042');
    expect(findEraPreset('2069', 'cyber2077')?.defaultDate).toBe('2069-09-01');

    const msg2042 = composeLaunchMessage(defaultRecommendedChoices());
    expect(msg2042).toContain('【时代态势锚点·2042血色拓荒期】');
    expect(msg2042).toContain('大谎言');
    expect(msg2042).toContain('黑墙');

    const msg2077 = composeLaunchMessage({
      ...defaultRecommendedChoices(),
      eraPresetId: '2077',
      date: '2077-04-01',
    });
    expect(msg2077).toContain('【时代态势锚点·2077暗黑未来】');

    // 修真世界不注入赛博时代锚点
    expect(resolveEraDirectiveForChoices(defaultChoices())).toBe('');
  });

  it('排他世界书同步：切入 cyber2077 自动停用《赛博朋克2042·世界适配》与《修真·世界适配》', async () => {
    expect(allWorldExclusiveBooks()).toContain('具象世界·赛博朋克2077');
    const adapter = createMockHostAdapter();
    adapter.globalBooks = [
      '预览·他卡自有书',
      '修真·世界适配',
      '赛博朋克2042·世界适配',
      ...WORLD_MANIFESTS.cyber2042.worldbook_group.filter(b => b.required).map(b => b.name),
    ];
    const plan = await syncWorldbooksForWorld(adapter, 'cyber2077', ['allied']);
    expect(plan.next).toContain('具象世界·赛博朋克2077');
    expect(plan.next).not.toContain('赛博朋克2042·世界适配');
    expect(plan.next).not.toContain('修真·世界适配');
    expect(plan.next).toContain('预览·他卡自有书');
  });
});
