import { describe, expect, it } from 'vitest';
import { Schema } from '../../../红警指挥系统/core/schema';
import {
  buildBaseMotherBuildingCache,
  buildBuiltCountMap,
  buildCompletedTechAndProtocolSet,
  checkBaseHasFactionMotherBuilding,
  computeBuildQuickStatusCounts,
  isBuildItemFavorited,
  loadBuildFavoritesFromStorage,
  matchBuildQuickStatus,
  NON_STANDALONE_UPGRADE_BUILDING_NAMES,
  resolveEffectiveFilterScope,
  resolveModernizedProductionUnit,
  resolveProductionBuiltCount,
  saveBuildFavoritesToStorage,
  shouldSkipBuildingEntry,
  sortBuildGridItemsWithFavorites,
  toggleBuildFavoriteInSet,
  type ConsoleBuildItem,
} from '../consoleBuildGridHelpers';

describe('FD-22 Track C (BLD-MOD-GRID-01): 右侧建造/生产面板纯挂件过滤、低阶常驻与现代改直产', () => {
  it('1. 建造面板过滤：23 项 standalone=false 的纯升级包与扩建模块不在新建网格裸露（在建中队列除外）', () => {
    expect(NON_STANDALONE_UPGRADE_BUILDING_NAMES.size).toBe(23);

    // 纯升级包（standalone: false）未在建时跳过
    expect(
      shouldSkipBuildingEntry({
        b: { name: '先进光棱塔升级', cost: 400, standalone: false },
        tags: ['防御'],
        builtCount: 0,
        q: undefined,
      }),
    ).toBe(true);

    // 附着扩建挂件（standalone: false）未在建时跳过
    expect(
      shouldSkipBuildingEntry({
        b: { name: '天启超重总装跨', cost: 1500, standalone: false },
        tags: ['工业'],
        builtCount: 0,
        q: undefined,
      }),
    ).toBe(true);

    // 若已在队列中建造，则在网格保留显示进度
    expect(
      shouldSkipBuildingEntry({
        b: { name: '先进光棱塔升级', cost: 400, standalone: false },
        tags: ['防御'],
        builtCount: 0,
        q: {
          type: '建造',
          item: '先进光棱塔升级',
          base: 'base_main',
          progress: 50,
          eta: '30分钟',
          status: 'active',
          started_at: '1972-05-01T08:00',
          total_minutes: 60,
          spent_minutes: 30,
          qty: 1,
          qty_done: 0,
          cost_paid: true,
          min_days_lock: 0,
          hold: false,
        },
      }),
    ).toBe(false);
  });

  it('2. 分基地低阶建筑常驻保留 + 跨代高阶主体建筑双轨直建：standalone !== false 的建筑始终保留', () => {
    // 低阶基础建筑在分基地未建时常驻可建
    expect(
      shouldSkipBuildingEntry({
        b: { name: '盟军战车工厂', cost: 2000 },
        tags: ['工业'],
        builtCount: 0,
        q: undefined,
      }),
    ).toBe(false);
    expect(
      shouldSkipBuildingEntry({
        b: { name: '简易船坞', cost: 800 },
        tags: ['工业'],
        builtCount: 0,
        q: undefined,
      }),
    ).toBe(false);

    // 跨代高阶主体建筑（standalone: true, upgrade_mode: 'replace'）支持平地直建
    expect(
      shouldSkipBuildingEntry({
        b: { name: '扩大版自动化战车工厂', cost: 4500, standalone: true },
        tags: ['工业'],
        builtCount: 0,
        q: undefined,
      }),
    ).toBe(false);
    expect(
      shouldSkipBuildingEntry({
        b: { name: '量子超算中心', cost: 6000, standalone: true },
        tags: ['科研'],
        builtCount: 0,
        q: undefined,
      }),
    ).toBe(false);
  });

  it('3. 生产面板现代化直产切换：解锁对应改装科技后自动切换为 upgraded_name 并标记现代改', () => {
    const snapLocked = Schema.parse({
      tech: { done: ['复合装甲与主战坦克工程'] },
    });
    const lockedRes = resolveModernizedProductionUnit({
      cleanName: 'M1A1灰熊主战坦克',
      rawName: 'M1A1灰熊主战坦克（量产体）',
      snapshot: snapLocked,
    });
    expect(lockedRes.isModernized).toBe(false);
    expect(lockedRes.displayName).toBe('M1A1灰熊主战坦克');

    const snapUnlocked = Schema.parse({
      tech: { done: ['复合装甲与主战坦克工程', 'M1A2 SEPv3灰熊混动改装包', '天启坦克现代改装套件研发'] },
    });
    const m1Res = resolveModernizedProductionUnit({
      cleanName: 'M1A1灰熊主战坦克',
      rawName: 'M1A1灰熊主战坦克（量产体）',
      snapshot: snapUnlocked,
    });
    expect(m1Res.isModernized).toBe(true);
    expect(m1Res.displayName).toBe('M1A2 SEPv3混动灰熊主战坦克');
    expect(m1Res.baseUnitName).toBe('M1A1灰熊主战坦克');
    expect(m1Res.retrofitName).toBe('M1A2 SEPv3灰熊混动改装工程');

    const apocRes = resolveModernizedProductionUnit({
      cleanName: '天启重型坦克',
      rawName: '天启重型坦克（量产体）',
      snapshot: snapUnlocked,
    });
    expect(apocRes.isModernized).toBe(true);
    expect(apocRes.displayName).toBe('天启决战型重型坦克');
  });

  it('4. 同族在役计数共享：基础型号与现代改型号合并计入 builtCount（共享 max_count 上限）', () => {
    const snap = Schema.parse({
      forces: {
        vehicles: ['天启重型坦克', '天启决战型重型坦克', '天启决战型重型坦克'],
      },
    });
    const countMap = buildBuiltCountMap(snap, 0);
    const totalCount = resolveProductionBuiltCount(
      countMap,
      '天启重型坦克',
      '天启重型坦克（量产体）',
      [],
      '天启决战型重型坦克',
    );
    expect(totalCount).toBe(3);
  });

  it('5. PKG-B (B2): 预计算 completedSet 与 baseMotherBuildingCache 循环外提与判定等价性', () => {
    const snap = Schema.parse({
      tech: { done: ['M1A2 SEPv3灰熊混动改装包'] },
      bases: [
        {
          id: 'b_allied',
          name: '前线基地',
          status: '运转中',
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军战车工厂', state: '运转' },
          ],
        },
      ],
    });

    const precomputedSet = buildCompletedTechAndProtocolSet(snap.tech.done, snap.protocols);
    const resWithPrecomputed = resolveModernizedProductionUnit({
      cleanName: 'M1A1灰熊主战坦克',
      rawName: 'M1A1灰熊主战坦克（量产体）',
      snapshot: snap,
      precomputedCompletedSet: precomputedSet,
    });
    expect(resWithPrecomputed.isModernized).toBe(true);
    expect(resWithPrecomputed.displayName).toBe('M1A2 SEPv3混动灰熊主战坦克');

    const conyardFactions = new Set(['allied']);
    const cache = buildBaseMotherBuildingCache(snap.bases[0], conyardFactions);
    expect(
      checkBaseHasFactionMotherBuilding(snap.bases[0], ['战车工厂'], 'allied', conyardFactions, cache),
    ).toBe(true);
    expect(
      checkBaseHasFactionMotherBuilding(snap.bases[0], ['战车工厂'], 'soviet', conyardFactions, cache),
    ).toBe(false);
  });

  it('6. 建造面板收藏机制（星标持久化 + 列表置顶 + 现代改换名保留星标）与智能筛选（搜索/收藏自动全库穿透 + 状态胶囊计数）', () => {
    const mockStorage = new Map<string, string>();
    const storageAdapter = {
      getItem: (k: string) => mockStorage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mockStorage.set(k, v);
      },
    };

    const tankItem: ConsoleBuildItem = {
      id: 'prod-M1A1灰熊主战坦克',
      name: 'M1A2 SEPv3混动灰熊主战坦克',
      baseUnitName: 'M1A1灰熊主战坦克',
      category: '生产',
      subCategory: '陆军',
      cost: 700,
      builtCount: 2,
    };
    const basicInfantry: ConsoleBuildItem = {
      id: 'prod-美国大兵',
      name: '美国大兵',
      category: '生产',
      subCategory: '人员',
      cost: 200,
      builtCount: 0,
    };

    let favSet = loadBuildFavoritesFromStorage(storageAdapter);
    expect(favSet.size).toBe(0);

    favSet = toggleBuildFavoriteInSet(favSet, tankItem);
    saveBuildFavoritesToStorage(favSet, storageAdapter);

    const reloadedFavSet = loadBuildFavoritesFromStorage(storageAdapter);
    expect(isBuildItemFavorited(tankItem, reloadedFavSet)).toBe(true);
    expect(isBuildItemFavorited(basicInfantry, reloadedFavSet)).toBe(false);

    tankItem.isFavorite = true;
    basicInfantry.isFavorite = false;

    const sorted = sortBuildGridItemsWithFavorites([basicInfantry, tankItem], list => [...list]);
    expect(sorted[0]?.id).toBe('prod-M1A1灰熊主战坦克');

    const counts = computeBuildQuickStatusCounts([basicInfantry, tankItem]);
    expect(counts).toEqual({ all: 2, fav: 1, active_queue: 0, built: 1 });
    expect(matchBuildQuickStatus(tankItem, 'fav')).toBe(true);
    expect(matchBuildQuickStatus(basicInfantry, 'fav')).toBe(false);
    expect(matchBuildQuickStatus(tankItem, 'built')).toBe(true);

    // 搜索词或仅看收藏自动穿透全库
    expect(resolveEffectiveFilterScope({ explicitScope: 'current', searchQuery: '', statusFilter: 'all' })).toBe('current');
    expect(resolveEffectiveFilterScope({ explicitScope: 'current', searchQuery: '灰熊', statusFilter: 'all' })).toBe('all');
    expect(resolveEffectiveFilterScope({ explicitScope: 'current', searchQuery: '', statusFilter: 'fav' })).toBe('all');
    expect(resolveEffectiveFilterScope({ explicitScope: 'current', searchQuery: '', statusFilter: 'active_queue' })).toBe('all');
  });
});
