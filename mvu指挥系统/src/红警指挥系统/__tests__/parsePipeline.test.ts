import { describe, expect, it } from 'vitest';
import { parseMessageText } from '../parse/parsePipeline';
import { migrateV1toV2, Schema } from '../core/schema';

const zero = () => Schema.parse({});
const xiuzhen = () => Schema.parse({ meta: { world_id: 'xiuzhen' } });

describe('13 · schema 归零验证', () => {
  it('Schema.parse({}) 全零键树', () => {
    const z0 = zero();
    expect(z0).toMatchObject({
      schema_version: 2,
      meta: { world_id: '', date: '', day_count: 0, location: '' },
      economy: { credits: 0, credits_daily: 0, wallet: {} },
      exposure: { value: 0, trend: '', last_change: '' },
      bases: [],
      queues: [],
      tech: { done: [] },
      forces: { girls: [], troops: {}, command_cap: '', vehicles: [], ammo: {} },
      factions: [],
      intel: [],
      intel_archived: [],
      codex: [],
      quests: { active: [], done_count: 0 },
      options: [],
    });
  });
});

describe('P5 · schema v1→v2 迁移', () => {
  const v1 = {
    schema_version: 1,
    meta: { date: '秋·九月十八', location: '青岚山' },
    economy: {
      credits: 88,
      wallet: { copper: 300, silver: 5, spirit_stone: { low: 8, mid: 1, high: 0 } },
    },
    forces: { vehicles: ['MCV'], troops: { 工程兵: 2 } },
    queues: [{ type: '生产', item: '测试载具', base: 'beipo', progress: 20 }],
    pending_lore: [{ name: '白凌' }],
  };

  it('旧档确定性迁移，保留现有域并扁平化钱包', () => {
    const source = structuredClone(v1);
    const migrated = Schema.parse(migrateV1toV2(source));
    expect(source).toEqual(v1);
    expect(migrated).toMatchObject({
      schema_version: 2,
      meta: { world_id: 'xiuzhen', date: '秋·九月十八', location: '青岚山' },
      economy: { credits: 88, wallet: { 铜钱: 300, 银两: 5, 下品灵石: 8, 中品灵石: 1, 上品灵石: 0 } },
      forces: { vehicles: ['MCV'], troops: { 工程兵: 2 } },
      queues: [{ type: '生产', item: '测试载具', base: 'beipo', progress: 20 }],
      pending_lore: [{ name: '白凌' }],
    });
  });

  it('v2 幂等；未来版本与脏结构不被迁移器伪装修好', () => {
    const v2 = Schema.parse({
      schema_version: 2,
      meta: { world_id: 'cyber2042' },
      economy: { wallet: { 标准信用币: 12 } },
    });
    expect(migrateV1toV2(v2)).toBe(v2);
    expect(() => Schema.parse({ schema_version: 3 })).toThrow();
    expect(() => Schema.parse({ schema_version: 1, economy: { wallet: '坏钱包' } })).toThrow();
  });

  it('解析基线迁移只记留痕，不回退 S1-B 队列身份', () => {
    const result = parseMessageText('', v1, {});
    expect(result.data.schema_version).toBe(2);
    expect(result.data.queues[0]).toMatchObject({ type: '生产', item: '测试载具', base: 'beipo' });
    expect(result.issues.some(issue => /迁移到 v2/.test(issue.message))).toBe(true);
  });

  it('world_id 为系统只读，钱袋仅接收当前世界白名单货币', () => {
    const result = parseMessageText(
      '<战况>\nworld_id: cyber2042\n钱袋:\n  铜钱: 9\n  标准信用币: 30\n</战况>',
      xiuzhen(),
      {},
    );
    expect(result.data.meta.world_id).toBe('xiuzhen');
    expect(result.data.economy.wallet['铜钱']).toBe(9);
    expect(result.data.economy.wallet['标准信用币']).toBeUndefined();
    expect(result.quarantine.some(item => item.path === '钱袋.标准信用币')).toBe(true);
  });
});

describe('9 · 键级🔴 / 块级🔴基线照落', () => {
  it('未知键→键级🔴不拖累全块', () => {
    const r = parseMessageText('<战况>\n资金: 500\n神秘字段: 乱七八糟\n</战况>', zero(), {});
    expect(r.data.economy.credits).toBe(500); // 其余键照入
    expect(r.quarantine.some(q => q.scope === 'key' && /无法映射/.test(q.error))).toBe(true);
  });
  it('整块非容器（纯描述/YAML 崩） → 块级🔴 + 基线照落 + applied=false', () => {
    const base = Schema.parse({ economy: { credits: 777 } });
    // LLM 写成纯描述而非 YAML 键值 → 解析得 scalar 字符串（非容器），整块无法入库
    const r = parseMessageText('<战况>\n这是一段没有任何键值对的纯描述文字啦啦啦\n</战况>', base, {});
    expect(r.data).toEqual(base); // 基线照落
    expect(r.applied).toBe(false);
    expect(r.quarantine.some(q => q.scope === 'block')).toBe(true);
  });
});

describe('10 · 重复战况深合并 / 初始状态', () => {
  it('两块战况后者胜', () => {
    const r = parseMessageText('<战况>\n资金: 100\n</战况>\n<战况>\n资金: 200\n</战况>', zero(), {});
    expect(r.data.economy.credits).toBe(200);
  });
  it('<初始状态> 非首楼🟡忽略', () => {
    const r = parseMessageText('<初始状态>\n资金: 5000\n</初始状态>', zero(), { isFirstFloor: false });
    expect(r.data.economy.credits).toBe(0);
    expect(r.issues.some(i => /初始状态/.test(i.message))).toBe(true);
  });
  it('<初始状态> 首楼正确覆盖', () => {
    const r = parseMessageText('<初始状态>\n资金: 5000\n地点: 青岚山\n</初始状态>', zero(), { isFirstFloor: true });
    expect(r.data.economy.credits).toBe(5000);
    expect(r.data.meta.location).toBe('青岚山');
  });
});

describe('11 · 指令联动', () => {
  it('完成研究 → 收集收讫声明、不直达账本（F2-乙：入账归三色门统一裁决）', () => {
    const base = Schema.parse({ queues: [{ type: '研究', item: '相位折射涂层', base: '', progress: 100, eta: '' }] });
    const r = parseMessageText('<战况>\n操作:\n  - 完成: 相位折射涂层\n</战况>', base, {});
    expect(r.data.queues).toHaveLength(1); // 队列不再被 splice
    expect(r.data.tech.done).toHaveLength(0); // tech.done 不再直写
    expect(r.operationCompletions).toEqual([expect.objectContaining({ item: '相位折射涂层' })]);
  });
  it('完成建造 → 收集收讫声明，建筑状态不由解析层直改', () => {
    const base = Schema.parse({
      bases: [
        {
          id: 'b',
          name: '北坡',
          location: '',
          status: '隐蔽中',
          power: { gen: 0, use: 0 },
          buildings: [{ name: '战车工厂', layer: '', state: '建造中', progress: 90 }],
          alerts: [],
        },
      ],
      queues: [{ type: '建造', item: '战车工厂', base: '北坡', progress: 100, eta: '' }],
    });
    const r = parseMessageText('<战况>\n操作:\n  - 完成: 战车工厂\n</战况>', base, {});
    expect(r.data.queues).toHaveLength(1);
    expect(r.data.bases[0].buildings[0].state).toBe('建造中');
    expect(r.operationCompletions).toEqual([expect.objectContaining({ item: '战车工厂' })]);
  });
  it('取消 → 仅移除', () => {
    const base = Schema.parse({ queues: [{ type: '生产', item: '谍报无人机', base: '', progress: 10, eta: '' }] });
    const r = parseMessageText('<战况>\n操作:\n  - 取消: 谍报无人机\n</战况>', base, {});
    expect(r.data.queues).toHaveLength(0);
  });
  it('完成目标不存在 → 仍收集声明（存在性裁决归门：OVERRUN no_txn）；取消目标不存在仍 🟡R18', () => {
    const done = parseMessageText('<战况>\n操作:\n  - 完成: 不存在的东西\n</战况>', zero(), {});
    expect(done.operationCompletions).toHaveLength(1);
    expect(done.issues.some(i => /不存在/.test(i.message))).toBe(false);
    const cancel = parseMessageText('<战况>\n操作:\n  - 取消: 不存在的东西\n</战况>', zero(), {});
    expect(cancel.issues.some(i => /不存在/.test(i.message))).toBe(true);
  });
});

describe('S1-B · 队列基地唯一定位', () => {
  const twoBases = () =>
    Schema.parse({
      bases: [
        {
          id: 'alpha-id',
          name: '北坡基地',
          buildings: [{ name: '战车工厂', state: '建造中' }],
        },
        {
          id: 'beta-id',
          name: '南港基地',
          buildings: [{ name: '战车工厂', state: '建造中' }],
        },
      ],
    });

  it('新三类队列必须显式提供基地；合法唯一名称归一为 Base.id', () => {
    const single = Schema.parse({ bases: [{ id: 'alpha-id', name: '北坡基地', buildings: [] }] });
    for (const type of ['研究', '建造', '生产']) {
      const missing = parseMessageText(`<战况>\n队列:\n  - 项目: 测试${type}\n    类型: ${type}\n</战况>`, single, {});
      expect(missing.data.queues).toEqual([]);
      expect(missing.applied).toBe(false);
      expect(missing.quarantine.some(item => /必须显式提供/.test(item.error))).toBe(true);
    }

    const explicit = parseMessageText(
      '<战况>\n队列:\n  - 项目: 测试生产\n    类型: 生产\n    基地: 北坡基地\n</战况>',
      single,
      {},
    );
    expect(explicit.data.queues[0]).toMatchObject({ item: '测试生产', type: '生产', base: 'alpha-id' });
  });

  it('F7：新建队列事务出生即 queued（schema 默认值保旧档 active 不动回档，升格归带宽门）；既有事务状态不被重写', () => {
    const single = Schema.parse({ bases: [{ id: 'alpha-id', name: '北坡基地', buildings: [] }] });
    const created = parseMessageText(
      '<战况>\n队列:\n  - 项目: 新建研究\n    类型: 研究\n    基地: 北坡基地\n</战况>',
      single,
      {},
    );
    expect(created.data.queues[0].status).toBe('queued');

    const withActive = Schema.parse({
      bases: [{ id: 'alpha-id', name: '北坡基地', buildings: [] }],
      queues: [{ type: '研究', item: '老研究', base: 'alpha-id', progress: 40 }],
    });
    const updated = parseMessageText('<战况>\n队列:\n  - 项目: 老研究\n    进度: 70\n</战况>', withActive, {});
    expect(updated.data.queues[0].status).toBe('active'); // 既有 active 不被解析层降格，裁决归引擎③′回检
    expect(updated.data.queues[0].progress).toBe(70);
  });

  it('既有旧空 base 队列可更新；多基地新空队列仍拒绝且不污染状态', () => {
    const legacy = Schema.parse({
      queues: [{ type: '生产', item: '旧生产', base: '', progress: 10 }],
    });
    const updated = parseMessageText('<战况>\n队列:\n  - 项目: 旧生产\n    进度: 50\n</战况>', legacy, {});
    expect(updated.data.queues[0]).toMatchObject({ item: '旧生产', base: '', progress: 50 });

    const baseline = twoBases();
    const rejected = parseMessageText('<战况>\n队列:\n  - 项目: 测试生产\n    类型: 生产\n</战况>', baseline, {});
    expect(rejected.data).toEqual(baseline);
    expect(rejected.applied).toBe(false);
    expect(rejected.quarantine.some(item => /必须显式提供/.test(item.error))).toBe(true);
  });

  it('多基地唯一旧空队列可用显式 Base.id 原位迁移，不复制第二条', () => {
    const baseline = Schema.parse({
      ...twoBases(),
      queues: [{ type: '建造', item: '旧工厂', base: '', progress: 20 }],
    });
    const migrated = parseMessageText(
      '<战况>\n队列:\n  - 项目: 旧工厂\n    类型: 建造\n    基地: beta-id\n    进度: 70\n</战况>',
      baseline,
      {},
    );
    expect(migrated.data.queues).toEqual([
      expect.objectContaining({ item: '旧工厂', type: '建造', base: 'beta-id', progress: 70 }),
    ]);
  });

  it('多基地旧空队列取消也须显式 Base.id；显式消歧后只删除唯一旧候选', () => {
    const baseline = Schema.parse({
      ...twoBases(),
      queues: [{ type: '生产', item: '旧载具', base: '', progress: 40 }],
    });
    const missing = parseMessageText('<战况>\n操作:\n  - 取消: 旧载具\n</战况>', baseline, {});
    expect(missing.data).toEqual(baseline);
    expect(missing.quarantine.some(item => /显式 Base\.id/.test(item.error))).toBe(true);

    const cancelled = parseMessageText(
      '<战况>\n操作:\n  - 取消: 旧载具\n    类型: 生产\n    基地: alpha-id\n</战况>',
      baseline,
      {},
    );
    expect(cancelled.data.queues).toEqual([]);
  });

  it('多基地旧空队列完成：显式 Base.id 随声明携带；未提供基地不再 parse 层拦截（归门消歧）', () => {
    const baseline = Schema.parse({
      ...twoBases(),
      bases: twoBases().bases.map(base => ({
        ...base,
        buildings: [{ name: '旧工厂', state: '建造中' }],
      })),
      queues: [{ type: '建造', item: '旧工厂', base: '', progress: 100 }],
    });
    const missing = parseMessageText('<战况>\n操作:\n  - 完成: 旧工厂\n</战况>', baseline, {});
    expect(missing.data).toEqual(baseline);
    expect(missing.operationCompletions).toHaveLength(1);
    expect(missing.operationCompletions[0].base).toBeUndefined();

    const completed = parseMessageText(
      '<战况>\n操作:\n  - 完成: 旧工厂\n    类型: 建造\n    基地: beta-id\n</战况>',
      baseline,
      {},
    );
    expect(completed.data.queues).toHaveLength(1); // F2-乙：不再 splice
    expect(completed.data.bases.map(base => base.buildings[0].state)).toEqual(['建造中', '建造中']);
    expect(completed.operationCompletions).toEqual([
      expect.objectContaining({ item: '旧工厂', type: '建造', base: 'beta-id' }),
    ]);
  });

  it('允许不同基地存在同名建造队列，并把唯一旧基地名称归一为 Base.id', () => {
    const result = parseMessageText(
      `<战况>
队列:
  - 项目: 战车工厂
    类型: 建造
    基地: 北坡基地
    进度: 20
  - 项目: 战车工厂
    类型: 建造
    基地: beta-id
    进度: 60
</战况>`,
      twoBases(),
      {},
    );
    expect(result.data.queues).toHaveLength(2);
    expect(result.data.queues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item: '战车工厂', type: '建造', base: 'alpha-id', progress: 20 }),
        expect.objectContaining({ item: '战车工厂', type: '建造', base: 'beta-id', progress: 60 }),
      ]),
    );
  });

  it('更新同名队列必须用类型与基地消歧；缺失消歧信息时零变更', () => {
    const baseline = Schema.parse({
      ...twoBases(),
      queues: [
        { type: '建造', item: '战车工厂', base: 'alpha-id', progress: 20 },
        { type: '建造', item: '战车工厂', base: 'beta-id', progress: 60 },
      ],
    });
    const ambiguous = parseMessageText('<战况>\n队列:\n  - 项目: 战车工厂\n    进度: 90\n</战况>', baseline, {});
    expect(ambiguous.data.queues.map(queue => queue.progress)).toEqual([20, 60]);
    expect(ambiguous.quarantine.some(item => /定位不唯一/.test(item.error))).toBe(true);

    const exact = parseMessageText(
      '<战况>\n队列:\n  - 项目: 战车工厂\n    类型: 建造\n    基地: beta-id\n    进度: 90\n</战况>',
      baseline,
      {},
    );
    expect(exact.data.queues.map(queue => queue.progress)).toEqual([20, 90]);
  });

  it('完成建造歧义不再 parse 层拦截（多候选 REJECTED 归门）；显式消歧随声明携带', () => {
    const baseline = Schema.parse({
      ...twoBases(),
      queues: [
        { type: '建造', item: '战车工厂', base: 'alpha-id', progress: 100 },
        { type: '建造', item: '战车工厂', base: 'beta-id', progress: 100 },
      ],
    });
    const ambiguous = parseMessageText('<战况>\n操作:\n  - 完成: 战车工厂\n</战况>', baseline, {});
    expect(ambiguous.data.queues).toHaveLength(2);
    expect(ambiguous.data.bases.map(base => base.buildings[0].state)).toEqual(['建造中', '建造中']);
    expect(ambiguous.issues.some(issue => /目标不唯一/.test(issue.message))).toBe(false);
    expect(ambiguous.operationCompletions).toHaveLength(1);
    expect(ambiguous.operationCompletions[0].base).toBeUndefined();

    const exact = parseMessageText(
      '<战况>\n操作:\n  - 完成: 战车工厂\n    类型: 建造\n    基地: beta-id\n</战况>',
      baseline,
      {},
    );
    expect(exact.data.queues).toHaveLength(2);
    expect(exact.data.bases.map(base => base.buildings[0].state)).toEqual(['建造中', '建造中']);
    expect(exact.operationCompletions).toEqual([
      expect.objectContaining({ item: '战车工厂', type: '建造', base: 'beta-id' }),
    ]);
  });

  it('旧空 base 建造队列完成：单/多基地均只收集声明（基地解析归门内 baseMatches）', () => {
    const ambiguousBase = Schema.parse({
      ...twoBases(),
      queues: [{ type: '建造', item: '战车工厂', base: '', progress: 100 }],
    });
    const ambiguous = parseMessageText('<战况>\n操作:\n  - 完成: 战车工厂\n</战况>', ambiguousBase, {});
    expect(ambiguous.data.queues).toHaveLength(1);
    expect(ambiguous.data.bases.map(base => base.buildings[0].state)).toEqual(['建造中', '建造中']);
    expect(ambiguous.operationCompletions).toHaveLength(1);

    const uniqueBase = Schema.parse({
      bases: [{ id: 'alpha-id', name: '北坡基地', buildings: [{ name: '战车工厂', state: '建造中' }] }],
      queues: [{ type: '建造', item: '战车工厂', base: '', progress: 100 }],
    });
    const compatible = parseMessageText('<战况>\n操作:\n  - 完成: 战车工厂\n</战况>', uniqueBase, {});
    expect(compatible.data.queues).toHaveLength(1);
    expect(compatible.data.bases[0].buildings[0].state).toBe('建造中');
    expect(compatible.operationCompletions).toHaveLength(1);
  });

  it('生产完成：队列基地引用无效时解析层只收集声明（匹配与拦截归门）', () => {
    const baseline = Schema.parse({
      ...twoBases(),
      queues: [{ type: '生产', item: '测试载具', base: '不存在基地', progress: 100 }],
    });
    const result = parseMessageText('<战况>\n操作:\n  - 完成: 测试载具\n    类型: 生产\n</战况>', baseline, {});
    expect(result.data.queues).toHaveLength(1);
    expect(result.operationCompletions).toEqual([expect.objectContaining({ item: '测试载具', type: '生产' })]);
  });

  it('研究队列按 type+item 全局唯一；生产完成收集声明且不触碰 forces', () => {
    const research = parseMessageText(
      `<战况>
队列:
  - 项目: 测试研究
    类型: 研究
    基地: alpha-id
    进度: 20
  - 项目: 测试研究
    类型: 研究
    基地: beta-id
    进度: 80
</战况>`,
      twoBases(),
      {},
    );
    expect(research.data.queues).toHaveLength(1);
    expect(research.data.queues[0]).toMatchObject({ type: '研究', item: '测试研究', base: 'beta-id', progress: 80 });

    const productionBase = Schema.parse({
      ...twoBases(),
      queues: [{ type: '生产', item: '测试载具', base: 'alpha-id', progress: 100 }],
      forces: { vehicles: [], troops: {} },
    });
    const production = parseMessageText(
      '<战况>\n操作:\n  - 完成: 测试载具\n    类型: 生产\n    基地: alpha-id\n</战况>',
      productionBase,
      {},
    );
    expect(production.data.queues).toHaveLength(1); // F2-乙：完成不再 splice，归三色门裁决
    expect(production.data.forces.vehicles).toEqual([]);
    expect(production.data.forces.troops).toEqual({});
    expect(production.operationCompletions).toEqual([
      expect.objectContaining({ item: '测试载具', type: '生产', base: 'alpha-id' }),
    ]);
  });
});

describe('12 · 空输入 / 纯正文', () => {
  it('空输入', () => {
    const base = Schema.parse({ economy: { credits: 42 } });
    const r = parseMessageText('', base, {});
    expect(r.data).toEqual(base);
    expect(r.applied).toBe(false);
    expect(r.issues).toEqual([]);
  });
  it('纯正文无 tag', () => {
    const base = Schema.parse({ economy: { credits: 42 } });
    const r = parseMessageText('今天天气不错，没有任何标签。', base, {});
    expect(r.data).toEqual(base);
    expect(r.applied).toBe(false);
    expect(r.issues).toEqual([]);
  });
});

describe('4 · 中文标点 / 单引号 / 尾逗号 / True/None', () => {
  it('中文标点 flow + True/None + 单引号', () => {
    const raw = "<战况>\n钱袋：{铜币：300，银两：5}\n地点: '青岚山'\n</战况>";
    const r = parseMessageText(raw, xiuzhen(), {});
    expect(r.data.economy.wallet['铜钱']).toBe(300);
    expect(r.data.economy.wallet['银两']).toBe(5);
    expect(r.data.meta.location).toBe('青岚山');
    expect(r.issues.some(i => i.rule === 'R17')).toBe(true);
  });
});

describe('5 · 键名漂移 / 枚举漂移', () => {
  it('名字/Name 键名漂移', () => {
    const r = parseMessageText('<战况>\n势力:\n  - 名字: 钱家\n    态度: 敌意\n</战况>', zero(), {});
    expect(r.data.factions[0]).toMatchObject({ name: '钱家', attitude: '敌意' });
  });
  it('枚举漂移 科技类→科技🟡', () => {
    const r = parseMessageText('<图鉴>\n- 名称: 磁暴\n  类别: 科技类\n</图鉴>', zero(), {});
    expect(r.data.codex[0].kind).toBe('科技');
    expect(r.issues.some(i => i.rule === 'R18')).toBe(true);
  });
});

describe('6 · delta 语义', () => {
  it('资金变化 +120', () => {
    const base = Schema.parse({ economy: { credits: 1000 } });
    const r = parseMessageText('<战况>\n资金变化: +120\n</战况>', base, {});
    expect(r.data.economy.credits).toBe(1120);
  });
  it('资金变化 -30', () => {
    const base = Schema.parse({ economy: { credits: 1000 } });
    const r = parseMessageText('<战况>\n资金变化: -30\n</战况>', base, {});
    expect(r.data.economy.credits).toBe(970);
  });
  it('绝对值+delta 同现 → 绝对优先🟡', () => {
    const base = Schema.parse({ economy: { credits: 1000 } });
    const r = parseMessageText('<战况>\n资金: 500\n资金变化: +120\n</战况>', base, {});
    expect(r.data.economy.credits).toBe(500);
    expect(r.issues.some(i => i.rule === 'R18' && /绝对/.test(i.message))).toBe(true);
  });
  it('兵力变化 record delta', () => {
    const base = Schema.parse({ forces: { troops: { 美国大兵: 4 } } });
    const r = parseMessageText('<战况>\n部队:\n  兵力:\n    美国大兵变化: -1\n    工程兵: 3\n</战况>', base, {});
    expect(r.data.forces.troops).toMatchObject({ 美国大兵: 3, 工程兵: 3 });
  });
});

describe('7 · clamp 越界', () => {
  it('暴露度 15 → 10', () => {
    const r = parseMessageText('<战况>\n暴露度: 15\n</战况>', zero(), {});
    expect(r.data.exposure.value).toBe(10);
    expect(r.issues.some(i => i.rule === 'R18' && /clamp/.test(i.message))).toBe(true);
  });
  it('进度 120 → 100', () => {
    const base = Schema.parse({ bases: [{ id: 'alpha-id', name: '北坡基地', buildings: [] }] });
    const r = parseMessageText(
      '<战况>\n队列:\n  - 项目: X\n    类型: 研究\n    基地: alpha-id\n    进度: 120\n</战况>',
      base,
      {},
    );
    expect(r.data.queues[0].progress).toBe(100);
  });
});

describe('8 · codex 强转 / 缺名称元素隔离', () => {
  it('params 数字值强转 string', () => {
    const r = parseMessageText('<图鉴>\n- 名称: X\n  类别: 科技\n  参数: {造价: 1200, 工期: 6}\n</图鉴>', zero(), {});
    expect(r.data.codex[0].params).toEqual({ 造价: '1200', 工期: '6' });
  });
  it('缺名称元素→该元素🔴其余入库', () => {
    const r = parseMessageText('<战况>\n势力:\n  - 名称: 钱家\n    态度: 敌意\n  - 态度: 中立\n</战况>', zero(), {});
    expect(r.data.factions).toHaveLength(1);
    expect(r.data.factions[0].name).toBe('钱家');
    expect(r.quarantine.some(q => q.scope === 'element' && /定位键/.test(q.error))).toBe(true);
  });
});

describe('1 · happy path 映射全域', () => {
  it('战况+图鉴完整正例各路径落地', () => {
    const raw = `前文废话
<战况>
日期: 秋·九月十八
天数: 48
地点: 青岚山北坡
资金: 1634
日结: 120
钱袋:
  铜币: 2000
  银两: 15
  灵石: {下品: 8, 中品: 1, 上品: 0}
暴露度: 2.5
暴露趋势: +0.02/日
暴露事件: MH-6夜间试飞
基地:
  - 名称: 北坡主基地
    状态: 警戒
    电力: {发电: 150, 用电: 120}
    警报: [电力缺口]
    建筑:
      - 名称: 相位实验室
        层位: 地下二层
        状态: 建造中
        进度: 60
        预计: 2日
队列:
  - 项目: 相位折射涂层
    类型: 研究
    基地: 北坡主基地
    进度: 80
    预计: 1日
部队:
  机娘:
    - 名称: 谭雅
      职务: 夜间侦察
      状态: 轻损
  兵力:
    美国大兵: 4
    工程兵: 3
  弹药: {5.56mm: 尚可}
  载具: [MH-6轻型直升机]
  指挥上限: 7/12
势力:
  - 名称: 沈三刀
    态度: 警觉
    情报: 近日频繁打探营地位置
    风险: 中
情报:
  - 来源: 云雀侦察
    内容: 镇东商队携带制式武器
    日期: 秋·九月十八
    可信度: 高
任务:
  - 名称: 翎州来书·第二封
    进度: 已回信
    要点: 对方索要丹方
完成任务数变化: +1
选项:
  - 文本: 派云雀夜间侦察镇东商队
    标记: 侦察
    代价: 电力+5
</战况>
<图鉴>
- 名称: 湍流护盾
  类别: 科技
  简介: 以灵气湍流偏折弹道的近防护盾
  参数: {层级: T2, 科技线: 防护}
</图鉴>`;
    const r = parseMessageText(raw, xiuzhen(), { isFirstFloor: false });
    expect(r.applied).toBe(true);
    expect(r.quarantine).toEqual([]);
    const d = r.data;
    expect(d.meta).toMatchObject({ date: '秋·九月十八', day_count: 48, location: '青岚山北坡' });
    expect(d.economy.credits).toBe(1634);
    expect(d.economy.credits_daily).toBe(120);
    expect(d.economy.wallet).toMatchObject({ 铜钱: 2000, 银两: 15, 下品灵石: 8, 中品灵石: 1, 上品灵石: 0 });
    expect(d.exposure).toMatchObject({ value: 2.5, trend: '+0.02/日', last_change: 'MH-6夜间试飞' });
    expect(d.bases[0]).toMatchObject({
      id: '北坡主基地',
      name: '北坡主基地',
      status: '警戒',
      power: { gen: 150, use: 120 },
      alerts: ['电力缺口'],
    });
    expect(d.bases[0].buildings[0]).toMatchObject({
      name: '相位实验室',
      layer: '地下二层',
      state: '建造中',
      progress: 60,
      eta: '2日',
    });
    expect(d.queues[0]).toMatchObject({
      item: '相位折射涂层',
      type: '研究',
      base: '北坡主基地',
      progress: 80,
      eta: '1日',
    });
    expect(d.forces.girls[0]).toMatchObject({ name: '谭雅', duty: '夜间侦察', hp: '轻损' });
    expect(d.forces.troops).toMatchObject({ 美国大兵: 4, 工程兵: 3 });
    expect(d.forces.ammo).toMatchObject({ '5.56mm': '尚可' });
    expect(d.forces.vehicles).toEqual(['MH-6轻型直升机']);
    expect(d.forces.command_cap).toBe('7/12');
    expect(d.factions[0]).toMatchObject({
      name: '沈三刀',
      attitude: '警觉',
      intel: '近日频繁打探营地位置',
      risk: '中',
    });
    expect(d.intel[0]).toMatchObject({ src: '云雀侦察', content: '镇东商队携带制式武器', cred: '高' });
    expect(d.quests.active[0]).toMatchObject({ name: '翎州来书·第二封', progress: '已回信', note: '对方索要丹方' });
    expect(d.quests.done_count).toBe(1);
    expect(d.options[0]).toMatchObject({ text: '派云雀夜间侦察镇东商队', tag: '侦察', cost: '电力+5' });
    expect(d.codex[0]).toMatchObject({
      name: '湍流护盾',
      kind: '科技',
      desc: '以灵气湍流偏折弹道的近防护盾',
      params: { 层级: 'T2', 科技线: '防护' },
    });
  });
});

describe('2 · L0 畸形标签容忍', () => {
  it('<战况|> 畸形开标签', () => {
    const r = parseMessageText('<战况|>\n资金: 500\n</战况>', zero(), {});
    expect(r.data.economy.credits).toBe(500);
  });
  it('＜战况＞ 全角标签', () => {
    const r = parseMessageText('＜战况＞\n资金: 600\n＜/战况＞', zero(), {});
    expect(r.data.economy.credits).toBe(600);
  });
  it('属性垃圾开标签', () => {
    const r = parseMessageText('<战况 class="x" data-y=1>\n资金: 700\n</战况>', zero(), {});
    expect(r.data.economy.credits).toBe(700);
  });
  it('``` 围栏包裹', () => {
    const r = parseMessageText('<战况>\n```yaml\n资金: 800\n```\n</战况>', zero(), {});
    expect(r.data.economy.credits).toBe(800);
  });
});

describe('3 · 闭合错拼 / 未闭合截断', () => {
  it('闭合错拼编辑距离1 认领', () => {
    const r = parseMessageText('<图鉴>\n- 名称: 磁暴线圈\n  类别: 建筑\n</图签>', zero(), {});
    expect(r.data.codex[0]).toMatchObject({ name: '磁暴线圈', kind: '建筑' });
  });
  it('未闭合 → 截断🟡 + 内容仍入库', () => {
    const r = parseMessageText('<战况>\n资金: 900', zero(), {});
    expect(r.data.economy.credits).toBe(900);
    expect(r.events.some(e => e.layer === 'L0' && e.light === '🟡')).toBe(true);
  });
});

describe('14 · <机娘档案> → pending_lore 延迟提交暂存', () => {
  it('完整档案（中文字段+散文）入 pending_lore', () => {
    const raw = [
      '<机娘档案>',
      '名称: 苏离',
      '型号: F-47首台',
      '触发词: 静默电行, 群鸦',
      '形态机制: 常态人形收拢，作战态展开变后掠翼面。',
      '能力: |-',
      '  · 静默电行（核心）：全电推进静音巡航，声学特征近似夜枭。',
      '  · 群鸦：释放六具协同无人机，编织侦察打击网。',
      '结构短板: 翼面展开时雷达反射面积骤增。',
      '武器: 主武器机载激光；副武器格斗导弹；底牌为一次性电磁脉冲弹。',
      '暴露分档: 🟢 静音巡航 ／ 🟡 无人机群展开 ／ 🔴 电磁脉冲释放。',
      '平衡位置: 空军线穿透侦察位。',
      '化名: 苏家远房表妹·苏离',
      '社会外壳: 投亲落脚的绣坊帮工。',
      '外观: 银灰短发，作战态背部展开翼面。',
      '性格: 寡言，观察先于行动。',
      '当前状态: 完好，初诞适应期。',
      '</机娘档案>',
    ].join('\n');
    const r = parseMessageText(raw, zero(), {});
    expect(r.applied).toBe(true);
    expect(r.data.pending_lore).toHaveLength(1);
    const d = r.data.pending_lore[0];
    expect(d).toMatchObject({ name: '苏离', model: 'F-47首台' });
    expect(d.keys).toEqual(['静默电行', '群鸦']);
    expect(d.skills).toContain('静默电行');
    expect(d.exposure).toContain('🔴');
    expect(d.alias).toBe('苏家远房表妹·苏离');
    expect(r.quarantine).toHaveLength(0);
  });
  it('触发词支持数组形态', () => {
    const r = parseMessageText('<机娘档案>\n名称: 岚翎\n触发词:\n  - 相位跃迁\n  - 岚翎\n</机娘档案>', zero(), {});
    expect(r.data.pending_lore[0].keys).toEqual(['相位跃迁', '岚翎']);
  });
  it('按名 upsert：同名二次出现合并而非重复建档', () => {
    const first = parseMessageText('<机娘档案>\n名称: 岚翎\n性格: 温吞。\n</机娘档案>', zero(), {});
    const second = parseMessageText('<机娘档案>\n名称: 岚翎\n武器: 主武器电磁步枪。\n</机娘档案>', first.data, {});
    expect(second.data.pending_lore).toHaveLength(1);
    expect(second.data.pending_lore[0]).toMatchObject({ personality: '温吞。', weapons: '主武器电磁步枪。' });
  });
  it('缺名称 → element 隔离，同块其余成员照入', () => {
    const r = parseMessageText('<机娘档案>\n- 性格: 无名者。\n- 名称: 有名者\n  性格: 正常。\n</机娘档案>', zero(), {});
    expect(r.data.pending_lore).toHaveLength(1);
    expect(r.data.pending_lore[0].name).toBe('有名者');
    expect(r.quarantine.some(q => q.tag === '机娘档案' && q.error === '缺少名称')).toBe(true);
  });
  it('未知字段 → 键级隔离不拖累档案本体', () => {
    const r = parseMessageText('<机娘档案>\n名称: 岚翎\n神秘字段: 乱写\n</机娘档案>', zero(), {});
    expect(r.data.pending_lore).toHaveLength(1);
    expect(r.quarantine.some(q => /机娘档案\[岚翎\]/.test(q.path ?? ''))).toBe(true);
  });
  it('与 <战况>/<图鉴> 同楼共存互不干扰', () => {
    const raw =
      '<战况>\n资金: 300\n</战况>\n<图鉴>\n- 名称: 相位跃迁装置\n  类别: 装备\n</图鉴>\n<机娘档案>\n名称: 岚翎\n</机娘档案>';
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.economy.credits).toBe(300);
    expect(r.data.codex).toHaveLength(1);
    expect(r.data.pending_lore).toHaveLength(2);
    expect(r.data.pending_lore.map((x: Record<string, unknown>) => x.name)).toEqual(['相位跃迁装置', '岚翎']);
  });
});

describe('15 · <数据更新> → pending_data_patches 动态补丁暂存（§3.12）', () => {
  it('标准 YAML 格式提取：目标、操作、更新载荷、理由落入 pending_data_patches', () => {
    const raw = [
      '<数据更新>',
      '目标: 战车工厂',
      '操作: patch',
      '更新:',
      '  outputs:',
      '    resources:',
      '      标准纳米工料: 10',
      '  tags:',
      '    - 纳米喷涂',
      '    - 快速维修',
      '理由: 指挥官与白凌现场对战车工厂进行了技术改装，加装纳米喷涂泊位',
      '</数据更新>',
    ].join('\n');
    const r = parseMessageText(raw, zero(), {});
    expect(r.applied).toBe(true);
    expect(r.data.pending_data_patches).toHaveLength(1);
    const p = r.data.pending_data_patches[0];
    expect(p.target).toBe('战车工厂');
    expect(p.operation).toBe('patch');
    expect(p.patch).toEqual({
      outputs: {
        resources: {
          标准纳米工料: 10,
        },
      },
      tags: ['纳米喷涂', '快速维修'],
    });
    expect(p.reason).toContain('指挥官与白凌');
    expect(p.status).toBe('pending');
    expect(r.quarantine).toHaveLength(0);
  });

  it('JSON 格式与 replace 全量操作提取', () => {
    const raw = `
<数据更新>
{
  "目标": "战斗实验室",
  "操作": "replace",
  "更新": {
    "power": 120,
    "tier": 2
  },
  "理由": "升级至 T2 科技中枢"
}
</数据更新>
`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.applied).toBe(true);
    expect(r.data.pending_data_patches).toHaveLength(1);
    const p = r.data.pending_data_patches[0];
    expect(p.target).toBe('战斗实验室');
    expect(p.operation).toBe('replace');
    expect(p.patch).toEqual({ power: 120, tier: 2 });
    expect(p.reason).toBe('升级至 T2 科技中枢');
  });

  it('缺失目标（target）→ 隔离至 quarantine，不存入 pending', () => {
    const raw = '<数据更新>\n更新:\n  cost: 500\n</数据更新>';
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.pending_data_patches).toHaveLength(0);
    expect(r.quarantine.some(q => q.tag === '数据更新' && q.error.includes('缺少目标'))).toBe(true);
  });

  it('更新载荷非对象（如纯标量）→ 隔离至 quarantine', () => {
    const raw = '<数据更新>\n目标: 战车工厂\n更新: 纯文本非法载荷\n</数据更新>';
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.pending_data_patches).toHaveLength(0);
    expect(r.quarantine.some(q => q.tag === '数据更新' && q.error.includes('必须为键值映射对象'))).toBe(true);
  });

  it('安全红线拦截：严禁注入 uid 字段', () => {
    const raw = `
<数据更新>
目标: 战车工厂
更新:
  uid: 999
  cost: 1500
</数据更新>
`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.pending_data_patches).toHaveLength(0);
    expect(r.quarantine.some(q => q.error.includes('安全红线拦截') && q.error.includes('uid'))).toBe(true);
  });

  it('安全红线拦截：严禁注入 key / order / comment / content 等元数据或正文字段', () => {
    const forbiddenKeys = ['key', 'keys', 'order', 'comment', 'content', '正文', '自然叙述'];
    for (const key of forbiddenKeys) {
      const raw = `
<数据更新>
目标: 战车工厂
更新:
  ${key}: 非法篡改值
  power: 30
</数据更新>
`;
      const r = parseMessageText(raw, zero(), {});
      expect(r.data.pending_data_patches).toHaveLength(0);
      expect(r.quarantine.some(q => q.error.includes('安全红线拦截'))).toBe(true);
    }
  });

  it('同一楼层多个补丁与数组形态同时提取', () => {
    const raw = `
<数据更新>
- 目标: 战车工厂
  更新:
    power: 40
- 目标: 矿石精炼厂
  更新:
    cost: 1800
</数据更新>
`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.pending_data_patches).toHaveLength(2);
    expect(r.data.pending_data_patches[0].target).toBe('战车工厂');
    expect(r.data.pending_data_patches[1].target).toBe('矿石精炼厂');
  });

  it('幂等去重：同一目标相同补丁内容不重复堆叠', () => {
    const raw = '<数据更新>\n目标: 战车工厂\n更新:\n  power: 40\n</数据更新>';
    const first = parseMessageText(raw, zero(), {});
    const second = parseMessageText(raw, first.data, {});
    expect(second.data.pending_data_patches).toHaveLength(1);
    expect(second.data.pending_data_patches[0].target).toBe('战车工厂');
  });

  it('与 <战况>、<图鉴>、<机娘档案> 同楼四标签共存互不干扰', () => {
    const raw = `
<战况>
资金: 888
</战况>
<图鉴>
- 名称: 战术雷达阵列
  类别: 建筑
</图鉴>
<机娘档案>
名称: 岚翎
</机娘档案>
<数据更新>
目标: 战车工厂
更新:
  power: 45
理由: 电力优化
</数据更新>
`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.economy.credits).toBe(888);
    expect(r.data.codex).toHaveLength(1);
    expect(r.data.pending_lore).toHaveLength(2);
    expect(r.data.pending_lore.map((x: Record<string, unknown>) => x.name)).toEqual(['战术雷达阵列', '岚翎']);
    expect(r.data.pending_data_patches).toHaveLength(1);
    expect(r.data.pending_data_patches[0].target).toBe('战车工厂');
  });
});

describe('16 · <扩展档案> → pending_expansions 延迟提交暂存（CTRL-CHATBOOK-02）', () => {
  it('完整扩展档案（中文字段+散文+可选数据块）入 pending_expansions', () => {
    const raw = `
<扩展档案>
名称: 等离子脉冲炮
类别: 科技
简介: 突破性重型能量武器技术。
参数:
  造价: 3500
  耗电: 120
  前置: 纳米核心, 离子物理学
设定: |
  该技术利用高频磁场约束等离子射流，在射程内产生毁灭性的瞬时热爆。
  对重型装甲单位与固定工事具备穿透性杀伤能力。
关键词: 脉冲炮, 等离子, 能量武器
数据:
  type: technology
  tier: 3
  power_demand: 120
</扩展档案>
`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.applied).toBe(true);
    expect(r.data.pending_expansions).toHaveLength(1);
    const exp = r.data.pending_expansions[0];
    expect(exp.name).toBe('等离子脉冲炮');
    expect(exp.kind).toBe('科技');
    expect(exp.desc).toBe('突破性重型能量武器技术。');
    expect(exp.params).toEqual({ 造价: '3500', 耗电: '120', 前置: '纳米核心, 离子物理学' });
    expect(exp.detail).toContain('该技术利用高频磁场约束等离子射流');
    expect(exp.keys).toEqual(['脉冲炮', '等离子', '能量武器']);
    expect(exp.data).toEqual({ type: 'technology', tier: 3, power_demand: 120 });
  });

  it('类别枚举归一化与别名解析（tech → 科技，building → 建筑）', () => {
    const raw = `
<扩展档案>
- 名称: 试验型空冷反应堆
  kind: building
  desc: 紧凑型聚变供能设施。
- 名称: 穿梭机
  类别: 载具类
  desc: 战术人员转运艇。
</扩展档案>
`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.pending_expansions).toHaveLength(2);
    expect(r.data.pending_expansions[0].kind).toBe('建筑');
    expect(r.data.pending_expansions[1].kind).toBe('载具');
  });

  it('非法类别（如 阵营 / 其他）被 safeParse 拦截隔离，而 势力/组织/财团 归一为 势力 入账（BUG-R2-25）', () => {
    const rawInvalid = `
<扩展档案>
名称: 非法阵营实体
类别: 阵营
desc: 阵营不走扩展档案通道。
</扩展档案>
`;
    const r = parseMessageText(rawInvalid, zero(), {});
    expect(r.data.pending_expansions).toHaveLength(0);
    expect(r.quarantine.some(q => q.tag === '扩展档案' && /未通过校验/.test(q.error))).toBe(true);

    const rawFaction = `
<扩展档案>
名称: 太平洋波能重工联合会
类别: 势力
desc: 环太平洋波能矿脉与重工代工财团。
</扩展档案>
`;
    const r2 = parseMessageText(rawFaction, zero(), {});
    expect(r2.quarantine).toHaveLength(0);
    expect(r2.data.pending_expansions).toHaveLength(1);
    expect(r2.data.pending_expansions[0].kind).toBe('势力');
  });

  it('缺少名称隔离进 quarantine', () => {
    const raw = `
<扩展档案>
类别: 科技
desc: 缺少名称的条目。
</扩展档案>
`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.pending_expansions).toHaveLength(0);
    expect(r.quarantine.some(q => q.tag === '扩展档案' && q.error === '缺少名称')).toBe(true);
  });

  it('非对象元素隔离进 quarantine', () => {
    const raw = `
<扩展档案>
- 纯文本字符串而非对象
</扩展档案>
`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.pending_expansions).toHaveLength(0);
    expect(r.quarantine.some(q => q.tag === '扩展档案' && q.error === '扩展档案元素非对象')).toBe(true);
  });

  it('同名实体多次输入幂等更新字段，不产生重复条目', () => {
    const raw1 = `
<扩展档案>
名称: 轨道补给舱
类别: 装备
desc: 基础版补给舱。
</扩展档案>
`;
    const raw2 = `
<扩展档案>
名称: 轨道补给舱
类别: 装备
desc: 改进型补给舱。
设定: 强化耐热外壳与减速降落伞。
</扩展档案>
`;
    const first = parseMessageText(raw1, zero(), {});
    expect(first.data.pending_expansions).toHaveLength(1);
    expect(first.data.pending_expansions[0].desc).toBe('基础版补给舱。');

    const second = parseMessageText(raw2, first.data, {});
    expect(second.data.pending_expansions).toHaveLength(1);
    expect(second.data.pending_expansions[0].desc).toBe('改进型补给舱。');
    expect(second.data.pending_expansions[0].detail).toBe('强化耐热外壳与减速降落伞。');
  });

  it('六标签共存（战况/图鉴/机娘档案/数据更新/扩展档案）互不干扰', () => {
    const raw = `
<战况>
资金: 999
</战况>
<图鉴>
- 名称: 战术雷达阵列
  类别: 建筑
</图鉴>
<机娘档案>
名称: 岚翎
</机娘档案>
<数据更新>
目标: 战车工厂
更新:
  power: 45
理由: 电力优化
</数据更新>
<扩展档案>
名称: 脉冲炮台
类别: 建筑
desc: 重型防御设施。
</扩展档案>
`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.economy.credits).toBe(999);
    expect(r.data.codex).toHaveLength(1);
    expect(r.data.pending_lore).toHaveLength(2);
    expect(r.data.pending_lore.map((x: Record<string, unknown>) => x.name)).toEqual(['战术雷达阵列', '岚翎']);
    expect(r.data.pending_data_patches).toHaveLength(1);
    expect(r.data.pending_expansions).toHaveLength(1);
    expect(r.data.pending_expansions[0].name).toBe('脉冲炮台');
  });

  it('BUG-LIVE-15a & BUG-LIVE-15b：#46 楼真机 <图鉴> 新增荒坂恶土巡逻队同步生成 pending_lore，且 <扩展档案> 同名异类（人物·铁砧 + 地点·铁砧）双双解析入账', () => {
    const rawFloor46 = [
      '<图鉴>',
      '- 名称: 荒坂恶土巡逻队',
      '  类别: 单位',
      '  简介: 荒坂集团驻夜之城外围恶土的装甲治安巡逻分队，配备轻型浮空车与军用义体小队。',
      '</图鉴>',
      '',
      '<扩展档案>',
      '- 名称: 铁砧',
      '  类别: 人物',
      '  代号: 铁砧',
      '  所属势力: 达科塔恶土中间人网络',
      '  身份: 重装军火掮客',
      '  态度: 友善',
      '  信任度: 65',
      '  简介: 常年活跃于红峰荒原的退伍义体改装师与重型军火中间人。',
      '  触发词: [铁砧, 军火掮客铁砧]',
      '- 名称: 铁砧',
      '  类别: 地点',
      '  简介: 红峰荒原北麓的一处废弃露天铁矿坑与地下黑市交易聚落，因形似巨型铁砧而得名。',
      '  触发词: [铁砧矿坑, 铁砧聚落]',
      '</扩展档案>',
    ].join('\n');

    const res = parseMessageText(rawFloor46, zero(), { floorId: 46 });
    expect(res.applied).toBe(true);
    expect(res.quarantine).toHaveLength(0);

    // BUG-LIVE-15b：<图鉴> 新增「荒坂恶土巡逻队」进入 codex 并同步进入 pending_lore
    expect(res.data.codex.some(c => c.name === '荒坂恶土巡逻队' && c.kind === '人员')).toBe(true);
    expect(res.data.pending_lore).toHaveLength(1);
    expect(res.data.pending_lore[0]).toMatchObject({
      id: 'lore_荒坂恶土巡逻队',
      name: '荒坂恶土巡逻队',
      kind: '人员',
      source_floor: 46,
    });
    expect(String((res.data.pending_lore[0] as Record<string, unknown>).summary)).toContain(
      '荒坂集团驻夜之城外围恶土的装甲治安巡逻分队',
    );

    // BUG-LIVE-15a：<扩展档案> 同名异类「人物·铁砧」与「地点·铁砧」双双进入 pending_expansions，零丢失
    expect(res.data.pending_expansions).toHaveLength(2);
    expect(res.data.pending_expansions.map(e => `${e.kind}·${e.name}`)).toEqual(['人物·铁砧', '地点·铁砧']);
    expect(res.data.pending_expansions[1]).toMatchObject({
      name: '铁砧',
      kind: '地点',
      keys: ['铁砧矿坑', '铁砧聚落'],
    });
    expect(res.data.pending_expansions[1].desc).toContain('红峰荒原北麓的一处废弃露天铁矿坑');
  });
});

describe('CTRL-INJ-RES-01 · 战报「资源」键 → economy.resources 六柱深合并（§3.7）', () => {
  it('单柱多小类合法消费：缺席柱补 null 预置，「资源」键不再被隔离', () => {
    const raw = ['<战况>', '日期: 秋·九月二十', '资源:', '  矿产:', '    铁矿石: 25', '    煤炭: 0', '</战况>'].join(
      '\n',
    );
    const r = parseMessageText(raw, zero(), {});
    expect(r.applied).toBe(true);
    expect(r.data.economy.resources?.minerals['铁矿石']).toBe(25);
    expect(r.data.economy.resources?.minerals['煤炭']).toBe(0); // 告罄透传，不升格为 null
    expect(r.data.economy.resources?.minerals['铜矿砂']).toBeUndefined(); // 同柱未提及小类不注入（schema 仅对缺席柱补 null 预置）
    expect(r.data.economy.resources?.nanites['标准纳米工料']).toBeNull(); // 缺席柱自动补预置
    expect(r.quarantine.some(q => q.path?.startsWith('资源'))).toBe(false);
  });

  it('多柱 + 深合并：未提及的柱/小类保持原值，绝不整记录重置', () => {
    const base = Schema.parse({
      economy: { resources: { minerals: { 铁矿石: 10 }, fuel: { 精炼柴油: 5 } } },
    });
    const raw = ['<战况>', '资源:', '  矿产: {煤炭: 7}', '  后勤: {战备副食与口粮: 12}', '</战况>'].join('\n');
    const r = parseMessageText(raw, base, {});
    expect(r.data.economy.resources?.minerals['铁矿石']).toBe(10); // 未提及小类保持原值
    expect(r.data.economy.resources?.minerals['煤炭']).toBe(7);
    expect(r.data.economy.resources?.fuel['精炼柴油']).toBe(5); // 未提及柱保持原值
    expect(r.data.economy.resources?.logistics['战备副食与口粮']).toBe(12);
    expect(r.quarantine).toHaveLength(0);
  });

  it('三态保真：null 不降级、0 透传、数值透传，JSON 序列化往返不劣化', () => {
    const raw = [
      '<战况>',
      '资源:',
      '  纳米机械: {标准纳米工料: 120, 机娘修复凝胶: 0, 高精构造型纳米: null}',
      '</战况>',
    ].join('\n');
    const r = parseMessageText(raw, zero(), {});
    const n = r.data.economy.resources!.nanites;
    expect(n['标准纳米工料']).toBe(120);
    expect(n['机娘修复凝胶']).toBe(0);
    expect(n['高精构造型纳米']).toBeNull(); // 显式 null 透传，严禁降级为 0
    const round = Schema.parse(JSON.parse(JSON.stringify(r.data)));
    expect(round.economy.resources?.nanites['机娘修复凝胶']).toBe(0);
    expect(round.economy.resources?.nanites['高精构造型纳米']).toBeNull();
  });

  it('柱名别名：schema 注释主名 / 短称 / 英文键均可命中同一柱', () => {
    const raw = [
      '<战况>',
      '资源:',
      '  燃油与能源介质: {精炼柴油: 8}',
      '  军械: {步兵制式弹药: 4000}',
      '  logistics: {机械通用备件: 3}',
      '</战况>',
    ].join('\n');
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.economy.resources?.fuel['精炼柴油']).toBe(8);
    expect(r.data.economy.resources?.munitions['步兵制式弹药']).toBe(4000);
    expect(r.data.economy.resources?.logistics['机械通用备件']).toBe(3);
    expect(r.quarantine).toHaveLength(0);
  });

  it('非法值容错：负数/非数值/未知柱名/整柱非对象 → 键级🔴隔离留痕，不拖累合法键', () => {
    const raw = [
      '<战况>',
      '资源:',
      '  矿产: {铁矿石: -5, 煤炭: 很多, 灵石原矿: 2}',
      '  未知柱: {什么: 1}',
      '  燃油: 一整段散文',
      '</战况>',
    ].join('\n');
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.economy.resources?.minerals['灵石原矿']).toBe(2); // 合法键照入
    expect(r.data.economy.resources?.minerals['铁矿石']).toBeUndefined(); // 负数拒收，不落 0 不落 null
    expect(r.data.economy.resources?.minerals['煤炭']).toBeUndefined(); // 非数值拒收
    expect(r.quarantine.some(q => q.path === '资源.minerals.铁矿石' && /不得为负/.test(q.error))).toBe(true);
    expect(r.quarantine.some(q => q.path === '资源.minerals.煤炭' && /非数字/.test(q.error))).toBe(true);
    expect(r.quarantine.some(q => q.path === '资源.未知柱' && /无法映射/.test(q.error))).toBe(true);
    expect(r.quarantine.some(q => q.path === '资源.燃油' && /键值映射对象/.test(q.error))).toBe(true);
  });

  it('数值回写 null（重新锁定）留🟡痕，不静默', () => {
    const base = Schema.parse({ economy: { resources: { minerals: { 铁矿石: 30 } } } });
    const r = parseMessageText('<战况>\n资源: {矿产: {铁矿石: null}}\n</战况>', base, {});
    expect(r.data.economy.resources?.minerals['铁矿石']).toBeNull();
    expect(r.events.some(e => e.light === '🟡' && e.path === '资源.minerals.铁矿石')).toBe(true);
  });
});

describe('FIX-P0-03 / FIX-P0-04 / FIX-P1-01 · 生产队列终态隔离、qty 贯通、载具映射展开与协议排程事件解析', () => {
  it('REPRO_1：队列支持 数量/批量/件数/台数/人数/qty 正整数映射且不落入 quarantine；<=0 或非法值回退 1 并记黄色告警', () => {
    const base = Schema.parse({
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [] }],
      queues: [],
    });
    const r1 = parseMessageText(
      '<战况>\n队列:\n  - 项目: 动员兵\n    类型: 生产\n    基地: beipo\n    数量: 5\n    进度: 0\n    预计: 2天\n</战况>',
      base,
      {},
    );
    expect(r1.quarantine).toHaveLength(0);
    expect(r1.data.queues).toHaveLength(1);
    expect(r1.data.queues[0]).toMatchObject({ item: '动员兵', type: '生产', base: 'beipo', qty: 5, status: 'queued' });

    const rInvalid = parseMessageText(
      '<战况>\n队列:\n  - 项目: 犀牛主战坦克\n    类型: 生产\n    基地: beipo\n    台数: 0\n</战况>',
      base,
      {},
    );
    expect(rInvalid.quarantine).toHaveLength(0);
    expect(rInvalid.data.queues[0].qty).toBe(1);
    expect(rInvalid.events.some(e => e.light === '🟡' && e.path === '队列[犀牛主战坦克].qty')).toBe(true);
  });

  it('REPRO_2：同基地同项目已有 done/cancelled 记录时，新下达队列不复用终态项，且调度与取消仅匹配在编存活项', () => {
    const baseWithDone = Schema.parse({
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [] }],
      queues: [{ item: '动员兵', type: '生产', base: 'beipo', status: 'done', progress: 100 }],
    });
    const secondOrder = parseMessageText(
      '<战况>\n队列:\n  - 项目: 动员兵\n    类型: 生产\n    基地: beipo\n    数量: 3\n    进度: 0\n    预计: 2天\n  - 项目: 动员兵\n    类型: 生产\n    基地: beipo\n    调度: 置顶\n</战况>',
      baseWithDone,
      {},
    );
    expect(secondOrder.quarantine).toHaveLength(0);
    const liveItems = secondOrder.data.queues.filter(q => q.status !== 'done' && q.status !== 'cancelled');
    expect(liveItems).toHaveLength(1);
    expect(liveItems[0]).toMatchObject({ item: '动员兵', status: 'queued', progress: 0, qty: 3 });
    expect(secondOrder.orders).toEqual([{ item: '动员兵', verb: '置顶', type: '生产', base: 'beipo' }]);

    const afterCancel = parseMessageText(
      '<战况>\n操作:\n  - 取消: 动员兵\n    类型: 生产\n    基地: beipo\n</战况>',
      secondOrder.data,
      {},
    );
    expect(afterCancel.issues.some(i => /不唯一/.test(i.message))).toBe(false);
    expect(afterCancel.data.queues.filter(q => q.status !== 'done' && q.status !== 'cancelled')).toHaveLength(0);
  });

  it('FIX-P1-01（REPRO_5）：载具映射 { 天启坦克: "3辆" } 与正整数 N 展开为 N 条记录', () => {
    const base = Schema.parse({ forces: { vehicles: [] } });
    const r = parseMessageText('<战况>\n部队:\n  载具:\n    天启坦克: 3辆\n</战况>', base, {});
    expect(r.quarantine).toHaveLength(0);
    expect(r.data.forces.vehicles).toEqual(['天启坦克', '天启坦克', '天启坦克']);
  });

  it('FIX-P0-04：<事件> 支持解析 协议排程 指令与排程字段', () => {
    const base = Schema.parse({});
    const r = parseMessageText(
      '<事件>\n- 类型: 协议排程\n  对象: 铁幕紧急过载协议\n  排程: 加入候列\n</事件>',
      base,
      {},
    );
    expect(r.quarantine).toHaveLength(0);
    expect(r.eventDeclarations).toHaveLength(1);
    expect(r.eventDeclarations[0]).toMatchObject({
      verb: '协议排程',
      kind: 'protocol',
      protocolAction: 'schedule',
      scheduleAction: '加入候列',
    });
  });

  it('FIX-P1-04：<资源> 支持「变化」后缀增量累加并钳制 >= 0，<事件> 支持 资金链恢复 / 资金链枯竭', () => {
    const base = Schema.parse({
      economy: {
        resources: {
          materials: { 高强工程钢材: 120 },
          nanites: { 标准纳米工料: 30 },
        },
      },
    });
    const r = parseMessageText(
      [
        '<战况>',
        '资源:',
        '  建材:',
        '    高强工程钢材变化: -50',
        '  纳米机械:',
        '    标准纳米工料变化: 20',
        '    机娘修复凝胶变化: -10',
        '</战况>',
        '<事件>',
        '- 类型: 资金链恢复',
        '  对象: 灵石走私走廊',
        '  原因: 护航编队到位',
        '- 类型: 资金链枯竭',
        '  对象: 废弃灵矿线',
        '  原因: 矿脉彻底采空',
        '</事件>',
      ].join('\n'),
      base,
      {},
    );
    expect(r.quarantine).toHaveLength(0);
    expect(r.data.economy.resources?.materials['高强工程钢材']).toBe(70);
    expect(r.data.economy.resources?.nanites['标准纳米工料']).toBe(50);
    expect(r.data.economy.resources?.nanites['机娘修复凝胶']).toBe(0); // 0 - 10 钳制为 0
    expect(r.eventDeclarations.map(d => d.verb)).toEqual(['资金链恢复', '资金链枯竭']);
  });

  it('ARM-02：<部队> 机娘支持 驻地/基地/base 字段，且支持 装备/军备/equipment 键值合并与增量变化', () => {
    const base = Schema.parse({
      forces: {
        girls: [{ name: '凌波', duty: '前锋', hp: '完好', base: '' }],
        equipment: { 脉冲步枪: 10 },
      },
    });
    const r = parseMessageText(
      [
        '<战况>',
        '部队:',
        '  机娘:',
        '    - 姓名: 凌波',
        '      驻地: 青岚基地',
        '    - 姓名: 赤城',
        '      职务: 防空掩护',
        '      状态: 轻损',
        '      基地: 北坡基地',
        '  军备:',
        '    脉冲步枪变化: 5',
        '    外骨骼装甲: 8',
        '</战况>',
      ].join('\n'),
      base,
      {},
    );
    expect(r.quarantine).toHaveLength(0);
    expect(r.data.forces.girls).toMatchObject([
      { name: '凌波', duty: '前锋', hp: '完好', base: '青岚基地' },
      { name: '赤城', duty: '防空掩护', hp: '轻损', base: '北坡基地' },
    ]);
    expect(r.data.forces.equipment).toEqual({
      脉冲步枪: 15,
      外骨骼装甲: 8,
    });
  });

  it('BUG-LIVE-18a · <态势>.资源 支持直接平铺书写四类纳米工料及简称，0 隔离写入 economy.resources.nanites 与 economy.nanites', () => {
    const raw = [
      '<态势>',
      '资源:',
      '  通用纳米工料: 15000',
      '  军工纳米工料: 15000',
      '  特种纳米工料: 15000',
      '  高能纳米工料: 10000',
      '  通用纳米变化: 500',
      '</态势>',
    ].join('\n');
    const r = parseMessageText(raw, zero(), {});
    expect(r.quarantine).toEqual([]);
    expect(r.data.economy.resources?.nanites).toMatchObject({
      通用纳米工料: 15500,
      军工纳米工料: 15000,
      特种纳米工料: 15000,
      高能纳米工料: 10000,
    });
    expect(r.data.economy.nanites).toMatchObject({
      通用纳米工料: 15500,
      军工纳米工料: 15000,
      特种纳米工料: 15000,
      高能纳米工料: 10000,
    });
  });

  it('BUG-LIVE-21（#64楼实机复现）· 顶层 <资金链> 标签块支持列表/单对象结构、状态与字段别名，写入 economy.chains 并同步刷新 channel_daily.chains / total', () => {
    const base64 = Schema.parse({
      economy: {
        credits: 20000,
        credits_daily: 600,
        chains: [
          {
            id: 'chain_灰山稀土走私线',
            name: '灰山稀土走私线',
            flow: '收入',
            rate_daily: 600,
            status: 'active',
            eff: 1,
            reason: '首条走私线',
          },
        ],
        channel_daily: {
          refining: 5000,
          recycling: 0,
          petrochemical: 0,
          chains: 600,
          total: 5600,
        },
      },
    });

    const raw64 = [
      '<资金链>',
      '- 名称: 铁砧矿坑重矿暗渠',
      '  类型: 资源走私',
      '  日收益: 800',
      '  风险: 低',
      '  状态: 活跃',
      '  描述: 依托铁砧矿坑与红峰物流伪装车队建立的长期重矿暗渠。',
      '</资金链>',
    ].join('\n');

    const r64 = parseMessageText(raw64, base64, {});
    expect(r64.quarantine).toEqual([]);
    expect(r64.applied).toBe(true);
    expect(r64.data.economy.chains).toHaveLength(2);
    expect(r64.data.economy.chains[1]).toMatchObject({
      id: 'chain_铁砧矿坑重矿暗渠',
      name: '铁砧矿坑重矿暗渠',
      flow: '收入',
      rate_daily: 800,
      status: 'active',
      eff: 1,
      reason: '依托铁砧矿坑与红峰物流伪装车队建立的长期重矿暗渠。',
    });
    expect(r64.data.economy.channel_daily).toMatchObject({
      refining: 5000,
      chains: 1400,
      total: 6400,
    });
    expect(r64.data.economy.credits_daily).toBe(6400);

    // 同一资金链后续状态更新（受创 -> distressed, eff=0.5）
    const rawUpdate = [
      '<资金链>',
      '名称: 铁砧矿坑重矿暗渠',
      '状态: 受创',
      '原因: 车队遇袭效率减半',
      '</资金链>',
    ].join('\n');
    const rUpdate = parseMessageText(rawUpdate, r64.data, {});
    expect(rUpdate.quarantine).toEqual([]);
    expect(rUpdate.data.economy.chains[1]).toMatchObject({
      id: 'chain_铁砧矿坑重矿暗渠',
      status: 'distressed',
      eff: 0.5,
      reason: '车队遇袭效率减半',
    });
    expect(rUpdate.data.economy.channel_daily?.chains).toBe(1000); // 600 + 800 * 0.5
    expect(rUpdate.data.economy.channel_daily?.total).toBe(6000);
  });

  it('BUG-LIVE-24b/24c（#72楼实机复现）：支持 <事件>「资金链新立」动词及 日收益/状态/依赖基地/依赖建筑 顶层别名，且「防空履带车」对齐至「通用履带底盘与空降轻装族」', () => {
    const raw72 = `<事件>
[
  {
    "类型": "资金链新立",
    "链名": "北境重工备件外包网",
    "流向": "收入",
    "日收益": 900,
    "状态": "活跃",
    "依赖基地": "铁砧重矿前哨分基地",
    "依赖建筑": ["战车工厂"],
    "原因": "铁砧重矿前哨分基地战车工厂投产后向荒原自由佣兵团定向供应标准履带与装甲备件"
  }
]
</事件>`;
    const r72 = parseMessageText(raw72, Schema.parse({}), {});
    expect(r72.quarantine).toEqual([]);
    expect(r72.eventDeclarations).toHaveLength(1);
    expect(r72.eventDeclarations[0]).toMatchObject({
      verb: '资金链建立',
      kind: 'chain',
      chain: {
        name: '北境重工备件外包网',
        flow: '收入',
        rate_daily: 900,
        base_id: '铁砧重矿前哨分基地',
        buildings: ['战车工厂'],
        reason: '铁砧重矿前哨分基地战车工厂投产后向荒原自由佣兵团定向供应标准履带与装甲备件',
      },
    });
  });

  it('BUG-LIVE-28b（#86楼实机复现）：<图鉴> 与 <扩展档案> 使用「分类: 地点」时正确映射为 kind="地点" 且零未知键隔离', () => {
    const raw86 = `<图鉴>
- 名称: 荒坂恶土深层核掩体中枢
  分类: 地点
  简介: 荒坂集团依托红峰荒原旧洲际导弹发射井改建的地下三层战略指挥中枢。
</图鉴>`;
    const r86 = parseMessageText(
      raw86,
      Schema.parse({ meta: { day_count: 25 } }),
      { floorId: 86 },
    );
    expect(r86.quarantine).toEqual([]);
    expect(r86.data.codex).toMatchObject([
      {
        name: '荒坂恶土深层核掩体中枢',
        kind: '地点',
        desc: '荒坂集团依托红峰荒原旧洲际导弹发射井改建的地下三层战略指挥中枢。',
      },
    ]);
    expect(r86.data.pending_lore).toMatchObject([
      {
        id: 'lore_荒坂恶土深层核掩体中枢',
        kind: '地点',
        name: '荒坂恶土深层核掩体中枢',
        is_new: true,
        source_floor: 86,
        created_day: 25,
      },
    ]);
  });
});



