import { describe, expect, it } from 'vitest';
import { Schema } from '../core/schema';
import {
  analyzeTacticalCombos,
  analyzeUserTurnIntent,
  DEFAULT_FEEDFORWARD_PREFERENCES,
  deriveCompletionMilestones,
  deriveStrategicFeedforward,
  detectPendingChainContinuations,
  detectPendingIntelChains,
  detectUserIntelIntent,
  detectUserQuestIntent,
  FEEDFORWARD_PREFS_STORAGE_KEY,
  formatActiveSeatsSection,
  formatQuestRewardCompact,
  formatStrategicFeedforwardPrompt,
  getFeedforwardPreferences,
  hasActiveEngineeringOrSpaceAssets,
  isEngineeringAndSpaceFeedforwardOpen,
  parseIntelChainStep,
  parseQuestChainStep,
  planStrategicFeedforward,
  PRESET_INTEL_CHAIN_TEMPLATES,
  PRESET_QUEST_ARCHETYPES,
  PRESET_QUEST_CHAIN_TEMPLATES,
  readBootChoicesHintFromVars,
  recommendPresetQuestArchetypes,
  resolveCampaignPhase,
  resolveDynamicQuestIssuer,
  resolveStaffAdvisors,
  setFeedforwardPreferences,
  STRATEGIC_FEEDFORWARD_INJECT_ID,
  type ChainAwareIntelItem,
  type ChainAwareQuest,
  type MultiTrackChainLike,
} from '../planning/strategicFeedforward';
import { mergeEffectiveCatalog } from '../core/catalogEffective';

const zero = () => Schema.parse({});

describe('FD-31 PKG-A · 战区全局七大板块态势前馈、八维组合诊断与 MCV 机娘参谋席路由', () => {
  it('1. MCV 机娘参谋席动态路由：单阵营默认白凌独奏 vs 多阵营解锁后白凌+凛冬妮娅+薇拉联席', () => {
    const stateSolo = zero();
    stateSolo.forces.girls.push({
      name: '白凌',
      duty: '基地首席副官',
      hp: '完好',
      base: '前沿第一基地',
      affection: 65,
      obedience: 80,
      traits: ['精准装配', '铁道调度专家'],
    });

    const soloRoster = resolveStaffAdvisors(stateSolo);
    expect(soloRoster.mode).toBe('solo');
    expect(soloRoster.advisors).toHaveLength(1);
    expect(soloRoster.advisors[0]).toMatchObject({
      name: '白凌',
      faction: 'allied',
      affection: 65,
    });

    // 解锁苏联与尤里并编入机娘 -> 自动切换为 ensemble 多席联席
    const stateEnsemble = zero();
    stateEnsemble.command.unlocked_factions = ['allied', 'soviet', 'yuri'];
    stateEnsemble.forces.girls.push(
      {
        name: '白凌',
        duty: '盟军首席副官',
        hp: '完好',
        base: '前沿第一基地',
        faction: '盟军',
        affection: 70,
        obedience: 80,
        traits: ['基建统筹'],
      },
      {
        name: '凛冬妮娅',
        duty: '重装装甲参谋',
        hp: '完好',
        base: '前沿第一基地',
        faction: '苏联',
        affection: 60,
        obedience: 75,
        traits: ['重炮协同'],
      },
      {
        name: '薇拉',
        duty: '心灵情报参谋',
        hp: '完好',
        base: '前沿第一基地',
        faction: '尤里',
        affection: 55,
        obedience: 70,
        traits: ['电子渗透'],
      },
    );

    const ensembleRoster = resolveStaffAdvisors(stateEnsemble);
    expect(ensembleRoster.mode).toBe('ensemble');
    expect(ensembleRoster.advisors.map(a => a.name)).toEqual(['白凌', '凛冬妮娅', '薇拉']);
  });

  it('2. 八维组合战术诊断：准确识别缺母体建筑、新解锁蓝图已就绪/缺母体、在途主线任务与高暴露度', () => {
    const state = zero();
    state.economy.credits = 1700;
    state.exposure.value = 6.8;
    state.bases.push({
      id: '前沿第一基地',
      name: '前沿第一基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军兵营', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    // 解锁了两个 Tier A 蓝图：一个兵营已就绪（极地防寒突击兵），一个缺战车工厂（荒坂改装重型巡逻车）
    state.codex.push(
      {
        name: '极地防寒突击兵',
        kind: '人员',
        desc: '防寒特种步兵',
        params: { 前置: '兵营', 造价: '280', 来源: '任务交割·荒坂车库' },
      },
      {
        name: '荒坂改装重型巡逻车',
        kind: '载具',
        desc: '改装装甲车',
        params: { 前置: '战车工厂', 造价: '750', 来源: '任务交割·荒坂车库' },
      },
    );
    state.quests.active.push({
      name: '北坡中继站破袭战',
      category: '主线',
      status: '进行中',
      issuer: '联席参谋部',
      progress: '1/3 · 已锁定外围坐标',
      note: '摧毁荒坂通信中继塔',
      detail: '',
    });

    const catalog = mergeEffectiveCatalog([], null, state.protocols);
    const findings = analyzeTacticalCombos(state, catalog, { maxFindings: 8 });

    // 应命中：高暴露度 P0、在途主线任务 P0、主基地缺矿场/战车工厂 P1、极地防寒突击兵可立即排产 P1、巡逻车缺战车工厂 P1
    expect(findings.some(f => f.focusTag === '隐蔽与防务' && f.priority === 'P0')).toBe(true);
    expect(findings.some(f => f.focusTag === '任务推进' && f.title.includes('北坡中继站破袭战'))).toBe(true);
    expect(findings.some(f => f.focusTag === '产线扩建' && f.title.includes('战车工厂'))).toBe(true);
    expect(
      findings.some(f => f.focusTag === '新兵种列装' && f.title.includes('极地防寒突击兵')),
    ).toBe(true);
    expect(
      findings.some(f => f.focusTag === '蓝图母体补齐' && f.title.includes('荒坂改装重型巡逻车')),
    ).toBe(true);
  });

  it('3. 全局七大板块前馈提示词组装与 planStrategicFeedforward 注入配置校验', () => {
    const state = zero();
    state.economy.credits = 1500;
    state.bases.push({
      id: '前沿第一基地',
      name: '前沿第一基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    state.forces.girls.push({
      name: '白凌',
      duty: '首席副官',
      hp: '完好',
      base: '前沿第一基地',
      affection: 60,
      obedience: 80,
      traits: ['精准装配'],
    });

    const plan = planStrategicFeedforward({
      generation: {
        type: 'normal',
        options: { automatic_trigger: false, depth: 0 },
        dryRun: false,
        hasStartedToken: true,
      },
      lastMessageId: 2,
      readFloor: id => (id === 2 ? { role: 'assistant', is_hidden: false, stat_data: state } : null),
      overlays: [],
    });

    expect(plan).not.toBeNull();
    expect(plan!.injection.id).toBe(STRATEGIC_FEEDFORWARD_INJECT_ID);
    expect(plan!.injection.position).toBe('in_chat');
    expect(plan!.injection.depth).toBe(0);
    expect(plan!.injection.role).toBe('system');

    const promptText = formatStrategicFeedforwardPrompt(plan!.feedforward);
    expect(promptText).toContain('[战区全局态势与参谋部八维组合诊断 · 只读前馈视图]');
    expect(promptText).toContain('【一、战区宏观态势】');
    expect(promptText).toContain('【二、经济与六柱资源】');
    expect(promptText).toContain('【三、基地群与排产上下文');
    expect(promptText).toContain('【四、部队编制与机娘阵容】');
    expect(promptText).toContain('【五、作战任务与外交势力】');
    expect(promptText).toContain('【六、前端八维组合战术诊断');
    expect(promptText).toContain('【七、本轮 <态势>「参谋建议」输出指引');
    expect(promptText).toContain('白凌');
  });

  it('4. 五阶战役状态机 resolveCampaignPhase：完整覆盖 0~4 阶与 systemLinkOverride 优先级', () => {
    const emptyState = zero();

    // 阶段0：原世界序章（pre_transmigration / post_transmigration_bind）
    const p0 = resolveCampaignPhase(emptyState, { entryMode: 'pre_transmigration' });
    expect(p0).toEqual({
      phase: 'prologue_unbound',
      phaseLabel: '阶段0 · 原世界序章（系统尚未绑定）',
      effectiveSystemLinkMode: 'post_transmigration_bind',
      systemBound: false,
      maidensCanProactivelySpeak: false,
    });

    // 阶段1：被动静默待机（传入了 $boot 且默认 commander_initiate）
    const p1 = resolveCampaignPhase(emptyState, { entryMode: 'direct_transmigration' });
    expect(p1).toEqual({
      phase: 'silent_standby',
      phaseLabel: '阶段1 · 被动静默待机（待指挥官亲自联系）',
      effectiveSystemLinkMode: 'commander_initiate',
      systemBound: true,
      maidensCanProactivelySpeak: false,
    });

    // 阶段2：初抵掩体与半迷雾踏勘期（systemLinkOverride 强制覆盖为 immediate_active）
    const p2 = resolveCampaignPhase(
      emptyState,
      { entryMode: 'pre_transmigration' },
      { systemLinkOverride: 'immediate_active' },
    );
    expect(p2).toEqual({
      phase: 'field_recon',
      phaseLabel: '阶段2 · 初抵掩体与半迷雾踏勘期',
      effectiveSystemLinkMode: 'immediate_active',
      systemBound: true,
      maidensCanProactivelySpeak: true,
    });

    // 阶段3：首基初建与T1工业爬坡期（1座基地且运转建筑 < 4）
    const climbState = zero();
    climbState.bases.push({
      id: 'base-1',
      name: '一号掩体基地',
      location: '山谷',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    const p3 = resolveCampaignPhase(climbState);
    expect(p3.phase).toBe('early_industrial_climb');
    expect(p3.phaseLabel).toBe('阶段3 · 首基初建与T1工业爬坡期');
    expect(p3.maidensCanProactivelySpeak).toBe(true);

    // 阶段4：多产线协同与战区博弈期（运转建筑 >= 4）
    climbState.bases[0].buildings.push(
      { name: '矿石精炼厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      { name: '盟军兵营', layer: '地面', state: '运转', progress: 100, eta: '' },
    );
    const p4 = resolveCampaignPhase(climbState);
    expect(p4.phase).toBe('mid_late_theater');
    expect(p4.phaseLabel).toBe('阶段4 · 多产线协同与战区博弈期');
  });

  it('5. 参谋席通联门禁与默认首席姓名：未绑定/静默期严禁机娘列席，仅列席人类同伴或现场直觉；已解锁三阵营默认白凌+喀秋莎+尤里卡', () => {
    const state = zero();
    state.command.unlocked_factions = ['allied', 'soviet', 'yuri'];
    state.bases.push({
      id: 'base-1',
      name: '主基地',
      location: '谷地',
      status: '运转中',
      power: { gen: 100, use: 20 },
      alerts: [],
      buildings: [{ name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' }],
    });

    // 无 forces.girls 条目时，三阵营默认名字应为 白凌、喀秋莎、尤里卡，且包含各自的 voiceTag 口吻锚点
    const defaultTriRoster = resolveStaffAdvisors(state);
    expect(defaultTriRoster.advisors.map(a => a.name)).toEqual(['白凌', '喀秋莎', '尤里卡']);
    expect(defaultTriRoster.advisors[0].voiceTag).toContain('冰瓷精密长姊');
    expect(defaultTriRoster.advisors[1].voiceTag).toContain('烈火重工大姐头');
    expect(defaultTriRoster.advisors[2].voiceTag).toContain('慵懒毒舌生化御医');

    const activeSeatLines = formatActiveSeatsSection(defaultTriRoster, 'early_industrial_climb').join('\n');
    expect(activeSeatLines).toContain('口吻锚点：冰瓷精密长姊');
    expect(activeSeatLines).toContain('口吻锚点：烈火重工大姐头');
    expect(activeSeatLines).toContain('口吻锚点：慵懒毒舌生化御医');

    // 原世界未穿越序章（prologue_unbound）：即使 forces.girls 中预置了白凌，也严禁列席，改由随行人类列席
    const preState = zero();
    preState.forces.girls.push({
      name: '白凌',
      duty: '首席副官',
      hp: '完好',
      base: '',
      affection: 50,
      obedience: 80,
      traits: [],
    });
    const humanRosterBoot = {
      entryMode: 'pre_transmigration',
      humanRoster: [
        { name: '萧栖雪', title: '战术保镖', assignment: '近卫警戒', personality: '冷峻果决' },
        { name: '杜月欣', title: '后勤主管', assignment: '物资筹备', personality: '精明干练' },
      ],
    };
    const prologueAdvisors = resolveStaffAdvisors(preState, { bootChoices: humanRosterBoot });
    expect(prologueAdvisors.mode).toBe('ensemble');
    expect(prologueAdvisors.advisors.map(a => a.name)).toEqual(['萧栖雪', '杜月欣']);
    expect(prologueAdvisors.advisors.some(a => /白凌|喀秋莎|尤里卡/.test(a.name))).toBe(false);

    // 被动静默待机且无随行人类时，回退为「现场直觉」
    const loneStandby = resolveStaffAdvisors(zero(), {
      bootChoices: { entryMode: 'direct_transmigration', systemLinkMode: 'commander_initiate' },
    });
    expect(loneStandby.mode).toBe('solo');
    expect(loneStandby.advisors).toEqual([
      {
        name: '现场直觉',
        faction: 'other',
        roleTitle: '指挥官自身现场判断',
        specialty: '环境观察 · 现场决策',
        affection: 100,
        personaHint: '沉着审慎',
      },
    ]);
  });

  it('6. 慢热八维诊断、15日跨系磨合、story_first 免打扰过滤与原世界序章铁律提示词', () => {
    const state = zero();
    state.forces.vehicles.push('盟军机动建设车');
    const catalog = mergeEffectiveCatalog([], null, state.protocols);

    // (a) 原世界序章：仅生成 1 条 [P0·原世界序章] 节奏锁诊断
    const prologueFindings = analyzeTacticalCombos(state, catalog, {
      bootChoices: { entryMode: 'pre_transmigration' },
    });
    expect(prologueFindings).toHaveLength(1);
    expect(prologueFindings[0].priority).toBe('P0');
    expect(prologueFindings[0].focusTag).toBe('原世界序章');
    expect(prologueFindings[0].title).toBe('停留在原世界穿越前夕现场（系统尚未绑定）');

    // (b) 慢热踏勘导向（silent_standby / field_recon + slow_sim）
    const slowReconFindings = analyzeTacticalCombos(state, catalog, {
      bootChoices: { entryMode: 'direct_transmigration', systemLinkMode: 'commander_initiate' },
      preferences: { pacingMode: 'slow_sim' },
    });
    const mcvFinding = slowReconFindings.find(f => f.focusTag === '基地展开');
    expect(mcvFinding).toBeDefined();
    expect(mcvFinding!.recommendedAction).toContain('绝不强行催促立即展开');

    // (c) 15日多阵营工程磨合期（faction_penalties）+ story_first 过滤 P2
    const midState = zero();
    midState.economy.credits = 2000;
    midState.bases.push({
      id: 'base-1',
      name: '联合主基地',
      location: '盆地',
      status: '运转中',
      power: { gen: 200, use: 80 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '矿石精炼厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军兵营', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    (midState.command as unknown as { faction_penalties: unknown[] }).faction_penalties = [
      { name: '盟苏电网并网公差磨合', faction: 'soviet', remaining_minutes: 14400 },
    ];

    const balancedFindings = analyzeTacticalCombos(midState, catalog, {
      maxFindings: 8,
      preferences: { pacingMode: 'balanced' },
    });
    expect(balancedFindings.some(f => f.focusTag === '跨系磨合' && f.priority === 'P2')).toBe(true);

    const storyFirstFindings = analyzeTacticalCombos(midState, catalog, {
      maxFindings: 8,
      preferences: { pacingMode: 'story_first' },
    });
    expect(storyFirstFindings.some(f => f.category === 'idle_capacity')).toBe(false);
    expect(storyFirstFindings.some(f => f.priority === 'P2')).toBe(false);

    // (d) 格式化输出：验证 prologue_unbound 与 silent_standby 铁律提示词
    const prologueFeed = deriveStrategicFeedforward(
      { floorId: 1, schemaVersion: '2.0', data: state },
      [],
      null,
      {
        bootChoices: {
          entryMode: 'pre_transmigration',
          humanRoster: [{ name: '萧栖雪', title: '近卫统领' }],
        },
        latestUserMessage: '我们先在仓库清点物资，和萧栖雪商议明天的行程',
      },
    );
    expect(prologueFeed).not.toBeNull();
    const prologuePrompt = formatStrategicFeedforwardPrompt(prologueFeed!);
    expect(prologuePrompt).toContain('阶段0 · 原世界序章（系统尚未绑定）');
    expect(prologuePrompt).toContain('当前处于原世界穿越前夕·零系统未绑定阶段：主角脑海中无任何系统提示音');
    expect(prologuePrompt).toContain('【零系统参谋铁律】');
    expect(prologuePrompt).toContain('萧栖雪');

    const standbyFeed = deriveStrategicFeedforward(
      { floorId: 1, schemaVersion: '2.0', data: state },
      [],
      null,
      {
        bootChoices: {
          entryMode: 'direct_transmigration',
          systemLinkMode: 'commander_initiate',
        },
        latestUserMessage: '先派人去山谷北侧踏勘一下水源和岩土情况',
      },
    );
    const standbyPrompt = formatStrategicFeedforwardPrompt(standbyFeed!);
    expect(standbyPrompt).toContain('阶段1 · 被动静默待机（待指挥官亲自联系）');
    expect(standbyPrompt).toContain('【待指挥官亲自联系铁律】');
    expect(standbyPrompt).toContain('环境踏勘/侦察');
  });

  it('7. 偏好存取与 $boot 聊天变量解析纯函数契约校验', () => {
    const storeMap = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => storeMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storeMap.set(k, v);
      },
    };

    expect(getFeedforwardPreferences(mockStorage)).toEqual(DEFAULT_FEEDFORWARD_PREFERENCES);
    const updated = setFeedforwardPreferences(
      { pacingMode: 'story_first', systemLinkOverride: 'commander_initiate' },
      mockStorage,
    );
    expect(updated.pacingMode).toBe('story_first');
    expect(updated.systemLinkOverride).toBe('commander_initiate');
    expect(storeMap.has(FEEDFORWARD_PREFS_STORAGE_KEY)).toBe(true);
    expect(getFeedforwardPreferences(mockStorage).pacingMode).toBe('story_first');

    const bootHint = readBootChoicesHintFromVars({
      $boot: JSON.stringify({
        entryMode: 'pre_transmigration',
        systemLinkMode: 'post_transmigration_bind',
        humanRoster: [{ name: '苏晓', title: '秘书' }],
      }),
    });
    expect(bootHint).toEqual({
      entryMode: 'pre_transmigration',
      systemLinkMode: 'post_transmigration_bind',
      humanRoster: [
        {
          name: '苏晓',
          callsign: undefined,
          title: '秘书',
          assignment: undefined,
          personality: undefined,
          bio: undefined,
        },
      ],
    });

    expect(analyzeUserTurnIntent('命令工程队建造发电厂并排产步兵')).toContain('基建/排产/科研');
  });
});

describe('FD-45 · 全链路完工里程碑回执、双态防错、完工即解锁与机魂初诞联动', () => {
  it('1. #N-1 vs #N 双楼差值：准确捕捉建筑转正（含完工即解锁）、新单位下线（首台机魂初诞 vs 已有同型机娘不重复提示）、新科技完成与工程阶段完工待续', () => {
    const prevState = zero();
    prevState.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军战车工厂', layer: '地面', state: '建造中', progress: 80, eta: '余1日' },
      ],
    });
    prevState.forces.troops = { 美国大兵: 2 };
    prevState.forces.vehicles = ['多功能步兵车'];
    prevState.forces.girls.push({
      name: '艾莉丝',
      model: '多功能步兵车',
      duty: '机动火力手',
      hp: '完好',
      base: 'base-1',
      affection: 60,
      obedience: 75,
      traits: [],
    });
    prevState.tech.done = ['基础步兵训练学'];
    prevState.projects = [
      {
        id: 'proj:carrier_01',
        ref: '小鹰级航母电弹现代化改装',
        scope: 'base',
        bases: ['base-1'],
        lead_base: 'base-1',
        grade: '大改',
        status: '在建',
        outcome: { type: 'mark' },
        schema_version: 1,
        phases: [
          { idx: 0, name: '飞行甲板拆解与龙骨加固', status: '进行中', queue_index: 0 },
          { idx: 1, name: '电磁弹射轨道铺设', status: '未启动', queue_index: null },
        ],
      },
    ];

    const currState = zero();
    currState.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 80 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军战车工厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    // 多功能步兵车已有同型机娘艾莉丝；灰熊主战坦克为首次列装且尚无同型机娘
    currState.forces.troops = { 美国大兵: 2 };
    currState.forces.vehicles = ['多功能步兵车', '多功能步兵车', '灰熊主战坦克'];
    currState.forces.girls = [...prevState.forces.girls];
    currState.tech.done = ['基础步兵训练学', '装甲载具工学'];
    currState.projects = [
      {
        id: 'proj:carrier_01',
        ref: '小鹰级航母电弹现代化改装',
        scope: 'base',
        bases: ['base-1'],
        lead_base: 'base-1',
        grade: '大改',
        status: '在建',
        outcome: { type: 'mark' },
        schema_version: 1,
        phases: [
          { idx: 0, name: '飞行甲板拆解与龙骨加固', status: '完工', queue_index: null },
          { idx: 1, name: '电磁弹射轨道铺设', status: '未启动', queue_index: null },
        ],
      },
    ];

    const catalog = mergeEffectiveCatalog(
      [
        {
          id: 'dlc-test',
          researches: [
            {
              name: '装甲载具工学',
              cost: 500,
              eta: '2日',
              line: '装甲',
              tier: 1,
              unlocks: '灰熊主战坦克、多功能步兵车',
              prereq: '',
              prereqs: [],
              desc: '基础装甲理论',
            },
          ],
          productions: [
            {
              name: '灰熊主战坦克',
              cost: 700,
              need_building: '盟军战车工厂',
              need_buildings: ['盟军战车工厂'],
              prereqs: ['装甲载具工学'],
              desc: '盟军主战坦克',
            },
          ],
        },
      ],
      null,
      currState.protocols,
    );
    catalog.retrofits.push({
      kind: 'retrofit',
      name: '小鹰级航母电弹现代化改装',
      research: '装甲载具工学',
      grade: '大改',
      desc: '航母改装',
      phases: [
        { name: '飞行甲板拆解与龙骨加固', cost: 1200 },
        { name: '电磁弹射轨道铺设', cost: 1800 },
      ],
    });

    const summary = deriveCompletionMilestones(currState, catalog, prevState);
    expect(summary.settlingItems).toHaveLength(0);

    // 1) 建筑转正 + 完工即解锁
    const bldMilestone = summary.completedItems.find(m => m.domain === 'building');
    expect(bldMilestone).toBeDefined();
    expect(bldMilestone!.title).toContain('盟军战车工厂');
    expect(bldMilestone!.unlockedHighlights).toContain('灰熊主战坦克');

    // 2) 新单位下线：灰熊主战坦克（无同型机娘 -> girlBirthEligible: true）vs 多功能步兵车（已有艾莉丝 -> girlBirthEligible: false）
    const grizzlyMilestone = summary.completedItems.find(
      m => m.domain === 'unit' && m.title.includes('灰熊主战坦克'),
    );
    const ifvMilestone = summary.completedItems.find(
      m => m.domain === 'unit' && m.title.includes('多功能步兵车'),
    );
    expect(grizzlyMilestone).toBeDefined();
    expect(grizzlyMilestone!.girlBirthEligible).toBe(true);
    expect(ifvMilestone).toBeDefined();
    expect(ifvMilestone!.girlBirthEligible).toBe(false);

    // 3) 新科技完成
    const techMilestone = summary.completedItems.find(m => m.domain === 'tech');
    expect(techMilestone).toBeDefined();
    expect(techMilestone!.title).toContain('装甲载具工学');
    expect(techMilestone!.unlockedHighlights).toContain('灰熊主战坦克');

    // 4) 工程阶段完工待续（含下一阶段名称与经费）
    const projMilestone = summary.completedItems.find(m => m.domain === 'project');
    expect(projMilestone).toBeDefined();
    expect(projMilestone!.title).toContain('飞行甲板拆解与龙骨加固');
    expect(projMilestone!.detail).toContain('电磁弹射轨道铺设');
    expect(projMilestone!.detail).toContain('1800');
  });

  it('2. settling（待交割收讫）与 just_completed（已入账·勿重复报账）双态文案隔离与防 OVERRUN 铁律输出', () => {
    const prevState = zero();
    prevState.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军兵营', layer: '地面', state: '建造中', progress: 50, eta: '余1日' },
      ],
    });

    const currState = zero();
    currState.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 60 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军兵营', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    // 队列中同时存在一条待收讫生产项（战斗工程师，尚无机娘）与一条已由 FD-38 自动交付的建造项
    currState.queues.push(
      {
        type: '生产',
        item: '战斗工程师',
        base: 'base-1',
        progress: 100,
        eta: '待收讫',
        status: 'settling',
        started_at: '',
        total_minutes: 360,
        spent_minutes: 360,
        qty: 1,
        qty_done: 1,
        cost_paid: true,
        min_days_lock: 0,
        hold: false,
      },
      {
        type: '建造',
        item: '盟军兵营',
        base: 'base-1',
        progress: 100,
        eta: '已交付',
        status: 'settling',
        started_at: '',
        total_minutes: 720,
        spent_minutes: 720,
        qty: 1,
        qty_done: 1,
        building_delivered_qty: 1,
        cost_paid: true,
        min_days_lock: 0,
        hold: false,
      },
    );

    const plan = planStrategicFeedforward({
      generation: {
        type: 'normal',
        options: { automatic_trigger: false, depth: 0 },
        dryRun: false,
        hasStartedToken: true,
      },
      lastMessageId: 2,
      readFloor: id => {
        if (id === 2) return { role: 'assistant', is_hidden: false, stat_data: currState };
        if (id === 1) return { role: 'assistant', is_hidden: false, stat_data: prevState };
        return null;
      },
      overlays: [],
    });

    expect(plan).not.toBeNull();
    const prompt = plan!.injection.content;
    expect(prompt).toContain('【本轮最新竣工与待收讫里程碑（参谋部重点督办）】');
    expect(prompt).toContain('· ★ [待交割收讫·settling] 基地「北坡主基地」：生产「战斗工程师」×1');
    expect(prompt).toContain('✨[机魂初诞契机] 该型号为战区首批次下线');
    expect(prompt).toContain('· 🎉 [本轮刚竣工入账·勿重复报账] 基地「北坡主基地」新落成建筑【盟军兵营】');
    expect(prompt).toContain('👉 现已解锁：');
    expect(prompt).toContain(
      '※ 防错铁律：标有「已入账·勿重复报账」的资产已由引擎并入账本，请直接在正文展现投产/列装后的现场实效与下游解锁，严禁为其重复输出 <生产> 收讫标签（以防触发 OVERRUN 越权警报）！',
    );
  });

  it('3. 八维组合诊断增强：准确识别 settling「竣工交割」与工程阶段断档「工程续建」', () => {
    const state = zero();
    state.economy.credits = 1500;
    state.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '矿石精炼厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军兵营', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军战车工厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    state.queues.push({
      type: '生产',
      item: '多功能步兵车',
      base: 'base-1',
      progress: 100,
      eta: '待收讫',
      status: 'settling',
      started_at: '',
      total_minutes: 360,
      spent_minutes: 360,
      qty: 2,
      qty_done: 2,
      cost_paid: true,
      min_days_lock: 0,
      hold: false,
    });
    state.projects = [
      {
        id: 'proj:dome_01',
        ref: '北坡深层防核掩体扩建工程',
        scope: 'base',
        bases: ['base-1'],
        lead_base: 'base-1',
        grade: '中改',
        status: '在建',
        outcome: { type: 'mark' },
        schema_version: 1,
        phases: [
          { idx: 0, name: '一期岩层掘进', status: '完工', queue_index: null },
          { idx: 1, name: '二期铅屏蔽衬砌', status: '未启动', queue_index: null },
        ],
      },
    ];

    const catalog = mergeEffectiveCatalog([], null, state.protocols);
    const findings = analyzeTacticalCombos(state, catalog, { maxFindings: 8 });

    const settleFinding = findings.find(f => f.focusTag === '竣工交割');
    expect(settleFinding).toBeDefined();
    expect(settleFinding!.category).toBe('idle_capacity');
    expect(settleFinding!.priority).toBe('P0');
    expect(settleFinding!.title).toContain('多功能步兵车×2');

    const projFinding = findings.find(f => f.focusTag === '工程续建');
    expect(projFinding).toBeDefined();
    expect(projFinding!.category).toBe('idle_capacity');
    expect(projFinding!.priority).toBe('P1');
    expect(projFinding!.title).toContain('一期岩层掘进');
    expect(projFinding!.title).toContain('二期铅屏蔽衬砌');
  });

  it('4. 空态零污染守卫：无完工且无在建工程时不输出里程碑区块与工程进度行', () => {
    const state = zero();
    state.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });

    const feed = deriveStrategicFeedforward(
      { floorId: 2, schemaVersion: '2.0', data: state },
      [],
      null,
      { prevData: state },
    );
    expect(feed).not.toBeNull();
    expect(feed!.completionMilestones.settlingItems).toHaveLength(0);
    expect(feed!.completionMilestones.completedItems).toHaveLength(0);

    const prompt = formatStrategicFeedforwardPrompt(feed!);
    expect(prompt).not.toContain('【本轮最新竣工与待收讫里程碑（参谋部重点督办）】');
    expect(prompt).not.toContain('防错铁律：标有「已入账·勿重复报账」');
    expect(prompt).not.toContain('· 重大工程进度：');
    expect(prompt).toContain('【工程与商业航天生产态门禁】');
  });

  it('5. 长期工程与商业航天生产态默认关闭门禁：无工程/航天资产且未开 DEV 时注入门禁，开启 DEV 或存在在建工程/航天资产或显式指令时放行', () => {
    const state = zero();
    state.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });

    // A. 生产态默认且无工程/航天资产：门禁关闭，提示词包含禁止主动催促 <工程> 与 <航天合同>
    expect(hasActiveEngineeringOrSpaceAssets(state)).toBe(false);
    expect(isEngineeringAndSpaceFeedforwardOpen(state, { debugEnabled: false })).toBe(false);
    const prodFeed = deriveStrategicFeedforward(
      { floorId: 2, schemaVersion: '2.0', data: state },
      [],
      null,
      { debugEnabled: false },
    );
    expect(prodFeed!.engineeringAndSpaceEnabled).toBe(false);
    expect(formatStrategicFeedforwardPrompt(prodFeed!)).toContain(
      '除非指挥官在本轮输入中明确下达【工程】或【航天】指令，否则本轮「参谋建议」与正文严禁主动催促立项 <工程> 或签署 <航天合同>！',
    );

    // B. 开启 DEV 调试模式（debugEnabled: true）：门禁放行
    expect(isEngineeringAndSpaceFeedforwardOpen(state, { debugEnabled: true })).toBe(true);
    const devFeed = deriveStrategicFeedforward(
      { floorId: 2, schemaVersion: '2.0', data: state },
      [],
      null,
      { debugEnabled: true },
    );
    expect(devFeed!.engineeringAndSpaceEnabled).toBe(true);
    expect(formatStrategicFeedforwardPrompt(devFeed!)).not.toContain('【工程与商业航天生产态门禁】');

    // C. 玩家显式下达【工程】或【航天】指令：门禁放行
    expect(
      isEngineeringAndSpaceFeedforwardOpen(state, {
        debugEnabled: false,
        latestUserMessage: '下达【航天】指令，准备签署商业航天发射合同',
      }),
    ).toBe(true);
  });
});

describe('FD-47 · 作战任务预设原型库、在途悬赏保真、任务完结里程碑与靶向分发', () => {
  it('1. 六大系列 17 个预设任务原型完整性与阶段/短板/情报 quest_hook 靶向匹配及动态发包方路由（白凌/凛冬妮娅/薇拉/NPC）', () => {
    expect(PRESET_QUEST_ARCHETYPES).toHaveLength(17);
    const seriesSet = new Set(PRESET_QUEST_ARCHETYPES.map(a => a.series));
    expect(seriesSet.size).toBe(6);

    // A) 初抵踏勘期（field_recon，bases.length === 0）：首选 Q-RECON-01，发包方默认联席参谋部 / 白凌
    const reconState = zero();
    reconState.forces.vehicles.push('盟军机动建设车');
    const reconRecs = recommendPresetQuestArchetypes(reconState, {
      campaignPhase: 'field_recon',
    });
    expect(reconRecs.length).toBeGreaterThanOrEqual(1);
    expect(reconRecs[0].archetype.id).toBe('Q-RECON-01');
    expect(reconRecs[0].recommendedIssuer).toBe('联席参谋部 / 白凌');

    // B) 情报 quest_hook 直通车 + 多阵营机娘与 NPC 动态发包方路由（白凌/凛冬妮娅/薇拉/NPC）
    const theaterState = zero();
    theaterState.command.unlocked_factions = ['allied', 'soviet', 'yuri'];
    theaterState.bases.push({
      id: 'base-1',
      name: '北坡联合要塞',
      location: '北坡',
      status: '运转中',
      power: { gen: 200, use: 80 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '矿石精炼厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军战车工厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    theaterState.forces.girls.push(
      {
        name: '白凌',
        duty: '盟军首席副官',
        hp: '完好',
        base: 'base-1',
        faction: '盟军',
        affection: 70,
        obedience: 80,
        traits: [],
      },
      {
        name: '凛冬妮娅',
        duty: '苏军重工参谋',
        hp: '完好',
        base: 'base-1',
        faction: '苏联',
        affection: 65,
        obedience: 75,
        traits: [],
      },
      {
        name: '薇拉',
        duty: '尤里心灵参谋',
        hp: '完好',
        base: 'base-1',
        faction: '尤里',
        affection: 60,
        obedience: 70,
        traits: [],
      },
    );
    theaterState.codex.push({
      name: '顾长歌',
      kind: '人物',
      desc: '地下铁道会联络官',
      params: { 所属势力: '铁道同盟', 信任度: '45' },
    });
    (theaterState.intel as Array<Record<string, unknown>>).push({
      id: 'intel-01',
      title: '东谷废弃变电所异频加密信号',
      scope: 'tactical',
      src: '电讯截获',
      src_kind: '电讯截获',
      content: '截获东谷深处周期性脉冲信号',
      date: '第3日',
      cred: '中',
      status: '待核实',
      quest_hook: '派遣小队潜入东谷变电所地下室查明发射源',
      read: false,
      pinned: true,
    });

    const roster = resolveStaffAdvisors(theaterState);
    const intelRecs = recommendPresetQuestArchetypes(theaterState, {
      campaignPhase: 'mid_late_theater',
      advisorRoster: roster,
      dailyNetCredits: 0,
    });
    expect(intelRecs[0].archetype.id).toBe('Q-INTEL-01');
    expect(intelRecs[0].recommendedIssuer).toBe('联席参谋部 / 薇拉');
    expect(intelRecs[0].triggerReason).toContain('东谷废弃变电所异频加密信号');

    // 验证苏联领域、盟军领域与 NPC 领域的动态发包方路由
    const sovArch = PRESET_QUEST_ARCHETYPES.find(a => a.id === 'Q-ARMS-02')!;
    const alliedArch = PRESET_QUEST_ARCHETYPES.find(a => a.id === 'Q-ECON-01')!;
    const npcArch = PRESET_QUEST_ARCHETYPES.find(a => a.id === 'Q-NPC-01')!;
    expect(resolveDynamicQuestIssuer(sovArch, theaterState, roster)).toBe('联席参谋部 / 凛冬妮娅');
    expect(resolveDynamicQuestIssuer(alliedArch, theaterState, roster)).toBe('联席参谋部 / 白凌');
    expect(resolveDynamicQuestIssuer(npcArch, theaterState, roster)).toBe('铁道同盟 · 顾长歌');

    // 验证八维诊断维度 5 在存在待核实 quest_hook 且无在途任务时生成 P1 [任务派发]
    const catalog = mergeEffectiveCatalog([], null, theaterState.protocols);
    const findings = analyzeTacticalCombos(theaterState, catalog, { maxFindings: 8 });
    const dispatchFinding = findings.find(f => f.focusTag === '任务派发');
    expect(dispatchFinding).toBeDefined();
    expect(dispatchFinding!.priority).toBe('P1');
    expect(dispatchFinding!.title).toContain('Q-INTEL-01');
  });

  it('2. 三档节奏锁校验：prologue_unbound 与 silent_standby 零推荐、在途 >= 3 抑制推荐并输出节奏护栏、玩家主动求任务突破护栏', () => {
    const state = zero();
    state.bases.push({
      id: 'base-1',
      name: '北坡基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });

    // 节奏锁 1：阶段 0 与阶段 1 严禁推荐任何预设任务
    expect(
      recommendPresetQuestArchetypes(state, { campaignPhase: 'prologue_unbound' }),
    ).toHaveLength(0);
    expect(
      recommendPresetQuestArchetypes(state, { campaignPhase: 'silent_standby' }),
    ).toHaveLength(0);

    // 节奏锁 2：在途任务 >= 3 且玩家未主动求新任务时，返回空推荐并在板块五输出节奏护栏
    state.quests.active.push(
      { name: '任务一·北坡清剿', category: '主线', status: '进行中', progress: '1/2', note: '推进', detail: '' },
      { name: '任务二·货场接管', category: '支线', status: '进行中', progress: '0/2', note: '推进', detail: '' },
      { name: '任务三·残骸回收', category: '支线', status: '进行中', progress: '1/3', note: '推进', detail: '' },
    );
    expect(
      recommendPresetQuestArchetypes(state, {
        campaignPhase: 'early_industrial_climb',
        latestUserMessage: '继续休整基地',
      }),
    ).toHaveLength(0);

    const guardedFeed = deriveStrategicFeedforward(
      { floorId: 3, schemaVersion: '2.0', data: state },
      [],
      null,
      { latestUserMessage: '继续休整基地' },
    );
    const guardedPrompt = formatStrategicFeedforwardPrompt(guardedFeed!);
    expect(guardedPrompt).toContain(
      '· [任务节奏护栏] 当前已有 3 项在途任务，请优先围绕既有任务推进或完结交割，本轮暂缓盲目派发新支线。',
    );
    expect(guardedPrompt).not.toContain('参谋部候选派发任务提案');

    // 玩家主动求新任务时突破 >= 3 护栏，立即激活对应系列推荐并在板块五输出提案
    const breakthroughFeed = deriveStrategicFeedforward(
      { floorId: 3, schemaVersion: '2.0', data: state },
      [],
      null,
      { latestUserMessage: '白凌，现在周边还有什么新任务或者紧缺物资搜刮委托可以接取？' },
    );
    expect(breakthroughFeed!.userQuestIntent?.wantsNewQuest).toBe(true);
    expect(breakthroughFeed!.questRecommendations!.length).toBeGreaterThan(0);
    const breakthroughPrompt = formatStrategicFeedforwardPrompt(breakthroughFeed!);
    expect(breakthroughPrompt).toContain('· ★ [参谋部候选派发任务提案（可结合剧情地名在本轮按需输出 <任务> 发布）]：');
    expect(breakthroughPrompt).not.toContain('· [任务节奏护栏]');
  });

  it('3. 在途任务 发包方 + 承诺悬赏 保真输出与玩家【推进作战任务：…】点名督办高亮', () => {
    const state = zero();
    state.bases.push({
      id: 'base-1',
      name: '北坡基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    state.quests.active.push({
      name: '重工遗珍·荒坂改装车库破译',
      category: '支线',
      status: '进行中',
      issuer: '联席参谋部 / 白凌',
      progress: '2/3 · 已突破车库外围气闸',
      note: '提取完整改装蓝图并挂载至战车工厂',
      detail: '',
      rewards: {
        credits: 1500,
        intel_points: 20,
        resources: { 建材: { 钢材: 300 } },
        items: ['荒坂加密芯片'],
        text: '',
        unlock_units: [
          {
            name: '荒坂改装重型巡逻车',
            kind: '载具',
            producer: '战车工厂',
            cost: 700,
            desc: '重装巡逻车',
          },
        ],
        chains: [{ name: '旧车库备件外供线', rate_daily: 350, capacity: 10500 }],
      },
    });

    const compact = formatQuestRewardCompact(state.quests.active[0].rewards);
    expect(compact).toContain('资金+1500');
    expect(compact).toContain('机密点+20');
    expect(compact).toContain('解锁蓝图:[荒坂改装重型巡逻车(战车工厂·造价700)]');
    expect(compact).toContain('资源:[钢材+300]');
    expect(compact).toContain('资金链:[旧车库备件外供线(+350/日·总额10500)]');

    const userMsg = '【推进作战任务：重工遗珍·荒坂改装车库破译】带领工程师班组进入主控室导出蓝图';
    const intent = detectUserQuestIntent(userMsg, state.quests.active);
    expect(intent.targetedActiveQuestName).toBe('重工遗珍·荒坂改装车库破译');

    const feed = deriveStrategicFeedforward(
      { floorId: 4, schemaVersion: '2.0', data: state },
      [],
      null,
      { latestUserMessage: userMsg },
    );
    const prompt = formatStrategicFeedforwardPrompt(feed!);

    // 板块五：包含发包方、原有进度｜要点子串与承诺悬赏，以及点名督办高亮行
    expect(prompt).toContain(
      '[支线]重工遗珍·荒坂改装车库破译(发包方:联席参谋部 / 白凌｜进度:2/3 · 已突破车库外围气闸｜要点:提取完整改装蓝图并挂载至战车工厂｜承诺悬赏:',
    );
    expect(prompt).toContain(
      '· ★ [本轮玩家点名督办任务] 指挥官本轮明确推进「重工遗珍·荒坂改装车库破译」——请根据本轮正文战果更新其 <任务> 进度，若目标已全部达成请将状态设为「已完成」并完整兑现承诺悬赏',
    );

    // 板块六：被点名的支线任务自动升格为 P0 并附带点名督办与承诺悬赏说明
    const questFinding = feed!.comboFindings.find(f => f.focusTag === '任务推进');
    expect(questFinding).toBeDefined();
    expect(questFinding!.priority).toBe('P0');
    expect(questFinding!.diagnosis).toContain('指挥官本轮点名督办「重工遗珍·荒坂改装车库破译」');
    expect(questFinding!.diagnosis).toContain('承诺悬赏：');
  });

  it('4. #N-1 vs #N 双楼差值捕捉刚达成 <任务>（domain: "quest"）里程碑回执与 unlockedHighlights', () => {
    const prevState = zero();
    prevState.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    prevState.quests.active.push({
      name: '铁幕回响·苏联休眠重工掩体与MCV火种启封',
      category: '主线',
      status: '进行中',
      issuer: '联席参谋部 / 凛冬妮娅',
      progress: '2/2 · 气闸已开启',
      note: '唤醒苏联 MCV',
      detail: '',
    });

    const currState = zero();
    currState.bases = structuredClone(prevState.bases);
    currState.quests.done_count = 1;
    currState.quests.history = [
      {
        name: '铁幕回响·苏联休眠重工掩体与MCV火种启封',
        category: '主线',
        status: '已完成',
        issuer: '联席参谋部 / 凛冬妮娅',
        progress: '100% · 已完成交割',
        note: '成功启封苏联基地车',
        detail: '',
        rewards: {
          credits: 5000,
          intel_points: 50,
          resources: {},
          items: [],
          text: '',
          unlock_factions: ['苏联'],
          unlock_units: [
            {
              name: '苏联重装工兵班',
              kind: '人员',
              producer: '兵营',
              cost: 350,
              desc: '重装工程步兵',
            },
          ],
        },
        reward_claimed: true,
        updated_floor: 5,
      },
    ];

    const catalog = mergeEffectiveCatalog([], null, currState.protocols);
    const milestones = deriveCompletionMilestones(currState, catalog, prevState);
    const questMilestone = milestones.completedItems.find(m => m.domain === 'quest');
    expect(questMilestone).toBeDefined();
    expect(questMilestone).toMatchObject({
      state: 'just_completed',
      domain: 'quest',
      title: '作战任务「铁幕回响·苏联休眠重工掩体与MCV火种启封」达成完结',
      girlBirthEligible: false,
    });
    expect(questMilestone!.detail).toContain('悬赏已交割：资金+5000、机密点+50、解锁阵营:[苏联]');
    expect(questMilestone!.unlockedHighlights).toEqual(['苏联', '苏联重装工兵班']);

    const feed = deriveStrategicFeedforward(
      { floorId: 5, schemaVersion: '2.0', data: currState },
      [],
      null,
      { prevData: prevState },
    );
    const prompt = formatStrategicFeedforwardPrompt(feed!);
    expect(prompt).toContain(
      '· 🎉 [本轮刚竣工入账·勿重复报账] 作战任务「铁幕回响·苏联休眠重工掩体与MCV火种启封」达成完结',
    );
    expect(prompt).toContain('👉 现已解锁：苏联、苏联重装工兵班！');
  });

  it('6. 战区情报与世界暗流前馈强化（盲区①+②）：置顶/已证实高价值情报常驻展示 + 玩家点名核查线报/介入暗流督办星标与八维诊断 P0 联动', () => {
    const state = zero();
    state.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '空军指挥部', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    state.intel = [
      {
        id: 'intel-1',
        title: '荒坂装甲押运车队主干道时刻表',
        src: '渗透内线',
        src_kind: '渗透内线',
        content: '每周四凌晨经过北坡隧道口，护卫含两辆重型巡逻车。',
        cred: '高',
        status: '已证实',
        pinned: true,
        scope: 'tactical',
      },
      {
        id: 'intel-2',
        title: '西侧废弃雷达站可疑电讯频段',
        src: '电讯截获',
        src_kind: '电讯截获',
        content: '夜间周期性向北极圈方向发射短波加密信标。',
        cred: '中',
        status: '待核实',
        pinned: false,
        scope: 'tactical',
      },
      {
        id: 'wevo-1',
        title: '环太平洋军工托拉斯秘密停火谈判',
        src: '宏观广播',
        src_kind: '宏观广播',
        content: '三大财团代表在轨道空间站秘密接触。',
        cred: '高',
        status: '演进中',
        pinned: true,
        scope: 'world',
        evo_domain: '远方地缘',
        stage: '发酵',
        ttl_floors: 3,
        hook: '可趁防务交接空档渗透外围军需库',
      },
    ];

    // 场景 A：玩家点击 PDA「核查线报」按钮
    const intelCmd = '调遣侦察与情报部门核查【电讯截获】线报：「西侧废弃雷达站可疑电讯频段」，查明真伪与具体坐标。';
    const intentA = detectUserIntelIntent(intelCmd, state.intel);
    expect(intentA).toEqual({
      targetedIntelTitle: '西侧废弃雷达站可疑电讯频段',
      wantsIntelAction: true,
    });

    const feedA = deriveStrategicFeedforward(
      { floorId: 4, schemaVersion: '2.0', data: state },
      [],
      null,
      { latestUserMessage: intelCmd },
    );
    const promptA = formatStrategicFeedforwardPrompt(feedA!);

    // 盲区①：置顶且已证实的高价值情报不再隐身，常驻展示于【情报渠道与世界暗流】
    expect(promptA).toContain(
      '置顶/已证实关键情报(1)：📌[置顶·渗透内线·已证实]荒坂装甲押运车队主干道时刻表',
    );
    // 盲区②：玩家点名核查线报刷出 ★ [本轮玩家点名核查情报] 督办锚点，且八维组合诊断生成 P0 情报核查诊断
    expect(promptA).toContain(
      '· ★ [本轮玩家点名核查情报] 指挥官本轮明确下令核查【电讯截获】线报「西侧废弃雷达站可疑电讯频段」（当前状态：待核实·可信度中）',
    );
    expect(
      feedA!.comboFindings.some(
        f => f.priority === 'P0' && f.focusTag === '情报核查' && f.title.includes('西侧废弃雷达站可疑电讯频段'),
      ),
    ).toBe(true);

    // 场景 B：玩家点击世界演变面板「暗流侦察」按钮
    const evoCmd = '【暗流侦察】针对宏观暗流「环太平洋军工托拉斯秘密停火谈判」（远方地缘·发酵），立即派遣侦察力量核实其对我方战区的潜在波及！';
    const intentB = detectUserIntelIntent(evoCmd, state.intel);
    expect(intentB).toEqual({
      targetedWorldEvoTitle: '环太平洋军工托拉斯秘密停火谈判',
      wantsIntelAction: true,
    });

    const feedB = deriveStrategicFeedforward(
      { floorId: 4, schemaVersion: '2.0', data: state },
      [],
      null,
      { latestUserMessage: evoCmd },
    );
    const promptB = formatStrategicFeedforwardPrompt(feedB!);
    expect(promptB).toContain(
      '· ★ [本轮玩家点名介入世界暗流] 指挥官本轮明确针对宏观暗流「环太平洋军工托拉斯秘密停火谈判」（远方地缘·当前阶段：发酵）展开先遣侦察或切入干预',
    );
    expect(
      feedB!.comboFindings.some(
        f => f.priority === 'P0' && f.focusTag === '暗流介入' && f.title.includes('环太平洋军工托拉斯秘密停火谈判'),
      ),
    ).toBe(true);
  });

  it('7. FD-49 PKG-C · 板块四末尾输出【档案写入边界锁】在册机娘与人员/人物底账防重提示（仅非序章且非静默阶段生效）', () => {
    const state = zero();
    state.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    state.forces.girls.push(
      {
        name: '白凌',
        duty: '基地首席副官',
        hp: '完好',
        base: 'base-1',
        affection: 70,
        obedience: 80,
        traits: ['基建统筹'],
      },
      {
        name: '喀秋莎',
        duty: '重装装甲参谋',
        hp: '完好',
        base: 'base-1',
        affection: 60,
        obedience: 75,
        traits: ['重炮协同'],
      },
    );
    state.codex.push(
      { name: '萧栖雪', kind: '人员', desc: '近卫统领', params: {} },
      { name: '杜月欣', kind: '人员', desc: '后勤主管', params: {} },
      { name: '维克托·科尔萨科夫', kind: '人物', desc: '铁道防卫旅上校', params: {} },
    );

    const activeFeed = deriveStrategicFeedforward({ floorId: 4, schemaVersion: '2.0', data: state }, [], null);
    const activePrompt = formatStrategicFeedforwardPrompt(activeFeed!);
    expect(activePrompt).toContain(
      '· [档案写入边界锁] 已在册机娘（白凌、喀秋莎）日常状态/好感变动仅输出 <机娘>，严禁混入 <扩展档案>/<图鉴>；已在册人员/人物（萧栖雪、杜月欣、维克托·科尔萨科夫）仅在态度/信任度/驻地发生实质跃迁时输出 <扩展档案>(类别:人物) 增量更新；世界书既有标准科技/建筑/兵种严禁写入 <图鉴>/<扩展档案>（既有装备改造一律走 <数据更新>）。',
    );

    // 验证 prologue_unbound 阶段不输出该边界锁提示
    const prologueFeed = deriveStrategicFeedforward(
      { floorId: 1, schemaVersion: '2.0', data: zero() },
      [],
      null,
      {
        bootChoices: {
          entryMode: 'pre_transmigration',
          humanRoster: [{ name: '萧栖雪', title: '近卫统领' }],
        },
      },
    );
    expect(prologueFeed!.campaignPhase).toBe('prologue_unbound');
    expect(formatStrategicFeedforwardPrompt(prologueFeed!)).not.toContain('[档案写入边界锁]');

    // 验证 silent_standby 阶段不输出该边界锁提示
    const standbyFeed = deriveStrategicFeedforward(
      { floorId: 2, schemaVersion: '2.0', data: zero() },
      [],
      null,
      {
        bootChoices: {
          entryMode: 'direct_transmigration',
          systemLinkMode: 'commander_initiate',
          humanRoster: [{ name: '萧栖雪', title: '近卫统领' }],
        },
      },
    );
    expect(standbyFeed!.campaignPhase).toBe('silent_standby');
    expect(formatStrategicFeedforwardPrompt(standbyFeed!)).not.toContain('[档案写入边界锁]');
  });
});

describe('FD-48 · 多环系列任务链自动续杯与开放式启发（参考不绑死）校验', () => {
  it('1. parseQuestChainStep 与 PRESET_QUEST_CHAIN_TEMPLATES 5 条开放式系列模板结构校验', () => {
    expect(PRESET_QUEST_CHAIN_TEMPLATES).toHaveLength(5);
    expect(PRESET_QUEST_CHAIN_TEMPLATES.map(t => t.id)).toEqual([
      'CHAIN-SOV-MCV',
      'CHAIN-YURI-MCV',
      'CHAIN-ECON-ARTERIAL',
      'CHAIN-MAIDEN-TRIAL',
      'CHAIN-FACTION-PACT',
    ]);
    for (const tpl of PRESET_QUEST_CHAIN_TEMPLATES) {
      expect(tpl.stages).toHaveLength(tpl.totalSteps);
      expect(tpl.stages[0].step).toBe(`1/${tpl.totalSteps}`);
      expect(tpl.stages[tpl.stages.length - 1].step).toBe(`${tpl.totalSteps}/${tpl.totalSteps}`);
    }

    expect(parseQuestChainStep('1/3')).toEqual({ current: 1, total: 3, isFinal: false });
    expect(parseQuestChainStep('第2环/共3环')).toEqual({ current: 2, total: 3, isFinal: false });
    expect(parseQuestChainStep('3 / 3')).toEqual({ current: 3, total: 3, isFinal: true });
    expect(parseQuestChainStep('第 1 环 / 2')).toEqual({ current: 1, total: 2, isFinal: false });
    expect(parseQuestChainStep('')).toBeNull();
    expect(parseQuestChainStep('进行中')).toBeNull();
  });

  it('2. 当上一轮刚完成 系列: 铁幕回响、环数: 1/3、后续任务: 冻土掩体高压并网 时，deriveCompletionMilestones 与板块五自动输出 ★ [系列任务下一环续接契机] 且优先采用 LLM 自创的后续任务线索', () => {
    const prevState = zero();
    prevState.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    (prevState.quests.active as ChainAwareQuest[]).push({
      name: '极北冰原加密信标测绘',
      category: '主线',
      status: '进行中',
      issuer: '联席参谋部 / 凛冬妮娅',
      series: '铁幕回响',
      chain_step: '1/3',
      next_quest: '冻土掩体高压并网',
      progress: '2/2 · 已定位地下气闸',
      note: '破译苏军旧掩体坐标',
      detail: '',
    });

    const currState = zero();
    currState.bases = structuredClone(prevState.bases);
    currState.quests.done_count = 1;
    currState.quests.history = [
      {
        name: '极北冰原加密信标测绘',
        category: '主线',
        status: '已完成',
        issuer: '联席参谋部 / 凛冬妮娅',
        series: '铁幕回响',
        chain_step: '1/3',
        next_quest: '冻土掩体高压并网',
        progress: '100% · 已完成测绘',
        note: '锁定地下重工掩体主气闸',
        detail: '',
        rewards: {
          credits: 1200,
          intel_points: 25,
          resources: {},
          items: [],
          text: '',
          protocols: ['重工掩体防冻涂层协议'],
        },
        reward_claimed: true,
        updated_floor: 6,
      } as ChainAwareQuest,
    ];

    const continuations = detectPendingChainContinuations(currState, { prevData: prevState });
    expect(continuations).toHaveLength(1);
    expect(continuations[0]).toMatchObject({
      seriesName: '铁幕回响',
      completedQuestName: '极北冰原加密信标测绘',
      completedStepLabel: '1/3',
      nextStepLabel: '2/3',
      nextQuestHook: '冻土掩体高压并网',
      recommendedIssuer: '联席参谋部 / 凛冬妮娅',
      isJustCompletedThisTurn: true,
    });

    const catalog = mergeEffectiveCatalog([], null, currState.protocols);
    const milestones = deriveCompletionMilestones(currState, catalog, prevState);
    const questMilestone = milestones.completedItems.find(m => m.domain === 'quest');
    expect(questMilestone).toBeDefined();
    expect(questMilestone!.detail).toContain('系列：《铁幕回响》(1/3) -> 下一环线索：冻土掩体高压并网');

    const feed = deriveStrategicFeedforward(
      { floorId: 6, schemaVersion: '2.0', data: currState },
      [],
      null,
      { prevData: prevState },
    );
    expect(feed!.chainContinuations).toHaveLength(1);

    const prompt = formatStrategicFeedforwardPrompt(feed!);
    expect(prompt).toContain('★ [系列任务下一环续接契机]');
    expect(prompt).toContain('系列《铁幕回响》已完成第 1/3 环「极北冰原加密信标测绘」');
    expect(prompt).toContain('建议顺延前文线索（冻土掩体高压并网）并结合当前现场态势自主发挥开启第 2/3 环');
  });

  it('3. 在途系列任务徽章展示与前馈提示词「严禁机械照抄参考标题，请务必结合现场态势」开放式启发指引校验', () => {
    const state = zero();
    state.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    (state.quests.active as ChainAwareQuest[]).push({
      name: '冻土掩体高压并网',
      category: '主线',
      status: '进行中',
      issuer: '联席参谋部 / 凛冬妮娅',
      series: '铁幕回响',
      chain_step: '2/3',
      next_quest: '唤醒休眠的苏联基地车',
      progress: '1/2 · 正在架设高压电缆',
      note: '重启地下重工气闸供电',
      detail: '',
    });

    const feed = deriveStrategicFeedforward(
      { floorId: 7, schemaVersion: '2.0', data: state },
      [],
      null,
    );
    const prompt = formatStrategicFeedforwardPrompt(feed!);

    // 在途任务打印系列、环数与下一环线索
    expect(prompt).toContain(
      '[主线]冻土掩体高压并网(系列:铁幕回响·2/3｜发包方:联席参谋部 / 凛冬妮娅｜进度:1/2 · 正在架设高压电缆｜要点:重启地下重工气闸供电｜下一环线索:唤醒休眠的苏联基地车)',
    );

    // 候选派发任务提案行包含开放式启发说明（严禁机械照抄参考标题，请务必结合现场态势）
    expect(prompt).toContain('★ [参谋部候选派发任务提案');
    expect(prompt).toContain(
      '（仅作战术方向与奖励结构参考，严禁机械照抄参考标题，请务必结合现场态势、地貌与剧情自主发挥任务名称、系列归属与具体情节）',
    );
  });
});

describe('FD-50 · 战区情报多阶溯源链与前馈交叉印证续链及实锤转化里程碑校验', () => {
  it('1. parseIntelChainStep 多格式解析与 PRESET_INTEL_CHAIN_TEMPLATES 4 条开放式三阶情报链骨架校验', () => {
    expect(PRESET_INTEL_CHAIN_TEMPLATES).toHaveLength(4);
    expect(PRESET_INTEL_CHAIN_TEMPLATES.map(t => t.id)).toEqual([
      'ICHAIN-RELIC-BEACON',
      'ICHAIN-ENEMY-BUILDUP',
      'ICHAIN-UNDERGROUND-NET',
      'ICHAIN-RESOURCE-VEIN',
    ]);
    for (const tpl of PRESET_INTEL_CHAIN_TEMPLATES) {
      expect(tpl.totalSteps).toBe(3);
      expect(tpl.stages).toHaveLength(3);
      expect(tpl.stages[0]).toMatchObject({ step: '1/3', credTarget: '低' });
      expect(tpl.stages[1]).toMatchObject({ step: '2/3', credTarget: '中' });
      expect(tpl.stages[2]).toMatchObject({ step: '3/3', credTarget: '高' });
      expect(tpl.conversionHookHint.length).toBeGreaterThan(5);
    }

    expect(parseIntelChainStep('1/3')).toEqual({ current: 1, total: 3, isFinal: false });
    expect(parseIntelChainStep('第1阶/共3阶')).toEqual({ current: 1, total: 3, isFinal: false });
    expect(parseIntelChainStep('第2阶/3')).toEqual({ current: 2, total: 3, isFinal: false });
    expect(parseIntelChainStep('2 / 3')).toEqual({ current: 2, total: 3, isFinal: false });
    expect(parseIntelChainStep('第2环/共3环')).toEqual({ current: 2, total: 3, isFinal: false });
    expect(parseIntelChainStep('3/3')).toEqual({ current: 3, total: 3, isFinal: true });
    expect(parseIntelChainStep('')).toBeNull();
    expect(parseIntelChainStep('待核实')).toBeNull();
  });

  it('2. 在途情报链（step_continuation）跨渠道交叉印证续杯：优先顺延 LLM 自创 chain/next_lead 并推荐不同于当前渠道的已解锁渠道', () => {
    const state = zero();
    state.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 120, use: 60 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '空军指挥部', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    (state.intel as ChainAwareIntelItem[]).push({
      id: 'intel-chain-1',
      title: '北郊废弃冻土矿坑异常低频脉冲',
      scope: 'tactical',
      src: '电讯截获',
      src_kind: '电讯截获',
      content: '夜间截获来自北郊废弃矿坑深处的断续苏军旧制式加密脉冲。',
      date: '1972-10-03',
      cred: '低',
      status: '待核实',
      chain: '北郊冻土重工信标溯源',
      chain_step: '1/3',
      next_lead: '调动雷达遥感扫描北郊矿坑扇区并抵近侦察外围封锁哨',
      read: false,
      pinned: false,
    });

    const hints = detectPendingIntelChains(state, {
      availableChannels: ['前线目视', '宏观广播', '雷达侦察', '电讯截获'],
    });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      kind: 'step_continuation',
      chainName: '北郊冻土重工信标溯源',
      intelTitle: '北郊废弃冻土矿坑异常低频脉冲',
      currentStepLabel: '1/3',
      nextStepLabel: '2/3',
      currentChannel: '电讯截获',
      nextLeadHook: '调动雷达遥感扫描北郊矿坑扇区并抵近侦察外围封锁哨',
      isJustVerifiedThisTurn: false,
    });
    // 推荐渠道优先不同于当前的「电讯截获」
    expect(hints[0].recommendedNextChannels).not.toContain('电讯截获');
    expect(hints[0].recommendedNextChannels).toContain('雷达侦察');

    const feed = deriveStrategicFeedforward({ floorId: 5, schemaVersion: '2.0', data: state }, [], null);
    const prompt = formatStrategicFeedforwardPrompt(feed!);

    // 待印证线报附带 {链:...}(线索:...)
    expect(prompt).toContain(
      '[电讯截获·低]北郊废弃冻土矿坑异常低频脉冲{链:北郊冻土重工信标溯源·1/3}(线索:调动雷达遥感扫描北郊矿坑扇区并抵近侦察外)',
    );
    // 输出在途情报链交叉印证契机与防机械照抄提示
    expect(prompt).toContain(
      '· ★ [在途情报链交叉印证契机（请顺延前文线索与现场态势自主发挥下一阶内容，预设方向仅作参考，严禁机械照抄）]：情报链《北郊冻土重工信标溯源》当前处于第 1/3 阶「北郊废弃冻土矿坑异常低频脉冲」（原渠道：电讯截获）',
    );
    expect(prompt).toContain('建议通过异源渠道【雷达侦察/前线目视】交叉印证升阶至第 2/3 阶');
    // 已有在途情报链时不重复刷出空态开放式方向参考行
    expect(prompt).not.toContain('· [开放式多阶情报链方向参考');
  });

  it('3. 战区情报水落石出（domain: intel 双楼差值里程碑 + verified_conversion 战略转化契机 + Q-INTEL-01 next_lead 联动）', () => {
    const prevState = zero();
    prevState.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 120, use: 60 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    (prevState.intel as ChainAwareIntelItem[]).push({
      id: 'intel-chain-1',
      title: '北郊矿坑扇区防空哨与地下电缆井确认',
      scope: 'tactical',
      src: '雷达侦察',
      src_kind: '雷达侦察',
      content: '遥感测绘锁定地下 40 米处存在巨型重工掩体轮廓。',
      date: '1972-10-04',
      cred: '中',
      status: '演进中',
      evolves_from: '北郊废弃冻土矿坑异常低频脉冲',
      chain: '北郊冻土重工信标溯源',
      chain_step: '2/3',
      next_lead: '渗透内线破译三号气闸密码并启封休眠重工车库',
      read: false,
      pinned: true,
    });

    const currState = zero();
    currState.bases = structuredClone(prevState.bases);
    (currState.intel as ChainAwareIntelItem[]).push({
      id: 'intel-chain-1',
      title: '北郊三号重工地下掩体与休眠MCV坐标实锤',
      scope: 'tactical',
      src: '渗透内线',
      src_kind: '渗透内线',
      content: '确认掩体底层封存有旧苏联重工蓝图与待唤醒工程火种。',
      date: '1972-10-05',
      cred: '高',
      status: '已证实',
      evolves_from: '北郊矿坑扇区防空哨与地下电缆井确认',
      chain: '北郊冻土重工信标溯源',
      chain_step: '3/3',
      next_lead: '立项《铁幕回响》多环攻坚任务破拆三号气闸',
      read: false,
      pinned: true,
    });

    const catalog = mergeEffectiveCatalog([], null, currState.protocols);
    const milestones = deriveCompletionMilestones(currState, catalog, prevState);
    const intelMilestone = milestones.completedItems.find(m => m.domain === 'intel');
    expect(intelMilestone).toBeDefined();
    expect(intelMilestone!.title).toBe('战区情报「北郊三号重工地下掩体与休眠MCV坐标实锤」核实水落石出');
    expect(intelMilestone!.detail).toContain('渠道：渗透内线（高·已证实）');
    expect(intelMilestone!.detail).toContain('｜情报链：《北郊冻土重工信标溯源》(3/3)');
    expect(intelMilestone!.detail).toContain('｜战略转化线索：立项《铁幕回响》多环攻坚任务破拆三号气闸');

    const hints = detectPendingIntelChains(currState, { prevData: prevState });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      kind: 'verified_conversion',
      chainName: '北郊冻土重工信标溯源',
      intelTitle: '北郊三号重工地下掩体与休眠MCV坐标实锤',
      currentStepLabel: '3/3',
      isJustVerifiedThisTurn: true,
    });
    expect(hints[0].conversionTargetHint).toContain('可顺势派生关联 <任务>');
    expect(hints[0].conversionTargetHint).toContain('<扩展档案>');
    expect(hints[0].conversionTargetHint).toContain('<协议>');

    // Q-INTEL-01 也能兼容读取 next_lead 并推荐实锤转化任务
    const recs = recommendPresetQuestArchetypes(currState, {
      campaignPhase: 'early_industrial_climb',
    });
    expect(recs[0]?.archetype.id).toBe('Q-INTEL-01');
    expect(recs[0]?.triggerReason).toContain('北郊冻土重工信标溯源');
    expect(recs[0]?.triggerReason).toContain('立项《铁幕回响》多环攻坚任务破拆三号气闸');

    const feed = deriveStrategicFeedforward(
      { floorId: 7, schemaVersion: '2.0', data: currState },
      [],
      null,
      { prevData: prevState },
    );
    const prompt = formatStrategicFeedforwardPrompt(feed!);

    // 顶部里程碑包含实锤转化引导
    expect(prompt).toContain('战区情报「北郊三号重工地下掩体与休眠MCV坐标实锤」核实水落石出');
    expect(prompt).toContain(
      '👉 请在正文中展现情报核实成果，并可按需顺势派生关联 <任务>（含多环任务链）、新增/更新 <扩展档案>（人物/势力）或解锁战略 <协议> 线索！',
    );
    // 板块五置顶/已证实关键情报附带 {链:...}(线索:...)
    expect(prompt).toContain(
      '📌[置顶·渗透内线·已证实]北郊三号重工地下掩体与休眠MCV坐标实锤{链:北郊冻土重工信标溯源·3/3}(线索:立项《铁幕回响》多环攻坚任务破拆三号气闸)',
    );
    // 板块五输出 ★ [情报水落石出·战略转化契机]
    expect(prompt).toContain('· ★ [情报水落石出·战略转化契机]：情报链《北郊冻土重工信标溯源》');
    // 当前已无未证实的 step_continuation，因此同时给出开放式多阶情报链方向参考（严禁机械照抄参考标题）
    expect(prompt).toContain(
      '· [开放式多阶情报链方向参考（仅作「1/3捕风捉影[低]->2/3交叉印证[中]->3/3水落石出[高]」节奏与渠道搭配参考，严禁机械照抄参考标题，请结合当前现场态势、地貌与敌情自主发挥）]',
    );
  });

  it('4. detectUserIntelIntent 支持匹配【深挖情报链：…】与按 item.chain 识别玩家核查意图', () => {
    const state = zero();
    state.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 100, use: 40 },
      alerts: [],
      buildings: [{ name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' }],
    });
    (state.intel as ChainAwareIntelItem[]).push({
      id: 'intel-chain-2',
      title: '灰区走私商队携带军用高频中继器传闻',
      scope: 'tactical',
      src: '暗网流言',
      src_kind: '暗网流言',
      content: '黑市传闻有不明金主通过商队向防区外围偷运测向设备。',
      date: '1972-10-06',
      cred: '低',
      status: '待核实',
      chain: '灰区黑市暗桩反渗透甄别',
      chain_step: '1/3',
      next_lead: '监听商队高频频段并排查中间联络人',
      read: false,
      pinned: false,
    });

    // 显式【深挖情报链：...】指令
    const cmdExplicit = '【深挖情报链：灰区黑市暗桩反渗透甄别】立即调派电讯部门定向监听商队频段。';
    const intent1 = detectUserIntelIntent(cmdExplicit, state.intel);
    expect(intent1).toEqual({
      targetedIntelTitle: '灰区黑市暗桩反渗透甄别',
      wantsIntelAction: true,
    });

    // 自然语言提及情报链名（item.chain）
    const cmdByChain = '传令参谋部继续追查灰区黑市暗桩反渗透甄别案卷的下一阶线索。';
    const intent2 = detectUserIntelIntent(cmdByChain, state.intel);
    expect(intent2).toEqual({
      targetedIntelTitle: '灰区走私商队携带军用高频中继器传闻',
      wantsIntelAction: true,
    });

    const feed = deriveStrategicFeedforward(
      { floorId: 6, schemaVersion: '2.0', data: state },
      [],
      null,
      { latestUserMessage: cmdExplicit },
    );
    const prompt = formatStrategicFeedforwardPrompt(feed!);
    // 通过 chain 匹配到对应情报条目并输出其真实标题与状态
    expect(prompt).toContain(
      '· ★ [本轮玩家点名核查情报] 指挥官本轮明确下令核查【暗网流言】线报「灰区走私商队携带军用高频中继器传闻」（当前状态：待核实·可信度低）',
    );
  });
});

describe('FD-51 · 链网物理三要素成熟度诊断与三轨收支前馈汇总', () => {
  it('1. 链网物理三要素成熟度诊断：有矿石精炼厂但无采矿车提示「采矿车补齐」；配齐采矿车后提示「资金链开拓」建立采矿精炼链；存在非敌意势力提示本土外币/易货商路', () => {
    const state = zero();
    state.economy.credits = 600;
    state.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 150, use: 70 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '矿石精炼厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军兵营', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军战车工厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    state.factions.push({
      name: '铁道幸存者同盟',
      attitude: '友善',
      intel: '控制北郊货运支线',
      risk: '低',
    });

    const catalog = mergeEffectiveCatalog([], null, state.protocols);

    // 情形 A：主基地已有运转中的矿石精炼厂，但现役与队列均无采矿车
    const findingsMissingHarvester = analyzeTacticalCombos(state, catalog, { maxFindings: 8 });
    const harvesterFinding = findingsMissingHarvester.find(f => f.focusTag === '采矿车补齐');
    expect(harvesterFinding).toBeDefined();
    expect(harvesterFinding!.category).toBe('economy_and_resources');
    expect(harvesterFinding!.priority).toBe('P1');
    expect(harvesterFinding!.diagnosis).toContain('缺乏【采矿车/矿车】');
    expect(harvesterFinding!.recommendedAction).toContain('【战车工厂】排产');
    expect(harvesterFinding!.recommendedAction).toContain(
      '本土外币/易货商路链（产出本地外币 wallet 或采购原矿/建材/柴油/口粮实物，不可直接产出系统 Credits）',
    );

    // 情形 B：现役编入武装采矿车，精炼厂+采矿车物理前置齐备但尚未建采矿精炼链
    state.forces.vehicles.push('武装采矿车');
    const findingsReadyForMining = analyzeTacticalCombos(state, catalog, { maxFindings: 8 });
    const miningChainFinding = findingsReadyForMining.find(f => f.focusTag === '资金链开拓');
    expect(miningChainFinding).toBeDefined();
    expect(miningChainFinding!.category).toBe('economy_and_resources');
    expect(miningChainFinding!.priority).toBe('P1');
    expect(miningChainFinding!.recommendedAction).toContain(
      '主基地【矿石精炼厂】与现役【采矿车】物理前置已齐备，建议结合周边探明矿脉通过 <事件> 建立【采矿精炼链】（产出 Credits + 原矿）',
    );
    expect(miningChainFinding!.recommendedAction).toContain(
      '本土外币/易货商路链（产出本地外币 wallet 或采购原矿/建材/柴油/口粮实物，不可直接产出系统 Credits）',
    );
  });

  it('2. 板块二【经济与六柱资源】准确展示含 wallet_daily 与 resources_daily 的多轨链条摘要及三轨法则提醒（严禁商路直接印系统币 Credits）', () => {
    const state = zero();
    state.economy.credits = 2400;
    state.economy.wallet = { 欧元: 1800 };
    state.bases.push({
      id: 'base-1',
      name: '北坡主基地',
      location: '北坡',
      status: '运转中',
      power: { gen: 150, use: 60 },
      alerts: [],
      buildings: [
        { name: '盟军建造厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '盟军发电厂', layer: '地面', state: '运转', progress: 100, eta: '' },
        { name: '矿石精炼厂', layer: '地面', state: '运转', progress: 100, eta: '' },
      ],
    });
    state.forces.vehicles.push('武装采矿车');

    const chains = state.economy.chains as MultiTrackChainLike[];
    chains.push(
      {
        id: 'chain-mining-01',
        name: '北坡富铁矿脉采选精炼线',
        flow: '收入',
        rate_daily: 1200,
        chain_kind: '采矿精炼',
        resources_daily: { 矿产: { 铁矿石: 150 } },
        status: 'active',
        eff: 1,
        deps: {
          base_id: 'base-1',
          buildings: ['矿石精炼厂'],
          vehicles: ['武装采矿车'],
          world_resource: '北坡露天铁矿脉',
        },
        capacity: { total_yield: 36000, extracted: 1200 },
        reason: '',
        updated_at_day: 2,
      },
      {
        id: 'chain-trade-01',
        name: '铁道易货商路',
        flow: '收入',
        rate_daily: 0,
        chain_kind: '本土商路',
        wallet_daily: { 欧元: -200 },
        resources_daily: { 建材: { 高强工程钢材: 120 } },
        status: 'active',
        eff: 1,
        deps: {
          base_id: 'base-1',
          buildings: [],
          faction: '铁道幸存者同盟',
          world_resource: '',
        },
        capacity: { total_yield: null, extracted: 0 },
        reason: '',
        updated_at_day: 2,
      },
    );

    const feed = deriveStrategicFeedforward(
      { floorId: 5, schemaVersion: '2.0', data: state },
      [],
      null,
    );
    const prompt = formatStrategicFeedforwardPrompt(feed!);

    // 验证板块二多轨链条摘要（系统币 + 伴生原矿、外币消耗 + 实物钢材产出）
    expect(prompt).toContain('北坡富铁矿脉采选精炼线(+1200/日｜货物:铁矿石+150/日)');
    expect(prompt).toContain('铁道易货商路(外币:欧元-200/日｜货物:高强工程钢材+120/日)');

    // 验证板块二链网物理前置与三轨法则提醒行
    expect(prompt).toContain('· 链网物理前置与三轨法则提醒：');
    expect(prompt).toContain('矿业精炼链须同时具备【矿石精炼厂+采矿车+已探明矿区】方可产出系统资金 Credits');
    expect(prompt).toContain(
      '本土商路仅可收支【本地外币 wallet】或【六柱实物货物 resources】（严禁直接印系统币 Credits）',
    );
    expect(prompt).toContain('商路购入的原矿/废钢可经基地精炼厂/回收厂建立【工业转化链】熔炼为 Credits');
  });
});




