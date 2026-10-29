import { describe, expect, it } from 'vitest';
import {
  Adjutant,
  AdjutantIdentity,
  AdjutantRole,
  AdjutantStatus,
  CommandHQ,
  FactionBreakInPenalty,
  PenaltyEffectKind,
  Schema,
} from '../core/schema';
import {
  ADJUTANT_BUFF_PRESETS,
  FACTION_PENALTY_PRESETS,
  FACTION_STARTER_MCV_MAP,
  HUMAN_ADJUTANT_DAILY_UPKEEP,
  deriveStaffSlotCap,
  normalizeFactionId,
  resolveAdjutantBuffPreset,
  resolveFactionPenaltyPreset,
  resolveStarterMcvInfo,
} from '../core/commandPresets';

describe('CMD-SCHEMA-01: CommandHQ Schema & Defaults', () => {
  it('Schema.safeParse({}) 旧档零破坏回填 command 默认值', () => {
    const res = Schema.safeParse({});
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.command).toEqual({
      commander_name: '',
      commander_title: '战区最高统帅',
      unlocked_factions: ['allied'],
      mcv_granted_factions: [],
      adjutants: [],
      break_in_penalties: [],
    });
  });

  it('Adjutant / FactionBreakInPenalty / CommandHQ 独立解析与枚举校验', () => {
    expect(AdjutantRole.options).toEqual(['faction', 'staff']);
    expect(AdjutantIdentity.options).toEqual(['human', 'mcv_girl', 'commander_self']);
    expect(AdjutantStatus.options).toEqual(['active', 'degraded', 'suspended', 'recovering']);
    expect(PenaltyEffectKind.options).toEqual([
      'power_loss',
      'daily_upkeep',
      'exposure_floor',
      'prod_slowdown',
    ]);

    const defaultAdjutant = Adjutant.parse({});
    expect(defaultAdjutant).toEqual({
      id: '',
      role: 'faction',
      faction: '',
      identity: 'mcv_girl',
      name: '',
      title: '',
      buff_preset: '',
      upkeep_daily: 0,
      status: 'active',
      note: '',
    });

    const defaultPenalty = FactionBreakInPenalty.parse({});
    expect(defaultPenalty).toEqual({
      id: '',
      faction: '',
      name: '',
      effect_kind: 'daily_upkeep',
      magnitude: 0,
      total_minutes: 21600,
      remaining_minutes: 21600,
      reason: '',
    });

    const customHQ = CommandHQ.parse({
      commander_name: '林川',
      unlocked_factions: ['allied', 'soviet'],
      mcv_granted_factions: ['allied'],
      adjutants: [
        {
          id: 'adj_allied_bailing',
          role: 'faction',
          faction: 'allied',
          identity: 'mcv_girl',
          name: '白凌',
          title: '盟军MCV移动基地车核心',
          buff_preset: 'grid_harmonic_tuning',
        },
      ],
      break_in_penalties: [
        {
          id: 'pen_sov_grid_surge',
          faction: 'soviet',
          name: '苏式高压并网冲击',
          effect_kind: 'power_loss',
          magnitude: 0.12,
        },
      ],
    });
    expect(customHQ.commander_name).toBe('林川');
    expect(customHQ.commander_title).toBe('战区最高统帅');
    expect(customHQ.adjutants).toHaveLength(1);
    expect(customHQ.adjutants[0].status).toBe('active');
    expect(customHQ.break_in_penalties[0].remaining_minutes).toBe(21600);
  });
});

describe('CMD-SCHEMA-01: commandPresets 预设白名单与查找函数', () => {
  it('固化 6 项副官专长 Buff 预设并支持 ID/中文名/别名查找', () => {
    expect(ADJUTANT_BUFF_PRESETS).toHaveLength(6);
    expect(HUMAN_ADJUTANT_DAILY_UPKEEP).toBe(80);

    const p1 = resolveAdjutantBuffPreset('heavy_industry_drive');
    expect(p1?.name).toBe('重工催产督导');
    expect(p1?.human.heavyVehicleProdRateBonus).toBe(0.12);
    expect(p1?.mcv_girl.heavyVehicleProdRateBonus).toBe(0.18);

    const p2 = resolveAdjutantBuffPreset('高压电网调谐');
    expect(p2?.id).toBe('grid_harmonic_tuning');
    expect(p2?.human).toEqual({ powerOutputBonus: 0.1, gridPenaltyDecayMultiplier: 1.25 });
    expect(p2?.mcv_girl).toEqual({ powerOutputBonus: 0.14, gridPenaltyDecayMultiplier: 1.5 });

    const p3 = resolveAdjutantBuffPreset('后勤精算');
    expect(p3?.id).toBe('logistics_actuary');
    expect(p3?.human).toEqual({ positiveChainBonus: 0.1, breakInUpkeepReduction: 0.25 });
    expect(p3?.mcv_girl).toEqual({ positiveChainBonus: 0.12, breakInUpkeepReduction: 0.4 });

    const p4 = resolveAdjutantBuffPreset('条令演训主任');
    expect(p4?.id).toBe('protocol_drill_director');
    expect(p4?.human).toEqual({ protocolDailyRateBonus: 0.08, dailyExpFloor: 5 });
    expect(p4?.mcv_girl).toEqual({ protocolDailyRateBonus: 0.12, dailyExpFloor: 8 });

    const p5 = resolveAdjutantBuffPreset('反侦察');
    expect(p5?.id).toBe('counter_recon_screen');
    expect(p5?.human.exposureGainReduction).toBe(0.3);
    expect(p5?.mcv_girl.exposureGainReduction).toBe(0.4);

    const p6 = resolveAdjutantBuffPreset('mecha_ordnance_chief');
    expect(p6?.name).toBe('军工与机匣整备');
    expect(p6?.human.repairThroughputBonus).toBe(0.2);
    expect(p6?.mcv_girl.repairThroughputBonus).toBe(0.3);

    expect(resolveAdjutantBuffPreset('unknown_buff')).toBeUndefined();
  });

  it('固化 8 项阵营特色磨合代价预设并支持查找', () => {
    expect(FACTION_PENALTY_PRESETS).toHaveLength(8);
    for (const item of FACTION_PENALTY_PRESETS) {
      expect(item.totalMinutes).toBe(21600);
    }

    expect(resolveFactionPenaltyPreset('pen_sov_grid_surge')).toMatchObject({
      faction: 'soviet',
      name: '苏式高压并网冲击',
      effectKind: 'power_loss',
      magnitude: 0.12,
      initialExposureDelta: 0,
    });
    expect(resolveFactionPenaltyPreset('1520宽轨重工摊派')).toMatchObject({
      id: 'pen_sov_broad_gauge',
      faction: 'soviet',
      effectKind: 'daily_upkeep',
      magnitude: 150,
      initialExposureDelta: 0,
    });
    expect(resolveFactionPenaltyPreset('百吨履带震动暴露')).toMatchObject({
      id: 'pen_sov_seismic_noise',
      faction: 'soviet',
      effectKind: 'exposure_floor',
      magnitude: 15,
      initialExposureDelta: 15,
    });
    expect(resolveFactionPenaltyPreset('洁净厂房精密维保')).toMatchObject({
      id: 'pen_all_cleanroom_cost',
      faction: 'allied',
      effectKind: 'daily_upkeep',
      magnitude: 180,
      initialExposureDelta: 0,
    });
    expect(resolveFactionPenaltyPreset('pen_all_power_ripple')).toMatchObject({
      faction: 'allied',
      name: '高纯度变电谐振敏感',
      effectKind: 'prod_slowdown',
      magnitude: 0.12,
      initialExposureDelta: 0,
    });
    expect(resolveFactionPenaltyPreset('全息信标电磁特征')).toMatchObject({
      id: 'pen_all_em_beacon',
      faction: 'allied',
      effectKind: 'exposure_floor',
      magnitude: 12,
      initialExposureDelta: 12,
    });
    expect(resolveFactionPenaltyPreset('异构指令集转译延迟')).toMatchObject({
      id: 'pen_common_protocol_lag',
      faction: 'common',
      effectKind: 'prod_slowdown',
      magnitude: 0.1,
      initialExposureDelta: 0,
    });
    expect(resolveFactionPenaltyPreset('跨系特种工质调配损耗')).toMatchObject({
      id: 'pen_common_supply_strain',
      faction: 'common',
      effectKind: 'daily_upkeep',
      magnitude: 160,
      initialExposureDelta: 0,
    });

    expect(resolveFactionPenaltyPreset('default', '苏军')?.id).toBe('pen_sov_grid_surge');
    expect(resolveFactionPenaltyPreset('not_exist')).toBeUndefined();
  });

  it('normalizeFactionId 与 resolveStarterMcvInfo 正确归一三大官方阵营（allied/soviet/yuri）并映射首发 MCV 机娘，拒绝自创第四阵营', () => {
    expect(normalizeFactionId('盟军')).toBe('allied');
    expect(normalizeFactionId('ALLIED')).toBe('allied');
    expect(normalizeFactionId('all')).toBe('allied');
    expect(normalizeFactionId('苏联')).toBe('soviet');
    expect(normalizeFactionId('苏军')).toBe('soviet');
    expect(normalizeFactionId('苏维埃')).toBe('soviet');
    expect(normalizeFactionId('sov')).toBe('soviet');
    expect(normalizeFactionId('尤里')).toBe('yuri');
    expect(normalizeFactionId('心灵')).toBe('yuri');
    expect(normalizeFactionId('Yuri')).toBe('yuri');
    expect(normalizeFactionId('  Custom_Faction ')).toBe('custom_faction');

    expect(resolveStarterMcvInfo('盟军')).toEqual(FACTION_STARTER_MCV_MAP.allied);
    expect(resolveStarterMcvInfo('soviet')?.girlName).toBe('喀秋莎');
    expect(resolveStarterMcvInfo('心灵')?.girlName).toBe('尤里卡');
    expect(resolveStarterMcvInfo('升阳帝国')).toBeUndefined();
    expect(resolveStarterMcvInfo('纳米核心')).toBeUndefined();
    expect(resolveStarterMcvInfo('unknown')).toBeUndefined();
  });

  it('deriveStaffSlotCap 从 1 到 4 的阶梯计算与损毁/废弃过滤', () => {
    // 1. 空状态或仅有基础建筑 -> 1
    expect(deriveStaffSlotCap({})).toBe(1);
    expect(
      deriveStaffSlotCap({
        bases: [{ status: '正常', buildings: [{ name: '发电厂', state: '完好' }] }],
      }),
    ).toBe(1);

    // 2. 存在运转中的通信/雷达中枢 -> 2（多座雷达中枢也只 +1）
    expect(
      deriveStaffSlotCap({
        bases: [
          {
            status: '正常',
            buildings: [
              { name: '雷达站', state: '完好' },
              { name: '空军指挥部', state: '完好' },
            ],
          },
        ],
      }),
    ).toBe(2);

    // 废弃基地或损毁建筑不计入
    expect(
      deriveStaffSlotCap({
        bases: [
          { status: '废弃', buildings: [{ name: '雷达站', state: '完好' }] },
          { status: '正常', buildings: [{ name: '苏联雷达站', state: '损毁' }] },
        ],
      }),
    ).toBe(1);

    // 3. 雷达中枢 + 1 类高阶指挥/科研建筑 -> 3
    expect(
      deriveStaffSlotCap({
        bases: [
          {
            status: '正常',
            buildings: [
              { name: '模块化网电作战枢纽', state: '完好' },
              { name: '盟军战斗实验室', state: '完好' },
            ],
          },
        ],
      }),
    ).toBe(3);

    // 4. 雷达中枢 + 2 类及以上高阶建筑 -> 4（且封顶 4）
    expect(
      deriveStaffSlotCap({
        bases: [
          {
            status: '正常',
            buildings: [
              { name: '雷达站', state: '完好' },
              { name: '盟军战斗实验室', state: '完好' },
              { name: '苏联战斗实验室', state: '完好' },
            ],
          },
        ],
      }),
    ).toBe(4);

    expect(
      deriveStaffSlotCap({
        bases: [
          {
            status: '正常',
            buildings: [
              { name: '雷达站', state: '完好' },
              { name: '战斗实验室', state: '完好' },
              { name: '盟军战斗实验室', state: '完好' },
              { name: '红星实验设计局综合体', state: '完好' },
              { name: '国家战略工程综合体', state: '完好' },
              { name: '联合指挥中枢', state: '完好' },
            ],
          },
        ],
      }),
    ).toBe(4);
  });
});
