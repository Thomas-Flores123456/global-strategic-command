import { describe, expect, it } from 'vitest';
import {
  buildStatData,
  composeLaunchMessage,
  createLaunchSteps,
  createMockHostAdapter,
  resolveDifficulty,
  runLaunchPipeline,
} from '../pipeline';
import {
  computeMultiFactionLaunchImpact,
  defaultChoices,
  FACTION_OPTIONS,
  HUMAN_ADJUTANT_DAILY_UPKEEP,
  type LaunchChoices,
} from '../presets';
import {
  ALLIED_WORLDBOOK_GROUP,
  CORE_REQUIRED_WORLDBOOKS,
  LEGACY_DUPLICATE_WORLDBOOK_NAMES,
  planFactionWorldbookSync,
  planWorldbookSync,
  PROTOCOL_WORLDBOOK,
  SOVIET_WORLDBOOK_GROUP,
  WORLD_BOOK_MANIFESTS,
} from '../worldbookManifest';
import { FACTION_STARTER_MCV_MAP, resolveStarterMcvInfo } from '../../红警指挥系统/core/commandPresets';

function choicesWith(patch: Partial<LaunchChoices>): LaunchChoices {
  return { ...defaultChoices(), ...patch };
}

describe('CMD-LAUNCH-01 · presets 多阵营选项与开局代价折算', () => {
  it('FACTION_OPTIONS 开放 soviet 为 available: true，并保留第 3 阵营支持', () => {
    const allied = FACTION_OPTIONS.find(f => f.id === 'allied');
    const soviet = FACTION_OPTIONS.find(f => f.id === 'soviet');
    const third = FACTION_OPTIONS.find(f => f.id === 'yuri' || f.id === 'third');
    expect(allied?.available).toBe(true);
    expect(soviet?.available).toBe(true);
    expect(third).toBeDefined();
  });

  it('computeMultiFactionLaunchImpact：1/2/3 阵营资金倍率、暴露度增量与 15 日磨合代价精确折算', () => {
    const one = computeMultiFactionLaunchImpact(['allied'], 2000, 0);
    expect(one.creditsMultiplier).toBe(1.0);
    expect(one.credits).toBe(2000);
    expect(one.exposureDelta).toBe(0);
    expect(one.exposure).toBe(0);
    expect(one.breakInPenalties).toEqual([]);

    const two = computeMultiFactionLaunchImpact(['allied', 'soviet'], 2000, 0);
    expect(two.creditsMultiplier).toBe(0.85);
    expect(two.credits).toBe(1700);
    expect(two.exposureDelta).toBe(15);
    expect(two.exposure).toBe(15);
    expect(two.breakInPenalties).toHaveLength(1);
    expect(two.breakInPenalties[0]).toMatchObject({
      id: 'pen_sov_grid_surge',
      faction: 'soviet',
      name: '苏式高压并网冲击',
      total_minutes: 21600,
      remaining_minutes: 21600,
    });

    const three = computeMultiFactionLaunchImpact(['allied', 'soviet', 'yuri'], 2000, 2);
    expect(three.creditsMultiplier).toBe(0.75);
    expect(three.credits).toBe(1500);
    expect(three.exposureDelta).toBe(30);
    expect(three.exposure).toBe(32);
    expect(three.breakInPenalties).toHaveLength(2);
    expect(three.breakInPenalties.map(p => p.faction)).toEqual(['soviet', 'yuri']);
    expect(three.breakInPenalties.every(p => p.total_minutes === 21600 && p.remaining_minutes === 21600)).toBe(true);
  });
});

describe('CMD-LAUNCH-01 · buildStatData 单阵营兼容与多阵营合成', () => {
  it('单选 allied 时与单阵营基线 100% 兼容：MCV（盟军）、白凌、unlocked/mcv_granted 锁死 allied', () => {
    const sd = buildStatData(defaultChoices());
    expect(sd.economy.credits).toBe(2000);
    expect(sd.exposure.value).toBe(0);
    expect(sd.forces.vehicles).toEqual(['MCV（盟军）']);
    expect(sd.forces.girls).toMatchObject([
      { name: '白凌', duty: '盟军MCV移动基地车核心', hp: '完好', base: '' },
    ]);
    expect(sd.command.unlocked_factions).toEqual(['allied']);
    expect(sd.command.mcv_granted_factions).toEqual(['allied']);
    expect(sd.command.break_in_penalties).toEqual([]);
    expect(sd.command.adjutants).toHaveLength(1);
    expect(sd.command.adjutants[0]).toMatchObject({
      role: 'faction',
      faction: 'allied',
      identity: 'mcv_girl',
      name: '白凌',
      upkeep_daily: 0,
    });
  });

  it('双选 allied + soviet：资金 ×0.85、暴露 +15、双 MCV 与双机娘（白凌+喀秋莎）、双阵营硬锁与磨合代价就位', () => {
    const choices = choicesWith({
      selectedFactions: ['allied', 'soviet'],
      factionAdjutants: {
        allied: { identity: 'mcv_girl', name: '白凌', buffPreset: 'grid_harmonic_tuning' },
        soviet: {
          identity: 'human',
          name: '瓦列里上校',
          title: '苏维埃重工总督造',
          buffPreset: 'heavy_industry_drive',
        },
      },
      staffAdjutant: {
        enabled: true,
        name: '林参谋',
        title: '战区后勤精算主任',
        buffPreset: 'logistics_actuary',
      },
    });

    const eff = resolveDifficulty(choices);
    expect(eff.credits).toBe(1700);
    expect(eff.exposure).toBe(15);

    const sd = buildStatData(choices);
    expect(sd.economy.credits).toBe(1700);
    expect(sd.exposure.value).toBe(1.5);
    expect(sd.forces.vehicles).toEqual(['MCV（盟军）', 'MCV（苏联）']);
    expect(sd.forces.girls.map(g => g.name)).toEqual(['白凌', '喀秋莎']);
    expect(sd.command.unlocked_factions).toEqual(['allied', 'soviet']);
    expect(sd.command.mcv_granted_factions).toEqual(['allied', 'soviet']);
    expect(sd.command.break_in_penalties).toHaveLength(1);
    expect(sd.command.break_in_penalties[0]).toMatchObject({
      faction: 'soviet',
      id: 'pen_sov_grid_surge',
      remaining_minutes: 21600,
    });

    // 2 个阵营主责席 + 1 个初始参谋槽
    expect(sd.command.adjutants).toHaveLength(3);
    expect(sd.command.adjutants[0]).toMatchObject({
      role: 'faction',
      faction: 'allied',
      identity: 'mcv_girl',
      name: '白凌',
      upkeep_daily: 0,
    });
    expect(sd.command.adjutants[1]).toMatchObject({
      role: 'faction',
      faction: 'soviet',
      identity: 'human',
      name: '瓦列里上校',
      buff_preset: 'heavy_industry_drive',
      upkeep_daily: HUMAN_ADJUTANT_DAILY_UPKEEP,
    });
    expect(sd.command.adjutants[2]).toMatchObject({
      role: 'staff',
      identity: 'human',
      name: '林参谋',
      buff_preset: 'logistics_actuary',
      upkeep_daily: HUMAN_ADJUTANT_DAILY_UPKEEP,
    });

    const msg = composeLaunchMessage(choices);
    expect(msg).toContain('阵营：盟军、苏联');
    expect(msg).toContain('初始资金：1700');
    expect(msg).toContain('初始暴露度：15');
  });

  it('三阵营并线（allied + soviet + yuri）：资金 ×0.75、暴露 +30、三 MCV 与三机娘齐发、2 项磨合代价', () => {
    const choices = choicesWith({
      preset: 'easy', // base credits = 3000 -> ×0.75 = 2250
      selectedFactions: ['allied', 'soviet', 'yuri'],
    });
    const sd = buildStatData(choices);
    expect(sd.economy.credits).toBe(2250);
    expect(sd.exposure.value).toBe(3);
    expect(sd.forces.vehicles).toEqual(['MCV（盟军）', 'MCV（苏联）', 'MCV（尤里）']);
    expect(sd.forces.girls.map(g => g.name)).toEqual(['白凌', '喀秋莎', '尤里卡']);
    expect(sd.command.unlocked_factions).toEqual(['allied', 'soviet', 'yuri']);
    expect(sd.command.mcv_granted_factions).toEqual(['allied', 'soviet', 'yuri']);
    expect(sd.command.break_in_penalties).toHaveLength(2);

    // 三大首发 MCV 机娘立体档案均已自动入账 initialCodex
    const codexNames = sd.codex.map(c => c.name);
    expect(codexNames).toEqual(expect.arrayContaining(['白凌', '喀秋莎', '尤里卡']));
    const bailingCodex = sd.codex.find(c => c.name === '白凌')!;
    expect(bailingCodex.kind).toBe('人员');
    expect(bailingCodex.params).toMatchObject({
      阵营归属: '盟军',
      机体序列: 'MCV-A01 · MCV（盟军）首台核心',
      代号: 'Zero',
      开局职务: '零号纳米与频谱总管',
      核心意象: '无尘室里的冰瓷长姊',
    });
    expect(bailingCodex.params?.['外貌着装']).toContain('银白长发');
    expect(bailingCodex.params?.['性格与口吻']).toContain('冰瓷大管家');
    expect(bailingCodex.params?.['工业专精与搭档']).toContain('内务铁三角');
    expect(bailingCodex.params?.['标志性台词']).toContain('公差零点零零一毫米');

    const msg = composeLaunchMessage(choices);
    expect(msg).toContain('【首发核心机娘差异化人设锚点（严禁写得像同质化播报机器）】');
    expect(msg).toContain('无尘室里的冰瓷长姊');
    expect(msg).toContain('高炉边的烈火大姐头');
    expect(msg).toContain('培养舱畔的慵懒毒舌御医');
    expect(msg).toContain('内务铁三角');

    // 验证 StarterMcvInfo 别名解析（薇拉 -> 尤里卡）
    expect(resolveStarterMcvInfo('薇拉')?.girlName).toBe('尤里卡');
    expect(FACTION_STARTER_MCV_MAP.yuri.aliases).toContain('薇拉');
  });
});

describe('CMD-LAUNCH-01 · worlds 与 planFactionWorldbookSync 多阵营四书同步及 Swipe 回退', () => {
  const allAvailable = [
    ...ALLIED_WORLDBOOK_GROUP,
    ...SOVIET_WORLDBOOK_GROUP,
    PROTOCOL_WORLDBOOK,
  ];

  it('worlds.ts 常量契约：以世界书同步服务目标名为基准，含《协议》《机娘·能力档案》、盟军四书与苏联四书（无 _世界书 后缀）', () => {
    expect(PROTOCOL_WORLDBOOK).toBe('协议');
    expect(CORE_REQUIRED_WORLDBOOKS).toContain('协议');
    expect(CORE_REQUIRED_WORLDBOOKS).toContain('机娘·能力档案');
    expect(LEGACY_DUPLICATE_WORLDBOOK_NAMES).toContain('机娘·能力档案_世界书');
    for (const manifest of Object.values(WORLD_BOOK_MANIFESTS)) {
      expect(manifest.books.some(b => b.name === '机娘·能力档案' && b.required)).toBe(true);
    }
    expect(ALLIED_WORLDBOOK_GROUP).toEqual([
      '武备·盟军',
      '特色建筑·盟军',
      '特色科技·盟军',
      '工程·盟军',
    ]);
    expect(SOVIET_WORLDBOOK_GROUP).toEqual([
      '武备·苏联',
      '特色建筑·苏联',
      '特色科技·苏联',
      '工程·苏联',
    ]);
  });

  it('双阵营解锁（allied + soviet）时并集启用盟军四书 + 苏联四书 + 协议，且自动剔除同名 _世界书 重复挂载并保留非受管用户书', () => {
    const plan = planFactionWorldbookSync({
      unlockedFactions: ['allied', 'soviet'],
      activeGlobal: ['用户自定义书A', '武备·盟军_世界书', '协议_世界书', ...ALLIED_WORLDBOOK_GROUP],
      available: [...allAvailable, '武备·盟军_世界书', '协议_世界书'],
    });

    expect(plan.unavailableRequired).toEqual([]);
    expect(plan.nextActiveGlobal).toContain('用户自定义书A');
    for (const b of ALLIED_WORLDBOOK_GROUP) {
      expect(plan.nextActiveGlobal).toContain(b);
    }
    for (const b of SOVIET_WORLDBOOK_GROUP) {
      expect(plan.nextActiveGlobal).toContain(b);
    }
    expect(plan.nextActiveGlobal).toContain('协议');
    // 自动清理同名 _世界书 重复挂载
    expect(plan.nextActiveGlobal).not.toContain('武备·盟军_世界书');
    expect(plan.nextActiveGlobal).not.toContain('协议_世界书');
    expect(plan.changed).toBe(true);
  });

  it('Swipe 回退：从 [allied, soviet] 切回 [allied] 时自动移除苏联四书，100% 保留盟军四书、协议_世界书与用户自定义书', () => {
    const activeWhenDual = [
      '用户自定义书A',
      '他卡哨兵书B',
      ...ALLIED_WORLDBOOK_GROUP,
      ...SOVIET_WORLDBOOK_GROUP,
      PROTOCOL_WORLDBOOK,
    ];

    const rollbackPlan = planFactionWorldbookSync({
      unlockedFactions: ['allied'],
      activeGlobal: activeWhenDual,
      available: allAvailable,
    });

    expect(rollbackPlan.changed).toBe(true);
    // 用户自定义非受管书 100% 保留
    expect(rollbackPlan.nextActiveGlobal).toContain('用户自定义书A');
    expect(rollbackPlan.nextActiveGlobal).toContain('他卡哨兵书B');
    // 已解锁盟军四书 + 协议书保留
    for (const b of ALLIED_WORLDBOOK_GROUP) {
      expect(rollbackPlan.nextActiveGlobal).toContain(b);
    }
    expect(rollbackPlan.nextActiveGlobal).toContain(PROTOCOL_WORLDBOOK);
    // 未解锁的苏联四书全部从 nextActiveGlobal 移除
    for (const b of SOVIET_WORLDBOOK_GROUP) {
      expect(rollbackPlan.nextActiveGlobal).not.toContain(b);
    }
    expect(rollbackPlan.removed).toEqual(expect.arrayContaining([...SOVIET_WORLDBOOK_GROUP]));
  });

  it('planWorldbookSync + runLaunchPipeline：双阵营发射时自动同步对应阵营四书与协议书', async () => {
    const adapter = createMockHostAdapter();
    adapter.tavernBooks = [
      ...new Set([...adapter.tavernBooks, ...ALLIED_WORLDBOOK_GROUP, ...SOVIET_WORLDBOOK_GROUP, PROTOCOL_WORLDBOOK]),
    ];

    const plan = planWorldbookSync(
      WORLD_BOOK_MANIFESTS.xiuzhen,
      adapter.globalWorldbookNames(),
      adapter.allWorldbookNames(),
      ['allied', 'soviet'],
    );
    expect(plan.next).toEqual(expect.arrayContaining([...SOVIET_WORLDBOOK_GROUP, PROTOCOL_WORLDBOOK]));

    const choices = choicesWith({ selectedFactions: ['allied', 'soviet'] });
    await runLaunchPipeline(createLaunchSteps(), { adapter, choices });
    expect(adapter.globalBooks).toContain('预览·他卡自有书');
    expect( adapter.globalBooks).toEqual(expect.arrayContaining([...SOVIET_WORLDBOOK_GROUP, PROTOCOL_WORLDBOOK]));
  });

  it('工程系统与巨构世界书联动开关（engineeringEnabled）：生产环境默认 false 时自动排他停用工程四书，true 时启用对应阵营工程书与《工程·通用》', () => {
    const availWithCommon = [...allAvailable, '工程·通用', '工程·尤里'];
    const activeBefore = ['用户自定义书A', '工程·通用', '工程·盟军', '工程·苏联', '武备·盟军', '协议'];

    // 1. 生产环境（engineeringEnabled: false）：自动移除全部工程与巨构世界书，保留常规三书与协议书
    const disabledPlan = planFactionWorldbookSync({
      unlockedFactions: ['allied', 'soviet'],
      activeGlobal: activeBefore,
      available: availWithCommon,
      engineeringEnabled: false,
    });
    expect(disabledPlan.nextActiveGlobal).toContain('用户自定义书A');
    expect(disabledPlan.nextActiveGlobal).toContain('武备·盟军');
    expect(disabledPlan.nextActiveGlobal).toContain('武备·苏联');
    expect(disabledPlan.nextActiveGlobal).toContain('协议');
    expect(disabledPlan.nextActiveGlobal).not.toContain('工程·通用');
    expect(disabledPlan.nextActiveGlobal).not.toContain('工程·盟军');
    expect(disabledPlan.nextActiveGlobal).not.toContain('工程·苏联');

    // 2. 开启工程系统（engineeringEnabled: true）：自动启用已解锁阵营工程书 + 《工程·通用》，但未解锁的尤里工程书不启用
    const enabledPlan = planFactionWorldbookSync({
      unlockedFactions: ['allied', 'soviet'],
      activeGlobal: disabledPlan.nextActiveGlobal,
      available: availWithCommon,
      engineeringEnabled: true,
    });
    expect(enabledPlan.nextActiveGlobal).toContain('工程·通用');
    expect(enabledPlan.nextActiveGlobal).toContain('工程·盟军');
    expect(enabledPlan.nextActiveGlobal).toContain('工程·苏联');
    expect(enabledPlan.nextActiveGlobal).not.toContain('工程·尤里');
  });
});
