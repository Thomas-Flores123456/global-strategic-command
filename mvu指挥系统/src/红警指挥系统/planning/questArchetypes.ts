/**
 * questArchetypes.ts —— 作战任务六大预设原型库、动态发包方路由与在途奖励保真格式化纯函数引擎（FD-47 · PKG-A）
 *
 * 核心职责：
 * 1. 定义覆盖 `Gameplay Structure (01~10)` 与 `FD-30` 全域奖励池的 6 大系列、17 个参数化预设任务原型（`PRESET_QUEST_ARCHETYPES`）；
 * 2. `formatQuestRewardCompact`：将在途或刚完结 `<任务>` 的 `QuestReward` 格式化为紧凑保真摘要（防止跨楼层后 LLM 结案遗忘原定悬赏）；
 * 3. `detectUserQuestIntent`：识别玩家当轮输入中的「点名推进特定在途任务（如 PDA `【推进作战任务：…】`）」或「主动求任务/侦察/搜刮/外联」意图；
 * 4. `recommendPresetQuestArchetypes`：遵守三档节奏锁（阶段 0/1 禁发系统任务、在途 >= 3 抑制泛滥、`<情报>` 线索优先直通），结合五阶战役状态与实时短板动态挑选 Top 1~2 预设任务提案并绑定动态发包方（`issuer`）。
 *
 * 🔴 纯函数铁律：零 IO / 零 DOM / 零 Vue·Pinia / 零酒馆 API；不原地修改任何入参。
 */

import { canon } from '../parse/parseCommon';
import type { Quest, QuestReward, StatData } from '../core/schema';
import type {
  BootChoicesHint,
  CampaignPhase,
  StaffAdvisorRoster,
} from './strategicFeedforward';

/* ═══════════════ 1. 类型与契约定义 ═══════════════ */

export type QuestCategory = NonNullable<Quest['category']>;

export type PresetQuestSeriesId =
  | 'recon_foundation'
  | 'economy_supply'
  | 'arms_blueprint'
  | 'intel_stealth'
  | 'maiden_npc'
  | 'mcv_strategic';

export type PresetQuestIssuerDomain =
  | 'allied'
  | 'soviet'
  | 'yuri'
  | 'faction_or_npc'
  | 'companion_or_recon';

export interface PresetQuestArchetype {
  /** 原型唯一编号（如 Q-RECON-01） */
  id: string;
  /** 所属系列标识 */
  series: PresetQuestSeriesId;
  /** 系列中文名 */
  seriesLabel: string;
  /** 原型标准名称（供 LLM 结合当前地形/剧情微调具象化） */
  archetypeName: string;
  /** 推荐任务分类 */
  category: QuestCategory;
  /** 推荐发包方领域路由 */
  issuerDomain: PresetQuestIssuerDomain;
  /** 适用战役阶段集合 */
  allowedPhases: CampaignPhase[];
  /** 预设阶段目标骨架（2~3 步） */
  objectiveSkeleton: string[];
  /** 绑定 FD-30 全域奖励池的标准配方说明 */
  rewardFormula: string;
  /** 玩法域对齐标签 */
  gameplayDomainTag: string;
}

export interface PresetQuestRecommendation {
  archetype: PresetQuestArchetype;
  /** 动态决议出的推荐发包方署名（如「联席参谋部 / 白凌」「铁道幸存者同盟」「凛冬妮娅」） */
  recommendedIssuer: string;
  /** 当前战区触发该任务原型的具体态势原因 */
  triggerReason: string;
  /** 针对当前态势定制的目标要点建议 */
  tailoredObjectiveHint: string;
  /** 针对当前态势定制的 FD-30 奖励 YAML 键值简述 */
  tailoredRewardHint: string;
  /** 推荐优先级分值（内部排序用） */
  score: number;
}

export interface UserQuestIntent {
  /** 玩家通过【推进作战任务：XXX】或正文点名推进的在途任务名称 */
  targetedActiveQuestName?: string;
  /** 玩家是否主动请求新任务/悬赏/侦察/搜刮物资 */
  wantsNewQuest: boolean;
  /** 玩家输入倾向的预设任务系列 */
  preferredSeries?: PresetQuestSeriesId;
}

export interface RecommendPresetQuestsOptions {
  campaignPhase: CampaignPhase;
  advisorRoster?: StaffAdvisorRoster;
  bootChoices?: BootChoicesHint | null;
  latestUserMessage?: string;
  dailyNetCredits?: number;
  maxRecommendations?: number;
}

/** FD-48：兼容多环系列任务字段的扩展 Quest 类型 */
export type ChainAwareQuest = Quest & {
  series?: string;
  chain_step?: string;
  next_quest?: string;
};

export interface PresetQuestChainStageTemplate {
  /** 环数标识（如 "1/3"、"2/3"、"3/3"） */
  step: string;
  /** 阶段标题/定位简述 */
  stageTitle: string;
  /** 开放式情节与战术方向提示（仅供 LLM 结合现场态势自由发挥，切勿死板照抄） */
  directionHint: string;
  /** 推荐奖励梯度参考（对齐 FD-30） */
  rewardGradientHint: string;
}

export interface PresetQuestChainTemplate {
  /** 系列模板唯一 ID（如 CHAIN-SOV-MCV） */
  id: string;
  /** 战术方向主题标签 */
  themeLabel: string;
  /** 推荐任务分类 */
  category: QuestCategory;
  /** 推荐发包方领域路由 */
  issuerDomain: PresetQuestIssuerDomain;
  /** 总环数 */
  totalSteps: number;
  /** 匹配系列名的关键词列表（供模糊识别系列归属以提供奖励梯度参考） */
  matchKeywords: string[];
  /** 各环递进节奏参考 */
  stages: PresetQuestChainStageTemplate[];
}

export interface QuestChainContinuationHint {
  /** 系列名称（优先采用上一环 q.series，若无则提取任务名前缀或主题名） */
  seriesName: string;
  /** 刚完结或待续接的上一环任务名称 */
  completedQuestName: string;
  /** 上一环环数标识（如 "1/3"） */
  completedStepLabel: string;
  /** 下一环建议环数标识（如 "2/3" 或 "下一环"） */
  nextStepLabel: string;
  /** 下一环演进线索（最高优先级采用 LLM 在上一环自己写的 next_quest，若无则回退匹配预设系列模板的方向参考） */
  nextQuestHook: string;
  /** 推荐发包方署名 */
  recommendedIssuer: string;
  /** 建议奖励梯度参考 */
  rewardHint: string;
  /** 是否为本轮刚完结（通过 prevData Diff 识别） */
  isJustCompletedThisTurn: boolean;
}

/** FD-50：兼容多阶情报链/侦察溯源链字段的扩展 IntelItem 类型 */
export type ChainAwareIntelItem = StatData['intel'][number] & {
  chain?: string;
  chain_step?: string;
  next_lead?: string;
};

export interface PresetIntelChainStageTemplate {
  step: string;
  stageTitle: string;
  recommendedChannels: string[];
  credTarget: '低' | '中' | '高';
  directionHint: string;
}

export interface PresetIntelChainTemplate {
  id: string;
  themeLabel: string;
  totalSteps: number;
  matchKeywords: string[];
  stages: PresetIntelChainStageTemplate[];
  conversionHookHint: string;
}

export interface IntelChainContinuationHint {
  kind: 'step_continuation' | 'verified_conversion';
  chainName: string;
  intelTitle: string;
  currentStepLabel: string;
  nextStepLabel: string;
  currentChannel: string;
  recommendedNextChannels: string[];
  nextLeadHook: string;
  conversionTargetHint: string;
  isJustVerifiedThisTurn: boolean;
}

/* ═══════════════ 2. 六大系列 · 17 个预设任务原型静态字典 ═══════════════ */

export const PRESET_QUEST_ARCHETYPES: readonly PresetQuestArchetype[] = Object.freeze([
  // ── 系列 1：开局踏勘与首基立脚（recon_foundation） ──
  {
    id: 'Q-RECON-01',
    series: 'recon_foundation',
    seriesLabel: '开局踏勘与首基立脚',
    archetypeName: '勘界定址·岩土承重与隐蔽掩体踏勘',
    category: '主线',
    issuerDomain: 'allied',
    allowedPhases: ['field_recon'],
    objectiveSkeleton: [
      '勘察周边水源、岩土承重与可利用的天然/废弃掩体',
      '肃清近距隐患并标定主基地车(MCV)展开原点坐标(0,0)',
    ],
    rewardFormula: '资金: 1000 + 机密点: 10 + 资源.建材: { 钢材: 250 } + 战利品: [首基选址测绘图]',
    gameplayDomainTag: '01·基建选址',
  },
  {
    id: 'Q-RECON-02',
    series: 'recon_foundation',
    seriesLabel: '开局踏勘与首基立脚',
    archetypeName: '破障通电·外围废弃变电所与物资点清理',
    category: '支线',
    issuerDomain: 'allied',
    allowedPhases: ['field_recon', 'early_industrial_climb'],
    objectiveSkeleton: [
      '清除盘踞在外围变电所/废料场的小股游荡威胁',
      '拆解回收初期供电线缆、柴油与基础钢材并接应工程人员',
    ],
    rewardFormula:
      '资源.建材: { 钢材: 300 } + 资源.燃油: { 军用柴油: 150 } + 收编兵力: { 战斗工程师: 2 }（Tier B）',
    gameplayDomainTag: '01·电力与初期工程',
  },
  {
    id: 'Q-RECON-03',
    series: 'recon_foundation',
    seriesLabel: '开局踏勘与首基立脚',
    archetypeName: '耳目初张·制高点观察哨与洞口伪装工程',
    category: '支线',
    issuerDomain: 'allied',
    allowedPhases: ['field_recon', 'early_industrial_climb'],
    objectiveSkeleton: [
      '控制基地外围制高点并架设早期警戒观察哨',
      '完成掩体入口防红外/视觉伪装网铺设以建立首道防区',
    ],
    rewardFormula: '资金: 800 + 机密点: 15 + 战利品: [外围防区伪装网]（联动 <态势> 防区落成）',
    gameplayDomainTag: '01·三环布防与防区',
  },

  // ── 系列 2：经济命脉与多元资金链开拓（economy_supply） ──
  {
    id: 'Q-ECON-01',
    series: 'economy_supply',
    seriesLabel: '经济命脉与资金链开拓',
    archetypeName: '废铁回流·废弃货运支线与工业货场接管',
    category: '支线',
    issuerDomain: 'allied',
    allowedPhases: ['early_industrial_climb', 'mid_late_theater'],
    objectiveSkeleton: [
      '肃清盘踞在废弃货运站/工业货场的武装残敌',
      '修复铁轨道岔或货运车队通道，建立稳定废钢/原料外运线',
    ],
    rewardFormula:
      '资金: 1200 + 资金链: [{ 名称: "工业支线废钢外运协议", 日收益: 400, 总额度: 12000 }]（FD-30 跨系统①）',
    gameplayDomainTag: '04·动态事件与资金链',
  },
  {
    id: 'Q-ECON-02',
    series: 'economy_supply',
    seriesLabel: '经济命脉与资金链开拓',
    archetypeName: '黑市暗桩·地方商队护航与地下通商协定',
    category: '支线',
    issuerDomain: 'faction_or_npc',
    allowedPhases: ['field_recon', 'early_industrial_climb', 'mid_late_theater'],
    objectiveSkeleton: [
      '协助周边幸存者聚落或地下走私商队解除路障/围困',
      '与地方代表议定大宗物资互市与本地外币结算暗桩',
    ],
    rewardFormula:
      '势力: [{ 态度: 友善 }] + 钱袋: { 本地通用外币: 3000 } + 机密点: 15（FD-30 跨系统③）',
    gameplayDomainTag: '10·多元资金与暗网外币',
  },
  {
    id: 'Q-ECON-03',
    series: 'economy_supply',
    seriesLabel: '经济命脉与资金链开拓',
    archetypeName: '紧缺寻源·特种矿脉与高能燃料定向搜刮',
    category: '紧急',
    issuerDomain: 'allied',
    allowedPhases: ['early_industrial_climb', 'mid_late_theater'],
    objectiveSkeleton: [
      '根据勘测回波锁定紧缺战略资源的旧时代仓储点或富集区',
      '组织工程与护卫分队抢运紧缺物资入库',
    ],
    rewardFormula: '定向补齐紧缺六柱战略资源（单小类 400~1200） + 资金: 1000',
    gameplayDomainTag: '05·六柱战略资源回收',
  },

  // ── 系列 3：军工蓝图破译与战地收编（arms_blueprint） ──
  {
    id: 'Q-ARMS-01',
    series: 'arms_blueprint',
    seriesLabel: '军工蓝图破译与战地收编',
    archetypeName: '重工遗珍·战地改装车库与特种蓝图破译',
    category: '支线',
    issuerDomain: 'allied',
    allowedPhases: ['early_industrial_climb', 'mid_late_theater'],
    objectiveSkeleton: [
      '突破废弃重工车库/试验场外围防线并开启气闸',
      '破译完整战地改装工艺图纸并挂载至主基地兵营/战车工厂',
    ],
    rewardFormula:
      '解锁蓝图: [{ 名称: "战地特色改装单位", 类别: "载具|人员", 生产建筑: "战车工厂|兵营", 造价: 650 }]（Tier A） + 机密点: 20',
    gameplayDomainTag: '01/08·Tier A 蓝图挂载量产',
  },
  {
    id: 'Q-ARMS-02',
    series: 'arms_blueprint',
    seriesLabel: '军工蓝图破译与战地收编',
    archetypeName: '残部收容·散落车组与受困工程班组救援整备',
    category: '支线',
    issuerDomain: 'soviet',
    allowedPhases: ['field_recon', 'early_industrial_climb', 'mid_late_theater'],
    objectiveSkeleton: [
      '突入交火区或险境接应受困的友方/中立工程与装甲班组',
      '现场抢修遗弃的轻中装载具并收编入列',
    ],
    rewardFormula:
      '收编兵力: { 常规步兵/工程师: 2~4 }（≤5） + 缴获载具: [T1/T2常规载具]（≤2，严禁T3）（Tier B）',
    gameplayDomainTag: '01·Tier B 现货收编整备',
  },
  {
    id: 'Q-ARMS-03',
    series: 'arms_blueprint',
    seriesLabel: '军工蓝图破译与战地收编',
    archetypeName: '逆向攻关·敌方特种残骸回收与协议测绘',
    category: '支线',
    issuerDomain: 'yuri',
    allowedPhases: ['early_industrial_climb', 'mid_late_theater'],
    objectiveSkeleton: [
      '从交战现场夺取高价值敌方特种装备残骸与火控黑匣子',
      '护送样本返回实验室完成逆向拆解与协议特征测绘',
    ],
    rewardFormula:
      '科研助力: { 项目: "当前在研科技", 进度变化: 35 } + 协议线索: [待启封战略协议]（FD-30 跨系统②+⑤）',
    gameplayDomainTag: '02·科技研究与战略协议',
  },

  // ── 系列 4：情报溯源、暗流干预与隐蔽战线（intel_stealth） ──
  {
    id: 'Q-INTEL-01',
    series: 'intel_stealth',
    seriesLabel: '情报溯源与隐蔽战线',
    archetypeName: '线报核查·待核实异常信号与据点抵近侦察',
    category: '指令',
    issuerDomain: 'yuri',
    allowedPhases: ['field_recon', 'early_industrial_climb', 'mid_late_theater'],
    objectiveSkeleton: [
      '依据待核实 <情报> 的「任务线索」派遣侦察分队抵近目标区域',
      '查明信号源或地下据点真伪并回传实测战术参数',
    ],
    rewardFormula:
      '机密点: 25 + 资金: 1200 + 战利品: [现场加密数据盘]（联动对应 <情报> 升格为「已证实」）',
    gameplayDomainTag: 'FD-33·六源情报核查闭环',
  },
  {
    id: 'Q-INTEL-02',
    series: 'intel_stealth',
    seriesLabel: '情报溯源与隐蔽战线',
    archetypeName: '电磁静默·反侦察拔点与外围热源伪装行动',
    category: '紧急',
    issuerDomain: 'yuri',
    allowedPhases: ['early_industrial_climb', 'mid_late_theater'],
    objectiveSkeleton: [
      '精准拔除游弋在战区外围的敌方侦察哨与遥感信标',
      '布设假热源与电磁屏蔽网以压制战区暴露态势',
    ],
    rewardFormula:
      '资金: 1500 + 机密点: 20 + 战利品: [敌方遥感信标残件]（支撑当轮 <态势> 暴露度下调）',
    gameplayDomainTag: 'FD-36·暴露度双驱压制',
  },
  {
    id: 'Q-INTEL-03',
    series: 'intel_stealth',
    seriesLabel: '情报溯源与隐蔽战线',
    archetypeName: '雪中送炭·战区平民庇护与聚落秩序抚恤',
    category: '支线',
    issuerDomain: 'allied',
    allowedPhases: ['early_industrial_climb', 'mid_late_theater'],
    objectiveSkeleton: [
      '疏散庇护受战火/灾变波及的周边平民并恢复基础供水供电',
      '肃清趁火打劫的流寇溃兵以重塑战区民心秩序',
    ],
    rewardFormula:
      '势力: [{ 态度: 友善 }] + 收编兵力: { 战斗工程师: 2 } + 支撑当轮 <态势> 民心变化回升',
    gameplayDomainTag: 'FD-36·民心五阶联动',
  },
  {
    id: 'Q-INTEL-04',
    series: 'intel_stealth',
    seriesLabel: '情报溯源与隐蔽战线',
    archetypeName: '暗流截击·宏观世界演变高潮期危机应对',
    category: '紧急',
    issuerDomain: 'yuri',
    allowedPhases: ['early_industrial_climb', 'mid_late_theater'],
    objectiveSkeleton: [
      '针对进入发酵/高潮期的 <世界演变> 危机加固防线或调拨战略储备',
      '借外部局势动荡截获稀缺特种工业样本与高价值技术流亡资源',
    ],
    rewardFormula:
      '资金: 3000 + 资源.纳米: { 工业纳米虫: 150 } + 协议线索: [高阶战略协议]',
    gameplayDomainTag: 'FD-33·宏观世界演变五维引擎',
  },

  // ── 系列 5：机娘羁绊与关键剧情人物（maiden_npc） ──
  {
    id: 'Q-GIRL-01',
    series: 'maiden_npc',
    seriesLabel: '机娘羁绊与人物折冲',
    archetypeName: '机魂试炼·参战机娘专长特遣与火控磨合',
    category: '支线',
    issuerDomain: 'allied',
    allowedPhases: ['early_industrial_climb', 'mid_late_theater'],
    objectiveSkeleton: [
      '指派在编核心机娘（或刚完成赐名转正的新机娘）带队执行专长外勤',
      '在实战环境下完成指挥链路深度同步并激发专属战术特质',
    ],
    rewardFormula:
      '机娘奖励: [{ 名称: "参战机娘", 好感变化: +8, 特质: ["实战专属特质"] }]（FD-30 跨系统④） + 机密点: 15',
    gameplayDomainTag: '07·机娘协同与特质成长',
  },
  {
    id: 'Q-NPC-01',
    series: 'maiden_npc',
    seriesLabel: '机娘羁绊与人物折冲',
    archetypeName: '势力折冲·关键剧情人物(NPC)专项委托与破冰',
    category: '支线',
    issuerDomain: 'faction_or_npc',
    allowedPhases: ['field_recon', 'early_industrial_climb', 'mid_late_theater'],
    objectiveSkeleton: [
      '回应已登场关键剧情人物（类别: 人物）的技术协助或派系护卫委托',
      '化解其燃眉之急并确立长期秘密合作关系',
    ],
    rewardFormula:
      '钱袋: { 外币: 2500 } + 资金链或解锁蓝图 + 联动 <扩展档案> 类别: 人物 信任变化 +10~+20',
    gameplayDomainTag: 'FD-32·扩展档案 NPC 动态信任',
  },

  // ── 系列 6：战略跃迁与跨阵营 MCV 火种启封（mcv_strategic · Tier S） ──
  {
    id: 'Q-MCV-SOV',
    series: 'mcv_strategic',
    seriesLabel: '战略跃迁与跨阵营MCV启封',
    archetypeName: '铁幕回响·苏联休眠重工掩体与MCV火种启封',
    category: '主线',
    issuerDomain: 'soviet',
    allowedPhases: ['mid_late_theater'],
    objectiveSkeleton: [
      '破译旧苏联战区最高机密地下重工掩体坐标与气闸密钥',
      '突破外围重装封锁线，夺取并唤醒休眠的【苏联基地车(MCV)】与首席参谋机娘',
    ],
    rewardFormula:
      '解锁阵营: [苏联]（FD-30 Tier S 唯一法定通道，自动并入 unlocked_factions 并拨付苏联 MCV 入列） + 资金: 5000 + 机密点: 50',
    gameplayDomainTag: '07/FD-30·Tier S 跨阵营 MCV 准入',
  },
  {
    id: 'Q-MCV-YURI',
    series: 'mcv_strategic',
    seriesLabel: '战略跃迁与跨阵营MCV启封',
    archetypeName: '心灵暗涌·尤里秘研信标与MCV火种启封',
    category: '主线',
    issuerDomain: 'yuri',
    allowedPhases: ['mid_late_theater'],
    objectiveSkeleton: [
      '追踪并锁定尤里心灵秘研中枢/跨维超时空信标核心坐标',
      '瓦解外围精神控制网，接管【尤里基地车(MCV)】火种与首席参谋机娘',
    ],
    rewardFormula:
      '解锁阵营: [尤里]（FD-30 Tier S 唯一法定通道，自动并入 unlocked_factions 并拨付尤里 MCV 入列） + 资金: 5000 + 机密点: 50',
    gameplayDomainTag: '07/FD-30·Tier S 跨阵营 MCV 准入',
  },
]);

/* ═══════════════ 3. 在途/已完结任务奖励紧凑保真格式化 ═══════════════ */

/**
 * 将 `QuestReward` 格式化为单行紧凑中文摘要，确保在途任务的承诺奖励与刚完结任务的交割战果
 * 在前馈提示词中 100% 保真可见，防止跨楼层后主 LLM 结案遗忘或篡改奖励。
 */
export function formatQuestRewardCompact(reward?: QuestReward | null): string {
  if (!reward || typeof reward !== 'object') return '';

  const parts: string[] = [];

  if (typeof reward.credits === 'number' && reward.credits > 0) {
    parts.push(`资金+${reward.credits}`);
  }
  if (typeof reward.intel_points === 'number' && reward.intel_points > 0) {
    parts.push(`机密点+${reward.intel_points}`);
  }

  // Tier S: 解锁阵营
  if (Array.isArray(reward.unlock_factions) && reward.unlock_factions.length > 0) {
    parts.push(`解锁阵营:[${reward.unlock_factions.join('/')}]`);
  }

  // Tier A: 解锁蓝图
  if (Array.isArray(reward.unlock_units) && reward.unlock_units.length > 0) {
    const bpText = reward.unlock_units
      .map(u => `${u.name}(${u.producer || u.kind || '蓝图'}·造价${u.cost ?? 600})`)
      .join('、');
    parts.push(`解锁蓝图:[${bpText}]`);
  }

  // Tier B: 收编兵力 & 缴获载具
  if (reward.troops && typeof reward.troops === 'object') {
    const troopPairs = Object.entries(reward.troops)
      .filter(([, n]) => typeof n === 'number' && n > 0)
      .map(([k, n]) => `${k}×${n}`);
    if (troopPairs.length > 0) {
      parts.push(`收编兵力:[${troopPairs.join('、')}]`);
    }
  }
  if (Array.isArray(reward.vehicles) && reward.vehicles.length > 0) {
    parts.push(`缴获载具:[${reward.vehicles.join('、')}]`);
  }

  // 六柱战略资源
  if (reward.resources && typeof reward.resources === 'object') {
    const resItems: string[] = [];
    for (const [, subMap] of Object.entries(reward.resources)) {
      if (!subMap || typeof subMap !== 'object') continue;
      for (const [subName, val] of Object.entries(subMap)) {
        if (typeof val === 'number' && val > 0) {
          resItems.push(`${subName}+${val}`);
        }
      }
    }
    if (resItems.length > 0) {
      parts.push(`资源:[${resItems.join('、')}]`);
    }
  }

  // 五大跨系统联动奖励
  if (Array.isArray(reward.chains) && reward.chains.length > 0) {
    const chainText = reward.chains
      .map(c => `${c.name}(+${c.rate_daily}/日${c.capacity ? `·总额${c.capacity}` : ''})`)
      .join('、');
    parts.push(`资金链:[${chainText}]`);
  }
  if (Array.isArray(reward.protocols) && reward.protocols.length > 0) {
    parts.push(`协议线索:[${reward.protocols.join('、')}]`);
  }
  if (Array.isArray(reward.factions) && reward.factions.length > 0) {
    const facText = reward.factions
      .map(f => `${f.name}${f.attitude ? `->${f.attitude}` : ''}`)
      .join('、');
    parts.push(`势力:[${facText}]`);
  }
  if (reward.wallet && typeof reward.wallet === 'object') {
    const walletPairs = Object.entries(reward.wallet)
      .filter(([, v]) => typeof v === 'number' && v > 0)
      .map(([k, v]) => `${k}+${v}`);
    if (walletPairs.length > 0) {
      parts.push(`钱袋:[${walletPairs.join('、')}]`);
    }
  }
  if (Array.isArray(reward.girl_rewards) && reward.girl_rewards.length > 0) {
    const girlText = reward.girl_rewards
      .map(g => {
        const sub: string[] = [];
        if (typeof g.affection_delta === 'number' && g.affection_delta !== 0) {
          sub.push(`好感${g.affection_delta > 0 ? '+' : ''}${g.affection_delta}`);
        }
        if (typeof g.obedience_delta === 'number' && g.obedience_delta !== 0) {
          sub.push(`服从${g.obedience_delta > 0 ? '+' : ''}${g.obedience_delta}`);
        }
        if (Array.isArray(g.traits) && g.traits.length > 0) {
          sub.push(`特质:${g.traits.join('/')}`);
        }
        return `${g.name}${sub.length > 0 ? `(${sub.join('·')})` : ''}`;
      })
      .join('、');
    parts.push(`机娘奖励:[${girlText}]`);
  }
  if (reward.tech_boost && reward.tech_boost.name) {
    parts.push(`科研助力:[${reward.tech_boost.name}+${reward.tech_boost.progress_delta}%]`);
  }
  if (Array.isArray(reward.items) && reward.items.length > 0) {
    parts.push(`战利品:[${reward.items.slice(0, 3).join('、')}]`);
  }

  if (parts.length === 0 && reward.text && reward.text.trim()) {
    return reward.text.trim();
  }

  return parts.join('、');
}

/* ═══════════════ 4. 玩家当轮任务意图检测（D-QUEST-FEED-05） ═══════════════ */

/**
 * 识别玩家当轮输入中的任务推进或新任务诉求：
 * 1. 匹配 PDA/楼层卡片快捷按钮填入的 `【推进作战任务：XXX】` 或正文中点名某项在途任务；
 * 2. 匹配主动求任务/悬赏/侦察/搜刮/外联等指令，并推断倾向的任务系列。
 */
export function detectUserQuestIntent(
  latestUserMessage?: string,
  activeQuests?: readonly Quest[],
): UserQuestIntent {
  const text = String(latestUserMessage ?? '').trim();
  if (!text) {
    return { wantsNewQuest: false };
  }

  let targetedActiveQuestName: string | undefined;
  const activeList = activeQuests ?? [];

  // 1. 显式快捷指令匹配：【推进作战任务：XXX】或【推进任务：XXX】
  const explicitMatch = text.match(/【推进(?:作战)?任务[：:]\s*([^】\]]+)[】\]]/);
  if (explicitMatch && explicitMatch[1]) {
    const rawTarget = explicitMatch[1].trim();
    const matched = activeList.find(
      q => canon(q.name) === canon(rawTarget) || canon(q.name).includes(canon(rawTarget)),
    );
    targetedActiveQuestName = matched?.name || rawTarget;
  }

  // 2. 若未命中显式括号，检查玩家消息是否直接点名某个在途任务名称
  if (!targetedActiveQuestName && activeList.length > 0) {
    for (const q of activeList) {
      const qName = String(q.name ?? '').trim();
      if (qName.length >= 2 && text.includes(qName)) {
        targetedActiveQuestName = qName;
        break;
      }
      // 支持按 · 分割的后半段核心名匹配（如「铁幕前哨·废弃货场清剿」匹配「废弃货场清剿」）
      const parts = qName.split(/[·•:：]/).map(s => s.trim()).filter(s => s.length >= 3);
      if (parts.some(p => text.includes(p))) {
        targetedActiveQuestName = qName;
        break;
      }
    }
  }

  // 3. 检测是否主动询问或触发新任务
  const wantsNewQuest =
    /有什么任务|新任务|接任务|接取任务|发布任务|派发任务|悬赏|委托|支线任务|主线任务|任务线索|去侦察|派人侦察|抵近侦察|搜刮|寻找物资|打通资金链|联系商队|破译蓝图|救援残部/i.test(
      text,
    );

  // 4. 推断倾向的任务系列
  let preferredSeries: PresetQuestSeriesId | undefined;
  if (/基地车|MCV|解锁阵营|苏联火种|尤里火种|休眠掩体|超时空信标/i.test(text)) {
    preferredSeries = 'mcv_strategic';
  } else if (/情报|信号|侦察|核实|无线电|静默|暴露|民心|平民|异象|世界演变/i.test(text)) {
    preferredSeries = 'intel_stealth';
  } else if (/蓝图|车库|改装|收编|救援|残骸|逆向|协议线索/i.test(text)) {
    preferredSeries = 'arms_blueprint';
  } else if (/资金链|货场|废钢|商队|通商|黑市|外币|钱袋|紧缺|矿脉|柴油|钢材/i.test(text)) {
    preferredSeries = 'economy_supply';
  } else if (/机娘|试炼|磨合|好感|特质|委托|信任/i.test(text)) {
    preferredSeries = 'maiden_npc';
  } else if (/踏勘|选址|承重|水源|变电所|通电|哨站|伪装/i.test(text)) {
    preferredSeries = 'recon_foundation';
  }

  return {
    ...(targetedActiveQuestName ? { targetedActiveQuestName } : {}),
    wantsNewQuest,
    ...(preferredSeries ? { preferredSeries } : {}),
  };
}

/* ═══════════════ 5. 动态发包方（issuer）署名路由（D-QUEST-FEED-04） ═══════════════ */

/**
 * 根据任务原型所属领域、当前参谋席阵容、已接触地方势力与 NPC 人物档案，动态决议推荐发包方署名。
 */
export function resolveDynamicQuestIssuer(
  archetype: PresetQuestArchetype,
  data: StatData,
  advisorRoster?: StaffAdvisorRoster,
  bootChoices?: BootChoicesHint | null,
): string {
  const advisors = advisorRoster?.advisors ?? [];
  const girls = data.forces?.girls ?? [];
  const unlockedRaw = (data.command?.unlocked_factions ?? ['allied']).map(s => s.toLowerCase());
  const hasSovietUnlocked = unlockedRaw.some(s => s.includes('soviet') || s.includes('苏'));
  const hasYuriUnlocked = unlockedRaw.some(s => s.includes('yuri') || s.includes('尤里'));

  const alliedGirl = girls.find(g =>
    /白凌|盟军|allied|ally/i.test(`${g.name ?? ''} ${g.faction ?? ''}`),
  );
  const sovietGirl = girls.find(g =>
    /喀秋莎|妮娅|凛冬|苏联|苏军|soviet/i.test(`${g.name ?? ''} ${g.faction ?? ''}`),
  );
  const yuriGirl = girls.find(g =>
    /尤里卡|薇拉|尤里|心灵|yuri/i.test(`${g.name ?? ''} ${g.faction ?? ''}`),
  );

  const primaryAdvisor =
    advisors[0]?.name || alliedGirl?.name || girls[0]?.name || '白凌';

  if (archetype.issuerDomain === 'faction_or_npc') {
    // 优先匹配 codex 中已登场的 类别: 人物
    const npcCodex = (data.codex ?? []).filter(c => c.kind === '人物' && c.name);
    if (npcCodex.length > 0 && archetype.id === 'Q-NPC-01') {
      const targetNpc =
        npcCodex.find(c => {
          const trust = Number(c.params?.['信任度'] ?? 50);
          return Number.isFinite(trust) && trust < 75;
        }) ?? npcCodex[0];
      const facTag = targetNpc.params?.['所属势力'] ? `${targetNpc.params['所属势力']} · ` : '';
      return `${facTag}${targetNpc.name}`;
    }

    // 其次匹配已接触的地方势力
    const knownFactions = (data.factions ?? []).filter(
      f => f.name && f.attitude !== '敌意' && f.attitude !== '未接触',
    );
    if (knownFactions.length > 0) {
      return `${knownFactions[0].name} / ${primaryAdvisor}`;
    }
    const anyFaction = (data.factions ?? []).find(f => f.name);
    if (anyFaction) {
      return `${anyFaction.name}联络人 / ${primaryAdvisor}`;
    }
  }

  if (archetype.issuerDomain === 'soviet') {
    const sovAdvisor = advisors.find(a => a.faction === 'soviet');
    if (sovAdvisor) {
      return `联席参谋部 / ${sovAdvisor.name}`;
    }
    if (sovietGirl?.name) {
      return `联席参谋部 / ${sovietGirl.name}`;
    }
    if (hasSovietUnlocked) {
      return '联席参谋部 / 喀秋莎';
    }
  }

  if (archetype.issuerDomain === 'yuri') {
    const yuriAdvisor = advisors.find(a => a.faction === 'yuri');
    if (yuriAdvisor) {
      return `联席参谋部 / ${yuriAdvisor.name}`;
    }
    if (yuriGirl?.name) {
      return `联席参谋部 / ${yuriGirl.name}`;
    }
    if (hasYuriUnlocked) {
      return '联席参谋部 / 尤里卡';
    }
  }

  if (archetype.issuerDomain === 'companion_or_recon') {
    const companion = bootChoices?.humanRoster?.find(h => h.name)?.name;
    if (companion) return `前线踏勘组 / ${companion}`;
  }

  // 默认使用当前首席在岗参谋（若为现场直觉则用前线勘测组）
  if (primaryAdvisor === '现场直觉') {
    const companion = bootChoices?.humanRoster?.find(h => h.name)?.name;
    return companion ? `随行同伴 / ${companion}` : '战区前线勘测组';
  }
  return `联席参谋部 / ${primaryAdvisor}`;
}

/* ═══════════════ 6. 预设任务原型智能靶向推荐引擎（D-QUEST-FEED-01 & 03） ═══════════════ */

function findArchetype(id: string): PresetQuestArchetype {
  const found = PRESET_QUEST_ARCHETYPES.find(a => a.id === id);
  if (!found) {
    throw new Error(`Unknown preset quest archetype: ${id}`);
  }
  return found;
}

/**
 * 结合五阶战役状态机、战区实时瓶颈、待核实 `<情报>` 线索与玩家当轮意图，
 * 动态挑选 1~2 个最契合当前局势的预设任务原型提案。
 */
export function recommendPresetQuestArchetypes(
  data: StatData,
  options: RecommendPresetQuestsOptions,
): PresetQuestRecommendation[] {
  const { campaignPhase, advisorRoster, bootChoices, latestUserMessage } = options;
  const maxCount = options.maxRecommendations ?? 2;

  // ── 节奏锁 1（D-QUEST-FEED-03）：原世界序章与被动静默待机期严禁派发任何系统 <任务> ──
  if (campaignPhase === 'prologue_unbound' || campaignPhase === 'silent_standby') {
    return [];
  }

  const activeQuests = data.quests?.active ?? [];
  const historyQuests = (data.quests as unknown as { history?: Quest[] } | undefined)?.history ?? [];
  const userIntent = detectUserQuestIntent(latestUserMessage, activeQuests);

  // ── 节奏锁 2（D-QUEST-FEED-03）：在途任务 >= 3 且玩家未主动求新任务时，抑制新任务派发 ──
  if (activeQuests.length >= 3 && !userIntent.wantsNewQuest) {
    return [];
  }

  const bases = data.bases ?? [];
  const queues = data.queues ?? [];
  const vehicles = data.forces?.vehicles ?? [];
  const troops = data.forces?.troops ?? {};
  const girls = data.forces?.girls ?? [];
  const intelPool = data.intel ?? [];
  const activeChains = (data.economy?.chains ?? []).filter(c => c.status === 'active');
  const dailyNet =
    options.dailyNetCredits ??
    activeChains.reduce((acc, c) => acc + (c.flow === '支出' ? -c.rate_daily : c.rate_daily), 0);

  // 辅助去重：若在途任务或历史任务已存在同名/同系列主题，则降低权重或跳过
  const existingTitlesCanon = [...activeQuests, ...historyQuests].map(q => canon(q.name));
  const isAlreadyActiveOrDone = (arch: PresetQuestArchetype): boolean => {
    const corePrefix = canon(arch.archetypeName.split('·')[0] ?? arch.archetypeName);
    return existingTitlesCanon.some(t => t.includes(corePrefix));
  };

  const candidates: PresetQuestRecommendation[] = [];

  const pushCandidate = (
    archId: string,
    score: number,
    triggerReason: string,
    tailoredObjectiveHint?: string,
    tailoredRewardHint?: string,
  ) => {
    const arch = findArchetype(archId);
    if (isAlreadyActiveOrDone(arch)) return;
    const bonus = userIntent.preferredSeries === arch.series ? 25 : 0;
    const issuer = resolveDynamicQuestIssuer(arch, data, advisorRoster, bootChoices);
    candidates.push({
      archetype: arch,
      recommendedIssuer: issuer,
      triggerReason,
      tailoredObjectiveHint: tailoredObjectiveHint || arch.objectiveSkeleton.join('；'),
      tailoredRewardHint: tailoredRewardHint || arch.rewardFormula,
      score: score + bonus,
    });
  };

  // ── 规则 1：情报转化直通车（D-QUEST-FEED-03 最高优，FD-50 兼容 next_lead 与实锤转化） ──
  const extractQuestHook = (it: (typeof intelPool)[number]): string => {
    const ci = it as ChainAwareIntelItem & { quest_hook?: string };
    const raw = ci.next_lead ?? ci.quest_hook ?? it.hook ?? '';
    return String(raw).trim();
  };
  const pendingActionableIntel = intelPool.find(
    it =>
      it.scope !== 'world' &&
      (it.status === '待核实' || it.status === '演进中') &&
      Boolean(extractQuestHook(it)),
  );
  const verifiedActionableIntel = !pendingActionableIntel
    ? intelPool.find(it => {
        if (it.scope === 'world' || it.status === '已证伪') return false;
        const isVerified = it.status === '已证实' || it.cred === '高';
        if (!isVerified) return false;
        const hookText = extractQuestHook(it);
        if (!hookText) return false;
        const ci = it as ChainAwareIntelItem;
        const hookCanon = canon(hookText);
        const chainCanon = canon(String(ci.chain ?? ''));
        const alreadySpawned = existingTitlesCanon.some(
          t =>
            (hookCanon.length >= 2 && t.includes(hookCanon)) ||
            (chainCanon.length >= 2 && t.includes(chainCanon)),
        );
        return !alreadySpawned;
      })
    : undefined;
  const actionableIntel = pendingActionableIntel ?? verifiedActionableIntel;
  if (actionableIntel) {
    const hookText = extractQuestHook(actionableIntel);
    const intelTitle = actionableIntel.title || actionableIntel.content.slice(0, 20);
    const isVerified = actionableIntel.status === '已证实' || actionableIntel.cred === '高';
    const chainName = String((actionableIntel as ChainAwareIntelItem).chain ?? '').trim();
    const chainClause = chainName ? `（所属情报链：《${chainName}》）` : '';
    pushCandidate(
      'Q-INTEL-01',
      98,
      isVerified
        ? `存在已证实情报「${intelTitle}」${chainClause}且附带明确转化线索（${hookText}）`
        : `存在待核实线报「${intelTitle}」${chainClause}且附带明确任务线索（${hookText}）`,
      isVerified
        ? `1. 依据已证实情报线索执行「${hookText}」；2. 推进「${intelTitle}」后续战术行动并扩大战果`
        : `1. 按线报线索执行「${hookText}」；2. 查明「${intelTitle}」现场实况并回传参数`,
      isVerified
        ? '机密点: 25, 资金: 1500, 战利品: [现场勘测数据盘]（可根据实锤情报链派生多环 <任务> 或解锁蓝图/协议线索）'
        : '机密点: 25, 资金: 1200, 战利品: [现场勘测数据盘]（完成后同步将对应 <情报> 状态更新为「已证实」）',
    );
  }

  // ── 规则 2：初抵踏勘期（bases.length === 0） ──
  if (bases.length === 0 && campaignPhase === 'field_recon') {
    const mcvList = vehicles.filter(v => /机动建设车|基地车|\bMCV\b/i.test(v));
    const mcvLabel = mcvList[0] || '机动建设车(MCV)';
    pushCandidate(
      'Q-RECON-01',
      95,
      `车队持有待命「${mcvLabel}」且尚未展开主基地，急需完成周边踏勘与(0,0)原点定址`,
      `1. 踏勘周边水源、岩土承重与隐蔽掩体条件；2. 肃清近距威胁并选定「${mcvLabel}」展开坐标(0,0)`,
      '资金: 1000, 机密点: 10, 资源: { 建材: { 钢材: 250 } }, 战利品: [首基选址测绘图]',
    );
    pushCandidate(
      'Q-RECON-02',
      82,
      '初抵战区外围存在废弃设施与初期建材/工程人员收拢契机',
    );
  }

  // ── 规则 3：暴露度告警与民心抚恤（FD-36 联动） ──
  const expVal = data.exposure?.value ?? 0;
  if (expVal >= 5.0) {
    pushCandidate(
      'Q-INTEL-02',
      92,
      `当前战区暴露度已升至 ${expVal}/10（警戒区间），急需执行反侦察拔点与电磁伪装压制暴露`,
    );
  }
  const moraleVal = data.morale?.value ?? 5.0;
  const moraleEngaged = Boolean(data.morale?.engaged) || expVal >= 4.5;
  if (moraleEngaged && moraleVal < 4.2) {
    pushCandidate(
      'Q-INTEL-03',
      88,
      `当前战区民心指数偏低（${moraleVal}/10），需通过平民救援或秩序抚恤扭转地方舆情`,
    );
  }

  // ── 规则 4：宏观世界演变发酵/高潮危机截击（FD-33 联动） ──
  const hotWorldEvo = intelPool.find(
    it => it.scope === 'world' && (it.stage === '发酵' || it.stage === '高潮'),
  );
  if (hotWorldEvo) {
    const evoTitle = hotWorldEvo.title || hotWorldEvo.content.slice(0, 20);
    pushCandidate(
      'Q-INTEL-04',
      86,
      `宏观世界演变「${evoTitle}」正处于【${hotWorldEvo.stage}】阶段，可立项危机应对或借势收割任务`,
      `1. 针对「${evoTitle}」加固战区防线或调配应急储备；2. 借局势动荡截获稀缺工业样本`,
    );
  }

  // ── 规则 5：首基展开后的基建/电力/防区与资金链短板 ──
  if (bases.length > 0) {
    const primaryBase = bases[0];
    const blds = primaryBase.buildings ?? [];
    const hasPower = blds.some(b => /发电厂|反应炉|电站/i.test(b.name) && b.state === '运转');
    const hasSectors = Array.isArray((primaryBase as { sectors?: unknown[] }).sectors) &&
      ((primaryBase as { sectors?: unknown[] }).sectors?.length ?? 0) > 0;

    if (!hasPower) {
      pushCandidate(
        'Q-RECON-02',
        89,
        `主基地「${primaryBase.name}」尚无运转中的发电设施，可派发外围变电所/废料场清理任务补充钢材柴油与工程师`,
      );
    } else if (!hasSectors && blds.length <= 3) {
      pushCandidate(
        'Q-RECON-03',
        76,
        `主基地「${primaryBase.name}」外围尚未建立隐蔽防区与制高点观察哨`,
      );
    }

    // 检查是否已建成兵营或战车工厂（可触发 Tier A 解锁蓝图任务）
    const hasBarracks = blds.some(b => /兵营/i.test(b.name) && b.state === '运转');
    const hasWarFactory = blds.some(b => /战车工厂|车厂/i.test(b.name) && b.state === '运转');
    if (hasBarracks || hasWarFactory) {
      const targetProducer = hasWarFactory ? '战车工厂' : '兵营';
      const targetKind = hasWarFactory ? '载具' : '人员';
      pushCandidate(
        'Q-ARMS-01',
        83,
        `主基地已建成运转中的【${targetProducer}】，可通过重工车库/试验场破译任务解锁 Tier A 战地特色${targetKind}蓝图`,
        `1. 攻占或破译周边旧时代重工车库/试验场；2. 提取完整改装工艺卡并挂载至主基地【${targetProducer}】`,
        `解锁蓝图: [{ 名称: "战地特色改装${targetKind}", 类别: "${targetKind}", 生产建筑: "${targetProducer}", 造价: ${hasWarFactory ? 700 : 320} }], 机密点: 20`,
      );
    }
  }

  if (bases.length > 0 || campaignPhase !== 'field_recon') {
    if (dailyNet <= 0 || activeChains.length === 0) {
      pushCandidate(
        'Q-ECON-01',
        87,
        `当前战区日均资金链净流为 ${dailyNet}/日（活跃资金链 ${activeChains.length} 条），亟需接管废弃货场/工业支线打通持续现金流`,
      );
    }

    // 检查六柱战略资源紧缺项
    const lowResNames: string[] = [];
    const resObj = data.economy?.resources as Record<string, Record<string, number | null>> | undefined;
    if (resObj && typeof resObj === 'object') {
      for (const [, subMap] of Object.entries(resObj)) {
        if (!subMap || typeof subMap !== 'object') continue;
        for (const [subName, val] of Object.entries(subMap)) {
          if (typeof val === 'number' && val <= 50) {
            lowResNames.push(`${subName}(余${val})`);
          }
        }
      }
    }
    if (lowResNames.length > 0) {
      const targetRes = lowResNames.slice(0, 2).join('、');
      pushCandidate(
        'Q-ECON-03',
        84,
        `战区六柱战略资源存在紧缺项：${targetRes}，宜派发定向搜刮任务补库`,
        `1. 勘测并锁定周边储备有「${targetRes.replace(/\(.*?\)/g, '')}」的仓储点；2. 组织护卫分队抢运入库`,
        `资源: { 对应紧缺小类: 500 }, 资金: 1000`,
      );
    }

    // 检查常规兵力/载具是否单薄（触发 Tier B 收编整备）
    const totalTroops = Object.values(troops).reduce(
      (acc, n) => acc + (typeof n === 'number' ? n : 0),
      0,
    );
    if (totalTroops < 6 || vehicles.length <= 1) {
      pushCandidate(
        'Q-ARMS-02',
        78,
        `当前现役常规兵力（${totalTroops}人）与机动载具（${vehicles.length}台）偏少，可通过救援整备任务补充 Tier B 现成班组与轻中装载具`,
      );
    }

    // 检查是否有在研科技或待发现协议（触发 Q-ARMS-03 逆向攻关）
    const activeResearch = queues.find(q => q.type === '研究' && q.status === '进行中');
    if (activeResearch) {
      pushCandidate(
        'Q-ARMS-03',
        80,
        `科研序列正在攻关《${activeResearch.item}》，可通过敌方残骸/黑匣子回收任务提供科研助力与协议线索`,
        `1. 夺取高价值敌方装备残骸与测绘数据；2. 护送回实验室助力《${activeResearch.item}》攻关`,
        `科研助力: { 项目: "${activeResearch.item}", 进度变化: 35 }, 协议线索: [关联战略协议]`,
      );
    }
  }

  // ── 规则 6：地方外币钱袋、NPC 人物与机娘专长试炼 ──
  const walletKeys = Object.keys(data.economy?.wallet ?? {}).filter(
    k => (data.economy?.wallet?.[k] ?? 0) > 0,
  );
  if (walletKeys.length === 0) {
    pushCandidate(
      'Q-ECON-02',
      74,
      '本地外币钱袋（wallet）尚无储备，可通过护航周边商队/聚落打通外币结算与友善势力关系',
    );
  }

  const npcCodex = (data.codex ?? []).filter(c => c.kind === '人物' && c.name);
  if (npcCodex.length > 0) {
    const npc = npcCodex[0];
    pushCandidate(
      'Q-NPC-01',
      77,
      `扩展档案中已记录关键人物「${npc.name}」，可派发专项委托深化其信任度并获取独家渠道奖励`,
    );
  }

  if (girls.length > 0) {
    const targetGirl = girls[0];
    pushCandidate(
      'Q-GIRL-01',
      73,
      `在编机娘「${targetGirl.name}」可带队执行专长特遣试炼，赢取好感提升与实战专属特质`,
      `1. 由「${targetGirl.name}」带队执行定点战术外勤；2. 完成极端工况火控/指挥协同磨合`,
      `机娘奖励: [{ 名称: "${targetGirl.name}", 好感变化: +8, 特质: ["实战专属特质"] }], 机密点: 15`,
    );
  }

  // ── 规则 7：中后期跨阵营 MCV 火种启封主线（Tier S 唯一通道） ──
  const unlockedRaw = (data.command?.unlocked_factions ?? ['allied']).map(s => s.toLowerCase());
  const hasSoviet = unlockedRaw.some(s => s.includes('soviet') || s.includes('苏'));
  const hasYuri = unlockedRaw.some(s => s.includes('yuri') || s.includes('尤里'));
  if (campaignPhase === 'mid_late_theater' || userIntent.preferredSeries === 'mcv_strategic') {
    if (!hasSoviet) {
      pushCandidate(
        'Q-MCV-SOV',
        85,
        '战区已进入多产线博弈阶段且尚未启封【苏联】阵营，可立项 Tier S 主线战役夺取苏联休眠 MCV 火种',
      );
    }
    if (!hasYuri) {
      pushCandidate(
        'Q-MCV-YURI',
        81,
        '战区已进入多产线博弈阶段且尚未启封【尤里】阵营，可立项 Tier S 主线战役接管尤里秘研 MCV 火种',
      );
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, maxCount);
}

/* ═══════════════ 7. FD-48 开放式多环系列任务参考骨架与续链检测（D-QUEST-CHAIN-02 & 04） ═══════════════ */

/**
 * 5 条开放式多环系列任务参考骨架（`PRESET_QUEST_CHAIN_TEMPLATES`）。
 * ⚠️ 核心原则（D-QUEST-CHAIN-04）：仅提供「三环递进节奏（破冰 → 攻坚 → 终幕）+ 每环法定奖励梯度参考」，
 * 严禁绑死剧情或机械照抄参考标题，强引导主 LLM 根据现场态势、地貌与前文伏笔自主发挥命名与具体内容。
 */
export const PRESET_QUEST_CHAIN_TEMPLATES: readonly PresetQuestChainTemplate[] = Object.freeze([
  {
    id: 'CHAIN-SOV-MCV',
    themeLabel: '苏系重工火种启封主线链',
    category: '主线',
    issuerDomain: 'soviet',
    totalSteps: 3,
    matchKeywords: ['铁幕', '苏联', '苏军', '重工掩体', 'soviet', '火种'],
    stages: [
      {
        step: '1/3',
        stageTitle: '信号溯源',
        directionHint:
          '捕捉旧工业区/极地/深掩体的苏系加密信标或工程遗迹线索，勘明外围封锁态势（请结合当前地域地貌自主发挥）',
        rewardGradientHint: '机密点+25、协议线索',
      },
      {
        step: '2/3',
        stageTitle: '破障通电',
        directionHint:
          '打通外围防线、恢复高压并网或破拆重型气闸，为深入核心掩体创造工程条件（请结合前文战果自主发挥）',
        rewardGradientHint: '资源.建材(特种钢/钢材+400)、收编兵力(战斗工程师×2)',
      },
      {
        step: '3/3',
        stageTitle: '火种苏醒',
        directionHint:
          '肃清核心守卫或失控防卫机械，唤醒休眠的【苏联基地车(MCV)】与首席参谋机娘',
        rewardGradientHint: 'Tier S 解锁阵营:[苏联]（自动获赠苏联 MCV）+ 资金+5000 + 机密点+50',
      },
    ],
  },
  {
    id: 'CHAIN-YURI-MCV',
    themeLabel: '尤里秘研火种启封主线链',
    category: '主线',
    issuerDomain: 'yuri',
    totalSteps: 3,
    matchKeywords: ['心灵', '尤里', '秘研', '脑波', '超时空信标', 'yuri'],
    stages: [
      {
        step: '1/3',
        stageTitle: '异象追查',
        directionHint:
          '调查异常脑波频段、失踪勘探队或地下生物/心灵实验室线报，锁定秘研信标方位（请结合现场态势自主发挥）',
        rewardGradientHint: '机密点+25、待核实情报升格为已证实',
      },
      {
        step: '2/3',
        stageTitle: '屏蔽攻坚',
        directionHint:
          '拔除外围精神干扰信标并架设心灵/电磁屏蔽网，瓦解外围精控防线（请结合现场态势自主发挥）',
        rewardGradientHint: '科研助力(当前在研科技+35%)、资源.纳米(工业纳米虫+150)',
      },
      {
        step: '3/3',
        stageTitle: '中枢接管',
        directionHint:
          '突入秘研中枢/跨维信标核心，接管【尤里基地车(MCV)】火种与首席参谋机娘',
        rewardGradientHint: 'Tier S 解锁阵营:[尤里]（自动获赠尤里 MCV）+ 资金+5000 + 机密点+50',
      },
    ],
  },
  {
    id: 'CHAIN-ECON-ARTERIAL',
    themeLabel: '战区经济动脉与重工复苏链',
    category: '支线',
    issuerDomain: 'allied',
    totalSteps: 3,
    matchKeywords: ['铁道', '动脉', '货运', '货场', '矿区', '废铁', '物流', '干线'],
    stages: [
      {
        step: '1/3',
        stageTitle: '节点清障',
        directionHint:
          '清理周边交通枢纽/货运站/矿区外围威胁，打通初步勘测与抢修通道（请按当前地形自主发挥）',
        rewardGradientHint: '资源.建材(钢材+300)、资源.燃油(军用柴油+150)',
      },
      {
        step: '2/3',
        stageTitle: '护航整备',
        directionHint:
          '抢修受损运输设备与道岔，收拢沿途散落的工程班组或车组人员（请按当前战况自主发挥）',
        rewardGradientHint: 'Tier B 缴获载具(T1/T2常规载具×1)、收编兵力(≤4)',
      },
      {
        step: '3/3',
        stageTitle: '干线并网',
        directionHint:
          '正式打通稳定物资外运通道并回收旧时代特色改装工艺图纸',
        rewardGradientHint: '跨系统① 资金链(日收益+400~600) + Tier A 解锁蓝图',
      },
    ],
  },
  {
    id: 'CHAIN-MAIDEN-TRIAL',
    themeLabel: '参战机娘火控磨合与机魂试炼链',
    category: '支线',
    issuerDomain: 'allied',
    totalSteps: 2,
    matchKeywords: ['机魂', '试炼', '磨合', '火控', '机娘', '共鸣'],
    stages: [
      {
        step: '1/2',
        stageTitle: '协同演训',
        directionHint:
          '由指定在编机娘带队执行特种侦察或定点拔点，在实战环境下采集火控协同参数',
        rewardGradientHint: '机娘奖励(好感+5)、机密点+15',
      },
      {
        step: '2/2',
        stageTitle: '极限共鸣',
        directionHint:
          '在复杂高烈度战况下与指挥官完成深层意识链路同步，突破性能瓶颈并觉醒专属特质',
        rewardGradientHint: '跨系统④ 机娘奖励(好感+10、解锁实战专属特质) + 资金+1200',
      },
    ],
  },
  {
    id: 'CHAIN-FACTION-PACT',
    themeLabel: '地方势力折冲与地下同盟链',
    category: '支线',
    issuerDomain: 'faction_or_npc',
    totalSteps: 3,
    matchKeywords: ['商队', '折冲', '同盟', '暗桩', '黑市', '聚落', '委托'],
    stages: [
      {
        step: '1/3',
        stageTitle: '破冰解围',
        directionHint:
          '救援遇袭地方商队/幸存者聚落或提供急需物资援助，建立初步沟通渠道',
        rewardGradientHint: '势力态度改善、钱袋(本地外币+1500)',
      },
      {
        step: '2/3',
        stageTitle: '危机斡旋',
        directionHint:
          '协助关键剧情人物(NPC)化解派系内部危机或外部武装施压，深化个人信任',
        rewardGradientHint: '联动 <扩展档案> 人物信任度提升、钱袋(本地外币+3000)',
      },
      {
        step: '3/3',
        stageTitle: '盟约缔结',
        directionHint:
          '正式缔结长期地下互市、情报共享与外币结算同盟协定',
        rewardGradientHint: '跨系统③ 势力态度->友善 + 持续资金链或解锁蓝图',
      },
    ],
  },
]);

/**
 * 解析系列任务环数标识（支持 `"1/3"`、`"第2环/共3环"`、`"2 / 3"` 等格式）。
 */
export function parseQuestChainStep(
  chainStep?: string | null,
): { current: number; total: number; isFinal: boolean } | null {
  const raw = String(chainStep ?? '').trim();
  if (!raw) return null;

  const slashMatch = raw.match(/(\d+)\s*[/／]\s*(?:共\s*)?(\d+)/);
  if (slashMatch) {
    const current = Number(slashMatch[1]);
    const total = Number(slashMatch[2]);
    if (Number.isInteger(current) && Number.isInteger(total) && current >= 1 && total >= 1 && current <= total) {
      return { current, total, isFinal: current >= total };
    }
  }

  const cnMatch = raw.match(/第?\s*(\d+)\s*[环幕章阶段]\s*(?:[/／,，·]|共)\s*(?:共\s*)?(\d+)/);
  if (cnMatch) {
    const current = Number(cnMatch[1]);
    const total = Number(cnMatch[2]);
    if (Number.isInteger(current) && Number.isInteger(total) && current >= 1 && total >= 1 && current <= total) {
      return { current, total, isFinal: current >= total };
    }
  }

  return null;
}

function matchPresetChainTemplate(
  seriesName: string,
  questName: string,
): PresetQuestChainTemplate | undefined {
  const haystack = `${seriesName} ${questName}`.toLowerCase();
  return PRESET_QUEST_CHAIN_TEMPLATES.find(tpl =>
    tpl.matchKeywords.some(kw => haystack.includes(kw.toLowerCase())),
  );
}

/**
 * 扫描 `quests.history` 中已完成的多环系列任务（或带有 `next_quest` 后续任务线索的任务），
 * 识别尚未立项下一环的待续杯系列任务，优先采用 LLM 在上一环自己写下的 `series` 与 `next_quest` 线索，
 * 若未写则用开放式系列模板的方向与奖励梯度兜底。
 */
export function detectPendingChainContinuations(
  data: StatData,
  options?: {
    prevData?: StatData | null;
    advisorRoster?: StaffAdvisorRoster;
    bootChoices?: BootChoicesHint | null;
  },
): QuestChainContinuationHint[] {
  const activeQuests = ((data.quests?.active ?? []) as ChainAwareQuest[]);
  const historyQuests =
    ((data.quests as unknown as { history?: ChainAwareQuest[] } | undefined)?.history ?? []);

  if (historyQuests.length === 0) return [];

  const prevActiveSet = new Set(
    (options?.prevData?.quests?.active ?? []).map(q => canon(q.name)),
  );
  const prevDoneHistorySet = new Set(
    ((options?.prevData?.quests as unknown as { history?: ChainAwareQuest[] } | undefined)?.history ?? [])
      .filter(q => q.status === '已完成')
      .map(q => canon(q.name)),
  );

  const hints: QuestChainContinuationHint[] = [];
  const seenSeriesKeys = new Set<string>();

  for (let i = historyQuests.length - 1; i >= 0; i--) {
    const q = historyQuests[i];
    if (q.status !== '已完成') continue;

    const seriesRaw = String(q.series ?? '').trim();
    const stepRaw = String(q.chain_step ?? '').trim();
    const nextHookRaw = String(q.next_quest ?? '').trim();
    const stepInfo = parseQuestChainStep(stepRaw);

    const hasExplicitNextHook = Boolean(nextHookRaw);
    const hasUnfinishedSeriesStep = Boolean(seriesRaw && stepInfo && !stepInfo.isFinal);

    // 若既无 next_quest 后续线索，也非未完结系列环，或明确已是最后一环且无后续线索，则跳过
    if (!hasExplicitNextHook && !hasUnfinishedSeriesStep) continue;
    if (stepInfo?.isFinal && !hasExplicitNextHook) continue;

    const derivedSeriesName =
      seriesRaw || (q.name.includes('·') ? q.name.split('·')[0].trim() : q.name);
    const seriesCanon = canon(derivedSeriesName);
    if (seriesCanon && seenSeriesKeys.has(seriesCanon)) continue;

    // 检查是否已经在 active 或 history 中开启/完成了下一环
    const nextHookCanon = canon(nextHookRaw);
    const alreadyContinuedInActive = activeQuests.some(aq => {
      if (seriesRaw && aq.series && canon(aq.series) === canon(seriesRaw)) return true;
      if (nextHookCanon && nextHookCanon.length >= 2 && canon(aq.name).includes(nextHookCanon)) {
        return true;
      }
      return false;
    });
    if (alreadyContinuedInActive) continue;

    const alreadyContinuedInHistory = historyQuests.some(hq => {
      if (canon(hq.name) === canon(q.name)) return false;
      if (nextHookCanon && nextHookCanon.length >= 2 && canon(hq.name).includes(nextHookCanon)) {
        return true;
      }
      if (seriesRaw && hq.series && canon(hq.series) === canon(seriesRaw) && stepInfo) {
        const hStep = parseQuestChainStep(hq.chain_step);
        if (hStep && hStep.current > stepInfo.current) return true;
      }
      return false;
    });
    if (alreadyContinuedInHistory) continue;

    if (seriesCanon) seenSeriesKeys.add(seriesCanon);

    const completedStepLabel = stepInfo ? `${stepInfo.current}/${stepInfo.total}` : stepRaw || '前序环';
    const nextStepNum = stepInfo ? stepInfo.current + 1 : 2;
    const nextStepLabel = stepInfo
      ? `${Math.min(nextStepNum, stepInfo.total)}/${stepInfo.total}`
      : '下一环';

    const matchedTemplate = matchPresetChainTemplate(derivedSeriesName, q.name);
    const templateNextStage = matchedTemplate
      ? matchedTemplate.stages.find(s => s.step.startsWith(`${nextStepNum}/`)) ??
        matchedTemplate.stages[Math.min(nextStepNum - 1, matchedTemplate.stages.length - 1)]
      : undefined;

    // 最高优先级采用 LLM 在上一环自己写的 next_quest 线索；若未写则回退预设系列模板的方向参考
    const nextQuestHook = nextHookRaw
      ? nextHookRaw
      : templateNextStage
        ? `${templateNextStage.stageTitle}：${templateNextStage.directionHint}`
        : `顺延《${derivedSeriesName}》上一环「${q.name}」战果与现场态势自主推演下一阶段作战目标`;

    const rewardHint = templateNextStage
      ? templateNextStage.rewardGradientHint
      : stepInfo && nextStepNum >= stepInfo.total
        ? '终幕大奖（如跨系统资金链、Tier A 解锁蓝图、机娘专属特质或主线 Tier S 阵营火种）'
        : '中坚递进悬赏（机密点+20~30、紧缺六柱资源或 Tier B 战地收编）';

    let recommendedIssuer = String(q.issuer ?? '').trim();
    if (!recommendedIssuer) {
      const dummyArch: PresetQuestArchetype = {
        id: matchedTemplate?.id || 'CHAIN-CONT',
        series: 'recon_foundation',
        seriesLabel: derivedSeriesName,
        archetypeName: q.name,
        category: q.category || matchedTemplate?.category || '支线',
        issuerDomain: matchedTemplate?.issuerDomain || 'allied',
        allowedPhases: ['field_recon', 'early_industrial_climb', 'mid_late_theater'],
        objectiveSkeleton: [],
        rewardFormula: rewardHint,
        gameplayDomainTag: 'FD-48·系列任务续链',
      };
      recommendedIssuer = resolveDynamicQuestIssuer(
        dummyArch,
        data,
        options?.advisorRoster,
        options?.bootChoices,
      );
    }

    const qKey = canon(q.name);
    const isJustCompletedThisTurn = Boolean(
      options?.prevData && (prevActiveSet.has(qKey) || !prevDoneHistorySet.has(qKey)),
    );

    hints.push({
      seriesName: derivedSeriesName,
      completedQuestName: q.name,
      completedStepLabel,
      nextStepLabel,
      nextQuestHook,
      recommendedIssuer,
      rewardHint,
      isJustCompletedThisTurn,
    });
  }

  hints.sort((a, b) => Number(b.isJustCompletedThisTurn) - Number(a.isJustCompletedThisTurn));
  return hints;
}

/* ═══════════════ 8. FD-50 开放式三阶情报链参考骨架与在途交叉印证/终局转化检测（D-INTEL-CHAIN-02 & 03） ═══════════════ */

/**
 * 4 条开放式三阶情报链参考骨架（`PRESET_INTEL_CHAIN_TEMPLATES`）。
 * ⚠️ 核心原则（D-INTEL-CHAIN-03）：仅提供「三阶侦察节奏（1/3 捕风捉影[低] -> 2/3 交叉印证[中] -> 3/3 水落石出[高]）+ 六大渠道接力 + 终局转化钩子参考」，
 * 严禁绑死剧情或机械照抄参考标题，强引导主 LLM 根据当前战区实际地貌、势力与前文伏笔自由拟定情报链名、各阶标题与核查细节。
 */
export const PRESET_INTEL_CHAIN_TEMPLATES: readonly PresetIntelChainTemplate[] = Object.freeze([
  {
    id: 'ICHAIN-RELIC-BEACON',
    themeLabel: '休眠重工/秘研信标溯源链',
    totalSteps: 3,
    matchKeywords: ['信标', '重工', '休眠', '加密脉冲', '电网', '气闸', '基地车', 'MCV', '火种', '秘研'],
    stages: [
      {
        step: '1/3',
        stageTitle: '捕风捉影',
        recommendedChannels: ['暗网流言', '电讯截获'],
        credTarget: '低',
        directionHint:
          '捕捉到断续的旧时代加密脉冲、地下电网余波或勘探队失联传闻（请结合当前地域地貌自主发挥）',
      },
      {
        step: '2/3',
        stageTitle: '交叉印证',
        recommendedChannels: ['雷达侦察', '前线目视'],
        credTarget: '中',
        directionHint:
          '通过遥感测绘或外围抵近侦察锁定异常频段扇区与外围封锁哨（请结合前文线索自主发挥）',
      },
      {
        step: '3/3',
        stageTitle: '水落石出',
        recommendedChannels: ['电讯截获', '渗透内线'],
        credTarget: '高',
        directionHint:
          '破译核心掩体精确坐标与气闸特征，确认休眠重工设施或 MCV 火种存在',
      },
    ],
    conversionHookHint:
      '可顺势派生多环主线 <任务>（如跨阵营 MCV 启封链 / 特种蓝图攻坚链）或解锁战略 <协议> 线索',
  },
  {
    id: 'ICHAIN-ENEMY-BUILDUP',
    themeLabel: '敌方集结与核心掩体侦察链',
    totalSteps: 3,
    matchKeywords: ['集结', '掩体', '调动', '车辙', '防空', '装甲', '指挥节点', '哨卡', '敌军', '敌方', '防线'],
    stages: [
      {
        step: '1/3',
        stageTitle: '捕风捉影',
        recommendedChannels: ['前线目视', '宏观广播'],
        credTarget: '低',
        directionHint:
          '外围巡逻或难民提及周边防区出现异常夜间车辙、物资征调或通讯管制（请按当前敌情自主发挥）',
      },
      {
        step: '2/3',
        stageTitle: '交叉印证',
        recommendedChannels: ['电讯截获', '雷达侦察'],
        credTarget: '中',
        directionHint:
          '截获敌方后勤调度密电或雷达捕捉到装甲/防空阵地热源轮廓（请按当前态势自主发挥）',
      },
      {
        step: '3/3',
        stageTitle: '水落石出',
        recommendedChannels: ['雷达侦察', '渗透内线'],
        credTarget: '高',
        directionHint:
          '彻底查明敌方集结兵力配置、指挥节点坐标与防线薄弱缺口',
      },
    ],
    conversionHookHint:
      '可顺势派生紧急/支线 <任务>（先发制人拔点 / 补给线截击）、新增/更新 <扩展档案>（人物/势力）并更新 <态势> 敌情预警',
  },
  {
    id: 'ICHAIN-UNDERGROUND-NET',
    themeLabel: '暗网黑市与反渗透甄别链',
    totalSteps: 3,
    matchKeywords: ['暗网', '黑市', '渗透', '内线', '暗桩', '间谍', '商队', '悬赏', '走私', '潜伏', '金主'],
    stages: [
      {
        step: '1/3',
        stageTitle: '捕风捉影',
        recommendedChannels: ['暗网流言', '前线目视'],
        credTarget: '低',
        directionHint:
          '黑市流传针对我方防区的悬赏询价、可疑商队窥探或物资账目微小出入（请结合周边聚落态势自主发挥）',
      },
      {
        step: '2/3',
        stageTitle: '交叉印证',
        recommendedChannels: ['电讯截获', '渗透内线'],
        credTarget: '中',
        directionHint:
          '定向监听可疑频段或顺藤摸瓜排查中间联络人、锁定幕后金主/潜伏桩脚范围',
      },
      {
        step: '3/3',
        stageTitle: '水落石出',
        recommendedChannels: ['渗透内线', '前线目视'],
        credTarget: '高',
        directionHint:
          '人赃并获掌握完整渗透网络名单、黑市暗桩坐标或幕后派系底牌',
      },
    ],
    conversionHookHint:
      '可顺势派生 <任务>（反侦察拔点 / 黑市折冲）、新增/更新 <扩展档案>（类别: 人物/势力）并支撑降低暴露度',
  },
  {
    id: 'ICHAIN-RESOURCE-VEIN',
    themeLabel: '特种矿脉与旧时代奇物勘测链',
    totalSteps: 3,
    matchKeywords: ['矿脉', '矿坑', '奇物', '残骸', '仓储', '工业区', '裂隙', '矿石', '富集', '勘测', '样本'],
    stages: [
      {
        step: '1/3',
        stageTitle: '捕风捉影',
        recommendedChannels: ['暗网流言', '宏观广播'],
        credTarget: '低',
        directionHint:
          '传闻某废弃工业区、裂隙边缘或矿坑深处存在高纯度特种矿脉或旧时代技术残骸（请结合当前地形自主发挥）',
      },
      {
        step: '2/3',
        stageTitle: '交叉印证',
        recommendedChannels: ['雷达侦察', '前线目视'],
        credTarget: '中',
        directionHint:
          '地质遥感扫描或先遣工程组采样确认高价值物质反应与周边盘踞威胁',
      },
      {
        step: '3/3',
        stageTitle: '水落石出',
        recommendedChannels: ['前线目视', '雷达侦察'],
        credTarget: '高',
        directionHint:
          '探明完整矿脉储量/奇物型号与安全开采通道参数',
      },
    ],
    conversionHookHint:
      '可顺势派生经济/军工 <任务>（紧缺资源搜刮 / 工业支线资金链开拓 / Tier A 蓝图回收）或解锁战略 <协议> 线索',
  },
]);

/**
 * 解析战区情报链阶数标识（支持 `"1/3"`、`"第1阶/共3阶"`、`"第2阶/3"`、`"2 / 3"`、`"第2环/共3环"` 等格式）。
 */
export function parseIntelChainStep(
  chainStep?: string | null,
): { current: number; total: number; isFinal: boolean } | null {
  const raw = String(chainStep ?? '').trim();
  if (!raw) return null;

  const match = raw.match(
    /第?\s*(\d+)\s*(?:[阶环幕章段步]\s*)?(?:[/／,，·]|共)\s*(?:共\s*)?(\d+)\s*[阶环幕章段步]?/,
  );
  if (match) {
    const current = Number(match[1]);
    const total = Number(match[2]);
    if (
      Number.isInteger(current) &&
      Number.isInteger(total) &&
      current >= 1 &&
      total >= 1 &&
      current <= total
    ) {
      return { current, total, isFinal: current >= total };
    }
  }

  return null;
}

function matchPresetIntelChainTemplate(
  chainName: string,
  intelTitle: string,
  content: string,
): PresetIntelChainTemplate | undefined {
  const haystack = `${chainName} ${intelTitle} ${content}`.toLowerCase();
  return PRESET_INTEL_CHAIN_TEMPLATES.find(tpl =>
    tpl.matchKeywords.some(kw => haystack.includes(kw.toLowerCase())),
  );
}

/**
 * 扫描 `data.intel` 中未闭环或刚核实水落石出的多阶战区情报链：
 * - 情形 A（`step_continuation`）：尚未证实（`status !== '已证实'` 且 `cred !== '高'`）且带有 `chain / chain_step / next_lead / hook`，
 *   结合我方已解锁渠道推荐**优先不同于当前 `src_kind`** 的跨渠道交叉印证方式，最高优先级顺延 LLM 自创的 `chain` 与 `next_lead`；
 * - 情形 B（`verified_conversion`）：已达成 `status === '已证实' || cred === '高'` 且带有情报链或转化钩子，
 *   且为本轮刚升格证实（`isJustVerifiedThisTurn`）或尚未在 `quests.active / history` 中派生关联任务，引导水到渠成转化为 `<任务>`、`<扩展档案>` 或 `<协议>` 线索。
 */
export function detectPendingIntelChains(
  data: StatData,
  options?: {
    availableChannels?: readonly string[];
    prevData?: StatData | null;
  },
): IntelChainContinuationHint[] {
  const intelList = (data.intel ?? []) as ChainAwareIntelItem[];
  if (intelList.length === 0) return [];

  const availableChannels =
    options?.availableChannels && options.availableChannels.length > 0
      ? [...options.availableChannels]
      : ['前线目视', '宏观广播'];

  const prevIntelList = ((options?.prevData?.intel ?? []) as ChainAwareIntelItem[]).filter(
    it => it && it.scope !== 'world',
  );

  const allQuests = [
    ...((data.quests?.active ?? []) as ChainAwareQuest[]),
    ...(((data.quests as unknown as { history?: ChainAwareQuest[] } | undefined)?.history ?? [])),
  ];

  const isIntelVerified = (it: ChainAwareIntelItem): boolean =>
    it.status === '已证实' || it.cred === '高';

  const checkJustVerifiedThisTurn = (it: ChainAwareIntelItem): boolean => {
    if (!options?.prevData || !isIntelVerified(it)) return false;
    const chainKey = canon(String(it.chain ?? ''));
    const titleKey = canon(String(it.title ?? ''));
    const evoKey = canon(String(it.evolves_from ?? ''));

    const matchedPrev = prevIntelList.find(prev => {
      if (it.id && prev.id && it.id === prev.id) return true;
      if (chainKey && prev.chain && canon(prev.chain) === chainKey) return true;
      if (evoKey && prev.title && canon(prev.title) === evoKey) return true;
      if (titleKey && prev.title && canon(prev.title) === titleKey) return true;
      return false;
    });

    if (matchedPrev) {
      return !isIntelVerified(matchedPrev);
    }

    // 本轮新增即高可信度/已证实且带有情报链或溯源锚点
    return Boolean(it.chain || it.chain_step || it.evolves_from || it.next_lead || it.hook);
  };

  const hasRelatedQuestSpawned = (
    chainName: string,
    intelTitle: string,
    leadHook: string,
  ): boolean => {
    const cKey = canon(chainName);
    const tKey = canon(intelTitle);
    const lKey = canon(leadHook);

    return allQuests.some(q => {
      const qNameKey = canon(q.name);
      const qSeriesKey = canon(String(q.series ?? ''));
      const qNoteKey = canon(String(q.note ?? ''));
      const haystack = `${qNameKey} ${qSeriesKey} ${qNoteKey}`;

      if (cKey && cKey.length >= 2 && haystack.includes(cKey)) return true;
      if (tKey && tKey.length >= 2 && haystack.includes(tKey)) return true;
      if (lKey && lKey.length >= 3 && haystack.includes(lKey.slice(0, 8))) return true;
      return false;
    });
  };

  const pickRecommendedNextChannels = (
    currentChannel: string,
    templatePreferred: readonly string[],
  ): string[] => {
    const currCanon = canon(currentChannel);
    const picked: string[] = [];

    // 1. 优先按模板推荐顺序，从已解锁渠道中挑选不同于当前渠道的推荐渠道
    for (const tp of templatePreferred) {
      if (canon(tp) === currCanon) continue;
      const matchedAvail = availableChannels.find(ch => canon(ch) === canon(tp));
      if (matchedAvail && !picked.includes(matchedAvail)) {
        picked.push(matchedAvail);
      }
    }
    // 2. 其次从已解锁渠道中挑选不同于当前渠道的其他渠道
    for (const ch of availableChannels) {
      if (canon(ch) === currCanon) continue;
      if (!picked.includes(ch)) {
        picked.push(ch);
      }
    }
    // 3. 若模板推荐了其他不同渠道但尚未凑够 2 个，可补充模板推荐渠道作参考
    if (picked.length === 0) {
      for (const tp of templatePreferred) {
        if (canon(tp) !== currCanon && !picked.includes(tp)) {
          picked.push(tp);
        }
      }
    }
    if (picked.length === 0 && availableChannels.length > 0) {
      picked.push(availableChannels[0]);
    }

    return picked.slice(0, 2);
  };

  const hints: IntelChainContinuationHint[] = [];
  const seenKeys = new Set<string>();

  for (let i = intelList.length - 1; i >= 0; i--) {
    const it = intelList[i];
    if (!it || it.scope === 'world' || it.status === '已证伪') continue;

    const chainRaw = String(it.chain ?? '').trim();
    const stepRaw = String(it.chain_step ?? '').trim();
    const nextLeadRaw = String(it.next_lead ?? '').trim();
    const hookRaw = String(it.hook ?? '').trim();
    const evolvesFromRaw = String(it.evolves_from ?? '').trim();
    const titleRaw = String(it.title ?? '').trim();
    const contentRaw = String(it.content ?? '').trim();

    const stepInfo = parseIntelChainStep(stepRaw);
    const chainName = chainRaw || titleRaw || contentRaw.slice(0, 18) || '战区侦察案卷';
    const intelTitle = titleRaw || contentRaw.slice(0, 20) || chainName;
    const dedupKey = canon(chainRaw || intelTitle);
    if (dedupKey && seenKeys.has(dedupKey)) continue;

    const currentChannel = String(it.src_kind || it.src || '前线目视').trim();
    const matchedTemplate = matchPresetIntelChainTemplate(chainName, intelTitle, contentRaw);
    const verified = isIntelVerified(it);

    // ── 情形 A：在途待升阶交叉印证（step_continuation） ──
    if (!verified) {
      const hasChainOrHook = Boolean(chainRaw || stepRaw || nextLeadRaw || hookRaw);
      if (!hasChainOrHook) continue;
      if (stepInfo && stepInfo.isFinal) continue;

      if (dedupKey) seenKeys.add(dedupKey);

      const currentStepNum = stepInfo
        ? stepInfo.current
        : it.status === '演进中' || it.cred === '中'
          ? 2
          : 1;
      const totalSteps = stepInfo ? stepInfo.total : matchedTemplate?.totalSteps ?? 3;
      const nextStepNum = Math.min(currentStepNum + 1, totalSteps);
      const currentStepLabel = stepInfo ? `${stepInfo.current}/${stepInfo.total}` : `${currentStepNum}/${totalSteps}`;
      const nextStepLabel = `${nextStepNum}/${totalSteps}`;

      const templateNextStage = matchedTemplate
        ? matchedTemplate.stages.find(s => s.step.startsWith(`${nextStepNum}/`)) ??
          matchedTemplate.stages[Math.min(nextStepNum - 1, matchedTemplate.stages.length - 1)]
        : undefined;

      const recommendedNextChannels = pickRecommendedNextChannels(
        currentChannel,
        templateNextStage?.recommendedChannels ?? [],
      );

      const nextLeadHook =
        nextLeadRaw ||
        hookRaw ||
        (templateNextStage
          ? `${templateNextStage.stageTitle}：${templateNextStage.directionHint}`
          : `顺延《${chainName}》上一阶「${intelTitle}」线索，通过异源渠道交叉印证具体坐标与实况`);

      const conversionTargetHint =
        matchedTemplate?.conversionHookHint ??
        '可顺势派生关联 <任务>（含多环系列任务链）、新增/更新 <扩展档案>（人物/势力）或解锁战略 <协议> 线索';

      hints.push({
        kind: 'step_continuation',
        chainName,
        intelTitle,
        currentStepLabel,
        nextStepLabel,
        currentChannel,
        recommendedNextChannels,
        nextLeadHook,
        conversionTargetHint,
        isJustVerifiedThisTurn: false,
      });
      continue;
    }

    // ── 情形 B：终局水落石出水到渠成转化（verified_conversion） ──
    const hasChainOrConversionHook = Boolean(
      chainRaw || stepRaw || nextLeadRaw || hookRaw || evolvesFromRaw,
    );
    if (!hasChainOrConversionHook) continue;

    const isJustVerifiedThisTurn = checkJustVerifiedThisTurn(it);
    const alreadySpawnedQuest = hasRelatedQuestSpawned(
      chainName,
      intelTitle,
      nextLeadRaw || hookRaw,
    );

    if (!isJustVerifiedThisTurn && alreadySpawnedQuest) continue;

    if (dedupKey) seenKeys.add(dedupKey);

    const currentStepLabel = stepInfo
      ? `${stepInfo.current}/${stepInfo.total}`
      : stepRaw || '3/3';
    const nextStepLabel = '已证实·战略转化';
    const leadText = nextLeadRaw || hookRaw;
    const nextLeadHook =
      leadText || `「${intelTitle}」已核实水落石出，可将实锤情报转化为战术行动或档案记录`;

    const tplConversion =
      matchedTemplate?.conversionHookHint ??
      '可顺势派生关联 <任务>（含多环系列任务链）、新增/更新 <扩展档案>（人物/势力）或解锁战略 <协议> 线索';
    const conversionTargetHint = leadText
      ? `结合实锤线索「${leadText}」，${tplConversion}（可顺势派生关联 <任务>（含多环系列任务链）、新增/更新 <扩展档案>（人物/势力）或解锁战略 <协议> 线索）`
      : `${tplConversion}（可顺势派生关联 <任务>（含多环系列任务链）、新增/更新 <扩展档案>（人物/势力）或解锁战略 <协议> 线索）`;

    hints.push({
      kind: 'verified_conversion',
      chainName,
      intelTitle,
      currentStepLabel,
      nextStepLabel,
      currentChannel,
      recommendedNextChannels: pickRecommendedNextChannels(
        currentChannel,
        matchedTemplate?.stages[matchedTemplate.stages.length - 1]?.recommendedChannels ?? [],
      ),
      nextLeadHook,
      conversionTargetHint,
      isJustVerifiedThisTurn,
    });
  }

  hints.sort((a, b) => Number(b.isJustVerifiedThisTurn) - Number(a.isJustVerifiedThisTurn));
  return hints;
}
