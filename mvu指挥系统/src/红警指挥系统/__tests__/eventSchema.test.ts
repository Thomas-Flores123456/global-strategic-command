/**
 * EVT-SCHEMA-01 · IncomeChain 实体与 Schema 扩容 —— 专项单测
 * 真源：《事件系统与资金链状态机总设计案》§3.1（CTRL-EVENT-01）/《MVP 任务包》§3.1 · §6
 * 覆盖：旧档向后兼容回填（safeParse 100%）、合法实体五态全谱解析、默认值/prefault 兑底、
 *       非法字段 fail-closed 拦截、pending_lore 暂存门扩容兼容、JSON 往返与解析确定性。
 */
import { describe, expect, it } from 'vitest';
import type { ChainFlow as ChainFlowT, ChainStatus as ChainStatusT, IncomeChain as IncomeChainT } from '../core/schema';
import { ChainFlow, ChainStatus, IncomeChain, migrateV1toV2, Schema } from '../core/schema';

/* ── 旧档样本 ───────────────────────────────────────────── */

/** v1 修真旧档（钱包 v1 形态；含既有 GirlDossier 暂存条目，无 chains 键） */
const V1_SAVE = {
  schema_version: 1,
  meta: { date: '秋·九月十八', location: '青岚山北坡' },
  economy: {
    credits: 88,
    wallet: { copper: 300, silver: 5, spirit_stone: { low: 8, mid: 1, high: 0 } },
  },
  forces: { vehicles: ['MCV'], troops: { 工程兵: 2 } },
  bases: [{ id: 'beipo', name: '北坡前哨', buildings: [{ name: '矿石精炼厂', state: '运转' }] }],
  pending_lore: [{ name: '白凌', model: '盟军基地车（MCV）首台' }],
};

/** v2 富旧档（各域在档数据齐全，同样无 chains 键） */
const V2_SAVE = {
  schema_version: 2,
  meta: { world_id: 'xiuzhen', date: '冬·腊月初三', day_count: 47, location: '青岚山北坡' },
  economy: { credits: 4200, credits_daily: 120, wallet: { 下品灵石: 8 } },
  bases: [
    {
      id: 'beipo',
      name: '北坡前哨',
      power: { gen: 60, use: 40 },
      buildings: [{ name: '矿石精炼厂', layer: '地表层', state: '运转' }],
      alerts: [],
    },
  ],
  queues: [{ type: '生产', item: '犀牛主战坦克', base: 'beipo', progress: 20, eta: '余2日' }],
  factions: [{ name: '极光生物科技', attitude: '警觉' }],
  intel: [{ src: '无线电监听', content: '巡逻队明日零点轮换防务', cred: '高' }],
  pending_data_patches: [],
};

/* ── 链条样本 ───────────────────────────────────────────── */

/** 全字段显式的合法实体（解析结果应逐值恒等） */
const FULL_CHAIN = {
  id: 'chain_crystal_smuggle_01',
  name: '灵石走私走廊',
  flow: '收入',
  rate_daily: 600,
  status: 'active',
  eff: 0.8,
  deps: { base_id: 'beipo', buildings: ['隐蔽仓库', '货运站'], world_resource: 'wb_vein_qinglan' },
  capacity: { total_yield: 12000, extracted: 3400 },
  reason: '与当地修真家族达成私下供货协议',
  updated_at_day: 47,
} as const;

const FIVE_STATUSES = ['establishing', 'active', 'distressed', 'broken', 'exhausted'] as const;

describe('EVT-SCHEMA-01 · IncomeChain 实体与 Schema 扩容', () => {
  describe('① 旧档向后兼容（验收 1：safeParse 100%＋缺省回填 []）', () => {
    it('v1 修真旧档：迁移链后 safeParse 成功，chains 自动回填 []，既有域与 GirlDossier 暂存零破坏', () => {
      const r = Schema.safeParse(migrateV1toV2(structuredClone(V1_SAVE)));
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.data.economy.chains).toEqual([]);
      expect(r.data.economy.credits).toBe(88);
      expect(r.data.economy.wallet).toMatchObject({ 铜钱: 300, 下品灵石: 8 });
      expect(r.data.pending_lore).toHaveLength(1);
      expect(r.data.pending_lore[0]).toMatchObject({ name: '白凌', model: '盟军基地车（MCV）首台' });
    });

    it('v2 富旧档：safeParse 成功，chains 自动回填 []，各域在档数据逐值保真', () => {
      const r = Schema.safeParse(structuredClone(V2_SAVE));
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.data.economy.chains).toEqual([]);
      expect(r.data.economy.credits).toBe(4200);
      expect(r.data.economy.credits_daily).toBe(120);
      expect(r.data.bases[0]?.power).toStrictEqual({ gen: 60, use: 40 });
      expect(r.data.queues[0]).toMatchObject({ type: '生产', item: '犀牛主战坦克', status: 'active' });
      expect(r.data.factions[0]).toMatchObject({ name: '极光生物科技', attitude: '警觉' });
    });

    it('归零态：Schema.parse({}) 的 economy.chains 与 pending_lore 均兑底 []', () => {
      const z0 = Schema.parse({});
      expect(z0.economy.chains).toEqual([]);
      expect(z0.pending_lore).toEqual([]);
    });
  });

  describe('② 合法实体解析（验收 2：枚举、容量、流向）', () => {
    it('全字段显式实体解析逐值恒等（toStrictEqual）', () => {
      expect(IncomeChain.parse(FULL_CHAIN)).toStrictEqual(FULL_CHAIN);
    });

    it('最小实体（仅 id/name/rate_daily）：六组默认值全量兑底（flow/status/eff/deps/capacity/reason/updated_at_day）', () => {
      expect(IncomeChain.parse({ id: 'c1', name: '旧城废料回收线', rate_daily: 120 })).toStrictEqual({
        id: 'c1',
        name: '旧城废料回收线',
        flow: '收入',
        rate_daily: 120,
        status: 'active',
        eff: 1,
        deps: { base_id: '', buildings: [], world_resource: '' },
        capacity: { total_yield: null, extracted: 0 },
        reason: '',
        updated_at_day: 0,
      });
    });

    it('五态枚举全谱：每种 ChainStatus 均可独立 parse 且取值保真', () => {
      for (const status of FIVE_STATUSES) {
        const r = IncomeChain.safeParse({ id: 'c', name: 'n', rate_daily: 0, status });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.status).toBe(status);
      }
      expect(ChainStatus.options).toEqual([...FIVE_STATUSES]);
    });

    it('流向双值：收入/支出均合法且枚举收口', () => {
      expect(ChainFlow.options).toEqual(['收入', '支出']);
      expect(IncomeChain.parse({ id: 'c', name: 'n', rate_daily: 50, flow: '支出' }).flow).toBe('支出');
    });

    it('容量语义：total_yield=null（无限）与数值蕴藏均合法；extracted 缺省 0', () => {
      const infinite = IncomeChain.parse({ id: 'c', name: 'n', rate_daily: 10 });
      expect(infinite.capacity.total_yield).toBeNull();
      const finite = IncomeChain.parse({
        id: 'c2',
        name: 'n2',
        rate_daily: 10,
        capacity: { total_yield: 500 },
      });
      expect(finite.capacity).toStrictEqual({ total_yield: 500, extracted: 0 });
    });

    it('eff 边界 0 与 1 合法（0=断电跌落 / 1=全额履约，§3.4 联动区间）', () => {
      expect(IncomeChain.parse({ id: 'c', name: 'n', rate_daily: 1, eff: 0 }).eff).toBe(0);
      expect(IncomeChain.parse({ id: 'c', name: 'n', rate_daily: 1, eff: 1 }).eff).toBe(1);
    });

    it('deps 部分提供：嵌套元素级默认兑底（base_id 显式、buildings/world_resource 补缺）', () => {
      const r = IncomeChain.parse({ id: 'c', name: 'n', rate_daily: 1, deps: { base_id: 'beipo' } });
      expect(r.deps).toStrictEqual({ base_id: 'beipo', buildings: [], world_resource: '' });
    });

    it('类型导出可用：IncomeChain/ChainFlow/ChainStatus 输出类型可注解（tsc 门直证）', () => {
      const chain: IncomeChainT = IncomeChain.parse({ id: 'x', name: 'y', rate_daily: 1 });
      const flow: ChainFlowT = chain.flow;
      const status: ChainStatusT = chain.status;
      expect([flow, status]).toEqual(['收入', 'active']);
    });
  });

  describe('③ 非法拦截（fail-closed：负额度/非法枚举/缺必填/越界）', () => {
    it('负额度拒收：rate_daily=-600 不静默取绝对值也不降级 0', () => {
      expect(IncomeChain.safeParse({ id: 'c', name: 'n', rate_daily: -600 }).success).toBe(false);
    });

    it('eff 越界拒收：1.5 与 -0.1 双向拦截（0.0~1.0 收口）', () => {
      expect(IncomeChain.safeParse({ id: 'c', name: 'n', rate_daily: 1, eff: 1.5 }).success).toBe(false);
      expect(IncomeChain.safeParse({ id: 'c', name: 'n', rate_daily: 1, eff: -0.1 }).success).toBe(false);
    });

    it('非法枚举拒收：flow=流入 / status=running', () => {
      expect(IncomeChain.safeParse({ id: 'c', name: 'n', rate_daily: 1, flow: '流入' }).success).toBe(false);
      expect(IncomeChain.safeParse({ id: 'c', name: 'n', rate_daily: 1, status: 'running' }).success).toBe(false);
    });

    it('必填缺失拒收：id / name / rate_daily 三轴各自拦截', () => {
      expect(IncomeChain.safeParse({ name: 'n', rate_daily: 1 }).success).toBe(false);
      expect(IncomeChain.safeParse({ id: 'c', rate_daily: 1 }).success).toBe(false);
      expect(IncomeChain.safeParse({ id: 'c', name: 'n' }).success).toBe(false);
    });

    it('字符串数字不宽容：rate_daily="600" 拒收（对齐 EconomyResources fail-closed 哲学）', () => {
      expect(IncomeChain.safeParse({ id: 'c', name: 'n', rate_daily: '600' }).success).toBe(false);
    });

    it('deps 非对象拒收：字符串形态不降级为空对象', () => {
      expect(IncomeChain.safeParse({ id: 'c', name: 'n', rate_daily: 1, deps: 'beipo' }).success).toBe(false);
    });

    it('根级 fail-closed：economy.chains 混入单条坏链，整树 safeParse 失败（防脏链入库）', () => {
      const r = Schema.safeParse({
        economy: { credits: 100, chains: [{ id: 'bad', name: '坏链', rate_daily: -1 }] },
      });
      expect(r.success).toBe(false);
    });
  });

  describe('④ pending_lore 外部世界书落地暂存门扩容（§3.5 契约）', () => {
    it('已物化旧档 GirlDossier 条目原样保真（真机旧档均为 parse 产物全键落盘，零破坏）', () => {
      const materialized = {
        name: '白凌',
        model: '盟军基地车（MCV）首台',
        keys: ['相位跃迁', '岚翎'],
        skills: '',
        weapons: '主武器电磁步枪。',
      };
      const r = Schema.safeParse({ pending_lore: [materialized] });
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.data.pending_lore[0]).toStrictEqual(materialized);
    });

    it('薄条目（仅 name）不再被 schema 强改形态：原样 passthrough（字段归一由 upsertDossier 解析层承接）', () => {
      const r = Schema.safeParse({ pending_lore: [{ name: '白凌' }] });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.pending_lore[0]).toStrictEqual({ name: '白凌' });
    });

    it('新势力暂存实体（非 GirlDossier 形态）安全通过 z.any() 放宽', () => {
      const factionLore = { kind: 'faction', name: '极光生物科技', attitude: '警觉', risk: '中' };
      const r = Schema.safeParse({ pending_lore: [factionLore] });
      expect(r.success).toBe(true);
      if (!r.success) return;
      expect(r.data.pending_lore[0]).toStrictEqual(factionLore);
    });

    it('缺省 pending_lore 自动回填 []（旧档零注入风险归零）', () => {
      expect(Schema.parse({}).pending_lore).toEqual([]);
    });
  });

  describe('⑤ 稳定性：JSON 往返与解析确定性（为 EVT-CHAIN-01 纯函数引擎铺路）', () => {
    const WITH_CHAINS = {
      economy: {
        credits: 1000,
        chains: [
          { ...FULL_CHAIN },
          { id: 'c2', name: '佣兵雇佣合同', flow: '支出', rate_daily: 200, status: 'establishing', eff: 0.5 },
          { id: 'c3', name: '旧城废料回收线', rate_daily: 120, status: 'broken', eff: 0, reason: '治安巡逻队封锁' },
        ],
      },
    };

    it('JSON 序列化往返无损（MVU 落盘链路保真）', () => {
      const stat = Schema.parse(structuredClone(WITH_CHAINS));
      const round = Schema.parse(JSON.parse(JSON.stringify(stat)));
      expect(round).toStrictEqual(stat);
      expect(round.economy.chains).toHaveLength(3);
    });

    it('同输入两次解析产物确定性相等（纯函数性直证）', () => {
      const a = Schema.parse(structuredClone(WITH_CHAINS));
      const b = Schema.parse(structuredClone(WITH_CHAINS));
      expect(a).toStrictEqual(b);
    });
  });
});
