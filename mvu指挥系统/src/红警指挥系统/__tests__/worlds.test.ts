import { describe, expect, it } from 'vitest';
import {
  WORLD_MANIFESTS,
  WORLD_IDS,
  getWorldManifest,
  isLegalCurrency,
  allWorldExclusiveBooks,
  type WorldAffinity,
} from '../core/worlds';

const AFFINITY: WorldAffinity[] = ['有效', '降效', '无效', '无法生产'];

describe('worlds manifest 契约校验', () => {
  it('首版两世界都已注册', () => {
    expect(WORLD_IDS).toContain('xiuzhen');
    expect(WORLD_IDS).toContain('cyber2042');
  });

  for (const [key, m] of Object.entries(WORLD_MANIFESTS)) {
    describe(`世界 ${key}`, () => {
      it('world_id 与注册键一致（唯一性锚点）', () => {
        expect(m.world_id).toBe(key);
      });
      it('display_name 非空', () => {
        expect(m.display_name.trim().length).toBeGreaterThan(0);
      });
      it('currencies 非空且无重复（wallet 白名单）', () => {
        expect(m.currencies.length).toBeGreaterThanOrEqual(1);
        expect(new Set(m.currencies).size).toBe(m.currencies.length);
      });
      it('worldbook_group 非空、每本 name 非空、无重复', () => {
        expect(m.worldbook_group.length).toBeGreaterThan(0);
        const names = m.worldbook_group.map(b => b.name);
        for (const n of names) expect(n.trim().length).toBeGreaterThan(0);
        expect(new Set(names).size).toBe(names.length);
      });
      it('world_affinities 值均为合法枚举', () => {
        for (const v of Object.values(m.world_affinities)) expect(AFFINITY).toContain(v);
      });
      it('opening_profile 字段非空', () => {
        expect(m.opening_profile.location.trim().length).toBeGreaterThan(0);
        expect(m.opening_profile.presetHint.trim().length).toBeGreaterThan(0);
      });
    });
  }

  it('通用组书跨世界共享（两世界都含通用·主建筑与航天工业）', () => {
    for (const m of Object.values(WORLD_MANIFESTS)) {
      const names = m.worldbook_group.map(b => b.name);
      expect(names).toContain('通用·主建筑');
      expect(names).toContain('通用·航天工业'); // worldbookManifest.ts 曾漏列，本表补全
    }
  });

  it('修真专属剧情书不进赛博世界组（世界隔离）', () => {
    const cyber = WORLD_MANIFESTS.cyber2042.worldbook_group.map(b => b.name);
    expect(cyber).not.toContain('剧情·北坡纪事');
    expect(cyber).not.toContain('北坡采药营地_基地布局');
    expect(cyber).not.toContain('修真·世界适配');
    expect(cyber).not.toContain('机娘·能力档案'); // 技能表现修真化，不污染赛博
  });

  it('getWorldManifest 命中/未命中', () => {
    expect(getWorldManifest('xiuzhen')?.display_name).toBe('修真正史');
    expect(getWorldManifest('不存在的世界')).toBeUndefined();
  });

  it('isLegalCurrency 白名单判定', () => {
    expect(isLegalCurrency('xiuzhen', '下品灵石')).toBe(true);
    expect(isLegalCurrency('xiuzhen', '标准信用币')).toBe(false); // 跨世界货币不通用
    expect(isLegalCurrency('cyber2042', '标准信用币')).toBe(true);
    expect(isLegalCurrency('不存在的世界', '铜钱')).toBe(false); // 非法世界不放行
  });

  it('allWorldExclusiveBooks 只含世界专属书、不含共享书', () => {
    const excl = allWorldExclusiveBooks();
    expect(excl).toContain('修真·世界适配');
    expect(excl).toContain('赛博朋克2042·世界适配');
    expect(excl).toContain('剧情·北坡纪事');
    expect(excl).toContain('机娘·能力档案'); // xiuzhen 专属，切世界时须停用
    // 共享书不得进排他停用集（否则切世界会误停共享底座）
    expect(excl).not.toContain('通用·主建筑');
    expect(excl).not.toContain('武备·盟军'); // 清源后跨世界共享
    expect(excl).not.toContain('全域战略指挥系统');
  });
});
