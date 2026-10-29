import { describe, expect, it } from 'vitest';
import { Quest, QuestReward, Schema } from '../core/schema';
import { parseMessageText } from '../parse/parsePipeline';

const zero = () => Schema.parse({});

describe('FD-29 PKG-A · Schema 扩展、<任务> 解析器与悬赏自动交割引擎', () => {
  it('1. Schema 扩展与归零兼容：QuestReward 默认值与 Quest 可选扩展字段零破坏', () => {
    const r0 = QuestReward.parse({});
    expect(r0).toEqual({
      credits: 0,
      intel_points: 0,
      resources: {},
      items: [],
      text: '',
    });

    const legacyQuest = Quest.parse({ name: '旧版任务' });
    expect(legacyQuest).toEqual({
      name: '旧版任务',
      progress: '',
      note: '',
      detail: '',
    });

    const z0 = zero();
    expect(z0.quests).toEqual({ active: [], done_count: 0 });
  });

  it('2. <任务> 发布入列：支持 YAML 列表、包装对象、单对象及字段/类别/状态别名', () => {
    const raw = `
<任务>
- 名称: 铁幕前哨·废弃货场清剿
  类别: 主线任务
  状态: 发布
  发包方: 盟军战区联席参谋部 / 白凌
  进度: 1/3 · 已完成外围工兵侦察
  要点: 清除盘踞在废弃货运站内的游荡武装，夺取完整铁轨调度控制室
  详情: 货运站存有可回收高纯度工业钢材与柴油储备，打通后可建立稳定的废料回收点。
  奖励:
    资金: 1500
    机密点: 15
    资源:
      建材:
        钢材: 300
      燃油:
        军用柴油: 150
    战利品: [废弃货场控制权, 区域铁轨拓扑图]
- 标题: 北坡防空网紧急抢修
  类型: urgent
  动作: in_progress
  委托人: 基地防空指挥所
  进展: 0/2 · 待派遣工程师
  目标: 恢复东侧爱国者飞弹阵列供电回路
</任务>`;

    const res = parseMessageText(raw, zero(), {});
    expect(res.applied).toBe(true);
    expect(res.quarantine).toEqual([]);
    expect(res.data.quests.active).toHaveLength(2);

    expect(res.data.quests.active[0]).toMatchObject({
      name: '铁幕前哨·废弃货场清剿',
      category: '主线',
      status: '进行中',
      issuer: '盟军战区联席参谋部 / 白凌',
      progress: '1/3 · 已完成外围工兵侦察',
      note: '清除盘踞在废弃货运站内的游荡武装, 夺取完整铁轨调度控制室',
      detail: '货运站存有可回收高纯度工业钢材与柴油储备, 打通后可建立稳定的废料回收点。',
      reward_claimed: false,
      rewards: {
        credits: 1500,
        intel_points: 15,
        resources: {
          materials: { 钢材: 300 },
          fuel: { 军用柴油: 150 },
        },
        items: ['废弃货场控制权', '区域铁轨拓扑图'],
        text: '',
      },
    });

    expect(res.data.quests.active[1]).toMatchObject({
      name: '北坡防空网紧急抢修',
      category: '紧急',
      status: '进行中',
      issuer: '基地防空指挥所',
      progress: '0/2 · 待派遣工程师',
      note: '恢复东侧爱国者飞弹阵列供电回路',
    });

    // 发布阶段不应提前发放奖励
    expect(res.data.economy.credits).toBe(0);
    expect(res.data.command.intel_points).toBeUndefined();
    expect(res.data.quests.done_count).toBe(0);
  });

  it('3. 在途任务推进更新：按 canon(name) 原地增量合并非空字段，保留既有奖励与详情', () => {
    const floor1 = parseMessageText(
      `<任务>
- 名称: 铁幕前哨·废弃货场清剿
  类别: 主线
  状态: 进行中
  发包方: 白凌
  进度: 1/3 · 已完成外围侦察
  要点: 清除外围哨卡
  详情: 货场原始背景说明
  奖励:
    资金: 1500
    机密点: 15
</任务>`,
      zero(),
      {},
    );

    const floor2 = parseMessageText(
      `<任务>
名称: 铁幕前哨 · 废弃货场清剿
状态: 推进
进度: 2/3 · 已突破货场西侧机库
要点: 控制中央调度塔
</任务>`,
      floor1.data,
      {},
    );

    expect(floor2.data.quests.active).toHaveLength(1);
    expect(floor2.data.quests.active[0]).toMatchObject({
      name: '铁幕前哨·废弃货场清剿',
      category: '主线',
      status: '进行中',
      issuer: '白凌',
      progress: '2/3 · 已突破货场西侧机库',
      note: '控制中央调度塔',
      detail: '货场原始背景说明',
      rewards: {
        credits: 1500,
        intel_points: 15,
      },
    });
  });

  it('4. 任务达成与悬赏自动交割：移入 history、done_count + 1、资金/六柱资源/机密点真实入账并解锁 null 小类', () => {
    const baseState = zero();
    baseState.economy.credits = 1000;
    baseState.economy.resources = Schema.parse({ economy: { resources: {} } }).economy.resources;

    const floor1 = parseMessageText(
      `<任务>
- 名称: 铁幕前哨·废弃货场清剿
  类别: 主线
  状态: 进行中
  发包方: 盟军战区联席参谋部 / 白凌
  进度: 1/3 · 已完成外围工兵侦察
  要点: 夺取铁轨调度控制室
  奖励:
    资金: 1500
    机密点: 15
    资源:
      建材:
        高强工程钢材: 300
        钢材: 200
      燃油:
        军用柴油: 150
    战利品: [废弃货场控制权, 区域铁轨拓扑图]
</任务>`,
      baseState,
      {},
    );

    const floor2 = parseMessageText(
      `<任务>
- 名称: 铁幕前哨·废弃货场清剿
  状态: 已完成
  进度: 3/3 · 货场全境肃清，控制室已接管
  要点: 战斗工程师已修复道岔并完成物资清点
</任务>`,
      floor1.data,
      {},
    );

    // 1) 从 active 摘除并移入 history 队首
    expect(floor2.data.quests.active).toHaveLength(0);
    expect(floor2.data.quests.history).toHaveLength(1);
    expect(floor2.data.quests.done_count).toBe(1);
    expect(floor2.data.quests.history?.[0]).toMatchObject({
      name: '铁幕前哨·废弃货场清剿',
      category: '主线',
      status: '已完成',
      issuer: '盟军战区联席参谋部 / 白凌',
      progress: '3/3 · 货场全境肃清, 控制室已接管',
      reward_claimed: true,
      rewards: {
        credits: 1500,
        intel_points: 15,
        items: ['废弃货场控制权', '区域铁轨拓扑图'],
      },
    });

    // 2) 资金、机密点、六柱资源真实入账（null 小类解锁为正数）
    expect(floor2.data.economy.credits).toBe(2500); // 1000 + 1500
    expect(floor2.data.command.intel_points).toBe(15);
    expect(floor2.data.economy.resources?.materials['高强工程钢材']).toBe(300);
    expect(floor2.data.economy.resources?.materials['钢材']).toBe(200);
    expect(floor2.data.economy.resources?.fuel['军用柴油']).toBe(150);
    expect(
      floor2.events.some(
        e => e.light === '🟢' && e.message.includes('作战任务「铁幕前哨·废弃货场清剿」已达成并完成悬赏交割'),
      ),
    ).toBe(true);
  });

  it('5. 防刷硬上限（Hard Caps）：credits > 10000、intel_points > 100、单小类资源 > 5000 自动钳制并记 🟡 R18', () => {
    const raw = `
<任务>
- 名称: 跨维金库破译行动
  类别: 紧急
  状态: 已完成
  奖励:
    资金: 99999
    机密点: 500
    资源:
      建材:
        高强工程钢材: 12000
</任务>`;

    const res = parseMessageText(raw, zero(), {});
    expect(res.data.economy.credits).toBe(10000);
    expect(res.data.command.intel_points).toBe(100);
    expect(res.data.economy.resources?.materials['高强工程钢材']).toBe(5000);
    expect(res.data.quests.history?.[0].rewards).toMatchObject({
      credits: 10000,
      intel_points: 100,
      resources: {
        materials: { 高强工程钢材: 5000 },
      },
    });
    expect(res.events.some(e => e.light === '🟡' && e.message.includes('10000'))).toBe(true);
    expect(res.events.some(e => e.light === '🟡' && e.message.includes('100'))).toBe(true);
    expect(res.events.some(e => e.light === '🟡' && e.message.includes('5000'))).toBe(true);
    expect(res.issues.some(i => i.rule === 'R18' && i.level === 'warn')).toBe(true);
  });

  it('6. 负数奖励安全拦截：负值 credits / intel_points / 资源记 🔴 隔离且不扣减原有资产', () => {
    const base = zero();
    base.economy.credits = 2000;
    base.command.intel_points = 30;

    const raw = `
<任务>
- 名称: 异常负值悬赏测试
  状态: 已完成
  奖励:
    资金: -800
    机密点: -10
    资源:
      建材:
        钢材: -500
</任务>`;

    const res = parseMessageText(raw, base, {});
    expect(res.data.economy.credits).toBe(2000);
    expect(res.data.command.intel_points).toBe(30);
    expect(res.quarantine.length).toBeGreaterThanOrEqual(3);
  });

  it('7. 同名任务重复完成幂等防刷：已交割任务再次输出完成不重复加钱、不重复累加 done_count', () => {
    const floor1 = parseMessageText(
      `<任务>
- 名称: 夺取北郊变电站
  类别: 支线
  状态: 已完成
  进度: 1/1 · 已控制变电站
  奖励:
    资金: 1200
    机密点: 10
</任务>`,
      zero(),
      {},
    );

    expect(floor1.data.economy.credits).toBe(1200);
    expect(floor1.data.command.intel_points).toBe(10);
    expect(floor1.data.quests.done_count).toBe(1);
    expect(floor1.data.quests.history).toHaveLength(1);

    // 后续楼层 AI 重复输出该任务已完成
    const floor2 = parseMessageText(
      `<任务>
- 名称: 夺取北郊变电站
  状态: 达成
  进度: 1/1 · 变电站稳固运行中
  要点: 后续复读状态更新
  奖励:
    资金: 1200
    机密点: 10
</任务>`,
      floor1.data,
      {},
    );

    // 幂等防刷：资金、机密点、done_count 分毫不增
    expect(floor2.data.economy.credits).toBe(1200);
    expect(floor2.data.command.intel_points).toBe(10);
    expect(floor2.data.quests.done_count).toBe(1);
    expect(floor2.data.quests.history).toHaveLength(1);
    expect(floor2.data.quests.history?.[0].progress).toBe('1/1 · 变电站稳固运行中');
    expect(floor2.events.some(e => e.light === '🟡' && e.message.includes('幂等跳过重复奖励发放'))).toBe(true);
  });

  it('8. 任务失败与取消归档：从 active 摘除并移入 history，reward_claimed=false，不发放奖励', () => {
    const floor1 = parseMessageText(
      `<任务>
- 名称: 拦截夜幕走私车队
  类别: 紧急
  状态: 进行中
  进度: 0/1 · 车队正在接近南山口
  奖励:
    资金: 2000
- 名称: 旧城区临时侦察哨
  类别: 日常
  状态: 进行中
  奖励:
    资金: 500
</任务>`,
      zero(),
      {},
    );
    expect(floor1.data.quests.active).toHaveLength(2);

    const floor2 = parseMessageText(
      `<任务>
- 名称: 拦截夜幕走私车队
  状态: 已失败
  进度: 车队已脱离战区边界
  要点: 因防空警报牵制未能及时出动快速反应部队
- 名称: 旧城区临时侦察哨
  状态: 已取消
  要点: 战区防线调整，侦察计划撤销
</任务>`,
      floor1.data,
      {},
    );

    expect(floor2.data.quests.active).toHaveLength(0);
    expect(floor2.data.quests.done_count).toBe(0);
    expect(floor2.data.economy.credits).toBe(0);
    expect(floor2.data.quests.history).toHaveLength(2);

    const failedQuest = floor2.data.quests.history?.find(q => q.name === '拦截夜幕走私车队');
    const cancelledQuest = floor2.data.quests.history?.find(q => q.name === '旧城区临时侦察哨');
    expect(failedQuest).toMatchObject({
      status: '已失败',
      reward_claimed: false,
      progress: '车队已脱离战区边界',
    });
    expect(cancelledQuest).toMatchObject({
      status: '已取消',
      reward_claimed: false,
      note: '战区防线调整, 侦察计划撤销',
    });
  });

  it('9. 纯文本奖励兜底与扁平资源简写自动归柱', () => {
    const raw = `
<任务>
任务:
  - 名称: 护送前线补给船队
    类别: 指令
    状态: 完成
    奖励: "资金 +1800，机密点 +12，解锁河道通行密令"
  - 名称: 回收废弃装甲残骸
    状态: 已完成
    奖励:
      资源:
        钢材: 450
        军用柴油: 200
        铁矿石: 350
</任务>`;

    const res = parseMessageText(raw, zero(), {});
    expect(res.data.quests.done_count).toBe(2);
    expect(res.data.economy.credits).toBe(1800);
    expect(res.data.command.intel_points).toBe(12);
    expect(res.data.economy.resources?.materials['钢材']).toBe(450);
    expect(res.data.economy.resources?.fuel['军用柴油']).toBe(200);
    expect(res.data.economy.resources?.minerals['铁矿石']).toBe(350);

    const convoyQuest = res.data.quests.history?.find(q => q.name === '护送前线补给船队');
    expect(convoyQuest?.rewards?.text).toContain('解锁河道通行密令');
  });

  it('10. 向后兼容双读：<事件> 任务接取 与 旧版 <战况> 任务 均可同源入列并由 <任务> 完成交割', () => {
    const step1 = parseMessageText(
      `<事件>
- 类型: 任务接取
  名称: 猎取高纯微晶样本
  进度: 1/3
  详情: 渗透敌方精炼厂获取样本
</事件>
<战况>
任务:
  - 名称: 修复北坡雷达站
    进度: 50%
    要点: 更换受损波导阵列
完成任务数: 2
</战况>`,
      zero(),
      {},
    );

    expect(step1.data.quests.active).toHaveLength(2);
    expect(step1.data.quests.done_count).toBe(2);

    const step2 = parseMessageText(
      `<任务>
- 名称: 猎取高纯微晶样本
  状态: 已完成
  进度: 3/3 · 样本已封装入库
  奖励:
    资金: 2200
    机密点: 20
</任务>`,
      step1.data,
      {},
    );

    expect(step2.data.quests.active).toHaveLength(1);
    expect(step2.data.quests.active[0].name).toBe('修复北坡雷达站');
    expect(step2.data.quests.done_count).toBe(3);
    expect(step2.data.economy.credits).toBe(2200);
    expect(step2.data.command.intel_points).toBe(20);
    expect(step2.data.quests.history?.[0]).toMatchObject({
      name: '猎取高纯微晶样本',
      status: '已完成',
      detail: '渗透敌方精炼厂获取样本',
      reward_claimed: true,
    });
  });

  it('11. FD-30 Tier S：主线任务解锁跨阵营与 MCV 入列 vs 支线任务越权送 MCV 拦截转情报线索', () => {
    // 1) 支线任务越权送苏联阵营/MCV -> 拦截转情报线索
    const sideRes = parseMessageText(
      `<任务>
- 名称: 搜寻荒原迷途车队
  类别: 支线
  状态: 已完成
  奖励:
    解锁阵营: [苏联]
    缴获载具: [机动建设车（苏联）]
</任务>`,
      zero(),
      {},
    );
    expect(sideRes.data.command.unlocked_factions ?? ['allied']).not.toContain('soviet');
    expect(sideRes.data.forces.vehicles).not.toContain('机动建设车（苏联）');
    expect(sideRes.data.intel.some(i => i.content.includes('高阶战略阵营/MCV 线索'))).toBe(true);
    expect(sideRes.events.some(e => e.light === '🟡' && e.message.includes('仅限主线/战略指令任务交割'))).toBe(true);

    // 2) 主线任务达成解锁苏联阵营 + MCV 入列
    const mainRes = parseMessageText(
      `<任务>
- 名称: 凛冬回响·重型空投舱抢修行动
  类别: 主线
  状态: 已完成
  奖励:
    解锁阵营: [苏联]
</任务>`,
      zero(),
      {},
    );
    expect(mainRes.data.command.unlocked_factions).toContain('soviet');
    expect(mainRes.data.forces.vehicles).toContain('MCV（苏联）');
    expect(mainRes.events.some(e => e.light === '🟢' && e.message.includes('已启封【苏联】阵营权限'))).toBe(true);
  });

  it('12. FD-30 Tier A：解锁蓝图自动写入 data.codex 并绑定主基地【兵营 / 战车工厂】前置', () => {
    const res = parseMessageText(
      `<任务>
- 名称: 荒坂改装车库技术接收
  类别: 支线
  状态: 已完成
  奖励:
    解锁蓝图:
      - 名称: 荒坂改装重型巡逻车
        类别: 载具
        生产建筑: 战车工厂
        造价: 750
        简介: 加装复合装甲与重机枪的战地改装巡逻车
      - 名称: 极地防寒突击兵
        类别: 人员
        生产建筑: 兵营
        造价: 280
</任务>`,
      zero(),
      {},
    );

    const vehicleBlueprint = res.data.codex.find(c => c.name === '荒坂改装重型巡逻车');
    const infantryBlueprint = res.data.codex.find(c => c.name === '极地防寒突击兵');
    expect(vehicleBlueprint).toMatchObject({
      name: '荒坂改装重型巡逻车',
      kind: '载具',
      params: {
        前置: '战车工厂',
        造价: '750',
      },
    });
    expect(infantryBlueprint).toMatchObject({
      name: '极地防寒突击兵',
      kind: '人员',
      params: {
        前置: '兵营',
        造价: '280',
      },
    });
  });

  it('13. FD-30 Tier B：常规步兵(<=5)与 T1/T2 载具(<=2)限额整备，且 T3 终极载具自动拦截转为战车工厂蓝图', () => {
    const res = parseMessageText(
      `<任务>
- 名称: 战地前哨救援与车库整备
  类别: 支线
  状态: 已完成
  奖励:
    收编兵力:
      战斗工程师: 2
      动员兵: 9
    缴获载具: [多功能步兵车, 灰熊坦克, 犀牛坦克, 天启坦克]
</任务>`,
      zero(),
      {},
    );

    // 步兵：战斗工程师 +2，动员兵超上限 9 -> 钳制为 5
    expect(res.data.forces.troops['战斗工程师']).toBe(2);
    expect(res.data.forces.troops['动员兵']).toBe(5);

    // 载具：T1/T2 最多入列前 2 辆（多功能步兵车、灰熊坦克），第 3 辆犀牛坦克截断；天启坦克属于 T3 自动转蓝图！
    expect(res.data.forces.vehicles).toEqual(['多功能步兵车', '灰熊坦克']);
    const apocalypseBlueprint = res.data.codex.find(c => c.name === '天启坦克');
    expect(apocalypseBlueprint).toMatchObject({
      name: '天启坦克',
      kind: '载具',
      params: {
        前置: '战车工厂',
        造价: '1800',
      },
    });
  });

  it('14. FD-30 五大跨系统联动奖励：资金链、战略协议线索、势力态度、外币钱袋、机娘好感特质与在研科技助力', () => {
    const base = zero();
    base.forces.girls.push({
      name: '白凌',
      duty: '基地副官',
      hp: '完好',
      base: '前沿第一基地',
      affection: 60,
      obedience: 80,
      traits: ['冷静理性'],
    });
    base.queues.push({
      item: '基础步兵训练学',
      type: '研究',
      base: '前沿第一基地',
      progress: 20,
      eta: '2h',
      qty: 1,
      total_minutes: 100,
      spent_minutes: 20,
    });

    const res = parseMessageText(
      `<任务>
- 名称: 铁道同盟联合勘探协议
  类别: 指令
  状态: 已完成
  奖励:
    资金链:
      - 名称: 废弃支线废钢外运
        日收益: 300
        总额度: 9000
    协议线索: [冰冻协议]
    势力:
      - 名称: 铁道幸存者同盟
        态度: 友善
    钱袋:
      欧元: 1500
    机娘奖励:
      - 名称: 白凌
        好感变化: +5
        特质: [铁道调度专家]
    科研助力:
      项目: 基础步兵训练学
      进度变化: 30
</任务>`,
      base,
      {},
    );

    // 1) 资金链
    expect(res.data.economy.chains).toHaveLength(1);
    expect(res.data.economy.chains[0]).toMatchObject({
      name: '废弃支线废钢外运',
      flow: '收入',
      rate_daily: 300,
      status: 'active',
    });

    // 2) 战略协议线索
    const proto = res.data.protocols.find(p => p.name === '冰冻协议');
    expect(proto?.status).toBe('revealed');

    // 3) 势力态度
    const fac = res.data.factions.find(f => f.name === '铁道幸存者同盟');
    expect(fac?.attitude).toBe('友善');

    // 4) 外币钱袋
    expect(res.data.economy.wallet['欧元']).toBe(1500);

    // 5) 机娘好感与特质
    const bailing = res.data.forces.girls.find(g => g.name === '白凌');
    expect(bailing?.affection).toBe(65);
    expect(bailing?.traits).toEqual(['冷静理性', '铁道调度专家']);

    // 6) 在研科技助力
    const qTech = res.data.queues.find(q => q.item === '基础步兵训练学');
    expect(qTech?.progress).toBe(50);
    expect(qTech?.spent_minutes).toBe(50);
  });

  it('15. FD-48 PKG-A：多环系列任务链（series / chain_step / next_quest）解析、跨楼层完结继承与第 2 环共存', () => {
    // ① 第 1 环发布：声明 系列、环数: 1/3、后续任务
    const floor1 = parseMessageText(
      `<任务>
- 名称: 铁幕回响·冻土信标溯源
  类别: 主线
  状态: 进行中
  发包方: 盟军战区联席参谋部 / 白凌
  系列: 铁幕回响
  环数: 1/3
  后续任务: 铁幕回响·破拆外围防线与高压并网
  进度: 1/2 · 侦察分队已锁定冻土信标发射源
  要点: 潜入旧工业区地下掩体提取加密信标核心
  奖励:
    资金: 1500
    机密点: 25
</任务>`,
      zero(),
      {},
    );

    expect(floor1.quarantine).toEqual([]);
    expect(floor1.data.quests.active).toHaveLength(1);
    expect(floor1.data.quests.active[0]).toMatchObject({
      name: '铁幕回响·冻土信标溯源',
      category: '主线',
      status: '进行中',
      issuer: '盟军战区联席参谋部 / 白凌',
      series: '铁幕回响',
      chain_step: '1/3',
      next_quest: '铁幕回响·破拆外围防线与高压并网',
      progress: '1/2 · 侦察分队已锁定冻土信标发射源',
    });

    // 推进阶段未重复写 系列 / 环数 / 后续任务 时，active 原地保留
    const floor1b = parseMessageText(
      `<任务>
- 名称: 铁幕回响·冻土信标溯源
  状态: 进行中
  进度: 2/2 · 已取得加密信标核心，正在撤离
</任务>`,
      floor1.data,
      {},
    );
    expect(floor1b.data.quests.active[0]).toMatchObject({
      name: '铁幕回响·冻土信标溯源',
      series: '铁幕回响',
      chain_step: '1/3',
      next_quest: '铁幕回响·破拆外围防线与高压并网',
      progress: '2/2 · 已取得加密信标核心, 正在撤离',
    });

    // ② 后续楼层该任务仅输出 名称 + 状态: 已完成（未重复写 系列 / 环数 / 后续任务），归档条目自动继承
    const floor2 = parseMessageText(
      `<任务>
- 名称: 铁幕回响·冻土信标溯源
  状态: 已完成
</任务>`,
      floor1b.data,
      {},
    );

    expect(floor2.data.quests.active).toHaveLength(0);
    expect(floor2.data.quests.done_count).toBe(1);
    expect(floor2.data.quests.history).toHaveLength(1);
    expect(floor2.data.quests.history?.[0]).toMatchObject({
      name: '铁幕回响·冻土信标溯源',
      category: '主线',
      status: '已完成',
      series: '铁幕回响',
      chain_step: '1/3',
      next_quest: '铁幕回响·破拆外围防线与高压并网',
      reward_claimed: true,
    });

    // ③ 同系列第 2 环（环数: 2/3）新任务发布（测试别名 任务链 / 阶段环 / 下一环），与 history 中第 1 环共存
    const floor3 = parseMessageText(
      `<任务>
- 名称: 铁幕回响·破拆外围防线与高压并网
  类别: 主线
  状态: 发布
  发包方: 白凌
  任务链: 铁幕回响
  阶段环: 2/3
  下一环: 铁幕回响·深掩体火种苏醒
  进度: 0/3 · 工兵爆破组集结待命
  要点: 清除掩体外围自动机枪碉堡并恢复主变电站供电
  奖励:
    资金: 2500
    资源:
      建材:
        高强工程钢材: 400
</任务>`,
      floor2.data,
      {},
    );

    expect(floor3.data.quests.active).toHaveLength(1);
    expect(floor3.data.quests.active[0]).toMatchObject({
      name: '铁幕回响·破拆外围防线与高压并网',
      category: '主线',
      status: '进行中',
      series: '铁幕回响',
      chain_step: '2/3',
      next_quest: '铁幕回响·深掩体火种苏醒',
    });
    expect(floor3.data.quests.history).toHaveLength(1);
    expect(floor3.data.quests.history?.[0]).toMatchObject({
      name: '铁幕回响·冻土信标溯源',
      status: '已完成',
      series: '铁幕回响',
      chain_step: '1/3',
    });
  });
});

