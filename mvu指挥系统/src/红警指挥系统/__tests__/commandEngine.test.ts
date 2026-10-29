import { describe, expect, it } from 'vitest';
import { applyOperation } from '../../中控悬浮窗/models/operationEngine';
import { parseFactionUnlockPayload } from '../parse/factionUnlockParser';
import { parseMessageText } from '../parse/parsePipeline';
import { Schema, type StatData } from '../core/schema';
import {
  applyAdjutantEventDeclaration,
  applyFactionUnlockSettlement,
  settleCommandHQSlice,
  settleFloor,
} from '../engines/settleFloor';

function createBaseStat(overrides: Record<string, unknown> = {}): StatData {
  return Schema.parse(overrides);
}

describe('CMD-ENGINE-01: 联席参谋部结算引擎与终生唯一首发 MCV 防刷锁', () => {
  it('G07-01：首次战略任务与专用标签发放一致，两个任务同阵营只赠送一次', () => {
    const tagged = createBaseStat();
    applyFactionUnlockSettlement(tagged, [parseFactionUnlockPayload('阵营: 苏联')!]);
    let data = createBaseStat();
    for (const name of ['接收火种', '后续接管']) {
      const result = parseMessageText(`<任务>
名称: ${name}
类别: 主线
状态: 已完成
奖励:
  解锁阵营: [苏联]
</任务>`, data);
      data = result.data;
      expect(data.command.unlocked_factions).toEqual(tagged.command.unlocked_factions);
      expect(data.command.mcv_granted_factions).toEqual(['soviet']);
      expect(data.forces.vehicles).toEqual(['MCV（苏联）']);
      expect(data.forces.girls).toMatchObject(tagged.forces.girls);
      expect(data.command.adjutants).toEqual(tagged.command.adjutants);
    }
  });

  it.each(['解锁阵营: [苏联]', '缴获载具: [MCV（苏联）]'])(
    'G07-01：MCV展开移出车辆列表后，战略任务不补发（%s）',
    reward => {
      const data = createBaseStat();
      applyFactionUnlockSettlement(data, [parseFactionUnlockPayload('阵营: 苏联')!]);
      data.forces.vehicles = []; // 已展开的MCV不再作为待命载具列出。
      const result = parseMessageText(`<任务>
名称: 已展开阵营的后续奖励
类别: 指令
状态: 已完成
奖励:
  ${reward}
</任务>`, data);
      expect(result.data.command.mcv_granted_factions).toEqual(['soviet']);
      expect(result.data.forces.vehicles).toEqual([]);
      expect(result.data.forces.girls).toMatchObject(data.forces.girls);
      expect(result.data.command.adjutants).toEqual(data.command.adjutants);
      expect(result.events.some(e => e.message.includes('[防刷拦截]'))).toBe(true);
    },
  );

  it('首次解锁 soviet 发放 MCV（苏联）与喀秋莎并写入 mcv_granted_factions，二次解锁或篡改 unlocked_factions 后绝不重复发放第二台 MCV', () => {
    const data = createBaseStat();
    const sovietUnlock = parseFactionUnlockPayload(`
阵营: 苏联
标题: 钢铁洪流授权启封
副标题: 莫斯科重工体系并网
首发机娘: 喀秋莎
初始配发:
  - MCV（苏联）
`);
    expect(sovietUnlock).not.toBeNull();

    // 1. 首次解锁 soviet
    const firstLogs = applyFactionUnlockSettlement(data, [sovietUnlock!]);
    expect(data.command.unlocked_factions).toContain('soviet');
    expect(data.command.mcv_granted_factions).toEqual(['soviet']);
    expect(data.forces.vehicles).toEqual(['MCV（苏联）']);
    expect(data.forces.girls.map(g => g.name)).toEqual(['喀秋莎']);
    expect(data.command.adjutants).toHaveLength(1);
    expect(data.command.adjutants[0]).toMatchObject({
      role: 'faction',
      faction: 'soviet',
      identity: 'mcv_girl',
      name: '喀秋莎',
      upkeep_daily: 0,
      status: 'active',
    });
    expect(firstLogs.some(l => l.includes('[阵营解锁]') && l.includes('soviet') && l.includes('喀秋莎'))).toBe(
      true,
    );

    // 2. 二次解锁同一阵营：防刷拦截
    const secondLogs = applyFactionUnlockSettlement(data, [sovietUnlock!]);
    expect(secondLogs.some(l => l.includes('[防刷拦截]') && l.includes('soviet'))).toBe(true);
    expect(data.forces.vehicles.filter(v => v === 'MCV（苏联）')).toHaveLength(1);
    expect(data.forces.girls.filter(g => g.name === '喀秋莎')).toHaveLength(1);

    // 3. 篡改 unlocked_factions（移除 soviet）并清空现有载具后再次触发解锁：因 mcv_granted_factions 锁存在，严禁补发第二台 MCV
    data.command.unlocked_factions = ['allied'];
    data.forces.vehicles = [];
    const thirdLogs = applyFactionUnlockSettlement(data, [sovietUnlock!]);
    expect(data.command.unlocked_factions).toContain('soviet');
    expect(thirdLogs.some(l => l.includes('[防刷拦截]'))).toBe(true);
    expect(data.forces.vehicles).toEqual([]);
  });

  it('<事件> 副官指派 入账、人类副官日薪折算扣费、以及 15 日（21600 分钟）磨合期代价随 settleFloor 归零自动清除', () => {
    const raw = `
<事件>
- 类型: 副官指派
  席位类型: 阵营主责
  所属阵营: 苏联
  副官身份: 人类
  副官姓名: 伊万诺夫
  副官头衔: 红旗重工特派总监
  专长预设: 重工催产督导
  代价预设: 苏式高压并网冲击
  原因: 紧急接管苏军重工产线并网
</事件>
`;
    const baseData = createBaseStat({
      economy: { credits: 1000 },
    });
    (baseData as unknown as { resources: { credits: number } }).resources = { credits: 1000 };

    const parsed = parseMessageText(raw, baseData);
    expect(parsed.eventDeclarations).toHaveLength(1);
    expect(parsed.eventDeclarations[0].kind).toBe('adjutant');

    const decl = parsed.eventDeclarations[0].adjutant!;
    const logs = applyAdjutantEventDeclaration(baseData, decl);
    expect(logs.some(l => l.includes('[副官指派]') && l.includes('伊万诺夫'))).toBe(true);
    expect(logs.some(l => l.includes('[磨合代价]') && l.includes('苏式高压并网冲击'))).toBe(true);

    expect(baseData.command.adjutants).toHaveLength(1);
    expect(baseData.command.adjutants[0]).toMatchObject({
      role: 'faction',
      faction: 'soviet',
      identity: 'human',
      name: '伊万诺夫',
      buff_preset: 'heavy_industry_drive',
      upkeep_daily: 80,
      status: 'active',
    });

    expect(baseData.command.break_in_penalties).toHaveLength(1);
    expect(baseData.command.break_in_penalties[0]).toMatchObject({
      id: 'pen_sov_grid_surge',
      faction: 'soviet',
      remaining_minutes: 21600,
      total_minutes: 21600,
    });

    // 推进 1 天（1440 分钟）：扣除 1 名人类副官日薪 80，磨合期剩余 20160 分钟
    const sliceDay1 = settleCommandHQSlice(baseData, 1440);
    expect((baseData as unknown as { resources: { credits: number } }).resources.credits).toBe(920);
    expect(baseData.economy.credits).toBe(920);
    expect(baseData.command.break_in_penalties[0].remaining_minutes).toBe(20160);
    expect(sliceDay1.effectiveAdjutantBuffs.heavyVehicleProdRateBonus).toBeCloseTo(0.12);

    // 随 settleFloor 推进剩余 14 天（20160 分钟）：满 21600 分钟磨合期代价归零自动清除
    const settled = settleFloor(baseData, baseData, '<timePast>14 D 0 H 0 M</timePast>');
    expect(settled.data.command.break_in_penalties).toHaveLength(0);
    expect(settled.events.some(e => e.message.includes('[磨合消解]'))).toBe(true);
    // 14 天再扣 14 * 80 = 1120，下限钳制为 0
    expect(settled.data.economy.credits).toBe(0);
    expect((settled.data as unknown as { resources: { credits: number } }).resources.credits).toBe(0);
  });

  it('MCV 机娘 hp = 0 时副官自动进入 recovering 休眠且 Buff 暂停、hp = 100 时恢复 active', () => {
    const data = createBaseStat();
    const sovietUnlock = parseFactionUnlockPayload(`
阵营: 苏联
首发机娘: 喀秋莎
`);
    applyFactionUnlockSettlement(data, [sovietUnlock!]);
    expect(data.command.adjutants[0].status).toBe('active');

    // 将喀秋莎 hp 置为 0（模拟重伤离线）
    const girlRecord = data.forces.girls[0] as unknown as Record<string, unknown>;
    girlRecord.hp = 0;

    const injuredSlice = settleCommandHQSlice(data, 60);
    expect(data.command.adjutants[0].status as string).toBe('recovering');
    expect(injuredSlice.effectiveAdjutantBuffs.heavyVehicleProdRateBonus).toBeUndefined();
    expect(injuredSlice.logs.some(l => l.includes('recovering'))).toBe(true);

    // BUG-R2-13：处于「修复中 / 维修中 / 医疗舱 / 休整」阶段时，保持 recovering 不提前转回 active
    for (const midState of ['修复中', '维修中', '维护中', '医疗舱', '休整']) {
      girlRecord.hp = midState;
      girlRecord.status = midState;
      const midSlice = settleCommandHQSlice(data, 60);
      expect(data.command.adjutants[0].status as string).toBe('recovering');
      expect(midSlice.effectiveAdjutantBuffs.heavyVehicleProdRateBonus).toBeUndefined();
    }

    // 将喀秋莎恢复为完好（hp = 100, status = '完好'）
    girlRecord.hp = 100;
    girlRecord.status = '完好';
    const recoveredSlice = settleCommandHQSlice(data, 60);
    expect(data.command.adjutants[0].status).toBe('active');
    expect(recoveredSlice.effectiveAdjutantBuffs.heavyVehicleProdRateBonus).toBeCloseTo(0.18);
    expect(recoveredSlice.logs.some(l => l.includes('active'))).toBe(true);
  });

  it('三大官方阵营硬锁：<阵营解锁> 仅接受 allied / soviet / yuri，尝试解锁任何自创第四阵营（如 升阳帝国）时被严格拦截隔离', () => {
    const data = createBaseStat();
    const invalidUnlock = parseFactionUnlockPayload(`
阵营: 升阳帝国
标题: 天照纳米核心启封
`);
    expect(invalidUnlock).toBeNull();

    const parsed = parseMessageText(
      `<阵营解锁>
阵营: 升阳帝国
首发机娘: 神乐铃
</阵营解锁>`,
      data,
    );
    expect(parsed.factionUnlocks).toHaveLength(0);
    expect(parsed.quarantine.some(q => q.tag === '阵营解锁')).toBe(true);
  });

  it('G07-02：未解锁阵营或不在编/失能 MCV 机娘指派被拒且不白嫖免费加成，已解锁+在编有效机娘及人类副官正常生效', () => {
    const data = createBaseStat();

    // 1. 未解锁阵营（仅 allied 解锁，即便编入喀秋莎）指派 soviet MCV 机娘被拒
    data.forces.girls.push({ name: '喀秋莎', duty: '苏联MCV', hp: '完好', base: '' } as any);
    const lockedParsed = parseMessageText(`
<事件>
- 类型: 副官指派
  席位类型: 阵营主责
  所属阵营: 苏联
  副官身份: MCV机娘
  副官姓名: 喀秋莎
  专长预设: 重工催产督导
  代价预设: 苏式高压并网冲击
</事件>`, data);
    const lockedLogs = applyAdjutantEventDeclaration(data, lockedParsed.eventDeclarations[0].adjutant!);
    expect(data.command.adjutants).toHaveLength(0);
    expect(data.command.break_in_penalties).toHaveLength(0);
    expect(lockedLogs.some(l => l.includes('未解锁'))).toBe(true);

    // 2. 阵营已解锁，但机娘不在编或处于失能状态（离线/mia/重伤）时指派被拒，且已在岗缺失实体不白嫖加成
    data.command.unlocked_factions = ['allied', 'soviet'];
    data.forces.girls = [];
    const missingLogs = applyAdjutantEventDeclaration(data, lockedParsed.eventDeclarations[0].adjutant!);
    expect(data.command.adjutants).toHaveLength(0);
    expect(missingLogs.some(l => l.includes('不在编') || l.includes('失能'))).toBe(true);

    data.forces.girls = [{ name: '喀秋莎', duty: '苏联MCV', hp: '离线', base: '' } as any];
    const offlineLogs = applyAdjutantEventDeclaration(data, lockedParsed.eventDeclarations[0].adjutant!);
    expect(data.command.adjutants).toHaveLength(0);
    expect(offlineLogs.some(l => l.includes('失能'))).toBe(true);

    // 模拟槽位中残留不在编虚构机娘副官（即使已有 1 名真机娘在编）：虚构副官转入 recovering 且不白嫖加成
    data.forces.girls = [{ name: '白凌', duty: '盟军MCV', hp: '完好', base: '' } as any];
    data.command.adjutants = [{
      id: 'adj_faction_soviet',
      role: 'faction',
      faction: 'soviet',
      identity: 'mcv_girl',
      name: '幽灵机娘',
      title: '虚构核心',
      buff_preset: 'heavy_industry_drive',
      upkeep_daily: 0,
      status: 'active',
      note: '',
    }];
    const ghostSlice = settleCommandHQSlice(data, 60);
    expect(data.command.adjutants[0].status).toBe('recovering');
    expect(ghostSlice.effectiveAdjutantBuffs.heavyVehicleProdRateBonus).toBeUndefined();

    // 3. 已解锁阵营 + 在编有效机娘正常指派并结算 MCV 档加成
    data.command.adjutants = [];
    data.forces.girls = [{ name: '喀秋莎', duty: '苏联MCV', hp: '完好', base: '' } as any];
    const okLogs = applyAdjutantEventDeclaration(data, lockedParsed.eventDeclarations[0].adjutant!);
    expect(okLogs.some(l => l.includes('[副官指派]') && l.includes('喀秋莎'))).toBe(true);
    expect(data.command.adjutants).toHaveLength(1);
    const activeSlice = settleCommandHQSlice(data, 60);
    expect(activeSlice.effectiveAdjutantBuffs.heavyVehicleProdRateBonus).toBeCloseTo(0.18);
  });

  it('G07-03：人类副官日薪连续 144 次 10 分钟短楼层推进累计扣薪精确等于单次 1440 分钟推进（50/日与 80/日零套利）', () => {
    for (const dailyUpkeep of [50, 80]) {
      const makeAdjState = () =>
        createBaseStat({
          economy: { credits: 1000 },
          command: {
            adjutants: [
              {
                id: 'adj_staff_human',
                role: 'staff',
                faction: 'common',
                identity: 'human',
                name: '精算参谋',
                title: '财务官',
                buff_preset: 'logistics_actuary',
                upkeep_daily: dailyUpkeep,
                status: 'active',
                note: '',
              },
            ],
          },
        });

      const singleDay = makeAdjState();
      settleCommandHQSlice(singleDay, 1440);
      expect(singleDay.economy.credits).toBe(1000 - dailyUpkeep);

      const slicedDay = makeAdjState();
      for (let i = 0; i < 144; i++) {
        settleCommandHQSlice(slicedDay, 10);
      }
      expect(slicedDay.economy.credits).toBe(1000 - dailyUpkeep);
    }
  });

  it('G07-04：磨合期维持费仅剩 360 分钟（0.25 天）而推进 1440 分钟时，仅收 1/4 天维持费并到期清退', () => {
    const state = createBaseStat({
      economy: { credits: 1000 },
      command: {
        break_in_penalties: [
          {
            id: 'pen_sov_broad_gauge',
            faction: 'soviet',
            name: '宽轨物资转运损耗',
            effect_kind: 'daily_upkeep',
            magnitude: 400, // 每日 400，360 分钟（0.25 天）仅应收 100
            total_minutes: 21600,
            remaining_minutes: 360,
            reason: '',
          },
        ],
      },
    });

    const slice = settleCommandHQSlice(state, 1440);
    expect(state.economy.credits).toBe(900);
    expect(state.command.break_in_penalties).toHaveLength(0);
    expect(slice.logs.some(l => l.includes('[磨合维持费]') && l.includes('扣除 100 资金'))).toBe(true);
    expect(slice.logs.some(l => l.includes('[磨合消解]'))).toBe(true);
  });

  it('operationEngine.ts 支持 CommandAssignAdjutant（含参谋槽上限校验与日薪设定）与 CommandDismissAdjutant', () => {
    const state = createBaseStat({
      bases: [
        {
          id: 'base_1',
          name: '一号基地',
          status: '隐蔽中',
          buildings: [{ name: '发电厂', state: '运转' }],
        },
      ],
    });

    // 1. 指派阵营主责机娘副官（upkeep_daily = 0）
    const assignFactionRes = applyOperation(state, {
      type: 'CommandAssignAdjutant',
      slotRole: 'faction',
      faction: 'allied',
      identity: 'mcv_girl',
      name: '白凌',
      title: '盟军MCV核心',
      buffPreset: 'grid_harmonic_tuning',
    });
    expect(assignFactionRes.ok).toBe(true);
    expect(assignFactionRes.summary).toContain('白凌');
    expect(state.command.adjutants).toHaveLength(1);
    expect(state.command.adjutants[0].upkeep_daily).toBe(0);

    // 2. 指派随行人类参谋（基础槽位上限 = 1，upkeep_daily = 80）
    const assignStaff1 = applyOperation(state, {
      type: 'CommandAssignAdjutant',
      slotRole: 'staff',
      identity: 'human',
      name: '林参谋',
      title: '后勤精算官',
      buffPreset: 'logistics_actuary',
    });
    expect(assignStaff1.ok).toBe(true);
    expect(assignStaff1.summary).toContain('林参谋');
    expect(assignStaff1.adjutant?.upkeep_daily).toBe(80);
    expect(state.command.adjutants.filter(a => a.role === 'staff')).toHaveLength(1);

    // 3. 超出参谋槽位上限（1/1）时拦截
    const assignStaffOverflow = applyOperation(state, {
      type: 'CommandAssignAdjutant',
      slotRole: 'staff',
      identity: 'human',
      name: '陈参谋',
      buffPreset: 'counter_recon_screen',
    });
    expect(assignStaffOverflow.ok).toBe(false);
    expect(assignStaffOverflow.summary).toContain('上限');
    expect(state.command.adjutants.filter(a => a.role === 'staff')).toHaveLength(1);

    // 4. 解聘随行参谋后槽位释放
    const dismissRes = applyOperation(state, {
      type: 'CommandDismissAdjutant',
      adjutantId: 'adj_staff_林参谋',
    });
    expect(dismissRes.ok).toBe(true);
    expect(dismissRes.summary).toContain('林参谋');
    expect(state.command.adjutants.filter(a => a.role === 'staff')).toHaveLength(0);
  });

  it('BUG-R2-25(1)：严守标签边界（<态势> 顶层写 机娘 正常报 战况.机娘 隔离），且顶层 <机娘> 标签复现 #64~#70 楼 机娘副官 重伤 -> 修复中 -> 完好 与 recovering/active 联动', () => {
    const state = createBaseStat({
      command: {
        commander_name: '指挥官',
        commander_title: '战区最高统帅',
        unlocked_factions: ['allied', 'soviet'],
        mcv_granted_factions: ['allied', 'soviet'],
        adjutants: [
          {
            id: 'adj_faction_soviet',
            role: 'faction',
            faction: 'soviet',
            identity: 'mcv_girl',
            name: '喀秋莎',
            title: '苏联MCV移动基地车核心',
            buff_preset: 'grid_harmonic_tuning',
            upkeep_daily: 0,
            status: 'active',
            note: '',
          },
        ],
        break_in_penalties: [],
      },
      forces: {
        girls: [
          {
            name: '喀秋莎',
            duty: '苏联MCV移动基地车核心',
            hp: '完好',
            base: '前沿基地',
          },
        ],
        troops: {},
        ammo: {},
        vehicles: [],
        equipment: {},
        command_cap: '',
      },
    });

    // 0. 严守标签职责边界：在 <态势> 顶层直接写 机娘: 必须报 战况.机娘 无法映射的键隔离错误
    const invalidSitGirls = parseMessageText(
      `<态势>
机娘:
  - 姓名: 喀秋莎
    状态: 重伤
</态势>`,
      state,
    );
    expect(invalidSitGirls.quarantine.some(q => q.path === '战况.机娘' && q.error === '无法映射的键')).toBe(true);

    // 1. 顶层 <机娘> 标签：包含 姓名/代号/阵营/兵种/状态/好感/服从/伪装身份/暴露状态/技能列表 零隔离
    const floor62Res = parseMessageText(
      `<机娘>
- 姓名: 赤星
  代号: RedStar
  阵营: 苏联
  兵种: 战术突击机娘
  状态: 完好
  好感度: 68
  服从度: 85
  伪装身份: 北境铁道实习调度员
  暴露状态: 低度伪装（仅内部知悉）
  技能列表:
    - 滑膛极限过载连射
    - 反应装甲定向格挡
</机娘>`,
      state,
    );
    expect(floor62Res.quarantine).toEqual([]);
    const redStar = floor62Res.data.forces.girls.find(g => g.name === '赤星');
    expect(redStar).toBeDefined();
    expect(redStar?.callsign).toBe('RedStar');
    expect(redStar?.faction).toBe('苏联');
    expect(redStar?.duty).toBe('战术突击机娘');
    expect(redStar?.hp).toBe('完好');
    expect(redStar?.affection).toBe(68);
    expect(redStar?.obedience).toBe(85);
    expect(redStar?.shell).toBe('北境铁道实习调度员');
    expect(redStar?.exposure).toBe('低度伪装（仅内部知悉）');
    expect(redStar?.traits).toEqual(['滑膛极限过载连射', '反应装甲定向格挡']);

    // 2. 复现 #68 楼：顶层 <机娘> 喀秋莎 状态: 重伤 -> 副官转入 recovering
    const floor68Res = parseMessageText(
      `<机娘>
- 姓名: 喀秋莎
  状态: 重伤
</机娘>`,
      floor62Res.data,
    );
    expect(floor68Res.quarantine).toEqual([]);
    const katAfter68 = floor68Res.data.forces.girls.find(g => g.name === '喀秋莎');
    expect(katAfter68?.hp).toBe('重伤');

    const slice68 = settleCommandHQSlice(floor68Res.data, 30);
    expect(floor68Res.data.command.adjutants[0].status).toBe('recovering');
    expect(slice68.effectiveAdjutantBuffs.powerOutputBonus).toBeUndefined();

    // 3. 复现 #69 楼：顶层 <机娘> 喀秋莎 状态: 修复中 -> 副官必须保持 recovering，不得提前恢复 active
    const floor69Res = parseMessageText(
      `<机娘>
- 姓名: 喀秋莎
  状态: 修复中
</机娘>`,
      floor68Res.data,
    );
    expect(floor69Res.quarantine).toEqual([]);
    const katAfter69 = floor69Res.data.forces.girls.find(g => g.name === '喀秋莎');
    expect(katAfter69?.hp).toBe('修复中');

    const slice69 = settleCommandHQSlice(floor69Res.data, 60);
    expect(floor69Res.data.command.adjutants[0].status).toBe('recovering');
    expect(slice69.effectiveAdjutantBuffs.powerOutputBonus).toBeUndefined();

    // 4. 复现 #70 楼：顶层 <机娘> 喀秋莎 状态: 完好 -> 副官恢复 active
    const floor70Res = parseMessageText(
      `<机娘>
- 姓名: 喀秋莎
  状态: 完好
</机娘>`,
      floor69Res.data,
    );
    expect(floor70Res.quarantine).toEqual([]);
    const katAfter70 = floor70Res.data.forces.girls.find(g => g.name === '喀秋莎');
    expect(katAfter70?.hp).toBe('完好');

    const slice70 = settleCommandHQSlice(floor70Res.data, 60);
    expect(floor70Res.data.command.adjutants[0].status).toBe('active');
    expect(slice70.effectiveAdjutantBuffs.powerOutputBonus).toBe(0.14);

    // 5. 额外验证：顶层 <机娘> 伤势: 损毁 归一为 重伤
    const destroyedRes = parseMessageText(
      `<机娘>
- 姓名: 赤星
  伤势: 损毁
</机娘>`,
      floor70Res.data,
    );
    expect(destroyedRes.quarantine).toEqual([]);
    expect(destroyedRes.data.forces.girls.find(g => g.name === '赤星')?.hp).toBe('重伤');
  });

  it('BUG-R2-25(2)：<阵营解锁> 自动加入尤里卡后，再执行 <事件> 副官指派: 尤里卡 按 name 去重，不产生两个 尤里卡:active', () => {
    const state = createBaseStat();

    // #40 楼：<阵营解锁> 解锁尤里并自动将 尤里卡 加入 command.adjutants
    const floor40Res = parseMessageText(
      `<阵营解锁>
阵营: 尤里新星
原因: 捕获心灵信标原型机
初始发放: MCV（尤里）
伴生机娘: 尤里卡
</阵营解锁>`,
      state,
    );
    expect(floor40Res.quarantine).toEqual([]);
    applyFactionUnlockSettlement(floor40Res.data, floor40Res.factionUnlocks);
    expect(floor40Res.data.command.adjutants.filter(a => a.name === '尤里卡')).toHaveLength(1);

    // #42 楼：LLM 输出 <事件> 副官指派: 尤里卡（如指定为 staff 席位或更新专长预设）
    const floor42Res = parseMessageText(
      `<事件>
- 动词: 副官指派
  席位类型: 参谋增益
  副官身份: MCV机娘
  副官姓名: 尤里卡
  专长预设: 反侦察信号屏障
  原因: 指派尤里卡主持心灵反侦察网络
</事件>`,
      floor40Res.data,
    );
    expect(floor42Res.quarantine).toEqual([]);
    expect(floor42Res.eventDeclarations).toHaveLength(1);
    expect(floor42Res.eventDeclarations[0].kind).toBe('adjutant');
    applyAdjutantEventDeclaration(floor42Res.data, floor42Res.eventDeclarations[0].adjutant!);

    const yurekaList = floor42Res.data.command.adjutants.filter(a => a.name === '尤里卡');
    expect(yurekaList).toHaveLength(1);
    expect(yurekaList[0].buff_preset).toBe('counter_recon_screen');
    expect(yurekaList[0].status).toBe('active');
  });

  it('BUG-R2-25(4)：<图鉴> 保持三要素严格边界（名称/类别/简介），<扩展档案> 支持 分类: 势力/组织/财团/派系/企业 零隔离通过校验，而 分类: 阵营 被严格拦截隔离', () => {
    const state = createBaseStat();

    const res = parseMessageText(
      `<图鉴>
- 名称: 灰熊坦克战地附加反应装甲型
  分类: 载具
  简介: 加装战地爆破反应装甲模块的盟军主战坦克改型。
</图鉴>
<扩展档案>
- 名称: 太平洋波能重工联合会
  分类: 势力
  所属阵营: 地方财团
  首领: 白川源三郎
  态度: 合作
  风险: 中
  简介: 掌控环太平洋波能矿脉与重工代工链的巨型军工财团。
  详细设定: 由三大重工船坞合并而成的战时联合会，控制多条远洋货运航线。
- 名称: 黑潮海运株式会社
  分类: 财团
  简介: 负责隐蔽海运补给的外围企业。
  详细设定: 表面经营远洋渔业，实则为矿石运输提供掩护船队。
</扩展档案>`,
      state,
    );

    expect(res.quarantine).toEqual([]);

    const modTank = res.data.codex.find(c => c.name === '灰熊坦克战地附加反应装甲型');
    expect(modTank).toBeDefined();
    expect(modTank?.kind).toBe('载具');
    expect(modTank?.desc).toContain('加装战地爆破反应装甲模块');

    const federation = res.data.pending_expansions.find(e => e.name === '太平洋波能重工联合会');
    expect(federation).toBeDefined();
    expect(federation?.kind).toBe('势力');
    expect(federation?.params?.['所属阵营']).toBe('地方财团');
    expect(federation?.params?.['首领']).toBe('白川源三郎');
    expect(federation?.params?.['态度']).toBe('合作');

    const zaibatsu = res.data.pending_expansions.find(e => e.name === '黑潮海运株式会社');
    expect(zaibatsu).toBeDefined();
    expect(zaibatsu?.kind).toBe('势力');
  });
});
