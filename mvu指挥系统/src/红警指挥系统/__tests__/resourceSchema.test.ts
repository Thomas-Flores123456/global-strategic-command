import { describe, expect, it } from 'vitest';
import { EconomyResources, migrateV1toV2, Schema } from '../core/schema';

/** §3.7 六柱预置小类清单（缺省值必须为 null，严禁降级为 0） */
const PRESETS = {
  nanites: ['标准纳米工料', '高精构造型纳米', '机娘修复凝胶'],
  minerals: ['铁矿石', '铜矿砂', '煤炭', '铝土矿', '稀土矿', '金银原矿', '灵石原矿'],
  materials: ['高强工程钢材', '特种防爆水泥', '再生塑料颗粒', '化工装药原料'],
  fuel: ['粗原油', '精炼柴油', '航空煤油', '灵沁原油'],
  munitions: ['步兵制式弹药', '大口径炮弹', '战术制导导弹'],
  logistics: ['工业与生活净水', '战备副食与口粮', '战地急救医药', '机械通用备件'],
} as const;

type Pillar = keyof typeof PRESETS;

describe('CTRL-RES-SCHEMA-01 · 六大战略资源 Schema 与 Null/0 状态机', () => {
  describe('三态状态机（null=未解锁 / 0=库存告罄 / >0=实物流转）', () => {
    it('EconomyResources.parse({}) 六柱齐备，预置小类缺省全为 null', () => {
      const res = EconomyResources.parse({});
      expect(Object.keys(res).sort()).toEqual(Object.keys(PRESETS).sort());
      for (const pillar of Object.keys(PRESETS) as Pillar[]) {
        expect(Object.keys(res[pillar]).sort()).toEqual([...PRESETS[pillar]].sort());
        for (const key of PRESETS[pillar]) {
          expect(res[pillar][key]).toBeNull();
        }
      }
    });

    it('null 与 0 严格区分：0 是已解锁产线的告罄态，不等同于 null', () => {
      const res = EconomyResources.parse({
        minerals: { 铁矿石: 0, 铜矿砂: null, 煤炭: 25 },
      });
      expect(res.minerals['铁矿石']).toBe(0);
      expect(res.minerals['铜矿砂']).toBeNull();
      expect(res.minerals['煤炭']).toBe(25);
    });

    it('JSON 序列化往返后 null/0 语义不降级（MVU 落盘链路保真）', () => {
      const source = EconomyResources.parse({ minerals: { 铁矿石: 0, 煤炭: 25, 铜矿砂: null } });
      const round = EconomyResources.parse(JSON.parse(JSON.stringify(source)));
      expect(round.minerals['铁矿石']).toBe(0);
      expect(round.minerals['煤炭']).toBe(25);
      expect(round.minerals['铜矿砂']).toBeNull();
    });

    it('六柱混合三态全谱：null/0/>0 同柱共存互不干扰', () => {
      const res = EconomyResources.parse({
        nanites: { 标准纳米工料: 120, 机娘修复凝胶: 0 },
        minerals: { 铁矿石: 0, 灵石原矿: null },
        materials: { 高强工程钢材: 8 },
        fuel: { 精炼柴油: 0 },
        munitions: { 步兵制式弹药: 4000 },
        logistics: { 战备副食与口粮: null, 机械通用备件: 12 },
      });
      expect(res.nanites['标准纳米工料']).toBe(120);
      expect(res.nanites['机娘修复凝胶']).toBe(0);
      expect(res.minerals['铁矿石']).toBe(0);
      expect(res.minerals['灵石原矿']).toBeNull();
      expect(res.materials['高强工程钢材']).toBe(8);
      expect(res.fuel['精炼柴油']).toBe(0);
      expect(res.munitions['步兵制式弹药']).toBe(4000);
      expect(res.logistics['战备副食与口粮']).toBeNull();
      expect(res.logistics['机械通用备件']).toBe(12);
    });
  });

  describe('动态小类弹性扩展', () => {
    it('世界特定矿物动态键（紫幽玄铁）安全通过校验并保留键值', () => {
      const stat = Schema.parse({ economy: { resources: { minerals: { 紫幽玄铁: 100 } } } });
      expect(stat.economy.resources?.minerals['紫幽玄铁']).toBe(100);
    });

    it('动态键与预置键同柱共存', () => {
      const res = EconomyResources.parse({ nanites: { 标准纳米工料: 50, 幽蓝纳米酶: 3 } });
      expect(res.nanites['标准纳米工料']).toBe(50);
      expect(res.nanites['幽蓝纳米酶']).toBe(3);
    });

    it('仅写部分柱时，其余柱自动补 null 预置（未解锁态可判）', () => {
      const res = EconomyResources.parse({ minerals: { 铁矿石: 10 } });
      expect(res.minerals['铁矿石']).toBe(10);
      for (const pillar of Object.keys(PRESETS) as Pillar[]) {
        if (pillar === 'minerals') continue;
        for (const key of PRESETS[pillar]) {
          expect(res[pillar][key]).toBeNull();
        }
      }
    });
  });

  describe('格式校验 fail-closed（防静默降级）', () => {
    it('字符串数值拒收：不静默转数字也不降级为 null/0', () => {
      expect(() => EconomyResources.parse({ minerals: { 铁矿石: '100' } })).toThrow();
      expect(() => Schema.parse({ economy: { resources: { minerals: { 铁矿石: '很多' } } } })).toThrow();
    });

    it('布尔/对象/数组值一律拒收', () => {
      expect(() => EconomyResources.parse({ fuel: { 精炼柴油: true } })).toThrow();
      expect(() => EconomyResources.parse({ fuel: { 精炼柴油: { 数量: 1 } } })).toThrow();
      expect(() => EconomyResources.parse({ fuel: { 精炼柴油: [1] } })).toThrow();
    });

    it('NaN 拒收（物理库存入口必须是合法数值语义）', () => {
      expect(() => EconomyResources.parse({ minerals: { 铁矿石: Number.NaN } })).toThrow();
    });

    it('整柱非对象形态把整树打回（fail-closed，而非把脏值降级为 0）', () => {
      expect(() => Schema.parse({ economy: { credits: 2000, resources: { minerals: '整柱非对象' } } })).toThrow();
    });
  });

  describe('挂载与向后兼容红线', () => {
    it('挂载于 economy.resources，与 credits/wallet 互不干扰', () => {
      const stat = Schema.parse({
        economy: { credits: 2000, wallet: { 铜钱: 3 }, resources: { logistics: { 战地急救医药: 7 } } },
      });
      expect(stat.economy.credits).toBe(2000);
      expect(stat.economy.wallet['铜钱']).toBe(3);
      expect(stat.economy.resources?.logistics['战地急救医药']).toBe(7);
    });

    it('归零态红线：Schema.parse({}) 不注入 resources；economy 键契约含 chains:[]（EVT-SCHEMA-01 扩容）', () => {
      const z0 = Schema.parse({});
      expect(z0.economy.resources).toBeUndefined();
      expect(z0.economy).toStrictEqual({ credits: 0, credits_daily: 0, wallet: {}, chains: [] });
    });

    it('旧档迁移零注入：migrateV1toV2 后 resources 仍缺席；v2 原生资源柱保真且幂等', () => {
      const v1 = { schema_version: 1, meta: { date: '三月初一' }, economy: { wallet: { copper: 12 } } };
      const migrated = Schema.parse(migrateV1toV2(structuredClone(v1)));
      expect(migrated.economy.resources).toBeUndefined();
      const v2 = Schema.parse({ economy: { resources: { munitions: { 战术制导导弹: 6, 大口径炮弹: 0 } } } });
      expect(v2.economy.resources?.munitions['战术制导导弹']).toBe(6);
      expect(v2.economy.resources?.munitions['大口径炮弹']).toBe(0);
      expect(migrateV1toV2(v2)).toBe(v2);
    });
  });
});
