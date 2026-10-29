/**
 * PRT-SCHEMA-01 · 五态 protocols[] / protocol_points Schema 扩展与迁移函数 —— 专项单测
 * 真源：《协议玩法 MVP 任务包》§3.2、§6 PRT-SCHEMA-01 ／《协议玩法-脑暴决策记录-2026-10-10.md》D-P1、D-P2b、D-P18b/18c、D-P27、D-P28
 *
 * 覆盖：
 * ① 旧档（完全无 protocols / protocol_points 字段）safeParse 零报错、protocol_points 默认 0、protocols 零注入；
 * ② 18 条存量协议（苏联 16 条 ＋ 盟军 2 条）全量逐条在 tech.done 旧档迁移置 active(exp=100) 并自 tech.done 移除、
 *    非协议科技原样保留、重复迁移 100% 幂等、在研队列（queues[type='研究'] / tech.current）无损结转；
 * ③ 五态枚举（含 voided 预留）、ProtocolInstance 全字段与 last_result（breakthrough / accumulated / discovered）
 *    zod 往返无损，越界值（exp>100 / exp<0 / attempts<0 等）准确拦截。
 */
import { describe, expect, it } from 'vitest';
import {
  isLegacyProtocolIdentifier,
  LEGACY_PROTOCOL_DEFINITIONS,
  LEGACY_PROTOCOL_ID_TO_NAME,
  LEGACY_PROTOCOL_NAME_TO_ID,
  migrateLegacyProtocolsInState,
  migrateV1toV2,
  PROTOCOL_SCHEMA_VERSION,
  ProtocolInstance,
  type ProtocolInstanceType,
  ProtocolLastResult,
  type ProtocolLastResultType,
  ProtocolStatus,
  type ProtocolStatusType,
  resolveLegacyProtocolId,
  resolveLegacyProtocolName,
  Schema,
} from '../core/schema';

/** 18 条存量协议权威清单（只读对照《特色科技·苏联_世界书.json》16 条 ＋《特色科技·盟军_世界书.json》2 条） */
const EXPECTED_18_PROTOCOLS: ReadonlyArray<{ id: string; name: string; faction: '苏联' | '盟军' }> = [
  // 苏联 16 条（4 条战略/铁幕/核规程 ＋ 12 条 RA3 协议）
  { id: 'sov.research.t2.iron_curtain_emergency_overload', name: '铁幕紧急过载协议', faction: '苏联' },
  { id: 'sov.research.t2.nuclear_exercise_isolation_notification', name: '核演习隔离与通报规程', faction: '苏联' },
  { id: 'sov.research.t3.nuclear_command_succession_rebuild', name: '核指挥接替与态势重建规程', faction: '苏联' },
  {
    id: 'sov.research.t3.conventional_strategic_authorization_isolation',
    name: '常规战略打击授权隔离协议',
    faction: '苏联',
  },
  { id: 'sov.protocol.ra3.combat_engineer_prefab_bunker', name: '战斗工兵—预制战斗碉堡协议', faction: '苏联' },
  { id: 'sov.protocol.ra3.sputnik_one_way_deployment', name: 'Sputnik一次展开前沿节点协议', faction: '苏联' },
  { id: 'sov.protocol.ra3.crusher_crane_salvage', name: 'Crusher Crane维修—拆件—报废协议', faction: '苏联' },
  {
    id: 'sov.protocol.ra3.terror_drone_dual_mode',
    name: '恐怖机器人拆解／短时电磁锁止双任务包协议',
    faction: '苏联',
  },
  { id: 'sov.protocol.ra3.tesla_mobile_parallel_charge', name: '磁暴步兵移动储能并联充能协议', faction: '苏联' },
  {
    id: 'sov.protocol.ra3.urban_molotov_magnetic_mine',
    name: '动员兵燃烧瓶／防空兵附着式反机动雷协议',
    faction: '苏联',
  },
  { id: 'sov.protocol.ra3.motorized_mortar_reserve', name: '摩托化迫击炮后备分队协议', faction: '苏联' },
  { id: 'sov.protocol.ra3.v4_precision_payload_package', name: 'V3体系V4精确弹／多载荷任务包协议', faction: '苏联' },
  { id: 'sov.protocol.ra3.kirov_dreadnought_overlimit', name: '基洛夫—无畏越限运行协议', faction: '苏联' },
  { id: 'sov.protocol.ra3.anchored_magnetic_lock', name: '地锚式磁锁／局部奇点压制区协议', faction: '苏联' },
  { id: 'sov.protocol.ra3.mass_production_fold_in', name: 'Mass Production工业调度折叠协议', faction: '苏联' },
  {
    id: 'sov.protocol.ra3.hammer_inventory_reentry',
    name: '受库存与授权约束的轨道常规载荷再入协议',
    faction: '苏联',
  },
  // 盟军 2 条（UID 21 / UID 22 双防务协议）
  { id: 'all.research.t1.european_defense_agreement', name: '欧洲联合防务协议', faction: '盟军' },
  { id: 'all.research.t1.pacific_rim_defense_agreement', name: '环太平洋防务合作协议', faction: '盟军' },
];

describe('PRT-SCHEMA-01 · 五态 protocols[] / protocol_points Schema 扩展与旧档迁移', () => {
  describe('① 旧档向后兼容（无 protocols / protocol_points 字段 safeParse 零报错，protocol_points 默认 0）', () => {
    it('归零态 Schema.parse({})：protocol_points 默认兑底 0，protocols 保持 undefined 零注入', () => {
      const parsed = Schema.safeParse({});
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.protocol_points).toBe(0);
      expect(parsed.data.protocols).toBeUndefined();
      expect('protocols' in parsed.data).toBe(false);
    });

    it('v1 修真旧档与 v2 富旧档（无协议字段）：经 migrateV1toV2 + safeParse 零报错，既有域 100% 保真', () => {
      const v1Legacy = {
        schema_version: 1,
        meta: { date: '秋·九月十八', location: '青岚山北坡' },
        economy: { credits: 500, wallet: { copper: 120, silver: 3 } },
        tech: { done: ['基础步兵训练学', '高级作战实验理论'] },
        queues: [{ type: '研究', item: '超时空位移工学', base: 'beipo', progress: 40 }],
      };
      const v1Result = Schema.safeParse(migrateV1toV2(structuredClone(v1Legacy)));
      expect(v1Result.success).toBe(true);
      if (!v1Result.success) return;
      expect(v1Result.data.protocol_points).toBe(0);
      expect(v1Result.data.protocols).toBeUndefined();
      expect(v1Result.data.tech.done).toEqual(['基础步兵训练学', '高级作战实验理论']);
      expect(v1Result.data.queues[0]).toMatchObject({ type: '研究', item: '超时空位移工学', progress: 40 });

      const v2Legacy = {
        schema_version: 2,
        meta: { world_id: 'xiuzhen', date: '冬·腊月初三', day_count: 18, location: '青岚山北坡' },
        economy: { credits: 3200, credits_daily: 150, wallet: { 下品灵石: 10 } },
        bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '战斗实验室', state: '运转' }] }],
        tech: { done: ['基础步兵训练学', '火力单元自主交战规程'] },
      };
      const passthrough = migrateV1toV2(v2Legacy);
      expect(passthrough).toBe(v2Legacy);
      const v2Result = Schema.safeParse(passthrough);
      expect(v2Result.success).toBe(true);
      if (!v2Result.success) return;
      expect(v2Result.data.protocol_points).toBe(0);
      expect(v2Result.data.protocols).toBeUndefined();
      expect(v2Result.data.tech.done).toEqual(['基础步兵训练学', '火力单元自主交战规程']);
    });
  });

  describe('② 18 条存量协议（苏 16 + 盟 2）权威映射表、tech.done 旧档迁移与在研队列结转', () => {
    it('权威映射表精确收录 18 条协议（苏 16 + 盟 2），名↔ID 双向一一对应，且兼容常见别名', () => {
      expect(LEGACY_PROTOCOL_DEFINITIONS).toHaveLength(18);
      expect(Object.keys(LEGACY_PROTOCOL_NAME_TO_ID)).toHaveLength(18);
      expect(Object.keys(LEGACY_PROTOCOL_ID_TO_NAME)).toHaveLength(18);

      const sovietCount = LEGACY_PROTOCOL_DEFINITIONS.filter(d => d.faction === '苏联').length;
      const alliedCount = LEGACY_PROTOCOL_DEFINITIONS.filter(d => d.faction === '盟军').length;
      expect(sovietCount).toBe(16);
      expect(alliedCount).toBe(2);

      for (const expected of EXPECTED_18_PROTOCOLS) {
        expect(LEGACY_PROTOCOL_NAME_TO_ID[expected.name]).toBe(expected.id);
        expect(LEGACY_PROTOCOL_ID_TO_NAME[expected.id]).toBe(expected.name);
        expect(resolveLegacyProtocolId(expected.name)).toBe(expected.id);
        expect(resolveLegacyProtocolId(expected.id)).toBe(expected.id);
        expect(resolveLegacyProtocolName(expected.id)).toBe(expected.name);
        expect(resolveLegacyProtocolName(expected.name)).toBe(expected.name);
        expect(isLegacyProtocolIdentifier(expected.name)).toBe(true);
        expect(isLegacyProtocolIdentifier(expected.id)).toBe(true);
      }

      // 别名与标点变体识别
      expect(resolveLegacyProtocolId('欧盟防务协议')).toBe('all.research.t1.european_defense_agreement');
      expect(resolveLegacyProtocolId('all.research.european_defense_pact')).toBe(
        'all.research.t1.european_defense_agreement',
      );
      expect(resolveLegacyProtocolId('日韩防务协议')).toBe('all.research.t1.pacific_rim_defense_agreement');
      expect(resolveLegacyProtocolId('all.research.pacific_rim_defense_pact')).toBe(
        'all.research.t1.pacific_rim_defense_agreement',
      );
      expect(resolveLegacyProtocolId('恐怖机器人双任务包协议')).toBe('sov.protocol.ra3.terror_drone_dual_mode');
      expect(resolveLegacyProtocolId('战斗工兵-预制战斗碉堡协议')).toBe(
        'sov.protocol.ra3.combat_engineer_prefab_bunker',
      );
      expect(resolveLegacyProtocolId('《欧洲联合防务协议》')).toBe('all.research.t1.european_defense_agreement');
      expect(resolveLegacyProtocolId('44·铁幕紧急过载协议')).toBe('sov.research.t2.iron_curtain_emergency_overload');

      // 非协议科技（含带“规程”字样的常规科技）绝不误判
      expect(isLegacyProtocolIdentifier('高级作战实验理论')).toBe(false);
      expect(isLegacyProtocolIdentifier('火力单元自主交战规程')).toBe(false);
      expect(isLegacyProtocolIdentifier('sov.research.t1.autonomous_fire_unit_engagement')).toBe(false);
    });

    it.each(EXPECTED_18_PROTOCOLS)(
      '逐条断言 [$faction] $name ($id) 在 tech.done 中迁移后置 active(exp=100) 并从 tech.done 移除',
      ({ id, name }) => {
        const rawSave = {
          meta: { world_id: 'xiuzhen', day_count: 15 },
          tech: {
            done: ['基础步兵训练学', name, '火力单元自主交战规程'],
          },
        };
        const snapshot = structuredClone(rawSave);
        const migrated = migrateLegacyProtocolsInState(rawSave);
        // 纯函数不修改入参
        expect(rawSave).toEqual(snapshot);

        const parsed = Schema.parse(migrated);
        expect(parsed.tech.done).toEqual(['基础步兵训练学', '火力单元自主交战规程']);
        expect(parsed.protocols).toHaveLength(1);
        expect(parsed.protocols![0]).toEqual({
          ref: id,
          status: 'active',
          attempts: 0,
          exp: 100,
          points_spent: 0,
          credits_spent: 0,
          auto_queued: false,
          hold: false,
          discovered_via: 'init',
          updated_at_day: 15,
          schema_version: PROTOCOL_SCHEMA_VERSION,
        });

        // 即使直接调用 Schema.parse(rawSave)（不显式前置调 migrateLegacyProtocolsInState）也同样生效
        const directParsed = Schema.parse(rawSave);
        expect(directParsed).toEqual(parsed);

        // 重复迁移 100% 幂等（二次调用返回原引用且结果恒等）
        const twice = migrateLegacyProtocolsInState(migrated);
        expect(twice).toBe(migrated);
        expect(Schema.parse(twice)).toEqual(parsed);
      },
    );

    it('tech.done 中直接存协议 ID 或别名时，同样迁移为对应权威 ref 的 active 实例且去重幂等', () => {
      const saveWithIdsAndAliases = {
        meta: { day_count: 9 },
        tech: {
          done: [
            'all.research.european_defense_pact',
            '欧盟防务协议',
            'sov.protocol.ra3.kirov_dreadnought_overlimit',
            '基洛夫-无畏越限运行协议',
            '装甲载具工学',
          ],
        },
      };
      const parsed = Schema.parse(saveWithIdsAndAliases);
      expect(parsed.tech.done).toEqual(['装甲载具工学']);
      expect(parsed.protocols).toHaveLength(2);
      expect(parsed.protocols!.map(p => p.ref)).toEqual([
        'all.research.t1.european_defense_agreement',
        'sov.protocol.ra3.kirov_dreadnought_overlimit',
      ]);
      expect(parsed.protocols!.every(p => p.status === 'active' && p.exp === 100)).toBe(true);
    });

    it('18 条协议全量同存于 tech.done 时一次性迁移完备，普通科技原样保留', () => {
      const all18Names = EXPECTED_18_PROTOCOLS.map(p => p.name);
      const save = {
        meta: { day_count: 30 },
        tech: {
          done: ['基础步兵训练学', ...all18Names, '高级作战实验理论'],
        },
      };
      const parsed = Schema.parse(save);
      expect(parsed.tech.done).toEqual(['基础步兵训练学', '高级作战实验理论']);
      expect(parsed.protocols).toHaveLength(18);
      expect(parsed.protocols!.map(p => p.ref)).toEqual(EXPECTED_18_PROTOCOLS.map(p => p.id));
      for (const inst of parsed.protocols!) {
        expect(inst.status).toBe('active');
        expect(inst.exp).toBe(100);
        expect(inst.discovered_via).toBe('init');
      }
    });

    it('在研队列（queues[type="研究"] 与 tech.current）中的协议项安全结转为 experimenting / available', () => {
      const legacyInProgress = {
        meta: { day_count: 12 },
        tech: {
          done: ['高级作战实验理论'],
          current: '环太平洋防务合作协议',
        },
        queues: [
          { type: '研究', item: '铁幕紧急过载协议', base: 'beipo', progress: 45, eta: '余4日' },
          {
            type: '研究',
            item: '战斗工兵—预制战斗碉堡协议',
            base: 'beipo',
            progress: 0,
            spent_minutes: 360,
            total_minutes: 1000,
          },
          { type: '研究', item: '欧洲联合防务协议', base: 'beipo', progress: 0, hold: true },
          { type: '研究', item: '超时空位移工学', base: 'beipo', progress: 60 },
          { type: '生产', item: '犀牛主战坦克', base: 'beipo', progress: 80 },
        ],
      };

      const parsed = Schema.parse(legacyInProgress);
      // 非协议研究与生产队列完整保留，协议研究项已从 queues 移除
      expect(parsed.queues).toHaveLength(2);
      expect(parsed.queues.map(q => q.item)).toEqual(['超时空位移工学', '犀牛主战坦克']);

      expect(parsed.protocols).toHaveLength(4);
      const byRef = new Map(parsed.protocols!.map(p => [p.ref, p]));

      // 1. progress=45 -> experimenting, exp=45, attempts=1, auto_queued=true
      expect(byRef.get('sov.research.t2.iron_curtain_emergency_overload')).toMatchObject({
        ref: 'sov.research.t2.iron_curtain_emergency_overload',
        status: 'experimenting',
        attempts: 1,
        exp: 45,
        auto_queued: true,
        hold: false,
        discovered_via: 'init',
        updated_at_day: 12,
      });

      // 2. spent_minutes=360 / total_minutes=1000 -> experimenting, exp=36, attempts=1, auto_queued=true
      expect(byRef.get('sov.protocol.ra3.combat_engineer_prefab_bunker')).toMatchObject({
        ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
        status: 'experimenting',
        attempts: 1,
        exp: 36,
        auto_queued: true,
        hold: false,
        discovered_via: 'init',
      });

      // 3. progress=0, hold=true -> available, exp=0, attempts=0, auto_queued=true, hold=true
      expect(byRef.get('all.research.t1.european_defense_agreement')).toMatchObject({
        ref: 'all.research.t1.european_defense_agreement',
        status: 'available',
        attempts: 0,
        exp: 0,
        auto_queued: true,
        hold: true,
        discovered_via: 'init',
      });

      // 4. tech.current 结转 -> available, exp=0, auto_queued=true
      expect(byRef.get('all.research.t1.pacific_rim_defense_agreement')).toMatchObject({
        ref: 'all.research.t1.pacific_rim_defense_agreement',
        status: 'available',
        attempts: 0,
        exp: 0,
        auto_queued: true,
        discovered_via: 'init',
      });
    });

    it('单向不退化守卫：若协议已在 protocols[] 处于 active 或在 tech.done 中，队列残留不使其回退为 experimenting', () => {
      const save = {
        meta: { day_count: 20 },
        tech: { done: ['铁幕紧急过载协议'] },
        queues: [{ type: '研究', item: '铁幕紧急过载协议', progress: 30 }],
        protocols: [
          {
            ref: 'sov.research.t2.iron_curtain_emergency_overload',
            status: 'experimenting',
            attempts: 2,
            exp: 70,
            points_spent: 2,
            credits_spent: 3000,
            auto_queued: true,
          },
        ],
      };

      const parsed = Schema.parse(save);
      expect(parsed.tech.done).toEqual([]);
      expect(parsed.queues).toEqual([]);
      expect(parsed.protocols).toHaveLength(1);
      expect(parsed.protocols![0]).toMatchObject({
        ref: 'sov.research.t2.iron_curtain_emergency_overload',
        status: 'active',
        attempts: 2,
        exp: 100,
        points_spent: 2,
        credits_spent: 3000,
        auto_queued: false,
        hold: false,
      });
    });
  });

  describe('③ 五态枚举（含 voided）、ProtocolInstance 全字段与 last_result zod 往返及越界拦截', () => {
    const ALL_STATUSES: readonly ProtocolStatusType[] = [
      'undiscovered',
      'locked',
      'available',
      'experimenting',
      'active',
      'voided',
    ];

    const ALL_OUTCOMES: ReadonlyArray<ProtocolLastResultType['outcome']> = [
      'breakthrough',
      'accumulated',
      'discovered',
    ];

    it('五态枚举（含 voided 预留）与 last_result 三种 outcome 全部解析通过', () => {
      for (const status of ALL_STATUSES) {
        expect(ProtocolStatus.parse(status)).toBe(status);
        const inst = ProtocolInstance.parse({
          ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
          status,
        });
        expect(inst.status).toBe(status);
      }

      for (const outcome of ALL_OUTCOMES) {
        const lr = ProtocolLastResult.parse({
          day: 12,
          outcome,
          attempt: 2,
          exp_before: 35,
          exp_after: 70,
          next_prob: 90,
        });
        expect(lr.outcome).toBe(outcome);
      }
    });

    it('ProtocolInstance 最小输入默认值兑底与全字段 JSON 往返无损（round-trip）', () => {
      const minimal = ProtocolInstance.parse({
        ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
      });
      expect(minimal).toStrictEqual({
        ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
        status: 'locked',
        attempts: 0,
        exp: 0,
        points_spent: 0,
        credits_spent: 0,
        auto_queued: false,
        hold: false,
        updated_at_day: 0,
        schema_version: 1,
      });

      const fullInstance: ProtocolInstanceType = {
        ref: 'sov.research.t2.iron_curtain_emergency_overload',
        status: 'experimenting',
        attempts: 2,
        exp: 70,
        points_spent: 2,
        credits_spent: 3000,
        auto_queued: true,
        queue_order: 1,
        hold: false,
        discovered_via: 'experiment',
        updated_at_day: 14,
        last_result: {
          day: 14,
          outcome: 'accumulated',
          attempt: 2,
          exp_before: 35,
          exp_after: 70,
          next_prob: 90,
        },
        schema_version: 1,
      };

      const stateInput = {
        meta: { world_id: 'xiuzhen', date: '2042-03-20', day_count: 14, location: '北坡' },
        protocol_points: 3.5,
        protocols: [fullInstance],
      };

      const first = Schema.parse(stateInput);
      const roundTrip = Schema.parse(JSON.parse(JSON.stringify(first)));
      expect(roundTrip).toStrictEqual(first);
      expect(roundTrip.protocol_points).toBe(3.5);
      expect(roundTrip.protocols![0]).toStrictEqual(fullInstance);
    });

    it('越界值与非法枚举准确拦截（exp>100 / exp<0 / attempts<0 / 非整数 attempts / 非法 status 等）', () => {
      const base = { ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker' };

      // exp 越界
      expect(ProtocolInstance.safeParse({ ...base, exp: 100.1 }).success).toBe(false);
      expect(ProtocolInstance.safeParse({ ...base, exp: 150 }).success).toBe(false);
      expect(ProtocolInstance.safeParse({ ...base, exp: -0.1 }).success).toBe(false);
      expect(ProtocolInstance.safeParse({ ...base, exp: -10 }).success).toBe(false);

      // attempts 越界或非整数
      expect(ProtocolInstance.safeParse({ ...base, attempts: -1 }).success).toBe(false);
      expect(ProtocolInstance.safeParse({ ...base, attempts: 1.5 }).success).toBe(false);

      // points_spent / credits_spent 负数拦截
      expect(ProtocolInstance.safeParse({ ...base, points_spent: -1 }).success).toBe(false);
      expect(ProtocolInstance.safeParse({ ...base, credits_spent: -100 }).success).toBe(false);

      // queue_order 非整数拦截
      expect(ProtocolInstance.safeParse({ ...base, queue_order: 1.2 }).success).toBe(false);

      // 非法 status / discovered_via / schema_version
      expect(ProtocolInstance.safeParse({ ...base, status: 'researching' }).success).toBe(false);
      expect(ProtocolInstance.safeParse({ ...base, discovered_via: 'cheat' }).success).toBe(false);
      expect(ProtocolInstance.safeParse({ ...base, schema_version: 2 }).success).toBe(false);

      // last_result 内部越界
      expect(
        ProtocolLastResult.safeParse({
          day: 1,
          outcome: 'accumulated',
          attempt: -1,
        }).success,
      ).toBe(false);
      expect(
        ProtocolLastResult.safeParse({
          day: 1,
          outcome: 'accumulated',
          exp_before: -5,
        }).success,
      ).toBe(false);
      expect(
        ProtocolLastResult.safeParse({
          day: 1,
          outcome: 'accumulated',
          exp_after: 105,
        }).success,
      ).toBe(false);
      expect(
        ProtocolLastResult.safeParse({
          day: 1,
          outcome: 'accumulated',
          next_prob: 120,
        }).success,
      ).toBe(false);
      expect(
        ProtocolLastResult.safeParse({
          day: 1,
          outcome: 'failed',
        }).success,
      ).toBe(false);
    });
  });
});
